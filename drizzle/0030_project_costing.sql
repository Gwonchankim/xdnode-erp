CREATE TABLE `finance_cost_centers` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`center_type` text NOT NULL,
	`owner_employee_id` text DEFAULT '' NOT NULL,
	`opportunity_id` text DEFAULT '' NOT NULL,
	`client_name` text DEFAULT '' NOT NULL,
	`start_date` text DEFAULT '' NOT NULL,
	`end_date` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_cost_center_code` ON `finance_cost_centers` (`code`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_cost_center_opportunity` ON `finance_cost_centers` (`opportunity_id`) WHERE `opportunity_id` <> '';
--> statement-breakpoint
CREATE INDEX `idx_finance_cost_center_status_type` ON `finance_cost_centers` (`status`,`center_type`);
--> statement-breakpoint
CREATE TABLE `finance_project_monthly_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`cost_center_id` text NOT NULL,
	`period` text NOT NULL,
	`revenue_budget` integer DEFAULT 0 NOT NULL,
	`cost_budget` integer DEFAULT 0 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`approved_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_project_budget_period` ON `finance_project_monthly_budgets` (`cost_center_id`,`period`);
--> statement-breakpoint
CREATE INDEX `idx_finance_project_budget_period_center` ON `finance_project_monthly_budgets` (`period`,`cost_center_id`);
--> statement-breakpoint
CREATE TABLE `finance_project_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`cost_center_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`period` text NOT NULL,
	`direction` text NOT NULL,
	`source_amount` integer NOT NULL,
	`amount` integer NOT NULL,
	`allocation_basis` text DEFAULT 'MANUAL_AMOUNT' NOT NULL,
	`note` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_project_allocation_source_center` ON `finance_project_allocations` (`source_type`,`source_id`,`cost_center_id`);
--> statement-breakpoint
CREATE INDEX `idx_finance_project_allocation_period_center` ON `finance_project_allocations` (`period`,`cost_center_id`);
--> statement-breakpoint
CREATE INDEX `idx_finance_project_allocation_source` ON `finance_project_allocations` (`source_type`,`source_id`);
