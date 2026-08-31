"use client";

import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import readXlsxFile from "read-excel-file/browser";

type AssistantModule = "hr" | "compensation";
type MoneyField = "annualSalary" | "basePay" | "mealAllowance" | "childcareAllowance" | "vehicleAllowance";

type EmployeeRecord = {
  employeeId: string; name: string; birth: string; email: string; phone: string; address: string;
  department: string; manager: string; type: string; joinDate: string; position: string; jobTitle: string;
  status: string; history: unknown[]; retirement: unknown; annualSalary: number; basePay: number;
  mealAllowance: number; childcareAllowance: number; vehicleAllowance: number; updatedAt: number;
};

type AssistantAction = {
  id: string; type: "UPDATE_HR_COMPENSATION_DEFAULTS" | "CREATE_COMPENSATION_DRAFT";
  title: string; summary: string; employeeId: string; period: string; values: Partial<Record<MoneyField, number | null>>;
};

type AssistantResponse = {
  answer: string;
  cautions?: string[];
  nextSteps?: string[];
  proposedActions?: AssistantAction[];
};

type FileAnalysis = { fileName: string; rowCount: number; columns: string[]; preview: Array<Record<string, string>> };

const bridgeUrl = "http://127.0.0.1:3110";
const moneyFields: MoneyField[] = ["annualSalary", "basePay", "mealAllowance", "childcareAllowance", "vehicleAllowance"];
const moneyLabels: Record<MoneyField, string> = { annualSalary: "연봉", basePay: "기본급", mealAllowance: "식대", childcareAllowance: "육아수당", vehicleAllowance: "자가운전수당" };

const workspaceLabel: Record<AssistantModule, string> = { hr: "HR", compensation: "임금 계산" };
const suggestedQuestions: Record<AssistantModule, string[]> = {
  hr: ["퇴직 처리 시 확인할 항목을 정리해줘.", "인사기록카드의 급여 기본값을 점검해줘.", "올린 파일의 급여 항목을 HR 기본값에 반영할 변경안을 만들어줘."],
  compensation: ["월 급여안을 확정하기 전에 확인할 항목을 정리해줘.", "HR 기본값으로 이번 달 임금 초안을 만들어줘.", "올린 파일의 급여 항목을 HR 기본값에 반영할 변경안을 만들어줘."],
};

function currentPeriod() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function parseCsvLine(line: string) {
  const cells: string[] = []; let value = ""; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"' && quoted && line[index + 1] === '"') { value += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === "," && !quoted) { cells.push(value.trim()); value = ""; }
    else value += character;
  }
  cells.push(value.trim());
  return cells;
}

function rowsToAnalysis(fileName: string, rows: unknown[][]): FileAnalysis {
  const headers = (rows[0] ?? []).map((value, index) => String(value ?? "").trim() || `열 ${index + 1}`);
  const data = rows.slice(1).filter((row) => row.some((value) => String(value ?? "").trim())).map((row) => Object.fromEntries(headers.map((header, index) => [header, String(row[index] ?? "").trim()])));
  return { fileName, rowCount: data.length, columns: headers, preview: data.slice(0, 30) };
}

function textToAnalysis(fileName: string, text: string): FileAnalysis {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) throw new Error("파일에서 읽을 수 있는 텍스트를 찾지 못했습니다. 이미지형 PDF라면 텍스트가 포함된 원본을 사용해 주세요.");
  return { fileName, rowCount: lines.length, columns: ["추출 텍스트"], preview: lines.slice(0, 30).map((line) => ({ "추출 텍스트": line })) };
}

async function analyzeFile(file: File): Promise<FileAnalysis> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx")) return rowsToAnalysis(file.name, await readXlsxFile(file));
  if (name.endsWith(".pdf")) {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
    const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
    }
    return textToAnalysis(file.name, pages.join("\n"));
  }
  if (name.endsWith(".docx")) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return textToAnalysis(file.name, result.value);
  }
  const raw = await file.text();
  if (name.endsWith(".json")) {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("JSON 파일은 행 배열 형식이어야 합니다.");
    const columns = Array.from(new Set(parsed.flatMap((row) => row && typeof row === "object" ? Object.keys(row as Record<string, unknown>) : [])));
    const rows = parsed.filter((row) => row && typeof row === "object") as Array<Record<string, unknown>>;
    return { fileName: file.name, rowCount: rows.length, columns, preview: rows.slice(0, 30).map((row) => Object.fromEntries(columns.map((column) => [column, String(row[column] ?? "")]))), };
  }
  const rows = raw.split(/\r?\n/).filter((line) => line.trim()).map(parseCsvLine);
  if (rows.length < 2) throw new Error("CSV 또는 텍스트 파일에서 제목 행과 데이터 행을 찾지 못했습니다.");
  return rowsToAnalysis(file.name, rows);
}

function toNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.round(number) : null;
}

function safeAction(value: unknown): value is AssistantAction {
  if (!value || typeof value !== "object") return false;
  const action = value as Partial<AssistantAction>;
  return typeof action.id === "string" && ["UPDATE_HR_COMPENSATION_DEFAULTS", "CREATE_COMPENSATION_DRAFT"].includes(String(action.type)) && typeof action.title === "string" && typeof action.summary === "string" && typeof action.employeeId === "string" && typeof action.period === "string" && !!action.values && typeof action.values === "object";
}

function compactEmployee(record: EmployeeRecord) {
  return {
    employeeId: record.employeeId, name: record.name, department: record.department, position: record.position,
    jobTitle: record.jobTitle, status: record.status, joinDate: record.joinDate,
    retirement: record.retirement, annualSalary: record.annualSalary, basePay: record.basePay,
    mealAllowance: record.mealAllowance, childcareAllowance: record.childcareAllowance, vehicleAllowance: record.vehicleAllowance,
  };
}

export default function LocalCodexAssistant({ module }: { module: AssistantModule }) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [response, setResponse] = useState<AssistantResponse | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [applying, setApplying] = useState("");
  const [includeServerData, setIncludeServerData] = useState(false);
  const [fileAnalysis, setFileAnalysis] = useState<FileAnalysis | null>(null);
  const [fileStatus, setFileStatus] = useState("");
  const [period, setPeriod] = useState(currentPeriod);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [appliedActionIds, setAppliedActionIds] = useState<string[]>([]);
  const title = `${workspaceLabel[module]} AI 어시스턴트`;
  const suggestions = useMemo(() => suggestedQuestions[module], [module]);

  function close() { if (!submitting && !applying) setOpen(false); }

  async function loadContext() {
    const employeeResponse = await fetch("/api/hr/employee-records", { cache: "no-store" });
    const employeePayload = await employeeResponse.json().catch(() => ({})) as { records?: EmployeeRecord[]; error?: string };
    if (!employeeResponse.ok) throw new Error(employeePayload.error || "HR 인사기록을 불러오지 못했습니다.");
    const records = Array.isArray(employeePayload.records) ? employeePayload.records : [];
    setEmployees(records);
    const base = { employeeRecords: records.slice(0, 200).map(compactEmployee), employeeCount: records.length };
    if (module === "hr") {
      const operationsResponse = await fetch("/api/hr/operations", { cache: "no-store" });
      const operationsPayload = await operationsResponse.json().catch(() => ({})) as Record<string, unknown>;
      return { ...base, operations: operationsResponse.ok ? operationsPayload : { unavailable: true } };
    }
    const payrollResponse = await fetch(`/api/hr/compensation?period=${encodeURIComponent(period)}`, { cache: "no-store" });
    const payrollPayload = await payrollResponse.json().catch(() => ({})) as { run?: Record<string, unknown>; error?: string };
    if (!payrollResponse.ok && payrollResponse.status !== 404) throw new Error(payrollPayload.error || "임금 계산 초안을 불러오지 못했습니다.");
    const run = payrollPayload.run;
    return {
      ...base,
      payrollRun: run ? {
        period, status: run.status, version: run.version, employeeCount: run.employeeCount,
        employees: Array.isArray(run.employees) ? run.employees.slice(0, 200) : [],
        rows: Array.isArray(run.rows) ? run.rows.slice(0, 200) : [],
      } : { period, status: "NOT_CREATED" },
    };
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setFileStatus("파일을 이 브라우저에서 분석 중…");
    try {
      const analysis = await analyzeFile(file);
      setFileAnalysis(analysis);
      setFileStatus(`${analysis.fileName} · ${analysis.rowCount.toLocaleString("ko-KR")}행 · ${analysis.columns.length}개 열을 읽었습니다.`);
    } catch (caught) {
      setFileAnalysis(null);
      setFileStatus(caught instanceof Error ? caught.message : "파일을 읽지 못했습니다.");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = question.trim();
    if (!request || submitting) return;
    setSubmitting(true); setError(""); setNotice(""); setResponse(null); setAppliedActionIds([]);
    try {
      const liveData = includeServerData ? await loadContext() : { dataAccess: "not-requested" };
      const context = {
        module: workspaceLabel[module], period: module === "compensation" ? period : undefined,
        dataAccess: includeServerData ? "user-authorized-current-erp-data" : "not-requested",
        fileAnalysis: fileAnalysis ?? undefined,
        ...liveData,
      };
      const result = await fetch(`${bridgeUrl}/assistant`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module, question: request, context }),
      });
      const payload = await result.json().catch(() => ({})) as AssistantResponse & { error?: string };
      if (!result.ok) throw new Error(payload.error || "로컬 AI 어시스턴트에 연결하지 못했습니다.");
      if (!payload.answer) throw new Error("AI 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.");
      setResponse({ ...payload, proposedActions: (payload.proposedActions ?? []).filter(safeAction) });
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "알 수 없는 연결 오류입니다.";
      setError(`${detail} ERP 바로가기로 앱을 다시 실행한 뒤 재시도해 주세요.`);
    } finally { setSubmitting(false); }
  }

  async function applyAction(action: AssistantAction) {
    if (applying || appliedActionIds.includes(action.id)) return;
    const confirmation = action.type === "UPDATE_HR_COMPENSATION_DEFAULTS"
      ? `${action.title}\n\n이 변경안의 금액을 인사기록카드에 반영할까요? 기존 값이 덮어써집니다.`
      : `${action.title}\n\n${action.period} 임금 초안을 HR 기본값으로 다시 작성할까요? 기존 미확정 초안이 덮어써질 수 있습니다.`;
    if (!window.confirm(confirmation)) return;
    setApplying(action.id); setError(""); setNotice("");
    try {
      if (action.type === "UPDATE_HR_COMPENSATION_DEFAULTS") {
        const target = employees.find((employee) => employee.employeeId === action.employeeId);
        if (!target) throw new Error("적용할 직원을 현재 인사기록카드에서 찾지 못했습니다. 데이터 조회 권한을 켜고 다시 요청해 주세요.");
        const values = Object.fromEntries(moneyFields.flatMap((field) => {
          const amount = action.values[field];
          return amount === undefined || amount === null ? [] : [[field, toNumber(amount)]];
        }));
        if (!Object.values(values).length || Object.values(values).some((value) => value === null)) throw new Error("변경안에 유효하지 않은 금액이 있어 적용하지 않았습니다.");
        const update = await fetch("/api/hr/employee-records", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...target, ...values }) });
        const payload = await update.json().catch(() => ({})) as { record?: EmployeeRecord; error?: string };
        if (!update.ok) throw new Error(payload.error || "인사기록카드를 저장하지 못했습니다.");
        if (payload.record) setEmployees((current) => current.map((employee) => employee.employeeId === payload.record?.employeeId ? payload.record : employee));
      } else {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(action.period)) throw new Error("임금 초안 월 형식이 올바르지 않습니다.");
        const before = await fetch(`/api/hr/compensation?period=${encodeURIComponent(action.period)}`, { cache: "no-store" });
        const beforePayload = await before.json().catch(() => ({})) as { run?: { version?: number }; error?: string };
        if (!before.ok && before.status !== 404) throw new Error(beforePayload.error || "기존 임금안을 확인하지 못했습니다.");
        const update = await fetch("/api/hr/compensation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "LOAD_HR", period: action.period, version: beforePayload.run?.version }) });
        const payload = await update.json().catch(() => ({})) as { error?: string };
        if (!update.ok) throw new Error(payload.error || "임금 초안을 작성하지 못했습니다.");
      }
      setAppliedActionIds((current) => [...current, action.id]);
      setNotice("변경안이 기존 ERP API를 통해 반영되었습니다. 해당 탭을 새로고침해 결과를 확인해 주세요.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "변경안을 반영하지 못했습니다."); }
    finally { setApplying(""); }
  }

  return <>
    <button type="button" className="local-codex-assistant-trigger" onClick={() => setOpen(true)} aria-label={`${title} 열기`} title={title}><span aria-hidden="true">✦</span><small>AI</small></button>
    {open && <div className="local-codex-assistant-backdrop" role="presentation" onMouseDown={close}>
      <section className="local-codex-assistant-dialog" role="dialog" aria-modal="true" aria-labelledby="local-codex-assistant-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><p>LOCAL CODEX · TERRA</p><h2 id="local-codex-assistant-title">{title}</h2><span>Medium · 조회·분석·확인 후 반영</span></div><button type="button" className="local-codex-assistant-close" onClick={close} aria-label="대화창 닫기">×</button></header>
        <div className="local-codex-assistant-body">
          <p className="local-codex-assistant-notice">모델은 `gpt-5.6-terra` · Medium으로 실행됩니다. 현재 ERP 데이터를 포함하려면 아래 동의를 켜야 하며, Codex 응답은 변경안을 제시할 뿐 적용은 항상 별도 확인이 필요합니다.</p>
          <label className="local-codex-data-consent"><input type="checkbox" checked={includeServerData} onChange={(event) => setIncludeServerData(event.target.checked)} disabled={submitting} /><span>현재 HR·임금 계산 데이터를 Codex 분석에 포함하는 데 동의합니다.</span></label>
          <div className="local-codex-file">
            <label className={`local-codex-file-picker${fileAnalysis ? " selected" : ""}${submitting ? " disabled" : ""}`}>
              <input type="file" accept=".xlsx,.csv,.json,.txt,.pdf,.docx" onChange={handleFile} disabled={submitting} />
              <span className="local-codex-file-icon" aria-hidden="true">⌁</span>
              <span className="local-codex-file-copy"><b>{fileAnalysis ? fileAnalysis.fileName : "분석할 파일 첨부"}</b><small>{fileAnalysis ? `${fileAnalysis.rowCount.toLocaleString("ko-KR")}행 · ${fileAnalysis.columns.length}개 열` : "XLSX · CSV · JSON · TXT · PDF · DOCX"}</small></span>
              <span className="local-codex-file-action">{fileAnalysis ? "분석 완료" : "파일 선택"}</span>
            </label>
            {fileStatus && <small className="local-codex-file-status" role="status">{fileStatus}</small>}
            {fileAnalysis && <button type="button" onClick={() => { setFileAnalysis(null); setFileStatus(""); }} disabled={submitting}>파일 제외</button>}
          </div>
          {module === "compensation" && <label className="local-codex-period"><span>임금 초안 대상 월</span><input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} disabled={submitting} /></label>}
          <div className="local-codex-assistant-suggestions" aria-label="추천 질문">{suggestions.map((item) => <button type="button" key={item} onClick={() => setQuestion(item)} disabled={submitting}>{item}</button>)}</div>
          <form onSubmit={submit}><label htmlFor="local-codex-question">무엇을 도와드릴까요?</label><textarea id="local-codex-question" value={question} maxLength={2000} onChange={(event) => setQuestion(event.target.value)} placeholder="예: 올린 파일을 인사기록카드의 급여 기본값과 대조하고, 반영할 변경안을 만들어줘." disabled={submitting} /><div className="local-codex-assistant-form-footer"><span>{question.length.toLocaleString("ko-KR")} / 2,000</span><button type="submit" disabled={!question.trim() || submitting}>{submitting ? "Codex가 검토 중…" : "요청하기"}</button></div></form>
          {error && <p className="local-codex-assistant-error" role="alert">{error}</p>}{notice && <p className="local-codex-assistant-success">{notice}</p>}
          {response && <article className="local-codex-assistant-answer"><p className="local-codex-assistant-answer-label">CODEX 답변</p><p>{response.answer}</p>{response.cautions && response.cautions.length > 0 && <div><strong>유의사항</strong><ul>{response.cautions.map((item) => <li key={item}>{item}</li>)}</ul></div>}{response.nextSteps && response.nextSteps.length > 0 && <div><strong>다음 단계</strong><ul>{response.nextSteps.map((item) => <li key={item}>{item}</li>)}</ul></div>}{response.proposedActions && response.proposedActions.length > 0 && <div className="local-codex-actions"><strong>반영 전 변경안</strong>{response.proposedActions.map((action) => <article key={action.id}><div><b>{action.title}</b><p>{action.summary}</p>{action.type === "UPDATE_HR_COMPENSATION_DEFAULTS" && <ul>{moneyFields.filter((field) => action.values[field] !== undefined && action.values[field] !== null).map((field) => <li key={field}>{moneyLabels[field]}: {Number(action.values[field]).toLocaleString("ko-KR")}원</li>)}</ul>}{action.type === "CREATE_COMPENSATION_DRAFT" && <small>{action.period} 임금 초안 작성</small>}</div><button type="button" onClick={() => void applyAction(action)} disabled={Boolean(applying) || appliedActionIds.includes(action.id)}>{appliedActionIds.includes(action.id) ? "반영 완료" : applying === action.id ? "반영 중…" : "내용 확인 후 반영"}</button></article>)}</div>}</article>}
        </div>
      </section>
    </div>}
  </>;
}
