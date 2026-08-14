ALTER TABLE `finance_purchase_invoices` ADD `vendor_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
UPDATE `finance_purchase_invoices` SET `vendor_id` = COALESCE((
	SELECT `vendor_id` FROM `finance_purchase_orders` WHERE `finance_purchase_orders`.`id` = `finance_purchase_invoices`.`order_id`
), '') WHERE `vendor_id` = '';
--> statement-breakpoint
DROP INDEX IF EXISTS `idx_finance_purchase_invoice_number`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_purchase_invoice_vendor_number` ON `finance_purchase_invoices` (`vendor_id`,`invoice_number`);
--> statement-breakpoint
CREATE TABLE `finance_payable_plans` (
	`invoice_id` text PRIMARY KEY NOT NULL,
	`plan_status` text DEFAULT 'SCHEDULED' NOT NULL,
	`planned_payment_date` text DEFAULT '' NOT NULL,
	`priority` text DEFAULT 'NORMAL' NOT NULL,
	`owner_employee_id` text DEFAULT '' NOT NULL,
	`hold_reason` text DEFAULT '' NOT NULL,
	`memo` text DEFAULT '' NOT NULL,
	`updated_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_finance_payable_plan_status_date` ON `finance_payable_plans` (`plan_status`,`planned_payment_date`);
--> statement-breakpoint
CREATE INDEX `idx_finance_payable_plan_owner_priority` ON `finance_payable_plans` (`owner_employee_id`,`priority`);
