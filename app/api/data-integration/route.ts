import { env } from "cloudflare:workers";
import { authorizeErpRequest, writeErpAudit } from "../../erp-platform";
import { ensureDataIntegrationSchema } from "../../data-integration";
import { financeCurrentData } from "../../finance-current-data";
import { financeHistoricalData } from "../../finance-historical-data";
import { financeBankTransactions } from "../../finance-bank-transactions";
import { companyEmployees } from "../../hr-company-data";
import { payrollSeedRecords } from "../../payroll-seed-data";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;

const sourceDefinitions = [
  { id: "clobe-finance-2026", code: "CLOBE_FINANCE_2026", name: "Clobe 2026 재무", category: "FINANCE", system: "CLOBE", mode: "DEPLOYED_SNAPSHOT", scope: "2026년 재무·분개·계좌 요약", cadence: "DAILY", hour: 7, freshness: 48, criticality: "CRITICAL", description: "배포된 Clobe 2026 재무 스냅샷을 검증합니다. 외부 API를 새로 호출하지 않습니다." },
  { id: "clobe-bank-2026", code: "CLOBE_BANK_2026", name: "Clobe 2026 은행거래", category: "FINANCE", system: "CLOBE", mode: "DEPLOYED_SNAPSHOT", scope: "2026년 은행 거래내역", cadence: "DAILY", hour: 7, freshness: 48, criticality: "CRITICAL", description: "배포 스냅샷과 D1 반영 건수·중복·미분류를 대사합니다." },
  { id: "ecount-finance-2024", code: "ECOUNT_FINANCE_2024", name: "이카운트 2024 결산", category: "FINANCE", system: "ECOUNT", mode: "VERIFIED_FILE", scope: "2024년 확정 원장", cadence: "ONE_TIME", hour: 0, freshness: 0, criticality: "HIGH", description: "승인된 과거 원장 파일의 차변·대변 균형을 검증합니다." },
  { id: "ecount-finance-2025", code: "ECOUNT_FINANCE_2025", name: "이카운트 2025 원장", category: "FINANCE", system: "ECOUNT", mode: "VERIFIED_FILE", scope: "2025년 확정 원장", cadence: "ONE_TIME", hour: 0, freshness: 0, criticality: "HIGH", description: "승인된 과거 원장 파일의 차변·대변 균형을 검증합니다." },
  { id: "hiworks-employees", code: "HIWORKS_EMPLOYEES", name: "하이웍스 임직원", category: "HR", system: "HIWORKS", mode: "FILE_SNAPSHOT", scope: "재직·인사기록", cadence: "ON_DEMAND", hour: 0, freshness: 0, criticality: "HIGH", description: "승인된 임직원 파일과 인사기록 원장을 건수·이메일 기준으로 대사합니다." },
  { id: "payroll-excel-2025-2026", code: "PAYROLL_EXCEL_2025_2026", name: "급여 Excel 2025–2026", category: "HR", system: "EXCEL", mode: "FILE_SNAPSHOT", scope: "2025–2026 급여 원장", cadence: "MONTHLY", hour: 0, freshness: 0, criticality: "CRITICAL", description: "승인된 급여 파일과 급여 원장을 원본 행 기준으로 대사합니다." },
] as const;

type Problem = { key: string; type: string; severity: string; title: string; detail: string; sourceAmount?: number; targetAmount?: number; suggestedAction: string };

async function sha256(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((item) => item.toString(16).padStart(2, "0")).join("");
}

async function safeCount(sql: string) {
  try { return Number((await db.prepare(sql).first<{ count: number }>())?.count ?? 0); } catch { return -1; }
}

async function seedSources() {
  const now = Date.now();
  for (const source of sourceDefinitions) await db.prepare(`INSERT INTO erp_integration_sources
    (id, source_code, name, category, system_type, connection_mode, scope, expected_cadence,
      expected_hour_kst, freshness_hours, criticality, description, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET source_code=excluded.source_code, name=excluded.name,
      category=excluded.category, system_type=excluded.system_type, connection_mode=excluded.connection_mode,
      scope=excluded.scope, description=excluded.description, updated_at=excluded.updated_at`)
    .bind(source.id, source.code, source.name, source.category, source.system, source.mode, source.scope,
      source.cadence, source.hour, source.freshness, source.criticality, source.description, now, now).run();
  await db.prepare(`UPDATE erp_sync_runs SET source_id = CASE
    WHEN source='CLOBE' AND scope='FINANCE_2026' THEN 'clobe-finance-2026'
    WHEN source='CLOBE' AND scope='BANK_TRANSACTIONS' THEN 'clobe-bank-2026' ELSE source_id END
    WHERE source_id = ''`).run();
}

async function observed(sourceId: string) {
  const problems: Problem[] = [];
  if (sourceId === "clobe-finance-2026") {
    const metrics = { asOf: financeCurrentData.asOf, journalLines: financeCurrentData.journalSummary.lineCount,
      debit: financeCurrentData.journalSummary.debitAmountKrw, credit: financeCurrentData.journalSummary.creditAmountKrw,
      difference: financeCurrentData.journalSummary.differenceKrw, accounts: financeCurrentData.accounts.length };
    if (metrics.difference !== 0) problems.push({ key: "journal-difference", type: "AMOUNT_MISMATCH", severity: "CRITICAL", title: "분개장 차변·대변 불일치", detail: `${metrics.difference.toLocaleString("ko-KR")}원 차이`, sourceAmount: metrics.debit, targetAmount: metrics.credit, suggestedAction: "Clobe 분개장 원천과 누락 전표를 확인하세요." });
    return { snapshotDate: financeCurrentData.asOf, received: metrics.journalLines, target: metrics.journalLines, metrics, problems };
  }
  if (sourceId === "clobe-bank-2026") {
    const target = await safeCount("SELECT COUNT(*) AS count FROM finance_bank_transactions");
    const distinct = await safeCount("SELECT COUNT(DISTINCT id) AS count FROM finance_bank_transactions");
    const unclassified = await safeCount("SELECT COUNT(*) AS count FROM finance_bank_transactions WHERE is_unclassified = 1");
    if (target < 0) problems.push({ key: "target-missing", type: "MISSING", severity: "CRITICAL", title: "은행거래 원장 미생성", detail: "D1 대상 원장을 찾을 수 없습니다.", suggestedAction: "은행거래 화면을 열어 승인된 스냅샷을 먼저 반영하세요." });
    else if (target !== financeBankTransactions.length) problems.push({ key: "count-mismatch", type: "MISSING", severity: "HIGH", title: "은행거래 건수 불일치", detail: `원천 ${financeBankTransactions.length}건 · D1 ${target}건`, sourceAmount: financeBankTransactions.length, targetAmount: target, suggestedAction: "누락 또는 추가 행을 확인한 뒤 재검증하세요." });
    if (target >= 0 && distinct !== target) problems.push({ key: "duplicate-id", type: "DUPLICATE", severity: "HIGH", title: "은행거래 ID 중복", detail: `중복 ${target - distinct}건`, suggestedAction: "중복 거래 ID를 원천 참조와 비교하세요." });
    if (unclassified > 0) problems.push({ key: "unclassified", type: "UNCLASSIFIED", severity: "NORMAL", title: "미분류 은행거래", detail: `${unclassified}건의 분류가 필요합니다.`, suggestedAction: "계정과목과 거래처를 검토하세요." });
    return { snapshotDate: financeCurrentData.asOf, received: financeBankTransactions.length, target: Math.max(0, target), metrics: { sourceCount: financeBankTransactions.length, targetCount: target, distinct, unclassified }, problems };
  }
  if (sourceId.startsWith("ecount-finance-")) {
    const year = sourceId.endsWith("2024") ? "2024" : "2025";
    const row = financeHistoricalData.years[year];
    if (row.transactionDebit !== row.transactionCredit) problems.push({ key: "trial-balance", type: "AMOUNT_MISMATCH", severity: "CRITICAL", title: `${year}년 차대변 불일치`, detail: `${Math.abs(row.transactionDebit - row.transactionCredit).toLocaleString("ko-KR")}원 차이`, sourceAmount: row.transactionDebit, targetAmount: row.transactionCredit, suggestedAction: "합계잔액시산표와 계정별 원장을 다시 대사하세요." });
    return { snapshotDate: `${year}-12-31`, received: 1, target: 1, metrics: row, problems };
  }
  if (sourceId === "hiworks-employees") {
    const target = await safeCount("SELECT COUNT(*) AS count FROM hr_employee_records");
    const duplicate = await safeCount("SELECT COUNT(*) AS count FROM (SELECT LOWER(email) FROM hr_employee_records WHERE TRIM(email) <> '' GROUP BY LOWER(email) HAVING COUNT(*) > 1)");
    if (target < 0) problems.push({ key: "target-missing", type: "MISSING", severity: "HIGH", title: "인사기록 원장 미생성", detail: "D1 인사기록 원장을 찾을 수 없습니다.", suggestedAction: "인사기록카드에서 승인된 임직원 데이터를 반영하세요." });
    else if (target !== companyEmployees.length) problems.push({ key: "count-mismatch", type: "MISSING", severity: "HIGH", title: "임직원 건수 불일치", detail: `파일 ${companyEmployees.length}명 · D1 ${target}명`, sourceAmount: companyEmployees.length, targetAmount: target, suggestedAction: "입·퇴사 및 누락 인원을 확인하세요." });
    if (duplicate > 0) problems.push({ key: "duplicate-email", type: "DUPLICATE", severity: "HIGH", title: "임직원 이메일 중복", detail: `${duplicate}개 이메일 그룹`, suggestedAction: "동일 이메일을 사용한 인사기록을 확인하세요." });
    return { snapshotDate: financeCurrentData.asOf, received: companyEmployees.length, target: Math.max(0, target), metrics: { sourceCount: companyEmployees.length, targetCount: target, duplicateEmailGroups: duplicate }, problems };
  }
  const target = await safeCount("SELECT COUNT(*) AS count FROM hr_payroll_records");
  const duplicate = await safeCount("SELECT COUNT(*) AS count FROM (SELECT source_sheet, source_row FROM hr_payroll_records GROUP BY source_sheet, source_row HAVING COUNT(*) > 1)");
  if (target < 0) problems.push({ key: "target-missing", type: "MISSING", severity: "CRITICAL", title: "급여 원장 미생성", detail: "D1 급여 원장을 찾을 수 없습니다.", suggestedAction: "급여관리에서 승인된 급여 파일을 반영하세요." });
  else if (target !== payrollSeedRecords.length) problems.push({ key: "count-mismatch", type: "MISSING", severity: "HIGH", title: "급여 행 수 불일치", detail: `파일 ${payrollSeedRecords.length}건 · D1 ${target}건`, sourceAmount: payrollSeedRecords.length, targetAmount: target, suggestedAction: "월·직원별 누락 행을 확인하세요." });
  if (duplicate > 0) problems.push({ key: "duplicate-source-row", type: "DUPLICATE", severity: "CRITICAL", title: "급여 원본 행 중복", detail: `${duplicate}개 원본 행`, suggestedAction: "중복 급여 지급 여부를 확인하세요." });
  return { snapshotDate: financeCurrentData.asOf.slice(0, 7), received: payrollSeedRecords.length, target: Math.max(0, target), metrics: { sourceCount: payrollSeedRecords.length, targetCount: target, duplicateSourceRows: duplicate }, problems };
}

async function evaluate(sourceId: string, actor: string, retryOf = "") {
  const source = await db.prepare("SELECT * FROM erp_integration_sources WHERE id=? AND enabled=1").bind(sourceId).first<Record<string, unknown>>();
  if (!source) throw new Error("활성화된 연동 원천을 찾을 수 없습니다.");
  const result = await observed(sourceId);
  const checksum = await sha256({ sourceId, snapshotDate: result.snapshotDate, metrics: result.metrics });
  const idempotencyKey = retryOf ? `${result.snapshotDate}:${checksum}:retry:${retryOf}` : `${result.snapshotDate}:${checksum}`;
  if (!retryOf) {
    const existing = await db.prepare("SELECT id FROM erp_sync_runs WHERE source_id=? AND run_type='RECONCILIATION' AND idempotency_key=?").bind(sourceId, idempotencyKey).first<{ id: string }>();
    if (existing) return existing.id;
  }
  const now = Date.now(); const runId = crypto.randomUUID();
  const status = result.problems.length ? "NEEDS_REVIEW" : "SUCCEEDED";
  await db.prepare(`INSERT INTO erp_sync_runs (id, source, scope, snapshot_date, status, record_count, metrics_json,
    error_message, started_at, completed_at, created_at, source_id, run_type, trigger_type, idempotency_key,
    source_checksum, received_count, inserted_count, updated_count, duplicate_count, rejected_count, review_count,
    requested_by, retry_of_run_id, report_json, correlation_id, review_status)
    VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, 'RECONCILIATION', ?, ?, ?, ?, 0, 0, ?, 0, ?, ?, ?, ?, ?, ?)`)
    .bind(runId, String(source.system_type), String(source.scope), result.snapshotDate, status, result.target,
      JSON.stringify(result.metrics), now, now, now, sourceId, retryOf ? "RETRY" : "MANUAL", idempotencyKey,
      checksum, result.received, result.problems.filter((p) => p.type === "DUPLICATE").length,
      result.problems.length, actor, retryOf, JSON.stringify({ automaticWrites: 0, externalFetch: false }),
      crypto.randomUUID(), result.problems.length ? "PENDING" : "NOT_REQUIRED").run();
  for (const problem of result.problems) await db.prepare(`INSERT INTO erp_integration_exceptions
    (id, run_id, source_id, exception_key, exception_type, severity, title, detail, source_amount,
      target_amount, difference_amount, status, suggested_action, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`)
    .bind(crypto.randomUUID(), runId, sourceId, problem.key, problem.type, problem.severity, problem.title,
      problem.detail, problem.sourceAmount ?? 0, problem.targetAmount ?? 0,
      (problem.sourceAmount ?? 0) - (problem.targetAmount ?? 0), problem.suggestedAction, now, now).run();
  await db.prepare(`INSERT INTO erp_sync_run_events (id, run_id, action, from_status, to_status,
    actor_employee_id, note, snapshot_json, created_at) VALUES (?, ?, ?, '', ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), runId, retryOf ? "RETRY" : "EVALUATE", status, actor,
      "ERP 스냅샷 재검증. 외부 원천 조회 및 운영 데이터 덮어쓰기 없음.", JSON.stringify(result.metrics), now).run();
  return runId;
}

async function syncAttentionTask() {
  const risk = await db.prepare(`SELECT COUNT(*) AS count FROM erp_integration_exceptions
    WHERE status IN ('OPEN','IN_REVIEW') AND severity IN ('HIGH','CRITICAL')`).first<{ count: number }>();
  const count = Number(risk?.count ?? 0); const now = Date.now(); const today = new Date().toISOString().slice(0, 10);
  if (count) await db.prepare(`INSERT INTO erp_tasks (id,module,category,title,description,owner_employee_id,due_date,status,priority,destination,source_type,source_id,created_at,updated_at)
    VALUES ('integration-center-attention','operations','데이터 연동',?,?, 'gc.kim',?,'OPEN','HIGH','settings:data-integration','SYSTEM_RULE',?,?,?)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,due_date=excluded.due_date,
      source_id=excluded.source_id,status=CASE WHEN erp_tasks.status='DONE' THEN 'OPEN' ELSE erp_tasks.status END,
      completed_at=NULL,deleted_at=NULL,updated_at=excluded.updated_at`)
    .bind(`데이터 연동 고위험 예외 ${count}건 확인`, "원천과 ERP 스냅샷의 누락·중복·불일치를 검토해 주세요.", today, String(count), now, now).run();
  else await db.prepare("UPDATE erp_tasks SET status='DONE',completed_at=COALESCE(completed_at,?),updated_at=? WHERE id='integration-center-attention' AND status<>'DONE'").bind(now, now).run();
}

async function view() {
  const [sources, runs, exceptions, employees] = await Promise.all([
    db.prepare(`SELECT source.*, (SELECT status FROM erp_sync_runs run WHERE run.source_id=source.id ORDER BY run.created_at DESC LIMIT 1) AS last_status,
      (SELECT snapshot_date FROM erp_sync_runs run WHERE run.source_id=source.id ORDER BY run.created_at DESC LIMIT 1) AS last_snapshot_date,
      (SELECT created_at FROM erp_sync_runs run WHERE run.source_id=source.id ORDER BY run.created_at DESC LIMIT 1) AS last_run_at,
      (SELECT COUNT(*) FROM erp_integration_exceptions exception WHERE exception.source_id=source.id AND exception.status IN ('OPEN','IN_REVIEW')) AS open_exception_count
      FROM erp_integration_sources source ORDER BY source.category, source.name`).all(),
    db.prepare(`SELECT * FROM erp_sync_runs WHERE source_id<>'' ORDER BY created_at DESC LIMIT 80`).all(),
    db.prepare(`SELECT * FROM erp_integration_exceptions ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END, created_at DESC LIMIT 120`).all(),
    db.prepare("SELECT employee_id,name,department FROM hr_employee_records WHERE status='재직' ORDER BY name").all().catch(() => ({ results: companyEmployees.map((employee) => ({ employee_id: employee.id, name: employee.name, department: employee.department })) })),
  ]);
  const open = exceptions.results.filter((item) => ["OPEN", "IN_REVIEW"].includes(String((item as Record<string, unknown>).status)));
  return { sources: sources.results, runs: runs.results.map((row) => ({ ...row, status: (row as Record<string, unknown>).status === "SUCCESS" ? "SUCCEEDED" : (row as Record<string, unknown>).status })), exceptions: exceptions.results, employees: employees.results,
    summary: { totalSources: sources.results.length, healthySources: sources.results.filter((row) => (row as Record<string, unknown>).last_status === "SUCCEEDED").length,
      attentionSources: sources.results.filter((row) => ["NEEDS_REVIEW", "FAILED"].includes(String((row as Record<string, unknown>).last_status))).length,
      openHighExceptions: open.filter((row) => ["HIGH", "CRITICAL"].includes(String((row as Record<string, unknown>).severity))).length },
    controls: { externalFetch: false, automaticOverwrite: false, automaticDelete: false, evaluationLabel: "현재 ERP 스냅샷 검증" } };
}

export async function GET() {
  const auth = await authorizeErpRequest(db, "settings", "admin"); if (auth.response) return auth.response;
  await ensureDataIntegrationSchema(db); await seedSources(); await syncAttentionTask();
  return Response.json({ principal: auth.principal, ...(await view()) });
}

export async function POST(request: Request) {
  const auth = await authorizeErpRequest(db, "settings", "admin"); if (auth.response) return auth.response;
  await ensureDataIntegrationSchema(db); await seedSources();
  const body = await request.json() as Record<string, unknown>; const action = String(body.action ?? "");
  try {
    if (action === "EVALUATE_SOURCE") await evaluate(String(body.sourceId ?? ""), auth.principal.employeeId);
    else if (action === "REFRESH_ALL") for (const source of sourceDefinitions) await evaluate(source.id, auth.principal.employeeId);
    else if (action === "RETRY_RUN") {
      const run = await db.prepare("SELECT id,source_id FROM erp_sync_runs WHERE id=?").bind(String(body.runId ?? "")).first<{ id: string; source_id: string }>();
      if (!run) return Response.json({ error: "재시도할 실행 이력을 찾을 수 없습니다." }, { status: 404 });
      await evaluate(run.source_id, auth.principal.employeeId, run.id);
    } else if (["ASSIGN_EXCEPTION", "RESOLVE_EXCEPTION", "ACCEPT_RISK"].includes(action)) {
      const id = String(body.exceptionId ?? ""); const note = String(body.note ?? "").trim(); const owner = String(body.ownerEmployeeId ?? "");
      const before = await db.prepare("SELECT * FROM erp_integration_exceptions WHERE id=?").bind(id).first<Record<string, unknown>>();
      if (!before) return Response.json({ error: "예외를 찾을 수 없습니다." }, { status: 404 });
      if (action !== "ASSIGN_EXCEPTION" && note.length < 5) return Response.json({ error: "검토 근거를 5자 이상 입력해 주세요." }, { status: 400 });
      const status = action === "ASSIGN_EXCEPTION" ? "IN_REVIEW" : action === "RESOLVE_EXCEPTION" ? "RESOLVED" : "ACCEPTED_RISK"; const now = Date.now();
      await db.prepare(`UPDATE erp_integration_exceptions SET status=?,owner_employee_id=?,resolution_note=?,resolved_by=?,resolved_at=?,updated_at=? WHERE id=?`)
        .bind(status, owner || String(before.owner_employee_id ?? ""), note, action === "ASSIGN_EXCEPTION" ? "" : auth.principal.employeeId, action === "ASSIGN_EXCEPTION" ? null : now, now, id).run();
      await db.prepare(`INSERT INTO erp_sync_run_events (id,run_id,action,from_status,to_status,actor_employee_id,note,snapshot_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
        .bind(crypto.randomUUID(), String(before.run_id), action, String(before.status), status, auth.principal.employeeId, note, JSON.stringify({ exceptionId: id, owner }), now).run();
      const remaining = await db.prepare("SELECT COUNT(*) AS count FROM erp_integration_exceptions WHERE run_id=? AND status IN ('OPEN','IN_REVIEW')").bind(String(before.run_id)).first<{ count: number }>();
      if (!Number(remaining?.count ?? 0)) await db.prepare("UPDATE erp_sync_runs SET review_status='REVIEWED',reviewed_by=?,reviewed_at=? WHERE id=?").bind(auth.principal.employeeId, now, String(before.run_id)).run();
    } else if (action === "UPDATE_SOURCE") {
      const id = String(body.sourceId ?? ""); const cadence = String(body.expectedCadence ?? "ON_DEMAND"); const freshness = Math.max(0, Math.min(8760, Number(body.freshnessHours ?? 0))); const enabled = body.enabled === false ? 0 : 1; const owner = String(body.ownerEmployeeId ?? "");
      await db.prepare("UPDATE erp_integration_sources SET expected_cadence=?,freshness_hours=?,enabled=?,owner_employee_id=?,updated_at=? WHERE id=?").bind(cadence, freshness, enabled, owner, Date.now(), id).run();
    } else return Response.json({ error: "지원하지 않는 연동 작업입니다." }, { status: 400 });
    await syncAttentionTask();
    await writeErpAudit(db, { principal: auth.principal, module: "settings", action, entityType: "DATA_INTEGRATION", entityId: String(body.sourceId ?? body.runId ?? body.exceptionId ?? "all"), reason: String(body.note ?? "") });
    return Response.json({ principal: auth.principal, ...(await view()) });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "연동 검증을 완료하지 못했습니다." }, { status: 500 }); }
}
