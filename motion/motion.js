// 국정 한눈에 · 모션 계층 (의존성 0) — 기존 app.js 를 고치지 않고, DOM 이 바뀌는 순간에 반응한다.
// 원칙: 실제로 값이 바뀐 요소만 움직인다 · 처음 그리는 장면은 한 번만 · 줄인 움직임 설정이나 숨은 탭이면 즉시 최종 상태.
// 다른 모듈(오늘의 브리핑·공직자 재산 동향)은 이 파일의 내보낸 도구를 그대로 쓴다.

const root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
export const still = () => reduced.matches || document.hidden;
const $ = (s, el = document) => el.querySelector(s);

// 토큰은 motion.css 한 곳에서 정하고 여기서는 읽기만 한다
export const T = { micro: 140, nav: 240, reveal: 420, content: 520, map: 720, data: 900 };
export const E = { out: 'cubic-bezier(.2,.7,.2,1)', in: 'cubic-bezier(.4,0,1,1)', inOut: 'cubic-bezier(.65,0,.35,1)', spring: 'cubic-bezier(.3,1.12,.55,1)' };
function readTokens() {
  const cs = getComputedStyle(root);
  for (const k of Object.keys(T)) {
    const v = cs.getPropertyValue(`--mo-${k}`).trim(), n = parseFloat(v);
    if (Number.isFinite(n)) T[k] = /ms$/.test(v) ? n : /s$/.test(v) ? n * 1000 : n;
  }
  for (const [k, name] of [['out', 'ease-out'], ['in', 'ease-in'], ['inOut', 'ease-in-out'], ['spring', 'ease-spring']]) {
    const v = cs.getPropertyValue(`--mo-${name}`).trim();
    if (v) E[k] = v;
  }
}

/* ── 숫자: 자리수·단위·부호를 지킨 채 이전 값에서 새 값으로 ── */
const NUM = /[−-]?\d[\d,]*(?:\.\d+)?/;
export function parseNum(text) {
  const m = String(text ?? '').match(NUM);
  if (!m) return null;
  const raw = m[0], neg = /^[−-]/.test(raw);
  const v = Number(raw.replace(/^[−-]/, '').replace(/,/g, '')) * (neg ? -1 : 1);
  return Number.isFinite(v) ? { v, raw, index: m.index, dec: (raw.split('.')[1] || '').length, comma: raw.includes(','), minus: raw[0] === '-' ? '-' : '−' } : null;
}
export function formatLike(v, p) {
  const s = Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: p.dec, maximumFractionDigits: p.dec, useGrouping: p.comma });
  return (v < 0 && Number(s.replace(/,/g, '')) !== 0 ? p.minus : '') + s;
}
const tweens = new WeakMap();
// node: 텍스트 노드. 값이 같거나 이전 값을 모르면 움직이지 않는다(가짜 변동 금지).
export function tweenNumber(node, finalText, from, dur = T.data * 0.8) {
  cancelAnimationFrame(tweens.get(node));
  const p = parseNum(finalText);
  if (!p || from == null || !Number.isFinite(from) || from === p.v || still()) { node.data = finalText; return false; }
  const pre = finalText.slice(0, p.index), post = finalText.slice(p.index + p.raw.length), t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / dur), e = 1 - (1 - k) ** 3;
    node.data = k < 1 ? pre + formatLike(from + (p.v - from) * e, p) + post : finalText;
    if (k < 1) tweens.set(node, requestAnimationFrame(step));
  };
  node.data = pre + formatLike(from, p) + post;
  tweens.set(node, requestAnimationFrame(step));
  return true;
}
const firstText = (el) => { if (!el) return null; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (NUM.test(n.data) ? 1 : 3) }); return w.nextNode(); };

// app.js 의 countUp 을 대신한다(통합 패치가 한 줄로 연결). 첫 화면은 실제 값으로 '정착'만, 갱신 때는 바뀐 값만.
const countPrev = new Map();
let firstPaint = true;
export function countUp(rootEl) {
  if (!rootEl) return;
  rootEl.querySelectorAll('[data-count]').forEach((el, i) => {
    const key = `${rootEl.id}:${i}`, to = Number(el.dataset.count), prev = countPrev.get(key);
    countPrev.set(key, to);
    const node = firstText(el);
    if (!node || !Number.isFinite(to)) return;
    tweenNumber(node, node.data, prev ?? (firstPaint ? to * 0.9 : null), prev == null ? T.data : T.data * 0.8);
  });
  firstPaint = false;
}

/* ── 순위·목록: 같은 항목은 제자리에서 새 자리로 미끄러지고, 막대는 이전 길이에서 늘거나 준다 ── */
export function flipList(list, keyOf, { bars = [] } = {}) {
  if (!list || list.__mo) return;
  list.__mo = true;
  let snap = null, timer = 0;
  const visible = () => list.isConnected && list.getClientRects().length > 0;
  const take = () => {
    if (!visible()) return;
    const base = list.getBoundingClientRect();
    snap = new Map();
    [...list.children].forEach((li, i) => {
      const k = keyOf(li);
      if (!k) return;
      const r = li.getBoundingClientRect();
      snap.set(k, { i, x: r.left - base.left, y: r.top - base.top, bars: bars.map((s) => li.querySelector(s)?.getBoundingClientRect().width ?? null) });
    });
  };
  const later = (ms = 60) => { clearTimeout(timer); timer = setTimeout(take, ms); };
  new MutationObserver(() => {
    const prev = snap;
    if (!prev?.size || still() || !visible()) return later();
    const base = list.getBoundingClientRect();
    [...list.children].forEach((li, i) => {
      const k = keyOf(li), old = k && prev.get(k);
      if (!old) { if (k) li.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: T.reveal, easing: E.out, delay: Math.min(i * 30, 240), fill: 'backwards' }); return; }
      const r = li.getBoundingClientRect(), dx = old.x - (r.left - base.left), dy = old.y - (r.top - base.top);
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
        // 교차하는 행이 글자째 겹쳐 보이지 않게: 움직이는 동안 지면 배경을 깔고, 오르는 행을 위에 둔다
        li.classList.add('mo-moving'); li.style.zIndex = old.i > i ? '3' : '2';
        li.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: T.data, easing: E.spring })
          .finished.catch(() => {}).finally(() => { li.classList.remove('mo-moving'); li.style.zIndex = ''; });
      }
      if (old.i !== i) { li.classList.add(i < old.i ? 'mo-rise' : 'mo-fall'); setTimeout(() => li.classList.remove('mo-rise', 'mo-fall'), 1700); }
      bars.forEach((s, b) => {
        const bar = li.querySelector(s), w0 = old.bars[b];
        if (!bar || w0 == null) return;
        const w1 = bar.getBoundingClientRect().width;
        if (w1 > 0.5 && Math.abs(w1 - w0) > 1) bar.animate([{ transform: `scaleX(${Math.max(0.001, w0 / w1)})` }, { transform: 'none' }], { duration: T.data, easing: E.out });
      });
    });
    later(T.data + 80);
  }).observe(list, { childList: true });
  new ResizeObserver(() => later(200)).observe(list);
  list.addEventListener('load', () => later(120), true); // 썸네일이 늦게 오면 자리가 바뀐다
  take();
}

/* ── 활성 표시: 글자 폭에 맞춰 이전 탭에서 다음 탭으로 ── */
export function underline(container, { active, items = 'a, button', geom, cls = 'mo-ind', hover = true }) {
  if (!container || container.__mo) return;
  container.__mo = true;
  container.classList.add('mo-on');
  const mk = (c) => { const s = document.createElement('span'); s.className = c; s.setAttribute('aria-hidden', 'true'); container.appendChild(s); return s; };
  const ind = mk(cls), hov = hover && matchMedia('(hover: hover)').matches ? mk('mo-hov') : null;
  const textGeom = (a) => { const cs = getComputedStyle(a), pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0; return { x: a.offsetLeft + pl, w: a.offsetWidth - pl - pr }; };
  const g = geom || textGeom;
  const place = (node, el, jump) => {
    const { x, w } = g(el);
    if (!(w > 0)) return false;
    if (jump) node.classList.add('mo-jump');
    node.style.transform = `translateX(${x.toFixed(1)}px) scaleX(${(w / 100).toFixed(4)})`;
    if (jump) { void node.offsetWidth; node.classList.remove('mo-jump'); }
    return true;
  };
  let placed = false, last = null;
  const sync = () => {
    const a = active(container);
    ind.style.opacity = a ? '' : '0';
    if (!a) return;
    placed = place(ind, a, !placed || still()) || placed;
    if (a !== last && last && container.scrollWidth > container.clientWidth) {
      const l = a.offsetLeft, r = l + a.offsetWidth;
      if (l < container.scrollLeft || r > container.scrollLeft + container.clientWidth) container.scrollTo({ left: Math.max(0, l - 24), behavior: still() ? 'auto' : 'smooth' });
    }
    last = a;
  };
  new MutationObserver(sync).observe(container, { subtree: true, attributes: true, attributeFilter: ['aria-selected', 'aria-current', 'data-on', 'hidden'] });
  new ResizeObserver(() => { placed = false; sync(); }).observe(container);
  document.fonts?.ready.then(() => { placed = false; sync(); });
  if (hov) {
    const show = (el) => {
      if (!el || el === active(container)) { hov.classList.remove('on'); return; }
      place(hov, el, !hov.classList.contains('on') || still());
      hov.classList.add('on');
    };
    container.addEventListener('pointerover', (e) => { if (e.pointerType === 'mouse') show(e.target.closest(items)); });
    container.addEventListener('pointerleave', () => hov.classList.remove('on'));
    container.addEventListener('focusin', (e) => { if (e.target.matches?.(':focus-visible')) show(e.target.closest(items)); });
    container.addEventListener('focusout', () => hov.classList.remove('on'));
  }
  sync();
}

/* ── 머리 막대: 읽어 내려가면 이름 막대를 접고, 올라오면 편다 ── */
function compactHeader() {
  const bar = $('header.bar'), views = $('nav.views');
  if (!bar) return;
  bar.classList.add('mo-sticky'); views?.classList.add('mo-sticky');
  let lastY = scrollY, acc = 0, on = false, ticking = false;
  const set = (v) => { if (v !== on) { on = v; root.classList.toggle('mo-compact', v); } };
  const popoverOpen = () => { try { return !!document.querySelector(':popover-open'); } catch { return false; } };
  const blocked = () => {
    const cs = getComputedStyle(bar);
    const kb = document.activeElement?.matches?.(':focus-visible') ? document.activeElement : null; // 키보드로 머리 안에 있을 때만 붙잡는다
    return !/sticky|fixed/.test(cs.position) || bar.classList.contains('search-open') || bar.contains(kb) || !!(kb && views?.contains(kb))
      || !!document.querySelector('dialog[open]') || popoverOpen();
  };
  const tick = () => {
    ticking = false;
    const y = Math.max(0, scrollY), dy = y - lastY;
    lastY = y;
    if (y < 120 || blocked()) { acc = 0; return set(false); }
    acc = (Math.sign(dy) === Math.sign(acc) ? acc : 0) + dy;
    if (acc > 28) set(true); else if (acc < -18) set(false);
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(tick); } }, { passive: true });
  document.addEventListener('focusin', (e) => { if (e.target.closest?.('header.bar, nav.views') && e.target.matches(':focus-visible')) set(false); });
  addEventListener('pointermove', (e) => { if (on && e.pointerType === 'mouse' && e.clientY < 14) set(false); }, { passive: true });
  new MutationObserver(() => { if (blocked()) set(false); }).observe(bar, { attributes: true, attributeFilter: ['class'] });
}

/* ── 전체 메뉴 시트: 뒤로 가기로 닫힌다(시트 안 링크로 화면을 옮긴 경우는 그 이동을 지킨다) ── */
function sheetHistory(sheet) {
  if (!sheet || sheet.__mo) return;
  sheet.__mo = true;
  let mine = false, viaLink = false;
  sheet.addEventListener('click', (e) => { viaLink = !!e.target.closest('a[href], [data-view]'); }, true);
  new MutationObserver(() => {
    if (sheet.open && !mine) { history.pushState({ ...(history.state || {}), moSheet: 1 }, ''); mine = true; viaLink = false; }
    else if (!sheet.open && mine) { mine = false; if (history.state?.moSheet && !viaLink) history.back(); }
  }).observe(sheet, { attributes: true, attributeFilter: ['open'] });
  addEventListener('popstate', () => { if (sheet.open && !history.state?.moSheet) { mine = false; sheet.close(); } });
}

/* ── 첫 장면: 시세 선이 그려지고, 시간대 막대가 서고, 패널이 중요도 순서로 떠오른다 ── */
function firstScene() {
  const t0 = performance.now(), early = () => performance.now() - t0 < 12000;
  const once = (sel, fn) => {
    const el = $(sel);
    if (!el) return;
    const mo = new MutationObserver(() => { if (!early()) return mo.disconnect(); if (fn(el)) mo.disconnect(); });
    mo.observe(el, { childList: true });
  };
  // 저장본 → 실시간 자료로 곧바로 다시 그려지면, 그리던 선을 처음부터 다시 그리지 않고 이어서 그린다(음수 지연)
  const drawn = {};
  const scene = (sel, ms, apply) => once(sel, (el) => {
    if (still()) return true;
    const t = performance.now();
    drawn[sel] ??= t;
    const lag = t - drawn[sel];
    if (lag > ms) return true;
    return apply(el, lag) && false;
  });
  scene('#markets', 1600, (el, lag) => {
    const svgs = el.querySelectorAll('.kpi svg');
    svgs.forEach((svg, i) => { svg.querySelector('path.line')?.setAttribute('pathLength', '1'); svg.style.setProperty('--mo-d', `${Math.min(i * 45, 400) - lag}ms`); svg.classList.add('mo-draw'); });
    return svgs.length > 0;
  });
  scene('#hours', 1000, (el, lag) => {
    const svg = el.querySelector('svg');
    if (!svg) return false;
    svg.querySelectorAll('rect.b').forEach((r, i) => r.style.setProperty('--mo-d', `${i * 14 - lag}ms`));
    svg.classList.add('mo-grow');
    return true;
  });
  // app.js 는 화면에 들어온 패널에 .in 을 붙인다 — 처음 몇 초 동안만 순서대로 시차를 준다
  const home = $('#v-home');
  if (!home || still()) return;
  let n = 0;
  const mo = new MutationObserver((recs) => {
    if (!early()) return mo.disconnect();
    for (const r of recs) if (r.target.classList?.contains('in') && r.target.classList.contains('rv') && !r.target.__moD) { r.target.__moD = 1; r.target.style.transitionDelay = `${Math.min(n++ * 70, 420)}ms`; }
  });
  mo.observe(home, { subtree: true, attributes: true, attributeFilter: ['class'] });
  setTimeout(() => { mo.disconnect(); home.querySelectorAll('.rv').forEach((p) => { p.style.transitionDelay = ''; }); }, 4000);
}

/* ── 시세 타일: 1분마다 새 값이 오면 값이 바뀐 타일만 숫자가 옮겨 간다 ── */
function markets() {
  const box = $('#markets');
  if (!box) return;
  const prev = new Map();
  const read = () => {
    box.querySelectorAll('.kpi').forEach((k) => {
      const key = k.querySelector('.kpi-n')?.textContent.trim();
      if (!key) return;
      for (const [sel, sub] of [['.kpi-p', 'p'], ['.kpi-c', 'c']]) {
        const node = firstText(k.querySelector(sel)), p = node && parseNum(node.data);
        if (!p) continue;
        const was = prev.get(`${key}|${sub}`);
        prev.set(`${key}|${sub}`, p.v);
        if (was != null) tweenNumber(node, node.data, was, T.data * 0.8);
      }
    });
  };
  new MutationObserver(read).observe(box, { childList: true });
  read();
}

function init() {
  if (window.__moInit) return;
  window.__moInit = true;
  readTokens();
  window.__moCount = countUp;
  const views = $('nav.views .views-in');
  if (views) underline(views, { active: (c) => c.querySelector('[aria-selected="true"]'), items: 'a' });
  const tab = $('nav.tabbar');
  if (tab) underline(tab, { active: (c) => c.querySelector('[aria-current="page"], button[data-on]'), items: 'a, button', cls: 'mo-tab-ind', hover: false, geom: (a) => ({ x: a.offsetLeft + a.offsetWidth * 0.28, w: a.offsetWidth * 0.44 }) });
  compactHeader();
  sheetHistory($('#moreSheet'));
  markets();
  firstScene();
  const href = (li) => li.querySelector('a[href]')?.getAttribute('href') || null;
  flipList($('#top'), href, { bars: ['.track i'] });
  flipList($('#lead'), href);
  flipList($('#keywords'), (li) => li.querySelector('[data-kw]')?.dataset.kw || null, { bars: ['.bar i'] });
  flipList($('#signals'), (li) => li.querySelector('.t')?.textContent || null);
  flipList($('#volume'), (li) => li.querySelector('[data-sec]')?.dataset.sec || null, { bars: ['.track i'] });
  flipList($('#storyBars'), (li) => li.querySelector('[data-open]')?.dataset.open || null, { bars: ['.sb'] });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
