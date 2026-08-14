CREATE TABLE IF NOT EXISTS erp_master_impact_assessments (
  id TEXT PRIMARY KEY NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  proposed_action TEXT NOT NULL,
  entity_version TEXT NOT NULL,
  entity_label TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  blocking_count INTEGER NOT NULL DEFAULT 0,
  warning_count INTEGER NOT NULL DEFAULT 0,
  impacted_record_count INTEGER NOT NULL DEFAULT 0,
  impact_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  used_by TEXT NOT NULL DEFAULT '',
  target_type TEXT NOT NULL DEFAULT '',
  target_id TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_erp_master_impact_entity_created ON erp_master_impact_assessments(entity_type, entity_id, created_at);
CREATE INDEX IF NOT EXISTS idx_erp_master_impact_expiry_used ON erp_master_impact_assessments(expires_at, used_at);
