"use client";

import { ChangeEvent, FormEvent, useMemo, useState } from "react";
import readXlsxFile from "read-excel-file/browser";
import { calculateCompensation, type CompensationColumns, type CompensationEmployee, type CompensationRounding } from "./compensation-calculation";

type AssistantModule = "hr" | "compensation" | "sales";
type MoneyField = "annualSalary" | "basePay" | "mealAllowance" | "childcareAllowance" | "vehicleAllowance";

type EmployeeRecord = {
  employeeId: string; name: string; birth: string; email: string; phone: string; address: string;
  department: string; manager: string; type: string; joinDate: string; position: string; jobTitle: string;
  status: string; history: unknown[]; retirement: unknown; annualSalary: number; basePay: number;
  mealAllowance: number; childcareAllowance: number; vehicleAllowance: number; updatedAt: number;
};

type AssistantAction = {
  id: string; type: "UPDATE_HR_COMPENSATION_DEFAULTS" | "CREATE_COMPENSATION_DRAFT" | "CREATE_RECRUITMENT_APPLICANT" | "RECORD_INTERVIEW_REJECTION" | "CREATE_RECRUITMENT_OFFER";
  title: string; summary: string; employeeId: string; period: string; values: Partial<Record<MoneyField, number | null>>;
  applicant: { name: string | null; role: string | null; experience: string | null; email: string | null; phone: string | null; source: string | null; summary: string | null; ownerId: string | null; requisitionId: string | null; resumeFileName: string | null } | null;
  interviewResult: { applicantId: string | null; outcome: "REJECT" | "NO_SHOW" | null; memo: string | null } | null;
  offer: { applicantId: string | null; proposedTitle: string | null; department: string | null; employmentType: string | null; startDate: string | null; annualSalary: number | null; probationMonths: number | null; notes: string | null } | null;
};

type AssistantResponse = {
  answer: string;
  cautions?: string[];
  nextSteps?: string[];
  interviewQuestions?: InterviewQuestion[];
  proposedActions?: AssistantAction[];
};

/** 면접 질문. 예전에는 nextSteps 한 줄에 1,000자가 넘게 뭉쳐 들어가 읽을 수 없었다.
 *  분류·질문·확인 포인트로 나눠 받아 화면에서 묶어 보여 준다. */
type InterviewQuestion = { category: string; question: string; checkpoint: string };

const interviewCategoryLabels: Record<string, string> = {
  RESUME_CHECK: "이력서 근거 확인",
  ROLE_SKILL: "지원 직무 역량",
  COUNTER_ROLE_SKILL: "역제안 직무 역량",
  COUNTER_FIT: "역제안 타당성",
  BUSINESS_SCENARIO: "XD NODE 사업 시나리오",
  COLLABORATION: "협업·문제해결",
};
const interviewCategoryOrder = ["RESUME_CHECK", "ROLE_SKILL", "COUNTER_ROLE_SKILL", "COUNTER_FIT", "BUSINESS_SCENARIO", "COLLABORATION"];

type FileAnalysis = { fileName: string; rowCount: number; columns: string[]; preview: Array<Record<string, string>>; extractedText?: string };
type RecruitmentApplicant = { id: string; name: string; role: string; applied: string; ownerId: string; owner: string; stage: string; experience: string; email: string; phone: string; source: string; summary: string; resumeFileName: string; resumeText: string; checklist: unknown[]; screeningMemos: unknown[]; interview?: unknown; interviewMemos: unknown[]; requisitionId: string; offer?: { id: string; status: string; proposedTitle?: string; department?: string; employmentType?: string; startDate?: string; annualSalary?: number; probationMonths?: number; notes?: string } };
type CompensationRun = { period: string; status: string; version: number; employeeCount: number; grossPay: number; updatedAt?: number; employees: CompensationEmployee[]; settings?: { rounding?: CompensationRounding; columns?: Partial<CompensationColumns> } };
type IncentiveDeal = { id: string; person: string; personId: string; date: string; salesInvoiceDate: string; client: string; item: string; quantity: number; unitCost: number; unitSale: number; expense: number; kind: string; excluded: boolean };

// 어시스턴트 질문은 ERP 서버의 /api/assistant 로 보낸다. 서버가 데스크탑 안의 Claude CLI 다리
// (scripts/claude-assistant-bridge.mjs)를 대신 부른다. 예전처럼 브라우저가 로컬 다리를 직접 부르면
// 태블릿 등 다른 기기에서는 그 기기 자신을 가리켜 항상 실패했다.
const assistantEndpoint = "/api/assistant";
const moneyFields: MoneyField[] = ["annualSalary", "basePay", "mealAllowance", "childcareAllowance", "vehicleAllowance"];
const moneyLabels: Record<MoneyField, string> = { annualSalary: "연봉", basePay: "기본급", mealAllowance: "식대", childcareAllowance: "육아수당", vehicleAllowance: "자가운전수당" };

const workspaceLabel: Record<AssistantModule, string> = { hr: "HR", compensation: "임금 계산", sales: "영업·인센티브" };
const suggestedQuestions: Record<AssistantModule, string[]> = {
  hr: ["면접 예정자를 확인해줘.", "첨부한 이력서와 지원 포지션을 바탕으로 맞춤 면접 질문 리스트를 만들어줘.", "첨부한 이력서를 분석해 지원자 등록 변경안을 만들어줘.", "면접 결과를 탈락으로 기록할 변경안을 만들어줘.", "면접 합격자의 처우 오퍼 변경안을 만들어줘."],
  compensation: ["급여 확정 전에 누락 수당과 퇴직자 반영 여부를 점검해줘.", "전월 대비 지급액이 크게 바뀐 인원을 확인해줘.", "HR 기본값으로 이번 달 임금 초안을 만들어줘."],
  sales: ["현재 인센티브 거래에서 확인이 필요한 항목을 보여줘.", "담당자별 매출·마진·인센티브 차이를 분석해줘.", "인센티브 미반영 및 마진율 기준 미달 거래를 정리해줘."],
};

const companyInterviewContext = {
  company: "XD NODE",
  business: [
    "AI 사업을 중심으로 한 B2B 영업과 고객 관리",
    "AI·GPU 서버와 고성능 IT 인프라의 제안·조달·납품·기술지원",
    "온라인 채널 및 마케팅 운영",
  ],
  operatingModel: "구매·AI사업 영업·온라인 마케팅·기술지원·경영/영업지원 조직이 견적, 원가·마진, 납기, 고객지원 흐름을 함께 운영합니다.",
  roleFocus: {
    영업: ["고객 요구사항 파악", "솔루션 제안", "마진·수익성", "계약·납기·수금 관리"],
    구매: ["벤더·조달", "원가·납기", "호환성 확인", "재고·리스크 관리"],
    마케팅: ["온라인 채널", "캠페인 성과", "콘텐츠", "리드 전환"],
    기술지원: ["AI·GPU 인프라 이해", "구성·호환성", "구축·장애 대응", "고객 커뮤니케이션"],
    영업지원: ["견적·주문 문서", "납기·수금 지원", "데이터 정확성", "부서 협업"],
    경영지원: ["인사·총무 운영", "정확한 기록", "내부통제", "기밀 정보 취급"],
  },
  interviewGuardrails: "출신, 나이, 가족, 혼인·임신, 종교, 건강, 장애, 정치성향 등 직무와 무관한 민감한 개인정보를 질문하거나 평가 근거로 삼지 않습니다.",
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
  return { fileName, rowCount: lines.length, columns: ["추출 텍스트"], preview: lines.slice(0, 30).map((line) => ({ "추출 텍스트": line })), extractedText: text.slice(0, 24_000) };
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
  return typeof action.id === "string" && ["UPDATE_HR_COMPENSATION_DEFAULTS", "CREATE_COMPENSATION_DRAFT", "CREATE_RECRUITMENT_APPLICANT", "RECORD_INTERVIEW_REJECTION", "CREATE_RECRUITMENT_OFFER"].includes(String(action.type)) && typeof action.title === "string" && typeof action.summary === "string" && typeof action.employeeId === "string" && typeof action.period === "string" && !!action.values && typeof action.values === "object";
}

function compactEmployee(record: EmployeeRecord) {
  return {
    employeeId: record.employeeId, name: record.name, department: record.department, position: record.position,
    jobTitle: record.jobTitle, status: record.status, joinDate: record.joinDate,
    retirement: record.retirement, annualSalary: record.annualSalary, basePay: record.basePay,
    mealAllowance: record.mealAllowance, childcareAllowance: record.childcareAllowance, vehicleAllowance: record.vehicleAllowance,
  };
}

function previousPeriod(period: string) {
  const [year, month] = period.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 2, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function compactCompensationRun(run: CompensationRun | null, period: string) {
  if (!run) return { period, status: "NOT_CREATED" };
  const [year, month] = period.split("-").map(Number);
  const columns: CompensationColumns = {
    research: run.settings?.columns?.research ?? true, extra: run.settings?.columns?.extra ?? true,
    welfare: run.settings?.columns?.welfare ?? false, severance: run.settings?.columns?.severance ?? true,
    deduction: run.settings?.columns?.deduction ?? false, annualLeave: run.settings?.columns?.annualLeave ?? false,
    personalExpense: run.settings?.columns?.personalExpense ?? false,
  };
  return {
    period, status: run.status, version: run.version, employeeCount: run.employeeCount, grossPay: run.grossPay, updatedAt: run.updatedAt,
    rows: run.employees.slice(0, 200).map((employee) => {
      const row = calculateCompensation(employee, year, month, run.settings?.rounding ?? "round", columns);
      return {
        employeeId: employee.id, name: employee.name, department: employee.department, joinDate: employee.joinDate, leaveDate: employee.leaveDate,
        days: row.days, annualSalary: employee.annualSalary, basic: row.basic, meal: row.meal, car: row.car, child: row.child,
        incentive: row.incentive, bonus: row.bonus, extra: row.extra, research: row.research, severance: row.severance,
        annualLeave: row.annualLeave, personalExpense: row.personalExpense, deduction: row.deduction, total: row.total,
        warnings: [row.days === 0 ? "해당 월 지급 대상 아님" : "", row.probationWithoutJoin ? "수습 기간은 있으나 입사일 미입력" : "", row.mixedProbation ? "수습 종료월 일할 계산" : ""].filter(Boolean),
      };
    }),
  };
}

function localJson<T>(key: string, fallback: T): T {
  try {
    if (typeof window === "undefined") return fallback;
    const value = window.localStorage.getItem(key);
    return value ? JSON.parse(value) as T : fallback;
  } catch { return fallback; }
}

function salesIncentiveContext() {
  const deals = localJson<IncentiveDeal[]>("xdnode-incentive-deals-v1", []);
  const config = localJson<{ hurdleRate?: number; payoutRate?: number; cableMode?: string; rounding?: string }>("xdnode-incentive-config-v1", {});
  const excludedPeople = new Set(localJson<string[]>("xdnode-incentive-excluded-people-v1", []));
  const hurdleRate = Number(config.hurdleRate ?? 5);
  const payoutRate = Number(config.payoutRate ?? 5);
  const rows = deals.slice(0, 250).map((deal) => {
    const sales = Number(deal.quantity ?? 0) * Number(deal.unitSale ?? 0);
    const margin = sales - Number(deal.quantity ?? 0) * Number(deal.unitCost ?? 0) - Number(deal.expense ?? 0);
    const threshold = sales * hurdleRate / 100;
    const excludedByPerson = excludedPeople.has(deal.personId || `unresolved:${deal.person}`);
    return { id: deal.id, person: deal.person, personId: deal.personId, client: deal.client, item: deal.item, kind: deal.kind, date: deal.date,
      sales, margin, marginRate: sales ? Number((margin / sales * 100).toFixed(2)) : 0, threshold,
      incentive: deal.excluded || excludedByPerson || sales <= 0 ? 0 : Math.max((margin - threshold) * payoutRate / 100, 0),
      excluded: deal.excluded || excludedByPerson, needsReview: !deal.personId || (sales > 0 && margin / sales < hurdleRate) };
  });
  const summary = new Map<string, { person: string; sales: number; margin: number; incentive: number; count: number; needsReview: number }>();
  for (const row of rows) {
    const key = row.personId || `unresolved:${row.person}`;
    const current = summary.get(key) ?? { person: row.person, sales: 0, margin: 0, incentive: 0, count: 0, needsReview: 0 };
    current.sales += row.sales; current.margin += row.margin; current.incentive += row.incentive; current.count += 1; current.needsReview += Number(row.needsReview);
    summary.set(key, current);
  }
  return {
    source: "현재 브라우저에 저장된 인센티브 계산 거래", config: { hurdleRate, payoutRate, cableMode: config.cableMode ?? "deduct", rounding: config.rounding ?? "none" },
    dealCount: deals.length, truncated: deals.length > rows.length, excludedPersonCount: excludedPeople.size,
    summary: [...summary.values()].sort((a, b) => b.incentive - a.incentive),
    reviewRows: rows.filter((row) => row.needsReview || row.kind === "케이블" || row.excluded).slice(0, 100),
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
  const [targetPosition, setTargetPosition] = useState("");
  const [period, setPeriod] = useState(currentPeriod);
  const [employees, setEmployees] = useState<EmployeeRecord[]>([]);
  const [recruitmentApplicants, setRecruitmentApplicants] = useState<RecruitmentApplicant[]>([]);
  const [recruiterIds, setRecruiterIds] = useState<string[]>([]);
  const [appliedActionIds, setAppliedActionIds] = useState<string[]>([]);
  const title = `${workspaceLabel[module]} AI 어시스턴트`;
  const suggestions = useMemo(() => suggestedQuestions[module], [module]);

  function close() { if (!submitting && !applying) setOpen(false); }

  async function loadContext() {
    if (module === "sales") {
      const salesResponse = await fetch("/api/sales", { cache: "no-store" });
      const salesPayload = await salesResponse.json().catch(() => ({})) as { accounts?: unknown[]; opportunities?: unknown[]; documents?: unknown[]; incentiveRules?: unknown[]; error?: string };
      if (!salesResponse.ok) throw new Error(salesPayload.error || "영업 데이터를 불러오지 못했습니다.");
      return {
        sales: {
          accountCount: salesPayload.accounts?.length ?? 0,
          opportunities: (salesPayload.opportunities ?? []).slice(0, 200),
          documents: (salesPayload.documents ?? []).slice(0, 200),
          incentiveRules: salesPayload.incentiveRules ?? [],
        },
        incentiveCalculator: salesIncentiveContext(),
      };
    }
    const employeeResponse = await fetch("/api/hr/employee-records", { cache: "no-store" });
    const employeePayload = await employeeResponse.json().catch(() => ({})) as { records?: EmployeeRecord[]; error?: string };
    if (!employeeResponse.ok) throw new Error(employeePayload.error || "HR 인사기록을 불러오지 못했습니다.");
    const records = Array.isArray(employeePayload.records) ? employeePayload.records : [];
    setEmployees(records);
    const base = { employeeRecords: records.slice(0, 200).map(compactEmployee), employeeCount: records.length };
    if (module === "hr") {
      const [operationsResponse, recruitmentResponse] = await Promise.all([
        fetch("/api/hr/operations", { cache: "no-store" }),
        fetch("/api/hr/recruitment", { cache: "no-store" }),
      ]);
      const operationsPayload = await operationsResponse.json().catch(() => ({})) as Record<string, unknown>;
      const recruitmentPayload = await recruitmentResponse.json().catch(() => ({})) as { applicants?: RecruitmentApplicant[]; recruiterIds?: string[]; requisitions?: Array<{ id: string; title: string; role: string; organizationId: string; requestedHeadcount: number; status: string }>; error?: string };
      if (!recruitmentResponse.ok) throw new Error(recruitmentPayload.error || "채용 지원자 데이터를 불러오지 못했습니다.");
      const applicants = Array.isArray(recruitmentPayload.applicants) ? recruitmentPayload.applicants : [];
      const currentRecruiterIds = Array.isArray(recruitmentPayload.recruiterIds) ? recruitmentPayload.recruiterIds : [];
      setRecruitmentApplicants(applicants);
      setRecruiterIds(currentRecruiterIds);
      return {
        ...base,
        operations: operationsResponse.ok ? operationsPayload : { unavailable: true },
        recruitment: {
          applicantCount: applicants.length,
          recruiters: currentRecruiterIds.map((id) => ({ id, name: records.find((employee) => employee.employeeId === id)?.name ?? "미지정" })),
          requisitions: (recruitmentPayload.requisitions ?? []).filter((item) => item.status === "OPEN"),
          applicants: applicants.slice(0, 200).map((applicant) => ({
            id: applicant.id, name: applicant.name, role: applicant.role, stage: applicant.stage,
            experience: applicant.experience, email: applicant.email, phone: applicant.phone, source: applicant.source,
            summary: applicant.summary, ownerId: applicant.ownerId, owner: applicant.owner, requisitionId: applicant.requisitionId,
            interview: applicant.interview, interviewMemos: applicant.interviewMemos.slice(0, 5), offer: applicant.offer,
          })),
        },
      };
    }
    const prior = previousPeriod(period);
    const [payrollResponse, priorPayrollResponse] = await Promise.all([
      fetch(`/api/hr/compensation?period=${encodeURIComponent(period)}`, { cache: "no-store" }),
      fetch(`/api/hr/compensation?period=${encodeURIComponent(prior)}`, { cache: "no-store" }),
    ]);
    const payrollPayload = await payrollResponse.json().catch(() => ({})) as { run?: CompensationRun; error?: string };
    const priorPayrollPayload = await priorPayrollResponse.json().catch(() => ({})) as { run?: CompensationRun; error?: string };
    if (!payrollResponse.ok && payrollResponse.status !== 404) throw new Error(payrollPayload.error || "임금 계산 초안을 불러오지 못했습니다.");
    if (!priorPayrollResponse.ok && priorPayrollResponse.status !== 404) throw new Error(priorPayrollPayload.error || "전월 임금안을 불러오지 못했습니다.");
    return {
      ...base,
      payrollRun: compactCompensationRun(payrollPayload.run ?? null, period),
      priorPayrollRun: compactCompensationRun(priorPayrollPayload.run ?? null, prior),
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
        fileAnalysis: includeServerData ? fileAnalysis ?? undefined : undefined,
        interviewBrief: module === "hr" ? {
          targetPosition: targetPosition.trim() || null,
          companyBusinessProfile: companyInterviewContext,
        } : undefined,
        ...liveData,
      };
      const result = await fetch(assistantEndpoint, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ module, question: request, context }),
      });
      const payload = await result.json().catch(() => ({})) as AssistantResponse & { error?: string };
      if (!result.ok) throw new Error(payload.error || "AI 어시스턴트에 연결하지 못했습니다.");
      if (!payload.answer) throw new Error("AI 응답 형식이 올바르지 않습니다. 다시 시도해 주세요.");
      setResponse({ ...payload, proposedActions: (payload.proposedActions ?? []).filter(safeAction) });
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : "알 수 없는 연결 오류입니다.";
      setError(detail);
    } finally { setSubmitting(false); }
  }

  /** 면접관에게 그대로 넘길 수 있게 분류·질문·확인 포인트를 한 벌로 복사한다. */
  async function copyQuestions(items: InterviewQuestion[]) {
    const text = interviewCategoryOrder
      .map((key) => [key, items.filter((item) => item.category === key)] as const)
      .filter(([, group]) => group.length > 0)
      .map(([key, group]) => [`[${interviewCategoryLabels[key] ?? key}]`,
        ...group.map((item, index) => `${index + 1}. ${item.question}\n   → 확인 포인트: ${item.checkpoint}`)].join("\n"))
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      setNotice("면접 질문을 복사했습니다.");
    } catch {
      setError("복사하지 못했습니다. 질문을 직접 선택해 복사해 주세요.");
    }
  }

  async function applyAction(action: AssistantAction) {
    if (applying || appliedActionIds.includes(action.id)) return;
    const confirmation = action.type === "UPDATE_HR_COMPENSATION_DEFAULTS"
      ? `${action.title}\n\n이 변경안의 금액을 인사기록카드에 반영할까요? 기존 값이 덮어써집니다.`
      : action.type === "CREATE_COMPENSATION_DRAFT"
        ? `${action.title}\n\n${action.period} 임금 초안을 HR 기본값으로 다시 작성할까요? 기존 미확정 초안이 덮어써질 수 있습니다.`
        : action.type === "CREATE_RECRUITMENT_APPLICANT"
          ? `${action.title}\n\n이력서에서 추출한 정보와 이력서 텍스트를 새 지원자로 등록할까요?`
          : action.type === "RECORD_INTERVIEW_REJECTION"
            ? `${action.title}\n\n면접 결과를 탈락으로 기록할까요? 이 변경은 지원자 단계와 면접 메모에 반영됩니다.`
            : `${action.title}\n\n처우 오퍼를 생성할까요? 지원자 수락·사번 발급·입사 전환은 이 작업에 포함되지 않습니다.`;
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
      } else if (action.type === "CREATE_COMPENSATION_DRAFT") {
        if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(action.period)) throw new Error("임금 초안 월 형식이 올바르지 않습니다.");
        const before = await fetch(`/api/hr/compensation?period=${encodeURIComponent(action.period)}`, { cache: "no-store" });
        const beforePayload = await before.json().catch(() => ({})) as { run?: { version?: number }; error?: string };
        if (!before.ok && before.status !== 404) throw new Error(beforePayload.error || "기존 임금안을 확인하지 못했습니다.");
        const update = await fetch("/api/hr/compensation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "LOAD_HR", period: action.period, version: beforePayload.run?.version }) });
        const payload = await update.json().catch(() => ({})) as { error?: string };
        if (!update.ok) throw new Error(payload.error || "임금 초안을 작성하지 못했습니다.");
      } else if (action.type === "CREATE_RECRUITMENT_APPLICANT") {
        const applicant = action.applicant;
        if (!applicant?.name?.trim() || !applicant.role?.trim() || !applicant.email?.trim()) throw new Error("지원자 등록에는 이름·지원 직무·이메일이 필요합니다.");
        if (!fileAnalysis?.extractedText?.trim()) throw new Error("이력서의 추출 텍스트가 없습니다. PDF, DOCX 또는 TXT 이력서를 다시 첨부해 주세요.");
        const normalizedEmail = applicant.email.trim().toLocaleLowerCase();
        const normalizedPhone = applicant.phone?.replace(/[^0-9]/g, "") ?? "";
        const duplicate = recruitmentApplicants.find((item) => item.email.toLocaleLowerCase() === normalizedEmail
          || (normalizedPhone.length >= 8 && item.phone.replace(/[^0-9]/g, "") === normalizedPhone));
        if (duplicate) throw new Error(`${duplicate.name} 지원자가 같은 이메일 또는 연락처로 이미 등록되어 있습니다.`);
        const ownerId = applicant.ownerId?.trim() || recruiterIds[0] || "";
        const owner = employees.find((employee) => employee.employeeId === ownerId)?.name ?? "미지정";
        const newApplicant: RecruitmentApplicant = {
          id: `AP-${Date.now()}`, name: applicant.name.trim(), role: applicant.role.trim(),
          applied: new Date().toISOString().slice(0, 10).replaceAll("-", "."), ownerId, owner, stage: "서류 검토",
          experience: applicant.experience?.trim() ?? "", email: applicant.email.trim(), phone: applicant.phone?.trim() ?? "",
          source: applicant.source?.trim() || "이력서 내용 추출", summary: applicant.summary?.trim() ?? "",
          resumeFileName: applicant.resumeFileName?.trim() || fileAnalysis.fileName, resumeText: fileAnalysis.extractedText.slice(0, 30_000),
          checklist: [], screeningMemos: [], interviewMemos: [], requisitionId: applicant.requisitionId?.trim() ?? "",
        };
        const update = await fetch("/api/hr/recruitment", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(newApplicant) });
        const payload = await update.json().catch(() => ({})) as { error?: string };
        if (!update.ok) throw new Error(payload.error || "지원자를 등록하지 못했습니다.");
        setRecruitmentApplicants((current) => [newApplicant, ...current]);
      } else if (action.type === "RECORD_INTERVIEW_REJECTION") {
        const result = action.interviewResult;
        if (!result?.applicantId || !result.outcome) throw new Error("면접 결과 대상과 결과값을 확인하지 못했습니다.");
        const target = recruitmentApplicants.find((item) => item.id === result.applicantId);
        if (!target) throw new Error("현재 지원자 목록에서 면접 결과를 반영할 대상을 찾지 못했습니다. 데이터 동의를 켜고 다시 요청해 주세요.");
        const note = `${result.outcome === "NO_SHOW" ? "면접 불참(탈락)" : "면접 결과(탈락)"}${result.memo?.trim() ? `: ${result.memo.trim()}` : ""}`;
        const updated: RecruitmentApplicant = { ...target, stage: result.outcome === "NO_SHOW" ? "면접 불참 탈락" : "면접 후 탈락", interviewMemos: [{ id: `IN-${Date.now()}`, text: note, author: target.owner || "담당자 미지정", createdAt: new Date().toISOString() }, ...(target.interviewMemos ?? [])] };
        const update = await fetch("/api/hr/recruitment", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updated) });
        const payload = await update.json().catch(() => ({})) as { error?: string };
        if (!update.ok) throw new Error(payload.error || "면접 탈락 결과를 저장하지 못했습니다.");
        setRecruitmentApplicants((current) => current.map((item) => item.id === updated.id ? updated : item));
      } else {
        const offer = action.offer;
        if (!offer?.applicantId || !offer.proposedTitle?.trim() || !offer.department?.trim() || !offer.employmentType?.trim()
          || !/^\d{4}-\d{2}-\d{2}$/.test(offer.startDate ?? "") || !Number.isFinite(offer.annualSalary) || Number(offer.annualSalary) <= 0
          || !Number.isInteger(offer.probationMonths) || Number(offer.probationMonths) < 0 || Number(offer.probationMonths) > 12) throw new Error("처우 오퍼의 대상·직무·소속·고용형태·입사예정일·연봉·수습기간을 확인해 주세요.");
        const target = recruitmentApplicants.find((item) => item.id === offer.applicantId);
        if (!target) throw new Error("현재 지원자 목록에서 처우 오퍼 대상을 찾지 못했습니다. 데이터 동의를 켜고 다시 요청해 주세요.");
        const create = await fetch("/api/hr/recruitment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource: "offer", applicantId: offer.applicantId, proposedTitle: offer.proposedTitle.trim(), department: offer.department.trim(), employmentType: offer.employmentType.trim(), startDate: offer.startDate, annualSalary: Math.round(Number(offer.annualSalary)), probationMonths: Number(offer.probationMonths), notes: offer.notes?.trim() ?? "" }) });
        const payload = await create.json().catch(() => ({})) as { offer?: { id: string; status: string }; error?: string };
        if (!create.ok || !payload.offer) throw new Error(payload.error || "처우 오퍼를 저장하지 못했습니다.");
        const interviewMemo = { id: `IN-${Date.now()}`, text: `면접 결과(합격) · 처우 오퍼 생성: ${offer.proposedTitle.trim()} / 연봉 ${Number(offer.annualSalary).toLocaleString("ko-KR")}원${offer.notes?.trim() ? ` · ${offer.notes.trim()}` : ""}`, author: target.owner || "담당자 미지정", createdAt: new Date().toISOString() };
        const updated: RecruitmentApplicant = { ...target, stage: "면접 합격", interviewMemos: [interviewMemo, ...(target.interviewMemos ?? [])], offer: payload.offer };
        const memoUpdate = await fetch("/api/hr/recruitment", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updated) });
        const memoPayload = await memoUpdate.json().catch(() => ({})) as { error?: string };
        if (!memoUpdate.ok) throw new Error(`처우 오퍼는 생성됐지만 면접 결과 메모를 저장하지 못했습니다: ${memoPayload.error || "알 수 없는 오류"}`);
        setRecruitmentApplicants((current) => current.map((item) => item.id === updated.id ? updated : item));
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
        <header><div><p>LOCAL AI · CLAUDE</p><h2 id="local-codex-assistant-title">{title}</h2><span>Sonnet · Medium · 조회·분석 후 확인하고 반영</span></div><button type="button" className="local-codex-assistant-close" onClick={close} aria-label="대화창 닫기">×</button></header>
        <div className="local-codex-assistant-body">
          <p className="local-codex-assistant-notice">이 컴퓨터의 Claude(Sonnet · Medium)가 실행합니다. 현재 ERP 데이터나 첨부 이력서의 추출 텍스트를 포함하려면 아래 동의에 체크하세요. 변경안은 반드시 확인 후 직접 적용해야 반영됩니다.</p>
          <label className="local-codex-data-consent"><input type="checkbox" checked={includeServerData} onChange={(event) => setIncludeServerData(event.target.checked)} disabled={submitting} /><span>현재 HR·임금 계산 데이터와 첨부 파일의 추출 텍스트를 AI 분석에 포함하는 데 동의합니다.</span></label>
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
          {module === "hr" && <label className="local-codex-target-position"><span>지원 포지션</span><input value={targetPosition} maxLength={120} onChange={(event) => setTargetPosition(event.target.value)} placeholder="예: AI 인프라 기술영업 / 기술지원 / 온라인 마케팅" disabled={submitting} /><small>이력서와 함께 입력하면 XD NODE 사업·직무 흐름을 반영한 질문 리스트를 만듭니다.</small></label>}
          {module === "compensation" && <label className="local-codex-period"><span>임금 초안 대상 월</span><input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} disabled={submitting} /></label>}
          <div className="local-codex-assistant-suggestions" aria-label="추천 질문">{suggestions.map((item) => <button type="button" key={item} onClick={() => setQuestion(item)} disabled={submitting}>{item}</button>)}</div>
          <form onSubmit={submit}><label htmlFor="local-codex-question">무엇을 도와드릴까요?</label><textarea id="local-codex-question" value={question} maxLength={2000} onChange={(event) => setQuestion(event.target.value)} placeholder={module === "hr" ? "예: 첨부 이력서와 지원 포지션을 바탕으로 맞춤 면접 질문 리스트를 만들어줘." : "예: 올린 파일을 인사기록카드의 급여 기본값과 대조하고, 반영할 변경안을 만들어줘."} disabled={submitting} /><div className="local-codex-assistant-form-footer"><span>{question.length.toLocaleString("ko-KR")} / 2,000</span><button type="submit" disabled={!question.trim() || submitting}>{submitting ? "Claude가 검토 중…" : "요청하기"}</button></div></form>
          {error && <p className="local-codex-assistant-error" role="alert">{error}</p>}{notice && <p className="local-codex-assistant-success">{notice}</p>}
          {response && <article className="local-codex-assistant-answer">
            <p className="local-codex-assistant-answer-label">AI 답변</p><p>{response.answer}</p>
            {response.cautions && response.cautions.length > 0 && <div><strong>유의사항</strong><ul>{response.cautions.map((item) => <li key={item}>{item}</li>)}</ul></div>}
            {response.nextSteps && response.nextSteps.length > 0 && <div><strong>다음 단계</strong><ul>{response.nextSteps.map((item) => <li key={item}>{item}</li>)}</ul></div>}
            {response.interviewQuestions && response.interviewQuestions.length > 0 && <div className="local-codex-questions">
              <div className="local-codex-questions-head">
                <strong>맞춤 면접 질문</strong>
                <span>{response.interviewQuestions.length}개</span>
                <button type="button" onClick={() => void copyQuestions(response.interviewQuestions ?? [])}>질문 복사</button>
              </div>
              {interviewCategoryOrder
                .map((key) => [key, (response.interviewQuestions ?? []).filter((item) => item.category === key)] as const)
                .filter(([, items]) => items.length > 0)
                .map(([key, items]) => <section key={key} className="local-codex-question-group">
                  <h4>{interviewCategoryLabels[key] ?? key} <em>{items.length}</em></h4>
                  <ol>{items.map((item, index) => <li key={`${key}-${index}`}>
                    <p>{item.question}</p>
                    <small>확인 포인트 · {item.checkpoint}</small>
                  </li>)}</ol>
                </section>)}
            </div>}
            {response.proposedActions && response.proposedActions.length > 0 && <div className="local-codex-actions"><strong>반영 전 변경안</strong>
              {response.proposedActions.map((action) => <article key={action.id}><div><b>{action.title}</b><p>{action.summary}</p>
                {action.type === "UPDATE_HR_COMPENSATION_DEFAULTS" && <ul>{moneyFields.filter((field) => action.values[field] !== undefined && action.values[field] !== null).map((field) => <li key={field}>{moneyLabels[field]}: {Number(action.values[field]).toLocaleString("ko-KR")}원</li>)}</ul>}
                {action.type === "CREATE_COMPENSATION_DRAFT" && <small>{action.period} 임금 초안 작성</small>}
                {action.type === "CREATE_RECRUITMENT_APPLICANT" && action.applicant && <small>{action.applicant.name} · {action.applicant.role} · {action.applicant.email}<br />이력서: {action.applicant.resumeFileName}</small>}
                {action.type === "RECORD_INTERVIEW_REJECTION" && action.interviewResult && <small>{recruitmentApplicants.find((item) => item.id === action.interviewResult?.applicantId)?.name ?? "지원자"} · {action.interviewResult.outcome === "NO_SHOW" ? "면접 불참 탈락" : "면접 후 탈락"}</small>}
                {action.type === "CREATE_RECRUITMENT_OFFER" && action.offer && <small>{recruitmentApplicants.find((item) => item.id === action.offer?.applicantId)?.name ?? "지원자"} · {action.offer.proposedTitle} · 연봉 {Number(action.offer.annualSalary ?? 0).toLocaleString("ko-KR")}원<br />{action.offer.department} · {action.offer.startDate}</small>}
              </div><button type="button" onClick={() => void applyAction(action)} disabled={Boolean(applying) || appliedActionIds.includes(action.id)}>{appliedActionIds.includes(action.id) ? "반영 완료" : applying === action.id ? "반영 중…" : "내용 확인 후 반영"}</button></article>)}
            </div>}
          </article>}
        </div>
      </section>
    </div>}
  </>;
}
