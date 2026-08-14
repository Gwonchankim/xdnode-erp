CREATE TABLE `finance_tax_periods` (
	`period` text PRIMARY KEY NOT NULL,
	`source_as_of` text NOT NULL,
	`source_sales_supply` integer DEFAULT 0 NOT NULL,
	`source_purchase_supply` integer DEFAULT 0 NOT NULL,
	`source_sales_documents` integer DEFAULT 0 NOT NULL,
	`source_purchase_documents` integer DEFAULT 0 NOT NULL,
	`declared_sales_supply` integer DEFAULT 0 NOT NULL,
	`declared_purchase_supply` integer DEFAULT 0 NOT NULL,
	`output_tax` integer DEFAULT 0 NOT NULL,
	`deductible_input_tax` integer DEFAULT 0 NOT NULL,
	`nondeductible_input_tax` integer DEFAULT 0 NOT NULL,
	`adjustment_tax` integer DEFAULT 0 NOT NULL,
	`payable_tax` integer DEFAULT 0 NOT NULL,
	`figures_confirmed` integer DEFAULT 0 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`prepared_by` text NOT NULL,
	`reviewed_by` text DEFAULT '' NOT NULL,
	`reviewed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_finance_tax_status_period` ON `finance_tax_periods` (`status`,`period`);
