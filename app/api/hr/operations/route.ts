import { env } from "cloudflare:workers";
import { createApprovalRequest } from "../../../approval-engine";
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
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_attendance_records (
      id TEXT PRIMARY KEY NOT NULL, employee_id TEXT NOT NULL, work_date TEXT NOT NULL,
      work_type TEXT NOT NULL DEFAULT 'OFFICE', check_in TEXT NOT NULL DEFAULT '', check_out TEXT NOT NULL DEFAULT '',
      minutes_worked INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'RECORDED',
      source_type TEXT NOT NULL DEFAULT 'MANUAL', memo TEXT NOT NULL DEFAULT '', approved_by TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_personnel_actions (
      id TEXT PRIMARY KEY NOT NULL, employee_id TEXT NOT NULL, action_type TEXT NOT NULL, effective_date TEXT NOT NULL,
      order_number TEXT NOT NULL DEFAULT '', before_json TEXT NOT NULL DEFAULT '{}', after_json TEXT NOT NULL DEFAULT '{}',
      reason TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'DRAFT', approved_by TEXT NOT NULL DEFAULT '', approved_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_lifecycle_tasks (
      id TEXT PRIMARY KEY NOT NULL, employee_id TEXT NOT NULL, lifecycle_type TEXT NOT NULL, task_group TEXT NOT NULL,
      title TEXT NOT NULL, owner_employee_id TEXT NOT NULL DEFAULT '', due_date TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'OPEN', completed_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_personnel_employee_effective ON hr_personnel_actions(employee_id, effective_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_attendance_employee_date ON hr_attendance_records(employee_id, work_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_attendance_status_date ON hr_attendance_records(status, work_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_lifecycle_employee_type ON hr_lifecycle_tasks(employee_id, lifecycle_type)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_lifecycle_status_due ON hr_lifecycle_tasks(status, due_date)"),
  ]);
}

export async function GET(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "hr", "read");
  if (authorization.response) return authorization.response;
  const employeeId = new URL(request.url).searchParams.get("employeeId")?.trim() ?? "";
  const where = employeeId ? " WHERE employee_id = ?" : "";
  const bind = <T,>(sql: string) => employeeId ? db.prepare(sql + where).bind(employeeId).all<T>() : db.prepare(sql).all<T>();
  const [actions, lifecycle, leaves, attendance, payrollRuns] = await Promise.all([
    bind<Record<string, unknown>>("SELECT * FROM hr_personnel_actions"),
    bind<Record<string, unknown>>("SELECT * FROM hr_lifecycle_tasks"),
    bind<Record<string, unknown>>("SELECT * FROM hr_leave_requests"),
    bind<Record<string, unknown>>("SELECT * FROM hr_attendance_records"),
    db.prepare("SELECT * FROM hr_payroll_runs ORDER BY period DESC").all<Record<string, unknown>>(),
  ]);
  return Response.json({ personnelActions: actions.results, lifecycleTasks: lifecycle.results, leaveRequests: leaves.results, attendanceRecords: attendance.results, payrollRuns: payrollRuns.results });
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
    const beforeState = { department: String(body.fromDepartment ?? ""), position: String(body.fromPosition ?? "") };
    const afterState = { department: String(body.toDepartment ?? ""), position: String(body.toPosition ?? "") };
    if (!afterState.department || !afterState.position) return Response.json({ error: "발령 후 소속 조직과 직급을 확인해 주세요." }, { status: 400 });
    await db.prepare(`INSERT INTO hr_personnel_actions
      (id, employee_id, action_type, effective_date, order_number, before_json, after_json,
        reason, status, approved_by, approved_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', '', NULL, ?, ?)`)
      .bind(id, employeeId, actionType, effectiveDate, String(body.orderNumber ?? ""), JSON.stringify(beforeState),
        JSON.stringify(afterState), reason, now, now).run();
    try {
      await createApprovalRequest(db, authorization.principal, {
        module: "hr", requestType: "PERSONNEL_ACTION", title: `${employeeId} ${actionType} 승인 요청`,
        description: `${effectiveDate} 시행 · ${beforeState.department}/${beforeState.position} → ${afterState.department}/${afterState.position}${reason ? ` · ${reason}` : ""}`,
        targetEntityType: "HR_PERSONNEL_ACTION", targetEntityId: id, dueDate: effectiveDate,
        priority: actionType === "강등" ? "HIGH" : "NORMAL",
        metadata: { employeeId, actionType, effectiveDate, beforeState, afterState, reason },
      });
    } catch (error) {
      await db.prepare("DELETE FROM hr_personnel_actions WHERE id = ?").bind(id).run();
      return Response.json({ error: error instanceof Error ? error.message : "인사 발령 결재선을 만들지 못했습니다." }, { status: 409 });
    }
    const after = { id, employeeId, actionType, effectiveDate, fromDepartment: body.fromDepartment, toDepartment: body.toDepartment, fromPosition: body.fromPosition, toPosition: body.toPosition, reason, status: "SUBMITTED" };
    await writeErpAudit(db, { principal: authorization.principal, module: "hr", action: "PERSONNEL_ACTION_CREATED", entityType: "personnelAction", entityId: id, after });
    return Response.json({ item: after, approvalSubmitted: true }, { status: 202 });
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
        (id, employee_id, lifecycle_type, task_group, title, owner_employee_id, due_date, status, completed_at, created_at, updated_at)
        VALUES (?, ?, 'RETIREMENT', ?, ?, '', ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status, completed_at = excluded.completed_at, updated_at = excluded.updated_at`)
        .bind(taskId, employeeId, String(item.ownerType ?? "HR"), String(item.title ?? ""), eventDate,
          completed ? "DONE" : "OPEN", completed ? now : null, now, now);
    });
    await db.batch(statements);
    await writeErpAudit(db, { principal: authorization.principal, module: "hr", action: "RETIREMENT_CHECKLIST_SAVED", entityType: "employeeRetirement", entityId: `${employeeId}:${eventDate}`, after: { employeeId, eventDate, reason, tasks } });
    return Response.json({ item: { employeeId, eventDate, taskCount: tasks.length } }, { status: 201 });
  }

  if (resource === "leaveRequest") {
    const employeeId = String(body.employeeId ?? "").trim();
    const leaveType = String(body.leaveType ?? "").trim();
    const startDate = String(body.startDate ?? "").trim();
    const endDate = String(body.endDate ?? "").trim();
    const units = Number(body.units);
    const reason = String(body.reason ?? "").trim();
    if (!employeeId || !["ANNUAL", "HALF_AM", "HALF_PM", "SICK", "FAMILY", "OTHER"].includes(leaveType)
      || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)
      || startDate > endDate || !Number.isInteger(units) || units <= 0) {
      return Response.json({ error: "휴가 대상·종류·기간·사용일수를 확인해 주세요." }, { status: 400 });
    }
    await db.prepare(`INSERT INTO hr_leave_requests
      (id, employee_id, leave_type, start_date, end_date, units, reason, status,
        approver_employee_id, decided_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', '', NULL, ?, ?)`)
      .bind(id, employeeId, leaveType, startDate, endDate, units, reason, now, now).run();
    try {
      await createApprovalRequest(db, authorization.principal, {
        module: "hr", requestType: "LEAVE_REQUEST", title: `${employeeId} 휴가 승인 요청`,
        description: `${startDate}~${endDate} · ${leaveType}${reason ? ` · ${reason}` : ""}`,
        targetEntityType: "HR_LEAVE", targetEntityId: id, dueDate: startDate,
        metadata: { employeeId, leaveType, startDate, endDate, units, reason },
      });
    } catch (error) {
      await db.prepare("DELETE FROM hr_leave_requests WHERE id = ?").bind(id).run();
      return Response.json({ error: error instanceof Error ? error.message : "휴가 결재선을 만들지 못했습니다." }, { status: 409 });
    }
    const after = { id, employeeId, leaveType, startDate, endDate, units, reason, status: "PENDING" };
    await writeErpAudit(db, { principal: authorization.principal, module: "hr", action: "LEAVE_REQUEST_CREATED", entityType: "leaveRequest", entityId: id, after });
    return Response.json({ item: after }, { status: 201 });
  }

  if (resource === "attendance") {
    const employeeId = String(body.employeeId ?? "").trim();
    const workDate = String(body.workDate ?? "").trim();
    const workType = String(body.workType ?? "OFFICE");
    const checkIn = String(body.checkIn ?? "");
    const checkOut = String(body.checkOut ?? "");
    if (!employeeId || !/^\d{4}-\d{2}-\d{2}$/.test(workDate) || !["OFFICE", "REMOTE", "FIELD", "TRIP", "OFF"].includes(workType)
      || (checkIn && !/^\d{2}:\d{2}$/.test(checkIn)) || (checkOut && !/^\d{2}:\d{2}$/.test(checkOut))) {
      return Response.json({ error: "근무 대상·일자·유형·시간을 확인해 주세요." }, { status: 400 });
    }
    let minutesWorked = 0;
    if (checkIn && checkOut) {
      const [inHour, inMinute] = checkIn.split(":").map(Number);
      const [outHour, outMinute] = checkOut.split(":").map(Number);
      minutesWorked = Math.max(0, outHour * 60 + outMinute - inHour * 60 - inMinute);
    }
    await db.prepare(`INSERT INTO hr_attendance_records
      (id, employee_id, work_date, work_type, check_in, check_out, minutes_worked, status,
        source_type, memo, approved_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'RECORDED', 'MANUAL', ?, '', ?, ?)`)
      .bind(id, employeeId, workDate, workType, checkIn, checkOut, minutesWorked, String(body.memo ?? "").trim(), now, now).run();
    const after = { id, employeeId, workDate, workType, checkIn, checkOut, minutesWorked, status: "RECORDED", sourceType: "MANUAL", memo: String(body.memo ?? "").trim() };
    await writeErpAudit(db, { principal: authorization.principal, module: "hr", action: "ATTENDANCE_RECORDED", entityType: "attendance", entityId: id, after });
    return Response.json({ item: after }, { status: 201 });
  }

  return Response.json({ error: "지원하지 않는 HR 운영 항목입니다." }, { status: 400 });
}

export async function PUT(request: Request) {
  await ensureSchema();
  const body = await request.json() as Record<string, unknown>;
  const resource = String(body.resource ?? "");
  const id = String(body.id ?? "").trim();
  if (!id) return Response.json({ error: "수정할 항목 ID가 필요합니다." }, { status: 400 });
  const authorization = await authorizeErpRequest(db, "hr", "approve");
  if (authorization.response) return authorization.response;
  const now = Date.now();

  if (resource === "leaveRequest") {
    const before = await db.prepare("SELECT * FROM hr_leave_requests WHERE id = ?").bind(id).first<Record<string, unknown>>();
    if (!before) return Response.json({ error: "휴가 신청을 찾을 수 없습니다." }, { status: 404 });
    const workflow = await db.prepare("SELECT id FROM erp_approval_requests WHERE target_entity_type = 'HR_LEAVE' AND target_entity_id = ? LIMIT 1")
      .bind(id).first<{ id: string }>();
    if (workflow) return Response.json({ error: "이 휴가 신청은 상단 전자결재에서 처리해 주세요." }, { status: 409 });
    const status = String(body.status ?? "");
    if (!["APPROVED", "REJECTED", "CANCELLED"].includes(status)) return Response.json({ error: "올바르지 않은 승인 상태입니다." }, { status: 400 });
    await db.batch([
      db.prepare("UPDATE hr_leave_requests SET status = ?, approver_employee_id = ?, decided_at = ?, updated_at = ? WHERE id = ?")
        .bind(status, authorization.principal.employeeId, now, now, id),
      db.prepare("UPDATE erp_tasks SET status = 'DONE', completed_at = ?, updated_at = ? WHERE source_type = 'RULE' AND source_id = ?")
        .bind(now, now, id),
    ]);
    const after = await db.prepare("SELECT * FROM hr_leave_requests WHERE id = ?").bind(id).first<Record<string, unknown>>();
    await writeErpAudit(db, { principal: authorization.principal, module: "hr", action: `LEAVE_REQUEST_${status}`, entityType: "leaveRequest", entityId: id, before, after, reason: String(body.reason ?? "") });
    return Response.json({ item: after });
  }

  if (resource === "attendance") {
    const before = await db.prepare("SELECT * FROM hr_attendance_records WHERE id = ?").bind(id).first<Record<string, unknown>>();
    if (!before) return Response.json({ error: "근태 기록을 찾을 수 없습니다." }, { status: 404 });
    const status = String(body.status ?? "APPROVED");
    if (!["APPROVED", "REJECTED"].includes(status)) return Response.json({ error: "올바르지 않은 근태 상태입니다." }, { status: 400 });
    await db.prepare("UPDATE hr_attendance_records SET status = ?, approved_by = ?, updated_at = ? WHERE id = ?")
      .bind(status, authorization.principal.employeeId, now, id).run();
    const after = await db.prepare("SELECT * FROM hr_attendance_records WHERE id = ?").bind(id).first<Record<string, unknown>>();
    await writeErpAudit(db, { principal: authorization.principal, module: "hr", action: `ATTENDANCE_${status}`, entityType: "attendance", entityId: id, before, after });
    return Response.json({ item: after });
  }

  return Response.json({ error: "지원하지 않는 HR 운영 항목입니다." }, { status: 400 });
}
