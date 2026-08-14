export async function ensureFinanceAlertActionSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_alert_cases (
      id TEXT PRIMARY KEY NOT NULL, task_id TEXT NOT NULL, task_source_id TEXT NOT NULL,
      source_destination TEXT NOT NULL DEFAULT '', title_snapshot TEXT NOT NULL,
      description_snapshot TEXT NOT NULL DEFAULT '', priority_snapshot TEXT NOT NULL DEFAULT 'NORMAL',
      owner_employee_id TEXT NOT NULL DEFAULT '', due_date TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'OPEN',
      root_cause TEXT NOT NULL DEFAULT '', impact_assessment TEXT NOT NULL DEFAULT '', action_plan TEXT NOT NULL DEFAULT '',
      resolution_summary TEXT NOT NULL DEFAULT '', submitted_by TEXT NOT NULL DEFAULT '', submitted_at INTEGER,
      reviewed_by TEXT NOT NULL DEFAULT '', reviewed_at INTEGER, review_comment TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, closed_at INTEGER
    )`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_alert_case_task_source ON finance_alert_cases(task_id, task_source_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_alert_case_status_due ON finance_alert_cases(status, due_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_alert_case_owner_status ON finance_alert_cases(owner_employee_id, status)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_alert_case_events (
      id TEXT PRIMARY KEY NOT NULL, case_id TEXT NOT NULL, action TEXT NOT NULL,
      actor_employee_id TEXT NOT NULL, comment TEXT NOT NULL DEFAULT '', snapshot_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_finance_alert_case_event_case_created ON finance_alert_case_events(case_id, created_at)"),
  ]);
}

export async function hasClosedFinanceAlertCase(db: D1Database, taskId: string, taskSourceId: string) {
  await ensureFinanceAlertActionSchema(db);
  const row = await db.prepare(`SELECT id FROM finance_alert_cases
    WHERE task_id = ? AND task_source_id = ? AND status = 'CLOSED' LIMIT 1`)
    .bind(taskId, taskSourceId).first<{ id: string }>();
  return Boolean(row);
}
