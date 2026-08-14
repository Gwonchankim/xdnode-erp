CREATE TABLE IF NOT EXISTS `sales_account_identity_keys` (
  `identity_key` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL,
  `is_primary` integer NOT NULL DEFAULT 1,
  `origin_account_id` text NOT NULL DEFAULT '',
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sales_account_identity_account`
ON `sales_account_identity_keys` (`account_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_sales_account_identity_primary`
ON `sales_account_identity_keys` (`account_id`) WHERE `is_primary` = 1;
--> statement-breakpoint
INSERT OR IGNORE INTO `sales_account_identity_keys`
  (`identity_key`, `account_id`, `is_primary`, `origin_account_id`, `created_at`)
SELECT
  CASE
    WHEN replace(replace(replace(trim(`business_number`), '-', ''), ' ', ''), '.', '') <> ''
      THEN 'business:' || replace(replace(replace(trim(`business_number`), '-', ''), ' ', ''), '.', '')
    ELSE 'name:' || lower(replace(replace(replace(replace(replace(replace(replace(trim(`name`), ' ', ''), '-', ''), '.', ''), '(', ''), ')', ''), '㈜', ''), '/', ''))
  END,
  `id`, 1, `id`, `created_at`
FROM `sales_accounts`
WHERE `deleted_at` IS NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sales_account_owner_history` (
  `id` text PRIMARY KEY NOT NULL,
  `account_id` text NOT NULL,
  `from_owner_employee_id` text NOT NULL DEFAULT '',
  `to_owner_employee_id` text NOT NULL,
  `reason` text NOT NULL,
  `changed_by` text NOT NULL,
  `changed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_sales_account_owner_history_account_changed`
ON `sales_account_owner_history` (`account_id`, `changed_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sales_account_merges` (
  `id` text PRIMARY KEY NOT NULL,
  `source_account_id` text NOT NULL,
  `target_account_id` text NOT NULL,
  `reason` text NOT NULL,
  `merged_by` text NOT NULL,
  `merged_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_sales_account_merge_source`
ON `sales_account_merges` (`source_account_id`);
--> statement-breakpoint
UPDATE `sales_account_contacts`
SET `is_primary` = 0
WHERE `is_primary` = 1
  AND `id` NOT IN (
    SELECT MIN(`id`) FROM `sales_account_contacts`
    WHERE `is_primary` = 1 AND `status` = 'ACTIVE'
    GROUP BY `account_id`
  );
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `idx_sales_contact_single_primary`
ON `sales_account_contacts` (`account_id`)
WHERE `is_primary` = 1 AND `status` = 'ACTIVE';
--> statement-breakpoint
PRAGMA optimize;
