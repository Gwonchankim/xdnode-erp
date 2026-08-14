import { env } from "cloudflare:workers";
import { companyEmployees } from "../../../hr-company-data";
import { createApprovalRequest } from "../../../approval-engine";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";

type HrBindings = { DB: D1Database; HR_AUDIO: R2Bucket };
const bindings = env as unknown as HrBindings;
const db = bindings.DB;
const employeeIds = new Set(companyEmployees.map((employee) => employee.id));

type ApplicantRow = {
  id: string; name: string; role: string; applied: string; owner_id: string; stage: string;
  experience: string; email: string; phone: string; source: string; summary: string;
  resume_file_name: string; resume_text: string; checklist_json: string; screening_memos_json: string;
  interview_json: string | null; interview_memos_json: string; updated_at: number;
};
type OfferRow = {
  id: string; applicant_id: string; proposed_title: string; department: string; employment_type: string;
  start_date: string; annual_salary: number; probation_months: number; notes: string; status: string;
  requested_by: string; approved_by: string; approved_at: number | null; responded_at: number | null;
  created_at: number; updated_at: number;
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
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_offer_requests (
      id TEXT PRIMARY KEY NOT NULL, applicant_id TEXT NOT NULL, proposed_title TEXT NOT NULL,
      department TEXT NOT NULL, employment_type TEXT NOT NULL, start_date TEXT NOT NULL,
      annual_salary INTEGER NOT NULL, probation_months INTEGER NOT NULL DEFAULT 3, notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'SUBMITTED', requested_by TEXT NOT NULL, approved_by TEXT NOT NULL DEFAULT '',
      approved_at INTEGER, responded_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_applicants_name ON hr_applicants (name)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_applicants_email ON hr_applicants (email)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_applicants_phone ON hr_applicants (phone)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_offer_applicant_created ON hr_offer_requests(applicant_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_offer_status_start ON hr_offer_requests(status, start_date)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS applicant_interview_recordings (
      id TEXT PRIMARY KEY, applicant_id TEXT NOT NULL, recorded_at TEXT NOT NULL,
      audio_key TEXT NOT NULL, audio_content_type TEXT NOT NULL, audio_file_name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_applicant_interview_recordings_applicant_created
      ON applicant_interview_recordings(applicant_id, created_at)`),
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

function toOffer(row: OfferRow) {
  return {
    id: row.id, applicantId: row.applicant_id, proposedTitle: row.proposed_title, department: row.department,
    employmentType: row.employment_type, startDate: row.start_date, annualSalary: row.annual_salary,
    probationMonths: row.probation_months, notes: row.notes, status: row.status,
    requestedBy: row.requested_by, approvedBy: row.approved_by, approvedAt: row.approved_at, respondedAt: row.responded_at,
  };
}

const offerStage = (status: string) => ({ SUBMITTED: "채용 제안 결재 중", APPROVED: "채용 제안 승인", REJECTED: "채용 제안 반려", ACCEPTED: "입사 확정", DECLINED: "채용 제안 거절" })[status];

export async function GET() {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "recruitment", "read");
  if (authorization.response) return authorization.response;
  const [applicantResult, recruiterResult, offerResult] = await Promise.all([
    db.prepare(`SELECT id, name, role, applied, owner_id, stage, experience, email, phone, source, summary,
      resume_file_name, resume_text, checklist_json, screening_memos_json, interview_json, interview_memos_json, updated_at
      FROM hr_applicants ORDER BY applied DESC, updated_at DESC`).all<ApplicantRow>(),
    db.prepare("SELECT employee_id FROM hr_recruiters ORDER BY created_at ASC").all<{ employee_id: string }>(),
    db.prepare("SELECT * FROM hr_offer_requests ORDER BY created_at DESC").all<OfferRow>(),
  ]);
  const latestOffer = new Map<string, ReturnType<typeof toOffer>>();
  offerResult.results.forEach((row) => { if (!latestOffer.has(row.applicant_id)) latestOffer.set(row.applicant_id, toOffer(row)); });
  return Response.json({
    applicants: applicantResult.results.map((row) => {
      const offer = latestOffer.get(row.id);
      return { ...toApplicant(row), ...(offerStage(offer?.status ?? "") ? { stage: offerStage(offer?.status ?? "") } : {}), offer };
    }),
    recruiterIds: recruiterResult.results.map((row: { employee_id: string }) => row.employee_id),
    offers: offerResult.results.map(toOffer),
  });
}

export async function PUT(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "recruitment", "write");
  if (authorization.response) return authorization.response;
  const body = await request.json() as Record<string, unknown>;
  const stringValue = (key: string) => typeof body[key] === "string" ? String(body[key]) : "";
  const id = stringValue("id").trim();
  const name = stringValue("name").trim();
  const email = stringValue("email").trim();
  if (!id || !name || !email) return Response.json({ error: "지원자 ID, 이름, 이메일이 필요합니다." }, { status: 400 });
  const interview = body.interview && typeof body.interview === "object" ? JSON.stringify(body.interview) : null;
  const updatedAt = Date.now();
  const before = await db.prepare("SELECT * FROM hr_applicants WHERE id = ?").bind(id).first<ApplicantRow>();
  const latestOffer = await db.prepare("SELECT status FROM hr_offer_requests WHERE applicant_id = ? ORDER BY created_at DESC LIMIT 1")
    .bind(id).first<{ status: string }>();
  const stage = offerStage(latestOffer?.status ?? "") ?? stringValue("stage");
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
    .bind(id, name, stringValue("role"), stringValue("applied"), stringValue("ownerId"), stage,
      stringValue("experience"), email, stringValue("phone"), stringValue("source"), stringValue("summary"),
      stringValue("resumeFileName"), stringValue("resumeText"), JSON.stringify(body.checklist ?? []),
      JSON.stringify(body.screeningMemos ?? []), interview, JSON.stringify(body.interviewMemos ?? []), updatedAt).run();
  const after = await db.prepare("SELECT * FROM hr_applicants WHERE id = ?").bind(id).first<ApplicantRow>();
  await writeErpAudit(db, {
    principal: authorization.principal,
    module: "recruitment",
    action: before ? "APPLICANT_UPDATED" : "APPLICANT_CREATED",
    entityType: "applicant",
    entityId: id,
    before: before ? toApplicant(before) : null,
    after: after ? toApplicant(after) : null,
  });
  return Response.json({ ok: true });
}

export async function POST(request: Request) {
  await ensureSchema();
  const body = await request.json() as Record<string, unknown>;
  const resource = String(body.resource ?? "recruiter");
  if (resource === "offer") {
    const authorization = await authorizeErpRequest(db, "recruitment", "write");
    if (authorization.response) return authorization.response;
    const applicantId = String(body.applicantId ?? "").trim();
    const proposedTitle = String(body.proposedTitle ?? "").trim();
    const department = String(body.department ?? "").trim();
    const employmentType = String(body.employmentType ?? "").trim();
    const startDate = String(body.startDate ?? "").trim();
    const annualSalary = Number(body.annualSalary);
    const probationMonths = Number(body.probationMonths ?? 3);
    const applicant = await db.prepare("SELECT * FROM hr_applicants WHERE id = ?").bind(applicantId).first<ApplicantRow>();
    if (!applicant || !proposedTitle || !department || !employmentType || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)
      || !Number.isFinite(annualSalary) || annualSalary <= 0 || !Number.isInteger(probationMonths) || probationMonths < 0 || probationMonths > 12) {
      return Response.json({ error: "지원자·직무·소속·고용형태·입사예정일·연봉·수습기간을 확인해 주세요." }, { status: 400 });
    }
    const active = await db.prepare(`SELECT id FROM hr_offer_requests WHERE applicant_id = ?
      AND status IN ('SUBMITTED', 'APPROVED') ORDER BY created_at DESC LIMIT 1`).bind(applicantId).first<{ id: string }>();
    if (active) return Response.json({ error: "진행 중이거나 승인된 채용 제안이 이미 있습니다." }, { status: 409 });
    const id = crypto.randomUUID();
    const now = Date.now();
    await db.prepare(`INSERT INTO hr_offer_requests
      (id, applicant_id, proposed_title, department, employment_type, start_date, annual_salary,
        probation_months, notes, status, requested_by, approved_by, approved_at, responded_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SUBMITTED', ?, '', NULL, NULL, ?, ?)`)
      .bind(id, applicantId, proposedTitle, department, employmentType, startDate, Math.round(annualSalary), probationMonths,
        String(body.notes ?? "").trim(), authorization.principal.employeeId, now, now).run();
    try {
      const approval = await createApprovalRequest(db, authorization.principal, {
        module: "recruitment", requestType: "OFFER", title: `${applicant.name} 채용 제안 승인`,
        description: `${department} · ${proposedTitle} · 연봉 ${Math.round(annualSalary).toLocaleString("ko-KR")}원 · ${startDate} 입사 예정`,
        targetEntityType: "RECRUITMENT_OFFER", targetEntityId: id, amount: Math.round(annualSalary), dueDate: startDate,
        priority: "HIGH", metadata: { applicantId, proposedTitle, department, employmentType, startDate, probationMonths },
      });
      const row = await db.prepare("SELECT * FROM hr_offer_requests WHERE id = ?").bind(id).first<OfferRow>();
      await writeErpAudit(db, { principal: authorization.principal, module: "recruitment", action: "OFFER_APPROVAL_SUBMITTED", entityType: "recruitmentOffer", entityId: id, after: row ? toOffer(row) : body });
      return Response.json({ offer: row ? toOffer(row) : null, approvalSubmitted: true, approvalId: approval.id }, { status: 202 });
    } catch (error) {
      await db.prepare("DELETE FROM hr_offer_requests WHERE id = ?").bind(id).run();
      return Response.json({ error: error instanceof Error ? error.message : "채용 제안 결재선을 만들지 못했습니다." }, { status: 409 });
    }
  }

  const authorization = await authorizeErpRequest(db, "recruitment", "approve");
  if (authorization.response) return authorization.response;
  const employeeId = String(body.employeeId ?? "").trim();
  if (!employeeIds.has(employeeId)) return Response.json({ error: "회사에 등록된 재직자만 지정할 수 있습니다." }, { status: 400 });
  await db.prepare("INSERT OR IGNORE INTO hr_recruiters (employee_id, created_at) VALUES (?, ?)").bind(employeeId, Date.now()).run();
  await writeErpAudit(db, {
    principal: authorization.principal,
    module: "recruitment",
    action: "RECRUITER_ASSIGNED",
    entityType: "recruiter",
    entityId: employeeId,
    after: { employeeId },
  });
  return Response.json({ employeeId }, { status: 201 });
}

export async function DELETE(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "recruitment", "delete");
  if (authorization.response) return authorization.response;
  const body = await request.json() as { employeeId?: string; applicantId?: string };
  const applicantId = body.applicantId?.trim() ?? "";
  if (applicantId) {
    const applicant = await db.prepare("SELECT * FROM hr_applicants WHERE id = ?").bind(applicantId).first<ApplicantRow>();
    if (!applicant) return Response.json({ error: "삭제할 지원자를 찾을 수 없습니다." }, { status: 404 });

    const recordingResult = await db.prepare("SELECT audio_key FROM applicant_interview_recordings WHERE applicant_id = ?")
      .bind(applicantId)
      .all<{ audio_key: string }>();
    const audioKeys = recordingResult.results.map((row) => row.audio_key).filter(Boolean);
    if (audioKeys.length) await bindings.HR_AUDIO.delete(audioKeys);
    await db.batch([
      db.prepare("DELETE FROM applicant_interview_recordings WHERE applicant_id = ?").bind(applicantId),
      db.prepare("DELETE FROM hr_offer_requests WHERE applicant_id = ?").bind(applicantId),
      db.prepare("DELETE FROM hr_applicants WHERE id = ?").bind(applicantId),
    ]);
    await writeErpAudit(db, {
      principal: authorization.principal,
      module: "recruitment",
      action: "APPLICANT_DELETED",
      entityType: "applicant",
      entityId: applicantId,
      before: toApplicant(applicant),
    });
    return Response.json({ applicantId });
  }

  const employeeId = body.employeeId?.trim() ?? "";
  if (!employeeId) return Response.json({ error: "삭제할 대상이 필요합니다." }, { status: 400 });
  await db.prepare("DELETE FROM hr_recruiters WHERE employee_id = ?").bind(employeeId).run();
  await writeErpAudit(db, {
    principal: authorization.principal,
    module: "recruitment",
    action: "RECRUITER_REMOVED",
    entityType: "recruiter",
    entityId: employeeId,
    before: { employeeId },
  });
  return Response.json({ employeeId });
}
