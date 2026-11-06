// 국정 한눈에 · 공직자 재산 동향 화면 — 지도 · 공개 시점 재생 · 지역 순위 · 두 시점 비교 · 대수 변화 분해
// 지도는 운영 '세계 권력 지형'과 같은 MapLibre GL 판을 필요할 때만 불러온다. 나머지는 의존성 0.
// 원칙: 화면의 모든 수치는 officials/data 의 공개 원문 정규화 결과에서만 나온다. 자료가 없으면 비워 두고 그 사실을 말한다.
import { feature, bbox, labelPoint } from "./lib/topo.mjs";
import * as X from "./lib/engine.mjs";
import { SIDO_SHORT, CAPITAL, regionName, sidoOf } from "./lib/regions.mjs";
import { tweenNumber, parseNum, flipList, still, T as MT } from "/motion/motion.js?v=1";

const LIB = "https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl";
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const mobile = matchMedia("(max-width: 760px), (max-height: 520px) and (orientation: landscape) and (max-width: 1000px)");
const Q = new URLSearchParams(location.search);
const FIXTURE = Q.get("fixture") === "synthetic";
const BASE = FIXTURE ? "/test/fixtures/officials-synthetic/" : "data/";
const CLS = ["own"]; // 지도·순위는 소유 부동산(토지·건물). 임차권·분양권은 인물 상세에서 따로 보인다.
const dfmt = (d) => (d ? `${Number(d.slice(0, 4))}.${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}` : "—");
const pct = (x, d = 1) => (x == null ? "—" : `${(x * 100).toFixed(d)}%`);

let D = null, MAP = null;
const S = { term: 22, si: -1, party: "", metric: "value", level: "sido", region: null, official: null, cmpA: null, cmpB: null, cmpMode: "side", cmpSame: false, decA: null, decB: null, decField: "net", playing: false, speed: 1 };

/* ── 자료 ── */
async function loadData() {
  const get = (n) => fetch(`${BASE}${n}.json`, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const [manifest, officials, holdings, totals] = await Promise.all(["manifest", "officials", "holdings", "totals"].map(get));
  if (!manifest) throw new Error("자료 목록(manifest)을 불러오지 못했습니다");
  const d = { manifest, officials: officials || [], holdings: holdings || { rows: [] }, totals: totals || { rows: [] } };
  const errs = X.validate(d);
  if (errs.length) { console.error("자료 검증 실패", errs.slice(0, 20)); throw new Error(`자료 검증에 실패해 싣지 않았습니다(${errs.length}건). ${errs[0]}`); }
  d.byId = new Map(d.officials.map((o, i) => [o.id, i]));
  return d;
}
const snaps = () => D.manifest.snapshots;
const termSnaps = (term = S.term) => snaps().map((s, i) => [s, i]).filter(([s]) => s.term === Number(term)).map(([, i]) => i);
const prevSi = (si) => { const list = termSnaps(snaps()[si]?.term); const k = list.indexOf(si); return k > 0 ? list[k - 1] : null; };
const hasData = () => snaps().length > 0 && D.totals.rows.length > 0;

/* ── 주소 상태 ── */
function readURL() {
  if (Q.get("term")) S.term = Number(Q.get("term"));
  const t = Q.get("t"), si = snaps().findIndex((s) => s.id === t);
  S.si = si >= 0 ? si : -1;
  S.party = Q.get("party") || "";
  S.metric = ["value", "count", "holders", "delta"].includes(Q.get("m")) ? Q.get("m") : "value";
  S.level = Q.get("lv") === "sigungu" ? "sigungu" : "sido";
  S.region = Q.get("r") || null;
  S.official = Q.get("p") && D.byId.has(Q.get("p")) ? D.byId.get(Q.get("p")) : null;
}
function fixSnapshot() {
  const list = termSnaps();
  if (!list.includes(S.si)) S.si = list.length ? list[list.length - 1] : -1;
}
function writeURL() {
  const p = new URLSearchParams();
  if (FIXTURE) p.set("fixture", "synthetic");
  p.set("term", S.term);
  if (S.si >= 0) p.set("t", snaps()[S.si].id);
  if (S.party) p.set("party", S.party);
  if (S.metric !== "value") p.set("m", S.metric);
  if (S.level !== "sido") p.set("lv", S.level);
  if (S.region) p.set("r", S.region);
  if (S.official != null) p.set("p", D.officials[S.official].id);
  history.replaceState(null, "", `${location.pathname}?${p}`);
}

/* ── 계산 ── */
function current() {
  const c = X.cohort(D, { snapshot: S.si, term: S.term, party: S.party || null });
  const agg = X.regionAgg(D, { si: c.si, ids: c.ids, classes: CLS, level: S.level });
  const ps = c.si >= 0 ? prevSi(c.si) : null;
  const prev = ps != null ? X.regionAgg(D, { si: ps, ids: X.cohort(D, { snapshot: ps, term: S.term, party: S.party || null }).ids, classes: CLS, level: S.level }) : null;
  return { c, agg, prev, ps };
}
// 인물 한 사람의 지역별 신고(이 시점)
function personAgg(oi, si, level = S.level) {
  return X.regionAgg(D, { si, ids: new Set([oi]), classes: CLS, level });
}

/* ── 색 ── */
let PAL = null;
function palette() {
  const cs = getComputedStyle(document.body);
  const v = (n) => cs.getPropertyValue(n).trim();
  PAL = { nodata: v("--of-nodata"), zero: v("--of-zero"), seq: [1, 2, 3, 4, 5, 6].map((i) => v(`--of-s${i}`)), up: v("--of-up"), up2: v("--of-up2"), mid: v("--of-mid"), dn2: v("--of-dn2"), dn: v("--of-dn"), dim: "#141e18" };
}
function seqColors(agg, metric, codes, br) {
  const out = {};
  for (const code of codes) {
    const x = agg?.regions.get(code);
    const val = agg ? (x ? x[metric] : 0) : null;
    const k = X.classOf(val, br);
    out[code] = k < 0 ? PAL.nodata : k === 0 ? PAL.zero : PAL.seq[Math.min(k, br.length + 1) - 1] || PAL.seq[5];
  }
  return out;
}
function deltaColors(d, codes, t) {
  const out = {};
  for (const code of codes) {
    const x = d?.get(code);
    if (!d) { out[code] = PAL.nodata; continue; }
    if (!x || x.state === "same") { out[code] = PAL.mid; continue; }
    const strong = Math.abs(x.d) >= t;
    out[code] = x.state === "up" ? (strong ? PAL.up : PAL.up2) : (strong ? PAL.dn : PAL.dn2);
  }
  return out;
}
const deltaThreshold = (d) => { const v = [...d.values()].map((x) => Math.abs(x.d)).filter((x) => x > 0).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : 1; };
function legendHTML({ kind, br = [], metric = "value", title }) {
  const unit = X.METRICS[metric]?.unit;
  const fmt = (v) => (unit === "원" ? X.won(v, { short: true }) : `${v.toLocaleString("ko-KR")}${unit}`);
  if (kind === "delta") return `<b>${esc(title)}</b><div class="of-ramp"><span style="background:${PAL.dn}"></span><span style="background:${PAL.dn2}"></span><span style="background:${PAL.mid}"></span><span style="background:${PAL.up2}"></span><span style="background:${PAL.up}"></span></div>
    <div class="of-ticks"><span>감소</span><span>변동 없음</span><span>증가</span></div><div class="of-keys"><span><i class="nodata"></i>비교 불가</span></div>`;
  if (kind === "empty") return `<b>${esc(title)}</b><div class="of-keys"><span><i class="nodata"></i>자료 없음 — 공개 원문 수집 전</span></div>`;
  const classes = br.length + 1;
  return `<b>${esc(title)}</b><div class="of-ramp">${PAL.seq.slice(0, classes).map((c) => `<span style="background:${c}"></span>`).join("")}</div>
    <div class="of-ticks"><span>${br.length ? `${fmt(br[0])} 미만` : ""}</span>${br.length > 2 ? `<span>${fmt(br[Math.floor(br.length / 2)])}</span>` : ""}<span>${br.length ? `${fmt(br.at(-1))} 이상` : ""}</span></div>
    <div class="of-keys"><span><i class="zero"></i>보유 신고 없음</span><span><i class="nodata"></i>자료 없음</span></div>`;
}

/* ── 지도: 시도·시군구 두 층, 색은 두 판을 겹쳐 교차로 바꾼다(데이터 기반 색은 보간이 안 되므로) ── */
let mapLibPromise = null;
function loadMapLib() {
  if (window.maplibregl) return Promise.resolve(window.maplibregl);
  if (!document.querySelector(`link[href="${LIB}.css"]`)) document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: `${LIB}.css` }));
  return (mapLibPromise ??= new Promise((res, rej) => {
    const s = Object.assign(document.createElement("script"), { src: `${LIB}.js`, async: true, crossOrigin: "anonymous" });
    s.onload = () => res(window.maplibregl); s.onerror = () => rej(new Error("지도 엔진을 불러오지 못했습니다"));
    document.head.append(s);
  }));
}
let GEO = null;
async function geo() {
  if (GEO) return GEO;
  const topo = await fetch("geo/korea.topo.json").then((r) => r.json());
  const sido = feature(topo, "sido"), sgg = feature(topo, "sigungu");
  for (const f of sido.features) f.properties.code = f.properties.sido;
  const boxes = new Map([...sido.features, ...sgg.features].map((f) => [f.properties.code, bbox(f)]));
  // 여러 조각으로 나뉜 지역은 상자를 합친다
  const merge = (fc) => { const m = new Map(); for (const f of fc.features) { const b = bbox(f), o = m.get(f.properties.code); m.set(f.properties.code, o ? [Math.min(o[0], b[0]), Math.min(o[1], b[1]), Math.max(o[2], b[2]), Math.max(o[3], b[3])] : b); } return m; };
  for (const [k, v] of [...merge(sido), ...merge(sgg)]) boxes.set(k, v);
  GEO = { sido, sgg, boxes, codes: { sido: [...new Set(sido.features.map((f) => f.properties.code))], sigungu: [...new Set(sgg.features.map((f) => f.properties.code))] },
    labels: sido.features.map((f) => ({ code: f.properties.code, at: labelPoint(f) })) };
  return GEO;
}
const KR = [[124.55, 33.05], [131.95, 38.65]];

async function createMap(el, { onHover, onClick, onZoomLevel, labels = true, interactive = true } = {}) {
  const ml = await loadMapLib(), g = await geo();
  const map = new ml.Map({
    container: el, attributionControl: false, interactive, dragRotate: false, pitchWithRotate: false, touchPitch: false, renderWorldCopies: false,
    style: { version: 8, sources: {}, layers: [{ id: "bg", type: "background", paint: { "background-color": getComputedStyle(document.body).getPropertyValue("--of-bg").trim() || "#0d1511" } }] },
    bounds: KR, fitBoundsOptions: { padding: 24 }, maxBounds: [[118, 30], [138, 41.5]], minZoom: 4.5, maxZoom: 11,
  });
  map.touchZoomRotate?.disableRotation();
  await new Promise((r) => map.once("load", r));
  const dur = () => (still() ? 0 : MT.map);
  const lv = { sido: "sido", sigungu: "sgg" };
  map.addSource("sido", { type: "geojson", data: g.sido, promoteId: "code" });
  map.addSource("sgg", { type: "geojson", data: g.sgg, promoteId: "code" });
  for (const [level, src] of Object.entries(lv)) {
    for (const slot of ["a", "b"]) map.addLayer({ id: `${src}-${slot}`, type: "fill", source: src, layout: { visibility: level === "sido" ? "visible" : "none" },
      paint: { "fill-color": ["to-color", ["coalesce", ["feature-state", slot], "#101813"]], "fill-opacity": slot === "a" ? 1 : 0, "fill-opacity-transition": { duration: dur(), delay: 0 }, "fill-antialias": true } });
    map.addLayer({ id: `${src}-line`, type: "line", source: src, layout: { visibility: level === "sido" ? "visible" : "none" },
      paint: { "line-color": ["case", ["boolean", ["feature-state", "sel"], false], "#d2b673", ["boolean", ["feature-state", "hover"], false], "#ebe5d4", level === "sido" ? "#33463a" : "#24352b"],
        "line-width": ["case", ["boolean", ["feature-state", "sel"], false], 2.2, ["boolean", ["feature-state", "hover"], false], 1.4, level === "sido" ? 0.9 : 0.45] } });
  }
  map.addLayer({ id: "sido-edge", type: "line", source: "sido", layout: { visibility: "none" },
    paint: { "line-color": ["case", ["boolean", ["feature-state", "sel"], false], "#d2b673", "#3d5446"], "line-width": ["case", ["boolean", ["feature-state", "sel"], false], 2.4, 1.1] } });
  let level = "sido", slot = "a", hoverId = null, selId = null;
  const markers = [];
  if (labels) for (const l of g.labels) {
    if (!l.at) continue;
    const e = Object.assign(document.createElement("span"), { className: "of-lab", textContent: SIDO_SHORT[l.code] });
    markers.push(new ml.Marker({ element: e, anchor: "center" }).setLngLat(l.at).addTo(map));
  }
  el.classList.add("of-labels");
  const api = {
    map,
    get level() { return level; },
    setLevel(next) {
      if (next === level) return;
      level = next;
      for (const [L, src] of Object.entries(lv)) for (const id of [`${src}-a`, `${src}-b`, `${src}-line`]) map.setLayoutProperty(id, "visibility", L === level ? "visible" : "none");
      map.setLayoutProperty("sido-edge", "visibility", level === "sigungu" ? "visible" : "none");
      for (const m of markers) m.getElement().style.opacity = level === "sido" ? "" : ".45";
      hoverId = null;
    },
    // colors: { code: '#hex' } — 비어 있는 판에 새 색을 쓰고, 두 판의 불투명도를 맞바꾼다
    paint(colors, levelFor = level) {
      const src = lv[levelFor], next = slot === "a" ? "b" : "a";
      for (const [code, c] of Object.entries(colors)) map.setFeatureState({ source: src, id: code }, { [next]: c });
      const d = dur();
      for (const id of [`${src}-a`, `${src}-b`]) map.setPaintProperty(id, "fill-opacity-transition", { duration: d, delay: 0 });
      map.setPaintProperty(`${src}-${next}`, "fill-opacity", 1);
      map.setPaintProperty(`${src}-${slot}`, "fill-opacity", 0);
      // 다른 층도 같은 판을 쓰게 맞춘다(층을 바꿔도 옛 색이 비치지 않게)
      const other = levelFor === "sido" ? "sgg" : "sido";
      map.setPaintProperty(`${other}-${next}`, "fill-opacity", 1); map.setPaintProperty(`${other}-${slot}`, "fill-opacity", 0);
      slot = next;
    },
    select(code) {
      if (selId) map.setFeatureState({ source: selId.length === 2 ? "sido" : "sgg", id: selId }, { sel: false });
      selId = code;
      if (code) map.setFeatureState({ source: code.length === 2 ? "sido" : "sgg", id: code }, { sel: true });
    },
    fit(codes) {
      const list = (Array.isArray(codes) ? codes : [codes]).filter((c) => c && g.boxes.has(c));
      const b = list.reduce((a, c) => { const x = g.boxes.get(c); return a ? [Math.min(a[0], x[0]), Math.min(a[1], x[1]), Math.max(a[2], x[2]), Math.max(a[3], x[3])] : [...x]; }, null);
      const fine = list.length === 1 && list[0].length === 5;
      map.fitBounds(b ? [[b[0], b[1]], [b[2], b[3]]] : KR, { padding: b ? { top: 64, bottom: 64, left: 64, right: 64 } : 24, duration: dur(), maxZoom: fine ? 9.6 : list.length > 1 ? 8.6 : 8.4, essential: true });
    },
  };
  const layerIds = () => [`${lv[level]}-a`];
  map.on("mousemove", (e) => {
    const f = map.queryRenderedFeatures(e.point, { layers: layerIds() })[0];
    const id = f?.properties.code || null, src = lv[level];
    if (id !== hoverId) {
      if (hoverId) map.setFeatureState({ source: src, id: hoverId }, { hover: false });
      if (id) map.setFeatureState({ source: src, id }, { hover: true });
      hoverId = id;
    }
    map.getCanvas().style.cursor = id ? "pointer" : "";
    onHover?.(id, e.point);
  });
  map.on("mouseout", () => { if (hoverId) map.setFeatureState({ source: lv[level], id: hoverId }, { hover: false }); hoverId = null; onHover?.(null); });
  map.on("click", (e) => { const f = map.queryRenderedFeatures(e.point, { layers: layerIds() })[0]; onClick?.(f?.properties.code || null); });
  map.on("zoomend", (e) => { if (!e.originalEvent) return; const z = map.getZoom(); if (z >= 7.3 && level === "sido") onZoomLevel?.("sigungu"); else if (z < 6.5 && level === "sigungu") onZoomLevel?.("sido"); });
  return api;
}

/* ── 화면 그리기 ── */
let lastPanelKey = "", tlTimer = 0;
const prevNums = new Map();
// data-k 가 붙은 숫자는 이전 값에서 옮겨 간다(단위가 같을 때만)
function settleNumbers(root) {
  root.querySelectorAll("[data-k]").forEach((el) => {
    const k = el.dataset.k, text = el.textContent, p = parseNum(text), was = prevNums.get(k);
    prevNums.set(k, { text, v: p?.v });
    const node = [...el.childNodes].find((n) => n.nodeType === 3 && parseNum(n.data));
    if (!node || !was || was.v == null) return;
    const unitNow = text.replace(/[−\-\d.,\s]/g, ""), unitWas = was.text.replace(/[−\-\d.,\s]/g, "");
    if (unitNow === unitWas && was.v !== p.v) tweenNumber(node, node.data, was.v);
  });
}

function renderControls() {
  const terms = Object.entries(X.TERMS).filter(([t]) => D.officials.some((o) => o.terms?.includes(Number(t))) || termSnaps(t).length);
  $("#ofTerm").innerHTML = terms.map(([t, x]) => `<button type="button" role="radio" data-term="${t}" aria-checked="${Number(t) === S.term}" title="${x.from.slice(0, 4)}~${x.to ? x.to.slice(0, 4) : "현재"}">${x.label}</button>`).join("");
  const metrics = [["value", "가액"], ["count", "항목"], ["holders", "보유자"], ["delta", "증감"]];
  $("#ofMetric").innerHTML = metrics.map(([k, l]) => `<button type="button" role="radio" data-metric="${k}" aria-checked="${S.metric === k}" ${!hasData() ? "disabled" : ""}>${l}</button>`).join("");
  const ps = S.si >= 0 ? X.parties(D, S.si) : [];
  $("#ofParty").innerHTML = `<option value="">전체</option>${ps.map(([p, n]) => `<option value="${esc(p)}" ${p === S.party ? "selected" : ""}>${esc(p)} (${n})</option>`).join("")}`;
  $("#ofParty").disabled = !ps.length;
}

function renderBasis(cur) {
  const m = D.manifest, s = snaps()[S.si];
  const roster = D.officials.filter((o) => o.terms?.includes(S.term)).length;
  const parts = [];
  if (m.synthetic) parts.push('<span class="warn">합성 시험 자료 — 실제 인물·금액이 아닙니다</span>');
  if (s) {
    parts.push(`공개 <b>${dfmt(s.published)}</b> · 신고 기준 <b>${dfmt(s.basis)}</b> · ${esc(s.kind)}`);
    parts.push(`이 시점 공개 <b>${cur.c.ids.size}</b>명${roster ? ` / 명부 ${roster}명` : ""}`);
    parts.push(`출처 ${s.source?.url ? `<a href="${esc(s.source.url)}" target="_blank" rel="noopener">${esc(s.source.title)}</a>` : esc(s.source?.title || "—")}`);
  } else {
    parts.push(`<span class="warn">공개 원문 수집 전</span>`);
    if (roster) parts.push(`${X.TERMS[S.term].label} 명부 <b>${roster}</b>명 확보(위키데이터)`);
  }
  $("#ofBasis").innerHTML = parts.map((x) => `<span>${x}</span>`).join("");
  $("#ofSynthetic").hidden = !m.synthetic;
}

function mapTitle() {
  if (S.official != null) return `${D.officials[S.official].name} · 지역별 신고가액`;
  if (S.metric === "delta") return "직전 공개 대비 신고가액 증감";
  return `${X.METRICS[S.metric].label} · ${S.level === "sido" ? "시도" : "시군구"}`;
}

function paintMain(cur) {
  if (!MAP) return;
  const codes = GEO.codes[S.level];
  let colors, legend;
  if (!hasData() || S.si < 0) { colors = Object.fromEntries(codes.map((c) => [c, PAL.nodata])); legend = legendHTML({ kind: "empty", title: "부동산 신고가액" }); }
  else if (S.official != null) {
    const pa = personAgg(S.official, S.si);
    const br = X.breaks([...pa.regions.values()].map((x) => x.value), 4);
    colors = seqColors(pa, "value", codes, br);
    for (const c of codes) if (!pa.regions.has(c)) colors[c] = PAL.dim; // 신고 지역만 남기고 나머지는 낮춘다
    legend = legendHTML({ kind: "seq", br, metric: "value", title: mapTitle() });
  } else if (S.metric === "delta") {
    const d = cur.prev ? X.diff(cur.prev, cur.agg, "value") : null;
    colors = deltaColors(d, codes, d ? deltaThreshold(d) : 1);
    legend = legendHTML({ kind: "delta", title: cur.prev ? `${dfmt(snaps()[cur.ps].published)} → ${dfmt(snaps()[S.si].published)} 증감` : "직전 공개 없음 — 비교 불가" });
  } else {
    const br = X.breaks([...cur.agg.regions.values()].map((x) => x[S.metric]), 6);
    colors = seqColors(cur.agg, S.metric, codes, br);
    legend = legendHTML({ kind: "seq", br, metric: S.metric, title: mapTitle() });
  }
  MAP.setLevel(S.level);
  MAP.paint(colors, S.level);
  MAP.select(S.region);
  $("#ofLegend").innerHTML = legend;
  $("#ofLevel").setAttribute("aria-pressed", S.level === "sigungu");
  $("#ofLevel").textContent = S.level === "sigungu" ? "시도" : "시군구";
  const crumb = [`<button type="button" data-crumb="nation">전국</button>`];
  if (S.region) crumb.push(`<b>${esc(regionName(S.region))}</b>`);
  if (S.official != null) crumb.push(`<b>${esc(D.officials[S.official].name)}</b>`);
  $("#ofCrumb").innerHTML = crumb.join('<span aria-hidden="true">›</span>');
}

// 패널: 전국 → 지역 → 인물
function renderPanel(cur) {
  const box = $("#ofPanelIn");
  const key = S.official != null ? `p${S.official}` : S.region ? `r${S.region}` : "n";
  let html;
  if (!hasData() || S.si < 0) html = statusPanel();
  else if (S.official != null) html = personPanel(S.official);
  else if (S.region) html = regionPanel(cur, S.region);
  else html = nationPanel(cur);
  const prevW = key === lastPanelKey ? [...box.querySelectorAll("[data-w]")].map((i) => i.style.transform) : [];
  box.innerHTML = key !== lastPanelKey ? `<div class="of-pv">${html}</div>` : `<div>${html}</div>`;
  box.querySelectorAll("[data-w]").forEach((i, n) => { if (prevW[n]) i.style.transform = prevW[n]; });
  if (key !== lastPanelKey) { prevNums.clear(); box.scrollTop = 0; }
  lastPanelKey = key;
  settleNumbers(box);
  requestAnimationFrame(() => box.querySelectorAll("[data-w]").forEach((i) => { i.style.transform = `scaleX(${i.dataset.w})`; }));
}
const big = (k, label, value, { unit = "", cls = "", wide = false } = {}) => `<div class="${wide ? "wide" : ""}"><dt>${label}</dt><dd class="${cls}" data-k="${k}">${value}${unit ? `<small>${unit}</small>` : ""}</dd></div>`;
const short = (v) => X.won(v, { short: true });

function nationPanel(cur) {
  const s = snaps()[S.si], cc = X.concentration(D, { si: S.si, ids: cur.c.ids, classes: CLS });
  const total = [...cur.agg.regions.values()].reduce((a, x) => a + x.value, 0) + cur.agg.unplaced.value;
  const prevTotal = cur.prev ? [...cur.prev.regions.values()].reduce((a, x) => a + x.value, 0) + cur.prev.unplaced.value : null;
  const top = X.rank(cur.agg, "value", 6), max = top[0]?.value || 1;
  const sh = cc.share;
  return `<p class="of-pk">전국${S.party ? ` · ${esc(S.party)}` : ""}</p><h3 class="of-pt">${X.TERMS[S.term].label} 국회의원 소유 부동산</h3>
    <p class="of-pm">${dfmt(s.published)} 공개 · 신고 기준 ${dfmt(s.basis)} · 신고가액(시가 아님)</p>
    <dl class="of-big">${big("n-total", "신고가액 합계", short(total), { wide: true })}
      ${big("n-holders", "보유 신고자", cc.holders, { unit: `/ ${cc.n}명` })}${big("n-med", "1인당 중앙값", short(cc.median))}
      ${prevTotal != null ? big("n-d", "직전 공개 대비", `${total - prevTotal >= 0 ? "+" : "−"}${short(Math.abs(total - prevTotal))}`, { cls: total >= prevTotal ? "of-up" : "of-dn", wide: true }) : ""}</dl>
    ${sh ? `<h4 class="of-h4">소재지 비중<span>지역 미확인 ${pct(sh.unplaced)}</span></h4>
      <div class="of-share"><i style="flex:${sh.seoul};background:${PAL.seq[5]}"></i><i style="flex:${sh.capital - sh.seoul};background:${PAL.seq[3]}"></i><i style="flex:${sh.nonCapital};background:${PAL.seq[1]}"></i><i style="flex:${sh.unplaced};background:${PAL.zero}"></i></div>
      <div class="of-share-k"><span><i style="background:${PAL.seq[5]}"></i>서울 ${pct(sh.seoul)}</span><span><i style="background:${PAL.seq[3]}"></i>인천·경기 ${pct(sh.capital - sh.seoul)}</span><span><i style="background:${PAL.seq[1]}"></i>비수도권 ${pct(sh.nonCapital)}</span></div>` : ""}
    <h4 class="of-h4">신고가액이 큰 지역<span>${S.level === "sido" ? "시도" : "시군구"}</span></h4>
    <ul class="of-rows">${top.map((r) => `<li><button type="button" data-region="${r.code}"><span class="n">${esc(regionName(r.code, { short: true }))}<small>${r.holders}명 · ${r.count}건</small></span><span class="v">${short(r.value)}</span><span class="b"><i data-w="${(r.value / max).toFixed(4)}" style="transform:scaleX(0)"></i></span></button></li>`).join("")}</ul>
    <p class="of-note">지역을 누르면 그 지역의 신고자와 금액이, 의원 이름을 찾으면 그 사람의 신고 지역이 지도에 남습니다.</p>`;
}

function regionPanel(cur, code) {
  const level = code.length === 2 ? "sido" : "sigungu";
  const agg = level === S.level ? cur.agg : X.regionAgg(D, { si: S.si, ids: cur.c.ids, classes: CLS, level });
  const r = agg.regions.get(code) || { value: 0, count: 0, holders: 0 };
  const total = [...agg.regions.values()].reduce((a, y) => a + y.value, 0) + agg.unplaced.value;
  const pr = cur.prev ? (level === S.level ? cur.prev : X.regionAgg(D, { si: cur.ps, ids: X.cohort(D, { snapshot: cur.ps, term: S.term }).ids, classes: CLS, level })).regions.get(code) : null;
  // 이 지역에 신고한 사람들(이 지역 몫 기준)
  const people = [...cur.c.ids].map((oi) => ({ oi, v: D.holdings.rows.filter((h) => h[0] === S.si && h[1] === oi && CLS.includes(h[3]) && (h[2] === code || (level === "sido" && h[2].length === 5 && sidoOf(h[2]) === code) || (level === "sido" && h[2] === code))).reduce((a, h) => a + h[4], 0) }))
    .filter((p) => p.v > 0).sort((a, b) => b.v - a.v);
  const max = people[0]?.v || 1;
  return `<button type="button" class="of-back" data-crumb="nation">‹ 전국</button><p class="of-pk">${level === "sido" ? "시도" : "시군구"}</p>
    <h3 class="of-pt">${esc(regionName(code))}</h3><p class="of-pm">${dfmt(snaps()[S.si].published)} 공개 · ${X.TERMS[S.term].label}${S.party ? ` · ${esc(S.party)}` : ""}</p>
    <dl class="of-big">${big("r-v", "신고가액 합계", short(r.value), { wide: true })}${big("r-s", "전국 대비", pct(total ? r.value / total : null))}${big("r-h", "보유 신고자", r.holders, { unit: "명" })}
      ${pr ? big("r-d", "직전 공개 대비", `${r.value - pr.value >= 0 ? "+" : "−"}${short(Math.abs(r.value - pr.value))}`, { cls: r.value >= pr.value ? "of-up" : "of-dn", wide: true }) : ""}</dl>
    <h4 class="of-h4">이 지역에 신고한 의원<span>${people.length}명 · 이 지역 몫</span></h4>
    <ul class="of-rows">${people.slice(0, 30).map((p) => { const o = D.officials[p.oi]; return `<li><button type="button" data-official="${p.oi}"><span class="n">${esc(o.name)}<small>${esc(X.partyAt(o, snaps()[S.si].basis) || "정당 확인 안 됨")}</small></span><span class="v">${short(p.v)}</span><span class="b"><i data-w="${(p.v / max).toFixed(4)}" style="transform:scaleX(0)"></i></span></button></li>`; }).join("")}</ul>
    ${people.length > 30 ? `<p class="of-note">상위 30명만 보입니다. 전체는 아래 표에서 확인하세요.</p>` : ""}`;
}

function personPanel(oi) {
  const o = D.officials[oi], series = X.personSeries(D, oi), now = series[S.si];
  const t = now?.t;
  const avail = series.filter((x) => x.t);
  const spark = sparkSVG(avail);
  if (!t) return `<button type="button" class="of-back" data-crumb="nation">‹ 전국</button><p class="of-pk">국회의원</p><h3 class="of-pt">${esc(o.name)}</h3>
    <div class="of-status">이 시점(${dfmt(snaps()[S.si].published)} 공개)에는 이 의원의 신고가 실려 있지 않습니다.${avail.length ? ` 공개 자료가 있는 시점: ${avail.map((x) => dfmt(x.snap.published)).join(", ")}` : ""}</div>`;
  const comp = [["부동산", t.realEstate], ["예금", t.deposits], ["증권", t.securities], ["그 밖의 자산", t.other], ["채무", t.debts]];
  const cmax = Math.max(1, ...comp.map((c) => c[1] || 0));
  const prevT = (() => { const ps = prevSi(S.si); return ps != null ? series[ps]?.t : null; })();
  const regs = now.regions, rmax = regs[0]?.value || 1;
  const src = snaps()[S.si].source;
  return `<button type="button" class="of-back" data-crumb="${S.region ? "region" : "nation"}">‹ ${S.region ? esc(regionName(S.region, { short: true })) : "전국"}</button>
    <p class="of-pk">국회의원 · ${(o.terms || []).map((x) => X.TERMS[x]?.label || `${x}대`).join("·")}</p><h3 class="of-pt">${esc(o.name)}</h3>
    <p class="of-pm">${esc(now.party || "정당 확인 안 됨")} (신고 기준일 소속) · ${dfmt(snaps()[S.si].published)} 공개</p>
    <dl class="of-big">${big("p-net", "재산 총액", short(t.net), { wide: true })}${big("p-a", "자산", short(t.assets))}${big("p-d", "채무", short(t.debts))}
      ${prevT ? big("p-dd", "직전 공개 대비", `${t.net - prevT.net >= 0 ? "+" : "−"}${short(Math.abs(t.net - prevT.net))}`, { cls: t.net >= prevT.net ? "of-up" : "of-dn", wide: true }) : ""}</dl>
    <h4 class="of-h4">자산 구성<span>채무는 차감 전</span></h4>
    <div class="of-comp">${comp.map(([k, v]) => `<div><span>${k}</span><span class="cbar"><i class="${k === "채무" ? "debt" : ""}" data-w="${((v || 0) / cmax).toFixed(4)}" style="transform:scaleX(0)"></i></span><span class="v">${short(v || 0)}</span></div>`).join("")}</div>
    <h4 class="of-h4">공개 시점별 재산 총액<span>실선 총액 · 점선 부동산</span></h4>${spark}
    <h4 class="of-h4">부동산 신고 지역<span>${regs.length}곳</span></h4>
    <ul class="of-rows">${regs.map((r) => `<li><button type="button" data-region="${r.code.length >= 2 && r.code !== "X" && r.code !== "F" ? r.code : ""}"><span class="n">${esc(regionName(r.code, { short: true }))}<small>${esc(X.CLASSES[r.cls])} · ${r.count}건</small></span><span class="v">${short(r.value)}</span><span class="b"><i data-w="${(r.value / rmax).toFixed(4)}" style="transform:scaleX(0)"></i></span></button></li>`).join("")}</ul>
    ${t.refused ? `<p class="of-note">고지거부·등록제외 ${t.refused}건 — 금액을 알 수 없어 0원으로 세지 않고 따로 표시합니다.</p>` : ""}
    <div class="of-src">${src?.url ? `<a href="${esc(src.url)}" target="_blank" rel="noopener">공개 원문 ↗</a>` : ""}</div>`;
}

function sparkSVG(avail) {
  if (avail.length < 2) return `<p class="of-note">공개 시점이 하나뿐이라 추이를 그리지 않습니다.</p>`;
  const W = 300, H = 86, L = 6, R = 6, T = 10, B = 18;
  const vals = avail.flatMap((x) => [x.t.net, x.t.realEstate]), lo = Math.min(0, ...vals), hi = Math.max(...vals) || 1;
  const xs = (i) => L + (i / (avail.length - 1)) * (W - L - R), ys = (v) => T + (H - T - B) * (1 - (v - lo) / (hi - lo || 1));
  const line = (f) => avail.map((x, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)} ${ys(f(x)).toFixed(1)}`).join("");
  return `<svg class="of-spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="공개 시점별 재산 총액: ${avail.map((x) => `${dfmt(x.snap.published)} ${short(x.t.net)}`).join(", ")}">
    <path class="ln2" d="${line((x) => x.t.realEstate)}"/><path class="ln" d="${line((x) => x.t.net)}"/>
    ${avail.map((x, i) => `<circle class="dot ${x.si === S.si ? "on" : ""}" cx="${xs(i).toFixed(1)}" cy="${ys(x.t.net).toFixed(1)}" r="3"/>`).join("")}
    <text x="${L}" y="${H - 4}">${dfmt(avail[0].snap.published)}</text><text x="${W - R}" y="${H - 4}" text-anchor="end">${dfmt(avail.at(-1).snap.published)}</text></svg>`;
}

function statusPanel() {
  const roster = D.officials.filter((o) => o.terms?.includes(S.term)).length;
  return `<p class="of-pk">수집 상태</p><h3 class="of-pt">아직 실은 신고 자료가 없습니다</h3>
    <div class="of-status"><b>지도에 칠할 공개 원문을 아직 정규화하지 못했습니다.</b> 이 화면은 공개 원문에서 확인한 금액만 싣고, 추정치나 예시 금액으로 빈칸을 채우지 않습니다.
      <ol><li>원천: 국회공직자윤리위원회 재산공개(국회공보) — 정기 변동신고(매년 3월 말), 새 국회 최초 신고(임기 시작 약 3개월 뒤)</li>
      <li>정규화: 항목마다 신고 주체·권리 구분·소재지·종전/현재가액을 나누고, 소계·총계가 원문과 맞는지 대조</li>
      <li>지역: 소재지를 시군구까지 맞춰 보고, 불명확하면 시도까지만 셉니다</li></ol></div>
    ${roster ? `<p class="of-note">${X.TERMS[S.term].label} 국회의원 명부 ${roster}명은 확보했습니다(위키데이터, CC0). 재산 신고가 들어오면 이 명부로 인물을 확인합니다.</p>` : ""}`;
}

/* ── 공개 시점 타임라인 ── */
const ICO = { prev: '<svg viewBox="0 0 16 16"><path d="M10.5 3 5 8l5.5 5z"/></svg>', next: '<svg viewBox="0 0 16 16"><path d="M5.5 3 11 8l-5.5 5z"/></svg>', play: '<svg viewBox="0 0 16 16"><path d="M5 3v10l8-5z"/></svg>', pause: '<svg viewBox="0 0 16 16"><path d="M4 3h3v10H4zM9 3h3v10H9z"/></svg>' };
function renderTimeline() {
  const list = termSnaps(), k = list.indexOf(S.si);
  const box = $("#ofTimeline");
  if (!list.length) { box.innerHTML = `<div class="of-tl-btns"><button type="button" disabled>${ICO.prev}</button><button type="button" disabled>${ICO.play}</button><button type="button" disabled>${ICO.next}</button></div><div class="of-track"></div><div class="of-tl-meta"><b>공개 시점 없음</b>원문 수집 전</div>`; return; }
  const pos = (i) => (list.length === 1 ? 50 : 4 + (i / (list.length - 1)) * 92);
  const s = snaps()[S.si];
  box.innerHTML = `<div class="of-tl-btns"><button type="button" data-tl="prev" aria-label="이전 공개 시점" ${k <= 0 ? "disabled" : ""}>${ICO.prev}</button>
      <button type="button" data-tl="play" aria-label="${S.playing ? "멈춤" : "시점 차례로 재생"}" aria-pressed="${S.playing}" ${list.length < 2 ? "disabled" : ""}>${S.playing ? ICO.pause : ICO.play}</button>
      <button type="button" data-tl="next" aria-label="다음 공개 시점" ${k >= list.length - 1 ? "disabled" : ""}>${ICO.next}</button></div>
    <div class="of-track" role="group" aria-label="공개 시점 선택"><span class="fill" style="width:92%;left:4%;transform:scaleX(${list.length > 1 ? (k / (list.length - 1)).toFixed(4) : 0})"></span>
      ${list.map((si, i) => { const x = snaps()[si]; return `<button type="button" class="of-tick ${x.kind === "최초" ? "first" : ""}" style="left:${pos(i)}%" data-si="${si}" aria-current="${si === S.si}" aria-label="${dfmt(x.published)} 공개, ${x.kind} 신고">
        <i></i><span>${dfmt(x.published).slice(2)}</span><small>${x.kind}</small></button>`; }).join("")}</div>
    <div class="of-tl-meta"><b>${dfmt(s.published)} 공개</b>신고 기준 ${dfmt(s.basis)}<br><button type="button" class="of-speed" data-tl="speed" aria-label="재생 속도">${S.speed}× 속도</button></div>`;
}
function step(dir) {
  const list = termSnaps(), k = list.indexOf(S.si), n = list[k + dir];
  if (n == null) return false;
  S.si = n; update({ scope: "time" });
  return true;
}
function play(on) {
  S.playing = on;
  clearTimeout(tlTimer);
  if (on) {
    const list = termSnaps();
    if (list.indexOf(S.si) >= list.length - 1) { S.si = list[0]; update({ scope: "time" }); }
    const tick = () => { if (!S.playing) return; if (!step(1)) { S.playing = false; renderTimeline(); return; } tlTimer = setTimeout(tick, 2400 / S.speed); };
    tlTimer = setTimeout(tick, 1600 / S.speed);
  }
  renderTimeline();
}

/* ── 지역 순위(레이스) ── */
const racePrev = new Map();
function renderRace(cur) {
  const box = $("#ofRace");
  if (!hasData() || S.si < 0) { box.innerHTML = ""; $("#ofRaceM").textContent = ""; return; }
  const metric = S.metric === "delta" ? "value" : S.metric;
  const top = X.rank(cur.agg, metric, 10), max = top[0]?.value || 1;
  const prevRank = cur.prev ? new Map(X.rank(cur.prev, metric, 50).map((r) => [r.code, r.rank])) : new Map();
  const fmt = (v) => (metric === "value" ? short(v) : `${v.toLocaleString("ko-KR")}${X.METRICS[metric].unit}`);
  box.innerHTML = top.map((r) => {
    const pr = prevRank.get(r.code), mv = pr ? pr - r.rank : null;
    return `<li data-code="${r.code}" aria-current="${r.code === S.region}" tabindex="0" role="button" aria-label="${r.rank}위 ${esc(regionName(r.code))} ${fmt(r.value)}">
      <span class="r">${r.rank}</span><span class="nm">${esc(regionName(r.code, { short: true }))}${mv ? `<span class="mv ${mv > 0 ? "up" : "dn"}">${mv > 0 ? "▲" : "▼"}${Math.abs(mv)}</span>` : ""}</span>
      <span class="tr"><i style="width:${((r.value / max) * 100).toFixed(2)}%"></i></span><span class="v" data-code="${r.code}">${fmt(r.value)}<small>${r.holders}명</small></span></li>`;
  }).join("");
  box.querySelectorAll(".v").forEach((el) => {
    const code = el.dataset.code, node = el.firstChild, p = parseNum(node.data), was = racePrev.get(code);
    if (p && was && was.unit === node.data.replace(/[−\-\d.,\s]/g, "")) tweenNumber(node, node.data, was.v);
    if (p) racePrev.set(code, { v: p.v, unit: node.data.replace(/[−\-\d.,\s]/g, "") });
  });
  $("#ofRaceM").textContent = `${S.level === "sido" ? "시도" : "시군구"} 상위 10 · ${X.METRICS[metric].label} · ${dfmt(snaps()[S.si].published)} 공개`;
}

/* ── 집중도 ── */
function renderConc(cur) {
  const box = $("#ofConc");
  if (!hasData() || S.si < 0) { box.innerHTML = `<p class="of-note" style="color:var(--muted)">신고 자료가 들어오면 서울·수도권 비중, 1인당 중앙값, 상위 10% 비중을 함께 보입니다.</p>`; return; }
  const cc = X.concentration(D, { si: S.si, ids: cur.c.ids, classes: CLS }), sh = cc.share || { seoul: 0, capital: 0, nonCapital: 0, unplaced: 0 };
  const snap = snaps()[S.si];
  const parties = X.parties(D, S.si).map(([p]) => {
    const ids = new Set([...cur.c.ids].filter((oi) => (X.partyAt(D.officials[oi], snap.basis) || "정당 확인 안 됨") === p));
    return { p, ...X.concentration(D, { si: S.si, ids, classes: CLS }) };
  }).filter((x) => x.n);
  $("#ofConcM").textContent = `${cur.c.ids.size}명 · ${dfmt(snap.published)} 공개`;
  box.innerHTML = `<div class="of-stack" role="img" aria-label="서울 ${pct(sh.seoul)}, 인천·경기 ${pct(sh.capital - sh.seoul)}, 비수도권 ${pct(sh.nonCapital)}, 지역 미확인 ${pct(sh.unplaced)}">
      <i style="flex-grow:${sh.seoul};background:var(--navy)">서울 ${pct(sh.seoul, 0)}</i><i style="flex-grow:${sh.capital - sh.seoul};background:var(--navy-2, #2f5643)">경기·인천 ${pct(sh.capital - sh.seoul, 0)}</i><i style="flex-grow:${sh.nonCapital};background:var(--brass)">비수도권 ${pct(sh.nonCapital, 0)}</i><i style="flex-grow:${sh.unplaced};background:var(--line)"></i></div>
    <dl class="of-kpis"><div><dt>1인당 평균</dt><dd data-k="c-mean">${short(cc.mean)}</dd></div><div><dt>1인당 중앙값</dt><dd data-k="c-med">${short(cc.median)}</dd></div><div><dt>상위 10% 몫</dt><dd data-k="c-top">${pct(cc.top10?.share)}<small>${cc.top10?.n ?? 0}명</small></dd></div>
      <div><dt>보유 신고자</dt><dd>${cc.holders}<small>/ ${cc.n}명</small></dd></div><div><dt>최댓값(1명)</dt><dd>${short(cc.max)}</dd></div><div><dt>지역 미확인 몫</dt><dd>${pct(sh.unplaced)}</dd></div></dl>
    <table class="of-ptab"><caption class="visually-hidden">정당별 소유 부동산 신고가액(신고 기준일 소속)</caption><thead><tr><th>정당(기준일 소속)</th><th>인원</th><th>중앙값</th><th>평균</th><th>서울 비중</th></tr></thead>
      <tbody>${parties.map((x) => `<tr><td>${esc(x.p)}</td><td>${x.n}</td><td>${short(x.median)}</td><td>${short(x.mean)}</td><td>${pct(x.share?.seoul)}</td></tr>`).join("")}</tbody></table>
    <p class="of-note">평균은 큰 보유자 몇 명에 크게 흔들립니다. 중앙값과 상위 10% 몫을 함께 보세요. 인원이 적은 집단의 차이는 통계적으로 의미가 없을 수 있습니다.</p>`;
  settleNumbers(box);
}

/* ── 두 시점 비교 ── */
let CMP = null;
const snapLabel = (si) => { const s = snaps()[si]; return `${X.TERMS[s.term]?.label || ""} · ${dfmt(s.published)} ${s.kind}`; };
function renderCompareCtl() {
  const all = snaps().map((_, i) => i);
  if (S.cmpA == null || S.cmpB == null) { const l = all.length; S.cmpA = all[Math.max(0, l - 3)] ?? null; S.cmpB = all[l - 1] ?? null; }
  const opt = (sel) => all.map((i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${esc(snapLabel(i))}</option>`).join("");
  $("#ofCmpCtl").innerHTML = all.length < 2 ? `<p class="of-note" style="color:var(--muted)">공개 시점이 둘 이상 쌓이면 같은 척도로 나란히 비교합니다.</p>` : `
    <label class="of-ctl"><span class="of-ctl-k">A</span><select class="of-select" data-cmp="A">${opt(S.cmpA)}</select></label>
    <label class="of-ctl"><span class="of-ctl-k">B</span><select class="of-select" data-cmp="B">${opt(S.cmpB)}</select></label>
    <div class="of-seg" role="radiogroup" aria-label="비교 방식"><button type="button" role="radio" data-cmpmode="side" aria-checked="${S.cmpMode === "side"}">나란히</button><button type="button" role="radio" data-cmpmode="delta" aria-checked="${S.cmpMode === "delta"}">증감만</button></div>
    <div class="of-seg" role="radiogroup" aria-label="비교 집단"><button type="button" role="radio" data-cmpsame="0" aria-checked="${!S.cmpSame}">각 시점 전체</button><button type="button" role="radio" data-cmpsame="1" aria-checked="${S.cmpSame}">두 시점 모두 공개한 사람</button></div>`;
}
async function renderCompare() {
  renderCompareCtl();
  const maps = $("#ofCmpMaps"), foot = $("#ofCmpFoot");
  if (!hasData() || snaps().length < 2) { maps.innerHTML = ""; foot.innerHTML = ""; $("#ofCmpM").textContent = ""; return; }
  const a = X.cohort(D, { snapshot: S.cmpA, term: snaps()[S.cmpA].term, party: S.party || null }), b = X.cohort(D, { snapshot: S.cmpB, term: snaps()[S.cmpB].term, party: S.party || null });
  if (S.cmpSame) { const both = new Set([...a.ids].filter((x) => b.ids.has(x))); a.ids = both; b.ids = new Set(both); }
  const level = S.level, A = X.regionAgg(D, { si: a.si, ids: a.ids, classes: CLS, level }), B = X.regionAgg(D, { si: b.si, ids: b.ids, classes: CLS, level });
  const d = X.diff(A, B, "value");
  $("#ofCmpM").textContent = `A ${a.ids.size}명 · B ${b.ids.size}명${S.cmpSame ? " · 동일 인물" : ""} · 같은 척도`;
  const want = S.cmpMode === "delta" ? 1 : 2;
  if (!CMP || CMP.n !== want || CMP.level !== level) {
    CMP?.maps.forEach((m) => m.map.remove());
    maps.className = `of-cmp-maps ${want === 1 ? "delta" : ""}`;
    maps.innerHTML = Array.from({ length: want }, (_, i) => `<div class="of-cmp-map"><div class="cap" id="ofCap${i}"></div><div class="of-map" id="ofCmp${i}"></div><div class="of-legend" id="ofCmpL${i}"></div></div>`).join("");
    const ms = await Promise.all(Array.from({ length: want }, (_, i) => createMap($(`#ofCmp${i}`), { labels: false, onClick: (code) => { if (code) { S.region = code; update({ scope: "select" }); } } })));
    ms.forEach((m) => m.setLevel(level));
    if (ms.length === 2) { // 두 지도의 카메라를 함께 움직인다
      let lock = false;
      const sync = (from, to) => from.map.on("move", () => { if (lock) return; lock = true; to.map.jumpTo({ center: from.map.getCenter(), zoom: from.map.getZoom() }); lock = false; });
      sync(ms[0], ms[1]); sync(ms[1], ms[0]);
    }
    CMP = { maps: ms, n: want, level };
  }
  const codes = GEO.codes[level];
  if (want === 2) {
    const br = X.breaks([...A.regions.values(), ...B.regions.values()].map((x) => x.value), 6); // 두 지도 같은 척도
    [[A, a, 0], [B, b, 1]].forEach(([agg, c, i]) => { CMP.maps[i].paint(seqColors(agg, "value", codes, br), level); CMP.maps[i].select(S.region); $(`#ofCap${i}`).innerHTML = `<b>${i ? "B" : "A"} · ${esc(snapLabel(c.si))}</b>${c.ids.size}명 · 합계 ${short([...agg.regions.values()].reduce((s, x) => s + x.value, 0))}`; $(`#ofCmpL${i}`).innerHTML = i ? legendHTML({ kind: "seq", br, title: "신고가액(공통 척도)" }) : ""; });
  } else {
    CMP.maps[0].paint(deltaColors(d, codes, deltaThreshold(d)), level); CMP.maps[0].select(S.region);
    $("#ofCap0").innerHTML = `<b>A → B 증감</b>${esc(snapLabel(a.si))} → ${esc(snapLabel(b.si))}`;
    $("#ofCmpL0").innerHTML = legendHTML({ kind: "delta", title: "신고가액 증감" });
  }
  const rows = [...d.entries()].filter(([, x]) => x.d !== 0);
  const ups = rows.sort((x, y) => y[1].d - x[1].d).slice(0, 5), dns = [...d.entries()].filter(([, x]) => x.d < 0).sort((x, y) => x[1].d - y[1].d).slice(0, 5);
  const li = ([code, x]) => `<li><span>${esc(regionName(code, { short: true }))}</span><span class="${x.d > 0 ? "of-up" : "of-dn"}" style="color:${x.d > 0 ? "var(--navy-2,#2f5643)" : "#9a5a2e"}">${x.d > 0 ? "+" : "−"}${short(Math.abs(x.d))}</span></li>`;
  foot.innerHTML = `<div><h4>가장 늘어난 지역</h4><ul class="of-movers">${ups.filter(([, x]) => x.d > 0).map(li).join("") || "<li>없음</li>"}</ul></div><div><h4>가장 줄어든 지역</h4><ul class="of-movers">${dns.map(li).join("") || "<li>없음</li>"}</ul></div>
    <p class="of-note" style="grid-column:1/-1;color:var(--muted)">${S.cmpSame ? "두 시점 모두 공개한 같은 사람들만 비교했습니다 — 의원 교체 효과가 빠진 변화입니다." : "각 시점의 해당 대수 전체를 비교했습니다 — 같은 의원의 재산 변동과 의원 구성의 교체가 섞여 있습니다. 둘을 나눈 결과는 아래 '변화의 구성'에서 봅니다."} 공개 시점 사이의 값은 관측되지 않았습니다.</p>`;
}

/* ── 국회 대수 변화 분해(폭포) ── */
function renderDecomp() {
  const body = $("#ofDecBody");
  if (!hasData() || snaps().length < 2) { body.innerHTML = `<p class="of-note" style="color:var(--muted)">두 시점의 공개 자료가 있어야 '같은 의원의 변화'와 '의원 교체 효과'를 나눌 수 있습니다.</p>`; $("#ofDecM").textContent = ""; return; }
  const all = snaps().map((_, i) => i);
  if (S.decA == null || S.decB == null) {
    // 기본: 앞 대수의 마지막 정기 공개 → 이번 대수의 첫 정기 공개
    const cur = termSnaps(), prevTerm = termSnaps(S.term - 1);
    const firstRegular = cur.find((i) => snaps()[i].kind === "정기") ?? cur[0];
    S.decA = prevTerm.length ? prevTerm[prevTerm.length - 1] : cur[0]; S.decB = prevTerm.length ? firstRegular : cur[cur.length - 1];
  }
  const opt = (sel) => all.map((i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${esc(snapLabel(i))}</option>`).join("");
  const a = X.cohort(D, { snapshot: S.decA, term: snaps()[S.decA].term, party: S.party || null }), b = X.cohort(D, { snapshot: S.decB, term: snaps()[S.decB].term, party: S.party || null });
  const r = X.decompose(D, a, b, S.decField);
  const fieldLabel = S.decField === "net" ? "재산 총액" : "부동산 신고가액";
  const steps = [["A 합계", r.A, "tot"], ["같은 의원의 변화", r.common.delta, r.common.delta >= 0 ? "up" : "dn"], ["새로 들어온 의원", r.entrants.value, "up"], ["떠난 의원", -r.exits.value, "dn"], ["B 합계", r.B, "tot"]];
  const W = 640, H = 260, L = 8, R = 8, T = 26, Bm = 46, bw = (W - L - R) / steps.length;
  let run = 0;
  const pts = steps.map(([k, v, c], i) => { let y0, y1; if (c === "tot") { y0 = 0; y1 = v; run = v; } else { y0 = run; y1 = run + v; run = y1; } return { k, v, c, i, y0, y1 }; });
  const hi = Math.max(...pts.flatMap((p) => [p.y0, p.y1])), lo = Math.min(0, ...pts.flatMap((p) => [p.y0, p.y1]));
  const y = (v) => T + (H - T - Bm) * (1 - (v - lo) / (hi - lo || 1));
  const svg = `<svg class="of-wf" viewBox="0 0 ${W} ${H}" role="img" aria-label="${fieldLabel} 변화 분해: ${steps.map(([k, v]) => `${k} ${short(v)}`).join(", ")}">
    ${pts.map((p) => `<rect class="${p.c}" x="${(L + p.i * bw + bw * 0.18).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" y="${y(Math.max(p.y0, p.y1)).toFixed(1)}" height="${Math.max(1, Math.abs(y(p.y0) - y(p.y1))).toFixed(1)}"/>
      <text x="${(L + p.i * bw + bw / 2).toFixed(1)}" y="${(y(Math.max(p.y0, p.y1)) - 6).toFixed(1)}" text-anchor="middle">${p.c === "tot" ? "" : p.v >= 0 ? "+" : "−"}${short(Math.abs(p.v))}</text>
      <text class="k" x="${(L + p.i * bw + bw / 2).toFixed(1)}" y="${H - Bm + 18}" text-anchor="middle">${p.k}</text>
      ${p.i < pts.length - 1 ? `<line class="cn" x1="${(L + p.i * bw + bw * 0.82).toFixed(1)}" x2="${(L + (p.i + 1) * bw + bw * 0.18).toFixed(1)}" y1="${y(p.y1).toFixed(1)}" y2="${y(p.y1).toFixed(1)}"/>` : ""}`).join("")}</svg>`;
  const movers = r.commonMoves;
  const nm = (oi) => esc(D.officials[oi].name);
  $("#ofDecM").textContent = `공통 ${r.common.n}명 · 진입 ${r.entrants.n}명 · 퇴장 ${r.exits.n}명`;
  body.innerHTML = `<div class="of-dec-ctl"><label class="of-ctl"><span class="of-ctl-k">A</span><select class="of-select" data-dec="A">${opt(S.decA)}</select></label>
      <label class="of-ctl"><span class="of-ctl-k">B</span><select class="of-select" data-dec="B">${opt(S.decB)}</select></label>
      <div class="of-seg" role="radiogroup" aria-label="분해할 금액"><button type="button" role="radio" data-decfield="net" aria-checked="${S.decField === "net"}">재산 총액</button><button type="button" role="radio" data-decfield="realEstate" aria-checked="${S.decField === "realEstate"}">부동산</button></div></div>
    <div class="of-dec-grid"><div>${svg}</div><div class="of-explain">
      <p><b>${fieldLabel}</b> 합계가 A ${short(r.A)}에서 B ${short(r.B)}로 <b>${r.delta >= 0 ? "+" : "−"}${short(Math.abs(r.delta))}</b> 달라졌습니다.</p>
      <p>이 가운데 두 시점 모두 공개한 같은 의원 ${r.common.n}명의 변화가 ${r.common.delta >= 0 ? "+" : "−"}${short(Math.abs(r.common.delta))}, 새로 들어온 ${r.entrants.n}명의 B 시점 몫이 +${short(r.entrants.value)}, 떠난 ${r.exits.n}명의 A 시점 몫이 −${short(r.exits.value)}입니다.
      ${r.identity ? '<span class="of-ok">세 항의 합이 전체 변화와 일치합니다.</span>' : "세 항의 합이 맞지 않습니다 — 자료 확인이 필요합니다."}</p>
      <p>이 분해는 두 시점의 신고를 산술로 나눈 것입니다. 실제 거래로 돈이 들어오고 나간 흐름이 아니며, 신고가액의 기준(공시가격 등) 변화도 함께 담겨 있습니다.</p>
      ${movers.length ? `<p>같은 의원 가운데 가장 많이 늘어난 사람: ${movers.slice(0, 3).map((m) => `${nm(m.oi)} ${m.d >= 0 ? "+" : "−"}${short(Math.abs(m.d))}`).join(", ")}<br>가장 많이 줄어든 사람: ${movers.slice(-3).reverse().map((m) => `${nm(m.oi)} ${m.d >= 0 ? "+" : "−"}${short(Math.abs(m.d))}`).join(", ")}</p>` : ""}
    </div></div>`;
}

/* ── 표 · 방법 ── */
function renderTable(cur) {
  const box = $("#ofTable");
  if (!hasData() || S.si < 0) { box.innerHTML = `<p class="of-note" style="color:var(--muted)">신고 자료가 없어 표가 비어 있습니다.</p>`; return; }
  const total = [...cur.agg.regions.values()].reduce((a, x) => a + x.value, 0) + cur.agg.unplaced.value;
  const rows = X.rank(cur.agg, "value", 400);
  box.innerHTML = `<table class="of-dtab"><caption class="visually-hidden">${dfmt(snaps()[S.si].published)} 공개, ${X.TERMS[S.term].label}, ${S.level === "sido" ? "시도" : "시군구"}별 소유 부동산 신고가액</caption>
    <thead><tr><th>순위</th><th>지역</th><th>신고가액(원)</th><th>항목</th><th>보유자</th><th>비중</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${r.rank}</td><td>${esc(regionName(r.code))}</td><td>${r.value.toLocaleString("ko-KR")}</td><td>${r.count}</td><td>${r.holders}</td><td>${pct(total ? r.value / total : 0)}</td></tr>`).join("")}
      ${cur.agg.unplaced.value ? `<tr><td>—</td><td>${S.level === "sido" ? "지역 미확인·해외" : "시군구 미확인·해외"}</td><td>${cur.agg.unplaced.value.toLocaleString("ko-KR")}</td><td>${cur.agg.unplaced.count}</td><td>${cur.agg.unplaced.holders}</td><td>${pct(total ? cur.agg.unplaced.value / total : 0)}</td></tr>` : ""}</tbody></table>`;
}
function renderMethod() {
  const m = D.manifest;
  $("#ofMethod").innerHTML = `<dl>
    <dt>원천</dt><dd>국회공직자윤리위원회가 국회공보로 공개한 국회의원 재산등록(최초)·변동신고(정기) 원문. 각 시점의 원문 주소를 패널과 머리에 적습니다.${m.synthetic ? " <b>지금 화면은 합성 시험 자료입니다.</b>" : ""}</dd>
    <dt>신고가액</dt><dd>신고자가 법정 기준으로 적은 금액입니다. 토지·주택은 대개 공시가격이라 시가·실거래가와 다릅니다. 금액 단위는 원입니다(원문은 천원).</dd>
    <dt>기준일</dt><dd>정기 변동신고는 전년 12월 31일, 최초 신고는 임기 시작일 기준입니다. 공개일과 기준일을 함께 적고, 기준일이 다른 금액은 같은 시점으로 합치지 않습니다.</dd>
    <dt>권리 구분</dt><dd>지도·순위는 소유한 토지·건물만 셉니다. 전세권·임차권, 분양권·입주권은 인물 상세에 따로 보입니다. 채무는 자산에 더하지 않고 재산 총액에서 뺍니다.</dd>
    <dt>고지거부·누락</dt><dd>고지거부·등록제외 항목은 금액을 모르므로 0원으로 세지 않고 건수만 적습니다. 그 시점 신고가 없는 사람은 집단에서 빠집니다(확보율을 머리에 적습니다).</dd>
    <dt>지역</dt><dd>소재지를 통계청 센서스용 행정구역경계(2018)의 시군구에 맞춥니다. 군위군은 현재 소속(대구)으로, 이름이 바뀐 곳은 바뀐 이름으로 셉니다. 시군구를 확정할 수 없으면 시도까지만, 그것도 없으면 '지역 미확인'으로 따로 둡니다. 정확한 지번 좌표는 쓰지 않습니다.</dd>
    <dt>정당</dt><dd>신고 기준일의 소속을 씁니다. 지금 소속을 과거에 소급하지 않습니다. 소속을 확인하지 못하면 '정당 확인 안 됨'으로 둡니다.</dd>
    <dt>색 단계</dt><dd>몇몇 큰 값 때문에 나머지가 한 색이 되지 않도록 로그 분위수로 나눕니다. 0원(보유 신고 없음)과 자료 없음은 다른 색입니다. 증감은 가운데를 0으로 두고 늘어남·줄어듦을 나눕니다.</dd>
    <dt>시간 재생</dt><dd>공개 시점 사이의 색 변화는 화면 전환일 뿐, 그 사이 시점의 재산 상태를 뜻하지 않습니다.</dd>
    <dt>변화 분해</dt><dd>전체 변화 = 같은 의원의 변화 + 새로 들어온 의원의 B 시점 몫 − 떠난 의원의 A 시점 몫. 같은 집계 기준일 때의 산술 항등식이며, 실제 자금 이동을 뜻하지 않습니다. 지역 사이의 화살표(흐름도)는 실제 취득·처분이 확인된 경우가 아니면 그리지 않습니다.</dd>
    <dt>명부</dt><dd>대수별 국회의원 명부는 위키데이터(CC0)에서 가져와 신고서의 성명·소속과 대조합니다. 성명만 같다고 같은 사람으로 보지 않습니다.</dd></dl>`;
}

/* ── 한 번에 갱신 ── */
let busy = Promise.resolve(), LAST = null;
function update({ scope = "all" } = {}) {
  if (S.si >= 0 && snaps()[S.si].term !== S.term) fixSnapshot();
  const cur = LAST = hasData() && S.si >= 0 ? current() : { c: { ids: new Set(), si: -1 }, agg: { regions: new Map(), unplaced: { value: 0, count: 0, holders: 0 } }, prev: null };
  if (scope !== "time" || !$("#ofParty").options.length) renderControls();
  renderBasis(cur);
  paintMain(cur);
  renderPanel(cur);
  renderTimeline();
  renderRace(cur);
  renderConc(cur);
  renderTable(cur);
  if (scope !== "time") busy = busy.then(() => cmpVisible && renderCompare()).catch((e) => console.error(e));
  if (scope !== "time") renderDecomp();
  writeURL();
}
let cmpVisible = false;

/* ── 상호작용 ── */
function tipAt(code, pt) {
  const tip = $("#ofTip");
  if (!code || !pt || !hasData() || S.si < 0) { tip.hidden = true; return; }
  const cur = LAST || current();
  const src = S.official != null ? personAgg(S.official, S.si) : cur.agg;
  const x = src.regions.get(code), total = [...src.regions.values()].reduce((a, y) => a + y.value, 0) + src.unplaced.value;
  const pr = cur.prev?.regions.get(code);
  const v = S.metric === "delta" && S.official == null ? (x?.value || 0) - (pr?.value || 0) : x ? x[S.metric === "delta" ? "value" : S.metric] : 0;
  const metric = S.metric === "delta" ? "value" : S.metric;
  const val = S.metric === "delta" && S.official == null ? `${v >= 0 ? "+" : "−"}${short(Math.abs(v))}` : metric === "value" ? short(v) : `${v.toLocaleString("ko-KR")}${X.METRICS[metric].unit}`;
  tip.innerHTML = `<b>${esc(regionName(code))}</b><span class="v">${val}</span><br><span class="m">${x ? `${x.holders}명 · ${x.count}건 · 전국의 ${pct(total ? x.value / total : 0)}` : "보유 신고 없음"}</span>`;
  tip.hidden = false;
  const wrap = $("#ofMapWrap").getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  let left = pt.x + 14, top = pt.y + 14;
  if (left + w > wrap.width - 8) left = pt.x - w - 14;
  if (top + h > wrap.height - 8) top = pt.y - h - 14;
  tip.style.left = `${Math.max(8, left)}px`; tip.style.top = `${Math.max(8, top)}px`;
}
function selectRegion(code) {
  if (!hasData()) return;
  S.region = code && code !== S.region ? code : null; // 같은 지역을 다시 누르면 해제
  S.level = S.region ? "sigungu" : "sido"; // 시도를 고르면 그 안의 시군구 분포를 칠한다
  S.official = null;
  update({ scope: "select" });
  MAP?.fit(S.region);
  if (mobile.matches) sheet(S.region ? "half" : "peek");
}
function selectOfficial(oi) {
  S.official = oi;
  S.level = "sigungu";
  update({ scope: "select" });
  // 그 사람이 신고한 지역 전체가 보이게 카메라를 맞춘다(지도를 처음으로 되돌리지 않는다)
  const codes = S.si >= 0 ? [...personAgg(oi, S.si, "sigungu").regions.keys()] : [];
  if (codes.length) MAP?.fit(codes);
  if (mobile.matches) sheet("half");
}
function sheet(state) {
  const p = $("#ofPanel");
  p.classList.toggle("half", state === "half"); p.classList.toggle("full", state === "full");
}
function setupSheetDrag() {
  const p = $("#ofPanel"), grip = $("#ofGrip");
  let y0 = null, start = 0;
  grip.addEventListener("pointerdown", (e) => { if (!mobile.matches) return; y0 = e.clientY; start = new DOMMatrix(getComputedStyle(p).transform).m42; p.classList.add("dragging"); grip.setPointerCapture(e.pointerId); });
  grip.addEventListener("pointermove", (e) => { if (y0 != null) p.style.transform = `translateY(${Math.max(0, start + e.clientY - y0)}px)`; });
  const end = (e) => {
    if (y0 == null) return;
    const dy = e.clientY - y0; y0 = null; p.classList.remove("dragging"); p.style.transform = "";
    const now = p.classList.contains("full") ? "full" : p.classList.contains("half") ? "half" : "peek";
    const order = ["peek", "half", "full"], i = order.indexOf(now);
    sheet(dy < -40 ? order[Math.min(2, i + 1)] : dy > 40 ? order[Math.max(0, i - 1)] : now);
  };
  grip.addEventListener("pointerup", end); grip.addEventListener("pointercancel", end);
  grip.addEventListener("click", () => { if (!mobile.matches) return; sheet($("#ofPanel").classList.contains("half") || $("#ofPanel").classList.contains("full") ? "peek" : "half"); });
}
function setupSearch() {
  const input = $("#ofQ"), list = $("#ofQList");
  let items = [], sel = -1;
  const close = () => { list.hidden = true; input.setAttribute("aria-expanded", "false"); sel = -1; };
  const show = () => {
    const q = input.value.trim();
    if (!q) return close();
    items = D.officials.map((o, oi) => ({ o, oi })).filter(({ o }) => o.name.includes(q)).sort((a, b) => (b.o.terms?.includes(S.term) - a.o.terms?.includes(S.term)) || a.o.name.localeCompare(b.o.name, "ko")).slice(0, 12);
    list.innerHTML = items.length ? items.map(({ o, oi }, i) => `<li role="option" id="ofq-${oi}" data-official="${oi}" aria-selected="${i === sel}">${esc(o.name)}<span>${(o.terms || []).map((t) => `${t}대`).join("·")}${hasData() && !D.totals.rows.some((r) => r[1] === oi) ? " · 공개 자료 없음" : ""}</span></li>`).join("") : `<li aria-disabled="true">찾는 이름이 없습니다</li>`;
    list.hidden = false; input.setAttribute("aria-expanded", "true");
  };
  input.addEventListener("input", () => { sel = -1; show(); });
  input.addEventListener("keydown", (e) => {
    if (list.hidden) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, Math.min(items.length - 1, sel + (e.key === "ArrowDown" ? 1 : -1))); show(); input.setAttribute("aria-activedescendant", items[sel] ? `ofq-${items[sel].oi}` : ""); }
    else if (e.key === "Enter" && items[Math.max(0, sel)]) { e.preventDefault(); pickOfficial(items[Math.max(0, sel)].oi); }
    else if (e.key === "Escape") close();
  });
  list.addEventListener("pointerdown", (e) => { const li = e.target.closest("[data-official]"); if (li) { e.preventDefault(); pickOfficial(Number(li.dataset.official)); } });
  input.addEventListener("blur", () => setTimeout(close, 120));
  const pickOfficial = (oi) => {
    const o = D.officials[oi];
    if (!o.terms?.includes(S.term)) { S.term = o.terms?.at(-1) || S.term; S.si = -1; fixSnapshot(); }
    input.value = o.name; close(); selectOfficial(oi);
  };
}

function bind() {
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-term],[data-metric],[data-region],[data-official],[data-crumb],[data-tl],[data-si],[data-cmpmode],[data-cmpsame],[data-decfield]");
    if (!t) return;
    if (t.dataset.term) { S.term = Number(t.dataset.term); S.si = -1; fixSnapshot(); S.region = null; S.official = null; S.party = ""; S.decA = S.decB = null; play(false); update(); MAP?.fit(null); }
    else if (t.dataset.metric) { S.metric = t.dataset.metric; update(); }
    else if (t.dataset.region !== undefined && t.closest("#ofPanelIn")) { if (t.dataset.region) selectRegion(t.dataset.region); }
    else if (t.dataset.official !== undefined && t.closest("#ofPanelIn")) selectOfficial(Number(t.dataset.official));
    else if (t.dataset.crumb) {
      if (t.dataset.crumb === "nation") { S.region = null; S.official = null; S.level = "sido"; MAP?.fit(null); }
      else { S.official = null; MAP?.fit(S.region); }
      update({ scope: "select" }); if (mobile.matches) sheet(S.region ? "half" : "peek");
    }
    else if (t.dataset.tl === "prev") { play(false); step(-1); }
    else if (t.dataset.tl === "next") { play(false); step(1); }
    else if (t.dataset.tl === "play") play(!S.playing);
    else if (t.dataset.tl === "speed") { S.speed = S.speed === 1 ? 2 : 1; renderTimeline(); }
    else if (t.dataset.si) { play(false); S.si = Number(t.dataset.si); update({ scope: "time" }); }
    else if (t.dataset.cmpmode) { S.cmpMode = t.dataset.cmpmode; renderCompare(); }
    else if (t.dataset.cmpsame) { S.cmpSame = t.dataset.cmpsame === "1"; renderCompare(); }
    else if (t.dataset.decfield) { S.decField = t.dataset.decfield; renderDecomp(); }
  });
  $("#ofRace").addEventListener("click", (e) => { const li = e.target.closest("[data-code]"); if (li) selectRegion(li.dataset.code); });
  $("#ofRace").addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.dataset.code) { e.preventDefault(); selectRegion(e.target.dataset.code); } });
  $("#ofParty").addEventListener("change", (e) => { S.party = e.target.value; S.region = null; update(); });
  document.addEventListener("change", (e) => {
    const c = e.target.closest("[data-cmp],[data-dec]");
    if (!c) return;
    if (c.dataset.cmp) { S[`cmp${c.dataset.cmp}`] = Number(c.value); renderCompare(); }
    else { S[`dec${c.dataset.dec}`] = Number(c.value); renderDecomp(); }
  });
  $("#ofLevel").addEventListener("click", () => { S.level = S.level === "sido" ? "sigungu" : "sido"; if (S.region?.length === 5 && S.level === "sido") S.region = null; update({ scope: "select" }); });
  $("#ofReset").addEventListener("click", () => { S.region = null; S.official = null; S.level = "sido"; update({ scope: "select" }); MAP?.fit(null); });
  $("#ofTimeline").addEventListener("keydown", (e) => { if (e.key === "ArrowLeft") { play(false); step(-1); e.preventDefault(); } else if (e.key === "ArrowRight") { play(false); step(1); e.preventDefault(); } });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && (S.official != null || S.region) && !e.target.closest("input,select,dialog")) { S.official != null ? (S.official = null) : (S.region = null); update({ scope: "select" }); } });
  // 비교 지도는 화면에 들어올 때 만든다(WebGL 맥락을 아낀다)
  new IntersectionObserver((en) => { if (en.some((x) => x.isIntersecting) && !cmpVisible) { cmpVisible = true; renderCompare().catch((e) => console.error(e)); } }, { rootMargin: "200px" }).observe($("#ofCompare"));
  setupSearch(); setupSheetDrag();
}

/* ── 모듈 페이지 공통: 테마 · 전체 메뉴 ── */
function shell() {
  const btn = $("#themeBtn");
  const label = () => { const dark = (document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark"; if (btn) btn.textContent = dark ? "밝게" : "어둡게"; return dark; };
  const toggle = () => { const next = label() ? "light" : "dark"; document.documentElement.dataset.theme = next; try { localStorage.setItem("theme", next); } catch { /* 저장 불가 */ } label(); };
  btn?.addEventListener("click", toggle); label();
  const sh = $("#moreSheet");
  $("#moreBtn")?.addEventListener("click", () => sh?.showModal());
  sh?.addEventListener("click", (e) => { if (e.target === sh || e.target.closest("[data-close-sheet]")) sh.close(); });
  $("#sheetRefresh")?.addEventListener("click", () => location.reload());
  $("#sheetTheme")?.addEventListener("click", toggle);
}

(async () => {
  shell();
  palette();
  try {
    D = await loadData();
  } catch (e) {
    $("#ofPanelIn").innerHTML = `<div class="of-status"><b>자료를 불러오지 못했습니다.</b> ${esc(e.message)}</div>`;
    return;
  }
  readURL(); fixSnapshot();
  if (!termSnaps().length && !D.officials.some((o) => o.terms?.includes(S.term))) { const t = Math.max(...Object.keys(X.TERMS).map(Number).filter((x) => termSnaps(x).length || D.officials.some((o) => o.terms?.includes(x))), 22); S.term = t; fixSnapshot(); }
  bind(); renderMethod(); update();
  try {
    MAP = await createMap($("#ofMap"), {
      onHover: tipAt, onClick: (code) => (code ? selectRegion(code) : null),
      onZoomLevel: (lv) => { if (lv === "sido" && (S.region || S.official != null)) return; S.level = lv; update({ scope: "select" }); },
    });
    update({ scope: "select" });
    if (S.region) MAP.fit(S.region);
  } catch (e) {
    console.error(e);
    $("#ofMap").innerHTML = `<p class="of-empty-map">지도를 불러오지 못했습니다. 아래 표에서 같은 수치를 볼 수 있습니다.</p>`;
  }
  flipList($("#ofRace"), (li) => li.dataset.code || null, { bars: [".tr i"] });
  if (FIXTURE) window.__of = { S, get map() { return MAP?.map; }, geo: () => GEO, personAgg }; // 합성 자료 화면 검수용
  mobile.addEventListener("change", () => sheet("peek"));
})();
