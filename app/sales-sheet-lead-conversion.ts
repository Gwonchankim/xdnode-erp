// Manual, one-way conversion of an "인바운드 영업" sheet lead into a real sales_opportunities record.
// No automatic promotion — a person clicks a button per lead. Requires an already-registered,
// active sales_accounts row matching the lead's company name exactly; this route does not create
// accounts itself, since sales_accounts creation also seeds finance master-partner records
// (see app/api/sales/route.ts) and silently duplicating that from here would be easy to get wrong.

type Principal = { employeeId: string };

export async function ensureLeadConversionSchema(db: D1Database) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS sales_sheet_lead_conversions (
    lead_id TEXT PRIMARY KEY NOT NULL, opportunity_id TEXT NOT NULL, account_id TEXT NOT NULL,
    converted_by TEXT NOT NULL, converted_at INTEGER NOT NULL
  )`).run();
}

export async function getLeadConversions(db: D1Database, leadIds: string[]) {
  if (!leadIds.length) return new Map<string, { opportunity_id: string; account_id: string }>();
  const placeholders = leadIds.map(() => "?").join(",");
  const result = await db.prepare(`SELECT * FROM sales_sheet_lead_conversions WHERE lead_id IN (${placeholders})`)
    .bind(...leadIds).all<{ lead_id: string; opportunity_id: string; account_id: string }>();
  return new Map(result.results.map((row) => [row.lead_id, row]));
}

export async function convertLeadToOpportunity(db: D1Database, leadId: string, principal: Principal) {
  const existing = await db.prepare(`SELECT * FROM sales_sheet_lead_conversions WHERE lead_id=?`).bind(leadId).first<{ opportunity_id: string }>();
  if (existing) return { opportunityId: existing.opportunity_id, alreadyConverted: true };

  const lead = await db.prepare(`SELECT * FROM sales_sheet_inbound_leads WHERE id=?`).bind(leadId).first<Record<string, unknown>>();
  if (!lead) throw new Error("해당 리드를 찾을 수 없습니다.");
  const companyName = String(lead.company ?? "").trim();
  if (!companyName) throw new Error("회사명이 없는 리드는 전환할 수 없습니다.");

  const account = await db.prepare(`SELECT id, name FROM sales_accounts WHERE TRIM(name)=? AND status='ACTIVE' AND deleted_at IS NULL LIMIT 1`)
    .bind(companyName).first<{ id: string; name: string }>();
  if (!account) {
    const error = new Error(`먼저 '${companyName}' 거래처를 영업 운영 화면에서 등록해 주세요.`);
    (error as Error & { code?: string }).code = "ACCOUNT_NOT_FOUND";
    throw error;
  }

  const opportunityId = crypto.randomUUID();
  const now = Date.now();
  const title = String(lead.product ?? "").trim() || `${companyName} 인바운드 문의`;
  const expectedRevenue = Math.round(Number(lead.contract_amount ?? 0) || Number(lead.quote_amount ?? 0) || Number(lead.quoted_amount_incl ?? 0) || 0);

  await db.batch([
    db.prepare(`INSERT INTO sales_opportunities
      (id, account_id, title, owner_employee_id, stage, lead_type, expected_revenue, expected_cost, probability,
        expected_close_date, next_action, next_action_date, status, created_at, updated_at, deleted_at)
      VALUES (?, ?, ?, ?, 'LEAD', 'INBOUND', ?, 0, 10, '', '', '', 'OPEN', ?, ?, NULL)`)
      .bind(opportunityId, account.id, title, principal.employeeId, expectedRevenue, now, now),
    db.prepare(`INSERT INTO sales_opportunity_stage_history
      (id, opportunity_id, from_stage, to_stage, reason, changed_by, changed_at)
      VALUES (?, ?, '', 'LEAD', '구글 시트 인바운드 리드 전환', ?, ?)`)
      .bind(crypto.randomUUID(), opportunityId, principal.employeeId, now),
    db.prepare(`INSERT INTO sales_sheet_lead_conversions (lead_id, opportunity_id, account_id, converted_by, converted_at)
      VALUES (?, ?, ?, ?, ?)`)
      .bind(leadId, opportunityId, account.id, principal.employeeId, now),
  ]);

  return { opportunityId, accountId: account.id, alreadyConverted: false };
}
