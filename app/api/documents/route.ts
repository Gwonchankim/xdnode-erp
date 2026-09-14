import { env } from "cloudflare:workers";
import { authorizeErpRequest, writeErpAudit } from "../../erp-platform";
import type { ErpModule } from "../../erp-platform";
import { ensureFinanceAlertActionSchema } from "../../finance-alert-actions-server";
import { ensureSalesContractSchema } from "../../sales-contracts";
import { ensureSalesServiceSchema } from "../../sales-service";

type Bindings = { DB: D1Database; HR_AUDIO: R2Bucket };
const bindings = env as unknown as Bindings;
const db = bindings.DB;

type DocumentRow = {
  id: string; module: string; entity_type: string; entity_id: string; category: string; version: number;
  file_name: string; content_type: string; storage_key: string; uploaded_by: string; created_at: number; deleted_at: number | null;
};

const allowedModules = new Set<ErpModule>(["finance", "hr", "recruitment", "sales"]);
const allowedTypes = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "image/png", "image/jpeg", "text/plain", "text/csv",
]);

async function ensureSchema() {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS erp_documents (
      id TEXT PRIMARY KEY NOT NULL, module TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      category TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, file_name TEXT NOT NULL,
      content_type TEXT NOT NULL, storage_key TEXT NOT NULL, uploaded_by TEXT NOT NULL,
      created_at INTEGER NOT NULL, deleted_at INTEGER
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_erp_documents_entity ON erp_documents(entity_type, entity_id)"),
  ]);
}

const toDocument = (row: DocumentRow) => ({
  id: row.id, module: row.module, entityType: row.entity_type, entityId: row.entity_id,
  category: row.category, version: row.version, fileName: row.file_name, contentType: row.content_type,
  uploadedBy: row.uploaded_by, createdAt: row.created_at,
  downloadUrl: `/api/documents?downloadId=${encodeURIComponent(row.id)}`,
});

export async function GET(request: Request) {
  await ensureSchema();
  const url = new URL(request.url);
  const downloadId = url.searchParams.get("downloadId")?.trim();
  if (downloadId) {
    const row = await db.prepare("SELECT * FROM erp_documents WHERE id = ? AND deleted_at IS NULL")
      .bind(downloadId).first<DocumentRow>();
    if (!row || !allowedModules.has(row.module as ErpModule)) return new Response("문서를 찾을 수 없습니다.", { status: 404 });
    const authorization = await authorizeErpRequest(db, row.module as ErpModule, "read");
    if (authorization.response) return authorization.response;
    const object = await bindings.HR_AUDIO.get(row.storage_key);
    if (!object) return new Response("문서 원본을 찾을 수 없습니다.", { status: 404 });
    await writeErpAudit(db, { principal: authorization.principal, module: row.module as ErpModule, action: "DOCUMENT_DOWNLOADED", entityType: row.entity_type, entityId: row.entity_id, after: { documentId: row.id, fileName: row.file_name, version: row.version } });
    const encodedName = encodeURIComponent(row.file_name);
    return new Response(object.body, { headers: { "Content-Type": row.content_type, "Content-Disposition": `attachment; filename*=UTF-8''${encodedName}`, "Cache-Control": "private, no-store" } });
  }

  const moduleName = url.searchParams.get("module")?.trim() as ErpModule;
  const entityType = url.searchParams.get("entityType")?.trim() ?? "";
  const entityId = url.searchParams.get("entityId")?.trim() ?? "";
  if (!allowedModules.has(moduleName) || !entityType || !entityId) return Response.json({ error: "문서 모듈과 대상 정보가 필요합니다." }, { status: 400 });
  const authorization = await authorizeErpRequest(db, moduleName, "read");
  if (authorization.response) return authorization.response;
  const result = await db.prepare(`SELECT * FROM erp_documents
    WHERE module = ? AND entity_type = ? AND entity_id = ? AND deleted_at IS NULL
    ORDER BY category, version DESC, created_at DESC`).bind(moduleName, entityType, entityId).all<DocumentRow>();
  return Response.json({ documents: result.results.map(toDocument) });
}

export async function POST(request: Request) {
  await ensureSchema();
  const form = await request.formData();
  const moduleName = String(form.get("module") ?? "") as ErpModule;
  const entityType = String(form.get("entityType") ?? "").trim();
  const entityId = String(form.get("entityId") ?? "").trim();
  const category = String(form.get("category") ?? "").trim();
  const file = form.get("file");
  if (!allowedModules.has(moduleName) || !entityType || !entityId || !category || !(file instanceof File && file.size)) {
    return Response.json({ error: "문서 대상·분류·파일이 필요합니다." }, { status: 400 });
  }
  const authorization = await authorizeErpRequest(db, moduleName, "write");
  if (authorization.response) return authorization.response;
  if (moduleName === "finance" && entityType === "financeCloseRun") {
    const closeRun = await db.prepare("SELECT status FROM finance_close_runs WHERE period = ?").bind(entityId).first<{ status: string }>();
    if (!closeRun) return Response.json({ error: "월마감 실행 원장을 먼저 생성해 주세요." }, { status: 404 });
    if (closeRun.status !== "OPEN") return Response.json({ error: "제출 또는 잠금된 월마감의 증빙은 변경할 수 없습니다." }, { status: 409 });
  }
  if (moduleName === "finance" && entityType === "financeAlertCase") {
    await ensureFinanceAlertActionSchema(db);
    const alertCase = await db.prepare("SELECT status FROM finance_alert_cases WHERE id = ?").bind(entityId).first<{ status: string }>();
    if (!alertCase) return Response.json({ error: "재무 경보 조치 원장을 먼저 생성해 주세요." }, { status: 404 });
    if (!["OPEN", "IN_PROGRESS"].includes(alertCase.status)) return Response.json({ error: "종료 검토 중이거나 종료된 경보에는 근거자료를 추가할 수 없습니다." }, { status: 409 });
  }
  if (moduleName === "finance" && entityType === "financeDebtFacility") {
    const facility = await db.prepare("SELECT status FROM finance_debt_facilities WHERE id = ?").bind(entityId).first<{ status: string }>();
    if (!facility) return Response.json({ error: "차입계약 원장을 먼저 등록해 주세요." }, { status: 404 });
    if (!["DRAFT", "ACTIVE"].includes(facility.status)) return Response.json({ error: "종료·무효 계약에는 문서를 추가할 수 없습니다." }, { status: 409 });
  }
  if (moduleName === "sales" && entityType === "salesIncentiveRule") {
    const rule = await db.prepare("SELECT status FROM sales_incentive_rules WHERE id = ?").bind(entityId).first<{ status: string }>();
    if (!rule) return Response.json({ error: "인센티브 규정 초안을 먼저 등록해 주세요." }, { status: 404 });
    if (rule.status !== "DRAFT") return Response.json({ error: "제출·승인된 인센티브 규정에는 근거문서를 추가할 수 없습니다." }, { status: 409 });
  }
  if (moduleName === "sales" && entityType === "salesContract") {
    await ensureSalesContractSchema(db);
    const contract = await db.prepare("SELECT status FROM sales_contracts WHERE id = ?").bind(entityId).first<{ status: string }>();
    if (!contract) return Response.json({ error: "계약 원장을 먼저 등록해 주세요." }, { status: 404 });
    if (contract.status !== "DRAFT") return Response.json({ error: "제출·승인된 계약에는 서명본을 추가할 수 없습니다. 계약 변경 절차를 이용해 주세요." }, { status: 409 });
  }
  if (moduleName === "sales" && entityType === "salesContractObligation") {
    await ensureSalesContractSchema(db);
    const obligation = await db.prepare(`SELECT obligation.status, contract.status AS contract_status FROM sales_contract_obligations obligation
      JOIN sales_contracts contract ON contract.id = obligation.contract_id WHERE obligation.id = ?`).bind(entityId)
      .first<{ status: string; contract_status: string }>();
    if (!obligation || obligation.contract_status !== "ACTIVE" || !["OPEN", "IN_PROGRESS"].includes(obligation.status)) {
      return Response.json({ error: "활성 계약의 미완료 의무에만 증빙을 추가할 수 있습니다." }, { status: 409 });
    }
  }
  if (moduleName === "sales" && entityType === "salesServiceCase") {
    await ensureSalesServiceSchema(db);
    const serviceCase = await db.prepare("SELECT status FROM sales_service_cases WHERE id = ?").bind(entityId).first<{ status: string }>();
    if (!serviceCase) return Response.json({ error: "고객지원 케이스를 먼저 등록해 주세요." }, { status: 404 });
    if (!["OPEN", "IN_PROGRESS"].includes(serviceCase.status)) return Response.json({ error: "처리안 제출 전 고객지원 케이스에만 근거문서를 추가할 수 있습니다." }, { status: 409 });
  }
  if (file.size > 25 * 1024 * 1024) return Response.json({ error: "파일은 25MB 이하만 저장할 수 있습니다." }, { status: 413 });
  const contentType = file.type || "application/octet-stream";
  if (!allowedTypes.has(contentType)) return Response.json({ error: "PDF, DOCX, XLSX, PNG, JPG, TXT, CSV 파일만 저장할 수 있습니다." }, { status: 415 });

  const latest = await db.prepare(`SELECT MAX(version) AS version FROM erp_documents
    WHERE module = ? AND entity_type = ? AND entity_id = ? AND category = ?`)
    .bind(moduleName, entityType, entityId, category).first<{ version: number | null }>();
  const version = (latest?.version ?? 0) + 1;
  const id = crypto.randomUUID();
  const extension = file.name.split(".").pop()?.replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  const storageKey = `erp-documents/${moduleName}/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}/${id}.${extension}`;
  await bindings.HR_AUDIO.put(storageKey, await file.arrayBuffer(), { httpMetadata: { contentType } });
  const now = Date.now();
  try {
    await db.prepare(`INSERT INTO erp_documents
      (id, module, entity_type, entity_id, category, version, file_name, content_type, storage_key, uploaded_by, created_at, deleted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`)
      .bind(id, moduleName, entityType, entityId, category, version, file.name.slice(0, 240), contentType, storageKey, authorization.principal.employeeId, now).run();
  } catch (error) {
    await bindings.HR_AUDIO.delete(storageKey);
    throw error;
  }
  const document = { id, module: moduleName, entityType, entityId, category, version, fileName: file.name.slice(0, 240), contentType, uploadedBy: authorization.principal.employeeId, createdAt: now, downloadUrl: `/api/documents?downloadId=${encodeURIComponent(id)}` };
  await writeErpAudit(db, { principal: authorization.principal, module: moduleName, action: "DOCUMENT_UPLOADED", entityType, entityId, after: document });
  return Response.json({ document }, { status: 201 });
}

// 이미 등록된 문서의 분류만 바꾼다. 원본 파일과 등록 이력은 건드리지 않는다.
export async function PATCH(request: Request) {
  await ensureSchema();
  let body: { id?: unknown; category?: unknown };
  try {
    body = await request.json() as { id?: unknown; category?: unknown };
  } catch {
    return Response.json({ error: "요청 내용을 읽을 수 없습니다." }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const category = typeof body.category === "string" ? body.category.trim().slice(0, 60) : "";
  if (!id || !category) return Response.json({ error: "문서와 분류가 필요합니다." }, { status: 400 });

  const row = await db.prepare("SELECT * FROM erp_documents WHERE id = ? AND deleted_at IS NULL").bind(id).first<DocumentRow>();
  if (!row || !allowedModules.has(row.module as ErpModule)) return Response.json({ error: "수정할 문서를 찾을 수 없습니다." }, { status: 404 });
  const authorization = await authorizeErpRequest(db, row.module as ErpModule, "write");
  if (authorization.response) return authorization.response;
  if (row.category === category) return Response.json({ document: toDocument(row) });

  // 버전은 (대상, 분류)별로 매겨진다. 분류를 옮기면 옮겨간 분류 기준으로 번호를 다시 받아야
  // 같은 분류 안에서 번호가 겹치지 않는다.
  const latest = await db.prepare(`SELECT MAX(version) AS version FROM erp_documents
    WHERE module = ? AND entity_type = ? AND entity_id = ? AND category = ? AND deleted_at IS NULL`)
    .bind(row.module, row.entity_type, row.entity_id, category).first<{ version: number | null }>();
  const version = (latest?.version ?? 0) + 1;

  await db.prepare("UPDATE erp_documents SET category = ?, version = ? WHERE id = ?").bind(category, version, id).run();
  await writeErpAudit(db, {
    principal: authorization.principal,
    module: row.module as ErpModule,
    action: "DOCUMENT_CATEGORY_CHANGED",
    entityType: row.entity_type,
    entityId: row.entity_id,
    before: { documentId: id, fileName: row.file_name, category: row.category, version: row.version },
    after: { documentId: id, fileName: row.file_name, category, version },
  });
  return Response.json({ document: toDocument({ ...row, category, version }) });
}

export async function DELETE(request: Request) {
  await ensureSchema();
  const body = await request.json() as { id?: unknown };
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const row = id ? await db.prepare("SELECT * FROM erp_documents WHERE id = ? AND deleted_at IS NULL").bind(id).first<DocumentRow>() : null;
  if (!row || !allowedModules.has(row.module as ErpModule)) return Response.json({ error: "삭제할 문서를 찾을 수 없습니다." }, { status: 404 });
  const authorization = await authorizeErpRequest(db, row.module as ErpModule, "delete");
  if (authorization.response) return authorization.response;
  if (row.module === "finance" && row.entity_type === "financeCloseRun") {
    const closeRun = await db.prepare("SELECT status FROM finance_close_runs WHERE period = ?").bind(row.entity_id).first<{ status: string }>();
    if (closeRun?.status !== "OPEN") return Response.json({ error: "제출 또는 잠금된 월마감의 증빙은 삭제할 수 없습니다." }, { status: 409 });
  }
  if (row.module === "finance" && row.entity_type === "financeAlertCase") {
    await ensureFinanceAlertActionSchema(db);
    const alertCase = await db.prepare("SELECT status FROM finance_alert_cases WHERE id = ?").bind(row.entity_id).first<{ status: string }>();
    if (alertCase && ["REVIEW", "CLOSED"].includes(alertCase.status)) {
      return Response.json({ error: "검토 또는 종료에 사용된 경보 근거자료는 감사 이력 보호를 위해 삭제할 수 없습니다." }, { status: 409 });
    }
  }
  if (row.module === "finance" && row.entity_type === "financeExpense") {
    const reviewed = await db.prepare(`SELECT evidence_status FROM finance_expense_controls
      WHERE expense_request_id = ? AND evidence_document_id = ?`).bind(row.entity_id, row.id).first<{ evidence_status: string }>();
    if (reviewed && ["VERIFIED", "EXEMPT"].includes(reviewed.evidence_status)) {
      return Response.json({ error: "검토 완료된 지출증빙입니다. 지출증빙 화면에서 검토를 재개방한 뒤 삭제해 주세요." }, { status: 409 });
    }
  }
  if (row.module === "finance" && row.entity_type === "financeDebtFacility") {
    const [facility, review] = await Promise.all([
      db.prepare("SELECT status, evidence_document_id FROM finance_debt_facilities WHERE id = ?").bind(row.entity_id)
        .first<{ status: string; evidence_document_id: string }>(),
      db.prepare("SELECT id FROM finance_debt_covenant_reviews WHERE facility_id = ? AND evidence_document_id = ? LIMIT 1")
        .bind(row.entity_id, row.id).first<{ id: string }>(),
    ]);
    if (review || (facility && ["ACTIVE", "CLOSED"].includes(facility.status) && facility.evidence_document_id === row.id)) {
      return Response.json({ error: "활성 계약 또는 확정된 약정 검토에 사용된 근거문서입니다. 감사 기록 보호를 위해 삭제할 수 없습니다." }, { status: 409 });
    }
  }
  if (row.module === "sales" && row.entity_type === "salesIncentiveRule") {
    const [rule, validation] = await Promise.all([
      db.prepare("SELECT status FROM sales_incentive_rules WHERE id = ?").bind(row.entity_id).first<{ status: string }>(),
      db.prepare("SELECT id FROM sales_incentive_validations WHERE rule_id = ? AND evidence_document_id = ? LIMIT 1")
        .bind(row.entity_id, row.id).first<{ id: string }>(),
    ]);
    if (validation || (rule && rule.status !== "DRAFT")) {
      return Response.json({ error: "검증 또는 승인 절차에 사용된 인센티브 근거문서는 삭제할 수 없습니다." }, { status: 409 });
    }
  }
  if (row.module === "sales" && row.entity_type === "salesContract") {
    await ensureSalesContractSchema(db);
    const contract = await db.prepare("SELECT status, signed_document_id FROM sales_contracts WHERE id = ?").bind(row.entity_id)
      .first<{ status: string; signed_document_id: string }>();
    if (contract && (contract.status !== "DRAFT" || contract.signed_document_id === row.id)) {
      return Response.json({ error: "제출·승인 또는 활성 계약의 서명본은 감사 이력 보호를 위해 삭제할 수 없습니다." }, { status: 409 });
    }
  }
  if (row.module === "sales" && row.entity_type === "salesContractObligation") {
    await ensureSalesContractSchema(db);
    const obligation = await db.prepare("SELECT status FROM sales_contract_obligations WHERE id = ?").bind(row.entity_id).first<{ status: string }>();
    if (obligation?.status === "COMPLETED") return Response.json({ error: "완료 근거로 사용된 계약 의무 증빙은 삭제할 수 없습니다." }, { status: 409 });
  }
  if (row.module === "sales" && row.entity_type === "salesServiceCase") {
    await ensureSalesServiceSchema(db);
    const serviceCase = await db.prepare("SELECT status FROM sales_service_cases WHERE id = ?").bind(row.entity_id).first<{ status: string }>();
    if (serviceCase && !["OPEN", "IN_PROGRESS"].includes(serviceCase.status)) {
      return Response.json({ error: "제출·승인·종결에 사용된 고객지원 근거문서는 삭제할 수 없습니다." }, { status: 409 });
    }
  }
  const deletedAt = Date.now();
  await db.prepare("UPDATE erp_documents SET deleted_at = ? WHERE id = ?").bind(deletedAt, id).run();
  await writeErpAudit(db, { principal: authorization.principal, module: row.module as ErpModule, action: "DOCUMENT_SOFT_DELETED", entityType: row.entity_type, entityId: row.entity_id, before: toDocument(row), after: { deletedAt }, reason: "원본 파일은 복구를 위해 보존" });
  return Response.json({ id, deletedAt });
}
