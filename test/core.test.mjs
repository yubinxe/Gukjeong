// 공용 계층: 신규 기사 셈 · 수집 상태 · 추이 차트 배치 · 운영 원본(2-9-1)에 대한 통합 패치
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { canon, linksOf, newArticles, snapshotOf, statusOf, placeLabels, tickPlan, multiLineSVG, seriesFromData } from "../core/lib.mjs";
import { patchIndex, patchApp, patchStyle, APP_PATCHES } from "../scripts/integrate.mjs";

const fx = JSON.parse(await readFile(new URL("./fixtures/dashboard-2026-10-27.json", import.meta.url), "utf8"));
const prod = (f) => readFile(new URL(`./fixtures/prod-2-9-1/${f}`, import.meta.url), "utf8");

test("신규 기사: 직전 성공 스냅샷과 실제로 다른 주소만 센다", () => {
  const prev = snapshotOf(fx);
  const d = structuredClone({ ...fx, generatedAt: "2026-10-27T09:00:00Z" });
  const items = d.sections.flatMap((s) => s.items);
  items[0].link += "&x=1"; items[3].link += "&x=2";
  items[7].link += (items[7].link.includes("?") ? "&" : "?") + "utm_source=feed"; // 추적 꼬리표만 다름 → 같은 기사
  items[8].link += "#comments";                                                  // 조각만 다름 → 같은 기사
  assert.equal(newArticles(d, prev), 2);
  assert.equal(newArticles(fx, prev), null, "같은 세대는 비교하지 않음");
  assert.equal(newArticles({ ...d, generatedAt: "2026-10-27T08:00:00Z" }, prev), null, "더 오래된 판은 비교하지 않음");
  assert.equal(newArticles({ ...d, stale: true }, prev), null, "직전 자료(실패 대체본)는 세지 않음");
  assert.equal(newArticles(d, null), null, "비교 기준이 없으면 내지 않음");
  assert.equal(linksOf(fx).size, new Set(fx.sections.flatMap((s) => s.items.map((i) => canon(i.link)))).size);
  assert.equal(canon("https://A.com/x/?utm_medium=a&id=3#top"), "https://a.com/x?id=3");
});

test("수집 상태: 자료 시각과 표시만으로 정상·지연·직전 자료", () => {
  const now = Date.parse("2026-11-13T05:00:00Z");
  const at = (min, extra = {}) => ({ generatedAt: new Date(now - min * 60000).toISOString(), ...extra });
  assert.equal(statusOf(at(3), now).key, "ok");
  assert.equal(statusOf(at(15), now).key, "late");
  assert.equal(statusOf(at(45), now).key, "stale");
  assert.equal(statusOf(at(1, { stale: true }), now).label, "직전 자료");
  assert.equal(statusOf(null, now).key, "none");
});

test("추이 차트: 끝 이름표는 간격을 지키고 칸 안에 머문다", () => {
  const ys = [120, 121, 122, 200];
  const out = placeLabels(ys, { gap: 20, top: 16, bottom: 210 });
  const sorted = [...out].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i] - sorted[i - 1] >= 19.9, `간격 ${sorted}`);
  assert.ok(Math.max(...out) <= 210 && Math.min(...out) >= 16 - 0.1);
  // 아래 끝에 몰려도 칸 안으로 올린다
  const low = placeLabels([205, 206, 207, 208], { gap: 20, top: 16, bottom: 210 });
  assert.ok(Math.max(...low) <= 210 && Math.min(...low) >= 16, String(low));
  assert.deepEqual(placeLabels([50], { gap: 20, top: 16, bottom: 210 }), [50]);
});

test("추이 차트: 좁은 칸은 눈금을 건너뛰고, 처음·끝·연도 바뀜을 지킨다", () => {
  const labels = ["25.09", "25.10", "25.11", "25.12", "26.01", "26.02", "26.03", "26.04", "26.05", "26.06", "26.07", "26.08", "26.09"];
  const wide = tickPlan(labels, 520);
  assert.equal(wide.length, 13);
  assert.equal(wide[0].text, "25.9"); assert.equal(wide[0].anchor, "start");
  assert.equal(wide.at(-1).anchor, "end");
  assert.equal(wide.find((t) => t.i === 4).text, "26.1");
  const narrow = tickPlan(labels, 160, { minPx: 46 });
  assert.ok(narrow.length < 6, `좁은 칸 ${narrow.length}개`);
  assert.equal(narrow[0].i, 0); assert.equal(narrow.at(-1).i, 12);
  assert.ok(narrow.some((t) => t.text.startsWith("26.")), "연도가 바뀌면 연도를 쓴다");
  for (let k = 1; k < narrow.length; k++) assert.ok((narrow[k].i - narrow[k - 1].i) * (160 / 12) >= 23, "글자끼리 붙지 않음");
});

test("추이 차트: app.js bindMline 과 같은 표지, 폭에 맞춘 그림판, 같은 자료로 되살림", () => {
  const series = [["서울", "c1", 96], ["수도권", "c2", 97], ["전국", "c3", 98.5], ["지방", "c4", 99.6]].map(([name, cls, s0]) => ({ name, cls, pts: Array.from({ length: 13 }, (_, i) => ({ label: `${i < 4 ? 25 : 26}.${String(((i + 8) % 12) + 1).padStart(2, "0")}`, v: +(s0 + i * (103 - s0) / 12).toFixed(1) })) }));
  for (const w of [288, 640, 1100]) {
    const svg = multiLineSVG(series, w);
    const vb = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
    assert.ok(Math.abs(Number(vb[1]) - w) <= 6, `그림판 폭 ${vb[1]} ≈ 칸 ${w}`);
    assert.match(svg, /class="mline gk-ml"/); assert.match(svg, /data-ml="/); assert.match(svg, /data-w="\d+"/);
    assert.match(svg, /class="mx"/); assert.match(svg, /기준 100/);
    const data = JSON.parse(svg.match(/data-ml="([^"]+)"/)[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
    assert.deepEqual(seriesFromData(data).map((s) => s.pts.at(-1)), series.map((s) => s.pts.at(-1)));
  }
});

test("운영 원본 2-9-1 통합: 모든 기준 표지가 정확히 한 번 · 두 번 돌려도 같다", async () => {
  const [html, js, css] = await Promise.all([prod("index.html"), prod("app.js"), prod("style.css")]);
  const a = patchIndex(html), b = patchApp(js), c = patchStyle(css);
  assert.equal(b.changes.length, APP_PATCHES.length + 1, "app.js 고리 전부 + 이름 변경");
  assert.ok(!b.js.includes("국정 한눈에") && b.js.includes("[국정 상황판]"), "복사 문구 이름");
  assert.match(a.html, /<title>국정 상황판<\/title>/);
  assert.match(a.html, /국정 상황판은 정부·대통령실과 관계없는/);
  assert.equal(c.changes.length, 1);
  assert.match(a.html, /<link rel="stylesheet" href="\/core\/core\.css\?v=1">/);
  assert.match(a.html, /<script type="module" src="\/core\/core\.js\?v=1"><\/script>/);
  assert.ok(a.html.indexOf("/core/core.js") > a.html.indexOf("assets/app.js"), "공용 계층은 app.js 뒤");
  assert.match(a.html, /<div hidden><dt>임기<\/dt><dd id="term">-<\/dd><\/div>/, "임기 칸은 숨기되 id 는 남겨 app.js 가 깨지지 않게");
  assert.match(a.html, /<dt>최종 수집<\/dt><dd><button type="button" class="upd-btn" id="refreshBtn"[^>]*><i class="gk-st" id="gkSt"[^>]*><\/i><span id="updated">/);
  assert.match(a.html, /<span class="nt-k">보도 집중도<\/span>/);
  assert.match(a.html, /<meta property="og:image" content="https:\/\/gukjeong-hannune\.vercel\.app\/og\/site\.png">/);
  assert.match(a.html, /<meta property="og:image" content="https:\/\/gukjeong-hannune\.vercel\.app\/og\/site\.png">/);
  assert.ok(!/국정 온도/.test(a.html));
  assert.ok(!/\$\('term'\)\.textContent\}`/.test(b.js), "제목에 취임 경과를 붙이지 않음");
  assert.ok(!/fetchData\(`\/api\/dashboard\?t=\$\{Date\.now\(\)\}`, 55000\)\.then\(\(n\)/.test(b.js), "뒤에서 새로 받기에 캐시 우회 없음");
  assert.ok(/\$\('refreshBtn'\)[\s\S]*fetchData\(`\/api\/dashboard\?t=\$\{Date\.now\(\)\}`/.test(b.js), "직접 새로고침(30초 제한)은 그대로 원본 재생성");
  assert.match(b.js, /const REFRESH_MS = 60 \* 1000;/);
  assert.match(b.js, /dispatchEvent\(new CustomEvent\('gk:data'/);
  assert.match(c.css, /\.at-ticks \.tk \{ position: absolute;/);
  assert.ok(!/^\.tk \{ position: absolute/m.test(c.css), "전역 .tk 절대 위치 제거");
  assert.deepEqual([patchIndex(a.html).changes, patchApp(b.js).changes, patchStyle(c.css).changes], [[], [], []]);
  assert.throws(() => patchApp(js.replace("function multiLine(", "function multiLine2(")), /multiLine|mline/);
  // 고친 app.js 가 문법상 온전한지
  const dir = await mkdtemp(join(tmpdir(), "gk-"));
  await writeFile(join(dir, "app.mjs"), b.js);
  const r = spawnSync(process.execPath, ["--check", join(dir, "app.mjs")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});
