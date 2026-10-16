import { test } from "node:test";
import assert from "node:assert/strict";
import { ISSUES } from "../outlook/data/index.mjs";
import { validateIssue, checkProbabilityPolicy, replayView, flowResidual, selectionScore, rankIssues, independentSources } from "../outlook/lib/engine.mjs";
import handler from "../api/outlook/issues.mjs";
import perf from "../api/outlook/forecast-performance.mjs";

const nps = ISSUES.find((d) => d.issue.id === "nps-rebalancing-2026");
const ev = (id) => nps.evidence.find((e) => e.id === id);

test("모든 이슈가 스키마·출처·참조 규칙을 통과한다", () => {
  for (const d of ISSUES) assert.deepEqual(validateIssue(d), [], d.issue.id);
});

test("시나리오에 확률 없음 · 예측은 정책 C 로 값 비움", () => {
  for (const s of nps.scenarios) assert.ok(!("probability" in s));
  for (const f of nps.forecasts) { assert.equal(f.policy, "C"); assert.equal(f.forecast_value, null); }
});

test("검증 모형 없이 확률을 넣으면 거부한다", () => {
  const f = { ...nps.forecasts[0], forecast_value: 0.65 };
  assert.ok(checkProbabilityPolicy(f).some((e) => /확률 출력 금지/.test(e)));
  const g = { ...f, policy: "A", model: { type: "logit", train_period: "2010-2025", n: 300, calibration: "ok", backtest: { score: 0.26 }, baseline: { score: 0.24 } } };
  assert.ok(checkProbabilityPolicy(g).some((e) => /기준모형보다 나쁘면/.test(e)));
});

test("수치 산술 검증: 비중·합계·집중도", () => {
  const v = ev("E06").raw_value;
  assert.equal((v.domesticEquity / v.fund * 100).toFixed(2), "24.85");
  assert.equal(((1 - v.fund / v.fundPrev) * 100).toFixed(1), "9.7");
  assert.equal(((1 - v.domesticEquity / v.domesticEquityPrev) * 100).toFixed(1), "22.9");
  const k = ev("E14").raw_value;
  assert.equal((k.top2 / k.total * 100).toFixed(1), "79.1");
  const c = ev("E11").raw_value;
  assert.equal((-c.chg / (c.close - c.chg) * 100).toFixed(2), "7.57");
});

test("투자자 범주 합계 공백을 숨기지 않는다", () => {
  const r = flowResidual(nps.series.flows1015.bars);
  assert.equal(r.sum, -6425);
  assert.match(nps.series.flows1015.residualNote, /미수집/);
  assert.match(ev("E12").note, /-6,425/);
});

test("사후 재구성은 그 시점 이후 공개 자료를 숨긴다", () => {
  for (const asOf of nps.replay.points) {
    const r = replayView(nps, asOf);
    for (const e of r.evidence) { assert.ok(e.published_at <= asOf, `${e.id} 유출 @${asOf}`); assert.ok(e.valid_as_of <= asOf); }
    assert.match(r.label, /사후 재구성/);
  }
  const may = replayView(nps, "2026-05-28");
  assert.ok(!may.evidence.some((e) => e.id === "E05"), "6월 말 비중(10/08 보도)이 5/28 화면에 나오면 안 됨");
  assert.ok(!may.evidence.some((e) => e.id === "E01"), "1월 결정도 보도일(10/14) 기준이면 숨김");
  assert.equal(replayView(nps, "2026-10-16").hidden, 0);
});

test("재인용 보도는 독립 원천 하나로 센다", () => {
  assert.equal(independentSources([{ provenance_chain: ["한국거래소", "A"] }, { provenance_chain: ["한국거래소", "B"] }]), 1);
});

test("선별 점수는 0–100 · 오래된 이슈는 뒤로", () => {
  assert.ok(selectionScore(nps.issue.selection) > 60);
  const old = { ...nps, issue: { ...nps.issue, id: "old", analyzedAt: "2026-01-01T00:00:00+09:00" } };
  const r = rankIssues([old, nps], new Date("2026-10-16T12:00:00+09:00"));
  assert.equal(r[0].id, nps.issue.id); assert.equal(r[1].stale, true);
});

function call(h, query, method = "GET") {
  return new Promise((resolve) => {
    const res = { headers: {}, code: 200, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { resolve({ code: this.code, body: b, headers: this.headers }); } };
    h({ method, query }, res);
  });
}
test("API: 목록·상세·보기·재구성·오류", async () => {
  const l = await call(handler, {}); assert.equal(l.code, 200); assert.equal(l.body.issues[0].id, "nps-rebalancing-2026");
  assert.match(l.headers["Cache-Control"], /s-maxage/);
  const d = await call(handler, { id: "nps-rebalancing-2026" }); assert.equal(d.body.evidence.length, nps.evidence.length);
  const s = await call(handler, { id: "nps-rebalancing-2026", view: "scenarios" }); assert.equal(s.body.scenarios.length, 3);
  const r = await call(handler, { id: "nps-rebalancing-2026", asOf: "2026-07-31" }); assert.ok(r.body.replay.hidden > 0);
  assert.equal((await call(handler, { id: "x" })).code, 404);
  assert.equal((await call(handler, { id: "nps-rebalancing-2026", asOf: "bad" })).code, 400);
  assert.equal((await call(handler, {}, "POST")).code, 405);
});
test("성과 API 는 표본 부족을 밝힌다", async () => {
  const p = await call(perf, {}); assert.equal(p.body.resolved, 0); assert.match(p.body.note, /30건 미만/);
});
