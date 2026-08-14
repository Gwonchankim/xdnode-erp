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
CREATE TRIGGER IF NOT EXISTS `trg_sales_service_return_quantity_limit`
BEFORE INSERT ON `sales_service_return_lines`
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `sales_service_cases` service
    JOIN `sales_document_lines` source_line ON source_line.`document_id` = service.`delivery_document_id`
    WHERE service.`id` = NEW.`case_id` AND source_line.`id` = NEW.`delivery_line_id`
  ) THEN RAISE(ABORT, 'RETURN_SOURCE_INVALID') END;
  SELECT CASE WHEN NEW.`quantity_milli` <= 0 OR NEW.`quantity_milli` + COALESCE((
    SELECT SUM(existing.`quantity_milli`) FROM `sales_service_return_lines` existing
    JOIN `sales_service_cases` existing_case ON existing_case.`id` = existing.`case_id`
    WHERE existing.`delivery_line_id` = NEW.`delivery_line_id` AND existing_case.`status` <> 'CANCELLED'
  ), 0) > (
    SELECT ROUND(source_line.`quantity` * 1000) FROM `sales_service_cases` service
    JOIN `sales_document_lines` source_line ON source_line.`document_id` = service.`delivery_document_id`
    WHERE service.`id` = NEW.`case_id` AND source_line.`id` = NEW.`delivery_line_id`
  ) THEN RAISE(ABORT, 'RETURN_QUANTITY_EXCEEDED') END;
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `trg_sales_service_refund_amount_limit`
BEFORE UPDATE OF `status`, `refund_amount`, `delivery_document_id` ON `sales_service_cases`
WHEN NEW.`status` IN ('RESOLUTION_SUBMITTED','RESOLUTION_APPROVED','RESOLVED','CLOSED') AND NEW.`refund_amount` > 0
BEGIN
  SELECT CASE WHEN NEW.`refund_amount` + COALESCE((
    SELECT SUM(other.`refund_amount`) FROM `sales_service_cases` other
    WHERE other.`delivery_document_id` = NEW.`delivery_document_id` AND other.`id` <> NEW.`id`
      AND other.`status` IN ('RESOLUTION_SUBMITTED','RESOLUTION_APPROVED','RESOLVED','CLOSED')
  ), 0) > COALESCE((SELECT `amount` FROM `sales_documents` WHERE `id` = NEW.`delivery_document_id`), 0)
  THEN RAISE(ABORT, 'REFUND_AMOUNT_EXCEEDED') END;
END;
--> statement-breakpoint
PRAGMA optimize;
