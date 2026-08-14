import { env } from "cloudflare:workers";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;

type OpportunityRow = { id: string; account_id: string; title: string; stage: string; status: string; next_action: string; next_action_date: string; account_name?: string | null };
type ContactRow = { id: string; account_id: string; name: string; title: string; email: string; phone: string; is_primary: number; status: string; created_by: string; created_at: number; updated_at: number };
type ActivityRow = { id: string; opportunity_id: string; contact_id: string; activity_type: string; occurred_at: string; summary: string; next_action: string; next_action_date: string; created_by: string; created_at: number; contact_name?: string | null };
type StageHistoryRow = { id: string; opportunity_id: string; from_stage: string; to_stage: string; reason: string; changed_by: string; changed_at: number };

async function ensureSchema() {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_account_contacts (
      id TEXT PRIMARY KEY NOT NULL, account_id TEXT NOT NULL, contact_key TEXT NOT NULL, name TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
      is_primary INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'ACTIVE', created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_opportunity_activities (
      id TEXT PRIMARY KEY NOT NULL, opportunity_id TEXT NOT NULL, contact_id TEXT NOT NULL DEFAULT '',
      activity_type TEXT NOT NULL, occurred_at TEXT NOT NULL, summary TEXT NOT NULL,
      next_action TEXT NOT NULL DEFAULT '', next_action_date TEXT NOT NULL DEFAULT '', created_by TEXT NOT NULL, created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_opportunity_stage_history (
      id TEXT PRIMARY KEY NOT NULL, opportunity_id TEXT NOT NULL, from_stage TEXT NOT NULL DEFAULT '',
      to_stage TEXT NOT NULL, reason TEXT NOT NULL, changed_by TEXT NOT NULL, changed_at INTEGER NOT NULL)`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_contact_account_key ON sales_account_contacts(account_id, contact_key)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_contact_account_status ON sales_account_contacts(account_id, status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_activity_opportunity_occurred ON sales_opportunity_activities(opportunity_id, occurred_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_stage_history_opportunity_changed ON sales_opportunity_stage_history(opportunity_id, changed_at)"),
  ]);
  await db.prepare(`UPDATE sales_account_contacts SET is_primary = 0 WHERE is_primary = 1 AND id NOT IN (
    SELECT MIN(id) FROM sales_account_contacts WHERE is_primary = 1 AND status = 'ACTIVE' GROUP BY account_id)`).run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_contact_single_primary ON sales_account_contacts(account_id) WHERE is_primary = 1 AND status = 'ACTIVE'").run();
}

const toContact = (row: ContactRow) => ({
  id: row.id, accountId: row.account_id, name: row.name, title: row.title, email: row.email, phone: row.phone,
  isPrimary: Boolean(row.is_primary), status: row.status, createdBy: row.created_by, createdAt: row.created_at,
});
const toActivity = (row: ActivityRow) => ({
  id: row.id, opportunityId: row.opportunity_id, contactId: row.contact_id, contactName: row.contact_name ?? "",
  activityType: row.activity_type, occurredAt: row.occurred_at, summary: row.summary,
  nextAction: row.next_action, nextActionDate: row.next_action_date, createdBy: row.created_by, createdAt: row.created_at,
});
const toHistory = (row: StageHistoryRow) => ({
  id: row.id, opportunityId: row.opportunity_id, fromStage: row.from_stage, toStage: row.to_stage,
  reason: row.reason, changedBy: row.changed_by, changedAt: row.changed_at,
});

const contactKey = (name: string, email: string, phone: string) => {
  const normalizedEmail = email.trim().toLowerCase();
  const normalizedPhone = phone.replace(/\D/g, "");
  const normalizedName = name.toLowerCase().replace(/[^0-9a-z가-힣]/g, "");
  return normalizedEmail ? `email:${normalizedEmail}` : normalizedPhone ? `phone:${normalizedPhone}` : `name:${normalizedName}`;
};

async function findOpportunity(id: string) {
  return db.prepare(`SELECT o.id, o.account_id, o.title, o.stage, o.status, o.next_action, o.next_action_date, a.name AS account_name
    FROM sales_opportunities o LEFT JOIN sales_accounts a ON a.id = o.account_id
    WHERE o.id = ? AND o.deleted_at IS NULL`).bind(id).first<OpportunityRow>();
}

export async function GET(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "sales", "read");
  if (authorization.response) return authorization.response;
  const opportunityId = new URL(request.url).searchParams.get("opportunityId")?.trim() ?? "";
  const opportunity = await findOpportunity(opportunityId);
  if (!opportunity) return Response.json({ error: "영업 건을 찾을 수 없습니다." }, { status: 404 });
  const [contacts, activities, history] = await Promise.all([
    db.prepare("SELECT * FROM sales_account_contacts WHERE account_id = ? AND status = 'ACTIVE' ORDER BY is_primary DESC, name")
      .bind(opportunity.account_id).all<ContactRow>(),
    db.prepare(`SELECT activity.*, contact.name AS contact_name FROM sales_opportunity_activities activity
      LEFT JOIN sales_account_contacts contact ON contact.id = activity.contact_id
      WHERE activity.opportunity_id = ? ORDER BY activity.occurred_at DESC, activity.created_at DESC`)
      .bind(opportunityId).all<ActivityRow>(),
    db.prepare("SELECT * FROM sales_opportunity_stage_history WHERE opportunity_id = ? ORDER BY changed_at DESC")
      .bind(opportunityId).all<StageHistoryRow>(),
  ]);
  return Response.json({
    opportunity: { id: opportunity.id, accountId: opportunity.account_id, accountName: opportunity.account_name ?? "", title: opportunity.title,
      stage: opportunity.stage, status: opportunity.status, nextAction: opportunity.next_action, nextActionDate: opportunity.next_action_date },
    contacts: contacts.results.map(toContact), activities: activities.results.map(toActivity), stageHistory: history.results.map(toHistory),
  });
}

export async function POST(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "sales", "write");
  if (authorization.response) return authorization.response;
  const body = await request.json() as Record<string, unknown>;
  const resource = String(body.resource ?? "");
  const now = Date.now();
  const id = crypto.randomUUID();

  if (resource === "contact") {
    const accountId = String(body.accountId ?? "").trim();
    const name = String(body.name ?? "").trim();
    const title = String(body.title ?? "").trim().slice(0, 100);
    const email = String(body.email ?? "").trim().toLowerCase().slice(0, 200);
    const phone = String(body.phone ?? "").trim().slice(0, 50);
    const account = await db.prepare("SELECT id FROM sales_accounts WHERE id = ? AND deleted_at IS NULL").bind(accountId).first<{ id: string }>();
    if (!account || name.length < 2 || (!email && !phone)) return Response.json({ error: "거래처, 담당자 이름과 이메일 또는 연락처를 확인해 주세요." }, { status: 400 });
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return Response.json({ error: "이메일 형식을 확인해 주세요." }, { status: 400 });
    try {
      const statements = [
        ...(body.isPrimary ? [db.prepare("UPDATE sales_account_contacts SET is_primary = 0, updated_at = ? WHERE account_id = ? AND is_primary = 1").bind(now, accountId)] : []),
        db.prepare(`INSERT INTO sales_account_contacts
          (id, account_id, contact_key, name, title, email, phone, is_primary, status, created_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`)
          .bind(id, accountId, contactKey(name, email, phone), name, title, email, phone, body.isPrimary ? 1 : 0,
            authorization.principal.employeeId, now, now),
      ];
      await db.batch(statements);
    } catch (error) {
      if (String(error).includes("UNIQUE")) return Response.json({ error: "같은 거래처에 동일한 이메일·연락처의 담당자가 이미 있습니다." }, { status: 409 });
      throw error;
    }
    const row = await db.prepare("SELECT * FROM sales_account_contacts WHERE id = ?").bind(id).first<ContactRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "ACCOUNT_CONTACT_CREATED", entityType: "salesAccountContact", entityId: id, after: row ? toContact(row) : body });
    return Response.json({ item: row ? toContact(row) : null }, { status: 201 });
  }

  if (resource === "activity") {
    const opportunityId = String(body.opportunityId ?? "").trim();
    const opportunity = await findOpportunity(opportunityId);
    const activityType = String(body.activityType ?? "").trim();
    const contactId = String(body.contactId ?? "").trim();
    const summary = String(body.summary ?? "").trim().slice(0, 3000);
    const occurredAt = String(body.occurredAt ?? "").trim();
    const nextAction = String(body.nextAction ?? "").trim().slice(0, 500);
    const nextActionDate = String(body.nextActionDate ?? "").trim();
    if (!opportunity || opportunity.status !== "OPEN") return Response.json({ error: "진행 중인 영업 건만 활동을 기록할 수 있습니다." }, { status: 409 });
    if (!["CALL", "EMAIL", "MEETING", "NOTE"].includes(activityType) || summary.length < 5 || !occurredAt || Number.isNaN(Date.parse(occurredAt))) {
      return Response.json({ error: "활동 종류, 발생 일시와 5자 이상의 상담 내용을 확인해 주세요." }, { status: 400 });
    }
    if (Boolean(nextAction) !== Boolean(nextActionDate) || (nextActionDate && !/^\d{4}-\d{2}-\d{2}$/.test(nextActionDate))) {
      return Response.json({ error: "다음 행동과 다음 행동 기한을 함께 입력해 주세요." }, { status: 400 });
    }
    if (contactId) {
      const contact = await db.prepare("SELECT id FROM sales_account_contacts WHERE id = ? AND account_id = ? AND status = 'ACTIVE'")
        .bind(contactId, opportunity.account_id).first<{ id: string }>();
      if (!contact) return Response.json({ error: "해당 거래처의 활성 고객 담당자만 선택할 수 있습니다." }, { status: 400 });
    }
    const result = await db.batch([
      db.prepare(`INSERT INTO sales_opportunity_activities
        (id, opportunity_id, contact_id, activity_type, occurred_at, summary, next_action, next_action_date, created_by, created_at)
        SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS
          (SELECT 1 FROM sales_opportunities WHERE id = ? AND status = 'OPEN' AND deleted_at IS NULL)`)
        .bind(id, opportunityId, contactId, activityType, occurredAt, summary, nextAction, nextActionDate,
          authorization.principal.employeeId, now, opportunityId),
      db.prepare("UPDATE sales_opportunities SET next_action = ?, next_action_date = ?, updated_at = ? WHERE id = ? AND status = 'OPEN'")
        .bind(nextAction, nextActionDate, now, opportunityId),
    ]);
    if ((result[0].meta.changes ?? 0) < 1 || (result[1].meta.changes ?? 0) < 1) {
      return Response.json({ error: "영업 건 상태가 변경되었습니다. 새로고침 후 다시 확인해 주세요." }, { status: 409 });
    }
    const row = await db.prepare(`SELECT activity.*, contact.name AS contact_name FROM sales_opportunity_activities activity
      LEFT JOIN sales_account_contacts contact ON contact.id = activity.contact_id WHERE activity.id = ?`).bind(id).first<ActivityRow>();
    await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: "OPPORTUNITY_ACTIVITY_RECORDED", entityType: "salesOpportunityActivity", entityId: id, after: row ? toActivity(row) : body });
    return Response.json({ item: row ? toActivity(row) : null }, { status: 201 });
  }

  return Response.json({ error: "지원하지 않는 CRM 항목입니다." }, { status: 400 });
}

export async function PUT(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "sales", "write");
  if (authorization.response) return authorization.response;
  const body = await request.json() as Record<string, unknown>;
  const id = String(body.id ?? "").trim();
  const before = await db.prepare("SELECT * FROM sales_account_contacts WHERE id = ?").bind(id).first<ContactRow>();
  if (!before) return Response.json({ error: "고객 담당자를 찾을 수 없습니다." }, { status: 404 });
  const status = String(body.status ?? before.status);
  const isPrimary = Boolean(body.isPrimary) && status === "ACTIVE";
  if (!["ACTIVE", "INACTIVE"].includes(status)) return Response.json({ error: "담당자 상태를 확인해 주세요." }, { status: 400 });
  const now = Date.now();
  await db.batch([
    ...(isPrimary ? [db.prepare("UPDATE sales_account_contacts SET is_primary = 0, updated_at = ? WHERE account_id = ? AND id <> ? AND is_primary = 1")
      .bind(now, before.account_id, id)] : []),
    db.prepare("UPDATE sales_account_contacts SET status = ?, is_primary = ?, updated_at = ? WHERE id = ?")
      .bind(status, isPrimary ? 1 : 0, now, id),
  ]);
  const after = await db.prepare("SELECT * FROM sales_account_contacts WHERE id = ?").bind(id).first<ContactRow>();
  await writeErpAudit(db, { principal: authorization.principal, module: "sales", action: status === "INACTIVE" ? "ACCOUNT_CONTACT_DEACTIVATED" : isPrimary ? "ACCOUNT_CONTACT_PRIMARY_CHANGED" : "ACCOUNT_CONTACT_UPDATED",
    entityType: "salesAccountContact", entityId: id, before: toContact(before), after: after ? toContact(after) : body,
    reason: String(body.reason ?? (status === "INACTIVE" ? "고객 담당자 비활성화" : "대표 담당자 변경")) });
  return Response.json({ item: after ? toContact(after) : null });
}
