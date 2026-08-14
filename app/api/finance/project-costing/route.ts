import { env } from "cloudflare:workers";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";
import { financeCurrentData } from "../../../finance-current-data";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;
type CenterRow = { id: string; code: string; name: string; center_type: string; owner_employee_id: string; opportunity_id: string;
  client_name: string; start_date: string; end_date: string; status: string; note: string; created_by: string; created_at: number; updated_at: number };
type AllocationRow = { id: string; cost_center_id: string; source_type: string; source_id: string; period: string; direction: string;
  source_amount: number; amount: number; allocation_basis: string; note: string; created_by: string; created_at: number; updated_at: number };
type Source = { sourceType: "SALES_INVOICE" | "PURCHASE_INVOICE" | "EXPENSE_REQUEST" | "PAYROLL_RUN"; sourceId: string;
  period: string; date: string; label: string; detail: string; direction: "REVENUE" | "COST"; amount: number;
  linkedCenterId: string; autoAssigned: boolean };

const currentPeriod = financeCurrentData.asOf.slice(0, 7);
const validPeriod = (period: string) => /^2026-(0[1-9]|1[0-2])$/.test(period) && period <= currentPeriod;
const validDate = (date: string) => /^\d{4}-\d{2}-\d{2}$/.test(date);
const centerTypes = new Set(["PROJECT", "DEPARTMENT", "OVERHEAD"]);

async function ensureSchema() {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_cost_centers (
      id TEXT PRIMARY KEY NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, center_type TEXT NOT NULL,
      owner_employee_id TEXT NOT NULL DEFAULT '', opportunity_id TEXT NOT NULL DEFAULT '', client_name TEXT NOT NULL DEFAULT '',
      start_date TEXT NOT NULL DEFAULT '', end_date TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'ACTIVE',
      note TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_project_monthly_budgets (
      id TEXT PRIMARY KEY NOT NULL, cost_center_id TEXT NOT NULL, period TEXT NOT NULL, revenue_budget INTEGER NOT NULL DEFAULT 0,
      cost_budget INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', approved_by TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_project_allocations (
      id TEXT PRIMARY KEY NOT NULL, cost_center_id TEXT NOT NULL, source_type TEXT NOT NULL, source_id TEXT NOT NULL,
      period TEXT NOT NULL, direction TEXT NOT NULL, source_amount INTEGER NOT NULL, amount INTEGER NOT NULL,
      allocation_basis TEXT NOT NULL DEFAULT 'MANUAL_AMOUNT', note TEXT NOT NULL, created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_cost_center_code ON finance_cost_centers(code)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_cost_center_opportunity ON finance_cost_centers(opportunity_id) WHERE opportunity_id <> ''"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_cost_center_status_type ON finance_cost_centers(status, center_type)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_project_budget_period ON finance_project_monthly_budgets(cost_center_id, period)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_project_budget_period_center ON finance_project_monthly_budgets(period, cost_center_id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_project_allocation_source_center ON finance_project_allocations(source_type, source_id, cost_center_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_project_allocation_period_center ON finance_project_allocations(period, cost_center_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_project_allocation_source ON finance_project_allocations(source_type, source_id)"),
  ]);
}

async function locked(period: string) {
  return (await db.prepare("SELECT status FROM finance_close_runs WHERE period = ?").bind(period).first<{ status: string }>())?.status === "CLOSED";
}

async function sourcesFor(period: string): Promise<Source[]> {
  const like = `${period}-%`;
  const [sales, purchases, expenses, payroll] = await Promise.all([
    db.prepare(`SELECT document.id, document.issued_date, document.amount, document.document_number,
        opportunity.title, account.name AS account_name, COALESCE(center.id, '') AS center_id
      FROM sales_documents document JOIN sales_opportunities opportunity ON opportunity.id = document.opportunity_id
      LEFT JOIN sales_accounts account ON account.id = opportunity.account_id
      LEFT JOIN finance_cost_centers center ON center.opportunity_id = opportunity.id
      WHERE document.document_type = 'INVOICE' AND document.status IN ('ACCEPTED','COMPLETED') AND document.issued_date LIKE ?`)
      .bind(like).all<{ id: string; issued_date: string; amount: number; document_number: string; title: string; account_name: string; center_id: string }>(),
    db.prepare(`SELECT invoice.id, invoice.invoice_date, invoice.supply_amount, invoice.invoice_number,
        purchase_order.order_number, vendor.name AS vendor_name
      FROM finance_purchase_invoices invoice JOIN finance_purchase_orders purchase_order ON purchase_order.id = invoice.order_id
      LEFT JOIN finance_purchase_vendors vendor ON vendor.id = purchase_order.vendor_id
      WHERE invoice.status IN ('MATCHED','PAYMENT_READY','PAID') AND invoice.invoice_date LIKE ?`).bind(like)
      .all<{ id: string; invoice_date: string; supply_amount: number; invoice_number: string; order_number: string; vendor_name: string }>(),
    db.prepare(`SELECT id, requested_date, amount, title, vendor FROM finance_expense_requests
      WHERE status = 'PAID' AND requested_date LIKE ? AND source_type NOT IN ('PURCHASE_INVOICE','PAYROLL_RUN')`).bind(like)
      .all<{ id: string; requested_date: string; amount: number; title: string; vendor: string }>(),
    db.prepare("SELECT period, gross_pay, employee_count FROM hr_payroll_runs WHERE period = ? AND status = 'LOCKED'").bind(period)
      .all<{ period: string; gross_pay: number; employee_count: number }>(),
  ]);
  return [
    ...sales.results.map((row): Source => ({ sourceType: "SALES_INVOICE", sourceId: row.id, period, date: row.issued_date,
      label: `${row.account_name || "고객"} · ${row.title}`, detail: `청구 ${row.document_number}`, direction: "REVENUE",
      amount: row.amount, linkedCenterId: row.center_id, autoAssigned: Boolean(row.center_id) })),
    ...purchases.results.map((row): Source => ({ sourceType: "PURCHASE_INVOICE", sourceId: row.id, period, date: row.invoice_date,
      label: `${row.vendor_name || "공급사"} · ${row.order_number}`, detail: `매입 ${row.invoice_number}`, direction: "COST",
      amount: row.supply_amount, linkedCenterId: "", autoAssigned: false })),
    ...expenses.results.map((row): Source => ({ sourceType: "EXPENSE_REQUEST", sourceId: row.id, period, date: row.requested_date,
      label: `${row.vendor || "일반 지출"} · ${row.title}`, detail: "지급 완료 지출", direction: "COST",
      amount: row.amount, linkedCenterId: "", autoAssigned: false })),
    ...payroll.results.map((row): Source => ({ sourceType: "PAYROLL_RUN", sourceId: row.period, period, date: `${period}-01`,
      label: `${period} 급여 · ${row.employee_count}명`, detail: "잠금된 총지급액 · 타임시트 근거 수동 배부", direction: "COST",
      amount: row.gross_pay, linkedCenterId: "", autoAssigned: false })),
  ];
}

export async function GET(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "finance", "read");
  if (authorization.response) return authorization.response;
  const period = new URL(request.url).searchParams.get("period")?.trim() || currentPeriod;
  if (!validPeriod(period)) return Response.json({ error: "2026년 현재까지의 관리월을 선택해 주세요." }, { status: 400 });
  const [centers, budgets, allocations, opportunities, sources] = await Promise.all([
    db.prepare("SELECT * FROM finance_cost_centers ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'HOLD' THEN 1 ELSE 2 END, code").all<CenterRow>(),
    db.prepare("SELECT * FROM finance_project_monthly_budgets WHERE period = ?").bind(period).all<Record<string, string | number>>(),
    db.prepare(`SELECT allocation.*, center.code AS center_code, center.name AS center_name
      FROM finance_project_allocations allocation JOIN finance_cost_centers center ON center.id = allocation.cost_center_id
      WHERE allocation.period = ? ORDER BY allocation.created_at DESC`).bind(period).all<AllocationRow & { center_code: string; center_name: string }>(),
    db.prepare(`SELECT opportunity.id, opportunity.title, opportunity.stage, account.name AS account_name
      FROM sales_opportunities opportunity LEFT JOIN sales_accounts account ON account.id = opportunity.account_id
      WHERE opportunity.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM finance_cost_centers center WHERE center.opportunity_id = opportunity.id)
      ORDER BY opportunity.updated_at DESC`).all<{ id: string; title: string; stage: string; account_name: string }>(),
    sourcesFor(period),
  ]);
  const allocationTotals = new Map<string, number>();
  for (const row of allocations.results) allocationTotals.set(`${row.source_type}:${row.source_id}`, (allocationTotals.get(`${row.source_type}:${row.source_id}`) ?? 0) + row.amount);
  const sourceViews = sources.map((source) => ({ ...source, allocated: source.autoAssigned ? source.amount : allocationTotals.get(`${source.sourceType}:${source.sourceId}`) ?? 0,
    remaining: source.autoAssigned ? 0 : Math.max(0, source.amount - (allocationTotals.get(`${source.sourceType}:${source.sourceId}`) ?? 0)) }));
  const budgetsByCenter = new Map(budgets.results.map((row) => [String(row.cost_center_id), row]));
  const metrics = centers.results.map((center) => {
    const automaticRevenue = sources.filter((source) => source.autoAssigned && source.linkedCenterId === center.id).reduce((sum, source) => sum + source.amount, 0);
    const centerAllocations = allocations.results.filter((row) => row.cost_center_id === center.id);
    const revenue = automaticRevenue + centerAllocations.filter((row) => row.direction === "REVENUE").reduce((sum, row) => sum + row.amount, 0);
    const cost = centerAllocations.filter((row) => row.direction === "COST").reduce((sum, row) => sum + row.amount, 0);
    const budget = budgetsByCenter.get(center.id);
    return { ...center, revenue, cost, profit: revenue - cost, marginPct: revenue ? Math.round((revenue - cost) / revenue * 1000) / 10 : null,
      revenueBudget: Number(budget?.revenue_budget ?? 0), costBudget: Number(budget?.cost_budget ?? 0), budgetNote: String(budget?.note ?? ""),
      costVariance: cost - Number(budget?.cost_budget ?? 0), revenueVariance: revenue - Number(budget?.revenue_budget ?? 0) };
  });
  const totalRevenue = metrics.reduce((sum, row) => sum + row.revenue, 0); const totalCost = metrics.reduce((sum, row) => sum + row.cost, 0);
  return Response.json({ asOf: financeCurrentData.asOf, currentPeriod, period, locked: await locked(period), centers: metrics,
    opportunities: opportunities.results, sources: sourceViews, allocations: allocations.results,
    summary: { activeCenters: centers.results.filter((row) => row.status === "ACTIVE").length, revenue: totalRevenue, cost: totalCost,
      profit: totalRevenue - totalCost, unmappedSources: sourceViews.filter((source) => source.remaining > 0).length,
      unmappedAmount: sourceViews.reduce((sum, source) => sum + source.remaining, 0),
      externalScopeNote: "Clobe 집계 세금계산서는 문서 ID가 없어 전사 분석에만 사용하고 프로젝트 손익에는 자동 배부하지 않습니다." } });
}

async function findSource(period: string, sourceType: string, sourceId: string) {
  return (await sourcesFor(period)).find((source) => source.sourceType === sourceType && source.sourceId === sourceId);
}

export async function POST(request: Request) {
  await ensureSchema();
  const body = await request.json() as Record<string, unknown>; const action = String(body.action ?? "CREATE_CENTER").toUpperCase();
  const approvalAction = ["SET_BUDGET", "REMOVE_ALLOCATION", "SET_STATUS"].includes(action);
  const authorization = await authorizeErpRequest(db, "finance", approvalAction ? "approve" : "write");
  if (authorization.response) return authorization.response;
  const now = Date.now();
  if (action === "CREATE_CENTER") {
    const code = String(body.code ?? "").trim().toUpperCase(); const name = String(body.name ?? "").trim();
    const centerType = String(body.centerType ?? "PROJECT"); const opportunityId = String(body.opportunityId ?? "").trim();
    const startDate = String(body.startDate ?? "").trim(); const endDate = String(body.endDate ?? "").trim();
    if (!code || !name || !centerTypes.has(centerType) || (startDate && !validDate(startDate)) || (endDate && !validDate(endDate))
      || (startDate && endDate && startDate > endDate) || (opportunityId && centerType !== "PROJECT")) return Response.json({ error: "코드·명칭·유형·기간·영업기회 연결을 확인해 주세요." }, { status: 400 });
    let clientName = String(body.clientName ?? "").trim();
    if (opportunityId) {
      const opportunity = await db.prepare(`SELECT opportunity.id, account.name AS account_name FROM sales_opportunities opportunity
        LEFT JOIN sales_accounts account ON account.id = opportunity.account_id WHERE opportunity.id = ? AND opportunity.deleted_at IS NULL`)
        .bind(opportunityId).first<{ id: string; account_name: string }>();
      if (!opportunity) return Response.json({ error: "연결할 영업기회를 찾지 못했습니다." }, { status: 404 });
      clientName = opportunity.account_name || clientName;
    }
    const id = crypto.randomUUID();
    try {
      await db.prepare(`INSERT INTO finance_cost_centers (id, code, name, center_type, owner_employee_id, opportunity_id,
        client_name, start_date, end_date, status, note, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)`)
        .bind(id, code, name, centerType, String(body.ownerEmployeeId ?? "").trim(), opportunityId, clientName, startDate, endDate,
          String(body.note ?? "").trim().slice(0, 2000), authorization.principal.employeeId, now, now).run();
    } catch (error) {
      return Response.json({ error: /UNIQUE/.test(error instanceof Error ? error.message : "") ? "같은 코드 또는 영업기회 연결이 이미 있습니다." : "원가센터를 등록하지 못했습니다." }, { status: 409 });
    }
    const after = await db.prepare("SELECT * FROM finance_cost_centers WHERE id = ?").bind(id).first<CenterRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "COST_CENTER_CREATED",
      entityType: "financeCostCenter", entityId: id, after });
    return Response.json({ item: after }, { status: 201 });
  }
  if (action === "SET_BUDGET") {
    const centerId = String(body.costCenterId ?? "").trim(); const period = String(body.period ?? "").trim();
    const revenueBudget = Math.round(Number(body.revenueBudget)); const costBudget = Math.round(Number(body.costBudget));
    if (!validPeriod(period) || !Number.isSafeInteger(revenueBudget) || revenueBudget < 0 || !Number.isSafeInteger(costBudget) || costBudget < 0) return Response.json({ error: "예산월과 매출·원가 예산을 확인해 주세요." }, { status: 400 });
    if (await locked(period)) return Response.json({ error: "잠긴 마감월의 프로젝트 예산은 변경할 수 없습니다." }, { status: 409 });
    const center = await db.prepare("SELECT * FROM finance_cost_centers WHERE id = ? AND status <> 'CLOSED'").bind(centerId).first<CenterRow>();
    if (!center) return Response.json({ error: "활성 원가센터를 찾지 못했습니다." }, { status: 404 });
    const before = await db.prepare("SELECT * FROM finance_project_monthly_budgets WHERE cost_center_id = ? AND period = ?").bind(centerId, period).first();
    await db.prepare(`INSERT INTO finance_project_monthly_budgets (id, cost_center_id, period, revenue_budget, cost_budget,
      note, approved_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cost_center_id, period) DO UPDATE SET revenue_budget = excluded.revenue_budget,
        cost_budget = excluded.cost_budget, note = excluded.note, approved_by = excluded.approved_by, updated_at = excluded.updated_at`)
      .bind(crypto.randomUUID(), centerId, period, revenueBudget, costBudget, String(body.note ?? "").trim().slice(0, 1000), authorization.principal.employeeId, now, now).run();
    const after = await db.prepare("SELECT * FROM finance_project_monthly_budgets WHERE cost_center_id = ? AND period = ?").bind(centerId, period).first();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: before ? "PROJECT_BUDGET_UPDATED" : "PROJECT_BUDGET_CREATED",
      entityType: "financeProjectBudget", entityId: `${centerId}:${period}`, before, after });
    return Response.json({ item: after });
  }
  if (action === "ALLOCATE") {
    const centerId = String(body.costCenterId ?? "").trim(); const period = String(body.period ?? "").trim();
    const sourceType = String(body.sourceType ?? ""); const sourceId = String(body.sourceId ?? "").trim();
    const allocationAmount = Math.round(Number(body.amount)); const note = String(body.note ?? "").trim();
    if (!validPeriod(period) || !["SALES_INVOICE","PURCHASE_INVOICE","EXPENSE_REQUEST","PAYROLL_RUN"].includes(sourceType)
      || !sourceId || !Number.isSafeInteger(allocationAmount) || allocationAmount <= 0 || note.length < (sourceType === "PAYROLL_RUN" ? 10 : 5)) {
      return Response.json({ error: "원천·배부금액과 배부 근거를 확인해 주세요." }, { status: 400 });
    }
    if (await locked(period)) return Response.json({ error: "잠긴 마감월에는 프로젝트 배부를 추가할 수 없습니다." }, { status: 409 });
    const [center, source] = await Promise.all([
      db.prepare("SELECT * FROM finance_cost_centers WHERE id = ? AND status = 'ACTIVE'").bind(centerId).first<CenterRow>(), findSource(period, sourceType, sourceId),
    ]);
    if (!center || !source) return Response.json({ error: "활성 원가센터 또는 확정 원천을 찾지 못했습니다." }, { status: 404 });
    if (source.autoAssigned) return Response.json({ error: "영업기회로 자동 귀속된 매출은 수동으로 다시 배부할 수 없습니다." }, { status: 409 });
    if (source.direction === "REVENUE" && center.center_type !== "PROJECT") return Response.json({ error: "매출은 프로젝트 유형 원가센터에만 배부할 수 있습니다." }, { status: 409 });
    const allocated = await db.prepare("SELECT COALESCE(SUM(amount), 0) AS amount FROM finance_project_allocations WHERE source_type = ? AND source_id = ?")
      .bind(sourceType, sourceId).first<{ amount: number }>();
    if (Number(allocated?.amount ?? 0) + allocationAmount > source.amount) return Response.json({ error: `원천 잔액 ${(source.amount - Number(allocated?.amount ?? 0)).toLocaleString("ko-KR")}원을 초과해 배부할 수 없습니다.` }, { status: 409 });
    const id = crypto.randomUUID();
    try {
      await db.prepare(`INSERT INTO finance_project_allocations (id, cost_center_id, source_type, source_id, period,
        direction, source_amount, amount, allocation_basis, note, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'MANUAL_AMOUNT', ?, ?, ?, ?)`)
        .bind(id, centerId, sourceType, sourceId, period, source.direction, source.amount, allocationAmount, note,
          authorization.principal.employeeId, now, now).run();
    } catch (error) {
      return Response.json({ error: /UNIQUE/.test(error instanceof Error ? error.message : "") ? "같은 원천은 이 원가센터에 한 번만 배부할 수 있습니다." : "배부를 저장하지 못했습니다." }, { status: 409 });
    }
    const after = await db.prepare("SELECT * FROM finance_project_allocations WHERE id = ?").bind(id).first<AllocationRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "PROJECT_COST_ALLOCATED",
      entityType: "financeProjectAllocation", entityId: id, after });
    return Response.json({ item: after }, { status: 201 });
  }
  if (action === "REMOVE_ALLOCATION") {
    const id = String(body.id ?? "").trim(); const before = await db.prepare("SELECT * FROM finance_project_allocations WHERE id = ?").bind(id).first<AllocationRow>();
    if (!before) return Response.json({ error: "배부 이력을 찾지 못했습니다." }, { status: 404 });
    if (await locked(before.period)) return Response.json({ error: "잠긴 마감월의 프로젝트 배부는 삭제할 수 없습니다." }, { status: 409 });
    await db.prepare("DELETE FROM finance_project_allocations WHERE id = ?").bind(id).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "PROJECT_ALLOCATION_REMOVED",
      entityType: "financeProjectAllocation", entityId: id, before, after: null, reason: String(body.reason ?? "배부 정정") });
    return Response.json({ id, removed: true });
  }
  if (action === "SET_STATUS") {
    const centerId = String(body.costCenterId ?? "").trim(); const status = String(body.status ?? "");
    const before = await db.prepare("SELECT * FROM finance_cost_centers WHERE id = ?").bind(centerId).first<CenterRow>();
    if (!before || !["ACTIVE","HOLD","CLOSED"].includes(status)) return Response.json({ error: "원가센터와 상태를 확인해 주세요." }, { status: 400 });
    const endDate = status === "CLOSED" ? String(body.endDate ?? financeCurrentData.asOf).trim() : before.end_date;
    if (endDate && !validDate(endDate)) return Response.json({ error: "종료일을 확인해 주세요." }, { status: 400 });
    await db.prepare("UPDATE finance_cost_centers SET status = ?, end_date = ?, updated_at = ? WHERE id = ?").bind(status, endDate, now, centerId).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "COST_CENTER_STATUS_UPDATED",
      entityType: "financeCostCenter", entityId: centerId, before, after: { ...before, status, end_date: endDate } });
    return Response.json({ id: centerId, status });
  }
  return Response.json({ error: "지원하지 않는 프로젝트 원가 작업입니다." }, { status: 400 });
}
