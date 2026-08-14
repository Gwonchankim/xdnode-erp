import type { ErpPrincipal } from "./erp-platform";
import type { FinanceAssistantEvidence } from "./finance-assistant-evidence";

export const FINANCE_ASSISTANT_PROMPT_VERSION = "finance-evidence-v2";

export type FinanceAssistantAnswerPayload = {
  answer: string;
  provider: "AI" | "RULE_BASED_FALLBACK";
  evidenceStatus: "VERIFIED" | "REVIEW_REQUIRED";
  evidenceLabel: string;
  basisAsOf: string;
  sources: FinanceAssistantEvidence["sources"];
  limitations: string[];
  quotaExceeded: boolean;
};

type HistoryRow = {
  id: string; question: string; answer: string; provider: FinanceAssistantAnswerPayload["provider"];
  evidence_status: FinanceAssistantAnswerPayload["evidenceStatus"]; basis_as_of: string; evidence_json: string;
  evidence_hash: string; answer_hash: string; prompt_version: string; created_by_employee_id: string;
  created_by_name: string; created_at: number;
};

async function sha256(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

export async function buildFinanceAssistantHashes(question: string, answer: string,
  provider: FinanceAssistantAnswerPayload["provider"], evidence: FinanceAssistantEvidence) {
  const evidenceJson = JSON.stringify(evidence); const evidenceHash = await sha256(evidenceJson);
  const answerHash = await sha256(JSON.stringify({ question, answer, provider, evidenceHash,
    promptVersion: FINANCE_ASSISTANT_PROMPT_VERSION }));
  return { evidenceJson, evidenceHash, answerHash };
}

export async function ensureFinanceAssistantHistorySchema(db: D1Database) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS finance_assistant_answers (
      id TEXT PRIMARY KEY NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, provider TEXT NOT NULL,
      evidence_status TEXT NOT NULL, basis_as_of TEXT NOT NULL, evidence_json TEXT NOT NULL,
      evidence_hash TEXT NOT NULL, answer_hash TEXT NOT NULL, prompt_version TEXT NOT NULL,
      created_by_employee_id TEXT NOT NULL, created_by_user_id TEXT NOT NULL, created_by_name TEXT NOT NULL,
      created_at INTEGER NOT NULL)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_finance_assistant_created
      ON finance_assistant_answers(created_at DESC)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_finance_assistant_actor_created
      ON finance_assistant_answers(created_by_employee_id, created_at DESC)`),
  ]);
}

function parseEvidence(value: string): FinanceAssistantEvidence | null {
  try { return JSON.parse(value) as FinanceAssistantEvidence; } catch { return null; }
}

export function financeAssistantHistoryView(row: HistoryRow) {
  const evidence = parseEvidence(row.evidence_json);
  return {
    id: row.id, question: row.question, answer: row.answer, provider: row.provider,
    evidenceStatus: row.evidence_status, evidenceLabel: row.evidence_status === "VERIFIED" ? "근거 확인" : "검토 필요",
    basisAsOf: row.basis_as_of, sources: evidence?.sources ?? [], limitations: evidence?.limitations ?? [],
    evidenceHash: row.evidence_hash, answerHash: row.answer_hash, promptVersion: row.prompt_version,
    createdByEmployeeId: row.created_by_employee_id, createdByName: row.created_by_name, createdAt: row.created_at,
  };
}

export async function saveFinanceAssistantAnswer(db: D1Database, principal: ErpPrincipal, question: string,
  evidence: FinanceAssistantEvidence, payload: FinanceAssistantAnswerPayload) {
  await ensureFinanceAssistantHistorySchema(db);
  const id = crypto.randomUUID(); const createdAt = Date.now();
  const frozenEvidence = { ...evidence, limitations: [...payload.limitations] };
  const { evidenceJson, evidenceHash, answerHash } = await buildFinanceAssistantHashes(question, payload.answer, payload.provider, frozenEvidence);
  await db.prepare(`INSERT INTO finance_assistant_answers
    (id,question,answer,provider,evidence_status,basis_as_of,evidence_json,evidence_hash,answer_hash,prompt_version,
      created_by_employee_id,created_by_user_id,created_by_name,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, question, payload.answer, payload.provider, payload.evidenceStatus,
      payload.basisAsOf, evidenceJson, evidenceHash, answerHash, FINANCE_ASSISTANT_PROMPT_VERSION,
      principal.employeeId, principal.userId, principal.employeeName, createdAt).run();
  return financeAssistantHistoryView({ id, question, answer: payload.answer, provider: payload.provider,
    evidence_status: payload.evidenceStatus, basis_as_of: payload.basisAsOf, evidence_json: evidenceJson,
    evidence_hash: evidenceHash, answer_hash: answerHash, prompt_version: FINANCE_ASSISTANT_PROMPT_VERSION,
    created_by_employee_id: principal.employeeId, created_by_name: principal.employeeName, created_at: createdAt });
}

export async function listFinanceAssistantAnswers(db: D1Database, limit = 20) {
  await ensureFinanceAssistantHistorySchema(db);
  const rows = await db.prepare(`SELECT id,question,answer,provider,evidence_status,basis_as_of,evidence_json,
    evidence_hash,answer_hash,prompt_version,created_by_employee_id,created_by_name,created_at
    FROM finance_assistant_answers ORDER BY created_at DESC LIMIT ?`).bind(Math.min(Math.max(limit, 1), 50)).all<HistoryRow>();
  return rows.results.map(financeAssistantHistoryView);
}
