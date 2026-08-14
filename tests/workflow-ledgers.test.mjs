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
  const insertPayment = db.prepare(`INSERT INTO finance_payment_ledger
    (id, request_id, payment_date, amount, payment_method, paid_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'BANK_TRANSFER', 'gc.kim', ?, ?)`);
  insertPayment.run("payment-1", "expense-1", "2026-08-14", 10000, now, now);
  assert.throws(() => insertPayment.run("payment-2", "expense-1", "2026-08-14", 10000, now, now), /UNIQUE constraint failed/);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM finance_payment_ledger WHERE request_id = ?").get("expense-1").count, 1);
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
  const retirement = db.prepare("SELECT status, total_tasks, completed_tasks FROM hr_retirement_requests WHERE id = ?").get("retirement-1");
  const offer = db.prepare("SELECT status, annual_salary, probation_months FROM hr_offer_requests WHERE id = ?").get("offer-1");
  assert.equal(retirement.status, "SUBMITTED");
  assert.equal(retirement.total_tasks, 10);
  assert.equal(retirement.completed_tasks, 0);
  assert.equal(offer.status, "SUBMITTED");
  assert.equal(offer.annual_salary, 42000000);
  assert.equal(offer.probation_months, 3);
});
