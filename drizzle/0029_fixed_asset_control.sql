CREATE TABLE `finance_fixed_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_code` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`acquisition_date` text NOT NULL,
	`in_service_date` text NOT NULL,
	`acquisition_cost` integer NOT NULL,
	`residual_value` integer DEFAULT 0 NOT NULL,
	`useful_life_months` integer NOT NULL,
	`depreciation_method` text DEFAULT 'STRAIGHT_LINE' NOT NULL,
	`opening_accumulated` integer DEFAULT 0 NOT NULL,
	`opening_as_of` text DEFAULT '' NOT NULL,
	`asset_account_code` text NOT NULL,
	`accumulated_account_code` text NOT NULL,
	`expense_account_code` text NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`custodian_employee_id` text DEFAULT '' NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`source_reference` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`disposal_date` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_fixed_asset_code` ON `finance_fixed_assets` (`asset_code`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_fixed_asset_source` ON `finance_fixed_assets` (`source_type`,`source_id`);
--> statement-breakpoint
CREATE INDEX `idx_finance_fixed_asset_status_service` ON `finance_fixed_assets` (`status`,`in_service_date`);
--> statement-breakpoint
CREATE TABLE `finance_asset_depreciation_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`period` text NOT NULL,
	`opening_accumulated` integer DEFAULT 0 NOT NULL,
	`depreciation_amount` integer NOT NULL,
	`closing_accumulated` integer NOT NULL,
	`closing_book_value` integer NOT NULL,
	`status` text DEFAULT 'PLANNED' NOT NULL,
	`journal_entry_id` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`posted_by` text DEFAULT '' NOT NULL,
	`posted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_asset_depreciation_period` ON `finance_asset_depreciation_schedules` (`asset_id`,`period`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_asset_depreciation_journal` ON `finance_asset_depreciation_schedules` (`journal_entry_id`) WHERE `journal_entry_id` <> '';
--> statement-breakpoint
CREATE INDEX `idx_finance_asset_depreciation_status_period` ON `finance_asset_depreciation_schedules` (`status`,`period`);
--> statement-breakpoint
CREATE TABLE `finance_asset_events` (
	`id` text PRIMARY KEY NOT NULL,
	`asset_id` text NOT NULL,
	`event_type` text NOT NULL,
	`event_date` text NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`custodian_employee_id` text DEFAULT '' NOT NULL,
	`journal_reference` text DEFAULT '' NOT NULL,
	`reason` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_finance_asset_event_asset_date` ON `finance_asset_events` (`asset_id`,`event_date`);
