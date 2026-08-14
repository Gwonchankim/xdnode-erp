CREATE TABLE `finance_debt_facilities` (
	`id` text PRIMARY KEY NOT NULL,
	`facility_code` text NOT NULL,
	`source_account_id` text NOT NULL,
	`lender_name` text NOT NULL,
	`facility_name` text NOT NULL,
	`currency` text DEFAULT 'KRW' NOT NULL,
	`original_principal` integer NOT NULL,
	`agreement_date` text NOT NULL,
	`maturity_date` text NOT NULL,
	`interest_type` text DEFAULT 'MANUAL' NOT NULL,
	`fixed_rate_bps` integer DEFAULT 0 NOT NULL,
	`benchmark_name` text DEFAULT '' NOT NULL,
	`spread_bps` integer DEFAULT 0 NOT NULL,
	`repayment_type` text DEFAULT 'MANUAL' NOT NULL,
	`payment_day` integer DEFAULT 0 NOT NULL,
	`covenant_note` text DEFAULT '' NOT NULL,
	`next_covenant_review_date` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`evidence_document_id` text DEFAULT '' NOT NULL,
	`approved_by` text DEFAULT '' NOT NULL,
	`approved_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_debt_facility_code` ON `finance_debt_facilities` (`facility_code`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_debt_facility_source` ON `finance_debt_facilities` (`source_account_id`);
--> statement-breakpoint
CREATE INDEX `idx_finance_debt_facility_status_maturity` ON `finance_debt_facilities` (`status`,`maturity_date`);
--> statement-breakpoint
CREATE TABLE `finance_debt_schedule_items` (
	`id` text PRIMARY KEY NOT NULL,
	`facility_id` text NOT NULL,
	`due_date` text NOT NULL,
	`item_type` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'PLANNED' NOT NULL,
	`payment_request_id` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_debt_schedule_unique` ON `finance_debt_schedule_items` (`facility_id`,`due_date`,`item_type`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_debt_schedule_payment` ON `finance_debt_schedule_items` (`payment_request_id`) WHERE `payment_request_id` <> '';
--> statement-breakpoint
CREATE INDEX `idx_finance_debt_schedule_status_due` ON `finance_debt_schedule_items` (`status`,`due_date`);
--> statement-breakpoint
CREATE TABLE `finance_debt_covenant_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`facility_id` text NOT NULL,
	`review_date` text NOT NULL,
	`covenant_name` text NOT NULL,
	`comparator` text NOT NULL,
	`threshold_value_scaled` integer NOT NULL,
	`actual_value_scaled` integer NOT NULL,
	`unit` text NOT NULL,
	`result` text NOT NULL,
	`evidence_document_id` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`reviewed_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_debt_covenant_review_unique` ON `finance_debt_covenant_reviews` (`facility_id`,`review_date`,`covenant_name`);
--> statement-breakpoint
CREATE INDEX `idx_finance_debt_covenant_result_date` ON `finance_debt_covenant_reviews` (`result`,`review_date`);
