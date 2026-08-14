export async function ensureSalesContractSchema(db: D1Database) {
  const now = Date.now();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_contract_governance_settings (
      id TEXT PRIMARY KEY NOT NULL, enforcement_started_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_contracts (
      id TEXT PRIMARY KEY NOT NULL, order_document_id TEXT NOT NULL, contract_number TEXT NOT NULL, title TEXT NOT NULL,
      version INTEGER NOT NULL DEFAULT 1, amount_snapshot INTEGER NOT NULL, currency TEXT NOT NULL DEFAULT 'KRW',
      start_date TEXT NOT NULL, end_date TEXT NOT NULL, auto_renewal INTEGER NOT NULL DEFAULT 0,
      renewal_notice_days INTEGER NOT NULL DEFAULT 30, payment_terms TEXT NOT NULL, acceptance_criteria TEXT NOT NULL,
      delivery_terms TEXT NOT NULL, owner_employee_id TEXT NOT NULL, signed_document_id TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'DRAFT', created_by TEXT NOT NULL, approved_by TEXT NOT NULL DEFAULT '',
      approved_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_contract_obligations (
      id TEXT PRIMARY KEY NOT NULL, contract_id TEXT NOT NULL, obligation_type TEXT NOT NULL, title TEXT NOT NULL,
      owner_employee_id TEXT NOT NULL, due_date TEXT NOT NULL, evidence_required INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'OPEN', completion_note TEXT NOT NULL DEFAULT '', completed_by TEXT NOT NULL DEFAULT '',
      completed_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_contract_change_requests (
      id TEXT PRIMARY KEY NOT NULL, contract_id TEXT NOT NULL, change_type TEXT NOT NULL, reason TEXT NOT NULL,
      before_json TEXT NOT NULL, after_json TEXT NOT NULL, effective_date TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'SUBMITTED',
      created_by TEXT NOT NULL, approval_request_id TEXT NOT NULL DEFAULT '', approved_by TEXT NOT NULL DEFAULT '',
      approved_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_contract_order ON sales_contracts(order_document_id)"),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_contract_number ON sales_contracts(contract_number)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_contract_status_end ON sales_contracts(status, end_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_contract_obligation_contract_due ON sales_contract_obligations(contract_id, status, due_date)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_sales_contract_change_contract_created ON sales_contract_change_requests(contract_id, created_at)"),
    db.prepare(`INSERT OR IGNORE INTO sales_contract_governance_settings (id, enforcement_started_at, created_at, updated_at)
      VALUES ('default', ?, ?, ?)`).bind(now, now, now),
  ]);
}

export async function getSalesContractGate(db: D1Database, orderDocumentId: string) {
  await ensureSalesContractSchema(db);
  const [settings, order, contract] = await Promise.all([
    db.prepare("SELECT enforcement_started_at FROM sales_contract_governance_settings WHERE id = 'default'")
      .first<{ enforcement_started_at: number }>(),
    db.prepare("SELECT id, created_at FROM sales_documents WHERE id = ? AND document_type = 'ORDER'")
      .bind(orderDocumentId).first<{ id: string; created_at: number }>(),
    db.prepare("SELECT id, status, contract_number FROM sales_contracts WHERE order_document_id = ?")
      .bind(orderDocumentId).first<{ id: string; status: string; contract_number: string }>(),
  ]);
  if (!order) return { canProceed: false, required: true, reason: "연결된 수주 문서를 찾을 수 없습니다.", contract: null };
  if (contract) return { canProceed: contract.status === "ACTIVE", required: true,
    reason: contract.status === "ACTIVE" ? "" : `계약 ${contract.contract_number}의 승인·활성화가 필요합니다.`, contract };
  const required = order.created_at >= Number(settings?.enforcement_started_at ?? 0);
  return { canProceed: !required, required, reason: required ? "도입 이후 수주는 승인된 계약 원장이 있어야 납품·청구할 수 있습니다." : "", contract: null };
}
