CREATE TABLE `erp_workbench_preferences` (
  `id` text PRIMARY KEY NOT NULL,
  `employee_id` text NOT NULL,
  `item_type` text NOT NULL,
  `item_id` text NOT NULL,
  `pinned` integer NOT NULL DEFAULT 0,
  `snoozed_until` text NOT NULL DEFAULT '',
  `note` text NOT NULL DEFAULT '',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE UNIQUE INDEX `idx_erp_workbench_preference_item`
ON `erp_workbench_preferences` (`employee_id`, `item_type`, `item_id`);

CREATE INDEX `idx_erp_workbench_preference_focus`
ON `erp_workbench_preferences` (`employee_id`, `pinned`, `snoozed_until`);
