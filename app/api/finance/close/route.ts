import { env } from "cloudflare:workers";
import { createApprovalRequest } from "../../../approval-engine";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";
import { financeCurrentData } from "../../../finance-current-data";
import { buildFinanceAlertReportSnapshot } from "../../../finance-alert-reporting";
import { evaluateLedgerSnapshotDrift, type LedgerIntegritySnapshot } from "../../../finance-ledger-integrity";
import { buildFinanceLedgerSnapshot } from "../../../finance-ledger-snapshot";
import { ensureFinancePostingSchema } from "../../../finance-posting";
import { ensureFinanceTieOutSchema, tieOutPasses, type TieOutRow } from "../../../finance-tie-out";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;
type ControlStatus = "PASS" | "FAIL" | "REVIEW";
type CloseControl = { key: string; category: string; title: string; status: ControlStatus; message: string; count: number };
type CloseRunRow = {
  period: string; period_end: string; status: string; control_pass_count: number; control_fail_count: number;
  manual_completed_count: number; manual_total_count: number; evidence_count: number; snapshot_json: string;
  submitted_by: string; submitted_at: number | null; closed_by: string; closed_at: number | null;
  reopened_by: string; reopened_at: number | null; reopened_reason: string; version: number;
  created_at: number; updated_at: number;
};
type CloseTaskRow = {
  id: string; period: string; category: string; title: string; owner_employee_id: string; status: string;
  evidence_document_id: string; completed_at: number | null; approved_by: string; approved_at: number | null;
  reopened_reason: string; created_at: number; updated_at: number;
};
type DocumentRow = { id: string; category: string; version: number; file_name: string; uploaded_by: string; created_at: number };
type StoredCloseSnapshot = { controls?: CloseControl[]; ledgerSnapshot?: LedgerIntegritySnapshot };

const currentPeriod = financeCurrentData.asOf.slice(0, 7);
const validPeriod = (period: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(period) && period <= currentPeriod;
const lastDayOfPeriod = (period: string) => {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
};

async function ensureSchema() {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_close_tasks (
      id TEXT PRIMARY KEY NOT NULL, period TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL,
      owner_employee_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'OPEN',
      evidence_document_id TEXT NOT NULL DEFAULT '', completed_at INTEGER, approved_by TEXT NOT NULL DEFAULT '',
      approved_at INTEGER, reopened_reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_close_runs (
      period TEXT PRIMARY KEY NOT NULL, period_end TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN',
      control_pass_count INTEGER NOT NULL DEFAULT 0, control_fail_count INTEGER NOT NULL DEFAULT 0,
      manual_completed_count INTEGER NOT NULL DEFAULT 0, manual_total_count INTEGER NOT NULL DEFAULT 0,
      evidence_count INTEGER NOT NULL DEFAULT 0, snapshot_json TEXT NOT NULL DEFAULT '{}',
      submitted_by TEXT NOT NULL DEFAULT '', submitted_at INTEGER, closed_by TEXT NOT NULL DEFAULT '', closed_at INTEGER,
      reopened_by TEXT NOT NULL DEFAULT '', reopened_at INTEGER, reopened_reason TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_close_period_status ON finance_close_tasks(period, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_close_run_status_period ON finance_close_runs(status, period)"),
  ]);
  await ensureFinancePostingSchema(db);
}

async function seedClose(period: string) {
  const now = Date.now();
  const templates = [
    ["BANK", "은행·외화예금 잔액 대사"],
    ["TREASURY", "월 최신 기준일 자금일보 확정 확인"],
    ["ALERT", "재무 경보 조치·종료 승인 확인"],
    ["JOURNAL", "분개장 차변·대변 및 미전기 전표 확인"],
    ["EVIDENCE", "지출·지급 증빙 누락 확인"],
    ["EXPENSE_CONTROL", "법인카드·지출증빙 대사"],
    ["PAYROLL", "급여월 승인·잠금 확인"],
    ["INCENTIVE", "인센티브 누적 정산·원가·급여 연결 확인"],
    ["INVENTORY", "재고 음수·미반영 입고 확인"],
    ["FIXED_ASSET", "고정자산 감가상각 전기 확인"],
    ["PROJECT_COST", "프로젝트·원가센터 배부 확인"],
    ["DEBT", "차입금·상환·약정 확인"],
    ["AR_AP", "외상매출금·미수금·매입채무 검토"],
    ["TAX", "세금계산서·부가세 검토"],
    ["STATEMENT", "월 손익·재무상태표 검토"],
  ];
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO finance_close_runs
      (period, period_end, status, created_at, updated_at) VALUES (?, ?, 'OPEN', ?, ?)`)
      .bind(period, lastDayOfPeriod(period), now, now),
    ...templates.map(([category, title]) => db.prepare(`INSERT OR IGNORE INTO finance_close_tasks
      (id, period, category, title, owner_employee_id, status, evidence_document_id, completed_at,
        approved_by, approved_at, reopened_reason, created_at, updated_at)
      VALUES (?, ?, ?, ?, '', 'OPEN', '', NULL, '', NULL, '', ?, ?)`)
      .bind(`${period}:${category}`, period, category, title, now, now)),
  ]);
}

async function computeControls(period: string): Promise<CloseControl[]> {
  const like = `${period}-%`;
  const periodStart = `${period}-01`; const nextPeriodDate = new Date(`${periodStart}T00:00:00Z`);
  nextPeriodDate.setUTCMonth(nextPeriodDate.getUTCMonth() + 1); const periodEndExclusive = nextPeriodDate.toISOString().slice(0, 10);
  const currentTaxSalesSupply = financeCurrentData.salesDaily2026.filter((row) => row.date.startsWith(period)).reduce((sum, row) => sum + row.amount, 0);
  const ledgerAsOf = period === currentPeriod ? financeCurrentData.asOf : lastDayOfPeriod(period);
  const ledgerSnapshotPromise = buildFinanceLedgerSnapshot(db, ledgerAsOf);
  const currentTaxPurchaseSupply = financeCurrentData.purchaseDaily2026.filter((row) => row.date.startsWith(period)).reduce((sum, row) => sum + row.amount, 0);
  const treasuryTargetDate = period === currentPeriod ? financeCurrentData.asOf : lastDayOfPeriod(period);
  const [bank, unposted, pendingPosting, missingEvidence, payroll, inventory, fixedAssets, expenseControl, projectCost, debtFacilities, debtSchedule, debtCovenants, incentiveSettlement, treasuryReport, tax] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total_count, COALESCE(SUM(CASE WHEN transaction_row.amount > COALESCE((
      SELECT SUM(match_row.matched_amount) FROM finance_cash_matches match_row
      WHERE match_row.bank_transaction_id = transaction_row.id AND match_row.status = 'CONFIRMED'), 0) THEN 1 ELSE 0 END), 0) AS pending_count
      FROM finance_bank_transactions transaction_row WHERE transaction_row.currency = 'KRW' AND transaction_row.transaction_date LIKE ?`)
      .bind(like).first<{ total_count: number; pending_count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM finance_journal_entries WHERE voucher_date LIKE ? AND status <> 'POSTED'")
      .bind(like).first<{ count: number }>(),
    db.prepare(`SELECT COUNT(*) AS batch_count, COALESCE(SUM(line_count), 0) AS line_count
      FROM finance_posting_batches
      WHERE status IN ('DRAFT','SUBMITTED','APPROVED') AND period_from <= ? AND period_to >= ?`)
      .bind(period, period).first<{ batch_count: number; line_count: number }>(),
    db.prepare(`SELECT COUNT(*) AS count FROM finance_expense_requests expense
      WHERE expense.requested_date LIKE ? AND expense.status NOT IN ('CANCELLED','REJECTED') AND expense.evidence_required = 1
        AND NOT EXISTS (SELECT 1 FROM erp_documents document WHERE document.module = 'finance'
          AND document.entity_type = 'financeExpense' AND document.entity_id = expense.id AND document.deleted_at IS NULL)`)
      .bind(like).first<{ count: number }>(),
    db.prepare("SELECT status, employee_count, net_pay FROM hr_payroll_runs WHERE period = ?")
      .bind(period).first<{ status: string; employee_count: number; net_pay: number }>(),
    db.prepare(`SELECT
      (SELECT COUNT(*) FROM (SELECT product_id, warehouse_id,
        SUM(CASE WHEN direction = 'IN' THEN quantity_milli ELSE -quantity_milli END) AS quantity_milli
        FROM inventory_movements GROUP BY product_id, warehouse_id
        HAVING SUM(CASE WHEN direction = 'IN' THEN quantity_milli ELSE -quantity_milli END) < 0)) AS negative_count,
      (SELECT COUNT(*) FROM finance_purchase_receipt_lines receipt_line
        JOIN finance_purchase_receipts receipt ON receipt.id = receipt_line.receipt_id AND receipt.status = 'ACCEPTED'
        WHERE receipt.receipt_date LIKE ? AND receipt_line.accepted_quantity_milli > 0 AND NOT EXISTS (
          SELECT 1 FROM inventory_movements movement WHERE movement.source_type = 'PURCHASE_RECEIPT'
            AND movement.source_id = receipt.id AND movement.source_line_key = receipt_line.id)) AS unmapped_count`)
      .bind(like).first<{ negative_count: number; unmapped_count: number }>(),
    db.prepare(`SELECT
      (SELECT COUNT(*) FROM finance_fixed_assets asset WHERE asset.status = 'ACTIVE'
        AND substr(asset.in_service_date, 1, 7) <= ? AND (asset.disposal_date = '' OR substr(asset.disposal_date, 1, 7) >= ?)
        AND (asset.opening_as_of = '' OR substr(asset.opening_as_of, 1, 7) < ?)
        AND asset.opening_accumulated + COALESCE((SELECT SUM(posted.depreciation_amount) FROM finance_asset_depreciation_schedules posted
          WHERE posted.asset_id = asset.id AND posted.status = 'POSTED'), 0) < asset.acquisition_cost - asset.residual_value) AS eligible_count,
      (SELECT COUNT(*) FROM finance_fixed_assets asset WHERE asset.status = 'ACTIVE'
        AND substr(asset.in_service_date, 1, 7) <= ? AND (asset.disposal_date = '' OR substr(asset.disposal_date, 1, 7) >= ?)
        AND (asset.opening_as_of = '' OR substr(asset.opening_as_of, 1, 7) < ?)
        AND asset.opening_accumulated + COALESCE((SELECT SUM(posted.depreciation_amount) FROM finance_asset_depreciation_schedules posted
          WHERE posted.asset_id = asset.id AND posted.status = 'POSTED'), 0) < asset.acquisition_cost - asset.residual_value
        AND NOT EXISTS (SELECT 1 FROM finance_asset_depreciation_schedules schedule
          WHERE schedule.asset_id = asset.id AND schedule.period = ?)) AS missing_count,
      (SELECT COUNT(*) FROM finance_asset_depreciation_schedules schedule
        WHERE schedule.period = ? AND schedule.status <> 'POSTED') AS unposted_count`)
      .bind(period, period, period, period, period, period, period, period).first<{ eligible_count: number; missing_count: number; unposted_count: number }>(),
    db.prepare(`SELECT
      (SELECT COUNT(*) FROM finance_expense_requests expense
        LEFT JOIN finance_expense_controls control ON control.expense_request_id = expense.id
        WHERE expense.requested_date LIKE ? AND expense.evidence_required = 1
          AND expense.status NOT IN ('CANCELLED','REJECTED')
          AND COALESCE(control.evidence_status, 'PENDING') NOT IN ('VERIFIED','EXEMPT')) AS unreviewed_count,
      (SELECT COUNT(*) FROM finance_card_transactions transaction_row
        WHERE transaction_row.transaction_date LIKE ? AND transaction_row.status = 'UNMATCHED') AS card_unmatched_count,
      (SELECT COUNT(*) FROM finance_payment_ledger payment
        JOIN finance_expense_requests expense ON expense.id = payment.request_id
        WHERE payment.payment_date LIKE ? AND payment.status = 'PAID'
          AND payment.payment_method IN ('BANK_TRANSFER','AUTO_DEBIT')
          AND payment.amount > COALESCE((SELECT SUM(match_row.matched_amount) FROM finance_cash_matches match_row
            WHERE match_row.source_type = 'PAYMENT_LEDGER' AND match_row.source_id = payment.id
              AND match_row.status = 'CONFIRMED'), 0)) AS bank_unmatched_count,
      (SELECT COUNT(*) FROM (SELECT requested_date, amount, LOWER(TRIM(vendor)) AS vendor_key
        FROM finance_expense_requests WHERE requested_date LIKE ? AND status NOT IN ('CANCELLED','REJECTED')
        GROUP BY requested_date, amount, LOWER(TRIM(vendor)) HAVING COUNT(*) > 1)) AS duplicate_group_count`)
      .bind(like, like, like, like).first<{ unreviewed_count: number; card_unmatched_count: number; bank_unmatched_count: number; duplicate_group_count: number }>(),
    db.prepare(`WITH source_rows AS (
      SELECT 'SALES_INVOICE' AS source_type, document.id AS source_id, document.amount AS source_amount,
        CASE WHEN center.id IS NOT NULL THEN document.amount ELSE COALESCE((SELECT SUM(allocation.amount)
          FROM finance_project_allocations allocation WHERE allocation.source_type = 'SALES_INVOICE'
            AND allocation.source_id = document.id), 0) END AS allocated_amount
      FROM sales_documents document
      LEFT JOIN finance_cost_centers center ON center.opportunity_id = document.opportunity_id
      WHERE document.document_type = 'INVOICE' AND document.status IN ('ACCEPTED','COMPLETED') AND document.issued_date LIKE ?
      UNION ALL
      SELECT 'PURCHASE_INVOICE', invoice.id, invoice.supply_amount,
        COALESCE((SELECT SUM(allocation.amount) FROM finance_project_allocations allocation
          WHERE allocation.source_type = 'PURCHASE_INVOICE' AND allocation.source_id = invoice.id), 0)
      FROM finance_purchase_invoices invoice
      WHERE invoice.status IN ('MATCHED','PAYMENT_READY','PAID') AND invoice.invoice_date LIKE ?
      UNION ALL
      SELECT 'EXPENSE_REQUEST', expense.id, expense.amount,
        COALESCE((SELECT SUM(allocation.amount) FROM finance_project_allocations allocation
          WHERE allocation.source_type = 'EXPENSE_REQUEST' AND allocation.source_id = expense.id), 0)
      FROM finance_expense_requests expense
      WHERE expense.status = 'PAID' AND expense.requested_date LIKE ? AND expense.source_type NOT IN ('PURCHASE_INVOICE','PAYROLL_RUN')
      UNION ALL
      SELECT 'PAYROLL_RUN', payroll.period, payroll.gross_pay,
        COALESCE((SELECT SUM(allocation.amount) FROM finance_project_allocations allocation
          WHERE allocation.source_type = 'PAYROLL_RUN' AND allocation.source_id = payroll.period), 0)
      FROM hr_payroll_runs payroll WHERE payroll.period = ? AND payroll.status = 'LOCKED'
    ) SELECT
      COALESCE(SUM(CASE WHEN allocated_amount < source_amount THEN 1 ELSE 0 END), 0) AS unmapped_count,
      COALESCE(SUM(CASE WHEN allocated_amount < source_amount THEN source_amount - allocated_amount ELSE 0 END), 0) AS unmapped_amount,
      (SELECT COUNT(*) FROM finance_project_monthly_budgets budget
        WHERE budget.period = ? AND budget.cost_budget > 0 AND
          COALESCE((SELECT SUM(allocation.amount) FROM finance_project_allocations allocation
            WHERE allocation.cost_center_id = budget.cost_center_id AND allocation.period = budget.period
              AND allocation.direction = 'COST'), 0) > budget.cost_budget) AS over_budget_count
      FROM source_rows`).bind(like, like, like, period, period)
      .first<{ unmapped_count: number; unmapped_amount: number; over_budget_count: number }>(),
    db.prepare("SELECT id, source_account_id, maturity_date, status FROM finance_debt_facilities WHERE status IN ('DRAFT','ACTIVE')")
      .all<{ id: string; source_account_id: string; maturity_date: string; status: string }>(),
    db.prepare(`SELECT COUNT(*) AS unpaid_count FROM finance_debt_schedule_items schedule
      LEFT JOIN finance_expense_requests expense ON expense.id = schedule.payment_request_id
      WHERE schedule.due_date LIKE ? AND schedule.status <> 'CANCELLED' AND COALESCE(expense.status, '') <> 'PAID'`)
      .bind(like).first<{ unpaid_count: number }>(),
    db.prepare(`SELECT
      (SELECT COUNT(*) FROM finance_debt_facilities facility WHERE facility.status = 'ACTIVE'
        AND facility.next_covenant_review_date <> '' AND facility.next_covenant_review_date <= ?) AS due_count,
      (SELECT COUNT(*) FROM finance_debt_covenant_reviews review
        WHERE review.result = 'BREACH' AND NOT EXISTS (SELECT 1 FROM finance_debt_covenant_reviews newer
          WHERE newer.facility_id = review.facility_id AND newer.covenant_name = review.covenant_name
            AND (newer.review_date > review.review_date OR (newer.review_date = review.review_date AND newer.created_at > review.created_at)))) AS breach_count`)
      .bind(lastDayOfPeriod(period)).first<{ due_count: number; breach_count: number }>(),
    db.prepare(`WITH eligible_sources AS (
      SELECT DISTINCT opportunity.id
      FROM sales_opportunities opportunity
      JOIN sales_incentive_rules rule ON rule.status IN ('ACTIVE','RETIRED') AND rule.approved_at IS NOT NULL
        AND rule.effective_from < ? AND (rule.effective_to = '' OR rule.effective_to >= ?)
      JOIN json_each(rule.rules_json, '$.eligibleLeadTypes') eligible ON eligible.value = opportunity.lead_type
      LEFT JOIN finance_cost_centers center ON center.opportunity_id = opportunity.id
      WHERE opportunity.stage = 'WON' AND opportunity.deleted_at IS NULL AND opportunity.owner_employee_id <> ''
        AND EXISTS (SELECT 1 FROM sales_documents invoice WHERE invoice.opportunity_id = opportunity.id
          AND invoice.document_type = 'INVOICE' AND invoice.status IN ('ACCEPTED','COMPLETED'))
        AND (EXISTS (SELECT 1 FROM sales_documents payment WHERE payment.opportunity_id = opportunity.id
          AND payment.document_type = 'PAYMENT' AND payment.status IN ('ACCEPTED','COMPLETED')
          AND payment.issued_date >= CASE WHEN rule.effective_from > ? THEN rule.effective_from ELSE ? END AND payment.issued_date < ?)
          OR EXISTS (SELECT 1 FROM finance_project_allocations allocation WHERE allocation.cost_center_id = center.id
            AND allocation.direction = 'COST' AND allocation.period = ?))
    ) SELECT
      (SELECT COUNT(*) FROM eligible_sources) AS eligible_source_count,
      (SELECT COUNT(*) FROM eligible_sources source WHERE NOT EXISTS (
        SELECT 1 FROM sales_incentive_results result WHERE result.period = ? AND result.opportunity_id = source.id)) AS missing_result_count,
      (SELECT COUNT(*) FROM sales_incentive_results result WHERE result.period = ?
        AND result.status NOT IN ('PAYROLL_APPLIED','VOID')) AS unresolved_count,
      (SELECT COUNT(*) FROM sales_incentive_results result WHERE result.period = ? AND result.status <> 'VOID'
        AND COALESCE(json_extract(result.calculation_json, '$.costQuality'), '') <> 'ACTUAL_PROJECT_COST') AS fallback_count,
      (SELECT COUNT(*) FROM sales_incentive_results result WHERE result.period = ? AND result.status <> 'VOID'
        AND COALESCE(json_extract(result.calculation_json, '$.clawbackCandidate'), 0) < 0) AS clawback_count`)
      .bind(periodEndExclusive, periodStart, periodStart, periodStart, periodEndExclusive, period, period, period, period, period)
      .first<{ eligible_source_count: number; missing_result_count: number; unresolved_count: number; fallback_count: number; clawback_count: number }>(),
    db.prepare(`SELECT report_date, status, version, source_as_of, analysis_source, ai_status
      FROM finance_daily_treasury_reports WHERE report_date LIKE ? AND report_date <= ?
      ORDER BY report_date DESC, version DESC LIMIT 1`).bind(like, treasuryTargetDate)
      .first<{ report_date: string; status: string; version: number; source_as_of: string; analysis_source: string; ai_status: string }>(),
    db.prepare(`SELECT tax_period.status, tax_period.source_as_of, tax_period.source_sales_supply, tax_period.source_purchase_supply,
        (SELECT COUNT(*) FROM erp_documents document WHERE document.module = 'finance'
          AND document.entity_type = 'financeTaxPeriod' AND document.entity_id = ? AND document.deleted_at IS NULL) AS evidence_count
      FROM finance_tax_periods tax_period WHERE tax_period.period = ?`).bind(period, period)
      .first<{ status: string; source_as_of: string; source_sales_supply: number; source_purchase_supply: number; evidence_count: number }>(),
  ]);
  const bankTotal = Number(bank?.total_count ?? 0);
  const bankPending = Number(bank?.pending_count ?? 0);
  const activeDebtSources = new Set(debtFacilities.results.filter((row) => row.status === "ACTIVE").map((row) => row.source_account_id));
  const unmappedDebt = financeCurrentData.accounts.filter((account) => account.type === "LOAN" && account.krwBalance > 0
    && !activeDebtSources.has(String(account.id))).length;
  const maturedDebt = debtFacilities.results.filter((row) => row.status === "ACTIVE" && row.maturity_date <= lastDayOfPeriod(period)
    && (financeCurrentData.accounts.find((account) => String(account.id) === row.source_account_id)?.krwBalance ?? 0) > 0).length;
  const debtIssueCount = unmappedDebt + maturedDebt + Number(debtSchedule?.unpaid_count ?? 0)
    + Number(debtCovenants?.due_count ?? 0) + Number(debtCovenants?.breach_count ?? 0);
  const alertCutoff = period === currentPeriod ? financeCurrentData.asOf : lastDayOfPeriod(period);
  const alertActions = await buildFinanceAlertReportSnapshot(db, alertCutoff);
  const ledgerSnapshot = await ledgerSnapshotPromise;
  await ensureFinanceTieOutSchema(db);
  const receivablesTieOut = await db.prepare("SELECT * FROM finance_tie_out_checks WHERE check_type = 'RECEIVABLES' AND period = ?")
    .bind(period).first<TieOutRow>();
  const payablesTieOut = await db.prepare("SELECT * FROM finance_tie_out_checks WHERE check_type = 'PAYABLES' AND period = ?")
    .bind(period).first<TieOutRow>();
  const inventoryTieOut = await db.prepare("SELECT * FROM finance_tie_out_checks WHERE check_type = 'INVENTORY' AND period = ?")
    .bind(period).first<TieOutRow>();
  const debtTieOut = await db.prepare("SELECT * FROM finance_tie_out_checks WHERE check_type = 'DEBT' AND period = ?")
    .bind(period).first<TieOutRow>();
  const bankTieOut = await db.prepare("SELECT * FROM finance_tie_out_checks WHERE check_type = 'BANK' AND period = ?")
    .bind(period).first<TieOutRow>();
  const controls: CloseControl[] = [
    { key: "APPROVED_OPENING_BALANCE", category: "STATEMENT", title: "승인된 2026 개시잔액",
      status: ledgerSnapshot.openingSetId ? "PASS" : "FAIL",
      message: ledgerSnapshot.openingSetId
        ? `${ledgerSnapshot.openingSetId} · 원천 SHA-256 ${ledgerSnapshot.openingChecksum.slice(0, 12)}…`
        : "전자결재가 완료된 2026 개시잔액 기준선이 없습니다.",
      count: ledgerSnapshot.openingSetId ? 0 : 1 },
    { key: "GENERAL_LEDGER_BALANCE", category: "STATEMENT", title: "총계정원장·재무제표 균형",
      status: ledgerSnapshot.difference.opening === 0 && ledgerSnapshot.difference.period === 0
        && ledgerSnapshot.difference.ending === 0 && ledgerSnapshot.statements.quality.equationBalanced ? "PASS" : "FAIL",
      message: `전기 ${ledgerSnapshot.lineCount}행 · 개시 차이 ${ledgerSnapshot.difference.opening.toLocaleString("ko-KR")}원 · 당기 차이 ${ledgerSnapshot.difference.period.toLocaleString("ko-KR")}원 · 기말 차이 ${ledgerSnapshot.difference.ending.toLocaleString("ko-KR")}원 · 회계등식 차이 ${ledgerSnapshot.statements.balanceSheet.equationDifference.toLocaleString("ko-KR")}원`,
      count: Math.abs(ledgerSnapshot.difference.opening) + Math.abs(ledgerSnapshot.difference.period)
        + Math.abs(ledgerSnapshot.difference.ending) + Math.abs(ledgerSnapshot.statements.balanceSheet.equationDifference) },
    { key: "RECEIVABLES_TIE_OUT", category: "STATEMENT", title: "매출채권 보조부 ↔ 원장 대사",
      status: tieOutPasses(receivablesTieOut) ? "PASS" : "FAIL",
      message: !receivablesTieOut ? "이번 마감월의 매출채권 대사를 아직 계산하지 않았습니다."
        : receivablesTieOut.difference_amount === 0 ? `보조부·원장 잔액 일치 (${receivablesTieOut.gl_account_code} ${receivablesTieOut.gl_account_name})`
        : receivablesTieOut.difference_reason === "STRUCTURAL" ? `차이 ${receivablesTieOut.difference_amount.toLocaleString("ko-KR")}원 · 구조적 차이로 확인됨: ${receivablesTieOut.note}`
        : `차이 ${receivablesTieOut.difference_amount.toLocaleString("ko-KR")}원 · 사유 미확인`,
      count: tieOutPasses(receivablesTieOut) ? 0 : 1 },
    { key: "PAYABLES_TIE_OUT", category: "STATEMENT", title: "매입채무 보조부 ↔ 원장 대사",
      status: tieOutPasses(payablesTieOut) ? "PASS" : "FAIL",
      message: !payablesTieOut ? "이번 마감월의 매입채무 대사를 아직 계산하지 않았습니다."
        : payablesTieOut.difference_amount === 0 ? `보조부·원장 잔액 일치 (${payablesTieOut.gl_account_code} ${payablesTieOut.gl_account_name})`
        : payablesTieOut.difference_reason === "STRUCTURAL" ? `차이 ${payablesTieOut.difference_amount.toLocaleString("ko-KR")}원 · 구조적 차이로 확인됨: ${payablesTieOut.note}`
        : `차이 ${payablesTieOut.difference_amount.toLocaleString("ko-KR")}원 · 사유 미확인`,
      count: tieOutPasses(payablesTieOut) ? 0 : 1 },
    { key: "INVENTORY_TIE_OUT", category: "STATEMENT", title: "재고자산 보조부 ↔ 원장 대사",
      status: tieOutPasses(inventoryTieOut) ? "PASS" : "FAIL",
      message: !inventoryTieOut ? "이번 마감월의 재고자산 대사를 아직 계산하지 않았습니다."
        : inventoryTieOut.difference_amount === 0 ? `보조부·원장 잔액 일치 (${inventoryTieOut.gl_account_code} ${inventoryTieOut.gl_account_name})`
        : inventoryTieOut.difference_reason === "STRUCTURAL" ? `차이 ${inventoryTieOut.difference_amount.toLocaleString("ko-KR")}원 · 구조적 차이로 확인됨: ${inventoryTieOut.note}`
        : `차이 ${inventoryTieOut.difference_amount.toLocaleString("ko-KR")}원 · 사유 미확인`,
      count: tieOutPasses(inventoryTieOut) ? 0 : 1 },
    { key: "DEBT_TIE_OUT", category: "STATEMENT", title: "차입금 보조부 ↔ 원장 대사",
      status: tieOutPasses(debtTieOut) ? "PASS" : "FAIL",
      message: !debtTieOut ? "이번 마감월의 차입금 대사를 아직 계산하지 않았습니다."
        : debtTieOut.difference_amount === 0 ? `보조부·원장 잔액 일치 (${debtTieOut.gl_account_code} ${debtTieOut.gl_account_name})`
        : debtTieOut.difference_reason === "STRUCTURAL" ? `차이 ${debtTieOut.difference_amount.toLocaleString("ko-KR")}원 · 구조적 차이로 확인됨: ${debtTieOut.note}`
        : `차이 ${debtTieOut.difference_amount.toLocaleString("ko-KR")}원 · 사유 미확인`,
      count: tieOutPasses(debtTieOut) ? 0 : 1 },
    { key: "BANK_BALANCE_TIE_OUT", category: "STATEMENT", title: "은행계정조정표(보통예금 잔액 대사)",
      status: tieOutPasses(bankTieOut) ? "PASS" : "FAIL",
      message: !bankTieOut ? "이번 마감월의 은행계정조정표를 아직 계산하지 않았습니다."
        : bankTieOut.difference_amount === 0 ? `보조부·원장 잔액 일치 (${bankTieOut.gl_account_code} ${bankTieOut.gl_account_name})`
        : bankTieOut.difference_reason === "STRUCTURAL" ? `차이 ${bankTieOut.difference_amount.toLocaleString("ko-KR")}원 · 구조적 차이로 확인됨: ${bankTieOut.note}`
        : `차이 ${bankTieOut.difference_amount.toLocaleString("ko-KR")}원 · 사유 미확인`,
      count: tieOutPasses(bankTieOut) ? 0 : 1 },
    { key: "BANK_RECONCILIATION", category: "BANK", title: "원화 은행거래 대사",
      status: bankTotal > 0 && bankPending === 0 ? "PASS" : "FAIL",
      message: bankTotal ? `${bankTotal}건 중 미대사 ${bankPending}건` : "해당 월 은행 거래 원문이 없습니다.", count: bankPending },
    { key: "DAILY_TREASURY_REPORT", category: "TREASURY", title: "최신 기준일 자금일보",
      status: treasuryReport?.report_date === treasuryTargetDate && treasuryReport.status === "FINAL"
        && (period !== currentPeriod || treasuryReport.source_as_of === financeCurrentData.asOf) ? "PASS" : "FAIL",
      message: treasuryReport
        ? `${treasuryReport.report_date} v${treasuryReport.version} · ${treasuryReport.status} · ${treasuryReport.analysis_source === "AI" ? "AI 분석" : `규칙 기반(${treasuryReport.ai_status})`}`
        : `${treasuryTargetDate} 기준 확정 자금일보가 없습니다.`,
      count: treasuryReport?.report_date === treasuryTargetDate && treasuryReport.status === "FINAL"
        && (period !== currentPeriod || treasuryReport.source_as_of === financeCurrentData.asOf) ? 0 : 1 },
    { key: "FINANCE_ALERT_ACTIONS", category: "ALERT", title: "재무 경보 조치",
      status: alertActions.highCriticalUnresolvedCount > 0 ? "FAIL" : alertActions.unresolvedCount > 0 ? "REVIEW" : "PASS",
      message: `${alertCutoff} 기준 미해결 ${alertActions.unresolvedCount}건 · 중요 ${alertActions.highCriticalUnresolvedCount}건 · 종료검토 ${alertActions.reviewCount}건 · 기한경과 ${alertActions.overdueCount}건`,
      count: alertActions.unresolvedCount },
    { key: "ERP_UNPOSTED_JOURNALS", category: "JOURNAL", title: "ERP 미전기 회계전표",
      status: Number(unposted?.count ?? 0) === 0 ? "PASS" : "FAIL",
      message: `미전기 전표 ${Number(unposted?.count ?? 0)}건`, count: Number(unposted?.count ?? 0) },
    { key: "CONTROLLED_POSTING_PENDING", category: "JOURNAL", title: "통제 분개 미전기 배치",
      status: Number(pendingPosting?.batch_count ?? 0) === 0 ? "PASS" : "FAIL",
      message: Number(pendingPosting?.batch_count ?? 0) === 0
        ? "작성·결재·승인 후 전기 대기 중인 분개 배치가 없습니다."
        : `미전기 분개 ${Number(pendingPosting?.batch_count ?? 0)}개 배치 · ${Number(pendingPosting?.line_count ?? 0)}행`,
      count: Number(pendingPosting?.batch_count ?? 0) },
    { key: "EXPENSE_EVIDENCE", category: "EVIDENCE", title: "지출·지급 증빙",
      status: Number(missingEvidence?.count ?? 0) === 0 ? "PASS" : "FAIL",
      message: `증빙 누락 요청 ${Number(missingEvidence?.count ?? 0)}건`, count: Number(missingEvidence?.count ?? 0) },
    { key: "EXPENSE_SPEND_CONTROL", category: "EXPENSE_CONTROL", title: "법인카드·지출증빙 대사",
      status: Number(expenseControl?.unreviewed_count ?? 0) + Number(expenseControl?.card_unmatched_count ?? 0)
        + Number(expenseControl?.bank_unmatched_count ?? 0) > 0 ? "FAIL" : Number(expenseControl?.duplicate_group_count ?? 0) > 0 ? "REVIEW" : "PASS",
      message: `증빙 미검토 ${Number(expenseControl?.unreviewed_count ?? 0)}건 · 카드 미대사 ${Number(expenseControl?.card_unmatched_count ?? 0)}건 · 은행 미대사 지급 ${Number(expenseControl?.bank_unmatched_count ?? 0)}건 · 중복 후보군 ${Number(expenseControl?.duplicate_group_count ?? 0)}개`,
      count: Number(expenseControl?.unreviewed_count ?? 0) + Number(expenseControl?.card_unmatched_count ?? 0)
        + Number(expenseControl?.bank_unmatched_count ?? 0) + Number(expenseControl?.duplicate_group_count ?? 0) },
    { key: "PAYROLL_LOCK", category: "PAYROLL", title: "급여월 잠금",
      status: payroll?.status === "LOCKED" ? "PASS" : "FAIL",
      message: payroll ? `${payroll.employee_count}명 · ${payroll.status}` : "급여월이 생성되지 않았습니다.", count: payroll?.status === "LOCKED" ? 0 : 1 },
    { key: "INCENTIVE_SETTLEMENT_CONTROL", category: "INCENTIVE", title: "인센티브 누적 정산",
      status: Number(incentiveSettlement?.missing_result_count ?? 0) + Number(incentiveSettlement?.unresolved_count ?? 0)
        + Number(incentiveSettlement?.fallback_count ?? 0) + Number(incentiveSettlement?.clawback_count ?? 0) === 0 ? "PASS" : "FAIL",
      message: `대상 ${Number(incentiveSettlement?.eligible_source_count ?? 0)}건 · 미계산 ${Number(incentiveSettlement?.missing_result_count ?? 0)}건 · 미완료 ${Number(incentiveSettlement?.unresolved_count ?? 0)}건 · 예상원가 대체 ${Number(incentiveSettlement?.fallback_count ?? 0)}건 · 환수 검토 ${Number(incentiveSettlement?.clawback_count ?? 0)}건`,
      count: Number(incentiveSettlement?.missing_result_count ?? 0) + Number(incentiveSettlement?.unresolved_count ?? 0)
        + Number(incentiveSettlement?.fallback_count ?? 0) + Number(incentiveSettlement?.clawback_count ?? 0) },
    { key: "INVENTORY_LEDGER", category: "INVENTORY", title: "재고원장 완전성",
      status: Number(inventory?.negative_count ?? 0) === 0 && Number(inventory?.unmapped_count ?? 0) === 0 ? "PASS" : "FAIL",
      message: `음수재고 ${Number(inventory?.negative_count ?? 0)}건 · 미반영 입고검수 ${Number(inventory?.unmapped_count ?? 0)}건`,
      count: Number(inventory?.negative_count ?? 0) + Number(inventory?.unmapped_count ?? 0) },
    { key: "FIXED_ASSET_DEPRECIATION", category: "FIXED_ASSET", title: "고정자산 감가상각",
      status: Number(fixedAssets?.missing_count ?? 0) === 0 && Number(fixedAssets?.unposted_count ?? 0) === 0 ? "PASS" : "FAIL",
      message: `대상 ${Number(fixedAssets?.eligible_count ?? 0)}개 · 계획 누락 ${Number(fixedAssets?.missing_count ?? 0)}개 · 미전기 ${Number(fixedAssets?.unposted_count ?? 0)}건`,
      count: Number(fixedAssets?.missing_count ?? 0) + Number(fixedAssets?.unposted_count ?? 0) },
    { key: "PROJECT_COST_ALLOCATION", category: "PROJECT_COST", title: "프로젝트·원가센터 배부",
      status: Number(projectCost?.unmapped_count ?? 0) > 0 ? "FAIL" : Number(projectCost?.over_budget_count ?? 0) > 0 ? "REVIEW" : "PASS",
      message: `미분류 원천 ${Number(projectCost?.unmapped_count ?? 0)}건 · ${Number(projectCost?.unmapped_amount ?? 0).toLocaleString("ko-KR")}원 · 원가예산 초과 ${Number(projectCost?.over_budget_count ?? 0)}개 센터`,
      count: Number(projectCost?.unmapped_count ?? 0) + Number(projectCost?.over_budget_count ?? 0) },
    { key: "DEBT_SCHEDULE_CONTROL", category: "DEBT", title: "차입금·상환·약정",
      status: period !== currentPeriod ? "REVIEW" : debtIssueCount > 0 ? "FAIL" : "PASS",
      message: period !== currentPeriod ? "과거 월의 대출잔액은 당시 원천증빙으로 수동 확인해야 합니다."
        : `미승인·미연결 대출계좌 ${unmappedDebt}개 · 미지급 일정 ${Number(debtSchedule?.unpaid_count ?? 0)}건 · 만기경과 ${maturedDebt}건 · 약정 검토기한 ${Number(debtCovenants?.due_count ?? 0)}건 · 최근 위반 ${Number(debtCovenants?.breach_count ?? 0)}건`,
      count: period === currentPeriod ? debtIssueCount : 0 },
    { key: "TAX_RECONCILIATION", category: "TAX", title: "세금계산서·부가세 검토",
      status: tax?.status === "REVIEWED" && Number(tax.evidence_count ?? 0) > 0 && tax.source_as_of === financeCurrentData.asOf
        && tax.source_sales_supply === currentTaxSalesSupply && tax.source_purchase_supply === currentTaxPurchaseSupply ? "PASS" : "FAIL",
      message: tax ? `${tax.status === "REVIEWED" ? "검토 완료" : "검토 미완료"} · 증빙 ${Number(tax.evidence_count ?? 0)}건${tax.source_as_of !== financeCurrentData.asOf || tax.source_sales_supply !== currentTaxSalesSupply || tax.source_purchase_supply !== currentTaxPurchaseSupply ? " · 원천 갱신 후 재검토 필요" : ""}` : "부가세 검토 원장이 없습니다.",
      count: tax?.status === "REVIEWED" && Number(tax.evidence_count ?? 0) > 0 && tax.source_as_of === financeCurrentData.asOf
        && tax.source_sales_supply === currentTaxSalesSupply && tax.source_purchase_supply === currentTaxPurchaseSupply ? 0 : 1 },
  ];
  controls.splice(1, 0, { key: "CLOBE_JOURNAL_BALANCE", category: "JOURNAL", title: "Clobe 분개장 차대변",
    status: period === currentPeriod ? (financeCurrentData.journalSummary.differenceKrw === 0 ? "PASS" : "FAIL") : "REVIEW",
    message: period === currentPeriod
      ? `차변·대변 차이 ${financeCurrentData.journalSummary.differenceKrw.toLocaleString("ko-KR")}원`
      : "과거 월별 분개 집계는 마감 증빙으로 수동 확인해야 합니다.",
    count: period === currentPeriod ? Math.abs(financeCurrentData.journalSummary.differenceKrw) : 0 });
  return controls;
}

const taskView = (row: CloseTaskRow) => ({
  id: row.id, period: row.period, category: row.category, title: row.title, ownerEmployeeId: row.owner_employee_id,
  status: row.status, completedAt: row.completed_at, approvedBy: row.approved_by, approvedAt: row.approved_at,
});
const runView = (row: CloseRunRow) => ({
  period: row.period, periodEnd: row.period_end, status: row.status, controlPassCount: row.control_pass_count,
  controlFailCount: row.control_fail_count, manualCompletedCount: row.manual_completed_count,
  manualTotalCount: row.manual_total_count, evidenceCount: row.evidence_count, submittedBy: row.submitted_by,
  submittedAt: row.submitted_at, closedBy: row.closed_by, closedAt: row.closed_at, reopenedBy: row.reopened_by,
  reopenedAt: row.reopened_at, reopenedReason: row.reopened_reason, version: row.version,
});

async function synchronizeAutomatedTasks(period: string, runStatus: string, controls: CloseControl[]) {
  if (!['OPEN', 'READY'].includes(runStatus)) return;
  const now = Date.now();
  const categories = ["BANK", "TREASURY", "ALERT", "JOURNAL", "EVIDENCE", "EXPENSE_CONTROL", "PAYROLL", "INVENTORY", "FIXED_ASSET", "PROJECT_COST", "DEBT", "TAX"];
  const statements = categories.flatMap((category) => {
    const categoryControls = controls.filter((control) => control.category === category);
    if (!categoryControls.length || categoryControls.some((control) => control.status === "REVIEW")) return [];
    const passed = categoryControls.every((control) => control.status === "PASS");
    return [db.prepare(`UPDATE finance_close_tasks SET status = ?, completed_at = ?, updated_at = ?
      WHERE period = ? AND category = ? AND status <> 'APPROVED'`)
      .bind(passed ? "COMPLETED" : "IN_PROGRESS", passed ? now : null, now, period, category)];
  });
  if (statements.length) await db.batch(statements);
}

async function closeState(period: string) {
  const run = await db.prepare("SELECT * FROM finance_close_runs WHERE period = ?").bind(period).first<CloseRunRow>();
  if (!run) throw new Error("월마감 실행 원장을 찾을 수 없습니다.");
  const liveControls = await computeControls(period);
  let controls = liveControls;
  let storedSnapshot: StoredCloseSnapshot | null = null;
  if (run.status !== "OPEN" && run.snapshot_json && run.snapshot_json !== "{}") {
    try {
      storedSnapshot = JSON.parse(run.snapshot_json) as StoredCloseSnapshot;
      if (Array.isArray(storedSnapshot.controls)) controls = storedSnapshot.controls;
    } catch { /* 손상된 과거 스냅샷은 실시간 통제로 대체해 화면을 유지합니다. */ }
  }
  const frozen = storedSnapshot?.ledgerSnapshot;
  let ledgerDrift = { checked: false, drifted: false, reason: "마감 제출 후 동결 원장과 현재 원장을 비교합니다.",
    checkedAsOf: "", frozenHash: "", currentHash: "", frozenLineCount: 0, currentLineCount: 0,
    lineCountDelta: 0, totalsChanged: false, openingChanged: false };
  if (run.status !== "OPEN" && frozen?.ledgerHash && frozen.asOf) {
    try {
      const currentLedger = await buildFinanceLedgerSnapshot(db, frozen.asOf);
      const drift = evaluateLedgerSnapshotDrift(frozen, currentLedger);
      ledgerDrift = { ...drift,
        reason: drift.drifted
          ? "마감 이후 전기행 또는 개시잔액 계보가 바뀌었습니다. 자동 수정 없이 재개방 승인이 필요합니다."
          : "제출 시 동결한 원장 계보와 현재 원장이 일치합니다." };
    } catch {
      ledgerDrift = { ...ledgerDrift, reason: "동결 원장과 현재 원장의 무결성 비교를 완료하지 못했습니다. 원장 접근 상태를 확인해 주세요." };
    }
  }
  await synchronizeAutomatedTasks(period, run.status, controls);
  const [tasksResult, documentsResult] = await Promise.all([
    db.prepare("SELECT * FROM finance_close_tasks WHERE period = ? ORDER BY created_at, category").bind(period).all<CloseTaskRow>(),
    db.prepare(`SELECT id, category, version, file_name, uploaded_by, created_at FROM erp_documents
      WHERE module = 'finance' AND entity_type = 'financeCloseRun' AND entity_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC`).bind(period).all<DocumentRow>(),
  ]);
  const tasks = tasksResult.results;
  const manualCategories = new Set(["AR_AP", "STATEMENT"]);
  const manualTasks = tasks.filter((task) => manualCategories.has(task.category)
    || controls.some((control) => control.category === task.category && control.status === "REVIEW"));
  const passCount = controls.filter((control) => control.status === "PASS").length;
  const failCount = controls.filter((control) => control.status === "FAIL").length;
  const manualCompleted = manualTasks.filter((task) => ["COMPLETED", "APPROVED"].includes(task.status)).length;
  const evidenceCount = documentsResult.results.length;
  if (run.status === "OPEN") await db.prepare(`UPDATE finance_close_runs SET control_pass_count = ?, control_fail_count = ?,
    manual_completed_count = ?, manual_total_count = ?, evidence_count = ?, updated_at = ? WHERE period = ? AND status = 'OPEN'`)
    .bind(passCount, failCount, manualCompleted, manualTasks.length, evidenceCount, Date.now(), period).run();
  const refreshedRun = run.status === "OPEN"
    ? await db.prepare("SELECT * FROM finance_close_runs WHERE period = ?").bind(period).first<CloseRunRow>() : run;
  const reasons = [
    ...controls.filter((control) => control.status === "FAIL").map((control) => control.message),
    ...manualTasks.filter((task) => !["COMPLETED", "APPROVED"].includes(task.status)).map((task) => `${task.title} 미완료`),
    ...(evidenceCount ? [] : ["마감 증빙 파일 미첨부"]),
  ];
  return { run: refreshedRun ?? run, controls, tasks, documents: documentsResult.results, ledgerDrift,
    summary: { passCount, failCount, reviewCount: controls.filter((control) => control.status === "REVIEW").length,
      manualCompleted, manualTotal: manualTasks.length, evidenceCount, canSubmit: reasons.length === 0, reasons } };
}

export async function GET(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "finance", "read");
  if (authorization.response) return authorization.response;
  const period = new URL(request.url).searchParams.get("period")?.trim() || currentPeriod;
  if (!validPeriod(period)) return Response.json({ error: "2026년 현재까지의 마감월을 선택해 주세요." }, { status: 400 });
  await seedClose(period);
  const state = await closeState(period);
  return Response.json({ asOf: financeCurrentData.asOf, currentPeriod, run: runView(state.run), controls: state.controls,
    tasks: state.tasks.map(taskView), documents: state.documents.map((document) => ({ id: document.id, category: document.category,
      version: document.version, fileName: document.file_name, uploadedBy: document.uploaded_by, createdAt: document.created_at,
      downloadUrl: `/api/documents?downloadId=${encodeURIComponent(document.id)}` })), summary: state.summary,
    ledgerDrift: state.ledgerDrift });
}

export async function POST(request: Request) {
  await ensureSchema();
  const body = await request.json() as Record<string, unknown>;
  const action = String(body.action ?? "").toUpperCase();
  const period = String(body.period ?? "").trim();
  if (!validPeriod(period)) return Response.json({ error: "2026년 현재까지의 마감월을 선택해 주세요." }, { status: 400 });
  const permission = action === "REQUEST_REOPEN" ? "approve" : "write";
  const authorization = await authorizeErpRequest(db, "finance", permission);
  if (authorization.response) return authorization.response;
  await seedClose(period);

  if (action === "UPDATE_TASK") {
    const run = await db.prepare("SELECT * FROM finance_close_runs WHERE period = ?").bind(period).first<CloseRunRow>();
    if (!run || run.status !== "OPEN") return Response.json({ error: "제출 또는 잠금된 마감월의 업무는 수정할 수 없습니다." }, { status: 409 });
    const taskId = String(body.taskId ?? "").trim();
    const status = String(body.status ?? "").toUpperCase();
    const task = await db.prepare("SELECT * FROM finance_close_tasks WHERE id = ? AND period = ?").bind(taskId, period).first<CloseTaskRow>();
    if (!task || !["OPEN", "IN_PROGRESS", "COMPLETED"].includes(status)) return Response.json({ error: "마감 업무와 상태를 확인해 주세요." }, { status: 400 });
    const controls = await computeControls(period);
    const automated = controls.some((control) => control.category === task.category)
      && !controls.some((control) => control.category === task.category && control.status === "REVIEW");
    if (automated) return Response.json({ error: "자동 통제 업무는 원장 상태에 따라 자동 변경됩니다." }, { status: 409 });
    const now = Date.now();
    await db.prepare("UPDATE finance_close_tasks SET status = ?, owner_employee_id = ?, completed_at = ?, updated_at = ? WHERE id = ?")
      .bind(status, authorization.principal.employeeId, status === "COMPLETED" ? now : null, now, taskId).run();
    const after = await db.prepare("SELECT * FROM finance_close_tasks WHERE id = ?").bind(taskId).first<CloseTaskRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "CLOSE_TASK_UPDATED",
      entityType: "financeCloseTask", entityId: taskId, before: taskView(task), after: after ? taskView(after) : null });
    return Response.json({ item: after ? taskView(after) : null });
  }

  if (action === "SUBMIT_CLOSE") {
    const state = await closeState(period);
    if (state.run.status !== "OPEN") return Response.json({ error: "작성 중인 마감월만 결재 제출할 수 있습니다." }, { status: 409 });
    if (!state.summary.canSubmit) return Response.json({ error: "마감 전 필수 통제를 완료해 주세요.", reasons: state.summary.reasons }, { status: 409 });
    const existing = await db.prepare(`SELECT id, status FROM erp_approval_requests
      WHERE target_entity_type = 'FINANCE_CLOSE_RUN' AND target_entity_id = ? ORDER BY created_at DESC LIMIT 1`)
      .bind(period).first<{ id: string; status: string }>();
    if (existing && ["SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED"].includes(existing.status)) {
      return Response.json({ approvalSubmitted: true, approvalId: existing.id }, { status: 202 });
    }
    const now = Date.now();
    const ledgerAsOf = period === currentPeriod ? financeCurrentData.asOf : lastDayOfPeriod(period);
    const ledgerSnapshot = await buildFinanceLedgerSnapshot(db, ledgerAsOf);
    if (!ledgerSnapshot.official) return Response.json({ error: "공식 개시잔액과 균형이 확인된 총계정원장이 필요합니다.",
      reasons: [!ledgerSnapshot.openingSetId ? "개시잔액 승인 필요" : "", ledgerSnapshot.difference.opening !== 0 ? "개시 차대변 불일치" : "",
        ledgerSnapshot.difference.period !== 0 ? "당기 차대변 불일치" : "", ledgerSnapshot.difference.ending !== 0 ? "기말 차대변 불일치" : "",
        !ledgerSnapshot.statements.quality.equationBalanced ? "재무상태표 회계등식 불일치" : "",
        ledgerSnapshot.statements.quality.unclassifiedCount ? `미분류 계정 ${ledgerSnapshot.statements.quality.unclassifiedCount}개` : ""].filter(Boolean) }, { status: 409 });
    const snapshot = { period, periodEnd: state.run.period_end, asOf: financeCurrentData.asOf,
      controls: state.controls, tasks: state.tasks.map(taskView), evidenceCount: state.summary.evidenceCount,
      ledgerSnapshot: { asOf: ledgerSnapshot.asOf, official: ledgerSnapshot.official,
        openingSetId: ledgerSnapshot.openingSetId, openingChecksum: ledgerSnapshot.openingChecksum,
        lineCount: ledgerSnapshot.lineCount, totals: ledgerSnapshot.totals, difference: ledgerSnapshot.difference,
        statements: { status: ledgerSnapshot.statements.status,
          incomeStatement: { revenue: ledgerSnapshot.statements.incomeStatement.revenue,
            expenses: ledgerSnapshot.statements.incomeStatement.expenses,
            netIncome: ledgerSnapshot.statements.incomeStatement.netIncome },
          balanceSheet: { assets: ledgerSnapshot.statements.balanceSheet.assets,
            liabilities: ledgerSnapshot.statements.balanceSheet.liabilities,
            equity: ledgerSnapshot.statements.balanceSheet.equity,
            currentEarnings: ledgerSnapshot.statements.balanceSheet.currentEarnings,
            equationDifference: ledgerSnapshot.statements.balanceSheet.equationDifference },
          quality: ledgerSnapshot.statements.quality }, ledgerHash: ledgerSnapshot.ledgerHash } };
    const updated = await db.prepare(`UPDATE finance_close_runs SET status = 'SUBMITTED', snapshot_json = ?,
      control_pass_count = ?, control_fail_count = ?, manual_completed_count = ?, manual_total_count = ?,
      evidence_count = ?, submitted_by = ?, submitted_at = ?, updated_at = ? WHERE period = ? AND status = 'OPEN'`)
      .bind(JSON.stringify(snapshot), state.summary.passCount, state.summary.failCount, state.summary.manualCompleted,
        state.summary.manualTotal, state.summary.evidenceCount, authorization.principal.employeeId, now, now, period).run();
    if ((updated.meta.changes ?? 0) < 1) return Response.json({ error: "마감 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
    try {
      const approval = await createApprovalRequest(db, authorization.principal, { module: "finance", requestType: "CLOSE",
        title: `${period} 월마감 잠금 승인`, description: `자동 통제 ${state.summary.passCount}개 통과 · 수동 검토 ${state.summary.manualCompleted}/${state.summary.manualTotal} · 증빙 ${state.summary.evidenceCount}건`,
        targetEntityType: "FINANCE_CLOSE_RUN", targetEntityId: period, metadata: snapshot });
      await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "CLOSE_RUN_SUBMITTED",
        entityType: "financeCloseRun", entityId: period, before: runView(state.run), after: { ...snapshot, approvalId: approval.id } });
      return Response.json({ approvalSubmitted: true, approvalId: approval.id }, { status: 202 });
    } catch (error) {
      await db.prepare("UPDATE finance_close_runs SET status = 'OPEN', submitted_by = '', submitted_at = NULL, updated_at = ? WHERE period = ? AND status = 'SUBMITTED'")
        .bind(Date.now(), period).run();
      throw error;
    }
  }

  if (action === "REQUEST_REOPEN") {
    const reason = String(body.reason ?? "").trim();
    const run = await db.prepare("SELECT * FROM finance_close_runs WHERE period = ?").bind(period).first<CloseRunRow>();
    if (!run || run.status !== "CLOSED") return Response.json({ error: "잠금된 마감월만 재개방을 요청할 수 있습니다." }, { status: 409 });
    if (!reason) return Response.json({ error: "재개방 사유를 입력해 주세요." }, { status: 400 });
    const existing = await db.prepare(`SELECT id, status FROM erp_approval_requests
      WHERE target_entity_type = 'FINANCE_CLOSE_REOPEN' AND target_entity_id = ? ORDER BY created_at DESC LIMIT 1`)
      .bind(period).first<{ id: string; status: string }>();
    if (existing && ["SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED"].includes(existing.status)) {
      return Response.json({ approvalSubmitted: true, approvalId: existing.id }, { status: 202 });
    }
    const approval = await createApprovalRequest(db, authorization.principal, { module: "finance", requestType: "CLOSE",
      title: `${period} 월마감 재개방 승인`, description: reason, targetEntityType: "FINANCE_CLOSE_REOPEN",
      targetEntityId: period, metadata: { period, reopenedReason: reason, currentVersion: run.version } });
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "CLOSE_REOPEN_REQUESTED",
      entityType: "financeCloseRun", entityId: period, before: runView(run), after: { approvalId: approval.id, reason }, reason });
    return Response.json({ approvalSubmitted: true, approvalId: approval.id }, { status: 202 });
  }

  return Response.json({ error: "지원하지 않는 월마감 작업입니다." }, { status: 400 });
}
