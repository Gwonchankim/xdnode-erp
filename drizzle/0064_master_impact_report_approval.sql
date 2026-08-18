ALTER TABLE `erp_master_impact_weekly_reports` ADD `status` text DEFAULT 'DRAFT' NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_master_impact_weekly_reports` ADD `approval_request_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_master_impact_weekly_reports` ADD `workflow_version` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_master_impact_weekly_reports` ADD `submitted_by` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_master_impact_weekly_reports` ADD `submitted_at` integer;--> statement-breakpoint
ALTER TABLE `erp_master_impact_weekly_reports` ADD `approved_by` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_master_impact_weekly_reports` ADD `approved_at` integer;--> statement-breakpoint
CREATE TRIGGER `trg_erp_master_impact_weekly_report_immutable`
BEFORE UPDATE OF `snapshot_json`, `checksum` ON `erp_master_impact_weekly_reports`
BEGIN
	SELECT RAISE(ABORT, 'master impact weekly report snapshot is immutable');
END;--> statement-breakpoint
CREATE TABLE `erp_master_impact_weekly_report_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`manager_name` text NOT NULL,
	`manager_employee_id` text DEFAULT '' NOT NULL,
	`outcome` text DEFAULT 'PENDING' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`reviewed_by` text DEFAULT '' NOT NULL,
	`reviewed_at` integer,
	`follow_up_owner_employee_id` text DEFAULT '' NOT NULL,
	`follow_up_due_date` text DEFAULT '' NOT NULL,
	`follow_up_task_id` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_erp_master_impact_weekly_review_manager` ON `erp_master_impact_weekly_report_reviews` (`report_id`,`manager_name`);--> statement-breakpoint
CREATE INDEX `idx_erp_master_impact_weekly_review_outcome` ON `erp_master_impact_weekly_report_reviews` (`report_id`,`outcome`);--> statement-breakpoint
CREATE TABLE `erp_master_impact_weekly_report_events` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_employee_id` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`snapshot_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `idx_erp_master_impact_weekly_report_event_created` ON `erp_master_impact_weekly_report_events` (`report_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_erp_approval_master_impact_report` ON `erp_approval_requests` (`target_entity_type`,`target_entity_id`) WHERE `target_entity_type` = 'MASTER_IMPACT_WEEKLY_REPORT';
--> statement-breakpoint
PRAGMA optimize;
