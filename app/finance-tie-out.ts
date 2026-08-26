// 보조부 ↔ 총계정원장 잔액 대사 (재무회계 개편 계획 2단계 — docs/finance-remediation-plan.md).
// XD NODE는 검증 레이어이므로, 이 모듈은 분개를 만들지 않는다. 보조부가 계산한 잔액과 이카운트
// import 원장의 계정 잔액을 나란히 기록하고 차이를 드러낼 뿐이다. 차이가 있으면 "구조적"(예: 원천
// 자체가 시차를 두고 반영되는 경우처럼 설명 가능하고 재발이 예상되는 차이)과 "미확인"으로 나눠
// 사람이 사유를 남기게 하며, 미확인 차이만 월마감을 차단한다.

export type TieOutCheckType = "RECEIVABLES" | "PAYABLES" | "INVENTORY" | "BANK" | "DEBT";
export type TieOutDifferenceReason = "" | "STRUCTURAL" | "UNCONFIRMED";

export async function ensureFinanceTieOutSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_tie_out_checks (
      id TEXT PRIMARY KEY NOT NULL, check_type TEXT NOT NULL, period TEXT NOT NULL, as_of TEXT NOT NULL,
      gl_account_code TEXT NOT NULL DEFAULT '', gl_account_name TEXT NOT NULL DEFAULT '',
      subsidiary_amount INTEGER NOT NULL DEFAULT 0, gl_amount INTEGER NOT NULL DEFAULT 0,
      difference_amount INTEGER NOT NULL DEFAULT 0, difference_reason TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '', reviewed_by TEXT NOT NULL DEFAULT '', reviewed_at INTEGER,
      created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_tie_out_type_period ON finance_tie_out_checks(check_type, period)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_tie_out_reason ON finance_tie_out_checks(difference_reason, difference_amount)"),
  ]);
}

export type TieOutRow = {
  id: string; check_type: string; period: string; as_of: string; gl_account_code: string; gl_account_name: string;
  subsidiary_amount: number; gl_amount: number; difference_amount: number; difference_reason: string; note: string;
  reviewed_by: string; reviewed_at: number | null; created_by: string; created_at: number; updated_at: number;
};

// 재계산 결과를 기록한다. 차이 금액이 이전과 동일하면 사람이 이미 남긴 사유·검토 기록은 그대로 두고
// (같은 원인이 계속되는 구조적 차이일 수 있으므로), 차이 금액이 달라졌으면 예전 설명이 지금도
// 맞는지 알 수 없으므로 검토 기록을 지워 재검토를 요구한다.
export async function recordTieOutCheck(db: D1Database, input: {
  checkType: TieOutCheckType; period: string; asOf: string; glAccountCode: string; glAccountName: string;
  subsidiaryAmount: number; glAmount: number; actorEmployeeId: string;
}) {
  await ensureFinanceTieOutSchema(db);
  const differenceAmount = input.subsidiaryAmount - input.glAmount;
  const existing = await db.prepare("SELECT * FROM finance_tie_out_checks WHERE check_type = ? AND period = ?")
    .bind(input.checkType, input.period).first<TieOutRow>();
  const now = Date.now();
  const keepReview = Boolean(existing) && existing?.difference_amount === differenceAmount;
  const id = existing?.id ?? crypto.randomUUID();
  await db.prepare(`INSERT INTO finance_tie_out_checks
      (id, check_type, period, as_of, gl_account_code, gl_account_name, subsidiary_amount, gl_amount,
        difference_amount, difference_reason, note, reviewed_by, reviewed_at, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(check_type, period) DO UPDATE SET as_of = excluded.as_of,
      gl_account_code = excluded.gl_account_code, gl_account_name = excluded.gl_account_name,
      subsidiary_amount = excluded.subsidiary_amount, gl_amount = excluded.gl_amount,
      difference_amount = excluded.difference_amount,
      difference_reason = CASE WHEN ? THEN difference_reason ELSE '' END,
      note = CASE WHEN ? THEN note ELSE '' END,
      reviewed_by = CASE WHEN ? THEN reviewed_by ELSE '' END,
      reviewed_at = CASE WHEN ? THEN reviewed_at ELSE NULL END,
      updated_at = excluded.updated_at`)
    .bind(id, input.checkType, input.period, input.asOf, input.glAccountCode, input.glAccountName,
      input.subsidiaryAmount, input.glAmount, differenceAmount, "", "", "", null,
      input.actorEmployeeId, now, now,
      keepReview, keepReview, keepReview, keepReview).run();
  return db.prepare("SELECT * FROM finance_tie_out_checks WHERE check_type = ? AND period = ?")
    .bind(input.checkType, input.period).first<TieOutRow>();
}

export async function reviewTieOutCheck(db: D1Database, checkType: TieOutCheckType, period: string,
  reason: Exclude<TieOutDifferenceReason, "">, note: string, actorEmployeeId: string) {
  const now = Date.now();
  const result = await db.prepare(`UPDATE finance_tie_out_checks SET difference_reason = ?, note = ?,
      reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE check_type = ? AND period = ? AND difference_amount <> 0`)
    .bind(reason, note, actorEmployeeId, now, now, checkType, period).run();
  return result.meta.changes ?? 0;
}

// 월마감 통제가 참조하는 판정: 차이가 없거나, 있어도 "구조적"으로 확인된 경우만 통과.
// 미확인 차이(사유 미기재 또는 UNCONFIRMED)는 금액과 무관하게 마감을 막는다.
export function tieOutPasses(row: TieOutRow | null | undefined) {
  if (!row) return false;
  return row.difference_amount === 0 || row.difference_reason === "STRUCTURAL";
}
