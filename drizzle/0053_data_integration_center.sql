CREATE TABLE `erp_integration_sources` (`id` text PRIMARY KEY NOT NULL,`source_code` text NOT NULL UNIQUE,`name` text NOT NULL,`category` text NOT NULL,`system_type` text NOT NULL,`connection_mode` text NOT NULL,`scope` text NOT NULL,`expected_cadence` text DEFAULT 'ON_DEMAND' NOT NULL,`expected_hour_kst` integer DEFAULT 0 NOT NULL,`freshness_hours` integer DEFAULT 0 NOT NULL,`criticality` text DEFAULT 'NORMAL' NOT NULL,`owner_employee_id` text DEFAULT '' NOT NULL,`enabled` integer DEFAULT 1 NOT NULL,`description` text DEFAULT '' NOT NULL,`created_at` integer NOT NULL,`updated_at` integer NOT NULL);--> statement-breakpoint
CREATE INDEX `idx_erp_integration_source_enabled_category` ON `erp_integration_sources` (`enabled`,`category`);--> statement-breakpoint
CREATE TABLE `erp_integration_exceptions` (`id` text PRIMARY KEY NOT NULL,`run_id` text NOT NULL,`source_id` text NOT NULL,`exception_key` text NOT NULL,`exception_type` text NOT NULL,`severity` text NOT NULL,`title` text NOT NULL,`detail` text DEFAULT '' NOT NULL,`source_ref` text DEFAULT '' NOT NULL,`target_ref` text DEFAULT '' NOT NULL,`source_amount` integer DEFAULT 0 NOT NULL,`target_amount` integer DEFAULT 0 NOT NULL,`difference_amount` integer DEFAULT 0 NOT NULL,`status` text DEFAULT 'OPEN' NOT NULL,`suggested_action` text DEFAULT '' NOT NULL,`owner_employee_id` text DEFAULT '' NOT NULL,`resolution_note` text DEFAULT '' NOT NULL,`resolved_by` text DEFAULT '' NOT NULL,`resolved_at` integer,`created_at` integer NOT NULL,`updated_at` integer NOT NULL);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_erp_integration_exception_run_key` ON `erp_integration_exceptions` (`run_id`,`exception_key`);--> statement-breakpoint
CREATE INDEX `idx_erp_integration_exception_status_severity` ON `erp_integration_exceptions` (`status`,`severity`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_erp_integration_exception_source` ON `erp_integration_exceptions` (`source_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `erp_sync_run_events` (`id` text PRIMARY KEY NOT NULL,`run_id` text NOT NULL,`action` text NOT NULL,`from_status` text DEFAULT '' NOT NULL,`to_status` text DEFAULT '' NOT NULL,`actor_employee_id` text NOT NULL,`note` text DEFAULT '' NOT NULL,`snapshot_json` text DEFAULT '{}' NOT NULL,`created_at` integer NOT NULL);--> statement-breakpoint
CREATE INDEX `idx_erp_sync_run_event_run_created` ON `erp_sync_run_events` (`run_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `erp_sync_runs` ADD `source_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_sync_runs` ADD `run_type` text DEFAULT 'SNAPSHOT' NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_sync_runs` ADD `trigger_type` text DEFAULT 'SYSTEM' NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_sync_runs` ADD `idempotency_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_sync_runs` ADD `source_checksum` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_sync_runs` ADD `received_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_sync_runs` ADD `inserted_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_sync_runs` ADD `updated_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_sync_runs` ADD `duplicate_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_sync_runs` ADD `rejected_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_sync_runs` ADD `review_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_sync_runs` ADD `requested_by` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_sync_runs` ADD `retry_of_run_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_sync_runs` ADD `report_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_sync_runs` ADD `correlation_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_sync_runs` ADD `review_status` text DEFAULT 'NOT_REQUIRED' NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_sync_runs` ADD `reviewed_by` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_sync_runs` ADD `reviewed_at` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `idx_erp_sync_idempotency` ON `erp_sync_runs` (`source_id`,`run_type`,`idempotency_key`) WHERE `idempotency_key` <> '';--> statement-breakpoint
CREATE INDEX `idx_erp_sync_source_status_snapshot` ON `erp_sync_runs` (`source_id`,`status`,`snapshot_date`);--> statement-breakpoint
CREATE INDEX `idx_erp_sync_retry` ON `erp_sync_runs` (`retry_of_run_id`,`created_at`);--> statement-breakpoint
PRAGMA optimize;
