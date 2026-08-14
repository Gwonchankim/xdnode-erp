CREATE TABLE IF NOT EXISTS sales_account_contacts (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  contact_key TEXT NOT NULL,
  name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  is_primary INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_contact_account_key
ON sales_account_contacts(account_id, contact_key);

CREATE INDEX IF NOT EXISTS idx_sales_contact_account_status
ON sales_account_contacts(account_id, status);

CREATE TABLE IF NOT EXISTS sales_opportunity_activities (
  id TEXT PRIMARY KEY NOT NULL,
  opportunity_id TEXT NOT NULL,
  contact_id TEXT NOT NULL DEFAULT '',
  activity_type TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  summary TEXT NOT NULL,
  next_action TEXT NOT NULL DEFAULT '',
  next_action_date TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sales_activity_opportunity_occurred
ON sales_opportunity_activities(opportunity_id, occurred_at);

CREATE TABLE IF NOT EXISTS sales_opportunity_stage_history (
  id TEXT PRIMARY KEY NOT NULL,
  opportunity_id TEXT NOT NULL,
  from_stage TEXT NOT NULL DEFAULT '',
  to_stage TEXT NOT NULL,
  reason TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sales_stage_history_opportunity_changed
ON sales_opportunity_stage_history(opportunity_id, changed_at);
