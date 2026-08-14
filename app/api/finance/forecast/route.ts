import { env } from "cloudflare:workers";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";
import { financeCurrentData } from "../../../finance-current-data";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;
type Scenario = "BASE" | "CONSERVATIVE" | "OPTIMISTIC";
type ForecastItem = {
  sourceType: string; sourceId: string; expectedDate: string; direction: "INFLOW" | "OUTFLOW";
  category: string; counterparty: string; amount: number; probability: number; status: string;
  dateQuality: "EXACT" | "FALLBACK_REQUEST_DATE" | "MISSING"; memo: string;
};
type SettingsRow = {
  id: string; minimum_cash_balance: number; include_fx: number; default_scenario: Scenario;
  collection_probability: number; updated_by: string; created_at: number; updated_at: number;
};

async function ensureSchema() {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_cash_forecast_settings (
      id TEXT PRIMARY KEY NOT NULL, minimum_cash_balance INTEGER NOT NULL DEFAULT 0,
      include_fx INTEGER NOT NULL DEFAULT 0, default_scenario TEXT NOT NULL DEFAULT 'BASE',
      collection_probability INTEGER NOT NULL DEFAULT 85, updated_by TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_cash_forecast_snapshots (
      id TEXT PRIMARY KEY NOT NULL, as_of TEXT NOT NULL, scenario TEXT NOT NULL,
      opening_cash INTEGER NOT NULL, projected_ending_cash INTEGER NOT NULL, lowest_cash INTEGER NOT NULL,
      minimum_cash_balance INTEGER NOT NULL DEFAULT 0, low_week_count INTEGER NOT NULL DEFAULT 0,
      missing_date_count INTEGER NOT NULL DEFAULT 0,
      buckets_json TEXT NOT NULL DEFAULT '[]', source_counts_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_cash_forecast_snapshot_asof_scenario ON finance_cash_forecast_snapshots(as_of, scenario)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_cash_forecast_snapshot_updated ON finance_cash_forecast_snapshots(updated_at)"),
  ]);
}

async function getSettings() {
  const now = Date.now();
  await db.prepare(`INSERT OR IGNORE INTO finance_cash_forecast_settings
    (id, minimum_cash_balance, include_fx, default_scenario, collection_probability,
      updated_by, created_at, updated_at) VALUES ('default', 0, 0, 'BASE', 85, '', ?, ?)`)
    .bind(now, now).run();
  return db.prepare("SELECT * FROM finance_cash_forecast_settings WHERE id = 'default'").first<SettingsRow>();
}

const validDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
const addDays = (value: string, days: number) => new Date(Date.parse(`${value}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

function scenarioProbability(item: ForecastItem, scenario: Scenario) {
  if (scenario === "CONSERVATIVE") return item.direction === "INFLOW" ? Math.max(0, item.probability - 25) : 100;
  if (scenario === "OPTIMISTIC") return item.direction === "INFLOW" ? Math.min(100, item.probability + 15) : item.probability;
  return item.probability;
}

async function loadForecastItems(collectionProbability: number) {
  const [manual, expenses, purchaseInvoices, salesInvoices] = await Promise.all([
    db.prepare(`SELECT id, expected_date, direction, category, counterparty, amount, probability,
      status, source_type, source_id, memo FROM finance_cash_forecast_items
      WHERE status IN ('EXPECTED','CONFIRMED') ORDER BY expected_date`).all<{
        id: string; expected_date: string; direction: "INFLOW" | "OUTFLOW"; category: string;
        counterparty: string; amount: number; probability: number; status: string; source_type: string;
        source_id: string; memo: string;
      }>(),
    db.prepare(`SELECT id, title, vendor, amount, requested_date, due_date, status, source_type, source_id, memo
      FROM finance_expense_requests WHERE status IN ('DRAFT','SUBMITTED','APPROVED') ORDER BY due_date, requested_date`).all<{
        id: string; title: string; vendor: string; amount: number; requested_date: string; due_date: string;
        status: string; source_type: string; source_id: string; memo: string;
      }>(),
    db.prepare(`SELECT invoice.id, invoice.invoice_number, invoice.invoice_date, invoice.due_date,
      invoice.total_amount, invoice.status, vendor.name AS vendor_name FROM finance_purchase_invoices invoice
      JOIN finance_purchase_orders purchase_order ON purchase_order.id = invoice.order_id
      JOIN finance_purchase_vendors vendor ON vendor.id = purchase_order.vendor_id
      WHERE invoice.status IN ('MATCHED','PAYMENT_READY')
        AND NOT EXISTS (SELECT 1 FROM finance_expense_requests expense
          WHERE expense.source_type = 'PURCHASE_INVOICE' AND expense.source_id = invoice.id
            AND expense.status NOT IN ('CANCELLED','PAID'))
      ORDER BY invoice.due_date, invoice.invoice_date`).all<{
        id: string; invoice_number: string; invoice_date: string; due_date: string; total_amount: number;
        status: string; vendor_name: string;
      }>(),
    db.prepare(`SELECT * FROM (SELECT invoice.id, invoice.document_number, invoice.due_date,
      invoice.amount - COALESCE((SELECT SUM(allocation.amount) FROM sales_payment_allocations allocation
        JOIN sales_documents payment ON payment.id = allocation.payment_document_id
        WHERE allocation.invoice_document_id = invoice.id AND payment.status <> 'CANCELLED'), 0) AS outstanding_amount,
      account.name AS account_name, opportunity.title AS opportunity_title
      FROM sales_documents invoice JOIN sales_opportunities opportunity ON opportunity.id = invoice.opportunity_id
      LEFT JOIN sales_accounts account ON account.id = opportunity.account_id
      WHERE invoice.document_type = 'INVOICE' AND invoice.status IN ('ACCEPTED','COMPLETED'))
      WHERE outstanding_amount > 0 ORDER BY due_date`).all<{
        id: string; document_number: string; due_date: string; outstanding_amount: number;
        account_name: string | null; opportunity_title: string;
      }>(),
  ]);
  const items: ForecastItem[] = [];
  for (const item of manual.results) items.push({ sourceType: item.source_type || "MANUAL", sourceId: item.source_id || item.id,
    expectedDate: item.expected_date, direction: item.direction, category: item.category, counterparty: item.counterparty,
    amount: item.amount, probability: item.status === "CONFIRMED" ? 100 : item.probability, status: item.status,
    dateQuality: validDate(item.expected_date) ? "EXACT" : "MISSING", memo: item.memo });
  for (const item of expenses.results) {
    const expectedDate = validDate(item.due_date) ? item.due_date : validDate(item.requested_date) ? item.requested_date : "";
    items.push({ sourceType: "FINANCE_EXPENSE", sourceId: item.id, expectedDate, direction: "OUTFLOW",
      category: item.source_type === "PAYROLL_RUN" ? "급여" : item.source_type === "PURCHASE_INVOICE" ? "매입채무" : "지출·지급",
      counterparty: item.vendor || item.title, amount: item.amount,
      probability: item.status === "APPROVED" ? 100 : item.status === "SUBMITTED" ? 80 : 50, status: item.status,
      dateQuality: validDate(item.due_date) ? "EXACT" : expectedDate ? "FALLBACK_REQUEST_DATE" : "MISSING",
      memo: item.memo });
  }
  for (const item of purchaseInvoices.results) items.push({ sourceType: "PURCHASE_INVOICE", sourceId: item.id,
    expectedDate: validDate(item.due_date) ? item.due_date : "", direction: "OUTFLOW", category: "매입채무",
    counterparty: item.vendor_name, amount: item.total_amount, probability: item.status === "PAYMENT_READY" ? 100 : 90,
    status: item.status, dateQuality: validDate(item.due_date) ? "EXACT" : "MISSING", memo: item.invoice_number });
  for (const item of salesInvoices.results) items.push({ sourceType: "SALES_INVOICE", sourceId: item.id,
    expectedDate: validDate(item.due_date) ? item.due_date : "", direction: "INFLOW", category: "미수금 회수",
    counterparty: item.account_name || item.opportunity_title, amount: item.outstanding_amount,
    probability: collectionProbability, status: "OUTSTANDING", dateQuality: validDate(item.due_date) ? "EXACT" : "MISSING",
    memo: item.document_number });
  return items;
}

export async function GET(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "finance", "read");
  if (authorization.response) return authorization.response;
  const settings = await getSettings();
  if (!settings) return Response.json({ error: "자금예측 설정을 초기화하지 못했습니다." }, { status: 500 });
  const requestedScenario = new URL(request.url).searchParams.get("scenario")?.toUpperCase();
  const scenario: Scenario = ["BASE", "CONSERVATIVE", "OPTIMISTIC"].includes(requestedScenario ?? "")
    ? requestedScenario as Scenario : settings.default_scenario;
  const items = await loadForecastItems(settings.collection_probability);
  const startDate = financeCurrentData.asOf;
  const endDate = addDays(startDate, 90);
  const openingCash = financeCurrentData.accountSummary.checkingBalanceSum
    + (settings.include_fx ? financeCurrentData.accountSummary.fxBalanceSumKrw : 0);
  const includedItems = items.filter((item) => item.expectedDate && item.expectedDate <= endDate);
  const missingDateItems = items.filter((item) => item.dateQuality === "MISSING");
  const fallbackDateItems = items.filter((item) => item.dateQuality === "FALLBACK_REQUEST_DATE");
  const outsideHorizonItems = items.filter((item) => item.expectedDate > endDate);
  let runningCash = openingCash;
  const buckets = Array.from({ length: 13 }, (_, index) => {
    const weekStart = addDays(startDate, index * 7);
    const weekEnd = addDays(startDate, index * 7 + 6);
    const bucketItems = includedItems.filter((item) => index === 0
      ? item.expectedDate <= weekEnd
      : item.expectedDate >= weekStart && item.expectedDate <= weekEnd);
    const inflow = bucketItems.filter((item) => item.direction === "INFLOW")
      .reduce((sum, item) => sum + Math.round(item.amount * scenarioProbability(item, scenario) / 100), 0);
    const outflow = bucketItems.filter((item) => item.direction === "OUTFLOW")
      .reduce((sum, item) => sum + Math.round(item.amount * scenarioProbability(item, scenario) / 100), 0);
    runningCash += inflow - outflow;
    return { week: index + 1, weekStart, weekEnd, inflow, outflow, net: inflow - outflow,
      endingCash: runningCash, belowMinimum: runningCash < settings.minimum_cash_balance,
      minimumGap: Math.max(0, settings.minimum_cash_balance - runningCash), itemCount: bucketItems.length,
      overdueItemCount: index === 0 ? bucketItems.filter((item) => item.expectedDate < startDate).length : 0 };
  });
  const sourceCounts = items.reduce<Record<string, number>>((counts, item) => {
    counts[item.sourceType] = (counts[item.sourceType] ?? 0) + 1;
    return counts;
  }, {});
  const lowestCash = Math.min(openingCash, ...buckets.map((bucket) => bucket.endingCash));
  const lowWeeks = buckets.filter((bucket) => bucket.belowMinimum);
  const now = Date.now();
  await db.prepare(`INSERT INTO finance_cash_forecast_snapshots
    (id, as_of, scenario, opening_cash, projected_ending_cash, lowest_cash, minimum_cash_balance,
      low_week_count, missing_date_count, buckets_json, source_counts_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(as_of, scenario) DO UPDATE SET opening_cash = excluded.opening_cash,
      projected_ending_cash = excluded.projected_ending_cash, lowest_cash = excluded.lowest_cash,
      minimum_cash_balance = excluded.minimum_cash_balance, low_week_count = excluded.low_week_count,
      missing_date_count = excluded.missing_date_count,
      buckets_json = excluded.buckets_json, source_counts_json = excluded.source_counts_json,
      updated_at = excluded.updated_at`)
    .bind(`${startDate}:${scenario}`, startDate, scenario, openingCash, runningCash, lowestCash,
      settings.minimum_cash_balance, lowWeeks.length, missingDateItems.length,
      JSON.stringify(buckets), JSON.stringify(sourceCounts), now, now).run();
  return Response.json({
    asOf: startDate, scenario,
    settings: { minimumCashBalance: settings.minimum_cash_balance, includeFx: Boolean(settings.include_fx),
      defaultScenario: settings.default_scenario, collectionProbability: settings.collection_probability },
    summary: { openingCash, projectedEndingCash: runningCash, lowestCash, lowWeekCount: lowWeeks.length,
      firstLowWeek: lowWeeks[0]?.week ?? null, minimumGap: Math.max(0, settings.minimum_cash_balance - lowestCash),
      totalExpectedInflow: buckets.reduce((sum, bucket) => sum + bucket.inflow, 0),
      totalExpectedOutflow: buckets.reduce((sum, bucket) => sum + bucket.outflow, 0) },
    coverage: { startDate, endDate, weeks: 13, sourceCounts, includedCount: includedItems.length,
      missingDateCount: missingDateItems.length, fallbackDateCount: fallbackDateItems.length,
      outsideHorizonCount: outsideHorizonItems.length },
    buckets,
    items: includedItems,
    missingDateItems,
    outsideHorizonItems,
    insights: [
      lowWeeks.length ? `${lowWeeks[0].week}주차부터 최소운영자금보다 낮아질 가능성이 있습니다.` : "현재 입력된 원장 기준으로 최소운영자금 하회 주차는 없습니다.",
      missingDateItems.length ? `예정일이 없어 예측에서 제외된 항목 ${missingDateItems.length}건을 보완해야 합니다.` : "모든 예측 원천에 예정일이 있습니다.",
      fallbackDateItems.length ? `지급예정일이 없어 요청일을 대체 사용한 항목 ${fallbackDateItems.length}건은 실제 지급일을 확인해야 합니다.` : "요청일을 지급예정일로 대체한 항목은 없습니다.",
      settings.include_fx ? "외화예금을 현재 원화환산액으로 가용자금에 포함했습니다." : "운영 가용자금은 원화 입출금계좌만 사용하며 외화예금은 제외했습니다.",
    ],
  });
}

export async function PUT(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "finance", "write");
  if (authorization.response) return authorization.response;
  const before = await getSettings();
  if (!before) return Response.json({ error: "자금예측 설정을 찾을 수 없습니다." }, { status: 404 });
  const body = await request.json() as Record<string, unknown>;
  const minimumCashBalance = Number(body.minimumCashBalance ?? before.minimum_cash_balance);
  const includeFx = body.includeFx === undefined ? Boolean(before.include_fx) : Boolean(body.includeFx);
  const defaultScenario = String(body.defaultScenario ?? before.default_scenario).toUpperCase();
  const collectionProbability = Number(body.collectionProbability ?? before.collection_probability);
  if (!Number.isInteger(minimumCashBalance) || minimumCashBalance < 0 || !["BASE", "CONSERVATIVE", "OPTIMISTIC"].includes(defaultScenario)
    || !Number.isInteger(collectionProbability) || collectionProbability < 0 || collectionProbability > 100) {
    return Response.json({ error: "최소운영자금·기본 시나리오·수금확률을 확인해 주세요." }, { status: 400 });
  }
  const now = Date.now();
  await db.prepare(`UPDATE finance_cash_forecast_settings SET minimum_cash_balance = ?, include_fx = ?,
    default_scenario = ?, collection_probability = ?, updated_by = ?, updated_at = ? WHERE id = 'default'`)
    .bind(minimumCashBalance, includeFx ? 1 : 0, defaultScenario, collectionProbability,
      authorization.principal.employeeId, now).run();
  const after = { minimumCashBalance, includeFx, defaultScenario, collectionProbability,
    updatedBy: authorization.principal.employeeId, updatedAt: now };
  await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "CASH_FORECAST_SETTINGS_UPDATED",
    entityType: "cashForecastSettings", entityId: "default", before, after });
  return Response.json({ settings: after });
}
