import { env } from "cloudflare:workers";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;

async function ensureSchema() {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_payroll_runs (
      period TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT', employee_count INTEGER NOT NULL DEFAULT 0,
      gross_pay INTEGER NOT NULL DEFAULT 0, deductions INTEGER NOT NULL DEFAULT 0, net_pay INTEGER NOT NULL DEFAULT 0,
      prepared_by TEXT NOT NULL DEFAULT '', reviewed_by TEXT NOT NULL DEFAULT '', approved_by TEXT NOT NULL DEFAULT '',
      locked_at INTEGER, reopened_reason TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_leave_requests (
      id TEXT PRIMARY KEY NOT NULL, employee_id TEXT NOT NULL, leave_type TEXT NOT NULL, start_date TEXT NOT NULL,
      end_date TEXT NOT NULL, units INTEGER NOT NULL, reason TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'PENDING',
      approver_employee_id TEXT NOT NULL DEFAULT '', decided_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_personnel_actions (
      id TEXT PRIMARY KEY NOT NULL, employee_id TEXT NOT NULL, action_type TEXT NOT NULL, effective_date TEXT NOT NULL,
      from_department TEXT NOT NULL DEFAULT '', to_department TEXT NOT NULL DEFAULT '', from_position TEXT NOT NULL DEFAULT '',
      to_position TEXT NOT NULL DEFAULT '', reason TEXT NOT NULL DEFAULT '', evidence_document_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'EFFECTIVE', approved_by TEXT NOT NULL DEFAULT '', approved_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_lifecycle_tasks (
      id TEXT PRIMARY KEY NOT NULL, employee_id TEXT NOT NULL, lifecycle_type TEXT NOT NULL, event_date TEXT NOT NULL,
      owner_type TEXT NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN', completed_at INTEGER,
      evidence_document_id TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_personnel_employee_effective ON hr_personnel_actions(employee_id, effective_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_lifecycle_employee_type_status ON hr_lifecycle_tasks(employee_id, lifecycle_type, status)"),
  ]);
}

export async function GET(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "hr", "read");
  if (authorization.response) return authorization.response;
  const employeeId = new URL(request.url).searchParams.get("employeeId")?.trim() ?? "";
  const where = employeeId ? " WHERE employee_id = ?" : "";
  const bind = <T,>(sql: string) => employeeId ? db.prepare(sql + where).bind(employeeId).all<T>() : db.prepare(sql).all<T>();
  const [actions, lifecycle, leaves, payrollRuns] = await Promise.all([
    bind<Record<string, unknown>>("SELECT * FROM hr_personnel_actions"),
    bind<Record<string, unknown>>("SELECT * FROM hr_lifecycle_tasks"),
    bind<Record<string, unknown>>("SELECT * FROM hr_leave_requests"),
    db.prepare("SELECT * FROM hr_payroll_runs ORDER BY period DESC").all<Record<string, unknown>>(),
  ]);
  return Response.json({ personnelActions: actions.results, lifecycleTasks: lifecycle.results, leaveRequests: leaves.results, payrollRuns: payrollRuns.results });
}

export async function POST(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "hr", "write");
  if (authorization.response) return authorization.response;
  const body = await request.json() as Record<string, unknown>;
  const resource = String(body.resource ?? "");
  const id = crypto.randomUUID();
  const now = Date.now();

  if (resource === "personnelAction") {
    const employeeId = String(body.employeeId ?? "").trim();
    const actionType = String(body.actionType ?? "").trim();
    const effectiveDate = String(body.effectiveDate ?? "").trim();
    const reason = String(body.reason ?? "").trim();
    if (!employeeId || !["인사이동(전보)", "승진", "강등"].includes(actionType) || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || (actionType === "강등" && !reason)) {
      return Response.json({ error: "발령 대상·구분·시행일을 확인하고 강등 시 정당한 사유를 입력해 주세요." }, { status: 400 });
    }
    await db.prepare(`INSERT INTO hr_personnel_actions
      (id, employee_id, action_type, effective_date, from_department, to_department, from_position, to_position,
        reason, evidence_document_id, status, approved_by, approved_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', 'EFFECTIVE', ?, ?, ?, ?)`)
      .bind(id, employeeId, actionType, effectiveDate, String(body.fromDepartment ?? ""), String(body.toDepartment ?? ""),
        String(body.fromPosition ?? ""), String(body.toPosition ?? ""), reason, authorization.principal.employeeId, now, now, now).run();
    const after = { id, employeeId, actionType, effectiveDate, fromDepartment: body.fromDepartment, toDepartment: body.toDepartment, fromPosition: body.fromPosition, toPosition: body.toPosition, reason, status: "EFFECTIVE" };
    await writeErpAudit(db, { principal: authorization.principal, module: "hr", action: "PERSONNEL_ACTION_CREATED", entityType: "personnelAction", entityId: id, after });
    return Response.json({ item: after }, { status: 201 });
  }

  if (resource === "retirement") {
    const employeeId = String(body.employeeId ?? "").trim();
    const eventDate = String(body.eventDate ?? "").trim();
    const reason = String(body.reason ?? "").trim();
    const tasks = Array.isArray(body.tasks) ? body.tasks : [];
    if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || !reason || !tasks.length) return Response.json({ error: "퇴직 대상·퇴직일·사유·체크리스트가 필요합니다." }, { status: 400 });
    const statements = tasks.map((task) => {
      const item = task as Record<string, unknown>;
      const taskId = `${employeeId}:${eventDate}:${String(item.id ?? crypto.randomUUID())}`;
      const completed = Boolean(item.completed);
      return db.prepare(`INSERT INTO hr_lifecycle_tasks
        (id, employee_id, lifecycle_type, event_date, owner_type, title, status, completed_at, evidence_document_id, created_at, updated_at)
        VALUES (?, ?, 'RETIREMENT', ?, ?, ?, ?, ?, '', ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status, completed_at = excluded.completed_at, updated_at = excluded.updated_at`)
        .bind(taskId, employeeId, eventDate, String(item.ownerType ?? "HR"), String(item.title ?? ""), completed ? "DONE" : "OPEN", completed ? now : null, now, now);
    });
    await db.batch(statements);
    await writeErpAudit(db, { principal: authorization.principal, module: "hr", action: "RETIREMENT_CHECKLIST_SAVED", entityType: "employeeRetirement", entityId: `${employeeId}:${eventDate}`, after: { employeeId, eventDate, reason, tasks } });
    return Response.json({ item: { employeeId, eventDate, taskCount: tasks.length } }, { status: 201 });
  }

  return Response.json({ error: "지원하지 않는 HR 운영 항목입니다." }, { status: 400 });
}
