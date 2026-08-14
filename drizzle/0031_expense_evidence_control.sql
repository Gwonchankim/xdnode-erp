CREATE TABLE `finance_corporate_cards` (
	`id` text PRIMARY KEY NOT NULL,
	`issuer` text NOT NULL,
	`nickname` text NOT NULL,
	`last4` text NOT NULL,
	`holder_employee_id` text DEFAULT '' NOT NULL,
	`monthly_limit` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_corporate_card_issuer_last4` ON `finance_corporate_cards` (`issuer`,`last4`);
--> statement-breakpoint
CREATE INDEX `idx_finance_corporate_card_status_holder` ON `finance_corporate_cards` (`status`,`holder_employee_id`);
--> statement-breakpoint
CREATE TABLE `finance_card_transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`card_id` text NOT NULL,
	`external_reference` text NOT NULL,
	`transaction_date` text NOT NULL,
	`merchant` text NOT NULL,
	`amount` integer NOT NULL,
	`currency` text DEFAULT 'KRW' NOT NULL,
	`direction` text DEFAULT 'CHARGE' NOT NULL,
	`status` text DEFAULT 'UNMATCHED' NOT NULL,
	`expense_request_id` text DEFAULT '' NOT NULL,
	`exclusion_reason` text DEFAULT '' NOT NULL,
	`source_file_name` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_card_transaction_reference` ON `finance_card_transactions` (`card_id`,`external_reference`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_card_transaction_expense` ON `finance_card_transactions` (`expense_request_id`) WHERE `expense_request_id` <> '';
--> statement-breakpoint
CREATE INDEX `idx_finance_card_transaction_status_date` ON `finance_card_transactions` (`status`,`transaction_date`);
--> statement-breakpoint
CREATE TABLE `finance_expense_controls` (
	`expense_request_id` text PRIMARY KEY NOT NULL,
	`business_purpose` text DEFAULT '' NOT NULL,
	`evidence_status` text DEFAULT 'PENDING' NOT NULL,
	`evidence_document_id` text DEFAULT '' NOT NULL,
	`card_transaction_id` text DEFAULT '' NOT NULL,
	`tax_treatment` text DEFAULT 'UNREVIEWED' NOT NULL,
	`review_note` text DEFAULT '' NOT NULL,
	`reviewed_by` text DEFAULT '' NOT NULL,
	`reviewed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_expense_control_card` ON `finance_expense_controls` (`card_transaction_id`) WHERE `card_transaction_id` <> '';
--> statement-breakpoint
CREATE INDEX `idx_finance_expense_control_evidence_status` ON `finance_expense_controls` (`evidence_status`,`updated_at`);
