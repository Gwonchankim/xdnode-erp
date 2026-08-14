import { companyOrganizations } from "./hr-company-data";
import type { ErpPrincipal } from "./erp-platform";

export type MasterImpactEntityType = "FINANCE_ACCOUNT" | "FINANCE_PARTNER" | "FINANCE_BANK" | "FINANCE_TAX" | "SALES_ACCOUNT" | "HR_ORGANIZATION";
export type MasterImpactAction = "UPDATE" | "DEACTIVATE" | "ACTIVATE" | "MERGE";
export type MasterImpactSeverity = "BLOCKER" | "WARNING" | "INFO";

export type MasterImpactEntry = {
  code: string;
  severity: MasterImpactSeverity;
  label: string;
  count: number;
  amount?: number;
  detail: string;
};

export type MasterImpactReport = {
  assessmentId: string;
  entityType: MasterImpactEntityType;
  entityId: string;
  entityLabel: string;
  action: MasterImpactAction;
  entityVersion: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  blockingCount: number;
  warningCount: number;
  impactedRecordCount: number;
  entries: MasterImpactEntry[];
  checksum: string;
  requestedBy: string;
  createdAt: number;
  expiresAt: number;
};

type AssessmentRow = {
  id: string; entity_type: string; entity_id: string; proposed_action: string; entity_version: string;
  entity_label: string; risk_level: string; blocking_count: number; warning_count: number;
  impacted_record_count: number; impact_json: string; checksum: string; requested_by: string;
  created_at: number; expires_at: number; used_at: number | null;
};

type EntitySnapshot = { label: string; version: string; accountCode?: string; accountName?: string };
type AggregateRow = { count: number; amount: number | null };

const entityTypes = new Set<MasterImpactEntityType>(["FINANCE_ACCOUNT", "FINANCE_PARTNER", "FINANCE_BANK", "FINANCE_TAX", "SALES_ACCOUNT", "HR_ORGANIZATION"]);
const actions = new Set<MasterImpactAction>(["UPDATE", "DEACTIVATE", "ACTIVATE", "MERGE"]);

export class MasterImpactError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export function isMasterImpactEntityType(value: string): value is MasterImpactEntityType { return entityTypes.has(value as MasterImpactEntityType); }
export function isMasterImpactAction(value: string): value is MasterImpactAction { return actions.has(value as MasterImpactAction); }

export async function ensureMasterImpactSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS erp_master_impact_assessments (
      id TEXT PRIMARY KEY NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      proposed_action TEXT NOT NULL, entity_version TEXT NOT NULL, entity_label TEXT NOT NULL,
      risk_level TEXT NOT NULL, blocking_count INTEGER NOT NULL DEFAULT 0,
      warning_count INTEGER NOT NULL DEFAULT 0, impacted_record_count INTEGER NOT NULL DEFAULT 0,
      impact_json TEXT NOT NULL, checksum TEXT NOT NULL, requested_by TEXT NOT NULL,
      created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER,
      used_by TEXT NOT NULL DEFAULT '', target_type TEXT NOT NULL DEFAULT '', target_id TEXT NOT NULL DEFAULT '')`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_erp_master_impact_entity_created ON erp_master_impact_assessments(entity_type, entity_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_erp_master_impact_expiry_used ON erp_master_impact_assessments(expires_at, used_at)"),
  ]);
}

async function tableExists(db: D1Database, table: string) {
  return Boolean(await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").bind(table).first());
}

async function aggregate(db: D1Database, table: string, sql: string, bindings: unknown[] = []) {
  if (!(await tableExists(db, table))) return { count: 0, amount: 0 };
  const row = await db.prepare(sql).bind(...bindings).first<AggregateRow>();
  return { count: Number(row?.count ?? 0), amount: Number(row?.amount ?? 0) };
}

async function entitySnapshot(db: D1Database, entityType: MasterImpactEntityType, entityId: string): Promise<EntitySnapshot> {
  if (entityType === "FINANCE_ACCOUNT") {
    const row = await db.prepare("SELECT code, name, updated_at FROM finance_master_accounts WHERE id = ?").bind(entityId).first<{ code: string; name: string; updated_at: number }>();
    if (!row) throw new MasterImpactError("영향도를 계산할 계정과목을 찾을 수 없습니다.", 404);
    return { label: `${row.code} · ${row.name}`, version: String(row.updated_at), accountCode: row.code, accountName: row.name };
  }
  if (entityType === "FINANCE_PARTNER") {
    const row = await db.prepare("SELECT canonical_name, business_number, updated_at FROM finance_master_partners WHERE id = ?").bind(entityId).first<{ canonical_name: string; business_number: string; updated_at: number }>();
    if (!row) throw new MasterImpactError("영향도를 계산할 재무 거래처를 찾을 수 없습니다.", 404);
    return { label: row.business_number ? `${row.canonical_name} · ${row.business_number}` : row.canonical_name, version: String(row.updated_at) };
  }
  if (entityType === "FINANCE_BANK") {
    const row = await db.prepare("SELECT account_name, bank_code, last4, updated_at FROM finance_master_bank_accounts WHERE id = ?").bind(entityId).first<{ account_name: string; bank_code: string; last4: string; updated_at: number }>();
    if (!row) throw new MasterImpactError("영향도를 계산할 은행계좌를 찾을 수 없습니다.", 404);
    return { label: `${row.account_name} · ${row.bank_code} ${row.last4}`, version: String(row.updated_at) };
  }
  if (entityType === "FINANCE_TAX") {
    const row = await db.prepare("SELECT code, name, updated_at FROM finance_master_tax_codes WHERE id = ?").bind(entityId).first<{ code: string; name: string; updated_at: number }>();
    if (!row) throw new MasterImpactError("영향도를 계산할 세금코드를 찾을 수 없습니다.", 404);
    return { label: `${row.code} · ${row.name}`, version: String(row.updated_at) };
  }
  if (entityType === "SALES_ACCOUNT") {
    const row = await db.prepare("SELECT name, business_number, updated_at FROM sales_accounts WHERE id = ? AND deleted_at IS NULL").bind(entityId).first<{ name: string; business_number: string; updated_at: number }>();
    if (!row) throw new MasterImpactError("영향도를 계산할 영업 거래처를 찾을 수 없습니다.", 404);
    return { label: row.business_number ? `${row.name} · ${row.business_number}` : row.name, version: String(row.updated_at) };
  }
  const saved = await db.prepare("SELECT name, updated_at FROM hr_organization_records WHERE organization_id = ?").bind(entityId).first<{ name: string; updated_at: number }>();
  const base = companyOrganizations.find((organization) => organization.id === entityId);
  if (!saved && !base) throw new MasterImpactError("영향도를 계산할 조직을 찾을 수 없습니다.", 404);
  return { label: saved?.name ?? base!.name, version: String(saved?.updated_at ?? 0) };
}

function addEntry(entries: MasterImpactEntry[], entry: MasterImpactEntry) {
  if (entry.count > 0) entries.push(entry);
}

async function financeAccountEntries(db: D1Database, entityId: string, snapshot: EntitySnapshot, action: MasterImpactAction) {
  const entries: MasterImpactEntry[] = [];
  const code = snapshot.accountCode ?? "";
  if (action === "DEACTIVATE") {
    const unposted = await aggregate(db, "finance_posting_lines", `SELECT COUNT(*) AS count, COALESCE(SUM(line.debit_amount + line.credit_amount), 0) AS amount
      FROM finance_posting_lines line JOIN finance_posting_vouchers voucher ON voucher.id = line.voucher_id
      JOIN finance_posting_batches batch ON batch.id = voucher.batch_id
      WHERE (line.account_id = ? OR line.account_code = ?) AND batch.status <> 'POSTED'`, [entityId, code]);
    addEntry(entries, { code: "UNPOSTED_POSTING", severity: "BLOCKER", label: "미전기 분개", ...unposted, detail: "작성·검증·승인 중인 분개가 이 계정과목을 사용합니다. 먼저 다른 계정으로 수정하거나 전기해야 합니다." });
    const banks = await aggregate(db, "finance_master_bank_accounts", "SELECT COUNT(*) AS count, 0 AS amount FROM finance_master_bank_accounts WHERE gl_account_code = ? AND status = 'ACTIVE'", [code]);
    addEntry(entries, { code: "ACTIVE_BANK_MAPPING", severity: "BLOCKER", label: "활성 은행계좌 연결", ...banks, detail: "활성 은행계좌의 총계정원장 연결을 먼저 변경해야 합니다." });
    const expenses = await aggregate(db, "finance_expense_requests", `SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM finance_expense_requests
      WHERE account_code = ? AND status NOT IN ('PAID','REJECTED','CANCELLED')`, [code]);
    addEntry(entries, { code: "OPEN_EXPENSE", severity: "BLOCKER", label: "미완료 지출·지급", ...expenses, detail: "지급 또는 취소되지 않은 지출 요청이 연결되어 있습니다." });
    const assets = await aggregate(db, "finance_fixed_assets", `SELECT COUNT(*) AS count, COALESCE(SUM(acquisition_cost), 0) AS amount FROM finance_fixed_assets
      WHERE status NOT IN ('DISPOSED','CANCELLED') AND (asset_account_code = ? OR accumulated_account_code = ? OR expense_account_code = ?)`, [code, code, code]);
    addEntry(entries, { code: "ACTIVE_FIXED_ASSET", severity: "BLOCKER", label: "운영 중 고정자산", ...assets, detail: "자산·감가상각누계·감가상각비 계정으로 사용 중입니다." });
  }
  const posted = await aggregate(db, "finance_posting_lines", `SELECT COUNT(*) AS count, COALESCE(SUM(line.debit_amount + line.credit_amount), 0) AS amount
    FROM finance_posting_lines line JOIN finance_posting_vouchers voucher ON voucher.id = line.voucher_id
    JOIN finance_posting_batches batch ON batch.id = voucher.batch_id
    WHERE (line.account_id = ? OR line.account_code = ?) AND batch.status = 'POSTED'`, [entityId, code]);
  addEntry(entries, { code: "POSTED_HISTORY", severity: "WARNING", label: "전기 완료 분개 이력", ...posted, detail: "과거 전표 스냅샷은 보존되며 새 거래에서만 사용이 중단됩니다." });
  const opening = await aggregate(db, "finance_opening_balance_lines", "SELECT COUNT(*) AS count, COALESCE(SUM(debit_amount + credit_amount), 0) AS amount FROM finance_opening_balance_lines WHERE account_id = ? OR account_code = ?", [entityId, code]);
  addEntry(entries, { code: "OPENING_BALANCE", severity: "INFO", label: "개시잔액 기준선", ...opening, detail: "승인된 개시잔액의 계정 스냅샷은 변경하지 않습니다." });
  const budgets = await aggregate(db, "finance_budgets", "SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM finance_budgets WHERE account_code = ?", [code]);
  addEntry(entries, { code: "BUDGET_LINES", severity: "WARNING", label: "예산 배정", ...budgets, detail: "이미 편성된 예산의 계정코드를 검토해야 합니다." });
  return entries;
}

async function financePartnerEntries(db: D1Database, entityId: string, action: MasterImpactAction) {
  const entries: MasterImpactEntry[] = [];
  if (action === "DEACTIVATE") {
    const unposted = await aggregate(db, "finance_posting_lines", `SELECT COUNT(*) AS count, COALESCE(SUM(line.debit_amount + line.credit_amount), 0) AS amount
      FROM finance_posting_lines line JOIN finance_posting_vouchers voucher ON voucher.id = line.voucher_id
      JOIN finance_posting_batches batch ON batch.id = voucher.batch_id WHERE line.partner_id = ? AND batch.status <> 'POSTED'`, [entityId]);
    addEntry(entries, { code: "UNPOSTED_PARTNER_LINES", severity: "BLOCKER", label: "미전기 거래처 분개", ...unposted, detail: "처리 중인 전표의 거래처를 먼저 변경하거나 전기해야 합니다." });
    const openSales = await aggregate(db, "sales_opportunities", `SELECT COUNT(*) AS count, COALESCE(SUM(opportunity.expected_revenue), 0) AS amount
      FROM sales_opportunities opportunity JOIN finance_master_partner_aliases alias ON alias.mapping_key = 'SALES:' || opportunity.account_id
      WHERE alias.partner_id = ? AND opportunity.status = 'OPEN' AND opportunity.deleted_at IS NULL`, [entityId]);
    addEntry(entries, { code: "OPEN_SALES", severity: "BLOCKER", label: "진행 중 영업기회", ...openSales, detail: "연결된 영업 거래처에 진행 중인 영업기회가 있습니다." });
    const purchase = await aggregate(db, "finance_purchase_orders", `SELECT COUNT(*) AS count, COALESCE(SUM(po.total_amount), 0) AS amount FROM finance_purchase_orders po
      JOIN finance_purchase_vendors vendor ON vendor.id = po.vendor_id
      JOIN finance_master_partner_aliases alias ON alias.mapping_key = 'PURCHASE:' || vendor.id
      WHERE alias.partner_id = ? AND po.status NOT IN ('COMPLETED','CANCELLED','REJECTED')`, [entityId]);
    addEntry(entries, { code: "OPEN_PURCHASE", severity: "BLOCKER", label: "진행 중 구매·발주", ...purchase, detail: "연결된 구매 거래처의 미완료 발주가 있습니다." });
  }
  const aliases = await aggregate(db, "finance_master_partner_aliases", "SELECT COUNT(*) AS count, 0 AS amount FROM finance_master_partner_aliases WHERE partner_id = ?", [entityId]);
  addEntry(entries, { code: "PARTNER_ALIASES", severity: "WARNING", label: "외부 시스템 연결", ...aliases, detail: "영업·구매·Clobe 원본 연결키는 이 재무 거래처를 가리킵니다." });
  const history = await aggregate(db, "finance_posting_lines", "SELECT COUNT(*) AS count, COALESCE(SUM(debit_amount + credit_amount), 0) AS amount FROM finance_posting_lines WHERE partner_id = ?", [entityId]);
  addEntry(entries, { code: "PARTNER_POSTING_HISTORY", severity: "INFO", label: "거래처 분개 이력", ...history, detail: "과거 분개에 저장된 거래처 스냅샷은 보존됩니다." });
  return entries;
}

async function financeBankEntries(db: D1Database, entityId: string, action: MasterImpactAction) {
  const entries: MasterImpactEntry[] = [];
  const bank = await db.prepare("SELECT source_account_id FROM finance_master_bank_accounts WHERE id = ?").bind(entityId).first<{ source_account_id: string }>();
  if (action === "DEACTIVATE" && bank) {
    const unmatched = await aggregate(db, "finance_bank_transactions", `SELECT COUNT(*) AS count, COALESCE(SUM(ABS(amount)), 0) AS amount FROM finance_bank_transactions
      WHERE account_id = ? AND is_unclassified = 1`, [bank.source_account_id]);
    addEntry(entries, { code: "UNMATCHED_BANK_TRANSACTIONS", severity: "BLOCKER", label: "미분류 은행거래", ...unmatched, detail: "미분류·미대사 거래를 처리한 뒤 계좌를 비활성화해야 합니다." });
  }
  const history = bank ? await aggregate(db, "finance_bank_transactions", "SELECT COUNT(*) AS count, COALESCE(SUM(ABS(amount)), 0) AS amount FROM finance_bank_transactions WHERE account_id = ?", [bank.source_account_id]) : { count: 0, amount: 0 };
  addEntry(entries, { code: "BANK_HISTORY", severity: "INFO", label: "은행 거래 이력", ...history, detail: "수집된 과거 거래는 계좌 상태와 무관하게 보존됩니다." });
  return entries;
}

async function financeTaxEntries(db: D1Database, entityId: string, action: MasterImpactAction) {
  const entries: MasterImpactEntry[] = [];
  if (action === "DEACTIVATE") {
    const unposted = await aggregate(db, "finance_posting_lines", `SELECT COUNT(*) AS count, COALESCE(SUM(line.debit_amount + line.credit_amount), 0) AS amount
      FROM finance_posting_lines line JOIN finance_posting_vouchers voucher ON voucher.id = line.voucher_id
      JOIN finance_posting_batches batch ON batch.id = voucher.batch_id WHERE line.tax_code_id = ? AND batch.status <> 'POSTED'`, [entityId]);
    addEntry(entries, { code: "UNPOSTED_TAX_LINES", severity: "BLOCKER", label: "미전기 세금 분개", ...unposted, detail: "처리 중인 분개의 세금코드를 먼저 변경하거나 전기해야 합니다." });
  }
  const history = await aggregate(db, "finance_posting_lines", "SELECT COUNT(*) AS count, COALESCE(SUM(debit_amount + credit_amount), 0) AS amount FROM finance_posting_lines WHERE tax_code_id = ?", [entityId]);
  addEntry(entries, { code: "TAX_HISTORY", severity: "INFO", label: "세금코드 사용 이력", ...history, detail: "과거 분개에 저장된 세금코드 스냅샷은 보존됩니다." });
  return entries;
}

async function salesAccountEntries(db: D1Database, entityId: string, action: MasterImpactAction) {
  const entries: MasterImpactEntry[] = [];
  const blocking = action === "DEACTIVATE";
  const openOpportunities = await aggregate(db, "sales_opportunities", "SELECT COUNT(*) AS count, COALESCE(SUM(expected_revenue), 0) AS amount FROM sales_opportunities WHERE account_id = ? AND status = 'OPEN' AND deleted_at IS NULL", [entityId]);
  addEntry(entries, { code: "OPEN_OPPORTUNITIES", severity: blocking ? "BLOCKER" : "WARNING", label: "진행 중 영업기회", ...openOpportunities, detail: blocking ? "비활성화 전에 영업기회를 종료하거나 다른 거래처로 이관해야 합니다." : action === "MERGE" ? "병합 시 대상 거래처로 함께 이관됩니다." : "거래처명 변경이 진행 중 영업기회 화면에도 반영됩니다." });
  const outstanding = await aggregate(db, "sales_documents", `SELECT COUNT(*) AS count, COALESCE(SUM(MAX(0, invoice.amount - COALESCE((SELECT SUM(allocation.amount)
      FROM sales_payment_allocations allocation JOIN sales_documents payment ON payment.id = allocation.payment_document_id
      WHERE allocation.invoice_document_id = invoice.id AND payment.status IN ('ACCEPTED','COMPLETED')), 0))), 0) AS amount
      FROM sales_documents invoice JOIN sales_opportunities opportunity ON opportunity.id = invoice.opportunity_id
      WHERE opportunity.account_id = ? AND invoice.document_type = 'INVOICE' AND invoice.status IN ('ACCEPTED','COMPLETED')
      AND invoice.amount > COALESCE((SELECT SUM(allocation.amount) FROM sales_payment_allocations allocation
      JOIN sales_documents payment ON payment.id = allocation.payment_document_id WHERE allocation.invoice_document_id = invoice.id
      AND payment.status IN ('ACCEPTED','COMPLETED')), 0)`, [entityId]);
  addEntry(entries, { code: "OUTSTANDING_INVOICES", severity: blocking ? "BLOCKER" : "WARNING", label: "미수 청구", ...outstanding, detail: blocking ? "확정 미수금을 수금·대손 처리한 뒤 상태를 변경해야 합니다." : action === "MERGE" ? "청구 원장의 영업기회와 함께 대상 거래처로 승계됩니다." : "거래처 기준정보 변경 후에도 미수 원장은 같은 거래처 ID로 유지됩니다." });
  const contracts = await aggregate(db, "sales_contracts", `SELECT COUNT(*) AS count, COALESCE(SUM(contract.amount_snapshot), 0) AS amount FROM sales_contracts contract
    JOIN sales_documents doc ON doc.id = contract.order_document_id JOIN sales_opportunities opportunity ON opportunity.id = doc.opportunity_id
    WHERE opportunity.account_id = ? AND contract.status IN ('SUBMITTED','APPROVED','ACTIVE','SCHEDULED')`, [entityId]);
  addEntry(entries, { code: "ACTIVE_CONTRACTS", severity: blocking ? "BLOCKER" : "WARNING", label: "유효 계약", ...contracts, detail: blocking ? "유효 계약을 종료하거나 다른 거래처에 승계하는 절차가 필요합니다." : action === "MERGE" ? "계약의 수주 문서와 영업기회가 대상 거래처로 함께 이관됩니다." : "계약은 거래처 ID 연결을 유지합니다." });
  const cases = await aggregate(db, "sales_service_cases", "SELECT COUNT(*) AS count, COALESCE(SUM(refund_amount), 0) AS amount FROM sales_service_cases WHERE account_id = ? AND status NOT IN ('RESOLVED','CLOSED','CANCELLED')", [entityId]);
  addEntry(entries, { code: "OPEN_SERVICE_CASES", severity: blocking ? "BLOCKER" : "WARNING", label: "미종결 고객 이슈", ...cases, detail: blocking ? "열린 고객 이슈를 종결하거나 다른 거래처에 승계해야 합니다." : action === "MERGE" ? "병합 시 대상 거래처로 함께 이관됩니다." : "고객지원 이슈는 같은 거래처 ID를 계속 참조합니다." });
  const contacts = await aggregate(db, "sales_account_contacts", "SELECT COUNT(*) AS count, 0 AS amount FROM sales_account_contacts WHERE account_id = ?", [entityId]);
  addEntry(entries, { code: "CONTACTS", severity: "INFO", label: "고객 담당자", ...contacts, detail: action === "MERGE" ? "병합 시 중복 키를 제외하고 대상 거래처로 이관됩니다." : "담당자 원장은 같은 거래처 ID로 유지됩니다." });
  return entries;
}

async function hrOrganizationEntries(db: D1Database, entityId: string, snapshot: EntitySnapshot) {
  const entries: MasterImpactEntry[] = [];
  const employees = await aggregate(db, "hr_employee_records", "SELECT COUNT(*) AS count, 0 AS amount FROM hr_employee_records WHERE department = ? AND status <> '퇴직'", [snapshot.label]);
  addEntry(entries, { code: "ACTIVE_EMPLOYEES", severity: "WARNING", label: "재직 구성원", ...employees, detail: "조직명 변경 시 해당 인사기록의 소속 조직명이 함께 변경됩니다." });
  const leaders = await aggregate(db, "hr_organization_leaders", "SELECT COUNT(*) AS count, 0 AS amount FROM hr_organization_leaders WHERE organization_id = ? AND leader_employee_id <> ''", [entityId]);
  addEntry(entries, { code: "ORGANIZATION_LEADER", severity: "INFO", label: "조직장 지정", ...leaders, detail: "조직장 지정은 조직 ID 기준이므로 그대로 유지됩니다." });
  const plans = await aggregate(db, "hr_workforce_plan_lines", "SELECT COUNT(*) AS count, COALESCE(SUM(approved_headcount), 0) AS amount FROM hr_workforce_plan_lines WHERE organization_id = ?", [entityId]);
  addEntry(entries, { code: "WORKFORCE_PLANS", severity: "WARNING", label: "인력계획", ...plans, detail: "인력계획은 조직 ID 기준으로 계속 연결됩니다." });
  const requisitions = await aggregate(db, "hr_recruitment_requisitions", "SELECT COUNT(*) AS count, COALESCE(SUM(requested_headcount), 0) AS amount FROM hr_recruitment_requisitions WHERE organization_id = ? AND status NOT IN ('CLOSED','REJECTED','CANCELLED')", [entityId]);
  addEntry(entries, { code: "OPEN_REQUISITIONS", severity: "WARNING", label: "진행 중 채용요청", ...requisitions, detail: "채용요청은 조직 ID를 사용하므로 이름 변경 후에도 유지됩니다." });
  const performance = await aggregate(db, "hr_performance_participants", "SELECT COUNT(*) AS count, 0 AS amount FROM hr_performance_participants WHERE organization_id = ? AND status <> 'FINALIZED'", [entityId]);
  addEntry(entries, { code: "PERFORMANCE_PARTICIPANTS", severity: "WARNING", label: "진행 중 성과평가", ...performance, detail: "평가 참여자의 조직 ID 연결은 그대로 유지됩니다." });
  const training = await aggregate(db, "hr_training_courses", "SELECT COUNT(*) AS count, 0 AS amount FROM hr_training_courses WHERE organization_id = ? AND status NOT IN ('CLOSED','CANCELLED')", [entityId]);
  addEntry(entries, { code: "TRAINING_COURSES", severity: "WARNING", label: "조직 대상 교육", ...training, detail: "조직 대상 교육과 배정 기준은 조직 ID로 유지됩니다." });
  return entries;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

async function checksum(value: unknown) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function calculate(db: D1Database, entityType: MasterImpactEntityType, entityId: string, action: MasterImpactAction) {
  const snapshot = await entitySnapshot(db, entityType, entityId);
  let entries: MasterImpactEntry[] = [];
  if (entityType === "FINANCE_ACCOUNT") entries = await financeAccountEntries(db, entityId, snapshot, action);
  else if (entityType === "FINANCE_PARTNER") entries = await financePartnerEntries(db, entityId, action);
  else if (entityType === "FINANCE_BANK") entries = await financeBankEntries(db, entityId, action);
  else if (entityType === "FINANCE_TAX") entries = await financeTaxEntries(db, entityId, action);
  else if (entityType === "SALES_ACCOUNT") entries = await salesAccountEntries(db, entityId, action);
  else entries = await hrOrganizationEntries(db, entityId, snapshot);
  const blockingCount = entries.filter((entry) => entry.severity === "BLOCKER").reduce((sum, entry) => sum + entry.count, 0);
  const warningCount = entries.filter((entry) => entry.severity === "WARNING").reduce((sum, entry) => sum + entry.count, 0);
  const impactedRecordCount = entries.reduce((sum, entry) => sum + entry.count, 0);
  const riskLevel = blockingCount > 0 ? "CRITICAL" : warningCount >= 10 ? "HIGH" : warningCount > 0 ? "MEDIUM" : "LOW";
  const core = { entityType, entityId, entityLabel: snapshot.label, action, entityVersion: snapshot.version, riskLevel, blockingCount, warningCount, impactedRecordCount, entries };
  return { ...core, checksum: await checksum(core) };
}

export async function createMasterImpactAssessment(db: D1Database, principal: ErpPrincipal, entityType: MasterImpactEntityType, entityId: string, action: MasterImpactAction): Promise<MasterImpactReport> {
  await ensureMasterImpactSchema(db);
  const calculated = await calculate(db, entityType, entityId, action);
  const assessmentId = crypto.randomUUID(); const createdAt = Date.now(); const expiresAt = createdAt + 15 * 60_000;
  await db.prepare(`INSERT INTO erp_master_impact_assessments
    (id, entity_type, entity_id, proposed_action, entity_version, entity_label, risk_level, blocking_count,
      warning_count, impacted_record_count, impact_json, checksum, requested_by, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(assessmentId, entityType, entityId, action, calculated.entityVersion, calculated.entityLabel, calculated.riskLevel,
      calculated.blockingCount, calculated.warningCount, calculated.impactedRecordCount, JSON.stringify(calculated.entries),
      calculated.checksum, principal.employeeId, createdAt, expiresAt).run();
  return { assessmentId, ...calculated, requestedBy: principal.employeeId, createdAt, expiresAt };
}

export async function validateMasterImpactAssessment(db: D1Database, assessmentId: string, entityType: MasterImpactEntityType, entityId: string, action: MasterImpactAction) {
  await ensureMasterImpactSchema(db);
  const row = await db.prepare("SELECT * FROM erp_master_impact_assessments WHERE id = ?").bind(assessmentId).first<AssessmentRow>();
  if (!row || row.entity_type !== entityType || row.entity_id !== entityId || row.proposed_action !== action) throw new MasterImpactError("변경 대상과 일치하는 영향도 확인 기록이 필요합니다.", 409);
  if (row.used_at) throw new MasterImpactError("이미 사용된 영향도 확인입니다. 다시 계산해 주세요.", 409);
  if (row.expires_at < Date.now()) throw new MasterImpactError("영향도 확인이 만료되었습니다. 최신 원장으로 다시 계산해 주세요.", 409);
  const current = await calculate(db, entityType, entityId, action);
  if (current.entityVersion !== row.entity_version || current.checksum !== row.checksum) throw new MasterImpactError("확인 이후 연결 원장이 변경되었습니다. 영향도를 다시 계산해 주세요.", 409);
  if (current.blockingCount > 0) throw new MasterImpactError(`차단 항목 ${current.blockingCount}건을 먼저 해결해야 합니다.`, 409);
  return { row, current };
}

export async function consumeMasterImpactAssessment(db: D1Database, assessmentId: string, principal: ErpPrincipal, targetType: string, targetId: string) {
  const result = await prepareMasterImpactConsumption(db, assessmentId, principal, targetType, targetId).run();
  if (!result.meta.changes) throw new MasterImpactError("영향도 확인을 사용 처리하지 못했습니다. 다시 계산해 주세요.", 409);
}

export function prepareMasterImpactConsumption(db: D1Database, assessmentId: string, principal: ErpPrincipal, targetType: string, targetId: string) {
  const now = Date.now();
  return db.prepare(`UPDATE erp_master_impact_assessments SET used_at = ?, used_by = ?, target_type = ?, target_id = ?
    WHERE id = ? AND used_at IS NULL AND expires_at >= ?`).bind(now, principal.employeeId, targetType, targetId, assessmentId, now);
}

export async function reassessMasterImpact(db: D1Database, entityType: MasterImpactEntityType, entityId: string, action: MasterImpactAction) {
  return calculate(db, entityType, entityId, action);
}
