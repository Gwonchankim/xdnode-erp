CREATE TABLE `erp_approval_events` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`step_order` integer DEFAULT 0 NOT NULL,
	`action` text NOT NULL,
	`actor_employee_id` text NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`snapshot_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_erp_approval_event_request_created` ON `erp_approval_events` (`request_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `erp_approval_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`module` text NOT NULL,
	`request_type` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`requester_employee_id` text NOT NULL,
	`target_entity_type` text DEFAULT '' NOT NULL,
	`target_entity_id` text DEFAULT '' NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`currency` text DEFAULT 'KRW' NOT NULL,
	`priority` text DEFAULT 'NORMAL' NOT NULL,
	`status` text DEFAULT 'SUBMITTED' NOT NULL,
	`current_step` integer DEFAULT 1 NOT NULL,
	`due_date` text DEFAULT '' NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`transition_token` text DEFAULT '' NOT NULL,
	`submitted_at` integer NOT NULL,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_erp_approval_requester_status` ON `erp_approval_requests` (`requester_employee_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_erp_approval_module_status` ON `erp_approval_requests` (`module`,`status`,`updated_at`);--> statement-breakpoint
CREATE INDEX `idx_erp_approval_target` ON `erp_approval_requests` (`target_entity_type`,`target_entity_id`);--> statement-breakpoint
CREATE TABLE `erp_approval_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`request_id` text NOT NULL,
	`step_order` integer NOT NULL,
	`step_name` text NOT NULL,
	`approver_role` text NOT NULL,
	`approver_employee_id` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'WAITING' NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
	`acted_by` text DEFAULT '' NOT NULL,
	`acted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_erp_approval_step_request_order` ON `erp_approval_steps` (`request_id`,`step_order`);--> statement-breakpoint
CREATE INDEX `idx_erp_approval_step_approver_status` ON `erp_approval_steps` (`approver_employee_id`,`status`);