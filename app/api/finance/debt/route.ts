import { env } from "cloudflare:workers";
import { financeCurrentData } from "../../../finance-current-data";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;

type FacilityRow = {
  id: string; facility_code: string; source_account_id: string; lender_name: string; facility_name: string;
  currency: string; original_principal: number; agreement_date: string; maturity_date: string;
  interest_type: string; fixed_rate_bps: number; benchmark_name: string; spread_bps: number;
  repayment_type: string; payment_day: number; covenant_note: string; next_covenant_review_date: string;
  status: string; evidence_document_id: string; approved_by: string; approved_at: number | null;
  created_by: string; created_at: number; updated_at: number;
};

type ScheduleRow = {
  id: string; facility_id: string; due_date: string; item_type: string; amount: number; status: string;
  payment_request_id: string; note: string; created_by: string; created_at: number; updated_at: number;
  expense_status?: string | null; payment_status?: string | null;
};

type ReviewRow = {
  id: string; facility_id: string; review_date: string; covenant_name: string; comparator: string;
  threshold_value_scaled: number; actual_value_scaled: number; unit: string; result: string;
  evidence_document_id: string; note: string; reviewed_by: string; created_at: number; updated_at: number;
};

const loanAccounts = financeCurrentData.accounts.filter((account) => account.type === "LOAN");
const currentPeriod = financeCurrentData.asOf.slice(0, 7);
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const validPeriod = (value: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && value <= currentPeriod;

async function ensureSchema() {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_debt_facilities (
      id TEXT PRIMARY KEY NOT NULL, facility_code TEXT NOT NULL UNIQUE, source_account_id TEXT NOT NULL UNIQUE,
      lender_name TEXT NOT NULL, facility_name TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'KRW',
      original_principal INTEGER NOT NULL, agreement_date TEXT NOT NULL, maturity_date TEXT NOT NULL,
      interest_type TEXT NOT NULL DEFAULT 'MANUAL', fixed_rate_bps INTEGER NOT NULL DEFAULT 0,
      benchmark_name TEXT NOT NULL DEFAULT '', spread_bps INTEGER NOT NULL DEFAULT 0,
      repayment_type TEXT NOT NULL DEFAULT 'MANUAL', payment_day INTEGER NOT NULL DEFAULT 0,
      covenant_note TEXT NOT NULL DEFAULT '', next_covenant_review_date TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'DRAFT', evidence_document_id TEXT NOT NULL DEFAULT '',
      approved_by TEXT NOT NULL DEFAULT '', approved_at INTEGER, created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_debt_schedule_items (
      id TEXT PRIMARY KEY NOT NULL, facility_id TEXT NOT NULL, due_date TEXT NOT NULL, item_type TEXT NOT NULL,
      amount INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'PLANNED', payment_request_id TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_debt_covenant_reviews (
      id TEXT PRIMARY KEY NOT NULL, facility_id TEXT NOT NULL, review_date TEXT NOT NULL, covenant_name TEXT NOT NULL,
      comparator TEXT NOT NULL, threshold_value_scaled INTEGER NOT NULL, actual_value_scaled INTEGER NOT NULL,
      unit TEXT NOT NULL, result TEXT NOT NULL, evidence_document_id TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      reviewed_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_debt_facility_code ON finance_debt_facilities(facility_code)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_debt_facility_source ON finance_debt_facilities(source_account_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_debt_facility_status_maturity ON finance_debt_facilities(status, maturity_date)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_debt_schedule_unique ON finance_debt_schedule_items(facility_id, due_date, item_type)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_debt_schedule_payment ON finance_debt_schedule_items(payment_request_id) WHERE payment_request_id <> ''"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_debt_schedule_status_due ON finance_debt_schedule_items(status, due_date)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_debt_covenant_review_unique ON finance_debt_covenant_reviews(facility_id, review_date, covenant_name)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_debt_covenant_result_date ON finance_debt_covenant_reviews(result, review_date)"),
  ]);
}

async function locked(period: string) {
  if (!validPeriod(period)) return false;
  return (await db.prepare("SELECT status FROM finance_close_runs WHERE period = ?").bind(period).first<{ status: string }>())?.status === "CLOSED";
}

function sourceAccount(sourceAccountId: string) {
  return loanAccounts.find((account) => String(account.id) === sourceAccountId);
}

function scheduleState(row: ScheduleRow) {
  if (row.status === "CANCELLED") return "CANCELLED";
  if (row.expense_status === "PAID" || row.payment_status === "PAID") return "PAID";
  if (row.payment_request_id && !["CANCELLED", "REJECTED"].includes(String(row.expense_status ?? ""))) return "REQUESTED";
  if (row.due_date < financeCurrentData.asOf) return "OVERDUE";
  return "PLANNED";
}

async function readState() {
  const [facilityResult, scheduleResult, reviewResult, documentResult] = await Promise.all([
    db.prepare("SELECT * FROM finance_debt_facilities ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'DRAFT' THEN 1 ELSE 2 END, maturity_date, facility_code").all<FacilityRow>(),
    db.prepare(`SELECT schedule.*, expense.status AS expense_status, payment.status AS payment_status
      FROM finance_debt_schedule_items schedule
      LEFT JOIN finance_expense_requests expense ON expense.id = schedule.payment_request_id
      LEFT JOIN finance_payment_ledger payment ON payment.request_id = schedule.payment_request_id AND payment.status = 'PAID'
      ORDER BY schedule.due_date, schedule.created_at`).all<ScheduleRow>(),
    db.prepare("SELECT * FROM finance_debt_covenant_reviews ORDER BY review_date DESC, created_at DESC").all<ReviewRow>(),
    db.prepare(`SELECT id, entity_id, category, version, file_name, uploaded_by, created_at FROM erp_documents
      WHERE module = 'finance' AND entity_type = 'financeDebtFacility' AND deleted_at IS NULL
      ORDER BY entity_id, category, version DESC`).all<Record<string, string | number>>(),
  ]);
  const facilities = facilityResult.results.map((facility) => {
    const account = sourceAccount(facility.source_account_id);
    const schedules = scheduleResult.results.filter((item) => item.facility_id === facility.id);
    const reviews = reviewResult.results.filter((item) => item.facility_id === facility.id);
    const documents = documentResult.results.filter((item) => item.entity_id === facility.id).map((item) => ({
      id: item.id, category: item.category, version: item.version, fileName: item.file_name,
      uploadedBy: item.uploaded_by, createdAt: item.created_at,
      downloadUrl: `/api/documents?downloadId=${encodeURIComponent(String(item.id))}`,
    }));
    return { ...facility, current_balance: account?.krwBalance ?? null,
      source_account: account ? { id: account.id, bankCode: account.bankCode, last4: account.last4,
        name: account.name, currency: account.currency, balance: account.balance, krwBalance: account.krwBalance } : null,
      schedules: schedules.map((item) => ({ ...item, derived_status: scheduleState(item) })), reviews, documents };
  });
  const mappedIds = new Set(facilityResult.results.filter((row) => row.status !== "VOID").map((row) => row.source_account_id));
  const unmapped = loanAccounts.filter((account) => account.krwBalance > 0 && !mappedIds.has(String(account.id)));
  const flatSchedules = facilities.flatMap((facility) => facility.schedules);
  const active = facilities.filter((facility) => facility.status === "ACTIVE");
  const covenantBreaches = reviewResult.results.filter((review) => review.result === "BREACH").length;
  const covenantDue = active.filter((facility) => facility.next_covenant_review_date && facility.next_covenant_review_date <= financeCurrentData.asOf).length;
  const due13Weeks = new Date(`${financeCurrentData.asOf}T00:00:00Z`); due13Weeks.setUTCDate(due13Weeks.getUTCDate() + 90);
  const horizon = due13Weeks.toISOString().slice(0, 10);
  return { facilities, unmapped, summary: { sourceLoanBalance: financeCurrentData.accountSummary.loanBalanceSum,
    activeFacilities: active.length, unmappedAccounts: unmapped.length,
    overdueSchedules: flatSchedules.filter((item) => item.derived_status === "OVERDUE").length,
    due13WeekAmount: flatSchedules.filter((item) => ["PLANNED", "OVERDUE"].includes(item.derived_status) && item.due_date <= horizon)
      .reduce((sum, item) => sum + item.amount, 0), covenantBreaches, covenantDue } };
}

export async function GET() {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "finance", "read");
  if (authorization.response) return authorization.response;
  const state = await readState();
  return Response.json({ asOf: financeCurrentData.asOf,
    loanAccounts: loanAccounts.map((account) => ({ id: account.id, bankCode: account.bankCode, last4: account.last4,
      name: account.name, currency: account.currency, balance: account.balance, krwBalance: account.krwBalance })),
    ...state,
    sourceNote: "현재잔액은 Clobe 대출계좌 원천값입니다. 계약조건·상환액·이자·약정은 계약서와 은행 고지액을 근거로 직접 등록하며 자동 추정하지 않습니다." });
}

function facilityInput(body: Record<string, unknown>) {
  const sourceAccountId = String(body.sourceAccountId ?? "").trim(); const account = sourceAccount(sourceAccountId);
  const facilityCode = String(body.facilityCode ?? "").trim().toUpperCase();
  const lenderName = String(body.lenderName ?? "").trim(); const facilityName = String(body.facilityName ?? "").trim();
  const originalPrincipal = Math.round(Number(body.originalPrincipal));
  const agreementDate = String(body.agreementDate ?? "").trim(); const maturityDate = String(body.maturityDate ?? "").trim();
  const interestType = String(body.interestType ?? "MANUAL").toUpperCase();
  const fixedRateBps = Math.round(Number(body.fixedRatePercent ?? 0) * 100);
  const benchmarkName = String(body.benchmarkName ?? "").trim(); const spreadBps = Math.round(Number(body.spreadPercent ?? 0) * 100);
  const repaymentType = String(body.repaymentType ?? "MANUAL").toUpperCase(); const paymentDay = Math.round(Number(body.paymentDay ?? 0));
  const covenantNote = String(body.covenantNote ?? "").trim(); const nextCovenantReviewDate = String(body.nextCovenantReviewDate ?? "").trim();
  const valid = Boolean(account && account.currency === "KRW" && /^[A-Z0-9_-]{2,30}$/.test(facilityCode)
    && lenderName && facilityName && Number.isSafeInteger(originalPrincipal) && originalPrincipal > 0
    && originalPrincipal >= (account?.krwBalance ?? 0) && validDate(agreementDate) && validDate(maturityDate)
    && agreementDate <= maturityDate && ["FIXED", "FLOATING", "MANUAL"].includes(interestType)
    && Number.isSafeInteger(fixedRateBps) && fixedRateBps >= 0 && fixedRateBps <= 10000
    && (interestType !== "FIXED" || fixedRateBps > 0) && (interestType !== "FLOATING" || benchmarkName.length >= 2)
    && Number.isSafeInteger(spreadBps) && spreadBps >= 0 && spreadBps <= 10000
    && ["BULLET", "AMORTIZING", "MANUAL"].includes(repaymentType)
    && Number.isSafeInteger(paymentDay) && paymentDay >= 0 && paymentDay <= 31
    && (!nextCovenantReviewDate || validDate(nextCovenantReviewDate)));
  return { valid, account, sourceAccountId, facilityCode, lenderName, facilityName, originalPrincipal,
    agreementDate, maturityDate, interestType, fixedRateBps, benchmarkName, spreadBps, repaymentType,
    paymentDay, covenantNote, nextCovenantReviewDate };
}

export async function POST(request: Request) {
  await ensureSchema(); const body = await request.json() as Record<string, unknown>;
  const action = String(body.action ?? "").toUpperCase();
  const approvalActions = new Set(["ACTIVATE_FACILITY", "REOPEN_FACILITY", "CLOSE_FACILITY", "CANCEL_SCHEDULE", "RESET_PAYMENT_REQUEST", "CREATE_COVENANT_REVIEW"]);
  const authorization = await authorizeErpRequest(db, "finance", approvalActions.has(action) ? "approve" : "write");
  if (authorization.response) return authorization.response; const now = Date.now();

  if (action === "CREATE_FACILITY" || action === "UPDATE_FACILITY") {
    const input = facilityInput(body); const id = String(body.facilityId ?? "").trim();
    if (!input.valid) return Response.json({ error: "Clobe 원화 대출계좌, 계약코드·금액·기간·금리·상환 조건을 확인해 주세요. 원금은 현재잔액보다 작을 수 없습니다." }, { status: 400 });
    if (action === "CREATE_FACILITY") {
      const facilityId = crypto.randomUUID();
      try { await db.prepare(`INSERT INTO finance_debt_facilities
        (id, facility_code, source_account_id, lender_name, facility_name, currency, original_principal,
          agreement_date, maturity_date, interest_type, fixed_rate_bps, benchmark_name, spread_bps,
          repayment_type, payment_day, covenant_note, next_covenant_review_date, status,
          evidence_document_id, approved_by, approved_at, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, 'KRW', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', '', '', NULL, ?, ?, ?)`)
        .bind(facilityId, input.facilityCode, input.sourceAccountId, input.lenderName, input.facilityName,
          input.originalPrincipal, input.agreementDate, input.maturityDate, input.interestType, input.fixedRateBps,
          input.benchmarkName, input.spreadBps, input.repaymentType, input.paymentDay, input.covenantNote,
          input.nextCovenantReviewDate, authorization.principal.employeeId, now, now).run(); }
      catch { return Response.json({ error: "같은 계약코드 또는 Clobe 대출계좌가 이미 등록되어 있습니다." }, { status: 409 }); }
      const after = await db.prepare("SELECT * FROM finance_debt_facilities WHERE id = ?").bind(facilityId).first<FacilityRow>();
      await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "DEBT_FACILITY_CREATED", entityType: "financeDebtFacility", entityId: facilityId, after });
      return Response.json({ item: after }, { status: 201 });
    }
    const before = await db.prepare("SELECT * FROM finance_debt_facilities WHERE id = ?").bind(id).first<FacilityRow>();
    if (!before || before.status !== "DRAFT") return Response.json({ error: "초안 상태의 차입계약만 수정할 수 있습니다." }, { status: 409 });
    try { await db.prepare(`UPDATE finance_debt_facilities SET facility_code = ?, source_account_id = ?, lender_name = ?,
      facility_name = ?, original_principal = ?, agreement_date = ?, maturity_date = ?, interest_type = ?, fixed_rate_bps = ?,
      benchmark_name = ?, spread_bps = ?, repayment_type = ?, payment_day = ?, covenant_note = ?, next_covenant_review_date = ?, updated_at = ? WHERE id = ?`)
      .bind(input.facilityCode, input.sourceAccountId, input.lenderName, input.facilityName, input.originalPrincipal,
        input.agreementDate, input.maturityDate, input.interestType, input.fixedRateBps, input.benchmarkName,
        input.spreadBps, input.repaymentType, input.paymentDay, input.covenantNote, input.nextCovenantReviewDate, now, id).run(); }
    catch { return Response.json({ error: "같은 계약코드 또는 Clobe 대출계좌가 이미 등록되어 있습니다." }, { status: 409 }); }
    const after = await db.prepare("SELECT * FROM finance_debt_facilities WHERE id = ?").bind(id).first<FacilityRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "DEBT_FACILITY_UPDATED", entityType: "financeDebtFacility", entityId: id, before, after });
    return Response.json({ item: after });
  }

  const facilityId = String(body.facilityId ?? "").trim();
  const facility = facilityId ? await db.prepare("SELECT * FROM finance_debt_facilities WHERE id = ?").bind(facilityId).first<FacilityRow>() : null;

  if (action === "ACTIVATE_FACILITY") {
    const documentId = String(body.evidenceDocumentId ?? "").trim(); const account = facility ? sourceAccount(facility.source_account_id) : undefined;
    const document = documentId && facility ? await db.prepare(`SELECT id FROM erp_documents WHERE id = ? AND module = 'finance'
      AND entity_type = 'financeDebtFacility' AND entity_id = ? AND category = '차입계약' AND deleted_at IS NULL`).bind(documentId, facility.id).first() : null;
    if (!facility || facility.status !== "DRAFT" || !account || facility.original_principal < account.krwBalance || !document)
      return Response.json({ error: "초안 계약, 현재 Clobe 잔액, 계약원금과 유효한 계약 증빙을 확인해 주세요." }, { status: 409 });
    await db.prepare(`UPDATE finance_debt_facilities SET status = 'ACTIVE', evidence_document_id = ?, approved_by = ?, approved_at = ?, updated_at = ?
      WHERE id = ? AND status = 'DRAFT'`).bind(documentId, authorization.principal.employeeId, now, now, facility.id).run();
    const after = await db.prepare("SELECT * FROM finance_debt_facilities WHERE id = ?").bind(facility.id).first<FacilityRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "DEBT_FACILITY_ACTIVATED", entityType: "financeDebtFacility", entityId: facility.id, before: facility, after });
    return Response.json({ item: after });
  }

  if (action === "REOPEN_FACILITY") {
    const reason = String(body.reason ?? "").trim();
    if (!facility || facility.status !== "ACTIVE" || reason.length < 5) return Response.json({ error: "활성 계약과 5자 이상의 재개방 사유가 필요합니다." }, { status: 400 });
    await db.prepare("UPDATE finance_debt_facilities SET status = 'DRAFT', approved_by = '', approved_at = NULL, updated_at = ? WHERE id = ?")
      .bind(now, facility.id).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "DEBT_FACILITY_REOPENED", entityType: "financeDebtFacility", entityId: facility.id, before: facility, after: { status: "DRAFT" }, reason });
    return Response.json({ id: facility.id, status: "DRAFT" });
  }

  if (action === "CLOSE_FACILITY") {
    const reason = String(body.reason ?? "").trim(); const account = facility ? sourceAccount(facility.source_account_id) : undefined;
    const open = facility ? await db.prepare(`SELECT COUNT(*) AS count FROM finance_debt_schedule_items schedule
      LEFT JOIN finance_expense_requests expense ON expense.id = schedule.payment_request_id
      WHERE schedule.facility_id = ? AND schedule.status <> 'CANCELLED' AND COALESCE(expense.status, '') <> 'PAID'`).bind(facility.id).first<{ count: number }>() : null;
    if (!facility || facility.status !== "ACTIVE" || !account || account.krwBalance !== 0 || (open?.count ?? 0) > 0 || reason.length < 5)
      return Response.json({ error: "Clobe 잔액이 0원이고 미완료 일정이 없는 활성 계약만 5자 이상의 사유로 종료할 수 있습니다." }, { status: 409 });
    await db.prepare("UPDATE finance_debt_facilities SET status = 'CLOSED', updated_at = ? WHERE id = ?").bind(now, facility.id).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "DEBT_FACILITY_CLOSED", entityType: "financeDebtFacility", entityId: facility.id, before: facility, after: { status: "CLOSED" }, reason });
    return Response.json({ id: facility.id, status: "CLOSED" });
  }

  if (action === "CREATE_SCHEDULE") {
    const dueDate = String(body.dueDate ?? "").trim(); const itemType = String(body.itemType ?? "").toUpperCase();
    const amount = Math.round(Number(body.amount)); const note = String(body.note ?? "").trim();
    if (!facility || facility.status !== "ACTIVE" || !validDate(dueDate) || !["PRINCIPAL", "INTEREST", "FEE"].includes(itemType)
      || !Number.isSafeInteger(amount) || amount <= 0) return Response.json({ error: "활성 계약과 지급일·구분·0원 초과 고지금액을 확인해 주세요." }, { status: 400 });
    if (await locked(dueDate.slice(0, 7))) return Response.json({ error: "잠긴 마감월에는 상환 일정을 추가할 수 없습니다." }, { status: 409 });
    if (itemType === "PRINCIPAL") {
      const account = sourceAccount(facility.source_account_id);
      const planned = await db.prepare(`SELECT COALESCE(SUM(schedule.amount), 0) AS amount FROM finance_debt_schedule_items schedule
        LEFT JOIN finance_expense_requests expense ON expense.id = schedule.payment_request_id
        WHERE schedule.facility_id = ? AND schedule.item_type = 'PRINCIPAL' AND schedule.status <> 'CANCELLED'
          AND COALESCE(expense.status, '') <> 'PAID'`).bind(facility.id).first<{ amount: number }>();
      if (!account || (planned?.amount ?? 0) + amount > account.krwBalance)
        return Response.json({ error: "미지급 원금 일정 합계가 현재 Clobe 대출잔액을 초과할 수 없습니다." }, { status: 409 });
    }
    const id = crypto.randomUUID();
    try { await db.prepare(`INSERT INTO finance_debt_schedule_items
      (id, facility_id, due_date, item_type, amount, status, payment_request_id, note, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'PLANNED', '', ?, ?, ?, ?)`)
      .bind(id, facility.id, dueDate, itemType, amount, note, authorization.principal.employeeId, now, now).run(); }
    catch { return Response.json({ error: "같은 계약·지급일·구분의 일정이 이미 등록되어 있습니다." }, { status: 409 }); }
    const after = await db.prepare("SELECT * FROM finance_debt_schedule_items WHERE id = ?").bind(id).first<ScheduleRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "DEBT_SCHEDULE_CREATED", entityType: "financeDebtSchedule", entityId: id, after });
    return Response.json({ item: after }, { status: 201 });
  }

  const scheduleId = String(body.scheduleId ?? "").trim();
  const schedule = scheduleId ? await db.prepare("SELECT * FROM finance_debt_schedule_items WHERE id = ?").bind(scheduleId).first<ScheduleRow>() : null;

  if (action === "CANCEL_SCHEDULE") {
    const reason = String(body.reason ?? "").trim();
    const expense = schedule?.payment_request_id ? await db.prepare("SELECT status FROM finance_expense_requests WHERE id = ?").bind(schedule.payment_request_id).first<{ status: string }>() : null;
    if (!schedule || schedule.status !== "PLANNED" || (expense && !["CANCELLED", "REJECTED"].includes(expense.status)) || reason.length < 5)
      return Response.json({ error: "지급 요청이 진행되지 않은 일정과 5자 이상의 취소 사유가 필요합니다." }, { status: 409 });
    if (await locked(schedule.due_date.slice(0, 7))) return Response.json({ error: "잠긴 마감월의 일정은 취소할 수 없습니다." }, { status: 409 });
    await db.prepare("UPDATE finance_debt_schedule_items SET status = 'CANCELLED', note = ?, updated_at = ? WHERE id = ?")
      .bind(`${schedule.note}${schedule.note ? " · " : ""}취소: ${reason}`, now, schedule.id).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "DEBT_SCHEDULE_CANCELLED", entityType: "financeDebtSchedule", entityId: schedule.id, before: schedule, after: { status: "CANCELLED" }, reason });
    return Response.json({ id: schedule.id, status: "CANCELLED" });
  }

  if (action === "CREATE_PAYMENT_REQUEST") {
    const parent = schedule ? await db.prepare("SELECT * FROM finance_debt_facilities WHERE id = ?").bind(schedule.facility_id).first<FacilityRow>() : null;
    if (!schedule || schedule.status !== "PLANNED" || schedule.payment_request_id || !parent || parent.status !== "ACTIVE")
      return Response.json({ error: "활성 계약의 미연결 상환 일정만 지급요청으로 전환할 수 있습니다." }, { status: 409 });
    if (await locked(schedule.due_date.slice(0, 7))) return Response.json({ error: "잠긴 마감월에는 지급요청을 만들 수 없습니다." }, { status: 409 });
    const requestId = `debt-${schedule.id}`; const label = schedule.item_type === "PRINCIPAL" ? "원금 상환" : schedule.item_type === "INTEREST" ? "이자 지급" : "금융 수수료";
    const result = await db.batch([
      db.prepare(`INSERT INTO finance_expense_requests
        (id, request_kind, title, vendor, amount, requested_date, due_date, account_code, account_name,
          payment_method, memo, source_type, source_id, status, requester_employee_id, approved_by, approved_at,
          paid_by, paid_at, journal_status, evidence_required, created_at, updated_at)
        VALUES (?, 'PAYMENT', ?, ?, ?, ?, ?, '', '', 'BANK_TRANSFER', ?, 'DEBT_SCHEDULE', ?, 'DRAFT', ?, '', NULL, '', NULL, 'UNPOSTED', 1, ?, ?)`)
        .bind(requestId, `${parent.facility_name} ${label}`, parent.lender_name, schedule.amount, financeCurrentData.asOf,
          schedule.due_date, `${parent.facility_code} · ${schedule.note || "은행 고지액 기준"}`, schedule.id,
          authorization.principal.employeeId, now, now),
      db.prepare("UPDATE finance_debt_schedule_items SET payment_request_id = ?, updated_at = ? WHERE id = ? AND payment_request_id = ''")
        .bind(requestId, now, schedule.id),
    ]);
    if ((result[1].meta.changes ?? 0) < 1) return Response.json({ error: "일정 상태가 변경되어 지급요청을 만들지 못했습니다." }, { status: 409 });
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "DEBT_PAYMENT_REQUEST_CREATED", entityType: "financeDebtSchedule", entityId: schedule.id, before: schedule, after: { paymentRequestId: requestId, amount: schedule.amount } });
    return Response.json({ scheduleId: schedule.id, paymentRequestId: requestId }, { status: 201 });
  }

  if (action === "RESET_PAYMENT_REQUEST") {
    const reason = String(body.reason ?? "").trim();
    const expense = schedule?.payment_request_id ? await db.prepare("SELECT status FROM finance_expense_requests WHERE id = ?").bind(schedule.payment_request_id).first<{ status: string }>() : null;
    if (!schedule || !schedule.payment_request_id || !expense || !["CANCELLED", "REJECTED"].includes(expense.status) || reason.length < 5)
      return Response.json({ error: "취소·반려된 지급요청과 5자 이상의 재작성 사유가 필요합니다." }, { status: 409 });
    if (await locked(schedule.due_date.slice(0, 7))) return Response.json({ error: "잠긴 마감월의 지급요청 연결은 해제할 수 없습니다." }, { status: 409 });
    await db.prepare("UPDATE finance_debt_schedule_items SET payment_request_id = '', updated_at = ? WHERE id = ?").bind(now, schedule.id).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "DEBT_PAYMENT_REQUEST_RESET", entityType: "financeDebtSchedule", entityId: schedule.id, before: schedule, after: { paymentRequestId: "" }, reason });
    return Response.json({ id: schedule.id, reset: true });
  }

  if (action === "CREATE_COVENANT_REVIEW") {
    const reviewDate = String(body.reviewDate ?? "").trim(); const covenantName = String(body.covenantName ?? "").trim();
    const comparator = String(body.comparator ?? "GTE").toUpperCase(); const threshold = Number(body.thresholdValue);
    const actual = Number(body.actualValue); const unit = String(body.unit ?? "").trim(); const documentId = String(body.evidenceDocumentId ?? "").trim();
    const note = String(body.note ?? "").trim(); const nextReviewDate = String(body.nextReviewDate ?? "").trim();
    const thresholdScaled = Math.round(threshold * 10000); const actualScaled = Math.round(actual * 10000);
    const document = facility && documentId ? await db.prepare(`SELECT id FROM erp_documents WHERE id = ? AND module = 'finance'
      AND entity_type = 'financeDebtFacility' AND entity_id = ? AND deleted_at IS NULL`).bind(documentId, facility.id).first() : null;
    if (!facility || facility.status !== "ACTIVE" || !validDate(reviewDate) || reviewDate > financeCurrentData.asOf
      || covenantName.length < 2 || !["GTE", "LTE"].includes(comparator) || !Number.isFinite(threshold) || !Number.isFinite(actual)
      || !Number.isSafeInteger(thresholdScaled) || !Number.isSafeInteger(actualScaled) || !unit || !document
      || (nextReviewDate && (!validDate(nextReviewDate) || nextReviewDate <= reviewDate)))
      return Response.json({ error: "활성 계약, 검토일·약정명·비교기준·실적·단위·근거문서와 다음 검토일을 확인해 주세요." }, { status: 400 });
    const result = comparator === "GTE" ? (actualScaled >= thresholdScaled ? "PASS" : "BREACH") : (actualScaled <= thresholdScaled ? "PASS" : "BREACH");
    if (result === "BREACH" && note.length < 10) return Response.json({ error: "약정 위반에는 10자 이상의 원인·조치 메모가 필요합니다." }, { status: 400 });
    const id = crypto.randomUUID();
    try { await db.batch([
      db.prepare(`INSERT INTO finance_debt_covenant_reviews
        (id, facility_id, review_date, covenant_name, comparator, threshold_value_scaled, actual_value_scaled,
          unit, result, evidence_document_id, note, reviewed_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(id, facility.id, reviewDate, covenantName, comparator, thresholdScaled, actualScaled, unit, result,
          documentId, note, authorization.principal.employeeId, now, now),
      db.prepare("UPDATE finance_debt_facilities SET next_covenant_review_date = ?, updated_at = ? WHERE id = ?")
        .bind(nextReviewDate, now, facility.id),
    ]); } catch { return Response.json({ error: "같은 계약·검토일·약정명의 검토 기록이 이미 있습니다." }, { status: 409 }); }
    const after = await db.prepare("SELECT * FROM finance_debt_covenant_reviews WHERE id = ?").bind(id).first<ReviewRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "DEBT_COVENANT_REVIEWED", entityType: "financeDebtCovenantReview", entityId: id, after });
    return Response.json({ item: after, result }, { status: 201 });
  }

  return Response.json({ error: "지원하지 않는 차입금 관리 작업입니다." }, { status: 400 });
}
