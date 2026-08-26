import { env } from "cloudflare:workers";
import { authorizeErpRequest } from "../../../erp-platform";
import { financeCurrentData } from "../../../finance-current-data";
import { financeHistoricalData } from "../../../finance-historical-data";
import { ensureFinancePostingSchema } from "../../../finance-posting";
import { buildLedgerAccountSummaries, buildOperationalFinancialStatements, generalLedgerAccountKey,
  historicalCloseComparison, previousEqualLengthPeriod,
  type LedgerAccountSummary, type UnifiedLedgerRow } from "../../../finance-general-ledger";
import { approvedOpeningRows, ensureFinanceOpeningBalanceSchema, liquidityFor, openingAccountCategory, statementLineFor } from "../../../finance-opening-balance";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;
const currentAsOf = financeCurrentData.asOf;
const validDate = (value: string) => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)
  && !Number.isNaN(new Date(`${value}T00:00:00Z`).valueOf())
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

async function ensureSchemas() {
  await ensureFinancePostingSchema(db);
  await ensureFinanceOpeningBalanceSchema(db);
}

// Import-only: this is the verification layer over the authoritative 이카운트 ledger, so
// `finance_posting_lines` (posted from imported journal files) is the sole source. ERP-generated
// payment vouchers and depreciation postings (`finance_journal_entries`) are execution records the
// app produced itself, not transcriptions of the real ledger, and belong in Stage 2's
// reconciliation layer instead. See docs/finance-remediation-plan.md Stage 1.
async function ledgerRows(from: string, to: string) {
  const controlled = await db.prepare(`SELECT line.id, batch.id AS source_id, voucher.voucher_date, voucher.voucher_number,
      line.line_number, line.account_id, line.account_code, line.account_name, line.partner_name,
      line.department_name, line.description, line.debit_amount, line.credit_amount, batch.posted_at
      FROM finance_posting_lines line
      JOIN finance_posting_vouchers voucher ON voucher.id=line.voucher_id AND voucher.status='POSTED'
      JOIN finance_posting_batches batch ON batch.id=voucher.batch_id AND batch.status='POSTED'
      WHERE voucher.voucher_date BETWEEN ? AND ?
      ORDER BY voucher.voucher_date DESC, voucher.voucher_number DESC, line.line_number`)
      .bind(from, to).all<Record<string, unknown>>();
  const rows: UnifiedLedgerRow[] = controlled.results.map((row) => ({
    id: String(row.id), sourceType: "CONTROLLED_POSTING", sourceId: String(row.source_id),
    voucherDate: String(row.voucher_date), voucherNumber: String(row.voucher_number), lineNumber: Number(row.line_number),
    accountId: String(row.account_id), accountCode: String(row.account_code), accountName: String(row.account_name),
    partnerName: String(row.partner_name ?? ""), departmentName: String(row.department_name ?? ""),
    description: String(row.description ?? ""), debitAmount: Number(row.debit_amount), creditAmount: Number(row.credit_amount),
    postedAt: row.posted_at == null ? null : Number(row.posted_at),
  }));
  return rows.sort((a, b) => b.voucherDate.localeCompare(a.voucherDate)
    || b.voucherNumber.localeCompare(a.voucherNumber) || a.lineNumber - b.lineNumber);
}

const sum = (rows: LedgerAccountSummary[], key: keyof LedgerAccountSummary) => rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
function csvCell(value: unknown) {
  let content = String(value ?? "");
  if (typeof value === "string" && /^[=+\-@]/.test(content)) content = `'${content}`;
  return `"${content.replaceAll('"', '""')}"`;
}

export async function GET(request: Request) {
  const authorization = await authorizeErpRequest(db, "finance", "read");
  if (authorization.response) return authorization.response;
  await ensureSchemas();
  const url = new URL(request.url); const from = url.searchParams.get("from")?.trim() || "2026-01-01";
  const to = url.searchParams.get("to")?.trim() || currentAsOf;
  if (!validDate(from) || !validDate(to) || from > to || to > currentAsOf) {
    return Response.json({ error: `2026-01-01부터 ${currentAsOf} 사이의 조회기간을 선택해 주세요.` }, { status: 400 });
  }
  const opening=await approvedOpeningRows(db);const openingSource=opening?.rows??financeHistoricalData.trialBalance2025;
  const ytdRows = await ledgerRows("2026-01-01", to); const periodRows = ytdRows.filter((row) => row.voucherDate >= from);
  const accounts = buildLedgerAccountSummaries(openingSource, ytdRows, from);
  const masterAccounts = await db.prepare("SELECT code,category,statement_line,liquidity FROM finance_master_accounts WHERE status='ACTIVE'")
    .all<{ code: string; category: string; statement_line: string; liquidity: string }>().catch(() => ({ results: [] }));
  const masterCategories = new Map(masterAccounts.results.map((row) => [row.code, row.category]));
  const openingCategories = new Map(opening?.rows.map((row) => [row.code, row.category]) ?? []);
  const masterStatementLines = new Map(masterAccounts.results.filter((row) => row.statement_line).map((row) => [row.code, row.statement_line]));
  const masterLiquidity = new Map(masterAccounts.results.filter((row) => row.liquidity).map((row) => [row.code, row.liquidity]));
  const categoryMap = (items: LedgerAccountSummary[]) => {
    const result: Record<string, string> = {};
    for (const item of items) result[item.key] = masterCategories.get(item.accountCode)
      ?? openingCategories.get(item.accountCode) ?? openingAccountCategory(item.accountCode, item.accountName);
    return result;
  };
  const statementLineMap = (items: LedgerAccountSummary[], categoriesByKey: Record<string, string>) => {
    const result: Record<string, string> = {};
    for (const item of items) result[item.key] = masterStatementLines.get(item.accountCode)
      ?? statementLineFor(categoriesByKey[item.key] ?? "", item.accountCode, item.accountName);
    return result;
  };
  const liquidityMap = (items: LedgerAccountSummary[], categoriesByKey: Record<string, string>) => {
    const result: Record<string, string> = {};
    for (const item of items) result[item.key] = masterLiquidity.get(item.accountCode)
      ?? liquidityFor(categoriesByKey[item.key] ?? "", item.accountName);
    return result;
  };
  const categories = categoryMap(accounts);
  const statements = buildOperationalFinancialStatements(accounts, categories, Boolean(opening),
    statementLineMap(accounts, categories), liquidityMap(accounts, categories));
  const previousRange = previousEqualLengthPeriod(from, to);
  const previousPeriod = previousRange ? (() => {
    const previousRows = ytdRows.filter((row) => row.voucherDate <= previousRange.to);
    const previousAccounts = buildLedgerAccountSummaries(openingSource, previousRows, previousRange.from);
    const previousCategories = categoryMap(previousAccounts);
    const previousStatements = buildOperationalFinancialStatements(previousAccounts, previousCategories, Boolean(opening),
      statementLineMap(previousAccounts, previousCategories), liquidityMap(previousAccounts, previousCategories));
    return { label: "직전 동일 일수", from: previousRange.from, to: previousRange.to, source: "ERP_POSTED" as const,
      revenue: previousStatements.incomeStatement.revenue, expenses: previousStatements.incomeStatement.expenses,
      netIncome: previousStatements.incomeStatement.netIncome };
  })() : null;
  const currentComparison = { label: "조회기간", from, to, source: "ERP_POSTED" as const,
    revenue: statements.incomeStatement.revenue, expenses: statements.incomeStatement.expenses,
    netIncome: statements.incomeStatement.netIncome };
  const priorYear = historicalCloseComparison(financeHistoricalData.monthly2025, from, to);
  const historical2025 = financeHistoricalData.years["2025"];
  const openingDebit = sum(accounts, "openingDebit"); const openingCredit = sum(accounts, "openingCredit");
  const periodDebit = sum(accounts, "periodDebit"); const periodCredit = sum(accounts, "periodCredit");
  const endingDebit = sum(accounts, "endingDebit"); const endingCredit = sum(accounts, "endingCredit");
  const account = url.searchParams.get("account")?.trim() || ""; const query = url.searchParams.get("q")?.trim().toLowerCase() || "";
  const filteredRows = periodRows.filter((row) => (!account || generalLedgerAccountKey(row.accountCode, row.accountName) === account)
    && (!query || `${row.voucherNumber} ${row.accountCode} ${row.accountName} ${row.partnerName} ${row.description}`.toLowerCase().includes(query)));
  if (url.searchParams.get("format") === "csv") {
    const header = ["전표일", "전표번호", "행", "계정코드", "계정명", "거래처", "부서", "적요", "차변", "대변", "원천"];
    const body = filteredRows.map((row) => [row.voucherDate, row.voucherNumber, row.lineNumber, row.accountCode,
      row.accountName, row.partnerName, row.departmentName, row.description, row.debitAmount, row.creditAmount,
      row.sourceType === "CONTROLLED_POSTING" ? "통제 분개" : "지급 전표"].map(csvCell).join(","));
    return new Response(`\uFEFF${[header.map(csvCell).join(","), ...body].join("\r\n")}`, { headers: {
      "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="xdnode-general-ledger-${from}-${to}.csv"`,
      "Cache-Control": "no-store",
    } });
  }
  const limit = Math.min(500, Math.max(50, Number(url.searchParams.get("limit") || 200)));
  return Response.json({ asOf: currentAsOf, from, to, accounts, statements,
    comparisons: { current: currentComparison, previousPeriod, priorYear,
      priorYearRule: "조회기간에 완전히 포함된 월만 2025년 동일 월 결산자료와 비교하며 부분월은 일할 계산하지 않습니다.",
      closingReference: { label: "2025 결산 기준", asOf: "2025-12-31", assets: historical2025.assets,
        cash: historical2025.cash, accountsReceivable: historical2025.ar, accountsPayable: historical2025.ap,
        debt: historical2025.debt, scopeNote: "총자산·현금·매출채권·매입채무·차입금의 결산 참고값이며 총부채·자본 비교가 아닙니다." } },
    rows: filteredRows.slice(0, limit),
    pagination: { returned: Math.min(filteredRows.length, limit), total: filteredRows.length, limit },
    totals: { openingDebit, openingCredit, openingDifference: openingDebit - openingCredit, periodDebit, periodCredit,
      periodDifference: periodDebit - periodCredit, endingDebit, endingCredit, endingDifference: endingDebit - endingCredit },
    sources: { opening: { label: from === "2026-01-01" ? (opening?"승인된 2026 개시잔액 기준선":"승인 전 2025 결산 참고값") : `${opening?"승인된 기준선":"승인 전 참고값"} + 시작일 전 전기 누적`,
      asOf: new Date(new Date(`${from}T00:00:00Z`).valueOf() - 86_400_000).toISOString().slice(0, 10), immutableReference: true,official:Boolean(opening),setId:String(opening?.set.id??"") },
      controlledPostingLines: periodRows.length,
      postedOnly: true, stagedOrClobeRowsIncluded: false, importOnly: true },
    controls: { balanced: openingDebit === openingCredit && periodDebit === periodCredit && endingDebit === endingCredit,
      openingApprovedReference: Boolean(opening), statementOfficial: statements.status === "OFFICIAL",
      sourceMutation: false, directClobePosting: false } });
}
