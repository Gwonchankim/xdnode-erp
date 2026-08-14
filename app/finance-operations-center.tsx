"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { financeCurrentData } from "./finance-current-data";

type ForecastItem = {
  id: string; expectedDate: string; direction: "INFLOW" | "OUTFLOW"; category: string;
  counterparty: string; amount: number; probability: number; scenario: string; status: string; memo: string;
};
type CloseTask = { id: string; period: string; category: string; title: string; ownerEmployeeId: string; status: string };
type BudgetItem = { id: string; fiscalYear: number; month: number; department: string; accountCode: string; accountName: string; amount: number; status: string };
type OperationsData = {
  asOf: string;
  sourceStatus: Record<string, "LIVE" | "IMPORTED" | "MANUAL" | "NOT_CONNECTED">;
  forecast: ForecastItem[];
  closeTasks: CloseTask[];
  budgets: BudgetItem[];
  reconciliations: unknown[];
};

const statusLabel: Record<string, string> = {
  LIVE: "실시간 연동", IMPORTED: "가져온 자료", MANUAL: "수기 관리", NOT_CONNECTED: "미연결",
  OPEN: "미착수", IN_PROGRESS: "진행 중", COMPLETED: "완료", APPROVED: "승인 완료",
  EXPECTED: "예정", CONFIRMED: "확정", CANCELLED: "취소",
  DRAFT: "작성 중", SUBMITTED: "검토 요청",
};

function won(value: number) {
  return `₩${Math.round(value).toLocaleString("ko-KR")}`;
}

export default function FinanceOperationsCenter() {
  const [data, setData] = useState<OperationsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [forecastDraft, setForecastDraft] = useState({ expectedDate: financeCurrentData.asOf, direction: "INFLOW", category: "매출대금", counterparty: "", amount: "", probability: "100", memo: "" });
  const [budgetDraft, setBudgetDraft] = useState({ fiscalYear: "2026", month: String(Number(financeCurrentData.asOf.slice(5, 7))), department: "전사", accountCode: "", accountName: "", amount: "" });

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/finance/operations");
      const result = await response.json() as OperationsData & { error?: string };
      if (!response.ok) throw new Error(result.error || "재무 운영 데이터를 불러오지 못했습니다.");
      setData(result);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "재무 운영 데이터를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);

  const weightedForecast = useMemo(() => (data?.forecast ?? []).reduce((sum, item) => {
    if (["CANCELLED", "COMPLETED"].includes(item.status)) return sum;
    const signed = item.direction === "INFLOW" ? item.amount : -item.amount;
    return sum + signed * (item.probability / 100);
  }, 0), [data]);
  const openingCash = financeCurrentData.accountSummary.checkingBalanceSum + financeCurrentData.accountSummary.fxBalanceSumKrw;
  const closeCompleted = data?.closeTasks.filter((item) => ["COMPLETED", "APPROVED"].includes(item.status)).length ?? 0;
  const budgetTotal = data?.budgets.reduce((sum, item) => sum + item.amount, 0) ?? 0;

  async function createItem(event: FormEvent<HTMLFormElement>, resource: "forecast" | "budget") {
    event.preventDefault();
    setMessage("");
    const draft = resource === "forecast" ? forecastDraft : budgetDraft;
    const response = await fetch("/api/finance/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resource, ...draft, amount: Number(draft.amount), ...(resource === "forecast" ? { probability: Number(forecastDraft.probability) } : { fiscalYear: Number(budgetDraft.fiscalYear), month: Number(budgetDraft.month) }) }),
    });
    const result = await response.json() as { error?: string; approvalSubmitted?: boolean };
    if (!response.ok) {
      setMessage(result.error || "저장하지 못했습니다.");
      return;
    }
    setMessage(resource === "forecast" ? "자금예측 항목을 저장했습니다." : "예산 초안을 저장했습니다.");
    if (resource === "forecast") setForecastDraft((current) => ({ ...current, counterparty: "", amount: "", memo: "" }));
    else setBudgetDraft((current) => ({ ...current, accountCode: "", accountName: "", amount: "" }));
    await load();
  }

  async function updateStatus(resource: "close" | "forecast" | "budget", id: string, status: string) {
    setMessage("");
    const response = await fetch("/api/finance/operations", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource, id, status }),
    });
    const result = await response.json() as { error?: string; approvalSubmitted?: boolean };
    if (!response.ok) {
      setMessage(result.error || "상태를 변경하지 못했습니다.");
      return;
    }
    setMessage(result.approvalSubmitted ? "전자결재를 제출했습니다. 승인 후 상태가 반영됩니다." : "상태를 변경했습니다.");
    await load();
  }

  if (loading && !data) return <section className="panel finance-control-loading">재무 운영 데이터를 확인하고 있습니다…</section>;

  return <div className="finance-control-room">
    <section className="finance-control-hero">
      <div><p>FINANCE OPERATIONS</p><h1>재무 운영센터</h1><span>예측·마감·예산·대사 상태를 한 화면에서 관리합니다.</span></div>
      <div className="finance-control-source"><small>기준일</small><strong>{data?.asOf ?? financeCurrentData.asOf}</strong><em>Clobe 스냅샷</em></div>
    </section>

    {message && <div className="finance-control-message" role="status">{message}</div>}

    <section className="finance-control-metrics">
      <article><small>은행성 자산</small><strong>{won(openingCash)}</strong><span>실제 스냅샷 기준</span></article>
      <article><small>가중 예상 순변동</small><strong>{won(weightedForecast)}</strong><span>등록된 향후 입출금</span></article>
      <article><small>월마감 진척</small><strong>{closeCompleted}/{data?.closeTasks.length ?? 0}</strong><span>완료·승인 항목</span></article>
      <article><small>등록 예산</small><strong>{won(budgetTotal)}</strong><span>{data?.budgets.length ?? 0}개 항목</span></article>
    </section>

    <section className="finance-control-grid">
      <article className="panel finance-control-panel forecast-panel">
        <header><div><p>13-WEEK CASH</p><h2>13주 자금예측</h2></div><span className={`source-state ${(data?.sourceStatus.forecast ?? "NOT_CONNECTED").toLowerCase()}`}>{statusLabel[data?.sourceStatus.forecast ?? "NOT_CONNECTED"]}</span></header>
        <form className="finance-control-form forecast-form" onSubmit={(event) => void createItem(event, "forecast")}>
          <label>예정일<input required type="date" value={forecastDraft.expectedDate} onChange={(event) => setForecastDraft({ ...forecastDraft, expectedDate: event.target.value })} /></label>
          <label>구분<select value={forecastDraft.direction} onChange={(event) => setForecastDraft({ ...forecastDraft, direction: event.target.value })}><option value="INFLOW">입금</option><option value="OUTFLOW">출금</option></select></label>
          <label>분류<input required value={forecastDraft.category} onChange={(event) => setForecastDraft({ ...forecastDraft, category: event.target.value })} /></label>
          <label>거래처<input value={forecastDraft.counterparty} onChange={(event) => setForecastDraft({ ...forecastDraft, counterparty: event.target.value })} /></label>
          <label>금액<input required min="1" type="number" value={forecastDraft.amount} onChange={(event) => setForecastDraft({ ...forecastDraft, amount: event.target.value })} /></label>
          <label>확률 %<input required min="0" max="100" type="number" value={forecastDraft.probability} onChange={(event) => setForecastDraft({ ...forecastDraft, probability: event.target.value })} /></label>
          <button type="submit">+ 예측 항목 추가</button>
        </form>
        <div className="finance-control-list">
          {(data?.forecast ?? []).map((item) => <div key={item.id}>
            <time>{item.expectedDate}</time><p><strong>{item.counterparty || item.category}</strong><small>{item.category} · 확률 {item.probability}%</small></p>
            <b className={item.direction === "INFLOW" ? "positive" : "negative"}>{item.direction === "INFLOW" ? "+" : "-"}{won(item.amount)}</b>
            <select aria-label={`${item.counterparty || item.category} 상태`} value={item.status} onChange={(event) => void updateStatus("forecast", item.id, event.target.value)}><option value="EXPECTED">예정</option><option value="CONFIRMED">확정</option><option value="COMPLETED">완료</option><option value="CANCELLED">취소</option></select>
          </div>)}
          {!data?.forecast.length && <div className="finance-empty">예정 입출금을 등록하면 13주 현금흐름을 계산합니다. 실제 자료를 임의 생성하지 않았습니다.</div>}
        </div>
      </article>

      <article className="panel finance-control-panel close-panel">
        <header><div><p>MONTH-END CLOSE</p><h2>월마감 체크리스트</h2></div><span>{data?.closeTasks[0]?.period ?? financeCurrentData.asOf.slice(0, 7)}</span></header>
        <div className="finance-close-progress"><i><b style={{ width: `${data?.closeTasks.length ? closeCompleted / data.closeTasks.length * 100 : 0}%` }} /></i><strong>{data?.closeTasks.length ? Math.round(closeCompleted / data.closeTasks.length * 100) : 0}%</strong></div>
        <div className="finance-close-list">
          {(data?.closeTasks ?? []).map((item) => <div key={item.id}><span>{["COMPLETED", "APPROVED"].includes(item.status) ? "✓" : "·"}</span><p><strong>{item.title}</strong><small>{item.category}</small></p><select aria-label={`${item.title} 상태`} value={item.status} onChange={(event) => void updateStatus("close", item.id, event.target.value)}><option value="OPEN">미착수</option><option value="IN_PROGRESS">진행 중</option><option value="COMPLETED">완료</option><option value="APPROVED">승인</option></select></div>)}
        </div>
      </article>

      <article className="panel finance-control-panel budget-panel">
        <header><div><p>BUDGET CONTROL</p><h2>예산 관리</h2></div><span className={`source-state ${(data?.sourceStatus.budgets ?? "NOT_CONNECTED").toLowerCase()}`}>{statusLabel[data?.sourceStatus.budgets ?? "NOT_CONNECTED"]}</span></header>
        <form className="finance-control-form budget-form" onSubmit={(event) => void createItem(event, "budget")}>
          <label>연도<input required type="number" min="2024" value={budgetDraft.fiscalYear} onChange={(event) => setBudgetDraft({ ...budgetDraft, fiscalYear: event.target.value })} /></label>
          <label>월<input required type="number" min="1" max="12" value={budgetDraft.month} onChange={(event) => setBudgetDraft({ ...budgetDraft, month: event.target.value })} /></label>
          <label>부서<input required value={budgetDraft.department} onChange={(event) => setBudgetDraft({ ...budgetDraft, department: event.target.value })} /></label>
          <label>계정명<input required value={budgetDraft.accountName} onChange={(event) => setBudgetDraft({ ...budgetDraft, accountName: event.target.value })} /></label>
          <label>예산액<input required min="0" type="number" value={budgetDraft.amount} onChange={(event) => setBudgetDraft({ ...budgetDraft, amount: event.target.value })} /></label>
          <button type="submit">+ 예산 초안 추가</button>
        </form>
        <div className="finance-control-list budget-list">
          {(data?.budgets ?? []).map((item) => <div key={item.id}><time>{item.fiscalYear}.{String(item.month).padStart(2, "0")}</time><p><strong>{item.accountName}</strong><small>{item.department}{item.accountCode ? ` · ${item.accountCode}` : ""}</small></p><b>{won(item.amount)}</b><select aria-label={`${item.accountName} 상태`} value={item.status} onChange={(event) => void updateStatus("budget", item.id, event.target.value)}><option value="DRAFT">작성 중</option><option value="SUBMITTED">검토 요청</option><option value="APPROVED">승인</option></select></div>)}
          {!data?.budgets.length && <div className="finance-empty">승인된 예산 파일이 없어 실제값 비교는 아직 제공하지 않습니다. 먼저 예산 초안을 등록해 주세요.</div>}
        </div>
      </article>

      <article className="panel finance-control-panel reconciliation-panel">
        <header><div><p>RECONCILIATION</p><h2>은행·분개 대사</h2></div><span className={`source-state ${(data?.sourceStatus.journalMatching ?? "NOT_CONNECTED").toLowerCase()}`}>{statusLabel[data?.sourceStatus.journalMatching ?? "NOT_CONNECTED"]}</span></header>
        <div className="reconciliation-readiness">
          <div><span>01</span><p><strong>은행 거래 원문</strong><small>거래일·입출금액·적요·계좌 식별값 필요</small></p><em>{statusLabel[data?.sourceStatus.bankTransactionLines ?? "NOT_CONNECTED"]}</em></div>
          <div><span>02</span><p><strong>분개 라인 식별값</strong><small>전표번호·라인번호·계정코드 필요</small></p><em>{statusLabel[data?.sourceStatus.journalMatching ?? "NOT_CONNECTED"]}</em></div>
          <div><span>03</span><p><strong>자동 매칭 및 승인</strong><small>금액·일자·적요 점수로 후보를 제시하고 사람이 확정</small></p><em>{data?.reconciliations.length ? `${data.reconciliations.length}건` : "대기"}</em></div>
        </div>
        <p className="finance-control-note">현재 보유한 집계 스냅샷만으로는 거래별 대사를 정확히 수행할 수 없습니다. 원천 행이 연결되기 전에는 자동으로 ‘완료’ 처리하지 않습니다.</p>
      </article>
    </section>
  </div>;
}
