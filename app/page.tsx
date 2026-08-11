"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import HRWorkspace from "./hr-workspace";

type ModuleKey = "finance" | "sales" | "hr";

type ERPAlert = {
  id: string;
  category: string;
  title: string;
  description: string;
  time: string;
  destination?: { module: ModuleKey; hrView?: string };
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
  { id: "finance-close", category: "재무", title: "월 마감 검토", description: "미증빙 자료와 단가 오류 내역을 마감 전에 검토해 주세요.", time: "D-2", destination: { module: "finance" } },
  { id: "sync-complete", category: "시스템", title: "마감 데이터 동기화 완료", description: "재무·영업 데이터가 최신 상태로 반영되었습니다.", time: "방금 전" },
  { id: "permission-applied", category: "권한", title: "사용자 권한 설정 적용", description: "김권찬 관리자 권한이 정상적으로 적용되었습니다.", time: "오늘" },
] satisfies ERPAlert[];

const accountRows = [
  { bank: "KB국민 · 운영", balance: "₩1,284,500,000", move: "+4.2%", tone: "up" },
  { bank: "KB국민 · 급여", balance: "₩186,240,000", move: "9/5 지급", tone: "neutral" },
  { bank: "우리 · 외화", balance: "$348,200", move: "+1.8%", tone: "up" },
  { bank: "KB증권 · CMA", balance: "₩524,000,000", move: "운용 중", tone: "neutral" },
];

const financeTasks = [
  { label: "7월 세금계산서 마감", owner: "회계", done: true },
  { label: "매입고지단가 오류 14건 확인", owner: "구매·영업", done: false },
  { label: "법인카드 미증빙 8건 보완", owner: "전사", done: false },
  { label: "법인세 차감 전 이익 산출", owner: "재무", done: false },
  { label: "급여·상여 최종 승인", owner: "대표", done: false },
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
    title: "현금과 마감을 한 화면에서",
    desc: "잔액, 채권·채무, 월 마감과 급여 집행까지 오늘의 재무 흐름을 확인합니다.",
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
  }).format(Math.max(0, value));
}

function ERPTopNavigation({ active, onChange, onOpenAlert }: { active: ModuleKey; onChange: (module: ModuleKey) => void; onOpenAlert: (alert: ERPAlert) => void }) {
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [dismissedAlertIds, setDismissedAlertIds] = useState<string[]>([]);
  const visibleAlerts = erpAlerts.filter((alert) => !dismissedAlertIds.includes(alert.id));

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("xdnode-dismissed-alerts");
      if (saved) setDismissedAlertIds(JSON.parse(saved) as string[]);
    } catch {
      setDismissedAlertIds([]);
    }
  }, []);

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
          <div><strong>마감 데이터 동기화</strong><small>방금 전 완료</small></div>
        </div>
        <button
          type="button"
          className="erp-alarm-button"
          aria-label={`확인할 알람 ${visibleAlerts.length}건`}
          aria-expanded={alertsOpen}
          onClick={() => setAlertsOpen(true)}
        >
          <span className="erp-alarm-glyph" aria-hidden="true">♢</span>
          <span>알람</span>
          <em>{visibleAlerts.length}</em>
        </button>
      </header>

      {alertsOpen && (
        <>
          <button type="button" className="erp-alarm-backdrop" aria-label="알람 닫기" onClick={() => setAlertsOpen(false)} />
          <aside className="erp-alarm-panel" role="dialog" aria-modal="true" aria-label="확인할 알람">
            <div className="erp-alarm-panel-header">
              <div><p>NOTIFICATION CENTER</p><h2>확인할 알람</h2></div>
              <button type="button" aria-label="닫기" onClick={() => setAlertsOpen(false)}>×</button>
            </div>
            <div className="erp-alarm-summary"><strong>확인 필요 {visibleAlerts.length}건</strong><span>업무 알람은 관련 화면에서 해결하고, 단순 알람은 확인 후 끌 수 있습니다.</span></div>
            <div className="erp-alarm-list">
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
              {visibleAlerts.length === 0 && <div className="erp-alarm-empty"><span>✓</span><strong>모든 알람을 확인했습니다.</strong><p>새로운 확인 사항이 생기면 이곳에 표시됩니다.</p></div>}
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
  const [quickOpen, setQuickOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [salePrice, setSalePrice] = useState(100000000);
  const [costPrice, setCostPrice] = useState(90000000);
  const [leadType, setLeadType] = useState<"outbound" | "inbound" | "ram">("outbound");

  const incentive = useMemo(() => {
    const margin = salePrice - costPrice;
    const rate = salePrice > 0 ? margin / salePrice : 0;
    const eligible = leadType === "outbound" && rate > 0.05;
    const payout = eligible ? (margin - salePrice * 0.05) * 0.05 : 0;
    return { margin, rate, eligible, payout };
  }, [salePrice, costPrice, leadType]);

  const copy = moduleCopy[active];

  function openAlert(alert: ERPAlert) {
    if (!alert.destination) return;
    if (alert.destination.hrView) {
      setHrNavigation((current) => ({ view: alert.destination?.hrView ?? current.view, requestKey: current.requestKey + 1 }));
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

  if (active === "hr") {
    return (
      <div className="hr-module-shell">
        <ERPTopNavigation active={active} onChange={(module) => { setActive(module); setSearch(""); }} onOpenAlert={openAlert} />
        <HRWorkspace requestedView={hrNavigation.view} navigationRequestKey={hrNavigation.requestKey} />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <ERPTopNavigation active={active} onChange={(module) => { setActive(module); setSearch(""); }} onOpenAlert={openAlert} />

      <main className="main">
        <header className="topbar">
          <div className="mobile-brand">XD NODE</div>
          <label className="search-box">
            <span aria-hidden="true">⌕</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={copy.search}
              aria-label={copy.search}
            />
            <kbd>⌘ K</kbd>
          </label>
          <div className="top-actions">
            <button className="period-button">2026년 8월 <span>⌄</span></button>
            <button className="icon-button" aria-label="알림">●<span className="notification-ping" /></button>
          </div>
        </header>

        <section className={`module-hero ${active}`}>
          <div>
            <p className="eyebrow">{modules.find((item) => item.key === active)?.eyebrow} workspace</p>
            <h1>{copy.title}</h1>
            <p>{copy.desc}</p>
          </div>
          <div className="hero-actions">
            <button className="secondary-button">내보내기</button>
            <button className="primary-button" onClick={() => setQuickOpen(true)}><span>＋</span>{copy.action}</button>
          </div>
        </section>

        <div className="attention-strip">
          <span className="attention-icon">!</span>
          <div>
            <strong>월 마감 D-2</strong>
            <span>7월 매입고지단가 오류 14건과 미증빙 8건의 확인이 필요합니다.</span>
          </div>
          <button onClick={() => setActive("finance")}>검토 목록 열기 →</button>
        </div>

        {active === "finance" && <FinanceDashboard search={search} />}
        {active === "sales" && (
          <SalesDashboard
            search={search}
            salePrice={salePrice}
            costPrice={costPrice}
            leadType={leadType}
            incentive={incentive}
            onSalePrice={setSalePrice}
            onCostPrice={setCostPrice}
            onLeadType={setLeadType}
          />
        )}
        {active === "hr" && <HrDashboard search={search} />}
      </main>

      {quickOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setQuickOpen(false)}>
          <form className="quick-modal" onSubmit={saveQuick} onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-heading">
              <div>
                <p className="eyebrow">Quick create</p>
                <h2>{copy.action}</h2>
              </div>
              <button type="button" aria-label="닫기" onClick={() => setQuickOpen(false)}>×</button>
            </div>
            <label>
              제목
              <input required autoFocus placeholder={`${copy.action} 제목을 입력하세요`} />
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

function FinanceDashboard({ search }: { search: string }) {
  const rows = accountRows.filter((row) => row.bank.toLowerCase().includes(search.toLowerCase()));
  const chart = [42, 48, 44, 55, 63, 58, 71, 68, 75, 79, 73, 86];
  return (
    <div className="dashboard-stack">
      <section className="kpi-grid">
        <Metric label="가용 현금" value="₩2.46B" delta="전월 대비 +6.8%" trend="up" hint="4개 계좌 합계" />
        <Metric label="이번 달 유입" value="₩1.84B" delta="목표의 82%" trend="up" hint="확정 매출 기준" />
        <Metric label="예정 지출" value="₩924M" delta="급여 포함" trend="neutral" hint="30일 이내" />
        <Metric label="미수금" value="₩186M" delta="연체 3건" trend="down" hint="회수율 91.4%" />
      </section>

      <section className="content-grid finance-grid">
        <article className="panel cash-panel">
          <PanelHeader eyebrow="Cash position" title="12개월 현금 흐름" action="상세 보기" />
          <div className="chart-summary"><strong>₩2.46B</strong><span>8월 예상 잔액</span><em>+₩158M</em></div>
          <div className="bar-chart" aria-label="12개월 현금 흐름 막대 차트">
            {chart.map((height, index) => <span key={index} style={{ height: `${height}%` }} className={index === 11 ? "current" : ""} />)}
          </div>
          <div className="chart-labels"><span>9월</span><span>12월</span><span>3월</span><span>6월</span><span>8월</span></div>
        </article>

        <article className="panel close-panel">
          <PanelHeader eyebrow="Monthly closing" title="7월 마감 진행률" action="전체 업무" />
          <div className="progress-ring"><span>64<small>%</small></span></div>
          <div className="task-list">
            {financeTasks.map((task) => (
              <div className="task-row" key={task.label}>
                <span className={task.done ? "check done" : "check"}>{task.done ? "✓" : ""}</span>
                <div><strong>{task.label}</strong><small>{task.owner}</small></div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="content-grid lower-grid">
        <article className="panel table-panel">
          <PanelHeader eyebrow="Bank accounts" title="계좌 잔액" action="잔액 업데이트" />
          <div className="data-table accounts-table">
            {rows.map((row) => (
              <div className="data-row" key={row.bank}>
                <span className="bank-icon">KB</span>
                <strong>{row.bank}</strong>
                <b>{row.balance}</b>
                <em className={row.tone}>{row.move}</em>
                <button aria-label={`${row.bank} 더보기`}>•••</button>
              </div>
            ))}
          </div>
        </article>
        <article className="panel deadline-panel">
          <PanelHeader eyebrow="Upcoming" title="다가오는 자금 일정" action="캘린더" />
          <div className="deadline-item"><span><b>12</b> AUG</span><div><strong>원천세·4대보험</strong><small>예상 ₩42,800,000</small></div></div>
          <div className="deadline-item"><span><b>20</b> AUG</span><div><strong>구매대금 정기지급</strong><small>승인 대기 7건</small></div></div>
          <div className="deadline-item"><span><b>05</b> SEP</span><div><strong>8월 급여 지급</strong><small>7월 인센티브 포함</small></div></div>
        </article>
      </section>
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
          <div className="approval-item"><span className="avatar small">SY</span><div><strong>박서연 · 연차</strong><small>8월 14일 · 1일</small></div><em>연차</em><button>검토</button></div>
          <div className="approval-item"><span className="avatar small">DY</span><div><strong>이도윤 · 마이너스 연차</strong><small>8월 16일 · 0.5일</small></div><em className="warn">예외</em><button>검토</button></div>
          <div className="approval-item"><span className="avatar small">HJ</span><div><strong>최유진 · 법인카드</strong><small>증빙 보완 요청</small></div><em>비용</em><button>검토</button></div>
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
