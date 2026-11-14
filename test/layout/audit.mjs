// 화면 겹침·잘림·가로 넘침 자동 검사 (Playwright, 실제 글자 영역 기준)
//   node test/layout/audit.mjs <기준 주소> [--view realty] [--out <폴더>] [--shots]
//   예) DEV_SITE_DIR=<운영 사본> node scripts/dev.mjs  →  node test/layout/audit.mjs http://localhost:8800 --view realty
// 판정: 서로 다른 글자 덩어리의 실제 글자 사각형이 2px 넘게 겹침 · 글자가 잘라 내는 조상 밖으로 나감 · 글자가 화면 가로 밖으로 나감 · 문서 가로 스크롤.
// 말줄임(text-overflow/line-clamp)과 가로 스크롤 칸 안의 글자는 의도된 것으로 본다. 고정 요소(아래 탭 막대 등)는 본문과 겹치는 것이 정상이라 뺀다.
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

export const CASES = [
  ...[320, 360, 375, 390, 430, 768, 1024, 1440].map((w) => ({ key: `light-${w}`, width: w, scheme: 'light' })),
  { key: 'dark-375', width: 375, scheme: 'dark' },
  { key: 'dark-1440', width: 1440, scheme: 'dark' },
  { key: 'zoom200-1440', width: 720, scheme: 'light', dsf: 2 }, // 1440 화면을 200% 확대하면 CSS 폭 720
  { key: 'zoom200-768', width: 384, scheme: 'light', dsf: 2 },
];
const SCOPES = { realty: ['header.bar', '#v-realty'], home: ['header.bar', 'nav.views', '#v-home'] };
const READY = { realty: '#reTrend svg, #reTrend .empty', home: '#lead li, #top li' };

// 브라우저 안에서 돈다
function inspect(scopeSel) {
  const vw = innerWidth;
  const isFixed = (el) => { for (let e = el; e; e = e.parentElement) { const p = getComputedStyle(e).position; if (p === 'fixed') return true; } return false; };
  const shown = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
      if (e.classList?.contains('visually-hidden') || s.clipPath === 'inset(50%)') return false;
      if (e.hidden) return false;
    }
    return true;
  };
  const label = (el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : ''}`;
  const runs = [];
  // 불투명 배경의 sticky 칸(가로 스크롤 표의 첫 열 등)은 지나가는 내용을 덮는 것이 정상이다
  const coverOf = (el) => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.position === 'sticky') { const m = s.backgroundColor.match(/rgba?\(([^)]+)\)/); const a = m ? (m[1].split(',')[3] ?? '1') : '0'; return Number(a) >= 0.99 ? e : null; }
    }
    return null;
  };
  for (const sel of scopeSel) for (const root of document.querySelectorAll(sel)) {
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
    for (let n; (n = tw.nextNode());) {
      const el = n.parentElement;
      if (!el || !shown(el) || isFixed(el)) continue;
      const r = document.createRange(); r.selectNodeContents(n);
      // 잘라 내는 조상(overflow ≠ visible) 안에서 보이는 부분만 비교한다.
      // 말줄임(line-clamp·ellipsis)·스크롤 칸이 자른 것은 의도, 그 밖의 조상이 글자 일부를 자르면 '잘림'.
      const clips = [];
      // 절대 위치 요소는 자기 포함 블록(가장 가까운 위치 지정 조상)까지의 중간 조상에게 잘리지 않는다 — CSS 규칙 그대로 따른다
      let escaping = false;
      for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
        const s = getComputedStyle(e);
        if (escaping) { if (s.position === 'static' && s.transform === 'none' && s.contain === 'none') continue; escaping = false; }
        if (e !== el && s.position === 'fixed') break;
        const clamp = (s.webkitLineClamp && s.webkitLineClamp !== 'none') || s.textOverflow === 'ellipsis';
        const scroll = /auto|scroll/.test(s.overflowX + s.overflowY);
        if (clamp || scroll || /hidden|clip/.test(s.overflowX + s.overflowY)) clips.push({ e, r: e.getBoundingClientRect(), ok: clamp || scroll });
        if (s.position === 'absolute') escaping = true;
      }
      for (const q of r.getClientRects()) {
        if (!(q.width > 0.5 && q.height > 0.5)) continue;
        let x0 = q.left, x1 = q.right, y0 = q.top, y1 = q.bottom, cut = null;
        for (const c of clips) {
          const nx0 = Math.max(x0, c.r.left), nx1 = Math.min(x1, c.r.right), ny0 = Math.max(y0, c.r.top), ny1 = Math.min(y1, c.r.bottom);
          if (nx1 - nx0 < 1 || ny1 - ny0 < 1) { x1 = x0; break; } // 통째로 가려짐: 보이지 않으니 비교하지 않는다
          const lost = Math.max(nx0 - x0, x1 - nx1, ny0 - y0, y1 - ny1);
          if (lost > 1.5 && !c.ok && !cut) cut = `${label(c.e)} 밖으로 ${Math.round(lost)}px`;
          x0 = nx0; x1 = nx1; y0 = ny0; y1 = ny1;
        }
        if (x1 - x0 < 1) continue;
        runs.push({ n, el, x0, x1, y0, y1, cut, cover: coverOf(el), inScroll: clips.some((c) => c.ok && /auto|scroll/.test(getComputedStyle(c.e).overflowX)), t: n.data.trim().slice(0, 18) });
      }
    }
  }
  const issues = [];
  // 0) 낱자 분해: 세 글자 넘는 말이 줄마다 한두 글자씩 쪼개져 세로로 쌓인 경우(칸이 너무 좁음)
  const byNode = new Map();
  for (const g of runs) byNode.set(g.n, (byNode.get(g.n) || 0) + 1);
  for (const [n, lines] of byNode) {
    const len = n.data.replace(/\s/g, '').length;
    if (len >= 3 && lines >= 3 && len / lines < 2.5 && !n.parentElement.closest('svg')) issues.push({ kind: 'shred', a: `${label(n.parentElement)}「${n.data.trim().slice(0, 18)}」`, b: `${lines}줄로 쪼개짐` });
  }
  // 1) 글자끼리 겹침 — 위에서 아래로 훑으며 가까운 것만 비교
  runs.sort((a, b) => a.y0 - b.y0);
  for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length && runs[j].y0 < runs[i].y1; j++) {
    const a = runs[i], b = runs[j];
    if (a.n === b.n) continue;
    if ((a.cover || b.cover) && a.cover !== b.cover) continue;
    const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    // 줄 높이 여백 때문에 위아래 줄 상자가 살짝 닿는 것은 겹침이 아니다: 작은 쪽 높이의 25% 이상 겹쳐야 본다
    if (ix > 2 && iy > Math.max(2, 0.25 * Math.min(a.y1 - a.y0, b.y1 - b.y0))) issues.push({ kind: 'overlap', a: `${label(a.el)}「${a.t}」`, b: `${label(b.el)}「${b.t}」`, px: Math.round(Math.min(ix, iy)) });
  }
  // 2) 잘림·화면 밖
  for (const g of runs) {
    if (g.cut) issues.push({ kind: 'clip', a: `${label(g.el)}「${g.t}」`, b: g.cut });
    else if (!g.inScroll && (g.x1 > vw + 1 || g.x0 < -1)) issues.push({ kind: 'offscreen', a: `${label(g.el)}「${g.t}」`, b: `x ${Math.round(g.x0)}~${Math.round(g.x1)} / 화면 ${vw}` });
  }
  const docOverflow = Math.max(0, document.documentElement.scrollWidth - vw);
  if (docOverflow > 0) issues.push({ kind: 'hscroll', a: 'document', b: `${docOverflow}px 가로 넘침` });
  // 같은 문제를 한 번만
  const seen = new Set();
  return { runs: runs.length, issues: issues.filter((x) => { const k = `${x.kind}|${x.a}|${x.b}`; if (seen.has(k)) return false; seen.add(k); return true; }) };
}

export async function audit(base, { view = 'realty', out = null, shots = false, cases = CASES } = {}) {
  const browser = await chromium.launch();
  const report = {};
  try {
    for (const c of cases) {
      const ctx = await browser.newContext({ viewport: { width: c.width, height: c.dsf ? 450 : 900 }, deviceScaleFactor: c.dsf || 1, colorScheme: c.scheme, reducedMotion: 'reduce', isMobile: c.width < 760, hasTouch: c.width < 760 });
      const page = await ctx.newPage();
      await page.goto(`${base}/${view === 'home' ? '' : `?v=${view}`}`, { waitUntil: 'load' });
      await page.waitForSelector(READY[view], { timeout: 30000 }).catch(() => {});
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(1200);
      const r = await page.evaluate(inspect, SCOPES[view]);
      report[c.key] = { ...r, count: r.issues.length };
      if (out && shots) await page.screenshot({ path: `${out}/${view}-${c.key}.png`, fullPage: true });
      await ctx.close();
    }
  } finally { await browser.close(); }
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const base = process.argv[2];
  if (!base) { console.error('사용법: node test/layout/audit.mjs <기준 주소> [--view realty|home] [--out 폴더] [--shots]'); process.exit(2); }
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const view = arg('--view') || 'realty', out = arg('--out');
  if (out) await mkdir(out, { recursive: true });
  const report = await audit(base, { view, out, shots: process.argv.includes('--shots') });
  if (out) await writeFile(`${out}/${view}-report.json`, JSON.stringify(report, null, 1));
  let total = 0;
  for (const [k, v] of Object.entries(report)) {
    total += v.count;
    console.log(`${v.count ? '✗' : '✓'} ${k.padEnd(14)} 글자 ${String(v.runs).padStart(4)}개 · 문제 ${v.count}`);
    for (const x of v.issues.slice(0, 6)) console.log(`    ${x.kind}: ${x.a} ⟷ ${x.b}${x.px ? ` (${x.px}px)` : ''}`);
    if (v.issues.length > 6) console.log(`    … 외 ${v.issues.length - 6}건`);
  }
  process.exit(total ? 1 : 0);
}
