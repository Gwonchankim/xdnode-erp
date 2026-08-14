import { env } from "cloudflare:workers";
import { authorizeErpRequest, writeErpAudit, type ErpPrincipal } from "../../erp-platform";
import { ensureMasterImpactCaseSchema, getMasterImpactSlaPolicy, MasterImpactError, reassessMasterImpact, type MasterImpactAction, type MasterImpactEntityType, type MasterImpactSlaPolicy } from "../../master-impact";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;

type CaseRow = {
  id: string; assessment_id: string; entity_type: MasterImpactEntityType; entity_id: string; action: MasterImpactAction;
  entity_label: string; impact_code: string; impact_label: string; impact_detail: string; severity: string;
  initial_count: number; current_count: number; initial_amount: number; current_amount: number; status: string;
  owner_employee_id: string; owner_name: string; owner_department: string; manager_name: string; due_date: string;
  resolution_note: string; evidence_ref: string; last_rechecked_by: string; last_rechecked_at: number | null;
  created_by: string; version: number; escalation_level: number; escalated_at: number | null;
  created_at: number; updated_at: number; closed_by: string; closed_at: number | null;
};
type EventRow = { id: string; case_id: string; action: string; actor_employee_id: string; from_status: string; to_status: string; note: string; snapshot_json: string; created_at: number };
type WeeklyReportRow = { id: string; week_start: string; week_end: string; version: number; active_count: number; overdue_count: number; manager_escalated_count: number; executive_escalated_count: number; checksum: string; created_by: string; created_at: number };

const statuses = new Set(["ALL", "OPEN", "IN_PROGRESS", "VERIFIED", "CLOSED"]);
const today = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const caseSelect = `SELECT impact.*, assessment.entity_label, COALESCE(employee.name, '') AS owner_name,
  COALESCE(employee.department, '') AS owner_department, COALESCE(employee.manager, '') AS manager_name
  FROM erp_master_impact_cases impact JOIN erp_master_impact_assessments assessment ON assessment.id = impact.assessment_id
  LEFT JOIN hr_employee_records employee ON employee.employee_id = impact.owner_employee_id`;

function safeJson(value: string) { try { return JSON.parse(value) as unknown; } catch { return {}; } }
function eventView(row: EventRow) { return { id: row.id, caseId: row.case_id, action: row.action, actorEmployeeId: row.actor_employee_id, fromStatus: row.from_status, toStatus: row.to_status, note: row.note, snapshot: safeJson(row.snapshot_json), createdAt: row.created_at }; }
function dateNumber(value: string) { return Date.parse(`${value}T00:00:00Z`); }
function overdueDays(dueDate: string, currentDate: string) { return dueDate && dueDate < currentDate ? Math.max(1, Math.round((dateNumber(currentDate) - dateNumber(dueDate)) / 86_400_000)) : 0; }
function addDays(value: string, days: number) { const date = new Date(`${value}T00:00:00Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); }
function weekBounds(value: string) { const date = new Date(`${value}T00:00:00Z`); const offset = (date.getUTCDay() + 6) % 7; const start = addDays(value, -offset); return { start, end: addDays(start, 6) }; }
async function checksum(value: unknown) { const bytes = new TextEncoder().encode(JSON.stringify(value)); const digest = await crypto.subtle.digest("SHA-256", bytes); return Array.from(new Uint8Array(digest)).map((item) => item.toString(16).padStart(2, "0")).join(""); }

function caseView(row: CaseRow, events: EventRow[], currentDate: string) {
  return {
    id: row.id, assessmentId: row.assessment_id, entityType: row.entity_type, entityId: row.entity_id,
    entityLabel: row.entity_label, action: row.action, impactCode: row.impact_code, impactLabel: row.impact_label,
    impactDetail: row.impact_detail, severity: row.severity, initialCount: row.initial_count, currentCount: row.current_count,
    initialAmount: row.initial_amount, currentAmount: row.current_amount, status: row.status,
    ownerEmployeeId: row.owner_employee_id, ownerName: row.owner_name || row.owner_employee_id,
    ownerDepartment: row.owner_department, managerName: row.manager_name, dueDate: row.due_date,
    resolutionNote: row.resolution_note, evidenceRef: row.evidence_ref, lastRecheckedBy: row.last_rechecked_by,
    lastRecheckedAt: row.last_rechecked_at, createdBy: row.created_by, version: row.version,
    escalationLevel: row.escalation_level, escalatedAt: row.escalated_at,
    createdAt: row.created_at, updatedAt: row.updated_at, closedBy: row.closed_by, closedAt: row.closed_at,
    isOverdue: row.status !== "CLOSED" && Boolean(row.due_date) && row.due_date < currentDate,
    overdueDays: row.status === "CLOSED" ? 0 : overdueDays(row.due_date, currentDate),
    events: events.filter((event) => event.case_id === row.id).map(eventView),
  };
}

function managerRollup(rows: CaseRow[], currentDate: string) {
  const groups = new Map<string, { managerName: string; active: number; overdue: number; managerEscalated: number; executiveEscalated: number }>();
  for (const row of rows.filter((item) => item.status !== "CLOSED")) {
    const key = row.manager_name || "조직장 미지정"; const group = groups.get(key) ?? { managerName: key, active: 0, overdue: 0, managerEscalated: 0, executiveEscalated: 0 };
    group.active += 1; if (row.due_date && row.due_date < currentDate) group.overdue += 1;
    if (row.escalation_level >= 1) group.managerEscalated += 1; if (row.escalation_level >= 2) group.executiveEscalated += 1; groups.set(key, group);
  }
  return Array.from(groups.values()).sort((a, b) => b.executiveEscalated - a.executiveEscalated || b.overdue - a.overdue || a.managerName.localeCompare(b.managerName, "ko"));
}

async function refreshEscalations(policy: MasterImpactSlaPolicy, principal: ErpPrincipal) {
  const currentDate = today();
  const rows = await db.prepare("SELECT id, status, due_date, escalation_level, owner_employee_id FROM erp_master_impact_cases WHERE status <> 'CLOSED' AND due_date <> ''")
    .all<{ id: string; status: string; due_date: string; escalation_level: number; owner_employee_id: string }>();
  const changed: Array<{ id: string; from: number; to: number; overdueDays: number }> = []; const now = Date.now();
  for (const row of rows.results) {
    const late = overdueDays(row.due_date, currentDate);
    const target = late >= policy.executiveEscalationDays ? 2 : late >= policy.managerEscalationDays ? 1 : 0;
    if (target <= row.escalation_level) continue;
    const label = target === 2 ? "경영 책임자 확인 단계" : "조직장 확인 단계";
    const [updated] = await db.batch([
      db.prepare("UPDATE erp_master_impact_cases SET escalation_level = ?, escalated_at = ?, updated_at = ? WHERE id = ? AND escalation_level < ?")
        .bind(target, now, now, row.id, target),
      db.prepare(`INSERT OR IGNORE INTO erp_master_impact_case_events
        (id, case_id, action, actor_employee_id, from_status, to_status, note, snapshot_json, created_at)
        SELECT ?, id, 'SLA_ESCALATED', 'SYSTEM:SLA', status, status, ?, ?, ?
        FROM erp_master_impact_cases WHERE id = ? AND escalation_level = ? AND escalated_at = ?`)
        .bind(`master-impact-sla:${row.id}:${target}`, `${label} · 기한 ${late}일 경과`, JSON.stringify({ level: target, overdueDays: late, policyVersion: policy.version }), now, row.id, target, now),
      db.prepare("UPDATE erp_tasks SET priority = 'CRITICAL', updated_at = ? WHERE id = ? AND source_type = 'MASTER_IMPACT_CASE'")
        .bind(now, `master-impact:${row.id}`),
    ]);
    if (!updated.meta.changes) continue;
    changed.push({ id: row.id, from: row.escalation_level, to: target, overdueDays: late });
  }
  if (changed.length) await writeErpAudit(db, { principal, module: "settings", action: "MASTER_IMPACT_SLA_ESCALATION", entityType: "masterImpactCase", entityId: "SLA", after: changed, reason: "기준정보 영향 업무 SLA 자동 계산" });
  return changed;
}

async function responseState(status = "ALL", query = "") {
  const conditions = ["1 = 1"]; const bindings: unknown[] = [];
  if (status !== "ALL") { conditions.push("impact.status = ?"); bindings.push(status); }
  if (query) { conditions.push("(lower(assessment.entity_label) LIKE ? OR lower(impact.impact_label) LIKE ? OR lower(employee.name) LIKE ? OR lower(employee.department) LIKE ? OR lower(employee.manager) LIKE ?)"); const term = `%${query.toLowerCase()}%`; bindings.push(term, term, term, term, term); }
  const [caseResult, allCases, employees, eventResult, reports, policy] = await Promise.all([
    db.prepare(`${caseSelect} WHERE ${conditions.join(" AND ")}
      ORDER BY impact.escalation_level DESC, CASE impact.status WHEN 'OPEN' THEN 1 WHEN 'IN_PROGRESS' THEN 2 WHEN 'VERIFIED' THEN 3 ELSE 4 END,
        CASE WHEN impact.due_date <> '' THEN impact.due_date ELSE '9999-12-31' END, impact.updated_at DESC LIMIT 250`).bind(...bindings).all<CaseRow>(),
    db.prepare(`${caseSelect} ORDER BY impact.updated_at DESC`).all<CaseRow>(),
    db.prepare("SELECT employee_id, name, department FROM hr_employee_records WHERE status NOT IN ('퇴직','입사 예정') ORDER BY name")
      .all<{ employee_id: string; name: string; department: string }>(),
    db.prepare("SELECT * FROM erp_master_impact_case_events ORDER BY created_at DESC LIMIT 1500").all<EventRow>(),
    db.prepare("SELECT id, week_start, week_end, version, active_count, overdue_count, manager_escalated_count, executive_escalated_count, checksum, created_by, created_at FROM erp_master_impact_weekly_reports ORDER BY created_at DESC LIMIT 8").all<WeeklyReportRow>(),
    getMasterImpactSlaPolicy(db),
  ]);
  const currentDate = today(); const active = allCases.results.filter((item) => item.status !== "CLOSED");
  return {
    summary: { active: active.length, open: active.filter((item) => item.status === "OPEN").length,
      inProgress: active.filter((item) => item.status === "IN_PROGRESS").length,
      verified: active.filter((item) => item.status === "VERIFIED").length,
      overdue: active.filter((item) => item.due_date && item.due_date < currentDate).length,
      managerEscalated: active.filter((item) => item.escalation_level >= 1).length,
      executiveEscalated: active.filter((item) => item.escalation_level >= 2).length },
    cases: caseResult.results.map((row) => caseView(row, eventResult.results, currentDate)),
    employees: employees.results.map((employee) => ({ id: employee.employee_id, name: employee.name, department: employee.department })),
    managerSummary: managerRollup(allCases.results, currentDate), policy,
    weeklyReports: reports.results.map((row) => ({ id: row.id, weekStart: row.week_start, weekEnd: row.week_end, version: row.version,
      activeCount: row.active_count, overdueCount: row.overdue_count, managerEscalatedCount: row.manager_escalated_count,
      executiveEscalatedCount: row.executive_escalated_count, checksum: row.checksum, createdBy: row.created_by, createdAt: row.created_at })),
    controls: { automaticResolution: false, automaticReassignment: false, retrospectiveDueDateChange: false, companyEmployeesOnly: true, recheckRequired: true, evidenceRequired: true },
  };
}

async function createWeeklyReport(principal: ErpPrincipal, policy: MasterImpactSlaPolicy) {
  const currentDate = today(); const bounds = weekBounds(currentDate);
  const rows = await db.prepare(`${caseSelect} WHERE impact.status <> 'CLOSED' ORDER BY impact.escalation_level DESC, impact.due_date, impact.id`).all<CaseRow>();
  const active = rows.results; const overdue = active.filter((row) => row.due_date && row.due_date < currentDate).length;
  const snapshot = { asOf: currentDate, weekStart: bounds.start, weekEnd: bounds.end, policy,
    summary: { active: active.length, overdue, managerEscalated: active.filter((row) => row.escalation_level >= 1).length, executiveEscalated: active.filter((row) => row.escalation_level >= 2).length },
    managers: managerRollup(active, currentDate), cases: active.map((row) => ({ id: row.id, entityType: row.entity_type, entityLabel: row.entity_label,
      impactCode: row.impact_code, impactLabel: row.impact_label, currentCount: row.current_count, currentAmount: row.current_amount,
      status: row.status, ownerEmployeeId: row.owner_employee_id, ownerName: row.owner_name, managerName: row.manager_name,
      dueDate: row.due_date, overdueDays: overdueDays(row.due_date, currentDate), escalationLevel: row.escalation_level })) };
  const hash = await checksum(snapshot); const id = crypto.randomUUID(); const now = Date.now();
  await db.prepare(`INSERT INTO erp_master_impact_weekly_reports
    (id, week_start, week_end, version, active_count, overdue_count, manager_escalated_count, executive_escalated_count, snapshot_json, checksum, created_by, created_at)
    VALUES (?, ?, ?, (SELECT COALESCE(MAX(version), 0) + 1 FROM erp_master_impact_weekly_reports WHERE week_start = ?), ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, bounds.start, bounds.end, bounds.start, snapshot.summary.active, snapshot.summary.overdue, snapshot.summary.managerEscalated,
      snapshot.summary.executiveEscalated, JSON.stringify(snapshot), hash, principal.employeeId, now).run();
  const created = await db.prepare("SELECT version FROM erp_master_impact_weekly_reports WHERE id = ?").bind(id).first<{ version: number }>();
  await writeErpAudit(db, { principal, module: "settings", action: "MASTER_IMPACT_WEEKLY_REPORT_CREATED", entityType: "masterImpactWeeklyReport", entityId: id, after: { ...snapshot.summary, weekStart: bounds.start, version: created?.version ?? 1, checksum: hash }, reason: "기준정보 영향 주간 스냅샷 저장" });
}

function responseFilter(body: Record<string, unknown>) { const requested = String(body.statusFilter ?? "ALL").toUpperCase(); return { status: statuses.has(requested) ? requested : "ALL", query: String(body.query ?? "").trim().slice(0, 100) }; }

export async function GET(request: Request) {
  await ensureMasterImpactCaseSchema(db);
  const authorization = await authorizeErpRequest(db, "settings", "admin");
  if (authorization.response) return authorization.response;
  const params = new URL(request.url).searchParams; const status = String(params.get("status") ?? "ALL").toUpperCase();
  if (!statuses.has(status)) return Response.json({ error: "지원하지 않는 상태 필터입니다." }, { status: 400 });
  const policy = await getMasterImpactSlaPolicy(db); await refreshEscalations(policy, authorization.principal);
  return Response.json(await responseState(status, String(params.get("q") ?? "").trim().slice(0, 100)));
}

export async function POST(request: Request) {
  await ensureMasterImpactCaseSchema(db);
  const authorization = await authorizeErpRequest(db, "settings", "admin");
  if (authorization.response) return authorization.response;
  const body = await request.json() as Record<string, unknown>; const action = String(body.action ?? "").toUpperCase(); const filter = responseFilter(body);

  if (action === "UPDATE_SLA_POLICY") {
    const before = await getMasterImpactSlaPolicy(db); const expectedVersion = Math.round(Number(body.expectedPolicyVersion));
    const defaultDueDays = Math.round(Number(body.defaultDueDays)); const managerEscalationDays = Math.round(Number(body.managerEscalationDays));
    const executiveEscalationDays = Math.round(Number(body.executiveEscalationDays));
    if (expectedVersion !== before.version) return Response.json({ error: "다른 사용자가 SLA 정책을 먼저 수정했습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
    if (!Number.isInteger(defaultDueDays) || defaultDueDays < 1 || defaultDueDays > 30 || !Number.isInteger(managerEscalationDays) || managerEscalationDays < 1 || managerEscalationDays > 14 || !Number.isInteger(executiveEscalationDays) || executiveEscalationDays <= managerEscalationDays || executiveEscalationDays > 30) {
      return Response.json({ error: "기본 처리기한은 1~30일, 조직장 확인은 1~14일, 경영 책임자 확인은 조직장 단계보다 늦고 30일 이내여야 합니다." }, { status: 400 });
    }
    const now = Date.now(); const updated = await db.prepare(`UPDATE erp_master_impact_sla_policies SET default_due_days = ?, manager_escalation_days = ?,
      executive_escalation_days = ?, version = version + 1, updated_by = ?, updated_at = ? WHERE id = 'default' AND version = ?`)
      .bind(defaultDueDays, managerEscalationDays, executiveEscalationDays, authorization.principal.employeeId, now, expectedVersion).run();
    if (!updated.meta.changes) return Response.json({ error: "다른 사용자가 SLA 정책을 먼저 수정했습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
    const after = await getMasterImpactSlaPolicy(db); await writeErpAudit(db, { principal: authorization.principal, module: "settings", action: "MASTER_IMPACT_SLA_POLICY_UPDATED", entityType: "masterImpactSlaPolicy", entityId: "default", before, after, reason: "기준정보 영향 처리 SLA 변경" });
    return Response.json(await responseState(filter.status, filter.query));
  }

  const policy = await getMasterImpactSlaPolicy(db); await refreshEscalations(policy, authorization.principal);
  if (action === "CREATE_WEEKLY_REPORT") { await createWeeklyReport(authorization.principal, policy); return Response.json(await responseState(filter.status, filter.query)); }

  const id = String(body.id ?? "").trim(); const expectedVersion = Math.round(Number(body.expectedVersion));
  const before = await db.prepare(`${caseSelect} WHERE impact.id = ?`).bind(id).first<CaseRow>();
  if (!before) return Response.json({ error: "영향 해결 업무를 찾을 수 없습니다." }, { status: 404 });
  if (!Number.isInteger(expectedVersion) || expectedVersion !== before.version) return Response.json({ error: "다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
  const now = Date.now(); let nextStatus = before.status; let note = ""; let snapshot: Record<string, unknown> = {}; let update: D1PreparedStatement;

  if (action === "ASSIGN") {
    if (before.status === "CLOSED") return Response.json({ error: "종결된 업무는 다시 배정할 수 없습니다." }, { status: 409 });
    const ownerEmployeeId = String(body.ownerEmployeeId ?? "").trim(); const dueDate = String(body.dueDate ?? "").trim();
    const employee = await db.prepare("SELECT employee_id FROM hr_employee_records WHERE employee_id = ? AND status NOT IN ('퇴직','입사 예정')").bind(ownerEmployeeId).first();
    if (!employee || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || dueDate < today()) return Response.json({ error: "재직 중인 담당자와 오늘 이후의 기한을 선택해 주세요." }, { status: 400 });
    note = `담당 ${ownerEmployeeId} · 기한 ${dueDate}`; snapshot = { ownerEmployeeId, dueDate, priorEscalationLevel: before.escalation_level };
    update = db.prepare("UPDATE erp_master_impact_cases SET owner_employee_id = ?, due_date = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
      .bind(ownerEmployeeId, dueDate, now, id, expectedVersion);
  } else if (action === "START") {
    if (before.status !== "OPEN") return Response.json({ error: "대기 중인 업무만 진행을 시작할 수 있습니다." }, { status: 409 });
    nextStatus = "IN_PROGRESS"; note = "해결 작업 시작";
    update = db.prepare("UPDATE erp_master_impact_cases SET status = 'IN_PROGRESS', version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND status = 'OPEN'").bind(now, id, expectedVersion);
  } else if (action === "RECHECK") {
    if (before.status === "CLOSED") return Response.json({ error: "종결된 업무는 재검증할 수 없습니다." }, { status: 409 });
    try {
      const report = await reassessMasterImpact(db, before.entity_type, before.entity_id, before.action);
      const entry = report.entries.find((item) => item.code === before.impact_code && item.severity === "BLOCKER");
      const currentCount = entry?.count ?? 0; const currentAmount = entry?.amount ?? 0;
      nextStatus = currentCount === 0 ? "VERIFIED" : before.status === "OPEN" ? "OPEN" : "IN_PROGRESS";
      note = currentCount === 0 ? "원장 재검증 통과 · 차단 연결 0건" : `원장 재검증 미통과 · 차단 연결 ${currentCount}건`;
      snapshot = { currentCount, currentAmount, checksum: report.checksum, recheckedAt: now };
      update = db.prepare(`UPDATE erp_master_impact_cases SET current_count = ?, current_amount = ?, status = ?,
        last_rechecked_by = ?, last_rechecked_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND status <> 'CLOSED'`)
        .bind(currentCount, currentAmount, nextStatus, authorization.principal.employeeId, now, now, id, expectedVersion);
    } catch (error) { if (error instanceof MasterImpactError) return Response.json({ error: error.message }, { status: error.status }); throw error; }
  } else if (action === "CLOSE") {
    if (before.status !== "VERIFIED" || before.current_count !== 0 || !before.last_rechecked_at) return Response.json({ error: "원장 재검증을 통과한 업무만 종결할 수 있습니다." }, { status: 409 });
    const resolutionNote = String(body.resolutionNote ?? "").trim().slice(0, 2000); const evidenceRef = String(body.evidenceRef ?? "").trim().slice(0, 500);
    if (resolutionNote.length < 10 || evidenceRef.length < 3) return Response.json({ error: "10자 이상의 해결 메모와 증빙 참조를 입력해 주세요." }, { status: 400 });
    nextStatus = "CLOSED"; note = resolutionNote; snapshot = { evidenceRef };
    update = db.prepare(`UPDATE erp_master_impact_cases SET status = 'CLOSED', resolution_note = ?, evidence_ref = ?,
      closed_by = ?, closed_at = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ? AND status = 'VERIFIED' AND current_count = 0`)
      .bind(resolutionNote, evidenceRef, authorization.principal.employeeId, now, now, id, expectedVersion);
  } else return Response.json({ error: "지원하지 않는 영향 해결 작업입니다." }, { status: 400 });

  const result = await update.run();
  if (!result.meta.changes) return Response.json({ error: "다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
  const taskStatus = nextStatus === "CLOSED" ? "DONE" : nextStatus === "OPEN" ? "OPEN" : "IN_PROGRESS";
  await db.batch([
    db.prepare(`INSERT INTO erp_master_impact_case_events
      (id, case_id, action, actor_employee_id, from_status, to_status, note, snapshot_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), id, action, authorization.principal.employeeId, before.status, nextStatus, note, JSON.stringify(snapshot), now),
    db.prepare(`UPDATE erp_tasks SET owner_employee_id = (SELECT owner_employee_id FROM erp_master_impact_cases WHERE id = ?),
      due_date = (SELECT due_date FROM erp_master_impact_cases WHERE id = ?), status = ?,
      completed_at = CASE WHEN ? = 'DONE' THEN ? ELSE NULL END, updated_at = ?
      WHERE id = ? AND source_type = 'MASTER_IMPACT_CASE'`).bind(id, id, taskStatus, taskStatus, now, now, `master-impact:${id}`),
  ]);
  const after = await db.prepare("SELECT * FROM erp_master_impact_cases WHERE id = ?").bind(id).first<Record<string, unknown>>();
  await writeErpAudit(db, { principal: authorization.principal, module: "settings", action: `MASTER_IMPACT_CASE_${action}`, entityType: "masterImpactCase", entityId: id, before, after, reason: note });
  return Response.json(await responseState(filter.status, filter.query));
}
