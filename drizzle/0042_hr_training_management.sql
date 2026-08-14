CREATE TABLE IF NOT EXISTS hr_training_courses (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  course_type TEXT NOT NULL DEFAULT 'MANDATORY',
  year INTEGER NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT '',
  delivery_mode TEXT NOT NULL DEFAULT 'ONLINE',
  start_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  audience_type TEXT NOT NULL DEFAULT 'ALL',
  organization_id TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'DRAFT',
  created_by TEXT NOT NULL,
  opened_at INTEGER,
  closed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_training_course_year_title ON hr_training_courses(year, title);
CREATE INDEX IF NOT EXISTS idx_hr_training_course_status_due ON hr_training_courses(status, due_date);

CREATE TABLE IF NOT EXISTS hr_training_assignments (
  id TEXT PRIMARY KEY NOT NULL,
  course_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  employee_name TEXT NOT NULL,
  department TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'ASSIGNED',
  progress INTEGER NOT NULL DEFAULT 0,
  score REAL,
  completed_minutes INTEGER NOT NULL DEFAULT 0,
  evidence_name TEXT NOT NULL DEFAULT '',
  evidence_ref TEXT NOT NULL DEFAULT '',
  employee_note TEXT NOT NULL DEFAULT '',
  waiver_reason TEXT NOT NULL DEFAULT '',
  verified_by TEXT NOT NULL DEFAULT '',
  verified_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_training_assignment_course_employee ON hr_training_assignments(course_id, employee_id);
CREATE INDEX IF NOT EXISTS idx_hr_training_assignment_employee_status ON hr_training_assignments(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_hr_training_assignment_course_status ON hr_training_assignments(course_id, status);
