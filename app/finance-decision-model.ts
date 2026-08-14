type SalesObservation = Readonly<{
  date: string;
  amount: number;
}>;

type BalanceObservation = Readonly<{
  date: string;
  balance: number;
}>;

type FinanceAccount = Readonly<{
  type: string;
  krwBalance: number;
}>;

type AccountSummary = Readonly<{
  checkingBalanceSum: number;
  fxBalanceSumKrw: number;
  loanBalanceSum: number;
}>;

const DAY_MS = 86_400_000;

function utcDate(value: string): Date {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`잘못된 기준일: ${value}`);
  return date;
}

function inclusiveDays(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
}

function amountInWindow(rows: readonly SalesObservation[], start: Date, end: Date): number {
  return rows.reduce((sum, row) => {
    const date = utcDate(row.date);
    return date >= start && date <= end ? sum + row.amount : sum;
  }, 0);
}

export type SalesForecastScenario = Readonly<{
  key: "conservative" | "base" | "optimistic";
  label: "보수" | "기준" | "낙관";
  projectedTotal: number;
  remainingDailyRate: number;
  basis: string;
}>;

export function buildSalesForecast(
  rows: readonly SalesObservation[],
  asOf: string,
): Readonly<{
  asOf: string;
  actualYtd: number;
  elapsedDays: number;
  remainingDays: number;
  daysInYear: number;
  ytdDailyRate: number;
  trailing30DailyRate: number;
  trailing90DailyRate: number;
  scenarios: readonly SalesForecastScenario[];
  limitations: readonly string[];
}> {
  const cutoff = utcDate(asOf);
  const year = cutoff.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const yearEnd = new Date(Date.UTC(year, 11, 31));
  const elapsedDays = inclusiveDays(yearStart, cutoff);
  const daysInYear = inclusiveDays(yearStart, yearEnd);
  const remainingDays = daysInYear - elapsedDays;
  const actualYtd = amountInWindow(rows, yearStart, cutoff);
  const trailing30Start = new Date(cutoff.getTime() - 29 * DAY_MS);
  const trailing90Start = new Date(cutoff.getTime() - 89 * DAY_MS);
  const rates = {
    ytd: actualYtd / elapsedDays,
    trailing30: amountInWindow(rows, trailing30Start, cutoff) / 30,
    trailing90: amountInWindow(rows, trailing90Start, cutoff) / 90,
  };
  const observedRates = [rates.ytd, rates.trailing30, rates.trailing90];
  const conservativeRate = Math.min(...observedRates);
  const optimisticRate = Math.max(...observedRates);
  const project = (rate: number) => Math.round(actualYtd + remainingDays * rate);

  return {
    asOf,
    actualYtd,
    elapsedDays,
    remainingDays,
    daysInYear,
    ytdDailyRate: rates.ytd,
    trailing30DailyRate: rates.trailing30,
    trailing90DailyRate: rates.trailing90,
    scenarios: [
      { key: "conservative", label: "보수", projectedTotal: project(conservativeRate), remainingDailyRate: conservativeRate, basis: "30일·90일·연초 이후 평균 중 가장 낮은 추세" },
      { key: "base", label: "기준", projectedTotal: project(rates.ytd), remainingDailyRate: rates.ytd, basis: "연초 이후 일평균 추세" },
      { key: "optimistic", label: "낙관", projectedTotal: project(optimisticRate), remainingDailyRate: optimisticRate, basis: "30일·90일·연초 이후 평균 중 가장 높은 추세" },
    ],
    limitations: [
      "전자세금계산서 공급가액 기준이며 회계상 매출 확정액과 다를 수 있습니다.",
      "계절성·수주잔고·반품·취소 가능성·영업계획은 반영하지 않은 단순 추세 시나리오입니다.",
    ],
  };
}

export type RiskDriver = Readonly<{
  key: string;
  label: string;
  status: "stable" | "watch" | "high";
  points: number;
  maxPoints: number;
  evidence: string;
  rule: string;
}>;

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function buildAccountRiskModel(
  summary: AccountSummary,
  accounts: readonly FinanceAccount[],
  balanceTrend: readonly BalanceObservation[],
): Readonly<{
  version: "2026.08-v1";
  score: number;
  level: "안정" | "주의" | "높음";
  bankAssets: number;
  metrics: Readonly<{
    debtCoverage: number | null;
    fxConcentration: number;
    drawdownFromPeak: number;
    currentToMedian: number | null;
    lowBalanceAccounts: number;
  }>;
  drivers: readonly RiskDriver[];
  policyStatus: string;
  limitations: readonly string[];
}> {
  const bankAssets = summary.checkingBalanceSum + summary.fxBalanceSumKrw;
  const debtCoverage = summary.loanBalanceSum > 0 ? bankAssets / summary.loanBalanceSum : null;
  const fxConcentration = bankAssets > 0 ? summary.fxBalanceSumKrw / bankAssets : 0;
  const balances = balanceTrend.map((row) => row.balance).filter(Number.isFinite);
  const currentBalance = balances[0] ?? bankAssets;
  const peakBalance = balances.length ? Math.max(...balances) : currentBalance;
  const medianBalance = median(balances);
  const drawdownFromPeak = peakBalance > 0 ? Math.max(0, (peakBalance - currentBalance) / peakBalance) : 0;
  const currentToMedian = medianBalance > 0 ? currentBalance / medianBalance : null;
  const lowBalanceAccounts = accounts.filter((row) => row.type === "CHECKING" && row.krwBalance < 100_000).length;

  const debtPoints = debtCoverage === null ? 0 : debtCoverage < 1 ? 30 : debtCoverage < 1.25 ? 15 : 0;
  const fxPoints = fxConcentration >= .8 ? 20 : fxConcentration >= .5 ? 10 : 0;
  const drawdownPoints = drawdownFromPeak >= .35 ? 20 : drawdownFromPeak >= .2 ? 10 : 0;
  const medianPoints = currentToMedian === null ? 0 : currentToMedian < .6 ? 20 : currentToMedian < .8 ? 10 : 0;
  const lowBalancePoints = lowBalanceAccounts >= 3 ? 10 : lowBalanceAccounts >= 1 ? 5 : 0;
  const score = Math.min(100, debtPoints + fxPoints + drawdownPoints + medianPoints + lowBalancePoints);
  const status = (points: number, highAt: number): RiskDriver["status"] => points >= highAt ? "high" : points > 0 ? "watch" : "stable";
  const drivers: RiskDriver[] = [
    {
      key: "debt-coverage", label: "대출 커버리지", status: status(debtPoints, 30), points: debtPoints, maxPoints: 30,
      evidence: debtCoverage === null ? "대출잔액 없음" : `은행성 자산 ÷ 대출잔액 ${percent(debtCoverage)}`,
      rule: "100% 미만 +30점 · 100~125% 미만 +15점",
    },
    {
      key: "fx-concentration", label: "외화자산 집중", status: status(fxPoints, 20), points: fxPoints, maxPoints: 20,
      evidence: `은행성 자산 중 외화 ${percent(fxConcentration)}`,
      rule: "80% 이상 +20점 · 50~80% 미만 +10점",
    },
    {
      key: "peak-drawdown", label: "고점 대비 감소", status: status(drawdownPoints, 20), points: drawdownPoints, maxPoints: 20,
      evidence: `관측기간 고점 대비 ${percent(drawdownFromPeak)} 감소`,
      rule: "35% 이상 +20점 · 20~35% 미만 +10점",
    },
    {
      key: "median-balance", label: "평시 잔액 대비", status: status(medianPoints, 20), points: medianPoints, maxPoints: 20,
      evidence: currentToMedian === null ? "비교 가능한 잔액 이력 없음" : `현재 잔액이 관측기간 중앙값의 ${percent(currentToMedian)}`,
      rule: "60% 미만 +20점 · 60~80% 미만 +10점",
    },
    {
      key: "low-balance-accounts", label: "소액 운영계좌", status: status(lowBalancePoints, 10), points: lowBalancePoints, maxPoints: 10,
      evidence: `10만원 미만 원화 입출금계좌 ${lowBalanceAccounts}개`,
      rule: "3개 이상 +10점 · 1~2개 +5점",
    },
  ];

  return {
    version: "2026.08-v1",
    score,
    level: score >= 60 ? "높음" : score >= 30 ? "주의" : "안정",
    bankAssets,
    metrics: { debtCoverage, fxConcentration, drawdownFromPeak, currentToMedian, lowBalanceAccounts },
    drivers,
    policyStatus: "회사 최소 운영자금·외화 한도 정책 미등록",
    limitations: [
      "지급예정표와 확정 수금일을 포함하지 않은 내부 조기경보 휴리스틱입니다.",
      "신용평가·지급불능 판정이 아니며 회사 정책 등록 후 임계값을 재검토해야 합니다.",
      `관측 잔액 ${balances.length.toLocaleString("ko-KR")}개를 기준으로 비교했습니다.`,
    ],
  };
}
