import { env } from "cloudflare:workers";
import { authorizeErpRequest } from "../../../erp-platform";
import { financeCurrentData } from "../../../finance-current-data";
import { financeCurrentInsights } from "../../../finance-current-insights";
import { buildAccountRiskModel, buildSalesForecast } from "../../../finance-decision-model";

type AiBindings = {
  DB: D1Database;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_AI_MODEL?: string;
};

type CloudflareEnvelope = {
  success?: boolean;
  errors?: Array<{ message?: string }>;
  result?: { response?: unknown; choices?: Array<{ message?: { content?: unknown } }> };
};

const currentBankAssets = financeCurrentData.accountSummary.checkingBalanceSum + financeCurrentData.accountSummary.fxBalanceSumKrw;
const bankActivity = financeCurrentInsights.bankActivity31Days;
const salesForecast = buildSalesForecast(financeCurrentData.salesDaily2026, financeCurrentInsights.taxInvoicesAsOf);
const accountRiskModel = buildAccountRiskModel(financeCurrentData.accountSummary, financeCurrentData.accounts, financeCurrentData.balanceTrend);
const forecastScenarios = salesForecast.scenarios.map((scenario) => `${scenario.label} ${scenario.projectedTotal.toLocaleString("ko-KR")}원(${scenario.basis})`).join(", ");
const riskDrivers = accountRiskModel.drivers.map((driver) => `${driver.label} +${driver.points}/${driver.maxPoints}점: ${driver.evidence}`).join(", ");
const financeContext = `
자료 범위: 2024년·2025년은 사용자가 승인한 이카운트 결산 자료이며, 2026년 은행·분개장 자료는 2026-08-14 기준 Clobe 최신 스냅샷이다. 전자세금계산서는 2026-08-13까지이며 서로 다른 기준기간을 반드시 구분한다.
2024년 결산: 자산총계 9,163,347,943원, 보통예금 4,440,692,099원, 외상매출금 2,938,482,814원, 외상매입금 4,833,825,237원, 장기차입금 100,000,000원, 상품매출 18,003,003,195원, 상품매출원가 15,443,129,733원, 당기순이익 2,506,308,507원. 합계잔액시산표 차변·대변 각 101,164,394,499원이며 재무상태표와 대사 완료.
2025년 결산: 자산총계 14,042,172,078원, 보통예금 7,362,455,598원, 외상매출금 2,282,636,500원, 외상매입금 5,549,840,004원, 장기차입금 83,333,336원, 상품매출 35,245,919,310원, 상품매출원가 34,418,332,396원, 매출총이익 827,586,914원, 당기순이익 796,938,875원. 합계잔액시산표 차변·대변 각 262,960,719,308원이며 원장·자금현황표와 대사 완료.
2025년 전년 대비: 매출 +95.8%, 매출원가 +122.9%, 당기순이익 -68.2%, 기말 보통예금 +65.8%, 외상매출금 -22.3%, 외상매입금 +14.8%.
2025년 월별 당기순이익: 1월 -550,217,298원, 2월 148,764,023원, 3월 82,006,344원, 4월 635,175,217원, 5월 463,287,699원, 6월 737,895,691원, 7월 111,679,235원, 8월 397,275,818원, 9월 -601,541,869원, 10월 328,567,589원, 11월 -296,408,804원, 12월 -659,544,770원.
2025년 채권 상위: 주식회사 양컴 331,848,000원, 주식회사 미루웨어 330,176,000원, 주식회사 에스엔티 230,021,000원, (주)피씨디렉트 226,050,000원. 채무 상위: 어드밴텍케이알(주) 4,480,792,229원, 대원씨티에스(주) 358,490,000원, Sourceability Korea LLC 318,838,100원.
2025년 데이터 품질: 분개장 15,510행, 금액 0원 14행, 정확히 같은 행 중복 후보 32행. 중복 후보는 실제 반복 거래일 수 있으므로 자동 삭제하면 안 된다.
2026년 1월 1일~8월 13일 전자세금계산서: 매출 공급가액 39,066,623,170원(1,919건), 매입 공급가액 39,290,111,236원(567건). 수정·취소 계산서는 순액 반영한다.
2026년 월별 매출 공급가액: 1월 3,848,982,010원, 2월 3,766,356,467원, 3월 2,729,704,299원, 4월 3,941,429,697원, 5월 5,313,718,335원, 6월 6,613,993,182원, 7월 7,843,458,347원, 8월 13일까지 5,008,980,833원.
2026년 연말 매출 전망은 ${financeCurrentInsights.taxInvoicesAsOf}까지 실제 전자세금계산서 공급가액과 남은 ${salesForecast.remainingDays}일의 관측 추세를 조합한다. 시나리오: ${forecastScenarios}. 계절성·수주잔고·반품·취소 가능성·영업계획을 반영하지 않은 단순 추세이며 회계상 매출 확정액과 다를 수 있음을 반드시 밝힌다.
계좌 운영 위험 신호는 모델 ${accountRiskModel.version}, ${accountRiskModel.score}/100점, ${accountRiskModel.level}이다. 배점 근거: ${riskDrivers}. ${accountRiskModel.policyStatus} 상태이며 지급예정표·확정 수금일을 포함하지 않은 내부 조기경보 휴리스틱이므로 신용평가나 지급불능 판정으로 설명하지 않는다.
은행성 자산 ${currentBankAssets.toLocaleString("ko-KR")}원, 원화 예금 ${financeCurrentData.accountSummary.checkingBalanceSum.toLocaleString("ko-KR")}원, 외화 예금 원화환산 ${financeCurrentData.accountSummary.fxBalanceSumKrw.toLocaleString("ko-KR")}원, 대출 잔액 ${financeCurrentData.accountSummary.loanBalanceSum.toLocaleString("ko-KR")}원.
최근 31일(${bankActivity.startDate}~${bankActivity.endDate}) 은행 입금 ${bankActivity.inflowKrw.toLocaleString("ko-KR")}원, 출금 ${bankActivity.outflowKrw.toLocaleString("ko-KR")}원, 순유입 ${bankActivity.netInflowKrw.toLocaleString("ko-KR")}원. ${bankActivity.scopeNote}.
최근 31일 주요 입금: 매출성 입금 ${bankActivity.inflowCategories.salesRelatedKrw.toLocaleString("ko-KR")}원, 계정 없는 입금 ${bankActivity.inflowCategories.unclassifiedKrw.toLocaleString("ko-KR")}원, 정부지원금 ${bankActivity.inflowCategories.governmentSupportKrw.toLocaleString("ko-KR")}원.
최근 31일 주요 출금: 계정 없는 출금 ${bankActivity.outflowCategories.unclassifiedKrw.toLocaleString("ko-KR")}원, 기타 영업비용 ${bankActivity.outflowCategories.otherOperatingKrw.toLocaleString("ko-KR")}원, 세금과공과 ${bankActivity.outflowCategories.taxesAndDuesKrw.toLocaleString("ko-KR")}원, 미연결 신용카드 대금 ${bankActivity.outflowCategories.unlinkedCardSettlementKrw.toLocaleString("ko-KR")}원.
분개장 ${financeCurrentData.journalSummary.lineCount.toLocaleString("ko-KR")}라인, 차변 ${financeCurrentData.journalSummary.debitAmountKrw.toLocaleString("ko-KR")}원, 대변 ${financeCurrentData.journalSummary.creditAmountKrw.toLocaleString("ko-KR")}원, 차대변 차이는 ${financeCurrentData.journalSummary.differenceKrw.toLocaleString("ko-KR")}원이다.
계정 10300 보통예금 순증감 ${financeCurrentData.journalSummary.checkingAccount.netChangeKrw >= 0 ? "+" : ""}${financeCurrentData.journalSummary.checkingAccount.netChangeKrw.toLocaleString("ko-KR")}원.
연동 채널 매출은 쿠팡 마켓플레이스 2026년 6월 21,510,000원, 정산액 19,940,696원, 수수료 1,514,304원이다.
중요: 은행 거래의 ‘매출성 입금’과 연동 판매채널의 ‘회계상 매출’은 서로 다른 지표이므로 합산하거나 동일시하지 않는다.
`;

function providerMessage(data: CloudflareEnvelope): string {
  return data.errors?.map((item) => item.message).filter(Boolean).join(" ") ?? "";
}

function quotaExceeded(response: Response, data: CloudflareEnvelope): boolean {
  return response.status === 429 || /quota|limit|neuron|exceeded/i.test(providerMessage(data));
}

export async function POST(request: Request) {
  const bindings = env as unknown as AiBindings;
  const auth = await authorizeErpRequest(bindings.DB, "finance", "read");
  if (auth.response) return auth.response;
  const accountId = bindings.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = bindings.CLOUDFLARE_API_TOKEN?.trim();
  const model = bindings.CLOUDFLARE_AI_MODEL?.trim() || "@cf/qwen/qwen3-30b-a3b-fp8";

  if (!accountId || !apiToken) {
    return Response.json({ error: "AI 환경설정이 완료되지 않았습니다." }, { status: 503 });
  }

  let question = "";
  try {
    const body = await request.json() as { question?: unknown };
    question = typeof body.question === "string" ? body.question.trim().slice(0, 300) : "";
  } catch {
    return Response.json({ error: "질문을 읽을 수 없습니다." }, { status: 400 });
  }

  if (question.length < 2) return Response.json({ error: "질문을 입력해 주세요." }, { status: 400 });

  const systemPrompt = [
    "당신은 한국 중소기업 경영자를 돕는 재무 데이터 어시스턴트입니다.",
    "아래 제공된 재무 스냅샷만 근거로 답하고, 없는 수치나 원인을 추측하지 마세요.",
    "2024·2025 결산 자료와 2026 미결산 스냅샷을 구분하고, 전년 비교 시 같은 기간이 아닐 수 있음을 명확히 표시하세요.",
    "숫자는 억원 또는 만원 단위로 읽기 쉽게 표현하고 필요한 경우 원 단위 수치를 괄호에 병기하세요.",
    "회계상 매출, 은행의 매출성 입금, 계좌 잔액을 명확히 구분하세요.",
    "답변은 한국어로 3~6문장 이내로 작성하고, 확인할 위험이나 다음 행동이 있으면 마지막 문장에 제안하세요.",
    "법률·세무 판단을 확정적으로 말하지 말고 담당자의 검토가 필요한 항목을 명시하세요.",
    financeContext,
  ].join("\n");

  let response: Response;
  try {
    response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "system", content: systemPrompt }, { role: "user", content: question }],
        temperature: 0.1,
        max_tokens: 500,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return Response.json({ error: "AI에 연결할 수 없습니다." }, { status: 502 });
  }

  let data: CloudflareEnvelope;
  try {
    data = await response.json() as CloudflareEnvelope;
  } catch {
    return Response.json({ error: "AI 응답을 읽을 수 없습니다." }, { status: 502 });
  }

  if (quotaExceeded(response, data)) {
    return Response.json({ error: "오늘의 AI 무료 사용 한도를 초과했습니다.", quotaExceeded: true }, { status: 429 });
  }
  if (!response.ok || data.success === false) {
    return Response.json({ error: "AI 분석 요청에 실패했습니다." }, { status: 502 });
  }

  const content = data.result?.response ?? data.result?.choices?.[0]?.message?.content;
  const answer = typeof content === "string" ? content.trim().slice(0, 2000) : "";
  if (!answer) return Response.json({ error: "AI가 답변을 반환하지 않았습니다." }, { status: 502 });
  return Response.json({ answer });
}
