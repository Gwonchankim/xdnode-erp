CREATE TABLE `hr_employee_records` (
	`employee_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`birth` text NOT NULL,
	`email` text NOT NULL,
	`phone` text NOT NULL,
	`address` text NOT NULL,
	`department` text NOT NULL,
	`manager` text NOT NULL,
	`employment_type` text NOT NULL,
	`position` text NOT NULL,
	`job_title` text NOT NULL,
	`updated_at` integer NOT NULL
);
