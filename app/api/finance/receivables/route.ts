import { env } from "cloudflare:workers";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";
import { financeCurrentData } from "../../../finance-current-data";

type FinanceBindings = { DB: D1Database };
type InvoiceRow = {
  id: string; opportunity_id: string; opportunity_title: string | null; account_name: string | null;
  document_number: string; amount: number; status: string; issued_date: string; due_date: string;
  collected_amount: number; reserved_amount: number; collection_status: string | null;
  owner_employee_id: string | null; promised_date: string | null; promised_amount: number | null;
  dispute_reason: string | null; next_action: string | null; next_action_date: string | null;
  memo: string | null; case_updated_at: number | null;
};
type CaseRow = {
  invoice_id: string; collection_status: string; owner_employee_id: string; promised_date: string;
  promised_amount: number; dispute_reason: string; next_action: string; next_action_date: string;
  memo: string; updated_by: string; created_at: number; updated_at: number;
};
type NoteRow = { id: string; invoice_id: string; note_type: string; content: string; created_by: string; created_at: number };
type LegacyRow = { partner_name: string; outstanding_amount: number; owner: string; due_date: string; status: string; memo: string; updated_at: number };

const db = (env as unknown as FinanceBindings).DB;
const allowedCaseStatuses = new Set(["OPEN", "IN_PROGRESS", "PROMISED", "PARTIAL", "DISPUTED", "HOLD"]);
const allowedNoteTypes = new Set(["CALL", "EMAIL", "PROMISE", "DISPUTE", "GENERAL"]);
const allowedLegacyStatuses = new Set(["UNSET", "PLANNED", "PARTIAL", "OVERDUE", "HOLD", "COMPLETE"]);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

async function ensureSchema() {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_receivable_management (
      partner_name TEXT PRIMARY KEY, outstanding_amount INTEGER NOT NULL, owner TEXT NOT NULL DEFAULT '',
      due_date TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'UNSET', memo TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_receivable_cases (
      invoice_id TEXT PRIMARY KEY NOT NULL, collection_status TEXT NOT NULL DEFAULT 'OPEN',
      owner_employee_id TEXT NOT NULL DEFAULT '', promised_date TEXT NOT NULL DEFAULT '', promised_amount INTEGER NOT NULL DEFAULT 0,
      dispute_reason TEXT NOT NULL DEFAULT '', next_action TEXT NOT NULL DEFAULT '', next_action_date TEXT NOT NULL DEFAULT '',
      memo TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_receivable_notes (
      id TEXT PRIMARY KEY NOT NULL, invoice_id TEXT NOT NULL, note_type TEXT NOT NULL DEFAULT 'GENERAL',
      content TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_receivable_status_due ON finance_receivable_management(status, due_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_receivable_case_status_promise ON finance_receivable_cases(collection_status, promised_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_receivable_case_owner_action ON finance_receivable_cases(owner_employee_id, next_action_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_receivable_note_invoice_created ON finance_receivable_notes(invoice_id, created_at)"),
  ]);
}

const invoiceSelect = `SELECT invoice.id, invoice.opportunity_id, opportunity.title AS opportunity_title,
  account.name AS account_name, invoice.document_number, invoice.amount, invoice.status,
  invoice.issued_date, invoice.due_date,
  COALESCE(SUM(CASE WHEN payment.status IN ('ACCEPTED','COMPLETED') THEN allocation.amount ELSE 0 END), 0) AS collected_amount,
  COALESCE(SUM(CASE WHEN payment.status NOT IN ('CANCELLED','ACCEPTED','COMPLETED') THEN allocation.amount ELSE 0 END), 0) AS reserved_amount,
  receivable.collection_status, receivable.owner_employee_id, receivable.promised_date, receivable.promised_amount,
  receivable.dispute_reason, receivable.next_action, receivable.next_action_date, receivable.memo,
  receivable.updated_at AS case_updated_at
  FROM sales_documents invoice
  JOIN sales_opportunities opportunity ON opportunity.id = invoice.opportunity_id
  JOIN sales_accounts account ON account.id = opportunity.account_id
  LEFT JOIN sales_payment_allocations allocation ON allocation.invoice_document_id = invoice.id
  LEFT JOIN sales_documents payment ON payment.id = allocation.payment_document_id
  LEFT JOIN finance_receivable_cases receivable ON receivable.invoice_id = invoice.id
  WHERE invoice.document_type = 'INVOICE' AND invoice.status IN ('ACCEPTED','COMPLETED')`;

function agingBucket(dueDate: string, overdueDays: number) {
  if (!dueDate) return "MISSING_DUE";
  if (overdueDays <= 0) return "CURRENT";
  if (overdueDays <= 30) return "1_30";
  if (overdueDays <= 60) return "31_60";
  if (overdueDays <= 90) return "61_90";
  return "OVER_90";
}

function mapInvoice(row: InvoiceRow) {
  const collectedAmount = Number(row.collected_amount ?? 0);
  const outstandingAmount = Math.max(0, row.amount - collectedAmount);
  const dueTime = row.due_date ? Date.parse(`${row.due_date}T00:00:00Z`) : Number.NaN;
  const asOfTime = Date.parse(`${financeCurrentData.asOf}T00:00:00Z`);
  const overdueDays = Number.isFinite(dueTime) ? Math.max(0, Math.floor((asOfTime - dueTime) / 86_400_000)) : 0;
  const sourceStatus = row.collection_status ?? "OPEN";
  const collectionStatus = outstandingAmount === 0 ? "CLOSED" : collectedAmount > 0 && sourceStatus === "OPEN" ? "PARTIAL" : sourceStatus;
  return {
    id: row.id, opportunityId: row.opportunity_id, opportunityTitle: row.opportunity_title ?? "",
    accountName: row.account_name ?? "미지정", documentNumber: row.document_number, amount: row.amount,
    invoiceStatus: row.status, issuedDate: row.issued_date, dueDate: row.due_date,
    collectedAmount, reservedAmount: Number(row.reserved_amount ?? 0), outstandingAmount,
    overdueDays, agingBucket: agingBucket(row.due_date, overdueDays), collectionStatus,
    ownerEmployeeId: row.owner_employee_id ?? "", promisedDate: row.promised_date ?? "",
    promisedAmount: Number(row.promised_amount ?? 0), disputeReason: row.dispute_reason ?? "",
    nextAction: row.next_action ?? "", nextActionDate: row.next_action_date ?? "", memo: row.memo ?? "",
    caseUpdatedAt: row.case_updated_at,
  };
}

async function loadInvoices(invoiceId = "") {
  const where = invoiceId ? " AND invoice.id = ?" : "";
  const query = `${invoiceSelect}${where}
    GROUP BY invoice.id
    ORDER BY CASE WHEN invoice.due_date = '' THEN 0 WHEN invoice.due_date < ? THEN 1 ELSE 2 END,
      invoice.due_date, invoice.amount DESC`;
  const statement = db.prepare(query);
  const result = invoiceId
    ? await statement.bind(invoiceId, financeCurrentData.asOf).all<InvoiceRow>()
    : await statement.bind(financeCurrentData.asOf).all<InvoiceRow>();
  return result.results.map(mapInvoice);
}

const mapCase = (row: CaseRow) => ({
  invoiceId: row.invoice_id, collectionStatus: row.collection_status, ownerEmployeeId: row.owner_employee_id,
  promisedDate: row.promised_date, promisedAmount: row.promised_amount, disputeReason: row.dispute_reason,
  nextAction: row.next_action, nextActionDate: row.next_action_date, memo: row.memo,
  updatedBy: row.updated_by, createdAt: row.created_at, updatedAt: row.updated_at,
});
const mapNote = (row: NoteRow) => ({ id: row.id, invoiceId: row.invoice_id, noteType: row.note_type, content: row.content, createdBy: row.created_by, createdAt: row.created_at });

export async function GET() {
  const authorization = await authorizeErpRequest(db, "finance", "read");
  if (authorization.response) return authorization.response;
  await ensureSchema();
  const [invoices, noteRows, legacyRows] = await Promise.all([
    loadInvoices(),
    db.prepare("SELECT * FROM finance_receivable_notes ORDER BY created_at DESC LIMIT 1000").all<NoteRow>(),
    db.prepare("SELECT * FROM finance_receivable_management ORDER BY outstanding_amount DESC").all<LegacyRow>(),
  ]);
  const openInvoices = invoices.filter((item) => item.outstandingAmount > 0);
  const aging = Object.fromEntries(["CURRENT", "1_30", "31_60", "61_90", "OVER_90", "MISSING_DUE"].map((bucket) => [bucket, {
    count: openInvoices.filter((item) => item.agingBucket === bucket).length,
    amount: openInvoices.filter((item) => item.agingBucket === bucket).reduce((sum, item) => sum + item.outstandingAmount, 0),
  }]));
  return Response.json({
    asOf: financeCurrentData.asOf,
    invoices,
    notes: noteRows.results.map(mapNote),
    legacyRecords: legacyRows.results.map((row) => ({ partnerName: row.partner_name, outstandingAmount: row.outstanding_amount, owner: row.owner, dueDate: row.due_date, status: row.status, memo: row.memo, updatedAt: row.updated_at })),
    summary: {
      outstandingAmount: openInvoices.reduce((sum, item) => sum + item.outstandingAmount, 0),
      overdueAmount: openInvoices.filter((item) => item.overdueDays > 0).reduce((sum, item) => sum + item.outstandingAmount, 0),
      overdueCount: openInvoices.filter((item) => item.overdueDays > 0).length,
      promisedAmount: openInvoices.filter((item) => item.collectionStatus === "PROMISED").reduce((sum, item) => sum + Math.min(item.outstandingAmount, item.promisedAmount), 0),
      missingDueCount: openInvoices.filter((item) => !item.dueDate).length,
      unassignedCount: openInvoices.filter((item) => !item.ownerEmployeeId).length,
      aging,
    },
  });
}

export async function POST(request: Request) {
  const authorization = await authorizeErpRequest(db, "finance", "write");
  if (authorization.response) return authorization.response;
  await ensureSchema();
  const body = await request.json() as Record<string, unknown>;
  const action = String(body.action ?? "");
  const invoiceId = String(body.invoiceId ?? "").trim();
  if (!invoiceId) return Response.json({ error: "청구서를 선택해 주세요." }, { status: 400 });
  const [source] = await loadInvoices(invoiceId);
  if (!source) return Response.json({ error: "확정된 청구서를 찾을 수 없습니다." }, { status: 404 });

  if (action === "ADD_NOTE") {
    const noteType = String(body.noteType ?? "GENERAL");
    const content = String(body.content ?? "").trim().slice(0, 2000);
    if (!allowedNoteTypes.has(noteType) || !content) return Response.json({ error: "접촉 유형과 기록 내용을 확인해 주세요." }, { status: 400 });
    const id = crypto.randomUUID();
    const now = Date.now();
    await db.prepare(`INSERT INTO finance_receivable_notes (id, invoice_id, note_type, content, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`).bind(id, invoiceId, noteType, content, authorization.principal.employeeId, now).run();
    const note = { id, invoiceId, noteType, content, createdBy: authorization.principal.employeeId, createdAt: now };
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "RECEIVABLE_NOTE_ADDED", entityType: "receivableInvoice", entityId: invoiceId, after: note });
    return Response.json({ note }, { status: 201 });
  }

  if (action !== "SAVE_CASE") return Response.json({ error: "지원하지 않는 작업입니다." }, { status: 400 });
  if (source.outstandingAmount <= 0) return Response.json({ error: "수금 완료된 청구서는 회수 상태를 변경할 수 없습니다." }, { status: 409 });
  const collectionStatus = String(body.collectionStatus ?? "OPEN");
  const ownerEmployeeId = String(body.ownerEmployeeId ?? "").trim().slice(0, 60);
  const promisedDate = String(body.promisedDate ?? "").trim();
  const promisedAmount = Math.round(Number(body.promisedAmount ?? 0));
  const disputeReason = String(body.disputeReason ?? "").trim().slice(0, 1000);
  const nextAction = String(body.nextAction ?? "").trim().slice(0, 500);
  const nextActionDate = String(body.nextActionDate ?? "").trim();
  const memo = String(body.memo ?? "").trim().slice(0, 2000);
  if (!allowedCaseStatuses.has(collectionStatus)) return Response.json({ error: "지원하지 않는 회수 상태입니다." }, { status: 400 });
  if ((promisedDate && !datePattern.test(promisedDate)) || (nextActionDate && !datePattern.test(nextActionDate))) return Response.json({ error: "약속일과 다음 조치일 형식을 확인해 주세요." }, { status: 400 });
  if (!Number.isSafeInteger(promisedAmount) || promisedAmount < 0 || promisedAmount > source.outstandingAmount) return Response.json({ error: "약속금액은 현재 미수잔액 이내의 금액으로 입력해 주세요." }, { status: 400 });
  if (collectionStatus === "PROMISED" && (!promisedDate || promisedAmount <= 0)) return Response.json({ error: "입금 약속 상태에는 약속일과 약속금액이 필요합니다." }, { status: 400 });
  if (["DISPUTED", "HOLD"].includes(collectionStatus) && !disputeReason) return Response.json({ error: "분쟁·보류 상태에는 사유가 필요합니다." }, { status: 400 });

  const before = await db.prepare("SELECT * FROM finance_receivable_cases WHERE invoice_id = ?").bind(invoiceId).first<CaseRow>();
  const now = Date.now();
  await db.prepare(`INSERT INTO finance_receivable_cases
    (invoice_id, collection_status, owner_employee_id, promised_date, promised_amount, dispute_reason,
      next_action, next_action_date, memo, updated_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(invoice_id) DO UPDATE SET collection_status = excluded.collection_status,
      owner_employee_id = excluded.owner_employee_id, promised_date = excluded.promised_date,
      promised_amount = excluded.promised_amount, dispute_reason = excluded.dispute_reason,
      next_action = excluded.next_action, next_action_date = excluded.next_action_date,
      memo = excluded.memo, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .bind(invoiceId, collectionStatus, ownerEmployeeId, promisedDate, promisedAmount, disputeReason,
      nextAction, nextActionDate, memo, authorization.principal.employeeId, before?.created_at ?? now, now).run();
  const after = await db.prepare("SELECT * FROM finance_receivable_cases WHERE invoice_id = ?").bind(invoiceId).first<CaseRow>();
  await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: before ? "RECEIVABLE_CASE_UPDATED" : "RECEIVABLE_CASE_CREATED", entityType: "receivableInvoice", entityId: invoiceId, before: before ? mapCase(before) : undefined, after: after ? mapCase(after) : undefined });
  return Response.json({ record: after ? mapCase(after) : null });
}

export async function PUT(request: Request) {
  const authorization = await authorizeErpRequest(db, "finance", "write");
  if (authorization.response) return authorization.response;
  await ensureSchema();
  const body = await request.json() as Record<string, unknown>;
  const partnerName = String(body.partnerName ?? "").trim();
  const outstandingAmount = Math.round(Number(body.outstandingAmount ?? Number.NaN));
  const owner = String(body.owner ?? "").trim().slice(0, 50);
  const dueDate = String(body.dueDate ?? "").trim();
  const status = String(body.status ?? "UNSET");
  const memo = String(body.memo ?? "").trim().slice(0, 1000);
  if (!partnerName || partnerName.length > 150 || !Number.isSafeInteger(outstandingAmount) || outstandingAmount < 0 ||
    (dueDate && !datePattern.test(dueDate)) || !allowedLegacyStatuses.has(status)) {
    return Response.json({ error: "기존 회수관리 기록의 입력값을 확인해 주세요." }, { status: 400 });
  }
  const before = await db.prepare("SELECT * FROM finance_receivable_management WHERE partner_name = ?").bind(partnerName).first<LegacyRow>();
  const updatedAt = Date.now();
  await db.prepare(`INSERT INTO finance_receivable_management (partner_name, outstanding_amount, owner, due_date, status, memo, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(partner_name) DO UPDATE SET outstanding_amount = excluded.outstanding_amount,
    owner = excluded.owner, due_date = excluded.due_date, status = excluded.status, memo = excluded.memo, updated_at = excluded.updated_at`)
    .bind(partnerName, outstandingAmount, owner, dueDate, status, memo, updatedAt).run();
  const record = { partnerName, outstandingAmount, owner, dueDate, status, memo, updatedAt };
  await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: before ? "LEGACY_RECEIVABLE_UPDATED" : "LEGACY_RECEIVABLE_CREATED", entityType: "legacyReceivable", entityId: partnerName, before, after: record });
  return Response.json({ record });
}
