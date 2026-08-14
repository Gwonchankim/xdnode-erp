import { env } from "cloudflare:workers";
import { createApprovalRequest } from "../../../approval-engine";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";
import { financeCurrentData } from "../../../finance-current-data";

type FinanceBindings = { DB: D1Database };
const db = (env as unknown as FinanceBindings).DB;

type ForecastRow = {
  id: string; expected_date: string; direction: string; category: string; counterparty: string;
  amount: number; probability: number; scenario: string; source_type: string; source_id: string;
  memo: string; status: string; created_at: number; updated_at: number;
};
type CloseRow = {
  id: string; period: string; category: string; title: string; owner_employee_id: string;
  status: string; evidence_document_id: string; completed_at: number | null; approved_by: string;
  approved_at: number | null; reopened_reason: string; created_at: number; updated_at: number;
};
type BudgetRow = {
  id: string; fiscal_year: number; month: number; department: string; account_code: string;
  account_name: string; amount: number; status: string; version: number; approved_by: string;
  created_at: number; updated_at: number;
};
type ReconciliationRow = {
  id: string; bank_transaction_id: string; journal_line_id: string; transaction_date: string;
  amount: number; description: string; account_code: string; match_score: number; status: string;
  resolution_memo: string; resolved_by: string; resolved_at: number | null; created_at: number; updated_at: number;
};
type ExpenseRow = {
  id: string; request_kind: string; title: string; vendor: string; amount: number; requested_date: string;
  due_date: string; account_code: string; account_name: string; payment_method: string; memo: string;
  source_type: string; source_id: string; status: string; requester_employee_id: string; approved_by: string; approved_at: number | null;
  paid_by: string; paid_at: number | null; journal_status: string; evidence_required: number;
  evidence_count: number; created_at: number; updated_at: number;
};
type PaymentRow = {
  id: string; request_id: string; payment_date: string; amount: number; payment_method: string;
  bank_reference: string; paid_by: string; status: string; created_at: number; updated_at: number;
};
type JournalRow = {
  id: string; payment_request_id: string; voucher_date: string; description: string;
  debit_account_code: string; debit_account_name: string; credit_account_code: string;
  credit_account_name: string; amount: number; status: string; prepared_by: string;
  posted_by: string; posted_at: number | null; created_at: number; updated_at: number;
};

async function ensureSchema() {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_reconciliations (
      id TEXT PRIMARY KEY NOT NULL, bank_transaction_id TEXT NOT NULL, journal_line_id TEXT NOT NULL DEFAULT '',
      transaction_date TEXT NOT NULL, amount INTEGER NOT NULL, description TEXT NOT NULL DEFAULT '',
      account_code TEXT NOT NULL DEFAULT '', match_score INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'UNMATCHED', resolution_memo TEXT NOT NULL DEFAULT '',
      resolved_by TEXT NOT NULL DEFAULT '', resolved_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_cash_forecast_items (
      id TEXT PRIMARY KEY NOT NULL, expected_date TEXT NOT NULL, direction TEXT NOT NULL, category TEXT NOT NULL,
      counterparty TEXT NOT NULL DEFAULT '', amount INTEGER NOT NULL, probability INTEGER NOT NULL DEFAULT 100,
      scenario TEXT NOT NULL DEFAULT 'BASE', source_type TEXT NOT NULL DEFAULT 'MANUAL', source_id TEXT NOT NULL DEFAULT '',
      memo TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'EXPECTED', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_close_tasks (
      id TEXT PRIMARY KEY NOT NULL, period TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL,
      owner_employee_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'OPEN',
      evidence_document_id TEXT NOT NULL DEFAULT '', completed_at INTEGER, approved_by TEXT NOT NULL DEFAULT '',
      approved_at INTEGER, reopened_reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_budgets (
      id TEXT PRIMARY KEY NOT NULL, fiscal_year INTEGER NOT NULL, month INTEGER NOT NULL, department TEXT NOT NULL,
      account_code TEXT NOT NULL, account_name TEXT NOT NULL, amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT', version INTEGER NOT NULL DEFAULT 1,
      approved_by TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_expense_requests (
      id TEXT PRIMARY KEY NOT NULL, request_kind TEXT NOT NULL DEFAULT 'EXPENSE', title TEXT NOT NULL,
      vendor TEXT NOT NULL DEFAULT '', amount INTEGER NOT NULL, requested_date TEXT NOT NULL,
      due_date TEXT NOT NULL DEFAULT '', account_code TEXT NOT NULL DEFAULT '', account_name TEXT NOT NULL DEFAULT '',
      payment_method TEXT NOT NULL DEFAULT 'BANK_TRANSFER', memo TEXT NOT NULL DEFAULT '',
      source_type TEXT NOT NULL DEFAULT 'MANUAL', source_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'DRAFT',
      requester_employee_id TEXT NOT NULL, approved_by TEXT NOT NULL DEFAULT '', approved_at INTEGER,
      paid_by TEXT NOT NULL DEFAULT '', paid_at INTEGER, journal_status TEXT NOT NULL DEFAULT 'UNPOSTED',
      evidence_required INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_payment_ledger (
      id TEXT PRIMARY KEY NOT NULL, request_id TEXT NOT NULL UNIQUE, payment_date TEXT NOT NULL, amount INTEGER NOT NULL,
      payment_method TEXT NOT NULL, bank_reference TEXT NOT NULL DEFAULT '', paid_by TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PAID', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_journal_entries (
      id TEXT PRIMARY KEY NOT NULL, payment_request_id TEXT NOT NULL UNIQUE, voucher_date TEXT NOT NULL,
      description TEXT NOT NULL, debit_account_code TEXT NOT NULL DEFAULT '', debit_account_name TEXT NOT NULL,
      credit_account_code TEXT NOT NULL DEFAULT '', credit_account_name TEXT NOT NULL, amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT', prepared_by TEXT NOT NULL, posted_by TEXT NOT NULL DEFAULT '',
      posted_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS erp_documents (
      id TEXT PRIMARY KEY NOT NULL, module TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      category TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, file_name TEXT NOT NULL,
      content_type TEXT NOT NULL, storage_key TEXT NOT NULL, uploaded_by TEXT NOT NULL,
      created_at INTEGER NOT NULL, deleted_at INTEGER
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_reconciliation_status_date ON finance_reconciliations(status, transaction_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_cash_forecast_scenario_date ON finance_cash_forecast_items(scenario, expected_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_close_period_status ON finance_close_tasks(period, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_budgets_year_month_department ON finance_budgets(fiscal_year, month, department)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_expense_status_due ON finance_expense_requests(status, due_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_expense_requester_created ON finance_expense_requests(requester_employee_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_payment_date ON finance_payment_ledger(payment_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_journal_status_date ON finance_journal_entries(status, voucher_date)"),
  ]);
  const expenseColumns = await db.prepare("PRAGMA table_info(finance_expense_requests)").all<{ name: string }>();
  const existing = new Set(expenseColumns.results.map((column) => column.name));
  for (const [name, definition] of [
    ["source_type", "TEXT NOT NULL DEFAULT 'MANUAL'"], ["source_id", "TEXT NOT NULL DEFAULT ''"],
  ].filter(([name]) => !existing.has(name))) await db.prepare(`ALTER TABLE finance_expense_requests ADD COLUMN ${name} ${definition}`).run();
}

const toForecast = (row: ForecastRow) => ({
  id: row.id, expectedDate: row.expected_date, direction: row.direction, category: row.category,
  counterparty: row.counterparty, amount: row.amount, probability: row.probability, scenario: row.scenario,
  sourceType: row.source_type, sourceId: row.source_id, memo: row.memo, status: row.status,
});
const toCloseTask = (row: CloseRow) => ({
  id: row.id, period: row.period, category: row.category, title: row.title,
  ownerEmployeeId: row.owner_employee_id, status: row.status, evidenceDocumentId: row.evidence_document_id,
  completedAt: row.completed_at, approvedBy: row.approved_by, approvedAt: row.approved_at,
  reopenedReason: row.reopened_reason,
});
const toBudget = (row: BudgetRow) => ({
  id: row.id, fiscalYear: row.fiscal_year, month: row.month, department: row.department,
  accountCode: row.account_code, accountName: row.account_name, amount: row.amount,
  status: row.status, version: row.version, approvedBy: row.approved_by,
});
const toReconciliation = (row: ReconciliationRow) => ({
  id: row.id, bankTransactionId: row.bank_transaction_id, journalLineId: row.journal_line_id,
  transactionDate: row.transaction_date, amount: row.amount, description: row.description,
  accountCode: row.account_code, matchScore: row.match_score, status: row.status,
  resolutionMemo: row.resolution_memo, resolvedBy: row.resolved_by, resolvedAt: row.resolved_at,
});
const toExpense = (row: ExpenseRow) => ({
  id: row.id, requestKind: row.request_kind, title: row.title, vendor: row.vendor, amount: row.amount,
  requestedDate: row.requested_date, dueDate: row.due_date, accountCode: row.account_code,
  accountName: row.account_name, paymentMethod: row.payment_method, memo: row.memo,
  sourceType: row.source_type, sourceId: row.source_id, status: row.status,
  requesterEmployeeId: row.requester_employee_id, approvedBy: row.approved_by, approvedAt: row.approved_at,
  paidBy: row.paid_by, paidAt: row.paid_at, journalStatus: row.journal_status,
  evidenceRequired: Boolean(row.evidence_required), evidenceCount: Number(row.evidence_count ?? 0),
});
const toPayment = (row: PaymentRow) => ({
  id: row.id, requestId: row.request_id, paymentDate: row.payment_date, amount: row.amount,
  paymentMethod: row.payment_method, bankReference: row.bank_reference, paidBy: row.paid_by, status: row.status,
});
const toJournal = (row: JournalRow) => ({
  id: row.id, paymentRequestId: row.payment_request_id, voucherDate: row.voucher_date,
  description: row.description, debitAccountCode: row.debit_account_code,
  debitAccountName: row.debit_account_name, creditAccountCode: row.credit_account_code,
  creditAccountName: row.credit_account_name, amount: row.amount, status: row.status,
  preparedBy: row.prepared_by, postedBy: row.posted_by, postedAt: row.posted_at,
});

async function seedCloseTasks() {
  const period = financeCurrentData.asOf.slice(0, 7);
  const existing = await db.prepare("SELECT COUNT(*) AS count FROM finance_close_tasks WHERE period = ?")
    .bind(period).first<{ count: number }>();
  if ((existing?.count ?? 0) > 0) return;
  const now = Date.now();
  const templates = [
    ["BANK", "은행·외화예금 잔액 대사"],
    ["JOURNAL", "분개장 차변·대변 일치 확인"],
    ["AR_AP", "외상매출금·미수금·매입채무 검토"],
    ["PAYROLL", "급여 및 원천세 분개 확인"],
    ["STATEMENT", "월 손익·재무상태표 검토"],
  ];
  await db.batch(templates.map(([category, title]) => db.prepare(`INSERT INTO finance_close_tasks
    (id, period, category, title, owner_employee_id, status, evidence_document_id, completed_at,
      approved_by, approved_at, reopened_reason, created_at, updated_at)
    VALUES (?, ?, ?, ?, '', 'OPEN', '', NULL, '', NULL, '', ?, ?)`)
    .bind(`${period}:${category}`, period, category, title, now, now)));
}

export async function GET() {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "finance", "read");
  if (authorization.response) return authorization.response;
  await seedCloseTasks();

  const [forecast, closeTasks, budgets, reconciliations, expenses, payments, journals] = await Promise.all([
    db.prepare("SELECT * FROM finance_cash_forecast_items WHERE status <> 'DELETED' ORDER BY expected_date, created_at").all<ForecastRow>(),
    db.prepare("SELECT * FROM finance_close_tasks ORDER BY period DESC, created_at").all<CloseRow>(),
    db.prepare("SELECT * FROM finance_budgets ORDER BY fiscal_year DESC, month, department, account_code").all<BudgetRow>(),
    db.prepare("SELECT * FROM finance_reconciliations ORDER BY transaction_date DESC, created_at DESC LIMIT 500").all<ReconciliationRow>(),
    db.prepare(`SELECT expense.*, COUNT(document.id) AS evidence_count FROM finance_expense_requests expense
      LEFT JOIN erp_documents document ON document.module = 'finance' AND document.entity_type = 'financeExpense'
        AND document.entity_id = expense.id AND document.deleted_at IS NULL
      GROUP BY expense.id ORDER BY expense.created_at DESC`).all<ExpenseRow>(),
    db.prepare("SELECT * FROM finance_payment_ledger ORDER BY payment_date DESC, created_at DESC").all<PaymentRow>(),
    db.prepare("SELECT * FROM finance_journal_entries ORDER BY voucher_date DESC, created_at DESC").all<JournalRow>(),
  ]);

  return Response.json({
    asOf: financeCurrentData.asOf,
    sourceStatus: {
      clobeSnapshot: "LIVE",
      bankTransactionLines: reconciliations.results.length ? "IMPORTED" : "NOT_CONNECTED",
      journalMatching: reconciliations.results.length ? "IMPORTED" : "NOT_CONNECTED",
      budgets: budgets.results.length ? "MANUAL" : "NOT_CONNECTED",
      forecast: forecast.results.length ? "MANUAL" : "NOT_CONNECTED",
    },
    forecast: forecast.results.map(toForecast),
    closeTasks: closeTasks.results.map(toCloseTask),
    budgets: budgets.results.map(toBudget),
    reconciliations: reconciliations.results.map(toReconciliation),
    expenses: expenses.results.map(toExpense),
    payments: payments.results.map(toPayment),
    journals: journals.results.map(toJournal),
  });
}

export async function POST(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "finance", "write");
  if (authorization.response) return authorization.response;
  const body = await request.json() as Record<string, unknown>;
  const resource = String(body.resource ?? "");
  const now = Date.now();
  const id = crypto.randomUUID();

  if (resource === "forecast") {
    const expectedDate = String(body.expectedDate ?? "").trim();
    const direction = String(body.direction ?? "").trim();
    const category = String(body.category ?? "").trim();
    const amount = Number(body.amount);
    const probability = Math.min(100, Math.max(0, Number(body.probability ?? 100)));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedDate) || !["INFLOW", "OUTFLOW"].includes(direction) || !category || !Number.isFinite(amount) || amount <= 0) {
      return Response.json({ error: "예정일, 입출금 구분, 분류와 0원 초과 금액이 필요합니다." }, { status: 400 });
    }
    await db.prepare(`INSERT INTO finance_cash_forecast_items
      (id, expected_date, direction, category, counterparty, amount, probability, scenario, source_type,
        source_id, memo, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL', '', ?, 'EXPECTED', ?, ?)`)
      .bind(id, expectedDate, direction, category, String(body.counterparty ?? "").trim(), Math.round(amount), probability,
        String(body.scenario ?? "BASE"), String(body.memo ?? "").trim(), now, now).run();
    const row = await db.prepare("SELECT * FROM finance_cash_forecast_items WHERE id = ?").bind(id).first<ForecastRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "FORECAST_CREATED", entityType: "cashForecast", entityId: id, after: row ? toForecast(row) : body });
    return Response.json({ item: row ? toForecast(row) : null }, { status: 201 });
  }

  if (resource === "budget") {
    const fiscalYear = Number(body.fiscalYear);
    const month = Number(body.month);
    const department = String(body.department ?? "").trim();
    const accountName = String(body.accountName ?? "").trim();
    const amount = Number(body.amount);
    if (!Number.isInteger(fiscalYear) || fiscalYear < 2024 || !Number.isInteger(month) || month < 1 || month > 12 || !department || !accountName || !Number.isFinite(amount) || amount < 0) {
      return Response.json({ error: "연도·월·부서·계정명·0원 이상의 예산액을 확인해 주세요." }, { status: 400 });
    }
    await db.prepare(`INSERT INTO finance_budgets
      (id, fiscal_year, month, department, account_code, account_name, amount, status, version, approved_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'DRAFT', 1, '', ?, ?)`)
      .bind(id, fiscalYear, month, department, String(body.accountCode ?? "").trim(), accountName, Math.round(amount), now, now).run();
    const row = await db.prepare("SELECT * FROM finance_budgets WHERE id = ?").bind(id).first<BudgetRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "BUDGET_CREATED", entityType: "budget", entityId: id, after: row ? toBudget(row) : body });
    return Response.json({ item: row ? toBudget(row) : null }, { status: 201 });
  }

  if (resource === "expense") {
    const requestKind = String(body.requestKind ?? "EXPENSE").trim();
    const title = String(body.title ?? "").trim();
    const vendor = String(body.vendor ?? "").trim();
    const amount = Number(body.amount);
    const requestedDate = String(body.requestedDate ?? "").trim();
    const dueDate = String(body.dueDate ?? "").trim();
    const accountName = String(body.accountName ?? "").trim();
    const paymentMethod = String(body.paymentMethod ?? "BANK_TRANSFER").trim();
    if (!["EXPENSE", "PAYMENT"].includes(requestKind) || !title || !Number.isFinite(amount) || amount <= 0
      || !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate) || (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate))
      || !["BANK_TRANSFER", "CORPORATE_CARD", "CASH", "AUTO_DEBIT"].includes(paymentMethod)) {
      return Response.json({ error: "구분·제목·요청일·0원 초과 금액과 지급수단을 확인해 주세요." }, { status: 400 });
    }
    await db.prepare(`INSERT INTO finance_expense_requests
      (id, request_kind, title, vendor, amount, requested_date, due_date, account_code, account_name,
        payment_method, memo, status, requester_employee_id, approved_by, approved_at, paid_by, paid_at,
        journal_status, evidence_required, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, '', NULL, '', NULL, 'UNPOSTED', 1, ?, ?)`)
      .bind(id, requestKind, title, vendor, Math.round(amount), requestedDate, dueDate,
        String(body.accountCode ?? "").trim(), accountName, paymentMethod, String(body.memo ?? "").trim(),
        authorization.principal.employeeId, now, now).run();
    const row = await db.prepare(`SELECT expense.*, 0 AS evidence_count FROM finance_expense_requests expense WHERE id = ?`)
      .bind(id).first<ExpenseRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "EXPENSE_DRAFT_CREATED", entityType: "financeExpense", entityId: id, after: row ? toExpense(row) : body });
    return Response.json({ item: row ? toExpense(row) : null }, { status: 201 });
  }

  return Response.json({ error: "지원하지 않는 재무 운영 항목입니다." }, { status: 400 });
}

export async function PUT(request: Request) {
  await ensureSchema();
  const body = await request.json() as Record<string, unknown>;
  const resource = String(body.resource ?? "");
  const id = String(body.id ?? "").trim();
  if (!id) return Response.json({ error: "수정할 항목 ID가 필요합니다." }, { status: 400 });
  const authorization = await authorizeErpRequest(db, "finance", "write");
  if (authorization.response) return authorization.response;
  const now = Date.now();

  if (resource === "close") {
    const before = await db.prepare("SELECT * FROM finance_close_tasks WHERE id = ?").bind(id).first<CloseRow>();
    if (!before) return Response.json({ error: "마감 업무를 찾을 수 없습니다." }, { status: 404 });
    const status = String(body.status ?? before.status);
    if (!["OPEN", "IN_PROGRESS", "COMPLETED", "APPROVED"].includes(status)) return Response.json({ error: "올바르지 않은 상태입니다." }, { status: 400 });
    if (status === "APPROVED" && before.status !== "APPROVED") {
      if (before.status !== "COMPLETED") return Response.json({ error: "완료 처리된 마감 업무만 승인 결재를 요청할 수 있습니다." }, { status: 409 });
      const existing = await db.prepare(`SELECT id, status FROM erp_approval_requests
        WHERE target_entity_type = 'FINANCE_CLOSE' AND target_entity_id = ? ORDER BY created_at DESC LIMIT 1`)
        .bind(id).first<{ id: string; status: string }>();
      if (existing && ["SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED"].includes(existing.status)) return Response.json({ item: toCloseTask(before), approvalSubmitted: true, approvalId: existing.id }, { status: 202 });
      const approval = await createApprovalRequest(db, authorization.principal, {
        module: "finance", requestType: "CLOSE", title: `${before.period} ${before.title} 승인`,
        description: `${before.category} 마감 업무 완료 검토`, targetEntityType: "FINANCE_CLOSE", targetEntityId: id,
        dueDate: before.period ? `${before.period}-28` : "", metadata: { period: before.period, category: before.category },
      });
      await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "CLOSE_APPROVAL_SUBMITTED", entityType: "financeCloseTask", entityId: id, before: toCloseTask(before), after: approval });
      return Response.json({ item: toCloseTask(before), approvalSubmitted: true, approvalId: approval.id }, { status: 202 });
    }
    const completedAt = ["COMPLETED", "APPROVED"].includes(status) ? (before.completed_at ?? now) : null;
    const approvedBy = status === "APPROVED" ? authorization.principal.employeeId : "";
    const approvedAt = status === "APPROVED" ? now : null;
    await db.prepare(`UPDATE finance_close_tasks SET status = ?, owner_employee_id = ?, completed_at = ?,
      approved_by = ?, approved_at = ?, reopened_reason = ?, updated_at = ? WHERE id = ?`)
      .bind(status, String(body.ownerEmployeeId ?? before.owner_employee_id), completedAt, approvedBy, approvedAt,
        String(body.reopenedReason ?? "").trim(), now, id).run();
    const after = await db.prepare("SELECT * FROM finance_close_tasks WHERE id = ?").bind(id).first<CloseRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "CLOSE_TASK_UPDATED", entityType: "financeCloseTask", entityId: id, before: toCloseTask(before), after: after ? toCloseTask(after) : null });
    return Response.json({ item: after ? toCloseTask(after) : null });
  }

  if (resource === "forecast") {
    const before = await db.prepare("SELECT * FROM finance_cash_forecast_items WHERE id = ?").bind(id).first<ForecastRow>();
    if (!before) return Response.json({ error: "자금예측 항목을 찾을 수 없습니다." }, { status: 404 });
    const status = String(body.status ?? before.status);
    if (!["EXPECTED", "CONFIRMED", "COMPLETED", "CANCELLED"].includes(status)) return Response.json({ error: "올바르지 않은 상태입니다." }, { status: 400 });
    await db.prepare("UPDATE finance_cash_forecast_items SET status = ?, updated_at = ? WHERE id = ?").bind(status, now, id).run();
    const after = await db.prepare("SELECT * FROM finance_cash_forecast_items WHERE id = ?").bind(id).first<ForecastRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "FORECAST_STATUS_UPDATED", entityType: "cashForecast", entityId: id, before: toForecast(before), after: after ? toForecast(after) : null });
    return Response.json({ item: after ? toForecast(after) : null });
  }

  if (resource === "budget") {
    const before = await db.prepare("SELECT * FROM finance_budgets WHERE id = ?").bind(id).first<BudgetRow>();
    if (!before) return Response.json({ error: "예산 항목을 찾을 수 없습니다." }, { status: 404 });
    const status = String(body.status ?? before.status);
    if (!["DRAFT", "SUBMITTED", "APPROVED"].includes(status)) return Response.json({ error: "올바르지 않은 상태입니다." }, { status: 400 });
    if (status === "APPROVED" && before.status !== "APPROVED") {
      if (before.status !== "SUBMITTED") return Response.json({ error: "검토 요청 상태의 예산만 승인 결재를 요청할 수 있습니다." }, { status: 409 });
      const existing = await db.prepare(`SELECT id, status FROM erp_approval_requests
        WHERE target_entity_type = 'FINANCE_BUDGET' AND target_entity_id = ? ORDER BY created_at DESC LIMIT 1`)
        .bind(id).first<{ id: string; status: string }>();
      if (existing && ["SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED"].includes(existing.status)) return Response.json({ item: toBudget(before), approvalSubmitted: true, approvalId: existing.id }, { status: 202 });
      const approval = await createApprovalRequest(db, authorization.principal, {
        module: "finance", requestType: "BUDGET", title: `${before.fiscal_year}년 ${before.month}월 ${before.account_name} 예산 승인`,
        description: `${before.department} · ${before.amount.toLocaleString("ko-KR")}원`, targetEntityType: "FINANCE_BUDGET",
        targetEntityId: id, amount: before.amount, metadata: { fiscalYear: before.fiscal_year, month: before.month, department: before.department, accountCode: before.account_code },
      });
      await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "BUDGET_APPROVAL_SUBMITTED", entityType: "budget", entityId: id, before: toBudget(before), after: approval });
      return Response.json({ item: toBudget(before), approvalSubmitted: true, approvalId: approval.id }, { status: 202 });
    }
    await db.prepare("UPDATE finance_budgets SET status = ?, approved_by = ?, updated_at = ? WHERE id = ?")
      .bind(status, status === "APPROVED" ? authorization.principal.employeeId : "", now, id).run();
    const after = await db.prepare("SELECT * FROM finance_budgets WHERE id = ?").bind(id).first<BudgetRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "BUDGET_STATUS_UPDATED", entityType: "budget", entityId: id, before: toBudget(before), after: after ? toBudget(after) : null });
    return Response.json({ item: after ? toBudget(after) : null });
  }

  if (resource === "expense") {
    const before = await db.prepare(`SELECT expense.*, COUNT(document.id) AS evidence_count FROM finance_expense_requests expense
      LEFT JOIN erp_documents document ON document.module = 'finance' AND document.entity_type = 'financeExpense'
        AND document.entity_id = expense.id AND document.deleted_at IS NULL
      WHERE expense.id = ? GROUP BY expense.id`).bind(id).first<ExpenseRow>();
    if (!before) return Response.json({ error: "지출·지급 요청을 찾을 수 없습니다." }, { status: 404 });
    const action = String(body.action ?? "SUBMIT").toUpperCase();
    if (action === "SUBMIT") {
      if (before.status !== "DRAFT") return Response.json({ error: "작성 중인 요청만 결재를 제출할 수 있습니다." }, { status: 409 });
      if (before.evidence_required && before.evidence_count < 1) return Response.json({ error: "결재 제출 전 영수증·세금계산서 등 증빙을 1개 이상 첨부해 주세요." }, { status: 409 });
      await db.prepare("UPDATE finance_expense_requests SET status = 'SUBMITTED', updated_at = ? WHERE id = ? AND status = 'DRAFT'")
        .bind(now, id).run();
      try {
        const approval = await createApprovalRequest(db, authorization.principal, {
          module: "finance", requestType: before.request_kind === "PAYMENT" ? "PAYMENT" : "EXPENSE",
          title: `${before.title} ${before.request_kind === "PAYMENT" ? "지급" : "지출"} 승인`,
          description: `${before.vendor || "거래처 미입력"} · ${before.amount.toLocaleString("ko-KR")}원${before.account_name ? ` · ${before.account_name}` : ""}`,
          targetEntityType: "FINANCE_EXPENSE", targetEntityId: id, amount: before.amount,
          dueDate: before.due_date, priority: before.due_date && before.due_date <= new Date(now + 2 * 86400000).toISOString().slice(0, 10) ? "HIGH" : "NORMAL",
          metadata: { requestKind: before.request_kind, vendor: before.vendor, accountCode: before.account_code, evidenceCount: before.evidence_count },
        });
        await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "EXPENSE_APPROVAL_SUBMITTED", entityType: "financeExpense", entityId: id, before: toExpense(before), after: approval });
        return Response.json({ item: { ...toExpense(before), status: "SUBMITTED" }, approvalSubmitted: true, approvalId: approval.id }, { status: 202 });
      } catch (error) {
        await db.prepare("UPDATE finance_expense_requests SET status = 'DRAFT', updated_at = ? WHERE id = ? AND status = 'SUBMITTED'").bind(now, id).run();
        return Response.json({ error: error instanceof Error ? error.message : "지출·지급 결재선을 만들지 못했습니다." }, { status: 409 });
      }
    }
    if (action === "PAY") {
      const approvalAuthorization = await authorizeErpRequest(db, "finance", "approve");
      if (approvalAuthorization.response) return approvalAuthorization.response;
      if (before.status !== "APPROVED") return Response.json({ error: "승인 완료된 요청만 지급 처리할 수 있습니다." }, { status: 409 });
      const paymentDate = String(body.paymentDate ?? "").trim();
      const paymentMethod = String(body.paymentMethod ?? before.payment_method).trim();
      const bankReference = String(body.bankReference ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate) || !["BANK_TRANSFER", "CORPORATE_CARD", "CASH", "AUTO_DEBIT"].includes(paymentMethod)) {
        return Response.json({ error: "지급일과 지급수단을 확인해 주세요." }, { status: 400 });
      }
      const paymentId = crypto.randomUUID();
      await db.batch([
        db.prepare(`INSERT INTO finance_payment_ledger
          (id, request_id, payment_date, amount, payment_method, bank_reference, paid_by, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'PAID', ?, ?)`)
          .bind(paymentId, id, paymentDate, before.amount, paymentMethod, bankReference, approvalAuthorization.principal.employeeId, now, now),
        db.prepare(`UPDATE finance_expense_requests SET status = 'PAID', payment_method = ?, paid_by = ?, paid_at = ?,
          journal_status = 'READY', updated_at = ? WHERE id = ? AND status = 'APPROVED'`)
          .bind(paymentMethod, approvalAuthorization.principal.employeeId, now, now, id),
        db.prepare(`UPDATE finance_purchase_invoices SET status = 'PAID', updated_at = ?
          WHERE id = ? AND status = 'PAYMENT_READY' AND ? = 'PURCHASE_INVOICE'
            AND EXISTS (SELECT 1 FROM finance_expense_requests WHERE id = ? AND status = 'PAID' AND updated_at = ?)`)
          .bind(now, before.source_id, before.source_type, id, now),
      ]);
      const payment = await db.prepare("SELECT * FROM finance_payment_ledger WHERE id = ?").bind(paymentId).first<PaymentRow>();
      await writeErpAudit(db, { principal: approvalAuthorization.principal, module: "finance", action: "EXPENSE_PAID", entityType: "financeExpense", entityId: id, before: toExpense(before), after: payment ? toPayment(payment) : { paymentId } });
      return Response.json({ item: payment ? toPayment(payment) : null });
    }
    if (action === "CREATE_JOURNAL") {
      const existing = await db.prepare("SELECT * FROM finance_journal_entries WHERE payment_request_id = ?")
        .bind(id).first<JournalRow>();
      if (existing) return Response.json({ item: toJournal(existing) });
      if (before.status !== "PAID" || before.journal_status !== "READY") {
        return Response.json({ error: "지급 완료 후 전표 준비 상태인 요청만 전표를 작성할 수 있습니다." }, { status: 409 });
      }
      const voucherDate = String(body.voucherDate ?? "").trim();
      const debitAccountCode = String(body.debitAccountCode ?? before.account_code).trim();
      const debitAccountName = String(body.debitAccountName ?? before.account_name).trim();
      const creditAccountCode = String(body.creditAccountCode ?? "").trim();
      const creditAccountName = String(body.creditAccountName ?? "").trim();
      const description = String(body.description ?? `${before.vendor ? `${before.vendor} · ` : ""}${before.title}`).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(voucherDate) || !debitAccountName || !creditAccountName || !description) {
        return Response.json({ error: "전표일·적요·차변 계정·대변 계정을 모두 확인해 주세요." }, { status: 400 });
      }
      if ((debitAccountCode && debitAccountCode === creditAccountCode) || debitAccountName === creditAccountName) {
        return Response.json({ error: "차변과 대변에는 서로 다른 계정을 지정해 주세요." }, { status: 400 });
      }
      const journalId = crypto.randomUUID();
      const result = await db.batch([
        db.prepare(`INSERT INTO finance_journal_entries
          (id, payment_request_id, voucher_date, description, debit_account_code, debit_account_name,
            credit_account_code, credit_account_name, amount, status, prepared_by, posted_by, posted_at, created_at, updated_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, '', NULL, ?, ?
          WHERE EXISTS (SELECT 1 FROM finance_expense_requests WHERE id = ? AND status = 'PAID' AND journal_status = 'READY')`)
          .bind(journalId, id, voucherDate, description, debitAccountCode, debitAccountName,
            creditAccountCode, creditAccountName, before.amount, authorization.principal.employeeId, now, now, id),
        db.prepare(`UPDATE finance_expense_requests SET journal_status = 'DRAFT', updated_at = ?
          WHERE id = ? AND journal_status = 'READY'
            AND EXISTS (SELECT 1 FROM finance_journal_entries WHERE id = ? AND created_at = ?)`)
          .bind(now, id, journalId, now),
      ]);
      if ((result[0].meta.changes ?? 0) < 1 || (result[1].meta.changes ?? 0) < 1) {
        const raced = await db.prepare("SELECT * FROM finance_journal_entries WHERE payment_request_id = ?").bind(id).first<JournalRow>();
        if (raced) return Response.json({ item: toJournal(raced) });
        return Response.json({ error: "요청 상태가 변경되어 전표 초안을 만들지 못했습니다." }, { status: 409 });
      }
      const journal = await db.prepare("SELECT * FROM finance_journal_entries WHERE id = ?").bind(journalId).first<JournalRow>();
      await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "JOURNAL_DRAFT_CREATED", entityType: "financeJournal", entityId: journalId, before: toExpense(before), after: journal ? toJournal(journal) : { journalId } });
      return Response.json({ item: journal ? toJournal(journal) : null }, { status: 201 });
    }
    return Response.json({ error: "지원하지 않는 지출·지급 처리입니다." }, { status: 400 });
  }

  if (resource === "journal") {
    const approvalAuthorization = await authorizeErpRequest(db, "finance", "approve");
    if (approvalAuthorization.response) return approvalAuthorization.response;
    const before = await db.prepare("SELECT * FROM finance_journal_entries WHERE id = ?").bind(id).first<JournalRow>();
    if (!before) return Response.json({ error: "회계전표를 찾을 수 없습니다." }, { status: 404 });
    if (String(body.action ?? "POST").toUpperCase() !== "POST") {
      return Response.json({ error: "지원하지 않는 전표 처리입니다." }, { status: 400 });
    }
    if (before.status !== "DRAFT") return Response.json({ error: "작성 중인 전표만 전기할 수 있습니다." }, { status: 409 });
    if (before.amount <= 0 || !before.debit_account_name || !before.credit_account_name || before.debit_account_name === before.credit_account_name) {
      return Response.json({ error: "차변·대변 계정과 균형 금액을 다시 확인해 주세요." }, { status: 409 });
    }
    const result = await db.batch([
      db.prepare("UPDATE finance_journal_entries SET status = 'POSTED', posted_by = ?, posted_at = ?, updated_at = ? WHERE id = ? AND status = 'DRAFT'")
        .bind(approvalAuthorization.principal.employeeId, now, now, id),
      db.prepare(`UPDATE finance_expense_requests SET journal_status = 'POSTED', updated_at = ?
        WHERE id = ? AND journal_status = 'DRAFT'
          AND EXISTS (SELECT 1 FROM finance_journal_entries WHERE id = ? AND status = 'POSTED' AND updated_at = ?)`)
        .bind(now, before.payment_request_id, id, now),
    ]);
    if ((result[0].meta.changes ?? 0) < 1 || (result[1].meta.changes ?? 0) < 1) {
      return Response.json({ error: "전표 상태가 변경되어 전기하지 못했습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
    }
    const after = await db.prepare("SELECT * FROM finance_journal_entries WHERE id = ?").bind(id).first<JournalRow>();
    await writeErpAudit(db, { principal: approvalAuthorization.principal, module: "finance", action: "JOURNAL_POSTED", entityType: "financeJournal", entityId: id, before: toJournal(before), after: after ? toJournal(after) : null });
    return Response.json({ item: after ? toJournal(after) : null });
  }

  return Response.json({ error: "지원하지 않는 재무 운영 항목입니다." }, { status: 400 });
}
