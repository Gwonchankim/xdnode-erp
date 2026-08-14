export async function ensureDataGovernanceSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS erp_data_control_runs (
      id TEXT PRIMARY KEY NOT NULL, status TEXT NOT NULL DEFAULT 'RUNNING',
      requested_by TEXT NOT NULL, check_count INTEGER NOT NULL DEFAULT 0,
      failed_count INTEGER NOT NULL DEFAULT 0, warning_count INTEGER NOT NULL DEFAULT 0,
      summary_json TEXT NOT NULL DEFAULT '{}', started_at INTEGER NOT NULL,
      completed_at INTEGER, created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_erp_data_control_run_created
      ON erp_data_control_runs (created_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS erp_data_control_checks (
      id TEXT PRIMARY KEY NOT NULL, run_id TEXT NOT NULL, check_code TEXT NOT NULL,
      category TEXT NOT NULL, status TEXT NOT NULL, title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '', evidence_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_data_control_check_run_code
      ON erp_data_control_checks (run_id, check_code)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_erp_data_control_check_status
      ON erp_data_control_checks (status, created_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS erp_logical_snapshots (
      id TEXT PRIMARY KEY NOT NULL, scope TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'CREATING',
      object_key TEXT NOT NULL DEFAULT '', file_name TEXT NOT NULL DEFAULT '',
      content_type TEXT NOT NULL DEFAULT 'application/json', sha256 TEXT NOT NULL DEFAULT '',
      byte_size INTEGER NOT NULL DEFAULT 0, table_count INTEGER NOT NULL DEFAULT 0,
      row_count INTEGER NOT NULL DEFAULT 0, manifest_json TEXT NOT NULL DEFAULT '{}',
      requested_by TEXT NOT NULL, created_at INTEGER NOT NULL, verified_at INTEGER,
      verified_by TEXT NOT NULL DEFAULT '', verification_status TEXT NOT NULL DEFAULT 'PENDING',
      verification_detail TEXT NOT NULL DEFAULT '', failure_message TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_erp_logical_snapshot_created
      ON erp_logical_snapshots (created_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_erp_logical_snapshot_status
      ON erp_logical_snapshots (status, verification_status)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS erp_recovery_rehearsals (
      id TEXT PRIMARY KEY NOT NULL, snapshot_id TEXT NOT NULL, status TEXT NOT NULL,
      check_count INTEGER NOT NULL DEFAULT 0, failure_count INTEGER NOT NULL DEFAULT 0,
      detail_json TEXT NOT NULL DEFAULT '{}', performed_by TEXT NOT NULL,
      performed_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_erp_recovery_rehearsal_snapshot
      ON erp_recovery_rehearsals (snapshot_id, performed_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS erp_audit_exports (
      id TEXT PRIMARY KEY NOT NULL, date_from TEXT NOT NULL, date_to TEXT NOT NULL,
      module TEXT NOT NULL DEFAULT 'ALL', status TEXT NOT NULL DEFAULT 'CREATING',
      object_key TEXT NOT NULL DEFAULT '', file_name TEXT NOT NULL DEFAULT '',
      sha256 TEXT NOT NULL DEFAULT '', byte_size INTEGER NOT NULL DEFAULT 0,
      row_count INTEGER NOT NULL DEFAULT 0, requested_by TEXT NOT NULL,
      created_at INTEGER NOT NULL, failure_message TEXT NOT NULL DEFAULT ''
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_erp_audit_export_created
      ON erp_audit_exports (created_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS erp_retention_policies (
      id TEXT PRIMARY KEY NOT NULL, data_type TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL, retention_days INTEGER NOT NULL,
      disposition TEXT NOT NULL DEFAULT 'REVIEW_REQUIRED', active INTEGER NOT NULL DEFAULT 0,
      updated_by TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL
    )`),
  ]);
  const now = Date.now();
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO erp_retention_policies
      (id, data_type, label, retention_days, disposition, active, updated_at)
      VALUES ('retention-audit', 'AUDIT_LOG', '감사기록', 2555, 'REVIEW_REQUIRED', 0, ?)`)
      .bind(now),
    db.prepare(`INSERT OR IGNORE INTO erp_retention_policies
      (id, data_type, label, retention_days, disposition, active, updated_at)
      VALUES ('retention-hr', 'HR_RECORD', '인사기록', 3650, 'REVIEW_REQUIRED', 0, ?)`)
      .bind(now),
    db.prepare(`INSERT OR IGNORE INTO erp_retention_policies
      (id, data_type, label, retention_days, disposition, active, updated_at)
      VALUES ('retention-payroll', 'PAYROLL', '급여기록', 4015, 'REVIEW_REQUIRED', 0, ?)`)
      .bind(now),
    db.prepare(`INSERT OR IGNORE INTO erp_retention_policies
      (id, data_type, label, retention_days, disposition, active, updated_at)
      VALUES ('retention-audio', 'AUDIO', '면담 녹음', 1095, 'REVIEW_REQUIRED', 0, ?)`)
      .bind(now),
  ]);
}
