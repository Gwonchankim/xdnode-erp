import { env } from "cloudflare:workers";
import { ensureDataGovernanceSchema } from "../../data-governance";
import { authorizeErpRequest, safeJson, writeErpAudit } from "../../erp-platform";
import { financeCurrentData } from "../../finance-current-data";

type Bindings = { DB: D1Database; HR_AUDIO: R2Bucket };
const bindings = env as unknown as Bindings;
const db = bindings.DB;

type CheckStatus = "PASS" | "WARN" | "FAIL";
type Check = { code: string; category: string; status: CheckStatus; title: string; detail: string; evidence: Record<string, unknown> };
type SnapshotRow = {
  id: string; scope: string; status: string; object_key: string; file_name: string; sha256: string;
  byte_size: number; table_count: number; row_count: number; manifest_json: string; requested_by: string;
  created_at: number; verified_at: number | null; verified_by: string; verification_status: string;
  verification_detail: string; failure_message: string;
};
type ExportRow = {
  id: string; date_from: string; date_to: string; module: string; status: string; object_key: string;
  file_name: string; sha256: string; byte_size: number; row_count: number; requested_by: string;
  created_at: number; failure_message: string;
};

const snapshotExcludedTables = new Set([
  "erp_data_control_runs", "erp_data_control_checks", "erp_logical_snapshots",
  "erp_recovery_rehearsals", "erp_audit_exports", "erp_retention_policies",
]);
const allowedModules = new Set(["ALL", "operations", "finance", "hr", "recruitment", "sales", "settings"]);

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(bytes: Uint8Array) {
  return toHex(await crypto.subtle.digest("SHA-256", bytes));
}

function csvCell(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function toSnapshot(row: SnapshotRow) {
  return {
    id: row.id, scope: row.scope, status: row.status, fileName: row.file_name, sha256: row.sha256,
    byteSize: row.byte_size, tableCount: row.table_count, rowCount: row.row_count,
    manifest: safeJson<Record<string, unknown>>(row.manifest_json, {}), requestedBy: row.requested_by,
    createdAt: row.created_at, verifiedAt: row.verified_at, verifiedBy: row.verified_by,
    verificationStatus: row.verification_status, verificationDetail: row.verification_detail,
    failureMessage: row.failure_message,
    downloadUrl: row.status === "READY" ? `/api/data-governance?snapshotDownloadId=${encodeURIComponent(row.id)}` : "",
  };
}

function toExport(row: ExportRow) {
  return {
    id: row.id, dateFrom: row.date_from, dateTo: row.date_to, module: row.module, status: row.status,
    fileName: row.file_name, sha256: row.sha256, byteSize: row.byte_size, rowCount: row.row_count,
    requestedBy: row.requested_by, createdAt: row.created_at, failureMessage: row.failure_message,
    downloadUrl: row.status === "READY" ? `/api/data-governance?exportDownloadId=${encodeURIComponent(row.id)}` : "",
  };
}

async function tableExists(name: string) {
  const row = await db.prepare("SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = ?").bind(name).first<{ present: number }>();
  return Boolean(row?.present);
}

async function runControlChecks(employeeId: string) {
  const id = crypto.randomUUID();
  const startedAt = Date.now();
  await db.prepare(`INSERT INTO erp_data_control_runs
    (id, status, requested_by, started_at, created_at) VALUES (?, 'RUNNING', ?, ?, ?)`)
    .bind(id, employeeId, startedAt, startedAt).run();
  const checks: Check[] = [];
  const add = (check: Check) => checks.push(check);
  const capture = async (code: string, category: string, title: string, work: () => Promise<Omit<Check, "code" | "category" | "title">>) => {
    try { add({ code, category, title, ...await work() }); }
    catch (error) { add({ code, category, title, status: "FAIL", detail: error instanceof Error ? error.message : "점검 실행 실패", evidence: {} }); }
  };

  await capture("SCHEMA_CORE", "데이터베이스", "핵심 업무 테이블", async () => {
    const required = ["erp_user_access", "erp_audit_logs", "erp_tasks", "hr_employee_records"];
    const missing: string[] = [];
    for (const table of required) if (!await tableExists(table)) missing.push(table);
    return { status: missing.length ? "FAIL" : "PASS", detail: missing.length ? `누락 테이블 ${missing.join(", ")}` : "핵심 권한·감사·업무·인사 테이블이 존재합니다.", evidence: { required, missing } };
  });
  await capture("ADMIN_CONTINUITY", "권한", "관리자 접근 연속성", async () => {
    const row = await db.prepare(`SELECT COUNT(*) AS count FROM erp_user_access
      WHERE active = 1 AND roles_json LIKE '%SUPER_ADMIN%'`).first<{ count: number }>();
    const count = row?.count ?? 0;
    return { status: count > 0 ? "PASS" : "FAIL", detail: count > 0 ? `활성 최고관리자 ${count}명이 확인되었습니다.` : "활성 최고관리자가 없어 운영 복구가 불가능합니다.", evidence: { activeSuperAdmins: count } };
  });
  await capture("IDENTITY_DUPLICATE", "권한", "직원 이메일 중복", async () => {
    if (!await tableExists("hr_employee_records")) return { status: "FAIL", detail: "인사기록 테이블을 확인할 수 없습니다.", evidence: {} };
    const row = await db.prepare(`SELECT COUNT(*) AS count FROM (
      SELECT lower(email) FROM hr_employee_records WHERE trim(email) <> '' GROUP BY lower(email) HAVING COUNT(*) > 1
    )`).first<{ count: number }>();
    const count = row?.count ?? 0;
    return { status: count ? "FAIL" : "PASS", detail: count ? `중복 이메일 ${count}개를 정리해야 합니다.` : "회사 계정 연결에 사용되는 직원 이메일이 고유합니다.", evidence: { duplicateEmailGroups: count } };
  });
  await capture("AUDIT_TRAIL", "감사", "감사기록 가용성", async () => {
    const row = await db.prepare("SELECT COUNT(*) AS count, MAX(created_at) AS latest FROM erp_audit_logs").first<{ count: number; latest: number | null }>();
    const count = row?.count ?? 0;
    return { status: count ? "PASS" : "WARN", detail: count ? `감사기록 ${count.toLocaleString("ko-KR")}건이 조회됩니다.` : "감사기록이 아직 없습니다.", evidence: { count, latestAt: row?.latest ?? null } };
  });
  await capture("SYNC_FRESHNESS", "연동", "외부 데이터 최신성", async () => {
    const row = await db.prepare(`SELECT source, snapshot_date, status, completed_at FROM erp_sync_runs
      ORDER BY snapshot_date DESC, created_at DESC LIMIT 1`).first<{ source: string; snapshot_date: string; status: string; completed_at: number | null }>();
    if (!row) return { status: "WARN", detail: "저장된 외부 연동 실행 이력이 없습니다.", evidence: {} };
    const ageDays = Math.floor((Date.now() - new Date(`${row.snapshot_date}T00:00:00+09:00`).getTime()) / 86_400_000);
    const status: CheckStatus = row.status !== "SUCCESS" ? "FAIL" : ageDays > 2 ? "WARN" : "PASS";
    return { status, detail: `${row.source} · ${row.snapshot_date} · ${row.status}${ageDays > 2 ? ` · ${ageDays}일 경과` : ""}`, evidence: { ...row, ageDays } };
  });
  await capture("FINANCE_JOURNAL_BALANCE", "재무", "2026 분개장 차대변", async () => {
    const difference = financeCurrentData.journalSummary.differenceKrw;
    return { status: difference === 0 ? "PASS" : "WARN", detail: difference === 0 ? "2026년 분개장 차변과 대변이 일치합니다." : `원천 분개장에 ${difference.toLocaleString("ko-KR")}원 차이가 남아 있습니다.`, evidence: { asOf: financeCurrentData.asOf, differenceKrw: difference, lineCount: financeCurrentData.journalSummary.lineCount } };
  });
  await capture("OBJECT_STORAGE", "파일", "문서·녹음 원본 표본", async () => {
    const references: Array<{ kind: string; key: string }> = [];
    if (await tableExists("erp_documents")) {
      const result = await db.prepare("SELECT storage_key FROM erp_documents WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 20").all<{ storage_key: string }>();
      references.push(...result.results.map((row) => ({ kind: "document", key: row.storage_key })));
    }
    for (const table of ["employee_interview_records", "applicant_interview_recordings"]) {
      if (!await tableExists(table)) continue;
      const result = await db.prepare(`SELECT audio_key FROM ${table} ORDER BY created_at DESC LIMIT 10`).all<{ audio_key: string }>();
      references.push(...result.results.map((row) => ({ kind: "audio", key: row.audio_key })));
    }
    const heads = await Promise.all(references.map((reference) => bindings.HR_AUDIO.head(reference.key)));
    const missing = heads.filter((head) => !head).length;
    const status: CheckStatus = missing ? "FAIL" : references.length ? "PASS" : "WARN";
    return { status, detail: references.length ? `최근 원본 ${references.length}건 중 누락 ${missing}건입니다.` : "점검할 저장 파일이 아직 없습니다.", evidence: { sampled: references.length, missing } };
  });
  await capture("SNAPSHOT_RECOVERY", "복구", "검증된 논리 스냅샷", async () => {
    const row = await db.prepare(`SELECT created_at, verification_status, verified_at FROM erp_logical_snapshots
      WHERE status = 'READY' ORDER BY created_at DESC LIMIT 1`).first<{ created_at: number; verification_status: string; verified_at: number | null }>();
    if (!row) return { status: "WARN", detail: "아직 생성된 D1 논리 스냅샷이 없습니다.", evidence: {} };
    const ageDays = Math.floor((Date.now() - row.created_at) / 86_400_000);
    const status: CheckStatus = row.verification_status !== "PASS" ? "WARN" : ageDays > 7 ? "WARN" : "PASS";
    return { status, detail: `최근 스냅샷 ${ageDays}일 전 · 검증 ${row.verification_status}`, evidence: { ageDays, verificationStatus: row.verification_status, verifiedAt: row.verified_at } };
  });
  await capture("RETENTION_POLICY", "보존", "보존정책 확정 상태", async () => {
    const row = await db.prepare("SELECT COUNT(*) AS total, SUM(active) AS active FROM erp_retention_policies").first<{ total: number; active: number | null }>();
    const active = row?.active ?? 0; const total = row?.total ?? 0;
    return { status: active === total && total > 0 ? "PASS" : "WARN", detail: `${total}개 정책 중 ${active}개가 확정되었습니다. 자동 삭제는 수행하지 않습니다.`, evidence: { total, active } };
  });

  const failed = checks.filter((check) => check.status === "FAIL").length;
  const warnings = checks.filter((check) => check.status === "WARN").length;
  const status = failed ? "CRITICAL" : warnings ? "ATTENTION" : "HEALTHY";
  const completedAt = Date.now();
  await db.batch(checks.map((check) => db.prepare(`INSERT INTO erp_data_control_checks
    (id, run_id, check_code, category, status, title, detail, evidence_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), id, check.code, check.category, check.status, check.title, check.detail, JSON.stringify(check.evidence), completedAt)));
  await db.prepare(`UPDATE erp_data_control_runs SET status = ?, check_count = ?, failed_count = ?,
    warning_count = ?, summary_json = ?, completed_at = ? WHERE id = ? AND status = 'RUNNING'`)
    .bind(status, checks.length, failed, warnings, JSON.stringify({ passed: checks.length - failed - warnings }), completedAt, id).run();
  if (status === "HEALTHY") {
    await db.prepare(`UPDATE erp_tasks SET status = 'DONE', completed_at = ?, updated_at = ?
      WHERE id = 'data-governance-attention' AND status <> 'DONE'`).bind(completedAt, completedAt).run();
  } else {
    const priority = failed ? "CRITICAL" : "HIGH";
    await db.prepare(`INSERT INTO erp_tasks
      (id, module, category, title, description, owner_employee_id, due_date, status, priority,
        destination, source_type, source_id, created_at, updated_at, completed_at, deleted_at)
      VALUES ('data-governance-attention', 'operations', '데이터 통제', ?, ?, ?, ?, 'OPEN', ?,
        'settings:data-governance', 'SYSTEM_RULE', ?, ?, ?, NULL, NULL)
      ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description,
        owner_employee_id = excluded.owner_employee_id, due_date = excluded.due_date, status = 'OPEN',
        priority = excluded.priority, destination = excluded.destination, source_type = excluded.source_type,
        source_id = excluded.source_id, updated_at = excluded.updated_at, completed_at = NULL, deleted_at = NULL`)
      .bind(`데이터 통제 ${failed ? `실패 ${failed}건` : `주의 ${warnings}건`} 확인`, `총 ${checks.length}개 항목 중 실패 ${failed}건 · 주의 ${warnings}건입니다. 데이터 신뢰성 통제 센터에서 근거와 조치사항을 확인해 주세요.`, employeeId, new Date().toISOString().slice(0, 10), priority, id, completedAt, completedAt).run();
  }
  return { id, status, checkCount: checks.length, failedCount: failed, warningCount: warnings, startedAt, completedAt, checks };
}

async function createSnapshot(employeeId: string) {
  const id = crypto.randomUUID(); const createdAt = Date.now();
  const objectKey = `erp-governance/snapshots/${id}.json`; const fileName = `XD_NODE_D1_snapshot_${new Date(createdAt).toISOString().slice(0, 10)}_${id.slice(0, 8)}.json`;
  await db.prepare(`INSERT INTO erp_logical_snapshots
    (id, scope, status, requested_by, created_at) VALUES (?, 'D1_APPLICATION_DATA', 'CREATING', ?, ?)`)
    .bind(id, employeeId, createdAt).run();
  try {
    const auditBefore = await db.prepare("SELECT COUNT(*) AS count, MAX(created_at) AS latest FROM erp_audit_logs").first<{ count: number; latest: number | null }>();
    const tableResult = await db.prepare(`SELECT name, sql FROM sqlite_schema
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all<{ name: string; sql: string | null }>();
    const tables = tableResult.results.filter((table) => /^[a-zA-Z0-9_]+$/.test(table.name) && !snapshotExcludedTables.has(table.name));
    const payloadTables: Array<{ name: string; schema: string; rows: Record<string, unknown>[] }> = [];
    let totalRows = 0;
    for (const table of tables) {
      const rows: Record<string, unknown>[] = []; let cursor = 0;
      while (true) {
        const result = await db.prepare(`SELECT rowid AS __snapshot_rowid, * FROM ${table.name} WHERE rowid > ? ORDER BY rowid LIMIT 500`).bind(cursor).all<Record<string, unknown> & { __snapshot_rowid: number }>();
        if (!result.results.length) break;
        for (const row of result.results) {
          cursor = Number(row.__snapshot_rowid); delete row.__snapshot_rowid; rows.push(row);
        }
        totalRows += result.results.length;
        if (totalRows > 50_000) throw new Error("논리 스냅샷 안전 한도(50,000행)를 초과했습니다. 범위를 분할해야 합니다.");
      }
      payloadTables.push({ name: table.name, schema: table.sql ?? "", rows });
    }
    const auditAfter = await db.prepare("SELECT COUNT(*) AS count, MAX(created_at) AS latest FROM erp_audit_logs").first<{ count: number; latest: number | null }>();
    if ((auditBefore?.count ?? 0) !== (auditAfter?.count ?? 0) || (auditBefore?.latest ?? null) !== (auditAfter?.latest ?? null)) {
      throw new Error("스냅샷 생성 중 감사 대상 업무 변경이 감지되었습니다. 업무가 멈춘 뒤 다시 생성해 주세요.");
    }
    const payload = { format: "XD_NODE_D1_LOGICAL_SNAPSHOT_V1", generatedAt: new Date(createdAt).toISOString(), scope: "D1_APPLICATION_DATA", consistencyAudit: { count: auditAfter?.count ?? 0, latestAt: auditAfter?.latest ?? null }, tables: payloadTables };
    const bytes = new TextEncoder().encode(JSON.stringify(payload));
    if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("논리 스냅샷 안전 한도(20MB)를 초과했습니다. 범위를 분할해야 합니다.");
    const digest = await sha256(bytes);
    const manifest = { format: payload.format, generatedAt: payload.generatedAt, consistencyAudit: payload.consistencyAudit, tables: payloadTables.map((table) => ({ name: table.name, rows: table.rows.length })), excludes: [...snapshotExcludedTables] };
    await bindings.HR_AUDIO.put(objectKey, bytes, { httpMetadata: { contentType: "application/json" }, customMetadata: { sha256: digest, scope: "D1_APPLICATION_DATA" } });
    await db.prepare(`UPDATE erp_logical_snapshots SET status = 'READY', object_key = ?, file_name = ?,
      sha256 = ?, byte_size = ?, table_count = ?, row_count = ?, manifest_json = ? WHERE id = ? AND status = 'CREATING'`)
      .bind(objectKey, fileName, digest, bytes.byteLength, payloadTables.length, totalRows, JSON.stringify(manifest), id).run();
    return await db.prepare("SELECT * FROM erp_logical_snapshots WHERE id = ?").bind(id).first<SnapshotRow>();
  } catch (error) {
    const message = error instanceof Error ? error.message : "스냅샷 생성 실패";
    await bindings.HR_AUDIO.delete(objectKey).catch(() => undefined);
    await db.prepare("UPDATE erp_logical_snapshots SET status = 'FAILED', failure_message = ? WHERE id = ?").bind(message.slice(0, 500), id).run();
    throw error;
  }
}

async function readSnapshot(row: SnapshotRow) {
  const object = await bindings.HR_AUDIO.get(row.object_key);
  if (!object) throw new Error("스냅샷 원본 파일을 찾을 수 없습니다.");
  const bytes = new Uint8Array(await object.arrayBuffer());
  const digest = await sha256(bytes);
  let payload: { format?: string; tables?: Array<{ name?: string; schema?: string; rows?: unknown[] }> };
  try { payload = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new Error("스냅샷 JSON 구조를 해석할 수 없습니다."); }
  return { bytes, digest, payload };
}

async function verifySnapshot(row: SnapshotRow, employeeId: string) {
  const { digest, payload } = await readSnapshot(row);
  const tableCount = payload.tables?.length ?? 0;
  const rowCount = payload.tables?.reduce((sum, table) => sum + (Array.isArray(table.rows) ? table.rows.length : 0), 0) ?? 0;
  const failures = [
    digest !== row.sha256 ? "SHA-256 불일치" : "",
    payload.format !== "XD_NODE_D1_LOGICAL_SNAPSHOT_V1" ? "지원하지 않는 포맷" : "",
    tableCount !== row.table_count ? "테이블 수 불일치" : "",
    rowCount !== row.row_count ? "행 수 불일치" : "",
  ].filter(Boolean);
  const status = failures.length ? "FAIL" : "PASS"; const verifiedAt = Date.now();
  const detail = failures.length ? failures.join(" · ") : `해시·포맷·${tableCount}개 테이블·${rowCount.toLocaleString("ko-KR")}행을 확인했습니다.`;
  await db.prepare(`UPDATE erp_logical_snapshots SET verification_status = ?, verification_detail = ?,
    verified_at = ?, verified_by = ? WHERE id = ? AND status = 'READY'`)
    .bind(status, detail, verifiedAt, employeeId, row.id).run();
  return { status, detail, tableCount, rowCount, verifiedAt };
}

async function createAuditExport(employeeId: string, dateFrom: string, dateTo: string, moduleName: string) {
  const id = crypto.randomUUID(); const createdAt = Date.now();
  const objectKey = `erp-governance/audit-exports/${id}.csv`;
  const fileName = `XD_NODE_audit_${dateFrom}_${dateTo}_${moduleName}.csv`;
  await db.prepare(`INSERT INTO erp_audit_exports
    (id, date_from, date_to, module, status, requested_by, created_at)
    VALUES (?, ?, ?, ?, 'CREATING', ?, ?)`).bind(id, dateFrom, dateTo, moduleName, employeeId, createdAt).run();
  try {
    const from = new Date(`${dateFrom}T00:00:00+09:00`).getTime();
    const to = new Date(`${dateTo}T23:59:59.999+09:00`).getTime();
    const where = moduleName === "ALL" ? "created_at BETWEEN ? AND ?" : "created_at BETWEEN ? AND ? AND module = ?";
    const countQuery = db.prepare(`SELECT COUNT(*) AS count FROM erp_audit_logs WHERE ${where}`);
    const count = moduleName === "ALL" ? await countQuery.bind(from, to).first<{ count: number }>() : await countQuery.bind(from, to, moduleName).first<{ count: number }>();
    if ((count?.count ?? 0) > 10_000) throw new Error("감사 내보내기 안전 한도(10,000건)를 초과했습니다. 기간을 나눠 주세요.");
    const header = ["일시", "사용자 이메일", "사번", "모듈", "행위", "대상 유형", "대상 ID", "사유"];
    const rows: unknown[][] = []; let cursorAt = -1; let cursorId = "";
    while (true) {
      const cursorClause = "AND (created_at > ? OR (created_at = ? AND id > ?))";
      const query = db.prepare(`SELECT id, created_at, actor_email, actor_employee_id, module, action, entity_type, entity_id, reason
        FROM erp_audit_logs WHERE ${where} ${cursorClause} ORDER BY created_at, id LIMIT 500`);
      const result = moduleName === "ALL"
        ? await query.bind(from, to, cursorAt, cursorAt, cursorId).all<Record<string, unknown>>()
        : await query.bind(from, to, moduleName, cursorAt, cursorAt, cursorId).all<Record<string, unknown>>();
      if (!result.results.length) break;
      for (const row of result.results) {
        cursorAt = Number(row.created_at); cursorId = String(row.id);
        rows.push([new Date(cursorAt).toISOString(), row.actor_email, row.actor_employee_id, row.module, row.action, row.entity_type, row.entity_id, row.reason]);
      }
    }
    const bytes = new TextEncoder().encode(`\uFEFF${[header, ...rows].map((values) => values.map(csvCell).join(",")).join("\r\n")}`);
    const digest = await sha256(bytes);
    await bindings.HR_AUDIO.put(objectKey, bytes, { httpMetadata: { contentType: "text/csv;charset=utf-8" }, customMetadata: { sha256: digest } });
    await db.prepare(`UPDATE erp_audit_exports SET status = 'READY', object_key = ?, file_name = ?,
      sha256 = ?, byte_size = ?, row_count = ? WHERE id = ? AND status = 'CREATING'`)
      .bind(objectKey, fileName, digest, bytes.byteLength, rows.length, id).run();
    return await db.prepare("SELECT * FROM erp_audit_exports WHERE id = ?").bind(id).first<ExportRow>();
  } catch (error) {
    const message = error instanceof Error ? error.message : "감사 내보내기 실패";
    await bindings.HR_AUDIO.delete(objectKey).catch(() => undefined);
    await db.prepare("UPDATE erp_audit_exports SET status = 'FAILED', failure_message = ? WHERE id = ?").bind(message.slice(0, 500), id).run();
    throw error;
  }
}

async function controlResponse(principal: { employeeId: string; employeeName: string }) {
  const [run, snapshots, rehearsals, exports, policies] = await Promise.all([
    db.prepare("SELECT * FROM erp_data_control_runs ORDER BY created_at DESC LIMIT 1").first<Record<string, unknown>>(),
    db.prepare("SELECT * FROM erp_logical_snapshots ORDER BY created_at DESC LIMIT 12").all<SnapshotRow>(),
    db.prepare("SELECT * FROM erp_recovery_rehearsals ORDER BY performed_at DESC LIMIT 12").all<Record<string, unknown>>(),
    db.prepare("SELECT * FROM erp_audit_exports ORDER BY created_at DESC LIMIT 12").all<ExportRow>(),
    db.prepare("SELECT * FROM erp_retention_policies ORDER BY data_type").all<Record<string, unknown>>(),
  ]);
  const checks = run?.id ? await db.prepare(`SELECT check_code, category, status, title, detail, evidence_json, created_at
    FROM erp_data_control_checks WHERE run_id = ? ORDER BY CASE status WHEN 'FAIL' THEN 0 WHEN 'WARN' THEN 1 ELSE 2 END, category, title`)
    .bind(String(run.id)).all<Record<string, unknown>>() : { results: [] };
  return {
    principal: { employeeId: principal.employeeId, name: principal.employeeName },
    latestRun: run ? {
      id: run.id, status: run.status, checkCount: run.check_count, failedCount: run.failed_count,
      warningCount: run.warning_count, startedAt: run.started_at, completedAt: run.completed_at,
      checks: checks.results.map((row) => ({ code: row.check_code, category: row.category, status: row.status, title: row.title, detail: row.detail, evidence: safeJson(String(row.evidence_json), {}), createdAt: row.created_at })),
    } : null,
    snapshots: snapshots.results.map(toSnapshot),
    rehearsals: rehearsals.results.map((row) => ({ id: row.id, snapshotId: row.snapshot_id, status: row.status, checkCount: row.check_count, failureCount: row.failure_count, detail: safeJson(String(row.detail_json), {}), performedBy: row.performed_by, performedAt: row.performed_at })),
    auditExports: exports.results.map(toExport),
    policies: policies.results.map((row) => ({ id: row.id, dataType: row.data_type, label: row.label, retentionDays: row.retention_days, disposition: row.disposition, active: Boolean(row.active), updatedBy: row.updated_by, updatedAt: row.updated_at })),
    controls: { automaticRestore: false, automaticDeletion: false, snapshotScope: "D1_APPLICATION_DATA", fileStorageCheckedSeparately: true },
  };
}

export async function GET(request: Request) {
  await ensureDataGovernanceSchema(db);
  const authorization = await authorizeErpRequest(db, "settings", "admin");
  if (authorization.response) return authorization.response;
  const url = new URL(request.url);
  const snapshotDownloadId = url.searchParams.get("snapshotDownloadId")?.trim();
  const exportDownloadId = url.searchParams.get("exportDownloadId")?.trim();
  if (snapshotDownloadId || exportDownloadId) {
    const isSnapshot = Boolean(snapshotDownloadId); const id = snapshotDownloadId || exportDownloadId || "";
    const row = isSnapshot
      ? await db.prepare("SELECT object_key, file_name, content_type, status FROM erp_logical_snapshots WHERE id = ?").bind(id).first<{ object_key: string; file_name: string; content_type: string; status: string }>()
      : await db.prepare("SELECT object_key, file_name, 'text/csv;charset=utf-8' AS content_type, status FROM erp_audit_exports WHERE id = ?").bind(id).first<{ object_key: string; file_name: string; content_type: string; status: string }>();
    if (!row || row.status !== "READY") return new Response("내보내기 원본을 찾을 수 없습니다.", { status: 404 });
    const object = await bindings.HR_AUDIO.get(row.object_key);
    if (!object) return new Response("저장된 원본 파일을 찾을 수 없습니다.", { status: 404 });
    await writeErpAudit(db, { principal: authorization.principal, module: "settings", action: isSnapshot ? "DATA_SNAPSHOT_DOWNLOADED" : "AUDIT_EXPORT_DOWNLOADED", entityType: isSnapshot ? "DATA_SNAPSHOT" : "AUDIT_EXPORT", entityId: id });
    return new Response(object.body, { headers: { "Content-Type": row.content_type, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}`, "Cache-Control": "private, no-store" } });
  }
  return Response.json(await controlResponse(authorization.principal));
}

export async function POST(request: Request) {
  await ensureDataGovernanceSchema(db);
  const authorization = await authorizeErpRequest(db, "settings", "admin");
  if (authorization.response) return authorization.response;
  const body = await request.json() as Record<string, unknown>; const action = String(body.action ?? "");
  if (action === "RUN_CHECKS") {
    const run = await runControlChecks(authorization.principal.employeeId);
    await writeErpAudit(db, { principal: authorization.principal, module: "settings", action: "DATA_CONTROL_CHECKED", entityType: "DATA_CONTROL_RUN", entityId: run.id, after: { status: run.status, checks: run.checkCount, failures: run.failedCount, warnings: run.warningCount } });
  } else if (action === "CREATE_SNAPSHOT") {
    const snapshot = await createSnapshot(authorization.principal.employeeId);
    if (!snapshot) return Response.json({ error: "스냅샷 결과를 확인하지 못했습니다." }, { status: 500 });
    await writeErpAudit(db, { principal: authorization.principal, module: "settings", action: "DATA_SNAPSHOT_CREATED", entityType: "DATA_SNAPSHOT", entityId: snapshot.id, after: { sha256: snapshot.sha256, tables: snapshot.table_count, rows: snapshot.row_count, bytes: snapshot.byte_size } });
  } else if (action === "VERIFY_SNAPSHOT" || action === "REHEARSE_RECOVERY") {
    const snapshotId = String(body.snapshotId ?? "").trim();
    const snapshot = await db.prepare("SELECT * FROM erp_logical_snapshots WHERE id = ? AND status = 'READY'").bind(snapshotId).first<SnapshotRow>();
    if (!snapshot) return Response.json({ error: "검증할 스냅샷을 찾을 수 없습니다." }, { status: 404 });
    const verification = await verifySnapshot(snapshot, authorization.principal.employeeId);
    if (action === "REHEARSE_RECOVERY") {
      const { payload } = await readSnapshot(snapshot);
      const structuralFailures = (payload.tables ?? []).filter((table) => !table.name || typeof table.schema !== "string" || !Array.isArray(table.rows)).map((table) => table.name || "UNKNOWN");
      const status = verification.status === "PASS" && structuralFailures.length === 0 ? "PASS" : "FAIL";
      const rehearsalId = crypto.randomUUID(); const performedAt = Date.now();
      await db.prepare(`INSERT INTO erp_recovery_rehearsals
        (id, snapshot_id, status, check_count, failure_count, detail_json, performed_by, performed_at)
        VALUES (?, ?, ?, 4, ?, ?, ?, ?)`)
        .bind(rehearsalId, snapshot.id, status, structuralFailures.length + (verification.status === "PASS" ? 0 : 1), JSON.stringify({ hash: verification.status, format: payload.format, tableCount: verification.tableCount, rowCount: verification.rowCount, structuralFailures, productionWrites: 0 }), authorization.principal.employeeId, performedAt).run();
      await writeErpAudit(db, { principal: authorization.principal, module: "settings", action: "RECOVERY_REHEARSAL_COMPLETED", entityType: "DATA_SNAPSHOT", entityId: snapshot.id, after: { status, productionWrites: 0, failures: structuralFailures.length } });
    } else await writeErpAudit(db, { principal: authorization.principal, module: "settings", action: "DATA_SNAPSHOT_VERIFIED", entityType: "DATA_SNAPSHOT", entityId: snapshot.id, after: verification });
  } else if (action === "CREATE_AUDIT_EXPORT") {
    const dateFrom = String(body.dateFrom ?? ""); const dateTo = String(body.dateTo ?? ""); const moduleName = String(body.module ?? "ALL");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo) || dateFrom > dateTo || !allowedModules.has(moduleName)) return Response.json({ error: "내보낼 기간과 모듈을 확인해 주세요." }, { status: 400 });
    const days = (new Date(`${dateTo}T00:00:00Z`).getTime() - new Date(`${dateFrom}T00:00:00Z`).getTime()) / 86_400_000;
    if (days > 366) return Response.json({ error: "감사 내보내기는 최대 1년 단위로 생성해 주세요." }, { status: 400 });
    const auditExport = await createAuditExport(authorization.principal.employeeId, dateFrom, dateTo, moduleName);
    if (!auditExport) return Response.json({ error: "감사 내보내기 결과를 확인하지 못했습니다." }, { status: 500 });
    await writeErpAudit(db, { principal: authorization.principal, module: "settings", action: "AUDIT_EXPORT_CREATED", entityType: "AUDIT_EXPORT", entityId: auditExport.id, after: { dateFrom, dateTo, module: moduleName, rows: auditExport.row_count, sha256: auditExport.sha256 } });
  } else if (action === "UPDATE_POLICY") {
    const id = String(body.id ?? "").trim(); const retentionDays = Number(body.retentionDays); const active = body.active === true;
    if (!id || !Number.isInteger(retentionDays) || retentionDays < 30 || retentionDays > 7300) return Response.json({ error: "보존기간은 30~7,300일 사이로 입력해 주세요." }, { status: 400 });
    const before = await db.prepare("SELECT * FROM erp_retention_policies WHERE id = ?").bind(id).first<Record<string, unknown>>();
    if (!before) return Response.json({ error: "보존정책을 찾을 수 없습니다." }, { status: 404 });
    const updatedAt = Date.now();
    await db.prepare(`UPDATE erp_retention_policies SET retention_days = ?, active = ?,
      disposition = 'REVIEW_REQUIRED', updated_by = ?, updated_at = ? WHERE id = ?`)
      .bind(retentionDays, active ? 1 : 0, authorization.principal.employeeId, updatedAt, id).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "settings", action: "RETENTION_POLICY_UPDATED", entityType: "RETENTION_POLICY", entityId: id, before, after: { retentionDays, active, disposition: "REVIEW_REQUIRED" }, reason: "자동 삭제 없이 관리자 검토 정책만 갱신" });
  } else return Response.json({ error: "지원하지 않는 데이터 통제 작업입니다." }, { status: 400 });
  return Response.json(await controlResponse(authorization.principal));
}
