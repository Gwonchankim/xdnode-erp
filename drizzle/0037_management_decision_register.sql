ALTER TABLE `finance_management_report_actions` ADD COLUMN `decision_id` text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX `idx_finance_management_action_decision`
ON `finance_management_report_actions` (`decision_id`)
WHERE `decision_id` <> '';

CREATE TABLE `finance_management_decisions` (
  `id` text PRIMARY KEY NOT NULL,
  `report_id` text NOT NULL,
  `source_section` text NOT NULL DEFAULT 'GENERAL',
  `decision_type` text NOT NULL DEFAULT 'OTHER',
  `title` text NOT NULL,
  `proposal` text NOT NULL,
  `financial_impact` integer NOT NULL DEFAULT 0,
  `owner_employee_id` text NOT NULL DEFAULT '',
  `decision_due_date` text NOT NULL DEFAULT '',
  `requires_action` integer NOT NULL DEFAULT 0,
  `status` text NOT NULL DEFAULT 'DRAFT',
  `resolution_note` text NOT NULL DEFAULT '',
  `resolved_by` text NOT NULL DEFAULT '',
  `resolved_at` integer,
  `action_id` text NOT NULL DEFAULT '',
  `created_by` text NOT NULL,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE INDEX `idx_finance_management_decision_report_status`
ON `finance_management_decisions` (`report_id`, `status`, `decision_due_date`);

CREATE INDEX `idx_finance_management_decision_owner_due`
ON `finance_management_decisions` (`owner_employee_id`, `status`, `decision_due_date`);
