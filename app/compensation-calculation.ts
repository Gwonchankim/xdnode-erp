export type CompensationRounding = "round" | "up" | "down";

export type CompensationMonthlyPay = {
  basic?: number;
  incentive?: number;
  bonus?: number;
  extra?: number;
  research?: number;
  severance?: number;
  welfare?: number;
  welfareNote?: string;
  note?: string;
};

export type CompensationEmployee = {
  id: string;
  name: string;
  department: string;
  title: string;
  birthDate: string;
  joinDate: string;
  leaveDate: string;
  probationMonths: number;
  annualSalary: number;
  basePay: number;
  manualBasic: boolean;
  meal: number;
  car: number;
  child: number;
  monthly: Record<string, CompensationMonthlyPay>;
};

export type CompensationColumns = { research: boolean; extra: boolean; welfare: boolean; severance: boolean };

export type CompensationRow = {
  employee: CompensationEmployee;
  days: number;
  daysInMonth: number;
  basic: number;
  meal: number;
  car: number;
  child: number;
  incentive: number;
  bonus: number;
  extra: number;
  research: number;
  severance: number;
  welfare: number;
  total: number;
  mixedProbation: boolean;
  probationApplied: boolean;
  probationEnd: Date | null;
  probationWithoutJoin: boolean;
  probationOver: boolean;
};

const DAY = 86_400_000;

export const compensationMonthKey = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;
export const daysInCompensationMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

const parseDate = (value: string) => value ? new Date(`${value}T00:00:00Z`) : null;
const roundPay = (value: number, rounding: CompensationRounding) => rounding === "up" ? Math.ceil(value) : rounding === "down" ? Math.floor(value) : Math.round(value);
const overlapDays = (aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) => {
  const start = aStart > bStart ? aStart : bStart;
  const end = aEnd < bEnd ? aEnd : bEnd;
  return start > end ? 0 : Math.round((end.getTime() - start.getTime()) / DAY) + 1;
};
const probationEnd = (join: Date | null, months: number) => {
  if (!join || !months) return null;
  const year = join.getUTCFullYear();
  const targetMonth = join.getUTCMonth() + months;
  const day = Math.min(join.getUTCDate(), new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, targetMonth, day) - DAY);
};

export function calculateCompensation(employee: CompensationEmployee, year: number, month: number, rounding: CompensationRounding, columns: CompensationColumns): CompensationRow {
  const totalDays = daysInCompensationMonth(year, month);
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  const monthEnd = new Date(Date.UTC(year, month - 1, totalDays));
  const join = parseDate(employee.joinDate);
  const leave = parseDate(employee.leaveDate);
  const start = join && join > monthStart ? join : monthStart;
  const end = leave && leave < monthEnd ? leave : monthEnd;
  const days = start > end ? 0 : Math.round((end.getTime() - start.getTime()) / DAY) + 1;
  const endOfProbation = probationEnd(join, employee.probationMonths);
  const probationDays = days && join && endOfProbation ? overlapDays(start, end, join, endOfProbation) : 0;
  const segments = days ? [
    ...(probationDays ? [{ days: probationDays, rate: 0.9 }] : []),
    ...(days - probationDays ? [{ days: days - probationDays, rate: 1 }] : []),
  ] : [];
  const allowanceMonthly = employee.meal + employee.car + employee.child;
  const monthly = employee.monthly[compensationMonthKey(year, month)] ?? {};
  let basic = 0;
  if (employee.manualBasic) {
    const monthlyBasic = monthly.basic ?? employee.basePay;
    basic = !days ? 0 : days === totalDays ? monthlyBasic : Math.floor(monthlyBasic * 12 / 365 * days);
  }
  else if (days && employee.annualSalary > 0) {
    basic = days === totalDays && segments.length === 1
      ? Math.max(0, roundPay(employee.annualSalary / 12 * segments[0].rate - allowanceMonthly, rounding))
      : segments.reduce((sum, segment) => sum + Math.max(0, roundPay((employee.annualSalary * segment.rate - allowanceMonthly * 12) / 365 * segment.days, rounding)), 0);
  }
  const allowance = (value: number) => !value || !days ? 0 : days === totalDays ? value : Math.floor(value * 12 / 365 * days);
  const incentive = monthly.incentive ?? 0;
  const bonus = monthly.bonus ?? 0;
  const extra = columns.extra ? monthly.extra ?? 0 : 0;
  const research = columns.research ? monthly.research ?? 0 : 0;
  const severance = columns.severance ? monthly.severance ?? 0 : 0;
  const meal = allowance(employee.meal);
  const car = allowance(employee.car);
  const child = allowance(employee.child);
  return {
    employee, days, daysInMonth: totalDays, basic, meal, car, child, incentive, bonus, extra, research, severance,
    welfare: monthly.welfare ?? 0,
    total: basic + meal + car + child + incentive + bonus + extra + research + severance,
    mixedProbation: segments.length > 1,
    probationApplied: probationDays > 0,
    probationEnd: endOfProbation,
    probationWithoutJoin: employee.probationMonths > 0 && !join,
    probationOver: Boolean(endOfProbation && employee.probationMonths > 0 && days > 0 && probationDays === 0),
  };
}
