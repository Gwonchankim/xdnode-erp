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
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_reconciliation_status_date ON finance_reconciliations(status, transaction_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_cash_forecast_scenario_date ON finance_cash_forecast_items(scenario, expected_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_close_period_status ON finance_close_tasks(period, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_budgets_year_month_department ON finance_budgets(fiscal_year, month, department)"),
  ]);
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

  const [forecast, closeTasks, budgets, reconciliations] = await Promise.all([
    db.prepare("SELECT * FROM finance_cash_forecast_items WHERE status <> 'DELETED' ORDER BY expected_date, created_at").all<ForecastRow>(),
    db.prepare("SELECT * FROM finance_close_tasks ORDER BY period DESC, created_at").all<CloseRow>(),
    db.prepare("SELECT * FROM finance_budgets ORDER BY fiscal_year DESC, month, department, account_code").all<BudgetRow>(),
    db.prepare("SELECT * FROM finance_reconciliations ORDER BY transaction_date DESC, created_at DESC LIMIT 500").all<ReconciliationRow>(),
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

  return Response.json({ error: "지원하지 않는 재무 운영 항목입니다." }, { status: 400 });
}
