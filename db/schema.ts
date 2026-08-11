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

export const hrOrganizationLeaders = sqliteTable("hr_organization_leaders", {
  organizationId: text("organization_id").primaryKey(),
  leaderEmployeeId: text("leader_employee_id"),
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
