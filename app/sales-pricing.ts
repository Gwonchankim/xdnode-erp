export type PricingReviewRow = {
  document_id: string; document_type: string; price_list_id: string; policy_id: string;
  price_list_version: number; policy_version: number; list_amount: number; quoted_amount: number;
  standard_cost_amount: number; minimum_amount: number; discount_bps: number; gross_margin_bps: number;
  outcome: string; reasons_json: string; evaluated_by: string; approval_request_id: string;
  reviewed_by: string; reviewed_at: number | null; snapshot_json: string; created_at: number; updated_at: number;
};

type DocumentRow = { id: string; document_type: string; amount: number; status: string; issued_date: string; created_at: number };
type PriceListRow = { id: string; name: string; version: number; currency: string; effective_from: string; effective_to: string };
type PolicyRow = { id: string; name: string; version: number; max_discount_bps: number; min_gross_margin_bps: number };
type EvaluationLine = {
  id: string; catalog_item_id: string; description: string; quantity: number; unit_price: number; amount: number;
  catalog_code: string | null; list_unit_price: number | null; standard_unit_cost: number | null; min_unit_price: number | null;
};

export async function ensureSalesPricingSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_price_lists (
      id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, version INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'KRW',
      effective_from TEXT NOT NULL, effective_to TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'DRAFT',
      created_by TEXT NOT NULL, approved_by TEXT NOT NULL DEFAULT '', approved_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_price_list_items (
      id TEXT PRIMARY KEY NOT NULL, price_list_id TEXT NOT NULL, catalog_item_id TEXT NOT NULL,
      list_unit_price INTEGER NOT NULL, standard_unit_cost INTEGER NOT NULL, min_unit_price INTEGER NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_pricing_policies (
      id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, version INTEGER NOT NULL,
      max_discount_bps INTEGER NOT NULL, min_gross_margin_bps INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'DRAFT', created_by TEXT NOT NULL, approved_by TEXT NOT NULL DEFAULT '',
      approved_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_document_pricing_reviews (
      document_id TEXT PRIMARY KEY NOT NULL, document_type TEXT NOT NULL, price_list_id TEXT NOT NULL DEFAULT '',
      policy_id TEXT NOT NULL DEFAULT '', price_list_version INTEGER NOT NULL DEFAULT 0, policy_version INTEGER NOT NULL DEFAULT 0,
      list_amount INTEGER NOT NULL DEFAULT 0, quoted_amount INTEGER NOT NULL DEFAULT 0,
      standard_cost_amount INTEGER NOT NULL DEFAULT 0, minimum_amount INTEGER NOT NULL DEFAULT 0,
      discount_bps INTEGER NOT NULL DEFAULT 0, gross_margin_bps INTEGER NOT NULL DEFAULT 0,
      outcome TEXT NOT NULL, reasons_json TEXT NOT NULL DEFAULT '[]', evaluated_by TEXT NOT NULL,
      approval_request_id TEXT NOT NULL DEFAULT '', reviewed_by TEXT NOT NULL DEFAULT '', reviewed_at INTEGER,
      snapshot_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_price_list_name_version ON sales_price_lists(name, version)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_price_list_single_active ON sales_price_lists(status) WHERE status = 'ACTIVE'"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_price_item_list_catalog ON sales_price_list_items(price_list_id, catalog_item_id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_pricing_policy_name_version ON sales_pricing_policies(name, version)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_pricing_policy_single_active ON sales_pricing_policies(status) WHERE status = 'ACTIVE'"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_pricing_review_outcome ON sales_document_pricing_reviews(outcome, updated_at)"),
  ]);
}

export function toPricingReview(row: PricingReviewRow) {
  let reasons: string[] = [];
  try { const parsed = JSON.parse(row.reasons_json); reasons = Array.isArray(parsed) ? parsed.map(String) : []; } catch { reasons = []; }
  return {
    documentId: row.document_id, documentType: row.document_type, priceListId: row.price_list_id, policyId: row.policy_id,
    priceListVersion: row.price_list_version, policyVersion: row.policy_version, listAmount: row.list_amount,
    quotedAmount: row.quoted_amount, standardCostAmount: row.standard_cost_amount, minimumAmount: row.minimum_amount,
    discountBps: row.discount_bps, grossMarginBps: row.gross_margin_bps, outcome: row.outcome, reasons,
    evaluatedBy: row.evaluated_by, approvalRequestId: row.approval_request_id, reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function getSalesPricingGate(db: D1Database, documentId: string) {
  await ensureSalesPricingSchema(db);
  const row = await db.prepare("SELECT * FROM sales_document_pricing_reviews WHERE document_id = ?")
    .bind(documentId).first<PricingReviewRow>();
  return { review: row ? toPricingReview(row) : null, canProceed: Boolean(row && ["PASS", "APPROVED"].includes(row.outcome)) };
}

export async function evaluateSalesDocumentPricing(db: D1Database, documentId: string, employeeId: string) {
  await ensureSalesPricingSchema(db);
  const existing = await db.prepare("SELECT * FROM sales_document_pricing_reviews WHERE document_id = ?")
    .bind(documentId).first<PricingReviewRow>();
  if (existing && ["PASS", "APPROVAL_PENDING", "APPROVED"].includes(existing.outcome)) return toPricingReview(existing);

  const document = await db.prepare("SELECT id, document_type, amount, status, issued_date, created_at FROM sales_documents WHERE id = ?")
    .bind(documentId).first<DocumentRow>();
  if (!document || !["QUOTE", "ORDER"].includes(document.document_type)) throw new Error("가격 검토 대상은 견적 또는 수주 문서입니다.");
  if (["COMPLETED", "CANCELLED"].includes(document.status)) throw new Error("완료·취소 문서는 가격을 다시 검토할 수 없습니다.");

  const asOf = document.issued_date || new Date(document.created_at).toISOString().slice(0, 10);
  const [priceList, policy] = await Promise.all([
    db.prepare(`SELECT id, name, version, currency, effective_from, effective_to FROM sales_price_lists
      WHERE status = 'ACTIVE' AND effective_from <= ? AND (effective_to = '' OR effective_to >= ?)
      ORDER BY version DESC LIMIT 1`).bind(asOf, asOf).first<PriceListRow>(),
    db.prepare("SELECT id, name, version, max_discount_bps, min_gross_margin_bps FROM sales_pricing_policies WHERE status = 'ACTIVE' ORDER BY version DESC LIMIT 1")
      .first<PolicyRow>(),
  ]);

  const lines = priceList ? await db.prepare(`SELECT line.id, line.catalog_item_id, line.description, line.quantity,
      line.unit_price, line.amount, catalog.code AS catalog_code, item.list_unit_price, item.standard_unit_cost, item.min_unit_price
      FROM sales_document_lines line LEFT JOIN sales_catalog_items catalog ON catalog.id = line.catalog_item_id
      LEFT JOIN sales_price_list_items item ON item.price_list_id = ? AND item.catalog_item_id = line.catalog_item_id
      WHERE line.document_id = ? ORDER BY line.line_number`).bind(priceList.id, documentId).all<EvaluationLine>()
    : await db.prepare(`SELECT line.id, line.catalog_item_id, line.description, line.quantity, line.unit_price, line.amount,
      catalog.code AS catalog_code, NULL AS list_unit_price, NULL AS standard_unit_cost, NULL AS min_unit_price
      FROM sales_document_lines line LEFT JOIN sales_catalog_items catalog ON catalog.id = line.catalog_item_id
      WHERE line.document_id = ? ORDER BY line.line_number`).bind(documentId).all<EvaluationLine>();

  const reasons: string[] = [];
  if (!priceList) reasons.push(`${asOf} 기준 활성 가격표가 없습니다.`);
  if (!policy) reasons.push("활성 가격·할인 정책이 없습니다.");
  if (!lines.results.length) reasons.push("검토할 품목 라인이 없습니다.");
  const missing = lines.results.filter((line) => line.list_unit_price === null || line.standard_unit_cost === null || line.min_unit_price === null);
  if (missing.length) reasons.push(`가격표 미등록 품목 ${missing.map((line) => line.catalog_code || line.description).join(", ")}`);

  const completeLines = lines.results.filter((line) => line.list_unit_price !== null && line.standard_unit_cost !== null && line.min_unit_price !== null);
  const listAmount = completeLines.reduce((sum, line) => sum + Math.round(line.quantity * Number(line.list_unit_price)), 0);
  const standardCostAmount = completeLines.reduce((sum, line) => sum + Math.round(line.quantity * Number(line.standard_unit_cost)), 0);
  const minimumAmount = completeLines.reduce((sum, line) => sum + Math.round(line.quantity * Number(line.min_unit_price)), 0);
  const discountBps = listAmount > 0 ? Math.max(0, Math.round((listAmount - document.amount) / listAmount * 10_000)) : 0;
  const grossMarginBps = document.amount > 0 ? Math.round((document.amount - standardCostAmount) / document.amount * 10_000) : -10_000;
  if (!missing.length && policy) {
    const floorBreaches = lines.results.filter((line) => line.min_unit_price !== null && line.unit_price < Number(line.min_unit_price));
    if (floorBreaches.length) reasons.push(`최저단가 미달 ${floorBreaches.map((line) => line.catalog_code || line.description).join(", ")}`);
    if (discountBps > policy.max_discount_bps) reasons.push(`할인율 ${(discountBps / 100).toFixed(2)}%가 한도 ${(policy.max_discount_bps / 100).toFixed(2)}%를 초과합니다.`);
    if (grossMarginBps < policy.min_gross_margin_bps) reasons.push(`매출총이익률 ${(grossMarginBps / 100).toFixed(2)}%가 최저 ${(policy.min_gross_margin_bps / 100).toFixed(2)}%보다 낮습니다.`);
  }
  const hasConfigurationGap = !priceList || !policy || !lines.results.length || missing.length > 0;
  const outcome = hasConfigurationGap ? "DATA_MISSING" : reasons.length ? "EXCEPTION_REQUIRED" : "PASS";
  const snapshot = {
    asOf, priceList: priceList ? { id: priceList.id, name: priceList.name, version: priceList.version, currency: priceList.currency } : null,
    policy: policy ? { id: policy.id, name: policy.name, version: policy.version, maxDiscountBps: policy.max_discount_bps, minGrossMarginBps: policy.min_gross_margin_bps } : null,
    lines: lines.results.map((line) => ({ id: line.id, catalogItemId: line.catalog_item_id, code: line.catalog_code || "", description: line.description,
      quantity: line.quantity, quotedUnitPrice: line.unit_price, amount: line.amount, listUnitPrice: line.list_unit_price,
      standardUnitCost: line.standard_unit_cost, minUnitPrice: line.min_unit_price })),
  };
  const now = Date.now();
  await db.prepare(`INSERT INTO sales_document_pricing_reviews
    (document_id, document_type, price_list_id, policy_id, price_list_version, policy_version, list_amount, quoted_amount,
      standard_cost_amount, minimum_amount, discount_bps, gross_margin_bps, outcome, reasons_json, evaluated_by,
      approval_request_id, reviewed_by, reviewed_at, snapshot_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', NULL, ?, ?, ?)
    ON CONFLICT(document_id) DO UPDATE SET document_type = excluded.document_type, price_list_id = excluded.price_list_id,
      policy_id = excluded.policy_id, price_list_version = excluded.price_list_version, policy_version = excluded.policy_version,
      list_amount = excluded.list_amount, quoted_amount = excluded.quoted_amount, standard_cost_amount = excluded.standard_cost_amount,
      minimum_amount = excluded.minimum_amount, discount_bps = excluded.discount_bps, gross_margin_bps = excluded.gross_margin_bps,
      outcome = excluded.outcome, reasons_json = excluded.reasons_json, evaluated_by = excluded.evaluated_by,
      approval_request_id = '', reviewed_by = '', reviewed_at = NULL, snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at`)
    .bind(document.id, document.document_type, priceList?.id ?? "", policy?.id ?? "", priceList?.version ?? 0, policy?.version ?? 0,
      listAmount, document.amount, standardCostAmount, minimumAmount, discountBps, grossMarginBps, outcome,
      JSON.stringify(reasons), employeeId, JSON.stringify(snapshot), now, now).run();
  const saved = await db.prepare("SELECT * FROM sales_document_pricing_reviews WHERE document_id = ?").bind(documentId).first<PricingReviewRow>();
  if (!saved) throw new Error("가격 검토 결과를 저장하지 못했습니다.");
  return toPricingReview(saved);
}
