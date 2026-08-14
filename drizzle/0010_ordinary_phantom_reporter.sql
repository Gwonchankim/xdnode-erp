ALTER TABLE `hr_employee_records` ADD `join_date` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `hr_employee_records` ADD `status` text DEFAULT '재직' NOT NULL;--> statement-breakpoint
ALTER TABLE `hr_employee_records` ADD `history_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `hr_employee_records` ADD `retirement_json` text;