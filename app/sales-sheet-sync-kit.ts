import { fetchSheetRanges, googleSheetsConfigured, type SheetCell } from "./google-sheets";

type Bindings = { DB: D1Database; GOOGLE_OAUTH_CLIENT_ID?: string; GOOGLE_OAUTH_CLIENT_SECRET?: string; GOOGLE_OAUTH_REFRESH_TOKEN?: string; GOOGLE_SALES_SHEET_ID?: string };

export type SheetSyncColumn = { name: string; sqlType: string };
export type SheetSyncConfig = {
  // Identifies this sync in the shared sales_sheet_sync_runs log.
  key: string;
  sheetName: string;
  tableName: string;
  // How many leading rows (merged instructions, group headers, the real header row) to skip.
  headerRows: number;
  columns: SheetSyncColumn[];
  // Returns a column-name -> value map matching `columns`, or null to skip a non-data row
  // (section dividers, leftover input-template rows, blank rows).
  parseRow: (row: SheetCell[], rowNumber: number) => Record<string, SheetCell> | null;
  // Columns searched (LIKE) by the free-text search box.
  searchColumns: string[];
  // The column holding the customer/company name, used to build the cross-table account timeline.
  // Omit for tables with no customer concept (e.g. a price catalog).
  customerField?: string;
  // The column used to sort/date-label this table's rows in the account timeline and staleness alerts.
  dateField?: string;
};

export async function ensureSheetSyncRunsSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_sheet_sync_runs (
      id TEXT PRIMARY KEY NOT NULL, sync_key TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, total_rows INTEGER NOT NULL DEFAULT 0,
      imported_rows INTEGER NOT NULL DEFAULT 0, skipped_rows INTEGER NOT NULL DEFAULT 0, error_message TEXT NOT NULL DEFAULT '',
      requested_by TEXT NOT NULL DEFAULT '', started_at INTEGER NOT NULL, finished_at INTEGER
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sales_sheet_sync_started ON sales_sheet_sync_runs (started_at)`),
  ]);
  const columns = await db.prepare("PRAGMA table_info(sales_sheet_sync_runs)").all<{ name: string }>();
  const existing = new Set(columns.results.map((column) => column.name));
  if (!existing.has("sync_key")) await db.prepare("ALTER TABLE sales_sheet_sync_runs ADD COLUMN sync_key TEXT NOT NULL DEFAULT ''").run();
}

export async function ensureSheetSyncTableSchema(db: D1Database, config: SheetSyncConfig) {
  const columnSql = config.columns.map((column) => `${column.name} ${column.sqlType}`).join(", ");
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS ${config.tableName} (
      id TEXT PRIMARY KEY NOT NULL, source_sheet TEXT NOT NULL, source_row INTEGER NOT NULL,
      ${columnSql}, synced_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_${config.tableName}_row ON ${config.tableName} (source_row)`),
  ]);
}

const BATCH_SIZE = 100;

export async function runSheetSync(env: Bindings, config: SheetSyncConfig, requestedBy: string) {
  const db = env.DB;
  if (!googleSheetsConfigured(env)) throw new Error("구글 시트 연동 자격증명이 설정되지 않았습니다.");
  const runId = crypto.randomUUID();
  const startedAt = Date.now();
  await db.prepare(`INSERT INTO sales_sheet_sync_runs (id, sync_key, status, requested_by, started_at) VALUES (?,?,?,?,?)`)
    .bind(runId, config.key, "RUNNING", requestedBy, startedAt).run();

  try {
    const [rows] = await fetchSheetRanges(env, [`'${config.sheetName}'!A1:BZ8000`]);
    const now = Date.now();
    const columnNames = config.columns.map((column) => column.name);
    const records: Array<{ id: string; sourceRow: number; values: Record<string, SheetCell> }> = [];
    rows.slice(config.headerRows).forEach((row, index) => {
      const rowNumber = index + config.headerRows + 1;
      const parsed = config.parseRow(row, rowNumber);
      if (parsed) records.push({ id: `${config.sheetName}:${rowNumber}`, sourceRow: rowNumber, values: parsed });
    });

    const insertSql = `INSERT INTO ${config.tableName} (id, source_sheet, source_row, ${columnNames.join(", ")}, synced_at)
      VALUES (?,?,?,${columnNames.map(() => "?").join(",")},?)
      ON CONFLICT(id) DO UPDATE SET ${columnNames.map((name) => `${name}=excluded.${name}`).join(", ")}, synced_at=excluded.synced_at`;

    let imported = 0;
    for (let offset = 0; offset < records.length; offset += BATCH_SIZE) {
      const chunk = records.slice(offset, offset + BATCH_SIZE);
      await db.batch(chunk.map((record) => db.prepare(insertSql).bind(
        record.id, config.sheetName, record.sourceRow,
        ...columnNames.map((name) => record.values[name] ?? null),
        now,
      )));
      imported += chunk.length;
    }

    const cleanup = await db.prepare(`DELETE FROM ${config.tableName} WHERE synced_at<?`).bind(now).run();
    const removed = cleanup.meta.changes ?? 0;

    await db.prepare(`UPDATE sales_sheet_sync_runs SET status=?, total_rows=?, imported_rows=?, skipped_rows=?, finished_at=? WHERE id=?`)
      .bind("SUCCESS", records.length, imported, removed, Date.now(), runId).run();
    return { runId, totalRows: records.length, importedRows: imported, removedRows: removed };
  } catch (error) {
    const message = error instanceof Error ? error.message : "구글 시트 동기화 중 오류가 발생했습니다.";
    await db.prepare(`UPDATE sales_sheet_sync_runs SET status=?, error_message=?, finished_at=? WHERE id=?`)
      .bind("FAILED", message, Date.now(), runId).run();
    throw error;
  }
}

export async function getSheetSyncStatus(db: D1Database, config: Pick<SheetSyncConfig, "key" | "tableName">) {
  const [latestRun, count] = await Promise.all([
    db.prepare(`SELECT * FROM sales_sheet_sync_runs WHERE sync_key=? ORDER BY started_at DESC LIMIT 1`).bind(config.key).first<Record<string, unknown>>(),
    db.prepare(`SELECT COUNT(*) AS count FROM ${config.tableName}`).first<{ count: number }>(),
  ]);
  return { latestRun: latestRun ?? null, count: count?.count ?? 0 };
}

// Most recent sync runs across every sync pipeline (revenue + all tab syncs), newest first.
export async function getRecentSyncRuns(db: D1Database, limit = 20) {
  const result = await db.prepare(`SELECT * FROM sales_sheet_sync_runs ORDER BY started_at DESC LIMIT ?`).bind(limit).all<Record<string, unknown>>();
  return result.results;
}

// Free-text search across a table's configured searchColumns. Empty query returns the most
// recent rows by source_row, matching the previous unfiltered preview behavior.
export async function searchSheetRecords(db: D1Database, config: Pick<SheetSyncConfig, "tableName" | "searchColumns" | "dateField">, query: string, limit = 50) {
  const trimmed = query.trim();
  if (!trimmed) {
    return db.prepare(`SELECT * FROM ${config.tableName} ORDER BY source_row DESC LIMIT ?`).bind(limit).all<Record<string, unknown>>();
  }
  const clause = config.searchColumns.map((column) => `${column} LIKE ?`).join(" OR ");
  const binds = config.searchColumns.map(() => `%${trimmed}%`);
  const orderBy = config.dateField ? `${config.dateField} DESC, source_row DESC` : "source_row DESC";
  return db.prepare(`SELECT * FROM ${config.tableName} WHERE ${clause} ORDER BY ${orderBy} LIMIT ?`).bind(...binds, limit).all<Record<string, unknown>>();
}

// Helpers shared by every tab's parseRow implementation.
export function text(cell: SheetCell | undefined) {
  if (cell == null) return "";
  return String(cell).trim();
}
export function num(cell: SheetCell | undefined) {
  if (typeof cell === "number") return cell;
  const parsed = Number(String(cell ?? "0").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
// Sheets UNFORMATTED_VALUE returns dates as a day-count serial (epoch 1899-12-30). Falls back to
// scraping a leading "YYYY. M. D" pattern out of messy free-text date/note cells.
export function dateValue(cell: SheetCell | undefined) {
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
