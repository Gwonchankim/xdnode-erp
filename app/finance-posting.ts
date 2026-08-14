export async function ensureFinancePostingSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_posting_batches (
      id TEXT PRIMARY KEY NOT NULL, validation_id TEXT NOT NULL DEFAULT '', source_batch_id TEXT NOT NULL DEFAULT '',
      batch_number TEXT NOT NULL, source_type TEXT NOT NULL DEFAULT 'IMPORT', reversal_of_batch_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'DRAFT', period_from TEXT NOT NULL, period_to TEXT NOT NULL,
      voucher_count INTEGER NOT NULL DEFAULT 0, line_count INTEGER NOT NULL DEFAULT 0,
      total_debit INTEGER NOT NULL DEFAULT 0, total_credit INTEGER NOT NULL DEFAULT 0,
      difference_amount INTEGER NOT NULL DEFAULT 0, approval_request_id TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT '', prepared_by TEXT NOT NULL, approved_by TEXT NOT NULL DEFAULT '',
      posted_by TEXT NOT NULL DEFAULT '', submitted_at INTEGER, approved_at INTEGER, posted_at INTEGER,
      version INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_posting_validation
      ON finance_posting_batches (validation_id) WHERE validation_id <> ''`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_posting_reversal
      ON finance_posting_batches (reversal_of_batch_id) WHERE reversal_of_batch_id <> ''`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_posting_batch_number
      ON finance_posting_batches (batch_number)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_finance_posting_status_period
      ON finance_posting_batches (status, period_from, period_to)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_posting_vouchers (
      id TEXT PRIMARY KEY NOT NULL, batch_id TEXT NOT NULL, source_voucher_key TEXT NOT NULL,
      voucher_date TEXT NOT NULL, period TEXT NOT NULL, voucher_number TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '', source_reference TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'DRAFT', line_count INTEGER NOT NULL DEFAULT 0,
      total_debit INTEGER NOT NULL DEFAULT 0, total_credit INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_posting_source_voucher
      ON finance_posting_vouchers (batch_id, source_voucher_key)`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_posting_voucher_number
      ON finance_posting_vouchers (voucher_number) WHERE voucher_number <> ''`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_finance_posting_voucher_period
      ON finance_posting_vouchers (period, status)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_posting_lines (
      id TEXT PRIMARY KEY NOT NULL, voucher_id TEXT NOT NULL, line_number INTEGER NOT NULL,
      account_id TEXT NOT NULL, account_code TEXT NOT NULL, account_name TEXT NOT NULL,
      partner_id TEXT NOT NULL DEFAULT '', partner_name TEXT NOT NULL DEFAULT '',
      department_id TEXT NOT NULL DEFAULT '', department_name TEXT NOT NULL DEFAULT '',
      tax_code_id TEXT NOT NULL DEFAULT '', tax_code TEXT NOT NULL DEFAULT '', tax_code_name TEXT NOT NULL DEFAULT '',
      tax_review_status TEXT NOT NULL DEFAULT 'PENDING', tax_review_note TEXT NOT NULL DEFAULT '',
      tax_reviewed_by TEXT NOT NULL DEFAULT '', tax_reviewed_at INTEGER,
      description TEXT NOT NULL DEFAULT '', debit_amount INTEGER NOT NULL DEFAULT 0,
      credit_amount INTEGER NOT NULL DEFAULT 0, source_canonical_row_id TEXT NOT NULL DEFAULT '',
      source_checksum TEXT NOT NULL DEFAULT '', reversal_of_line_id TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_posting_line_number
      ON finance_posting_lines (voucher_id, line_number)`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_posting_source_row
      ON finance_posting_lines (source_canonical_row_id) WHERE source_canonical_row_id <> ''`),
    db.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_posting_reversal_line
      ON finance_posting_lines (reversal_of_line_id) WHERE reversal_of_line_id <> ''`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_finance_posting_tax_review
      ON finance_posting_lines (tax_review_status, tax_code_id)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_posting_events (
      id TEXT PRIMARY KEY NOT NULL, batch_id TEXT NOT NULL, action TEXT NOT NULL,
      from_status TEXT NOT NULL DEFAULT '', to_status TEXT NOT NULL DEFAULT '', actor_employee_id TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT '', snapshot_json TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_finance_posting_event_created
      ON finance_posting_events (batch_id, created_at)`),
  ]);
}
