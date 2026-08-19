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

test("retirement effectiveness and compensation confirmation are server-controlled", async () => {
  const [retirement, operations, employees, compensation, calculator, calculatorCss, workspace, wonInput, migration, settingsMigration] = await Promise.all([
    read("app/hr-retirements.ts"), read("app/api/hr/operations/route.ts"), read("app/api/hr/employee-records/route.ts"),
    read("app/api/hr/compensation/route.ts"), read("app/compensation-calculator.tsx"), read("app/compensation-calculator.css"), read("app/hr-workspace.tsx"),
    read("app/won-input.tsx"), read("drizzle/0065_hr_retirement_compensation.sql"), read("drizzle/0068_compensation_draft_settings.sql"),
  ]);
  assert.match(retirement, /status IN \('IN_PROGRESS', 'READY'\) OR \(status = 'EFFECTIVE'/);
  assert.match(retirement, /const nextStatus = completion\?\.ready \? "COMPLETED" : "EFFECTIVE"/);
  assert.match(operations, /due \? "퇴직" : "퇴직 예정"/);
  for (const field of ["base_pay", "meal_allowance", "childcare_allowance", "vehicle_allowance"]) {
    assert.match(employees, new RegExp(field)); assert.match(migration, new RegExp(field));
  }
  for (const table of ["hr_compensation_runs", "hr_compensation_lines"]) assert.match(compensation, new RegExp(table));
  assert.match(compensation, /DELETE FROM hr_payroll_records WHERE year_month = \?/);
  assert.match(compensation, /hr_payroll_runs\.status='DRAFT'/);
  assert.match(compensation, /검토·승인·마감이 진행된 급여월은 임금안으로 덮어쓸 수 없습니다/);
  assert.match(calculator, /임금안을 확정해 HR 급여관리에 덮어썼습니다/);
  assert.match(calculator, /"급여 확정"/);
  assert.match(calculator, /수정하기/);
  assert.match(calculator, /action: "SAVE", period: key/);
  assert.match(calculator, /변경된 임금안이 서버에 자동 저장되었습니다/);
  assert.match(calculator, /서버 저장 완료 · 새로고침하거나 다시 접속해도 이 초안이 유지됩니다/);
  assert.match(calculator, /className="payroll-footer-action confirm"/);
  assert.match(calculator, /\.toFile\(`XD_NODE_급여_/);
  assert.match(calculator, /writeXlsxFile\(sheets\)\.toFile/);
  assert.match(calculator, /beginColumnResize/);
  assert.match(calculator, /column-resizer/);
  assert.match(calculator, /COLUMN_VISIBILITY_OPTIONS/);
  assert.match(calculator, /hiddenColumns/);
  assert.match(calculator, /label: "부서"/);
  assert.match(calculator, /label: "직책"/);
  assert.match(calculator, /action === "CONFIRM" && !run/);
  assert.match(compensation, /hasClientDraft/);
  assert.match(compensation, /grossPayByEmployee/);
  assert.match(calculatorCss, /tbody tr:nth-child\(even\) td/);
  assert.match(calculatorCss, /border-right:1px solid/);
  assert.match(calculatorCss, /font-size:12px;font-weight:800;text-align:center/);
  assert.match(calculatorCss, /column-visibility/);
  assert.match(calculator, /type WageSortKey/);
  assert.match(calculator, /toggleSort/);
  assert.match(calculator, /sortedRows\.map/);
  assert.match(calculator, /aria-sort/);
  assert.match(calculatorCss, /column-sort/);
  assert.match(calculatorCss, /footer button\{font-size:11px\}/);
  for (const label of ["연봉", "기본급 직접 입력", "추가수당", "연구수당", "퇴직금", "복지기금"]) {
    assert.match(calculator, new RegExp(`WonInput className="money-input" ariaLabel="${label}"`));
  }
  assert.match(calculator, /field === "incentive" \? "인센티브" : "상여금"/);
  assert.doesNotMatch(calculator, /className="money-input" type="number"/);
  assert.match(compensation, /settings_json/);
  assert.match(settingsMigration, /settings_json TEXT NOT NULL DEFAULT '\{\}'/);
  assert.match(workspace, /기본급 · 1원 단위/);
  assert.doesNotMatch(workspace, /step="10000"/);
  assert.match(wonInput, /toLocaleString\("ko-KR"\)/);
  assert.match(wonInput, /inputMode="numeric"/);
});

test("retired employees are excluded from directory and organization membership", async () => {
  const [workspace, retirement, leaders, migration] = await Promise.all([
    read("app/hr-workspace.tsx"), read("app/hr-retirements.ts"),
    read("app/api/hr/organization-leaders/route.ts"), read("drizzle/0066_retired_employee_visibility.sql"),
  ]);
  assert.match(workspace, /function isCurrentEmployee/);
  assert.match(workspace, /const visibleEmployees = query \? currentEmployees\.filter/);
  assert.match(workspace, /isCurrentEmployee\(employee\) && employee\.department === organization\.name/);
  assert.match(retirement, /UPDATE hr_organization_leaders SET leader_employee_id = NULL/);
  assert.match(leaders, /퇴직자는 조직장으로 지정할 수 없습니다/);
  assert.match(leaders, /THEN NULL ELSE leader\.leader_employee_id END/);
  assert.match(migration, /WHERE status = '퇴직'/);
});

test("master data changes freeze, validate and consume a server-side impact assessment", async () => {
  const [server, api, dialog, finance, sales, hr, approvals, schema, migration, plan] = await Promise.all([
    read("app/master-impact.ts"), read("app/api/master-impact/route.ts"), read("app/master-impact-dialog.tsx"),
    read("app/api/finance/master-data/route.ts"), read("app/api/sales/accounts/route.ts"), read("app/api/hr/organizations/route.ts"),
    read("app/api/approvals/route.ts"), read("db/schema.ts"), read("drizzle/0061_master_data_impact.sql"), read("docs/master-data-impact-plan.md"),
  ]);
  for (const source of [server, schema, migration]) assert.match(source, /erp_master_impact_assessments/);
  assert.match(api, /authorizeErpRequest/); assert.match(server, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(server, /expiresAt = createdAt \+ 15 \* 60_000/); assert.match(server, /row\.used_at/);
  assert.match(server, /current\.checksum !== row\.checksum/); assert.match(server, /current\.blockingCount > 0/);
  for (const source of [finance, sales, hr]) assert.match(source, /validateMasterImpactAssessment/);
  for (const source of [finance, sales, hr]) assert.match(source, /impactAssessmentId/);
  assert.match(approvals, /reassessMasterImpact/); assert.match(approvals, /최종 승인 직전 재검증/);
  assert.match(dialog, /차단 항목 해결 필요/); assert.match(dialog, /변경 직전 서버에서 다시 검증/);
  assert.match(plan, /자동 병합·자동 계정 치환하지 않는다/); assert.match(plan, /localStorage.*사용하지 않는다/);
});

test("master impact blockers become controlled resolution cases with recheck and evidence gates", async () => {
  const [server, api, operations, workbench, workspace, center, page, schema, migration, plan] = await Promise.all([
    read("app/master-impact.ts"), read("app/api/master-impact-cases/route.ts"), read("app/api/operations/route.ts"),
    read("app/api/workbench/route.ts"), read("app/master-impact-case-workspace.tsx"), read("app/data-governance-center.tsx"), read("app/page.tsx"), read("db/schema.ts"),
    read("drizzle/0062_master_impact_resolution_queue.sql"), read("docs/master-impact-resolution-queue-plan.md"),
  ]);
  for (const source of [server, api, schema, migration]) for (const table of ["erp_master_impact_cases", "erp_master_impact_case_events"]) assert.match(source, new RegExp(table));
  assert.match(server, /entry\.severity === "BLOCKER" && entry\.count > 0/);
  assert.match(server, /MASTER_IMPACT_CASE/); assert.match(server, /source_type, source_id/);
  assert.match(api, /authorizeErpRequest\(db, "settings", "admin"\)/);
  assert.match(api, /reassessMasterImpact/); assert.match(api, /currentCount === 0 \? "VERIFIED"/);
  assert.match(api, /resolutionNote\.length < 10 \|\| evidenceRef\.length < 3/);
  assert.match(api, /expectedVersion !== before\.version/); assert.match(api, /status = 'CLOSED'/);
  assert.match(workspace, /자동 해결 없음/); assert.match(workspace, /회사 직원만 배정/); assert.match(workspace, /원장 재검증/); assert.match(workspace, /증빙 남기고 종결/);
  assert.match(operations, /before\.source_type === "MASTER_IMPACT_CASE" && status !== before\.status/);
  assert.match(workbench, /row\.source_type !== "MASTER_IMPACT_CASE"/);
  assert.match(center, /기준정보 영향/); assert.match(page, /destination === "data-control:master-impact"/); assert.match(page, /task\.sourceType !== "MASTER_IMPACT_CASE"/);
  assert.match(plan, /`BLOCKER`이면서 연결 건수가 1건 이상/); assert.match(plan, /OPEN → IN_PROGRESS → VERIFIED → CLOSED/);
  assert.match(plan, /자동 해결, 자동 계정 치환, 자동 병합, 자동 종결은 하지 않는다/);
});

test("master impact SLA escalations preserve ownership and freeze versioned weekly risk reports", async () => {
  const [server, api, workspace, schema, migration, plan] = await Promise.all([
    read("app/master-impact.ts"), read("app/api/master-impact-cases/route.ts"), read("app/master-impact-case-workspace.tsx"),
    read("db/schema.ts"), read("drizzle/0063_master_impact_sla_reporting.sql"), read("docs/master-impact-sla-reporting-plan.md"),
  ]);
  for (const source of [server, api, schema, migration]) for (const table of ["erp_master_impact_sla_policies", "erp_master_impact_weekly_reports"]) assert.match(source, new RegExp(table));
  assert.match(api, /authorizeErpRequest\(db, "settings", "admin"\)/);
  assert.match(api, /target <= row\.escalation_level/); assert.match(api, /WHERE id = \? AND escalation_level < \?/);
  assert.match(api, /SLA_ESCALATED/); assert.match(api, /SYSTEM:SLA/); assert.match(api, /MASTER_IMPACT_SLA_ESCALATION/);
  assert.match(api, /expectedVersion !== before\.version/); assert.match(api, /expectedPolicyVersion/);
  assert.match(api, /executiveEscalationDays <= managerEscalationDays/); assert.match(api, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(api, /SELECT COALESCE\(MAX\(version\), 0\) \+ 1 FROM erp_master_impact_weekly_reports/);
  assert.doesNotMatch(api, /UPDATE erp_master_impact_weekly_reports SET (?:snapshot_json|checksum)/);
  assert.match(workspace, /자동 재배정 없음/); assert.match(workspace, /기존 기한은 변경하지 않았습니다/); assert.match(workspace, /관리자별 현재 위험/); assert.match(workspace, /현재 상태 주간 보고 저장/);
  assert.match(server, /policy\.defaultDueDays/); assert.match(plan, /기존 업무의 담당자·기한을 소급 변경하지 않는다/); assert.match(plan, /새 버전을 추가한다/);
});

test("master impact weekly reports require recorded manager responses before executive approval", async () => {
  const [api, workspace, approval, approvalApi, schema, migration, plan] = await Promise.all([
    read("app/api/master-impact-cases/route.ts"), read("app/master-impact-case-workspace.tsx"),
    read("app/approval-engine.ts"), read("app/api/approvals/route.ts"), read("db/schema.ts"),
    read("drizzle/0064_master_impact_report_approval.sql"), read("docs/master-impact-report-approval-plan.md"),
  ]);
  for (const source of [api, schema, migration]) for (const table of ["erp_master_impact_weekly_report_reviews", "erp_master_impact_weekly_report_events"]) assert.match(source, new RegExp(table));
  assert.match(api, /ACK_MANAGER_REVIEW/); assert.match(api, /REQUEST_MANAGER_ACTION/); assert.match(api, /VERIFY_MANAGER_ACTION/);
  assert.match(api, /follow_up_task_status !== "DONE"/); assert.match(api, /outcome <> 'ACKNOWLEDGED'/);
  assert.match(api, /SUBMIT_WEEKLY_REPORT/); assert.match(api, /MASTER_IMPACT_WEEKLY_REPORT/); assert.match(api, /createApprovalRequest/);
  assert.match(api, /expectedReviewVersion/); assert.match(api, /expectedWorkflowVersion/); assert.match(api, /status = 'DRAFT'/);
  assert.match(api, /MASTER_IMPACT_REPORT_REVIEW/); assert.match(api, /data-control:master-impact/);
  assert.match(approval, /settings: \{ MASTER_IMPACT_REPORT/); assert.match(approval, /targetEntityType === "MASTER_IMPACT_WEEKLY_REPORT"/);
  assert.match(approvalApi, /moduleName === "settings"/); assert.match(migration, /idx_erp_approval_master_impact_report/);
  assert.match(approvalApi, /MASTER_IMPACT_WEEKLY_REPORT/); assert.match(approvalApi, /\["REQUEST_CHANGES", "RESUBMIT", "CANCEL"\]/);
  assert.match(migration, /trg_erp_master_impact_weekly_report_immutable/); assert.match(migration, /BEFORE UPDATE OF `snapshot_json`, `checksum`/);
  assert.match(workspace, /실제 기록자 표시/); assert.match(workspace, /자동 승인 없음/); assert.match(workspace, /경영 책임자 전자결재 제출/);
  assert.match(plan, /조직장과 실제 기록자를 구분/); assert.match(plan, /자동 승인·자동 종결은 하지 않는다/);
  assert.match(plan, /snapshot_json.*checksum.*수정하지 않는다/);
});

test("finance assistant answers become traceable decision drafts without bypassing review and approval", async () => {
  const [api, page, workspace, schema, migration, plan] = await Promise.all([
    read("app/api/finance/management-report/route.ts"), read("app/page.tsx"),
    read("app/management-report-workspace.tsx"), read("db/schema.ts"),
    read("drizzle/0059_finance_assistant_decision_lineage.sql"), read("docs/finance-assistant-to-decision-plan.md"),
  ]);
  for (const source of [api, schema, migration]) {
    assert.match(source, /source_assistant_answer_id/);
    assert.match(source, /source_answer_hash/);
    assert.match(source, /source_evidence_hash/);
  }
  assert.match(api, /PROMOTE_ASSISTANT_ANSWER/);
  assert.match(api, /report\.status !== "DRAFT"/);
  assert.match(api, /assistant\.evidence_status !== "VERIFIED" && body\.reviewAcknowledged !== true/);
  assert.match(api, /ASSISTANT_ANSWER_PROMOTED/);
  assert.match(migration, /UNIQUE INDEX `idx_finance_management_decision_assistant_source`/);
  assert.match(page, /경영 안건으로 제안/);
  assert.match(workspace, /AI 근거 안건 제안/);
  assert.match(workspace, /원문 근거/);
  assert.match(page, /openFinanceAssistantSource/);
  assert.match(workspace, /근거 제한을 확인했습니다/);
  assert.match(plan, /답변 → 안건 초안 → 보고서 제출 → 전자결재 → 안건 확정 → 후속조치/);
});

test("daily treasury reports freeze source data, survive AI outages and require human review before finalization", async () => {
  const [api, view, schema, migration, page, operations, close, plan] = await Promise.all([
    read("app/api/finance/daily-treasury/route.ts"), read("app/daily-treasury-workspace.tsx"),
    read("db/schema.ts"), read("drizzle/0034_daily_treasury_reporting.sql"), read("app/page.tsx"),
    read("app/api/operations/route.ts"), read("app/api/finance/close/route.ts"),
    read("docs/finance-daily-treasury-report-plan.md"),
  ]);
  assert.match(schema, /financeDailyTreasuryReports/);
  assert.match(migration, /idx_finance_daily_treasury_report_date_version/);
  assert.match(api, /finance_bank_transactions/);
  assert.match(api, /finance_cash_forecast_items/);
  assert.match(api, /sales_payment_allocations/);
  assert.match(api, /finance_purchase_invoices/);
  assert.match(api, /finance_debt_schedule_items/);
  assert.match(api, /action === "FINALIZE" \? "approve" : "write"/);
  assert.match(api, /analysis_source = \?/);
  assert.match(api, /RULE_BASED_FALLBACK/);
  assert.match(api, /status: "QUOTA"/);
  assert.match(api, /managementNote\.length < 10 \|\| actionItems\.length < 1/);
  assert.match(api, /WHERE id = \? AND status = 'REVIEWED'/);
  assert.match(view, /동결 스냅샷 분석/);
  assert.match(view, /AI 결과는 참고자료/);
  assert.match(page, /\["daily-report", "일일 자금일보", "일"\]/);
  assert.match(page, /requestFinanceWorkspace\("daily-report"\)/);
  assert.doesNotMatch(page, /임시 저장/);
  assert.match(operations, /daily-treasury-report-due/);
  assert.match(operations, /destination: "finance:daily-report"/);
  assert.match(close, /DAILY_TREASURY_REPORT/);
  assert.match(close, /category: "TREASURY"/);
  assert.match(plan, /`FINAL` 보고서는 수정하지 않고 다음 버전으로만 개정/);
  assert.match(plan, /AI 설정 누락·무료한도 초과·통신 실패/);
});

test("finance overview uses live operation tasks and saved treasury reports instead of frozen UI copy", async () => {
  const [page, assistant, insights, plan] = await Promise.all([
    read("app/page.tsx"), read("app/api/finance/assistant/route.ts"),
    read("app/finance-current-insights.ts"), read("docs/finance-live-overview-plan.md"),
  ]);
  assert.match(page, /fetch\("\/api\/operations"\)/);
  assert.match(page, /\/api\/finance\/daily-treasury\?date=/);
  assert.match(page, /activeFinanceTasks\.length/);
  assert.match(page, /financeDestinationView\(task\.destination\)/);
  assert.match(page, /treasuryReport\?\.analysisText/);
  assert.match(page, /과거 분석 문장을 최신 결과처럼 표시하지 않습니다/);
  assert.doesNotMatch(page, /const financeAlerts\s*=/);
  assert.doesNotMatch(page, /const financeDailyBrief\s*=/);
  assert.match(page, /financeCurrentInsights\.bankActivity31Days/);
  assert.match(assistant, /financeCurrentInsights\.bankActivity31Days/);
  assert.match(insights, /계좌간 대체 포함 가능/);
  assert.match(plan, /완료 업무는 카드에서 제거/);
  assert.match(plan, /API가 실패한 경우 이를 명시/);
});

test("finance charts derive balance endpoints and invoice flows from shared source data", async () => {
  const [page, series, plan] = await Promise.all([
    read("app/page.tsx"), read("app/finance-time-series.ts"), read("docs/finance-time-series-plan.md"),
  ]);
  assert.match(page, /buildBalanceSeries\(financeCurrentData\.balanceTrend, period\)/);
  assert.match(page, /buildAmountSeries\(financeCurrentData\.salesDaily2026, period, financeCurrentInsights\.taxInvoicesAsOf\)/);
  assert.match(page, /세금계산서 매출 공급가액/);
  assert.doesNotMatch(page, /const cashTrend\s*=/);
  assert.doesNotMatch(page, /const financeChartSeries\s*=/);
  assert.match(series, /주간 마지막 관측값/);
  assert.match(series, /무발행 구간은 0원/);
  assert.match(plan, /잔액은 특정 시점 값이고 매출은 기간 합계/);
  assert.match(plan, /은행의 매출성 입금이나 판매채널 정산액과 합치지 않는다/);
});

test("finance forecast and account risk share explainable decision models with the AI assistant", async () => {
  const [page, assistant, model, plan] = await Promise.all([
    read("app/page.tsx"), read("app/api/finance/assistant/route.ts"),
    read("app/finance-decision-model.ts"), read("docs/finance-forecast-risk-model-plan.md"),
  ]);
  assert.match(page, /buildSalesForecast\(financeCurrentData\.salesDaily2026, financeCurrentInsights\.taxInvoicesAsOf\)/);
  assert.match(page, /buildAccountRiskModel\(financeCurrentData\.accountSummary/);
  assert.match(page, /YEAR-END SCENARIOS/);
  assert.match(page, /위험 신호와 배점/);
  assert.doesNotMatch(page, /const elapsedDays2026/);
  assert.doesNotMatch(page, /const accountRiskScore/);
  assert.match(assistant, /buildSalesForecast/);
  assert.match(assistant, /buildAccountRiskModel/);
  assert.match(model, /2026\.08-v2/);
  assert.match(model, /회사 최소 운영자금·외화 한도 정책 미등록/);
  assert.match(plan, /보수 ≤ 기준 ≤ 낙관/);
});

test("company finance policy is durable, admin-controlled, audited and connected to risk tasks", async () => {
  const [api, server, view, page, schema, migration, operations, assistant, forecast, plan] = await Promise.all([
    read("app/api/finance/risk-policy/route.ts"), read("app/finance-risk-policy-server.ts"),
    read("app/finance-risk-policy-workspace.tsx"), read("app/page.tsx"), read("db/schema.ts"),
    read("drizzle/0035_finance_risk_policy.sql"), read("app/api/operations/route.ts"),
    read("app/api/finance/assistant/route.ts"), read("app/api/finance/forecast/route.ts"),
    read("docs/finance-risk-policy-plan.md"),
  ]);
  assert.match(api, /authorizeErpRequest\(db, "finance", "read"\)/);
  assert.match(api, /authorizeErpRequest\(db, "settings", "admin"\)/);
  assert.match(api, /FINANCE_RISK_POLICY_UPDATED/);
  assert.match(api, /changeReason\.length < 2/);
  assert.match(server, /finance_cash_forecast_settings/);
  assert.match(schema, /riskPolicyConfigured/);
  assert.match(migration, /minimum_debt_coverage_bps/);
  assert.match(view, /정책 저장·재평가/);
  assert.match(view, /감사기록에 남습니다/);
  assert.match(page, /\["policy", "회사 재무정책", "설"\]/);
  assert.match(page, /FinanceRiskPolicyWorkspace/);
  assert.match(operations, /finance-risk-policy-missing/);
  assert.match(operations, /account-liquidity-policy-risk/);
  assert.match(operations, /destination: "finance:policy"/);
  assert.match(assistant, /loadFinanceRiskPolicy/);
  assert.doesNotMatch(forecast, /Number\(body\.minimumCashBalance/);
  assert.match(plan, /일반 재무 쓰기 권한으로 정책을 변경할 수 없어야 한다/);
});

test("finance master changes are approval-gated and new finance inputs validate active master records", async () => {
  const [api, workspace, engine, operations, budget, sales, purchasing, page, plan, taskRoute] = await Promise.all([
    read("app/api/finance/master-data/route.ts"), read("app/finance-master-workspace.tsx"),
    read("app/approval-engine.ts"), read("app/api/finance/operations/route.ts"),
    read("app/api/finance/budget/route.ts"), read("app/api/sales/route.ts"),
    read("app/api/finance/purchasing/route.ts"), read("app/page.tsx"), read("docs/finance-master-data-plan.md"), read("app/api/operations/route.ts"),
  ]);
  assert.match(api, /requestType: "MASTER_DATA"/);
  assert.match(api, /targetEntityType: "FINANCE_MASTER_CHANGE"/);
  assert.match(api, /INSERT OR IGNORE INTO finance_master_accounts/);
  assert.match(workspace, /계좌번호 전체값은 저장하지 않으며/);
  assert.match(engine, /targetEntityType === "FINANCE_MASTER_CHANGE"/);
  assert.match(engine, /transition_token/);
  assert.match(workspace, /통합 재무 마스터/);
  assert.match(workspace, /실제 이카운트 세금코드 목록/);
  assert.match(operations, /finance_master_partners WHERE canonical_name/);
  assert.match(operations, /finance_master_accounts WHERE code/);
  assert.match(budget, /전기 분개를 연결하려면 활성 계정과목/);
  assert.match(sales, /finance_master_partner_aliases/);
  assert.match(purchasing, /finance_master_partner_aliases/);
  assert.match(page, /"master", "통합 재무 마스터"/);
  assert.match(taskRoute, /finance-master-quality/);
  assert.match(taskRoute, /destination: "finance:master"/);
  assert.match(plan, /과거 문자열 스냅샷은 보존/);
  assert.match(plan, /임의 코드를 생성하지 않는다/);
});

test("invoice receivables derive balances from accepted payments and preserve operational collection history", async () => {
  const [api, workspace, schema, migration, page, operations, plan] = await Promise.all([
    read("app/api/finance/receivables/route.ts"), read("app/receivables-workspace.tsx"),
    read("db/schema.ts"), read("drizzle/0025_receivable_collections.sql"), read("app/page.tsx"),
    read("app/api/operations/route.ts"), read("docs/finance-receivables-plan.md"),
  ]);
  for (const table of ["finance_receivable_cases", "finance_receivable_notes"]) {
    assert.match(api, new RegExp(table));
    assert.match(migration, new RegExp(table));
  }
  assert.match(schema, /financeReceivableCases/);
  assert.match(schema, /financeReceivableNotes/);
  assert.match(api, /payment\.status IN \('ACCEPTED','COMPLETED'\)/);
  assert.match(api, /source\.outstandingAmount <= 0/);
  assert.match(api, /입금 약속 상태에는 약속일과 약속금액/);
  assert.match(api, /분쟁·보류 상태에는 사유/);
  assert.match(workspace, /회계·영업 원천값 · 읽기 전용/);
  assert.match(workspace, /연체 구간별 미수잔액/);
  assert.match(workspace, /접촉·특이사항 기록/);
  assert.match(page, /<ReceivablesWorkspace \/>/);
  assert.match(operations, /receivable-collections-risk/);
  assert.match(plan, /사용자가 임의 종결하지 못한다/);
  assert.match(plan, /공식 신용등급/);
});

test("payables use vendor-scoped invoice uniqueness, accountable schedules and forecast dates", async () => {
  const [api, workspace, forecast, forecastView, schema, migration, operations, plan] = await Promise.all([
    read("app/api/finance/purchasing/route.ts"), read("app/purchasing-workspace.tsx"),
    read("app/api/finance/forecast/route.ts"), read("app/cash-forecast-workspace.tsx"),
    read("db/schema.ts"), read("drizzle/0026_payable_scheduling.sql"),
    read("app/api/operations/route.ts"), read("docs/finance-payables-plan.md"),
  ]);
  assert.match(schema, /financePayablePlans/);
  assert.match(schema, /idx_finance_purchase_invoice_vendor_number/);
  assert.match(migration, /finance_payable_plans/);
  assert.match(migration, /DROP INDEX IF EXISTS `idx_finance_purchase_invoice_number`/);
  assert.match(api, /vendor_id = \? AND invoice_number = \?/);
  assert.match(api, /planStatus === "SCHEDULED" && !plannedPaymentDate/);
  assert.match(api, /planStatus === "HOLD" && !holdReason/);
  assert.match(workspace, /매입채무 에이징·지급 일정/);
  assert.match(workspace, /원천 지급기한과 내부 지급일을 분리/);
  assert.match(forecast, /dateQuality: planned \? "PAYMENT_PLAN"/);
  assert.match(forecastView, /내부 지급계획/);
  assert.match(operations, /payable-schedule-risk/);
  assert.match(plan, /부분지급·분할지급/);
});

test("inventory control connects accepted receipts and deliveries without inventing SKU mappings", async () => {
  const [api, view, page, schema, migration, close, operations, plan] = await Promise.all([
    read("app/api/finance/inventory/route.ts"), read("app/inventory-workspace.tsx"), read("app/page.tsx"),
    read("db/schema.ts"), read("drizzle/0027_inventory_control.sql"), read("app/api/finance/close/route.ts"),
    read("app/api/operations/route.ts"), read("docs/finance-inventory-plan.md"),
  ]);
  assert.match(schema, /inventoryProducts/);
  assert.match(schema, /idx_inventory_movement_source_line/);
  assert.match(migration, /CREATE TABLE `inventory_movements`/);
  assert.match(api, /receipt_line\.accepted_quantity_milli > 0/);
  assert.match(api, /가용재고 .*초과해 출고할 수 없습니다/);
  assert.match(api, /INVENTORY_MOVEMENT_POSTED/);
  assert.match(api, /INVENTORY_PRODUCT_UPDATED/);
  assert.match(api, /잠긴 마감월에는 재고 이동을 추가할 수 없습니다/);
  assert.match(api, /source\.receipt_date, productId, warehouseId/);
  assert.match(view, /자유입력 품목명.*자동 SKU로 간주하지 않습니다/);
  assert.match(view, /이동평균 원가 · 음수재고 차단/);
  assert.match(view, /변경 저장/);
  assert.match(page, /\["inventory", "재고·상품원가", "재"\]/);
  assert.match(close, /INVENTORY_LEDGER/);
  assert.match(operations, /inventory-control-risk/);
  assert.match(plan, /과거 Clobe·이카운트 자료를 임의로 재고수량으로 환산하지 않는다/);
});

test("VAT review reconciles explicit source and reported figures without inferring tax rates", async () => {
  const [api, view, page, schema, migration, close, operations, plan] = await Promise.all([
    read("app/api/finance/tax/route.ts"), read("app/tax-reconciliation-workspace.tsx"), read("app/page.tsx"),
    read("db/schema.ts"), read("drizzle/0028_tax_reconciliation.sql"), read("app/api/finance/close/route.ts"),
    read("app/api/operations/route.ts"), read("docs/finance-tax-reconciliation-plan.md"),
  ]);
  assert.match(schema, /financeTaxPeriods/);
  assert.match(migration, /CREATE TABLE `finance_tax_periods`/);
  assert.match(api, /financeCurrentData\.salesDaily2026\.filter/);
  assert.match(api, /TAX_RECONCILIATION_SAVED/);
  assert.match(api, /잠긴 마감월은 부가세 검토값을 변경할 수 없습니다/);
  assert.match(api, /finance_master_tax_codes WHERE status = 'ACTIVE'/);
  assert.doesNotMatch(api, /\*\s*0\.1|\/\s*10/);
  assert.match(view, /공식 신고서가 아니며 과세유형·세율·공제 여부를 자동 추정하지 않습니다/);
  assert.match(view, /홈택스 또는 이카운트 원본에서 확인했습니다/);
  assert.match(page, /\["tax", "부가세 검토", "세"\]/);
  assert.match(close, /TAX_RECONCILIATION/);
  assert.match(operations, /tax-reconciliation-due/);
  assert.match(plan, /공식 세무신고를 대신하지 않는 내부 검토 원장/);
});

test("fixed assets require explicit classification, evidence and posted straight-line depreciation", async () => {
  const [api, view, page, schema, migration, close, operations, plan] = await Promise.all([
    read("app/api/finance/fixed-assets/route.ts"), read("app/fixed-assets-workspace.tsx"), read("app/page.tsx"),
    read("db/schema.ts"), read("drizzle/0029_fixed_asset_control.sql"), read("app/api/finance/close/route.ts"),
    read("app/api/operations/route.ts"), read("docs/finance-fixed-assets-plan.md"),
  ]);
  assert.match(schema, /financeFixedAssets/);
  assert.match(schema, /financeAssetDepreciationSchedules/);
  assert.match(migration, /CREATE TABLE `finance_fixed_assets`/);
  assert.match(migration, /idx_finance_asset_depreciation_period/);
  assert.match(migration, /opening_accumulated/);
  assert.match(api, /PURCHASE_ORDER_LINE/);
  assert.match(api, /취득 증빙을 1건 이상 첨부한 후 활성화해 주세요/);
  assert.match(api, /depreciation_method.*STRAIGHT_LINE|STRAIGHT_LINE.*depreciation_method/s);
  assert.match(api, /잠긴 마감월에는 감가상각 계획을 생성할 수 없습니다/);
  assert.match(api, /ASSET_DEPRECIATION_JOURNAL_CREATED/);
  assert.match(api, /ASSET_DEPRECIATION_POSTED/);
  assert.match(api, /기초 누계상각/);
  assert.match(api, /priorPosted/);
  assert.match(api, /처분일까지의 미전기 감가상각을 먼저 처리해 주세요/);
  assert.match(view, /구매 품목은 후보일 뿐이며 담당자가 직접 자산 여부와 내용연수·계정과목을 확정합니다/);
  assert.match(view, /정액법 · 원 단위 균등배분 · 사용개시월부터 월할/);
  assert.match(page, /\["fixed-assets", "고정자산·감가상각", "고"\]/);
  assert.match(close, /FIXED_ASSET_DEPRECIATION/);
  assert.match(operations, /fixed-asset-control-risk/);
  assert.match(plan, /과거 자료와 자유입력 품목을 자동으로 자산화하지 않는다/);
});

test("project profitability uses exact sales links, bounded manual allocations and close controls", async () => {
  const [api, view, page, schema, migration, close, operations, plan, purchasing, payroll, sales] = await Promise.all([
    read("app/api/finance/project-costing/route.ts"), read("app/project-costing-workspace.tsx"), read("app/page.tsx"),
    read("db/schema.ts"), read("drizzle/0030_project_costing.sql"), read("app/api/finance/close/route.ts"),
    read("app/api/operations/route.ts"), read("docs/finance-project-costing-plan.md"),
    read("app/api/finance/purchasing/route.ts"), read("app/api/hr/payroll/route.ts"), read("app/api/sales/route.ts"),
  ]);
  for (const table of ["finance_cost_centers", "finance_project_monthly_budgets", "finance_project_allocations"]) {
    assert.match(api, new RegExp(table)); assert.match(migration, new RegExp(table));
  }
  assert.match(schema, /financeCostCenters/); assert.match(schema, /financeProjectMonthlyBudgets/); assert.match(schema, /financeProjectAllocations/);
  assert.match(api, /center\.opportunity_id = opportunity\.id/);
  assert.match(api, /Number\(allocated\?\.amount \?\? 0\) \+ allocationAmount > source\.amount/);
  assert.match(api, /영업기회로 자동 귀속된 매출은 수동으로 다시 배부할 수 없습니다/);
  assert.match(api, /잠긴 마감월에는 프로젝트 배부를 추가할 수 없습니다/);
  assert.match(view, /추정 자동배부 금지/); assert.match(view, /타임시트·관리자 확인 근거/);
  assert.match(page, /\["project-costing", "프로젝트·원가센터", "프"\]/); assert.match(page, /<ProjectCostingWorkspace \/>/);
  assert.match(close, /PROJECT_COST_ALLOCATION/); assert.match(operations, /project-costing-risk/);
  assert.match(purchasing, /프로젝트 원가에 배부된 매입 인보이스/);
  assert.match(payroll, /프로젝트 원가에 배부된 급여월/);
  assert.match(sales, /프로젝트 손익에 반영된 청구서/);
  assert.match(plan, /Clobe 세금계산서 스냅샷은 문서 ID가 없는 일·거래처 집계이므로 프로젝트 손익 원천으로 자동 배부할 수 없다/);
});

test("expense controls reconcile corporate cards, reviewed evidence and existing bank-payment ledgers", async () => {
  const [api, view, page, schema, migration, operations, documents, close, tasks, plan] = await Promise.all([
    read("app/api/finance/expense-control/route.ts"), read("app/expense-control-workspace.tsx"), read("app/page.tsx"),
    read("db/schema.ts"), read("drizzle/0031_expense_evidence_control.sql"), read("app/api/finance/operations/route.ts"),
    read("app/api/documents/route.ts"), read("app/api/finance/close/route.ts"), read("app/api/operations/route.ts"),
    read("docs/finance-expense-control-plan.md"),
  ]);
  for (const table of ["finance_corporate_cards", "finance_card_transactions", "finance_expense_controls"]) {
    assert.match(api, new RegExp(table)); assert.match(migration, new RegExp(table));
  }
  assert.match(schema, /financeCorporateCards/); assert.match(schema, /financeCardTransactions/); assert.match(schema, /financeExpenseControls/);
  assert.match(api, /전체 카드번호와 외화 원화환산값은 추정·저장하지 않습니다/);
  assert.match(api, /금액이 정확히 같은 승인 완료 법인카드 지출만 연결할 수 있습니다/);
  assert.match(api, /해당 지출에 첨부된 유효한 증빙 문서를 선택해 주세요/);
  assert.match(api, /완료된 증빙 검토는 재개방한 뒤 다시 확정해 주세요/);
  assert.match(api, /미대사 카드 거래를 모두 연결하거나 제외한 뒤 카드를 종료해 주세요/);
  assert.match(api, /DEDUCTIBLE.*NONDEDUCTIBLE.*OUT_OF_SCOPE/s);
  assert.match(view, /증빙 파일 존재만으로 적격성을 자동 확정하지 않습니다/);
  assert.match(view, /카드사 거래 참조값/);
  assert.match(page, /\["expense-control", "법인카드·지출증빙", "증"\]/); assert.match(page, /<ExpenseControlWorkspace \/>/);
  assert.match(operations, /지급 전 법인카드·지출증빙 화면에서 증빙과 세무 처리를 검토해 주세요/);
  assert.match(operations, /실제 카드 승인 거래와 정확한 금액으로 대사한 후/);
  assert.match(operations, /card_transaction_status !== "MATCHED"/);
  assert.match(documents, /검토 완료된 지출증빙입니다/);
  assert.match(close, /EXPENSE_SPEND_CONTROL/); assert.match(tasks, /expense-control-risk/);
  assert.match(plan, /기존 `finance_expense_requests`, 지급원장, 전표, 은행 대사를 회계 원천으로 유지한다/);
  assert.match(plan, /카드번호 전체값, CVC, 유효기간 저장/);
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

test("employee lifecycle uses side-by-side collapsible onboarding and retirement cards", async () => {
  const [workspace, styles] = await Promise.all([
    read("app/hr-workspace.tsx"),
    read("public/hr-workspace.css"),
  ]);
  assert.match(workspace, /className="lifecycle-board"/);
  assert.match(workspace, /id="onboarding-heading">입사 관리/);
  assert.match(workspace, /id="offboarding-heading">퇴직자 관리/);
  assert.match(workspace, /const \[expandedCards, setExpandedCards\] = useState<Set<string>>/);
  assert.match(workspace, /aria-expanded=\{expanded\}/);
  assert.match(workspace, /toggleCard\(cardId\)/);
  assert.match(styles, /\.lifecycle-board \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 900px\) \{ \.lifecycle-board \{ grid-template-columns: 1fr;/);
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

test("sales incentives require triple validation, collected cash, staged review and one payroll application", async () => {
  const [api, governance, engine, documents, operations, migration, schema] = await Promise.all([
    read("app/api/sales/route.ts"),
    read("app/incentive-governance.tsx"), read("app/approval-engine.ts"), read("app/api/documents/route.ts"),
    read("app/api/operations/route.ts"), read("drizzle/0033_incentive_governance.sql"), read("db/schema.ts"),
  ]);
  assert.match(api, /status === "ACTIVE"/);
  assert.match(api, /"UNVERIFIED"/);
  const control = await read("app/api/sales/incentives/route.ts");
  assert.match(control, /requiredValidations = \["POLICY", "EXAMPLE", "HISTORICAL"\]/);
  assert.match(control, /recognitionBasis: "CUMULATIVE_COLLECTED_PAYMENT_TRUE_UP"/);
  assert.match(control, /PROJECT_ALLOCATED_ACTUAL_COST_WITH_DRAFT_FALLBACK/);
  assert.match(control, /costQuality: hasActualCost \? "ACTUAL_PROJECT_COST" : "EXPECTED_COST_FALLBACK"/);
  assert.match(control, /prior\.status IN \('APPROVED','PAYROLL_APPLIED'\)/);
  assert.match(control, /unresolved_prior_count/);
  assert.match(control, /clawbackCandidate: Math\.min\(0, settlementDifference\)/);
  assert.match(control, /cost_allocation_updated_at/);
  assert.match(control, /action === "VOID_RESULT"/);
  assert.match(control, /payment\.status IN \('ACCEPTED','COMPLETED'\)/);
  assert.match(control, /status = 'SALES_CONFIRMED'/);
  assert.match(control, /status = 'FINANCE_REVIEWED'/);
  assert.match(control, /targetEntityType: "INCENTIVE_RULE"/);
  assert.match(control, /targetEntityType: "INCENTIVE_RESULT"/);
  assert.match(control, /status !== "DRAFT"/);
  assert.match(control, /idx_sales_incentive_payroll_result/);
  assert.match(engine, /INCENTIVE_RULE/); assert.match(engine, /INCENTIVE_RESULT/);
  assert.match(documents, /검증 또는 승인 절차에 사용된 인센티브 근거문서/);
  assert.match(operations, /incentive-governance-risk/);
  assert.match(operations, /fallback_cost_count/);
  assert.match(operations, /clawback_count/);
  assert.match(governance, /자동 확정 없음 · 3회 교차검증/);
  assert.match(governance, /누적 확정 수금액/);
  assert.match(governance, /예상원가 대체 · 승인 불가/);
  const close = await read("app/api/finance/close/route.ts");
  assert.match(close, /INCENTIVE_SETTLEMENT_CONTROL/);
  assert.match(close, /missing_result_count/);
  for (const table of ["sales_incentive_validations", "sales_incentive_notes", "sales_incentive_payroll_links"]) {
    assert.match(migration, new RegExp(table)); assert.match(schema, new RegExp(table));
  }
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
  assert.match(workspace, /제안 수락 입사 전환/);
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

test("same-day Clobe corrections refresh sync metrics and reopen changed journal alerts", async () => {
  const api = await read("app/api/operations/route.ts");
  assert.match(api, /ON CONFLICT\(id\) DO UPDATE SET snapshot_date = excluded\.snapshot_date/);
  assert.match(api, /record_count = excluded\.record_count/);
  assert.match(api, /metrics_json = excluded\.metrics_json/);
  assert.match(api, /`\$\{syncId\}:\$\{financeCurrentData\.journalSummary\.differenceKrw\}`/);
  assert.match(api, /erp_tasks\.source_id <> excluded\.source_id[\s\S]*THEN 'OPEN'/);
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

test("management reports govern structured decisions and convert approved outcomes into one action", async () => {
  const [api, workspace, schema, migration, engine, operations, plan] = await Promise.all([
    read("app/api/finance/management-report/route.ts"), read("app/management-report-workspace.tsx"),
    read("db/schema.ts"), read("drizzle/0037_management_decision_register.sql"), read("app/approval-engine.ts"),
    read("app/api/operations/route.ts"), read("docs/finance-management-decision-register-plan.md"),
  ]);
  for (const source of [api, schema, migration]) assert.match(source, /finance_management_decisions/);
  assert.match(migration, /idx_finance_management_action_decision/);
  assert.match(api, /ADD_DECISION/);
  assert.match(api, /RESOLVE_DECISION/);
  assert.match(api, /authorizeErpRequest\(db, "finance", "approve"\)/);
  assert.match(api, /status = 'PENDING'/);
  assert.match(api, /decision_id/);
  assert.match(api, /decisionOutcomes/);
  assert.match(api, /미결정 안건을 모두 승인·보류·반려한 뒤 보고서를 개정/);
  assert.match(engine, /finance_management_decisions SET status = 'DRAFT'/);
  assert.match(workspace, /DECISION REGISTER/);
  assert.match(workspace, /후속조치 자동 생성/);
  assert.match(operations, /management-report-decisions/);
  assert.match(plan, /DRAFT → PENDING → APPROVED \| DEFERRED \| REJECTED/);
  assert.match(plan, /최대 한 건/);
});

test("management reports freeze posted profit comparisons and block submission on close ledger drift", async () => {
  const [api, workspace, ledger, integrity, plan] = await Promise.all([
    read("app/api/finance/management-report/route.ts"), read("app/management-report-workspace.tsx"),
    read("app/finance-ledger-snapshot.ts"), read("app/finance-ledger-integrity.ts"), read("docs/finance-management-statement-integration-plan.md"),
  ]);
  assert.match(ledger, /buildFinancePeriodStatementSnapshot/);assert.match(integrity, /evaluateLedgerSnapshotDrift/);
  assert.match(ledger, /status='POSTED'/);assert.match(ledger, /periodDebit === periodCredit/);
  assert.match(api, /currentStatement/);assert.match(api, /previousEqualLengthPeriod/);assert.match(api, /historicalCloseComparison/);
  assert.match(api, /CLOSE_LEDGER_DRIFT/);assert.match(api, /CLOSE_LEDGER_CHECK_FAILED/);assert.match(api, /blockingCount/);assert.match(api, /canSubmit: blockingCount === 0/);
  assert.match(api, /마감 원장 무결성 차단 항목을 해결/);
  assert.match(workspace, /전기 완료 손익과 비교/);assert.match(workspace, /2025 동일 완료월/);
  assert.match(workspace, /snapshot\.quality\.canSubmit === false/);assert.match(workspace, /이 저장본에는 전기 손익 비교가 포함되지 않았습니다/);
  assert.match(plan, /공급가액과 회계상 손익을 혼동하지 않고/);assert.match(plan, /부분월은 전년 수치를 일할 계산하지 않는다/);
  assert.match(plan, /서버와 화면 양쪽에서 결재 제출을 막는다/);
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

test("direct retirement approval activates a durable checklist and applies the due retirement once", async () => {
  const [migration, api, activator, records, workspace] = await Promise.all([
    read("drizzle/0014_talented_matthew_murdock.sql"), read("app/api/hr/operations/route.ts"),
    read("app/hr-retirements.ts"),
    read("app/api/hr/employee-records/route.ts"), read("app/hr-workspace.tsx"),
  ]);
  assert.match(migration, /hr_retirement_requests/);
  assert.match(api, /RETIREMENT_APPROVED/);
  assert.match(api, /VALUES \(\?, \?, \?, \?, 'IN_PROGRESS'/);
  assert.doesNotMatch(api, /requestType: "RETIREMENT"/);
  assert.match(api, /resource === "retirementChecklist"/);
  assert.match(activator, /WHERE retirement_date <= \? AND \(status IN \('IN_PROGRESS', 'READY'\) OR \(status = 'EFFECTIVE'/);
  assert.match(activator, /"COMPLETED" : "EFFECTIVE"/);
  assert.match(activator, /RETIREMENT_EFFECTIVE/);
  assert.match(records, /applyDueRetirements\(db\)/);
  assert.match(workspace, /작성한 내용을 확인 후 퇴직 버튼을 클릭해 주세요/);
  assert.match(workspace, />퇴직<\/button>/);
  assert.doesNotMatch(workspace, /const nextEmployee: Employee = \{[\s\S]*?status: "퇴직 예정"/);
});

test("recruitment offers move directly into the onboarding lifecycle", async () => {
  const [migration, api, workspace] = await Promise.all([
    read("drizzle/0014_talented_matthew_murdock.sql"), read("app/api/hr/recruitment/route.ts"),
    read("app/hr-workspace.tsx"),
  ]);
  assert.match(migration, /hr_offer_requests/);
  assert.match(api, /resource === "offer"/);
  assert.match(api, /'APPROVED'/);
  assert.match(api, /\["onboardingUpdate", "onboardingComplete", "onboardingCancel"\]\.includes\(resource\)/);
  assert.match(api, /resource === "onboardingCancel"/);
  assert.doesNotMatch(api, /requestType: "OFFER"/);
  assert.match(workspace, /제안 수락 입사 전환/);
  assert.match(workspace, /입사 완료/);
  assert.match(workspace, /입사 정보 수정/);
});

test("debt management keeps Clobe balances immutable and routes schedules through controlled payments", async () => {
  const [migration, schema, api, workspace, forecast, close, operations, documents, page] = await Promise.all([
    read("drizzle/0032_debt_management.sql"), read("db/schema.ts"), read("app/api/finance/debt/route.ts"),
    read("app/debt-management-workspace.tsx"), read("app/api/finance/forecast/route.ts"),
    read("app/api/finance/close/route.ts"), read("app/api/operations/route.ts"),
    read("app/api/documents/route.ts"), read("app/page.tsx"),
  ]);
  for (const table of ["finance_debt_facilities", "finance_debt_schedule_items", "finance_debt_covenant_reviews"]) {
    assert.match(migration, new RegExp(table));
    assert.match(schema, new RegExp(table));
  }
  assert.match(api, /financeCurrentData\.accounts\.filter\(\(account\) => account\.type === "LOAN"/);
  assert.match(api, /original_principal < account\.krwBalance/);
  assert.match(api, /category = '차입계약'/);
  assert.match(api, /source_type, source_id[\s\S]*'DEBT_SCHEDULE'/);
  assert.match(workspace, /자동 이자 계산 없음/);
  assert.match(workspace, /document\.category === "차입계약"/);
  assert.match(forecast, /DEBT_SCHEDULE/);
  assert.match(close, /DEBT_SCHEDULE_CONTROL/);
  assert.match(operations, /destination: "finance:debt"/);
  assert.match(documents, /활성 계약 또는 확정된 약정 검토에 사용된 근거문서/);
  assert.match(page, /"debt", "차입금·상환·약정"/);
});

test("financial system alerts require evidence, finance review and controlled closure", async () => {
  const [api, view, server, operations, documents, schema, migration, page, plan] = await Promise.all([
    read("app/api/finance/alert-actions/route.ts"), read("app/finance-alert-action-center.tsx"),
    read("app/finance-alert-actions-server.ts"), read("app/api/operations/route.ts"),
    read("app/api/documents/route.ts"), read("db/schema.ts"),
    read("drizzle/0036_finance_alert_actions.sql"), read("app/page.tsx"),
    read("docs/finance-alert-action-plan.md"),
  ]);
  for (const table of ["finance_alert_cases", "finance_alert_case_events"]) {
    assert.match(api, new RegExp(table));
    assert.match(migration, new RegExp(table));
  }
  for (const model of ["financeAlertCases", "financeAlertCaseEvents"]) assert.match(schema, new RegExp(model));
  assert.match(api, /authorizeErpRequest\(db, "finance", permission\)/);
  assert.match(api, /\["APPROVE", "REJECT", "REOPEN"\].*"approve"/);
  assert.match(api, /rootCause\.length < 5/);
  assert.match(api, /evidenceCount\(caseId\) < 1/);
  assert.match(api, /CLOSURE_APPROVED/);
  assert.match(api, /db\.batch\(\[/);
  assert.match(server, /status = 'CLOSED'/);
  assert.match(operations, /hasClosedFinanceAlertCase/);
  assert.match(operations, /중요 재무 경보는 조치계획·근거자료·재무 승인/);
  assert.match(documents, /financeAlertCase/);
  assert.match(documents, /감사 이력 보호/);
  assert.match(view, /재무 경보 조치센터/);
  assert.match(view, /증빙 확인·종료 검토 요청/);
  assert.match(page, /"risk-actions", "재무 경보 조치"/);
  assert.match(page, /"조치 등록 →"/);
  assert.match(plan, /OPEN → IN_PROGRESS → REVIEW → CLOSED/);
});

test("financial alert outcomes are frozen into treasury, management reporting and month close", async () => {
  const [reporting, model, treasuryApi, treasuryView, managementApi, managementView, closeApi, plan, page] = await Promise.all([
    read("app/finance-alert-reporting.ts"), read("app/finance-alert-reporting-model.ts"),
    read("app/api/finance/daily-treasury/route.ts"), read("app/daily-treasury-workspace.tsx"),
    read("app/api/finance/management-report/route.ts"), read("app/management-report-workspace.tsx"),
    read("app/api/finance/close/route.ts"), read("docs/finance-alert-reporting-integration-plan.md"), read("app/page.tsx"),
  ]);
  assert.match(reporting, /alert\.created_at <= \?/);
  assert.match(reporting, /document\.created_at <= \?/);
  assert.match(model, /CLOSURE_APPROVED: "CLOSED"/);
  assert.match(model, /CASE_REOPENED: "IN_PROGRESS"/);
  assert.match(model, /item\.dueDate < cutoffDate/);
  assert.match(treasuryApi, /buildFinanceAlertReportSnapshot\(db, reportDate\)/);
  assert.match(treasuryApi, /FINANCE_ALERT_ACTION/);
  assert.match(treasuryApi, /alertActions,/);
  assert.match(treasuryView, /재무 경보 조치현황/);
  assert.match(treasuryView, /snapshot\.alertActions \?\?/);
  assert.match(managementApi, /ALERT_ACTIONS_OPEN/);
  assert.match(managementApi, /ERP 재무 경보 조치원장/);
  assert.match(managementView, /ALERT ACTION CONTROL/);
  assert.match(managementView, /snapshot\.sections\.alertActions \?\?/);
  assert.match(closeApi, /FINANCE_ALERT_ACTIONS/);
  assert.match(closeApi, /highCriticalUnresolvedCount > 0 \? "FAIL"/);
  assert.match(closeApi, /alertActions\.unresolvedCount > 0 \? "REVIEW"/);
  assert.match(plan, /현재 진행 중인 월은 미래 월말이 아니라 최신 재무 원천 기준일/);
  assert.match(page, /DailyTreasuryWorkspace onNavigate/);
});

test("personal workbench merges assigned sources without copying source status", async () => {
  const [api, view, schema, migration, page, plan] = await Promise.all([
    read("app/api/workbench/route.ts"), read("app/operations-workbench.tsx"), read("db/schema.ts"),
    read("drizzle/0038_personal_workbench.sql"), read("app/page.tsx"),
    read("docs/personal-operations-workbench-plan.md"),
  ]);
  assert.match(api, /owner_employee_id = \?/);
  assert.match(api, /id NOT IN \('management-report-actions','management-report-decisions'\)/);
  assert.match(api, /finance_management_report_actions/);
  assert.match(api, /finance_management_decisions/);
  assert.match(api, /Date\.now\(\) \+ 9 \* 60 \* 60 \* 1000/);
  assert.match(api, /ON CONFLICT\(employee_id, item_type, item_id\)/);
  assert.match(api, /본인에게 배정된 업무만/);
  assert.match(api, /canWriteOperations/);
  assert.match(api, /canWriteFinance/);
  assert.doesNotMatch(migration, /\bstatus\b/i);
  assert.match(schema, /erpWorkbenchPreferences/);
  assert.match(view, /fetch\("\/api\/workbench"\)/);
  assert.match(view, /fetch\(isTask \? "\/api\/operations" : "\/api\/finance\/management-report"/);
  assert.match(view, /오늘의 업무/);
  assert.match(view, /경영 의사결정/);
  assert.match(page, /<OperationsWorkbench/);
  assert.match(page, /오늘 업무 전체 보기/);
  assert.match(plan, /상태의 진실은 각 원천 원장이 소유한다/);
  assert.match(plan, /다른 사용자가 읽거나 수정할 수 없게 한다/);
});

test("workforce planning versions approved headcount and derives actual staffing from HR sources", async () => {
  const [api, view, workspace, schema, migration, approval, plan, operations] = await Promise.all([
    read("app/api/hr/workforce-plans/route.ts"), read("app/workforce-planning-view.tsx"),
    read("app/hr-workspace.tsx"), read("db/schema.ts"), read("drizzle/0039_workforce_planning.sql"),
    read("app/approval-engine.ts"), read("docs/hr-workforce-planning-plan.md"), read("app/api/operations/route.ts"),
  ]);
  assert.match(api, /authorizeErpRequest\(db, "hr", "read"\)/);
  assert.match(api, /authorizeErpRequest\(db, "hr", "write"\)/);
  assert.match(api, /companyEmployees\.map/);
  assert.match(api, /employee\.status !== "퇴직" && employee\.status !== "입사 예정"/);
  assert.match(api, /employee\.status === "입사 예정"/);
  assert.match(api, /Math\.max\(0, approvedHeadcount - projected\)/);
  assert.match(api, /예상 가동 인원보다 정원이 적으면/);
  assert.match(api, /requestType: "WORKFORCE_PLAN"/);
  assert.match(api, /targetEntityType: "HR_WORKFORCE_PLAN"/);
  assert.match(view, /지원자 수는 포함하지 않으며/);
  assert.match(view, /승인 정원/);
  assert.match(workspace, /<WorkforcePlanningView/);
  assert.match(schema, /hrWorkforcePlans/);
  assert.match(schema, /hrWorkforcePlanLines/);
  assert.match(migration, /idx_hr_workforce_plan_period_version/);
  assert.match(migration, /idx_hr_workforce_plan_line_org/);
  assert.match(approval, /WORKFORCE_PLAN: "인력계획 승인"/);
  assert.match(approval, /targetEntityType === "HR_WORKFORCE_PLAN"/);
  assert.match(approval, /status = 'SUPERSEDED'/);
  assert.match(operations, /workforce-gap-\$\{plan\.period\}/);
  assert.match(operations, /destination: "hr:workforce"/);
  assert.match(plan, /지원자 수는 채용 경쟁도이지 확보 인원이 아니므로/);
  assert.match(plan, /DRAFT → SUBMITTED → APPROVED/);
});

test("recruitment requisitions reserve approved gaps and link applicants through accepted offers", async () => {
  const [api, recruitment, view, workspace, schema, migration, approval, plan] = await Promise.all([
    read("app/api/hr/recruitment-requisitions/route.ts"), read("app/api/hr/recruitment/route.ts"),
    read("app/recruitment-requisition-view.tsx"), read("app/hr-workspace.tsx"), read("db/schema.ts"),
    read("drizzle/0040_recruitment_requisitions.sql"), read("app/approval-engine.ts"),
    read("docs/hr-recruitment-requisition-plan.md"),
  ]);
  assert.match(api, /authorizeErpRequest\(db, "recruitment", "read"\)/);
  assert.match(api, /line\.approved_headcount - projected/);
  assert.match(api, /\["DRAFT", "SUBMITTED", "OPEN"\]/);
  assert.match(api, /availableHeadcount: Math\.max\(0, hiringGap - reserved\)/);
  assert.match(api, /requestType: "REQUISITION"/);
  assert.match(api, /targetEntityType: "HR_RECRUITMENT_REQUISITION"/);
  assert.match(recruitment, /requisition_id/);
  assert.match(recruitment, /요청 인원이 이미 모두 충원되었습니다/);
  assert.match(recruitment, /status = 'FILLED'/);
  assert.match(view, /채용요청·TO 관리/);
  assert.match(view, /지원자 수는 충원 인원으로 계산하지 않습니다/);
  assert.match(workspace, /<RecruitmentRequisitionView/);
  assert.match(workspace, /채용요청·TO/);
  assert.match(schema, /hrRecruitmentRequisitions/);
  assert.match(migration, /ALTER TABLE `hr_applicants` ADD `requisition_id`/);
  assert.match(approval, /REQUISITION: "채용요청 승인"/);
  assert.match(approval, /targetEntityType === "HR_RECRUITMENT_REQUISITION"/);
  assert.match(plan, /추가 기안 가능 = 계획 부족 - 예약 TO/);
});

test("performance management separates goals, reviews, calibration, approval and appeals", async () => {
  const [api, view, workspace, schema, migration, approval, operations, plan] = await Promise.all([
    read("app/api/hr/performance/route.ts"), read("app/performance-management-view.tsx"),
    read("app/hr-workspace.tsx"), read("db/schema.ts"), read("drizzle/0041_performance_management.sql"),
    read("app/approval-engine.ts"), read("app/api/operations/route.ts"), read("docs/hr-performance-management-plan.md"),
  ]);
  assert.match(api, /authorizeErpRequest\(db, "hr", "read"\)/);
  assert.match(api, /employee\.status !== "퇴직" && employee\.status !== "입사 예정"/);
  assert.match(api, /totals\?\.weight !== 100/);
  assert.match(api, /action === "DELETE_GOAL"/);
  assert.match(api, /!item\.manager_employee_id/);
  assert.match(api, /actual_value IS NULL OR length\(trim\(evidence\)\) < 5/);
  assert.match(api, /reviewerType === "SELF"/);
  assert.match(api, /reviewerType === "MANAGER"/);
  assert.match(api, /reviewerType === "CALIBRATION"/);
  assert.match(api, /14 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(api, /requestType: "PERFORMANCE_CYCLE"/);
  assert.match(api, /targetEntityType: "HR_PERFORMANCE_CYCLE"/);
  assert.match(view, /평가 제출·잠금/);
  assert.match(view, /resolveAppeal/);
  assert.match(view, /급여·승진·강등에 자동 반영되지 않습니다/);
  assert.match(workspace, /<PerformanceManagementView/);
  assert.match(schema, /hrPerformanceCycles/);
  assert.match(schema, /hrPerformanceParticipants/);
  assert.match(schema, /hrPerformanceGoals/);
  assert.match(schema, /hrPerformanceReviews/);
  assert.match(schema, /hrPerformanceAppeals/);
  assert.match(migration, /idx_hr_performance_participant_cycle_employee/);
  assert.match(migration, /idx_hr_performance_review_participant_type/);
  assert.match(approval, /PERFORMANCE_CYCLE: "성과평가 최종확정"/);
  assert.match(approval, /targetEntityType === "HR_PERFORMANCE_CYCLE"/);
  assert.match(operations, /performance-cycle-\$\{cycle\.id\}/);
  assert.match(operations, /destination: "hr:performance"/);
  assert.match(plan, /급여·승진·강등에 자동 반영하지 않는다/);
});

test("training management snapshots employees and requires evidence for mandatory completion", async () => {
  const [api, view, workspace, schema, migration, operations, plan] = await Promise.all([
    read("app/api/hr/training/route.ts"), read("app/training-management-view.tsx"), read("app/hr-workspace.tsx"),
    read("db/schema.ts"), read("drizzle/0042_hr_training_management.sql"), read("app/api/operations/route.ts"),
    read("docs/hr-training-management-plan.md"),
  ]);
  assert.match(api, /employee\.status !== "퇴직" && employee\.status !== "입사 예정"/);
  assert.match(api, /ON CONFLICT\(course_id, employee_id\) DO NOTHING/);
  assert.match(api, /course\.course_type === "MANDATORY" && \(!evidenceName \|\| !evidenceRef\)/);
  assert.match(api, /action === "VERIFY_ASSIGNMENT"/);
  assert.match(api, /assignment\.status !== "SUBMITTED"/);
  assert.match(api, /status NOT IN \('COMPLETED', 'WAIVED'\)/);
  assert.match(api, /reason\.length < 10/);
  assert.match(view, /수료 증빙, 면제와 미이수 알림/);
  assert.match(view, /급여·평가·승진에 자동 반영되지 않습니다/);
  assert.match(workspace, /<TrainingManagementView/);
  assert.match(schema, /hrTrainingCourses/);
  assert.match(schema, /hrTrainingAssignments/);
  assert.match(migration, /idx_hr_training_assignment_course_employee/);
  assert.match(operations, /training-course-\$\{course\.id\}/);
  assert.match(operations, /destination: "hr:training"/);
  assert.match(plan, /법정교육은 증빙 없는 완료를 허용하지 않음/);
});

test("HR analytics aggregates ledgers without exposing employee identifiers", async () => {
  const [api, view, workspace, schema, migration, plan] = await Promise.all([
    read("app/api/hr/analytics/route.ts"), read("app/hr-analytics-view.tsx"), read("app/hr-workspace.tsx"),
    read("db/schema.ts"), read("drizzle/0043_hr_analytics_reports.sql"), read("docs/hr-analytics-reporting-plan.md"),
  ]);
  assert.match(api, /authorizeErpRequest\(db, "hr", "read"\)/);
  assert.match(api, /기간 중 퇴직자 ÷ 기간 시작·종료 평균 재직자/);
  assert.match(api, /c\.status = 'FINALIZED' AND p\.status = 'FINALIZED'/);
  assert.match(api, /item\.assignment_status === "SUBMITTED"/);
  assert.match(api, /if \(!canSensitive\) return Response\.json\(\{ error: "저장 리포트는 HR 관리자만 열 수 있습니다/);
  assert.match(api, /HR_ANALYTICS_REPORT_GENERATED/);
  assert.match(api, /COALESCE\(MAX\(version\), 0\) \+ 1/);
  assert.doesNotMatch(api, /employeeName.*csv|email.*csv|phone.*csv/i);
  assert.match(view, /개인 이름·사번·이메일·연락처·생년월일/);
  assert.match(view, /CSV 내보내기/);
  assert.match(workspace, /<HrAnalyticsView/);
  assert.match(schema, /hrAnalyticsReports/);
  assert.match(migration, /idx_hr_analytics_report_period_version/);
  assert.match(plan, /급여와 성과평가 집계는 HR 관리자 또는 최고관리자에게만 제공/);
});

test("sales CRM preserves customer activities and governs stage transitions", async () => {
  const [sales, crm, view, operations, schema, migration, plan] = await Promise.all([
    read("app/api/sales/route.ts"), read("app/api/sales/crm/route.ts"), read("app/sales-workspace.tsx"),
    read("app/api/operations/route.ts"), read("db/schema.ts"), read("drizzle/0044_sales_crm_governance.sql"),
    read("docs/sales-crm-governance-plan.md"),
  ]);
  assert.match(sales, /nextStage\[before\.stage\] !== stage/);
  assert.match(sales, /실주 사유를 10자 이상 입력해 주세요/);
  assert.match(sales, /document_type = 'ORDER' AND status IN \('ACCEPTED', 'COMPLETED'\)/);
  assert.match(sales, /OPPORTUNITY_STAGE_CHANGED/);
  assert.match(sales, /transition\[0\]\.meta\.changes/);
  assert.match(crm, /authorizeErpRequest\(db, "sales", "read"\)/);
  assert.match(crm, /authorizeErpRequest\(db, "sales", "write"\)/);
  assert.match(crm, /ACCOUNT_CONTACT_CREATED/);
  assert.match(crm, /OPPORTUNITY_ACTIVITY_RECORDED/);
  assert.match(crm, /WHERE id = \? AND account_id = \? AND status = 'ACTIVE'/);
  assert.match(view, /고객 담당자/);
  assert.match(view, /영업 활동 기록/);
  assert.match(view, /단계 변경 이력/);
  assert.match(operations, /sales-follow-up:\$\{opportunity\.id\}/);
  assert.match(operations, /destination: "sales:opportunity"/);
  assert.match(schema, /salesAccountContacts/);
  assert.match(schema, /salesOpportunityActivities/);
  assert.match(schema, /salesOpportunityStageHistory/);
  assert.match(migration, /idx_sales_contact_account_key/);
  assert.match(plan, /리드 → 요구 확인 → 제안 → 계약 협의 → 수주/);
});

test("sales document lines derive totals and prevent downstream quantity over-allocation", async () => {
  const [api, view, operations, schema, migration, plan] = await Promise.all([
    read("app/api/sales/route.ts"), read("app/sales-workspace.tsx"), read("app/api/operations/route.ts"),
    read("db/schema.ts"), read("drizzle/0045_sales_document_lines.sql"), read("docs/sales-document-line-governance-plan.md"),
  ]);
  assert.match(api, /resource === "catalog"/);
  assert.match(api, /SALES_CATALOG_ITEM_CREATED/);
  assert.match(api, /SALES_CATALOG_ITEM_UPDATED/);
  assert.match(api, /견적·수주·납품·청구 문서에는 품목 라인이 한 개 이상 필요합니다/);
  assert.match(api, /const amount = lines\.reduce\(\(sum, line\) => sum \+ line\.amount, 0\)/);
  assert.match(api, /json_each\(\?\) request/);
  assert.match(api, /source_line\.quantity - COALESCE/);
  assert.match(api, /child\.status <> 'CANCELLED'/);
  assert.match(api, /미취소 하위 문서가 있어 취소할 수 없습니다/);
  assert.match(view, /상품·서비스 기준정보/);
  assert.match(view, /과거 문서에는 영향이 없습니다/);
  assert.match(view, /품목 합계/);
  assert.match(view, /기존 총액 문서/);
  assert.match(view, /처리 가능한 잔여 수량/);
  assert.match(operations, /sales-document-control-risk/);
  assert.match(operations, /라인합계 불일치/);
  assert.match(schema, /salesCatalogItems/);
  assert.match(schema, /salesDocumentLines/);
  assert.match(migration, /ALTER TABLE `sales_documents` ADD `source_document_id`/);
  assert.match(migration, /idx_sales_document_line_number/);
  assert.match(migration, /PRAGMA optimize/);
  assert.match(plan, /문서 금액은 `수량 × 단가`의 라인별 반올림 합계/);
});

test("sales targets are versioned, approval-gated and forecast without double-counting invoices", async () => {
  const [api, view, workspace, approval, approvalCenter, operations, schema, migration, plan] = await Promise.all([
    read("app/api/sales/planning/route.ts"), read("app/sales-planning-view.tsx"), read("app/sales-workspace.tsx"),
    read("app/approval-engine.ts"), read("app/approval-center.tsx"), read("app/api/operations/route.ts"),
    read("db/schema.ts"), read("drizzle/0046_sales_target_forecast.sql"), read("docs/sales-target-forecast-plan.md"),
  ]);
  assert.match(api, /authorizeErpRequest\(db, "sales", "read"\)/);
  assert.match(api, /COALESCE\(MAX\(version\), 0\) \+ 1/);
  assert.match(api, /status NOT IN \('퇴직','입사 예정'\)/);
  assert.match(api, /Math\.max\(0, opportunity\.expected_revenue - \(invoicesByOpportunity\.get\(opportunity\.id\) \?\? 0\)\)/);
  assert.match(api, /document\.status IN \('ACCEPTED','COMPLETED'\)/);
  assert.match(api, /companyTargets\?\.months \?\? 0\) !== 12/);
  assert.match(api, /requestType: "TARGET_PLAN"/);
  assert.match(api, /SALES_FORECAST_SNAPSHOT_CREATED/);
  assert.match(view, /확정 청구와 미청구 가중 파이프라인을 분리/);
  assert.match(view, /비교 범위/);
  assert.match(view, /전망 저장/);
  assert.match(workspace, /<SalesPlanningView/);
  assert.match(approval, /TARGET_PLAN: "영업 목표 승인"/);
  assert.match(approval, /targetEntityType === "SALES_TARGET_PLAN"/);
  assert.match(approval, /status = 'SUPERSEDED'/);
  assert.match(approvalCenter, /TARGET_PLAN: "영업 목표 승인"/);
  assert.match(operations, /sales-forecast-governance-risk/);
  assert.match(operations, /attainment < 0\.9 \|\| drop >= 0\.1/);
  assert.match(schema, /salesTargetPlans/);
  assert.match(schema, /salesTargetLines/);
  assert.match(schema, /salesForecastSnapshots/);
  assert.match(migration, /idx_sales_target_plan_year_approved/);
  assert.match(migration, /WHERE `status` = 'APPROVED'/);
  assert.match(plan, /월 전망: 월 확정 청구 \+ 해당 월 마감 예정 미청구 가중 파이프라인/);
});

test("sales pricing uses versioned masters, immutable reviews and approval-gated quote to order", async () => {
  const [pricing, api, helper, view, workspace, approval, approvalCenter, operations, schema, migration, plan] = await Promise.all([
    read("app/api/sales/pricing/route.ts"), read("app/api/sales/route.ts"), read("app/sales-pricing.ts"),
    read("app/sales-pricing-governance.tsx"), read("app/sales-workspace.tsx"), read("app/approval-engine.ts"),
    read("app/approval-center.tsx"), read("app/api/operations/route.ts"), read("db/schema.ts"),
    read("drizzle/0048_sales_pricing_governance.sql"), read("docs/sales-pricing-governance-plan.md"),
  ]);
  assert.match(pricing, /action === "CREATE_PRICE_LIST"/);
  assert.match(pricing, /action === "UPSERT_PRICE_ITEM"/);
  assert.match(pricing, /action === "ACTIVATE_PRICE_LIST"/);
  assert.match(pricing, /authorizeErpRequest\(db, "sales", "approve"\)/);
  assert.match(pricing, /action === "CREATE_POLICY"/);
  assert.match(pricing, /action === "ACTIVATE_POLICY"/);
  assert.match(pricing, /action === "REQUEST_EXCEPTION"/);
  assert.match(pricing, /requestType: "DISCOUNT"/);
  assert.match(pricing, /targetEntityType: "SALES_PRICING_REVIEW"/);
  assert.match(helper, /Math\.round\(\(listAmount - document\.amount\) \/ listAmount \* 10_000\)/);
  assert.match(helper, /Math\.round\(\(document\.amount - standardCostAmount\) \/ document\.amount \* 10_000\)/);
  assert.match(helper, /"DATA_MISSING"/);
  assert.match(helper, /"EXCEPTION_REQUIRED"/);
  assert.match(helper, /\["PASS", "APPROVED"\]/);
  assert.match(api, /가격 검토를 통과하거나 예외 승인을 받은 견적만 수주로 전환/);
  assert.match(api, /가격 검토를 통과하거나 가격 예외 승인을 완료한 뒤 문서를 발행·확정/);
  assert.match(view, /가격표·할인·마진 통제/);
  assert.match(view, /시스템은 기본 할인율이나 마진율을 임의로 제안하지 않습니다/);
  assert.match(workspace, /<SalesPricingGovernance/);
  assert.match(approval, /DISCOUNT: "가격·할인 예외 승인"/);
  assert.match(approval, /targetEntityType === "SALES_PRICING_REVIEW"/);
  assert.match(approvalCenter, /가격·할인 예외 승인/);
  assert.match(operations, /sales-pricing-governance-risk/);
  assert.match(operations, /destination: "sales:pricing"/);
  assert.match(schema, /salesPriceLists/);
  assert.match(schema, /salesPriceListItems/);
  assert.match(schema, /salesPricingPolicies/);
  assert.match(schema, /salesDocumentPricingReviews/);
  assert.match(migration, /idx_sales_price_list_single_active/);
  assert.match(migration, /idx_sales_pricing_policy_single_active/);
  assert.match(migration, /sales_document_pricing_reviews/);
  assert.match(plan, /데이터 누락은 예외 승인으로 우회할 수 없다/);
});

test("sales contracts require signed evidence, obligations and governed changes before fulfillment", async () => {
  const [api, helper, sales, documents, view, workspace, approval, approvalCenter, operations, schema, migration, plan] = await Promise.all([
    read("app/api/sales/contracts/route.ts"), read("app/sales-contracts.ts"), read("app/api/sales/route.ts"),
    read("app/api/documents/route.ts"), read("app/sales-contract-management.tsx"), read("app/sales-workspace.tsx"),
    read("app/approval-engine.ts"), read("app/approval-center.tsx"), read("app/api/operations/route.ts"),
    read("db/schema.ts"), read("drizzle/0049_sales_contract_lifecycle.sql"), read("docs/sales-contract-lifecycle-plan.md"),
  ]);
  assert.match(api, /action === "CREATE_CONTRACT"/);
  assert.match(api, /document_type = 'ORDER' AND status IN \('ACCEPTED','COMPLETED'\)/);
  assert.match(api, /action === "ADD_OBLIGATION"/);
  assert.match(api, /서명 계약서와 최소 1개의 이행 의무/);
  assert.match(api, /requestType: "CONTRACT"/);
  assert.match(api, /targetEntityType: "SALES_CONTRACT"/);
  assert.match(api, /action === "REQUEST_CHANGE"/);
  assert.match(api, /이미 결재 또는 적용 대기 중인 계약 변경/);
  assert.match(api, /requestType: "CONTRACT_CHANGE"/);
  assert.match(api, /action === "APPLY_SCHEDULED_CHANGE"/);
  assert.match(api, /OBLIGATION_EVIDENCE/);
  assert.match(helper, /enforcement_started_at/);
  assert.match(helper, /order\.created_at >=/);
  assert.match(helper, /도입 이후 수주는 승인된 계약 원장/);
  assert.match(sales, /getSalesContractGate/);
  assert.match(documents, /entityType === "salesContract"/);
  assert.match(documents, /entityType === "salesContractObligation"/);
  assert.match(documents, /감사 이력 보호/);
  assert.match(view, /계약·이행 관리/);
  assert.match(view, /서명 계약서/);
  assert.match(view, /계약 변경요청/);
  assert.match(workspace, /<SalesContractManagement/);
  assert.match(approval, /CONTRACT: "계약 활성화 승인"/);
  assert.match(approval, /CONTRACT_CHANGE: "계약 변경 승인"/);
  assert.match(approval, /targetEntityType === "SALES_CONTRACT"/);
  assert.match(approval, /targetEntityType === "SALES_CONTRACT_CHANGE"/);
  assert.match(approval, /'SCHEDULED'/);
  assert.match(approvalCenter, /계약 활성화 승인/);
  assert.match(operations, /sales-contract-lifecycle-risk/);
  assert.match(operations, /갱신 통지 도래/);
  assert.match(schema, /salesContracts/);
  assert.match(schema, /salesContractObligations/);
  assert.match(schema, /salesContractChangeRequests/);
  assert.match(migration, /idx_sales_contract_order/);
  assert.match(migration, /idx_sales_contract_number/);
  assert.match(plan, /도입 이전 수주는 기존 운영을 보존/);
});

test("after-sales service governs SLA, return quantities, evidence, approval and downstream completion", async () => {
  const [api, service, documents, approval, approvalCenter, operations, workspace, schema, migration, plan] = await Promise.all([
    read("app/api/sales/service/route.ts"),
    read("app/sales-service-management.tsx"),
    read("app/api/documents/route.ts"),
    read("app/approval-engine.ts"),
    read("app/approval-center.tsx"),
    read("app/api/operations/route.ts"),
    read("app/sales-workspace.tsx"),
    read("db/schema.ts"),
    read("drizzle/0050_sales_service_control.sql"),
    read("docs/sales-service-control-plan.md"),
  ]);
  assert.match(api, /status = 'ACTIVE'/);
  assert.match(api, /활성 SLA가 없어 최초응답과 해결기한을 직접 입력/);
  assert.match(api, /reserved_milli/);
  assert.match(api, /quantityMilli > Math\.round\(source\.quantity \* 1000\) - Number\(source\.reserved_milli\)/);
  assert.match(api, /REMOVE_RETURN_LINE/);
  assert.match(api, /reservedRefund/);
  assert.match(api, /SERVICE_EVIDENCE/);
  assert.match(api, /requestType: "SERVICE_RESOLUTION"/);
  assert.match(api, /authorizeErpRequest\(db, "finance", "write"\)/);
  assert.match(api, /'SALES_RETURN_IN'/);
  assert.match(api, /finance_status !== "PAID"/);
  assert.match(documents, /entityType === "salesServiceCase"/);
  assert.match(documents, /고객지원 근거문서는 삭제할 수 없습니다/);
  assert.match(approval, /SERVICE_POLICY: "고객지원 SLA 승인"/);
  assert.match(approval, /SERVICE_RESOLUTION: "고객 이슈 처리 승인"/);
  assert.match(approval, /targetEntityType === "SALES_SERVICE_POLICY"/);
  assert.match(approval, /targetEntityType === "SALES_SERVICE_CASE"/);
  assert.match(approval, /'SALES_SERVICE_REFUND'/);
  assert.match(approval, /'SALES_SERVICE_EXCHANGE'/);
  assert.match(approval, /'SALES_SERVICE_DISPOSITION'/);
  assert.match(approvalCenter, /고객지원 SLA 승인/);
  assert.match(operations, /sales-service-control-risk/);
  assert.match(service, /고객지원·반품 관리/);
  assert.match(service, /최초 고객 응답/);
  assert.match(service, /후속조치 확인 후 종결/);
  assert.match(workspace, /<SalesServiceManagement/);
  assert.match(schema, /salesServiceCases/);
  assert.match(schema, /salesServiceReturnLines/);
  assert.match(migration, /idx_sales_service_policy_active_priority/);
  assert.match(api, /INSERT INTO sales_service_return_lines[\s\S]*SELECT \?, service\.id, source_line\.id/);
  assert.match(api, /transition\.meta\.changes/);
  assert.match(plan, /상품 매핑이나 원가는 추정하지 않는다/);
  assert.match(plan, /동시 요청/);
});

test("HR audio transcription separates consent, AI attempts and one-time human review", async () => {
  const [api, control, employeeApi, applicantApi, workspace, schema, migration, plan] = await Promise.all([
    read("app/api/hr/transcriptions/route.ts"),
    read("app/audio-transcription-control.tsx"),
    read("app/api/hr/interviews/route.ts"),
    read("app/api/hr/applicant-interview-recordings/route.ts"),
    read("app/hr-workspace.tsx"),
    read("db/schema.ts"),
    read("drizzle/0051_hr_audio_transcriptions.sql"),
    read("docs/hr-audio-transcription-plan.md"),
  ]);
  assert.match(api, /@cf\/openai\/whisper-large-v3-turbo/);
  assert.match(api, /consentConfirmed !== true/);
  assert.match(api, /authorizeErpRequest\(bindings\.DB, entityModules\[entityType\], "write"\)/);
  assert.match(api, /audio\.size > 10 \* 1024 \* 1024/);
  assert.match(api, /QUOTA_EXCEEDED/);
  assert.match(api, /reviewed_at IS NULL/);
  assert.match(api, /HR_AUDIO_TRANSCRIBED/);
  assert.match(api, /HR_AUDIO_TRANSCRIPTION_REVIEWED/);
  assert.match(control, /Cloudflare Workers AI로 전송/);
  assert.match(control, /사용자 검토 확정/);
  assert.match(employeeApi, /녹음 당사자의 동의 확인/);
  assert.match(applicantApi, /지원자의 동의 확인/);
  assert.match(workspace, /실시간 전사 초안/);
  assert.match(workspace, /<AudioTranscriptionControl entityType="EMPLOYEE_INTERVIEW"/);
  assert.match(workspace, /<AudioTranscriptionControl entityType="APPLICANT_INTERVIEW"/);
  assert.match(schema, /hrAudioTranscriptions/);
  assert.match(migration, /idx_hr_audio_transcription_entity_attempt/);
  assert.match(plan, /AI 원문은 수정하지 않고 사용자 검토본을 별도 필드/);
});

test("data governance control center verifies recoverability without automatic restore or deletion", async () => {
  const [api, server, view, page, operations, schema, migration, plan] = await Promise.all([
    read("app/api/data-governance/route.ts"), read("app/data-governance.ts"),
    read("app/data-governance-center.tsx"), read("app/page.tsx"), read("app/api/operations/route.ts"), read("db/schema.ts"),
    read("drizzle/0052_data_governance.sql"), read("docs/data-governance-control-plan.md"),
  ]);
  for (const source of [api, server, schema, migration]) {
    for (const table of ["erp_data_control_runs", "erp_data_control_checks", "erp_logical_snapshots",
      "erp_recovery_rehearsals", "erp_audit_exports", "erp_retention_policies"]) assert.match(source, new RegExp(table));
  }
  assert.match(api, /authorizeErpRequest\(db, "settings", "admin"\)/);
  assert.match(api, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(api, /productionWrites: 0/);
  assert.match(api, /totalRows > 50_000/);
  assert.match(api, /20 \* 1024 \* 1024/);
  assert.match(api, /COUNT\(\*\).*10_000/s);
  assert.match(api, /bindings\.HR_AUDIO\.head/);
  assert.match(api, /auditBefore/);
  assert.match(api, /스냅샷 생성 중 감사 대상 업무 변경/);
  assert.match(api, /data-governance-attention/);
  assert.match(api, /settings:data-governance/);
  assert.match(api, /automaticRestore: false/);
  assert.match(api, /automaticDeletion: false/);
  assert.doesNotMatch(api, /DROP TABLE|DELETE FROM erp_audit_logs|DELETE FROM hr_employee_records/);
  assert.match(view, /데이터 신뢰성 통제 센터/);
  assert.match(view, /복구 모의훈련/);
  assert.match(view, /자동 복구 없음/);
  assert.match(view, /자동 삭제 없음/);
  assert.match(page, /DataGovernanceCenter/);
  assert.match(page, /데이터 통제/);
  assert.match(page, /destination === "settings:data-governance"/);
  assert.match(page, /task\.id !== "data-governance-attention"/);
  assert.match(operations, /데이터 통제 점검이 정상 상태가 된 뒤 업무가 자동 종료/);
  assert.match(plan, /실제 복구는 자동 제공하지 않는다/);
  assert.match(plan, /settings:admin/);
});

test("data integration center reconciles approved snapshots with idempotent reviewed exceptions", async () => {
  const [api, server, workspace, center, page, operations, schema, migration, plan] = await Promise.all([
    read("app/api/data-integration/route.ts"), read("app/data-integration.ts"), read("app/data-integration-workspace.tsx"),
    read("app/data-governance-center.tsx"), read("app/page.tsx"), read("app/api/operations/route.ts"),
    read("db/schema.ts"), read("drizzle/0053_data_integration_center.sql"), read("docs/data-integration-reconciliation-plan.md"),
  ]);
  for (const source of [api, server, schema, migration]) for (const table of ["erp_integration_sources", "erp_integration_exceptions", "erp_sync_run_events"]) assert.match(source, new RegExp(table));
  assert.match(api, /authorizeErpRequest\(db, "settings", "admin"\)/);
  assert.match(api, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(api, /CLOBE_FINANCE_2026/); assert.match(api, /ECOUNT_FINANCE_2024/); assert.match(api, /HIWORKS_EMPLOYEES/); assert.match(api, /PAYROLL_EXCEL_2025_2026/);
  assert.match(api, /idempotency_key/); assert.match(api, /retry_of_run_id/); assert.match(api, /ACCEPT_RISK/); assert.match(api, /note\.length < 5/);
  assert.match(api, /automaticWrites: 0, externalFetch: false/);
  assert.doesNotMatch(api, /DELETE FROM finance_bank_transactions|DELETE FROM hr_employee_records|DELETE FROM hr_payroll_records/);
  assert.match(workspace, /현재 ERP 스냅샷 검증/); assert.match(workspace, /외부 조회 없음/); assert.match(workspace, /자동 덮어쓰기 없음/);
  assert.match(center, /연동·대사/); assert.match(page, /settings:data-integration/); assert.match(page, /integration-center-attention/);
  assert.match(operations, /고위험 연동 예외를 해결하거나 근거와 함께 위험 수용/);
  assert.match(migration, /WHERE `idempotency_key` <> ''/); assert.match(plan, /자동 덮어쓰기/); assert.match(plan, /외부 API를 호출하지 않았는데 수집했다고 표시/);
});

test("enterprise audit trail is admin-only, paginated, redacted and immutable", async () => {
  const [api, workspace, center, platform, schema, migration, plan] = await Promise.all([
    read("app/api/audit-log/route.ts"), read("app/audit-log-workspace.tsx"), read("app/data-governance-center.tsx"),
    read("app/erp-platform.ts"), read("db/schema.ts"), read("drizzle/0060_erp_audit_trail.sql"),
    read("docs/erp-audit-trail-plan.md"),
  ]);
  assert.match(api, /authorizeErpRequest\(db, "settings", "admin"\)/);
  assert.match(api, /ORDER BY a\.created_at DESC, a\.id DESC LIMIT 31/);
  assert.match(api, /a\.created_at < \? OR \(a\.created_at = \? AND a\.id < \?\)/);
  assert.match(api, /secretKey\.test\(key\)/);
  assert.match(api, /automaticMutation: false/);
  assert.doesNotMatch(api, /UPDATE erp_audit_logs|DELETE FROM erp_audit_logs/);
  assert.match(workspace, /통합 감사·변경이력/);
  assert.match(workspace, /다음 30건 보기/);
  assert.match(workspace, /보안 키 값은 서버에서 가려 표시/);
  assert.match(center, /감사·변경이력/);
  for (const source of [platform, schema, migration]) assert.match(source, /idx_erp_audit_created_id/);
  assert.match(plan, /조회는 `settings:admin` 권한/);
  assert.match(plan, /수정·삭제 경로가 없다/);
});

test("controlled data intake stages immutable originals before approval and explicit application", async () => {
  const [api, server, workspace, integration, approval, schema, migration, plan] = await Promise.all([
    read("app/api/data-intake/route.ts"), read("app/data-intake.ts"), read("app/data-intake-workspace.tsx"),
    read("app/data-integration-workspace.tsx"), read("app/approval-engine.ts"), read("db/schema.ts"),
    read("drizzle/0054_controlled_data_intake.sql"), read("docs/controlled-data-intake-plan.md"),
  ]);
  for (const source of [api, server, schema, migration]) for (const table of ["erp_data_import_batches", "erp_data_import_rows", "erp_data_import_events"]) assert.match(source, new RegExp(table));
  assert.match(api, /authorizeErpRequest\(db, "settings", "admin"\)/);
  assert.match(api, /10 \* 1024 \* 1024/); assert.match(api, /slice\(0, 500\)/); assert.match(api, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(api, /readSheet/); assert.match(api, /csvRows/); assert.match(api, /JSON은 객체 배열 또는 rows 배열/);
  assert.match(api, /동일 원본이 이미 등록/); assert.match(api, /validation_status<>'VALID'/); assert.match(api, /String\(batch\.status\) !== "APPROVED"/);
  assert.match(api, /supportedApplySources/); assert.match(api, /업무 원장 반영 매핑 확정 전/); assert.match(api, /ON CONFLICT\(employee_id\) DO UPDATE/); assert.match(api, /ON CONFLICT\(id\) DO UPDATE SET annual_salary/);
  assert.match(api, /bindings\.HR_AUDIO\.put/); assert.match(api, /automaticApply: false/); assert.match(plan, /원본 자동 삭제 없음/);
  assert.match(approval, /DATA_IMPORT: "재무 데이터 반영 승인"/); assert.match(approval, /targetEntityType === "DATA_IMPORT_BATCH"/);
  assert.match(workspace, /원본 보관·검증/); assert.match(workspace, /결재 제출/); assert.match(workspace, /승인본 반영/); assert.match(integration, /DataIntakeWorkspace/);
  assert.match(plan, /자동 반영하지 않는다/); assert.match(plan, /실제 업무 원장 반영은 API 계약과 계정 매핑이 확정될 때까지 차단/);
});

test("finance import mappings are versioned, approval-gated and balance-blocking", async () => {
  const [api, server, workspace, integration, approval, schema, migration, plan] = await Promise.all([
    read("app/api/finance/import-mappings/route.ts"), read("app/finance-import-mapping.ts"), read("app/finance-import-mapping-workspace.tsx"),
    read("app/data-integration-workspace.tsx"), read("app/approval-engine.ts"), read("db/schema.ts"),
    read("drizzle/0055_finance_import_mapping.sql"), read("docs/finance-import-mapping-plan.md"),
  ]);
  for (const source of [api, server, schema, migration]) for (const table of ["finance_import_mapping_sets", "finance_import_mapping_rules", "finance_import_validations", "finance_import_canonical_rows", "finance_import_mapping_events"]) assert.match(source, new RegExp(table));
  assert.match(api, /authorizeErpRequest\(db, "settings", "admin"\)/); assert.match(api, /requestType: "IMPORT_MAPPING"/); assert.match(api, /status='ACTIVE'/);
  assert.match(api, /분개장 차변·대변/); assert.match(api, /기간 차변·대변/); assert.match(api, /파일 내부 거래 ID 중복/); assert.match(api, /은행계좌 또는 GL 미연결/);
  assert.match(api, /mapping_method.*MANUAL/); assert.match(api, /exactMatchOnly: true/); assert.match(api, /directPosting: false/);
  assert.match(approval, /IMPORT_MAPPING: "재무 파일 매핑 승인"/); assert.match(approval, /targetEntityType === "FINANCE_IMPORT_MAPPING_SET"/); assert.match(approval, /status='SUPERSEDED'/);
  assert.match(workspace, /자동 유사매칭 없음/); assert.match(workspace, /차대변 1원 차이도/); assert.match(workspace, /운영 총계정원장이 아닌 검증용 스테이징/); assert.match(integration, /FinanceImportMappingWorkspace/);
  assert.match(migration, /WHERE `status` = 'ACTIVE'/); assert.match(plan, /명칭 유사도 자동 병합은 하지 않는다/); assert.match(plan, /운영 총계정원장 전기를 의미하지 않는다/);
});

test("finance posting control preserves multi-line lineage and requires tax, period and approval gates", async () => {
  const [api, server, workspace, integration, approval, close, schema, migration, plan] = await Promise.all([
    read("app/api/finance/posting-control/route.ts"), read("app/finance-posting.ts"), read("app/finance-posting-workspace.tsx"),
    read("app/data-integration-workspace.tsx"), read("app/approval-engine.ts"), read("app/api/finance/close/route.ts"), read("db/schema.ts"),
    read("drizzle/0056_finance_posting_control.sql"), read("docs/finance-posting-control-plan.md"),
  ]);
  for (const source of [api, server, schema, migration]) for (const table of ["finance_posting_batches", "finance_posting_vouchers", "finance_posting_lines", "finance_posting_events"]) assert.match(source, new RegExp(table));
  assert.match(api, /authorizeErpRequest\(db, "finance", "admin"\)/); assert.match(api, /validation\.status='PASSED'/); assert.match(api, /validation\.data_type='JOURNAL'/);
  assert.match(api, /total_debit.*total_credit/); assert.match(api, /tax_review_status !== "REVIEWED"/); assert.match(api, /finance_close_runs WHERE period IN/); assert.match(api, /미개방 회계기간/);
  assert.match(api, /requestType:"JOURNAL_POSTING"/); assert.match(api, /status='APPROVED'/); assert.match(api, /source_canonical_row_id/); assert.match(api, /reversal_of_line_id/);
  assert.match(api, /Number\(line\.credit_amount\), Number\(line\.debit_amount\)/); assert.doesNotMatch(api, /DELETE FROM finance_posting_batches WHERE id=\? AND status='POSTED'/);
  assert.match(approval, /JOURNAL_POSTING: "분개 전기 승인"/); assert.match(approval, /targetEntityType === "FINANCE_POSTING_BATCH"/);
  assert.match(close, /ensureFinancePostingSchema/); assert.match(close, /status IN \('DRAFT','SUBMITTED','APPROVED'\)/);
  assert.match(close, /통제 분개 미전기 배치/); assert.match(close, /period_from <= \? AND period_to >= \?/);
  assert.match(workspace, /금액 수정 금지/); assert.match(workspace, /수정분개만 허용/); assert.match(workspace, /승인본 전기/); assert.match(integration, /FinancePostingWorkspace/);
  assert.match(migration, /WHERE `source_canonical_row_id` <> ''/); assert.match(migration, /WHERE `reversal_of_batch_id` <> ''/); assert.match(plan, /전기된 전표는 수정·삭제하지 않는다/); assert.match(plan, /현재 월이 아닌데 마감 원장 자체가 없는 기간도 미개방/);
});

test("general ledger joins both posted ledgers to the immutable 2025 closing baseline", async () => {
  const [api, server, workspace, page, plan] = await Promise.all([
    read("app/api/finance/general-ledger/route.ts"), read("app/finance-general-ledger.ts"),
    read("app/general-ledger-workspace.tsx"), read("app/page.tsx"), read("docs/finance-general-ledger-plan.md"),
  ]);
  assert.match(api, /authorizeErpRequest\(db, "finance", "read"\)/);
  assert.match(api, /financeHistoricalData\.trialBalance2025/);
  assert.match(api, /finance_posting_batches batch ON batch\.id=voucher\.batch_id AND batch\.status='POSTED'/);
  assert.match(api, /finance_journal_entries WHERE status='POSTED'/);
  assert.match(api, /openingDifference/); assert.match(api, /periodDifference/); assert.match(api, /endingDifference/);
  assert.match(server, /row\.voucherDate < from/); assert.match(api, /ledgerRows\("2026-01-01", to\)/);
  assert.match(api, /stagedOrClobeRowsIncluded: false/); assert.match(api, /Content-Disposition/); assert.match(api, /\^\[=\+\\-@\]/);
  assert.match(workspace, /총계정원장·2026 시산표/); assert.match(workspace, /CSV 내려받기/); assert.match(workspace, /검증 스테이징과 Clobe 원문은 포함하지 않습니다/);
  assert.match(page, /GeneralLedgerWorkspace/); assert.match(page, /총계정원장·시산표/);
  assert.match(plan, /지급 전표.*외부 다행 분개/); assert.match(plan, /초안·결재 중·승인 후 미전기/);
});

test("opening balances require a balanced immutable draft and final electronic approval", async()=>{
  const[api,server,control,ledger,approval,schema,migration,plan]=await Promise.all([read("app/api/finance/opening-balance/route.ts"),read("app/finance-opening-balance.ts"),read("app/opening-balance-control.tsx"),read("app/api/finance/general-ledger/route.ts"),read("app/approval-engine.ts"),read("db/schema.ts"),read("drizzle/0057_finance_opening_balance.sql"),read("docs/finance-opening-balance-plan.md")]);
  for(const source of[api,server,schema,migration])for(const table of["finance_opening_balance_sets","finance_opening_balance_lines","finance_opening_balance_events"])assert.match(source,new RegExp(table));
  assert.match(api,/authorizeErpRequest\(db,"finance","admin"\)/);assert.match(api,/difference_amount/);assert.match(api,/requestType:"OPENING_BALANCE"/);assert.match(server,/crypto\.subtle\.digest\("SHA-256"/);assert.doesNotMatch(api,/UPDATE finance_opening_balance_lines|DELETE FROM finance_opening_balance/);
  assert.match(approval,/OPENING_BALANCE: "개시잔액 기준선 승인"/);assert.match(approval,/FINANCE_OPENING_BALANCE_SET/);assert.match(ledger,/approvedOpeningRows/);assert.match(ledger,/openingApprovedReference: Boolean\(opening\)/);
  assert.match(control,/금액 편집 없이 생성/);assert.match(control,/개시잔액 결재 제출/);assert.match(migration,/WHERE `status`='APPROVED'/);assert.match(plan,/승인 전 참고값/);assert.match(plan,/수정과 삭제 API를 제공하지 않는다/);
});

test("operational statements and month close freeze only approved posted ledger evidence",async()=>{
  const[api,server,snapshot,workspace,close,plan]=await Promise.all([read("app/api/finance/general-ledger/route.ts"),read("app/finance-general-ledger.ts"),read("app/finance-ledger-snapshot.ts"),read("app/general-ledger-workspace.tsx"),read("app/api/finance/close/route.ts"),read("docs/finance-operational-statements-plan.md")]);
  assert.match(api,/buildOperationalFinancialStatements/);assert.match(api,/statements/);assert.match(api,/statementOfficial/);
  assert.match(server,/periodDebit.*periodCredit/);assert.match(server,/equationDifference/);assert.match(server,/unclassifiedAccounts/);
  assert.match(snapshot,/finance_posting_batches batch ON batch\.id=voucher\.batch_id AND batch\.status='POSTED'/);
  assert.match(snapshot,/finance_journal_entries[\s\S]*status='POSTED'/);assert.match(snapshot,/crypto\.subtle\.digest\("SHA-256"/);
  assert.match(workspace,/2026 손익계산서·재무상태표/);assert.match(workspace,/검토용 초안/);assert.match(workspace,/공식화 전 확인/);
  assert.match(close,/buildFinanceLedgerSnapshot/);assert.match(close,/APPROVED_OPENING_BALANCE/);assert.match(close,/GENERAL_LEDGER_BALANCE/);
  assert.match(close,/openingChecksum/);assert.match(close,/ledgerHash/);assert.match(close,/ledgerSnapshot/);
  assert.match(plan,/세금계산서 통계.*직접 합산하지 않는다/);assert.match(plan,/월마감 제출 직전에 원장을 다시 계산/);
});

test("statement comparisons disclose source scope and submitted closes detect ledger drift",async()=>{
  const[api,server,workspace,close,closeWorkspace,integrity,plan]=await Promise.all([read("app/api/finance/general-ledger/route.ts"),read("app/finance-general-ledger.ts"),read("app/general-ledger-workspace.tsx"),read("app/api/finance/close/route.ts"),read("app/finance-close-workspace.tsx"),read("app/finance-ledger-integrity.ts"),read("docs/finance-comparison-drift-plan.md")]);
  assert.match(server,/previousEqualLengthPeriod/);assert.match(server,/completedMonthsInRange/);assert.match(server,/historicalCloseComparison/);
  assert.match(api,/previousPeriod/);assert.match(api,/priorYearRule/);assert.match(api,/부분월은 일할 계산하지 않습니다/);
  assert.match(workspace,/직전 동일 일수/);assert.match(workspace,/2025 동일 완료월/);assert.match(workspace,/2025 비교값은 매출-순이익 역산/);
  assert.match(close,/evaluateLedgerSnapshotDrift/);assert.match(integrity,/frozen\.ledgerHash !== current\.ledgerHash/);assert.match(integrity,/openingChanged/);assert.match(integrity,/lineCountDelta/);
  assert.match(closeWorkspace,/마감 이후 원장 변동 감지/);assert.match(closeWorkspace,/재개방 결재 요청/);assert.match(close,/재개방 승인이 필요합니다/);
  assert.match(plan,/자동 수정하거나 마감을 자동 재개방하지 않는다/);assert.match(plan,/회계 정확성 자체의 보증이 아니라 원장 계보 무결성/);
});

test("finance assistant answers from posted evidence and discloses source lineage and limitations",async()=>{
  const[api,evidence,page,style,plan]=await Promise.all([read("app/api/finance/assistant/route.ts"),read("app/finance-assistant-evidence.ts"),read("app/page.tsx"),read("app/globals.css"),read("docs/finance-assistant-evidence-plan.md")]);
  assert.match(api,/buildFinancePeriodStatementSnapshot/);assert.match(api,/buildFinanceLedgerSnapshot/);assert.match(api,/evaluateLedgerSnapshotDrift/);
  assert.match(api,/finance_close_runs/);assert.match(api,/RULE_BASED_FALLBACK/);assert.match(api,/quotaExceeded/);
  assert.match(evidence,/JSON 근거에 들어 있는 사실과 숫자만 사용/);assert.match(evidence,/taxInvoices2026.*회계상 매출/s);
  assert.match(page,/이번 답변의 근거/);assert.match(page,/assistantMeta\.limitations/);assert.match(page,/마감 원장 변경 여부/);
  assert.match(style,/assistant-trust-line/);assert.match(style,/assistant-limitations/);
  assert.match(plan,/AI는 구조화된 근거 JSON을 설명만/);assert.match(plan,/규칙 기반 답변/);
});

test("finance assistant audit history freezes evidence and restores prior answers without mutation routes",async()=>{
  const[api,history,page,style,schema,migration,plan]=await Promise.all([read("app/api/finance/assistant/route.ts"),read("app/finance-assistant-history.ts"),read("app/page.tsx"),read("app/globals.css"),read("db/schema.ts"),read("drizzle/0058_finance_assistant_history.sql"),read("docs/finance-assistant-history-plan.md")]);
  for(const source of[history,schema,migration])assert.match(source,/finance_assistant_answers/);
  assert.match(api,/export async function GET/);assert.match(api,/saveFinanceAssistantAnswer/);assert.match(api,/responseWithHistory/);
  assert.match(history,/evidenceHash/);assert.match(history,/answerHash/);assert.match(history,/FINANCE_ASSISTANT_PROMPT_VERSION/);
  assert.match(history,/ORDER BY created_at DESC LIMIT/);assert.match(history,/Math\.min\(Math\.max\(limit, 1\), 50\)/);assert.match(history,/getFinanceAssistantAnswer/);
  assert.match(api,/searchParams\.get\("id"\)/);
  assert.doesNotMatch(api,/DELETE FROM finance_assistant_answers|UPDATE finance_assistant_answers/);
  assert.match(page,/답변 감사이력/);assert.match(page,/restoreFinanceAssistantAnswer/);assert.match(page,/evidenceHash\.slice/);
  assert.match(style,/assistant-history-list/);assert.match(plan,/수정·삭제 API는 만들지 않는다/);assert.match(plan,/저장에 실패한 답변은 화면에 성공한 답변으로 반환하지 않는다/);
});
