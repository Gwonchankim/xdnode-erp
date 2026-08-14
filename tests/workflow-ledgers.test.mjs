import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

async function migratedDatabase() {
  const db = new DatabaseSync(":memory:");
  const migrationDirectory = new URL("../drizzle/", import.meta.url);
  const files = (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of files) {
    const source = await readFile(new URL(name, migrationDirectory), "utf8");
    for (const statement of source.split("--> statement-breakpoint").map((value) => value.trim()).filter(Boolean)) db.exec(statement);
  }
  return db;
}

test("new workflow ledgers migrate cleanly and enforce one payment per request", async () => {
  const db = await migratedDatabase();
  const now = Date.now();
  db.prepare(`INSERT INTO finance_expense_requests
    (id, request_kind, title, amount, requested_date, requester_employee_id, created_at, updated_at)
    VALUES (?, 'EXPENSE', ?, ?, ?, ?, ?, ?)`)
    .run("expense-1", "테스트 지출", 10000, "2026-08-14", "gc.kim", now, now);
  const expense = db.prepare("SELECT source_type, source_id FROM finance_expense_requests WHERE id = ?").get("expense-1");
  assert.equal(expense.source_type, "MANUAL");
  assert.equal(expense.source_id, "");
  const insertPayment = db.prepare(`INSERT INTO finance_payment_ledger
    (id, request_id, payment_date, amount, payment_method, paid_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'BANK_TRANSFER', 'gc.kim', ?, ?)`);
  insertPayment.run("payment-1", "expense-1", "2026-08-14", 10000, now, now);
  assert.throws(() => insertPayment.run("payment-2", "expense-1", "2026-08-14", 10000, now, now), /UNIQUE constraint failed/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM finance_payment_ledger WHERE request_id = ?").get("expense-1").count, 1);
  const insertJournal = db.prepare(`INSERT INTO finance_journal_entries
    (id, payment_request_id, voucher_date, description, debit_account_name, credit_account_name,
      amount, prepared_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  insertJournal.run("journal-1", "expense-1", "2026-08-14", "테스트 지출", "소모품비", "보통예금", 10000, "gc.kim", now, now);
  assert.throws(() => insertJournal.run("journal-2", "expense-1", "2026-08-14", "중복", "소모품비", "보통예금", 10000, "gc.kim", now, now), /UNIQUE constraint failed/);
});

test("payroll close can identify its single downstream finance request", async () => {
  const db = await migratedDatabase();
  const now = Date.now();
  db.prepare(`INSERT INTO finance_expense_requests
    (id, request_kind, title, amount, requested_date, account_name, source_type, source_id,
      status, requester_employee_id, evidence_required, created_at, updated_at)
    VALUES (?, 'PAYMENT', ?, ?, ?, ?, 'PAYROLL_RUN', ?, 'APPROVED', ?, 0, ?, ?)`)
    .run("payroll:2026-08", "2026-08 급여 지급", 12345678, "2026-08-14", "급여(계정 확인 필요)", "2026-08", "gc.kim", now, now);
  assert.throws(() => db.prepare(`INSERT INTO finance_expense_requests
    (id, request_kind, title, amount, requested_date, source_type, source_id, requester_employee_id, created_at, updated_at)
    VALUES (?, 'PAYMENT', ?, ?, ?, 'PAYROLL_RUN', ?, ?, ?, ?)`)
    .run("payroll:2026-08", "중복 급여", 1, "2026-08-14", "2026-08", "gc.kim", now, now), /UNIQUE constraint failed/);
  const linked = db.prepare("SELECT source_type, source_id, status, evidence_required FROM finance_expense_requests WHERE id = ?").get("payroll:2026-08");
  assert.equal(linked.source_type, "PAYROLL_RUN");
  assert.equal(linked.source_id, "2026-08");
  assert.equal(linked.status, "APPROVED");
  assert.equal(linked.evidence_required, 0);
});

test("sales payment allocations preserve partial collections and one invoice target per payment", async () => {
  const db = await migratedDatabase();
  const now = Date.now();
  db.prepare(`INSERT INTO sales_accounts
    (id, name, owner_employee_id, created_at, updated_at) VALUES ('account-1', '테스트 고객사', 'gc.kim', ?, ?)`)
    .run(now, now);
  db.prepare(`INSERT INTO sales_opportunities
    (id, account_id, title, owner_employee_id, created_at, updated_at) VALUES ('opportunity-1', 'account-1', '테스트 매출', 'gc.kim', ?, ?)`)
    .run(now, now);
  const insertDocument = db.prepare(`INSERT INTO sales_documents
    (id, opportunity_id, document_type, document_number, amount, status, issued_date, created_at, updated_at)
    VALUES (?, 'opportunity-1', ?, ?, ?, ?, '2026-08-14', ?, ?)`);
  insertDocument.run("invoice-1", "INVOICE", "INV-001", 100000, "ACCEPTED", now, now);
  insertDocument.run("payment-1", "PAYMENT", "PAY-001", 40000, "ACCEPTED", now, now);
  insertDocument.run("payment-2", "PAYMENT", "PAY-002", 25000, "DRAFT", now, now);
  const insertAllocation = db.prepare(`INSERT INTO sales_payment_allocations
    (id, payment_document_id, invoice_document_id, amount, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'gc.kim', ?, ?)`);
  insertAllocation.run("allocation-1", "payment-1", "invoice-1", 40000, now, now);
  insertAllocation.run("allocation-2", "payment-2", "invoice-1", 25000, now, now);
  assert.throws(() => insertAllocation.run("allocation-3", "payment-2", "invoice-other", 25000, now, now), /UNIQUE constraint failed/);
  const totals = db.prepare(`SELECT
    SUM(allocation.amount) AS reserved,
    SUM(CASE WHEN payment.status IN ('ACCEPTED','COMPLETED') THEN allocation.amount ELSE 0 END) AS collected
    FROM sales_payment_allocations allocation JOIN sales_documents payment ON payment.id = allocation.payment_document_id
    WHERE allocation.invoice_document_id = ? AND payment.status <> 'CANCELLED'`).get("invoice-1");
  assert.equal(totals.reserved, 65000);
  assert.equal(totals.collected, 40000);
  const receivable = db.prepare(`SELECT invoice.id,
    COALESCE(SUM(CASE WHEN payment.status IN ('ACCEPTED','COMPLETED') THEN allocation.amount ELSE 0 END), 0) AS collected_amount,
    COALESCE(SUM(CASE WHEN payment.status NOT IN ('CANCELLED','ACCEPTED','COMPLETED') THEN allocation.amount ELSE 0 END), 0) AS reserved_amount
    FROM sales_documents invoice
    JOIN sales_opportunities opportunity ON opportunity.id = invoice.opportunity_id
    JOIN sales_accounts account ON account.id = opportunity.account_id
    LEFT JOIN sales_payment_allocations allocation ON allocation.invoice_document_id = invoice.id
    LEFT JOIN sales_documents payment ON payment.id = allocation.payment_document_id
    LEFT JOIN finance_receivable_cases receivable_case ON receivable_case.invoice_id = invoice.id
    WHERE invoice.document_type = 'INVOICE' AND invoice.status IN ('ACCEPTED','COMPLETED') AND invoice.id = ?
    GROUP BY invoice.id`).get("invoice-1");
  assert.equal(receivable.collected_amount, 40000);
  assert.equal(receivable.reserved_amount, 25000);
  assert.equal(100000 - receivable.collected_amount, 60000);
});

test("purchase ledgers preserve ordered quantities, accepted receipts and invoice uniqueness", async () => {
  const db = await migratedDatabase();
  const now = Date.now();
  db.prepare(`INSERT INTO finance_purchase_vendors
    (id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
    .run("vendor-1", "테스트 공급사", "gc.kim", now, now);
  db.prepare(`INSERT INTO finance_purchase_orders
    (id, order_number, vendor_id, title, subtotal, tax_amount, total_amount, status,
      requester_employee_id, approved_by, approved_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'APPROVED', ?, ?, ?, ?, ?)`)
    .run("order-1", "PO-001", "vendor-1", "원재료 발주", 100000, 10000, 110000, "gc.kim", "gc.kim", now, now, now);
  db.prepare(`INSERT INTO finance_purchase_order_lines
    (id, order_id, line_number, item_name, quantity_milli, unit_price, line_amount, created_at, updated_at)
    VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?)`)
    .run("order-line-1", "order-1", "원재료 A", 10000, 10000, 100000, now, now);
  db.prepare(`INSERT INTO finance_purchase_receipts
    (id, order_id, receipt_number, receipt_date, received_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run("receipt-1", "order-1", "GR-001", "2026-08-14", "gc.kim", now, now);
  db.prepare(`INSERT INTO finance_purchase_receipt_lines
    (id, receipt_id, order_line_id, received_quantity_milli, accepted_quantity_milli, rejected_quantity_milli, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run("receipt-line-1", "receipt-1", "order-line-1", 10000, 8000, 2000, now, now);
  const accepted = db.prepare(`SELECT ROUND(SUM(receipt_line.accepted_quantity_milli * order_line.unit_price / 1000.0)) AS amount
    FROM finance_purchase_receipt_lines receipt_line JOIN finance_purchase_order_lines order_line ON order_line.id = receipt_line.order_line_id
    WHERE receipt_line.receipt_id = ?`).get("receipt-1");
  assert.equal(accepted.amount, 80000);
  const insertInvoice = db.prepare(`INSERT INTO finance_purchase_invoices
    (id, order_id, invoice_number, invoice_date, supply_amount, tax_amount, total_amount,
      matched_receipt_amount, status, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  insertInvoice.run("invoice-1", "order-1", "INV-001", "2026-08-14", 80000, 8000, 88000, 80000, "MATCHED", "gc.kim", now, now);
  assert.throws(() => insertInvoice.run("invoice-2", "order-1", "INV-001", "2026-08-14", 1, 0, 1, 1, "MATCHED", "gc.kim", now, now), /UNIQUE constraint failed/);
});

test("cash reconciliation ledgers preserve source rows, partial allocations and reversible match groups", async () => {
  const db = await migratedDatabase();
  const now = Date.now();
  const insertTransaction = db.prepare(`INSERT INTO finance_bank_transactions
    (id, source_snapshot_date, account_id, currency, transaction_at, transaction_date,
      direction, amount, imported_at, updated_at) VALUES (?, '2026-08-14', ?, 'KRW', ?, ?, ?, ?, ?, ?)`);
  insertTransaction.run("bank-in-1", "162643", "2026-08-13T10:00:00", "2026-08-13", "IN", 100000, now, now);
  insertTransaction.run("bank-out-1", "162645", "2026-08-13T10:00:00", "2026-08-13", "OUT", 100000, now, now);
  const insertMatch = db.prepare(`INSERT INTO finance_cash_matches
    (id, match_group_id, bank_transaction_id, source_type, source_id, matched_amount,
      confirmed_by, confirmed_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'gc.kim', ?, ?, ?)`);
  insertMatch.run("match-1", "group-1", "bank-out-1", "PAYMENT_LEDGER", "payment-1", 40000, now, now, now);
  insertMatch.run("match-2", "group-2", "bank-out-1", "PAYMENT_LEDGER", "payment-2", 60000, now, now, now);
  const allocated = db.prepare(`SELECT SUM(matched_amount) AS amount FROM finance_cash_matches
    WHERE bank_transaction_id = ? AND status = 'CONFIRMED'`).get("bank-out-1");
  assert.equal(allocated.amount, 100000);
  assert.throws(() => insertMatch.run("match-3", "group-3", "bank-out-1", "PAYMENT_LEDGER", "payment-2", 1, now, now, now), /UNIQUE constraint failed/);
  db.prepare(`UPDATE finance_cash_matches SET status = 'REVERSED', reversed_by = 'gc.kim',
    reversed_at = ?, reversal_reason = '잘못 연결', updated_at = ? WHERE match_group_id = ?`)
    .run(now, now, "group-2");
  const remainingAllocation = db.prepare(`SELECT SUM(matched_amount) AS amount FROM finance_cash_matches
    WHERE bank_transaction_id = ? AND status = 'CONFIRMED'`).get("bank-out-1");
  assert.equal(remainingAllocation.amount, 40000);
});

test("retirement and recruitment offer ledgers preserve workflow state", async () => {
  const db = await migratedDatabase();
  const now = Date.now();
  db.prepare(`INSERT INTO hr_retirement_requests
    (id, employee_id, retirement_date, reason, checklist_json, total_tasks, completed_tasks, requested_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run("retirement-1", "gc.kim", "2026-09-30", "본인 의사", "[]", 10, 0, "gc.kim", now, now);
  db.prepare(`INSERT INTO hr_offer_requests
    (id, applicant_id, proposed_title, department, employment_type, start_date, annual_salary,
      probation_months, requested_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run("offer-1", "applicant-1", "연구개발", "기술팀", "일반직", "2026-09-01", 42000000, 3, "gc.kim", now, now);
  db.prepare(`INSERT INTO hr_retirement_settlements
    (request_id, created_at, updated_at) VALUES (?, ?, ?)`)
    .run("retirement-1", now, now);
  const retirement = db.prepare("SELECT status, total_tasks, completed_tasks FROM hr_retirement_requests WHERE id = ?").get("retirement-1");
  const offer = db.prepare("SELECT status, annual_salary, probation_months, employee_id, response_note, responded_by FROM hr_offer_requests WHERE id = ?").get("offer-1");
  const settlement = db.prepare("SELECT status, net_settlement, access_revoked FROM hr_retirement_settlements WHERE request_id = ?").get("retirement-1");
  assert.equal(retirement.status, "SUBMITTED");
  assert.equal(retirement.total_tasks, 10);
  assert.equal(retirement.completed_tasks, 0);
  assert.equal(offer.status, "SUBMITTED");
  assert.equal(offer.annual_salary, 42000000);
  assert.equal(offer.probation_months, 3);
  assert.equal(offer.employee_id, "");
  assert.equal(settlement.status, "DRAFT");
  assert.equal(settlement.net_settlement, 0);
  assert.equal(settlement.access_revoked, 0);
});

test("cash forecast settings persist and daily scenario snapshots remain unique", async () => {
  const db = await migratedDatabase();
  const now = Date.now();
  db.prepare(`INSERT INTO finance_cash_forecast_settings
    (id, minimum_cash_balance, include_fx, default_scenario, collection_probability, updated_by, created_at, updated_at)
    VALUES ('default', ?, 1, 'CONSERVATIVE', 70, 'gc.kim', ?, ?)`)
    .run(300000000, now, now);
  db.prepare(`INSERT INTO finance_cash_forecast_snapshots
    (id, as_of, scenario, opening_cash, projected_ending_cash, lowest_cash, minimum_cash_balance,
      low_week_count, missing_date_count, buckets_json, source_counts_json, created_at, updated_at)
    VALUES (?, '2026-08-14', 'CONSERVATIVE', ?, ?, ?, ?, 2, 3, '[]', '{}', ?, ?)`)
    .run("2026-08-14:CONSERVATIVE", 500000000, 250000000, 200000000, 300000000, now, now);
  assert.throws(() => db.prepare(`INSERT INTO finance_cash_forecast_snapshots
    (id, as_of, scenario, opening_cash, projected_ending_cash, lowest_cash, minimum_cash_balance,
      low_week_count, missing_date_count, buckets_json, source_counts_json, created_at, updated_at)
    VALUES (?, '2026-08-14', 'CONSERVATIVE', 1, 1, 1, 1, 0, 0, '[]', '{}', ?, ?)`)
    .run("duplicate", now, now), /UNIQUE constraint failed/);
  db.prepare(`INSERT INTO finance_cash_forecast_snapshots
    (id, as_of, scenario, opening_cash, projected_ending_cash, lowest_cash, minimum_cash_balance,
      low_week_count, missing_date_count, buckets_json, source_counts_json, created_at, updated_at)
    VALUES (?, '2026-08-14', 'CONSERVATIVE', ?, ?, ?, ?, 1, 1, '[]', '{}', ?, ?)
    ON CONFLICT(as_of, scenario) DO UPDATE SET projected_ending_cash = excluded.projected_ending_cash,
      lowest_cash = excluded.lowest_cash, low_week_count = excluded.low_week_count,
      missing_date_count = excluded.missing_date_count, updated_at = excluded.updated_at`)
    .run("replacement", 500000000, 275000000, 225000000, 300000000, now, now + 1);
  const settings = db.prepare("SELECT * FROM finance_cash_forecast_settings WHERE id = 'default'").get();
  const snapshot = db.prepare("SELECT * FROM finance_cash_forecast_snapshots WHERE as_of = '2026-08-14' AND scenario = 'CONSERVATIVE'").get();
  assert.equal(settings.minimum_cash_balance, 300000000);
  assert.equal(settings.include_fx, 1);
  assert.equal(settings.collection_probability, 70);
  assert.equal(snapshot.projected_ending_cash, 275000000);
  assert.equal(snapshot.low_week_count, 1);
  assert.equal(snapshot.missing_date_count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM finance_cash_forecast_snapshots").get().count, 1);
  db.exec("PRAGMA optimize");
  const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT * FROM finance_cash_forecast_snapshots
    WHERE as_of = ? AND scenario = ?`).all("2026-08-14", "CONSERVATIVE");
  assert.ok(plan.some((row) => String(row.detail).includes("idx_finance_cash_forecast_snapshot_asof_scenario")));
});

test("month-end close runs preserve a frozen snapshot and versioned reopen history", async () => {
  const db = await migratedDatabase();
  const now = Date.now();
  const snapshot = JSON.stringify({
    period: "2026-08",
    controls: [{ key: "BANK_RECONCILIATION", status: "PASS", count: 0 }],
    evidenceCount: 2,
  });
  const insert = db.prepare(`INSERT INTO finance_close_runs
    (period, period_end, status, control_pass_count, control_fail_count,
      manual_completed_count, manual_total_count, evidence_count, snapshot_json,
      submitted_by, submitted_at, created_at, updated_at)
    VALUES (?, ?, 'SUBMITTED', 5, 0, 3, 3, 2, ?, 'gc.kim', ?, ?, ?)`);
  insert.run("2026-08", "2026-08-31", snapshot, now, now, now);
  assert.throws(() => insert.run("2026-08", "2026-08-31", snapshot, now, now, now), /UNIQUE constraint failed/);

  db.prepare(`UPDATE finance_close_runs SET status = 'CLOSED', closed_by = ?, closed_at = ?, updated_at = ?
    WHERE period = ? AND status = 'SUBMITTED'`).run("gc.kim", now + 1, now + 1, "2026-08");
  const closed = db.prepare("SELECT * FROM finance_close_runs WHERE period = ?").get("2026-08");
  assert.equal(closed.status, "CLOSED");
  assert.equal(closed.snapshot_json, snapshot);
  assert.equal(closed.version, 1);

  db.prepare(`UPDATE finance_close_runs SET status = 'OPEN', reopened_by = ?, reopened_at = ?,
    reopened_reason = ?, version = version + 1, updated_at = ? WHERE period = ? AND status = 'CLOSED'`)
    .run("gc.kim", now + 2, "결산 수정분 반영", now + 2, "2026-08");
  const reopened = db.prepare("SELECT * FROM finance_close_runs WHERE period = ?").get("2026-08");
  assert.equal(reopened.status, "OPEN");
  assert.equal(reopened.version, 2);
  assert.equal(reopened.reopened_reason, "결산 수정분 반영");
  assert.equal(reopened.snapshot_json, snapshot);

  db.exec("PRAGMA optimize");
  const indexes = db.prepare("PRAGMA index_list(finance_close_runs)").all();
  assert.ok(indexes.some((row) => row.name === "idx_finance_close_run_status_period"));
});

test("budget plans preserve approved versions, source mappings and one variance action per line", async () => {
  const db = await migratedDatabase();
  const now = Date.now();
  const insertPlan = db.prepare(`INSERT INTO finance_budget_plans
    (id, fiscal_year, name, status, version, owner_employee_id, approved_by, approved_at, created_at, updated_at)
    VALUES (?, 2026, ?, ?, ?, 'gc.kim', ?, ?, ?, ?)`);
  insertPlan.run("budget-v1", "2026 경영예산", "APPROVED", 1, "gc.kim", now, now, now);
  assert.throws(() => insertPlan.run("budget-v1-duplicate", "중복", "DRAFT", 1, "", null, now, now), /UNIQUE constraint failed/);

  const insertLine = db.prepare(`INSERT INTO finance_budget_plan_lines
    (id, plan_id, month, department, account_code, account_name, direction, actual_source,
      amount, threshold_pct, notes, created_at, updated_at)
    VALUES (?, 'budget-v1', ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`);
  insertLine.run("budget-line-sales", 8, "전사", "", "매출", "REVENUE", "SALES_INVOICE", 6000000000, 10, now, now);
  insertLine.run("budget-line-expense", 8, "전사", "", "매입", "EXPENSE", "PURCHASE_INVOICE", 4500000000, 10, now, now);
  assert.throws(() => insertLine.run("budget-line-sales-duplicate", 8, "전사", "", "매출", "REVENUE", "SALES_INVOICE", 1, 10, now, now), /UNIQUE constraint failed/);

  const insertAction = db.prepare(`INSERT INTO finance_budget_variance_actions
    (id, plan_id, line_id, period, status, cause, action_plan, owner_employee_id, due_date,
      created_by, created_at, updated_at) VALUES (?, 'budget-v1', 'budget-line-sales', '2026-08',
      'ACTIONED', ?, ?, 'gc.kim', '2026-08-31', 'gc.kim', ?, ?)`);
  insertAction.run("variance-action-1", "납품 이연", "납품 및 세금계산서 발행 일정 확정", now, now);
  assert.throws(() => insertAction.run("variance-action-2", "중복", "중복", now, now), /UNIQUE constraint failed/);

  insertPlan.run("budget-v2", "2026 경영예산", "DRAFT", 2, "", null, now + 1, now + 1);
  db.prepare(`INSERT INTO finance_budget_plan_lines
    (id, plan_id, month, department, account_code, account_name, direction, actual_source,
      amount, threshold_pct, notes, created_at, updated_at)
    SELECT 'budget-v2-' || id, 'budget-v2', month, department, account_code, account_name,
      direction, actual_source, amount, threshold_pct, notes, ?, ? FROM finance_budget_plan_lines WHERE plan_id = 'budget-v1'`)
    .run(now + 1, now + 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM finance_budget_plan_lines WHERE plan_id = 'budget-v2'").get().count, 2);
  assert.equal(db.prepare("SELECT status FROM finance_budget_plans WHERE id = 'budget-v1'").get().status, "APPROVED");

  db.exec("PRAGMA optimize");
  const planIndexes = db.prepare("PRAGMA index_list(finance_budget_plans)").all();
  const actionIndexes = db.prepare("PRAGMA index_list(finance_budget_variance_actions)").all();
  assert.ok(planIndexes.some((row) => row.name === "idx_finance_budget_plan_year_version"));
  assert.ok(actionIndexes.some((row) => row.name === "idx_finance_budget_variance_line_unique"));
});

test("management reports freeze approved snapshots, preserve versions and track accountable actions", async () => {
  const db = await migratedDatabase();
  const now = Date.now();
  const frozen = JSON.stringify({ period: "2026-07", asOf: "2026-08-14", sections: { commerce: { sales: 7843458347 } }, quality: { warningCount: 2 } });
  const insertReport = db.prepare(`INSERT INTO finance_management_reports
    (id, period, version, status, as_of, snapshot_json, auto_analysis_json, highlights, risks, decisions,
      quality_acknowledged, revision_reason, created_by, submitted_at, approved_by, approved_at, created_at, updated_at)
    VALUES (?, '2026-07', ?, ?, '2026-08-14', ?, '{}', '성과', '위험', '의사결정', 1, ?, 'gc.kim', ?, ?, ?, ?, ?)`);
  insertReport.run("report-v1", 1, "APPROVED", frozen, "", now, "gc.kim", now, now, now);
  assert.throws(() => insertReport.run("report-v1-duplicate", 1, "DRAFT", frozen, "", null, "", null, now, now), /UNIQUE constraint failed/);

  db.prepare(`INSERT INTO finance_management_report_actions
    (id, report_id, source_section, title, owner_employee_id, due_date, status, memo, created_by, created_at, updated_at)
    VALUES ('action-v1', 'report-v1', 'CASH', '유동성 계획 확인', 'gc.kim', '2026-08-20', 'OPEN', '', 'gc.kim', ?, ?)`)
    .run(now, now);
  insertReport.run("report-v2", 2, "SUBMITTED", frozen, "원천 정정", now + 1, "", null, now + 1, now + 1);
  db.prepare("UPDATE finance_management_reports SET status = 'SUPERSEDED', updated_at = ? WHERE id = 'report-v1' AND status = 'APPROVED'").run(now + 2);
  db.prepare("UPDATE finance_management_reports SET status = 'APPROVED', approved_by = 'gc.kim', approved_at = ?, updated_at = ? WHERE id = 'report-v2' AND status = 'SUBMITTED'").run(now + 2, now + 2);
  db.prepare("UPDATE finance_management_report_actions SET status = 'DONE', completed_at = ?, updated_at = ? WHERE id = 'action-v1'").run(now + 3, now + 3);

  const v1 = db.prepare("SELECT status, snapshot_json FROM finance_management_reports WHERE id = 'report-v1'").get();
  const v2 = db.prepare("SELECT status, snapshot_json, revision_reason FROM finance_management_reports WHERE id = 'report-v2'").get();
  const action = db.prepare("SELECT status, completed_at FROM finance_management_report_actions WHERE id = 'action-v1'").get();
  assert.equal(v1.status, "SUPERSEDED");
  assert.equal(v1.snapshot_json, frozen);
  assert.equal(v2.status, "APPROVED");
  assert.equal(v2.snapshot_json, frozen);
  assert.equal(v2.revision_reason, "원천 정정");
  assert.equal(action.status, "DONE");
  assert.equal(action.completed_at, now + 3);
  const reportIndexes = db.prepare("PRAGMA index_list(finance_management_reports)").all();
  const actionIndexes = db.prepare("PRAGMA index_list(finance_management_report_actions)").all();
  assert.ok(reportIndexes.some((row) => row.name === "idx_finance_management_report_period_version"));
  assert.ok(actionIndexes.some((row) => row.name === "idx_finance_management_report_action_status_due"));
});

test("finance master data enforces unique codes, aliases and approval-tracked changes", async () => {
  const db = await migratedDatabase();
  const now = Date.now();
  const insertAccount = db.prepare(`INSERT INTO finance_master_accounts
    (id, code, name, category, normal_balance, status, source, created_by, created_at, updated_at)
    VALUES (?, ?, ?, 'ASSET', 'DEBIT', 'ACTIVE', 'ECOUNT_2025', 'gc.kim', ?, ?)`);
  insertAccount.run("account-1039", "1039", "보통예금", now, now);
  assert.throws(() => insertAccount.run("account-duplicate", "1039", "중복", now, now), /UNIQUE constraint failed/);

  db.prepare(`INSERT INTO finance_master_partners
    (id, canonical_name, normalized_key, partner_type, status, source, created_by, created_at, updated_at)
    VALUES ('partner-1', '주식회사 테스트', '주식회사테스트', 'BOTH', 'ACTIVE', 'ERP_LEGACY', 'gc.kim', ?, ?)`)
    .run(now, now);
  const insertAlias = db.prepare(`INSERT INTO finance_master_partner_aliases
    (id, mapping_key, source_system, source_entity_id, source_name, partner_id, created_at, updated_at)
    VALUES (?, 'SALES:account-1', 'SALES', 'account-1', '주식회사 테스트', 'partner-1', ?, ?)`);
  insertAlias.run("alias-1", now, now);
  assert.throws(() => insertAlias.run("alias-2", now, now), /UNIQUE constraint failed/);

  db.prepare(`INSERT INTO finance_master_change_requests
    (id, target_type, target_id, change_type, before_json, after_json, reason, status, created_by, created_at, updated_at)
    VALUES ('change-1', 'ACCOUNT', 'account-1039', 'DEACTIVATE', '{}', '{"status":"INACTIVE"}',
      '미사용 계정 비활성화', 'SUBMITTED', 'gc.kim', ?, ?)`)
    .run(now, now);
  const change = db.prepare("SELECT status, reason FROM finance_master_change_requests WHERE id = 'change-1'").get();
  assert.equal(change.status, "SUBMITTED");
  assert.equal(change.reason, "미사용 계정 비활성화");
  assert.ok(db.prepare("PRAGMA index_list(finance_master_accounts)").all().some((row) => row.name === "idx_finance_master_account_code"));
});

test("receivable collection cases stay unique per invoice while contact notes remain append-only", async () => {
  const db = await migratedDatabase();
  const now = Date.now();
  const insertCase = db.prepare(`INSERT INTO finance_receivable_cases
    (invoice_id, collection_status, owner_employee_id, promised_date, promised_amount,
      next_action, next_action_date, updated_by, created_at, updated_at)
    VALUES (?, 'PROMISED', 'gc.kim', '2026-08-20', 5000000, '입금증 확인', '2026-08-21', 'gc.kim', ?, ?)`);
  insertCase.run("invoice-1", now, now);
  assert.throws(() => insertCase.run("invoice-1", now, now), /UNIQUE constraint failed/);
  db.prepare(`UPDATE finance_receivable_cases SET collection_status = 'IN_PROGRESS',
    next_action = '담당자 재통화', updated_at = ? WHERE invoice_id = 'invoice-1'`).run(now + 1);
  const insertNote = db.prepare(`INSERT INTO finance_receivable_notes
    (id, invoice_id, note_type, content, created_by, created_at) VALUES (?, 'invoice-1', ?, ?, 'gc.kim', ?)`);
  insertNote.run("note-1", "CALL", "입금 예정일 확인", now);
  insertNote.run("note-2", "EMAIL", "입금증 요청", now + 1);
  const collectionCase = db.prepare("SELECT * FROM finance_receivable_cases WHERE invoice_id = 'invoice-1'").get();
  assert.equal(collectionCase.collection_status, "IN_PROGRESS");
  assert.equal(collectionCase.next_action, "담당자 재통화");
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM finance_receivable_notes WHERE invoice_id = 'invoice-1'").get().count, 2);
  assert.ok(db.prepare("PRAGMA index_list(finance_receivable_cases)").all().some((row) => row.name === "idx_finance_receivable_case_status_promise"));
});
