import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const employeeInterviewRecords = sqliteTable("employee_interview_records", {
  id: text("id").primaryKey(),
  employeeId: text("employee_id").notNull(),
  interviewAt: text("interview_at").notNull(),
  transcript: text("transcript").notNull().default(""),
  memo: text("memo").notNull().default(""),
  audioKey: text("audio_key"),
  audioContentType: text("audio_content_type"),
  audioFileName: text("audio_file_name"),
  consentConfirmedBy: text("consent_confirmed_by").notNull().default(""),
  consentConfirmedAt: integer("consent_confirmed_at"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("idx_employee_interview_records_employee_created").on(table.employeeId, table.createdAt),
]);

export const applicantInterviewRecordings = sqliteTable("applicant_interview_recordings", {
  id: text("id").primaryKey(),
  applicantId: text("applicant_id").notNull(),
  recordedAt: text("recorded_at").notNull(),
  audioKey: text("audio_key").notNull(),
  audioContentType: text("audio_content_type").notNull(),
  audioFileName: text("audio_file_name").notNull(),
  consentConfirmedBy: text("consent_confirmed_by").notNull().default(""),
  consentConfirmedAt: integer("consent_confirmed_at"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("idx_applicant_interview_recordings_applicant_created").on(table.applicantId, table.createdAt),
]);

export const hrAudioTranscriptions = sqliteTable("hr_audio_transcriptions", {
  id: text("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  audioKeySnapshot: text("audio_key_snapshot").notNull(),
  audioContentType: text("audio_content_type").notNull(),
  status: text("status").notNull().default("PROCESSING"),
  model: text("model").notNull(),
  language: text("language").notNull().default("ko"),
  transcript: text("transcript").notNull().default(""),
  vtt: text("vtt").notNull().default(""),
  wordCount: integer("word_count").notNull().default(0),
  errorCode: text("error_code").notNull().default(""),
  errorMessage: text("error_message").notNull().default(""),
  attempt: integer("attempt").notNull().default(1),
  consentConfirmedBy: text("consent_confirmed_by").notNull(),
  consentConfirmedAt: integer("consent_confirmed_at").notNull(),
  requestedBy: text("requested_by").notNull(),
  requestedAt: integer("requested_at").notNull(),
  completedAt: integer("completed_at"),
  reviewedText: text("reviewed_text").notNull().default(""),
  reviewNote: text("review_note").notNull().default(""),
  reviewedBy: text("reviewed_by").notNull().default(""),
  reviewedAt: integer("reviewed_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_hr_audio_transcription_entity_attempt").on(table.entityType, table.entityId, table.attempt),
  index("idx_hr_audio_transcription_entity_created").on(table.entityType, table.entityId, table.createdAt),
  index("idx_hr_audio_transcription_status_updated").on(table.status, table.updatedAt),
]);

export const hrOrganizationLeaders = sqliteTable("hr_organization_leaders", {
  organizationId: text("organization_id").primaryKey(),
  leaderEmployeeId: text("leader_employee_id"),
  updatedAt: integer("updated_at").notNull(),
});

export const hrOrganizationRecords = sqliteTable("hr_organization_records", {
  organizationId: text("organization_id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const hrEmployeeRecords = sqliteTable("hr_employee_records", {
  employeeId: text("employee_id").primaryKey(),
  name: text("name").notNull(),
  birth: text("birth").notNull(),
  email: text("email").notNull(),
  phone: text("phone").notNull(),
  address: text("address").notNull(),
  department: text("department").notNull(),
  manager: text("manager").notNull(),
  employmentType: text("employment_type").notNull(),
  joinDate: text("join_date").notNull().default(""),
  position: text("position").notNull(),
  jobTitle: text("job_title").notNull(),
  status: text("status").notNull().default("재직"),
  historyJson: text("history_json").notNull().default("[]"),
  retirementJson: text("retirement_json"),
  updatedAt: integer("updated_at").notNull(),
});

export const hrAuthorizedUsers = sqliteTable("hr_authorized_users", {
  employeeId: text("employee_id").primaryKey(),
  createdAt: integer("created_at").notNull(),
});

export const hrRecruiters = sqliteTable("hr_recruiters", {
  employeeId: text("employee_id").primaryKey(),
  createdAt: integer("created_at").notNull(),
});

export const hrApplicants = sqliteTable("hr_applicants", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  applied: text("applied").notNull(),
  ownerId: text("owner_id").notNull().default(""),
  stage: text("stage").notNull(),
  experience: text("experience").notNull().default(""),
  email: text("email").notNull(),
  phone: text("phone").notNull().default(""),
  source: text("source").notNull(),
  summary: text("summary").notNull().default(""),
  resumeFileName: text("resume_file_name").notNull().default(""),
  resumeText: text("resume_text").notNull().default(""),
  checklistJson: text("checklist_json").notNull().default("[]"),
  screeningMemosJson: text("screening_memos_json").notNull().default("[]"),
  interviewJson: text("interview_json"),
  interviewMemosJson: text("interview_memos_json").notNull().default("[]"),
  requisitionId: text("requisition_id").notNull().default(""),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_hr_applicants_name").on(table.name),
  index("idx_hr_applicants_email").on(table.email),
  index("idx_hr_applicants_phone").on(table.phone),
  index("idx_hr_applicants_requisition").on(table.requisitionId),
]);

export const hrPayrollRecords = sqliteTable("hr_payroll_records", {
  id: text("id").primaryKey(),
  yearMonth: text("year_month").notNull(),
  employeeId: text("employee_id"),
  employeeName: text("employee_name").notNull(),
  department: text("department"),
  annualSalary: integer("annual_salary").notNull(),
  basePay: integer("base_pay").notNull(),
  mealAllowance: integer("meal_allowance").notNull(),
  childcareAllowance: integer("childcare_allowance").notNull(),
  vehicleAllowance: integer("vehicle_allowance").notNull(),
  incentive: integer("incentive").notNull(),
  bonus: integer("bonus").notNull(),
  annualLeavePay: integer("annual_leave_pay").notNull(),
  retirementPay: integer("retirement_pay").notNull(),
  deductions: integer("deductions").notNull(),
  grossPay: integer("gross_pay").notNull(),
  netPay: integer("net_pay").notNull(),
  cardAllowance: integer("card_allowance").notNull(),
  cardUsage: integer("card_usage").notNull(),
  personalPurchase: integer("personal_purchase").notNull(),
  nonTaxable: integer("non_taxable").notNull(),
  welfareFund: integer("welfare_fund").notNull(),
  notes: text("notes").notNull().default(""),
  sourceSheet: text("source_sheet").notNull(),
  sourceRow: integer("source_row").notNull(),
  importedAt: integer("imported_at").notNull(),
}, (table) => [
  index("idx_hr_payroll_records_month_name").on(table.yearMonth, table.employeeName),
]);

export const financeReceivableManagement = sqliteTable("finance_receivable_management", {
  partnerName: text("partner_name").primaryKey(),
  outstandingAmount: integer("outstanding_amount").notNull(),
  owner: text("owner").notNull().default(""),
  dueDate: text("due_date").notNull().default(""),
  status: text("status").notNull().default("UNSET"),
  memo: text("memo").notNull().default(""),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_finance_receivable_status_due").on(table.status, table.dueDate),
]);

export const financeReceivableCases = sqliteTable("finance_receivable_cases", {
  invoiceId: text("invoice_id").primaryKey(),
  collectionStatus: text("collection_status").notNull().default("OPEN"),
  ownerEmployeeId: text("owner_employee_id").notNull().default(""),
  promisedDate: text("promised_date").notNull().default(""),
  promisedAmount: integer("promised_amount").notNull().default(0),
  disputeReason: text("dispute_reason").notNull().default(""),
  nextAction: text("next_action").notNull().default(""),
  nextActionDate: text("next_action_date").notNull().default(""),
  memo: text("memo").notNull().default(""),
  updatedBy: text("updated_by").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_finance_receivable_case_status_promise").on(table.collectionStatus, table.promisedDate),
  index("idx_finance_receivable_case_owner_action").on(table.ownerEmployeeId, table.nextActionDate),
]);

export const financeReceivableNotes = sqliteTable("finance_receivable_notes", {
  id: text("id").primaryKey(),
  invoiceId: text("invoice_id").notNull(),
  noteType: text("note_type").notNull().default("GENERAL"),
  content: text("content").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("idx_finance_receivable_note_invoice_created").on(table.invoiceId, table.createdAt),
]);

export const erpUserAccess = sqliteTable("erp_user_access", {
  employeeId: text("employee_id").primaryKey(),
  email: text("email").notNull().unique(),
  rolesJson: text("roles_json").notNull().default("[]"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const erpApprovalPolicies = sqliteTable("erp_approval_policies", {
  id: text("id").primaryKey(),
  module: text("module").notNull(),
  requestType: text("request_type").notNull(),
  name: text("name").notNull(),
  minAmount: integer("min_amount").notNull().default(0),
  maxAmount: integer("max_amount"),
  priority: integer("priority").notNull().default(0),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_erp_approval_policy_match").on(table.module, table.requestType, table.active, table.minAmount),
]);

export const erpApprovalPolicySteps = sqliteTable("erp_approval_policy_steps", {
  id: text("id").primaryKey(),
  policyId: text("policy_id").notNull(),
  stepOrder: integer("step_order").notNull(),
  stepName: text("step_name").notNull(),
  approverRole: text("approver_role").notNull().default(""),
  approverEmployeeId: text("approver_employee_id").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_erp_approval_policy_step_order").on(table.policyId, table.stepOrder),
]);

export const erpApprovalDelegations = sqliteTable("erp_approval_delegations", {
  id: text("id").primaryKey(),
  delegatorEmployeeId: text("delegator_employee_id").notNull(),
  delegateEmployeeId: text("delegate_employee_id").notNull(),
  module: text("module").notNull().default("all"),
  startsOn: text("starts_on").notNull(),
  endsOn: text("ends_on").notNull(),
  reason: text("reason").notNull(),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_erp_approval_delegation_active_dates").on(table.delegatorEmployeeId, table.active, table.startsOn, table.endsOn),
  index("idx_erp_approval_delegation_delegate").on(table.delegateEmployeeId, table.active, table.endsOn),
]);

export const erpAuditLogs = sqliteTable("erp_audit_logs", {
  id: text("id").primaryKey(),
  actorUserId: text("actor_user_id").notNull(),
  actorEmail: text("actor_email").notNull(),
  actorEmployeeId: text("actor_employee_id").notNull(),
  module: text("module").notNull(),
  action: text("action").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  beforeJson: text("before_json"),
  afterJson: text("after_json"),
  reason: text("reason").notNull().default(""),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("idx_erp_audit_module_created").on(table.module, table.createdAt),
  index("idx_erp_audit_entity").on(table.entityType, table.entityId),
]);

export const erpDataControlRuns = sqliteTable("erp_data_control_runs", {
  id: text("id").primaryKey(),
  status: text("status").notNull().default("RUNNING"),
  requestedBy: text("requested_by").notNull(),
  checkCount: integer("check_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  warningCount: integer("warning_count").notNull().default(0),
  summaryJson: text("summary_json").notNull().default("{}"),
  startedAt: integer("started_at").notNull(),
  completedAt: integer("completed_at"),
  createdAt: integer("created_at").notNull(),
}, (table) => [index("idx_erp_data_control_run_created").on(table.createdAt)]);

export const erpDataControlChecks = sqliteTable("erp_data_control_checks", {
  id: text("id").primaryKey(),
  runId: text("run_id").notNull(),
  checkCode: text("check_code").notNull(),
  category: text("category").notNull(),
  status: text("status").notNull(),
  title: text("title").notNull(),
  detail: text("detail").notNull().default(""),
  evidenceJson: text("evidence_json").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_erp_data_control_check_run_code").on(table.runId, table.checkCode),
  index("idx_erp_data_control_check_status").on(table.status, table.createdAt),
]);

export const erpLogicalSnapshots = sqliteTable("erp_logical_snapshots", {
  id: text("id").primaryKey(),
  scope: text("scope").notNull(),
  status: text("status").notNull().default("CREATING"),
  objectKey: text("object_key").notNull().default(""),
  fileName: text("file_name").notNull().default(""),
  contentType: text("content_type").notNull().default("application/json"),
  sha256: text("sha256").notNull().default(""),
  byteSize: integer("byte_size").notNull().default(0),
  tableCount: integer("table_count").notNull().default(0),
  rowCount: integer("row_count").notNull().default(0),
  manifestJson: text("manifest_json").notNull().default("{}"),
  requestedBy: text("requested_by").notNull(),
  createdAt: integer("created_at").notNull(),
  verifiedAt: integer("verified_at"),
  verifiedBy: text("verified_by").notNull().default(""),
  verificationStatus: text("verification_status").notNull().default("PENDING"),
  verificationDetail: text("verification_detail").notNull().default(""),
  failureMessage: text("failure_message").notNull().default(""),
}, (table) => [
  index("idx_erp_logical_snapshot_created").on(table.createdAt),
  index("idx_erp_logical_snapshot_status").on(table.status, table.verificationStatus),
]);

export const erpRecoveryRehearsals = sqliteTable("erp_recovery_rehearsals", {
  id: text("id").primaryKey(),
  snapshotId: text("snapshot_id").notNull(),
  status: text("status").notNull(),
  checkCount: integer("check_count").notNull().default(0),
  failureCount: integer("failure_count").notNull().default(0),
  detailJson: text("detail_json").notNull().default("{}"),
  performedBy: text("performed_by").notNull(),
  performedAt: integer("performed_at").notNull(),
}, (table) => [index("idx_erp_recovery_rehearsal_snapshot").on(table.snapshotId, table.performedAt)]);

export const erpAuditExports = sqliteTable("erp_audit_exports", {
  id: text("id").primaryKey(),
  dateFrom: text("date_from").notNull(),
  dateTo: text("date_to").notNull(),
  module: text("module").notNull().default("ALL"),
  status: text("status").notNull().default("CREATING"),
  objectKey: text("object_key").notNull().default(""),
  fileName: text("file_name").notNull().default(""),
  sha256: text("sha256").notNull().default(""),
  byteSize: integer("byte_size").notNull().default(0),
  rowCount: integer("row_count").notNull().default(0),
  requestedBy: text("requested_by").notNull(),
  createdAt: integer("created_at").notNull(),
  failureMessage: text("failure_message").notNull().default(""),
}, (table) => [index("idx_erp_audit_export_created").on(table.createdAt)]);

export const erpRetentionPolicies = sqliteTable("erp_retention_policies", {
  id: text("id").primaryKey(),
  dataType: text("data_type").notNull().unique(),
  label: text("label").notNull(),
  retentionDays: integer("retention_days").notNull(),
  disposition: text("disposition").notNull().default("REVIEW_REQUIRED"),
  active: integer("active", { mode: "boolean" }).notNull().default(false),
  updatedBy: text("updated_by").notNull().default(""),
  updatedAt: integer("updated_at").notNull(),
});

export const erpTasks = sqliteTable("erp_tasks", {
  id: text("id").primaryKey(),
  module: text("module").notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  ownerEmployeeId: text("owner_employee_id").notNull().default(""),
  dueDate: text("due_date").notNull().default(""),
  status: text("status").notNull().default("OPEN"),
  priority: text("priority").notNull().default("NORMAL"),
  destination: text("destination").notNull().default(""),
  sourceType: text("source_type").notNull().default("MANUAL"),
  sourceId: text("source_id").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  completedAt: integer("completed_at"),
  deletedAt: integer("deleted_at"),
}, (table) => [
  index("idx_erp_tasks_owner_status_due").on(table.ownerEmployeeId, table.status, table.dueDate),
  index("idx_erp_tasks_module_status").on(table.module, table.status),
]);

export const erpWorkbenchPreferences = sqliteTable("erp_workbench_preferences", {
  id: text("id").primaryKey(),
  employeeId: text("employee_id").notNull(),
  itemType: text("item_type").notNull(),
  itemId: text("item_id").notNull(),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
  snoozedUntil: text("snoozed_until").notNull().default(""),
  note: text("note").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_erp_workbench_preference_item").on(table.employeeId, table.itemType, table.itemId),
  index("idx_erp_workbench_preference_focus").on(table.employeeId, table.pinned, table.snoozedUntil),
]);

export const erpApprovalRequests = sqliteTable("erp_approval_requests", {
  id: text("id").primaryKey(),
  module: text("module").notNull(),
  requestType: text("request_type").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  requesterEmployeeId: text("requester_employee_id").notNull(),
  targetEntityType: text("target_entity_type").notNull().default(""),
  targetEntityId: text("target_entity_id").notNull().default(""),
  amount: integer("amount").notNull().default(0),
  currency: text("currency").notNull().default("KRW"),
  priority: text("priority").notNull().default("NORMAL"),
  status: text("status").notNull().default("SUBMITTED"),
  currentStep: integer("current_step").notNull().default(1),
  dueDate: text("due_date").notNull().default(""),
  metadataJson: text("metadata_json").notNull().default("{}"),
  version: integer("version").notNull().default(1),
  transitionToken: text("transition_token").notNull().default(""),
  submittedAt: integer("submitted_at").notNull(),
  decidedAt: integer("decided_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_erp_approval_requester_status").on(table.requesterEmployeeId, table.status, table.updatedAt),
  index("idx_erp_approval_module_status").on(table.module, table.status, table.updatedAt),
  index("idx_erp_approval_target").on(table.targetEntityType, table.targetEntityId),
]);

export const erpApprovalSteps = sqliteTable("erp_approval_steps", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull(),
  stepOrder: integer("step_order").notNull(),
  stepName: text("step_name").notNull(),
  approverRole: text("approver_role").notNull(),
  approverEmployeeId: text("approver_employee_id").notNull().default(""),
  delegatedFromEmployeeId: text("delegated_from_employee_id").notNull().default(""),
  status: text("status").notNull().default("WAITING"),
  comment: text("comment").notNull().default(""),
  actedBy: text("acted_by").notNull().default(""),
  actedAt: integer("acted_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_erp_approval_step_request_order").on(table.requestId, table.stepOrder),
  index("idx_erp_approval_step_approver_status").on(table.approverEmployeeId, table.status),
]);

export const erpApprovalEvents = sqliteTable("erp_approval_events", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull(),
  stepOrder: integer("step_order").notNull().default(0),
  action: text("action").notNull(),
  actorEmployeeId: text("actor_employee_id").notNull(),
  comment: text("comment").notNull().default(""),
  snapshotJson: text("snapshot_json").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("idx_erp_approval_event_request_created").on(table.requestId, table.createdAt),
]);

export const erpSyncRuns = sqliteTable("erp_sync_runs", {
  id: text("id").primaryKey(),
  source: text("source").notNull(),
  scope: text("scope").notNull(),
  snapshotDate: text("snapshot_date").notNull(),
  status: text("status").notNull(),
  recordCount: integer("record_count").notNull().default(0),
  metricsJson: text("metrics_json").notNull().default("{}"),
  errorMessage: text("error_message").notNull().default(""),
  startedAt: integer("started_at").notNull(),
  completedAt: integer("completed_at"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("idx_erp_sync_source_snapshot").on(table.source, table.snapshotDate),
  index("idx_erp_sync_status_created").on(table.status, table.createdAt),
]);

export const erpDocuments = sqliteTable("erp_documents", {
  id: text("id").primaryKey(),
  module: text("module").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  category: text("category").notNull(),
  version: integer("version").notNull().default(1),
  fileName: text("file_name").notNull(),
  contentType: text("content_type").notNull(),
  storageKey: text("storage_key").notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  createdAt: integer("created_at").notNull(),
  deletedAt: integer("deleted_at"),
}, (table) => [
  index("idx_erp_documents_entity").on(table.entityType, table.entityId),
]);

export const financeReconciliations = sqliteTable("finance_reconciliations", {
  id: text("id").primaryKey(),
  bankTransactionId: text("bank_transaction_id").notNull(),
  journalLineId: text("journal_line_id").notNull().default(""),
  transactionDate: text("transaction_date").notNull(),
  amount: integer("amount").notNull(),
  description: text("description").notNull().default(""),
  accountCode: text("account_code").notNull().default(""),
  matchScore: integer("match_score").notNull().default(0),
  status: text("status").notNull().default("UNMATCHED"),
  resolutionMemo: text("resolution_memo").notNull().default(""),
  resolvedBy: text("resolved_by").notNull().default(""),
  resolvedAt: integer("resolved_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_finance_reconciliation_status_date").on(table.status, table.transactionDate),
  index("idx_finance_reconciliation_bank_transaction").on(table.bankTransactionId),
]);

export const financeBankTransactions = sqliteTable("finance_bank_transactions", {
  id: text("id").primaryKey(),
  source: text("source").notNull().default("CLOBE"),
  sourceSnapshotDate: text("source_snapshot_date").notNull(),
  accountId: text("account_id").notNull(),
  bankCode: text("bank_code").notNull().default(""),
  bankName: text("bank_name").notNull().default(""),
  accountName: text("account_name").notNull().default(""),
  accountLast4: text("account_last4").notNull().default(""),
  currency: text("currency").notNull().default("KRW"),
  transactionAt: text("transaction_at").notNull(),
  transactionDate: text("transaction_date").notNull(),
  transactionType: text("transaction_type").notNull().default(""),
  description: text("description").notNull().default(""),
  direction: text("direction").notNull(),
  amount: integer("amount").notNull(),
  afterBalance: integer("after_balance").notNull().default(0),
  category: text("category").notNull().default(""),
  businessEntityName: text("business_entity_name").notNull().default(""),
  isUnclassified: integer("is_unclassified", { mode: "boolean" }).notNull().default(false),
  memo: text("memo").notNull().default(""),
  importedAt: integer("imported_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_finance_bank_transaction_date_direction").on(table.transactionDate, table.direction),
  index("idx_finance_bank_transaction_account_date").on(table.accountId, table.transactionDate),
  index("idx_finance_bank_transaction_unclassified").on(table.isUnclassified, table.transactionDate),
]);

export const financeCashMatches = sqliteTable("finance_cash_matches", {
  id: text("id").primaryKey(),
  matchGroupId: text("match_group_id").notNull(),
  bankTransactionId: text("bank_transaction_id").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  matchedAmount: integer("matched_amount").notNull(),
  matchScore: integer("match_score").notNull().default(0),
  matchMethod: text("match_method").notNull().default("MANUAL"),
  status: text("status").notNull().default("CONFIRMED"),
  memo: text("memo").notNull().default(""),
  confirmedBy: text("confirmed_by").notNull(),
  confirmedAt: integer("confirmed_at").notNull(),
  reversedBy: text("reversed_by").notNull().default(""),
  reversedAt: integer("reversed_at"),
  reversalReason: text("reversal_reason").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_finance_cash_match_unique_source").on(table.bankTransactionId, table.sourceType, table.sourceId),
  index("idx_finance_cash_match_bank_status").on(table.bankTransactionId, table.status),
  index("idx_finance_cash_match_source_status").on(table.sourceType, table.sourceId, table.status),
  index("idx_finance_cash_match_group").on(table.matchGroupId),
]);

export const financeCashForecastItems = sqliteTable("finance_cash_forecast_items", {
  id: text("id").primaryKey(),
  expectedDate: text("expected_date").notNull(),
  direction: text("direction").notNull(),
  category: text("category").notNull(),
  counterparty: text("counterparty").notNull().default(""),
  amount: integer("amount").notNull(),
  probability: integer("probability").notNull().default(100),
  scenario: text("scenario").notNull().default("BASE"),
  sourceType: text("source_type").notNull().default("MANUAL"),
  sourceId: text("source_id").notNull().default(""),
  memo: text("memo").notNull().default(""),
  status: text("status").notNull().default("EXPECTED"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_finance_cash_forecast_scenario_date").on(table.scenario, table.expectedDate),
  index("idx_finance_cash_forecast_status_date").on(table.status, table.expectedDate),
]);

export const financeCashForecastSettings = sqliteTable("finance_cash_forecast_settings", {
  id: text("id").primaryKey(),
  minimumCashBalance: integer("minimum_cash_balance").notNull().default(0),
  includeFx: integer("include_fx", { mode: "boolean" }).notNull().default(false),
  defaultScenario: text("default_scenario").notNull().default("BASE"),
  collectionProbability: integer("collection_probability").notNull().default(85),
  riskPolicyConfigured: integer("risk_policy_configured", { mode: "boolean" }).notNull().default(false),
  riskPolicyVersion: integer("risk_policy_version").notNull().default(1),
  minimumDebtCoverageBps: integer("minimum_debt_coverage_bps").notNull().default(12500),
  maximumFxConcentrationBps: integer("maximum_fx_concentration_bps").notNull().default(5000),
  warningDrawdownBps: integer("warning_drawdown_bps").notNull().default(2000),
  criticalDrawdownBps: integer("critical_drawdown_bps").notNull().default(3500),
  lowBalanceThreshold: integer("low_balance_threshold").notNull().default(100000),
  updatedBy: text("updated_by").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const financeAlertCases = sqliteTable("finance_alert_cases", {
  id: text("id").primaryKey(),
  taskId: text("task_id").notNull(),
  taskSourceId: text("task_source_id").notNull(),
  sourceDestination: text("source_destination").notNull().default(""),
  titleSnapshot: text("title_snapshot").notNull(),
  descriptionSnapshot: text("description_snapshot").notNull().default(""),
  prioritySnapshot: text("priority_snapshot").notNull().default("NORMAL"),
  ownerEmployeeId: text("owner_employee_id").notNull().default(""),
  dueDate: text("due_date").notNull().default(""),
  status: text("status").notNull().default("OPEN"),
  rootCause: text("root_cause").notNull().default(""),
  impactAssessment: text("impact_assessment").notNull().default(""),
  actionPlan: text("action_plan").notNull().default(""),
  resolutionSummary: text("resolution_summary").notNull().default(""),
  submittedBy: text("submitted_by").notNull().default(""),
  submittedAt: integer("submitted_at"),
  reviewedBy: text("reviewed_by").notNull().default(""),
  reviewedAt: integer("reviewed_at"),
  reviewComment: text("review_comment").notNull().default(""),
  version: integer("version").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  closedAt: integer("closed_at"),
}, (table) => [
  uniqueIndex("idx_finance_alert_case_task_source").on(table.taskId, table.taskSourceId),
  index("idx_finance_alert_case_status_due").on(table.status, table.dueDate),
  index("idx_finance_alert_case_owner_status").on(table.ownerEmployeeId, table.status),
]);

export const financeAlertCaseEvents = sqliteTable("finance_alert_case_events", {
  id: text("id").primaryKey(),
  caseId: text("case_id").notNull(),
  action: text("action").notNull(),
  actorEmployeeId: text("actor_employee_id").notNull(),
  comment: text("comment").notNull().default(""),
  snapshotJson: text("snapshot_json").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("idx_finance_alert_case_event_case_created").on(table.caseId, table.createdAt),
]);

export const financeCashForecastSnapshots = sqliteTable("finance_cash_forecast_snapshots", {
  id: text("id").primaryKey(),
  asOf: text("as_of").notNull(),
  scenario: text("scenario").notNull(),
  openingCash: integer("opening_cash").notNull(),
  projectedEndingCash: integer("projected_ending_cash").notNull(),
  lowestCash: integer("lowest_cash").notNull(),
  minimumCashBalance: integer("minimum_cash_balance").notNull().default(0),
  lowWeekCount: integer("low_week_count").notNull().default(0),
  missingDateCount: integer("missing_date_count").notNull().default(0),
  bucketsJson: text("buckets_json").notNull().default("[]"),
  sourceCountsJson: text("source_counts_json").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_finance_cash_forecast_snapshot_asof_scenario").on(table.asOf, table.scenario),
  index("idx_finance_cash_forecast_snapshot_updated").on(table.updatedAt),
]);

export const financeCloseTasks = sqliteTable("finance_close_tasks", {
  id: text("id").primaryKey(),
  period: text("period").notNull(),
  category: text("category").notNull(),
  title: text("title").notNull(),
  ownerEmployeeId: text("owner_employee_id").notNull().default(""),
  status: text("status").notNull().default("OPEN"),
  evidenceDocumentId: text("evidence_document_id").notNull().default(""),
  completedAt: integer("completed_at"),
  approvedBy: text("approved_by").notNull().default(""),
  approvedAt: integer("approved_at"),
  reopenedReason: text("reopened_reason").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_finance_close_period_status").on(table.period, table.status),
]);

export const financeCloseRuns = sqliteTable("finance_close_runs", {
  period: text("period").primaryKey(),
  periodEnd: text("period_end").notNull(),
  status: text("status").notNull().default("OPEN"),
  controlPassCount: integer("control_pass_count").notNull().default(0),
  controlFailCount: integer("control_fail_count").notNull().default(0),
  manualCompletedCount: integer("manual_completed_count").notNull().default(0),
  manualTotalCount: integer("manual_total_count").notNull().default(0),
  evidenceCount: integer("evidence_count").notNull().default(0),
  snapshotJson: text("snapshot_json").notNull().default("{}"),
  submittedBy: text("submitted_by").notNull().default(""),
  submittedAt: integer("submitted_at"),
  closedBy: text("closed_by").notNull().default(""),
  closedAt: integer("closed_at"),
  reopenedBy: text("reopened_by").notNull().default(""),
  reopenedAt: integer("reopened_at"),
  reopenedReason: text("reopened_reason").notNull().default(""),
  version: integer("version").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_finance_close_run_status_period").on(table.status, table.period),
]);

export const financeBudgets = sqliteTable("finance_budgets", {
  id: text("id").primaryKey(),
  fiscalYear: integer("fiscal_year").notNull(),
  month: integer("month").notNull(),
  department: text("department").notNull(),
  accountCode: text("account_code").notNull(),
  accountName: text("account_name").notNull(),
  amount: integer("amount").notNull(),
  status: text("status").notNull().default("DRAFT"),
  version: integer("version").notNull().default(1),
  approvedBy: text("approved_by").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_finance_budgets_year_month_department").on(table.fiscalYear, table.month, table.department),
]);

export const financeBudgetPlans = sqliteTable("finance_budget_plans", {
  id: text("id").primaryKey(),
  fiscalYear: integer("fiscal_year").notNull(),
  name: text("name").notNull(),
  status: text("status").notNull().default("DRAFT"),
  version: integer("version").notNull().default(1),
  revisionReason: text("revision_reason").notNull().default(""),
  ownerEmployeeId: text("owner_employee_id").notNull(),
  submittedAt: integer("submitted_at"),
  approvedBy: text("approved_by").notNull().default(""),
  approvedAt: integer("approved_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_finance_budget_plan_year_version").on(table.fiscalYear, table.version),
  index("idx_finance_budget_plan_year_status").on(table.fiscalYear, table.status),
]);

export const financeBudgetPlanLines = sqliteTable("finance_budget_plan_lines", {
  id: text("id").primaryKey(),
  planId: text("plan_id").notNull(),
  month: integer("month").notNull(),
  department: text("department").notNull(),
  accountCode: text("account_code").notNull().default(""),
  accountName: text("account_name").notNull(),
  direction: text("direction").notNull(),
  actualSource: text("actual_source").notNull(),
  amount: integer("amount").notNull(),
  thresholdPct: integer("threshold_pct").notNull().default(10),
  notes: text("notes").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_finance_budget_line_unique_mapping").on(table.planId, table.month, table.department, table.actualSource, table.accountCode, table.accountName),
  index("idx_finance_budget_line_plan_month").on(table.planId, table.month),
]);

export const financeBudgetVarianceActions = sqliteTable("finance_budget_variance_actions", {
  id: text("id").primaryKey(),
  planId: text("plan_id").notNull(),
  lineId: text("line_id").notNull(),
  period: text("period").notNull(),
  status: text("status").notNull().default("OPEN"),
  cause: text("cause").notNull().default(""),
  actionPlan: text("action_plan").notNull().default(""),
  ownerEmployeeId: text("owner_employee_id").notNull().default(""),
  dueDate: text("due_date").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_finance_budget_variance_line_unique").on(table.lineId),
  index("idx_finance_budget_variance_plan_status_due").on(table.planId, table.status, table.dueDate),
]);

export const financeManagementReports = sqliteTable("finance_management_reports", {
  id: text("id").primaryKey(),
  period: text("period").notNull(),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("DRAFT"),
  asOf: text("as_of").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  autoAnalysisJson: text("auto_analysis_json").notNull().default("{}"),
  highlights: text("highlights").notNull().default(""),
  risks: text("risks").notNull().default(""),
  decisions: text("decisions").notNull().default(""),
  qualityAcknowledged: integer("quality_acknowledged", { mode: "boolean" }).notNull().default(false),
  revisionReason: text("revision_reason").notNull().default(""),
  createdBy: text("created_by").notNull(),
  submittedAt: integer("submitted_at"),
  approvedBy: text("approved_by").notNull().default(""),
  approvedAt: integer("approved_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_finance_management_report_period_version").on(table.period, table.version),
  index("idx_finance_management_report_period_status").on(table.period, table.status),
]);

export const financeManagementReportActions = sqliteTable("finance_management_report_actions", {
  id: text("id").primaryKey(),
  reportId: text("report_id").notNull(),
  sourceSection: text("source_section").notNull().default("GENERAL"),
  title: text("title").notNull(),
  ownerEmployeeId: text("owner_employee_id").notNull(),
  dueDate: text("due_date").notNull(),
  status: text("status").notNull().default("OPEN"),
  memo: text("memo").notNull().default(""),
  createdBy: text("created_by").notNull(),
  completedAt: integer("completed_at"),
  decisionId: text("decision_id").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_finance_management_report_action_status_due").on(table.reportId, table.status, table.dueDate),
  uniqueIndex("idx_finance_management_action_decision").on(table.decisionId).where(sql`${table.decisionId} <> ''`),
]);

export const financeManagementDecisions = sqliteTable("finance_management_decisions", {
  id: text("id").primaryKey(),
  reportId: text("report_id").notNull(),
  sourceSection: text("source_section").notNull().default("GENERAL"),
  decisionType: text("decision_type").notNull().default("OTHER"),
  title: text("title").notNull(),
  proposal: text("proposal").notNull(),
  financialImpact: integer("financial_impact").notNull().default(0),
  ownerEmployeeId: text("owner_employee_id").notNull().default(""),
  decisionDueDate: text("decision_due_date").notNull().default(""),
  requiresAction: integer("requires_action", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull().default("DRAFT"),
  resolutionNote: text("resolution_note").notNull().default(""),
  resolvedBy: text("resolved_by").notNull().default(""),
  resolvedAt: integer("resolved_at"),
  actionId: text("action_id").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_finance_management_decision_report_status").on(table.reportId, table.status, table.decisionDueDate),
  index("idx_finance_management_decision_owner_due").on(table.ownerEmployeeId, table.status, table.decisionDueDate),
]);

export const financeDailyTreasuryReports = sqliteTable("finance_daily_treasury_reports", {
  id: text("id").primaryKey(),
  reportDate: text("report_date").notNull(),
  version: integer("version").notNull().default(1),
  status: text("status").notNull().default("DRAFT"),
  sourceAsOf: text("source_as_of").notNull(),
  snapshotJson: text("snapshot_json").notNull(),
  analysisText: text("analysis_text").notNull().default(""),
  analysisSource: text("analysis_source").notNull().default("RULE_BASED_FALLBACK"),
  aiStatus: text("ai_status").notNull().default("NOT_REQUESTED"),
  aiModel: text("ai_model").notNull().default(""),
  managementNote: text("management_note").notNull().default(""),
  actionItemsJson: text("action_items_json").notNull().default("[]"),
  generatedBy: text("generated_by").notNull(),
  reviewedBy: text("reviewed_by").notNull().default(""),
  reviewedAt: integer("reviewed_at"),
  finalizedBy: text("finalized_by").notNull().default(""),
  finalizedAt: integer("finalized_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_finance_daily_treasury_report_date_version").on(table.reportDate, table.version),
  index("idx_finance_daily_treasury_report_date_status").on(table.reportDate, table.status),
  index("idx_finance_daily_treasury_report_source_asof").on(table.sourceAsOf),
]);

export const financeMasterAccounts = sqliteTable("finance_master_accounts", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull(),
  normalBalance: text("normal_balance").notNull(),
  status: text("status").notNull().default("ACTIVE"),
  source: text("source").notNull().default("MANUAL"),
  validFrom: text("valid_from").notNull().default(""),
  validTo: text("valid_to").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_finance_master_account_code").on(table.code),
  index("idx_finance_master_account_status_category").on(table.status, table.category),
]);

export const financeMasterPartners = sqliteTable("finance_master_partners", {
  id: text("id").primaryKey(),
  canonicalName: text("canonical_name").notNull(),
  normalizedKey: text("normalized_key").notNull(),
  businessNumber: text("business_number").notNull().default(""),
  partnerType: text("partner_type").notNull().default("BOTH"),
  paymentTermsDays: integer("payment_terms_days").notNull().default(30),
  status: text("status").notNull().default("ACTIVE"),
  source: text("source").notNull().default("MANUAL"),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_finance_master_partner_key").on(table.normalizedKey),
  index("idx_finance_master_partner_status_type").on(table.status, table.partnerType),
]);

export const financeMasterPartnerAliases = sqliteTable("finance_master_partner_aliases", {
  id: text("id").primaryKey(),
  mappingKey: text("mapping_key").notNull(),
  sourceSystem: text("source_system").notNull(),
  sourceEntityId: text("source_entity_id").notNull().default(""),
  sourceName: text("source_name").notNull(),
  partnerId: text("partner_id").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_finance_master_partner_alias_key").on(table.mappingKey),
  index("idx_finance_master_partner_alias_partner").on(table.partnerId),
]);

export const financeMasterBankAccounts = sqliteTable("finance_master_bank_accounts", {
  id: text("id").primaryKey(),
  sourceSystem: text("source_system").notNull(),
  sourceAccountId: text("source_account_id").notNull(),
  bankCode: text("bank_code").notNull().default(""),
  accountName: text("account_name").notNull(),
  last4: text("last4").notNull().default(""),
  accountType: text("account_type").notNull(),
  currency: text("currency").notNull().default("KRW"),
  glAccountCode: text("gl_account_code").notNull().default(""),
  status: text("status").notNull().default("ACTIVE"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_finance_master_bank_source").on(table.sourceSystem, table.sourceAccountId),
  index("idx_finance_master_bank_status_type").on(table.status, table.accountType),
]);

export const financeMasterTaxCodes = sqliteTable("finance_master_tax_codes", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  direction: text("direction").notNull().default("BOTH"),
  rateBasisPoints: integer("rate_basis_points").notNull().default(0),
  status: text("status").notNull().default("ACTIVE"),
  effectiveFrom: text("effective_from").notNull().default(""),
  effectiveTo: text("effective_to").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_finance_master_tax_code").on(table.code),
  index("idx_finance_master_tax_status_direction").on(table.status, table.direction),
]);

export const financeMasterChangeRequests = sqliteTable("finance_master_change_requests", {
  id: text("id").primaryKey(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id").notNull(),
  changeType: text("change_type").notNull(),
  beforeJson: text("before_json").notNull().default("{}"),
  afterJson: text("after_json").notNull().default("{}"),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("SUBMITTED"),
  approvalId: text("approval_id").notNull().default(""),
  createdBy: text("created_by").notNull(),
  approvedBy: text("approved_by").notNull().default(""),
  approvedAt: integer("approved_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_finance_master_change_status_created").on(table.status, table.createdAt),
  index("idx_finance_master_change_target").on(table.targetType, table.targetId),
]);

export const financeExpenseRequests = sqliteTable("finance_expense_requests", {
  id: text("id").primaryKey(),
  requestKind: text("request_kind").notNull().default("EXPENSE"),
  title: text("title").notNull(),
  vendor: text("vendor").notNull().default(""),
  amount: integer("amount").notNull(),
  requestedDate: text("requested_date").notNull(),
  dueDate: text("due_date").notNull().default(""),
  accountCode: text("account_code").notNull().default(""),
  accountName: text("account_name").notNull().default(""),
  paymentMethod: text("payment_method").notNull().default("BANK_TRANSFER"),
  memo: text("memo").notNull().default(""),
  sourceType: text("source_type").notNull().default("MANUAL"),
  sourceId: text("source_id").notNull().default(""),
  status: text("status").notNull().default("DRAFT"),
  requesterEmployeeId: text("requester_employee_id").notNull(),
  approvedBy: text("approved_by").notNull().default(""),
  approvedAt: integer("approved_at"),
  paidBy: text("paid_by").notNull().default(""),
  paidAt: integer("paid_at"),
  journalStatus: text("journal_status").notNull().default("UNPOSTED"),
  evidenceRequired: integer("evidence_required", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_finance_expense_status_due").on(table.status, table.dueDate),
  index("idx_finance_expense_requester_created").on(table.requesterEmployeeId, table.createdAt),
]);

export const financePaymentLedger = sqliteTable("finance_payment_ledger", {
  id: text("id").primaryKey(),
  requestId: text("request_id").notNull(),
  paymentDate: text("payment_date").notNull(),
  amount: integer("amount").notNull(),
  paymentMethod: text("payment_method").notNull(),
  bankReference: text("bank_reference").notNull().default(""),
  paidBy: text("paid_by").notNull(),
  status: text("status").notNull().default("PAID"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_finance_payment_request_unique").on(table.requestId),
  index("idx_finance_payment_date").on(table.paymentDate),
]);

export const financeJournalEntries = sqliteTable("finance_journal_entries", {
  id: text("id").primaryKey(),
  paymentRequestId: text("payment_request_id").notNull(),
  voucherDate: text("voucher_date").notNull(),
  description: text("description").notNull(),
  debitAccountCode: text("debit_account_code").notNull().default(""),
  debitAccountName: text("debit_account_name").notNull(),
  creditAccountCode: text("credit_account_code").notNull().default(""),
  creditAccountName: text("credit_account_name").notNull(),
  amount: integer("amount").notNull(),
  status: text("status").notNull().default("DRAFT"),
  preparedBy: text("prepared_by").notNull(),
  postedBy: text("posted_by").notNull().default(""),
  postedAt: integer("posted_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_finance_journal_payment_unique").on(table.paymentRequestId),
  index("idx_finance_journal_status_date").on(table.status, table.voucherDate),
]);

export const financePurchaseVendors = sqliteTable("finance_purchase_vendors", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  businessNumber: text("business_number").notNull().default(""),
  contactName: text("contact_name").notNull().default(""),
  email: text("email").notNull().default(""),
  paymentTermsDays: integer("payment_terms_days").notNull().default(30),
  status: text("status").notNull().default("ACTIVE"),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  deletedAt: integer("deleted_at"),
}, (table) => [
  index("idx_finance_purchase_vendor_status_name").on(table.status, table.name),
]);

export const financePurchaseOrders = sqliteTable("finance_purchase_orders", {
  id: text("id").primaryKey(),
  orderNumber: text("order_number").notNull(),
  vendorId: text("vendor_id").notNull(),
  title: text("title").notNull(),
  currency: text("currency").notNull().default("KRW"),
  subtotal: integer("subtotal").notNull().default(0),
  taxAmount: integer("tax_amount").notNull().default(0),
  totalAmount: integer("total_amount").notNull().default(0),
  expectedDate: text("expected_date").notNull().default(""),
  status: text("status").notNull().default("DRAFT"),
  requesterEmployeeId: text("requester_employee_id").notNull(),
  approvedBy: text("approved_by").notNull().default(""),
  approvedAt: integer("approved_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_finance_purchase_order_number").on(table.orderNumber),
  index("idx_finance_purchase_order_vendor_status").on(table.vendorId, table.status),
]);

export const financePurchaseOrderLines = sqliteTable("finance_purchase_order_lines", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull(),
  lineNumber: integer("line_number").notNull(),
  itemName: text("item_name").notNull(),
  description: text("description").notNull().default(""),
  quantityMilli: integer("quantity_milli").notNull(),
  unitPrice: integer("unit_price").notNull(),
  lineAmount: integer("line_amount").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_finance_purchase_order_line_number").on(table.orderId, table.lineNumber),
]);

export const financePurchaseReceipts = sqliteTable("finance_purchase_receipts", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull(),
  receiptNumber: text("receipt_number").notNull(),
  receiptDate: text("receipt_date").notNull(),
  notes: text("notes").notNull().default(""),
  status: text("status").notNull().default("ACCEPTED"),
  receivedBy: text("received_by").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_finance_purchase_receipt_number").on(table.receiptNumber),
  index("idx_finance_purchase_receipt_order_date").on(table.orderId, table.receiptDate),
]);

export const financePurchaseReceiptLines = sqliteTable("finance_purchase_receipt_lines", {
  id: text("id").primaryKey(),
  receiptId: text("receipt_id").notNull(),
  orderLineId: text("order_line_id").notNull(),
  receivedQuantityMilli: integer("received_quantity_milli").notNull(),
  acceptedQuantityMilli: integer("accepted_quantity_milli").notNull(),
  rejectedQuantityMilli: integer("rejected_quantity_milli").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_finance_purchase_receipt_line").on(table.receiptId, table.orderLineId),
  index("idx_finance_purchase_receipt_order_line").on(table.orderLineId),
]);

export const financePurchaseInvoices = sqliteTable("finance_purchase_invoices", {
  id: text("id").primaryKey(),
  orderId: text("order_id").notNull(),
  vendorId: text("vendor_id").notNull().default(""),
  invoiceNumber: text("invoice_number").notNull(),
  invoiceDate: text("invoice_date").notNull(),
  dueDate: text("due_date").notNull().default(""),
  supplyAmount: integer("supply_amount").notNull(),
  taxAmount: integer("tax_amount").notNull().default(0),
  totalAmount: integer("total_amount").notNull(),
  matchedReceiptAmount: integer("matched_receipt_amount").notNull().default(0),
  status: text("status").notNull().default("DRAFT"),
  exceptionReason: text("exception_reason").notNull().default(""),
  paymentRequestId: text("payment_request_id").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_finance_purchase_invoice_vendor_number").on(table.vendorId, table.invoiceNumber),
  index("idx_finance_purchase_invoice_order_status").on(table.orderId, table.status),
  index("idx_finance_purchase_invoice_due_status").on(table.dueDate, table.status),
]);

export const financePayablePlans = sqliteTable("finance_payable_plans", {
  invoiceId: text("invoice_id").primaryKey(),
  planStatus: text("plan_status").notNull().default("SCHEDULED"),
  plannedPaymentDate: text("planned_payment_date").notNull().default(""),
  priority: text("priority").notNull().default("NORMAL"),
  ownerEmployeeId: text("owner_employee_id").notNull().default(""),
  holdReason: text("hold_reason").notNull().default(""),
  memo: text("memo").notNull().default(""),
  updatedBy: text("updated_by").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_finance_payable_plan_status_date").on(table.planStatus, table.plannedPaymentDate),
  index("idx_finance_payable_plan_owner_priority").on(table.ownerEmployeeId, table.priority),
]);

export const inventoryProducts = sqliteTable("inventory_products", {
  id: text("id").primaryKey(),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  category: text("category").notNull().default(""),
  unit: text("unit").notNull().default("EA"),
  minimumStockMilli: integer("minimum_stock_milli").notNull().default(0),
  status: text("status").notNull().default("ACTIVE"),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_inventory_product_sku").on(table.sku),
  index("idx_inventory_product_status_name").on(table.status, table.name),
]);

export const inventoryWarehouses = sqliteTable("inventory_warehouses", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  location: text("location").notNull().default(""),
  status: text("status").notNull().default("ACTIVE"),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_inventory_warehouse_code").on(table.code),
  index("idx_inventory_warehouse_status_name").on(table.status, table.name),
]);

export const inventoryMovements = sqliteTable("inventory_movements", {
  id: text("id").primaryKey(),
  movementDate: text("movement_date").notNull(),
  movementType: text("movement_type").notNull(),
  direction: text("direction").notNull(),
  productId: text("product_id").notNull(),
  warehouseId: text("warehouse_id").notNull(),
  quantityMilli: integer("quantity_milli").notNull(),
  unitCost: integer("unit_cost").notNull(),
  amount: integer("amount").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(),
  sourceLineKey: text("source_line_key").notNull(),
  referenceNumber: text("reference_number").notNull().default(""),
  reason: text("reason").notNull().default(""),
  postedBy: text("posted_by").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_inventory_movement_source_line").on(table.sourceType, table.sourceId, table.sourceLineKey),
  index("idx_inventory_movement_product_warehouse_date").on(table.productId, table.warehouseId, table.movementDate),
  index("idx_inventory_movement_date_type").on(table.movementDate, table.movementType),
]);

export const hrPayrollRuns = sqliteTable("hr_payroll_runs", {
  period: text("period").primaryKey(),
  status: text("status").notNull().default("DRAFT"),
  employeeCount: integer("employee_count").notNull().default(0),
  grossPay: integer("gross_pay").notNull().default(0),
  deductions: integer("deductions").notNull().default(0),
  netPay: integer("net_pay").notNull().default(0),
  preparedBy: text("prepared_by").notNull().default(""),
  reviewedBy: text("reviewed_by").notNull().default(""),
  approvedBy: text("approved_by").notNull().default(""),
  lockedAt: integer("locked_at"),
  reopenedReason: text("reopened_reason").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const financeTaxPeriods = sqliteTable("finance_tax_periods", {
  period: text("period").primaryKey(),
  sourceAsOf: text("source_as_of").notNull(),
  sourceSalesSupply: integer("source_sales_supply").notNull().default(0),
  sourcePurchaseSupply: integer("source_purchase_supply").notNull().default(0),
  sourceSalesDocuments: integer("source_sales_documents").notNull().default(0),
  sourcePurchaseDocuments: integer("source_purchase_documents").notNull().default(0),
  declaredSalesSupply: integer("declared_sales_supply").notNull().default(0),
  declaredPurchaseSupply: integer("declared_purchase_supply").notNull().default(0),
  outputTax: integer("output_tax").notNull().default(0),
  deductibleInputTax: integer("deductible_input_tax").notNull().default(0),
  nondeductibleInputTax: integer("nondeductible_input_tax").notNull().default(0),
  adjustmentTax: integer("adjustment_tax").notNull().default(0),
  payableTax: integer("payable_tax").notNull().default(0),
  figuresConfirmed: integer("figures_confirmed", { mode: "boolean" }).notNull().default(false),
  note: text("note").notNull().default(""),
  status: text("status").notNull().default("DRAFT"),
  preparedBy: text("prepared_by").notNull(),
  reviewedBy: text("reviewed_by").notNull().default(""),
  reviewedAt: integer("reviewed_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_finance_tax_status_period").on(table.status, table.period),
]);

export const financeFixedAssets = sqliteTable("finance_fixed_assets", {
  id: text("id").primaryKey(), assetCode: text("asset_code").notNull(), name: text("name").notNull(),
  category: text("category").notNull(), acquisitionDate: text("acquisition_date").notNull(),
  inServiceDate: text("in_service_date").notNull(), acquisitionCost: integer("acquisition_cost").notNull(),
  residualValue: integer("residual_value").notNull().default(0), usefulLifeMonths: integer("useful_life_months").notNull(),
  depreciationMethod: text("depreciation_method").notNull().default("STRAIGHT_LINE"),
  openingAccumulated: integer("opening_accumulated").notNull().default(0), openingAsOf: text("opening_as_of").notNull().default(""),
  assetAccountCode: text("asset_account_code").notNull(), accumulatedAccountCode: text("accumulated_account_code").notNull(),
  expenseAccountCode: text("expense_account_code").notNull(), location: text("location").notNull().default(""),
  custodianEmployeeId: text("custodian_employee_id").notNull().default(""), sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(), sourceReference: text("source_reference").notNull().default(""),
  status: text("status").notNull().default("DRAFT"), disposalDate: text("disposal_date").notNull().default(""),
  note: text("note").notNull().default(""), createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_finance_fixed_asset_code").on(table.assetCode),
  uniqueIndex("idx_finance_fixed_asset_source").on(table.sourceType, table.sourceId),
  index("idx_finance_fixed_asset_status_service").on(table.status, table.inServiceDate),
]);

export const financeAssetDepreciationSchedules = sqliteTable("finance_asset_depreciation_schedules", {
  id: text("id").primaryKey(), assetId: text("asset_id").notNull(), period: text("period").notNull(),
  openingAccumulated: integer("opening_accumulated").notNull().default(0),
  depreciationAmount: integer("depreciation_amount").notNull(), closingAccumulated: integer("closing_accumulated").notNull(),
  closingBookValue: integer("closing_book_value").notNull(), status: text("status").notNull().default("PLANNED"),
  journalEntryId: text("journal_entry_id").notNull().default(""), createdBy: text("created_by").notNull(),
  postedBy: text("posted_by").notNull().default(""), postedAt: integer("posted_at"),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_finance_asset_depreciation_period").on(table.assetId, table.period),
  index("idx_finance_asset_depreciation_status_period").on(table.status, table.period),
]);

export const financeAssetEvents = sqliteTable("finance_asset_events", {
  id: text("id").primaryKey(), assetId: text("asset_id").notNull(), eventType: text("event_type").notNull(),
  eventDate: text("event_date").notNull(), amount: integer("amount").notNull().default(0),
  location: text("location").notNull().default(""), custodianEmployeeId: text("custodian_employee_id").notNull().default(""),
  journalReference: text("journal_reference").notNull().default(""), reason: text("reason").notNull(),
  createdBy: text("created_by").notNull(), createdAt: integer("created_at").notNull(),
}, (table) => [index("idx_finance_asset_event_asset_date").on(table.assetId, table.eventDate)]);

export const financeCostCenters = sqliteTable("finance_cost_centers", {
  id: text("id").primaryKey(), code: text("code").notNull(), name: text("name").notNull(), centerType: text("center_type").notNull(),
  ownerEmployeeId: text("owner_employee_id").notNull().default(""), opportunityId: text("opportunity_id").notNull().default(""),
  clientName: text("client_name").notNull().default(""), startDate: text("start_date").notNull().default(""),
  endDate: text("end_date").notNull().default(""), status: text("status").notNull().default("ACTIVE"),
  note: text("note").notNull().default(""), createdBy: text("created_by").notNull(), createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("idx_finance_cost_center_code").on(table.code),
  uniqueIndex("idx_finance_cost_center_opportunity").on(table.opportunityId).where(sql`${table.opportunityId} <> ''`),
  index("idx_finance_cost_center_status_type").on(table.status, table.centerType)]);

export const financeProjectMonthlyBudgets = sqliteTable("finance_project_monthly_budgets", {
  id: text("id").primaryKey(), costCenterId: text("cost_center_id").notNull(), period: text("period").notNull(),
  revenueBudget: integer("revenue_budget").notNull().default(0), costBudget: integer("cost_budget").notNull().default(0),
  note: text("note").notNull().default(""), approvedBy: text("approved_by").notNull(), createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("idx_finance_project_budget_period").on(table.costCenterId, table.period),
  index("idx_finance_project_budget_period_center").on(table.period, table.costCenterId)]);

export const financeProjectAllocations = sqliteTable("finance_project_allocations", {
  id: text("id").primaryKey(), costCenterId: text("cost_center_id").notNull(), sourceType: text("source_type").notNull(),
  sourceId: text("source_id").notNull(), period: text("period").notNull(), direction: text("direction").notNull(),
  sourceAmount: integer("source_amount").notNull(), amount: integer("amount").notNull(),
  allocationBasis: text("allocation_basis").notNull().default("MANUAL_AMOUNT"), note: text("note").notNull(),
  createdBy: text("created_by").notNull(), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("idx_finance_project_allocation_source_center").on(table.sourceType, table.sourceId, table.costCenterId),
  index("idx_finance_project_allocation_period_center").on(table.period, table.costCenterId),
  index("idx_finance_project_allocation_source").on(table.sourceType, table.sourceId)]);

export const financeCorporateCards = sqliteTable("finance_corporate_cards", {
  id: text("id").primaryKey(), issuer: text("issuer").notNull(), nickname: text("nickname").notNull(),
  last4: text("last4").notNull(), holderEmployeeId: text("holder_employee_id").notNull().default(""),
  monthlyLimit: integer("monthly_limit").notNull().default(0), status: text("status").notNull().default("ACTIVE"),
  createdBy: text("created_by").notNull(), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("idx_finance_corporate_card_issuer_last4").on(table.issuer, table.last4),
  index("idx_finance_corporate_card_status_holder").on(table.status, table.holderEmployeeId)]);

export const financeCardTransactions = sqliteTable("finance_card_transactions", {
  id: text("id").primaryKey(), cardId: text("card_id").notNull(), externalReference: text("external_reference").notNull(),
  transactionDate: text("transaction_date").notNull(), merchant: text("merchant").notNull(), amount: integer("amount").notNull(),
  currency: text("currency").notNull().default("KRW"), direction: text("direction").notNull().default("CHARGE"),
  status: text("status").notNull().default("UNMATCHED"), expenseRequestId: text("expense_request_id").notNull().default(""),
  exclusionReason: text("exclusion_reason").notNull().default(""), sourceFileName: text("source_file_name").notNull().default(""),
  createdBy: text("created_by").notNull(), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("idx_finance_card_transaction_reference").on(table.cardId, table.externalReference),
  uniqueIndex("idx_finance_card_transaction_expense").on(table.expenseRequestId).where(sql`${table.expenseRequestId} <> ''`),
  index("idx_finance_card_transaction_status_date").on(table.status, table.transactionDate)]);

export const financeExpenseControls = sqliteTable("finance_expense_controls", {
  expenseRequestId: text("expense_request_id").primaryKey(), businessPurpose: text("business_purpose").notNull().default(""),
  evidenceStatus: text("evidence_status").notNull().default("PENDING"), evidenceDocumentId: text("evidence_document_id").notNull().default(""),
  cardTransactionId: text("card_transaction_id").notNull().default(""), taxTreatment: text("tax_treatment").notNull().default("UNREVIEWED"),
  reviewNote: text("review_note").notNull().default(""), reviewedBy: text("reviewed_by").notNull().default(""),
  reviewedAt: integer("reviewed_at"), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("idx_finance_expense_control_card").on(table.cardTransactionId).where(sql`${table.cardTransactionId} <> ''`),
  index("idx_finance_expense_control_evidence_status").on(table.evidenceStatus, table.updatedAt)]);

export const financeDebtFacilities = sqliteTable("finance_debt_facilities", {
  id: text("id").primaryKey(), facilityCode: text("facility_code").notNull(), sourceAccountId: text("source_account_id").notNull(),
  lenderName: text("lender_name").notNull(), facilityName: text("facility_name").notNull(), currency: text("currency").notNull().default("KRW"),
  originalPrincipal: integer("original_principal").notNull(), agreementDate: text("agreement_date").notNull(), maturityDate: text("maturity_date").notNull(),
  interestType: text("interest_type").notNull().default("MANUAL"), fixedRateBps: integer("fixed_rate_bps").notNull().default(0),
  benchmarkName: text("benchmark_name").notNull().default(""), spreadBps: integer("spread_bps").notNull().default(0),
  repaymentType: text("repayment_type").notNull().default("MANUAL"), paymentDay: integer("payment_day").notNull().default(0),
  covenantNote: text("covenant_note").notNull().default(""), nextCovenantReviewDate: text("next_covenant_review_date").notNull().default(""),
  status: text("status").notNull().default("DRAFT"), evidenceDocumentId: text("evidence_document_id").notNull().default(""),
  approvedBy: text("approved_by").notNull().default(""), approvedAt: integer("approved_at"), createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("idx_finance_debt_facility_code").on(table.facilityCode),
  uniqueIndex("idx_finance_debt_facility_source").on(table.sourceAccountId),
  index("idx_finance_debt_facility_status_maturity").on(table.status, table.maturityDate)]);

export const financeDebtScheduleItems = sqliteTable("finance_debt_schedule_items", {
  id: text("id").primaryKey(), facilityId: text("facility_id").notNull(), dueDate: text("due_date").notNull(),
  itemType: text("item_type").notNull(), amount: integer("amount").notNull(), status: text("status").notNull().default("PLANNED"),
  paymentRequestId: text("payment_request_id").notNull().default(""), note: text("note").notNull().default(""),
  createdBy: text("created_by").notNull(), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("idx_finance_debt_schedule_unique").on(table.facilityId, table.dueDate, table.itemType),
  uniqueIndex("idx_finance_debt_schedule_payment").on(table.paymentRequestId).where(sql`${table.paymentRequestId} <> ''`),
  index("idx_finance_debt_schedule_status_due").on(table.status, table.dueDate)]);

export const financeDebtCovenantReviews = sqliteTable("finance_debt_covenant_reviews", {
  id: text("id").primaryKey(), facilityId: text("facility_id").notNull(), reviewDate: text("review_date").notNull(),
  covenantName: text("covenant_name").notNull(), comparator: text("comparator").notNull(),
  thresholdValueScaled: integer("threshold_value_scaled").notNull(), actualValueScaled: integer("actual_value_scaled").notNull(),
  unit: text("unit").notNull(), result: text("result").notNull(), evidenceDocumentId: text("evidence_document_id").notNull(),
  note: text("note").notNull().default(""), reviewedBy: text("reviewed_by").notNull(),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("idx_finance_debt_covenant_review_unique").on(table.facilityId, table.reviewDate, table.covenantName),
  index("idx_finance_debt_covenant_result_date").on(table.result, table.reviewDate)]);

export const hrLeaveRequests = sqliteTable("hr_leave_requests", {
  id: text("id").primaryKey(),
  employeeId: text("employee_id").notNull(),
  leaveType: text("leave_type").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  units: integer("units").notNull(),
  reason: text("reason").notNull().default(""),
  status: text("status").notNull().default("PENDING"),
  approverEmployeeId: text("approver_employee_id").notNull().default(""),
  decidedAt: integer("decided_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_hr_leave_employee_start").on(table.employeeId, table.startDate),
  index("idx_hr_leave_status_start").on(table.status, table.startDate),
]);

export const hrAttendanceRecords = sqliteTable("hr_attendance_records", {
  id: text("id").primaryKey(),
  employeeId: text("employee_id").notNull(),
  workDate: text("work_date").notNull(),
  workType: text("work_type").notNull().default("OFFICE"),
  checkIn: text("check_in").notNull().default(""),
  checkOut: text("check_out").notNull().default(""),
  minutesWorked: integer("minutes_worked").notNull().default(0),
  status: text("status").notNull().default("RECORDED"),
  sourceType: text("source_type").notNull().default("MANUAL"),
  memo: text("memo").notNull().default(""),
  approvedBy: text("approved_by").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_hr_attendance_employee_date").on(table.employeeId, table.workDate),
  index("idx_hr_attendance_status_date").on(table.status, table.workDate),
]);

export const hrPersonnelActions = sqliteTable("hr_personnel_actions", {
  id: text("id").primaryKey(),
  employeeId: text("employee_id").notNull(),
  actionType: text("action_type").notNull(),
  effectiveDate: text("effective_date").notNull(),
  orderNumber: text("order_number").notNull().default(""),
  beforeJson: text("before_json").notNull().default("{}"),
  afterJson: text("after_json").notNull().default("{}"),
  reason: text("reason").notNull().default(""),
  status: text("status").notNull().default("DRAFT"),
  approvedBy: text("approved_by").notNull().default(""),
  approvedAt: integer("approved_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_hr_personnel_employee_effective").on(table.employeeId, table.effectiveDate),
  index("idx_hr_personnel_status_effective").on(table.status, table.effectiveDate),
]);

export const hrLifecycleTasks = sqliteTable("hr_lifecycle_tasks", {
  id: text("id").primaryKey(),
  employeeId: text("employee_id").notNull(),
  lifecycleType: text("lifecycle_type").notNull(),
  taskGroup: text("task_group").notNull(),
  title: text("title").notNull(),
  ownerEmployeeId: text("owner_employee_id").notNull().default(""),
  dueDate: text("due_date").notNull().default(""),
  status: text("status").notNull().default("OPEN"),
  completedAt: integer("completed_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_hr_lifecycle_employee_type").on(table.employeeId, table.lifecycleType),
  index("idx_hr_lifecycle_status_due").on(table.status, table.dueDate),
]);

export const hrRetirementRequests = sqliteTable("hr_retirement_requests", {
  id: text("id").primaryKey(),
  employeeId: text("employee_id").notNull(),
  retirementDate: text("retirement_date").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("SUBMITTED"),
  checklistJson: text("checklist_json").notNull().default("[]"),
  totalTasks: integer("total_tasks").notNull().default(0),
  completedTasks: integer("completed_tasks").notNull().default(0),
  requestedBy: text("requested_by").notNull(),
  approvedBy: text("approved_by").notNull().default(""),
  approvedAt: integer("approved_at"),
  completedAt: integer("completed_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_hr_retirement_employee_date").on(table.employeeId, table.retirementDate),
  index("idx_hr_retirement_status_date").on(table.status, table.retirementDate),
]);

export const hrRetirementSettlements = sqliteTable("hr_retirement_settlements", {
  requestId: text("request_id").primaryKey(),
  finalSalary: integer("final_salary").notNull().default(0),
  retirementPay: integer("retirement_pay").notNull().default(0),
  unusedLeavePay: integer("unused_leave_pay").notNull().default(0),
  deductions: integer("deductions").notNull().default(0),
  netSettlement: integer("net_settlement").notNull().default(0),
  payrollConfirmed: integer("payroll_confirmed", { mode: "boolean" }).notNull().default(false),
  insuranceConfirmed: integer("insurance_confirmed", { mode: "boolean" }).notNull().default(false),
  accessRevoked: integer("access_revoked", { mode: "boolean" }).notNull().default(false),
  assetsReturned: integer("assets_returned", { mode: "boolean" }).notNull().default(false),
  handoverConfirmed: integer("handover_confirmed", { mode: "boolean" }).notNull().default(false),
  status: text("status").notNull().default("DRAFT"),
  preparedBy: text("prepared_by").notNull().default(""),
  completedBy: text("completed_by").notNull().default(""),
  completedAt: integer("completed_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const hrWorkforcePlans = sqliteTable("hr_workforce_plans", {
  id: text("id").primaryKey(),
  period: text("period").notNull(),
  version: integer("version").notNull().default(1),
  title: text("title").notNull(),
  assumptions: text("assumptions").notNull().default(""),
  status: text("status").notNull().default("DRAFT"),
  revisionReason: text("revision_reason").notNull().default(""),
  createdBy: text("created_by").notNull(),
  submittedAt: integer("submitted_at"),
  approvedBy: text("approved_by").notNull().default(""),
  approvedAt: integer("approved_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_hr_workforce_plan_period_version").on(table.period, table.version),
  index("idx_hr_workforce_plan_period_status").on(table.period, table.status),
]);

export const hrWorkforcePlanLines = sqliteTable("hr_workforce_plan_lines", {
  id: text("id").primaryKey(),
  planId: text("plan_id").notNull(),
  organizationId: text("organization_id").notNull(),
  approvedHeadcount: integer("approved_headcount").notNull().default(0),
  plannedExits: integer("planned_exits").notNull().default(0),
  note: text("note").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_hr_workforce_plan_line_org").on(table.planId, table.organizationId),
]);

export const hrRecruitmentRequisitions = sqliteTable("hr_recruitment_requisitions", {
  id: text("id").primaryKey(),
  workforcePlanId: text("workforce_plan_id").notNull(),
  workforcePlanLineId: text("workforce_plan_line_id").notNull(),
  organizationId: text("organization_id").notNull(),
  title: text("title").notNull(),
  role: text("role").notNull(),
  requestedHeadcount: integer("requested_headcount").notNull().default(1),
  ownerEmployeeId: text("owner_employee_id").notNull(),
  targetStartDate: text("target_start_date").notNull(),
  reason: text("reason").notNull(),
  status: text("status").notNull().default("DRAFT"),
  requestedBy: text("requested_by").notNull(),
  approvedBy: text("approved_by").notNull().default(""),
  approvedAt: integer("approved_at"),
  closedBy: text("closed_by").notNull().default(""),
  closedAt: integer("closed_at"),
  closeReason: text("close_reason").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_hr_requisition_plan_org").on(table.workforcePlanId, table.organizationId),
  index("idx_hr_requisition_status_owner").on(table.status, table.ownerEmployeeId),
]);

export const hrPerformanceCycles = sqliteTable("hr_performance_cycles", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  period: text("period").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("DRAFT"),
  goalDueDate: text("goal_due_date").notNull(),
  selfDueDate: text("self_due_date").notNull(),
  managerDueDate: text("manager_due_date").notNull(),
  calibrationDueDate: text("calibration_due_date").notNull(),
  createdBy: text("created_by").notNull(),
  openedAt: integer("opened_at"),
  finalizedBy: text("finalized_by").notNull().default(""),
  finalizedAt: integer("finalized_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_hr_performance_cycle_period_name").on(table.period, table.name),
  index("idx_hr_performance_cycle_status_period").on(table.status, table.period),
]);

export const hrPerformanceParticipants = sqliteTable("hr_performance_participants", {
  id: text("id").primaryKey(), cycleId: text("cycle_id").notNull(), employeeId: text("employee_id").notNull(),
  organizationId: text("organization_id").notNull().default(""), managerEmployeeId: text("manager_employee_id").notNull().default(""),
  status: text("status").notNull().default("NOT_STARTED"), finalScore: integer("final_score"),
  finalRating: text("final_rating").notNull().default(""), calibrationNote: text("calibration_note").notNull().default(""),
  finalizedBy: text("finalized_by").notNull().default(""), finalizedAt: integer("finalized_at"),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_hr_performance_participant_cycle_employee").on(table.cycleId, table.employeeId),
  index("idx_hr_performance_participant_manager_status").on(table.managerEmployeeId, table.status),
]);

export const hrPerformanceGoals = sqliteTable("hr_performance_goals", {
  id: text("id").primaryKey(), participantId: text("participant_id").notNull(), title: text("title").notNull(),
  description: text("description").notNull().default(""), weight: integer("weight").notNull(),
  metricType: text("metric_type").notNull().default("PERCENT"), targetValue: real("target_value").notNull(),
  actualValue: real("actual_value"), unit: text("unit").notNull().default("%"), evidence: text("evidence").notNull().default(""),
  employeeComment: text("employee_comment").notNull().default(""), managerComment: text("manager_comment").notNull().default(""),
  status: text("status").notNull().default("DRAFT"), createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [index("idx_hr_performance_goal_participant_status").on(table.participantId, table.status)]);

export const hrPerformanceReviews = sqliteTable("hr_performance_reviews", {
  id: text("id").primaryKey(), participantId: text("participant_id").notNull(), reviewerType: text("reviewer_type").notNull(),
  reviewerEmployeeId: text("reviewer_employee_id").notNull(), score: integer("score").notNull(), rating: text("rating").notNull(),
  strengths: text("strengths").notNull().default(""), improvements: text("improvements").notNull().default(""),
  comment: text("comment").notNull().default(""), status: text("status").notNull().default("DRAFT"),
  submittedAt: integer("submitted_at"), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_hr_performance_review_participant_type").on(table.participantId, table.reviewerType),
  index("idx_hr_performance_review_reviewer_status").on(table.reviewerEmployeeId, table.status),
]);

export const hrPerformanceAppeals = sqliteTable("hr_performance_appeals", {
  id: text("id").primaryKey(), participantId: text("participant_id").notNull(), reason: text("reason").notNull(),
  status: text("status").notNull().default("SUBMITTED"), response: text("response").notNull().default(""),
  submittedBy: text("submitted_by").notNull(), submittedAt: integer("submitted_at").notNull(),
  resolvedBy: text("resolved_by").notNull().default(""), resolvedAt: integer("resolved_at"),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [index("idx_hr_performance_appeal_participant_status").on(table.participantId, table.status)]);

export const hrTrainingCourses = sqliteTable("hr_training_courses", {
  id: text("id").primaryKey(), title: text("title").notNull(), courseType: text("course_type").notNull().default("MANDATORY"),
  year: integer("year").notNull(), description: text("description").notNull().default(""),
  provider: text("provider").notNull().default(""), deliveryMode: text("delivery_mode").notNull().default("ONLINE"),
  startDate: text("start_date").notNull(), dueDate: text("due_date").notNull(), durationMinutes: integer("duration_minutes").notNull().default(0),
  audienceType: text("audience_type").notNull().default("ALL"), organizationId: text("organization_id").notNull().default(""),
  status: text("status").notNull().default("DRAFT"), createdBy: text("created_by").notNull(),
  openedAt: integer("opened_at"), closedAt: integer("closed_at"), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_hr_training_course_year_title").on(table.year, table.title),
  index("idx_hr_training_course_status_due").on(table.status, table.dueDate),
]);

export const hrTrainingAssignments = sqliteTable("hr_training_assignments", {
  id: text("id").primaryKey(), courseId: text("course_id").notNull(), employeeId: text("employee_id").notNull(),
  employeeName: text("employee_name").notNull(), department: text("department").notNull().default(""),
  status: text("status").notNull().default("ASSIGNED"), progress: integer("progress").notNull().default(0), score: real("score"),
  completedMinutes: integer("completed_minutes").notNull().default(0), evidenceName: text("evidence_name").notNull().default(""),
  evidenceRef: text("evidence_ref").notNull().default(""), employeeNote: text("employee_note").notNull().default(""),
  waiverReason: text("waiver_reason").notNull().default(""), verifiedBy: text("verified_by").notNull().default(""),
  verifiedAt: integer("verified_at"), completedAt: integer("completed_at"), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_hr_training_assignment_course_employee").on(table.courseId, table.employeeId),
  index("idx_hr_training_assignment_employee_status").on(table.employeeId, table.status),
  index("idx_hr_training_assignment_course_status").on(table.courseId, table.status),
]);

export const hrAnalyticsReports = sqliteTable("hr_analytics_reports", {
  id: text("id").primaryKey(), reportType: text("report_type").notNull().default("HR_OVERVIEW"),
  title: text("title").notNull(), periodStart: text("period_start").notNull(), periodEnd: text("period_end").notNull(),
  version: integer("version").notNull().default(1), snapshotJson: text("snapshot_json").notNull(),
  generatedBy: text("generated_by").notNull(), createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_hr_analytics_report_period_version").on(table.reportType, table.periodStart, table.periodEnd, table.version),
  index("idx_hr_analytics_report_created").on(table.createdAt),
]);

export const hrOfferRequests = sqliteTable("hr_offer_requests", {
  id: text("id").primaryKey(),
  applicantId: text("applicant_id").notNull(),
  proposedTitle: text("proposed_title").notNull(),
  department: text("department").notNull(),
  employmentType: text("employment_type").notNull(),
  startDate: text("start_date").notNull(),
  annualSalary: integer("annual_salary").notNull(),
  probationMonths: integer("probation_months").notNull().default(3),
  notes: text("notes").notNull().default(""),
  status: text("status").notNull().default("SUBMITTED"),
  requestedBy: text("requested_by").notNull(),
  approvedBy: text("approved_by").notNull().default(""),
  approvedAt: integer("approved_at"),
  employeeId: text("employee_id").notNull().default(""),
  responseNote: text("response_note").notNull().default(""),
  respondedBy: text("responded_by").notNull().default(""),
  respondedAt: integer("responded_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_hr_offer_applicant_created").on(table.applicantId, table.createdAt),
  index("idx_hr_offer_status_start").on(table.status, table.startDate),
]);

export const salesAccounts = sqliteTable("sales_accounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  businessNumber: text("business_number").notNull().default(""),
  industry: text("industry").notNull().default(""),
  ownerEmployeeId: text("owner_employee_id").notNull().default(""),
  status: text("status").notNull().default("ACTIVE"),
  memo: text("memo").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  deletedAt: integer("deleted_at"),
}, (table) => [
  index("idx_sales_accounts_name").on(table.name),
  index("idx_sales_accounts_owner_status").on(table.ownerEmployeeId, table.status),
]);

export const salesAccountIdentityKeys = sqliteTable("sales_account_identity_keys", {
  identityKey: text("identity_key").primaryKey(), accountId: text("account_id").notNull(),
  isPrimary: integer("is_primary").notNull().default(1), originAccountId: text("origin_account_id").notNull().default(""),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("idx_sales_account_identity_account").on(table.accountId),
  uniqueIndex("idx_sales_account_identity_primary").on(table.accountId).where(sql`${table.isPrimary} = 1`),
]);

export const salesAccountOwnerHistory = sqliteTable("sales_account_owner_history", {
  id: text("id").primaryKey(), accountId: text("account_id").notNull(),
  fromOwnerEmployeeId: text("from_owner_employee_id").notNull().default(""), toOwnerEmployeeId: text("to_owner_employee_id").notNull(),
  reason: text("reason").notNull(), changedBy: text("changed_by").notNull(), changedAt: integer("changed_at").notNull(),
}, (table) => [index("idx_sales_account_owner_history_account_changed").on(table.accountId, table.changedAt)]);

export const salesAccountMerges = sqliteTable("sales_account_merges", {
  id: text("id").primaryKey(), sourceAccountId: text("source_account_id").notNull(), targetAccountId: text("target_account_id").notNull(),
  reason: text("reason").notNull(), mergedBy: text("merged_by").notNull(), mergedAt: integer("merged_at").notNull(),
}, (table) => [uniqueIndex("idx_sales_account_merge_source").on(table.sourceAccountId)]);

export const salesOpportunities = sqliteTable("sales_opportunities", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  title: text("title").notNull(),
  ownerEmployeeId: text("owner_employee_id").notNull(),
  stage: text("stage").notNull().default("LEAD"),
  leadType: text("lead_type").notNull().default("OUTBOUND"),
  expectedRevenue: integer("expected_revenue").notNull().default(0),
  expectedCost: integer("expected_cost").notNull().default(0),
  probability: integer("probability").notNull().default(0),
  expectedCloseDate: text("expected_close_date").notNull().default(""),
  nextAction: text("next_action").notNull().default(""),
  nextActionDate: text("next_action_date").notNull().default(""),
  status: text("status").notNull().default("OPEN"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  deletedAt: integer("deleted_at"),
}, (table) => [
  index("idx_sales_opportunities_owner_stage").on(table.ownerEmployeeId, table.stage),
  index("idx_sales_opportunities_close_date").on(table.expectedCloseDate),
  index("idx_sales_opportunities_account").on(table.accountId),
]);

export const salesAccountContacts = sqliteTable("sales_account_contacts", {
  id: text("id").primaryKey(), accountId: text("account_id").notNull(), contactKey: text("contact_key").notNull(),
  name: text("name").notNull(), title: text("title").notNull().default(""), email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""), isPrimary: integer("is_primary").notNull().default(0),
  status: text("status").notNull().default("ACTIVE"), createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_sales_contact_account_key").on(table.accountId, table.contactKey),
  uniqueIndex("idx_sales_contact_single_primary").on(table.accountId).where(sql`${table.isPrimary} = 1 AND ${table.status} = 'ACTIVE'`),
  index("idx_sales_contact_account_status").on(table.accountId, table.status),
]);

export const salesOpportunityActivities = sqliteTable("sales_opportunity_activities", {
  id: text("id").primaryKey(), opportunityId: text("opportunity_id").notNull(), contactId: text("contact_id").notNull().default(""),
  activityType: text("activity_type").notNull(), occurredAt: text("occurred_at").notNull(), summary: text("summary").notNull(),
  nextAction: text("next_action").notNull().default(""), nextActionDate: text("next_action_date").notNull().default(""),
  createdBy: text("created_by").notNull(), createdAt: integer("created_at").notNull(),
}, (table) => [index("idx_sales_activity_opportunity_occurred").on(table.opportunityId, table.occurredAt)]);

export const salesOpportunityStageHistory = sqliteTable("sales_opportunity_stage_history", {
  id: text("id").primaryKey(), opportunityId: text("opportunity_id").notNull(), fromStage: text("from_stage").notNull().default(""),
  toStage: text("to_stage").notNull(), reason: text("reason").notNull(), changedBy: text("changed_by").notNull(), changedAt: integer("changed_at").notNull(),
}, (table) => [index("idx_sales_stage_history_opportunity_changed").on(table.opportunityId, table.changedAt)]);

export const salesDocuments = sqliteTable("sales_documents", {
  id: text("id").primaryKey(),
  opportunityId: text("opportunity_id").notNull(),
  documentType: text("document_type").notNull(),
  documentNumber: text("document_number").notNull(),
  version: integer("version").notNull().default(1),
  amount: integer("amount").notNull().default(0),
  status: text("status").notNull().default("DRAFT"),
  issuedDate: text("issued_date").notNull().default(""),
  dueDate: text("due_date").notNull().default(""),
  sourceDocumentId: text("source_document_id").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_sales_documents_opportunity_type").on(table.opportunityId, table.documentType),
  index("idx_sales_documents_status_due").on(table.status, table.dueDate),
  index("idx_sales_documents_source").on(table.sourceDocumentId),
]);

export const salesCatalogItems = sqliteTable("sales_catalog_items", {
  id: text("id").primaryKey(), code: text("code").notNull(), name: text("name").notNull(),
  itemType: text("item_type").notNull(), unit: text("unit").notNull().default("EA"),
  defaultUnitPrice: integer("default_unit_price").notNull().default(0), status: text("status").notNull().default("ACTIVE"),
  createdBy: text("created_by").notNull(), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_sales_catalog_code").on(table.code),
  index("idx_sales_catalog_status_name").on(table.status, table.name),
]);

export const salesDocumentLines = sqliteTable("sales_document_lines", {
  id: text("id").primaryKey(), documentId: text("document_id").notNull(), lineNumber: integer("line_number").notNull(),
  catalogItemId: text("catalog_item_id").notNull(), description: text("description").notNull(), quantity: real("quantity").notNull(),
  unit: text("unit").notNull(), unitPrice: integer("unit_price").notNull(), amount: integer("amount").notNull(),
  sourceLineId: text("source_line_id").notNull().default(""), createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_sales_document_line_number").on(table.documentId, table.lineNumber),
  index("idx_sales_document_line_source").on(table.sourceLineId),
]);

export const salesPriceLists = sqliteTable("sales_price_lists", {
  id: text("id").primaryKey(), name: text("name").notNull(), version: integer("version").notNull(),
  currency: text("currency").notNull().default("KRW"), effectiveFrom: text("effective_from").notNull(),
  effectiveTo: text("effective_to").notNull().default(""), status: text("status").notNull().default("DRAFT"),
  createdBy: text("created_by").notNull(), approvedBy: text("approved_by").notNull().default(""),
  approvedAt: integer("approved_at"), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_sales_price_list_name_version").on(table.name, table.version),
  uniqueIndex("idx_sales_price_list_single_active").on(table.status).where(sql`${table.status} = 'ACTIVE'`),
]);

export const salesPriceListItems = sqliteTable("sales_price_list_items", {
  id: text("id").primaryKey(), priceListId: text("price_list_id").notNull(), catalogItemId: text("catalog_item_id").notNull(),
  listUnitPrice: integer("list_unit_price").notNull(), standardUnitCost: integer("standard_unit_cost").notNull(),
  minUnitPrice: integer("min_unit_price").notNull(), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("idx_sales_price_item_list_catalog").on(table.priceListId, table.catalogItemId)]);

export const salesPricingPolicies = sqliteTable("sales_pricing_policies", {
  id: text("id").primaryKey(), name: text("name").notNull(), version: integer("version").notNull(),
  maxDiscountBps: integer("max_discount_bps").notNull(), minGrossMarginBps: integer("min_gross_margin_bps").notNull(),
  status: text("status").notNull().default("DRAFT"), createdBy: text("created_by").notNull(),
  approvedBy: text("approved_by").notNull().default(""), approvedAt: integer("approved_at"),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_sales_pricing_policy_name_version").on(table.name, table.version),
  uniqueIndex("idx_sales_pricing_policy_single_active").on(table.status).where(sql`${table.status} = 'ACTIVE'`),
]);

export const salesDocumentPricingReviews = sqliteTable("sales_document_pricing_reviews", {
  documentId: text("document_id").primaryKey(), documentType: text("document_type").notNull(),
  priceListId: text("price_list_id").notNull().default(""), policyId: text("policy_id").notNull().default(""),
  priceListVersion: integer("price_list_version").notNull().default(0), policyVersion: integer("policy_version").notNull().default(0),
  listAmount: integer("list_amount").notNull().default(0), quotedAmount: integer("quoted_amount").notNull().default(0),
  standardCostAmount: integer("standard_cost_amount").notNull().default(0), minimumAmount: integer("minimum_amount").notNull().default(0),
  discountBps: integer("discount_bps").notNull().default(0), grossMarginBps: integer("gross_margin_bps").notNull().default(0),
  outcome: text("outcome").notNull(), reasonsJson: text("reasons_json").notNull().default("[]"),
  evaluatedBy: text("evaluated_by").notNull(), approvalRequestId: text("approval_request_id").notNull().default(""),
  reviewedBy: text("reviewed_by").notNull().default(""), reviewedAt: integer("reviewed_at"),
  snapshotJson: text("snapshot_json").notNull().default("{}"), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [index("idx_sales_pricing_review_outcome").on(table.outcome, table.updatedAt)]);

export const salesContractGovernanceSettings = sqliteTable("sales_contract_governance_settings", {
  id: text("id").primaryKey(), enforcementStartedAt: integer("enforcement_started_at").notNull(),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
});

export const salesContracts = sqliteTable("sales_contracts", {
  id: text("id").primaryKey(), orderDocumentId: text("order_document_id").notNull(), contractNumber: text("contract_number").notNull(),
  title: text("title").notNull(), version: integer("version").notNull().default(1), amountSnapshot: integer("amount_snapshot").notNull(),
  currency: text("currency").notNull().default("KRW"), startDate: text("start_date").notNull(), endDate: text("end_date").notNull(),
  autoRenewal: integer("auto_renewal").notNull().default(0), renewalNoticeDays: integer("renewal_notice_days").notNull().default(30),
  paymentTerms: text("payment_terms").notNull(), acceptanceCriteria: text("acceptance_criteria").notNull(),
  deliveryTerms: text("delivery_terms").notNull(), ownerEmployeeId: text("owner_employee_id").notNull(),
  signedDocumentId: text("signed_document_id").notNull().default(""), status: text("status").notNull().default("DRAFT"),
  createdBy: text("created_by").notNull(), approvedBy: text("approved_by").notNull().default(""), approvedAt: integer("approved_at"),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_sales_contract_order").on(table.orderDocumentId),
  uniqueIndex("idx_sales_contract_number").on(table.contractNumber),
  index("idx_sales_contract_status_end").on(table.status, table.endDate),
]);

export const salesContractObligations = sqliteTable("sales_contract_obligations", {
  id: text("id").primaryKey(), contractId: text("contract_id").notNull(), obligationType: text("obligation_type").notNull(),
  title: text("title").notNull(), ownerEmployeeId: text("owner_employee_id").notNull(), dueDate: text("due_date").notNull(),
  evidenceRequired: integer("evidence_required").notNull().default(1), status: text("status").notNull().default("OPEN"),
  completionNote: text("completion_note").notNull().default(""), completedBy: text("completed_by").notNull().default(""),
  completedAt: integer("completed_at"), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [index("idx_sales_contract_obligation_contract_due").on(table.contractId, table.status, table.dueDate)]);

export const salesContractChangeRequests = sqliteTable("sales_contract_change_requests", {
  id: text("id").primaryKey(), contractId: text("contract_id").notNull(), changeType: text("change_type").notNull(),
  reason: text("reason").notNull(), beforeJson: text("before_json").notNull(), afterJson: text("after_json").notNull(),
  effectiveDate: text("effective_date").notNull(), status: text("status").notNull().default("SUBMITTED"),
  createdBy: text("created_by").notNull(), approvalRequestId: text("approval_request_id").notNull().default(""),
  approvedBy: text("approved_by").notNull().default(""), approvedAt: integer("approved_at"),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [index("idx_sales_contract_change_contract_created").on(table.contractId, table.createdAt)]);

export const salesServicePolicies = sqliteTable("sales_service_policies", {
  id: text("id").primaryKey(), name: text("name").notNull(), version: integer("version").notNull().default(1),
  priority: text("priority").notNull(), firstResponseHours: integer("first_response_hours").notNull(),
  resolutionHours: integer("resolution_hours").notNull(), effectiveFrom: text("effective_from").notNull(),
  effectiveTo: text("effective_to").notNull().default(""), status: text("status").notNull().default("DRAFT"),
  createdBy: text("created_by").notNull(), approvedBy: text("approved_by").notNull().default(""), approvedAt: integer("approved_at"),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_sales_service_policy_name_version").on(table.name, table.version),
  uniqueIndex("idx_sales_service_policy_active_priority").on(table.priority).where(sql`${table.status} = 'ACTIVE'`),
]);

export const salesServiceCases = sqliteTable("sales_service_cases", {
  id: text("id").primaryKey(), caseNumber: text("case_number").notNull(), accountId: text("account_id").notNull(),
  opportunityId: text("opportunity_id").notNull(), deliveryDocumentId: text("delivery_document_id").notNull(),
  contractId: text("contract_id").notNull().default(""), contactId: text("contact_id").notNull().default(""),
  category: text("category").notNull(), priority: text("priority").notNull(), subject: text("subject").notNull(),
  description: text("description").notNull(), policyId: text("policy_id").notNull().default(""),
  openedAt: integer("opened_at").notNull(), firstResponseDueAt: integer("first_response_due_at").notNull(),
  resolutionDueAt: integer("resolution_due_at").notNull(), firstRespondedAt: integer("first_responded_at"),
  status: text("status").notNull().default("OPEN"), ownerEmployeeId: text("owner_employee_id").notNull(),
  resolutionType: text("resolution_type").notNull().default(""), resolutionNote: text("resolution_note").notNull().default(""),
  refundAmount: integer("refund_amount").notNull().default(0), approvalRequestId: text("approval_request_id").notNull().default(""),
  financeRequestId: text("finance_request_id").notNull().default(""), resolvedBy: text("resolved_by").notNull().default(""),
  resolvedAt: integer("resolved_at"), closedBy: text("closed_by").notNull().default(""), closedAt: integer("closed_at"),
  createdBy: text("created_by").notNull(), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_sales_service_case_number").on(table.caseNumber),
  index("idx_sales_service_case_status_due").on(table.status, table.resolutionDueAt),
  index("idx_sales_service_case_account_opened").on(table.accountId, table.openedAt),
]);

export const salesServiceCaseEvents = sqliteTable("sales_service_case_events", {
  id: text("id").primaryKey(), caseId: text("case_id").notNull(), eventType: text("event_type").notNull(),
  note: text("note").notNull(), actorEmployeeId: text("actor_employee_id").notNull(), createdAt: integer("created_at").notNull(),
}, (table) => [index("idx_sales_service_event_case_created").on(table.caseId, table.createdAt)]);

export const salesServiceReturnLines = sqliteTable("sales_service_return_lines", {
  id: text("id").primaryKey(), caseId: text("case_id").notNull(), deliveryLineId: text("delivery_line_id").notNull(),
  quantityMilli: integer("quantity_milli").notNull(), disposition: text("disposition").notNull(),
  inventoryMovementId: text("inventory_movement_id").notNull().default(""), receivedBy: text("received_by").notNull().default(""),
  receivedAt: integer("received_at"), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_sales_service_return_case_line").on(table.caseId, table.deliveryLineId),
  uniqueIndex("idx_sales_service_return_inventory").on(table.inventoryMovementId).where(sql`${table.inventoryMovementId} <> ''`),
]);

export const salesTargetPlans = sqliteTable("sales_target_plans", {
  id: text("id").primaryKey(), year: integer("year").notNull(), version: integer("version").notNull(),
  name: text("name").notNull(), status: text("status").notNull().default("DRAFT"), createdBy: text("created_by").notNull(),
  approvedBy: text("approved_by").notNull().default(""), approvedAt: integer("approved_at"),
  createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_sales_target_plan_year_version").on(table.year, table.version),
  uniqueIndex("idx_sales_target_plan_year_approved").on(table.year).where(sql`${table.status} = 'APPROVED'`),
]);

export const salesTargetLines = sqliteTable("sales_target_lines", {
  id: text("id").primaryKey(), planId: text("plan_id").notNull(), scopeType: text("scope_type").notNull(),
  scopeKey: text("scope_key").notNull(), scopeName: text("scope_name").notNull(), period: text("period").notNull(),
  targetRevenue: integer("target_revenue").notNull().default(0), targetGrossProfit: integer("target_gross_profit").notNull().default(0),
  targetOrders: integer("target_orders").notNull().default(0), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_sales_target_line_scope_period").on(table.planId, table.scopeType, table.scopeKey, table.period),
  index("idx_sales_target_line_plan_period").on(table.planId, table.period),
]);

export const salesForecastSnapshots = sqliteTable("sales_forecast_snapshots", {
  id: text("id").primaryKey(), planId: text("plan_id").notNull(), asOfDate: text("as_of_date").notNull(),
  version: integer("version").notNull(), formulaVersion: text("formula_version").notNull(), snapshotJson: text("snapshot_json").notNull(),
  createdBy: text("created_by").notNull(), createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("idx_sales_forecast_plan_date_version").on(table.planId, table.asOfDate, table.version),
  index("idx_sales_forecast_plan_created").on(table.planId, table.createdAt),
]);

export const salesPaymentAllocations = sqliteTable("sales_payment_allocations", {
  id: text("id").primaryKey(),
  paymentDocumentId: text("payment_document_id").notNull(),
  invoiceDocumentId: text("invoice_document_id").notNull(),
  amount: integer("amount").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_sales_payment_allocation_payment").on(table.paymentDocumentId),
  index("idx_sales_payment_allocation_invoice").on(table.invoiceDocumentId),
]);

export const salesIncentiveRules = sqliteTable("sales_incentive_rules", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  version: integer("version").notNull(),
  effectiveFrom: text("effective_from").notNull(),
  effectiveTo: text("effective_to").notNull().default(""),
  rulesJson: text("rules_json").notNull(),
  status: text("status").notNull().default("DRAFT"),
  approvedBy: text("approved_by").notNull().default(""),
  approvedAt: integer("approved_at"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_sales_incentive_rule_name_version").on(table.name, table.version),
  index("idx_sales_incentive_rules_status_effective").on(table.status, table.effectiveFrom),
]);

export const salesIncentiveResults = sqliteTable("sales_incentive_results", {
  id: text("id").primaryKey(),
  period: text("period").notNull(),
  employeeId: text("employee_id").notNull(),
  opportunityId: text("opportunity_id").notNull(),
  ruleId: text("rule_id").notNull(),
  ruleVersion: integer("rule_version").notNull(),
  recognizedRevenue: integer("recognized_revenue").notNull(),
  recognizedCost: integer("recognized_cost").notNull(),
  payoutAmount: integer("payout_amount").notNull(),
  calculationJson: text("calculation_json").notNull(),
  status: text("status").notNull().default("DRAFT"),
  salesConfirmedAt: integer("sales_confirmed_at"),
  financeReviewedAt: integer("finance_reviewed_at"),
  representativeApprovedAt: integer("representative_approved_at"),
  payrollRef: text("payroll_ref").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  uniqueIndex("idx_sales_incentive_result_source").on(table.period, table.employeeId, table.opportunityId, table.ruleId),
  index("idx_sales_incentive_period_employee").on(table.period, table.employeeId),
  index("idx_sales_incentive_status").on(table.status),
]);

export const salesIncentiveValidations = sqliteTable("sales_incentive_validations", {
  id: text("id").primaryKey(), ruleId: text("rule_id").notNull(), validationType: text("validation_type").notNull(),
  result: text("result").notNull(), evidenceDocumentId: text("evidence_document_id").notNull(), note: text("note").notNull(),
  reviewedBy: text("reviewed_by").notNull(), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [uniqueIndex("idx_sales_incentive_validation_type").on(table.ruleId, table.validationType),
  index("idx_sales_incentive_validation_result").on(table.result, table.createdAt)]);

export const salesIncentiveNotes = sqliteTable("sales_incentive_notes", {
  id: text("id").primaryKey(), resultId: text("result_id").notNull(), noteType: text("note_type").notNull(),
  note: text("note").notNull(), createdBy: text("created_by").notNull(), createdAt: integer("created_at").notNull(),
}, (table) => [index("idx_sales_incentive_note_result").on(table.resultId, table.createdAt)]);

export const salesIncentivePayrollLinks = sqliteTable("sales_incentive_payroll_links", {
  id: text("id").primaryKey(), resultId: text("result_id").notNull(), payrollPeriod: text("payroll_period").notNull(),
  payrollRecordId: text("payroll_record_id").notNull(), appliedAmount: integer("applied_amount").notNull(),
  appliedBy: text("applied_by").notNull(), appliedAt: integer("applied_at").notNull(),
}, (table) => [uniqueIndex("idx_sales_incentive_payroll_result").on(table.resultId),
  index("idx_sales_incentive_payroll_period").on(table.payrollPeriod, table.payrollRecordId)]);
