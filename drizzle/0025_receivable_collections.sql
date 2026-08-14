CREATE TABLE `finance_receivable_cases` (
	`invoice_id` text PRIMARY KEY NOT NULL,
	`collection_status` text DEFAULT 'OPEN' NOT NULL,
	`owner_employee_id` text DEFAULT '' NOT NULL,
	`promised_date` text DEFAULT '' NOT NULL,
	`promised_amount` integer DEFAULT 0 NOT NULL,
	`dispute_reason` text DEFAULT '' NOT NULL,
	`next_action` text DEFAULT '' NOT NULL,
	`next_action_date` text DEFAULT '' NOT NULL,
	`memo` text DEFAULT '' NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_finance_receivable_case_status_promise` ON `finance_receivable_cases` (`collection_status`,`promised_date`);
--> statement-breakpoint
CREATE INDEX `idx_finance_receivable_case_owner_action` ON `finance_receivable_cases` (`owner_employee_id`,`next_action_date`);
--> statement-breakpoint
CREATE TABLE `finance_receivable_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`note_type` text DEFAULT 'GENERAL' NOT NULL,
	`content` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_finance_receivable_note_invoice_created` ON `finance_receivable_notes` (`invoice_id`,`created_at`);
