CREATE TABLE IF NOT EXISTS `sales_price_lists` (
  `id` text PRIMARY KEY NOT NULL, `name` text NOT NULL, `version` integer NOT NULL,
  `currency` text NOT NULL DEFAULT 'KRW', `effective_from` text NOT NULL, `effective_to` text NOT NULL DEFAULT '',
  `status` text NOT NULL DEFAULT 'DRAFT', `created_by` text NOT NULL, `approved_by` text NOT NULL DEFAULT '',
  `approved_at` integer, `created_at` integer NOT NULL, `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_sales_price_list_name_version` ON `sales_price_lists` (`name`, `version`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_sales_price_list_single_active` ON `sales_price_lists` (`status`) WHERE `status` = 'ACTIVE';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sales_price_list_items` (
  `id` text PRIMARY KEY NOT NULL, `price_list_id` text NOT NULL, `catalog_item_id` text NOT NULL,
  `list_unit_price` integer NOT NULL, `standard_unit_cost` integer NOT NULL, `min_unit_price` integer NOT NULL,
  `created_at` integer NOT NULL, `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_sales_price_item_list_catalog` ON `sales_price_list_items` (`price_list_id`, `catalog_item_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sales_pricing_policies` (
  `id` text PRIMARY KEY NOT NULL, `name` text NOT NULL, `version` integer NOT NULL,
  `max_discount_bps` integer NOT NULL, `min_gross_margin_bps` integer NOT NULL,
  `status` text NOT NULL DEFAULT 'DRAFT', `created_by` text NOT NULL, `approved_by` text NOT NULL DEFAULT '',
  `approved_at` integer, `created_at` integer NOT NULL, `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_sales_pricing_policy_name_version` ON `sales_pricing_policies` (`name`, `version`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_sales_pricing_policy_single_active` ON `sales_pricing_policies` (`status`) WHERE `status` = 'ACTIVE';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sales_document_pricing_reviews` (
  `document_id` text PRIMARY KEY NOT NULL, `document_type` text NOT NULL,
  `price_list_id` text NOT NULL DEFAULT '', `policy_id` text NOT NULL DEFAULT '',
  `price_list_version` integer NOT NULL DEFAULT 0, `policy_version` integer NOT NULL DEFAULT 0,
  `list_amount` integer NOT NULL DEFAULT 0, `quoted_amount` integer NOT NULL DEFAULT 0,
  `standard_cost_amount` integer NOT NULL DEFAULT 0, `minimum_amount` integer NOT NULL DEFAULT 0,
  `discount_bps` integer NOT NULL DEFAULT 0, `gross_margin_bps` integer NOT NULL DEFAULT 0,
  `outcome` text NOT NULL, `reasons_json` text NOT NULL DEFAULT '[]', `evaluated_by` text NOT NULL,
  `approval_request_id` text NOT NULL DEFAULT '', `reviewed_by` text NOT NULL DEFAULT '', `reviewed_at` integer,
  `snapshot_json` text NOT NULL DEFAULT '{}', `created_at` integer NOT NULL, `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sales_pricing_review_outcome` ON `sales_document_pricing_reviews` (`outcome`, `updated_at`);
--> statement-breakpoint
PRAGMA optimize;
