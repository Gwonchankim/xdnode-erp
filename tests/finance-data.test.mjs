import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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
  assert.equal(data.asOf, "2026-08-14");
  assert.equal(data.balanceTrend[0].date, data.asOf);
  assert.equal(data.balanceTrend[0].balance, data.accountSummary.checkingBalanceSum + data.accountSummary.fxBalanceSumKrw);
  assert.equal(data.journalSummary.lineCount, 17467);
  assert.equal(Math.abs(data.journalSummary.debitAmountKrw - data.journalSummary.creditAmountKrw), data.journalSummary.differenceKrw);
  assert.equal(data.journalSummary.differenceKrw, 31190);
  assert.equal(data.journalSummary.checkingAccount.code, "10300");
  assert.equal(
    data.journalSummary.checkingAccount.debitAmountKrw - data.journalSummary.checkingAccount.creditAmountKrw,
    data.journalSummary.checkingAccount.netChangeKrw,
  );
});
