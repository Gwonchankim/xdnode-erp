CREATE TABLE `hr_performance_cycles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`period` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`goal_due_date` text NOT NULL,
	`self_due_date` text NOT NULL,
	`manager_due_date` text NOT NULL,
	`calibration_due_date` text NOT NULL,
	`created_by` text NOT NULL,
	`opened_at` integer,
	`finalized_by` text DEFAULT '' NOT NULL,
	`finalized_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_hr_performance_cycle_period_name` ON `hr_performance_cycles` (`period`,`name`);--> statement-breakpoint
CREATE INDEX `idx_hr_performance_cycle_status_period` ON `hr_performance_cycles` (`status`,`period`);--> statement-breakpoint
CREATE TABLE `hr_performance_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`cycle_id` text NOT NULL,
	`employee_id` text NOT NULL,
	`organization_id` text DEFAULT '' NOT NULL,
	`manager_employee_id` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'NOT_STARTED' NOT NULL,
	`final_score` integer,
	`final_rating` text DEFAULT '' NOT NULL,
	`calibration_note` text DEFAULT '' NOT NULL,
	`finalized_by` text DEFAULT '' NOT NULL,
	`finalized_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_hr_performance_participant_cycle_employee` ON `hr_performance_participants` (`cycle_id`,`employee_id`);--> statement-breakpoint
CREATE INDEX `idx_hr_performance_participant_manager_status` ON `hr_performance_participants` (`manager_employee_id`,`status`);--> statement-breakpoint
CREATE TABLE `hr_performance_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`participant_id` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`weight` integer NOT NULL,
	`metric_type` text DEFAULT 'PERCENT' NOT NULL,
	`target_value` real NOT NULL,
	`actual_value` real,
	`unit` text DEFAULT '%' NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`employee_comment` text DEFAULT '' NOT NULL,
	`manager_comment` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_hr_performance_goal_participant_status` ON `hr_performance_goals` (`participant_id`,`status`);--> statement-breakpoint
CREATE TABLE `hr_performance_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`participant_id` text NOT NULL,
	`reviewer_type` text NOT NULL,
	`reviewer_employee_id` text NOT NULL,
	`score` integer NOT NULL,
	`rating` text NOT NULL,
	`strengths` text DEFAULT '' NOT NULL,
	`improvements` text DEFAULT '' NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`submitted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_hr_performance_review_participant_type` ON `hr_performance_reviews` (`participant_id`,`reviewer_type`);--> statement-breakpoint
CREATE INDEX `idx_hr_performance_review_reviewer_status` ON `hr_performance_reviews` (`reviewer_employee_id`,`status`);--> statement-breakpoint
CREATE TABLE `hr_performance_appeals` (
	`id` text PRIMARY KEY NOT NULL,
	`participant_id` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'SUBMITTED' NOT NULL,
	`response` text DEFAULT '' NOT NULL,
	`submitted_by` text NOT NULL,
	`submitted_at` integer NOT NULL,
	`resolved_by` text DEFAULT '' NOT NULL,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_hr_performance_appeal_participant_status` ON `hr_performance_appeals` (`participant_id`,`status`);
