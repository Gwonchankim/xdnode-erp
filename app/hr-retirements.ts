type DueRetirement = {
  id: string;
  employee_id: string;
  retirement_date: string;
  reason: string;
};

export async function applyDueRetirements(db: D1Database, now = Date.now()) {
  const table = await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'hr_retirement_requests'")
    .first<{ name: string }>();
  if (!table) return 0;
  const koreaDate = new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const due = await db.prepare(`SELECT id, employee_id, retirement_date, reason FROM hr_retirement_requests
    WHERE status = 'READY' AND retirement_date <= ?
      AND EXISTS (SELECT 1 FROM hr_retirement_settlements settlement
        WHERE settlement.request_id = hr_retirement_requests.id AND settlement.status = 'READY')
    ORDER BY retirement_date, created_at`)
    .bind(koreaDate).all<DueRetirement>();
  let applied = 0;
  for (const retirement of due.results) {
    const result = await db.batch([
      db.prepare(`UPDATE hr_retirement_requests SET status = 'COMPLETED', completed_at = ?, updated_at = ?
        WHERE id = ? AND status = 'READY' AND retirement_date <= ?`)
        .bind(now, now, retirement.id, koreaDate),
      db.prepare(`UPDATE hr_employee_records SET status = '퇴직',
        retirement_json = json_set(CASE WHEN json_valid(retirement_json) THEN retirement_json ELSE '{}' END,
          '$.status', 'COMPLETED'),
        history_json = json_insert(CASE WHEN json_valid(history_json) THEN history_json ELSE '[]' END, '$[#]',
          json(json_object('date', replace(?, '-', '.'), 'type', '퇴직', 'detail', ?))), updated_at = ?
        WHERE employee_id = ?
          AND EXISTS (SELECT 1 FROM hr_retirement_requests WHERE id = ? AND status = 'COMPLETED' AND updated_at = ?)
          AND NOT EXISTS (SELECT 1 FROM erp_audit_logs WHERE action = 'RETIREMENT_EFFECTIVE' AND entity_id = ?)`)
        .bind(retirement.retirement_date, retirement.reason, now, retirement.employee_id, retirement.id, now, retirement.id),
      db.prepare(`UPDATE hr_retirement_settlements SET status = 'COMPLETED', completed_by = 'SYSTEM',
        completed_at = ?, updated_at = ? WHERE request_id = ? AND status = 'READY'
          AND EXISTS (SELECT 1 FROM hr_retirement_requests WHERE id = ? AND status = 'COMPLETED' AND updated_at = ?)`)
        .bind(now, now, retirement.id, retirement.id, now),
      db.prepare(`INSERT INTO erp_audit_logs
        (id, actor_user_id, actor_email, actor_employee_id, module, action, entity_type, entity_id,
          before_json, after_json, reason, created_at)
        SELECT ?, 'SYSTEM', 'system@xdnode.local', 'SYSTEM', 'hr', 'RETIREMENT_EFFECTIVE',
          'employeeRetirement', ?, '{}', ?, ?, ?
        WHERE EXISTS (SELECT 1 FROM hr_retirement_requests WHERE id = ? AND status = 'COMPLETED' AND updated_at = ?)
          AND NOT EXISTS (SELECT 1 FROM erp_audit_logs WHERE action = 'RETIREMENT_EFFECTIVE' AND entity_id = ?)`)
        .bind(crypto.randomUUID(), retirement.id, JSON.stringify({ employeeId: retirement.employee_id, retirementDate: retirement.retirement_date, status: "COMPLETED" }),
          retirement.reason, now, retirement.id, now, retirement.id),
    ]);
    if ((result[0].meta.changes ?? 0) > 0) applied += 1;
  }
  return applied;
}
