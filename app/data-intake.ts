export async function ensureDataIntakeSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS erp_data_import_batches (
      id TEXT PRIMARY KEY NOT NULL, source_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'UPLOADED',
      file_name TEXT NOT NULL, content_type TEXT NOT NULL, storage_key TEXT NOT NULL,
      file_sha256 TEXT NOT NULL, byte_size INTEGER NOT NULL DEFAULT 0, parser_type TEXT NOT NULL,
      header_json TEXT NOT NULL DEFAULT '[]', mapping_json TEXT NOT NULL DEFAULT '{}',
      total_rows INTEGER NOT NULL DEFAULT 0, valid_rows INTEGER NOT NULL DEFAULT 0,
      invalid_rows INTEGER NOT NULL DEFAULT 0, duplicate_rows INTEGER NOT NULL DEFAULT 0,
      create_rows INTEGER NOT NULL DEFAULT 0, update_rows INTEGER NOT NULL DEFAULT 0,
      skip_rows INTEGER NOT NULL DEFAULT 0, approval_request_id TEXT NOT NULL DEFAULT '',
      requested_by TEXT NOT NULL, submitted_at INTEGER, approved_at INTEGER, applied_at INTEGER,
      applied_by TEXT NOT NULL DEFAULT '', failure_message TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_data_import_source_hash
      ON erp_data_import_batches (source_id, file_sha256)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_erp_data_import_status_created
      ON erp_data_import_batches (status, created_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS erp_data_import_rows (
      id TEXT PRIMARY KEY NOT NULL, batch_id TEXT NOT NULL, row_number INTEGER NOT NULL,
      raw_json TEXT NOT NULL, normalized_json TEXT NOT NULL DEFAULT '{}', identity_key TEXT NOT NULL DEFAULT '',
      row_checksum TEXT NOT NULL, validation_status TEXT NOT NULL DEFAULT 'VALID',
      issues_json TEXT NOT NULL DEFAULT '[]', proposed_action TEXT NOT NULL DEFAULT 'SKIP',
      target_entity_type TEXT NOT NULL DEFAULT '', target_entity_id TEXT NOT NULL DEFAULT '',
      applied_at INTEGER, created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_data_import_row_number
      ON erp_data_import_rows (batch_id, row_number)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_erp_data_import_row_validation
      ON erp_data_import_rows (batch_id, validation_status, proposed_action)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_erp_data_import_row_identity
      ON erp_data_import_rows (batch_id, identity_key)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS erp_data_import_events (
      id TEXT PRIMARY KEY NOT NULL, batch_id TEXT NOT NULL, action TEXT NOT NULL,
      from_status TEXT NOT NULL DEFAULT '', to_status TEXT NOT NULL DEFAULT '',
      actor_employee_id TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      snapshot_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_erp_data_import_event_batch_created
      ON erp_data_import_events (batch_id, created_at)`),
  ]);
}
