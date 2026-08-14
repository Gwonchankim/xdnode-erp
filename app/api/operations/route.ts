import { env } from "cloudflare:workers";
import { financeCurrentData } from "../../finance-current-data";
import { authorizeErpRequest, safeJson, writeErpAudit } from "../../erp-platform";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;

type TaskRow = {
  id: string;
  module: string;
  category: string;
  title: string;
  description: string;
  owner_employee_id: string;
  due_date: string;
  status: string;
  priority: string;
  destination: string;
  source_type: string;
  source_id: string;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
};

type SyncRow = {
  id: string;
  source: string;
  scope: string;
  snapshot_date: string;
  status: string;
  record_count: number;
  metrics_json: string;
  error_message: string;
  started_at: number;
  completed_at: number | null;
};

type AuditRow = {
  id: string;
  actor_email: string;
  actor_employee_id: string;
  module: string;
  action: string;
  entity_type: string;
  entity_id: string;
  reason: string;
  created_at: number;
};

const allowedStatuses = new Set(["OPEN", "IN_PROGRESS", "WAITING", "DONE"]);
const allowedPriorities = new Set(["LOW", "NORMAL", "HIGH", "CRITICAL"]);
const allowedModules = new Set(["operations", "finance", "hr", "recruitment", "sales"]);

function toTask(row: TaskRow) {
  return {
    id: row.id,
    module: row.module,
    category: row.category,
    title: row.title,
    description: row.description,
    ownerEmployeeId: row.owner_employee_id,
    dueDate: row.due_date,
    status: row.status,
    priority: row.priority,
    destination: row.destination,
    sourceType: row.source_type,
    sourceId: row.source_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

async function seedCurrentOperations() {
  const now = Date.now();
  const syncId = `clobe-finance-${financeCurrentData.asOf}`;
  const bankAssets = financeCurrentData.accountSummary.checkingBalanceSum + financeCurrentData.accountSummary.fxBalanceSumKrw;
  const statements = [
    db.prepare(`INSERT OR IGNORE INTO erp_sync_runs
      (id, source, scope, snapshot_date, status, record_count, metrics_json,
        error_message, started_at, completed_at, created_at)
      VALUES (?, 'CLOBE', 'FINANCE_2026', ?, 'SUCCESS', ?, ?, '', ?, ?, ?)`)
      .bind(syncId, financeCurrentData.asOf, financeCurrentData.journalSummary.lineCount,
        JSON.stringify({
          checkingBalance: financeCurrentData.accountSummary.checkingBalanceSum,
          fxBalanceKrw: financeCurrentData.accountSummary.fxBalanceSumKrw,
          bankAssets,
          loanBalance: financeCurrentData.accountSummary.loanBalanceSum,
          journalDebit: financeCurrentData.journalSummary.debitAmountKrw,
          journalCredit: financeCurrentData.journalSummary.creditAmountKrw,
          journalDifference: financeCurrentData.journalSummary.differenceKrw,
        }), now, now, now),
  ];
  if (financeCurrentData.journalSummary.differenceKrw !== 0) {
    statements.push(db.prepare(`INSERT OR IGNORE INTO erp_tasks
      (id, module, category, title, description, owner_employee_id, due_date, status,
        priority, destination, source_type, source_id, created_at, updated_at)
      VALUES (?, 'finance', '장부 점검', ?, ?, 'gc.kim', ?, 'OPEN', 'HIGH',
        'finance:quality', 'SYSTEM_RULE', ?, ?, ?)`)
      .bind(`journal-difference-${financeCurrentData.asOf}`,
        `분개장 차대변 ${financeCurrentData.journalSummary.differenceKrw.toLocaleString("ko-KR")}원 차이 확인`,
        `차변 ${financeCurrentData.journalSummary.debitAmountKrw.toLocaleString("ko-KR")}원 · 대변 ${financeCurrentData.journalSummary.creditAmountKrw.toLocaleString("ko-KR")}원`,
        financeCurrentData.asOf, syncId, now, now));
  } else {
    statements.push(db.prepare(`UPDATE erp_tasks SET status = 'DONE', completed_at = ?, updated_at = ?
      WHERE id = ? AND status <> 'DONE'`)
      .bind(now, now, `journal-difference-${financeCurrentData.asOf}`));
  }
  await db.batch(statements);
}

async function upsertRuleTask(input: {
  id: string; module: string; category: string; title: string; description: string;
  dueDate: string; priority: string; destination: string; sourceId: string;
}) {
  const now = Date.now();
  await db.prepare(`INSERT INTO erp_tasks
    (id, module, category, title, description, owner_employee_id, due_date, status,
      priority, destination, source_type, source_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'gc.kim', ?, 'OPEN', ?, ?, 'SYSTEM_RULE', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description,
      due_date = excluded.due_date, priority = excluded.priority, destination = excluded.destination,
      source_id = excluded.source_id,
      status = CASE WHEN erp_tasks.status = 'DONE' AND erp_tasks.source_id <> excluded.source_id
        THEN 'OPEN' ELSE erp_tasks.status END,
      completed_at = CASE WHEN erp_tasks.status = 'DONE' AND erp_tasks.source_id <> excluded.source_id
        THEN NULL ELSE erp_tasks.completed_at END,
      deleted_at = NULL, updated_at = excluded.updated_at`)
    .bind(input.id, input.module, input.category, input.title, input.description, input.dueDate,
      input.priority, input.destination, input.sourceId, now, now).run();
}

async function closeRuleTask(id: string) {
  const now = Date.now();
  await db.prepare(`UPDATE erp_tasks SET status = 'DONE', completed_at = COALESCE(completed_at, ?), updated_at = ?
    WHERE id = ? AND status <> 'DONE' AND deleted_at IS NULL`).bind(now, now, id).run();
}

async function seedStateDrivenOperations() {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const ownerMissing = await db.prepare(`SELECT COUNT(*) AS count FROM hr_applicants
      WHERE TRIM(owner_id) = '' AND stage NOT IN ('불합격', '채용 완료')`).first<{ count: number }>();
    const count = ownerMissing?.count ?? 0;
    if (count > 0) {
      await upsertRuleTask({
        id: "recruitment-owner-missing", module: "recruitment", category: "담당자 지정",
        title: `담당자 미지정 지원자 ${count}명 확인`,
        description: "지원자별 채용담당자를 지정해야 다음 단계의 책임과 알림이 연결됩니다.",
        dueDate: today, priority: "HIGH", destination: "hr:recruitment", sourceId: String(count),
      });
    } else await closeRuleTask("recruitment-owner-missing");

    const staleBefore = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const stalled = await db.prepare(`SELECT COUNT(*) AS count FROM hr_applicants
      WHERE updated_at < ? AND stage NOT IN ('불합격', '채용 완료')`).bind(staleBefore).first<{ count: number }>();
    const stalledCount = stalled?.count ?? 0;
    if (stalledCount > 0) {
      await upsertRuleTask({
        id: "recruitment-stalled", module: "recruitment", category: "채용 지연",
        title: `7일 이상 정체된 지원자 ${stalledCount}명 확인`,
        description: "지원 현황에서 장기 미갱신 지원자의 다음 단계와 연락 이력을 확인해 주세요.",
        dueDate: today, priority: "NORMAL", destination: "hr:recruitment", sourceId: String(stalledCount),
      });
    } else await closeRuleTask("recruitment-stalled");
  } catch {
    // 채용 기능을 처음 열기 전에는 테이블이 없을 수 있으므로 규칙 평가를 다음 조회로 미룹니다.
  }

  try {
    const payroll = await db.prepare(`SELECT period, status FROM hr_payroll_runs
      ORDER BY period DESC LIMIT 1`).first<{ period: string; status: string }>();
    if (payroll && payroll.status !== "LOCKED") {
      await upsertRuleTask({
        id: `payroll-open-${payroll.period}`, module: "hr", category: "급여 마감",
        title: `${payroll.period} 급여 마감 필요`,
        description: `현재 상태는 ${payroll.status}입니다. 검토·승인 후 잠금까지 완료해 주세요.`,
        dueDate: today, priority: "HIGH", destination: "hr:payroll", sourceId: payroll.status,
      });
    } else if (payroll) await closeRuleTask(`payroll-open-${payroll.period}`);
  } catch {
    // 급여 기능을 처음 열기 전에는 테이블이 없을 수 있으므로 규칙 평가를 다음 조회로 미룹니다.
  }

  try {
    const purchaseExceptions = await db.prepare(`SELECT COUNT(*) AS count FROM finance_purchase_invoices
      WHERE status = 'EXCEPTION'`).first<{ count: number }>();
    const count = purchaseExceptions?.count ?? 0;
    if (count > 0) {
      await upsertRuleTask({
        id: "purchase-match-exceptions", module: "finance", category: "매입 대사",
        title: `발주·검수·인보이스 대사 예외 ${count}건 확인`,
        description: "발주 공급가 또는 합격 검수금액을 초과한 매입 인보이스는 지급 요청이 차단되어 있습니다.",
        dueDate: today, priority: "HIGH", destination: "finance:purchasing", sourceId: String(count),
      });
    } else await closeRuleTask("purchase-match-exceptions");
  } catch {
    // 구매 기능을 처음 열기 전에는 테이블이 없을 수 있으므로 규칙 평가를 다음 조회로 미룹니다.
  }

  try {
    const bankReconciliation = await db.prepare(`SELECT COUNT(*) AS imported_count,
      SUM(CASE WHEN transaction_row.currency = 'KRW' AND transaction_row.amount > COALESCE((
        SELECT SUM(match_row.matched_amount) FROM finance_cash_matches match_row
        WHERE match_row.bank_transaction_id = transaction_row.id AND match_row.status = 'CONFIRMED'
      ), 0) THEN 1 ELSE 0 END) AS pending_count,
      SUM(CASE WHEN transaction_row.currency = 'KRW' AND transaction_row.is_unclassified = 1
        AND transaction_row.amount > COALESCE((SELECT SUM(match_row.matched_amount)
          FROM finance_cash_matches match_row WHERE match_row.bank_transaction_id = transaction_row.id
            AND match_row.status = 'CONFIRMED'), 0) THEN 1 ELSE 0 END) AS unclassified_count,
      MAX(transaction_row.source_snapshot_date) AS snapshot_date
      FROM finance_bank_transactions transaction_row`).first<{
        imported_count: number; pending_count: number; unclassified_count: number; snapshot_date: string | null;
      }>();
    const pending = bankReconciliation?.pending_count ?? 0;
    if ((bankReconciliation?.imported_count ?? 0) > 0 && pending > 0) {
      await upsertRuleTask({
        id: "cash-reconciliation-pending", module: "finance", category: "자금 대사",
        title: `미대사 은행 거래 ${pending}건 확인`,
        description: `Clobe 거래 원문 중 미분류 우선검토 ${bankReconciliation?.unclassified_count ?? 0}건을 포함합니다. 자동 후보를 검토하고 원장을 확정 연결해 주세요.`,
        dueDate: today, priority: (bankReconciliation?.unclassified_count ?? 0) > 0 ? "HIGH" : "NORMAL",
        destination: "finance:reconciliation", sourceId: `${bankReconciliation?.snapshot_date ?? ""}:${pending}`,
      });
    } else await closeRuleTask("cash-reconciliation-pending");
  } catch {
    // 자금 대사 기능을 처음 열기 전에는 테이블이 없을 수 있으므로 규칙 평가를 다음 조회로 미룹니다.
  }

  try {
    const forecastRisk = await db.prepare(`SELECT snapshot.as_of, snapshot.scenario,
      snapshot.low_week_count, snapshot.missing_date_count, snapshot.minimum_cash_balance,
      snapshot.lowest_cash FROM finance_cash_forecast_snapshots snapshot
      JOIN finance_cash_forecast_settings settings ON settings.id = 'default'
        AND settings.default_scenario = snapshot.scenario
      ORDER BY snapshot.as_of DESC, snapshot.updated_at DESC LIMIT 1`).first<{
        as_of: string; scenario: string; low_week_count: number; missing_date_count: number;
        minimum_cash_balance: number; lowest_cash: number;
      }>();
    if (forecastRisk && (forecastRisk.low_week_count > 0 || forecastRisk.missing_date_count > 0)) {
      const title = forecastRisk.low_week_count > 0
        ? `13주 자금예측 위험 주차 ${forecastRisk.low_week_count}주 확인`
        : `자금예측 예정일 누락 ${forecastRisk.missing_date_count}건 보완`;
      await upsertRuleTask({
        id: "cash-forecast-risk", module: "finance", category: "자금예측", title,
        description: forecastRisk.low_week_count > 0
          ? `기본 시나리오의 최저 예상잔액이 ${forecastRisk.lowest_cash.toLocaleString("ko-KR")}원으로 최소운영자금 ${forecastRisk.minimum_cash_balance.toLocaleString("ko-KR")}원을 하회합니다. 예정일 누락 ${forecastRisk.missing_date_count}건도 함께 확인해 주세요.`
          : `지급·수금 원천 중 예정일이 없는 ${forecastRisk.missing_date_count}건은 13주 예측에서 제외되어 있습니다.`,
        dueDate: today, priority: forecastRisk.low_week_count > 0 ? "CRITICAL" : "HIGH",
        destination: "finance:forecast",
        sourceId: `${forecastRisk.as_of}:${forecastRisk.scenario}:${forecastRisk.low_week_count}:${forecastRisk.missing_date_count}`,
      });
    } else await closeRuleTask("cash-forecast-risk");
  } catch {
    // 자금예측을 처음 열기 전에는 스냅샷 테이블이 없을 수 있으므로 규칙 평가를 다음 조회로 미룹니다.
  }

  try {
    const closeRun = await db.prepare(`SELECT period, period_end, status, control_fail_count,
      manual_completed_count, manual_total_count, evidence_count FROM finance_close_runs
      WHERE period = ? ORDER BY updated_at DESC LIMIT 1`).bind(financeCurrentData.asOf.slice(0, 7)).first<{
        period: string; period_end: string; status: string; control_fail_count: number;
        manual_completed_count: number; manual_total_count: number; evidence_count: number;
      }>();
    const closeIncomplete = closeRun && closeRun.status === "OPEN"
      && (closeRun.control_fail_count > 0 || closeRun.manual_completed_count < closeRun.manual_total_count || closeRun.evidence_count === 0);
    if (closeIncomplete && closeRun) await upsertRuleTask({
      id: "month-close-controls", module: "finance", category: "월마감",
      title: `${closeRun.period} 월마감 통제 ${closeRun.control_fail_count}건 확인`,
      description: `자동 통제 실패 ${closeRun.control_fail_count}건 · 수동 검토 ${closeRun.manual_completed_count}/${closeRun.manual_total_count} · 증빙 ${closeRun.evidence_count}건입니다.`,
      dueDate: closeRun.period_end, priority: closeRun.control_fail_count > 0 ? "HIGH" : "NORMAL",
      destination: "finance:close", sourceId: `${closeRun.period}:${closeRun.control_fail_count}:${closeRun.manual_completed_count}:${closeRun.evidence_count}`,
    });
    else await closeRuleTask("month-close-controls");
  } catch {
    // 월마감 통제 화면을 처음 열기 전에는 실행 원장이 없을 수 있으므로 다음 조회로 미룹니다.
  }

  try {
    const year = Number(financeCurrentData.asOf.slice(0, 4));
    const month = Number(financeCurrentData.asOf.slice(5, 7));
    const day = Number(financeCurrentData.asOf.slice(8, 10));
    const monthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const lines = await db.prepare(`SELECT line.id, line.direction, line.actual_source, line.account_code, line.account_name,
        line.amount, line.threshold_pct,
        COALESCE(action.status, '') AS action_status
      FROM finance_budget_plan_lines line
      JOIN finance_budget_plans plan ON plan.id = line.plan_id AND plan.status = 'APPROVED'
      LEFT JOIN finance_budget_variance_actions action ON action.line_id = line.id
      WHERE plan.fiscal_year = ? AND line.month = ? AND line.department = '전사'`)
      .bind(year, month).all<{ id: string; direction: string; actual_source: string; account_code: string; account_name: string; amount: number; threshold_pct: number; action_status: string }>();
    const journalActuals = await db.prepare(`SELECT debit_account_code, debit_account_name, credit_account_code,
        credit_account_name, SUM(amount) AS amount FROM finance_journal_entries
      WHERE status = 'POSTED' AND substr(voucher_date, 1, 7) = ?
      GROUP BY debit_account_code, debit_account_name, credit_account_code, credit_account_name`)
      .bind(`${year}-${String(month).padStart(2, "0")}`).all<{ debit_account_code: string; debit_account_name: string; credit_account_code: string; credit_account_name: string; amount: number }>();
    const sales = financeCurrentData.salesMonthly2026.find((item) => item.month === `${year}-${String(month).padStart(2, "0")}`)?.amount ?? 0;
    const purchases = financeCurrentData.purchaseMonthly2026.find((item) => item.month === `${year}-${String(month).padStart(2, "0")}`)?.amount ?? 0;
    const alerts = lines.results.filter((line) => {
      if (line.action_status === "ACTIONED") return false;
      const comparison = Math.round(line.amount * day / monthDays);
      const actual = line.actual_source === "SALES_INVOICE" ? sales : line.actual_source === "PURCHASE_INVOICE" ? purchases
        : journalActuals.results.filter((entry) => line.actual_source === "POSTED_JOURNAL_DEBIT"
          ? (line.account_code ? entry.debit_account_code === line.account_code : entry.debit_account_name === line.account_name)
          : (line.account_code ? entry.credit_account_code === line.account_code : entry.credit_account_name === line.account_name))
          .reduce((sum, entry) => sum + entry.amount, 0);
      return line.direction === "REVENUE"
        ? actual < comparison * (1 - line.threshold_pct / 100)
        : actual > comparison * (1 + line.threshold_pct / 100);
    });
    if (alerts.length) await upsertRuleTask({
      id: "budget-variance-alert", module: "finance", category: "예산실적",
      title: `${year}년 ${month}월 예산 차이 ${alerts.length}건 조치 필요`,
      description: `승인 예산의 일할 기준과 실제 원천을 비교한 결과 허용범위를 벗어난 ${alerts.length}건에 원인·조치·담당·기한 등록이 필요합니다.`,
      dueDate: today, priority: "HIGH", destination: "finance:budget",
      sourceId: `${year}-${String(month).padStart(2, "0")}:${alerts.map((line) => line.id).sort().join(",")}`,
    });
    else await closeRuleTask("budget-variance-alert");
  } catch {
    // 예산실적 화면을 처음 열기 전에는 계획 원장이 없을 수 있으므로 다음 조회로 미룹니다.
  }

  try {
    const [partners, aliases, bankSummary, taxSummary, pendingSummary] = await Promise.all([
      db.prepare("SELECT normalized_key, canonical_name FROM finance_master_partners WHERE status = 'ACTIVE'").all<{ normalized_key: string; canonical_name: string }>(),
      db.prepare("SELECT source_name FROM finance_master_partner_aliases").all<{ source_name: string }>(),
      db.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(CASE WHEN gl_account_code = '' THEN 1 ELSE 0 END), 0) AS unmapped FROM finance_master_bank_accounts WHERE status = 'ACTIVE'").first<{ total: number; unmapped: number }>(),
      db.prepare("SELECT COUNT(*) AS count FROM finance_master_tax_codes WHERE status = 'ACTIVE'").first<{ count: number }>(),
      db.prepare("SELECT COUNT(*) AS count FROM finance_master_change_requests WHERE status = 'SUBMITTED'").first<{ count: number }>(),
    ]);
    const normalize = (value: string) => value.toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
    const keys = new Set([...partners.results.flatMap((row) => [row.normalized_key, normalize(row.canonical_name)]), ...aliases.results.map((row) => normalize(row.source_name))]);
    const externalNames = new Set([...financeCurrentData.salesDaily2026.map((row) => row.partner), ...financeCurrentData.purchaseDaily2026.map((row) => row.partner)]);
    const unmappedPartners = [...externalNames].filter((name) => !keys.has(normalize(name))).length;
    const unmappedBanks = bankSummary?.unmapped ?? 0;
    const pending = pendingSummary?.count ?? 0;
    const missingTax = (taxSummary?.count ?? 0) === 0;
    if (unmappedPartners > 0 || unmappedBanks > 0 || missingTax || pending > 0) await upsertRuleTask({
      id: "finance-master-quality", module: "finance", category: "재무 마스터",
      title: `재무 마스터 보완 ${unmappedPartners + unmappedBanks + (missingTax ? 1 : 0)}건 확인`,
      description: `Clobe 거래처 미연결 ${unmappedPartners}곳 · 계좌 GL 미연결 ${unmappedBanks}개 · 세금코드 ${missingTax ? "미등록" : "등록"} · 변경 결재 중 ${pending}건입니다.`,
      dueDate: today, priority: unmappedBanks > 0 || missingTax ? "HIGH" : "NORMAL", destination: "finance:master",
      sourceId: `${financeCurrentData.asOf}:${unmappedPartners}:${unmappedBanks}:${missingTax ? 1 : 0}:${pending}`,
    });
    else await closeRuleTask("finance-master-quality");
  } catch {
    // 통합 재무 마스터를 처음 열기 전에는 테이블이 없을 수 있으므로 다음 조회로 미룹니다.
  }

  try {
    const asOf = new Date(`${financeCurrentData.asOf}T00:00:00Z`);
    asOf.setUTCDate(1); asOf.setUTCDate(0);
    const reportPeriod = asOf.toISOString().slice(0, 7);
    const report = await db.prepare(`SELECT id, status, version FROM finance_management_reports
      WHERE period = ? ORDER BY version DESC LIMIT 1`).bind(reportPeriod).first<{ id: string; status: string; version: number }>();
    if (!report || report.status === "DRAFT") await upsertRuleTask({
      id: "management-report-due", module: "finance", category: "경영보고",
      title: `${reportPeriod} 월간 경영보고 ${report ? "결재 제출" : "초안 작성"} 필요`,
      description: report ? `v${report.version} 초안의 원천·품질경고·경영진 문안을 확인하고 결재를 제출해 주세요.`
        : "매출·매입·자금·미수·급여·예산·월마감 원천을 동결한 월간 보고서를 생성해 주세요.",
      dueDate: `${financeCurrentData.asOf.slice(0, 8)}10`, priority: "HIGH", destination: "finance:report",
      sourceId: `${reportPeriod}:${report?.status ?? "MISSING"}:${report?.version ?? 0}`,
    });
    else await closeRuleTask("management-report-due");

    const openActions = await db.prepare(`SELECT COUNT(*) AS count,
      COALESCE(SUM(CASE WHEN action.due_date < ? THEN 1 ELSE 0 END), 0) AS overdue,
      MIN(CASE WHEN action.status <> 'DONE' THEN action.due_date END) AS nearest_due
      FROM finance_management_report_actions action
      JOIN finance_management_reports report ON report.id = action.report_id
      WHERE action.status <> 'DONE' AND report.status IN ('DRAFT','SUBMITTED','APPROVED')
        AND report.version = (SELECT MAX(peer.version) FROM finance_management_reports peer WHERE peer.period = report.period)`)
      .bind(today).first<{ count: number; overdue: number; nearest_due: string | null }>();
    if ((openActions?.count ?? 0) > 0) await upsertRuleTask({
      id: "management-report-actions", module: "finance", category: "경영보고 조치",
      title: `경영보고 후속조치 ${openActions?.count ?? 0}건 진행 필요`,
      description: `기한 경과 ${openActions?.overdue ?? 0}건을 포함합니다. 보고서에서 담당자·기한·진행상태를 확인해 주세요.`,
      dueDate: openActions?.nearest_due ?? today, priority: (openActions?.overdue ?? 0) > 0 ? "HIGH" : "NORMAL",
      destination: "finance:report", sourceId: `${openActions?.count ?? 0}:${openActions?.overdue ?? 0}:${openActions?.nearest_due ?? ""}`,
    });
    else await closeRuleTask("management-report-actions");
  } catch {
    // 경영보고 원장이 배포된 뒤부터 기한·후속조치 규칙을 평가합니다.
  }
}

export async function GET() {
  const auth = await authorizeErpRequest(db, "operations", "read");
  if (auth.response) return auth.response;
  await seedCurrentOperations();
  await seedStateDrivenOperations();

  const [taskResult, syncResult, auditResult] = await Promise.all([
    db.prepare(`SELECT id, module, category, title, description, owner_employee_id,
      due_date, status, priority, destination, source_type, source_id,
      created_at, updated_at, completed_at
      FROM erp_tasks
      WHERE deleted_at IS NULL
      ORDER BY CASE status WHEN 'OPEN' THEN 0 WHEN 'IN_PROGRESS' THEN 1 WHEN 'WAITING' THEN 2 ELSE 3 END,
        CASE priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,
        due_date ASC, created_at DESC LIMIT 100`).all<TaskRow>(),
    db.prepare(`SELECT id, source, scope, snapshot_date, status, record_count, metrics_json,
      error_message, started_at, completed_at
      FROM erp_sync_runs ORDER BY snapshot_date DESC, created_at DESC LIMIT 30`).all<SyncRow>(),
    db.prepare(`SELECT id, actor_email, actor_employee_id, module, action, entity_type,
      entity_id, reason, created_at
      FROM erp_audit_logs ORDER BY created_at DESC LIMIT 50`).all<AuditRow>(),
  ]);

  const tasks = taskResult.results.map(toTask);
  return Response.json({
    principal: auth.principal,
    summary: {
      open: tasks.filter((task) => task.status === "OPEN").length,
      inProgress: tasks.filter((task) => task.status === "IN_PROGRESS").length,
      waiting: tasks.filter((task) => task.status === "WAITING").length,
      done: tasks.filter((task) => task.status === "DONE").length,
      critical: tasks.filter((task) => task.status !== "DONE" && task.priority === "CRITICAL").length,
    },
    tasks,
    syncRuns: syncResult.results.map((row) => ({
      id: row.id,
      source: row.source,
      scope: row.scope,
      snapshotDate: row.snapshot_date,
      status: row.status,
      recordCount: row.record_count,
      metrics: safeJson<Record<string, number>>(row.metrics_json, {}),
      errorMessage: row.error_message,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    })),
    audits: auditResult.results.map((row) => ({
      id: row.id,
      actorEmail: row.actor_email,
      actorEmployeeId: row.actor_employee_id,
      module: row.module,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      reason: row.reason,
      createdAt: row.created_at,
    })),
  });
}

export async function POST(request: Request) {
  const auth = await authorizeErpRequest(db, "operations", "write");
  if (auth.response) return auth.response;
  const body = await request.json() as Record<string, unknown>;
  const taskModule = typeof body.module === "string" ? body.module : "operations";
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 150) : "";
  const category = typeof body.category === "string" ? body.category.trim().slice(0, 50) : "일반";
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 1000) : "";
  const ownerEmployeeId = typeof body.ownerEmployeeId === "string" ? body.ownerEmployeeId.trim().slice(0, 60) : auth.principal.employeeId;
  const dueDate = typeof body.dueDate === "string" ? body.dueDate.trim() : "";
  const priority = typeof body.priority === "string" ? body.priority : "NORMAL";
  const destination = typeof body.destination === "string" ? body.destination.trim().slice(0, 120) : "";

  if (!allowedModules.has(taskModule) || !title || !allowedPriorities.has(priority)) {
    return Response.json({ error: "업무의 모듈, 제목 또는 우선순위를 확인해 주세요." }, { status: 400 });
  }
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return Response.json({ error: "기한은 YYYY-MM-DD 형식으로 입력해 주세요." }, { status: 400 });
  }

  const now = Date.now();
  const task = {
    id: crypto.randomUUID(), module: taskModule, category, title, description, ownerEmployeeId,
    dueDate, status: "OPEN", priority, destination, sourceType: "MANUAL", sourceId: "",
    createdAt: now, updatedAt: now, completedAt: null,
  };
  await db.prepare(`INSERT INTO erp_tasks
    (id, module, category, title, description, owner_employee_id, due_date, status,
      priority, destination, source_type, source_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, 'MANUAL', '', ?, ?)`)
    .bind(task.id, task.module, task.category, task.title, task.description,
      task.ownerEmployeeId, task.dueDate, task.priority, task.destination, now, now).run();
  await writeErpAudit(db, {
    principal: auth.principal,
    module: "operations",
    action: "CREATE",
    entityType: "TASK",
    entityId: task.id,
    after: task,
  });
  return Response.json({ task }, { status: 201 });
}

export async function PUT(request: Request) {
  const auth = await authorizeErpRequest(db, "operations", "write");
  if (auth.response) return auth.response;
  const body = await request.json() as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return Response.json({ error: "업무 ID가 필요합니다." }, { status: 400 });

  const before = await db.prepare(`SELECT id, module, category, title, description,
    owner_employee_id, due_date, status, priority, destination, source_type, source_id,
    created_at, updated_at, completed_at FROM erp_tasks
    WHERE id = ? AND deleted_at IS NULL`).bind(id).first<TaskRow>();
  if (!before) return Response.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });

  const status = typeof body.status === "string" ? body.status : before.status;
  const priority = typeof body.priority === "string" ? body.priority : before.priority;
  const ownerEmployeeId = typeof body.ownerEmployeeId === "string" ? body.ownerEmployeeId.trim().slice(0, 60) : before.owner_employee_id;
  const dueDate = typeof body.dueDate === "string" ? body.dueDate.trim() : before.due_date;
  if (!allowedStatuses.has(status) || !allowedPriorities.has(priority)) {
    return Response.json({ error: "지원하지 않는 업무 상태 또는 우선순위입니다." }, { status: 400 });
  }
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return Response.json({ error: "기한은 YYYY-MM-DD 형식으로 입력해 주세요." }, { status: 400 });
  }

  const now = Date.now();
  const completedAt = status === "DONE" ? (before.completed_at ?? now) : null;
  await db.prepare(`UPDATE erp_tasks SET owner_employee_id = ?, due_date = ?, status = ?,
    priority = ?, updated_at = ?, completed_at = ? WHERE id = ?`)
    .bind(ownerEmployeeId, dueDate, status, priority, now, completedAt, id).run();
  const after = { ...toTask(before), ownerEmployeeId, dueDate, status, priority, updatedAt: now, completedAt };
  await writeErpAudit(db, {
    principal: auth.principal,
    module: "operations",
    action: "UPDATE",
    entityType: "TASK",
    entityId: id,
    before: toTask(before),
    after,
    reason: typeof body.reason === "string" ? body.reason : "",
  });
  return Response.json({ task: after });
}

export async function DELETE(request: Request) {
  const auth = await authorizeErpRequest(db, "operations", "delete");
  if (auth.response) return auth.response;
  const body = await request.json() as { id?: string; reason?: string };
  const id = body.id?.trim() ?? "";
  if (!id) return Response.json({ error: "업무 ID가 필요합니다." }, { status: 400 });
  const before = await db.prepare(`SELECT id, module, category, title, description,
    owner_employee_id, due_date, status, priority, destination, source_type, source_id,
    created_at, updated_at, completed_at FROM erp_tasks
    WHERE id = ? AND deleted_at IS NULL`).bind(id).first<TaskRow>();
  if (!before) return Response.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });
  await db.prepare("UPDATE erp_tasks SET deleted_at = ?, updated_at = ? WHERE id = ?")
    .bind(Date.now(), Date.now(), id).run();
  await writeErpAudit(db, {
    principal: auth.principal,
    module: "operations",
    action: "SOFT_DELETE",
    entityType: "TASK",
    entityId: id,
    before: toTask(before),
    reason: body.reason ?? "",
  });
  return Response.json({ id, deleted: true });
}
