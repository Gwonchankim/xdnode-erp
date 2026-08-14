import { env } from "cloudflare:workers";
import { financeCurrentData } from "../../finance-current-data";
import { authorizeErpRequest, safeJson, writeErpAudit } from "../../erp-platform";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;

type TaskRow = {
  id: string;
  module: string;
  category: string;
  title: string;
  description: string;
  owner_employee_id: string;
  due_date: string;
  status: string;
  priority: string;
  destination: string;
  source_type: string;
  source_id: string;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
};

type SyncRow = {
  id: string;
  source: string;
  scope: string;
  snapshot_date: string;
  status: string;
  record_count: number;
  metrics_json: string;
  error_message: string;
  started_at: number;
  completed_at: number | null;
};

type AuditRow = {
  id: string;
  actor_email: string;
  actor_employee_id: string;
  module: string;
  action: string;
  entity_type: string;
  entity_id: string;
  reason: string;
  created_at: number;
};

const allowedStatuses = new Set(["OPEN", "IN_PROGRESS", "WAITING", "DONE"]);
const allowedPriorities = new Set(["LOW", "NORMAL", "HIGH", "CRITICAL"]);
const allowedModules = new Set(["operations", "finance", "hr", "recruitment", "sales"]);

function toTask(row: TaskRow) {
  return {
    id: row.id,
    module: row.module,
    category: row.category,
    title: row.title,
    description: row.description,
    ownerEmployeeId: row.owner_employee_id,
    dueDate: row.due_date,
    status: row.status,
    priority: row.priority,
    destination: row.destination,
    sourceType: row.source_type,
    sourceId: row.source_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

async function seedCurrentOperations() {
  const now = Date.now();
  const syncId = `clobe-finance-${financeCurrentData.asOf}`;
  const bankAssets = financeCurrentData.accountSummary.checkingBalanceSum + financeCurrentData.accountSummary.fxBalanceSumKrw;
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO erp_sync_runs
      (id, source, scope, snapshot_date, status, record_count, metrics_json,
        error_message, started_at, completed_at, created_at)
      VALUES (?, 'CLOBE', 'FINANCE_2026', ?, 'SUCCESS', ?, ?, '', ?, ?, ?)`)
      .bind(syncId, financeCurrentData.asOf, financeCurrentData.journalSummary.lineCount,
        JSON.stringify({
          checkingBalance: financeCurrentData.accountSummary.checkingBalanceSum,
          fxBalanceKrw: financeCurrentData.accountSummary.fxBalanceSumKrw,
          bankAssets,
          loanBalance: financeCurrentData.accountSummary.loanBalanceSum,
          journalDebit: financeCurrentData.journalSummary.debitAmountKrw,
          journalCredit: financeCurrentData.journalSummary.creditAmountKrw,
          journalDifference: financeCurrentData.journalSummary.differenceKrw,
        }), now, now, now),
    db.prepare(`INSERT OR IGNORE INTO erp_tasks
      (id, module, category, title, description, owner_employee_id, due_date, status,
        priority, destination, source_type, source_id, created_at, updated_at)
      VALUES (?, 'finance', '장부 점검', ?, ?, 'gc.kim', ?, 'OPEN', 'HIGH',
        'finance:quality', 'SYSTEM_RULE', ?, ?, ?)`)
      .bind(`journal-difference-${financeCurrentData.asOf}`,
        `분개장 차대변 ${financeCurrentData.journalSummary.differenceKrw.toLocaleString("ko-KR")}원 차이 확인`,
        `차변 ${financeCurrentData.journalSummary.debitAmountKrw.toLocaleString("ko-KR")}원 · 대변 ${financeCurrentData.journalSummary.creditAmountKrw.toLocaleString("ko-KR")}원`,
        financeCurrentData.asOf, syncId, now, now),
  ]);
}

export async function GET() {
  const auth = await authorizeErpRequest(db, "operations", "read");
  if (auth.response) return auth.response;
  await seedCurrentOperations();

  const [taskResult, syncResult, auditResult] = await Promise.all([
    db.prepare(`SELECT id, module, category, title, description, owner_employee_id,
      due_date, status, priority, destination, source_type, source_id,
      created_at, updated_at, completed_at
      FROM erp_tasks
      WHERE deleted_at IS NULL
      ORDER BY CASE status WHEN 'OPEN' THEN 0 WHEN 'IN_PROGRESS' THEN 1 WHEN 'WAITING' THEN 2 ELSE 3 END,
        CASE priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END,
        due_date ASC, created_at DESC LIMIT 100`).all<TaskRow>(),
    db.prepare(`SELECT id, source, scope, snapshot_date, status, record_count, metrics_json,
      error_message, started_at, completed_at
      FROM erp_sync_runs ORDER BY snapshot_date DESC, created_at DESC LIMIT 30`).all<SyncRow>(),
    db.prepare(`SELECT id, actor_email, actor_employee_id, module, action, entity_type,
      entity_id, reason, created_at
      FROM erp_audit_logs ORDER BY created_at DESC LIMIT 50`).all<AuditRow>(),
  ]);

  const tasks = taskResult.results.map(toTask);
  return Response.json({
    principal: auth.principal,
    summary: {
      open: tasks.filter((task) => task.status === "OPEN").length,
      inProgress: tasks.filter((task) => task.status === "IN_PROGRESS").length,
      waiting: tasks.filter((task) => task.status === "WAITING").length,
      done: tasks.filter((task) => task.status === "DONE").length,
      critical: tasks.filter((task) => task.status !== "DONE" && task.priority === "CRITICAL").length,
    },
    tasks,
    syncRuns: syncResult.results.map((row) => ({
      id: row.id,
      source: row.source,
      scope: row.scope,
      snapshotDate: row.snapshot_date,
      status: row.status,
      recordCount: row.record_count,
      metrics: safeJson<Record<string, number>>(row.metrics_json, {}),
      errorMessage: row.error_message,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    })),
    audits: auditResult.results.map((row) => ({
      id: row.id,
      actorEmail: row.actor_email,
      actorEmployeeId: row.actor_employee_id,
      module: row.module,
      action: row.action,
      entityType: row.entity_type,
      entityId: row.entity_id,
      reason: row.reason,
      createdAt: row.created_at,
    })),
  });
}

export async function POST(request: Request) {
  const auth = await authorizeErpRequest(db, "operations", "write");
  if (auth.response) return auth.response;
  const body = await request.json() as Record<string, unknown>;
  const taskModule = typeof body.module === "string" ? body.module : "operations";
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 150) : "";
  const category = typeof body.category === "string" ? body.category.trim().slice(0, 50) : "일반";
  const description = typeof body.description === "string" ? body.description.trim().slice(0, 1000) : "";
  const ownerEmployeeId = typeof body.ownerEmployeeId === "string" ? body.ownerEmployeeId.trim().slice(0, 60) : auth.principal.employeeId;
  const dueDate = typeof body.dueDate === "string" ? body.dueDate.trim() : "";
  const priority = typeof body.priority === "string" ? body.priority : "NORMAL";
  const destination = typeof body.destination === "string" ? body.destination.trim().slice(0, 120) : "";

  if (!allowedModules.has(taskModule) || !title || !allowedPriorities.has(priority)) {
    return Response.json({ error: "업무의 모듈, 제목 또는 우선순위를 확인해 주세요." }, { status: 400 });
  }
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return Response.json({ error: "기한은 YYYY-MM-DD 형식으로 입력해 주세요." }, { status: 400 });
  }

  const now = Date.now();
  const task = {
    id: crypto.randomUUID(), module: taskModule, category, title, description, ownerEmployeeId,
    dueDate, status: "OPEN", priority, destination, sourceType: "MANUAL", sourceId: "",
    createdAt: now, updatedAt: now, completedAt: null,
  };
  await db.prepare(`INSERT INTO erp_tasks
    (id, module, category, title, description, owner_employee_id, due_date, status,
      priority, destination, source_type, source_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?, 'MANUAL', '', ?, ?)`)
    .bind(task.id, task.module, task.category, task.title, task.description,
      task.ownerEmployeeId, task.dueDate, task.priority, task.destination, now, now).run();
  await writeErpAudit(db, {
    principal: auth.principal,
    module: "operations",
    action: "CREATE",
    entityType: "TASK",
    entityId: task.id,
    after: task,
  });
  return Response.json({ task }, { status: 201 });
}

export async function PUT(request: Request) {
  const auth = await authorizeErpRequest(db, "operations", "write");
  if (auth.response) return auth.response;
  const body = await request.json() as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) return Response.json({ error: "업무 ID가 필요합니다." }, { status: 400 });

  const before = await db.prepare(`SELECT id, module, category, title, description,
    owner_employee_id, due_date, status, priority, destination, source_type, source_id,
    created_at, updated_at, completed_at FROM erp_tasks
    WHERE id = ? AND deleted_at IS NULL`).bind(id).first<TaskRow>();
  if (!before) return Response.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });

  const status = typeof body.status === "string" ? body.status : before.status;
  const priority = typeof body.priority === "string" ? body.priority : before.priority;
  const ownerEmployeeId = typeof body.ownerEmployeeId === "string" ? body.ownerEmployeeId.trim().slice(0, 60) : before.owner_employee_id;
  const dueDate = typeof body.dueDate === "string" ? body.dueDate.trim() : before.due_date;
  if (!allowedStatuses.has(status) || !allowedPriorities.has(priority)) {
    return Response.json({ error: "지원하지 않는 업무 상태 또는 우선순위입니다." }, { status: 400 });
  }
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return Response.json({ error: "기한은 YYYY-MM-DD 형식으로 입력해 주세요." }, { status: 400 });
  }

  const now = Date.now();
  const completedAt = status === "DONE" ? (before.completed_at ?? now) : null;
  await db.prepare(`UPDATE erp_tasks SET owner_employee_id = ?, due_date = ?, status = ?,
    priority = ?, updated_at = ?, completed_at = ? WHERE id = ?`)
    .bind(ownerEmployeeId, dueDate, status, priority, now, completedAt, id).run();
  const after = { ...toTask(before), ownerEmployeeId, dueDate, status, priority, updatedAt: now, completedAt };
  await writeErpAudit(db, {
    principal: auth.principal,
    module: "operations",
    action: "UPDATE",
    entityType: "TASK",
    entityId: id,
    before: toTask(before),
    after,
    reason: typeof body.reason === "string" ? body.reason : "",
  });
  return Response.json({ task: after });
}

export async function DELETE(request: Request) {
  const auth = await authorizeErpRequest(db, "operations", "delete");
  if (auth.response) return auth.response;
  const body = await request.json() as { id?: string; reason?: string };
  const id = body.id?.trim() ?? "";
  if (!id) return Response.json({ error: "업무 ID가 필요합니다." }, { status: 400 });
  const before = await db.prepare(`SELECT id, module, category, title, description,
    owner_employee_id, due_date, status, priority, destination, source_type, source_id,
    created_at, updated_at, completed_at FROM erp_tasks
    WHERE id = ? AND deleted_at IS NULL`).bind(id).first<TaskRow>();
  if (!before) return Response.json({ error: "업무를 찾을 수 없습니다." }, { status: 404 });
  await db.prepare("UPDATE erp_tasks SET deleted_at = ?, updated_at = ? WHERE id = ?")
    .bind(Date.now(), Date.now(), id).run();
  await writeErpAudit(db, {
    principal: auth.principal,
    module: "operations",
    action: "SOFT_DELETE",
    entityType: "TASK",
    entityId: id,
    before: toTask(before),
    reason: body.reason ?? "",
  });
  return Response.json({ id, deleted: true });
}
