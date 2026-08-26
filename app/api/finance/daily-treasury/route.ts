import { env } from "cloudflare:workers";
import { authorizeErpRequest, safeJson, writeErpAudit } from "../../../erp-platform";
import { financeCurrentData } from "../../../finance-current-data";
import { buildFinanceAlertReportSnapshot } from "../../../finance-alert-reporting";

type Bindings = {
  DB: D1Database;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_AI_MODEL?: string;
};
type ReportRow = {
  id: string; report_date: string; version: number; status: string; source_as_of: string;
  snapshot_json: string; analysis_text: string; analysis_source: string; ai_status: string;
  ai_model: string; management_note: string; action_items_json: string; generated_by: string;
  reviewed_by: string; reviewed_at: number | null; finalized_by: string; finalized_at: number | null;
  created_at: number; updated_at: number;
};
type AmountCount = { amount: number; count: number };

const bindings = env as unknown as Bindings;
const db = bindings.DB;
const datePattern = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

async function ensureSchema() {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_daily_treasury_reports (
      id TEXT PRIMARY KEY NOT NULL, report_date TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'DRAFT', source_as_of TEXT NOT NULL, snapshot_json TEXT NOT NULL,
      analysis_text TEXT NOT NULL DEFAULT '', analysis_source TEXT NOT NULL DEFAULT 'RULE_BASED_FALLBACK',
      ai_status TEXT NOT NULL DEFAULT 'NOT_REQUESTED', ai_model TEXT NOT NULL DEFAULT '',
      management_note TEXT NOT NULL DEFAULT '', action_items_json TEXT NOT NULL DEFAULT '[]',
      generated_by TEXT NOT NULL, reviewed_by TEXT NOT NULL DEFAULT '', reviewed_at INTEGER,
      finalized_by TEXT NOT NULL DEFAULT '', finalized_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_daily_treasury_report_date_version ON finance_daily_treasury_reports(report_date, version)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_daily_treasury_report_date_status ON finance_daily_treasury_reports(report_date, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_daily_treasury_report_source_asof ON finance_daily_treasury_reports(source_as_of)"),
  ]);
}

function validDate(value: string) {
  if (!datePattern.test(value) || value > financeCurrentData.asOf) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function reportView(row: ReportRow) {
  return {
    id: row.id, reportDate: row.report_date, version: row.version, status: row.status,
    sourceAsOf: row.source_as_of, snapshot: safeJson<Record<string, unknown>>(row.snapshot_json, {}),
    analysisText: row.analysis_text, analysisSource: row.analysis_source, aiStatus: row.ai_status,
    aiModel: row.ai_model, managementNote: row.management_note,
    actionItems: safeJson<string[]>(row.action_items_json, []), generatedBy: row.generated_by,
    reviewedBy: row.reviewed_by, reviewedAt: row.reviewed_at, finalizedBy: row.finalized_by,
    finalizedAt: row.finalized_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

async function buildSnapshot(reportDate: string) {
  const next7 = addDays(reportDate, 7);
  const trend = financeCurrentData.balanceTrend;
  const closingPoint = trend.find((item) => item.date <= reportDate) ?? null;
  const openingPoint = trend.find((item) => item.date < reportDate) ?? null;
  const current = reportDate === financeCurrentData.asOf;
  const [cashRows, forecastRows, receivables, payables, debt, alertActions] = await Promise.all([
    db.prepare(`SELECT direction, COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS count,
      COALESCE(SUM(CASE WHEN is_unclassified = 1 THEN amount ELSE 0 END), 0) AS unclassified_amount,
      COALESCE(SUM(CASE WHEN is_unclassified = 1 THEN 1 ELSE 0 END), 0) AS unclassified_count
      FROM finance_bank_transactions WHERE transaction_date = ? AND currency = 'KRW' GROUP BY direction`).bind(reportDate).all<{
        direction: string; amount: number; count: number; unclassified_amount: number; unclassified_count: number;
      }>(),
    db.prepare(`SELECT direction, COALESCE(SUM(amount * probability / 100), 0) AS amount, COUNT(*) AS count
      FROM finance_cash_forecast_items WHERE status = 'EXPECTED' AND scenario = 'BASE'
        AND expected_date > ? AND expected_date <= ? GROUP BY direction`).bind(reportDate, next7).all<{ direction: string; amount: number; count: number }>(),
    db.prepare(`WITH invoice_balance AS (
      SELECT invoice.id, invoice.due_date, MAX(0, invoice.amount - COALESCE(SUM(CASE
        WHEN payment.status IN ('ACCEPTED','COMPLETED') THEN allocation.amount ELSE 0 END), 0)) AS outstanding
      FROM sales_documents invoice
      LEFT JOIN sales_payment_allocations allocation ON allocation.invoice_document_id = invoice.id
      LEFT JOIN sales_documents payment ON payment.id = allocation.payment_document_id
      WHERE invoice.document_type = 'INVOICE' AND invoice.status IN ('ACCEPTED','COMPLETED')
      GROUP BY invoice.id)
      SELECT COALESCE(SUM(CASE WHEN outstanding > 0 AND due_date <> '' AND due_date <= ? THEN outstanding ELSE 0 END), 0) AS overdue_amount,
        COALESCE(SUM(CASE WHEN outstanding > 0 AND due_date > ? AND due_date <= ? THEN outstanding ELSE 0 END), 0) AS due_amount,
        COALESCE(SUM(CASE WHEN outstanding > 0 AND due_date > ? AND due_date <= ? THEN 1 ELSE 0 END), 0) AS due_count,
        COALESCE(SUM(CASE WHEN outstanding > 0 AND due_date = '' THEN 1 ELSE 0 END), 0) AS missing_due_count
      FROM invoice_balance`).bind(reportDate, reportDate, next7, reportDate, next7).first<{
        overdue_amount: number; due_amount: number; due_count: number; missing_due_count: number;
      }>(),
    db.prepare(`SELECT COALESCE(SUM(CASE WHEN invoice.due_date > ? AND invoice.due_date <= ? THEN invoice.total_amount ELSE 0 END), 0) AS due_amount,
      COALESCE(SUM(CASE WHEN invoice.due_date > ? AND invoice.due_date <= ? THEN 1 ELSE 0 END), 0) AS due_count,
      COALESCE(SUM(CASE WHEN invoice.due_date = '' THEN 1 ELSE 0 END), 0) AS missing_due_count
      FROM finance_purchase_invoices invoice
      LEFT JOIN finance_payment_ledger payment ON payment.request_id = invoice.payment_request_id AND payment.status = 'PAID'
      WHERE invoice.status IN ('MATCHED','PAYMENT_READY') AND payment.id IS NULL`).bind(reportDate, next7, reportDate, next7).first<{
        due_amount: number; due_count: number; missing_due_count: number;
      }>(),
    db.prepare(`SELECT COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS count FROM finance_debt_schedule_items
      WHERE due_date > ? AND due_date <= ? AND status NOT IN ('PAID','CANCELLED')`).bind(reportDate, next7).first<AmountCount>(),
    buildFinanceAlertReportSnapshot(db, reportDate),
  ]);
  const cash = { inflow: 0, outflow: 0, count: 0, unclassifiedAmount: 0, unclassifiedCount: 0 };
  for (const row of cashRows.results) {
    if (row.direction === "IN") cash.inflow += Number(row.amount ?? 0);
    if (row.direction === "OUT") cash.outflow += Number(row.amount ?? 0);
    cash.count += Number(row.count ?? 0);
    cash.unclassifiedAmount += Number(row.unclassified_amount ?? 0);
    cash.unclassifiedCount += Number(row.unclassified_count ?? 0);
  }
  const forecast = { inflow: 0, outflow: 0, count: 0 };
  for (const row of forecastRows.results) {
    if (row.direction === "INFLOW") forecast.inflow += Math.round(Number(row.amount ?? 0));
    if (row.direction === "OUTFLOW") forecast.outflow += Math.round(Number(row.amount ?? 0));
    forecast.count += Number(row.count ?? 0);
  }
  const closing = closingPoint?.balance ?? 0;
  const opening = openingPoint?.balance ?? closing;
  const warnings: Array<{ code: string; message: string; destination: string }> = [];
  if (cash.unclassifiedCount) warnings.push({ code: "UNCLASSIFIED_CASH", message: `미분류 은행거래 ${cash.unclassifiedCount}건`, destination: "reconciliation" });
  if (Number(receivables?.overdue_amount ?? 0) > 0) warnings.push({ code: "OVERDUE_RECEIVABLE", message: `기한 경과 채권 ${Number(receivables?.overdue_amount ?? 0).toLocaleString("ko-KR")}원`, destination: "receivables" });
  if (Number(receivables?.missing_due_count ?? 0) + Number(payables?.missing_due_count ?? 0) > 0) warnings.push({ code: "MISSING_DUE_DATE", message: "회수·지급 예정일 누락이 있습니다.", destination: "forecast" });
  if (financeCurrentData.journalSummary.differenceKrw !== 0) warnings.push({ code: "JOURNAL_DIFFERENCE", message: `분개장 차대변 ${financeCurrentData.journalSummary.differenceKrw.toLocaleString("ko-KR")}원 차이`, destination: "quality" });
  if (alertActions.highCriticalUnresolvedCount > 0) warnings.push({ code: "FINANCE_ALERT_ACTION", message: `미해결 중요 재무 경보 ${alertActions.highCriticalUnresolvedCount}건`, destination: "risk-actions" });
  return {
    reportDate, sourceAsOf: financeCurrentData.asOf, generatedAt: new Date().toISOString(), horizonEnd: next7,
    balances: {
      openingDate: openingPoint?.date ?? "", openingBankAssets: opening, closingDate: closingPoint?.date ?? "", closingBankAssets: closing,
      movement: closing - opening, checkingBalance: current ? financeCurrentData.accountSummary.checkingBalanceSum : null,
      fxBalanceKrw: current ? financeCurrentData.accountSummary.fxBalanceSumKrw : null,
      loanBalance: current ? financeCurrentData.accountSummary.loanBalanceSum : null,
    },
    actualCash: { ...cash, net: cash.inflow - cash.outflow },
    next7Days: {
      explicitForecast: { ...forecast, net: forecast.inflow - forecast.outflow },
      receivables: { dueAmount: Number(receivables?.due_amount ?? 0), dueCount: Number(receivables?.due_count ?? 0), overdueAmount: Number(receivables?.overdue_amount ?? 0), missingDueCount: Number(receivables?.missing_due_count ?? 0) },
      payables: { dueAmount: Number(payables?.due_amount ?? 0), dueCount: Number(payables?.due_count ?? 0), missingDueCount: Number(payables?.missing_due_count ?? 0) },
      debt: { dueAmount: Number(debt?.amount ?? 0), dueCount: Number(debt?.count ?? 0) },
    },
    journal: {
      lineCount: financeCurrentData.journalSummary.lineCount, debitAmountKrw: financeCurrentData.journalSummary.debitAmountKrw,
      creditAmountKrw: financeCurrentData.journalSummary.creditAmountKrw, differenceKrw: financeCurrentData.journalSummary.differenceKrw,
      checkingAccount: financeCurrentData.journalSummary.checkingAccount,
    },
    alertActions,
    warnings,
  };
}

function fallbackAnalysis(snapshot: Awaited<ReturnType<typeof buildSnapshot>>) {
  const { balances, actualCash, next7Days, alertActions, warnings } = snapshot;
  const movement = balances.movement >= 0 ? `증가 ${balances.movement.toLocaleString("ko-KR")}원` : `감소 ${Math.abs(balances.movement).toLocaleString("ko-KR")}원`;
  const projected = next7Days.explicitForecast.inflow + next7Days.receivables.dueAmount
    - next7Days.explicitForecast.outflow - next7Days.payables.dueAmount - next7Days.debt.dueAmount;
  return [
    `${snapshot.reportDate} 은행성 자산은 ${balances.closingBankAssets.toLocaleString("ko-KR")}원이며 직전 관측일보다 ${movement}했습니다.`,
    `당일 은행거래는 입금 ${actualCash.inflow.toLocaleString("ko-KR")}원, 출금 ${actualCash.outflow.toLocaleString("ko-KR")}원, 순증감 ${actualCash.net.toLocaleString("ko-KR")}원입니다.`,
    `향후 7일 명시 예측과 채권·채무·차입 일정을 단순 합산한 순예정액은 ${projected.toLocaleString("ko-KR")}원입니다.`,
    `보고일 기준 재무 경보는 미해결 ${alertActions.unresolvedCount}건, 종료 검토 ${alertActions.reviewCount}건, 기한 경과 ${alertActions.overdueCount}건입니다.`,
    warnings.length ? `확인할 통제 신호는 ${warnings.map((item) => item.message).join(" · ")}입니다.` : "현재 연결된 원천에서 추가 통제 경고가 없습니다.",
  ].join("\n");
}

async function analyze(snapshot: Awaited<ReturnType<typeof buildSnapshot>>) {
  const model = bindings.CLOUDFLARE_AI_MODEL?.trim() || "@cf/qwen/qwen3-30b-a3b-fp8";
  const accountId = bindings.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = bindings.CLOUDFLARE_API_TOKEN?.trim();
  const fallback = fallbackAnalysis(snapshot);
  if (!accountId || !token) return { text: fallback, source: "RULE_BASED_FALLBACK", status: "UNCONFIGURED", model: "" };
  try {
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model}`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [
        { role: "system", content: "당신은 한국 기업의 재무 자금일보 분석자입니다. 제공된 JSON의 숫자만 사용하고 새 숫자나 원인을 추측하지 마세요. 은행 잔액, 당일 현금흐름, 7일 예정액, 통제경고를 구분해 한국어 4~6문장으로 작성하세요. 세무·법률 판단은 확정하지 마세요." },
        { role: "user", content: JSON.stringify(snapshot) },
      ], temperature: 0.1, max_tokens: 650 }), signal: AbortSignal.timeout(30_000),
    });
    const data = await response.json() as { success?: boolean; errors?: Array<{ message?: string }>; result?: { response?: unknown; choices?: Array<{ message?: { content?: unknown } }> } };
    const providerError = data.errors?.map((item) => item.message).filter(Boolean).join(" ") ?? "";
    const quota = response.status === 429 || /quota|limit|neuron|exceeded/i.test(providerError);
    if (quota) return { text: fallback, source: "RULE_BASED_FALLBACK", status: "QUOTA", model };
    const content = data.result?.response ?? data.result?.choices?.[0]?.message?.content;
    if (!response.ok || data.success === false || typeof content !== "string" || !content.trim()) return { text: fallback, source: "RULE_BASED_FALLBACK", status: "ERROR", model };
    return { text: content.trim().slice(0, 4000), source: "AI", status: "SUCCESS", model };
  } catch {
    return { text: fallback, source: "RULE_BASED_FALLBACK", status: "ERROR", model };
  }
}

async function state(reportDate: string, reportId = "") {
  const result = await db.prepare("SELECT * FROM finance_daily_treasury_reports WHERE report_date = ? ORDER BY version DESC")
    .bind(reportDate).all<ReportRow>();
  const selected = result.results.find((row) => row.id === reportId) ?? result.results[0] ?? null;
  return { reports: result.results.map(reportView), selected: selected ? reportView(selected) : null };
}

export async function GET(request: Request) {
  const authorization = await authorizeErpRequest(db, "finance", "read");
  if (authorization.response) return authorization.response;
  await ensureSchema();
  const url = new URL(request.url);
  const reportDate = url.searchParams.get("date") ?? financeCurrentData.asOf;
  if (!validDate(reportDate)) return Response.json({ error: "2026년 최신 원천 기준일까지의 보고일을 선택해 주세요." }, { status: 400 });
  return Response.json({ asOf: financeCurrentData.asOf, reportDate, preview: await buildSnapshot(reportDate), ...(await state(reportDate, url.searchParams.get("reportId") ?? "")) });
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return Response.json({ error: "요청 내용을 읽을 수 없습니다." }, { status: 400 }); }
  const action = String(body.action ?? "").toUpperCase();
  const authorization = await authorizeErpRequest(db, "finance", action === "FINALIZE" ? "approve" : "write");
  if (authorization.response) return authorization.response;
  await ensureSchema();
  const now = Date.now();

  if (action === "GENERATE") {
    const reportDate = String(body.reportDate ?? financeCurrentData.asOf);
    if (!validDate(reportDate)) return Response.json({ error: "보고일을 확인해 주세요." }, { status: 400 });
    const latest = await db.prepare("SELECT * FROM finance_daily_treasury_reports WHERE report_date = ? ORDER BY version DESC LIMIT 1")
      .bind(reportDate).first<ReportRow>();
    const snapshot = await buildSnapshot(reportDate);
    const result = await analyze(snapshot);
    if (latest?.status === "DRAFT") {
      const updated = await db.prepare(`UPDATE finance_daily_treasury_reports SET source_as_of = ?, snapshot_json = ?,
        analysis_text = ?, analysis_source = ?, ai_status = ?, ai_model = ?, management_note = '',
        action_items_json = '[]', updated_at = ? WHERE id = ? AND status = 'DRAFT'`)
        .bind(financeCurrentData.asOf, JSON.stringify(snapshot), result.text, result.source, result.status, result.model, now, latest.id).run();
      if (updated.meta.changes !== 1) return Response.json({ error: "다른 사용자가 보고서 상태를 먼저 변경했습니다." }, { status: 409 });
      await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "DAILY_TREASURY_REPORT_REFRESHED", entityType: "financeDailyTreasuryReport", entityId: latest.id, before: reportView(latest), after: { reportDate, sourceAsOf: financeCurrentData.asOf, aiStatus: result.status } });
      return Response.json({ id: latest.id, version: latest.version, refreshed: true, aiStatus: result.status });
    }
    const version = (latest?.version ?? 0) + 1;
    const id = crypto.randomUUID();
    try {
      await db.prepare(`INSERT INTO finance_daily_treasury_reports
        (id, report_date, version, status, source_as_of, snapshot_json, analysis_text, analysis_source,
          ai_status, ai_model, management_note, action_items_json, generated_by, reviewed_by, reviewed_at,
          finalized_by, finalized_at, created_at, updated_at)
        VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?, ?, '', '[]', ?, '', NULL, '', NULL, ?, ?)`)
        .bind(id, reportDate, version, financeCurrentData.asOf, JSON.stringify(snapshot), result.text, result.source,
          result.status, result.model, authorization.principal.employeeId, now, now).run();
    } catch {
      return Response.json({ error: "다른 사용자가 같은 보고일의 새 버전을 먼저 생성했습니다. 목록을 새로고침해 주세요." }, { status: 409 });
    }
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "DAILY_TREASURY_REPORT_GENERATED", entityType: "financeDailyTreasuryReport", entityId: id, after: { reportDate, version, sourceAsOf: financeCurrentData.asOf, aiStatus: result.status } });
    return Response.json({ id, version, created: true, aiStatus: result.status }, { status: 201 });
  }

  const reportId = String(body.reportId ?? "");
  const report = reportId ? await db.prepare("SELECT * FROM finance_daily_treasury_reports WHERE id = ?").bind(reportId).first<ReportRow>() : null;
  if (!report) return Response.json({ error: "자금일보를 찾을 수 없습니다." }, { status: 404 });

  if (action === "SAVE_REVIEW") {
    if (report.status !== "DRAFT") return Response.json({ error: "작성 중인 자금일보만 검토 완료할 수 있습니다." }, { status: 409 });
    const managementNote = String(body.managementNote ?? "").trim().slice(0, 4000);
    const actionItems = Array.isArray(body.actionItems) ? body.actionItems.map((item) => String(item).trim().slice(0, 300)).filter(Boolean).slice(0, 20) : [];
    if (managementNote.length < 10 || actionItems.length < 1) return Response.json({ error: "경영 메모를 10자 이상 작성하고 후속조치를 1개 이상 기록해 주세요." }, { status: 400 });
    const updated = await db.prepare(`UPDATE finance_daily_treasury_reports SET status = 'REVIEWED', management_note = ?,
      action_items_json = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ? AND status = 'DRAFT'`)
      .bind(managementNote, JSON.stringify(actionItems), authorization.principal.employeeId, now, now, reportId).run();
    if (updated.meta.changes !== 1) return Response.json({ error: "다른 사용자가 자금일보 상태를 먼저 변경했습니다." }, { status: 409 });
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "DAILY_TREASURY_REPORT_REVIEWED", entityType: "financeDailyTreasuryReport", entityId: reportId, before: reportView(report), after: { managementNote, actionItems, reviewedBy: authorization.principal.employeeId } });
    return Response.json({ reviewed: true });
  }

  if (action === "FINALIZE") {
    if (report.status !== "REVIEWED") return Response.json({ error: "검토 완료된 자금일보만 확정할 수 있습니다." }, { status: 409 });
    if (report.report_date === financeCurrentData.asOf && report.source_as_of !== financeCurrentData.asOf) return Response.json({ error: "최신 재무 원천으로 자금일보를 다시 생성해 주세요." }, { status: 409 });
    const updated = await db.prepare(`UPDATE finance_daily_treasury_reports SET status = 'FINAL', finalized_by = ?,
      finalized_at = ?, updated_at = ? WHERE id = ? AND status = 'REVIEWED'`)
      .bind(authorization.principal.employeeId, now, now, reportId).run();
    if (updated.meta.changes !== 1) return Response.json({ error: "다른 사용자가 자금일보 상태를 먼저 변경했습니다." }, { status: 409 });
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "DAILY_TREASURY_REPORT_FINALIZED", entityType: "financeDailyTreasuryReport", entityId: reportId, before: reportView(report), after: { status: "FINAL", finalizedBy: authorization.principal.employeeId } });
    return Response.json({ finalized: true });
  }

  return Response.json({ error: "지원하지 않는 자금일보 작업입니다." }, { status: 400 });
}
