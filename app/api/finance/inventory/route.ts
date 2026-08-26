import { env } from "cloudflare:workers";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;

type ProductRow = {
  id: string; sku: string; name: string; category: string; unit: string; minimum_stock_milli: number;
  status: string; created_by: string; created_at: number; updated_at: number;
};
type WarehouseRow = {
  id: string; code: string; name: string; location: string; status: string; created_by: string;
  created_at: number; updated_at: number;
};
type StockRow = {
  product_id: string; sku: string; product_name: string; category: string; unit: string;
  minimum_stock_milli: number; warehouse_id: string; warehouse_code: string; warehouse_name: string;
  quantity_milli: number; stock_amount: number;
};
type MovementRow = {
  id: string; movement_date: string; movement_type: string; direction: string; product_id: string;
  product_sku: string; product_name: string; warehouse_id: string; warehouse_code: string; warehouse_name: string;
  quantity_milli: number; unit_cost: number; amount: number; source_type: string; source_id: string;
  source_line_key: string; reference_number: string; reason: string; posted_by: string; created_at: number;
};
type PurchaseCandidateRow = {
  receipt_line_id: string; receipt_id: string; receipt_number: string; receipt_date: string; order_number: string;
  vendor_name: string; item_name: string; description: string; accepted_quantity_milli: number; unit_price: number;
};
type DeliveryRow = {
  id: string; document_number: string; issued_date: string; amount: number; status: string;
  opportunity_title: string; account_name: string; posted_quantity_milli: number;
};

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
const toProduct = (row: ProductRow) => ({
  id: row.id, sku: row.sku, name: row.name, category: row.category, unit: row.unit,
  minimumStock: row.minimum_stock_milli / 1000, status: row.status,
});
const toWarehouse = (row: WarehouseRow) => ({
  id: row.id, code: row.code, name: row.name, location: row.location, status: row.status,
});
const toMovement = (row: MovementRow) => ({
  id: row.id, movementDate: row.movement_date, movementType: row.movement_type, direction: row.direction,
  productId: row.product_id, productSku: row.product_sku, productName: row.product_name,
  warehouseId: row.warehouse_id, warehouseCode: row.warehouse_code, warehouseName: row.warehouse_name,
  quantity: row.quantity_milli / 1000, unitCost: row.unit_cost, amount: row.amount,
  sourceType: row.source_type, sourceId: row.source_id, sourceLineKey: row.source_line_key,
  referenceNumber: row.reference_number, reason: row.reason, postedBy: row.posted_by, createdAt: row.created_at,
});

async function ensureSchema() {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS inventory_products (
      id TEXT PRIMARY KEY NOT NULL, sku TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL DEFAULT '',
      unit TEXT NOT NULL DEFAULT 'EA', minimum_stock_milli INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'ACTIVE', created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS inventory_warehouses (
      id TEXT PRIMARY KEY NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, location TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ACTIVE', created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS inventory_movements (
      id TEXT PRIMARY KEY NOT NULL, movement_date TEXT NOT NULL, movement_type TEXT NOT NULL, direction TEXT NOT NULL,
      product_id TEXT NOT NULL, warehouse_id TEXT NOT NULL, quantity_milli INTEGER NOT NULL, unit_cost INTEGER NOT NULL,
      amount INTEGER NOT NULL, source_type TEXT NOT NULL, source_id TEXT NOT NULL, source_line_key TEXT NOT NULL,
      reference_number TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', posted_by TEXT NOT NULL, created_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_product_sku ON inventory_products(sku)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_inventory_product_status_name ON inventory_products(status, name)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_warehouse_code ON inventory_warehouses(code)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_inventory_warehouse_status_name ON inventory_warehouses(status, name)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_movement_source_line ON inventory_movements(source_type, source_id, source_line_key)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_inventory_movement_product_warehouse_date ON inventory_movements(product_id, warehouse_id, movement_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_inventory_movement_date_type ON inventory_movements(movement_date, movement_type)"),
  ]);
}

// asOfDate가 주어지면 그 날짜까지 기록된 이동만 합산한다. "이동평균"이라는 이름에 맞으려면 새
// 거래의 단가·가용재고는 입력 시점의 전체 누적이 아니라 그 거래일까지의 잔고를 기준으로 계산해야
// 한다 — 그렇지 않으면 나중에 입력됐지만 더 이른 날짜의 출고가, 그 날짜 이후에 실제로 입고된
// 수량까지 포함한 평균단가를 쓰게 되고, 그 시점엔 존재하지도 않았던 재고를 출고할 수도 있다.
async function currentStock(productId: string, warehouseId: string, asOfDate?: string) {
  const dateFilter = asOfDate ? " AND movement_date <= ?" : "";
  const statement = db.prepare(`SELECT
    COALESCE(SUM(CASE WHEN direction = 'IN' THEN quantity_milli ELSE -quantity_milli END), 0) AS quantity_milli,
    COALESCE(SUM(CASE WHEN direction = 'IN' THEN amount ELSE -amount END), 0) AS stock_amount
    FROM inventory_movements WHERE product_id = ? AND warehouse_id = ?${dateFilter}`);
  return (asOfDate ? statement.bind(productId, warehouseId, asOfDate) : statement.bind(productId, warehouseId))
    .first<{ quantity_milli: number; stock_amount: number }>();
}

async function isClosedPeriod(date: string) {
  const run = await db.prepare("SELECT status FROM finance_close_runs WHERE period = ?")
    .bind(date.slice(0, 7)).first<{ status: string }>();
  return run?.status === "CLOSED";
}

export async function GET() {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "finance", "read");
  if (authorization.response) return authorization.response;
  const [products, warehouses, stocks, totals, movements, purchaseCandidates, deliveries] = await Promise.all([
    db.prepare("SELECT * FROM inventory_products ORDER BY status, sku").all<ProductRow>(),
    db.prepare("SELECT * FROM inventory_warehouses ORDER BY status, code").all<WarehouseRow>(),
    db.prepare(`SELECT product.id AS product_id, product.sku, product.name AS product_name, product.category, product.unit,
      product.minimum_stock_milli, warehouse.id AS warehouse_id, warehouse.code AS warehouse_code, warehouse.name AS warehouse_name,
      SUM(CASE WHEN movement.direction = 'IN' THEN movement.quantity_milli ELSE -movement.quantity_milli END) AS quantity_milli,
      SUM(CASE WHEN movement.direction = 'IN' THEN movement.amount ELSE -movement.amount END) AS stock_amount
      FROM inventory_movements movement JOIN inventory_products product ON product.id = movement.product_id
      JOIN inventory_warehouses warehouse ON warehouse.id = movement.warehouse_id
      GROUP BY product.id, warehouse.id ORDER BY product.sku, warehouse.code`).all<StockRow>(),
    db.prepare(`SELECT product.id, product.minimum_stock_milli,
      COALESCE(SUM(CASE WHEN movement.direction = 'IN' THEN movement.quantity_milli ELSE -movement.quantity_milli END), 0) AS quantity_milli
      FROM inventory_products product LEFT JOIN inventory_movements movement ON movement.product_id = product.id
      WHERE product.status = 'ACTIVE' GROUP BY product.id`).all<{ id: string; minimum_stock_milli: number; quantity_milli: number }>(),
    db.prepare(`SELECT movement.*, product.sku AS product_sku, product.name AS product_name,
      warehouse.code AS warehouse_code, warehouse.name AS warehouse_name
      FROM inventory_movements movement JOIN inventory_products product ON product.id = movement.product_id
      JOIN inventory_warehouses warehouse ON warehouse.id = movement.warehouse_id
      ORDER BY movement.movement_date DESC, movement.created_at DESC LIMIT 100`).all<MovementRow>(),
    db.prepare(`SELECT receipt_line.id AS receipt_line_id, receipt.id AS receipt_id, receipt.receipt_number, receipt.receipt_date,
      purchase_order.order_number, vendor.name AS vendor_name, order_line.item_name, order_line.description,
      receipt_line.accepted_quantity_milli, order_line.unit_price
      FROM finance_purchase_receipt_lines receipt_line
      JOIN finance_purchase_receipts receipt ON receipt.id = receipt_line.receipt_id AND receipt.status = 'ACCEPTED'
      JOIN finance_purchase_order_lines order_line ON order_line.id = receipt_line.order_line_id
      JOIN finance_purchase_orders purchase_order ON purchase_order.id = receipt.order_id
      LEFT JOIN finance_purchase_vendors vendor ON vendor.id = purchase_order.vendor_id
      WHERE receipt_line.accepted_quantity_milli > 0 AND NOT EXISTS (
        SELECT 1 FROM inventory_movements movement WHERE movement.source_type = 'PURCHASE_RECEIPT'
          AND movement.source_id = receipt.id AND movement.source_line_key = receipt_line.id)
      ORDER BY receipt.receipt_date, receipt.created_at`).all<PurchaseCandidateRow>(),
    db.prepare(`SELECT document.id, document.document_number, document.issued_date, document.amount, document.status,
      opportunity.title AS opportunity_title, account.name AS account_name,
      COALESCE((SELECT SUM(movement.quantity_milli) FROM inventory_movements movement
        WHERE movement.source_type = 'SALES_DELIVERY' AND movement.source_id = document.id), 0) AS posted_quantity_milli
      FROM sales_documents document JOIN sales_opportunities opportunity ON opportunity.id = document.opportunity_id
      LEFT JOIN sales_accounts account ON account.id = opportunity.account_id
      WHERE document.document_type = 'DELIVERY' AND document.status IN ('ACCEPTED','COMPLETED')
      ORDER BY document.issued_date DESC, document.created_at DESC`).all<DeliveryRow>(),
  ]);
  const stockRows = stocks.results.map((row) => ({
    productId: row.product_id, sku: row.sku, productName: row.product_name, category: row.category, unit: row.unit,
    minimumStock: row.minimum_stock_milli / 1000, warehouseId: row.warehouse_id, warehouseCode: row.warehouse_code,
    warehouseName: row.warehouse_name, quantity: Number(row.quantity_milli) / 1000, stockAmount: Number(row.stock_amount),
    averageUnitCost: Number(row.quantity_milli) > 0 ? Math.round(Number(row.stock_amount) * 1000 / Number(row.quantity_milli)) : 0,
  }));
  const belowMinimum = totals.results.filter((row) => Number(row.quantity_milli) < Number(row.minimum_stock_milli));
  return Response.json({
    products: products.results.map(toProduct), warehouses: warehouses.results.map(toWarehouse), stocks: stockRows,
    movements: movements.results.map(toMovement),
    purchaseCandidates: purchaseCandidates.results.map((row) => ({
      receiptLineId: row.receipt_line_id, receiptId: row.receipt_id, receiptNumber: row.receipt_number,
      receiptDate: row.receipt_date, orderNumber: row.order_number, vendorName: row.vendor_name ?? "",
      itemName: row.item_name, description: row.description, acceptedQuantity: row.accepted_quantity_milli / 1000,
      unitPrice: row.unit_price,
    })),
    deliveries: deliveries.results.map((row) => ({
      id: row.id, documentNumber: row.document_number, issuedDate: row.issued_date, amount: row.amount,
      status: row.status, opportunityTitle: row.opportunity_title, accountName: row.account_name ?? "",
      postedQuantity: row.posted_quantity_milli / 1000,
    })),
    summary: {
      stockValue: stockRows.reduce((sum, row) => sum + row.stockAmount, 0),
      stockedProductCount: new Set(stockRows.filter((row) => row.quantity > 0).map((row) => row.productId)).size,
      belowMinimumCount: belowMinimum.length, unmappedReceiptCount: purchaseCandidates.results.length,
    },
  });
}

export async function POST(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "finance", "write");
  if (authorization.response) return authorization.response;
  const body = await request.json() as Record<string, unknown>;
  const resource = String(body.resource ?? "");
  const now = Date.now();

  if (resource === "product") {
    const sku = String(body.sku ?? "").trim().toUpperCase();
    const name = String(body.name ?? "").trim();
    const unit = String(body.unit ?? "EA").trim().toUpperCase();
    const minimumStockMilli = Math.round(Number(body.minimumStock ?? 0) * 1000);
    if (!sku || !name || !unit || !Number.isSafeInteger(minimumStockMilli) || minimumStockMilli < 0) return Response.json({ error: "SKU·상품명·단위·안전재고를 확인해 주세요." }, { status: 400 });
    if (await db.prepare("SELECT id FROM inventory_products WHERE sku = ?").bind(sku).first()) return Response.json({ error: "같은 SKU가 이미 있습니다." }, { status: 409 });
    const id = crypto.randomUUID();
    await db.prepare(`INSERT INTO inventory_products
      (id, sku, name, category, unit, minimum_stock_milli, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`)
      .bind(id, sku, name, String(body.category ?? "").trim(), unit, minimumStockMilli, authorization.principal.employeeId, now, now).run();
    const row = await db.prepare("SELECT * FROM inventory_products WHERE id = ?").bind(id).first<ProductRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "INVENTORY_PRODUCT_CREATED", entityType: "inventoryProduct", entityId: id, after: row ? toProduct(row) : body });
    return Response.json({ item: row ? toProduct(row) : null }, { status: 201 });
  }

  if (resource === "warehouse") {
    const code = String(body.code ?? "").trim().toUpperCase();
    const name = String(body.name ?? "").trim();
    if (!code || !name) return Response.json({ error: "창고코드와 창고명이 필요합니다." }, { status: 400 });
    if (await db.prepare("SELECT id FROM inventory_warehouses WHERE code = ?").bind(code).first()) return Response.json({ error: "같은 창고코드가 이미 있습니다." }, { status: 409 });
    const id = crypto.randomUUID();
    await db.prepare(`INSERT INTO inventory_warehouses
      (id, code, name, location, status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`)
      .bind(id, code, name, String(body.location ?? "").trim(), authorization.principal.employeeId, now, now).run();
    const row = await db.prepare("SELECT * FROM inventory_warehouses WHERE id = ?").bind(id).first<WarehouseRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "INVENTORY_WAREHOUSE_CREATED", entityType: "inventoryWarehouse", entityId: id, after: row ? toWarehouse(row) : body });
    return Response.json({ item: row ? toWarehouse(row) : null }, { status: 201 });
  }

  const productId = String(body.productId ?? "").trim();
  const warehouseId = String(body.warehouseId ?? "").trim();
  const movementDate = String(body.movementDate ?? "").trim();
  const product = await db.prepare("SELECT * FROM inventory_products WHERE id = ? AND status = 'ACTIVE'").bind(productId).first<ProductRow>();
  const warehouse = await db.prepare("SELECT * FROM inventory_warehouses WHERE id = ? AND status = 'ACTIVE'").bind(warehouseId).first<WarehouseRow>();
  if (!product || !warehouse) return Response.json({ error: "활성 상품과 창고를 확인해 주세요." }, { status: 400 });

  if (resource === "purchaseReceipt") {
    const receiptLineId = String(body.receiptLineId ?? "").trim();
    const source = await db.prepare(`SELECT receipt_line.id AS receipt_line_id, receipt.id AS receipt_id,
      receipt.receipt_number, receipt.receipt_date, receipt_line.accepted_quantity_milli, order_line.unit_price
      FROM finance_purchase_receipt_lines receipt_line
      JOIN finance_purchase_receipts receipt ON receipt.id = receipt_line.receipt_id AND receipt.status = 'ACCEPTED'
      JOIN finance_purchase_order_lines order_line ON order_line.id = receipt_line.order_line_id
      WHERE receipt_line.id = ? AND receipt_line.accepted_quantity_milli > 0`).bind(receiptLineId)
      .first<{ receipt_line_id: string; receipt_id: string; receipt_number: string; receipt_date: string; accepted_quantity_milli: number; unit_price: number }>();
    if (!source) return Response.json({ error: "반영 가능한 입고검수 행을 찾을 수 없습니다." }, { status: 404 });
    if (!validDate(source.receipt_date)) return Response.json({ error: "원천 입고일을 확인해 주세요." }, { status: 409 });
    if (await isClosedPeriod(source.receipt_date)) return Response.json({ error: "잠긴 마감월의 입고는 재고에 반영할 수 없습니다. 월마감 재개방 절차를 이용해 주세요." }, { status: 409 });
    if (await db.prepare("SELECT id FROM inventory_movements WHERE source_type = 'PURCHASE_RECEIPT' AND source_id = ? AND source_line_key = ?").bind(source.receipt_id, source.receipt_line_id).first()) return Response.json({ error: "이미 재고에 반영된 입고검수 행입니다." }, { status: 409 });
    const id = crypto.randomUUID();
    const amount = Math.round(source.accepted_quantity_milli * source.unit_price / 1000);
    await db.prepare(`INSERT INTO inventory_movements
      (id, movement_date, movement_type, direction, product_id, warehouse_id, quantity_milli, unit_cost, amount,
        source_type, source_id, source_line_key, reference_number, reason, posted_by, created_at)
      VALUES (?, ?, 'PURCHASE_RECEIPT_IN', 'IN', ?, ?, ?, ?, ?, 'PURCHASE_RECEIPT', ?, ?, ?, '', ?, ?)`)
      .bind(id, source.receipt_date, productId, warehouseId, source.accepted_quantity_milli, source.unit_price, amount,
        source.receipt_id, source.receipt_line_id, source.receipt_number, authorization.principal.employeeId, now).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "INVENTORY_RECEIPT_POSTED", entityType: "inventoryMovement", entityId: id, after: { productId, warehouseId, quantity: source.accepted_quantity_milli / 1000, source: source.receipt_number } });
    return Response.json({ id }, { status: 201 });
  }

  if (resource === "movement") {
    const movementType = String(body.movementType ?? "").toUpperCase();
    const quantityMilli = Math.round(Number(body.quantity ?? 0) * 1000);
    const reason = String(body.reason ?? "").trim();
    if (!validDate(movementDate) || !Number.isSafeInteger(quantityMilli) || quantityMilli <= 0 || !["DELIVERY_OUT", "ADJUSTMENT_IN", "ADJUSTMENT_OUT"].includes(movementType)) return Response.json({ error: "이동유형·이동일·수량을 확인해 주세요." }, { status: 400 });
    if (await isClosedPeriod(movementDate)) return Response.json({ error: "잠긴 마감월에는 재고 이동을 추가할 수 없습니다. 월마감 재개방 절차를 이용해 주세요." }, { status: 409 });
    if (movementType.startsWith("ADJUSTMENT") && !reason) return Response.json({ error: "재고조정 사유가 필요합니다." }, { status: 400 });
    const direction: "IN" | "OUT" = movementType === "ADJUSTMENT_IN" ? "IN" : "OUT";
    let sourceType = "INVENTORY_ADJUSTMENT";
    let sourceId = crypto.randomUUID();
    let sourceLineKey = sourceId;
    let referenceNumber = String(body.referenceNumber ?? "").trim();
    let unitCost = Math.round(Number(body.unitCost ?? 0));
    if (movementType === "DELIVERY_OUT") {
      const deliveryId = String(body.deliveryId ?? "").trim();
      const delivery = await db.prepare(`SELECT id, document_number FROM sales_documents
        WHERE id = ? AND document_type = 'DELIVERY' AND status IN ('ACCEPTED','COMPLETED')`)
        .bind(deliveryId).first<{ id: string; document_number: string }>();
      if (!delivery) return Response.json({ error: "확정 또는 완료된 납품 문서를 선택해 주세요." }, { status: 400 });
      sourceType = "SALES_DELIVERY"; sourceId = delivery.id; sourceLineKey = `${productId}:${warehouseId}`; referenceNumber = delivery.document_number;
      if (await db.prepare("SELECT id FROM inventory_movements WHERE source_type = ? AND source_id = ? AND source_line_key = ?").bind(sourceType, sourceId, sourceLineKey).first()) return Response.json({ error: "이 납품 문서의 같은 상품·창고 출고가 이미 반영됐습니다." }, { status: 409 });
    }
    const stock = await currentStock(productId, warehouseId, movementDate);
    const onHandMilli = Number(stock?.quantity_milli ?? 0);
    const stockAmount = Number(stock?.stock_amount ?? 0);
    if (direction === "OUT") {
      if (quantityMilli > onHandMilli) return Response.json({ error: `가용재고 ${(onHandMilli / 1000).toLocaleString("ko-KR")} ${product.unit}를 초과해 출고할 수 없습니다.` }, { status: 409 });
      unitCost = onHandMilli > 0 ? Math.round(stockAmount * 1000 / onHandMilli) : 0;
    } else if (!Number.isSafeInteger(unitCost) || unitCost < 0) return Response.json({ error: "입고조정 단가를 확인해 주세요." }, { status: 400 });
    const id = crypto.randomUUID();
    // 잔량을 전량 출고하는 경우 반올림 잔차를 남기지 않도록 남은 재고금액을 그대로 흡수한다 —
    // 그렇지 않으면 수량은 0인데 재고금액만 1원 안팎으로 영구히 남는 경우가 생긴다.
    const amount = direction === "OUT" && quantityMilli === onHandMilli ? stockAmount : Math.round(quantityMilli * unitCost / 1000);
    await db.prepare(`INSERT INTO inventory_movements
      (id, movement_date, movement_type, direction, product_id, warehouse_id, quantity_milli, unit_cost, amount,
        source_type, source_id, source_line_key, reference_number, reason, posted_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, movementDate, movementType, direction, productId, warehouseId, quantityMilli, unitCost, amount,
        sourceType, sourceId, sourceLineKey, referenceNumber, reason, authorization.principal.employeeId, now).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "INVENTORY_MOVEMENT_POSTED", entityType: "inventoryMovement", entityId: id, after: { movementType, productId, warehouseId, quantity: quantityMilli / 1000, unitCost, sourceType, sourceId, reason } });
    return Response.json({ id }, { status: 201 });
  }

  return Response.json({ error: "지원하지 않는 재고 작업입니다." }, { status: 400 });
}

export async function PUT(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "finance", "write");
  if (authorization.response) return authorization.response;
  const body = await request.json() as Record<string, unknown>;
  const resource = String(body.resource ?? "");
  const id = String(body.id ?? "").trim();
  const now = Date.now();
  if (resource === "product") {
    const before = await db.prepare("SELECT * FROM inventory_products WHERE id = ?").bind(id).first<ProductRow>();
    const name = String(body.name ?? "").trim();
    const unit = String(body.unit ?? "EA").trim().toUpperCase();
    const status = String(body.status ?? "ACTIVE").toUpperCase();
    const minimumStockMilli = Math.round(Number(body.minimumStock ?? 0) * 1000);
    if (!before || !name || !unit || !["ACTIVE", "INACTIVE"].includes(status) || !Number.isSafeInteger(minimumStockMilli) || minimumStockMilli < 0) return Response.json({ error: "상품 수정값을 확인해 주세요." }, { status: 400 });
    await db.prepare("UPDATE inventory_products SET name = ?, category = ?, unit = ?, minimum_stock_milli = ?, status = ?, updated_at = ? WHERE id = ?")
      .bind(name, String(body.category ?? "").trim(), unit, minimumStockMilli, status, now, id).run();
    const after = await db.prepare("SELECT * FROM inventory_products WHERE id = ?").bind(id).first<ProductRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "INVENTORY_PRODUCT_UPDATED", entityType: "inventoryProduct", entityId: id, before: toProduct(before), after: after ? toProduct(after) : body });
    return Response.json({ item: after ? toProduct(after) : null });
  }
  if (resource === "warehouse") {
    const before = await db.prepare("SELECT * FROM inventory_warehouses WHERE id = ?").bind(id).first<WarehouseRow>();
    const name = String(body.name ?? "").trim();
    const status = String(body.status ?? "ACTIVE").toUpperCase();
    if (!before || !name || !["ACTIVE", "INACTIVE"].includes(status)) return Response.json({ error: "창고 수정값을 확인해 주세요." }, { status: 400 });
    await db.prepare("UPDATE inventory_warehouses SET name = ?, location = ?, status = ?, updated_at = ? WHERE id = ?")
      .bind(name, String(body.location ?? "").trim(), status, now, id).run();
    const after = await db.prepare("SELECT * FROM inventory_warehouses WHERE id = ?").bind(id).first<WarehouseRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "INVENTORY_WAREHOUSE_UPDATED", entityType: "inventoryWarehouse", entityId: id, before: toWarehouse(before), after: after ? toWarehouse(after) : body });
    return Response.json({ item: after ? toWarehouse(after) : null });
  }
  return Response.json({ error: "지원하지 않는 재고 수정 작업입니다." }, { status: 400 });
}
