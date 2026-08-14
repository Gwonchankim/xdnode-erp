import { env } from "cloudflare:workers";
import { createApprovalRequest } from "../../../approval-engine";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;
const formulaVersion = "SALES_FORECAST_V1";

type PlanRow = { id: string; year: number; version: number; name: string; status: string; created_by: string; approved_by: string; approved_at: number | null; created_at: number; updated_at: number };
type LineRow = { id: string; plan_id: string; scope_type: string; scope_key: string; scope_name: string; period: string; target_revenue: number; target_gross_profit: number; target_orders: number; created_at: number; updated_at: number };
type EmployeeRow = { employee_id: string; name: string; department: string; status: string };
type OpportunityRow = { id: string; owner_employee_id: string; expected_revenue: number; expected_cost: number; probability: number; expected_close_date: string; status: string };
type DocumentRow = { id: string; opportunity_id: string; document_type: string; amount: number; issued_date: string; owner_employee_id: string };
type SnapshotRow = { id: string; plan_id: string; as_of_date: string; version: number; formula_version: string; snapshot_json: string; created_by: string; created_at: number };
type Scope = { type: "COMPANY" | "DEPARTMENT" | "EMPLOYEE"; key: string; name: string };

async function ensureSchema() {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_target_plans (
      id TEXT PRIMARY KEY NOT NULL, year INTEGER NOT NULL, version INTEGER NOT NULL, name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT', created_by TEXT NOT NULL, approved_by TEXT NOT NULL DEFAULT '',
      approved_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_target_lines (
      id TEXT PRIMARY KEY NOT NULL, plan_id TEXT NOT NULL, scope_type TEXT NOT NULL, scope_key TEXT NOT NULL,
      scope_name TEXT NOT NULL, period TEXT NOT NULL, target_revenue INTEGER NOT NULL DEFAULT 0,
      target_gross_profit INTEGER NOT NULL DEFAULT 0, target_orders INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_forecast_snapshots (
      id TEXT PRIMARY KEY NOT NULL, plan_id TEXT NOT NULL, as_of_date TEXT NOT NULL, version INTEGER NOT NULL,
      formula_version TEXT NOT NULL, snapshot_json TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL)`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_target_plan_year_version ON sales_target_plans(year, version)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_target_plan_year_approved ON sales_target_plans(year) WHERE status = 'APPROVED'"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_target_line_scope_period ON sales_target_lines(plan_id, scope_type, scope_key, period)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_target_line_plan_period ON sales_target_lines(plan_id, period)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_forecast_plan_date_version ON sales_forecast_snapshots(plan_id, as_of_date, version)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_forecast_plan_created ON sales_forecast_snapshots(plan_id, created_at)"),
  ]);
}

const todayKst = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const toPlan = (row: PlanRow) => ({ id: row.id, year: row.year, version: row.version, name: row.name, status: row.status, createdBy: row.created_by, approvedBy: row.approved_by, approvedAt: row.approved_at });
const toLine = (row: LineRow) => ({ id: row.id, planId: row.plan_id, scopeType: row.scope_type, scopeKey: row.scope_key, scopeName: row.scope_name, period: row.period, targetRevenue: row.target_revenue, targetGrossProfit: row.target_gross_profit, targetOrders: row.target_orders });

async function buildPlanning(plan: PlanRow | null) {
  const year = plan?.year ?? new Date().getFullYear();
  const [lineResult, employeeResult, opportunityResult, documentResult] = await Promise.all([
    plan ? db.prepare("SELECT * FROM sales_target_lines WHERE plan_id = ? ORDER BY scope_type, scope_name, period").bind(plan.id).all<LineRow>() : Promise.resolve({ results: [] as LineRow[] }),
    db.prepare(`SELECT employee_id, name, department, status FROM hr_employee_records
      WHERE status NOT IN ('퇴직','입사 예정') ORDER BY department, name`).all<EmployeeRow>(),
    db.prepare(`SELECT id, owner_employee_id, expected_revenue, expected_cost, probability, expected_close_date, status
      FROM sales_opportunities WHERE deleted_at IS NULL`).all<OpportunityRow>(),
    db.prepare(`SELECT document.id, document.opportunity_id, document.document_type, document.amount, document.issued_date,
      opportunity.owner_employee_id FROM sales_documents document JOIN sales_opportunities opportunity ON opportunity.id = document.opportunity_id
      WHERE document.status IN ('ACCEPTED','COMPLETED') AND document.document_type IN ('ORDER','INVOICE')`).all<DocumentRow>(),
  ]);
  const employees = employeeResult.results;
  const employeeById = new Map(employees.map((employee) => [employee.employee_id, employee]));
  const departments = [...new Set(employees.map((employee) => employee.department).filter(Boolean))].sort((a, b) => a.localeCompare(b, "ko"));
  const scopes: Scope[] = [{ type: "COMPANY", key: "company", name: "회사 전체" },
    ...departments.map((department): Scope => ({ type: "DEPARTMENT", key: department, name: department })),
    ...employees.map((employee): Scope => ({ type: "EMPLOYEE", key: employee.employee_id, name: `${employee.name} · ${employee.department || "소속 미지정"}` }))];
  const invoicesByOpportunity = new Map<string, number>();
  for (const document of documentResult.results.filter((item) => item.document_type === "INVOICE")) invoicesByOpportunity.set(document.opportunity_id, (invoicesByOpportunity.get(document.opportunity_id) ?? 0) + document.amount);
  const matchesScope = (scope: Scope, employeeId: string) => scope.type === "COMPANY" || (scope.type === "EMPLOYEE" ? scope.key === employeeId : employeeById.get(employeeId)?.department === scope.key);
  const lineMap = new Map(lineResult.results.map((line) => [`${line.scope_type}:${line.scope_key}:${line.period}`, line]));
  const months = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
  const performance = scopes.map((scope) => {
    const monthly = months.map((period) => {
      const target = lineMap.get(`${scope.type}:${scope.key}:${period}`);
      const documents = documentResult.results.filter((document) => document.issued_date.startsWith(period) && matchesScope(scope, document.owner_employee_id));
      const actualRevenue = documents.filter((document) => document.document_type === "INVOICE").reduce((sum, document) => sum + document.amount, 0);
      const actualOrders = documents.filter((document) => document.document_type === "ORDER");
      const actualGrossProfit = documents.filter((document) => document.document_type === "INVOICE").reduce((sum, document) => {
        const opportunity = opportunityResult.results.find((item) => item.id === document.opportunity_id);
        const marginRate = opportunity?.expected_revenue ? Math.max(-1, Math.min(1, (opportunity.expected_revenue - opportunity.expected_cost) / opportunity.expected_revenue)) : 0;
        return sum + Math.round(document.amount * marginRate);
      }, 0);
      const pipelineRows = opportunityResult.results.filter((opportunity) => opportunity.status === "OPEN" && opportunity.expected_close_date.startsWith(period) && matchesScope(scope, opportunity.owner_employee_id));
      const weightedPipeline = pipelineRows.reduce((sum, opportunity) => sum + Math.round(Math.max(0, opportunity.expected_revenue - (invoicesByOpportunity.get(opportunity.id) ?? 0)) * opportunity.probability / 100), 0);
      const weightedPipelineGrossProfit = pipelineRows.reduce((sum, opportunity) => {
        const remaining = Math.max(0, opportunity.expected_revenue - (invoicesByOpportunity.get(opportunity.id) ?? 0));
        const marginRate = opportunity.expected_revenue ? Math.max(-1, Math.min(1, (opportunity.expected_revenue - opportunity.expected_cost) / opportunity.expected_revenue)) : 0;
        return sum + Math.round(remaining * opportunity.probability / 100 * marginRate);
      }, 0);
      return { period, targetRevenue: target?.target_revenue ?? 0, targetGrossProfit: target?.target_gross_profit ?? 0,
        targetOrders: target?.target_orders ?? 0, actualRevenue, actualGrossProfit, actualOrderRevenue: actualOrders.reduce((sum, item) => sum + item.amount, 0),
        actualOrders: actualOrders.length, weightedPipeline, forecastRevenue: actualRevenue + weightedPipeline,
        forecastGrossProfit: actualGrossProfit + weightedPipelineGrossProfit };
    });
    const annual = monthly.reduce((sum, month) => ({ targetRevenue: sum.targetRevenue + month.targetRevenue,
      targetGrossProfit: sum.targetGrossProfit + month.targetGrossProfit, targetOrders: sum.targetOrders + month.targetOrders,
      actualRevenue: sum.actualRevenue + month.actualRevenue, actualGrossProfit: sum.actualGrossProfit + month.actualGrossProfit,
      actualOrderRevenue: sum.actualOrderRevenue + month.actualOrderRevenue, actualOrders: sum.actualOrders + month.actualOrders,
      weightedPipeline: sum.weightedPipeline + month.weightedPipeline, forecastRevenue: sum.forecastRevenue + month.forecastRevenue,
      forecastGrossProfit: sum.forecastGrossProfit + month.forecastGrossProfit }),
    { targetRevenue: 0, targetGrossProfit: 0, targetOrders: 0, actualRevenue: 0, actualGrossProfit: 0, actualOrderRevenue: 0, actualOrders: 0, weightedPipeline: 0, forecastRevenue: 0, forecastGrossProfit: 0 });
    return { scope, monthly, annual, forecastAttainment: annual.targetRevenue > 0 ? Math.round(annual.forecastRevenue / annual.targetRevenue * 1000) / 10 : null };
  });
  return { year, formulaVersion, asOfDate: todayKst(), lines: lineResult.results.map(toLine), scopes, performance,
    sourceCounts: { opportunities: opportunityResult.results.length, documents: documentResult.results.length, employees: employees.length } };
}

export async function GET(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "sales", "read");
  if (authorization.response) return authorization.response;
  const search = new URL(request.url).searchParams; const requestedPlanId = search.get("planId")?.trim() ?? "";
  const requestedYear = Number(search.get("year") ?? new Date().getFullYear());
  const plans = await db.prepare("SELECT * FROM sales_target_plans ORDER BY year DESC, version DESC").all<PlanRow>();
  const plan = requestedPlanId ? plans.results.find((item) => item.id === requestedPlanId) ?? null
    : plans.results.find((item) => item.year === requestedYear && item.status === "APPROVED") ?? plans.results.find((item) => item.year === requestedYear) ?? null;
  const planning = await buildPlanning(plan);
  const snapshots = plan ? await db.prepare("SELECT * FROM sales_forecast_snapshots WHERE plan_id = ? ORDER BY created_at DESC LIMIT 2").bind(plan.id).all<SnapshotRow>() : { results: [] as SnapshotRow[] };
  return Response.json({ plans: plans.results.map(toPlan), activePlan: plan ? toPlan(plan) : null, ...planning,
    snapshots: snapshots.results.map((row) => ({ id: row.id, planId: row.plan_id, asOfDate: row.as_of_date, version: row.version,
      formulaVersion: row.formula_version, createdBy: row.created_by, createdAt: row.created_at,
      companyAnnual: (JSON.parse(row.snapshot_json) as { companyAnnual?: unknown }).companyAnnual ?? null })) });
}

export async function POST(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "sales", "write");
  if (authorization.response) return authorization.response;
  const body = await request.json() as Record<string, unknown>; const action = String(body.action ?? ""); const now = Date.now();
  if (action === "CREATE_PLAN") {
    const year = Number(body.year); const name = String(body.name ?? "").trim().slice(0, 200); const id = crypto.randomUUID();
    if (!Number.isInteger(year) || year < 2024 || year > 2100 || name.length < 3) return Response.json({ error: "계획 연도와 3자 이상의 계획명을 확인해 주세요." }, { status: 400 });
    const months = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
    try {
      const result = await db.batch([
        db.prepare(`INSERT INTO sales_target_plans (id, year, version, name, status, created_by, approved_by, approved_at, created_at, updated_at)
          SELECT ?, ?, COALESCE(MAX(version), 0) + 1, ?, 'DRAFT', ?, '', NULL, ?, ? FROM sales_target_plans WHERE year = ?`)
          .bind(id, year, name, authorization.principal.employeeId, now, now, year),
        ...months.map((period) => db.prepare(`INSERT INTO sales_target_lines
          (id, plan_id, scope_type, scope_key, scope_name, period, target_revenue, target_gross_profit, target_orders, created_at, updated_at)
          SELECT ?, ?, 'COMPANY', 'company', '회사 전체', ?, 0, 0, 0, ?, ? WHERE EXISTS (SELECT 1 FROM sales_target_plans WHERE id = ?)`)
          .bind(crypto.randomUUID(), id, period, now, now, id)),
      ]);
      if ((result[0].meta.changes ?? 0) < 1) return Response.json({ error: "계획 버전을 생성하지 못했습니다." }, { status: 409 });
    } catch (error) {
      if (String(error).includes("UNIQUE")) return Response.json({ error: "다른 사용자가 계획 버전을 먼저 생성했습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
      throw error;
    }
    const plan = await db.prepare("SELECT * FROM sales_target_plans WHERE id = ?").bind(id).first<PlanRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SALES_TARGET_PLAN_CREATED", entityType: "salesTargetPlan", entityId: id, after: plan ? toPlan(plan) : body });
    return Response.json({ item: plan ? toPlan(plan) : null }, { status: 201 });
  }
  const planId = String(body.planId ?? "").trim(); const plan = await db.prepare("SELECT * FROM sales_target_plans WHERE id = ?").bind(planId).first<PlanRow>();
  if (!plan) return Response.json({ error: "영업 목표 계획을 찾을 수 없습니다." }, { status: 404 });
  if (action === "UPSERT_LINE") {
    if (plan.status !== "DRAFT") return Response.json({ error: "작성 중인 목표 계획만 수정할 수 있습니다." }, { status: 409 });
    const scopeType = String(body.scopeType ?? ""); const scopeKey = String(body.scopeKey ?? "").trim(); const period = String(body.period ?? "");
    const targetRevenue = Number(body.targetRevenue ?? 0); const targetGrossProfit = Number(body.targetGrossProfit ?? 0); const targetOrders = Number(body.targetOrders ?? 0);
    if (!["COMPANY", "DEPARTMENT", "EMPLOYEE"].includes(scopeType) || !scopeKey || !new RegExp(`^${plan.year}-(0[1-9]|1[0-2])$`).test(period)
      || ![targetRevenue, targetGrossProfit, targetOrders].every(Number.isSafeInteger) || targetRevenue < 0 || targetGrossProfit < 0 || targetGrossProfit > targetRevenue || targetOrders < 0) {
      return Response.json({ error: "목표 범위·월·매출·매출총이익·수주 건수를 확인해 주세요." }, { status: 400 });
    }
    let scopeName = "회사 전체";
    if (scopeType === "COMPANY" && scopeKey !== "company") return Response.json({ error: "회사 목표 범위가 올바르지 않습니다." }, { status: 400 });
    if (scopeType === "DEPARTMENT") {
      const department = await db.prepare("SELECT department FROM hr_employee_records WHERE department = ? AND status NOT IN ('퇴직','입사 예정') LIMIT 1").bind(scopeKey).first<{ department: string }>();
      if (!department) return Response.json({ error: "현재 인사기록에 있는 조직만 선택할 수 있습니다." }, { status: 400 }); scopeName = department.department;
    }
    if (scopeType === "EMPLOYEE") {
      const employee = await db.prepare("SELECT name, department FROM hr_employee_records WHERE employee_id = ? AND status NOT IN ('퇴직','입사 예정')").bind(scopeKey).first<{ name: string; department: string }>();
      if (!employee) return Response.json({ error: "현재 재직 중인 담당자만 선택할 수 있습니다." }, { status: 400 }); scopeName = `${employee.name} · ${employee.department || "소속 미지정"}`;
    }
    const before = await db.prepare("SELECT * FROM sales_target_lines WHERE plan_id = ? AND scope_type = ? AND scope_key = ? AND period = ?").bind(planId, scopeType, scopeKey, period).first<LineRow>();
    const id = before?.id ?? crypto.randomUUID();
    await db.prepare(`INSERT INTO sales_target_lines
      (id, plan_id, scope_type, scope_key, scope_name, period, target_revenue, target_gross_profit, target_orders, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(plan_id, scope_type, scope_key, period) DO UPDATE SET scope_name = excluded.scope_name,
        target_revenue = excluded.target_revenue, target_gross_profit = excluded.target_gross_profit,
        target_orders = excluded.target_orders, updated_at = excluded.updated_at`)
      .bind(id, planId, scopeType, scopeKey, scopeName, period, targetRevenue, targetGrossProfit, targetOrders, now, now).run();
    const after = await db.prepare("SELECT * FROM sales_target_lines WHERE plan_id = ? AND scope_type = ? AND scope_key = ? AND period = ?").bind(planId, scopeType, scopeKey, period).first<LineRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: before ? "SALES_TARGET_LINE_UPDATED" : "SALES_TARGET_LINE_CREATED", entityType: "salesTargetLine", entityId: id, before: before ? toLine(before) : null, after: after ? toLine(after) : null });
    return Response.json({ item: after ? toLine(after) : null });
  }
  if (action === "SUBMIT_PLAN") {
    if (plan.status !== "DRAFT") return Response.json({ error: "작성 중인 계획만 결재할 수 있습니다." }, { status: 409 });
    const companyTargets = await db.prepare(`SELECT COUNT(*) AS months, COALESCE(SUM(target_revenue), 0) AS revenue
      FROM sales_target_lines WHERE plan_id = ? AND scope_type = 'COMPANY' AND scope_key = 'company'`).bind(planId).first<{ months: number; revenue: number }>();
    if (Number(companyTargets?.months ?? 0) !== 12 || Number(companyTargets?.revenue ?? 0) <= 0) return Response.json({ error: "회사 전체 12개월 목표와 0원보다 큰 연간 매출 목표가 필요합니다." }, { status: 400 });
    const existing = await db.prepare(`SELECT id FROM erp_approval_requests WHERE target_entity_type = 'SALES_TARGET_PLAN' AND target_entity_id = ?
      AND status IN ('SUBMITTED','IN_REVIEW','CHANGES_REQUESTED') LIMIT 1`).bind(planId).first<{ id: string }>();
    if (existing) return Response.json({ approvalId: existing.id, status: "SUBMITTED" }, { status: 202 });
    const approval = await createApprovalRequest(db, authorization.principal, { module: "sales", requestType: "TARGET_PLAN",
      title: `${plan.year}년 영업 목표 v${plan.version} 승인`, description: plan.name, targetEntityType: "SALES_TARGET_PLAN", targetEntityId: plan.id,
      amount: Number(companyTargets?.revenue ?? 0), metadata: { year: plan.year, version: plan.version, formulaVersion } });
    const update = await db.prepare("UPDATE sales_target_plans SET status = 'SUBMITTED', updated_at = ? WHERE id = ? AND status = 'DRAFT'").bind(now, planId).run();
    if ((update.meta.changes ?? 0) < 1) return Response.json({ error: "계획 상태가 변경되었습니다. 새로고침 후 다시 확인해 주세요." }, { status: 409 });
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SALES_TARGET_PLAN_SUBMITTED", entityType: "salesTargetPlan", entityId: planId, before: toPlan(plan), after: { status: "SUBMITTED", approvalId: approval.id } });
    return Response.json({ approvalId: approval.id, status: "SUBMITTED" }, { status: 202 });
  }
  if (action === "SNAPSHOT") {
    if (plan.status !== "APPROVED") return Response.json({ error: "승인된 목표 계획만 전망 스냅샷을 저장할 수 있습니다." }, { status: 409 });
    const planning = await buildPlanning(plan); const company = planning.performance.find((item) => item.scope.type === "COMPANY");
    const asOfDate = todayKst(); const id = crypto.randomUUID(); const snapshot = JSON.stringify({ ...planning, companyAnnual: company?.annual ?? null });
    try {
      await db.prepare(`INSERT INTO sales_forecast_snapshots
        (id, plan_id, as_of_date, version, formula_version, snapshot_json, created_by, created_at)
        SELECT ?, ?, ?, COALESCE(MAX(version), 0) + 1, ?, ?, ?, ? FROM sales_forecast_snapshots WHERE plan_id = ? AND as_of_date = ?`)
        .bind(id, planId, asOfDate, formulaVersion, snapshot, authorization.principal.employeeId, now, planId, asOfDate).run();
    } catch (error) {
      if (String(error).includes("UNIQUE")) return Response.json({ error: "다른 사용자가 전망 버전을 먼저 저장했습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
      throw error;
    }
    const row = await db.prepare("SELECT * FROM sales_forecast_snapshots WHERE id = ?").bind(id).first<SnapshotRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SALES_FORECAST_SNAPSHOT_CREATED", entityType: "salesForecastSnapshot", entityId: id, after: { planId, asOfDate, version: row?.version, formulaVersion } });
    return Response.json({ id, planId, asOfDate, version: row?.version, formulaVersion }, { status: 201 });
  }
  return Response.json({ error: "지원하지 않는 영업 목표·전망 작업입니다." }, { status: 400 });
}
