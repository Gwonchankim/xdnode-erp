export type HrTranscriptionEntityType = "EMPLOYEE_INTERVIEW" | "APPLICANT_INTERVIEW";

export async function ensureHrTranscriptionSchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS hr_audio_transcriptions (
      id TEXT PRIMARY KEY NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
      audio_key_snapshot TEXT NOT NULL, audio_content_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PROCESSING', model TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'ko',
      transcript TEXT NOT NULL DEFAULT '', vtt TEXT NOT NULL DEFAULT '', word_count INTEGER NOT NULL DEFAULT 0,
      error_code TEXT NOT NULL DEFAULT '', error_message TEXT NOT NULL DEFAULT '', attempt INTEGER NOT NULL DEFAULT 1,
      consent_confirmed_by TEXT NOT NULL, consent_confirmed_at INTEGER NOT NULL,
      requested_by TEXT NOT NULL, requested_at INTEGER NOT NULL, completed_at INTEGER,
      reviewed_text TEXT NOT NULL DEFAULT '', review_note TEXT NOT NULL DEFAULT '',
      reviewed_by TEXT NOT NULL DEFAULT '', reviewed_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_hr_audio_transcription_entity_attempt ON hr_audio_transcriptions(entity_type, entity_id, attempt)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_audio_transcription_entity_created ON hr_audio_transcriptions(entity_type, entity_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_hr_audio_transcription_status_updated ON hr_audio_transcriptions(status, updated_at)"),
  ]);
}
