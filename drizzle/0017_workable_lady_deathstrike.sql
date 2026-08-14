CREATE TABLE `sales_payment_allocations` (
	`id` text PRIMARY KEY NOT NULL,
	`payment_document_id` text NOT NULL,
	`invoice_document_id` text NOT NULL,
	`amount` integer NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_sales_payment_allocation_payment` ON `sales_payment_allocations` (`payment_document_id`);--> statement-breakpoint
CREATE INDEX `idx_sales_payment_allocation_invoice` ON `sales_payment_allocations` (`invoice_document_id`);