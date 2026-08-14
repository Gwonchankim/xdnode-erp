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

test("finance controls do not fabricate reconciliation or forecast source rows", async () => {
  const [api, view] = await Promise.all([
    read("app/api/finance/operations/route.ts"),
    read("app/finance-operations-center.tsx"),
  ]);
  assert.match(api, /bankTransactionLines: reconciliations\.results\.length \? "IMPORTED" : "NOT_CONNECTED"/);
  assert.match(api, /forecast: forecast\.results\.length \? "MANUAL" : "NOT_CONNECTED"/);
  assert.match(view, /실제 자료를 임의 생성하지 않았습니다/);
  assert.match(view, /원천 행이 연결되기 전에는 자동으로 ‘완료’ 처리하지 않습니다/);
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
  assert.match(api, /authorizeErpRequest\(db, "hr", "approve"\)/);
  assert.match(api, /'RECORDED', 'MANUAL'/);
  assert.match(view, /자동연동 전까지 자료 출처는 수기 입력/);
  assert.match(view, /Math\.round\(Number\(leaveDraft\.units\) \* 100\)/);
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

test("system tasks are generated from live workflow state instead of static counts", async () => {
  const api = await read("app/api/operations/route.ts");
  assert.match(api, /TRIM\(owner_id\) = ''/);
  assert.match(api, /updated_at < \?/);
  assert.match(api, /status !== "LOCKED"/);
  assert.match(api, /differenceKrw !== 0/);
  assert.match(api, /closeRuleTask/);
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
  const [engine, approvalApi, hr, payroll, finance, sales] = await Promise.all([
    read("app/approval-engine.ts"), read("app/api/approvals/route.ts"),
    read("app/api/hr/operations/route.ts"), read("app/api/hr/payroll/route.ts"),
    read("app/api/finance/operations/route.ts"), read("app/api/sales/route.ts"),
  ]);
  for (const entity of ["HR_LEAVE", "HR_PERSONNEL_ACTION", "PAYROLL_RUN", "FINANCE_BUDGET", "FINANCE_CLOSE", "SALES_DOCUMENT"]) assert.match(engine, new RegExp(entity));
  assert.match(approvalApi, /buildApprovalOutcomeStatements/);
  assert.match(engine, /transition_token = \?/);
  assert.match(hr, /requestType: "LEAVE_REQUEST"/);
  assert.match(hr, /requestType: "PERSONNEL_ACTION"/);
  assert.match(hr, /status: "SUBMITTED"/);
  assert.match(engine, /UPDATE hr_employee_records SET/);
  assert.match(engine, /history_json = json_insert/);
  assert.match(payroll, /requestType: "PAYROLL_RUN"/);
  assert.match(finance, /requestType: "BUDGET"/);
  assert.match(finance, /requestType: "CLOSE"/);
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
