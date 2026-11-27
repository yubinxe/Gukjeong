// 선거 후 시장 변동성 자료 만들기
//   node scripts/elections/build.mjs            원자료를 받아 elections/data/events.json 을 새로 쓴다
//   node scripts/elections/build.mjs --cache <폴더>   받은 원자료를 그 폴더에 두고 다시 쓴다(재현용)
// 원자료: 코스피 일별 종가(네이버 금융 — 운영 사이트 시세와 같은 원천), 원·달러(FRED DEXKOUS)
// 원자료 전체는 싣지 않는다 — 선거 앞뒤 경로와 계산 결과, 평시 분포의 분위만 싣는다.
// 하나라도 어긋나면(선거일이 거래일, 자료 공백, 날짜 역순) 아무것도 쓰지 않고 멈춘다.
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { series, eventStudy, baseline, summarize, medianPath, percentileOf, groupSummary, PRE } from "../../elections/lib/stats.mjs";
import { ELECTIONS, ASSETS, KINDS, label } from "../../elections/lib/elections.mjs";

const UA = "gukjeong-hannune-data/1.0 (+https://gukjeong-hannune.vercel.app/elections/)";
const H = 120;
const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");

async function get(url) {
  const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`${url} → ${r.status}`);
  return r.text();
}
export function parseNaver(text) {
  // [['날짜', '시가', …], ["19900104", 911.21, 933.24, 911.21, 928.82, …], …] — 작은따옴표가 섞인 의사 JSON
  const rows = [];
  for (const m of text.matchAll(/\["(\d{8})",\s*([\d.]+),\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)/g)) rows.push([m[1], Number(m[5])]);
  return rows;
}
export function parseFred(text) {
  const rows = [];
  for (const line of text.trim().split(/\r?\n/).slice(1)) {
    const [d, v] = line.split(",");
    if (v && v !== "." && v.trim() !== "") rows.push([d, Number(v)]);
  }
  return rows;
}
// 원자료 점검: 길게 빈 구간(연휴를 넘는 공백)이 없어야 한다
export function gaps(s, maxDays = 12) {
  const out = [];
  for (let i = 1; i < s.d.length; i++) {
    const g = (Date.parse(s.d[i]) - Date.parse(s.d[i - 1])) / 864e5;
    if (g > maxDays) out.push(`${s.d[i - 1]}→${s.d[i]} ${g}일`);
  }
  return out;
}

export function compute(raw, { asOf }) {
  const out = { schema: 1, asOf, horizon: H, pre: PRE, kinds: KINDS, assets: {}, elections: [] };
  const bases = {};
  for (const [key, a] of Object.entries(ASSETS)) {
    const s = series(raw[key]);
    const gp = gaps(s);
    if (gp.length) throw new Error(`${a.name} 자료 공백: ${gp.slice(0, 3).join(", ")}`);
    const b = baseline(s, { H, minStart: a.minStart });
    bases[key] = { s, b };
    out.assets[key] = {
      ...a, first: s.d[0], last: s.d.at(-1), lastClose: s.c.at(-1), days: s.d.length,
      base: { n: b.n, band: b.band, qs: b.qs, ratio: summarize(b.dist.ratio), absDay1: summarize(b.dist.absDay1), volPost: summarize(b.dist.volPost), ret20: summarize(b.dist.ret20), ret60: summarize(b.dist.ret60), mdd60: summarize(b.dist.mdd60) },
    };
  }
  for (const e of ELECTIONS) {
    const row = { ...e, label: label(e), m: {} };
    for (const key of Object.keys(ASSETS)) {
      const { s, b } = bases[key];
      const ev = eventStudy(s, e.date, { H, minStart: ASSETS[key].minStart, holiday: ASSETS[key].holiday });
      if (!ev) { row.m[key] = null; continue; }
      row.m[key] = {
        ...ev,
        pct: {
          ratio: percentileOf(b.dist.ratio, ev.ratio),
          absDay1: percentileOf(b.dist.absDay1, ev.day1 == null ? null : Math.abs(ev.day1)),
          ret20: percentileOf(b.dist.ret20, ev.ret[20]),
          ret60: percentileOf(b.dist.ret60, ev.ret[60]),
          mdd60: percentileOf(b.dist.mdd60, ev.mdd60),
        },
      };
    }
    out.elections.push(row);
  }
  // 종류별 요약(평시와 견준 검정)
  out.summary = {};
  for (const key of Object.keys(ASSETS)) {
    out.summary[key] = {};
    for (const k of ["all", ...Object.keys(KINDS)]) out.summary[key][k] = groupSummary(out.elections.filter((e) => k === "all" || e.kind === k).map((e) => e.m[key]), bases[key].b.dist.ratio);
  }
  // 종류별 중앙값 경로
  out.median = {};
  for (const key of Object.keys(ASSETS)) {
    out.median[key] = {};
    for (const k of ["all", ...Object.keys(KINDS)]) out.median[key][k] = medianPath(out.elections.filter((e) => (k === "all" || e.kind === k) && e.m[key]).map((e) => e.m[key].path));
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ci = process.argv.indexOf("--cache"), cache = ci > 0 ? process.argv[ci + 1] : null;
  const load = async (name, url) => {
    if (cache) { try { return await readFile(`${cache}/${name}`, "utf8"); } catch { /* 없으면 받는다 */ } }
    const t = await get(url);
    if (cache) { await mkdir(cache, { recursive: true }); await writeFile(`${cache}/${name}`, t); }
    return t;
  };
  const [k, f] = await Promise.all([
    load("kospi.txt", `https://api.finance.naver.com/siseJson.naver?symbol=KOSPI&requestType=1&startTime=19900101&endTime=${today}&timeframe=day`),
    load("dexkous.csv", "https://fred.stlouisfed.org/graph/fredgraph.csv?id=DEXKOUS"),
  ]);
  const raw = { kospi: parseNaver(k), usdkrw: parseFred(f) };
  if (raw.kospi.length < 8000 || raw.usdkrw.length < 8000) throw new Error(`원자료가 너무 짧음: 코스피 ${raw.kospi.length} · 환율 ${raw.usdkrw.length}`);
  const out = compute(raw, { asOf: new Date().toISOString() });
  const file = new URL("../../elections/data/events.json", import.meta.url);
  await mkdir(new URL(".", file), { recursive: true });
  await writeFile(file, JSON.stringify(out));
  for (const e of out.elections) {
    const m = e.m.kospi;
    console.log(`${e.label.padEnd(16)} T0 ${m?.t0 ?? "—"}  +20일 ${m?.ret[20]?.toFixed(2) ?? "—"}%  변동성 ${m?.volPre?.toFixed(3) ?? "—"}→${m?.volPost?.toFixed(3) ?? "—"} (비율 ${m?.ratio?.toFixed(2) ?? "—"}, 평시 ${m?.pct.ratio?.toFixed(0) ?? "—"}백분위)`);
  }
  for (const [a, g] of Object.entries(out.summary)) for (const [k, x] of Object.entries(g)) if (x) console.log(`요약 ${a}/${k}: n=${x.n} 비율 중앙값 ${x.medianRatio} (평시 ${x.baseMedianRatio}) · 커짐 ${x.up}/${x.n} (평시 확률 ${x.p1}, p=${x.pUp}) · 평시 상위10% ${x.top} (기대 ${x.expectTop}, p=${x.pTop})`);
  console.log(`코스피 ${out.assets.kospi.first}~${out.assets.kospi.last} ${out.assets.kospi.days}일 · 환율 ${out.assets.usdkrw.first}~${out.assets.usdkrw.last} ${out.assets.usdkrw.days}일`);
}
