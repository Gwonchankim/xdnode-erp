import { env } from "cloudflare:workers";

type InterviewRow = {
  id: string;
  employee_id: string;
  interview_at: string;
  transcript: string;
  memo: string;
  audio_key: string | null;
  audio_content_type: string | null;
  audio_file_name: string | null;
  created_at: number;
};

type HrBindings = {
  DB: D1Database;
  HR_AUDIO: R2Bucket;
};

const bindings = env as unknown as HrBindings;

async function ensureSchema() {
  await bindings.DB.batch([
    bindings.DB.prepare(`CREATE TABLE IF NOT EXISTS employee_interview_records (
      id TEXT PRIMARY KEY,
      employee_id TEXT NOT NULL,
      interview_at TEXT NOT NULL,
      transcript TEXT NOT NULL DEFAULT '',
      memo TEXT NOT NULL DEFAULT '',
      audio_key TEXT,
      audio_content_type TEXT,
      audio_file_name TEXT,
      created_at INTEGER NOT NULL
    )`),
    bindings.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_employee_interview_records_employee_created
      ON employee_interview_records(employee_id, created_at)`),
  ]);
}

function toRecord(row: InterviewRow) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    interviewAt: row.interview_at,
    transcript: row.transcript,
    memo: row.memo,
    audioFileName: row.audio_file_name,
    audioUrl: row.audio_key ? `/api/hr/interviews?audioId=${encodeURIComponent(row.id)}` : null,
    createdAt: row.created_at,
  };
}

export async function GET(request: Request) {
  await ensureSchema();
  const url = new URL(request.url);
  const audioId = url.searchParams.get("audioId");

  if (audioId) {
    const row = await bindings.DB.prepare("SELECT audio_key, audio_content_type FROM employee_interview_records WHERE id = ?")
      .bind(audioId)
      .first<{ audio_key: string | null; audio_content_type: string | null }>();
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

  const employeeId = url.searchParams.get("employeeId")?.trim();
  if (!employeeId) return Response.json({ error: "employeeId가 필요합니다." }, { status: 400 });
  const result = await bindings.DB.prepare("SELECT * FROM employee_interview_records WHERE employee_id = ? ORDER BY interview_at DESC, created_at DESC")
    .bind(employeeId)
    .all<InterviewRow>();
  return Response.json({ records: result.results.map(toRecord) });
}

export async function POST(request: Request) {
  await ensureSchema();
  const form = await request.formData();
  const employeeId = String(form.get("employeeId") ?? "").trim();
  const interviewAt = String(form.get("interviewAt") ?? "").trim();
  const transcript = String(form.get("transcript") ?? "").trim();
  const memo = String(form.get("memo") ?? "").trim();
  const audio = form.get("audio");

  if (!employeeId || !interviewAt || (!transcript && !memo && !(audio instanceof File && audio.size))) {
    return Response.json({ error: "면담일시와 전사기록, 메모 또는 녹음 중 하나가 필요합니다." }, { status: 400 });
  }
  if (audio instanceof File && audio.size > 25 * 1024 * 1024) {
    return Response.json({ error: "녹음 파일은 25MB 이하만 저장할 수 있습니다." }, { status: 413 });
  }

  const id = crypto.randomUUID();
  let audioKey: string | null = null;
  let audioContentType: string | null = null;
  let audioFileName: string | null = null;

  if (audio instanceof File && audio.size) {
    audioContentType = audio.type || "audio/webm";
    audioFileName = audio.name || `interview-${id}.webm`;
    const extension = audioFileName.split(".").pop()?.replace(/[^a-z0-9]/gi, "") || "webm";
    audioKey = `hr-interviews/${encodeURIComponent(employeeId)}/${id}.${extension}`;
    await bindings.HR_AUDIO.put(audioKey, await audio.arrayBuffer(), { httpMetadata: { contentType: audioContentType } });
  }

  const createdAt = Date.now();
  await bindings.DB.prepare(`INSERT INTO employee_interview_records
    (id, employee_id, interview_at, transcript, memo, audio_key, audio_content_type, audio_file_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, employeeId, interviewAt, transcript, memo, audioKey, audioContentType, audioFileName, createdAt)
    .run();

  return Response.json({ record: toRecord({
    id,
    employee_id: employeeId,
    interview_at: interviewAt,
    transcript,
    memo,
    audio_key: audioKey,
    audio_content_type: audioContentType,
    audio_file_name: audioFileName,
    created_at: createdAt,
  }) }, { status: 201 });
}
