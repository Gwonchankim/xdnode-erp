import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("local Codex assistant is mounted only for HR and compensation and its bridge is read-only", async () => {
  const [page, component, bridge, launcher, schema] = await Promise.all([
    read("app/page.tsx"), read("app/local-codex-assistant.tsx"), read("scripts/codex-assistant-bridge.mjs"),
    read("scripts/Start-XDNodeERP.ps1"), read("scripts/codex-assistant-response-schema.json"),
  ]);
  assert.match(page, /<LocalCodexAssistant module="hr"\s*\/>/);
  assert.match(page, /<LocalCodexAssistant module="compensation"\s*\/>/);
  assert.match(component, /type AssistantModule = "hr" \| "compensation"/);
  assert.match(component, /http:\/\/127\.0\.0\.1:3110/);
  assert.match(bridge, /const HOST = "127\.0\.0\.1"/);
  assert.match(bridge, /"--sandbox", "read-only"/);
  assert.match(bridge, /"--ephemeral"/);
  assert.match(bridge, /MODEL = "gpt-5\.6-terra"/);
  assert.match(bridge, /REASONING_EFFORT = "medium"/);
  assert.match(bridge, /model_reasoning_effort/);
  assert.match(bridge, /\["hr", "compensation"\]/);
  assert.match(bridge, /MAX_QUESTION_LENGTH = 2000/);
  assert.match(component, /includeServerData/);
  assert.match(component, /analyzeFile/);
  assert.match(component, /pdfjs-dist\/legacy\/build\/pdf\.mjs/);
  assert.match(component, /mammoth/);
  assert.match(component, /\.pdf,\.docx/);
  assert.match(component, /local-codex-file-picker/);
  assert.match(component, /분석할 파일 첨부/);
  assert.match(component, /UPDATE_HR_COMPENSATION_DEFAULTS/);
  assert.match(component, /CREATE_COMPENSATION_DRAFT/);
  assert.match(component, /내용 확인 후 반영/);
  assert.doesNotMatch(bridge, /danger-full-access|--yolo|--full-auto/);
  assert.match(launcher, /\$AssistantPort = 3110/);
  assert.match(launcher, /assistant:bridge/);
  assert.match(schema, /"answer"/);
  assert.match(schema, /"proposedActions"/);
});
