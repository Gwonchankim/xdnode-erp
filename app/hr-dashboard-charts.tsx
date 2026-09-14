"use client";

import type { FlowMonth } from "./hr-dashboard-model";

/** HR 대시보드의 작은 차트들. 전부 데이터로 그리는 인라인 SVG/HTML 이라 CSS 에 숫자를 고정해 두는 일이 없다.
 *  이 ERP 는 무채색 디자인이라 데이터 색도 잉크 계열 3단계로만 쓴다. 색만으로 구분하지 않도록
 *  범례·직접 라벨을 늘 같이 둔다. 스타일은 public/hr-workspace.css 의 .dash-* 규칙이다. */
export const SERIES_COLORS = ["#18181b", "#71717a", "#a1a1aa", "#d4d4d8"];

export function CompositionBar({ segments, total }: { segments: { label: string; count: number; share: number }[]; total: number }) {
  // 색은 4단계까지만. 그 뒤는 "기타"로 접는다 — 늘어나는 색은 읽히지 않는다.
  const shown = segments.slice(0, 3);
  const rest = segments.slice(3);
  const rows = rest.length ? [...shown, { label: "기타", count: rest.reduce((sum, item) => sum + item.count, 0), share: rest.reduce((sum, item) => sum + item.share, 0) }] : shown;
  return (
    <div className="dash-composition">
      <div className="dash-composition-bar" role="img" aria-label={rows.map((row) => `${row.label} ${row.count}명`).join(", ")}>
        {rows.map((row, index) => row.count > 0 && (
          <span key={row.label} style={{ flexGrow: row.count, background: SERIES_COLORS[index] }} title={`${row.label} ${row.count}명 (${Math.round(row.share * 100)}%)`} />
        ))}
      </div>
      <ul className="dash-legend">
        {rows.map((row, index) => (
          <li key={row.label}><i style={{ background: SERIES_COLORS[index] }} /><span>{row.label}</span><strong>{row.count}명</strong><em>{total ? `${Math.round(row.share * 100)}%` : "-"}</em></li>
        ))}
      </ul>
    </div>
  );
}

export function HorizontalBars({ rows, unit = "명" }: { rows: { label: string; value: number; note?: string }[]; unit?: string }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <div className="dash-bars">
      {rows.map((row) => (
        <div className="dash-bar-row" key={row.label} title={`${row.label} ${row.value}${unit}`}>
          <span className="dash-bar-label">{row.label}</span>
          <div className="dash-bar-track"><i style={{ width: `${(row.value / max) * 100}%` }} /></div>
          <strong className="dash-bar-value">{row.value}<small>{unit}</small>{row.note && <em>{row.note}</em>}</strong>
        </div>
      ))}
    </div>
  );
}

/** 최근 12개월 입사·퇴사. 같은 달의 두 기둥을 나란히 세우고, 월말 재직 인원은 표 보기에서 함께 읽는다. */
export function MonthlyFlowChart({ months }: { months: FlowMonth[] }) {
  const width = 640, height = 190, top = 14, bottom = 30, left = 26, right = 8;
  const plotHeight = height - top - bottom;
  const max = Math.max(1, ...months.map((month) => Math.max(month.joins, month.exits)));
  const ticks = max <= 4 ? Array.from({ length: max + 1 }, (_, index) => index) : [0, Math.ceil(max / 2), max];
  const slot = (width - left - right) / Math.max(1, months.length);
  const barWidth = Math.min(14, slot * 0.32);
  const y = (value: number) => top + plotHeight - (value / max) * plotHeight;
  const last = months.length - 1;
  return (
    <figure className="dash-flow">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="최근 12개월 입사·퇴사 인원">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} className="dash-grid" />
            <text x={left - 6} y={y(tick) + 3.5} textAnchor="end" className="dash-tick">{tick}</text>
          </g>
        ))}
        {months.map((month, index) => {
          const center = left + slot * index + slot / 2;
          const joinX = center - barWidth - 1;
          const exitX = center + 1;
          return (
            <g key={month.month}>
              <title>{`${month.month} · 입사 ${month.joins}명 · 퇴사 ${month.exits}명 · 월말 재직 ${month.headcount}명`}</title>
              <rect x={joinX} y={y(month.joins)} width={barWidth} height={Math.max(0, y(0) - y(month.joins))} rx={month.joins ? 3 : 0} fill={SERIES_COLORS[0]} />
              <rect x={exitX} y={y(month.exits)} width={barWidth} height={Math.max(0, y(0) - y(month.exits))} rx={month.exits ? 3 : 0} fill={SERIES_COLORS[1]} />
              {index === last && month.joins > 0 && <text x={joinX + barWidth / 2} y={y(month.joins) - 4} textAnchor="middle" className="dash-value">{month.joins}</text>}
              {index === last && month.exits > 0 && <text x={exitX + barWidth / 2} y={y(month.exits) - 4} textAnchor="middle" className="dash-value">{month.exits}</text>}
              <text x={center} y={height - 10} textAnchor="middle" className={`dash-axis${index === last ? " current" : ""}`}>{month.label}</text>
            </g>
          );
        })}
        <line x1={left} x2={width - right} y1={y(0)} y2={y(0)} className="dash-baseline" />
      </svg>
      <figcaption>
        <ul className="dash-legend inline">
          <li><i style={{ background: SERIES_COLORS[0] }} /><span>입사</span></li>
          <li><i style={{ background: SERIES_COLORS[1] }} /><span>퇴사</span></li>
        </ul>
        <details className="dash-table-view">
          <summary>표로 보기</summary>
          <table className="data-table dashboard-mini-table">
            <thead><tr><th>월</th><th>입사</th><th>퇴사</th><th>월말 재직</th></tr></thead>
            <tbody>{months.map((month) => <tr key={month.month}><td>{month.month}</td><td>{month.joins}</td><td>{month.exits}</td><td>{month.headcount}</td></tr>)}</tbody>
          </table>
        </details>
      </figcaption>
    </figure>
  );
}

export function FillMeter({ filled, requested, active }: { filled: number; requested: number; active: number }) {
  const ratio = requested ? Math.min(1, filled / requested) : 0;
  return (
    <div className="dash-meter" title={`충원 ${filled}/${requested}명 · 진행 중 지원자 ${active}명`}>
      <div className="dash-meter-track"><i style={{ width: `${ratio * 100}%` }} /></div>
      <span>{filled}<small>/{requested}명</small></span>
    </div>
  );
}

const PAYROLL_STEP_LABELS: Record<string, string> = { DRAFT: "초안", REVIEW: "검토", APPROVED: "승인", LOCKED: "마감" };

export function PayrollStepper({ status, steps }: { status: string; steps: readonly string[] }) {
  const current = Math.max(0, steps.indexOf(status));
  return (
    <ol className="dash-stepper" aria-label={`급여 단계 ${PAYROLL_STEP_LABELS[status] ?? status}`}>
      {steps.map((step, index) => (
        <li key={step} className={index < current ? "done" : index === current ? "current" : ""}>
          <i>{index < current ? "✓" : index + 1}</i><span>{PAYROLL_STEP_LABELS[step] ?? step}</span>
        </li>
      ))}
    </ol>
  );
}
