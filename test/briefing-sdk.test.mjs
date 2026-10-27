// 실제 @anthropic-ai/sdk 가 만드는 HTTP 요청을 로컬 모의 서버로 받아 본다 — 헤더·본문 직렬화와 스트림 해석까지(네트워크·키 불필요).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { composeBriefing } from "../briefing/lib/compose.mjs";
import { config, generateInsights, getClaude, FALLBACK_BETA } from "../api/briefing/_lib.mjs";
import { createHandler as chatHandler } from "../api/briefing/chat.mjs";

const b = composeBriefing(JSON.parse(await readFile(new URL("./fixtures/dashboard-2026-10-27.json", import.meta.url), "utf8")), new Date("2026-10-27T09:00:00Z"));
const seen = [];
const server = http.createServer(async (req, res) => {
  let raw = ""; for await (const c of req) raw += c;
  const body = JSON.parse(raw);
  seen.push({ url: req.url, headers: req.headers, body });
  const msg = { id: "msg_1", type: "message", role: "assistant", model: body.model, stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5 } };
  if (!body.stream) {
    const out = { lead: "오늘의 한 문장", summary: ["가"], stories: [{ id: "S1", topic: "실적", why: "이유", watch: "", lens: "" }], themes: [], questions: [] };
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ...msg, content: [{ type: "text", text: JSON.stringify(out) }] }));
  }
  res.writeHead(200, { "content-type": "text/event-stream" });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev("message_start", { message: { ...msg, content: [], stop_reason: null } });
  ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
  for (const t of ["코스피는 ", "올랐습니다 [S2]."]) ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: t } });
  ev("content_block_stop", { index: 0 });
  ev("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 5 } });
  ev("message_stop", {});
  res.end();
});
await new Promise((r) => server.listen(0, r));
after(() => server.close());
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
process.env.ANTHROPIC_API_KEY = "test-key";

test("해석 요청이 SDK 를 거쳐 올바른 헤더·본문으로 나간다", async () => {
  const r = await generateInsights(b, { claude: await getClaude(), cfg: { ...config(), ai: true } });
  assert.equal(r.status, "ok");
  assert.equal(r.insights.stories.S1.why, "이유");
  const { url, headers, body } = seen.at(-1);
  assert.match(url, /^\/v1\/messages/);
  assert.ok(headers["anthropic-beta"].split(",").map((s) => s.trim()).includes(FALLBACK_BETA));
  assert.ok(headers["x-api-key"] === "test-key" || headers.authorization === "Bearer test-key", "키가 인증 헤더로 실린다");
  assert.equal(body.fallbacks, "default");
  assert.equal(body.output_config.format.type, "json_schema");
  assert.ok(!("betas" in body), "betas 는 헤더로만");
});

test("대화가 SDK 스트림을 그대로 SSE 로 넘긴다", async () => {
  const chunks = [];
  const res = { statusCode: 200, writableEnded: false, setHeader() {}, status(c) { this.statusCode = c; return this; }, json(o) { throw new Error(JSON.stringify(o)); }, write(c) { chunks.push(c); }, end() { this.writableEnded = true; }, on() {}, flushHeaders() {} };
  const h = chatHandler({ briefing: async () => b, cfg: { ...config(), ai: true } });
  await h({ method: "POST", headers: { origin: "https://s.test", host: "s.test", "x-forwarded-for": "1.1.1.1" }, body: { messages: [{ role: "user", content: "시장?" }] } }, res);
  const text = chunks.filter((c) => c.startsWith("event: delta")).map((c) => JSON.parse(c.split("data: ")[1]).t).join("");
  assert.equal(text, "코스피는 올랐습니다 [S2].");
  const done = JSON.parse(chunks.find((c) => c.startsWith("event: done")).split("data: ")[1]);
  assert.deepEqual(done.cited, ["S2"]); assert.equal(done.stop, "end_turn");
  const { body } = seen.at(-1);
  assert.equal(body.stream, true);
  assert.equal(body.system[1].cache_control.type, "ephemeral");
  assert.equal(body.output_config.effort, "low");
});
