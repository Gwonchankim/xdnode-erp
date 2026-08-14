import { env } from "cloudflare:workers";
import { authorizeErpRequest } from "../../../erp-platform";
import { financeCurrentData } from "../../../finance-current-data";
import { financeHistoricalData } from "../../../finance-historical-data";
import { ensureFinancePostingSchema } from "../../../finance-posting";
import { buildLedgerAccountSummaries, generalLedgerAccountKey, type LedgerAccountSummary, type UnifiedLedgerRow } from "../../../finance-general-ledger";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;
const currentAsOf = financeCurrentData.asOf;
const validDate = (value: string) => /^2026-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)
  && !Number.isNaN(new Date(`${value}T00:00:00Z`).valueOf())
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

async function ensureSchemas() {
  await ensureFinancePostingSchema(db);
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_journal_entries (
      id TEXT PRIMARY KEY NOT NULL, payment_request_id TEXT NOT NULL UNIQUE, voucher_date TEXT NOT NULL,
      description TEXT NOT NULL, debit_account_code TEXT NOT NULL DEFAULT '', debit_account_name TEXT NOT NULL,
      credit_account_code TEXT NOT NULL DEFAULT '', credit_account_name TEXT NOT NULL, amount INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT', prepared_by TEXT NOT NULL, posted_by TEXT NOT NULL DEFAULT '',
      posted_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_journal_status_date ON finance_journal_entries(status, voucher_date)"),
  ]);
}

async function ledgerRows(from: string, to: string) {
  const [controlled, payments] = await Promise.all([
    db.prepare(`SELECT line.id, batch.id AS source_id, voucher.voucher_date, voucher.voucher_number,
      line.line_number, line.account_id, line.account_code, line.account_name, line.partner_name,
      line.department_name, line.description, line.debit_amount, line.credit_amount, batch.posted_at
      FROM finance_posting_lines line
      JOIN finance_posting_vouchers voucher ON voucher.id=line.voucher_id AND voucher.status='POSTED'
      JOIN finance_posting_batches batch ON batch.id=voucher.batch_id AND batch.status='POSTED'
      WHERE voucher.voucher_date BETWEEN ? AND ?
      ORDER BY voucher.voucher_date DESC, voucher.voucher_number DESC, line.line_number`)
      .bind(from, to).all<Record<string, unknown>>(),
    db.prepare(`SELECT id,payment_request_id,voucher_date,description,debit_account_code,debit_account_name,
      credit_account_code,credit_account_name,amount,posted_at
      FROM finance_journal_entries WHERE status='POSTED' AND voucher_date BETWEEN ? AND ?
      ORDER BY voucher_date DESC,created_at DESC`).bind(from, to).all<Record<string, unknown>>(),
  ]);
  const rows: UnifiedLedgerRow[] = controlled.results.map((row) => ({
    id: String(row.id), sourceType: "CONTROLLED_POSTING", sourceId: String(row.source_id),
    voucherDate: String(row.voucher_date), voucherNumber: String(row.voucher_number), lineNumber: Number(row.line_number),
    accountId: String(row.account_id), accountCode: String(row.account_code), accountName: String(row.account_name),
    partnerName: String(row.partner_name ?? ""), departmentName: String(row.department_name ?? ""),
    description: String(row.description ?? ""), debitAmount: Number(row.debit_amount), creditAmount: Number(row.credit_amount),
    postedAt: row.posted_at == null ? null : Number(row.posted_at),
  }));
  for (const row of payments.results) {
    const common = { sourceType: "PAYMENT_JOURNAL" as const, sourceId: String(row.payment_request_id),
      voucherDate: String(row.voucher_date), voucherNumber: `PAY-${String(row.id).slice(0, 8).toUpperCase()}`,
      accountId: "", partnerName: "", departmentName: "", description: String(row.description ?? ""),
      postedAt: row.posted_at == null ? null : Number(row.posted_at) };
    rows.push({ ...common, id: `${row.id}:D`, lineNumber: 1, accountCode: String(row.debit_account_code ?? ""),
      accountName: String(row.debit_account_name), debitAmount: Number(row.amount), creditAmount: 0 });
    rows.push({ ...common, id: `${row.id}:C`, lineNumber: 2, accountCode: String(row.credit_account_code ?? ""),
      accountName: String(row.credit_account_name), debitAmount: 0, creditAmount: Number(row.amount) });
  }
  return rows.sort((a, b) => b.voucherDate.localeCompare(a.voucherDate)
    || b.voucherNumber.localeCompare(a.voucherNumber) || a.lineNumber - b.lineNumber);
}

const sum = (rows: LedgerAccountSummary[], key: keyof LedgerAccountSummary) => rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
function csvCell(value: unknown) {
  let content = String(value ?? "");
  if (typeof value === "string" && /^[=+\-@]/.test(content)) content = `'${content}`;
  return `"${content.replaceAll('"', '""')}"`;
}

export async function GET(request: Request) {
  const authorization = await authorizeErpRequest(db, "finance", "read");
  if (authorization.response) return authorization.response;
  await ensureSchemas();
  const url = new URL(request.url); const from = url.searchParams.get("from")?.trim() || "2026-01-01";
  const to = url.searchParams.get("to")?.trim() || currentAsOf;
  if (!validDate(from) || !validDate(to) || from > to || to > currentAsOf) {
    return Response.json({ error: `2026-01-01부터 ${currentAsOf} 사이의 조회기간을 선택해 주세요.` }, { status: 400 });
  }
  const ytdRows = await ledgerRows("2026-01-01", to); const periodRows = ytdRows.filter((row) => row.voucherDate >= from);
  const accounts = buildLedgerAccountSummaries(financeHistoricalData.trialBalance2025, ytdRows, from);
  const openingDebit = sum(accounts, "openingDebit"); const openingCredit = sum(accounts, "openingCredit");
  const periodDebit = sum(accounts, "periodDebit"); const periodCredit = sum(accounts, "periodCredit");
  const endingDebit = sum(accounts, "endingDebit"); const endingCredit = sum(accounts, "endingCredit");
  const account = url.searchParams.get("account")?.trim() || ""; const query = url.searchParams.get("q")?.trim().toLowerCase() || "";
  const filteredRows = periodRows.filter((row) => (!account || generalLedgerAccountKey(row.accountCode, row.accountName) === account)
    && (!query || `${row.voucherNumber} ${row.accountCode} ${row.accountName} ${row.partnerName} ${row.description}`.toLowerCase().includes(query)));
  if (url.searchParams.get("format") === "csv") {
    const header = ["전표일", "전표번호", "행", "계정코드", "계정명", "거래처", "부서", "적요", "차변", "대변", "원천"];
    const body = filteredRows.map((row) => [row.voucherDate, row.voucherNumber, row.lineNumber, row.accountCode,
      row.accountName, row.partnerName, row.departmentName, row.description, row.debitAmount, row.creditAmount,
      row.sourceType === "CONTROLLED_POSTING" ? "통제 분개" : "지급 전표"].map(csvCell).join(","));
    return new Response(`\uFEFF${[header.map(csvCell).join(","), ...body].join("\r\n")}`, { headers: {
      "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="xdnode-general-ledger-${from}-${to}.csv"`,
      "Cache-Control": "no-store",
    } });
  }
  const limit = Math.min(500, Math.max(50, Number(url.searchParams.get("limit") || 200)));
  return Response.json({ asOf: currentAsOf, from, to, accounts, rows: filteredRows.slice(0, limit),
    pagination: { returned: Math.min(filteredRows.length, limit), total: filteredRows.length, limit },
    totals: { openingDebit, openingCredit, openingDifference: openingDebit - openingCredit, periodDebit, periodCredit,
      periodDifference: periodDebit - periodCredit, endingDebit, endingCredit, endingDifference: endingDebit - endingCredit },
    sources: { opening: { label: from === "2026-01-01" ? "2025 결산후 합계잔액시산표" : "2025 결산 기준선 + 시작일 전 전기 누적",
      asOf: new Date(new Date(`${from}T00:00:00Z`).valueOf() - 86_400_000).toISOString().slice(0, 10), immutableReference: true },
      controlledPostingLines: periodRows.filter((row) => row.sourceType === "CONTROLLED_POSTING").length,
      paymentJournalLines: periodRows.filter((row) => row.sourceType === "PAYMENT_JOURNAL").length,
      postedOnly: true, stagedOrClobeRowsIncluded: false },
    controls: { balanced: openingDebit === openingCredit && periodDebit === periodCredit && endingDebit === endingCredit,
      openingApprovedReference: true, sourceMutation: false, directClobePosting: false } });
}
