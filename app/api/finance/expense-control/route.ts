import { env } from "cloudflare:workers";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";
import { financeCurrentData } from "../../../finance-current-data";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;
type CardRow = { id: string; issuer: string; nickname: string; last4: string; holder_employee_id: string; monthly_limit: number;
  status: string; created_by: string; created_at: number; updated_at: number };
type CardTransactionRow = { id: string; card_id: string; external_reference: string; transaction_date: string; merchant: string;
  amount: number; currency: string; direction: string; status: string; expense_request_id: string; exclusion_reason: string;
  source_file_name: string; created_by: string; created_at: number; updated_at: number };
type ExpenseControlRow = { expense_request_id: string; business_purpose: string; evidence_status: string; evidence_document_id: string;
  card_transaction_id: string; tax_treatment: string; review_note: string; reviewed_by: string; reviewed_at: number | null;
  created_at: number; updated_at: number };

const currentPeriod = financeCurrentData.asOf.slice(0, 7);
const validPeriod = (period: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(period) && period <= currentPeriod;
const validDate = (date: string) => /^2026-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date) && date <= financeCurrentData.asOf;

async function ensureSchema() {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_corporate_cards (
      id TEXT PRIMARY KEY NOT NULL, issuer TEXT NOT NULL, nickname TEXT NOT NULL, last4 TEXT NOT NULL,
      holder_employee_id TEXT NOT NULL DEFAULT '', monthly_limit INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE', created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_card_transactions (
      id TEXT PRIMARY KEY NOT NULL, card_id TEXT NOT NULL, external_reference TEXT NOT NULL,
      transaction_date TEXT NOT NULL, merchant TEXT NOT NULL, amount INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'KRW',
      direction TEXT NOT NULL DEFAULT 'CHARGE', status TEXT NOT NULL DEFAULT 'UNMATCHED', expense_request_id TEXT NOT NULL DEFAULT '',
      exclusion_reason TEXT NOT NULL DEFAULT '', source_file_name TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_expense_controls (
      expense_request_id TEXT PRIMARY KEY NOT NULL, business_purpose TEXT NOT NULL DEFAULT '',
      evidence_status TEXT NOT NULL DEFAULT 'PENDING', evidence_document_id TEXT NOT NULL DEFAULT '',
      card_transaction_id TEXT NOT NULL DEFAULT '', tax_treatment TEXT NOT NULL DEFAULT 'UNREVIEWED',
      review_note TEXT NOT NULL DEFAULT '', reviewed_by TEXT NOT NULL DEFAULT '', reviewed_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_corporate_card_issuer_last4 ON finance_corporate_cards(issuer, last4)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_corporate_card_status_holder ON finance_corporate_cards(status, holder_employee_id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_card_transaction_reference ON finance_card_transactions(card_id, external_reference)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_card_transaction_expense ON finance_card_transactions(expense_request_id) WHERE expense_request_id <> ''"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_card_transaction_status_date ON finance_card_transactions(status, transaction_date)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_expense_control_card ON finance_expense_controls(card_transaction_id) WHERE card_transaction_id <> ''"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_expense_control_evidence_status ON finance_expense_controls(evidence_status, updated_at)"),
  ]);
}

async function locked(period: string) {
  return (await db.prepare("SELECT status FROM finance_close_runs WHERE period = ?").bind(period).first<{ status: string }>())?.status === "CLOSED";
}

export async function GET(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "finance", "read");
  if (authorization.response) return authorization.response;
  const period = new URL(request.url).searchParams.get("period")?.trim() || currentPeriod;
  if (!validPeriod(period)) return Response.json({ error: "2026년 현재까지의 지출 관리월을 선택해 주세요." }, { status: 400 });
  const like = `${period}-%`;
  const [cards, transactions, expenses, documents] = await Promise.all([
    db.prepare("SELECT * FROM finance_corporate_cards ORDER BY CASE status WHEN 'ACTIVE' THEN 0 ELSE 1 END, issuer, last4").all<CardRow>(),
    db.prepare(`SELECT transaction_row.*, card.issuer, card.nickname, card.last4, card.holder_employee_id,
        expense.title AS expense_title, expense.status AS expense_status
      FROM finance_card_transactions transaction_row JOIN finance_corporate_cards card ON card.id = transaction_row.card_id
      LEFT JOIN finance_expense_requests expense ON expense.id = transaction_row.expense_request_id
      WHERE transaction_row.transaction_date LIKE ? ORDER BY transaction_row.transaction_date DESC, transaction_row.created_at DESC`)
      .bind(like).all<CardTransactionRow & { issuer: string; nickname: string; last4: string; holder_employee_id: string; expense_title: string; expense_status: string }>(),
    db.prepare(`SELECT expense.*, COALESCE(control.business_purpose, '') AS business_purpose,
        COALESCE(control.evidence_status, 'PENDING') AS evidence_status,
        COALESCE(control.evidence_document_id, '') AS evidence_document_id,
        COALESCE(control.card_transaction_id, '') AS card_transaction_id,
        COALESCE(control.tax_treatment, 'UNREVIEWED') AS tax_treatment,
        COALESCE(control.review_note, '') AS review_note, COALESCE(control.reviewed_by, '') AS reviewed_by,
        control.reviewed_at, payment.id AS payment_id, payment.payment_date,
        COALESCE((SELECT COUNT(*) FROM erp_documents document WHERE document.module = 'finance'
          AND document.entity_type = 'financeExpense' AND document.entity_id = expense.id AND document.deleted_at IS NULL), 0) AS evidence_count,
        COALESCE((SELECT SUM(match_row.matched_amount) FROM finance_cash_matches match_row
          WHERE match_row.source_type = 'PAYMENT_LEDGER' AND match_row.source_id = payment.id AND match_row.status = 'CONFIRMED'), 0) AS bank_matched_amount,
        COALESCE((SELECT COUNT(*) FROM finance_expense_requests duplicate
          WHERE duplicate.id <> expense.id AND duplicate.status NOT IN ('CANCELLED','REJECTED')
            AND duplicate.requested_date = expense.requested_date AND duplicate.amount = expense.amount
            AND LOWER(TRIM(duplicate.vendor)) = LOWER(TRIM(expense.vendor))), 0) AS duplicate_count
      FROM finance_expense_requests expense
      LEFT JOIN finance_expense_controls control ON control.expense_request_id = expense.id
      LEFT JOIN finance_payment_ledger payment ON payment.request_id = expense.id AND payment.status = 'PAID'
      WHERE expense.requested_date LIKE ? ORDER BY expense.requested_date DESC, expense.created_at DESC`).bind(like)
      .all<Record<string, string | number | null>>(),
    db.prepare(`SELECT document.* FROM erp_documents document JOIN finance_expense_requests expense ON expense.id = document.entity_id
      WHERE document.module = 'finance' AND document.entity_type = 'financeExpense' AND document.deleted_at IS NULL
        AND expense.requested_date LIKE ? ORDER BY document.created_at DESC`).bind(like).all<Record<string, string | number | null>>(),
  ]);
  const expenseViews = expenses.results.map((row) => ({ ...row,
    bank_remaining_amount: Math.max(0, Number(row.amount ?? 0) - Number(row.bank_matched_amount ?? 0)),
    documents: documents.results.filter((document) => document.entity_id === row.id).map((document) => ({ id: document.id,
      category: document.category, version: document.version, fileName: document.file_name, uploadedBy: document.uploaded_by,
      createdAt: document.created_at, downloadUrl: `/api/documents?downloadId=${encodeURIComponent(String(document.id))}` })),
  }));
  const pendingEvidence = expenseViews.filter((row) => Number(row.evidence_required) === 1 && !["CANCELLED", "REJECTED"].includes(String(row.status))
    && !["VERIFIED", "EXEMPT"].includes(String(row.evidence_status))).length;
  const bankUnmatched = expenseViews.filter((row) => row.status === "PAID" && ["BANK_TRANSFER", "AUTO_DEBIT"].includes(String(row.payment_method))
    && Number(row.bank_remaining_amount) > 0).length;
  return Response.json({ asOf: financeCurrentData.asOf, currentPeriod, period, locked: await locked(period), cards: cards.results,
    transactions: transactions.results, expenses: expenseViews,
    summary: { activeCards: cards.results.filter((card) => card.status === "ACTIVE").length,
      cardTransactions: transactions.results.length,
      unmatchedCards: transactions.results.filter((row) => row.status === "UNMATCHED").length,
      pendingEvidence, bankUnmatched,
      duplicateCandidates: expenseViews.filter((row) => Number(row.duplicate_count) > 0).length },
    sourceNote: "카드사 명세서 양식이 제공되기 전에는 참조값을 직접 등록합니다. 전체 카드번호와 외화 원화환산값은 추정·저장하지 않습니다." });
}

export async function POST(request: Request) {
  await ensureSchema();
  const body = await request.json() as Record<string, unknown>; const action = String(body.action ?? "").toUpperCase();
  const approvalActions = new Set(["MATCH_CARD", "UNMATCH_CARD", "EXCLUDE_TRANSACTION", "REVIEW_EVIDENCE", "REOPEN_REVIEW", "SET_CARD_STATUS"]);
  const authorization = await authorizeErpRequest(db, "finance", approvalActions.has(action) ? "approve" : "write");
  if (authorization.response) return authorization.response;
  const now = Date.now();

  if (action === "CREATE_CARD") {
    const issuer = String(body.issuer ?? "").trim(); const nickname = String(body.nickname ?? "").trim();
    const last4 = String(body.last4 ?? "").trim(); const monthlyLimit = Math.round(Number(body.monthlyLimit ?? 0));
    if (!issuer || !nickname || !/^\d{4}$/.test(last4) || !Number.isSafeInteger(monthlyLimit) || monthlyLimit < 0)
      return Response.json({ error: "카드사·별칭·끝 4자리와 0원 이상의 한도를 확인해 주세요." }, { status: 400 });
    const id = crypto.randomUUID();
    try { await db.prepare(`INSERT INTO finance_corporate_cards
      (id, issuer, nickname, last4, holder_employee_id, monthly_limit, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`).bind(id, issuer, nickname, last4,
      String(body.holderEmployeeId ?? "").trim(), monthlyLimit, authorization.principal.employeeId, now, now).run(); }
    catch { return Response.json({ error: "같은 카드사와 끝 4자리의 카드가 이미 등록되어 있습니다." }, { status: 409 }); }
    const after = await db.prepare("SELECT * FROM finance_corporate_cards WHERE id = ?").bind(id).first<CardRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "CORPORATE_CARD_CREATED",
      entityType: "financeCorporateCard", entityId: id, after });
    return Response.json({ item: after }, { status: 201 });
  }

  if (action === "REGISTER_TRANSACTION") {
    const cardId = String(body.cardId ?? "").trim(); const externalReference = String(body.externalReference ?? "").trim();
    const transactionDate = String(body.transactionDate ?? "").trim(); const merchant = String(body.merchant ?? "").trim();
    const amount = Math.round(Number(body.amount)); const direction = String(body.direction ?? "CHARGE").toUpperCase();
    const card = await db.prepare("SELECT * FROM finance_corporate_cards WHERE id = ? AND status = 'ACTIVE'").bind(cardId).first<CardRow>();
    if (!card || externalReference.length < 4 || !validDate(transactionDate) || !merchant || !Number.isSafeInteger(amount) || amount <= 0
      || !["CHARGE", "REFUND"].includes(direction) || String(body.currency ?? "KRW") !== "KRW")
      return Response.json({ error: "활성 카드·거래 참조값·거래일·가맹점·원화 금액을 확인해 주세요." }, { status: 400 });
    if (await locked(transactionDate.slice(0, 7))) return Response.json({ error: "잠긴 마감월에는 카드 거래를 추가할 수 없습니다." }, { status: 409 });
    const id = crypto.randomUUID();
    try { await db.prepare(`INSERT INTO finance_card_transactions
      (id, card_id, external_reference, transaction_date, merchant, amount, currency, direction, status,
        expense_request_id, exclusion_reason, source_file_name, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'KRW', ?, 'UNMATCHED', '', '', ?, ?, ?, ?)`)
      .bind(id, cardId, externalReference, transactionDate, merchant, amount, direction,
        String(body.sourceFileName ?? "직접 등록").trim(), authorization.principal.employeeId, now, now).run(); }
    catch { return Response.json({ error: "이 카드의 같은 거래 참조값이 이미 등록되어 있습니다." }, { status: 409 }); }
    const after = await db.prepare("SELECT * FROM finance_card_transactions WHERE id = ?").bind(id).first<CardTransactionRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "CARD_TRANSACTION_REGISTERED",
      entityType: "financeCardTransaction", entityId: id, after });
    return Response.json({ item: after }, { status: 201 });
  }

  if (action === "MATCH_CARD") {
    const transactionId = String(body.transactionId ?? "").trim(); const expenseId = String(body.expenseRequestId ?? "").trim();
    const [transaction, expense] = await Promise.all([
      db.prepare("SELECT * FROM finance_card_transactions WHERE id = ?").bind(transactionId).first<CardTransactionRow>(),
      db.prepare("SELECT * FROM finance_expense_requests WHERE id = ?").bind(expenseId).first<Record<string, string | number>>(),
    ]);
    if (!transaction || transaction.status !== "UNMATCHED" || transaction.direction !== "CHARGE" || transaction.currency !== "KRW")
      return Response.json({ error: "대사 가능한 원화 카드 승인 거래를 찾지 못했습니다." }, { status: 409 });
    if (!expense || expense.status !== "APPROVED" || expense.payment_method !== "CORPORATE_CARD" || Number(expense.amount) !== transaction.amount)
      return Response.json({ error: "금액이 정확히 같은 승인 완료 법인카드 지출만 연결할 수 있습니다." }, { status: 409 });
    if (await locked(transaction.transaction_date.slice(0, 7)) || await locked(String(expense.requested_date).slice(0, 7)))
      return Response.json({ error: "잠긴 마감월의 카드 대사는 변경할 수 없습니다." }, { status: 409 });
    try { await db.batch([
      db.prepare(`INSERT INTO finance_expense_controls
        (expense_request_id, card_transaction_id, created_at, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(expense_request_id) DO UPDATE SET card_transaction_id = excluded.card_transaction_id, updated_at = excluded.updated_at`)
        .bind(expenseId, transactionId, now, now),
      db.prepare(`UPDATE finance_card_transactions SET status = 'MATCHED', expense_request_id = ?, updated_at = ?
        WHERE id = ? AND status = 'UNMATCHED' AND expense_request_id = ''`).bind(expenseId, now, transactionId),
    ]); } catch { return Response.json({ error: "카드 거래 또는 지출이 이미 다른 항목에 연결되어 있습니다." }, { status: 409 }); }
    const after = await db.prepare("SELECT * FROM finance_card_transactions WHERE id = ?").bind(transactionId).first<CardTransactionRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "CARD_EXPENSE_MATCHED",
      entityType: "financeCardTransaction", entityId: transactionId, before: transaction, after });
    return Response.json({ item: after });
  }

  if (action === "UNMATCH_CARD") {
    const transactionId = String(body.transactionId ?? "").trim(); const reason = String(body.reason ?? "").trim();
    const before = await db.prepare("SELECT * FROM finance_card_transactions WHERE id = ? AND status = 'MATCHED'").bind(transactionId).first<CardTransactionRow>();
    if (!before || reason.length < 5) return Response.json({ error: "대사 거래와 5자 이상의 해제 사유가 필요합니다." }, { status: 400 });
    const expense = await db.prepare("SELECT status, requested_date FROM finance_expense_requests WHERE id = ?").bind(before.expense_request_id)
      .first<{ status: string; requested_date: string }>();
    if (!expense || expense.status === "PAID") return Response.json({ error: "지급 완료된 법인카드 지출은 대사를 해제할 수 없습니다. 취소·역분개 절차가 필요합니다." }, { status: 409 });
    if (await locked(before.transaction_date.slice(0, 7)) || await locked(expense.requested_date.slice(0, 7)))
      return Response.json({ error: "잠긴 마감월의 카드 대사는 해제할 수 없습니다." }, { status: 409 });
    await db.batch([
      db.prepare("UPDATE finance_card_transactions SET status = 'UNMATCHED', expense_request_id = '', updated_at = ? WHERE id = ?").bind(now, transactionId),
      db.prepare("UPDATE finance_expense_controls SET card_transaction_id = '', updated_at = ? WHERE expense_request_id = ?").bind(now, before.expense_request_id),
    ]);
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "CARD_EXPENSE_UNMATCHED",
      entityType: "financeCardTransaction", entityId: transactionId, before, after: { status: "UNMATCHED" }, reason });
    return Response.json({ id: transactionId, unmatched: true });
  }

  if (action === "EXCLUDE_TRANSACTION") {
    const transactionId = String(body.transactionId ?? "").trim(); const reason = String(body.reason ?? "").trim();
    const before = await db.prepare("SELECT * FROM finance_card_transactions WHERE id = ? AND status = 'UNMATCHED'").bind(transactionId).first<CardTransactionRow>();
    if (!before || reason.length < 5) return Response.json({ error: "미대사 거래와 5자 이상의 제외 사유가 필요합니다." }, { status: 400 });
    if (await locked(before.transaction_date.slice(0, 7))) return Response.json({ error: "잠긴 마감월의 카드 거래는 제외할 수 없습니다." }, { status: 409 });
    await db.prepare("UPDATE finance_card_transactions SET status = 'EXCLUDED', exclusion_reason = ?, updated_at = ? WHERE id = ?")
      .bind(reason, now, transactionId).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "CARD_TRANSACTION_EXCLUDED",
      entityType: "financeCardTransaction", entityId: transactionId, before, after: { status: "EXCLUDED", reason }, reason });
    return Response.json({ id: transactionId, excluded: true });
  }

  if (action === "REVIEW_EVIDENCE") {
    const expenseId = String(body.expenseRequestId ?? "").trim(); const evidenceStatus = String(body.evidenceStatus ?? "VERIFIED").toUpperCase();
    const documentId = String(body.evidenceDocumentId ?? "").trim(); const businessPurpose = String(body.businessPurpose ?? "").trim();
    const taxTreatment = String(body.taxTreatment ?? "UNREVIEWED").toUpperCase(); const reviewNote = String(body.reviewNote ?? "").trim();
    const expense = await db.prepare("SELECT * FROM finance_expense_requests WHERE id = ?").bind(expenseId).first<Record<string, string | number>>();
    if (!expense || ["CANCELLED", "REJECTED"].includes(String(expense.status)) || !["VERIFIED", "EXEMPT"].includes(evidenceStatus)
      || businessPurpose.length < 5 || !["DEDUCTIBLE", "NONDEDUCTIBLE", "OUT_OF_SCOPE"].includes(taxTreatment)
      || (evidenceStatus === "EXEMPT" && reviewNote.length < 10))
      return Response.json({ error: "업무 목적, 증빙 상태, 세무 판단과 예외 사유를 확인해 주세요." }, { status: 400 });
    if (await locked(String(expense.requested_date).slice(0, 7))) return Response.json({ error: "잠긴 마감월의 증빙 검토는 변경할 수 없습니다." }, { status: 409 });
    if (evidenceStatus === "VERIFIED") {
      const document = await db.prepare(`SELECT id FROM erp_documents WHERE id = ? AND module = 'finance'
        AND entity_type = 'financeExpense' AND entity_id = ? AND deleted_at IS NULL`).bind(documentId, expenseId).first();
      if (!document) return Response.json({ error: "해당 지출에 첨부된 유효한 증빙 문서를 선택해 주세요." }, { status: 409 });
    }
    const before = await db.prepare("SELECT * FROM finance_expense_controls WHERE expense_request_id = ?").bind(expenseId).first<ExpenseControlRow>();
    if (before && ["VERIFIED", "EXEMPT"].includes(before.evidence_status)) {
      return Response.json({ error: "완료된 증빙 검토는 재개방한 뒤 다시 확정해 주세요." }, { status: 409 });
    }
    await db.prepare(`INSERT INTO finance_expense_controls
      (expense_request_id, business_purpose, evidence_status, evidence_document_id, tax_treatment, review_note,
        reviewed_by, reviewed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(expense_request_id) DO UPDATE SET business_purpose = excluded.business_purpose,
        evidence_status = excluded.evidence_status, evidence_document_id = excluded.evidence_document_id,
        tax_treatment = excluded.tax_treatment, review_note = excluded.review_note,
        reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at, updated_at = excluded.updated_at`)
      .bind(expenseId, businessPurpose, evidenceStatus, evidenceStatus === "VERIFIED" ? documentId : "", taxTreatment,
        reviewNote, authorization.principal.employeeId, now, now, now).run();
    const after = await db.prepare("SELECT * FROM finance_expense_controls WHERE expense_request_id = ?").bind(expenseId).first<ExpenseControlRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "EXPENSE_EVIDENCE_REVIEWED",
      entityType: "financeExpense", entityId: expenseId, before, after });
    return Response.json({ item: after });
  }

  if (action === "REOPEN_REVIEW") {
    const expenseId = String(body.expenseRequestId ?? "").trim(); const reason = String(body.reason ?? "").trim();
    const [expense, before] = await Promise.all([
      db.prepare("SELECT requested_date FROM finance_expense_requests WHERE id = ?").bind(expenseId).first<{ requested_date: string }>(),
      db.prepare("SELECT * FROM finance_expense_controls WHERE expense_request_id = ?").bind(expenseId).first<ExpenseControlRow>(),
    ]);
    if (!expense || !before || !["VERIFIED", "EXEMPT"].includes(before.evidence_status) || reason.length < 5)
      return Response.json({ error: "검토 완료 원장과 5자 이상의 재개방 사유가 필요합니다." }, { status: 400 });
    if (await locked(expense.requested_date.slice(0, 7))) return Response.json({ error: "잠긴 마감월의 증빙 검토는 재개방할 수 없습니다." }, { status: 409 });
    await db.prepare(`UPDATE finance_expense_controls SET evidence_status = 'PENDING', evidence_document_id = '',
      tax_treatment = 'UNREVIEWED', reviewed_by = '', reviewed_at = NULL, review_note = ?, updated_at = ? WHERE expense_request_id = ?`)
      .bind(reason, now, expenseId).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "EXPENSE_EVIDENCE_REOPENED",
      entityType: "financeExpense", entityId: expenseId, before, after: { evidenceStatus: "PENDING" }, reason });
    return Response.json({ id: expenseId, evidenceStatus: "PENDING" });
  }

  if (action === "SET_CARD_STATUS") {
    const cardId = String(body.cardId ?? "").trim(); const status = String(body.status ?? "").toUpperCase();
    const before = await db.prepare("SELECT * FROM finance_corporate_cards WHERE id = ?").bind(cardId).first<CardRow>();
    if (!before || !["ACTIVE", "SUSPENDED", "CLOSED"].includes(status)) return Response.json({ error: "카드와 상태를 확인해 주세요." }, { status: 400 });
    if (status === "CLOSED") {
      const unresolved = await db.prepare("SELECT COUNT(*) AS count FROM finance_card_transactions WHERE card_id = ? AND status = 'UNMATCHED'")
        .bind(cardId).first<{ count: number }>();
      if (Number(unresolved?.count ?? 0) > 0) return Response.json({ error: "미대사 카드 거래를 모두 연결하거나 제외한 뒤 카드를 종료해 주세요." }, { status: 409 });
    }
    await db.prepare("UPDATE finance_corporate_cards SET status = ?, updated_at = ? WHERE id = ?").bind(status, now, cardId).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "CORPORATE_CARD_STATUS_UPDATED",
      entityType: "financeCorporateCard", entityId: cardId, before, after: { ...before, status } });
    return Response.json({ id: cardId, status });
  }

  return Response.json({ error: "지원하지 않는 지출통제 작업입니다." }, { status: 400 });
}
