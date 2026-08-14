import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("sensitive ERP APIs enforce role-based authorization and audit writes", async () => {
  const files = await Promise.all([
    read("app/api/finance/operations/route.ts"),
    read("app/api/hr/employee-records/route.ts"),
    read("app/api/hr/recruitment/route.ts"),
    read("app/api/sales/route.ts"),
  ]);
  for (const source of files) assert.match(source, /authorizeErpRequest/);
  for (const source of files) assert.match(source, /writeErpAudit/);
});

test("employee persistence retains lifecycle state across refreshes", async () => {
  const [schema, route, workspace] = await Promise.all([
    read("db/schema.ts"),
    read("app/api/hr/employee-records/route.ts"),
    read("app/hr-workspace.tsx"),
  ]);
  for (const field of ["join_date", "status", "history_json", "retirement_json"]) assert.match(route, new RegExp(field));
  for (const field of ["joinDate", "historyJson", "retirementJson"]) assert.match(schema, new RegExp(field));
  assert.match(workspace, /신규 직원을 인사기록카드에 영구 등록했습니다/);
  assert.match(workspace, /RETIREMENT_CHECKLIST|resource: "retirement"/);
});

test("finance controls distinguish imported bank rows from automated forecasts", async () => {
  const [api, view] = await Promise.all([
    read("app/api/finance/operations/route.ts"),
    read("app/finance-operations-center.tsx"),
  ]);
  assert.match(api, /bankTransactionLines: \(bankTransactionCount\?\.count \?\? 0\) > 0 \? "IMPORTED" : "NOT_CONNECTED"/);
  assert.match(api, /forecast: "AUTOMATED"/);
  assert.match(view, /자동 원장은 좌측 ‘13주 자금예측’에서 계산됩니다/);
  assert.match(view, /좌측 ‘자금 대사’에서 자동 후보를 검토/);
});

test("13-week cash forecast de-duplicates ledgers, exposes data quality and persists daily scenarios", async () => {
  const [api, workspace, operations, schema, migration, page] = await Promise.all([
    read("app/api/finance/forecast/route.ts"), read("app/cash-forecast-workspace.tsx"),
    read("app/api/operations/route.ts"), read("db/schema.ts"),
    read("drizzle/0020_careless_goliath.sql"), read("app/page.tsx"),
  ]);
  assert.match(api, /expense\.source_type = 'PURCHASE_INVOICE' AND expense\.source_id = invoice\.id/);
  assert.match(api, /payment\.status <> 'CANCELLED'/);
  assert.match(api, /FALLBACK_REQUEST_DATE/);
  assert.match(api, /fallbackDateCount: fallbackDateItems\.length/);
  assert.match(api, /scenario === "CONSERVATIVE"/);
  assert.match(api, /scenario === "OPTIMISTIC"/);
  assert.match(api, /ON CONFLICT\(as_of, scenario\) DO UPDATE/);
  assert.match(workspace, /주차 근거 원장/);
  assert.match(workspace, /요청일 대체/);
  assert.match(workspace, /최소운영자금/);
  assert.match(operations, /id: "cash-forecast-risk"/);
  assert.match(operations, /destination: "finance:forecast"/);
  assert.match(schema, /financeCashForecastSettings/);
  assert.match(schema, /financeCashForecastSnapshots/);
  assert.match(migration, /idx_finance_cash_forecast_snapshot_asof_scenario/);
  assert.match(page, /"forecast", "13주 자금예측"/);
});

test("sales incentive remains unverified until an approved active rule exists", async () => {
  const [api, view] = await Promise.all([
    read("app/api/sales/route.ts"),
    read("app/sales-workspace.tsx"),
  ]);
  assert.match(api, /status === "ACTIVE"/);
  assert.match(api, /"UNVERIFIED"/);
  assert.match(view, /SIMULATION ONLY/);
  assert.match(view, /급여 미반영/);
});

test("runtime API column names stay aligned with the Drizzle production schema", async () => {
  const [schema, hrOperations, salesApi] = await Promise.all([
    read("db/schema.ts"),
    read("app/api/hr/operations/route.ts"),
    read("app/api/sales/route.ts"),
  ]);
  for (const column of ["before_json", "after_json", "task_group", "owner_employee_id", "due_date"]) {
    assert.match(hrOperations, new RegExp(column));
  }
  assert.doesNotMatch(hrOperations, /from_department|event_date|owner_type|evidence_document_id/);
  assert.match(schema, /rulesJson: text\("rules_json"\)/);
  assert.match(salesApi, /rules_json/);
  assert.doesNotMatch(salesApi, /\brule_json\b/);
});

test("leave and attendance workflows persist real manual records and approval tasks", async () => {
  const [api, view, engine] = await Promise.all([
    read("app/api/hr/operations/route.ts"),
    read("app/hr-workspace.tsx"),
    read("app/approval-engine.ts"),
  ]);
  assert.match(api, /resource === "leaveRequest"/);
  assert.match(api, /createApprovalRequest/);
  assert.match(engine, /source_type, source_id/);
  assert.match(api, /\["retirementChecklist", "retirementSettlement", "lifecycleTask"\]\.includes\(resource\) \? "write" : "approve"/);
  assert.match(api, /'RECORDED', 'MANUAL'/);
  assert.match(view, /자동연동 전까지 자료 출처는 수기 입력/);
  assert.match(view, /Math\.round\(Number\(leaveDraft\.units\) \* 100\)/);
});

test("post-approval finance and HR workflows require explicit controls before completion", async () => {
  const [finance, recruitment, hr, onboarding, workspace, migration] = await Promise.all([
    read("app/api/finance/operations/route.ts"), read("app/api/hr/recruitment/route.ts"),
    read("app/api/hr/operations/route.ts"), read("app/hr-onboarding.ts"),
    read("app/hr-workspace.tsx"), read("drizzle/0015_redundant_aqueduct.sql"),
  ]);
  assert.match(finance, /action === "CREATE_JOURNAL"/);
  assert.match(finance, /resource === "journal"/);
  assert.match(finance, /debit_account_name === before\.credit_account_name/);
  assert.match(recruitment, /resource === "offerResponse"/);
  assert.match(recruitment, /'ONBOARDING'/);
  assert.match(recruitment, /status = 'ACCEPTED'/);
  assert.match(onboarding, /status = '입사 예정'/);
  assert.match(onboarding, /ONBOARDING_EFFECTIVE/);
  assert.match(hr, /resource === "retirementSettlement"/);
  assert.match(hr, /settlement\?\.status !== "READY"/);
  assert.match(workspace, /제안 수락·입사 전환/);
  assert.match(workspace, /퇴직 정산·회수 통제/);
  for (const table of ["finance_journal_entries", "hr_retirement_settlements"]) assert.match(migration, new RegExp(table));
});

test("payroll close creates one traceable finance payment and blocks unsafe reopen", async () => {
  const [payroll, finance, view, schema, migration] = await Promise.all([
    read("app/api/hr/payroll/route.ts"), read("app/api/finance/operations/route.ts"),
    read("app/finance-operations-center.tsx"), read("db/schema.ts"),
    read("drizzle/0016_wild_black_tarantula.sql"),
  ]);
  assert.match(payroll, /payroll:\$\{period\}/);
  assert.match(payroll, /'PAYROLL_RUN', period, 'APPROVED'/);
  assert.match(payroll, /급여\(계정 확인 필요\)/);
  assert.match(payroll, /financeBefore\.status === "PAID"/);
  assert.match(payroll, /재무 취소·역분개 절차가 필요합니다/);
  assert.match(payroll, /allowedTransitions/);
  assert.match(finance, /source_type/);
  assert.match(view, /급여 마감 자동연결/);
  for (const field of ["sourceType", "sourceId"]) assert.match(schema, new RegExp(field));
  for (const column of ["source_type", "source_id"]) assert.match(migration, new RegExp(column));
});

test("employee documents are versioned, audited, downloadable and recoverably deleted", async () => {
  const api = await read("app/api/documents/route.ts");
  assert.match(api, /SELECT MAX\(version\) AS version/);
  assert.match(api, /DOCUMENT_UPLOADED/);
  assert.match(api, /downloadId/);
  assert.match(api, /DOCUMENT_DOWNLOADED/);
  assert.match(api, /UPDATE erp_documents SET deleted_at/);
  assert.match(api, /원본 파일은 복구를 위해 보존/);
  assert.doesNotMatch(api, /HR_AUDIO\.delete\(row\.storage_key\)/);
});

test("sales quote-to-cash documents support versioning and approval gates", async () => {
  const [api, view] = await Promise.all([
    read("app/api/sales/route.ts"),
    read("app/sales-workspace.tsx"),
  ]);
  for (const type of ["QUOTE", "ORDER", "DELIVERY", "INVOICE", "PAYMENT"]) assert.match(api, new RegExp(`"${type}"`));
  assert.match(api, /SELECT MAX\(version\) AS version FROM sales_documents/);
  assert.match(api, /status === "ACCEPTED"/);
  assert.match(api, /createApprovalRequest/);
  assert.match(api, /targetEntityType: "SALES_DOCUMENT"/);
  assert.match(view, /견적·수주·납품·청구·수금/);
});

test("sales collections explicitly allocate to an approved invoice and reserve its remaining balance", async () => {
  const [api, view, schema, migration] = await Promise.all([
    read("app/api/sales/route.ts"), read("app/sales-workspace.tsx"), read("db/schema.ts"),
    read("drizzle/0017_workable_lady_deathstrike.sql"),
  ]);
  assert.match(api, /sales_payment_allocations/);
  assert.match(api, /invoiceDocumentId/);
  assert.match(api, /payment\.status <> 'CANCELLED'/);
  assert.match(api, /CASE WHEN payment\.id IS NOT NULL/);
  assert.match(api, /역수금·환불 절차가 필요합니다/);
  assert.match(view, /대상 청구서/);
  assert.match(view, /현재 미수금/);
  assert.match(view, /수금 예약/);
  assert.match(schema, /salesPaymentAllocations/);
  assert.match(migration, /idx_sales_payment_allocation_payment/);
});

test("purchase-to-pay requires an approved order, accepted receipt and matched invoice before payment", async () => {
  const [api, view, approval, approvalCenter, finance, operations, schema, migration, page] = await Promise.all([
    read("app/api/finance/purchasing/route.ts"), read("app/purchasing-workspace.tsx"),
    read("app/approval-engine.ts"), read("app/approval-center.tsx"), read("app/api/finance/operations/route.ts"), read("app/api/operations/route.ts"), read("db/schema.ts"),
    read("drizzle/0018_confused_thanos.sql"), read("app/page.tsx"),
  ]);
  for (const table of ["finance_purchase_vendors", "finance_purchase_orders", "finance_purchase_order_lines", "finance_purchase_receipts", "finance_purchase_receipt_lines", "finance_purchase_invoices"]) {
    assert.match(schema, new RegExp(table));
    assert.match(migration, new RegExp(table));
  }
  assert.match(api, /requestType: "PURCHASE_ORDER"/);
  assert.match(api, /status IN \('APPROVED','PARTIALLY_RECEIVED'\)/);
  assert.match(api, /검수 잔액/);
  assert.match(api, /status = 'PAYMENT_READY'/);
  assert.match(api, /'PURCHASE_INVOICE'/);
  assert.match(approval, /targetEntityType === "PURCHASE_ORDER"/);
  assert.match(approvalCenter, /PURCHASE_ORDER: "발주 승인"/);
  assert.match(finance, /finance_purchase_invoices SET status = 'PAID'/);
  assert.match(operations, /purchase-match-exceptions/);
  assert.match(view, /발주·입고 현황/);
  assert.match(view, /매입채무·지급 연결/);
  assert.match(page, /"purchasing", "구매·매입채무"/);
});

test("cash reconciliation imports real Clobe transaction IDs and keeps confirmation human-controlled", async () => {
  const [api, workspace, page, closeApi, schema, seed] = await Promise.all([
    read("app/api/finance/reconciliation/route.ts"), read("app/cash-reconciliation-workspace.tsx"),
    read("app/page.tsx"), read("app/api/finance/close/route.ts"), read("db/schema.ts"),
    read("app/finance-bank-transactions.ts"),
  ]);
  assert.match(api, /finance_bank_transactions/);
  assert.match(api, /finance_cash_matches/);
  assert.match(api, /SUGGESTED_CONFIRMED/);
  assert.match(api, /requestedAmount > remaining \|\| requestedAmount > sourceRemaining/);
  assert.match(api, /action === "REVERSE"/);
  assert.match(workspace, /후보는 자동 제시하되 확정은 사용자가 수행합니다/);
  assert.match(workspace, /부분 배분/);
  assert.match(page, /"reconciliation", "자금 대사"/);
  assert.match(closeApi, /match_row\.status = 'CONFIRMED'/);
  assert.match(closeApi, /미대사.*건/);
  assert.match(schema, /idx_finance_cash_match_unique_source/);
  assert.equal((seed.match(/"transactionId"/g) ?? []).length, 155);
  assert.doesNotMatch(seed, /accountNumber/);
});

test("system tasks are generated from live workflow state instead of static counts", async () => {
  const api = await read("app/api/operations/route.ts");
  assert.match(api, /TRIM\(owner_id\) = ''/);
  assert.match(api, /updated_at < \?/);
  assert.match(api, /status !== "LOCKED"/);
  assert.match(api, /differenceKrw !== 0/);
  assert.match(api, /closeRuleTask/);
});

test("month-end close freezes automatic controls, evidence and a controlled reopen trail", async () => {
  const [api, workspace, engine, documents, operations, schema, migration, page] = await Promise.all([
    read("app/api/finance/close/route.ts"), read("app/finance-close-workspace.tsx"),
    read("app/approval-engine.ts"), read("app/api/documents/route.ts"),
    read("app/api/operations/route.ts"), read("db/schema.ts"),
    read("drizzle/0021_amusing_sway.sql"), read("app/page.tsx"),
  ]);
  assert.match(api, /match_row\.status = 'CONFIRMED'/);
  assert.match(api, /journalSummary\.differenceKrw/);
  assert.match(api, /status <> 'POSTED'/);
  assert.match(api, /expense\.evidence_required = 1/);
  assert.match(api, /payroll\?\.status === "LOCKED"/);
  assert.match(api, /action === "SUBMIT_CLOSE"/);
  assert.match(api, /snapshot_json = \?/);
  assert.match(api, /targetEntityType: "FINANCE_CLOSE_RUN"/);
  assert.match(api, /action === "REQUEST_REOPEN"/);
  assert.match(api, /targetEntityType: "FINANCE_CLOSE_REOPEN"/);
  assert.match(engine, /targetEntityType === "FINANCE_CLOSE_RUN"/);
  assert.match(engine, /targetEntityType === "FINANCE_CLOSE_REOPEN"/);
  assert.match(documents, /entityType === "financeCloseRun"/);
  assert.match(documents, /closeRun\.status !== "OPEN"/);
  assert.match(operations, /month-close-controls/);
  assert.match(operations, /destination: "finance:close"/);
  assert.match(workspace, /월마감 통제센터/);
  assert.match(workspace, /마감 증빙/);
  assert.match(workspace, /재개방 결재 요청/);
  assert.match(schema, /financeCloseRuns/);
  assert.match(schema, /idx_finance_close_run_status_period/);
  assert.match(migration, /finance_close_runs/);
  assert.match(migration, /idx_finance_close_run_status_period/);
  assert.match(page, /"close", "월마감 통제"/);
});

test("budget-versus-actual uses versioned plans, explicit sources and accountable variance actions", async () => {
  const [api, workspace, engine, operations, schema, migration, page] = await Promise.all([
    read("app/api/finance/budget/route.ts"), read("app/budget-actual-workspace.tsx"),
    read("app/approval-engine.ts"), read("app/api/operations/route.ts"), read("db/schema.ts"),
    read("drizzle/0022_yellow_shadowcat.sql"), read("app/page.tsx"),
  ]);
  for (const source of ["SALES_INVOICE", "PURCHASE_INVOICE", "POSTED_JOURNAL_DEBIT", "POSTED_JOURNAL_CREDIT"]) assert.match(api, new RegExp(source));
  assert.match(api, /line\.department !== "전사"/);
  assert.match(api, /currentDay \/ daysInMonth/);
  assert.match(api, /line\.direction === "REVENUE"/);
  assert.match(api, /COUNT\(DISTINCT month\) AS month_count/);
  assert.match(api, /totals\.month_count !== 12/);
  assert.match(api, /actualSource === "SALES_INVOICE" && direction !== "REVENUE"/);
  assert.match(api, /action === "CREATE_REVISION"/);
  assert.match(api, /action === "SAVE_VARIANCE_ACTION"/);
  assert.match(api, /targetEntityType: "FINANCE_BUDGET_PLAN"/);
  assert.match(engine, /targetEntityType === "FINANCE_BUDGET_PLAN"/);
  assert.match(engine, /status = 'SUPERSEDED'/);
  assert.match(operations, /budget-variance-alert/);
  assert.match(operations, /destination: "finance:budget"/);
  assert.match(workspace, /예산·실적 관리/);
  assert.match(workspace, /매핑 필요/);
  assert.match(workspace, /차이 원인/);
  for (const table of ["financeBudgetPlans", "financeBudgetPlanLines", "financeBudgetVarianceActions"]) assert.match(schema, new RegExp(table));
  for (const table of ["finance_budget_plans", "finance_budget_plan_lines", "finance_budget_variance_actions"]) assert.match(migration, new RegExp(table));
  assert.match(migration, /idx_finance_budget_plan_year_version/);
  assert.match(migration, /idx_finance_budget_variance_line_unique/);
  assert.match(page, /"budget", "예산·실적"/);
});

test("shared approval engine persists request, ordered steps and immutable events", async () => {
  const [schema, platform, engine, migration] = await Promise.all([
    read("db/schema.ts"), read("app/erp-platform.ts"), read("app/approval-engine.ts"),
    read("drizzle/0012_ancient_the_order.sql"),
  ]);
  for (const table of ["erp_approval_requests", "erp_approval_steps", "erp_approval_events"]) {
    assert.match(schema, new RegExp(table));
    assert.match(platform, new RegExp(table));
    assert.match(migration, new RegExp(table));
  }
  assert.match(schema, /idx_erp_approval_step_request_order/);
  assert.match(engine, /step_order/);
  assert.match(engine, /source_type, source_id/);
  assert.match(engine, /'APPROVAL'/);
});

test("approval transitions require module approval rights and optimistic concurrency", async () => {
  const api = await read("app/api/approvals/route.ts");
  assert.match(api, /authorizeErpRequest\(db, before\.module as ErpModule, "approve"\)/);
  assert.match(api, /version = version \+ 1/);
  assert.match(api, /transition_token = \?/);
  assert.match(api, /WHERE id = \? AND version = \?/);
  assert.match(api, /다른 사용자가 먼저 처리했습니다/);
  assert.match(api, /REQUEST_CHANGES/);
  assert.match(api, /RESUBMIT/);
  assert.match(api, /comment\) return Response\.json/);
  assert.match(api, /targetEntityType: "", targetEntityId: ""/);
});

test("final approvals update linked HR, finance and sales records in the guarded batch", async () => {
  const [engine, approvalApi, hr, payroll, finance, closeApi, sales] = await Promise.all([
    read("app/approval-engine.ts"), read("app/api/approvals/route.ts"),
    read("app/api/hr/operations/route.ts"), read("app/api/hr/payroll/route.ts"),
    read("app/api/finance/operations/route.ts"), read("app/api/finance/close/route.ts"), read("app/api/sales/route.ts"),
  ]);
  for (const entity of ["HR_LEAVE", "HR_PERSONNEL_ACTION", "PAYROLL_RUN", "FINANCE_BUDGET", "FINANCE_BUDGET_PLAN", "FINANCE_CLOSE", "FINANCE_CLOSE_RUN", "FINANCE_CLOSE_REOPEN", "FINANCE_MANAGEMENT_REPORT", "SALES_DOCUMENT"]) assert.match(engine, new RegExp(entity));
  assert.match(approvalApi, /buildApprovalOutcomeStatements/);
  assert.match(engine, /transition_token = \?/);
  assert.match(hr, /requestType: "LEAVE_REQUEST"/);
  assert.match(hr, /requestType: "PERSONNEL_ACTION"/);
  assert.match(hr, /status: "SUBMITTED"/);
  assert.match(engine, /UPDATE hr_employee_records SET/);
  assert.match(engine, /history_json = json_insert/);
  assert.match(payroll, /requestType: "PAYROLL_RUN"/);
  assert.match(finance, /requestType: "BUDGET"/);
  assert.match(closeApi, /requestType: "CLOSE"/);
  assert.match(sales, /targetEntityType: "SALES_DOCUMENT"/);
});

test("approval center replaces fixed mock approvals with server-backed workflow history", async () => {
  const [page, center] = await Promise.all([read("app/page.tsx"), read("app/approval-center.tsx")]);
  assert.match(page, /<ApprovalCenter/);
  assert.doesNotMatch(page, /박서연 · 연차|이도윤 · 마이너스 연차|최유진 · 법인카드/);
  assert.match(center, /fetch\("\/api\/approvals"/);
  assert.match(center, /기안·검토·승인·반려/);
  assert.match(center, /보완 후 재제출/);
});

test("approval policies and delegations are durable, audited and server-authorized", async () => {
  const [schema, platform, api, engine, migration, workspace] = await Promise.all([
    read("db/schema.ts"), read("app/erp-platform.ts"), read("app/api/approval-settings/route.ts"),
    read("app/approval-engine.ts"), read("drizzle/0013_fine_luke_cage.sql"), read("app/hr-workspace.tsx"),
  ]);
  for (const table of ["erp_approval_policies", "erp_approval_policy_steps", "erp_approval_delegations"]) {
    assert.match(schema, new RegExp(table));
    assert.match(platform, new RegExp(table));
    assert.match(migration, new RegExp(table));
  }
  assert.match(api, /authorizeErpRequest\(db, "settings", "admin"\)/);
  assert.match(api, /겹치는 금액 구간/);
  assert.match(api, /기간과 업무 범위가 겹치는 대결 설정/);
  assert.match(api, /writeErpAudit/);
  assert.match(engine, /configuredRouteFor/);
  assert.match(engine, /delegatedFromEmployeeId/);
  assert.match(workspace, /전자결재 규칙/);
  assert.match(workspace, /1단계 규칙은 전결/);
});

test("delegated approvals remain scoped to the assigned step and are visible in the route", async () => {
  const [api, engine, center] = await Promise.all([
    read("app/api/approvals/route.ts"), read("app/approval-engine.ts"), read("app/approval-center.tsx"),
  ]);
  assert.match(api, /actingAsDelegate/);
  assert.match(api, /step\.approver_employee_id === principal\.employeeId/);
  assert.match(api, /Boolean\(step\.delegated_from_employee_id\)/);
  assert.match(engine, /starts_on <= \?/);
  assert.match(engine, /ends_on >= \?/);
  assert.match(center, /delegatedFromEmployeeId/);
  assert.match(center, /대결/);
});

test("future personnel actions wait until their effective date and then apply once", async () => {
  const [engine, activator, records] = await Promise.all([
    read("app/approval-engine.ts"), read("app/hr-personnel-actions.ts"), read("app/api/hr/employee-records/route.ts"),
  ]);
  assert.match(engine, /effective_date FROM hr_personnel_actions/);
  assert.match(engine, /effective_date <= \?/);
  assert.match(activator, /WHERE status = 'APPROVED' AND effective_date <= \?/);
  assert.match(activator, /status = 'EFFECTIVE'/);
  assert.match(activator, /PERSONNEL_ACTION_EFFECTIVE/);
  assert.match(records, /applyDuePersonnelActions\(db\)/);
});

test("approval center reports overdue work without manufacturing a second task", async () => {
  const [api, center] = await Promise.all([read("app/api/approvals/route.ts"), read("app/approval-center.tsx")]);
  assert.match(api, /overdueMine/);
  assert.match(api, /item\.due_date < today/);
  assert.match(center, /기한 경과/);
  assert.match(center, /summary\.overdueMine/);
});

test("monthly management reporting freezes source lineage, quality gates, revisions and follow-up actions", async () => {
  const [api, workspace, schema, migration, page, engine, operations, plan] = await Promise.all([
    read("app/api/finance/management-report/route.ts"), read("app/management-report-workspace.tsx"),
    read("db/schema.ts"), read("drizzle/0023_management_reporting.sql"), read("app/page.tsx"),
    read("app/approval-engine.ts"), read("app/api/operations/route.ts"), read("docs/finance-management-report-plan.md"),
  ]);
  for (const table of ["finance_management_reports", "finance_management_report_actions"]) {
    assert.match(migration, new RegExp(table));
    assert.match(api, new RegExp(table));
  }
  for (const model of ["financeManagementReports", "financeManagementReportActions"]) assert.match(schema, new RegExp(model));
  assert.match(api, /monthInvoiceSummary/);
  assert.match(api, /qualityWarnings/);
  assert.match(api, /requiresAcknowledgement/);
  assert.match(api, /report\.highlights === oldAuto\.highlights/);
  assert.match(api, /status IN \('DRAFT','SUBMITTED'\)/);
  assert.match(api, /CREATE_REVISION/);
  assert.match(api, /status <> 'DONE'/);
  assert.match(api, /requestType: "REPORT"/);
  assert.match(engine, /FINANCE_MANAGEMENT_REPORT/);
  assert.match(engine, /status = 'SUPERSEDED'/);
  assert.match(workspace, /공급가액 순차이/);
  assert.match(workspace, /보고 수치 원천 등록부/);
  assert.match(workspace, /품질경고/);
  assert.match(workspace, /window\.print/);
  assert.match(page, /"report", "월간 경영보고"/);
  assert.match(operations, /management-report-due/);
  assert.match(operations, /management-report-actions/);
  assert.match(plan, /제출 이후에는 수정하지 않는다/);
  assert.match(plan, /미연결/);
});

test("expense requests require evidence, approval and a unique payment ledger entry", async () => {
  const [schema, migration, api, view, engine] = await Promise.all([
    read("db/schema.ts"), read("drizzle/0014_talented_matthew_murdock.sql"),
    read("app/api/finance/operations/route.ts"), read("app/finance-operations-center.tsx"), read("app/approval-engine.ts"),
  ]);
  for (const table of ["finance_expense_requests", "finance_payment_ledger"]) {
    assert.match(schema, new RegExp(table));
    assert.match(migration, new RegExp(table));
  }
  assert.match(migration, /UNIQUE INDEX `idx_finance_payment_request_unique`/);
  assert.match(api, /evidence_count < 1/);
  assert.match(api, /before\.status !== "APPROVED"/);
  assert.match(api, /journal_status = 'READY'/);
  assert.match(api, /targetEntityType: "FINANCE_EXPENSE"/);
  assert.match(engine, /targetEntityType === "FINANCE_EXPENSE"/);
  assert.match(view, /증빙을 첨부한 뒤 결재를 제출/);
});

test("retirement approval activates a durable checklist and applies the due retirement once", async () => {
  const [migration, api, engine, activator, records, workspace] = await Promise.all([
    read("drizzle/0014_talented_matthew_murdock.sql"), read("app/api/hr/operations/route.ts"),
    read("app/approval-engine.ts"), read("app/hr-retirements.ts"),
    read("app/api/hr/employee-records/route.ts"), read("app/hr-workspace.tsx"),
  ]);
  assert.match(migration, /hr_retirement_requests/);
  assert.match(api, /requestType: "RETIREMENT"/);
  assert.match(api, /resource === "retirementChecklist"/);
  assert.match(engine, /targetEntityType === "HR_RETIREMENT"/);
  assert.match(engine, /status = '퇴직 예정'/);
  assert.match(activator, /WHERE status = 'READY' AND retirement_date <= \?/);
  assert.match(activator, /RETIREMENT_EFFECTIVE/);
  assert.match(records, /applyDueRetirements\(db\)/);
  assert.doesNotMatch(workspace, /const nextEmployee: Employee = \{[\s\S]*?status: "퇴직 예정"/);
});

test("recruitment offers are approval-gated and update the applicant stage on final decision", async () => {
  const [migration, api, engine, workspace] = await Promise.all([
    read("drizzle/0014_talented_matthew_murdock.sql"), read("app/api/hr/recruitment/route.ts"),
    read("app/approval-engine.ts"), read("app/hr-workspace.tsx"),
  ]);
  assert.match(migration, /hr_offer_requests/);
  assert.match(api, /resource === "offer"/);
  assert.match(api, /requestType: "OFFER"/);
  assert.match(api, /targetEntityType: "RECRUITMENT_OFFER"/);
  assert.match(engine, /targetEntityType === "RECRUITMENT_OFFER"/);
  assert.match(engine, /채용 제안 승인/);
  assert.match(engine, /채용 제안 반려/);
  assert.match(workspace, /채용 제안 결재 제출/);
});
