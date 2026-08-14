import type { ErpPrincipal, ErpRole } from "./erp-platform";

export type ApprovalModule = "finance" | "hr" | "recruitment" | "sales";
export type ApprovalPriority = "LOW" | "NORMAL" | "HIGH" | "CRITICAL";

export type ApprovalCreateInput = {
  module: ApprovalModule;
  requestType: string;
  title: string;
  description?: string;
  targetEntityType?: string;
  targetEntityId?: string;
  amount?: number;
  currency?: string;
  priority?: ApprovalPriority;
  dueDate?: string;
  metadata?: Record<string, unknown>;
};

type ApprovalRouteStep = { name: string; role: ErpRole };
type AccessRow = { employee_id: string; roles_json: string };

export const approvalTypeLabels: Record<ApprovalModule, Record<string, string>> = {
  finance: { EXPENSE: "지출 승인", BUDGET: "예산 승인", CLOSE: "월마감 승인", PAYMENT: "지급 승인" },
  hr: { LEAVE_REQUEST: "휴가 승인", PERSONNEL_ACTION: "인사발령 승인", PAYROLL_RUN: "급여 승인", RETIREMENT: "퇴직 승인" },
  recruitment: { OFFER: "채용 제안 승인", DIRECT_INTERVIEW: "면접 직접등록 승인" },
  sales: { QUOTE: "견적 승인", ORDER: "수주 승인", DELIVERY: "납품 승인", INVOICE: "청구 승인", PAYMENT: "수금 승인", SPECIAL_INCENTIVE: "특별 인센티브 승인", DISCOUNT: "할인 승인" },
};

export function isApprovalType(module: ApprovalModule, requestType: string) {
  return Object.prototype.hasOwnProperty.call(approvalTypeLabels[module], requestType);
}

function routeFor(input: ApprovalCreateInput): ApprovalRouteStep[] {
  if (input.module === "finance") {
    if (input.requestType === "CLOSE") return [{ name: "재무 검토", role: "FINANCE_ADMIN" }, { name: "대표 승인", role: "SUPER_ADMIN" }];
    return [{ name: "재무 검토", role: "FINANCE_ADMIN" }, { name: "대표 승인", role: "SUPER_ADMIN" }];
  }
  if (input.module === "hr") {
    if (input.requestType === "LEAVE_REQUEST") return [{ name: "인사 승인", role: "HR_ADMIN" }];
    return [{ name: "인사 검토", role: "HR_ADMIN" }, { name: "대표 승인", role: "SUPER_ADMIN" }];
  }
  if (input.module === "recruitment") {
    return [{ name: "인사 검토", role: "HR_ADMIN" }, { name: "대표 승인", role: "SUPER_ADMIN" }];
  }
  if (input.requestType === "QUOTE" && (input.amount ?? 0) < 10_000_000) {
    return [{ name: "영업 승인", role: "SALES_ADMIN" }];
  }
  return [{ name: "영업 검토", role: "SALES_ADMIN" }, { name: "대표 승인", role: "SUPER_ADMIN" }];
}

function parseRoles(value: string): ErpRole[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((role): role is ErpRole => typeof role === "string") : [];
  } catch {
    return [];
  }
}

async function resolveApprovers(db: D1Database, steps: ApprovalRouteStep[], requesterEmployeeId: string) {
  const access = await db.prepare(`SELECT employee_id, roles_json FROM erp_user_access
    WHERE active = 1 ORDER BY CASE WHEN employee_id = ? THEN 1 ELSE 0 END, created_at ASC`)
    .bind(requesterEmployeeId).all<AccessRow>();
  return steps.map((step) => {
    const exact = access.results.find((row) => parseRoles(row.roles_json).includes(step.role));
    const superAdmin = access.results.find((row) => parseRoles(row.roles_json).includes("SUPER_ADMIN"));
    return { ...step, employeeId: exact?.employee_id ?? superAdmin?.employee_id ?? "" };
  });
}

export async function createApprovalRequest(db: D1Database, principal: ErpPrincipal, input: ApprovalCreateInput) {
  if (!isApprovalType(input.module, input.requestType)) throw new Error("지원하지 않는 결재 유형입니다.");
  const route = await resolveApprovers(db, routeFor(input), principal.employeeId);
  if (route.some((step) => !step.employeeId)) throw new Error("결재선에 필요한 승인 권한 사용자가 없습니다.");

  const now = Date.now();
  const id = crypto.randomUUID();
  const amount = Math.max(0, Math.round(input.amount ?? 0));
  const priority = input.priority ?? "NORMAL";
  const dueDate = input.dueDate ?? "";
  const statements = [
    db.prepare(`INSERT INTO erp_approval_requests
      (id, module, request_type, title, description, requester_employee_id, target_entity_type,
        target_entity_id, amount, currency, priority, status, current_step, due_date, metadata_json,
        version, transition_token, submitted_at, decided_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', 1, ?, ?, 1, '', ?, NULL, ?, ?)`)
      .bind(id, input.module, input.requestType, input.title, input.description ?? "", principal.employeeId,
        input.targetEntityType ?? "", input.targetEntityId ?? "", amount, input.currency ?? "KRW", priority,
        dueDate, JSON.stringify(input.metadata ?? {}), now, now, now),
    db.prepare(`INSERT INTO erp_approval_events
      (id, request_id, step_order, action, actor_employee_id, comment, snapshot_json, created_at)
      VALUES (?, ?, 0, 'SUBMITTED', ?, '', ?, ?)`)
      .bind(crypto.randomUUID(), id, principal.employeeId, JSON.stringify({ module: input.module, requestType: input.requestType, title: input.title, route }), now),
  ];
  route.forEach((step, index) => statements.push(db.prepare(`INSERT INTO erp_approval_steps
    (id, request_id, step_order, step_name, approver_role, approver_employee_id, status,
      comment, acted_by, acted_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, '', '', NULL, ?, ?)`)
    .bind(crypto.randomUUID(), id, index + 1, step.name, step.role, step.employeeId, index === 0 ? "PENDING" : "WAITING", now, now)));
  statements.push(db.prepare(`INSERT INTO erp_tasks
    (id, module, category, title, description, owner_employee_id, due_date, status, priority,
      destination, source_type, source_id, created_at, updated_at)
    VALUES (?, ?, '전자결재', ?, ?, ?, ?, 'OPEN', ?, 'approval:center', 'APPROVAL', ?, ?, ?)`)
    .bind(`approval:${id}:1`, input.module, input.title, `${approvalTypeLabels[input.module][input.requestType]} · ${route[0].name}`,
      route[0].employeeId, dueDate, priority, id, now, now));
  await db.batch(statements);
  return { id, status: "SUBMITTED", currentStep: 1, version: 1, route };
}

export function buildApprovalOutcomeStatements(db: D1Database, targetEntityType: string, targetEntityId: string, approved: boolean, actorEmployeeId: string, now: number, requestId: string, transitionToken: string) {
  if (!targetEntityType || !targetEntityId) return [];
  if (targetEntityType === "HR_LEAVE") {
    return [db.prepare(`UPDATE hr_leave_requests SET status = ?, approver_employee_id = ?, decided_at = ?, updated_at = ? WHERE id = ?
      AND EXISTS (SELECT 1 FROM erp_approval_requests WHERE id = ? AND transition_token = ?)`)
      .bind(approved ? "APPROVED" : "REJECTED", actorEmployeeId, now, now, targetEntityId, requestId, transitionToken)];
  } else if (targetEntityType === "HR_PERSONNEL_ACTION") {
    const statements = [db.prepare(`UPDATE hr_personnel_actions SET status = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?
      AND EXISTS (SELECT 1 FROM erp_approval_requests WHERE id = ? AND transition_token = ?)`)
      .bind(approved ? "APPROVED" : "REJECTED", approved ? actorEmployeeId : "", approved ? now : null, now, targetEntityId, requestId, transitionToken)];
    if (approved) {
      statements.push(db.prepare(`UPDATE hr_employee_records SET
        department = COALESCE(NULLIF((SELECT json_extract(after_json, '$.department') FROM hr_personnel_actions WHERE id = ?), ''), department),
        position = COALESCE(NULLIF((SELECT json_extract(after_json, '$.position') FROM hr_personnel_actions WHERE id = ?), ''), position),
        history_json = json_insert(CASE WHEN json_valid(history_json) THEN history_json ELSE '[]' END, '$[#]',
          json((SELECT json_object('date', replace(effective_date, '-', '.'), 'type', action_type, 'detail', reason)
            FROM hr_personnel_actions WHERE id = ?))),
        updated_at = ?
        WHERE employee_id = (SELECT employee_id FROM hr_personnel_actions WHERE id = ?)
          AND EXISTS (SELECT 1 FROM erp_approval_requests WHERE id = ? AND transition_token = ?)`)
        .bind(targetEntityId, targetEntityId, targetEntityId, now, targetEntityId, requestId, transitionToken));
    }
    return statements;
  } else if (targetEntityType === "PAYROLL_RUN") {
    return [db.prepare(`UPDATE hr_payroll_runs SET status = ?, approved_by = ?, updated_at = ? WHERE period = ?
      AND EXISTS (SELECT 1 FROM erp_approval_requests WHERE id = ? AND transition_token = ?)`)
      .bind(approved ? "APPROVED" : "REVIEW", approved ? actorEmployeeId : "", now, targetEntityId, requestId, transitionToken)];
  } else if (targetEntityType === "FINANCE_BUDGET") {
    return [db.prepare(`UPDATE finance_budgets SET status = ?, approved_by = ?, updated_at = ? WHERE id = ?
      AND EXISTS (SELECT 1 FROM erp_approval_requests WHERE id = ? AND transition_token = ?)`)
      .bind(approved ? "APPROVED" : "DRAFT", approved ? actorEmployeeId : "", now, targetEntityId, requestId, transitionToken)];
  } else if (targetEntityType === "FINANCE_CLOSE") {
    return [db.prepare(`UPDATE finance_close_tasks SET status = ?, approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ?
      AND EXISTS (SELECT 1 FROM erp_approval_requests WHERE id = ? AND transition_token = ?)`)
      .bind(approved ? "APPROVED" : "OPEN", approved ? actorEmployeeId : "", approved ? now : null, now, targetEntityId, requestId, transitionToken)];
  } else if (targetEntityType === "SALES_DOCUMENT") {
    return [db.prepare(`UPDATE sales_documents SET status = ?, updated_at = ? WHERE id = ?
      AND EXISTS (SELECT 1 FROM erp_approval_requests WHERE id = ? AND transition_token = ?)`)
      .bind(approved ? "ACCEPTED" : "DRAFT", now, targetEntityId, requestId, transitionToken)];
  }
  return [];
}
