// 국정 한눈에 3.0 · 전망 인텔리전스 화면 (의존성 0)
import { KIND_LABEL, PROB_POLICY, rankIssues, replayView, evidenceStats, flowResidual } from "./lib/engine.mjs";

const STATIC = ["nps-rebalancing-2026"]; // API 가 없을 때(정적 배포·로컬) 읽을 파일
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const won = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toLocaleString("ko-KR");
const kst = (iso) => new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });

async function loadAll() {
  try { const r = await fetch("/api/outlook/issues"); if (r.ok && /json/.test(r.headers.get("content-type") || "")) return { list: (await r.json()).issues, docs: null }; } catch (e) { /* 정적 대체 */ }
  const docs = await Promise.all(STATIC.map((id) => fetch(`data/${id}.json`).then((r) => r.json())));
  return { list: rankIssues(docs), docs };
}
async function loadOne(id) {
  try { const r = await fetch(`/api/outlook/issues?id=${encodeURIComponent(id)}`); if (r.ok && /json/.test(r.headers.get("content-type") || "")) return r.json(); } catch (e) { /* 정적 대체 */ }
  if (!STATIC.includes(id)) throw new Error("이슈 없음");
  return fetch(`data/${id}.json`).then((r) => { if (!r.ok) throw new Error("불러오지 못함"); return r.json(); });
}

function renderList(list) {
  document.title = "오늘의 분기점 — 국정 한눈에";
  $("#app").innerHTML = `<div class="wrap forks">
    <p class="kicker">오늘의 분기점</p>
    <h1>지금 해석이 필요한 국정·시장 사건</h1>
    <p class="meta">기사량이 아니라 공공성·영향 범위·새 정보량·시급성·검증 가능성·자료 신뢰도로 골랐습니다. 분석이 7일 넘게 갱신되지 않은 이슈는 흐리게 표시합니다.</p>
    ${list.map((s) => `<a class="fork ${s.stale ? "stale" : ""}" href="?id=${encodeURIComponent(s.id)}">
      <h3>${esc(s.title)}</h3><p>${esc(s.verdict)}</p>
      <dl>${s.keyFact ? `<dt>확인된 사실</dt><dd>${esc(s.keyFact.text)} <span class="meta mono">${s.keyFact.asOf}</span></dd>` : ""}
      ${s.keyCondition ? `<dt>판단을 바꿀 조건</dt><dd>${esc(s.keyCondition)}</dd>` : ""}
      <dt>전망 상태</dt><dd>${esc(PROB_POLICY[s.forecastPolicy] || s.forecastPolicy)}</dd>
      <dt>마지막 분석</dt><dd class="mono">${kst(s.analyzedAt)}${s.stale ? ` · ${s.ageDays}일 경과` : ""}</dd></dl></a>`).join("") || `<div class="empty">선별 기준을 넘는 이슈가 아직 없습니다.</div>`}
  </div>`;
}

const ref = (ids) => `<span class="refs">${ids.map((id) => `<a href="#${id}" title="근거 ${id}">${id}</a>`).join("")}</span>`;
const assessCls = (a) => (/강화/.test(a) ? "strong" : /부분/.test(a) ? "part" : "");

// 차트 좌표계를 실제 폭에 맞춰 모바일에서도 글자가 작아지지 않게
const chartW = () => Math.max(340, Math.min(640, (document.getElementById("app")?.clientWidth || 640) - 32));
function chartWeight(s0, seen) {
  // 사후 재구성: 그 시점에 공개되지 않은 근거의 값은 지운다
  const s = { ...s0, points: s0.points.filter((p) => seen.has(p.evidence)).map((p) => (seen.has(p.evidence) ? p : { ...p, actual: null })) };
  if (!s.points.length) return `<div class="empty">이 시점에 공개된 비중 자료가 없습니다.</div>`;
  const W = chartW(), H = 230, L = 34, R = 34, T = 18, B = 34, max = 32;
  const x = (i) => L + (i + 0.5) * ((W - L - R) / s.points.length), y = (v) => T + (H - T - B) * (1 - v / max);
  const bw = Math.min(56, (W - L - R) / s.points.length * 0.5);
  let g = "";
  for (const t of [0, 10, 20, 30]) g += `<line class="axis" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text x="${L - 6}" y="${y(t) + 4}" font-size="11" text-anchor="end">${t}</text>`;
  s.points.forEach((p, i) => {
    if (p.actual != null) g += `<rect class="g-actual" x="${x(i) - bw / 2}" y="${y(p.actual)}" width="${bw}" height="${y(0) - y(p.actual)}"/><text x="${x(i)}" y="${y(p.actual) - 6}" font-size="12" font-weight="700" text-anchor="middle">${p.actual}</text>`;
    g += `<line class="g-target" x1="${x(i) - bw / 2 - 8}" x2="${x(i) + bw / 2 + 8}" y1="${y(p.target)}" y2="${y(p.target)}" stroke-width="2"/><text x="${x(i) + bw / 2 + 10}" y="${y(p.target) + 4}" font-size="11">${p.target}</text>`;
    g += `<text x="${x(i)}" y="${H - 12}" font-size="12" text-anchor="middle">${esc(p.date)}</text>`;
  });
  return `<figure><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(s.title)}: ${s.points.map((p) => `${p.date} 목표 ${p.target}%${p.actual != null ? ` 실제 ${p.actual}%` : ""}`).join(", ")}">${g}</svg>
    <figcaption>${esc(s.title)} · 단위 ${s.unit} · 막대 = 실제 비중, 점선 = 목표 비중 · 근거 ${s.points.map((p) => p.evidence).join("·")} · ${esc(s.note)}</figcaption></figure>`;
}
function chartFlows(s) {
  // 라벨 열(0–80) · 음수 영역(90–mid) · 양수 영역(mid–W). 값 글자는 막대 바깥 축 반대편에 둬 라벨과 겹치지 않게.
  const W = chartW(), rowH = 38, T = 8, H = T + s.bars.length * rowH + 6, mid = Math.round(W * 0.56), span = Math.round(W * 0.36), scale = span / Math.max(...s.bars.map((b) => Math.abs(b.value)));
  let g = `<line class="axis" x1="${mid}" x2="${mid}" y1="${T - 4}" y2="${H - 4}"/>`;
  s.bars.forEach((b, i) => {
    const yy = T + i * rowH, w = Math.abs(b.value) * scale, x0 = b.value < 0 ? mid - w : mid;
    g += `<text x="0" y="${yy + 21}" font-size="13" font-weight="700">${esc(b.label)}</text><rect class="${b.value < 0 ? "g-neg" : "g-pos"}" x="${x0}" y="${yy + 6}" width="${w}" height="20"/>`;
    g += `<text x="${b.value < 0 ? mid + 6 : x0 + w + 6}" y="${yy + 21}" font-size="12" class="mono">${won(b.value)}</text>`;
  });
  const r = flowResidual(s.bars);
  return `<figure><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(s.title)}: ${s.bars.map((b) => `${b.label} ${won(b.value)}억원`).join(", ")}">${g}</svg>
    <figcaption>${esc(s.title)} · 단위 ${s.unit} · 근거 ${s.evidence} · 세 범주 합계 ${won(r.sum)}억원(계산값) — ${esc(s.residualNote)}</figcaption></figure>`;
}

function evRow(e) {
  return `<div class="ev" id="${e.id}"><span class="id">${e.id}</span><div>
    <p><span class="tag ${e.kind}">${KIND_LABEL[e.kind]}</span> ${esc(e.claim)}</p>
    <div class="src">기준 <span class="mono">${e.valid_as_of}</span> · 발행 <span class="mono">${e.published_at}</span> · <a href="${esc(e.source_url)}" target="_blank" rel="noopener">${esc(e.publisher)}</a> · ${esc(e.verification_status)}${e.is_primary_source ? " · 1차 자료" : ""}${e.provenance_chain?.length ? ` · 경로: ${e.provenance_chain.map(esc).join(" → ")}` : ""}</div>
    ${e.note ? `<div class="note">${esc(e.note)}</div>` : ""}</div></div>`;
}

function renderDetail(doc, asOf) {
  const i = doc.issue, st = doc.stats || evidenceStats(doc);
  const rp = asOf ? replayView(doc, asOf) : null;
  const evs = rp ? rp.evidence : doc.evidence, seen = new Set(evs.map((e) => e.id));
  document.title = `${i.title} — 국정 한눈에`;
  const nav = [["A", "핵심 판단", "verdict"], ["B", "확정된 사실", "facts"], ["C", "작동 기전", "mech"], ["D", "시나리오", "scn"], ["E", "컨센서스", "cons"], ["F", "반대 가설", "hyp"], ["G", "판단 변경 지표", "watch"], ["H", "사후 검증", "verify"]];
  const scn = doc.scenarios.map((s) => `<article class="scn ${s.scenario_type}"><div class="type">${s.scenario_type}</div><h3>${esc(s.summary)}</h3>
    <h4>전제</h4><ul>${s.assumptions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
    <h4>전개</h4><ul>${s.causal_chain.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
    <h4>먼저 움직일 지표</h4><ul>${s.leading_indicators.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
    <h4>이 경로가 틀렸다는 신호</h4><ul>${s.invalidation_conditions.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
    <div class="grade">${esc(s.forecast_horizon)} · ${esc(s.confidence_grade)} · 근거 ${ref(s.supporting_evidence_ids)} 반대 ${ref(s.contradicting_evidence_ids)}</div></article>`).join("");

  $("#app").innerHTML = `
  <div class="wrap lede" id="verdict">
    <p class="kicker"><a href="./">오늘의 분기점</a> · 전망 인텔리전스</p>
    <h1>${esc(i.title)}</h1>
    <p class="meta">질문 — ${esc(i.question)}</p>
    <div class="replay"><label class="meta" for="asOf">시점</label><select id="asOf"><option value="">현재 분석 (${i.analyzedAt.slice(0, 10)})</option>${doc.replay.points.map((p) => `<option value="${p}" ${p === asOf ? "selected" : ""}>${p} 시점으로 재구성</option>`).join("")}</select>
      <span class="meta">분석 <span class="mono">${kst(i.analyzedAt)}</span> · 자료 ${st.total}건(독립 원천 ${st.independent}) · ${esc(i.modelVersion)}</span></div>
    ${rp ? `<div class="banner"><b>그때 알았다면 — ${rp.asOf}</b> · ${esc(rp.label)}. 이 시점 이후 공개된 자료 ${rp.hidden}건은 숨겼습니다. ${esc(doc.replay.note)}</div>` : `<div class="verdict"><small>A · 핵심 판단 (해석)</small>${esc(i.verdict)}</div>`}
    <ul class="toc">${nav.map(([k, t, id]) => `<li><a href="#${id}">${k} ${t}</a></li>`).join("")}</ul>
  </div>

  <section class="blk wrap" id="facts"><h2><i>B</i>확정된 사실 · 수급·주가 타임라인</h2>
    <div class="grid2"><div><ol class="tl">${(rp ? rp.timeline : doc.timeline).map((t) => `<li><time>${t.date}</time>${esc(t.label)} ${ref(t.evidence)}</li>`).join("")}</ol></div>
    <div>${chartWeight(doc.series.npsWeight, seen)}</div></div>
    ${seen.has(doc.series.flows1015.evidence) ? `<div style="margin-top:16px">${chartFlows(doc.series.flows1015)}</div>` : ""}
    <details style="margin-top:16px"><summary class="meta">근거 원장 ${evs.length}건 펼치기 — 각 주장의 원천·발행일·검증 상태</summary><div class="card" style="margin-top:8px">${evs.map(evRow).join("")}</div></details>
  </section>

  ${rp ? "" : `
  <section class="blk wrap" id="mech"><h2><i>C</i>작동 기전 · 정책 → 주체의 행동 → 시장</h2>
    <ol class="chain">${doc.mechanism.map((m) => `<li><b>${esc(m.step)}</b><div>${esc(m.text)} ${ref(m.evidence)}</div></li>`).join("")}</ol>
    <h3 style="margin-top:18px">반드시 구별할 것</h3>
    <table class="dist"><thead><tr><th>이것과</th><th>이것은 다르다</th><th>이 사례에서</th></tr></thead><tbody>${doc.distinctions.map((d) => `<tr><td>${esc(d[0])}</td><td>${esc(d[1])}</td><td>${esc(d[2])}</td></tr>`).join("")}</tbody></table>
  </section>

  <section class="blk wrap" id="scn"><h2><i>D</i>시나리오 · 확률 대신 조건</h2>
    <p class="meta">검증된 정량모형이 없어 퍼센트를 붙이지 않습니다(${esc(PROB_POLICY.C)}).</p><div class="scns">${scn}</div></section>

  <section class="blk wrap" id="cons"><h2><i>E</i>컨센서스 · 실제 기관 전망</h2>
    ${doc.consensus.institutional.length ? "" : `<div class="empty"><b>수집된 기관 컨센서스 없음.</b> ${esc(doc.consensus.emptyReason)}<br><span class="meta">수집 예정: ${doc.consensus.plannedSources.map(esc).join(" · ")}</span></div>`}
    <p class="meta" style="margin-top:10px">기관 전망·시장 내재 기대·이 서비스의 독립 시나리오는 서로 다른 층으로 분리해 보여 줍니다. 같은 보도자료를 재인용한 기사는 한 건으로 셉니다.</p></section>

  <section class="blk wrap" id="hyp"><h2><i>F</i>경쟁 가설 · 이 분석이 틀릴 수 있는 이유</h2>
    <div class="grid2">${doc.hypotheses.map((h) => `<article class="hyp"><header><h3>${h.id} · ${esc(h.title)}</h3><span class="assess ${assessCls(h.assessment)}">${esc(h.assessment)}</span></header>
      <p>${esc(h.claim)}</p><p>${esc(h.reason)}</p><div class="sc">지지 ${ref(h.support)} · 반박 ${h.contra.length ? ref(h.contra) : "없음"}</div></article>`).join("")}</div>
    <h3 style="margin-top:18px">주목할 위험</h3><ul class="watch">${doc.risks.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></section>

  <section class="blk wrap" id="watch"><h2><i>G</i>판단 변경 지표 · 무엇이 보이면 생각을 바꿔야 하나</h2>
    <ul class="watch">${doc.changeConditions.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></section>`}

  <section class="blk wrap" id="verify"><h2><i>H</i>사후 검증 · 예측 원장</h2>
    ${doc.forecasts.map((f) => `<div class="card"><p style="margin:0 0 6px"><b>${esc(f.question)}</b></p>
      <div class="meta">등록 <span class="mono">${f.created_at}</span> · 판정 ${esc(f.resolution_date)} · 출처 ${esc(f.resolution_source)} · 상태 ${esc(f.evaluation_status)}</div>
      <div class="meta">출력 정책 ${f.policy} — ${esc(PROB_POLICY[f.policy])}. ${esc(f.note || "")}</div></div>`).join("")}
    <div class="empty" style="margin-top:12px">판정 완료 예측 <b>0건</b> — 정확도를 주장할 표본이 없습니다. 기한이 지나면 실제 결과와 함께 이 자리에 기록하고, 수정은 새 버전으로 남깁니다.</div>
  </section>
  <div class="wrap foot">자료는 링크와 요지만 인용합니다. 언론 보도 수치는 한국거래소·기금운용본부 원자료로 대조 예정이며, 대조 전에는 '보도 확인' 상태로 표시합니다. 이 화면은 투자 권유가 아닙니다.</div>`;

  $("#asOf").onchange = (e) => { const v = e.target.value; const u = new URL(location); v ? u.searchParams.set("asOf", v) : u.searchParams.delete("asOf"); location.href = u; };
  if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

(async () => {
  const q = new URLSearchParams(location.search), id = q.get("id"), asOf = q.get("asOf");
  try {
    if (!id) renderList((await loadAll()).list);
    else renderDetail(await loadOne(id), asOf && /^\d{4}-\d{2}-\d{2}$/.test(asOf) ? asOf : null);
  } catch (e) {
    $("#app").innerHTML = `<div class="wrap forks"><div class="empty"><b>분석을 불러오지 못했습니다.</b> ${esc(e.message)} — 마지막으로 검증된 분석은 <a href="./">목록</a>에서 다시 시도하세요.</div></div>`;
  }
})();
