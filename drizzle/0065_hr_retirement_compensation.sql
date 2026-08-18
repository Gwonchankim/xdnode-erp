ALTER TABLE hr_employee_records ADD COLUMN base_pay INTEGER NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE hr_employee_records ADD COLUMN meal_allowance INTEGER NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE hr_employee_records ADD COLUMN childcare_allowance INTEGER NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE hr_employee_records ADD COLUMN vehicle_allowance INTEGER NOT NULL DEFAULT 0;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS hr_compensation_runs (
  period TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  version INTEGER NOT NULL DEFAULT 1,
  employee_count INTEGER NOT NULL DEFAULT 0,
  gross_pay INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  confirmed_by TEXT NOT NULL DEFAULT '',
  confirmed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS hr_compensation_lines (
  period TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  gross_pay INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (period, employee_id)
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_hr_compensation_lines_period ON hr_compensation_lines(period, employee_id);
