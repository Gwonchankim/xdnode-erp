CREATE TABLE `applicant_interview_recordings` (
	`id` text PRIMARY KEY NOT NULL,
	`applicant_id` text NOT NULL,
	`recorded_at` text NOT NULL,
	`audio_key` text NOT NULL,
	`audio_content_type` text NOT NULL,
	`audio_file_name` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_applicant_interview_recordings_applicant_created` ON `applicant_interview_recordings` (`applicant_id`,`created_at`);