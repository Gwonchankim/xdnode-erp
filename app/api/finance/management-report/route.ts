import { env } from "cloudflare:workers";
import { createApprovalRequest } from "../../../approval-engine";
import { authorizeErpRequest, safeJson, writeErpAudit } from "../../../erp-platform";
import { financeCurrentData } from "../../../finance-current-data";
import { buildFinanceAlertReportSnapshot } from "../../../finance-alert-reporting";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;

type ReportRow = {
  id: string; period: string; version: number; status: string; as_of: string; snapshot_json: string;
  auto_analysis_json: string; highlights: string; risks: string; decisions: string;
  quality_acknowledged: number; revision_reason: string; created_by: string; submitted_at: number | null;
  approved_by: string; approved_at: number | null; created_at: number; updated_at: number;
};
type ActionRow = {
  id: string; report_id: string; source_section: string; title: string; owner_employee_id: string;
  due_date: string; status: string; memo: string; created_by: string; completed_at: number | null;
  decision_id: string; created_at: number; updated_at: number;
};
type DecisionRow = {
  id: string; report_id: string; source_section: string; decision_type: string; title: string;
  proposal: string; financial_impact: number; owner_employee_id: string; decision_due_date: string;
  requires_action: number; status: string; resolution_note: string; resolved_by: string;
  resolved_at: number | null; action_id: string; created_by: string; created_at: number; updated_at: number;
};
type BudgetPlanRow = { id: string; version: number; name: string };
type BudgetLineRow = {
  id: string; direction: string; actual_source: string; account_code: string; account_name: string;
  amount: number; threshold_pct: number; department: string;
};
type JournalActualRow = { debit_code: string; debit_name: string; credit_code: string; credit_name: string; amount: number };

const currentPeriod = financeCurrentData.asOf.slice(0, 7);
const actionStatuses = new Set(["OPEN", "IN_PROGRESS", "WAITING", "DONE"]);
const sourceSections = new Set(["COMMERCE", "CASH", "RECEIVABLES", "PAYROLL", "BUDGET", "CLOSE", "QUALITY", "GENERAL"]);
const decisionTypes = new Set(["BUDGET", "CASH", "SALES", "HR", "RISK", "POLICY", "OTHER"]);
const decisionOutcomes = new Set(["APPROVED", "DEFERRED", "REJECTED"]);

async function ensureSchema() {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_management_reports (
      id TEXT PRIMARY KEY NOT NULL, period TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'DRAFT', as_of TEXT NOT NULL, snapshot_json TEXT NOT NULL,
      auto_analysis_json TEXT NOT NULL DEFAULT '{}', highlights TEXT NOT NULL DEFAULT '',
      risks TEXT NOT NULL DEFAULT '', decisions TEXT NOT NULL DEFAULT '',
      quality_acknowledged INTEGER NOT NULL DEFAULT 0, revision_reason TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL, submitted_at INTEGER, approved_by TEXT NOT NULL DEFAULT '',
      approved_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_management_report_actions (
      id TEXT PRIMARY KEY NOT NULL, report_id TEXT NOT NULL, source_section TEXT NOT NULL DEFAULT 'GENERAL',
      title TEXT NOT NULL, owner_employee_id TEXT NOT NULL, due_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN', memo TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL,
      completed_at INTEGER, decision_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_management_decisions (
      id TEXT PRIMARY KEY NOT NULL, report_id TEXT NOT NULL, source_section TEXT NOT NULL DEFAULT 'GENERAL',
      decision_type TEXT NOT NULL DEFAULT 'OTHER', title TEXT NOT NULL, proposal TEXT NOT NULL,
      financial_impact INTEGER NOT NULL DEFAULT 0, owner_employee_id TEXT NOT NULL DEFAULT '',
      decision_due_date TEXT NOT NULL DEFAULT '', requires_action INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'DRAFT', resolution_note TEXT NOT NULL DEFAULT '',
      resolved_by TEXT NOT NULL DEFAULT '', resolved_at INTEGER, action_id TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_management_report_period_version ON finance_management_reports(period, version)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_management_report_period_status ON finance_management_reports(period, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_management_report_action_status_due ON finance_management_report_actions(report_id, status, due_date)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_management_action_decision ON finance_management_report_actions(decision_id) WHERE decision_id <> ''"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_management_decision_report_status ON finance_management_decisions(report_id, status, decision_due_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_management_decision_owner_due ON finance_management_decisions(owner_employee_id, status, decision_due_date)"),
  ]);
}

function validPeriod(period: string) {
  return /^2026-(0[1-9]|1[0-2])$/.test(period) && period <= currentPeriod;
}

function lastDay(period: string) {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function reportView(row: ReportRow) {
  return {
    id: row.id, period: row.period, version: row.version, status: row.status, asOf: row.as_of,
    snapshot: safeJson<Record<string, unknown>>(row.snapshot_json, {}),
    autoAnalysis: safeJson<Record<string, string>>(row.auto_analysis_json, {}),
    highlights: row.highlights, risks: row.risks, decisions: row.decisions,
    qualityAcknowledged: Boolean(row.quality_acknowledged), revisionReason: row.revision_reason,
    createdBy: row.created_by, submittedAt: row.submitted_at, approvedBy: row.approved_by,
    approvedAt: row.approved_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function actionView(row: ActionRow) {
  return {
    id: row.id, reportId: row.report_id, sourceSection: row.source_section, title: row.title,
    ownerEmployeeId: row.owner_employee_id, dueDate: row.due_date, status: row.status,
    memo: row.memo, decisionId: row.decision_id, createdBy: row.created_by, completedAt: row.completed_at,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function decisionView(row: DecisionRow) {
  return {
    id: row.id, reportId: row.report_id, sourceSection: row.source_section, decisionType: row.decision_type,
    title: row.title, proposal: row.proposal, financialImpact: row.financial_impact,
    ownerEmployeeId: row.owner_employee_id, decisionDueDate: row.decision_due_date,
    requiresAction: Boolean(row.requires_action), status: row.status, resolutionNote: row.resolution_note,
    resolvedBy: row.resolved_by, resolvedAt: row.resolved_at, actionId: row.action_id,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function statusLabel(status: string) {
  return ({ CONFIRMED: "확정", PARTIAL: "부분 연결", MISSING: "미연결", REVIEW: "검토 필요" } as Record<string, string>)[status] ?? status;
}

function monthInvoiceSummary(period: string, type: "sales" | "purchase") {
  const monthly = type === "sales" ? financeCurrentData.salesMonthly2026 : financeCurrentData.purchaseMonthly2026;
  const daily = type === "sales" ? financeCurrentData.salesDaily2026 : financeCurrentData.purchaseDaily2026;
  const amount = monthly.find((item) => item.month === period)?.amount ?? 0;
  const rows = daily.filter((item) => item.date.startsWith(period));
  return { amount, documentCount: rows.reduce((sum, item) => sum + item.count, 0), partnerCount: new Set(rows.map((item) => item.partner)).size };
}

async function budgetSection(period: string) {
  const month = Number(period.slice(5, 7));
  const plan = await db.prepare(`SELECT id, version, name FROM finance_budget_plans
    WHERE fiscal_year = 2026 AND status = 'APPROVED' ORDER BY version DESC LIMIT 1`).first<BudgetPlanRow>();
  if (!plan) return { status: "MISSING", plan: null, lines: 0, budget: 0, actual: 0, variance: 0, alertCount: 0, unmappedCount: 0 };
  const [linesResult, journalResult] = await Promise.all([
    db.prepare(`SELECT id, direction, actual_source, account_code, account_name, amount,
      threshold_pct, department FROM finance_budget_plan_lines WHERE plan_id = ? AND month = ?`)
      .bind(plan.id, month).all<BudgetLineRow>(),
    db.prepare(`SELECT debit_account_code AS debit_code, debit_account_name AS debit_name,
      credit_account_code AS credit_code, credit_account_name AS credit_name, SUM(amount) AS amount
      FROM finance_journal_entries WHERE status = 'POSTED' AND substr(voucher_date, 1, 7) = ?
      GROUP BY debit_account_code, debit_account_name, credit_account_code, credit_account_name`)
      .bind(period).all<JournalActualRow>(),
  ]);
  const elapsedRatio = period === currentPeriod
    ? Number(financeCurrentData.asOf.slice(8, 10)) / new Date(Date.UTC(2026, month, 0)).getUTCDate() : 1;
  let budget = 0; let actual = 0; let unmappedCount = 0; let alertCount = 0; let mappedCount = 0;
  for (const line of linesResult.results) {
    const comparisonBudget = Math.round(line.amount * elapsedRatio);
    budget += comparisonBudget;
    let value: number | null = null;
    if (line.department !== "전사") value = null;
    else if (line.actual_source === "SALES_INVOICE") value = monthInvoiceSummary(period, "sales").amount;
    else if (line.actual_source === "PURCHASE_INVOICE") value = monthInvoiceSummary(period, "purchase").amount;
    else if (line.actual_source === "POSTED_JOURNAL_DEBIT") value = journalResult.results
      .filter((row) => line.account_code ? row.debit_code === line.account_code : row.debit_name === line.account_name)
      .reduce((sum, row) => sum + row.amount, 0);
    else if (line.actual_source === "POSTED_JOURNAL_CREDIT") value = journalResult.results
      .filter((row) => line.account_code ? row.credit_code === line.account_code : row.credit_name === line.account_name)
      .reduce((sum, row) => sum + row.amount, 0);
    if (value === null) { unmappedCount += 1; continue; }
    mappedCount += 1; actual += value;
    const threshold = line.threshold_pct / 100;
    if ((line.direction === "REVENUE" && value < comparisonBudget * (1 - threshold))
      || (line.direction === "EXPENSE" && value > comparisonBudget * (1 + threshold))) alertCount += 1;
  }
  const status = linesResult.results.length === 0 ? "MISSING" : unmappedCount > 0 ? "PARTIAL" : "CONFIRMED";
  return {
    status, plan: { id: plan.id, name: plan.name, version: plan.version }, lines: linesResult.results.length,
    budget, actual, variance: actual - budget, alertCount, unmappedCount, mappedCount,
  };
}

async function buildSnapshot(period: string) {
  const sales = monthInvoiceSummary(period, "sales");
  const purchases = monthInvoiceSummary(period, "purchase");
  const periodEnd = lastDay(period);
  const alertCutoff = period === currentPeriod ? financeCurrentData.asOf : periodEnd;
  const trend = financeCurrentData.balanceTrend.filter((item) => item.date.startsWith(period));
  const balancePoint = financeCurrentData.balanceTrend.find((item) => item.date <= periodEnd && item.date.startsWith(period)) ?? null;
  const currentCash = period === currentPeriod;
  const cashStatus = !balancePoint ? "MISSING" : (balancePoint.date === periodEnd || (currentCash && balancePoint.date === financeCurrentData.asOf)) ? "CONFIRMED" : "PARTIAL";
  const [receivables, payroll, budget, close, alertActions] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS record_count, COALESCE(SUM(outstanding_amount), 0) AS outstanding,
      COALESCE(SUM(CASE WHEN status <> 'COMPLETE' AND (status = 'OVERDUE' OR (due_date <> '' AND due_date < ?)) THEN outstanding_amount ELSE 0 END), 0) AS overdue,
      COALESCE(SUM(CASE WHEN status <> 'COMPLETE' AND due_date = '' THEN 1 ELSE 0 END), 0) AS missing_plan,
      MAX(updated_at) AS updated_at FROM finance_receivable_management`).bind(financeCurrentData.asOf)
      .first<{ record_count: number; outstanding: number; overdue: number; missing_plan: number; updated_at: number | null }>(),
    db.prepare(`SELECT period, status, employee_count, gross_pay, deductions, net_pay, updated_at
      FROM hr_payroll_runs WHERE period = ?`).bind(period).first<{
      period: string; status: string; employee_count: number; gross_pay: number; deductions: number; net_pay: number; updated_at: number;
    }>(),
    budgetSection(period),
    db.prepare(`SELECT period, period_end, status, control_pass_count, control_fail_count,
      manual_completed_count, manual_total_count, evidence_count, version, updated_at
      FROM finance_close_runs WHERE period = ?`).bind(period).first<Record<string, string | number>>(),
    buildFinanceAlertReportSnapshot(db, alertCutoff),
  ]);
  const receivableStatus = (receivables?.record_count ?? 0) > 0 ? "PARTIAL" : "MISSING";
  const payrollStatus = !payroll ? "MISSING" : ["APPROVED", "LOCKED"].includes(payroll.status) ? "CONFIRMED" : "PARTIAL";
  const closeStatus = !close ? "MISSING" : close.status === "CLOSED" ? "CONFIRMED" : "REVIEW";
  const qualityWarnings: Array<{ code: string; section: string; message: string; destination: string }> = [];
  if (cashStatus !== "CONFIRMED") qualityWarnings.push({ code: "CASH_SOURCE", section: "CASH", message: `자금 기준일이 월말과 일치하지 않습니다 (${balancePoint?.date ?? "자료 없음"}).`, destination: "liquidity" });
  if (Number(financeCurrentData.journalSummary.differenceKrw) !== 0) qualityWarnings.push({ code: "JOURNAL_DIFFERENCE", section: "QUALITY", message: `최신 누적 분개장 차대변 ${financeCurrentData.journalSummary.differenceKrw.toLocaleString("ko-KR")}원 차이가 있습니다.`, destination: "quality" });
  if (receivableStatus === "MISSING") qualityWarnings.push({ code: "RECEIVABLE_MISSING", section: "RECEIVABLES", message: "ERP 미수 관리원장이 등록되지 않았습니다.", destination: "receivables" });
  else {
    if ((receivables?.overdue ?? 0) > 0) qualityWarnings.push({ code: "RECEIVABLE_OVERDUE", section: "RECEIVABLES", message: `연체·기한경과 관리잔액 ${(receivables?.overdue ?? 0).toLocaleString("ko-KR")}원이 있습니다.`, destination: "receivables" });
    if ((receivables?.missing_plan ?? 0) > 0) qualityWarnings.push({ code: "RECEIVABLE_PLAN", section: "RECEIVABLES", message: `회수예정일이 없는 미수 관리기록 ${receivables?.missing_plan ?? 0}건이 있습니다.`, destination: "receivables" });
  }
  if (payrollStatus !== "CONFIRMED") qualityWarnings.push({ code: "PAYROLL_STATUS", section: "PAYROLL", message: payroll ? `급여 원장 상태가 ${payroll.status}입니다.` : "해당 월 급여 실행원장이 없습니다.", destination: "hr:payroll" });
  if (budget.status !== "CONFIRMED") qualityWarnings.push({ code: "BUDGET_COVERAGE", section: "BUDGET", message: budget.status === "MISSING" ? "해당 월 승인 예산이 없습니다." : `예산 실적 자동 매핑이 ${budget.unmappedCount}개 누락되었습니다.`, destination: "budget" });
  if (budget.alertCount > 0) qualityWarnings.push({ code: "BUDGET_ALERT", section: "BUDGET", message: `예산 허용범위를 벗어난 항목 ${budget.alertCount}개가 있습니다.`, destination: "budget" });
  if (closeStatus !== "CONFIRMED") qualityWarnings.push({ code: "CLOSE_STATUS", section: "CLOSE", message: close ? `월마감 상태가 ${String(close.status)}입니다.` : "해당 월 월마감 원장이 없습니다.", destination: "close" });
  if (alertActions.unresolvedCount > 0) qualityWarnings.push({ code: "ALERT_ACTIONS_OPEN", section: "QUALITY",
    message: `${alertCutoff} 기준 미해결 재무 경보 ${alertActions.unresolvedCount}건(중요 ${alertActions.highCriticalUnresolvedCount}건·기한경과 ${alertActions.overdueCount}건)이 있습니다.`, destination: "risk-actions" });

  const sections = {
    commerce: { status: "CONFIRMED", sales, purchases, netSupplyDifference: sales.amount - purchases.amount },
    cash: {
      status: cashStatus, balanceDate: balancePoint?.date ?? null, bankBalanceKrw: balancePoint?.balance ?? null,
      checkingBalanceKrw: currentCash ? financeCurrentData.accountSummary.checkingBalanceSum : null,
      fxBalanceKrw: currentCash ? financeCurrentData.accountSummary.fxBalanceSumKrw : null,
      loanBalanceKrw: currentCash ? financeCurrentData.accountSummary.loanBalanceSum : null,
      trend: trend.slice().reverse(),
    },
    receivables: {
      status: receivableStatus, scope: "ERP 사용자 관리원장(회계잔액 자동대사 전)",
      recordCount: receivables?.record_count ?? 0, outstandingAmount: receivables?.outstanding ?? null,
      overdueAmount: receivables?.overdue ?? null, missingPlanCount: receivables?.missing_plan ?? null,
      updatedAt: receivables?.updated_at ?? null,
    },
    payroll: payroll ? {
      status: payrollStatus, runStatus: payroll.status, employeeCount: payroll.employee_count,
      grossPay: payroll.gross_pay, deductions: payroll.deductions, netPay: payroll.net_pay, updatedAt: payroll.updated_at,
    } : { status: "MISSING", runStatus: null, employeeCount: null, grossPay: null, deductions: null, netPay: null, updatedAt: null },
    budget,
    close: close ? {
      status: closeStatus, runStatus: close.status, periodEnd: close.period_end, controlPassCount: close.control_pass_count,
      controlFailCount: close.control_fail_count, manualCompletedCount: close.manual_completed_count,
      manualTotalCount: close.manual_total_count, evidenceCount: close.evidence_count, version: close.version,
    } : { status: "MISSING", runStatus: null },
    alertActions,
    quality: {
      status: qualityWarnings.length ? "REVIEW" : "CONFIRMED", warningCount: qualityWarnings.length,
      journal: { scope: `2026-01-01~${financeCurrentData.asOf}`, lineCount: financeCurrentData.journalSummary.lineCount,
        debitAmountKrw: financeCurrentData.journalSummary.debitAmountKrw, creditAmountKrw: financeCurrentData.journalSummary.creditAmountKrw,
        differenceKrw: financeCurrentData.journalSummary.differenceKrw }, warnings: qualityWarnings,
    },
  };
  const sources = [
    { key: "commerce", label: "Clobe 세금계산서", status: "CONFIRMED", asOf: financeCurrentData.asOf, destination: "commercial", note: "월 공급가액·문서 건수" },
    { key: "cash", label: "Clobe 은행 잔액", status: cashStatus, asOf: balancePoint?.date ?? "", destination: "liquidity", note: "원화·외화 원화환산 및 대출" },
    { key: "receivables", label: "ERP 미수 관리원장", status: receivableStatus, asOf: receivables?.updated_at ? new Date(receivables.updated_at).toISOString().slice(0, 10) : "", destination: "receivables", note: "사용자 관리잔액" },
    { key: "payroll", label: "ERP 급여 실행원장", status: payrollStatus, asOf: period, destination: "hr:payroll", note: "해당 월 급여 상태·합계" },
    { key: "budget", label: "ERP 승인 예산·실적", status: budget.status, asOf: period, destination: "budget", note: "승인 예산과 자동 연결 실적" },
    { key: "close", label: "ERP 월마감 통제", status: closeStatus, asOf: String(close?.period_end ?? ""), destination: "close", note: "통제·체크리스트·증빙" },
    { key: "alert-actions", label: "ERP 재무 경보 조치원장", status: alertActions.unresolvedCount ? "REVIEW" : "CONFIRMED", asOf: alertCutoff, destination: "risk-actions", note: `미해결 ${alertActions.unresolvedCount}건 · 종료 ${alertActions.closedCount}건` },
    { key: "journal", label: "Clobe 분개장 품질", status: financeCurrentData.journalSummary.differenceKrw ? "REVIEW" : "CONFIRMED", asOf: financeCurrentData.asOf, destination: "quality", note: "2026년 최신 누적 품질" },
  ].map((source) => ({ ...source, statusLabel: statusLabel(source.status) }));
  const highlights = [
    `${period} 연동 매출 공급가액은 ${sales.amount.toLocaleString("ko-KR")}원, 매입 공급가액은 ${purchases.amount.toLocaleString("ko-KR")}원이며 공급가액 순차이는 ${(sales.amount - purchases.amount).toLocaleString("ko-KR")}원입니다.`,
    balancePoint ? `자금 기준일 ${balancePoint.date}의 은행 잔액 추이 값은 ${balancePoint.balance.toLocaleString("ko-KR")}원입니다.` : "해당 월의 은행 잔액 기준점은 현재 자동 연결되지 않았습니다.",
    payroll ? `급여 실행원장은 ${payroll.employee_count}명, 지급총액 ${payroll.gross_pay.toLocaleString("ko-KR")}원, 실지급 ${payroll.net_pay.toLocaleString("ko-KR")}원입니다.` : "해당 월 급여 실행원장이 아직 연결되지 않았습니다.",
    `${alertCutoff} 기준 재무 경보는 미해결 ${alertActions.unresolvedCount}건, 종료 ${alertActions.closedCount}건이며 중요 미해결은 ${alertActions.highCriticalUnresolvedCount}건입니다.`,
  ].join("\n");
  const risks = qualityWarnings.length ? qualityWarnings.map((warning) => `- ${warning.message}`).join("\n") : "- 현재 연결 원천에서 추가 확인이 필요한 품질경고가 없습니다.";
  const decisions = qualityWarnings.length
    ? "품질경고별 담당자와 완료기한을 지정하고, 월마감·원천 보완 완료 여부를 다음 경영회의에서 확인합니다."
    : "확정된 월간 지표를 기준으로 다음 달 매출·자금·비용 운영계획을 승인합니다.";
  return {
    generatedAt: new Date().toISOString(), period, asOf: financeCurrentData.asOf, sections, sources,
    quality: { warningCount: qualityWarnings.length, requiresAcknowledgement: qualityWarnings.length > 0, warnings: qualityWarnings },
    autoAnalysis: { highlights, risks, decisions },
  };
}

async function selectedState(period: string, requestedId: string) {
  const result = await db.prepare("SELECT * FROM finance_management_reports WHERE period = ? ORDER BY version DESC")
    .bind(period).all<ReportRow>();
  const selected = result.results.find((row) => row.id === requestedId) ?? result.results[0] ?? null;
  const [actions, decisions] = selected ? await Promise.all([
    db.prepare(`SELECT * FROM finance_management_report_actions
      WHERE report_id = ? ORDER BY CASE status WHEN 'OPEN' THEN 0 WHEN 'IN_PROGRESS' THEN 1 WHEN 'WAITING' THEN 2 ELSE 3 END, due_date, created_at`)
      .bind(selected.id).all<ActionRow>(),
    db.prepare(`SELECT * FROM finance_management_decisions WHERE report_id = ?
      ORDER BY CASE status WHEN 'PENDING' THEN 0 WHEN 'DRAFT' THEN 1 WHEN 'DEFERRED' THEN 2 WHEN 'APPROVED' THEN 3 ELSE 4 END,
        decision_due_date, created_at`).bind(selected.id).all<DecisionRow>(),
  ]) : [null, null];
  return {
    reports: result.results.map(reportView), selected: selected ? reportView(selected) : null,
    actions: actions?.results.map(actionView) ?? [], decisions: decisions?.results.map(decisionView) ?? [],
  };
}

export async function GET(request: Request) {
  const authorization = await authorizeErpRequest(db, "finance", "read");
  if (authorization.response) return authorization.response;
  await ensureSchema();
  const url = new URL(request.url);
  const period = url.searchParams.get("period") ?? currentPeriod;
  if (!validPeriod(period)) return Response.json({ error: "2026년 현재까지의 보고월을 선택해 주세요." }, { status: 400 });
  const state = await selectedState(period, url.searchParams.get("reportId") ?? "");
  const preview = await buildSnapshot(period);
  const periods = Array.from({ length: Number(currentPeriod.slice(5, 7)) }, (_, index) => `2026-${String(index + 1).padStart(2, "0")}`).reverse();
  return Response.json({ period, currentPeriod, periods, preview, ...state });
}

export async function POST(request: Request) {
  const authorization = await authorizeErpRequest(db, "finance", "write");
  if (authorization.response) return authorization.response;
  await ensureSchema();
  const body = await request.json() as Record<string, unknown>;
  const action = String(body.action ?? "").toUpperCase();
  const now = Date.now();

  if (action === "CREATE_REPORT") {
    const period = String(body.period ?? "");
    if (!validPeriod(period)) return Response.json({ error: "보고월을 확인해 주세요." }, { status: 400 });
    const pending = await db.prepare(`SELECT id FROM finance_management_reports
      WHERE period = ? AND status IN ('DRAFT','SUBMITTED') LIMIT 1`).bind(period).first<{ id: string }>();
    if (pending) return Response.json({ error: "같은 보고월에 작성 또는 승인 진행 중인 버전이 있습니다." }, { status: 409 });
    const latest = await db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM finance_management_reports WHERE period = ?")
      .bind(period).first<{ version: number }>();
    const snapshot = await buildSnapshot(period);
    const id = crypto.randomUUID();
    await db.prepare(`INSERT INTO finance_management_reports
      (id, period, version, status, as_of, snapshot_json, auto_analysis_json, highlights, risks, decisions,
        quality_acknowledged, revision_reason, created_by, submitted_at, approved_by, approved_at, created_at, updated_at)
      VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, 0, '', ?, NULL, '', NULL, ?, ?)`)
      .bind(id, period, (latest?.version ?? 0) + 1, financeCurrentData.asOf, JSON.stringify(snapshot), JSON.stringify(snapshot.autoAnalysis),
        snapshot.autoAnalysis.highlights, snapshot.autoAnalysis.risks, snapshot.autoAnalysis.decisions,
        authorization.principal.employeeId, now, now).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "MANAGEMENT_REPORT_CREATED", entityType: "financeManagementReport", entityId: id, after: { period, version: (latest?.version ?? 0) + 1, asOf: financeCurrentData.asOf } });
    return Response.json({ created: true, id }, { status: 201 });
  }

  const reportId = String(body.reportId ?? "");
  const report = reportId ? await db.prepare("SELECT * FROM finance_management_reports WHERE id = ?").bind(reportId).first<ReportRow>() : null;
  if (!report) return Response.json({ error: "경영보고서를 찾을 수 없습니다." }, { status: 404 });

  if (action === "REFRESH_DRAFT") {
    if (report.status !== "DRAFT") return Response.json({ error: "작성 중인 보고서만 원천을 새로 반영할 수 있습니다." }, { status: 409 });
    const snapshot = await buildSnapshot(report.period);
    const oldAuto = safeJson<Record<string, string>>(report.auto_analysis_json, {});
    const nextHighlights = !report.highlights || report.highlights === oldAuto.highlights ? snapshot.autoAnalysis.highlights : report.highlights;
    const nextRisks = !report.risks || report.risks === oldAuto.risks ? snapshot.autoAnalysis.risks : report.risks;
    const nextDecisions = !report.decisions || report.decisions === oldAuto.decisions ? snapshot.autoAnalysis.decisions : report.decisions;
    await db.prepare(`UPDATE finance_management_reports SET as_of = ?, snapshot_json = ?, auto_analysis_json = ?,
      highlights = ?, risks = ?, decisions = ?, quality_acknowledged = 0, updated_at = ? WHERE id = ? AND status = 'DRAFT'`)
      .bind(financeCurrentData.asOf, JSON.stringify(snapshot), JSON.stringify(snapshot.autoAnalysis), nextHighlights, nextRisks, nextDecisions, now, reportId).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "MANAGEMENT_REPORT_REFRESHED", entityType: "financeManagementReport", entityId: reportId, before: { asOf: report.as_of }, after: { asOf: financeCurrentData.asOf } });
    return Response.json({ refreshed: true });
  }

  if (action === "SAVE_DRAFT") {
    if (report.status !== "DRAFT") return Response.json({ error: "작성 중인 보고서만 편집할 수 있습니다." }, { status: 409 });
    const highlights = String(body.highlights ?? "").trim().slice(0, 6000);
    const risks = String(body.risks ?? "").trim().slice(0, 6000);
    const decisions = String(body.decisions ?? "").trim().slice(0, 6000);
    if (!highlights || !risks || !decisions) return Response.json({ error: "성과·위험·의사결정 요청을 모두 작성해 주세요." }, { status: 400 });
    await db.prepare("UPDATE finance_management_reports SET highlights = ?, risks = ?, decisions = ?, updated_at = ? WHERE id = ? AND status = 'DRAFT'")
      .bind(highlights, risks, decisions, now, reportId).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "MANAGEMENT_REPORT_SAVED", entityType: "financeManagementReport", entityId: reportId, before: reportView(report), after: { highlights, risks, decisions } });
    return Response.json({ saved: true });
  }

  if (action === "ADD_DECISION" || action === "UPDATE_DECISION") {
    if (report.status !== "DRAFT") return Response.json({ error: "작성 중인 보고서의 안건만 편집할 수 있습니다." }, { status: 409 });
    const decisionId = action === "UPDATE_DECISION" ? String(body.decisionId ?? "") : crypto.randomUUID();
    const existing = action === "UPDATE_DECISION"
      ? await db.prepare("SELECT * FROM finance_management_decisions WHERE id = ? AND report_id = ? AND status = 'DRAFT'")
        .bind(decisionId, reportId).first<DecisionRow>() : null;
    if (action === "UPDATE_DECISION" && !existing) return Response.json({ error: "편집 가능한 의사결정 안건을 찾을 수 없습니다." }, { status: 404 });
    const sourceSection = String(body.sourceSection ?? existing?.source_section ?? "GENERAL").toUpperCase();
    const decisionType = String(body.decisionType ?? existing?.decision_type ?? "OTHER").toUpperCase();
    const title = String(body.title ?? existing?.title ?? "").trim().slice(0, 200);
    const proposal = String(body.proposal ?? existing?.proposal ?? "").trim().slice(0, 2000);
    const financialImpact = Math.round(Number(body.financialImpact ?? existing?.financial_impact ?? 0));
    const owner = String(body.ownerEmployeeId ?? existing?.owner_employee_id ?? "").trim().slice(0, 80);
    const dueDate = String(body.decisionDueDate ?? existing?.decision_due_date ?? "").trim();
    const requiresAction = Boolean(body.requiresAction ?? existing?.requires_action);
    if (!sourceSections.has(sourceSection) || !decisionTypes.has(decisionType) || !title || proposal.length < 5
      || !owner || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !Number.isFinite(financialImpact)
      || Math.abs(financialImpact) > 1_000_000_000_000_000) {
      return Response.json({ error: "안건 유형·제목·5자 이상의 요청내용·결정 책임자·기한·재무영향을 확인해 주세요." }, { status: 400 });
    }
    if (existing) {
      await db.prepare(`UPDATE finance_management_decisions SET source_section = ?, decision_type = ?, title = ?,
        proposal = ?, financial_impact = ?, owner_employee_id = ?, decision_due_date = ?, requires_action = ?, updated_at = ?
        WHERE id = ? AND report_id = ? AND status = 'DRAFT'`)
        .bind(sourceSection, decisionType, title, proposal, financialImpact, owner, dueDate, requiresAction ? 1 : 0, now, decisionId, reportId).run();
      await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "MANAGEMENT_DECISION_UPDATED", entityType: "financeManagementDecision", entityId: decisionId, before: decisionView(existing), after: { sourceSection, decisionType, title, proposal, financialImpact, owner, dueDate, requiresAction } });
      return Response.json({ updated: true, id: decisionId });
    }
    await db.prepare(`INSERT INTO finance_management_decisions
      (id, report_id, source_section, decision_type, title, proposal, financial_impact, owner_employee_id,
        decision_due_date, requires_action, status, resolution_note, resolved_by, resolved_at, action_id,
        created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', '', '', NULL, '', ?, ?, ?)`)
      .bind(decisionId, reportId, sourceSection, decisionType, title, proposal, financialImpact, owner,
        dueDate, requiresAction ? 1 : 0, authorization.principal.employeeId, now, now).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "MANAGEMENT_DECISION_CREATED", entityType: "financeManagementDecision", entityId: decisionId, after: { reportId, sourceSection, decisionType, title, proposal, financialImpact, owner, dueDate, requiresAction } });
    return Response.json({ created: true, id: decisionId }, { status: 201 });
  }

  if (action === "DELETE_DECISION") {
    if (report.status !== "DRAFT") return Response.json({ error: "작성 중인 보고서의 안건만 삭제할 수 있습니다." }, { status: 409 });
    const decisionId = String(body.decisionId ?? "");
    const existing = await db.prepare("SELECT * FROM finance_management_decisions WHERE id = ? AND report_id = ? AND status = 'DRAFT'")
      .bind(decisionId, reportId).first<DecisionRow>();
    if (!existing) return Response.json({ error: "삭제할 의사결정 안건을 찾을 수 없습니다." }, { status: 404 });
    await db.prepare("DELETE FROM finance_management_decisions WHERE id = ? AND report_id = ? AND status = 'DRAFT'")
      .bind(decisionId, reportId).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "MANAGEMENT_DECISION_DELETED", entityType: "financeManagementDecision", entityId: decisionId, before: decisionView(existing) });
    return Response.json({ deleted: true });
  }

  if (action === "ADD_ACTION") {
    if (report.status !== "DRAFT") return Response.json({ error: "작성 중인 보고서에만 새 후속조치를 추가할 수 있습니다." }, { status: 409 });
    const title = String(body.title ?? "").trim().slice(0, 200);
    const owner = String(body.ownerEmployeeId ?? "").trim().slice(0, 80);
    const dueDate = String(body.dueDate ?? "").trim();
    const sourceSection = String(body.sourceSection ?? "GENERAL").toUpperCase();
    const memo = String(body.memo ?? "").trim().slice(0, 1000);
    if (!title || !owner || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || !sourceSections.has(sourceSection)) return Response.json({ error: "후속조치의 제목·담당자·기한·구간을 확인해 주세요." }, { status: 400 });
    const id = crypto.randomUUID();
    await db.prepare(`INSERT INTO finance_management_report_actions
      (id, report_id, source_section, title, owner_employee_id, due_date, status, memo, created_by,
        completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, NULL, ?, ?)`)
      .bind(id, reportId, sourceSection, title, owner, dueDate, memo, authorization.principal.employeeId, now, now).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "MANAGEMENT_REPORT_ACTION_CREATED", entityType: "financeManagementReportAction", entityId: id, after: body });
    return Response.json({ created: true, id }, { status: 201 });
  }

  if (action === "UPDATE_ACTION") {
    if (report.status === "SUPERSEDED") return Response.json({ error: "대체된 보고서의 후속조치는 변경할 수 없습니다." }, { status: 409 });
    const actionId = String(body.actionId ?? "");
    const existing = await db.prepare("SELECT * FROM finance_management_report_actions WHERE id = ? AND report_id = ?")
      .bind(actionId, reportId).first<ActionRow>();
    if (!existing) return Response.json({ error: "후속조치를 찾을 수 없습니다." }, { status: 404 });
    const status = String(body.status ?? existing.status).toUpperCase();
    if (!actionStatuses.has(status)) return Response.json({ error: "후속조치 상태를 확인해 주세요." }, { status: 400 });
    const editable = report.status === "DRAFT";
    const title = editable ? String(body.title ?? existing.title).trim().slice(0, 200) : existing.title;
    const owner = editable ? String(body.ownerEmployeeId ?? existing.owner_employee_id).trim().slice(0, 80) : existing.owner_employee_id;
    const dueDate = editable ? String(body.dueDate ?? existing.due_date).trim() : existing.due_date;
    const memo = String(body.memo ?? existing.memo).trim().slice(0, 1000);
    if (!title || !owner || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return Response.json({ error: "후속조치 필드를 확인해 주세요." }, { status: 400 });
    await db.prepare(`UPDATE finance_management_report_actions SET title = ?, owner_employee_id = ?, due_date = ?,
      status = ?, memo = ?, completed_at = ?, updated_at = ? WHERE id = ? AND report_id = ?`)
      .bind(title, owner, dueDate, status, memo, status === "DONE" ? now : null, now, actionId, reportId).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "MANAGEMENT_REPORT_ACTION_UPDATED", entityType: "financeManagementReportAction", entityId: actionId, before: actionView(existing), after: { title, owner, dueDate, status, memo } });
    return Response.json({ updated: true });
  }

  if (action === "DELETE_ACTION") {
    if (report.status !== "DRAFT") return Response.json({ error: "작성 중인 보고서의 후속조치만 삭제할 수 있습니다." }, { status: 409 });
    const actionId = String(body.actionId ?? "");
    const result = await db.prepare("DELETE FROM finance_management_report_actions WHERE id = ? AND report_id = ?")
      .bind(actionId, reportId).run();
    if (result.meta.changes !== 1) return Response.json({ error: "후속조치를 찾을 수 없습니다." }, { status: 404 });
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "MANAGEMENT_REPORT_ACTION_DELETED", entityType: "financeManagementReportAction", entityId: actionId });
    return Response.json({ deleted: true });
  }

  if (action === "RESOLVE_DECISION") {
    const decisionAuthorization = await authorizeErpRequest(db, "finance", "approve");
    if (decisionAuthorization.response) return decisionAuthorization.response;
    if (report.status !== "APPROVED") return Response.json({ error: "승인된 경영보고의 미결정 안건만 확정할 수 있습니다." }, { status: 409 });
    const decisionId = String(body.decisionId ?? "");
    const decision = await db.prepare("SELECT * FROM finance_management_decisions WHERE id = ? AND report_id = ?")
      .bind(decisionId, reportId).first<DecisionRow>();
    if (!decision || decision.status !== "PENDING") return Response.json({ error: "확정 대기 중인 의사결정 안건을 찾을 수 없습니다." }, { status: 404 });
    const outcome = String(body.outcome ?? "").toUpperCase();
    const resolutionNote = String(body.resolutionNote ?? "").trim().slice(0, 2000);
    if (!decisionOutcomes.has(outcome) || resolutionNote.length < 5) return Response.json({ error: "승인·보류·반려 결과와 5자 이상의 결정 근거를 입력해 주세요." }, { status: 400 });
    const linkedActionId = decision.requires_action && outcome !== "REJECTED" ? crypto.randomUUID() : "";
    const statements = [
      db.prepare(`UPDATE finance_management_decisions SET status = ?, resolution_note = ?, resolved_by = ?,
        resolved_at = ?, action_id = ?, updated_at = ? WHERE id = ? AND report_id = ? AND status = 'PENDING'`)
        .bind(outcome, resolutionNote, decisionAuthorization.principal.employeeId, now, linkedActionId, now, decisionId, reportId),
    ];
    if (linkedActionId) statements.push(db.prepare(`INSERT INTO finance_management_report_actions
      (id, report_id, source_section, title, owner_employee_id, due_date, status, memo, created_by,
        completed_at, decision_id, created_at, updated_at)
      SELECT ?, report_id, source_section, ?, owner_employee_id, decision_due_date, 'OPEN', ?, ?, NULL, id, ?, ?
      FROM finance_management_decisions WHERE id = ? AND report_id = ? AND status = ? AND action_id = ?`)
      .bind(linkedActionId, `결정 실행 · ${decision.title}`, resolutionNote, decisionAuthorization.principal.employeeId,
        now, now, decisionId, reportId, outcome, linkedActionId));
    const results = await db.batch(statements);
    if (results[0].meta.changes !== 1) return Response.json({ error: "다른 사용자가 안건을 먼저 확정했습니다." }, { status: 409 });
    await writeErpAudit(db, { principal: decisionAuthorization.principal, module: "finance", action: "MANAGEMENT_DECISION_RESOLVED", entityType: "financeManagementDecision", entityId: decisionId, before: decisionView(decision), after: { outcome, resolutionNote, linkedActionId } });
    return Response.json({ resolved: true, outcome, actionId: linkedActionId });
  }

  if (action === "SUBMIT_REPORT") {
    if (report.status !== "DRAFT") return Response.json({ error: "작성 중인 보고서만 결재를 제출할 수 있습니다." }, { status: 409 });
    if (!report.highlights.trim() || !report.risks.trim() || !report.decisions.trim()) return Response.json({ error: "성과·위험·의사결정 요청을 저장한 뒤 제출해 주세요." }, { status: 409 });
    const snapshot = safeJson<{ quality?: { requiresAcknowledgement?: boolean; warningCount?: number } }>(report.snapshot_json, {});
    const acknowledged = Boolean(body.qualityAcknowledged);
    if (snapshot.quality?.requiresAcknowledgement && !acknowledged) return Response.json({ error: "원천 품질경고를 확인한 뒤 제출해 주세요." }, { status: 409 });
    const submission = await db.batch([
      db.prepare(`UPDATE finance_management_reports SET status = 'SUBMITTED', quality_acknowledged = ?,
        submitted_at = ?, updated_at = ? WHERE id = ? AND status = 'DRAFT'`).bind(acknowledged ? 1 : 0, now, now, reportId),
      db.prepare("UPDATE finance_management_decisions SET status = 'PENDING', updated_at = ? WHERE report_id = ? AND status = 'DRAFT'")
        .bind(now, reportId),
    ]);
    if (submission[0].meta.changes !== 1) return Response.json({ error: "다른 사용자가 보고서 상태를 먼저 변경했습니다." }, { status: 409 });
    try {
      const approval = await createApprovalRequest(db, authorization.principal, {
        module: "finance", requestType: "REPORT", title: `${report.period} 월간 경영보고 v${report.version} 승인`,
        description: `기준일 ${report.as_of} · 품질경고 ${snapshot.quality?.warningCount ?? 0}건`,
        targetEntityType: "FINANCE_MANAGEMENT_REPORT", targetEntityId: reportId,
        metadata: { period: report.period, version: report.version, asOf: report.as_of, qualityAcknowledged: acknowledged },
      });
      await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "MANAGEMENT_REPORT_SUBMITTED", entityType: "financeManagementReport", entityId: reportId, before: reportView(report), after: { approvalId: approval.id, acknowledged } });
      return Response.json({ submitted: true, approvalId: approval.id }, { status: 202 });
    } catch (error) {
      const rollbackAt = Date.now();
      await db.batch([
        db.prepare("UPDATE finance_management_reports SET status = 'DRAFT', submitted_at = NULL, quality_acknowledged = 0, updated_at = ? WHERE id = ? AND status = 'SUBMITTED'")
          .bind(rollbackAt, reportId),
        db.prepare("UPDATE finance_management_decisions SET status = 'DRAFT', updated_at = ? WHERE report_id = ? AND status = 'PENDING'")
          .bind(rollbackAt, reportId),
      ]);
      return Response.json({ error: error instanceof Error ? error.message : "경영보고 결재선을 만들지 못했습니다." }, { status: 409 });
    }
  }

  if (action === "CREATE_REVISION") {
    if (!["APPROVED", "SUPERSEDED"].includes(report.status)) return Response.json({ error: "승인되었거나 대체된 보고서만 개정할 수 있습니다." }, { status: 409 });
    const reason = String(body.revisionReason ?? "").trim().slice(0, 1000);
    if (reason.length < 5) return Response.json({ error: "개정 사유를 5자 이상 입력해 주세요." }, { status: 400 });
    const unresolvedDecisions = await db.prepare("SELECT COUNT(*) AS count FROM finance_management_decisions WHERE report_id = ? AND status = 'PENDING'")
      .bind(reportId).first<{ count: number }>();
    if ((unresolvedDecisions?.count ?? 0) > 0) return Response.json({ error: "미결정 안건을 모두 승인·보류·반려한 뒤 보고서를 개정해 주세요." }, { status: 409 });
    const pending = await db.prepare(`SELECT id FROM finance_management_reports
      WHERE period = ? AND status IN ('DRAFT','SUBMITTED') LIMIT 1`).bind(report.period).first<{ id: string }>();
    if (pending) return Response.json({ error: "같은 보고월에 작성 또는 승인 진행 중인 개정본이 있습니다." }, { status: 409 });
    const latest = await db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM finance_management_reports WHERE period = ?")
      .bind(report.period).first<{ version: number }>();
    const id = crypto.randomUUID(); const version = (latest?.version ?? report.version) + 1;
    await db.prepare(`INSERT INTO finance_management_reports
      (id, period, version, status, as_of, snapshot_json, auto_analysis_json, highlights, risks, decisions,
        quality_acknowledged, revision_reason, created_by, submitted_at, approved_by, approved_at, created_at, updated_at)
      VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, 0, ?, ?, NULL, '', NULL, ?, ?)`)
      .bind(id, report.period, version, report.as_of, report.snapshot_json, report.auto_analysis_json,
        report.highlights, report.risks, report.decisions, reason, authorization.principal.employeeId, now, now).run();
    const openActions = await db.prepare(`SELECT * FROM finance_management_report_actions
      WHERE report_id = ? AND status <> 'DONE'`).bind(reportId).all<ActionRow>();
    if (openActions.results.length) await db.batch(openActions.results.map((item) => db.prepare(`INSERT INTO finance_management_report_actions
      (id, report_id, source_section, title, owner_employee_id, due_date, status, memo, created_by,
        completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
      .bind(crypto.randomUUID(), id, item.source_section, item.title, item.owner_employee_id, item.due_date,
        item.status, item.memo, authorization.principal.employeeId, now, now)));
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "MANAGEMENT_REPORT_REVISION_CREATED", entityType: "financeManagementReport", entityId: id, before: { sourceReportId: reportId, version: report.version }, after: { period: report.period, version, reason } });
    return Response.json({ created: true, id, version }, { status: 201 });
  }

  return Response.json({ error: "지원하지 않는 경영보고 작업입니다." }, { status: 400 });
}
