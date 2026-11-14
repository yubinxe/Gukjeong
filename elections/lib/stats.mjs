// 선거 후 시장 변동성 — 사건 연구(event study) 계산 엔진 (의존성 0, 브라우저·Node 공용)
// 정의
//   기준일 T0 = 선거일 직전 마지막 거래일 종가(선거일은 공휴일로 휴장). k일 = T0 다음 k번째 거래일.
//   경로 P_k = 100 × C(T0+k) / C(T0)        일간 수익률 r = ln(C_t / C_t-1)
//   변동성 = 일간 수익률 표준편차(표본, n−1) × √250  — 선거 전: r(−19…0) 20개, 선거 후: r(1…20) 20개
//   변동성 비율 = 선거 후 20일 ÷ 선거 전 20일  (연율화 상수가 약분되므로 토요일 거래가 있던 1998년 이전에도 비교 가능)
//   최대 낙폭 = 0…H 구간에서 그때까지의 최고점 대비 가장 깊은 하락(T0 포함)
//   평시 분포 = 같은 자료의 모든 거래일을 T0 로 놓고 같은 방식으로 잰 값들의 분위 — '선거가 아닌 날'과 견주기 위한 기준
// 원칙: 표본이 모자라면 값을 비운다(null). 인과를 말하지 않는다.

export const PRE = 20, POST = 20, ANN = Math.sqrt(250);

export const ln = Math.log;
export function std(a) {
  const n = a.length;
  if (n < 2) return null;
  const m = a.reduce((s, x) => s + x, 0) / n;
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (n - 1));
}
// 정렬된 배열의 분위(선형 보간, R type 7)
export function quantile(sorted, q) {
  if (!sorted.length) return null;
  const h = (sorted.length - 1) * q, lo = Math.floor(h), hi = Math.ceil(h);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}
// x 가 분포에서 차지하는 백분위(0~100, 같은 값은 절반씩)
export function percentileOf(sorted, x) {
  if (!sorted.length || x == null) return null;
  let lo = 0, hi = sorted.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sorted[m] < x) lo = m + 1; else hi = m; }
  let eq = lo; while (eq < sorted.length && sorted[eq] === x) eq++;
  return ((lo + (eq - lo) / 2) / sorted.length) * 100;
}

// rows: [[YYYYMMDD 또는 YYYY-MM-DD, 종가], …] 오름차순 → { d:[ISO], c:[num] }
export function series(rows) {
  const d = [], c = [];
  for (const [t, v] of rows) {
    const x = Number(v);
    if (!Number.isFinite(x) || x <= 0) continue;
    const iso = /^\d{8}$/.test(t) ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : t;
    if (d.length && iso <= d.at(-1)) throw new Error(`날짜 순서 오류: ${iso}`);
    d.push(iso); c.push(x);
  }
  return { d, c };
}
// 선거일 직전 마지막 거래일의 위치. 선거일 당일이 거래일이면 오류(선거일 표기 오류를 잡는다)
export function anchorIndex(s, electionISO, { holiday = true } = {}) {
  let lo = 0, hi = s.d.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (s.d[m] < electionISO) lo = m + 1; else hi = m; }
  if (holiday && s.d[lo] === electionISO) throw new Error(`${electionISO} 이 거래일입니다 — 선거일(공휴일) 표기를 확인`);
  return lo - 1; // 직전 거래일
}
const rets = (s, from, to) => { const r = []; for (let i = from; i <= to; i++) r.push(ln(s.c[i] / s.c[i - 1])); return r; };
export function volAt(s, i0, { pre = PRE, post = POST } = {}) {
  const a = i0 - pre + 1 >= 1 ? std(rets(s, i0 - pre + 1, i0)) : null;
  const b = i0 + post < s.c.length ? std(rets(s, i0 + 1, i0 + post)) : null;
  return { pre: a, post: b, ratio: a && b != null ? b / a : null };
}
export function maxDrawdown(path) {
  let peak = -Infinity, mdd = 0;
  for (const v of path) { if (v == null) break; peak = Math.max(peak, v); mdd = Math.min(mdd, v / peak - 1); }
  return mdd;
}

// 사건 하나: 경로(−PRE…H), 변동성, 수익률, 낙폭, 다음 날 움직임
export function eventStudy(s, electionISO, { H = 120, minStart = null, holiday = true } = {}) {
  const i0 = anchorIndex(s, electionISO, { holiday });
  if (i0 < PRE || (minStart && s.d[i0 - PRE] < minStart)) return null; // 비교 구간이 자료(또는 제도) 시작 이전
  const base = s.c[i0];
  const path = [], dd = [];
  const day0 = Date.parse(s.d[i0]);
  for (let k = -PRE; k <= H; k++) {
    const i = i0 + k;
    path.push(i < s.c.length ? +(100 * s.c[i] / base).toFixed(3) : null);
    dd.push(i < s.c.length ? Math.round((Date.parse(s.d[i]) - day0) / 864e5) : null); // 기준일로부터 달력 날수(툴팁 날짜용)
  }
  const at = (k) => path[k + PRE] ?? null;
  const v20 = volAt(s, i0), v60 = volAt(s, i0, { post: 60 });
  const avail = Math.min(H, s.c.length - 1 - i0);
  const fwd = path.slice(PRE);
  return {
    t0: s.d[i0], t1: s.d[i0 + 1] ?? null, close0: base, avail,
    path, dd,
    ret: Object.fromEntries([1, 5, 20, 60, 120].map((k) => [k, at(k) == null ? null : +(at(k) - 100).toFixed(3)])),
    volPre: v20.pre == null ? null : v20.pre * ANN, volPost: v20.post == null ? null : v20.post * ANN,
    volPost60: v60.post == null ? null : v60.post * ANN, ratio: v20.ratio,
    mdd60: avail >= 60 ? maxDrawdown(fwd.slice(0, 61)) : null,
    day1: i0 + 1 < s.c.length ? ln(s.c[i0 + 1] / s.c[i0]) : null,
  };
}

// 평시 분포: 모든 거래일을 T0 로 놓고 같은 지표를 잰다
export function baseline(s, { H = 120, minStart = null, qs = [0.1, 0.25, 0.5, 0.75, 0.9] } = {}) {
  const ratio = [], absDay1 = [], volPost = [], ret20 = [], ret60 = [], mdd60 = [];
  const cols = Array.from({ length: PRE + H + 1 }, () => []);
  for (let i0 = PRE; i0 < s.c.length - 1; i0++) {
    if (minStart && s.d[i0 - PRE] < minStart) continue;
    const v = volAt(s, i0);
    if (v.ratio != null) { ratio.push(v.ratio); volPost.push(v.post * ANN); }
    absDay1.push(Math.abs(ln(s.c[i0 + 1] / s.c[i0])));
    if (i0 + 20 < s.c.length) ret20.push(100 * (s.c[i0 + 20] / s.c[i0] - 1));
    if (i0 + 60 < s.c.length) {
      ret60.push(100 * (s.c[i0 + 60] / s.c[i0] - 1));
      const p = []; for (let k = 0; k <= 60; k++) p.push(s.c[i0 + k] / s.c[i0]);
      mdd60.push(maxDrawdown(p));
    }
    for (let k = -PRE; k <= H; k++) { const i = i0 + k; if (i < s.c.length && i0 + H < s.c.length) cols[k + PRE].push(100 * s.c[i] / s.c[i0]); }
  }
  const srt = (a) => a.sort((x, y) => x - y);
  [ratio, absDay1, volPost, ret20, ret60, mdd60].forEach(srt);
  const band = cols.map((c) => { srt(c); return qs.map((q) => +quantile(c, q).toFixed(3)); });
  return { n: ratio.length, qs, band, dist: { ratio, absDay1, volPost, ret20, ret60, mdd60 } };
}
// 화면에 내보낼 요약 분위(원 분포 전체는 싣지 않는다)
export const QS = [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95];
export const summarize = (sorted) => QS.map((q) => +quantile(sorted, q).toFixed(5));

// 여러 사건의 중앙값 경로(그날 값이 있는 사건만)
export function medianPath(paths) {
  const L = Math.max(0, ...paths.map((p) => p.length));
  const out = [];
  for (let j = 0; j < L; j++) {
    const v = paths.map((p) => p[j]).filter((x) => x != null).sort((a, b) => a - b);
    out.push(v.length >= 3 ? +quantile(v, 0.5).toFixed(3) : null);
  }
  return out;
}

// 정확 이항검정: n번 중 k번, 성공 확률 p (two: 양쪽, 아니면 k 이상 한쪽)
export function binom(k, n, p, { two = true } = {}) {
  const lg = (x) => { let s = 0; for (let i = 2; i <= x; i++) s += Math.log(i); return s; };
  const pmf = (i) => Math.exp(lg(n) - lg(i) - lg(n - i) + i * Math.log(p) + (n - i) * Math.log(1 - p));
  if (!two) { let s = 0; for (let i = k; i <= n; i++) s += pmf(i); return Math.min(1, s); }
  const pk = pmf(k); let s = 0;
  for (let i = 0; i <= n; i++) { const q = pmf(i); if (q <= pk * (1 + 1e-7)) s += q; }
  return Math.min(1, s);
}
// 선거 묶음 요약: 평시 분포(sorted ratio)와 견준다
export function groupSummary(rows, baseRatioSorted) {
  const r = rows.filter((x) => x?.ratio != null);
  const n = r.length;
  if (!n) return null;
  const ratios = r.map((x) => x.ratio).sort((a, b) => a - b);
  const p1 = 1 - percentileOf(baseRatioSorted, 1) / 100; // 평시에 변동성이 커지는(비율>1) 확률
  const up = r.filter((x) => x.ratio > 1).length;
  const top = r.filter((x) => x.pct.ratio > 90).length;
  return {
    n, medianRatio: +quantile(ratios, 0.5).toFixed(4), baseMedianRatio: +quantile(baseRatioSorted, 0.5).toFixed(4),
    up, p1: +p1.toFixed(4), pUp: +binom(up, n, p1).toFixed(4),
    top, expectTop: +(n * 0.1).toFixed(2), pTop: +binom(top, n, 0.1, { two: false }).toFixed(4),
  };
}
