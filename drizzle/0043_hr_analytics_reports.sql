CREATE TABLE IF NOT EXISTS hr_analytics_reports (
  id TEXT PRIMARY KEY NOT NULL,
  report_type TEXT NOT NULL DEFAULT 'HR_OVERVIEW',
  title TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  snapshot_json TEXT NOT NULL,
  generated_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_analytics_report_period_version
ON hr_analytics_reports(report_type, period_start, period_end, version);

CREATE INDEX IF NOT EXISTS idx_hr_analytics_report_created
ON hr_analytics_reports(created_at);
