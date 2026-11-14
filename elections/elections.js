// 국정 한눈에 · 선거 후 시장 — 화면 (의존성 0). 계산은 scripts/elections/build.mjs 가 끝내 두고, 여기서는 그리기만 한다.
import { countUp } from '/motion/motion.js?v=1';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const nf = (v, d = 1) => v.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
const sgn = (v, d = 1, unit = '%') => { if (v == null) return '—'; const z = Math.abs(v) < 0.5 * 10 ** -d; return `${z ? '' : v > 0 ? '+' : '−'}${nf(z ? 0 : Math.abs(v), d)}${unit}`; }; // 반올림하면 0인 값에 부호를 붙이지 않는다
const tone = (v, d = 2) => (v == null || Math.abs(v) < 0.5 * 10 ** -d ? '' : v > 0 ? 'up' : 'down');
const pval = (p) => (p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(p < 0.01 ? 3 : 2)}`);
const ord = (p) => `${Math.round(p)}백분위`;
const ymd = (iso, short = false) => { const [y, m, d] = iso.split('-').map(Number); return short ? `${String(y).slice(2)}.${m}.${d}` : `${y}년 ${m}월 ${d}일`; };
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');

const S = { asset: 'kospi', kind: 'all', H: 60, sel: null, hover: null };
let D = null;

/* ── 상태 · 주소 ── */
function readURL() {
  const q = new URLSearchParams(location.search);
  if (['kospi', 'usdkrw'].includes(q.get('a'))) S.asset = q.get('a');
  if (['all', 'P', 'G', 'L'].includes(q.get('k'))) S.kind = q.get('k');
  if (['60', '120'].includes(q.get('h'))) S.H = Number(q.get('h'));
  if (q.get('e')) S.sel = q.get('e');
}
function writeURL() {
  const q = new URLSearchParams();
  if (S.asset !== 'kospi') q.set('a', S.asset);
  if (S.kind !== 'all') q.set('k', S.kind);
  if (S.H !== 60) q.set('h', S.H);
  if (S.sel) q.set('e', S.sel);
  history.replaceState(null, '', `${location.pathname}${q.size ? `?${q}` : ''}`);
}
const A = () => D.assets[S.asset];
const pool = () => D.elections.filter((e) => (S.kind === 'all' || e.kind === S.kind) && e.m[S.asset]);
function fixSel() {
  const p = pool();
  if (!p.some((e) => e.id === S.sel)) S.sel = p.length ? p.reduce((a, e) => (e.date > a.date ? e : a)).id : null;
}
const sel = () => D.elections.find((e) => e.id === S.sel);
const shortName = (e, narrow = false) => `${narrow ? `’${e.date.slice(2, 4)}` : e.date.slice(0, 4)} ${D.kinds[e.kind].short}`;

/* ── 조건 단추 ── */
function seg(el, items, cur, onPick) {
  el.innerHTML = items.map(([v, l, dis]) => `<button type="button" role="radio" aria-checked="${v === cur}" data-v="${v}"${dis ? ' disabled' : ''}>${l}</button>`).join('');
  el.onclick = (e) => { const b = e.target.closest('button[data-v]'); if (b && !b.disabled) onPick(b.dataset.v); };
  el.onkeydown = (e) => {
    if (!['ArrowLeft', 'ArrowRight'].includes(e.key)) return;
    const bs = [...el.querySelectorAll('button:not([disabled])')], i = bs.indexOf(document.activeElement);
    const n = bs[(i + (e.key === 'ArrowRight' ? 1 : -1) + bs.length) % bs.length]; n.focus(); n.click(); e.preventDefault();
  };
}
function controls() {
  seg($('#elAsset'), [['kospi', '코스피'], ['usdkrw', '원·달러']], S.asset, (v) => { S.asset = v; fixSel(); render(); });
  seg($('#elKind'), [['all', '전체'], ['P', '대통령'], ['G', '국회의원'], ['L', '지방']], S.kind, (v) => { S.kind = v; fixSel(); render(); });
  seg($('#elH'), [['60', '60거래일'], ['120', '120거래일']], String(S.H), (v) => { S.H = Number(v); render(); });
}

/* ── 요약 ── */
function kpis() {
  const g = D.summary[S.asset][S.kind], a = A(), b = a.base;
  const p = pool();
  if (!g) { $('#elKpis').innerHTML = ''; $('#elVerdict').textContent = '이 조건에 맞는 선거가 없습니다.'; return; }
  const r20 = p.map((e) => e.m[S.asset].ret[20]).filter((v) => v != null).sort((x, y) => x - y);
  const med20 = r20.length ? r20[Math.floor((r20.length - 1) / 2)] * 0.5 + r20[Math.ceil((r20.length - 1) / 2)] * 0.5 : null;
  $('#elKpis').innerHTML = `
    <dl class="el-kpi"><dt>선거 뒤 변동성 ÷ 선거 전 (중앙값)</dt><dd class="v">${nf(g.medianRatio, 2)}<small>배</small></dd><dd class="s">평소 ${nf(g.baseMedianRatio, 2)}배 · 선거 ${g.n}번</dd></dl>
    <dl class="el-kpi"><dt>선거 뒤가 더 출렁인 선거</dt><dd class="v">${g.up}<small>/ ${g.n}</small></dd><dd class="s">평소라면 ${Math.round(g.p1 * 100)}% 확률 · 이항검정 ${pval(g.pUp)}</dd></dl>
    <dl class="el-kpi"><dt>평소 상위 10%를 넘긴 선거</dt><dd class="v">${g.top}<small>번</small></dd><dd class="s">우연이라면 약 ${nf(g.expectTop, 1)}번 · ${pval(g.pTop)}</dd></dl>
    <dl class="el-kpi"><dt>선거 뒤 20거래일 ${S.asset === 'kospi' ? '수익률' : '변화율'} 중앙값</dt><dd class="v ${tone(med20)}">${sgn(med20, 1, '')}<small>%</small></dd><dd class="s">평소 중앙값 ${sgn(b.ret20[3], 1)} · ${S.asset === 'usdkrw' ? '양(+)은 원화 약세' : '종가 기준'}</dd></dl>`;
  countUp($('#elKpis'));
  // 한 문장 판정: 유의수준은 함께 보는 묶음 8개(지표 2 × 선거 4)로 나눠 보정한다
  const alpha = 0.05 / 8, kindName = S.kind === 'all' ? '전국 단위 선거' : D.kinds[S.kind].name;
  const head = `${a.name}는 ${kindName} ${g.n}번 가운데 <em>${g.up}번</em>, 선거 뒤 20거래일이 선거 전 20거래일보다 더 출렁였습니다.`;
  let tail;
  if (g.pUp < alpha) tail = ` 평소라면 ${Math.round(g.p1 * 100)}% 안팎이므로 우연으로 보기 어려운 차이입니다(${pval(g.pUp)}, 여러 묶음을 함께 본 보정 기준 ${alpha.toFixed(4)} 미만).`;
  else if (g.pUp < 0.05) tail = ` 평소라면 ${Math.round(g.p1 * 100)}% 안팎이어서 잦은 편이지만(${pval(g.pUp)}), 지표와 선거 종류를 여럿 함께 비교한 결과라 보정하면 우연과 가릴 수 없습니다.`;
  else tail = ` 평소에도 ${Math.round(g.p1 * 100)}% 안팎은 그렇게 되므로, 선거 뒤가 특별히 더 흔들렸다고 말할 근거는 약합니다(${pval(g.pUp)}).`;
  $('#elVerdict').innerHTML = head + tail;
}

/* ── 경로 차트 ── */
const PRE = 20;
function niceTicks(lo, hi, n = 5) {
  const span = hi - lo, step0 = span / n, mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= n) || 10 * mag;
  const out = []; for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}
function pathChart() {
  const host = $('#elPath'), W = Math.max(300, host.clientWidth || 600), narrow = W < 560;
  const H = narrow ? 300 : 380, m = { l: 40, r: narrow ? 92 : 124, t: 14, b: 30 };
  const a = A(), K = S.H, ks = Array.from({ length: PRE + K + 1 }, (_, i) => i - PRE);
  const p = pool(), cur = sel();
  const band = a.base.band.slice(0, PRE + K + 1);
  const med = D.median[S.asset][S.kind].slice(0, PRE + K + 1);
  const vals = [...p.flatMap((e) => e.m[S.asset].path.slice(0, PRE + K + 1)), ...band.flatMap((b) => [b[0], b[4]])].filter((v) => v != null);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
  const X = (k) => m.l + ((k + PRE) / (PRE + K)) * (W - m.l - m.r), Y = (v) => m.t + (1 - (v - lo) / (hi - lo)) * (H - m.t - m.b);
  const f = (v) => v.toFixed(1);
  const line = (arr) => { let d = '', pen = false; arr.forEach((v, i) => { if (v == null) { pen = false; return; } d += `${pen ? 'L' : 'M'}${f(X(ks[i]))} ${f(Y(v))}`; pen = true; }); return d; };
  const area = (iLo, iHi) => `M${band.map((b, i) => `${f(X(ks[i]))} ${f(Y(b[iHi]))}`).join('L')}L${band.map((b, i) => `${f(X(ks[i]))} ${f(Y(b[iLo]))}`).reverse().join('L')}Z`;
  const yt = niceTicks(lo, hi, narrow ? 4 : 6), xt = [-20, 0, 20, 40, 60, ...(K > 60 ? [80, 100, 120] : [])].filter((k) => k <= K);
  // 끝 이름표: 고른 선거와 중앙값만(겹치면 벌린다)
  const lastOf = (arr) => { for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return [ks[i], arr[i]]; return null; };
  const hiPath = cur ? cur.m[S.asset].path.slice(0, PRE + K + 1) : [];
  const ends = [];
  const hl = cur && lastOf(hiPath), ml = lastOf(med);
  if (hl) ends.push({ k: 'hi', x: hl[0], v: hl[1], y: Y(hl[1]), t: shortName(cur, narrow) });
  if (ml) ends.push({ k: 'mid', x: ml[0], v: ml[1], y: Y(ml[1]), t: narrow ? '중앙' : '중앙값' });
  ends.sort((x, y) => x.y - y.y);
  if (ends.length === 2 && ends[1].y - ends[0].y < 30) { const c = (ends[0].y + ends[1].y) / 2; ends[0].y = c - 15; ends[1].y = c + 15; }
  const svg = `<svg viewBox="0 0 ${W} ${H}" style="aspect-ratio:${W}/${H}" aria-hidden="true">
    ${yt.map((v) => `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${f(Y(v))}" y2="${f(Y(v))}"/><text x="${m.l - 6}" y="${f(Y(v) + 4)}" text-anchor="end">${nf(v, 0)}</text>`).join('')}
    <path class="band" d="${area(0, 4)}"/><path class="band2" d="${area(1, 3)}"/><path class="bmed" d="${line(band.map((b) => b[2]))}"/>
    <line class="base" x1="${m.l}" x2="${W - m.r}" y1="${f(Y(100))}" y2="${f(Y(100))}"/>
    <line class="zero" x1="${f(X(0))}" x2="${f(X(0))}" y1="${m.t}" y2="${H - m.b}"/>
    <text class="zero-t" x="${f(X(0) + 5)}" y="${m.t + 11}">선거</text>
    ${xt.map((k) => `<text x="${f(X(k))}" y="${H - m.b + 18}" text-anchor="${k === -20 ? 'start' : 'middle'}">${k === 0 ? '0' : k > 0 ? `+${k}` : k}</text>`).join('')}
    <g class="ctxs">${p.filter((e) => e.id !== S.sel).map((e) => `<path class="ctx" data-id="${e.id}" d="${line(e.m[S.asset].path.slice(0, PRE + K + 1))}"/>`).join('')}</g>
    <path class="mid" d="${line(med)}"/>
    ${cur ? `<path class="hi" d="${line(hiPath)}"/>${hl ? `<circle class="hi-dot" cx="${f(X(hl[0]))}" cy="${f(Y(hl[1]))}" r="4.5"/>` : ''}` : ''}
    ${ends.map((e) => `<text class="lab${e.k === 'hi' ? ' hi-t' : ''}" x="${f(X(e.x) + 8)}" y="${f(e.y + 4)}">${esc(e.t)} <tspan class="v">${nf(e.v, 1)}</tspan></text>`).join('')}
    <line class="cross" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>
    <rect class="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}"/>
  </svg>`;
  host.innerHTML = svg;
  const s = host.firstElementChild, cross = s.querySelector('.cross');
  const geom = { W, X, Y, m, K, ks, lo, hi };
  host._g = geom;
  // 올리면: 가장 가까운 거래일의 값들, 가까운 선을 잠시 드러냄. 누르면 그 선거를 고른다
  const pick = (ev) => {
    const r = s.getBoundingClientRect(), sc = r.width / W;
    const x = (ev.clientX - r.left) / sc, y = (ev.clientY - r.top) / sc;
    const k = Math.round(((x - m.l) / (W - m.l - m.r)) * (PRE + K) - PRE);
    const kk = Math.max(-PRE, Math.min(K, k)), j = kk + PRE;
    let near = null, best = 14;
    for (const e of p) { const v = e.m[S.asset].path[j]; if (v == null) continue; const dy = Math.abs(Y(v) - y); if (dy < best) { best = dy; near = e; } }
    return { kk, j, near, cx: r.left + X(kk) * sc, cy: ev.clientY };
  };
  s.addEventListener('pointermove', (ev) => {
    const { kk, j, near, cx, cy } = pick(ev);
    cross.setAttribute('x1', X(kk)); cross.setAttribute('x2', X(kk)); cross.setAttribute('visibility', 'visible');
    s.querySelectorAll('.ctx.hov').forEach((n) => n.classList.remove('hov'));
    if (near && near.id !== S.sel) s.querySelector(`.ctx[data-id="${near.id}"]`)?.classList.add('hov');
    const rows = [];
    const show = near || cur;
    if (show) {
      const mm = show.m[S.asset], v = mm.path[j];
      const date = mm.dd[j] != null ? addDays(mm.t0, mm.dd[j]) : null;
      rows.push(`<b>${esc(show.label)} · ${kk === 0 ? '기준일' : kk > 0 ? `+${kk}거래일` : `${kk}거래일`}${date ? ` (${ymd(date, true)})` : ''}</b>`);
      if (v != null) rows.push(`<div class="r"><span><i style="border-color:var(--${show.id === S.sel ? 'el-hi' : 'text-2'})"></i>${esc(shortName(show))}</span><strong>${nf(v, 1)} <small class="${tone(v - 100)}">${sgn(v - 100, 1)}</small></strong></div>`);
    } else rows.push(`<b>${kk >= 0 ? `+${kk}` : kk}거래일</b>`);
    if (med[j] != null) rows.push(`<div class="r"><span><i style="border-color:var(--el-mid)"></i>중앙값(${p.length}번)</span><strong>${nf(med[j], 1)}</strong></div>`);
    rows.push(`<div class="r"><span>평소 가운데 80%</span><strong>${nf(band[j][0], 1)}–${nf(band[j][4], 1)}</strong></div>`);
    tip(rows.join(''), cx, cy);
  });
  s.addEventListener('pointerleave', () => { cross.setAttribute('visibility', 'hidden'); s.querySelectorAll('.ctx.hov').forEach((n) => n.classList.remove('hov')); untip(); });
  s.addEventListener('click', (ev) => { const { near } = pick(ev); if (near && near.id !== S.sel) { S.sel = near.id; render({ keepTip: true }); } });
  // 화면 낭독기용 요약
  $('#elPathDesc').textContent = cur ? `${cur.label}: 투표 전날 ${a.name} 값을 100으로 놓으면 20거래일 뒤 ${sgn(cur.m[S.asset].ret[20], 1)}, 60거래일 뒤 ${sgn(cur.m[S.asset].ret[60], 1)}. 같은 묶음 ${p.length}번의 중앙값은 60거래일 뒤 ${med[PRE + 60] != null ? nf(med[PRE + 60], 1) : '—'}.` : '';
  $('#elPathM').textContent = `${a.name} · ${a.t0}. 가로축은 선거 전후 거래일 수. 회색 선은 같은 묶음의 다른 선거, 띠는 모든 거래일을 기준일로 삼았을 때 가운데 80%(진한 곳 50%)입니다.`;
  $('#elLegend').innerHTML = `${cur ? `<li><i class="hi"></i>${esc(shortName(cur))}</li>` : ''}<li><i class="mid"></i>중앙값</li><li><i class="ctx"></i>다른 선거</li><li><i class="band"></i>평소 범위</li>`;
}

/* ── 고른 선거 해설 ── */
function card() {
  const e = sel(), el = $('#elCard');
  if (!e) { el.innerHTML = ''; return; }
  const m = e.m[S.asset], a = A(), p = pool(), i = p.findIndex((x) => x.id === e.id);
  const order = [...p].sort((x, y) => x.date.localeCompare(y.date)), oi = order.findIndex((x) => x.id === e.id);
  el.innerHTML = `<h4>${esc(e.label)}</h4>
    <p class="when">선거일 ${ymd(e.date)} · 기준 ${ymd(m.t0, true)} ${S.asset === 'kospi' ? '종가' : '뉴욕 정오'} ${nf(m.close0, S.asset === 'kospi' ? 2 : 2)}${S.asset === 'kospi' ? '' : '원'}</p>
    <dl>
      <dt>다음 거래일</dt><dd class="${tone(m.ret[1])}">${sgn(m.ret[1], 2)}</dd>
      <dt>+20거래일</dt><dd class="${tone(m.ret[20])}">${sgn(m.ret[20], 1)}</dd>
      <dt>+60거래일</dt><dd class="${tone(m.ret[60])}">${sgn(m.ret[60], 1)}</dd>
      <dt>변동성 전 → 후</dt><dd>${nf(m.volPre * 100, 1)}% → ${nf(m.volPost * 100, 1)}%</dd>
      <dt>비율 (평소 대비)</dt><dd>${nf(m.ratio, 2)}배 · ${ord(m.pct.ratio)}</dd>
      <dt>60일 최대 낙폭</dt><dd>${m.mdd60 == null ? '—' : sgn(m.mdd60 * 100, 1)}</dd>
    </dl>
    ${m.avail < S.H ? `<p class="partial">자료가 ${m.avail}거래일까지만 있습니다(${ymd(a.last, true)} 기준).</p>` : ''}
    ${e.note ? `<p class="note">같은 시기: ${esc(e.note)}</p>` : ''}
    <div class="nav"><button type="button" data-step="-1"${oi <= 0 ? ' disabled' : ''}>← 이전 선거</button><button type="button" data-step="1"${oi >= order.length - 1 ? ' disabled' : ''}>다음 선거 →</button></div>`;
  el.querySelector('.nav').onclick = (ev) => { const b = ev.target.closest('[data-step]'); if (!b) return; S.sel = order[oi + Number(b.dataset.step)].id; render(); };
  void i;
}

/* ── 변동성 비율 ── */
function ratioChart() {
  const host = $('#elRatio'), W = Math.max(300, host.clientWidth || 600), narrow = W < 560;
  const rows = [...pool()].sort((x, y) => y.date.localeCompare(x.date));
  const base = A().base.ratio; // QS: .05 .1 .25 .5 .75 .9 .95
  const RH = narrow ? 46 : 30, top = 26, H = top + rows.length * RH + 8;
  const L = narrow ? 8 : 168, R = narrow ? 8 : 150, plotTop = top;
  const lo = Math.log(0.25), hi = Math.log(4);
  const X = (v) => L + ((Math.log(Math.min(4, Math.max(0.25, v))) - lo) / (hi - lo)) * (W - L - R);
  const f = (v) => v.toFixed(1);
  const ticks = [0.25, 0.5, 1, 2, 4];
  const rowY = (i) => plotTop + i * RH + (narrow ? 32 : RH / 2);
  const svg = `<svg viewBox="0 0 ${W} ${H}" style="aspect-ratio:${W}/${H}" role="img" aria-label="선거별 변동성 비율">
    <rect class="band" x="${f(X(base[1]))}" y="${plotTop - 4}" width="${f(X(base[5]) - X(base[1]))}" height="${rows.length * RH + 6}" style="fill:var(--el-band)"/>
    <rect class="band2" x="${f(X(base[2]))}" y="${plotTop - 4}" width="${f(X(base[4]) - X(base[2]))}" height="${rows.length * RH + 6}" style="fill:var(--el-band2)"/>
    <line class="bmed" x1="${f(X(base[3]))}" x2="${f(X(base[3]))}" y1="${plotTop - 4}" y2="${plotTop + rows.length * RH + 2}"/>
    <line class="one" x1="${f(X(1))}" x2="${f(X(1))}" y1="${plotTop - 4}" y2="${plotTop + rows.length * RH + 2}"/>
    ${ticks.map((t) => `<text x="${f(X(t))}" y="14" text-anchor="${t === 0.25 ? 'start' : t === 4 ? 'end' : 'middle'}">${t === 1 ? '1배' : `${t}`}</text>`).join('')}
    ${narrow ? '' : `<text x="${L - 14}" y="14" text-anchor="end">← 잠잠해짐</text><text x="${W - R + 14}" y="14">출렁임 →</text>`}
    ${narrow ? rows.map((_, i) => (i ? `<line class="grid" x1="0" x2="${W}" y1="${plotTop + i * RH}" y2="${plotTop + i * RH}"/>` : '')).join('') : ''}
    ${rows.map((e, i) => {
      const m = e.m[S.asset], y = rowY(i), out = m.pct.ratio > 90 || m.pct.ratio < 10;
      const nameY = narrow ? plotTop + i * RH + 15 : y + 4;
      return `<g class="row${e.id === S.sel ? ' sel' : ''}" data-id="${e.id}">
        ${e.id === S.sel ? `<rect class="row-sel" x="0" y="${plotTop + i * RH}" width="${W}" height="${RH}"/>` : ''}
        <text class="name" x="${narrow ? 0 : L - 12}" y="${f(nameY)}" text-anchor="${narrow ? 'start' : 'end'}">${esc(e.label.replace(/^제/, '').replace(' 대통령 선거', ' 대선').replace(' 국회의원 선거', ' 총선').replace(' 전국동시지방선거', ' 지선'))} <tspan class="name kind">${e.date.slice(0, 4)}</tspan></text>
        <line class="stem" x1="${f(X(1))}" x2="${f(X(m.ratio))}" y1="${f(y)}" y2="${f(y)}"/>
        <circle class="dot${out ? ' out' : ''}" cx="${f(X(m.ratio))}" cy="${f(y)}" r="5"/>
        <text class="val" x="${narrow ? W : W - R + 12}" y="${f(narrow ? nameY : y + 4)}" text-anchor="${narrow ? 'end' : 'start'}">${nf(m.ratio, 2)}배 <tspan class="pct${out ? ' out' : ''}">${ord(m.pct.ratio)}</tspan></text>
        <rect class="row-hit" x="0" y="${plotTop + i * RH}" width="${W}" height="${RH}"/>
      </g>`;
    }).join('')}
  </svg>`;
  host.innerHTML = rows.length ? svg : '<p class="el-pm">이 지표로 견줄 수 있는 선거가 없습니다.</p>';
  host.onclick = (ev) => { const g = ev.target.closest('g.row'); if (g) { S.sel = g.dataset.id; render(); $('#elPath').scrollIntoView({ behavior: reduced.matches ? 'instant' : 'smooth', block: 'center' }); } };
  host.onpointermove = (ev) => {
    const g = ev.target.closest('g.row'); if (!g) { untip(); return; }
    const e = D.elections.find((x) => x.id === g.dataset.id), m = e.m[S.asset];
    tip(`<b>${esc(e.label)}</b><div class="r"><span>선거 전 20거래일</span><strong>${nf(m.volPre * 100, 1)}%</strong></div><div class="r"><span>선거 뒤 20거래일</span><strong>${nf(m.volPost * 100, 1)}%</strong></div><div class="r"><span>비율 · 평소 대비</span><strong>${nf(m.ratio, 2)}배 · ${ord(m.pct.ratio)}</strong></div>`, ev.clientX, ev.clientY);
  };
  host.onpointerleave = untip;
}

/* ── 표 ── */
function table() {
  const rows = [...pool()].sort((x, y) => y.date.localeCompare(x.date)), a = A();
  const pc = (v, out) => (v == null ? '' : `<span class="p${out ? ' out' : ''}">${ord(v)}</span>`);
  const td = (v, d, p) => (v == null ? '<td class="na">—</td>' : `<td class="${tone(v)}">${sgn(v, d)}${p ?? ''}</td>`);
  $('#elTableWrap').innerHTML = `<table class="el-table">
    <thead><tr><th scope="col">선거</th><th scope="col">기준일</th><th scope="col">다음 거래일</th><th scope="col">+20거래일</th><th scope="col">+60거래일</th><th scope="col">+120거래일</th><th scope="col">변동성<br>선거 전</th><th scope="col">변동성<br>선거 뒤</th><th scope="col">비율<br>(평소 백분위)</th><th scope="col">60일<br>최대 낙폭</th><th scope="col">같은 시기</th></tr></thead>
    <tbody>${rows.map((e) => {
      const m = e.m[S.asset];
      return `<tr aria-selected="${e.id === S.sel}"><th scope="row"><button type="button" data-id="${e.id}">${esc(e.label)}</button><small>${ymd(e.date)}</small></th>
        <td>${ymd(m.t0, true)}</td>${td(m.ret[1], 2, pc(m.pct.absDay1, m.pct.absDay1 > 90))}${td(m.ret[20], 1, pc(m.pct.ret20))}${td(m.ret[60], 1, pc(m.pct.ret60))}${td(m.ret[120], 1)}
        <td>${nf(m.volPre * 100, 1)}%</td><td>${nf(m.volPost * 100, 1)}%</td>
        <td>${nf(m.ratio, 2)}배${pc(m.pct.ratio, m.pct.ratio > 90 || m.pct.ratio < 10)}</td>
        ${m.mdd60 == null ? '<td class="na">—</td>' : `<td>${sgn(m.mdd60 * 100, 1)}${pc(m.pct.mdd60)}</td>`}
        <td class="note">${e.note ? esc(e.note) : ''}${m.avail < 120 ? `${e.note ? '<br>' : ''}자료 ${m.avail}거래일까지` : ''}</td></tr>`;
    }).join('')}</tbody></table>`;
  const excluded = D.elections.filter((e) => (S.kind === 'all' || e.kind === S.kind) && !e.m[S.asset]);
  $('#elTableM').textContent = `${a.name} · 최신 선거부터 · 백분위는 같은 계산을 모든 거래일에 했을 때의 위치입니다. 다음 거래일은 등락 크기 기준, 낙폭은 낮을수록 평소보다 깊게 빠졌다는 뜻.${excluded.length ? ` ${excluded.map((e) => e.label).join(', ')}은 ${S.asset === 'usdkrw' ? '자유변동환율제(1997년 12월 16일) 이전이 비교 구간에 들어가 뺐습니다' : '자료 시작 이전이라 뺐습니다'}.` : ''}`;
  $('#elTableWrap').onclick = (ev) => { const b = ev.target.closest('button[data-id]'); if (b) { S.sel = b.dataset.id; render(); } };
}

/* ── 자료와 방법 ── */
function method() {
  const k = D.assets.kospi, u = D.assets.usdkrw;
  $('#elMethod').innerHTML = `<dl>
    <dt>선거</dt><dd>1992년 이후 대통령 선거 8번, 국회의원 총선거 9번, 전국동시지방선거 9번(재·보궐선거 제외). 선거일은 위키데이터와 대조하고, 선거일이 평일 공휴일이라 코스피가 쉬었는지(전날·다음 날은 거래)로 다시 확인했습니다. 제15대 대통령 선거는 위키데이터에 1997년 12월 19일로 적혀 있으나 그날은 거래일이고 18일이 휴장이어서 18일로 바로잡았습니다.</dd>
    <dt>코스피</dt><dd>${esc(k.src)}. ${ymd(k.first)}~${ymd(k.last)}, ${k.days.toLocaleString('ko-KR')}거래일. 기준일은 ${esc(k.t0)}. 1998년까지는 토요일 거래가 있어 '거래일'의 달력 길이가 조금 짧습니다.</dd>
    <dt>원·달러</dt><dd>${esc(u.src)}. 원화가 시장에서 자유롭게 움직이기 시작한 1997년 12월 16일 이후만 비교합니다(그 전은 하루 변동폭이 묶인 시장평균환율제). 기준일은 ${esc(u.t0)}. 서울 외환시장 종가가 아니며, 미국 휴일에는 값이 없습니다. 마지막 값 ${ymd(u.last)}.</dd>
    <dt>변동성</dt><dd>하루 로그수익률의 표본 표준편차에 √250을 곱한 연율 값. 선거 전은 기준일까지 20거래일, 선거 뒤는 그다음 20거래일. 비율은 둘의 나눗셈이라 연율 상수와 무관합니다.</dd>
    <dt>평소 범위</dt><dd>같은 자료의 모든 거래일을 기준일로 삼아 똑같이 잰 값들의 분포(코스피 ${k.base.n.toLocaleString('ko-KR')}일, 원·달러 ${u.base.n.toLocaleString('ko-KR')}일). 경로의 띠는 120거래일 뒤까지 자료가 있는 날만 써서 기간에 따라 표본이 바뀌지 않게 했습니다.</dd>
    <dt>검정</dt><dd>‘선거 뒤가 더 출렁인 횟수’는 평소 그런 날의 비율을 성공 확률로 둔 정확 이항검정(양쪽), ‘평소 상위 10%’는 성공 확률 10%의 한쪽 검정입니다. 지표 2개 × 선거 묶음 4개를 함께 보므로 0.05를 8로 나눈 기준(0.00625)을 넘지 못하면 우연과 가릴 수 없다고 적습니다.</dd>
    <dt>한계</dt><dd>표본이 작고(묶음마다 6~9번), 2002년처럼 한 해에 두 선거가 겹치면 구간이 서로 포개집니다. 외환위기·세계 금융위기·코로나19처럼 같은 시기의 큰 사건이 결과를 좌우할 수 있어 표의 ‘같은 시기’에 적었습니다. 이 화면은 선거가 시장을 움직였는지 판정하지 않습니다.</dd>
    <dt>다시 만들기</dt><dd><code>node scripts/elections/build.mjs</code> — 원자료를 다시 받아 계산합니다. 자료 기준 ${ymd(D.asOf.slice(0, 10))}.</dd>
  </dl>`;
}

/* ── 툴팁 ── */
const tipEl = $('#elTip');
function tip(html, x, y) {
  tipEl.innerHTML = html; tipEl.hidden = false;
  const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  tipEl.style.left = `${Math.min(innerWidth - w - 10, Math.max(10, x + 14))}px`;
  tipEl.style.top = `${Math.min(innerHeight - h - 10, Math.max(10, y - h - 12))}px`;
}
function untip() { tipEl.hidden = true; }

/* ── 그리기 ── */
function basis() {
  const a = A();
  $('#elBasis').innerHTML = `<span>${a.name} <b>${ymd(a.first, true)}~${ymd(a.last, true)}</b></span><span>평소 비교 <b>${a.base.n.toLocaleString('ko-KR')}일</b></span><span>선거 <b>${pool().length}번</b></span><span>계산 ${ymd(D.asOf.slice(0, 10), true)}</span>`;
}
function render() {
  fixSel(); controls(); basis(); kpis(); pathChart(); card(); ratioChart(); table(); writeURL();
}

/* ── 모듈 페이지 공통: 테마 · 전체 메뉴 ── */
function shell() {
  const btn = $('#themeBtn');
  const label = () => { const dark = (document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark'; if (btn) btn.textContent = dark ? '밝게' : '어둡게'; return dark; };
  const toggle = () => { const next = label() ? 'light' : 'dark'; document.documentElement.dataset.theme = next; try { localStorage.setItem('theme', next); } catch { /* 저장 불가 */ } label(); };
  btn?.addEventListener('click', toggle); label();
  const sh = $('#moreSheet');
  $('#moreBtn')?.addEventListener('click', () => sh?.showModal());
  sh?.addEventListener('click', (e) => { if (e.target === sh || e.target.closest('[data-close-sheet]')) sh.close(); });
  $('#sheetRefresh')?.addEventListener('click', () => location.reload());
  $('#sheetTheme')?.addEventListener('click', toggle);
}

(async () => {
  shell();
  try {
    const r = await fetch('data/events.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error(`자료 ${r.status}`);
    D = await r.json();
  } catch (e) {
    $('#elKpis').innerHTML = `<p class="el-pm">자료를 불러오지 못했습니다. ${esc(e.message)}</p>`;
    return;
  }
  readURL(); method(); render();
  let w0 = 0;
  new ResizeObserver(() => { const w = $('#elPath').clientWidth; if (Math.abs(w - w0) > 8) { w0 = w; pathChart(); ratioChart(); } }).observe($('#elPath'));
})();
