// 화면 검수용 합성 자료 생성기 — 실제 인물·정당·금액이 아니다.
//   node scripts/officials/synthetic.mjs  →  test/fixtures/officials-synthetic/*.json
// 규칙: 이름은 '가상인물 NNN', 정당은 '가상정당 가·나·다'. 실명 명부(officials/data)와 절대 섞지 않는다.
//       화면은 manifest.synthetic 이 참이면 지도 위에 '합성 시험 자료' 표지를 크게 띄운다.
import { mkdir, writeFile } from "node:fs/promises";
import { SIGUNGU, sidoOf } from "../../officials/lib/regions.mjs";
import { SCHEMA } from "../../officials/lib/engine.mjs";

let seed = 20261106;
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const codes = Object.keys(SIGUNGU);
const weighted = [...codes.filter((c) => ["11230", "11220", "11240", "11170", "11030", "31023", "31110"].includes(c)).flatMap((c) => Array(14).fill(c)), ...codes.filter((c) => sidoOf(c) === "11").flatMap((c) => Array(4).fill(c)), ...codes.filter((c) => sidoOf(c) === "31").flatMap((c) => Array(2).fill(c)), ...codes];

const snapshots = [
  ["2020-08-27", "2020-05-30", "최초", 21], ["2021-03-25", "2020-12-31", "정기", 21], ["2022-03-31", "2021-12-31", "정기", 21], ["2023-03-30", "2022-12-31", "정기", 21],
  ["2024-03-28", "2023-12-31", "정기", 21], ["2024-08-29", "2024-05-30", "최초", 22], ["2025-03-27", "2024-12-31", "정기", 22], ["2026-03-26", "2025-12-31", "정기", 22],
].map(([published, basis, kind, term]) => ({ id: published, published, basis, kind, term, source: { title: `합성 시험 자료 ${published}`, publisher: "합성", url: null, pages: null } }));

const PARTIES = ["가상정당 가", "가상정당 나", "가상정당 다", "무소속(가상)"];
const officials = [];
for (let i = 0; i < 240; i++) {
  const t21 = i < 160, t22 = i >= 70;
  officials.push({ id: `syn-${String(i + 1).padStart(3, "0")}`, name: `가상인물 ${String(i + 1).padStart(3, "0")}`, terms: [t21 && 21, t22 && 22].filter(Boolean),
    party: [{ name: PARTIES[Math.min(3, Math.floor(rnd() * 3.3))], from: t21 ? "2020-05-30" : "2024-05-30", to: null }] });
}
const holdings = [], totals = [];
officials.forEach((o, oi) => {
  let props = Array.from({ length: 1 + Math.floor(rnd() * 5) }, () => ({ code: pick(weighted), cls: rnd() < 0.82 ? "own" : rnd() < 0.6 ? "lease" : "right", v: Math.round((1 + rnd() * 18) ** 2 * 1e6) * 10 }));
  const cash = Math.round(rnd() * 2e9), debt = Math.round(rnd() ** 2 * 1.2e9);
  snapshots.forEach((s, si) => {
    if (!o.terms.includes(s.term)) return;
    if (rnd() < 0.04) return; // 고지·누락 등으로 그 시점 자료가 없는 경우
    if (rnd() < 0.08) props.push({ code: pick(weighted), cls: "own", v: Math.round((2 + rnd() * 14) ** 2 * 1e6) * 10 }); // 취득
    if (props.length > 1 && rnd() < 0.06) props.splice(Math.floor(rnd() * props.length), 1); // 처분
    props = props.map((p) => ({ ...p, v: Math.max(1e6, Math.round(p.v * (0.97 + rnd() * 0.12) / 1000) * 1000) }));
    const by = new Map();
    for (const p of props) { const k = `${p.code}|${p.cls}`; const x = by.get(k) || { v: 0, n: 0 }; x.v += p.v; x.n += 1; by.set(k, x); }
    let re = 0;
    for (const [k, x] of by) { const [code, cls] = k.split("|"); holdings.push([si, oi, code, cls, x.v, x.n]); re += x.v; }
    const dep = Math.round(cash * (0.9 + rnd() * 0.25)), sec = Math.round(rnd() * 6e8), other = Math.round(rnd() * 1e8);
    totals.push([si, oi, re + dep + sec + other, re, dep, sec, Math.round(debt * (0.85 + rnd() * 0.3)), other, rnd() < 0.15 ? 1 + Math.floor(rnd() * 3) : 0]);
  });
});

const manifest = {
  schema: SCHEMA, synthetic: true, generatedAt: new Date(Date.UTC(2026, 10, 6)).toISOString(),
  note: "화면 검수용 합성 자료 — 실제 국회의원·정당·금액이 아닙니다.",
  regions: "통계청 센서스용 행정구역경계 2018, 현재 시도 소속으로 재집계",
  snapshots: snapshots.map((s) => ({ ...s, persons: new Set(totals.filter((t) => snapshots[t[0]] === s).map((t) => t[1])).size })),
};
const dir = new URL("../../test/fixtures/officials-synthetic/", import.meta.url);
await mkdir(dir, { recursive: true });
for (const [name, body] of [["manifest", manifest], ["officials", officials], ["holdings", { fields: ["snapshot", "official", "region", "class", "value", "count"], rows: holdings }], ["totals", { fields: ["snapshot", "official", "assets", "realEstate", "deposits", "securities", "debts", "other", "refused"], rows: totals }]]) {
  await writeFile(new URL(`${name}.json`, dir), JSON.stringify(body));
}
console.log(`합성 자료: 인물 ${officials.length} · 시점 ${snapshots.length} · 부동산 행 ${holdings.length} · 합계 행 ${totals.length}`);
