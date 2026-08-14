CREATE TABLE `finance_cash_forecast_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`minimum_cash_balance` integer DEFAULT 0 NOT NULL,
	`include_fx` integer DEFAULT false NOT NULL,
	`default_scenario` text DEFAULT 'BASE' NOT NULL,
	`collection_probability` integer DEFAULT 85 NOT NULL,
	`updated_by` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `finance_cash_forecast_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`as_of` text NOT NULL,
	`scenario` text NOT NULL,
	`opening_cash` integer NOT NULL,
	`projected_ending_cash` integer NOT NULL,
	`lowest_cash` integer NOT NULL,
	`minimum_cash_balance` integer DEFAULT 0 NOT NULL,
	`low_week_count` integer DEFAULT 0 NOT NULL,
	`missing_date_count` integer DEFAULT 0 NOT NULL,
	`buckets_json` text DEFAULT '[]' NOT NULL,
	`source_counts_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_cash_forecast_snapshot_asof_scenario` ON `finance_cash_forecast_snapshots` (`as_of`,`scenario`);--> statement-breakpoint
CREATE INDEX `idx_finance_cash_forecast_snapshot_updated` ON `finance_cash_forecast_snapshots` (`updated_at`);