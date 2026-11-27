// 세계 보도 흐름: 보도 단계 규칙 · 시간대 집계(한국 시각 정시) · 순위 · 통합 패치(지도 아래로·흐름 자리·자료 알림)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { flatten, hourly, clusters, rank, phaseOf, topics, countries, summary } from "../world/lib.mjs";
import { patchIndex, patchApp } from "../scripts/integrate.mjs";

const H = 3600e3, NOW = Date.parse("2026-11-27T11:30:00Z"); // 한국 시각 20:30
const it = (outletKo, country, hoursAgo, extra = {}) => ({ title: `${outletKo} 제목`, link: `https://x/${outletKo}/${hoursAgo}`, publishedAt: new Date(NOW - hoursAgo * H).toISOString(), outletKo, country, type: "보도", ...extra });
const G = { generatedAt: new Date(NOW).toISOString(), topics: [
  { id: "a", name: "가 주제", clusters: [
    { items: [it("로이터", "영국", 1), it("AP", "미국", 2), it("BBC", "영국", 2.5), it("가디언", "영국", 30)] },         // 4곳 중 3곳이 3시간 안 → 급증
    { items: [it("로이터", "영국", 8), it("알자지라", "카타르", 9)] },                                                     // 6시간 넘게 새 보도 없음 → 감소
  ] },
  { id: "b", name: "나 주제", clusters: [
    { items: [it("블룸버그", "미국", 1), it("닛케이", "일본", 23), it("FT", "영국", 5)] },                                  // 22시간 보도 → 지속
    { items: [it("DW", "독일", 0.5, { titleKo: "한국어 제목" })] },                                                         // 보도 중
    { items: [it("옛 기사", "미국", 60)] },                                                                                // 48시간 밖
  ] },
] };

test("보도 단계: 급증 > 감소 > 지속 > 보도 중 (국내 상황판과 같은 규칙)", () => {
  const cs = clusters(flatten(G), NOW);
  const by = Object.fromEntries(cs.map((c) => [c.key, c.phase]));
  assert.deepEqual(by, { "a:0": "surge", "a:1": "fade", "b:0": "long", "b:1": "live", "b:2": "fade" });
  // 경계: 매체 3곳이면 모두 최근이어도 급증 아님, 정확히 절반이면 급증
  assert.equal(phaseOf({ outlets: 3, recentOutlets: 3, first: NOW - H, last: NOW }, NOW), "live");
  assert.equal(phaseOf({ outlets: 4, recentOutlets: 2, first: NOW - H, last: NOW }, NOW), "surge");
  assert.equal(phaseOf({ outlets: 2, recentOutlets: 0, first: NOW - 30 * H, last: NOW - 6 * H - 1 }, NOW), "fade");
  assert.equal(phaseOf({ outlets: 2, recentOutlets: 0, first: NOW - 21 * H, last: NOW - H }, NOW), "live", "정확히 20시간은 '넘게'가 아님");
  assert.equal(phaseOf({ outlets: 2, recentOutlets: 0, first: NOW - 22 * H, last: NOW - H }, NOW), "long");
});

test("사건 통계: 매체·국가 수, 매체별 첫 보도, 번역이 없으면 원문 제목", () => {
  const cs = clusters(flatten(G), NOW);
  const a0 = cs.find((c) => c.key === "a:0");
  assert.equal(a0.outlets, 4); assert.equal(a0.countries, 2); assert.equal(a0.recentOutlets, 3);
  assert.deepEqual(a0.timeline.map((o) => o.outlet), ["가디언", "BBC", "AP", "로이터"]);
  assert.equal(a0.translated, false); assert.equal(a0.title, "가디언 제목");
  assert.equal(cs.find((c) => c.key === "b:1").title, "한국어 제목");
  assert.deepEqual(rank(cs).slice(0, 2).map((c) => c.key), ["a:0", "b:0"]);
});

test("시간대 집계: 한국 시각 정시 경계, 48칸, 지금 시간대가 마지막 칸, 주제 따로", () => {
  const flat = flatten(G);
  const h = hourly(flat, NOW, { hours: 48, topic: "b" });
  assert.equal(h.all.length, 48);
  assert.equal(new Date(h.end).toISOString(), "2026-11-27T12:00:00.000Z", "한국 시각 21:00 = 20시대의 끝");
  assert.equal(h.all.reduce((a, b) => a + b, 0), flat.filter((x) => x.t >= h.start).length);
  assert.equal(h.all[47], 1, "20시대(20:00~20:59 KST)는 30분 전 DW 1건 — 1시간 전(19:30) 기사는 19시대");
  assert.equal(h.all[46], 2, "19시대: 로이터·블룸버그");
  assert.equal(h.sel.reduce((a, b) => a + b, 0), 4, "나 주제 48시간 안 4건");
});

test("요약: 48시간 밖 기사는 빼고, 급증·3개국 이상 사안을 센다", () => {
  const s = summary(G, NOW);
  assert.equal(s.items, 10); assert.equal(s.outlets, 9); assert.equal(s.surge, 1);
  assert.equal(s.multi, 1, "나 주제 첫 사건: 미국·일본·영국");
  assert.equal(s.translated, 1);
  assert.deepEqual(topics(s.flat, NOW).map((t) => [t.id, t.n]), [["a", 6], ["b", 4]]);
  assert.deepEqual(countries(s.flat)[0], { name: "영국", n: 5 });
});

test("통합: 세계 권력 지형은 기사 목록 아래로, 흐름 자리는 머리 아래, 자료 알림·지도 지연 불러오기", async () => {
  const html = await readFile(new URL("./fixtures/prod-2-9-1/index.html", import.meta.url), "utf8");
  const a = patchIndex(html).html;
  const g = a.slice(a.indexOf('id="v-global"'), a.indexOf('id="v-compare"'));
  const at = (s) => g.indexOf(s);
  assert.ok(at('<header class="vh">') < at('id="gfFlow"') && at('id="gfFlow"') < at('id="globalBody"') && at('id="globalBody"') < at('id="atlas"'));
  assert.equal((a.match(/id="atlas"/g) || []).length, 1, "지도는 한 번만");
  assert.ok(a.includes('<div class="at-ticks" id="atTicks"'), "지도 내용은 그대로");
  const js = patchApp(await readFile(new URL("./fixtures/prod-2-9-1/app.js", import.meta.url), "utf8")).js;
  assert.match(js, /window\.__gkGlobal = d; dispatchEvent\(new CustomEvent\('gk:global'/);
  assert.match(js, /new IntersectionObserver\([\s\S]*?mountAtlasLazy\(\);[\s\S]*?rootMargin: '200px 0px'/);
});
