export async function ensureSalesServiceSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_service_policies (
      id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
      priority TEXT NOT NULL, first_response_hours INTEGER NOT NULL, resolution_hours INTEGER NOT NULL,
      effective_from TEXT NOT NULL, effective_to TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'DRAFT',
      created_by TEXT NOT NULL, approved_by TEXT NOT NULL DEFAULT '', approved_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_service_cases (
      id TEXT PRIMARY KEY NOT NULL, case_number TEXT NOT NULL, account_id TEXT NOT NULL,
      opportunity_id TEXT NOT NULL, delivery_document_id TEXT NOT NULL, contract_id TEXT NOT NULL DEFAULT '',
      contact_id TEXT NOT NULL DEFAULT '', category TEXT NOT NULL, priority TEXT NOT NULL,
      subject TEXT NOT NULL, description TEXT NOT NULL, policy_id TEXT NOT NULL DEFAULT '',
      opened_at INTEGER NOT NULL, first_response_due_at INTEGER NOT NULL, resolution_due_at INTEGER NOT NULL,
      first_responded_at INTEGER, status TEXT NOT NULL DEFAULT 'OPEN', owner_employee_id TEXT NOT NULL,
      resolution_type TEXT NOT NULL DEFAULT '', resolution_note TEXT NOT NULL DEFAULT '',
      refund_amount INTEGER NOT NULL DEFAULT 0, approval_request_id TEXT NOT NULL DEFAULT '',
      finance_request_id TEXT NOT NULL DEFAULT '', resolved_by TEXT NOT NULL DEFAULT '', resolved_at INTEGER,
      closed_by TEXT NOT NULL DEFAULT '', closed_at INTEGER, created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_service_case_events (
      id TEXT PRIMARY KEY NOT NULL, case_id TEXT NOT NULL, event_type TEXT NOT NULL,
      note TEXT NOT NULL, actor_employee_id TEXT NOT NULL, created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_service_return_lines (
      id TEXT PRIMARY KEY NOT NULL, case_id TEXT NOT NULL, delivery_line_id TEXT NOT NULL,
      quantity_milli INTEGER NOT NULL, disposition TEXT NOT NULL, inventory_movement_id TEXT NOT NULL DEFAULT '',
      received_by TEXT NOT NULL DEFAULT '', received_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_service_policy_name_version ON sales_service_policies(name, version)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_service_policy_active_priority ON sales_service_policies(priority) WHERE status = 'ACTIVE'"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_service_case_number ON sales_service_cases(case_number)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_service_case_status_due ON sales_service_cases(status, resolution_due_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_service_case_account_opened ON sales_service_cases(account_id, opened_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_service_event_case_created ON sales_service_case_events(case_id, created_at)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_service_return_case_line ON sales_service_return_lines(case_id, delivery_line_id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_service_return_inventory ON sales_service_return_lines(inventory_movement_id) WHERE inventory_movement_id <> ''"),
  ]);
}
