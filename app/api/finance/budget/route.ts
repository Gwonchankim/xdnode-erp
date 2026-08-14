import { env } from "cloudflare:workers";
import { createApprovalRequest } from "../../../approval-engine";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";
import { financeCurrentData } from "../../../finance-current-data";

type FinanceBindings = { DB: D1Database };
const db = (env as unknown as FinanceBindings).DB;

type PlanRow = {
  id: string; fiscal_year: number; name: string; status: string; version: number; revision_reason: string;
  owner_employee_id: string; submitted_at: number | null; approved_by: string; approved_at: number | null;
  created_at: number; updated_at: number;
};
type LineRow = {
  id: string; plan_id: string; month: number; department: string; account_code: string; account_name: string;
  direction: string; actual_source: string; amount: number; threshold_pct: number; notes: string;
  created_at: number; updated_at: number;
};
type ActionRow = {
  id: string; plan_id: string; line_id: string; period: string; status: string; cause: string;
  action_plan: string; owner_employee_id: string; due_date: string; created_by: string; created_at: number; updated_at: number;
};
type JournalActualRow = { month: number; debit_code: string; debit_name: string; credit_code: string; credit_name: string; amount: number };

const currentYear = Number(financeCurrentData.asOf.slice(0, 4));
const currentMonth = Number(financeCurrentData.asOf.slice(5, 7));
const currentDay = Number(financeCurrentData.asOf.slice(8, 10));
const sourceLabels: Record<string, string> = {
  SALES_INVOICE: "Clobe 매출 세금계산서",
  PURCHASE_INVOICE: "Clobe 매입 세금계산서",
  POSTED_JOURNAL_DEBIT: "ERP 전기 분개 차변",
  POSTED_JOURNAL_CREDIT: "ERP 전기 분개 대변",
};

async function ensureSchema() {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_budget_plans (
      id TEXT PRIMARY KEY NOT NULL, fiscal_year INTEGER NOT NULL, name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT', version INTEGER NOT NULL DEFAULT 1,
      revision_reason TEXT NOT NULL DEFAULT '', owner_employee_id TEXT NOT NULL,
      submitted_at INTEGER, approved_by TEXT NOT NULL DEFAULT '', approved_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_budget_plan_lines (
      id TEXT PRIMARY KEY NOT NULL, plan_id TEXT NOT NULL, month INTEGER NOT NULL,
      department TEXT NOT NULL, account_code TEXT NOT NULL DEFAULT '', account_name TEXT NOT NULL,
      direction TEXT NOT NULL, actual_source TEXT NOT NULL, amount INTEGER NOT NULL,
      threshold_pct INTEGER NOT NULL DEFAULT 10, notes TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_budget_variance_actions (
      id TEXT PRIMARY KEY NOT NULL, plan_id TEXT NOT NULL, line_id TEXT NOT NULL, period TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN', cause TEXT NOT NULL DEFAULT '', action_plan TEXT NOT NULL DEFAULT '',
      owner_employee_id TEXT NOT NULL DEFAULT '', due_date TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_budget_plan_year_version ON finance_budget_plans(fiscal_year, version)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_budget_plan_year_status ON finance_budget_plans(fiscal_year, status)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_budget_line_unique_mapping ON finance_budget_plan_lines(plan_id, month, department, actual_source, account_code, account_name)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_budget_line_plan_month ON finance_budget_plan_lines(plan_id, month)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_budget_variance_line_unique ON finance_budget_variance_actions(line_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_budget_variance_plan_status_due ON finance_budget_variance_actions(plan_id, status, due_date)"),
  ]);
}

const planView = (row: PlanRow) => ({
  id: row.id, fiscalYear: row.fiscal_year, name: row.name, status: row.status, version: row.version,
  revisionReason: row.revision_reason, ownerEmployeeId: row.owner_employee_id, submittedAt: row.submitted_at,
  approvedBy: row.approved_by, approvedAt: row.approved_at, createdAt: row.created_at, updatedAt: row.updated_at,
});
const actionView = (row: ActionRow) => ({
  id: row.id, planId: row.plan_id, lineId: row.line_id, period: row.period, status: row.status,
  cause: row.cause, actionPlan: row.action_plan, ownerEmployeeId: row.owner_employee_id,
  dueDate: row.due_date, createdBy: row.created_by, updatedAt: row.updated_at,
});

function daysInMonth(year: number, month: number) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }
function isFuturePeriod(year: number, month: number) { return year > currentYear || (year === currentYear && month > currentMonth); }
function isCurrentPartial(year: number, month: number) { return year === currentYear && month === currentMonth; }

function mappedActual(line: LineRow, year: number, journalActuals: JournalActualRow[]) {
  if (isFuturePeriod(year, line.month)) return { amount: null as number | null, mapping: "FUTURE", note: "아직 도래하지 않은 예산월입니다." };
  if (line.department !== "전사") return { amount: null as number | null, mapping: "UNMAPPED", note: "실적 원천에 부서 코드가 없어 전사 예산만 자동 연결됩니다." };
  if (year !== currentYear) return { amount: null as number | null, mapping: "UNMAPPED", note: `${year}년 월별 원천은 현재 자동 연결 범위가 아닙니다.` };
  if (line.actual_source === "SALES_INVOICE") {
    const found = financeCurrentData.salesMonthly2026.find((item) => item.month === `${year}-${String(line.month).padStart(2, "0")}`);
    return { amount: found?.amount ?? 0, mapping: "MAPPED", note: sourceLabels[line.actual_source] };
  }
  if (line.actual_source === "PURCHASE_INVOICE") {
    const found = financeCurrentData.purchaseMonthly2026.find((item) => item.month === `${year}-${String(line.month).padStart(2, "0")}`);
    return { amount: found?.amount ?? 0, mapping: "MAPPED", note: sourceLabels[line.actual_source] };
  }
  if (["POSTED_JOURNAL_DEBIT", "POSTED_JOURNAL_CREDIT"].includes(line.actual_source)) {
    const debit = line.actual_source === "POSTED_JOURNAL_DEBIT";
    const actual = journalActuals.filter((item) => item.month === line.month && (line.account_code
      ? (debit ? item.debit_code : item.credit_code) === line.account_code
      : (debit ? item.debit_name : item.credit_name) === line.account_name)).reduce((sum, item) => sum + item.amount, 0);
    return { amount: actual, mapping: "MAPPED", note: sourceLabels[line.actual_source] };
  }
  return { amount: null as number | null, mapping: "UNMAPPED", note: "지원하지 않는 실적 원천입니다." };
}

async function buildPlanState(plan: PlanRow) {
  const [lineResult, actionResult, journalResult] = await Promise.all([
    db.prepare("SELECT * FROM finance_budget_plan_lines WHERE plan_id = ? ORDER BY month, department, direction, account_name")
      .bind(plan.id).all<LineRow>(),
    db.prepare("SELECT * FROM finance_budget_variance_actions WHERE plan_id = ? ORDER BY updated_at DESC")
      .bind(plan.id).all<ActionRow>(),
    db.prepare(`SELECT CAST(substr(voucher_date, 6, 2) AS INTEGER) AS month,
        debit_account_code AS debit_code, debit_account_name AS debit_name,
        credit_account_code AS credit_code, credit_account_name AS credit_name, SUM(amount) AS amount
      FROM finance_journal_entries WHERE status = 'POSTED' AND substr(voucher_date, 1, 4) = ?
      GROUP BY month, debit_account_code, debit_account_name, credit_account_code, credit_account_name`)
      .bind(String(plan.fiscal_year)).all<JournalActualRow>(),
  ]);
  const actions = new Map(actionResult.results.map((item) => [item.line_id, item]));
  const rows = lineResult.results.map((line) => {
    const actual = mappedActual(line, plan.fiscal_year, journalResult.results);
    const partial = isCurrentPartial(plan.fiscal_year, line.month);
    const comparisonBudget = partial ? Math.round(line.amount * currentDay / daysInMonth(plan.fiscal_year, line.month)) : line.amount;
    const varianceAmount = actual.amount === null ? null : actual.amount - comparisonBudget;
    const variancePct = varianceAmount === null ? null : comparisonBudget === 0 ? (actual.amount === 0 ? 0 : 100) : varianceAmount / comparisonBudget * 100;
    let flag = actual.mapping === "FUTURE" ? "FUTURE" : actual.mapping !== "MAPPED" ? "UNMAPPED" : "GOOD";
    if (actual.amount !== null && actual.mapping === "MAPPED") {
      if (line.direction === "REVENUE") flag = actual.amount >= comparisonBudget ? "GOOD"
        : actual.amount < comparisonBudget * (1 - line.threshold_pct / 100) ? "ALERT" : "WATCH";
      else flag = actual.amount <= comparisonBudget ? "GOOD"
        : actual.amount > comparisonBudget * (1 + line.threshold_pct / 100) ? "ALERT" : "WATCH";
    }
    const action = actions.get(line.id);
    return {
      id: line.id, planId: line.plan_id, month: line.month, department: line.department,
      accountCode: line.account_code, accountName: line.account_name, direction: line.direction,
      actualSource: line.actual_source, sourceLabel: sourceLabels[line.actual_source] ?? line.actual_source,
      amount: line.amount, comparisonBudget, actualAmount: actual.amount, varianceAmount, variancePct,
      thresholdPct: line.threshold_pct, notes: line.notes, mapping: actual.mapping, mappingNote: actual.note,
      partial, flag, action: action ? actionView(action) : null,
      requiresAction: flag === "ALERT" && (!action || action.status === "OPEN"),
    };
  });
  const comparable = rows.filter((row) => !["FUTURE"].includes(row.flag));
  const mapped = comparable.filter((row) => row.actualAmount !== null);
  const futureBudget = rows.filter((row) => row.flag === "FUTURE").reduce((sum, row) => sum + row.amount, 0);
  const currentRemainingBudget = rows.filter((row) => row.partial).reduce((sum, row) => sum + Math.max(0, row.amount - row.comparisonBudget), 0);
  const directionSummary = (["REVENUE", "EXPENSE"] as const).map((direction) => {
    const directionRows = rows.filter((row) => row.direction === direction);
    const ytd = directionRows.filter((row) => row.actualAmount !== null).reduce((sum, row) => sum + Number(row.actualAmount), 0);
    const budgetToDate = directionRows.filter((row) => row.actualAmount !== null).reduce((sum, row) => sum + row.comparisonBudget, 0);
    const annualBudget = directionRows.reduce((sum, row) => sum + row.amount, 0);
    const remainingBudget = directionRows.filter((row) => row.flag === "FUTURE").reduce((sum, row) => sum + row.amount, 0)
      + directionRows.filter((row) => row.partial).reduce((sum, row) => sum + Math.max(0, row.amount - row.comparisonBudget), 0);
    return { direction, annualBudget, budgetToDate, actualToDate: ytd, variance: ytd - budgetToDate, yearEndProjection: ytd + remainingBudget };
  });
  return {
    plan: planView(plan), lines: rows,
    summary: {
      annualBudget: rows.reduce((sum, row) => sum + row.amount, 0),
      budgetToDate: mapped.reduce((sum, row) => sum + row.comparisonBudget, 0),
      actualToDate: mapped.reduce((sum, row) => sum + Number(row.actualAmount), 0),
      yearEndProjection: mapped.reduce((sum, row) => sum + Number(row.actualAmount), 0) + futureBudget + currentRemainingBudget,
      alertCount: rows.filter((row) => row.flag === "ALERT").length,
      watchCount: rows.filter((row) => row.flag === "WATCH").length,
      unmappedCount: rows.filter((row) => row.flag === "UNMAPPED").length,
      openActionCount: rows.filter((row) => row.requiresAction).length,
      mappedCount: mapped.length, comparableCount: comparable.length,
      coveragePct: comparable.length ? Math.round(mapped.length / comparable.length * 100) : 0,
      registeredMonthCount: new Set(rows.map((row) => row.month)).size,
    },
    directionSummary,
  };
}

function validYear(value: number) { return Number.isInteger(value) && value >= currentYear && value <= currentYear + 4; }

export async function GET(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "finance", "read");
  if (authorization.response) return authorization.response;
  const url = new URL(request.url);
  const year = Number(url.searchParams.get("year") ?? currentYear);
  if (!validYear(year)) return Response.json({ error: `${currentYear}~${currentYear + 4}년 예산을 선택해 주세요.` }, { status: 400 });
  const plans = await db.prepare(`SELECT * FROM finance_budget_plans WHERE fiscal_year = ?
    ORDER BY version DESC`).bind(year).all<PlanRow>();
  const requestedId = url.searchParams.get("planId") ?? "";
  const selected = plans.results.find((item) => item.id === requestedId) ?? plans.results[0] ?? null;
  return Response.json({
    asOf: financeCurrentData.asOf, year, currentYear, sourceLabels,
    plans: plans.results.map(planView), selected: selected ? await buildPlanState(selected) : null,
    scopeNotice: "Clobe 매출·매입과 ERP 전기 분개에는 부서 코드가 없어 전사 예산만 자동 대사합니다.",
  });
}

export async function POST(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "finance", "write");
  if (authorization.response) return authorization.response;
  const body = await request.json() as Record<string, unknown>;
  const action = String(body.action ?? "").toUpperCase();
  const now = Date.now();

  if (action === "CREATE_PLAN") {
    const fiscalYear = Number(body.fiscalYear);
    const name = String(body.name ?? "").trim();
    if (!validYear(fiscalYear) || !name) return Response.json({ error: "예산연도와 계획명을 확인해 주세요." }, { status: 400 });
    const pending = await db.prepare(`SELECT id FROM finance_budget_plans WHERE fiscal_year = ? AND status IN ('DRAFT','SUBMITTED') LIMIT 1`)
      .bind(fiscalYear).first<{ id: string }>();
    if (pending) return Response.json({ error: "같은 연도에 작성 또는 승인 진행 중인 예산 버전이 있습니다." }, { status: 409 });
    const latest = await db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM finance_budget_plans WHERE fiscal_year = ?")
      .bind(fiscalYear).first<{ version: number }>();
    const id = crypto.randomUUID();
    await db.prepare(`INSERT INTO finance_budget_plans
      (id, fiscal_year, name, status, version, revision_reason, owner_employee_id, submitted_at,
        approved_by, approved_at, created_at, updated_at) VALUES (?, ?, ?, 'DRAFT', ?, '', ?, NULL, '', NULL, ?, ?)`)
      .bind(id, fiscalYear, name, (latest?.version ?? 0) + 1, authorization.principal.employeeId, now, now).run();
    const row = await db.prepare("SELECT * FROM finance_budget_plans WHERE id = ?").bind(id).first<PlanRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "BUDGET_PLAN_CREATED", entityType: "financeBudgetPlan", entityId: id, after: row ? planView(row) : body });
    return Response.json({ plan: row ? planView(row) : null }, { status: 201 });
  }

  if (action === "ADD_LINE") {
    const planId = String(body.planId ?? "").trim();
    const plan = await db.prepare("SELECT * FROM finance_budget_plans WHERE id = ?").bind(planId).first<PlanRow>();
    if (!plan) return Response.json({ error: "예산 계획을 찾을 수 없습니다." }, { status: 404 });
    if (plan.status !== "DRAFT") return Response.json({ error: "작성 중인 예산 버전만 수정할 수 있습니다." }, { status: 409 });
    const month = Number(body.month); const amount = Number(body.amount); const thresholdPct = Number(body.thresholdPct ?? 10);
    const department = String(body.department ?? "").trim(); const accountName = String(body.accountName ?? "").trim();
    const accountCode = String(body.accountCode ?? "").trim(); const direction = String(body.direction ?? "").toUpperCase();
    const actualSource = String(body.actualSource ?? "").toUpperCase();
    if (!Number.isInteger(month) || month < 1 || month > 12 || !department || !accountName || !["REVENUE","EXPENSE"].includes(direction)
      || !Object.hasOwn(sourceLabels, actualSource) || !Number.isFinite(amount) || amount < 0 || !Number.isInteger(thresholdPct) || thresholdPct < 0 || thresholdPct > 100) {
      return Response.json({ error: "월·부서·계정·구분·실적 원천·예산액·경보 기준을 확인해 주세요." }, { status: 400 });
    }
    if ((actualSource === "SALES_INVOICE" && direction !== "REVENUE") || (actualSource === "PURCHASE_INVOICE" && direction !== "EXPENSE")) {
      return Response.json({ error: "Clobe 매출은 수익, Clobe 매입은 비용 구분으로 연결해 주세요." }, { status: 400 });
    }
    if (["SALES_INVOICE","PURCHASE_INVOICE"].includes(actualSource)) {
      const duplicate = await db.prepare(`SELECT id FROM finance_budget_plan_lines
        WHERE plan_id = ? AND month = ? AND department = ? AND actual_source = ? LIMIT 1`)
        .bind(planId, month, department, actualSource).first<{ id: string }>();
      if (duplicate) return Response.json({ error: "Clobe 매출·매입 합계 원천은 같은 월·부서에 한 번만 연결할 수 있습니다." }, { status: 409 });
    }
    const id = crypto.randomUUID();
    try {
      await db.prepare(`INSERT INTO finance_budget_plan_lines
        (id, plan_id, month, department, account_code, account_name, direction, actual_source,
          amount, threshold_pct, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, planId, month, department, accountCode, accountName, direction, actualSource, Math.round(amount), thresholdPct,
          String(body.notes ?? "").trim(), now, now).run();
    } catch {
      return Response.json({ error: "같은 예산선 또는 실적 매핑이 이미 등록되어 있습니다." }, { status: 409 });
    }
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "BUDGET_LINE_CREATED", entityType: "financeBudgetLine", entityId: id, after: body });
    return Response.json({ created: true, id }, { status: 201 });
  }

  if (action === "SUBMIT_PLAN") {
    const planId = String(body.planId ?? "").trim();
    const plan = await db.prepare("SELECT * FROM finance_budget_plans WHERE id = ?").bind(planId).first<PlanRow>();
    if (!plan) return Response.json({ error: "예산 계획을 찾을 수 없습니다." }, { status: 404 });
    if (plan.status !== "DRAFT") return Response.json({ error: "작성 중인 예산 버전만 결재를 제출할 수 있습니다." }, { status: 409 });
    const totals = await db.prepare("SELECT COUNT(*) AS count, COUNT(DISTINCT month) AS month_count, COALESCE(SUM(amount), 0) AS amount FROM finance_budget_plan_lines WHERE plan_id = ?")
      .bind(planId).first<{ count: number; month_count: number; amount: number }>();
    if (!totals?.count) return Response.json({ error: "예산선을 1개 이상 등록한 뒤 결재를 제출해 주세요." }, { status: 409 });
    if (totals.month_count !== 12) return Response.json({ error: `연간 계획은 1~12월을 모두 포함해야 합니다. 현재 ${totals.month_count}개 월이 등록되어 있습니다.` }, { status: 409 });
    const updated = await db.prepare("UPDATE finance_budget_plans SET status = 'SUBMITTED', submitted_at = ?, updated_at = ? WHERE id = ? AND status = 'DRAFT'")
      .bind(now, now, planId).run();
    if (updated.meta.changes !== 1) return Response.json({ error: "다른 사용자가 예산 상태를 먼저 변경했습니다." }, { status: 409 });
    try {
      const approval = await createApprovalRequest(db, authorization.principal, {
        module: "finance", requestType: "BUDGET", title: `${plan.fiscal_year}년 ${plan.name} v${plan.version} 승인`,
        description: `${totals.count}개 예산선 · ${totals.amount.toLocaleString("ko-KR")}원`,
        targetEntityType: "FINANCE_BUDGET_PLAN", targetEntityId: planId, amount: totals.amount,
        metadata: { fiscalYear: plan.fiscal_year, version: plan.version, lineCount: totals.count, monthCount: totals.month_count, revisionReason: plan.revision_reason },
      });
      await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "BUDGET_PLAN_SUBMITTED", entityType: "financeBudgetPlan", entityId: planId, before: planView(plan), after: { approvalId: approval.id } });
      return Response.json({ submitted: true, approvalId: approval.id }, { status: 202 });
    } catch (error) {
      await db.prepare("UPDATE finance_budget_plans SET status = 'DRAFT', submitted_at = NULL, updated_at = ? WHERE id = ? AND status = 'SUBMITTED'")
        .bind(Date.now(), planId).run();
      return Response.json({ error: error instanceof Error ? error.message : "예산 결재선을 만들지 못했습니다." }, { status: 409 });
    }
  }

  if (action === "CREATE_REVISION") {
    const sourcePlanId = String(body.planId ?? "").trim(); const reason = String(body.reason ?? "").trim();
    const source = await db.prepare("SELECT * FROM finance_budget_plans WHERE id = ?").bind(sourcePlanId).first<PlanRow>();
    if (!source || !["APPROVED","SUPERSEDED"].includes(source.status)) return Response.json({ error: "승인된 예산 버전만 개정할 수 있습니다." }, { status: 409 });
    if (reason.length < 5) return Response.json({ error: "개정 사유를 5자 이상 입력해 주세요." }, { status: 400 });
    const pending = await db.prepare(`SELECT id FROM finance_budget_plans WHERE fiscal_year = ? AND status IN ('DRAFT','SUBMITTED') LIMIT 1`)
      .bind(source.fiscal_year).first<{ id: string }>();
    if (pending) return Response.json({ error: "같은 연도에 작성 또는 승인 진행 중인 개정본이 있습니다." }, { status: 409 });
    const latest = await db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM finance_budget_plans WHERE fiscal_year = ?")
      .bind(source.fiscal_year).first<{ version: number }>();
    const newId = crypto.randomUUID(); const version = (latest?.version ?? source.version) + 1;
    await db.batch([
      db.prepare(`INSERT INTO finance_budget_plans
        (id, fiscal_year, name, status, version, revision_reason, owner_employee_id, submitted_at,
          approved_by, approved_at, created_at, updated_at) VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, NULL, '', NULL, ?, ?)`)
        .bind(newId, source.fiscal_year, source.name, version, reason, authorization.principal.employeeId, now, now),
      db.prepare(`INSERT INTO finance_budget_plan_lines
        (id, plan_id, month, department, account_code, account_name, direction, actual_source,
          amount, threshold_pct, notes, created_at, updated_at)
        SELECT lower(hex(randomblob(16))), ?, month, department, account_code, account_name, direction, actual_source,
          amount, threshold_pct, notes, ?, ? FROM finance_budget_plan_lines WHERE plan_id = ?`)
        .bind(newId, now, now, sourcePlanId),
    ]);
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "BUDGET_PLAN_REVISION_CREATED", entityType: "financeBudgetPlan", entityId: newId, before: planView(source), after: { version, reason } });
    return Response.json({ created: true, planId: newId }, { status: 201 });
  }

  if (action === "SAVE_VARIANCE_ACTION") {
    const lineId = String(body.lineId ?? "").trim();
    const line = await db.prepare(`SELECT line.*, plan.status AS plan_status, plan.fiscal_year FROM finance_budget_plan_lines line
      JOIN finance_budget_plans plan ON plan.id = line.plan_id WHERE line.id = ?`).bind(lineId).first<LineRow & { plan_status: string; fiscal_year: number }>();
    if (!line) return Response.json({ error: "예산선을 찾을 수 없습니다." }, { status: 404 });
    if (!["APPROVED","SUPERSEDED"].includes(line.plan_status)) return Response.json({ error: "승인된 예산 버전의 차이만 조치할 수 있습니다." }, { status: 409 });
    const status = String(body.status ?? "OPEN").toUpperCase(); const cause = String(body.cause ?? "").trim();
    const actionPlan = String(body.actionPlan ?? "").trim(); const owner = String(body.ownerEmployeeId ?? "").trim();
    const dueDate = String(body.dueDate ?? "").trim();
    if (!["OPEN","EXPLAINED","ACTIONED"].includes(status) || (status !== "OPEN" && cause.length < 3)
      || (status === "ACTIONED" && (!actionPlan || !owner || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)))) {
      return Response.json({ error: "상태에 맞는 원인·조치·담당자·기한을 입력해 주세요." }, { status: 400 });
    }
    const existing = await db.prepare("SELECT * FROM finance_budget_variance_actions WHERE line_id = ?").bind(lineId).first<ActionRow>();
    const id = existing?.id ?? crypto.randomUUID();
    await db.prepare(`INSERT INTO finance_budget_variance_actions
      (id, plan_id, line_id, period, status, cause, action_plan, owner_employee_id, due_date, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(line_id) DO UPDATE SET status = excluded.status, cause = excluded.cause,
        action_plan = excluded.action_plan, owner_employee_id = excluded.owner_employee_id,
        due_date = excluded.due_date, updated_at = excluded.updated_at`)
      .bind(id, line.plan_id, line.id, `${line.fiscal_year}-${String(line.month).padStart(2, "0")}`, status, cause,
        actionPlan, owner, dueDate, authorization.principal.employeeId, existing?.created_at ?? now, now).run();
    const saved = await db.prepare("SELECT * FROM finance_budget_variance_actions WHERE line_id = ?").bind(lineId).first<ActionRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "BUDGET_VARIANCE_ACTION_SAVED", entityType: "financeBudgetVariance", entityId: id, before: existing ? actionView(existing) : null, after: saved ? actionView(saved) : null });
    return Response.json({ action: saved ? actionView(saved) : null });
  }

  return Response.json({ error: "지원하지 않는 예산 작업입니다." }, { status: 400 });
}

export async function DELETE(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "finance", "write");
  if (authorization.response) return authorization.response;
  const body = await request.json() as { lineId?: string };
  const lineId = String(body.lineId ?? "").trim();
  const line = await db.prepare(`SELECT line.*, plan.status AS plan_status FROM finance_budget_plan_lines line
    JOIN finance_budget_plans plan ON plan.id = line.plan_id WHERE line.id = ?`).bind(lineId).first<LineRow & { plan_status: string }>();
  if (!line) return Response.json({ error: "예산선을 찾을 수 없습니다." }, { status: 404 });
  if (line.plan_status !== "DRAFT") return Response.json({ error: "작성 중인 예산 버전만 수정할 수 있습니다." }, { status: 409 });
  await db.prepare("DELETE FROM finance_budget_plan_lines WHERE id = ?").bind(lineId).run();
  await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "BUDGET_LINE_DELETED", entityType: "financeBudgetLine", entityId: lineId, before: line });
  return Response.json({ deleted: true });
}
