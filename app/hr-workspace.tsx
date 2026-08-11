"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { companyEmployees, companyJobTitles, companyOrganizations, companyRanks } from "./hr-company-data";

export default function HRWorkspace() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<ShadowRoot | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    setRoot(hostRef.current.shadowRoot ?? hostRef.current.attachShadow({ mode: "open" }));
  }, []);

  return (
    <div className="peopleflow-host" ref={hostRef}>
      {root && createPortal(
        <>
          <link rel="stylesheet" href="/hr-workspace.css" />
          <XdnodeHrApp />
        </>,
        root,
      )}
    </div>
  );
}

type NavItem = {
  id: string;
  label: string;
  icon: string;
  badge?: string;
};

type ModuleConfig = {
  eyebrow: string;
  title: string;
  description: string;
  action: string;
  metrics: { label: string; value: string; note: string; tone?: string }[];
  columns: string[];
  rows: string[][];
};

const navGroups: { title: string; items: NavItem[] }[] = [
  {
    title: "업무 홈",
    items: [
      { id: "dashboard", label: "통합 대시보드", icon: "홈" },
      { id: "schedule", label: "일정·업무", icon: "일" },
    ],
  },
  {
    title: "인사 운영",
    items: [
      { id: "employees", label: "인사기록카드", icon: "인" },
      { id: "organization", label: "조직관리", icon: "조" },
      { id: "payroll", label: "급여관리", icon: "급" },
      { id: "onboarding", label: "입·퇴사 관리", icon: "온" },
      { id: "workforce", label: "인력계획·정원", icon: "계" },
    ],
  },
  {
    title: "채용",
    items: [
      { id: "recruitment", label: "지원자 관리", icon: "채" },
      { id: "interviews", label: "면접관리", icon: "면" },
    ],
  },
  {
    title: "성장과 분석",
    items: [
      { id: "performance", label: "성과·목표", icon: "목" },
      { id: "training", label: "교육·법정교육", icon: "교" },
      { id: "reports", label: "통계·리포트", icon: "분" },
    ],
  },
];

const demoModuleConfigs: Record<string, ModuleConfig> = {
  employees: {
    eyebrow: "PEOPLE DIRECTORY",
    title: "인사기록카드",
    description: "구성원의 기본정보와 인사 이력을 한곳에서 관리합니다.",
    action: "직원 등록",
    metrics: [
      { label: "전체 재직자", value: "128명", note: "지난달 대비 +3" },
      { label: "이번 달 입사", value: "4명", note: "입사 예정 2명", tone: "blue" },
      { label: "이번 달 퇴사", value: "1명", note: "퇴사율 0.8%", tone: "orange" },
      { label: "정보 미완료", value: "6명", note: "확인 필요", tone: "red" },
    ],
    columns: ["직원", "소속", "직급", "고용형태", "입사일", "상태"],
    rows: [
      ["김민준", "제품개발팀", "선임", "정규직", "2026.08.03", "재직"],
      ["이서연", "브랜드팀", "매니저", "정규직", "2024.11.18", "재직"],
      ["박지훈", "영업1팀", "책임", "정규직", "2022.04.11", "재직"],
      ["최유진", "경영지원팀", "사원", "계약직", "2026.07.20", "수습"],
      ["정하늘", "데이터팀", "선임", "정규직", "2023.02.06", "휴직"],
    ],
  },
  payroll: {
    eyebrow: "PAYROLL",
    title: "급여관리",
    description: "월별 급여 계산부터 검토, 명세서 발급까지 안전하게 처리합니다.",
    action: "8월 급여 계산",
    metrics: [
      { label: "8월 예상 인건비", value: "₩684M", note: "예산 대비 97.2%" },
      { label: "급여 대상", value: "128명", note: "변동자 12명", tone: "blue" },
      { label: "검토 대기", value: "8건", note: "8월 20일 마감", tone: "orange" },
      { label: "오류 항목", value: "2건", note: "수당 확인 필요", tone: "red" },
    ],
    columns: ["급여월", "대상 인원", "지급총액", "공제총액", "실지급액", "상태"],
    rows: [
      ["2026년 8월", "128명", "₩684,200,000", "₩86,480,000", "₩597,720,000", "작성중"],
      ["2026년 7월", "125명", "₩671,800,000", "₩84,910,000", "₩586,890,000", "마감"],
      ["2026년 6월", "123명", "₩658,430,000", "₩82,760,000", "₩575,670,000", "마감"],
      ["2026년 5월", "121명", "₩649,110,000", "₩81,320,000", "₩567,790,000", "마감"],
    ],
  },
  recruitment: {
    eyebrow: "RECRUITING PIPELINE",
    title: "지원자 관리",
    description: "공고별 지원자와 채용 단계를 놓치지 않고 이어갑니다.",
    action: "지원자 등록",
    metrics: [
      { label: "진행 중 공고", value: "6건", note: "신규 2건" },
      { label: "전체 지원자", value: "84명", note: "이번 주 +18", tone: "blue" },
      { label: "면접 예정", value: "9명", note: "오늘 3명", tone: "orange" },
      { label: "최종 합격", value: "3명", note: "입사 협의 중", tone: "green" },
    ],
    columns: ["지원자", "지원 직무", "지원일", "담당자", "현재 단계", "다음 일정"],
    rows: [
      ["윤서진", "백엔드 개발자", "08.09", "김지수", "2차 면접", "08.12 14:00"],
      ["한도윤", "프로덕트 디자이너", "08.08", "이수민", "과제 검토", "08.13 마감"],
      ["송예린", "B2B 영업", "08.07", "김지수", "처우 협의", "08.11 회신"],
      ["문지후", "데이터 분석가", "08.06", "박서준", "서류 검토", "-"],
      ["배하린", "HR 매니저", "08.05", "이수민", "1차 면접", "08.14 11:00"],
    ],
  },
  interviews: {
    eyebrow: "INTERVIEWS",
    title: "면접관리",
    description: "면접 일정, 면접관 배정, 평가 결과를 체계적으로 관리합니다.",
    action: "면접 등록",
    metrics: [
      { label: "오늘 면접", value: "3건", note: "대면 1 · 화상 2" },
      { label: "이번 주", value: "9건", note: "일정 확정 8건", tone: "blue" },
      { label: "평가 미제출", value: "4건", note: "면접관 알림 발송", tone: "orange" },
      { label: "평균 합격률", value: "31%", note: "최근 3개월", tone: "green" },
    ],
    columns: ["시간", "지원자", "직무", "면접 유형", "면접관", "상태"],
    rows: [
      ["오늘 10:30", "이현우", "프론트엔드 개발자", "1차 화상", "정우진 외 1명", "진행 완료"],
      ["오늘 14:00", "윤서진", "백엔드 개발자", "2차 대면", "최도영 외 2명", "예정"],
      ["오늘 16:30", "임채원", "콘텐츠 마케터", "1차 화상", "이서연", "예정"],
      ["내일 11:00", "박시우", "재무 담당자", "1차 대면", "김태호", "확정"],
    ],
  },
  onboarding: {
    eyebrow: "EMPLOYEE LIFECYCLE",
    title: "입·퇴사 관리",
    description: "입사 준비부터 퇴사 인수인계까지 체크리스트로 관리합니다.",
    action: "입사 예정자 등록",
    metrics: [
      { label: "입사 예정", value: "4명", note: "이번 달" },
      { label: "준비 완료", value: "2명", note: "완료율 50%", tone: "green" },
      { label: "퇴사 예정", value: "1명", note: "인수인계 진행 중", tone: "orange" },
      { label: "미완료 업무", value: "7건", note: "담당자 확인 필요", tone: "red" },
    ],
    columns: ["대상자", "구분", "예정일", "소속", "진행률", "담당자"],
    rows: [
      ["김민준", "입사", "08.17", "제품개발팀", "92%", "김지수"],
      ["조은채", "입사", "08.24", "브랜드팀", "67%", "이수민"],
      ["강준호", "입사", "09.01", "B2B영업팀", "35%", "김지수"],
      ["오세진", "퇴사", "08.31", "데이터팀", "58%", "박서준"],
    ],
  },
  schedule: {
    eyebrow: "HR CALENDAR",
    title: "일정·업무 관리",
    description: "반복되는 HR 일정과 담당 업무를 한눈에 확인합니다.",
    action: "일정 등록",
    metrics: [
      { label: "오늘 일정", value: "8건", note: "면접 3 · 회의 2" },
      { label: "이번 주 마감", value: "12건", note: "완료 5건", tone: "blue" },
      { label: "기한 초과", value: "3건", note: "즉시 확인 필요", tone: "red" },
      { label: "반복 업무", value: "16건", note: "이번 달", tone: "green" },
    ],
    columns: ["일정", "구분", "일시", "담당자", "관련 대상", "상태"],
    rows: [
      ["경영회의 인원현황 보고", "리포트", "오늘 09:30", "김지수", "전사", "완료"],
      ["백엔드 개발자 2차 면접", "면접", "오늘 14:00", "이수민", "윤서진", "예정"],
      ["개인정보보호 교육 독려", "교육", "오늘 16:00", "박서준", "미이수 11명", "진행중"],
      ["8월 급여 변동사항 마감", "급여", "08.14 18:00", "김지수", "변동 12명", "예정"],
    ],
  },
  performance: {
    eyebrow: "PERFORMANCE & OKR",
    title: "성과평가 및 목표관리",
    description: "조직 목표와 개인 목표를 연결하고 평가 진행률을 관리합니다.",
    action: "평가 주기 만들기",
    metrics: [
      { label: "평가 대상", value: "118명", note: "상반기 중간점검" },
      { label: "제출 완료", value: "94%", note: "111명 완료", tone: "green" },
      { label: "미제출", value: "7명", note: "마감 D-2", tone: "orange" },
      { label: "평균 목표 달성률", value: "76%", note: "전분기 대비 +4%", tone: "blue" },
    ],
    columns: ["조직", "평가 대상", "자기평가", "1차 평가", "목표 달성률", "진행상태"],
    rows: [
      ["제품개발본부", "42명", "100%", "88%", "81%", "진행중"],
      ["사업본부", "31명", "94%", "84%", "73%", "진행중"],
      ["브랜드본부", "24명", "96%", "92%", "78%", "진행중"],
      ["경영지원본부", "21명", "100%", "100%", "72%", "완료"],
    ],
  },
  training: {
    eyebrow: "LEARNING & COMPLIANCE",
    title: "교육 및 법정교육",
    description: "교육 과정, 수료 이력과 필수교육 이수율을 관리합니다.",
    action: "교육 과정 등록",
    metrics: [
      { label: "법정교육 이수율", value: "91%", note: "미이수 11명" },
      { label: "진행 중 과정", value: "5개", note: "이번 달 8개", tone: "blue" },
      { label: "총 교육시간", value: "486h", note: "1인 평균 3.8h", tone: "green" },
      { label: "마감 임박", value: "2개", note: "3일 이내", tone: "orange" },
    ],
    columns: ["교육 과정", "구분", "대상", "이수율", "마감일", "상태"],
    rows: [
      ["개인정보보호 교육", "법정교육", "전 직원", "91%", "08.13", "진행중"],
      ["직장 내 괴롭힘 예방", "법정교육", "전 직원", "100%", "07.31", "완료"],
      ["신임 리더 온보딩", "리더십", "신임 팀장 8명", "75%", "08.21", "진행중"],
      ["데이터 기반 의사결정", "직무교육", "희망자 24명", "58%", "08.28", "진행중"],
    ],
  },
  workforce: {
    eyebrow: "WORKFORCE PLANNING",
    title: "인력계획 및 정원 관리",
    description: "승인 정원과 현재·예상 인원을 비교해 채용 필요 인원을 계산합니다.",
    action: "인력계획 등록",
    metrics: [
      { label: "승인 정원", value: "142명", note: "2026년 하반기" },
      { label: "현재 인원", value: "128명", note: "정원 대비 90.1%", tone: "blue" },
      { label: "채용 진행", value: "8명", note: "6개 포지션", tone: "orange" },
      { label: "추가 필요", value: "6명", note: "3개 조직", tone: "red" },
    ],
    columns: ["조직", "승인 정원", "현재", "입사 예정", "채용 중", "충원 필요"],
    rows: [
      ["제품개발본부", "50명", "44명", "1명", "3명", "2명"],
      ["사업본부", "38명", "35명", "1명", "2명", "0명"],
      ["브랜드본부", "28명", "25명", "0명", "1명", "2명"],
      ["경영지원본부", "26명", "24명", "0명", "0명", "2명"],
    ],
  },
  reports: {
    eyebrow: "PEOPLE ANALYTICS",
    title: "통계·리포트",
    description: "인원, 채용, 인건비, 평가와 교육 데이터를 의사결정 자료로 만듭니다.",
    action: "리포트 만들기",
    metrics: [
      { label: "재직 인원", value: "128명", note: "전년 동기 대비 +12%" },
      { label: "연간 이직률", value: "8.4%", note: "목표 10% 이하", tone: "green" },
      { label: "평균 채용기간", value: "28일", note: "전분기 대비 -3일", tone: "blue" },
      { label: "인건비 집행률", value: "97.2%", note: "연간 예산 기준", tone: "orange" },
    ],
    columns: ["리포트", "기준 기간", "최근 생성", "작성자", "공유 범위", "형식"],
    rows: [
      ["월간 인원 현황", "2026년 7월", "08.01", "김지수", "경영진", "PDF · Excel"],
      ["채용 퍼널 분석", "2026년 2분기", "07.08", "이수민", "인사팀", "대시보드"],
      ["부서별 인건비", "2026년 상반기", "07.05", "김지수", "경영진", "Excel"],
      ["법정교육 이수현황", "2026년", "오늘", "박서준", "인사팀", "PDF"],
    ],
  },
};

type RetirementRecord = {
  date: string;
  reason: string;
  completedTaskIds: string[];
};

const moduleConfigs = Object.fromEntries(Object.entries(demoModuleConfigs).map(([id, config]) => [id, {
  ...config,
  metrics: config.metrics.map((metric) => ({ ...metric, value: "0건", note: "자료 미등록" })),
  rows: [],
}])) as Record<string, ModuleConfig>;

moduleConfigs.payroll = {
  ...demoModuleConfigs.payroll,
  metrics: [
    { label: "급여 대상", value: `${companyEmployees.length}명`, note: "재직자 기준" },
    { label: "지급총액", value: "미입력", note: "급여 자료 필요", tone: "blue" },
    { label: "공제총액", value: "미입력", note: "급여 자료 필요", tone: "orange" },
    { label: "실지급액", value: "미입력", note: "급여 자료 필요", tone: "red" },
  ],
  rows: [["2026년 8월", `${companyEmployees.length}명`, "미입력", "미입력", "미입력", "자료 미등록"]],
};

moduleConfigs.workforce = {
  ...demoModuleConfigs.workforce,
  metrics: [
    { label: "현재 인원", value: `${companyEmployees.length}명`, note: "재직자 기준" },
    { label: "운영 조직", value: `${companyOrganizations.length}개`, note: "소속 미지정 포함", tone: "blue" },
    { label: "승인 정원", value: "미입력", note: "인력계획 자료 필요", tone: "orange" },
    { label: "충원 필요", value: "미입력", note: "승인 정원 등록 필요", tone: "red" },
  ],
  rows: companyOrganizations.map((organization) => [organization.name, "미입력", `${companyEmployees.filter((employee) => employee.department === organization.name).length}명`, "0명", "0명", "미입력"]),
};

moduleConfigs.reports = {
  ...demoModuleConfigs.reports,
  metrics: [
    { label: "재직 인원", value: `${companyEmployees.length}명`, note: "하이웍스 원본 기준" },
    { label: "운영 조직", value: `${companyOrganizations.length}개`, note: "소속 미지정 포함", tone: "blue" },
    { label: "채용 데이터", value: "0건", note: "자료 미등록", tone: "green" },
    { label: "급여 데이터", value: "미입력", note: "자료 등록 필요", tone: "orange" },
  ],
  rows: [],
};

type Employee = {
  id: string;
  name: string;
  department: string;
  position: string;
  jobTitle?: string;
  type: string;
  joinDate: string;
  status: string;
  email: string;
  phone: string;
  address: string;
  manager: string;
  birth: string;
  history: { date: string; type: string; detail: string }[];
  retirement?: RetirementRecord;
};

type EmployeeInterviewRecord = {
  id: string;
  employeeId: string;
  interviewAt: string;
  transcript: string;
  memo: string;
  audioFileName: string | null;
  audioUrl: string | null;
  createdAt: number;
};

type SpeechRecognitionResultLike = {
  isFinal: boolean;
  0: { transcript: string };
};

type SpeechRecognitionEventLike = {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
};

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type Applicant = {
  id: string;
  name: string;
  role: string;
  applied: string;
  owner: string;
  stage: string;
  experience: string;
  email: string;
  phone: string;
  source: string;
  summary: string;
};

type InterviewRow = {
  id: string;
  time: string;
  name: string;
  role: string;
  type: string;
  interviewers: string;
  status: string;
};

type PersonnelActionType = "인사이동(전보)" | "승진" | "강등";

type Organization = {
  id: string;
  name: string;
  leaderEmployeeId: string | null;
  description: string;
};

type PersistedOrganizationLeader = {
  organizationId: string;
  leaderEmployeeId: string | null;
};

type PersistedEmployeeRecord = {
  employeeId: string;
  name: string;
  birth: string;
  email: string;
  phone: string;
  address: string;
  department: string;
  manager: string;
  type: string;
  position: string;
  jobTitle: string;
};

const retirementChecklist = {
  hr: [
    { id: "hr-approval", label: "퇴직 승인 및 퇴직 인사발령 등록" },
    { id: "hr-settlement", label: "급여·퇴직금·미사용 연차 정산" },
    { id: "hr-insurance", label: "4대보험 상실 신고와 퇴직 관련 행정 처리" },
    { id: "hr-access", label: "시스템 계정·출입 권한 회수 요청" },
    { id: "hr-documents", label: "퇴직 서류와 경력증명서 발급" },
  ],
  employee: [
    { id: "employee-form", label: "퇴직원 및 필수 서류 제출" },
    { id: "employee-handover", label: "업무 인수인계서 작성과 후임자 확인" },
    { id: "employee-assets", label: "노트북·출입증 등 회사 자산 반납" },
    { id: "employee-expense", label: "법인카드·미결 비용 최종 정산" },
    { id: "employee-security", label: "보안 및 비밀유지 의무 확인" },
  ],
};

const initialOrganizations: Organization[] = [
  ...companyOrganizations,
];

const initialRanks = [...companyRanks];
const initialJobTitles = [...companyJobTitles];

const initialEmployees: Employee[] = [
  ...companyEmployees,
];

const payrollPeople = initialEmployees.map((employee) => [employee.id, employee.name, employee.department, "미입력", "미입력", "미입력", "미입력"]);

const initialApplicants: Applicant[] = [];

const initialInterviews: InterviewRow[] = [];

function StatusPill({ value }: { value: string }) {
  const kind = value.includes("완료") || value.includes("재직") || value === "마감" ? "success" : value.includes("초과") || value.includes("휴직") ? "danger" : "pending";
  return <span className={`status-pill ${kind}`}>{value}</span>;
}

function XdnodeHrApp() {
  const [active, setActive] = useState("dashboard");
  const [employeeModalOpen, setEmployeeModalOpen] = useState(false);
  const [applicantModalOpen, setApplicantModalOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [query, setQuery] = useState("");
  const [employees, setEmployees] = useState(initialEmployees);
  const [organizations, setOrganizations] = useState(initialOrganizations);
  const [ranks, setRanks] = useState(initialRanks);
  const [jobTitles, setJobTitles] = useState(initialJobTitles);
  const [applicants, setApplicants] = useState(initialApplicants);
  const [interviews, setInterviews] = useState(initialInterviews);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [selectedPayrollMonth, setSelectedPayrollMonth] = useState<string | null>(null);
  const [selectedApplicantId, setSelectedApplicantId] = useState<string | null>(null);
  const [interviewTarget, setInterviewTarget] = useState<Applicant | null>(null);
  const [personnelAction, setPersonnelAction] = useState<string | null>(null);
  const [retirementOpen, setRetirementOpen] = useState(false);
  const [resumeStatus, setResumeStatus] = useState<"idle" | "analyzing" | "done">("idle");
  const [applicantDraft, setApplicantDraft] = useState({ name: "", role: "", email: "", phone: "", experience: "", source: "직접 등록", summary: "" });

  useEffect(() => {
    let cancelled = false;
    const loadLeaders = fetch("/api/hr/organization-leaders").then(async (response) => {
      const data = await response.json() as { leaders?: PersistedOrganizationLeader[]; error?: string };
      if (!response.ok) throw new Error(data.error || "조직장 정보를 불러오지 못했습니다.");
      return data.leaders ?? [];
    }).catch(() => null);
    const loadEmployeeRecords = fetch("/api/hr/employee-records").then(async (response) => {
      const data = await response.json() as { records?: PersistedEmployeeRecord[]; error?: string };
      if (!response.ok) throw new Error(data.error || "직원 정보를 불러오지 못했습니다.");
      return data.records ?? [];
    }).catch(() => null);

    Promise.all([loadLeaders, loadEmployeeRecords]).then(([leaders, employeeRecords]) => {
      if (cancelled) return;
      if (leaders) {
        const leaderByOrganization = new Map(leaders.map((leader) => [leader.organizationId, leader.leaderEmployeeId]));
        setOrganizations((items) => items.map((organization) => leaderByOrganization.has(organization.id)
          ? { ...organization, leaderEmployeeId: leaderByOrganization.get(organization.id) ?? null }
          : organization));
      }
      const persistedLeaderIds = new Set((leaders ?? []).map((leader) => leader.leaderEmployeeId).filter((id): id is string => Boolean(id)));
      const recordByEmployee = new Map((employeeRecords ?? []).map((record) => [record.employeeId, record]));
      setEmployees((items) => items.map((employee) => {
        const record = recordByEmployee.get(employee.id);
        const merged = record ? { ...employee, ...record, id: employee.id } : employee;
        return persistedLeaderIds.has(employee.id) ? { ...merged, jobTitle: "조직장" } : merged;
      }));
      if (!leaders || !employeeRecords) showToast("일부 저장 정보를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.");
    });
    return () => { cancelled = true; };
  }, []);

  const selectedEmployee = employees.find((employee) => employee.id === selectedEmployeeId) ?? null;
  const selectedApplicant = applicants.find((applicant) => applicant.id === selectedApplicantId) ?? null;
  const moduleConfig = moduleConfigs[active];

  const filteredRows = useMemo(() => {
    if (!moduleConfig || !query.trim()) return moduleConfig?.rows ?? [];
    return moduleConfig.rows.filter((row) => row.some((cell) => cell.toLowerCase().includes(query.toLowerCase())));
  }, [moduleConfig, query]);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2800);
  }

  function navigate(id: string) {
    setActive(id);
    setQuery("");
    setSelectedEmployeeId(null);
    setSelectedPayrollMonth(null);
    setSelectedApplicantId(null);
  }

  function saveEmployee(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const department = String(data.get("department"));
    const organization = organizations.find((item) => item.name === department);
    const organizationLeader = employees.find((employee) => employee.id === organization?.leaderEmployeeId);
    const newEmployee: Employee = {
      id: String(data.get("employeeId")), name: String(data.get("name")), email: String(data.get("email")), phone: String(data.get("phone")),
      department, type: String(data.get("type")), joinDate: String(data.get("joinDate")).replaceAll("-", "."), position: String(data.get("position")),
      jobTitle: String(data.get("jobTitle")), status: "재직", address: "미입력", manager: organizationLeader?.name ?? "", birth: "미입력", history: [{ date: String(data.get("joinDate")).replaceAll("-", "."), type: "입사", detail: `${department} ${String(data.get("position"))} 입사` }],
    };
    setEmployees((value) => [...value, newEmployee]);
    setEmployeeModalOpen(false);
    showToast("신규 직원이 인사기록카드에 등록되었습니다.");
  }

  async function updateEmployee(id: string, patch: Partial<Employee>) {
    const previous = employees.find((employee) => employee.id === id);
    if (!previous) return;
    const next = { ...previous, ...patch };
    setEmployees((value) => value.map((employee) => employee.id === id ? next : employee));
    try {
      const response = await fetch("/api/hr/employee-records", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: id,
          name: next.name,
          birth: next.birth,
          email: next.email,
          phone: next.phone,
          address: next.address,
          department: next.department,
          manager: next.manager,
          type: next.type,
          position: next.position,
          jobTitle: next.jobTitle ?? "팀원",
        }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "직원 정보를 저장하지 못했습니다.");
      showToast("인사기록의 변경내용을 영구 저장했습니다.");
    } catch {
      setEmployees((value) => value.map((employee) => employee.id === id ? previous : employee));
      showToast("저장에 실패해 이전 정보로 되돌렸습니다.");
    }
  }

  function savePersonnelAction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEmployee || !personnelAction) return;
    const data = new FormData(event.currentTarget);
    const date = String(data.get("effectiveDate")).replaceAll("-", ".");
    const actionType = String(data.get("actionType")) as PersonnelActionType;
    const department = String(data.get("targetDepartment"));
    const position = String(data.get("targetPosition"));
    const note = String(data.get("note")).trim();
    const currentRank = ranks.indexOf(selectedEmployee.position);
    const targetRank = ranks.indexOf(position);

    if (actionType === "인사이동(전보)" && department === selectedEmployee.department) {
      showToast("인사이동은 현재 소속과 다른 부서를 선택해야 합니다.");
      return;
    }
    if (actionType === "승진" && currentRank >= 0 && targetRank <= currentRank) {
      showToast("승진은 현재보다 높은 직급을 선택해야 합니다.");
      return;
    }
    if (actionType === "강등" && currentRank >= 0 && (targetRank < 0 || targetRank >= currentRank)) {
      showToast("강등은 현재보다 낮은 직급을 선택해야 합니다.");
      return;
    }
    if (actionType === "강등" && !note) {
      showToast("강등 발령에는 정당한 사유를 반드시 입력해야 합니다.");
      return;
    }

    const detail = note || (actionType === "인사이동(전보)"
      ? `${selectedEmployee.department}에서 ${department}(으)로 인사이동`
      : `${selectedEmployee.position}에서 ${position}(으)로 ${actionType}`);
    setEmployees((value) => value.map((employee) => {
      if (employee.id !== selectedEmployee.id) return employee;
      return {
        ...employee,
        department: actionType === "인사이동(전보)" ? department : employee.department,
        position: actionType === "승진" || actionType === "강등" ? position : employee.position,
        history: [{ date, type: actionType, detail }, ...employee.history],
      };
    }));
    setPersonnelAction(null);
    showToast(`${actionType} 인사 발령을 등록했습니다.`);
  }

  async function updateOrganizationLeader(organizationId: string, leaderEmployeeId: string) {
    const previousLeaderId = organizations.find((organization) => organization.id === organizationId)?.leaderEmployeeId;
    const nextLeaderId = leaderEmployeeId || null;
    setOrganizations((value) => value.map((organization) => organization.id === organizationId ? { ...organization, leaderEmployeeId: nextLeaderId } : organization));
    setEmployees((value) => value.map((employee) => employee.id === leaderEmployeeId
      ? { ...employee, jobTitle: "조직장" }
      : employee.id === previousLeaderId && employee.jobTitle === "조직장" ? { ...employee, jobTitle: "팀원" } : employee));
    try {
      const response = await fetch("/api/hr/organization-leaders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, leaderEmployeeId: nextLeaderId }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "조직장 정보를 저장하지 못했습니다.");
      showToast("조직장을 저장했습니다. 이후 기능 업데이트에도 유지됩니다.");
    } catch {
      setOrganizations((value) => value.map((organization) => organization.id === organizationId ? { ...organization, leaderEmployeeId: previousLeaderId ?? null } : organization));
      setEmployees((value) => value.map((employee) => employee.id === previousLeaderId
        ? { ...employee, jobTitle: "조직장" }
        : employee.id === leaderEmployeeId && employee.jobTitle === "조직장" ? { ...employee, jobTitle: "팀원" } : employee));
      showToast("조직장 저장에 실패해 이전 값으로 되돌렸습니다.");
    }
  }

  function addOrganization(name: string, description: string) {
    const trimmed = name.trim();
    if (!trimmed || organizations.some((organization) => organization.name === trimmed)) {
      showToast("새 조직명을 확인해 주세요.");
      return;
    }
    setOrganizations((value) => [...value, { id: `org-${Date.now()}`, name: trimmed, leaderEmployeeId: null, description: description.trim() || "조직 설명 미입력" }]);
    showToast(`${trimmed} 조직을 추가했습니다.`);
  }

  function updateOrganization(organizationId: string, name: string, description: string) {
    const trimmedName = name.trim();
    const current = organizations.find((organization) => organization.id === organizationId);
    if (!current || !trimmedName || organizations.some((organization) => organization.id !== organizationId && organization.name === trimmedName)) {
      showToast("조직명은 비어 있거나 다른 조직과 같을 수 없습니다.");
      return false;
    }
    setOrganizations((items) => items.map((organization) => organization.id === organizationId ? { ...organization, name: trimmedName, description: description.trim() || "조직 설명 미입력" } : organization));
    if (current.name !== trimmedName) {
      setEmployees((items) => items.map((employee) => employee.department === current.name ? { ...employee, department: trimmedName } : employee));
    }
    showToast(`${trimmedName} 조직 정보를 수정했습니다.`);
    return true;
  }

  function addRank(value: string) {
    const trimmed = value.trim();
    if (!trimmed || ranks.includes(trimmed)) return showToast("새 직급명을 확인해 주세요.");
    setRanks((items) => [...items, trimmed]);
    showToast(`${trimmed} 직급을 추가했습니다.`);
  }

  function removeRank(value: string) {
    if (employees.some((employee) => employee.position === value)) return showToast("사용 중인 직급은 삭제할 수 없습니다.");
    setRanks((items) => items.filter((item) => item !== value));
    showToast(`${value} 직급을 삭제했습니다.`);
  }

  function addJobTitle(value: string) {
    const trimmed = value.trim();
    if (!trimmed || jobTitles.includes(trimmed)) return showToast("새 직책명을 확인해 주세요.");
    setJobTitles((items) => [...items, trimmed]);
    showToast(`${trimmed} 직책을 추가했습니다.`);
  }

  function removeJobTitle(value: string) {
    if (value === "조직장" || employees.some((employee) => employee.jobTitle === value)) return showToast("사용 중이거나 필수인 직책은 삭제할 수 없습니다.");
    setJobTitles((items) => items.filter((item) => item !== value));
    showToast(`${value} 직책을 삭제했습니다.`);
  }

  function saveRetirement(record: RetirementRecord) {
    if (!selectedEmployee) return;
    const totalTasks = retirementChecklist.hr.length + retirementChecklist.employee.length;
    const completed = record.completedTaskIds.length;
    const historyDetail = `${record.date.replaceAll("-", ".")} 퇴직 예정 · ${record.reason} · 체크리스트 ${completed}/${totalTasks}`;
    setEmployees((value) => value.map((employee) => employee.id === selectedEmployee.id ? {
      ...employee,
      status: "퇴직 예정",
      retirement: record,
      history: [{ date: new Date().toISOString().slice(0, 10).replaceAll("-", "."), type: "퇴직 절차", detail: historyDetail }, ...employee.history.filter((item) => item.type !== "퇴직 절차")],
    } : employee));
    setRetirementOpen(false);
    showToast(completed === totalTasks ? "퇴직 절차 체크리스트를 모두 완료했습니다." : `퇴직 절차를 저장했습니다. 미완료 업무 ${totalTasks - completed}건`);
  }

  function parseResume(file: File | undefined) {
    if (!file) return;
    setResumeStatus("analyzing");
    window.setTimeout(() => {
      setApplicantDraft({ name: "김예진", role: "백엔드 개발자", email: "yejin.kim@email.com", phone: "010-7821-4059", experience: "4년 6개월", source: "이력서 AI 추출", summary: "Spring Boot 기반 서비스 개발과 AWS 운영 경험. 주문·결제 도메인 개선 프로젝트를 주도했으며 SQL 튜닝 경험을 보유하고 있습니다." });
      setResumeStatus("done");
    }, 900);
  }

  function saveApplicant(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const applicant: Applicant = { id: `AP-${85 + applicants.length}`, ...applicantDraft, applied: "오늘", owner: "김지수", stage: "서류 검토" };
    setApplicants((value) => [applicant, ...value]);
    setApplicantModalOpen(false);
    setResumeStatus("idle");
    setApplicantDraft({ name: "", role: "", email: "", phone: "", experience: "", source: "직접 등록", summary: "" });
    showToast("지원자가 지원 현황에 등록되었습니다.");
  }

  function scheduleInterview(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!interviewTarget) return;
    const data = new FormData(event.currentTarget);
    const date = String(data.get("date"));
    const time = String(data.get("time"));
    const row: InterviewRow = { id: `IV-${105 + interviews.length}`, time: `${date.slice(5).replace("-", ".")} ${time}`, name: interviewTarget.name, role: interviewTarget.role, type: String(data.get("type")), interviewers: String(data.get("interviewers")), status: "확정" };
    setInterviews((value) => [row, ...value]);
    setApplicants((value) => value.map((applicant) => applicant.id === interviewTarget.id ? { ...applicant, stage: "면접 예정" } : applicant));
    setInterviewTarget(null);
    navigate("interviews");
    showToast(`${row.name} 님의 면접 일정이 등록되었습니다.`);
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">HR</div><div><strong>XDNODE HR</strong><span>PEOPLE OPERATIONS</span></div></div>
        <nav className="main-nav" aria-label="주요 메뉴">
          {navGroups.map((group) => <div className="nav-group" key={group.title}><p>{group.title}</p>{group.items.map((item) => (
            <button type="button" key={item.id} className={`nav-item ${active === item.id ? "active" : ""}`} onClick={() => navigate(item.id)}><span className="nav-icon">{item.icon}</span><span>{item.label}</span>{item.badge && <em>{item.badge}</em>}</button>
          ))}</div>)}
        </nav>
        <div className="sidebar-footer">
          <button type="button" className={`settings-button ${active === "settings" ? "active" : ""}`} onClick={() => navigate("settings")}><span className="nav-icon">설</span>환경설정</button>
        </div>
      </aside>

      <main className="main-content">
        {active === "dashboard" && <Dashboard employees={employees} organizations={organizations} applicants={applicants} onNavigate={navigate} />}
        {active === "employees" && (selectedEmployee ? <EmployeeDetail employee={selectedEmployee} employees={employees} organizations={organizations} ranks={ranks} jobTitles={jobTitles} onBack={() => setSelectedEmployeeId(null)} onUpdate={updateEmployee} onPersonnelAction={() => setPersonnelAction("인사 발령")} onRetirement={() => setRetirementOpen(true)} /> : <EmployeeDirectory employees={employees} organizations={organizations} query={query} onSelect={setSelectedEmployeeId} onAdd={() => setEmployeeModalOpen(true)} />)}
        {active === "organization" && <OrganizationManagement organizations={organizations} employees={employees} ranks={ranks} jobTitles={jobTitles} onLeaderChange={updateOrganizationLeader} onAddOrganization={addOrganization} onUpdateOrganization={updateOrganization} onAddRank={addRank} onRemoveRank={removeRank} onAddJobTitle={addJobTitle} onRemoveJobTitle={removeJobTitle} />}
        {active === "payroll" && (selectedPayrollMonth ? <PayrollMonthDetail month={selectedPayrollMonth} onBack={() => setSelectedPayrollMonth(null)} /> : <PayrollOverview config={moduleConfigs.payroll} onSelectMonth={setSelectedPayrollMonth} />)}
        {active === "recruitment" && <RecruitmentView applicants={applicants} query={query} onAdd={() => setApplicantModalOpen(true)} onSelect={setSelectedApplicantId} onInterview={setInterviewTarget} onReject={(id) => { setApplicants((value) => value.map((applicant) => applicant.id === id ? { ...applicant, stage: "서류 탈락" } : applicant)); showToast("서류 탈락 처리했습니다."); }} />}
        {active === "interviews" && <InterviewManagement interviews={interviews} />}
        {active === "settings" && <SettingsView employees={employees} onSave={() => showToast("환경설정을 저장했습니다.")} onNotify={showToast} />}
        {!["dashboard", "employees", "organization", "payroll", "recruitment", "interviews", "settings"].includes(active) && moduleConfig && <ModuleView config={moduleConfig} rows={filteredRows} query={query} onPrimary={() => showToast(`${moduleConfig.action} 기능을 열었습니다.`)} />}
      </main>

      {employeeModalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setEmployeeModalOpen(false)}><form className="employee-modal" onSubmit={saveEmployee} onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p>NEW EMPLOYEE</p><h2>직원 등록</h2></div><button type="button" onClick={() => setEmployeeModalOpen(false)}>×</button></div><div className="form-grid"><label><span>이름 *</span><input required name="name" placeholder="홍길동" /></label><label><span>사번 *</span><input required name="employeeId" placeholder="사번 또는 계정 ID" /></label><label><span>이메일 *</span><input required name="email" type="email" placeholder="name@company.com" /></label><label><span>연락처</span><input name="phone" placeholder="010-0000-0000" /></label><label><span>소속 조직 *</span><select required name="department" defaultValue=""><option value="" disabled>조직 선택</option>{organizations.map((organization) => <option key={organization.id}>{organization.name}</option>)}</select></label><label><span>고용형태 *</span><select required name="type"><option>일반직4.5</option><option>일반직</option><option>계약직</option><option>인턴</option></select></label><label><span>입사일 *</span><input required name="joinDate" type="date" /></label><label><span>직급</span><select name="position">{ranks.map((rank) => <option key={rank}>{rank}</option>)}</select></label><label><span>직무</span><select name="jobTitle">{jobTitles.filter((title) => title !== "조직장").map((title) => <option key={title}>{title}</option>)}</select></label></div><label className="form-note"><span>메모</span><textarea placeholder="입사 준비에 필요한 참고사항을 입력하세요."></textarea></label><div className="modal-actions"><button type="button" onClick={() => setEmployeeModalOpen(false)}>취소</button><button type="submit" className="primary-button">직원 등록</button></div></form></div>}

      {applicantModalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setApplicantModalOpen(false)}><form className="employee-modal applicant-modal" onSubmit={saveApplicant} onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p>NEW APPLICANT</p><h2>지원자 등록</h2></div><button type="button" onClick={() => setApplicantModalOpen(false)}>×</button></div><div className={`resume-drop ${resumeStatus}`}><label><input type="file" accept=".pdf,.doc,.docx" onChange={(event) => parseResume(event.target.files?.[0])} /><span className="resume-icon">AI</span><div><strong>{resumeStatus === "analyzing" ? "이력서를 분석하고 있어요" : resumeStatus === "done" ? "AI 정보 추출 완료" : "이력서를 올리면 AI가 자동으로 입력합니다"}</strong><small>{resumeStatus === "done" ? "추출된 내용을 확인하고 필요한 부분을 수정하세요." : "PDF, DOC, DOCX · 직접 입력도 가능합니다."}</small></div><em>{resumeStatus === "analyzing" ? "분석 중…" : resumeStatus === "done" ? "다시 선택" : "파일 선택"}</em></label></div><div className="form-grid"><label><span>이름 *</span><input required value={applicantDraft.name} onChange={(event) => setApplicantDraft({ ...applicantDraft, name: event.target.value })} /></label><label><span>지원 직무 *</span><input required value={applicantDraft.role} onChange={(event) => setApplicantDraft({ ...applicantDraft, role: event.target.value })} /></label><label><span>이메일 *</span><input required type="email" value={applicantDraft.email} onChange={(event) => setApplicantDraft({ ...applicantDraft, email: event.target.value })} /></label><label><span>연락처</span><input value={applicantDraft.phone} onChange={(event) => setApplicantDraft({ ...applicantDraft, phone: event.target.value })} /></label><label><span>경력</span><input value={applicantDraft.experience} onChange={(event) => setApplicantDraft({ ...applicantDraft, experience: event.target.value })} /></label><label><span>지원 경로</span><select value={applicantDraft.source} onChange={(event) => setApplicantDraft({ ...applicantDraft, source: event.target.value })}><option>사람인</option><option>그룹바이</option><option>직접 등록</option><option>원티드</option><option>잡코리아</option><option>링크드인</option><option>직원 추천</option><option>기타 채용사이트</option><option>이력서 AI 추출</option></select></label></div><label className="form-note"><span>경력 요약</span><textarea value={applicantDraft.summary} onChange={(event) => setApplicantDraft({ ...applicantDraft, summary: event.target.value })} placeholder="주요 경력과 역량을 입력하세요."></textarea></label><div className="modal-actions"><button type="button" onClick={() => setApplicantModalOpen(false)}>취소</button><button type="submit" className="primary-button">지원자 등록</button></div></form></div>}

      {selectedApplicant && <ApplicantDetail applicant={selectedApplicant} onClose={() => setSelectedApplicantId(null)} onInterview={() => { setSelectedApplicantId(null); setInterviewTarget(selectedApplicant); }} />}
      {interviewTarget && <InterviewScheduleModal applicant={interviewTarget} onClose={() => setInterviewTarget(null)} onSubmit={scheduleInterview} />}
      {personnelAction && selectedEmployee && <PersonnelActionModal employee={selectedEmployee} ranks={ranks} organizations={organizations} onClose={() => setPersonnelAction(null)} onSubmit={savePersonnelAction} />}
      {retirementOpen && selectedEmployee && <RetirementModal employee={selectedEmployee} onClose={() => setRetirementOpen(false)} onSubmit={saveRetirement} />}
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </div>
  );
}

function EmployeeDirectory({ employees, organizations, query, onSelect, onAdd }: { employees: Employee[]; organizations: Organization[]; query: string; onSelect: (id: string) => void; onAdd: () => void }) {
  const departments = organizations.map((organization) => organization.name);
  const [expanded, setExpanded] = useState<string[]>(departments);
  const [exporting, setExporting] = useState(false);
  const visibleEmployees = query ? employees.filter((employee) => Object.values(employee).some((value) => typeof value === "string" && value.toLowerCase().includes(query.toLowerCase()))) : employees;
  const currentEmployees = employees.filter((employee) => employee.status !== "퇴직");
  const hiresThisMonth = currentEmployees.filter((employee) => employee.joinDate.startsWith("2026.08")).length;
  const incompleteProfiles = currentEmployees.filter((employee) => [employee.email, employee.phone, employee.birth, employee.address].some((value) => !value || value === "미입력")).length;
  const toggle = (department: string) => setExpanded((value) => value.includes(department) ? value.filter((item) => item !== department) : [...value, department]);

  async function downloadEmployeeWorkbook() {
    setExporting(true);
    try {
      const { default: writeXlsxFile } = await import("write-excel-file/browser");
      const header = ["이름", "사번/ID", "생년월일", "이메일", "연락처", "주소", "소속 조직", "조직장", "직급", "직무", "고용형태", "입사일", "재직상태"];
      const sortedEmployees = departments.flatMap((department) => {
        const organization = organizations.find((item) => item.name === department);
        return currentEmployees
          .filter((employee) => employee.department === department)
          .sort((first, second) => {
            const leaderOrder = Number(second.id === organization?.leaderEmployeeId) - Number(first.id === organization?.leaderEmployeeId);
            return leaderOrder || first.joinDate.localeCompare(second.joinDate) || first.name.localeCompare(second.name, "ko");
          });
      });
      const rows = sortedEmployees.map((employee) => {
        const organization = organizations.find((item) => item.name === employee.department);
        const isLeader = employee.id === organization?.leaderEmployeeId;
        const leader = employees.find((item) => item.id === organization?.leaderEmployeeId);
        return [employee.name, employee.id, employee.birth, employee.email, employee.phone, employee.address, employee.department, isLeader ? "" : leader?.name ?? "미지정", employee.position, isLeader ? "조직장" : employee.jobTitle, employee.type, employee.joinDate, employee.status];
      });
      const writer = writeXlsxFile([
        header.map((value) => ({ value, fontWeight: "bold" as const, backgroundColor: "#18181B", color: "#FFFFFF" })),
        ...rows,
      ], {
        sheet: "인사기록",
        columns: [18, 18, 14, 28, 18, 36, 18, 16, 12, 18, 14, 14, 12].map((width) => ({ width })),
        showGridLines: true,
      }, { fontFamily: "맑은 고딕", fontSize: 10 });
      await writer.toFile(`XDNODE_인사기록_${new Date().toISOString().slice(0, 10)}.xlsx`);
    } finally {
      setExporting(false);
    }
  }

  return <div className="page-wrap module-page">
    <section className="module-hero"><div><p className="eyebrow">PEOPLE DIRECTORY</p><h1>인사기록카드</h1><p>전체 구성원을 부서별로 확인하고 개인 인사기록을 관리합니다.</p></div><div className="employee-directory-actions"><button type="button" className="outline-button" disabled={exporting} onClick={downloadEmployeeWorkbook}>{exporting ? "엑셀 생성 중…" : "엑셀로 다운 받기"}</button><button type="button" className="primary-button" onClick={onAdd}>+ 직원 등록</button></div></section>
    <section className="metric-grid module-metrics">
      {[{ label: "전체 재직자", value: `${currentEmployees.length}명`, note: "하이웍스 원본 기준" }, { label: "조직", value: `${organizations.length}개`, note: "소속 미지정 포함", tone: "blue" }, { label: "이번 달 입사", value: `${hiresThisMonth}명`, note: "2026년 8월 입사", tone: "green" }, { label: "정보 확인 필요", value: `${incompleteProfiles}명`, note: "필수항목 미입력", tone: "red" }].map((metric) => <div className="compact-metric" key={metric.label}><span className={`metric-accent ${metric.tone ?? "navy"}`}></span><p>{metric.label}</p><h2>{metric.value}</h2><small>{metric.note}</small></div>)}
    </section>
    <div className="directory-toolbar"><div><h2>전체 현황</h2><span>총 {currentEmployees.length}명 · 부서별 접기/펼치기</span></div><div><button type="button" onClick={() => setExpanded(departments)}>모두 펼치기</button><button type="button" onClick={() => setExpanded([])}>모두 접기</button></div></div>
    <div className="department-list">
      {departments.map((department) => {
        const organization = organizations.find((item) => item.name === department);
        const people = visibleEmployees
          .filter((employee) => employee.department === department)
          .sort((first, second) => {
            const leaderOrder = Number(second.id === organization?.leaderEmployeeId) - Number(first.id === organization?.leaderEmployeeId);
            return leaderOrder || first.joinDate.localeCompare(second.joinDate) || first.name.localeCompare(second.name, "ko");
          });
        const leader = employees.find((employee) => employee.id === organization?.leaderEmployeeId);
        if (query && people.length === 0) return null;
        return <section className="panel department-panel" key={department}>
          <button type="button" className="department-heading" onClick={() => toggle(department)} aria-expanded={expanded.includes(department)}><span className={`chevron ${expanded.includes(department) ? "open" : ""}`}>›</span><div><strong>{department}</strong><small>재직 {people.length}명 · 실제 등록 인원</small></div><span className="dept-progress"><i style={{ width: "100%" }}></i></span><em>{expanded.includes(department) ? "접기" : "펼치기"}</em></button>
          {expanded.includes(department) && <div className="data-table-wrap"><table className="data-table employee-table"><thead><tr><th>직원</th><th>사번/ID</th><th>직급</th><th>직무</th><th>고용형태</th><th>입사일</th><th>조직장</th><th>상태</th></tr></thead><tbody>{people.map((employee) => {
            const isLeader = employee.id === organization?.leaderEmployeeId;
            return <tr key={employee.id} className={isLeader ? "organization-leader-row" : ""}><td><button type="button" className="name-link" onClick={() => onSelect(employee.id)}><span>{employee.name.slice(0, 1)}</span>{employee.name}{isLeader && <em className="organization-leader-badge">조직장</em>}</button></td><td>{employee.id}</td><td>{employee.position}</td><td>{isLeader ? "조직장" : employee.jobTitle ?? "팀원"}</td><td>{employee.type}</td><td>{employee.joinDate}</td><td>{isLeader ? "" : leader?.name ?? "미지정"}</td><td><StatusPill value={employee.status} /></td></tr>;
          })}</tbody></table></div>}
        </section>;
      })}
    </div>
  </div>;
}

function OrganizationManagement({ organizations, employees, ranks, jobTitles, onLeaderChange, onAddOrganization, onUpdateOrganization, onAddRank, onRemoveRank, onAddJobTitle, onRemoveJobTitle }: { organizations: Organization[]; employees: Employee[]; ranks: string[]; jobTitles: string[]; onLeaderChange: (organizationId: string, employeeId: string) => void; onAddOrganization: (name: string, description: string) => void; onUpdateOrganization: (organizationId: string, name: string, description: string) => boolean; onAddRank: (value: string) => void; onRemoveRank: (value: string) => void; onAddJobTitle: (value: string) => void; onRemoveJobTitle: (value: string) => void }) {
  const [newOrganization, setNewOrganization] = useState({ name: "", description: "" });
  const [newRank, setNewRank] = useState("");
  const [newJobTitle, setNewJobTitle] = useState("");
  return <div className="page-wrap module-page organization-page">
    <section className="module-hero"><div><p className="eyebrow">ORGANIZATION MANAGEMENT</p><h1>조직관리</h1><p>조직 구성과 조직장, 직급 및 직책 기준을 한 곳에서 관리합니다.</p></div></section>
    <section className="metric-grid module-metrics">{[
      { label: "운영 조직", value: `${organizations.length}개`, note: "인사기록과 연동" },
      { label: "조직장 지정", value: `${organizations.filter((organization) => organization.leaderEmployeeId).length}명`, note: `미지정 ${organizations.filter((organization) => !organization.leaderEmployeeId).length}개`, tone: "blue" },
      { label: "직급 체계", value: `${ranks.length}단계`, note: "승진·강등 기준", tone: "green" },
      { label: "직책", value: `${jobTitles.length}개`, note: "역할 구분", tone: "orange" },
    ].map((metric) => <div className="compact-metric" key={metric.label}><span className={`metric-accent ${metric.tone ?? "navy"}`}></span><p>{metric.label}</p><h2>{metric.value}</h2><small>{metric.note}</small></div>)}</section>
    <div className="organization-layout">
      <section className="panel organization-list-panel">
        <div className="table-toolbar"><div><h2>회사 조직 구성</h2><span>조직장을 지정하면 인사기록카드에 즉시 반영됩니다.</span></div></div>
        <div className="organization-list">{organizations.map((organization) => {
          const members = employees.filter((employee) => employee.department === organization.name);
          return <OrganizationCard key={organization.id} organization={organization} members={members} onLeaderChange={onLeaderChange} onUpdate={onUpdateOrganization} />;
        })}</div>
        <form className="organization-add-form" onSubmit={(event) => { event.preventDefault(); onAddOrganization(newOrganization.name, newOrganization.description); setNewOrganization({ name: "", description: "" }); }}><div><label><span>새 조직명</span><input required value={newOrganization.name} onChange={(event) => setNewOrganization({ ...newOrganization, name: event.target.value })} placeholder="예: 사업전략팀" /></label><label><span>조직 설명</span><input value={newOrganization.description} onChange={(event) => setNewOrganization({ ...newOrganization, description: event.target.value })} placeholder="조직의 주요 역할" /></label></div><button type="submit" className="primary-button">+ 조직 추가</button></form>
      </section>
      <aside className="organization-catalogs">
        <CatalogManager title="직급 관리" description="승진·강등과 인사기록에 사용하는 직급입니다." items={ranks} value={newRank} onValue={setNewRank} onAdd={() => { onAddRank(newRank); setNewRank(""); }} onRemove={onRemoveRank} placeholder="새 직급" />
        <CatalogManager title="직책 관리" description="구성원의 역할과 책임을 구분합니다." items={jobTitles} value={newJobTitle} onValue={setNewJobTitle} onAdd={() => { onAddJobTitle(newJobTitle); setNewJobTitle(""); }} onRemove={onRemoveJobTitle} placeholder="새 직책" />
      </aside>
    </div>
  </div>;
}

function OrganizationCard({ organization, members, onLeaderChange, onUpdate }: { organization: Organization; members: Employee[]; onLeaderChange: (organizationId: string, employeeId: string) => void; onUpdate: (organizationId: string, name: string, description: string) => boolean }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: organization.name, description: organization.description });
  const sortedMembers = [...members].sort((first, second) => Number(second.id === organization.leaderEmployeeId) - Number(first.id === organization.leaderEmployeeId));
  const memberColumns = members.length <= 1 ? 1 : members.length <= 4 ? 2 : 3;

  function cancelEdit() {
    setDraft({ name: organization.name, description: organization.description });
    setEditing(false);
  }

  function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (onUpdate(organization.id, draft.name, draft.description)) setEditing(false);
  }

  return <article className={`organization-card ${editing ? "editing" : ""}`}>
    {editing ? <form className="organization-edit-form" onSubmit={saveEdit}><div className="organization-edit-heading"><strong>조직 정보 수정</strong><span>조직명 변경 시 소속 인사기록에도 함께 반영됩니다.</span></div><label><span>조직명</span><input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label><span>조직 설명</span><textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label><div className="organization-edit-actions"><button type="button" onClick={cancelEdit}>취소</button><button type="submit">수정 저장</button></div></form> : <><div className="organization-card-heading"><span>{organization.name.slice(0, 1)}</span><div><h3>{organization.name}</h3><p>{organization.description}</p></div><em>{members.length}명</em><button type="button" className="organization-edit-button" onClick={() => setEditing(true)}>조직 수정</button></div><label><span>조직장</span><select value={organization.leaderEmployeeId ?? ""} onChange={(event) => onLeaderChange(organization.id, event.target.value)}><option value="">미지정</option>{members.map((employee) => <option value={employee.id} key={employee.id}>{employee.name} · {employee.position}</option>)}</select></label><div className="organization-members"><div className="organization-members-heading"><strong>소속 조직원</strong><span>{members.length}명</span></div>{members.length > 0 ? <div className={`organization-member-list columns-${memberColumns}`}>{sortedMembers.map((employee) => <div className={`organization-member ${employee.id === organization.leaderEmployeeId ? "leader" : ""}`} key={employee.id}><span>{employee.name.slice(0, 1)}</span><div><strong>{employee.name}</strong><small>{employee.position} · {employee.id === organization.leaderEmployeeId ? "조직장" : employee.jobTitle ?? "팀원"}</small></div></div>)}</div> : <p className="organization-empty-members">소속 조직원이 없습니다.</p>}</div></>}
  </article>;
}

function CatalogManager({ title, description, items, value, onValue, onAdd, onRemove, placeholder }: { title: string; description: string; items: string[]; value: string; onValue: (value: string) => void; onAdd: () => void; onRemove: (value: string) => void; placeholder: string }) {
  return <section className="panel catalog-panel"><div><h2>{title}</h2><p>{description}</p></div><div className="catalog-list">{items.map((item, index) => <div key={item}><span>{index + 1}</span><strong>{item}</strong><button type="button" onClick={() => onRemove(item)} aria-label={`${item} 삭제`}>×</button></div>)}</div><form onSubmit={(event) => { event.preventDefault(); onAdd(); }}><input value={value} onChange={(event) => onValue(event.target.value)} placeholder={placeholder} /><button type="submit">추가</button></form></section>;
}

function EmployeeDetail({ employee, employees, organizations, ranks, jobTitles, onBack, onUpdate, onPersonnelAction, onRetirement }: { employee: Employee; employees: Employee[]; organizations: Organization[]; ranks: string[]; jobTitles: string[]; onBack: () => void; onUpdate: (id: string, patch: Partial<Employee>) => void; onPersonnelAction: () => void; onRetirement: () => void }) {
  const [selectedDepartment, setSelectedDepartment] = useState(employee.department);
  const [selectedJobTitle, setSelectedJobTitle] = useState(employee.jobTitle ?? "팀원");
  const selectedOrganization = organizations.find((organization) => organization.name === selectedDepartment);
  const isOrganizationLeader = selectedOrganization?.leaderEmployeeId === employee.id;
  const leader = employees.find((person) => person.id === selectedOrganization?.leaderEmployeeId);
  const organizationLeaderName = isOrganizationLeader ? "" : leader?.name ?? "";
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const birth = String(data.get("birth"));
    onUpdate(employee.id, { name: String(data.get("name")).trim(), birth: birth ? birth.replaceAll("-", ".") : "미입력", email: String(data.get("email")), phone: String(data.get("phone")), address: String(data.get("address")), department: selectedDepartment, manager: organizationLeaderName, type: String(data.get("type")), position: String(data.get("position")), jobTitle: isOrganizationLeader ? "조직장" : selectedJobTitle });
  }
  return <div className="page-wrap detail-page">
    <button type="button" className="back-button" onClick={onBack}>← 전체 인사기록</button>
    <section className="profile-hero panel"><div className="profile-avatar">{employee.name.slice(0, 1)}</div><div className="profile-copy"><p>{employee.id}</p><h1>{employee.name}</h1><div><span>{employee.department}</span><b>·</b><span>{employee.position}</span><b>·</b><StatusPill value={employee.status} /></div></div><div className="profile-actions personnel-actions-stack"><button type="button" className="promote" onClick={onPersonnelAction}>인사 발령</button><button type="button" className="retirement-action" onClick={onRetirement}>퇴직</button></div></section>
    <div className="detail-grid">
      <form className="panel detail-card" onSubmit={submit}><div className="detail-card-heading"><div><p className="eyebrow">BASIC INFORMATION</p><h2>기본정보</h2></div><button type="submit" className="primary-button">변경사항 저장</button></div><div className="detail-form"><label><span>이름</span><input required name="name" defaultValue={employee.name} /></label><label><span>생년월일</span><input name="birth" type="date" defaultValue={employee.birth === "미입력" ? "" : employee.birth.replaceAll(".", "-")} /></label><label><span>이메일</span><input name="email" defaultValue={employee.email} /></label><label><span>연락처</span><input name="phone" defaultValue={employee.phone} /></label><label className="wide"><span>주소</span><input name="address" defaultValue={employee.address} /></label><label><span>고용형태</span><select name="type" defaultValue={employee.type}><option>일반직4.5</option><option>일반직</option><option>계약직</option><option>인턴</option></select></label><label><span>소속 조직</span><select value={selectedDepartment} onChange={(event) => setSelectedDepartment(event.target.value)}>{organizations.map((organization) => <option key={organization.id}>{organization.name}</option>)}</select></label><label><span>조직장</span><input value={organizationLeaderName} disabled placeholder={isOrganizationLeader ? "본인이 조직장인 경우 공란" : "조직장 미지정"} /></label><label><span>직급</span><select name="position" defaultValue={employee.position}>{ranks.map((rank) => <option key={rank}>{rank}</option>)}</select></label><label><span>직무</span><select name="jobTitle" value={isOrganizationLeader ? "조직장" : selectedJobTitle} disabled={isOrganizationLeader} onChange={(event) => setSelectedJobTitle(event.target.value)}>{jobTitles.map((title) => <option key={title}>{title}</option>)}</select></label><label><span>입사일</span><input value={employee.joinDate} disabled /></label></div></form>
      <aside className="panel detail-card history-card"><div className="detail-card-heading"><div><p className="eyebrow">HR HISTORY</p><h2>인사이력</h2></div><span>{employee.history.length}건</span></div><div className="history-list">{employee.history.map((item, index) => <div className="history-item" key={`${item.date}-${index}`}><span></span><div><strong>{item.type}</strong><p>{item.detail}</p><small>{item.date}</small></div></div>)}</div></aside>
    </div>
    <EmployeeInterviewLog employee={employee} />
  </div>;
}

function EmployeeInterviewLog({ employee }: { employee: Employee }) {
  const nowLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [records, setRecords] = useState<EmployeeInterviewRecord[]>([]);
  const [interviewAt, setInterviewAt] = useState(nowLocal);
  const [transcript, setTranscript] = useState("");
  const [memo, setMemo] = useState("");
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const speechRef = useRef<SpeechRecognitionLike | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recognizedTextRef = useRef("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/hr/interviews?employeeId=${encodeURIComponent(employee.id)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("면담 기록을 불러오지 못했습니다.");
        return response.json() as Promise<{ records: EmployeeInterviewRecord[] }>;
      })
      .then((data) => { if (active) setRecords(data.records); })
      .catch((error: Error) => { if (active) setMessage(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [employee.id]);

  useEffect(() => () => {
    if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
    streamRef.current?.getTracks().forEach((track) => track.stop());
  }, [audioPreviewUrl]);

  async function startRecording() {
    setMessage("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMessage("이 브라우저에서는 음성 녹음을 지원하지 않습니다. 전사문과 메모를 직접 입력해 주세요.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      recognizedTextRef.current = transcript.trim();
      const preferredType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = preferredType
        ? new MediaRecorder(stream, { mimeType: preferredType })
        : new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
        setAudioBlob(blob);
        setAudioPreviewUrl(URL.createObjectURL(blob));
        stream.getTracks().forEach((track) => track.stop());
      };

      const speechWindow = window as unknown as { SpeechRecognition?: SpeechRecognitionConstructor; webkitSpeechRecognition?: SpeechRecognitionConstructor };
      const Recognition = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
      if (Recognition) {
        const recognition = new Recognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = "ko-KR";
        recognition.onresult = (event) => {
          let interim = "";
          for (let index = event.resultIndex; index < event.results.length; index += 1) {
            const result = event.results[index];
            const text = result[0].transcript.trim();
            if (result.isFinal) recognizedTextRef.current = `${recognizedTextRef.current} ${text}`.trim();
            else interim = `${interim} ${text}`.trim();
          }
          setTranscript(`${recognizedTextRef.current} ${interim}`.trim());
        };
        recognition.onerror = () => setMessage("자동 전사가 중단되었습니다. 녹음은 계속되며 전사문을 직접 보완할 수 있습니다.");
        speechRef.current = recognition;
        recognition.start();
      } else {
        setMessage("이 브라우저는 자동 전사를 지원하지 않아 녹음만 진행합니다. 전사문은 직접 입력할 수 있습니다.");
      }

      recorder.start(500);
      setRecording(true);
    } catch {
      setMessage("마이크 권한을 확인한 뒤 다시 녹음을 시작해 주세요.");
    }
  }

  function stopRecording() {
    speechRef.current?.stop();
    speechRef.current = null;
    if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  async function saveRecord(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!transcript.trim() && !memo.trim() && !audioBlob) {
      setMessage("전사기록, 메모 또는 녹음 중 하나를 입력해 주세요.");
      return;
    }
    setSaving(true);
    setMessage("");
    const form = new FormData();
    form.append("employeeId", employee.id);
    form.append("interviewAt", interviewAt);
    form.append("transcript", transcript);
    form.append("memo", memo);
    if (audioBlob) {
      const extension = audioBlob.type.includes("mp4") ? "m4a" : "webm";
      form.append("audio", new File([audioBlob], `interview-${employee.id}-${Date.now()}.${extension}`, { type: audioBlob.type }));
    }
    try {
      const response = await fetch("/api/hr/interviews", { method: "POST", body: form });
      const data = await response.json() as { record?: EmployeeInterviewRecord; error?: string };
      if (!response.ok || !data.record) throw new Error(data.error || "면담 기록을 저장하지 못했습니다.");
      setRecords((items) => [data.record as EmployeeInterviewRecord, ...items]);
      setInterviewAt(nowLocal());
      setTranscript("");
      setMemo("");
      setAudioBlob(null);
      if (audioPreviewUrl) URL.revokeObjectURL(audioPreviewUrl);
      setAudioPreviewUrl(null);
      setMessage("면담 기록을 저장했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "면담 기록을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="panel interview-log-card">
    <div className="detail-card-heading"><div><p className="eyebrow">INTERVIEW LOG</p><h2>면담 기록</h2></div><span>{records.length}건</span></div>
    <form className="interview-log-form" onSubmit={saveRecord}>
      <div className="interview-log-top"><label><span>면담일시</span><input required type="datetime-local" value={interviewAt} onChange={(event) => setInterviewAt(event.target.value)} /></label><div className="recording-controls"><span>음성녹음</span><button type="button" className={recording ? "recording" : ""} onClick={recording ? stopRecording : startRecording}>{recording ? "■ 녹음 종료" : "● 녹음 시작"}</button>{audioPreviewUrl && <audio controls src={audioPreviewUrl}>녹음 미리듣기</audio>}</div></div>
      <div className="interview-text-grid"><label><span>AI 전사기록</span><textarea value={transcript} onChange={(event) => { setTranscript(event.target.value); recognizedTextRef.current = event.target.value; }} placeholder="녹음을 시작하면 지원되는 브라우저에서 한국어 음성이 자동으로 전사됩니다. 직접 수정할 수도 있습니다." /></label><label><span>사용자 메모</span><textarea value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="면담 요약, 후속 조치, 확인할 내용을 기록하세요." /></label></div>
      {message && <p className="interview-log-message">{message}</p>}
      <div className="interview-log-actions"><small>녹음 파일과 기록은 이 직원의 인사기록에 안전하게 저장됩니다.</small><button type="submit" className="primary-button" disabled={saving || recording}>{saving ? "저장 중…" : "면담 기록 저장"}</button></div>
    </form>
    <div className="interview-record-list">{loading ? <p className="interview-empty">면담 기록을 불러오는 중입니다.</p> : records.length ? records.map((record) => <article key={record.id}><div><strong>{new Date(record.interviewAt).toLocaleString("ko-KR")}</strong><small>{record.audioFileName ? "음성녹음 포함" : "텍스트 기록"}</small></div>{record.audioUrl && <audio controls src={record.audioUrl}>면담 녹음</audio>}<section><span>AI 전사기록</span><p>{record.transcript || "전사기록 없음"}</p></section><section><span>사용자 메모</span><p>{record.memo || "메모 없음"}</p></section></article>) : <p className="interview-empty">아직 등록된 면담 기록이 없습니다.</p>}</div>
  </section>;
}

function PayrollOverview({ config, onSelectMonth }: { config: ModuleConfig; onSelectMonth: (month: string) => void }) {
  return <div className="page-wrap module-page"><section className="module-hero"><div><p className="eyebrow">PAYROLL</p><h1>급여관리</h1><p>급여월을 선택해 대상자별 지급·공제 내역을 확인합니다.</p></div><button type="button" className="primary-button">+ 8월 급여 계산</button></section><section className="metric-grid module-metrics">{config.metrics.map((metric) => <div className="compact-metric" key={metric.label}><span className={`metric-accent ${metric.tone ?? "navy"}`}></span><p>{metric.label}</p><h2>{metric.value}</h2><small>{metric.note}</small></div>)}</section><section className="panel table-panel"><div className="table-toolbar"><div><h2>급여월 현황</h2><span>급여월을 클릭하면 개인별 상세내역을 볼 수 있습니다.</span></div><div><button type="button">연도 2026</button><button type="button">필터</button></div></div><div className="data-table-wrap"><table className="data-table payroll-table"><thead><tr>{config.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{config.rows.map((row) => <tr key={row[0]} onClick={() => onSelectMonth(row[0])} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && onSelectMonth(row[0])}>{row.map((cell, index) => <td key={cell}>{index === 0 ? <button type="button" className="month-link">{cell}<span>상세 보기 →</span></button> : index === row.length - 1 ? <StatusPill value={cell} /> : cell}</td>)}</tr>)}</tbody></table></div></section></div>;
}

function PayrollMonthDetail({ month, onBack }: { month: string; onBack: () => void }) {
  return <div className="page-wrap detail-page"><button type="button" className="back-button" onClick={onBack}>← 급여월 현황</button><section className="module-hero"><div><p className="eyebrow">MONTHLY PAYROLL DETAIL</p><h1>{month} 급여 상세</h1><p>대상자 명단은 반영되었으며 급여 금액은 별도 자료 등록이 필요합니다.</p></div><div className="welcome-actions"><button type="button" className="outline-button">급여자료 가져오기</button><button type="button" className="primary-button">검토 시작</button></div></section><section className="payroll-summary"><div><span>급여 대상</span><strong>{payrollPeople.length}명</strong><small>재직자 기준</small></div><div><span>지급총액</span><strong>미입력</strong><small>급여 자료 필요</small></div><div><span>공제총액</span><strong>미입력</strong><small>급여 자료 필요</small></div><div><span>실지급액</span><strong>미입력</strong><small>급여 자료 필요</small></div></section><section className="panel table-panel"><div className="table-toolbar"><div><h2>개인별 급여 내역</h2><span>전체 {payrollPeople.length}명</span></div><div><button type="button">미입력만</button><button type="button">자료 가져오기</button></div></div><div className="data-table-wrap"><table className="data-table payroll-detail-table"><thead><tr>{["사번/ID", "직원", "부서", "기본급", "수당", "공제", "실지급액", "상태"].map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{payrollPeople.map((row) => <tr key={row[0]}>{row.map((cell, cellIndex) => <td key={`${row[0]}-${cellIndex}`}>{cell}</td>)}<td><StatusPill value="자료 미등록" /></td></tr>)}</tbody></table></div></section></div>;
}

function RecruitmentView({ applicants, query, onAdd, onSelect, onInterview, onReject }: { applicants: Applicant[]; query: string; onAdd: () => void; onSelect: (id: string) => void; onInterview: (applicant: Applicant) => void; onReject: (id: string) => void }) {
  const visible = query ? applicants.filter((applicant) => Object.values(applicant).some((value) => value.toLowerCase().includes(query.toLowerCase()))) : applicants;
  return <div className="page-wrap module-page"><section className="module-hero"><div><p className="eyebrow">RECRUITING PIPELINE</p><h1>지원자 관리</h1><p>진행 중인 채용공고의 지원자를 확인하고 다음 단계를 처리합니다.</p></div><button type="button" className="primary-button" onClick={onAdd}>+ 지원자 등록</button></section><section className="metric-grid module-metrics">{[{ label: "등록 지원자", value: `${applicants.length}명`, note: "실제 등록 기준" }, { label: "서류 검토", value: `${applicants.filter((item) => item.stage === "서류 검토").length}명`, note: "현재 단계 기준", tone: "blue" }, { label: "면접 예정", value: `${applicants.filter((item) => item.stage.includes("면접")).length}명`, note: "현재 단계 기준", tone: "orange" }, { label: "처우 협의", value: `${applicants.filter((item) => item.stage === "처우 협의").length}명`, note: "현재 단계 기준", tone: "green" }].map((metric) => <div className="compact-metric" key={metric.label}><span className={`metric-accent ${metric.tone ?? "navy"}`}></span><p>{metric.label}</p><h2>{metric.value}</h2><small>{metric.note}</small></div>)}</section><section className="panel table-panel"><div className="table-toolbar"><div><h2>지원 현황</h2><span>전체 지원자 {visible.length}명</span></div><div><button type="button">공고 전체</button><button type="button">단계 필터</button></div></div><div className="data-table-wrap"><table className="data-table applicant-table"><thead><tr><th>지원자</th><th>지원 직무</th><th>지원일</th><th>지원경로</th><th>경력</th><th>담당자</th><th>현재 단계</th><th>채용 처리</th></tr></thead><tbody>{visible.length ? visible.map((applicant) => <tr key={applicant.id}><td><button type="button" className="name-link" onClick={() => onSelect(applicant.id)}><span>{applicant.name.slice(0, 1)}</span>{applicant.name}</button></td><td>{applicant.role}</td><td>{applicant.applied}</td><td>{applicant.source}</td><td>{applicant.experience}</td><td>{applicant.owner}</td><td><StatusPill value={applicant.stage} /></td><td><div className="row-actions"><button type="button" className="interview-action" disabled={applicant.stage === "서류 탈락"} onClick={() => onInterview(applicant)}>면접 진행</button><button type="button" className="reject-action" disabled={applicant.stage === "서류 탈락"} onClick={() => onReject(applicant.id)}>서류 탈락</button></div></td></tr>) : <tr><td colSpan={8} className="empty-cell">등록된 지원자가 없습니다.</td></tr>}</tbody></table></div></section></div>;
}

function InterviewManagement({ interviews }: { interviews: InterviewRow[] }) {
  return <div className="page-wrap module-page"><section className="module-hero"><div><p className="eyebrow">INTERVIEWS</p><h1>면접관리</h1><p>지원자 관리에서 면접 진행한 후보자의 일정과 평가를 관리합니다.</p></div><button type="button" className="primary-button">+ 면접 등록</button></section><section className="metric-grid module-metrics">{[{ label: "오늘 면접", value: `${interviews.filter((item) => item.time.includes("오늘")).length}건`, note: "실제 등록 기준" }, { label: "전체 일정", value: `${interviews.length}건`, note: "새 일정 즉시 반영", tone: "blue" }, { label: "평가 미제출", value: "0건", note: "등록 자료 없음", tone: "orange" }, { label: "합격률", value: "미입력", note: "평가 자료 필요", tone: "green" }].map((metric) => <div className="compact-metric" key={metric.label}><span className={`metric-accent ${metric.tone ?? "navy"}`}></span><p>{metric.label}</p><h2>{metric.value}</h2><small>{metric.note}</small></div>)}</section><section className="panel table-panel"><div className="table-toolbar"><div><h2>면접 일정</h2><span>총 {interviews.length}건</span></div><div><button type="button">오늘</button><button type="button">이번 주</button></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>일시</th><th>지원자</th><th>직무</th><th>면접 유형</th><th>면접관</th><th>상태</th></tr></thead><tbody>{interviews.length ? interviews.map((item) => <tr key={item.id}><td>{item.time}</td><td>{item.name}</td><td>{item.role}</td><td>{item.type}</td><td>{item.interviewers}</td><td><StatusPill value={item.status} /></td></tr>) : <tr><td colSpan={6} className="empty-cell">등록된 면접 일정이 없습니다.</td></tr>}</tbody></table></div></section></div>;
}

function ApplicantDetail({ applicant, onClose, onInterview }: { applicant: Applicant; onClose: () => void; onInterview: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><div className="applicant-detail-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p>APPLICANT PROFILE</p><h2>지원자 상세</h2></div><button type="button" onClick={onClose}>×</button></div><div className="applicant-profile"><div className="profile-avatar">{applicant.name.slice(0, 1)}</div><div><h2>{applicant.name}</h2><p>{applicant.role} · {applicant.experience}</p></div><StatusPill value={applicant.stage} /></div><div className="applicant-facts"><div><span>이메일</span><strong>{applicant.email}</strong></div><div><span>연락처</span><strong>{applicant.phone}</strong></div><div><span>지원일</span><strong>{applicant.applied}</strong></div><div><span>지원 경로</span><strong>{applicant.source}</strong></div><div><span>담당자</span><strong>{applicant.owner}</strong></div><div><span>지원자 ID</span><strong>{applicant.id}</strong></div></div><div className="resume-summary"><span>AI 경력 요약</span><p>{applicant.summary}</p><div><em>직무 적합도 86%</em><em>경력 요건 충족</em><em>핵심역량 4개</em></div></div><div className="modal-actions"><button type="button" onClick={onClose}>닫기</button><button type="button" className="primary-button" onClick={onInterview}>면접 진행</button></div></div></div>;
}

function InterviewScheduleModal({ applicant, onClose, onSubmit }: { applicant: Applicant; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><form className="employee-modal schedule-modal" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p>SCHEDULE INTERVIEW</p><h2>면접 일정 등록</h2></div><button type="button" onClick={onClose}>×</button></div><div className="candidate-banner"><span>{applicant.name.slice(0, 1)}</span><div><strong>{applicant.name}</strong><small>{applicant.role} · {applicant.experience}</small></div><em>{applicant.id}</em></div><div className="form-grid"><label><span>면접일 *</span><input required name="date" type="date" defaultValue="2026-08-12" /></label><label><span>시작 시간 *</span><input required name="time" type="time" defaultValue="14:00" /></label><label><span>면접 유형 *</span><select name="type"><option>1차 대면</option><option>1차 화상</option><option>2차 대면</option><option>컬처핏 인터뷰</option></select></label><label><span>면접관 *</span><input required name="interviewers" defaultValue="최도영 외 1명" /></label><label className="wide"><span>장소 또는 화상 링크</span><input name="location" placeholder="회의실 B 또는 화상회의 링크" /></label></div><label className="form-note"><span>면접관 전달사항</span><textarea placeholder="확인할 역량이나 질문을 입력하세요."></textarea></label><div className="modal-actions"><button type="button" onClick={onClose}>취소</button><button type="submit" className="primary-button">일정 등록 및 면접관리로 이동</button></div></form></div>;
}

function PersonnelActionModal({ employee, ranks, organizations, onClose, onSubmit }: { employee: Employee; ranks: string[]; organizations: Organization[]; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  const [actionType, setActionType] = useState<PersonnelActionType>("인사이동(전보)");
  const departments = organizations.map((organization) => organization.name);
  const currentRank = ranks.indexOf(employee.position);
  const availableRanks = actionType === "승진"
    ? ranks.filter((_, index) => currentRank < 0 || index > currentRank)
    : ranks.filter((_, index) => currentRank < 0 || index < currentRank);
  const actionHelp = actionType === "인사이동(전보)"
    ? "현재 소속과 다른 부서로 이동합니다."
    : actionType === "승진"
      ? "현재보다 높은 직급으로 변경합니다."
      : "현재보다 낮은 직급으로 변경하며 정당한 사유가 반드시 필요합니다.";

  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><form className="employee-modal personnel-modal" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p>PERSONNEL ACTION</p><h2>인사 발령 등록</h2></div><button type="button" onClick={onClose}>×</button></div><div className="candidate-banner"><span>{employee.name.slice(0, 1)}</span><div><strong>{employee.name}</strong><small>{employee.department} · {employee.position}</small></div><em>{employee.id}</em></div><div className="form-grid"><label><span>시행일 *</span><input required name="effectiveDate" type="date" defaultValue="2026-09-01" /></label><label><span>발령 구분 *</span><select required name="actionType" value={actionType} onChange={(event) => setActionType(event.target.value as PersonnelActionType)}><option>인사이동(전보)</option><option>승진</option><option>강등</option></select></label><div className="action-type-help wide"><strong>{actionType}</strong><span>{actionHelp}</span></div>{actionType === "인사이동(전보)" ? <label className="wide"><span>이동할 부서 *</span><select required name="targetDepartment" defaultValue=""><option value="" disabled>부서 선택</option>{departments.filter((department) => department !== employee.department).map((department) => <option key={department}>{department}</option>)}</select><input type="hidden" name="targetPosition" value={employee.position} /></label> : <label className="wide"><span>변경 직급 *</span><select required name="targetPosition" defaultValue=""><option value="" disabled>직급 선택</option>{availableRanks.map((rank) => <option key={rank}>{rank}</option>)}</select><input type="hidden" name="targetDepartment" value={employee.department} /></label>}</div><label className={`form-note ${actionType === "강등" ? "personnel-note-required" : ""}`}><span>{actionType === "강등" ? "강등 사유 *" : "발령 사유 및 내용"}</span><textarea required={actionType === "강등"} name="note" placeholder={actionType === "강등" ? "강등의 정당한 사유와 근거를 구체적으로 입력하세요." : "발령 배경이나 전달사항을 입력하세요."}></textarea>{actionType === "강등" && <small>강등은 정당한 사유와 객관적인 근거가 확인되어야 등록할 수 있습니다.</small>}</label><div className="modal-actions"><button type="button" onClick={onClose}>취소</button><button type="submit" className="primary-button">인사 발령 등록</button></div></form></div>;
}

function RetirementModal({ employee, onClose, onSubmit }: { employee: Employee; onClose: () => void; onSubmit: (record: RetirementRecord) => void }) {
  const [date, setDate] = useState(employee.retirement?.date ?? "2026-09-30");
  const [reason, setReason] = useState(employee.retirement?.reason ?? "");
  const [completedTaskIds, setCompletedTaskIds] = useState<string[]>(employee.retirement?.completedTaskIds ?? []);
  const totalTasks = retirementChecklist.hr.length + retirementChecklist.employee.length;
  const progress = Math.round((completedTaskIds.length / totalTasks) * 100);

  function toggleTask(id: string) {
    setCompletedTaskIds((value) => value.includes(id) ? value.filter((taskId) => taskId !== id) : [...value, id]);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit({ date, reason: reason.trim(), completedTaskIds });
  }

  const ChecklistGroup = ({ title, owner, tasks }: { title: string; owner: string; tasks: { id: string; label: string }[] }) => (
    <section className="retirement-checklist-group">
      <div className="checklist-group-heading"><div><p>{owner}</p><h3>{title}</h3></div><span>{tasks.filter((task) => completedTaskIds.includes(task.id)).length}/{tasks.length}</span></div>
      <div className="retirement-task-list">{tasks.map((task) => <label key={task.id} className={completedTaskIds.includes(task.id) ? "checked" : ""}><input type="checkbox" checked={completedTaskIds.includes(task.id)} onChange={() => toggleTask(task.id)} /><span className="task-check">✓</span><strong>{task.label}</strong></label>)}</div>
    </section>
  );

  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><form className="employee-modal retirement-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p>RETIREMENT PROCESS</p><h2>퇴직 절차 관리</h2></div><button type="button" onClick={onClose}>×</button></div><div className="candidate-banner"><span>{employee.name.slice(0, 1)}</span><div><strong>{employee.name}</strong><small>{employee.department} · {employee.position}</small></div><em>{employee.id}</em></div><div className="retirement-fields"><label><span>퇴직일 *</span><input required type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label><span>퇴직사유 *</span><textarea required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="퇴직 사유와 참고사항을 입력하세요."></textarea></label></div><div className="retirement-progress"><div><span>퇴직 절차 체크리스트</span><strong>{completedTaskIds.length}/{totalTasks} 완료</strong></div><div className="retirement-progress-track"><i style={{ width: `${progress}%` }}></i></div><small>{progress === 100 ? "모든 퇴직 절차를 완료했습니다." : `미완료 업무 ${totalTasks - completedTaskIds.length}건이 남아 있습니다.`}</small></div><div className="retirement-checklist-grid"><ChecklistGroup title="인사담당자 수행 업무" owner="HR OWNER" tasks={retirementChecklist.hr} /><ChecklistGroup title="퇴직자 수행 업무" owner="EMPLOYEE" tasks={retirementChecklist.employee} /></div><div className="modal-actions"><button type="button" onClick={onClose}>취소</button><button type="submit" className="primary-button">퇴직 절차 저장</button></div></form></div>;
}

function SettingsView({ employees, onSave, onNotify }: { employees: Employee[]; onSave: () => void; onNotify: (message: string) => void }) {
  const [section, setSection] = useState("company");
  const [authorizedUserIds, setAuthorizedUserIds] = useState<string[]>([]);
  const [candidateId, setCandidateId] = useState("");
  const [permissionsLoading, setPermissionsLoading] = useState(true);
  const activeEmployees = employees.filter((employee) => employee.status !== "퇴직");
  const availableEmployees = activeEmployees.filter((employee) => !authorizedUserIds.includes(employee.id));

  useEffect(() => {
    let cancelled = false;
    async function loadAuthorizedUsers() {
      try {
        const response = await fetch("/api/hr/authorized-users");
        const payload = await response.json() as { users?: { employeeId: string }[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "사용자 권한을 불러오지 못했습니다.");
        if (!cancelled) setAuthorizedUserIds((payload.users ?? []).map((user) => user.employeeId));
      } catch (error) {
        if (!cancelled) onNotify(error instanceof Error ? error.message : "사용자 권한을 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setPermissionsLoading(false);
      }
    }
    loadAuthorizedUsers();
    return () => { cancelled = true; };
  }, []);

  async function addAuthorizedUser(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!candidateId) return;
    const response = await fetch("/api/hr/authorized-users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId: candidateId }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) {
      onNotify(payload.error ?? "사용자를 추가하지 못했습니다.");
      return;
    }
    setAuthorizedUserIds((value) => value.includes(candidateId) ? value : [...value, candidateId]);
    setCandidateId("");
    onNotify("사용자 권한을 추가했습니다.");
  }

  async function removeAuthorizedUser(employeeId: string) {
    const response = await fetch("/api/hr/authorized-users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) {
      onNotify(payload.error ?? "사용자 권한을 삭제하지 못했습니다.");
      return;
    }
    setAuthorizedUserIds((value) => value.filter((id) => id !== employeeId));
    onNotify("사용자 권한을 삭제했습니다.");
  }

  const sectionTitle = section === "company"
    ? "회사·조직 정보"
    : section === "hr"
      ? "인사 기준정보"
      : section === "notifications"
        ? "알림 설정"
        : section === "permissions"
          ? "사용자·권한"
          : "데이터·백업";

  return <div className="page-wrap settings-page">
    <section className="module-hero">
      <div><p className="eyebrow">WORKSPACE SETTINGS</p><h1>환경설정</h1><p>회사 정보, 인사 기준, 알림과 접근 권한을 설정합니다.</p></div>
      <button type="button" className="primary-button" onClick={onSave}>변경사항 저장</button>
    </section>
    <div className="settings-layout">
      <aside className="panel settings-nav">
        {[["company", "회사·조직 정보"], ["hr", "인사 기준정보"], ["notifications", "알림 설정"], ["permissions", "사용자·권한"], ["data", "데이터·백업"]].map(([id, label]) => <button type="button" className={section === id ? "active" : ""} key={id} onClick={() => setSection(id)}>{label}<span>›</span></button>)}
      </aside>
      <section className="panel settings-content">
        <div className="detail-card-heading"><div><p className="eyebrow">{section.toUpperCase()}</p><h2>{sectionTitle}</h2></div></div>
        {section === "company" && <div className="settings-form"><label><span>회사명</span><input defaultValue="XD NODE" /></label><label><span>대표자</span><input defaultValue="이정민" /></label><label><span>사업자등록번호</span><input defaultValue="123-45-67890" /></label><label><span>기본 근무지</span><input defaultValue="서울 본사" /></label><label className="wide"><span>회사 주소</span><input defaultValue="서울특별시 성동구 아차산로 00" /></label></div>}
        {section === "hr" && <div className="setting-list"><SettingToggle title="사번 자동 발급" description="입사연도와 순번으로 사번을 자동 생성합니다." checked /><SettingToggle title="수습기간 종료 알림" description="종료 14일 전에 담당자와 부서장에게 알립니다." checked /><SettingToggle title="급여 마감 후 수정 제한" description="마감된 급여는 급여관리자만 다시 열 수 있습니다." checked /></div>}
        {section === "notifications" && <div className="setting-list"><SettingToggle title="시스템 알림" description="업무 마감과 승인 요청을 알림센터에서 받습니다." checked /><SettingToggle title="이메일 알림" description="중요 HR 일정을 이메일로도 받습니다." checked /><SettingToggle title="미처리 업무 재알림" description="기한이 지난 업무를 매일 오전 다시 알립니다." checked={false} /></div>}
        {section === "permissions" && <div className="permission-management">
          <form className="permission-add-form" onSubmit={addAuthorizedUser}>
            <label><span>회사 등록 인물</span><select value={candidateId} onChange={(event) => setCandidateId(event.target.value)} disabled={permissionsLoading || availableEmployees.length === 0}><option value="">{availableEmployees.length === 0 ? "추가 가능한 인물이 없습니다" : "사용자 선택"}</option>{availableEmployees.map((employee) => <option value={employee.id} key={employee.id}>{employee.name} · {employee.department}</option>)}</select></label>
            <button type="submit" className="primary-button" disabled={!candidateId}>사용자 추가</button>
          </form>
          <p className="permission-help">회사 인사기록에 등록된 재직자만 ERP 사용자로 추가할 수 있습니다.</p>
          <div className="permission-list">
            {permissionsLoading && <div className="permission-loading">사용자 권한을 불러오는 중입니다.</div>}
            {!permissionsLoading && authorizedUserIds.map((employeeId) => {
              const employee = employees.find((item) => item.id === employeeId);
              if (!employee) return null;
              const isCurrentAdministrator = employeeId === "gc.kim";
              return <div key={employeeId}>
                <span className="owner-chip">{employee.name.slice(0, 1)}</span>
                <p><strong>{employee.name}</strong><small>{employee.department} · 전체 ERP 접근</small></p>
                <div className="permission-row-actions"><em>관리자</em>{isCurrentAdministrator ? <span className="permission-current">현재 사용자</span> : <button type="button" onClick={() => removeAuthorizedUser(employeeId)}>삭제</button>}</div>
              </div>;
            })}
          </div>
        </div>}
        {section === "data" && <div className="data-settings"><div><strong>마지막 자동 백업</strong><span>오늘 03:00 · 정상 완료</span><button type="button" onClick={onSave}>지금 백업</button></div><div><strong>개인정보 보유기간</strong><span>퇴사 후 3년 · 관리자 확인 필요</span><button type="button">정책 관리</button></div><div><strong>엑셀 데이터 가져오기</strong><span>직원·급여·교육 표준양식 지원</span><button type="button">가져오기</button></div></div>}
      </section>
    </div>
  </div>;
}

function SettingToggle({ title, description, checked }: { title: string; description: string; checked: boolean }) {
  const [enabled, setEnabled] = useState(checked);
  return <button type="button" className="setting-toggle" onClick={() => setEnabled((value) => !value)}><div><strong>{title}</strong><span>{description}</span></div><i className={enabled ? "on" : ""}><em></em></i></button>;
}

function Dashboard({ employees, organizations, applicants, onNavigate }: { employees: Employee[]; organizations: Organization[]; applicants: Applicant[]; onNavigate: (id: string) => void }) {
  const currentEmployees = employees.filter((employee) => employee.status !== "퇴직");
  const employeeCount = currentEmployees.length;
  const hiresThisMonth = currentEmployees.filter((employee) => employee.joinDate.startsWith("2026.08")).length;
  const incompleteProfiles = currentEmployees.filter((employee) => [employee.email, employee.phone, employee.birth, employee.address].some((value) => !value || value === "미입력")).length;
  const employmentTypes = Object.entries(currentEmployees.reduce<Record<string, number>>((counts, employee) => ({ ...counts, [employee.type]: (counts[employee.type] ?? 0) + 1 }), {}));
  const tasks: { label: string; meta: string; owner: string; tone: string }[] = [];
  return (
    <div className="page-wrap dashboard-page">
      <section className="welcome-row">
        <div>
          <p className="eyebrow">XDNODE PEOPLE DATA</p>
          <h1>실제 인사 데이터가 반영되었습니다.</h1>
          <p>재직자 <strong>{employeeCount}명</strong> 중 필수정보 확인이 필요한 인원은 <strong>{incompleteProfiles}명</strong>입니다.</p>
        </div>
        <div className="welcome-actions">
          <button type="button" className="outline-button" onClick={() => onNavigate("reports")}>월간 리포트</button>
          <button type="button" className="primary-button" onClick={() => onNavigate("schedule")}>오늘 일정 보기</button>
        </div>
      </section>

      <section className="metric-grid">
        <button type="button" className="metric-card" onClick={() => onNavigate("employees")}>
          <div className="metric-top"><span className="metric-icon navy">인</span><em>+{hiresThisMonth} this month</em></div>
          <p>전체 재직자</p><h2>{employeeCount}<small>명</small></h2>
          <div className="mini-bar"><span style={{ width: "100%" }}></span></div>
          <small>하이웍스 원본 기준 · 2026년 8월 입사 {hiresThisMonth}명</small>
        </button>
        <button type="button" className="metric-card" onClick={() => onNavigate("recruitment")}>
          <div className="metric-top"><span className="metric-icon blue">채</span><em>NO SAMPLE DATA</em></div>
          <p>등록 지원자</p><h2>{applicants.length}<small>명</small></h2>
          <div className="stage-dots"><span></span><span></span><span></span><span></span><i></i></div>
          <small>기존 샘플 채용 데이터 삭제 완료</small>
        </button>
        <button type="button" className="metric-card" onClick={() => onNavigate("performance")}>
          <div className="metric-top"><span className="metric-icon purple">목</span><em>NOT REGISTERED</em></div>
          <p>평가 데이터</p><h2>0<small>건</small></h2>
          <div className="mini-bar purple"><span style={{ width: "0%" }}></span></div>
          <small>실제 평가 자료 등록 필요</small>
        </button>
        <button type="button" className="metric-card" onClick={() => onNavigate("training")}>
          <div className="metric-top"><span className="metric-icon green">교</span><em>NOT REGISTERED</em></div>
          <p>교육 데이터</p><h2>0<small>건</small></h2>
          <div className="mini-bar green"><span style={{ width: "0%" }}></span></div>
          <small>실제 교육 자료 등록 필요</small>
        </button>
      </section>

      <section className="dashboard-grid">
        <div className="panel work-panel">
          <div className="section-heading"><div><p className="eyebrow">MY WORK QUEUE</p><h2>오늘의 우선 업무</h2></div><button type="button" onClick={() => onNavigate("schedule")}>전체 업무 →</button></div>
          <div className="task-list">
            {tasks.length === 0 ? <div className="empty-cell">등록된 HR 업무가 없습니다.</div> : tasks.map((task) => (
              <div className="task-row" key={task.label}>
                <button type="button" className="check-button" aria-label={`${task.label} 완료 처리`}></button>
                <span className={`task-marker ${task.tone}`}></span>
                <div className="task-copy"><strong>{task.label}</strong><small>{task.meta}</small></div>
                <div className="owner-chip">{task.owner.slice(0, 1)}</div>
                <button type="button" className="more-button" aria-label="업무 메뉴">•••</button>
              </div>
            ))}
          </div>
          <div className="queue-footer"><span><b>0</b> / 0 tasks completed</span><div><i style={{ width: "0%" }}></i></div><strong>0%</strong></div>
        </div>

        <div className="panel schedule-panel">
          <div className="section-heading"><div><p className="eyebrow">UPCOMING</p><h2>다가오는 일정</h2></div><button type="button" onClick={() => onNavigate("schedule")}>캘린더 →</button></div>
          <div className="date-strip"><button>10<span>월</span></button><button className="active">11<span>화</span></button><button>12<span>수</span></button><button>13<span>목</span></button><button>14<span>금</span></button></div>
          <div className="agenda-list"><div className="empty-cell">등록된 HR 일정이 없습니다.</div></div>
        </div>

        <div className="panel workforce-panel">
          <div className="section-heading"><div><p className="eyebrow">HEADCOUNT</p><h2>조직별 인원 현황</h2></div><button type="button" onClick={() => onNavigate("workforce")}>정원 관리 →</button></div>
          <div className="headcount-chart">
            {organizations.map((organization) => {
              const count = currentEmployees.filter((employee) => employee.department === organization.name).length;
              return (
              <div className="headcount-row" key={organization.id}><span>{organization.name}</span><div><i style={{ width: `${employeeCount ? Math.max(8, Math.round((count / employeeCount) * 100)) : 0}%` }}></i></div><strong>{count}<small>명</small></strong></div>
              );
            })}
          </div>
          <div className="headcount-summary"><div><span>현재 인원</span><strong>{employeeCount}</strong></div><div><span>운영 조직</span><strong>{organizations.length}</strong></div><div><span>소속 미지정</span><strong className="accent">{currentEmployees.filter((employee) => employee.department === "소속 미지정").length}</strong></div></div>
        </div>

        <div className="panel insights-panel">
          <div className="section-heading"><div><p className="eyebrow">PEOPLE INSIGHT</p><h2>이번 달 주요 변화</h2></div><button type="button" onClick={() => onNavigate("reports")}>분석 보기 →</button></div>
          <div className="donut-wrap">
            <div className="donut"><div><strong>{employeeCount}</strong><span>재직자</span></div></div>
            <ul>{employmentTypes.map(([type, count], index) => <li key={type}><span className={`legend ${index === 0 ? "navy" : index === 1 ? "blue" : "pale"}`}></span><p>{type}<strong>{count}명</strong></p></li>)}</ul>
          </div>
          <div className="insight-note"><span>✓</span><p><strong>실제 재직자 데이터 {employeeCount}명을 불러왔습니다.</strong><small>증감률은 이전 기간 자료가 등록되면 계산됩니다.</small></p></div>
        </div>
      </section>
    </div>
  );
}

function ModuleView({ config, rows, query, onPrimary }: { config: ModuleConfig; rows: string[][]; query: string; onPrimary: () => void }) {
  return (
    <div className="page-wrap module-page">
      <section className="module-hero">
        <div><p className="eyebrow">{config.eyebrow}</p><h1>{config.title}</h1><p>{config.description}</p></div>
        <button type="button" className="primary-button" onClick={onPrimary}>+ {config.action}</button>
      </section>
      <section className="metric-grid module-metrics">
        {config.metrics.map((metric) => (
          <div className="compact-metric" key={metric.label}><span className={`metric-accent ${metric.tone ?? "navy"}`}></span><p>{metric.label}</p><h2>{metric.value}</h2><small>{metric.note}</small></div>
        ))}
      </section>
      <section className="panel table-panel">
        <div className="table-toolbar">
          <div><h2>{query ? `“${query}” 검색 결과` : "최근 현황"}</h2><span>총 {rows.length}개의 항목</span></div>
          <div><button type="button">필터</button><button type="button">표시 항목</button><button type="button">•••</button></div>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr>{config.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
            <tbody>
              {rows.length > 0 ? rows.map((row, rowIndex) => (
                <tr key={`${row[0]}-${rowIndex}`}>
                  {row.map((cell, cellIndex) => <td key={`${cell}-${cellIndex}`}>{cellIndex === row.length - 1 ? <StatusPill value={cell} /> : cell}</td>)}
                </tr>
              )) : <tr><td colSpan={config.columns.length} className="empty-cell">검색 결과가 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="table-footer"><span>1–{rows.length} / {rows.length}</span><div><button disabled>←</button><button className="current">1</button><button disabled>→</button></div></div>
      </section>
    </div>
  );
}
