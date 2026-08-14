import { env } from "cloudflare:workers";
import { authorizeErpRequest, safeJson, writeErpAudit } from "../../../erp-platform";
import { companyEmployees } from "../../../hr-company-data";
import { ensureFinanceAlertActionSchema } from "../../../finance-alert-actions-server";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;

type CaseStatus = "OPEN" | "IN_PROGRESS" | "REVIEW" | "CLOSED";
type CaseRow = {
  id: string; task_id: string; task_source_id: string; source_destination: string;
  title_snapshot: string; description_snapshot: string; priority_snapshot: string;
  owner_employee_id: string; due_date: string; status: CaseStatus; root_cause: string;
  impact_assessment: string; action_plan: string; resolution_summary: string;
  submitted_by: string; submitted_at: number | null; reviewed_by: string; reviewed_at: number | null;
  review_comment: string; version: number; created_at: number; updated_at: number; closed_at: number | null;
};
type EventRow = { id: string; case_id: string; action: string; actor_employee_id: string; comment: string; snapshot_json: string; created_at: number };
type DocumentRow = { id: string; entity_id: string; category: string; version: number; file_name: string; uploaded_by: string; created_at: number };

const validDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const toCase = (row: CaseRow) => ({
  id: row.id, taskId: row.task_id, taskSourceId: row.task_source_id, sourceDestination: row.source_destination,
  title: row.title_snapshot, description: row.description_snapshot, priority: row.priority_snapshot,
  ownerEmployeeId: row.owner_employee_id, dueDate: row.due_date, status: row.status,
  rootCause: row.root_cause, impactAssessment: row.impact_assessment, actionPlan: row.action_plan,
  resolutionSummary: row.resolution_summary, submittedBy: row.submitted_by, submittedAt: row.submitted_at,
  reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at, reviewComment: row.review_comment,
  version: row.version, createdAt: row.created_at, updatedAt: row.updated_at, closedAt: row.closed_at,
});

async function seedCases() {
  const tasks = await db.prepare(`SELECT id, source_id, destination, title, description, priority,
    owner_employee_id, due_date FROM erp_tasks WHERE module = 'finance' AND source_type = 'SYSTEM_RULE'
    AND status <> 'DONE' AND deleted_at IS NULL`).all<{
      id: string; source_id: string; destination: string; title: string; description: string;
      priority: string; owner_employee_id: string; due_date: string;
    }>();
  const now = Date.now();
  if (tasks.results.length) await db.batch(tasks.results.map((task) => db.prepare(`INSERT OR IGNORE INTO finance_alert_cases
    (id, task_id, task_source_id, source_destination, title_snapshot, description_snapshot,
      priority_snapshot, owner_employee_id, due_date, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)`)
    .bind(crypto.randomUUID(), task.id, task.source_id, task.destination, task.title, task.description,
      task.priority, task.owner_employee_id, task.due_date, now, now)));
}

async function loadCase(id: string) {
  return db.prepare("SELECT * FROM finance_alert_cases WHERE id = ?").bind(id).first<CaseRow>();
}

async function evidenceCount(caseId: string) {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM erp_documents
    WHERE module = 'finance' AND entity_type = 'financeAlertCase' AND entity_id = ? AND deleted_at IS NULL`)
    .bind(caseId).first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function GET() {
  const authorization = await authorizeErpRequest(db, "finance", "read");
  if (authorization.response) return authorization.response;
  await ensureFinanceAlertActionSchema(db);
  await seedCases();
  const [cases, events, documents] = await Promise.all([
    db.prepare(`SELECT * FROM finance_alert_cases ORDER BY
      CASE status WHEN 'REVIEW' THEN 0 WHEN 'IN_PROGRESS' THEN 1 WHEN 'OPEN' THEN 2 ELSE 3 END,
      CASE priority_snapshot WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END,
      due_date, updated_at DESC LIMIT 100`).all<CaseRow>(),
    db.prepare("SELECT * FROM finance_alert_case_events ORDER BY created_at DESC LIMIT 500").all<EventRow>(),
    db.prepare(`SELECT id, entity_id, category, version, file_name, uploaded_by, created_at FROM erp_documents
      WHERE module = 'finance' AND entity_type = 'financeAlertCase' AND deleted_at IS NULL
      ORDER BY created_at DESC`).all<DocumentRow>(),
  ]);
  return Response.json({
    principal: authorization.principal,
    cases: cases.results.map((row) => ({
      ...toCase(row),
      events: events.results.filter((event) => event.case_id === row.id).map((event) => ({
        id: event.id, action: event.action, actorEmployeeId: event.actor_employee_id,
        comment: event.comment, snapshot: safeJson(event.snapshot_json, {}), createdAt: event.created_at,
      })),
      documents: documents.results.filter((document) => document.entity_id === row.id).map((document) => ({
        id: document.id, category: document.category, version: document.version, fileName: document.file_name,
        uploadedBy: document.uploaded_by, createdAt: document.created_at,
        downloadUrl: `/api/documents?downloadId=${encodeURIComponent(document.id)}`,
      })),
    })),
  });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return Response.json({ error: "조치 요청을 읽을 수 없습니다." }, { status: 400 }); }
  const action = typeof body.action === "string" ? body.action.toUpperCase() : "";
  const permission = ["APPROVE", "REJECT", "REOPEN"].includes(action) ? "approve" : "write";
  const authorization = await authorizeErpRequest(db, "finance", permission);
  if (authorization.response) return authorization.response;
  await ensureFinanceAlertActionSchema(db);
  const caseId = typeof body.caseId === "string" ? body.caseId.trim() : "";
  const before = caseId ? await loadCase(caseId) : null;
  if (!before) return Response.json({ error: "조치 사례를 찾을 수 없습니다." }, { status: 404 });
  const version = Number(body.version);
  if (!Number.isInteger(version) || version !== before.version) return Response.json({ error: "다른 사용자가 먼저 변경했습니다. 최신 내용을 다시 불러와 주세요." }, { status: 409 });
  const now = Date.now();
  let eventAction = action;
  let eventComment = "";
  let nextStatus: CaseStatus = before.status;
  let updateSql = "";
  let updateBindings: unknown[] = [];

  if (action === "SAVE" || action === "SUBMIT") {
    if (before.status === "CLOSED" || before.status === "REVIEW") return Response.json({ error: "검토 중이거나 종료된 조치 사례는 수정할 수 없습니다." }, { status: 409 });
    const ownerEmployeeId = typeof body.ownerEmployeeId === "string" ? body.ownerEmployeeId.trim() : "";
    const dueDate = typeof body.dueDate === "string" ? body.dueDate.trim() : "";
    const rootCause = typeof body.rootCause === "string" ? body.rootCause.trim().slice(0, 2000) : "";
    const impactAssessment = typeof body.impactAssessment === "string" ? body.impactAssessment.trim().slice(0, 2000) : "";
    const actionPlan = typeof body.actionPlan === "string" ? body.actionPlan.trim().slice(0, 3000) : "";
    if (!companyEmployees.some((employee) => employee.id === ownerEmployeeId) || !validDate(dueDate)) {
      return Response.json({ error: "회사 구성원 담당자와 유효한 조치기한을 입력해 주세요." }, { status: 400 });
    }
    if (action === "SUBMIT" && (rootCause.length < 5 || impactAssessment.length < 5 || actionPlan.length < 5)) {
      return Response.json({ error: "원인·영향·조치계획을 각각 5자 이상 작성해 주세요." }, { status: 400 });
    }
    if (action === "SUBMIT" && await evidenceCount(caseId) < 1) {
      return Response.json({ error: "검토 요청 전 근거자료를 1개 이상 첨부해 주세요." }, { status: 409 });
    }
    nextStatus = action === "SUBMIT" ? "REVIEW" : "IN_PROGRESS";
    eventAction = action === "SUBMIT" ? "REVIEW_REQUESTED" : "ACTION_SAVED";
    eventComment = typeof body.comment === "string" ? body.comment.trim().slice(0, 500) : "";
    updateSql = `UPDATE finance_alert_cases SET owner_employee_id = ?, due_date = ?, root_cause = ?,
      impact_assessment = ?, action_plan = ?, status = ?, submitted_by = ?, submitted_at = ?,
      review_comment = CASE WHEN ? = 'REVIEW' THEN '' ELSE review_comment END,
      version = version + 1, updated_at = ? WHERE id = ? AND version = ?`;
    updateBindings = [ownerEmployeeId, dueDate, rootCause, impactAssessment, actionPlan, nextStatus,
      action === "SUBMIT" ? authorization.principal.employeeId : before.submitted_by,
      action === "SUBMIT" ? now : before.submitted_at, nextStatus, now, caseId, version];
  } else if (action === "APPROVE") {
    if (before.status !== "REVIEW") return Response.json({ error: "검토 요청 상태에서만 종료 승인할 수 있습니다." }, { status: 409 });
    const resolutionSummary = typeof body.resolutionSummary === "string" ? body.resolutionSummary.trim().slice(0, 2000) : "";
    if (resolutionSummary.length < 5) return Response.json({ error: "종료 판단과 확인 결과를 5자 이상 입력해 주세요." }, { status: 400 });
    if (await evidenceCount(caseId) < 1) return Response.json({ error: "근거자료 없이는 종료할 수 없습니다." }, { status: 409 });
    nextStatus = "CLOSED"; eventAction = "CLOSURE_APPROVED"; eventComment = resolutionSummary;
    updateSql = `UPDATE finance_alert_cases SET status = 'CLOSED', resolution_summary = ?, reviewed_by = ?,
      reviewed_at = ?, review_comment = ?, closed_at = ?, version = version + 1, updated_at = ?
      WHERE id = ? AND version = ?`;
    updateBindings = [resolutionSummary, authorization.principal.employeeId, now, resolutionSummary, now, now, caseId, version];
  } else if (action === "REJECT") {
    if (before.status !== "REVIEW") return Response.json({ error: "검토 요청 상태에서만 보완 요청할 수 있습니다." }, { status: 409 });
    const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 1000) : "";
    if (comment.length < 5) return Response.json({ error: "보완 요청 사유를 5자 이상 입력해 주세요." }, { status: 400 });
    nextStatus = "IN_PROGRESS"; eventAction = "REVIEW_REJECTED"; eventComment = comment;
    updateSql = `UPDATE finance_alert_cases SET status = 'IN_PROGRESS', reviewed_by = ?, reviewed_at = ?,
      review_comment = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`;
    updateBindings = [authorization.principal.employeeId, now, comment, now, caseId, version];
  } else if (action === "REOPEN") {
    if (before.status !== "CLOSED") return Response.json({ error: "종료된 사례만 재개방할 수 있습니다." }, { status: 409 });
    const comment = typeof body.comment === "string" ? body.comment.trim().slice(0, 1000) : "";
    if (comment.length < 5) return Response.json({ error: "재개방 사유를 5자 이상 입력해 주세요." }, { status: 400 });
    nextStatus = "IN_PROGRESS"; eventAction = "CASE_REOPENED"; eventComment = comment;
    updateSql = `UPDATE finance_alert_cases SET status = 'IN_PROGRESS', closed_at = NULL,
      review_comment = ?, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`;
    updateBindings = [comment, now, caseId, version];
  } else return Response.json({ error: "지원하지 않는 조치입니다." }, { status: 400 });

  const [updateResult] = await db.batch([
    db.prepare(updateSql).bind(...updateBindings),
    db.prepare(`INSERT INTO finance_alert_case_events
      (id, case_id, action, actor_employee_id, comment, snapshot_json, created_at)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (
        SELECT 1 FROM finance_alert_cases WHERE id = ? AND version = ?
      )`)
      .bind(crypto.randomUUID(), caseId, eventAction, authorization.principal.employeeId, eventComment,
        JSON.stringify({ from: before.status, to: nextStatus, version: version + 1 }), now, caseId, version + 1),
    db.prepare(`UPDATE erp_tasks SET status = ?, completed_at = ?, updated_at = ?
      WHERE id = ? AND source_id = ? AND EXISTS (
        SELECT 1 FROM finance_alert_cases WHERE id = ? AND version = ?
      )`)
      .bind(nextStatus === "CLOSED" ? "DONE" : nextStatus === "REVIEW" ? "WAITING" : "IN_PROGRESS",
        nextStatus === "CLOSED" ? now : null, now, before.task_id, before.task_source_id, caseId, version + 1),
  ]);
  if (!updateResult.meta.changes) return Response.json({ error: "다른 사용자가 먼저 변경했습니다. 최신 내용을 다시 불러와 주세요." }, { status: 409 });
  const after = await loadCase(caseId);
  await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: eventAction,
    entityType: "financeAlertCase", entityId: caseId, before: toCase(before), after: after ? toCase(after) : null, reason: eventComment });
  return Response.json({ case: after ? toCase(after) : null });
}
