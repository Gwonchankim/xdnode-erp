// Cross-table views over the sheet mirror tables from app/sales-sheet-tabs.ts: a per-account
// timeline and simple data-quality alerts. Account matching is exact (trimmed) string match only —
// no fuzzy matching, so two differently-spelled names for the same real company stay separate
// rather than risk merging two different companies' data.

type AccountEvent = { source: string; sourceLabel: string; date: string; title: string; detail: string; amount: number | null; id: string };

const CUSTOMER_TABLES: Array<{ table: string; column: string }> = [
  { table: "sales_sheet_revenue_records", column: "customer_name" },
  { table: "sales_sheet_lead_protections", column: "customer_company" },
  { table: "sales_sheet_inbound_leads", column: "company" },
  { table: "sales_sheet_deliveries", column: "customer_name" },
  { table: "sales_sheet_service_logs", column: "customer_name" },
];

export async function searchAccountNames(db: D1Database, query: string, limit = 20) {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const unionSql = CUSTOMER_TABLES.map(({ table, column }) => `SELECT DISTINCT TRIM(${column}) AS name FROM ${table} WHERE TRIM(${column}) != ''`).join(" UNION ");
  const result = await db.prepare(`SELECT name FROM (${unionSql}) WHERE name LIKE ? ORDER BY name LIMIT ?`)
    .bind(`%${trimmed}%`, limit).all<{ name: string }>();
  return result.results.map((row) => row.name);
}

export async function getAccountTimeline(db: D1Database, name: string) {
  const normalized = name.trim();
  if (!normalized) return [];

  const [revenue, leads, inbound, deliveries, service] = await Promise.all([
    db.prepare(`SELECT * FROM sales_sheet_revenue_records WHERE TRIM(customer_name)=?`).bind(normalized).all<Record<string, unknown>>(),
    db.prepare(`SELECT * FROM sales_sheet_lead_protections WHERE TRIM(customer_company)=?`).bind(normalized).all<Record<string, unknown>>(),
    db.prepare(`SELECT * FROM sales_sheet_inbound_leads WHERE TRIM(company)=?`).bind(normalized).all<Record<string, unknown>>(),
    db.prepare(`SELECT * FROM sales_sheet_deliveries WHERE TRIM(customer_name)=?`).bind(normalized).all<Record<string, unknown>>(),
    db.prepare(`SELECT * FROM sales_sheet_service_logs WHERE TRIM(customer_name)=?`).bind(normalized).all<Record<string, unknown>>(),
  ]);

  const events: AccountEvent[] = [
    ...revenue.results.map((row): AccountEvent => ({
      source: "revenue", sourceLabel: row.deal_status === "CONFIRMED" ? "확정 매출" : "진행 딜",
      date: String(row.order_date ?? ""), title: String(row.item ?? ""),
      detail: [row.rep, row.quantity ? `수량 ${row.quantity}` : ""].filter(Boolean).join(" · "),
      amount: Number(row.sale_total ?? 0) || null, id: String(row.id),
    })),
    ...leads.results.map((row): AccountEvent => ({
      source: "lead_protection", sourceLabel: "영업보호",
      date: String(row.registered_date ?? ""), title: String(row.product ?? ""),
      detail: [row.sales_rep, row.progress].filter(Boolean).join(" · "), amount: null, id: String(row.id),
    })),
    ...inbound.results.map((row): AccountEvent => ({
      source: "inbound_lead", sourceLabel: "인바운드 영업",
      date: String(row.inflow_date ?? ""), title: String(row.product ?? ""),
      detail: [row.stage, row.final_result].filter(Boolean).join(" · "),
      amount: Number(row.contract_amount ?? 0) || Number(row.quote_amount ?? 0) || null, id: String(row.id),
    })),
    ...deliveries.results.map((row): AccountEvent => ({
      source: "delivery", sourceLabel: "서버납품",
      date: String(row.delivery_date ?? ""), title: String(row.model ?? ""),
      detail: [row.rep, row.quantity ? `수량 ${row.quantity}` : ""].filter(Boolean).join(" · "), amount: null, id: String(row.id),
    })),
    ...service.results.map((row): AccountEvent => ({
      source: "service_log", sourceLabel: "AS",
      date: String(row.shipped_date ?? ""), title: String(row.product_name ?? ""),
      detail: String(row.issue_description || row.result || ""), amount: null, id: String(row.id),
    })),
  ];

  events.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return events;
}

function daysAgoIso(days: number) {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

export async function getDataQualityAlerts(db: D1Database) {
  const today = new Date().toISOString().slice(0, 10);
  const staleSince = daysAgoIso(30);

  const [overdueCollections, staleDeals, staleLeads] = await Promise.all([
    db.prepare(`SELECT * FROM sales_sheet_revenue_records
      WHERE deal_status='CONFIRMED' AND collection_due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        AND collection_due_date < ? AND collected_date = ''
      ORDER BY collection_due_date ASC LIMIT 50`).bind(today).all<Record<string, unknown>>(),
    db.prepare(`SELECT * FROM sales_sheet_revenue_records
      WHERE deal_status='IN_PROGRESS' AND order_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND order_date < ?
      ORDER BY order_date ASC LIMIT 50`).bind(staleSince).all<Record<string, unknown>>(),
    db.prepare(`SELECT * FROM sales_sheet_inbound_leads
      WHERE inflow_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND inflow_date < ? AND final_result = '' AND reflected != 'TRUE'
      ORDER BY inflow_date ASC LIMIT 50`).bind(staleSince).all<Record<string, unknown>>(),
  ]);

  return {
    overdueCollections: overdueCollections.results,
    staleDeals: staleDeals.results,
    staleLeads: staleLeads.results,
  };
}
