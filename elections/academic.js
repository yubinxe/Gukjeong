// 국정 상황판 · 선거 후 시장 — 학술 활용(파일 이름은 어느 환경에서도 깨지지 않게 영문): 인용 · 자료 내려받기(CSV·코드북) · 그림 저장(SVG·PNG) · 그림/표 주기 · 참고문헌
import { csv } from '/cite/lib.mjs?v=1';
import { mount, save } from '/cite/cite.js?v=1';

const $ = (s, el = document) => el.querySelector(s);
const addDays = (iso, n) => new Date(Date.parse(iso) + n * 864e5).toISOString().slice(0, 10);
const stamp = (iso) => iso.slice(0, 10).replace(/-/g, '');

// 참고문헌 — Crossref 로 서지(저자·제목·학술지·권호·쪽·DOI)를 확인한 것만 싣는다(2026-11-24). MacKinlay(1997)는 DOI 가 없어 서지만.
export const REFS = [
  { apa: 'Białkowski, J., Gottschalk, K., & Wisniewski, T. P. (2008). Stock market volatility around national elections. <i>Journal of Banking &amp; Finance, 32</i>(9), 1941–1953.', doi: '10.1016/j.jbankfin.2007.12.021' },
  { apa: 'Goodell, J. W., & Vähämaa, S. (2013). US presidential elections and implied volatility: The role of political uncertainty. <i>Journal of Banking &amp; Finance, 37</i>(3), 1108–1117.', doi: '10.1016/j.jbankfin.2012.12.001' },
  { apa: 'MacKinlay, A. C. (1997). Event studies in economics and finance. <i>Journal of Economic Literature, 35</i>(1), 13–39.', doi: null },
  { apa: 'Pantzalis, C., Stangeland, D. A., & Turtle, H. J. (2000). Political elections and the resolution of uncertainty: The international evidence. <i>Journal of Banking &amp; Finance, 24</i>(10), 1575–1604.', doi: '10.1016/S0378-4266(99)00093-X' },
];

// 변수 설명(코드북) — 내려받는 CSV 의 열과 같은 이름
export const CODEBOOK = [
  ['election_id', '선거 식별자', 'P=대통령 선거, G=국회의원 선거, L=전국동시지방선거 + 대수(회수)'],
  ['kind', '선거 종류', 'P · G · L'],
  ['label', '선거 이름', '예: 제21대 대통령 선거'],
  ['election_date', '선거일', 'YYYY-MM-DD. 위키데이터 대조 + 코스피 휴장 달력 검증'],
  ['asset', '지표', 'kospi=코스피 지수, usdkrw=원·달러 환율(원/달러)'],
  ['t0', '기준일', '코스피: 선거일 직전 거래일 종가. 환율: 선거일 전날 뉴욕 정오 값'],
  ['close0', '기준값', '기준일 값(코스피 pt, 환율 원)'],
  ['ret_k', '누적 변화율(%)', '100 × (k번째 거래일 값 ÷ 기준값 − 1). k = 1, 5, 20, 60, 120'],
  ['vol_pre', '선거 전 변동성', '기준일까지 20거래일 일간 로그수익률의 표본 표준편차 × √250 (소수, 0.20 = 20%)'],
  ['vol_post20', '선거 뒤 변동성', '기준일 다음 20거래일, 같은 방법'],
  ['vol_post60', '선거 뒤 60일 변동성', '기준일 다음 60거래일, 같은 방법'],
  ['ratio', '변동성 비율', 'vol_post20 ÷ vol_pre (연율 상수와 무관)'],
  ['pct_*', '평시 백분위', '같은 계산을 모든 거래일에 했을 때의 분포에서 차지하는 위치(0~100, 같은 값은 절반씩). pct_absday1 은 다음 거래일 등락의 절대값 기준'],
  ['mdd60', '60일 최대 낙폭', '기준일~60거래일 구간, 그때까지 최고점 대비 가장 깊은 하락(소수, −0.20 = −20%)'],
  ['avail', '자료 길이', '기준일 뒤로 실제 자료가 있는 거래일 수(최대 120)'],
  ['k', '상대 거래일', '−20 … 120. 0 = 기준일'],
  ['date', '그날 날짜', '경로 파일에서 k에 해당하는 실제 거래일'],
  ['index', '경로 값', '기준값 = 100'],
  ['p10 … p90', '평시 분위', '모든 거래일을 기준일로 삼은 경로 분포의 분위(120거래일 뒤까지 자료가 있는 날만)'],
  ['p_binom_up', '이항검정 p', '선거 뒤가 더 출렁인 횟수에 대한 정확 이항검정(양쪽), 성공 확률 = 평시에 비율이 1을 넘는 비율'],
  ['p_binom_top', '이항검정 p', '평시 상위 10%를 넘은 횟수에 대한 정확 이항검정(한쪽), 성공 확률 0.1'],
];

const r = (v, d = 6) => (v == null ? '' : +v.toFixed(d));
export function summaryRows(D) {
  const head = ['election_id', 'kind', 'label', 'election_date', 'asset', 't0', 'close0', 'ret_1', 'ret_5', 'ret_20', 'ret_60', 'ret_120', 'vol_pre', 'vol_post20', 'vol_post60', 'ratio', 'pct_ratio', 'pct_absday1', 'pct_ret20', 'pct_ret60', 'mdd60', 'pct_mdd60', 'avail', 'note'];
  const rows = [head];
  for (const e of D.elections) for (const a of Object.keys(D.assets)) {
    const m = e.m[a]; if (!m) continue;
    rows.push([e.id, e.kind, e.label, e.date, a, m.t0, m.close0, r(m.ret[1], 4), r(m.ret[5], 4), r(m.ret[20], 4), r(m.ret[60], 4), r(m.ret[120], 4), r(m.volPre), r(m.volPost), r(m.volPost60), r(m.ratio), r(m.pct.ratio, 2), r(m.pct.absDay1, 2), r(m.pct.ret20, 2), r(m.pct.ret60, 2), r(m.mdd60), r(m.pct.mdd60, 2), m.avail, e.note || '']);
  }
  return rows;
}
export function pathRows(D) {
  const rows = [['election_id', 'asset', 'k', 'date', 'index']];
  for (const e of D.elections) for (const a of Object.keys(D.assets)) {
    const m = e.m[a]; if (!m) continue;
    m.path.forEach((v, j) => { if (v != null) rows.push([e.id, a, j - D.pre, addDays(m.t0, m.dd[j]), v]); });
  }
  return rows;
}
export function bandRows(D) {
  const rows = [['asset', 'k', 'p10', 'p25', 'p50', 'p75', 'p90']];
  for (const [a, x] of Object.entries(D.assets)) x.base.band.forEach((b, j) => rows.push([a, j - D.pre, ...b]));
  return rows;
}
export function testRows(D) {
  const rows = [['asset', 'group', 'n', 'median_ratio', 'base_median_ratio', 'up', 'p_base_up', 'p_binom_up', 'top10', 'expect_top10', 'p_binom_top']];
  for (const [a, g] of Object.entries(D.summary)) for (const [k, x] of Object.entries(g)) if (x) rows.push([a, k, x.n, x.medianRatio, x.baseMedianRatio, x.up, x.p1, x.pUp, x.top, x.expectTop, x.pTop]);
  return rows;
}

/* ── 그림 저장: 화면의 SVG 에 계산된 스타일을 박아 넣고, 그림 번호·제목·출처 줄을 덧붙인다 ── */
const PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-opacity', 'opacity', 'font-size', 'font-weight', 'font-family', 'text-anchor', 'visibility'];
function standalone(svg, { title, source }) {
  const vb = svg.viewBox.baseVal, W = vb.width, H = vb.height;
  const clone = svg.cloneNode(true);
  const src = [svg, ...svg.querySelectorAll('*')], dst = [clone, ...clone.querySelectorAll('*')];
  src.forEach((el, i) => {
    const cs = getComputedStyle(el), st = [];
    for (const p of PROPS) { const v = cs.getPropertyValue(p); if (v && v !== 'normal') st.push(`${p}:${v}`); }
    dst[i].setAttribute('style', st.join(';'));
    dst[i].removeAttribute('class');
  });
  clone.querySelectorAll('.hit,.row-hit,[visibility="hidden"]').forEach((n) => n.remove());
  dst.forEach((n) => { if (n.getAttribute?.('style')?.includes('visibility:hidden')) n.remove(); });
  const root = getComputedStyle(document.documentElement);
  const bg = root.getPropertyValue('--panel').trim() || '#f8f4ea', ink = root.getPropertyValue('--text').trim() || '#1d241f', muted = root.getPropertyValue('--muted').trim() || '#5d5f55';
  const top = 44, bottom = 22 + 18 * source.length, padX = 24;
  const out = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  out.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  out.setAttribute('viewBox', `0 0 ${W + padX * 2} ${H + top + bottom}`);
  out.setAttribute('width', W + padX * 2); out.setAttribute('height', H + top + bottom);
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  out.innerHTML = `<rect width="100%" height="100%" fill="${bg}"/>
    <text x="${padX}" y="28" style="font-family:'Noto Serif KR',serif;font-size:17px;font-weight:700;fill:${ink}">${esc(title)}</text>
    <g transform="translate(${padX},${top})">${clone.innerHTML}</g>
    ${source.map((l, i) => `<text x="${padX}" y="${H + top + 22 + i * 18}" style="font-family:'Pretendard Variable',Pretendard,sans-serif;font-size:11.5px;fill:${muted}">${esc(l)}</text>`).join('')}`;
  return { svg: new XMLSerializer().serializeToString(out), W: W + padX * 2, H: H + top + bottom };
}
async function toPNG({ svg, W, H }, scale = 2) {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const c = Object.assign(document.createElement('canvas'), { width: W * scale, height: H * scale });
  const g = c.getContext('2d'); g.scale(scale, scale); g.drawImage(img, 0, 0);
  return new Promise((res) => c.toBlob(res, 'image/png'));
}
function saveBlob(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 4000); // 바로 지우면 일부 브라우저가 파일 이름을 잃는다
}

/* ── 화면에 붙이기 ── */
export function academic({ getD, getS, A, sel, label }) {
  const D = () => getD();
  // 그림·표 아래 출처와 주(학술 관례: '자료:' · '주:')
  const sources = () => {
    const d = D(), S = getS(), a = A(), g = d.summary[S.asset][S.kind];
    const asOf = d.asOf.slice(0, 10);
    const calc = `계산: 국정 상황판(${asOf})`;
    return {
      elPath: [`자료: ${a.src}. ${calc}.`, `주: 기준일 = 100. ${a.t0}. 띠는 모든 거래일(${a.base.n.toLocaleString('ko-KR')}일)을 기준일로 삼은 경로의 10~90 분위(진한 곳 25~75).`],
      elRatio: [`자료: ${a.src}. ${calc}.`, `주: 변동성 = 일간 로그수익률 표준편차(20거래일). 띠는 평시 비율 분포의 10~90 분위, 점선은 중앙값. 가로축 로그 눈금.${g ? ` 선거 ${g.n}번.` : ''}`],
      elTable: [`자료: ${a.src}. ${calc}.`, '주: 백분위는 같은 계산을 모든 거래일에 했을 때의 위치. 같은 시기 사건은 인과가 아니라 구간이 겹친 일.'],
    };
  };
  const paintSources = () => { const s = sources(); for (const [id, lines] of Object.entries(s)) { const el = $(`#${id}Src`); if (el) el.textContent = lines.join(' '); } };
  const titleOf = { elPath: () => `그림 1. 투표 전날 = 100으로 본 ${A().name} 경로`, elRatio: () => `그림 2. 선거 뒤 20거래일 변동성 ÷ 선거 전 20거래일 (${A().name})`, elTable: () => `표 1. 선거별 수치 (${A().name})` };
  const tag = () => { const S = getS(); return `${S.asset}-${S.kind}${S.H !== 60 ? `-${S.H}` : ''}`; };

  // 그림마다: SVG · PNG / 표: CSV
  for (const box of document.querySelectorAll('.el-figtools')) {
    const id = box.dataset.fig;
    if (id === 'elTable') {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'ct-open', textContent: '표 1 CSV' });
      b.onclick = () => save(`gukjeong_elections_table1_${tag()}_${stamp(D().asOf)}.csv`, csv(summaryRows(D()).filter((row, i) => i === 0 || (row[4] === getS().asset && (getS().kind === 'all' || row[1] === getS().kind)))), 'text/csv');
      box.append(b);
      continue;
    }
    for (const fmt of ['SVG', 'PNG']) {
      const b = Object.assign(document.createElement('button'), { type: 'button', className: 'ct-open', textContent: `${id === 'elPath' ? '그림 1' : '그림 2'} ${fmt}` });
      b.onclick = async () => {
        const svg = $(`#${id} svg`); if (!svg) return;
        const s = standalone(svg, { title: titleOf[id](), source: sources()[id] });
        const name = `gukjeong_elections_${id === 'elPath' ? 'fig1' : 'fig2'}_${tag()}${id === 'elPath' && sel() ? `_${sel().id}` : ''}_${stamp(D().asOf)}.${fmt.toLowerCase()}`;
        if (fmt === 'SVG') saveBlob(name, new Blob([s.svg], { type: 'image/svg+xml' }));
        else saveBlob(name, await toPNG(s));
      };
      box.append(b);
    }
  }

  // 자료 내려받기 목록
  const files = [
    ['선거별 수치 (두 지표 · 26개 선거)', 'summary', () => csv(summaryRows(D())), 'csv'],
    ['선거 앞뒤 경로 (긴 형식: 선거 × 지표 × 거래일)', 'paths', () => csv(pathRows(D())), 'csv'],
    ['평시 범위 (지표 × 거래일 분위)', 'baseline', () => csv(bandRows(D())), 'csv'],
    ['검정 요약 (지표 × 선거 묶음)', 'tests', () => csv(testRows(D())), 'csv'],
    ['변수 설명(코드북)', 'codebook', () => csv([['variable', 'name', 'definition'], ...CODEBOOK]), 'csv'],
    ['전체 계산 결과 (JSON)', 'events', () => JSON.stringify(D(), null, 1), 'json'],
  ];
  $('#elDl').innerHTML = `<ul class="el-files">${files.map(([t, k, , ext]) => `<li><span>${t}</span><button type="button" class="ct-open" data-file="${k}">${ext.toUpperCase()}</button></li>`).join('')}</ul>`;
  $('#elDl').onclick = (e) => {
    const b = e.target.closest('[data-file]'); if (!b) return;
    const f = files.find((x) => x[1] === b.dataset.file);
    save(`gukjeong_elections_${f[1]}_${stamp(D().asOf)}.${f[3]}`, f[2](), f[3] === 'csv' ? 'text/csv' : 'application/json');
  };
  $('#elCodebook').innerHTML = `<thead><tr><th scope="col">열 이름</th><th scope="col">뜻</th><th scope="col">정의</th></tr></thead><tbody>${CODEBOOK.map(([v, n, d]) => `<tr><th scope="row"><code>${v}</code></th><td>${n}</td><td class="note">${d}</td></tr>`).join('')}</tbody>`;
  $('#elRefs').innerHTML = REFS.map((x) => `<li>${x.apa}${x.doi ? ` <a href="https://doi.org/${x.doi}" target="_blank" rel="noopener">https://doi.org/${x.doi}</a>` : ''}</li>`).join('');

  // 인용하기 · 인쇄
  const acad = $('#elAcad');
  mount(acad, () => {
    const d = D(), S = getS(), e = sel();
    return {
      title: '선거 후 시장', sub: `${A().name} · ${S.kind === 'all' ? '전국 단위 선거' : d.kinds[S.kind].name}${e ? ` · ${e.label} 강조` : ''}`,
      kind: 'visualization', url: location.href, issued: d.asOf, version: `자료 ${A().first}~${A().last}`, key: `elections_${S.asset}`,
      note: `${A().src}. 계산 방법은 화면의 '자료와 방법' 참조`,
    };
  }, { label: '인용하기' });
  const pr = Object.assign(document.createElement('button'), { type: 'button', className: 'ct-open', textContent: '인쇄 · PDF' });
  pr.onclick = () => print();
  acad.append(pr);
  const dl = Object.assign(document.createElement('a'), { className: 'ct-open el-jump', href: '#elDataH', textContent: '자료 내려받기' });
  acad.append(dl);
  // 인쇄 머리: 주소와 자료 기준(종이로 나눠 줄 때 출처가 남게)
  const ph = document.createElement('p'); ph.className = 'el-printhead'; acad.after(ph);
  const paintPrint = () => { ph.textContent = `${label()} · ${location.href} · 계산 ${D().asOf.slice(0, 10)} · 인쇄 ${new Date().toISOString().slice(0, 10)}`; };
  addEventListener('beforeprint', paintPrint);
  return { paint: () => { paintSources(); paintPrint(); } };
}
