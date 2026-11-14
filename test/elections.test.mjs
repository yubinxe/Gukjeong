// 선거 후 시장: 계산 엔진 · 선거 명부 · 실린 자료(events.json)의 내부 정합
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { std, quantile, percentileOf, series, anchorIndex, eventStudy, volAt, maxDrawdown, baseline, binom, groupSummary, medianPath, PRE, ANN } from "../elections/lib/stats.mjs";
import { ELECTIONS, ASSETS, KINDS, label } from "../elections/lib/elections.mjs";
import { parseNaver, parseFred, gaps, compute } from "../scripts/elections/build.mjs";

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test("기초 통계: 표본 표준편차 · 분위(type 7) · 백분위 · 최대 낙폭", () => {
  close(std([2, 4, 4, 4, 5, 5, 7, 9]), Math.sqrt(32 / 7));
  assert.equal(std([1]), null);
  const s = [1, 2, 3, 4, 5];
  close(quantile(s, 0.5), 3); close(quantile(s, 0.25), 2); close(quantile(s, 0.1), 1.4);
  close(percentileOf(s, 3), 50); close(percentileOf(s, 0), 0); close(percentileOf(s, 9), 100);
  close(maxDrawdown([100, 110, 99, 120, 90, 95]), 90 / 120 - 1);
  assert.equal(maxDrawdown([100, 101, 102]), 0);
});

test("정확 이항검정: 손으로 셀 수 있는 경우와 일치", () => {
  close(binom(8, 10, 0.5), 112 / 1024, 1e-12);        // 양쪽: P(X≤2)+P(X≥8)
  close(binom(10, 10, 0.5, { two: false }), 1 / 1024, 1e-12);
  close(binom(5, 10, 0.5), 1, 1e-12);
  close(binom(1, 3, 0.1, { two: false }), 1 - 0.9 ** 3, 1e-12);
});

// 합성 시계열: 평일만, 수익률 크기를 구간마다 정해 변동성 비율을 정확히 안다
function synth({ start = "2020-01-01", n = 400, amp = () => 0.01 } = {}) {
  const rows = []; let c = 1000, t = Date.parse(start), i = 0;
  while (rows.length < n) {
    const d = new Date(t); t += 864e5;
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const iso = d.toISOString().slice(0, 10);
    if (iso === "2020-06-03") continue; // 휴장(선거일)
    c *= Math.exp((i++ % 2 ? -1 : 1) * amp(rows.length, iso));
    rows.push([iso.replace(/-/g, ""), c]);
  }
  return series(rows);
}

test("사건 연구: 기준일은 선거일 직전 거래일, 경로는 기준 100, 변동성 비율은 구간 크기 비율", () => {
  const s = synth({ amp: (k, iso) => (iso < "2020-06-03" ? 0.01 : 0.03) }); // 선거 뒤부터 일간 변동 3배
  const i0 = anchorIndex(s, "2020-06-03");
  assert.equal(s.d[i0], "2020-06-02");
  assert.throws(() => anchorIndex(s, "2020-06-04"), /거래일/, "선거일이 거래일이면 멈춘다");
  const ev = eventStudy(s, "2020-06-03", { H: 60 });
  assert.equal(ev.t0, "2020-06-02"); assert.equal(ev.t1, "2020-06-04");
  assert.equal(ev.path.length, PRE + 61); assert.equal(ev.path[PRE], 100);
  assert.equal(ev.dd[PRE], 0); assert.equal(ev.dd[PRE + 1], 2);
  const v = volAt(s, i0);
  close(v.ratio, ev.ratio);
  close(ev.ratio, 3, 1e-9);
  close(ev.volPre, v.pre * ANN);
  assert.ok(ev.avail === 60 && ev.mdd60 <= 0);
  assert.equal(eventStudy(s, "2020-01-04"), null, "선거 전 20거래일이 자료 앞이면 비운다");
});

test("평시 분포: 띠는 분위 순서, 기준일 값은 100, 비율 분포는 정렬", () => {
  const s = synth({ n: 300, amp: (k) => 0.005 + (k % 37) / 2000 });
  const b = baseline(s, { H: 30 });
  assert.equal(b.band.length, PRE + 31);
  for (const q of b.band) for (let i = 1; i < q.length; i++) assert.ok(q[i] >= q[i - 1]);
  assert.deepEqual(b.band[PRE], [100, 100, 100, 100, 100]);
  for (let i = 1; i < b.dist.ratio.length; i++) assert.ok(b.dist.ratio[i] >= b.dist.ratio[i - 1]);
  assert.deepEqual(medianPath([[1, 2, null], [3, 4, null], [5, 6, 7]]), [3, 4, null], "값이 셋 미만인 날은 비운다");
});

test("원자료 해석: 네이버 의사 JSON · FRED CSV(빈 값 건너뜀) · 공백 점검", () => {
  const nv = `[['날짜', '시가', '고가', '저가', '종가', '거래량', '외국인소진율'],\n["19900104", 911.21, 933.24, 911.21, 928.82, 18094, 0.0],\n["19900105", 926.56, 931.56, 913.66, 915.11, 22179, 0.0]]`;
  assert.deepEqual(parseNaver(nv), [["19900104", 928.82], ["19900105", 915.11]]);
  assert.deepEqual(parseFred("observation_date,DEXKOUS\n2024-01-01,\n2024-01-02,1300.5\n2024-01-03,.\n"), [["2024-01-02", 1300.5]]);
  assert.deepEqual(gaps(series([["2024-01-02", 1], ["2024-01-20", 2]])), ["2024-01-02→2024-01-20 18일"]);
  assert.throws(() => series([["2024-01-03", 1], ["2024-01-02", 2]]), /순서/);
});

test("선거 명부: 26번 · 평일 · 종류별 번호 연속 · 라벨", () => {
  assert.equal(ELECTIONS.length, 26);
  assert.equal(new Set(ELECTIONS.map((e) => e.id)).size, 26);
  for (const e of ELECTIONS) {
    const d = new Date(`${e.date}T00:00:00Z`).getUTCDay();
    assert.ok(d >= 1 && d <= 5, `${e.id} ${e.date} 평일`);
    assert.ok(KINDS[e.kind]);
  }
  for (const k of Object.keys(KINDS)) {
    const ns = ELECTIONS.filter((e) => e.kind === k).map((e) => e.n);
    for (let i = 1; i < ns.length; i++) assert.equal(ns[i], ns[i - 1] + 1, `${k} 번호 연속`);
  }
  assert.equal(label(ELECTIONS.find((e) => e.id === "P15")), "제15대 대통령 선거");
  assert.equal(ELECTIONS.find((e) => e.id === "P15").date, "1997-12-18", "Wikidata 오기(12-19)를 거래일 달력으로 바로잡음");
  assert.equal(label(ELECTIONS.find((e) => e.id === "L9")), "제9회 전국동시지방선거");
});

test("실린 자료 events.json: 선거일=휴장 검증 통과분 · 내부 정합 · 환율은 자유변동환율제 이후만", async () => {
  const D = JSON.parse(await readFile(new URL("../elections/data/events.json", import.meta.url), "utf8"));
  assert.equal(D.schema, 1); assert.equal(D.pre, PRE); assert.equal(D.elections.length, 26);
  assert.deepEqual(D.elections.map((e) => [e.id, e.date]), ELECTIONS.map((e) => [e.id, e.date]));
  for (const e of D.elections) {
    const k = e.m.kospi;
    assert.ok(k, `${e.id} 코스피`);
    assert.ok(k.t0 < e.date && k.t1 > e.date, `${e.id} 기준일<선거일<다음 거래일`);
    assert.equal(k.path[PRE], 100);
    close(k.ratio, k.volPost / k.volPre, 1e-9);
    for (const v of Object.values(k.pct)) if (v != null) assert.ok(v >= 0 && v <= 100);
    close(k.ret[20], k.path[PRE + 20] - 100, 1e-6);
    const u = e.m.usdkrw;
    if (e.date < "1998-02-01") assert.equal(u, null, `${e.id} 환율은 제도상 비교 불가`);
    else { assert.ok(u, `${e.id} 환율`); assert.ok(u.t0 < e.date); }
  }
  // 요약은 행에서 다시 셀 수 있어야 한다
  for (const a of Object.keys(ASSETS)) for (const [k, g] of Object.entries(D.summary[a])) {
    const rows = D.elections.filter((e) => (k === "all" || e.kind === k) && e.m[a]).map((e) => e.m[a]);
    assert.equal(g.n, rows.length);
    assert.equal(g.up, rows.filter((r) => r.ratio > 1).length);
    assert.equal(g.top, rows.filter((r) => r.pct.ratio > 90).length);
    assert.ok(g.pUp > 0 && g.pUp <= 1 && g.pTop > 0 && g.pTop <= 1);
  }
  assert.equal(D.assets.kospi.first, "1990-01-04");
  assert.equal(D.assets.usdkrw.base.band.length, PRE + D.horizon + 1);
});

test("계산 재현: 합성 원자료로 compute 를 돌리면 선거일 휴장 규칙을 지킨다", () => {
  // 선거일을 모두 비운 평일 달력 1989~2026 위에 일정한 진폭의 시계열
  const ed = new Set(ELECTIONS.map((e) => e.date));
  const rows = (start) => { const out = []; let c = 1000, i = 0; for (let t = Date.parse(start); t < Date.parse("2026-11-14"); t += 864e5) { const d = new Date(t), iso = d.toISOString().slice(0, 10); if (d.getUTCDay() % 6 === 0 || ed.has(iso)) continue; c *= Math.exp((i++ % 3 - 1) * 0.004); out.push([iso, +c.toFixed(4)]); } return out; };
  const out = compute({ kospi: rows("1990-01-04"), usdkrw: rows("1990-01-04") }, { asOf: "2026-11-14T00:00:00Z" });
  assert.equal(out.elections.length, 26);
  const g = groupSummary(out.elections.map((e) => e.m.kospi), [0.5, 1, 1.5]);
  assert.ok(g.n === 26);
  assert.equal(out.elections.find((e) => e.id === "P15").m.usdkrw, null);
});
