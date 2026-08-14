CREATE TABLE `inventory_products` (
	`id` text PRIMARY KEY NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT '' NOT NULL,
	`unit` text DEFAULT 'EA' NOT NULL,
	`minimum_stock_milli` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_product_sku` ON `inventory_products` (`sku`);
--> statement-breakpoint
CREATE INDEX `idx_inventory_product_status_name` ON `inventory_products` (`status`,`name`);
--> statement-breakpoint
CREATE TABLE `inventory_warehouses` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_warehouse_code` ON `inventory_warehouses` (`code`);
--> statement-breakpoint
CREATE INDEX `idx_inventory_warehouse_status_name` ON `inventory_warehouses` (`status`,`name`);
--> statement-breakpoint
CREATE TABLE `inventory_movements` (
	`id` text PRIMARY KEY NOT NULL,
	`movement_date` text NOT NULL,
	`movement_type` text NOT NULL,
	`direction` text NOT NULL,
	`product_id` text NOT NULL,
	`warehouse_id` text NOT NULL,
	`quantity_milli` integer NOT NULL,
	`unit_cost` integer NOT NULL,
	`amount` integer NOT NULL,
	`source_type` text NOT NULL,
	`source_id` text NOT NULL,
	`source_line_key` text NOT NULL,
	`reference_number` text DEFAULT '' NOT NULL,
	`reason` text DEFAULT '' NOT NULL,
	`posted_by` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_inventory_movement_source_line` ON `inventory_movements` (`source_type`,`source_id`,`source_line_key`);
--> statement-breakpoint
CREATE INDEX `idx_inventory_movement_product_warehouse_date` ON `inventory_movements` (`product_id`,`warehouse_id`,`movement_date`);
--> statement-breakpoint
CREATE INDEX `idx_inventory_movement_date_type` ON `inventory_movements` (`movement_date`,`movement_type`);
