import { env } from "cloudflare:workers";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";

type LeaderRow = {
  organization_id: string;
  leader_employee_id: string | null;
  updated_at: number;
};

type HrBindings = {
  DB: D1Database;
};

const db = (env as unknown as HrBindings).DB;

async function ensureSchema() {
  await db.prepare(`CREATE TABLE IF NOT EXISTS hr_organization_leaders (
    organization_id TEXT PRIMARY KEY,
    leader_employee_id TEXT,
    updated_at INTEGER NOT NULL
  )`).run();
}

function toLeader(row: LeaderRow) {
  return {
    organizationId: row.organization_id,
    leaderEmployeeId: row.leader_employee_id,
    updatedAt: row.updated_at,
  };
}

export async function GET() {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "hr", "read");
  if (authorization.response) return authorization.response;
  const result = await db.prepare(`SELECT organization_id, leader_employee_id, updated_at
    FROM hr_organization_leaders ORDER BY organization_id`).all<LeaderRow>();
  return Response.json({ leaders: result.results.map(toLeader) });
}

export async function PUT(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "hr", "write");
  if (authorization.response) return authorization.response;
  const body = await request.json() as { organizationId?: unknown; leaderEmployeeId?: unknown };
  const organizationId = typeof body.organizationId === "string" ? body.organizationId.trim() : "";
  const leaderEmployeeId = typeof body.leaderEmployeeId === "string" && body.leaderEmployeeId.trim()
    ? body.leaderEmployeeId.trim()
    : null;

  if (!organizationId) {
    return Response.json({ error: "organizationId is required." }, { status: 400 });
  }

  const updatedAt = Date.now();
  const before = await db.prepare(`SELECT organization_id, leader_employee_id, updated_at
    FROM hr_organization_leaders WHERE organization_id = ?`).bind(organizationId).first<LeaderRow>();
  await db.prepare(`INSERT INTO hr_organization_leaders (organization_id, leader_employee_id, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(organization_id) DO UPDATE SET
      leader_employee_id = excluded.leader_employee_id,
      updated_at = excluded.updated_at`)
    .bind(organizationId, leaderEmployeeId, updatedAt)
    .run();

  const after = toLeader({
    organization_id: organizationId,
    leader_employee_id: leaderEmployeeId,
    updated_at: updatedAt,
  });
  await writeErpAudit(db, {
    principal: authorization.principal,
    module: "hr",
    action: "ORGANIZATION_LEADER_UPDATED",
    entityType: "organizationLeader",
    entityId: organizationId,
    before: before ? toLeader(before) : null,
    after,
  });

  return Response.json({ leader: after });
}
