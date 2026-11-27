// 국정 상황판 · 공용 계층의 순수 함수 (브라우저·Node 공용, 의존성 0) — 테스트는 test/core.test.mjs
// 원칙: 화면에 내는 숫자는 실제로 받은 두 스냅샷을 비교해서만 만든다. 비교 기준이 없으면 내지 않는다.

/* ── 신규 기사: 직전 성공 스냅샷과 비교 ── */
export const linksOf = (d) => {
  const out = new Set();
  for (const s of d?.sections || []) for (const it of s.items || []) if (it?.link) out.add(canon(it.link));
  return out;
};
// 같은 기사를 다른 주소로 세지 않게: 추적 꼬리표·조각·끝 빗금만 걷어낸다 (경로·검색어는 그대로)
export function canon(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    for (const k of [...x.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|ref$|from$)/i.test(k)) x.searchParams.delete(k);
    return `${x.protocol}//${x.host.toLowerCase()}${x.pathname.replace(/\/+$/, '')}${x.search}`;
  } catch { return String(u).trim(); }
}
// prev: { gen, links:[...] } 직전 성공 스냅샷. 같은 세대이거나 더 새 것이면 비교하지 않는다(null).
export function newArticles(d, prev) {
  if (!d?.generatedAt || d.stale || !prev?.gen || !Array.isArray(prev.links)) return null;
  if (!(Date.parse(d.generatedAt) > Date.parse(prev.gen))) return null;
  const seen = new Set(prev.links);
  let n = 0;
  for (const l of linksOf(d)) if (!seen.has(l)) n++;
  return n;
}
export const snapshotOf = (d) => ({ gen: d.generatedAt, links: [...linksOf(d)] });

/* ── 수집 상태: 받은 자료의 시각과 표시만으로 판단 (내부 오류 내용은 내지 않는다) ── */
export const DELAY_MS = 12 * 60 * 1000; // 국내 목표 2~3분 + CDN 5분 + 여유
export const STALE_MS = 30 * 60 * 1000;
export function statusOf(d, now = Date.now()) {
  if (!d?.generatedAt) return { key: 'none', label: '확인 중' };
  const age = now - Date.parse(d.generatedAt);
  if (d.stale || age > STALE_MS) return { key: 'stale', label: '직전 자료' };
  if (age > DELAY_MS) return { key: 'late', label: '지연' };
  return { key: 'ok', label: '정상' };
}

/* ── 여러 선 추이 차트: 그릴 칸 너비에 맞춘 배치 ── */
// 끝 이름표: 겹치지 않게 아래로 밀고, 아래 끝을 넘으면 통째로 위로 올린다 (순서는 값 순서 그대로)
export function placeLabels(ys, { gap = 20, top = 12, bottom = 220 } = {}) {
  const order = ys.map((y, i) => ({ i, y })).sort((a, b) => a.y - b.y);
  for (let k = 0; k < order.length; k++) {
    order[k].y = Math.max(order[k].y, top);
    if (k && order[k].y - order[k - 1].y < gap) order[k].y = order[k - 1].y + gap;
  }
  const over = order.length ? order.at(-1).y - bottom : 0;
  if (over > 0) for (const o of order) o.y -= over;
  for (let k = order.length - 2; k >= 0; k--) if (order[k + 1].y - order[k].y < gap) order[k].y = order[k + 1].y - gap; // 위로 올린 뒤 다시 간격
  const out = []; for (const o of order) out[o.i] = Math.round(o.y * 10) / 10;
  return out;
}
// 아래 눈금: 글자 폭(minPx)보다 칸이 좁으면 건너뛴다. 첫 칸과 마지막 칸은 늘 쓰고, 연도가 바뀌는 칸은 연도까지 쓴다.
export function tickPlan(labels, W, { minPx = 40 } = {}) {
  const n = labels.length;
  if (!n) return [];
  const step = n < 2 ? 1 : Math.max(1, Math.ceil(minPx / (W / (n - 1))));
  const keep = new Set([0, n - 1]);
  for (let i = 0; i < n; i += step) keep.add(i);
  // 마지막 칸과 너무 붙은 칸은 뺀다
  for (const i of [...keep]) if (i !== n - 1 && i !== 0 && n - 1 - i < step) keep.delete(i);
  let lastYear = null;
  return labels.map((t, i) => {
    if (!keep.has(i)) return null;
    const [yy, mm] = String(t).split('.');
    const text = lastYear !== yy ? `${yy}.${Number(mm)}` : `${Number(mm)}월`;
    lastYear = yy;
    return { i, text, anchor: i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle', yr: text.includes('.') };
  }).filter(Boolean);
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const num = (n, d) => n.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
// 기존 app.js multiLine 과 같은 표지(class·data-ml·data-w)를 내므로 app.js 의 bindMline 이 그대로 붙는다.
// width: 그릴 칸의 실제 CSS 폭 → 그림 1단위 = 화면 1px (글자가 줄어들거나 늘지 않는다)
export function multiLineSVG(series, width) {
  const narrow = width < 480;
  const G = narrow ? 92 : 130;                 // 오른쪽 이름표 칸
  const W = Math.max(150, Math.round(width - G - 6));
  const H = narrow ? 220 : 260, pt = 16, pb = 36;
  const all = series.flatMap((s) => s.pts.map((p) => p.v));
  const min = Math.min(...all), max = Math.max(...all), span = max - min || 1;
  const n = Math.max(...series.map((s) => s.pts.length));
  const X = (i) => (n < 2 ? 0 : (i / (n - 1)) * W);
  const y = (v) => pt + (1 - (v - min) / span) * (H - pt - pb);
  const f = (v) => v.toFixed(1);
  const endY = placeLabels(series.map((s) => y(s.pts.at(-1).v) + 5), { gap: narrow ? 18 : 20, top: pt, bottom: H - pb + 4 });
  const lab = series.reduce((a, s) => (s.pts.length === n ? s : a), series[0]).pts;
  const ticks = tickPlan(lab.map((p) => p.label), W, { minPx: narrow ? 46 : 42 });
  const grid = lab.map((p, i) => `<line class="gx" x1="${f(X(i))}" x2="${f(X(i))}" y1="${pt - 4}" y2="${H - pb}"/>`).join('')
    + ticks.map((t) => `<text class="tx${t.yr ? ' yr' : ''}" x="${f(X(t.i))}" y="${H - pb + 20}" text-anchor="${t.anchor}">${t.text}</text>`).join('');
  const lines = series.map((s, si) => {
    const off = n - s.pts.length;
    const d = s.pts.map((p, i) => `${i ? 'L' : 'M'}${f(X(i + off))} ${f(y(p.v))}`).join('');
    const dots = s.pts.map((p, i) => `<circle class="ml-p ${s.cls}" cx="${f(X(i + off))}" cy="${f(y(p.v))}" r="${i === s.pts.length - 1 ? 4.5 : 2.6}"/>`).join('');
    return `<path class="ml ${s.cls}" d="${d}" vector-effect="non-scaling-stroke"/>${dots}<text class="ml-t ${s.cls}" x="${W + 10}" y="${endY[si]}">${esc(s.name)} <tspan class="ml-v">${num(s.pts.at(-1).v, 1)}</tspan></text>`;
  }).join('');
  const data = { labels: lab.map((p) => p.label), series: series.map((s) => ({ name: s.name, cls: s.cls, v: s.pts.map((p) => p.v), off: n - s.pts.length })) };
  const base = min < 100 && max > 100 ? `<line class="base" x1="0" x2="${W}" y1="${f(y(100))}" y2="${f(y(100))}"/><text class="ax" x="4" y="${f(y(100) - 6)}">기준 100</text>` : '';
  return `<svg class="mline gk-ml" viewBox="0 0 ${W + G} ${H}" preserveAspectRatio="xMinYMin meet" role="img" aria-label="지역별 매매가격지수 추이" data-ml="${esc(JSON.stringify(data))}" data-w="${W}" data-cw="${Math.round(width)}" style="aspect-ratio:${W + G}/${H}">
    ${grid}${base}${lines}<line class="mx" x1="0" x2="0" y1="${pt - 4}" y2="${H - pb}" visibility="hidden"/>
    <rect class="hit" x="0" y="0" width="${W}" height="${H}" fill="transparent"/></svg>`;
}
// data-ml 에서 다시 그릴 재료를 되살린다 (폭이 바뀌었을 때 같은 자료로 다시 배치)
export const seriesFromData = (data) => data.series.map((s) => ({ name: s.name, cls: s.cls, pts: s.v.map((v, i) => ({ v, label: data.labels[i + s.off] })) }));
