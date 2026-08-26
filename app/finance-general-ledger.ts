export type UnifiedLedgerRow = {
  id: string; sourceType: "CONTROLLED_POSTING" | "PAYMENT_JOURNAL"; sourceId: string;
  voucherDate: string; voucherNumber: string; lineNumber: number; accountId: string; accountCode: string;
  accountName: string; partnerName: string; departmentName: string; description: string;
  debitAmount: number; creditAmount: number; postedAt: number | null;
};

export type LedgerAccountSummary = {
  key: string; accountId: string; accountCode: string; accountName: string;
  openingDebit: number; openingCredit: number; periodDebit: number; periodCredit: number;
  endingDebit: number; endingCredit: number; lineCount: number;
};

export type FinancialStatementAccount = LedgerAccountSummary & {
  category: "ASSET" | "LIABILITY" | "EQUITY" | "REVENUE" | "EXPENSE" | "OTHER";
  statementLine: string;
  liquidity: string;
};

export type OperationalFinancialStatements = {
  status: "OFFICIAL" | "DRAFT";
  incomeStatement: {
    revenue: number; expenses: number; netIncome: number;
    salesRevenue: number; cogs: number; grossProfit: number; sga: number; operatingIncome: number;
    nonOperatingIncome: number; nonOperatingExpense: number; preTaxIncome: number; incomeTax: number;
    rows: FinancialStatementAccount[];
  };
  balanceSheet: {
    assets: number; liabilities: number; equity: number; currentEarnings: number; equationDifference: number;
    currentAssets: number; nonCurrentAssets: number; currentLiabilities: number; nonCurrentLiabilities: number;
    rows: FinancialStatementAccount[];
  };
  quality: { openingOfficial: boolean; unclassifiedCount: number;
    unclassifiedAccounts: Array<{ code: string; name: string }>; equationBalanced: boolean;
    normalBalanceMismatch: Array<{ code: string; name: string; category: string; endingDebit: number; endingCredit: number }>;
    unclassifiedStatementLineAccounts: Array<{ code: string; name: string }>;
    unclassifiedLiquidityAccounts: Array<{ code: string; name: string }> };
};

export type StatementComparison = {
  label: string; from: string; to: string; source: "ERP_POSTED" | "HISTORICAL_CLOSE";
  revenue: number; expenses: number; netIncome: number; monthCount?: number;
};

const DAY = 86_400_000;
const utcDate = (value: string) => new Date(`${value}T00:00:00Z`);
const dateValue = (value: Date) => value.toISOString().slice(0, 10);

export function previousEqualLengthPeriod(from: string, to: string, minimum = "2026-01-01") {
  const fromTime = utcDate(from).valueOf(); const toTime = utcDate(to).valueOf();
  if (!Number.isFinite(fromTime) || !Number.isFinite(toTime) || fromTime > toTime) return null;
  const days = Math.floor((toTime - fromTime) / DAY) + 1;
  const previousTo = new Date(fromTime - DAY); const previousFrom = new Date(previousTo.valueOf() - (days - 1) * DAY);
  if (dateValue(previousFrom) < minimum) return null;
  return { from: dateValue(previousFrom), to: dateValue(previousTo), days };
}

export function completedMonthsInRange(from: string, to: string, year = 2026) {
  const result: number[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const first = `${year}-${String(month).padStart(2, "0")}-01`;
    const last = dateValue(new Date(Date.UTC(year, month, 0)));
    if (from <= first && to >= last) result.push(month);
  }
  return result;
}

export function historicalCloseComparison(
  monthly: ReadonlyArray<{ month: number; revenue: number; netIncome: number }>,
  from: string,
  to: string,
): StatementComparison | null {
  const months = completedMonthsInRange(from, to, 2026);
  if (!months.length) return null;
  const selected = monthly.filter((row) => months.includes(row.month));
  if (!selected.length) return null;
  const revenue = selected.reduce((total, row) => total + row.revenue, 0);
  const netIncome = selected.reduce((total, row) => total + row.netIncome, 0);
  return { label: "2025 동일 완료월", from: `2025-${String(months[0]).padStart(2, "0")}-01`,
    to: dateValue(new Date(Date.UTC(2025, months.at(-1) as number, 0))), source: "HISTORICAL_CLOSE",
    revenue, expenses: revenue - netIncome, netIncome, monthCount: selected.length };
}

export function comparisonDelta(current: number, prior: number | null) {
  if (prior === null || prior === 0) return null;
  return ((current - prior) / Math.abs(prior)) * 100;
}

export const generalLedgerAccountKey = (code: string, name: string) => code.trim() || `NAME:${name.trim()}`;

export function buildLedgerAccountSummaries(
  openingRows: ReadonlyArray<{ code: string; name: string; endingDebit: number; endingCredit: number }>,
  rows: UnifiedLedgerRow[],
  from: string,
) {
  const summaries = new Map<string, LedgerAccountSummary>();
  for (const item of openingRows) {
    const key = generalLedgerAccountKey(item.code, item.name);
    const current = summaries.get(key) ?? { key, accountId: "", accountCode: item.code, accountName: item.name,
      openingDebit: 0, openingCredit: 0, periodDebit: 0, periodCredit: 0, endingDebit: 0, endingCredit: 0, lineCount: 0 };
    current.openingDebit += item.endingDebit; current.openingCredit += item.endingCredit; summaries.set(key, current);
  }
  for (const row of rows) {
    const key = generalLedgerAccountKey(row.accountCode, row.accountName);
    const current = summaries.get(key) ?? { key, accountId: row.accountId, accountCode: row.accountCode,
      accountName: row.accountName, openingDebit: 0, openingCredit: 0, periodDebit: 0, periodCredit: 0,
      endingDebit: 0, endingCredit: 0, lineCount: 0 };
    if (!current.accountId && row.accountId) current.accountId = row.accountId;
    if (!current.accountCode && row.accountCode) current.accountCode = row.accountCode;
    current.accountName = row.accountName || current.accountName;
    if (row.voucherDate < from) { current.openingDebit += row.debitAmount; current.openingCredit += row.creditAmount; }
    else { current.periodDebit += row.debitAmount; current.periodCredit += row.creditAmount; current.lineCount += 1; }
    summaries.set(key, current);
  }
  for (const summary of summaries.values()) {
    const opening = summary.openingDebit - summary.openingCredit;
    summary.openingDebit = Math.max(opening, 0); summary.openingCredit = Math.max(-opening, 0);
    const ending = opening + summary.periodDebit - summary.periodCredit;
    summary.endingDebit = Math.max(ending, 0); summary.endingCredit = Math.max(-ending, 0);
  }
  return [...summaries.values()].sort((a, b) => a.accountCode.localeCompare(b.accountCode, "ko") || a.accountName.localeCompare(b.accountName, "ko"));
}

export function buildOperationalFinancialStatements(
  rows: LedgerAccountSummary[],
  categories: Record<string, string>,
  openingOfficial: boolean,
  statementLines: Record<string, string> = {},
  liquidityByKey: Record<string, string> = {},
): OperationalFinancialStatements {
  const allowedCategories = new Set(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]);
  const classified = rows.map((row) => {
    const category = String(categories[row.key] ?? "OTHER").toUpperCase();
    return { ...row, category: (allowedCategories.has(category) ? category : "OTHER") as FinancialStatementAccount["category"],
      statementLine: statementLines[row.key] ?? "", liquidity: liquidityByKey[row.key] ?? "" };
  });
  const amount = (category: FinancialStatementAccount["category"], normalBalance: "DEBIT" | "CREDIT") => classified
    .filter((row) => row.category === category)
    .reduce((total, row) => total + (normalBalance === "DEBIT"
      ? row.endingDebit - row.endingCredit : row.endingCredit - row.endingDebit), 0);
  const movement = (category: FinancialStatementAccount["category"], normalBalance: "DEBIT" | "CREDIT") => classified
    .filter((row) => row.category === category)
    .reduce((total, row) => total + (normalBalance === "DEBIT"
      ? row.periodDebit - row.periodCredit : row.periodCredit - row.periodDebit), 0);
  // Sub-line movement for the income-statement waterfall (매출→매출총이익→영업이익→세전이익→당기순이익).
  // Rows whose category is REVENUE/EXPENSE but carry no statementLine (master data not yet
  // classified that far) still count in `revenue`/`expenses` above but fall out of every subtotal
  // bucket below — surfaced via quality.unclassifiedStatementLineAccounts rather than guessed into
  // a bucket, since a wrong guess here would silently misstate 매출총이익/영업이익.
  const lineMovement = (category: "REVENUE" | "EXPENSE", line: string, normalBalance: "DEBIT" | "CREDIT") => classified
    .filter((row) => row.category === category && row.statementLine === line)
    .reduce((total, row) => total + (normalBalance === "DEBIT"
      ? row.periodDebit - row.periodCredit : row.periodCredit - row.periodDebit), 0);
  // Displayed income statement reflects the caller's queried window (period movement).
  const revenue = movement("REVENUE", "CREDIT"); const expenses = movement("EXPENSE", "DEBIT");
  const netIncome = revenue - expenses;
  const salesRevenue = lineMovement("REVENUE", "SALES_REVENUE", "CREDIT");
  const nonOperatingIncome = lineMovement("REVENUE", "NON_OPERATING_INCOME", "CREDIT");
  const cogs = lineMovement("EXPENSE", "COGS", "DEBIT");
  const sga = lineMovement("EXPENSE", "SGA", "DEBIT");
  const nonOperatingExpense = lineMovement("EXPENSE", "NON_OPERATING_EXPENSE", "DEBIT");
  const incomeTax = lineMovement("EXPENSE", "INCOME_TAX", "DEBIT");
  const grossProfit = salesRevenue - cogs;
  const operatingIncome = grossProfit - sga;
  const preTaxIncome = operatingIncome + nonOperatingIncome - nonOperatingExpense;
  const assets = amount("ASSET", "DEBIT"); const liabilities = amount("LIABILITY", "CREDIT");
  const equity = amount("EQUITY", "CREDIT");
  // Liquidity split for the balance sheet (유동/비유동). Same non-blocking-unclassified treatment
  // as statementLine above — an account with no liquidity tag still counts in assets/liabilities
  // but not in either current/non-current subtotal.
  const liquidityAmount = (category: "ASSET" | "LIABILITY", liquidity: string, normalBalance: "DEBIT" | "CREDIT") => classified
    .filter((row) => row.category === category && row.liquidity === liquidity)
    .reduce((total, row) => total + (normalBalance === "DEBIT"
      ? row.endingDebit - row.endingCredit : row.endingCredit - row.endingDebit), 0);
  const currentAssets = liquidityAmount("ASSET", "CURRENT", "DEBIT");
  const nonCurrentAssets = liquidityAmount("ASSET", "NON_CURRENT", "DEBIT");
  const currentLiabilities = liquidityAmount("LIABILITY", "CURRENT", "CREDIT");
  const nonCurrentLiabilities = liquidityAmount("LIABILITY", "NON_CURRENT", "CREDIT");
  // The equation must use YTD-to-date P&L (ending balance, not period movement): there is no
  // per-fiscal-year closing entry zeroing revenue/expense accounts, so whenever the caller's
  // `from` is later than the fiscal year start, prior-to-`from` P&L activity is still baked into
  // every asset/liability/equity ending balance. Using the same ending-balance basis for revenue/
  // expense keeps the equation invariant to `from`, instead of flagging a false imbalance equal to
  // whatever P&L moved before the queried window started.
  const ytdRevenue = amount("REVENUE", "CREDIT"); const ytdExpenses = amount("EXPENSE", "DEBIT");
  const ytdNetIncome = ytdRevenue - ytdExpenses;
  const unclassified = classified.filter((row) => row.category === "OTHER"
    && Boolean(row.openingDebit || row.openingCredit || row.periodDebit || row.periodCredit));
  // Classification errors between categories that share the equation's sign (asset↔liability,
  // asset↔equity, revenue↔expense) never move equationDifference — it is algebraically blind to
  // them. This surfaces those errors independently: any account whose ending balance sits on the
  // side opposite its category's normal balance (e.g. an ASSET carrying a net credit balance) is
  // flagged. Not blocking by itself, since legitimate contra accounts (감가상각누계액, 대손충당금)
  // are expected to do exactly this until the master data can mark them as such explicitly.
  const creditNormal = new Set(["LIABILITY", "EQUITY", "REVENUE"]);
  const normalBalanceMismatch = classified
    .filter((row) => row.category !== "OTHER")
    .filter((row) => (creditNormal.has(row.category) ? row.endingDebit > 0 : row.endingCredit > 0))
    .map((row) => ({ code: row.accountCode, name: row.accountName, category: row.category,
      endingDebit: row.endingDebit, endingCredit: row.endingCredit }));
  const equationDifference = assets - liabilities - equity - ytdNetIncome;
  const unclassifiedStatementLine = classified.filter((row) => ["REVENUE", "EXPENSE"].includes(row.category)
    && !row.statementLine && Boolean(row.periodDebit || row.periodCredit));
  const unclassifiedLiquidity = classified.filter((row) => ["ASSET", "LIABILITY"].includes(row.category)
    && !row.liquidity && Boolean(row.endingDebit || row.endingCredit));
  const quality = { openingOfficial, unclassifiedCount: unclassified.length,
    unclassifiedAccounts: unclassified.map((row) => ({ code: row.accountCode, name: row.accountName })),
    equationBalanced: equationDifference === 0, normalBalanceMismatch,
    unclassifiedStatementLineAccounts: unclassifiedStatementLine.map((row) => ({ code: row.accountCode, name: row.accountName })),
    unclassifiedLiquidityAccounts: unclassifiedLiquidity.map((row) => ({ code: row.accountCode, name: row.accountName })) };
  return {
    status: quality.openingOfficial && quality.unclassifiedCount === 0 && quality.equationBalanced ? "OFFICIAL" : "DRAFT",
    incomeStatement: { revenue, expenses, netIncome, salesRevenue, cogs, grossProfit, sga, operatingIncome,
      nonOperatingIncome, nonOperatingExpense, preTaxIncome, incomeTax,
      rows: classified.filter((row) => ["REVENUE", "EXPENSE"].includes(row.category)) },
    balanceSheet: { assets, liabilities, equity, currentEarnings: ytdNetIncome, equationDifference,
      currentAssets, nonCurrentAssets, currentLiabilities, nonCurrentLiabilities,
      rows: classified.filter((row) => ["ASSET", "LIABILITY", "EQUITY"].includes(row.category)) },
    quality,
  };
}
