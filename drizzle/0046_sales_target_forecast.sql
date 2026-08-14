CREATE TABLE IF NOT EXISTS `sales_target_plans` (
  `id` text PRIMARY KEY NOT NULL,
  `year` integer NOT NULL,
  `version` integer NOT NULL,
  `name` text NOT NULL,
  `status` text NOT NULL DEFAULT 'DRAFT',
  `created_by` text NOT NULL,
  `approved_by` text NOT NULL DEFAULT '',
  `approved_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_sales_target_plan_year_version`
ON `sales_target_plans` (`year`, `version`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_sales_target_plan_year_approved`
ON `sales_target_plans` (`year`) WHERE `status` = 'APPROVED';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sales_target_lines` (
  `id` text PRIMARY KEY NOT NULL,
  `plan_id` text NOT NULL,
  `scope_type` text NOT NULL,
  `scope_key` text NOT NULL,
  `scope_name` text NOT NULL,
  `period` text NOT NULL,
  `target_revenue` integer NOT NULL DEFAULT 0,
  `target_gross_profit` integer NOT NULL DEFAULT 0,
  `target_orders` integer NOT NULL DEFAULT 0,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_sales_target_line_scope_period`
ON `sales_target_lines` (`plan_id`, `scope_type`, `scope_key`, `period`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sales_target_line_plan_period`
ON `sales_target_lines` (`plan_id`, `period`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sales_forecast_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `plan_id` text NOT NULL,
  `as_of_date` text NOT NULL,
  `version` integer NOT NULL,
  `formula_version` text NOT NULL,
  `snapshot_json` text NOT NULL,
  `created_by` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_sales_forecast_plan_date_version`
ON `sales_forecast_snapshots` (`plan_id`, `as_of_date`, `version`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sales_forecast_plan_created`
ON `sales_forecast_snapshots` (`plan_id`, `created_at`);
--> statement-breakpoint
PRAGMA optimize;
