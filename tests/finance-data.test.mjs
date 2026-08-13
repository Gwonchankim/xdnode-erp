import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadFinanceData() {
  const source = await readFile(new URL("../app/finance-historical-data.ts", import.meta.url), "utf8");
  const match = source.match(/export const financeHistoricalData = ([\s\S]+) as const;/);
  assert.ok(match, "historical finance data export not found");
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
