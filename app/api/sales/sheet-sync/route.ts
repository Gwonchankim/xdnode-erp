import { env } from "cloudflare:workers";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";
import { ensureSalesSheetSyncSchema, getSalesSheetSyncStatus, runSalesSheetSync } from "../../../sales-sheet-sync";
import { googleSheetsConfigured } from "../../../google-sheets";
import { ensureSheetSyncTableSchema, getRecentSyncRuns, getSheetSyncStatus, runSheetSync, searchSheetRecords } from "../../../sales-sheet-sync-kit";
import { ALL_TAB_SYNCS } from "../../../sales-sheet-tabs";
import { ensureLeadConversionSchema, getLeadConversions } from "../../../sales-sheet-lead-conversion";

type Bindings = { DB: D1Database; GOOGLE_OAUTH_CLIENT_ID?: string; GOOGLE_OAUTH_CLIENT_SECRET?: string; GOOGLE_OAUTH_REFRESH_TOKEN?: string; GOOGLE_SALES_SHEET_ID?: string };
const bindings = env as unknown as Bindings;
const db = bindings.DB;

async function ensureAllSchema() {
  await ensureSalesSheetSyncSchema(db);
  await Promise.all(ALL_TAB_SYNCS.map((config) => ensureSheetSyncTableSchema(db, config)));
  await ensureLeadConversionSchema(db);
}

async function searchRevenueRecords(query: string, limit: number) {
  const trimmed = query.trim();
  if (!trimmed) return db.prepare(`SELECT * FROM sales_sheet_revenue_records ORDER BY order_date DESC, source_row DESC LIMIT ?`).bind(limit).all<Record<string, unknown>>();
  const like = `%${trimmed}%`;
  return db.prepare(`SELECT * FROM sales_sheet_revenue_records
    WHERE customer_name LIKE ? OR end_customer_name LIKE ? OR item LIKE ? OR rep LIKE ?
    ORDER BY order_date DESC, source_row DESC LIMIT ?`).bind(like, like, like, like, limit).all<Record<string, unknown>>();
}

async function view(query = "") {
  const limit = query.trim() ? 200 : 50;
  const [{ latestRun, summary }, records, tabs, recentRuns] = await Promise.all([
    getSalesSheetSyncStatus(db),
    searchRevenueRecords(query, limit),
    Promise.all(ALL_TAB_SYNCS.map(async (config) => {
      const [{ latestRun: tabLatestRun, count }, tabRecords] = await Promise.all([
        getSheetSyncStatus(db, config),
        searchSheetRecords(db, config, query, limit),
      ]);
      let records = tabRecords.results;
      if (config.key === "inbound_lead") {
        const conversions = await getLeadConversions(db, records.map((row) => String(row.id)));
        records = records.map((row) => ({ ...row, converted: conversions.has(String(row.id)), opportunityId: conversions.get(String(row.id))?.opportunity_id ?? null }));
      }
      return { key: config.key, sheetName: config.sheetName, tableName: config.tableName, latestRun: tabLatestRun, count, records };
    })),
    getRecentSyncRuns(db, 20),
  ]);
  return { configured: googleSheetsConfigured(bindings), latestRun, summary, records: records.results, tabs, query, recentRuns };
}

export async function GET(request: Request) {
  const authorization = await authorizeErpRequest(db, "sales", "read");
  if (authorization.response) return authorization.response;
  await ensureAllSchema();
  const query = new URL(request.url).searchParams.get("q") ?? "";
  return Response.json(await view(query));
}

export async function POST(request: Request) {
  const authorization = await authorizeErpRequest(db, "sales", "write");
  if (authorization.response) return authorization.response;
  await ensureAllSchema();
  // "only" lets a rep re-pull a single sheet (e.g. just AS) instead of all 7 — useful when only
  // one tab changed and the others are large enough that a full sync is slow.
  const only = new URL(request.url).searchParams.get("only") ?? "";
  try {
    if (only && only !== "revenue") {
      const config = ALL_TAB_SYNCS.find((entry) => entry.key === only);
      if (!config) return Response.json({ error: "알 수 없는 동기화 대상입니다." }, { status: 400 });
      const result = await runSheetSync(bindings, config, authorization.principal.employeeId);
      await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SHEET_SYNC", entityType: "SALES_SHEET_SYNC_RUN", entityId: result.runId, after: { [only]: result } });
      return Response.json(await view());
    }
    if (only === "revenue") {
      const result = await runSalesSheetSync(bindings, authorization.principal.employeeId);
      await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SHEET_SYNC", entityType: "SALES_SHEET_SYNC_RUN", entityId: result.runId, after: { revenue: result } });
      return Response.json(await view());
    }
    const revenueResult = await runSalesSheetSync(bindings, authorization.principal.employeeId);
    const tabResults = await Promise.all(ALL_TAB_SYNCS.map((config) => runSheetSync(bindings, config, authorization.principal.employeeId)));
    const after = { revenue: revenueResult, tabs: Object.fromEntries(ALL_TAB_SYNCS.map((config, index) => [config.key, tabResults[index]])) };
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SHEET_SYNC", entityType: "SALES_SHEET_SYNC_RUN", entityId: revenueResult.runId, after });
    return Response.json(await view());
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "구글 시트 동기화에 실패했습니다." }, { status: 502 });
  }
}
