"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
          <PeopleFlowApp />
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
      { id: "payroll", label: "급여관리", icon: "급" },
      { id: "onboarding", label: "입·퇴사 관리", icon: "온", badge: "4" },
      { id: "workforce", label: "인력계획·정원", icon: "계" },
    ],
  },
  {
    title: "채용",
    items: [
      { id: "recruitment", label: "지원자 관리", icon: "채", badge: "18" },
      { id: "interviews", label: "면접관리", icon: "면" },
    ],
  },
  {
    title: "성장과 분석",
    items: [
      { id: "performance", label: "성과·목표", icon: "목", badge: "7" },
      { id: "training", label: "교육·법정교육", icon: "교" },
      { id: "reports", label: "통계·리포트", icon: "분" },
    ],
  },
];

const notifications = [
  { type: "평가", text: "상반기 목표 중간점검 미제출자가 7명입니다.", time: "10분 전", urgent: true },
  { type: "교육", text: "개인정보보호 교육 이수 마감이 3일 남았습니다.", time: "1시간 전", urgent: true },
  { type: "입사", text: "김민준 님의 입사 서류가 모두 확인되었습니다.", time: "2시간 전" },
  { type: "급여", text: "7월 급여대장 검토가 완료되었습니다.", time: "어제" },
];

const moduleConfigs: Record<string, ModuleConfig> = {
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

type Employee = {
  id: string;
  name: string;
  department: string;
  position: string;
  type: string;
  joinDate: string;
  status: string;
  email: string;
  phone: string;
  address: string;
  manager: string;
  birth: string;
  history: { date: string; type: string; detail: string }[];
};

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

const initialEmployees: Employee[] = [
  { id: "PF-2026-128", name: "김민준", department: "제품개발팀", position: "선임", type: "정규직", joinDate: "2026.08.03", status: "재직", email: "minjun.kim@peopleflow.co.kr", phone: "010-2451-8842", address: "서울특별시 성동구", manager: "최도영", birth: "1993.04.18", history: [{ date: "2026.08.03", type: "입사", detail: "제품개발팀 선임 입사" }] },
  { id: "PF-2024-092", name: "정우진", department: "제품개발팀", position: "책임", type: "정규직", joinDate: "2024.03.11", status: "재직", email: "woojin.jung@peopleflow.co.kr", phone: "010-8841-2031", address: "경기도 성남시 분당구", manager: "최도영", birth: "1989.11.02", history: [{ date: "2025.01.01", type: "승진", detail: "선임에서 책임으로 승진" }, { date: "2024.03.11", type: "입사", detail: "제품개발팀 선임 입사" }] },
  { id: "PF-2023-074", name: "정하늘", department: "제품개발팀", position: "선임", type: "정규직", joinDate: "2023.02.06", status: "휴직", email: "haneul.jung@peopleflow.co.kr", phone: "010-3379-1105", address: "서울특별시 송파구", manager: "최도영", birth: "1992.07.23", history: [{ date: "2026.06.01", type: "휴직", detail: "육아휴직" }, { date: "2023.02.06", type: "입사", detail: "데이터팀 선임 입사" }] },
  { id: "PF-2022-041", name: "박지훈", department: "영업1팀", position: "책임", type: "정규직", joinDate: "2022.04.11", status: "재직", email: "jihoon.park@peopleflow.co.kr", phone: "010-7182-4491", address: "서울특별시 영등포구", manager: "강현석", birth: "1988.02.17", history: [{ date: "2024.07.01", type: "승진", detail: "선임에서 책임으로 승진" }, { date: "2022.04.11", type: "입사", detail: "영업1팀 선임 입사" }] },
  { id: "PF-2025-111", name: "송예린", department: "영업1팀", position: "매니저", type: "정규직", joinDate: "2025.01.13", status: "재직", email: "yerin.song@peopleflow.co.kr", phone: "010-9056-3820", address: "서울특별시 마포구", manager: "강현석", birth: "1995.09.30", history: [{ date: "2025.01.13", type: "입사", detail: "영업1팀 매니저 입사" }] },
  { id: "PF-2024-101", name: "이서연", department: "브랜드팀", position: "매니저", type: "정규직", joinDate: "2024.11.18", status: "재직", email: "seoyeon.lee@peopleflow.co.kr", phone: "010-4218-9033", address: "서울특별시 서대문구", manager: "김나영", birth: "1994.05.12", history: [{ date: "2024.11.18", type: "입사", detail: "브랜드팀 매니저 입사" }] },
  { id: "PF-2025-119", name: "임채원", department: "브랜드팀", position: "사원", type: "정규직", joinDate: "2025.08.18", status: "재직", email: "chaewon.lim@peopleflow.co.kr", phone: "010-5182-6607", address: "서울특별시 강서구", manager: "김나영", birth: "1998.12.09", history: [{ date: "2025.08.18", type: "입사", detail: "브랜드팀 사원 입사" }] },
  { id: "PF-2026-127", name: "최유진", department: "경영지원팀", position: "사원", type: "계약직", joinDate: "2026.07.20", status: "수습", email: "yujin.choi@peopleflow.co.kr", phone: "010-3328-7110", address: "서울특별시 동작구", manager: "김태호", birth: "1999.01.25", history: [{ date: "2026.07.20", type: "입사", detail: "경영지원팀 계약직 입사" }] },
  { id: "PF-2021-022", name: "김태호", department: "경영지원팀", position: "팀장", type: "정규직", joinDate: "2021.09.01", status: "재직", email: "taeho.kim@peopleflow.co.kr", phone: "010-6291-0382", address: "서울특별시 용산구", manager: "이정민", birth: "1985.03.16", history: [{ date: "2023.01.01", type: "발령", detail: "경영지원팀 팀장 발령" }, { date: "2021.09.01", type: "입사", detail: "재무팀 책임 입사" }] },
];

const payrollPeople = [
  ["PF-2026-128", "김민준", "제품개발팀", "₩4,800,000", "₩420,000", "₩612,000", "₩4,608,000"],
  ["PF-2024-092", "정우진", "제품개발팀", "₩6,200,000", "₩550,000", "₩808,000", "₩5,942,000"],
  ["PF-2022-041", "박지훈", "영업1팀", "₩5,900,000", "₩1,120,000", "₩894,000", "₩6,126,000"],
  ["PF-2025-111", "송예린", "영업1팀", "₩4,300,000", "₩780,000", "₩644,000", "₩4,436,000"],
  ["PF-2024-101", "이서연", "브랜드팀", "₩4,700,000", "₩360,000", "₩631,000", "₩4,429,000"],
  ["PF-2026-127", "최유진", "경영지원팀", "₩3,100,000", "₩200,000", "₩388,000", "₩2,912,000"],
];

const initialApplicants: Applicant[] = [
  { id: "AP-084", name: "윤서진", role: "백엔드 개발자", applied: "08.09", owner: "김지수", stage: "서류 검토", experience: "5년 2개월", email: "seojin.yoon@email.com", phone: "010-4382-1102", source: "원티드", summary: "대규모 트래픽 백엔드와 결제 시스템 구축 경험. Kotlin·Spring 기반 서비스 운영 경험 보유." },
  { id: "AP-083", name: "한도윤", role: "프로덕트 디자이너", applied: "08.08", owner: "이수민", stage: "과제 검토", experience: "4년 8개월", email: "doyoon.han@email.com", phone: "010-9192-3370", source: "링크드인", summary: "B2B SaaS 제품 설계와 디자인 시스템 구축 경험. 리서치부터 프로토타이핑까지 수행." },
  { id: "AP-082", name: "송예린", role: "B2B 영업", applied: "08.07", owner: "김지수", stage: "처우 협의", experience: "6년", email: "yerin.song@email.com", phone: "010-5047-2201", source: "직원 추천", summary: "엔터프라이즈 고객 대상 솔루션 영업 및 파이프라인 관리 경험." },
  { id: "AP-081", name: "문지후", role: "데이터 분석가", applied: "08.06", owner: "박서준", stage: "서류 검토", experience: "3년 4개월", email: "jihoo.moon@email.com", phone: "010-7285-9044", source: "자사 채용페이지", summary: "SQL·Python 기반 제품 지표 분석과 대시보드 구축 경험." },
  { id: "AP-080", name: "배하린", role: "HR 매니저", applied: "08.05", owner: "이수민", stage: "서류 검토", experience: "5년", email: "harin.bae@email.com", phone: "010-8814-3155", source: "잡코리아", summary: "채용 운영, 평가제도 개선, HR 데이터 분석 프로젝트 경험." },
];

const initialInterviews: InterviewRow[] = [
  { id: "IV-101", time: "오늘 10:30", name: "이현우", role: "프론트엔드 개발자", type: "1차 화상", interviewers: "정우진 외 1명", status: "진행 완료" },
  { id: "IV-102", time: "오늘 14:00", name: "윤서진", role: "백엔드 개발자", type: "2차 대면", interviewers: "최도영 외 2명", status: "예정" },
  { id: "IV-103", time: "오늘 16:30", name: "임채원", role: "콘텐츠 마케터", type: "1차 화상", interviewers: "이서연", status: "예정" },
  { id: "IV-104", time: "내일 11:00", name: "박시우", role: "재무 담당자", type: "1차 대면", interviewers: "김태호", status: "확정" },
];

function StatusPill({ value }: { value: string }) {
  const kind = value.includes("완료") || value.includes("재직") || value === "마감" ? "success" : value.includes("초과") || value.includes("휴직") ? "danger" : "pending";
  return <span className={`status-pill ${kind}`}>{value}</span>;
}

function PeopleFlowApp() {
  const [active, setActive] = useState("dashboard");
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [employeeModalOpen, setEmployeeModalOpen] = useState(false);
  const [applicantModalOpen, setApplicantModalOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [query, setQuery] = useState("");
  const [employeeCount, setEmployeeCount] = useState(128);
  const [employees, setEmployees] = useState(initialEmployees);
  const [applicants, setApplicants] = useState(initialApplicants);
  const [interviews, setInterviews] = useState(initialInterviews);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [selectedPayrollMonth, setSelectedPayrollMonth] = useState<string | null>(null);
  const [selectedApplicantId, setSelectedApplicantId] = useState<string | null>(null);
  const [interviewTarget, setInterviewTarget] = useState<Applicant | null>(null);
  const [personnelAction, setPersonnelAction] = useState<string | null>(null);
  const [resumeStatus, setResumeStatus] = useState<"idle" | "analyzing" | "done">("idle");
  const [applicantDraft, setApplicantDraft] = useState({ name: "", role: "", email: "", phone: "", experience: "", source: "직접 등록", summary: "" });

  const selectedEmployee = employees.find((employee) => employee.id === selectedEmployeeId) ?? null;
  const selectedApplicant = applicants.find((applicant) => applicant.id === selectedApplicantId) ?? null;
  const navLabel = navGroups.flatMap((group) => group.items).find((item) => item.id === active)?.label;
  const activeLabel = active === "settings" ? "환경설정" : navLabel ?? "통합 대시보드";
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

  function exportExcel() {
    let rows: string[][];
    if (active === "employees") rows = [["사번", "이름", "부서", "직급", "고용형태", "입사일", "상태"], ...employees.map((employee) => [employee.id, employee.name, employee.department, employee.position, employee.type, employee.joinDate, employee.status])];
    else if (active === "recruitment") rows = [["지원자", "지원 직무", "지원일", "담당자", "단계"], ...applicants.map((applicant) => [applicant.name, applicant.role, applicant.applied, applicant.owner, applicant.stage])];
    else if (active === "payroll" && selectedPayrollMonth) rows = [["사번", "이름", "부서", "기본급", "수당", "공제", "실지급액"], ...payrollPeople];
    else rows = moduleConfig ? [moduleConfig.columns, ...filteredRows] : [["항목", "값"], ["재직 인원", String(employeeCount)], ["입사 예정", "4"], ["면접 예정", String(interviews.length)]];
    const csv = "\ufeff" + rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activeLabel}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    showToast("현재 화면의 데이터를 내보냈습니다.");
  }

  function saveEmployee(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const newEmployee: Employee = {
      id: String(data.get("employeeId")), name: String(data.get("name")), email: String(data.get("email")), phone: String(data.get("phone")),
      department: String(data.get("department")), type: String(data.get("type")), joinDate: String(data.get("joinDate")).replaceAll("-", "."), position: String(data.get("position")),
      status: "재직", address: "미입력", manager: "미지정", birth: "미입력", history: [{ date: String(data.get("joinDate")).replaceAll("-", "."), type: "입사", detail: `${String(data.get("department"))} ${String(data.get("position"))} 입사` }],
    };
    setEmployees((value) => [...value, newEmployee]);
    setEmployeeCount((value) => value + 1);
    setEmployeeModalOpen(false);
    showToast("신규 직원이 인사기록카드에 등록되었습니다.");
  }

  function updateEmployee(id: string, patch: Partial<Employee>) {
    setEmployees((value) => value.map((employee) => employee.id === id ? { ...employee, ...patch } : employee));
    showToast("인사기록의 기본정보를 저장했습니다.");
  }

  function savePersonnelAction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEmployee || !personnelAction) return;
    const data = new FormData(event.currentTarget);
    const date = String(data.get("effectiveDate")).replaceAll("-", ".");
    const department = String(data.get("targetDepartment"));
    const position = String(data.get("targetPosition"));
    const note = String(data.get("note"));
    setEmployees((value) => value.map((employee) => {
      if (employee.id !== selectedEmployee.id) return employee;
      return {
        ...employee,
        department: personnelAction === "전보" ? department : employee.department,
        position: personnelAction === "발령" || personnelAction === "승진" ? position : employee.position,
        status: personnelAction === "전출" ? "전출 예정" : employee.status,
        history: [{ date, type: personnelAction, detail: note || `${department} ${position}` }, ...employee.history],
      };
    }));
    setPersonnelAction(null);
    showToast(`${personnelAction} 인사이력을 등록했습니다.`);
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

  function topPrimaryAction() {
    if (active === "employees") setEmployeeModalOpen(true);
    else if (active === "recruitment") setApplicantModalOpen(true);
    else showToast("새 업무 등록 화면을 열었습니다.");
  }

  const topPrimaryLabel = active === "recruitment" ? "지원자 등록" : active === "employees" ? "직원 등록" : "업무 등록";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><div className="brand-mark">P</div><div><strong>PEOPLEFLOW</strong><span>HR WORKSPACE</span></div></div>
        <nav className="main-nav" aria-label="주요 메뉴">
          {navGroups.map((group) => <div className="nav-group" key={group.title}><p>{group.title}</p>{group.items.map((item) => (
            <button type="button" key={item.id} className={`nav-item ${active === item.id ? "active" : ""}`} onClick={() => navigate(item.id)}><span className="nav-icon">{item.icon}</span><span>{item.label}</span>{item.badge && <em>{item.badge}</em>}</button>
          ))}</div>)}
        </nav>
        <div className="sidebar-footer">
          <button type="button" className={`settings-button ${active === "settings" ? "active" : ""}`} onClick={() => navigate("settings")}><span className="nav-icon">설</span>환경설정</button>
          <div className="user-card"><div className="avatar">김</div><div><strong>김지수</strong><span>HR 매니저</span></div><button type="button" aria-label="사용자 메뉴">•••</button></div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs"><span>XD NODE ERP</span><b>/</b><span>HR</span><b>/</b><strong>{activeLabel}</strong></div>
          <div className="top-actions">
            <label className="search-box"><span>⌕</span><input aria-label="통합 검색" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="직원, 지원자, 업무 검색" /><kbd>Ctrl K</kbd></label>
            <button type="button" className="icon-button" aria-label="알림센터 열기" onClick={() => setNotificationOpen((value) => !value)}><span>알림</span><i>{notifications.filter((item) => item.urgent).length}</i></button>
            <button type="button" className="outline-button" onClick={exportExcel}>엑셀 내보내기</button>
            <button type="button" className="primary-button" onClick={topPrimaryAction}>+ {topPrimaryLabel}</button>
          </div>
        </header>

        {active === "dashboard" && <Dashboard employeeCount={employeeCount} onNavigate={navigate} />}
        {active === "employees" && (selectedEmployee ? <EmployeeDetail employee={selectedEmployee} onBack={() => setSelectedEmployeeId(null)} onUpdate={updateEmployee} onPersonnelAction={setPersonnelAction} /> : <EmployeeDirectory employees={employees} query={query} onSelect={setSelectedEmployeeId} onAdd={() => setEmployeeModalOpen(true)} />)}
        {active === "payroll" && (selectedPayrollMonth ? <PayrollMonthDetail month={selectedPayrollMonth} onBack={() => setSelectedPayrollMonth(null)} /> : <PayrollOverview config={moduleConfigs.payroll} onSelectMonth={setSelectedPayrollMonth} />)}
        {active === "recruitment" && <RecruitmentView applicants={applicants} query={query} onAdd={() => setApplicantModalOpen(true)} onSelect={setSelectedApplicantId} onInterview={setInterviewTarget} onReject={(id) => { setApplicants((value) => value.map((applicant) => applicant.id === id ? { ...applicant, stage: "서류 탈락" } : applicant)); showToast("서류 탈락 처리했습니다."); }} />}
        {active === "interviews" && <InterviewManagement interviews={interviews} />}
        {active === "settings" && <SettingsView onSave={() => showToast("환경설정을 저장했습니다.")} />}
        {!["dashboard", "employees", "payroll", "recruitment", "interviews", "settings"].includes(active) && moduleConfig && <ModuleView config={moduleConfig} rows={filteredRows} query={query} onPrimary={() => showToast(`${moduleConfig.action} 기능을 열었습니다.`)} />}
      </main>

      {notificationOpen && <div className="notification-panel"><div className="panel-header"><div><p>NOTIFICATIONS</p><h2>알림센터</h2></div><button type="button" onClick={() => setNotificationOpen(false)} aria-label="닫기">×</button></div><div className="panel-filter"><button className="selected">전체 4</button><button>미처리 2</button><button>업무 알림</button></div><div className="notification-list">{notifications.map((item) => <button type="button" key={item.text} className="notification-item" onClick={() => showToast("관련 업무 화면으로 이동합니다.")}><span className={`notice-dot ${item.urgent ? "urgent" : ""}`}></span><div><b>{item.type}</b><p>{item.text}</p><small>{item.time}</small></div></button>)}</div><button type="button" className="panel-bottom" onClick={() => showToast("모든 알림을 읽음 처리했습니다.")}>모두 읽음으로 표시</button></div>}

      {employeeModalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setEmployeeModalOpen(false)}><form className="employee-modal" onSubmit={saveEmployee} onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p>NEW EMPLOYEE</p><h2>직원 등록</h2></div><button type="button" onClick={() => setEmployeeModalOpen(false)}>×</button></div><div className="form-grid"><label><span>이름 *</span><input required name="name" placeholder="홍길동" /></label><label><span>사번 *</span><input required name="employeeId" placeholder="PF-2026-129" /></label><label><span>이메일 *</span><input required name="email" type="email" placeholder="name@company.com" /></label><label><span>연락처</span><input name="phone" placeholder="010-0000-0000" /></label><label><span>소속 *</span><select required name="department" defaultValue=""><option value="" disabled>부서 선택</option><option>제품개발팀</option><option>영업1팀</option><option>브랜드팀</option><option>경영지원팀</option></select></label><label><span>고용형태 *</span><select required name="type"><option>정규직</option><option>계약직</option><option>인턴</option></select></label><label><span>입사일 *</span><input required name="joinDate" type="date" /></label><label><span>직급</span><select name="position"><option>사원</option><option>선임</option><option>책임</option><option>매니저</option><option>팀장</option></select></label></div><label className="form-note"><span>메모</span><textarea placeholder="입사 준비에 필요한 참고사항을 입력하세요."></textarea></label><div className="modal-actions"><button type="button" onClick={() => setEmployeeModalOpen(false)}>취소</button><button type="submit" className="primary-button">직원 등록</button></div></form></div>}

      {applicantModalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={() => setApplicantModalOpen(false)}><form className="employee-modal applicant-modal" onSubmit={saveApplicant} onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p>NEW APPLICANT</p><h2>지원자 등록</h2></div><button type="button" onClick={() => setApplicantModalOpen(false)}>×</button></div><div className={`resume-drop ${resumeStatus}`}><label><input type="file" accept=".pdf,.doc,.docx" onChange={(event) => parseResume(event.target.files?.[0])} /><span className="resume-icon">AI</span><div><strong>{resumeStatus === "analyzing" ? "이력서를 분석하고 있어요" : resumeStatus === "done" ? "AI 정보 추출 완료" : "이력서를 올리면 AI가 자동으로 입력합니다"}</strong><small>{resumeStatus === "done" ? "추출된 내용을 확인하고 필요한 부분을 수정하세요." : "PDF, DOC, DOCX · 직접 입력도 가능합니다."}</small></div><em>{resumeStatus === "analyzing" ? "분석 중…" : resumeStatus === "done" ? "다시 선택" : "파일 선택"}</em></label></div><div className="form-grid"><label><span>이름 *</span><input required value={applicantDraft.name} onChange={(event) => setApplicantDraft({ ...applicantDraft, name: event.target.value })} /></label><label><span>지원 직무 *</span><input required value={applicantDraft.role} onChange={(event) => setApplicantDraft({ ...applicantDraft, role: event.target.value })} /></label><label><span>이메일 *</span><input required type="email" value={applicantDraft.email} onChange={(event) => setApplicantDraft({ ...applicantDraft, email: event.target.value })} /></label><label><span>연락처</span><input value={applicantDraft.phone} onChange={(event) => setApplicantDraft({ ...applicantDraft, phone: event.target.value })} /></label><label><span>경력</span><input value={applicantDraft.experience} onChange={(event) => setApplicantDraft({ ...applicantDraft, experience: event.target.value })} /></label><label><span>지원 경로</span><select value={applicantDraft.source} onChange={(event) => setApplicantDraft({ ...applicantDraft, source: event.target.value })}><option>직접 등록</option><option>원티드</option><option>잡코리아</option><option>링크드인</option><option>직원 추천</option><option>이력서 AI 추출</option></select></label></div><label className="form-note"><span>경력 요약</span><textarea value={applicantDraft.summary} onChange={(event) => setApplicantDraft({ ...applicantDraft, summary: event.target.value })} placeholder="주요 경력과 역량을 입력하세요."></textarea></label><div className="modal-actions"><button type="button" onClick={() => setApplicantModalOpen(false)}>취소</button><button type="submit" className="primary-button">지원자 등록</button></div></form></div>}

      {selectedApplicant && <ApplicantDetail applicant={selectedApplicant} onClose={() => setSelectedApplicantId(null)} onInterview={() => { setSelectedApplicantId(null); setInterviewTarget(selectedApplicant); }} />}
      {interviewTarget && <InterviewScheduleModal applicant={interviewTarget} onClose={() => setInterviewTarget(null)} onSubmit={scheduleInterview} />}
      {personnelAction && selectedEmployee && <PersonnelActionModal employee={selectedEmployee} action={personnelAction} onClose={() => setPersonnelAction(null)} onSubmit={savePersonnelAction} />}
      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </div>
  );
}

function EmployeeDirectory({ employees, query, onSelect, onAdd }: { employees: Employee[]; query: string; onSelect: (id: string) => void; onAdd: () => void }) {
  const departments = Array.from(new Set(employees.map((employee) => employee.department)));
  const [expanded, setExpanded] = useState<string[]>(departments);
  const visibleEmployees = query ? employees.filter((employee) => Object.values(employee).some((value) => typeof value === "string" && value.toLowerCase().includes(query.toLowerCase()))) : employees;
  const toggle = (department: string) => setExpanded((value) => value.includes(department) ? value.filter((item) => item !== department) : [...value, department]);
  return <div className="page-wrap module-page">
    <section className="module-hero"><div><p className="eyebrow">PEOPLE DIRECTORY</p><h1>인사기록카드</h1><p>전체 구성원을 부서별로 확인하고 개인 인사기록을 관리합니다.</p></div><button type="button" className="primary-button" onClick={onAdd}>+ 직원 등록</button></section>
    <section className="metric-grid module-metrics">
      {[{ label: "전체 재직자", value: "128명", note: "지난달 대비 +3" }, { label: "조직", value: "4개", note: "팀 단위 표시", tone: "blue" }, { label: "이번 달 입사", value: "4명", note: "입사 예정 2명", tone: "green" }, { label: "정보 확인 필요", value: "6명", note: "필수항목 미완료", tone: "red" }].map((metric) => <div className="compact-metric" key={metric.label}><span className={`metric-accent ${metric.tone ?? "navy"}`}></span><p>{metric.label}</p><h2>{metric.value}</h2><small>{metric.note}</small></div>)}
    </section>
    <div className="directory-toolbar"><div><h2>전체 현황</h2><span>총 128명 · 부서별 접기/펼치기</span></div><div><button type="button" onClick={() => setExpanded(departments)}>모두 펼치기</button><button type="button" onClick={() => setExpanded([])}>모두 접기</button></div></div>
    <div className="department-list">
      {departments.map((department) => {
        const people = visibleEmployees.filter((employee) => employee.department === department);
        if (query && people.length === 0) return null;
        const quota = department === "제품개발팀" ? 50 : department === "영업1팀" ? 38 : department === "브랜드팀" ? 28 : 26;
        return <section className="panel department-panel" key={department}>
          <button type="button" className="department-heading" onClick={() => toggle(department)} aria-expanded={expanded.includes(department)}><span className={`chevron ${expanded.includes(department) ? "open" : ""}`}>›</span><div><strong>{department}</strong><small>재직 {people.length}명 · 승인 정원 {quota}명</small></div><span className="dept-progress"><i style={{ width: `${Math.min(92, 68 + people.length * 3)}%` }}></i></span><em>{expanded.includes(department) ? "접기" : "펼치기"}</em></button>
          {expanded.includes(department) && <div className="data-table-wrap"><table className="data-table employee-table"><thead><tr><th>직원</th><th>사번</th><th>직급</th><th>고용형태</th><th>입사일</th><th>직속 리더</th><th>상태</th></tr></thead><tbody>{people.map((employee) => <tr key={employee.id}><td><button type="button" className="name-link" onClick={() => onSelect(employee.id)}><span>{employee.name.slice(0, 1)}</span>{employee.name}</button></td><td>{employee.id}</td><td>{employee.position}</td><td>{employee.type}</td><td>{employee.joinDate}</td><td>{employee.manager}</td><td><StatusPill value={employee.status} /></td></tr>)}</tbody></table></div>}
        </section>;
      })}
    </div>
  </div>;
}

function EmployeeDetail({ employee, onBack, onUpdate, onPersonnelAction }: { employee: Employee; onBack: () => void; onUpdate: (id: string, patch: Partial<Employee>) => void; onPersonnelAction: (action: string) => void }) {
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onUpdate(employee.id, { email: String(data.get("email")), phone: String(data.get("phone")), address: String(data.get("address")), manager: String(data.get("manager")), type: String(data.get("type")) });
  }
  return <div className="page-wrap detail-page">
    <button type="button" className="back-button" onClick={onBack}>← 전체 인사기록</button>
    <section className="profile-hero panel"><div className="profile-avatar">{employee.name.slice(0, 1)}</div><div className="profile-copy"><p>{employee.id}</p><h1>{employee.name}</h1><div><span>{employee.department}</span><b>·</b><span>{employee.position}</span><b>·</b><StatusPill value={employee.status} /></div></div><div className="profile-actions"><button type="button" onClick={() => onPersonnelAction("전보")}>전보</button><button type="button" onClick={() => onPersonnelAction("전출")}>전출</button><button type="button" onClick={() => onPersonnelAction("발령")}>발령</button><button type="button" className="promote" onClick={() => onPersonnelAction("승진")}>승진</button></div></section>
    <div className="detail-grid">
      <form className="panel detail-card" onSubmit={submit}><div className="detail-card-heading"><div><p className="eyebrow">BASIC INFORMATION</p><h2>기본정보</h2></div><button type="submit" className="primary-button">변경사항 저장</button></div><div className="detail-form"><label><span>이름</span><input value={employee.name} disabled /></label><label><span>생년월일</span><input value={employee.birth} disabled /></label><label><span>이메일</span><input name="email" defaultValue={employee.email} /></label><label><span>연락처</span><input name="phone" defaultValue={employee.phone} /></label><label className="wide"><span>주소</span><input name="address" defaultValue={employee.address} /></label><label><span>고용형태</span><select name="type" defaultValue={employee.type}><option>정규직</option><option>계약직</option><option>인턴</option></select></label><label><span>직속 리더</span><input name="manager" defaultValue={employee.manager} /></label><label><span>입사일</span><input value={employee.joinDate} disabled /></label><label><span>현재 소속</span><input value={employee.department} disabled /></label></div></form>
      <aside className="panel detail-card history-card"><div className="detail-card-heading"><div><p className="eyebrow">HR HISTORY</p><h2>인사이력</h2></div><span>{employee.history.length}건</span></div><div className="history-list">{employee.history.map((item, index) => <div className="history-item" key={`${item.date}-${index}`}><span></span><div><strong>{item.type}</strong><p>{item.detail}</p><small>{item.date}</small></div></div>)}</div></aside>
    </div>
  </div>;
}

function PayrollOverview({ config, onSelectMonth }: { config: ModuleConfig; onSelectMonth: (month: string) => void }) {
  return <div className="page-wrap module-page"><section className="module-hero"><div><p className="eyebrow">PAYROLL</p><h1>급여관리</h1><p>급여월을 선택해 대상자별 지급·공제 내역을 확인합니다.</p></div><button type="button" className="primary-button">+ 8월 급여 계산</button></section><section className="metric-grid module-metrics">{config.metrics.map((metric) => <div className="compact-metric" key={metric.label}><span className={`metric-accent ${metric.tone ?? "navy"}`}></span><p>{metric.label}</p><h2>{metric.value}</h2><small>{metric.note}</small></div>)}</section><section className="panel table-panel"><div className="table-toolbar"><div><h2>급여월 현황</h2><span>급여월을 클릭하면 개인별 상세내역을 볼 수 있습니다.</span></div><div><button type="button">연도 2026</button><button type="button">필터</button></div></div><div className="data-table-wrap"><table className="data-table payroll-table"><thead><tr>{config.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{config.rows.map((row) => <tr key={row[0]} onClick={() => onSelectMonth(row[0])} tabIndex={0} onKeyDown={(event) => event.key === "Enter" && onSelectMonth(row[0])}>{row.map((cell, index) => <td key={cell}>{index === 0 ? <button type="button" className="month-link">{cell}<span>상세 보기 →</span></button> : index === row.length - 1 ? <StatusPill value={cell} /> : cell}</td>)}</tr>)}</tbody></table></div></section></div>;
}

function PayrollMonthDetail({ month, onBack }: { month: string; onBack: () => void }) {
  return <div className="page-wrap detail-page"><button type="button" className="back-button" onClick={onBack}>← 급여월 현황</button><section className="module-hero"><div><p className="eyebrow">MONTHLY PAYROLL DETAIL</p><h1>{month} 급여 상세</h1><p>대상자별 기본급, 수당, 공제와 실지급액을 확인합니다.</p></div><div className="welcome-actions"><button type="button" className="outline-button">급여명세서 일괄 발급</button><button type="button" className="primary-button">급여 마감</button></div></section><section className="payroll-summary"><div><span>급여 대상</span><strong>128명</strong><small>변동자 12명</small></div><div><span>지급총액</span><strong>₩684,200,000</strong><small>기본급 + 수당</small></div><div><span>공제총액</span><strong>₩86,480,000</strong><small>세금 · 보험 · 기타</small></div><div><span>실지급액</span><strong>₩597,720,000</strong><small>검토 대기 8건</small></div></section><section className="panel table-panel"><div className="table-toolbar"><div><h2>개인별 급여 내역</h2><span>표시 6명 · 전체 128명</span></div><div><button type="button">변동자만</button><button type="button">오류 2건</button></div></div><div className="data-table-wrap"><table className="data-table payroll-detail-table"><thead><tr>{["사번", "직원", "부서", "기본급", "수당", "공제", "실지급액", "상태"].map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{payrollPeople.map((row, index) => <tr key={row[0]}>{row.map((cell, cellIndex) => <td key={cell}>{cell}</td>)}<td><StatusPill value={index === 2 ? "확인 필요" : "검토 완료"} /></td></tr>)}</tbody></table></div></section></div>;
}

function RecruitmentView({ applicants, query, onAdd, onSelect, onInterview, onReject }: { applicants: Applicant[]; query: string; onAdd: () => void; onSelect: (id: string) => void; onInterview: (applicant: Applicant) => void; onReject: (id: string) => void }) {
  const visible = query ? applicants.filter((applicant) => Object.values(applicant).some((value) => value.toLowerCase().includes(query.toLowerCase()))) : applicants;
  return <div className="page-wrap module-page"><section className="module-hero"><div><p className="eyebrow">RECRUITING PIPELINE</p><h1>지원자 관리</h1><p>진행 중인 채용공고의 지원자를 확인하고 다음 단계를 처리합니다.</p></div><button type="button" className="primary-button" onClick={onAdd}>+ 지원자 등록</button></section><section className="metric-grid module-metrics">{[{ label: "진행 중 공고", value: "6건", note: "신규 2건" }, { label: "지원 현황", value: `${applicants.length}명`, note: "이번 주 +18", tone: "blue" }, { label: "면접 예정", value: `${applicants.filter((item) => item.stage.includes("면접")).length + 9}명`, note: "오늘 3명", tone: "orange" }, { label: "처우 협의", value: "3명", note: "최종 조율 중", tone: "green" }].map((metric) => <div className="compact-metric" key={metric.label}><span className={`metric-accent ${metric.tone ?? "navy"}`}></span><p>{metric.label}</p><h2>{metric.value}</h2><small>{metric.note}</small></div>)}</section><section className="panel table-panel"><div className="table-toolbar"><div><h2>지원 현황</h2><span>진행 중 공고의 전체 지원자 {visible.length}명</span></div><div><button type="button">공고 전체</button><button type="button">단계 필터</button></div></div><div className="data-table-wrap"><table className="data-table applicant-table"><thead><tr><th>지원자</th><th>지원 직무</th><th>지원일</th><th>경력</th><th>담당자</th><th>현재 단계</th><th>채용 처리</th></tr></thead><tbody>{visible.map((applicant) => <tr key={applicant.id}><td><button type="button" className="name-link" onClick={() => onSelect(applicant.id)}><span>{applicant.name.slice(0, 1)}</span>{applicant.name}</button></td><td>{applicant.role}</td><td>{applicant.applied}</td><td>{applicant.experience}</td><td>{applicant.owner}</td><td><StatusPill value={applicant.stage} /></td><td><div className="row-actions"><button type="button" className="interview-action" disabled={applicant.stage === "서류 탈락"} onClick={() => onInterview(applicant)}>면접 진행</button><button type="button" className="reject-action" disabled={applicant.stage === "서류 탈락"} onClick={() => onReject(applicant.id)}>서류 탈락</button></div></td></tr>)}</tbody></table></div></section></div>;
}

function InterviewManagement({ interviews }: { interviews: InterviewRow[] }) {
  return <div className="page-wrap module-page"><section className="module-hero"><div><p className="eyebrow">INTERVIEWS</p><h1>면접관리</h1><p>지원자 관리에서 면접 진행한 후보자의 일정과 평가를 관리합니다.</p></div><button type="button" className="primary-button">+ 면접 등록</button></section><section className="metric-grid module-metrics">{[{ label: "오늘 면접", value: `${interviews.filter((item) => item.time.includes("오늘")).length}건`, note: "대면 · 화상 포함" }, { label: "전체 예정", value: `${interviews.length}건`, note: "새 일정 즉시 반영", tone: "blue" }, { label: "평가 미제출", value: "4건", note: "면접관 알림 발송", tone: "orange" }, { label: "평균 합격률", value: "31%", note: "최근 3개월", tone: "green" }].map((metric) => <div className="compact-metric" key={metric.label}><span className={`metric-accent ${metric.tone ?? "navy"}`}></span><p>{metric.label}</p><h2>{metric.value}</h2><small>{metric.note}</small></div>)}</section><section className="panel table-panel"><div className="table-toolbar"><div><h2>면접 일정</h2><span>총 {interviews.length}건</span></div><div><button type="button">오늘</button><button type="button">이번 주</button></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>일시</th><th>지원자</th><th>직무</th><th>면접 유형</th><th>면접관</th><th>상태</th></tr></thead><tbody>{interviews.map((item) => <tr key={item.id}><td>{item.time}</td><td>{item.name}</td><td>{item.role}</td><td>{item.type}</td><td>{item.interviewers}</td><td><StatusPill value={item.status} /></td></tr>)}</tbody></table></div></section></div>;
}

function ApplicantDetail({ applicant, onClose, onInterview }: { applicant: Applicant; onClose: () => void; onInterview: () => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><div className="applicant-detail-modal" onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p>APPLICANT PROFILE</p><h2>지원자 상세</h2></div><button type="button" onClick={onClose}>×</button></div><div className="applicant-profile"><div className="profile-avatar">{applicant.name.slice(0, 1)}</div><div><h2>{applicant.name}</h2><p>{applicant.role} · {applicant.experience}</p></div><StatusPill value={applicant.stage} /></div><div className="applicant-facts"><div><span>이메일</span><strong>{applicant.email}</strong></div><div><span>연락처</span><strong>{applicant.phone}</strong></div><div><span>지원일</span><strong>{applicant.applied}</strong></div><div><span>지원 경로</span><strong>{applicant.source}</strong></div><div><span>담당자</span><strong>{applicant.owner}</strong></div><div><span>지원자 ID</span><strong>{applicant.id}</strong></div></div><div className="resume-summary"><span>AI 경력 요약</span><p>{applicant.summary}</p><div><em>직무 적합도 86%</em><em>경력 요건 충족</em><em>핵심역량 4개</em></div></div><div className="modal-actions"><button type="button" onClick={onClose}>닫기</button><button type="button" className="primary-button" onClick={onInterview}>면접 진행</button></div></div></div>;
}

function InterviewScheduleModal({ applicant, onClose, onSubmit }: { applicant: Applicant; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><form className="employee-modal schedule-modal" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p>SCHEDULE INTERVIEW</p><h2>면접 일정 등록</h2></div><button type="button" onClick={onClose}>×</button></div><div className="candidate-banner"><span>{applicant.name.slice(0, 1)}</span><div><strong>{applicant.name}</strong><small>{applicant.role} · {applicant.experience}</small></div><em>{applicant.id}</em></div><div className="form-grid"><label><span>면접일 *</span><input required name="date" type="date" defaultValue="2026-08-12" /></label><label><span>시작 시간 *</span><input required name="time" type="time" defaultValue="14:00" /></label><label><span>면접 유형 *</span><select name="type"><option>1차 대면</option><option>1차 화상</option><option>2차 대면</option><option>컬처핏 인터뷰</option></select></label><label><span>면접관 *</span><input required name="interviewers" defaultValue="최도영 외 1명" /></label><label className="wide"><span>장소 또는 화상 링크</span><input name="location" placeholder="회의실 B 또는 화상회의 링크" /></label></div><label className="form-note"><span>면접관 전달사항</span><textarea placeholder="확인할 역량이나 질문을 입력하세요."></textarea></label><div className="modal-actions"><button type="button" onClick={onClose}>취소</button><button type="submit" className="primary-button">일정 등록 및 면접관리로 이동</button></div></form></div>;
}

function PersonnelActionModal({ employee, action, onClose, onSubmit }: { employee: Employee; action: string; onClose: () => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onClose}><form className="employee-modal personnel-modal" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}><div className="modal-header"><div><p>PERSONNEL ACTION</p><h2>{action} 등록</h2></div><button type="button" onClick={onClose}>×</button></div><div className="candidate-banner"><span>{employee.name.slice(0, 1)}</span><div><strong>{employee.name}</strong><small>{employee.department} · {employee.position}</small></div><em>{employee.id}</em></div><div className="form-grid"><label><span>시행일 *</span><input required name="effectiveDate" type="date" defaultValue="2026-09-01" /></label><label><span>인사 구분</span><input value={action} disabled /></label><label><span>대상 부서</span><select name="targetDepartment" defaultValue={employee.department}><option>제품개발팀</option><option>영업1팀</option><option>브랜드팀</option><option>경영지원팀</option><option>관계사 전출</option></select></label><label><span>발령 직급·직책</span><select name="targetPosition" defaultValue={employee.position}><option>사원</option><option>선임</option><option>책임</option><option>매니저</option><option>팀장</option></select></label></div><label className="form-note"><span>{action} 사유 및 내용</span><textarea name="note" placeholder={`${action} 사유와 주요 내용을 입력하세요.`}></textarea></label><div className="modal-actions"><button type="button" onClick={onClose}>취소</button><button type="submit" className="primary-button">{action} 등록</button></div></form></div>;
}

function SettingsView({ onSave }: { onSave: () => void }) {
  const [section, setSection] = useState("company");
  return <div className="page-wrap settings-page"><section className="module-hero"><div><p className="eyebrow">WORKSPACE SETTINGS</p><h1>환경설정</h1><p>회사 정보, 인사 기준, 알림과 접근 권한을 설정합니다.</p></div><button type="button" className="primary-button" onClick={onSave}>변경사항 저장</button></section><div className="settings-layout"><aside className="panel settings-nav">{[["company", "회사·조직 정보"], ["hr", "인사 기준정보"], ["notifications", "알림 설정"], ["permissions", "사용자·권한"], ["data", "데이터·백업"]].map(([id, label]) => <button type="button" className={section === id ? "active" : ""} key={id} onClick={() => setSection(id)}>{label}<span>›</span></button>)}</aside><section className="panel settings-content"><div className="detail-card-heading"><div><p className="eyebrow">{section.toUpperCase()}</p><h2>{section === "company" ? "회사·조직 정보" : section === "hr" ? "인사 기준정보" : section === "notifications" ? "알림 설정" : section === "permissions" ? "사용자·권한" : "데이터·백업"}</h2></div></div>{section === "company" && <div className="settings-form"><label><span>회사명</span><input defaultValue="피플플로우 주식회사" /></label><label><span>대표자</span><input defaultValue="이정민" /></label><label><span>사업자등록번호</span><input defaultValue="123-45-67890" /></label><label><span>기본 근무지</span><input defaultValue="서울 본사" /></label><label className="wide"><span>회사 주소</span><input defaultValue="서울특별시 성동구 아차산로 00" /></label></div>}{section === "hr" && <div className="setting-list"><SettingToggle title="사번 자동 발급" description="입사연도와 순번으로 사번을 자동 생성합니다." checked /><SettingToggle title="수습기간 종료 알림" description="종료 14일 전에 담당자와 부서장에게 알립니다." checked /><SettingToggle title="급여 마감 후 수정 제한" description="마감된 급여는 급여관리자만 다시 열 수 있습니다." checked /></div>}{section === "notifications" && <div className="setting-list"><SettingToggle title="시스템 알림" description="업무 마감과 승인 요청을 알림센터에서 받습니다." checked /><SettingToggle title="이메일 알림" description="중요 HR 일정을 이메일로도 받습니다." checked /><SettingToggle title="미처리 업무 재알림" description="기한이 지난 업무를 매일 오전 다시 알립니다." checked={false} /></div>}{section === "permissions" && <div className="permission-list"><div><span className="owner-chip">김</span><p><strong>김지수</strong><small>HR 매니저 · 전체 인사정보</small></p><em>관리자</em></div><div><span className="owner-chip">이</span><p><strong>이수민</strong><small>채용담당자 · 지원자/면접</small></p><em>편집자</em></div><div><span className="owner-chip">박</span><p><strong>박서준</strong><small>교육담당자 · 교육정보</small></p><em>편집자</em></div></div>}{section === "data" && <div className="data-settings"><div><strong>마지막 자동 백업</strong><span>오늘 03:00 · 정상 완료</span><button type="button" onClick={onSave}>지금 백업</button></div><div><strong>개인정보 보유기간</strong><span>퇴사 후 3년 · 관리자 확인 필요</span><button type="button">정책 관리</button></div><div><strong>엑셀 데이터 가져오기</strong><span>직원·급여·교육 표준양식 지원</span><button type="button">가져오기</button></div></div>}</section></div></div>;
}

function SettingToggle({ title, description, checked }: { title: string; description: string; checked: boolean }) {
  const [enabled, setEnabled] = useState(checked);
  return <button type="button" className="setting-toggle" onClick={() => setEnabled((value) => !value)}><div><strong>{title}</strong><span>{description}</span></div><i className={enabled ? "on" : ""}><em></em></i></button>;
}

function Dashboard({ employeeCount, onNavigate }: { employeeCount: number; onNavigate: (id: string) => void }) {
  const tasks = [
    { label: "개인정보보호 교육 미이수자 확인", meta: "교육 · 오늘 16:00", owner: "박서준", tone: "red" },
    { label: "8월 급여 변동사항 검토", meta: "급여 · 8월 14일 마감", owner: "김지수", tone: "orange" },
    { label: "상반기 목표 중간점검 독려", meta: "성과평가 · 7명 미제출", owner: "이수민", tone: "purple" },
    { label: "신규 입사자 계정 발급 요청", meta: "온보딩 · 8월 17일 입사", owner: "김지수", tone: "blue" },
  ];
  return (
    <div className="page-wrap dashboard-page">
      <section className="welcome-row">
        <div>
          <p className="eyebrow">MONDAY, AUGUST 10</p>
          <h1>좋은 아침이에요, 지수님.</h1>
          <p>오늘 처리할 HR 업무 <strong>8건</strong>과 확인이 필요한 알림 <strong>2건</strong>이 있습니다.</p>
        </div>
        <div className="welcome-actions">
          <button type="button" className="outline-button" onClick={() => onNavigate("reports")}>월간 리포트</button>
          <button type="button" className="primary-button" onClick={() => onNavigate("schedule")}>오늘 일정 보기</button>
        </div>
      </section>

      <section className="metric-grid">
        <button type="button" className="metric-card" onClick={() => onNavigate("employees")}>
          <div className="metric-top"><span className="metric-icon navy">인</span><em>+3 this month</em></div>
          <p>전체 재직자</p><h2>{employeeCount}<small>명</small></h2>
          <div className="mini-bar"><span style={{ width: "78%" }}></span></div>
          <small>승인 정원 142명 · 충원율 90.1%</small>
        </button>
        <button type="button" className="metric-card" onClick={() => onNavigate("recruitment")}>
          <div className="metric-top"><span className="metric-icon blue">채</span><em>6 positions</em></div>
          <p>채용 진행</p><h2>18<small>명</small></h2>
          <div className="stage-dots"><span></span><span></span><span></span><span></span><i></i></div>
          <small>면접 예정 9명 · 처우 협의 3명</small>
        </button>
        <button type="button" className="metric-card" onClick={() => onNavigate("performance")}>
          <div className="metric-top"><span className="metric-icon purple">목</span><em>D-2</em></div>
          <p>평가 제출률</p><h2>94<small>%</small></h2>
          <div className="mini-bar purple"><span style={{ width: "94%" }}></span></div>
          <small>111명 완료 · 7명 미제출</small>
        </button>
        <button type="button" className="metric-card" onClick={() => onNavigate("training")}>
          <div className="metric-top"><span className="metric-icon green">교</span><em>11 pending</em></div>
          <p>법정교육 이수율</p><h2>91<small>%</small></h2>
          <div className="mini-bar green"><span style={{ width: "91%" }}></span></div>
          <small>개인정보보호 교육 · 8월 13일 마감</small>
        </button>
      </section>

      <section className="dashboard-grid">
        <div className="panel work-panel">
          <div className="section-heading"><div><p className="eyebrow">MY WORK QUEUE</p><h2>오늘의 우선 업무</h2></div><button type="button" onClick={() => onNavigate("schedule")}>전체 업무 →</button></div>
          <div className="task-list">
            {tasks.map((task, index) => (
              <div className="task-row" key={task.label}>
                <button type="button" className="check-button" aria-label={`${task.label} 완료 처리`}></button>
                <span className={`task-marker ${task.tone}`}></span>
                <div className="task-copy"><strong>{task.label}</strong><small>{task.meta}</small></div>
                <div className="owner-chip">{task.owner.slice(0, 1)}</div>
                <button type="button" className="more-button" aria-label="업무 메뉴">•••</button>
              </div>
            ))}
          </div>
          <div className="queue-footer"><span><b>4</b> / 8 tasks completed</span><div><i style={{ width: "50%" }}></i></div><strong>50%</strong></div>
        </div>

        <div className="panel schedule-panel">
          <div className="section-heading"><div><p className="eyebrow">UPCOMING</p><h2>다가오는 일정</h2></div><button type="button" onClick={() => onNavigate("schedule")}>캘린더 →</button></div>
          <div className="date-strip"><button>10<span>월</span></button><button className="active">11<span>화</span></button><button>12<span>수</span></button><button>13<span>목</span></button><button>14<span>금</span></button></div>
          <div className="agenda-list">
            <div><time>10:30</time><span className="agenda-line blue"></span><p><strong>프론트엔드 1차 면접</strong><small>화상 · 이현우 지원자</small></p><em>면접</em></div>
            <div><time>14:00</time><span className="agenda-line purple"></span><p><strong>상반기 평가 운영 미팅</strong><small>회의실 B · HR팀</small></p><em>평가</em></div>
            <div><time>16:30</time><span className="agenda-line green"></span><p><strong>신규 입사자 온보딩</strong><small>김민준 외 1명</small></p><em>입사</em></div>
          </div>
        </div>

        <div className="panel workforce-panel">
          <div className="section-heading"><div><p className="eyebrow">HEADCOUNT</p><h2>조직별 인원 현황</h2></div><button type="button" onClick={() => onNavigate("workforce")}>정원 관리 →</button></div>
          <div className="headcount-chart">
            {[
              ["제품개발", "44", "50", "88%"], ["사업", "35", "38", "92%"], ["브랜드", "25", "28", "89%"], ["경영지원", "24", "26", "92%"]
            ].map(([label, current, quota, percent]) => (
              <div className="headcount-row" key={label}><span>{label}</span><div><i style={{ width: percent }}></i></div><strong>{current}<small> / {quota}</small></strong></div>
            ))}
          </div>
          <div className="headcount-summary"><div><span>현재 인원</span><strong>{employeeCount}</strong></div><div><span>승인 정원</span><strong>142</strong></div><div><span>충원 필요</span><strong className="accent">6</strong></div></div>
        </div>

        <div className="panel insights-panel">
          <div className="section-heading"><div><p className="eyebrow">PEOPLE INSIGHT</p><h2>이번 달 주요 변화</h2></div><button type="button" onClick={() => onNavigate("reports")}>분석 보기 →</button></div>
          <div className="donut-wrap">
            <div className="donut"><div><strong>128</strong><span>재직자</span></div></div>
            <ul><li><span className="legend navy"></span><p>정규직<strong>112명</strong></p></li><li><span className="legend blue"></span><p>계약직<strong>10명</strong></p></li><li><span className="legend pale"></span><p>인턴<strong>6명</strong></p></li></ul>
          </div>
          <div className="insight-note"><span>↗</span><p><strong>전년 동기 대비 인원이 12% 증가했어요.</strong><small>제품개발본부가 전체 증가의 58%를 차지합니다.</small></p></div>
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
