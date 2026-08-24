import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { calculateStraightLineDepreciation } from "../app/fixed-asset-calculation.mjs";
import { buildLedgerAccountSummaries, buildOperationalFinancialStatements, comparisonDelta,
  completedMonthsInRange, historicalCloseComparison, previousEqualLengthPeriod } from "../app/finance-general-ledger.ts";
import { evaluateLedgerSnapshotDrift } from "../app/finance-ledger-integrity.ts";

async function loadFinanceData() {
  const source = await readFile(new URL("../app/finance-historical-data.ts", import.meta.url), "utf8");
  const match = source.match(/export const financeHistoricalData = ([\s\S]+) as const;/);
  assert.ok(match, "historical finance data export not found");
  return JSON.parse(match[1]);
}

async function loadCurrentFinanceData() {
  const source = await readFile(new URL("../app/finance-current-data.ts", import.meta.url), "utf8");
  const match = source.match(/export const financeCurrentData = ([\s\S]+) as const;/);
  assert.ok(match, "current finance data export not found");
  return JSON.parse(match[1]);
}

test("2024 and 2025 trial balances remain balanced", async () => {
  const data = await loadFinanceData();
  for (const year of ["2024", "2025"]) {
    assert.equal(data.years[year].transactionDebit, data.years[year].transactionCredit);
    const rows = year === "2024" ? data.trialBalance2024 : data.trialBalance2025;
    const endingDebit = rows.reduce((sum, row) => sum + row.endingDebit, 0);
    const endingCredit = rows.reduce((sum, row) => sum + row.endingCredit, 0);
    assert.equal(endingDebit, data.years[year].balanceTotal);
    assert.equal(endingCredit, data.years[year].balanceTotal);
  }
});

test("2025 monthly roll-forwards tie to the year-end balances", async () => {
  const data = await loadFinanceData();
  const months = data.monthly2025;
  assert.equal(months.length, 12);
  assert.equal(months.reduce((sum, row) => sum + row.revenue, 0), data.years["2025"].revenue);
  assert.equal(months.reduce((sum, row) => sum + row.cogs, 0), data.years["2025"].cogs);
  assert.equal(months.reduce((sum, row) => sum + row.netIncome, 0), data.years["2025"].netIncome);
  assert.equal(months.at(-1).cashBalance, data.years["2025"].cash);
  assert.equal(months.at(-1).arBalance, data.years["2025"].ar);
  assert.equal(months.at(-1).apBalance, data.years["2025"].ap);
});

test("source-quality exceptions are retained for review", async () => {
  const data = await loadFinanceData();
  assert.equal(data.sourceChecks.journalLines, 15510);
  assert.equal(data.sourceChecks.duplicateJournalRows, 32);
  assert.equal(data.sourceChecks.zeroValueJournalRows, 14);
  assert.ok(data.receivableExceptions.every((row) => row.ending < 0));
  assert.ok(data.payableExceptions.every((row) => row.ending < 0));
});

test("2026 tax-invoice aggregates reconcile to the Clobe source totals", async () => {
  const data = await loadCurrentFinanceData();
  assert.equal(data.salesMonthly2026.reduce((sum, row) => sum + row.amount, 0), data.sourceSummary.salesSupplyValue);
  assert.equal(data.purchaseMonthly2026.reduce((sum, row) => sum + row.amount, 0), data.sourceSummary.purchaseSupplyValue);
  assert.equal(data.salesDaily2026.reduce((sum, row) => sum + row.amount, 0), data.sourceSummary.salesSupplyValue);
  assert.equal(data.purchaseDaily2026.reduce((sum, row) => sum + row.amount, 0), data.sourceSummary.purchaseSupplyValue);
  assert.equal(data.salesMonthly2026.length, 8);
  assert.equal(data.accounts.length, 15);
});

test("account-risk source totals stay internally consistent", async () => {
  const data = await loadCurrentFinanceData();
  const checking = data.accounts.filter((row) => row.type === "CHECKING").reduce((sum, row) => sum + row.krwBalance, 0);
  const loans = data.accounts.filter((row) => row.type === "LOAN").reduce((sum, row) => sum + row.krwBalance, 0);
  const fx = data.accounts.filter((row) => row.type === "FX").reduce((sum, row) => sum + row.krwBalance, 0);
  assert.equal(checking, data.accountSummary.checkingBalanceSum);
  assert.equal(loans, data.accountSummary.loanBalanceSum);
  assert.equal(fx, data.accountSummary.fxBalanceSumKrw);
});

test("2026 Clobe snapshot date, balance trend, and journal summary stay reconciled", async () => {
  const data = await loadCurrentFinanceData();
  assert.equal(data.asOf, "2026-08-25");
  assert.equal(data.balanceTrend[0].date, data.asOf);
  assert.equal(data.balanceTrend[0].balance, data.accountSummary.checkingBalanceSum + data.accountSummary.fxBalanceSumKrw);
  assert.equal(data.journalSummary.lineCount, 17922);
  assert.equal(Math.abs(data.journalSummary.debitAmountKrw - data.journalSummary.creditAmountKrw), data.journalSummary.differenceKrw);
  assert.equal(data.journalSummary.differenceKrw, 2218);
  assert.equal(data.journalSummary.checkingAccount.code, "10300");
  assert.equal(
    data.journalSummary.checkingAccount.debitAmountKrw - data.journalSummary.checkingAccount.creditAmountKrw,
    data.journalSummary.checkingAccount.netChangeKrw,
  );
});

test("general ledger carries pre-period postings into opening balances", () => {
  const opening = [{ code: "101", name: "현금", endingDebit: 100, endingCredit: 0 },
    { code: "301", name: "자본", endingDebit: 0, endingCredit: 100 }];
  const base = { sourceType: "CONTROLLED_POSTING", sourceId: "batch", voucherNumber: "V", accountId: "",
    partnerName: "", departmentName: "", description: "", postedAt: 1 };
  const rows = [
    { ...base, id: "1", voucherDate: "2026-01-10", lineNumber: 1, accountCode: "101", accountName: "현금", debitAmount: 30, creditAmount: 0 },
    { ...base, id: "2", voucherDate: "2026-01-10", lineNumber: 2, accountCode: "301", accountName: "자본", debitAmount: 0, creditAmount: 30 },
    { ...base, id: "3", voucherDate: "2026-02-10", lineNumber: 1, accountCode: "101", accountName: "현금", debitAmount: 0, creditAmount: 20 },
    { ...base, id: "4", voucherDate: "2026-02-10", lineNumber: 2, accountCode: "301", accountName: "자본", debitAmount: 20, creditAmount: 0 },
  ];
  const summaries = buildLedgerAccountSummaries(opening, rows, "2026-02-01");
  const cash = summaries.find((row) => row.accountCode === "101"); const capital = summaries.find((row) => row.accountCode === "301");
  assert.deepEqual({ openingDebit: cash.openingDebit, periodCredit: cash.periodCredit, endingDebit: cash.endingDebit }, { openingDebit: 130, periodCredit: 20, endingDebit: 110 });
  assert.deepEqual({ openingCredit: capital.openingCredit, periodDebit: capital.periodDebit, endingCredit: capital.endingCredit }, { openingCredit: 130, periodDebit: 20, endingCredit: 110 });
  assert.equal(summaries.reduce((sum, row) => sum + row.openingDebit - row.openingCredit, 0), 0);
  assert.equal(summaries.reduce((sum, row) => sum + row.periodDebit - row.periodCredit, 0), 0);
  assert.equal(summaries.reduce((sum, row) => sum + row.endingDebit - row.endingCredit, 0), 0);
});

test("operational statements use posted movements and require an approved classified opening", () => {
  const rows = [
    { key: "101", accountId: "", accountCode: "101", accountName: "현금", openingDebit: 1_000, openingCredit: 0,
      periodDebit: 500, periodCredit: 200, endingDebit: 1_300, endingCredit: 0, lineCount: 2 },
    { key: "301", accountId: "", accountCode: "301", accountName: "자본금", openingDebit: 0, openingCredit: 1_000,
      periodDebit: 0, periodCredit: 0, endingDebit: 0, endingCredit: 1_000, lineCount: 0 },
    { key: "401", accountId: "", accountCode: "401", accountName: "상품매출", openingDebit: 0, openingCredit: 0,
      periodDebit: 0, periodCredit: 500, endingDebit: 0, endingCredit: 500, lineCount: 1 },
    { key: "801", accountId: "", accountCode: "801", accountName: "급여", openingDebit: 0, openingCredit: 0,
      periodDebit: 200, periodCredit: 0, endingDebit: 200, endingCredit: 0, lineCount: 1 },
  ];
  const categories = { "101": "ASSET", "301": "EQUITY", "401": "REVENUE", "801": "EXPENSE" };
  const statements = buildOperationalFinancialStatements(rows, categories, true);
  assert.equal(statements.status, "OFFICIAL");
  assert.deepEqual({ revenue: statements.incomeStatement.revenue, expenses: statements.incomeStatement.expenses,
    netIncome: statements.incomeStatement.netIncome }, { revenue: 500, expenses: 200, netIncome: 300 });
  assert.deepEqual({ assets: statements.balanceSheet.assets, equity: statements.balanceSheet.equity,
    currentEarnings: statements.balanceSheet.currentEarnings, difference: statements.balanceSheet.equationDifference },
  { assets: 1_300, equity: 1_000, currentEarnings: 300, difference: 0 });
  assert.equal(buildOperationalFinancialStatements(rows, categories, false).status, "DRAFT");
  assert.equal(buildOperationalFinancialStatements(rows, { ...categories, "101": "OTHER" }, true).quality.unclassifiedCount, 1);
});

test("statement comparisons keep equal-day and completed-month scopes explicit", async () => {
  const historical = await loadFinanceData();
  assert.equal(previousEqualLengthPeriod("2026-01-01", "2026-08-15"), null);
  assert.deepEqual(previousEqualLengthPeriod("2026-08-01", "2026-08-15"),
    { from: "2026-07-17", to: "2026-07-31", days: 15 });
  assert.deepEqual(completedMonthsInRange("2026-01-01", "2026-08-15"), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(completedMonthsInRange("2026-08-01", "2026-08-15"), []);
  const comparison = historicalCloseComparison(historical.monthly2025, "2026-01-01", "2026-08-15");
  const completed = historical.monthly2025.slice(0, 7);
  assert.equal(comparison.from, "2025-01-01"); assert.equal(comparison.to, "2025-07-31");
  assert.equal(comparison.monthCount, 7);
  assert.equal(comparison.revenue, completed.reduce((total, row) => total + row.revenue, 0));
  assert.equal(comparison.netIncome, completed.reduce((total, row) => total + row.netIncome, 0));
  assert.equal(comparison.expenses, comparison.revenue - comparison.netIncome);
  assert.equal(historicalCloseComparison(historical.monthly2025, "2026-08-01", "2026-08-15"), null);
  assert.equal(comparisonDelta(120, 100), 20); assert.equal(comparisonDelta(10, 0), null);
});

test("ledger integrity drift detects lineage changes even when totals stay equal", () => {
  const frozen = { asOf: "2026-07-31", ledgerHash: "aaa", lineCount: 20, openingSetId: "open-1",
    openingChecksum: "checksum-1", totals: { periodDebit: 100, periodCredit: 100 } };
  const same = evaluateLedgerSnapshotDrift(frozen, { ...frozen });
  assert.equal(same.drifted, false); assert.equal(same.totalsChanged, false); assert.equal(same.openingChanged, false);
  const replacedLineage = evaluateLedgerSnapshotDrift(frozen, { ...frozen, ledgerHash: "bbb" });
  assert.equal(replacedLineage.drifted, true); assert.equal(replacedLineage.totalsChanged, false);
  const changedOpening = evaluateLedgerSnapshotDrift(frozen, { ...frozen, ledgerHash: "ccc", openingSetId: "open-2" });
  assert.equal(changedOpening.openingChanged, true);
  const changedTotals = evaluateLedgerSnapshotDrift(frozen, { ...frozen, ledgerHash: "ddd", lineCount: 22,
    totals: { periodDebit: 120, periodCredit: 120 } });
  assert.equal(changedTotals.totalsChanged, true); assert.equal(changedTotals.lineCountDelta, 2);
});

test("August management-report commerce inputs reconcile without treating supply difference as profit", async () => {
  const data = await loadCurrentFinanceData();
  const period = "2026-08";
  const sales = data.salesMonthly2026.find((row) => row.month === period).amount;
  const purchases = data.purchaseMonthly2026.find((row) => row.month === period).amount;
  const salesDaily = data.salesDaily2026.filter((row) => row.date.startsWith(period));
  const purchaseDaily = data.purchaseDaily2026.filter((row) => row.date.startsWith(period));
  assert.equal(salesDaily.reduce((sum, row) => sum + row.amount, 0), sales);
  assert.equal(purchaseDaily.reduce((sum, row) => sum + row.amount, 0), purchases);
  assert.equal(sales - purchases, 3953653861);
  assert.ok(salesDaily.reduce((sum, row) => sum + row.count, 0) > 0);
  assert.ok(purchaseDaily.reduce((sum, row) => sum + row.count, 0) > 0);
});

test("straight-line depreciation preserves residual value and absorbs won rounding in the final month", () => {
  const inputs = { acquisitionCost: 1_000_003, residualValue: 100_000, usefulLifeMonths: 3, inServicePeriod: "2026-01" };
  const first = calculateStraightLineDepreciation({ ...inputs, period: "2026-01" });
  const second = calculateStraightLineDepreciation({ ...inputs, period: "2026-02", postedAccumulated: first.depreciation });
  const third = calculateStraightLineDepreciation({ ...inputs, period: "2026-03", postedAccumulated: first.depreciation + second.depreciation });
  assert.equal(first.depreciation + second.depreciation + third.depreciation, 900_003);
  assert.equal(third.closingBookValue, inputs.residualValue);
  const imported = calculateStraightLineDepreciation({ ...inputs, period: "2026-03", openingAccumulated: 600_000 });
  assert.equal(imported.depreciation, 300_003);
  assert.equal(imported.closingBookValue, inputs.residualValue);
  assert.throws(() => calculateStraightLineDepreciation({ ...inputs, period: "2026-01", residualValue: 1_000_003 }), /Invalid/);
});
