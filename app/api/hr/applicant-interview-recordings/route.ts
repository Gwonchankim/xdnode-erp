import { env } from "cloudflare:workers";
import { authorizeErpRequest, writeErpAudit } from "../../../erp-platform";

type RecordingRow = {
  id: string;
  applicant_id: string;
  recorded_at: string;
  audio_key: string;
  audio_content_type: string;
  audio_file_name: string;
  consent_confirmed_by: string;
  consent_confirmed_at: number | null;
  created_at: number;
};

type HrBindings = {
  DB: D1Database;
  HR_AUDIO: R2Bucket;
};

const bindings = env as unknown as HrBindings;

async function ensureSchema() {
  await bindings.DB.batch([
    bindings.DB.prepare(`CREATE TABLE IF NOT EXISTS applicant_interview_recordings (
      id TEXT PRIMARY KEY, applicant_id TEXT NOT NULL, recorded_at TEXT NOT NULL,
      audio_key TEXT NOT NULL, audio_content_type TEXT NOT NULL, audio_file_name TEXT NOT NULL,
      consent_confirmed_by TEXT NOT NULL DEFAULT '', consent_confirmed_at INTEGER,
      created_at INTEGER NOT NULL
    )`),
    bindings.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_applicant_interview_recordings_applicant_created
      ON applicant_interview_recordings(applicant_id, created_at)`),
  ]);
}

function toRecording(row: RecordingRow) {
  return {
    id: row.id,
    applicantId: row.applicant_id,
    recordedAt: row.recorded_at,
    audioFileName: row.audio_file_name,
    audioUrl: `/api/hr/applicant-interview-recordings?audioId=${encodeURIComponent(row.id)}`,
    consentConfirmed: Boolean(row.consent_confirmed_at),
    createdAt: row.created_at,
  };
}

export async function GET(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(bindings.DB, "recruitment", "read");
  if (authorization.response) return authorization.response;
  const url = new URL(request.url);
  const audioId = url.searchParams.get("audioId")?.trim();

  if (audioId) {
    const row = await bindings.DB.prepare(`SELECT audio_key, audio_content_type
      FROM applicant_interview_recordings WHERE id = ?`)
      .bind(audioId)
      .first<{ audio_key: string; audio_content_type: string }>();
    if (!row?.audio_key) return new Response("녹음 파일을 찾을 수 없습니다.", { status: 404 });
    const audio = await bindings.HR_AUDIO.get(row.audio_key);
    if (!audio) return new Response("녹음 파일을 찾을 수 없습니다.", { status: 404 });
    return new Response(audio.body, {
      headers: {
        "Content-Type": row.audio_content_type || audio.httpMetadata?.contentType || "audio/webm",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  const applicantId = url.searchParams.get("applicantId")?.trim();
  if (!applicantId) return Response.json({ error: "applicantId가 필요합니다." }, { status: 400 });
  const result = await bindings.DB.prepare(`SELECT * FROM applicant_interview_recordings
    WHERE applicant_id = ? ORDER BY recorded_at DESC, created_at DESC`)
    .bind(applicantId)
    .all<RecordingRow>();
  return Response.json({ recordings: result.results.map(toRecording) });
}

export async function POST(request: Request) {
  await ensureSchema();
  const authorization = await authorizeErpRequest(bindings.DB, "recruitment", "write");
  if (authorization.response) return authorization.response;
  const form = await request.formData();
  const applicantId = String(form.get("applicantId") ?? "").trim();
  const recordedAt = String(form.get("recordedAt") ?? "").trim();
  const audio = form.get("audio");
  const consentConfirmed = String(form.get("consentConfirmed") ?? "") === "true";

  if (!applicantId || !recordedAt || !(audio instanceof File && audio.size)) {
    return Response.json({ error: "지원자, 녹음일시와 음성 파일이 필요합니다." }, { status: 400 });
  }
  if (!consentConfirmed) return Response.json({ error: "면접 녹음 저장에는 지원자의 동의 확인이 필요합니다." }, { status: 400 });
  if (audio.size > 25 * 1024 * 1024) {
    return Response.json({ error: "녹음 파일은 25MB 이하만 저장할 수 있습니다." }, { status: 413 });
  }
  const applicant = await bindings.DB.prepare("SELECT id FROM hr_applicants WHERE id = ?")
    .bind(applicantId)
    .first<{ id: string }>();
  if (!applicant) return Response.json({ error: "지원자를 찾을 수 없습니다." }, { status: 404 });

  const id = crypto.randomUUID();
  const audioContentType = audio.type.startsWith("audio/") ? audio.type : "audio/webm";
  const extension = audioContentType.includes("mp4") ? "m4a" : "webm";
  const audioFileName = `applicant-interview-${applicantId}-${Date.now()}.${extension}`;
  const audioKey = `applicant-interviews/${encodeURIComponent(applicantId)}/${id}.${extension}`;
  await bindings.HR_AUDIO.put(audioKey, await audio.arrayBuffer(), {
    httpMetadata: { contentType: audioContentType },
  });

  const createdAt = Date.now();
  try {
    await bindings.DB.prepare(`INSERT INTO applicant_interview_recordings
      (id, applicant_id, recorded_at, audio_key, audio_content_type, audio_file_name, consent_confirmed_by, consent_confirmed_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, applicantId, recordedAt, audioKey, audioContentType, audioFileName, authorization.principal.employeeId, createdAt, createdAt)
      .run();
  } catch (error) {
    await bindings.HR_AUDIO.delete(audioKey);
    throw error;
  }

  await writeErpAudit(bindings.DB, {
    principal: authorization.principal,
    module: "recruitment",
    action: "APPLICANT_INTERVIEW_AUDIO_RECORDED",
    entityType: "applicantInterviewRecording",
    entityId: id,
    after: { applicantId, recordedAt, audioFileName, consentConfirmed: true },
  });

  return Response.json({ recording: toRecording({
    id,
    applicant_id: applicantId,
    recorded_at: recordedAt,
    audio_key: audioKey,
    audio_content_type: audioContentType,
    audio_file_name: audioFileName,
    consent_confirmed_by: authorization.principal.employeeId,
    consent_confirmed_at: createdAt,
    created_at: createdAt,
  }) }, { status: 201 });
}
