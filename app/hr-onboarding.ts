type DueOnboarding = {
  employee_id: string;
  join_date: string;
};

export async function applyDueOnboarding(db: D1Database, now = Date.now()) {
  const tables = await db.prepare(`SELECT COUNT(*) AS count FROM sqlite_master
    WHERE type = 'table' AND name IN ('hr_employee_records', 'hr_lifecycle_tasks')`)
    .first<{ count: number }>();
  if ((tables?.count ?? 0) < 2) return 0;
  const koreaDate = new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const due = await db.prepare(`SELECT employee.employee_id, employee.join_date
    FROM hr_employee_records employee
    WHERE employee.status = '입사 예정' AND replace(employee.join_date, '.', '-') <= ?
      AND EXISTS (SELECT 1 FROM hr_lifecycle_tasks task
        WHERE task.employee_id = employee.employee_id AND task.lifecycle_type = 'ONBOARDING')
      AND NOT EXISTS (SELECT 1 FROM hr_lifecycle_tasks task
        WHERE task.employee_id = employee.employee_id AND task.lifecycle_type = 'ONBOARDING' AND task.status <> 'DONE')
    ORDER BY replace(employee.join_date, '.', '-'), employee.employee_id`)
    .bind(koreaDate).all<DueOnboarding>();
  let applied = 0;
  for (const employee of due.results) {
    const result = await db.batch([
      db.prepare(`UPDATE hr_employee_records SET status = '재직',
        history_json = json_insert(CASE WHEN json_valid(history_json) THEN history_json ELSE '[]' END, '$[#]',
          json(json_object('date', join_date, 'type', '입사', 'detail', '온보딩 필수 업무 완료 · 재직 전환'))),
        updated_at = ? WHERE employee_id = ? AND status = '입사 예정'
          AND replace(join_date, '.', '-') <= ?
          AND NOT EXISTS (SELECT 1 FROM erp_audit_logs WHERE action = 'ONBOARDING_EFFECTIVE' AND entity_id = ?)`)
        .bind(now, employee.employee_id, koreaDate, employee.employee_id),
      db.prepare(`INSERT INTO erp_audit_logs
        (id, actor_user_id, actor_email, actor_employee_id, module, action, entity_type, entity_id,
          before_json, after_json, reason, created_at)
        SELECT ?, 'SYSTEM', 'system@xdnode.local', 'SYSTEM', 'hr', 'ONBOARDING_EFFECTIVE',
          'employeeRecord', ?, ?, ?, '입사일 도래 및 온보딩 필수 업무 완료', ?
        WHERE EXISTS (SELECT 1 FROM hr_employee_records WHERE employee_id = ? AND status = '재직' AND updated_at = ?)
          AND NOT EXISTS (SELECT 1 FROM erp_audit_logs WHERE action = 'ONBOARDING_EFFECTIVE' AND entity_id = ?)`)
        .bind(crypto.randomUUID(), employee.employee_id, JSON.stringify({ status: "입사 예정" }),
          JSON.stringify({ status: "재직", joinDate: employee.join_date }), now, employee.employee_id, now, employee.employee_id),
    ]);
    if ((result[0].meta.changes ?? 0) > 0) applied += 1;
  }
  return applied;
}
