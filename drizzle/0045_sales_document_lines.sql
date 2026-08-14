ALTER TABLE `sales_documents` ADD `source_document_id` text NOT NULL DEFAULT '';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sales_documents_source`
ON `sales_documents` (`source_document_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sales_catalog_items` (
  `id` text PRIMARY KEY NOT NULL,
  `code` text NOT NULL,
  `name` text NOT NULL,
  `item_type` text NOT NULL,
  `unit` text NOT NULL DEFAULT 'EA',
  `default_unit_price` integer NOT NULL DEFAULT 0,
  `status` text NOT NULL DEFAULT 'ACTIVE',
  `created_by` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_sales_catalog_code`
ON `sales_catalog_items` (`code`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sales_catalog_status_name`
ON `sales_catalog_items` (`status`, `name`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sales_document_lines` (
  `id` text PRIMARY KEY NOT NULL,
  `document_id` text NOT NULL,
  `line_number` integer NOT NULL,
  `catalog_item_id` text NOT NULL,
  `description` text NOT NULL,
  `quantity` real NOT NULL,
  `unit` text NOT NULL,
  `unit_price` integer NOT NULL,
  `amount` integer NOT NULL,
  `source_line_id` text NOT NULL DEFAULT '',
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_sales_document_line_number`
ON `sales_document_lines` (`document_id`, `line_number`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sales_document_line_source`
ON `sales_document_lines` (`source_line_id`);
--> statement-breakpoint
PRAGMA optimize;
