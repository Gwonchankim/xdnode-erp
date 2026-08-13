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
  position: text("position").notNull(),
  jobTitle: text("job_title").notNull(),
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
