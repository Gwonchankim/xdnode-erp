import { env } from "cloudflare:workers";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";
import { financeCurrentData } from "../../../finance-current-data";
import { glAccountBalance } from "../../../finance-ledger-snapshot";
import { ensureFinanceTieOutSchema, recordTieOutCheck, reviewTieOutCheck,
  type TieOutBreakdownItem, type TieOutCheckType, type TieOutRow } from "../../../finance-tie-out";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;
const currentPeriod = financeCurrentData.asOf.slice(0, 7);
const validPeriod = (period: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(period) && period <= currentPeriod;
const lastDayOfPeriod = (period: string) => {
  const [year, month] = period.split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
};
const asOfForPeriod = (period: string) => period === currentPeriod ? financeCurrentData.asOf : lastDayOfPeriod(period);

// 매출채권 보조부(sales_documents 청구서 − 확정 수금) 잔액. receivables/route.ts의 정의와 동일한
// 기준(ACCEPTED/COMPLETED 수금만 차감)을 쓴다 — 그 화면의 미수잔액과 이 대사가 서로 다른 숫자를
// 말하면 신뢰를 잃는다.
async function receivablesSubsidiaryAmount() {
  const row = await db.prepare(`SELECT COALESCE(SUM(invoice.amount - COALESCE((
      SELECT SUM(allocation.amount) FROM sales_payment_allocations allocation
      JOIN sales_documents payment ON payment.id = allocation.payment_document_id
      WHERE allocation.invoice_document_id = invoice.id AND payment.status IN ('ACCEPTED','COMPLETED')
    ), 0)), 0) AS outstanding
    FROM sales_documents invoice WHERE invoice.document_type = 'INVOICE' AND invoice.status IN ('ACCEPTED','COMPLETED')`)
    .first<{ outstanding: number }>().catch(() => ({ outstanding: 0 }));
  return Number(row?.outstanding ?? 0);
}

const RECEIVABLES_GL_ACCOUNT_CODE = "1089"; // 외상매출금 — 2025 결산 시산표 기준 고정 코드
const PAYABLES_GL_ACCOUNT_CODE = "2519"; // 외상매입금 — 2025 결산 시산표 기준 고정 코드
const INVENTORY_GL_ACCOUNT_CODE = "1469"; // 상품 — 2025 결산 시산표 기준 고정 코드
const DEBT_GL_ACCOUNT_CODE = "2954"; // 장기차입금 — 2025 결산 시산표 기준 고정 코드
const BANK_GL_ACCOUNT_CODE = "1039"; // 보통예금 — 2025 결산 시산표 기준 고정 코드

// 은행계정조정표(BANK) 보조부 잔액 = 차입금과 마찬가지로 시스템 계산값이 아니라 Clobe 스냅샷의
// 은행성 자산 합계(체크·자유예금 + 외화예금 원화환산) 그대로다. 대시보드·자금일보·13주 예측이
// 모두 같은 정의(checkingBalanceSum + fxBalanceSumKrw)를 쓰므로 여기서도 동일하게 맞춘다.
async function bankSubsidiaryAmount() {
  return financeCurrentData.accountSummary.checkingBalanceSum + financeCurrentData.accountSummary.fxBalanceSumKrw;
}

// 미매칭 은행 거래(자금 대사 화면의 UNMATCHED/PARTIAL과 동일한 정의)를 방향별로 합산한 참고 항목.
// 미기입예금(입금인데 아직 원장 미반영) / 미결제출금(출금인데 아직 원장 미반영) 후보를 가리키되,
// Clobe 은행 거래 원문이 실제로 수집된 기간(현재는 2026-08-03~08-13)에만 값이 채워진다 — 수집
// 밖 기간은 원문 자체가 없어 빈 배열을 반환하며, 이는 "차이 없음"이 아니라 "확인 불가"를 뜻한다.
async function bankBreakdown(period: string): Promise<TieOutBreakdownItem[]> {
  const rows = await db.prepare(`SELECT direction, COUNT(*) AS count, COALESCE(SUM(amount - matched), 0) AS amount
    FROM (
      SELECT transaction_row.id, transaction_row.direction, transaction_row.amount,
        COALESCE((SELECT SUM(match_row.matched_amount) FROM finance_cash_matches match_row
          WHERE match_row.bank_transaction_id = transaction_row.id AND match_row.status = 'CONFIRMED'), 0) AS matched
      FROM finance_bank_transactions transaction_row
      WHERE transaction_row.currency = 'KRW' AND transaction_row.transaction_date LIKE ?
    ) unmatched
    WHERE amount > matched
    GROUP BY direction`).bind(`${period}%`).all<{ direction: "IN" | "OUT"; count: number; amount: number }>();
  return rows.results.map((row) => ({
    label: row.direction === "IN" ? "미기입예금 후보(미매칭 입금)" : "미결제출금 후보(미매칭 출금)",
    direction: row.direction, count: Number(row.count), amount: Number(row.amount),
  }));
}

// 차입금 보조부는 다른 세 대사와 성격이 다르다 — debt/route.ts의 잔액 자체가 이미
// financeCurrentData(Clobe 스냅샷)의 정적 값이라, 여기서도 같은 값을 다시 읽는다. 즉 이 대사가
// 확인하는 것은 "시스템이 계산한 잔액과 원장이 맞는가"가 아니라 "가장 최근 Clobe 스냅샷과 이카운트
// import 원장이 맞는가"다 — 스냅샷이 갱신되지 않으면 대사도 갱신되지 않는다는 한계가 있다.
async function debtSubsidiaryAmount() {
  return financeCurrentData.accounts.filter((account) => account.type === "LOAN")
    .reduce((sum, account) => sum + account.krwBalance, 0);
}

// 재고자산 보조부(전 품목·전 창고 이동원장 누적) 잔액. inventory/route.ts가 품목·창고별로 내는 것과
// 같은 산식(IN 누적 − OUT 누적 금액)을 전체 합계 한 줄로 계산한다.
async function inventorySubsidiaryAmount() {
  const row = await db.prepare(`SELECT COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount ELSE -amount END), 0) AS stock_amount
    FROM inventory_movements`).first<{ stock_amount: number }>().catch(() => ({ stock_amount: 0 }));
  return Number(row?.stock_amount ?? 0);
}

// 매입채무 보조부(미지급 매입 인보이스 총액) 잔액. purchasing/route.ts의 지급요청 흐름과 동일한
// 기준을 쓴다 — 취소되지 않았고, 지급원장(finance_payment_ledger)에 PAID로 확정된 지급이 아직
// 없는 인보이스만 미지급으로 본다.
async function payablesSubsidiaryAmount() {
  const row = await db.prepare(`SELECT COALESCE(SUM(invoice.total_amount), 0) AS outstanding
    FROM finance_purchase_invoices invoice
    LEFT JOIN finance_payment_ledger payment ON payment.request_id = invoice.payment_request_id AND payment.status = 'PAID'
    WHERE invoice.status <> 'CANCELLED' AND payment.id IS NULL`)
    .first<{ outstanding: number }>().catch(() => ({ outstanding: 0 }));
  return Number(row?.outstanding ?? 0);
}

async function computeCheck(checkType: TieOutCheckType, period: string, actorEmployeeId: string) {
  const asOf = asOfForPeriod(period);
  if (checkType === "RECEIVABLES") {
    const [subsidiaryAmount, gl] = await Promise.all([
      receivablesSubsidiaryAmount(), glAccountBalance(db, RECEIVABLES_GL_ACCOUNT_CODE, asOf),
    ]);
    return recordTieOutCheck(db, { checkType, period, asOf, glAccountCode: gl.accountCode,
      glAccountName: gl.accountName || "외상매출금", subsidiaryAmount, glAmount: gl.netDebit, actorEmployeeId });
  }
  if (checkType === "PAYABLES") {
    const [subsidiaryAmount, gl] = await Promise.all([
      payablesSubsidiaryAmount(), glAccountBalance(db, PAYABLES_GL_ACCOUNT_CODE, asOf),
    ]);
    // 부채계정은 대변이 정상잔액이므로 netDebit(차변-대변)의 부호를 뒤집어 대변 기준 잔액으로 맞춘다.
    return recordTieOutCheck(db, { checkType, period, asOf, glAccountCode: gl.accountCode,
      glAccountName: gl.accountName || "외상매입금", subsidiaryAmount, glAmount: -gl.netDebit, actorEmployeeId });
  }
  if (checkType === "INVENTORY") {
    const [subsidiaryAmount, gl] = await Promise.all([
      inventorySubsidiaryAmount(), glAccountBalance(db, INVENTORY_GL_ACCOUNT_CODE, asOf),
    ]);
    return recordTieOutCheck(db, { checkType, period, asOf, glAccountCode: gl.accountCode,
      glAccountName: gl.accountName || "상품", subsidiaryAmount, glAmount: gl.netDebit, actorEmployeeId });
  }
  if (checkType === "DEBT") {
    const [subsidiaryAmount, gl] = await Promise.all([
      debtSubsidiaryAmount(), glAccountBalance(db, DEBT_GL_ACCOUNT_CODE, asOf),
    ]);
    // 부채계정은 대변이 정상잔액이므로 netDebit 부호를 뒤집는다 — payablesSubsidiaryAmount와 동일.
    return recordTieOutCheck(db, { checkType, period, asOf, glAccountCode: gl.accountCode,
      glAccountName: gl.accountName || "장기차입금", subsidiaryAmount, glAmount: -gl.netDebit, actorEmployeeId });
  }
  if (checkType === "BANK") {
    const [subsidiaryAmount, gl, breakdown] = await Promise.all([
      bankSubsidiaryAmount(), glAccountBalance(db, BANK_GL_ACCOUNT_CODE, asOf), bankBreakdown(period),
    ]);
    return recordTieOutCheck(db, { checkType, period, asOf, glAccountCode: gl.accountCode,
      glAccountName: gl.accountName || "보통예금", subsidiaryAmount, glAmount: gl.netDebit, actorEmployeeId, breakdown });
  }
  return null;
}

export async function GET(request: Request) {
  const authorization = await authorizeErpRequest(db, "finance", "read");
  if (authorization.response) return authorization.response;
  await ensureFinanceTieOutSchema(db);
  const period = new URL(request.url).searchParams.get("period")?.trim() || currentPeriod;
  if (!validPeriod(period)) return Response.json({ error: "조회할 기간을 확인해 주세요." }, { status: 400 });
  const rows = await db.prepare("SELECT * FROM finance_tie_out_checks WHERE period = ? ORDER BY check_type")
    .bind(period).all<TieOutRow>();
  return Response.json({ period, currentPeriod, checks: rows.results });
}

export async function POST(request: Request) {
  await ensureFinanceTieOutSchema(db);
  const body = await request.json() as Record<string, unknown>;
  const action = String(body.action ?? "");
  const checkType = String(body.checkType ?? "") as TieOutCheckType;
  const period = String(body.period ?? "").trim();
  if (!["RECEIVABLES", "PAYABLES", "INVENTORY", "BANK", "DEBT"].includes(checkType) || !validPeriod(period)) {
    return Response.json({ error: "대사 유형과 기간을 확인해 주세요." }, { status: 400 });
  }
  if (action === "RECOMPUTE") {
    const authorization = await authorizeErpRequest(db, "finance", "write");
    if (authorization.response) return authorization.response;
    if (!["RECEIVABLES", "PAYABLES", "INVENTORY", "DEBT", "BANK"].includes(checkType)) return Response.json({ error: "아직 지원하지 않는 대사 유형입니다." }, { status: 400 });
    const before = await db.prepare("SELECT * FROM finance_tie_out_checks WHERE check_type = ? AND period = ?")
      .bind(checkType, period).first<TieOutRow>();
    const after = await computeCheck(checkType, period, authorization.principal.employeeId);
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "TIE_OUT_RECOMPUTED",
      entityType: "financeTieOutCheck", entityId: `${checkType}:${period}`, before, after });
    return Response.json({ check: after });
  }
  if (action === "REVIEW") {
    const authorization = await authorizeErpRequest(db, "finance", "approve");
    if (authorization.response) return authorization.response;
    const reason = String(body.reason ?? "");
    const note = String(body.note ?? "").trim();
    if (!["STRUCTURAL", "UNCONFIRMED"].includes(reason) || note.length < 5) {
      return Response.json({ error: "차이 사유(구조적/미확인)와 5자 이상의 설명을 입력해 주세요." }, { status: 400 });
    }
    const before = await db.prepare("SELECT * FROM finance_tie_out_checks WHERE check_type = ? AND period = ?")
      .bind(checkType, period).first<TieOutRow>();
    if (!before) return Response.json({ error: "먼저 대사를 계산해 주세요." }, { status: 409 });
    if (before.difference_amount === 0) return Response.json({ error: "차이가 없는 대사는 검토 사유가 필요하지 않습니다." }, { status: 409 });
    const changed = await reviewTieOutCheck(db, checkType, period, reason as "STRUCTURAL" | "UNCONFIRMED",
      note, authorization.principal.employeeId);
    if (!changed) return Response.json({ error: "대사 결과가 바뀌었습니다. 새로고침 후 다시 시도해 주세요." }, { status: 409 });
    const after = await db.prepare("SELECT * FROM finance_tie_out_checks WHERE check_type = ? AND period = ?")
      .bind(checkType, period).first<TieOutRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "TIE_OUT_REVIEWED",
      entityType: "financeTieOutCheck", entityId: `${checkType}:${period}`, before, after: { ...after, note } });
    return Response.json({ check: after });
  }
  return Response.json({ error: "지원하지 않는 작업입니다." }, { status: 400 });
}
