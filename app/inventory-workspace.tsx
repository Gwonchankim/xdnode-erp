"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Product = { id: string; sku: string; name: string; category: string; unit: string; minimumStock: number; status: string };
type Warehouse = { id: string; code: string; name: string; location: string; status: string };
type Stock = { productId: string; sku: string; productName: string; category: string; unit: string; minimumStock: number; warehouseId: string; warehouseCode: string; warehouseName: string; quantity: number; stockAmount: number; averageUnitCost: number };
type Movement = { id: string; movementDate: string; movementType: string; direction: string; productSku: string; productName: string; warehouseCode: string; warehouseName: string; quantity: number; unitCost: number; amount: number; sourceType: string; referenceNumber: string; reason: string; postedBy: string };
type PurchaseCandidate = { receiptLineId: string; receiptId: string; receiptNumber: string; receiptDate: string; orderNumber: string; vendorName: string; itemName: string; description: string; acceptedQuantity: number; unitPrice: number };
type Delivery = { id: string; documentNumber: string; issuedDate: string; amount: number; status: string; opportunityTitle: string; accountName: string; postedQuantity: number };
type InventoryData = { products: Product[]; warehouses: Warehouse[]; stocks: Stock[]; movements: Movement[]; purchaseCandidates: PurchaseCandidate[]; deliveries: Delivery[]; summary: { stockValue: number; stockedProductCount: number; belowMinimumCount: number; unmappedReceiptCount: number } };

const won = (value: number) => `₩${Math.round(value).toLocaleString("ko-KR")}`;
const movementLabels: Record<string, string> = { PURCHASE_RECEIPT_IN: "매입 입고", DELIVERY_OUT: "납품 출고", ADJUSTMENT_IN: "재고 증가조정", ADJUSTMENT_OUT: "재고 감소조정" };
const sourceLabels: Record<string, string> = { PURCHASE_RECEIPT: "입고검수", SALES_DELIVERY: "납품문서", INVENTORY_ADJUSTMENT: "재고조정" };
const today = () => new Date().toISOString().slice(0, 10);

export default function InventoryWorkspace() {
  const [data, setData] = useState<InventoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [productDraft, setProductDraft] = useState({ sku: "", name: "", category: "", unit: "EA", minimumStock: "0" });
  const [warehouseDraft, setWarehouseDraft] = useState({ code: "", name: "", location: "" });
  const [productEdit, setProductEdit] = useState<Product | null>(null);
  const [warehouseEdit, setWarehouseEdit] = useState<Warehouse | null>(null);
  const [receiptDraft, setReceiptDraft] = useState({ receiptLineId: "", productId: "", warehouseId: "", movementDate: today() });
  const [movementDraft, setMovementDraft] = useState({ movementType: "DELIVERY_OUT", deliveryId: "", productId: "", warehouseId: "", movementDate: today(), quantity: "", unitCost: "", referenceNumber: "", reason: "" });

  async function load() {
    try {
      const response = await fetch("/api/finance/inventory");
      const result = await response.json() as InventoryData & { error?: string };
      if (!response.ok) throw new Error(result.error || "재고 원장을 불러오지 못했습니다.");
      setData(result);
      setReceiptDraft((current) => ({ ...current,
        receiptLineId: result.purchaseCandidates.some((row) => row.receiptLineId === current.receiptLineId) ? current.receiptLineId : result.purchaseCandidates[0]?.receiptLineId || "",
        productId: result.products.some((row) => row.id === current.productId && row.status === "ACTIVE") ? current.productId : result.products.find((row) => row.status === "ACTIVE")?.id || "",
        warehouseId: result.warehouses.some((row) => row.id === current.warehouseId && row.status === "ACTIVE") ? current.warehouseId : result.warehouses.find((row) => row.status === "ACTIVE")?.id || "",
      }));
      setMovementDraft((current) => ({ ...current,
        deliveryId: result.deliveries.some((row) => row.id === current.deliveryId) ? current.deliveryId : result.deliveries[0]?.id || "",
        productId: result.products.some((row) => row.id === current.productId && row.status === "ACTIVE") ? current.productId : result.products.find((row) => row.status === "ACTIVE")?.id || "",
        warehouseId: result.warehouses.some((row) => row.id === current.warehouseId && row.status === "ACTIVE") ? current.warehouseId : result.warehouses.find((row) => row.status === "ACTIVE")?.id || "",
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "재고 원장을 불러오지 못했습니다.");
    } finally { setLoading(false); }
  }
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, []);

  const activeProducts = useMemo(() => (data?.products ?? []).filter((row) => row.status === "ACTIVE"), [data]);
  const activeWarehouses = useMemo(() => (data?.warehouses ?? []).filter((row) => row.status === "ACTIVE"), [data]);
  const selectedReceipt = data?.purchaseCandidates.find((row) => row.receiptLineId === receiptDraft.receiptLineId);
  const selectedProduct = activeProducts.find((row) => row.id === movementDraft.productId);
  const selectedStock = data?.stocks.find((row) => row.productId === movementDraft.productId && row.warehouseId === movementDraft.warehouseId);

  async function createMaster(event: FormEvent<HTMLFormElement>, resource: "product" | "warehouse") {
    event.preventDefault(); setMessage("");
    const payload = resource === "product" ? { ...productDraft, minimumStock: Number(productDraft.minimumStock) } : warehouseDraft;
    const response = await fetch("/api/finance/inventory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource, ...payload }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) return setMessage(result.error || "마스터를 저장하지 못했습니다.");
    setMessage(resource === "product" ? "상품 마스터를 등록했습니다." : "창고 마스터를 등록했습니다.");
    if (resource === "product") setProductDraft({ sku: "", name: "", category: "", unit: "EA", minimumStock: "0" });
    else setWarehouseDraft({ code: "", name: "", location: "" });
    await load();
  }

  async function updateMaster(event: FormEvent<HTMLFormElement>, resource: "product" | "warehouse") {
    event.preventDefault(); setMessage("");
    const item = resource === "product" ? productEdit : warehouseEdit;
    if (!item) return;
    const response = await fetch("/api/finance/inventory", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource, ...item }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) return setMessage(result.error || "마스터를 수정하지 못했습니다.");
    setMessage(resource === "product" ? "상품 마스터를 수정했습니다." : "창고 마스터를 수정했습니다.");
    if (resource === "product") setProductEdit(null); else setWarehouseEdit(null);
    await load();
  }

  async function postReceipt(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    const response = await fetch("/api/finance/inventory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource: "purchaseReceipt", ...receiptDraft }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) return setMessage(result.error || "입고를 재고에 반영하지 못했습니다.");
    setMessage("합격 입고수량을 재고 원장에 반영했습니다.");
    await load();
  }

  async function postMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    const response = await fetch("/api/finance/inventory", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource: "movement", ...movementDraft, quantity: Number(movementDraft.quantity), unitCost: Number(movementDraft.unitCost) }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) return setMessage(result.error || "재고 이동을 반영하지 못했습니다.");
    setMessage(movementDraft.movementType === "DELIVERY_OUT" ? "납품 출고를 재고 원장에 반영했습니다." : "사유가 포함된 재고조정을 반영했습니다.");
    setMovementDraft((current) => ({ ...current, quantity: "", unitCost: "", referenceNumber: "", reason: "" }));
    await load();
  }

  if (loading) return <div className="finance-empty">재고 원장을 불러오는 중입니다.</div>;
  return <div className="inventory-workspace">
    <section className="finance-subpage-heading inventory-heading"><div><p>INVENTORY CONTROL</p><h2>재고·상품원가</h2><span>입고검수와 납품문서를 상품·창고별 불변 재고원장으로 연결합니다.</span></div><em>이동평균 원가 · 음수재고 차단</em></section>
    {message && <div className="sales-live-message" role="status">{message}</div>}
    <section className="inventory-metrics">
      <article><small>총 재고가치</small><strong>{won(data?.summary.stockValue ?? 0)}</strong><span>입출고 원가 순액</span></article>
      <article><small>보유 SKU</small><strong>{data?.summary.stockedProductCount ?? 0}개</strong><span>수량 0 초과</span></article>
      <article className={(data?.summary.belowMinimumCount ?? 0) ? "warn" : ""}><small>안전재고 미달</small><strong>{data?.summary.belowMinimumCount ?? 0}개</strong><span>전체 창고 합계 기준</span></article>
      <article className={(data?.summary.unmappedReceiptCount ?? 0) ? "warn" : ""}><small>미반영 입고</small><strong>{data?.summary.unmappedReceiptCount ?? 0}건</strong><span>상품·창고 연결 필요</span></article>
    </section>

    <section className="panel inventory-stock-panel">
      <header><div><p>STOCK ON HAND</p><h3>상품·창고별 현재고</h3></div><span>{data?.stocks.length ?? 0}행</span></header>
      <div className="inventory-stock-row head"><span>상품</span><span>창고</span><span>현재고</span><span>평균원가</span><span>재고가치</span><span>상태</span></div>
      {(data?.stocks ?? []).map((row) => <div className="inventory-stock-row" key={`${row.productId}:${row.warehouseId}`}><span><strong>{row.sku}</strong><small>{row.productName} · {row.category || "미분류"}</small></span><span><strong>{row.warehouseCode}</strong><small>{row.warehouseName}</small></span><span><strong>{row.quantity.toLocaleString("ko-KR")} {row.unit}</strong><small>안전재고 {row.minimumStock.toLocaleString("ko-KR")}</small></span><span>{won(row.averageUnitCost)}</span><span><strong>{won(row.stockAmount)}</strong></span><span><em className={row.quantity < row.minimumStock ? "inventory-status warn" : "inventory-status"}>{row.quantity < row.minimumStock ? "보충 필요" : "정상"}</em></span></div>)}
      {!data?.stocks.length && <div className="finance-empty">입고 또는 조정 이동을 반영하면 현재고가 표시됩니다.</div>}
    </section>

    <section className="inventory-entry-grid">
      <article className="panel inventory-entry-card">
        <header><div><p>RECEIPT MAPPING</p><h3>입고검수 재고 반영</h3></div><span>{data?.purchaseCandidates.length ?? 0}건 대기</span></header>
        <form onSubmit={postReceipt}>
          <label>미반영 입고<select required value={receiptDraft.receiptLineId} onChange={(event) => setReceiptDraft({ ...receiptDraft, receiptLineId: event.target.value })}><option value="">선택</option>{(data?.purchaseCandidates ?? []).map((row) => <option value={row.receiptLineId} key={row.receiptLineId}>{row.receiptNumber} · {row.itemName} · {row.acceptedQuantity.toLocaleString("ko-KR")}</option>)}</select></label>
          {selectedReceipt && <div className="inventory-source-preview"><strong>{selectedReceipt.vendorName || "공급사 미지정"}</strong><span>{selectedReceipt.orderNumber} · 합격 {selectedReceipt.acceptedQuantity.toLocaleString("ko-KR")} · 단가 {won(selectedReceipt.unitPrice)}</span><small>자유입력 품목명 ‘{selectedReceipt.itemName}’을 자동 SKU로 간주하지 않습니다.</small></div>}
          <label>상품<select required value={receiptDraft.productId} onChange={(event) => setReceiptDraft({ ...receiptDraft, productId: event.target.value })}><option value="">선택</option>{activeProducts.map((row) => <option value={row.id} key={row.id}>{row.sku} · {row.name}</option>)}</select></label>
          <label>입고 창고<select required value={receiptDraft.warehouseId} onChange={(event) => setReceiptDraft({ ...receiptDraft, warehouseId: event.target.value })}><option value="">선택</option>{activeWarehouses.map((row) => <option value={row.id} key={row.id}>{row.code} · {row.name}</option>)}</select></label>
          <label>재고 이동일<input readOnly type="date" value={selectedReceipt?.receiptDate ?? receiptDraft.movementDate} /></label>
          <button type="submit" disabled={!data?.purchaseCandidates.length || !activeProducts.length || !activeWarehouses.length}>합격수량 입고 반영</button>
        </form>
      </article>

      <article className="panel inventory-entry-card">
        <header><div><p>ISSUE & ADJUSTMENT</p><h3>납품 출고·재고조정</h3></div><span>불변 이동 원장</span></header>
        <form onSubmit={postMovement}>
          <label>이동 유형<select value={movementDraft.movementType} onChange={(event) => setMovementDraft({ ...movementDraft, movementType: event.target.value })}><option value="DELIVERY_OUT">납품 출고</option><option value="ADJUSTMENT_IN">재고 증가조정</option><option value="ADJUSTMENT_OUT">재고 감소조정</option></select></label>
          {movementDraft.movementType === "DELIVERY_OUT" && <label>납품 문서<select required value={movementDraft.deliveryId} onChange={(event) => setMovementDraft({ ...movementDraft, deliveryId: event.target.value })}><option value="">선택</option>{(data?.deliveries ?? []).map((row) => <option value={row.id} key={row.id}>{row.documentNumber} · {row.accountName} · {row.opportunityTitle}</option>)}</select></label>}
          <label>상품<select required value={movementDraft.productId} onChange={(event) => setMovementDraft({ ...movementDraft, productId: event.target.value })}><option value="">선택</option>{activeProducts.map((row) => <option value={row.id} key={row.id}>{row.sku} · {row.name}</option>)}</select></label>
          <label>출고·조정 창고<select required value={movementDraft.warehouseId} onChange={(event) => setMovementDraft({ ...movementDraft, warehouseId: event.target.value })}><option value="">선택</option>{activeWarehouses.map((row) => <option value={row.id} key={row.id}>{row.code} · {row.name}</option>)}</select></label>
          <div className="inventory-source-preview"><strong>가용재고 {selectedStock?.quantity.toLocaleString("ko-KR") ?? "0"} {selectedProduct?.unit ?? ""}</strong><span>현재 평균원가 {won(selectedStock?.averageUnitCost ?? 0)}</span><small>출고는 가용재고를 초과할 수 없습니다.</small></div>
          <label>이동일<input required type="date" value={movementDraft.movementDate} onChange={(event) => setMovementDraft({ ...movementDraft, movementDate: event.target.value })} /></label>
          <label>수량<input required type="number" min="0.001" step="0.001" value={movementDraft.quantity} onChange={(event) => setMovementDraft({ ...movementDraft, quantity: event.target.value })} /></label>
          {movementDraft.movementType === "ADJUSTMENT_IN" && <label>입고조정 단가<input required type="number" min="0" step="1" value={movementDraft.unitCost} onChange={(event) => setMovementDraft({ ...movementDraft, unitCost: event.target.value })} /></label>}
          {movementDraft.movementType !== "DELIVERY_OUT" && <label>참조번호<input value={movementDraft.referenceNumber} onChange={(event) => setMovementDraft({ ...movementDraft, referenceNumber: event.target.value })} /></label>}
          <label className="wide">{movementDraft.movementType === "DELIVERY_OUT" ? "출고 메모" : "조정 사유"}<textarea required={movementDraft.movementType !== "DELIVERY_OUT"} rows={3} value={movementDraft.reason} onChange={(event) => setMovementDraft({ ...movementDraft, reason: event.target.value })} /></label>
          <button type="submit" disabled={!activeProducts.length || !activeWarehouses.length || (movementDraft.movementType === "DELIVERY_OUT" && !data?.deliveries.length)}>재고 이동 반영</button>
        </form>
      </article>
    </section>

    <section className="inventory-master-grid">
      <article className="panel inventory-master-card"><header><div><p>PRODUCT MASTER</p><h3>상품 등록</h3></div><span>{data?.products.length ?? 0}개</span></header><form onSubmit={(event) => void createMaster(event, "product")}><label>SKU<input required value={productDraft.sku} onChange={(event) => setProductDraft({ ...productDraft, sku: event.target.value })} /></label><label>상품명<input required value={productDraft.name} onChange={(event) => setProductDraft({ ...productDraft, name: event.target.value })} /></label><label>분류<input value={productDraft.category} onChange={(event) => setProductDraft({ ...productDraft, category: event.target.value })} /></label><label>단위<input required value={productDraft.unit} onChange={(event) => setProductDraft({ ...productDraft, unit: event.target.value })} /></label><label>안전재고<input required type="number" min="0" step="0.001" value={productDraft.minimumStock} onChange={(event) => setProductDraft({ ...productDraft, minimumStock: event.target.value })} /></label><button type="submit">+ 상품 등록</button></form>{productEdit && <form className="inventory-master-edit" onSubmit={(event) => void updateMaster(event, "product")}><strong>{productEdit.sku} 수정</strong><label>상품명<input required value={productEdit.name} onChange={(event) => setProductEdit({ ...productEdit, name: event.target.value })} /></label><label>분류<input value={productEdit.category} onChange={(event) => setProductEdit({ ...productEdit, category: event.target.value })} /></label><label>단위<input required value={productEdit.unit} onChange={(event) => setProductEdit({ ...productEdit, unit: event.target.value })} /></label><label>안전재고<input required type="number" min="0" step="0.001" value={productEdit.minimumStock} onChange={(event) => setProductEdit({ ...productEdit, minimumStock: Number(event.target.value) })} /></label><label>상태<select value={productEdit.status} onChange={(event) => setProductEdit({ ...productEdit, status: event.target.value })}><option value="ACTIVE">사용</option><option value="INACTIVE">미사용</option></select></label><button type="submit">변경 저장</button><button type="button" className="secondary" onClick={() => setProductEdit(null)}>취소</button></form>}<div className="inventory-master-list">{(data?.products ?? []).map((row) => <div key={row.id}><strong>{row.sku}</strong><span>{row.name}</span><em>{row.minimumStock.toLocaleString("ko-KR")} {row.unit}</em><button type="button" onClick={() => setProductEdit(row)}>수정</button></div>)}</div></article>
      <article className="panel inventory-master-card"><header><div><p>WAREHOUSE MASTER</p><h3>창고 등록</h3></div><span>{data?.warehouses.length ?? 0}개</span></header><form onSubmit={(event) => void createMaster(event, "warehouse")}><label>창고코드<input required value={warehouseDraft.code} onChange={(event) => setWarehouseDraft({ ...warehouseDraft, code: event.target.value })} /></label><label>창고명<input required value={warehouseDraft.name} onChange={(event) => setWarehouseDraft({ ...warehouseDraft, name: event.target.value })} /></label><label className="wide">위치<input value={warehouseDraft.location} onChange={(event) => setWarehouseDraft({ ...warehouseDraft, location: event.target.value })} /></label><button type="submit">+ 창고 등록</button></form>{warehouseEdit && <form className="inventory-master-edit" onSubmit={(event) => void updateMaster(event, "warehouse")}><strong>{warehouseEdit.code} 수정</strong><label>창고명<input required value={warehouseEdit.name} onChange={(event) => setWarehouseEdit({ ...warehouseEdit, name: event.target.value })} /></label><label>위치<input value={warehouseEdit.location} onChange={(event) => setWarehouseEdit({ ...warehouseEdit, location: event.target.value })} /></label><label>상태<select value={warehouseEdit.status} onChange={(event) => setWarehouseEdit({ ...warehouseEdit, status: event.target.value })}><option value="ACTIVE">사용</option><option value="INACTIVE">미사용</option></select></label><button type="submit">변경 저장</button><button type="button" className="secondary" onClick={() => setWarehouseEdit(null)}>취소</button></form>}<div className="inventory-master-list">{(data?.warehouses ?? []).map((row) => <div key={row.id}><strong>{row.code}</strong><span>{row.name}</span><em>{row.location || "위치 미입력"}</em><button type="button" onClick={() => setWarehouseEdit(row)}>수정</button></div>)}</div></article>
    </section>

    <section className="panel inventory-movement-panel"><header><div><p>IMMUTABLE MOVEMENT LEDGER</p><h3>재고 이동 이력</h3></div><span>최근 {data?.movements.length ?? 0}건</span></header><div className="inventory-movement-row head"><span>일자·유형</span><span>상품</span><span>창고</span><span>수량</span><span>단가·금액</span><span>원천·사유</span></div>{(data?.movements ?? []).map((row) => <div className="inventory-movement-row" key={row.id}><span><strong>{row.movementDate}</strong><small>{movementLabels[row.movementType] ?? row.movementType}</small></span><span><strong>{row.productSku}</strong><small>{row.productName}</small></span><span><strong>{row.warehouseCode}</strong><small>{row.warehouseName}</small></span><span><strong className={row.direction === "IN" ? "inventory-in" : "inventory-out"}>{row.direction === "IN" ? "+" : "-"}{row.quantity.toLocaleString("ko-KR")}</strong></span><span><strong>{won(row.unitCost)}</strong><small>{won(row.amount)}</small></span><span><strong>{sourceLabels[row.sourceType] ?? row.sourceType} · {row.referenceNumber || "참조 없음"}</strong><small>{row.reason || `처리자 ${row.postedBy}`}</small></span></div>)}{!data?.movements.length && <div className="finance-empty">재고 이동 이력이 없습니다.</div>}</section>
  </div>;
}
