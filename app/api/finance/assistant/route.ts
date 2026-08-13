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
기준일: 2026-08-13. 2025년 이전 데이터는 분석에서 제외한다.
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
