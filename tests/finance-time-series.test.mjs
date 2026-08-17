import assert from "node:assert/strict";
import test from "node:test";

import { financeCurrentData } from "../app/finance-current-data.ts";
import { financeCurrentInsights } from "../app/finance-current-insights.ts";
import { buildAmountSeries, buildBalanceSeries } from "../app/finance-time-series.ts";

test("cash series use observed closing balances without inventing unsupported months", () => {
  const daily = buildBalanceSeries(financeCurrentData.balanceTrend, "day");
  assert.equal(daily.points.length, 14);
  assert.equal(daily.points[0].startDate, "2026-08-05");
  assert.equal(daily.points.at(-1).endDate, financeCurrentData.asOf);
  assert.equal(daily.points.at(-1).value, financeCurrentData.balanceTrend[0].balance);

  const monthly = buildBalanceSeries(financeCurrentData.balanceTrend, "month");
  assert.deepEqual(monthly.points.map((point) => point.label), ["6월", "7월", "8월"]);
  assert.deepEqual(monthly.points.map((point) => point.value), [1_242_819_712, 1_692_218_331, 2_068_051_673]);
  assert.doesNotMatch(monthly.coverageNote, /2026-05/);
});

test("weekly cash closes on the last observed date in Monday-based weeks", () => {
  const weekly = buildBalanceSeries(financeCurrentData.balanceTrend, "week");
  assert.ok(weekly.points.length <= 10);
  for (const point of weekly.points) {
    assert.equal(new Date(`${point.startDate}T00:00:00Z`).getUTCDay(), 1);
    assert.ok(point.endDate >= point.startDate);
    assert.ok(point.endDate <= financeCurrentData.asOf);
  }
  assert.equal(weekly.points.at(-1).value, financeCurrentData.balanceTrend[0].balance);
});

test("sales series reconcile daily rows to monthly and quarterly source totals", () => {
  const monthly = buildAmountSeries(financeCurrentData.salesDaily2026, "month", financeCurrentInsights.taxInvoicesAsOf);
  assert.deepEqual(monthly.points.map((point) => point.value), financeCurrentData.salesMonthly2026.map((row) => row.amount));

  const quarterly = buildAmountSeries(financeCurrentData.salesDaily2026, "quarter", financeCurrentInsights.taxInvoicesAsOf);
  assert.equal(quarterly.points.reduce((sum, point) => sum + point.value, 0), financeCurrentData.sourceSummary.salesSupplyValue);
  assert.equal(monthly.points.reduce((sum, point) => sum + point.value, 0), financeCurrentData.sourceSummary.salesSupplyValue);
});

test("daily sales preserve zero-activity dates through the explicit invoice cutoff", () => {
  const daily = buildAmountSeries(financeCurrentData.salesDaily2026, "day", financeCurrentInsights.taxInvoicesAsOf);
  assert.equal(daily.points.length, 14);
  assert.equal(daily.points[0].startDate, "2026-07-31");
  assert.equal(daily.points.at(-1).endDate, financeCurrentInsights.taxInvoicesAsOf);
  assert.equal(daily.points.at(-1).value, 0);

  const weekly = buildAmountSeries(financeCurrentData.salesDaily2026, "week", financeCurrentInsights.taxInvoicesAsOf);
  assert.equal(weekly.points.length, 10);
  assert.equal(weekly.points.at(-1).endDate, financeCurrentInsights.taxInvoicesAsOf);
  for (const point of weekly.points) assert.equal(new Date(`${point.startDate}T00:00:00Z`).getUTCDay(), 1);
});

test("invalid or empty time-series input fails visibly instead of fabricating points", () => {
  assert.deepEqual(buildBalanceSeries([], "month").points, []);
  assert.deepEqual(buildAmountSeries([], "month", "invalid").points, []);
  assert.match(buildBalanceSeries([], "month").coverageNote, /표시하지 않습니다/);
});
