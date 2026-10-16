// 국정 한눈에 3.0 — 전망 인텔리전스 엔진 (의존성 0, Node 18+ · 브라우저 공용)
// FACT → MECHANISM → CONSENSUS → SCENARIO → FORECAST → VERIFICATION
// 원칙: 출처 없는 수치를 만들지 않는다 · 검증된 모형 없이는 확률을 내지 않는다 · 과거 시점 화면에 미래 정보를 섞지 않는다.

export const EVIDENCE_FIELDS = ["id", "claim", "valid_as_of", "published_at", "publisher", "source_type", "is_primary_source",
  "source_url", "raw_value", "unit", "verification_status", "provenance_chain", "license_status", "kind"];
export const SCENARIO_FIELDS = ["scenario_id", "issue_id", "scenario_type", "summary", "assumptions", "causal_chain",
  "supporting_evidence_ids", "contradicting_evidence_ids", "leading_indicators", "trigger_conditions", "invalidation_conditions",
  "forecast_horizon", "expected_impacts", "confidence_grade", "updated_at"];
export const FORECAST_FIELDS = ["forecast_id", "issue_id", "question_id", "created_at", "forecast_as_of", "model_version",
  "data_version", "forecast_value", "revision_reason", "resolution_date", "actual_outcome", "evaluation_status", "evaluation_metric"];

// 자료 상태 — 사실과 해석을 섞지 않는다.
export const KIND_LABEL = {
  fact: "확인된 사실", outlook: "기관 전망", interpretation: "해석", hypothesis: "분석 가설",
  claim: "이해관계자 주장", unverified: "미확인", resolved: "사후 판정",
};

// 확률 출력 정책 A–D (명령서 6항)
export const PROB_POLICY = {
  A: "검증된 정량모형 — 시점외 검증·보정을 통과한 경우만 확률 표시",
  B: "공개 수치 컨센서스 — 기관 전망의 분포를 보여 주되 사건 확률로 바꾸지 않음",
  C: "근거 있는 정성 분석 — 확률 대신 조건과 논리",
  D: "자료 불충분 — 전망 보류, 필요한 데이터 제시",
};

// ── 이슈 선별: 기사량이 아니라 여섯 요소(0–3)로 점수화 ──
const SEL_W = { publicness: 1, impact: 1.5, novelty: 1.2, urgency: 1, forecastability: 1, sourceReliability: 1.3 };
export function selectionScore(sel) {
  if (!sel) return 0;
  let s = 0, max = 0;
  for (const [k, w] of Object.entries(SEL_W)) { const v = Number(sel[k]); s += (Number.isFinite(v) ? Math.max(0, Math.min(3, v)) : 0) * w; max += 3 * w; }
  return Math.round((s / max) * 100);
}

// ── 검증 ──
export function validateIssue(doc) {
  const errs = [];
  const ev = new Map();
  for (const e of doc.evidence || []) {
    for (const f of EVIDENCE_FIELDS) if (!(f in e)) errs.push(`${e.id || "?"}: 필드 누락 ${f}`);
    if (ev.has(e.id)) errs.push(`${e.id}: 중복 id`);
    ev.set(e.id, e);
    if (!/^https:\/\//.test(e.source_url || "")) errs.push(`${e.id}: 출처 URL 없음`);
    if (!KIND_LABEL[e.kind]) errs.push(`${e.id}: 알 수 없는 kind ${e.kind}`);
    if (e.published_at && e.valid_as_of && e.valid_as_of > e.published_at) errs.push(`${e.id}: 기준일이 발행일보다 늦음`);
    if (e.raw_value !== null && e.raw_value !== undefined && !e.unit) errs.push(`${e.id}: 수치에 단위 없음`);
  }
  const refOk = (id, where) => { if (!ev.has(id)) errs.push(`${where}: 없는 근거 ${id}`); };
  for (const h of doc.hypotheses || []) { [...h.support, ...h.contra].forEach((id) => refOk(id, h.id)); }
  for (const m of doc.mechanism || []) m.evidence.forEach((id) => refOk(id, `기전 ${m.step}`));
  for (const t of doc.timeline || []) t.evidence.forEach((id) => refOk(id, `타임라인 ${t.date}`));
  for (const s of doc.scenarios || []) {
    for (const f of SCENARIO_FIELDS) if (!(f in s)) errs.push(`${s.scenario_id || "?"}: 필드 누락 ${f}`);
    [...(s.supporting_evidence_ids || []), ...(s.contradicting_evidence_ids || [])].forEach((id) => refOk(id, s.scenario_id));
    if (/\d+\s*%/.test(s.confidence_grade || "") || "probability" in s) errs.push(`${s.scenario_id}: 시나리오에 확률 표기 금지(검증 모형 없음)`);
  }
  for (const f of doc.forecasts || []) {
    for (const k of FORECAST_FIELDS) if (!(k in f)) errs.push(`${f.forecast_id || "?"}: 필드 누락 ${k}`);
    errs.push(...checkProbabilityPolicy(f));
  }
  const series = doc.series || {};
  for (const [k, s] of Object.entries(series)) {
    if (!s.unit) errs.push(`차트 ${k}: 단위 없음`);
    const ids = [s.evidence, ...(s.points || []).map((p) => p.evidence)].filter(Boolean);
    if (!ids.length) errs.push(`차트 ${k}: 출처 없음`);
    ids.forEach((id) => refOk(id, `차트 ${k}`));
  }
  return errs;
}

// 확률은 정책 A(검증 모형)일 때만, 모델 메타데이터와 함께.
export function checkProbabilityPolicy(f) {
  const errs = [];
  if (!PROB_POLICY[f.policy]) errs.push(`${f.forecast_id}: 정책 A–D 미지정`);
  if (f.forecast_value !== null && f.forecast_value !== undefined) {
    if (f.policy !== "A") errs.push(`${f.forecast_id}: 정책 ${f.policy}에서 확률 출력 금지`);
    const m = f.model || {};
    for (const k of ["type", "train_period", "n", "backtest", "baseline", "calibration"]) if (!m[k]) errs.push(`${f.forecast_id}: 모델 기록 누락 ${k}`);
    if (m.backtest && m.baseline && !(m.backtest.score < m.baseline.score)) errs.push(`${f.forecast_id}: 기준모형보다 나쁘면 확률 비표시`);
  }
  for (const k of ["question", "outcome_variable", "unit", "resolution_source"]) if (!f[k]) errs.push(`${f.forecast_id}: 예측 질문 정의 누락 ${k}`);
  return errs;
}

// ── 회계 정합성: 투자자 범주 순매수의 합 — 집계 범위 밖 범주가 얼마나 남는지 ──
export function flowResidual(bars) {
  const sum = bars.reduce((a, b) => a + b.value, 0);
  const gross = bars.reduce((a, b) => a + Math.abs(b.value), 0);
  return { sum, share: gross ? Math.abs(sum) / gross : 0 };
}

// ── 독립 정보원 수: 같은 원천을 재인용한 보도는 하나로 센다 ──
export function independentSources(evidence) {
  const roots = new Set();
  for (const e of evidence) roots.add((e.provenance_chain && e.provenance_chain[0]) || e.source_url);
  return roots.size;
}

// ── 사후 재구성: asOf 이후 공개된 자료는 숨긴다(미래 정보 유출 방지) ──
export function replayView(doc, asOf) {
  const visible = (doc.evidence || []).filter((e) => e.published_at <= asOf && e.valid_as_of <= asOf);
  const ids = new Set(visible.map((e) => e.id));
  return {
    asOf,
    label: "사후 재구성 — 당시 공개 자료만 사용, 당시 실제 예측 아님",
    recordedForecasts: (doc.replay?.recordedForecasts || []).filter((f) => f.created_at <= asOf),
    evidence: visible,
    timeline: (doc.timeline || []).filter((t) => t.date <= asOf).map((t) => ({ ...t, evidence: t.evidence.filter((id) => ids.has(id)) })),
    hidden: (doc.evidence || []).length - visible.length,
  };
}

export function evidenceStats(doc) {
  const by = {};
  for (const e of doc.evidence || []) by[e.kind] = (by[e.kind] || 0) + 1;
  return { total: (doc.evidence || []).length, byKind: by, independent: independentSources(doc.evidence || []),
    primary: (doc.evidence || []).filter((e) => e.is_primary_source).length };
}

// 홈 '오늘의 분기점' 카드용 요약 — 오래된 이슈는 새 이슈처럼 보이지 않게 경과일을 함께 준다.
export function summarize(doc, now = new Date()) {
  const i = doc.issue;
  const ageDays = Math.floor((now - new Date(i.analyzedAt)) / 864e5);
  const facts = (doc.evidence || []).filter((e) => e.kind === "fact").sort((a, b) => b.valid_as_of.localeCompare(a.valid_as_of));
  return {
    id: i.id, title: i.title, verdict: i.verdict, status: i.status, score: selectionScore(i.selection),
    keyFact: facts[0] ? { text: facts[0].claim, asOf: facts[0].valid_as_of, id: facts[0].id } : null,
    keyCondition: (doc.changeConditions || [])[0] || null,
    forecastPolicy: [...new Set((doc.forecasts || []).map((f) => f.policy))].join("·") || "D",
    analyzedAt: i.analyzedAt, ageDays, stale: ageDays > 7,
  };
}

export function rankIssues(docs, now = new Date()) {
  return docs.map((d) => summarize(d, now)).sort((a, b) => (a.stale - b.stale) || (b.score - a.score) || b.analyzedAt.localeCompare(a.analyzedAt));
}
