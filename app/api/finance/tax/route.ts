import { env } from "cloudflare:workers";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";
import { financeCurrentData } from "../../../finance-current-data";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;
type TaxPeriodRow = {
  period: string; source_as_of: string; source_sales_supply: number; source_purchase_supply: number;
  source_sales_documents: number; source_purchase_documents: number; declared_sales_supply: number;
  declared_purchase_supply: number; output_tax: number; deductible_input_tax: number;
  nondeductible_input_tax: number; adjustment_tax: number; payable_tax: number; figures_confirmed: number;
  note: string; status: string; prepared_by: string; reviewed_by: string; reviewed_at: number | null;
  created_at: number; updated_at: number;
};

const currentPeriod = financeCurrentData.asOf.slice(0, 7);
const validPeriod = (period: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(period) && period <= currentPeriod;
const sourceFor = (period: string) => {
  const sales = financeCurrentData.salesDaily2026.filter((row) => row.date.startsWith(period));
  const purchases = financeCurrentData.purchaseDaily2026.filter((row) => row.date.startsWith(period));
  return {
    salesSupply: sales.reduce((sum, row) => sum + row.amount, 0),
    purchaseSupply: purchases.reduce((sum, row) => sum + row.amount, 0),
    salesDocuments: sales.reduce((sum, row) => sum + row.count, 0),
    purchaseDocuments: purchases.reduce((sum, row) => sum + row.count, 0),
  };
};
const amount = (value: unknown, label: string, allowNegative = false) => {
  const parsed = Math.round(Number(value));
  if (!Number.isSafeInteger(parsed) || (!allowNegative && parsed < 0)) throw new Error(`${label} 금액을 확인해 주세요.`);
  return parsed;
};

async function ensureSchema() {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_tax_periods (
      period TEXT PRIMARY KEY NOT NULL, source_as_of TEXT NOT NULL, source_sales_supply INTEGER NOT NULL DEFAULT 0,
      source_purchase_supply INTEGER NOT NULL DEFAULT 0, source_sales_documents INTEGER NOT NULL DEFAULT 0,
      source_purchase_documents INTEGER NOT NULL DEFAULT 0, declared_sales_supply INTEGER NOT NULL DEFAULT 0,
      declared_purchase_supply INTEGER NOT NULL DEFAULT 0, output_tax INTEGER NOT NULL DEFAULT 0,
      deductible_input_tax INTEGER NOT NULL DEFAULT 0, nondeductible_input_tax INTEGER NOT NULL DEFAULT 0,
      adjustment_tax INTEGER NOT NULL DEFAULT 0, payable_tax INTEGER NOT NULL DEFAULT 0,
      figures_confirmed INTEGER NOT NULL DEFAULT 0, note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'DRAFT',
      prepared_by TEXT NOT NULL, reviewed_by TEXT NOT NULL DEFAULT '', reviewed_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_tax_status_period ON finance_tax_periods(status, period)"),
  ]);
}

async function locked(period: string) {
  const row = await db.prepare("SELECT status FROM finance_close_runs WHERE period = ?").bind(period).first<{ status: string }>();
  return row?.status === "CLOSED";
}

async function state(period: string) {
  const source = sourceFor(period);
  const [record, taxCodes, documents] = await Promise.all([
    db.prepare("SELECT * FROM finance_tax_periods WHERE period = ?").bind(period).first<TaxPeriodRow>(),
    db.prepare("SELECT COUNT(*) AS count FROM finance_master_tax_codes WHERE status = 'ACTIVE'").first<{ count: number }>(),
    db.prepare(`SELECT id, version, file_name, uploaded_by, created_at FROM erp_documents
      WHERE module = 'finance' AND entity_type = 'financeTaxPeriod' AND entity_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC`).bind(period).all<{ id: string; version: number; file_name: string; uploaded_by: string; created_at: number }>(),
  ]);
  const salesVariance = record ? record.declared_sales_supply - source.salesSupply : 0;
  const purchaseVariance = record ? record.declared_purchase_supply - source.purchaseSupply : 0;
  const checks = [
    { key: "TAX_CODES", label: "세금코드", pass: Number(taxCodes?.count ?? 0) > 0, detail: `활성 코드 ${Number(taxCodes?.count ?? 0)}개` },
    { key: "FIGURES", label: "신고값 확인", pass: record?.figures_confirmed === 1, detail: record?.figures_confirmed ? "홈택스·이카운트 확인 완료" : "원천 확인 필요" },
    { key: "SUPPLY_RECONCILIATION", label: "공급가액 대사",
      pass: Boolean(record) && ((salesVariance === 0 && purchaseVariance === 0) || (record?.note.trim().length ?? 0) >= 10),
      detail: record ? `매출 차이 ${salesVariance.toLocaleString("ko-KR")}원 · 매입 차이 ${purchaseVariance.toLocaleString("ko-KR")}원${(salesVariance || purchaseVariance) && record.note.trim().length >= 10 ? " · 차이 사유 기록" : ""}` : "신고 공급가액 미입력" },
    { key: "EVIDENCE", label: "검토 증빙", pass: documents.results.length > 0, detail: `${documents.results.length}건 첨부` },
  ];
  return { source, record: record ?? null, salesVariance, purchaseVariance, taxCodeCount: Number(taxCodes?.count ?? 0),
    checks, evidenceCount: documents.results.length, documents: documents.results.map((row) => ({ id: row.id, version: row.version,
      fileName: row.file_name, uploadedBy: row.uploaded_by, createdAt: row.created_at,
      downloadUrl: `/api/documents?downloadId=${encodeURIComponent(row.id)}` })), locked: await locked(period) };
}

export async function GET(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "finance", "read");
  if (authorization.response) return authorization.response;
  const period = new URL(request.url).searchParams.get("period")?.trim() || currentPeriod;
  if (!validPeriod(period)) return Response.json({ error: "2026년 현재까지의 검토월을 선택해 주세요." }, { status: 400 });
  return Response.json({ asOf: financeCurrentData.asOf, currentPeriod, period, ...(await state(period)) });
}

export async function POST(request: Request) {
  await ensureSchema();
  const body = await request.json() as Record<string, unknown>;
  const action = String(body.action ?? "SAVE");
  const permission = action === "REVIEW" || action === "REOPEN" ? "approve" : "write";
  const authorization = await authorizeErpRequest(db, "finance", permission);
  if (authorization.response) return authorization.response;
  const period = String(body.period ?? "").trim();
  if (!validPeriod(period)) return Response.json({ error: "검토월을 확인해 주세요." }, { status: 400 });
  if (await locked(period)) return Response.json({ error: "잠긴 마감월은 부가세 검토값을 변경할 수 없습니다." }, { status: 409 });
  const before = await db.prepare("SELECT * FROM finance_tax_periods WHERE period = ?").bind(period).first<TaxPeriodRow>();
  const now = Date.now();
  if (action === "SAVE") {
    if (before?.status === "REVIEWED") return Response.json({ error: "검토 완료 원장은 재개방 후 수정해 주세요." }, { status: 409 });
    try {
      const source = sourceFor(period);
      const declaredSalesSupply = amount(body.declaredSalesSupply, "신고 매출 공급가액");
      const declaredPurchaseSupply = amount(body.declaredPurchaseSupply, "신고 매입 공급가액");
      const outputTax = amount(body.outputTax, "매출세액");
      const deductibleInputTax = amount(body.deductibleInputTax, "공제 매입세액");
      const nondeductibleInputTax = amount(body.nondeductibleInputTax, "불공제 매입세액");
      const adjustmentTax = amount(body.adjustmentTax, "조정세액", true);
      const payableTax = outputTax - deductibleInputTax + adjustmentTax;
      const note = String(body.note ?? "").trim().slice(0, 2000);
      const figuresConfirmed = body.figuresConfirmed === true ? 1 : 0;
      await db.prepare(`INSERT INTO finance_tax_periods
        (period, source_as_of, source_sales_supply, source_purchase_supply, source_sales_documents,
          source_purchase_documents, declared_sales_supply, declared_purchase_supply, output_tax,
          deductible_input_tax, nondeductible_input_tax, adjustment_tax, payable_tax, figures_confirmed,
          note, status, prepared_by, reviewed_by, reviewed_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, '', NULL, ?, ?)
        ON CONFLICT(period) DO UPDATE SET source_as_of = excluded.source_as_of,
          source_sales_supply = excluded.source_sales_supply, source_purchase_supply = excluded.source_purchase_supply,
          source_sales_documents = excluded.source_sales_documents, source_purchase_documents = excluded.source_purchase_documents,
          declared_sales_supply = excluded.declared_sales_supply, declared_purchase_supply = excluded.declared_purchase_supply,
          output_tax = excluded.output_tax, deductible_input_tax = excluded.deductible_input_tax,
          nondeductible_input_tax = excluded.nondeductible_input_tax, adjustment_tax = excluded.adjustment_tax,
          payable_tax = excluded.payable_tax, figures_confirmed = excluded.figures_confirmed, note = excluded.note,
          status = 'DRAFT', prepared_by = excluded.prepared_by, reviewed_by = '', reviewed_at = NULL, updated_at = excluded.updated_at`)
        .bind(period, financeCurrentData.asOf, source.salesSupply, source.purchaseSupply, source.salesDocuments,
          source.purchaseDocuments, declaredSalesSupply, declaredPurchaseSupply, outputTax, deductibleInputTax,
          nondeductibleInputTax, adjustmentTax, payableTax, figuresConfirmed, note,
          authorization.principal.employeeId, now, now).run();
      const after = await db.prepare("SELECT * FROM finance_tax_periods WHERE period = ?").bind(period).first<TaxPeriodRow>();
      await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "TAX_RECONCILIATION_SAVED",
        entityType: "financeTaxPeriod", entityId: period, before, after });
      return Response.json({ period, status: "DRAFT", payableTax });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "부가세 검토값을 저장하지 못했습니다." }, { status: 400 });
    }
  }
  if (action === "REVIEW") {
    if (!before) return Response.json({ error: "먼저 신고 확인값을 저장해 주세요." }, { status: 409 });
    const current = await state(period);
    const blockers = current.checks.filter((check) => !check.pass).map((check) => `${check.label}: ${check.detail}`);
    if (blockers.length) return Response.json({ error: "검토 완료 조건을 충족하지 못했습니다.", reasons: blockers }, { status: 409 });
    await db.prepare("UPDATE finance_tax_periods SET status = 'REVIEWED', reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE period = ?")
      .bind(authorization.principal.employeeId, now, now, period).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "TAX_RECONCILIATION_REVIEWED",
      entityType: "financeTaxPeriod", entityId: period, before, after: { ...before, status: "REVIEWED", reviewed_by: authorization.principal.employeeId, reviewed_at: now } });
    return Response.json({ period, status: "REVIEWED" });
  }
  if (action === "REOPEN") {
    if (!before || before.status !== "REVIEWED") return Response.json({ error: "검토 완료 원장만 재개방할 수 있습니다." }, { status: 409 });
    const reason = String(body.reason ?? "").trim();
    if (reason.length < 5) return Response.json({ error: "재개방 사유를 5자 이상 입력해 주세요." }, { status: 400 });
    await db.prepare("UPDATE finance_tax_periods SET status = 'DRAFT', reviewed_by = '', reviewed_at = NULL, note = ?, updated_at = ? WHERE period = ?")
      .bind(`${before.note}\n[재개방] ${reason}`.trim(), now, period).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "TAX_RECONCILIATION_REOPENED",
      entityType: "financeTaxPeriod", entityId: period, before, after: { ...before, status: "DRAFT", reopenReason: reason }, reason });
    return Response.json({ period, status: "DRAFT" });
  }
  return Response.json({ error: "지원하지 않는 작업입니다." }, { status: 400 });
}
