import { env } from "cloudflare:workers";
import { createApprovalRequest } from "../../../approval-engine";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";
import { companyEmployees } from "../../../hr-company-data";
import { applyDueOnboarding } from "../../../hr-onboarding";
import { applyDueRetirements } from "../../../hr-retirements";
import { calculateLeaveAllowance, calculateSeverance, precedingMonths } from "../../../hr-severance-calculation";

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
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_retirement_requests (
      id TEXT PRIMARY KEY NOT NULL, employee_id TEXT NOT NULL, retirement_date TEXT NOT NULL, reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'SUBMITTED', checklist_json TEXT NOT NULL DEFAULT '[]',
      total_tasks INTEGER NOT NULL DEFAULT 0, completed_tasks INTEGER NOT NULL DEFAULT 0,
      requested_by TEXT NOT NULL, approved_by TEXT NOT NULL DEFAULT '', approved_at INTEGER, completed_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_retirement_settlements (
      request_id TEXT PRIMARY KEY NOT NULL, final_salary INTEGER NOT NULL DEFAULT 0,
      retirement_pay INTEGER NOT NULL DEFAULT 0, unused_leave_pay INTEGER NOT NULL DEFAULT 0,
      deductions INTEGER NOT NULL DEFAULT 0, net_settlement INTEGER NOT NULL DEFAULT 0,
      payroll_confirmed INTEGER NOT NULL DEFAULT 0, insurance_confirmed INTEGER NOT NULL DEFAULT 0,
      access_revoked INTEGER NOT NULL DEFAULT 0, assets_returned INTEGER NOT NULL DEFAULT 0,
      handover_confirmed INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'DRAFT',
      prepared_by TEXT NOT NULL DEFAULT '', completed_by TEXT NOT NULL DEFAULT '', completed_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_employee_records (
      employee_id TEXT PRIMARY KEY, name TEXT NOT NULL, birth TEXT NOT NULL, email TEXT NOT NULL,
      phone TEXT NOT NULL, address TEXT NOT NULL, department TEXT NOT NULL, manager TEXT NOT NULL,
      employment_type TEXT NOT NULL, join_date TEXT NOT NULL DEFAULT '', position TEXT NOT NULL, job_title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '재직', history_json TEXT NOT NULL DEFAULT '[]', retirement_json TEXT, updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_personnel_employee_effective ON hr_personnel_actions(employee_id, effective_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_attendance_employee_date ON hr_attendance_records(employee_id, work_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_attendance_status_date ON hr_attendance_records(status, work_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_lifecycle_employee_type ON hr_lifecycle_tasks(employee_id, lifecycle_type)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_lifecycle_status_due ON hr_lifecycle_tasks(status, due_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_retirement_employee_date ON hr_retirement_requests(employee_id, retirement_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_retirement_status_date ON hr_retirement_requests(status, retirement_date)"),
  ]);
  // 연차수당의 근거가 되는 일수를 값으로 남기려고 뒤늦게 붙인 컬럼. 마이너스 연차를 담아야 해서 REAL.
  const settlementColumns = await db.prepare("PRAGMA table_info(hr_retirement_settlements)").all<{ name: string }>();
  if (!settlementColumns.results.some((column) => column.name === "leave_days")) {
    await db.prepare("ALTER TABLE hr_retirement_settlements ADD COLUMN leave_days REAL NOT NULL DEFAULT 0").run();
  }
}

type SeveranceContext = {
  employeeId: string; employeeName: string; retirementDate: string; period: string; joinDate: string;
  monthlyOrdinaryWage: number; usedLeaveUnits: number;
};

// hr_payroll_records 의 employee_id 는 출처에 따라 값이 다르다. 가져온 인건비 자료는 HR 사번(lhy0220)을
// 쓰지만, ERP 임금계산이 확정하며 만든 행은 임금안 라인의 UUID 를 넣는다. 사번만으로 찾으면 임금계산에서
// 만들어진 행을 통째로 놓치므로 이름도 함께 본다. 같은 달에 두 출처가 겹치면 사번이 맞는 쪽을 쓴다.
const PAYROLL_MATCH = "(employee_id = ? OR employee_name = ?)";

/** 퇴직금 산정에 필요한 사람·급여 정보를 모은다. 정산 저장과 화면 미리보기가 같은 값을 쓰도록 한 곳에 둔다. */
async function severanceContextFor(employeeId: string, retirementDate: string): Promise<SeveranceContext> {
  const employee = await db.prepare(`SELECT name, join_date, annual_salary, base_pay, meal_allowance,
    childcare_allowance, vehicle_allowance FROM hr_employee_records WHERE employee_id = ?`)
    .bind(employeeId).first<{ name: string; join_date: string; annual_salary: number; base_pay: number;
      meal_allowance: number; childcare_allowance: number; vehicle_allowance: number }>();
  // 통상임금은 연봉 기준이 있으면 연봉/12, 없으면 고정 지급분 합계로 본다.
  const monthlyOrdinaryWage = !employee ? 0
    : employee.annual_salary > 0 ? Math.round(employee.annual_salary / 12)
    : employee.base_pay + employee.meal_allowance + employee.childcare_allowance + employee.vehicle_allowance;
  const used = await db.prepare(`SELECT COALESCE(SUM(units), 0) AS units FROM hr_leave_requests
    WHERE employee_id = ? AND status = 'APPROVED' AND leave_type IN ('ANNUAL', 'HALF_AM', 'HALF_PM')`)
    .bind(employeeId).first<{ units: number }>();
  return {
    employeeId, employeeName: employee?.name ?? "", retirementDate, period: retirementDate.slice(0, 7),
    joinDate: employee?.join_date ?? "", monthlyOrdinaryWage, usedLeaveUnits: Number(used?.units ?? 0),
  };
}

async function severanceEstimateFor(context: SeveranceContext) {
  const months = precedingMonths(context.retirementDate);
  const matched = months.length
    ? (await db.prepare(`SELECT year_month AS yearMonth, gross_pay AS grossPay, employee_id AS employeeId
        FROM hr_payroll_records
        WHERE ${PAYROLL_MATCH} AND year_month IN (${months.map(() => "?").join(",")})`)
        .bind(context.employeeId, context.employeeName, ...months)
        .all<{ yearMonth: string; grossPay: number; employeeId: string }>()).results
    : [];
  // 한 달에 한 행만 남긴다. 두 출처가 겹칠 때 둘 다 더하면 평균임금이 배로 부풀어 오른다.
  const byMonth = new Map<string, { yearMonth: string; grossPay: number }>();
  for (const row of matched) {
    const kept = byMonth.get(row.yearMonth);
    const isExactId = row.employeeId === context.employeeId;
    if (!kept || isExactId) byMonth.set(row.yearMonth, { yearMonth: row.yearMonth, grossPay: row.grossPay });
  }
  const recentWages = [...byMonth.values()];
  return calculateSeverance({
    joinDate: context.joinDate, retirementDate: context.retirementDate,
    recentWages, monthlyOrdinaryWage: context.monthlyOrdinaryWage,
  });
}

export async function GET(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "hr", "read");
  if (authorization.response) return authorization.response;
  await applyDueRetirements(db);
  const employeeId = new URL(request.url).searchParams.get("employeeId")?.trim() ?? "";
  const where = employeeId ? " WHERE employee_id = ?" : "";
  const bind = <T,>(sql: string) => employeeId ? db.prepare(sql + where).bind(employeeId).all<T>() : db.prepare(sql).all<T>();
  const [actions, lifecycle, leaves, attendance, payrollRuns, retirements, settlements] = await Promise.all([
    bind<Record<string, unknown>>("SELECT * FROM hr_personnel_actions"),
    bind<Record<string, unknown>>("SELECT * FROM hr_lifecycle_tasks"),
    bind<Record<string, unknown>>("SELECT * FROM hr_leave_requests"),
    bind<Record<string, unknown>>("SELECT * FROM hr_attendance_records"),
    db.prepare("SELECT * FROM hr_payroll_runs ORDER BY period DESC").all<Record<string, unknown>>(),
    bind<Record<string, unknown>>("SELECT * FROM hr_retirement_requests"),
    employeeId
      ? db.prepare(`SELECT settlement.* FROM hr_retirement_settlements settlement
          INNER JOIN hr_retirement_requests request ON request.id = settlement.request_id WHERE request.employee_id = ?`)
        .bind(employeeId).all<Record<string, unknown>>()
      : db.prepare("SELECT * FROM hr_retirement_settlements").all<Record<string, unknown>>(),
  ]);
  // 정산 화면이 퇴직금을 손으로 계산하지 않도록 법정 산식 결과를 함께 내려준다. 퇴직 건마다 조회가
  // 네 번씩 붙어서, 이 값이 필요한 정산 화면이 명시적으로 요청할 때만 계산한다 — HR 첫 화면 로딩도
  // 같은 엔드포인트를 쓰기 때문에 무조건 계산하면 진입 속도가 그만큼 느려진다.
  const wantsSeverance = new URL(request.url).searchParams.get("severance") === "1";
  const severanceEstimates = !wantsSeverance ? [] : await Promise.all(retirements.results
    .filter((row) => ["IN_PROGRESS", "READY", "EFFECTIVE"].includes(String(row.status ?? "")))
    .map(async (row) => {
      const context = await severanceContextFor(String(row.employee_id ?? ""), String(row.retirement_date ?? ""));
      const estimate = await severanceEstimateFor(context);
      const payrollMonth = await db.prepare("SELECT period, status FROM hr_compensation_runs WHERE period = ?")
        .bind(context.period).first<{ period: string; status: string }>();
      // 급여자료에 사람이 직접 적어 둔 퇴직금·연차수당. 계산 추정치와 성격이 달라 덮어쓰기 전에
      // 확인을 받아야 하므로, 있는 그대로 함께 내려보내 화면이 나란히 보여줄 수 있게 한다.
      const recorded = await db.prepare(`SELECT COALESCE(MAX(retirement_pay), 0) AS retirement_pay,
          COALESCE(MAX(annual_leave_pay), 0) AS annual_leave_pay FROM hr_payroll_records
        WHERE year_month = ? AND ${PAYROLL_MATCH}`)
        .bind(context.period, context.employeeId, context.employeeName)
        .first<{ retirement_pay: number; annual_leave_pay: number }>();
      return {
        requestId: String(row.id ?? ""), period: context.period, joinDate: context.joinDate,
        monthlyOrdinaryWage: context.monthlyOrdinaryWage, usedLeaveUnits: context.usedLeaveUnits,
        recordedSeverance: Number(recorded?.retirement_pay ?? 0),
        recordedLeavePay: Number(recorded?.annual_leave_pay ?? 0),
        leaveDailyWage: calculateLeaveAllowance(1, context.monthlyOrdinaryWage, String(row.retirement_date ?? "")).dailyWage,
        payrollMonthReady: Boolean(payrollMonth), payrollMonthStatus: payrollMonth?.status ?? "",
        ...estimate,
      };
    }));
  return Response.json({ personnelActions: actions.results, lifecycleTasks: lifecycle.results, leaveRequests: leaves.results, attendanceRecords: attendance.results, payrollRuns: payrollRuns.results, retirementRequests: retirements.results, retirementSettlements: settlements.results, severanceEstimates });
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
    const employee = companyEmployees.find((item) => item.id === employeeId);
    const persistedEmployee = await db.prepare("SELECT name FROM hr_employee_records WHERE employee_id = ?").bind(employeeId).first<{ name: string }>();
    if (!employee && !persistedEmployee) return Response.json({ error: "회사 인사기록에 등록된 직원만 퇴직 절차를 시작할 수 있습니다." }, { status: 404 });
    const activeRequest = await db.prepare(`SELECT id FROM hr_retirement_requests WHERE employee_id = ?
      AND status IN ('SUBMITTED', 'IN_PROGRESS', 'READY') ORDER BY created_at DESC LIMIT 1`).bind(employeeId).first<{ id: string }>();
    if (activeRequest) return Response.json({ error: "이미 진행 중인 퇴직 요청이 있습니다." }, { status: 409 });
    const completedTaskIds = tasks.filter((task) => Boolean((task as Record<string, unknown>).completed))
      .map((task) => String((task as Record<string, unknown>).id ?? "")).filter(Boolean);
    const statements = tasks.map((task) => {
      const item = task as Record<string, unknown>;
      const taskId = `${id}:${String(item.id ?? crypto.randomUUID())}`;
      const completed = Boolean(item.completed);
      return db.prepare(`INSERT INTO hr_lifecycle_tasks
        (id, employee_id, lifecycle_type, task_group, title, owner_employee_id, due_date, status, completed_at, created_at, updated_at)
        VALUES (?, ?, 'RETIREMENT', ?, ?, '', ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET status = excluded.status, completed_at = excluded.completed_at, updated_at = excluded.updated_at`)
        .bind(taskId, employeeId, String(item.ownerType ?? "HR"), String(item.title ?? ""), eventDate,
          completed ? "DONE" : "OPEN", completed ? now : null, now, now);
    });
    statements.unshift(db.prepare(`INSERT INTO hr_retirement_requests
      (id, employee_id, retirement_date, reason, status, checklist_json, total_tasks, completed_tasks,
        requested_by, approved_by, approved_at, completed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'IN_PROGRESS', ?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
      .bind(id, employeeId, eventDate, reason, JSON.stringify(completedTaskIds), tasks.length, completedTaskIds.length,
        authorization.principal.employeeId, authorization.principal.employeeId, now, now, now));
    if (employee) {
      statements.unshift(db.prepare(`INSERT OR IGNORE INTO hr_employee_records
        (employee_id, name, birth, email, phone, address, department, manager, employment_type, join_date,
          position, job_title, status, history_json, retirement_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`)
        .bind(employee.id, employee.name, employee.birth, employee.email, employee.phone, employee.address,
          employee.department, employee.manager, employee.type, employee.joinDate, employee.position,
          employee.jobTitle, employee.status, JSON.stringify(employee.history), now));
    }
    await db.batch(statements);
    await applyDueRetirements(db, now);
    const created = await db.prepare("SELECT status FROM hr_retirement_requests WHERE id = ?").bind(id).first<{ status: string }>();
    await writeErpAudit(db, { principal: authorization.principal, module: "hr", action: "RETIREMENT_APPROVED", entityType: "employeeRetirement", entityId: id, after: { employeeId, employeeName: employee?.name ?? persistedEmployee?.name ?? employeeId, eventDate, reason, completedTaskIds, status: created?.status ?? "IN_PROGRESS" } });
    return Response.json({ item: { id, employeeId, eventDate, taskCount: tasks.length, completedTaskIds, status: created?.status ?? "IN_PROGRESS" } }, { status: 201 });
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
  const authorization = await authorizeErpRequest(db, "hr", ["retirementChecklist", "retirementSettlement", "lifecycleTask"].includes(resource) ? "write" : "approve");
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

  if (resource === "lifecycleTask") {
    const before = await db.prepare(`SELECT task.*, employee.status AS employee_status FROM hr_lifecycle_tasks task
      INNER JOIN hr_employee_records employee ON employee.employee_id = task.employee_id
      WHERE task.id = ? AND task.lifecycle_type = 'ONBOARDING'`)
      .bind(id).first<Record<string, unknown>>();
    if (!before) return Response.json({ error: "온보딩 업무를 찾을 수 없습니다." }, { status: 404 });
    if (before.employee_status !== "입사 예정") return Response.json({ error: "재직 전환이 완료된 온보딩 기록은 변경할 수 없습니다." }, { status: 409 });
    const status = String(body.status ?? "DONE").toUpperCase();
    if (!["OPEN", "DONE"].includes(status)) return Response.json({ error: "온보딩 업무 상태를 확인해 주세요." }, { status: 400 });
    await db.prepare("UPDATE hr_lifecycle_tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ? AND lifecycle_type = 'ONBOARDING'")
      .bind(status, status === "DONE" ? now : null, now, id).run();
    await applyDueOnboarding(db, now);
    const after = await db.prepare("SELECT * FROM hr_lifecycle_tasks WHERE id = ?").bind(id).first<Record<string, unknown>>();
    await writeErpAudit(db, { principal: authorization.principal, module: "hr", action: `ONBOARDING_TASK_${status}`, entityType: "lifecycleTask", entityId: id, before, after });
    return Response.json({ item: after });
  }

  if (resource === "retirementSettlement") {
    const request = await db.prepare("SELECT * FROM hr_retirement_requests WHERE id = ?").bind(id).first<Record<string, unknown>>();
    if (!request) return Response.json({ error: "퇴직 요청을 찾을 수 없습니다." }, { status: 404 });
    if (!["IN_PROGRESS", "READY", "EFFECTIVE"].includes(String(request.status ?? ""))) return Response.json({ error: "승인 완료된 퇴직 요청만 정산할 수 있습니다." }, { status: 409 });
    const before = await db.prepare("SELECT * FROM hr_retirement_settlements WHERE request_id = ?").bind(id).first<Record<string, unknown>>();
    const employeeId = String(request.employee_id ?? "");
    const retirementDate = String(request.retirement_date ?? "");
    const context = await severanceContextFor(employeeId, retirementDate);
    const amounts = ["finalSalary", "retirementPay", "deductions"].map((key) => Number(body[key] ?? 0));
    if (amounts.some((value) => !Number.isFinite(value) || value < 0)) return Response.json({ error: "정산 금액은 0원 이상으로 입력해 주세요." }, { status: 400 });
    const [finalSalary, retirementPay, deductions] = amounts.map(Math.round);
    // 연차는 일수로 받는다. 선사용해 마이너스가 된 연차는 음수 금액이 되어 정산에서 차감된다.
    const leaveDays = Number(body.leaveDays ?? 0);
    if (!Number.isFinite(leaveDays) || Math.abs(leaveDays) > 366) return Response.json({ error: "잔여 연차 일수를 -366~366 사이로 입력해 주세요." }, { status: 400 });
    // 퇴사일 시점의 소정근로시간 규정으로 1일 통상임금을 잡는다 (2026-08-01 주 35시간제 시행).
    const unusedLeavePay = calculateLeaveAllowance(leaveDays, context.monthlyOrdinaryWage, retirementDate).amount;
    const netSettlement = finalSalary + retirementPay + unusedLeavePay - deductions;
    const controls = {
      payrollConfirmed: Boolean(body.payrollConfirmed), insuranceConfirmed: Boolean(body.insuranceConfirmed),
      accessRevoked: Boolean(body.accessRevoked), assetsReturned: Boolean(body.assetsReturned),
      handoverConfirmed: Boolean(body.handoverConfirmed),
    };
    const ready = Object.values(controls).every(Boolean);
    await db.prepare(`INSERT INTO hr_retirement_settlements
      (request_id, final_salary, retirement_pay, unused_leave_pay, leave_days, deductions, net_settlement,
        payroll_confirmed, insurance_confirmed, access_revoked, assets_returned, handover_confirmed,
        status, prepared_by, completed_by, completed_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', NULL, ?, ?)
      ON CONFLICT(request_id) DO UPDATE SET final_salary=excluded.final_salary, retirement_pay=excluded.retirement_pay,
        unused_leave_pay=excluded.unused_leave_pay, leave_days=excluded.leave_days,
        deductions=excluded.deductions, net_settlement=excluded.net_settlement,
        payroll_confirmed=excluded.payroll_confirmed, insurance_confirmed=excluded.insurance_confirmed,
        access_revoked=excluded.access_revoked, assets_returned=excluded.assets_returned,
        handover_confirmed=excluded.handover_confirmed, status=excluded.status,
        prepared_by=excluded.prepared_by, updated_at=excluded.updated_at`)
      .bind(id, finalSalary, retirementPay, unusedLeavePay, leaveDays, deductions, netSettlement,
        controls.payrollConfirmed ? 1 : 0, controls.insuranceConfirmed ? 1 : 0,
        controls.accessRevoked ? 1 : 0, controls.assetsReturned ? 1 : 0,
        controls.handoverConfirmed ? 1 : 0, ready ? "READY" : "DRAFT",
        authorization.principal.employeeId, now, now).run();
    await applyDueRetirements(db, now);

    // 퇴직금은 정산 기록에만 남기고 퇴사월 임금안에는 자동으로 쓰지 않는다. 평균임금은 퇴직일 이전
    // 3개월과 그 기간의 총일수를 기준으로 하고 근로기준법 시행령 제2조의 제외기간을 빼야 하는데,
    // 이 앱에는 그 기간을 구분할 자료(출산전후휴가·육아휴직·업무상 요양·휴업 등)가 없다.
    // 검증되지 않은 금액이 급여 파일까지 흘러가지 않도록, 반영은 사람이 임금계산에서 직접 넣는다.
    const after = await db.prepare("SELECT * FROM hr_retirement_settlements WHERE request_id = ?").bind(id).first<Record<string, unknown>>();
    await writeErpAudit(db, { principal: authorization.principal, module: "hr", action: "RETIREMENT_SETTLEMENT_UPDATED", entityType: "retirementSettlement", entityId: id, before, after });
    return Response.json({ item: after });
  }

  if (resource === "retirementChecklist") {
    const before = await db.prepare("SELECT * FROM hr_retirement_requests WHERE id = ?").bind(id).first<Record<string, unknown>>();
    if (!before) return Response.json({ error: "퇴직 요청을 찾을 수 없습니다." }, { status: 404 });
    if (!["IN_PROGRESS", "READY", "EFFECTIVE"].includes(String(before.status ?? ""))) return Response.json({ error: "승인 완료된 퇴직 절차만 체크리스트를 갱신할 수 있습니다." }, { status: 409 });
    const completedTaskIds = Array.isArray(body.completedTaskIds) ? body.completedTaskIds.map(String).filter(Boolean) : [];
    const taskRows = await db.prepare("SELECT id FROM hr_lifecycle_tasks WHERE id LIKE ? AND lifecycle_type = 'RETIREMENT'")
      .bind(`${id}:%`).all<{ id: string }>();
    const allowedIds = new Set(taskRows.results.map((row) => row.id.slice(id.length + 1)));
    const validCompleted = [...new Set(completedTaskIds.filter((taskId) => allowedIds.has(taskId)))];
    const totalTasks = Number(before.total_tasks ?? taskRows.results.length);
    const allComplete = totalTasks > 0 && validCompleted.length === totalTasks;
    if (allComplete) {
      const settlement = await db.prepare("SELECT status FROM hr_retirement_settlements WHERE request_id = ?")
        .bind(id).first<{ status: string }>();
      if (settlement?.status !== "READY") return Response.json({ error: "퇴직 정산 금액과 급여·보험·계정·자산·인수인계 확인을 먼저 완료해 주세요." }, { status: 409 });
    }
    const koreaDate = new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const due = String(before.retirement_date ?? "") <= koreaDate;
    const nextStatus = allComplete ? (due ? "EFFECTIVE" : "READY") : (due ? "EFFECTIVE" : "IN_PROGRESS");
    const taskStatements = taskRows.results.map((row) => {
      const taskId = row.id.slice(id.length + 1);
      const completed = validCompleted.includes(taskId);
      return db.prepare("UPDATE hr_lifecycle_tasks SET status = ?, completed_at = ?, updated_at = ? WHERE id = ?")
        .bind(completed ? "DONE" : "OPEN", completed ? now : null, now, row.id);
    });
    await db.batch([
      ...taskStatements,
      db.prepare(`UPDATE hr_retirement_requests SET checklist_json = ?, completed_tasks = ?, status = ?, completed_at = ?, updated_at = ? WHERE id = ?`)
        .bind(JSON.stringify(validCompleted), validCompleted.length, nextStatus, nextStatus === "COMPLETED" ? now : null, now, id),
      db.prepare(`UPDATE hr_employee_records SET status = ?,
        retirement_json = json_set(CASE WHEN json_valid(retirement_json) THEN retirement_json ELSE '{}' END,
          '$.completedTaskIds', json(?), '$.status', ?), updated_at = ?
        WHERE employee_id = ?`)
        .bind(due ? "퇴직" : "퇴직 예정", JSON.stringify(validCompleted), nextStatus, now, String(before.employee_id ?? "")),
      db.prepare(`UPDATE hr_retirement_settlements SET status = CASE WHEN ? = 'COMPLETED' THEN 'COMPLETED' ELSE status END,
        completed_by = CASE WHEN ? = 'COMPLETED' THEN ? ELSE completed_by END,
        completed_at = CASE WHEN ? = 'COMPLETED' THEN ? ELSE completed_at END, updated_at = ? WHERE request_id = ?`)
        .bind(nextStatus, nextStatus, authorization.principal.employeeId, nextStatus, now, now, id),
    ]);
    await applyDueRetirements(db, now);
    const after = await db.prepare("SELECT * FROM hr_retirement_requests WHERE id = ?").bind(id).first<Record<string, unknown>>();
    await writeErpAudit(db, { principal: authorization.principal, module: "hr", action: "RETIREMENT_CHECKLIST_UPDATED", entityType: "employeeRetirement", entityId: id, before, after });
    return Response.json({ item: after });
  }

  return Response.json({ error: "지원하지 않는 HR 운영 항목입니다." }, { status: 400 });
}
