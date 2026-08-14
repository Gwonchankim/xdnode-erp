CREATE TABLE `finance_budget_plan_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`month` integer NOT NULL,
	`department` text NOT NULL,
	`account_code` text DEFAULT '' NOT NULL,
	`account_name` text NOT NULL,
	`direction` text NOT NULL,
	`actual_source` text NOT NULL,
	`amount` integer NOT NULL,
	`threshold_pct` integer DEFAULT 10 NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_budget_line_unique_mapping` ON `finance_budget_plan_lines` (`plan_id`,`month`,`department`,`actual_source`,`account_code`,`account_name`);--> statement-breakpoint
CREATE INDEX `idx_finance_budget_line_plan_month` ON `finance_budget_plan_lines` (`plan_id`,`month`);--> statement-breakpoint
CREATE TABLE `finance_budget_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`fiscal_year` integer NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`revision_reason` text DEFAULT '' NOT NULL,
	`owner_employee_id` text NOT NULL,
	`submitted_at` integer,
	`approved_by` text DEFAULT '' NOT NULL,
	`approved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_budget_plan_year_version` ON `finance_budget_plans` (`fiscal_year`,`version`);--> statement-breakpoint
CREATE INDEX `idx_finance_budget_plan_year_status` ON `finance_budget_plans` (`fiscal_year`,`status`);--> statement-breakpoint
CREATE TABLE `finance_budget_variance_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`line_id` text NOT NULL,
	`period` text NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`cause` text DEFAULT '' NOT NULL,
	`action_plan` text DEFAULT '' NOT NULL,
	`owner_employee_id` text DEFAULT '' NOT NULL,
	`due_date` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_budget_variance_line_unique` ON `finance_budget_variance_actions` (`line_id`);--> statement-breakpoint
CREATE INDEX `idx_finance_budget_variance_plan_status_due` ON `finance_budget_variance_actions` (`plan_id`,`status`,`due_date`);