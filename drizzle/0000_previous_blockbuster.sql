CREATE TABLE `employee_interview_records` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`interview_at` text NOT NULL,
	`transcript` text DEFAULT '' NOT NULL,
	`memo` text DEFAULT '' NOT NULL,
	`audio_key` text,
	`audio_content_type` text,
	`audio_file_name` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_employee_interview_records_employee_created` ON `employee_interview_records` (`employee_id`,`created_at`);