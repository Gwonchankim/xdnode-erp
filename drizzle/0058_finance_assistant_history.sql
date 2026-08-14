CREATE TABLE `finance_assistant_answers` (`id` text PRIMARY KEY NOT NULL,`question` text NOT NULL,`answer` text NOT NULL,`provider` text NOT NULL,`evidence_status` text NOT NULL,`basis_as_of` text NOT NULL,`evidence_json` text NOT NULL,`evidence_hash` text NOT NULL,`answer_hash` text NOT NULL,`prompt_version` text NOT NULL,`created_by_employee_id` text NOT NULL,`created_by_user_id` text NOT NULL,`created_by_name` text NOT NULL,`created_at` integer NOT NULL);--> statement-breakpoint
CREATE INDEX `idx_finance_assistant_created` ON `finance_assistant_answers` (`created_at`);--> statement-breakpoint
CREATE INDEX `idx_finance_assistant_actor_created` ON `finance_assistant_answers` (`created_by_employee_id`,`created_at`);--> statement-breakpoint
PRAGMA optimize;
