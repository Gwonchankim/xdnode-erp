"use client";

import { useEffect, useMemo, useState } from "react";

type CaseEvent = { id: string; action: string; actorEmployeeId: string; fromStatus: string; toStatus: string; note: string; createdAt: number };
type ImpactCase = {
  id: string; entityType: string; entityId: string; entityLabel: string; action: string; impactCode: string;
  impactLabel: string; impactDetail: string; initialCount: number; currentCount: number; initialAmount: number;
  currentAmount: number; status: string; ownerEmployeeId: string; ownerName: string; dueDate: string;
  resolutionNote: string; evidenceRef: string; lastRecheckedBy: string; lastRecheckedAt: number | null;
  version: number; createdAt: number; updatedAt: number; isOverdue: boolean; events: CaseEvent[];
};
type QueueData = {
  summary: { active: number; open: number; inProgress: number; verified: number; overdue: number };
  cases: ImpactCase[]; employees: Array<{ id: string; name: string; department: string }>;
  controls: { automaticResolution: boolean; companyEmployeesOnly: boolean; recheckRequired: boolean; evidenceRequired: boolean };
};

const statusLabels: Record<string, string> = { ALL: "전체", OPEN: "대기", IN_PROGRESS: "진행 중", VERIFIED: "재검증 통과", CLOSED: "종결" };
const actionLabels: Record<string, string> = { UPDATE: "수정", DEACTIVATE: "비활성화", ACTIVATE: "재활성화", MERGE: "병합" };
const entityLabels: Record<string, string> = { FINANCE_ACCOUNT: "계정과목", FINANCE_PARTNER: "재무 거래처", FINANCE_BANK: "은행계좌", FINANCE_TAX: "세금코드", SALES_ACCOUNT: "영업 거래처", HR_ORGANIZATION: "HR 조직" };
const eventLabels: Record<string, string> = { CASE_CREATED: "업무 생성", SOURCE_REFRESHED: "원천 갱신", ASSIGN: "담당·기한 변경", START: "진행 시작", RECHECK: "원장 재검증", CLOSE: "종결" };
const won = (value: number) => `₩${value.toLocaleString("ko-KR")}`;
const formatTime = (value: number | null) => value ? new Date(value).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" }) : "미실행";

async function requestQueue(status: string, query: string) {
  const params = new URLSearchParams({ status }); if (query) params.set("q", query);
  const response = await fetch(`/api/master-impact-cases?${params}`, { cache: "no-store" });
  const payload = await response.json() as QueueData & { error?: string };
  if (!response.ok) throw new Error(payload.error || "영향 해결 큐를 불러오지 못했습니다.");
  return payload;
}

export default function MasterImpactCaseWorkspace() {
  const [data, setData] = useState<QueueData | null>(null);
  const [status, setStatus] = useState("ALL"); const [query, setQuery] = useState(""); const [searchDraft, setSearchDraft] = useState("");
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(""); const [message, setMessage] = useState("");
  const [expanded, setExpanded] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { ownerEmployeeId: string; dueDate: string }>>({});

  useEffect(() => {
    let cancelled = false;
    requestQueue(status, query).then((payload) => { if (!cancelled) { setData(payload); setMessage(""); setDrafts(Object.fromEntries(payload.cases.map((item) => [item.id, { ownerEmployeeId: item.ownerEmployeeId, dueDate: item.dueDate }]))); } })
      .catch((error: Error) => { if (!cancelled) setMessage(error.message); }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [query, status]);

  async function mutate(action: string, item: ImpactCase, extra: Record<string, unknown> = {}) {
    setBusy(`${action}:${item.id}`); setMessage("");
    try {
      const response = await fetch("/api/master-impact-cases", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, id: item.id, expectedVersion: item.version, statusFilter: status, query, ...extra }) });
      const payload = await response.json() as QueueData & { error?: string };
      if (!response.ok) throw new Error(payload.error || "영향 해결 업무를 처리하지 못했습니다.");
      setData(payload); setDrafts(Object.fromEntries(payload.cases.map((row) => [row.id, { ownerEmployeeId: row.ownerEmployeeId, dueDate: row.dueDate }])));
      setMessage(action === "RECHECK" ? "최신 원장으로 재검증했습니다." : action === "CLOSE" ? "증빙과 해결 메모를 남기고 업무를 종결했습니다." : "업무 상태를 저장했습니다.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "영향 해결 업무를 처리하지 못했습니다."); }
    finally { setBusy(""); }
  }

  function closeCase(item: ImpactCase) {
    const resolutionNote = window.prompt("해결 방법과 확인 결과를 10자 이상 입력해 주세요.", item.resolutionNote || "연결 원장 정리 후 재검증 완료");
    if (!resolutionNote) return;
    const evidenceRef = window.prompt("증빙 문서 번호·업무 링크·전표 번호 중 하나를 입력해 주세요.", item.evidenceRef || "");
    if (!evidenceRef) return;
    void mutate("CLOSE", item, { resolutionNote, evidenceRef });
  }

  const overdueIds = useMemo(() => new Set((data?.cases ?? []).filter((item) => item.isOverdue).map((item) => item.id)), [data]);

  return <div className="master-impact-case-body">
    <section className="master-impact-case-boundary"><div><p>MASTER DATA RESOLUTION</p><h3>기준정보 영향 해결 큐</h3><span>차단 항목을 담당자·기한·원장 재검증·증빙까지 연결해 종결합니다.</span></div><ul><li>자동 해결 없음</li><li>회사 직원만 배정</li><li>재검증 필수</li><li>증빙 필수</li></ul></section>
    {message && <div className="master-impact-case-message" role="status">{message}</div>}
    {loading && <div className="master-impact-case-loading">차단 영향과 담당 업무를 불러오는 중입니다.</div>}
    {data && <>
      <section className="master-impact-case-summary">
        <article><span>활성 업무</span><strong>{data.summary.active}<small>건</small></strong></article>
        <article><span>대기 / 진행</span><strong>{data.summary.open} / {data.summary.inProgress}<small>건</small></strong></article>
        <article className="verified"><span>재검증 통과</span><strong>{data.summary.verified}<small>건</small></strong></article>
        <article className={data.summary.overdue ? "overdue" : ""}><span>기한 경과</span><strong>{data.summary.overdue}<small>건</small></strong></article>
      </section>
      <form className="master-impact-case-filters" onSubmit={(event) => { event.preventDefault(); setQuery(searchDraft.trim()); }}>
        <nav aria-label="영향 업무 상태">{["ALL","OPEN","IN_PROGRESS","VERIFIED","CLOSED"].map((value) => <button type="button" key={value} className={status === value ? "active" : ""} onClick={() => setStatus(value)}>{statusLabels[value]}</button>)}</nav>
        <input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="대상·영향·담당자 검색" aria-label="영향 업무 검색" />
        <button type="submit">검색</button>
      </form>
      <section className="master-impact-case-ledger">
        <header><span>대상·영향</span><span>연결 원장</span><span>담당자·기한</span><span>상태·관리</span></header>
        {data.cases.map((item) => {
          const draft = drafts[item.id] ?? { ownerEmployeeId: item.ownerEmployeeId, dueDate: item.dueDate };
          const isBusy = busy.endsWith(`:${item.id}`); const isExpanded = expanded === item.id;
          return <article className={`${item.status.toLowerCase()} ${overdueIds.has(item.id) ? "overdue" : ""}`} key={item.id}>
            <div className="master-impact-case-title"><em>{entityLabels[item.entityType] ?? item.entityType} · {actionLabels[item.action] ?? item.action}</em><strong>{item.entityLabel}</strong><span>{item.impactLabel}</span><small>{item.impactDetail}</small></div>
            <div className="master-impact-case-count"><span>최초 <strong>{item.initialCount}건</strong>{item.initialAmount > 0 && <small>{won(item.initialAmount)}</small>}</span><b>→</b><span>현재 <strong>{item.currentCount}건</strong>{item.currentAmount > 0 && <small>{won(item.currentAmount)}</small>}</span><small>최근 재검증 {formatTime(item.lastRecheckedAt)}</small></div>
            <div className="master-impact-case-assignment"><select disabled={item.status === "CLOSED" || isBusy} value={draft.ownerEmployeeId} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: { ...draft, ownerEmployeeId: event.target.value } }))}>{data.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} · {employee.department || "소속 미지정"}</option>)}</select><input disabled={item.status === "CLOSED" || isBusy} type="date" value={draft.dueDate} onChange={(event) => setDrafts((current) => ({ ...current, [item.id]: { ...draft, dueDate: event.target.value } }))} /><button type="button" disabled={item.status === "CLOSED" || isBusy || (draft.ownerEmployeeId === item.ownerEmployeeId && draft.dueDate === item.dueDate)} onClick={() => void mutate("ASSIGN", item, draft)}>배정 저장</button></div>
            <div className="master-impact-case-actions"><em>{overdueIds.has(item.id) ? "기한 경과" : statusLabels[item.status] ?? item.status}</em>{item.status === "OPEN" && <button disabled={isBusy} type="button" onClick={() => void mutate("START", item)}>진행 시작</button>}{item.status !== "CLOSED" && <button disabled={isBusy} type="button" onClick={() => void mutate("RECHECK", item)}>원장 재검증</button>}{item.status === "VERIFIED" && <button className="close" disabled={isBusy} type="button" onClick={() => closeCase(item)}>증빙 남기고 종결</button>}<button type="button" onClick={() => setExpanded(isExpanded ? "" : item.id)}>{isExpanded ? "이력 닫기" : "처리 이력"}</button></div>
            {isExpanded && <div className="master-impact-case-events">{item.events.map((event) => <div key={event.id}><time>{formatTime(event.createdAt)}</time><p><strong>{eventLabels[event.action] ?? event.action}</strong><span>{event.note}</span><small>{event.actorEmployeeId} · {statusLabels[event.fromStatus] ?? (event.fromStatus || "생성")} → {statusLabels[event.toStatus] ?? event.toStatus}</small></p></div>)}{!item.events.length && <p>처리 이력이 없습니다.</p>}{item.status === "CLOSED" && <aside><strong>해결 메모</strong><span>{item.resolutionNote}</span><small>증빙 {item.evidenceRef}</small></aside>}</div>}
          </article>;
        })}
        {!data.cases.length && <div className="master-impact-case-empty">현재 조건에 해당하는 영향 해결 업무가 없습니다.</div>}
      </section>
    </>}
  </div>;
}
