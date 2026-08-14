ALTER TABLE `employee_interview_records` ADD `consent_confirmed_by` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `employee_interview_records` ADD `consent_confirmed_at` integer;
--> statement-breakpoint
ALTER TABLE `applicant_interview_recordings` ADD `consent_confirmed_by` text NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE `applicant_interview_recordings` ADD `consent_confirmed_at` integer;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `hr_audio_transcriptions` (
  `id` text PRIMARY KEY NOT NULL, `entity_type` text NOT NULL, `entity_id` text NOT NULL,
  `audio_key_snapshot` text NOT NULL, `audio_content_type` text NOT NULL,
  `status` text NOT NULL DEFAULT 'PROCESSING', `model` text NOT NULL, `language` text NOT NULL DEFAULT 'ko',
  `transcript` text NOT NULL DEFAULT '', `vtt` text NOT NULL DEFAULT '', `word_count` integer NOT NULL DEFAULT 0,
  `error_code` text NOT NULL DEFAULT '', `error_message` text NOT NULL DEFAULT '', `attempt` integer NOT NULL DEFAULT 1,
  `consent_confirmed_by` text NOT NULL, `consent_confirmed_at` integer NOT NULL,
  `requested_by` text NOT NULL, `requested_at` integer NOT NULL, `completed_at` integer,
  `reviewed_text` text NOT NULL DEFAULT '', `review_note` text NOT NULL DEFAULT '',
  `reviewed_by` text NOT NULL DEFAULT '', `reviewed_at` integer,
  `created_at` integer NOT NULL, `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_hr_audio_transcription_entity_attempt`
ON `hr_audio_transcriptions` (`entity_type`, `entity_id`, `attempt`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_hr_audio_transcription_entity_created`
ON `hr_audio_transcriptions` (`entity_type`, `entity_id`, `created_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_hr_audio_transcription_status_updated`
ON `hr_audio_transcriptions` (`status`, `updated_at`);
--> statement-breakpoint
PRAGMA optimize;
