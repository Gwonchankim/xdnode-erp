import { env } from "cloudflare:workers";
import { createApprovalRequest } from "../../../approval-engine";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";
import { financeCurrentData } from "../../../finance-current-data";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;
type ControlStatus = "PASS" | "FAIL" | "REVIEW";
type CloseControl = { key: string; category: string; title: string; status: ControlStatus; message: string; count: number };
type CloseRunRow = {
  period: string; period_end: string; status: string; control_pass_count: number; control_fail_count: number;
  manual_completed_count: number; manual_total_count: number; evidence_count: number; snapshot_json: string;
  submitted_by: string; submitted_at: number | null; closed_by: string; closed_at: number | null;
  reopened_by: string; reopened_at: number | null; reopened_reason: string; version: number;
  created_at: number; updated_at: number;
};
type CloseTaskRow = {
  id: string; period: string; category: string; title: string; owner_employee_id: string; status: string;
  evidence_document_id: string; completed_at: number | null; approved_by: string; approved_at: number | null;
  reopened_reason: string; created_at: number; updated_at: number;
};
type DocumentRow = { id: string; category: string; version: number; file_name: string; uploaded_by: string; created_at: number };

const currentPeriod = financeCurrentData.asOf.slice(0, 7);
const validPeriod = (period: string) => /^2026-(0[1-9]|1[0-2])$/.test(period) && period <= currentPeriod;
const lastDayOfPeriod = (period: string) => {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
};

async function ensureSchema() {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_close_tasks (
      id TEXT PRIMARY KEY NOT NULL, period TEXT NOT NULL, category TEXT NOT NULL, title TEXT NOT NULL,
      owner_employee_id TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'OPEN',
      evidence_document_id TEXT NOT NULL DEFAULT '', completed_at INTEGER, approved_by TEXT NOT NULL DEFAULT '',
      approved_at INTEGER, reopened_reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_close_runs (
      period TEXT PRIMARY KEY NOT NULL, period_end TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN',
      control_pass_count INTEGER NOT NULL DEFAULT 0, control_fail_count INTEGER NOT NULL DEFAULT 0,
      manual_completed_count INTEGER NOT NULL DEFAULT 0, manual_total_count INTEGER NOT NULL DEFAULT 0,
      evidence_count INTEGER NOT NULL DEFAULT 0, snapshot_json TEXT NOT NULL DEFAULT '{}',
      submitted_by TEXT NOT NULL DEFAULT '', submitted_at INTEGER, closed_by TEXT NOT NULL DEFAULT '', closed_at INTEGER,
      reopened_by TEXT NOT NULL DEFAULT '', reopened_at INTEGER, reopened_reason TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_close_period_status ON finance_close_tasks(period, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_close_run_status_period ON finance_close_runs(status, period)"),
  ]);
}

async function seedClose(period: string) {
  const now = Date.now();
  const templates = [
    ["BANK", "은행·외화예금 잔액 대사"],
    ["JOURNAL", "분개장 차변·대변 및 미전기 전표 확인"],
    ["EVIDENCE", "지출·지급 증빙 누락 확인"],
    ["PAYROLL", "급여월 승인·잠금 확인"],
    ["INVENTORY", "재고 음수·미반영 입고 확인"],
    ["AR_AP", "외상매출금·미수금·매입채무 검토"],
    ["TAX", "세금계산서·부가세 검토"],
    ["STATEMENT", "월 손익·재무상태표 검토"],
  ];
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO finance_close_runs
      (period, period_end, status, created_at, updated_at) VALUES (?, ?, 'OPEN', ?, ?)`)
      .bind(period, lastDayOfPeriod(period), now, now),
    ...templates.map(([category, title]) => db.prepare(`INSERT OR IGNORE INTO finance_close_tasks
      (id, period, category, title, owner_employee_id, status, evidence_document_id, completed_at,
        approved_by, approved_at, reopened_reason, created_at, updated_at)
      VALUES (?, ?, ?, ?, '', 'OPEN', '', NULL, '', NULL, '', ?, ?)`)
      .bind(`${period}:${category}`, period, category, title, now, now)),
  ]);
}

async function computeControls(period: string): Promise<CloseControl[]> {
  const like = `${period}-%`;
  const [bank, unposted, missingEvidence, payroll, inventory] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS total_count, COALESCE(SUM(CASE WHEN transaction_row.amount > COALESCE((
      SELECT SUM(match_row.matched_amount) FROM finance_cash_matches match_row
      WHERE match_row.bank_transaction_id = transaction_row.id AND match_row.status = 'CONFIRMED'), 0) THEN 1 ELSE 0 END), 0) AS pending_count
      FROM finance_bank_transactions transaction_row WHERE transaction_row.currency = 'KRW' AND transaction_row.transaction_date LIKE ?`)
      .bind(like).first<{ total_count: number; pending_count: number }>(),
    db.prepare("SELECT COUNT(*) AS count FROM finance_journal_entries WHERE voucher_date LIKE ? AND status <> 'POSTED'")
      .bind(like).first<{ count: number }>(),
    db.prepare(`SELECT COUNT(*) AS count FROM finance_expense_requests expense
      WHERE expense.requested_date LIKE ? AND expense.status NOT IN ('CANCELLED','REJECTED') AND expense.evidence_required = 1
        AND NOT EXISTS (SELECT 1 FROM erp_documents document WHERE document.module = 'finance'
          AND document.entity_type = 'financeExpense' AND document.entity_id = expense.id AND document.deleted_at IS NULL)`)
      .bind(like).first<{ count: number }>(),
    db.prepare("SELECT status, employee_count, net_pay FROM hr_payroll_runs WHERE period = ?")
      .bind(period).first<{ status: string; employee_count: number; net_pay: number }>(),
    db.prepare(`SELECT
      (SELECT COUNT(*) FROM (SELECT product_id, warehouse_id,
        SUM(CASE WHEN direction = 'IN' THEN quantity_milli ELSE -quantity_milli END) AS quantity_milli
        FROM inventory_movements GROUP BY product_id, warehouse_id
        HAVING SUM(CASE WHEN direction = 'IN' THEN quantity_milli ELSE -quantity_milli END) < 0)) AS negative_count,
      (SELECT COUNT(*) FROM finance_purchase_receipt_lines receipt_line
        JOIN finance_purchase_receipts receipt ON receipt.id = receipt_line.receipt_id AND receipt.status = 'ACCEPTED'
        WHERE receipt.receipt_date LIKE ? AND receipt_line.accepted_quantity_milli > 0 AND NOT EXISTS (
          SELECT 1 FROM inventory_movements movement WHERE movement.source_type = 'PURCHASE_RECEIPT'
            AND movement.source_id = receipt.id AND movement.source_line_key = receipt_line.id)) AS unmapped_count`)
      .bind(like).first<{ negative_count: number; unmapped_count: number }>(),
  ]);
  const bankTotal = Number(bank?.total_count ?? 0);
  const bankPending = Number(bank?.pending_count ?? 0);
  const controls: CloseControl[] = [
    { key: "BANK_RECONCILIATION", category: "BANK", title: "원화 은행거래 대사",
      status: bankTotal > 0 && bankPending === 0 ? "PASS" : "FAIL",
      message: bankTotal ? `${bankTotal}건 중 미대사 ${bankPending}건` : "해당 월 은행 거래 원문이 없습니다.", count: bankPending },
    { key: "ERP_UNPOSTED_JOURNALS", category: "JOURNAL", title: "ERP 미전기 회계전표",
      status: Number(unposted?.count ?? 0) === 0 ? "PASS" : "FAIL",
      message: `미전기 전표 ${Number(unposted?.count ?? 0)}건`, count: Number(unposted?.count ?? 0) },
    { key: "EXPENSE_EVIDENCE", category: "EVIDENCE", title: "지출·지급 증빙",
      status: Number(missingEvidence?.count ?? 0) === 0 ? "PASS" : "FAIL",
      message: `증빙 누락 요청 ${Number(missingEvidence?.count ?? 0)}건`, count: Number(missingEvidence?.count ?? 0) },
    { key: "PAYROLL_LOCK", category: "PAYROLL", title: "급여월 잠금",
      status: payroll?.status === "LOCKED" ? "PASS" : "FAIL",
      message: payroll ? `${payroll.employee_count}명 · ${payroll.status}` : "급여월이 생성되지 않았습니다.", count: payroll?.status === "LOCKED" ? 0 : 1 },
    { key: "INVENTORY_LEDGER", category: "INVENTORY", title: "재고원장 완전성",
      status: Number(inventory?.negative_count ?? 0) === 0 && Number(inventory?.unmapped_count ?? 0) === 0 ? "PASS" : "FAIL",
      message: `음수재고 ${Number(inventory?.negative_count ?? 0)}건 · 미반영 입고검수 ${Number(inventory?.unmapped_count ?? 0)}건`,
      count: Number(inventory?.negative_count ?? 0) + Number(inventory?.unmapped_count ?? 0) },
  ];
  controls.splice(1, 0, { key: "CLOBE_JOURNAL_BALANCE", category: "JOURNAL", title: "Clobe 분개장 차대변",
    status: period === currentPeriod ? (financeCurrentData.journalSummary.differenceKrw === 0 ? "PASS" : "FAIL") : "REVIEW",
    message: period === currentPeriod
      ? `차변·대변 차이 ${financeCurrentData.journalSummary.differenceKrw.toLocaleString("ko-KR")}원`
      : "과거 월별 분개 집계는 마감 증빙으로 수동 확인해야 합니다.",
    count: period === currentPeriod ? Math.abs(financeCurrentData.journalSummary.differenceKrw) : 0 });
  return controls;
}

const taskView = (row: CloseTaskRow) => ({
  id: row.id, period: row.period, category: row.category, title: row.title, ownerEmployeeId: row.owner_employee_id,
  status: row.status, completedAt: row.completed_at, approvedBy: row.approved_by, approvedAt: row.approved_at,
});
const runView = (row: CloseRunRow) => ({
  period: row.period, periodEnd: row.period_end, status: row.status, controlPassCount: row.control_pass_count,
  controlFailCount: row.control_fail_count, manualCompletedCount: row.manual_completed_count,
  manualTotalCount: row.manual_total_count, evidenceCount: row.evidence_count, submittedBy: row.submitted_by,
  submittedAt: row.submitted_at, closedBy: row.closed_by, closedAt: row.closed_at, reopenedBy: row.reopened_by,
  reopenedAt: row.reopened_at, reopenedReason: row.reopened_reason, version: row.version,
});

async function synchronizeAutomatedTasks(period: string, runStatus: string, controls: CloseControl[]) {
  if (!['OPEN', 'READY'].includes(runStatus)) return;
  const now = Date.now();
  const categories = ["BANK", "JOURNAL", "EVIDENCE", "PAYROLL", "INVENTORY"];
  const statements = categories.flatMap((category) => {
    const categoryControls = controls.filter((control) => control.category === category);
    if (!categoryControls.length || categoryControls.some((control) => control.status === "REVIEW")) return [];
    const passed = categoryControls.every((control) => control.status === "PASS");
    return [db.prepare(`UPDATE finance_close_tasks SET status = ?, completed_at = ?, updated_at = ?
      WHERE period = ? AND category = ? AND status <> 'APPROVED'`)
      .bind(passed ? "COMPLETED" : "IN_PROGRESS", passed ? now : null, now, period, category)];
  });
  if (statements.length) await db.batch(statements);
}

async function closeState(period: string) {
  const run = await db.prepare("SELECT * FROM finance_close_runs WHERE period = ?").bind(period).first<CloseRunRow>();
  if (!run) throw new Error("월마감 실행 원장을 찾을 수 없습니다.");
  const liveControls = await computeControls(period);
  let controls = liveControls;
  if (run.status !== "OPEN" && run.snapshot_json && run.snapshot_json !== "{}") {
    try {
      const snapshot = JSON.parse(run.snapshot_json) as { controls?: CloseControl[] };
      if (Array.isArray(snapshot.controls)) controls = snapshot.controls;
    } catch { /* 손상된 과거 스냅샷은 실시간 통제로 대체해 화면을 유지합니다. */ }
  }
  await synchronizeAutomatedTasks(period, run.status, controls);
  const [tasksResult, documentsResult] = await Promise.all([
    db.prepare("SELECT * FROM finance_close_tasks WHERE period = ? ORDER BY created_at, category").bind(period).all<CloseTaskRow>(),
    db.prepare(`SELECT id, category, version, file_name, uploaded_by, created_at FROM erp_documents
      WHERE module = 'finance' AND entity_type = 'financeCloseRun' AND entity_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC`).bind(period).all<DocumentRow>(),
  ]);
  const tasks = tasksResult.results;
  const manualCategories = new Set(["AR_AP", "TAX", "STATEMENT"]);
  const manualTasks = tasks.filter((task) => manualCategories.has(task.category)
    || controls.some((control) => control.category === task.category && control.status === "REVIEW"));
  const passCount = controls.filter((control) => control.status === "PASS").length;
  const failCount = controls.filter((control) => control.status === "FAIL").length;
  const manualCompleted = manualTasks.filter((task) => ["COMPLETED", "APPROVED"].includes(task.status)).length;
  const evidenceCount = documentsResult.results.length;
  if (run.status === "OPEN") await db.prepare(`UPDATE finance_close_runs SET control_pass_count = ?, control_fail_count = ?,
    manual_completed_count = ?, manual_total_count = ?, evidence_count = ?, updated_at = ? WHERE period = ? AND status = 'OPEN'`)
    .bind(passCount, failCount, manualCompleted, manualTasks.length, evidenceCount, Date.now(), period).run();
  const refreshedRun = run.status === "OPEN"
    ? await db.prepare("SELECT * FROM finance_close_runs WHERE period = ?").bind(period).first<CloseRunRow>() : run;
  const reasons = [
    ...controls.filter((control) => control.status === "FAIL").map((control) => control.message),
    ...manualTasks.filter((task) => !["COMPLETED", "APPROVED"].includes(task.status)).map((task) => `${task.title} 미완료`),
    ...(evidenceCount ? [] : ["마감 증빙 파일 미첨부"]),
  ];
  return { run: refreshedRun ?? run, controls, tasks, documents: documentsResult.results,
    summary: { passCount, failCount, reviewCount: controls.filter((control) => control.status === "REVIEW").length,
      manualCompleted, manualTotal: manualTasks.length, evidenceCount, canSubmit: reasons.length === 0, reasons } };
}

export async function GET(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "finance", "read");
  if (authorization.response) return authorization.response;
  const period = new URL(request.url).searchParams.get("period")?.trim() || currentPeriod;
  if (!validPeriod(period)) return Response.json({ error: "2026년 현재까지의 마감월을 선택해 주세요." }, { status: 400 });
  await seedClose(period);
  const state = await closeState(period);
  return Response.json({ asOf: financeCurrentData.asOf, currentPeriod, run: runView(state.run), controls: state.controls,
    tasks: state.tasks.map(taskView), documents: state.documents.map((document) => ({ id: document.id, category: document.category,
      version: document.version, fileName: document.file_name, uploadedBy: document.uploaded_by, createdAt: document.created_at,
      downloadUrl: `/api/documents?downloadId=${encodeURIComponent(document.id)}` })), summary: state.summary });
}

export async function POST(request: Request) {
  await ensureSchema();
  const body = await request.json() as Record<string, unknown>;
  const action = String(body.action ?? "").toUpperCase();
  const period = String(body.period ?? "").trim();
  if (!validPeriod(period)) return Response.json({ error: "2026년 현재까지의 마감월을 선택해 주세요." }, { status: 400 });
  const permission = action === "REQUEST_REOPEN" ? "approve" : "write";
  const authorization = await authorizeErpRequest(db, "finance", permission);
  if (authorization.response) return authorization.response;
  await seedClose(period);

  if (action === "UPDATE_TASK") {
    const run = await db.prepare("SELECT * FROM finance_close_runs WHERE period = ?").bind(period).first<CloseRunRow>();
    if (!run || run.status !== "OPEN") return Response.json({ error: "제출 또는 잠금된 마감월의 업무는 수정할 수 없습니다." }, { status: 409 });
    const taskId = String(body.taskId ?? "").trim();
    const status = String(body.status ?? "").toUpperCase();
    const task = await db.prepare("SELECT * FROM finance_close_tasks WHERE id = ? AND period = ?").bind(taskId, period).first<CloseTaskRow>();
    if (!task || !["OPEN", "IN_PROGRESS", "COMPLETED"].includes(status)) return Response.json({ error: "마감 업무와 상태를 확인해 주세요." }, { status: 400 });
    const controls = await computeControls(period);
    const automated = controls.some((control) => control.category === task.category)
      && !controls.some((control) => control.category === task.category && control.status === "REVIEW");
    if (automated) return Response.json({ error: "자동 통제 업무는 원장 상태에 따라 자동 변경됩니다." }, { status: 409 });
    const now = Date.now();
    await db.prepare("UPDATE finance_close_tasks SET status = ?, owner_employee_id = ?, completed_at = ?, updated_at = ? WHERE id = ?")
      .bind(status, authorization.principal.employeeId, status === "COMPLETED" ? now : null, now, taskId).run();
    const after = await db.prepare("SELECT * FROM finance_close_tasks WHERE id = ?").bind(taskId).first<CloseTaskRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "CLOSE_TASK_UPDATED",
      entityType: "financeCloseTask", entityId: taskId, before: taskView(task), after: after ? taskView(after) : null });
    return Response.json({ item: after ? taskView(after) : null });
  }

  if (action === "SUBMIT_CLOSE") {
    const state = await closeState(period);
    if (state.run.status !== "OPEN") return Response.json({ error: "작성 중인 마감월만 결재 제출할 수 있습니다." }, { status: 409 });
    if (!state.summary.canSubmit) return Response.json({ error: "마감 전 필수 통제를 완료해 주세요.", reasons: state.summary.reasons }, { status: 409 });
    const existing = await db.prepare(`SELECT id, status FROM erp_approval_requests
      WHERE target_entity_type = 'FINANCE_CLOSE_RUN' AND target_entity_id = ? ORDER BY created_at DESC LIMIT 1`)
      .bind(period).first<{ id: string; status: string }>();
    if (existing && ["SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED"].includes(existing.status)) {
      return Response.json({ approvalSubmitted: true, approvalId: existing.id }, { status: 202 });
    }
    const now = Date.now();
    const snapshot = { period, periodEnd: state.run.period_end, asOf: financeCurrentData.asOf,
      controls: state.controls, tasks: state.tasks.map(taskView), evidenceCount: state.summary.evidenceCount };
    const updated = await db.prepare(`UPDATE finance_close_runs SET status = 'SUBMITTED', snapshot_json = ?,
      control_pass_count = ?, control_fail_count = ?, manual_completed_count = ?, manual_total_count = ?,
      evidence_count = ?, submitted_by = ?, submitted_at = ?, updated_at = ? WHERE period = ? AND status = 'OPEN'`)
      .bind(JSON.stringify(snapshot), state.summary.passCount, state.summary.failCount, state.summary.manualCompleted,
        state.summary.manualTotal, state.summary.evidenceCount, authorization.principal.employeeId, now, now, period).run();
    if ((updated.meta.changes ?? 0) < 1) return Response.json({ error: "마감 상태가 변경되었습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
    try {
      const approval = await createApprovalRequest(db, authorization.principal, { module: "finance", requestType: "CLOSE",
        title: `${period} 월마감 잠금 승인`, description: `자동 통제 ${state.summary.passCount}개 통과 · 수동 검토 ${state.summary.manualCompleted}/${state.summary.manualTotal} · 증빙 ${state.summary.evidenceCount}건`,
        targetEntityType: "FINANCE_CLOSE_RUN", targetEntityId: period, metadata: snapshot });
      await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "CLOSE_RUN_SUBMITTED",
        entityType: "financeCloseRun", entityId: period, before: runView(state.run), after: { ...snapshot, approvalId: approval.id } });
      return Response.json({ approvalSubmitted: true, approvalId: approval.id }, { status: 202 });
    } catch (error) {
      await db.prepare("UPDATE finance_close_runs SET status = 'OPEN', submitted_by = '', submitted_at = NULL, updated_at = ? WHERE period = ? AND status = 'SUBMITTED'")
        .bind(Date.now(), period).run();
      throw error;
    }
  }

  if (action === "REQUEST_REOPEN") {
    const reason = String(body.reason ?? "").trim();
    const run = await db.prepare("SELECT * FROM finance_close_runs WHERE period = ?").bind(period).first<CloseRunRow>();
    if (!run || run.status !== "CLOSED") return Response.json({ error: "잠금된 마감월만 재개방을 요청할 수 있습니다." }, { status: 409 });
    if (!reason) return Response.json({ error: "재개방 사유를 입력해 주세요." }, { status: 400 });
    const existing = await db.prepare(`SELECT id, status FROM erp_approval_requests
      WHERE target_entity_type = 'FINANCE_CLOSE_REOPEN' AND target_entity_id = ? ORDER BY created_at DESC LIMIT 1`)
      .bind(period).first<{ id: string; status: string }>();
    if (existing && ["SUBMITTED", "IN_REVIEW", "CHANGES_REQUESTED"].includes(existing.status)) {
      return Response.json({ approvalSubmitted: true, approvalId: existing.id }, { status: 202 });
    }
    const approval = await createApprovalRequest(db, authorization.principal, { module: "finance", requestType: "CLOSE",
      title: `${period} 월마감 재개방 승인`, description: reason, targetEntityType: "FINANCE_CLOSE_REOPEN",
      targetEntityId: period, metadata: { period, reopenedReason: reason, currentVersion: run.version } });
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "CLOSE_REOPEN_REQUESTED",
      entityType: "financeCloseRun", entityId: period, before: runView(run), after: { approvalId: approval.id, reason }, reason });
    return Response.json({ approvalSubmitted: true, approvalId: approval.id }, { status: 202 });
  }

  return Response.json({ error: "지원하지 않는 월마감 작업입니다." }, { status: 400 });
}
