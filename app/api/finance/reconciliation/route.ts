import { env } from "cloudflare:workers";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";
import { financeBankTransactions } from "../../../finance-bank-transactions";
import { financeCurrentData } from "../../../finance-current-data";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;

type BankRow = {
  id: string; source: string; source_snapshot_date: string; account_id: string; bank_code: string;
  bank_name: string; account_name: string; account_last4: string; currency: string; transaction_at: string;
  transaction_date: string; transaction_type: string; description: string; direction: "IN" | "OUT";
  amount: number; after_balance: number; category: string; business_entity_name: string;
  is_unclassified: number; memo: string; imported_at: number; updated_at: number;
};
type MatchRow = {
  id: string; match_group_id: string; bank_transaction_id: string; source_type: string; source_id: string;
  matched_amount: number; match_score: number; match_method: string; status: string; memo: string;
  confirmed_by: string; confirmed_at: number; reversed_by: string; reversed_at: number | null;
  reversal_reason: string; created_at: number; updated_at: number;
};
type SourceCandidate = {
  sourceType: "PAYMENT_LEDGER" | "SALES_PAYMENT";
  sourceId: string;
  direction: "IN" | "OUT";
  date: string;
  amount: number;
  label: string;
  counterparty: string;
  reference: string;
};

async function ensureSchema() {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_bank_transactions (
      id TEXT PRIMARY KEY NOT NULL, source TEXT NOT NULL DEFAULT 'CLOBE', source_snapshot_date TEXT NOT NULL,
      account_id TEXT NOT NULL, bank_code TEXT NOT NULL DEFAULT '', bank_name TEXT NOT NULL DEFAULT '',
      account_name TEXT NOT NULL DEFAULT '', account_last4 TEXT NOT NULL DEFAULT '', currency TEXT NOT NULL DEFAULT 'KRW',
      transaction_at TEXT NOT NULL, transaction_date TEXT NOT NULL, transaction_type TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '', direction TEXT NOT NULL, amount INTEGER NOT NULL,
      after_balance INTEGER NOT NULL DEFAULT 0, category TEXT NOT NULL DEFAULT '', business_entity_name TEXT NOT NULL DEFAULT '',
      is_unclassified INTEGER NOT NULL DEFAULT 0, memo TEXT NOT NULL DEFAULT '', imported_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_cash_matches (
      id TEXT PRIMARY KEY NOT NULL, match_group_id TEXT NOT NULL, bank_transaction_id TEXT NOT NULL,
      source_type TEXT NOT NULL, source_id TEXT NOT NULL, matched_amount INTEGER NOT NULL,
      match_score INTEGER NOT NULL DEFAULT 0, match_method TEXT NOT NULL DEFAULT 'MANUAL',
      status TEXT NOT NULL DEFAULT 'CONFIRMED', memo TEXT NOT NULL DEFAULT '', confirmed_by TEXT NOT NULL,
      confirmed_at INTEGER NOT NULL, reversed_by TEXT NOT NULL DEFAULT '', reversed_at INTEGER,
      reversal_reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_bank_transaction_date_direction ON finance_bank_transactions(transaction_date, direction)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_bank_transaction_account_date ON finance_bank_transactions(account_id, transaction_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_bank_transaction_unclassified ON finance_bank_transactions(is_unclassified, transaction_date)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_cash_match_unique_source ON finance_cash_matches(bank_transaction_id, source_type, source_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_cash_match_bank_status ON finance_cash_matches(bank_transaction_id, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_cash_match_source_status ON finance_cash_matches(source_type, source_id, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_cash_match_group ON finance_cash_matches(match_group_id)"),
  ]);
}

async function seedSnapshot() {
  const existing = await db.prepare("SELECT COUNT(*) AS count FROM finance_bank_transactions WHERE source_snapshot_date = ?")
    .bind(financeCurrentData.asOf).first<{ count: number }>();
  if ((existing?.count ?? 0) >= financeBankTransactions.length) return;
  const now = Date.now();
  const statements = financeBankTransactions.map((item) => db.prepare(`INSERT INTO finance_bank_transactions
    (id, source, source_snapshot_date, account_id, bank_code, bank_name, account_name, account_last4, currency,
      transaction_at, transaction_date, transaction_type, description, direction, amount, after_balance,
      category, business_entity_name, is_unclassified, memo, imported_at, updated_at)
    VALUES (?, 'CLOBE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET source_snapshot_date = excluded.source_snapshot_date,
      bank_code = excluded.bank_code, bank_name = excluded.bank_name, account_name = excluded.account_name,
      account_last4 = excluded.account_last4, currency = excluded.currency, transaction_at = excluded.transaction_at,
      transaction_date = excluded.transaction_date, transaction_type = excluded.transaction_type,
      description = excluded.description, direction = excluded.direction, amount = excluded.amount,
      after_balance = excluded.after_balance, category = excluded.category,
      business_entity_name = excluded.business_entity_name, is_unclassified = excluded.is_unclassified,
      memo = excluded.memo, updated_at = excluded.updated_at`)
    .bind(item.transactionId, financeCurrentData.asOf, String(item.accountId), item.bankCode, item.bankName,
      item.accountName, item.last4, item.currency, item.transactionAt, item.transactionAt.slice(0, 10),
      item.transactionType, item.description, item.direction, Math.round(item.amount), Math.round(item.afterBalance),
      item.category, item.businessEntityName, item.isUnclassified ? 1 : 0, item.memo, now, now));
  for (let offset = 0; offset < statements.length; offset += 40) await db.batch(statements.slice(offset, offset + 40));
  await db.prepare(`INSERT INTO erp_sync_runs
    (id, source, scope, snapshot_date, status, record_count, metrics_json, error_message, started_at, completed_at, created_at)
    VALUES (?, 'CLOBE', 'BANK_TRANSACTIONS', ?, 'SUCCEEDED', ?, ?, '', ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET status = 'SUCCEEDED', record_count = excluded.record_count,
      metrics_json = excluded.metrics_json, completed_at = excluded.completed_at`)
    .bind(`clobe-bank-${financeCurrentData.asOf}`, financeCurrentData.asOf, financeBankTransactions.length,
      JSON.stringify({ startDate: "2026-08-03", endDate: "2026-08-13", deduplicated: true }), now, now, now).run();
}

const dayDistance = (a: string, b: string) => Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000;
const normalized = (value: string) => value.toLowerCase().replace(/\(주\)|주식회사|[^0-9a-z가-힣]/g, "");
const toMatch = (row: MatchRow) => ({
  id: row.id, matchGroupId: row.match_group_id, bankTransactionId: row.bank_transaction_id,
  sourceType: row.source_type, sourceId: row.source_id, matchedAmount: row.matched_amount,
  matchScore: row.match_score, matchMethod: row.match_method, status: row.status, memo: row.memo,
  confirmedBy: row.confirmed_by, confirmedAt: row.confirmed_at, reversedBy: row.reversed_by,
  reversedAt: row.reversed_at, reversalReason: row.reversal_reason,
});

function scoreCandidate(transaction: BankRow, remaining: number, source: SourceCandidate) {
  if (transaction.currency !== "KRW" || transaction.direction !== source.direction) return 0;
  const available = source.amount;
  const gap = Math.abs(remaining - available);
  let score = gap === 0 ? 60 : gap <= Math.max(1000, remaining * 0.01) ? 35 : 0;
  const days = dayDistance(transaction.transaction_date, source.date);
  score += days === 0 ? 25 : days <= 2 ? 15 : days <= 5 ? 8 : 0;
  const transactionText = normalized(`${transaction.description} ${transaction.business_entity_name}`);
  const sourceText = normalized(`${source.counterparty} ${source.label}`);
  if (transactionText.length >= 2 && sourceText.length >= 2 && (transactionText.includes(sourceText) || sourceText.includes(transactionText))) score += 15;
  if (source.reference && transaction.description.includes(source.reference)) score += 20;
  return Math.min(100, score);
}

async function loadSources(): Promise<SourceCandidate[]> {
  const [payments, collections] = await Promise.all([
    db.prepare(`SELECT ledger.id, ledger.payment_date, ledger.amount, ledger.bank_reference,
      request.title, request.vendor FROM finance_payment_ledger ledger
      JOIN finance_expense_requests request ON request.id = ledger.request_id
      WHERE ledger.status = 'PAID' ORDER BY ledger.payment_date DESC`).all<{
        id: string; payment_date: string; amount: number; bank_reference: string; title: string; vendor: string;
      }>(),
    db.prepare(`SELECT document.id, document.issued_date, document.amount, document.document_number,
      opportunity.title, account.name AS account_name FROM sales_documents document
      JOIN sales_opportunities opportunity ON opportunity.id = document.opportunity_id
      LEFT JOIN sales_accounts account ON account.id = opportunity.account_id
      WHERE document.document_type = 'PAYMENT' AND document.status IN ('ACCEPTED','COMPLETED')
      ORDER BY document.issued_date DESC`).all<{
        id: string; issued_date: string; amount: number; document_number: string; title: string; account_name: string | null;
      }>(),
  ]);
  return [
    ...payments.results.map((item): SourceCandidate => ({ sourceType: "PAYMENT_LEDGER", sourceId: item.id, direction: "OUT",
      date: item.payment_date, amount: item.amount, label: item.title, counterparty: item.vendor, reference: item.bank_reference })),
    ...collections.results.map((item): SourceCandidate => ({ sourceType: "SALES_PAYMENT", sourceId: item.id, direction: "IN",
      date: item.issued_date, amount: item.amount, label: item.document_number || item.title,
      counterparty: item.account_name ?? "", reference: item.document_number })),
  ];
}

async function sourceAllocated(sourceType: string, sourceId: string) {
  return Number((await db.prepare(`SELECT COALESCE(SUM(matched_amount), 0) AS amount FROM finance_cash_matches
    WHERE source_type = ? AND source_id = ? AND status = 'CONFIRMED'`)
    .bind(sourceType, sourceId).first<{ amount: number }>())?.amount ?? 0);
}

async function bankAllocated(bankTransactionId: string) {
  return Number((await db.prepare(`SELECT COALESCE(SUM(matched_amount), 0) AS amount FROM finance_cash_matches
    WHERE bank_transaction_id = ? AND status = 'CONFIRMED'`)
    .bind(bankTransactionId).first<{ amount: number }>())?.amount ?? 0);
}

export async function GET() {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "finance", "read");
  if (authorization.response) return authorization.response;
  await seedSnapshot();
  const [transactionsResult, matchesResult, sources] = await Promise.all([
    db.prepare("SELECT * FROM finance_bank_transactions ORDER BY transaction_at DESC, id DESC").all<BankRow>(),
    db.prepare("SELECT * FROM finance_cash_matches ORDER BY confirmed_at DESC").all<MatchRow>(),
    loadSources(),
  ]);
  const activeMatches = matchesResult.results.filter((match) => match.status === "CONFIRMED");
  const matchesByBank = new Map<string, MatchRow[]>();
  for (const match of activeMatches) matchesByBank.set(match.bank_transaction_id, [...(matchesByBank.get(match.bank_transaction_id) ?? []), match]);
  const sourceAllocations = new Map<string, number>();
  for (const match of activeMatches) sourceAllocations.set(`${match.source_type}:${match.source_id}`, (sourceAllocations.get(`${match.source_type}:${match.source_id}`) ?? 0) + match.matched_amount);
  const availableSources = sources.map((source) => ({ ...source, remainingAmount: Math.max(0, source.amount - (sourceAllocations.get(`${source.sourceType}:${source.sourceId}`) ?? 0)) }));

  const transactions = transactionsResult.results.map((transaction) => {
    const matches = matchesByBank.get(transaction.id) ?? [];
    const allocatedAmount = matches.reduce((sum, match) => sum + match.matched_amount, 0);
    const remainingAmount = Math.max(0, transaction.amount - allocatedAmount);
    const excluded = matches.some((match) => match.source_type === "EXCLUDED");
    const transferred = matches.some((match) => match.source_type === "BANK_TRANSACTION");
    const status = remainingAmount === 0 ? (excluded ? "EXCLUDED" : transferred ? "TRANSFER" : "MATCHED") : allocatedAmount > 0 ? "PARTIAL" : "UNMATCHED";
    const sourceCandidates = availableSources
      .filter((source) => source.remainingAmount > 0)
      .map((source) => ({ ...source, score: scoreCandidate(transaction, remainingAmount, { ...source, amount: source.remainingAmount }) }))
      .filter((source) => source.score >= 60)
      .sort((a, b) => b.score - a.score || a.date.localeCompare(b.date))
      .slice(0, 3);
    const transferCandidates = remainingAmount > 0 ? transactionsResult.results
      .filter((peer) => peer.id !== transaction.id && peer.currency === transaction.currency
        && peer.direction !== transaction.direction && peer.amount === remainingAmount
        && dayDistance(peer.transaction_date, transaction.transaction_date) <= 1)
      .map((peer) => ({ sourceType: "BANK_TRANSACTION" as const, sourceId: peer.id, direction: peer.direction,
        date: peer.transaction_date, amount: peer.amount, remainingAmount: peer.amount - (matchesByBank.get(peer.id) ?? []).reduce((sum, match) => sum + match.matched_amount, 0),
        label: `${peer.bankName} ····${peer.account_last4} 계좌`, counterparty: peer.description, reference: peer.transaction_type,
        score: peer.transaction_at.slice(0, 16) === transaction.transaction_at.slice(0, 16) ? 100 : 85 }))
      .filter((peer) => peer.remainingAmount >= remainingAmount)
      .sort((a, b) => b.score - a.score)
      .slice(0, 2) : [];
    return {
      id: transaction.id, source: transaction.source, sourceSnapshotDate: transaction.source_snapshot_date,
      accountId: transaction.account_id, bankCode: transaction.bank_code, bankName: transaction.bank_name,
      accountName: transaction.account_name, accountLast4: transaction.account_last4, currency: transaction.currency,
      transactionAt: transaction.transaction_at, transactionDate: transaction.transaction_date,
      transactionType: transaction.transaction_type, description: transaction.description, direction: transaction.direction,
      amount: transaction.amount, afterBalance: transaction.after_balance, category: transaction.category,
      businessEntityName: transaction.business_entity_name, isUnclassified: Boolean(transaction.is_unclassified), memo: transaction.memo,
      allocatedAmount, remainingAmount, status, matches: matches.map(toMatch),
      candidates: [...transferCandidates, ...sourceCandidates].sort((a, b) => b.score - a.score).slice(0, 3),
    };
  });
  const krwTransactions = transactions.filter((item) => item.currency === "KRW");
  const resolved = krwTransactions.filter((item) => item.remainingAmount === 0);
  return Response.json({
    asOf: financeCurrentData.asOf,
    coverage: { startDate: "2026-08-03", endDate: "2026-08-13", importedCount: transactions.length, deduplicated: true },
    stats: {
      importedCount: transactions.length, resolvedCount: resolved.length,
      pendingCount: krwTransactions.length - resolved.length,
      unclassifiedPendingCount: krwTransactions.filter((item) => item.isUnclassified && item.remainingAmount > 0).length,
      importedAmount: krwTransactions.reduce((sum, item) => sum + item.amount, 0),
      resolvedAmount: resolved.reduce((sum, item) => sum + item.amount, 0),
      reconciliationRate: krwTransactions.length ? Math.round(resolved.length / krwTransactions.length * 1000) / 10 : 0,
    },
    transactions,
    availableSources,
    matches: matchesResult.results.map(toMatch),
  });
}

export async function PUT(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "finance", "write");
  if (authorization.response) return authorization.response;
  await seedSnapshot();
  const body = await request.json() as Record<string, unknown>;
  const action = String(body.action ?? "CONFIRM").toUpperCase();
  const now = Date.now();

  if (action === "REVERSE") {
    const id = String(body.id ?? "").trim();
    const reason = String(body.reason ?? "").trim();
    const before = await db.prepare("SELECT * FROM finance_cash_matches WHERE id = ? AND status = 'CONFIRMED'").bind(id).first<MatchRow>();
    if (!before) return Response.json({ error: "해제할 확정 대사를 찾을 수 없습니다." }, { status: 404 });
    if (reason.length < 3) return Response.json({ error: "대사를 해제하는 사유를 3자 이상 입력해 주세요." }, { status: 400 });
    await db.prepare(`UPDATE finance_cash_matches SET status = 'REVERSED', reversed_by = ?, reversed_at = ?,
      reversal_reason = ?, updated_at = ? WHERE match_group_id = ? AND status = 'CONFIRMED'`)
      .bind(authorization.principal.employeeId, now, reason, now, before.match_group_id).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "CASH_MATCH_REVERSED",
      entityType: "cashMatch", entityId: before.match_group_id, before: toMatch(before), after: { status: "REVERSED", reason } });
    return Response.json({ reversed: true, matchGroupId: before.match_group_id });
  }

  const bankTransactionId = String(body.bankTransactionId ?? "").trim();
  const sourceType = String(body.sourceType ?? "").trim().toUpperCase();
  const sourceId = String(body.sourceId ?? "").trim();
  const memo = String(body.memo ?? "").trim();
  const transaction = await db.prepare("SELECT * FROM finance_bank_transactions WHERE id = ?").bind(bankTransactionId).first<BankRow>();
  if (!transaction) return Response.json({ error: "은행 거래를 찾을 수 없습니다." }, { status: 404 });
  const allocated = await bankAllocated(bankTransactionId);
  const remaining = Math.max(0, transaction.amount - allocated);
  if (remaining <= 0) return Response.json({ error: "이미 전액 대사된 은행 거래입니다." }, { status: 409 });

  if (action === "EXCLUDE") {
    const reason = memo || String(body.reason ?? "").trim();
    if (reason.length < 3) return Response.json({ error: "대사 대상에서 제외하는 사유를 3자 이상 입력해 주세요." }, { status: 400 });
    const id = crypto.randomUUID();
    const groupId = crypto.randomUUID();
    await db.prepare(`INSERT INTO finance_cash_matches
      (id, match_group_id, bank_transaction_id, source_type, source_id, matched_amount, match_score,
        match_method, status, memo, confirmed_by, confirmed_at, reversed_by, reversed_at,
        reversal_reason, created_at, updated_at)
      VALUES (?, ?, ?, 'EXCLUDED', ?, ?, 100, 'MANUAL_EXCLUSION', 'CONFIRMED', ?, ?, ?, '', NULL, '', ?, ?)`)
      .bind(id, groupId, bankTransactionId, `reason:${Date.now()}`, remaining, reason,
        authorization.principal.employeeId, now, now, now).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "BANK_TRANSACTION_EXCLUDED",
      entityType: "bankTransaction", entityId: bankTransactionId, before: { remaining }, after: { groupId, reason } });
    return Response.json({ confirmed: true, id, matchGroupId: groupId });
  }

  if (action !== "CONFIRM" || !["PAYMENT_LEDGER", "SALES_PAYMENT", "BANK_TRANSACTION"].includes(sourceType) || !sourceId) {
    return Response.json({ error: "확정할 원장 또는 상대 계좌 거래를 선택해 주세요." }, { status: 400 });
  }
  let sourceAmount = 0;
  let sourceDirection: "IN" | "OUT" = "OUT";
  let score = 0;
  let peer: BankRow | null = null;
  if (sourceType === "PAYMENT_LEDGER") {
    const source = await db.prepare(`SELECT ledger.amount, ledger.payment_date, ledger.bank_reference,
      request.title, request.vendor FROM finance_payment_ledger ledger JOIN finance_expense_requests request ON request.id = ledger.request_id
      WHERE ledger.id = ? AND ledger.status = 'PAID'`).bind(sourceId).first<{
        amount: number; payment_date: string; bank_reference: string; title: string; vendor: string;
      }>();
    if (!source) return Response.json({ error: "지급원장 후보를 찾을 수 없습니다." }, { status: 404 });
    sourceAmount = source.amount; sourceDirection = "OUT";
    score = scoreCandidate(transaction, remaining, { sourceType: "PAYMENT_LEDGER", sourceId, direction: "OUT",
      date: source.payment_date, amount: source.amount, label: source.title, counterparty: source.vendor, reference: source.bank_reference });
  } else if (sourceType === "SALES_PAYMENT") {
    const source = await db.prepare(`SELECT document.amount, document.issued_date, document.document_number,
      opportunity.title, account.name AS account_name FROM sales_documents document
      JOIN sales_opportunities opportunity ON opportunity.id = document.opportunity_id
      LEFT JOIN sales_accounts account ON account.id = opportunity.account_id
      WHERE document.id = ? AND document.document_type = 'PAYMENT' AND document.status IN ('ACCEPTED','COMPLETED')`)
      .bind(sourceId).first<{ amount: number; issued_date: string; document_number: string; title: string; account_name: string | null }>();
    if (!source) return Response.json({ error: "확정된 수금원장 후보를 찾을 수 없습니다." }, { status: 404 });
    sourceAmount = source.amount; sourceDirection = "IN";
    score = scoreCandidate(transaction, remaining, { sourceType: "SALES_PAYMENT", sourceId, direction: "IN",
      date: source.issued_date, amount: source.amount, label: source.document_number || source.title,
      counterparty: source.account_name ?? "", reference: source.document_number });
  } else {
    peer = await db.prepare("SELECT * FROM finance_bank_transactions WHERE id = ?").bind(sourceId).first<BankRow>();
    if (!peer || peer.id === transaction.id || peer.direction === transaction.direction || peer.currency !== transaction.currency) {
      return Response.json({ error: "반대 방향의 동일 통화 계좌 거래만 내부 이체로 연결할 수 있습니다." }, { status: 409 });
    }
    sourceAmount = peer.amount; sourceDirection = transaction.direction;
    score = peer.amount === remaining && dayDistance(peer.transaction_date, transaction.transaction_date) <= 1 ? 100 : 0;
  }
  if (transaction.currency !== "KRW" && sourceType !== "BANK_TRANSACTION") return Response.json({ error: "외화 거래는 원화 ERP 원장에 직접 연결할 수 없습니다." }, { status: 409 });
  if (sourceDirection !== transaction.direction) return Response.json({ error: "입출금 방향이 다른 원장은 연결할 수 없습니다." }, { status: 409 });
  const sourceUsed = sourceType === "BANK_TRANSACTION" && peer ? await bankAllocated(peer.id) : await sourceAllocated(sourceType, sourceId);
  const sourceRemaining = Math.max(0, sourceAmount - sourceUsed);
  const requestedAmount = Number(body.amount ?? Math.min(remaining, sourceRemaining));
  if (!Number.isInteger(requestedAmount) || requestedAmount <= 0 || requestedAmount > remaining || requestedAmount > sourceRemaining) {
    return Response.json({ error: "대사 금액이 은행 거래 또는 원장의 미대사 잔액을 초과합니다." }, { status: 409 });
  }
  const groupId = crypto.randomUUID();
  const id = crypto.randomUUID();
  const matchMethod = score >= 85 ? "SUGGESTED_CONFIRMED" : "MANUAL";
  const upsert = `INSERT INTO finance_cash_matches
    (id, match_group_id, bank_transaction_id, source_type, source_id, matched_amount, match_score,
      match_method, status, memo, confirmed_by, confirmed_at, reversed_by, reversed_at,
      reversal_reason, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, ?, ?, '', NULL, '', ?, ?)
    ON CONFLICT(bank_transaction_id, source_type, source_id) DO UPDATE SET
      id = excluded.id, match_group_id = excluded.match_group_id, matched_amount = excluded.matched_amount,
      match_score = excluded.match_score, match_method = excluded.match_method, status = 'CONFIRMED',
      memo = excluded.memo, confirmed_by = excluded.confirmed_by, confirmed_at = excluded.confirmed_at,
      reversed_by = '', reversed_at = NULL, reversal_reason = '', updated_at = excluded.updated_at`;
  const statements = [db.prepare(upsert).bind(id, groupId, bankTransactionId, sourceType, sourceId, requestedAmount,
    score, matchMethod, memo, authorization.principal.employeeId, now, now, now)];
  if (sourceType === "BANK_TRANSACTION" && peer) {
    statements.push(db.prepare(upsert).bind(crypto.randomUUID(), groupId, peer.id, "BANK_TRANSACTION", bankTransactionId,
      requestedAmount, score, matchMethod, memo, authorization.principal.employeeId, now, now, now));
  }
  await db.batch(statements);
  await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "CASH_MATCH_CONFIRMED",
    entityType: "cashMatch", entityId: groupId, before: { bankTransactionId, remaining, sourceRemaining },
    after: { sourceType, sourceId, matchedAmount: requestedAmount, score, matchMethod } });
  return Response.json({ confirmed: true, id, matchGroupId: groupId, matchedAmount: requestedAmount });
}
