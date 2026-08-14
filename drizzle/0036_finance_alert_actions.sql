CREATE TABLE `finance_alert_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`task_source_id` text NOT NULL,
	`source_destination` text DEFAULT '' NOT NULL,
	`title_snapshot` text NOT NULL,
	`description_snapshot` text DEFAULT '' NOT NULL,
	`priority_snapshot` text DEFAULT 'NORMAL' NOT NULL,
	`owner_employee_id` text DEFAULT '' NOT NULL,
	`due_date` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`root_cause` text DEFAULT '' NOT NULL,
	`impact_assessment` text DEFAULT '' NOT NULL,
	`action_plan` text DEFAULT '' NOT NULL,
	`resolution_summary` text DEFAULT '' NOT NULL,
	`submitted_by` text DEFAULT '' NOT NULL,
	`submitted_at` integer,
	`reviewed_by` text DEFAULT '' NOT NULL,
	`reviewed_at` integer,
	`review_comment` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`closed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_alert_case_task_source` ON `finance_alert_cases` (`task_id`,`task_source_id`);
--> statement-breakpoint
CREATE INDEX `idx_finance_alert_case_status_due` ON `finance_alert_cases` (`status`,`due_date`);
--> statement-breakpoint
CREATE INDEX `idx_finance_alert_case_owner_status` ON `finance_alert_cases` (`owner_employee_id`,`status`);
--> statement-breakpoint
CREATE TABLE `finance_alert_case_events` (
	`id` text PRIMARY KEY NOT NULL,
	`case_id` text NOT NULL,
	`action` text NOT NULL,
	`actor_employee_id` text NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`snapshot_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_finance_alert_case_event_case_created` ON `finance_alert_case_events` (`case_id`,`created_at`);
