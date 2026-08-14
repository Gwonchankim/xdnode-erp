import { env } from "cloudflare:workers";
import { authorizeErpRequest, writeErpAudit } from "../../erp-platform";
import { ensureMasterImpactCaseSchema, MasterImpactError, reassessMasterImpact, type MasterImpactAction, type MasterImpactEntityType } from "../../master-impact";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;

type CaseRow = {
  id: string; assessment_id: string; entity_type: MasterImpactEntityType; entity_id: string; action: MasterImpactAction;
  entity_label: string; impact_code: string; impact_label: string; impact_detail: string; severity: string;
  initial_count: number; current_count: number; initial_amount: number; current_amount: number; status: string;
  owner_employee_id: string; owner_name: string; due_date: string; resolution_note: string; evidence_ref: string;
  last_rechecked_by: string; last_rechecked_at: number | null; created_by: string; version: number;
  created_at: number; updated_at: number; closed_by: string; closed_at: number | null;
};
type EventRow = { id: string; case_id: string; action: string; actor_employee_id: string; from_status: string; to_status: string; note: string; snapshot_json: string; created_at: number };

const statuses = new Set(["ALL", "OPEN", "IN_PROGRESS", "VERIFIED", "CLOSED"]);
const today = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

function safeJson(value: string) { try { return JSON.parse(value) as unknown; } catch { return {}; } }
function eventView(row: EventRow) { return { id: row.id, caseId: row.case_id, action: row.action, actorEmployeeId: row.actor_employee_id, fromStatus: row.from_status, toStatus: row.to_status, note: row.note, snapshot: safeJson(row.snapshot_json), createdAt: row.created_at }; }
function caseView(row: CaseRow, events: EventRow[], currentDate: string) {
  return {
    id: row.id, assessmentId: row.assessment_id, entityType: row.entity_type, entityId: row.entity_id,
    entityLabel: row.entity_label, action: row.action, impactCode: row.impact_code, impactLabel: row.impact_label,
    impactDetail: row.impact_detail, severity: row.severity, initialCount: row.initial_count, currentCount: row.current_count,
    initialAmount: row.initial_amount, currentAmount: row.current_amount, status: row.status,
    ownerEmployeeId: row.owner_employee_id, ownerName: row.owner_name || row.owner_employee_id, dueDate: row.due_date,
    resolutionNote: row.resolution_note, evidenceRef: row.evidence_ref, lastRecheckedBy: row.last_rechecked_by,
    lastRecheckedAt: row.last_rechecked_at, createdBy: row.created_by, version: row.version,
    createdAt: row.created_at, updatedAt: row.updated_at, closedBy: row.closed_by, closedAt: row.closed_at,
    isOverdue: row.status !== "CLOSED" && Boolean(row.due_date) && row.due_date < currentDate,
    events: events.filter((event) => event.case_id === row.id).map(eventView),
  };
}

async function responseState(status = "ALL", query = "") {
  const conditions = ["1 = 1"]; const bindings: unknown[] = [];
  if (status !== "ALL") { conditions.push("impact.status = ?"); bindings.push(status); }
  if (query) { conditions.push("(lower(assessment.entity_label) LIKE ? OR lower(impact.impact_label) LIKE ? OR lower(employee.name) LIKE ?)"); const term = `%${query.toLowerCase()}%`; bindings.push(term, term, term); }
  const [caseResult, employees, eventResult] = await Promise.all([
    db.prepare(`SELECT impact.*, assessment.entity_label, COALESCE(employee.name, '') AS owner_name
      FROM erp_master_impact_cases impact JOIN erp_master_impact_assessments assessment ON assessment.id = impact.assessment_id
      LEFT JOIN hr_employee_records employee ON employee.employee_id = impact.owner_employee_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY CASE impact.status WHEN 'OPEN' THEN 1 WHEN 'IN_PROGRESS' THEN 2 WHEN 'VERIFIED' THEN 3 ELSE 4 END,
        CASE WHEN impact.due_date <> '' THEN impact.due_date ELSE '9999-12-31' END, impact.updated_at DESC LIMIT 250`).bind(...bindings).all<CaseRow>(),
    db.prepare("SELECT employee_id, name, department FROM hr_employee_records WHERE status NOT IN ('퇴직','입사 예정') ORDER BY name")
      .all<{ employee_id: string; name: string; department: string }>(),
    db.prepare("SELECT * FROM erp_master_impact_case_events ORDER BY created_at DESC LIMIT 1000").all<EventRow>(),
  ]);
  const all = await db.prepare("SELECT status, due_date FROM erp_master_impact_cases").all<{ status: string; due_date: string }>();
  const currentDate = today(); const active = all.results.filter((item) => item.status !== "CLOSED");
  return {
    summary: { active: active.length, open: active.filter((item) => item.status === "OPEN").length,
      inProgress: active.filter((item) => item.status === "IN_PROGRESS").length,
      verified: active.filter((item) => item.status === "VERIFIED").length,
      overdue: active.filter((item) => item.due_date && item.due_date < currentDate).length },
    cases: caseResult.results.map((row) => caseView(row, eventResult.results, currentDate)),
    employees: employees.results.map((employee) => ({ id: employee.employee_id, name: employee.name, department: employee.department })),
    controls: { automaticResolution: false, companyEmployeesOnly: true, recheckRequired: true, evidenceRequired: true },
  };
}

export async function GET(request: Request) {
  await ensureMasterImpactCaseSchema(db);
  const authorization = await authorizeErpRequest(db, "settings", "admin");
  if (authorization.response) return authorization.response;
  const params = new URL(request.url).searchParams; const status = String(params.get("status") ?? "ALL").toUpperCase();
  if (!statuses.has(status)) return Response.json({ error: "지원하지 않는 상태 필터입니다." }, { status: 400 });
  return Response.json(await responseState(status, String(params.get("q") ?? "").trim().slice(0, 100)));
}

export async function POST(request: Request) {
  await ensureMasterImpactCaseSchema(db);
  const authorization = await authorizeErpRequest(db, "settings", "admin");
  if (authorization.response) return authorization.response;
  const body = await request.json() as Record<string, unknown>; const action = String(body.action ?? "").toUpperCase();
  const id = String(body.id ?? "").trim(); const expectedVersion = Math.round(Number(body.expectedVersion));
  const before = await db.prepare(`SELECT impact.*, assessment.entity_label, COALESCE(employee.name, '') AS owner_name
    FROM erp_master_impact_cases impact JOIN erp_master_impact_assessments assessment ON assessment.id = impact.assessment_id
    LEFT JOIN hr_employee_records employee ON employee.employee_id = impact.owner_employee_id WHERE impact.id = ?`).bind(id).first<CaseRow>();
  if (!before) return Response.json({ error: "영향 해결 업무를 찾을 수 없습니다." }, { status: 404 });
  if (!Number.isInteger(expectedVersion) || expectedVersion !== before.version) return Response.json({ error: "다른 사용자가 먼저 수정했습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
  const now = Date.now(); let nextStatus = before.status; let note = ""; let snapshot: Record<string, unknown> = {};
  let update: D1PreparedStatement;

  if (action === "ASSIGN") {
    if (before.status === "CLOSED") return Response.json({ error: "종결된 업무는 다시 배정할 수 없습니다." }, { status: 409 });
    const ownerEmployeeId = String(body.ownerEmployeeId ?? "").trim(); const dueDate = String(body.dueDate ?? "").trim();
    const employee = await db.prepare("SELECT employee_id FROM hr_employee_records WHERE employee_id = ? AND status NOT IN ('퇴직','입사 예정')").bind(ownerEmployeeId).first();
    if (!employee || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || dueDate < today()) return Response.json({ error: "재직 중인 담당자와 오늘 이후의 기한을 선택해 주세요." }, { status: 400 });
    note = `담당 ${ownerEmployeeId} · 기한 ${dueDate}`;
    update = db.prepare("UPDATE erp_master_impact_cases SET owner_employee_id = ?, due_date = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?")
      .bind(ownerEmployeeId, dueDate, now, id, expectedVersion);
    snapshot = { ownerEmployeeId, dueDate };
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
  const requestedStatus = String(body.statusFilter ?? "ALL").toUpperCase();
  const responseStatus = statuses.has(requestedStatus) ? requestedStatus : "ALL";
  return Response.json(await responseState(responseStatus, String(body.query ?? "").trim().slice(0, 100)));
}
