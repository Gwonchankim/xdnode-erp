CREATE TABLE `finance_journal_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_request_id` text NOT NULL,
	`voucher_date` text NOT NULL,
	`description` text NOT NULL,
	`debit_account_code` text DEFAULT '' NOT NULL,
	`debit_account_name` text NOT NULL,
	`credit_account_code` text DEFAULT '' NOT NULL,
	`credit_account_name` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`prepared_by` text NOT NULL,
	`posted_by` text DEFAULT '' NOT NULL,
	`posted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_journal_payment_unique` ON `finance_journal_entries` (`payment_request_id`);--> statement-breakpoint
CREATE INDEX `idx_finance_journal_status_date` ON `finance_journal_entries` (`status`,`voucher_date`);--> statement-breakpoint
CREATE TABLE `hr_retirement_settlements` (
	`request_id` text PRIMARY KEY NOT NULL,
	`final_salary` integer DEFAULT 0 NOT NULL,
	`retirement_pay` integer DEFAULT 0 NOT NULL,
	`unused_leave_pay` integer DEFAULT 0 NOT NULL,
	`deductions` integer DEFAULT 0 NOT NULL,
	`net_settlement` integer DEFAULT 0 NOT NULL,
	`payroll_confirmed` integer DEFAULT false NOT NULL,
	`insurance_confirmed` integer DEFAULT false NOT NULL,
	`access_revoked` integer DEFAULT false NOT NULL,
	`assets_returned` integer DEFAULT false NOT NULL,
	`handover_confirmed` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`prepared_by` text DEFAULT '' NOT NULL,
	`completed_by` text DEFAULT '' NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `hr_offer_requests` ADD `employee_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `hr_offer_requests` ADD `response_note` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `hr_offer_requests` ADD `responded_by` text DEFAULT '' NOT NULL;