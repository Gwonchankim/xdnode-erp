CREATE TABLE `finance_expense_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`request_kind` text DEFAULT 'EXPENSE' NOT NULL,
	`title` text NOT NULL,
	`vendor` text DEFAULT '' NOT NULL,
	`amount` integer NOT NULL,
	`requested_date` text NOT NULL,
	`due_date` text DEFAULT '' NOT NULL,
	`account_code` text DEFAULT '' NOT NULL,
	`account_name` text DEFAULT '' NOT NULL,
	`payment_method` text DEFAULT 'BANK_TRANSFER' NOT NULL,
	`memo` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`requester_employee_id` text NOT NULL,
	`approved_by` text DEFAULT '' NOT NULL,
	`approved_at` integer,
	`paid_by` text DEFAULT '' NOT NULL,
	`paid_at` integer,
	`journal_status` text DEFAULT 'UNPOSTED' NOT NULL,
	`evidence_required` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_finance_expense_status_due` ON `finance_expense_requests` (`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `idx_finance_expense_requester_created` ON `finance_expense_requests` (`requester_employee_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `finance_payment_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`payment_date` text NOT NULL,
	`amount` integer NOT NULL,
	`payment_method` text NOT NULL,
	`bank_reference` text DEFAULT '' NOT NULL,
	`paid_by` text NOT NULL,
	`status` text DEFAULT 'PAID' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_payment_request_unique` ON `finance_payment_ledger` (`request_id`);--> statement-breakpoint
CREATE INDEX `idx_finance_payment_date` ON `finance_payment_ledger` (`payment_date`);--> statement-breakpoint
CREATE TABLE `hr_offer_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`applicant_id` text NOT NULL,
	`proposed_title` text NOT NULL,
	`department` text NOT NULL,
	`employment_type` text NOT NULL,
	`start_date` text NOT NULL,
	`annual_salary` integer NOT NULL,
	`probation_months` integer DEFAULT 3 NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'SUBMITTED' NOT NULL,
	`requested_by` text NOT NULL,
	`approved_by` text DEFAULT '' NOT NULL,
	`approved_at` integer,
	`responded_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_hr_offer_applicant_created` ON `hr_offer_requests` (`applicant_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_hr_offer_status_start` ON `hr_offer_requests` (`status`,`start_date`);--> statement-breakpoint
CREATE TABLE `hr_retirement_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`retirement_date` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'SUBMITTED' NOT NULL,
	`checklist_json` text DEFAULT '[]' NOT NULL,
	`total_tasks` integer DEFAULT 0 NOT NULL,
	`completed_tasks` integer DEFAULT 0 NOT NULL,
	`requested_by` text NOT NULL,
	`approved_by` text DEFAULT '' NOT NULL,
	`approved_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_hr_retirement_employee_date` ON `hr_retirement_requests` (`employee_id`,`retirement_date`);--> statement-breakpoint
CREATE INDEX `idx_hr_retirement_status_date` ON `hr_retirement_requests` (`status`,`retirement_date`);