UPDATE hr_organization_leaders
SET leader_employee_id = NULL, updated_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE leader_employee_id IN (
  SELECT employee_id FROM hr_employee_records
  WHERE status = '퇴직'
    OR json_extract(CASE WHEN json_valid(retirement_json) THEN retirement_json ELSE '{}' END, '$.status') IN ('EFFECTIVE', 'COMPLETED')
);--> statement-breakpoint
