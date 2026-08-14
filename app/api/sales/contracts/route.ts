import { env } from "cloudflare:workers";
import { createApprovalRequest } from "../../../approval-engine";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";
import { ensureSalesContractSchema } from "../../../sales-contracts";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;

type ContractRow = {
  id: string; order_document_id: string; contract_number: string; title: string; version: number; amount_snapshot: number;
  currency: string; start_date: string; end_date: string; auto_renewal: number; renewal_notice_days: number;
  payment_terms: string; acceptance_criteria: string; delivery_terms: string; owner_employee_id: string;
  signed_document_id: string; status: string; created_by: string; approved_by: string; approved_at: number | null;
  created_at: number; updated_at: number; order_number?: string | null; account_name?: string | null; opportunity_title?: string | null;
};
type ObligationRow = { id: string; contract_id: string; obligation_type: string; title: string; owner_employee_id: string; due_date: string;
  evidence_required: number; status: string; completion_note: string; completed_by: string; completed_at: number | null; created_at: number; updated_at: number };
type ChangeRow = { id: string; contract_id: string; change_type: string; reason: string; before_json: string; after_json: string;
  effective_date: string; status: string; created_by: string; approval_request_id: string; approved_by: string; approved_at: number | null; created_at: number; updated_at: number };
type DocumentRow = { id: string; entity_type: string; entity_id: string; category: string; version: number; file_name: string; uploaded_by: string; created_at: number };

const contractSelect = `SELECT contract.*, order_doc.document_number AS order_number, account.name AS account_name,
  opportunity.title AS opportunity_title FROM sales_contracts contract
  JOIN sales_documents order_doc ON order_doc.id = contract.order_document_id
  JOIN sales_opportunities opportunity ON opportunity.id = order_doc.opportunity_id
  LEFT JOIN sales_accounts account ON account.id = opportunity.account_id`;
const toContract = (row: ContractRow) => ({ id: row.id, orderDocumentId: row.order_document_id, orderNumber: row.order_number ?? "",
  accountName: row.account_name ?? "", opportunityTitle: row.opportunity_title ?? "", contractNumber: row.contract_number,
  title: row.title, version: row.version, amountSnapshot: row.amount_snapshot, currency: row.currency, startDate: row.start_date,
  endDate: row.end_date, autoRenewal: Boolean(row.auto_renewal), renewalNoticeDays: row.renewal_notice_days,
  paymentTerms: row.payment_terms, acceptanceCriteria: row.acceptance_criteria, deliveryTerms: row.delivery_terms,
  ownerEmployeeId: row.owner_employee_id, signedDocumentId: row.signed_document_id, status: row.status,
  createdBy: row.created_by, approvedBy: row.approved_by, approvedAt: row.approved_at, createdAt: row.created_at, updatedAt: row.updated_at });
const toObligation = (row: ObligationRow) => ({ id: row.id, contractId: row.contract_id, obligationType: row.obligation_type,
  title: row.title, ownerEmployeeId: row.owner_employee_id, dueDate: row.due_date, evidenceRequired: Boolean(row.evidence_required),
  status: row.status, completionNote: row.completion_note, completedBy: row.completed_by, completedAt: row.completed_at });
const parseObject = (value: string) => { try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" ? parsed : {}; } catch { return {}; } };
const toChange = (row: ChangeRow) => ({ id: row.id, contractId: row.contract_id, changeType: row.change_type, reason: row.reason,
  before: parseObject(row.before_json), after: parseObject(row.after_json), effectiveDate: row.effective_date, status: row.status,
  createdBy: row.created_by, approvalRequestId: row.approval_request_id, approvedBy: row.approved_by, approvedAt: row.approved_at, createdAt: row.created_at });

async function activeEmployee(employeeId: string) {
  return db.prepare("SELECT employee_id FROM hr_employee_records WHERE employee_id = ? AND status NOT IN ('퇴직','입사 예정')")
    .bind(employeeId).first<{ employee_id: string }>();
}

export async function GET() {
  await ensureSalesContractSchema(db);
  const authorization = await authorizeErpRequest(db, "sales", "read");
  if (authorization.response) return authorization.response;
  const [contracts, obligations, changes, orders, employees, documents, settings] = await Promise.all([
    db.prepare(`${contractSelect} ORDER BY CASE contract.status WHEN 'ACTIVE' THEN 0 WHEN 'SUBMITTED' THEN 1 WHEN 'DRAFT' THEN 2 ELSE 3 END, contract.end_date`).all<ContractRow>(),
    db.prepare("SELECT * FROM sales_contract_obligations ORDER BY due_date, created_at").all<ObligationRow>(),
    db.prepare("SELECT * FROM sales_contract_change_requests ORDER BY created_at DESC").all<ChangeRow>(),
    db.prepare(`SELECT document.id, document.document_number, document.amount, document.status, document.created_at,
      account.name AS account_name, opportunity.title AS opportunity_title
      FROM sales_documents document JOIN sales_opportunities opportunity ON opportunity.id = document.opportunity_id
      LEFT JOIN sales_accounts account ON account.id = opportunity.account_id
      WHERE document.document_type = 'ORDER' AND document.status IN ('ACCEPTED','COMPLETED')
        AND NOT EXISTS (SELECT 1 FROM sales_contracts contract WHERE contract.order_document_id = document.id)
      ORDER BY document.created_at DESC`).all<{ id: string; document_number: string; amount: number; status: string; created_at: number; account_name: string | null; opportunity_title: string | null }>(),
    db.prepare("SELECT employee_id, name, position FROM hr_employee_records WHERE status NOT IN ('퇴직','입사 예정') ORDER BY name")
      .all<{ employee_id: string; name: string; position: string }>(),
    db.prepare(`SELECT id, entity_type, entity_id, category, version, file_name, uploaded_by, created_at FROM erp_documents
      WHERE module = 'sales' AND entity_type IN ('salesContract','salesContractObligation') AND deleted_at IS NULL
      ORDER BY created_at DESC`).all<DocumentRow>(),
    db.prepare("SELECT enforcement_started_at FROM sales_contract_governance_settings WHERE id = 'default'").first<{ enforcement_started_at: number }>(),
  ]);
  return Response.json({
    enforcementStartedAt: Number(settings?.enforcement_started_at ?? 0),
    contracts: contracts.results.map((contract) => ({ ...toContract(contract),
      obligations: obligations.results.filter((item) => item.contract_id === contract.id).map(toObligation),
      changes: changes.results.filter((item) => item.contract_id === contract.id).map(toChange) })),
    eligibleOrders: orders.results.map((row) => ({ id: row.id, documentNumber: row.document_number, amount: row.amount,
      status: row.status, createdAt: row.created_at, accountName: row.account_name ?? "", opportunityTitle: row.opportunity_title ?? "" })),
    employees: employees.results.map((row) => ({ employeeId: row.employee_id, name: row.name, position: row.position })),
    documents: documents.results.map((row) => ({ id: row.id, entityType: row.entity_type, entityId: row.entity_id,
      category: row.category, version: row.version, fileName: row.file_name, uploadedBy: row.uploaded_by,
      createdAt: row.created_at, downloadUrl: `/api/documents?downloadId=${encodeURIComponent(row.id)}` })),
  });
}

export async function POST(request: Request) {
  await ensureSalesContractSchema(db);
  const authorization = await authorizeErpRequest(db, "sales", "write");
  if (authorization.response) return authorization.response;
  const body = await request.json() as Record<string, unknown>;
  const action = String(body.action ?? ""); const now = Date.now();

  if (action === "CREATE_CONTRACT") {
    const orderDocumentId = String(body.orderDocumentId ?? ""); const contractNumber = String(body.contractNumber ?? "").trim().slice(0, 80);
    const title = String(body.title ?? "").trim().slice(0, 200); const startDate = String(body.startDate ?? ""); const endDate = String(body.endDate ?? "");
    const autoRenewal = body.autoRenewal ? 1 : 0; const renewalNoticeDays = Number(body.renewalNoticeDays ?? 30);
    const paymentTerms = String(body.paymentTerms ?? "").trim().slice(0, 1000); const acceptanceCriteria = String(body.acceptanceCriteria ?? "").trim().slice(0, 1000);
    const deliveryTerms = String(body.deliveryTerms ?? "").trim().slice(0, 1000); const ownerEmployeeId = String(body.ownerEmployeeId ?? "");
    const [order, employee] = await Promise.all([
      db.prepare("SELECT id, amount FROM sales_documents WHERE id = ? AND document_type = 'ORDER' AND status IN ('ACCEPTED','COMPLETED')")
        .bind(orderDocumentId).first<{ id: string; amount: number }>(), activeEmployee(ownerEmployeeId),
    ]);
    if (!order || contractNumber.length < 2 || title.length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)
      || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < startDate || !Number.isSafeInteger(renewalNoticeDays)
      || renewalNoticeDays < 0 || renewalNoticeDays > 3650 || [paymentTerms, acceptanceCriteria, deliveryTerms].some((value) => value.length < 5) || !employee) {
      return Response.json({ error: "승인 수주·계약번호·기간·대금/검수/납품조건·재직 담당자를 확인해 주세요." }, { status: 400 });
    }
    const id = crypto.randomUUID();
    try {
      await db.prepare(`INSERT INTO sales_contracts
        (id, order_document_id, contract_number, title, version, amount_snapshot, currency, start_date, end_date,
          auto_renewal, renewal_notice_days, payment_terms, acceptance_criteria, delivery_terms, owner_employee_id,
          signed_document_id, status, created_by, approved_by, approved_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, 'KRW', ?, ?, ?, ?, ?, ?, ?, ?, '', 'DRAFT', ?, '', NULL, ?, ?)`)
        .bind(id, orderDocumentId, contractNumber, title, order.amount, startDate, endDate, autoRenewal, renewalNoticeDays,
          paymentTerms, acceptanceCriteria, deliveryTerms, ownerEmployeeId, authorization.principal.employeeId, now, now).run();
    } catch (error) {
      if (String(error).includes("UNIQUE")) return Response.json({ error: "이미 계약이 연결된 수주이거나 사용 중인 계약번호입니다." }, { status: 409 });
      throw error;
    }
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SALES_CONTRACT_CREATED",
      entityType: "salesContract", entityId: id, after: { orderDocumentId, contractNumber, title, amountSnapshot: order.amount, startDate, endDate } });
    return Response.json({ id }, { status: 201 });
  }

  if (action === "ADD_OBLIGATION") {
    const contractId = String(body.contractId ?? ""); const obligationType = String(body.obligationType ?? "");
    const title = String(body.title ?? "").trim().slice(0, 300); const ownerEmployeeId = String(body.ownerEmployeeId ?? ""); const dueDate = String(body.dueDate ?? "");
    const [contract, employee] = await Promise.all([
      db.prepare("SELECT id, status, start_date, end_date FROM sales_contracts WHERE id = ?").bind(contractId).first<{ id: string; status: string; start_date: string; end_date: string }>(),
      activeEmployee(ownerEmployeeId),
    ]);
    if (!contract || contract.status !== "DRAFT" || !["DELIVERY", "ACCEPTANCE", "INVOICE", "PAYMENT", "CUSTOM"].includes(obligationType)
      || title.length < 3 || !employee || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || dueDate < contract.start_date || dueDate > contract.end_date) {
      return Response.json({ error: "작성 중 계약·의무 유형·내용·재직 담당자·계약기간 내 기한을 확인해 주세요." }, { status: 400 });
    }
    const id = crypto.randomUUID();
    await db.prepare(`INSERT INTO sales_contract_obligations
      (id, contract_id, obligation_type, title, owner_employee_id, due_date, evidence_required, status,
        completion_note, completed_by, completed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', '', '', NULL, ?, ?)`)
      .bind(id, contractId, obligationType, title, ownerEmployeeId, dueDate, body.evidenceRequired === false ? 0 : 1, now, now).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SALES_CONTRACT_OBLIGATION_ADDED",
      entityType: "salesContractObligation", entityId: id, after: { contractId, obligationType, title, ownerEmployeeId, dueDate } });
    return Response.json({ id }, { status: 201 });
  }

  if (action === "SUBMIT_CONTRACT") {
    const contractId = String(body.contractId ?? "");
    const contract = await db.prepare("SELECT * FROM sales_contracts WHERE id = ?").bind(contractId).first<ContractRow>();
    if (!contract || contract.status !== "DRAFT") return Response.json({ error: "작성 중 계약만 제출할 수 있습니다." }, { status: 409 });
    const [obligation, signedDocument] = await Promise.all([
      db.prepare("SELECT COUNT(*) AS count FROM sales_contract_obligations WHERE contract_id = ?").bind(contractId).first<{ count: number }>(),
      db.prepare(`SELECT id FROM erp_documents WHERE module = 'sales' AND entity_type = 'salesContract' AND entity_id = ?
        AND category = 'SIGNED_CONTRACT' AND deleted_at IS NULL ORDER BY version DESC, created_at DESC LIMIT 1`).bind(contractId).first<{ id: string }>(),
    ]);
    if (Number(obligation?.count ?? 0) < 1 || !signedDocument) return Response.json({ error: "서명 계약서와 최소 1개의 이행 의무를 등록한 뒤 제출해 주세요." }, { status: 409 });
    const updated = await db.prepare("UPDATE sales_contracts SET status = 'SUBMITTED', signed_document_id = ?, updated_at = ? WHERE id = ? AND status = 'DRAFT'")
      .bind(signedDocument.id, now, contractId).run();
    if ((updated.meta.changes ?? 0) !== 1) return Response.json({ error: "다른 사용자가 계약 상태를 먼저 변경했습니다." }, { status: 409 });
    try {
      const approval = await createApprovalRequest(db, authorization.principal, { module: "sales", requestType: "CONTRACT",
        title: `${contract.contract_number} 계약 활성화 승인`, description: `${contract.title} · ${contract.start_date}~${contract.end_date}`,
        targetEntityType: "SALES_CONTRACT", targetEntityId: contractId, amount: contract.amount_snapshot,
        metadata: { contractNumber: contract.contract_number, version: contract.version, signedDocumentId: signedDocument.id } });
      await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SALES_CONTRACT_SUBMITTED",
        entityType: "salesContract", entityId: contractId, before: toContract(contract), after: { approvalId: approval.id, signedDocumentId: signedDocument.id } });
      return Response.json({ approvalId: approval.id }, { status: 202 });
    } catch (error) {
      await db.prepare("UPDATE sales_contracts SET status = 'DRAFT', signed_document_id = '', updated_at = ? WHERE id = ? AND status = 'SUBMITTED'").bind(Date.now(), contractId).run();
      return Response.json({ error: error instanceof Error ? error.message : "계약 결재선을 만들지 못했습니다." }, { status: 409 });
    }
  }

  if (action === "UPDATE_OBLIGATION") {
    const id = String(body.id ?? ""); const status = String(body.status ?? ""); const completionNote = String(body.completionNote ?? "").trim().slice(0, 1000);
    const obligation = await db.prepare(`SELECT obligation.*, contract.status AS contract_status FROM sales_contract_obligations obligation
      JOIN sales_contracts contract ON contract.id = obligation.contract_id WHERE obligation.id = ?`).bind(id)
      .first<ObligationRow & { contract_status: string }>();
    if (!obligation || obligation.contract_status !== "ACTIVE" || !["OPEN", "IN_PROGRESS"].includes(obligation.status)
      || !["IN_PROGRESS", "COMPLETED"].includes(status) || (status === "COMPLETED" && completionNote.length < 5)) {
      return Response.json({ error: "활성 계약의 진행 중 의무만 변경할 수 있으며 완료 근거를 5자 이상 입력해야 합니다." }, { status: 409 });
    }
    if (status === "COMPLETED" && obligation.evidence_required) {
      const evidence = await db.prepare(`SELECT id FROM erp_documents WHERE module = 'sales' AND entity_type = 'salesContractObligation'
        AND entity_id = ? AND category = 'OBLIGATION_EVIDENCE' AND deleted_at IS NULL LIMIT 1`).bind(id).first<{ id: string }>();
      if (!evidence) return Response.json({ error: "증빙이 필요한 의무입니다. 근거 파일을 먼저 등록해 주세요." }, { status: 409 });
    }
    await db.prepare(`UPDATE sales_contract_obligations SET status = ?, completion_note = ?, completed_by = ?, completed_at = ?, updated_at = ?
      WHERE id = ? AND status IN ('OPEN','IN_PROGRESS')`).bind(status, completionNote,
        status === "COMPLETED" ? authorization.principal.employeeId : "", status === "COMPLETED" ? now : null, now, id).run();
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: `SALES_CONTRACT_OBLIGATION_${status}`,
      entityType: "salesContractObligation", entityId: id, before: toObligation(obligation), after: { status, completionNote } });
    return Response.json({ ok: true });
  }

  if (action === "APPLY_SCHEDULED_CHANGE") {
    const id = String(body.id ?? ""); const today = new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const change = await db.prepare("SELECT * FROM sales_contract_change_requests WHERE id = ?").bind(id).first<ChangeRow>();
    if (!change || change.status !== "SCHEDULED" || change.effective_date > today) {
      return Response.json({ error: "적용일이 도래한 승인 변경만 반영할 수 있습니다." }, { status: 409 });
    }
    const result = await db.batch([
      db.prepare(`UPDATE sales_contracts SET
        end_date = COALESCE(json_extract(?, '$.endDate'), end_date),
        payment_terms = COALESCE(json_extract(?, '$.paymentTerms'), payment_terms),
        acceptance_criteria = COALESCE(json_extract(?, '$.acceptanceCriteria'), acceptance_criteria),
        delivery_terms = COALESCE(json_extract(?, '$.deliveryTerms'), delivery_terms),
        owner_employee_id = COALESCE(json_extract(?, '$.ownerEmployeeId'), owner_employee_id),
        auto_renewal = COALESCE(CAST(json_extract(?, '$.autoRenewal') AS INTEGER), auto_renewal),
        renewal_notice_days = COALESCE(json_extract(?, '$.renewalNoticeDays'), renewal_notice_days),
        status = COALESCE(json_extract(?, '$.status'), status), version = version + 1, updated_at = ?
        WHERE id = ? AND status = 'ACTIVE' AND EXISTS
          (SELECT 1 FROM sales_contract_change_requests WHERE id = ? AND status = 'SCHEDULED' AND effective_date <= ?)`)
        .bind(change.after_json, change.after_json, change.after_json, change.after_json, change.after_json, change.after_json,
          change.after_json, change.after_json, now, change.contract_id, id, today),
      db.prepare(`UPDATE sales_contract_change_requests SET status = 'APPROVED', updated_at = ? WHERE id = ? AND status = 'SCHEDULED'
        AND EXISTS (SELECT 1 FROM sales_contracts WHERE id = ? AND updated_at = ?)`)
        .bind(now, id, change.contract_id, now),
    ]);
    if ((result[0].meta.changes ?? 0) !== 1 || (result[1].meta.changes ?? 0) !== 1) return Response.json({ error: "계약 상태가 바뀌어 예약 변경을 적용하지 못했습니다." }, { status: 409 });
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SALES_CONTRACT_SCHEDULED_CHANGE_APPLIED",
      entityType: "salesContractChange", entityId: id, before: parseObject(change.before_json), after: parseObject(change.after_json), reason: change.reason });
    return Response.json({ ok: true });
  }

  if (action === "REQUEST_CHANGE") {
    const contractId = String(body.contractId ?? ""); const changeType = String(body.changeType ?? "");
    const reason = String(body.reason ?? "").trim().slice(0, 1000); const effectiveDate = String(body.effectiveDate ?? "");
    const contract = await db.prepare("SELECT * FROM sales_contracts WHERE id = ?").bind(contractId).first<ContractRow>();
    if (!contract || contract.status !== "ACTIVE" || !["PERIOD", "TERMS", "OWNER", "RENEWAL", "TERMINATION"].includes(changeType)
      || reason.length < 10 || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
      return Response.json({ error: "활성 계약·변경 유형·적용일·10자 이상의 변경 사유를 확인해 주세요." }, { status: 400 });
    }
    const pendingChange = await db.prepare("SELECT id FROM sales_contract_change_requests WHERE contract_id = ? AND status IN ('SUBMITTED','SCHEDULED') LIMIT 1")
      .bind(contractId).first<{ id: string }>();
    if (pendingChange) return Response.json({ error: "이미 결재 또는 적용 대기 중인 계약 변경이 있습니다." }, { status: 409 });
    const before = { endDate: contract.end_date, paymentTerms: contract.payment_terms, acceptanceCriteria: contract.acceptance_criteria,
      deliveryTerms: contract.delivery_terms, ownerEmployeeId: contract.owner_employee_id, autoRenewal: Boolean(contract.auto_renewal),
      renewalNoticeDays: contract.renewal_notice_days, status: contract.status };
    let after: Record<string, unknown> = {};
    if (changeType === "PERIOD") {
      const endDate = String(body.endDate ?? ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < contract.start_date) return Response.json({ error: "변경 종료일을 확인해 주세요." }, { status: 400 });
      after = { endDate };
    } else if (changeType === "TERMS") {
      const paymentTerms = String(body.paymentTerms ?? contract.payment_terms).trim().slice(0, 1000);
      const acceptanceCriteria = String(body.acceptanceCriteria ?? contract.acceptance_criteria).trim().slice(0, 1000);
      const deliveryTerms = String(body.deliveryTerms ?? contract.delivery_terms).trim().slice(0, 1000);
      if ([paymentTerms, acceptanceCriteria, deliveryTerms].some((value) => value.length < 5)) return Response.json({ error: "변경 조건을 각각 5자 이상 입력해 주세요." }, { status: 400 });
      after = { paymentTerms, acceptanceCriteria, deliveryTerms };
    } else if (changeType === "OWNER") {
      const ownerEmployeeId = String(body.ownerEmployeeId ?? ""); if (!await activeEmployee(ownerEmployeeId)) return Response.json({ error: "재직 중인 계약 담당자를 선택해 주세요." }, { status: 400 });
      after = { ownerEmployeeId };
    } else if (changeType === "RENEWAL") {
      const renewalNoticeDays = Number(body.renewalNoticeDays); if (!Number.isSafeInteger(renewalNoticeDays) || renewalNoticeDays < 0 || renewalNoticeDays > 3650) return Response.json({ error: "갱신 통지일 수를 확인해 주세요." }, { status: 400 });
      after = { autoRenewal: Boolean(body.autoRenewal), renewalNoticeDays };
    } else after = { status: "TERMINATED", endDate: effectiveDate };
    const id = crypto.randomUUID();
    await db.prepare(`INSERT INTO sales_contract_change_requests
      (id, contract_id, change_type, reason, before_json, after_json, effective_date, status, created_by,
        approval_request_id, approved_by, approved_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', ?, '', '', NULL, ?, ?)`)
      .bind(id, contractId, changeType, reason, JSON.stringify(before), JSON.stringify(after), effectiveDate, authorization.principal.employeeId, now, now).run();
    try {
      const approval = await createApprovalRequest(db, authorization.principal, { module: "sales", requestType: "CONTRACT_CHANGE",
        title: `${contract.contract_number} 계약 변경 승인`, description: `${changeType} · ${reason}`,
        targetEntityType: "SALES_CONTRACT_CHANGE", targetEntityId: id, amount: contract.amount_snapshot,
        metadata: { contractId, contractNumber: contract.contract_number, changeType, effectiveDate, before, after } });
      await db.prepare("UPDATE sales_contract_change_requests SET approval_request_id = ?, updated_at = ? WHERE id = ? AND approval_request_id = ''")
        .bind(approval.id, now, id).run();
      await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "SALES_CONTRACT_CHANGE_SUBMITTED",
        entityType: "salesContractChange", entityId: id, reason, before, after: { ...after, approvalId: approval.id } });
      return Response.json({ id, approvalId: approval.id }, { status: 202 });
    } catch (error) {
      await db.prepare("DELETE FROM sales_contract_change_requests WHERE id = ? AND approval_request_id = ''").bind(id).run();
      return Response.json({ error: error instanceof Error ? error.message : "계약 변경 결재선을 만들지 못했습니다." }, { status: 409 });
    }
  }

  return Response.json({ error: "지원하지 않는 계약 작업입니다." }, { status: 400 });
}
