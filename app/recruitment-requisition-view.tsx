"use client";

import { useEffect, useMemo, useState } from "react";

type Plan = { id: string; period: string; version: number; title: string };
type GapLine = {
  id: string; planId: string; organizationId: string; organizationName: string;
  approvedHeadcount: number; currentHeadcount: number; incomingHeadcount: number; plannedExits: number;
  hiringGap: number; reservedHeadcount: number; availableHeadcount: number; note: string;
};
type Requisition = {
  id: string; organizationName: string; title: string; role: string; requestedHeadcount: number;
  applicantCount: number; filledHeadcount: number; remainingHeadcount: number; ownerName: string;
  targetStartDate: string; reason: string; status: string; closeReason: string;
};
type Recruiter = { id: string; name: string; department: string };
type Payload = {
  plan: Plan | null; lines: GapLine[]; requisitions: Requisition[];
  summary: { planGap: number; reserved: number; available: number; filled: number };
  recruiters: Recruiter[]; error?: string;
};

const labels: Record<string, string> = {
  DRAFT: "작성 중", SUBMITTED: "결재 중", OPEN: "모집 중", REJECTED: "반려",
  FILLED: "충원 완료", CLOSED: "조기 마감", CANCELLED: "취소",
};

export default function RecruitmentRequisitionView({ onNotify }: { onNotify: (message: string) => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedLineId, setSelectedLineId] = useState("");
  const [draft, setDraft] = useState({ title: "", role: "", requestedHeadcount: 1, ownerEmployeeId: "", targetStartDate: "", reason: "" });

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/hr/recruitment-requisitions");
      const payload = await response.json() as Payload;
      if (!response.ok) throw new Error(payload.error || "채용요청을 불러오지 못했습니다.");
      setData(payload);
      const first = payload.lines.find((line) => line.availableHeadcount > 0)?.id ?? "";
      setSelectedLineId((current) => payload.lines.some((line) => line.id === current && line.availableHeadcount > 0) ? current : first);
      setDraft((current) => ({ ...current, ownerEmployeeId: current.ownerEmployeeId || payload.recruiters[0]?.id || "" }));
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "채용요청을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/hr/recruitment-requisitions")
      .then(async (response) => {
        const payload = await response.json() as Payload;
        if (!response.ok) throw new Error(payload.error || "채용요청을 불러오지 못했습니다.");
        return payload;
      })
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setSelectedLineId(payload.lines.find((line) => line.availableHeadcount > 0)?.id ?? "");
        setDraft((current) => ({ ...current, ownerEmployeeId: current.ownerEmployeeId || payload.recruiters[0]?.id || "" }));
      })
      .catch((error: Error) => { if (!cancelled) onNotify(error.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [onNotify]);

  const selectedLine = useMemo(() => data?.lines.find((line) => line.id === selectedLineId) ?? null, [data, selectedLineId]);

  async function createDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedLine) return;
    setSaving(true);
    try {
      const response = await fetch("/api/hr/recruitment-requisitions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CREATE_DRAFT", workforcePlanLineId: selectedLine.id, ...draft }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "채용요청을 저장하지 못했습니다.");
      onNotify("채용요청 초안을 저장했습니다. 내용을 확인한 뒤 결재를 제출해 주세요.");
      setDraft({ title: "", role: "", requestedHeadcount: 1, ownerEmployeeId: data?.recruiters[0]?.id ?? "", targetStartDate: "", reason: "" });
      await load();
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "채용요청을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function action(id: string, name: "SUBMIT" | "CLOSE" | "CANCEL") {
    const reason = name === "SUBMIT" ? "" : window.prompt(name === "CLOSE" ? "조기 마감 사유를 5자 이상 입력해 주세요." : "초안 취소 사유를 5자 이상 입력해 주세요.")?.trim() ?? "";
    if (name !== "SUBMIT" && reason.length < 5) return;
    const response = await fetch("/api/hr/recruitment-requisitions", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: name, id, reason }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) { onNotify(payload.error || "채용요청 상태를 변경하지 못했습니다."); return; }
    onNotify(name === "SUBMIT" ? "채용요청 결재를 제출했습니다." : name === "CLOSE" ? "채용요청을 사유와 함께 마감했습니다." : "채용요청 초안을 취소했습니다.");
    await load();
  }

  const summary = data?.summary ?? { planGap: 0, reserved: 0, available: 0, filled: 0 };
  return <div className="page-wrap module-page requisition-page">
    <section className="module-hero"><div><p className="eyebrow">RECRUITMENT REQUISITIONS</p><h1>채용요청·TO 관리</h1><p>승인된 정원 부족을 채용요청, 지원자, 입사 확정까지 하나의 흐름으로 관리합니다.</p></div><span className="requisition-plan-badge">{data?.plan ? `${data.plan.period} · v${data.plan.version} 승인본` : "승인 인력계획 없음"}</span></section>
    <section className="metric-grid module-metrics">{[
      ["계획 충원 필요", `${summary.planGap}명`, "승인 정원 산식"], ["예약된 TO", `${summary.reserved}명`, "초안·결재·모집 중"],
      ["추가 기안 가능", `${summary.available}명`, "중복 충원 차단"], ["입사 확정", `${summary.filled}명`, "제안 수락 기준"],
    ].map(([label, value, note], index) => <div className="compact-metric" key={label}><span className={`metric-accent ${["navy", "orange", "blue", "green"][index]}`}></span><p>{label}</p><h2>{value}</h2><small>{note}</small></div>)}</section>

    <section className="panel requisition-create-panel">
      <div className="detail-card-heading"><div><p className="eyebrow">NEW REQUISITION</p><h2>채용요청 초안</h2></div><span>승인 정원 안에서만 생성</span></div>
      {!data?.plan ? <p className="requisition-empty">먼저 인력계획·정원에서 계획을 승인해 주세요.</p> : summary.available < 1 ? <p className="requisition-empty">현재 추가 기안 가능한 정원 부족분이 없습니다.</p> : <form className="requisition-form" onSubmit={createDraft}>
        <label><span>충원 조직</span><select required value={selectedLineId} onChange={(event) => setSelectedLineId(event.target.value)}>{data.lines.filter((line) => line.availableHeadcount > 0).map((line) => <option key={line.id} value={line.id}>{line.organizationName} · 기안 가능 {line.availableHeadcount}명</option>)}</select></label>
        <label><span>채용 직무</span><input required value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })} placeholder="예: R&D 연구개발" /></label>
        <label><span>요청 제목</span><input required value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="예: 기술팀 연구원 충원" /></label>
        <label><span>요청 인원</span><input required type="number" min="1" max={selectedLine?.availableHeadcount ?? 1} value={draft.requestedHeadcount} onChange={(event) => setDraft({ ...draft, requestedHeadcount: Number(event.target.value) })} /></label>
        <label><span>채용담당자</span><select required value={draft.ownerEmployeeId} onChange={(event) => setDraft({ ...draft, ownerEmployeeId: event.target.value })}><option value="">담당자 선택</option>{data.recruiters.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.department}</option>)}</select></label>
        <label><span>목표 입사일</span><input required type="date" value={draft.targetStartDate} onChange={(event) => setDraft({ ...draft, targetStartDate: event.target.value })} /></label>
        <label className="wide"><span>충원 사유와 기대 역할</span><textarea required minLength={10} value={draft.reason} onChange={(event) => setDraft({ ...draft, reason: event.target.value })} placeholder="정원 부족 원인과 이 인원이 맡을 역할을 10자 이상 기록하세요." /></label>
        <button type="submit" className="primary-button" disabled={saving || !selectedLine}>{saving ? "저장 중…" : "채용요청 초안 저장"}</button>
      </form>}
    </section>

    <section className="panel table-panel requisition-ledger">
      <div className="table-toolbar"><div><h2>채용요청 원장</h2><span>{data?.requisitions.length ?? 0}건 · 지원자 수는 충원 인원으로 계산하지 않습니다.</span></div></div>
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>조직·직무</th><th>요청/확정/잔여</th><th>지원자</th><th>담당자</th><th>목표일</th><th>상태</th><th>처리</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={7} className="empty-cell">채용요청을 불러오는 중입니다.</td></tr> : data?.requisitions.length ? data.requisitions.map((item) => <tr key={item.id}>
          <td><strong>{item.title}</strong><small>{item.organizationName} · {item.role}</small></td><td>{item.requestedHeadcount} / {item.filledHeadcount} / <b>{item.remainingHeadcount}</b></td><td>{item.applicantCount}명</td><td>{item.ownerName}</td><td>{item.targetStartDate}</td><td><span className={`requisition-status ${item.status.toLowerCase()}`}>{labels[item.status] ?? item.status}</span></td>
          <td><div className="row-actions">{item.status === "DRAFT" && <><button type="button" className="interview-action" onClick={() => void action(item.id, "SUBMIT")}>결재 제출</button><button type="button" className="reject-action" onClick={() => void action(item.id, "CANCEL")}>초안 취소</button></>}{item.status === "OPEN" && <button type="button" className="reject-action" onClick={() => void action(item.id, "CLOSE")}>조기 마감</button>}{!["DRAFT", "OPEN"].includes(item.status) && <span>{item.closeReason || "자동 처리"}</span>}</div></td>
        </tr>) : <tr><td colSpan={7} className="empty-cell">등록된 채용요청이 없습니다.</td></tr>}
      </tbody></table></div>
    </section>
  </div>;
}
