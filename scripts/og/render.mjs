// 공유 이미지 만들기 — 오픈그래프(1200×630)와 인스타그램(피드 1080×1350 · 스토리 1080×1920)
//   node scripts/og/render.mjs            og/*.png 를 새로 그린다 (Playwright · 사이트 글꼴)
// 원칙: 화면에 있는 실제 자료만 싣는다(선거 카드는 elections/data/events.json). 이미지 안에는 한글만 쓴다.
import { createRequire } from "node:module";
import { readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);

const C = { ivory: "#f4efe4", paper: "#fbf8f1", ink: "#1d241f", ink2: "#39413a", muted: "#5d5f55", forest: "#18301f", green: "#2f5643", brass: "#9a7b46", hi: "#8a6a35", line: "#d6cbb3", band: "rgba(47,86,67,.10)", band2: "rgba(47,86,67,.19)" };
const FONTS = `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@500;600;700&display=block">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">`;
const page = (w, h, body, css = "") => `<!doctype html><html lang="ko"><head><meta charset="utf-8">${FONTS}<style>
*{box-sizing:border-box;margin:0;padding:0}html,body{width:${w}px;height:${h}px;background:${C.ivory};color:${C.ink};font-family:"Pretendard Variable",Pretendard,sans-serif;-webkit-font-smoothing:antialiased;word-break:keep-all;text-wrap:balance}
.serif{font-family:"Noto Serif KR",serif}.frame{position:absolute;inset:0;display:flex;flex-direction:column}
.top{height:14px;background:${C.forest}}.rule{border-top:3px double ${C.brass}}
.brand{display:flex;align-items:center;gap:14px;font-weight:700;letter-spacing:-.01em}.brand i{width:14px;height:14px;border:2px solid ${C.brass};transform:rotate(45deg)}
${css}</style></head><body>${body}</body></html>`;

// 선거 카드용 작은 경로 그림(중앙값 + 평소 범위). 실제 자료에서만 그린다.
function pathSVG(D, { w, h, K = 60, asset = "kospi", stroke = 3 }) {
  const PRE = D.pre, band = D.assets[asset].base.band.slice(0, PRE + K + 1), med = D.median[asset].all.slice(0, PRE + K + 1);
  const ks = band.map((_, i) => i - PRE);
  const vals = [...band.flatMap((b) => [b[0], b[4]]), ...med.filter((v) => v != null)];
  const lo = Math.min(...vals) - 1, hi = Math.max(...vals) + 1;
  const X = (k) => ((k + PRE) / (PRE + K)) * w, Y = (v) => (1 - (v - lo) / (hi - lo)) * h, f = (v) => v.toFixed(1);
  const area = (a, b) => `M${band.map((q, i) => `${f(X(ks[i]))} ${f(Y(q[b]))}`).join("L")}L${band.map((q, i) => `${f(X(ks[i]))} ${f(Y(q[a]))}`).reverse().join("L")}Z`;
  const line = med.map((v, i) => `${i ? "L" : "M"}${f(X(ks[i]))} ${f(Y(v))}`).join("");
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="overflow:visible">
    <path d="${area(0, 4)}" fill="${C.band}"/><path d="${area(1, 3)}" fill="${C.band2}"/>
    <line x1="0" x2="${w}" y1="${f(Y(100))}" y2="${f(Y(100))}" stroke="${C.line}" stroke-width="1.5"/>
    <line x1="${f(X(0))}" x2="${f(X(0))}" y1="0" y2="${h}" stroke="${C.ink2}" stroke-width="1.5" stroke-dasharray="3 5"/>
    <path d="${line}" fill="none" stroke="${C.ink}" stroke-width="${stroke}" stroke-linejoin="round"/>
    <text x="${f(X(0) + 10)}" y="${Math.min(26, Math.round(h / 12)) + 2}" font-size="${Math.min(26, Math.round(h / 12))}" font-weight="700" fill="${C.ink2}">선거</text>
  </svg>`;
}

export function cards(D) {
  const g = D.summary.kospi.all, a = D.assets.kospi;
  const share = Math.round(g.p1 * 100);
  const siteOG = page(1200, 630, `<div class="frame"><div class="top"></div>
    <div style="flex:1;padding:72px 84px 64px;display:flex;flex-direction:column">
      <div class="brand" style="font-size:22px;color:${C.green}"><i></i>국정 한눈에</div>
      <h1 class="serif" style="margin-top:auto;font-size:76px;line-height:1.2;letter-spacing:-.03em;font-weight:700">국정과 경제를<br>한 화면에서</h1>
      <div class="rule" style="margin:34px 0 22px;width:180px"></div>
      <p style="font-size:24px;color:${C.ink2};letter-spacing:-.01em">대통령 동정 · 정부 정책 · 국회 · 시장 · 부동산 · 정부기관 공개 정보 연계</p>
    </div></div>`);
  const kicker = (t) => `<div class="brand" style="font-size:20px;color:${C.green}"><i></i>국정 한눈에 <span style="color:${C.muted};font-weight:500;margin-left:6px">${t}</span></div>`;
  const briefOG = page(1200, 630, `<div class="frame"><div class="top"></div><div style="flex:1;padding:72px 84px 64px;display:flex;flex-direction:column">${kicker("오늘의 브리핑")}
      <h1 class="serif" style="margin-top:auto;font-size:70px;line-height:1.22;letter-spacing:-.03em">오늘 나온 기사로<br>오늘을 정리합니다</h1>
      <div class="rule" style="margin:32px 0 20px;width:180px"></div><p style="font-size:24px;color:${C.ink2}">요약 · 해석 · 묻고 답하기 — 모든 문장에 출처 기사</p></div></div>`);
  const offOG = page(1200, 630, `<div class="frame"><div class="top"></div><div style="flex:1;padding:72px 84px 64px;display:flex;flex-direction:column">${kicker("공직자 재산 동향")}
      <h1 class="serif" style="margin-top:auto;font-size:70px;line-height:1.22;letter-spacing:-.03em">국회의원이 신고한 부동산,<br>어디에 얼마나</h1>
      <div class="rule" style="margin:32px 0 20px;width:180px"></div><p style="font-size:24px;color:${C.ink2}">국회공직자윤리위원회 재산공개 원문 · 지역 분포 · 대수 비교</p></div></div>`);
  const stat = (v, unit, t, size = 64) => `<div><div class="serif" style="font-size:${size}px;font-weight:700;letter-spacing:-.03em;line-height:1">${v}<span style="font-size:${Math.round(size * 0.42)}px;color:${C.muted};margin-left:6px;font-weight:600">${unit}</span></div><div style="margin-top:12px;font-size:${Math.round(size * 0.33)}px;color:${C.ink2};line-height:1.45">${t}</div></div>`;
  const elOG = page(1200, 630, `<div class="frame"><div class="top"></div><div style="flex:1;padding:56px 72px 52px;display:grid;grid-template-columns:1fr 470px;gap:48px;align-items:end">
      <div style="display:flex;flex-direction:column;height:100%">${kicker("선거 후 시장")}
        <h1 class="serif" style="margin-top:auto;font-size:56px;line-height:1.25;letter-spacing:-.03em">선거가 끝난 뒤,<br>시장은 평소보다<br>더 흔들렸나</h1>
        <div class="rule" style="margin:26px 0 18px;width:160px"></div>
        <p style="font-size:22px;color:${C.ink2};line-height:1.5">코스피 · 1992년 이후 전국 단위 선거 ${g.n}번<br>선거 뒤가 더 출렁인 선거 <b style="color:${C.ink}">${g.up}번</b><br>평소에도 ${share}%는 그렇습니다</p>
      </div>
      <div><div style="font-size:16px;color:${C.muted};margin-bottom:10px">투표 전날 = 100 · 선거 ${g.n}번의 중앙값과 평소 범위</div>${pathSVG(D, { w: 470, h: 330 })}</div>
    </div></div>`);
  const igBody = (w, h, chartH, pad) => `<div class="frame"><div class="top" style="height:18px"></div><div style="flex:1;padding:${pad}px ${Math.round(pad * 0.9)}px;display:flex;flex-direction:column;gap:${Math.round(pad * 0.55)}px">
      ${kicker("선거 후 시장").replace("font-size:20px", "font-size:28px")}
      <h1 class="serif" style="font-size:${Math.round(w * 0.072)}px;line-height:1.25;letter-spacing:-.03em">선거가 끝난 뒤,<br>시장은 평소보다<br>더 흔들렸나</h1>
      <div class="rule" style="width:200px"></div>
      <div><div style="font-size:24px;color:${C.muted};margin-bottom:14px">코스피 · 투표 전날 = 100 · 선거 ${g.n}번의 중앙값(검은 선)과 평소 범위(띠)</div>${pathSVG(D, { w: w - Math.round(pad * 1.8), h: chartH, stroke: 4 })}
        <div style="display:flex;justify-content:space-between;font-size:22px;color:${C.muted};margin-top:12px"><span>선거 20거래일 전</span><span>선거 60거래일 뒤</span></div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:auto;padding-top:28px;border-top:1px solid ${C.line}">
        ${stat(`${g.up}`, `/ ${g.n}`, `선거 뒤 20거래일이 더 출렁인 선거<br>평소에도 ${share}%는 그렇습니다`, 84)}
        ${stat(g.medianRatio.toFixed(2), "배", `변동성 비율 중앙값<br>평소 ${g.baseMedianRatio.toFixed(2)}배`, 84)}
      </div>
      <p style="font-size:21px;color:${C.muted};line-height:1.55">자료: 한국거래소 코스피(네이버 금융) ${a.first.slice(0, 4)}~${a.last.slice(0, 4)} · 선거일은 위키데이터와 코스피 휴장일로 확인 · 인과를 말하지 않습니다</p>
    </div></div>`;
  return {
    "og/site.png": [1200, 630, siteOG],
    "og/briefing.png": [1200, 630, briefOG],
    "og/officials.png": [1200, 630, offOG],
    "og/elections.png": [1200, 630, elOG],
    "og/elections-feed.png": [1080, 1350, page(1080, 1350, igBody(1080, 1350, 360, 76))],
    "og/elections-story.png": [1080, 1920, page(1080, 1920, igBody(1080, 1920, 620, 110))],
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { chromium } = require("playwright");
  const D = JSON.parse(await readFile(new URL("../../elections/data/events.json", import.meta.url), "utf8"));
  const root = new URL("../../", import.meta.url);
  await mkdir(new URL("og/", root), { recursive: true });
  const browser = await chromium.launch();
  try {
    for (const [file, [w, h, html]] of Object.entries(cards(D))) {
      const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      await p.setContent(html, { waitUntil: "networkidle" });
      await p.evaluate(() => document.fonts.ready);
      // 이미지 속 글자 점검: 한글·숫자·기호만(영문 금지)
      const latin = await p.evaluate(() => (document.body.innerText.match(/[A-Za-z]+/g) || []));
      if (latin.length) throw new Error(`${file}: 영문 글자 ${latin.join(",")}`);
      await p.screenshot({ path: fileURLToPath(new URL(file, root)), type: "png" });
      await p.close();
      console.log(`· ${file} ${w}×${h}`);
    }
  } finally { await browser.close(); }
}
