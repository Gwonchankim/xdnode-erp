CREATE TABLE `finance_receivable_management` (
	`partner_name` text PRIMARY KEY NOT NULL,
	`outstanding_amount` integer NOT NULL,
	`owner` text DEFAULT '' NOT NULL,
	`due_date` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'UNSET' NOT NULL,
	`memo` text DEFAULT '' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_finance_receivable_status_due` ON `finance_receivable_management` (`status`,`due_date`);