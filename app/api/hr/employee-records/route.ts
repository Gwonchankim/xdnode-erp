import { env } from "cloudflare:workers";

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
  position: string;
  job_title: string;
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
    position TEXT NOT NULL,
    job_title TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`).run();
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
    position: row.position,
    jobTitle: row.job_title,
    updatedAt: row.updated_at,
  };
}

export async function GET() {
  await ensureSchema();
  const result = await db.prepare(`SELECT employee_id, name, birth, email, phone, address,
    department, manager, employment_type, position, job_title, updated_at
    FROM hr_employee_records ORDER BY employee_id`).all<EmployeeRecordRow>();
  return Response.json({ records: result.results.map(toRecord) });
}

export async function PUT(request: Request) {
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
    position: stringValue("position"),
    jobTitle: stringValue("jobTitle"),
    updatedAt: Date.now(),
  };

  await db.prepare(`INSERT INTO hr_employee_records
    (employee_id, name, birth, email, phone, address, department, manager, employment_type, position, job_title, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(employee_id) DO UPDATE SET
      name = excluded.name,
      birth = excluded.birth,
      email = excluded.email,
      phone = excluded.phone,
      address = excluded.address,
      department = excluded.department,
      manager = excluded.manager,
      employment_type = excluded.employment_type,
      position = excluded.position,
      job_title = excluded.job_title,
      updated_at = excluded.updated_at`)
    .bind(record.employeeId, record.name, record.birth, record.email, record.phone, record.address,
      record.department, record.manager, record.type, record.position, record.jobTitle, record.updatedAt)
    .run();

  return Response.json({ record });
}
