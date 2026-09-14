import { env } from "cloudflare:workers";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";

type TemplateRow = {
  template_id: string;
  body: string;
  updated_at: number;
};

type HrBindings = {
  DB: D1Database;
};

const db = (env as unknown as HrBindings).DB;

/** 지원자에게 보내는 안내문 종류. 저장된 문구가 없으면 화면이 내장 기본 문구를 그대로 쓴다.
 *  그래서 이 표는 "기본값을 덮어쓴 것"만 담는다 — 비어 있는 것이 정상 상태다. */
const TEMPLATE_IDS = ["OFFER", "ONBOARDING", "REJECTION", "INTERVIEW"];

const MAX_TEMPLATE_LENGTH = 8000;

async function ensureSchema() {
  await db.prepare(`CREATE TABLE IF NOT EXISTS hr_message_templates (
    template_id TEXT PRIMARY KEY,
    body TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`).run();
}

function toTemplate(row: TemplateRow) {
  return { templateId: row.template_id, body: row.body, updatedAt: row.updated_at };
}

export async function GET() {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "hr", "read");
  if (authorization.response) return authorization.response;
  const result = await db.prepare(`SELECT template_id, body, updated_at
    FROM hr_message_templates ORDER BY template_id`).all<TemplateRow>();
  return Response.json({ templates: result.results.map(toTemplate) });
}

export async function PUT(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "hr", "write");
  if (authorization.response) return authorization.response;
  const payload = await request.json() as { templateId?: unknown; body?: unknown };
  const templateId = typeof payload.templateId === "string" ? payload.templateId.trim() : "";
  const body = typeof payload.body === "string" ? payload.body : "";

  if (!TEMPLATE_IDS.includes(templateId)) {
    return Response.json({ error: "알 수 없는 안내문 종류입니다." }, { status: 400 });
  }
  if (!body.trim()) {
    return Response.json({ error: "문구가 비어 있습니다." }, { status: 400 });
  }
  if (body.length > MAX_TEMPLATE_LENGTH) {
    return Response.json({ error: `문구는 ${MAX_TEMPLATE_LENGTH}자를 넘을 수 없습니다.` }, { status: 400 });
  }

  const updatedAt = Date.now();
  const before = await db.prepare(`SELECT template_id, body, updated_at
    FROM hr_message_templates WHERE template_id = ?`).bind(templateId).first<TemplateRow>();
  await db.prepare(`INSERT INTO hr_message_templates (template_id, body, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(template_id) DO UPDATE SET
      body = excluded.body,
      updated_at = excluded.updated_at`)
    .bind(templateId, body, updatedAt)
    .run();

  const after = toTemplate({ template_id: templateId, body, updated_at: updatedAt });
  await writeErpAudit(db, {
    principal: authorization.principal,
    module: "hr",
    action: "MESSAGE_TEMPLATE_UPDATED",
    entityType: "messageTemplate",
    entityId: templateId,
    before: before ? toTemplate(before) : null,
    after,
  });

  return Response.json({ template: after });
}

/** 저장한 문구를 지우면 화면이 다시 내장 기본 문구로 돌아간다. */
export async function DELETE(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "hr", "write");
  if (authorization.response) return authorization.response;
  const templateId = new URL(request.url).searchParams.get("templateId")?.trim() ?? "";

  if (!TEMPLATE_IDS.includes(templateId)) {
    return Response.json({ error: "알 수 없는 안내문 종류입니다." }, { status: 400 });
  }

  const before = await db.prepare(`SELECT template_id, body, updated_at
    FROM hr_message_templates WHERE template_id = ?`).bind(templateId).first<TemplateRow>();
  if (!before) return Response.json({ templateId, reset: true });

  await db.prepare("DELETE FROM hr_message_templates WHERE template_id = ?").bind(templateId).run();
  await writeErpAudit(db, {
    principal: authorization.principal,
    module: "hr",
    action: "MESSAGE_TEMPLATE_RESET",
    entityType: "messageTemplate",
    entityId: templateId,
    before: toTemplate(before),
    after: null,
  });

  return Response.json({ templateId, reset: true });
}
