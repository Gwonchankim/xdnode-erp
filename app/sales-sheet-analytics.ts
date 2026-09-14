// Aggregation queries over sales_sheet_revenue_records (the '26년 매출'/'진행 딜' mirror table from
// app/sales-sheet-sync.ts) for the "매출 분석" screen. Rankings are visible to anyone with sales:read
// (no per-rep access restriction) — see docs/sales-sheet-analytics-plan.md for that decision.

const VALID_DATE = `order_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`;

export async function getMonthlyTrend(db: D1Database, months = 12) {
  const result = await db.prepare(`
    SELECT substr(order_date,1,7) AS month, deal_status, SUM(sale_total) AS sale_total, COUNT(*) AS count
    FROM sales_sheet_revenue_records
    WHERE ${VALID_DATE}
    GROUP BY month, deal_status
    ORDER BY month ASC
  `).all<{ month: string; deal_status: string; sale_total: number; count: number }>();

  const byMonth = new Map<string, { month: string; confirmed: number; inProgress: number; confirmedCount: number; inProgressCount: number }>();
  for (const row of result.results) {
    const entry = byMonth.get(row.month) ?? { month: row.month, confirmed: 0, inProgress: 0, confirmedCount: 0, inProgressCount: 0 };
    if (row.deal_status === "CONFIRMED") { entry.confirmed = row.sale_total; entry.confirmedCount = row.count; }
    else { entry.inProgress = row.sale_total; entry.inProgressCount = row.count; }
    byMonth.set(row.month, entry);
  }
  return [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-months);
}

export async function getRepPerformance(db: D1Database, limit = 30) {
  const result = await db.prepare(`
    SELECT rep, COUNT(*) AS count, SUM(sale_total) AS sale_total, SUM(margin) AS margin
    FROM sales_sheet_revenue_records
    WHERE deal_status='CONFIRMED' AND rep != ''
    GROUP BY rep
    ORDER BY sale_total DESC
    LIMIT ?
  `).bind(limit).all<{ rep: string; count: number; sale_total: number; margin: number }>();
  return result.results;
}

export async function getCustomerConcentration(db: D1Database, limit = 15) {
  const [rows, total] = await Promise.all([
    db.prepare(`
      SELECT customer_name, COUNT(*) AS count, SUM(sale_total) AS sale_total
      FROM sales_sheet_revenue_records
      WHERE deal_status='CONFIRMED' AND customer_name != ''
      GROUP BY customer_name
      ORDER BY sale_total DESC
      LIMIT ?
    `).bind(limit).all<{ customer_name: string; count: number; sale_total: number }>(),
    db.prepare(`SELECT SUM(sale_total) AS total FROM sales_sheet_revenue_records WHERE deal_status='CONFIRMED'`).first<{ total: number }>(),
  ]);
  const grandTotal = total?.total ?? 0;
  const top = rows.results.map((row) => ({ ...row, share: grandTotal ? row.sale_total / grandTotal : 0 }));
  const topSum = top.reduce((sum, row) => sum + row.sale_total, 0);
  return { customers: top, grandTotal, otherSum: Math.max(0, grandTotal - topSum), otherShare: grandTotal ? Math.max(0, grandTotal - topSum) / grandTotal : 0 };
}

const MARGIN_BUCKETS = [
  { key: "NEGATIVE", label: "마진 적자" },
  { key: "UNDER_5", label: "0~5%" },
  { key: "P5_10", label: "5~10%" },
  { key: "P10_20", label: "10~20%" },
  { key: "OVER_20", label: "20%+" },
];

export async function getMarginDistribution(db: D1Database) {
  const result = await db.prepare(`
    SELECT
      CASE
        WHEN margin < 0 THEN 'NEGATIVE'
        WHEN CAST(margin AS REAL) / sale_total < 0.05 THEN 'UNDER_5'
        WHEN CAST(margin AS REAL) / sale_total < 0.10 THEN 'P5_10'
        WHEN CAST(margin AS REAL) / sale_total < 0.20 THEN 'P10_20'
        ELSE 'OVER_20'
      END AS bucket,
      COUNT(*) AS count, SUM(sale_total) AS sale_total, SUM(margin) AS margin
    FROM sales_sheet_revenue_records
    WHERE deal_status='CONFIRMED' AND sale_total > 0
    GROUP BY bucket
  `).all<{ bucket: string; count: number; sale_total: number; margin: number }>();

  const byBucket = new Map(result.results.map((row) => [row.bucket, row]));
  const buckets = MARGIN_BUCKETS.map((meta) => ({ ...meta, ...(byBucket.get(meta.key) ?? { count: 0, sale_total: 0, margin: 0 }) }));
  const totals = result.results.reduce((sum, row) => ({ count: sum.count + row.count, sale_total: sum.sale_total + row.sale_total, margin: sum.margin + row.margin }), { count: 0, sale_total: 0, margin: 0 });
  return { buckets, averageMarginRate: totals.sale_total ? totals.margin / totals.sale_total : 0, totals };
}

// Item names are free text (e.g. "PRO 6000 Max-Q Workstation Edition" vs "...MAX-Q..." vs "...Retail")
// with no normalization rules yet — grouped by exact trimmed text as agreed in the analytics plan's
// deferred-scope note, rather than guessing at a canonicalization that could merge distinct SKUs.
export async function getItemPerformance(db: D1Database, limit = 20) {
  const result = await db.prepare(`
    SELECT TRIM(item) AS item, COUNT(*) AS count, SUM(sale_total) AS sale_total, SUM(margin) AS margin
    FROM sales_sheet_revenue_records
    WHERE deal_status='CONFIRMED' AND TRIM(item) != ''
    GROUP BY TRIM(item)
    ORDER BY sale_total DESC
    LIMIT ?
  `).bind(limit).all<{ item: string; count: number; sale_total: number; margin: number }>();
  return result.results;
}

const VALID_DUE_DATE = `collection_due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'`;

export async function getCollectionTrend(db: D1Database, months = 12) {
  const result = await db.prepare(`
    SELECT substr(collection_due_date,1,7) AS month,
      SUM(vat_included_amount) AS due_amount,
      SUM(CASE WHEN collected_date != '' THEN vat_included_amount ELSE 0 END) AS collected_amount,
      COUNT(*) AS count
    FROM sales_sheet_revenue_records
    WHERE deal_status='CONFIRMED' AND ${VALID_DUE_DATE}
    GROUP BY month
    ORDER BY month ASC
  `).all<{ month: string; due_amount: number; collected_amount: number; count: number }>();
  return result.results.slice(-months);
}

export async function getCollectionSummary(db: D1Database) {
  const today = new Date().toISOString().slice(0, 10);
  const row = await db.prepare(`
    SELECT
      SUM(vat_included_amount) AS total_due,
      SUM(CASE WHEN collected_date='' THEN vat_included_amount ELSE 0 END) AS outstanding_total,
      SUM(CASE WHEN collected_date='' THEN 1 ELSE 0 END) AS outstanding_count,
      SUM(CASE WHEN collected_date='' AND collection_due_date < ? THEN vat_included_amount ELSE 0 END) AS overdue_total,
      SUM(CASE WHEN collected_date='' AND collection_due_date < ? THEN 1 ELSE 0 END) AS overdue_count
    FROM sales_sheet_revenue_records
    WHERE deal_status='CONFIRMED' AND ${VALID_DUE_DATE}
  `).bind(today, today).first<{ total_due: number; outstanding_total: number; outstanding_count: number; overdue_total: number; overdue_count: number }>();
  const totalDue = row?.total_due ?? 0;
  const outstandingTotal = row?.outstanding_total ?? 0;
  return {
    totalDue, outstandingTotal, outstandingCount: row?.outstanding_count ?? 0,
    overdueTotal: row?.overdue_total ?? 0, overdueCount: row?.overdue_count ?? 0,
    collectionRate: totalDue ? (totalDue - outstandingTotal) / totalDue : 0,
  };
}

// Both funnels use each sheet's own outcome field (final_result / progress) rather than inferring
// success from elsewhere — see the lead_protection cross-reference below for the one place we do
// check against actual confirmed revenue, which is inherently approximate (exact customer-name match
// only, same limitation as app/sales-sheet-insights.ts's account timeline).
export async function getInboundLeadFunnel(db: D1Database) {
  const row = await db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN final_result IN ('성공-계약','확정딜') THEN 1 ELSE 0 END) AS won,
      SUM(CASE WHEN final_result LIKE '실패%' OR final_result='불가' THEN 1 ELSE 0 END) AS lost,
      SUM(CASE WHEN final_result='진행중' THEN 1 ELSE 0 END) AS inProgress,
      SUM(CASE WHEN final_result='' THEN 1 ELSE 0 END) AS unset
    FROM sales_sheet_inbound_leads
  `).first<{ total: number; won: number; lost: number; inProgress: number; unset: number }>();
  const total = row?.total ?? 0;
  const won = row?.won ?? 0;
  const lost = row?.lost ?? 0;
  return {
    total, won, lost, inProgress: row?.inProgress ?? 0, unset: row?.unset ?? 0,
    overallRate: total ? won / total : 0,
    resolvedRate: won + lost ? won / (won + lost) : 0,
  };
}

// Exact-match customer-name matching turned out to badly understate real conversion: universities and
// research institutes often register lead_protection under a department/lab name (e.g. "한양대학교
// 혁신창업실험실") but the confirmed sale later posts under the parent institution's plain name
// ("한양대학교"). A loose (substring, either direction) match recovers most of those — see
// docs/sales-sheet-analytics-plan.md's follow-up note. Both rates are surfaced so the gap itself is visible.
// Uses instr() rather than a dynamic LIKE '%...%' pattern: D1's SQLite rejects LIKE patterns built from
// long column data ("LIKE or GLOB pattern too complex", SQLite's LIKE-pattern-length limit) once Korean
// company names push the concatenated pattern past it — instr() does plain substring search, no limit.
const LOOSE_MATCH_EXISTS = `EXISTS (
  SELECT 1 FROM sales_sheet_revenue_records r WHERE r.deal_status='CONFIRMED'
    AND (instr(r.customer_name, TRIM(lp.customer_company)) > 0 OR instr(TRIM(lp.customer_company), r.customer_name) > 0)
)`;
const EXACT_MATCH_EXISTS = `EXISTS (
  SELECT 1 FROM sales_sheet_revenue_records r WHERE r.deal_status='CONFIRMED' AND TRIM(r.customer_name)=TRIM(lp.customer_company)
)`;

export async function getLeadProtectionFunnel(db: D1Database) {
  const [row, registered, matched, looseMatched] = await Promise.all([
    db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN progress='WIN' THEN 1 ELSE 0 END) AS won,
        SUM(CASE WHEN progress='DROP' THEN 1 ELSE 0 END) AS lost,
        SUM(CASE WHEN progress NOT IN ('','WIN','DROP') THEN 1 ELSE 0 END) AS inProgress,
        SUM(CASE WHEN progress='' THEN 1 ELSE 0 END) AS unset
      FROM sales_sheet_lead_protections
    `).first<{ total: number; won: number; lost: number; inProgress: number; unset: number }>(),
    db.prepare(`SELECT COUNT(DISTINCT TRIM(customer_company)) AS c FROM sales_sheet_lead_protections WHERE TRIM(customer_company) != ''`)
      .first<{ c: number }>(),
    db.prepare(`SELECT COUNT(DISTINCT TRIM(lp.customer_company)) AS c FROM sales_sheet_lead_protections lp WHERE TRIM(lp.customer_company) != '' AND ${EXACT_MATCH_EXISTS}`)
      .first<{ c: number }>(),
    db.prepare(`SELECT COUNT(DISTINCT TRIM(lp.customer_company)) AS c FROM sales_sheet_lead_protections lp WHERE TRIM(lp.customer_company) != '' AND ${LOOSE_MATCH_EXISTS}`)
      .first<{ c: number }>(),
  ]);
  const total = row?.total ?? 0;
  const won = row?.won ?? 0;
  const lost = row?.lost ?? 0;
  const registeredCustomers = registered?.c ?? 0;
  const matchedCustomers = matched?.c ?? 0;
  const looseMatchedCustomers = looseMatched?.c ?? 0;
  return {
    total, won, lost, inProgress: row?.inProgress ?? 0, unset: row?.unset ?? 0,
    overallRate: total ? won / total : 0,
    resolvedRate: won + lost ? won / (won + lost) : 0,
    registeredCustomers, matchedCustomers,
    revenueMatchRate: registeredCustomers ? matchedCustomers / registeredCustomers : 0,
    looseMatchedCustomers,
    looseRevenueMatchRate: registeredCustomers ? looseMatchedCustomers / registeredCustomers : 0,
  };
}

// WIN registrations with no revenue match at all — not even loose — are the ones actually worth a
// person's attention: either the sale hasn't been entered into '26년 매출' yet, it posted under a
// name too different to substring-match, or the deal quietly fell through after being marked WIN.
export async function getUnmatchedWinLeadProtections(db: D1Database, limit = 30) {
  const result = await db.prepare(`
    SELECT id, customer_company, product, sales_rep, registered_date
    FROM sales_sheet_lead_protections lp
    WHERE progress='WIN' AND TRIM(customer_company) != '' AND NOT ${LOOSE_MATCH_EXISTS}
    ORDER BY registered_date DESC
    LIMIT ?
  `).bind(limit).all<{ id: string; customer_company: string; product: string; sales_rep: string; registered_date: string }>();
  return result.results;
}

// lead_protection.progress doubles as a rough probability already ('WIN', 'DROP', or a bare decimal
// like '0.5') — rather than inventing a separate confidence score, reuse that signal (matched loosely
// by customer name, same as the conversion funnel) to bucket and weight open (IN_PROGRESS) deals. See
// docs/sales-analytics-erp-benchmark-plan.md's B1/B3 — this merges "weighted forecast" and the
// Zoho-style 3-tier bucket into one query since they're the same underlying signal.
function progressToProbability(progress: string | null): number {
  if (progress === "WIN") return 0.9;
  if (progress === "DROP") return 0.05;
  const num = progress ? Number(progress) : NaN;
  return Number.isFinite(num) && num >= 0 && num <= 1 ? num : 0.2;
}

const CONFIDENCE_BUCKETS = [
  { key: "HIGH", label: "거의 확정" },
  { key: "MID", label: "가능성 있음" },
  { key: "LOW", label: "초기 단계" },
];

export async function getPipelineConfidence(db: D1Database) {
  const result = await db.prepare(`
    SELECT r.id, r.customer_name, r.sale_total,
      (SELECT lp.progress FROM sales_sheet_lead_protections lp
        WHERE TRIM(lp.customer_company) != ''
          AND (instr(r.customer_name, TRIM(lp.customer_company)) > 0 OR instr(TRIM(lp.customer_company), r.customer_name) > 0)
        ORDER BY CASE lp.progress WHEN 'WIN' THEN 4 WHEN '0.8' THEN 3 WHEN '0.5' THEN 2 WHEN '0.3' THEN 1 ELSE 0 END DESC
        LIMIT 1
      ) AS matched_progress
    FROM sales_sheet_revenue_records r
    WHERE r.deal_status='IN_PROGRESS'
  `).all<{ id: string; customer_name: string; sale_total: number; matched_progress: string | null }>();

  const byBucket = new Map(CONFIDENCE_BUCKETS.map((b) => [b.key, { ...b, count: 0, sale_total: 0 }]));
  let rawTotal = 0;
  let weightedForecast = 0;
  for (const row of result.results) {
    const probability = progressToProbability(row.matched_progress);
    rawTotal += row.sale_total;
    weightedForecast += row.sale_total * probability;
    const bucketKey = probability >= 0.7 ? "HIGH" : probability >= 0.3 ? "MID" : "LOW";
    const bucket = byBucket.get(bucketKey)!;
    bucket.count += 1;
    bucket.sale_total += row.sale_total;
  }
  return {
    buckets: [...byBucket.values()], rawTotal, weightedForecast,
    averageProbability: rawTotal ? weightedForecast / rawTotal : 0,
  };
}

// Read-only cross-reference against the formal, approval-gated target system (app/api/sales/planning,
// docs/sales-target-forecast-plan.md) — never writes to sales_target_plans/_lines. Only compares
// against the COMPANY-wide monthly target: rep-level targets would need the same free-text name
// matching problem the conversion funnel already has, and the sheet's "rep" field (a bare first name)
// isn't reliably tied to an HR employee_id anyway.
export async function getPipelineCoverage(db: D1Database) {
  const now = new Date();
  const period = now.toISOString().slice(0, 7);
  const year = now.getFullYear();
  const plan = await db.prepare(`SELECT id FROM sales_target_plans WHERE year=? AND status='APPROVED'`).bind(year).first<{ id: string }>();
  let targetRevenue = 0;
  if (plan) {
    const line = await db.prepare(`SELECT target_revenue FROM sales_target_lines WHERE plan_id=? AND scope_type='COMPANY' AND scope_key='company' AND period=?`)
      .bind(plan.id, period).first<{ target_revenue: number }>();
    targetRevenue = line?.target_revenue ?? 0;
  }
  const pipeline = await db.prepare(`SELECT COALESCE(SUM(sale_total),0) AS total FROM sales_sheet_revenue_records WHERE deal_status='IN_PROGRESS'`).first<{ total: number }>();
  const pipelineTotal = pipeline?.total ?? 0;
  return {
    period, targetRevenue, pipelineTotal,
    coverageRatio: targetRevenue ? pipelineTotal / targetRevenue : null,
  };
}

// Hand-authored keyword→category table, not fuzzy matching — same "don't guess at normalization"
// stance as getItemPerformance. Coarse on purpose: good enough to spot an obvious unbought product
// line for a repeat customer, not a real product taxonomy.
const ITEM_CATEGORIES: Array<{ key: string; label: string; keywords: string[] }> = [
  { key: "H100_H200", label: "H100/H200", keywords: ["H100", "H200"] },
  { key: "PRO6000", label: "PRO 6000", keywords: ["PRO 6000", "PRO6000"] },
  { key: "PRO5000", label: "PRO 5000", keywords: ["PRO 5000", "PRO5000"] },
  { key: "PRO4000", label: "PRO 4000/4500", keywords: ["PRO 4000", "PRO4000", "PRO 4500", "PRO4500"] },
  { key: "ADA", label: "RTX ADA", keywords: ["ADA"] },
  { key: "L4_L40", label: "L4/L40", keywords: ["L40", "L4"] },
  { key: "DGX_SERVER", label: "DGX/서버", keywords: ["DGX", "GIGABYTE", "서버"] },
];
function categorizeItem(item: string): string | null {
  const upper = item.toUpperCase();
  for (const category of ITEM_CATEGORIES) {
    if (category.keywords.some((keyword) => upper.includes(keyword))) return category.key;
  }
  return null;
}

export async function getWhitespace(db: D1Database, limit = 10) {
  const result = await db.prepare(`
    SELECT customer_name, item, SUM(sale_total) AS sale_total
    FROM sales_sheet_revenue_records
    WHERE deal_status='CONFIRMED' AND customer_name != '' AND customer_name IN (
      SELECT customer_name FROM (
        SELECT customer_name, SUM(sale_total) AS total FROM sales_sheet_revenue_records
        WHERE deal_status='CONFIRMED' AND customer_name != '' GROUP BY customer_name ORDER BY total DESC LIMIT ?
      )
    )
    GROUP BY customer_name, item
  `).bind(limit).all<{ customer_name: string; item: string; sale_total: number }>();

  const byCustomer = new Map<string, { customer_name: string; sale_total: number; categories: Set<string> }>();
  for (const row of result.results) {
    const entry = byCustomer.get(row.customer_name) ?? { customer_name: row.customer_name, sale_total: 0, categories: new Set<string>() };
    entry.sale_total += row.sale_total;
    const category = categorizeItem(row.item);
    if (category) entry.categories.add(category);
    byCustomer.set(row.customer_name, entry);
  }
  const allCategoryKeys = ITEM_CATEGORIES.map((c) => c.key);
  return [...byCustomer.values()]
    .sort((a, b) => b.sale_total - a.sale_total)
    .map((entry) => ({
      customer_name: entry.customer_name, sale_total: entry.sale_total,
      purchasedCategories: ITEM_CATEGORIES.filter((c) => entry.categories.has(c.key)).map((c) => c.label),
      missingCategories: ITEM_CATEGORIES.filter((c) => !entry.categories.has(c.key) && allCategoryKeys.includes(c.key)).map((c) => c.label),
    }));
}

// Rule-based, not ML anomaly detection — compares the last FULLY completed month (not the current
// partial month, which would always look artificially low) against the average of the 3 months before
// it. baselineAvg >= 3 guards against noisy percentages when the baseline itself is tiny (e.g. 1 vs 0).
export async function getEngagementAnomaly(db: D1Database) {
  const now = new Date();
  const monthsAgo = (n: number) => new Date(now.getFullYear(), now.getMonth() - n, 1).toISOString().slice(0, 7);
  const refMonth = monthsAgo(1);
  const baselineMonths = [monthsAgo(2), monthsAgo(3), monthsAgo(4)];

  function evaluate(rows: Array<{ month: string; count: number }>, label: string) {
    const byMonth = new Map(rows.map((r) => [r.month, r.count]));
    const refCount = byMonth.get(refMonth) ?? 0;
    const baseline = baselineMonths.map((m) => byMonth.get(m) ?? 0);
    const baselineAvg = baseline.reduce((sum, n) => sum + n, 0) / baseline.length;
    const dropRate = baselineAvg > 0 ? (baselineAvg - refCount) / baselineAvg : 0;
    return { label, refMonth, refCount, baselineAvg, dropRate, isAnomaly: baselineAvg >= 3 && dropRate >= 0.3 };
  }

  const [leadRows, protectionRows] = await Promise.all([
    db.prepare(`SELECT substr(inflow_date,1,7) AS month, COUNT(*) AS count FROM sales_sheet_inbound_leads WHERE inflow_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' GROUP BY month`).all<{ month: string; count: number }>(),
    db.prepare(`SELECT substr(registered_date,1,7) AS month, COUNT(*) AS count FROM sales_sheet_lead_protections WHERE registered_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' GROUP BY month`).all<{ month: string; count: number }>(),
  ]);
  return {
    inboundLead: evaluate(leadRows.results, "인바운드 리드"),
    leadProtection: evaluate(protectionRows.results, "영업보호 등록"),
  };
}
