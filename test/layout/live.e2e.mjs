// 자동 갱신 E2E — 통합 패치가 적용된 운영 사본에서 돈다 (Playwright, 시계 조작)
//   DEV_SITE_DIR=<운영 사본> node scripts/dev.mjs &   node test/layout/live.e2e.mjs http://localhost:8800
// 확인: ① 같은 판이면 다시 그리지 않는다 ② 새 판이면 직전 성공 스냅샷과 실제로 다른 기사 수만 '신규 N건'
//       ③ 다시 그려도 읽던 항목이 화면의 같은 높이 ④ 머리에 임기·취임 경과가 없다 ⑤ 1분 주기 요청은 재검증(no-cache)
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const base = process.argv[2] || 'http://localhost:8800';
const fx = JSON.parse(await readFile(new URL('../fixtures/dashboard-2026-10-27.json', import.meta.url), 'utf8'));
const T0 = Date.parse('2026-10-27T09:00:00Z');
const gen = (min) => new Date(T0 - min * 60000).toISOString();
// 판 B: 실제 기사 3건의 주소를 새 주소로 바꾼다 → 신규 3건이어야 한다 (추적 꼬리표만 다른 주소는 같은 기사로 친다)
const A = { ...fx, generatedAt: gen(2) };
const B = structuredClone({ ...fx, generatedAt: gen(-1) });
const flat = B.sections.flatMap((s) => s.items);
flat[0].link += '&new=1'; flat[5].link += '&new=2'; flat[9].link += '&new=3';
flat[12].link += (flat[12].link.includes('?') ? '&' : '?') + 'utm_source=x'; // 같은 기사

const results = [];
const ok = (name, fn) => { try { fn(); results.push(`✓ ${name}`); } catch (e) { results.push(`✗ ${name}: ${e.message}`); process.exitCode = 1; } };

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  await page.clock.install({ time: T0 });
  let serve = A; const seen = [];
  await page.route('**/api/dashboard*', (route) => {
    const r = route.request();
    seen.push({ url: r.url(), cache: r.headers()['cache-control'] || '', inm: r.headers()['if-none-match'] || '' });
    route.fulfill({ status: 200, contentType: 'application/json', headers: { etag: `W/"${serve.generatedAt}"`, 'cache-control': 'public, max-age=30' }, body: JSON.stringify(serve) });
  });
  await page.goto(`${base}/`);
  await page.waitForSelector('#lead li, #top li');
  await page.clock.runFor(2000);

  const head = await page.evaluate(() => ({
    status: document.querySelector('.status')?.innerText || '',
    banner: document.getElementById('banner-h')?.textContent || '',
    nav: document.getElementById('navTemp')?.textContent || '',
    dt: [...document.querySelectorAll('.status dt')].map((x) => x.textContent),
  }));
  ok('머리 상태에 임기·취임 경과 없음', () => { assert.ok(!/임기|취임/.test(head.status), head.status); assert.ok(!/취임/.test(head.banner), head.banner); });
  ok("'국정 온도' → '보도 집중도'", () => assert.ok(!head.nav.includes('국정 온도')));
  ok("'최종 수집' 칸", () => assert.ok(head.dt.includes('최종 수집'), head.dt.join(',')));
  const st0 = await page.getAttribute('#gkSt', 'data-s');
  ok('상태 점: 2분 된 자료 = 정상', () => assert.equal(st0, 'ok'));

  // ① 같은 판: 1분 뒤 확인해도 다시 그리지 않는다
  await page.evaluate(() => { document.querySelector('#lead li, #top li').dataset.mark = '1'; });
  const before = seen.length;
  await page.clock.runFor(61000);
  await page.waitForTimeout(300);
  const still = await page.evaluate(() => document.querySelector('#lead li, #top li').dataset.mark === '1');
  ok('1분 뒤 확인 요청이 나감', () => assert.ok(seen.length > before, `${before}→${seen.length}`));
  ok('주기 확인에 캐시 우회(?t=) 없음', () => assert.ok(seen.slice(before).every((x) => !/[?&]t=/.test(x.url)), seen.slice(before).map((x) => x.url).join(' ')));
  ok('같은 판이면 다시 그리지 않음', () => assert.ok(still));

  // ② ③ 새 판: 읽던 자리를 지키며 그리고, 실제 차이만큼 신규
  await page.evaluate(() => scrollTo(0, 900));
  await page.waitForTimeout(100);
  const anchor = await page.evaluate(() => {
    for (const el of document.querySelectorAll('main [data-open],main [data-rel]')) { const r = el.getBoundingClientRect(); if (r.top > 70 && r.top < innerHeight) return { sel: el.dataset.open ? `[data-open="${CSS.escape(el.dataset.open)}"]` : `[data-rel="${CSS.escape(el.dataset.rel)}"]`, top: r.top }; }
    return null;
  });
  serve = B;
  await page.clock.runFor(61000);
  await page.waitForFunction(() => !document.getElementById('gkNew').hidden, null, { timeout: 5000 }).catch(() => {});
  const after = await page.evaluate((a) => ({ text: document.getElementById('gkNew').textContent, mark: document.querySelector('#lead li, #top li').dataset.mark, top: a && document.querySelector(`main ${a.sel}`)?.getBoundingClientRect().top }), anchor);
  ok('새 판을 다시 그림', () => assert.notEqual(after.mark, '1'));
  ok('신규 기사 수 = 실제 차이 3건(추적 꼬리표만 다른 주소 제외)', () => assert.equal(after.text, '신규 3건'));
  ok('읽던 항목이 같은 높이(±2px)', () => { assert.ok(anchor, '기준 항목 없음'); assert.ok(Math.abs(after.top - anchor.top) <= 2, `${anchor.top} → ${after.top}`); });

  // 새로고침해도 같은 판이면 같은 수(기기에 남긴 직전 스냅샷 기준)
  await page.reload(); await page.waitForSelector('#lead li, #top li'); await page.clock.runFor(1500);
  const again = await page.evaluate(() => document.getElementById('gkNew').textContent);
  ok('새로고침 뒤에도 같은 판의 신규 수 유지', () => assert.equal(again, '신규 3건'));

  // 오래된 자료: 40분 지나면 '직전 자료'
  await page.clock.runFor(40 * 60000);
  const st1 = await page.getAttribute('#gkSt', 'data-s'), nw1 = await page.evaluate(() => document.getElementById('gkNew').textContent);
  ok("40분 지난 자료 = '직전 자료'", () => { assert.equal(st1, 'stale'); assert.match(nw1, /직전 자료/); });

  // ⑤ 실제 CDN: 같은 판을 재검증(no-cache)하면 304 로 본문 없이 끝난다 (운영 주소, 읽기만)
  if (process.argv.includes('--prod')) {
    const p2 = await (await browser.newContext()).newPage();
    await p2.goto('https://gukjeong-hannune.vercel.app/robots.txt').catch(() => {});
    const r = await p2.evaluate(async () => {
      const u = '/api/dashboard';
      await fetch(u, { cache: 'no-cache' }).then((x) => x.text());
      await fetch(u, { cache: 'no-cache' }).then((x) => x.text());
      const e = performance.getEntriesByType('resource').filter((x) => x.name.endsWith(u));
      return e.map((x) => ({ status: x.responseStatus, transfer: x.transferSize, body: x.encodedBodySize }));
    });
    // 304 로 재검증되면 브라우저는 저장본을 200 으로 넘겨준다 — 판정은 실제 전송량(머리말만 오감)으로 한다
    ok(`운영 CDN 재검증: 두 번째 요청 전송 ${r[1]?.transfer}B (첫 요청 ${r[0]?.transfer}B, 본문 ${r[1]?.body}B)`, () => { assert.ok(r[1] && r[1].transfer > 0 && r[1].transfer < 2000 && r[1].body > 10000); });
  }
} finally { await browser.close(); }
console.log(results.join('\n'));
