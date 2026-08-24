import assert from "node:assert/strict";
import test from "node:test";

import {
  DAILY_WORK_HOURS, MONTHLY_ORDINARY_HOURS, dailyOrdinaryWageOn, normalizeDate, workingTimeRuleFor,
  calculateLeaveAllowance, calculateSeverance, daysInYearMonth, ordinaryDailyWageOf, precedingMonths,
} from "../app/hr-severance-calculation.ts";

const wages = (entries) => entries.map(([yearMonth, grossPay]) => ({ yearMonth, grossPay }));

test("직전 3개월은 퇴직월을 빼고 최근 순으로 잡는다", () => {
  assert.deepEqual(precedingMonths("2026-09-15"), ["2026-08", "2026-07", "2026-06"]);
  // 연초 퇴사는 전년도로 넘어간다.
  assert.deepEqual(precedingMonths("2026-01-31"), ["2025-12", "2025-11", "2025-10"]);
  assert.deepEqual(precedingMonths(""), []);
});

test("급여월 일수는 윤년까지 맞춘다", () => {
  assert.equal(daysInYearMonth("2026-02"), 28);
  assert.equal(daysInYearMonth("2024-02"), 29);
  assert.equal(daysInYearMonth("2026-09"), 30);
  assert.equal(daysInYearMonth("깨진값"), 0);
});

test("계속근로 1년 미만은 법정 퇴직금 대상이 아니다", () => {
  const result = calculateSeverance({
    joinDate: "2026-01-01", retirementDate: "2026-09-30",
    recentWages: wages([["2026-08", 5_000_000], ["2026-07", 5_000_000], ["2026-06", 5_000_000]]),
    monthlyOrdinaryWage: 5_000_000,
  });
  assert.equal(result.eligible, false);
  assert.equal(result.severance, 0);
  assert.equal(result.tenureDays, 273);
  assert.match(result.reason, /1년 미만/);
});

test("퇴직금은 1일 평균임금 × 30 × 재직일수/365 로 계산한다", () => {
  const result = calculateSeverance({
    joinDate: "2023-10-01", retirementDate: "2026-09-30",
    recentWages: wages([["2026-08", 6_200_000], ["2026-07", 6_200_000], ["2026-06", 6_200_000]]),
    monthlyOrdinaryWage: 5_000_000,
  });
  // 2026-06(30) + 2026-07(31) + 2026-08(31) = 92일, 임금총액 18,600,000
  assert.equal(result.averageWageDays, 92);
  assert.equal(result.averageWageTotal, 18_600_000);
  assert.equal(Math.round(result.averageDailyWage), 202_174);
  assert.equal(result.basis, "AVERAGE");
  assert.equal(result.tenureDays, 1096);
  assert.equal(result.severance, Math.round((18_600_000 / 92) * 30 * (1096 / 365)));
  assert.equal(result.reason, "");
});

test("평균임금이 통상임금보다 적으면 통상임금으로 올려 잡는다", () => {
  // 무급휴직 등으로 직전 3개월 지급액이 주저앉은 경우.
  const result = calculateSeverance({
    joinDate: "2024-01-01", retirementDate: "2026-03-31",
    recentWages: wages([["2026-02", 500_000], ["2026-01", 500_000], ["2025-12", 500_000]]),
    monthlyOrdinaryWage: 5_000_000,
  });
  assert.equal(result.basis, "ORDINARY");
  assert.equal(result.appliedDailyWage, dailyOrdinaryWageOn(5_000_000, "2026-03-31").dailyWage);
  assert.ok(result.appliedDailyWage > result.averageDailyWage);
});

test("직전 급여 자료가 빠진 달은 분모에서도 빼고 사유를 남긴다", () => {
  const result = calculateSeverance({
    joinDate: "2024-01-01", retirementDate: "2026-09-30",
    recentWages: wages([["2026-08", 6_200_000]]),
    monthlyOrdinaryWage: 0,
  });
  assert.equal(result.averageWageDays, 31);
  assert.equal(result.months.length, 1);
  assert.match(result.reason, /2개월치 급여 자료가 없어/);
  // 있는 달만으로 산정하므로 금액 자체는 나온다.
  assert.ok(result.severance > 0);
});

test("자료도 통상임금도 없으면 0원과 사유를 돌려준다", () => {
  const result = calculateSeverance({
    joinDate: "2024-01-01", retirementDate: "2026-09-30", recentWages: [], monthlyOrdinaryWage: 0,
  });
  assert.equal(result.severance, 0);
  assert.equal(result.basis, "NONE");
  assert.match(result.reason, /평균임금을 산정할 수 없습니다/);
});

test("입사일이 점 구분자로 저장돼 있어도 계산한다", () => {
  // 실서버 hr_employee_records.join_date 는 "2024.11.14" 형식이고 retirement_date 는 "2026-08-13" 형식이다.
  // 하이픈만 받던 시절에는 퇴직금이 전부 "입사일과 퇴사일을 모두 확인해 주세요"로 떨어졌다.
  const dotted = calculateSeverance({
    joinDate: "2024.11.14", retirementDate: "2026-08-13",
    recentWages: wages([["2026-07", 3_250_000], ["2026-06", 3_250_000], ["2026-05", 3_250_000]]),
    monthlyOrdinaryWage: 3_250_000,
  });
  const dashed = calculateSeverance({
    joinDate: "2024-11-14", retirementDate: "2026-08-13",
    recentWages: wages([["2026-07", 3_250_000], ["2026-06", 3_250_000], ["2026-05", 3_250_000]]),
    monthlyOrdinaryWage: 3_250_000,
  });
  assert.equal(dotted.tenureDays, dashed.tenureDays);
  assert.equal(dotted.severance, dashed.severance);
  assert.ok(dotted.eligible);
  assert.equal(dotted.reason, "");
  assert.equal(normalizeDate("2024.11.14"), "2024-11-14");
});

test("잘못된 날짜와 뒤집힌 기간은 계산하지 않는다", () => {
  assert.match(calculateSeverance({ joinDate: "", retirementDate: "2026-09-30", recentWages: [], monthlyOrdinaryWage: 0 }).reason, /입사일과 퇴사일/);
  assert.match(calculateSeverance({ joinDate: "2026-09-30", retirementDate: "2024-01-01", recentWages: [], monthlyOrdinaryWage: 0 }).reason, /퇴사일이 입사일보다 빠릅니다/);
});

test("두 기준을 각각 계산해 큰 쪽을 적용한다", () => {
  // 평균임금이 큰 경우
  const avgWins = calculateSeverance({
    joinDate: "2025-03-17", retirementDate: "2026-08-31",
    recentWages: wages([["2026-07", 3_333_333], ["2026-06", 4_833_333], ["2026-05", 3_833_333]]),
    monthlyOrdinaryWage: 3_333_333,
  });
  assert.equal(avgWins.basis, "AVERAGE");
  assert.ok(avgWins.averageSeverance > avgWins.ordinarySeverance);
  assert.equal(avgWins.severance, avgWins.averageSeverance);

  // 통상임금(법정 하한)이 큰 경우
  const ordWins = calculateSeverance({
    joinDate: "2025-05-22", retirementDate: "2026-08-31",
    recentWages: wages([["2026-07", 2_916_667], ["2026-06", 3_354_167], ["2026-05", 3_354_167]]),
    monthlyOrdinaryWage: 2_916_667,
  });
  assert.equal(ordWins.basis, "ORDINARY");
  assert.ok(ordWins.ordinarySeverance > ordWins.averageSeverance);
  assert.equal(ordWins.severance, ordWins.ordinarySeverance);
  // 적용액은 항상 두 값 중 큰 쪽이어야 한다.
  for (const r of [avgWins, ordWins]) {
    assert.equal(r.severance, Math.max(r.averageSeverance, r.ordinarySeverance));
  }
});

test("추정치는 법정 산식과 어긋나는 지점을 스스로 밝힌다", () => {
  const result = calculateSeverance({
    joinDate: "2023-10-01", retirementDate: "2026-09-30",
    recentWages: wages([["2026-08", 6_200_000], ["2026-07", 6_200_000], ["2026-06", 6_200_000]]),
    monthlyOrdinaryWage: 5_000_000,
  });
  // 이 값이 확정 지급액으로 오해되지 않도록, 화면이 그대로 보여줄 한계를 함께 돌려준다.
  assert.equal(result.limitations.length, 3);
  assert.ok(result.limitations.some((item) => item.includes("퇴직일 이전 3개월")));
  assert.ok(result.limitations.some((item) => item.includes("제외기간")));
  assert.ok(result.limitations.some((item) => item.includes("3/12")));
});

test("1일 통상임금은 (월 통상임금 ÷ 209시간) × 8시간이다", () => {
  assert.equal(MONTHLY_ORDINARY_HOURS, 209);
  assert.equal(DAILY_WORK_HOURS, 8);
  assert.equal(ordinaryDailyWageOf(5_000_000), (5_000_000 / 209) * 8);
  assert.equal(Math.round(ordinaryDailyWageOf(5_000_000)), 191_388);
  assert.equal(ordinaryDailyWageOf(0), 0);
  // 월급 일할계산(× 12 ÷ 365)과는 다른 값이어야 한다. 섞이면 연차수당이 과소 산정된다.
  assert.notEqual(Math.round(ordinaryDailyWageOf(5_000_000)), Math.round(5_000_000 * 12 / 365));
});

test("소정근로시간이 다른 근무형태는 기준시간을 바꿔 넣을 수 있다", () => {
  // 주 35시간·1일 7시간이면 월 기준시간도 209가 아니다.
  assert.equal(ordinaryDailyWageOf(5_000_000, 182.5, 7), (5_000_000 / 182.5) * 7);
  // 시급은 오르지만(23,923 → 27,322) 1일 시간이 8→7로 줄어 1일 통상임금은 거의 그대로다.
  // 월 기준시간 ÷ 1일 시간이 양쪽 다 약 26.1일이기 때문. 바뀌는 건 시급이지 일당이 아니다.
  assert.equal(Math.round(ordinaryDailyWageOf(5_000_000, 182.5, 7)), 191_781);
  assert.ok(Math.abs(ordinaryDailyWageOf(5_000_000, 182.5, 7) - ordinaryDailyWageOf(5_000_000)) < 500);
  assert.equal(ordinaryDailyWageOf(5_000_000, 0, 7), 0);
});

test("소정근로시간 규정은 시행일 기준으로 갈린다", () => {
  // 주 35시간제는 2026-08-01 시행. 하루 전까지는 옛 규정이어야 한다.
  assert.equal(workingTimeRuleFor("2026-07-31").monthlyHours, 209);
  assert.equal(workingTimeRuleFor("2026-07-31").dailyHours, 8);
  assert.equal(workingTimeRuleFor("2026-08-01").monthlyHours, 182.5);
  assert.equal(workingTimeRuleFor("2026-08-01").dailyHours, 7);
  assert.equal(workingTimeRuleFor("2026-09-15").label, "주 35시간");
  // 날짜를 못 알아보면 가장 최근 규정으로 떨어진다.
  assert.equal(workingTimeRuleFor("").monthlyHours, 182.5);
});

test("주 35시간제는 시급을 올리지만 1일 통상임금은 거의 그대로다", () => {
  const before = dailyOrdinaryWageOn(5_000_000, "2026-07-31");
  const after = dailyOrdinaryWageOn(5_000_000, "2026-08-01");
  assert.equal(Math.round(before.dailyWage), 191_388);
  assert.equal(Math.round(after.dailyWage), 191_781);
  // 근로시간만 줄고 급여는 그대로라, 시급은 오르고 1일 몫은 유지된다.
  assert.ok(5_000_000 / after.rule.monthlyHours > 5_000_000 / before.rule.monthlyHours);
  assert.ok(Math.abs(after.dailyWage - before.dailyWage) < 500);
});

test("연차수당은 정산 시점 규정을 따른다", () => {
  const oldRule = calculateLeaveAllowance(10, 5_000_000, "2026-07-31");
  const newRule = calculateLeaveAllowance(10, 5_000_000, "2026-08-01");
  assert.equal(oldRule.rule.label, "주 40시간");
  assert.equal(newRule.rule.label, "주 35시간");
  assert.equal(newRule.amount, Math.round((5_000_000 / 182.5) * 7 * 10));
});

test("퇴직금의 통상임금 하한도 퇴사일 규정을 쓴다", () => {
  const result = calculateSeverance({
    joinDate: "2024-01-01", retirementDate: "2026-09-30",
    recentWages: wages([["2026-08", 500_000], ["2026-07", 500_000], ["2026-06", 500_000]]),
    monthlyOrdinaryWage: 5_000_000,
  });
  assert.equal(result.basis, "ORDINARY");
  assert.equal(result.workingTimeRule.label, "주 35시간");
  assert.equal(result.ordinaryDailyWage, (5_000_000 / 182.5) * 7);
});

test("연차수당은 잔여일수 × 1일 통상임금이고 마이너스 연차는 공제로 남는다", () => {
  const daily = ordinaryDailyWageOf(5_000_000);
  const at2026 = (days) => calculateLeaveAllowance(days, 5_000_000, "2026-07-31").amount;
  assert.equal(at2026(13.25), Math.round(daily * 13.25));
  assert.equal(at2026(0), 0);
  // 선사용한 연차는 음수 금액이 그대로 나와 정산에서 차감된다.
  const negative = calculateLeaveAllowance(-3.5, 5_000_000, "2026-07-31");
  assert.ok(negative.amount < 0);
  assert.equal(negative.amount, Math.round(daily * -3.5));
  assert.equal(negative.days, -3.5);
});
