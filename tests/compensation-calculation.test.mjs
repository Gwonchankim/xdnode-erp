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

test("partial-month pay follows the confirmed 365-day method and rounds basic pay per the selected mode", () => {
  const result = calculateCompensation(employee({
    annualSalary: 39_000_000,
    joinDate: "2026-08-19",
    meal: 200_000,
    car: 0,
    child: 0,
  }), 2026, 8, "round", columns);
  assert.equal(result.days, 13);
  assert.equal(result.basic, 1_303_562);
  assert.equal(result.meal, 85_479);
  assert.equal(result.total, 1_389_041);
});

test("partial-month basic pay honors down/up rounding instead of always flooring", () => {
  const base = employee({ annualSalary: 39_000_000, joinDate: "2026-08-19", meal: 200_000, car: 0, child: 0 });
  const down = calculateCompensation(base, 2026, 8, "down", columns);
  const up = calculateCompensation(base, 2026, 8, "up", columns);
  assert.equal(down.basic, 1_303_561);
  assert.equal(up.basic, 1_303_562);
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

// 서버 검증식(app/api/hr/compensation/route.ts 의 validateDraft)이 이 total 산식과 어긋나면
// 자동 저장이 통째로 400 으로 막힌다. 화면에서 고친 값이 조용히 사라지고 새로고침하면
// 예전 값으로 되돌아가는데, 실제로 공제가 있는 달에서 그렇게 됐다. 두 식을 같이 묶어 둔다.
test("지급총액은 연차수당을 더하고 공제를 뺀 값이다", () => {
  const withColumns = { research: true, extra: true, welfare: false, severance: true, deduction: true, annualLeave: true };
  const row = calculateCompensation(employee({
    basePay: 4_216_667, meal: 200_000, manualBasic: true,
    monthly: { "2026-08": { deduction: 84_703, deductionNote: "마이너스 연월차 공제 0.5일", annualLeave: 0, severance: 0 } },
  }), 2026, 8, "round", withColumns);
  const 항목합 = row.basic + row.meal + row.car + row.child + row.incentive + row.bonus
    + row.extra + row.research + row.severance + row.annualLeave - row.deduction;
  assert.equal(row.deduction, 84_703);
  assert.equal(row.total, 항목합);
});

test("서버 검증식이 연차수당·공제를 함께 센다", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/api/hr/compensation/route.ts", import.meta.url), "utf8");
  assert.match(source, /values\.annualLeave! \+ values\.personalExpense! - values\.deduction!/);
  assert.match(source, /"severance", "annualLeave", "personalExpense", "deduction", "welfare", "total"/);
  // 공제 사유는 숫자 항목이 아니라 따로 실어야 확정할 때 살아남는다.
  assert.match(source, /deductionNote: String\(row\.deductionNote \?\? ""\)\.trim\(\)/);
});

// 개인비용지급은 업무에 쓴 개인 돈을 되돌려 주는 실비다. 일할계산하지 않고 적은 금액 그대로
// 지급총액에 더한다. 서버 검증식(validateDraft)도 같은 항목을 세야 자동 저장이 막히지 않는다.
test("개인비용지급은 일할계산 없이 지급총액에 더해진다", () => {
  const withColumns = { research: true, extra: true, welfare: false, severance: true, deduction: false, annualLeave: false, personalExpense: true };
  // 15일만 근무해도 실비는 깎이지 않는다.
  const row = calculateCompensation(employee({
    basePay: 3_000_000, meal: 200_000, manualBasic: true, joinDate: "2026-08-16",
    monthly: { "2026-08": { personalExpense: 150_000, personalExpenseNote: "출장 택시비 실비" } },
  }), 2026, 8, "round", withColumns);
  assert.equal(row.personalExpense, 150_000);
  const 항목합 = row.basic + row.meal + row.car + row.child + row.incentive + row.bonus
    + row.extra + row.research + row.severance + row.annualLeave + row.personalExpense - row.deduction;
  assert.equal(row.total, 항목합);

  // 열이 꺼져 있으면 금액이 있어도 지급총액에 들어가지 않는다 (다른 선택 열과 같은 규칙).
  const off = calculateCompensation(employee({
    basePay: 3_000_000, meal: 200_000, manualBasic: true, joinDate: "2026-08-16",
    monthly: { "2026-08": { personalExpense: 150_000 } },
  }), 2026, 8, "round", { ...withColumns, personalExpense: false });
  assert.equal(off.personalExpense, 0);
  assert.equal(off.total, row.total - 150_000);
});

test("서버 검증식이 개인비용지급을 함께 센다", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/api/hr/compensation/route.ts", import.meta.url), "utf8");
  assert.match(source, /values\.annualLeave! \+ values\.personalExpense! - values\.deduction!/);
  assert.match(source, /"annualLeave", "personalExpense", "deduction"/);
  // 확정하면 급여기록의 personal_expense 로 넘어가야 금액의 출처가 남는다.
  assert.match(source, /personal_expense/);
});

// 선택 열 토글은 settings_json 에 저장된다. normalizeSettings 의 목록에서 빠진 열은 저장되지 않고
// 다시 열 때 꺼진 채로 돌아오는데, 연차수당·개인비용지급은 열이 꺼지면 지급총액에서도 빠지므로
// 지급액이 조용히 줄어든다. 새 선택 열을 만들면 반드시 이 목록에 넣어야 한다.
test("선택 열 토글은 일곱 개가 모두 저장된다", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../app/api/hr/compensation/route.ts", import.meta.url), "utf8");
  const block = source.slice(source.indexOf("const columnDefaults"), source.indexOf("const standardDefaults"));
  for (const field of ["research", "extra", "welfare", "severance", "deduction", "annualLeave", "personalExpense"]) {
    assert.ok(block.includes(`${field}:`), `${field} 가 columnDefaults 에 없습니다`);
  }
  // 목록을 손으로 다시 적지 말고 defaults 의 키를 그대로 쓴다 — 그래야 빠뜨릴 수 없다.
  assert.match(source, /Object\.keys\(columnDefaults\)\.map/);
});
