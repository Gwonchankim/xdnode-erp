import assert from "node:assert/strict";
import test from "node:test";

import { calculateCompensation } from "../app/compensation-calculation.ts";

const columns = { research: true, extra: true, welfare: false, severance: true };

function employee(patch = {}) {
  return {
    id: "employee-1",
    name: "테스트 직원",
    department: "경영지원팀",
    title: "사원",
    birthDate: "1990-01-01",
    joinDate: "2024-01-01",
    leaveDate: "",
    probationMonths: 0,
    annualSalary: 60_000_000,
    basePay: 0,
    manualBasic: false,
    meal: 200_000,
    car: 200_000,
    child: 200_000,
    monthly: {},
    ...patch,
  };
}

test("full-month salary removes included tax-free allowances from basic pay", () => {
  const result = calculateCompensation(employee(), 2026, 8, "round", columns);
  assert.equal(result.days, 31);
  assert.equal(result.basic, 4_400_000);
  assert.equal(result.meal + result.car + result.child, 600_000);
  assert.equal(result.total, 5_000_000);
});

test("partial-month pay follows the confirmed 365-day method and floors each component", () => {
  const result = calculateCompensation(employee({
    annualSalary: 39_000_000,
    joinDate: "2026-08-19",
    meal: 200_000,
    car: 0,
    child: 0,
  }), 2026, 8, "round", columns);
  assert.equal(result.days, 13);
  assert.equal(result.basic, 1_303_561);
  assert.equal(result.meal, 85_479);
  assert.equal(result.total, 1_389_040);
});

test("probation ending mid-month splits 90 and 100 percent salary segments", () => {
  const result = calculateCompensation(employee({
    annualSalary: 30_000_000,
    joinDate: "2026-04-06",
    probationMonths: 3,
    meal: 200_000,
    car: 0,
    child: 0,
  }), 2026, 7, "round", columns);
  assert.equal(result.probationEnd?.toISOString().slice(0, 10), "2026-07-05");
  assert.equal(result.days, 31);
  assert.equal(result.mixedProbation, true);
  assert.equal(result.basic, 2_303_013);
  assert.equal(result.total, 2_503_013);
});

test("manual monthly basic pay and optional columns stay explicit", () => {
  const result = calculateCompensation(employee({
    annualSalary: 0,
    manualBasic: true,
    meal: 0,
    car: 0,
    child: 0,
    monthly: { "2026-08": { basic: 3_000_000, extra: 500_000, research: 200_000, severance: 100_000 } },
  }), 2026, 8, "down", { ...columns, research: false });
  assert.equal(result.basic, 3_000_000);
  assert.equal(result.research, 0);
  assert.equal(result.total, 3_600_000);
});

test("HR base-pay default is used and prorated when a manual-basic employee leaves mid-month", () => {
  const result = calculateCompensation(employee({
    annualSalary: 0,
    basePay: 3_100_000,
    manualBasic: true,
    leaveDate: "2026-08-15",
    meal: 200_000,
    car: 100_000,
    child: 0,
  }), 2026, 8, "down", columns);
  assert.equal(result.days, 15);
  assert.equal(result.basic, Math.floor(3_100_000 * 12 / 365 * 15));
  assert.equal(result.meal, Math.floor(200_000 * 12 / 365 * 15));
  assert.equal(result.car, Math.floor(100_000 * 12 / 365 * 15));
});
