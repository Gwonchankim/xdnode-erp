"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import HRWorkspace from "./hr-workspace";
import FinanceOperationsCenter from "./finance-operations-center";
import PurchasingWorkspace from "./purchasing-workspace";
import CashReconciliationWorkspace from "./cash-reconciliation-workspace";
import CashForecastWorkspace from "./cash-forecast-workspace";
import FinanceCloseWorkspace from "./finance-close-workspace";
import BudgetActualWorkspace from "./budget-actual-workspace";
import SalesWorkspace from "./sales-workspace";
import ApprovalCenter from "./approval-center";
import { financeCurrentData } from "./finance-current-data";
import { financeHistoricalData } from "./finance-historical-data";

type ModuleKey = "finance" | "sales" | "hr";

type ERPAlert = {
  id: string;
  category: string;
  title: string;
  description: string;
  time: string;
  destination?: { module: ModuleKey; hrView?: string; financeView?: FinanceWorkspaceView };
};

type OperationTask = {
  id: string;
  module: string;
  category: string;
  title: string;
  description: string;
  ownerEmployeeId: string;
  dueDate: string;
  status: "OPEN" | "IN_PROGRESS" | "WAITING" | "DONE";
  priority: "LOW" | "NORMAL" | "HIGH" | "CRITICAL";
  destination: string;
  sourceType?: string;
};

const modules: Array<{
  key: ModuleKey;
  label: string;
  eyebrow: string;
  glyph: string;
}> = [
  { key: "finance", label: "재무회계", eyebrow: "Finance", glyph: "₩" },
  { key: "sales", label: "영업", eyebrow: "Sales", glyph: "↗" },
  { key: "hr", label: "HR", eyebrow: "People", glyph: "◎" },
];

const erpAlerts = [
  { id: "hr-profile", category: "HR", title: "필수 인사정보 확인 필요", description: "연락처·생년월일 등 필수항목이 비어 있는 직원 기록을 확인해 주세요.", time: "오늘", destination: { module: "hr", hrView: "employees" } },
  { id: "onboarding", category: "입·퇴사", title: "8월 신규 입사자 온보딩", description: "계정 발급, 자산 지급, 법정교육 체크리스트를 확인해 주세요.", time: "D-2", destination: { module: "hr", hrView: "employees" } },
  { id: "organization", category: "조직관리", title: "조직장 지정 상태 확인", description: "조직관리에서 조직장이 지정되지 않은 조직이 있는지 확인해 주세요.", time: "이번 주", destination: { module: "hr", hrView: "organization" } },
  { id: "finance-close", category: "재무", title: "2026년 분개장 점검", description: "분개장 차변과 대변 사이의 31,190원 차이를 확인해 주세요.", time: "확인 필요", destination: { module: "finance" } },
  { id: "sync-complete", category: "재무 데이터", title: "2024~2026년 재무 데이터 연결 완료", description: "2024·2025년 자료는 대사가 완료되었습니다. 2026년 분개장 차대변 31,190원과 2025년 중복 후보 32행은 원문 확인이 필요합니다.", time: "8월 14일", destination: { module: "finance" } },
  { id: "permission-applied", category: "권한", title: "사용자 권한 설정 적용", description: "김권찬 관리자 권한이 정상적으로 적용되었습니다.", time: "오늘" },
] satisfies ERPAlert[];

const financeChecks = [
  { label: "2024년 합계잔액시산표·재무상태표 대사", owner: "차대변·자산총계 일치", done: true },
  { label: "2025년 원장·시산표·자금현황 대사", owner: "27개 계정 전액 일치", done: true },
  { label: "2025년 분개장 15,510개 라인 반영", owner: "2025.01.02–12.31", done: true },
  { label: "은행 데이터 소스 11개 수집", owner: "Clobe · 정상", done: true },
  { label: "2026년 분개장 17,467개 라인 반영", owner: "2026.01.01–08.14", done: true },
  { label: "분개장 차대변 31,190원 차이 확인", owner: "재무 담당자", done: false },
  { label: "2025년 중복 후보 32행 원문 확인", owner: "자동 삭제하지 않음", done: false },
];

const cashTrend = [
  { date: "6/05", balance: 92151803 },
  { date: "6/12", balance: 110625598 },
  { date: "6/19", balance: 328227448 },
  { date: "6/26", balance: 98166115 },
  { date: "7/03", balance: 392253624 },
  { date: "7/10", balance: 368571497 },
  { date: "7/17", balance: 492885005 },
  { date: "7/24", balance: 1175979470 },
  { date: "7/31", balance: 1692218331 },
  { date: "8/07", balance: 2220797669 },
  { date: "8/14", balance: 1632647344 },
];

type FinancePeriod = "day" | "week" | "month" | "quarter";
type FinanceMetric = "cash" | "sales";
type FinanceWorkspaceView = "overview" | "control" | "purchasing" | "reconciliation" | "forecast" | "budget" | "close" | "commercial" | "receivables" | "statements" | "liquidity" | "quality";
type HistoricalMetric = "cashBalance" | "revenue" | "netIncome";
type ReceivableStatus = "UNSET" | "PLANNED" | "PARTIAL" | "OVERDUE" | "HOLD" | "COMPLETE";
type ReceivableManagementRecord = {
  partnerName: string;
  outstandingAmount: number;
  owner: string;
  dueDate: string;
  status: ReceivableStatus;
  memo: string;
  updatedAt?: number;
};

const receivableStatusLabels: Record<ReceivableStatus, string> = {
  UNSET: "확인 필요",
  PLANNED: "회수 예정",
  PARTIAL: "일부 회수",
  OVERDUE: "연체",
  HOLD: "분쟁·보류",
  COMPLETE: "회수 완료",
};

const financePeriodLabels: Record<FinancePeriod, string> = {
  day: "일",
  week: "주",
  month: "월",
  quarter: "분기",
};

const financeChartSeries: Record<FinanceMetric, Record<FinancePeriod, Array<{ label: string; value: number }>>> = {
  cash: {
    day: [
      { label: "8/01", value: 1692218331 },
      { label: "8/02", value: 1692218331 },
      { label: "8/03", value: 1857132856 },
      { label: "8/04", value: 2238650482 },
      { label: "8/05", value: 2189041634 },
      { label: "8/06", value: 2234967908 },
      { label: "8/07", value: 2220797669 },
      { label: "8/08", value: 2220797669 },
      { label: "8/09", value: 2220797669 },
      { label: "8/10", value: 1716273550 },
      { label: "8/11", value: 1746986430 },
      { label: "8/12", value: 1721282194 },
      { label: "8/13", value: 1632647344 },
      { label: "8/14", value: 1632647344 },
    ],
    week: cashTrend.map((item) => ({ label: item.date, value: item.balance })),
    month: [
      { label: "5월", value: 90193013 },
      { label: "6월", value: 1242819712 },
      { label: "7월", value: 1692218331 },
      { label: "8월", value: 1632647344 },
    ],
    quarter: [
      { label: "2분기", value: 1242819712 },
      { label: "3분기", value: 1632647344 },
    ],
  },
  sales: {
    day: [{ label: "6/01", value: 21510000 }],
    week: [{ label: "6/01주", value: 21510000 }],
    month: [
      { label: "1월", value: 0 }, { label: "2월", value: 0 }, { label: "3월", value: 0 },
      { label: "4월", value: 0 }, { label: "5월", value: 0 }, { label: "6월", value: 21510000 },
      { label: "7월", value: 0 }, { label: "8월", value: 0 },
    ],
    quarter: [
      { label: "1분기", value: 0 },
      { label: "2분기", value: 21510000 },
      { label: "3분기", value: 0 },
    ],
  },
};

const financeAlerts = [
  { level: "critical", label: "분류 필요", title: "계정 없는 출금 68.45억원", detail: "최근 31일 · 40건의 출금 계정을 확인하세요." },
  { level: "warning", label: "확인 필요", title: "계정 없는 입금 71.28억원", detail: "최근 31일 · 매출 또는 자금이동 여부를 구분하세요." },
  { level: "warning", label: "장부 점검", title: "차변·대변 31,190원 차이", detail: "2026년 분개장 마감 전 원인을 확인하세요." },
  { level: "info", label: "원문 확인", title: "2025년 중복 후보 32행", detail: "실제 반복 거래일 수 있어 자동 삭제하지 않고 원문 검토 대상으로 유지합니다." },
];

const financeDailyBrief = [
  "은행성 자산은 8월 7일 대비 5.88억원 감소해 16.33억원입니다.",
  "최근 31일 입금 149.67억원, 출금 133.86억원으로 순유입은 15.82억원입니다.",
  "외화 예금이 은행성 자산의 96.6%를 차지해 환율 변동 영향이 큽니다.",
  "미분류 입출금 139.73억원과 기타 영업비용 61.68억원을 우선 검토해야 합니다.",
];

const deals = [
  { company: "네오클라우드", rep: "김민준", stage: "계약검토", amount: "₩420M", due: "8/14", health: "good" },
  { company: "브릿지AI", rep: "박서연", stage: "견적", amount: "₩285M", due: "8/16", health: "good" },
  { company: "데이터포지", rep: "이도윤", stage: "원가확인", amount: "₩196M", due: "8/12", health: "warn" },
  { company: "오로라랩스", rep: "최유진", stage: "수금대기", amount: "₩148M", due: "8/09", health: "late" },
];

const incentiveRows = [
  { rep: "김민준", sales: "₩486M", margin: "11.8%", incentive: "₩1,652,400", status: "검토완료" },
  { rep: "박서연", sales: "₩392M", margin: "9.4%", incentive: "₩862,400", status: "대표확인" },
  { rep: "이도윤", sales: "₩344M", margin: "7.1%", incentive: "₩361,200", status: "원가확인" },
  { rep: "최유진", sales: "₩281M", margin: "4.8%", incentive: "₩0", status: "기준미달" },
];

const peopleRows = [
  { name: "김민준", role: "영업팀 · 책임", state: "재직", start: "2024.03.11", leave: "7.5일", flag: "" },
  { name: "박서연", role: "경영지원 · 매니저", state: "재직", start: "2025.01.06", leave: "4일", flag: "" },
  { name: "이도윤", role: "구매팀 · 매니저", state: "재직", start: "2025.07.31", leave: "-1일", flag: "minus" },
  { name: "최유진", role: "회계 · 주니어", state: "재직", start: "2025.11.03", leave: "1일", flag: "" },
  { name: "정하늘", role: "기술팀 · 엔지니어", state: "온보딩", start: "2026.08.17", leave: "-", flag: "new" },
];

const moduleCopy: Record<ModuleKey, { title: string; desc: string; action: string; search: string }> = {
  finance: {
    title: "2024년부터 오늘까지, 하나의 재무 흐름으로",
    desc: "이카운트 과거 원장과 Clobe 최신 데이터를 연결해 손익·자금·채권채무·장부 품질을 함께 확인합니다.",
    action: "자금일보 작성",
    search: "계좌, 거래처, 전표 검색",
  },
  sales: {
    title: "매출에서 인센티브까지 연결",
    desc: "영업 건의 원가 검증, 수금, 마진과 지급 예정 인센티브를 한 흐름으로 관리합니다.",
    action: "영업 건 등록",
    search: "거래처, 담당자, 영업 건 검색",
  },
  hr: {
    title: "사람의 변화를 놓치지 않게",
    desc: "입퇴사, 근태·연차, 급여와 법정 일정을 직원 단위로 이어서 관리합니다.",
    action: "구성원 등록",
    search: "이름, 조직, 인사기록 검색",
  },
};

function formatWon(value: number) {
  return new Intl.NumberFormat("ko-KR", {
    style: "currency",
    currency: "KRW",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatCompactWon(value: number) {
  const absolute = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (absolute >= 100_000_000) return `${sign}₩${(absolute / 100_000_000).toFixed(2)}억`;
  if (absolute >= 10_000) return `${sign}₩${(absolute / 10_000).toFixed(0)}만`;
  return formatWon(value);
}

function ERPTopNavigation({ active, onChange, onOpenAlert, openRequestKey = 0 }: { active: ModuleKey; onChange: (module: ModuleKey) => void; onOpenAlert: (alert: ERPAlert) => void; openRequestKey?: number }) {
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [approvalRequestKey, setApprovalRequestKey] = useState(0);
  const [operationTasks, setOperationTasks] = useState<OperationTask[]>([]);
  const [operationsLoading, setOperationsLoading] = useState(false);
  const [operationsError, setOperationsError] = useState("");
  const [dismissedAlertIds, setDismissedAlertIds] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const saved = window.localStorage.getItem("xdnode-dismissed-alerts");
      return saved ? JSON.parse(saved) as string[] : [];
    } catch {
      return [];
    }
  });
  const visibleAlerts = erpAlerts.filter((alert) => !dismissedAlertIds.includes(alert.id));
  const activeTasks = operationTasks.filter((task) => task.status !== "DONE");
  const notificationCount = activeTasks.length + visibleAlerts.length;

  useEffect(() => {
    if (openRequestKey > 0) setAlertsOpen(true);
  }, [openRequestKey]);

  useEffect(() => {
    if (!alertsOpen) return;
    let cancelled = false;
    setOperationsLoading(true);
    setOperationsError("");
    fetch("/api/operations")
      .then(async (response) => {
        const data = await response.json() as { tasks?: OperationTask[]; error?: string };
        if (!response.ok) throw new Error(data.error || "통합 업무를 불러오지 못했습니다.");
        if (!cancelled) setOperationTasks(data.tasks ?? []);
      })
      .catch((error: unknown) => {
        if (!cancelled) setOperationsError(error instanceof Error ? error.message : "통합 업무를 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!cancelled) setOperationsLoading(false);
      });
    return () => { cancelled = true; };
  }, [alertsOpen]);

  function dismissAlert(alertId: string) {
    setDismissedAlertIds((current) => {
      const next = current.includes(alertId) ? current : [...current, alertId];
      window.localStorage.setItem("xdnode-dismissed-alerts", JSON.stringify(next));
      return next;
    });
  }

  function openAlert(alert: ERPAlert) {
    if (!alert.destination) return;
    onOpenAlert(alert);
    setAlertsOpen(false);
  }

  function taskDestination(task: OperationTask): ERPAlert["destination"] {
    const [module, view] = task.destination.split(":");
    if (module === "finance") return { module: "finance", financeView: view as FinanceWorkspaceView };
    if (module === "hr") return { module: "hr", hrView: view || "dashboard" };
    if (module === "sales") return { module: "sales" };
    return undefined;
  }

  async function updateTask(task: OperationTask, status: OperationTask["status"]) {
    setOperationsError("");
    const response = await fetch("/api/operations", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: task.id, status, reason: status === "DONE" ? "알림 센터에서 완료 처리" : "알림 센터에서 처리 시작" }),
    });
    const data = await response.json() as { task?: OperationTask; error?: string };
    if (!response.ok || !data.task) {
      setOperationsError(data.error || "업무 상태를 변경하지 못했습니다.");
      return;
    }
    setOperationTasks((current) => current.map((item) => item.id === task.id ? data.task! : item));
  }

  function openTask(task: OperationTask) {
    if (task.destination === "approval:center") {
      setApprovalRequestKey((value) => value + 1);
      void updateTask(task, "IN_PROGRESS");
      setAlertsOpen(false);
      return;
    }
    const destination = taskDestination(task);
    if (destination) onOpenAlert({
      id: task.id,
      category: task.category,
      title: task.title,
      description: task.description,
      time: task.dueDate || "기한 없음",
      destination,
    });
    void updateTask(task, "IN_PROGRESS");
    setAlertsOpen(false);
  }

  return (
    <>
      <header className="erp-top-nav">
        <div className="erp-top-brand">
          <span className="brand-mark">XD</span>
          <div>
            <strong>XD NODE</strong>
            <small>OPERATIONS</small>
          </div>
        </div>

        <nav className="erp-module-tabs" aria-label="ERP 모듈">
          {modules.map((module) => (
            <button
              type="button"
              className={active === module.key ? "erp-module-tab active" : "erp-module-tab"}
              key={module.key}
              aria-current={active === module.key ? "page" : undefined}
              onClick={() => onChange(module.key)}
            >
              <span className="module-glyph">{module.glyph}</span>
              <span>
                <strong>{module.label}</strong>
                <small>{module.eyebrow}</small>
              </span>
            </button>
          ))}
        </nav>

        <div className="erp-nav-spacer" />
        <div className="erp-sync-state">
          <span className="status-dot" />
          <div><strong>Clobe · 2026 데이터</strong><small>8월 14일 수집</small></div>
        </div>
        <ApprovalCenter openRequestKey={approvalRequestKey} />
        <button
          type="button"
          className="erp-alarm-button"
          aria-label={`확인할 알람과 업무 ${notificationCount}건`}
          aria-expanded={alertsOpen}
          onClick={() => setAlertsOpen(true)}
        >
          <span className="erp-alarm-glyph" aria-hidden="true">♢</span>
          <span>알람</span>
          <em>{notificationCount}</em>
        </button>
      </header>

      {alertsOpen && (
        <>
          <button type="button" className="erp-alarm-backdrop" aria-label="알람 닫기" onClick={() => setAlertsOpen(false)} />
          <aside className="erp-alarm-panel" role="dialog" aria-modal="true" aria-label="확인할 알람">
            <div className="erp-alarm-panel-header">
              <div><p>OPERATIONS &amp; NOTIFICATIONS</p><h2>통합 업무함</h2></div>
              <button type="button" aria-label="닫기" onClick={() => setAlertsOpen(false)}>×</button>
            </div>
            <div className="erp-alarm-summary"><strong>처리할 업무 {activeTasks.length}건 · 일반 알림 {visibleAlerts.length}건</strong><span>실제 데이터에서 생성된 업무는 처리상태와 감사기록이 서버에 저장됩니다.</span></div>
            <div className="erp-alarm-list">
              {operationsLoading && <div className="erp-alarm-empty"><span>…</span><strong>통합 업무를 불러오는 중입니다.</strong></div>}
              {operationsError && <div className="erp-alarm-empty"><span>!</span><strong>{operationsError}</strong><p>기존 일반 알림은 계속 확인할 수 있습니다.</p></div>}
              {activeTasks.map((task) => (
                <article key={task.id} className={`erp-alarm-item operation-task priority-${task.priority.toLowerCase()}`}>
                  <span className="erp-alarm-unread" aria-hidden="true" />
                  <div>
                    <p><em>{task.category} · {task.priority}</em><time>{task.dueDate || "기한 없음"}</time></p>
                    <h3>{task.title}</h3><span>{task.description}</span>
                    <div className="operation-task-actions">
                      {task.destination && <button type="button" className="erp-alarm-action" onClick={() => openTask(task)}>관련 업무 열기 →</button>}
                      {task.sourceType !== "APPROVAL" && <button type="button" className="erp-alarm-dismiss" onClick={() => void updateTask(task, "DONE")}>완료 처리</button>}
                    </div>
                  </div>
                </article>
              ))}
              {visibleAlerts.map((alert) => (
                <article key={alert.id} className="erp-alarm-item">
                  <span className="erp-alarm-unread" aria-hidden="true" />
                  <div>
                    <p><em>{alert.category}</em><time>{alert.time}</time></p>
                    <h3>{alert.title}</h3><span>{alert.description}</span>
                    {alert.destination
                      ? <button type="button" className="erp-alarm-action" onClick={() => openAlert(alert)}>관련 화면에서 확인 →</button>
                      : <button type="button" className="erp-alarm-dismiss" onClick={() => dismissAlert(alert.id)}>확인 후 끄기</button>}
                  </div>
                </article>
              ))}
              {!operationsLoading && activeTasks.length === 0 && visibleAlerts.length === 0 && <div className="erp-alarm-empty"><span>✓</span><strong>모든 업무와 알람을 확인했습니다.</strong><p>새로운 확인 사항이 생기면 이곳에 표시됩니다.</p></div>}
            </div>
          </aside>
        </>
      )}
    </>
  );
}

export default function Home() {
  const [active, setActive] = useState<ModuleKey>("finance");
  const [hrNavigation, setHrNavigation] = useState({ view: "dashboard", requestKey: 0 });
  const [search, setSearch] = useState("");
  const [alertRequestKey, setAlertRequestKey] = useState(0);
  const [periodMenuOpen, setPeriodMenuOpen] = useState(false);
  const [financePeriod, setFinancePeriod] = useState<{ year: "2024" | "2025" | "2026"; label: string; requestKey: number }>({ year: "2026", label: "2026년 8월", requestKey: 0 });
  const [financeWorkspaceRequest, setFinanceWorkspaceRequest] = useState<{ view: FinanceWorkspaceView; requestKey: number }>({ view: "overview", requestKey: 0 });
  const [quickOpen, setQuickOpen] = useState(false);
  const [toast, setToast] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function focusSearch(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
      if (event.key === "Escape" && document.activeElement === searchInputRef.current) {
        setSearch("");
        searchInputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", focusSearch);
    return () => window.removeEventListener("keydown", focusSearch);
  }, []);

  const copy = moduleCopy[active];

  function openAlert(alert: ERPAlert) {
    if (!alert.destination) return;
    if (alert.destination.hrView) {
      setHrNavigation((current) => ({ view: alert.destination?.hrView ?? current.view, requestKey: current.requestKey + 1 }));
    }
    if (alert.destination.financeView) {
      setFinanceWorkspaceRequest((current) => ({ view: alert.destination?.financeView ?? current.view, requestKey: current.requestKey + 1 }));
    }
    setActive(alert.destination.module);
    setSearch("");
  }

  function saveQuick(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setQuickOpen(false);
    setToast(`${copy.action} 항목을 임시 저장했습니다.`);
    window.setTimeout(() => setToast(""), 3200);
  }

  function exportFinanceSnapshot() {
    const rows = [
      ["구분", "값", "기준일"],
      ["매출 공급가액", financeCurrentData.sourceSummary.salesSupplyValue, financeCurrentData.asOf],
      ["매입 공급가액", financeCurrentData.sourceSummary.purchaseSupplyValue, financeCurrentData.asOf],
      ["매출 세금계산서", financeCurrentData.sourceSummary.salesInvoices, financeCurrentData.asOf],
      ["매입 세금계산서", financeCurrentData.sourceSummary.purchaseInvoices, financeCurrentData.asOf],
      ...financeCurrentData.accounts.map((account) => [`계좌 · ${account.name} (${account.last4})`, account.krwBalance, financeCurrentData.asOf]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `XD_NODE_재무현황_${financeCurrentData.asOf}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    setToast("현재 재무현황을 CSV 파일로 내보냈습니다.");
    window.setTimeout(() => setToast(""), 3200);
  }

  function selectFinancePeriod(year: "2024" | "2025" | "2026", label: string) {
    setFinancePeriod((current) => ({ year, label, requestKey: current.requestKey + 1 }));
    setPeriodMenuOpen(false);
    setActive("finance");
  }

  function requestFinanceWorkspace(view: FinanceWorkspaceView) {
    setActive("finance");
    setFinanceWorkspaceRequest((current) => ({ view, requestKey: current.requestKey + 1 }));
  }

  if (active === "hr") {
    return (
      <div className="hr-module-shell">
        <ERPTopNavigation active={active} onChange={(module) => { setActive(module); setSearch(""); }} onOpenAlert={openAlert} openRequestKey={alertRequestKey} />
        <HRWorkspace requestedView={hrNavigation.view} navigationRequestKey={hrNavigation.requestKey} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <ERPTopNavigation active={active} onChange={(module) => { setActive(module); setSearch(""); }} onOpenAlert={openAlert} openRequestKey={alertRequestKey} />

      <main className={`main ${active === "finance" ? "finance-main" : ""}`}>
        {active !== "finance" && <header className="topbar">
          <div className="mobile-brand">XD NODE</div>
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              ref={searchInputRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={copy.search}
              aria-label={copy.search}
            />
            {search && <button type="button" className="search-clear" aria-label="검색어 지우기" onClick={() => { setSearch(""); searchInputRef.current?.focus(); }}>×</button>}
            <kbd>⌘ K</kbd>
          </label>
          <div className="top-actions">
            <div className="period-picker">
              <button type="button" className="period-button" aria-expanded={periodMenuOpen} onClick={() => setPeriodMenuOpen((open) => !open)}>{active === "finance" ? financePeriod.label : "2026년 8월"} <span>⌄</span></button>
              {periodMenuOpen && <div className="period-menu" role="menu" aria-label="재무 조회 기간">
                <button type="button" className={financePeriod.year === "2026" ? "active" : ""} onClick={() => selectFinancePeriod("2026", "2026년 8월")}><strong>2026년 8월</strong><small>Clobe 최신 스냅샷</small></button>
                <button type="button" className={financePeriod.year === "2025" ? "active" : ""} onClick={() => selectFinancePeriod("2025", "2025년 결산")}><strong>2025년 결산</strong><small>이카운트 확정 자료</small></button>
                <button type="button" className={financePeriod.year === "2024" ? "active" : ""} onClick={() => selectFinancePeriod("2024", "2024년 결산")}><strong>2024년 결산</strong><small>이카운트 확정 자료</small></button>
              </div>}
            </div>
            <button type="button" className="icon-button" aria-label="알람 센터 열기" onClick={() => setAlertRequestKey((key) => key + 1)}>♢<span className="notification-ping" /></button>
          </div>
        </header>}

        <section className={`module-hero ${active}`}>
          <div>
            <p className="eyebrow">{modules.find((item) => item.key === active)?.eyebrow} workspace</p>
            <h1>{copy.title}</h1>
            <p>{copy.desc}</p>
          </div>
          <div className="hero-actions">
            <button type="button" className="secondary-button" onClick={active === "finance" ? exportFinanceSnapshot : () => { setToast("이 화면의 내보내기 기능은 준비 중입니다."); window.setTimeout(() => setToast(""), 3200); }}>내보내기</button>
            <button className="primary-button" onClick={() => setQuickOpen(true)}><span>＋</span>{copy.action}</button>
          </div>
        </section>

        {active !== "finance" && <div className="attention-strip">
          <span className="attention-icon">!</span>
          <div>
            <strong>월 마감 D-2</strong>
            <span>7월 매입고지단가 오류 14건과 미증빙 8건의 확인이 필요합니다.</span>
          </div>
          <button type="button" onClick={() => requestFinanceWorkspace("quality")}>재무 점검 보기 →</button>
        </div>}

        {active === "finance" && <FinanceDashboard search={search} requestedWorkspace={financeWorkspaceRequest.view} workspaceRequestKey={financeWorkspaceRequest.requestKey} requestedYear={financePeriod.year} yearRequestKey={financePeriod.requestKey} onOpenAlerts={() => setAlertRequestKey((key) => key + 1)} />}
        {active === "sales" && <SalesWorkspace search={search} />}
        {active === "hr" && <HrDashboard search={search} />}
      </main>

      {quickOpen && (
        <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={copy.action}>
          <button type="button" className="modal-click-catcher" aria-label="창 닫기" onClick={() => setQuickOpen(false)} />
          <form className="quick-modal" onSubmit={saveQuick}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Quick create</p>
                <h2>{copy.action}</h2>
              </div>
              <button type="button" aria-label="닫기" onClick={() => setQuickOpen(false)}>×</button>
            </div>
            <label>
              제목
              <input required placeholder={`${copy.action} 제목을 입력하세요`} />
            </label>
            <div className="form-row">
              <label>담당자<input placeholder="담당자 선택" /></label>
              <label>기준일<input type="date" defaultValue="2026-08-10" /></label>
            </div>
            <label>
              메모
              <textarea rows={4} placeholder="검토 배경이나 전달사항을 기록하세요" />
            </label>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={() => setQuickOpen(false)}>취소</button>
              <button className="primary-button" type="submit">임시 저장</button>
            </div>
          </form>
        </div>
      )}

      {toast && <div className="toast"><span>✓</span>{toast}</div>}
    </div>
  );
}

function FinanceBars({ data, currentLabel }: { data: Array<{ label: string; value: number }>; currentLabel?: string }) {
  const max = Math.max(1, ...data.map((item) => Math.abs(item.value)));
  return (
    <div className="finance-bar-stage">
      <div className="finance-grid-lines"><i /><i /><i /></div>
      <div className="finance-bars">
        {data.map((item, index) => (
          <div className="finance-bar-item" key={`${item.label}-${index}`}>
            <span
              className={`bar ${item.value < 0 ? "negative" : ""} ${currentLabel === item.label || (!currentLabel && index === data.length - 1) ? "current" : ""}`}
              title={`${item.label} · ${formatWon(item.value)}`}
              style={{ height: `${item.value === 0 ? 2 : Math.max(8, (Math.abs(item.value) / max) * 100)}%` }}
            />
            <small>{item.label}</small>
          </div>
        ))}
      </div>
    </div>
  );
}

function aggregateCommercialRows(
  rows: ReadonlyArray<{ date: string; partner: string; amount: number; count: number }>,
  startDate: string,
  endDate: string,
  search: string,
) {
  const grouped = new Map<string, { partner: string; amount: number; count: number }>();
  for (const row of rows) {
    if (row.date < startDate || row.date > endDate) continue;
    if (search && !row.partner.toLowerCase().includes(search.toLowerCase())) continue;
    const current = grouped.get(row.partner) ?? { partner: row.partner, amount: 0, count: 0 };
    current.amount += row.amount;
    current.count += row.count;
    grouped.set(row.partner, current);
  }
  return [...grouped.values()].filter((row) => row.amount !== 0).sort((a, b) => b.amount - a.amount);
}

function accountBankName(code: string) {
  return ({ "004": "KB국민", "011": "NH농협", "020": "우리", "088": "신한" } as Record<string, string>)[code] ?? "은행";
}

function FinanceDashboard({ search, requestedWorkspace, workspaceRequestKey, requestedYear, yearRequestKey, onOpenAlerts }: {
  search: string;
  requestedWorkspace: FinanceWorkspaceView;
  workspaceRequestKey: number;
  requestedYear: "2024" | "2025" | "2026";
  yearRequestKey: number;
  onOpenAlerts: () => void;
}) {
  const [workspace, setWorkspace] = useState<FinanceWorkspaceView>("overview");
  const [overviewYear, setOverviewYear] = useState<"2024" | "2025" | "2026">("2026");
  const [statementYear, setStatementYear] = useState<"2024" | "2025">("2025");
  const [period, setPeriod] = useState<FinancePeriod>("week");
  const [metric, setMetric] = useState<FinanceMetric>("cash");
  const [historicalMetric, setHistoricalMetric] = useState<HistoricalMetric>("revenue");
  const [exposureType, setExposureType] = useState<"receivables" | "payables">("receivables");
  const [liquidityMetric, setLiquidityMetric] = useState<"cash" | "ar" | "ap">("cash");
  const [commercialStartDate, setCommercialStartDate] = useState("2026-01-01");
  const [commercialEndDate, setCommercialEndDate] = useState(financeCurrentData.asOf);
  const [receivableRecords, setReceivableRecords] = useState<Record<string, ReceivableManagementRecord>>({});
  const [receivablesLoaded, setReceivablesLoaded] = useState(false);
  const [receivableLoading, setReceivableLoading] = useState(false);
  const [receivableDraft, setReceivableDraft] = useState<ReceivableManagementRecord | null>(null);
  const [receivableMessage, setReceivableMessage] = useState("");
  const [assistantQuestion, setAssistantQuestion] = useState("");
  const [assistantAnswer, setAssistantAnswer] = useState("2024~2026년 재무 데이터 범위와 출처를 구분해 답변합니다. 궁금한 항목을 선택하거나 질문을 입력해 주세요.");
  const [assistantStatus, setAssistantStatus] = useState<"idle" | "loading" | "error">("idle");

  useEffect(() => {
    if (workspaceRequestKey > 0) {
      setWorkspace(requestedWorkspace);
      if (requestedWorkspace === "receivables") void loadReceivableRecords();
    }
  }, [requestedWorkspace, workspaceRequestKey]);

  useEffect(() => {
    if (yearRequestKey > 0) {
      setOverviewYear(requestedYear);
      setWorkspace("overview");
    }
  }, [requestedYear, yearRequestKey]);

  const selectedHistorical = statementYear === "2024" ? financeHistoricalData.years["2024"] : financeHistoricalData.years["2025"];
  const trialBalanceSource = statementYear === "2024" ? financeHistoricalData.trialBalance2024 : financeHistoricalData.trialBalance2025;
  const trialBalance = trialBalanceSource.filter((row) => `${row.code} ${row.name}`.toLowerCase().includes(search.toLowerCase()));
  const historicalOverview = overviewYear === "2024" ? financeHistoricalData.years["2024"] : financeHistoricalData.years["2025"];
  const exposureRows = exposureType === "receivables" ? financeHistoricalData.receivables : financeHistoricalData.payables;
  const exposureExceptions = exposureType === "receivables" ? financeHistoricalData.receivableExceptions : financeHistoricalData.payableExceptions;
  const grossProfit = selectedHistorical.revenue - selectedHistorical.cogs;
  const grossMargin = selectedHistorical.revenue ? (grossProfit / selectedHistorical.revenue) * 100 : 0;
  const commercialPeriodValid = commercialStartDate <= commercialEndDate;
  const commercialSalesRows = useMemo(
    () => commercialPeriodValid ? aggregateCommercialRows(financeCurrentData.salesDaily2026, commercialStartDate, commercialEndDate, search) : [],
    [commercialEndDate, commercialPeriodValid, commercialStartDate, search],
  );
  const commercialPurchaseRows = useMemo(
    () => commercialPeriodValid ? aggregateCommercialRows(financeCurrentData.purchaseDaily2026, commercialStartDate, commercialEndDate, search) : [],
    [commercialEndDate, commercialPeriodValid, commercialStartDate, search],
  );
  const selectedSalesTotal = commercialSalesRows.reduce((sum, row) => sum + row.amount, 0);
  const selectedPurchaseTotal = commercialPurchaseRows.reduce((sum, row) => sum + row.amount, 0);
  const selectedSalesCount = commercialSalesRows.reduce((sum, row) => sum + row.count, 0);
  const selectedPurchaseCount = commercialPurchaseRows.reduce((sum, row) => sum + row.count, 0);
  const currentSalesYtd = financeCurrentData.sourceSummary.salesSupplyValue;
  const elapsedDays2026 = 225;
  const projectedAnnualSales = Math.round((currentSalesYtd / elapsedDays2026) * 365);
  const priorYearSales = financeHistoricalData.years["2025"].revenue;
  const monthlySalesChart = financeCurrentData.salesMonthly2026.map((row) => ({
    label: `${Number(row.month.slice(5))}월`,
    value: row.amount,
  }));
  const managedReceivables = financeHistoricalData.receivables.map((row) => (
    receivableRecords[row.name] ?? {
      partnerName: row.name,
      outstandingAmount: row.ending,
      owner: "",
      dueDate: "",
      status: "UNSET" as ReceivableStatus,
      memo: "",
    }
  )).sort((a, b) => b.outstandingAmount - a.outstandingAmount);
  const receivableOutstandingTotal = managedReceivables.reduce((sum, row) => sum + row.outstandingAmount, 0);
  const receivableOverdueAmount = managedReceivables.reduce((sum, row) => (
    row.status !== "COMPLETE" && (row.status === "OVERDUE" || (row.dueDate && row.dueDate < financeCurrentData.asOf))
      ? sum + row.outstandingAmount
      : sum
  ), 0);
  const missingCollectionPlan = managedReceivables.filter((row) => row.status !== "COMPLETE" && !row.dueDate).length;
  const bankAssets = financeCurrentData.accountSummary.checkingBalanceSum + financeCurrentData.accountSummary.fxBalanceSumKrw;
  const bankLoans = financeCurrentData.accountSummary.loanBalanceSum;
  const liquidityCoverage = bankLoans ? bankAssets / bankLoans : 0;
  const fxConcentration = bankAssets ? financeCurrentData.accountSummary.fxBalanceSumKrw / bankAssets : 0;
  const lowBalanceAccounts = financeCurrentData.accounts.filter((row) => row.type === "CHECKING" && row.krwBalance < 100_000).length;
  const latestBankBalance = financeCurrentData.balanceTrend[0]?.balance ?? 0;
  const peakBankBalance = Math.max(...financeCurrentData.balanceTrend.map((row) => row.balance));
  const bankDrawdown = peakBankBalance ? (peakBankBalance - latestBankBalance) / peakBankBalance : 0;
  const accountRiskScore = Math.min(100,
    (liquidityCoverage < 1 ? 25 : liquidityCoverage < 1.25 ? 12 : 0)
    + (fxConcentration > .7 ? 20 : fxConcentration > .4 ? 10 : 0)
    + (financeCurrentData.accountSummary.checkingBalanceSum < 300_000_000 ? 15 : 0)
    + (lowBalanceAccounts >= 3 ? 10 : 0)
    + (bankDrawdown > .2 ? 10 : 0)
  );
  const accountRiskLevel = accountRiskScore >= 60 ? "높음" : accountRiskScore >= 30 ? "주의" : "안정";

  const historicalChartData = overviewYear === "2025"
    ? financeHistoricalData.monthly2025.map((item) => ({
        label: `${item.month}월`,
        value: historicalMetric === "cashBalance" ? item.cashBalance : item[historicalMetric],
      }))
    : ["2024", "2025"].map((year) => {
        const value = year === "2024" ? financeHistoricalData.years["2024"] : financeHistoricalData.years["2025"];
        return { label: year, value: historicalMetric === "cashBalance" ? value.cash : value[historicalMetric] };
      });
  const currentChartData = financeChartSeries[metric][period];
  const overviewChart = overviewYear === "2026" ? currentChartData : historicalChartData;
  const chartLast = overviewChart.at(-1)?.value ?? 0;
  const chartFirst = overviewChart[0]?.value ?? 0;
  const chartChange = chartFirst !== 0 ? ((chartLast - chartFirst) / Math.abs(chartFirst)) * 100 : 0;
  const liquidityChart = financeHistoricalData.monthly2025.map((item) => ({
    label: `${item.month}월`,
    value: liquidityMetric === "cash" ? item.cashBalance : liquidityMetric === "ar" ? item.arBalance : item.apBalance,
  }));

  async function loadReceivableRecords() {
    if (receivablesLoaded || receivableLoading) return;
    setReceivableLoading(true);
    setReceivableMessage("");
    try {
      const response = await fetch("/api/finance/receivables");
      const data = await response.json() as { records?: ReceivableManagementRecord[]; error?: string };
      if (!response.ok) throw new Error(data.error || "외상·미수 관리 기록을 불러오지 못했습니다.");
      const records = Object.fromEntries((data.records ?? []).map((record) => [record.partnerName, record]));
      setReceivableRecords(records);
      setReceivablesLoaded(true);
    } catch (error) {
      setReceivableMessage(error instanceof Error ? error.message : "외상·미수 관리 기록을 불러오지 못했습니다.");
    } finally {
      setReceivableLoading(false);
    }
  }

  function selectWorkspace(next: FinanceWorkspaceView) {
    setWorkspace(next);
    if (next === "receivables") void loadReceivableRecords();
  }

  function editReceivable(record: ReceivableManagementRecord) {
    setReceivableDraft({ ...record });
    setReceivableMessage("");
  }

  async function saveReceivable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!receivableDraft || receivableLoading) return;
    setReceivableLoading(true);
    setReceivableMessage("");
    try {
      const response = await fetch("/api/finance/receivables", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(receivableDraft),
      });
      const data = await response.json() as { record?: ReceivableManagementRecord; error?: string };
      if (!response.ok || !data.record) throw new Error(data.error || "회수 관리 기록을 저장하지 못했습니다.");
      setReceivableRecords((current) => ({ ...current, [data.record!.partnerName]: data.record! }));
      setReceivableDraft(data.record);
      setReceivableMessage("변경내용을 저장했습니다.");
    } catch (error) {
      setReceivableMessage(error instanceof Error ? error.message : "회수 관리 기록을 저장하지 못했습니다.");
    } finally {
      setReceivableLoading(false);
    }
  }

  async function askFinanceAssistant(question: string) {
    const cleanQuestion = question.trim();
    if (!cleanQuestion || assistantStatus === "loading") return;
    setAssistantQuestion(cleanQuestion);
    setAssistantStatus("loading");
    setAssistantAnswer("승인된 재무 데이터와 출처를 확인하고 있습니다…");
    try {
      const response = await fetch("/api/finance/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: cleanQuestion }),
      });
      const data = await response.json() as { answer?: string; error?: string; quotaExceeded?: boolean };
      if (!response.ok || !data.answer) {
        throw new Error(data.quotaExceeded ? "오늘의 AI 무료 사용 한도를 초과했습니다. 내일 다시 이용해 주세요." : data.error || "답변을 만들지 못했습니다.");
      }
      setAssistantAnswer(data.answer);
      setAssistantStatus("idle");
    } catch (error) {
      setAssistantStatus("error");
      setAssistantAnswer(error instanceof Error ? error.message : "재무 어시스턴트에 연결할 수 없습니다.");
    }
  }

  function submitAssistant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void askFinanceAssistant(assistantQuestion);
  }

  const historicalMetrics = overviewYear === "2026" ? null : [
    { label: "기말 자산", value: historicalOverview.assets, hint: "합계잔액시산표 기말잔액", trend: "neutral" as const },
    { label: "매출", value: historicalOverview.revenue, hint: overviewYear === "2025" ? "전년 대비 +95.8%" : "상품매출 기준", trend: overviewYear === "2025" ? "up" as const : "neutral" as const },
    { label: "당기순이익", value: historicalOverview.netIncome, hint: overviewYear === "2025" ? "전년 대비 -68.2%" : "결산후 기준", trend: overviewYear === "2025" ? "down" as const : "neutral" as const },
    { label: "기말 보통예금", value: historicalOverview.cash, hint: overviewYear === "2025" ? "전년 대비 +65.8%" : "자금현황표 대사 완료", trend: overviewYear === "2025" ? "up" as const : "neutral" as const },
  ];
  const normalizedSearch = search.trim().toLowerCase();
  const financeSearchResults = useMemo(() => {
    if (!normalizedSearch) return [];
    const rows: Array<{ key: string; title: string; detail: string; view: FinanceWorkspaceView }> = [];
    financeCurrentData.accounts.forEach((account) => rows.push({ key: `account-${account.id}`, title: account.name, detail: `${accountBankName(account.bankCode)} · 끝자리 ${account.last4} · ${formatWon(account.krwBalance)}`, view: "liquidity" }));
    financeHistoricalData.trialBalance2025.forEach((account) => rows.push({ key: `ledger-${account.code}`, title: account.name, detail: `계정 ${account.code} · 2025년 기말 ${formatWon(account.endingDebit - account.endingCredit)}`, view: "statements" }));
    financeHistoricalData.receivables.forEach((partner) => rows.push({ key: `receivable-${partner.index}`, title: partner.name, detail: `외상매출금 · 잔액 ${formatWon(partner.ending)}`, view: "receivables" }));
    financeHistoricalData.payables.forEach((partner) => rows.push({ key: `payable-${partner.index}`, title: partner.name, detail: `매입채무 · 잔액 ${formatWon(partner.ending)}`, view: "liquidity" }));
    const commercialPartners = new Map<string, { sales: number; purchases: number }>();
    financeCurrentData.salesDaily2026.forEach((item) => { const value = commercialPartners.get(item.partner) ?? { sales: 0, purchases: 0 }; value.sales += item.amount; commercialPartners.set(item.partner, value); });
    financeCurrentData.purchaseDaily2026.forEach((item) => { const value = commercialPartners.get(item.partner) ?? { sales: 0, purchases: 0 }; value.purchases += item.amount; commercialPartners.set(item.partner, value); });
    commercialPartners.forEach((value, partner) => rows.push({ key: `commercial-${partner}`, title: partner, detail: `매출 ${formatWon(value.sales)} · 매입 ${formatWon(value.purchases)}`, view: "commercial" }));
    return rows.filter((row) => `${row.title} ${row.detail}`.toLowerCase().includes(normalizedSearch)).slice(0, 12);
  }, [normalizedSearch]);

  const financeNavigation: Array<{ title: string; items: Array<[FinanceWorkspaceView, string, string]> }> = [
    { title: "재무 홈", items: [["overview", "통합 대시보드", "통"], ["control", "재무 운영센터", "운"]] },
    { title: "거래 관리", items: [["purchasing", "구매·매입채무", "구"], ["commercial", "매입·매출 분석", "매"], ["receivables", "외상·미수 관리", "미"]] },
    { title: "재무 분석", items: [["reconciliation", "자금 대사", "대"], ["forecast", "13주 자금예측", "예"], ["budget", "예산·실적", "실"], ["statements", "손익·재무상태", "손"], ["liquidity", "자금·채권채무", "자"]] },
    { title: "데이터 관리", items: [["close", "월마감 통제", "마"], ["quality", "원장·데이터 점검", "원"]] },
  ];

  return (
    <div className="finance-workspace-layout">
      <aside className="finance-side-navigation" aria-label="재무회계 메뉴">
        <div className="finance-side-brand">
          <span>₩</span>
          <div><strong>XDNODE FINANCE</strong><small>FINANCE &amp; ACCOUNTING</small></div>
        </div>
        <nav>
          {financeNavigation.map((group) => (
            <div className="finance-side-group" key={group.title}>
              <p>{group.title}</p>
              {group.items.map(([key, label, icon]) => (
                <button type="button" aria-current={workspace === key ? "page" : undefined} className={workspace === key ? "active" : ""} key={key} onClick={() => selectWorkspace(key)}>
                  <span>{icon}</span><strong>{label}</strong>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="finance-side-footer">
          <button type="button" className="finance-side-alert" onClick={onOpenAlerts}><span>♢</span><strong>알림 센터</strong></button>
          <div><span>마지막 동기화</span><strong>{financeCurrentData.asOf.replaceAll("-", ".")}</strong><small>Clobe · 이카운트 자료 기준</small></div>
        </div>
      </aside>

      <div className="dashboard-stack finance-dashboard">

      {normalizedSearch && (
        <section className="panel finance-search-results" aria-live="polite">
          <div className="finance-search-heading"><div><p>SEARCH RESULTS</p><h2>‘{search.trim()}’ 검색 결과</h2></div><span>{financeSearchResults.length}건 표시</span></div>
          {financeSearchResults.length ? <div className="finance-search-list">{financeSearchResults.map((result) => (
            <button type="button" key={result.key} onClick={() => selectWorkspace(result.view)}><span>⌕</span><p><strong>{result.title}</strong><small>{result.detail}</small></p><em>관련 화면 →</em></button>
          ))}</div> : <div className="finance-empty">일치하는 계좌·거래처·계정과목이 없습니다.</div>}
        </section>
      )}

      {workspace === "overview" && (
        <>
          <div className="finance-scope-note finance-scope-expanded">
            <span>FINANCE CONTROL ROOM</span>
            <div className="finance-year-switch" aria-label="재무 기준연도">
              {(["2024", "2025", "2026"] as const).map((year) => <button type="button" key={year} className={overviewYear === year ? "active" : ""} onClick={() => setOverviewYear(year)}>{year}</button>)}
            </div>
            <strong>{overviewYear === "2026" ? `2026.01.01–${financeCurrentData.asOf.slice(5).replace("-", ".")}` : `${overviewYear}.01.01–12.31`}</strong>
            <p>{overviewYear === "2026" ? "Clobe 최신 스냅샷 · 매일 07:30 확인" : "이카운트 결산후 자료 · 원장/시산표 대사 완료"}</p>
          </div>

          <section className="kpi-grid">
            {overviewYear === "2026" ? (
              <>
                <Metric label="은행성 자산" value={formatCompactWon(bankAssets)} delta="8월 14일 현재" trend="neutral" hint="원화·외화 원화환산 합계" />
                <Metric label="최근 31일 순유입" value="+₩15.82억" delta="입금 149.67억 · 출금 133.86억" trend="up" hint="내부 대체거래 제외" />
                <Metric label="외화 자산 비중" value={`${(fxConcentration * 100).toFixed(1)}%`} delta="환율 변동 집중도" trend="down" hint={`외화예금 ${formatCompactWon(financeCurrentData.accountSummary.fxBalanceSumKrw)}`} />
                <Metric label="대출 대비 유동성" value={`${(liquidityCoverage * 100).toFixed(1)}%`} delta={`대출 잔액 ${formatCompactWon(bankLoans)}`} trend="down" hint="은행성 자산 ÷ 대출 잔액" />
              </>
            ) : historicalMetrics?.map((item) => <Metric key={item.label} label={item.label} value={formatCompactWon(item.value)} delta={item.hint} trend={item.trend} hint={`${overviewYear}년 결산 자료`} />)}
          </section>

          <section className="finance-alert-section" aria-label="재무 알림">
            <div className="finance-section-heading">
              <div><p>FINANCIAL ALERTS</p><h2>지금 확인할 재무 알림</h2></div>
              <span>확인 필요 4건</span>
            </div>
            <div className="finance-alert-grid">
              {financeAlerts.map((alert, index) => (
                <article className={`finance-alert-card ${alert.level}`} key={alert.title}>
                  <span>{alert.label}</span><strong>{alert.title}</strong><p>{alert.detail}</p>
                  <button type="button" onClick={() => setWorkspace(index === 3 ? "statements" : "quality")}>내역 확인 →</button>
                </article>
              ))}
            </div>
          </section>

          <section className="content-grid finance-insight-grid">
            <article className="panel finance-chart-panel">
              <div className="finance-chart-head">
                <div><p>FINANCIAL TREND</p><h2>{overviewYear === "2026" ? (metric === "cash" ? "자금 잔액 변화" : "연동 채널 매출") : (historicalMetric === "cashBalance" ? "보통예금 추이" : historicalMetric === "revenue" ? "회계상 매출 추이" : "당기순이익 추이")}</h2></div>
                <div className="finance-chart-controls">
                  {overviewYear === "2026" ? (
                    <>
                      <div className="segment-control"><button className={metric === "cash" ? "active" : ""} onClick={() => setMetric("cash")}>자금</button><button className={metric === "sales" ? "active" : ""} onClick={() => setMetric("sales")}>연동매출</button></div>
                      <div className="segment-control period">{(Object.keys(financePeriodLabels) as FinancePeriod[]).map((key) => <button key={key} className={period === key ? "active" : ""} onClick={() => setPeriod(key)}>{financePeriodLabels[key]}</button>)}</div>
                    </>
                  ) : (
                    <div className="segment-control"><button className={historicalMetric === "cashBalance" ? "active" : ""} onClick={() => setHistoricalMetric("cashBalance")}>자금</button><button className={historicalMetric === "revenue" ? "active" : ""} onClick={() => setHistoricalMetric("revenue")}>매출</button><button className={historicalMetric === "netIncome" ? "active" : ""} onClick={() => setHistoricalMetric("netIncome")}>순이익</button></div>
                  )}
                </div>
              </div>
              <div className="finance-chart-summary"><div><strong>{formatCompactWon(chartLast)}</strong><span>선택 기간 값</span></div><em className={chartChange >= 0 ? "positive" : "negative"}>{chartFirst ? `${chartChange >= 0 ? "+" : ""}${chartChange.toFixed(1)}%` : "비교 기준 없음"}</em></div>
              <FinanceBars data={overviewChart} />
              <div className="chart-coverage-note"><span>i</span>{overviewYear === "2026" ? "2026년은 Clobe 수집 범위의 최신 스냅샷이며 아직 결산 자료가 아닙니다." : overviewYear === "2025" ? "월별 수치는 계정별원장의 결산 및 이월 전표를 포함해 재구성했습니다." : "2024년은 연말 기준 자료만 제공되어 2024·2025 연간 값을 비교합니다."}</div>
            </article>

            <article className="panel ai-daily-brief">
              <div className="ai-brief-head"><span>AI</span><div><p>DAILY CASH BRIEF</p><h2>오늘의 자금일보</h2></div><em>07:30 분석</em></div>
              <div className="ai-brief-hero"><small>자금 상태</small><strong>주의</strong><p>유동성은 유지되고 있지만 미분류 거래와 외화 집중도를 확인해야 합니다.</p></div>
              <ol className="ai-brief-list">{financeDailyBrief.map((item, index) => <li key={item}><span>{index + 1}</span><p>{item}</p></li>)}</ol>
              <div className="ai-priority"><span>오늘의 우선순위</span><strong>미분류 출금 40건 계정 지정</strong></div>
            </article>
          </section>

          <section className="content-grid finance-assistant-grid">
            <article className="panel finance-assistant-panel">
              <div className="assistant-heading"><div className="assistant-mark">AI</div><div><p>FINANCE DATA ASSISTANT</p><h2>재무 데이터 어시스턴트</h2><span>2024·2025 이카운트 결산자료와 2026 Clobe 스냅샷을 구분해 분석합니다.</span></div></div>
              <div className={assistantStatus === "error" ? "assistant-answer error" : "assistant-answer"}>{assistantAnswer}</div>
              <div className="assistant-suggestions">{["2025년 손익 요약", "2024년 대비 2025년 변화", "채권·채무 집중 위험", "오늘 자금 상태 요약"].map((question) => <button type="button" key={question} onClick={() => void askFinanceAssistant(question)}>{question}</button>)}</div>
              <form className="assistant-form" onSubmit={submitAssistant}><input value={assistantQuestion} onChange={(event) => setAssistantQuestion(event.target.value)} maxLength={300} placeholder="예: 2025년 순이익이 전년보다 감소한 이유는?" aria-label="재무 데이터 질문" /><button type="submit" disabled={assistantStatus === "loading"}>{assistantStatus === "loading" ? "분석 중" : "질문하기"}</button></form>
            </article>

            <article className="panel finance-source-panel">
              <PanelHeader eyebrow="Data lineage" title="분석 근거" action="3개 연도" />
              <div className="finance-source-list">
                <div><span className="source-year">24</span><p><strong>2024 결산 기준선</strong><small>재무상태표 · 합계잔액시산표</small></p><em className="status-pass">일치</em></div>
                <div><span className="source-year">25</span><p><strong>2025 상세 원장</strong><small>원장 · 분개장 · 자금현황표</small></p><em className="status-pass">일치</em></div>
                <div><span className="source-year">26</span><p><strong>2026 최신 흐름</strong><small>Clobe · 매일 07:30 확인</small></p><em className="status-watch">확인중</em></div>
              </div>
            </article>
          </section>
        </>
      )}

      {workspace === "control" && <FinanceOperationsCenter onOpenBudget={() => setWorkspace("budget")} />}

      {workspace === "purchasing" && <PurchasingWorkspace />}

      {workspace === "reconciliation" && <CashReconciliationWorkspace />}

      {workspace === "forecast" && <CashForecastWorkspace />}

      {workspace === "budget" && <BudgetActualWorkspace />}

      {workspace === "close" && <FinanceCloseWorkspace />}

      {workspace === "commercial" && (
        <>
          <div className="finance-subpage-heading">
            <div><p>SALES & PURCHASE ANALYTICS</p><h2>매입·매출 분석</h2><span>세금계산서 공급가액 기준으로 수정·취소분을 순액 반영합니다.</span></div>
            <span className="finance-data-badge">Clobe · {financeCurrentData.asOf} 기준</span>
          </div>
          <section className="panel commercial-period-panel">
            <div>
              <span>분석 기간</span>
              <strong>{commercialPeriodValid ? `${commercialStartDate} → ${commercialEndDate}` : "시작일과 종료일을 확인해 주세요."}</strong>
            </div>
            <div className="commercial-date-controls">
              <label>시작일<input type="date" min="2026-01-01" max={financeCurrentData.asOf} value={commercialStartDate} onChange={(event) => setCommercialStartDate(event.target.value)} /></label>
              <label>종료일<input type="date" min="2026-01-01" max={financeCurrentData.asOf} value={commercialEndDate} onChange={(event) => setCommercialEndDate(event.target.value)} /></label>
              <div className="commercial-presets" aria-label="기간 빠른 선택">
                <button type="button" onClick={() => { setCommercialStartDate("2026-01-01"); setCommercialEndDate(financeCurrentData.asOf); }}>올해 누적</button>
                <button type="button" onClick={() => { setCommercialStartDate("2026-08-01"); setCommercialEndDate(financeCurrentData.asOf); }}>이번 달</button>
                <button type="button" onClick={() => { setCommercialStartDate("2026-07-15"); setCommercialEndDate(financeCurrentData.asOf); }}>최근 30일</button>
              </div>
            </div>
          </section>
          <section className="kpi-grid">
            <Metric label="선택기간 매출" value={formatCompactWon(selectedSalesTotal)} delta={`${selectedSalesCount.toLocaleString("ko-KR")}건`} trend="up" hint="공급가액 · 취소분 순액" />
            <Metric label="선택기간 매입" value={formatCompactWon(selectedPurchaseTotal)} delta={`${selectedPurchaseCount.toLocaleString("ko-KR")}건`} trend="down" hint="공급가액 · 취소분 순액" />
            <Metric label="매출 - 매입" value={formatCompactWon(selectedSalesTotal - selectedPurchaseTotal)} delta={selectedSalesTotal >= selectedPurchaseTotal ? "매출 우위" : "매입 우위"} trend={selectedSalesTotal >= selectedPurchaseTotal ? "up" : "down"} hint="재고·비용을 반영한 이익이 아님" />
            <Metric label="조회 거래처" value={`${new Set([...commercialSalesRows.map((row) => row.partner), ...commercialPurchaseRows.map((row) => row.partner)]).size}곳`} delta="검색어 필터 연동" trend="neutral" hint="매출·매입 거래처 합산" />
          </section>
          <section className="content-grid commercial-ranking-grid">
            <article className="panel commercial-ranking-panel">
              <PanelHeader eyebrow="Sales ranking" title="매출 거래처 순위" action={`${commercialSalesRows.length}곳`} />
              <div className="commercial-ranking-list">
                {commercialSalesRows.slice(0, 15).map((row, index) => <div key={row.partner}>
                  <span>{index + 1}</span>
                  <p><strong>{row.partner}</strong><small>{row.count.toLocaleString("ko-KR")}건</small><i><b style={{ width: `${Math.max(3, (row.amount / Math.max(commercialSalesRows[0]?.amount ?? 1, 1)) * 100)}%` }} /></i></p>
                  <em>{formatCompactWon(row.amount)}</em>
                </div>)}
                {commercialSalesRows.length === 0 && <div className="finance-empty">선택한 기간에 매출 자료가 없습니다.</div>}
              </div>
            </article>
            <article className="panel commercial-ranking-panel purchase">
              <PanelHeader eyebrow="Purchase ranking" title="매입 거래처 순위" action={`${commercialPurchaseRows.length}곳`} />
              <div className="commercial-ranking-list">
                {commercialPurchaseRows.slice(0, 15).map((row, index) => <div key={row.partner}>
                  <span>{index + 1}</span>
                  <p><strong>{row.partner}</strong><small>{row.count.toLocaleString("ko-KR")}건</small><i><b style={{ width: `${Math.max(3, (row.amount / Math.max(commercialPurchaseRows[0]?.amount ?? 1, 1)) * 100)}%` }} /></i></p>
                  <em>{formatCompactWon(row.amount)}</em>
                </div>)}
                {commercialPurchaseRows.length === 0 && <div className="finance-empty">선택한 기간에 매입 자료가 없습니다.</div>}
              </div>
            </article>
          </section>
          <section className="content-grid commercial-forecast-grid">
            <article className="panel finance-chart-panel">
              <div className="finance-chart-head"><div><p>MONTHLY SALES TREND</p><h2>2026년 월간 매출 추이</h2></div><span className="finance-data-badge">8월 13일까지</span></div>
              <div className="finance-chart-summary"><div><strong>{formatCompactWon(currentSalesYtd)}</strong><span>현재까지 누적 매출액</span></div><em className="positive">2025 연간 대비 {((currentSalesYtd / priorYearSales - 1) * 100).toFixed(1)}%</em></div>
              <FinanceBars data={monthlySalesChart} currentLabel="8월" />
              <div className="chart-coverage-note"><span>i</span>8월은 13일까지의 부분 실적이며 공급가액 기준입니다.</div>
            </article>
            <article className="panel annual-forecast-panel">
              <p>YEAR-END RUN RATE</p>
              <h2>연말 예상 총 매출액</h2>
              <strong>{formatCompactWon(projectedAnnualSales)}</strong>
              <div className="forecast-meter"><i style={{ width: `${Math.min(100, (currentSalesYtd / projectedAnnualSales) * 100)}%` }} /></div>
              <dl><div><dt>누적 실적</dt><dd>{formatCompactWon(currentSalesYtd)}</dd></div><div><dt>경과일</dt><dd>{elapsedDays2026}일 / 365일</dd></div><div><dt>2025 연간 매출</dt><dd>{formatCompactWon(priorYearSales)}</dd></div></dl>
              <small>1월 1일~8월 13일의 일평균 매출을 365일로 연환산한 단순 예측입니다. 계절성·수주잔고·반품 가능성은 반영하지 않습니다.</small>
            </article>
          </section>
        </>
      )}

      {workspace === "receivables" && (
        <>
          <div className="finance-subpage-heading">
            <div><p>ACCOUNTS RECEIVABLE CONTROL</p><h2>외상·미수 매출 관리</h2><span>2025년 결산잔액을 기준선으로 두고 현재 회수잔액·담당자·예정일·메모를 저장합니다.</span></div>
            <span className="finance-data-badge warning">만기일 원천자료 미연동</span>
          </div>
          <section className="kpi-grid">
            <Metric label="관리대상 미수잔액" value={formatCompactWon(receivableOutstandingTotal)} delta={`${managedReceivables.length}개 거래처`} trend="down" hint="저장된 현재잔액 우선" />
            <Metric label="연체·기한경과" value={formatCompactWon(receivableOverdueAmount)} delta={receivableOverdueAmount ? "즉시 확인 필요" : "기한경과 없음"} trend={receivableOverdueAmount ? "down" : "up"} hint="회수예정일·상태 기준" />
            <Metric label="회수계획 미설정" value={`${missingCollectionPlan}곳`} delta="예정일 입력 필요" trend={missingCollectionPlan ? "down" : "up"} hint="회수완료 거래처 제외" />
            <Metric label="관리기록 저장" value={`${Object.keys(receivableRecords).length}곳`} delta="비공개 서버 저장" trend="neutral" hint="새로고침 후에도 유지" />
          </section>
          <section className="content-grid receivable-control-grid">
            <article className="panel receivable-list-panel">
              <PanelHeader eyebrow="Collection queue" title="거래처별 회수 현황" action={receivableLoading ? "불러오는 중" : `${managedReceivables.length}곳`} />
              {receivableMessage && <div className={receivableMessage.includes("저장") ? "finance-inline-message success" : "finance-inline-message"}>{receivableMessage}</div>}
              <div className="receivable-list">
                {managedReceivables.map((record) => {
                  const displayedStatus = record.status !== "COMPLETE" && record.dueDate && record.dueDate < financeCurrentData.asOf ? "OVERDUE" : record.status;
                  return <button type="button" key={record.partnerName} className={receivableDraft?.partnerName === record.partnerName ? "active" : ""} onClick={() => editReceivable(record)}>
                    <span className={`receivable-status ${displayedStatus.toLowerCase()}`}>{receivableStatusLabels[displayedStatus]}</span>
                    <p><strong>{record.partnerName}</strong><small>{record.owner || "담당자 미지정"} · {record.dueDate || "회수예정일 미설정"}</small></p>
                    <b>{formatCompactWon(record.outstandingAmount)}</b>
                  </button>;
                })}
              </div>
            </article>
            <article className="panel receivable-editor-panel">
              {receivableDraft ? (
                <form onSubmit={saveReceivable}>
                  <p>COLLECTION RECORD</p><h2>{receivableDraft.partnerName}</h2>
                  <label>현재 미수잔액<input type="number" min="0" step="1" value={receivableDraft.outstandingAmount} onChange={(event) => setReceivableDraft({ ...receivableDraft, outstandingAmount: Number(event.target.value) })} /></label>
                  <div className="receivable-form-grid">
                    <label>회수 담당자<input value={receivableDraft.owner} maxLength={50} placeholder="담당자 이름" onChange={(event) => setReceivableDraft({ ...receivableDraft, owner: event.target.value })} /></label>
                    <label>회수 예정일<input type="date" value={receivableDraft.dueDate} onChange={(event) => setReceivableDraft({ ...receivableDraft, dueDate: event.target.value })} /></label>
                  </div>
                  <label>회수 상태<select value={receivableDraft.status} onChange={(event) => setReceivableDraft({ ...receivableDraft, status: event.target.value as ReceivableStatus })}>{(Object.keys(receivableStatusLabels) as ReceivableStatus[]).map((status) => <option key={status} value={status}>{receivableStatusLabels[status]}</option>)}</select></label>
                  <label>특이사항·회수 메모<textarea value={receivableDraft.memo} maxLength={1000} rows={7} placeholder="입금 약정, 연락 내역, 분쟁 사유 등을 기록하세요." onChange={(event) => setReceivableDraft({ ...receivableDraft, memo: event.target.value })} /></label>
                  <button type="submit" className="receivable-save-button" disabled={receivableLoading}>{receivableLoading ? "저장 중…" : "변경내용 저장"}</button>
                  <small>결산 기준 잔액과 다르면 현재 미수잔액을 직접 수정해 주세요. 저장값은 원천 회계자료를 변경하지 않고 관리기록으로 별도 보관됩니다.</small>
                </form>
              ) : <div className="receivable-empty-editor"><span>₩</span><strong>관리할 거래처를 선택하세요.</strong><p>왼쪽 목록에서 거래처를 선택하면 회수계획과 메모를 기록할 수 있습니다.</p></div>}
            </article>
          </section>
        </>
      )}

      {workspace === "statements" && (
        <>
          <div className="finance-subpage-heading"><div><p>FINANCIAL STATEMENTS</p><h2>손익·재무상태</h2><span>결산후 합계잔액시산표 기준입니다.</span></div><div className="segment-control"><button className={statementYear === "2024" ? "active" : ""} onClick={() => setStatementYear("2024")}>2024</button><button className={statementYear === "2025" ? "active" : ""} onClick={() => setStatementYear("2025")}>2025</button></div></div>
          <section className="kpi-grid">
            <Metric label="자산총계" value={formatCompactWon(selectedHistorical.assets)} delta="차대변 균형 확인" trend="neutral" hint={`${statementYear}년 기말`} />
            <Metric label="매출" value={formatCompactWon(selectedHistorical.revenue)} delta={statementYear === "2025" ? "전년 대비 +95.8%" : "상품매출"} trend={statementYear === "2025" ? "up" : "neutral"} hint="회계상 매출" />
            <Metric label="매출총이익" value={formatCompactWon(grossProfit)} delta={`매출총이익률 ${grossMargin.toFixed(1)}%`} trend={grossProfit >= 0 ? "up" : "down"} hint="매출 - 매출원가" />
            <Metric label="당기순이익" value={formatCompactWon(selectedHistorical.netIncome)} delta={statementYear === "2025" ? "전년 대비 -68.2%" : "결산후"} trend={statementYear === "2025" ? "down" : "neutral"} hint="세후 결산 계정" />
          </section>

          {statementYear === "2025" && (
            <section className="panel finance-monthly-panel">
              <PanelHeader eyebrow="Monthly performance" title="2025년 월별 손익·자금 흐름" action="12개월" />
              <div className="finance-wide-table monthly-performance-table">
                <div className="finance-table-row header"><span>월</span><span>매출</span><span>매출원가</span><span>당기순이익</span><span>현금 유입</span><span>현금 유출</span><span>기말 보통예금</span></div>
                {financeHistoricalData.monthly2025.map((row) => <div className="finance-table-row" key={row.month}><strong>{row.month}월</strong><span>{formatCompactWon(row.revenue)}</span><span>{formatCompactWon(row.cogs)}</span><span className={row.netIncome < 0 ? "negative-number" : ""}>{formatCompactWon(row.netIncome)}</span><span>{formatCompactWon(row.cashIn)}</span><span>{formatCompactWon(row.cashOut)}</span><b>{formatCompactWon(row.cashBalance)}</b></div>)}
              </div>
            </section>
          )}

          <section className="panel finance-trial-balance-panel">
            <PanelHeader eyebrow="Trial balance" title={`${statementYear}년 합계잔액시산표`} action={`${trialBalance.length}개 계정`} />
            <div className="finance-wide-table trial-balance-table">
              <div className="finance-table-row header"><span>계정코드</span><span>계정명</span><span>차변금액</span><span>대변금액</span><span>기말 차변</span><span>기말 대변</span></div>
              {trialBalance.map((row) => <div className="finance-table-row" key={`${row.code}-${row.name}`}><span>{row.code || "-"}</span><strong>{row.name}</strong><span>{formatWon(row.debit)}</span><span>{formatWon(row.credit)}</span><b>{row.endingDebit ? formatWon(row.endingDebit) : "-"}</b><b>{row.endingCredit ? formatWon(row.endingCredit) : "-"}</b></div>)}
              {trialBalance.length === 0 && <div className="finance-empty">검색 조건과 일치하는 계정이 없습니다.</div>}
            </div>
          </section>
        </>
      )}

      {workspace === "liquidity" && (
        <>
          <div className="finance-subpage-heading"><div><p>LIQUIDITY & WORKING CAPITAL</p><h2>자금·채권채무</h2><span>2025년 자금현황표와 2026년 은행 스냅샷을 함께 봅니다.</span></div><span className="finance-data-badge">2025 결산 · 2026 최신</span></div>
          <section className="kpi-grid">
            <Metric label="2025 기말 보통예금" value={formatCompactWon(financeHistoricalData.years["2025"].cash)} delta="전년 대비 +65.8%" trend="up" hint="자금현황표 일치" />
            <Metric label="2025 외상매출금" value={formatCompactWon(financeHistoricalData.years["2025"].ar)} delta="전년 대비 -22.3%" trend="up" hint="회수대상 잔액" />
            <Metric label="2025 외상매입금" value={formatCompactWon(financeHistoricalData.years["2025"].ap)} delta="전년 대비 +14.8%" trend="down" hint="지급대상 잔액" />
            <Metric label="2026 은행성 자산" value={formatCompactWon(bankAssets)} delta={`대출 대비 ${(liquidityCoverage * 100).toFixed(1)}%`} trend="down" hint="8월 14일 Clobe" />
          </section>
          <section className="content-grid finance-liquidity-grid">
            <article className="panel finance-chart-panel">
              <div className="finance-chart-head"><div><p>2025 MONTHLY BALANCE</p><h2>{liquidityMetric === "cash" ? "보통예금" : liquidityMetric === "ar" ? "외상매출금" : "외상매입금"} 월말 잔액</h2></div><div className="segment-control"><button className={liquidityMetric === "cash" ? "active" : ""} onClick={() => setLiquidityMetric("cash")}>자금</button><button className={liquidityMetric === "ar" ? "active" : ""} onClick={() => setLiquidityMetric("ar")}>채권</button><button className={liquidityMetric === "ap" ? "active" : ""} onClick={() => setLiquidityMetric("ap")}>채무</button></div></div>
              <div className="finance-chart-summary"><div><strong>{formatCompactWon(liquidityChart.at(-1)?.value ?? 0)}</strong><span>2025년 기말 잔액</span></div></div>
              <FinanceBars data={liquidityChart} />
              <div className="chart-coverage-note"><span>i</span>월말 잔액은 계정별원장의 기초잔액과 월별 차대변을 누적해 산출했습니다.</div>
            </article>
            <article className="panel exposure-panel">
              <div className="finance-chart-head"><div><p>CONCENTRATION</p><h2>거래처별 잔액 집중도</h2></div><div className="segment-control"><button className={exposureType === "receivables" ? "active" : ""} onClick={() => setExposureType("receivables")}>받을 돈</button><button className={exposureType === "payables" ? "active" : ""} onClick={() => setExposureType("payables")}>줄 돈</button></div></div>
              <div className="exposure-list">{exposureRows.map((row, index) => <div key={row.name}><span>{index + 1}</span><p><strong>{row.name}</strong><small>기초 {formatCompactWon(row.opening)}</small></p><b>{formatCompactWon(row.ending)}</b></div>)}</div>
            </article>
          </section>
          <section className="panel finance-exception-panel">
            <PanelHeader eyebrow="Balance exceptions" title={`${exposureType === "receivables" ? "채권" : "채무"} 음수잔액 확인`} action={`${exposureExceptions.length}건`} />
            <div className="finance-wide-table exception-table">
              <div className="finance-table-row header"><span>거래처</span><span>기초잔액</span><span>증가</span><span>감소</span><span>기말잔액</span><span>조치</span></div>
              {exposureExceptions.map((row) => <div className="finance-table-row" key={row.name}><strong>{row.name}</strong><span>{formatWon(row.opening)}</span><span>{formatWon(row.increase)}</span><span>{formatWon(row.decrease)}</span><b className="negative-number">{formatWon(row.ending)}</b><em>선수·선급/오분류 확인</em></div>)}
            </div>
          </section>
          <section className="content-grid account-risk-grid">
            <article className={`panel account-risk-hero ${accountRiskLevel === "높음" ? "high" : accountRiskLevel === "주의" ? "watch" : "stable"}`}>
              <p>ACCOUNT LIQUIDITY SIGNAL</p>
              <div className="account-risk-score"><strong>{accountRiskScore}</strong><span>/ 100</span></div>
              <h2>계좌금액 위험도 · {accountRiskLevel}</h2>
              <p>은행성 자산, 대출잔액, 원화 가용자금, 외화 집중도와 최근 고점 대비 감소폭을 조합한 운영 신호입니다.</p>
              <div className="risk-factor-list">
                <div><span>대출 대비 은행성 자산</span><b>{(liquidityCoverage * 100).toFixed(1)}%</b></div>
                <div><span>외화자산 집중도</span><b>{(fxConcentration * 100).toFixed(1)}%</b></div>
                <div><span>원화 입출금계좌 잔액</span><b>{formatCompactWon(financeCurrentData.accountSummary.checkingBalanceSum)}</b></div>
                <div><span>최근 고점 대비 감소</span><b>{(bankDrawdown * 100).toFixed(1)}%</b></div>
              </div>
              <small>이 점수는 지급예정표·확정 수금일을 포함하지 않은 내부 조기경보 지표이며 신용평가나 지급불능 판정이 아닙니다.</small>
            </article>
            <article className="panel account-risk-detail">
              <PanelHeader eyebrow="Risk drivers" title="위험 신호 해석" action={`${financeCurrentData.asOf} 기준`} />
              <div className="account-risk-signals">
                <div className={liquidityCoverage < 1 ? "high" : "stable"}><span>01</span><p><strong>유동성 커버리지</strong><small>은행성 자산이 대출잔액의 {(liquidityCoverage * 100).toFixed(1)}%입니다.</small></p></div>
                <div className={fxConcentration > .7 ? "high" : "watch"}><span>02</span><p><strong>외화 집중</strong><small>은행성 자산 중 외화 비중이 {(fxConcentration * 100).toFixed(1)}%입니다.</small></p></div>
                <div className={lowBalanceAccounts >= 3 ? "watch" : "stable"}><span>03</span><p><strong>소액 잔액 계좌</strong><small>10만원 미만 입출금계좌가 {lowBalanceAccounts}개입니다.</small></p></div>
                <div className={bankDrawdown > .2 ? "watch" : "stable"}><span>04</span><p><strong>잔액 변동성</strong><small>최근 10주 고점 대비 {(bankDrawdown * 100).toFixed(1)}% 낮습니다.</small></p></div>
              </div>
            </article>
          </section>
          <section className="panel account-register-panel">
            <PanelHeader eyebrow="Account register" title="계좌별 위험 신호" action={`${financeCurrentData.accounts.length}개 계좌`} />
            <div className="account-register-list">
              {financeCurrentData.accounts.map((account) => {
                const isConcentratedFx = account.type === "FX" && account.krwBalance > bankAssets * .5;
                const isLowChecking = account.type === "CHECKING" && account.krwBalance < 100_000;
                const signal = account.type === "LOAN" ? "대출잔액" : isConcentratedFx ? "환율 집중" : isLowChecking ? "잔액 점검" : account.type === "FX" ? "외화계좌" : "정상";
                const signalClass = account.type === "LOAN" || isConcentratedFx ? "high" : isLowChecking ? "watch" : "stable";
                return <div key={account.id}>
                  <span className="account-bank-mark">{accountBankName(account.bankCode).slice(0, 2)}</span>
                  <p><strong>{accountBankName(account.bankCode)} ····{account.last4}</strong><small>{account.name} · {account.currency}</small></p>
                  <b>{account.currency === "USD" ? `$${account.balance.toLocaleString("en-US")}` : formatWon(account.krwBalance)}</b>
                  <em className={signalClass}>{signal}</em>
                </div>;
              })}
            </div>
          </section>
        </>
      )}

      {workspace === "quality" && (
        <>
          <div className="finance-subpage-heading"><div><p>DATA QUALITY CENTER</p><h2>원장·데이터 점검</h2><span>가져오기 자료의 출처·대사·예외 항목을 한곳에서 확인합니다.</span></div><span className="finance-data-badge warning">확인 필요 2건</span></div>
          <section className="finance-quality-cards">
            <article><span>2024</span><strong>결산 기준선</strong><p>재무상태표와 시산표 자산총계가 일치합니다.</p><em className="status-pass">PASS</em></article>
            <article><span>2025</span><strong>상세 이관</strong><p>원장 28개 구간과 시산표 27개 계정을 대사했습니다.</p><em className="status-pass">PASS</em></article>
            <article><span>2025</span><strong>분개장 품질</strong><p>15,510행 중 중복 후보 32행과 금액 0원 14행이 있습니다.</p><em className="status-watch">REVIEW</em></article>
            <article><span>2026</span><strong>Clobe 최신 자료</strong><p>분개장 차대변 {financeCurrentData.journalSummary.differenceKrw.toLocaleString("ko-KR")}원 차이가 남아 있습니다.</p><em className="status-watch">REVIEW</em></article>
          </section>
          <section className="content-grid finance-quality-grid">
            <article className="panel close-panel finance-check-panel">
              <PanelHeader eyebrow="Reconciliation" title="반영 상태" action="5 / 7 완료" />
              <div className="progress-ring"><span>71<small>%</small></span></div>
              <div className="task-list">{financeChecks.map((task) => <div className="task-row" key={task.label}><span className={task.done ? "check done" : "check"}>{task.done ? "✓" : ""}</span><div><strong>{task.label}</strong><small>{task.owner}</small></div></div>)}</div>
            </article>
            <article className="panel finance-import-panel">
              <PanelHeader eyebrow="Source registry" title="원천자료 등록부" action="8개 파일" />
              <div className="source-registry">
                {[
                  ["2024", "재무상태표 · 합계잔액시산표", "결산후"],
                  ["2024", "계정별원장 · 자금현황표", "12/31 기준"],
                  ["2025", "분개장 · 계정별원장", "15,510행"],
                  ["2025", "합계잔액시산표 · 자금현황표", "대사완료"],
                  ["2026", "Clobe MCP", "매일 07:30"],
                ].map(([year, source, scope]) => <div key={`${year}-${source}`}><span>{year}</span><p><strong>{source}</strong><small>{scope}</small></p><em>등록됨</em></div>)}
              </div>
            </article>
          </section>
          <section className="panel account-mapping-panel">
            <PanelHeader eyebrow="Account mapping" title="이카운트 → 현재 계정명 매핑" action="8개 규칙" />
            <div className="finance-wide-table mapping-table">
              <div className="finance-table-row header"><span>이카운트 계정명</span><span>현재 계정명</span><span>현재 코드</span><span>상태</span></div>
              {[
                ["판매수수료(판)", "판매수수료", "83900"], ["지급수수료(판)", "지급수수료", "83100"], ["운반비(판)", "운반비", "82400"], ["복리후생비(판)", "복리후생비", "81100"],
                ["세금과공과금(판)", "세금과공과금", "81700"], ["광고선전비(판)", "광고선전비", "83300"], ["접대비-카드(판)", "접대비(기업업무추진비)", "81300"], ["지급임차료(판)", "지급임차료", "81900"],
              ].map((row) => <div className="finance-table-row" key={row[0]}><strong>{row[0]}</strong><span>{row[1]}</span><span>{row[2]}</span><em className="status-pass">매핑완료</em></div>)}
            </div>
          </section>
        </>
      )}

        {workspace !== "overview" && <button type="button" className="finance-back-overview" onClick={() => selectWorkspace("overview")}>← 통합 대시보드로 돌아가기</button>}
      </div>
    </div>
  );
}

function SalesDashboard(props: {
  search: string;
  salePrice: number;
  costPrice: number;
  leadType: "outbound" | "inbound" | "ram";
  incentive: { margin: number; rate: number; eligible: boolean; payout: number };
  onSalePrice: (value: number) => void;
  onCostPrice: (value: number) => void;
  onLeadType: (value: "outbound" | "inbound" | "ram") => void;
}) {
  const filteredDeals = deals.filter((deal) => `${deal.company} ${deal.rep}`.toLowerCase().includes(props.search.toLowerCase()));
  return (
    <div className="dashboard-stack">
      <section className="kpi-grid">
        <Metric label="7월 확정 매출" value="₩2.18B" delta="목표 대비 104%" trend="up" hint="계산서 마감" />
        <Metric label="영업 파이프라인" value="₩3.42B" delta="전월 대비 +12%" trend="up" hint="진행 38건" />
        <Metric label="평균 마진율" value="9.8%" delta="기준 +4.8%p" trend="up" hint="인센티브 대상" />
        <Metric label="미수 위험" value="₩186M" delta="연체 3건" trend="down" hint="영업 확인 필요" />
      </section>

      <section className="content-grid sales-top-grid">
        <article className="panel incentive-lab">
          <PanelHeader eyebrow="Incentive lab" title="인센티브 미리 계산" action="규정 보기" />
          <div className="calc-layout">
            <div className="calc-form">
              <label>매출가<input type="number" value={props.salePrice} onChange={(event) => props.onSalePrice(Number(event.target.value))} /></label>
              <label>인정 원가<input type="number" value={props.costPrice} onChange={(event) => props.onCostPrice(Number(event.target.value))} /></label>
              <label>영업 유형<select value={props.leadType} onChange={(event) => props.onLeadType(event.target.value as "outbound" | "inbound" | "ram")}><option value="outbound">아웃바운드 / 직접영업</option><option value="inbound">웹·전화 인바운드</option><option value="ram">단독 RAM 판매</option></select></label>
            </div>
            <div className={props.incentive.eligible ? "calc-result eligible" : "calc-result"}>
              <span>{props.incentive.eligible ? "지급 예상" : "지급 제외"}</span>
              <strong>{formatWon(props.incentive.payout)}</strong>
              <div><small>마진</small><b>{formatWon(props.incentive.margin)}</b></div>
              <div><small>마진율</small><b>{(props.incentive.rate * 100).toFixed(1)}%</b></div>
              <p>마진율 5% 초과분의 5% 지급</p>
            </div>
          </div>
        </article>

        <article className="panel rules-panel">
          <PanelHeader eyebrow="Rule set · v1.0" title="현재 적용 규칙" action="편집" />
          <div className="rule-item"><span>01</span><div><strong>마진율 5% 초과</strong><small>5% 이하는 지급 대상에서 제외</small></div></div>
          <div className="rule-item"><span>02</span><div><strong>인바운드 제외</strong><small>웹·전화 문의 유입 건</small></div></div>
          <div className="rule-item"><span>03</span><div><strong>단독 RAM 제외</strong><small>서버 건은 RAM 원가 분리 조정</small></div></div>
          <div className="rule-item"><span>04</span><div><strong>특별지급 대표 승인</strong><small>악성재고·고난도 영업 건</small></div></div>
        </article>
      </section>

      <section className="panel pipeline-panel">
        <PanelHeader eyebrow="Pipeline" title="진행 중 영업 건" action="파이프라인 전체" />
        <div className="table-head deal-row"><span>거래처</span><span>담당자</span><span>단계</span><span>예상 매출</span><span>예정일</span><span /></div>
        {filteredDeals.map((deal) => (
          <div className="deal-row" key={deal.company}>
            <strong>{deal.company}</strong><span>{deal.rep}</span><span className={`stage ${deal.health}`}>{deal.stage}</span><b>{deal.amount}</b><span>{deal.due}</span><button aria-label={`${deal.company} 상세`}>→</button>
          </div>
        ))}
      </section>

      <section className="panel incentive-table">
        <PanelHeader eyebrow="July payout" title="7월 영업 인센티브 검토" action="급여로 보내기" />
        <div className="table-head incentive-row"><span>영업 담당</span><span>확정 매출</span><span>마진율</span><span>지급 예정액</span><span>상태</span></div>
        {incentiveRows.map((row) => (
          <div className="incentive-row" key={row.rep}><strong>{row.rep}</strong><span>{row.sales}</span><span>{row.margin}</span><b>{row.incentive}</b><em className={`status ${row.status}`}>{row.status}</em></div>
        ))}
      </section>
    </div>
  );
}

// Kept for reference while historical mockup styles are migrated; the live sales workspace is rendered above.
void SalesDashboard;

function HrDashboard({ search }: { search: string }) {
  const rows = peopleRows.filter((person) => `${person.name} ${person.role}`.toLowerCase().includes(search.toLowerCase()));
  return (
    <div className="dashboard-stack">
      <section className="kpi-grid">
        <Metric label="전체 구성원" value="24명" delta="이번 달 +3" trend="up" hint="온보딩 1명" />
        <Metric label="오늘 출근" value="21명" delta="재택 2 · 휴가 1" trend="neutral" hint="출근율 87.5%" />
        <Metric label="연차 주의" value="3명" delta="마이너스 1명" trend="down" hint="1년 미만 포함" />
        <Metric label="급여 마감" value="D-6" delta="인센티브 검토 중" trend="neutral" hint="9월 5일 지급" />
      </section>

      <section className="content-grid hr-top-grid">
        <article className="panel attendance-panel">
          <PanelHeader eyebrow="Today" title="오늘의 근무 현황" action="근태 전체" />
          <div className="attendance-visual">
            <div className="donut"><span><b>21</b><small>출근</small></span></div>
            <div className="legend-list"><p><i className="mint" />정상 출근 <b>18</b></p><p><i className="blue" />재택근무 <b>2</b></p><p><i className="amber" />휴가 <b>1</b></p><p><i className="gray" />외근·출장 <b>3</b></p></div>
          </div>
        </article>

        <article className="panel approval-panel">
          <PanelHeader eyebrow="Approvals" title="결재 대기" action="모두 보기" />
          <div className="finance-empty">실제 결재 문서는 상단 전자결재 센터에서 권한과 결재선에 따라 표시됩니다.</div>
        </article>

        <article className="panel compliance-panel">
          <PanelHeader eyebrow="Compliance" title="인사 일정" action="캘린더" />
          <div className="compliance-item urgent"><span>12</span><div><strong>4대보험 취득 신고</strong><small>신규 입사자 1명</small></div></div>
          <div className="compliance-item"><span>17</span><div><strong>정하늘 입사</strong><small>계정·장비 준비 80%</small></div></div>
          <div className="compliance-item"><span>28</span><div><strong>법정의무교육 마감</strong><small>미수료 4명</small></div></div>
        </article>
      </section>

      <section className="panel people-panel">
        <PanelHeader eyebrow="People directory" title="구성원" action="조직도 보기" />
        <div className="table-head person-row"><span>구성원</span><span>소속·직무</span><span>상태</span><span>입사일</span><span>연차 잔여</span><span /></div>
        {rows.map((person) => (
          <div className="person-row" key={person.name}>
            <span className="person-name"><i>{person.name.slice(-2)}</i><strong>{person.name}</strong></span><span>{person.role}</span><em className={person.flag === "new" ? "status onboarding" : "status active"}>{person.state}</em><span>{person.start}</span><b className={person.flag === "minus" ? "leave-minus" : ""}>{person.leave}</b><button aria-label={`${person.name} 상세`}>→</button>
          </div>
        ))}
      </section>
    </div>
  );
}

function Metric({ label, value, delta, trend, hint }: { label: string; value: string; delta: string; trend: "up" | "down" | "neutral"; hint: string }) {
  return <article className="metric-card"><div><span>{label}</span><small>{hint}</small></div><strong>{value}</strong><p className={trend}>{trend === "up" ? "↗" : trend === "down" ? "↘" : "•"} {delta}</p></article>;
}

function PanelHeader({ eyebrow, title, action }: { eyebrow: string; title: string; action: string }) {
  return <header className="panel-header"><div><p>{eyebrow}</p><h2>{title}</h2></div><button>{action} <span>→</span></button></header>;
}
