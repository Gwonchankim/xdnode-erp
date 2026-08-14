CREATE TABLE IF NOT EXISTS `sales_service_policies` (
  `id` text PRIMARY KEY NOT NULL, `name` text NOT NULL, `version` integer NOT NULL DEFAULT 1,
  `priority` text NOT NULL, `first_response_hours` integer NOT NULL, `resolution_hours` integer NOT NULL,
  `effective_from` text NOT NULL, `effective_to` text NOT NULL DEFAULT '', `status` text NOT NULL DEFAULT 'DRAFT',
  `created_by` text NOT NULL, `approved_by` text NOT NULL DEFAULT '', `approved_at` integer,
  `created_at` integer NOT NULL, `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sales_service_cases` (
  `id` text PRIMARY KEY NOT NULL, `case_number` text NOT NULL, `account_id` text NOT NULL,
  `opportunity_id` text NOT NULL, `delivery_document_id` text NOT NULL, `contract_id` text NOT NULL DEFAULT '',
  `contact_id` text NOT NULL DEFAULT '', `category` text NOT NULL, `priority` text NOT NULL,
  `subject` text NOT NULL, `description` text NOT NULL, `policy_id` text NOT NULL DEFAULT '',
  `opened_at` integer NOT NULL, `first_response_due_at` integer NOT NULL, `resolution_due_at` integer NOT NULL,
  `first_responded_at` integer, `status` text NOT NULL DEFAULT 'OPEN', `owner_employee_id` text NOT NULL,
  `resolution_type` text NOT NULL DEFAULT '', `resolution_note` text NOT NULL DEFAULT '',
  `refund_amount` integer NOT NULL DEFAULT 0, `approval_request_id` text NOT NULL DEFAULT '',
  `finance_request_id` text NOT NULL DEFAULT '', `resolved_by` text NOT NULL DEFAULT '', `resolved_at` integer,
  `closed_by` text NOT NULL DEFAULT '', `closed_at` integer, `created_by` text NOT NULL,
  `created_at` integer NOT NULL, `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sales_service_case_events` (
  `id` text PRIMARY KEY NOT NULL, `case_id` text NOT NULL, `event_type` text NOT NULL,
  `note` text NOT NULL, `actor_employee_id` text NOT NULL, `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sales_service_return_lines` (
  `id` text PRIMARY KEY NOT NULL, `case_id` text NOT NULL, `delivery_line_id` text NOT NULL,
  `quantity_milli` integer NOT NULL, `disposition` text NOT NULL, `inventory_movement_id` text NOT NULL DEFAULT '',
  `received_by` text NOT NULL DEFAULT '', `received_at` integer, `created_at` integer NOT NULL, `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_sales_service_policy_name_version` ON `sales_service_policies` (`name`, `version`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_sales_service_policy_active_priority` ON `sales_service_policies` (`priority`) WHERE `status` = 'ACTIVE';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_sales_service_case_number` ON `sales_service_cases` (`case_number`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sales_service_case_status_due` ON `sales_service_cases` (`status`, `resolution_due_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sales_service_case_account_opened` ON `sales_service_cases` (`account_id`, `opened_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sales_service_event_case_created` ON `sales_service_case_events` (`case_id`, `created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_sales_service_return_case_line` ON `sales_service_return_lines` (`case_id`, `delivery_line_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_sales_service_return_inventory` ON `sales_service_return_lines` (`inventory_movement_id`) WHERE `inventory_movement_id` <> '';
--> statement-breakpoint
PRAGMA optimize;
