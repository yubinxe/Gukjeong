import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { matchRegion, regionName, sidoOf, SIGUNGU } from "../officials/lib/regions.mjs";
import * as X from "../officials/lib/engine.mjs";
import { feature, bbox } from "../officials/lib/topo.mjs";
import { parseCSV, classify, buildSnapshot } from "../scripts/officials/build.mjs";
import { patchIndex, patchApp, syncShell } from "../scripts/integrate.mjs";

const json = async (p) => JSON.parse(await readFile(new URL(p, import.meta.url), "utf8"));
const load = async (dir) => ({ manifest: await json(`${dir}manifest.json`), officials: await json(`${dir}officials.json`), holdings: await json(`${dir}holdings.json`), totals: await json(`${dir}totals.json`) });

test("소재지 → 시군구: 일반·구가 있는 시·개편·동명 지역·해외·미확인", () => {
  const m = (s) => { const r = matchRegion(s); return [r.code, r.confidence]; };
  assert.deepEqual(m("서울특별시 강남구 압구정동 456 현대아파트"), ["11230", "exact"]);
  assert.deepEqual(m("경기도 성남시 분당구 정자동"), ["31023", "exact"]);
  assert.deepEqual(m("경기도 수원시 장안구 정자동"), ["31011", "exact"]);
  assert.deepEqual(m("경기도 부천시 원미구 중동"), ["31050", "parent"]);
  assert.deepEqual(m("대구광역시 군위군 군위읍"), ["37310", "exact"]);
  assert.deepEqual(m("경상북도 군위군 군위읍"), ["37310", "exact"], "편입 전 표기");
  assert.equal(sidoOf("37310"), "22", "군위군은 현재 대구");
  assert.deepEqual(m("강원도 고성군 토성면"), ["32400", "exact"]);
  assert.deepEqual(m("경상남도 고성군 고성읍"), ["38340", "exact"]);
  assert.deepEqual(m("인천광역시 남구 주안동"), ["23030", "exact"]);
  assert.deepEqual(m("인천광역시 미추홀구 주안동"), ["23030", "exact"]);
  assert.deepEqual(m("세종특별자치시 어진동"), ["29010", "exact"]);
  assert.deepEqual(m("광주광역시 북구 운암동"), ["24040", "exact"]);
  assert.deepEqual(m("경기도 광주시 오포읍"), ["31250", "exact"]);
  assert.deepEqual(m("전북특별자치도 전주시 완산구 효자동"), ["35011", "exact"]);
  assert.deepEqual(m("전라북도 전주시 완산구 효자동"), ["35011", "exact"]);
  assert.deepEqual(m("강원특별자치도 춘천시 효자동"), ["32010", "exact"]);
  assert.deepEqual(m("경기도 수원시"), ["31", "sido"], "구가 여럿인 시를 한 구에 넣지 않는다");
  assert.deepEqual(m("미국 캘리포니아주 어바인"), ["F", "exact"]);
  assert.deepEqual(m(""), ["X", "none"]);
  assert.deepEqual(m("어딘가 알 수 없는 곳"), ["X", "none"]);
  assert.equal(regionName("31023"), "경기도 성남시 분당구");
  assert.equal(regionName("23030", { short: true }), "인천 미추홀구");
});

test("지도 경계: 시도 17 · 시군구 250, 카탈로그와 코드가 같다", async () => {
  const topo = await json("../officials/geo/korea.topo.json");
  const sido = feature(topo, "sido"), sgg = feature(topo, "sigungu");
  assert.equal(new Set(sido.features.map((f) => f.properties.sido)).size, 17);
  const codes = new Set(sgg.features.map((f) => f.properties.code));
  assert.equal(codes.size, 250);
  for (const c of Object.keys(SIGUNGU)) assert.ok(codes.has(c), `경계에 없는 코드 ${c}`);
  const gw = sgg.features.find((f) => f.properties.code === "37310");
  assert.equal(gw.properties.sido, "22", "군위군 경계는 대구로 묶인다");
  const [x0, y0, x1, y1] = bbox(sgg.features.find((f) => f.properties.code === "11230"));
  assert.ok(x0 > 126.9 && x1 < 127.2 && y0 > 37.4 && y1 < 37.6, "강남구 경계 상자가 서울 남동쪽");
});

test("자료 검증: 실제 자료(수집 전)와 합성 자료 모두 구조가 맞다", async () => {
  const real = await load("../officials/data/");
  assert.deepEqual(X.validate(real), []);
  assert.equal(real.manifest.synthetic, false);
  assert.equal(real.manifest.snapshots.length, 0, "검증된 공개 원문이 들어오기 전에는 시점이 없다");
  assert.ok(real.officials.length > 600 && real.officials.every((o) => o.id && o.name && o.terms.length));
  assert.ok(!real.officials.some((o) => /가상/.test(o.name)), "실명 명부에 합성 인물이 섞이지 않는다");
  const syn = await load("./fixtures/officials-synthetic/");
  assert.deepEqual(X.validate(syn), []);
  assert.equal(syn.manifest.synthetic, true);
  assert.ok(syn.officials.every((o) => /^가상인물/.test(o.name)), "합성 자료는 가상 이름만");
  assert.ok(syn.officials.every((o) => o.party.every((p) => /가상/.test(p.name))), "합성 자료는 가상 정당만");
});

test("검증이 잡아내는 것: 중복 집계 · 음수 · 지역 합 불일치 · 원문 주소 없음", () => {
  const base = () => ({ manifest: { schema: 1, synthetic: false, snapshots: [{ id: "2026-03-26", published: "2026-03-26", basis: "2025-12-31", source: { url: "https://example.org/a.pdf" } }] },
    officials: [{ id: "a", name: "가", terms: [22] }], holdings: { rows: [[0, 0, "11230", "own", 1000, 1]] }, totals: { rows: [[0, 0, 1000, 1000, 0, 0, 0, 0, 0]] } });
  assert.deepEqual(X.validate(base()), []);
  const dup = base(); dup.holdings.rows.push([0, 0, "11230", "own", 5, 1]); dup.totals.rows[0][3] = 1005;
  assert.ok(X.validate(dup).some((e) => /중복 집계/.test(e)));
  const neg = base(); neg.holdings.rows[0][4] = -1;
  assert.ok(X.validate(neg).some((e) => /0 이상/.test(e)));
  const mis = base(); mis.totals.rows[0][3] = 999;
  assert.ok(X.validate(mis).some((e) => /불일치/.test(e)));
  const nourl = base(); nourl.manifest.snapshots[0].source = {};
  assert.ok(X.validate(nourl).some((e) => /원문 주소/.test(e)));
});

test("집계: 시도는 시도까지만 아는 항목을 포함하고, 시군구는 따로 센다", () => {
  const d = { manifest: { schema: 1, synthetic: true, snapshots: [{ id: "s", published: "2026-03-26", basis: "2025-12-31", term: 22 }] }, officials: [{ id: "a", terms: [22] }, { id: "b", terms: [22] }],
    holdings: { rows: [[0, 0, "11230", "own", 100, 1], [0, 0, "11", "own", 50, 1], [0, 1, "31023", "own", 30, 2], [0, 1, "X", "own", 7, 1], [0, 1, "11230", "lease", 999, 1]] },
    totals: { rows: [[0, 0, 150, 150, 0, 0, 0, 0, 0], [0, 1, 1036, 1036, 0, 0, 0, 0, 0]] } };
  const c = X.cohort(d, { snapshot: 0, term: 22 });
  const sido = X.regionAgg(d, { si: 0, ids: c.ids, level: "sido" });
  assert.equal(sido.regions.get("11").value, 150);
  assert.equal(sido.regions.get("31").holders, 1);
  assert.equal(sido.unplaced.value, 7);
  const sgg = X.regionAgg(d, { si: 0, ids: c.ids, level: "sigungu" });
  assert.equal(sgg.regions.get("11230").value, 100, "임차권은 소유 지도에 들어가지 않는다");
  assert.equal(sgg.unplaced.value, 57, "시도까지만 아는 50 + 미확인 7");
  const all = X.regionAgg(d, { si: 0, ids: c.ids, level: "sigungu", classes: ["own", "lease"] });
  assert.equal(all.regions.get("11230").value, 1099);
});

test("색 단계 · 증감 · 순위 · 집중도 · 금액 표기", () => {
  const br = X.breaks([1e8, 2e8, 5e8, 1e9, 3e9, 1e10, 4e10, 1e11], 6);
  assert.ok(br.every((b, i) => i === 0 || b > br[i - 1]), "단계는 오름차순");
  assert.equal(X.classOf(null, br), -1); assert.equal(X.classOf(0, br), 0); assert.ok(X.classOf(1e11, br) > X.classOf(1e8, br));
  const A = { regions: new Map([["11", { value: 10 }], ["31", { value: 5 }]]) }, B = { regions: new Map([["11", { value: 12 }], ["26", { value: 3 }]]) };
  const d = X.diff(A, B);
  assert.equal(d.get("11").state, "up"); assert.equal(d.get("31").state, "down"); assert.equal(d.get("26").d, 3);
  assert.deepEqual(X.rank({ regions: new Map([["a", { value: 1 }], ["b", { value: 3 }], ["c", { value: 0 }]]) }).map((r) => r.code), ["b", "a"], "0원 지역은 순위에 넣지 않는다");
  assert.equal(X.won(4498010000), "44억 9,801만원");
  assert.equal(X.won(4498010000, { short: true }), "45억");
  assert.equal(X.won(-30000000), "−3,000만원");
  assert.equal(X.won(null), "—");
});

test("변화 분해: 공통 변화 + 진입 − 퇴장 = 전체 변화(합성 자료 전 구간)", async () => {
  const d = await load("./fixtures/officials-synthetic/");
  const S = d.manifest.snapshots;
  for (let a = 0; a < S.length; a++) for (let b = a + 1; b < S.length; b++) {
    const A = X.cohort(d, { snapshot: a, term: S[a].term }), B = X.cohort(d, { snapshot: b, term: S[b].term });
    for (const f of ["net", "realEstate"]) assert.ok(X.decompose(d, A, B, f).identity, `${S[a].id}→${S[b].id} ${f}`);
  }
  const c = X.cohort(d, { snapshot: S.length - 1, term: 22 }), cc = X.concentration(d, { si: c.si, ids: c.ids });
  assert.ok(Math.abs(cc.share.capital + cc.share.nonCapital + cc.share.unplaced - 1) < 1e-9, "비중 합 = 1");
  assert.ok(cc.median <= cc.max && cc.top10.share > 0 && cc.top10.share <= 1);
});

test("정당은 기준일의 소속만 — 지금 소속을 과거에 소급하지 않는다", () => {
  const o = { party: [{ name: "가당", from: "2020-05-30", to: "2023-01-31" }, { name: "나당", from: "2023-02-01", to: null }] };
  assert.equal(X.partyAt(o, "2022-12-31"), "가당");
  assert.equal(X.partyAt(o, "2025-12-31"), "나당");
  assert.equal(X.partyAt({ party: [] }, "2025-12-31"), null);
  assert.equal(X.partyAt({ party: [{ name: "다당", from: "2024-06-01", to: null }] }, "2024-05-30"), null, "가입 전 시점은 모른다");
});

test("원문 항목표 → 자료: 분류 · 천원 단위 · 총계 대조 · 동명이인 · 명부 밖 이름", () => {
  assert.deepEqual(parseCSV('a,b\n"가, 나",2\n\n3,"x""y"\n'), [{ a: "가, 나", b: "2" }, { a: "3", b: 'x"y' }]);
  assert.deepEqual(classify("건물", "아파트"), { field: "realEstate", cls: "own" });
  assert.deepEqual(classify("건물", "전세(임차)권"), { field: "realEstate", cls: "lease" });
  assert.deepEqual(classify("부동산에 관한 규정이 준용되는 권리와 자동차·건설기계·선박 및 항공기", "분양권"), { field: "realEstate", cls: "right" });
  assert.deepEqual(classify("부동산에 관한 규정이 준용되는 권리와 자동차·건설기계·선박 및 항공기", "자동차"), { field: "other" });
  assert.deepEqual(classify("고지거부 및 등록제외사항", ""), { refused: true });
  const registry = [{ id: "wd-1", name: "홍길동", terms: [22] }, { id: "wd-2", name: "김철수", terms: [22] }, { id: "wd-3", name: "김철수", terms: [22] }];
  const meta = { published: "2026-03-26", basis: "2025-12-31", kind: "정기", term: 22 };
  const rows = [
    { official: "홍길동", relation: "본인", category: "건물", kind: "아파트", location: "서울특별시 강남구 개포동", cur: "1,200,000" },
    { official: "홍길동", relation: "배우자", category: "토지", kind: "대지", location: "경기도 수원시", cur: "300,000" },
    { official: "홍길동", relation: "본인", category: "예금", kind: "", location: "", cur: "50,000" },
    { official: "홍길동", relation: "본인", category: "채무", kind: "", location: "", cur: "400,000" },
    { official: "홍길동", relation: "", category: "총계", kind: "", location: "", cur: "1,150,000" },
  ];
  const ok = buildSnapshot(meta, rows, registry);
  assert.deepEqual(ok.errors, []);
  const p = ok.people.get(0);
  assert.equal(p.sums.realEstate, 1500000000, "천원 → 원");
  assert.equal(p.sums.debts, 400000000);
  assert.equal(p.holdings.get("11230|own").value, 1200000000);
  assert.equal(p.holdings.get("31|own").value, 300000000, "구를 모르는 수원시는 경기까지만");
  const bad = buildSnapshot(meta, [...rows.slice(0, 4), { ...rows[4], cur: "1,000,000" }], registry);
  assert.ok(bad.errors.some((e) => /총계/.test(e)), "총계가 맞지 않으면 실패");
  assert.ok(buildSnapshot(meta, [{ ...rows[0], official: "김철수" }], registry).errors.some((e) => /동명이인/.test(e)));
  assert.deepEqual(buildSnapshot(meta, [{ ...rows[0], official: "김철수", official_id: "wd-3" }], registry).errors, []);
  assert.ok(buildSnapshot(meta, [{ ...rows[0], official: "이영희" }], registry).errors.some((e) => /명부에 없음/.test(e)));
});

test("운영 홈 통합: 모션 계층 · 새 메뉴 두 곳 · countUp 연결 · 두 번 돌려도 같다", async () => {
  const html = await readFile(new URL("./fixtures/site-nav.html", import.meta.url), "utf8");
  const a = patchIndex(html);
  assert.equal(a.changes.length, 3);
  assert.match(a.html, /<link rel="stylesheet" href="\/motion\/motion\.css\?v=1">/);
  assert.match(a.html, /<script type="module" src="\/motion\/motion\.js\?v=1"><\/script>/);
  for (const href of ["/briefing/", "/officials/"]) assert.equal((a.html.match(new RegExp(`href="${href}"`, "g")) || []).length, 2, `${href}: 위쪽 탭 줄 + 전체 메뉴`);
  const bar = a.html.match(/<nav class="tabbar"[\s\S]*?<\/nav>/)[0];
  assert.equal(bar, html.match(/<nav class="tabbar"[\s\S]*?<\/nav>/)[0], "아래 탭 막대는 그대로");
  const views = a.html.match(/<nav class="views"[\s\S]*?<\/nav>/)[0];
  assert.ok(views.indexOf("/officials/") > views.indexOf('data-view="policy"'), "공직자 재산 동향은 입법·정책 다음");
  assert.equal(patchIndex(a.html).changes.length, 0);
  const js = "function countUp(root) {\n  if (!motionOK.matches) return;";
  const b = patchApp(js);
  assert.match(b.js, /if \(window\.__moCount\) return window\.__moCount\(root\);/);
  assert.equal(patchApp(b.js).changes.length, 0);
  assert.throws(() => patchIndex("<html></html>"), /기준 표지/);
  const page = "<body><!-- shell:views -->\n<!-- /shell:views --><!-- shell:tabbar -->\n<!-- /shell:tabbar --><!-- shell:sheet -->\n<!-- /shell:sheet --></body>";
  const s = syncShell(page, a.html, "/officials/").html;
  assert.ok(!/data-view=/.test(s), "app.js 가 없는 페이지에는 data-view 를 넣지 않는다");
  assert.match(s, /<a href="\/officials\/" role="tab" aria-selected="true">/);
  assert.match(s, /id="moreBtn" data-on/);
  assert.ok(!/href="\.\/"|href="\?/.test(s), "모든 주소가 절대 경로");
});
