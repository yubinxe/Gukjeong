// 공직자 재산 동향 — 집계 엔진 (의존성 0, 브라우저/Node 공용)
// 자료 구조(officials/data/*.json)는 수집 파이프라인(scripts/officials/)이 만든다. 이 엔진은 그 자료를 고치지 않고 읽어 셈만 한다.
// 불변 조건: 한 신고 항목을 두 번 세지 않는다 · 고지거부를 0원으로 바꾸지 않는다 · 채무를 자산에 더하지 않는다
//            · 현재 정당을 과거에 소급하지 않는다 · 신고가액을 시가로 부르지 않는다 · 기준일이 다른 금액을 설명 없이 합치지 않는다.
import { CAPITAL, SIDO, sidoOf } from "./regions.mjs";

export const SCHEMA = 1;
// 부동산 권리 구분: 소유(토지·건물) · 임차(전세권·임차권) · 권리(분양권·입주권 등)
export const CLASSES = { own: "소유(토지·건물)", lease: "임차권·전세권", right: "분양권·입주권 등" };
export const METRICS = {
  value: { label: "신고가액 합계", unit: "원" },
  count: { label: "신고 항목 수", unit: "건" },
  holders: { label: "보유 신고자 수", unit: "명" },
};
export const TERMS = {
  20: { label: "제20대", from: "2016-05-30", to: "2020-05-29" },
  21: { label: "제21대", from: "2020-05-30", to: "2024-05-29" },
  22: { label: "제22대", from: "2024-05-30", to: null },
};

// ── 자료 검증: 화면에 싣기 전에 구조와 불변 조건을 확인한다 ──
export function validate(data) {
  const errs = [];
  const m = data?.manifest;
  if (!m || m.schema !== SCHEMA) errs.push("manifest.schema 불일치");
  const snaps = m?.snapshots || [], offs = data?.officials || [];
  const H = data?.holdings?.rows || [], TT = data?.totals?.rows || [];
  snaps.forEach((s, i) => {
    if (!s.id || !s.published || !s.basis) errs.push(`snapshot ${i}: id·공개일·기준일 필요`);
    if (s.basis > s.published) errs.push(`snapshot ${s.id}: 기준일이 공개일보다 늦음`);
    if (!m.synthetic && !/^https:\/\//.test(s.source?.url || "")) errs.push(`snapshot ${s.id}: 원문 주소 없음`);
  });
  const seen = new Set();
  for (const r of H) {
    const [si, oi, code, cls, value, count] = r;
    if (!snaps[si] || !offs[oi]) { errs.push(`holdings: 없는 시점·인물 참조 ${si}/${oi}`); continue; }
    if (!CLASSES[cls]) errs.push(`holdings: 알 수 없는 권리 구분 ${cls}`);
    if (!(Number.isInteger(value) && value >= 0)) errs.push(`holdings: 가액은 0 이상 정수(원) — ${value}`);
    if (!(Number.isInteger(count) && count > 0)) errs.push(`holdings: 항목 수는 1 이상 — ${count}`);
    const k = `${si}|${oi}|${code}|${cls}`;
    if (seen.has(k)) errs.push(`holdings: 중복 집계 ${k}`);
    seen.add(k);
  }
  for (const r of TT) {
    const [si, oi, , realEstate, , , debts] = r;
    if (!snaps[si] || !offs[oi]) errs.push(`totals: 없는 시점·인물 참조 ${si}/${oi}`);
    if (debts < 0) errs.push("totals: 채무는 양수로 기록(차감은 계산에서)");
    // 지역별 부동산 합 ≤ 인물의 부동산 총액(지역 미확인 포함 시 같다)
    const sum = H.filter((h) => h[0] === si && h[1] === oi).reduce((a, h) => a + h[4], 0);
    if (realEstate != null && sum !== realEstate) errs.push(`totals: ${offs[oi]?.name} ${snaps[si]?.id} 지역별 부동산 합(${sum})과 총액(${realEstate}) 불일치`);
  }
  return errs;
}

// ── 시점·대수·정당으로 묶은 집단 ──
// totals 행: [시점, 인물, 자산 합계(채무 제외), 부동산, 예금, 증권, 채무, 그 밖의 자산, 고지거부 항목 수] — 금액은 원
const TOTAL = { assets: 2, realEstate: 3, deposits: 4, securities: 5, debts: 6, other: 7, refused: 8 };
export function partyAt(official, date) {
  const p = (official.party || []).find((x) => (!x.from || x.from <= date) && (!x.to || x.to >= date));
  return p?.name || null;
}
export function inTerm(official, term) { return (official.terms || []).includes(Number(term)); }

export function cohort(data, { snapshot, term = null, party = null }) {
  const si = typeof snapshot === "number" ? snapshot : data.manifest.snapshots.findIndex((s) => s.id === snapshot);
  const snap = data.manifest.snapshots[si];
  if (!snap) return { si: -1, ids: new Set() };
  const disclosed = new Set(data.totals.rows.filter((r) => r[0] === si).map((r) => r[1]));
  const ids = new Set();
  for (const oi of disclosed) {
    const o = data.officials[oi];
    if (term && !inTerm(o, term)) continue;
    if (party && (partyAt(o, snap.basis) || "정당 확인 안 됨") !== party) continue;
    ids.add(oi);
  }
  return { si, ids, snap };
}

// ── 지역 집계 ──
// level 'sido' 는 시군구·시도까지만 아는 항목을 모두 시도에 올린다. 'sigungu' 는 시군구까지 아는 항목만, 나머지는 따로 센다.
export function regionAgg(data, { si, ids, classes = ["own"], level = "sido" }) {
  const out = new Map(), unplaced = { value: 0, count: 0, holders: new Set() };
  const add = (key, v, c, oi) => {
    let x = out.get(key);
    if (!x) out.set(key, (x = { value: 0, count: 0, holders: new Set() }));
    x.value += v; x.count += c; x.holders.add(oi);
  };
  for (const [s, oi, code, cls, v, c] of data.holdings.rows) {
    if (s !== si || !ids.has(oi) || !classes.includes(cls)) continue;
    if (code === "X" || code === "F") { unplaced.value += v; unplaced.count += c; unplaced.holders.add(oi); continue; }
    if (level === "sido") add(code.length === 2 ? code : sidoOf(code), v, c, oi);
    else if (code.length === 5) add(code, v, c, oi);
    else { unplaced.value += v; unplaced.count += c; unplaced.holders.add(oi); }
  }
  for (const x of out.values()) x.holders = x.holders.size;
  return { regions: out, unplaced: { ...unplaced, holders: unplaced.holders.size } };
}
export const metricOf = (x, metric) => (x ? x[metric] ?? 0 : null);

// ── 색 단계: 몇몇 큰 값 때문에 나머지가 한 색이 되지 않게 로그 분위수로 나눈다 ──
export function breaks(values, k = 6) {
  const v = values.filter((x) => x > 0).sort((a, b) => a - b);
  if (!v.length) return [];
  if (v.length <= k) return [...new Set(v)];
  const q = (p) => { const i = (v.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return Math.exp(Math.log(v[lo]) + (Math.log(v[hi]) - Math.log(v[lo])) * (i - lo)); };
  return [...new Set(Array.from({ length: k - 1 }, (_, i) => q((i + 1) / k)).map((x) => niceRound(x)))];
}
export function niceRound(x) {
  if (!(x > 0)) return 0;
  const p = 10 ** Math.floor(Math.log10(x)), m = x / p;
  return (m < 1.5 ? 1 : m < 2.5 ? 2 : m < 4 ? 3 : m < 7.5 ? 5 : 10) * p;
}
export const classOf = (value, br) => (value == null ? -1 : value === 0 ? 0 : 1 + br.filter((b) => value >= b).length);

// ── 두 시점 비교 · 증감 ──
// 같은 행정구역 기준, 같은 권리 구분. state: up/down/same/na(한쪽 시점에 자료 없음)
export function diff(aggA, aggB, metric = "value") {
  const keys = new Set([...aggA.regions.keys(), ...aggB.regions.keys()]);
  const out = new Map();
  for (const k of keys) {
    const a = aggA.regions.get(k), b = aggB.regions.get(k);
    const va = a ? a[metric] : 0, vb = b ? b[metric] : 0;
    out.set(k, { a: va, b: vb, d: vb - va, state: vb > va ? "up" : vb < va ? "down" : "same" });
  }
  return out;
}

// ── 순위 ──
export function rank(agg, metric = "value", n = 10) {
  return [...agg.regions.entries()].map(([code, x]) => ({ code, value: x[metric], ...x })).filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value || a.code.localeCompare(b.code)).slice(0, n).map((x, i) => ({ ...x, rank: i + 1 }));
}

// ── 집중도: 서울·수도권·비수도권 비중, 1인당 평균·중앙값, 상위 10% 비중 ──
export function concentration(data, { si, ids, classes = ["own"] }) {
  const sido = regionAgg(data, { si, ids, classes, level: "sido" });
  const total = [...sido.regions.values()].reduce((a, x) => a + x.value, 0) + sido.unplaced.value;
  const seoul = sido.regions.get("11")?.value || 0;
  const capital = [...sido.regions.entries()].filter(([k]) => CAPITAL.has(k)).reduce((a, [, x]) => a + x.value, 0);
  const per = [...ids].map((oi) => data.holdings.rows.filter((r) => r[0] === si && r[1] === oi && classes.includes(r[3])).reduce((a, r) => a + r[4], 0)).sort((a, b) => a - b);
  const n = per.length, sum = per.reduce((a, x) => a + x, 0);
  const median = n ? (n % 2 ? per[(n - 1) / 2] : (per[n / 2 - 1] + per[n / 2]) / 2) : null;
  const topN = Math.max(1, Math.round(n * 0.1)), top = per.slice(-topN).reduce((a, x) => a + x, 0);
  return {
    total, n, mean: n ? sum / n : null, median, holders: per.filter((x) => x > 0).length,
    share: total ? { seoul: seoul / total, capital: capital / total, nonCapital: (total - capital - sido.unplaced.value) / total, unplaced: sido.unplaced.value / total } : null,
    top10: sum ? { share: top / sum, n: topN } : null, max: per.at(-1) ?? null,
  };
}

// ── 인물 합계(totals) 조회 ──
export function totalsOf(data, si, oi) {
  const r = data.totals.rows.find((x) => x[0] === si && x[1] === oi);
  if (!r) return null;
  const o = Object.fromEntries(Object.entries(TOTAL).map(([k, i]) => [k, r[i]]));
  o.net = o.assets != null && o.debts != null ? o.assets - o.debts : null; // 공개 문서의 '재산 총액'
  return o;
}

// ── 변화 분해: 집단 신고재산 변화 = 공통 인물의 변화 + 신규 진입자 − 퇴장자 (같은 집계 기준일 때의 산술 항등식) ──
export function decompose(data, a, b, field = "net") {
  const val = (si, oi) => totalsOf(data, si, oi)?.[field] ?? null;
  const common = [...a.ids].filter((oi) => b.ids.has(oi));
  const entrants = [...b.ids].filter((oi) => !a.ids.has(oi));
  const exits = [...a.ids].filter((oi) => !b.ids.has(oi));
  const sum = (si, list) => list.reduce((acc, oi) => acc + (val(si, oi) ?? 0), 0);
  const A = sum(a.si, [...a.ids]), B = sum(b.si, [...b.ids]);
  const dCommon = sum(b.si, common) - sum(a.si, common), entr = sum(b.si, entrants), ex = sum(a.si, exits);
  return {
    A, B, delta: B - A, common: { n: common.length, delta: dCommon }, entrants: { n: entrants.length, value: entr }, exits: { n: exits.length, value: ex },
    identity: dCommon + entr - ex === B - A,
    // 공통 인물 개개인의 변화 — 증가·감소·변동 없음
    commonMoves: common.map((oi) => ({ oi, d: (val(b.si, oi) ?? 0) - (val(a.si, oi) ?? 0) })).sort((x, y) => y.d - x.d),
  };
}

// ── 인물 시계열 ──
export function personSeries(data, oi, classes = ["own", "lease", "right"]) {
  return data.manifest.snapshots.map((snap, si) => {
    const t = totalsOf(data, si, oi);
    if (!t) return { si, snap, t: null, regions: [] };
    const regions = data.holdings.rows.filter((r) => r[0] === si && r[1] === oi && classes.includes(r[3]))
      .map(([, , code, cls, value, count]) => ({ code, cls, value, count })).sort((x, y) => y.value - x.value);
    return { si, snap, t, regions, party: partyAt(data.officials[oi], snap.basis) };
  });
}

export function parties(data, si) {
  const snap = data.manifest.snapshots[si];
  const set = new Map();
  for (const r of data.totals.rows) if (r[0] === si) { const p = partyAt(data.officials[r[1]], snap.basis) || "정당 확인 안 됨"; set.set(p, (set.get(p) || 0) + 1); }
  return [...set.entries()].sort((a, b) => b[1] - a[1]);
}

// ── 금액 표기: 원 단위 정수를 '억·만 원'으로 ──
export function won(v, { short = false } = {}) {
  if (v == null || !Number.isFinite(v)) return "—";
  const neg = v < 0, x = Math.abs(Math.round(v));
  const eok = Math.floor(x / 1e8), man = Math.floor((x % 1e8) / 1e4);
  let s;
  if (eok >= 1) s = short ? `${(x / 1e8).toLocaleString("ko-KR", { maximumFractionDigits: eok >= 100 ? 0 : 1 })}억` : `${eok.toLocaleString("ko-KR")}억${man ? ` ${man.toLocaleString("ko-KR")}만` : ""}원`;
  else if (man >= 1) s = `${man.toLocaleString("ko-KR")}만${short ? "" : "원"}`;
  else s = `${x.toLocaleString("ko-KR")}원`;
  return (neg ? "−" : "") + s;
}
export const sidoName = (code) => SIDO[code] || code;
