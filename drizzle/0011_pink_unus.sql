CREATE TABLE `hr_attendance_records` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`work_date` text NOT NULL,
	`work_type` text DEFAULT 'OFFICE' NOT NULL,
	`check_in` text DEFAULT '' NOT NULL,
	`check_out` text DEFAULT '' NOT NULL,
	`minutes_worked` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'RECORDED' NOT NULL,
	`source_type` text DEFAULT 'MANUAL' NOT NULL,
	`memo` text DEFAULT '' NOT NULL,
	`approved_by` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_hr_attendance_employee_date` ON `hr_attendance_records` (`employee_id`,`work_date`);--> statement-breakpoint
CREATE INDEX `idx_hr_attendance_status_date` ON `hr_attendance_records` (`status`,`work_date`);