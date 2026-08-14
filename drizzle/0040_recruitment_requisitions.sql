CREATE TABLE `hr_recruitment_requisitions` (
	`id` text PRIMARY KEY NOT NULL,
	`workforce_plan_id` text NOT NULL,
	`workforce_plan_line_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`title` text NOT NULL,
	`role` text NOT NULL,
	`requested_headcount` integer DEFAULT 1 NOT NULL,
	`owner_employee_id` text NOT NULL,
	`target_start_date` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`requested_by` text NOT NULL,
	`approved_by` text DEFAULT '' NOT NULL,
	`approved_at` integer,
	`closed_by` text DEFAULT '' NOT NULL,
	`closed_at` integer,
	`close_reason` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_hr_requisition_plan_org` ON `hr_recruitment_requisitions` (`workforce_plan_id`,`organization_id`);--> statement-breakpoint
CREATE INDEX `idx_hr_requisition_status_owner` ON `hr_recruitment_requisitions` (`status`,`owner_employee_id`);--> statement-breakpoint
ALTER TABLE `hr_applicants` ADD `requisition_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_hr_applicants_requisition` ON `hr_applicants` (`requisition_id`);
