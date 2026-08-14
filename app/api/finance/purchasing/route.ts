import { env } from "cloudflare:workers";
import { createApprovalRequest } from "../../../approval-engine";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;
const partnerKey = (name: string, businessNumber: string) => businessNumber.replace(/\D/g, "") || name.toLowerCase().replace(/[^0-9a-z가-힣]/g, "");

type VendorRow = { id: string; name: string; business_number: string; contact_name: string; email: string; payment_terms_days: number; status: string };
type OrderRow = { id: string; order_number: string; vendor_id: string; vendor_name?: string | null; title: string; currency: string; subtotal: number; tax_amount: number; total_amount: number; expected_date: string; status: string; requester_employee_id: string; approved_by: string; approved_at: number | null; created_at: number; updated_at: number };
type OrderLineRow = { id: string; order_id: string; line_number: number; item_name: string; description: string; quantity_milli: number; unit_price: number; line_amount: number; accepted_quantity_milli?: number | null };
type ReceiptRow = { id: string; order_id: string; order_number?: string | null; vendor_name?: string | null; receipt_number: string; receipt_date: string; notes: string; status: string; received_by: string; accepted_amount?: number | null };
type InvoiceRow = { id: string; order_id: string; vendor_id: string; order_number?: string | null; vendor_name?: string | null; invoice_number: string; invoice_date: string; due_date: string; supply_amount: number; tax_amount: number; total_amount: number; matched_receipt_amount: number; status: string; exception_reason: string; payment_request_id: string; created_by: string; payment_request_status?: string | null; payment_date?: string | null; plan_status?: string | null; planned_payment_date?: string | null; priority?: string | null; owner_employee_id?: string | null; hold_reason?: string | null; plan_memo?: string | null };
type PayablePlanRow = { invoice_id: string; plan_status: string; planned_payment_date: string; priority: string; owner_employee_id: string; hold_reason: string; memo: string; updated_by: string; created_at: number; updated_at: number };

async function ensureSchema() {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_purchase_vendors (
      id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, business_number TEXT NOT NULL DEFAULT '',
      contact_name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', payment_terms_days INTEGER NOT NULL DEFAULT 30,
      status TEXT NOT NULL DEFAULT 'ACTIVE', created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL, deleted_at INTEGER
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_purchase_orders (
      id TEXT PRIMARY KEY NOT NULL, order_number TEXT NOT NULL, vendor_id TEXT NOT NULL, title TEXT NOT NULL,
      currency TEXT NOT NULL DEFAULT 'KRW', subtotal INTEGER NOT NULL DEFAULT 0, tax_amount INTEGER NOT NULL DEFAULT 0,
      total_amount INTEGER NOT NULL DEFAULT 0, expected_date TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'DRAFT',
      requester_employee_id TEXT NOT NULL, approved_by TEXT NOT NULL DEFAULT '', approved_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_purchase_order_lines (
      id TEXT PRIMARY KEY NOT NULL, order_id TEXT NOT NULL, line_number INTEGER NOT NULL, item_name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '', quantity_milli INTEGER NOT NULL, unit_price INTEGER NOT NULL,
      line_amount INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_purchase_receipts (
      id TEXT PRIMARY KEY NOT NULL, order_id TEXT NOT NULL, receipt_number TEXT NOT NULL, receipt_date TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'ACCEPTED', received_by TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_purchase_receipt_lines (
      id TEXT PRIMARY KEY NOT NULL, receipt_id TEXT NOT NULL, order_line_id TEXT NOT NULL,
      received_quantity_milli INTEGER NOT NULL, accepted_quantity_milli INTEGER NOT NULL,
      rejected_quantity_milli INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_purchase_invoices (
      id TEXT PRIMARY KEY NOT NULL, order_id TEXT NOT NULL, vendor_id TEXT NOT NULL DEFAULT '', invoice_number TEXT NOT NULL, invoice_date TEXT NOT NULL,
      due_date TEXT NOT NULL DEFAULT '', supply_amount INTEGER NOT NULL, tax_amount INTEGER NOT NULL DEFAULT 0,
      total_amount INTEGER NOT NULL, matched_receipt_amount INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'DRAFT',
      exception_reason TEXT NOT NULL DEFAULT '', payment_request_id TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_payable_plans (
      invoice_id TEXT PRIMARY KEY NOT NULL, plan_status TEXT NOT NULL DEFAULT 'SCHEDULED',
      planned_payment_date TEXT NOT NULL DEFAULT '', priority TEXT NOT NULL DEFAULT 'NORMAL',
      owner_employee_id TEXT NOT NULL DEFAULT '', hold_reason TEXT NOT NULL DEFAULT '', memo TEXT NOT NULL DEFAULT '',
      updated_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
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
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_purchase_vendor_status_name ON finance_purchase_vendors(status, name)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_purchase_order_number ON finance_purchase_orders(order_number)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_purchase_order_vendor_status ON finance_purchase_orders(vendor_id, status)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_purchase_order_line_number ON finance_purchase_order_lines(order_id, line_number)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_purchase_receipt_number ON finance_purchase_receipts(receipt_number)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_purchase_receipt_order_date ON finance_purchase_receipts(order_id, receipt_date)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_purchase_receipt_line ON finance_purchase_receipt_lines(receipt_id, order_line_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_purchase_receipt_order_line ON finance_purchase_receipt_lines(order_line_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_purchase_invoice_order_status ON finance_purchase_invoices(order_id, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_purchase_invoice_due_status ON finance_purchase_invoices(due_date, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_payable_plan_status_date ON finance_payable_plans(plan_status, planned_payment_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_payable_plan_owner_priority ON finance_payable_plans(owner_employee_id, priority)"),
  ]);
  const invoiceColumns = await db.prepare("PRAGMA table_info(finance_purchase_invoices)").all<{ name: string }>();
  if (!invoiceColumns.results.some((column) => column.name === "vendor_id")) {
    await db.prepare("ALTER TABLE finance_purchase_invoices ADD COLUMN vendor_id TEXT NOT NULL DEFAULT ''").run();
  }
  await db.prepare(`UPDATE finance_purchase_invoices SET vendor_id = COALESCE((
    SELECT vendor_id FROM finance_purchase_orders WHERE finance_purchase_orders.id = finance_purchase_invoices.order_id
  ), '') WHERE vendor_id = ''`).run();
  await db.prepare("DROP INDEX IF EXISTS idx_finance_purchase_invoice_number").run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_purchase_invoice_vendor_number ON finance_purchase_invoices(vendor_id, invoice_number)").run();
}

const toVendor = (row: VendorRow) => ({ id: row.id, name: row.name, businessNumber: row.business_number, contactName: row.contact_name, email: row.email, paymentTermsDays: row.payment_terms_days, status: row.status });
const toLine = (row: OrderLineRow) => ({ id: row.id, orderId: row.order_id, lineNumber: row.line_number, itemName: row.item_name, description: row.description, quantity: row.quantity_milli / 1000, unitPrice: row.unit_price, lineAmount: row.line_amount, acceptedQuantity: Number(row.accepted_quantity_milli ?? 0) / 1000 });
const toOrder = (row: OrderRow, lines: OrderLineRow[]) => ({ id: row.id, orderNumber: row.order_number, vendorId: row.vendor_id, vendorName: row.vendor_name ?? "", title: row.title, currency: row.currency, subtotal: row.subtotal, taxAmount: row.tax_amount, totalAmount: row.total_amount, expectedDate: row.expected_date, status: row.status, requesterEmployeeId: row.requester_employee_id, approvedBy: row.approved_by, approvedAt: row.approved_at, lines: lines.map(toLine) });
const toReceipt = (row: ReceiptRow) => ({ id: row.id, orderId: row.order_id, orderNumber: row.order_number ?? "", vendorName: row.vendor_name ?? "", receiptNumber: row.receipt_number, receiptDate: row.receipt_date, notes: row.notes, status: row.status, receivedBy: row.received_by, acceptedAmount: Math.round(Number(row.accepted_amount ?? 0)) });
const toInvoice = (row: InvoiceRow) => ({ id: row.id, orderId: row.order_id, vendorId: row.vendor_id, orderNumber: row.order_number ?? "", vendorName: row.vendor_name ?? "", invoiceNumber: row.invoice_number, invoiceDate: row.invoice_date, dueDate: row.due_date, supplyAmount: row.supply_amount, taxAmount: row.tax_amount, totalAmount: row.total_amount, matchedReceiptAmount: row.matched_receipt_amount, status: row.status, exceptionReason: row.exception_reason, paymentRequestId: row.payment_request_id, paymentRequestStatus: row.payment_request_status ?? "", paymentDate: row.payment_date ?? "", planStatus: row.plan_status ?? "UNSCHEDULED", plannedPaymentDate: row.planned_payment_date ?? "", priority: row.priority ?? "NORMAL", ownerEmployeeId: row.owner_employee_id ?? "", holdReason: row.hold_reason ?? "", planMemo: row.plan_memo ?? "", createdBy: row.created_by });

export async function GET() {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "finance", "read");
  if (authorization.response) return authorization.response;
  const [vendors, orders, lines, receipts, invoices] = await Promise.all([
    db.prepare("SELECT * FROM finance_purchase_vendors WHERE deleted_at IS NULL ORDER BY name").all<VendorRow>(),
    db.prepare(`SELECT purchase_order.*, vendor.name AS vendor_name FROM finance_purchase_orders purchase_order
      LEFT JOIN finance_purchase_vendors vendor ON vendor.id = purchase_order.vendor_id ORDER BY purchase_order.created_at DESC`).all<OrderRow>(),
    db.prepare(`SELECT order_line.*, COALESCE(SUM(CASE WHEN receipt.id IS NOT NULL THEN receipt_line.accepted_quantity_milli ELSE 0 END), 0) AS accepted_quantity_milli
      FROM finance_purchase_order_lines order_line
      LEFT JOIN finance_purchase_receipt_lines receipt_line ON receipt_line.order_line_id = order_line.id
      LEFT JOIN finance_purchase_receipts receipt ON receipt.id = receipt_line.receipt_id AND receipt.status = 'ACCEPTED'
      GROUP BY order_line.id ORDER BY order_line.order_id, order_line.line_number`).all<OrderLineRow>(),
    db.prepare(`SELECT receipt.*, purchase_order.order_number, vendor.name AS vendor_name,
      COALESCE(SUM(receipt_line.accepted_quantity_milli * order_line.unit_price / 1000.0), 0) AS accepted_amount
      FROM finance_purchase_receipts receipt
      JOIN finance_purchase_orders purchase_order ON purchase_order.id = receipt.order_id
      LEFT JOIN finance_purchase_vendors vendor ON vendor.id = purchase_order.vendor_id
      LEFT JOIN finance_purchase_receipt_lines receipt_line ON receipt_line.receipt_id = receipt.id
      LEFT JOIN finance_purchase_order_lines order_line ON order_line.id = receipt_line.order_line_id
      GROUP BY receipt.id ORDER BY receipt.receipt_date DESC, receipt.created_at DESC`).all<ReceiptRow>(),
    db.prepare(`SELECT invoice.*, purchase_order.order_number, vendor.name AS vendor_name,
      expense.status AS payment_request_status, payment.payment_date,
      payable.plan_status, payable.planned_payment_date, payable.priority, payable.owner_employee_id,
      payable.hold_reason, payable.memo AS plan_memo
      FROM finance_purchase_invoices invoice JOIN finance_purchase_orders purchase_order ON purchase_order.id = invoice.order_id
      LEFT JOIN finance_purchase_vendors vendor ON vendor.id = purchase_order.vendor_id
      LEFT JOIN finance_expense_requests expense ON expense.id = invoice.payment_request_id
      LEFT JOIN finance_payment_ledger payment ON payment.request_id = expense.id AND payment.status = 'PAID'
      LEFT JOIN finance_payable_plans payable ON payable.invoice_id = invoice.id
      ORDER BY invoice.invoice_date DESC, invoice.created_at DESC`).all<InvoiceRow>(),
  ]);
  const lineMap = new Map<string, OrderLineRow[]>();
  for (const line of lines.results) lineMap.set(line.order_id, [...(lineMap.get(line.order_id) ?? []), line]);
  return Response.json({
    vendors: vendors.results.map(toVendor),
    orders: orders.results.map((row) => toOrder(row, lineMap.get(row.id) ?? [])),
    receipts: receipts.results.map(toReceipt),
    invoices: invoices.results.map(toInvoice),
  });
}

export async function POST(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "finance", "write");
  if (authorization.response) return authorization.response;
  const body = await request.json() as Record<string, unknown>;
  const resource = String(body.resource ?? "");
  const now = Date.now();

  if (resource === "vendor") {
    const name = String(body.name ?? "").trim();
    const businessNumber = String(body.businessNumber ?? "").replace(/\D/g, "");
    const paymentTermsDays = Math.round(Number(body.paymentTermsDays ?? 30));
    if (!name || paymentTermsDays < 0 || paymentTermsDays > 365) return Response.json({ error: "거래처명과 결제조건을 확인해 주세요." }, { status: 400 });
    if (businessNumber && await db.prepare("SELECT id FROM finance_purchase_vendors WHERE business_number = ? AND deleted_at IS NULL").bind(businessNumber).first()) {
      return Response.json({ error: "같은 사업자번호의 매입 거래처가 이미 있습니다." }, { status: 409 });
    }
    const id = crypto.randomUUID();
    await db.prepare(`INSERT INTO finance_purchase_vendors
      (id, name, business_number, contact_name, email, payment_terms_days, status, created_by, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, NULL)`)
      .bind(id, name, businessNumber, String(body.contactName ?? "").trim(), String(body.email ?? "").trim(), paymentTermsDays, authorization.principal.employeeId, now, now).run();
    const normalizedKey = partnerKey(name, businessNumber);
    const masterId = `partner:${normalizedKey}`;
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO finance_master_partners
        (id, canonical_name, normalized_key, business_number, partner_type, payment_terms_days, status, source, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'VENDOR', ?, 'ACTIVE', 'PURCHASE', ?, ?, ?)`)
        .bind(masterId, name, normalizedKey, businessNumber, paymentTermsDays, authorization.principal.employeeId, now, now),
      db.prepare(`INSERT OR IGNORE INTO finance_master_partner_aliases
        (id, mapping_key, source_system, source_entity_id, source_name, partner_id, created_at, updated_at)
        SELECT ?, ?, 'PURCHASE', ?, ?, id, ?, ? FROM finance_master_partners WHERE normalized_key = ?`)
        .bind(`alias:PURCHASE:${id}`, `PURCHASE:${id}`, id, name, now, now, normalizedKey),
      db.prepare("UPDATE finance_master_partners SET partner_type = CASE WHEN partner_type = 'CUSTOMER' THEN 'BOTH' ELSE partner_type END, payment_terms_days = ?, updated_at = ? WHERE normalized_key = ?")
        .bind(paymentTermsDays, now, normalizedKey),
    ]);
    const row = await db.prepare("SELECT * FROM finance_purchase_vendors WHERE id = ?").bind(id).first<VendorRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "PURCHASE_VENDOR_CREATED", entityType: "purchaseVendor", entityId: id, after: row ? toVendor(row) : body });
    return Response.json({ item: row ? toVendor(row) : null }, { status: 201 });
  }

  if (resource === "order") {
    const vendorId = String(body.vendorId ?? "").trim();
    const orderNumber = String(body.orderNumber ?? "").trim();
    const title = String(body.title ?? "").trim();
    const expectedDate = String(body.expectedDate ?? "").trim();
    const rawLines = Array.isArray(body.lines) ? body.lines as Array<Record<string, unknown>> : [];
    const vendor = await db.prepare("SELECT id, name FROM finance_purchase_vendors WHERE id = ? AND status = 'ACTIVE' AND deleted_at IS NULL").bind(vendorId).first<{ id: string; name: string }>();
    if (!vendor || !orderNumber || !title || !rawLines.length || rawLines.length > 20 || (expectedDate && !/^\d{4}-\d{2}-\d{2}$/.test(expectedDate))) {
      return Response.json({ error: "거래처·발주번호·제목·품목·예정일을 확인해 주세요." }, { status: 400 });
    }
    if (await db.prepare("SELECT id FROM finance_purchase_orders WHERE order_number = ?").bind(orderNumber).first()) return Response.json({ error: "같은 발주번호가 이미 있습니다." }, { status: 409 });
    const parsedLines = rawLines.map((line, index) => {
      const itemName = String(line.itemName ?? "").trim();
      const quantity = Number(line.quantity ?? 0);
      const unitPrice = Math.round(Number(line.unitPrice ?? 0));
      const quantityMilli = Math.round(quantity * 1000);
      return { id: crypto.randomUUID(), lineNumber: index + 1, itemName, description: String(line.description ?? "").trim(), quantityMilli, unitPrice, lineAmount: Math.round(quantity * unitPrice) };
    });
    if (parsedLines.some((line) => !line.itemName || line.quantityMilli <= 0 || line.unitPrice < 0 || !Number.isSafeInteger(line.lineAmount))) {
      return Response.json({ error: "각 품목의 이름·수량·단가를 확인해 주세요." }, { status: 400 });
    }
    const subtotal = parsedLines.reduce((sum, line) => sum + line.lineAmount, 0);
    const taxAmount = Math.round(Number(body.taxAmount ?? 0));
    if (taxAmount < 0 || !Number.isSafeInteger(subtotal + taxAmount)) return Response.json({ error: "공급가액과 세액을 확인해 주세요." }, { status: 400 });
    const id = crypto.randomUUID();
    const statements = [db.prepare(`INSERT INTO finance_purchase_orders
      (id, order_number, vendor_id, title, currency, subtotal, tax_amount, total_amount, expected_date, status,
        requester_employee_id, approved_by, approved_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'KRW', ?, ?, ?, ?, 'DRAFT', ?, '', NULL, ?, ?)`)
      .bind(id, orderNumber, vendorId, title, subtotal, taxAmount, subtotal + taxAmount, expectedDate, authorization.principal.employeeId, now, now)];
    for (const line of parsedLines) statements.push(db.prepare(`INSERT INTO finance_purchase_order_lines
      (id, order_id, line_number, item_name, description, quantity_milli, unit_price, line_amount, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(line.id, id, line.lineNumber, line.itemName, line.description, line.quantityMilli, line.unitPrice, line.lineAmount, now, now));
    await db.batch(statements);
    const row = await db.prepare("SELECT * FROM finance_purchase_orders WHERE id = ?").bind(id).first<OrderRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "PURCHASE_ORDER_CREATED", entityType: "purchaseOrder", entityId: id, after: row ? toOrder({ ...row, vendor_name: vendor.name }, parsedLines.map((line) => ({ ...line, id: line.id, order_id: id, line_number: line.lineNumber, item_name: line.itemName, description: line.description, quantity_milli: line.quantityMilli, unit_price: line.unitPrice, line_amount: line.lineAmount }))) : body });
    return Response.json({ item: row ? toOrder({ ...row, vendor_name: vendor.name }, []) : null }, { status: 201 });
  }

  if (resource === "receipt") {
    const orderId = String(body.orderId ?? "").trim();
    const receiptNumber = String(body.receiptNumber ?? "").trim();
    const receiptDate = String(body.receiptDate ?? "").trim();
    const rawLines = Array.isArray(body.lines) ? body.lines as Array<Record<string, unknown>> : [];
    const order = await db.prepare("SELECT * FROM finance_purchase_orders WHERE id = ? AND status IN ('APPROVED','PARTIALLY_RECEIVED')").bind(orderId).first<OrderRow>();
    if (!order || !receiptNumber || !/^\d{4}-\d{2}-\d{2}$/.test(receiptDate) || !rawLines.length) return Response.json({ error: "승인된 발주·입고번호·입고일·검수수량을 확인해 주세요." }, { status: 400 });
    if (await db.prepare("SELECT id FROM finance_purchase_receipts WHERE receipt_number = ?").bind(receiptNumber).first()) return Response.json({ error: "같은 입고번호가 이미 있습니다." }, { status: 409 });
    const orderLines = await db.prepare(`SELECT order_line.*, COALESCE(SUM(CASE WHEN receipt.id IS NOT NULL THEN receipt_line.accepted_quantity_milli ELSE 0 END), 0) AS accepted_quantity_milli
      FROM finance_purchase_order_lines order_line
      LEFT JOIN finance_purchase_receipt_lines receipt_line ON receipt_line.order_line_id = order_line.id
      LEFT JOIN finance_purchase_receipts receipt ON receipt.id = receipt_line.receipt_id AND receipt.status = 'ACCEPTED'
      WHERE order_line.order_id = ? GROUP BY order_line.id`).bind(orderId).all<OrderLineRow>();
    const byId = new Map(orderLines.results.map((line) => [line.id, line]));
    const parsedLines = rawLines.map((line) => {
      const orderLineId = String(line.orderLineId ?? "");
      const receivedQuantityMilli = Math.round(Number(line.receivedQuantity ?? 0) * 1000);
      const acceptedQuantityMilli = Math.round(Number(line.acceptedQuantity ?? 0) * 1000);
      return { id: crypto.randomUUID(), orderLineId, receivedQuantityMilli, acceptedQuantityMilli, rejectedQuantityMilli: receivedQuantityMilli - acceptedQuantityMilli };
    });
    const invalid = parsedLines.some((line) => {
      const source = byId.get(line.orderLineId);
      return !source || line.receivedQuantityMilli <= 0 || line.acceptedQuantityMilli < 0 || line.acceptedQuantityMilli > line.receivedQuantityMilli
        || Number(source.accepted_quantity_milli ?? 0) + line.acceptedQuantityMilli > source.quantity_milli;
    });
    if (invalid || new Set(parsedLines.map((line) => line.orderLineId)).size !== parsedLines.length) return Response.json({ error: "검수수량이 발주 잔량을 초과했거나 품목이 중복되었습니다." }, { status: 409 });
    const id = crypto.randomUUID();
    const statements = [db.prepare(`INSERT INTO finance_purchase_receipts
      (id, order_id, receipt_number, receipt_date, notes, status, received_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'ACCEPTED', ?, ?, ?)`)
      .bind(id, orderId, receiptNumber, receiptDate, String(body.notes ?? "").trim(), authorization.principal.employeeId, now, now)];
    for (const line of parsedLines) statements.push(db.prepare(`INSERT INTO finance_purchase_receipt_lines
      (id, receipt_id, order_line_id, received_quantity_milli, accepted_quantity_milli, rejected_quantity_milli, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(line.id, id, line.orderLineId, line.receivedQuantityMilli, line.acceptedQuantityMilli, line.rejectedQuantityMilli, now, now));
    statements.push(db.prepare(`UPDATE finance_purchase_orders SET status = CASE WHEN NOT EXISTS (
      SELECT 1 FROM finance_purchase_order_lines order_line WHERE order_line.order_id = ?
        AND COALESCE((SELECT SUM(receipt_line.accepted_quantity_milli) FROM finance_purchase_receipt_lines receipt_line
          JOIN finance_purchase_receipts receipt ON receipt.id = receipt_line.receipt_id AND receipt.status = 'ACCEPTED'
          WHERE receipt_line.order_line_id = order_line.id), 0) < order_line.quantity_milli
      ) THEN 'RECEIVED' ELSE 'PARTIALLY_RECEIVED' END, updated_at = ? WHERE id = ?`).bind(orderId, now, orderId));
    await db.batch(statements);
    const row = await db.prepare("SELECT * FROM finance_purchase_receipts WHERE id = ?").bind(id).first<ReceiptRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "PURCHASE_RECEIPT_CREATED", entityType: "purchaseReceipt", entityId: id, after: row ? toReceipt(row) : body });
    return Response.json({ item: row ? toReceipt(row) : null }, { status: 201 });
  }

  if (resource === "invoice") {
    const orderId = String(body.orderId ?? "").trim();
    const invoiceNumber = String(body.invoiceNumber ?? "").trim();
    const invoiceDate = String(body.invoiceDate ?? "").trim();
    const dueDate = String(body.dueDate ?? "").trim();
    const supplyAmount = Math.round(Number(body.supplyAmount ?? 0));
    const taxAmount = Math.round(Number(body.taxAmount ?? 0));
    const order = await db.prepare("SELECT * FROM finance_purchase_orders WHERE id = ? AND status IN ('APPROVED','PARTIALLY_RECEIVED','RECEIVED')").bind(orderId).first<OrderRow>();
    if (!order || !invoiceNumber || !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate) || (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) || supplyAmount <= 0 || taxAmount < 0) return Response.json({ error: "발주·인보이스번호·일자·공급가액·세액을 확인해 주세요." }, { status: 400 });
    if (await db.prepare("SELECT id FROM finance_purchase_invoices WHERE vendor_id = ? AND invoice_number = ?").bind(order.vendor_id, invoiceNumber).first()) return Response.json({ error: "같은 공급사의 매입 인보이스번호가 이미 있습니다." }, { status: 409 });
    const receiptValue = await db.prepare(`SELECT COALESCE(SUM(receipt_line.accepted_quantity_milli * order_line.unit_price / 1000.0), 0) AS amount
      FROM finance_purchase_receipt_lines receipt_line
      JOIN finance_purchase_receipts receipt ON receipt.id = receipt_line.receipt_id AND receipt.status = 'ACCEPTED'
      JOIN finance_purchase_order_lines order_line ON order_line.id = receipt_line.order_line_id
      WHERE receipt.order_id = ?`).bind(orderId).first<{ amount: number }>();
    const priorInvoice = await db.prepare(`SELECT COALESCE(SUM(supply_amount), 0) AS amount FROM finance_purchase_invoices
      WHERE order_id = ? AND status <> 'CANCELLED'`).bind(orderId).first<{ amount: number }>();
    const receivedAvailable = Math.max(0, Math.round(Number(receiptValue?.amount ?? 0)) - Number(priorInvoice?.amount ?? 0));
    const orderAvailable = Math.max(0, order.subtotal - Number(priorInvoice?.amount ?? 0));
    const reasons = [supplyAmount > orderAvailable ? `발주 잔액 ${orderAvailable.toLocaleString("ko-KR")}원 초과` : "", supplyAmount > receivedAvailable ? `검수 잔액 ${receivedAvailable.toLocaleString("ko-KR")}원 초과` : ""].filter(Boolean);
    const status = reasons.length ? "EXCEPTION" : "MATCHED";
    const id = crypto.randomUUID();
    await db.prepare(`INSERT INTO finance_purchase_invoices
      (id, order_id, vendor_id, invoice_number, invoice_date, due_date, supply_amount, tax_amount, total_amount,
        matched_receipt_amount, status, exception_reason, payment_request_id, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?)`)
      .bind(id, orderId, order.vendor_id, invoiceNumber, invoiceDate, dueDate, supplyAmount, taxAmount, supplyAmount + taxAmount,
        Math.min(supplyAmount, receivedAvailable), status, reasons.join(" · "), authorization.principal.employeeId, now, now).run();
    const row = await db.prepare("SELECT * FROM finance_purchase_invoices WHERE id = ?").bind(id).first<InvoiceRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "PURCHASE_INVOICE_CREATED", entityType: "purchaseInvoice", entityId: id, after: row ? toInvoice(row) : body });
    return Response.json({ item: row ? toInvoice(row) : null }, { status: 201 });
  }

  return Response.json({ error: "지원하지 않는 구매 원장 항목입니다." }, { status: 400 });
}

export async function PUT(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "finance", "write");
  if (authorization.response) return authorization.response;
  const body = await request.json() as Record<string, unknown>;
  const resource = String(body.resource ?? "");
  const id = String(body.id ?? "").trim();
  const action = String(body.action ?? "").toUpperCase();
  const now = Date.now();

  if (resource === "payablePlan" && action === "SAVE") {
    const invoice = await db.prepare(`SELECT invoice.*, purchase_order.order_number, vendor.name AS vendor_name
      FROM finance_purchase_invoices invoice
      JOIN finance_purchase_orders purchase_order ON purchase_order.id = invoice.order_id
      LEFT JOIN finance_purchase_vendors vendor ON vendor.id = purchase_order.vendor_id
      WHERE invoice.id = ?`).bind(id).first<InvoiceRow>();
    if (!invoice) return Response.json({ error: "매입 인보이스를 찾을 수 없습니다." }, { status: 404 });
    if (!["MATCHED", "PAYMENT_READY"].includes(invoice.status)) return Response.json({ error: "대사 완료 후 지급 전인 인보이스만 지급계획을 저장할 수 있습니다." }, { status: 409 });
    const planStatus = String(body.planStatus ?? "SCHEDULED");
    const plannedPaymentDate = String(body.plannedPaymentDate ?? "").trim();
    const priority = String(body.priority ?? "NORMAL");
    const ownerEmployeeId = String(body.ownerEmployeeId ?? "").trim().slice(0, 60);
    const holdReason = String(body.holdReason ?? "").trim().slice(0, 1000);
    const memo = String(body.memo ?? "").trim().slice(0, 2000);
    if (!["SCHEDULED", "HOLD"].includes(planStatus) || !["LOW", "NORMAL", "HIGH", "CRITICAL"].includes(priority)) {
      return Response.json({ error: "지급계획 상태와 우선순위를 확인해 주세요." }, { status: 400 });
    }
    if (plannedPaymentDate && !/^\d{4}-\d{2}-\d{2}$/.test(plannedPaymentDate)) return Response.json({ error: "내부 지급예정일 형식을 확인해 주세요." }, { status: 400 });
    if (planStatus === "SCHEDULED" && !plannedPaymentDate) return Response.json({ error: "지급 예정 상태에는 내부 지급예정일이 필요합니다." }, { status: 400 });
    if (planStatus === "HOLD" && !holdReason) return Response.json({ error: "지급 보류에는 사유가 필요합니다." }, { status: 400 });
    const before = await db.prepare("SELECT * FROM finance_payable_plans WHERE invoice_id = ?").bind(id).first<PayablePlanRow>();
    await db.prepare(`INSERT INTO finance_payable_plans
      (invoice_id, plan_status, planned_payment_date, priority, owner_employee_id, hold_reason, memo, updated_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(invoice_id) DO UPDATE SET plan_status = excluded.plan_status,
        planned_payment_date = excluded.planned_payment_date, priority = excluded.priority,
        owner_employee_id = excluded.owner_employee_id, hold_reason = excluded.hold_reason,
        memo = excluded.memo, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
      .bind(id, planStatus, plannedPaymentDate, priority, ownerEmployeeId, holdReason, memo,
        authorization.principal.employeeId, before?.created_at ?? now, now).run();
    const after = await db.prepare("SELECT * FROM finance_payable_plans WHERE invoice_id = ?").bind(id).first<PayablePlanRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: before ? "PAYABLE_PLAN_UPDATED" : "PAYABLE_PLAN_CREATED", entityType: "purchaseInvoice", entityId: id, before, after });
    return Response.json({ item: after });
  }

  if (resource === "order" && action === "SUBMIT") {
    const before = await db.prepare("SELECT * FROM finance_purchase_orders WHERE id = ?").bind(id).first<OrderRow>();
    if (!before) return Response.json({ error: "발주서를 찾을 수 없습니다." }, { status: 404 });
    if (before.status !== "DRAFT") return Response.json({ error: "작성 중인 발주서만 결재를 제출할 수 있습니다." }, { status: 409 });
    const existing = await db.prepare(`SELECT id, status FROM erp_approval_requests
      WHERE target_entity_type = 'PURCHASE_ORDER' AND target_entity_id = ? ORDER BY created_at DESC LIMIT 1`).bind(id).first<{ id: string; status: string }>();
    if (existing && ["SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED"].includes(existing.status)) return Response.json({ approvalSubmitted: true, approvalId: existing.id }, { status: 202 });
    await db.prepare("UPDATE finance_purchase_orders SET status = 'SUBMITTED', updated_at = ? WHERE id = ? AND status = 'DRAFT'").bind(now, id).run();
    try {
      const approval = await createApprovalRequest(db, authorization.principal, {
        module: "finance", requestType: "PURCHASE_ORDER", title: `${before.order_number} 발주 승인`,
        description: `${before.title} · ${before.total_amount.toLocaleString("ko-KR")}원`, targetEntityType: "PURCHASE_ORDER",
        targetEntityId: id, amount: before.total_amount, dueDate: before.expected_date,
        metadata: { orderNumber: before.order_number, vendorId: before.vendor_id, subtotal: before.subtotal, taxAmount: before.tax_amount },
      });
      await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "PURCHASE_ORDER_APPROVAL_SUBMITTED", entityType: "purchaseOrder", entityId: id, before, after: approval });
      return Response.json({ approvalSubmitted: true, approvalId: approval.id }, { status: 202 });
    } catch (error) {
      await db.prepare("UPDATE finance_purchase_orders SET status = 'DRAFT', updated_at = ? WHERE id = ? AND status = 'SUBMITTED'").bind(now, id).run();
      return Response.json({ error: error instanceof Error ? error.message : "발주 결재선을 만들지 못했습니다." }, { status: 409 });
    }
  }

  if (resource === "invoice" && action === "CREATE_PAYMENT") {
    const before = await db.prepare(`SELECT invoice.*, purchase_order.order_number, vendor.name AS vendor_name
      FROM finance_purchase_invoices invoice JOIN finance_purchase_orders purchase_order ON purchase_order.id = invoice.order_id
      LEFT JOIN finance_purchase_vendors vendor ON vendor.id = purchase_order.vendor_id WHERE invoice.id = ?`).bind(id).first<InvoiceRow>();
    if (!before) return Response.json({ error: "매입 인보이스를 찾을 수 없습니다." }, { status: 404 });
    if (before.status !== "MATCHED" || before.payment_request_id) return Response.json({ error: "3자 대사가 일치하고 아직 지급 요청이 없는 인보이스만 처리할 수 있습니다." }, { status: 409 });
    const paymentRequestId = `purchase:${id}`;
    const result = await db.batch([
      db.prepare(`INSERT INTO finance_expense_requests
        (id, request_kind, title, vendor, amount, requested_date, due_date, account_code, account_name,
          payment_method, memo, source_type, source_id, status, requester_employee_id, approved_by, approved_at,
          paid_by, paid_at, journal_status, evidence_required, created_at, updated_at)
        SELECT ?, 'PAYMENT', ?, ?, total_amount, invoice_date, due_date, '', '매입채무(계정 확인 필요)',
          'BANK_TRANSFER', ?, 'PURCHASE_INVOICE', id, 'DRAFT', ?, '', NULL, '', NULL, 'UNPOSTED', 1, ?, ?
        FROM finance_purchase_invoices WHERE id = ? AND status = 'MATCHED' AND payment_request_id = ''`)
        .bind(paymentRequestId, `${before.invoice_number} 매입대금 지급`, before.vendor_name ?? "", `${before.order_number ?? ""} 발주 · 3자 대사 일치`, authorization.principal.employeeId, now, now, id),
      db.prepare(`UPDATE finance_purchase_invoices SET status = 'PAYMENT_READY', payment_request_id = ?, updated_at = ?
        WHERE id = ? AND status = 'MATCHED' AND payment_request_id = ''
          AND EXISTS (SELECT 1 FROM finance_expense_requests WHERE id = ? AND source_type = 'PURCHASE_INVOICE' AND source_id = ?)`)
        .bind(paymentRequestId, now, id, paymentRequestId, id),
    ]);
    if ((result[0].meta.changes ?? 0) < 1 || (result[1].meta.changes ?? 0) < 1) return Response.json({ error: "지급 요청이 이미 생성되었거나 인보이스 상태가 변경되었습니다." }, { status: 409 });
    const after = await db.prepare("SELECT * FROM finance_purchase_invoices WHERE id = ?").bind(id).first<InvoiceRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "PURCHASE_PAYMENT_REQUEST_CREATED", entityType: "purchaseInvoice", entityId: id, before: toInvoice(before), after: after ? toInvoice(after) : { paymentRequestId } });
    return Response.json({ item: after ? toInvoice(after) : null, paymentRequestId }, { status: 201 });
  }

  if (resource === "invoice" && action === "CANCEL") {
    const before = await db.prepare("SELECT * FROM finance_purchase_invoices WHERE id = ?").bind(id).first<InvoiceRow>();
    if (!before) return Response.json({ error: "매입 인보이스를 찾을 수 없습니다." }, { status: 404 });
    if (!["MATCHED", "EXCEPTION"].includes(before.status) || before.payment_request_id) return Response.json({ error: "지급 요청 전의 대사 완료·예외 인보이스만 취소할 수 있습니다." }, { status: 409 });
    await db.prepare("UPDATE finance_purchase_invoices SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND payment_request_id = ''").bind(now, id).run();
    const after = await db.prepare("SELECT * FROM finance_purchase_invoices WHERE id = ?").bind(id).first<InvoiceRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "PURCHASE_INVOICE_CANCELLED", entityType: "purchaseInvoice", entityId: id, before: toInvoice(before), after: after ? toInvoice(after) : null });
    return Response.json({ item: after ? toInvoice(after) : null });
  }

  return Response.json({ error: "지원하지 않는 구매 처리입니다." }, { status: 400 });
}
