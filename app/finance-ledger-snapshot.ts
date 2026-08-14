import { financeHistoricalData } from "./finance-historical-data";
import { buildLedgerAccountSummaries, buildOperationalFinancialStatements, type UnifiedLedgerRow } from "./finance-general-ledger";
import { approvedOpeningRows, ensureFinanceOpeningBalanceSchema, openingAccountCategory } from "./finance-opening-balance";
import { ensureFinancePostingSchema } from "./finance-posting";

async function sha256(value: unknown) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(bytes)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

async function postedLedgerRows(db: D1Database, asOf: string) {
  const [controlled, payments] = await Promise.all([
    db.prepare(`SELECT line.id,batch.id source_id,voucher.voucher_date,voucher.voucher_number,line.line_number,
      line.account_id,line.account_code,line.account_name,line.partner_name,line.department_name,line.description,
      line.debit_amount,line.credit_amount,batch.posted_at FROM finance_posting_lines line
      JOIN finance_posting_vouchers voucher ON voucher.id=line.voucher_id AND voucher.status='POSTED'
      JOIN finance_posting_batches batch ON batch.id=voucher.batch_id AND batch.status='POSTED'
      WHERE voucher.voucher_date BETWEEN '2026-01-01' AND ?
      ORDER BY voucher.voucher_date,voucher.voucher_number,line.line_number`).bind(asOf).all<Record<string, unknown>>(),
    db.prepare(`SELECT id,payment_request_id,voucher_date,description,debit_account_code,debit_account_name,
      credit_account_code,credit_account_name,amount,posted_at FROM finance_journal_entries
      WHERE status='POSTED' AND voucher_date BETWEEN '2026-01-01' AND ? ORDER BY voucher_date,id`)
      .bind(asOf).all<Record<string, unknown>>().catch(() => ({ results: [] })),
  ]);
  const rows: UnifiedLedgerRow[] = controlled.results.map((row) => ({
    id: String(row.id), sourceType: "CONTROLLED_POSTING", sourceId: String(row.source_id),
    voucherDate: String(row.voucher_date), voucherNumber: String(row.voucher_number), lineNumber: Number(row.line_number),
    accountId: String(row.account_id), accountCode: String(row.account_code), accountName: String(row.account_name),
    partnerName: String(row.partner_name ?? ""), departmentName: String(row.department_name ?? ""),
    description: String(row.description ?? ""), debitAmount: Number(row.debit_amount), creditAmount: Number(row.credit_amount),
    postedAt: row.posted_at == null ? null : Number(row.posted_at),
  }));
  for (const row of payments.results) {
    const common = { sourceType: "PAYMENT_JOURNAL" as const, sourceId: String(row.payment_request_id),
      voucherDate: String(row.voucher_date), voucherNumber: `PAY-${String(row.id).slice(0, 8).toUpperCase()}`,
      accountId: "", partnerName: "", departmentName: "", description: String(row.description ?? ""),
      postedAt: row.posted_at == null ? null : Number(row.posted_at) };
    rows.push({ ...common, id: `${row.id}:D`, lineNumber: 1, accountCode: String(row.debit_account_code ?? ""),
      accountName: String(row.debit_account_name), debitAmount: Number(row.amount), creditAmount: 0 });
    rows.push({ ...common, id: `${row.id}:C`, lineNumber: 2, accountCode: String(row.credit_account_code ?? ""),
      accountName: String(row.credit_account_name), debitAmount: 0, creditAmount: Number(row.amount) });
  }
  return rows;
}

export async function buildFinanceLedgerSnapshot(db: D1Database, asOf: string) {
  await ensureFinancePostingSchema(db); await ensureFinanceOpeningBalanceSchema(db);
  const opening = await approvedOpeningRows(db); const rows = await postedLedgerRows(db, asOf);
  const openingSource = opening?.rows ?? financeHistoricalData.trialBalance2025;
  const summaries = buildLedgerAccountSummaries(openingSource, rows, "2026-01-01");
  const masterAccounts = await db.prepare("SELECT code,category FROM finance_master_accounts WHERE status='ACTIVE'")
    .all<{ code: string; category: string }>().catch(() => ({ results: [] }));
  const masterCategories = new Map(masterAccounts.results.map((row) => [row.code, row.category]));
  const openingCategories = new Map(opening?.rows.map((row) => [row.code, row.category]) ?? []);
  const categories: Record<string, string> = {};
  for (const item of summaries) categories[item.key] = masterCategories.get(item.accountCode)
    ?? openingCategories.get(item.accountCode) ?? openingAccountCategory(item.accountCode, item.accountName);
  const statements = buildOperationalFinancialStatements(summaries, categories, Boolean(opening));
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
