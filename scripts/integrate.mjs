// 운영 소스(정적 홈)에 증분 모듈을 잇는다 — 모션 계층 · 공용 계층(자동 갱신·상태·겹침 수정) · 오늘의 브리핑 · 공직자 재산 동향.
//   node scripts/integrate.mjs <운영 소스 폴더>          바꿀 내용을 보여 주고 적용
//   node scripts/integrate.mjs <운영 소스 폴더> --dry    보여 주기만
// 기존 메뉴는 지우거나 옮기지 않는다. 아래 탭 막대(휴대폰)는 지금 구성을 그대로 두고, 새 메뉴는 위쪽 탭 줄과 '더보기' 시트에 넣는다.
// 기준 표지를 못 찾으면 아무것도 쓰지 않고 멈춘다. 두 번 돌려도 결과가 같다.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { rebrand, OLD as OLD_NAME, NEW as NEW_NAME } from "./brand.mjs";

const MOTION_V = "1", CORE_V = "1";
export const MENUS = [
  { href: "/briefing/", label: "오늘의 브리핑", sub: "요약 · 해석 · 묻고 답하기", after: "home" },
  { href: "/officials/", label: "공직자 재산 동향", sub: "국회의원 재산공개 · 지역 분포 · 대수 비교", after: "policy" },
  { href: "/elections/", label: "선거 후 시장", sub: "선거 뒤 코스피·환율 변동성 · 1992년 이후 26번", after: "street" },
];

function must(re, text, what) {
  const m = text.match(re);
  if (!m) throw new Error(`기준 표지를 찾지 못함: ${what} — 운영 index.html 구조가 바뀌었는지 확인`);
  return m;
}

export function patchIndex(html) {
  const changes = [];
  if (!html.includes("/motion/motion.css")) {
    const css = must(/(<link rel="stylesheet" href="assets\/style\.css[^"]*">)/, html, "assets/style.css 링크");
    html = html.replace(css[1], `${css[1]}\n<link rel="stylesheet" href="/motion/motion.css?v=${MOTION_V}">`);
    const js = must(/(<script type="module" src="assets\/app\.js[^"]*"><\/script>)/, html, "assets/app.js 스크립트");
    html = html.replace(js[1], `${js[1]}\n<script type="module" src="/motion/motion.js?v=${MOTION_V}"></script>`);
    changes.push("머리: 모션 계층(motion.css · motion.js) 연결");
  }
  if (!html.includes("/core/core.css")) {
    html = html.replace(/(<link rel="stylesheet" href="\/motion\/motion\.css[^"]*">)/, `$1\n<link rel="stylesheet" href="/core/core.css?v=${CORE_V}">`);
    html = html.replace(/(<script type="module" src="\/motion\/motion\.js[^"]*"><\/script>)/, `$1\n<script type="module" src="/core/core.js?v=${CORE_V}"></script>`);
    changes.push("머리: 공용 계층(core.css · core.js) 연결");
  }
  const term = '<div><dt>임기</dt><dd id="term">-</dd></div>';
  if (html.includes(term)) {
    html = html.replace(term, '<div hidden><dt>임기</dt><dd id="term">-</dd></div>');
    changes.push("머리 상태: 임기·취임 경과 칸 숨김(자리 순서 유지)");
  }
  if (!html.includes('id="gkSt"')) {
    const upd = must(/<div><dt>갱신<\/dt><dd>(<button type="button" class="upd-btn" id="refreshBtn"[^>]*>)(<span id="updated">-<\/span>[\s\S]*?<\/button>)<\/dd><\/div>/, html, "머리 상태 '갱신' 칸");
    html = html.replace(upd[0], `<div><dt>최종 수집</dt><dd>${upd[1]}<i class="gk-st" id="gkSt" aria-hidden="true"></i>${upd[2]}<span class="gk-new" id="gkNew" hidden></span><span class="visually-hidden" id="gkLive" aria-live="polite"></span></dd></div>`);
    changes.push("머리 상태: '최종 수집 시각 · 신규 N건 · 상태' 표시 자리");
  }
  if (!html.includes('property="og:image"')) {
    const loc = must(/(<meta property="og:url" content="[^"]*">)/, html, "og:url 메타");
    html = html.replace(loc[1], `${loc[1]}\n<meta property="og:image" content="https://gukjeong-hannune.vercel.app/og/site.png">\n<meta property="og:image:width" content="1200">\n<meta property="og:image:height" content="630">\n<meta name="twitter:card" content="summary_large_image">`);
    changes.push("머리: 공유 이미지(og/site.png 1200×630) 연결");
  }
  if (html.includes('<span class="nt-k">국정 온도</span>')) {
    html = html.replace('<span class="nt-k">국정 온도</span>', '<span class="nt-k">보도 집중도</span>');
    changes.push("위쪽 탭 줄: '국정 온도' → '보도 집중도'(국정 평가로 읽히지 않게)");
  }
  for (const m of MENUS) {
    if (html.includes(`href="${m.href}"`)) continue;
    const top = must(new RegExp(`(<a href="[^"]*" role="tab" data-view="${m.after}"[^>]*>[^<]+</a>)`), html, `위쪽 탭 줄 data-view="${m.after}"`);
    html = html.replace(top[1], `${top[1]}\n    <a href="${m.href}" role="tab" aria-selected="false">${m.label}</a>`);
    const li = must(new RegExp(`(<li><a href="[^"]*" data-view="${m.after}">[\\s\\S]*?</li>)`), html, `전체 메뉴 data-view="${m.after}"`);
    html = html.replace(li[1], `${li[1]}\n      <li><a href="${m.href}"><b>${m.label}</b><span>${m.sub}</span></a></li>`);
    changes.push(`위쪽 탭 줄·전체 메뉴: '${m.label}' 추가`);
  }
  if (!html.includes('id="gfFlow"')) {
    const atlas = must(/\n    <section class="atlas" id="atlas"[\s\S]*?\n    <\/section>\n/, html, "해외 탭 세계 권력 지형 묶음")[0];
    let g = html.replace(atlas, "\n");
    const head = must(/(<section id="v-global"[^>]*>\s*<header class="vh">[\s\S]*?<\/header>)/, g, "해외 탭 머리")[1];
    g = g.replace(head, `${head}\n    <section class="gf" id="gfFlow" aria-labelledby="gf-h" aria-live="off"></section>`);
    const tail = must(/(<div id="globalBody" class="gt-body"><\/div>)(\n  <\/section>)/, g, "해외 탭 기사 목록 끝");
    html = g.replace(tail[0], `${tail[1]}${atlas.replace(/\n$/, "")}${tail[2]}`);
    changes.push("해외 탭: 머리 아래 '세계 보도 흐름' 자리, 세계 권력 지형은 기사 목록 아래로");
  }
  if (html.includes(OLD_NAME)) {
    html = rebrand(html);
    changes.push(`이름: '${OLD_NAME}' → '${NEW_NAME}'(제목·메타·머리·바닥글, 조사 맞춤)`);
  }
  return { html, changes };
}

// 모듈 페이지(브리핑·공직자 재산 동향)의 머리 탐색을 운영 홈과 똑같이 맞춘다 — 메뉴가 바뀌어도 한 번 돌리면 따라온다.
// <!-- shell:views --> … <!-- /shell:views --> 처럼 표지 사이만 갈아 끼운다. app.js 가 없는 페이지이므로 data-view 를 빼고 주소를 절대 경로로.
export const MODULE_PAGES = { "briefing/index.html": "/briefing/", "officials/index.html": "/officials/", "elections/index.html": "/elections/" };
export function shellBlocks(indexHtml, active) {
  const grab = (re, what) => must(re, indexHtml, what)[0];
  const abs = (h) => h.replace(/ data-view="[^"]*"/g, "").replace(/ data-home(?=[\s>])/g, "").replace(/href="\.\/"/g, 'href="/"').replace(/href="\?/g, 'href="/?');
  let views = abs(grab(/<nav class="views"[\s\S]*?<\/nav>/, "위쪽 탭 줄"))
    .replace(/\s*<a [^>]*class="nav-temp"[\s\S]*?<\/a>/, "")
    .replace(/aria-selected="true"/g, 'aria-selected="false"')
    .replace(new RegExp(`(<a href="${active}" role="tab") aria-selected="false"`), '$1 aria-selected="true"');
  const tabbar = abs(grab(/<nav class="tabbar"[\s\S]*?<\/nav>/, "아래 탭 막대")).replace(/ aria-current="page"/g, "").replace(/(<button type="button" id="moreBtn")/, "$1 data-on");
  const sheet = abs(grab(/<dialog id="moreSheet"[\s\S]*?<\/dialog>/, "전체 메뉴 시트")).replace(/ aria-current="page"/g, "").replace(new RegExp(`<a href="${active}">`), `<a href="${active}" aria-current="page">`);
  return { views, tabbar, sheet };
}
export function syncShell(pageHtml, indexHtml, active) {
  const blocks = shellBlocks(indexHtml, active);
  let out = pageHtml, n = 0;
  for (const [k, v] of Object.entries(blocks)) {
    const re = new RegExp(`(<!-- shell:${k} -->)[\\s\\S]*?(<!-- /shell:${k} -->)`);
    if (!re.test(out)) continue;
    const next = out.replace(re, `$1\n${v}\n$2`);
    if (next !== out) n++;
    out = next;
  }
  return { html: out, changed: n > 0 };
}

// app.js 고리: 정확히 한 번 나오는 문장만 바꾼다. 표지를 못 찾으면 아무것도 쓰지 않고 멈춘다(운영 코드가 바뀌었다는 뜻).
// 고리가 가리키는 window.__* 가 없으면(공용 계층을 안 실은 배포) 원래 동작 그대로다.
export const APP_PATCHES = [
  { id: "countUp", desc: "숫자 세기를 모션 계층에 연결(바뀐 값만 움직임)",
    find: "function countUp(root) {", repl: "function countUp(root) {\n  if (window.__moCount) return window.__moCount(root);" },
  { id: "poll", desc: "1분마다 조건부 확인(ETag → 바뀌지 않았으면 304, 본문 없음)",
    find: "const REFRESH_MS = 5 * 60 * 1000; // 서버 CDN 캐시(5분)와 맞춤",
    repl: "const REFRESH_MS = 60 * 1000; // gk:poll 조건부 확인 — 바뀌지 않았으면 서버가 304 로 본문 없이 답한다" },
  { id: "revalidate", desc: "자료 요청을 재검증(no-cache)으로 — 같은 판이면 다시 받지 않는다",
    find: "const res = await fetch(src, { cache: 'no-store', signal: AbortSignal.timeout(ms) });",
    repl: "const res = await fetch(src, { cache: /[?&]t=/.test(src) ? 'no-store' : 'no-cache', signal: AbortSignal.timeout(ms) }); // gk:revalidate" },
  { id: "sameGen", desc: "같은 세대 자료는 다시 그리지 않음(깜빡임·숫자 재생 방지)",
    find: "const newer = (d) => !state.data || Date.parse(d.generatedAt) >= Date.parse(state.data.generatedAt);",
    repl: "const newer = (d) => !state.data || Date.parse(d.generatedAt) > Date.parse(state.data.generatedAt) || (state.data.stale && !d.stale); // gk:sameGen" },
  { id: "show", desc: "새 자료를 읽던 자리를 지키며 그리고 'gk:data' 알림",
    find: "function show(d) { if (!newer(d)) return false; state.data = d; renderAll(); refreshQuotes(); return true; }",
    repl: "function show(d) { if (!newer(d)) return false; const prev = state.data; state.data = d; (window.__gkKeep || ((f) => f()))(renderAll); refreshQuotes(); window.__gkLast = { d, prev }; dispatchEvent(new CustomEvent('gk:data', { detail: window.__gkLast })); return true; }" },
  { id: "saveOnce", desc: "같은 판을 1분마다 기기에 다시 저장하지 않음",
    find: "const livePromise = fetchData(live).then((d) => { show(d); saveDash(d); freshenInBackground(d); return true; }).catch(() => false);",
    repl: "const livePromise = fetchData(live).then((d) => { if (show(d)) saveDash(d); freshenInBackground(d); return true; }).catch(() => false); // gk:saveOnce" },
  { id: "noBuster", desc: "뒤에서 새로 받기에 캐시 우회(?t=) 제거 — 낡은 화면마다 서버 전체 재생성(약 20초)을 일으키지 않게",
    find: "fetchData(`/api/dashboard?t=${Date.now()}`, 55000).then((n) => { if (!n.stale && show(n)) saveDash(n); }).catch(() => {});",
    repl: "fetchData('/api/dashboard', 55000).then((n) => { if (!n.stale && show(n)) saveDash(n); }).catch(() => {}); // gk:noBuster" },
  { id: "forceEvt", desc: "직접 새로고침도 'gk:data' 알림",
    find: "state.data = d; renderAll(); refreshQuotes(); saveDash(d); bgAt = Date.now();",
    repl: "const prev = state.data; state.data = d; (window.__gkKeep || ((f) => f()))(renderAll); refreshQuotes(); saveDash(d); bgAt = Date.now(); window.__gkLast = { d, prev }; dispatchEvent(new CustomEvent('gk:data', { detail: window.__gkLast }));" },
  { id: "ago", desc: "갱신 시각의 '(N분 전)'을 좁은 화면에서 접을 수 있게",
    find: "$('updated').textContent = `${fmt.hm.format(new Date(d.generatedAt))} (${ago(d.generatedAt)})`;",
    repl: "$('updated').innerHTML = `${fmt.hm.format(new Date(d.generatedAt))}<span class=\"gk-ago\"> (${esc(ago(d.generatedAt))})</span>`;" },
  { id: "banner", desc: "첫 화면 제목에서 취임 경과 제거(날짜만)",
    find: "$('banner-h').textContent = `${fmt.date.format(new Date())}, ${$('term').textContent}`;",
    repl: "$('banner-h').textContent = fmt.date.format(new Date()); // gk:banner" },
  { id: "globalEvt", desc: "해외 자료를 받으면 'gk:global' 알림(세계 보도 흐름이 같은 자료를 쓴다 — 두 번 받지 않음)",
    find: "      gstate.data = d; gstate.at = Date.now();\n      break;",
    repl: "      gstate.data = d; gstate.at = Date.now(); window.__gkGlobal = d; dispatchEvent(new CustomEvent('gk:global', { detail: d }));\n      break;" },
  { id: "atlasLazy", desc: "세계 권력 지형(지도)은 아래로 옮겼으므로 화면 가까이 왔을 때 불러옴",
    find: "  if (v === 'global') { loadGlobal(); mountAtlasLazy(); }",
    repl: "  if (v === 'global') { loadGlobal(); const at = $('atlas'); if (atlasMod || !at || !('IntersectionObserver' in window)) mountAtlasLazy(); else if (!at.__io) { at.__io = new IntersectionObserver((en) => { if (en.some((x) => x.isIntersecting)) { at.__io.disconnect(); at.__io = null; mountAtlasLazy(); } }, { rootMargin: '200px 0px' }); at.__io.observe(at); } } // gk:atlasLazy" },
  { id: "mline", desc: "부동산 추이 차트를 칸 폭에 맞춰 그림(이름표·눈금 겹침 방지)",
    find: "function multiLine(series, { W = 520, H = 230, pt = 16, pb = 40 } = {}) {",
    repl: "function multiLine(series, { W = 520, H = 230, pt = 16, pb = 40 } = {}) {\n  const gk = window.__gkMultiLine?.(series, $('reTrend')); if (gk) return gk;" },
];
export function patchApp(js) {
  const changes = [];
  for (const p of APP_PATCHES) {
    if (js.includes(p.repl)) continue;
    const n = js.split(p.find).length - 1;
    if (n !== 1) throw new Error(`기준 표지를 찾지 못함: app.js ${p.id} (${n}곳) — 운영 app.js 가 바뀌었는지 확인`);
    js = js.replace(p.find, () => p.repl);
    changes.push(`app.js: ${p.desc}`);
  }
  if (js.includes(OLD_NAME)) { js = rebrand(js); changes.push(`app.js: 이름 '${NEW_NAME}'(복사 문구 등)`); }
  return { js, changes };
}

// style.css: 지도 시간 막대의 눈금(.tk)이 부동산 '많이 나온 말' 목록(ol.tk)까지 떠 있게 만들던 이름 충돌을 범위로 묶는다
export const STYLE_PATCHES = [
  { id: "tk", desc: "지도 눈금 .tk 를 .at-ticks 안으로 한정(부동산 키워드 목록 겹침의 원인)",
    find: ".tk { position: absolute; top: 0; width: 1px; height: 6px; background: #6f98ae; }\n.tk-o {",
    repl: ".at-ticks .tk { position: absolute; top: 0; width: 1px; height: 6px; background: #6f98ae; }\n.at-ticks .tk-o {" },
];
export function patchStyle(css) {
  const changes = [];
  for (const p of STYLE_PATCHES) {
    if (css.includes(p.repl)) continue;
    const n = css.split(p.find).length - 1;
    if (n !== 1) throw new Error(`기준 표지를 찾지 못함: style.css ${p.id} (${n}곳)`);
    css = css.replace(p.find, () => p.repl);
    changes.push(`style.css: ${p.desc}`);
  }
  return { css, changes };
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === "--pages") {
  // 저장소 안 모듈 페이지만 맞춘다: node scripts/integrate.mjs --pages <통합 패치가 적용된 운영 index.html>
  const indexHtml = await readFile(process.argv[3], "utf8");
  const repo = new URL("..", import.meta.url);
  for (const [rel, href] of Object.entries(MODULE_PAGES)) {
    const file = new URL(rel, repo);
    const r = syncShell(await readFile(file, "utf8"), indexHtml, href);
    if (r.changed) { await writeFile(file, r.html); console.log(`· ${rel}: 머리 탐색을 운영 홈과 맞춤`); }
  }
  process.exit(0);
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2];
  if (!root) { console.error("사용법: node scripts/integrate.mjs <운영 소스 폴더> [--dry]"); process.exit(1); }
  const dry = process.argv.includes("--dry");
  const idx = join(root, "index.html"), app = join(root, "assets/app.js"), sty = join(root, "assets/style.css");
  const a = patchIndex(await readFile(idx, "utf8"));
  const b = patchApp(await readFile(app, "utf8"));
  const c = patchStyle(await readFile(sty, "utf8"));
  // 이름만 바뀌는 운영 파일: 세계 지도 복사 문구(atlas.js) · 홈 화면 앱 이름(manifest) · 스타일 머리 주석
  const named = [];
  for (const rel of ["assets/atlas.js", "manifest.webmanifest", "assets/style.css"]) {
    const f = join(root, rel);
    const t = rel === "assets/style.css" ? c.css : await readFile(f, "utf8").catch(() => null);
    if (t == null || !t.includes(OLD_NAME)) continue;
    if (rel === "assets/style.css") { c.css = rebrand(c.css); c.changes.push("style.css: 이름(머리 주석)"); continue; }
    named.push([f, rebrand(t)]); c.changes.push(`${rel}: 이름 '${NEW_NAME}'`);
  }
  const pages = [];
  for (const [rel, href] of Object.entries(MODULE_PAGES)) {
    const file = join(root, rel);
    const html = await readFile(file, "utf8").catch(() => null);
    if (html == null) continue;
    const r = syncShell(html, a.html, href);
    if (r.changed) { pages.push([file, r.html]); a.changes.push(`${rel}: 머리 탐색을 운영 홈과 맞춤`); }
  }
  for (const x of [...a.changes, ...b.changes, ...c.changes]) console.log(`· ${x}`);
  if (!a.changes.length && !b.changes.length && !c.changes.length) console.log("이미 적용되어 있습니다.");
  if (!dry) {
    if (a.html) await writeFile(idx, a.html);
    if (b.changes.length) await writeFile(app, b.js);
    if (c.changes.length) await writeFile(sty, c.css);
    for (const [f, t] of named) await writeFile(f, t);
    for (const [f, h] of pages) await writeFile(f, h);
  }
}
