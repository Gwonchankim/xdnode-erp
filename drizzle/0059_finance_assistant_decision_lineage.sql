ALTER TABLE `finance_management_decisions` ADD `source_assistant_answer_id` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `finance_management_decisions` ADD `source_answer_hash` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `finance_management_decisions` ADD `source_evidence_hash` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `finance_management_decisions` ADD `source_basis_as_of` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `finance_management_decisions` ADD `source_evidence_status` text DEFAULT '' NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_finance_management_decision_assistant_source`
ON `finance_management_decisions` (`report_id`,`source_assistant_answer_id`)
WHERE `source_assistant_answer_id` <> '';
--> statement-breakpoint
PRAGMA optimize;
