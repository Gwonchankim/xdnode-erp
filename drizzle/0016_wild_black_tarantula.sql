ALTER TABLE `finance_expense_requests` ADD `source_type` text DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE `finance_expense_requests` ADD `source_id` text DEFAULT '' NOT NULL;