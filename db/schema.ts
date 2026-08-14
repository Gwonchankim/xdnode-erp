import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const employeeInterviewRecords = sqliteTable("employee_interview_records", {
  id: text("id").primaryKey(),
  employeeId: text("employee_id").notNull(),
  interviewAt: text("interview_at").notNull(),
  transcript: text("transcript").notNull().default(""),
  memo: text("memo").notNull().default(""),
  audioKey: text("audio_key"),
  audioContentType: text("audio_content_type"),
  audioFileName: text("audio_file_name"),
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
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("idx_applicant_interview_recordings_applicant_created").on(table.applicantId, table.createdAt),
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
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_hr_applicants_name").on(table.name),
  index("idx_hr_applicants_email").on(table.email),
  index("idx_hr_applicants_phone").on(table.phone),
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

export const erpUserAccess = sqliteTable("erp_user_access", {
  employeeId: text("employee_id").primaryKey(),
  email: text("email").notNull().unique(),
  rolesJson: text("roles_json").notNull().default("[]"),
  active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

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
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, (table) => [
  index("idx_sales_documents_opportunity_type").on(table.opportunityId, table.documentType),
  index("idx_sales_documents_status_due").on(table.status, table.dueDate),
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
  index("idx_sales_incentive_period_employee").on(table.period, table.employeeId),
  index("idx_sales_incentive_status").on(table.status),
]);
