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
