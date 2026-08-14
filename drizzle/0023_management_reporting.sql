CREATE TABLE `finance_management_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`period` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`as_of` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`auto_analysis_json` text DEFAULT '{}' NOT NULL,
	`highlights` text DEFAULT '' NOT NULL,
	`risks` text DEFAULT '' NOT NULL,
	`decisions` text DEFAULT '' NOT NULL,
	`quality_acknowledged` integer DEFAULT false NOT NULL,
	`revision_reason` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`submitted_at` integer,
	`approved_by` text DEFAULT '' NOT NULL,
	`approved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_management_report_period_version` ON `finance_management_reports` (`period`,`version`);--> statement-breakpoint
CREATE INDEX `idx_finance_management_report_period_status` ON `finance_management_reports` (`period`,`status`);--> statement-breakpoint
CREATE TABLE `finance_management_report_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`report_id` text NOT NULL,
	`source_section` text DEFAULT 'GENERAL' NOT NULL,
	`title` text NOT NULL,
	`owner_employee_id` text NOT NULL,
	`due_date` text NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`memo` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_finance_management_report_action_status_due` ON `finance_management_report_actions` (`report_id`,`status`,`due_date`);
