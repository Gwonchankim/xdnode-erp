import { env } from "cloudflare:workers";
import { createApprovalRequest } from "../../../approval-engine";
import { ensureDataIntakeSchema } from "../../../data-intake";
import { ensureDataIntegrationSchema } from "../../../data-integration";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";
import { ensureFinanceImportMappingSchema } from "../../../finance-import-mapping";
import { companyOrganizations } from "../../../hr-company-data";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;
type Row = Record<string, unknown>;
type DataType = "JOURNAL" | "TRIAL_BALANCE" | "BANK_TRANSACTION";
type Dimension = "ACCOUNT" | "PARTNER" | "DEPARTMENT" | "BANK_ACCOUNT";

const fieldDefinitions: Record<DataType, Array<{ key: string; label: string; required: boolean; aliases: string[] }>> = {
  JOURNAL: [
    { key: "voucherDate", label: "전표일", required: true, aliases: ["일자", "전표일자", "전표일", "거래일자", "date"] },
    { key: "voucherNumber", label: "전표번호", required: false, aliases: ["전표번호", "번호", "voucher no"] },
    { key: "lineNumber", label: "행번호", required: false, aliases: ["순번", "행번호", "line"] },
    { key: "accountCode", label: "계정코드", required: false, aliases: ["계정코드", "계정번호", "코드"] },
    { key: "accountName", label: "계정명", required: false, aliases: ["계정명", "계정과목", "계정과목명"] },
    { key: "partnerName", label: "거래처", required: false, aliases: ["거래처", "거래처명", "상대처"] },
    { key: "department", label: "부서", required: false, aliases: ["부서", "부서명", "조직"] },
    { key: "description", label: "적요", required: false, aliases: ["적요", "내용", "거래내용"] },
    { key: "debitAmount", label: "차변", required: true, aliases: ["차변", "차변금액", "차변액"] },
    { key: "creditAmount", label: "대변", required: true, aliases: ["대변", "대변금액", "대변액"] },
    { key: "sourceReference", label: "원천참조", required: false, aliases: ["원천참조", "증빙번호", "참조"] },
  ],
  TRIAL_BALANCE: [
    { key: "accountCode", label: "계정코드", required: false, aliases: ["계정코드", "계정번호", "코드"] },
    { key: "accountName", label: "계정명", required: false, aliases: ["계정명", "계정과목", "계정과목명"] },
    { key: "openingDebit", label: "기초 차변", required: false, aliases: ["기초차변", "기초잔액차변", "전기이월차변"] },
    { key: "openingCredit", label: "기초 대변", required: false, aliases: ["기초대변", "기초잔액대변", "전기이월대변"] },
    { key: "periodDebit", label: "기간 차변", required: true, aliases: ["차변", "기간차변", "당기차변", "차변합계"] },
    { key: "periodCredit", label: "기간 대변", required: true, aliases: ["대변", "기간대변", "당기대변", "대변합계"] },
    { key: "closingDebit", label: "기말 차변", required: false, aliases: ["기말차변", "잔액차변", "차변잔액"] },
    { key: "closingCredit", label: "기말 대변", required: false, aliases: ["기말대변", "잔액대변", "대변잔액"] },
  ],
  BANK_TRANSACTION: [
    { key: "transactionDate", label: "거래일", required: true, aliases: ["거래일", "거래일자", "일자", "date"] },
    { key: "sourceAccountId", label: "원천계좌 ID", required: true, aliases: ["계좌id", "계좌식별자", "계좌번호", "account id"] },
    { key: "transactionId", label: "거래 ID", required: true, aliases: ["거래id", "거래번호", "transaction id"] },
    { key: "description", label: "적요", required: false, aliases: ["적요", "내용", "거래내용"] },
    { key: "counterparty", label: "상대방", required: false, aliases: ["상대방", "거래처", "보낸분받는분"] },
    { key: "depositAmount", label: "입금", required: false, aliases: ["입금", "입금액", "입금금액"] },
    { key: "withdrawalAmount", label: "출금", required: false, aliases: ["출금", "출금액", "출금금액"] },
    { key: "balance", label: "잔액", required: false, aliases: ["잔액", "거래후잔액"] },
    { key: "currency", label: "통화", required: false, aliases: ["통화", "화폐", "currency"] },
  ],
};

function normalizedKey(value: unknown) { return String(value ?? "").trim().toLowerCase().replace(/[^0-9a-z가-힣]/g, ""); }
function display(value: unknown) { return String(value ?? "").trim(); }
function amount(value: unknown) {
  const raw = display(value); if (!raw || raw === "-") return 0;
  const negative = /^\(.*\)$/.test(raw); const parsed = Number(raw.replace(/[₩원,()\s]/g, ""));
  return Number.isFinite(parsed) ? Math.round((negative ? -1 : 1) * parsed) : Number.NaN;
}
function parseObject(value: unknown) { try { const result = JSON.parse(String(value ?? "{}")); return result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, string> : {}; } catch { return {}; } }
function parseArray(value: unknown) { try { const result = JSON.parse(String(value ?? "[]")); return Array.isArray(result) ? result.map(String) : []; } catch { return []; } }
function suggestFields(dataType: DataType, headers: string[]) {
  const headerMap = new Map(headers.map((header) => [normalizedKey(header), header]));
  return Object.fromEntries(fieldDefinitions[dataType].map((field) => [field.key, field.aliases.map(normalizedKey).map((alias) => headerMap.get(alias)).find(Boolean) ?? ""]));
}
async function addEvent(mappingSetId: string, action: string, fromStatus: string, toStatus: string, actor: string, note: string, snapshot: unknown = {}) {
  await db.prepare(`INSERT INTO finance_import_mapping_events (id,mapping_set_id,action,from_status,to_status,actor_employee_id,note,snapshot_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
    .bind(crypto.randomUUID(), mappingSetId, action, fromStatus, toStatus, actor, note, JSON.stringify(snapshot), Date.now()).run();
}

async function ensureSchemas() { await ensureDataIntegrationSchema(db); await ensureDataIntakeSchema(db); await ensureFinanceImportMappingSchema(db); }

async function view(selectedSetId = "", selectedBatchId = "") {
  const [batches, sets, validations, accounts, partners, banks, organizationRows] = await Promise.all([
    db.prepare(`SELECT batch.*, source.name AS source_name FROM erp_data_import_batches batch JOIN erp_integration_sources source ON source.id=batch.source_id WHERE source.category='FINANCE' ORDER BY batch.created_at DESC LIMIT 50`).all<Row>(),
    db.prepare(`SELECT mapping.*, source.name AS source_name FROM finance_import_mapping_sets mapping JOIN erp_integration_sources source ON source.id=mapping.source_id ORDER BY mapping.updated_at DESC LIMIT 80`).all<Row>(),
    db.prepare("SELECT * FROM finance_import_validations ORDER BY created_at DESC LIMIT 60").all<Row>(),
    db.prepare("SELECT id,code,name,category FROM finance_master_accounts WHERE status='ACTIVE' ORDER BY code").all<Row>().catch(() => ({ results: [] })),
    db.prepare("SELECT id,canonical_name,business_number,partner_type FROM finance_master_partners WHERE status='ACTIVE' ORDER BY canonical_name").all<Row>().catch(() => ({ results: [] })),
    db.prepare("SELECT id,source_account_id,account_name,last4,currency,gl_account_code FROM finance_master_bank_accounts WHERE status='ACTIVE' ORDER BY account_name").all<Row>().catch(() => ({ results: [] })),
    db.prepare("SELECT organization_id,name FROM hr_organization_records ORDER BY name").all<Row>().catch(() => ({ results: [] })),
  ]);
  const setId = selectedSetId || String(sets.results[0]?.id ?? ""); const batchId = selectedBatchId || String(batches.results[0]?.id ?? "");
  const [rules, events, canonical] = await Promise.all([
    setId ? db.prepare("SELECT * FROM finance_import_mapping_rules WHERE mapping_set_id=? ORDER BY dimension_type,source_label").bind(setId).all<Row>() : { results: [] },
    setId ? db.prepare("SELECT * FROM finance_import_mapping_events WHERE mapping_set_id=? ORDER BY created_at DESC LIMIT 50").bind(setId).all<Row>() : { results: [] },
    batchId ? db.prepare(`SELECT canonical.* FROM finance_import_canonical_rows canonical JOIN finance_import_validations validation ON validation.id=canonical.validation_id WHERE canonical.batch_id=? AND validation.id=(SELECT id FROM finance_import_validations WHERE batch_id=? ORDER BY created_at DESC LIMIT 1) ORDER BY row_number LIMIT 100`).bind(batchId, batchId).all<Row>() : { results: [] },
  ]);
  const organizations = organizationRows.results.length ? organizationRows.results : companyOrganizations.map((item) => ({ organization_id: item.id, name: item.name }));
  return {
    batches: batches.results.map((row) => ({ ...row, headers: parseArray(row.header_json) })),
    mappingSets: sets.results.map((row) => ({ ...row, fieldMapping: parseObject(row.field_mapping_json) })),
    validations: validations.results.map((row) => ({ ...row, result: parseObject(row.result_json) })),
    selectedSetId: setId, selectedBatchId: batchId, rules: rules.results, events: events.results, canonicalRows: canonical.results,
    masters: { accounts: accounts.results, partners: partners.results, banks: banks.results, organizations },
    fieldDefinitions,
    controls: { exactMatchOnly: true, approvalRequired: true, directPosting: false, balanceToleranceKrw: 0 },
  };
}

export async function GET(request: Request) {
  const authorization = await authorizeErpRequest(db, "settings", "admin"); if (authorization.response) return authorization.response;
  await ensureSchemas(); const url = new URL(request.url);
  return Response.json({ principal: authorization.principal, ...(await view(url.searchParams.get("mappingSetId") ?? "", url.searchParams.get("batchId") ?? "")) });
}

async function validateTarget(dimension: Dimension, targetId: string) {
  if (dimension === "ACCOUNT") return db.prepare("SELECT id,code AS target_code,name AS target_label FROM finance_master_accounts WHERE id=? AND status='ACTIVE'").bind(targetId).first<Row>();
  if (dimension === "PARTNER") return db.prepare("SELECT id,'' AS target_code,canonical_name AS target_label FROM finance_master_partners WHERE id=? AND status='ACTIVE'").bind(targetId).first<Row>();
  if (dimension === "BANK_ACCOUNT") return db.prepare("SELECT id,source_account_id AS target_code,account_name AS target_label FROM finance_master_bank_accounts WHERE id=? AND status='ACTIVE' AND gl_account_code<>''").bind(targetId).first<Row>();
  const persisted = await db.prepare("SELECT organization_id AS id,organization_id AS target_code,name AS target_label FROM hr_organization_records WHERE organization_id=?").bind(targetId).first<Row>().catch(() => null);
  return persisted ?? companyOrganizations.map((item) => ({ id: item.id, target_code: item.id, target_label: item.name })).find((item) => item.id === targetId) ?? null;
}

async function runValidation(batchId: string, mappingSetId: string, actor: string) {
  const [batch, mappingSet, rows] = await Promise.all([
    db.prepare(`SELECT batch.*, source.category FROM erp_data_import_batches batch JOIN erp_integration_sources source ON source.id=batch.source_id WHERE batch.id=?`).bind(batchId).first<Row>(),
    db.prepare("SELECT * FROM finance_import_mapping_sets WHERE id=? AND status='ACTIVE'").bind(mappingSetId).first<Row>(),
    db.prepare("SELECT * FROM erp_data_import_rows WHERE batch_id=? ORDER BY row_number").bind(batchId).all<Row>(),
  ]);
  if (!batch || batch.category !== "FINANCE") throw new Error("재무 수집 배치를 찾지 못했습니다.");
  if (!mappingSet || mappingSet.source_id !== batch.source_id) throw new Error("같은 원천의 활성 매핑 세트만 사용할 수 있습니다.");
  const dataType = String(mappingSet.data_type) as DataType; const fieldMap = parseObject(mappingSet.field_mapping_json);
  const required = fieldDefinitions[dataType].filter((item) => item.required); const missingFields = required.filter((item) => !fieldMap[item.key]);
  if (missingFields.length) throw new Error(`필수 열 매핑이 없습니다: ${missingFields.map((item) => item.label).join(", ")}`);
  if (["JOURNAL", "TRIAL_BALANCE"].includes(dataType) && !fieldMap.accountCode && !fieldMap.accountName) throw new Error("계정코드 또는 계정명 열을 하나 이상 연결해 주세요.");
  const [ruleRows, accounts, partners, aliases, bankRows, organizationRows] = await Promise.all([
    db.prepare("SELECT * FROM finance_import_mapping_rules WHERE mapping_set_id=?").bind(mappingSetId).all<Row>(),
    db.prepare("SELECT id,code,name FROM finance_master_accounts WHERE status='ACTIVE'").all<Row>(),
    db.prepare("SELECT id,canonical_name FROM finance_master_partners WHERE status='ACTIVE'").all<Row>(),
    db.prepare("SELECT partner_id,source_name FROM finance_master_partner_aliases").all<Row>().catch(() => ({ results: [] })),
    db.prepare("SELECT id,source_account_id,account_name,gl_account_code FROM finance_master_bank_accounts WHERE status='ACTIVE'").all<Row>(),
    db.prepare("SELECT organization_id,name FROM hr_organization_records").all<Row>().catch(() => ({ results: [] })),
  ]);
  const ruleMap = new Map(ruleRows.results.map((row) => [`${row.dimension_type}:${normalizedKey(row.source_key)}`, row]));
  const accountMap = new Map<string, Row>(); for (const row of accounts.results) { accountMap.set(normalizedKey(row.code), row); accountMap.set(normalizedKey(row.name), row); }
  const partnerById = new Map(partners.results.map((row) => [String(row.id), row])); const partnerMap = new Map<string, Row>(); for (const row of partners.results) partnerMap.set(normalizedKey(row.canonical_name), row); for (const row of aliases.results) { const target = partnerById.get(String(row.partner_id)); if (target) partnerMap.set(normalizedKey(row.source_name), target); }
  const bankMap = new Map<string, Row>(); for (const row of bankRows.results) { bankMap.set(normalizedKey(row.source_account_id), row); bankMap.set(normalizedKey(row.account_name), row); }
  const organizationList = organizationRows.results.length ? organizationRows.results : companyOrganizations.map((item) => ({ organization_id: item.id, name: item.name })); const organizationMap = new Map<string, Row>(); for (const row of organizationList) { organizationMap.set(normalizedKey(row.organization_id), row); organizationMap.set(normalizedKey(row.name), row); }
  const targetFromRule = (dimension: Dimension, source: unknown) => ruleMap.get(`${dimension}:${normalizedKey(source)}`);
  let totalDebit = 0, totalCredit = 0, closingDebit = 0, closingCredit = 0, accountMapped = 0, partnerMapped = 0, departmentMapped = 0; const transactionIds = new Set<string>();
  const normalizedRows = rows.results.map((row) => {
    const raw = parseObject(row.raw_json); const canonical: Record<string, unknown> = {};
    for (const field of fieldDefinitions[dataType]) canonical[field.key] = fieldMap[field.key] ? raw[fieldMap[field.key]] ?? "" : "";
    const blocking: string[] = []; const warnings: string[] = [];
    if (dataType !== "BANK_TRANSACTION") {
      const sourceAccount = display(canonical.accountCode) || display(canonical.accountName); const rule = targetFromRule("ACCOUNT", sourceAccount); const target = rule ? { id: rule.target_id, code: rule.target_code, name: rule.target_label } : accountMap.get(normalizedKey(sourceAccount));
      if (!target) blocking.push("계정과목 미매핑"); else { canonical.accountId = target.id; canonical.accountCode = target.code; canonical.accountName = target.name; accountMapped += 1; }
      const sourcePartner = display(canonical.partnerName); if (sourcePartner) { const partnerRule = targetFromRule("PARTNER", sourcePartner); const partner = partnerRule ? { id: partnerRule.target_id, canonical_name: partnerRule.target_label } : partnerMap.get(normalizedKey(sourcePartner)); if (partner) { canonical.partnerId = partner.id; canonical.partnerName = partner.canonical_name; partnerMapped += 1; } else warnings.push("거래처 미매핑"); }
      const sourceDepartment = display(canonical.department); if (sourceDepartment) { const departmentRule = targetFromRule("DEPARTMENT", sourceDepartment); const department = departmentRule ? { organization_id: departmentRule.target_id, name: departmentRule.target_label } : organizationMap.get(normalizedKey(sourceDepartment)); if (department) { canonical.departmentId = department.organization_id; canonical.department = department.name; departmentMapped += 1; } else warnings.push("부서 미매핑"); }
    }
    if (dataType === "JOURNAL") {
      canonical.debitAmount = amount(canonical.debitAmount); canonical.creditAmount = amount(canonical.creditAmount); const debit = Number(canonical.debitAmount); const credit = Number(canonical.creditAmount);
      if (!display(canonical.voucherDate)) blocking.push("전표일 누락"); if (!Number.isFinite(debit) || !Number.isFinite(credit)) blocking.push("차대변 숫자 형식 오류"); else { if (debit < 0 || credit < 0) blocking.push("차대변 음수 금액"); if ((debit === 0) === (credit === 0)) blocking.push("차변·대변 중 한쪽 금액만 필요"); totalDebit += debit; totalCredit += credit; }
    } else if (dataType === "TRIAL_BALANCE") {
      for (const key of ["openingDebit","openingCredit","periodDebit","periodCredit","closingDebit","closingCredit"]) canonical[key] = amount(canonical[key]);
      if (Object.values(canonical).some((value) => typeof value === "number" && !Number.isFinite(value))) blocking.push("금액 숫자 형식 오류");
      if (["openingDebit","openingCredit","periodDebit","periodCredit","closingDebit","closingCredit"].some((key) => Number(canonical[key]) < 0)) blocking.push("시산표 음수 금액");
      totalDebit += Number(canonical.periodDebit) || 0; totalCredit += Number(canonical.periodCredit) || 0; closingDebit += Number(canonical.closingDebit) || 0; closingCredit += Number(canonical.closingCredit) || 0;
    } else {
      canonical.depositAmount = amount(canonical.depositAmount); canonical.withdrawalAmount = amount(canonical.withdrawalAmount); canonical.balance = amount(canonical.balance); const deposit = Number(canonical.depositAmount); const withdrawal = Number(canonical.withdrawalAmount); const transactionId = display(canonical.transactionId);
      if (!display(canonical.transactionDate)) blocking.push("거래일 누락"); if (!transactionId) blocking.push("거래 ID 누락"); else if (transactionIds.has(transactionId)) blocking.push("파일 내부 거래 ID 중복"); else transactionIds.add(transactionId);
      if (![deposit, withdrawal, Number(canonical.balance)].every(Number.isFinite)) blocking.push("거래금액 숫자 형식 오류"); else { if (deposit < 0 || withdrawal < 0) blocking.push("입출금 음수 금액"); if (deposit > 0 && withdrawal > 0) blocking.push("입금·출금 동시 입력"); totalDebit += deposit; totalCredit += withdrawal; }
      const sourceBank = display(canonical.sourceAccountId); const bankRule = targetFromRule("BANK_ACCOUNT", sourceBank); const bank = bankRule ? { id: bankRule.target_id, source_account_id: bankRule.target_code, account_name: bankRule.target_label, gl_account_code: "RULE" } : bankMap.get(normalizedKey(sourceBank));
      if (!bank || !bank.gl_account_code) blocking.push("은행계좌 또는 GL 미연결"); else { canonical.bankAccountId = bank.id; canonical.sourceAccountId = bank.source_account_id; canonical.bankAccountName = bank.account_name; }
      const sourcePartner = display(canonical.counterparty); if (sourcePartner) { const partnerRule = targetFromRule("PARTNER", sourcePartner); const partner = partnerRule ? { id: partnerRule.target_id, canonical_name: partnerRule.target_label } : partnerMap.get(normalizedKey(sourcePartner)); if (partner) { canonical.partnerId = partner.id; canonical.counterparty = partner.canonical_name; partnerMapped += 1; } else warnings.push("상대방 거래처 미매핑"); }
    }
    const recordKey = dataType === "BANK_TRANSACTION" ? display(canonical.transactionId) : dataType === "JOURNAL" ? `${display(canonical.voucherNumber)}:${display(canonical.lineNumber)}` : display(canonical.accountCode);
    return { rowNumber: Number(row.row_number), checksum: String(row.row_checksum), canonical, recordKey, blocking, warnings, valid: blocking.length === 0 };
  });
  const globalIssues: string[] = []; const difference = totalDebit - totalCredit;
  if (dataType === "JOURNAL" && difference !== 0) globalIssues.push(`분개장 차변·대변 ${Math.abs(difference).toLocaleString("ko-KR")}원 불일치`);
  if (dataType === "TRIAL_BALANCE" && difference !== 0) globalIssues.push(`기간 차변·대변 ${Math.abs(difference).toLocaleString("ko-KR")}원 불일치`);
  if (dataType === "TRIAL_BALANCE" && (closingDebit || closingCredit) && closingDebit !== closingCredit) globalIssues.push(`기말 차변·대변 ${Math.abs(closingDebit - closingCredit).toLocaleString("ko-KR")}원 불일치`);
  const invalidCount = normalizedRows.filter((row) => !row.valid).length; const status = invalidCount || globalIssues.length ? "BLOCKED" : "PASSED"; const validationId = crypto.randomUUID(); const now = Date.now();
  const result = { globalIssues, closingDebit, closingCredit, exactMatchOnly: true, directPosting: false, warningCount: normalizedRows.reduce((sum, row) => sum + row.warnings.length, 0) };
  const header = db.prepare(`INSERT INTO finance_import_validations (id,batch_id,mapping_set_id,data_type,status,row_count,valid_count,invalid_count,account_mapped_count,partner_mapped_count,department_mapped_count,total_debit,total_credit,difference_amount,result_json,created_by,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(validationId, batchId, mappingSetId, dataType, status, normalizedRows.length, normalizedRows.length - invalidCount, invalidCount, accountMapped, partnerMapped, departmentMapped, totalDebit, totalCredit, difference, JSON.stringify(result), actor, now);
  await db.batch([header, db.prepare("DELETE FROM finance_import_canonical_rows WHERE batch_id=?").bind(batchId)]);
  try {
    for (let index = 0; index < normalizedRows.length; index += 50) await db.batch(normalizedRows.slice(index, index + 50).map((row) => db.prepare(`INSERT INTO finance_import_canonical_rows (id,validation_id,batch_id,row_number,record_type,record_key,canonical_json,validation_status,issues_json,source_checksum,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(crypto.randomUUID(), validationId, batchId, row.rowNumber, dataType, row.recordKey, JSON.stringify(row.canonical), row.valid ? "VALID" : "INVALID", JSON.stringify([...row.blocking, ...row.warnings]), row.checksum, now)));
  } catch (error) { await db.batch([db.prepare("DELETE FROM finance_import_canonical_rows WHERE validation_id=?").bind(validationId), db.prepare("DELETE FROM finance_import_validations WHERE id=?").bind(validationId)]); throw error; }
  await db.prepare("UPDATE erp_data_import_batches SET mapping_json=?,updated_at=? WHERE id=?").bind(JSON.stringify({ mappingSetId, validationId, status, dataType }), now, batchId).run();
  await addEvent(mappingSetId, "BATCH_VALIDATED", "ACTIVE", "ACTIVE", actor, `${status} · ${normalizedRows.length}행 · 차이 ${difference.toLocaleString("ko-KR")}원`, { validationId, batchId, ...result });
  return validationId;
}

export async function POST(request: Request) {
  const authorization = await authorizeErpRequest(db, "settings", "admin"); if (authorization.response) return authorization.response;
  await ensureSchemas(); const body = await request.json() as Row; const action = display(body.action); const actor = authorization.principal.employeeId;
  try {
    if (action === "CREATE_DRAFT") {
      const batchId = display(body.batchId); const dataType = display(body.dataType) as DataType; if (!fieldDefinitions[dataType]) return Response.json({ error: "자료유형을 확인해 주세요." }, { status: 400 });
      const batch = await db.prepare(`SELECT batch.*,source.category FROM erp_data_import_batches batch JOIN erp_integration_sources source ON source.id=batch.source_id WHERE batch.id=?`).bind(batchId).first<Row>(); if (!batch || batch.category !== "FINANCE") return Response.json({ error: "재무 수집 배치를 선택해 주세요." }, { status: 404 });
      const latest = await db.prepare("SELECT MAX(version) AS version FROM finance_import_mapping_sets WHERE source_id=? AND data_type=?").bind(String(batch.source_id), dataType).first<{ version: number }>(); const version = Number(latest?.version ?? 0) + 1; const id = crypto.randomUUID(); const now = Date.now(); const headers = parseArray(batch.header_json); const mapping = suggestFields(dataType, headers);
      await db.prepare(`INSERT INTO finance_import_mapping_sets (id,source_id,name,data_type,version,status,field_mapping_json,created_by,created_at,updated_at) VALUES (?,?,?,?,?,'DRAFT',?,?,?,?)`).bind(id, String(batch.source_id), display(body.name) || `${String(batch.file_name)} 매핑`, dataType, version, JSON.stringify(mapping), actor, now, now).run();
      await addEvent(id, "DRAFT_CREATED", "", "DRAFT", actor, "원천 헤더 기반 초안 생성. 자동 활성화 없음", { batchId, headers, mapping });
      await writeErpAudit(db, { principal: authorization.principal, module: "finance", action, entityType: "FINANCE_IMPORT_MAPPING_SET", entityId: id, after: { batchId, dataType, version } });
      return Response.json({ ...(await view(id, batchId)) }, { status: 201 });
    }
    const mappingSetId = display(body.mappingSetId); const mappingSet = await db.prepare("SELECT * FROM finance_import_mapping_sets WHERE id=?").bind(mappingSetId).first<Row>(); if (!mappingSet) return Response.json({ error: "매핑 세트를 찾지 못했습니다." }, { status: 404 });
    if (action === "SAVE_DRAFT") {
      if (mappingSet.status !== "DRAFT") return Response.json({ error: "초안 상태에서만 수정할 수 있습니다." }, { status: 409 }); const dataType = String(mappingSet.data_type) as DataType; const mapping = body.fieldMapping && typeof body.fieldMapping === "object" ? body.fieldMapping as Record<string, unknown> : {}; const allowed = new Set(fieldDefinitions[dataType].map((item) => item.key)); const normalized = Object.fromEntries(Object.entries(mapping).filter(([key]) => allowed.has(key)).map(([key, value]) => [key, display(value)]));
      await db.prepare("UPDATE finance_import_mapping_sets SET name=?,field_mapping_json=?,updated_at=? WHERE id=? AND status='DRAFT'").bind(display(body.name) || String(mappingSet.name), JSON.stringify(normalized), Date.now(), mappingSetId).run(); await addEvent(mappingSetId, "DRAFT_SAVED", "DRAFT", "DRAFT", actor, "열 매핑 초안 저장", normalized);
    } else if (action === "UPSERT_RULE") {
      if (mappingSet.status !== "DRAFT") return Response.json({ error: "초안 상태에서만 규칙을 수정할 수 있습니다." }, { status: 409 }); const dimension = display(body.dimensionType) as Dimension; if (!["ACCOUNT","PARTNER","DEPARTMENT","BANK_ACCOUNT"].includes(dimension)) return Response.json({ error: "매핑 차원을 확인해 주세요." }, { status: 400 }); const sourceKey = display(body.sourceKey); const targetId = display(body.targetId); if (!sourceKey || !targetId) return Response.json({ error: "원천값과 대상값을 선택해 주세요." }, { status: 400 }); const target = await validateTarget(dimension, targetId); if (!target) return Response.json({ error: "활성 표준 마스터만 연결할 수 있습니다. 은행계좌는 GL 연결도 필요합니다." }, { status: 409 }); const now = Date.now();
      await db.prepare(`INSERT INTO finance_import_mapping_rules (id,mapping_set_id,dimension_type,source_key,source_label,target_id,target_code,target_label,mapping_method,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?, 'MANUAL',?,?,?) ON CONFLICT(mapping_set_id,dimension_type,source_key) DO UPDATE SET source_label=excluded.source_label,target_id=excluded.target_id,target_code=excluded.target_code,target_label=excluded.target_label,updated_at=excluded.updated_at`).bind(crypto.randomUUID(), mappingSetId, dimension, normalizedKey(sourceKey), display(body.sourceLabel) || sourceKey, targetId, display(target.target_code), display(target.target_label), actor, now, now).run(); await addEvent(mappingSetId, "RULE_SAVED", "DRAFT", "DRAFT", actor, `${dimension} 규칙 저장`, { sourceKey, targetId });
    } else if (action === "DELETE_RULE") {
      if (mappingSet.status !== "DRAFT") return Response.json({ error: "초안 상태에서만 규칙을 삭제할 수 있습니다." }, { status: 409 }); await db.prepare("DELETE FROM finance_import_mapping_rules WHERE id=? AND mapping_set_id=?").bind(display(body.ruleId), mappingSetId).run(); await addEvent(mappingSetId, "RULE_REMOVED", "DRAFT", "DRAFT", actor, "매핑 규칙 제거");
    } else if (action === "SUBMIT_SET") {
      if (mappingSet.status !== "DRAFT") return Response.json({ error: "초안만 결재로 제출할 수 있습니다." }, { status: 409 }); const dataType = String(mappingSet.data_type) as DataType; const mapping = parseObject(mappingSet.field_mapping_json); const missing = fieldDefinitions[dataType].filter((item) => item.required && !mapping[item.key]); if (missing.length || (["JOURNAL","TRIAL_BALANCE"].includes(dataType) && !mapping.accountCode && !mapping.accountName)) return Response.json({ error: `필수 열 매핑을 완료해 주세요${missing.length ? `: ${missing.map((item) => item.label).join(", ")}` : ""}` }, { status: 409 });
      const approval = await createApprovalRequest(db, authorization.principal, { module: "finance", requestType: "IMPORT_MAPPING", title: `${String(mappingSet.name)} 활성화 승인`, description: `${String(mappingSet.source_id)} · ${dataType} · 버전 ${mappingSet.version}`, targetEntityType: "FINANCE_IMPORT_MAPPING_SET", targetEntityId: mappingSetId, priority: "HIGH", metadata: { sourceId: mappingSet.source_id, dataType, version: mappingSet.version } }); const now = Date.now(); await db.prepare("UPDATE finance_import_mapping_sets SET status='SUBMITTED',approval_request_id=?,submitted_at=?,updated_at=? WHERE id=? AND status='DRAFT'").bind(approval.id, now, now, mappingSetId).run(); await addEvent(mappingSetId, "SUBMITTED", "DRAFT", "SUBMITTED", actor, "매핑 세트 활성화 결재 제출", { approvalRequestId: approval.id });
    } else if (action === "VALIDATE_BATCH") {
      await runValidation(display(body.batchId), mappingSetId, actor);
    } else return Response.json({ error: "지원하지 않는 매핑 작업입니다." }, { status: 400 });
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action, entityType: "FINANCE_IMPORT_MAPPING_SET", entityId: mappingSetId, before: { status: mappingSet.status }, after: { batchId: body.batchId ?? "" } });
    return Response.json({ principal: authorization.principal, ...(await view(mappingSetId, display(body.batchId))) });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "재무 파일 매핑 작업을 완료하지 못했습니다." }, { status: 500 }); }
}
