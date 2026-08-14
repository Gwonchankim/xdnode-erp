ALTER TABLE erp_master_impact_cases ADD COLUMN escalation_level INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE erp_master_impact_cases ADD COLUMN escalated_at INTEGER;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS erp_master_impact_sla_policies (
  id TEXT PRIMARY KEY NOT NULL, default_due_days INTEGER NOT NULL DEFAULT 3,
  manager_escalation_days INTEGER NOT NULL DEFAULT 1, executive_escalation_days INTEGER NOT NULL DEFAULT 3,
  version INTEGER NOT NULL DEFAULT 1, updated_by TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO erp_master_impact_sla_policies
  (id, default_due_days, manager_escalation_days, executive_escalation_days, version, updated_by, updated_at)
VALUES ('default', 3, 1, 3, 1, 'SYSTEM', 0);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS erp_master_impact_weekly_reports (
  id TEXT PRIMARY KEY NOT NULL, week_start TEXT NOT NULL, week_end TEXT NOT NULL, version INTEGER NOT NULL,
  active_count INTEGER NOT NULL, overdue_count INTEGER NOT NULL, manager_escalated_count INTEGER NOT NULL,
  executive_escalated_count INTEGER NOT NULL, snapshot_json TEXT NOT NULL, checksum TEXT NOT NULL,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_master_impact_weekly_report_version
ON erp_master_impact_weekly_reports(week_start, version);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_erp_master_impact_weekly_report_created
ON erp_master_impact_weekly_reports(created_at);
