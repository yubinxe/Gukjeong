// 운영 소스(정적 홈)에 증분 모듈을 잇는다 — 모션 계층 · 오늘의 브리핑 · 공직자 재산 동향.
//   node scripts/integrate.mjs <운영 소스 폴더>          바꿀 내용을 보여 주고 적용
//   node scripts/integrate.mjs <운영 소스 폴더> --dry    보여 주기만
// 기존 메뉴는 지우거나 옮기지 않는다. 아래 탭 막대(휴대폰)는 지금 구성을 그대로 두고, 새 메뉴는 위쪽 탭 줄과 '더보기' 시트에 넣는다.
// 기준 표지를 못 찾으면 아무것도 쓰지 않고 멈춘다. 두 번 돌려도 결과가 같다.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MOTION_V = "1";
export const MENUS = [
  { href: "/briefing/", label: "오늘의 브리핑", sub: "요약 · 해석 · 묻고 답하기", after: "home" },
  { href: "/officials/", label: "공직자 재산 동향", sub: "국회의원 재산공개 · 지역 분포 · 대수 비교", after: "policy" },
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
  for (const m of MENUS) {
    if (html.includes(`href="${m.href}"`)) continue;
    const top = must(new RegExp(`(<a href="[^"]*" role="tab" data-view="${m.after}"[^>]*>[^<]+</a>)`), html, `위쪽 탭 줄 data-view="${m.after}"`);
    html = html.replace(top[1], `${top[1]}\n    <a href="${m.href}" role="tab" aria-selected="false">${m.label}</a>`);
    const li = must(new RegExp(`(<li><a href="[^"]*" data-view="${m.after}">[\\s\\S]*?</li>)`), html, `전체 메뉴 data-view="${m.after}"`);
    html = html.replace(li[1], `${li[1]}\n      <li><a href="${m.href}"><b>${m.label}</b><span>${m.sub}</span></a></li>`);
    changes.push(`위쪽 탭 줄·전체 메뉴: '${m.label}' 추가`);
  }
  return { html, changes };
}

// 모듈 페이지(브리핑·공직자 재산 동향)의 머리 탐색을 운영 홈과 똑같이 맞춘다 — 메뉴가 바뀌어도 한 번 돌리면 따라온다.
// <!-- shell:views --> … <!-- /shell:views --> 처럼 표지 사이만 갈아 끼운다. app.js 가 없는 페이지이므로 data-view 를 빼고 주소를 절대 경로로.
export const MODULE_PAGES = { "briefing/index.html": "/briefing/", "officials/index.html": "/officials/" };
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

// app.js: 숫자 세기(countUp)를 모션 계층에 넘긴다 — 값이 그대로면 다시 세지 않는다. 모션 계층이 없으면 원래 동작.
export function patchApp(js) {
  if (js.includes("window.__moCount")) return { js, changes: [] };
  const anchor = "function countUp(root) {";
  if (!js.includes(anchor)) throw new Error("기준 표지를 찾지 못함: app.js countUp");
  return { js: js.replace(anchor, `${anchor}\n  if (window.__moCount) return window.__moCount(root);`), changes: ["app.js: 숫자 세기를 모션 계층에 연결(바뀐 값만 움직임)"] };
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
  const idx = join(root, "index.html"), app = join(root, "assets/app.js");
  const a = patchIndex(await readFile(idx, "utf8"));
  const b = patchApp(await readFile(app, "utf8"));
  const pages = [];
  for (const [rel, href] of Object.entries(MODULE_PAGES)) {
    const file = join(root, rel);
    const html = await readFile(file, "utf8").catch(() => null);
    if (html == null) continue;
    const r = syncShell(html, a.html, href);
    if (r.changed) { pages.push([file, r.html]); a.changes.push(`${rel}: 머리 탐색을 운영 홈과 맞춤`); }
  }
  for (const c of [...a.changes, ...b.changes]) console.log(`· ${c}`);
  if (!a.changes.length && !b.changes.length) console.log("이미 적용되어 있습니다.");
  if (!dry) {
    if (a.html) await writeFile(idx, a.html);
    if (b.changes.length) await writeFile(app, b.js);
    for (const [f, h] of pages) await writeFile(f, h);
  }
}
