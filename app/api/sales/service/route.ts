import { env } from "cloudflare:workers";
import { createApprovalRequest } from "../../../approval-engine";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";
import { ensureSalesServiceSchema } from "../../../sales-service";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;
const priorities = new Set(["LOW", "NORMAL", "HIGH", "CRITICAL"]);
const categories = new Set(["INQUIRY", "DEFECT", "RETURN", "EXCHANGE", "REFUND"]);
const dispositions = new Set(["RESTOCK", "QUARANTINE", "SCRAP", "RETURN_TO_VENDOR"]);
const koreaDate = (timestamp = Date.now()) => new Date(timestamp + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const parseTimestamp = (value: unknown) => {
  const timestamp = Date.parse(String(value ?? ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
};

type PolicyRow = { id: string; name: string; version: number; priority: string; first_response_hours: number; resolution_hours: number;
  effective_from: string; effective_to: string; status: string; created_by: string; approved_by: string; approved_at: number | null; created_at: number };
type CaseRow = { id: string; case_number: string; account_id: string; opportunity_id: string; delivery_document_id: string; contract_id: string;
  contact_id: string; category: string; priority: string; subject: string; description: string; policy_id: string; opened_at: number;
  first_response_due_at: number; resolution_due_at: number; first_responded_at: number | null; status: string; owner_employee_id: string;
  resolution_type: string; resolution_note: string; refund_amount: number; approval_request_id: string; finance_request_id: string;
  resolved_by: string; resolved_at: number | null; closed_by: string; closed_at: number | null; created_by: string; created_at: number; updated_at: number;
  account_name?: string | null; opportunity_title?: string | null; delivery_number?: string | null; delivery_amount?: number | null;
  contract_number?: string | null; owner_name?: string | null; contact_name?: string | null; finance_status?: string | null; exchange_task_status?: string | null };
type EventRow = { id: string; case_id: string; event_type: string; note: string; actor_employee_id: string; created_at: number; actor_name?: string | null };
type ReturnRow = { id: string; case_id: string; delivery_line_id: string; quantity_milli: number; disposition: string;
  inventory_movement_id: string; received_by: string; received_at: number | null; description?: string | null; catalog_code?: string | null;
  catalog_name?: string | null; delivered_quantity?: number | null };
type DocumentRow = { id: string; entity_id: string; category: string; version: number; file_name: string; created_at: number };

const toPolicy = (row: PolicyRow) => ({ id: row.id, name: row.name, version: row.version, priority: row.priority,
  firstResponseHours: row.first_response_hours, resolutionHours: row.resolution_hours, effectiveFrom: row.effective_from,
  effectiveTo: row.effective_to, status: row.status, approvedBy: row.approved_by, approvedAt: row.approved_at });
const toCase = (row: CaseRow) => ({ id: row.id, caseNumber: row.case_number, accountId: row.account_id, accountName: row.account_name ?? "",
  opportunityId: row.opportunity_id, opportunityTitle: row.opportunity_title ?? "", deliveryDocumentId: row.delivery_document_id,
  deliveryNumber: row.delivery_number ?? "", deliveryAmount: Number(row.delivery_amount ?? 0), contractId: row.contract_id,
  contractNumber: row.contract_number ?? "", contactId: row.contact_id, contactName: row.contact_name ?? "", category: row.category,
  priority: row.priority, subject: row.subject, description: row.description, policyId: row.policy_id, openedAt: row.opened_at,
  firstResponseDueAt: row.first_response_due_at, resolutionDueAt: row.resolution_due_at, firstRespondedAt: row.first_responded_at,
  status: row.status, ownerEmployeeId: row.owner_employee_id, ownerName: row.owner_name ?? row.owner_employee_id,
  resolutionType: row.resolution_type, resolutionNote: row.resolution_note, refundAmount: row.refund_amount,
  approvalRequestId: row.approval_request_id, financeRequestId: row.finance_request_id, financeStatus: row.finance_status ?? "",
  exchangeTaskStatus: row.exchange_task_status ?? "", resolvedBy: row.resolved_by, resolvedAt: row.resolved_at,
  closedBy: row.closed_by, closedAt: row.closed_at, createdAt: row.created_at, updatedAt: row.updated_at });

async function activeEmployee(employeeId: string) {
  return db.prepare("SELECT employee_id FROM hr_employee_records WHERE employee_id = ? AND status NOT IN ('퇴직','입사 예정')")
    .bind(employeeId).first<{ employee_id: string }>();
}

export async function GET() {
  await ensureSalesServiceSchema(db);
  const authorization = await authorizeErpRequest(db, "sales", "read");
  if (authorization.response) return authorization.response;
  const [policies, cases, events, returnLines, deliveries, deliveryLines, employees, contacts, products, warehouses, documents] = await Promise.all([
    db.prepare("SELECT * FROM sales_service_policies ORDER BY CASE status WHEN 'ACTIVE' THEN 0 WHEN 'SUBMITTED' THEN 1 ELSE 2 END, priority, version DESC").all<PolicyRow>(),
    db.prepare(`SELECT service.*, account.name AS account_name, opportunity.title AS opportunity_title,
      delivery.document_number AS delivery_number, delivery.amount AS delivery_amount, contract.contract_number,
      employee.name AS owner_name, contact.name AS contact_name, expense.status AS finance_status,
      exchange_task.status AS exchange_task_status
      FROM sales_service_cases service JOIN sales_accounts account ON account.id = service.account_id
      JOIN sales_opportunities opportunity ON opportunity.id = service.opportunity_id
      JOIN sales_documents delivery ON delivery.id = service.delivery_document_id
      LEFT JOIN sales_contracts contract ON contract.id = service.contract_id
      LEFT JOIN hr_employee_records employee ON employee.employee_id = service.owner_employee_id
      LEFT JOIN sales_account_contacts contact ON contact.id = service.contact_id
      LEFT JOIN finance_expense_requests expense ON expense.id = service.finance_request_id
      LEFT JOIN erp_tasks exchange_task ON exchange_task.id = 'sales-service-exchange:' || service.id AND exchange_task.deleted_at IS NULL
      ORDER BY CASE service.status WHEN 'OPEN' THEN 0 WHEN 'IN_PROGRESS' THEN 1 WHEN 'RESOLUTION_SUBMITTED' THEN 2
        WHEN 'RESOLUTION_APPROVED' THEN 3 WHEN 'RESOLVED' THEN 4 ELSE 5 END, service.resolution_due_at`).all<CaseRow>(),
    db.prepare(`SELECT event.*, employee.name AS actor_name FROM sales_service_case_events event
      LEFT JOIN hr_employee_records employee ON employee.employee_id = event.actor_employee_id ORDER BY event.created_at DESC`).all<EventRow>(),
    db.prepare(`SELECT return_line.*, line.description, catalog.code AS catalog_code, catalog.name AS catalog_name,
      line.quantity AS delivered_quantity FROM sales_service_return_lines return_line
      JOIN sales_document_lines line ON line.id = return_line.delivery_line_id
      LEFT JOIN sales_catalog_items catalog ON catalog.id = line.catalog_item_id ORDER BY return_line.created_at`).all<ReturnRow>(),
    db.prepare(`SELECT document.id, document.document_number, document.amount, document.issued_date,
      opportunity.id AS opportunity_id, opportunity.title AS opportunity_title, account.id AS account_id, account.name AS account_name,
      COALESCE(contract.id, '') AS contract_id, COALESCE(contract.contract_number, '') AS contract_number
      FROM sales_documents document JOIN sales_opportunities opportunity ON opportunity.id = document.opportunity_id
      JOIN sales_accounts account ON account.id = opportunity.account_id
      LEFT JOIN sales_documents source_order ON source_order.id = document.source_document_id AND source_order.document_type = 'ORDER'
      LEFT JOIN sales_contracts contract ON contract.order_document_id = source_order.id
      WHERE document.document_type = 'DELIVERY' AND document.status IN ('ACCEPTED','COMPLETED')
      ORDER BY document.issued_date DESC, document.created_at DESC`).all<{ id: string; document_number: string; amount: number; issued_date: string;
        opportunity_id: string; opportunity_title: string; account_id: string; account_name: string; contract_id: string; contract_number: string }>(),
    db.prepare(`SELECT line.id, line.document_id, line.description, line.quantity, line.unit, line.unit_price,
      catalog.code AS catalog_code, catalog.name AS catalog_name FROM sales_document_lines line
      LEFT JOIN sales_catalog_items catalog ON catalog.id = line.catalog_item_id
      JOIN sales_documents document ON document.id = line.document_id AND document.document_type = 'DELIVERY'
      ORDER BY line.document_id, line.line_number`).all<{ id: string; document_id: string; description: string; quantity: number; unit: string; unit_price: number; catalog_code: string | null; catalog_name: string | null }>(),
    db.prepare("SELECT employee_id, name, position FROM hr_employee_records WHERE status NOT IN ('퇴직','입사 예정') ORDER BY name")
      .all<{ employee_id: string; name: string; position: string }>(),
    db.prepare("SELECT id, account_id, name, title, email, phone FROM sales_account_contacts WHERE status = 'ACTIVE' ORDER BY name")
      .all<{ id: string; account_id: string; name: string; title: string; email: string; phone: string }>(),
    db.prepare("SELECT id, sku, name, unit FROM inventory_products WHERE status = 'ACTIVE' ORDER BY sku").all<{ id: string; sku: string; name: string; unit: string }>(),
    db.prepare("SELECT id, code, name FROM inventory_warehouses WHERE status = 'ACTIVE' ORDER BY code").all<{ id: string; code: string; name: string }>(),
    db.prepare(`SELECT id, entity_id, category, version, file_name, created_at FROM erp_documents
      WHERE module = 'sales' AND entity_type = 'salesServiceCase' AND deleted_at IS NULL ORDER BY created_at DESC`).all<DocumentRow>(),
  ]);
  return Response.json({
    policies: policies.results.map(toPolicy),
    cases: cases.results.map((item) => ({ ...toCase(item),
      events: events.results.filter((event) => event.case_id === item.id).map((event) => ({ id: event.id, eventType: event.event_type,
        note: event.note, actorEmployeeId: event.actor_employee_id, actorName: event.actor_name ?? event.actor_employee_id, createdAt: event.created_at })),
      returnLines: returnLines.results.filter((line) => line.case_id === item.id).map((line) => ({ id: line.id,
        deliveryLineId: line.delivery_line_id, quantity: line.quantity_milli / 1000, disposition: line.disposition,
        inventoryMovementId: line.inventory_movement_id, receivedBy: line.received_by, receivedAt: line.received_at,
        description: line.description ?? "", catalogCode: line.catalog_code ?? "", catalogName: line.catalog_name ?? "",
        deliveredQuantity: Number(line.delivered_quantity ?? 0) })),
      documents: documents.results.filter((document) => document.entity_id === item.id).map((document) => ({ id: document.id,
        category: document.category, version: document.version, fileName: document.file_name, createdAt: document.created_at,
        downloadUrl: `/api/documents?downloadId=${encodeURIComponent(document.id)}` })) })),
    deliveries: deliveries.results.map((item) => ({ id: item.id, documentNumber: item.document_number, amount: item.amount,
      issuedDate: item.issued_date, opportunityId: item.opportunity_id, opportunityTitle: item.opportunity_title,
      accountId: item.account_id, accountName: item.account_name, contractId: item.contract_id, contractNumber: item.contract_number,
      lines: deliveryLines.results.filter((line) => line.document_id === item.id).map((line) => ({ id: line.id, description: line.description,
        quantity: line.quantity, unit: line.unit, unitPrice: line.unit_price, catalogCode: line.catalog_code ?? "", catalogName: line.catalog_name ?? "" })) })),
    employees: employees.results.map((item) => ({ employeeId: item.employee_id, name: item.name, position: item.position })),
    contacts: contacts.results.map((item) => ({ id: item.id, accountId: item.account_id, name: item.name, title: item.title, email: item.email, phone: item.phone })),
    products: products.results, warehouses: warehouses.results,
  });
}

export async function POST(request: Request) {
  await ensureSalesServiceSchema(db);
  const authorization = await authorizeErpRequest(db, "sales", "write");
  if (authorization.response) return authorization.response;
  const body = await request.json() as Record<string, unknown>;
  const action = String(body.action ?? ""); const now = Date.now();

  if (action === "CREATE_POLICY") {
    const name = String(body.name ?? "").trim().slice(0, 120); const priority = String(body.priority ?? "");
    const firstResponseHours = Number(body.firstResponseHours); const resolutionHours = Number(body.resolutionHours);
    const effectiveFrom = String(body.effectiveFrom ?? ""); const effectiveTo = String(body.effectiveTo ?? "");
    if (name.length < 2 || !priorities.has(priority) || !Number.isSafeInteger(firstResponseHours) || firstResponseHours < 1 || firstResponseHours > 8760
      || !Number.isSafeInteger(resolutionHours) || resolutionHours < firstResponseHours || resolutionHours > 8760
      || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom) || (effectiveTo && (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo) || effectiveTo < effectiveFrom))) {
      return Response.json({ error: "정책명·우선순위·응답/해결시간·적용기간을 확인해 주세요." }, { status: 400 });
    }
    const version = Number((await db.prepare("SELECT MAX(version) AS version FROM sales_service_policies WHERE name = ?").bind(name).first<{ version: number | null }>())?.version ?? 0) + 1;
    const id = crypto.randomUUID();
    await db.prepare(`INSERT INTO sales_service_policies
      (id, name, version, priority, first_response_hours, resolution_hours, effective_from, effective_to, status,
        created_by, approved_by, approved_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, '', NULL, ?, ?)`)
      .bind(id, name, version, priority, firstResponseHours, resolutionHours, effectiveFrom, effectiveTo, authorization.principal.employeeId, now, now).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SALES_SERVICE_POLICY_CREATED",
      entityType: "salesServicePolicy", entityId: id, after: { name, version, priority, firstResponseHours, resolutionHours, effectiveFrom, effectiveTo } });
    return Response.json({ id }, { status: 201 });
  }

  if (action === "SUBMIT_POLICY") {
    const id = String(body.id ?? ""); const policy = await db.prepare("SELECT * FROM sales_service_policies WHERE id = ?").bind(id).first<PolicyRow>();
    if (!policy || policy.status !== "DRAFT") return Response.json({ error: "작성 중 SLA 정책만 제출할 수 있습니다." }, { status: 409 });
    await db.prepare("UPDATE sales_service_policies SET status = 'SUBMITTED', updated_at = ? WHERE id = ? AND status = 'DRAFT'").bind(now, id).run();
    try {
      const approval = await createApprovalRequest(db, authorization.principal, { module: "sales", requestType: "SERVICE_POLICY",
        title: `${policy.name} v${policy.version} SLA 승인`, description: `${policy.priority} · 최초응답 ${policy.first_response_hours}시간 · 해결 ${policy.resolution_hours}시간`,
        targetEntityType: "SALES_SERVICE_POLICY", targetEntityId: id, metadata: toPolicy(policy) });
      await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SALES_SERVICE_POLICY_SUBMITTED",
        entityType: "salesServicePolicy", entityId: id, after: { approvalId: approval.id } });
      return Response.json({ approvalId: approval.id }, { status: 202 });
    } catch (error) {
      await db.prepare("UPDATE sales_service_policies SET status = 'DRAFT', updated_at = ? WHERE id = ? AND status = 'SUBMITTED'").bind(Date.now(), id).run();
      return Response.json({ error: error instanceof Error ? error.message : "SLA 결재선을 만들지 못했습니다." }, { status: 409 });
    }
  }

  if (action === "CREATE_CASE") {
    const deliveryDocumentId = String(body.deliveryDocumentId ?? ""); const category = String(body.category ?? "");
    const priority = String(body.priority ?? ""); const subject = String(body.subject ?? "").trim().slice(0, 200);
    const description = String(body.description ?? "").trim().slice(0, 2000); const ownerEmployeeId = String(body.ownerEmployeeId ?? "");
    const contactId = String(body.contactId ?? "");
    const [delivery, employee] = await Promise.all([
      db.prepare(`SELECT delivery.id, delivery.opportunity_id, delivery.amount, opportunity.account_id,
        COALESCE(contract.id, '') AS contract_id FROM sales_documents delivery
        JOIN sales_opportunities opportunity ON opportunity.id = delivery.opportunity_id
        LEFT JOIN sales_documents source_order ON source_order.id = delivery.source_document_id AND source_order.document_type = 'ORDER'
        LEFT JOIN sales_contracts contract ON contract.order_document_id = source_order.id
        WHERE delivery.id = ? AND delivery.document_type = 'DELIVERY' AND delivery.status IN ('ACCEPTED','COMPLETED')`)
        .bind(deliveryDocumentId).first<{ id: string; opportunity_id: string; amount: number; account_id: string; contract_id: string }>(),
      activeEmployee(ownerEmployeeId),
    ]);
    if (!delivery || !categories.has(category) || !priorities.has(priority) || subject.length < 3 || description.length < 10 || !employee) {
      return Response.json({ error: "확정 납품·유형·우선순위·제목·10자 이상의 내용·재직 담당자를 확인해 주세요." }, { status: 400 });
    }
    if (contactId && !await db.prepare("SELECT id FROM sales_account_contacts WHERE id = ? AND account_id = ? AND status = 'ACTIVE'").bind(contactId, delivery.account_id).first()) {
      return Response.json({ error: "해당 거래처의 활성 담당자를 선택해 주세요." }, { status: 400 });
    }
    const openedAt = now; const openedDate = koreaDate(openedAt);
    const policy = await db.prepare(`SELECT * FROM sales_service_policies WHERE priority = ? AND status = 'ACTIVE'
      AND effective_from <= ? AND (effective_to = '' OR effective_to >= ?) ORDER BY version DESC LIMIT 1`)
      .bind(priority, openedDate, openedDate).first<PolicyRow>();
    const firstResponseDueAt = policy ? openedAt + policy.first_response_hours * 3_600_000 : parseTimestamp(body.firstResponseDueAt);
    const resolutionDueAt = policy ? openedAt + policy.resolution_hours * 3_600_000 : parseTimestamp(body.resolutionDueAt);
    if (!firstResponseDueAt || !resolutionDueAt || firstResponseDueAt <= openedAt || resolutionDueAt < firstResponseDueAt) {
      return Response.json({ error: "활성 SLA가 없어 최초응답과 해결기한을 직접 입력해야 합니다." }, { status: 409 });
    }
    const id = crypto.randomUUID(); const caseNumber = `CS-${openedDate.replaceAll("-", "")}-${id.slice(0, 6).toUpperCase()}`;
    await db.batch([
      db.prepare(`INSERT INTO sales_service_cases
        (id, case_number, account_id, opportunity_id, delivery_document_id, contract_id, contact_id, category, priority,
          subject, description, policy_id, opened_at, first_response_due_at, resolution_due_at, first_responded_at,
          status, owner_employee_id, resolution_type, resolution_note, refund_amount, approval_request_id, finance_request_id,
          resolved_by, resolved_at, closed_by, closed_at, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'OPEN', ?, '', '', 0, '', '', '', NULL, '', NULL, ?, ?, ?)`)
        .bind(id, caseNumber, delivery.account_id, delivery.opportunity_id, delivery.id, delivery.contract_id, contactId,
          category, priority, subject, description, policy?.id ?? "", openedAt, firstResponseDueAt, resolutionDueAt,
          ownerEmployeeId, authorization.principal.employeeId, now, now),
      db.prepare(`INSERT INTO sales_service_case_events (id, case_id, event_type, note, actor_employee_id, created_at)
        VALUES (?, ?, 'CREATED', ?, ?, ?)`).bind(crypto.randomUUID(), id, description, authorization.principal.employeeId, now),
    ]);
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SALES_SERVICE_CASE_CREATED",
      entityType: "salesServiceCase", entityId: id, after: { caseNumber, deliveryDocumentId, category, priority, ownerEmployeeId, policyId: policy?.id ?? "", firstResponseDueAt, resolutionDueAt } });
    return Response.json({ id, caseNumber }, { status: 201 });
  }

  if (action === "ADD_NOTE") {
    const caseId = String(body.caseId ?? ""); const note = String(body.note ?? "").trim().slice(0, 2000); const firstResponse = Boolean(body.firstResponse);
    const serviceCase = await db.prepare("SELECT * FROM sales_service_cases WHERE id = ?").bind(caseId).first<CaseRow>();
    if (!serviceCase || !["OPEN", "IN_PROGRESS"].includes(serviceCase.status) || note.length < 3) return Response.json({ error: "진행 중 케이스와 3자 이상의 기록을 확인해 주세요." }, { status: 409 });
    await db.batch([
      db.prepare(`INSERT INTO sales_service_case_events (id, case_id, event_type, note, actor_employee_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), caseId, firstResponse ? "FIRST_RESPONSE" : "NOTE", note, authorization.principal.employeeId, now),
      db.prepare(`UPDATE sales_service_cases SET status = 'IN_PROGRESS', first_responded_at = CASE WHEN ? = 1 AND first_responded_at IS NULL THEN ? ELSE first_responded_at END,
        updated_at = ? WHERE id = ? AND status IN ('OPEN','IN_PROGRESS')`).bind(firstResponse ? 1 : 0, now, now, caseId),
    ]);
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: firstResponse ? "SALES_SERVICE_FIRST_RESPONSE" : "SALES_SERVICE_NOTE_ADDED",
      entityType: "salesServiceCase", entityId: caseId, after: { note, firstResponse } });
    return Response.json({ ok: true });
  }

  if (action === "ADD_RETURN_LINE") {
    const caseId = String(body.caseId ?? ""); const deliveryLineId = String(body.deliveryLineId ?? "");
    const quantityMilli = Math.round(Number(body.quantity) * 1000); const disposition = String(body.disposition ?? "");
    const source = await db.prepare(`SELECT service.id AS case_id, service.category, service.status, line.quantity,
      COALESCE((SELECT SUM(existing.quantity_milli) FROM sales_service_return_lines existing
        JOIN sales_service_cases other_case ON other_case.id = existing.case_id
        WHERE existing.delivery_line_id = line.id AND other_case.status <> 'CANCELLED'), 0) AS reserved_milli
      FROM sales_service_cases service JOIN sales_document_lines line ON line.document_id = service.delivery_document_id
      WHERE service.id = ? AND line.id = ?`).bind(caseId, deliveryLineId)
      .first<{ case_id: string; category: string; status: string; quantity: number; reserved_milli: number }>();
    if (!source || !["RETURN", "EXCHANGE", "REFUND"].includes(source.category) || !["OPEN", "IN_PROGRESS"].includes(source.status)
      || !Number.isSafeInteger(quantityMilli) || quantityMilli <= 0 || !dispositions.has(disposition)
      || quantityMilli > Math.round(source.quantity * 1000) - Number(source.reserved_milli)) {
      return Response.json({ error: "처리 중 반품·교환·환불 케이스, 원 납품행, 가용 수량과 처리방식을 확인해 주세요." }, { status: 409 });
    }
    const id = crypto.randomUUID();
    try {
      const insertion = await db.prepare(`INSERT INTO sales_service_return_lines
        (id, case_id, delivery_line_id, quantity_milli, disposition, inventory_movement_id, received_by, received_at, created_at, updated_at)
        SELECT ?, service.id, source_line.id, ?, ?, '', '', NULL, ?, ?
        FROM sales_service_cases service JOIN sales_document_lines source_line ON source_line.document_id = service.delivery_document_id
        WHERE service.id = ? AND source_line.id = ? AND service.status IN ('OPEN','IN_PROGRESS')
          AND ? <= ROUND(source_line.quantity * 1000) - COALESCE((
            SELECT SUM(existing.quantity_milli) FROM sales_service_return_lines existing
            JOIN sales_service_cases existing_case ON existing_case.id = existing.case_id
            WHERE existing.delivery_line_id = source_line.id AND existing_case.status <> 'CANCELLED'
          ), 0)`).bind(id, quantityMilli, disposition, now, now, caseId, deliveryLineId, quantityMilli).run();
      if ((insertion.meta.changes ?? 0) !== 1) return Response.json({ error: "원 납품행의 가용 수량을 초과했거나 유효하지 않은 반품행입니다." }, { status: 409 });
    } catch (error) {
      if (String(error).includes("UNIQUE")) return Response.json({ error: "같은 납품행은 한 케이스에 한 번만 추가할 수 있습니다." }, { status: 409 });
      throw error;
    }
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SALES_SERVICE_RETURN_LINE_ADDED",
      entityType: "salesServiceReturnLine", entityId: id, after: { caseId, deliveryLineId, quantity: quantityMilli / 1000, disposition } });
    return Response.json({ id }, { status: 201 });
  }

  if (action === "REMOVE_RETURN_LINE") {
    const lineId = String(body.lineId ?? "");
    const line = await db.prepare(`SELECT return_line.*, service.status AS case_status FROM sales_service_return_lines return_line
      JOIN sales_service_cases service ON service.id = return_line.case_id WHERE return_line.id = ?`).bind(lineId)
      .first<ReturnRow & { case_status: string }>();
    if (!line || !["OPEN", "IN_PROGRESS"].includes(line.case_status) || line.inventory_movement_id) {
      return Response.json({ error: "처리안 제출 전 미입고 반품행만 제거할 수 있습니다." }, { status: 409 });
    }
    await db.prepare("DELETE FROM sales_service_return_lines WHERE id = ? AND inventory_movement_id = ''").bind(lineId).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SALES_SERVICE_RETURN_LINE_REMOVED",
      entityType: "salesServiceReturnLine", entityId: lineId, before: { caseId: line.case_id, deliveryLineId: line.delivery_line_id, quantity: line.quantity_milli / 1000, disposition: line.disposition }, after: null });
    return Response.json({ ok: true });
  }

  if (action === "SUBMIT_RESOLUTION") {
    const caseId = String(body.caseId ?? ""); const resolutionType = String(body.resolutionType ?? "");
    const resolutionNote = String(body.resolutionNote ?? "").trim().slice(0, 2000); const refundAmount = Math.round(Number(body.refundAmount ?? 0));
    const serviceCase = await db.prepare(`SELECT service.*, delivery.amount AS delivery_amount FROM sales_service_cases service
      JOIN sales_documents delivery ON delivery.id = service.delivery_document_id WHERE service.id = ?`).bind(caseId).first<CaseRow & { delivery_amount: number }>();
    if (!serviceCase || !["OPEN", "IN_PROGRESS"].includes(serviceCase.status) || !serviceCase.first_responded_at
      || !["NO_ACTION", "REPAIR", "RETURN", "EXCHANGE", "REFUND", "CREDIT"].includes(resolutionType)
      || resolutionNote.length < 10 || !Number.isSafeInteger(refundAmount) || refundAmount < 0 || refundAmount > serviceCase.delivery_amount) {
      return Response.json({ error: "최초응답, 처리유형, 10자 이상의 처리근거와 납품금액 이하 환불액을 확인해 주세요." }, { status: 409 });
    }
    const [lineCount, evidence, reservedRefund] = await Promise.all([
      db.prepare("SELECT COUNT(*) AS count FROM sales_service_return_lines WHERE case_id = ?").bind(caseId).first<{ count: number }>(),
      db.prepare(`SELECT id FROM erp_documents WHERE module = 'sales' AND entity_type = 'salesServiceCase' AND entity_id = ?
        AND category = 'SERVICE_EVIDENCE' AND deleted_at IS NULL LIMIT 1`).bind(caseId).first<{ id: string }>(),
      db.prepare(`SELECT COALESCE(SUM(refund_amount), 0) AS amount FROM sales_service_cases
        WHERE delivery_document_id = ? AND id <> ? AND status IN ('RESOLUTION_SUBMITTED','RESOLUTION_APPROVED','RESOLVED','CLOSED')`)
        .bind(serviceCase.delivery_document_id, caseId).first<{ amount: number }>(),
    ]);
    if (["RETURN", "EXCHANGE", "REFUND"].includes(serviceCase.category) && Number(lineCount?.count ?? 0) < 1) return Response.json({ error: "반품·교환·환불 대상 납품행을 먼저 등록해 주세요." }, { status: 409 });
    if (!evidence) return Response.json({ error: "처리 근거 문서를 1개 이상 첨부해 주세요." }, { status: 409 });
    if ((serviceCase.category === "REFUND" || resolutionType === "REFUND") && refundAmount <= 0) return Response.json({ error: "환불 처리에는 0원 초과 환불금액이 필요합니다." }, { status: 409 });
    if (refundAmount > serviceCase.delivery_amount - Number(reservedRefund?.amount ?? 0)) return Response.json({ error: "같은 납품의 승인·결재 중 환불액을 포함하면 납품금액을 초과합니다." }, { status: 409 });
    const transition = await db.prepare(`UPDATE sales_service_cases SET status = 'RESOLUTION_SUBMITTED', resolution_type = ?, resolution_note = ?, refund_amount = ?, updated_at = ?
      WHERE id = ? AND status IN ('OPEN','IN_PROGRESS') AND ? <= (
        SELECT delivery.amount - COALESCE((SELECT SUM(other.refund_amount) FROM sales_service_cases other
          WHERE other.delivery_document_id = sales_service_cases.delivery_document_id AND other.id <> sales_service_cases.id
            AND other.status IN ('RESOLUTION_SUBMITTED','RESOLUTION_APPROVED','RESOLVED','CLOSED')), 0)
        FROM sales_documents delivery WHERE delivery.id = sales_service_cases.delivery_document_id
      )`).bind(resolutionType, resolutionNote, refundAmount, now, caseId, refundAmount).run();
    if ((transition.meta.changes ?? 0) !== 1) return Response.json({ error: "처리안 제출 중 상태가 변경되었거나 같은 납품의 누적 환불액이 납품금액을 초과합니다." }, { status: 409 });
    try {
      const approval = await createApprovalRequest(db, authorization.principal, { module: "sales", requestType: "SERVICE_RESOLUTION",
        title: `${serviceCase.case_number} 고객 이슈 처리 승인`, description: `${serviceCase.category} · ${resolutionType} · ${resolutionNote}`,
        targetEntityType: "SALES_SERVICE_CASE", targetEntityId: caseId, amount: refundAmount, priority: serviceCase.priority as "LOW" | "NORMAL" | "HIGH" | "CRITICAL",
        dueDate: koreaDate(serviceCase.resolution_due_at), metadata: { category: serviceCase.category, resolutionType, refundAmount, evidenceDocumentId: evidence.id } });
      await db.prepare("UPDATE sales_service_cases SET approval_request_id = ?, updated_at = ? WHERE id = ? AND status = 'RESOLUTION_SUBMITTED'").bind(approval.id, now, caseId).run();
      await db.prepare(`INSERT INTO sales_service_case_events (id, case_id, event_type, note, actor_employee_id, created_at)
        VALUES (?, ?, 'RESOLUTION_SUBMITTED', ?, ?, ?)`).bind(crypto.randomUUID(), caseId, resolutionNote, authorization.principal.employeeId, now).run();
      await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SALES_SERVICE_RESOLUTION_SUBMITTED",
        entityType: "salesServiceCase", entityId: caseId, after: { resolutionType, resolutionNote, refundAmount, approvalId: approval.id } });
      return Response.json({ approvalId: approval.id }, { status: 202 });
    } catch (error) {
      await db.prepare("UPDATE sales_service_cases SET status = 'IN_PROGRESS', approval_request_id = '', updated_at = ? WHERE id = ? AND status = 'RESOLUTION_SUBMITTED'").bind(Date.now(), caseId).run();
      return Response.json({ error: error instanceof Error ? error.message : "처리안 결재선을 만들지 못했습니다." }, { status: 409 });
    }
  }

  if (action === "POST_RETURN_RECEIPT") {
    const financeAuthorization = await authorizeErpRequest(db, "finance", "write");
    if (financeAuthorization.response) return financeAuthorization.response;
    const lineId = String(body.lineId ?? ""); const productId = String(body.productId ?? ""); const warehouseId = String(body.warehouseId ?? "");
    const movementDate = String(body.movementDate ?? ""); const unitCost = Math.round(Number(body.unitCost));
    const [line, product, warehouse, closeRun] = await Promise.all([
      db.prepare(`SELECT return_line.*, service.case_number, service.status AS case_status FROM sales_service_return_lines return_line
        JOIN sales_service_cases service ON service.id = return_line.case_id WHERE return_line.id = ?`).bind(lineId)
        .first<ReturnRow & { case_number: string; case_status: string }>(),
      db.prepare("SELECT id, sku, name FROM inventory_products WHERE id = ? AND status = 'ACTIVE'").bind(productId).first<{ id: string; sku: string; name: string }>(),
      db.prepare("SELECT id, code, name FROM inventory_warehouses WHERE id = ? AND status = 'ACTIVE'").bind(warehouseId).first<{ id: string; code: string; name: string }>(),
      db.prepare("SELECT status FROM finance_close_runs WHERE period = ?").bind(movementDate.slice(0, 7)).first<{ status: string }>(),
    ]);
    if (!line || line.case_status !== "RESOLUTION_APPROVED" || line.disposition !== "RESTOCK" || line.inventory_movement_id
      || !product || !warehouse || !/^\d{4}-\d{2}-\d{2}$/.test(movementDate) || closeRun?.status === "CLOSED"
      || !Number.isSafeInteger(unitCost) || unitCost <= 0) {
      return Response.json({ error: "승인된 재입고행·활성 상품/창고·열린 기간·실제 단가를 확인해 주세요." }, { status: 409 });
    }
    const movementId = crypto.randomUUID(); const amount = Math.round(line.quantity_milli * unitCost / 1000);
    const result = await db.batch([
      db.prepare(`INSERT INTO inventory_movements
        (id, movement_date, movement_type, direction, product_id, warehouse_id, quantity_milli, unit_cost, amount,
          source_type, source_id, source_line_key, reference_number, reason, posted_by, created_at)
        SELECT ?, ?, 'SALES_RETURN_IN', 'IN', ?, ?, ?, ?, ?, 'SALES_RETURN', ?, ?, ?, ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM sales_service_return_lines return_line JOIN sales_service_cases service ON service.id = return_line.case_id
          WHERE return_line.id = ? AND return_line.inventory_movement_id = '' AND return_line.disposition = 'RESTOCK' AND service.status = 'RESOLUTION_APPROVED')`)
        .bind(movementId, movementDate, productId, warehouseId, line.quantity_milli, unitCost, amount, line.case_id, lineId,
          line.case_number, `승인 고객 반품 ${line.case_number}`, financeAuthorization.principal.employeeId, now, lineId),
      db.prepare(`UPDATE sales_service_return_lines SET inventory_movement_id = ?, received_by = ?, received_at = ?, updated_at = ?
        WHERE id = ? AND inventory_movement_id = '' AND EXISTS (SELECT 1 FROM inventory_movements WHERE id = ? AND created_at = ?)`)
        .bind(movementId, financeAuthorization.principal.employeeId, now, now, lineId, movementId, now),
    ]);
    if ((result[0].meta.changes ?? 0) !== 1 || (result[1].meta.changes ?? 0) !== 1) return Response.json({ error: "반품행 상태가 바뀌어 재입고하지 못했습니다." }, { status: 409 });
    await writeErpAudit(db, { principal: financeAuthorization.principal, module: "finance", action: "SALES_RETURN_INVENTORY_POSTED",
      entityType: "inventoryMovement", entityId: movementId, after: { caseId: line.case_id, lineId, productId, warehouseId, quantity: line.quantity_milli / 1000, unitCost, amount } });
    return Response.json({ movementId }, { status: 201 });
  }

  if (action === "CANCEL_CASE") {
    const caseId = String(body.caseId ?? ""); const reason = String(body.reason ?? "").trim().slice(0, 1000);
    const serviceCase = await db.prepare("SELECT * FROM sales_service_cases WHERE id = ?").bind(caseId).first<CaseRow>();
    if (!serviceCase || !["OPEN", "IN_PROGRESS"].includes(serviceCase.status) || reason.length < 5) return Response.json({ error: "결재 전 케이스와 5자 이상의 취소 사유를 확인해 주세요." }, { status: 409 });
    await db.batch([
      db.prepare("UPDATE sales_service_cases SET status = 'CANCELLED', updated_at = ? WHERE id = ? AND status IN ('OPEN','IN_PROGRESS')").bind(now, caseId),
      db.prepare(`INSERT INTO sales_service_case_events (id, case_id, event_type, note, actor_employee_id, created_at)
        VALUES (?, ?, 'CANCELLED', ?, ?, ?)`).bind(crypto.randomUUID(), caseId, reason, authorization.principal.employeeId, now),
    ]);
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SALES_SERVICE_CASE_CANCELLED", entityType: "salesServiceCase", entityId: caseId, before: toCase(serviceCase), after: { status: "CANCELLED" }, reason });
    return Response.json({ ok: true });
  }

  if (action === "CLOSE_CASE") {
    const caseId = String(body.caseId ?? ""); const closureNote = String(body.closureNote ?? "").trim().slice(0, 1000);
    const serviceCase = await db.prepare(`SELECT service.*, expense.status AS finance_status,
      exchange_task.status AS exchange_task_status FROM sales_service_cases service
      LEFT JOIN finance_expense_requests expense ON expense.id = service.finance_request_id
      LEFT JOIN erp_tasks exchange_task ON exchange_task.id = 'sales-service-exchange:' || service.id AND exchange_task.deleted_at IS NULL
      WHERE service.id = ?`).bind(caseId).first<CaseRow>();
    if (!serviceCase || !["RESOLUTION_APPROVED", "RESOLVED"].includes(serviceCase.status) || closureNote.length < 5) return Response.json({ error: "승인 처리된 케이스와 5자 이상의 종결 메모가 필요합니다." }, { status: 409 });
    const pendingRestock = await db.prepare("SELECT COUNT(*) AS count FROM sales_service_return_lines WHERE case_id = ? AND disposition = 'RESTOCK' AND inventory_movement_id = ''")
      .bind(caseId).first<{ count: number }>();
    if (Number(pendingRestock?.count ?? 0) > 0) return Response.json({ error: "승인된 반품 재입고가 남아 있습니다." }, { status: 409 });
    const pendingDisposition = await db.prepare(`SELECT COUNT(*) AS count FROM sales_service_return_lines line
      LEFT JOIN erp_tasks task ON task.id = 'sales-service-disposition:' || line.id AND task.deleted_at IS NULL
      WHERE line.case_id = ? AND line.disposition <> 'RESTOCK' AND COALESCE(task.status, '') <> 'DONE'`).bind(caseId).first<{ count: number }>();
    if (Number(pendingDisposition?.count ?? 0) > 0) return Response.json({ error: "격리·폐기·공급사 반송 후속 업무가 남아 있습니다." }, { status: 409 });
    if (serviceCase.refund_amount > 0 && serviceCase.finance_status !== "PAID") return Response.json({ error: "재무 환불 지급이 완료되어야 종결할 수 있습니다." }, { status: 409 });
    if (serviceCase.resolution_type === "EXCHANGE" && serviceCase.exchange_task_status !== "DONE") return Response.json({ error: "교환 대체 납품 업무가 완료되어야 종결할 수 있습니다." }, { status: 409 });
    await db.batch([
      db.prepare("UPDATE sales_service_cases SET status = 'CLOSED', closed_by = ?, closed_at = ?, updated_at = ? WHERE id = ? AND status IN ('RESOLUTION_APPROVED','RESOLVED')")
        .bind(authorization.principal.employeeId, now, now, caseId),
      db.prepare(`INSERT INTO sales_service_case_events (id, case_id, event_type, note, actor_employee_id, created_at)
        VALUES (?, ?, 'CLOSED', ?, ?, ?)`).bind(crypto.randomUUID(), caseId, closureNote, authorization.principal.employeeId, now),
    ]);
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SALES_SERVICE_CASE_CLOSED",
      entityType: "salesServiceCase", entityId: caseId, before: toCase(serviceCase), after: { status: "CLOSED", closureNote } });
    return Response.json({ ok: true });
  }

  return Response.json({ error: "지원하지 않는 고객지원 작업입니다." }, { status: 400 });
}
