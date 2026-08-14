import { env } from "cloudflare:workers";
import { authorizeErpRequest, writeErpAudit } from "../../erp-platform";

type Bindings = { DB: D1Database };
const db = (env as unknown as Bindings).DB;

type PreferenceRow = {
  item_type: string; item_id: string; pinned: number; snoozed_until: string; note: string;
  created_at: number; updated_at: number;
};
type UnifiedItem = {
  key: string; itemType: "TASK" | "MANAGEMENT_ACTION" | "MANAGEMENT_DECISION"; itemId: string;
  reportId: string; module: string; category: string; title: string; description: string;
  ownerEmployeeId: string; dueDate: string; status: string; priority: string; destination: string;
  sourceType: string; canStart: boolean; canComplete: boolean; updatedAt: number;
  pinned: boolean; snoozedUntil: string; note: string; bucket: "OVERDUE" | "TODAY" | "UPCOMING" | "SNOOZED";
};

const itemTypes = new Set(["TASK", "MANAGEMENT_ACTION", "MANAGEMENT_DECISION"]);

function todayKst() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function ensureSchema() {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS erp_workbench_preferences (
      id TEXT PRIMARY KEY NOT NULL, employee_id TEXT NOT NULL, item_type TEXT NOT NULL,
      item_id TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, snoozed_until TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_workbench_preference_item ON erp_workbench_preferences(employee_id, item_type, item_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_erp_workbench_preference_focus ON erp_workbench_preferences(employee_id, pinned, snoozed_until)"),
  ]);
}

function preferenceMap(rows: PreferenceRow[]) {
  return new Map(rows.map((row) => [`${row.item_type}:${row.item_id}`, row]));
}

function bucketFor(dueDate: string, snoozedUntil: string, today: string): UnifiedItem["bucket"] {
  if (snoozedUntil > today) return "SNOOZED";
  if (dueDate && dueDate < today) return "OVERDUE";
  if (!dueDate || dueDate === today) return "TODAY";
  return "UPCOMING";
}

function priorityRank(priority: string) {
  return ({ CRITICAL: 0, HIGH: 1, NORMAL: 2, LOW: 3 } as Record<string, number>)[priority] ?? 4;
}

function sortItems(items: UnifiedItem[]) {
  const bucketRank = { OVERDUE: 0, TODAY: 1, UPCOMING: 2, SNOOZED: 3 } as const;
  return items.sort((a, b) => Number(b.pinned) - Number(a.pinned)
    || bucketRank[a.bucket] - bucketRank[b.bucket]
    || priorityRank(a.priority) - priorityRank(b.priority)
    || (a.dueDate || "9999-12-31").localeCompare(b.dueDate || "9999-12-31")
    || b.updatedAt - a.updatedAt);
}

async function ownsItem(employeeId: string, itemType: string, itemId: string) {
  if (itemType === "TASK") return Boolean(await db.prepare(`SELECT 1 AS found FROM erp_tasks
    WHERE id = ? AND owner_employee_id = ? AND deleted_at IS NULL`).bind(itemId, employeeId).first());
  if (itemType === "MANAGEMENT_ACTION") return Boolean(await db.prepare(`SELECT 1 AS found
    FROM finance_management_report_actions WHERE id = ? AND owner_employee_id = ?`).bind(itemId, employeeId).first());
  if (itemType === "MANAGEMENT_DECISION") return Boolean(await db.prepare(`SELECT 1 AS found
    FROM finance_management_decisions WHERE id = ? AND owner_employee_id = ?`).bind(itemId, employeeId).first());
  return false;
}

export async function GET() {
  const authorization = await authorizeErpRequest(db, "operations", "read");
  if (authorization.response) return authorization.response;
  await ensureSchema();
  const employeeId = authorization.principal.employeeId;
  const roles = new Set(authorization.principal.roles);
  const canWriteOperations = roles.has("SUPER_ADMIN") || roles.has("FINANCE_ADMIN") || roles.has("HR_ADMIN") || roles.has("SALES_ADMIN");
  const canWriteFinance = roles.has("SUPER_ADMIN") || roles.has("FINANCE_ADMIN");
  const today = todayKst();
  const [tasks, actions, decisions, preferences] = await Promise.all([
    db.prepare(`SELECT id, module, category, title, description, owner_employee_id, due_date, status,
      priority, destination, source_type, source_id, updated_at FROM erp_tasks
      WHERE owner_employee_id = ? AND deleted_at IS NULL AND status <> 'DONE'
        AND id NOT IN ('management-report-actions','management-report-decisions')`).bind(employeeId).all<Record<string, string | number>>(),
    db.prepare(`SELECT action.id, action.report_id, action.source_section, action.title, action.memo,
      action.owner_employee_id, action.due_date, action.status, action.updated_at
      FROM finance_management_report_actions action
      JOIN finance_management_reports report ON report.id = action.report_id
      WHERE action.owner_employee_id = ? AND action.status <> 'DONE'
        AND report.status IN ('DRAFT','SUBMITTED','APPROVED')
        AND report.version = (SELECT MAX(peer.version) FROM finance_management_reports peer WHERE peer.period = report.period)`)
      .bind(employeeId).all<Record<string, string | number>>(),
    db.prepare(`SELECT decision.id, decision.report_id, decision.source_section, decision.decision_type,
      decision.title, decision.proposal, decision.financial_impact, decision.owner_employee_id,
      decision.decision_due_date, decision.status, decision.updated_at
      FROM finance_management_decisions decision
      JOIN finance_management_reports report ON report.id = decision.report_id
      WHERE decision.owner_employee_id = ? AND decision.status = 'PENDING' AND report.status = 'APPROVED'
        AND report.version = (SELECT MAX(peer.version) FROM finance_management_reports peer WHERE peer.period = report.period)`)
      .bind(employeeId).all<Record<string, string | number>>(),
    db.prepare(`SELECT item_type, item_id, pinned, snoozed_until, note, created_at, updated_at
      FROM erp_workbench_preferences WHERE employee_id = ?`).bind(employeeId).all<PreferenceRow>(),
  ]);
  const prefs = preferenceMap(preferences.results);
  const decorate = (base: Omit<UnifiedItem, "pinned" | "snoozedUntil" | "note" | "bucket">): UnifiedItem => {
    const preference = prefs.get(base.key);
    const snoozedUntil = preference?.snoozed_until ?? "";
    return { ...base, pinned: Boolean(preference?.pinned), snoozedUntil, note: preference?.note ?? "", bucket: bucketFor(base.dueDate, snoozedUntil, today) };
  };
  const items: UnifiedItem[] = [
    ...tasks.results.map((row) => decorate({
      key: `TASK:${row.id}`, itemType: "TASK", itemId: String(row.id), reportId: "", module: String(row.module),
      category: String(row.category), title: String(row.title), description: String(row.description),
      ownerEmployeeId: String(row.owner_employee_id), dueDate: String(row.due_date), status: String(row.status),
      priority: String(row.priority), destination: String(row.destination), sourceType: String(row.source_type),
      canStart: canWriteOperations && row.status === "OPEN" && row.source_type !== "MASTER_IMPACT_CASE", canComplete: canWriteOperations && row.source_type === "MANUAL", updatedAt: Number(row.updated_at),
    })),
    ...actions.results.map((row) => decorate({
      key: `MANAGEMENT_ACTION:${row.id}`, itemType: "MANAGEMENT_ACTION", itemId: String(row.id), reportId: String(row.report_id),
      module: "finance", category: "경영보고 조치", title: String(row.title), description: String(row.memo || "경영회의 결정과 후속조치 상태를 갱신해 주세요."),
      ownerEmployeeId: String(row.owner_employee_id), dueDate: String(row.due_date), status: String(row.status),
      priority: String(row.due_date) < today ? "HIGH" : "NORMAL", destination: "finance:report", sourceType: "MANAGEMENT_ACTION",
      canStart: canWriteFinance && row.status === "OPEN", canComplete: canWriteFinance, updatedAt: Number(row.updated_at),
    })),
    ...decisions.results.map((row) => decorate({
      key: `MANAGEMENT_DECISION:${row.id}`, itemType: "MANAGEMENT_DECISION", itemId: String(row.id), reportId: String(row.report_id),
      module: "finance", category: "경영 의사결정", title: String(row.title),
      description: `${String(row.proposal)} · 예상 재무영향 ${Number(row.financial_impact).toLocaleString("ko-KR")}원`,
      ownerEmployeeId: String(row.owner_employee_id), dueDate: String(row.decision_due_date), status: String(row.status),
      priority: String(row.decision_due_date) < today ? "HIGH" : "NORMAL", destination: "finance:report", sourceType: "MANAGEMENT_DECISION",
      canStart: false, canComplete: false, updatedAt: Number(row.updated_at),
    })),
  ];
  sortItems(items);
  return Response.json({
    principal: authorization.principal, today,
    summary: {
      total: items.length, today: items.filter((item) => item.bucket === "TODAY").length,
      overdue: items.filter((item) => item.bucket === "OVERDUE").length,
      important: items.filter((item) => item.bucket !== "SNOOZED" && ["CRITICAL", "HIGH"].includes(item.priority)).length,
      decisions: items.filter((item) => item.itemType === "MANAGEMENT_DECISION").length,
      snoozed: items.filter((item) => item.bucket === "SNOOZED").length,
    },
    items,
  });
}

export async function POST(request: Request) {
  const authorization = await authorizeErpRequest(db, "operations", "read");
  if (authorization.response) return authorization.response;
  await ensureSchema();
  const body = await request.json() as Record<string, unknown>;
  const action = String(body.action ?? "").toUpperCase();
  const itemType = String(body.itemType ?? "").toUpperCase();
  const itemId = String(body.itemId ?? "").trim();
  if (!["PIN", "SNOOZE", "NOTE"].includes(action) || !itemTypes.has(itemType) || !itemId) {
    return Response.json({ error: "개인 업무 설정의 작업과 원천 항목을 확인해 주세요." }, { status: 400 });
  }
  const employeeId = authorization.principal.employeeId;
  if (!await ownsItem(employeeId, itemType, itemId)) return Response.json({ error: "본인에게 배정된 업무만 개인 설정을 저장할 수 있습니다." }, { status: 403 });
  const existing = await db.prepare(`SELECT item_type, item_id, pinned, snoozed_until, note, created_at, updated_at
    FROM erp_workbench_preferences WHERE employee_id = ? AND item_type = ? AND item_id = ?`)
    .bind(employeeId, itemType, itemId).first<PreferenceRow>();
  const pinned = action === "PIN" ? Boolean(body.pinned) : Boolean(existing?.pinned);
  const snoozedUntil = action === "SNOOZE" ? String(body.snoozedUntil ?? "").trim() : existing?.snoozed_until ?? "";
  const note = action === "NOTE" ? String(body.note ?? "").trim().slice(0, 1000) : existing?.note ?? "";
  if (snoozedUntil && (!/^\d{4}-\d{2}-\d{2}$/.test(snoozedUntil) || snoozedUntil <= todayKst())) {
    return Response.json({ error: "미루기 날짜는 내일 이후로 선택해 주세요." }, { status: 400 });
  }
  const now = Date.now();
  const id = `${employeeId}:${itemType}:${itemId}`;
  await db.prepare(`INSERT INTO erp_workbench_preferences
    (id, employee_id, item_type, item_id, pinned, snoozed_until, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(employee_id, item_type, item_id) DO UPDATE SET pinned = excluded.pinned,
      snoozed_until = excluded.snoozed_until, note = excluded.note, updated_at = excluded.updated_at`)
    .bind(id, employeeId, itemType, itemId, pinned ? 1 : 0, snoozedUntil, note, existing?.created_at ?? now, now).run();
  const preference = { itemType, itemId, pinned, snoozedUntil, note, updatedAt: now };
  await writeErpAudit(db, { principal: authorization.principal, module: "operations", action: `WORKBENCH_${action}`,
    entityType: "WORKBENCH_PREFERENCE", entityId: id, before: existing ?? null, after: preference });
  return Response.json({ preference });
}
