import { fetchSheetRanges, googleSheetsConfigured, type SheetCell } from "./google-sheets";
import { ensureSheetSyncRunsSchema } from "./sales-sheet-sync-kit";

type Bindings = { DB: D1Database; GOOGLE_OAUTH_CLIENT_ID?: string; GOOGLE_OAUTH_CLIENT_SECRET?: string; GOOGLE_OAUTH_REFRESH_TOKEN?: string; GOOGLE_SALES_SHEET_ID?: string };

const SYNC_KEY = "revenue";

export async function ensureSalesSheetSyncSchema(db: D1Database) {
  await ensureSheetSyncRunsSchema(db);
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_sheet_revenue_records (
      id TEXT PRIMARY KEY NOT NULL, source_sheet TEXT NOT NULL, source_row INTEGER NOT NULL, deal_status TEXT NOT NULL,
      rep TEXT NOT NULL DEFAULT '', order_date TEXT NOT NULL DEFAULT '', invoice_date TEXT NOT NULL DEFAULT '',
      customer_name TEXT NOT NULL DEFAULT '', end_customer_name TEXT NOT NULL DEFAULT '', item TEXT NOT NULL DEFAULT '',
      quantity REAL NOT NULL DEFAULT 0, cost INTEGER NOT NULL DEFAULT 0, purchase_total INTEGER NOT NULL DEFAULT 0,
      sale_price INTEGER NOT NULL DEFAULT 0, sale_total INTEGER NOT NULL DEFAULT 0, expense INTEGER NOT NULL DEFAULT 0,
      margin INTEGER NOT NULL DEFAULT 0, vat_included_amount INTEGER NOT NULL DEFAULT 0,
      collection_due_date TEXT NOT NULL DEFAULT '', collected_date TEXT NOT NULL DEFAULT '',
      purchase_vat_included_amount INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '',
      shipping_fee INTEGER NOT NULL DEFAULT 0, fee INTEGER NOT NULL DEFAULT 0, insurance_etc INTEGER NOT NULL DEFAULT 0,
      account_ext_id TEXT NOT NULL DEFAULT '', rep_ext_id TEXT NOT NULL DEFAULT '', end_customer_ext_id TEXT NOT NULL DEFAULT '',
      synced_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sales_sheet_revenue_sheet_row ON sales_sheet_revenue_records (source_sheet, source_row)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sales_sheet_revenue_status ON sales_sheet_revenue_records (deal_status)`),
  ]);
}

const SHEET_TABS: Array<{ name: string; dealStatus: "CONFIRMED" | "IN_PROGRESS" }> = [
  { name: "26년 매출", dealStatus: "CONFIRMED" },
  { name: "진행 딜", dealStatus: "IN_PROGRESS" },
];

function text(cell: SheetCell | undefined) {
  if (cell == null) return "";
  return String(cell).trim();
}
function num(cell: SheetCell | undefined) {
  if (typeof cell === "number") return cell;
  const parsed = Number(String(cell ?? "0").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
// Sheets UNFORMATTED_VALUE returns dates as a day-count serial (epoch 1899-12-30). Falls back to
// scraping a leading "YYYY. M. D" pattern out of messy free-text date/note cells.
function dateValue(cell: SheetCell | undefined) {
  if (typeof cell === "number" && cell > 0) {
    const ms = Math.round((cell - 25569) * 86400000);
    const date = new Date(ms);
    if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  }
  const raw = text(cell);
  const match = raw.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  if (match) return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  return raw;
}

function parseRow(row: SheetCell[], sheetName: string, dealStatus: "CONFIRMED" | "IN_PROGRESS", rowNumber: number) {
  const customer = text(row[3]);
  const item = text(row[5]);
  // Section-divider / blank rows (e.g. "----확정딜----") have neither a customer nor an item — skip them.
  if (!customer && !item) return null;
  // Some sheets have a leftover "양식" (blank input template) row pasted mid-range with the column
  // labels typed in as literal example text ("매출처" / "품목") instead of real deal data — skip it.
  if (customer === "매출처" || item === "품목") return null;
  const id = `${sheetName}:${rowNumber}`;
  return {
    id, source_sheet: sheetName, source_row: rowNumber, deal_status: dealStatus,
    rep: text(row[0]), order_date: dateValue(row[1]), invoice_date: dateValue(row[2]),
    customer_name: customer, end_customer_name: text(row[4]), item,
    quantity: num(row[6]), cost: Math.round(num(row[7])), purchase_total: Math.round(num(row[8])),
    sale_price: Math.round(num(row[9])), sale_total: Math.round(num(row[10])), expense: Math.round(num(row[11])),
    margin: Math.round(num(row[12])), vat_included_amount: Math.round(num(row[13])),
    collection_due_date: dateValue(row[14]), collected_date: dateValue(row[15]),
    purchase_vat_included_amount: Math.round(num(row[16])), note: text(row[17]),
    shipping_fee: Math.round(num(row[18])), fee: Math.round(num(row[19])), insurance_etc: Math.round(num(row[20])),
    account_ext_id: text(row[22]), rep_ext_id: text(row[23]), end_customer_ext_id: text(row[24]),
  };
}

const UPSERT_SQL = `INSERT INTO sales_sheet_revenue_records (
    id, source_sheet, source_row, deal_status, rep, order_date, invoice_date, customer_name, end_customer_name, item,
    quantity, cost, purchase_total, sale_price, sale_total, expense, margin, vat_included_amount,
    collection_due_date, collected_date, purchase_vat_included_amount, note, shipping_fee, fee, insurance_etc,
    account_ext_id, rep_ext_id, end_customer_ext_id, synced_at
  ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  ON CONFLICT(id) DO UPDATE SET
    deal_status=excluded.deal_status, rep=excluded.rep, order_date=excluded.order_date, invoice_date=excluded.invoice_date,
    customer_name=excluded.customer_name, end_customer_name=excluded.end_customer_name, item=excluded.item,
    quantity=excluded.quantity, cost=excluded.cost, purchase_total=excluded.purchase_total, sale_price=excluded.sale_price,
    sale_total=excluded.sale_total, expense=excluded.expense, margin=excluded.margin, vat_included_amount=excluded.vat_included_amount,
    collection_due_date=excluded.collection_due_date, collected_date=excluded.collected_date,
    purchase_vat_included_amount=excluded.purchase_vat_included_amount, note=excluded.note, shipping_fee=excluded.shipping_fee,
    fee=excluded.fee, insurance_etc=excluded.insurance_etc, account_ext_id=excluded.account_ext_id,
    rep_ext_id=excluded.rep_ext_id, end_customer_ext_id=excluded.end_customer_ext_id, synced_at=excluded.synced_at`;

const BATCH_SIZE = 100;

export async function runSalesSheetSync(env: Bindings, requestedBy: string) {
  const db = env.DB;
  if (!googleSheetsConfigured(env)) throw new Error("구글 시트 연동 자격증명이 설정되지 않았습니다.");
  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  await db.prepare(`INSERT INTO sales_sheet_sync_runs (id, sync_key, status, requested_by, started_at) VALUES (?,?,?,?,?)`)
    .bind(runId, SYNC_KEY, "RUNNING", requestedBy, startedAt).run();

  try {
    const ranges = SHEET_TABS.map((tab) => `'${tab.name}'!A1:BA6000`);
    const valueRanges = await fetchSheetRanges(env, ranges);
    const now = Date.now();
    const records: Array<NonNullable<ReturnType<typeof parseRow>>> = [];
    SHEET_TABS.forEach((tab, tabIndex) => {
      const rows = valueRanges[tabIndex] ?? [];
      // Row 1 is the header; sheet row numbers are 1-based, so data starts at row 2.
      rows.slice(1).forEach((row, index) => {
        const parsed = parseRow(row, tab.name, tab.dealStatus, index + 2);
        if (parsed) records.push(parsed);
      });
    });

    let imported = 0;
    for (let offset = 0; offset < records.length; offset += BATCH_SIZE) {
      const chunk = records.slice(offset, offset + BATCH_SIZE);
      await db.batch(chunk.map((record) => db.prepare(UPSERT_SQL).bind(
        record.id, record.source_sheet, record.source_row, record.deal_status, record.rep, record.order_date, record.invoice_date,
        record.customer_name, record.end_customer_name, record.item, record.quantity, record.cost, record.purchase_total,
        record.sale_price, record.sale_total, record.expense, record.margin, record.vat_included_amount,
        record.collection_due_date, record.collected_date, record.purchase_vat_included_amount, record.note,
        record.shipping_fee, record.fee, record.insurance_etc, record.account_ext_id, record.rep_ext_id, record.end_customer_ext_id, now,
      )));
      imported += chunk.length;
    }

    // Rows untouched by this run (synced_at still older than "now") no longer parse as valid deal
    // rows — removed, reordered, or newly recognized as a non-data template row — so drop them.
    const cleanup = await db.batch(SHEET_TABS.map((tab) => db.prepare(
      `DELETE FROM sales_sheet_revenue_records WHERE source_sheet=? AND synced_at<?`,
    ).bind(tab.name, now)));
    const removed = cleanup.reduce((sum, result) => sum + (result.meta.changes ?? 0), 0);

    await db.prepare(`UPDATE sales_sheet_sync_runs SET status=?, total_rows=?, imported_rows=?, skipped_rows=?, finished_at=? WHERE id=?`)
      .bind("SUCCESS", records.length, imported, removed, Date.now(), runId).run();
    return { runId, totalRows: records.length, importedRows: imported };
  } catch (error) {
    const message = error instanceof Error ? error.message : "구글 시트 동기화 중 오류가 발생했습니다.";
    await db.prepare(`UPDATE sales_sheet_sync_runs SET status=?, error_message=?, finished_at=? WHERE id=?`)
      .bind("FAILED", message, Date.now(), runId).run();
    throw error;
  }
}

export async function getSalesSheetSyncStatus(db: D1Database) {
  const [latestRun, summary] = await Promise.all([
    db.prepare(`SELECT * FROM sales_sheet_sync_runs WHERE sync_key=? ORDER BY started_at DESC LIMIT 1`).bind(SYNC_KEY).first<Record<string, unknown>>(),
    db.prepare(`SELECT deal_status, COUNT(*) AS count, SUM(sale_total) AS sale_total FROM sales_sheet_revenue_records GROUP BY deal_status`).all<{ deal_status: string; count: number; sale_total: number }>(),
  ]);
  return { latestRun: latestRun ?? null, summary: summary.results };
}
