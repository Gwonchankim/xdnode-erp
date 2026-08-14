export async function ensureFinanceImportMappingSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_import_mapping_sets (
      id TEXT PRIMARY KEY NOT NULL, source_id TEXT NOT NULL, name TEXT NOT NULL,
      data_type TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'DRAFT',
      field_mapping_json TEXT NOT NULL DEFAULT '{}', approval_request_id TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL, approved_by TEXT NOT NULL DEFAULT '', submitted_at INTEGER,
      approved_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_import_mapping_version
      ON finance_import_mapping_sets (source_id, data_type, version)`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_import_mapping_active
      ON finance_import_mapping_sets (source_id, data_type) WHERE status = 'ACTIVE'`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_finance_import_mapping_status
      ON finance_import_mapping_sets (status, updated_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_import_mapping_rules (
      id TEXT PRIMARY KEY NOT NULL, mapping_set_id TEXT NOT NULL, dimension_type TEXT NOT NULL,
      source_key TEXT NOT NULL, source_label TEXT NOT NULL DEFAULT '', target_id TEXT NOT NULL DEFAULT '',
      target_code TEXT NOT NULL DEFAULT '', target_label TEXT NOT NULL DEFAULT '',
      mapping_method TEXT NOT NULL DEFAULT 'MANUAL', created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_import_rule_key
      ON finance_import_mapping_rules (mapping_set_id, dimension_type, source_key)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_finance_import_rule_target
      ON finance_import_mapping_rules (dimension_type, target_id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_import_validations (
      id TEXT PRIMARY KEY NOT NULL, batch_id TEXT NOT NULL, mapping_set_id TEXT NOT NULL,
      data_type TEXT NOT NULL, status TEXT NOT NULL, row_count INTEGER NOT NULL DEFAULT 0,
      valid_count INTEGER NOT NULL DEFAULT 0, invalid_count INTEGER NOT NULL DEFAULT 0,
      account_mapped_count INTEGER NOT NULL DEFAULT 0, partner_mapped_count INTEGER NOT NULL DEFAULT 0,
      department_mapped_count INTEGER NOT NULL DEFAULT 0, total_debit INTEGER NOT NULL DEFAULT 0,
      total_credit INTEGER NOT NULL DEFAULT 0, difference_amount INTEGER NOT NULL DEFAULT 0,
      result_json TEXT NOT NULL DEFAULT '{}', created_by TEXT NOT NULL, created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_finance_import_validation_batch_created
      ON finance_import_validations (batch_id, created_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_import_canonical_rows (
      id TEXT PRIMARY KEY NOT NULL, validation_id TEXT NOT NULL, batch_id TEXT NOT NULL,
      row_number INTEGER NOT NULL, record_type TEXT NOT NULL, record_key TEXT NOT NULL DEFAULT '',
      canonical_json TEXT NOT NULL DEFAULT '{}', validation_status TEXT NOT NULL,
      issues_json TEXT NOT NULL DEFAULT '[]', source_checksum TEXT NOT NULL, created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_import_canonical_row
      ON finance_import_canonical_rows (validation_id, row_number)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_finance_import_canonical_batch_status
      ON finance_import_canonical_rows (batch_id, validation_status)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_import_mapping_events (
      id TEXT PRIMARY KEY NOT NULL, mapping_set_id TEXT NOT NULL, action TEXT NOT NULL,
      from_status TEXT NOT NULL DEFAULT '', to_status TEXT NOT NULL DEFAULT '', actor_employee_id TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '', snapshot_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_finance_import_mapping_event_created
      ON finance_import_mapping_events (mapping_set_id, created_at)`),
  ]);
}
