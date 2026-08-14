CREATE TABLE `erp_audit_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`actor_email` text NOT NULL,
	`actor_employee_id` text NOT NULL,
	`module` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`before_json` text,
	`after_json` text,
	`reason` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_erp_audit_module_created` ON `erp_audit_logs` (`module`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_erp_audit_entity` ON `erp_audit_logs` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `erp_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`module` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`category` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`storage_key` text NOT NULL,
	`uploaded_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_erp_documents_entity` ON `erp_documents` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE TABLE `erp_sync_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`scope` text NOT NULL,
	`snapshot_date` text NOT NULL,
	`status` text NOT NULL,
	`record_count` integer DEFAULT 0 NOT NULL,
	`metrics_json` text DEFAULT '{}' NOT NULL,
	`error_message` text DEFAULT '' NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_erp_sync_source_snapshot` ON `erp_sync_runs` (`source`,`snapshot_date`);--> statement-breakpoint
CREATE INDEX `idx_erp_sync_status_created` ON `erp_sync_runs` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `erp_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`module` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`owner_employee_id` text DEFAULT '' NOT NULL,
	`due_date` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`priority` text DEFAULT 'NORMAL' NOT NULL,
	`destination` text DEFAULT '' NOT NULL,
	`source_type` text DEFAULT 'MANUAL' NOT NULL,
	`source_id` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_erp_tasks_owner_status_due` ON `erp_tasks` (`owner_employee_id`,`status`,`due_date`);--> statement-breakpoint
CREATE INDEX `idx_erp_tasks_module_status` ON `erp_tasks` (`module`,`status`);--> statement-breakpoint
CREATE TABLE `erp_user_access` (
	`employee_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`roles_json` text DEFAULT '[]' NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `erp_user_access_email_unique` ON `erp_user_access` (`email`);--> statement-breakpoint
CREATE TABLE `finance_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`fiscal_year` integer NOT NULL,
	`month` integer NOT NULL,
	`department` text NOT NULL,
	`account_code` text NOT NULL,
	`account_name` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`approved_by` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_finance_budgets_year_month_department` ON `finance_budgets` (`fiscal_year`,`month`,`department`);--> statement-breakpoint
CREATE TABLE `finance_cash_forecast_items` (
	`id` text PRIMARY KEY NOT NULL,
	`expected_date` text NOT NULL,
	`direction` text NOT NULL,
	`category` text NOT NULL,
	`counterparty` text DEFAULT '' NOT NULL,
	`amount` integer NOT NULL,
	`probability` integer DEFAULT 100 NOT NULL,
	`scenario` text DEFAULT 'BASE' NOT NULL,
	`source_type` text DEFAULT 'MANUAL' NOT NULL,
	`source_id` text DEFAULT '' NOT NULL,
	`memo` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'EXPECTED' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_finance_cash_forecast_scenario_date` ON `finance_cash_forecast_items` (`scenario`,`expected_date`);--> statement-breakpoint
CREATE INDEX `idx_finance_cash_forecast_status_date` ON `finance_cash_forecast_items` (`status`,`expected_date`);--> statement-breakpoint
CREATE TABLE `finance_close_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`period` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`owner_employee_id` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`evidence_document_id` text DEFAULT '' NOT NULL,
	`completed_at` integer,
	`approved_by` text DEFAULT '' NOT NULL,
	`approved_at` integer,
	`reopened_reason` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_finance_close_period_status` ON `finance_close_tasks` (`period`,`status`);--> statement-breakpoint
CREATE TABLE `finance_reconciliations` (
	`id` text PRIMARY KEY NOT NULL,
	`bank_transaction_id` text NOT NULL,
	`journal_line_id` text DEFAULT '' NOT NULL,
	`transaction_date` text NOT NULL,
	`amount` integer NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`account_code` text DEFAULT '' NOT NULL,
	`match_score` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'UNMATCHED' NOT NULL,
	`resolution_memo` text DEFAULT '' NOT NULL,
	`resolved_by` text DEFAULT '' NOT NULL,
	`resolved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_finance_reconciliation_status_date` ON `finance_reconciliations` (`status`,`transaction_date`);--> statement-breakpoint
CREATE INDEX `idx_finance_reconciliation_bank_transaction` ON `finance_reconciliations` (`bank_transaction_id`);--> statement-breakpoint
CREATE TABLE `hr_leave_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`leave_type` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`units` integer NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`approver_employee_id` text DEFAULT '' NOT NULL,
	`decided_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_hr_leave_employee_start` ON `hr_leave_requests` (`employee_id`,`start_date`);--> statement-breakpoint
CREATE INDEX `idx_hr_leave_status_start` ON `hr_leave_requests` (`status`,`start_date`);--> statement-breakpoint
CREATE TABLE `hr_lifecycle_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`lifecycle_type` text NOT NULL,
	`task_group` text NOT NULL,
	`title` text NOT NULL,
	`owner_employee_id` text DEFAULT '' NOT NULL,
	`due_date` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_hr_lifecycle_employee_type` ON `hr_lifecycle_tasks` (`employee_id`,`lifecycle_type`);--> statement-breakpoint
CREATE INDEX `idx_hr_lifecycle_status_due` ON `hr_lifecycle_tasks` (`status`,`due_date`);--> statement-breakpoint
CREATE TABLE `hr_payroll_runs` (
	`period` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`employee_count` integer DEFAULT 0 NOT NULL,
	`gross_pay` integer DEFAULT 0 NOT NULL,
	`deductions` integer DEFAULT 0 NOT NULL,
	`net_pay` integer DEFAULT 0 NOT NULL,
	`prepared_by` text DEFAULT '' NOT NULL,
	`reviewed_by` text DEFAULT '' NOT NULL,
	`approved_by` text DEFAULT '' NOT NULL,
	`locked_at` integer,
	`reopened_reason` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `hr_personnel_actions` (
	`id` text PRIMARY KEY NOT NULL,
	`employee_id` text NOT NULL,
	`action_type` text NOT NULL,
	`effective_date` text NOT NULL,
	`order_number` text DEFAULT '' NOT NULL,
	`before_json` text DEFAULT '{}' NOT NULL,
	`after_json` text DEFAULT '{}' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`approved_by` text DEFAULT '' NOT NULL,
	`approved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_hr_personnel_employee_effective` ON `hr_personnel_actions` (`employee_id`,`effective_date`);--> statement-breakpoint
CREATE INDEX `idx_hr_personnel_status_effective` ON `hr_personnel_actions` (`status`,`effective_date`);--> statement-breakpoint
CREATE TABLE `sales_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`business_number` text DEFAULT '' NOT NULL,
	`industry` text DEFAULT '' NOT NULL,
	`owner_employee_id` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`memo` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_sales_accounts_name` ON `sales_accounts` (`name`);--> statement-breakpoint
CREATE INDEX `idx_sales_accounts_owner_status` ON `sales_accounts` (`owner_employee_id`,`status`);--> statement-breakpoint
CREATE TABLE `sales_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`opportunity_id` text NOT NULL,
	`document_type` text NOT NULL,
	`document_number` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`amount` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`issued_date` text DEFAULT '' NOT NULL,
	`due_date` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sales_documents_opportunity_type` ON `sales_documents` (`opportunity_id`,`document_type`);--> statement-breakpoint
CREATE INDEX `idx_sales_documents_status_due` ON `sales_documents` (`status`,`due_date`);--> statement-breakpoint
CREATE TABLE `sales_incentive_results` (
	`id` text PRIMARY KEY NOT NULL,
	`period` text NOT NULL,
	`employee_id` text NOT NULL,
	`opportunity_id` text NOT NULL,
	`rule_id` text NOT NULL,
	`rule_version` integer NOT NULL,
	`recognized_revenue` integer NOT NULL,
	`recognized_cost` integer NOT NULL,
	`payout_amount` integer NOT NULL,
	`calculation_json` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`sales_confirmed_at` integer,
	`finance_reviewed_at` integer,
	`representative_approved_at` integer,
	`payroll_ref` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sales_incentive_period_employee` ON `sales_incentive_results` (`period`,`employee_id`);--> statement-breakpoint
CREATE INDEX `idx_sales_incentive_status` ON `sales_incentive_results` (`status`);--> statement-breakpoint
CREATE TABLE `sales_incentive_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` integer NOT NULL,
	`effective_from` text NOT NULL,
	`effective_to` text DEFAULT '' NOT NULL,
	`rules_json` text NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`approved_by` text DEFAULT '' NOT NULL,
	`approved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_sales_incentive_rules_status_effective` ON `sales_incentive_rules` (`status`,`effective_from`);--> statement-breakpoint
CREATE TABLE `sales_opportunities` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`title` text NOT NULL,
	`owner_employee_id` text NOT NULL,
	`stage` text DEFAULT 'LEAD' NOT NULL,
	`lead_type` text DEFAULT 'OUTBOUND' NOT NULL,
	`expected_revenue` integer DEFAULT 0 NOT NULL,
	`expected_cost` integer DEFAULT 0 NOT NULL,
	`probability` integer DEFAULT 0 NOT NULL,
	`expected_close_date` text DEFAULT '' NOT NULL,
	`next_action` text DEFAULT '' NOT NULL,
	`next_action_date` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_sales_opportunities_owner_stage` ON `sales_opportunities` (`owner_employee_id`,`stage`);--> statement-breakpoint
CREATE INDEX `idx_sales_opportunities_close_date` ON `sales_opportunities` (`expected_close_date`);--> statement-breakpoint
CREATE INDEX `idx_sales_opportunities_account` ON `sales_opportunities` (`account_id`);