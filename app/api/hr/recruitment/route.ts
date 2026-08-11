import { env } from "cloudflare:workers";
import { companyEmployees } from "../../../hr-company-data";

type HrBindings = { DB: D1Database };
const db = (env as unknown as HrBindings).DB;
const employeeIds = new Set(companyEmployees.map((employee) => employee.id));

type ApplicantRow = {
  id: string; name: string; role: string; applied: string; owner_id: string; stage: string;
  experience: string; email: string; phone: string; source: string; summary: string;
  resume_file_name: string; resume_text: string; checklist_json: string; screening_memos_json: string;
  interview_json: string | null; interview_memos_json: string; updated_at: number;
};

async function ensureSchema() {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_recruiters (
      employee_id TEXT PRIMARY KEY, created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_applicants (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, applied TEXT NOT NULL,
      owner_id TEXT NOT NULL DEFAULT '', stage TEXT NOT NULL, experience TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL, phone TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
      resume_file_name TEXT NOT NULL DEFAULT '', resume_text TEXT NOT NULL DEFAULT '',
      checklist_json TEXT NOT NULL DEFAULT '[]', screening_memos_json TEXT NOT NULL DEFAULT '[]',
      interview_json TEXT, interview_memos_json TEXT NOT NULL DEFAULT '[]', updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_applicants_name ON hr_applicants (name)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_applicants_email ON hr_applicants (email)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_applicants_phone ON hr_applicants (phone)"),
    db.prepare("INSERT OR IGNORE INTO hr_recruiters (employee_id, created_at) VALUES ('gc.kim', 0)"),
  ]);
}

function safeJson<T>(value: string, fallback: T): T {
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function toApplicant(row: ApplicantRow) {
  const owner = companyEmployees.find((employee) => employee.id === row.owner_id)?.name ?? "미지정";
  return {
    id: row.id, name: row.name, role: row.role, applied: row.applied, ownerId: row.owner_id, owner,
    stage: row.stage, experience: row.experience, email: row.email, phone: row.phone, source: row.source,
    summary: row.summary, resumeFileName: row.resume_file_name, resumeText: row.resume_text,
    checklist: safeJson<string[]>(row.checklist_json, []),
    screeningMemos: safeJson<unknown[]>(row.screening_memos_json, []),
    interview: row.interview_json ? safeJson<unknown>(row.interview_json, undefined) : undefined,
    interviewMemos: safeJson<unknown[]>(row.interview_memos_json, []),
  };
}

export async function GET() {
  await ensureSchema();
  const [applicantResult, recruiterResult] = await Promise.all([
    db.prepare(`SELECT id, name, role, applied, owner_id, stage, experience, email, phone, source, summary,
      resume_file_name, resume_text, checklist_json, screening_memos_json, interview_json, interview_memos_json, updated_at
      FROM hr_applicants ORDER BY applied DESC, updated_at DESC`).all<ApplicantRow>(),
    db.prepare("SELECT employee_id FROM hr_recruiters ORDER BY created_at ASC").all<{ employee_id: string }>(),
  ]);
  return Response.json({ applicants: applicantResult.results.map(toApplicant), recruiterIds: recruiterResult.results.map((row: { employee_id: string }) => row.employee_id) });
}

export async function PUT(request: Request) {
  await ensureSchema();
  const body = await request.json() as Record<string, unknown>;
  const stringValue = (key: string) => typeof body[key] === "string" ? String(body[key]) : "";
  const id = stringValue("id").trim();
  const name = stringValue("name").trim();
  const email = stringValue("email").trim();
  if (!id || !name || !email) return Response.json({ error: "지원자 ID, 이름, 이메일이 필요합니다." }, { status: 400 });
  const interview = body.interview && typeof body.interview === "object" ? JSON.stringify(body.interview) : null;
  const updatedAt = Date.now();
  await db.prepare(`INSERT INTO hr_applicants
    (id, name, role, applied, owner_id, stage, experience, email, phone, source, summary, resume_file_name,
      resume_text, checklist_json, screening_memos_json, interview_json, interview_memos_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, role=excluded.role, applied=excluded.applied,
      owner_id=excluded.owner_id, stage=excluded.stage, experience=excluded.experience, email=excluded.email,
      phone=excluded.phone, source=excluded.source, summary=excluded.summary, resume_file_name=excluded.resume_file_name,
      resume_text=excluded.resume_text, checklist_json=excluded.checklist_json,
      screening_memos_json=excluded.screening_memos_json, interview_json=excluded.interview_json,
      interview_memos_json=excluded.interview_memos_json, updated_at=excluded.updated_at`)
    .bind(id, name, stringValue("role"), stringValue("applied"), stringValue("ownerId"), stringValue("stage"),
      stringValue("experience"), email, stringValue("phone"), stringValue("source"), stringValue("summary"),
      stringValue("resumeFileName"), stringValue("resumeText"), JSON.stringify(body.checklist ?? []),
      JSON.stringify(body.screeningMemos ?? []), interview, JSON.stringify(body.interviewMemos ?? []), updatedAt).run();
  return Response.json({ ok: true });
}

export async function POST(request: Request) {
  await ensureSchema();
  const body = await request.json() as { employeeId?: string };
  const employeeId = body.employeeId?.trim() ?? "";
  if (!employeeIds.has(employeeId)) return Response.json({ error: "회사에 등록된 재직자만 지정할 수 있습니다." }, { status: 400 });
  await db.prepare("INSERT OR IGNORE INTO hr_recruiters (employee_id, created_at) VALUES (?, ?)").bind(employeeId, Date.now()).run();
  return Response.json({ employeeId }, { status: 201 });
}

export async function DELETE(request: Request) {
  await ensureSchema();
  const body = await request.json() as { employeeId?: string };
  const employeeId = body.employeeId?.trim() ?? "";
  await db.prepare("DELETE FROM hr_recruiters WHERE employee_id = ?").bind(employeeId).run();
  return Response.json({ employeeId });
}
