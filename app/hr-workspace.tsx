"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { companyEmployees, companyJobTitles, companyOrganizations, companyRanks } from "./hr-company-data";
import WorkforcePlanningView from "./workforce-planning-view";
import RecruitmentRequisitionView from "./recruitment-requisition-view";
import PerformanceManagementView from "./performance-management-view";
import TrainingManagementView from "./training-management-view";
import HrAnalyticsView from "./hr-analytics-view";
import AudioTranscriptionControl from "./audio-transcription-control";
import MasterImpactDialog from "./master-impact-dialog";
import WonInput from "./won-input";

export default function HRWorkspace({ requestedView = "dashboard", navigationRequestKey = 0 }: { requestedView?: string; navigationRequestKey?: number }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<ShadowRoot | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    setRoot(hostRef.current.shadowRoot ?? hostRef.current.attachShadow({ mode: "open" }));
  }, []);

  return (
    <div className="peopleflow-host" ref={hostRef}>
      {root ? createPortal(
        <>
          <link rel="stylesheet" href="/hr-workspace.css" />
          <XdnodeHrApp requestedView={requestedView} navigationRequestKey={navigationRequestKey} />
        </>,
        root,
      ) : (
        // The shadow root only exists once the first effect has run, and the stylesheet it pulls in
        // loads after that again. Without this the module renders nothing for that whole stretch,
        // which reads as a hang rather than as loading.
        <div className="peopleflow-loading" role="status">
          <span className="peopleflow-loading-mark" aria-hidden="true">HR</span>
          <strong>HR 워크스페이스를 불러오는 중입니다</strong>
          <small>인사기록·조직·급여 데이터를 준비하고 있습니다.</small>
        </div>
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

type PayrollSummary = {
  yearMonth: string;
  employeeCount: number;
  grossPay: number;
  deductions: number;
  netPay: number;
  status: "DRAFT" | "REVIEW" | "APPROVED" | "LOCKED";
  /** 그 달 임금안의 상태. 목록에 있는데 DRAFT 면 확정 뒤 다시 연 "수정 중"이다. */
  compensationStatus?: string;
  preparedBy: string;
  reviewedBy: string;
  approvedBy: string;
  lockedAt: number | null;
};

type PayrollRecord = {
  id: string;
  yearMonth: string;
  employeeId: string | null;
  employeeName: string;
  department: string | null;
  annualSalary: number;
  basePay: number;
  mealAllowance: number;
  childcareAllowance: number;
  vehicleAllowance: number;
  incentive: number;
  bonus: number;
  annualLeavePay: number;
  personalExpense?: number;
  retirementPay: number;
  deductions: number;
  grossPay: number;
  netPay: number;
  cardAllowance: number;
  cardUsage: number;
  personalPurchase: number;
  nonTaxable: number;
  welfareFund: number;
  notes: string;
  /** 급여대장의 항목별 공제. 공제 열 제목을 누르면 이 내역이 펼쳐진다. */
  deductionDetail?: Record<string, number>;
  sourceSheet: string;
  sourceRow: number;
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
      { id: "documents", label: "인사문서", icon: "문" },
      { id: "onboarding", label: "입·퇴사 관리", icon: "입" },
      { id: "workforce", label: "인력계획·정원", icon: "계" },
    ],
  },
  {
    title: "채용",
    items: [
      { id: "requisitions", label: "채용요청·TO", icon: "요" },
      { id: "recruitment", label: "지원자 관리", icon: "채" },
      { id: "recruiters", label: "채용담당자 관리", icon: "담" },
    ],
  },
  {
    title: "성장과 분석",
    items: [
      { id: "performance", label: "성과·목표", icon: "목" },
      { id: "training", label: "교육·법정교육", icon: "교" },
      { id: "reports", label: "통계·리포트", icon: "통" },
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
    columns: ["직원", "소속", "직위", "고용형태", "입사일", "상태"],
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
  requestId?: string;
  date: string;
  reason: string;
  completedTaskIds: string[];
  status?: string;
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
  annualSalary: number;
  basePay: number;
  mealAllowance: number;
  childcareAllowance: number;
  vehicleAllowance: number;
};

function isCurrentEmployee(employee: Employee, now = Date.now()) {
  if (employee.status.trim() === "퇴직") return false;
  const retirementStatus = employee.retirement?.status ?? "";
  if (["EFFECTIVE", "COMPLETED"].includes(retirementStatus)) return false;
  if (!["IN_PROGRESS", "READY"].includes(retirementStatus) || !employee.retirement?.date) return true;
  const koreaDate = new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return employee.retirement.date.replaceAll(".", "-") > koreaDate;
}

type EmployeeInterviewRecord = {
  id: string;
  employeeId: string;
  interviewAt: string;
  transcript: string;
  memo: string;
  audioFileName: string | null;
  audioUrl: string | null;
  consentConfirmed: boolean;
  createdAt: number;
};

type ApplicantInterviewRecording = {
  id: string;
  applicantId: string;
  recordedAt: string;
  audioFileName: string;
  audioUrl: string;
  consentConfirmed: boolean;
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
  ownerId: string;
  resumeFileName: string;
  resumeText: string;
  checklist: string[];
  screeningMemos: RecruitmentNote[];
  interview?: InterviewSchedule;
  interviewMemos: RecruitmentNote[];
  requisitionId: string;
  offer?: RecruitmentOffer;
};

type RecruitmentRequisitionOption = {
  id: string;
  title: string;
  role: string;
  organizationId: string;
  requestedHeadcount: number;
  status: string;
};

type RecruitmentOffer = {
  id: string;
  applicantId: string;
  proposedTitle: string;
  department: string;
  employmentType: string;
  startDate: string;
  annualSalary: number;
  probationMonths: number;
  notes: string;
  status: string;
  requestedBy: string;
  approvedBy: string;
  approvedAt: number | null;
  employeeId: string;
  position: string;
  jobTitle: string;
  responseNote: string;
  respondedBy: string;
  respondedAt: number | null;
  cancellationReason: string;
  cancelledBy: string;
  cancelledAt: number | null;
  onboardedBy: string;
  onboardedAt: number | null;
};

type RecruitmentOfferDraft = Pick<RecruitmentOffer, "proposedTitle" | "department" | "employmentType" | "startDate" | "annualSalary" | "probationMonths" | "notes">;

type ResumeAnalysis = {
  name: string;
  email: string;
  phone: string;
  role: string;
  experience: string;
  summary: string;
  warnings: string[];
};

type RecruitmentNote = {
  id: string;
  text: string;
  author: string;
  createdAt: string;
};

type InterviewSchedule = {
  date: string;
  time: string;
  type: string;
  interviewers: string;
  location: string;
  note: string;
};

// 서류 심사 결과는 별도 컬럼이 아니라 stage 에서 읽는다. 지원 등록 직후의 "서류 검토"는 아직 아무도
// 합불을 누르지 않은 상태이고, "서류 탈락"만 명시적 탈락이다. 그 밖의 단계는 모두 서류를 통과한 뒤의
// 진행 상태이므로(면접 탈락·입사 취소 포함) 서류 기준으로는 합격으로 본다.
const SCREENING_PENDING_STAGE = "서류 검토";
const SCREENING_PASSED_STAGE = "서류 합격";
const SCREENING_REJECTED_STAGE = "서류 탈락";

function screeningResultOf(applicant: Applicant): "PENDING" | "PASSED" | "REJECTED" {
  if (applicant.stage === SCREENING_REJECTED_STAGE) return "REJECTED";
  if (applicant.stage === SCREENING_PENDING_STAGE) return "PENDING";
  return "PASSED";
}

const screeningLabels: Record<"PENDING" | "PASSED" | "REJECTED", string> = {
  PENDING: "서류 평가중", PASSED: "서류 합격", REJECTED: "서류 탈락",
};

function interviewScheduleLabel(applicant: Applicant) {
  const schedule = applicant.interview;
  if (!schedule || ![schedule.date, schedule.time, schedule.interviewers, schedule.location].some(Boolean)) return "";
  return [schedule.date || "일자 미정", schedule.time || "시간 미정", schedule.type || "유형 미정"].join(" · ");
}

const INTERVIEW_REJECTED_STAGE = "면접 탈락";
const INTERVIEW_NO_SHOW_STAGE = "면접 불참 탈락";
// 면접에서 합격을 누른 상태. 처우를 아직 제안하지 않았어도 여기서부터 처우 제안 단계가 열린다.
const INTERVIEW_PASSED_STAGE = "면접 합격";
// 처우 입력 이후의 단계들. 여기까지 온 사람은 면접을 본 것이다.
const OFFER_PREPARED_STAGE = "채용 제안 준비";
// 지원자가 다른 회사에 합격해 채용이 끝난 상태. 우리가 떨어뜨린 것이 아니라 "탈락"과 구분해 둔다.
const OTHER_OFFER_STAGE = "타사 합격";
const OFFER_STAGES = [INTERVIEW_PASSED_STAGE, OFFER_PREPARED_STAGE, "입사 예정", "채용 제안 거절", OTHER_OFFER_STAGE];
// 서류 탈락까지 포함한 탈락 상태들. 탈락자 표와 채용단계 표기가 이 목록을 쓴다.
const REJECTED_STAGES = [SCREENING_REJECTED_STAGE, INTERVIEW_REJECTED_STAGE, INTERVIEW_NO_SHOW_STAGE];

/** 더 손댈 일이 없는 단계들. 지원 현황에서는 빼고 페이지 맨 아래 "채용 종료" 표로 모은다.
 *  탈락뿐 아니라 제안 거절·타사 합격·입사 확정도 여기 들어간다 — 진행 중인 사람만 위에 남긴다. */
const CLOSED_STAGES = [
  ...REJECTED_STAGES,
  "채용 제안 거절", "채용 제안 종료", OTHER_OFFER_STAGE, "입사 예정", "입사 완료",
];

/** 채용 종료 표의 "종료 구분" 칸. 왜 끝났는지를 한 단어로 적는다. */
function closedReasonOf(applicant: Applicant) {
  if (applicant.stage === OTHER_OFFER_STAGE) return { label: "타사 합격", tone: "other" };
  if (REJECTED_STAGES.includes(applicant.stage)) return { label: applicant.stage, tone: "reject" };
  if (applicant.stage === "입사 예정" || applicant.stage === "입사 완료") return { label: "오퍼 수락", tone: "join" };
  return { label: "제안 거절", tone: "decline" };
}

type RecruitStage = "PENDING" | "PASSED" | "REJECTED" | "INTERVIEW" | "OTHER_OFFER";

/** 채용단계 열. 탈락한 사람은 사유와 무관하게 "탈락" 하나로 묶는다 — 어디서 떨어졌는지는
 *  현재 단계 열과 탈락자 표의 "탈락 단계"에 남는다. 처우 단계까지 간 사람은 "면접"이다.
 *  타사 합격은 우리 판단이 아니라 지원자 사정으로 끝난 것이라 따로 적는다. */
function recruitStageOf(applicant: Applicant): RecruitStage {
  if (applicant.stage === OTHER_OFFER_STAGE) return "OTHER_OFFER";
  if (REJECTED_STAGES.includes(applicant.stage)) return "REJECTED";
  if (applicant.stage === SCREENING_PENDING_STAGE) return "PENDING";
  if (OFFER_STAGES.includes(applicant.stage)) return "INTERVIEW";
  return "PASSED";
}

const recruitStageLabels: Record<RecruitStage, string> = {
  PENDING: "서류 평가중", PASSED: "서류 합격", REJECTED: "탈락", INTERVIEW: "면접", OTHER_OFFER: OTHER_OFFER_STAGE,
};

/** 현재 단계 열. 면접 단계에서 내린 탈락은 불참이든 아니든 "면접 탈락"으로 적고,
 *  진행 중이면서 면접 일정이 잡혔으면 그 일정을 보여준다.
 *  불참인지 아닌지는 채용단계 열에서 서류 합격 / 면접으로 갈린다. */
function currentStageOf(applicant: Applicant) {
  if (applicant.stage === INTERVIEW_REJECTED_STAGE || applicant.stage === INTERVIEW_NO_SHOW_STAGE) return INTERVIEW_REJECTED_STAGE;
  // 처우까지 제안했으면 면접 절차는 끝난 것이라 "면접 종료"로 적는다. 합격만 누르고 아직
  // 처우를 제안하지 않았으면 "면접 합격" 그대로 둔다 — 그 둘은 해야 할 일이 다르다.
  // 입사 예정·제안 거절·타사 합격은 그 뒤의 별개 상태라 단계 이름을 그대로 보여준다.
  if (applicant.stage === OFFER_PREPARED_STAGE) return "면접 종료";
  // 면접 이후 단계(면접 합격·입사 예정·제안 거절·타사 합격)는 단계 이름을 그대로 보여준다.
  // 이 갈래가 없으면 절차가 끝난 사람에게도 지난 면접 일정이 계속 현재 단계로 뜬다.
  if (OFFER_STAGES.includes(applicant.stage)) return applicant.stage;
  const schedule = interviewScheduleLabel(applicant);
  if (screeningResultOf(applicant) === "PASSED" && schedule) return schedule;
  return applicant.stage;
}

/** 면접 일시 정렬용 키. 일자나 시간이 비어 있으면 뒤로 보낸다. */
function interviewSortKey(applicant: Applicant) {
  const schedule = applicant.interview;
  return `${schedule?.date || "9999-99-99"} ${schedule?.time || "99:99"}`;
}


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

type PersistedOrganizationRecord = {
  organizationId: string;
  name: string;
  description: string;
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
  joinDate: string;
  position: string;
  jobTitle: string;
  status: string;
  history: Employee["history"];
  retirement?: RetirementRecord;
  annualSalary: number;
  basePay: number;
  mealAllowance: number;
  childcareAllowance: number;
  vehicleAllowance: number;
};

type PersistedRetirementRequest = {
  id: string;
  employee_id: string;
  retirement_date: string;
  reason: string;
  status: string;
  checklist_json: string;
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

const initialApplicants: Applicant[] = [];


function StatusPill({ value }: { value: string }) {
  const kind = value.includes("완료") || value.includes("반영") || value.includes("재직") || value === "마감" ? "success" : value.includes("초과") || value.includes("휴직") ? "danger" : "pending";
  return <span className={`status-pill ${kind}`}>{value}</span>;
}

function XdnodeHrApp({ requestedView, navigationRequestKey }: { requestedView: string; navigationRequestKey: number }) {
  const [active, setActive] = useState(requestedView);
  const [employeeModalOpen, setEmployeeModalOpen] = useState(false);
  const [applicantModalOpen, setApplicantModalOpen] = useState(false);
  const [toast, setToast] = useState("");

  useEffect(() => {
    setActive(requestedView);
  }, [requestedView, navigationRequestKey]);
  const [query, setQuery] = useState("");
  const [employees, setEmployees] = useState(initialEmployees);
  const [organizations, setOrganizations] = useState(initialOrganizations);
  const [ranks, setRanks] = useState(initialRanks);
  const [jobTitles, setJobTitles] = useState(initialJobTitles);
  const [applicants, setApplicants] = useState(initialApplicants);
  const [recruiterIds, setRecruiterIds] = useState<string[]>(["gc.kim"]);
  const [requisitions, setRequisitions] = useState<RecruitmentRequisitionOption[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [selectedPayrollMonth, setSelectedPayrollMonth] = useState<string | null>(null);
  const [selectedApplicantId, setSelectedApplicantId] = useState<string | null>(null);
  const [personnelAction, setPersonnelAction] = useState<string | null>(null);
  const [retirementOpen, setRetirementOpen] = useState(false);
  const [resumeStatus, setResumeStatus] = useState<"idle" | "analyzing" | "done" | "error">("idle");
  const [resumeMessage, setResumeMessage] = useState("");
  // 어떤 제공자가 지금 화면의 값을 만들었는지, 그리고 로컬 AI 재분석 버튼을 띄울 수 있는지.
  const [resumeProvider, setResumeProvider] = useState("");
  const [localAiAvailable, setLocalAiAvailable] = useState(false);
  const [applicantDraft, setApplicantDraft] = useState({ name: "", role: "", email: "", phone: "", experience: "", source: "직접 등록", summary: "", resumeFileName: "", resumeText: "", requisitionId: "" });

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
    const loadOrganizations = fetch("/api/hr/organizations").then(async (response) => {
      const data = await response.json() as { organizations?: PersistedOrganizationRecord[]; error?: string };
      if (!response.ok) throw new Error(data.error || "조직 정보를 불러오지 못했습니다.");
      return data.organizations ?? [];
    }).catch(() => null);
    const loadRetirements = fetch("/api/hr/operations").then(async (response) => {
      const data = await response.json() as { retirementRequests?: PersistedRetirementRequest[]; error?: string };
      if (!response.ok) throw new Error(data.error || "퇴직 절차를 불러오지 못했습니다.");
      return data.retirementRequests ?? [];
    }).catch(() => null);

    Promise.all([loadLeaders, loadEmployeeRecords, loadOrganizations, loadRetirements]).then(([leaders, employeeRecords, organizationRecords, retirementRequests]) => {
      if (cancelled) return;
      const leaderByOrganization = new Map((leaders ?? []).map((leader) => [leader.organizationId, leader.leaderEmployeeId]));
      const recordByOrganization = new Map((organizationRecords ?? []).map((record) => [record.organizationId, record]));
      const renamedDepartmentByOriginalName = new Map(initialOrganizations.map((organization) => [organization.name, recordByOrganization.get(organization.id)?.name ?? organization.name]));
      setOrganizations((items) => items.map((organization) => {
        const saved = recordByOrganization.get(organization.id);
        return {
          ...organization,
          ...(saved ? { name: saved.name, description: saved.description } : {}),
          leaderEmployeeId: leaderByOrganization.has(organization.id) ? leaderByOrganization.get(organization.id) ?? null : organization.leaderEmployeeId,
        };
      }));
      const persistedLeaderIds = new Set((leaders ?? []).map((leader) => leader.leaderEmployeeId).filter((id): id is string => Boolean(id)));
      const recordByEmployee = new Map((employeeRecords ?? []).map((record) => [record.employeeId, record]));
      const activeRetirementByEmployee = new Map((retirementRequests ?? []).filter((request) => ["SUBMITTED", "IN_PROGRESS", "READY", "EFFECTIVE", "COMPLETED"].includes(request.status)).map((request) => [request.employee_id, request]));
      const withActiveRetirement = (employee: Employee): Employee => {
        const request = activeRetirementByEmployee.get(employee.id);
        if (!request) return employee;
        let completedTaskIds: string[] = [];
        try { completedTaskIds = JSON.parse(request.checklist_json) as string[]; } catch { completedTaskIds = []; }
        return { ...employee, retirement: { requestId: request.id, date: request.retirement_date, reason: request.reason, completedTaskIds, status: request.status } };
      };
      setEmployees((items) => {
        const mergedExisting = items.map((employee) => {
        const record = recordByEmployee.get(employee.id);
        const merged = record ? { ...employee, ...record, id: employee.id } : employee;
        const renamedDepartment = renamedDepartmentByOriginalName.get(merged.department) ?? merged.department;
        const withOrganization = { ...merged, department: renamedDepartment };
          return withActiveRetirement(persistedLeaderIds.has(employee.id) ? { ...withOrganization, jobTitle: "조직장" } : withOrganization);
        });
        const existingIds = new Set(items.map((employee) => employee.id));
        const newlyRegistered = (employeeRecords ?? []).filter((record) => !existingIds.has(record.employeeId)).map((record) => ({
          id: record.employeeId,
          name: record.name,
          department: record.department,
          position: record.position,
          jobTitle: record.jobTitle,
          type: record.type,
          joinDate: record.joinDate,
          status: record.status,
          email: record.email,
          phone: record.phone,
          address: record.address,
          manager: record.manager,
          birth: record.birth,
          history: record.history,
          annualSalary: record.annualSalary,
          basePay: record.basePay,
          mealAllowance: record.mealAllowance,
          childcareAllowance: record.childcareAllowance,
          vehicleAllowance: record.vehicleAllowance,
          ...(record.retirement ? { retirement: record.retirement } : {}),
        } satisfies Employee)).map(withActiveRetirement);
        return [...mergedExisting, ...newlyRegistered];
      });
      if (!leaders || !employeeRecords || !organizationRecords || !retirementRequests) showToast("일부 저장 정보를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.");
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/hr/recruitment")
      .then(async (response) => {
        const data = await response.json() as { applicants?: Applicant[]; recruiterIds?: string[]; requisitions?: RecruitmentRequisitionOption[]; error?: string };
        if (!response.ok) throw new Error(data.error || "채용 정보를 불러오지 못했습니다.");
        return data;
      })
      .then((data) => {
        if (cancelled) return;
        const loadedApplicants = data.applicants ?? [];
        setApplicants(loadedApplicants);
        setRecruiterIds(data.recruiterIds?.length ? data.recruiterIds : ["gc.kim"]);
        setRequisitions(data.requisitions ?? []);
      })
      .catch((error: Error) => { if (!cancelled) showToast(error.message); });
    return () => { cancelled = true; };
  }, []);

  // 채용요청 목록은 앱을 켤 때 한 번만 읽어서, 채용요청을 새로 만들어도 지원자 등록 화면의
  // 선택지에 나타나지 않았다. 채용 관련 화면에 들어올 때마다 다시 읽는다.
  useEffect(() => {
    if (!["recruitment", "requisitions"].includes(active)) return;
    let cancelled = false;
    fetch("/api/hr/recruitment")
      .then((response) => response.ok ? response.json() as Promise<{ requisitions?: RecruitmentRequisitionOption[] }> : null)
      .then((payload) => { if (!cancelled && payload?.requisitions) setRequisitions(payload.requisitions); })
      .catch(() => { /* 목록 갱신 실패는 화면을 막지 않는다. 기존 목록을 그대로 쓴다. */ });
    return () => { cancelled = true; };
  }, [active]);

  // 목록에서 아래쪽 항목을 고르면 상세 화면이 그 스크롤 위치 그대로 열려 늘 아래에서 시작했다.
  // 화면이 바뀔 때 맨 위로 올린다.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.scrollTo({ top: 0, behavior: "auto" });
  }, [active, selectedEmployeeId, selectedApplicantId, selectedPayrollMonth]);

  const selectedEmployee = employees.find((employee) => employee.id === selectedEmployeeId) ?? null;
  const selectedApplicant = applicants.find((applicant) => applicant.id === selectedApplicantId) ?? null;
  const recruiters = employees.filter((employee) => recruiterIds.includes(employee.id) && isCurrentEmployee(employee));
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

  async function saveEmployee(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const department = String(data.get("department"));
    const organization = organizations.find((item) => item.name === department);
    const organizationLeader = employees.find((employee) => employee.id === organization?.leaderEmployeeId);
    const newEmployee: Employee = {
      id: String(data.get("employeeId")), name: String(data.get("name")), email: String(data.get("email")), phone: String(data.get("phone")),
      department, type: String(data.get("type")), joinDate: String(data.get("joinDate")).replaceAll("-", "."), position: String(data.get("position")),
      jobTitle: String(data.get("jobTitle")), status: "재직", address: "미입력", manager: organizationLeader?.name ?? "", birth: "미입력", history: [{ date: String(data.get("joinDate")).replaceAll("-", "."), type: "입사", detail: `${department} ${String(data.get("position"))} 입사` }],
      annualSalary: 0, basePay: 0, mealAllowance: 0, childcareAllowance: 0, vehicleAllowance: 0,
    };
    if (employees.some((employee) => employee.id === newEmployee.id)) {
      showToast("이미 사용 중인 직원 ID입니다.");
      return;
    }
    try {
      const response = await fetch("/api/hr/employee-records", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId: newEmployee.id, ...newEmployee }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "신규 직원을 저장하지 못했습니다.");
      setEmployees((value) => [...value, newEmployee]);
      setEmployeeModalOpen(false);
      showToast("신규 직원을 인사기록카드에 영구 등록했습니다.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "신규 직원을 저장하지 못했습니다.");
    }
  }

  async function updateEmployee(id: string, patch: Partial<Employee>) {
    const previous = employees.find((employee) => employee.id === id);
    if (!previous) return false;
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
          joinDate: next.joinDate,
          position: next.position,
          jobTitle: next.jobTitle ?? "팀원",
          status: next.status,
          history: next.history,
          retirement: next.retirement ?? null,
          annualSalary: next.annualSalary,
          basePay: next.basePay,
          mealAllowance: next.mealAllowance,
          childcareAllowance: next.childcareAllowance,
          vehicleAllowance: next.vehicleAllowance,
        }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "직원 정보를 저장하지 못했습니다.");
      showToast("인사기록의 변경내용을 영구 저장했습니다.");
      return true;
    } catch {
      setEmployees((value) => value.map((employee) => employee.id === id ? previous : employee));
      showToast("저장에 실패해 이전 정보로 되돌렸습니다.");
      return false;
    }
  }

  async function persistApplicantRecord(applicant: Applicant) {
    const response = await fetch("/api/hr/recruitment", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(applicant),
    });
    const data = await response.json() as { error?: string };
    if (!response.ok) throw new Error(data.error || "채용 정보를 저장하지 못했습니다.");
  }

  async function savePersonnelAction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEmployee || !personnelAction) return;
    const data = new FormData(event.currentTarget);
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
      showToast("승진은 현재보다 높은 직위을 선택해야 합니다.");
      return;
    }
    if (actionType === "강등" && currentRank >= 0 && (targetRank < 0 || targetRank >= currentRank)) {
      showToast("강등은 현재보다 낮은 직위을 선택해야 합니다.");
      return;
    }
    if (actionType === "강등" && !note) {
      showToast("강등 발령에는 정당한 사유를 반드시 입력해야 합니다.");
      return;
    }

    const detail = note || (actionType === "인사이동(전보)"
      ? `${selectedEmployee.department}에서 ${department}(으)로 인사이동`
      : `${selectedEmployee.position}에서 ${position}(으)로 ${actionType}`);
    try {
      const response = await fetch("/api/hr/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resource: "personnelAction",
          employeeId: selectedEmployee.id,
          actionType,
          effectiveDate: String(data.get("effectiveDate")),
          fromDepartment: selectedEmployee.department,
          toDepartment: actionType === "인사이동(전보)" ? department : selectedEmployee.department,
          fromPosition: selectedEmployee.position,
          toPosition: actionType === "승진" || actionType === "강등" ? position : selectedEmployee.position,
          reason: detail,
        }),
      });
      const payload = await response.json() as { error?: string; approvalSubmitted?: boolean };
      if (!response.ok) throw new Error(payload.error || "인사 발령을 저장하지 못했습니다.");
      setPersonnelAction(null);
      showToast(payload.approvalSubmitted
        ? `${actionType} 인사 발령을 전자결재로 제출했습니다. 최종 승인 후 인사기록에 반영됩니다.`
        : `${actionType} 인사 발령을 저장했습니다.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "인사 발령을 저장하지 못했습니다.");
    }
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

  async function updateOrganization(organizationId: string, name: string, description: string, impactAssessmentId: string) {
    const trimmedName = name.trim();
    const current = organizations.find((organization) => organization.id === organizationId);
    if (!current || !trimmedName || organizations.some((organization) => organization.id !== organizationId && organization.name === trimmedName)) {
      showToast("조직명은 비어 있거나 다른 조직과 같을 수 없습니다.");
      return false;
    }
    const savedDescription = description.trim() || "조직 설명 미입력";
    setOrganizations((items) => items.map((organization) => organization.id === organizationId ? { ...organization, name: trimmedName, description: savedDescription } : organization));
    if (current.name !== trimmedName) {
      setEmployees((items) => items.map((employee) => employee.department === current.name ? { ...employee, department: trimmedName } : employee));
    }
    try {
      const response = await fetch("/api/hr/organizations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId, previousName: current.name, name: trimmedName, description: savedDescription, impactAssessmentId }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "조직 정보를 저장하지 못했습니다.");
      showToast(`${trimmedName} 조직 정보를 영구 저장했습니다.`);
      return true;
    } catch (error) {
      setOrganizations((items) => items.map((organization) => organization.id === organizationId ? current : organization));
      if (current.name !== trimmedName) {
        setEmployees((items) => items.map((employee) => employee.department === trimmedName ? { ...employee, department: current.name } : employee));
      }
      showToast(error instanceof Error ? error.message : "저장에 실패해 이전 정보로 되돌렸습니다.");
      return false;
    }
  }

  function addRank(value: string) {
    const trimmed = value.trim();
    if (!trimmed || ranks.includes(trimmed)) return showToast("새 직위명을 확인해 주세요.");
    setRanks((items) => [...items, trimmed]);
    showToast(`${trimmed} 직위을 추가했습니다.`);
  }

  function removeRank(value: string) {
    if (employees.some((employee) => employee.position === value)) return showToast("사용 중인 직위은 삭제할 수 없습니다.");
    setRanks((items) => items.filter((item) => item !== value));
    showToast(`${value} 직위을 삭제했습니다.`);
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

  async function saveRetirement(record: RetirementRecord) {
    if (!selectedEmployee) return;
    const employee = selectedEmployee;
    const totalTasks = retirementChecklist.hr.length + retirementChecklist.employee.length;
    const completed = record.completedTaskIds.length;
    try {
      if (record.requestId && record.status === "SUBMITTED") {
        showToast("기존 방식으로 생성된 퇴직 요청입니다. 현재 진행 상태를 확인해 주세요.");
        return;
      }
      if (record.requestId && ["IN_PROGRESS", "READY"].includes(record.status ?? "")) {
        const response = await fetch("/api/hr/operations", {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resource: "retirementChecklist", id: record.requestId, completedTaskIds: record.completedTaskIds }),
        });
        const payload = await response.json() as { item?: { status?: string }; error?: string };
        if (!response.ok) throw new Error(payload.error || "퇴직 체크리스트를 저장하지 못했습니다.");
        const status = payload.item?.status ?? "IN_PROGRESS";
        setEmployees((items) => items.map((item) => item.id === employee.id ? { ...item, status: ["EFFECTIVE", "COMPLETED"].includes(status) ? "퇴직" : "퇴직 예정", retirement: { ...record, status } } : item));
        setRetirementOpen(false);
        showToast(status === "COMPLETED" ? "퇴직 절차를 완료하고 인사 상태를 반영했습니다." : `퇴직 체크리스트를 저장했습니다. 미완료 업무 ${totalTasks - completed}건`);
        return;
      }
      const tasks = [
        ...retirementChecklist.hr.map((task) => ({ id: task.id, title: task.label, ownerType: "HR", completed: record.completedTaskIds.includes(task.id) })),
        ...retirementChecklist.employee.map((task) => ({ id: task.id, title: task.label, ownerType: "EMPLOYEE", completed: record.completedTaskIds.includes(task.id) })),
      ];
      const response = await fetch("/api/hr/operations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "retirement", employeeId: employee.id, eventDate: record.date, reason: record.reason, tasks }),
      });
      const payload = await response.json() as { item?: { id?: string; status?: string }; error?: string };
      if (!response.ok) throw new Error(payload.error || "퇴직 절차를 저장하지 못했습니다.");
      const status = payload.item?.status ?? "IN_PROGRESS";
      setEmployees((items) => items.map((item) => item.id === employee.id ? { ...item, status: ["EFFECTIVE", "COMPLETED"].includes(status) ? "퇴직" : "퇴직 예정", retirement: { ...record, requestId: payload.item?.id, status } } : item));
      setRetirementOpen(false);
      showToast(["EFFECTIVE", "COMPLETED"].includes(status) ? "퇴직을 승인하고 퇴직 상태를 반영했습니다." : "퇴직을 승인했습니다. 퇴직일이 되면 재직·조직 명부에서 자동 제외됩니다.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "퇴직 절차를 저장하지 못했습니다.");
    }
  }

  async function parseResume(file: File | undefined) {
    if (!file) return;
    const resumeFile = file;
    setResumeStatus("analyzing");
    setResumeMessage("이력서에서 텍스트를 읽고 있습니다.");
    const extension = resumeFile.name.split(".").pop()?.toLowerCase();
    if (!extension || !["pdf", "docx", "txt"].includes(extension)) {
      setResumeStatus("error");
      setResumeMessage("PDF, DOCX, TXT 이력서만 분석할 수 있습니다.");
      return;
    }

    // 원본 파일은 서버로 올리지 않는다. PDF·DOCX 도 pdfjs-dist / mammoth 로 이 브라우저에서
    // 텍스트만 뽑아 보낸다. Cloudflare 의 ai/tomarkdown 을 걷어낸 자리이고, 그래서 이력서가
    // 이 컴퓨터 밖으로 나가는 경로 자체가 없다.
    async function extractResumeText(): Promise<string> {
      let text = "";
      if (extension === "pdf") {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        // 워커는 public/ 에 둔 사본에서 받는다. node_modules 경로로 부르면 개발 서버가 그 파일을
        // 변환하면서 /@vite/client 를 끼워 넣는데, 그 모듈이 최상위에서 window 를 건드리기 때문에
        // window 가 없는 워커 안에서 "window is not defined" 로 터진다. ?url · ?worker 모두 마찬가지다.
        // public/ 은 변환 없이 그대로 나가므로 이 경로만 안전하다.
        // pdfjs-dist 를 올릴 때 public/pdfjs/pdf.worker.min.mjs 도 같이 복사해야 한다.
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdfjs/pdf.worker.min.mjs";
        const document = await pdfjs.getDocument({ data: new Uint8Array(await resumeFile.arrayBuffer()) }).promise;
        const pages: string[] = [];
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
          const page = await document.getPage(pageNumber);
          const content = await page.getTextContent();
          pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
        }
        text = pages.join("\n");
      } else if (extension === "docx") {
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ arrayBuffer: await resumeFile.arrayBuffer() });
        text = result.value;
      } else if (extension === "txt") {
        text = await resumeFile.text();
      }

      const normalizedText = text.split("\u0000").join(" ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      if (normalizedText.length < 20) throw new Error("이력서에서 읽을 수 있는 텍스트가 없습니다. 이미지형 PDF라면 직접 입력해 주세요.");
      return normalizedText;
    }

    // AI 가 실패해도 지원자 등록을 막지 않는다. 이미 뽑아 둔 텍스트에서 정규식으로 기본값만 채운다.
    function applyBasicTextFallback(reason: string, normalizedText: string) {
      const lines = normalizedText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const email = normalizedText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "";
      const phone = normalizedText.match(/01[016789][\s.-]?\d{3,4}[\s.-]?\d{4}/)?.[0]?.replace(/[.\s]/g, "-").replace(/-{2,}/g, "-") ?? "";
      const labeledName = normalizedText.match(/(?:이름|성명)\s*[:：]?\s*([가-힣]{2,5})/)?.[1];
      const lineName = lines.find((line) => /^[가-힣]{2,5}$/.test(line) && !["이력서", "자기소개서", "경력기술서"].includes(line));
      const role = normalizedText.match(/(?:지원\s*직무|지원\s*분야|희망\s*직무)\s*[:：]?\s*([^\n|]{2,40})/)?.[1]?.trim() ?? "";
      const experience = normalizedText.match(/(?:총\s*경력|경력)\s*[:：]?\s*(\d+\s*년(?:\s*\d+\s*개월)?)/)?.[1]?.replace(/\s+/g, " ") ?? "";
      const summaryLines = lines.filter((line) => line !== email && !line.includes(phone)).slice(0, 12);
      const summary = summaryLines.join(" · ").slice(0, 700);
      const fallback = {
        name: labeledName ?? lineName ?? "",
        role,
        email,
        phone,
        experience,
        summary,
      };
      const storedText = normalizedText.slice(0, 30000);
      const detectedCount = [fallback.name, fallback.role, fallback.email, fallback.phone, fallback.experience].filter(Boolean).length;
      setApplicantDraft((current) => ({
        ...current,
        name: fallback.name || current.name,
        role: fallback.role || current.role,
        email: fallback.email || current.email,
        phone: fallback.phone || current.phone,
        experience: fallback.experience || current.experience,
        summary: fallback.summary,
        resumeFileName: resumeFile.name,
        resumeText: storedText,
      }));
      setResumeStatus("done");
      setResumeMessage(`${reason} 기본 항목 ${detectedCount}개를 찾았습니다.`);
    }

    let resumeText: string;
    try {
      resumeText = await extractResumeText();
    } catch (extractionError) {
      setResumeStatus("error");
      setResumeMessage(extractionError instanceof Error ? extractionError.message : "이력서 내용을 읽지 못했습니다.");
      return;
    }

    setResumeMessage("AI가 이력서를 분석하고 있습니다. 로컬 AI로 넘어가면 1~3분 걸릴 수 있습니다.");
    const controller = new AbortController();
    // 로컬 Ollama 추론은 CPU 에서 실측 70~140초가 걸린다. 서버쪽 AbortSignal.timeout(300_000)
    // 보다 짧으면 정상 응답이 도착하기 전에 클라이언트가 먼저 끊어 버린다.
    const timeoutId = window.setTimeout(() => controller.abort(), 300_000);
    let response: Response;
    try {
      try {
        response = await fetch("/api/hr/resume-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: resumeFile.name, resumeText }),
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeoutId);
      }
    } catch (requestError) {
      const reason = requestError instanceof Error && requestError.name !== "AbortError"
        ? requestError.message
        : "AI 분석 시간이 초과되었습니다.";
      applyBasicTextFallback(`${reason} 기본 텍스트 추출로 전환했습니다.`, resumeText);
      return;
    }

    let data: { analysis?: ResumeAnalysis; error?: string; resumeText?: string; provider?: string; localAvailable?: boolean };
    try {
      data = await response.json() as { analysis?: ResumeAnalysis; error?: string; resumeText?: string; provider?: string; localAvailable?: boolean };
    } catch {
      data = { error: "AI 분석 응답을 읽지 못했습니다." };
    }

    if (!response.ok || !data.analysis) {
      applyBasicTextFallback(`${data.error || "AI 분석에 실패했습니다."} 기본 텍스트 추출로 전환했습니다.`, resumeText);
      return;
    }

    const analysis = data.analysis;
    const detectedCount = [analysis.name, analysis.role, analysis.email, analysis.phone, analysis.experience].filter(Boolean).length;
    setApplicantDraft((current) => ({
      ...current,
      name: analysis.name || current.name,
      role: analysis.role || current.role,
      email: analysis.email || current.email,
      phone: analysis.phone || current.phone,
      experience: analysis.experience || current.experience,
      summary: analysis.summary || current.summary,
      resumeFileName: resumeFile.name,
      resumeText: data.resumeText || resumeText,
    }));
    setResumeStatus("done");
    setResumeProvider(data.provider ?? "");
    setLocalAiAvailable(Boolean(data.localAvailable));
    const providerNote = data.provider === "local" ? "로컬 AI" : "Workers AI";
    setResumeMessage(`${providerNote} 분석을 완료했습니다. 기본 항목 ${detectedCount}개를 찾았습니다.${analysis.warnings.length ? ` 확인 필요 ${analysis.warnings.length}건이 있습니다.` : " 찾지 못한 값은 임의로 채우지 않았습니다."}`);
  }

  // Workers AI 결과가 미덥지 않을 때 사람이 눌러서 한 번 더 돌린다. 파일을 다시 고를 필요 없이
  // 이미 뽑아 둔 이력서 텍스트를 그대로 보내고, 서버에는 provider 를 지정해 로컬만 쓰게 한다.
  async function reanalyzeWithLocal() {
    const resumeText = applicantDraft.resumeText;
    if (!resumeText) {
      showToast("다시 분석할 이력서 내용이 없습니다. 파일을 먼저 선택해 주세요.");
      return;
    }
    setResumeStatus("analyzing");
    setResumeMessage("로컬 AI가 이력서를 다시 분석하고 있습니다. 1~3분 걸릴 수 있습니다.");

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 300_000);
    let response: Response;
    try {
      try {
        response = await fetch("/api/hr/resume-analysis", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fileName: applicantDraft.resumeFileName, resumeText, provider: "local" }),
          signal: controller.signal,
        });
      } finally {
        window.clearTimeout(timeoutId);
      }
    } catch (requestError) {
      setResumeStatus("error");
      setResumeMessage(requestError instanceof Error && requestError.name !== "AbortError"
        ? `${requestError.message} 화면의 값은 그대로 두었습니다.`
        : "로컬 AI 분석 시간이 초과되었습니다. 화면의 값은 그대로 두었습니다.");
      return;
    }

    let data: { analysis?: ResumeAnalysis; error?: string; resumeText?: string; provider?: string };
    try {
      data = await response.json() as { analysis?: ResumeAnalysis; error?: string; resumeText?: string; provider?: string };
    } catch {
      data = { error: "로컬 AI 분석 응답을 읽지 못했습니다." };
    }
    if (!response.ok || !data.analysis) {
      setResumeStatus("error");
      setResumeMessage(`${data.error || "로컬 AI 분석에 실패했습니다."} 화면의 값은 그대로 두었습니다.`);
      return;
    }

    const analysis = data.analysis;
    const detectedCount = [analysis.name, analysis.role, analysis.email, analysis.phone, analysis.experience].filter(Boolean).length;
    setApplicantDraft((current) => ({
      ...current,
      name: analysis.name || current.name,
      role: analysis.role || current.role,
      email: analysis.email || current.email,
      phone: analysis.phone || current.phone,
      experience: analysis.experience || current.experience,
      summary: analysis.summary || current.summary,
    }));
    setResumeProvider("local");
    setResumeStatus("done");
    setResumeMessage(`로컬 AI 재분석을 완료했습니다. 기본 항목 ${detectedCount}개를 찾았습니다.${analysis.warnings.length ? ` 확인 필요 ${analysis.warnings.length}건이 있습니다.` : ""}`);
  }

  async function saveApplicant(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ownerId = recruiterIds[0] ?? "";
    const owner = employees.find((employee) => employee.id === ownerId)?.name ?? "미지정";
    const applicant: Applicant = { id: `AP-${Date.now()}`, ...applicantDraft, applied: new Date().toISOString().slice(0, 10).replaceAll("-", "."), ownerId, owner, stage: "서류 검토", checklist: [], screeningMemos: [], interviewMemos: [] };
    try {
      await persistApplicantRecord(applicant);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "지원자를 저장하지 못했습니다.");
      return;
    }
    setApplicants((value) => [applicant, ...value]);
    setApplicantModalOpen(false);
    setResumeStatus("idle");
    setResumeProvider("");
    setLocalAiAvailable(false);
    setApplicantDraft({ name: "", role: "", email: "", phone: "", experience: "", source: "직접 등록", summary: "", resumeFileName: "", resumeText: "", requisitionId: "" });
    setResumeMessage("");
    showToast("지원자가 지원 현황에 등록되었습니다.");
  }

  function assignRecruiter(applicantId: string, ownerId: string) {
    const owner = employees.find((employee) => employee.id === ownerId)?.name ?? "미지정";
    const current = applicants.find((applicant) => applicant.id === applicantId);
    if (!current) return;
    const updated = { ...current, ownerId, owner };
    setApplicants((items) => items.map((applicant) => applicant.id === applicantId ? updated : applicant));
    persistApplicantRecord(updated).catch((error: Error) => showToast(error.message));
    showToast(`${owner} 님을 채용담당자로 지정했습니다.`);
  }

  async function addRecruiter(employeeId: string) {
    if (!employeeId || recruiterIds.includes(employeeId)) return;
    const response = await fetch("/api/hr/recruitment", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId }) });
    if (!response.ok) return showToast("채용담당자를 저장하지 못했습니다.");
    setRecruiterIds((items) => [...items, employeeId]);
    showToast("채용담당자를 추가했습니다.");
  }

  async function removeRecruiter(employeeId: string) {
    if (applicants.some((applicant) => applicant.ownerId === employeeId)) {
      showToast("담당 중인 지원자가 있어 먼저 담당자를 변경해야 합니다.");
      return;
    }
    const response = await fetch("/api/hr/recruitment", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId }) });
    if (!response.ok) return showToast("채용담당자 해제를 저장하지 못했습니다.");
    setRecruiterIds((items) => items.filter((id) => id !== employeeId));
    showToast("채용담당자에서 제외했습니다.");
  }

  function addInterviewMemo(applicantId: string, text: string) {
    const applicant = applicants.find((item) => item.id === applicantId);
    if (!applicant || !text.trim()) return;
    const note: RecruitmentNote = { id: `IN-${Date.now()}`, text: text.trim(), author: applicant.owner || "담당자 미지정", createdAt: new Date().toISOString() };
    const updated = { ...applicant, interviewMemos: [note, ...(applicant.interviewMemos ?? [])] };
    setApplicants((items) => items.map((item) => item.id === applicantId ? updated : item));
    persistApplicantRecord(updated).catch((error: Error) => showToast(error.message));
    showToast("면접 메모를 저장했습니다.");
  }

  async function submitRecruitmentOffer(applicantId: string, draft: RecruitmentOfferDraft) {
    try {
      const response = await fetch("/api/hr/recruitment", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "offer", applicantId, ...draft }),
      });
      const payload = await response.json() as { offer?: RecruitmentOffer; error?: string };
      if (!response.ok || !payload.offer) throw new Error(payload.error || "채용 제안을 저장하지 못했습니다.");
      setApplicants((items) => items.map((item) => item.id === applicantId ? { ...item, offer: payload.offer, stage: "채용 제안 준비" } : item));
      showToast("채용 제안을 저장했습니다. 지원자 수락 시 입사 관리로 바로 전환할 수 있습니다.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "채용 제안을 저장하지 못했습니다.");
    }
  }

  async function respondRecruitmentOffer(applicantId: string, offerId: string, action: "ACCEPT" | "DECLINE", input: { employeeId?: string; position?: string; jobTitle?: string; responseNote: string; startDate?: string; annualSalary?: number; probationMonths?: number; department?: string; proposedTitle?: string; employmentType?: string; declineKind?: "OFFER" | "OTHER_OFFER" }) {
    try {
      const response = await fetch("/api/hr/recruitment", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resource: "offerResponse", id: offerId, action, ...input }),
      });
      const payload = await response.json() as { offer?: RecruitmentOffer; stage?: string; error?: string };
      if (!response.ok || !payload.offer) throw new Error(payload.error || "채용 제안 회신을 반영하지 못했습니다.");
      setApplicants((items) => items.map((item) => item.id === applicantId
        // 서버가 정한 단계를 그대로 쓴다. 타사 합격이면 "채용 제안 거절"이 아니라 "타사 합격"이다.
        ? { ...item, offer: payload.offer, stage: payload.stage
          ?? (action === "ACCEPT" ? "입사 예정" : input.declineKind === "OTHER_OFFER" ? OTHER_OFFER_STAGE : "채용 제안 거절") } : item));
      showToast(action === "ACCEPT" ? "입사 예정자로 전환했습니다. 입·퇴사 관리에서 입사일과 처우를 확인할 수 있습니다." : "채용 제안 거절 회신을 기록했습니다.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "채용 제안 회신을 반영하지 못했습니다.");
    }
  }

  // 서류 합불은 이제 지원자 팝업에서만 누른다. 잘못 눌렀을 때 되돌릴 수 있도록 RESET 도 받는다.
  function decideScreening(applicantId: string, decision: "PASS" | "REJECT" | "RESET") {
    const current = applicants.find((applicant) => applicant.id === applicantId);
    if (!current) return;
    const stage = decision === "PASS" ? SCREENING_PASSED_STAGE
      : decision === "REJECT" ? SCREENING_REJECTED_STAGE : SCREENING_PENDING_STAGE;
    const updated = { ...current, stage };
    setApplicants((items) => items.map((applicant) => applicant.id === applicantId ? updated : applicant));
    persistApplicantRecord(updated).catch((error: Error) => showToast(error.message));
    showToast(decision === "PASS" ? "서류 합격으로 처리했습니다. 면접 일정을 입력할 수 있습니다."
      : decision === "REJECT" ? "서류 탈락으로 처리했습니다."
      : "서류 심사 결과를 평가중으로 되돌렸습니다.");
  }

  // 면접 일정을 팝업에서 바로 저장한다. 일정이 잡히면 지원 현황의 현재 단계 열에 그대로 드러난다.
  function saveInterviewFor(applicantId: string, schedule: InterviewSchedule) {
    const current = applicants.find((applicant) => applicant.id === applicantId);
    if (!current) return;
    const updated = { ...current, interview: schedule };
    setApplicants((items) => items.map((applicant) => applicant.id === applicantId ? updated : applicant));
    persistApplicantRecord(updated).catch((error: Error) => showToast(error.message));
    showToast("면접 일정을 저장했습니다.");
  }

  // 서류 탈락과 별개의 단계다. 면접까지 본 뒤의 결과라 이력에서 구분되어야 한다.
  // attended 가 거짓이면 면접에 오지 않아 탈락한 것이다. 채용단계는 서류 합격에서 멈춘다.
  //
  // 단계와 메모를 반드시 한 번에 저장한다. 예전에는 단계를 저장한 뒤 addInterviewMemo 를 이어서
  // 불렀는데, 그 함수가 이 렌더 시점의 applicants 를 다시 읽는 탓에 바뀐 stage 가 빠진 레코드를
  // 뒤이어 덮어써서 탈락 처리가 통째로 사라졌다.
  function rejectAfterInterview(applicantId: string, note: string, attended: boolean) {
    const current = applicants.find((applicant) => applicant.id === applicantId);
    if (!current) return;
    const trimmed = note.trim();
    const memos = current.interviewMemos ?? [];
    const updated = {
      ...current,
      stage: attended ? INTERVIEW_REJECTED_STAGE : INTERVIEW_NO_SHOW_STAGE,
      interviewMemos: trimmed
        ? [{ id: `IN-${Date.now()}`, text: trimmed, author: current.owner || "담당자 미지정", createdAt: new Date().toISOString() }, ...memos]
        : memos,
    };
    setApplicants((items) => items.map((applicant) => applicant.id === applicantId ? updated : applicant));
    persistApplicantRecord(updated).catch((error: Error) => showToast(error.message));
    showToast(attended ? "면접 후 탈락으로 기록했습니다." : "면접 불참 탈락으로 기록했습니다.");
  }

  async function deleteApplicant(applicantId: string) {
    const applicant = applicants.find((item) => item.id === applicantId);
    if (!applicant) return;
    const confirmed = window.confirm(`${applicant.name} 지원자의 기본정보, 이력서, 메모, 면접 일정과 녹음 파일을 모두 삭제합니다.\n삭제한 정보는 복구할 수 없습니다. 계속할까요?`);
    if (!confirmed) return;
    try {
      const response = await fetch("/api/hr/recruitment", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicantId }),
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error || "지원자 정보를 삭제하지 못했습니다.");
      setApplicants((items) => items.filter((item) => item.id !== applicantId));
      if (selectedApplicantId === applicantId) setSelectedApplicantId(null);
      showToast(`${applicant.name} 지원자의 모든 정보를 삭제했습니다.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "지원자 정보를 삭제하지 못했습니다.");
    }
  }

  function updateApplicantDetail(updated: Applicant) {
    setApplicants((items) => items.map((applicant) => applicant.id === updated.id ? updated : applicant));
    persistApplicantRecord(updated)
      .then(() => showToast("지원자 정보와 특이사항을 저장했습니다."))
      .catch((error: Error) => showToast(error.message));
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
        {active === "schedule" && <TimeAndLeaveView employees={employees} onNotify={showToast} />}
        {active === "documents" && <EmployeeDocumentView employees={employees} onNotify={showToast} />}
        {active === "employees" && <><EmployeeDirectory employees={employees} organizations={organizations} query={query} onSelect={setSelectedEmployeeId} onAdd={() => setEmployeeModalOpen(true)} />{selectedEmployee && <EmployeeDetail employee={selectedEmployee} employees={employees} organizations={organizations} ranks={ranks} jobTitles={jobTitles} onBack={() => setSelectedEmployeeId(null)} onUpdate={updateEmployee} onPersonnelAction={() => setPersonnelAction("인사 발령")} onRetirement={() => setRetirementOpen(true)} />}</>}
        {active === "organization" && <OrganizationManagement organizations={organizations} employees={employees} ranks={ranks} jobTitles={jobTitles} onLeaderChange={updateOrganizationLeader} onAddOrganization={addOrganization} onUpdateOrganization={updateOrganization} onAddRank={addRank} onRemoveRank={removeRank} onAddJobTitle={addJobTitle} onRemoveJobTitle={removeJobTitle} />}
        {active === "payroll" && (selectedPayrollMonth ? <PayrollMonthDetail month={selectedPayrollMonth} onBack={() => setSelectedPayrollMonth(null)} /> : <PayrollOverview onSelectMonth={setSelectedPayrollMonth} />)}
        {active === "requisitions" && <RecruitmentRequisitionView onNotify={showToast} />}
        {active === "recruitment" && <RecruitmentView applicants={applicants} recruiters={recruiters} requisitions={requisitions} query={query} onAdd={() => setApplicantModalOpen(true)} onSelect={setSelectedApplicantId} onOwnerChange={assignRecruiter} onDelete={deleteApplicant} />}
        {active === "recruiters" && <RecruiterManagement employees={employees} recruiterIds={recruiterIds} onAdd={addRecruiter} onRemove={removeRecruiter} />}
        {active === "onboarding" && <LifecycleManagementView />}
        {active === "workforce" && <WorkforcePlanningView onNotify={showToast} />}
        {active === "performance" && <PerformanceManagementView onNotify={showToast} />}
        {active === "training" && <TrainingManagementView onNotify={showToast} />}
        {active === "reports" && <HrAnalyticsView onNotify={showToast} />}
        {active === "settings" && <SettingsView employees={employees} onSave={() => showToast("환경설정을 저장했습니다.")} onNotify={showToast} />}
        {!["dashboard", "schedule", "documents", "employees", "organization", "payroll", "requisitions", "recruitment", "recruiters", "onboarding", "workforce", "performance", "training", "reports", "settings"].includes(active) && moduleConfig && <ModuleView config={moduleConfig} rows={filteredRows} query={query} onPrimary={() => showToast(`${moduleConfig.action} 기능을 열었습니다.`)} />}
      </main>

      {employeeModalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setEmployeeModalOpen(false)}><form className="employee-modal" onSubmit={saveEmployee} onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p>NEW EMPLOYEE</p><h2>직원 등록</h2></div><button type="button" onClick={() => setEmployeeModalOpen(false)}>×</button></div><div className="form-grid"><label><span>이름 *</span><input required name="name" placeholder="홍길동" /></label><label><span>사번 *</span><input required name="employeeId" placeholder="사번 또는 계정 ID" /></label><label><span>이메일 *</span><input required name="email" type="email" placeholder="name@company.com" /></label><label><span>연락처</span><input name="phone" placeholder="010-0000-0000" /></label><label><span>소속 조직 *</span><select required name="department" defaultValue=""><option value="" disabled>조직 선택</option>{organizations.map((organization) => <option key={organization.id}>{organization.name}</option>)}</select></label><label><span>고용형태 *</span><select required name="type"><option>일반직4.5</option><option>일반직</option><option>계약직</option><option>인턴</option></select></label><label><span>입사일 *</span><input required name="joinDate" type="date" /></label><label><span>직위</span><select name="position">{ranks.map((rank) => <option key={rank}>{rank}</option>)}</select></label><label><span>직무</span><select name="jobTitle">{jobTitles.filter((title) => title !== "조직장").map((title) => <option key={title}>{title}</option>)}</select></label></div><label className="form-note"><span>메모</span><textarea placeholder="입사 준비에 필요한 참고사항을 입력하세요."></textarea></label><div className="modal-actions"><button type="button" onClick={() => setEmployeeModalOpen(false)}>취소</button><button type="submit" className="primary-button">직원 등록</button></div></form></div>}

      {applicantModalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setApplicantModalOpen(false)}><form className="employee-modal applicant-modal" onSubmit={saveApplicant} onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header"><div><p>NEW APPLICANT</p><h2>지원자 등록</h2></div><button type="button" onClick={() => setApplicantModalOpen(false)}>×</button></div>
        <div className={`resume-drop ${resumeStatus}`}><label><input type="file" accept=".pdf,.docx,.txt" onChange={(event) => parseResume(event.target.files?.[0])} /><span className="resume-icon">AI</span><div><strong>{resumeStatus === "analyzing" ? "원본 이력서를 AI가 분석하고 있어요" : resumeStatus === "done" ? "이력서 분석 완료" : resumeStatus === "error" ? "이력서 분석 실패" : "원본 이력서를 AI가 바로 분석합니다"}</strong><small>{resumeMessage || "PDF, DOCX, TXT · 파일은 이 브라우저에서 텍스트만 뽑아 보냅니다."}</small></div><em>{resumeStatus === "analyzing" ? "분석 중…" : resumeStatus === "done" || resumeStatus === "error" ? "다시 선택" : "파일 선택"}</em></label>{localAiAvailable && resumeProvider !== "local" && resumeStatus !== "analyzing" && applicantDraft.resumeText
          ? <div className="resume-rerun"><div><strong>결과가 정확하지 않나요?</strong><small>이 컴퓨터의 로컬 AI로 한 번 더 분석합니다. 파일을 다시 고를 필요는 없고 1~3분 걸립니다.</small></div><button type="button" onClick={reanalyzeWithLocal}>로컬 AI로 다시 분석</button></div>
          : null}</div>
        <div className="form-grid">
          <label><span>이름 *</span><input required value={applicantDraft.name} onChange={(event) => setApplicantDraft({ ...applicantDraft, name: event.target.value })} /></label>
          <label><span>지원 직무 *</span><input required value={applicantDraft.role} onChange={(event) => setApplicantDraft({ ...applicantDraft, role: event.target.value })} /></label>
          <label className="wide"><span>채용요청·TO</span><select value={applicantDraft.requisitionId} onChange={(event) => setApplicantDraft({ ...applicantDraft, requisitionId: event.target.value })}><option value="">예외·직접 등록</option>{requisitions.filter((item) => item.status === "OPEN").map((item) => <option key={item.id} value={item.id}>{item.title} · {item.role}</option>)}</select><small>승인 TO에 연결하면 채용 제안과 입사 확정 인원이 자동 집계됩니다.</small></label>
          <label><span>이메일 *</span><input required type="email" value={applicantDraft.email} onChange={(event) => setApplicantDraft({ ...applicantDraft, email: event.target.value })} /></label>
          <label><span>연락처</span><input value={applicantDraft.phone} onChange={(event) => setApplicantDraft({ ...applicantDraft, phone: event.target.value })} /></label>
          <label><span>경력</span><input value={applicantDraft.experience} onChange={(event) => setApplicantDraft({ ...applicantDraft, experience: event.target.value })} /></label>
          <label><span>지원 경로</span><select value={applicantDraft.source} onChange={(event) => setApplicantDraft({ ...applicantDraft, source: event.target.value })}><option>사람인</option><option>그룹바이</option><option>직접 등록</option><option>원티드</option><option>잡코리아</option><option>링크드인</option><option>직원 추천</option><option>기타 채용사이트</option><option>이력서 내용 추출</option></select></label>
        </div>
        <label className="form-note"><span>경력 요약</span><textarea value={applicantDraft.summary} onChange={(event) => setApplicantDraft({ ...applicantDraft, summary: event.target.value })} placeholder="주요 경력과 역량을 입력하세요."></textarea></label><div className="modal-actions"><button type="button" onClick={() => setApplicantModalOpen(false)}>취소</button><button type="submit" className="primary-button">지원자 등록</button></div>
      </form></div>}

      {selectedApplicant && <ApplicantDetail applicant={selectedApplicant} recruiters={recruiters} requisitions={requisitions} organizations={organizations} onClose={() => setSelectedApplicantId(null)} onSave={updateApplicantDetail} onDecideScreening={decideScreening} onSaveInterview={saveInterviewFor} onSaveMemo={addInterviewMemo} onSubmitOffer={submitRecruitmentOffer} onRejectInterview={rejectAfterInterview} onRespondOffer={respondRecruitmentOffer} />}
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
  const currentEmployees = employees.filter(isCurrentEmployee);
  const visibleEmployees = query ? currentEmployees.filter((employee) => Object.values(employee).some((value) => typeof value === "string" && value.toLowerCase().includes(query.toLowerCase()))) : currentEmployees;
  const hiresThisMonth = currentEmployees.filter((employee) => employee.joinDate.startsWith("2026.08")).length;
  const incompleteProfiles = currentEmployees.filter((employee) => [employee.email, employee.phone, employee.birth, employee.address].some((value) => !value || value === "미입력")).length;
  const toggle = (department: string) => setExpanded((value) => value.includes(department) ? value.filter((item) => item !== department) : [...value, department]);

  async function downloadEmployeeWorkbook() {
    setExporting(true);
    try {
      const { default: writeXlsxFile } = await import("write-excel-file/browser");
      const header = ["이름", "사번/ID", "생년월일", "이메일", "연락처", "주소", "소속 조직", "조직장", "직위", "직무", "고용형태", "입사일", "재직상태"];
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
        const leader = currentEmployees.find((employee) => employee.id === organization?.leaderEmployeeId);
        if (query && people.length === 0) return null;
        return <section className="panel department-panel" key={department}>
          <button type="button" className="department-heading" onClick={() => toggle(department)} aria-expanded={expanded.includes(department)}><span className={`chevron ${expanded.includes(department) ? "open" : ""}`}>›</span><div><strong>{department}</strong><small>재직 {people.length}명 · 실제 등록 인원</small></div><span className="dept-progress"><i style={{ width: "100%" }}></i></span><em>{expanded.includes(department) ? "접기" : "펼치기"}</em></button>
          {expanded.includes(department) && <div className="data-table-wrap"><table className="data-table employee-table"><thead><tr><th>직원</th><th>사번/ID</th><th className="employee-birth-column">생년월일</th><th>직위</th><th>직무</th><th>고용형태</th><th>입사일</th><th>조직장</th><th>상태</th></tr></thead><tbody>{people.map((employee) => {
            const isLeader = employee.id === organization?.leaderEmployeeId;
            return <tr key={employee.id} className={isLeader ? "organization-leader-row" : ""}><td><button type="button" className="name-link" onClick={() => onSelect(employee.id)}><span>{employee.name.slice(0, 1)}</span>{employee.name}{isLeader && <em className="organization-leader-badge">조직장</em>}</button></td><td>{employee.id}</td><td className="employee-birth-column">{employee.birth || "미입력"}</td><td>{employee.position}</td><td>{isLeader ? "조직장" : employee.jobTitle ?? "팀원"}</td><td>{employee.type}</td><td>{employee.joinDate}</td><td>{isLeader ? "" : leader?.name ?? "미지정"}</td><td><StatusPill value={employee.status} /></td></tr>;
          })}</tbody></table></div>}
        </section>;
      })}
    </div>
  </div>;
}

function OrganizationManagement({ organizations, employees, ranks, jobTitles, onLeaderChange, onAddOrganization, onUpdateOrganization, onAddRank, onRemoveRank, onAddJobTitle, onRemoveJobTitle }: { organizations: Organization[]; employees: Employee[]; ranks: string[]; jobTitles: string[]; onLeaderChange: (organizationId: string, employeeId: string) => void; onAddOrganization: (name: string, description: string) => void; onUpdateOrganization: (organizationId: string, name: string, description: string, impactAssessmentId: string) => Promise<boolean>; onAddRank: (value: string) => void; onRemoveRank: (value: string) => void; onAddJobTitle: (value: string) => void; onRemoveJobTitle: (value: string) => void }) {
  const [newOrganization, setNewOrganization] = useState({ name: "", description: "" });
  const [newRank, setNewRank] = useState("");
  const [newJobTitle, setNewJobTitle] = useState("");
  return <div className="page-wrap module-page organization-page">
    <section className="module-hero"><div><p className="eyebrow">ORGANIZATION MANAGEMENT</p><h1>조직관리</h1><p>조직 구성과 조직장, 직위 및 직책 기준을 한 곳에서 관리합니다.</p></div></section>
    <section className="metric-grid module-metrics">{[
      { label: "운영 조직", value: `${organizations.length}개`, note: "인사기록과 연동" },
      { label: "조직장 지정", value: `${organizations.filter((organization) => organization.leaderEmployeeId).length}명`, note: `미지정 ${organizations.filter((organization) => !organization.leaderEmployeeId).length}개`, tone: "blue" },
      { label: "직위 체계", value: `${ranks.length}단계`, note: "승진·강등 기준", tone: "green" },
      { label: "직책", value: `${jobTitles.length}개`, note: "역할 구분", tone: "orange" },
    ].map((metric) => <div className="compact-metric" key={metric.label}><span className={`metric-accent ${metric.tone ?? "navy"}`}></span><p>{metric.label}</p><h2>{metric.value}</h2><small>{metric.note}</small></div>)}</section>
    <div className="organization-layout">
      <section className="panel organization-list-panel">
        <div className="table-toolbar"><div><h2>회사 조직 구성</h2><span>조직장을 지정하면 인사기록카드에 즉시 반영됩니다.</span></div></div>
        <div className="organization-list">{organizations.map((organization) => {
          const members = employees.filter((employee) => isCurrentEmployee(employee) && employee.department === organization.name);
          return <OrganizationCard key={organization.id} organization={organization} members={members} onLeaderChange={onLeaderChange} onUpdate={onUpdateOrganization} />;
        })}</div>
        <form className="organization-add-form" onSubmit={(event) => { event.preventDefault(); onAddOrganization(newOrganization.name, newOrganization.description); setNewOrganization({ name: "", description: "" }); }}><div><label><span>새 조직명</span><input required value={newOrganization.name} onChange={(event) => setNewOrganization({ ...newOrganization, name: event.target.value })} placeholder="예: 사업전략팀" /></label><label><span>조직 설명</span><input value={newOrganization.description} onChange={(event) => setNewOrganization({ ...newOrganization, description: event.target.value })} placeholder="조직의 주요 역할" /></label></div><button type="submit" className="primary-button">+ 조직 추가</button></form>
      </section>
      <aside className="organization-catalogs">
        <CatalogManager title="직위 관리" description="승진·강등과 인사기록에 사용하는 직위입니다." items={ranks} value={newRank} onValue={setNewRank} onAdd={() => { onAddRank(newRank); setNewRank(""); }} onRemove={onRemoveRank} placeholder="새 직위" />
        <CatalogManager title="직책 관리" description="구성원의 역할과 책임을 구분합니다." items={jobTitles} value={newJobTitle} onValue={setNewJobTitle} onAdd={() => { onAddJobTitle(newJobTitle); setNewJobTitle(""); }} onRemove={onRemoveJobTitle} placeholder="새 직책" />
      </aside>
    </div>
  </div>;
}

function OrganizationCard({ organization, members, onLeaderChange, onUpdate }: { organization: Organization; members: Employee[]; onLeaderChange: (organizationId: string, employeeId: string) => void; onUpdate: (organizationId: string, name: string, description: string, impactAssessmentId: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ name: organization.name, description: organization.description });
  const [impactOpen, setImpactOpen] = useState(false);
  const sortedMembers = [...members].sort((first, second) => Number(second.id === organization.leaderEmployeeId) - Number(first.id === organization.leaderEmployeeId));
  const memberColumns = members.length <= 1 ? 1 : members.length <= 4 ? 2 : 3;

  function cancelEdit() {
    setDraft({ name: organization.name, description: organization.description });
    setEditing(false);
  }

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setImpactOpen(true);
  }

  return <article className={`organization-card ${editing ? "editing" : ""}`}>
    {editing ? <form className="organization-edit-form" onSubmit={saveEdit}><div className="organization-edit-heading"><strong>조직 정보 수정</strong><span>조직명 변경 시 소속 인사기록에도 함께 반영됩니다.</span></div><label><span>조직명</span><input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label><span>조직 설명</span><textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label><div className="organization-edit-actions"><button type="button" onClick={cancelEdit}>취소</button><button type="submit">영향 확인 후 저장</button></div></form> : <><div className="organization-card-heading"><span>{organization.name.slice(0, 1)}</span><div><h3>{organization.name}</h3><p>{organization.description}</p></div><em>{members.length}명</em><button type="button" className="organization-edit-button" onClick={() => setEditing(true)}>조직 수정</button></div><label><span>조직장</span><select value={organization.leaderEmployeeId ?? ""} onChange={(event) => onLeaderChange(organization.id, event.target.value)}><option value="">미지정</option>{members.map((employee) => <option value={employee.id} key={employee.id}>{employee.name} · {employee.position}</option>)}</select></label><div className="organization-members"><div className="organization-members-heading"><strong>소속 조직원</strong><span>{members.length}명</span></div>{members.length > 0 ? <div className={`organization-member-list columns-${memberColumns}`}>{sortedMembers.map((employee) => <div className={`organization-member ${employee.id === organization.leaderEmployeeId ? "leader" : ""}`} key={employee.id}><span>{employee.name.slice(0, 1)}</span><div><strong>{employee.name}</strong><small>{employee.position} · {employee.id === organization.leaderEmployeeId ? "조직장" : employee.jobTitle ?? "팀원"}</small></div></div>)}</div> : <p className="organization-empty-members">소속 조직원이 없습니다.</p>}</div></>}
    {impactOpen && <MasterImpactDialog entityType="HR_ORGANIZATION" entityId={organization.id} action="UPDATE" onClose={() => setImpactOpen(false)} onProceed={async (assessmentId) => { const saved = await onUpdate(organization.id, draft.name, draft.description, assessmentId); if (saved) setEditing(false); return saved; }} />}
  </article>;
}

function CatalogManager({ title, description, items, value, onValue, onAdd, onRemove, placeholder }: { title: string; description: string; items: string[]; value: string; onValue: (value: string) => void; onAdd: () => void; onRemove: (value: string) => void; placeholder: string }) {
  return <section className="panel catalog-panel"><div><h2>{title}</h2><p>{description}</p></div><div className="catalog-list">{items.map((item, index) => <div key={item}><span>{index + 1}</span><strong>{item}</strong><button type="button" onClick={() => onRemove(item)} aria-label={`${item} 삭제`}>×</button></div>)}</div><form onSubmit={(event) => { event.preventDefault(); onAdd(); }}><input value={value} onChange={(event) => onValue(event.target.value)} placeholder={placeholder} /><button type="submit">추가</button></form></section>;
}

function EmployeeDetail({ employee, employees, organizations, ranks, jobTitles, onBack, onUpdate, onPersonnelAction, onRetirement }: { employee: Employee; employees: Employee[]; organizations: Organization[]; ranks: string[]; jobTitles: string[]; onBack: () => void; onUpdate: (id: string, patch: Partial<Employee>) => void; onPersonnelAction: () => void; onRetirement: () => void }) {
  const [selectedDepartment, setSelectedDepartment] = useState(employee.department);
  const [selectedJobTitle, setSelectedJobTitle] = useState(employee.jobTitle ?? "팀원");
  // 내려가면 제목줄을 절반 높이로 접는다. 지원자·급여·퇴직 팝업과 같은 방식이다.
  const [condensed, setCondensed] = useState(false);
  const selectedOrganization = organizations.find((organization) => organization.name === selectedDepartment);
  const isOrganizationLeader = selectedOrganization?.leaderEmployeeId === employee.id;
  const leader = employees.find((person) => person.id === selectedOrganization?.leaderEmployeeId);
  const organizationLeaderName = isOrganizationLeader ? "" : leader?.name ?? "";
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const birth = String(data.get("birth"));
    onUpdate(employee.id, { name: String(data.get("name")).trim(), birth: birth ? birth.replaceAll("-", ".") : "미입력", email: String(data.get("email")), phone: String(data.get("phone")), address: String(data.get("address")), department: selectedDepartment, manager: organizationLeaderName, type: String(data.get("type")), position: String(data.get("position")), jobTitle: isOrganizationLeader ? "조직장" : selectedJobTitle, annualSalary: Number(data.get("annualSalary")) || 0, basePay: Number(data.get("basePay")) || 0, mealAllowance: Number(data.get("mealAllowance")) || 0, childcareAllowance: Number(data.get("childcareAllowance")) || 0, vehicleAllowance: Number(data.get("vehicleAllowance")) || 0 });
  }
  // 목록을 대체하던 전체 페이지에서 겹쳐 뜨는 팝업으로 바꿨다. 배경을 눌러도 닫히고,
  // 곡률과 왼쪽 스크롤바는 지원자 팝업과 같은 규칙을 공유한다(public/hr-workspace.css).
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onBack(); }}>
    <div
      className={`employee-detail-modal detail-page${condensed ? " condensed" : ""}`}
      onMouseDown={(event) => event.stopPropagation()}
      onScroll={(event) => {
        const top = event.currentTarget.scrollTop;
        setCondensed((current) => nextCondensed(current, top));
      }}
    >
    {/* 제목줄이 접히면 이름이 적힌 검은 배너가 위로 밀려 올라가 누구의 기록인지 보이지 않는다.
        그래서 접힌 동안에는 제목 옆에 이름을 붙여 둔다. */}
    <div className="modal-header"><div><p>EMPLOYEE RECORD</p><h2>인사기록 확인 및 수정{condensed ? ` - ${employee.name}` : ""}</h2></div><button type="button" onClick={onBack} aria-label="닫기">×</button></div>
    <section className="profile-hero panel"><div className="profile-avatar">{employee.name.slice(0, 1)}</div><div className="profile-copy"><p>{employee.id}</p><h1>{employee.name}</h1><div><span>{employee.department}</span><b>·</b><span>{employee.position}</span><b>·</b><StatusPill value={employee.status} /></div></div><div className="profile-actions personnel-actions-stack"><button type="button" className="promote" onClick={onPersonnelAction}>인사 발령</button><button type="button" className="retirement-action" onClick={onRetirement}>퇴직</button></div></section>
    <div className="detail-grid">
      <form className="panel detail-card" onSubmit={submit}><div className="detail-card-heading"><div><p className="eyebrow">BASIC INFORMATION</p><h2>기본정보·급여 기준</h2></div><button type="submit" className="primary-button">변경사항 저장</button></div><div className="detail-form"><label><span>이름</span><input required name="name" defaultValue={employee.name} /></label><label><span>생년월일</span><input name="birth" type="date" defaultValue={employee.birth === "미입력" ? "" : employee.birth.replaceAll(".", "-")} /></label><label><span>이메일</span><input name="email" defaultValue={employee.email} /></label><label><span>연락처</span><input name="phone" defaultValue={employee.phone} /></label><label className="wide"><span>주소</span><input name="address" defaultValue={employee.address} /></label><label><span>고용형태</span><select name="type" defaultValue={employee.type}><option>일반직4.5</option><option>일반직</option><option>계약직</option><option>인턴</option></select></label><label><span>소속 조직</span><select value={selectedDepartment} onChange={(event) => setSelectedDepartment(event.target.value)}>{organizations.map((organization) => <option key={organization.id}>{organization.name}</option>)}</select></label><label><span>조직장</span><input value={organizationLeaderName} disabled placeholder={isOrganizationLeader ? "본인이 조직장인 경우 공란" : "조직장 미지정"} /></label><label><span>직위</span><select name="position" defaultValue={employee.position}>{ranks.map((rank) => <option key={rank}>{rank}</option>)}</select></label><label><span>직무</span><select name="jobTitle" value={isOrganizationLeader ? "조직장" : selectedJobTitle} disabled={isOrganizationLeader} onChange={(event) => setSelectedJobTitle(event.target.value)}>{jobTitles.map((title) => <option key={title}>{title}</option>)}</select></label><label><span>입사일</span><input value={employee.joinDate} disabled /></label><label><span>연봉 · 1원 단위</span><WonInput name="annualSalary" ariaLabel="연봉" defaultValue={employee.annualSalary ?? 0} /></label><label><span>기본급 · 1원 단위</span><WonInput name="basePay" ariaLabel="기본급" defaultValue={employee.basePay ?? 0} /></label><label><span>식대 · 1원 단위</span><WonInput name="mealAllowance" ariaLabel="식대" defaultValue={employee.mealAllowance ?? 0} /></label><label><span>육아수당 · 1원 단위</span><WonInput name="childcareAllowance" ariaLabel="육아수당" defaultValue={employee.childcareAllowance ?? 0} /></label><label><span>자가운전수당 · 1원 단위</span><WonInput name="vehicleAllowance" ariaLabel="자가운전수당" defaultValue={employee.vehicleAllowance ?? 0} /></label></div></form>
      <aside className="panel detail-card history-card"><div className="detail-card-heading"><div><p className="eyebrow">HR HISTORY</p><h2>인사이력</h2></div><span>{employee.history.length}건</span></div><div className="history-list">{employee.history.map((item, index) => <div className="history-item" key={`${item.date}-${index}`}><span></span><div><strong>{item.type}</strong><p>{item.detail}</p><small>{item.date}</small></div></div>)}</div></aside>
    </div>
    <EmployeeInterviewLog employee={employee} />
    </div>
  </div>;
}

type PermissionsPolicyLike = {
  allowsFeature?: (feature: string) => boolean;
};

function microphoneErrorMessage(error: unknown) {
  const errorName = typeof error === "object" && error && "name" in error
    ? String((error as { name?: unknown }).name ?? "")
    : "";
  const policy = (document as Document & {
    permissionsPolicy?: PermissionsPolicyLike;
    featurePolicy?: PermissionsPolicyLike;
  }).permissionsPolicy ?? (document as Document & { featurePolicy?: PermissionsPolicyLike }).featurePolicy;
  const policyBlocked = policy?.allowsFeature?.("microphone") === false;

  if (policyBlocked || errorName === "SecurityError") {
    return "현재 페이지의 보안 정책이 마이크 사용을 차단했습니다. 이 ERP 주소를 Chrome의 새 탭에서 직접 연 뒤 다시 시도해 주세요.";
  }
  if (errorName === "NotAllowedError" || errorName === "PermissionDeniedError") {
    return "Chrome의 마이크 권한이 차단되었습니다. 주소창 왼쪽의 사이트 설정에서 마이크를 허용한 뒤 페이지를 새로고침해 주세요.";
  }
  if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError") {
    return "사용 가능한 마이크를 찾지 못했습니다. Windows 입력 장치가 연결되어 있고 기본 마이크로 선택되어 있는지 확인해 주세요.";
  }
  if (errorName === "NotReadableError" || errorName === "TrackStartError") {
    return "마이크 장치를 시작하지 못했습니다. Teams·Zoom·녹음기처럼 마이크를 사용 중인 앱을 닫고 Windows의 마이크 접근 허용을 확인해 주세요.";
  }
  if (errorName === "OverconstrainedError" || errorName === "ConstraintNotSatisfiedError") {
    return "현재 마이크 설정을 사용할 수 없습니다. Windows에서 다른 입력 장치를 기본 마이크로 선택한 뒤 다시 시도해 주세요.";
  }
  if (errorName === "AbortError") {
    return "마이크 시작이 중단되었습니다. 잠시 후 다시 시도하거나 Chrome을 새로고침해 주세요.";
  }
  if (errorName === "InvalidStateError") {
    return "현재 페이지가 활성 상태가 아닙니다. 이 탭을 선택한 상태에서 녹음을 다시 시작해 주세요.";
  }
  return `마이크를 시작하지 못했습니다${errorName ? ` (${errorName})` : ""}. Windows와 Chrome의 마이크 설정을 확인해 주세요.`;
}

async function requestMicrophoneStream() {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (error) {
    const name = typeof error === "object" && error && "name" in error
      ? String((error as { name?: unknown }).name ?? "")
      : "";
    if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
      return navigator.mediaDevices.getUserMedia({ audio: true });
    }
    throw error;
  }
}

function createAudioRecorder(stream: MediaStream) {
  const preferredType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
    .find((type) => MediaRecorder.isTypeSupported(type));
  if (!preferredType) return new MediaRecorder(stream);
  try {
    return new MediaRecorder(stream, { mimeType: preferredType });
  } catch {
    return new MediaRecorder(stream);
  }
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
  const [consentConfirmed, setConsentConfirmed] = useState(false);
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
    if (!consentConfirmed) { setMessage("녹음 당사자의 동의를 확인한 뒤 녹음을 시작해 주세요."); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMessage("이 브라우저에서는 음성 녹음을 지원하지 않습니다. 전사문과 메모를 직접 입력해 주세요.");
      return;
    }
    try {
      const stream = await requestMicrophoneStream();
      streamRef.current = stream;
      chunksRef.current = [];
      recognizedTextRef.current = transcript.trim();
      const recorder = createAudioRecorder(stream);
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
    } catch (error) {
      console.error("[microphone] employee interview recording failed", error);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setMessage(microphoneErrorMessage(error));
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
    form.append("consentConfirmed", String(consentConfirmed));
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
      setConsentConfirmed(false);
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
      <label className="recording-consent"><input type="checkbox" checked={consentConfirmed} disabled={recording} onChange={(event) => setConsentConfirmed(event.target.checked)} /><span>면담 당사자에게 녹음 목적과 보관 사실을 안내하고 동의를 확인했습니다.</span></label>
      <div className="interview-log-top"><label><span>면담일시</span><input required type="datetime-local" value={interviewAt} onChange={(event) => setInterviewAt(event.target.value)} /></label><div className="recording-controls"><span>음성녹음</span><button type="button" className={recording ? "recording" : ""} onClick={recording ? stopRecording : startRecording}>{recording ? "■ 녹음 종료" : "● 녹음 시작"}</button>{audioPreviewUrl && <audio controls src={audioPreviewUrl}>녹음 미리듣기</audio>}</div></div>
      <div className="interview-text-grid"><label><span>실시간 전사 초안</span><textarea value={transcript} onChange={(event) => { setTranscript(event.target.value); recognizedTextRef.current = event.target.value; }} placeholder="지원되는 브라우저에서는 녹음 중 초안이 표시됩니다. 저장 후 서버 AI 전사와 사용자 검토본을 별도로 만들 수 있습니다." /></label><label><span>사용자 메모</span><textarea value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="면담 요약, 후속 조치, 확인할 내용을 기록하세요." /></label></div>
      {message && <p className="interview-log-message">{message}</p>}
      <div className="interview-log-actions"><small>녹음 파일과 기록은 이 직원의 인사기록에 안전하게 저장됩니다.</small><button type="submit" className="primary-button" disabled={saving || recording}>{saving ? "저장 중…" : "면담 기록 저장"}</button></div>
    </form>
    <div className="interview-record-list">{loading ? <p className="interview-empty">면담 기록을 불러오는 중입니다.</p> : records.length ? records.map((record) => <article key={record.id}><div><strong>{new Date(record.interviewAt).toLocaleString("ko-KR")}</strong><small>{record.audioFileName ? `음성녹음 포함 · 동의 ${record.consentConfirmed ? "확인" : "기록 없음"}` : "텍스트 기록"}</small></div>{record.audioUrl && <audio controls src={record.audioUrl}>면담 녹음</audio>}<section><span>저장 전사·사용자 기록</span><p>{record.transcript || "전사기록 없음"}</p></section><section><span>사용자 메모</span><p>{record.memo || "메모 없음"}</p></section>{record.audioUrl && <AudioTranscriptionControl entityType="EMPLOYEE_INTERVIEW" entityId={record.id} />}</article>) : <p className="interview-empty">아직 등록된 면담 기록이 없습니다.</p>}</div>
  </section>;
}

type LeaveRequestRow = {
  id: string; employee_id: string; leave_type: string; start_date: string; end_date: string;
  units: number; reason: string; status: string; approver_employee_id: string; decided_at: number | null;
};

type AttendanceRecordRow = {
  id: string; employee_id: string; work_date: string; work_type: string; check_in: string; check_out: string;
  minutes_worked: number; status: string; source_type: string; memo: string; approved_by: string;
};

const leaveTypeLabels: Record<string, string> = { ANNUAL: "연차", HALF_AM: "오전 반차", HALF_PM: "오후 반차", SICK: "병가", FAMILY: "가족돌봄", OTHER: "기타" };
const attendanceTypeLabels: Record<string, string> = { OFFICE: "사무실", REMOTE: "재택", FIELD: "외근", TRIP: "출장", OFF: "비근무" };
const approvalLabels: Record<string, string> = { PENDING: "승인 대기", APPROVED: "승인", REJECTED: "반려", CANCELLED: "취소", RECORDED: "확인 대기" };

function TimeAndLeaveView({ employees, onNotify }: { employees: Employee[]; onNotify: (message: string) => void }) {
  const activeEmployees = employees.filter((employee) => !["퇴직", "퇴직 예정"].includes(employee.status));
  const today = new Date().toISOString().slice(0, 10);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequestRow[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecordRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [leaveDraft, setLeaveDraft] = useState({ employeeId: activeEmployees[0]?.id ?? "", leaveType: "ANNUAL", startDate: today, endDate: today, units: "1", reason: "" });
  const [attendanceDraft, setAttendanceDraft] = useState({ employeeId: activeEmployees[0]?.id ?? "", workDate: today, workType: "OFFICE", checkIn: "09:00", checkOut: "18:00", memo: "" });

  async function load() {
    try {
      const response = await fetch("/api/hr/operations");
      const payload = await response.json() as { leaveRequests?: LeaveRequestRow[]; attendanceRecords?: AttendanceRecordRow[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "근태·휴가 자료를 불러오지 못했습니다.");
      setLeaveRequests(payload.leaveRequests ?? []);
      setAttendanceRecords(payload.attendanceRecords ?? []);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "근태·휴가 자료를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, []);

  const employeeName = (id: string) => employees.find((employee) => employee.id === id)?.name ?? id;
  const pendingLeaves = leaveRequests.filter((item) => item.status === "PENDING");
  const approvedUnits = leaveRequests.filter((item) => item.status === "APPROVED" && item.start_date.startsWith(today.slice(0, 4))).reduce((sum, item) => sum + item.units, 0);
  const todayAttendance = attendanceRecords.filter((item) => item.work_date === today && item.status !== "REJECTED");
  const pendingAttendance = attendanceRecords.filter((item) => item.status === "RECORDED");

  async function createLeave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const units = Math.round(Number(leaveDraft.units) * 100);
    const response = await fetch("/api/hr/operations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource: "leaveRequest", ...leaveDraft, units }) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) { onNotify(payload.error || "휴가 신청을 저장하지 못했습니다."); return; }
    onNotify("휴가 신청을 저장하고 승인 업무를 생성했습니다.");
    setLeaveDraft((current) => ({ ...current, reason: "" }));
    await load();
  }

  async function createAttendance(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/hr/operations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource: "attendance", ...attendanceDraft }) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) { onNotify(payload.error || "근태 기록을 저장하지 못했습니다."); return; }
    onNotify("근태 기록을 저장했습니다.");
    setAttendanceDraft((current) => ({ ...current, memo: "" }));
    await load();
  }

  async function decide(resource: "leaveRequest" | "attendance", id: string, status: string) {
    const response = await fetch("/api/hr/operations", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource, id, status }) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) { onNotify(payload.error || "상태를 변경하지 못했습니다."); return; }
    onNotify(status === "APPROVED" ? "승인 처리했습니다." : "반려 처리했습니다.");
    await load();
  }

  return <div className="page-wrap module-page time-leave-page">
    <section className="module-hero"><div><p className="eyebrow">TIME &amp; LEAVE</p><h1>일정·근태·휴가</h1><p>수기 근태와 휴가 신청·승인을 실제 저장합니다. 출입기록 자동연동 전까지 자료 출처는 수기 입력으로 표시됩니다.</p></div><span className="manual-source-badge">MANUAL · 자동연동 미설정</span></section>
    <section className="metric-grid module-metrics">{[
      ["오늘 근태", `${todayAttendance.length}명`, `재직자 ${activeEmployees.length}명 중 기록`],
      ["휴가 승인 대기", `${pendingLeaves.length}건`, "알림 업무 자동 생성"],
      ["올해 승인 휴가", `${(approvedUnits / 100).toFixed(1)}일`, "승인된 신청 합계"],
      ["근태 확인 대기", `${pendingAttendance.length}건`, "수기 입력 검토 필요"],
    ].map(([label, value, note], index) => <div className="compact-metric" key={label}><span className={`metric-accent ${["navy", "orange", "blue", "red"][index]}`}></span><p>{label}</p><h2>{value}</h2><small>{note}</small></div>)}</section>

    <section className="time-leave-entry-grid">
      <form className="panel operations-entry-card" onSubmit={createLeave}><div className="detail-card-heading"><div><p className="eyebrow">LEAVE REQUEST</p><h2>휴가 신청</h2></div><span>승인 필요</span></div><div className="operations-form-grid"><label><span>대상 직원</span><select required value={leaveDraft.employeeId} onChange={(event) => setLeaveDraft({ ...leaveDraft, employeeId: event.target.value })}>{activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} · {employee.department}</option>)}</select></label><label><span>휴가 종류</span><select value={leaveDraft.leaveType} onChange={(event) => { const value = event.target.value; setLeaveDraft({ ...leaveDraft, leaveType: value, units: value.startsWith("HALF") ? ".5" : leaveDraft.units }); }}>{Object.entries(leaveTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>시작일</span><input required type="date" value={leaveDraft.startDate} onChange={(event) => setLeaveDraft({ ...leaveDraft, startDate: event.target.value })} /></label><label><span>종료일</span><input required type="date" value={leaveDraft.endDate} onChange={(event) => setLeaveDraft({ ...leaveDraft, endDate: event.target.value })} /></label><label><span>사용일수</span><input required type="number" min=".5" step=".5" value={leaveDraft.units} onChange={(event) => setLeaveDraft({ ...leaveDraft, units: event.target.value })} /></label><label className="wide"><span>사유</span><input value={leaveDraft.reason} onChange={(event) => setLeaveDraft({ ...leaveDraft, reason: event.target.value })} /></label></div><button type="submit" className="primary-button">휴가 신청 저장</button></form>
      <form className="panel operations-entry-card" onSubmit={createAttendance}><div className="detail-card-heading"><div><p className="eyebrow">ATTENDANCE</p><h2>근태 기록</h2></div><span>수기 입력</span></div><div className="operations-form-grid"><label><span>대상 직원</span><select required value={attendanceDraft.employeeId} onChange={(event) => setAttendanceDraft({ ...attendanceDraft, employeeId: event.target.value })}>{activeEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name} · {employee.department}</option>)}</select></label><label><span>근무일</span><input required type="date" value={attendanceDraft.workDate} onChange={(event) => setAttendanceDraft({ ...attendanceDraft, workDate: event.target.value })} /></label><label><span>근무 형태</span><select value={attendanceDraft.workType} onChange={(event) => setAttendanceDraft({ ...attendanceDraft, workType: event.target.value })}>{Object.entries(attendanceTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>출근</span><input type="time" value={attendanceDraft.checkIn} onChange={(event) => setAttendanceDraft({ ...attendanceDraft, checkIn: event.target.value })} /></label><label><span>퇴근</span><input type="time" value={attendanceDraft.checkOut} onChange={(event) => setAttendanceDraft({ ...attendanceDraft, checkOut: event.target.value })} /></label><label className="wide"><span>메모</span><input value={attendanceDraft.memo} onChange={(event) => setAttendanceDraft({ ...attendanceDraft, memo: event.target.value })} /></label></div><button type="submit" className="primary-button">근태 기록 저장</button></form>
    </section>

    <section className="time-leave-tables">
      <article className="panel"><div className="table-toolbar"><div><h2>휴가 신청 현황</h2><span>{leaveRequests.length}건 · 0.5일은 50단위로 안전하게 저장됩니다.</span></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>직원</th><th>종류</th><th>기간</th><th>일수</th><th>사유</th><th>상태</th><th>처리</th></tr></thead><tbody>{loading ? <tr><td colSpan={7} className="table-message">불러오는 중입니다.</td></tr> : leaveRequests.length ? leaveRequests.map((item) => <tr key={item.id}><td>{employeeName(item.employee_id)}</td><td>{leaveTypeLabels[item.leave_type] ?? item.leave_type}</td><td>{item.start_date}~{item.end_date}</td><td>{(item.units / 100).toFixed(1)}일</td><td>{item.reason || "-"}</td><td><StatusPill value={approvalLabels[item.status] ?? item.status} /></td><td>{item.status === "PENDING" ? <span className="approval-route-note">상단 전자결재에서 처리</span> : "처리 완료"}</td></tr>) : <tr><td colSpan={7} className="empty-cell">등록된 휴가 신청이 없습니다.</td></tr>}</tbody></table></div></article>
      <article className="panel"><div className="table-toolbar"><div><h2>근태 기록 현황</h2><span>{attendanceRecords.length}건 · 출입시스템 연동 전 수기 기록</span></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>직원</th><th>근무일</th><th>형태</th><th>출퇴근</th><th>근무시간</th><th>출처</th><th>상태</th><th>처리</th></tr></thead><tbody>{loading ? <tr><td colSpan={8} className="table-message">불러오는 중입니다.</td></tr> : attendanceRecords.length ? attendanceRecords.map((item) => <tr key={item.id}><td>{employeeName(item.employee_id)}</td><td>{item.work_date}</td><td>{attendanceTypeLabels[item.work_type] ?? item.work_type}</td><td>{item.check_in || "-"}~{item.check_out || "-"}</td><td>{Math.floor(item.minutes_worked / 60)}시간 {item.minutes_worked % 60}분</td><td><span className="manual-source-badge compact">{item.source_type}</span></td><td><StatusPill value={approvalLabels[item.status] ?? item.status} /></td><td>{item.status === "RECORDED" ? <div className="row-actions"><button type="button" onClick={() => void decide("attendance", item.id, "APPROVED")}>확인</button><button type="button" className="reject-action" onClick={() => void decide("attendance", item.id, "REJECTED")}>반려</button></div> : "처리 완료"}</td></tr>) : <tr><td colSpan={8} className="empty-cell">등록된 근태 기록이 없습니다.</td></tr>}</tbody></table></div></article>
    </section>
  </div>;
}

type EmployeeDocument = {
  id: string; module: string; entityType: string; entityId: string; category: string; version: number;
  fileName: string; contentType: string; uploadedBy: string; createdAt: number; downloadUrl: string;
};

// 파일 선택창의 accept 와 같은 목록. 드래그로 넣은 파일도 같은 기준으로 거른다.
const DOCUMENT_FILE_TYPES = [".pdf", ".docx", ".xlsx", ".png", ".jpg", ".jpeg", ".txt", ".csv"];
// 서버(app/api/documents/route.ts)와 같은 상한이다.
const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;

const documentCategoryLabels: Record<string, string> = {
  ONBOARDING_SUBMISSION: "입사 제출 서류",
  EMPLOYMENT_CONTRACT: "근로계약서", PERSONNEL_ORDER: "인사발령서", CERTIFICATE: "증명서",
  EVALUATION: "평가서", RETIREMENT: "퇴직서류", CONSENT: "동의서", OTHER: "기타",
};

// 같은 서류를 다시 올려 갱신하는 성격의 분류만 버전을 매긴다. 나머지는 서로 다른 서류가
// 한 분류에 모이므로 v1, v2 라는 번호가 의미를 갖지 않아 "-" 로 둔다.
const VERSIONED_CATEGORIES = new Set(["EMPLOYMENT_CONTRACT", "PERSONNEL_ORDER", "CERTIFICATE"]);

function EmployeeDocumentView({ employees, onNotify }: { employees: Employee[]; onNotify: (message: string) => void }) {
  const [employeeId, setEmployeeId] = useState(employees[0]?.id ?? "");
  const [documents, setDocuments] = useState<EmployeeDocument[]>([]);
  const [category, setCategory] = useState("EMPLOYMENT_CONTRACT");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [recategorizing, setRecategorizing] = useState("");
  // 실패 사유를 카드 안에 직접 남긴다. 토스트만으로는 화면을 내려다보고 있으면 놓친다.
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const selectedEmployee = employees.find((employee) => employee.id === employeeId);

  async function load(targetId = employeeId) {
    if (!targetId) { setDocuments([]); setLoading(false); return; }
    setLoading(true);
    try {
      const response = await fetch(`/api/documents?module=hr&entityType=employee&entityId=${encodeURIComponent(targetId)}`);
      const payload = await response.json() as { documents?: EmployeeDocument[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "인사문서를 불러오지 못했습니다.");
      setDocuments(payload.documents ?? []);
    } catch (error) {
      onNotify(error instanceof Error ? error.message : "인사문서를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void load(employeeId); }, [employeeId]);

  // 파일 선택창과 드래그가 같은 검사를 거치게 한다. 서버도 같은 상한을 다시 확인한다.
  function chooseFile(candidate: File | undefined) {
    if (!candidate) return;
    const extension = `.${candidate.name.split(".").pop()?.toLowerCase() ?? ""}`;
    if (!DOCUMENT_FILE_TYPES.includes(extension)) {
      const message = `${DOCUMENT_FILE_TYPES.join(" ")} 형식만 등록할 수 있습니다.`;
      setNotice(message); onNotify(message);
      return;
    }
    if (candidate.size > DOCUMENT_MAX_BYTES) {
      const message = `${candidate.name} 은 ${(candidate.size / 1024 / 1024).toFixed(1)}MB 입니다. 25MB 이하만 등록할 수 있습니다.`;
      setNotice(message); onNotify(message);
      return;
    }
    setNotice("");
    setFile(candidate);
  }

  function dropFiles(event: React.DragEvent<HTMLFormElement>) {
    event.preventDefault();
    setDragging(false);
    const dropped = Array.from(event.dataTransfer.files);
    if (dropped.length > 1) onNotify("한 번에 한 개만 등록할 수 있어 첫 번째 파일만 사용합니다.");
    chooseFile(dropped[0]);
  }

  // 예전에는 fetch 를 감싸지 않아 네트워크 오류나 JSON 파싱 실패가 그대로 던져졌고,
  // 그러면 버튼을 눌러도 화면에 아무 반응이 남지 않았다. 사유를 반드시 표시한다.
  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!employeeId) { const message = "직원을 먼저 선택해 주세요."; setNotice(message); onNotify(message); return; }
    if (!file) { const message = "등록할 파일을 선택하거나 카드 위로 끌어다 놓아 주세요."; setNotice(message); onNotify(message); return; }
    setSaving(true);
    setNotice("");
    try {
      const form = new FormData();
      form.append("module", "hr"); form.append("entityType", "employee"); form.append("entityId", employeeId);
      form.append("category", category); form.append("file", file, file.name);
      const response = await fetch("/api/documents", { method: "POST", body: form });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        const message = payload.error || `문서를 저장하지 못했습니다 (${response.status}).`;
        setNotice(message); onNotify(message);
        return;
      }
      setFile(null);
      onNotify("인사문서 원본과 새 버전을 저장했습니다.");
      await load();
    } catch (error) {
      const message = error instanceof Error ? error.message : "문서를 저장하지 못했습니다.";
      setNotice(message); onNotify(message);
    } finally {
      setSaving(false);
    }
  }

  // 이미 등록된 문서의 분류를 바꾼다. 서버가 옮겨간 분류 기준으로 버전을 다시 매긴다.
  async function recategorize(target: EmployeeDocument, nextCategory: string) {
    if (!nextCategory || nextCategory === target.category) return;
    setRecategorizing(target.id);
    setNotice("");
    try {
      const response = await fetch("/api/documents", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: target.id, category: nextCategory }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        const message = payload.error || `분류를 바꾸지 못했습니다 (${response.status}).`;
        setNotice(message); onNotify(message);
        return;
      }
      onNotify(`${target.fileName} 분류를 ${documentCategoryLabels[nextCategory] ?? nextCategory}(으)로 옮겼습니다.`);
      await load();
    } catch (error) {
      const message = error instanceof Error ? error.message : "분류를 바꾸지 못했습니다.";
      setNotice(message); onNotify(message);
    } finally {
      setRecategorizing("");
    }
  }

  async function remove(document: EmployeeDocument) {
    if (!window.confirm(`${document.fileName} 문서를 목록에서 삭제할까요? 원본은 복구를 위해 보존됩니다.`)) return;
    const response = await fetch("/api/documents", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: document.id }) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) { onNotify(payload.error || "문서를 삭제하지 못했습니다."); return; }
    onNotify("문서를 소프트 삭제했습니다.");
    await load();
  }

  const latestByCategory = new Map<string, number>();
  documents.forEach((document) => latestByCategory.set(document.category, Math.max(latestByCategory.get(document.category) ?? 0, document.version)));

  // 분류별로 박스를 나눈다. 목록에 없는 예전 분류가 데이터에 남아 있어도 사라지지 않도록 뒤에 붙인다.
  const categoryOrder = [
    ...Object.keys(documentCategoryLabels),
    ...[...new Set(documents.map((item) => item.category))].filter((value) => !(value in documentCategoryLabels)),
  ];
  const groupedDocuments = categoryOrder
    .map((key) => [key, documents.filter((item) => item.category === key)] as const)
    .filter(([, group]) => group.length > 0);

  return <div className="page-wrap module-page employee-documents-page">
    <section className="module-hero"><div><p className="eyebrow">HR DOCUMENT VAULT</p><h1>인사문서</h1><p>직원별 계약서·발령서·증명서 원본을 버전별로 보관하고 다운로드·삭제 이력을 기록합니다.</p></div><span className="secure-document-badge">PRIVATE · 접근기록 저장</span></section>
    <section className="document-layout">
      <aside className="panel document-employee-list"><div className="detail-card-heading"><div><p className="eyebrow">EMPLOYEE</p><h2>직원 선택</h2></div><span>{employees.length}명</span></div><div>{employees.map((employee) => <button type="button" key={employee.id} className={employee.id === employeeId ? "active" : ""} onClick={() => setEmployeeId(employee.id)}><span>{employee.name.slice(0, 1)}</span><p><strong>{employee.name}</strong><small>{employee.department} · {employee.position}</small></p></button>)}</div></aside>
      <div className="document-content">
        <form
        className={`panel document-upload-card${dragging ? " dragging" : ""}`}
        onSubmit={upload}
        onDragEnter={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
        onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
        onDrop={dropFiles}
      ><div className="detail-card-heading"><div><p className="eyebrow">NEW VERSION</p><h2>{selectedEmployee?.name ?? "직원"} 문서 등록</h2></div><span>최대 25MB</span></div><div className="document-upload-fields"><label><span>문서 분류</span><select value={category} onChange={(event) => setCategory(event.target.value)}>{Object.entries(documentCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="file-field"><span>원본 파일</span><input type="file" accept={DOCUMENT_FILE_TYPES.join(",")} onChange={(event) => chooseFile(event.target.files?.[0])} /><strong>{file?.name ?? "파일을 선택하거나 이 카드 위로 끌어다 놓으세요."}</strong></label><button type="submit" className="primary-button" disabled={saving}>{saving ? "등록 중…" : "문서 등록"}</button></div>{notice && <p className="document-upload-notice">{notice}</p>}</form>
        {loading ? <section className="panel document-table-card"><div className="table-toolbar"><div><h2>보관 문서</h2><span>불러오는 중</span></div></div><p className="document-group-empty">문서를 불러오는 중입니다.</p></section> : groupedDocuments.length ? groupedDocuments.map(([groupCategory, groupDocuments]) => { const versioned = VERSIONED_CATEGORIES.has(groupCategory); return <section className="panel document-table-card" key={groupCategory}><div className="table-toolbar"><div><h2>{documentCategoryLabels[groupCategory] ?? groupCategory}</h2><span>{groupDocuments.length}건{versioned ? " · 같은 분류를 다시 올리면 버전이 증가합니다." : " · 버전을 매기지 않는 분류입니다."}</span></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>파일명</th><th>분류 변경</th><th>버전</th><th>등록자</th><th>등록일시</th><th>상태</th><th>작업</th></tr></thead><tbody>{groupDocuments.map((document) => <tr key={document.id}><td><a className="document-download-link" href={document.downloadUrl}>{document.fileName}</a></td><td><select className="document-category-select" value={document.category} disabled={recategorizing === document.id} onChange={(event) => void recategorize(document, event.target.value)}>{Object.entries(documentCategoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}{!(document.category in documentCategoryLabels) && <option value={document.category}>{document.category}</option>}</select></td><td>{versioned ? `v${document.version}` : "-"}</td><td>{document.uploadedBy}</td><td>{new Date(document.createdAt).toLocaleString("ko-KR")}</td><td>{versioned ? <StatusPill value={document.version === latestByCategory.get(document.category) ? "최신" : "이전 버전"} /> : "-"}</td><td><div className="row-actions"><a href={document.downloadUrl}>다운로드</a><button type="button" className="reject-action" onClick={() => void remove(document)}>삭제</button></div></td></tr>)}</tbody></table></div></section>; }) : <section className="panel document-table-card"><div className="table-toolbar"><div><h2>보관 문서</h2><span>0건</span></div></div><p className="document-group-empty">등록된 인사문서가 없습니다.</p></section>}
      </div>
    </section>
  </div>;
}

const formatWon = (value: number) => `₩${Math.round(value).toLocaleString("ko-KR")}`;

function payrollMonthLabel(yearMonth: string) {
  const [year, month] = yearMonth.split("-");
  return `${year}년 ${Number(month)}월`;
}

const payrollStatusLabels: Record<PayrollSummary["status"], string> = {
  DRAFT: "작성 중", REVIEW: "검토 중", APPROVED: "승인 완료", LOCKED: "마감 잠금",
};

// 상태 셀렉트에 쓰는 "다음에 할 일" 표현. 위 라벨은 현재 상태를 가리키는 말이라 다르다.
const payrollStatusOptionLabels: Record<PayrollSummary["status"], string> = {
  DRAFT: "작성 중", REVIEW: "검토 요청", APPROVED: "승인 결재 요청", LOCKED: "마감 잠금",
};

// app/api/hr/payroll/route.ts 의 allowedTransitions 와 같은 표를 둔다. 서버가 막을 선택지를
// 열어 두면 눌러도 409 만 돌아와 아무 일도 안 일어난 것처럼 보인다. 작성 중에서 곧바로 마감
// 잠금까지 갈 수 있고, 검토 요청·승인 결재는 필요할 때만 거친다.
const payrollStatusTransitions: Record<PayrollSummary["status"], PayrollSummary["status"][]> = {
  DRAFT: ["DRAFT", "REVIEW", "LOCKED"],
  REVIEW: ["DRAFT", "REVIEW", "APPROVED", "LOCKED"],
  APPROVED: ["DRAFT", "APPROVED", "LOCKED"],
  LOCKED: ["DRAFT", "LOCKED"],
};

function PayrollOverview({ onSelectMonth }: { onSelectMonth: (month: string) => void }) {
  const [summaries, setSummaries] = useState<PayrollSummary[]>([]);
  const [period, setPeriod] = useState<"all" | "2026" | "2025">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch("/api/hr/payroll");
        const payload = await response.json() as { summaries?: PayrollSummary[]; error?: string };
        if (!response.ok) throw new Error(payload.error || "급여 기록을 불러오지 못했습니다.");
        if (!cancelled) setSummaries(payload.summaries ?? []);
      } catch (fetchError) {
        if (!cancelled) setError(fetchError instanceof Error ? fetchError.message : "급여 기록을 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const latest = summaries[0];
  const rows = period === "all" ? summaries : summaries.filter((summary) => summary.yearMonth.startsWith(`${period}-`));
  const metrics = [
    { label: "최근 급여월", value: latest ? payrollMonthLabel(latest.yearMonth) : "-", note: "인건비 정리 원본 기준" },
    { label: "급여 대상", value: latest ? `${latest.employeeCount}명` : "-", note: "정규 월별 기록", tone: "blue" },
    { label: "지급총액", value: latest ? formatWon(latest.grossPay) : "-", note: "기본급·수당·인센티브 포함", tone: "orange" },
    { label: "실 지급액", value: latest ? formatWon(latest.netPay) : "-", note: "지급총액 - 원본 공제", tone: "red" },
  ];

  return <div className="page-wrap module-page payroll-page"><section className="module-hero"><div><p className="eyebrow">PAYROLL RECORDS</p><h1>급여관리</h1><p>2025~2026년 인건비 자료를 월별로 확인합니다. 세금·4대보험 전체 공제 자료가 아니므로 지급액은 원본 기록 기준입니다.</p></div><span className="payroll-import-badge">20개월 자료 반영</span></section><section className="metric-grid module-metrics">{metrics.map((metric) => <div className="compact-metric" key={metric.label}><span className={`metric-accent ${metric.tone ?? "navy"}`}></span><p>{metric.label}</p><h2>{metric.value}</h2><small>{metric.note}</small></div>)}</section><section className="panel table-panel"><div className="table-toolbar"><div><h2>급여월 현황</h2><span>{period === "all" ? `전체 ${rows.length}개월` : `${period}년 ${rows.length}개월`} · 급여월을 클릭하면 개인별 항목과 원본 메모를 확인할 수 있습니다.</span></div><div className="payroll-year-filter" role="group" aria-label="급여 조회 기간"><button type="button" className={period === "all" ? "active" : ""} onClick={() => setPeriod("all")}>전체 기간</button><button type="button" className={period === "2026" ? "active" : ""} onClick={() => setPeriod("2026")}>2026년</button><button type="button" className={period === "2025" ? "active" : ""} onClick={() => setPeriod("2025")}>2025년</button></div></div><div className="data-table-wrap"><table className="data-table payroll-table"><thead><tr>{["급여월", "대상 인원", "지급총액", "공제총액", "실 지급액", "상태"].map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan={6} className="table-message">급여 기록을 불러오는 중입니다.</td></tr> : error ? <tr><td colSpan={6} className="table-message error">{error}</td></tr> : rows.map((summary) => <tr key={summary.yearMonth} onClick={() => onSelectMonth(summary.yearMonth)} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && onSelectMonth(summary.yearMonth)}><td><button type="button" className="month-link">{payrollMonthLabel(summary.yearMonth)}<span>상세 보기 →</span></button></td><td>{summary.employeeCount}명</td><td>{formatWon(summary.grossPay)}</td><td>{formatWon(summary.deductions)}</td><td>{formatWon(summary.netPay)}</td><td><StatusPill value={payrollStatusLabels[summary.status]} />{summary.compensationStatus === "DRAFT" && <StatusPill value="수정 중" />}</td></tr>)}</tbody></table></div></section></div>;
}

async function fetchPayrollMonth(month: string) {
  const response = await fetch(`/api/hr/payroll?month=${encodeURIComponent(month)}`);
  const payload = await response.json() as { summary?: PayrollSummary | null; records?: PayrollRecord[]; error?: string };
  if (!response.ok) throw new Error(payload.error || "월별 급여 기록을 불러오지 못했습니다.");
  return { summary: payload.summary ?? null, records: payload.records ?? [] };
}

function PayrollMonthDetail({ month, onBack }: { month: string; onBack: () => void }) {
  const [records, setRecords] = useState<PayrollRecord[]>([]);
  const [summary, setSummary] = useState<PayrollSummary | null>(null);
  const [selectedRecord, setSelectedRecord] = useState<PayrollRecord | null>(null);
  // 공제 열 제목을 누르면 각 행 아래에 국민연금·건강보험 같은 항목별 내역이 펼쳐진다.
  const [deductionOpen, setDeductionOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const PAYROLL_DEDUCTION_LOCK_MESSAGE = "승인 또는 마감된 급여월은 공제값을 수정할 수 없습니다. 먼저 작성 중으로 되돌려 주세요.";

  // 팝업에서 고친 지급 항목·항목별 공제·메모를 한 번에 저장한다. 승인·마감된 달이면 서버가 막으므로
  // 잠금을 풀지 물어보고 한 번만 다시 시도한다 (예전 공제값 저장에서 쓰던 흐름 그대로).
  async function submitPayrollRecord(input: PayrollRecordInput) {
    const response = await fetch("/api/hr/payroll", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: input.id, pay: input.pay, deductionDetail: input.deductionDetail, notes: input.notes }),
    });
    const payload = await response.json() as { record?: PayrollRecord; error?: string };
    if (!response.ok || !payload.record) throw new Error(payload.error || "급여 내역을 저장하지 못했습니다.");
    const refreshed = await fetchPayrollMonth(month);
    setSummary(refreshed.summary); setRecords(refreshed.records);
    setSelectedRecord(refreshed.records.find((item) => item.id === input.id) ?? payload.record);
    setNotice("급여 내역을 저장했습니다.");
  }

  async function savePayrollRecord(input: PayrollRecordInput) {
    setError(""); setNotice("");
    try {
      await submitPayrollRecord(input);
      return "";
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "급여 내역을 저장하지 못했습니다.";
      if (message === PAYROLL_DEDUCTION_LOCK_MESSAGE && window.confirm(`${message}
지금 급여월 잠금을 해제하고 계속할까요?`)) {
        const unlocked = await updatePayrollStatus("DRAFT");
        if (!unlocked) return message;
        try { await submitPayrollRecord(input); return ""; }
        catch (retryError) { return retryError instanceof Error ? retryError.message : "급여 내역을 저장하지 못했습니다."; }
      }
      return message;
    }
  }

  async function updatePayrollStatus(status: PayrollSummary["status"]) {
    setError(""); setNotice("");
    let reopenedReason = "";
    if (status === "DRAFT" && summary && ["APPROVED", "LOCKED"].includes(summary.status)) {
      reopenedReason = window.prompt("승인·마감된 급여월을 다시 여는 사유를 입력해 주세요.")?.trim() ?? "";
      if (!reopenedReason) { setError("급여월 재개방 사유가 필요합니다."); return false; }
    }
    const response = await fetch("/api/hr/payroll", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ period: month, status, reopenedReason }) });
    const payload = await response.json() as { error?: string; approvalSubmitted?: boolean; autoApproved?: boolean; financeExpenseId?: string };
    if (!response.ok) { setError(payload.error || "급여 처리 상태를 변경하지 못했습니다."); return false; }
    if (payload.autoApproved) {
      setSummary((current) => current ? { ...current, status } : current);
      setNotice("요청자와 승인자가 동일해 승인을 자동 처리했습니다. 전자결재 기록은 남습니다.");
      return true;
    }
    if (payload.approvalSubmitted) { setNotice("전자결재를 제출했습니다. 최종 승인 후 급여 상태가 반영됩니다."); return false; }
    setSummary((current) => current ? { ...current, status } : current);
    if (payload.financeExpenseId) setNotice("급여월을 마감하고 재무회계 지급대기 원장에 연결했습니다.");
    else if (status === "DRAFT" && reopenedReason) setNotice("급여월을 다시 열고 미지급 재무 요청을 취소했습니다.");
    return true;
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const payload = await fetchPayrollMonth(month);
        if (!cancelled) {
          setSummary(payload.summary);
          setRecords(payload.records);
        }
      } catch (fetchError) {
        if (!cancelled) setError(fetchError instanceof Error ? fetchError.message : "월별 급여 기록을 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [month]);

  // 공제 전 총계는 급여대장의 "지급합계"와 같은 값이다. 공제 열 제목은 눌러서 항목별 내역을 편다.
  const payrollColumns = ["직원", "부서", "기본급", "식대", "육아수당", "차량보조", "인센티브", "상여", "연차수당", "퇴직금", "공제 전 총계", "공제", "실 지급액", "상태"];

  return <div className="page-wrap detail-page payroll-page">
    <button type="button" className="back-button" onClick={onBack}>← 급여월 현황</button>
    <section className="module-hero"><div><p className="eyebrow">MONTHLY PAYROLL DETAIL</p><h1>{payrollMonthLabel(month)} 급여 상세</h1><p>직원별 기본급과 모든 수당 항목을 한 표에서 확인합니다. 직원명을 클릭하면 추가 항목과 원본 메모를 볼 수 있습니다.</p></div><div className="payroll-workflow"><span className="payroll-import-badge">{summary ? payrollStatusLabels[summary.status] : "불러오는 중"}</span><select aria-label="급여 처리 상태" value={summary?.status ?? "DRAFT"} onChange={(event) => void updatePayrollStatus(event.target.value as PayrollSummary["status"])} disabled={!summary}>{(["DRAFT", "REVIEW", "APPROVED", "LOCKED"] as const).map((value) => {
              const allowed = payrollStatusTransitions[summary?.status ?? "DRAFT"].includes(value);
              return <option key={value} value={value} disabled={!allowed}>{payrollStatusOptionLabels[value]}{allowed ? "" : " · 지금은 선택 불가"}</option>;
            })}</select></div></section>
    {notice && <div className="finance-control-message" role="status">{notice}</div>}
    {error && <div className="payroll-status-error" role="alert">{error}</div>}
    <section className="payroll-summary"><div><span>급여 대상</span><strong>{summary ? `${summary.employeeCount}명` : "-"}</strong><small>월별 정규 급여 행</small></div><div><span>지급총액</span><strong>{summary ? formatWon(summary.grossPay) : "-"}</strong><small>기본급·수당·인센티브 포함</small></div><div><span>공제총액</span><strong>{summary ? formatWon(summary.deductions) : "-"}</strong><small>원본 공제 열 합계</small></div><div><span>실 지급액</span><strong>{summary ? formatWon(summary.netPay) : "-"}</strong><small>실제 세후 송금액과 다를 수 있음</small></div></section>
    <section className="panel table-panel"><div className="table-toolbar"><div><h2>개인별 급여 내역</h2><span>전체 {records.length}명 · 가로로 이동하면 모든 수당 항목을 확인할 수 있습니다.</span></div><span className="payroll-source-note">인건비 정리 원본 기준</span></div><div className="data-table-wrap payroll-detail-scroll"><table className="data-table payroll-detail-table"><thead><tr>{payrollColumns.map((column) => <th key={column}>{column === "공제" ? <button type="button" className="payroll-deduction-toggle" aria-expanded={deductionOpen} onClick={() => setDeductionOpen((value) => !value)}>공제 <span aria-hidden="true">{deductionOpen ? "▾" : "▸"}</span></button> : column}</th>)}</tr></thead><tbody>{loading ? <tr><td colSpan={payrollColumns.length} className="table-message">급여 기록을 불러오는 중입니다.</td></tr> : error ? <tr><td colSpan={payrollColumns.length} className="table-message error">{error}</td></tr> : records.map((record) => <tr key={record.id}><td><button type="button" className="payroll-person-link" onClick={() => setSelectedRecord(record)}>{record.employeeName}</button></td><td>{record.department ?? "퇴직·미등록"}</td><td>{formatWon(record.basePay)}</td><td>{formatWon(record.mealAllowance)}</td><td>{formatWon(record.childcareAllowance)}</td><td>{formatWon(record.vehicleAllowance)}</td><td>{formatWon(record.incentive)}</td><td>{formatWon(record.bonus)}</td><td>{formatWon(record.annualLeavePay)}</td><td>{formatWon(record.retirementPay)}</td><td className="payroll-gross-cell">{formatWon(record.grossPay)}</td><td>{formatWon(record.deductions)}{deductionOpen && <ul className="payroll-deduction-breakdown">{Object.entries(record.deductionDetail ?? {}).length ? Object.entries(record.deductionDetail ?? {}).map(([label, value]) => <li key={label}><span>{label}</span><em>{formatWon(Number(value))}</em></li>) : <li className="empty"><span>항목 내역 없음</span></li>}</ul>}</td><td>{formatWon(record.netPay)}</td><td><StatusPill value="자료 반영" /></td></tr>)}</tbody></table></div></section>
    {selectedRecord && <PayrollRecordModal record={selectedRecord}
      locked={Boolean(summary && !["DRAFT", "REVIEW"].includes(summary.status))}
      lockLabel={summary ? payrollStatusLabels[summary.status] : ""}
      onClose={() => setSelectedRecord(null)} onSave={savePayrollRecord} />}
  </div>;
}


type PayrollRecordInput = {
  id: string;
  pay: Record<string, number>;
  deductionDetail: Record<string, number>;
  notes: string;
};

// 급여대장에서 흔히 쓰는 공제 항목. 목록에 없는 항목도 이름을 직접 적어 넣을 수 있다.
const DEDUCTION_PRESETS = [
  "국민연금", "건강보험", "장기요양보험료", "고용보험", "산재보험",
  "소득세", "지방소득세", "연말정산소득세", "연말정산지방소득세", "연말정산농특세",
  "학자금상환액", "건강보험료정산", "장기요양보험정산", "실비정산", "기타공제",
];

// 지급 항목. 앞의 8개가 지급총액을 이루고, 나머지는 참고용 기록이다.
const PAYROLL_PAY_FIELDS: Array<[key: string, label: string, inGross: boolean]> = [
  ["basePay", "기본급", true], ["mealAllowance", "식대", true],
  ["childcareAllowance", "육아수당", true], ["vehicleAllowance", "차량보조", true],
  ["incentive", "인센티브", true], ["bonus", "상여", true],
  ["annualLeavePay", "연차수당", true], ["personalExpense", "개인비용지급", true], ["retirementPay", "퇴직금", true],
  ["nonTaxable", "비과세", false], ["welfareFund", "복지기금", false],
  ["cardUsage", "카드 사용액", false], ["personalPurchase", "개인매입", false],
  ["annualSalary", "연봉 기준", false],
];

function PayrollRecordModal({ record, locked, lockLabel, onClose, onSave }: {
  record: PayrollRecord;
  locked: boolean;
  lockLabel: string;
  onClose: () => void;
  onSave: (input: PayrollRecordInput) => Promise<string>;
}) {
  const [pay, setPay] = useState<Record<string, string>>(() =>
    Object.fromEntries(PAYROLL_PAY_FIELDS.map(([key]) => [key, String((record as unknown as Record<string, number>)[key] ?? 0)])));
  const [items, setItems] = useState<Array<{ label: string; amount: string }>>(() => {
    const detail = Object.entries(record.deductionDetail ?? {});
    if (detail.length) return detail.map(([label, amount]) => ({ label, amount: String(amount) }));
    // 항목 내역이 없던 기록은 총액 한 줄로 열어 둔다. 사람이 항목을 나눠 적으면 그때부터 내역이 생긴다.
    return record.deductions ? [{ label: "기타공제", amount: String(record.deductions) }] : [];
  });
  const [notes, setNotes] = useState(record.notes);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  // 내려가면 제목줄을 절반 높이로 접는다. 지원자·퇴직 팝업과 같은 방식이다.
  const [condensed, setCondensed] = useState(false);

  const grossPay = PAYROLL_PAY_FIELDS.filter(([, , inGross]) => inGross)
    .reduce((sum, [key]) => sum + (Number(pay[key]) || 0), 0);
  const deductions = items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);

  function updateItem(index: number, patch: Partial<{ label: string; amount: string }>) {
    setItems((current) => current.map((item, position) => position === index ? { ...item, ...patch } : item));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const named = items.filter((item) => item.label.trim());
    if (named.length !== items.length) { setMessage("공제 항목 이름을 모두 입력해 주세요."); return; }
    const detail: Record<string, number> = {};
    for (const item of named) {
      const amount = Math.round(Number(item.amount) || 0);
      if (!amount) continue;
      detail[item.label.trim()] = (detail[item.label.trim()] ?? 0) + amount;
    }
    setSaving(true); setMessage("");
    const failure = await onSave({
      id: record.id, notes,
      pay: Object.fromEntries(PAYROLL_PAY_FIELDS.map(([key]) => [key, Math.round(Number(pay[key]) || 0)])),
      deductionDetail: detail,
    });
    setSaving(false);
    setMessage(failure || "저장했습니다.");
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <form
      className={`payroll-record-modal${condensed ? " condensed" : ""}`}
      onSubmit={submit}
      onMouseDown={(event) => event.stopPropagation()}
      onScroll={(event) => {
        const top = event.currentTarget.scrollTop;
        setCondensed((current) => nextCondensed(current, top));
      }}
    >
      <div className="modal-header">
        <div><p className="eyebrow">PAYROLL BREAKDOWN</p><h2>{record.employeeName} · {payrollMonthLabel(record.yearMonth)}</h2></div>
        <div className="modal-header-actions">
          <button type="submit" className="header-save-button" disabled={saving}>{saving ? "저장 중…" : "변경사항 저장"}</button>
          <button type="button" className="modal-close" onClick={onClose} aria-label="닫기">×</button>
        </div>
      </div>
      <div className="payroll-record-summary">
        <div><span>지급총액</span><strong>{formatWon(grossPay)}</strong></div>
        <div><span>공제 합계</span><strong>{formatWon(deductions)}</strong></div>
        <div><span>실 지급액</span><strong>{formatWon(grossPay - deductions)}</strong></div>
      </div>
      {locked && <p className="optional-form-notice">{lockLabel} 상태입니다. 저장할 때 잠금을 해제할지 먼저 물어봅니다.</p>}

      <div className="payroll-edit-section">
        <div className="detail-card-heading"><div><p className="eyebrow">PAYMENTS</p><h3>지급 항목</h3></div><span>앞의 8개가 지급총액</span></div>
        <div className="payroll-edit-grid">{PAYROLL_PAY_FIELDS.map(([key, label, inGross]) => <label key={key} className={inGross ? "" : "reference"}>
          <span>{label}{inGross ? "" : " · 참고"}</span>
          <input type="number" step="1" value={pay[key]} onChange={(event) => setPay({ ...pay, [key]: event.target.value })} />
        </label>)}</div>
      </div>

      <div className="payroll-edit-section">
        <div className="detail-card-heading"><div><p className="eyebrow">DEDUCTIONS</p><h3>공제 내역</h3></div><span>{formatWon(deductions)}</span></div>
        <div className="payroll-deduction-rows">{items.map((item, index) => <div key={index} className="payroll-deduction-row">
          <input list="payroll-deduction-presets" value={item.label} placeholder="항목명 (예: 국민연금)"
            onChange={(event) => updateItem(index, { label: event.target.value })} aria-label={`공제 항목 ${index + 1} 이름`} />
          <input type="number" step="1" value={item.amount}
            onChange={(event) => updateItem(index, { amount: event.target.value })} aria-label={`공제 항목 ${index + 1} 금액`} />
          <button type="button" className="reject-action" onClick={() => setItems((current) => current.filter((_, position) => position !== index))}>삭제</button>
        </div>)}{items.length ? null : <p className="interview-empty">등록된 공제 항목이 없습니다.</p>}</div>
        <datalist id="payroll-deduction-presets">{DEDUCTION_PRESETS.map((name) => <option key={name} value={name} />)}</datalist>
        <button type="button" className="outline-button" onClick={() => setItems((current) => [...current, { label: "", amount: "0" }])}>공제 항목 추가</button>
        <small>환급이면 음수로 적습니다(예: 연말정산소득세 -21,900). 실 지급액은 지급총액 − 공제 합계로 다시 계산됩니다.</small>
      </div>

      <div className="payroll-edit-section">
        <div className="detail-card-heading"><div><p className="eyebrow">NOTE</p><h3>메모</h3></div><span>{record.sourceSheet} · {record.sourceRow}행</span></div>
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="퇴사일, 정산 사유 등 참고할 내용을 적습니다." />
      </div>

      {message && <p className="retirement-settlement-message">{message}</p>}
    </form>
  </div>;
}

function normalizedMatch(value: string) {
  return value.replace(/[\s.-]/g, "").toLowerCase();
}

function previousApplicationsFor(applicant: Applicant, applicants: Applicant[]) {
  return applicants.filter((item) => {
    if (item.id === applicant.id || normalizedMatch(item.name) !== normalizedMatch(applicant.name)) return false;
    const sameEmail = Boolean(applicant.email && item.email && normalizedMatch(item.email) === normalizedMatch(applicant.email));
    const samePhone = Boolean(applicant.phone && item.phone && normalizedMatch(item.phone) === normalizedMatch(applicant.phone));
    return sameEmail || samePhone;
  });
}

function RecruitmentView({ applicants, recruiters, requisitions, query, onAdd, onSelect, onOwnerChange, onDelete }: { applicants: Applicant[]; recruiters: Employee[]; requisitions: RecruitmentRequisitionOption[]; query: string; onAdd: () => void; onSelect: (id: string) => void; onOwnerChange: (applicantId: string, ownerId: string) => void; onDelete: (id: string) => void }) {
  const visible = query ? applicants.filter((applicant) => JSON.stringify(applicant).toLowerCase().includes(query.toLowerCase())) : applicants;
  // 면접 전형 진행 중 = 서류 합격 상태이면서 면접 일정이 잡힌 사람. 탈락자와 처우 단계로
  // 넘어간 사람은 stage 가 달라 자연히 빠진다.
  const interviewing = visible
    .filter((applicant) => applicant.stage === SCREENING_PASSED_STAGE && interviewScheduleLabel(applicant))
    .slice()
    .sort((a, b) => interviewSortKey(a).localeCompare(interviewSortKey(b)));
  // 면접 결과. 처우가 저장된 뒤의 상태들을 입사예정일 순으로 모아 둔다 — 수락도 거절도 함께 남는다.
  const passed = visible
    .filter((applicant) => OFFER_STAGES.includes(applicant.stage) && applicant.offer)
    .slice()
    .sort((a, b) => (a.offer?.startDate || "9999-99-99").localeCompare(b.offer?.startDate || "9999-99-99"));
  // 입사 예정자. 처우 제안을 수락해 확정된 사람만이다 — 제안만 해 둔 사람은 여기 오지 않는다.
  const joining = passed.filter((applicant) => ["ACCEPTED", "ONBOARDED"].includes(applicant.offer?.status ?? ""));
  // 절차가 끝난 사람은 위 지원 현황에서 빼고 맨 아래 "채용 종료" 표에만 둔다.
  // 진행 중인 사람만 위에 남아야 오늘 손댈 대상이 바로 보인다.
  const closed = visible
    .filter((applicant) => CLOSED_STAGES.includes(applicant.stage))
    .slice()
    .sort((a, b) => b.applied.localeCompare(a.applied));
  const active = visible.filter((applicant) => !CLOSED_STAGES.includes(applicant.stage));
  return <div className="page-wrap module-page recruitment-page">
    <section className="module-hero"><div><p className="eyebrow">RECRUITING PIPELINE</p><h1>지원자 관리</h1><p>지원자별 담당자와 서류 합격·면접 회신 과정을 한 흐름으로 관리합니다.</p></div><button type="button" className="primary-button" onClick={onAdd}>+ 지원자 등록</button></section>
    <section className="metric-grid module-metrics">{[
      { label: "등록 지원자", value: `${applicants.length}명`, note: "실제 등록 기준" },
      { label: "서류 검토", value: `${applicants.filter((item) => item.stage === "서류 검토").length}명`, note: "담당자 확인 필요", tone: "blue" },
      { label: "서류 합격 안내", value: `${applicants.filter((item) => item.stage === "서류 합격 안내 완료").length}명`, note: "면접 회신 대기", tone: "orange" },
      { label: "면접 일정 회신", value: `${applicants.filter((item) => item.stage === "면접 일정 회신 완료").length}명`, note: "면접관리 연동", tone: "green" },
    ].map((metric) => <div className="compact-metric" key={metric.label}><span className={`metric-accent ${metric.tone ?? "navy"}`}></span><p>{metric.label}</p><h2>{metric.value}</h2><small>{metric.note}</small></div>)}</section>
    <section className="panel table-panel">
      <div className="table-toolbar"><div><h2>지원 현황</h2><span>진행 중 {active.length}명 · 종료 {closed.length}명은 아래 채용 종료 표에서 봅니다</span></div><div><button type="button">공고 전체</button><button type="button">단계 필터</button></div></div>
      <div className="data-table-wrap"><table className="data-table applicant-table"><thead><tr><th>지원자</th><th className="applicant-phone-cell">연락처</th><th className="applicant-to-column">채용요청·TO</th><th>지원 직무</th><th>지원일</th><th>지원경로</th><th>경력</th><th className="applicant-owner-column">담당자</th><th className="applicant-stage-column">현재 단계</th><th>채용단계</th><th className="applicant-delete-column">삭제</th></tr></thead><tbody>{active.length ? active.map((applicant) => {
        const previous = previousApplicationsFor(applicant, applicants);
        const requisition = requisitions.find((item) => item.id === applicant.requisitionId);
        return <tr key={applicant.id}><td><button type="button" className="name-link" onClick={() => onSelect(applicant.id)}><span>{applicant.name.slice(0, 1)}</span>{applicant.name}</button>{previous.length > 0 && <em className="repeat-applicant-badge">재지원 {previous.length}건</em>}</td><td className="applicant-phone-cell">{applicant.phone || "미입력"}</td><td className="applicant-to-column"><span className={requisition ? "applicant-to-link" : "applicant-to-exception"}>{requisition?.title ?? "예외·미연결"}</span></td><td>{applicant.role}</td><td>{applicant.applied}</td><td>{applicant.source}</td><td>{applicant.experience || "미입력"}</td><td className="applicant-owner-column"><select className="recruiter-cell-select" value={applicant.ownerId} onChange={(event) => onOwnerChange(applicant.id, event.target.value)}><option value="">미지정</option>{recruiters.map((recruiter) => <option value={recruiter.id} key={recruiter.id}>{recruiter.name}</option>)}</select></td><td className="applicant-stage-column"><span className="applicant-current-stage">{currentStageOf(applicant)}</span></td><td><span className={`screening-stage ${recruitStageOf(applicant).toLowerCase()}`}>{recruitStageLabels[recruitStageOf(applicant)]}</span></td><td className="applicant-delete-column"><button type="button" className="delete-applicant-button" onClick={() => onDelete(applicant.id)} aria-label={`${applicant.name} 지원자 모든 정보 삭제`} title="지원자 모든 정보 삭제"><span aria-hidden="true">🗑</span></button></td></tr>;
      }) : <tr><td colSpan={11} className="empty-cell">{closed.length ? "진행 중인 지원자가 없습니다. 종료된 인원은 아래 채용 종료 표에 있습니다." : "등록된 지원자가 없습니다."}</td></tr>}</tbody></table></div>
    </section>

    <section className="panel table-panel interview-schedule-panel">
      <div className="table-toolbar"><div><h2>면접 전형 진행</h2><span>면접 일시 순 {interviewing.length}명</span></div></div>
      <div className="data-table-wrap"><table className="data-table">
        <thead><tr><th>면접 일시</th><th>지원자</th><th>연락처</th><th>채용요청·TO</th><th>지원 직무</th><th>면접 유형</th><th>면접관</th><th>장소·링크</th><th>담당자</th></tr></thead>
        <tbody>{interviewing.length ? interviewing.map((applicant) => {
          const requisition = requisitions.find((item) => item.id === applicant.requisitionId);
          return <tr key={applicant.id}>
            <td><span className="interview-when"><strong>{applicant.interview?.date || "일자 미정"}</strong>{applicant.interview?.time && <em>{applicant.interview.time}</em>}</span></td>
            <td><button type="button" className="name-link" onClick={() => onSelect(applicant.id)}><span>{applicant.name.slice(0, 1)}</span>{applicant.name}</button></td>
            <td className="applicant-phone-cell">{applicant.phone || "미입력"}</td>
            <td><span className={requisition ? "applicant-to-link" : "applicant-to-exception"}>{requisition?.title ?? "예외·미연결"}</span></td>
            <td>{applicant.role}</td>
            <td>{applicant.interview?.type || "미정"}</td>
            <td>{applicant.interview?.interviewers || "미정"}</td>
            <td>{applicant.interview?.location || "미정"}</td>
            <td>{applicant.owner || "미지정"}</td>
          </tr>;
        }) : <tr><td colSpan={9} className="empty-cell">면접 일정이 잡힌 지원자가 없습니다.</td></tr>}</tbody>
      </table></div>
    </section>

    {/* 처우를 수락해 입사가 확정된 사람만 따로 본다. 아래 면접 결과 표에는 거절·타사 합격도 함께 남는다. */}
    <section className="panel table-panel joining-applicant-panel">
      <div className="table-toolbar"><div><h2>입사 예정자</h2><span>처우 제안 수락 · 입사예정일 순 {joining.length}명</span></div></div>
      <div className="data-table-wrap"><table className="data-table">
        <thead><tr><th>입사예정일</th><th>지원자</th><th>연락처</th><th>채용요청·TO</th><th>제안 직무</th><th>소속</th><th>고용형태</th><th>연봉</th><th>담당자</th></tr></thead>
        <tbody>{joining.length ? joining.map((applicant) => {
          const requisition = requisitions.find((item) => item.id === applicant.requisitionId);
          const offer = applicant.offer;
          return <tr key={applicant.id}>
            <td><strong>{offer?.startDate || "미정"}</strong></td>
            <td><button type="button" className="name-link" onClick={() => onSelect(applicant.id)}><span>{applicant.name.slice(0, 1)}</span>{applicant.name}</button></td>
            <td className="applicant-phone-cell">{applicant.phone || "미입력"}</td>
            <td><span className={requisition ? "applicant-to-link" : "applicant-to-exception"}>{requisition?.title ?? "예외·미연결"}</span></td>
            <td>{offer?.proposedTitle || applicant.role}</td>
            <td>{offer?.department || "미정"}</td>
            <td>{offer?.employmentType || "미정"}</td>
            <td>{offer ? `${offer.annualSalary.toLocaleString("ko-KR")}원` : "미정"}</td>
            <td>{applicant.owner || "미지정"}</td>
          </tr>;
        }) : <tr><td colSpan={9} className="empty-cell">처우 제안을 수락한 지원자가 없습니다.</td></tr>}</tbody>
      </table></div>
    </section>

    <section className="panel table-panel passed-applicant-panel">
      <div className="table-toolbar"><div><h2>면접 결과</h2><span>처우 제안 이후 · 입사예정일 순 {passed.length}명</span></div></div>
      <div className="data-table-wrap"><table className="data-table">
        <thead><tr><th>입사예정일</th><th>지원자</th><th>채용요청·TO</th><th>제안 직무</th><th>소속</th><th>고용형태</th><th>연봉</th><th>진행 상태</th><th>담당자</th></tr></thead>
        <tbody>{passed.length ? passed.map((applicant) => {
          const requisition = requisitions.find((item) => item.id === applicant.requisitionId);
          const offer = applicant.offer;
          return <tr key={applicant.id}>
            <td><strong>{offer?.startDate || "미정"}</strong></td>
            <td><button type="button" className="name-link" onClick={() => onSelect(applicant.id)}><span>{applicant.name.slice(0, 1)}</span>{applicant.name}</button></td>
            <td><span className={requisition ? "applicant-to-link" : "applicant-to-exception"}>{requisition?.title ?? "예외·미연결"}</span></td>
            <td>{offer?.proposedTitle || applicant.role}</td>
            <td>{offer?.department || "미정"}</td>
            <td>{offer?.employmentType || "미정"}</td>
            <td>{offer ? `${offer.annualSalary.toLocaleString("ko-KR")}원` : "미정"}</td>
            <td><span className="passed-status">{applicant.stage}</span></td>
            <td>{applicant.owner || "미지정"}</td>
          </tr>;
        }) : <tr><td colSpan={9} className="empty-cell">처우를 제안한 지원자가 없습니다.</td></tr>}</tbody>
      </table></div>
    </section>

    {/* 절차가 끝난 사람은 여기 한 곳에 모은다. 위 지원 현황에는 진행 중인 사람만 남는다. */}
    <section className="panel table-panel closed-applicant-panel">
      <div className="table-toolbar"><div><h2>채용 종료</h2><span>탈락·제안 거절·타사 합격·오퍼 수락 {closed.length}명</span></div>
        <span className="closed-summary">{[
          { label: "탈락", count: closed.filter((item) => REJECTED_STAGES.includes(item.stage)).length },
          { label: "제안 거절", count: closed.filter((item) => closedReasonOf(item).label === "제안 거절").length },
          { label: "타사 합격", count: closed.filter((item) => item.stage === OTHER_OFFER_STAGE).length },
          { label: "오퍼 수락", count: closed.filter((item) => closedReasonOf(item).label === "오퍼 수락").length },
        ].filter((item) => item.count).map((item) => `${item.label} ${item.count}`).join(" · ") || "종료된 지원자 없음"}</span></div>
      <div className="data-table-wrap"><table className="data-table">
        <thead><tr><th>지원자</th><th>채용요청·TO</th><th>지원 직무</th><th>종료 구분</th><th>마지막 단계</th><th>채용단계</th><th>지원일</th><th>담당자</th></tr></thead>
        <tbody>{closed.length ? closed.map((applicant) => {
          const requisition = requisitions.find((item) => item.id === applicant.requisitionId);
          const reason = closedReasonOf(applicant);
          return <tr key={applicant.id}>
            <td><button type="button" className="name-link" onClick={() => onSelect(applicant.id)}><span>{applicant.name.slice(0, 1)}</span>{applicant.name}</button></td>
            <td><span className={requisition ? "applicant-to-link" : "applicant-to-exception"}>{requisition?.title ?? "예외·미연결"}</span></td>
            <td>{applicant.role}</td>
            <td><span className={`closed-reason ${reason.tone}`}>{reason.label}</span></td>
            <td>{applicant.stage}</td>
            <td><span className={`screening-stage ${recruitStageOf(applicant).toLowerCase()}`}>{recruitStageLabels[recruitStageOf(applicant)]}</span></td>
            <td>{applicant.applied}</td>
            <td>{applicant.owner || "미지정"}</td>
          </tr>;
        }) : <tr><td colSpan={8} className="empty-cell">종료된 지원자가 없습니다.</td></tr>}</tbody>
      </table></div>
    </section>
  </div>;
}

function RecruiterManagement({ employees, recruiterIds, onAdd, onRemove }: { employees: Employee[]; recruiterIds: string[]; onAdd: (employeeId: string) => void; onRemove: (employeeId: string) => void }) {
  const [candidateId, setCandidateId] = useState("");
  const recruiters = employees.filter((employee) => recruiterIds.includes(employee.id));
  const candidates = employees.filter((employee) => isCurrentEmployee(employee) && !recruiterIds.includes(employee.id));
  return <div className="page-wrap module-page recruiter-page">
    <section className="module-hero"><div><p className="eyebrow">RECRUITING OWNERS</p><h1>채용담당자 관리</h1><p>회사에 등록된 재직자 중 지원자와 면접 과정을 담당할 인원을 지정합니다.</p></div></section>
    <section className="panel recruiter-manager">
      <form onSubmit={(event) => { event.preventDefault(); onAdd(candidateId); setCandidateId(""); }}><label><span>채용담당자 추가</span><select value={candidateId} onChange={(event) => setCandidateId(event.target.value)}><option value="">재직자 선택</option>{candidates.map((employee) => <option value={employee.id} key={employee.id}>{employee.name} · {employee.department}</option>)}</select></label><button type="submit" className="primary-button" disabled={!candidateId}>담당자 추가</button></form>
      <div className="recruiter-list">{recruiters.map((recruiter) => <article key={recruiter.id}><span>{recruiter.name.slice(0, 1)}</span><div><strong>{recruiter.name}</strong><small>{recruiter.department} · {recruiter.position}</small></div><em>채용담당자</em><button type="button" onClick={() => onRemove(recruiter.id)}>담당 해제</button></article>)}</div>
    </section>
  </div>;
}

function ApplicantInterviewRecorder({ applicantId }: { applicantId: string }) {
  const localNow = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [recordings, setRecordings] = useState<ApplicantInterviewRecording[]>([]);
  const [recordedAt, setRecordedAt] = useState(localNow);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [message, setMessage] = useState("");
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`/api/hr/applicant-interview-recordings?applicantId=${encodeURIComponent(applicantId)}`)
      .then(async (response) => {
        const data = await response.json() as { recordings?: ApplicantInterviewRecording[]; error?: string };
        if (!response.ok) throw new Error(data.error || "면접 녹음 기록을 불러오지 못했습니다.");
        return data.recordings ?? [];
      })
      .then((items) => { if (active) setRecordings(items); })
      .catch((error: Error) => { if (active) setMessage(error.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [applicantId]);

  useEffect(() => () => {
    if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  async function startRecording() {
    setMessage("");
    if (!consentConfirmed) { setMessage("지원자의 녹음 동의를 확인한 뒤 녹음을 시작해 주세요."); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMessage("이 브라우저에서는 음성 녹음을 지원하지 않습니다.");
      return;
    }
    try {
      const stream = await requestMicrophoneStream();
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = createAudioRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
        const nextUrl = URL.createObjectURL(blob);
        previewUrlRef.current = nextUrl;
        setAudioBlob(blob);
        setPreviewUrl(nextUrl);
        stream.getTracks().forEach((track) => track.stop());
      };
      recorder.start(500);
      setRecording(true);
    } catch (error) {
      console.error("[microphone] applicant interview recording failed", error);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      setMessage(microphoneErrorMessage(error));
    }
  }

  function stopRecording() {
    if (recorderRef.current?.state !== "inactive") recorderRef.current?.stop();
    recorderRef.current = null;
    setRecording(false);
  }

  async function saveRecording() {
    if (!audioBlob) {
      setMessage("저장할 면접 녹음을 먼저 만들어 주세요.");
      return;
    }
    setSaving(true);
    setMessage("");
    const extension = audioBlob.type.includes("mp4") ? "m4a" : "webm";
    const form = new FormData();
    form.append("applicantId", applicantId);
    form.append("recordedAt", recordedAt);
    form.append("consentConfirmed", String(consentConfirmed));
    form.append("audio", new File([audioBlob], `applicant-interview-${Date.now()}.${extension}`, { type: audioBlob.type }));
    try {
      const response = await fetch("/api/hr/applicant-interview-recordings", { method: "POST", body: form });
      const data = await response.json() as { recording?: ApplicantInterviewRecording; error?: string };
      if (!response.ok || !data.recording) throw new Error(data.error || "면접 녹음을 저장하지 못했습니다.");
      setRecordings((items) => [data.recording as ApplicantInterviewRecording, ...items]);
      setRecordedAt(localNow());
      setAudioBlob(null);
      setConsentConfirmed(false);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
      setPreviewUrl(null);
      setMessage("면접 녹음을 저장했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "면접 녹음을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return <section className="applicant-interview-recorder">
    <div className="applicant-recording-heading"><div><p className="eyebrow">INTERVIEW RECORDING</p><h3>면접 녹음</h3></div><span>{recordings.length}건</span></div>
    <label className="recording-consent"><input type="checkbox" checked={consentConfirmed} disabled={recording} onChange={(event) => setConsentConfirmed(event.target.checked)} /><span>지원자에게 면접 녹음 목적과 보관 사실을 안내하고 동의를 확인했습니다.</span></label>
    <label className="applicant-recorded-at"><span>녹음일시</span><input type="datetime-local" value={recordedAt} onChange={(event) => setRecordedAt(event.target.value)} /></label>
    <div className="applicant-recording-controls"><button type="button" className={recording ? "recording" : ""} onClick={recording ? stopRecording : startRecording}>{recording ? "■ 녹음 종료" : "● 녹음 시작"}</button>{previewUrl && <audio controls src={previewUrl}>면접 녹음 미리듣기</audio>}</div>
    {message && <p className="applicant-recording-message">{message}</p>}
    <button type="button" className="primary-button applicant-recording-save" disabled={!audioBlob || recording || saving} onClick={saveRecording}>{saving ? "저장 중…" : "면접 녹음 저장"}</button>
    <div className="applicant-recording-list">{loading ? <p>면접 녹음을 불러오는 중입니다.</p> : recordings.length ? recordings.map((item) => <article key={item.id}><div><strong>{new Date(item.recordedAt).toLocaleString("ko-KR")}</strong><small>{item.audioFileName} · 동의 {item.consentConfirmed ? "확인" : "기록 없음"}</small></div><audio controls src={item.audioUrl}>저장된 면접 녹음</audio><AudioTranscriptionControl entityType="APPLICANT_INTERVIEW" entityId={item.id} /></article>) : <p>아직 저장된 면접 녹음이 없습니다.</p>}</div>
  </section>;
}

function ApplicantDetail({ applicant, recruiters, requisitions, organizations, onClose, onSave, onDecideScreening, onSaveInterview, onSaveMemo, onSubmitOffer, onRejectInterview, onRespondOffer }: {
  applicant: Applicant;
  recruiters: Employee[];
  requisitions: RecruitmentRequisitionOption[];
  organizations: Organization[];
  onClose: () => void;
  onSave: (applicant: Applicant) => void;
  onDecideScreening: (applicantId: string, decision: "PASS" | "REJECT" | "RESET") => void;
  onSaveInterview: (applicantId: string, schedule: InterviewSchedule) => void;
  onSaveMemo: (applicantId: string, text: string) => void;
  onSubmitOffer: (applicantId: string, draft: RecruitmentOfferDraft) => void;
  onRejectInterview: (applicantId: string, note: string, attended: boolean) => void;
  onRespondOffer: (applicantId: string, offerId: string, action: "ACCEPT" | "DECLINE", input: { employeeId?: string; position?: string; jobTitle?: string; responseNote: string; startDate?: string; annualSalary?: number; probationMonths?: number; department?: string; proposedTitle?: string; employmentType?: string; declineKind?: "OFFER" | "OTHER_OFFER" }) => void;
}) {
  const [draft, setDraft] = useState({
    name: applicant.name,
    role: applicant.role,
    email: applicant.email,
    phone: applicant.phone,
    experience: applicant.experience,
    source: applicant.source,
    summary: applicant.summary,
    ownerId: applicant.ownerId,
    requisitionId: applicant.requisitionId,
  });
  const [note, setNote] = useState("");
  const [schedule, setSchedule] = useState<InterviewSchedule>(applicant.interview ?? { date: "", time: "", type: "1차 대면", interviewers: "", location: "", note: "" });
  const [interviewResult, setInterviewResult] = useState("");
  const [passModalOpen, setPassModalOpen] = useState(false);
  // 처우 제안 단계의 두 갈래. 수락은 최종 처우까지 고쳐 확정하고, 거절은 사유만 남긴다.
  const [acceptModalOpen, setAcceptModalOpen] = useState(false);
  const [declineModalOpen, setDeclineModalOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  // 거절 구분. 타사 합격은 우리가 떨어뜨린 것이 아니라 지원자 사정이라 채용단계를 따로 적는다.
  const [declineKind, setDeclineKind] = useState<"OFFER" | "OTHER_OFFER">("OFFER");
  const [finalOffer, setFinalOffer] = useState({ startDate: "", annualSalary: "", department: "", proposedTitle: "", employmentType: "일반직4.5", probationMonths: "3" });
  // 팝업을 내리면 제목줄을 절반 높이로 접는다.
  const [condensed, setCondensed] = useState(false);
  const [responseDraft, setResponseDraft] = useState({ employeeId: "", position: "", jobTitle: applicant.role, responseNote: "" });
  const [offerDraft, setOfferDraft] = useState({
    proposedTitle: applicant.role, department: organizations[0]?.name ?? "", employmentType: "일반직4.5",
    startDate: applicant.offer?.startDate ?? "", annualSalary: applicant.offer ? String(applicant.offer.annualSalary) : "",
    probationMonths: applicant.offer ? String(applicant.offer.probationMonths) : "3", notes: applicant.offer?.notes ?? "",
  });
  const ownerName = recruiters.find((recruiter) => recruiter.id === draft.ownerId)?.name ?? "담당자 미지정";
  const screening = screeningResultOf(applicant);
  const activeOffer = applicant.offer && !["REJECTED", "DECLINED", "CANCELLED"].includes(applicant.offer.status) ? applicant.offer : null;

  function submitOffer(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // 합격 판단 근거를 처우와 함께 남긴다. 금액만 남고 이유가 사라지면 결정을 설명할 수 없다.
    if (interviewResult.trim()) onSaveMemo(applicant.id, `면접 결과(합격): ${interviewResult.trim()}`);
    onSubmitOffer(applicant.id, {
      proposedTitle: offerDraft.proposedTitle.trim(), department: offerDraft.department,
      employmentType: offerDraft.employmentType, startDate: offerDraft.startDate,
      annualSalary: Number(offerDraft.annualSalary), probationMonths: Number(offerDraft.probationMonths),
      notes: offerDraft.notes.trim(),
    });
    setInterviewResult("");
    setPassModalOpen(false);
  }

  // 면접 합격. 단계와 메모를 한 번에 저장한다 — 따로 부르면 나중 호출이 앞선 단계 변경을 덮어쓴다.
  // 처우는 아직 제안하지 않은 상태이고, 아래 처우 제안 단계 박스가 이때부터 열린다.
  function passInterview() {
    if (!window.confirm(`${applicant.name} 지원자를 면접 합격으로 기록합니다. 계속할까요?`)) return;
    const text = interviewResult.trim() ? `면접 결과(합격): ${interviewResult.trim()}` : "면접 결과(합격)";
    onSave({
      ...applicant,
      stage: INTERVIEW_PASSED_STAGE,
      interviewMemos: [{ id: `IN-${Date.now()}`, text, author: ownerName, createdAt: new Date().toISOString() }, ...(applicant.interviewMemos ?? [])],
    });
    setInterviewResult("");
  }

  function rejectInterview(attended: boolean) {
    const label = attended ? "면접 후 탈락" : "면접 불참 탈락";
    if (!window.confirm(`${applicant.name} 지원자를 ${label}으로 기록합니다. 계속할까요?`)) return;
    const prefix = attended ? "면접 결과(탈락)" : "면접 불참(탈락)";
    onRejectInterview(applicant.id, interviewResult.trim() ? `${prefix}: ${interviewResult.trim()}` : prefix, attended);
    setInterviewResult("");
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const newNote: RecruitmentNote | null = note.trim() ? {
      id: `AN-${Date.now()}`,
      text: note.trim(),
      author: ownerName,
      createdAt: new Date().toISOString(),
    } : null;
    // 면접 일정도 이 저장에 같이 실린다. 예전에는 "면접 일정 저장" 버튼으로만 반영돼서, 일정을
    // 고치고 위아래의 저장 버튼을 누르면 고친 내용이 조용히 사라졌다.
    // 아직 아무것도 적지 않은 지원자에게 빈 일정을 새로 만들어 붙이지는 않는다.
    const scheduleFilled = [schedule.date, schedule.time, schedule.interviewers, schedule.location, schedule.note].some(Boolean);
    onSave({
      ...applicant,
      ...draft,
      name: draft.name.trim(),
      role: draft.role.trim(),
      email: draft.email.trim(),
      phone: draft.phone.trim(),
      owner: ownerName,
      interview: scheduleFilled || applicant.interview ? schedule : applicant.interview,
      screeningMemos: newNote ? [newNote, ...(applicant.screeningMemos ?? [])] : applicant.screeningMemos ?? [],
    });
    setNote("");
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
    <form
      className={`applicant-detail-modal applicant-edit-modal${condensed ? " condensed" : ""}`}
      onSubmit={submit}
      onMouseDown={(event) => event.stopPropagation()}
      onScroll={(event) => {
        const top = event.currentTarget.scrollTop;
        setCondensed((current) => nextCondensed(current, top));
      }}
    >
      <div className="modal-header"><div><p>APPLICANT PROFILE</p><h2>지원자 정보 확인 및 수정</h2></div><div className="modal-header-actions"><button type="submit" className="header-save-button">변경사항 저장</button><button type="button" onClick={onClose} aria-label="닫기">×</button></div></div>
      <div className="applicant-profile"><div className="profile-avatar">{draft.name.slice(0, 1) || "지"}</div><div><h2>{draft.name || "지원자"}</h2><p>{draft.role || "지원 직무 미입력"} · {draft.experience || "경력 미입력"}</p></div><StatusPill value={applicant.stage} /></div>
      <div className="applicant-edit-layout">
        <section className="applicant-edit-fields">
          <div className="detail-card-heading"><div><p className="eyebrow">APPLICANT INFORMATION</p><h3>지원 정보</h3></div></div>
          <div className="form-grid">
            <label><span>이름 *</span><input required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
            <label><span>지원 직무 *</span><input required value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })} /></label>
            <label><span>이메일 *</span><input required type="email" value={draft.email} onChange={(event) => setDraft({ ...draft, email: event.target.value })} /></label>
            <label><span>연락처</span><input value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} /></label>
            <label><span>경력</span><input value={draft.experience} onChange={(event) => setDraft({ ...draft, experience: event.target.value })} /></label>
            <label><span>채용담당자</span><select value={draft.ownerId} onChange={(event) => setDraft({ ...draft, ownerId: event.target.value })}><option value="">미지정</option>{recruiters.map((recruiter) => <option value={recruiter.id} key={recruiter.id}>{recruiter.name}</option>)}</select></label>
            <label className="wide"><span>채용요청·TO</span><select value={draft.requisitionId} onChange={(event) => setDraft({ ...draft, requisitionId: event.target.value })}><option value="">예외·미연결</option>{requisitions.filter((item) => item.status === "OPEN" || item.id === applicant.requisitionId).map((item) => <option key={item.id} value={item.id}>{item.title} · {item.role}</option>)}</select></label>
            <label className="wide"><span>지원 경로</span><select value={draft.source} onChange={(event) => setDraft({ ...draft, source: event.target.value })}><option>사람인</option><option>그룹바이</option><option>직접 등록</option><option>원티드</option><option>잡코리아</option><option>링크드인</option><option>직원 추천</option><option>기타 채용사이트</option><option>이력서 내용 추출</option></select></label>
          </div>
          <label className="form-note"><span>경력 및 이력서 요약</span><textarea value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label>
        </section>
        <div className="applicant-edit-side">
        <section className="applicant-special-notes">
          <div className="detail-card-heading"><div><p className="eyebrow">SPECIAL NOTES</p><h3>특이사항 기록</h3></div><span>{(applicant.screeningMemos ?? []).length}건</span></div>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="지원자 확인사항, 연락 내용, 추후 확인할 내용을 기록하세요." />
          <small>저장 시 {ownerName} 및 현재 작성일시가 자동 기록됩니다.</small>
          <div className="applicant-note-history">{(applicant.screeningMemos ?? []).length ? (applicant.screeningMemos ?? []).map((item) => <article key={item.id}><p>{item.text}</p><span>{item.author} · {new Date(item.createdAt).toLocaleString("ko-KR")}</span></article>) : <p className="empty-note">등록된 특이사항이 없습니다.</p>}</div>
        </section>
        <section className="applicant-screening-block">
          <div className="detail-card-heading"><div><p className="eyebrow">DOCUMENT SCREENING</p><h3>서류 심사</h3></div>
            <span className={`screening-stage ${screening.toLowerCase()}`}>{screeningLabels[screening]}</span></div>
          <p className="applicant-screening-hint">{screening === "PENDING" ? "아직 서류 합불을 처리하지 않았습니다."
            : screening === "PASSED" ? "서류 합격으로 처리되어 있습니다. 아래에서 면접을 진행하세요."
            : "서류 탈락으로 처리되어 있습니다."}</p>
          <div className="applicant-screening-actions">
            {screening !== "PASSED" && <button type="button" className="interview-action" onClick={() => onDecideScreening(applicant.id, "PASS")}>서류 합격</button>}
            {screening !== "REJECTED" && <button type="button" className="reject-action" onClick={() => onDecideScreening(applicant.id, "REJECT")}>서류 탈락</button>}
            {screening !== "PENDING" && <button type="button" onClick={() => onDecideScreening(applicant.id, "RESET")}>평가중으로 되돌리기</button>}
          </div>
        </section>
        </div>
      </div>

      {screening === "PASSED" && <section className="applicant-interview-block">
        <div className="detail-card-heading"><div><p className="eyebrow">INTERVIEW</p><h3>면접 일정과 결과</h3></div>
          {activeOffer && <StatusPill value={activeOffer.status === "ACCEPTED" ? "입사 예정" : activeOffer.status === "ONBOARDED" ? "입사 완료" : "처우 저장됨"} />}</div>
        <div className="form-grid">
          <label><span>면접일</span><input type="date" value={schedule.date} onChange={(event) => setSchedule({ ...schedule, date: event.target.value })} /></label>
          <label><span>시작 시간</span><input type="time" value={schedule.time} onChange={(event) => setSchedule({ ...schedule, time: event.target.value })} /></label>
          <label><span>면접 유형</span><select value={schedule.type} onChange={(event) => setSchedule({ ...schedule, type: event.target.value })}><option>1차 대면</option><option>1차 화상</option><option>2차 대면</option><option>컬처핏 인터뷰</option></select></label>
          <label><span>면접관</span><input value={schedule.interviewers} onChange={(event) => setSchedule({ ...schedule, interviewers: event.target.value })} placeholder="면접관 미정 가능" /></label>
          <label className="wide"><span>장소 또는 화상 링크</span><input value={schedule.location} onChange={(event) => setSchedule({ ...schedule, location: event.target.value })} /></label>
        </div>
        <div className="applicant-screening-actions">
          <button type="button" className="outline-button" onClick={() => onSaveInterview(applicant.id, schedule)}>면접 일정 저장</button>
        </div>

        <label className="form-note"><span>면접 결과</span><textarea value={interviewResult} onChange={(event) => setInterviewResult(event.target.value)} placeholder="면접에서 확인한 역량, 평가 의견, 합격·탈락 판단 근거를 기록하세요." /></label>
        <p className="applicant-screening-hint">입력한 내용은 면접 메모에 함께 저장됩니다. 합격을 누르면 아래에 처우 제안 단계가 열립니다.</p>
        <div className="applicant-screening-actions">
          <button type="button" className="reject-action" onClick={() => rejectInterview(false)}>면접 불참 탈락</button>
          <button type="button" className="reject-action" onClick={() => rejectInterview(true)}>면접 후 탈락</button>
          <button type="button" className="primary-button" disabled={OFFER_STAGES.includes(applicant.stage)} onClick={passInterview}>면접 합격</button>
        </div>
        <div className="applicant-note-history">{(applicant.interviewMemos ?? []).length ? (applicant.interviewMemos ?? []).map((item) => <article key={item.id}><p>{item.text}</p><span>{item.author} · {new Date(item.createdAt).toLocaleString("ko-KR")}</span></article>) : <p className="empty-note">등록된 면접 메모가 없습니다.</p>}</div>

        <ApplicantInterviewRecorder applicantId={applicant.id} />
      </section>}

      {/* 면접 합격 뒤의 단계. 처우를 제안하고, 지원자 회신에 따라 수락·거절로 갈린다.
          제안이 없으면 수락·거절을 누를 수 없다 — 제안하지 않은 처우를 수락할 수는 없다. */}
      {OFFER_STAGES.includes(applicant.stage) && <section className="applicant-offer-block">
        <div className="detail-card-heading"><div><p className="eyebrow">OFFER</p><h3>처우 제안 단계</h3></div>
          {applicant.offer && <StatusPill value={applicant.offer.status === "ACCEPTED" ? "입사 예정"
            : applicant.offer.status === "DECLINED" ? "제안 거절" : applicant.offer.status === "ONBOARDED" ? "입사 완료" : "제안 완료"} />}</div>

        {activeOffer ? <div className="applicant-offer-summary">
          <div><span>제안 직무</span><strong>{activeOffer.proposedTitle}</strong></div>
          <div><span>소속</span><strong>{activeOffer.department}</strong></div>
          <div><span>입사예정일</span><strong>{activeOffer.startDate}</strong></div>
          <div><span>연봉</span><strong>{activeOffer.annualSalary.toLocaleString("ko-KR")}원</strong></div>
          <p>제안한 처우입니다. 지원자 회신에 따라 아래에서 수락 또는 거절을 기록하세요.</p>
        </div> : <p className="applicant-screening-hint">아직 처우를 제안하지 않았습니다. 「처우 제안」을 눌러 입사예정일과 연봉을 입력하세요.</p>}

        {/* 제안 전에는 "처우 제안" 하나, 제안을 저장하면 그 자리가 "제안 수락"으로 바뀌고
            옆에 "제안 거절"이 함께 나타난다. 두 버튼은 모양이 같고 색만 다르다. */}
        <div className="applicant-offer-steps">
          {!activeOffer
            ? <button type="button" className="primary-button" onClick={() => setPassModalOpen(true)}>처우 제안</button>
            : <div className="applicant-offer-response-actions">
            <button type="button" className="offer-decision accept" disabled={activeOffer.status !== "APPROVED"}
              onClick={() => {
                // 기본값은 앞서 제안한 처우. 협의로 달라졌으면 이 팝업에서 고쳐 확정한다.
                if (activeOffer) setFinalOffer({
                  startDate: activeOffer.startDate, annualSalary: String(activeOffer.annualSalary),
                  department: activeOffer.department, proposedTitle: activeOffer.proposedTitle,
                  employmentType: activeOffer.employmentType, probationMonths: String(activeOffer.probationMonths),
                });
                setAcceptModalOpen(true);
              }}>제안 수락</button>
            <button type="button" className="offer-decision decline" disabled={activeOffer.status !== "APPROVED"}
              onClick={() => { setDeclineReason(""); setDeclineModalOpen(true); }}>제안 거절</button>
          </div>}
        </div>
      </section>}

      <div className="applicant-edit-footer"><div><span>지원일 {applicant.applied}</span><span>지원자 ID {applicant.id}</span></div><div><button type="button" onClick={onClose}>닫기</button><button type="submit" className="primary-button">변경사항 저장</button></div></div>
    </form>
    {acceptModalOpen && activeOffer && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAcceptModalOpen(false); }}>
      <form className="employee-modal offer-response-modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => {
        event.preventDefault();
        onRespondOffer(applicant.id, activeOffer.id, "ACCEPT", {
          employeeId: responseDraft.employeeId.trim(), position: responseDraft.position.trim(),
          jobTitle: responseDraft.jobTitle.trim(), responseNote: responseDraft.responseNote,
          startDate: finalOffer.startDate, annualSalary: Number(finalOffer.annualSalary),
          probationMonths: Number(finalOffer.probationMonths), department: finalOffer.department.trim(),
          proposedTitle: finalOffer.proposedTitle.trim(), employmentType: finalOffer.employmentType,
        });
        setAcceptModalOpen(false);
      }}>
        <div className="modal-header"><div><p>OFFER ACCEPTED</p><h2>{applicant.name} 최종 처우 확정</h2></div><button type="button" aria-label="닫기" onClick={() => setAcceptModalOpen(false)}>×</button></div>
        <p className="optional-form-notice">기본값은 앞서 제안한 처우입니다. 협의로 달라졌다면 고친 뒤 확정하세요. 확정하면 입사 예정자로 바뀝니다.</p>
        <div className="form-grid">
          <label><span>입사예정일 *</span><input required type="date" value={finalOffer.startDate} onChange={(event) => setFinalOffer({ ...finalOffer, startDate: event.target.value })} /></label>
          <label><span>연봉 *</span><WonInput ariaLabel="최종 연봉" value={Number(finalOffer.annualSalary) || 0} onValueChange={(value) => setFinalOffer({ ...finalOffer, annualSalary: String(value) })} /></label>
          <label><span>소속 *</span><select value={finalOffer.department} onChange={(event) => setFinalOffer({ ...finalOffer, department: event.target.value })}>{organizations.map((organization) => <option key={organization.id}>{organization.name}</option>)}</select></label>
          <label><span>제안 직무 *</span><input required value={finalOffer.proposedTitle} onChange={(event) => setFinalOffer({ ...finalOffer, proposedTitle: event.target.value })} /></label>
          <label><span>고용형태</span><select value={finalOffer.employmentType} onChange={(event) => setFinalOffer({ ...finalOffer, employmentType: event.target.value })}><option>일반직4.5</option><option>일반직</option><option>계약직</option><option>인턴</option></select></label>
          <label><span>수습(개월)</span><input type="number" min="0" max="12" value={finalOffer.probationMonths} onChange={(event) => setFinalOffer({ ...finalOffer, probationMonths: event.target.value })} /></label>
          <label><span>신규 사번 *</span><input required value={responseDraft.employeeId} onChange={(event) => setResponseDraft({ ...responseDraft, employeeId: event.target.value })} placeholder="예: gd.hong" /></label>
          <label><span>입사 직위 *</span><select required value={responseDraft.position} onChange={(event) => setResponseDraft({ ...responseDraft, position: event.target.value })}><option value="">직위 선택</option>{companyRanks.map((rank) => <option key={rank}>{rank}</option>)}</select></label>
          <label><span>직책 *</span><input required value={responseDraft.jobTitle} onChange={(event) => setResponseDraft({ ...responseDraft, jobTitle: event.target.value })} /></label>
          <label className="wide"><span>회신 메모</span><textarea value={responseDraft.responseNote} onChange={(event) => setResponseDraft({ ...responseDraft, responseNote: event.target.value })} placeholder="수락일, 협의사항을 기록하세요." /></label>
        </div>
        <div className="modal-actions"><button type="button" onClick={() => setAcceptModalOpen(false)}>취소</button><button type="submit" className="primary-button">확정</button></div>
      </form>
    </div>}

    {declineModalOpen && activeOffer && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDeclineModalOpen(false); }}>
      <form className="employee-modal offer-response-modal" onMouseDown={(event) => event.stopPropagation()} onSubmit={(event) => {
        event.preventDefault();
        onRespondOffer(applicant.id, activeOffer.id, "DECLINE", { responseNote: declineReason.trim(), declineKind });
        setDeclineModalOpen(false);
      }}>
        <div className="modal-header"><div><p>OFFER DECLINED</p><h2>{applicant.name} 제안 거절 기록</h2></div><button type="button" aria-label="닫기" onClick={() => setDeclineModalOpen(false)}>×</button></div>
        <p className="optional-form-notice">{declineKind === "OTHER_OFFER"
          ? "확정하면 채용단계가 「타사 합격」으로 바뀝니다. 우리가 떨어뜨린 것이 아니라 지원자가 다른 회사로 간 경우입니다."
          : "확정하면 제안 거절자로 바뀝니다. 사유는 채용 이력으로 남습니다."}</p>
        <div className="form-grid">
          <label className="wide"><span>거절 구분 *</span><select value={declineKind} onChange={(event) => setDeclineKind(event.target.value as "OFFER" | "OTHER_OFFER")}>
            <option value="OFFER">제안 거절 (처우 조건·개인 사정 등)</option>
            <option value="OTHER_OFFER">타사 합격 (다른 회사 입사 확정)</option>
          </select></label>
          <label className="wide"><span>거절 사유 *</span><textarea required value={declineReason} onChange={(event) => setDeclineReason(event.target.value)} placeholder="처우 조건, 타사 입사 확정 등 지원자가 밝힌 사유를 기록하세요." /></label>
        </div>
        <div className="modal-actions"><button type="button" onClick={() => setDeclineModalOpen(false)}>취소</button><button type="submit" className="danger-confirm">확정</button></div>
      </form>
    </div>}

    {passModalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      // 이 팝업은 지원자 상세 팝업의 배경 안쪽에 그려진다. 전파를 끊지 않으면 처우 입력란을
      // 클릭한 mousedown 이 바깥 배경까지 올라가 상세 팝업이 통째로 닫혀 버린다.
      event.stopPropagation();
      if (event.target === event.currentTarget) setPassModalOpen(false);
    }}>
      <form className="employee-modal interview-pass-modal" onSubmit={submitOffer}>
        <div className="modal-header"><div><p>OFFER DETAILS</p><h2>{applicant.name} 처우 제안 입력</h2></div><button type="button" aria-label="닫기" onClick={() => setPassModalOpen(false)}>×</button></div>
        <div className="form-grid">
          <label><span>제안 직무 *</span><input required value={offerDraft.proposedTitle} onChange={(event) => setOfferDraft({ ...offerDraft, proposedTitle: event.target.value })} /></label>
          <label><span>소속 조직 *</span><select required value={offerDraft.department} onChange={(event) => setOfferDraft({ ...offerDraft, department: event.target.value })}>{organizations.map((organization) => <option key={organization.id}>{organization.name}</option>)}</select></label>
          <label><span>고용형태 *</span><select value={offerDraft.employmentType} onChange={(event) => setOfferDraft({ ...offerDraft, employmentType: event.target.value })}><option>일반직4.5</option><option>일반직</option><option>계약직</option><option>인턴</option></select></label>
          <label><span>입사예정일 *</span><input required type="date" value={offerDraft.startDate} onChange={(event) => setOfferDraft({ ...offerDraft, startDate: event.target.value })} /></label>
          <label><span>연봉 *</span><input required type="number" min="1" value={offerDraft.annualSalary} onChange={(event) => setOfferDraft({ ...offerDraft, annualSalary: event.target.value })} /></label>
          <label><span>수습기간(개월) *</span><input required type="number" min="0" max="12" value={offerDraft.probationMonths} onChange={(event) => setOfferDraft({ ...offerDraft, probationMonths: event.target.value })} /></label>
          <label className="wide"><span>처우 협의 메모</span><textarea value={offerDraft.notes} onChange={(event) => setOfferDraft({ ...offerDraft, notes: event.target.value })} placeholder="처우 협의 조건과 지원자에게 안내할 사항을 기록하세요." /></label>
        </div>
        {interviewResult.trim() && <p className="applicant-screening-hint">면접 결과도 함께 저장됩니다: {interviewResult.trim()}</p>}
        <div className="modal-actions">
          <button type="button" onClick={() => setPassModalOpen(false)}>취소</button>
          <button type="submit" className="primary-button">처우 제안 저장</button>
        </div>
      </form>
    </div>}
  </div>;
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
      ? "현재보다 높은 직위으로 변경합니다."
      : "현재보다 낮은 직위으로 변경하며 정당한 사유가 반드시 필요합니다.";

  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><form className="employee-modal personnel-modal" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p>PERSONNEL ACTION</p><h2>인사 발령 등록</h2></div><button type="button" onClick={onClose}>×</button></div><div className="candidate-banner"><span>{employee.name.slice(0, 1)}</span><div><strong>{employee.name}</strong><small>{employee.department} · {employee.position}</small></div><em>{employee.id}</em></div><div className="form-grid"><label><span>시행일 *</span><input required name="effectiveDate" type="date" defaultValue="2026-09-01" /></label><label><span>발령 구분 *</span><select required name="actionType" value={actionType} onChange={(event) => setActionType(event.target.value as PersonnelActionType)}><option>인사이동(전보)</option><option>승진</option><option>강등</option></select></label><div className="action-type-help wide"><strong>{actionType}</strong><span>{actionHelp}</span></div>{actionType === "인사이동(전보)" ? <label className="wide"><span>이동할 부서 *</span><select required name="targetDepartment" defaultValue=""><option value="" disabled>부서 선택</option>{departments.filter((department) => department !== employee.department).map((department) => <option key={department}>{department}</option>)}</select><input type="hidden" name="targetPosition" value={employee.position} /></label> : <label className="wide"><span>변경 직위 *</span><select required name="targetPosition" defaultValue=""><option value="" disabled>직위 선택</option>{availableRanks.map((rank) => <option key={rank}>{rank}</option>)}</select><input type="hidden" name="targetDepartment" value={employee.department} /></label>}</div><label className={`form-note ${actionType === "강등" ? "personnel-note-required" : ""}`}><span>{actionType === "강등" ? "강등 사유 *" : "발령 사유 및 내용"}</span><textarea required={actionType === "강등"} name="note" placeholder={actionType === "강등" ? "강등의 정당한 사유와 근거를 구체적으로 입력하세요." : "발령 배경이나 전달사항을 입력하세요."}></textarea>{actionType === "강등" && <small>강등은 정당한 사유와 객관적인 근거가 확인되어야 등록할 수 있습니다.</small>}</label><div className="modal-actions"><button type="button" onClick={onClose}>취소</button><button type="submit" className="primary-button">인사 발령 등록</button></div></form></div>;
}

type OnboardingTask = { id: string; employee_id: string; task_group: string; title: string; due_date: string; status: string };
type LifecycleRetirementRequest = { id: string; employee_id: string; retirement_date: string; reason: string; status: string; checklist_json: string; completed_tasks: number; total_tasks: number };
type LifecycleOnboardingCandidate = RecruitmentOffer & { name: string; email: string; phone: string };
/* 팝업 제목줄은 내려가면 92px -> 46px 로 접힌다. 그런데 접히는 순간 위쪽 내용이 46px 줄어들어
   브라우저의 스크롤 앵커링이 그만큼 scrollTop 을 되돌린다. 기준선이 하나면 그 되돌림이 다시
   기준을 넘어 펼침 -> 접힘을 반복하며 깜빡였다. 접을 때와 펼 때의 기준을 46px 보다 넓게
   벌려(56px / 8px) 되먹임이 기준을 다시 넘지 못하게 한다. CSS 의 overflow-anchor: none 과 한 쌍이다. */
function nextCondensed(current: boolean, scrollTop: number) {
  return current ? scrollTop > 8 : scrollTop > 56;
}

const safeJsonArray = (value: string) => { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; } };

function LifecycleManagementView() {
  const [tasks, setTasks] = useState<OnboardingTask[]>([]);
  const [retirementTasks, setRetirementTasks] = useState<OnboardingTask[]>([]);
  const [retirements, setRetirements] = useState<LifecycleRetirementRequest[]>([]);
  const [onboardingCandidates, setOnboardingCandidates] = useState<LifecycleOnboardingCandidate[]>([]);
  const [editingOnboarding, setEditingOnboarding] = useState<LifecycleOnboardingCandidate | null>(null);
  const [people, setPeople] = useState<Record<string, { name: string; department: string; joinDate: string; status: string }>>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  // 퇴직 절차는 체크리스트 10개에 정산까지 붙어 목록 안에서 펼치면 다른 사람 카드가 멀리 밀려났다.
  // 한 번에 한 명만 모달로 띄운다.
  const [openRetirementId, setOpenRetirementId] = useState("");
  async function load() {
    setLoading(true);
    try {
      const [operationsResponse, employeeResponse, recruitmentResponse] = await Promise.all([fetch("/api/hr/operations"), fetch("/api/hr/employee-records"), fetch("/api/hr/recruitment")]);
      const operations = await operationsResponse.json() as { lifecycleTasks?: OnboardingTask[]; retirementRequests?: LifecycleRetirementRequest[]; error?: string };
      const employeesPayload = await employeeResponse.json() as { records?: Array<{ employeeId: string; name: string; department: string; joinDate: string; status: string }>; error?: string };
      const recruitmentPayload = await recruitmentResponse.json() as { applicants?: Applicant[]; offers?: RecruitmentOffer[]; error?: string };
      if (!operationsResponse.ok) throw new Error(operations.error || "온보딩 업무를 불러오지 못했습니다.");
      if (!employeeResponse.ok) throw new Error(employeesPayload.error || "입사예정자 정보를 불러오지 못했습니다.");
      if (!recruitmentResponse.ok) throw new Error(recruitmentPayload.error || "입사예정자 제안 정보를 불러오지 못했습니다.");
      setTasks((operations.lifecycleTasks ?? []).filter((task) => String((task as OnboardingTask & { lifecycle_type?: string }).lifecycle_type ?? "ONBOARDING") === "ONBOARDING"));
      setRetirementTasks((operations.lifecycleTasks ?? []).filter((task) => String((task as OnboardingTask & { lifecycle_type?: string }).lifecycle_type ?? "") === "RETIREMENT"));
      setRetirements((operations.retirementRequests ?? []).filter((request) => ["IN_PROGRESS", "READY", "EFFECTIVE", "COMPLETED"].includes(request.status)).sort((a, b) => b.retirement_date.localeCompare(a.retirement_date)));
      setPeople(Object.fromEntries((employeesPayload.records ?? []).map((employee) => [employee.employeeId, employee])));
      const applicantsById = new Map((recruitmentPayload.applicants ?? []).map((applicant) => [applicant.id, applicant]));
      setOnboardingCandidates((recruitmentPayload.offers ?? []).filter((offer) => ["ACCEPTED", "ONBOARDED"].includes(offer.status)).map((offer) => {
        const applicant = applicantsById.get(offer.applicantId);
        return { ...offer, name: applicant?.name ?? offer.applicantId, email: applicant?.email ?? "", phone: applicant?.phone ?? "" };
      }).sort((a, b) => a.status === b.status ? a.startDate.localeCompare(b.startDate) : a.status === "ACCEPTED" ? -1 : 1));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "온보딩 현황을 불러오지 못했습니다.");
    } finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);
  async function toggle(task: OnboardingTask) {
    const response = await fetch("/api/hr/operations", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resource: "lifecycleTask", id: task.id, status: task.status === "DONE" ? "OPEN" : "DONE" }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) return setMessage(payload.error || "온보딩 업무를 변경하지 못했습니다.");
    setMessage("온보딩 업무를 저장했습니다. 모든 업무가 완료되고 입사일이 도래하면 재직으로 전환됩니다.");
    await load();
  }
  async function toggleRetirement(request: LifecycleRetirementRequest, logicalId: string) {
    const completed = safeJsonArray(request.checklist_json);
    const next = completed.includes(logicalId) ? completed.filter((id) => id !== logicalId) : [...completed, logicalId];
    const response = await fetch("/api/hr/operations", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resource: "retirementChecklist", id: request.id, completedTaskIds: next }),
    });
    const payload = await response.json() as { error?: string; notice?: string };
    if (!response.ok) return setMessage(payload.error || "퇴직 체크리스트를 변경하지 못했습니다.");
    setMessage(payload.notice || "퇴직 후속 절차를 저장했습니다. 퇴직일이 지난 인원은 절차 완료 여부와 관계없이 퇴직자로 유지됩니다.");
    await load();
  }
  async function updateOnboarding(resource: "onboardingUpdate" | "onboardingComplete" | "onboardingCancel", id: string, input: Record<string, unknown> = {}) {
    const response = await fetch("/api/hr/recruitment", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resource, id, ...input }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) {
      setMessage(payload.error || "입사 예정자 정보를 변경하지 못했습니다.");
      return false;
    }
    setMessage(resource === "onboardingComplete" ? "입사 완료 처리했습니다. 인사기록카드에 재직자로 반영되었습니다." : resource === "onboardingCancel" ? "입사를 취소하고 취소 사유를 지원자 특이사항에 기록했습니다." : "입사 예정일과 처우 정보를 수정했습니다.");
    setEditingOnboarding(null);
    await load();
    return true;
  }
  const pendingOnboardingCount = onboardingCandidates.filter((candidate) => candidate.status === "ACCEPTED").length;
  const openRetirement = retirements.find((item) => item.id === openRetirementId) ?? null;
  return (
    <div className="page-wrap module-page lifecycle-page">
      <section className="module-hero">
        <div>
          <p className="eyebrow">EMPLOYEE LIFECYCLE</p>
          <h1>입·퇴사 관리</h1>
          <p>입사 전 준비와 퇴직 효력 발생 이후의 정산·회수 절차를 한곳에서 관리합니다.</p>
        </div>
      </section>
      {message && <div className="finance-control-message" role="status">{message}</div>}
      <section className="metric-grid module-metrics">
        <div className="compact-metric"><p>입사예정자</p><h2>{pendingOnboardingCount}명</h2><small>제안 수락·입사 대기 기준</small></div>
        <div className="compact-metric"><p>퇴직자·예정자</p><h2>{retirements.length}명</h2><small>승인 완료 요청 기준</small></div>
        <div className="compact-metric"><p>퇴직 효력 발생</p><h2>{retirements.filter((item) => ["EFFECTIVE", "COMPLETED"].includes(item.status)).length}명</h2><small>조직·재직 명부에서 제외</small></div>
        <div className="compact-metric"><p>후속절차 미완료</p><h2>{retirements.filter((item) => item.status !== "COMPLETED").length}명</h2><small>정산·회수 계속 관리</small></div>
      </section>
      <div className="lifecycle-board">
        <section className="lifecycle-column" aria-labelledby="onboarding-heading">
          <div className="lifecycle-section-heading">
            <div><p>ONBOARDING</p><h2 id="onboarding-heading">입사 관리</h2></div>
            <strong>{onboardingCandidates.length}명</strong>
          </div>
          <div className="panel lifecycle-onboarding-table-wrap">
            <table className="lifecycle-onboarding-table">
              <thead><tr><th>입사 예정자</th><th>입사예정일</th><th>파트·직무</th><th>진행 상태</th><th>관리</th></tr></thead>
              <tbody>
                {loading && <tr><td colSpan={5} className="empty-cell">입사 예정자 정보를 확인하고 있습니다…</td></tr>}
                {!loading && onboardingCandidates.map((candidate) => {
                  const candidateTasks = tasks.filter((task) => task.employee_id === candidate.employeeId);
                  const done = candidateTasks.filter((task) => task.status === "DONE").length;
                  const completed = candidate.status === "ONBOARDED";
                  return <tr key={candidate.id} className={completed ? "onboarding-completed-row" : ""}>
                    <td><strong>{candidate.name}</strong><small>{candidate.employeeId}</small></td>
                    <td>{candidate.startDate}</td>
                    <td><strong>{candidate.department}</strong><small>{candidate.proposedTitle} · {candidate.jobTitle}</small></td>
                    <td>{completed ? <StatusPill value="입사 완료" /> : <span className="onboarding-progress">준비 업무 {done}/{candidateTasks.length}</span>}</td>
                    <td><div className="onboarding-row-actions"><button type="button" className={`onboarding-complete-button${completed ? " completed" : ""}`} disabled={completed} onClick={() => void updateOnboarding("onboardingComplete", candidate.id)}>{completed ? "입사 완료" : "입사 완료"}</button><button type="button" className="onboarding-edit-button" disabled={completed} onClick={() => setEditingOnboarding(candidate)}>입사 정보 수정</button></div></td>
                  </tr>;
                })}
                {!loading && !onboardingCandidates.length && <tr><td colSpan={5} className="empty-cell">현재 관리 중인 입사예정자가 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
        <section className="lifecycle-column" aria-labelledby="offboarding-heading">
          <div className="lifecycle-section-heading">
            <div><p>OFFBOARDING</p><h2 id="offboarding-heading">퇴직자 관리</h2></div>
            <strong>{retirements.length}명</strong>
          </div>
          <div className="lifecycle-card-list">
            {retirements.map((request) => {
              const person = people[request.employee_id];
              const items = retirementTasks.filter((task) => task.id.startsWith(`${request.id}:`));
              const completed = safeJsonArray(request.checklist_json);
              const effective = ["EFFECTIVE", "COMPLETED"].includes(request.status);
              return (
                <article className={`panel lifecycle-person retirement-lifecycle-person${effective ? " effective" : ""}`} key={request.id}>
                  <button className="lifecycle-card-toggle" type="button" onClick={() => setOpenRetirementId(request.id)}>
                    <div className="lifecycle-person-summary">
                      <p>{request.status === "COMPLETED" ? "OFFBOARDING COMPLETE" : effective ? "RETIRED · FOLLOW-UP OPEN" : "RETIREMENT SCHEDULED"}</p>
                      <h2>{person?.name ?? request.employee_id}</h2>
                      <span>{person?.department ?? "소속 미지정"} · 퇴직일 {request.retirement_date} · {request.reason}</span>
                    </div>
                    <div className="lifecycle-card-state">
                      <StatusPill value={request.status === "COMPLETED" ? "퇴직 절차 완료" : effective ? "퇴직 · 후속절차 진행" : "퇴직 예정"} />
                      <small>{completed.length}/{items.length} 완료</small>
                      <span aria-hidden="true">›</span>
                    </div>
                  </button>
                </article>
              );
            })}
            {!loading && !retirements.length && <div className="panel finance-empty">승인 완료된 퇴직 요청이 없습니다.</div>}
          </div>
        </section>
      </div>
      {editingOnboarding && <OnboardingEditModal candidate={editingOnboarding} onClose={() => setEditingOnboarding(null)} onSave={(draft) => updateOnboarding("onboardingUpdate", editingOnboarding.id, draft)} onCancel={(cancellationReason) => updateOnboarding("onboardingCancel", editingOnboarding.id, { cancellationReason })} />}
      {openRetirement && <RetirementProcessModal
        request={openRetirement}
        person={people[openRetirement.employee_id]}
        tasks={retirementTasks.filter((task) => task.id.startsWith(`${openRetirement.id}:`))}
        onToggle={(logicalId) => void toggleRetirement(openRetirement, logicalId)}
        onClose={() => setOpenRetirementId("")}
      />}
    </div>
  );
}

function RetirementProcessModal({ request, person, tasks, onToggle, onClose }: {
  request: LifecycleRetirementRequest;
  person?: { name: string; department: string; joinDate: string; status: string };
  tasks: OnboardingTask[];
  onToggle: (logicalId: string) => void;
  onClose: () => void;
}) {
  const completed = safeJsonArray(request.checklist_json);
  const effective = ["EFFECTIVE", "COMPLETED"].includes(request.status);
  const locked = request.status === "COMPLETED";
  // 내려가면 제목줄을 절반 높이로 접는다. 지원자·급여 팝업과 같은 방식이다.
  const [condensed, setCondensed] = useState(false);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section
      className={`employee-modal retirement-process-modal${condensed ? " condensed" : ""}`}
      role="dialog"
      aria-modal="true"
      aria-label={`${person?.name ?? request.employee_id} 퇴직 절차`}
      onScroll={(event) => {
        const top = event.currentTarget.scrollTop;
        setCondensed((current) => nextCondensed(current, top));
      }}
    >
      <div className="modal-header">
        <div><p>OFFBOARDING</p><h2>{person?.name ?? request.employee_id} 퇴직 절차</h2></div>
        <button type="button" aria-label="닫기" onClick={onClose}>×</button>
      </div>
      <div className="retirement-modal-summary">
        <div><span>소속</span><strong>{person?.department ?? "소속 미지정"}</strong></div>
        <div><span>퇴직일</span><strong>{request.retirement_date}</strong></div>
        <div><span>사유</span><strong>{request.reason || "미입력"}</strong></div>
        <div><span>진행</span><strong>{completed.length}/{tasks.length} 완료</strong></div>
      </div>
      <div className="retirement-modal-body">
        <div className="retirement-modal-checklist">
          {tasks.map((task) => {
            const logicalId = task.id.slice(request.id.length + 1);
            const checked = completed.includes(logicalId);
            return <label className={checked ? "checked" : ""} key={task.id}>
              <input disabled={locked} type="checkbox" checked={checked} onChange={() => onToggle(logicalId)} />
              <span>✓</span><p><strong>{task.title}</strong><small>{task.task_group} · 기준일 {task.due_date}</small></p>
            </label>;
          })}
          {!tasks.length && <p className="retirement-modal-empty">등록된 퇴직 절차 항목이 없습니다.</p>}
        </div>
        {locked
          ? <p className="retirement-modal-empty">퇴직 절차가 완료되어 정산 내용을 수정할 수 없습니다.</p>
          : <RetirementSettlementPanel requestId={request.id} />}
      </div>
      <div className="modal-actions">
        <StatusPill value={request.status === "COMPLETED" ? "퇴직 절차 완료" : effective ? "퇴직 · 후속절차 진행" : "퇴직 예정"} />
        <button type="button" onClick={onClose}>닫기</button>
      </div>
    </section>
  </div>;
}

function OnboardingEditModal({ candidate, onClose, onSave, onCancel }: {
  candidate: LifecycleOnboardingCandidate;
  onClose: () => void;
  onSave: (draft: Record<string, unknown>) => Promise<boolean>;
  onCancel: (reason: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState({
    employeeId: candidate.employeeId, startDate: candidate.startDate, department: candidate.department,
    proposedTitle: candidate.proposedTitle, position: candidate.position, jobTitle: candidate.jobTitle,
    employmentType: candidate.employmentType, annualSalary: String(candidate.annualSalary),
    probationMonths: String(candidate.probationMonths), responseNote: candidate.responseNote,
  });
  const [cancellationReason, setCancellationReason] = useState("");
  const [saving, setSaving] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    await onSave({ ...draft, annualSalary: Number(draft.annualSalary), probationMonths: Number(draft.probationMonths) });
    setSaving(false);
  }
  async function cancelOnboarding() {
    setSaving(true);
    await onCancel(cancellationReason.trim());
    setSaving(false);
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><form className="employee-modal onboarding-edit-modal" onSubmit={submit} onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p>ONBOARDING DETAILS</p><h2>{candidate.name} 입사 정보 수정</h2></div><button type="button" onClick={onClose}>×</button></div><div className="candidate-banner"><span>{candidate.name.slice(0, 1)}</span><div><strong>{candidate.name}</strong><small>{candidate.email || "이메일 미등록"} · {candidate.phone || "연락처 미등록"}</small></div><em>{candidate.employeeId}</em></div><div className="onboarding-edit-grid"><label><span>신규 사번 *</span><input required value={draft.employeeId} onChange={(event) => setDraft({ ...draft, employeeId: event.target.value })} /></label><label><span>입사예정일 *</span><input required type="date" value={draft.startDate} onChange={(event) => setDraft({ ...draft, startDate: event.target.value })} /></label><label><span>소속 파트 *</span><select required value={draft.department} onChange={(event) => setDraft({ ...draft, department: event.target.value })}>{Array.from(new Set([draft.department, ...companyOrganizations.map((item) => item.name)])).map((name) => <option key={name}>{name}</option>)}</select></label><label><span>제안 직무 *</span><input required value={draft.proposedTitle} onChange={(event) => setDraft({ ...draft, proposedTitle: event.target.value })} /></label><label><span>직위 *</span><input required value={draft.position} onChange={(event) => setDraft({ ...draft, position: event.target.value })} /></label><label><span>직책 *</span><input required value={draft.jobTitle} onChange={(event) => setDraft({ ...draft, jobTitle: event.target.value })} /></label><label><span>고용형태 *</span><select value={draft.employmentType} onChange={(event) => setDraft({ ...draft, employmentType: event.target.value })}><option>일반직4.5</option><option>일반직</option><option>계약직</option><option>인턴</option></select></label><label><span>연봉 *</span><input required type="number" min="1" value={draft.annualSalary} onChange={(event) => setDraft({ ...draft, annualSalary: event.target.value })} /></label><label><span>수습기간(개월) *</span><input required type="number" min="0" max="12" value={draft.probationMonths} onChange={(event) => setDraft({ ...draft, probationMonths: event.target.value })} /></label><label className="wide"><span>처우·회신 메모</span><textarea value={draft.responseNote} onChange={(event) => setDraft({ ...draft, responseNote: event.target.value })} placeholder="처우 협의 내용과 입사 준비 참고사항을 기록하세요." /></label></div><section className="onboarding-cancel-section"><div><strong>입사가 이루어지지 않는 경우</strong><span>취소 사유는 지원자 관리의 특이사항 기록에 영구 보관됩니다.</span></div><textarea value={cancellationReason} onChange={(event) => setCancellationReason(event.target.value)} placeholder="입사 취소 사유를 입력하세요." /><button type="button" disabled={saving || !cancellationReason.trim()} onClick={() => void cancelOnboarding()}>입사 취소</button></section><div className="modal-actions"><button type="button" onClick={onClose}>닫기</button><button type="submit" className="primary-button" disabled={saving}>{saving ? "저장 중…" : "입사 정보 저장"}</button></div></form></div>;
}

type SeveranceEstimate = {
  requestId: string; period: string; severance: number; tenureDays: number; appliedDailyWage: number;
  averageDailyWage: number; ordinaryDailyWage: number; basis: string; months: string[];
  usedLeaveUnits: number; payrollMonthReady: boolean; reason: string; eligible: boolean;
  limitations: string[];
  averageSeverance: number;
  ordinarySeverance: number;
  recordedSeverance: number;
  recordedLeavePay: number;
  leaveDailyWage: number;
  workingTimeRule: { label: string; monthlyHours: number; dailyHours: number };
  /** 산정에 쓴 급여월 중 아직 확정되지 않은 달. 인센티브가 안 정해진 달이 여기 들어온다. */
  provisionalMonths: string[];
  averageWageTotal: number;
  averageWageDays: number;
};

function RetirementSettlementPanel({ requestId }: { requestId: string }) {
  const [draft, setDraft] = useState({ finalSalary: "0", retirementPay: "0", leaveDays: "0", leavePay: "0", deductions: "0", payrollConfirmed: false, insuranceConfirmed: false, accessRevoked: false, assetsReturned: false, handoverConfirmed: false });
  const [estimate, setEstimate] = useState<SeveranceEstimate | null>(null);
  const [status, setStatus] = useState("DRAFT");
  const [message, setMessage] = useState("");
  // 아직 확정되지 않은 급여월에 인센티브가 이만큼 잡힐 것 같다는 가정. 저장하지 않고 화면에서만 쓴다.
  const [assumedIncentive, setAssumedIncentive] = useState("0");
  useEffect(() => {
    fetch("/api/hr/operations?severance=1").then(async (response) => {
      const payload = await response.json() as { retirementSettlements?: Array<Record<string, unknown>>; severanceEstimates?: SeveranceEstimate[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "퇴직 정산을 불러오지 못했습니다.");
      const computed = (payload.severanceEstimates ?? []).find((row) => row.requestId === requestId) ?? null;
      setEstimate(computed);
      const item = (payload.retirementSettlements ?? []).find((row) => row.request_id === requestId);
      if (!item) return;
      setDraft({
        finalSalary: String(item.final_salary ?? 0),
        // 추정액을 자동으로 넣지 않는다. 산식이 제외기간을 반영하지 못하므로 사람이 보고 넣어야 한다.
        retirementPay: String(item.retirement_pay ?? 0),
        leaveDays: String(item.leave_days ?? 0), leavePay: String(item.unused_leave_pay ?? 0),
        deductions: String(item.deductions ?? 0),
        payrollConfirmed: Boolean(item.payroll_confirmed), insuranceConfirmed: Boolean(item.insurance_confirmed),
        accessRevoked: Boolean(item.access_revoked), assetsReturned: Boolean(item.assets_returned),
        handoverConfirmed: Boolean(item.handover_confirmed),
      });
      setStatus(String(item.status ?? "DRAFT"));
    }).catch((error: Error) => setMessage(error.message));
  }, [requestId]);
  async function save() {
    const response = await fetch("/api/hr/operations", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource: "retirementSettlement", id: requestId, ...draft, finalSalary: Number(draft.finalSalary), retirementPay: Number(draft.retirementPay), leaveDays: Number(draft.leaveDays), unusedLeavePay: Number(draft.leavePay), deductions: Number(draft.deductions) }) });
    const payload = await response.json() as { item?: Record<string, unknown>; error?: string };
    if (!response.ok) return setMessage(payload.error || "퇴직 정산을 저장하지 못했습니다.");
    const nextStatus = String(payload.item?.status ?? "DRAFT");
    setStatus(nextStatus);
    setMessage(nextStatus === "READY" ? "정산과 필수 통제가 완료되어 퇴직 완료 처리가 가능합니다." : "정산 초안을 저장했습니다. 필수 확인 항목을 모두 완료해 주세요.");
  }
  // 산정한 퇴직금과 공제를 퇴사월 임금안에 넣는다. 작성 중인 임금안이 있으면 묻지 않고 덮어쓰고,
  // 임금안이 아직 없으면 만들라고 알린다.
  //
  // 잔여 연차가 음수면 그만큼 되돌려 받아야 하므로 1일 통상임금을 곱해 공제액을 만든다.
  // 사유는 임금계산 결과의 "공제 사유" 칸에 그대로 남는다.
  // overrideSeverance 가 오면 그 금액을 퇴직금으로 반영한다. 예상 인센티브로 계산한 값을
  // 퇴직금 칸을 거치지 않고 바로 넣을 때 쓴다. 오지 않으면 지금까지처럼 퇴직금 칸 → 추정액 순.
  async function applyToPayroll(estimate: SeveranceEstimate, overrideSeverance?: number) {
    const manualSeverance = Math.max(0, Math.round(Number(draft.retirementPay) || 0));
    const enteredLeaveDays = Number(draft.leaveDays) || 0;
    const negativeLeaveDays = enteredLeaveDays < 0 ? Math.abs(enteredLeaveDays) : 0;
    // 연차수당 칸의 값을 그대로 쓴다. 음수면 되돌려 받을 돈이라 공제로, 양수면 임금안의
    // 연차수당 칸으로 간다. 칸을 손으로 고쳤으면 고친 값이 반영된다.
    const settledLeavePay = Math.round(Number(draft.leavePay) || 0);
    const leaveDeduction = settledLeavePay < 0 ? Math.abs(settledLeavePay) : 0;
    const annualLeave = settledLeavePay > 0 ? settledLeavePay : 0;
    const manualDeduction = Math.max(0, Number(draft.deductions) || 0);
    const deduction = leaveDeduction + manualDeduction;
    const deductionNote = [
      leaveDeduction ? (negativeLeaveDays ? `마이너스 연월차 공제 ${negativeLeaveDays}일` : "마이너스 연월차 공제") : "",
      manualDeduction ? "퇴직 정산 공제" : "",
    ].filter(Boolean).join(" · ");

    const response = await fetch("/api/hr/operations", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      // 퇴직금 칸에 적어 둔 값이 우선이다. 사람이 세무 검토를 거쳐 확정한 금액이기 때문이다.
      // 예전에는 무조건 추정액을 보내서, 칸에 직접 넣은 금액이 조용히 추정액으로 바뀌었다.
      // 칸이 비어 있으면(0) 그때만 추정액을 쓰고, 퇴직금 대상이 아니면 0 으로 둔다.
      body: JSON.stringify({ resource: "severanceToPayroll", id: requestId,
        amount: overrideSeverance ?? (manualSeverance || (estimate.eligible ? estimate.severance : 0)),
        annualLeave, deduction, deductionNote }),
    });
    const payload = await response.json() as { error?: string; period?: string; previous?: number; amount?: number; payrollMonthMissing?: boolean; leaveDate?: string | null; leaveDateChanged?: boolean };
    if (!response.ok) {
      if (payload.payrollMonthMissing) {
        window.alert("이번달 급여 계산을 시작해 주세요");
        return setMessage("퇴사월 임금안이 아직 없습니다. 임금계산에서 해당 월을 먼저 작성해 주세요.");
      }
      return setMessage(payload.error || "임금안에 반영하지 못했습니다.");
    }
    const applied = `${payload.period} 임금안 퇴직금을 ${(payload.amount ?? 0).toLocaleString("ko-KR")}원`
      + `${overrideSeverance !== undefined ? `(예상 인센티브 ${assumed.toLocaleString("ko-KR")}원 기준)`
        : manualSeverance ? "(퇴직금 칸에 입력한 값)" : "(추정액)"}으로 반영했습니다`
      + `${payload.previous ? ` (이전 ${payload.previous.toLocaleString("ko-KR")}원)` : ""}.`
      + `${annualLeave ? ` 연차수당 ${annualLeave.toLocaleString("ko-KR")}원도 함께 기록했습니다.` : ""}`
      + `${deduction ? ` 공제 ${deduction.toLocaleString("ko-KR")}원(${deductionNote})도 함께 기록했습니다.` : ""}`
      + `${payload.leaveDate ? ` 퇴사일 ${payload.leaveDate}${payload.leaveDateChanged ? "" : "(이미 같은 값)"}도 적었습니다.` : ""}`
      + " 임금계산에서 내용을 확인하고 확정해 주세요.";
    setMessage(applied);
    // 반영은 눌러도 화면이 크게 바뀌지 않아 됐는지 알기 어렵다. 결과를 팝업으로 한 번 더 알린다.
    window.alert(`임금안에 반영되었습니다.

${applied}`);
  }

  // 잔여 연차 일수에 1일 통상임금을 곱해 연차수당 칸을 채운다. 일수가 음수면 금액도 음수가 되고,
  // 그 금액이 임금안에서 공제로 넘어간다.
  function leavePayFor(days: number) {
    return Math.round((estimate?.leaveDailyWage ?? 0) * days);
  }

  // 잔여 연차를 고치면 연차수당 칸이 곧바로 따라 움직인다. 칸은 그대로 손으로도 고칠 수 있다.
  function changeLeaveDays(value: string) {
    const days = Number(value);
    setDraft((current) => ({ ...current, leaveDays: value, leavePay: Number.isFinite(days) ? String(leavePayFor(days)) : current.leavePay }));
  }

  // 급여자료에 손으로 적어 둔 금액이나 이미 채워 둔 값을 계산 추정치로 지우기 전에 확인을 받는다.
  // 퇴직금 대상이 아니면(계속근로 1년 미만 등) 연차수당만 계산한다.
  function applyEstimate(estimate: SeveranceEstimate) {
    const existing = Number(draft.retirementPay) || 0;
    const nextLeavePay = String(leavePayFor(Number(draft.leaveDays) || 0));
    if (!estimate.eligible) return setDraft((current) => ({ ...current, leavePay: nextLeavePay }));
    if ((estimate.recordedSeverance > 0 || existing > 0) && !window.confirm("기 입력된 값이 있습니다. 덮어 쓰겠습니까?")) return;
    setDraft((current) => ({ ...current, retirementPay: String(estimate.severance), leavePay: nextLeavePay }));
  }

  const leaveDays = Number(draft.leaveDays) || 0;
  // 칸에 적힌 값이 정산의 근거다. 계산 결과를 그대로 두든 손으로 고치든 이 값이 임금안까지 간다.
  const leavePay = Math.round(Number(draft.leavePay) || 0);
  // 퇴직금 대상이 아니어도(계속근로 1년 미만 등) 마이너스 연차나 정산 공제가 있으면
  // 임금안에 넣을 것이 있다. 예전에는 버튼이 estimate.eligible 안에만 있어 이런 사람은
  // 공제를 반영할 방법이 아예 없었다.
  const hasSettlementDeduction = leaveDays < 0 || leavePay !== 0 || (Number(draft.deductions) || 0) > 0;

  // 확정 전 급여월이 있으면 "인센티브가 이만큼 나올 것 같다"를 넣어 퇴직금이 어떻게 바뀌는지 본다.
  // 서버에 저장하지 않는다 — 확정되면 실제 값으로 다시 계산되므로 여기서는 가늠만 한다.
  const assumed = Math.max(0, Math.round(Number(assumedIncentive) || 0));
  const simulated = (() => {
    if (!estimate || !estimate.averageWageDays || !assumed) return null;
    const averageDailyWage = (estimate.averageWageTotal + assumed) / estimate.averageWageDays;
    const applied = Math.max(averageDailyWage, estimate.ordinaryDailyWage);
    return {
      averageDailyWage, applied,
      basis: averageDailyWage >= estimate.ordinaryDailyWage ? "평균임금" : "통상임금",
      severance: Math.round(applied * 30 * (estimate.tenureDays / 365)),
    };
  })();
  const amount = Number(draft.finalSalary) + Number(draft.retirementPay) + leavePay - Number(draft.deductions);
  const checks: Array<[keyof typeof draft, string]> = [["payrollConfirmed", "최종 급여 확인"], ["insuranceConfirmed", "4대보험 상실 신고 확인"], ["accessRevoked", "업무 계정·접근권한 회수"], ["assetsReturned", "회사 자산 반납"], ["handoverConfirmed", "업무 인수인계 완료"]];
  return <section className="retirement-settlement"><div className="detail-card-heading"><div><p className="eyebrow">FINAL SETTLEMENT</p><h3>퇴직 정산·회수 통제</h3></div><StatusPill value={status === "READY" ? "완료 가능" : status === "COMPLETED" ? "퇴직 완료" : "정산 중"} /></div>
    <div className="retirement-settlement-amounts">
      <label>최종 급여<input type="number" min="0" value={draft.finalSalary} onChange={(event) => setDraft({ ...draft, finalSalary: event.target.value })} /></label>
      <label>퇴직금<input type="number" min="0" value={draft.retirementPay} onChange={(event) => setDraft({ ...draft, retirementPay: event.target.value })} /></label>
      <label>잔여 연차(일)<input type="number" step="0.5" min="-366" max="366" value={draft.leaveDays} onChange={(event) => changeLeaveDays(event.target.value)} /></label>
      <label>연차수당<input type="number" step="1" value={draft.leavePay} onChange={(event) => setDraft({ ...draft, leavePay: event.target.value })} /></label>
      <label>공제액<input type="number" min="0" value={draft.deductions} onChange={(event) => setDraft({ ...draft, deductions: event.target.value })} /></label>
      {/* 공제액 오른편 빈 칸. 입력을 다 채운 자리에서 바로 누를 수 있게 여기에 둔다. */}
      {estimate && (estimate.eligible || hasSettlementDeduction) && <div className="settlement-apply-cell">
        <button type="button" className="outline-button" onClick={() => void applyToPayroll(estimate)}>임금안에 반영</button>
      </div>}
    </div>
    {estimate && <div className="settlement-estimate">
      <p><strong>퇴직금 추정액 {estimate.eligible ? `${estimate.severance.toLocaleString("ko-KR")}원` : "산정 불가"} · 검토 필요</strong></p>
      <p className="settlement-basis">{estimate.eligible ? `재직 ${estimate.tenureDays}일` : estimate.reason}</p>
      <p className="settlement-basis">평균임금 산정기간 {estimate.months.length ? estimate.months.join(", ") : "자료 없음"}</p>
      {estimate.provisionalMonths.length > 0 && <div className="settlement-provisional" role="status">
        <strong>{estimate.provisionalMonths.join(", ")} 급여가 아직 확정되지 않았습니다.</strong>
        <p>이 달의 인센티브가 정해지면 평균임금이 올라가 퇴직금도 바뀝니다. 임금계산에서 해당 월을 확정하면 이 안내가 사라지고 확정 금액으로 다시 계산됩니다.</p>
        <label>
          <span>예상 인센티브</span>
          <input type="number" min="0" step="1" value={assumedIncentive}
            onChange={(event) => setAssumedIncentive(event.target.value)} aria-label="예상 인센티브" />
        </label>
        {simulated
          ? <>
            <p className="settlement-simulated">인센티브 {assumed.toLocaleString("ko-KR")}원을 더하면 1일 {simulated.basis} {Math.round(simulated.applied).toLocaleString("ko-KR")}원 · 퇴직금 <strong>{simulated.severance.toLocaleString("ko-KR")}원</strong> (지금 {estimate.severance.toLocaleString("ko-KR")}원 대비 {(simulated.severance - estimate.severance).toLocaleString("ko-KR")}원)</p>
            {/* 위의 "임금안에 반영"은 퇴직금 칸이나 추정액을 넣지만, 이 버튼은 방금 계산한 금액을 넣는다. */}
            <button type="button" className="outline-button" onClick={() => void applyToPayroll(estimate, simulated.severance)}>이 금액을 임금안에 반영</button>
          </>
          : <p className="settlement-simulated muted">금액을 넣으면 퇴직금이 얼마가 되는지 미리 보여 줍니다. 저장되지는 않습니다.</p>}
      </div>}
      {estimate.eligible && <table className="settlement-compare"><tbody>
        <tr className={estimate.basis === "AVERAGE" ? "applied" : ""}>
          <th>평균임금 기준</th>
          <td>1일 {Math.round(estimate.averageDailyWage).toLocaleString("ko-KR")}원{estimate.months.length ? ` (${estimate.months.join(", ")})` : ""}</td>
          <td><strong>{estimate.averageSeverance.toLocaleString("ko-KR")}원</strong></td>
          <td>{estimate.basis === "AVERAGE" ? "적용" : ""}</td>
        </tr>
        <tr className={estimate.basis === "ORDINARY" ? "applied" : ""}>
          <th>통상임금 기준</th>
          <td>1일 {Math.round(estimate.ordinaryDailyWage).toLocaleString("ko-KR")}원 ({estimate.workingTimeRule.label})</td>
          <td><strong>{estimate.ordinarySeverance.toLocaleString("ko-KR")}원</strong></td>
          <td>{estimate.basis === "ORDINARY" ? "적용" : ""}</td>
        </tr>
        {estimate.recordedSeverance > 0 && <tr className="recorded">
          <th>기입력된 퇴직금 금액</th>
          <td>{estimate.period} 급여자료에 직접 입력한 값</td>
          <td><strong>{estimate.recordedSeverance.toLocaleString("ko-KR")}원</strong></td>
          <td></td>
        </tr>}
      </tbody></table>}
      {estimate.eligible && <p className="settlement-basis">두 기준 중 큰 쪽을 적용합니다. 통상임금 기준은 근로자퇴직급여보장법상 하한입니다.</p>}
      <p className="settlement-basis settlement-caution">이 금액은 참고용 추정치입니다. 임금안·급여에 자동 반영되지 않으며, 확정 금액은 세무법인 검토를 거쳐 임금계산에서 직접 입력해 주세요.
        {estimate.limitations.map((item) => ` ${item}`).join("")}</p>
      {(estimate.eligible || hasSettlementDeduction) && <div className="settlement-estimate-actions">
        <button type="button" className="outline-button" onClick={() => applyEstimate(estimate)}>{estimate.eligible ? "계산 (퇴직금·연차수당)" : "연차수당 계산"}</button>
      </div>}
      <p className="settlement-basis">{estimate.payrollMonthReady
        ? `${estimate.period} 임금안이 준비되어 있습니다. 임금계산에서 퇴직금 칸에 확정 금액을 입력하세요.`
        : "급여 월이 비어 있습니다. 해당 급여월은 만들어 주세요"}</p>
    </div>}
    <p className="settlement-basis">연차수당 {leavePay.toLocaleString("ko-KR")}원{leaveDays < 0 ? " (선사용 연차 공제)" : ""}{estimate?.leaveDailyWage ? ` · 1일 통상임금 ${Math.round(estimate.leaveDailyWage).toLocaleString("ko-KR")}원 (${estimate.workingTimeRule.label} · 월 통상임금 ÷ ${estimate.workingTimeRule.monthlyHours}시간 × ${estimate.workingTimeRule.dailyHours}시간)` : ""}{estimate?.usedLeaveUnits ? ` · 승인된 연차 사용 ${estimate.usedLeaveUnits}일` : ""}</p>
    <strong className="settlement-net">예상 최종 정산액 {Math.round(amount).toLocaleString("ko-KR")}원</strong>
    <div className="retirement-control-list">{checks.map(([key, label]) => <label key={key} className={draft[key] ? "checked" : ""}><input type="checkbox" checked={Boolean(draft[key])} onChange={(event) => setDraft({ ...draft, [key]: event.target.checked })} /><span>✓</span><strong>{label}</strong></label>)}</div>
    {message && <p className="retirement-settlement-message">{message}</p>}
    <button type="button" className="outline-button" disabled={status === "COMPLETED"} onClick={() => void save()}>정산·통제 저장</button>
  </section>;
}

function RetirementModal({ employee, onClose, onSubmit }: { employee: Employee; onClose: () => void; onSubmit: (record: RetirementRecord) => void }) {
  const [date, setDate] = useState(employee.retirement?.date ?? "2026-09-30");
  const [reason, setReason] = useState(employee.retirement?.reason ?? "");
  const [completedTaskIds, setCompletedTaskIds] = useState<string[]>(employee.retirement?.completedTaskIds ?? []);
  const [confirmation, setConfirmation] = useState<RetirementRecord | null>(null);
  // 내려가면 제목줄을 절반 높이로 접는다. 지원자 팝업과 같은 방식이다.
  const [condensed, setCondensed] = useState(false);
  const totalTasks = retirementChecklist.hr.length + retirementChecklist.employee.length;
  const progress = Math.round((completedTaskIds.length / totalTasks) * 100);
  const checklistMode = Boolean(employee.retirement?.requestId && ["IN_PROGRESS", "READY", "EFFECTIVE"].includes(employee.retirement?.status ?? ""));
  const pendingApproval = Boolean(employee.retirement?.requestId && employee.retirement?.status === "SUBMITTED");

  function toggleTask(id: string) {
    setCompletedTaskIds((value) => value.includes(id) ? value.filter((taskId) => taskId !== id) : [...value, id]);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const record = { requestId: employee.retirement?.requestId, status: employee.retirement?.status, date, reason: reason.trim(), completedTaskIds };
    if (checklistMode || pendingApproval) onSubmit(record);
    else setConfirmation(record);
  }

  const ChecklistGroup = ({ title, owner, tasks }: { title: string; owner: string; tasks: { id: string; label: string }[] }) => (
    <section className="retirement-checklist-group">
      <div className="checklist-group-heading"><div><p>{owner}</p><h3>{title}</h3></div><span>{tasks.filter((task) => completedTaskIds.includes(task.id)).length}/{tasks.length}</span></div>
      <div className="retirement-task-list">{tasks.map((task) => <label key={task.id} className={completedTaskIds.includes(task.id) ? "checked" : ""}><input disabled={pendingApproval} type="checkbox" checked={completedTaskIds.includes(task.id)} onChange={() => toggleTask(task.id)} /><span className="task-check">✓</span><strong>{task.label}</strong></label>)}</div>
    </section>
  );

  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><form
    className={`employee-modal retirement-modal${condensed ? " condensed" : ""}`}
    onSubmit={submit}
    onMouseDown={(event) => event.stopPropagation()}
    onScroll={(event) => {
      const top = event.currentTarget.scrollTop;
      setCondensed((current) => nextCondensed(current, top));
    }}
  ><div className="modal-header"><div><p>RETIREMENT PROCESS</p><h2>퇴직 절차 관리</h2></div><button type="button" onClick={onClose}>×</button></div><div className="candidate-banner"><span>{employee.name.slice(0, 1)}</span><div><strong>{employee.name}</strong><small>{employee.department} · {employee.position}</small></div><em>{employee.id}</em></div>{pendingApproval && <p className="optional-form-notice">기존 방식으로 생성된 퇴직 요청입니다. 현재 진행 상태를 확인해 주세요.</p>}{checklistMode && <p className="optional-form-notice">{employee.retirement?.status === "EFFECTIVE" ? "퇴직일이 지나 퇴직 상태가 반영되었습니다. 남은 정산·회수 업무는 입·퇴사 관리에서 계속 완료할 수 있습니다." : "퇴직 승인이 완료되었습니다. 퇴직일이 도래하면 재직·조직 명부에서 자동 제외되며, 체크리스트는 별도로 계속 관리됩니다."}</p>}<div className="retirement-modal-body"><div className="retirement-modal-main"><div className="retirement-fields"><label><span>퇴직일 *</span><input required disabled={checklistMode || pendingApproval} type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label><span>퇴직사유 *</span><textarea required disabled={checklistMode || pendingApproval} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="퇴직 사유와 참고사항을 입력하세요."></textarea></label></div><div className="retirement-progress"><div><span>퇴직 절차 체크리스트</span><strong>{completedTaskIds.length}/{totalTasks} 완료</strong></div><div className="retirement-progress-track"><i style={{ width: `${progress}%` }}></i></div><small>{progress === 100 ? "모든 퇴직 절차를 완료했습니다." : `미완료 업무 ${totalTasks - completedTaskIds.length}건이 남아 있습니다.`}</small></div><div className="retirement-checklist-grid"><ChecklistGroup title="인사담당자 수행 업무" owner="HR OWNER" tasks={retirementChecklist.hr} /><ChecklistGroup title="퇴직자 수행 업무" owner="EMPLOYEE" tasks={retirementChecklist.employee} /></div></div>{checklistMode && employee.retirement?.requestId && <aside className="retirement-modal-side"><RetirementSettlementPanel requestId={employee.retirement.requestId} /></aside>}</div><div className="modal-actions"><button type="button" onClick={onClose}>취소</button><button type="submit" disabled={pendingApproval} className="primary-button">{pendingApproval ? "기존 요청 확인 중" : checklistMode ? "체크리스트 저장" : "퇴직 승인"}</button></div></form>{confirmation && <div className="retirement-confirmation-backdrop" role="presentation" onMouseDown={() => setConfirmation(null)}><section className="retirement-confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="retirement-confirmation-title" onMouseDown={(event) => event.stopPropagation()}><p>FINAL CONFIRMATION</p><h2 id="retirement-confirmation-title">{employee.name} 퇴직 처리 확인</h2><span>작성한 내용을 확인 후 퇴직 버튼을 클릭해 주세요.</span><dl><div><dt>퇴직일</dt><dd>{confirmation.date}</dd></div><div><dt>퇴직사유</dt><dd>{confirmation.reason}</dd></div><div><dt>체크리스트</dt><dd>{confirmation.completedTaskIds.length}/{totalTasks} 완료</dd></div></dl><div><button type="button" onClick={() => setConfirmation(null)}>돌아가기</button><button type="button" className="danger-confirm" onClick={() => onSubmit(confirmation)}>퇴직</button></div></section></div>}</div>;
}

function SettingsView({ employees, onSave, onNotify }: { employees: Employee[]; onSave: () => void; onNotify: (message: string) => void }) {
  const [section, setSection] = useState("company");
  type AccessRole = "SUPER_ADMIN" | "FINANCE_ADMIN" | "HR_ADMIN" | "RECRUITER" | "SALES_ADMIN" | "VIEWER";
  type AuthorizedUser = { employeeId: string; email: string; roles: AccessRole[]; active: boolean };
  const roleLabels: Record<AccessRole, string> = { SUPER_ADMIN: "최고 관리자", FINANCE_ADMIN: "재무 관리자", HR_ADMIN: "HR 관리자", RECRUITER: "채용 담당자", SALES_ADMIN: "영업 관리자", VIEWER: "조회 전용" };
  const [authorizedUsers, setAuthorizedUsers] = useState<AuthorizedUser[]>([]);
  const [candidateId, setCandidateId] = useState("");
  const [candidateRole, setCandidateRole] = useState<AccessRole>("VIEWER");
  const [permissionsLoading, setPermissionsLoading] = useState(true);
  const authorizedUserIds = authorizedUsers.map((user) => user.employeeId);
  const activeEmployees = employees.filter(isCurrentEmployee);
  const availableEmployees = activeEmployees.filter((employee) => !authorizedUserIds.includes(employee.id));

  useEffect(() => {
    let cancelled = false;
    async function loadAuthorizedUsers() {
      try {
        const response = await fetch("/api/hr/authorized-users");
        const payload = await response.json() as { users?: AuthorizedUser[]; error?: string };
        if (!response.ok) throw new Error(payload.error ?? "사용자 권한을 불러오지 못했습니다.");
        if (!cancelled) setAuthorizedUsers(payload.users ?? []);
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
      body: JSON.stringify({ employeeId: candidateId, roles: [candidateRole] }),
    });
    const payload = await response.json() as { user?: AuthorizedUser; error?: string };
    if (!response.ok || !payload.user) {
      onNotify(payload.error ?? "사용자를 추가하지 못했습니다.");
      return;
    }
    setAuthorizedUsers((value) => [...value.filter((user) => user.employeeId !== payload.user!.employeeId), payload.user!]);
    setCandidateId("");
    setCandidateRole("VIEWER");
    onNotify("사용자 권한을 추가했습니다.");
  }

  async function updateAuthorizedUserRole(employeeId: string, role: AccessRole) {
    const response = await fetch("/api/hr/authorized-users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employeeId, roles: [role] }),
    });
    const payload = await response.json() as { user?: AuthorizedUser; error?: string };
    if (!response.ok || !payload.user) {
      onNotify(payload.error ?? "사용자 역할을 변경하지 못했습니다.");
      return;
    }
    setAuthorizedUsers((value) => value.map((user) => user.employeeId === employeeId ? payload.user! : user));
    onNotify("사용자 역할을 변경했습니다.");
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
    setAuthorizedUsers((value) => value.filter((user) => user.employeeId !== employeeId));
    onNotify("사용자 접근 권한을 비활성화했습니다.");
  }

  const sectionTitle = section === "company"
    ? "회사·조직 정보"
    : section === "hr"
      ? "인사 기준정보"
      : section === "notifications"
        ? "알림 설정"
        : section === "permissions"
          ? "사용자·권한"
          : section === "approvals"
            ? "전자결재 규칙"
            : "데이터·백업";

  return <div className="page-wrap settings-page">
    <section className="module-hero">
      <div><p className="eyebrow">WORKSPACE SETTINGS</p><h1>환경설정</h1><p>회사 정보, 인사 기준, 알림과 접근 권한을 설정합니다.</p></div>
      <button type="button" className="primary-button" onClick={onSave}>변경사항 저장</button>
    </section>
    <div className="settings-layout">
      <aside className="panel settings-nav">
        {[["company", "회사·조직 정보"], ["hr", "인사 기준정보"], ["notifications", "알림 설정"], ["permissions", "사용자·권한"], ["approvals", "전자결재 규칙"], ["data", "데이터·백업"]].map(([id, label]) => <button type="button" className={section === id ? "active" : ""} key={id} onClick={() => setSection(id)}>{label}<span>›</span></button>)}
      </aside>
      <section className="panel settings-content">
        <div className="detail-card-heading"><div><p className="eyebrow">{section.toUpperCase()}</p><h2>{sectionTitle}</h2></div></div>
        {section === "company" && <div className="settings-form"><label><span>회사명</span><input defaultValue="XD NODE" /></label><label><span>대표자</span><input defaultValue="이정민" /></label><label><span>사업자등록번호</span><input defaultValue="123-45-67890" /></label><label><span>기본 근무지</span><input defaultValue="서울 본사" /></label><label className="wide"><span>회사 주소</span><input defaultValue="서울특별시 성동구 아차산로 00" /></label></div>}
        {section === "hr" && <div className="setting-list"><SettingToggle title="사번 자동 발급" description="입사연도와 순번으로 사번을 자동 생성합니다." checked /><SettingToggle title="수습기간 종료 알림" description="종료 14일 전에 담당자와 부서장에게 알립니다." checked /><SettingToggle title="급여 마감 후 수정 제한" description="마감된 급여는 급여관리자만 다시 열 수 있습니다." checked /></div>}
        {section === "notifications" && <div className="setting-list"><SettingToggle title="시스템 알림" description="업무 마감과 승인 요청을 알림센터에서 받습니다." checked /><SettingToggle title="이메일 알림" description="중요 HR 일정을 이메일로도 받습니다." checked /><SettingToggle title="미처리 업무 재알림" description="기한이 지난 업무를 매일 오전 다시 알립니다." checked={false} /></div>}
        {section === "permissions" && <div className="permission-management">
          <form className="permission-add-form" onSubmit={addAuthorizedUser}>
            <label><span>회사 등록 인물</span><select value={candidateId} onChange={(event) => setCandidateId(event.target.value)} disabled={permissionsLoading || availableEmployees.length === 0}><option value="">{availableEmployees.length === 0 ? "추가 가능한 인물이 없습니다" : "사용자 선택"}</option>{availableEmployees.map((employee) => <option value={employee.id} key={employee.id}>{employee.name} · {employee.department}</option>)}</select></label>
            <label><span>기본 역할</span><select value={candidateRole} onChange={(event) => setCandidateRole(event.target.value as AccessRole)}>{(["VIEWER", "FINANCE_ADMIN", "HR_ADMIN", "RECRUITER", "SALES_ADMIN"] as AccessRole[]).map((role) => <option value={role} key={role}>{roleLabels[role]}</option>)}</select></label>
            <button type="submit" className="primary-button" disabled={!candidateId}>사용자 추가</button>
          </form>
          <p className="permission-help">회사 인사기록에 등록된 재직자만 추가할 수 있으며 역할별 권한은 서버에서 검사되고 변경이력은 감사기록에 남습니다.</p>
          <div className="permission-list">
            {permissionsLoading && <div className="permission-loading">사용자 권한을 불러오는 중입니다.</div>}
            {!permissionsLoading && authorizedUsers.map((access) => {
              const employeeId = access.employeeId;
              const employee = employees.find((item) => item.id === employeeId);
              if (!employee) return null;
              const isCurrentAdministrator = employeeId === "gc.kim";
              return <div key={employeeId}>
                <span className="owner-chip">{employee.name.slice(0, 1)}</span>
                <p><strong>{employee.name}</strong><small>{employee.department} · {access.email}</small></p>
                <div className="permission-row-actions">{isCurrentAdministrator ? <><em>{roleLabels.SUPER_ADMIN}</em><span className="permission-current">현재 사용자</span></> : <><select aria-label={`${employee.name} 역할`} value={access.roles[0] ?? "VIEWER"} onChange={(event) => void updateAuthorizedUserRole(employeeId, event.target.value as AccessRole)}>{(["VIEWER", "FINANCE_ADMIN", "HR_ADMIN", "RECRUITER", "SALES_ADMIN"] as AccessRole[]).map((role) => <option value={role} key={role}>{roleLabels[role]}</option>)}</select><button type="button" onClick={() => removeAuthorizedUser(employeeId)}>비활성화</button></>}</div>
              </div>;
            })}
          </div>
        </div>}
        {section === "approvals" && <ApprovalSettings employees={employees} onNotify={onNotify} />}
        {section === "data" && <div className="data-settings"><div><strong>마지막 자동 백업</strong><span>오늘 03:00 · 정상 완료</span><button type="button" onClick={onSave}>지금 백업</button></div><div><strong>개인정보 보유기간</strong><span>퇴사 후 3년 · 관리자 확인 필요</span><button type="button">정책 관리</button></div><div><strong>엑셀 데이터 가져오기</strong><span>직원·급여·교육 표준양식 지원</span><button type="button">가져오기</button></div></div>}
      </section>
    </div>
  </div>;
}

function ApprovalSettings({ employees, onNotify }: { employees: Employee[]; onNotify: (message: string) => void }) {
  type Module = "finance" | "hr" | "recruitment" | "sales" | "settings";
  type Role = "SUPER_ADMIN" | "FINANCE_ADMIN" | "HR_ADMIN" | "SALES_ADMIN";
  type PolicyStep = { stepOrder: number; stepName: string; approverRole: Role; approverEmployeeId: string };
  type Policy = { id: string; module: Module; requestType: string; name: string; minAmount: number; maxAmount: number | null; priority: number; steps: PolicyStep[] };
  type Delegation = { id: string; delegatorEmployeeId: string; delegateEmployeeId: string; module: string; startsOn: string; endsOn: string; reason: string };
  type AccessUser = { employeeId: string; roles: string[] };
  type DefaultRoute = { module: Module; requestType: string; label: string; steps: PolicyStep[] };
  const moduleLabels: Record<Module, string> = { finance: "재무회계", hr: "HR", recruitment: "채용", sales: "영업", settings: "데이터 통제" };
  const moduleRoles: Record<Module, Role[]> = { finance: ["FINANCE_ADMIN", "SUPER_ADMIN"], hr: ["HR_ADMIN", "SUPER_ADMIN"], recruitment: ["HR_ADMIN", "SUPER_ADMIN"], sales: ["SALES_ADMIN", "SUPER_ADMIN"], settings: ["SUPER_ADMIN"] };
  const roleLabels: Record<Role, string> = { SUPER_ADMIN: "대표 승인", FINANCE_ADMIN: "재무 관리자", HR_ADMIN: "HR 관리자", SALES_ADMIN: "영업 관리자" };
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const nextWeek = new Date(Date.now() + (7 * 24 + 9) * 60 * 60 * 1000).toISOString().slice(0, 10);
  const [loading, setLoading] = useState(true);
  const [types, setTypes] = useState<Record<Module, Record<string, string>>>({ finance: {}, hr: {}, recruitment: {}, sales: {}, settings: {} });
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [defaults, setDefaults] = useState<DefaultRoute[]>([]);
  const [delegations, setDelegations] = useState<Delegation[]>([]);
  const [users, setUsers] = useState<AccessUser[]>([]);
  const emptySteps = (module: Module): PolicyStep[] => module === "settings"
    ? [{ stepOrder: 1, stepName: "경영 책임자 승인", approverRole: "SUPER_ADMIN", approverEmployeeId: "" }]
    : [{ stepOrder: 1, stepName: `${moduleLabels[module]} 검토`, approverRole: moduleRoles[module][0], approverEmployeeId: "" }, { stepOrder: 2, stepName: "대표 승인", approverRole: "SUPER_ADMIN", approverEmployeeId: "" }];
  const [policyDraft, setPolicyDraft] = useState({ id: "", module: "finance" as Module, requestType: "EXPENSE", name: "", minAmount: "0", maxAmount: "", priority: "0", steps: emptySteps("finance") });
  const [delegationDraft, setDelegationDraft] = useState({ delegatorEmployeeId: "", delegateEmployeeId: "", module: "all", startsOn: today, endsOn: nextWeek, reason: "" });
  const employeeName = (id: string) => employees.find((employee) => employee.id === id)?.name ?? id;
  const formatAmount = (value: number | null) => value === null ? "제한 없음" : `${new Intl.NumberFormat("ko-KR").format(value)}원`;

  async function loadSettings() {
    setLoading(true);
    try {
      const response = await fetch("/api/approval-settings", { cache: "no-store" });
      const payload = await response.json() as { policies?: Policy[]; defaults?: DefaultRoute[]; delegations?: Delegation[]; users?: AccessUser[]; types?: Record<Module, Record<string, string>>; error?: string };
      if (!response.ok) throw new Error(payload.error || "전자결재 설정을 불러오지 못했습니다.");
      setPolicies(payload.policies ?? []); setDefaults(payload.defaults ?? []); setDelegations(payload.delegations ?? []); setUsers(payload.users ?? []);
      if (payload.types) setTypes(payload.types);
    } catch (error) { onNotify(error instanceof Error ? error.message : "전자결재 설정을 불러오지 못했습니다."); }
    finally { setLoading(false); }
  }

  useEffect(() => { void loadSettings(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function changePolicyModule(module: Module) {
    setPolicyDraft({ id: "", module, requestType: Object.keys(types[module])[0] ?? "", name: "", minAmount: "0", maxAmount: "", priority: "0", steps: emptySteps(module) });
  }

  async function savePolicy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/approval-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource: "policy", ...policyDraft }) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) { onNotify(payload.error || "결재 규칙을 저장하지 못했습니다."); return; }
    onNotify(policyDraft.id ? "결재 규칙을 수정했습니다." : "결재 규칙을 추가했습니다.");
    changePolicyModule(policyDraft.module); await loadSettings();
  }

  function editPolicy(policy: Policy) {
    setPolicyDraft({ id: policy.id, module: policy.module, requestType: policy.requestType, name: policy.name, minAmount: String(policy.minAmount), maxAmount: policy.maxAmount === null ? "" : String(policy.maxAmount), priority: String(policy.priority), steps: policy.steps });
  }

  async function disableSetting(resource: "policy" | "delegation", id: string) {
    const response = await fetch("/api/approval-settings", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource, id, reason: "관리자 설정 변경" }) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) { onNotify(payload.error || "설정을 비활성화하지 못했습니다."); return; }
    onNotify(resource === "policy" ? "결재 규칙을 비활성화했습니다." : "대결 설정을 종료했습니다."); await loadSettings();
  }

  async function saveDelegation(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/approval-settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource: "delegation", ...delegationDraft }) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) { onNotify(payload.error || "대결 설정을 저장하지 못했습니다."); return; }
    onNotify("대결 기간을 등록했습니다. 새로 제출되는 결재부터 적용됩니다.");
    setDelegationDraft({ delegatorEmployeeId: "", delegateEmployeeId: "", module: "all", startsOn: today, endsOn: nextWeek, reason: "" }); await loadSettings();
  }

  const updateStep = (index: number, change: Partial<PolicyStep>) => setPolicyDraft((current) => ({ ...current, steps: current.steps.map((step, stepIndex) => stepIndex === index ? { ...step, ...change } : step) }));
  return <div className="approval-settings">
    <div className="approval-settings-intro"><strong>결재 규칙은 제출 시점에 확정됩니다.</strong><span>금액 구간에 맞는 사용자 정의 규칙이 없으면 안전한 기본 결재선을 사용합니다. 1단계 규칙은 전결로 처리됩니다.</span></div>
    <section className="approval-setting-block"><div className="approval-setting-heading"><div><h3>금액·유형별 결재 규칙</h3><span>겹치지 않는 금액 구간으로 최대 3단계까지 설정합니다.</span></div></div>
      <form className="approval-policy-form" onSubmit={savePolicy}>
        <label><span>업무 영역</span><select value={policyDraft.module} onChange={(event) => changePolicyModule(event.target.value as Module)}>{Object.entries(moduleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>결재 유형</span><select value={policyDraft.requestType} onChange={(event) => setPolicyDraft({ ...policyDraft, requestType: event.target.value })}>{Object.entries(types[policyDraft.module]).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>규칙명</span><input required value={policyDraft.name} onChange={(event) => setPolicyDraft({ ...policyDraft, name: event.target.value })} placeholder="예: 소액 견적 전결" /></label>
        <label><span>최소 금액</span><input type="number" min="0" required value={policyDraft.minAmount} onChange={(event) => setPolicyDraft({ ...policyDraft, minAmount: event.target.value })} /></label>
        <label><span>최대 금액</span><input type="number" min="0" value={policyDraft.maxAmount} onChange={(event) => setPolicyDraft({ ...policyDraft, maxAmount: event.target.value })} placeholder="비우면 제한 없음" /></label>
        <label><span>우선순위</span><input type="number" min="0" max="999" value={policyDraft.priority} onChange={(event) => setPolicyDraft({ ...policyDraft, priority: event.target.value })} /></label>
        <div className="approval-policy-steps"><span>결재 단계</span>{policyDraft.steps.map((step, index) => <div key={step.stepOrder}><b>{index + 1}</b><input aria-label={`${index + 1}단계 명칭`} required value={step.stepName} onChange={(event) => updateStep(index, { stepName: event.target.value })} /><select aria-label={`${index + 1}단계 역할`} value={step.approverRole} onChange={(event) => updateStep(index, { approverRole: event.target.value as Role, approverEmployeeId: "" })}>{moduleRoles[policyDraft.module].map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select><select aria-label={`${index + 1}단계 지정 결재자`} value={step.approverEmployeeId} onChange={(event) => updateStep(index, { approverEmployeeId: event.target.value })}><option value="">역할로 자동 배정</option>{users.filter((user) => user.roles.includes(step.approverRole) || user.roles.includes("SUPER_ADMIN")).map((user) => <option key={user.employeeId} value={user.employeeId}>{employeeName(user.employeeId)}</option>)}</select>{policyDraft.steps.length > 1 && <button type="button" onClick={() => setPolicyDraft((current) => ({ ...current, steps: current.steps.filter((_, stepIndex) => stepIndex !== index).map((item, stepIndex) => ({ ...item, stepOrder: stepIndex + 1 })) }))}>삭제</button>}</div>)}{policyDraft.steps.length < 3 && <button type="button" className="approval-add-step" onClick={() => setPolicyDraft((current) => ({ ...current, steps: [...current.steps, { stepOrder: current.steps.length + 1, stepName: "추가 승인", approverRole: "SUPER_ADMIN", approverEmployeeId: "" }] }))}>＋ 단계 추가</button>}</div>
        <div className="approval-policy-actions">{policyDraft.id && <button type="button" onClick={() => changePolicyModule(policyDraft.module)}>수정 취소</button>}<button type="submit">{policyDraft.id ? "규칙 수정" : "규칙 추가"}</button></div>
      </form>
      <div className="approval-policy-list">{loading ? <p>불러오는 중입니다.</p> : policies.length ? policies.map((policy) => <article key={policy.id}><div><span>{moduleLabels[policy.module]} · {types[policy.module]?.[policy.requestType] ?? policy.requestType}</span><strong>{policy.name}</strong><small>{formatAmount(policy.minAmount)} ~ {formatAmount(policy.maxAmount)} · {policy.steps.length === 1 ? "전결" : `${policy.steps.length}단계`}</small></div><ol>{policy.steps.map((step) => <li key={step.stepOrder}>{step.stepName} · {step.approverEmployeeId ? employeeName(step.approverEmployeeId) : roleLabels[step.approverRole]}</li>)}</ol><div><button type="button" onClick={() => editPolicy(policy)}>수정</button><button type="button" onClick={() => void disableSetting("policy", policy.id)}>비활성화</button></div></article>) : <div className="approval-default-list"><strong>현재 사용자 정의 규칙 없음</strong><span>아래 기본 결재선이 적용됩니다.</span>{defaults.slice(0, 8).map((route) => <small key={`${route.module}:${route.requestType}`}>{moduleLabels[route.module]} · {route.label}: {route.steps.map((step) => step.stepName).join(" → ")}</small>)}</div>}</div>
    </section>
    <section className="approval-setting-block"><div className="approval-setting-heading"><div><h3>대결 설정</h3><span>휴가·출장 등 부재기간의 새 결재를 지정 사용자에게 배정합니다.</span></div></div>
      <form className="approval-delegation-form" onSubmit={saveDelegation}>
        <label><span>원 결재자</span><select required value={delegationDraft.delegatorEmployeeId} onChange={(event) => setDelegationDraft({ ...delegationDraft, delegatorEmployeeId: event.target.value })}><option value="">선택</option>{users.map((user) => <option key={user.employeeId} value={user.employeeId}>{employeeName(user.employeeId)}</option>)}</select></label>
        <label><span>대결자</span><select required value={delegationDraft.delegateEmployeeId} onChange={(event) => setDelegationDraft({ ...delegationDraft, delegateEmployeeId: event.target.value })}><option value="">선택</option>{users.filter((user) => user.employeeId !== delegationDraft.delegatorEmployeeId).map((user) => <option key={user.employeeId} value={user.employeeId}>{employeeName(user.employeeId)}</option>)}</select></label>
        <label><span>업무 범위</span><select value={delegationDraft.module} onChange={(event) => setDelegationDraft({ ...delegationDraft, module: event.target.value })}><option value="all">전체</option>{Object.entries(moduleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label><span>시작일</span><input required type="date" value={delegationDraft.startsOn} onChange={(event) => setDelegationDraft({ ...delegationDraft, startsOn: event.target.value })} /></label>
        <label><span>종료일</span><input required type="date" value={delegationDraft.endsOn} onChange={(event) => setDelegationDraft({ ...delegationDraft, endsOn: event.target.value })} /></label>
        <label className="wide"><span>대결 사유</span><input required value={delegationDraft.reason} onChange={(event) => setDelegationDraft({ ...delegationDraft, reason: event.target.value })} placeholder="부재 사유와 적용 범위를 기록하세요" /></label>
        <button type="submit" disabled={users.length < 2}>대결 등록</button>
      </form>
      {users.length < 2 && <p className="approval-setting-warning">대결을 사용하려면 사용자·권한에서 ERP 사용자를 한 명 이상 추가해야 합니다.</p>}
      <div className="approval-delegation-list">{delegations.map((delegation) => <article key={delegation.id}><span>{employeeName(delegation.delegatorEmployeeId)} → {employeeName(delegation.delegateEmployeeId)}</span><strong>{delegation.module === "all" ? "전체 업무" : moduleLabels[delegation.module as Module]} · {delegation.startsOn}~{delegation.endsOn}</strong><small>{delegation.reason}</small><button type="button" onClick={() => void disableSetting("delegation", delegation.id)}>종료</button></article>)}{!loading && !delegations.length && <p>현재 활성 대결 설정이 없습니다.</p>}</div>
    </section>
  </div>;
}

function SettingToggle({ title, description, checked }: { title: string; description: string; checked: boolean }) {
  const [enabled, setEnabled] = useState(checked);
  return <button type="button" className="setting-toggle" onClick={() => setEnabled((value) => !value)}><div><strong>{title}</strong><span>{description}</span></div><i className={enabled ? "on" : ""}><em></em></i></button>;
}

function Dashboard({ employees, organizations, applicants, onNavigate }: { employees: Employee[]; organizations: Organization[]; applicants: Applicant[]; onNavigate: (id: string) => void }) {
  const currentEmployees = employees.filter(isCurrentEmployee);
  const employeeCount = currentEmployees.length;
  const incompleteProfiles = currentEmployees.filter((employee) => [employee.email, employee.phone, employee.birth, employee.address].some((value) => !value || value === "미입력")).length;
  const employmentTypes = Object.entries(currentEmployees.reduce<Record<string, number>>((counts, employee) => ({ ...counts, [employee.type]: (counts[employee.type] ?? 0) + 1 }), {}));

  // 오늘(한국시간)을 기준으로 앞뒤를 가른다. 이 화면의 "예정"은 모두 이 날짜가 기준이다.
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  // 입사일은 "2026.08.03", 퇴직일·면접일은 "2026-08-31" 로 저장돼 있어 구분자를 맞춰 비교한다.
  const dashDate = (value: string) => (value ?? "").replaceAll(".", "-");
  const dayGap = (value: string) => {
    const target = dashDate(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) return null;
    return Math.round((Date.parse(`${target}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  };
  const dDay = (value: string) => {
    const gap = dayGap(value);
    return gap === null ? "" : gap === 0 ? "오늘" : gap > 0 ? `D-${gap}` : `D+${-gap}`;
  };

  // 퇴사 예정자 — 퇴직일이 아직 오지 않은 사람. 날짜는 employee-records 가 퇴직 요청에서 합쳐 준다.
  const leavingSoon = employees
    .filter((employee) => employee.retirement?.date && dashDate(employee.retirement.date) >= today && employee.status !== "퇴직")
    .sort((a, b) => dashDate(a.retirement!.date).localeCompare(dashDate(b.retirement!.date)));
  // 면접 예정자 — 일정이 잡혀 있고 아직 지나지 않았으며 탈락하지 않은 지원자.
  const interviewsSoon = applicants
    .filter((applicant) => applicant.interview?.date && dashDate(applicant.interview.date) >= today && !REJECTED_STAGES.includes(applicant.stage))
    .sort((a, b) => interviewSortKey(a).localeCompare(interviewSortKey(b)));
  // 입사 예정자 — 최종 처우까지 수락해 확정된 사람만이다. 제안만 해 둔 사람은 아래 회신 대기다.
  const joiningSoon = applicants
    .filter((applicant) => applicant.offer?.startDate && dashDate(applicant.offer.startDate) >= today
      && ["ACCEPTED", "ONBOARDED"].includes(applicant.offer.status))
    .sort((a, b) => dashDate(a.offer!.startDate).localeCompare(dashDate(b.offer!.startDate)));
  // 오퍼 회신 대기 — 처우는 제안했지만 아직 수락·거절 회신이 없는 사람.
  const offerPending = applicants
    .filter((applicant) => applicant.offer?.startDate && dashDate(applicant.offer.startDate) >= today
      && applicant.offer.status === "APPROVED")
    .sort((a, b) => dashDate(a.offer!.startDate).localeCompare(dashDate(b.offer!.startDate)));

  const hiresThisMonth = currentEmployees.filter((employee) => dashDate(employee.joinDate).startsWith(today.slice(0, 7))).length;
  const recentHires = [...currentEmployees]
    .filter((employee) => dashDate(employee.joinDate) <= today)
    .sort((a, b) => dashDate(b.joinDate).localeCompare(dashDate(a.joinDate)))
    .slice(0, 5);

  // 면접·입사·퇴사를 한 줄로 세운 통합 일정. 탭마다 흩어져 있으면 "이번 주에 무슨 일이 있나"를 알 수 없다.
  const timeline = [
    ...interviewsSoon.map((applicant) => ({
      date: dashDate(applicant.interview!.date), kind: "면접", tone: "interview", target: "recruitment", who: applicant.name,
      detail: `${applicant.role} · ${applicant.interview!.time || "시간 미정"} · ${applicant.interview!.type || "유형 미정"}`,
    })),
    ...joiningSoon.map((applicant) => ({
      date: dashDate(applicant.offer!.startDate), kind: "입사", tone: "join", target: "onboarding", who: applicant.name,
      detail: `${applicant.offer!.department || "소속 미정"} · ${applicant.offer!.proposedTitle || applicant.role}`,
    })),
    ...offerPending.map((applicant) => ({
      date: dashDate(applicant.offer!.startDate), kind: "회신 대기", tone: "offer", target: "recruitment", who: applicant.name,
      detail: `${applicant.offer!.department || "소속 미정"} · ${applicant.offer!.proposedTitle || applicant.role} · 연봉 ${applicant.offer!.annualSalary.toLocaleString("ko-KR")}원`,
    })),
    ...leavingSoon.map((employee) => ({
      date: dashDate(employee.retirement!.date), kind: "퇴사", tone: "leave", target: "employees", who: employee.name,
      detail: `${employee.department} · ${employee.position} · ${employee.retirement!.reason || "사유 미입력"}`,
    })),
  // 구분별 박스로 나눠 보여 주므로 전체 건수를 자르지 않는다. 각 박스가 자기 몫을 다 담는다.
  ].sort((a, b) => a.date.localeCompare(b.date));

  const metrics = [
    { key: "employees", icon: "인", tone: "navy", label: "재직자", value: employeeCount,
      note: `이번 달 입사 ${hiresThisMonth}명 · 정보 확인 필요 ${incompleteProfiles}명` },
    { key: "employees", icon: "퇴", tone: "red", label: "퇴사 예정", value: leavingSoon.length,
      note: leavingSoon.length ? `가장 이른 퇴사일 ${dashDate(leavingSoon[0].retirement!.date)} (${dDay(leavingSoon[0].retirement!.date)})` : "예정된 퇴사가 없습니다" },
    { key: "recruitment", icon: "면", tone: "blue", label: "면접 예정", value: interviewsSoon.length,
      note: interviewsSoon.length ? `다음 면접 ${dashDate(interviewsSoon[0].interview!.date)} ${interviewsSoon[0].interview!.time || ""} (${dDay(interviewsSoon[0].interview!.date)})` : "잡힌 면접이 없습니다" },
    { key: "onboarding", icon: "입", tone: "green", label: "입사 예정", value: joiningSoon.length,
      note: joiningSoon.length
        ? `가장 이른 입사일 ${dashDate(joiningSoon[0].offer!.startDate)} (${dDay(joiningSoon[0].offer!.startDate)})${offerPending.length ? ` · 오퍼 회신 대기 ${offerPending.length}명` : ""}`
        : offerPending.length ? `확정 대기 · 오퍼 회신 대기 ${offerPending.length}명` : "예정된 입사가 없습니다" },
  ];

  return (
    <div className="page-wrap dashboard-page">
      <section className="welcome-row">
        <div>
          <p className="eyebrow">XDNODE PEOPLE DATA</p>
          <h1>인사 현황 한눈에 보기</h1>
          <p>재직자 <strong>{employeeCount}명</strong> · 퇴사 예정 <strong>{leavingSoon.length}명</strong> · 면접 예정 <strong>{interviewsSoon.length}명</strong> · 입사 예정 <strong>{joiningSoon.length}명</strong></p>
        </div>
        <div className="welcome-actions">
          <button type="button" className="outline-button" onClick={() => onNavigate("recruitment")}>지원자 관리</button>
          <button type="button" className="primary-button" onClick={() => onNavigate("employees")}>인사기록카드</button>
        </div>
      </section>

      <section className="metric-grid">{metrics.map((metric) => (
        <button type="button" className="metric-card" key={metric.label} onClick={() => onNavigate(metric.key)}>
          <div className="metric-top"><span className={`metric-icon ${metric.tone}`}>{metric.icon}</span></div>
          <p>{metric.label}</p><h2>{metric.value}<small>명</small></h2>
          <small>{metric.note}</small>
        </button>
      ))}</section>

      {/* 구분별로 박스를 나눈다. 한데 섞어 두면 "면접이 몇 건인지"를 세어 봐야 알 수 있다. */}
      <section className="dashboard-grid dashboard-event-grid">{[
        { kind: "입사", tone: "join", eyebrow: "JOINING", title: "입사 예정", target: "onboarding", link: "입·퇴사 관리 →", empty: "확정된 입사가 없습니다." },
        { kind: "회신 대기", tone: "offer", eyebrow: "OFFER SENT", title: "입사 오퍼 회신 대기", target: "recruitment", link: "지원자 관리 →", empty: "회신을 기다리는 오퍼가 없습니다." },
        { kind: "퇴사", tone: "leave", eyebrow: "LEAVING", title: "퇴사 예정", target: "employees", link: "인사기록카드 →", empty: "예정된 퇴사가 없습니다." },
        { kind: "면접", tone: "interview", eyebrow: "INTERVIEW", title: "면접 예정", target: "recruitment", link: "지원자 관리 →", empty: "잡힌 면접이 없습니다." },
      ].map((group) => {
        const items = timeline.filter((item) => item.kind === group.kind);
        return <div className={`panel dashboard-event-panel ${group.tone}`} key={group.kind}>
          <div className="section-heading"><div><p className="eyebrow">{group.eyebrow}</p><h2>{group.title} <em>{items.length}건</em></h2></div><button type="button" onClick={() => onNavigate(group.target)}>{group.link}</button></div>
          {items.length ? <ul className="people-timeline">{items.map((item, index) => (
            <li key={`${item.kind}-${item.who}-${index}`}>
              <button type="button" onClick={() => onNavigate(item.target)}>
                <span className="timeline-date"><strong>{item.date.slice(5).replace("-", ".")}</strong><em>{dDay(item.date)}</em></span>
                <span className="timeline-who"><strong>{item.who}</strong><small>{item.detail}</small></span>
              </button>
            </li>
          ))}</ul> : <div className="empty-cell">{group.empty}</div>}
        </div>;
      })}</section>

      <section className="dashboard-grid dashboard-people-grid">
        <div className="panel">
          <div className="section-heading"><div><p className="eyebrow">RECENT JOIN</p><h2>최근 입사자</h2></div><button type="button" onClick={() => onNavigate("employees")}>전체 보기 →</button></div>
          {recentHires.length ? <table className="data-table dashboard-mini-table"><thead><tr><th>직원</th><th>소속·직위</th><th>입사일</th><th>근속</th></tr></thead>
            <tbody>{recentHires.map((employee) => <tr key={employee.id}>
              <td><strong>{employee.name}</strong></td><td>{employee.department} · {employee.position}</td>
              <td>{employee.joinDate}</td><td>{dayGap(employee.joinDate) === null ? "-" : `${-dayGap(employee.joinDate)!}일`}</td>
            </tr>)}</tbody></table> : <div className="empty-cell">등록된 입사 기록이 없습니다.</div>}
        </div>
      </section>

      <section className="dashboard-grid">
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
          <div className="headcount-summary"><div><span>현재 인원</span><strong>{employeeCount}</strong></div><div><span>퇴사 예정</span><strong className="accent">{leavingSoon.length}</strong></div><div><span>입사 예정</span><strong>{joiningSoon.length}</strong></div></div>
        </div>

        <div className="panel insights-panel">
          <div className="section-heading"><div><p className="eyebrow">PEOPLE INSIGHT</p><h2>고용형태 구성</h2></div><button type="button"onClick={() => onNavigate("reports")}>분석 보기 →</button></div>
          <div className="donut-wrap">
            <div className="donut"><div><strong>{employeeCount}</strong><span>재직자</span></div></div>
            <ul>{employmentTypes.map(([type, count], index) => <li key={type}><span className={`legend ${index === 0 ? "navy" : index === 1 ? "blue" : "pale"}`}></span><p>{type}<strong>{count}명</strong></p></li>)}</ul>
          </div>
          <div className="insight-note"><span>✓</span><p><strong>{leavingSoon.length ? `${leavingSoon.length}명이 곧 퇴사합니다.` : "예정된 퇴사가 없습니다."}</strong><small>퇴사·입사 예정을 모두 반영하면 {employeeCount - leavingSoon.length + joiningSoon.length}명이 됩니다.</small></p></div>
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
