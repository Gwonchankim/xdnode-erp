import { env } from "cloudflare:workers";
import { approvalTypeLabels, buildApprovalOutcomeStatements, createApprovalRequest, isApprovalType, type ApprovalModule, type ApprovalPriority } from "../../approval-engine";
import { authorizeErpRequest, ensureErpPlatformSchema, safeJson, writeErpAudit, type ErpModule } from "../../erp-platform";
import { MasterImpactError, reassessMasterImpact, type MasterImpactAction, type MasterImpactEntityType } from "../../master-impact";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;

type ApprovalRow = {
  id: string; module: ApprovalModule; request_type: string; title: string; description: string;
  requester_employee_id: string; target_entity_type: string; target_entity_id: string;
  amount: number; currency: string; priority: string; status: string; current_step: number;
  due_date: string; metadata_json: string; version: number; submitted_at: number;
  decided_at: number | null; created_at: number; updated_at: number;
};
type StepRow = {
  id: string; request_id: string; step_order: number; step_name: string; approver_role: string;
  approver_employee_id: string; delegated_from_employee_id: string; status: string; comment: string; acted_by: string;
  acted_at: number | null; created_at: number; updated_at: number;
};
type EventRow = { id: string; request_id: string; step_order: number; action: string; actor_employee_id: string; comment: string; snapshot_json: string; created_at: number };

const modules = new Set<ApprovalModule>(["finance", "hr", "recruitment", "sales", "settings"]);
const priorities = new Set<ApprovalPriority>(["LOW", "NORMAL", "HIGH", "CRITICAL"]);
const activeStatuses = ["SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED"];

const toRequest = (row: ApprovalRow) => ({
  id: row.id, module: row.module, requestType: row.request_type,
  typeLabel: approvalTypeLabels[row.module]?.[row.request_type] ?? row.request_type,
  title: row.title, description: row.description, requesterEmployeeId: row.requester_employee_id,
  targetEntityType: row.target_entity_type, targetEntityId: row.target_entity_id,
  amount: row.amount, currency: row.currency, priority: row.priority, status: row.status,
  currentStep: row.current_step, dueDate: row.due_date, metadata: safeJson(row.metadata_json, {}),
  version: row.version, submittedAt: row.submitted_at, decidedAt: row.decided_at,
  createdAt: row.created_at, updatedAt: row.updated_at,
});
const toStep = (row: StepRow) => ({ id: row.id, requestId: row.request_id, stepOrder: row.step_order, stepName: row.step_name, approverRole: row.approver_role, approverEmployeeId: row.approver_employee_id, delegatedFromEmployeeId: row.delegated_from_employee_id, status: row.status, comment: row.comment, actedBy: row.acted_by, actedAt: row.acted_at });
const toEvent = (row: EventRow) => ({ id: row.id, requestId: row.request_id, stepOrder: row.step_order, action: row.action, actorEmployeeId: row.actor_employee_id, comment: row.comment, snapshot: safeJson(row.snapshot_json, {}), createdAt: row.created_at });

export async function GET() {
  const authorization = await authorizeErpRequest(db, "operations", "read");
  if (authorization.response) return authorization.response;
  const principal = authorization.principal;
  const canSeeAll = principal.roles.includes("SUPER_ADMIN");
  const requests = await db.prepare(`SELECT r.* FROM erp_approval_requests r
    WHERE ? = 1 OR r.requester_employee_id = ? OR EXISTS (
      SELECT 1 FROM erp_approval_steps s WHERE s.request_id = r.id AND s.approver_employee_id = ?)
    ORDER BY CASE r.status WHEN 'SUBMITTED' THEN 0 WHEN 'IN_REVIEW' THEN 1 WHEN 'CHANGES_REQUESTED' THEN 2 ELSE 3 END,
      CASE r.priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,
      r.updated_at DESC LIMIT 200`).bind(canSeeAll ? 1 : 0, principal.employeeId, principal.employeeId).all<ApprovalRow>();
  const ids = requests.results.map((item) => item.id);
  if (!ids.length) return Response.json({ principal, summary: { pendingMine: 0, requestedByMe: 0, active: 0, overdueMine: 0 }, requests: [], steps: [], events: [], types: approvalTypeLabels });
  const placeholders = ids.map(() => "?").join(",");
  const [steps, events] = await Promise.all([
    db.prepare(`SELECT * FROM erp_approval_steps WHERE request_id IN (${placeholders}) ORDER BY request_id, step_order`).bind(...ids).all<StepRow>(),
    db.prepare(`SELECT * FROM erp_approval_events WHERE request_id IN (${placeholders}) ORDER BY created_at ASC`).bind(...ids).all<EventRow>(),
  ]);
  const mappedSteps = steps.results.map(toStep);
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const pendingRequestIds = new Set(mappedSteps.filter((step) => step.approverEmployeeId === principal.employeeId && step.status === "PENDING").map((step) => step.requestId));
  return Response.json({
    principal,
    summary: {
      pendingMine: mappedSteps.filter((step) => step.approverEmployeeId === principal.employeeId && step.status === "PENDING").length,
      overdueMine: requests.results.filter((item) => pendingRequestIds.has(item.id) && item.due_date && item.due_date < today).length,
      requestedByMe: requests.results.filter((item) => item.requester_employee_id === principal.employeeId && activeStatuses.includes(item.status)).length,
      active: requests.results.filter((item) => activeStatuses.includes(item.status)).length,
    },
    requests: requests.results.map(toRequest), steps: mappedSteps, events: events.results.map(toEvent), types: approvalTypeLabels,
  });
}

export async function POST(request: Request) {
  await ensureErpPlatformSchema(db);
  const body = await request.json() as Record<string, unknown>;
  const moduleName = String(body.module ?? "") as ApprovalModule;
  const requestType = String(body.requestType ?? "");
  const title = String(body.title ?? "").trim().slice(0, 160);
  const description = String(body.description ?? "").trim().slice(0, 3000);
  const amount = Number(body.amount ?? 0);
  const dueDate = String(body.dueDate ?? "").trim();
  const priority = String(body.priority ?? "NORMAL") as ApprovalPriority;
  if (!modules.has(moduleName) || !isApprovalType(moduleName, requestType) || !title
    || !Number.isFinite(amount) || amount < 0 || !priorities.has(priority)
    || (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate))) {
    return Response.json({ error: "결재 모듈·유형·제목·금액·기한을 확인해 주세요." }, { status: 400 });
  }
  if (moduleName === "settings") return Response.json({ error: "데이터 통제 결재는 해당 원장에서만 제출할 수 있습니다." }, { status: 403 });
  const authorization = await authorizeErpRequest(db, moduleName as ErpModule, "write");
  if (authorization.response) return authorization.response;
  try {
    const created = await createApprovalRequest(db, authorization.principal, {
      module: moduleName, requestType, title, description, amount, priority, dueDate,
      // Generic drafts never bind arbitrary source records. Trusted module routes create linked approvals.
      targetEntityType: "", targetEntityId: "",
      metadata: body.metadata && typeof body.metadata === "object" ? body.metadata as Record<string, unknown> : {},
    });
    await writeErpAudit(db, { principal: authorization.principal, module: moduleName, action: "APPROVAL_SUBMITTED", entityType: "approvalRequest", entityId: created.id, after: { ...created, title, requestType } });
    return Response.json({ request: created }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "결재를 제출하지 못했습니다." }, { status: 409 });
  }
}

export async function PUT(request: Request) {
  await ensureErpPlatformSchema(db);
  const readAuthorization = await authorizeErpRequest(db, "operations", "read");
  if (readAuthorization.response) return readAuthorization.response;
  const body = await request.json() as Record<string, unknown>;
  const id = String(body.id ?? "").trim();
  const action = String(body.action ?? "");
  const expectedVersion = Number(body.version);
  const comment = String(body.comment ?? "").trim().slice(0, 2000);
  if (!id || !Number.isInteger(expectedVersion) || expectedVersion < 1 || !["APPROVE", "REJECT", "REQUEST_CHANGES", "RESUBMIT", "CANCEL"].includes(action)) {
    return Response.json({ error: "결재 ID, 처리 동작, 버전을 확인해 주세요." }, { status: 400 });
  }
  if (["REJECT", "REQUEST_CHANGES", "RESUBMIT"].includes(action) && !comment) return Response.json({ error: "반려·보완 요청·재제출 사유를 입력해 주세요." }, { status: 400 });

  const before = await db.prepare("SELECT * FROM erp_approval_requests WHERE id = ?").bind(id).first<ApprovalRow>();
  if (!before) return Response.json({ error: "결재 문서를 찾을 수 없습니다." }, { status: 404 });
  if (["APPROVED", "REJECTED", "CANCELLED"].includes(before.status)) return Response.json({ error: "이미 종료된 결재입니다." }, { status: 409 });
  if (before.target_entity_type === "MASTER_IMPACT_WEEKLY_REPORT" && ["REQUEST_CHANGES", "RESUBMIT", "CANCEL"].includes(action)) {
    return Response.json({ error: "불변 주간보고는 보완 재제출하거나 취소할 수 없습니다. 승인 또는 반려 후 새 스냅샷 버전을 생성해 주세요." }, { status: 409 });
  }
  const principal = readAuthorization.principal;
  const now = Date.now();
  const transitionToken = crypto.randomUUID();

  if (action === "RESUBMIT") {
    if (before.status !== "CHANGES_REQUESTED") return Response.json({ error: "보완 요청된 결재만 재제출할 수 있습니다." }, { status: 409 });
    if (before.requester_employee_id !== principal.employeeId && !principal.roles.includes("SUPER_ADMIN")) return Response.json({ error: "기안자만 재제출할 수 있습니다." }, { status: 403 });
    const step = await db.prepare(`SELECT * FROM erp_approval_steps WHERE request_id = ? AND step_order = ? AND status = 'CHANGES_REQUESTED'`)
      .bind(id, before.current_step).first<StepRow>();
    if (!step) return Response.json({ error: "재제출할 결재 단계를 찾을 수 없습니다." }, { status: 409 });
    const result = await db.batch([
      db.prepare(`UPDATE erp_approval_requests SET status = 'SUBMITTED', version = version + 1,
        transition_token = ?, updated_at = ? WHERE id = ? AND version = ?`).bind(transitionToken, now, id, expectedVersion),
      db.prepare(`UPDATE erp_approval_steps SET status = 'PENDING', acted_by = '', acted_at = NULL, updated_at = ?
        WHERE request_id = ? AND step_order = ? AND status = 'CHANGES_REQUESTED'
        AND EXISTS (SELECT 1 FROM erp_approval_requests WHERE id = ? AND transition_token = ?)`)
        .bind(now, id, before.current_step, id, transitionToken),
      db.prepare(`INSERT INTO erp_tasks
        (id, module, category, title, description, owner_employee_id, due_date, status, priority,
          destination, source_type, source_id, created_at, updated_at)
        SELECT ?, ?, '전자결재', ?, ?, ?, ?, 'OPEN', ?, 'approval:center', 'APPROVAL', ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM erp_approval_requests WHERE id = ? AND transition_token = ?)
        ON CONFLICT(id) DO UPDATE SET status = 'OPEN', completed_at = NULL, deleted_at = NULL,
          description = excluded.description, owner_employee_id = excluded.owner_employee_id,
          due_date = excluded.due_date, updated_at = excluded.updated_at`)
        .bind(`approval:${id}:${before.current_step}`, before.module, before.title, `${approvalTypeLabels[before.module][before.request_type]} · 재제출`, step.approver_employee_id, before.due_date, before.priority, id, now, now, id, transitionToken),
      db.prepare(`INSERT INTO erp_approval_events (id, request_id, step_order, action, actor_employee_id, comment, snapshot_json, created_at)
        SELECT ?, ?, ?, 'RESUBMITTED', ?, ?, '{}', ? WHERE EXISTS (SELECT 1 FROM erp_approval_requests WHERE id = ? AND transition_token = ?)`)
        .bind(crypto.randomUUID(), id, before.current_step, principal.employeeId, comment, now, id, transitionToken),
    ]);
    if ((result[0].meta.changes ?? 0) === 0) return Response.json({ error: "다른 사용자가 먼저 처리했습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
  } else if (action === "CANCEL") {
    if (before.requester_employee_id !== principal.employeeId && !principal.roles.includes("SUPER_ADMIN")) return Response.json({ error: "기안자만 결재를 취소할 수 있습니다." }, { status: 403 });
    const result = await db.batch([
      db.prepare(`UPDATE erp_approval_requests SET status = 'CANCELLED', decided_at = ?, version = version + 1,
        transition_token = ?, updated_at = ? WHERE id = ? AND version = ?`).bind(now, transitionToken, now, id, expectedVersion),
      db.prepare(`UPDATE erp_approval_steps SET status = 'SKIPPED', updated_at = ? WHERE request_id = ? AND status IN ('PENDING','WAITING')
        AND EXISTS (SELECT 1 FROM erp_approval_requests WHERE id = ? AND transition_token = ?)`).bind(now, id, id, transitionToken),
      db.prepare(`UPDATE erp_tasks SET status = 'DONE', completed_at = ?, updated_at = ? WHERE source_type = 'APPROVAL' AND source_id = ?
        AND EXISTS (SELECT 1 FROM erp_approval_requests WHERE id = ? AND transition_token = ?)`).bind(now, now, id, id, transitionToken),
      db.prepare(`INSERT INTO erp_approval_events (id, request_id, step_order, action, actor_employee_id, comment, snapshot_json, created_at)
        SELECT ?, ?, ?, 'CANCELLED', ?, ?, '{}', ? WHERE EXISTS (SELECT 1 FROM erp_approval_requests WHERE id = ? AND transition_token = ?)`)
        .bind(crypto.randomUUID(), id, before.current_step, principal.employeeId, comment, now, id, transitionToken),
    ]);
    if ((result[0].meta.changes ?? 0) === 0) return Response.json({ error: "다른 사용자가 먼저 처리했습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
  } else {
    const step = await db.prepare(`SELECT * FROM erp_approval_steps WHERE request_id = ? AND step_order = ? AND status = 'PENDING'`)
      .bind(id, before.current_step).first<StepRow>();
    if (!step) return Response.json({ error: "현재 처리할 결재 단계가 없습니다." }, { status: 409 });
    const actingAsDelegate = step.approver_employee_id === principal.employeeId && Boolean(step.delegated_from_employee_id);
    if (!actingAsDelegate) {
      const approval = await authorizeErpRequest(db, before.module as ErpModule, "approve");
      if (approval.response) return approval.response;
    }
    if (step.approver_employee_id !== principal.employeeId && !principal.roles.includes("SUPER_ADMIN")) return Response.json({ error: "현재 단계의 결재자가 아닙니다." }, { status: 403 });
    const next = await db.prepare(`SELECT * FROM erp_approval_steps WHERE request_id = ? AND step_order = ?`).bind(id, before.current_step + 1).first<StepRow>();
    const finalApprove = action === "APPROVE" && !next;
    if (finalApprove && before.target_entity_type === "FINANCE_MASTER_CHANGE") {
      const change = await db.prepare("SELECT target_type, target_id, change_type FROM finance_master_change_requests WHERE id = ? AND status = 'SUBMITTED'")
        .bind(before.target_entity_id).first<{ target_type: string; target_id: string; change_type: string }>();
      if (change && change.change_type !== "CREATE") {
        try {
          const impact = await reassessMasterImpact(db, `FINANCE_${change.target_type}` as MasterImpactEntityType, change.target_id, change.change_type as MasterImpactAction);
          if (impact.blockingCount > 0) return Response.json({ error: `최종 승인 직전 재검증에서 차단 항목 ${impact.blockingCount}건이 확인되었습니다. 원장을 정리한 뒤 새 변경 요청을 제출해 주세요.` }, { status: 409 });
        } catch (error) {
          if (error instanceof MasterImpactError) return Response.json({ error: error.message }, { status: error.status });
          throw error;
        }
      }
    }
    const nextStatus = action === "APPROVE" ? (finalApprove ? "APPROVED" : "IN_REVIEW") : action === "REJECT" ? "REJECTED" : "CHANGES_REQUESTED";
    const nextStep = action === "APPROVE" && next ? next.step_order : before.current_step;
    const decidedAt = ["APPROVED", "REJECTED"].includes(nextStatus) ? now : null;
    const statements = [
      db.prepare(`UPDATE erp_approval_requests SET status = ?, current_step = ?, decided_at = ?, version = version + 1,
        transition_token = ?, updated_at = ? WHERE id = ? AND version = ?`).bind(nextStatus, nextStep, decidedAt, transitionToken, now, id, expectedVersion),
      db.prepare(`UPDATE erp_approval_steps SET status = ?, comment = ?, acted_by = ?, acted_at = ?, updated_at = ?
        WHERE request_id = ? AND step_order = ? AND status = 'PENDING'
        AND EXISTS (SELECT 1 FROM erp_approval_requests WHERE id = ? AND transition_token = ?)`)
        .bind(action === "APPROVE" ? "APPROVED" : action === "REJECT" ? "REJECTED" : "CHANGES_REQUESTED", comment, principal.employeeId, now, now, id, before.current_step, id, transitionToken),
      db.prepare(`UPDATE erp_tasks SET status = 'DONE', completed_at = ?, updated_at = ? WHERE id = ?
        AND EXISTS (SELECT 1 FROM erp_approval_requests WHERE id = ? AND transition_token = ?)`)
        .bind(now, now, `approval:${id}:${before.current_step}`, id, transitionToken),
      db.prepare(`INSERT INTO erp_approval_events (id, request_id, step_order, action, actor_employee_id, comment, snapshot_json, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM erp_approval_requests WHERE id = ? AND transition_token = ?)`)
        .bind(crypto.randomUUID(), id, before.current_step, action, principal.employeeId, comment, JSON.stringify({ from: before.status, to: nextStatus }), now, id, transitionToken),
    ];
    if (action === "APPROVE" && next) {
      statements.push(
        db.prepare(`UPDATE erp_approval_steps SET status = 'PENDING', updated_at = ? WHERE request_id = ? AND step_order = ? AND status = 'WAITING'
          AND EXISTS (SELECT 1 FROM erp_approval_requests WHERE id = ? AND transition_token = ?)`).bind(now, id, next.step_order, id, transitionToken),
        db.prepare(`INSERT OR IGNORE INTO erp_tasks
          (id, module, category, title, description, owner_employee_id, due_date, status, priority,
            destination, source_type, source_id, created_at, updated_at)
          SELECT ?, ?, '전자결재', ?, ?, ?, ?, 'OPEN', ?, 'approval:center', 'APPROVAL', ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM erp_approval_requests WHERE id = ? AND transition_token = ?)`)
          .bind(`approval:${id}:${next.step_order}`, before.module, before.title, `${approvalTypeLabels[before.module][before.request_type]} · ${next.step_name}`, next.approver_employee_id, before.due_date, before.priority, id, now, now, id, transitionToken),
      );
    }
    if (finalApprove || action === "REJECT") {
      statements.push(...buildApprovalOutcomeStatements(db, before.target_entity_type, before.target_entity_id, finalApprove, principal.employeeId, now, id, transitionToken));
    }
    const result = await db.batch(statements);
    if ((result[0].meta.changes ?? 0) === 0) return Response.json({ error: "다른 사용자가 먼저 처리했습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
  }

  const after = await db.prepare("SELECT * FROM erp_approval_requests WHERE id = ?").bind(id).first<ApprovalRow>();
  await writeErpAudit(db, { principal, module: before.module, action: `APPROVAL_${action}`, entityType: "approvalRequest", entityId: id, before: toRequest(before), after: after ? toRequest(after) : null, reason: comment });
  return Response.json({ request: after ? toRequest(after) : null });
}
