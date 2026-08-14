CREATE TABLE `erp_approval_delegations` (
	`id` text PRIMARY KEY NOT NULL,
	`delegator_employee_id` text NOT NULL,
	`delegate_employee_id` text NOT NULL,
	`module` text DEFAULT 'all' NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`reason` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_erp_approval_delegation_active_dates` ON `erp_approval_delegations` (`delegator_employee_id`,`active`,`starts_on`,`ends_on`);--> statement-breakpoint
CREATE INDEX `idx_erp_approval_delegation_delegate` ON `erp_approval_delegations` (`delegate_employee_id`,`active`,`ends_on`);--> statement-breakpoint
CREATE TABLE `erp_approval_policies` (
	`id` text PRIMARY KEY NOT NULL,
	`module` text NOT NULL,
	`request_type` text NOT NULL,
	`name` text NOT NULL,
	`min_amount` integer DEFAULT 0 NOT NULL,
	`max_amount` integer,
	`priority` integer DEFAULT 0 NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_erp_approval_policy_match` ON `erp_approval_policies` (`module`,`request_type`,`active`,`min_amount`);--> statement-breakpoint
CREATE TABLE `erp_approval_policy_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`policy_id` text NOT NULL,
	`step_order` integer NOT NULL,
	`step_name` text NOT NULL,
	`approver_role` text DEFAULT '' NOT NULL,
	`approver_employee_id` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_erp_approval_policy_step_order` ON `erp_approval_policy_steps` (`policy_id`,`step_order`);--> statement-breakpoint
ALTER TABLE `erp_approval_steps` ADD `delegated_from_employee_id` text DEFAULT '' NOT NULL;