import { env } from "cloudflare:workers";
import { createApprovalRequest } from "../../../approval-engine";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";
import { ensureSalesPricingSchema, evaluateSalesDocumentPricing, toPricingReview, type PricingReviewRow } from "../../../sales-pricing";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;

type PriceListRow = { id: string; name: string; version: number; currency: string; effective_from: string; effective_to: string; status: string; created_by: string; approved_by: string; approved_at: number | null; created_at: number; updated_at: number };
type PriceItemRow = { id: string; price_list_id: string; catalog_item_id: string; list_unit_price: number; standard_unit_cost: number; min_unit_price: number; catalog_code: string | null; catalog_name: string | null };
type PolicyRow = { id: string; name: string; version: number; max_discount_bps: number; min_gross_margin_bps: number; status: string; created_by: string; approved_by: string; approved_at: number | null; created_at: number; updated_at: number };
type ReviewDisplayRow = PricingReviewRow & { document_number: string | null; document_status: string | null; account_name: string | null; opportunity_title: string | null };

const toPriceList = (row: PriceListRow, items: PriceItemRow[]) => ({
  id: row.id, name: row.name, version: row.version, currency: row.currency, effectiveFrom: row.effective_from,
  effectiveTo: row.effective_to, status: row.status, createdBy: row.created_by, approvedBy: row.approved_by,
  approvedAt: row.approved_at, createdAt: row.created_at, updatedAt: row.updated_at,
  items: items.filter((item) => item.price_list_id === row.id).map((item) => ({ id: item.id, catalogItemId: item.catalog_item_id,
    catalogCode: item.catalog_code ?? "", catalogName: item.catalog_name ?? "", listUnitPrice: item.list_unit_price,
    standardUnitCost: item.standard_unit_cost, minUnitPrice: item.min_unit_price })),
});
const toPolicy = (row: PolicyRow) => ({ id: row.id, name: row.name, version: row.version,
  maxDiscountBps: row.max_discount_bps, minGrossMarginBps: row.min_gross_margin_bps, status: row.status,
  createdBy: row.created_by, approvedBy: row.approved_by, approvedAt: row.approved_at, createdAt: row.created_at, updatedAt: row.updated_at });

export async function GET() {
  await ensureSalesPricingSchema(db);
  const authorization = await authorizeErpRequest(db, "sales", "read");
  if (authorization.response) return authorization.response;
  const [lists, items, policies, reviews, catalog, documents] = await Promise.all([
    db.prepare("SELECT * FROM sales_price_lists ORDER BY created_at DESC").all<PriceListRow>(),
    db.prepare(`SELECT item.*, catalog.code AS catalog_code, catalog.name AS catalog_name FROM sales_price_list_items item
      LEFT JOIN sales_catalog_items catalog ON catalog.id = item.catalog_item_id ORDER BY catalog.name`).all<PriceItemRow>(),
    db.prepare("SELECT * FROM sales_pricing_policies ORDER BY created_at DESC").all<PolicyRow>(),
    db.prepare(`SELECT review.*, document.document_number, document.status AS document_status,
      account.name AS account_name, opportunity.title AS opportunity_title
      FROM sales_document_pricing_reviews review JOIN sales_documents document ON document.id = review.document_id
      LEFT JOIN sales_opportunities opportunity ON opportunity.id = document.opportunity_id
      LEFT JOIN sales_accounts account ON account.id = opportunity.account_id ORDER BY review.updated_at DESC`).all<ReviewDisplayRow>(),
    db.prepare("SELECT id, code, name, unit, status FROM sales_catalog_items ORDER BY name").all<{ id: string; code: string; name: string; unit: string; status: string }>(),
    db.prepare(`SELECT document.id, document.document_type, document.document_number, document.status, document.amount,
      account.name AS account_name FROM sales_documents document
      LEFT JOIN sales_opportunities opportunity ON opportunity.id = document.opportunity_id
      LEFT JOIN sales_accounts account ON account.id = opportunity.account_id
      WHERE document.document_type IN ('QUOTE','ORDER') AND document.status NOT IN ('COMPLETED','CANCELLED') ORDER BY document.created_at DESC`)
      .all<{ id: string; document_type: string; document_number: string; status: string; amount: number; account_name: string | null }>(),
  ]);
  const currentDate = new Date().toISOString().slice(0, 10);
  const activePriceList = lists.results.find((row) => row.status === "ACTIVE" && row.effective_from <= currentDate && (!row.effective_to || row.effective_to >= currentDate));
  const activePolicy = policies.results.find((row) => row.status === "ACTIVE");
  return Response.json({
    configurationReady: Boolean(activePriceList && activePolicy),
    activePriceListId: activePriceList?.id ?? "", activePolicyId: activePolicy?.id ?? "",
    priceLists: lists.results.map((row) => toPriceList(row, items.results)), policies: policies.results.map(toPolicy),
    reviews: reviews.results.map((row) => ({ ...toPricingReview(row), documentNumber: row.document_number ?? "",
      documentStatus: row.document_status ?? "", accountName: row.account_name ?? "", opportunityTitle: row.opportunity_title ?? "" })),
    catalog: catalog.results.map((row) => ({ id: row.id, code: row.code, name: row.name, unit: row.unit, status: row.status })),
    documents: documents.results.map((row) => ({ id: row.id, documentType: row.document_type, documentNumber: row.document_number,
      status: row.status, amount: row.amount, accountName: row.account_name ?? "" })),
  });
}

export async function POST(request: Request) {
  await ensureSalesPricingSchema(db);
  const authorization = await authorizeErpRequest(db, "sales", "write");
  if (authorization.response) return authorization.response;
  const body = await request.json() as Record<string, unknown>;
  const action = String(body.action ?? "");
  const now = Date.now();

  if (action === "CREATE_PRICE_LIST") {
    const name = String(body.name ?? "").trim().slice(0, 100);
    const currency = String(body.currency ?? "KRW").trim().toUpperCase();
    const effectiveFrom = String(body.effectiveFrom ?? "").trim();
    const effectiveTo = String(body.effectiveTo ?? "").trim();
    if (name.length < 2 || !/^[A-Z]{3}$/.test(currency) || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)
      || (effectiveTo && (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo) || effectiveTo < effectiveFrom))) {
      return Response.json({ error: "가격표 명칭·통화·적용기간을 확인해 주세요." }, { status: 400 });
    }
    const latest = await db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM sales_price_lists WHERE name = ?")
      .bind(name).first<{ version: number }>();
    const id = crypto.randomUUID(); const version = Number(latest?.version ?? 0) + 1;
    await db.prepare(`INSERT INTO sales_price_lists
      (id, name, version, currency, effective_from, effective_to, status, created_by, approved_by, approved_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'DRAFT', ?, '', NULL, ?, ?)`).bind(id, name, version, currency, effectiveFrom, effectiveTo,
        authorization.principal.employeeId, now, now).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SALES_PRICE_LIST_CREATED",
      entityType: "salesPriceList", entityId: id, after: { name, version, currency, effectiveFrom, effectiveTo } });
    return Response.json({ id, version }, { status: 201 });
  }

  if (action === "UPSERT_PRICE_ITEM") {
    const priceListId = String(body.priceListId ?? ""); const catalogItemId = String(body.catalogItemId ?? "");
    const listUnitPrice = Number(body.listUnitPrice); const standardUnitCost = Number(body.standardUnitCost); const minUnitPrice = Number(body.minUnitPrice);
    const [list, catalog] = await Promise.all([
      db.prepare("SELECT id, status FROM sales_price_lists WHERE id = ?").bind(priceListId).first<{ id: string; status: string }>(),
      db.prepare("SELECT id FROM sales_catalog_items WHERE id = ? AND status = 'ACTIVE'").bind(catalogItemId).first<{ id: string }>(),
    ]);
    if (!list || list.status !== "DRAFT" || !catalog || ![listUnitPrice, standardUnitCost, minUnitPrice].every(Number.isSafeInteger)
      || Math.min(listUnitPrice, standardUnitCost, minUnitPrice) < 0 || minUnitPrice > listUnitPrice) {
      return Response.json({ error: "작성 중 가격표·활성 품목·정가·표준원가·최저단가를 확인해 주세요. 최저단가는 정가를 넘을 수 없습니다." }, { status: 400 });
    }
    const id = crypto.randomUUID();
    await db.prepare(`INSERT INTO sales_price_list_items
      (id, price_list_id, catalog_item_id, list_unit_price, standard_unit_cost, min_unit_price, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(price_list_id, catalog_item_id) DO UPDATE SET list_unit_price = excluded.list_unit_price,
        standard_unit_cost = excluded.standard_unit_cost, min_unit_price = excluded.min_unit_price, updated_at = excluded.updated_at`)
      .bind(id, priceListId, catalogItemId, listUnitPrice, standardUnitCost, minUnitPrice, now, now).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SALES_PRICE_ITEM_UPSERTED",
      entityType: "salesPriceList", entityId: priceListId, after: { catalogItemId, listUnitPrice, standardUnitCost, minUnitPrice } });
    return Response.json({ ok: true });
  }

  if (action === "ACTIVATE_PRICE_LIST") {
    const approval = await authorizeErpRequest(db, "sales", "approve");
    if (approval.response) return approval.response;
    const id = String(body.id ?? "");
    const list = await db.prepare(`SELECT list.id, list.status, COUNT(item.id) AS item_count FROM sales_price_lists list
      LEFT JOIN sales_price_list_items item ON item.price_list_id = list.id WHERE list.id = ? GROUP BY list.id`).bind(id)
      .first<{ id: string; status: string; item_count: number }>();
    if (!list || list.status !== "DRAFT" || Number(list.item_count) < 1) return Response.json({ error: "품목이 등록된 작성 중 가격표만 활성화할 수 있습니다." }, { status: 409 });
    await db.batch([
      db.prepare("UPDATE sales_price_lists SET status = 'SUPERSEDED', updated_at = ? WHERE status = 'ACTIVE' AND id <> ?").bind(now, id),
      db.prepare("UPDATE sales_price_lists SET status = 'ACTIVE', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ? AND status = 'DRAFT'")
        .bind(approval.principal.employeeId, now, now, id),
    ]);
    await writeErpAudit(db, { principal: approval.principal, module: "sales", action: "SALES_PRICE_LIST_ACTIVATED", entityType: "salesPriceList", entityId: id });
    return Response.json({ ok: true });
  }

  if (action === "CREATE_POLICY") {
    const name = String(body.name ?? "").trim().slice(0, 100);
    const maxDiscountPercent = Number(body.maxDiscountPercent); const minGrossMarginPercent = Number(body.minGrossMarginPercent);
    if (name.length < 2 || !Number.isFinite(maxDiscountPercent) || !Number.isFinite(minGrossMarginPercent)
      || maxDiscountPercent < 0 || maxDiscountPercent > 100 || minGrossMarginPercent < 0 || minGrossMarginPercent > 100) {
      return Response.json({ error: "정책 명칭과 0~100% 범위의 할인·마진 기준을 확인해 주세요." }, { status: 400 });
    }
    const latest = await db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM sales_pricing_policies WHERE name = ?")
      .bind(name).first<{ version: number }>();
    const id = crypto.randomUUID(); const version = Number(latest?.version ?? 0) + 1;
    await db.prepare(`INSERT INTO sales_pricing_policies
      (id, name, version, max_discount_bps, min_gross_margin_bps, status, created_by, approved_by, approved_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'DRAFT', ?, '', NULL, ?, ?)`).bind(id, name, version, Math.round(maxDiscountPercent * 100),
        Math.round(minGrossMarginPercent * 100), authorization.principal.employeeId, now, now).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SALES_PRICING_POLICY_CREATED",
      entityType: "salesPricingPolicy", entityId: id, after: { name, version, maxDiscountPercent, minGrossMarginPercent } });
    return Response.json({ id, version }, { status: 201 });
  }

  if (action === "ACTIVATE_POLICY") {
    const approval = await authorizeErpRequest(db, "sales", "approve");
    if (approval.response) return approval.response;
    const id = String(body.id ?? "");
    const policy = await db.prepare("SELECT id, status FROM sales_pricing_policies WHERE id = ?").bind(id).first<{ id: string; status: string }>();
    if (!policy || policy.status !== "DRAFT") return Response.json({ error: "작성 중 정책만 활성화할 수 있습니다." }, { status: 409 });
    await db.batch([
      db.prepare("UPDATE sales_pricing_policies SET status = 'SUPERSEDED', updated_at = ? WHERE status = 'ACTIVE' AND id <> ?").bind(now, id),
      db.prepare("UPDATE sales_pricing_policies SET status = 'ACTIVE', approved_by = ?, approved_at = ?, updated_at = ? WHERE id = ? AND status = 'DRAFT'")
        .bind(approval.principal.employeeId, now, now, id),
    ]);
    await writeErpAudit(db, { principal: approval.principal, module: "sales", action: "SALES_PRICING_POLICY_ACTIVATED", entityType: "salesPricingPolicy", entityId: id });
    return Response.json({ ok: true });
  }

  if (action === "EVALUATE_DOCUMENT") {
    const documentId = String(body.documentId ?? "");
    try {
      const review = await evaluateSalesDocumentPricing(db, documentId, authorization.principal.employeeId);
      await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SALES_DOCUMENT_PRICING_EVALUATED",
        entityType: "salesPricingReview", entityId: documentId, after: review });
      return Response.json({ review });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "가격을 검토하지 못했습니다." }, { status: 409 });
    }
  }

  if (action === "REQUEST_EXCEPTION") {
    const documentId = String(body.documentId ?? ""); const reason = String(body.reason ?? "").trim().slice(0, 1000);
    if (reason.length < 10) return Response.json({ error: "가격 예외 사유를 10자 이상 입력해 주세요." }, { status: 400 });
    const review = await db.prepare("SELECT * FROM sales_document_pricing_reviews WHERE document_id = ?").bind(documentId).first<PricingReviewRow>();
    const document = await db.prepare("SELECT document_number, amount FROM sales_documents WHERE id = ?").bind(documentId).first<{ document_number: string; amount: number }>();
    if (!review || review.outcome !== "EXCEPTION_REQUIRED" || review.approval_request_id || !document) {
      return Response.json({ error: "예외 승인이 필요한 최신 가격 검토 결과가 없습니다." }, { status: 409 });
    }
    const created = await createApprovalRequest(db, authorization.principal, {
      module: "sales", requestType: "DISCOUNT", title: `${document.document_number} 가격 예외 승인`,
      description: `${reason}\n${JSON.parse(review.reasons_json || "[]").join(" · ")}`,
      targetEntityType: "SALES_PRICING_REVIEW", targetEntityId: documentId, amount: document.amount,
      metadata: { documentNumber: document.document_number, priceListVersion: review.price_list_version,
        policyVersion: review.policy_version, discountBps: review.discount_bps, grossMarginBps: review.gross_margin_bps, reason },
    });
    const updated = await db.prepare(`UPDATE sales_document_pricing_reviews SET outcome = 'APPROVAL_PENDING', approval_request_id = ?,
      updated_at = ? WHERE document_id = ? AND outcome = 'EXCEPTION_REQUIRED' AND approval_request_id = ''`)
      .bind(created.id, now, documentId).run();
    if ((updated.meta.changes ?? 0) < 1) return Response.json({ error: "다른 사용자가 먼저 예외 승인을 요청했습니다." }, { status: 409 });
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SALES_PRICING_EXCEPTION_SUBMITTED",
      entityType: "salesPricingReview", entityId: documentId, reason, after: { approvalId: created.id } });
    return Response.json({ approvalId: created.id }, { status: 202 });
  }

  return Response.json({ error: "지원하지 않는 가격 통제 작업입니다." }, { status: 400 });
}
