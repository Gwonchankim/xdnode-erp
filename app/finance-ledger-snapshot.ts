import { financeHistoricalData } from "./finance-historical-data";
import { buildLedgerAccountSummaries, buildOperationalFinancialStatements, type UnifiedLedgerRow } from "./finance-general-ledger";
import { approvedOpeningRows, ensureFinanceOpeningBalanceSchema, liquidityFor, openingAccountCategory, statementLineFor } from "./finance-opening-balance";
import { ensureFinancePostingSchema } from "./finance-posting";

async function sha256(value: unknown) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

// The official ledger is import-only: XD NODE is a verification layer over the authoritative
// 이카운트 ledger, so `finance_posting_lines` (posted from imported journal files) is the sole
// source here. `finance_journal_entries` (ERP-generated payment vouchers and fixed-asset
// depreciation postings) are execution records the app computed or executed itself, not
// transcriptions of the real ledger — they belong in Stage 2's reconciliation layer (comparing
// the computed/executed amount against what actually landed in the imported ledger), not in the
// statements this function feeds. See docs/finance-remediation-plan.md Stage 1.
async function postedLedgerRows(db: D1Database, asOf: string) {
  const controlled = await db.prepare(`SELECT line.id,batch.id source_id,voucher.voucher_date,voucher.voucher_number,line.line_number,
      line.account_id,line.account_code,line.account_name,line.partner_name,line.department_name,line.description,
      line.debit_amount,line.credit_amount,batch.posted_at FROM finance_posting_lines line
      JOIN finance_posting_vouchers voucher ON voucher.id=line.voucher_id AND voucher.status='POSTED'
      JOIN finance_posting_batches batch ON batch.id=voucher.batch_id AND batch.status='POSTED'
      WHERE voucher.voucher_date BETWEEN '2026-01-01' AND ?
      ORDER BY voucher.voucher_date,voucher.voucher_number,line.line_number`).bind(asOf).all<Record<string, unknown>>();
  const rows: UnifiedLedgerRow[] = controlled.results.map((row) => ({
    id: String(row.id), sourceType: "CONTROLLED_POSTING", sourceId: String(row.source_id),
    voucherDate: String(row.voucher_date), voucherNumber: String(row.voucher_number), lineNumber: Number(row.line_number),
    accountId: String(row.account_id), accountCode: String(row.account_code), accountName: String(row.account_name),
    partnerName: String(row.partner_name ?? ""), departmentName: String(row.department_name ?? ""),
    description: String(row.description ?? ""), debitAmount: Number(row.debit_amount), creditAmount: Number(row.credit_amount),
    postedAt: row.posted_at == null ? null : Number(row.posted_at),
  }));
  return rows;
}

async function categoryMap(db: D1Database, opening: Awaited<ReturnType<typeof approvedOpeningRows>>,
  summaries: ReturnType<typeof buildLedgerAccountSummaries>) {
  const masterAccounts = await db.prepare("SELECT code,category,statement_line,liquidity FROM finance_master_accounts WHERE status='ACTIVE'")
    .all<{ code: string; category: string; statement_line: string; liquidity: string }>().catch(() => ({ results: [] }));
  const masterCategories = new Map(masterAccounts.results.map((row) => [row.code, row.category]));
  const openingCategories = new Map(opening?.rows.map((row) => [row.code, row.category]) ?? []);
  const masterStatementLines = new Map(masterAccounts.results.filter((row) => row.statement_line).map((row) => [row.code, row.statement_line]));
  const masterLiquidity = new Map(masterAccounts.results.filter((row) => row.liquidity).map((row) => [row.code, row.liquidity]));
  const categories: Record<string, string> = {}; const statementLines: Record<string, string> = {}; const liquidity: Record<string, string> = {};
  for (const item of summaries) {
    const category = masterCategories.get(item.accountCode) ?? openingCategories.get(item.accountCode)
      ?? openingAccountCategory(item.accountCode, item.accountName);
    categories[item.key] = category;
    statementLines[item.key] = masterStatementLines.get(item.accountCode) ?? statementLineFor(category, item.accountCode, item.accountName);
    liquidity[item.key] = masterLiquidity.get(item.accountCode) ?? liquidityFor(category, item.accountName);
  }
  return { categories, statementLines, liquidity };
}

export async function buildFinanceLedgerSnapshot(db: D1Database, asOf: string) {
  await ensureFinancePostingSchema(db); await ensureFinanceOpeningBalanceSchema(db);
  const opening = await approvedOpeningRows(db); const rows = await postedLedgerRows(db, asOf);
  const openingSource = opening?.rows ?? financeHistoricalData.trialBalance2025;
  const summaries = buildLedgerAccountSummaries(openingSource, rows, "2026-01-01");
  const { categories, statementLines, liquidity } = await categoryMap(db, opening, summaries);
  const statements = buildOperationalFinancialStatements(summaries, categories, Boolean(opening), statementLines, liquidity);
  const totals = {
    openingDebit: summaries.reduce((total, row) => total + row.openingDebit, 0),
    openingCredit: summaries.reduce((total, row) => total + row.openingCredit, 0),
    periodDebit: summaries.reduce((total, row) => total + row.periodDebit, 0),
    periodCredit: summaries.reduce((total, row) => total + row.periodCredit, 0),
    endingDebit: summaries.reduce((total, row) => total + row.endingDebit, 0),
    endingCredit: summaries.reduce((total, row) => total + row.endingCredit, 0),
  };
  const difference = { opening: totals.openingDebit - totals.openingCredit,
    period: totals.periodDebit - totals.periodCredit, ending: totals.endingDebit - totals.endingCredit };
  const lineage = { asOf, openingSetId: String(opening?.set.id ?? ""),
    openingChecksum: String(opening?.set.source_checksum ?? ""),
    rows: rows.map((row) => [row.id, row.voucherDate, row.accountCode, row.debitAmount, row.creditAmount]) };
  const ledgerBalanced = difference.opening === 0 && difference.period === 0 && difference.ending === 0;
  return { asOf, official: Boolean(opening) && ledgerBalanced && statements.status === "OFFICIAL",
    openingSetId: lineage.openingSetId, openingChecksum: lineage.openingChecksum, lineCount: rows.length,
    totals, difference, statements, ledgerHash: await sha256(lineage) };
}

export async function buildFinancePeriodStatementSnapshot(db: D1Database, from: string, to: string) {
  await ensureFinancePostingSchema(db); await ensureFinanceOpeningBalanceSchema(db);
  const opening = await approvedOpeningRows(db); const rows = await postedLedgerRows(db, to);
  const openingSource = opening?.rows ?? financeHistoricalData.trialBalance2025;
  const summaries = buildLedgerAccountSummaries(openingSource, rows, from);
  const { categories, statementLines, liquidity } = await categoryMap(db, opening, summaries);
  const statements = buildOperationalFinancialStatements(summaries, categories, Boolean(opening), statementLines, liquidity);
  const periodRows = rows.filter((row) => row.voucherDate >= from);
  const periodDebit = periodRows.reduce((total, row) => total + row.debitAmount, 0);
  const periodCredit = periodRows.reduce((total, row) => total + row.creditAmount, 0);
  const periodUnclassified = summaries.filter((row) => !["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]
    .includes(String(categories[row.key] ?? "OTHER").toUpperCase()) && Boolean(row.periodDebit || row.periodCredit));
  const incomeOfficial = Boolean(opening) && periodDebit === periodCredit && periodUnclassified.length === 0;
  return { from, to, status: incomeOfficial ? "OFFICIAL" as const : "DRAFT" as const,
    lineCount: periodRows.length, periodDebit, periodCredit, difference: periodDebit - periodCredit,
    incomeStatement: { revenue: statements.incomeStatement.revenue, expenses: statements.incomeStatement.expenses,
      netIncome: statements.incomeStatement.netIncome },
    quality: { openingOfficial: Boolean(opening), periodBalanced: periodDebit === periodCredit,
      unclassifiedCount: periodUnclassified.length } };
}

// Reads a single GL account's ending balance as of `asOf`, on the same import-only basis as the
// rest of the ledger (approved opening + POSTED controlled postings). Used by the subsidiary-
// ledger tie-out checks (Stage 2 of docs/finance-remediation-plan.md) to compare what a subsidiary
// module computes against what the imported 이카운트 ledger actually shows for that account.
export async function glAccountBalance(db: D1Database, accountCode: string, asOf: string) {
  await ensureFinancePostingSchema(db); await ensureFinanceOpeningBalanceSchema(db);
  const opening = await approvedOpeningRows(db); const rows = await postedLedgerRows(db, asOf);
  const openingSource = opening?.rows ?? financeHistoricalData.trialBalance2025;
  const summaries = buildLedgerAccountSummaries(openingSource, rows, "2026-01-01");
  const match = summaries.find((row) => row.accountCode === accountCode);
  return { accountCode, accountName: match?.accountName ?? "", endingDebit: match?.endingDebit ?? 0,
    endingCredit: match?.endingCredit ?? 0, netDebit: (match?.endingDebit ?? 0) - (match?.endingCredit ?? 0),
    openingOfficial: Boolean(opening) };
}
