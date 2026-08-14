CREATE TABLE `finance_bank_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text DEFAULT 'CLOBE' NOT NULL,
	`source_snapshot_date` text NOT NULL,
	`account_id` text NOT NULL,
	`bank_code` text DEFAULT '' NOT NULL,
	`bank_name` text DEFAULT '' NOT NULL,
	`account_name` text DEFAULT '' NOT NULL,
	`account_last4` text DEFAULT '' NOT NULL,
	`currency` text DEFAULT 'KRW' NOT NULL,
	`transaction_at` text NOT NULL,
	`transaction_date` text NOT NULL,
	`transaction_type` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`direction` text NOT NULL,
	`amount` integer NOT NULL,
	`after_balance` integer DEFAULT 0 NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`business_entity_name` text DEFAULT '' NOT NULL,
	`is_unclassified` integer DEFAULT false NOT NULL,
	`memo` text DEFAULT '' NOT NULL,
	`imported_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_finance_bank_transaction_date_direction` ON `finance_bank_transactions` (`transaction_date`,`direction`);--> statement-breakpoint
CREATE INDEX `idx_finance_bank_transaction_account_date` ON `finance_bank_transactions` (`account_id`,`transaction_date`);--> statement-breakpoint
CREATE INDEX `idx_finance_bank_transaction_unclassified` ON `finance_bank_transactions` (`is_unclassified`,`transaction_date`);--> statement-breakpoint
CREATE TABLE `finance_cash_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`match_group_id` text NOT NULL,
	`bank_transaction_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`matched_amount` integer NOT NULL,
	`match_score` integer DEFAULT 0 NOT NULL,
	`match_method` text DEFAULT 'MANUAL' NOT NULL,
	`status` text DEFAULT 'CONFIRMED' NOT NULL,
	`memo` text DEFAULT '' NOT NULL,
	`confirmed_by` text NOT NULL,
	`confirmed_at` integer NOT NULL,
	`reversed_by` text DEFAULT '' NOT NULL,
	`reversed_at` integer,
	`reversal_reason` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_cash_match_unique_source` ON `finance_cash_matches` (`bank_transaction_id`,`source_type`,`source_id`);--> statement-breakpoint
CREATE INDEX `idx_finance_cash_match_bank_status` ON `finance_cash_matches` (`bank_transaction_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_finance_cash_match_source_status` ON `finance_cash_matches` (`source_type`,`source_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_finance_cash_match_group` ON `finance_cash_matches` (`match_group_id`);