CREATE INDEX IF NOT EXISTS `idx_erp_audit_created_id`
  ON `erp_audit_logs` (`created_at`, `id`);
