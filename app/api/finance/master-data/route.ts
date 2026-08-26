import { env } from "cloudflare:workers";
import { createApprovalRequest } from "../../../approval-engine";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";
import { financeCurrentData } from "../../../finance-current-data";
import { financeHistoricalData } from "../../../finance-historical-data";
import { liquidityFor, normalBalanceFor, openingAccountCategory, statementLineFor } from "../../../finance-opening-balance";
import { consumeMasterImpactAssessment, MasterImpactError, type MasterImpactEntityType, validateMasterImpactAssessment } from "../../../master-impact";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;

type MasterType = "ACCOUNT" | "PARTNER" | "BANK" | "TAX";
type ChangeType = "CREATE" | "UPDATE" | "DEACTIVATE" | "ACTIVATE";
type Row = Record<string, string | number | null>;

function normalizePartner(value: string) {
  return value.toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
}

async function ensureSchema() {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_master_accounts (
      id TEXT PRIMARY KEY NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL,
      normal_balance TEXT NOT NULL, statement_line TEXT NOT NULL DEFAULT '', liquidity TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ACTIVE', source TEXT NOT NULL DEFAULT 'MANUAL',
      valid_from TEXT NOT NULL DEFAULT '', valid_to TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_master_partners (
      id TEXT PRIMARY KEY NOT NULL, canonical_name TEXT NOT NULL, normalized_key TEXT NOT NULL,
      business_number TEXT NOT NULL DEFAULT '', partner_type TEXT NOT NULL DEFAULT 'BOTH',
      payment_terms_days INTEGER NOT NULL DEFAULT 30, status TEXT NOT NULL DEFAULT 'ACTIVE',
      source TEXT NOT NULL DEFAULT 'MANUAL', created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_master_partner_aliases (
      id TEXT PRIMARY KEY NOT NULL, mapping_key TEXT NOT NULL, source_system TEXT NOT NULL,
      source_entity_id TEXT NOT NULL DEFAULT '', source_name TEXT NOT NULL, partner_id TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_master_bank_accounts (
      id TEXT PRIMARY KEY NOT NULL, source_system TEXT NOT NULL, source_account_id TEXT NOT NULL,
      bank_code TEXT NOT NULL DEFAULT '', account_name TEXT NOT NULL, last4 TEXT NOT NULL DEFAULT '',
      account_type TEXT NOT NULL, currency TEXT NOT NULL DEFAULT 'KRW', gl_account_code TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ACTIVE', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_master_tax_codes (
      id TEXT PRIMARY KEY NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL, direction TEXT NOT NULL DEFAULT 'BOTH',
      rate_basis_points INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ACTIVE',
      effective_from TEXT NOT NULL DEFAULT '', effective_to TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_master_change_requests (
      id TEXT PRIMARY KEY NOT NULL, target_type TEXT NOT NULL, target_id TEXT NOT NULL, change_type TEXT NOT NULL,
      before_json TEXT NOT NULL DEFAULT '{}', after_json TEXT NOT NULL DEFAULT '{}', reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'SUBMITTED', approval_id TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL,
      approved_by TEXT NOT NULL DEFAULT '', approved_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_master_account_code ON finance_master_accounts(code)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_master_partner_key ON finance_master_partners(normalized_key)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_master_partner_alias_key ON finance_master_partner_aliases(mapping_key)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_master_bank_source ON finance_master_bank_accounts(source_system, source_account_id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_master_tax_code ON finance_master_tax_codes(code)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_master_change_status_created ON finance_master_change_requests(status, created_at)"),
  ]);
}

async function seedAuthoritativeData(employeeId: string) {
  const now = Date.now();
  const statements: D1PreparedStatement[] = [];
  for (const item of financeHistoricalData.trialBalance2025) {
    if (!item.code || !item.name) continue;
    const category = openingAccountCategory(item.code, item.name);
    statements.push(db.prepare(`INSERT OR IGNORE INTO finance_master_accounts
      (id, code, name, category, normal_balance, statement_line, liquidity, status, source, valid_from, valid_to, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', 'ECOUNT_2025', '2025-01-01', '', ?, ?, ?)`)
      .bind(`acct:${item.code}`, item.code, item.name, category, normalBalanceFor(category),
        statementLineFor(category, item.code, item.name), liquidityFor(category, item.name), employeeId, now, now));
  }
  for (const item of financeCurrentData.accounts) {
    statements.push(db.prepare(`INSERT INTO finance_master_bank_accounts
      (id, source_system, source_account_id, bank_code, account_name, last4, account_type, currency,
        gl_account_code, status, created_at, updated_at)
      VALUES (?, 'CLOBE', ?, ?, ?, ?, ?, ?, '', 'ACTIVE', ?, ?)
      ON CONFLICT(source_system, source_account_id) DO UPDATE SET bank_code = excluded.bank_code,
        account_name = excluded.account_name, last4 = excluded.last4, account_type = excluded.account_type,
        currency = excluded.currency, updated_at = excluded.updated_at`)
      .bind(`bank:clobe:${item.id}`, String(item.id), item.bankCode, item.name, item.last4, item.type, item.currency, now, now));
  }
  if (statements.length) await db.batch(statements);

  const sources = await Promise.all([
    db.prepare("SELECT id, name, business_number FROM sales_accounts WHERE deleted_at IS NULL").all<{ id: string; name: string; business_number: string }>(),
    db.prepare("SELECT id, name, business_number, payment_terms_days FROM finance_purchase_vendors WHERE deleted_at IS NULL").all<{ id: string; name: string; business_number: string; payment_terms_days: number }>(),
  ]).catch(() => [{ results: [] }, { results: [] }] as const);
  const combined = new Map<string, { name: string; businessNumber: string; type: string; terms: number; aliases: Array<{ system: string; id: string }> }>();
  for (const row of sources[0].results) {
    const key = row.business_number.replace(/\D/g, "") || normalizePartner(row.name);
    combined.set(key, { name: row.name, businessNumber: row.business_number, type: "CUSTOMER", terms: 30, aliases: [{ system: "SALES", id: row.id }] });
  }
  for (const row of sources[1].results) {
    const key = row.business_number.replace(/\D/g, "") || normalizePartner(row.name);
    const current = combined.get(key);
    if (current) { current.type = "BOTH"; current.aliases.push({ system: "PURCHASE", id: row.id }); }
    else combined.set(key, { name: row.name, businessNumber: row.business_number, type: "VENDOR", terms: row.payment_terms_days, aliases: [{ system: "PURCHASE", id: row.id }] });
  }
  const partnerStatements: D1PreparedStatement[] = [];
  for (const [key, item] of combined) {
    const partnerId = `partner:${key}`;
    partnerStatements.push(db.prepare(`INSERT OR IGNORE INTO finance_master_partners
      (id, canonical_name, normalized_key, business_number, partner_type, payment_terms_days, status, source, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', 'ERP_LEGACY', ?, ?, ?)`)
      .bind(partnerId, item.name, key, item.businessNumber, item.type, item.terms, employeeId, now, now));
    for (const alias of item.aliases) partnerStatements.push(db.prepare(`INSERT OR IGNORE INTO finance_master_partner_aliases
      (id, mapping_key, source_system, source_entity_id, source_name, partner_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(`alias:${alias.system}:${alias.id}`, `${alias.system}:${alias.id}`, alias.system, alias.id, item.name, partnerId, now, now));
  }
  if (partnerStatements.length) await db.batch(partnerStatements);
}

function parseJson(value: string) {
  try { return JSON.parse(value) as Record<string, unknown>; } catch { return {}; }
}

export async function GET() {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "finance", "read");
  if (authorization.response) return authorization.response;
  await seedAuthoritativeData(authorization.principal.employeeId);
  const [accounts, partners, aliases, banks, taxCodes, changes] = await Promise.all([
    db.prepare("SELECT * FROM finance_master_accounts ORDER BY status, code").all<Row>(),
    db.prepare("SELECT * FROM finance_master_partners ORDER BY status, canonical_name").all<Row>(),
    db.prepare("SELECT * FROM finance_master_partner_aliases ORDER BY source_system, source_name").all<Row>(),
    db.prepare("SELECT * FROM finance_master_bank_accounts ORDER BY status, account_type, bank_code, last4").all<Row>(),
    db.prepare("SELECT * FROM finance_master_tax_codes ORDER BY status, code").all<Row>(),
    db.prepare("SELECT * FROM finance_master_change_requests ORDER BY created_at DESC LIMIT 100").all<Row>(),
  ]);
  const partnerKeys = new Set([
    ...partners.results.map((row) => String(row.normalized_key)),
    ...partners.results.map((row) => normalizePartner(String(row.canonical_name))),
    ...aliases.results.map((row) => normalizePartner(String(row.source_name))),
  ]);
  const external = new Map<string, { name: string; customer: boolean; vendor: boolean }>();
  for (const row of financeCurrentData.salesDaily2026) {
    const key = normalizePartner(row.partner); const item = external.get(key) ?? { name: row.partner, customer: false, vendor: false }; item.customer = true; external.set(key, item);
  }
  for (const row of financeCurrentData.purchaseDaily2026) {
    const key = normalizePartner(row.partner); const item = external.get(key) ?? { name: row.partner, customer: false, vendor: false }; item.vendor = true; external.set(key, item);
  }
  const unmappedExternal = [...external.entries()].filter(([key]) => !partnerKeys.has(key)).map(([key, item]) => ({ key, ...item }));
  const activeAccounts = accounts.results.filter((row) => row.status === "ACTIVE");
  const unmappedBanks = banks.results.filter((row) => !row.gl_account_code).length;
  return Response.json({
    asOf: financeCurrentData.asOf,
    accounts: accounts.results,
    partners: partners.results,
    aliases: aliases.results,
    banks: banks.results,
    taxCodes: taxCodes.results,
    changes: changes.results.map((row) => ({ ...row, before: parseJson(String(row.before_json)), after: parseJson(String(row.after_json)) })),
    quality: {
      activeAccounts: activeAccounts.length,
      activePartners: partners.results.filter((row) => row.status === "ACTIVE").length,
      unmappedExternalPartners: unmappedExternal.length,
      unmappedBankAccounts: unmappedBanks,
      activeTaxCodes: taxCodes.results.filter((row) => row.status === "ACTIVE").length,
      pendingChanges: changes.results.filter((row) => row.status === "SUBMITTED").length,
    },
    unmappedExternalPartners: unmappedExternal.slice(0, 30),
  });
}

async function findTarget(targetType: MasterType, targetId: string) {
  const table = targetType === "ACCOUNT" ? "finance_master_accounts" : targetType === "PARTNER" ? "finance_master_partners" : targetType === "BANK" ? "finance_master_bank_accounts" : "finance_master_tax_codes";
  return targetId ? db.prepare(`SELECT * FROM ${table} WHERE id = ?`).bind(targetId).first<Row>() : null;
}

export async function POST(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "finance", "admin");
  if (authorization.response) return authorization.response;
  const body = await request.json() as Record<string, unknown>;
  const targetType = String(body.targetType ?? "") as MasterType;
  const changeType = String(body.changeType ?? "CREATE") as ChangeType;
  const reason = String(body.reason ?? "").trim();
  if (!["ACCOUNT", "PARTNER", "BANK", "TAX"].includes(targetType) || !["CREATE", "UPDATE", "DEACTIVATE", "ACTIVATE"].includes(changeType) || reason.length < 5) {
    return Response.json({ error: "대상·변경 유형과 5자 이상의 변경 사유를 확인해 주세요." }, { status: 400 });
  }
  const payload = (body.data && typeof body.data === "object" ? body.data : {}) as Record<string, unknown>;
  const targetId = changeType === "CREATE" ? crypto.randomUUID() : String(body.targetId ?? "").trim();
  const before = await findTarget(targetType, targetId);
  if (changeType !== "CREATE" && !before) return Response.json({ error: "변경할 마스터를 찾지 못했습니다." }, { status: 404 });
  const impactAssessmentId = String(body.impactAssessmentId ?? "").trim();
  if (changeType !== "CREATE") {
    if (!impactAssessmentId) return Response.json({ error: "최신 연결 원장 영향도 확인이 필요합니다." }, { status: 409 });
    try { await validateMasterImpactAssessment(db, impactAssessmentId, `FINANCE_${targetType}` as MasterImpactEntityType, targetId, changeType); }
    catch (error) { if (error instanceof MasterImpactError) return Response.json({ error: error.message }, { status: error.status }); throw error; }
  }

  const after: Record<string, unknown> = { ...payload, id: targetId };
  if (targetType === "ACCOUNT") {
    after.code = String(payload.code ?? before?.code ?? "").trim();
    after.name = String(payload.name ?? before?.name ?? "").trim();
    after.category = String(payload.category ?? before?.category ?? "OTHER");
    after.normalBalance = String(payload.normalBalance ?? before?.normal_balance ?? "DEBIT");
    after.statementLine = String(payload.statementLine ?? before?.statement_line ?? statementLineFor(String(after.category), String(after.code), String(after.name)));
    after.liquidity = String(payload.liquidity ?? before?.liquidity ?? liquidityFor(String(after.category), String(after.name)));
    if (!after.code || !after.name || !["ASSET","LIABILITY","EQUITY","REVENUE","EXPENSE","OTHER"].includes(String(after.category))) return Response.json({ error: "계정코드·계정명·분류를 확인해 주세요." }, { status: 400 });
    if (after.statementLine && !["SALES_REVENUE","NON_OPERATING_INCOME","COGS","SGA","NON_OPERATING_EXPENSE","INCOME_TAX"].includes(String(after.statementLine))) return Response.json({ error: "손익계산서 세부 라인을 확인해 주세요." }, { status: 400 });
    if (after.liquidity && !["CURRENT","NON_CURRENT"].includes(String(after.liquidity))) return Response.json({ error: "유동·비유동 구분을 확인해 주세요." }, { status: 400 });
    const duplicate = await db.prepare("SELECT id FROM finance_master_accounts WHERE code = ? AND id <> ?").bind(after.code, targetId).first();
    if (duplicate) return Response.json({ error: "같은 계정코드가 이미 있습니다." }, { status: 409 });
  } else if (targetType === "PARTNER") {
    after.canonicalName = String(payload.canonicalName ?? before?.canonical_name ?? "").trim();
    after.businessNumber = String(payload.businessNumber ?? before?.business_number ?? "").trim();
    after.partnerType = String(payload.partnerType ?? before?.partner_type ?? "BOTH");
    after.paymentTermsDays = Math.max(0, Math.min(365, Math.round(Number(payload.paymentTermsDays ?? before?.payment_terms_days ?? 30))));
    after.normalizedKey = String(after.businessNumber).replace(/\D/g, "") || normalizePartner(String(after.canonicalName));
    if (!after.canonicalName || !["CUSTOMER","VENDOR","BOTH","OTHER"].includes(String(after.partnerType))) return Response.json({ error: "거래처명과 유형을 확인해 주세요." }, { status: 400 });
    const duplicate = await db.prepare("SELECT id FROM finance_master_partners WHERE normalized_key = ? AND id <> ?").bind(after.normalizedKey, targetId).first();
    if (duplicate) return Response.json({ error: "같은 사업자번호 또는 표준명이 이미 등록되어 있습니다." }, { status: 409 });
  } else if (targetType === "TAX") {
    after.code = String(payload.code ?? before?.code ?? "").trim();
    after.name = String(payload.name ?? before?.name ?? "").trim();
    after.direction = String(payload.direction ?? before?.direction ?? "BOTH");
    after.rateBasisPoints = Math.max(0, Math.min(10000, Math.round(Number(payload.rateBasisPoints ?? before?.rate_basis_points ?? 0))));
    if (!after.code || !after.name || !["PURCHASE","SALES","BOTH"].includes(String(after.direction))) return Response.json({ error: "세금코드·명칭·적용방향을 확인해 주세요." }, { status: 400 });
    const duplicate = await db.prepare("SELECT id FROM finance_master_tax_codes WHERE code = ? AND id <> ?").bind(after.code, targetId).first();
    if (duplicate) return Response.json({ error: "같은 세금코드가 이미 있습니다." }, { status: 409 });
  } else {
    after.glAccountCode = String(payload.glAccountCode ?? before?.gl_account_code ?? "").trim();
    if (after.glAccountCode && !await db.prepare("SELECT id FROM finance_master_accounts WHERE code = ? AND status = 'ACTIVE'").bind(after.glAccountCode).first()) {
      return Response.json({ error: "활성 계정과목 코드만 은행계좌에 연결할 수 있습니다." }, { status: 409 });
    }
  }
  if (changeType === "DEACTIVATE") after.status = "INACTIVE";
  if (changeType === "ACTIVATE") after.status = "ACTIVE";

  const now = Date.now();
  const changeId = crypto.randomUUID();
  await db.prepare(`INSERT INTO finance_master_change_requests
    (id, target_type, target_id, change_type, before_json, after_json, reason, status, approval_id,
      created_by, approved_by, approved_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', '', ?, '', NULL, ?, ?)`)
    .bind(changeId, targetType, targetId, changeType, JSON.stringify(before ?? {}), JSON.stringify(after), reason, authorization.principal.employeeId, now, now).run();
  try {
    const approval = await createApprovalRequest(db, authorization.principal, {
      module: "finance", requestType: "MASTER_DATA", title: `${targetType} 마스터 ${changeType} 승인`,
      description: reason, targetEntityType: "FINANCE_MASTER_CHANGE", targetEntityId: changeId,
      metadata: { targetType, targetId, changeType, impactAssessmentId },
    });
    await db.prepare("UPDATE finance_master_change_requests SET approval_id = ?, updated_at = ? WHERE id = ?").bind(approval.id, now, changeId).run();
    if (impactAssessmentId) await consumeMasterImpactAssessment(db, impactAssessmentId, authorization.principal, "FINANCE_MASTER_CHANGE", changeId);
    await writeErpAudit(db, { principal: authorization.principal, module: "finance", action: "MASTER_CHANGE_SUBMITTED", entityType: "financeMasterChange", entityId: changeId, before, after: { ...after, reason, approvalId: approval.id, impactAssessmentId } });
    return Response.json({ changeId, approvalId: approval.id, status: "SUBMITTED" }, { status: 201 });
  } catch (error) {
    await db.prepare("DELETE FROM finance_master_change_requests WHERE id = ? AND approval_id = ''").bind(changeId).run();
    return Response.json({ error: error instanceof Error ? error.message : "결재 요청을 만들지 못했습니다." }, { status: 400 });
  }
}
