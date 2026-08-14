import { env } from "cloudflare:workers";
import { approvalTypeLabels, defaultApprovalRoute, isApprovalType, type ApprovalModule } from "../../approval-engine";
import { authorizeErpRequest, safeJson, writeErpAudit, type ErpRole } from "../../erp-platform";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;

type PolicyRow = {
  id: string; module: ApprovalModule; request_type: string; name: string; min_amount: number;
  max_amount: number | null; priority: number; active: number; created_by: string; created_at: number; updated_at: number;
};
type PolicyStepRow = {
  id: string; policy_id: string; step_order: number; step_name: string; approver_role: ErpRole;
  approver_employee_id: string; created_at: number; updated_at: number;
};
type DelegationRow = {
  id: string; delegator_employee_id: string; delegate_employee_id: string; module: string;
  starts_on: string; ends_on: string; reason: string; active: number; created_by: string; created_at: number; updated_at: number;
};
type AccessRow = { employee_id: string; roles_json: string };

const modules = new Set<ApprovalModule>(["finance", "hr", "recruitment", "sales"]);
const delegationModules = new Set(["all", ...modules]);
const moduleApproverRoles: Record<ApprovalModule, Set<ErpRole>> = {
  finance: new Set(["FINANCE_ADMIN", "SUPER_ADMIN"]),
  hr: new Set(["HR_ADMIN", "SUPER_ADMIN"]),
  recruitment: new Set(["HR_ADMIN", "SUPER_ADMIN"]),
  sales: new Set(["SALES_ADMIN", "SUPER_ADMIN"]),
};

const toPolicy = (row: PolicyRow, steps: PolicyStepRow[]) => ({
  id: row.id, module: row.module, requestType: row.request_type, name: row.name,
  minAmount: row.min_amount, maxAmount: row.max_amount, priority: row.priority, active: Boolean(row.active),
  createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  steps: steps.filter((step) => step.policy_id === row.id).map((step) => ({
    id: step.id, stepOrder: step.step_order, stepName: step.step_name,
    approverRole: step.approver_role, approverEmployeeId: step.approver_employee_id,
  })),
});

const toDelegation = (row: DelegationRow) => ({
  id: row.id, delegatorEmployeeId: row.delegator_employee_id, delegateEmployeeId: row.delegate_employee_id,
  module: row.module, startsOn: row.starts_on, endsOn: row.ends_on, reason: row.reason,
  active: Boolean(row.active), createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
});

export async function GET() {
  const authorization = await authorizeErpRequest(db, "settings", "admin");
  if (authorization.response) return authorization.response;
  const [policies, steps, delegations, users] = await Promise.all([
    db.prepare("SELECT * FROM erp_approval_policies WHERE active = 1 ORDER BY module, request_type, min_amount, priority DESC").all<PolicyRow>(),
    db.prepare("SELECT * FROM erp_approval_policy_steps ORDER BY policy_id, step_order").all<PolicyStepRow>(),
    db.prepare("SELECT * FROM erp_approval_delegations WHERE active = 1 ORDER BY starts_on DESC, created_at DESC").all<DelegationRow>(),
    db.prepare("SELECT employee_id, roles_json FROM erp_user_access WHERE active = 1 ORDER BY created_at").all<AccessRow>(),
  ]);
  const defaults = Object.entries(approvalTypeLabels).flatMap(([module, types]) => Object.entries(types).map(([requestType, label]) => ({
    module, requestType, label,
    steps: defaultApprovalRoute(module as ApprovalModule, requestType).map((step, index) => ({ stepOrder: index + 1, stepName: step.name, approverRole: step.role })),
  })));
  return Response.json({
    policies: policies.results.map((row) => toPolicy(row, steps.results)),
    delegations: delegations.results.map(toDelegation),
    users: users.results.map((row) => ({ employeeId: row.employee_id, roles: safeJson<ErpRole[]>(row.roles_json, []) })),
    types: approvalTypeLabels,
    defaults,
  });
}

export async function POST(request: Request) {
  const authorization = await authorizeErpRequest(db, "settings", "admin");
  if (authorization.response) return authorization.response;
  const body = await request.json() as Record<string, unknown>;
  const resource = String(body.resource ?? "");
  const now = Date.now();

  if (resource === "policy") {
    const id = String(body.id ?? "").trim() || crypto.randomUUID();
    const moduleName = String(body.module ?? "") as ApprovalModule;
    const requestType = String(body.requestType ?? "");
    const name = String(body.name ?? "").trim().slice(0, 80);
    const minAmount = Number(body.minAmount ?? 0);
    const maxAmount = body.maxAmount === "" || body.maxAmount === null || body.maxAmount === undefined ? null : Number(body.maxAmount);
    const priority = Number(body.priority ?? 0);
    const rawSteps = Array.isArray(body.steps) ? body.steps : [];
    if (!modules.has(moduleName) || !isApprovalType(moduleName, requestType) || !name || !Number.isSafeInteger(minAmount) || minAmount < 0
      || (maxAmount !== null && (!Number.isSafeInteger(maxAmount) || maxAmount < minAmount))
      || !Number.isInteger(priority) || priority < 0 || priority > 999 || rawSteps.length < 1 || rawSteps.length > 3) {
      return Response.json({ error: "결재 규칙의 업무·유형·금액 범위·우선순위·결재 단계를 확인해 주세요." }, { status: 400 });
    }
    const activeUsers = await db.prepare("SELECT employee_id, roles_json FROM erp_user_access WHERE active = 1").all<AccessRow>();
    const activeRoleMap = new Map(activeUsers.results.map((user) => [user.employee_id, safeJson<ErpRole[]>(user.roles_json, [])]));
    const normalizedSteps = rawSteps.map((value, index) => {
      const step = value && typeof value === "object" ? value as Record<string, unknown> : {};
      return {
        stepOrder: index + 1,
        stepName: String(step.stepName ?? "").trim().slice(0, 50),
        approverRole: String(step.approverRole ?? "") as ErpRole,
        approverEmployeeId: String(step.approverEmployeeId ?? "").trim(),
      };
    });
    if (normalizedSteps.some((step) => {
      const explicitRoles = step.approverEmployeeId ? activeRoleMap.get(step.approverEmployeeId) : undefined;
      return !step.stepName || !moduleApproverRoles[moduleName].has(step.approverRole)
        || (step.approverEmployeeId && (!explicitRoles || (!explicitRoles.includes(step.approverRole) && !explicitRoles.includes("SUPER_ADMIN"))));
    })) {
      return Response.json({ error: "각 단계의 이름과 승인 역할을 입력하고, 지정 결재자는 활성 ERP 사용자 중에서 선택해 주세요." }, { status: 400 });
    }
    const overlap = await db.prepare(`SELECT id FROM erp_approval_policies WHERE module = ? AND request_type = ?
      AND active = 1 AND id <> ? AND (max_amount IS NULL OR max_amount >= ?)
      AND (? IS NULL OR min_amount <= ?) LIMIT 1`)
      .bind(moduleName, requestType, id, minAmount, maxAmount, maxAmount).first<{ id: string }>();
    if (overlap) return Response.json({ error: "같은 결재 유형에 겹치는 금액 구간이 이미 있습니다." }, { status: 409 });
    const before = await db.prepare("SELECT * FROM erp_approval_policies WHERE id = ?").bind(id).first<PolicyRow>();
    const statements = [
      db.prepare(`INSERT INTO erp_approval_policies
        (id, module, request_type, name, min_amount, max_amount, priority, active, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET module = excluded.module, request_type = excluded.request_type,
          name = excluded.name, min_amount = excluded.min_amount, max_amount = excluded.max_amount,
          priority = excluded.priority, active = 1, updated_at = excluded.updated_at`)
        .bind(id, moduleName, requestType, name, minAmount, maxAmount, priority, authorization.principal.employeeId, before?.created_at ?? now, now),
      db.prepare("DELETE FROM erp_approval_policy_steps WHERE policy_id = ?").bind(id),
      ...normalizedSteps.map((step) => db.prepare(`INSERT INTO erp_approval_policy_steps
        (id, policy_id, step_order, step_name, approver_role, approver_employee_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), id, step.stepOrder, step.stepName, step.approverRole, step.approverEmployeeId, now, now)),
    ];
    await db.batch(statements);
    const after = { id, module: moduleName, requestType, name, minAmount, maxAmount, priority, active: true, steps: normalizedSteps };
    await writeErpAudit(db, { principal: authorization.principal, module: "settings", action: before ? "UPDATE_APPROVAL_POLICY" : "CREATE_APPROVAL_POLICY", entityType: "APPROVAL_POLICY", entityId: id, before, after });
    return Response.json({ policy: after }, { status: before ? 200 : 201 });
  }

  if (resource === "delegation") {
    const id = crypto.randomUUID();
    const delegatorEmployeeId = String(body.delegatorEmployeeId ?? "").trim();
    const delegateEmployeeId = String(body.delegateEmployeeId ?? "").trim();
    const moduleName = String(body.module ?? "all");
    const startsOn = String(body.startsOn ?? "");
    const endsOn = String(body.endsOn ?? "");
    const reason = String(body.reason ?? "").trim().slice(0, 500);
    if (!delegatorEmployeeId || !delegateEmployeeId || delegatorEmployeeId === delegateEmployeeId || !delegationModules.has(moduleName)
      || !/^\d{4}-\d{2}-\d{2}$/.test(startsOn) || !/^\d{4}-\d{2}-\d{2}$/.test(endsOn) || startsOn > endsOn || !reason) {
      return Response.json({ error: "원 결재자·대결자·업무 범위·기간·사유를 확인해 주세요." }, { status: 400 });
    }
    const activeUsers = await db.prepare("SELECT employee_id FROM erp_user_access WHERE active = 1 AND employee_id IN (?, ?)")
      .bind(delegatorEmployeeId, delegateEmployeeId).all<{ employee_id: string }>();
    if (activeUsers.results.length !== 2) return Response.json({ error: "원 결재자와 대결자 모두 활성 ERP 사용자여야 합니다." }, { status: 400 });
    const overlap = await db.prepare(`SELECT id FROM erp_approval_delegations WHERE delegator_employee_id = ? AND active = 1
      AND (module = ? OR module = 'all' OR ? = 'all') AND NOT (ends_on < ? OR starts_on > ?) LIMIT 1`)
      .bind(delegatorEmployeeId, moduleName, moduleName, startsOn, endsOn).first<{ id: string }>();
    if (overlap) return Response.json({ error: "같은 결재자의 기간과 업무 범위가 겹치는 대결 설정이 있습니다." }, { status: 409 });
    await db.prepare(`INSERT INTO erp_approval_delegations
      (id, delegator_employee_id, delegate_employee_id, module, starts_on, ends_on, reason, active, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`)
      .bind(id, delegatorEmployeeId, delegateEmployeeId, moduleName, startsOn, endsOn, reason, authorization.principal.employeeId, now, now).run();
    const after = { id, delegatorEmployeeId, delegateEmployeeId, module: moduleName, startsOn, endsOn, reason, active: true };
    await writeErpAudit(db, { principal: authorization.principal, module: "settings", action: "CREATE_APPROVAL_DELEGATION", entityType: "APPROVAL_DELEGATION", entityId: id, after });
    return Response.json({ delegation: after }, { status: 201 });
  }
  return Response.json({ error: "지원하지 않는 결재 설정입니다." }, { status: 400 });
}

export async function DELETE(request: Request) {
  const authorization = await authorizeErpRequest(db, "settings", "admin");
  if (authorization.response) return authorization.response;
  const body = await request.json() as Record<string, unknown>;
  const resource = String(body.resource ?? "");
  const id = String(body.id ?? "").trim();
  if (!id || !["policy", "delegation"].includes(resource)) return Response.json({ error: "삭제할 설정을 확인해 주세요." }, { status: 400 });
  const table = resource === "policy" ? "erp_approval_policies" : "erp_approval_delegations";
  const before = await db.prepare(`SELECT * FROM ${table} WHERE id = ? AND active = 1`).bind(id).first<Record<string, unknown>>();
  if (!before) return Response.json({ error: "활성 설정을 찾을 수 없습니다." }, { status: 404 });
  const now = Date.now();
  await db.prepare(`UPDATE ${table} SET active = 0, updated_at = ? WHERE id = ? AND active = 1`).bind(now, id).run();
  await writeErpAudit(db, {
    principal: authorization.principal, module: "settings",
    action: resource === "policy" ? "DISABLE_APPROVAL_POLICY" : "DISABLE_APPROVAL_DELEGATION",
    entityType: resource === "policy" ? "APPROVAL_POLICY" : "APPROVAL_DELEGATION", entityId: id,
    before, after: { active: false, updatedAt: now }, reason: String(body.reason ?? ""),
  });
  return Response.json({ id, active: false });
}
