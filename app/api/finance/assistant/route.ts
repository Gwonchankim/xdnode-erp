import { env } from "cloudflare:workers";
import { authorizeErpRequest } from "../../../erp-platform";
import { financeCurrentData } from "../../../finance-current-data";
import { financeCurrentInsights } from "../../../finance-current-insights";
import { financeHistoricalData } from "../../../finance-historical-data";
import { buildAccountRiskModel, buildSalesForecast } from "../../../finance-decision-model";
import { loadFinanceRiskPolicy } from "../../../finance-risk-policy-server";
import { buildFinanceLedgerSnapshot, buildFinancePeriodStatementSnapshot } from "../../../finance-ledger-snapshot";
import { evaluateLedgerSnapshotDrift, type LedgerIntegritySnapshot } from "../../../finance-ledger-integrity";
import { buildFinanceAssistantFallback, buildFinanceAssistantPrompt, type FinanceAssistantEvidence } from "../../../finance-assistant-evidence";
import { listFinanceAssistantAnswers, saveFinanceAssistantAnswer,
  type FinanceAssistantAnswerPayload } from "../../../finance-assistant-history";

type AiBindings = { DB: D1Database; CLOUDFLARE_ACCOUNT_ID?: string; CLOUDFLARE_API_TOKEN?: string; CLOUDFLARE_AI_MODEL?: string };
type CloudflareEnvelope = { success?: boolean; errors?: Array<{ message?: string }>;
  result?: { response?: unknown; choices?: Array<{ message?: { content?: unknown } }> } };
type CloseRow = { period: string; status: string; snapshot_json: string };
type FrozenClose = { ledgerSnapshot?: LedgerIntegritySnapshot };

function safeCloseSnapshot(value: string) { try { return JSON.parse(value) as FrozenClose; } catch { return {} as FrozenClose; } }
function providerMessage(data: CloudflareEnvelope) { return data.errors?.map((item) => item.message).filter(Boolean).join(" ") ?? ""; }
function quotaExceeded(response: Response, data: CloudflareEnvelope) {
  return response.status === 429 || /quota|limit|neuron|exceeded/i.test(providerMessage(data));
}

async function buildEvidence(db: D1Database): Promise<FinanceAssistantEvidence> {
  const from = "2026-01-01"; const to = financeCurrentData.asOf;
  const [statement, ledger, close, riskPolicy] = await Promise.all([
    buildFinancePeriodStatementSnapshot(db, from, to), buildFinanceLedgerSnapshot(db, to),
    db.prepare(`SELECT period,status,snapshot_json FROM finance_close_runs
      WHERE status IN ('SUBMITTED','CLOSED') ORDER BY period DESC LIMIT 1`).first<CloseRow>().catch(() => null),
    loadFinanceRiskPolicy(db),
  ]);
  let closeIntegrity = { period: close?.period ?? "", status: close?.status ?? "미제출", checked: false, drifted: false,
    detail: close ? "마감 동결 원장 정보를 확인하고 있습니다." : "제출 또는 완료된 월마감 원장이 없습니다." };
  let closeCheckFailed = false;
  const frozen = close ? safeCloseSnapshot(close.snapshot_json).ledgerSnapshot : undefined;
  if (close && frozen?.ledgerHash && frozen.asOf) {
    try {
      const current = frozen.asOf === ledger.asOf ? ledger : await buildFinanceLedgerSnapshot(db, frozen.asOf);
      const drift = evaluateLedgerSnapshotDrift(frozen, current);
      closeIntegrity = { period: close.period, status: close.status, checked: true, drifted: drift.drifted,
        detail: drift.drifted
          ? `동결 ${drift.frozenLineCount.toLocaleString("ko-KR")}행과 현재 ${drift.currentLineCount.toLocaleString("ko-KR")}행의 원장 계보가 다릅니다.`
          : `동결 원장 ${drift.frozenLineCount.toLocaleString("ko-KR")}행과 현재 원장 계보가 일치합니다.` };
    } catch {
      closeCheckFailed = true;
      closeIntegrity = { period: close.period, status: close.status, checked: false, drifted: false,
        detail: "동결 원장과 현재 원장의 무결성 비교를 완료하지 못했습니다." };
    }
  } else if (close) { closeCheckFailed = true; closeIntegrity.detail = "마감 원장에 비교 가능한 동결 해시가 없습니다."; }

  const reasons: string[] = [];
  if (statement.status !== "OFFICIAL") reasons.push("2026 운영 손익이 검토용(DRAFT)입니다");
  if (!statement.quality.openingOfficial) reasons.push("승인된 2026 개시잔액이 확인되지 않았습니다");
  if (!statement.quality.periodBalanced) reasons.push(`POSTED 전표 차대변 차이 ${statement.difference.toLocaleString("ko-KR")}원이 있습니다`);
  if (statement.quality.unclassifiedCount > 0) reasons.push(`미분류 전기 계정 ${statement.quality.unclassifiedCount}개가 있습니다`);
  if (!ledger.official) reasons.push("누적 총계정원장이 공식 상태가 아닙니다");
  if (Number(financeCurrentData.journalSummary.differenceKrw) !== 0) reasons.push(`Clobe 분개장 차대변 차이 ${financeCurrentData.journalSummary.differenceKrw.toLocaleString("ko-KR")}원이 있습니다`);
  if (closeIntegrity.drifted) reasons.push("마감 제출 후 원장 계보 변경이 감지되었습니다");
  if (closeCheckFailed) reasons.push("마감 원장 무결성 확인을 완료하지 못했습니다");
  const review = reasons.length > 0;
  const bankAssets = financeCurrentData.accountSummary.checkingBalanceSum + financeCurrentData.accountSummary.fxBalanceSumKrw;
  const bankActivity = financeCurrentInsights.bankActivity31Days;
  const salesForecast = buildSalesForecast(financeCurrentData.salesDaily2026, financeCurrentInsights.taxInvoicesAsOf);
  const accountRisk = buildAccountRiskModel(financeCurrentData.accountSummary, financeCurrentData.accounts,
    financeCurrentData.balanceTrend, riskPolicy);
  const sourceStatus = review ? "REVIEW" as const : "CONFIRMED" as const;
  const limitations = [...reasons,
    "전자세금계산서 공급가액과 은행 입금은 회계상 매출과 동일한 지표가 아닙니다.",
    "2026년은 운영 중인 부분기간이며 2024·2025 연간 결산과 직접 단순 비교하지 않습니다."];
  return {
    generatedAt: new Date().toISOString(),
    quality: { status: review ? "REVIEW_REQUIRED" : "VERIFIED", label: review ? "검토 필요" : "근거 확인", reasons },
    operational2026: { from, to, status: statement.status, lineCount: statement.lineCount,
      revenue: statement.incomeStatement.revenue, expenses: statement.incomeStatement.expenses,
      netIncome: statement.incomeStatement.netIncome, difference: statement.difference },
    historical: {
      "2024": { revenue: financeHistoricalData.years["2024"].revenue, netIncome: financeHistoricalData.years["2024"].netIncome,
        cash: financeHistoricalData.years["2024"].cash, assets: financeHistoricalData.years["2024"].assets },
      "2025": { revenue: financeHistoricalData.years["2025"].revenue, netIncome: financeHistoricalData.years["2025"].netIncome,
        cash: financeHistoricalData.years["2025"].cash, assets: financeHistoricalData.years["2025"].assets },
    },
    treasury2026: { asOf: to, bankAssets, checking: financeCurrentData.accountSummary.checkingBalanceSum,
      fxKrw: financeCurrentData.accountSummary.fxBalanceSumKrw, loans: financeCurrentData.accountSummary.loanBalanceSum,
      recentFrom: bankActivity.startDate, recentTo: bankActivity.endDate, inflow: bankActivity.inflowKrw,
      outflow: bankActivity.outflowKrw, netInflow: bankActivity.netInflowKrw },
    taxInvoices2026: { asOf: financeCurrentInsights.taxInvoicesAsOf, salesSupplyValue: financeCurrentData.sourceSummary.salesSupplyValue,
      purchaseSupplyValue: financeCurrentData.sourceSummary.purchaseSupplyValue, accountingRevenue: false },
    forecast2026: { asOf: financeCurrentInsights.taxInvoicesAsOf, remainingDays: salesForecast.remainingDays,
      scenarios: salesForecast.scenarios.map((item) => ({ key: item.key, label: item.label,
        projectedTotal: item.projectedTotal, basis: item.basis })) },
    accountRisk: { version: accountRisk.version, score: accountRisk.score, level: accountRisk.level,
      policyStatus: accountRisk.policyStatus, drivers: accountRisk.drivers.map((item) => ({ label: item.label,
        points: item.points, maxPoints: item.maxPoints, evidence: item.evidence })) },
    closeIntegrity,
    sources: [
      { id: "ecount-2024", label: "2024 승인 결산", period: "2024.01.01~12.31", basis: "재무상태표·합계잔액시산표", status: "CONFIRMED", destination: "statements" },
      { id: "ecount-2025", label: "2025 승인 결산", period: "2025.01.01~12.31", basis: "계정별원장·분개장·자금현황표", status: "CONFIRMED", destination: "statements" },
      { id: "posted-ledger-2026", label: "2026 POSTED 총계정원장", period: `${from}~${to}`, basis: `${statement.lineCount.toLocaleString("ko-KR")}행·차대변 차이 ${statement.difference.toLocaleString("ko-KR")}원`, status: sourceStatus, destination: "ledger" },
      { id: "clobe-2026", label: "2026 Clobe 스냅샷", period: `기준일 ${to}`, basis: "은행·외화예금·대출·세금계산서", status: Number(financeCurrentData.journalSummary.differenceKrw) === 0 ? "CONFIRMED" : "REVIEW", destination: "quality" },
      { id: "close-integrity", label: "월마감 원장 무결성", period: close?.period ?? "제출 이력 없음", basis: closeIntegrity.detail,
        status: closeIntegrity.checked && !closeIntegrity.drifted && !closeCheckFailed ? "CONFIRMED" : "REVIEW", destination: "close" },
    ], limitations,
  };
}

function fallbackPayload(question: string, evidence: FinanceAssistantEvidence, limitation: string, quota = false): FinanceAssistantAnswerPayload {
  return { answer: buildFinanceAssistantFallback(question, evidence), provider: "RULE_BASED_FALLBACK", evidenceStatus: evidence.quality.status,
    evidenceLabel: evidence.quality.label, basisAsOf: evidence.operational2026.to, sources: evidence.sources,
    limitations: [limitation, ...evidence.limitations], quotaExceeded: quota };
}

async function responseWithHistory(db: D1Database, principal: Parameters<typeof saveFinanceAssistantAnswer>[1],
  question: string, evidence: FinanceAssistantEvidence, payload: FinanceAssistantAnswerPayload) {
  try {
    const historyEntry = await saveFinanceAssistantAnswer(db, principal, question, evidence, payload);
    return Response.json({ ...payload, historyEntry });
  } catch {
    return Response.json({ error: "답변 감사기록을 저장하지 못했습니다. 기록 저장 상태를 확인한 뒤 다시 질문해 주세요." }, { status: 503 });
  }
}

export async function GET() {
  const bindings = env as unknown as AiBindings;
  const auth = await authorizeErpRequest(bindings.DB, "finance", "read");
  if (auth.response) return auth.response;
  return Response.json({ history: await listFinanceAssistantAnswers(bindings.DB, 20) });
}

export async function POST(request: Request) {
  const bindings = env as unknown as AiBindings;
  const auth = await authorizeErpRequest(bindings.DB, "finance", "read");
  if (auth.response) return auth.response;
  let question = "";
  try { const body = await request.json() as { question?: unknown };
    question = typeof body.question === "string" ? body.question.trim().slice(0, 300) : "";
  } catch { return Response.json({ error: "질문을 읽을 수 없습니다." }, { status: 400 }); }
  if (question.length < 2) return Response.json({ error: "질문을 입력해 주세요." }, { status: 400 });

  const evidence = await buildEvidence(bindings.DB);
  const accountId = bindings.CLOUDFLARE_ACCOUNT_ID?.trim(); const apiToken = bindings.CLOUDFLARE_API_TOKEN?.trim();
  const model = bindings.CLOUDFLARE_AI_MODEL?.trim() || "@cf/qwen/qwen3-30b-a3b-fp8";
  if (!accountId || !apiToken) return responseWithHistory(bindings.DB, auth.principal, question, evidence,
    fallbackPayload(question, evidence, "AI 설정이 없어 승인된 원장 근거로 규칙 기반 답변을 제공했습니다."));

  let response: Response;
  try {
    response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`, {
      method: "POST", headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "system", content: buildFinanceAssistantPrompt(evidence) }, { role: "user", content: question }],
        temperature: 0.05, max_tokens: 500 }), signal: AbortSignal.timeout(30_000),
    });
  } catch { return responseWithHistory(bindings.DB, auth.principal, question, evidence,
    fallbackPayload(question, evidence, "AI 연결에 실패해 승인된 원장 근거로 규칙 기반 답변을 제공했습니다.")); }
  let data: CloudflareEnvelope;
  try { data = await response.json() as CloudflareEnvelope; }
  catch { return responseWithHistory(bindings.DB, auth.principal, question, evidence,
    fallbackPayload(question, evidence, "AI 응답을 읽지 못해 승인된 원장 근거로 규칙 기반 답변을 제공했습니다.")); }
  if (quotaExceeded(response, data)) return responseWithHistory(bindings.DB, auth.principal, question, evidence,
    fallbackPayload(question, evidence, "AI 무료 사용 한도가 부족해 기본 원장 분석으로 답변했습니다.", true));
  if (!response.ok || data.success === false) return responseWithHistory(bindings.DB, auth.principal, question, evidence,
    fallbackPayload(question, evidence, "AI 분석 요청이 실패해 승인된 원장 근거로 규칙 기반 답변을 제공했습니다."));
  const content = data.result?.response ?? data.result?.choices?.[0]?.message?.content;
  const answer = typeof content === "string" ? content.trim().slice(0, 2000) : "";
  if (!answer) return responseWithHistory(bindings.DB, auth.principal, question, evidence,
    fallbackPayload(question, evidence, "AI가 빈 답변을 반환해 승인된 원장 근거로 규칙 기반 답변을 제공했습니다."));
  const payload: FinanceAssistantAnswerPayload = { answer, provider: "AI", evidenceStatus: evidence.quality.status,
    evidenceLabel: evidence.quality.label, basisAsOf: evidence.operational2026.to, sources: evidence.sources,
    limitations: evidence.limitations, quotaExceeded: false };
  return responseWithHistory(bindings.DB, auth.principal, question, evidence, payload);
}
