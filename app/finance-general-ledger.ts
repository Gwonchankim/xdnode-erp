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
};

export type OperationalFinancialStatements = {
  status: "OFFICIAL" | "DRAFT";
  incomeStatement: { revenue: number; expenses: number; netIncome: number; rows: FinancialStatementAccount[] };
  balanceSheet: { assets: number; liabilities: number; equity: number; currentEarnings: number;
    equationDifference: number; rows: FinancialStatementAccount[] };
  quality: { openingOfficial: boolean; unclassifiedCount: number;
    unclassifiedAccounts: Array<{ code: string; name: string }>; equationBalanced: boolean };
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
): OperationalFinancialStatements {
  const allowedCategories = new Set(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]);
  const classified = rows.map((row) => {
    const category = String(categories[row.key] ?? "OTHER").toUpperCase();
    return { ...row, category: (allowedCategories.has(category) ? category : "OTHER") as FinancialStatementAccount["category"] };
  });
  const amount = (category: FinancialStatementAccount["category"], normalBalance: "DEBIT" | "CREDIT") => classified
    .filter((row) => row.category === category)
    .reduce((total, row) => total + (normalBalance === "DEBIT"
      ? row.endingDebit - row.endingCredit : row.endingCredit - row.endingDebit), 0);
  const movement = (category: FinancialStatementAccount["category"], normalBalance: "DEBIT" | "CREDIT") => classified
    .filter((row) => row.category === category)
    .reduce((total, row) => total + (normalBalance === "DEBIT"
      ? row.periodDebit - row.periodCredit : row.periodCredit - row.periodDebit), 0);
  const revenue = movement("REVENUE", "CREDIT"); const expenses = movement("EXPENSE", "DEBIT");
  const netIncome = revenue - expenses;
  const assets = amount("ASSET", "DEBIT"); const liabilities = amount("LIABILITY", "CREDIT");
  const equity = amount("EQUITY", "CREDIT");
  const unclassified = classified.filter((row) => row.category === "OTHER"
    && Boolean(row.openingDebit || row.openingCredit || row.periodDebit || row.periodCredit));
  const equationDifference = assets - liabilities - equity - netIncome;
  const quality = { openingOfficial, unclassifiedCount: unclassified.length,
    unclassifiedAccounts: unclassified.map((row) => ({ code: row.accountCode, name: row.accountName })),
    equationBalanced: equationDifference === 0 };
  return {
    status: quality.openingOfficial && quality.unclassifiedCount === 0 && quality.equationBalanced ? "OFFICIAL" : "DRAFT",
    incomeStatement: { revenue, expenses, netIncome, rows: classified.filter((row) => ["REVENUE", "EXPENSE"].includes(row.category)) },
    balanceSheet: { assets, liabilities, equity, currentEarnings: netIncome, equationDifference,
      rows: classified.filter((row) => ["ASSET", "LIABILITY", "EQUITY"].includes(row.category)) },
    quality,
  };
}
