// 원문 항목표(CSV) → 화면 자료(officials/data/*.json). 공개 원문 한 건 = CSV 한 개 + 메타 한 개.
//   node scripts/officials/build.mjs [원문 폴더=officials/raw]
//
// officials/raw/<공개일>.meta.json  { "published": "2026-03-26", "basis": "2025-12-31", "kind": "정기", "term": 22,
//                                     "source": { "title": "...", "publisher": "국회공직자윤리위원회", "url": "https://...", "pages": 812 } }
// officials/raw/<공개일>.csv        원문 표의 한 줄 = 한 행. 머리 줄:
//   official,official_id,relation,category,kind,location,prev,cur,reason,page
//   official     성명(원문 표기)            official_id  동명이인일 때 명부 id(wd-Q…)로 지정
//   relation     본인·배우자·장남 …         category     원문 대분류(토지·건물·예금·증권·채무·고지거부 … / '총계'는 대조용)
//   kind         원문 세부(대지·아파트·전세(임차)권 …)   location 소재지·권리 명세 원문
//   prev, cur    종전가액·현재가액(천원, 쉼표 허용)     reason 변동 사유     page 원문 쪽
//
// 원칙: 한 사람이라도 대조에 실패하면 그 공개 건 전체를 싣지 않는다(부분 공개로 통계가 왜곡되지 않게). 실패 내역은 verification.json 에 남긴다.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { matchRegion } from "../../officials/lib/regions.mjs";
import { SCHEMA, validate } from "../../officials/lib/engine.mjs";

export function parseCSV(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; } else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.some((x) => x.trim()));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] ?? "").trim()])));
}
const thousand = (s) => { const t = String(s || "").replace(/[,\s원]/g, ""); if (!t || t === "-") return 0; const n = Number(t.replace(/^\((.*)\)$/, "-$1")); if (!Number.isFinite(n)) throw new Error(`금액을 읽지 못함: ${s}`); return Math.round(n * 1000); };

// 원문 대분류 → 화면 구분
export function classify(category, kind) {
  const c = category.replace(/\s/g, ""), k = (kind || "").replace(/\s/g, "");
  if (/^총계|^합계/.test(c)) return { total: true };
  if (/고지거부|등록제외/.test(c)) return { refused: true };
  if (/^채무/.test(c)) return { field: "debts" };
  if (/^토지/.test(c)) return { field: "realEstate", cls: "own" };
  if (/^건물/.test(c)) return { field: "realEstate", cls: /전세|임차/.test(k) ? "lease" : "own" };
  if (/부동산에관한규정이준용되는권리/.test(c)) return /분양권|입주권|조합원/.test(k) ? { field: "realEstate", cls: "right" } : { field: "other" };
  if (/예금|현금/.test(c)) return { field: "deposits" };
  if (/증권|주식|채권\(국|국채|회사채/.test(c)) return { field: "securities" };
  return { field: "other" }; // 채권(빌려준 돈)·금·보석·가상자산·지식재산권·출자지분 등
}

export function buildSnapshot(meta, rows, registry) {
  const errors = [], people = new Map();
  const byName = new Map();
  registry.forEach((o, oi) => { if (o.terms?.includes(meta.term)) byName.set(o.name, [...(byName.get(o.name) || []), oi]); });
  for (const [n, r] of rows.entries()) {
    const line = `${meta.published} ${n + 2}행`;
    let oi;
    if (r.official_id) { oi = registry.findIndex((o) => o.id === r.official_id); if (oi < 0) { errors.push(`${line}: 명부에 없는 id ${r.official_id}`); continue; } }
    else {
      const cand = byName.get(r.official) || [];
      if (cand.length !== 1) { errors.push(`${line}: ${r.official} — ${cand.length ? `동명이인 ${cand.length}명(official_id 지정 필요)` : `제${meta.term}대 명부에 없음`}`); continue; }
      oi = cand[0];
    }
    const p = people.get(oi) || { oi, sums: { assets: 0, realEstate: 0, deposits: 0, securities: 0, debts: 0, other: 0 }, refused: 0, holdings: new Map(), total: null, unmatched: 0 };
    people.set(oi, p);
    const k = classify(r.category, r.kind);
    let cur;
    try { cur = thousand(r.cur); } catch (e) { errors.push(`${line}: ${e.message}`); continue; }
    if (k.total) { p.total = cur; continue; }
    if (k.refused) { p.refused += 1; continue; }
    if (k.field === "debts") { p.sums.debts += cur; continue; }
    p.sums[k.field] += cur; p.sums.assets += cur;
    if (k.cls) {
      const m = matchRegion(r.location);
      if (m.level === "unknown") p.unmatched += 1;
      const key = `${m.code}|${k.cls}`, h = p.holdings.get(key) || { value: 0, count: 0 };
      h.value += cur; h.count += 1; p.holdings.set(key, h);
    }
  }
  // 대조: 원문 총계(있으면) = 자산 − 채무
  for (const p of people.values()) {
    if (p.total != null && p.total !== p.sums.assets - p.sums.debts) errors.push(`${meta.published} ${registry[p.oi].name}: 원문 총계 ${p.total} ≠ 항목 합(자산 ${p.sums.assets} − 채무 ${p.sums.debts})`);
  }
  return { errors, people };
}

async function main() {
  const rawDir = new URL(process.argv[2] ? `file://${process.argv[2].replace(/\/?$/, "/")}` : "../../officials/raw/", import.meta.url);
  const out = new URL("../../officials/data/", import.meta.url);
  const registry = JSON.parse(await readFile(new URL("officials.json", out), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("manifest.json", out), "utf8"));
  const files = (await readdir(rawDir).catch(() => [])).filter((f) => f.endsWith(".meta.json")).sort();
  const snapshots = [], holdings = [], totals = [], log = [];
  for (const f of files) {
    const meta = JSON.parse(await readFile(new URL(f, rawDir), "utf8"));
    const rows = parseCSV(await readFile(new URL(f.replace(".meta.json", ".csv"), rawDir), "utf8"));
    const r = buildSnapshot(meta, rows, registry);
    log.push({ snapshot: meta.published, rows: rows.length, people: r.people.size, errors: r.errors });
    if (r.errors.length) { console.error(`✕ ${meta.published}: 대조 실패 ${r.errors.length}건 — 이 공개 건은 싣지 않습니다`); continue; }
    const si = snapshots.length;
    snapshots.push({ id: meta.published, published: meta.published, basis: meta.basis, kind: meta.kind, term: meta.term, source: meta.source, persons: r.people.size, items: rows.length });
    for (const p of r.people.values()) {
      for (const [key, h] of p.holdings) { const [code, cls] = key.split("|"); holdings.push([si, p.oi, code, cls, h.value, h.count]); }
      const s = p.sums;
      totals.push([si, p.oi, s.assets, s.realEstate, s.deposits, s.securities, s.debts, s.other, p.refused]);
    }
    console.log(`✓ ${meta.published}: ${r.people.size}명 · ${rows.length}행`);
  }
  const next = { ...manifest, schema: SCHEMA, synthetic: false, status: snapshots.length ? "published" : "collecting", generatedAt: new Date().toISOString(), snapshots };
  const data = { manifest: next, officials: registry, holdings: { rows: holdings }, totals: { rows: totals } };
  const errs = validate(data);
  if (errs.length) { console.error("✕ 검증 실패 — 아무것도 쓰지 않습니다", errs.slice(0, 10)); process.exit(1); }
  await writeFile(new URL("manifest.json", out), JSON.stringify(next, null, 1));
  await writeFile(new URL("holdings.json", out), JSON.stringify({ fields: ["snapshot", "official", "region", "class", "value", "count"], rows: holdings }));
  await writeFile(new URL("totals.json", out), JSON.stringify({ fields: ["snapshot", "official", "assets", "realEstate", "deposits", "securities", "debts", "other", "refused"], rows: totals }));
  await writeFile(new URL("verification.json", out), JSON.stringify({ generatedAt: next.generatedAt, log }, null, 1));
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
