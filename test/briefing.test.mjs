import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { composeBriefing, digestText, edition, cleanSummary, numberSet, ungrounded, sanitizeInsights, citedIds, searchStories } from "../briefing/lib/compose.mjs";
import { config, sourceUrl, insightSchema, generateInsights, insightsFor, remapInsights, normalizeMessages, rateLimit, resetMemos, resetRateLimit, FALLBACK_BETA } from "../api/briefing/_lib.mjs";
import { createHandler as todayHandler } from "../api/briefing/today.mjs";
import { createHandler as chatHandler } from "../api/briefing/chat.mjs";
import { patchIndex, patchApp } from "../scripts/integrate-briefing.mjs";

const dash = JSON.parse(await readFile(new URL("./fixtures/dashboard-2026-10-27.json", import.meta.url), "utf8"));
const NOW = new Date("2026-10-27T09:00:00Z");
const b = composeBriefing(dash, NOW);
const AI = { ...config({}), ai: true };

test("사실 층: 중복 없는 12개 사안 · 연속 번호 · 판 · 시세 순서", () => {
  assert.equal(b.stories.length, 12);
  assert.deepEqual(b.stories.map((s) => s.id), b.stories.map((_, i) => `S${i + 1}`));
  assert.equal(new Set(b.stories.map((s) => s.link)).size, 12);
  assert.equal(b.edition.label, "저녁판"); // 08:52Z = 17:52 KST
  assert.equal(b.edition.id, "2026-10-27.evening");
  assert.equal(b.markets[0].id, "kospi");
  assert.deepEqual([...b.groups.spreading, ...b.groups.continuing].sort(), b.stories.map((s) => s.id).sort());
  for (const s of b.stories) assert.ok(!/기자\s*=/.test(s.summary), `${s.id} 머리말 남음`);
  assert.ok(b.policy.govPre.every((p) => p.isNew), "오늘 시작한 입법예고 표시");
});

test("판 경계는 KST 시각 기준", () => {
  assert.equal(edition("2026-10-26T20:30:00Z").label, "새벽판"); // 05:30
  assert.equal(edition("2026-10-26T21:00:00Z").label, "아침판"); // 06:00
  assert.equal(edition("2026-10-27T02:00:00Z").label, "오후판"); // 11:00
  assert.equal(edition("2026-10-27T08:00:00Z").label, "저녁판"); // 17:00
  assert.equal(edition("2026-10-26T20:30:00Z").date, "2026-10-27");
});

test("요지 머리말 정리", () => {
  assert.equal(cleanSummary("(서울=연합뉴스) 박상현 기자 = 한미약품[128940]은 감소한 것..."), "한미약품[128940]은 감소한 것…");
  assert.equal(cleanSummary("  이미 깨끗한   문장  "), "이미 깨끗한 문장");
});

test("수치 근거 검사: 자료에 없는 숫자만 걸러낸다", () => {
  const set = numberSet("코스피 5,638.34 (+3.09%) · 언론 24곳");
  assert.deepEqual(ungrounded("코스피가 5,638.34로 3.09% 올랐다", set), []);
  assert.deepEqual(ungrounded("5638선, 3%대 상승", set), [], "정수부는 허용");
  assert.deepEqual(ungrounded("3.090%", set), [], "같은 값의 다른 표기");
  assert.deepEqual(ungrounded("작년엔 12.5% 올랐다", set), ["12.5"]);
});

test("해석 정리: 없는 번호·근거 없는 수치·연결 부족을 버리고 기록한다", () => {
  const set = numberSet(digestText(b));
  const { insights, dropped } = sanitizeInsights({
    lead: "오늘은 반도체가 이끈 날이다.",
    summary: ["코스피 5,638.34 마감", "환율 999.9원 돌파", "셋째 줄"],
    stories: [{ id: "S1", topic: "기업 실적", why: "실적 발표가 몰렸다.", watch: "", lens: "" }, { id: "S99", topic: "x", why: "y", watch: "", lens: "" }],
    themes: [{ title: "실적 시즌", text: "S1 과 S4 가 함께 움직인다.", stories: ["S1", "S4"] }, { title: "외톨이", text: "하나뿐", stories: ["S2", "S77"] }],
    questions: ["시장은 왜 올랐나요?"],
  }, b, set);
  assert.equal(insights.lead, "오늘은 반도체가 이끈 날이다.");
  assert.deepEqual(insights.summary, ["코스피 5,638.34 마감", "셋째 줄"]);
  assert.ok(dropped.some((d) => d.path === "summary.1" && d.numbers.includes("999.9")));
  assert.ok(!insights.stories.S99 && dropped.some((d) => d.reason === "없는 소식 번호"));
  assert.equal(insights.themes.length, 1);
  assert.equal(insights.stories.S1.topic, "기업 실적");
});

test("모델 입력은 같은 브리핑이면 바이트까지 같다(프롬프트 캐시)", () => {
  assert.equal(digestText(b), digestText(composeBriefing(dash, new Date("2026-10-27T09:04:00Z"))));
  assert.match(digestText(b), /^\[S12\] /m);
});

test("인용 번호 · 소식 찾기", () => {
  assert.deepEqual(citedIds("근거 [S2] 와 [S2], 없는 [S40]", b), ["S2"]);
  const kospi = b.stories.find((s) => /코스피/.test(s.title)).id;
  assert.equal(searchStories(b, "코스피가 왜 올랐어?")[0], kospi);
  assert.deepEqual(searchStories(b, "?!"), []);
  assert.deepEqual(searchStories(b, "오늘 꼭 알아야 할 소식 세 가지는?"), [], "질문 말투만으로는 고르지 않는다");
});

test("해석은 기사 링크에 묶여 순위가 바뀌어도 맞는 소식에 붙는다", () => {
  const stored = { lead: "x", summary: [], questions: [], stories: { [b.stories[0].link]: { why: "첫째" }, [b.stories[1].link]: { why: "둘째" } }, themes: [{ title: "t", text: "t", stories: [b.stories[0].link, b.stories[1].link] }] };
  const swapped = { ...b, stories: [{ ...b.stories[1], id: "S1" }, { ...b.stories[0], id: "S2" }, ...b.stories.slice(2)] };
  const r = remapInsights(stored, swapped);
  assert.equal(r.stories.S1.why, "둘째");
  assert.equal(r.stories.S2.why, "첫째");
  assert.equal(remapInsights(stored, { ...b, stories: b.stories.slice(1) }).themes.length, 0, "연결 대상이 빠지면 연결도 뺀다");
});

function fakeClaude(out, calls = []) {
  return { beta: { messages: {
    async create(p) { calls.push(p); return typeof out === "function" ? out(p) : { stop_reason: "end_turn", model: "claude-opus-5-5", usage: {}, content: [{ type: "text", text: JSON.stringify(out) }] }; },
  } } };
}
const OUT = { lead: "한 문장", summary: ["가", "나", "다"], stories: [{ id: "S1", topic: "실적", why: "이유", watch: "지켜볼 것", lens: "" }], themes: [], questions: ["무엇이 중요하나요?"] };

test("해석 요청: Opus 5.5 · 서버측 대체 모델 · 구조화 출력(S번호 열거)", async () => {
  const calls = [];
  const r = await generateInsights(b, { claude: fakeClaude(OUT, calls), cfg: AI });
  assert.equal(r.status, "ok");
  const p = calls[0];
  assert.equal(p.model, "claude-opus-5-5");
  assert.deepEqual(p.betas, [FALLBACK_BETA]);
  assert.equal(p.fallbacks, "default");
  assert.equal(p.output_config.format.type, "json_schema");
  assert.equal(p.output_config.effort, "medium");
  assert.ok(!("thinking" in p) && !("temperature" in p));
  assert.deepEqual(p.output_config.format.schema.properties.stories.items.properties.id.enum, b.stories.map((s) => s.id));
  const refused = await generateInsights(b, { claude: fakeClaude(() => ({ stop_reason: "refusal", content: [] })), cfg: AI });
  assert.equal(refused.status, "refused");
});

test("구조화 출력 스키마는 지원 범위만 쓴다(길이·수치 제약 없음, 모든 객체 닫힘)", () => {
  const walk = (s) => {
    assert.ok(!["minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems"].some((k) => k in s));
    if (s.type === "object") { assert.equal(s.additionalProperties, false); assert.deepEqual(s.required, Object.keys(s.properties)); Object.values(s.properties).forEach(walk); }
    if (s.type === "array") walk(s.items);
  };
  walk(insightSchema(["S1", "S2"]));
});

test("해석 메모: 같은 판·같은 상위 구성이면 다시 쓰지 않는다 · AI 꺼짐 · 실패", async () => {
  resetMemos();
  const calls = [];
  const deps = { claude: async () => fakeClaude(OUT, calls), cfg: AI, now: () => NOW };
  assert.equal((await insightsFor(b, deps)).status, "ok");
  assert.equal((await insightsFor(b, { ...deps, now: () => new Date(NOW.getTime() + 60 * 60e3) })).status, "ok");
  assert.equal(calls.length, 1, "상위 구성이 같으면 TTL 이 지나도 재사용");
  const next = composeBriefing({ ...dash, generatedAt: "2026-10-27T12:30:00Z" }, NOW); // 21:30 KST — 같은 저녁판
  assert.equal((await insightsFor(next, deps)).insights.stories.S1.why, "이유");
  assert.equal((await insightsFor(b, { cfg: { ...AI, ai: false } })).status, "off");
  resetMemos();
  const err = await insightsFor(b, { claude: async () => fakeClaude(() => { throw new Error("boom"); }), cfg: AI, now: () => NOW });
  assert.equal(err.status, "error");
});

test("원천 주소는 요청 헤더가 아니라 설정에서만 정한다", () => {
  assert.equal(sourceUrl({}), "https://gukjeong-hannune.vercel.app/api/dashboard");
  assert.equal(sourceUrl({ VERCEL_PROJECT_PRODUCTION_URL: "a.example" }), "https://a.example/api/dashboard");
  assert.equal(sourceUrl({ BRIEFING_SOURCE_URL: "https://b.example/x" }), "https://b.example/x");
});

test("대화 정리: 역할·순서·길이", () => {
  assert.ok(normalizeMessages([]).error);
  assert.ok(normalizeMessages([{ role: "user", content: "x".repeat(1201) }]).error);
  assert.ok(normalizeMessages([{ role: "user", content: "a" }, { role: "assistant", content: "b" }]).error, "마지막은 질문");
  const m = normalizeMessages([{ role: "assistant", content: "인사" }, { role: "user", content: "a" }, { role: "user", content: "b" }, { role: "system", content: "무시" }]).messages;
  assert.deepEqual(m, [{ role: "user", content: "a\n\nb" }]);
  const long = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: "가".repeat(1000) }));
  const n = normalizeMessages([...long, { role: "user", content: "끝" }]).messages;
  assert.equal(n[0].role, "user"); assert.equal(n[n.length - 1].content, "끝");
  assert.ok(n.reduce((a, x) => a + x.content.length, 0) <= 9000);
});

test("요청 제한", () => {
  resetRateLimit();
  for (let i = 0; i < 3; i++) assert.ok(rateLimit("ip", 3, 1000).ok);
  const r = rateLimit("ip", 3, 1000);
  assert.equal(r.ok, false); assert.ok(r.retryAfter > 0);
  assert.ok(rateLimit("ip", 3, 1000 + 5 * 60e3).ok, "창이 지나면 풀린다");
});

function mockRes() {
  let resolve; const done = new Promise((r) => { resolve = r; });
  const res = {
    statusCode: 200, headers: {}, chunks: [], writableEnded: false, body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; this.writableEnded = true; resolve(this); return this; },
    write(c) { this.chunks.push(c); }, end() { this.writableEnded = true; resolve(this); }, on() {}, flushHeaders() {},
  };
  return { res, done };
}
const events = (res) => res.chunks.join("").split("\n\n").filter(Boolean).map((c) => ({ ev: c.match(/^event: (.+)$/m)[1], data: JSON.parse(c.match(/^data: (.+)$/m)[1]) }));
const call = async (h, req) => { const { res, done } = mockRes(); h(req, res); return done; };

test("오늘 API: 읽기 전용 · 사실만 · 캐시 · 원천 실패", async () => {
  const ok = todayHandler({ briefing: async () => b, insights: async () => ({ status: "ok", insights: { lead: "x" }, dropped: [{}], model: "m" }) });
  const r = await call(ok, { method: "GET", query: {} });
  assert.equal(r.body.insights.lead, "x"); assert.equal(r.body.ai.dropped, 1);
  assert.match(r.headers["cache-control"], /s-maxage=600/);
  const facts = await call(todayHandler({ briefing: async () => b, insights: () => assert.fail("사실만 요청에 해석 생성") }), { method: "GET", query: { facts: "1" } });
  assert.equal(facts.body.ai.status, "skipped"); assert.equal(facts.body.stories.length, 12);
  const err = await call(todayHandler({ briefing: async () => b, insights: async () => ({ status: "error" }) }), { method: "GET", query: {} });
  assert.match(err.headers["cache-control"], /s-maxage=60,/, "실패한 해석은 짧게 캐시");
  assert.equal((await call(ok, { method: "POST", query: {} })).statusCode, 405);
  assert.equal((await call(todayHandler({ briefing: async () => { throw new Error("x"); } }), { method: "GET", query: {} })).statusCode, 502);
});

const req = (body, headers = {}) => ({ method: "POST", body, headers: { origin: "https://site.test", host: "site.test", "x-forwarded-for": `10.0.0.${Math.floor(Math.random() * 250)}`, ...headers } });

test("대화 API: 같은 출처만 · 형식 검사 · 제한", async () => {
  resetRateLimit();
  const h = chatHandler({ briefing: async () => b, cfg: { ...AI, ai: false } });
  assert.equal((await call(h, { ...req({}), headers: { host: "site.test" } })).statusCode, 403);
  assert.equal((await call(h, req({}, { origin: "https://evil.test" }))).statusCode, 403);
  assert.equal((await call(h, req({ messages: [] }))).statusCode, 400);
  const tight = chatHandler({ briefing: async () => b, cfg: { ...AI, ai: false, chatPer5Min: 1 } });
  const ip = { "x-forwarded-for": "9.9.9.9" };
  await call(tight, req({ messages: [{ role: "user", content: "코스피" }] }, ip));
  assert.equal((await call(tight, req({ messages: [{ role: "user", content: "코스피" }] }, ip))).statusCode, 429);
});

test("대화 API: AI 꺼짐이면 오늘 소식 찾기로 답한다", async () => {
  const h = chatHandler({ briefing: async () => b, cfg: { ...AI, ai: false } });
  const r = await call(h, req({ messages: [{ role: "user", content: "코스피 왜 올랐어" }] }));
  const ev = events(r);
  assert.equal(r.headers["content-type"], "text/event-stream; charset=utf-8");
  assert.deepEqual(ev.map((e) => e.ev), ["meta", "delta", "done"]);
  assert.equal(ev[0].data.stories.length, 12);
  assert.match(ev[1].data.t, /AI 답변이 꺼져/);
  assert.ok(ev[2].data.cited.length >= 1);
  const generic = events(await call(h, req({ messages: [{ role: "user", content: "오늘 꼭 알아야 할 소식 세 가지는?" }] })));
  assert.deepEqual(generic.find((e) => e.ev === "done").data.cited, ["S1", "S2", "S3"], "맞는 소식이 없으면 오늘 가장 많이 다룬 소식");
  const text = async (q) => events(await call(h, req({ messages: [{ role: "user", content: q }] }))).filter((e) => e.ev === "delta").map((e) => e.data.t).join("");
  assert.match(await text("입법예고 중 생활에 닿는 건 뭔가요?"), new RegExp(b.policy.govPre[0].title.slice(0, 10)));
  assert.match(await text("해외 언론은 한국의 무엇을 다뤘나요?"), new RegExp(b.world[0].outlet));
  assert.match(await text("오늘 시장은 왜 이렇게 움직였나요?"), /코스피 5,6\d\d/);
  const s5 = b.stories[4];
  const q = events(await call(h, req({ messages: [{ role: "user", content: "이건 무슨 일이야?" }], quote: { link: s5.link, title: s5.title } })));
  assert.equal(q.find((e) => e.ev === "done").data.cited[0], "S5", "인용한 소식을 먼저");
});

function streamingClaude(text, final = { stop_reason: "end_turn" }, seen = []) {
  return { beta: { messages: { stream(p, opts) {
    seen.push({ p, opts });
    return {
      async *[Symbol.asyncIterator]() { for (const t of text.match(/.{1,5}/gsu)) yield { type: "content_block_delta", delta: { type: "text_delta", text: t } }; },
      async finalMessage() { return final; },
    };
  } } } };
}

test("대화 API: 흐름 전달 · 인용 · 자료에 없는 수치 표시 · 캐시 지점 · 인용 소식", async () => {
  const seen = [];
  const s2 = b.stories[1];
  const h = chatHandler({ briefing: async () => b, claude: async () => streamingClaude(`코스피는 5,638.34로 마감했습니다 [S2]. 해석: 작년 12.5%와 비교됩니다 [S99].`, undefined, seen), cfg: AI });
  const r = await call(h, req({ messages: [{ role: "user", content: "시장 어땠어?" }], quote: { link: s2.link, title: s2.title } }));
  const ev = events(r);
  const text = ev.filter((e) => e.ev === "delta").map((e) => e.data.t).join("");
  assert.match(text, /5,638\.34/);
  const done = ev.find((e) => e.ev === "done").data;
  assert.deepEqual(done.cited, ["S2"]);
  assert.deepEqual(done.unverified, ["12.5"]);
  const p = seen[0].p;
  assert.equal(p.model, "claude-opus-5-5"); assert.equal(p.fallbacks, "default"); assert.equal(p.output_config.effort, "low");
  assert.equal(p.system[1].cache_control.type, "ephemeral");
  assert.match(p.messages.at(-1).content, new RegExp(`^\\(인용한 소식: \\[S2\\]`));
  assert.ok(seen[0].opts.signal instanceof AbortSignal);
});

test("대화 API: 거절은 오류 이벤트로", async () => {
  const h = chatHandler({ briefing: async () => b, claude: async () => streamingClaude("부분", { stop_reason: "refusal" }), cfg: AI });
  const ev = events(await call(h, req({ messages: [{ role: "user", content: "질문" }] })));
  assert.ok(ev.some((e) => e.ev === "error" && e.data.refusal));
  assert.ok(!ev.some((e) => e.ev === "done"));
});

test("운영 홈 통합: 세 곳에 진입점 · 탭 막대 다섯 칸 · 두 번 돌려도 같다", async () => {
  const html = await readFile(new URL("./fixtures/site-nav.html", import.meta.url), "utf8");
  const a = patchIndex(html);
  assert.equal(a.changes.length, 3);
  assert.equal((a.html.match(/href="\/briefing\/"/g) || []).length, 3);
  const bar = a.html.match(/<nav class="tabbar"[\s\S]*?<\/nav>/)[0];
  assert.equal((bar.match(/<a |<button /g) || []).length, 5);
  assert.ok(!/data-view="macro"/.test(bar));
  assert.ok(/data-view="macro"/.test(a.html), "거시경제는 다른 메뉴에 남는다");
  assert.equal(patchIndex(a.html).changes.length, 0);
  assert.equal(patchApp("const TAB_VIEWS = ['home', 'street', 'realty', 'macro'];").js, "const TAB_VIEWS = ['home', 'street', 'realty'];");
  assert.throws(() => patchIndex("<html></html>"), /기준 표지/);
});
