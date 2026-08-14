CREATE TABLE IF NOT EXISTS `erp_data_control_runs` (
  `id` text PRIMARY KEY NOT NULL, `status` text NOT NULL DEFAULT 'RUNNING',
  `requested_by` text NOT NULL, `check_count` integer NOT NULL DEFAULT 0,
  `failed_count` integer NOT NULL DEFAULT 0, `warning_count` integer NOT NULL DEFAULT 0,
  `summary_json` text NOT NULL DEFAULT '{}', `started_at` integer NOT NULL,
  `completed_at` integer, `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_erp_data_control_run_created` ON `erp_data_control_runs` (`created_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `erp_data_control_checks` (
  `id` text PRIMARY KEY NOT NULL, `run_id` text NOT NULL, `check_code` text NOT NULL,
  `category` text NOT NULL, `status` text NOT NULL, `title` text NOT NULL,
  `detail` text NOT NULL DEFAULT '', `evidence_json` text NOT NULL DEFAULT '{}',
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_erp_data_control_check_run_code` ON `erp_data_control_checks` (`run_id`,`check_code`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_erp_data_control_check_status` ON `erp_data_control_checks` (`status`,`created_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `erp_logical_snapshots` (
  `id` text PRIMARY KEY NOT NULL, `scope` text NOT NULL, `status` text NOT NULL DEFAULT 'CREATING',
  `object_key` text NOT NULL DEFAULT '', `file_name` text NOT NULL DEFAULT '',
  `content_type` text NOT NULL DEFAULT 'application/json', `sha256` text NOT NULL DEFAULT '',
  `byte_size` integer NOT NULL DEFAULT 0, `table_count` integer NOT NULL DEFAULT 0,
  `row_count` integer NOT NULL DEFAULT 0, `manifest_json` text NOT NULL DEFAULT '{}',
  `requested_by` text NOT NULL, `created_at` integer NOT NULL, `verified_at` integer,
  `verified_by` text NOT NULL DEFAULT '', `verification_status` text NOT NULL DEFAULT 'PENDING',
  `verification_detail` text NOT NULL DEFAULT '', `failure_message` text NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_erp_logical_snapshot_created` ON `erp_logical_snapshots` (`created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_erp_logical_snapshot_status` ON `erp_logical_snapshots` (`status`,`verification_status`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `erp_recovery_rehearsals` (
  `id` text PRIMARY KEY NOT NULL, `snapshot_id` text NOT NULL, `status` text NOT NULL,
  `check_count` integer NOT NULL DEFAULT 0, `failure_count` integer NOT NULL DEFAULT 0,
  `detail_json` text NOT NULL DEFAULT '{}', `performed_by` text NOT NULL,
  `performed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_erp_recovery_rehearsal_snapshot` ON `erp_recovery_rehearsals` (`snapshot_id`,`performed_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `erp_audit_exports` (
  `id` text PRIMARY KEY NOT NULL, `date_from` text NOT NULL, `date_to` text NOT NULL,
  `module` text NOT NULL DEFAULT 'ALL', `status` text NOT NULL DEFAULT 'CREATING',
  `object_key` text NOT NULL DEFAULT '', `file_name` text NOT NULL DEFAULT '',
  `sha256` text NOT NULL DEFAULT '', `byte_size` integer NOT NULL DEFAULT 0,
  `row_count` integer NOT NULL DEFAULT 0, `requested_by` text NOT NULL,
  `created_at` integer NOT NULL, `failure_message` text NOT NULL DEFAULT ''
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_erp_audit_export_created` ON `erp_audit_exports` (`created_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `erp_retention_policies` (
  `id` text PRIMARY KEY NOT NULL, `data_type` text NOT NULL UNIQUE, `label` text NOT NULL,
  `retention_days` integer NOT NULL, `disposition` text NOT NULL DEFAULT 'REVIEW_REQUIRED',
  `active` integer NOT NULL DEFAULT 0, `updated_by` text NOT NULL DEFAULT '',
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
PRAGMA optimize;
