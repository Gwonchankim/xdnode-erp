export type FinancePeriod = "day" | "week" | "month" | "quarter";

export type FinanceSeriesPoint = {
  label: string;
  value: number;
  startDate: string;
  endDate: string;
};

export type FinanceSeriesResult = {
  points: FinanceSeriesPoint[];
  sourceStartDate: string;
  sourceEndDate: string;
  coverageNote: string;
  summaryLabel: string;
};

type BalanceRow = { date: string; balance: number };
type AmountRow = { date: string; amount: number };

const dayMs = 86_400_000;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function dateValue(value: string) {
  return Date.parse(`${value}T00:00:00Z`);
}

function dateString(value: number) {
  return new Date(value).toISOString().slice(0, 10);
}

function addDays(value: string, amount: number) {
  return dateString(dateValue(value) + amount * dayMs);
}

function shortDate(value: string) {
  const [, month, day] = value.split("-");
  return `${Number(month)}/${Number(day)}`;
}

function weekStart(value: string) {
  const date = new Date(`${value}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

function monthEnd(value: string) {
  const date = new Date(`${value.slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + 1);
  date.setUTCDate(0);
  return date.toISOString().slice(0, 10);
}

function quarterKey(value: string) {
  return `${value.slice(0, 4)}-Q${Math.floor((Number(value.slice(5, 7)) - 1) / 3) + 1}`;
}

function validDate(value: string) {
  if (!datePattern.test(value)) return false;
  const parsed = dateValue(value);
  return Number.isFinite(parsed) && dateString(parsed) === value;
}

function emptySeries(message: string): FinanceSeriesResult {
  return { points: [], sourceStartDate: "", sourceEndDate: "", coverageNote: message, summaryLabel: "표시할 값 없음" };
}

export function buildBalanceSeries(rows: readonly BalanceRow[], period: FinancePeriod): FinanceSeriesResult {
  const unique = new Map<string, number>();
  for (const row of rows) {
    if (validDate(row.date) && Number.isFinite(row.balance)) unique.set(row.date, row.balance);
  }
  const normalized = [...unique].map(([date, balance]) => ({ date, balance })).sort((a, b) => a.date.localeCompare(b.date));
  if (!normalized.length) return emptySeries("잔액 관측값이 없어 차트를 표시하지 않습니다.");

  let selected: BalanceRow[];
  let rule: string;
  if (period === "day") {
    selected = normalized.slice(-14);
    rule = "최근 14개 관측일";
  } else {
    const grouped = new Map<string, BalanceRow>();
    for (const row of normalized) {
      const key = period === "week" ? weekStart(row.date) : period === "month" ? row.date.slice(0, 7) : quarterKey(row.date);
      grouped.set(key, row);
    }
    selected = [...grouped.values()];
    if (period === "week") {
      selected = selected.slice(-10);
      rule = "최근 10주 · 주간 마지막 관측값";
    } else if (period === "month") {
      selected = selected.slice(-12);
      rule = "월간 마지막 관측값";
    } else {
      selected = selected.slice(-8);
      rule = "분기 마지막 관측값";
    }
  }

  const points = selected.map((row) => {
    const key = period === "week" ? weekStart(row.date) : period === "month" ? row.date.slice(0, 7) : quarterKey(row.date);
    const label = period === "day" ? shortDate(row.date)
      : period === "week" ? `${shortDate(key)}주`
      : period === "month" ? `${Number(key.slice(5, 7))}월`
      : `${key.slice(-1)}분기`;
    return { label, value: row.balance, startDate: period === "week" ? key : row.date, endDate: row.date };
  });
  const sourceStartDate = normalized[0].date;
  const sourceEndDate = normalized.at(-1)?.date ?? sourceStartDate;
  return {
    points,
    sourceStartDate,
    sourceEndDate,
    coverageNote: `잔액형 · ${sourceStartDate}~${sourceEndDate} 관측 · ${rule} · 미관측 구간은 임의 보간하지 않음`,
    summaryLabel: period === "day" ? "최근 관측일 잔액" : "마지막 구간 말 잔액",
  };
}

function rangeTotal(daily: Map<string, number>, startDate: string, endDate: string) {
  let total = 0;
  for (const [date, amount] of daily) if (date >= startDate && date <= endDate) total += amount;
  return total;
}

export function buildAmountSeries(rows: readonly AmountRow[], period: FinancePeriod, sourceEndDate: string): FinanceSeriesResult {
  if (!validDate(sourceEndDate)) return emptySeries("유효한 매출 기준일이 없어 차트를 표시하지 않습니다.");
  const daily = new Map<string, number>();
  for (const row of rows) {
    if (!validDate(row.date) || row.date > sourceEndDate || !Number.isFinite(row.amount)) continue;
    daily.set(row.date, (daily.get(row.date) ?? 0) + row.amount);
  }
  const sourceStartDate = [...daily.keys()].sort()[0] ?? sourceEndDate;
  const points: FinanceSeriesPoint[] = [];

  if (period === "day") {
    const start = addDays(sourceEndDate, -13);
    for (let cursor = start; cursor <= sourceEndDate; cursor = addDays(cursor, 1)) {
      points.push({ label: shortDate(cursor), value: daily.get(cursor) ?? 0, startDate: cursor, endDate: cursor });
    }
  } else if (period === "week") {
    const finalWeek = weekStart(sourceEndDate);
    for (let index = 9; index >= 0; index -= 1) {
      const start = addDays(finalWeek, index * -7);
      const end = addDays(start, 6) < sourceEndDate ? addDays(start, 6) : sourceEndDate;
      points.push({ label: `${shortDate(start)}주`, value: rangeTotal(daily, start, end), startDate: start, endDate: end });
    }
  } else if (period === "month") {
    const endMonth = Number(sourceEndDate.slice(5, 7));
    const year = sourceEndDate.slice(0, 4);
    for (let month = 1; month <= endMonth; month += 1) {
      const key = `${year}-${String(month).padStart(2, "0")}`;
      const start = `${key}-01`;
      const end = monthEnd(start) < sourceEndDate ? monthEnd(start) : sourceEndDate;
      points.push({ label: `${month}월`, value: rangeTotal(daily, start, end), startDate: start, endDate: end });
    }
  } else {
    const endQuarter = Math.floor((Number(sourceEndDate.slice(5, 7)) - 1) / 3) + 1;
    const year = sourceEndDate.slice(0, 4);
    for (let quarter = 1; quarter <= endQuarter; quarter += 1) {
      const firstMonth = (quarter - 1) * 3 + 1;
      const lastMonth = firstMonth + 2;
      const start = `${year}-${String(firstMonth).padStart(2, "0")}-01`;
      const quarterEnd = monthEnd(`${year}-${String(lastMonth).padStart(2, "0")}-01`);
      const end = quarterEnd < sourceEndDate ? quarterEnd : sourceEndDate;
      points.push({ label: `${quarter}분기`, value: rangeTotal(daily, start, end), startDate: start, endDate: end });
    }
  }

  const rule = period === "day" ? "최근 14일 일별 합계"
    : period === "week" ? "최근 10주 주별 합계"
    : period === "month" ? "연초부터 월별 합계"
    : "연초부터 분기별 합계";
  return {
    points,
    sourceStartDate,
    sourceEndDate,
    coverageNote: `유량형 · ${sourceStartDate}~${sourceEndDate} 전자세금계산서 공급가액 · ${rule} · 무발행 구간은 0원`,
    summaryLabel: period === "day" ? "마지막 일자 공급가액" : "마지막 구간 공급가액",
  };
}
