import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("renders the integrated ERP finance workspace", async () => {
  const response = await render("/");
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>XD NODE ERP · 통합 운영 관리<\/title>/);
  assert.match(html, /2024년부터 오늘까지, 하나의 재무 흐름으로/);
  assert.match(html, /2024~2026년 재무 데이터 연결 완료/);
  assert.match(html, /통합 대시보드/);
  assert.match(html, /손익·재무상태/);
  assert.match(html, /자금·채권채무/);
  assert.match(html, /원장·데이터 점검/);
  assert.match(html, /재무 데이터 어시스턴트/);
  assert.doesNotMatch(html, /Your site is taking shape|Building your site|codex-preview/);
});

test("renders the incentive calculator after the Excel import compatibility fix", async () => {
  const response = await render("/incentive");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /인센티브 계산기/);
  assert.match(html, /엑셀 또는 CSV 선택/);
  assert.match(html, /개인별 급여 반영/);
});
