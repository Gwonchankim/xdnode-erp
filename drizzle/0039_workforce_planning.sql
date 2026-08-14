CREATE TABLE `hr_workforce_plans` (
  `id` text PRIMARY KEY NOT NULL,
  `period` text NOT NULL,
  `version` integer NOT NULL DEFAULT 1,
  `title` text NOT NULL,
  `assumptions` text NOT NULL DEFAULT '',
  `status` text NOT NULL DEFAULT 'DRAFT',
  `revision_reason` text NOT NULL DEFAULT '',
  `created_by` text NOT NULL,
  `submitted_at` integer,
  `approved_by` text NOT NULL DEFAULT '',
  `approved_at` integer,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE UNIQUE INDEX `idx_hr_workforce_plan_period_version`
ON `hr_workforce_plans` (`period`, `version`);

CREATE INDEX `idx_hr_workforce_plan_period_status`
ON `hr_workforce_plans` (`period`, `status`);

CREATE TABLE `hr_workforce_plan_lines` (
  `id` text PRIMARY KEY NOT NULL,
  `plan_id` text NOT NULL,
  `organization_id` text NOT NULL,
  `approved_headcount` integer NOT NULL DEFAULT 0,
  `planned_exits` integer NOT NULL DEFAULT 0,
  `note` text NOT NULL DEFAULT '',
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);

CREATE UNIQUE INDEX `idx_hr_workforce_plan_line_org`
ON `hr_workforce_plan_lines` (`plan_id`, `organization_id`);

