import { env } from "cloudflare:workers";
import { companyEmployees } from "../../../hr-company-data";

type D1DatabaseLike = {
  prepare: (query: string) => {
    bind: (...values: unknown[]) => unknown;
    all: <T>() => Promise<{ results?: T[] }>;
  };
  batch: (statements: unknown[]) => Promise<unknown>;
};

type AuthorizedUserRow = {
  employeeId: string;
  createdAt: number;
};

const registeredEmployeeIds = new Set(companyEmployees.map((employee) => employee.id));
const currentAdministratorId = "gc.kim";

function getDatabase() {
  return (env as unknown as { DB: D1DatabaseLike }).DB;
}

async function ensureSchema(db: D1DatabaseLike) {
  const createTable = db.prepare(`
    CREATE TABLE IF NOT EXISTS hr_authorized_users (
      employee_id TEXT PRIMARY KEY NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  const seedAdministrator = db.prepare(`
    INSERT OR IGNORE INTO hr_authorized_users (employee_id, created_at)
    VALUES (?, ?)
  `).bind(currentAdministratorId, Date.now());
  await db.batch([createTable, seedAdministrator]);
}

export async function GET() {
  const db = getDatabase();
  await ensureSchema(db);
  const result = await db.prepare(`
    SELECT employee_id AS employeeId, created_at AS createdAt
    FROM hr_authorized_users
    ORDER BY created_at ASC
  `).all<AuthorizedUserRow>();
  return Response.json({ users: result.results ?? [] });
}

export async function POST(request: Request) {
  const payload = await request.json() as { employeeId?: string };
  const employeeId = payload.employeeId?.trim() ?? "";
  if (!registeredEmployeeIds.has(employeeId)) {
    return Response.json({ error: "회사에 등록된 인물만 사용자로 추가할 수 있습니다." }, { status: 400 });
  }

  const db = getDatabase();
  await ensureSchema(db);
  await db.batch([
    db.prepare(`
      INSERT OR IGNORE INTO hr_authorized_users (employee_id, created_at)
      VALUES (?, ?)
    `).bind(employeeId, Date.now()),
  ]);
  return Response.json({ employeeId }, { status: 201 });
}

export async function DELETE(request: Request) {
  const payload = await request.json() as { employeeId?: string };
  const employeeId = payload.employeeId?.trim() ?? "";
  if (employeeId === currentAdministratorId) {
    return Response.json({ error: "현재 관리자는 삭제할 수 없습니다." }, { status: 400 });
  }

  const db = getDatabase();
  await ensureSchema(db);
  await db.batch([
    db.prepare("DELETE FROM hr_authorized_users WHERE employee_id = ?").bind(employeeId),
  ]);
  return Response.json({ employeeId });
}
