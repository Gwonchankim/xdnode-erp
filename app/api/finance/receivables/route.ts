import { env } from "cloudflare:workers";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";

type FinanceBindings = { DB: D1Database };
type ReceivableRow = {
  partner_name: string;
  outstanding_amount: number;
  owner: string;
  due_date: string;
  status: string;
  memo: string;
  updated_at: number;
};

const db = (env as unknown as FinanceBindings).DB;
const allowedStatuses = new Set(["UNSET", "PLANNED", "PARTIAL", "OVERDUE", "HOLD", "COMPLETE"]);

async function ensureSchema() {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_receivable_management (
      partner_name TEXT PRIMARY KEY,
      outstanding_amount INTEGER NOT NULL,
      owner TEXT NOT NULL DEFAULT '',
      due_date TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'UNSET',
      memo TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_finance_receivable_status_due
      ON finance_receivable_management (status, due_date)`),
  ]);
}

function toRecord(row: ReceivableRow) {
  return {
    partnerName: row.partner_name,
    outstandingAmount: row.outstanding_amount,
    owner: row.owner,
    dueDate: row.due_date,
    status: row.status,
    memo: row.memo,
    updatedAt: row.updated_at,
  };
}

export async function GET() {
  const auth = await authorizeErpRequest(db, "finance", "read");
  if (auth.response) return auth.response;
  await ensureSchema();
  const result = await db.prepare(`SELECT partner_name, outstanding_amount, owner, due_date,
      status, memo, updated_at
    FROM finance_receivable_management
    ORDER BY CASE status WHEN 'OVERDUE' THEN 0 WHEN 'HOLD' THEN 1 WHEN 'UNSET' THEN 2 ELSE 3 END,
      due_date ASC, outstanding_amount DESC`).all<ReceivableRow>();
  return Response.json({ records: result.results.map(toRecord) });
}

export async function PUT(request: Request) {
  const auth = await authorizeErpRequest(db, "finance", "write");
  if (auth.response) return auth.response;
  await ensureSchema();
  const body = await request.json() as Record<string, unknown>;
  const partnerName = typeof body.partnerName === "string" ? body.partnerName.trim() : "";
  const outstandingAmount = typeof body.outstandingAmount === "number" ? Math.round(body.outstandingAmount) : Number.NaN;
  const owner = typeof body.owner === "string" ? body.owner.trim().slice(0, 50) : "";
  const dueDate = typeof body.dueDate === "string" ? body.dueDate.trim() : "";
  const status = typeof body.status === "string" ? body.status : "UNSET";
  const memo = typeof body.memo === "string" ? body.memo.trim().slice(0, 1000) : "";

  if (!partnerName || partnerName.length > 150) {
    return Response.json({ error: "거래처명을 확인해 주세요." }, { status: 400 });
  }
  if (!Number.isSafeInteger(outstandingAmount) || outstandingAmount < 0) {
    return Response.json({ error: "미수잔액은 0원 이상의 정수로 입력해 주세요." }, { status: 400 });
  }
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return Response.json({ error: "회수예정일 형식을 확인해 주세요." }, { status: 400 });
  }
  if (!allowedStatuses.has(status)) {
    return Response.json({ error: "지원하지 않는 회수상태입니다." }, { status: 400 });
  }

  const updatedAt = Date.now();
  const before = await db.prepare(`SELECT partner_name, outstanding_amount, owner, due_date,
      status, memo, updated_at FROM finance_receivable_management
    WHERE partner_name = ?`).bind(partnerName).first<ReceivableRow>();
  await db.prepare(`INSERT INTO finance_receivable_management
      (partner_name, outstanding_amount, owner, due_date, status, memo, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(partner_name) DO UPDATE SET
      outstanding_amount = excluded.outstanding_amount,
      owner = excluded.owner,
      due_date = excluded.due_date,
      status = excluded.status,
      memo = excluded.memo,
      updated_at = excluded.updated_at`)
    .bind(partnerName, outstandingAmount, owner, dueDate, status, memo, updatedAt).run();

  const record = toRecord({
    partner_name: partnerName,
    outstanding_amount: outstandingAmount,
    owner,
    due_date: dueDate,
    status,
    memo,
    updated_at: updatedAt,
  });
  await writeErpAudit(db, {
    principal: auth.principal,
    module: "finance",
    action: before ? "UPDATE" : "CREATE",
    entityType: "RECEIVABLE_MANAGEMENT",
    entityId: partnerName,
    before: before ? toRecord(before) : undefined,
    after: record,
  });
  return Response.json({ record });
}
