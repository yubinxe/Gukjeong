// 운영 소스(정적 홈)에 '오늘의 브리핑' 진입점을 넣는다 — 위쪽 탭 줄 · 아래 탭 막대 · 전체 메뉴 시트.
//   node scripts/integrate-briefing.mjs <운영 소스 폴더>          바꿀 내용을 보여 주고 적용
//   node scripts/integrate-briefing.mjs <운영 소스 폴더> --dry    보여 주기만
// 아래 탭 막대는 iOS 권장대로 다섯 칸을 지킨다: 종합 · 브리핑 · 시장 · 부동산 · 더보기.
// '거시경제'는 위쪽 탭 줄과 전체 메뉴에 그대로 남고, 그 화면에 있을 때 '더보기'가 켜지도록 app.js 를 한 줄 고친다.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v11H10l-4 3.5V16H4z"/><path d="M8 9h8M8 12.5h5"/></svg>`;

function must(re, text, what) {
  const m = text.match(re);
  if (!m) throw new Error(`기준 표지를 찾지 못함: ${what} — 운영 index.html 구조가 바뀌었는지 확인`);
  return m;
}

export function patchIndex(html) {
  if (html.includes('href="/briefing/"')) return { html, changes: [] };
  const changes = [];
  const top = must(/(<a href="\.\/" role="tab" data-view="home"[^>]*>종합 상황판<\/a>)/, html, "위쪽 탭 줄 '종합 상황판'");
  html = html.replace(top[1], `${top[1]}\n    <a href="/briefing/" role="tab" aria-selected="false">오늘의 브리핑</a>`);
  changes.push("위쪽 탭 줄: '종합 상황판' 다음에 '오늘의 브리핑'");

  const bar = must(/<nav class="tabbar"[\s\S]*?<\/nav>/, html, "아래 탭 막대");
  let tab = bar[0];
  const home = must(/(<a href="\.\/" data-view="home">[\s\S]*?<\/a>)/, tab, "탭 막대 '종합'");
  tab = tab.replace(home[1], `${home[1]}\n  <a href="/briefing/">${ICON}<span>브리핑</span></a>`);
  const macro = tab.match(/\n?\s*<a href="\?v=macro" data-view="macro">[\s\S]*?<\/a>/);
  if (macro) { tab = tab.replace(macro[0], ""); changes.push("아래 탭 막대: '거시경제' 칸을 '브리핑'으로(거시경제는 더보기·위쪽 탭 줄에 유지)"); }
  else changes.push("아래 탭 막대: '종합' 다음에 '브리핑'");
  html = html.replace(bar[0], tab);

  const li = must(/(<li><a href="\.\/" data-view="home">[\s\S]*?<\/li>)/, html, "전체 메뉴 '종합 상황판'");
  html = html.replace(li[1], `${li[1]}\n      <li><a href="/briefing/"><b>오늘의 브리핑</b><span>요약 · 해석 · 묻고 답하기</span></a></li>`);
  changes.push("전체 메뉴: '종합 상황판' 다음에 '오늘의 브리핑'");
  return { html, changes };
}

export function patchApp(js) {
  const re = /const TAB_VIEWS = \[([^\]]*)\];/;
  const m = js.match(re);
  if (!m || !/'macro'/.test(m[1])) return { js, changes: [] };
  return { js: js.replace(re, `const TAB_VIEWS = [${m[1].split(",").map((s) => s.trim()).filter((s) => s !== "'macro'").join(", ")}];`), changes: ["app.js: TAB_VIEWS 에서 'macro' 제외(거시경제 화면에서 '더보기'가 켜짐)"] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = process.argv[2];
  if (!root) { console.error("사용법: node scripts/integrate-briefing.mjs <운영 소스 폴더> [--dry]"); process.exit(1); }
  const dry = process.argv.includes("--dry");
  const idx = join(root, "index.html"), app = join(root, "assets/app.js");
  const a = patchIndex(await readFile(idx, "utf8"));
  const b = await readFile(app, "utf8").then(patchApp, () => ({ changes: [] }));
  for (const c of [...a.changes, ...b.changes]) console.log(`· ${c}`);
  if (!a.changes.length && !b.changes.length) console.log("이미 적용되어 있습니다.");
  if (!dry) { if (a.changes.length) await writeFile(idx, a.html); if (b.changes.length) await writeFile(app, b.js); }
}
