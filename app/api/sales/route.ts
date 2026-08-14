import { env } from "cloudflare:workers";
import { createApprovalRequest } from "../../approval-engine";
import { authorizeErpRequest, writeErpAudit } from "../../erp-platform";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;

type AccountRow = { id: string; name: string; business_number: string; industry: string; owner_employee_id: string; status: string; memo: string; created_at: number; updated_at: number; deleted_at: number | null };
type OpportunityRow = { id: string; account_id: string; title: string; owner_employee_id: string; stage: string; lead_type: string; expected_revenue: number; expected_cost: number; probability: number; expected_close_date: string; next_action: string; next_action_date: string; status: string; created_at: number; updated_at: number; deleted_at: number | null };
type SalesDocumentRow = { id: string; opportunity_id: string; document_type: string; document_number: string; version: number; amount: number; status: string; issued_date: string; due_date: string; created_at: number; updated_at: number; opportunity_title?: string | null; account_name?: string | null };
type RuleRow = { id: string; name: string; version: number; status: string; effective_from: string; effective_to: string; rules_json: string; approved_by: string; approved_at: number | null; created_at: number; updated_at: number };

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
      effective_from TEXT NOT NULL DEFAULT '', effective_to TEXT NOT NULL DEFAULT '', rules_json TEXT NOT NULL DEFAULT '{}',
      approved_by TEXT NOT NULL DEFAULT '', approved_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_documents (
      id TEXT PRIMARY KEY NOT NULL, opportunity_id TEXT NOT NULL, document_type TEXT NOT NULL,
      document_number TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, amount INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'DRAFT', issued_date TEXT NOT NULL DEFAULT '', due_date TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_accounts_owner_status ON sales_accounts(owner_employee_id, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_opportunities_owner_stage ON sales_opportunities(owner_employee_id, stage)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_documents_opportunity_type ON sales_documents(opportunity_id, document_type)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_documents_status_due ON sales_documents(status, due_date)"),
  ]);
}

const toAccount = (row: AccountRow) => ({ id: row.id, name: row.name, businessNumber: row.business_number, industry: row.industry, ownerEmployeeId: row.owner_employee_id, status: row.status, memo: row.memo });
const toOpportunity = (row: OpportunityRow, accountName = "") => ({ id: row.id, accountId: row.account_id, accountName, title: row.title, ownerEmployeeId: row.owner_employee_id, stage: row.stage, leadType: row.lead_type, expectedRevenue: row.expected_revenue, expectedCost: row.expected_cost, probability: row.probability, expectedCloseDate: row.expected_close_date, nextAction: row.next_action, nextActionDate: row.next_action_date, status: row.status });
const toSalesDocument = (row: SalesDocumentRow) => ({ id: row.id, opportunityId: row.opportunity_id, opportunityTitle: row.opportunity_title ?? "", accountName: row.account_name ?? "", documentType: row.document_type, documentNumber: row.document_number, version: row.version, amount: row.amount, status: row.status, issuedDate: row.issued_date, dueDate: row.due_date });
const toRule = (row: RuleRow) => ({ id: row.id, name: row.name, version: row.version, status: row.status, effectiveFrom: row.effective_from, effectiveTo: row.effective_to, rule: JSON.parse(row.rules_json || "{}"), approvedBy: row.approved_by, approvedAt: row.approved_at });

export async function GET() {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "sales", "read");
  if (authorization.response) return authorization.response;
  const [accounts, opportunities, documents, rules] = await Promise.all([
    db.prepare("SELECT * FROM sales_accounts WHERE deleted_at IS NULL ORDER BY name").all<AccountRow>(),
    db.prepare(`SELECT o.*, a.name AS account_name FROM sales_opportunities o
      LEFT JOIN sales_accounts a ON a.id = o.account_id WHERE o.deleted_at IS NULL
      ORDER BY CASE o.stage WHEN 'CONTRACT' THEN 1 WHEN 'PROPOSAL' THEN 2 WHEN 'DISCOVERY' THEN 3 ELSE 4 END, o.expected_close_date`).all<OpportunityRow & { account_name: string | null }>(),
    db.prepare(`SELECT d.*, o.title AS opportunity_title, a.name AS account_name FROM sales_documents d
      LEFT JOIN sales_opportunities o ON o.id = d.opportunity_id LEFT JOIN sales_accounts a ON a.id = o.account_id
      ORDER BY d.created_at DESC`).all<SalesDocumentRow>(),
    db.prepare("SELECT * FROM sales_incentive_rules ORDER BY version DESC, created_at DESC").all<RuleRow>(),
  ]);
  return Response.json({
    dataStatus: { crm: opportunities.results.length ? "MANUAL" : "NOT_CONNECTED", incentive: rules.results.some((row) => row.status === "ACTIVE") ? "APPROVED" : "UNVERIFIED" },
    accounts: accounts.results.map(toAccount),
    opportunities: opportunities.results.map((row) => toOpportunity(row, row.account_name ?? "미지정")),
    documents: documents.results.map(toSalesDocument),
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

  if (resource === "document") {
    const opportunityId = String(body.opportunityId ?? "").trim();
    const documentType = String(body.documentType ?? "").trim();
    const documentNumber = String(body.documentNumber ?? "").trim();
    const amount = Number(body.amount ?? 0);
    const issuedDate = String(body.issuedDate ?? "").trim();
    const dueDate = String(body.dueDate ?? "").trim();
    const opportunity = await db.prepare(`SELECT o.*, a.name AS account_name FROM sales_opportunities o
      LEFT JOIN sales_accounts a ON a.id = o.account_id WHERE o.id = ? AND o.deleted_at IS NULL`).bind(opportunityId).first<OpportunityRow & { account_name: string | null }>();
    if (!opportunity || !["QUOTE", "ORDER", "DELIVERY", "INVOICE", "PAYMENT"].includes(documentType) || !documentNumber || !Number.isFinite(amount) || amount < 0
      || (issuedDate && !/^\d{4}-\d{2}-\d{2}$/.test(issuedDate)) || (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate))) {
      return Response.json({ error: "영업 건·문서 종류·문서번호·금액·일자를 확인해 주세요." }, { status: 400 });
    }
    const latest = await db.prepare("SELECT MAX(version) AS version FROM sales_documents WHERE opportunity_id = ? AND document_type = ?")
      .bind(opportunityId, documentType).first<{ version: number | null }>();
    const version = (latest?.version ?? 0) + 1;
    await db.prepare(`INSERT INTO sales_documents
      (id, opportunity_id, document_type, document_number, version, amount, status, issued_date, due_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?)`)
      .bind(id, opportunityId, documentType, documentNumber, version, Math.round(amount), issuedDate, dueDate, now, now).run();
    const row = await db.prepare("SELECT * FROM sales_documents WHERE id = ?").bind(id).first<SalesDocumentRow>();
    const after = row ? toSalesDocument({ ...row, opportunity_title: opportunity.title, account_name: opportunity.account_name }) : body;
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SALES_DOCUMENT_CREATED", entityType: "salesDocument", entityId: id, after });
    return Response.json({ item: after }, { status: 201 });
  }

  return Response.json({ error: "지원하지 않는 영업 항목입니다." }, { status: 400 });
}

export async function PUT(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "sales", "write");
  if (authorization.response) return authorization.response;
  const body = await request.json() as Record<string, unknown>;
  const resource = String(body.resource ?? "opportunity");
  const id = String(body.id ?? "").trim();
  if (resource === "document") {
    const before = await db.prepare("SELECT * FROM sales_documents WHERE id = ?").bind(id).first<SalesDocumentRow>();
    if (!before) return Response.json({ error: "영업 문서를 찾을 수 없습니다." }, { status: 404 });
    const status = String(body.status ?? before.status);
    if (!["DRAFT", "ISSUED", "ACCEPTED", "COMPLETED", "CANCELLED"].includes(status)) return Response.json({ error: "올바르지 않은 문서 상태입니다." }, { status: 400 });
    if (status === "ACCEPTED" && before.status !== "ACCEPTED") {
      const existing = await db.prepare(`SELECT id, status FROM erp_approval_requests
        WHERE target_entity_type = 'SALES_DOCUMENT' AND target_entity_id = ?
        ORDER BY created_at DESC LIMIT 1`).bind(id).first<{ id: string; status: string }>();
      if (existing && ["SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED"].includes(existing.status)) {
        return Response.json({ item: toSalesDocument(before), approvalSubmitted: true, approvalId: existing.id }, { status: 202 });
      }
      const approval = await createApprovalRequest(db, authorization.principal, {
        module: "sales", requestType: before.document_type, title: `${before.document_number} ${before.document_type} 확정`,
        description: `영업 문서 v${before.version} · ${before.amount.toLocaleString("ko-KR")}원`,
        targetEntityType: "SALES_DOCUMENT", targetEntityId: id, amount: before.amount, dueDate: before.due_date,
        metadata: { documentNumber: before.document_number, documentType: before.document_type, version: before.version },
      });
      await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SALES_DOCUMENT_APPROVAL_SUBMITTED", entityType: "salesDocument", entityId: id, before: toSalesDocument(before), after: approval });
      return Response.json({ item: toSalesDocument(before), approvalSubmitted: true, approvalId: approval.id }, { status: 202 });
    }
    if (status === "COMPLETED" && before.status !== "ACCEPTED") return Response.json({ error: "승인 완료된 문서만 완료 처리할 수 있습니다." }, { status: 409 });
    await db.prepare("UPDATE sales_documents SET status = ?, updated_at = ? WHERE id = ?").bind(status, Date.now(), id).run();
    const after = await db.prepare("SELECT * FROM sales_documents WHERE id = ?").bind(id).first<SalesDocumentRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SALES_DOCUMENT_STATUS_UPDATED", entityType: "salesDocument", entityId: id, before: toSalesDocument(before), after: after ? toSalesDocument(after) : null });
    return Response.json({ item: after ? toSalesDocument(after) : null });
  }
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
