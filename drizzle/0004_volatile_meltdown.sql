CREATE TABLE `hr_organization_records` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hr_organization_records_name_unique` ON `hr_organization_records` (`name`);