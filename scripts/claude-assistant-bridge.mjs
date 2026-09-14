// HR·임금계산 보조 어시스턴트를 Claude CLI 로 구동하는 로컬 다리.
//
// scripts/codex-assistant-bridge.mjs 를 대체한다. 요청·응답 모양과 프롬프트 규칙은 같고
// 실행 엔진만 바뀐다. 되돌릴 수 있도록 Codex 다리(3110)는 남겨 두고 포트를 나눈다.
//
// Codex 와 다른 점 두 가지를 여기서 메운다.
//  1) Codex 의 --output-schema 같은 강제 수단이 없다 → 응답을 이 파일에서 직접 검증한다.
//     proposedActions 는 실제 ERP 를 바꾸는 변경안이라, 모양이 틀린 응답을 화면에 넘기면 안 된다.
//  2) Codex 의 --sandbox read-only 대신 도구를 막는다. 파일을 읽어야 하므로 Read·Grep·Glob 은
//     남기고 쓰기·실행·네트워크 도구를 모두 끈다.
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const HOST = "127.0.0.1";
const PORT = Number(process.env.XD_NODE_CLAUDE_ASSISTANT_PORT || 3130);
const PROJECT_PATH = resolve(process.env.XD_NODE_PROJECT_PATH || process.cwd());
const SCHEMA_PATH = join(PROJECT_PATH, "scripts", "codex-assistant-response-schema.json");
const CLAUDE_BIN = process.env.XD_NODE_CLAUDE_BIN || "claude";
const MODEL = process.env.XD_NODE_CLAUDE_MODEL || "sonnet";
const EFFORT = process.env.XD_NODE_CLAUDE_EFFORT || "medium";
const ALLOWED_ORIGINS = new Set(["http://localhost:3000", "http://127.0.0.1:3000"]);
const ALLOWED_MODULES = new Set(["hr", "compensation", "sales"]);
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_QUESTION_LENGTH = 2000;
const MAX_CONTEXT_BYTES = 192 * 1024;
const RUN_TIMEOUT_MS = 300_000;

// 파일을 읽어 근거를 대야 하므로 Read·Grep·Glob 은 남긴다. 나머지는 모두 막는다.
const DISABLED_TOOLS = ["Bash", "Write", "Edit", "NotebookEdit", "WebFetch", "WebSearch", "Task", "TodoWrite"];

let activeRequest = false;
let schemaCache = null;

function json(response, status, body, origin) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...(origin && ALLOWED_ORIGINS.has(origin) ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
  });
  response.end(JSON.stringify(body));
}

/** Codex 다리의 buildPrompt 를 원본에서 그대로 가져온다.
 *  옮겨 적으면 두 다리의 지시가 조금씩 어긋나므로, 한쪽만 고쳐도 양쪽이 같이 따라오게 한다. */
async function loadBuildPrompt() {
  // 줄바꿈이 LF 든 CRLF 든 같게 다룬다. 편집기·git 설정에 따라 달라지는 값이라 여기서 흡수한다.
  const source = (await readFile(join(PROJECT_PATH, "scripts", "codex-assistant-bridge.mjs"), "utf8")).replace(/\r\n/g, "\n");
  const start = source.indexOf("function buildPrompt(");
  const close = source.indexOf("\n}\n", start);
  if (start < 0 || close < 0) throw new Error("buildPrompt 를 찾지 못했습니다.");
  const end = close + 3;
  return new Function(`${source.slice(start, end)}; return buildPrompt;`)();
}

async function loadSchema() {
  if (!schemaCache) schemaCache = JSON.parse(await readFile(SCHEMA_PATH, "utf8"));
  return schemaCache;
}

/** 스키마 검사. 이 스키마는 형태가 단순해서 필요한 규칙만 직접 본다
 *  (type, enum, required, additionalProperties, items). 새 의존성을 들이지 않기 위함이다. */
function validate(value, schema, path = "") {
  const errors = [];
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value === "number"
    ? (Number.isInteger(value) ? "integer" : "number") : typeof value;
  if (types.length) {
    const ok = types.some((type) => type === actual
      || (type === "number" && actual === "integer"));
    if (!ok) {
      errors.push(`${path || "(root)"}: ${types.join("|")} 가 필요한데 ${actual} 입니다.`);
      return errors;
    }
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path || "(root)"}: 허용되지 않은 값 ${JSON.stringify(value)}`);
  }
  if (actual === "object" && schema.properties) {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path ? `${path}.` : ""}${key}: 필수 항목이 없습니다.`);
    }
    for (const [key, child] of Object.entries(value)) {
      const childSchema = schema.properties[key];
      if (!childSchema) {
        if (schema.additionalProperties === false) errors.push(`${path ? `${path}.` : ""}${key}: 허용되지 않은 항목입니다.`);
        continue;
      }
      errors.push(...validate(child, childSchema, `${path ? `${path}.` : ""}${key}`));
    }
  }
  if (actual === "array" && schema.items) {
    value.forEach((item, index) => errors.push(...validate(item, schema.items, `${path}[${index}]`)));
  }
  return errors;
}

/** 모델이 앞뒤에 말을 붙여도 JSON 본문만 건져 낸다. */
function extractJson(text) {
  const trimmed = String(text ?? "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced ? fenced[1] : trimmed).trim();
  if (body.startsWith("{")) return body;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  return start >= 0 && end > start ? body.slice(start, end + 1) : body;
}

function runClaude(systemPrompt, prompt) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(CLAUDE_BIN, [
      "-p",
      "--model", MODEL,
      "--effort", EFFORT,
      "--output-format", "json",
      "--strict-mcp-config",
      "--disallowed-tools", ...DISABLED_TOOLS,
      "--system-prompt", systemPrompt,
    ], {
      // 프로젝트 안에서 돌려야 파일을 읽어 근거를 댈 수 있다(Codex 의 -C 와 같은 역할).
      // shell 은 쓰지 않는다. Windows 에서 인자가 이스케이프 없이 이어 붙어 프롬프트가 잘린다.
      cwd: PROJECT_PATH,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); rejectRun(new Error("Claude 응답 시간이 초과되었습니다.")); }, RUN_TIMEOUT_MS);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => { clearTimeout(timer); rejectRun(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) { rejectRun(new Error(`Claude CLI가 종료 코드 ${code}로 끝났습니다. ${stderr.slice(0, 300)}`)); return; }
      let envelope;
      try { envelope = JSON.parse(stdout); } catch { rejectRun(new Error("Claude CLI 응답을 읽지 못했습니다.")); return; }
      if (envelope.is_error) { rejectRun(new Error(String(envelope.result || "Claude 응답에 실패했습니다."))); return; }
      resolveRun({ text: envelope.result, cost: envelope.total_cost_usd, ms: envelope.duration_ms });
    });
    // 긴 한국어 요청이 Windows 명령줄 파서에 걸리지 않도록 표준입력으로 넘긴다.
    child.stdin.end(prompt, "utf8");
  });
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin;
  if (request.method === "OPTIONS") {
    if (!origin || !ALLOWED_ORIGINS.has(origin)) return json(response, 403, { error: "허용되지 않은 로컬 출처입니다." });
    response.writeHead(204, {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    });
    return response.end();
  }
  if (request.method === "GET" && request.url === "/health") {
    return json(response, 200, { status: "ok", engine: "claude", model: MODEL, effort: EFFORT, modules: [...ALLOWED_MODULES] }, origin);
  }
  if (request.method !== "POST" || request.url !== "/assistant") {
    return json(response, 404, { error: "지원하지 않는 경로입니다." }, origin);
  }
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json(response, 403, { error: "허용되지 않은 로컬 출처입니다." }, origin);
  if (activeRequest) return json(response, 429, { error: "이미 처리 중인 요청이 있습니다. 끝난 뒤 다시 시도해 주세요." }, origin);

  let raw = "";
  let tooLarge = false;
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > MAX_REQUEST_BYTES) { tooLarge = true; break; }
  }
  if (tooLarge) return json(response, 413, { error: "요청이 너무 큽니다." }, origin);

  let payload;
  try { payload = JSON.parse(raw); } catch { return json(response, 400, { error: "요청 본문을 읽지 못했습니다." }, origin); }
  const module = String(payload?.module ?? "").trim();
  const question = String(payload?.question ?? "").trim();
  const context = payload?.context ?? {};
  if (!ALLOWED_MODULES.has(module)) return json(response, 400, { error: "허용되지 않은 업무 영역입니다." }, origin);
  if (!question) return json(response, 400, { error: "질문을 입력해 주세요." }, origin);
  if (question.length > MAX_QUESTION_LENGTH) return json(response, 413, { error: "질문이 너무 깁니다." }, origin);
  if (JSON.stringify(context).length > MAX_CONTEXT_BYTES) return json(response, 413, { error: "첨부한 자료가 너무 큽니다." }, origin);

  activeRequest = true;
  try {
    const [buildPrompt, schema] = await Promise.all([loadBuildPrompt(), loadSchema()]);
    const prompt = buildPrompt(module, question, context);
    const systemPrompt = [
      "출력은 오직 JSON 하나만 반환하세요. 설명, 머리말, 코드펜스를 붙이지 마세요.",
      "다음 JSON 스키마를 정확히 따르세요:",
      JSON.stringify(schema),
    ].join("\n");

    const result = await runClaude(systemPrompt, prompt);
    let parsed;
    try { parsed = JSON.parse(extractJson(result.text)); } catch {
      return json(response, 502, { error: "Claude 응답을 JSON 으로 읽지 못했습니다." }, origin);
    }
    // Codex 의 --output-schema 를 대신하는 검증. 변경안이 화면으로 넘어가기 전 마지막 관문이다.
    const errors = validate(parsed, schema);
    if (errors.length) {
      console.error(`[claude-assistant-bridge] 스키마 위반 ${errors.length}건: ${errors.slice(0, 3).join(" / ")}`);
      return json(response, 502, { error: `응답 형식이 올바르지 않습니다. (${errors[0]})` }, origin);
    }
    console.log(`[claude-assistant-bridge] ok ${result.ms}ms cost=$${result.cost ?? "?"} actions=${parsed.proposedActions.length} questions=${parsed.interviewQuestions.length}`);
    return json(response, 200, parsed, origin);
  } catch (error) {
    console.error(`[claude-assistant-bridge] 실패: ${error instanceof Error ? error.message : error}`);
    return json(response, 502, { error: error instanceof Error ? error.message : "어시스턴트 응답에 실패했습니다." }, origin);
  } finally {
    activeRequest = false;
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[claude-assistant-bridge] http://${HOST}:${PORT} (model=${MODEL}, effort=${EFFORT})`);
});
