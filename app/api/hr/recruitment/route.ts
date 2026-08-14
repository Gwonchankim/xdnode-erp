import { env } from "cloudflare:workers";
import { companyEmployees, companyOrganizations } from "../../../hr-company-data";
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
  interview_json: string | null; interview_memos_json: string; requisition_id: string; updated_at: number;
};
type OfferRow = {
  id: string; applicant_id: string; proposed_title: string; department: string; employment_type: string;
  start_date: string; annual_salary: number; probation_months: number; notes: string; status: string;
  requested_by: string; approved_by: string; approved_at: number | null; employee_id: string;
  response_note: string; responded_by: string; responded_at: number | null;
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
      interview_json TEXT, interview_memos_json TEXT NOT NULL DEFAULT '[]',
      requisition_id TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_offer_requests (
      id TEXT PRIMARY KEY NOT NULL, applicant_id TEXT NOT NULL, proposed_title TEXT NOT NULL,
      department TEXT NOT NULL, employment_type TEXT NOT NULL, start_date TEXT NOT NULL,
      annual_salary INTEGER NOT NULL, probation_months INTEGER NOT NULL DEFAULT 3, notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'SUBMITTED', requested_by TEXT NOT NULL, approved_by TEXT NOT NULL DEFAULT '',
      approved_at INTEGER, employee_id TEXT NOT NULL DEFAULT '', response_note TEXT NOT NULL DEFAULT '',
      responded_by TEXT NOT NULL DEFAULT '', responded_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_employee_records (
      employee_id TEXT PRIMARY KEY, name TEXT NOT NULL, birth TEXT NOT NULL, email TEXT NOT NULL,
      phone TEXT NOT NULL, address TEXT NOT NULL, department TEXT NOT NULL, manager TEXT NOT NULL,
      employment_type TEXT NOT NULL, join_date TEXT NOT NULL DEFAULT '', position TEXT NOT NULL,
      job_title TEXT NOT NULL, status TEXT NOT NULL DEFAULT '재직', history_json TEXT NOT NULL DEFAULT '[]',
      retirement_json TEXT, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_organization_records (
      organization_id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, description TEXT NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_lifecycle_tasks (
      id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, lifecycle_type TEXT NOT NULL, task_group TEXT NOT NULL,
      title TEXT NOT NULL, owner_employee_id TEXT NOT NULL DEFAULT '', due_date TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'OPEN', completed_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_applicants_name ON hr_applicants (name)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_applicants_email ON hr_applicants (email)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_applicants_phone ON hr_applicants (phone)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_offer_applicant_created ON hr_offer_requests(applicant_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_offer_status_start ON hr_offer_requests(status, start_date)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_recruitment_requisitions (
      id TEXT PRIMARY KEY NOT NULL, workforce_plan_id TEXT NOT NULL, workforce_plan_line_id TEXT NOT NULL,
      organization_id TEXT NOT NULL, title TEXT NOT NULL, role TEXT NOT NULL,
      requested_headcount INTEGER NOT NULL DEFAULT 1, owner_employee_id TEXT NOT NULL,
      target_start_date TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT',
      requested_by TEXT NOT NULL, approved_by TEXT NOT NULL DEFAULT '', approved_at INTEGER,
      closed_by TEXT NOT NULL DEFAULT '', closed_at INTEGER, close_reason TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS applicant_interview_recordings (
      id TEXT PRIMARY KEY, applicant_id TEXT NOT NULL, recorded_at TEXT NOT NULL,
      audio_key TEXT NOT NULL, audio_content_type TEXT NOT NULL, audio_file_name TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_applicant_interview_recordings_applicant_created
      ON applicant_interview_recordings(applicant_id, created_at)`),
    db.prepare("INSERT OR IGNORE INTO hr_recruiters (employee_id, created_at) VALUES ('gc.kim', 0)"),
  ]);
  const offerColumns = await db.prepare("PRAGMA table_info(hr_offer_requests)").all<{ name: string }>();
  const existing = new Set(offerColumns.results.map((column) => column.name));
  for (const [name, definition] of [
    ["employee_id", "TEXT NOT NULL DEFAULT ''"],
    ["response_note", "TEXT NOT NULL DEFAULT ''"],
    ["responded_by", "TEXT NOT NULL DEFAULT ''"],
  ].filter(([name]) => !existing.has(name))) {
    await db.prepare(`ALTER TABLE hr_offer_requests ADD COLUMN ${name} ${definition}`).run();
  }
  const applicantColumns = await db.prepare("PRAGMA table_info(hr_applicants)").all<{ name: string }>();
  if (!applicantColumns.results.some((column) => column.name === "requisition_id")) {
    await db.prepare("ALTER TABLE hr_applicants ADD COLUMN requisition_id TEXT NOT NULL DEFAULT ''").run();
  }
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_applicants_requisition ON hr_applicants(requisition_id)").run();
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
    requisitionId: row.requisition_id,
  };
}

function toOffer(row: OfferRow) {
  return {
    id: row.id, applicantId: row.applicant_id, proposedTitle: row.proposed_title, department: row.department,
    employmentType: row.employment_type, startDate: row.start_date, annualSalary: row.annual_salary,
    probationMonths: row.probation_months, notes: row.notes, status: row.status,
    requestedBy: row.requested_by, approvedBy: row.approved_by, approvedAt: row.approved_at,
    employeeId: row.employee_id, responseNote: row.response_note, respondedBy: row.responded_by,
    respondedAt: row.responded_at,
  };
}

const offerStage = (status: string) => ({ SUBMITTED: "채용 제안 결재 중", APPROVED: "채용 제안 승인", REJECTED: "채용 제안 반려", ACCEPTED: "입사 확정", DECLINED: "채용 제안 거절" })[status];

export async function GET() {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "recruitment", "read");
  if (authorization.response) return authorization.response;
  const [applicantResult, recruiterResult, offerResult, requisitionResult] = await Promise.all([
    db.prepare(`SELECT id, name, role, applied, owner_id, stage, experience, email, phone, source, summary,
      resume_file_name, resume_text, checklist_json, screening_memos_json, interview_json, interview_memos_json, requisition_id, updated_at
      FROM hr_applicants ORDER BY applied DESC, updated_at DESC`).all<ApplicantRow>(),
    db.prepare("SELECT employee_id FROM hr_recruiters ORDER BY created_at ASC").all<{ employee_id: string }>(),
    db.prepare("SELECT * FROM hr_offer_requests ORDER BY created_at DESC").all<OfferRow>(),
    db.prepare(`SELECT id, title, role, organization_id, requested_headcount, status
      FROM hr_recruitment_requisitions WHERE status IN ('OPEN','DRAFT','SUBMITTED') ORDER BY created_at DESC`)
      .all<{ id: string; title: string; role: string; organization_id: string; requested_headcount: number; status: string }>(),
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
    requisitions: requisitionResult.results.map((row) => ({ id: row.id, title: row.title, role: row.role, organizationId: row.organization_id, requestedHeadcount: row.requested_headcount, status: row.status })),
  });
}

export async function PUT(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(db, "recruitment", "write");
  if (authorization.response) return authorization.response;
  const body = await request.json() as Record<string, unknown>;
  const stringValue = (key: string) => typeof body[key] === "string" ? String(body[key]) : "";
  const id = stringValue("id").trim();
  const resource = stringValue("resource").trim();
  if (resource === "offerResponse") {
    const action = stringValue("action").trim().toUpperCase();
    if (!id || !["ACCEPT", "DECLINE"].includes(action)) return Response.json({ error: "채용 제안과 응답 결과를 확인해 주세요." }, { status: 400 });
    const offer = await db.prepare("SELECT * FROM hr_offer_requests WHERE id = ?").bind(id).first<OfferRow>();
    if (!offer) return Response.json({ error: "채용 제안을 찾을 수 없습니다." }, { status: 404 });
    if (offer.status !== "APPROVED") return Response.json({ error: "승인 완료된 채용 제안만 수락 또는 거절 처리할 수 있습니다." }, { status: 409 });
    const applicant = await db.prepare("SELECT * FROM hr_applicants WHERE id = ?").bind(offer.applicant_id).first<ApplicantRow>();
    if (!applicant) return Response.json({ error: "지원자 정보를 찾을 수 없습니다." }, { status: 404 });
    const now = Date.now();
    const responseNote = stringValue("responseNote").trim();
    if (action === "DECLINE") {
      await db.batch([
        db.prepare(`UPDATE hr_offer_requests SET status = 'DECLINED', response_note = ?, responded_by = ?, responded_at = ?, updated_at = ?
          WHERE id = ? AND status = 'APPROVED'`).bind(responseNote, authorization.principal.employeeId, now, now, id),
        db.prepare(`UPDATE hr_applicants SET stage = '채용 제안 거절', updated_at = ? WHERE id = ?
          AND EXISTS (SELECT 1 FROM hr_offer_requests WHERE id = ? AND status = 'DECLINED' AND updated_at = ?)`)
          .bind(now, offer.applicant_id, id, now),
      ]);
      const after = await db.prepare("SELECT * FROM hr_offer_requests WHERE id = ?").bind(id).first<OfferRow>();
      await writeErpAudit(db, { principal: authorization.principal, module: "recruitment", action: "OFFER_DECLINED", entityType: "recruitmentOffer", entityId: id, before: toOffer(offer), after: after ? toOffer(after) : null, reason: responseNote });
      return Response.json({ offer: after ? toOffer(after) : null });
    }

    const hrAuthorization = await authorizeErpRequest(db, "hr", "write");
    if (hrAuthorization.response) return hrAuthorization.response;
    if (applicant.requisition_id) {
      const requisition = await db.prepare("SELECT requested_headcount, status FROM hr_recruitment_requisitions WHERE id = ?")
        .bind(applicant.requisition_id).first<{ requested_headcount: number; status: string }>();
      const filled = await db.prepare(`SELECT COUNT(DISTINCT a.id) AS count FROM hr_applicants a
        JOIN hr_offer_requests o ON o.applicant_id = a.id
        WHERE a.requisition_id = ? AND o.status = 'ACCEPTED'`).bind(applicant.requisition_id).first<{ count: number }>();
      if (!requisition || requisition.status !== "OPEN" || (filled?.count ?? 0) >= requisition.requested_headcount) {
        return Response.json({ error: "연결된 TO의 잔여 인원이 없어 입사 전환할 수 없습니다. 정원과 채용요청을 다시 확인해 주세요." }, { status: 409 });
      }
    }
    const employeeId = stringValue("employeeId").trim();
    const position = stringValue("position").trim();
    const jobTitle = stringValue("jobTitle").trim() || offer.proposed_title;
    if (!employeeId || !position || !jobTitle) return Response.json({ error: "입사 전환을 위한 사번·직급·직책을 입력해 주세요." }, { status: 400 });
    if (employeeIds.has(employeeId)) return Response.json({ error: "이미 회사 기준자료에 등록된 사번입니다." }, { status: 409 });
    const duplicate = await db.prepare("SELECT employee_id FROM hr_employee_records WHERE employee_id = ?")
      .bind(employeeId).first<{ employee_id: string }>();
    if (duplicate) return Response.json({ error: "이미 등록된 사번입니다." }, { status: 409 });
    const history = [{ date: offer.start_date.replaceAll("-", "."), type: "입사 예정", detail: `${offer.department} · ${jobTitle} · 채용 제안 수락` }];
    const taskTemplates = [
      ["CONTRACT", "근로계약서 작성·서명"], ["ACCOUNT", "이메일·업무 계정 발급"],
      ["EQUIPMENT", "장비·출입권한 준비"], ["ORIENTATION", "오리엔테이션·부서 인수인계"],
    ];
    const statements = [
      db.prepare(`UPDATE hr_offer_requests SET status = 'ACCEPTED', employee_id = ?, response_note = ?, responded_by = ?, responded_at = ?, updated_at = ?
        WHERE id = ? AND status = 'APPROVED' AND (
          NOT EXISTS (SELECT 1 FROM hr_applicants a WHERE a.id = hr_offer_requests.applicant_id AND TRIM(a.requisition_id) <> '')
          OR EXISTS (SELECT 1 FROM hr_applicants a JOIN hr_recruitment_requisitions r ON r.id = a.requisition_id
            WHERE a.id = hr_offer_requests.applicant_id AND r.status = 'OPEN'
              AND r.requested_headcount > (SELECT COUNT(DISTINCT accepted.id) FROM hr_applicants accepted
                JOIN hr_offer_requests accepted_offer ON accepted_offer.applicant_id = accepted.id
                WHERE accepted.requisition_id = r.id AND accepted_offer.status = 'ACCEPTED'))
        )`).bind(employeeId, responseNote, authorization.principal.employeeId, now, now, id),
      db.prepare(`UPDATE hr_applicants SET stage = '입사 확정', updated_at = ? WHERE id = ?
        AND EXISTS (SELECT 1 FROM hr_offer_requests WHERE id = ? AND status = 'ACCEPTED' AND updated_at = ?)`)
        .bind(now, offer.applicant_id, id, now),
      db.prepare(`INSERT INTO hr_employee_records
        (employee_id, name, birth, email, phone, address, department, manager, employment_type, join_date,
          position, job_title, status, history_json, retirement_json, updated_at)
        SELECT ?, ?, '', ?, ?, '', ?, '', ?, ?, ?, ?, '입사 예정', ?, NULL, ?
        WHERE EXISTS (SELECT 1 FROM hr_offer_requests WHERE id = ? AND status = 'ACCEPTED' AND updated_at = ?)`)
        .bind(employeeId, applicant.name, applicant.email, applicant.phone, offer.department, offer.employment_type,
          offer.start_date.replaceAll("-", "."), position, jobTitle, JSON.stringify(history), now, id, now),
      ...taskTemplates.map(([group, title]) => db.prepare(`INSERT INTO hr_lifecycle_tasks
        (id, employee_id, lifecycle_type, task_group, title, owner_employee_id, due_date, status, completed_at, created_at, updated_at)
        SELECT ?, ?, 'ONBOARDING', ?, ?, ?, ?, 'OPEN', NULL, ?, ?
        WHERE EXISTS (SELECT 1 FROM hr_offer_requests WHERE id = ? AND status = 'ACCEPTED' AND updated_at = ?)`)
        .bind(`${id}:ONBOARDING:${group}`, employeeId, group, title, authorization.principal.employeeId, offer.start_date, now, now, id, now)),
    ];
    if (applicant.requisition_id) {
      statements.push(db.prepare(`UPDATE hr_recruitment_requisitions SET status = 'FILLED', closed_by = ?, closed_at = ?,
        close_reason = '요청 인원 입사 확정', updated_at = ? WHERE id = ? AND status = 'OPEN'
          AND requested_headcount <= (SELECT COUNT(DISTINCT a.id) FROM hr_applicants a
            JOIN hr_offer_requests o ON o.applicant_id = a.id
            WHERE a.requisition_id = ? AND o.status = 'ACCEPTED')`)
        .bind(authorization.principal.employeeId, now, now, applicant.requisition_id, applicant.requisition_id));
    }
    const result = await db.batch(statements);
    if ((result[0].meta.changes ?? 0) < 1) return Response.json({ error: "채용 제안 상태가 변경되어 입사 전환하지 못했습니다." }, { status: 409 });
    const after = await db.prepare("SELECT * FROM hr_offer_requests WHERE id = ?").bind(id).first<OfferRow>();
    await writeErpAudit(db, { principal: hrAuthorization.principal, module: "hr", action: "ONBOARDING_CREATED", entityType: "employeeRecord", entityId: employeeId, before: toOffer(offer), after: { offer: after ? toOffer(after) : null, employeeId, tasks: taskTemplates.map((item) => item[1]) }, reason: responseNote });
    return Response.json({ offer: after ? toOffer(after) : null, employeeId }, { status: 201 });
  }
  const name = stringValue("name").trim();
  const email = stringValue("email").trim();
  if (!id || !name || !email) return Response.json({ error: "지원자 ID, 이름, 이메일이 필요합니다." }, { status: 400 });
  const interview = body.interview && typeof body.interview === "object" ? JSON.stringify(body.interview) : null;
  const requisitionId = stringValue("requisitionId").trim();
  if (requisitionId) {
    const requisition = await db.prepare("SELECT id, status FROM hr_recruitment_requisitions WHERE id = ?").bind(requisitionId).first<{ id: string; status: string }>();
    if (!requisition || requisition.status !== "OPEN") return Response.json({ error: "모집 중인 채용요청·TO만 지원자에게 연결할 수 있습니다." }, { status: 409 });
  }
  const updatedAt = Date.now();
  const before = await db.prepare("SELECT * FROM hr_applicants WHERE id = ?").bind(id).first<ApplicantRow>();
  const latestOffer = await db.prepare("SELECT status FROM hr_offer_requests WHERE applicant_id = ? ORDER BY created_at DESC LIMIT 1")
    .bind(id).first<{ status: string }>();
  const stage = offerStage(latestOffer?.status ?? "") ?? stringValue("stage");
  await db.prepare(`INSERT INTO hr_applicants
    (id, name, role, applied, owner_id, stage, experience, email, phone, source, summary, resume_file_name,
      resume_text, checklist_json, screening_memos_json, interview_json, interview_memos_json, requisition_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name, role=excluded.role, applied=excluded.applied,
      owner_id=excluded.owner_id, stage=excluded.stage, experience=excluded.experience, email=excluded.email,
      phone=excluded.phone, source=excluded.source, summary=excluded.summary, resume_file_name=excluded.resume_file_name,
      resume_text=excluded.resume_text, checklist_json=excluded.checklist_json,
      screening_memos_json=excluded.screening_memos_json, interview_json=excluded.interview_json,
      interview_memos_json=excluded.interview_memos_json, requisition_id=excluded.requisition_id, updated_at=excluded.updated_at`)
    .bind(id, name, stringValue("role"), stringValue("applied"), stringValue("ownerId"), stage,
      stringValue("experience"), email, stringValue("phone"), stringValue("source"), stringValue("summary"),
      stringValue("resumeFileName"), stringValue("resumeText"), JSON.stringify(body.checklist ?? []),
      JSON.stringify(body.screeningMemos ?? []), interview, JSON.stringify(body.interviewMemos ?? []), requisitionId, updatedAt).run();
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
    if (applicant.requisition_id) {
      const requisition = await db.prepare(`SELECT id, organization_id, requested_headcount, status
        FROM hr_recruitment_requisitions WHERE id = ?`).bind(applicant.requisition_id)
        .first<{ id: string; organization_id: string; requested_headcount: number; status: string }>();
      if (!requisition || requisition.status !== "OPEN") return Response.json({ error: "연결된 채용요청·TO가 모집 중 상태가 아닙니다." }, { status: 409 });
      const filled = await db.prepare(`SELECT COUNT(DISTINCT a.id) AS count FROM hr_applicants a
        JOIN hr_offer_requests o ON o.applicant_id = a.id
        WHERE a.requisition_id = ? AND o.status = 'ACCEPTED'`).bind(requisition.id).first<{ count: number }>();
      if ((filled?.count ?? 0) >= requisition.requested_headcount) return Response.json({ error: "연결된 TO의 요청 인원이 이미 모두 충원되었습니다." }, { status: 409 });
      const savedOrganization = await db.prepare("SELECT name FROM hr_organization_records WHERE organization_id = ?")
        .bind(requisition.organization_id).first<{ name: string }>();
      const expectedDepartment = savedOrganization?.name ?? companyOrganizations.find((item) => item.id === requisition.organization_id)?.name ?? "";
      if (expectedDepartment && department !== expectedDepartment) return Response.json({ error: `채용 제안 소속은 연결된 TO의 조직(${expectedDepartment})과 같아야 합니다.` }, { status: 409 });
    }
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
        priority: "HIGH", metadata: { applicantId, requisitionId: applicant.requisition_id, proposedTitle, department, employmentType, startDate, probationMonths },
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
    const acceptedOffer = await db.prepare("SELECT employee_id FROM hr_offer_requests WHERE applicant_id = ? AND status = 'ACCEPTED' LIMIT 1")
      .bind(applicantId).first<{ employee_id: string }>();
    if (acceptedOffer) return Response.json({ error: `입사 전환된 지원자는 삭제할 수 없습니다. 인사기록카드(${acceptedOffer.employee_id})에서 생애주기를 관리해 주세요.` }, { status: 409 });

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
