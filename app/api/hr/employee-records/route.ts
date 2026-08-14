import { env } from "cloudflare:workers";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";
import { applyDuePersonnelActions } from "../../../hr-personnel-actions";

type EmployeeRecordRow = {
  employee_id: string;
  name: string;
  birth: string;
  email: string;
  phone: string;
  address: string;
  department: string;
  manager: string;
  employment_type: string;
  join_date: string;
  position: string;
  job_title: string;
  status: string;
  history_json: string;
  retirement_json: string | null;
  updated_at: number;
};

type HrBindings = { DB: D1Database };
const db = (env as unknown as HrBindings).DB;

async function ensureSchema() {
  await db.prepare(`CREATE TABLE IF NOT EXISTS hr_employee_records (
    employee_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    birth TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT NOT NULL,
    address TEXT NOT NULL,
    department TEXT NOT NULL,
    manager TEXT NOT NULL,
      employment_type TEXT NOT NULL,
      join_date TEXT NOT NULL DEFAULT '',
      position TEXT NOT NULL,
      job_title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '재직',
      history_json TEXT NOT NULL DEFAULT '[]',
      retirement_json TEXT,
      updated_at INTEGER NOT NULL
  )`).run();
  const columns = await db.prepare("PRAGMA table_info(hr_employee_records)").all<{ name: string }>();
  const existing = new Set(columns.results.map((column) => column.name));
  const additions = [
    ["join_date", "TEXT NOT NULL DEFAULT ''"],
    ["status", "TEXT NOT NULL DEFAULT '재직'"],
    ["history_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["retirement_json", "TEXT"],
  ].filter(([name]) => !existing.has(name));
  for (const [name, definition] of additions) {
    await db.prepare(`ALTER TABLE hr_employee_records ADD COLUMN ${name} ${definition}`).run();
  }
}

function parseJson<T>(value: string | null, fallback: T): T {
  try { return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

function toRecord(row: EmployeeRecordRow) {
  return {
    employeeId: row.employee_id,
    name: row.name,
    birth: row.birth,
    email: row.email,
    phone: row.phone,
    address: row.address,
    department: row.department,
    manager: row.manager,
    type: row.employment_type,
    joinDate: row.join_date,
    position: row.position,
    jobTitle: row.job_title,
    status: row.status,
    history: parseJson(row.history_json, []),
    retirement: parseJson(row.retirement_json, null),
    updatedAt: row.updated_at,
  };
}

export async function GET() {
  const auth = await authorizeErpRequest(db, "hr", "read");
  if (auth.response) return auth.response;
  await ensureSchema();
  await applyDuePersonnelActions(db);
  const result = await db.prepare(`SELECT employee_id, name, birth, email, phone, address,
    department, manager, employment_type, join_date, position, job_title, status, history_json, retirement_json, updated_at
    FROM hr_employee_records ORDER BY employee_id`).all<EmployeeRecordRow>();
  return Response.json({ records: result.results.map(toRecord) });
}

export async function PUT(request: Request) {
  const auth = await authorizeErpRequest(db, "hr", "write");
  if (auth.response) return auth.response;
  await ensureSchema();
  const body = await request.json() as Record<string, unknown>;
  const stringValue = (key: string) => typeof body[key] === "string" ? String(body[key]) : "";
  const employeeId = stringValue("employeeId").trim();
  const name = stringValue("name").trim();

  if (!employeeId || !name) {
    return Response.json({ error: "직원 ID와 이름이 필요합니다." }, { status: 400 });
  }

  const record = {
    employeeId,
    name,
    birth: stringValue("birth"),
    email: stringValue("email"),
    phone: stringValue("phone"),
    address: stringValue("address"),
    department: stringValue("department"),
    manager: stringValue("manager"),
    type: stringValue("type"),
    joinDate: stringValue("joinDate"),
    position: stringValue("position"),
    jobTitle: stringValue("jobTitle"),
    status: stringValue("status") || "재직",
    history: Array.isArray(body.history) ? body.history : [],
    retirement: body.retirement && typeof body.retirement === "object" ? body.retirement : null,
    updatedAt: Date.now(),
  };

  const before = await db.prepare(`SELECT employee_id, name, birth, email, phone, address,
    department, manager, employment_type, join_date, position, job_title, status, history_json, retirement_json, updated_at
    FROM hr_employee_records WHERE employee_id = ?`).bind(employeeId).first<EmployeeRecordRow>();

  await db.prepare(`INSERT INTO hr_employee_records
    (employee_id, name, birth, email, phone, address, department, manager, employment_type, join_date,
      position, job_title, status, history_json, retirement_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(employee_id) DO UPDATE SET
      name = excluded.name,
      birth = excluded.birth,
      email = excluded.email,
      phone = excluded.phone,
      address = excluded.address,
      department = excluded.department,
      manager = excluded.manager,
      employment_type = excluded.employment_type,
      join_date = excluded.join_date,
      position = excluded.position,
      job_title = excluded.job_title,
      status = excluded.status,
      history_json = excluded.history_json,
      retirement_json = excluded.retirement_json,
      updated_at = excluded.updated_at`)
    .bind(record.employeeId, record.name, record.birth, record.email, record.phone, record.address,
      record.department, record.manager, record.type, record.joinDate, record.position, record.jobTitle,
      record.status, JSON.stringify(record.history), record.retirement ? JSON.stringify(record.retirement) : null, record.updatedAt)
    .run();

  await writeErpAudit(db, {
    principal: auth.principal,
    module: "hr",
    action: before ? "UPDATE" : "CREATE",
    entityType: "EMPLOYEE_RECORD",
    entityId: employeeId,
    before: before ? toRecord(before) : undefined,
    after: record,
  });
  return Response.json({ record });
}
