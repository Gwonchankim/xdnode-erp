export async function ensureDataIntegrationSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS erp_integration_sources (
      id TEXT PRIMARY KEY NOT NULL, source_code TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      category TEXT NOT NULL, system_type TEXT NOT NULL, connection_mode TEXT NOT NULL,
      scope TEXT NOT NULL, expected_cadence TEXT NOT NULL DEFAULT 'ON_DEMAND',
      expected_hour_kst INTEGER NOT NULL DEFAULT 0, freshness_hours INTEGER NOT NULL DEFAULT 0,
      criticality TEXT NOT NULL DEFAULT 'NORMAL', owner_employee_id TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1, description TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_erp_integration_source_enabled_category
      ON erp_integration_sources (enabled, category)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS erp_integration_exceptions (
      id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL, source_id TEXT NOT NULL,
      exception_key TEXT NOT NULL, exception_type TEXT NOT NULL, severity TEXT NOT NULL,
      title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', source_ref TEXT NOT NULL DEFAULT '',
      target_ref TEXT NOT NULL DEFAULT '', source_amount INTEGER NOT NULL DEFAULT 0,
      target_amount INTEGER NOT NULL DEFAULT 0, difference_amount INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'OPEN', suggested_action TEXT NOT NULL DEFAULT '',
      owner_employee_id TEXT NOT NULL DEFAULT '', resolution_note TEXT NOT NULL DEFAULT '',
      resolved_by TEXT NOT NULL DEFAULT '', resolved_at INTEGER, created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_integration_exception_run_key
      ON erp_integration_exceptions (run_id, exception_key)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_erp_integration_exception_status_severity
      ON erp_integration_exceptions (status, severity, created_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_erp_integration_exception_source
      ON erp_integration_exceptions (source_id, created_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS erp_sync_run_events (
      id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL, action TEXT NOT NULL,
      from_status TEXT NOT NULL DEFAULT '', to_status TEXT NOT NULL DEFAULT '',
      actor_employee_id TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      snapshot_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_erp_sync_run_event_run_created
      ON erp_sync_run_events (run_id, created_at)`),
  ]);

  const columns = await db.prepare("PRAGMA table_info(erp_sync_runs)").all<{ name: string }>();
  const existing = new Set(columns.results.map((column) => column.name));
  const additions = [
    ["source_id", "TEXT NOT NULL DEFAULT ''"], ["run_type", "TEXT NOT NULL DEFAULT 'SNAPSHOT'"],
    ["trigger_type", "TEXT NOT NULL DEFAULT 'SYSTEM'"], ["idempotency_key", "TEXT NOT NULL DEFAULT ''"],
    ["source_checksum", "TEXT NOT NULL DEFAULT ''"], ["received_count", "INTEGER NOT NULL DEFAULT 0"],
    ["inserted_count", "INTEGER NOT NULL DEFAULT 0"], ["updated_count", "INTEGER NOT NULL DEFAULT 0"],
    ["duplicate_count", "INTEGER NOT NULL DEFAULT 0"], ["rejected_count", "INTEGER NOT NULL DEFAULT 0"],
    ["review_count", "INTEGER NOT NULL DEFAULT 0"], ["requested_by", "TEXT NOT NULL DEFAULT ''"],
    ["retry_of_run_id", "TEXT NOT NULL DEFAULT ''"], ["report_json", "TEXT NOT NULL DEFAULT '{}'"],
    ["correlation_id", "TEXT NOT NULL DEFAULT ''"], ["review_status", "TEXT NOT NULL DEFAULT 'NOT_REQUIRED'"],
    ["reviewed_by", "TEXT NOT NULL DEFAULT ''"], ["reviewed_at", "INTEGER"],
  ] as const;
  for (const [name, definition] of additions) {
    if (!existing.has(name)) await db.prepare(`ALTER TABLE erp_sync_runs ADD COLUMN ${name} ${definition}`).run();
  }
  await db.batch([
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_sync_idempotency
      ON erp_sync_runs (source_id, run_type, idempotency_key) WHERE idempotency_key <> ''`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_erp_sync_source_status_snapshot
      ON erp_sync_runs (source_id, status, snapshot_date)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_erp_sync_retry
      ON erp_sync_runs (retry_of_run_id, created_at)`),
  ]);
}
