CREATE TABLE `finance_close_runs` (
	`period` text PRIMARY KEY NOT NULL,
	`period_end` text NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`control_pass_count` integer DEFAULT 0 NOT NULL,
	`control_fail_count` integer DEFAULT 0 NOT NULL,
	`manual_completed_count` integer DEFAULT 0 NOT NULL,
	`manual_total_count` integer DEFAULT 0 NOT NULL,
	`evidence_count` integer DEFAULT 0 NOT NULL,
	`snapshot_json` text DEFAULT '{}' NOT NULL,
	`submitted_by` text DEFAULT '' NOT NULL,
	`submitted_at` integer,
	`closed_by` text DEFAULT '' NOT NULL,
	`closed_at` integer,
	`reopened_by` text DEFAULT '' NOT NULL,
	`reopened_at` integer,
	`reopened_reason` text DEFAULT '' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_finance_close_run_status_period` ON `finance_close_runs` (`status`,`period`);