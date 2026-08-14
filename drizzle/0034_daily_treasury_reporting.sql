CREATE TABLE IF NOT EXISTS `finance_daily_treasury_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`report_date` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`source_as_of` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`analysis_text` text DEFAULT '' NOT NULL,
	`analysis_source` text DEFAULT 'RULE_BASED_FALLBACK' NOT NULL,
	`ai_status` text DEFAULT 'NOT_REQUESTED' NOT NULL,
	`ai_model` text DEFAULT '' NOT NULL,
	`management_note` text DEFAULT '' NOT NULL,
	`action_items_json` text DEFAULT '[]' NOT NULL,
	`generated_by` text NOT NULL,
	`reviewed_by` text DEFAULT '' NOT NULL,
	`reviewed_at` integer,
	`finalized_by` text DEFAULT '' NOT NULL,
	`finalized_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_finance_daily_treasury_report_date_version` ON `finance_daily_treasury_reports` (`report_date`,`version`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_finance_daily_treasury_report_date_status` ON `finance_daily_treasury_reports` (`report_date`,`status`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_finance_daily_treasury_report_source_asof` ON `finance_daily_treasury_reports` (`source_as_of`);
