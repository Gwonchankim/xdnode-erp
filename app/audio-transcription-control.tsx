"use client";

import { useEffect, useState } from "react";

type EntityType = "EMPLOYEE_INTERVIEW" | "APPLICANT_INTERVIEW";
type Job = { id: string; status: string; model: string; transcript: string; wordCount: number; errorMessage: string; attempt: number;
  requestedAt: number; completedAt: number | null; reviewedText: string; reviewNote: string; reviewedBy: string; reviewedAt: number | null };
const statusLabels: Record<string, string> = { PROCESSING: "전사 중", COMPLETED: "AI 전사 완료", FAILED: "전사 실패", QUOTA_EXCEEDED: "무료 한도 초과" };

export default function AudioTranscriptionControl({ entityType, entityId }: { entityType: EntityType; entityId: string }) {
  const [job, setJob] = useState<Job | null>(null); const [consent, setConsent] = useState(false); const [busy, setBusy] = useState(false);
  const [reviewedText, setReviewedText] = useState(""); const [reviewNote, setReviewNote] = useState(""); const [message, setMessage] = useState("");
  async function load() {
    const response = await fetch(`/api/hr/transcriptions?entityType=${entityType}&entityId=${encodeURIComponent(entityId)}`);
    const data = await response.json() as { job?: Job | null; error?: string }; if (!response.ok) throw new Error(data.error || "전사 상태를 불러오지 못했습니다.");
    setJob(data.job ?? null); if (data.job?.status === "COMPLETED" && !data.job.reviewedAt) setReviewedText(data.job.transcript);
  }
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    void fetch(`/api/hr/transcriptions?entityType=${entityType}&entityId=${encodeURIComponent(entityId)}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json() as { job?: Job | null; error?: string };
        if (!response.ok) throw new Error(data.error || "전사 상태를 불러오지 못했습니다.");
        return data.job ?? null;
      })
      .then((nextJob) => {
        if (!active) return;
        setJob(nextJob);
        if (nextJob?.status === "COMPLETED" && !nextJob.reviewedAt) setReviewedText(nextJob.transcript);
      })
      .catch((error: Error) => {
        if (active && error.name !== "AbortError") setMessage(error.message);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [entityId, entityType]);
  async function transcribe(force: boolean) {
    setBusy(true); setMessage(""); try {
      const response = await fetch("/api/hr/transcriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "TRANSCRIBE", entityType, entityId, consentConfirmed: consent, force }) });
      const data = await response.json() as { job?: Job; error?: string }; if (!response.ok) throw new Error(data.error || "서버 AI 전사에 실패했습니다.");
      setJob(data.job ?? null); setReviewedText(data.job?.transcript ?? ""); setMessage("서버 AI 전사가 완료되었습니다. 원문을 검토해 확정해 주세요.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "서버 AI 전사에 실패했습니다."); await load().catch(() => undefined); } finally { setBusy(false); }
  }
  async function review() {
    if (!job) return; setBusy(true); setMessage(""); try {
      const response = await fetch("/api/hr/transcriptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "REVIEW", entityType, entityId, transcriptionId: job.id, reviewedText, reviewNote }) });
      const data = await response.json() as { job?: Job; error?: string }; if (!response.ok) throw new Error(data.error || "전사문을 확정하지 못했습니다.");
      setJob(data.job ?? null); setMessage("사용자 검토 전사문을 확정했습니다.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "전사문을 확정하지 못했습니다."); } finally { setBusy(false); }
  }
  const retry = Boolean(job && ["FAILED", "QUOTA_EXCEEDED", "COMPLETED"].includes(job.status));
  return <section className="audio-transcription-control">
    <header><div><strong>서버 AI 전사</strong><small>한국어 Whisper · AI 원문과 사용자 확정본 분리 보존</small></div><em className={(job?.status ?? "ready").toLowerCase()}>{job ? `${statusLabels[job.status] ?? job.status} · ${job.attempt}차` : "미실행"}</em></header>
    {!job?.reviewedAt && <label className="audio-transcription-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>녹음 당사자의 동의를 확인했으며, 전사를 위해 음성이 Cloudflare Workers AI로 전송되는 것에 동의합니다.</span></label>}
    {(!job || retry) && !job?.reviewedAt && <button type="button" disabled={busy || !consent} onClick={() => void transcribe(Boolean(job))}>{busy ? "AI 전사 중…" : retry ? "서버 AI 재전사" : "서버 AI 전사 시작"}</button>}
    {job?.errorMessage && <p className="audio-transcription-error">{job.errorMessage}</p>}
    {job?.status === "COMPLETED" && <>{job.reviewedAt ? <div className="audio-transcription-reviewed"><span>사용자 검토 확정</span><p>{job.reviewedText}</p><small>{new Date(job.reviewedAt).toLocaleString("ko-KR")} · AI 원문은 감사 목적으로 보존됩니다.</small></div> : <div className="audio-transcription-review"><details><summary>AI 전사 원문 보기</summary><p>{job.transcript}</p></details><label>검토·수정 전사문<textarea value={reviewedText} onChange={(event) => setReviewedText(event.target.value)} /></label><label>검토 메모<input value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder="고유명사 수정, 불명확 구간 등" /></label><button type="button" disabled={busy || reviewedText.trim().length < 2} onClick={() => void review()}>사용자 검토 확정</button></div>}</>}
    {message && <p className="audio-transcription-message" role="status">{message}</p>}
  </section>;
}
