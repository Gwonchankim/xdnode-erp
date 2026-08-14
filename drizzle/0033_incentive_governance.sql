CREATE UNIQUE INDEX `idx_sales_incentive_rule_name_version` ON `sales_incentive_rules` (`name`,`version`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sales_incentive_result_source` ON `sales_incentive_results` (`period`,`employee_id`,`opportunity_id`,`rule_id`);
--> statement-breakpoint
CREATE TABLE `sales_incentive_validations` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`validation_type` text NOT NULL,
	`result` text NOT NULL,
	`evidence_document_id` text NOT NULL,
	`note` text NOT NULL,
	`reviewed_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sales_incentive_validation_type` ON `sales_incentive_validations` (`rule_id`,`validation_type`);
--> statement-breakpoint
CREATE INDEX `idx_sales_incentive_validation_result` ON `sales_incentive_validations` (`result`,`created_at`);
--> statement-breakpoint
CREATE TABLE `sales_incentive_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`result_id` text NOT NULL,
	`note_type` text NOT NULL,
	`note` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sales_incentive_note_result` ON `sales_incentive_notes` (`result_id`,`created_at`);
--> statement-breakpoint
CREATE TABLE `sales_incentive_payroll_links` (
	`id` text PRIMARY KEY NOT NULL,
	`result_id` text NOT NULL,
	`payroll_period` text NOT NULL,
	`payroll_record_id` text NOT NULL,
	`applied_amount` integer NOT NULL,
	`applied_by` text NOT NULL,
	`applied_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sales_incentive_payroll_result` ON `sales_incentive_payroll_links` (`result_id`);
--> statement-breakpoint
CREATE INDEX `idx_sales_incentive_payroll_period` ON `sales_incentive_payroll_links` (`payroll_period`,`payroll_record_id`);
