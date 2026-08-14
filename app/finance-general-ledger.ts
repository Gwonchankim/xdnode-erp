export type UnifiedLedgerRow = {
  id: string; sourceType: "CONTROLLED_POSTING" | "PAYMENT_JOURNAL"; sourceId: string;
  voucherDate: string; voucherNumber: string; lineNumber: number; accountId: string; accountCode: string;
  accountName: string; partnerName: string; departmentName: string; description: string;
  debitAmount: number; creditAmount: number; postedAt: number | null;
};

export type LedgerAccountSummary = {
  key: string; accountId: string; accountCode: string; accountName: string;
  openingDebit: number; openingCredit: number; periodDebit: number; periodCredit: number;
  endingDebit: number; endingCredit: number; lineCount: number;
};

export const generalLedgerAccountKey = (code: string, name: string) => code.trim() || `NAME:${name.trim()}`;

export function buildLedgerAccountSummaries(
  openingRows: ReadonlyArray<{ code: string; name: string; endingDebit: number; endingCredit: number }>,
  rows: UnifiedLedgerRow[],
  from: string,
) {
  const summaries = new Map<string, LedgerAccountSummary>();
  for (const item of openingRows) {
    const key = generalLedgerAccountKey(item.code, item.name);
    const current = summaries.get(key) ?? { key, accountId: "", accountCode: item.code, accountName: item.name,
      openingDebit: 0, openingCredit: 0, periodDebit: 0, periodCredit: 0, endingDebit: 0, endingCredit: 0, lineCount: 0 };
    current.openingDebit += item.endingDebit; current.openingCredit += item.endingCredit; summaries.set(key, current);
  }
  for (const row of rows) {
    const key = generalLedgerAccountKey(row.accountCode, row.accountName);
    const current = summaries.get(key) ?? { key, accountId: row.accountId, accountCode: row.accountCode,
      accountName: row.accountName, openingDebit: 0, openingCredit: 0, periodDebit: 0, periodCredit: 0,
      endingDebit: 0, endingCredit: 0, lineCount: 0 };
    if (!current.accountId && row.accountId) current.accountId = row.accountId;
    if (!current.accountCode && row.accountCode) current.accountCode = row.accountCode;
    current.accountName = row.accountName || current.accountName;
    if (row.voucherDate < from) { current.openingDebit += row.debitAmount; current.openingCredit += row.creditAmount; }
    else { current.periodDebit += row.debitAmount; current.periodCredit += row.creditAmount; current.lineCount += 1; }
    summaries.set(key, current);
  }
  for (const summary of summaries.values()) {
    const opening = summary.openingDebit - summary.openingCredit;
    summary.openingDebit = Math.max(opening, 0); summary.openingCredit = Math.max(-opening, 0);
    const ending = opening + summary.periodDebit - summary.periodCredit;
    summary.endingDebit = Math.max(ending, 0); summary.endingCredit = Math.max(-ending, 0);
  }
  return [...summaries.values()].sort((a, b) => a.accountCode.localeCompare(b.accountCode, "ko") || a.accountName.localeCompare(b.accountName, "ko"));
}
