CREATE TABLE `finance_master_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`normal_balance` text NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`source` text DEFAULT 'MANUAL' NOT NULL,
	`valid_from` text DEFAULT '' NOT NULL,
	`valid_to` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_master_account_code` ON `finance_master_accounts` (`code`);
--> statement-breakpoint
CREATE INDEX `idx_finance_master_account_status_category` ON `finance_master_accounts` (`status`,`category`);
--> statement-breakpoint
CREATE TABLE `finance_master_partners` (
	`id` text PRIMARY KEY NOT NULL,
	`canonical_name` text NOT NULL,
	`normalized_key` text NOT NULL,
	`business_number` text DEFAULT '' NOT NULL,
	`partner_type` text DEFAULT 'BOTH' NOT NULL,
	`payment_terms_days` integer DEFAULT 30 NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`source` text DEFAULT 'MANUAL' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_master_partner_key` ON `finance_master_partners` (`normalized_key`);
--> statement-breakpoint
CREATE INDEX `idx_finance_master_partner_status_type` ON `finance_master_partners` (`status`,`partner_type`);
--> statement-breakpoint
CREATE TABLE `finance_master_partner_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`mapping_key` text NOT NULL,
	`source_system` text NOT NULL,
	`source_entity_id` text DEFAULT '' NOT NULL,
	`source_name` text NOT NULL,
	`partner_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_master_partner_alias_key` ON `finance_master_partner_aliases` (`mapping_key`);
--> statement-breakpoint
CREATE INDEX `idx_finance_master_partner_alias_partner` ON `finance_master_partner_aliases` (`partner_id`);
--> statement-breakpoint
CREATE TABLE `finance_master_bank_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`source_system` text NOT NULL,
	`source_account_id` text NOT NULL,
	`bank_code` text DEFAULT '' NOT NULL,
	`account_name` text NOT NULL,
	`last4` text DEFAULT '' NOT NULL,
	`account_type` text NOT NULL,
	`currency` text DEFAULT 'KRW' NOT NULL,
	`gl_account_code` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_master_bank_source` ON `finance_master_bank_accounts` (`source_system`,`source_account_id`);
--> statement-breakpoint
CREATE INDEX `idx_finance_master_bank_status_type` ON `finance_master_bank_accounts` (`status`,`account_type`);
--> statement-breakpoint
CREATE TABLE `finance_master_tax_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`direction` text DEFAULT 'BOTH' NOT NULL,
	`rate_basis_points` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`effective_from` text DEFAULT '' NOT NULL,
	`effective_to` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_master_tax_code` ON `finance_master_tax_codes` (`code`);
--> statement-breakpoint
CREATE INDEX `idx_finance_master_tax_status_direction` ON `finance_master_tax_codes` (`status`,`direction`);
--> statement-breakpoint
CREATE TABLE `finance_master_change_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`change_type` text NOT NULL,
	`before_json` text DEFAULT '{}' NOT NULL,
	`after_json` text DEFAULT '{}' NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'SUBMITTED' NOT NULL,
	`approval_id` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`approved_by` text DEFAULT '' NOT NULL,
	`approved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_finance_master_change_status_created` ON `finance_master_change_requests` (`status`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_finance_master_change_target` ON `finance_master_change_requests` (`target_type`,`target_id`);

