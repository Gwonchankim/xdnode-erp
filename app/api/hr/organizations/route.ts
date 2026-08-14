import { env } from "cloudflare:workers";
import { companyOrganizations } from "../../../hr-company-data";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";

type OrganizationRow = {
  organization_id: string;
  name: string;
  description: string;
  updated_at: number;
};

type HrBindings = { DB: D1Database };
const db = (env as unknown as HrBindings).DB;

async function ensureSchema() {
  await db.prepare(`CREATE TABLE IF NOT EXISTS hr_organization_records (
    organization_id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`).run();
}

function toOrganization(row: OrganizationRow) {
  return {
    organizationId: row.organization_id,
    name: row.name,
    description: row.description,
    updatedAt: row.updated_at,
  };
}

export async function GET() {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "hr", "read");
  if (authorization.response) return authorization.response;
  const result = await db.prepare(`SELECT organization_id, name, description, updated_at
    FROM hr_organization_records ORDER BY organization_id`).all<OrganizationRow>();
  return Response.json({ organizations: result.results.map(toOrganization) });
}

export async function PUT(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "hr", "write");
  if (authorization.response) return authorization.response;
  const body = await request.json() as Record<string, unknown>;
  const organizationId = typeof body.organizationId === "string" ? body.organizationId.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = typeof body.description === "string" && body.description.trim()
    ? body.description.trim()
    : "조직 설명 미입력";
  const clientPreviousName = typeof body.previousName === "string" ? body.previousName.trim() : "";

  if (!organizationId || !name) {
    return Response.json({ error: "조직 ID와 조직명이 필요합니다." }, { status: 400 });
  }

  const duplicateInBase = companyOrganizations.some((organization) => organization.id !== organizationId && organization.name === name);
  const duplicateInRecords = await db.prepare(`SELECT organization_id FROM hr_organization_records
    WHERE name = ? AND organization_id <> ? LIMIT 1`).bind(name, organizationId).first<{ organization_id: string }>();
  if (duplicateInBase || duplicateInRecords) {
    return Response.json({ error: "이미 사용 중인 조직명입니다." }, { status: 409 });
  }

  const existing = await db.prepare(`SELECT organization_id, name, description, updated_at
    FROM hr_organization_records WHERE organization_id = ?`).bind(organizationId).first<OrganizationRow>();
  const baseOrganization = companyOrganizations.find((organization) => organization.id === organizationId);
  const previousName = existing?.name ?? baseOrganization?.name ?? clientPreviousName;
  const updatedAt = Date.now();

  const statements = [
    db.prepare(`INSERT INTO hr_organization_records (organization_id, name, description, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(organization_id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        updated_at = excluded.updated_at`).bind(organizationId, name, description, updatedAt),
  ];
  if (previousName && previousName !== name) {
    statements.push(db.prepare(`UPDATE hr_employee_records SET department = ?, updated_at = ?
      WHERE department = ?`).bind(name, updatedAt, previousName));
  }
  await db.batch(statements);

  const after = toOrganization({
    organization_id: organizationId,
    name,
    description,
    updated_at: updatedAt,
  });
  await writeErpAudit(db, {
    principal: authorization.principal,
    module: "hr",
    action: "ORGANIZATION_UPDATED",
    entityType: "organization",
    entityId: organizationId,
    before: existing ? toOrganization(existing) : baseOrganization ? {
      organizationId,
      name: baseOrganization.name,
      description: baseOrganization.description,
    } : null,
    after,
  });

  return Response.json({ organization: after });
}
