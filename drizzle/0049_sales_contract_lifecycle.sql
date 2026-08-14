CREATE TABLE IF NOT EXISTS `sales_contract_governance_settings` (
  `id` text PRIMARY KEY NOT NULL, `enforcement_started_at` integer NOT NULL,
  `created_at` integer NOT NULL, `updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `sales_contract_governance_settings` (`id`, `enforcement_started_at`, `created_at`, `updated_at`)
VALUES ('default', 1786722879487, 1786722879487, 1786722879487);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sales_contracts` (
  `id` text PRIMARY KEY NOT NULL, `order_document_id` text NOT NULL, `contract_number` text NOT NULL,
  `title` text NOT NULL, `version` integer NOT NULL DEFAULT 1, `amount_snapshot` integer NOT NULL,
  `currency` text NOT NULL DEFAULT 'KRW', `start_date` text NOT NULL, `end_date` text NOT NULL,
  `auto_renewal` integer NOT NULL DEFAULT 0, `renewal_notice_days` integer NOT NULL DEFAULT 30,
  `payment_terms` text NOT NULL, `acceptance_criteria` text NOT NULL, `delivery_terms` text NOT NULL,
  `owner_employee_id` text NOT NULL, `signed_document_id` text NOT NULL DEFAULT '',
  `status` text NOT NULL DEFAULT 'DRAFT', `created_by` text NOT NULL, `approved_by` text NOT NULL DEFAULT '',
  `approved_at` integer, `created_at` integer NOT NULL, `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_sales_contract_order` ON `sales_contracts` (`order_document_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_sales_contract_number` ON `sales_contracts` (`contract_number`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sales_contract_status_end` ON `sales_contracts` (`status`, `end_date`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sales_contract_obligations` (
  `id` text PRIMARY KEY NOT NULL, `contract_id` text NOT NULL, `obligation_type` text NOT NULL,
  `title` text NOT NULL, `owner_employee_id` text NOT NULL, `due_date` text NOT NULL,
  `evidence_required` integer NOT NULL DEFAULT 1, `status` text NOT NULL DEFAULT 'OPEN',
  `completion_note` text NOT NULL DEFAULT '', `completed_by` text NOT NULL DEFAULT '', `completed_at` integer,
  `created_at` integer NOT NULL, `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sales_contract_obligation_contract_due`
ON `sales_contract_obligations` (`contract_id`, `status`, `due_date`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sales_contract_change_requests` (
  `id` text PRIMARY KEY NOT NULL, `contract_id` text NOT NULL, `change_type` text NOT NULL,
  `reason` text NOT NULL, `before_json` text NOT NULL, `after_json` text NOT NULL,
  `effective_date` text NOT NULL, `status` text NOT NULL DEFAULT 'SUBMITTED', `created_by` text NOT NULL,
  `approval_request_id` text NOT NULL DEFAULT '', `approved_by` text NOT NULL DEFAULT '', `approved_at` integer,
  `created_at` integer NOT NULL, `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sales_contract_change_contract_created`
ON `sales_contract_change_requests` (`contract_id`, `created_at`);
--> statement-breakpoint
PRAGMA optimize;
