"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Account = { id: string; name: string; businessNumber: string; industry: string; ownerEmployeeId: string; status: string; memo: string };
type Opportunity = { id: string; accountId: string; accountName: string; title: string; ownerEmployeeId: string; stage: string; leadType: string; expectedRevenue: number; expectedCost: number; probability: number; expectedCloseDate: string; nextAction: string; nextActionDate: string; status: string };
type SalesDocument = { id: string; opportunityId: string; opportunityTitle: string; accountName: string; documentType: string; documentNumber: string; version: number; amount: number; status: string; issuedDate: string; dueDate: string };
type SalesData = { dataStatus: { crm: string; incentive: string }; accounts: Account[]; opportunities: Opportunity[]; documents: SalesDocument[]; incentiveRules: Array<{ id: string; name: string; version: number; status: string }> };

const stageLabels: Record<string, string> = { LEAD: "리드", DISCOVERY: "요구 확인", PROPOSAL: "제안", CONTRACT: "계약 협의", WON: "수주", LOST: "실주" };
const dataLabels: Record<string, string> = { MANUAL: "수기 관리", NOT_CONNECTED: "미연결", APPROVED: "승인 규칙", UNVERIFIED: "규칙 미확정" };
const salesDocumentLabels: Record<string, string> = { QUOTE: "견적", ORDER: "수주", DELIVERY: "납품", INVOICE: "청구", PAYMENT: "수금" };
const salesDocumentStatusLabels: Record<string, string> = { DRAFT: "작성 중", ISSUED: "발행", ACCEPTED: "확정", COMPLETED: "완료", CANCELLED: "취소" };
const currency = (value: number) => `₩${value.toLocaleString("ko-KR")}`;

export default function SalesWorkspace({ search }: { search: string }) {
  const [data, setData] = useState<SalesData | null>(null);
  const [message, setMessage] = useState("");
  const [accountDraft, setAccountDraft] = useState({ name: "", businessNumber: "", industry: "", memo: "" });
  const [opportunityDraft, setOpportunityDraft] = useState({ accountId: "", title: "", leadType: "OUTBOUND", stage: "LEAD", expectedRevenue: "", expectedCost: "", probability: "10", expectedCloseDate: "", nextAction: "", nextActionDate: "" });
  const [documentDraft, setDocumentDraft] = useState({ opportunityId: "", documentType: "QUOTE", documentNumber: "", amount: "", issuedDate: "", dueDate: "" });
  const [simulation, setSimulation] = useState({ salePrice: 100_000_000, costPrice: 90_000_000, leadType: "OUTBOUND" });

  async function load() {
    try {
      const response = await fetch("/api/sales");
      const result = await response.json() as SalesData & { error?: string };
      if (!response.ok) throw new Error(result.error || "영업 데이터를 불러오지 못했습니다.");
      setData(result);
      if (!opportunityDraft.accountId && result.accounts[0]) setOpportunityDraft((current) => ({ ...current, accountId: result.accounts[0].id }));
      if (!documentDraft.opportunityId && result.opportunities[0]) setDocumentDraft((current) => ({ ...current, opportunityId: result.opportunities[0].id }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "영업 데이터를 불러오지 못했습니다.");
    }
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

  const opportunities = useMemo(() => (data?.opportunities ?? []).filter((item) => `${item.accountName} ${item.title}`.toLowerCase().includes(search.toLowerCase())), [data, search]);
  const open = opportunities.filter((item) => item.status === "OPEN");
  const pipeline = open.reduce((sum, item) => sum + item.expectedRevenue, 0);
  const weightedPipeline = open.reduce((sum, item) => sum + item.expectedRevenue * item.probability / 100, 0);
  const expectedMargin = open.reduce((sum, item) => sum + item.expectedRevenue - item.expectedCost, 0);
  const simulationMargin = simulation.salePrice - simulation.costPrice;
  const simulationRate = simulation.salePrice ? simulationMargin / simulation.salePrice : 0;
  const provisionalEligible = simulation.leadType === "OUTBOUND" && simulationRate > .05;
  const provisionalPayout = provisionalEligible ? (simulationMargin - simulation.salePrice * .05) * .05 : 0;

  async function create(event: FormEvent<HTMLFormElement>, resource: "account" | "opportunity") {
    event.preventDefault(); setMessage("");
    const payload = resource === "account" ? accountDraft : { ...opportunityDraft, expectedRevenue: Number(opportunityDraft.expectedRevenue), expectedCost: Number(opportunityDraft.expectedCost), probability: Number(opportunityDraft.probability) };
    const response = await fetch("/api/sales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource, ...payload }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setMessage(result.error || "저장하지 못했습니다."); return; }
    setMessage(resource === "account" ? "거래처를 등록했습니다." : "영업 건을 등록했습니다.");
    if (resource === "account") setAccountDraft({ name: "", businessNumber: "", industry: "", memo: "" });
    else setOpportunityDraft((current) => ({ ...current, title: "", expectedRevenue: "", expectedCost: "", expectedCloseDate: "", nextAction: "", nextActionDate: "" }));
    await load();
  }

  async function updateStage(id: string, stage: string) {
    const response = await fetch("/api/sales", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, stage }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setMessage(result.error || "단계를 변경하지 못했습니다."); return; }
    await load();
  }

  async function createDocument(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    const response = await fetch("/api/sales", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource: "document", ...documentDraft, amount: Number(documentDraft.amount) }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setMessage(result.error || "영업 문서를 저장하지 못했습니다."); return; }
    setMessage(`${salesDocumentLabels[documentDraft.documentType]} 문서를 저장했습니다.`);
    setDocumentDraft((current) => ({ ...current, documentNumber: "", amount: "", issuedDate: "", dueDate: "" }));
    await load();
  }

  async function updateDocumentStatus(id: string, status: string) {
    const response = await fetch("/api/sales", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource: "document", id, status }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) { setMessage(result.error || "문서 상태를 변경하지 못했습니다."); return; }
    await load();
  }

  return <div className="sales-workspace-live">
    <section className="sales-live-heading"><div><p>SALES OPERATIONS</p><h2>영업 운영</h2><span>거래처와 영업기회를 실제 저장하고 단계별 예상 매출을 관리합니다.</span></div><div><span className={`source-state ${(data?.dataStatus.crm ?? "NOT_CONNECTED").toLowerCase()}`}>{dataLabels[data?.dataStatus.crm ?? "NOT_CONNECTED"]}</span><span className={`source-state ${(data?.dataStatus.incentive ?? "UNVERIFIED").toLowerCase()}`}>{dataLabels[data?.dataStatus.incentive ?? "UNVERIFIED"]}</span></div></section>
    {message && <div className="sales-live-message" role="status">{message}</div>}
    <section className="sales-live-metrics">
      <article><small>진행 영업 건</small><strong>{open.length}건</strong><span>실제 등록 기준</span></article>
      <article><small>파이프라인</small><strong>{currency(pipeline)}</strong><span>예상 매출 합계</span></article>
      <article><small>가중 파이프라인</small><strong>{currency(weightedPipeline)}</strong><span>성공확률 반영</span></article>
      <article><small>예상 이익</small><strong>{currency(expectedMargin)}</strong><span>예상 매출 - 예상 원가</span></article>
    </section>

    <section className="sales-live-grid">
      <article className="panel sales-entry-panel">
        <header><div><p>ACCOUNT</p><h2>거래처 등록</h2></div><span>{data?.accounts.length ?? 0}곳</span></header>
        <form onSubmit={(event) => void create(event, "account")}><label>거래처명<input required value={accountDraft.name} onChange={(event) => setAccountDraft({ ...accountDraft, name: event.target.value })} /></label><label>사업자번호<input value={accountDraft.businessNumber} onChange={(event) => setAccountDraft({ ...accountDraft, businessNumber: event.target.value })} /></label><label>업종<input value={accountDraft.industry} onChange={(event) => setAccountDraft({ ...accountDraft, industry: event.target.value })} /></label><button type="submit">+ 거래처 등록</button></form>
        <div className="sales-account-list">{(data?.accounts ?? []).map((item) => <div key={item.id}><strong>{item.name}</strong><span>{item.industry || "업종 미입력"}</span><em>{item.status}</em></div>)}{!data?.accounts.length && <p>등록된 거래처가 없습니다.</p>}</div>
      </article>

      <article className="panel sales-entry-panel opportunity-entry">
        <header><div><p>OPPORTUNITY</p><h2>영업 건 등록</h2></div><span>원가 포함</span></header>
        <form onSubmit={(event) => void create(event, "opportunity")}>
          <label>거래처<select required value={opportunityDraft.accountId} onChange={(event) => setOpportunityDraft({ ...opportunityDraft, accountId: event.target.value })}><option value="">선택</option>{(data?.accounts ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>영업 건명<input required value={opportunityDraft.title} onChange={(event) => setOpportunityDraft({ ...opportunityDraft, title: event.target.value })} /></label>
          <label>유형<select value={opportunityDraft.leadType} onChange={(event) => setOpportunityDraft({ ...opportunityDraft, leadType: event.target.value })}><option value="OUTBOUND">아웃바운드</option><option value="INBOUND">인바운드</option><option value="RAM">RAM 단독</option></select></label>
          <label>예상 매출<input required type="number" min="0" value={opportunityDraft.expectedRevenue} onChange={(event) => setOpportunityDraft({ ...opportunityDraft, expectedRevenue: event.target.value })} /></label>
          <label>예상 원가<input required type="number" min="0" value={opportunityDraft.expectedCost} onChange={(event) => setOpportunityDraft({ ...opportunityDraft, expectedCost: event.target.value })} /></label>
          <label>확률 %<input required type="number" min="0" max="100" value={opportunityDraft.probability} onChange={(event) => setOpportunityDraft({ ...opportunityDraft, probability: event.target.value })} /></label>
          <label>예상 마감일<input type="date" value={opportunityDraft.expectedCloseDate} onChange={(event) => setOpportunityDraft({ ...opportunityDraft, expectedCloseDate: event.target.value })} /></label>
          <label>다음 행동<input value={opportunityDraft.nextAction} onChange={(event) => setOpportunityDraft({ ...opportunityDraft, nextAction: event.target.value })} /></label>
          <button type="submit">+ 영업 건 등록</button>
        </form>
      </article>
    </section>

    <section className="panel sales-live-pipeline">
      <header><div><p>PIPELINE</p><h2>실제 영업 파이프라인</h2></div><span>{opportunities.length}건</span></header>
      <div className="sales-pipeline-row head"><span>거래처 / 영업 건</span><span>단계</span><span>예상 매출</span><span>예상 이익</span><span>확률</span><span>예정일</span></div>
      {opportunities.map((item) => <div className="sales-pipeline-row" key={item.id}><p><strong>{item.accountName}</strong><small>{item.title}</small></p><select value={item.stage} onChange={(event) => void updateStage(item.id, event.target.value)}>{Object.entries(stageLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><b>{currency(item.expectedRevenue)}</b><span>{currency(item.expectedRevenue - item.expectedCost)}</span><span>{item.probability}%</span><time>{item.expectedCloseDate || "미정"}</time></div>)}
      {!opportunities.length && <div className="finance-empty">등록된 영업 기회가 없습니다. 위에서 거래처와 영업 건을 먼저 등록해 주세요.</div>}
    </section>

    <section className="panel sales-document-flow">
      <header><div><p>QUOTE TO CASH</p><h2>견적·수주·납품·청구·수금</h2></div><span>{data?.documents.length ?? 0}개 문서</span></header>
      <form className="sales-document-form" onSubmit={createDocument}>
        <label>영업 건<select required value={documentDraft.opportunityId} onChange={(event) => setDocumentDraft({ ...documentDraft, opportunityId: event.target.value })}><option value="">선택</option>{(data?.opportunities ?? []).map((item) => <option key={item.id} value={item.id}>{item.accountName} · {item.title}</option>)}</select></label>
        <label>문서 종류<select value={documentDraft.documentType} onChange={(event) => setDocumentDraft({ ...documentDraft, documentType: event.target.value })}>{Object.entries(salesDocumentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>문서번호<input required value={documentDraft.documentNumber} onChange={(event) => setDocumentDraft({ ...documentDraft, documentNumber: event.target.value })} placeholder="견적·발주·세금계산서 번호" /></label>
        <label>금액<input required type="number" min="0" value={documentDraft.amount} onChange={(event) => setDocumentDraft({ ...documentDraft, amount: event.target.value })} /></label>
        <label>발행일<input type="date" value={documentDraft.issuedDate} onChange={(event) => setDocumentDraft({ ...documentDraft, issuedDate: event.target.value })} /></label>
        <label>예정일<input type="date" value={documentDraft.dueDate} onChange={(event) => setDocumentDraft({ ...documentDraft, dueDate: event.target.value })} /></label>
        <button type="submit">+ 문서 저장</button>
      </form>
      <div className="sales-document-row head"><span>거래처 / 영업 건</span><span>종류</span><span>문서번호</span><span>버전</span><span>금액</span><span>발행·예정일</span><span>상태</span></div>
      {(data?.documents ?? []).map((document) => <div className="sales-document-row" key={document.id}><p><strong>{document.accountName}</strong><small>{document.opportunityTitle}</small></p><span>{salesDocumentLabels[document.documentType] ?? document.documentType}</span><b>{document.documentNumber}</b><span>v{document.version}</span><strong>{currency(document.amount)}</strong><time>{document.issuedDate || "미발행"}<small>{document.dueDate ? ` → ${document.dueDate}` : ""}</small></time><select aria-label={`${document.documentNumber} 상태`} value={document.status} onChange={(event) => void updateDocumentStatus(document.id, event.target.value)}>{Object.entries(salesDocumentStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>)}
      {!data?.documents.length && <div className="finance-empty">영업 문서를 등록하면 견적부터 수금까지 한 흐름으로 확인할 수 있습니다.</div>}
    </section>

    <section className="sales-live-grid incentive-governance">
      <article className="panel incentive-sandbox"><header><div><p>SIMULATION ONLY</p><h2>인센티브 계산 샌드박스</h2></div><span>급여 미반영</span></header><div className="incentive-warning">현재 회사의 확정·승인된 인센티브 규칙이 등록되지 않았습니다. 아래 결과는 기존 가정식의 시뮬레이션일 뿐 지급 근거가 아닙니다.</div><div className="incentive-sandbox-body"><label>매출가<input type="number" value={simulation.salePrice} onChange={(event) => setSimulation({ ...simulation, salePrice: Number(event.target.value) })} /></label><label>인정 원가<input type="number" value={simulation.costPrice} onChange={(event) => setSimulation({ ...simulation, costPrice: Number(event.target.value) })} /></label><label>유형<select value={simulation.leadType} onChange={(event) => setSimulation({ ...simulation, leadType: event.target.value })}><option value="OUTBOUND">아웃바운드</option><option value="INBOUND">인바운드</option><option value="RAM">RAM 단독</option></select></label><div><small>가정식 결과</small><strong>{currency(provisionalPayout)}</strong><span>마진율 {(simulationRate * 100).toFixed(1)}%</span></div></div></article>
      <article className="panel incentive-rule-state"><header><div><p>RULE GOVERNANCE</p><h2>인센티브 규칙 상태</h2></div><span>{data?.incentiveRules.length ?? 0}개 버전</span></header><div className="finance-empty">확정 규정 원문, 적용일, 예외 승인권자, 환수 조건을 제공받기 전까지 활성 규칙과 급여 전송을 차단합니다.</div></article>
    </section>
  </div>;
}
