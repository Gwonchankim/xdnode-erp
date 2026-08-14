import { env } from "cloudflare:workers";
import { authorizeErpRequest, writeErpAudit } from "../../erp-platform";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;

type AccountRow = { id: string; name: string; business_number: string; industry: string; owner_employee_id: string; status: string; memo: string; created_at: number; updated_at: number; deleted_at: number | null };
type OpportunityRow = { id: string; account_id: string; title: string; owner_employee_id: string; stage: string; lead_type: string; expected_revenue: number; expected_cost: number; probability: number; expected_close_date: string; next_action: string; next_action_date: string; status: string; created_at: number; updated_at: number; deleted_at: number | null };
type RuleRow = { id: string; name: string; version: number; status: string; effective_from: string; effective_to: string; rule_json: string; approved_by: string; approved_at: number | null; created_at: number; updated_at: number };

async function ensureSchema() {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_accounts (
      id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, business_number TEXT NOT NULL DEFAULT '', industry TEXT NOT NULL DEFAULT '',
      owner_employee_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'ACTIVE', memo TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_opportunities (
      id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, title TEXT NOT NULL, owner_employee_id TEXT NOT NULL,
      stage TEXT NOT NULL DEFAULT 'LEAD', lead_type TEXT NOT NULL DEFAULT 'OUTBOUND', expected_revenue INTEGER NOT NULL DEFAULT 0,
      expected_cost INTEGER NOT NULL DEFAULT 0, probability INTEGER NOT NULL DEFAULT 0, expected_close_date TEXT NOT NULL DEFAULT '',
      next_action TEXT NOT NULL DEFAULT '', next_action_date TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'OPEN',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_incentive_rules (
      id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'DRAFT',
      effective_from TEXT NOT NULL DEFAULT '', effective_to TEXT NOT NULL DEFAULT '', rule_json TEXT NOT NULL DEFAULT '{}',
      approved_by TEXT NOT NULL DEFAULT '', approved_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_accounts_owner_status ON sales_accounts(owner_employee_id, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_opportunities_owner_stage ON sales_opportunities(owner_employee_id, stage)"),
  ]);
}

const toAccount = (row: AccountRow) => ({ id: row.id, name: row.name, businessNumber: row.business_number, industry: row.industry, ownerEmployeeId: row.owner_employee_id, status: row.status, memo: row.memo });
const toOpportunity = (row: OpportunityRow, accountName = "") => ({ id: row.id, accountId: row.account_id, accountName, title: row.title, ownerEmployeeId: row.owner_employee_id, stage: row.stage, leadType: row.lead_type, expectedRevenue: row.expected_revenue, expectedCost: row.expected_cost, probability: row.probability, expectedCloseDate: row.expected_close_date, nextAction: row.next_action, nextActionDate: row.next_action_date, status: row.status });
const toRule = (row: RuleRow) => ({ id: row.id, name: row.name, version: row.version, status: row.status, effectiveFrom: row.effective_from, effectiveTo: row.effective_to, rule: JSON.parse(row.rule_json || "{}"), approvedBy: row.approved_by, approvedAt: row.approved_at });

export async function GET() {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "sales", "read");
  if (authorization.response) return authorization.response;
  const [accounts, opportunities, rules] = await Promise.all([
    db.prepare("SELECT * FROM sales_accounts WHERE deleted_at IS NULL ORDER BY name").all<AccountRow>(),
    db.prepare(`SELECT o.*, a.name AS account_name FROM sales_opportunities o
      LEFT JOIN sales_accounts a ON a.id = o.account_id WHERE o.deleted_at IS NULL
      ORDER BY CASE o.stage WHEN 'CONTRACT' THEN 1 WHEN 'PROPOSAL' THEN 2 WHEN 'DISCOVERY' THEN 3 ELSE 4 END, o.expected_close_date`).all<OpportunityRow & { account_name: string | null }>(),
    db.prepare("SELECT * FROM sales_incentive_rules ORDER BY version DESC, created_at DESC").all<RuleRow>(),
  ]);
  return Response.json({
    dataStatus: { crm: opportunities.results.length ? "MANUAL" : "NOT_CONNECTED", incentive: rules.results.some((row) => row.status === "ACTIVE") ? "APPROVED" : "UNVERIFIED" },
    accounts: accounts.results.map(toAccount),
    opportunities: opportunities.results.map((row) => toOpportunity(row, row.account_name ?? "미지정")),
    incentiveRules: rules.results.map(toRule),
  });
}

export async function POST(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "sales", "write");
  if (authorization.response) return authorization.response;
  const body = await request.json() as Record<string, unknown>;
  const resource = String(body.resource ?? "");
  const now = Date.now();
  const id = crypto.randomUUID();

  if (resource === "account") {
    const name = String(body.name ?? "").trim();
    if (!name) return Response.json({ error: "거래처명이 필요합니다." }, { status: 400 });
    await db.prepare(`INSERT INTO sales_accounts (id, name, business_number, industry, owner_employee_id, status, memo, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, NULL)`)
      .bind(id, name, String(body.businessNumber ?? "").trim(), String(body.industry ?? "").trim(), authorization.principal.employeeId, String(body.memo ?? "").trim(), now, now).run();
    const row = await db.prepare("SELECT * FROM sales_accounts WHERE id = ?").bind(id).first<AccountRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "ACCOUNT_CREATED", entityType: "salesAccount", entityId: id, after: row ? toAccount(row) : body });
    return Response.json({ item: row ? toAccount(row) : null }, { status: 201 });
  }

  if (resource === "opportunity") {
    const accountId = String(body.accountId ?? "").trim();
    const title = String(body.title ?? "").trim();
    const expectedRevenue = Number(body.expectedRevenue ?? 0);
    const expectedCost = Number(body.expectedCost ?? 0);
    const account = await db.prepare("SELECT id, name FROM sales_accounts WHERE id = ? AND deleted_at IS NULL").bind(accountId).first<{ id: string; name: string }>();
    if (!account || !title || !Number.isFinite(expectedRevenue) || expectedRevenue < 0 || !Number.isFinite(expectedCost) || expectedCost < 0) return Response.json({ error: "거래처·영업 건명·금액을 확인해 주세요." }, { status: 400 });
    await db.prepare(`INSERT INTO sales_opportunities
      (id, account_id, title, owner_employee_id, stage, lead_type, expected_revenue, expected_cost, probability,
        expected_close_date, next_action, next_action_date, status, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, NULL)`)
      .bind(id, accountId, title, authorization.principal.employeeId, String(body.stage ?? "LEAD"), String(body.leadType ?? "OUTBOUND"),
        Math.round(expectedRevenue), Math.round(expectedCost), Math.min(100, Math.max(0, Number(body.probability ?? 10))),
        String(body.expectedCloseDate ?? ""), String(body.nextAction ?? ""), String(body.nextActionDate ?? ""), now, now).run();
    const row = await db.prepare("SELECT * FROM sales_opportunities WHERE id = ?").bind(id).first<OpportunityRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "OPPORTUNITY_CREATED", entityType: "salesOpportunity", entityId: id, after: row ? toOpportunity(row, account.name) : body });
    return Response.json({ item: row ? toOpportunity(row, account.name) : null }, { status: 201 });
  }

  return Response.json({ error: "지원하지 않는 영업 항목입니다." }, { status: 400 });
}

export async function PUT(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "sales", "write");
  if (authorization.response) return authorization.response;
  const body = await request.json() as Record<string, unknown>;
  const id = String(body.id ?? "").trim();
  const before = await db.prepare("SELECT * FROM sales_opportunities WHERE id = ? AND deleted_at IS NULL").bind(id).first<OpportunityRow>();
  if (!before) return Response.json({ error: "영업 건을 찾을 수 없습니다." }, { status: 404 });
  const stage = String(body.stage ?? before.stage);
  if (!["LEAD", "DISCOVERY", "PROPOSAL", "CONTRACT", "WON", "LOST"].includes(stage)) return Response.json({ error: "올바르지 않은 영업 단계입니다." }, { status: 400 });
  const status = ["WON", "LOST"].includes(stage) ? "CLOSED" : "OPEN";
  await db.prepare("UPDATE sales_opportunities SET stage = ?, status = ?, next_action = ?, next_action_date = ?, updated_at = ? WHERE id = ?")
    .bind(stage, status, String(body.nextAction ?? before.next_action), String(body.nextActionDate ?? before.next_action_date), Date.now(), id).run();
  const after = await db.prepare("SELECT * FROM sales_opportunities WHERE id = ?").bind(id).first<OpportunityRow>();
  await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "OPPORTUNITY_UPDATED", entityType: "salesOpportunity", entityId: id, before: toOpportunity(before), after: after ? toOpportunity(after) : null });
  return Response.json({ item: after ? toOpportunity(after) : null });
}
