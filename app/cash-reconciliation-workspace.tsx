"use client";

import { useEffect, useMemo, useState } from "react";

type MatchItem = {
  id: string; matchGroupId: string; bankTransactionId: string; sourceType: string; sourceId: string;
  matchedAmount: number; matchScore: number; matchMethod: string; status: string; memo: string;
  confirmedBy: string; confirmedAt: number; reversalReason: string;
};
type Candidate = {
  sourceType: "PAYMENT_LEDGER" | "SALES_PAYMENT" | "BANK_TRANSACTION";
  sourceId: string; direction: "IN" | "OUT"; date: string; amount: number; remainingAmount: number;
  label: string; counterparty: string; reference: string; score: number;
};
type BankTransaction = {
  id: string; source: string; sourceSnapshotDate: string; accountId: string; bankCode: string; bankName: string;
  accountName: string; accountLast4: string; currency: string; transactionAt: string; transactionDate: string;
  transactionType: string; description: string; direction: "IN" | "OUT"; amount: number; afterBalance: number;
  category: string; businessEntityName: string; isUnclassified: boolean; memo: string;
  allocatedAmount: number; remainingAmount: number; status: string; matches: MatchItem[]; candidates: Candidate[];
};
type SourceItem = {
  sourceType: "PAYMENT_LEDGER" | "SALES_PAYMENT"; sourceId: string; direction: "IN" | "OUT";
  date: string; amount: number; remainingAmount: number; label: string; counterparty: string; reference: string;
};
type ReconciliationData = {
  asOf: string;
  coverage: { startDate: string; endDate: string; importedCount: number; deduplicated: boolean };
  stats: { importedCount: number; resolvedCount: number; pendingCount: number; unclassifiedPendingCount: number; importedAmount: number; resolvedAmount: number; reconciliationRate: number };
  transactions: BankTransaction[];
  availableSources: SourceItem[];
};

const statusLabel: Record<string, string> = {
  UNMATCHED: "미대사", PARTIAL: "부분 대사", MATCHED: "대사 완료", TRANSFER: "내부 이체", EXCLUDED: "대상 제외",
};
const sourceLabel: Record<string, string> = {
  PAYMENT_LEDGER: "지급원장", SALES_PAYMENT: "수금원장", BANK_TRANSACTION: "내부 이체", EXCLUDED: "대상 제외",
};
const won = (value: number) => `₩${Math.round(value).toLocaleString("ko-KR")}`;
const money = (value: number, currency: string) => currency === "KRW" ? won(value) : `${value.toLocaleString("ko-KR")} ${currency}`;

export default function CashReconciliationWorkspace() {
  const [data, setData] = useState<ReconciliationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [filter, setFilter] = useState("PENDING");
  const [query, setQuery] = useState("");
  const [manualSources, setManualSources] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    const response = await fetch("/api/finance/reconciliation", { cache: "no-store" });
    const result = await response.json() as ReconciliationData & { error?: string };
    if (!response.ok) setMessage(result.error || "자금 대사 원장을 불러오지 못했습니다.");
    else setData(result);
    setLoading(false);
  }
  useEffect(() => {
    let active = true;
    fetch("/api/finance/reconciliation", { cache: "no-store" })
      .then(async (response) => ({ response, result: await response.json() as ReconciliationData & { error?: string } }))
      .then(({ response, result }) => {
        if (!active) return;
        if (!response.ok) setMessage(result.error || "자금 대사 원장을 불러오지 못했습니다.");
        else setData(result);
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setMessage("자금 대사 원장을 불러오지 못했습니다.");
        setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const visibleTransactions = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return (data?.transactions ?? []).filter((item) => {
      if (filter === "PENDING" && !["UNMATCHED", "PARTIAL"].includes(item.status)) return false;
      if (filter === "UNCLASSIFIED" && !(item.isUnclassified && item.remainingAmount > 0)) return false;
      if (filter === "RESOLVED" && ["UNMATCHED", "PARTIAL"].includes(item.status)) return false;
      if (filter === "TRANSFER" && item.status !== "TRANSFER") return false;
      return !normalized || `${item.description} ${item.businessEntityName} ${item.category} ${item.bankName} ${item.accountLast4}`.toLowerCase().includes(normalized);
    });
  }, [data, filter, query]);

  async function mutate(payload: Record<string, unknown>, successMessage: string) {
    setMessage("");
    const response = await fetch("/api/finance/reconciliation", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) return setMessage(result.error || "대사 상태를 변경하지 못했습니다.");
    setMessage(successMessage);
    await load();
  }

  async function confirmCandidate(transaction: BankTransaction, candidate: Candidate | SourceItem) {
    const maxAmount = Math.min(transaction.remainingAmount, candidate.remainingAmount);
    const raw = window.prompt("대사 금액을 입력하세요.", String(maxAmount));
    if (!raw) return;
    const amount = Number(raw.replaceAll(",", ""));
    if (!Number.isInteger(amount) || amount <= 0) return setMessage("대사 금액은 0원 초과 정수로 입력해 주세요.");
    if (!window.confirm(`${transaction.transactionDate} ${transaction.description || transaction.transactionType}\n${money(amount, transaction.currency)}을 ${sourceLabel[candidate.sourceType]}과 연결할까요?`)) return;
    await mutate({ action: "CONFIRM", bankTransactionId: transaction.id, sourceType: candidate.sourceType,
      sourceId: candidate.sourceId, amount }, "은행 거래와 ERP 원장을 확정 연결했습니다.");
  }

  async function exclude(transaction: BankTransaction) {
    const reason = window.prompt("대사 대상에서 제외하는 사유를 입력하세요. (예: 비사업 거래, 중복 원문)", "");
    if (!reason) return;
    await mutate({ action: "EXCLUDE", bankTransactionId: transaction.id, reason }, "제외 사유와 담당자를 감사기록에 남겼습니다.");
  }

  async function reverse(match: MatchItem) {
    const reason = window.prompt("확정 대사를 해제하는 사유를 입력하세요.", "");
    if (!reason) return;
    await mutate({ action: "REVERSE", id: match.id, reason }, "연결된 대사 그룹을 해제하고 이력을 보존했습니다.");
  }

  if (loading && !data) return <section className="panel cash-reconciliation-loading">Clobe 거래 원문과 ERP 원장을 대조하고 있습니다…</section>;

  return <div className="cash-reconciliation-workspace">
    <section className="cash-reconciliation-hero">
      <div><p>CASH RECONCILIATION</p><h1>자금 대사</h1><span>Clobe 은행 거래를 지급·수금 원장과 연결하고 미처리 사유를 추적합니다.</span></div>
      <div><small>원천 범위</small><strong>{data?.coverage.startDate}–{data?.coverage.endDate}</strong><em>{data?.coverage.deduplicated ? "거래 ID 중복 제거" : "원문 기준"}</em></div>
    </section>

    {message && <div className="cash-reconciliation-message" role="status">{message}</div>}

    <section className="cash-reconciliation-metrics">
      <article><small>가져온 거래</small><strong>{data?.stats.importedCount ?? 0}건</strong><span>Clobe 실제 원문</span></article>
      <article><small>대사율</small><strong>{data?.stats.reconciliationRate ?? 0}%</strong><span>{data?.stats.resolvedCount ?? 0}건 해결</span></article>
      <article><small>미대사 거래</small><strong>{data?.stats.pendingCount ?? 0}건</strong><span>부분 대사 포함</span></article>
      <article><small>미분류 우선검토</small><strong>{data?.stats.unclassifiedPendingCount ?? 0}건</strong><span>계정 없는 입출금</span></article>
    </section>

    <section className="panel cash-reconciliation-ledger">
      <header>
        <div><p>MATCH CONTROL</p><h2>은행 거래 대사 원장</h2><span>후보는 자동 제시하되 확정은 사용자가 수행합니다.</span></div>
        <label><span>검색</span><input value={query} placeholder="적요·거래처·계정·계좌" onChange={(event) => setQuery(event.target.value)} /></label>
      </header>
      <div className="cash-reconciliation-filters" aria-label="대사 상태 필터">
        {[ ["PENDING", "미처리"], ["UNCLASSIFIED", "미분류"], ["RESOLVED", "처리 완료"], ["TRANSFER", "내부 이체"], ["ALL", "전체"] ].map(([key, label]) =>
          <button type="button" key={key} className={filter === key ? "active" : ""} onClick={() => setFilter(key)}>{label}</button>)}
        <span>{visibleTransactions.length}건</span>
      </div>

      <div className="cash-reconciliation-table">
        <div className="cash-reconciliation-row head"><span>거래일·계좌</span><span>적요·분류</span><span>입출금액</span><span>대사 상태</span><span>원장 후보·처리</span></div>
        {visibleTransactions.slice(0, 120).map((item) => {
          const manualOptions = (data?.availableSources ?? []).filter((source) => source.direction === item.direction && source.remainingAmount > 0);
          const manualKey = manualSources[item.id] ?? "";
          const manualSource = manualOptions.find((source) => `${source.sourceType}:${source.sourceId}` === manualKey);
          return <div className={`cash-reconciliation-row ${item.status.toLowerCase()}`} key={item.id}>
            <p><strong>{item.transactionDate} {item.transactionAt.slice(11, 16)}</strong><small>{item.bankName} ····{item.accountLast4} · {item.accountName}</small></p>
            <p><strong>{item.description || item.transactionType || "적요 없음"}</strong><small>{item.businessEntityName ? `${item.businessEntityName} · ` : ""}{item.category || "미분류"}{item.isUnclassified ? " · 확인 필요" : ""}</small></p>
            <b className={item.direction === "IN" ? "in" : "out"}>{item.direction === "IN" ? "+" : "−"}{money(item.amount, item.currency)}<small>{item.allocatedAmount ? `대사 ${money(item.allocatedAmount, item.currency)}` : ""}</small></b>
            <em className={`cash-match-status ${item.status.toLowerCase()}`}>{statusLabel[item.status] ?? item.status}{item.remainingAmount > 0 && item.allocatedAmount > 0 ? <small>잔액 {money(item.remainingAmount, item.currency)}</small> : null}</em>
            <div className="cash-match-actions">
              {item.candidates[0] && item.remainingAmount > 0 && <button type="button" className="candidate" onClick={() => void confirmCandidate(item, item.candidates[0])}>
                <strong>{sourceLabel[item.candidates[0].sourceType]} {item.candidates[0].score}점</strong><small>{item.candidates[0].counterparty || item.candidates[0].label} · {money(item.candidates[0].remainingAmount, item.currency)}</small>
              </button>}
              {item.remainingAmount > 0 && item.currency === "KRW" && <div className="cash-manual-match"><select aria-label={`${item.description || item.id} 수동 원장 선택`} value={manualKey} onChange={(event) => setManualSources((current) => ({ ...current, [item.id]: event.target.value }))}>
                <option value="">다른 원장 선택</option>{manualOptions.map((source) => <option key={`${source.sourceType}:${source.sourceId}`} value={`${source.sourceType}:${source.sourceId}`}>{sourceLabel[source.sourceType]} · {source.date} · {source.counterparty || source.label} · {won(source.remainingAmount)}</option>)}
              </select><button type="button" disabled={!manualSource} onClick={() => manualSource && void confirmCandidate(item, manualSource)}>연결</button></div>}
              {item.remainingAmount > 0 && <button type="button" className="exclude" onClick={() => void exclude(item)}>비대상 처리</button>}
              {item.remainingAmount === 0 && item.matches[0] && <button type="button" className="reverse" onClick={() => void reverse(item.matches[0])}>대사 해제</button>}
              {!item.candidates.length && item.remainingAmount > 0 && !manualOptions.length && <small className="no-candidate">현재 ERP 원장 후보 없음</small>}
            </div>
          </div>;
        })}
        {!visibleTransactions.length && <div className="cash-reconciliation-empty">해당 조건의 은행 거래가 없습니다.</div>}
      </div>
      {visibleTransactions.length > 120 && <p className="cash-reconciliation-limit">화면 성능을 위해 최근 120건을 표시했습니다. 검색 또는 상태 필터로 범위를 좁혀 주세요.</p>}
    </section>

    <section className="cash-reconciliation-principles">
      <article><span>01</span><p><strong>원문 불변</strong><small>Clobe 거래 ID·거래일·금액은 수정하지 않고 대사 기록만 별도로 저장합니다.</small></p></article>
      <article><span>02</span><p><strong>부분 배분</strong><small>한 거래를 여러 지급·수금 원장에 나눠 연결하되 잔액 초과를 차단합니다.</small></p></article>
      <article><span>03</span><p><strong>사람이 확정</strong><small>자동 점수는 후보 제안에만 사용하고 담당자 확정·해제 이력을 남깁니다.</small></p></article>
      <article><span>04</span><p><strong>마감 통제</strong><small>해당 월의 원화 거래가 남아 있으면 은행 대사 마감 완료를 차단합니다.</small></p></article>
    </section>
  </div>;
}
