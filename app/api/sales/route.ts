import { env } from "cloudflare:workers";
import { createApprovalRequest } from "../../approval-engine";
import { authorizeErpRequest, writeErpAudit } from "../../erp-platform";
import { ensureSalesPricingSchema, evaluateSalesDocumentPricing, getSalesPricingGate } from "../../sales-pricing";
import { ensureSalesContractSchema, getSalesContractGate } from "../../sales-contracts";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;
const partnerKey = (name: string, businessNumber: string) => businessNumber.replace(/\D/g, "") || name.toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
const accountIdentityKey = (name: string, businessNumber: string) => businessNumber.replace(/\D/g, "")
  ? `business:${businessNumber.replace(/\D/g, "")}`
  : `name:${name.toLowerCase().replace(/[^0-9a-z가-힣]/g, "")}`;

type AccountRow = { id: string; name: string; business_number: string; industry: string; owner_employee_id: string; status: string; memo: string; created_at: number; updated_at: number; deleted_at: number | null };
type OpportunityRow = { id: string; account_id: string; title: string; owner_employee_id: string; stage: string; lead_type: string; expected_revenue: number; expected_cost: number; probability: number; expected_close_date: string; next_action: string; next_action_date: string; status: string; created_at: number; updated_at: number; deleted_at: number | null };
type SalesDocumentRow = { id: string; opportunity_id: string; document_type: string; document_number: string; version: number; amount: number; status: string; issued_date: string; due_date: string; source_document_id: string; created_at: number; updated_at: number; opportunity_title?: string | null; account_name?: string | null; reserved_amount?: number | null; collected_amount?: number | null; linked_invoice_id?: string | null; linked_invoice_number?: string | null; source_document_number?: string | null };
type CatalogItemRow = { id: string; code: string; name: string; item_type: string; unit: string; default_unit_price: number; status: string; created_by: string; created_at: number; updated_at: number };
type DocumentLineRow = { id: string; document_id: string; line_number: number; catalog_item_id: string; description: string; quantity: number; unit: string; unit_price: number; amount: number; source_line_id: string; created_at: number; catalog_code?: string | null; catalog_name?: string | null; ordered_quantity?: number | null; delivered_quantity?: number | null; invoiced_quantity?: number | null };
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
      status TEXT NOT NULL DEFAULT 'DRAFT', issued_date TEXT NOT NULL DEFAULT '', due_date TEXT NOT NULL DEFAULT '', source_document_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_catalog_items (
      id TEXT PRIMARY KEY NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, item_type TEXT NOT NULL,
      unit TEXT NOT NULL DEFAULT 'EA', default_unit_price INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ACTIVE',
      created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_document_lines (
      id TEXT PRIMARY KEY NOT NULL, document_id TEXT NOT NULL, line_number INTEGER NOT NULL, catalog_item_id TEXT NOT NULL,
      description TEXT NOT NULL, quantity REAL NOT NULL, unit TEXT NOT NULL, unit_price INTEGER NOT NULL,
      amount INTEGER NOT NULL, source_line_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_payment_allocations (
      id TEXT PRIMARY KEY NOT NULL, payment_document_id TEXT NOT NULL, invoice_document_id TEXT NOT NULL,
      amount INTEGER NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_account_contacts (
      id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, contact_key TEXT NOT NULL, name TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
      is_primary INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ACTIVE', created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_account_identity_keys (
      identity_key TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, is_primary INTEGER NOT NULL DEFAULT 1,
      origin_account_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_opportunity_activities (
      id TEXT PRIMARY KEY NOT NULL, opportunity_id TEXT NOT NULL, contact_id TEXT NOT NULL DEFAULT '',
      activity_type TEXT NOT NULL, occurred_at TEXT NOT NULL, summary TEXT NOT NULL,
      next_action TEXT NOT NULL DEFAULT '', next_action_date TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_opportunity_stage_history (
      id TEXT PRIMARY KEY NOT NULL, opportunity_id TEXT NOT NULL, from_stage TEXT NOT NULL DEFAULT '',
      to_stage TEXT NOT NULL, reason TEXT NOT NULL, changed_by TEXT NOT NULL, changed_at INTEGER NOT NULL)`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_accounts_owner_status ON sales_accounts(owner_employee_id, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_opportunities_owner_stage ON sales_opportunities(owner_employee_id, stage)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_documents_opportunity_type ON sales_documents(opportunity_id, document_type)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_documents_status_due ON sales_documents(status, due_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_documents_source ON sales_documents(source_document_id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_catalog_code ON sales_catalog_items(code)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_catalog_status_name ON sales_catalog_items(status, name)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_document_line_number ON sales_document_lines(document_id, line_number)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_document_line_source ON sales_document_lines(source_line_id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_payment_allocation_payment ON sales_payment_allocations(payment_document_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_payment_allocation_invoice ON sales_payment_allocations(invoice_document_id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_contact_account_key ON sales_account_contacts(account_id, contact_key)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_contact_account_status ON sales_account_contacts(account_id, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_account_identity_account ON sales_account_identity_keys(account_id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_account_identity_primary ON sales_account_identity_keys(account_id) WHERE is_primary = 1"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_activity_opportunity_occurred ON sales_opportunity_activities(opportunity_id, occurred_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_stage_history_opportunity_changed ON sales_opportunity_stage_history(opportunity_id, changed_at)"),
  ]);
  await ensureSalesPricingSchema(db);
  await ensureSalesContractSchema(db);
}

const toAccount = (row: AccountRow) => ({ id: row.id, name: row.name, businessNumber: row.business_number, industry: row.industry, ownerEmployeeId: row.owner_employee_id, status: row.status, memo: row.memo });
const toOpportunity = (row: OpportunityRow, accountName = "") => ({ id: row.id, accountId: row.account_id, accountName, title: row.title, ownerEmployeeId: row.owner_employee_id, stage: row.stage, leadType: row.lead_type, expectedRevenue: row.expected_revenue, expectedCost: row.expected_cost, probability: row.probability, expectedCloseDate: row.expected_close_date, nextAction: row.next_action, nextActionDate: row.next_action_date, status: row.status });
const toSalesDocument = (row: SalesDocumentRow) => ({
  id: row.id, opportunityId: row.opportunity_id, opportunityTitle: row.opportunity_title ?? "", accountName: row.account_name ?? "",
  documentType: row.document_type, documentNumber: row.document_number, version: row.version, amount: row.amount,
  status: row.status, issuedDate: row.issued_date, dueDate: row.due_date,
  sourceDocumentId: row.source_document_id, sourceDocumentNumber: row.source_document_number ?? "",
  reservedAmount: Number(row.reserved_amount ?? 0), collectedAmount: Number(row.collected_amount ?? 0),
  outstandingAmount: row.document_type === "INVOICE" ? Math.max(0, row.amount - Number(row.collected_amount ?? 0)) : 0,
  linkedInvoiceId: row.linked_invoice_id ?? "", linkedInvoiceNumber: row.linked_invoice_number ?? "",
});
const toCatalogItem = (row: CatalogItemRow) => ({ id: row.id, code: row.code, name: row.name, itemType: row.item_type, unit: row.unit, defaultUnitPrice: row.default_unit_price, status: row.status });
const toDocumentLine = (row: DocumentLineRow) => ({
  id: row.id, documentId: row.document_id, lineNumber: row.line_number, catalogItemId: row.catalog_item_id,
  catalogCode: row.catalog_code ?? "", catalogName: row.catalog_name ?? "", description: row.description,
  quantity: row.quantity, unit: row.unit, unitPrice: row.unit_price, amount: row.amount, sourceLineId: row.source_line_id,
  orderedQuantity: Number(row.ordered_quantity ?? 0), deliveredQuantity: Number(row.delivered_quantity ?? 0), invoicedQuantity: Number(row.invoiced_quantity ?? 0),
});

const documentSelect = `SELECT d.*, o.title AS opportunity_title, a.name AS account_name,
  COALESCE((SELECT SUM(allocation.amount) FROM sales_payment_allocations allocation
    JOIN sales_documents payment ON payment.id = allocation.payment_document_id
    WHERE allocation.invoice_document_id = d.id AND payment.status <> 'CANCELLED'), 0) AS reserved_amount,
  COALESCE((SELECT SUM(allocation.amount) FROM sales_payment_allocations allocation
    JOIN sales_documents payment ON payment.id = allocation.payment_document_id
    WHERE allocation.invoice_document_id = d.id AND payment.status IN ('ACCEPTED','COMPLETED')), 0) AS collected_amount,
  allocation.invoice_document_id AS linked_invoice_id, invoice.document_number AS linked_invoice_number,
  source.document_number AS source_document_number
  FROM sales_documents d
  LEFT JOIN sales_opportunities o ON o.id = d.opportunity_id
  LEFT JOIN sales_accounts a ON a.id = o.account_id
  LEFT JOIN sales_payment_allocations allocation ON allocation.payment_document_id = d.id
  LEFT JOIN sales_documents invoice ON invoice.id = allocation.invoice_document_id
  LEFT JOIN sales_documents source ON source.id = d.source_document_id`;
const documentLineSelect = `SELECT line.*, catalog.code AS catalog_code, catalog.name AS catalog_name,
  COALESCE((SELECT SUM(child_line.quantity) FROM sales_document_lines child_line JOIN sales_documents child ON child.id = child_line.document_id
    WHERE child_line.source_line_id = line.id AND child.document_type = 'ORDER' AND child.status <> 'CANCELLED'), 0) AS ordered_quantity,
  COALESCE((SELECT SUM(child_line.quantity) FROM sales_document_lines child_line JOIN sales_documents child ON child.id = child_line.document_id
    WHERE child_line.source_line_id = line.id AND child.document_type = 'DELIVERY' AND child.status <> 'CANCELLED'), 0) AS delivered_quantity,
  COALESCE((SELECT SUM(child_line.quantity) FROM sales_document_lines child_line JOIN sales_documents child ON child.id = child_line.document_id
    WHERE child_line.source_line_id = line.id AND child.document_type = 'INVOICE' AND child.status <> 'CANCELLED'), 0) AS invoiced_quantity
  FROM sales_document_lines line
  LEFT JOIN sales_catalog_items catalog ON catalog.id = line.catalog_item_id`;
const toRule = (row: RuleRow) => ({ id: row.id, name: row.name, version: row.version, status: row.status, effectiveFrom: row.effective_from, effectiveTo: row.effective_to, rule: JSON.parse(row.rules_json || "{}"), approvedBy: row.approved_by, approvedAt: row.approved_at });

export async function GET() {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "sales", "read");
  if (authorization.response) return authorization.response;
  const [accounts, opportunities, documents, rules, catalog, documentLines] = await Promise.all([
    db.prepare("SELECT * FROM sales_accounts WHERE deleted_at IS NULL ORDER BY name").all<AccountRow>(),
    db.prepare(`SELECT o.*, a.name AS account_name FROM sales_opportunities o
      LEFT JOIN sales_accounts a ON a.id = o.account_id WHERE o.deleted_at IS NULL
      ORDER BY CASE o.stage WHEN 'CONTRACT' THEN 1 WHEN 'PROPOSAL' THEN 2 WHEN 'DISCOVERY' THEN 3 ELSE 4 END, o.expected_close_date`).all<OpportunityRow & { account_name: string | null }>(),
    db.prepare(`${documentSelect} ORDER BY d.created_at DESC`).all<SalesDocumentRow>(),
    db.prepare("SELECT * FROM sales_incentive_rules ORDER BY version DESC, created_at DESC").all<RuleRow>(),
    db.prepare("SELECT * FROM sales_catalog_items ORDER BY CASE status WHEN 'ACTIVE' THEN 1 ELSE 2 END, name").all<CatalogItemRow>(),
    db.prepare(`${documentLineSelect} ORDER BY line.document_id, line.line_number`).all<DocumentLineRow>(),
  ]);
  const linesByDocument = new Map<string, ReturnType<typeof toDocumentLine>[]>();
  for (const row of documentLines.results) {
    const items = linesByDocument.get(row.document_id) ?? []; items.push(toDocumentLine(row)); linesByDocument.set(row.document_id, items);
  }
  return Response.json({
    dataStatus: { crm: opportunities.results.length ? "MANUAL" : "NOT_CONNECTED", incentive: rules.results.some((row) => row.status === "ACTIVE") ? "APPROVED" : "UNVERIFIED" },
    accounts: accounts.results.map(toAccount),
    opportunities: opportunities.results.map((row) => toOpportunity(row, row.account_name ?? "미지정")),
    documents: documents.results.map((row) => ({ ...toSalesDocument(row), lines: linesByDocument.get(row.id) ?? [] })),
    catalog: catalog.results.map(toCatalogItem),
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
    const businessNumber = String(body.businessNumber ?? "").trim();
    if (!name) return Response.json({ error: "거래처명이 필요합니다." }, { status: 400 });
    const identityKey = accountIdentityKey(name, businessNumber);
    const normalizedKey = partnerKey(name, businessNumber);
    const masterId = `partner:${normalizedKey}`;
    try {
      await db.batch([
        db.prepare(`INSERT INTO sales_accounts (id, name, business_number, industry, owner_employee_id, status, memo, created_at, updated_at, deleted_at)
          VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, NULL)`)
          .bind(id, name, businessNumber, String(body.industry ?? "").trim(), authorization.principal.employeeId, String(body.memo ?? "").trim(), now, now),
        db.prepare(`INSERT INTO sales_account_identity_keys (identity_key, account_id, is_primary, origin_account_id, created_at)
          VALUES (?, ?, 1, ?, ?)`)
          .bind(identityKey, id, id, now),
        db.prepare(`INSERT OR IGNORE INTO finance_master_partners
          (id, canonical_name, normalized_key, business_number, partner_type, payment_terms_days, status, source, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'CUSTOMER', 30, 'ACTIVE', 'SALES', ?, ?, ?)`)
          .bind(masterId, name, normalizedKey, businessNumber, authorization.principal.employeeId, now, now),
        db.prepare(`INSERT OR IGNORE INTO finance_master_partner_aliases
          (id, mapping_key, source_system, source_entity_id, source_name, partner_id, created_at, updated_at)
          SELECT ?, ?, 'SALES', ?, ?, id, ?, ? FROM finance_master_partners WHERE normalized_key = ?`)
          .bind(`alias:SALES:${id}`, `SALES:${id}`, id, name, now, now, normalizedKey),
        db.prepare("UPDATE finance_master_partners SET partner_type = CASE WHEN partner_type = 'VENDOR' THEN 'BOTH' ELSE partner_type END, updated_at = ? WHERE normalized_key = ?")
          .bind(now, normalizedKey),
      ]);
    } catch (error) {
      if (String(error).includes("UNIQUE")) return Response.json({ error: "같은 사업자번호 또는 거래처명의 거래처가 이미 있습니다." }, { status: 409 });
      throw error;
    }
    const row = await db.prepare("SELECT * FROM sales_accounts WHERE id = ?").bind(id).first<AccountRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "ACCOUNT_CREATED", entityType: "salesAccount", entityId: id, after: row ? toAccount(row) : body });
    return Response.json({ item: row ? toAccount(row) : null }, { status: 201 });
  }

  if (resource === "opportunity") {
    const accountId = String(body.accountId ?? "").trim();
    const title = String(body.title ?? "").trim();
    const expectedRevenue = Number(body.expectedRevenue ?? 0);
    const expectedCost = Number(body.expectedCost ?? 0);
    const account = await db.prepare("SELECT id, name FROM sales_accounts WHERE id = ? AND status = 'ACTIVE' AND deleted_at IS NULL").bind(accountId).first<{ id: string; name: string }>();
    if (!account || !title || !Number.isFinite(expectedRevenue) || expectedRevenue < 0 || !Number.isFinite(expectedCost) || expectedCost < 0) return Response.json({ error: "거래처·영업 건명·금액을 확인해 주세요." }, { status: 400 });
    await db.batch([
      db.prepare(`INSERT INTO sales_opportunities
        (id, account_id, title, owner_employee_id, stage, lead_type, expected_revenue, expected_cost, probability,
          expected_close_date, next_action, next_action_date, status, created_at, updated_at, deleted_at)
        VALUES (?, ?, ?, ?, 'LEAD', ?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, NULL)`)
        .bind(id, accountId, title, authorization.principal.employeeId, String(body.leadType ?? "OUTBOUND"),
          Math.round(expectedRevenue), Math.round(expectedCost), Math.min(100, Math.max(0, Number(body.probability ?? 10))),
          String(body.expectedCloseDate ?? ""), String(body.nextAction ?? ""), String(body.nextActionDate ?? ""), now, now),
      db.prepare(`INSERT INTO sales_opportunity_stage_history
        (id, opportunity_id, from_stage, to_stage, reason, changed_by, changed_at)
        VALUES (?, ?, '', 'LEAD', '영업 기회 등록', ?, ?)`)
        .bind(crypto.randomUUID(), id, authorization.principal.employeeId, now),
    ]);
    const row = await db.prepare("SELECT * FROM sales_opportunities WHERE id = ?").bind(id).first<OpportunityRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "OPPORTUNITY_CREATED", entityType: "salesOpportunity", entityId: id, after: row ? toOpportunity(row, account.name) : body });
    return Response.json({ item: row ? toOpportunity(row, account.name) : null }, { status: 201 });
  }

  if (resource === "catalog") {
    const code = String(body.code ?? "").trim().toUpperCase().replace(/\s+/g, "-").slice(0, 50);
    const name = String(body.name ?? "").trim().slice(0, 200);
    const itemType = String(body.itemType ?? "").trim();
    const unit = String(body.unit ?? "EA").trim().toUpperCase().slice(0, 20);
    const defaultUnitPrice = Number(body.defaultUnitPrice ?? 0);
    if (!code || name.length < 2 || !["PRODUCT", "SERVICE"].includes(itemType) || !unit || !Number.isSafeInteger(defaultUnitPrice) || defaultUnitPrice < 0) {
      return Response.json({ error: "품목 코드·명칭·유형·단위·기본단가를 확인해 주세요." }, { status: 400 });
    }
    try {
      await db.prepare(`INSERT INTO sales_catalog_items
        (id, code, name, item_type, unit, default_unit_price, status, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`)
        .bind(id, code, name, itemType, unit, defaultUnitPrice, authorization.principal.employeeId, now, now).run();
    } catch (error) {
      if (String(error).includes("UNIQUE")) return Response.json({ error: "이미 사용 중인 품목 코드입니다." }, { status: 409 });
      throw error;
    }
    const row = await db.prepare("SELECT * FROM sales_catalog_items WHERE id = ?").bind(id).first<CatalogItemRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SALES_CATALOG_ITEM_CREATED", entityType: "salesCatalogItem", entityId: id, after: row ? toCatalogItem(row) : body });
    return Response.json({ item: row ? toCatalogItem(row) : null }, { status: 201 });
  }

  if (resource === "document") {
    const opportunityId = String(body.opportunityId ?? "").trim();
    const documentType = String(body.documentType ?? "").trim();
    const documentNumber = String(body.documentNumber ?? "").trim();
    const requestedAmount = Number(body.amount ?? 0);
    const sourceDocumentId = String(body.sourceDocumentId ?? "").trim();
    const issuedDate = String(body.issuedDate ?? "").trim();
    const dueDate = String(body.dueDate ?? "").trim();
    const opportunity = await db.prepare(`SELECT o.*, a.name AS account_name FROM sales_opportunities o
      LEFT JOIN sales_accounts a ON a.id = o.account_id WHERE o.id = ? AND o.deleted_at IS NULL`).bind(opportunityId).first<OpportunityRow & { account_name: string | null }>();
    if (!opportunity || !["QUOTE", "ORDER", "DELIVERY", "INVOICE", "PAYMENT"].includes(documentType) || !documentNumber
      || (issuedDate && !/^\d{4}-\d{2}-\d{2}$/.test(issuedDate)) || (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate))) {
      return Response.json({ error: "영업 건·문서 종류·문서번호·일자를 확인해 주세요." }, { status: 400 });
    }
    const latest = await db.prepare("SELECT MAX(version) AS version FROM sales_documents WHERE opportunity_id = ? AND document_type = ?")
      .bind(opportunityId, documentType).first<{ version: number | null }>();
    const version = (latest?.version ?? 0) + 1;
    if (documentType === "PAYMENT") {
      const invoiceDocumentId = String(body.invoiceDocumentId ?? "").trim();
      const invoice = await db.prepare(`SELECT * FROM sales_documents WHERE id = ? AND opportunity_id = ?
        AND document_type = 'INVOICE' AND status IN ('ACCEPTED','COMPLETED')`)
        .bind(invoiceDocumentId, opportunityId).first<SalesDocumentRow>();
      if (!invoice || !Number.isSafeInteger(requestedAmount) || requestedAmount <= 0 || !issuedDate) return Response.json({ error: "확정된 대상 청구서·수금액·수금일을 확인해 주세요." }, { status: 400 });
      const allocationId = crypto.randomUUID();
      const result = await db.batch([
        db.prepare(`INSERT INTO sales_documents
          (id, opportunity_id, document_type, document_number, version, amount, status, issued_date, due_date, created_at, updated_at)
          SELECT ?, ?, 'PAYMENT', ?, ?, ?, 'DRAFT', ?, '', ?, ?
          WHERE ? <= (SELECT invoice.amount - COALESCE(SUM(CASE WHEN payment.id IS NOT NULL THEN allocation.amount ELSE 0 END), 0)
            FROM sales_documents invoice
            LEFT JOIN sales_payment_allocations allocation ON allocation.invoice_document_id = invoice.id
            LEFT JOIN sales_documents payment ON payment.id = allocation.payment_document_id AND payment.status <> 'CANCELLED'
            WHERE invoice.id = ? GROUP BY invoice.id)`)
          .bind(id, opportunityId, documentNumber, version, requestedAmount, issuedDate, now, now, requestedAmount, invoiceDocumentId),
        db.prepare(`INSERT INTO sales_payment_allocations
          (id, payment_document_id, invoice_document_id, amount, created_by, created_at, updated_at)
          SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM sales_documents WHERE id = ? AND document_type = 'PAYMENT')`)
          .bind(allocationId, id, invoiceDocumentId, requestedAmount, authorization.principal.employeeId, now, now, id),
      ]);
      if ((result[0].meta.changes ?? 0) < 1 || (result[1].meta.changes ?? 0) < 1) {
        return Response.json({ error: "다른 수금 등록으로 청구 잔액이 변경되었습니다. 새로고침 후 다시 확인해 주세요." }, { status: 409 });
      }
    } else {
      const rawLines = Array.isArray(body.lines) ? body.lines.slice(0, 50) as Array<Record<string, unknown>> : [];
      if (!rawLines.length) return Response.json({ error: "견적·수주·납품·청구 문서에는 품목 라인이 한 개 이상 필요합니다." }, { status: 400 });
      const sourceTypeRules: Record<string, string[]> = { QUOTE: [], ORDER: ["QUOTE"], DELIVERY: ["ORDER"], INVOICE: ["ORDER", "DELIVERY"] };
      if (["DELIVERY", "INVOICE"].includes(documentType) && !sourceDocumentId) return Response.json({ error: "납품·청구 문서는 승인된 상위 문서를 선택해야 합니다." }, { status: 400 });
      if (documentType === "QUOTE" && sourceDocumentId) return Response.json({ error: "견적 문서는 상위 문서를 연결할 수 없습니다." }, { status: 400 });
      const source = sourceDocumentId ? await db.prepare(`SELECT * FROM sales_documents WHERE id = ? AND opportunity_id = ?
        AND status IN ('ACCEPTED','COMPLETED')`).bind(sourceDocumentId, opportunityId).first<SalesDocumentRow>() : null;
      if (sourceDocumentId && (!source || !sourceTypeRules[documentType].includes(source.document_type))) {
        return Response.json({ error: "같은 영업 건의 승인·완료된 올바른 상위 문서를 선택해 주세요." }, { status: 400 });
      }
      if (documentType === "ORDER" && source?.document_type === "QUOTE") {
        const pricingGate = await getSalesPricingGate(db, source.id);
        if (!pricingGate.canProceed) return Response.json({ error: "가격 검토를 통과하거나 예외 승인을 받은 견적만 수주로 전환할 수 있습니다." }, { status: 409 });
      }
      if ((documentType === "DELIVERY" || documentType === "INVOICE") && source?.document_type === "ORDER") {
        const contractGate = await getSalesContractGate(db, source.id);
        if (!contractGate.canProceed) return Response.json({ error: contractGate.reason }, { status: 409 });
      }
      const catalogRows = await db.prepare("SELECT * FROM sales_catalog_items").all<CatalogItemRow>();
      const catalogById = new Map(catalogRows.results.map((item) => [item.id, item]));
      const sourceRows = sourceDocumentId ? await db.prepare("SELECT * FROM sales_document_lines WHERE document_id = ? ORDER BY line_number").bind(sourceDocumentId).all<DocumentLineRow>() : { results: [] as DocumentLineRow[] };
      const sourceById = new Map(sourceRows.results.map((line) => [line.id, line]));
      const seenSourceLines = new Set<string>();
      let lines: Array<{ id: string; lineNumber: number; catalogItemId: string; description: string; quantity: number; unit: string; unitPrice: number; amount: number; sourceLineId: string }>;
      try {
        lines = rawLines.map((line, index) => {
          const sourceLineId = String(line.sourceLineId ?? "").trim();
          const sourceLine = sourceLineId ? sourceById.get(sourceLineId) : undefined;
          const catalogItemId = sourceLine?.catalog_item_id ?? String(line.catalogItemId ?? "").trim();
          const catalogItem = catalogById.get(catalogItemId);
          const quantity = Number(line.quantity ?? 0);
          const unitPrice = sourceLine?.unit_price ?? Number(line.unitPrice ?? catalogItem?.default_unit_price ?? 0);
          if (!catalogItem || (!sourceLine && catalogItem.status !== "ACTIVE") || !Number.isFinite(quantity) || quantity <= 0 || !Number.isSafeInteger(unitPrice) || unitPrice < 0) throw new Error(`INVALID_LINE:${index + 1}`);
          if (sourceDocumentId && (!sourceLine || seenSourceLines.has(sourceLineId))) throw new Error(`INVALID_SOURCE_LINE:${index + 1}`);
          if (sourceLineId) seenSourceLines.add(sourceLineId);
          return { id: crypto.randomUUID(), lineNumber: index + 1, catalogItemId, description: sourceLine?.description ?? catalogItem.name,
            quantity, unit: sourceLine?.unit ?? catalogItem.unit, unitPrice, amount: Math.round(quantity * unitPrice), sourceLineId };
        });
      } catch {
        return Response.json({ error: "품목, 수량, 단가 또는 상위 문서 라인을 확인해 주세요." }, { status: 400 });
      }
      if (lines.some((line) => !Number.isSafeInteger(line.amount) || line.amount < 0)) return Response.json({ error: "품목 라인 금액이 허용 범위를 벗어났습니다." }, { status: 400 });
      const amount = lines.reduce((sum, line) => sum + line.amount, 0);
      if (!Number.isSafeInteger(amount)) return Response.json({ error: "문서 합계 금액이 허용 범위를 벗어났습니다." }, { status: 400 });
      const requestsJson = JSON.stringify(lines.map((line) => ({ sourceLineId: line.sourceLineId, quantity: line.quantity })));
      const documentStatement = sourceDocumentId
        ? db.prepare(`INSERT INTO sales_documents
          (id, opportunity_id, document_type, document_number, version, amount, status, issued_date, due_date, source_document_id, created_at, updated_at)
          SELECT ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, ?, ?, ? WHERE NOT EXISTS (
            SELECT 1 FROM json_each(?) request JOIN sales_document_lines source_line
              ON source_line.id = json_extract(request.value, '$.sourceLineId')
            WHERE CAST(json_extract(request.value, '$.quantity') AS REAL) > source_line.quantity - COALESCE((
              SELECT SUM(child_line.quantity) FROM sales_document_lines child_line JOIN sales_documents child ON child.id = child_line.document_id
              WHERE child_line.source_line_id = source_line.id AND child.document_type = ? AND child.status <> 'CANCELLED'), 0))`)
          .bind(id, opportunityId, documentType, documentNumber, version, amount, issuedDate, dueDate, sourceDocumentId, now, now, requestsJson, documentType)
        : db.prepare(`INSERT INTO sales_documents
          (id, opportunity_id, document_type, document_number, version, amount, status, issued_date, due_date, source_document_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, '', ?, ?)`)
          .bind(id, opportunityId, documentType, documentNumber, version, amount, issuedDate, dueDate, now, now);
      const result = await db.batch([documentStatement, ...lines.map((line) => db.prepare(`INSERT INTO sales_document_lines
        (id, document_id, line_number, catalog_item_id, description, quantity, unit, unit_price, amount, source_line_id, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM sales_documents WHERE id = ?)`)
        .bind(line.id, id, line.lineNumber, line.catalogItemId, line.description, line.quantity, line.unit, line.unitPrice, line.amount, line.sourceLineId, now, id))]);
      if ((result[0].meta.changes ?? 0) < 1 || result.slice(1).some((item) => (item.meta.changes ?? 0) < 1)) {
        return Response.json({ error: "다른 문서가 먼저 저장되어 상위 문서의 잔여 수량이 변경되었습니다. 새로고침 후 다시 확인해 주세요." }, { status: 409 });
      }
    }
    const pricingReview = ["QUOTE", "ORDER"].includes(documentType)
      ? await evaluateSalesDocumentPricing(db, id, authorization.principal.employeeId) : null;
    const row = await db.prepare(`${documentSelect} WHERE d.id = ?`).bind(id).first<SalesDocumentRow>();
    const savedLines = documentType === "PAYMENT" ? [] : (await db.prepare(`${documentLineSelect} WHERE line.document_id = ? ORDER BY line.line_number`).bind(id).all<DocumentLineRow>()).results.map(toDocumentLine);
    const after = row ? { ...toSalesDocument({ ...row, opportunity_title: opportunity.title, account_name: opportunity.account_name }), lines: savedLines } : body;
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SALES_DOCUMENT_CREATED", entityType: "salesDocument", entityId: id, after });
    return Response.json({ item: after, pricingReview }, { status: 201 });
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
  if (resource === "catalog") {
    const before = await db.prepare("SELECT * FROM sales_catalog_items WHERE id = ?").bind(id).first<CatalogItemRow>();
    if (!before) return Response.json({ error: "상품·서비스 기준정보를 찾을 수 없습니다." }, { status: 404 });
    const name = String(body.name ?? before.name).trim().slice(0, 200);
    const itemType = String(body.itemType ?? before.item_type);
    const unit = String(body.unit ?? before.unit).trim().toUpperCase().slice(0, 20);
    const defaultUnitPrice = Number(body.defaultUnitPrice ?? before.default_unit_price);
    const status = String(body.status ?? before.status);
    if (name.length < 2 || !["PRODUCT", "SERVICE"].includes(itemType) || !unit || !Number.isSafeInteger(defaultUnitPrice)
      || defaultUnitPrice < 0 || !["ACTIVE", "INACTIVE"].includes(status)) {
      return Response.json({ error: "상품·서비스 기준정보의 명칭·유형·단위·단가·상태를 확인해 주세요." }, { status: 400 });
    }
    await db.prepare(`UPDATE sales_catalog_items SET name = ?, item_type = ?, unit = ?, default_unit_price = ?, status = ?, updated_at = ? WHERE id = ?`)
      .bind(name, itemType, unit, defaultUnitPrice, status, Date.now(), id).run();
    const after = await db.prepare("SELECT * FROM sales_catalog_items WHERE id = ?").bind(id).first<CatalogItemRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SALES_CATALOG_ITEM_UPDATED", entityType: "salesCatalogItem", entityId: id, before: toCatalogItem(before), after: after ? toCatalogItem(after) : null, reason: String(body.reason ?? "기준정보 상태·내용 변경") });
    return Response.json({ item: after ? toCatalogItem(after) : null });
  }
  if (resource === "document") {
    const before = await db.prepare("SELECT * FROM sales_documents WHERE id = ?").bind(id).first<SalesDocumentRow>();
    if (!before) return Response.json({ error: "영업 문서를 찾을 수 없습니다." }, { status: 404 });
    const status = String(body.status ?? before.status);
    if (!["DRAFT", "ISSUED", "ACCEPTED", "COMPLETED", "CANCELLED"].includes(status)) return Response.json({ error: "올바르지 않은 문서 상태입니다." }, { status: 400 });
    if (status === before.status) return Response.json({ item: toSalesDocument(before) });
    if (before.document_type === "PAYMENT" && ["ACCEPTED", "COMPLETED"].includes(before.status)
      && !(before.status === "ACCEPTED" && status === "COMPLETED")) {
      return Response.json({ error: "확정·완료된 수금은 되돌릴 수 없습니다. 역수금·환불 절차가 필요합니다." }, { status: 409 });
    }
    if (before.document_type === "INVOICE" && status === "CANCELLED" && ["ACCEPTED", "COMPLETED"].includes(before.status)) {
      const projectReference = await db.prepare(`SELECT
        (SELECT COUNT(*) FROM finance_project_allocations WHERE source_type = 'SALES_INVOICE' AND source_id = ?) +
        (SELECT COUNT(*) FROM finance_cost_centers WHERE opportunity_id = ?) AS count`)
        .bind(id, before.opportunity_id).first<{ count: number }>();
      if (Number(projectReference?.count ?? 0) > 0) return Response.json({ error: "프로젝트 손익에 반영된 청구서입니다. 취소 대신 수정 청구·역분개 절차로 처리해 주세요." }, { status: 409 });
    }
    if (status === "CANCELLED" && ["QUOTE", "ORDER", "DELIVERY"].includes(before.document_type)) {
      const child = await db.prepare("SELECT id FROM sales_documents WHERE source_document_id = ? AND status <> 'CANCELLED' LIMIT 1").bind(id).first<{ id: string }>();
      if (child) return Response.json({ error: "이 문서를 근거로 작성된 미취소 하위 문서가 있어 취소할 수 없습니다." }, { status: 409 });
    }
    if (((before.document_type === "QUOTE" && ["ISSUED", "ACCEPTED"].includes(status))
      || (before.document_type === "ORDER" && status === "ACCEPTED")) && !["ISSUED", "ACCEPTED"].includes(before.status)) {
      const pricingGate = await getSalesPricingGate(db, id);
      if (!pricingGate.canProceed) return Response.json({ error: "가격 검토를 통과하거나 가격 예외 승인을 완료한 뒤 문서를 발행·확정해 주세요." }, { status: 409 });
    }
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
  if (stage === before.stage) return Response.json({ item: toOpportunity(before) });
  if (before.status !== "OPEN") return Response.json({ error: "종결된 영업기회는 일반 단계변경으로 되돌릴 수 없습니다." }, { status: 409 });
  const nextStage: Record<string, string> = { LEAD: "DISCOVERY", DISCOVERY: "PROPOSAL", PROPOSAL: "CONTRACT", CONTRACT: "WON" };
  if (stage !== "LOST" && nextStage[before.stage] !== stage) return Response.json({ error: "영업 단계는 다음 단계로만 이동할 수 있습니다." }, { status: 409 });
  const reason = String(body.reason ?? "").trim().slice(0, 1000);
  if (reason.length < (stage === "LOST" ? 10 : 5)) return Response.json({ error: stage === "LOST" ? "실주 사유를 10자 이상 입력해 주세요." : "단계 변경 근거를 5자 이상 입력해 주세요." }, { status: 400 });
  if (stage === "WON") {
    const acceptedOrder = await db.prepare(`SELECT id FROM sales_documents WHERE opportunity_id = ?
      AND document_type = 'ORDER' AND status IN ('ACCEPTED', 'COMPLETED') LIMIT 1`).bind(id).first<{ id: string }>();
    if (!acceptedOrder) return Response.json({ error: "승인·완료된 수주 문서가 있어야 수주 단계로 전환할 수 있습니다." }, { status: 409 });
  }
  const status = ["WON", "LOST"].includes(stage) ? "CLOSED" : "OPEN";
  const changedAt = Date.now(); const nextAction = status === "CLOSED" ? "" : String(body.nextAction ?? before.next_action);
  const nextActionDate = status === "CLOSED" ? "" : String(body.nextActionDate ?? before.next_action_date);
  const transition = await db.batch([
    db.prepare("UPDATE sales_opportunities SET stage = ?, status = ?, next_action = ?, next_action_date = ?, updated_at = ? WHERE id = ? AND stage = ? AND status = 'OPEN'")
      .bind(stage, status, nextAction, nextActionDate, changedAt, id, before.stage),
    db.prepare(`INSERT INTO sales_opportunity_stage_history
      (id, opportunity_id, from_stage, to_stage, reason, changed_by, changed_at)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS
        (SELECT 1 FROM sales_opportunities WHERE id = ? AND stage = ? AND updated_at = ?)`)
      .bind(crypto.randomUUID(), id, before.stage, stage, reason, authorization.principal.employeeId, changedAt, id, stage, changedAt),
  ]);
  if ((transition[0].meta.changes ?? 0) < 1 || (transition[1].meta.changes ?? 0) < 1) {
    return Response.json({ error: "다른 사용자가 영업 단계를 변경했습니다. 새로고침 후 다시 확인해 주세요." }, { status: 409 });
  }
  const after = await db.prepare("SELECT * FROM sales_opportunities WHERE id = ?").bind(id).first<OpportunityRow>();
  await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "OPPORTUNITY_STAGE_CHANGED", entityType: "salesOpportunity", entityId: id, before: toOpportunity(before), after: after ? toOpportunity(after) : null, reason });
  return Response.json({ item: after ? toOpportunity(after) : null });
}
