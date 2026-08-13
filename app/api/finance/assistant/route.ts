import { env } from "cloudflare:workers";

type AiBindings = {
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_AI_MODEL?: string;
};

type CloudflareEnvelope = {
  success?: boolean;
  errors?: Array<{ message?: string }>;
  result?: { response?: unknown; choices?: Array<{ message?: { content?: unknown } }> };
};

const financeContext = `
자료 범위: 2024년·2025년은 사용자가 승인한 이카운트 결산 자료이며, 2026년은 2026-08-13 기준 Clobe 최신 스냅샷이다. 서로 다른 기준기간을 반드시 구분한다.
2024년 결산: 자산총계 9,163,347,943원, 보통예금 4,440,692,099원, 외상매출금 2,938,482,814원, 외상매입금 4,833,825,237원, 장기차입금 100,000,000원, 상품매출 18,003,003,195원, 상품매출원가 15,443,129,733원, 당기순이익 2,506,308,507원. 합계잔액시산표 차변·대변 각 101,164,394,499원이며 재무상태표와 대사 완료.
2025년 결산: 자산총계 14,042,172,078원, 보통예금 7,362,455,598원, 외상매출금 2,282,636,500원, 외상매입금 5,549,840,004원, 장기차입금 83,333,336원, 상품매출 35,245,919,310원, 상품매출원가 34,418,332,396원, 매출총이익 827,586,914원, 당기순이익 796,938,875원. 합계잔액시산표 차변·대변 각 262,960,719,308원이며 원장·자금현황표와 대사 완료.
2025년 전년 대비: 매출 +95.8%, 매출원가 +122.9%, 당기순이익 -68.2%, 기말 보통예금 +65.8%, 외상매출금 -22.3%, 외상매입금 +14.8%.
2025년 월별 당기순이익: 1월 -550,217,298원, 2월 148,764,023원, 3월 82,006,344원, 4월 635,175,217원, 5월 463,287,699원, 6월 737,895,691원, 7월 111,679,235원, 8월 397,275,818원, 9월 -601,541,869원, 10월 328,567,589원, 11월 -296,408,804원, 12월 -659,544,770원.
2025년 채권 상위: 주식회사 양컴 331,848,000원, 주식회사 미루웨어 330,176,000원, 주식회사 에스엔티 230,021,000원, (주)피씨디렉트 226,050,000원. 채무 상위: 어드밴텍케이알(주) 4,480,792,229원, 대원씨티에스(주) 358,490,000원, Sourceability Korea LLC 318,838,100원.
2025년 데이터 품질: 분개장 15,510행, 금액 0원 14행, 정확히 같은 행 중복 후보 32행. 중복 후보는 실제 반복 거래일 수 있으므로 자동 삭제하면 안 된다.
2026년 1월 1일~8월 13일 전자세금계산서: 매출 공급가액 39,066,623,170원(1,919건), 매입 공급가액 39,290,111,236원(567건). 수정·취소 계산서는 순액 반영한다.
2026년 월별 매출 공급가액: 1월 3,848,982,010원, 2월 3,766,356,467원, 3월 2,729,704,299원, 4월 3,941,429,697원, 5월 5,313,718,335원, 6월 6,613,993,182원, 7월 7,843,458,347원, 8월 13일까지 5,008,980,833원.
2026년 연말 예상 매출은 8월 13일까지 225일의 일평균 공급가액을 365일로 연환산한 약 63,374,744,254원이다. 계절성·수주잔고·반품 가능성을 반영하지 않은 단순 예측임을 반드시 밝힌다.
계좌 운영 위험 신호: 은행성 자산/대출잔액 97.3%, 외화자산 집중도 91.6%, 원화 입출금계좌 잔액 143,825,068원, 최근 10주 고점 대비 잔액 감소 약 23.0%. 이는 내부 조기경보 휴리스틱이며 신용평가나 지급불능 판정이 아니다.
은행성 자산 1,721,282,194원, 원화 예금 143,825,068원, 외화 예금 원화환산 1,577,457,126원, 대출 잔액 1,768,750,005원.
최근 31일(2026-07-14~08-13) 은행 입금 14,967,327,589.5원, 출금 13,385,703,061.2원, 순유입 1,581,624,528.3원.
최근 31일 주요 입금: 매출성 입금 7,835,865,016원, 계정 없는 입금 7,127,811,273.5원, 정부지원금 3,600,000원.
최근 31일 주요 출금: 계정 없는 출금 6,845,402,364.2원, 기타 영업비용 6,167,766,052원, 세금과공과 308,196,930원, 미연결 신용카드 대금 17,034,423원.
분개장 17,373라인, 차변 261,005,636,618원, 대변 261,005,638,836원, 차이 2,218원.
계정 10300 보통예금 순증감 +1,179,662,958원.
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
