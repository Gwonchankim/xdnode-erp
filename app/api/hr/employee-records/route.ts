import { env } from "cloudflare:workers";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";
import { applyDuePersonnelActions } from "../../../hr-personnel-actions";
import { applyDueRetirements } from "../../../hr-retirements";
import { applyDueOnboarding } from "../../../hr-onboarding";
import { ensureEmployeeRosterSeeded } from "../../../hr-employee-roster";

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
  annual_salary: number;
  base_pay: number;
  meal_allowance: number;
  childcare_allowance: number;
  vehicle_allowance: number;
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
      annual_salary INTEGER NOT NULL DEFAULT 0,
      base_pay INTEGER NOT NULL DEFAULT 0,
      meal_allowance INTEGER NOT NULL DEFAULT 0,
      childcare_allowance INTEGER NOT NULL DEFAULT 0,
      vehicle_allowance INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
  )`).run();
  const columns = await db.prepare("PRAGMA table_info(hr_employee_records)").all<{ name: string }>();
  const existing = new Set(columns.results.map((column) => column.name));
  const additions = [
    ["join_date", "TEXT NOT NULL DEFAULT ''"],
    ["status", "TEXT NOT NULL DEFAULT '재직'"],
    ["history_json", "TEXT NOT NULL DEFAULT '[]'"],
    ["retirement_json", "TEXT"],
    ["annual_salary", "INTEGER NOT NULL DEFAULT 0"],
    ["base_pay", "INTEGER NOT NULL DEFAULT 0"],
    ["meal_allowance", "INTEGER NOT NULL DEFAULT 0"],
    ["childcare_allowance", "INTEGER NOT NULL DEFAULT 0"],
    ["vehicle_allowance", "INTEGER NOT NULL DEFAULT 0"],
  ].filter(([name]) => !existing.has(name));
  for (const [name, definition] of additions) {
    await db.prepare(`ALTER TABLE hr_employee_records ADD COLUMN ${name} ${definition}`).run();
  }
  await ensureEmployeeRosterSeeded(db);
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
    annualSalary: row.annual_salary,
    basePay: row.base_pay,
    mealAllowance: row.meal_allowance,
    childcareAllowance: row.childcare_allowance,
    vehicleAllowance: row.vehicle_allowance,
    updatedAt: row.updated_at,
  };
}

export async function GET() {
  const auth = await authorizeErpRequest(db, "hr", "read");
  if (auth.response) return auth.response;
  await ensureSchema();
  await applyDuePersonnelActions(db);
  await applyDueRetirements(db);
  await applyDueOnboarding(db);
  const result = await db.prepare(`SELECT employee_id, name, birth, email, phone, address,
    department, manager, employment_type, join_date, position, job_title, status, history_json, retirement_json,
    annual_salary, base_pay, meal_allowance, childcare_allowance, vehicle_allowance, updated_at
    FROM hr_employee_records ORDER BY employee_id`).all<EmployeeRecordRow>();

  // 퇴직일과 사유는 retirement_json 이 아니라 hr_retirement_requests 에 있다. 화면은 employee.retirement
  // 하나만 보므로 여기서 합쳐 준다. 이게 없으면 퇴직 절차 팝업의 퇴직일이 기본값으로 보이고,
  // 대시보드도 "누가 언제 나가는지"를 알 수 없다.
  type RetirementRequestRow = { employee_id: string; id: string; retirement_date: string; reason: string; status: string };
  let requestRows: RetirementRequestRow[] = [];
  try {
    // 퇴직 요청 테이블은 입·퇴사 관리 라우트가 처음 돌 때 만들어진다. 아직 없을 수도 있다.
    const requests = await db.prepare(`SELECT employee_id, id, retirement_date, reason, status
      FROM hr_retirement_requests ORDER BY created_at`).all<RetirementRequestRow>();
    requestRows = requests.results;
  } catch { requestRows = []; }
  const byEmployee = new Map(requestRows.map((row) => [row.employee_id, row]));
  const records = result.results.map(toRecord).map((record) => {
    const request = byEmployee.get(record.employeeId);
    if (!request) return record;
    const retirement = (record.retirement ?? {}) as Record<string, unknown>;
    return { ...record, retirement: {
      ...retirement,
      requestId: retirement.requestId ?? request.id,
      date: retirement.date ?? request.retirement_date,
      reason: retirement.reason ?? request.reason,
      status: retirement.status ?? request.status,
    } };
  });
  return Response.json({ records });
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
    annualSalary: 0,
    basePay: 0,
    mealAllowance: 0,
    childcareAllowance: 0,
    vehicleAllowance: 0,
    updatedAt: Date.now(),
  };
  for (const [source, target] of [["annualSalary", "annualSalary"], ["basePay", "basePay"], ["mealAllowance", "mealAllowance"], ["childcareAllowance", "childcareAllowance"], ["vehicleAllowance", "vehicleAllowance"]] as const) {
    const value = Number(body[source] ?? 0);
    if (!Number.isFinite(value) || value < 0) return Response.json({ error: "연봉·기본급과 수당은 0원 이상으로 입력해 주세요." }, { status: 400 });
    record[target] = Math.round(value);
  }

  const before = await db.prepare(`SELECT employee_id, name, birth, email, phone, address,
    department, manager, employment_type, join_date, position, job_title, status, history_json, retirement_json,
    annual_salary, base_pay, meal_allowance, childcare_allowance, vehicle_allowance, updated_at
    FROM hr_employee_records WHERE employee_id = ?`).bind(employeeId).first<EmployeeRecordRow>();

  await db.prepare(`INSERT INTO hr_employee_records
    (employee_id, name, birth, email, phone, address, department, manager, employment_type, join_date,
      position, job_title, status, history_json, retirement_json, annual_salary, base_pay, meal_allowance,
      childcare_allowance, vehicle_allowance, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      annual_salary = excluded.annual_salary,
      base_pay = excluded.base_pay,
      meal_allowance = excluded.meal_allowance,
      childcare_allowance = excluded.childcare_allowance,
      vehicle_allowance = excluded.vehicle_allowance,
      updated_at = excluded.updated_at`)
    .bind(record.employeeId, record.name, record.birth, record.email, record.phone, record.address,
      record.department, record.manager, record.type, record.joinDate, record.position, record.jobTitle,
      record.status, JSON.stringify(record.history), record.retirement ? JSON.stringify(record.retirement) : null,
      record.annualSalary, record.basePay, record.mealAllowance, record.childcareAllowance, record.vehicleAllowance, record.updatedAt)
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
