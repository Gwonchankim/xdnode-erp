import assert from "node:assert/strict";
import test from "node:test";
import { financeCurrentData } from "../app/finance-current-data.ts";
import { financeCurrentInsights } from "../app/finance-current-insights.ts";
import { buildAccountRiskModel, buildSalesForecast, DEFAULT_FINANCE_RISK_POLICY } from "../app/finance-decision-model.ts";

test("sales forecast derives dates, totals and ordered scenarios from source observations", () => {
  const model = buildSalesForecast(financeCurrentData.salesDaily2026, financeCurrentInsights.taxInvoicesAsOf);
  assert.equal(model.elapsedDays, 225);
  assert.equal(model.remainingDays, 140);
  assert.equal(model.daysInYear, 365);
  assert.equal(model.actualYtd, financeCurrentData.sourceSummary.salesSupplyValue);
  assert.equal(model.scenarios[1].projectedTotal, 63_374_744_254);
  assert.ok(model.scenarios[0].projectedTotal <= model.scenarios[1].projectedTotal);
  assert.ok(model.scenarios[1].projectedTotal <= model.scenarios[2].projectedTotal);
  assert.ok(model.scenarios.every((scenario) => scenario.projectedTotal >= model.actualYtd));
});

test("sales forecast supports leap years without fixed elapsed-day constants", () => {
  const model = buildSalesForecast([{ date: "2024-02-29", amount: 60_000 }], "2024-02-29");
  assert.equal(model.daysInYear, 366);
  assert.equal(model.elapsedDays, 60);
  assert.equal(model.remainingDays, 306);
});

test("account risk score equals visible driver points and is deterministic", () => {
  const first = buildAccountRiskModel(financeCurrentData.accountSummary, financeCurrentData.accounts, financeCurrentData.balanceTrend);
  const second = buildAccountRiskModel(financeCurrentData.accountSummary, financeCurrentData.accounts, financeCurrentData.balanceTrend);
  assert.deepEqual(first, second);
  assert.equal(first.score, first.drivers.reduce((sum, driver) => sum + driver.points, 0));
  assert.equal(first.score, 58);
  assert.equal(first.level, "주의");
  assert.ok(first.score <= 100);
  assert.equal(first.drivers.length, 6);
  assert.match(first.policyStatus, /정책 미등록/);
});

test("configured company policy changes the operating-cash signal without breaking the 100-point model", () => {
  const policy = { ...DEFAULT_FINANCE_RISK_POLICY, configured: true, version: 2, minimumOperatingCash: 300_000_000 };
  const model = buildAccountRiskModel(financeCurrentData.accountSummary, financeCurrentData.accounts, financeCurrentData.balanceTrend, policy);
  assert.equal(model.score, 83);
  assert.equal(model.level, "높음");
  assert.equal(model.drivers.reduce((sum, driver) => sum + driver.maxPoints, 0), 100);
  assert.equal(model.drivers.find((driver) => driver.key === "operating-cash")?.points, 25);
  assert.match(model.policyStatus, /v2 적용/);
});

test("account risk handles no debt and no balance history", () => {
  const model = buildAccountRiskModel(
    { checkingBalanceSum: 1_000_000, fxBalanceSumKrw: 0, loanBalanceSum: 0 },
    [],
    [],
  );
  assert.equal(model.metrics.debtCoverage, null);
  assert.equal(model.metrics.currentToMedian, null);
  assert.ok(Number.isFinite(model.score));
});
