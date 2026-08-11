CREATE TABLE `hr_applicants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`applied` text NOT NULL,
	`owner_id` text DEFAULT '' NOT NULL,
	`stage` text NOT NULL,
	`experience` text DEFAULT '' NOT NULL,
	`email` text NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`source` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`resume_file_name` text DEFAULT '' NOT NULL,
	`resume_text` text DEFAULT '' NOT NULL,
	`checklist_json` text DEFAULT '[]' NOT NULL,
	`screening_memos_json` text DEFAULT '[]' NOT NULL,
	`interview_json` text,
	`interview_memos_json` text DEFAULT '[]' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_hr_applicants_name` ON `hr_applicants` (`name`);--> statement-breakpoint
CREATE INDEX `idx_hr_applicants_email` ON `hr_applicants` (`email`);--> statement-breakpoint
CREATE INDEX `idx_hr_applicants_phone` ON `hr_applicants` (`phone`);--> statement-breakpoint
CREATE TABLE `hr_recruiters` (
	`employee_id` text PRIMARY KEY NOT NULL,
	`created_at` integer NOT NULL
);
