CREATE TABLE `finance_purchase_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`invoice_number` text NOT NULL,
	`invoice_date` text NOT NULL,
	`due_date` text DEFAULT '' NOT NULL,
	`supply_amount` integer NOT NULL,
	`tax_amount` integer DEFAULT 0 NOT NULL,
	`total_amount` integer NOT NULL,
	`matched_receipt_amount` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`exception_reason` text DEFAULT '' NOT NULL,
	`payment_request_id` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_purchase_invoice_number` ON `finance_purchase_invoices` (`invoice_number`);--> statement-breakpoint
CREATE INDEX `idx_finance_purchase_invoice_order_status` ON `finance_purchase_invoices` (`order_id`,`status`);--> statement-breakpoint
CREATE INDEX `idx_finance_purchase_invoice_due_status` ON `finance_purchase_invoices` (`due_date`,`status`);--> statement-breakpoint
CREATE TABLE `finance_purchase_order_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`line_number` integer NOT NULL,
	`item_name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`quantity_milli` integer NOT NULL,
	`unit_price` integer NOT NULL,
	`line_amount` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_purchase_order_line_number` ON `finance_purchase_order_lines` (`order_id`,`line_number`);--> statement-breakpoint
CREATE TABLE `finance_purchase_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`order_number` text NOT NULL,
	`vendor_id` text NOT NULL,
	`title` text NOT NULL,
	`currency` text DEFAULT 'KRW' NOT NULL,
	`subtotal` integer DEFAULT 0 NOT NULL,
	`tax_amount` integer DEFAULT 0 NOT NULL,
	`total_amount` integer DEFAULT 0 NOT NULL,
	`expected_date` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`requester_employee_id` text NOT NULL,
	`approved_by` text DEFAULT '' NOT NULL,
	`approved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_purchase_order_number` ON `finance_purchase_orders` (`order_number`);--> statement-breakpoint
CREATE INDEX `idx_finance_purchase_order_vendor_status` ON `finance_purchase_orders` (`vendor_id`,`status`);--> statement-breakpoint
CREATE TABLE `finance_purchase_receipt_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`receipt_id` text NOT NULL,
	`order_line_id` text NOT NULL,
	`received_quantity_milli` integer NOT NULL,
	`accepted_quantity_milli` integer NOT NULL,
	`rejected_quantity_milli` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_purchase_receipt_line` ON `finance_purchase_receipt_lines` (`receipt_id`,`order_line_id`);--> statement-breakpoint
CREATE INDEX `idx_finance_purchase_receipt_order_line` ON `finance_purchase_receipt_lines` (`order_line_id`);--> statement-breakpoint
CREATE TABLE `finance_purchase_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`receipt_number` text NOT NULL,
	`receipt_date` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'ACCEPTED' NOT NULL,
	`received_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_purchase_receipt_number` ON `finance_purchase_receipts` (`receipt_number`);--> statement-breakpoint
CREATE INDEX `idx_finance_purchase_receipt_order_date` ON `finance_purchase_receipts` (`order_id`,`receipt_date`);--> statement-breakpoint
CREATE TABLE `finance_purchase_vendors` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`business_number` text DEFAULT '' NOT NULL,
	`contact_name` text DEFAULT '' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`payment_terms_days` integer DEFAULT 30 NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_finance_purchase_vendor_status_name` ON `finance_purchase_vendors` (`status`,`name`);