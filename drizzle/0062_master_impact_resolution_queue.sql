CREATE TABLE IF NOT EXISTS erp_master_impact_cases (
  id TEXT PRIMARY KEY NOT NULL, assessment_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  action TEXT NOT NULL, impact_code TEXT NOT NULL, impact_label TEXT NOT NULL, impact_detail TEXT NOT NULL,
  severity TEXT NOT NULL, initial_count INTEGER NOT NULL, current_count INTEGER NOT NULL,
  initial_amount INTEGER NOT NULL DEFAULT 0, current_amount INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'OPEN', owner_employee_id TEXT NOT NULL DEFAULT '', due_date TEXT NOT NULL DEFAULT '',
  resolution_note TEXT NOT NULL DEFAULT '', evidence_ref TEXT NOT NULL DEFAULT '', last_rechecked_by TEXT NOT NULL DEFAULT '',
  last_rechecked_at INTEGER, created_by TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, closed_by TEXT NOT NULL DEFAULT '', closed_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_master_impact_case_open
ON erp_master_impact_cases(entity_type, entity_id, action, impact_code) WHERE status <> 'CLOSED';
CREATE INDEX IF NOT EXISTS idx_erp_master_impact_case_status_due ON erp_master_impact_cases(status, due_date);
CREATE INDEX IF NOT EXISTS idx_erp_master_impact_case_owner_status ON erp_master_impact_cases(owner_employee_id, status);
CREATE TABLE IF NOT EXISTS erp_master_impact_case_events (
  id TEXT PRIMARY KEY NOT NULL, case_id TEXT NOT NULL, action TEXT NOT NULL, actor_employee_id TEXT NOT NULL,
  from_status TEXT NOT NULL DEFAULT '', to_status TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '',
  snapshot_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_erp_master_impact_case_event_created ON erp_master_impact_case_events(case_id, created_at);
