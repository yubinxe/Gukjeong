// 국정 한눈에 · 공용 계층 (의존성 0) — 자동 갱신 상태 · 신규 기사 · 읽던 자리 지키기 · 반응형 추이 차트
// app.js 는 통합 스크립트가 꽂은 짧은 고리(window.__gk*)와 'gk:data' 사건으로만 이 파일과 만난다. 이 파일이 없으면 app.js 는 원래대로 돈다.
import { newArticles, snapshotOf, statusOf, multiLineSVG, seriesFromData } from './lib.mjs?v=1';

const $ = (id) => document.getElementById(id);
const SEEN = 'gk-seen-v1';
const read = () => { try { return JSON.parse(localStorage.getItem(SEEN) || 'null'); } catch { return null; } };
const write = (v) => { try { localStorage.setItem(SEEN, JSON.stringify(v)); } catch { /* 저장 공간 부족·사생활 보호 모드 */ } };

/* ── 읽던 자리 지키기: 다시 그려도 보고 있던 항목이 화면의 같은 높이에 남는다 ── */
const KEYED = '[data-open],[data-rel],[id]';
function anchorNow() {
  if (scrollY < 40) return null;
  const top = (document.querySelector('header.bar')?.getBoundingClientRect().bottom || 0) + 8;
  for (const el of document.querySelectorAll(`main ${KEYED}`)) {
    const r = el.getBoundingClientRect();
    if (r.height && r.bottom > top && r.top >= top - 4 && r.top < innerHeight) {
      const sel = el.dataset.open ? `[data-open="${CSS.escape(el.dataset.open)}"]` : el.dataset.rel ? `[data-rel="${CSS.escape(el.dataset.rel)}"]` : `#${CSS.escape(el.id)}`;
      return { sel, top: r.top };
    }
  }
  return null;
}
function keep(fn) {
  const a = anchorNow(), y0 = scrollY, html = document.documentElement;
  const prev = html.style.overflowAnchor;
  html.style.overflowAnchor = 'none'; // 브라우저 자동 보정과 겹치지 않게
  try { fn(); } finally {
    if (a) {
      const el = document.querySelector(`main ${a.sel}`);
      if (el) { const d = el.getBoundingClientRect().top - a.top; if (Math.abs(d) > 1) scrollTo({ top: scrollY + d, behavior: 'instant' }); }
      else if (Math.abs(scrollY - y0) > 1) scrollTo({ top: y0, behavior: 'instant' });
    }
    html.style.overflowAnchor = prev;
  }
}

/* ── 상태 표시: '최종 수집 12:20 · 신규 8건 · 정상' ── */
let cur = null, fresh = null; // fresh: { gen, n } — 이 세대에서 실제로 센 신규 기사 수
function paint() {
  const st = statusOf(cur);
  const dot = $('gkSt'), nw = $('gkNew'), live = $('gkLive');
  if (dot) { dot.dataset.s = st.key; dot.title = `수집 상태: ${st.label}`; }
  if (nw) {
    const n = fresh && cur && fresh.gen === cur.generatedAt ? fresh.n : null;
    nw.hidden = n == null && st.key === 'ok';
    nw.textContent = [n != null ? (n ? `신규 ${n.toLocaleString('ko-KR')}건` : '신규 없음') : '', st.key === 'ok' ? '' : st.label].filter(Boolean).join(' · ');
    nw.dataset.s = st.key;
  }
  if (live) live.textContent = cur ? `수집 상태 ${st.label}` : '';
}
function onData({ d, prev }) {
  if (!d?.sections) return;
  cur = d;
  if (!d.stale) {
    const base = prev && !prev.stale ? snapshotOf(prev) : read();
    const n = newArticles(d, base);
    const saved = read();
    if (n != null) fresh = { gen: d.generatedAt, n };
    else if (saved?.gen === d.generatedAt && saved.fresh?.gen === d.generatedAt) fresh = saved.fresh; // 새로고침해도 같은 세대면 같은 수
    if (!saved || Date.parse(d.generatedAt) >= Date.parse(saved.gen)) write({ ...snapshotOf(d), fresh });
    if (n && prev && scrollY > 480) pill(n);
  }
  paint();
}
addEventListener('gk:data', (e) => onData(e.detail || {}));
setInterval(() => { if (!document.hidden) paint(); }, 30 * 1000);

/* ── 새 기사 알림: 아래로 읽는 중이면 위로 끌어올리지 않고 작은 표지만 ── */
let pillEl, pillT;
function pill(n) {
  if (!pillEl) {
    pillEl = document.createElement('button');
    pillEl.type = 'button'; pillEl.className = 'gk-pill';
    pillEl.addEventListener('click', () => { scrollTo({ top: 0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); hide(); });
    document.body.append(pillEl);
  }
  pillEl.textContent = `새 기사 ${n.toLocaleString('ko-KR')}건 · 맨 위로`;
  pillEl.dataset.on = '';
  clearTimeout(pillT); pillT = setTimeout(hide, 9000);
}
const hide = () => { if (pillEl) delete pillEl.dataset.on; };
addEventListener('scroll', () => { if (pillEl && scrollY < 200) hide(); }, { passive: true });

/* ── 부동산 추이 차트: 칸 폭에 맞춰 그린다 ── */
function mline(series, host) {
  const w = host?.clientWidth || 0;
  return w ? multiLineSVG(series, w) : null; // null → app.js 원래 그림
}
// 폭이 바뀌면 같은 자료로 다시 배치한다. svg 요소는 그대로 두고 속만 갈아 app.js 가 붙인 포인터 처리를 지킨다.
const ro = 'ResizeObserver' in window ? new ResizeObserver((ents) => {
  for (const ent of ents) {
    const host = ent.target, svg = host.querySelector('svg.gk-ml');
    if (!svg) continue;
    const w = Math.round(host.clientWidth);
    if (!w || Math.abs(w - Number(svg.dataset.cw)) < 8) continue;
    const t = document.createElement('div');
    t.innerHTML = multiLineSVG(seriesFromData(JSON.parse(svg.dataset.ml)), w);
    const nx = t.firstElementChild, oldMx = svg.querySelector('.mx');
    for (const k of ['viewBox', 'data-w', 'data-cw', 'style']) svg.setAttribute(k, nx.getAttribute(k));
    const kids = [...nx.childNodes];
    const newMx = nx.querySelector('.mx');
    if (oldMx && newMx) { for (const k of ['y1', 'y2']) oldMx.setAttribute(k, newMx.getAttribute(k)); kids[kids.indexOf(newMx)] = oldMx; }
    svg.replaceChildren(...kids);
  }
}) : null;
function watch() {
  const h = $('reTrend'); if (h && ro) ro.observe(h);
  // 월별 지도: 가로로 넘기는 좁은 화면이면 가장 최근 달이 보이게 오른쪽 끝에서 시작
  const heat = $('reHeat');
  if (heat) new MutationObserver(() => { if (heat.scrollWidth > heat.clientWidth + 4) heat.scrollLeft = heat.scrollWidth; }).observe(heat, { childList: true });
}

if (!window.__gkInit) {
  window.__gkInit = true;
  window.__gkKeep = keep;
  window.__gkMultiLine = mline;
  watch();
  if (window.__gkLast) onData(window.__gkLast); // app.js 가 이 파일보다 먼저 그린 첫 자료
  paint();
}
