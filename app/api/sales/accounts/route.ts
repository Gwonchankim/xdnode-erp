import { env } from "cloudflare:workers";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;

type AccountRow = { id: string; name: string; business_number: string; industry: string; owner_employee_id: string; status: string; memo: string; created_at: number; updated_at: number; deleted_at: number | null };
type ContactRow = { id: string; account_id: string; contact_key: string; name: string; title: string; email: string; phone: string; is_primary: number; status: string; created_by: string; created_at: number; updated_at: number };
type OpportunityRow = { id: string; account_id: string; title: string; owner_employee_id: string; stage: string; expected_revenue: number; expected_cost: number; probability: number; expected_close_date: string; next_action: string; next_action_date: string; status: string; updated_at: number };
type ActivityRow = { id: string; opportunity_id: string; opportunity_title: string; contact_id: string; contact_name: string | null; activity_type: string; occurred_at: string; summary: string; next_action: string; next_action_date: string; created_by: string; created_at: number };
type DocumentRow = { id: string; opportunity_id: string; opportunity_title: string; document_type: string; document_number: string; amount: number; status: string; issued_date: string; due_date: string; collected_amount: number };
type OwnerHistoryRow = { id: string; account_id: string; from_owner_employee_id: string; to_owner_employee_id: string; reason: string; changed_by: string; changed_at: number };
type EmployeeRow = { employee_id: string; name: string; department: string; status: string };

const normalizeAccountKey = (name: string, businessNumber: string) => {
  const business = businessNumber.replace(/\D/g, "");
  const normalizedName = name.toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
  return business ? `business:${business}` : `name:${normalizedName}`;
};
const toAccount = (row: AccountRow, ownerName = "") => ({
  id: row.id, name: row.name, businessNumber: row.business_number, industry: row.industry,
  ownerEmployeeId: row.owner_employee_id, ownerName, status: row.status, memo: row.memo,
  createdAt: row.created_at, updatedAt: row.updated_at,
});
const toContact = (row: ContactRow) => ({ id: row.id, accountId: row.account_id, name: row.name, title: row.title,
  email: row.email, phone: row.phone, isPrimary: Boolean(row.is_primary), status: row.status, createdBy: row.created_by, createdAt: row.created_at });

async function ensureSchema() {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_account_identity_keys (
      identity_key TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, is_primary INTEGER NOT NULL DEFAULT 1,
      origin_account_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_account_owner_history (
      id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, from_owner_employee_id TEXT NOT NULL DEFAULT '',
      to_owner_employee_id TEXT NOT NULL, reason TEXT NOT NULL, changed_by TEXT NOT NULL, changed_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_account_merges (
      id TEXT PRIMARY KEY NOT NULL, source_account_id TEXT NOT NULL, target_account_id TEXT NOT NULL,
      reason TEXT NOT NULL, merged_by TEXT NOT NULL, merged_at INTEGER NOT NULL)`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_account_identity_account ON sales_account_identity_keys(account_id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_account_identity_primary ON sales_account_identity_keys(account_id) WHERE is_primary = 1"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_account_owner_history_account_changed ON sales_account_owner_history(account_id, changed_at)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_account_merge_source ON sales_account_merges(source_account_id)"),
    db.prepare(`INSERT OR IGNORE INTO sales_account_identity_keys (identity_key, account_id, is_primary, origin_account_id, created_at)
      SELECT CASE WHEN replace(replace(replace(trim(business_number), '-', ''), ' ', ''), '.', '') <> ''
        THEN 'business:' || replace(replace(replace(trim(business_number), '-', ''), ' ', ''), '.', '')
        ELSE 'name:' || lower(replace(replace(replace(replace(replace(replace(replace(trim(name), ' ', ''), '-', ''), '.', ''), '(', ''), ')', ''), '㈜', ''), '/', '')) END,
        id, 1, id, created_at FROM sales_accounts WHERE deleted_at IS NULL`),
    db.prepare(`UPDATE sales_account_contacts SET is_primary = 0 WHERE is_primary = 1 AND id NOT IN (
      SELECT MIN(id) FROM sales_account_contacts WHERE is_primary = 1 AND status = 'ACTIVE' GROUP BY account_id)`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_contact_single_primary ON sales_account_contacts(account_id) WHERE is_primary = 1 AND status = 'ACTIVE'"),
  ]);
}

async function outstandingForAccount(accountId: string) {
  const row = await db.prepare(`SELECT COALESCE(SUM(MAX(0, invoice.amount - COALESCE((
    SELECT SUM(allocation.amount) FROM sales_payment_allocations allocation
    JOIN sales_documents payment ON payment.id = allocation.payment_document_id
    WHERE allocation.invoice_document_id = invoice.id AND payment.status IN ('ACCEPTED','COMPLETED')), 0))), 0) AS amount
    FROM sales_documents invoice JOIN sales_opportunities opportunity ON opportunity.id = invoice.opportunity_id
    WHERE opportunity.account_id = ? AND invoice.document_type = 'INVOICE' AND invoice.status IN ('ACCEPTED','COMPLETED')`)
    .bind(accountId).first<{ amount: number }>();
  return Number(row?.amount ?? 0);
}

export async function GET(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "sales", "read");
  if (authorization.response) return authorization.response;
  const accountId = new URL(request.url).searchParams.get("accountId")?.trim() ?? "";
  const account = await db.prepare("SELECT * FROM sales_accounts WHERE id = ? AND deleted_at IS NULL").bind(accountId).first<AccountRow>();
  if (!account) return Response.json({ error: "거래처를 찾을 수 없습니다." }, { status: 404 });

  const [contacts, opportunities, activities, documents, ownerHistory, employees, activeAccounts] = await Promise.all([
    db.prepare("SELECT * FROM sales_account_contacts WHERE account_id = ? ORDER BY CASE status WHEN 'ACTIVE' THEN 1 ELSE 2 END, is_primary DESC, name").bind(accountId).all<ContactRow>(),
    db.prepare(`SELECT id, account_id, title, owner_employee_id, stage, expected_revenue, expected_cost, probability,
      expected_close_date, next_action, next_action_date, status, updated_at FROM sales_opportunities
      WHERE account_id = ? AND deleted_at IS NULL ORDER BY CASE status WHEN 'OPEN' THEN 1 ELSE 2 END, updated_at DESC`).bind(accountId).all<OpportunityRow>(),
    db.prepare(`SELECT activity.*, opportunity.title AS opportunity_title, contact.name AS contact_name
      FROM sales_opportunity_activities activity JOIN sales_opportunities opportunity ON opportunity.id = activity.opportunity_id
      LEFT JOIN sales_account_contacts contact ON contact.id = activity.contact_id
      WHERE opportunity.account_id = ? ORDER BY activity.occurred_at DESC, activity.created_at DESC`).bind(accountId).all<ActivityRow>(),
    db.prepare(`SELECT document.id, document.opportunity_id, opportunity.title AS opportunity_title, document.document_type,
      document.document_number, document.amount, document.status, document.issued_date, document.due_date,
      COALESCE((SELECT SUM(allocation.amount) FROM sales_payment_allocations allocation
        JOIN sales_documents payment ON payment.id = allocation.payment_document_id
        WHERE allocation.invoice_document_id = document.id AND payment.status IN ('ACCEPTED','COMPLETED')), 0) AS collected_amount
      FROM sales_documents document JOIN sales_opportunities opportunity ON opportunity.id = document.opportunity_id
      WHERE opportunity.account_id = ? ORDER BY document.created_at DESC`).bind(accountId).all<DocumentRow>(),
    db.prepare("SELECT * FROM sales_account_owner_history WHERE account_id = ? ORDER BY changed_at DESC").bind(accountId).all<OwnerHistoryRow>(),
    db.prepare("SELECT employee_id, name, department, status FROM hr_employee_records WHERE status NOT IN ('퇴직','입사 예정') ORDER BY name").all<EmployeeRow>(),
    db.prepare("SELECT * FROM sales_accounts WHERE deleted_at IS NULL ORDER BY name").all<AccountRow>(),
  ]);

  const employeeMap = new Map(employees.results.map((row) => [row.employee_id, row]));
  const accountKey = normalizeAccountKey(account.name, account.business_number);
  const duplicateCandidates = activeAccounts.results.filter((row) => row.id !== accountId
    && normalizeAccountKey(row.name, row.business_number) === accountKey).map((row) => toAccount(row, employeeMap.get(row.owner_employee_id)?.name ?? row.owner_employee_id));
  const mergeTargets = activeAccounts.results.filter((row) => row.id !== accountId && row.status === "ACTIVE")
    .map((row) => toAccount(row, employeeMap.get(row.owner_employee_id)?.name ?? row.owner_employee_id));
  const outstandingAmount = await outstandingForAccount(accountId);
  const latestActivity = activities.results[0]?.occurred_at ?? "";
  const lastContactDays = latestActivity ? Math.max(0, Math.floor((Date.now() - Date.parse(latestActivity)) / 86_400_000)) : null;
  const owner = employeeMap.get(account.owner_employee_id);
  const alerts = [
    ...(!account.owner_employee_id || !owner ? [{ code: "OWNER_MISSING", level: "HIGH", title: "영업 담당자 지정 필요" }] : []),
    ...(duplicateCandidates.length ? [{ code: "DUPLICATE", level: "HIGH", title: `중복 후보 ${duplicateCandidates.length}곳 확인` }] : []),
    ...(lastContactDays === null || lastContactDays >= 30 ? [{ code: "STALE_CONTACT", level: "NORMAL", title: lastContactDays === null ? "고객 접점 기록 없음" : `${lastContactDays}일간 고객 접점 없음` }] : []),
    ...(outstandingAmount > 0 ? [{ code: "OUTSTANDING", level: "HIGH", title: `미수금 ${outstandingAmount.toLocaleString("ko-KR")}원` }] : []),
  ];

  return Response.json({
    account: toAccount(account, owner?.name ?? account.owner_employee_id),
    metrics: { opportunityCount: opportunities.results.length, openOpportunityCount: opportunities.results.filter((row) => row.status === "OPEN").length,
      activityCount: activities.results.length, outstandingAmount, latestActivity, lastContactDays },
    contacts: contacts.results.map(toContact),
    opportunities: opportunities.results.map((row) => ({ id: row.id, title: row.title, ownerEmployeeId: row.owner_employee_id,
      ownerName: employeeMap.get(row.owner_employee_id)?.name ?? row.owner_employee_id, stage: row.stage, expectedRevenue: row.expected_revenue,
      expectedCost: row.expected_cost, probability: row.probability, expectedCloseDate: row.expected_close_date,
      nextAction: row.next_action, nextActionDate: row.next_action_date, status: row.status, updatedAt: row.updated_at })),
    activities: activities.results.map((row) => ({ id: row.id, opportunityId: row.opportunity_id, opportunityTitle: row.opportunity_title,
      contactId: row.contact_id, contactName: row.contact_name ?? "", activityType: row.activity_type, occurredAt: row.occurred_at,
      summary: row.summary, nextAction: row.next_action, nextActionDate: row.next_action_date, createdBy: row.created_by, createdAt: row.created_at })),
    documents: documents.results.map((row) => ({ id: row.id, opportunityId: row.opportunity_id, opportunityTitle: row.opportunity_title,
      documentType: row.document_type, documentNumber: row.document_number, amount: row.amount, status: row.status,
      issuedDate: row.issued_date, dueDate: row.due_date, collectedAmount: Number(row.collected_amount),
      outstandingAmount: row.document_type === "INVOICE" ? Math.max(0, row.amount - Number(row.collected_amount)) : 0 })),
    ownerHistory: ownerHistory.results.map((row) => ({ id: row.id, fromOwnerEmployeeId: row.from_owner_employee_id,
      fromOwnerName: employeeMap.get(row.from_owner_employee_id)?.name ?? row.from_owner_employee_id, toOwnerEmployeeId: row.to_owner_employee_id,
      toOwnerName: employeeMap.get(row.to_owner_employee_id)?.name ?? row.to_owner_employee_id, reason: row.reason,
      changedBy: row.changed_by, changedAt: row.changed_at })),
    employees: employees.results.map((row) => ({ id: row.employee_id, name: row.name, department: row.department, status: row.status })),
    duplicateCandidates, mergeTargets, alerts,
  });
}

export async function PUT(request: Request) {
  await ensureSchema();
  const body = await request.json() as Record<string, unknown>;
  const action = String(body.action ?? "");
  const permission = action === "MERGE_ACCOUNT" ? "delete" : "write";
  const authorization = await authorizeErpRequest(db, "sales", permission);
  if (authorization.response) return authorization.response;
  const accountId = String(body.accountId ?? "").trim();
  const before = await db.prepare("SELECT * FROM sales_accounts WHERE id = ? AND deleted_at IS NULL").bind(accountId).first<AccountRow>();
  if (!before) return Response.json({ error: "거래처를 찾을 수 없습니다." }, { status: 404 });
  const now = Date.now();

  if (action === "UPDATE_ACCOUNT") {
    const name = String(body.name ?? "").trim().slice(0, 200);
    const businessNumber = String(body.businessNumber ?? "").trim().slice(0, 30);
    const industry = String(body.industry ?? "").trim().slice(0, 100);
    const memo = String(body.memo ?? "").trim().slice(0, 3000);
    const status = String(body.status ?? before.status);
    if (name.length < 2 || !["ACTIVE", "INACTIVE"].includes(status)) return Response.json({ error: "거래처명과 상태를 확인해 주세요." }, { status: 400 });
    if (status === "INACTIVE" && before.status !== "INACTIVE") {
      const [openOpportunity, outstandingAmount] = await Promise.all([
        db.prepare("SELECT id FROM sales_opportunities WHERE account_id = ? AND status = 'OPEN' AND deleted_at IS NULL LIMIT 1").bind(accountId).first(),
        outstandingForAccount(accountId),
      ]);
      if (openOpportunity || outstandingAmount > 0) return Response.json({ error: "진행 중 영업기회 또는 미수금이 있는 거래처는 비활성화할 수 없습니다." }, { status: 409 });
    }
    const identityKey = normalizeAccountKey(name, businessNumber);
    const duplicate = await db.prepare("SELECT account_id FROM sales_account_identity_keys WHERE identity_key = ? AND account_id <> ?")
      .bind(identityKey, accountId).first<{ account_id: string }>();
    if (duplicate) return Response.json({ error: "같은 사업자번호 또는 거래처명의 거래처가 이미 있습니다." }, { status: 409 });
    try {
      await db.batch([
        db.prepare("UPDATE sales_account_identity_keys SET identity_key = ? WHERE account_id = ? AND is_primary = 1").bind(identityKey, accountId),
        db.prepare(`INSERT INTO sales_account_identity_keys (identity_key, account_id, is_primary, origin_account_id, created_at)
          SELECT ?, ?, 1, ?, ? WHERE NOT EXISTS (SELECT 1 FROM sales_account_identity_keys WHERE account_id = ? AND is_primary = 1)`)
          .bind(identityKey, accountId, accountId, now, accountId),
        db.prepare(`UPDATE sales_accounts SET name = ?, business_number = ?, industry = ?, status = ?, memo = ?, updated_at = ? WHERE id = ?`)
          .bind(name, businessNumber, industry, status, memo, now, accountId),
        db.prepare("UPDATE finance_master_partner_aliases SET source_name = ?, updated_at = ? WHERE mapping_key = ?")
          .bind(name, now, `SALES:${accountId}`),
      ]);
    } catch (error) {
      if (String(error).includes("UNIQUE")) return Response.json({ error: "같은 사업자번호 또는 거래처명의 거래처가 이미 있습니다." }, { status: 409 });
      throw error;
    }
    const after = await db.prepare("SELECT * FROM sales_accounts WHERE id = ?").bind(accountId).first<AccountRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "ACCOUNT_UPDATED", entityType: "salesAccount", entityId: accountId,
      before: toAccount(before), after: after ? toAccount(after) : body, reason: String(body.reason ?? "거래처 기준정보 수정") });
    return Response.json({ item: after ? toAccount(after) : null });
  }

  if (action === "REASSIGN_OWNER") {
    const toOwnerEmployeeId = String(body.toOwnerEmployeeId ?? "").trim();
    const reason = String(body.reason ?? "").trim().slice(0, 1000);
    if (reason.length < 10 || !toOwnerEmployeeId || toOwnerEmployeeId === before.owner_employee_id) return Response.json({ error: "새 담당자와 10자 이상의 이관 사유를 확인해 주세요." }, { status: 400 });
    const employee = await db.prepare("SELECT employee_id FROM hr_employee_records WHERE employee_id = ? AND status NOT IN ('퇴직','입사 예정')")
      .bind(toOwnerEmployeeId).first<{ employee_id: string }>();
    if (!employee) return Response.json({ error: "재직 중인 직원만 영업 담당자로 지정할 수 있습니다." }, { status: 400 });
    await db.batch([
      db.prepare("UPDATE sales_accounts SET owner_employee_id = ?, updated_at = ? WHERE id = ?").bind(toOwnerEmployeeId, now, accountId),
      db.prepare("UPDATE sales_opportunities SET owner_employee_id = ?, updated_at = ? WHERE account_id = ? AND status = 'OPEN' AND deleted_at IS NULL")
        .bind(toOwnerEmployeeId, now, accountId),
      db.prepare(`INSERT INTO sales_account_owner_history
        (id, account_id, from_owner_employee_id, to_owner_employee_id, reason, changed_by, changed_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), accountId, before.owner_employee_id, toOwnerEmployeeId, reason, authorization.principal.employeeId, now),
    ]);
    const after = await db.prepare("SELECT * FROM sales_accounts WHERE id = ?").bind(accountId).first<AccountRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "ACCOUNT_OWNER_REASSIGNED", entityType: "salesAccount", entityId: accountId,
      before: { ownerEmployeeId: before.owner_employee_id }, after: { ownerEmployeeId: toOwnerEmployeeId }, reason });
    return Response.json({ item: after ? toAccount(after) : null });
  }

  if (action === "MERGE_ACCOUNT") {
    const targetAccountId = String(body.targetAccountId ?? "").trim();
    const reason = String(body.reason ?? "").trim().slice(0, 1000);
    if (!targetAccountId || targetAccountId === accountId || reason.length < 10) return Response.json({ error: "병합 대상과 10자 이상의 병합 사유를 확인해 주세요." }, { status: 400 });
    const target = await db.prepare("SELECT * FROM sales_accounts WHERE id = ? AND status = 'ACTIVE' AND deleted_at IS NULL").bind(targetAccountId).first<AccountRow>();
    if (!target) return Response.json({ error: "활성 거래처만 병합 대상으로 선택할 수 있습니다." }, { status: 400 });
    const [sourceContacts, targetContacts] = await Promise.all([
      db.prepare("SELECT * FROM sales_account_contacts WHERE account_id = ?").bind(accountId).all<ContactRow>(),
      db.prepare("SELECT * FROM sales_account_contacts WHERE account_id = ?").bind(targetAccountId).all<ContactRow>(),
    ]);
    const targetByKey = new Map(targetContacts.results.map((row) => [row.contact_key, row]));
    const targetHasPrimary = targetContacts.results.some((row) => row.status === "ACTIVE" && row.is_primary === 1);
    const movable = sourceContacts.results.filter((row) => !targetByKey.has(row.contact_key));
    const sourcePrimary = sourceContacts.results.find((row) => row.status === "ACTIVE" && row.is_primary === 1);
    const chosenPrimary = !targetHasPrimary && sourcePrimary
      ? targetByKey.get(sourcePrimary.contact_key)?.id ?? movable.find((row) => row.id === sourcePrimary.id)?.id ?? ""
      : "";
    const statements = [
      db.prepare("UPDATE sales_account_contacts SET is_primary = 0, updated_at = ? WHERE account_id = ?").bind(now, accountId),
      ...sourceContacts.results.flatMap((contact) => {
        const existing = targetByKey.get(contact.contact_key);
        return existing ? [
          db.prepare("UPDATE sales_opportunity_activities SET contact_id = ? WHERE contact_id = ?").bind(existing.id, contact.id),
          ...(contact.status === "ACTIVE" ? [db.prepare("UPDATE sales_account_contacts SET status = 'ACTIVE', updated_at = ? WHERE id = ?").bind(now, existing.id)] : []),
          db.prepare("UPDATE sales_account_contacts SET status = 'INACTIVE', is_primary = 0, updated_at = ? WHERE id = ?").bind(now, contact.id),
        ] : [db.prepare("UPDATE sales_account_contacts SET account_id = ?, updated_at = ? WHERE id = ?").bind(targetAccountId, now, contact.id)];
      }),
      ...(chosenPrimary ? [db.prepare("UPDATE sales_account_contacts SET is_primary = 1, updated_at = ? WHERE id = ?").bind(now, chosenPrimary)] : []),
      db.prepare("UPDATE sales_opportunities SET account_id = ?, updated_at = ? WHERE account_id = ? AND deleted_at IS NULL").bind(targetAccountId, now, accountId),
      db.prepare("UPDATE sales_account_identity_keys SET is_primary = 0, account_id = ? WHERE account_id = ?").bind(targetAccountId, accountId),
      db.prepare("UPDATE sales_accounts SET updated_at = ? WHERE id = ?").bind(now, targetAccountId),
      db.prepare("UPDATE sales_accounts SET status = 'MERGED', deleted_at = ?, updated_at = ? WHERE id = ?").bind(now, now, accountId),
      db.prepare(`INSERT INTO sales_account_merges (id, source_account_id, target_account_id, reason, merged_by, merged_at)
        VALUES (?, ?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), accountId, targetAccountId, reason, authorization.principal.employeeId, now),
    ];
    await db.batch(statements);
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "ACCOUNT_MERGED", entityType: "salesAccount", entityId: accountId,
      before: toAccount(before), after: { targetAccountId, targetAccountName: target.name, movedOpportunityCount: "all", movedContactCount: movable.length }, reason });
    return Response.json({ merged: true, sourceAccountId: accountId, targetAccountId });
  }

  return Response.json({ error: "지원하지 않는 거래처 작업입니다." }, { status: 400 });
}
