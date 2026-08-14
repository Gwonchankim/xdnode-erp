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
