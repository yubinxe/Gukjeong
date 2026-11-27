// 국정 한눈에 — 상황판 스크립트 (ES 모듈, 외부 라이브러리 없음)

const SOURCES = ['/api/dashboard', 'data/dashboard.json']; // 실시간 API, 실패 시 저장된 스냅샷
const REFRESH_MS = 5 * 60 * 1000; // 서버 CDN 캐시(5분)와 맞춤
const STALE_MS = 2 * 60 * 60 * 1000;
const RECENT_MS = 60 * 60 * 1000;
const INAUGURATION = Date.UTC(2025, 5, 4); // 제21대 대통령 취임일 (2025-06-04)

const $ = (id) => document.getElementById(id);
const state = { data: null, section: 'all', query: '', kw: '', view: 'home' };
const storyBy = new Map(); // 링크 -> 사안 (보도 흐름 팝오버용)

/* ── 형식 ── */
const tz = { timeZone: 'Asia/Seoul' };
const fmt = {
  date: new Intl.DateTimeFormat('ko-KR', { ...tz, month: 'long', day: 'numeric', weekday: 'short' }),
  hm: new Intl.DateTimeFormat('ko-KR', { ...tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
  md: new Intl.DateTimeFormat('ko-KR', { ...tz, month: 'numeric', day: 'numeric' }),
  mdLong: new Intl.DateTimeFormat('ko-KR', { ...tz, month: 'long', day: 'numeric' }),
  mdhm: new Intl.DateTimeFormat('ko-KR', { ...tz, month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }),
  hour: new Intl.DateTimeFormat('en-US', { ...tz, hour: 'numeric', hourCycle: 'h23' }),
  ymd: new Intl.DateTimeFormat('en-CA', { ...tz }),
  rel: new Intl.RelativeTimeFormat('ko', { numeric: 'auto' }),
};
const num = (n, d) => n.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
const dayOf = (d) => fmt.ymd.format(d);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function ago(iso) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return '방금';
  if (min < 60) return fmt.rel.format(-min, 'minute');
  if (min < 1440) return fmt.rel.format(-Math.floor(min / 60), 'hour');
  return fmt.rel.format(-Math.floor(min / 1440), 'day');
}
const stamp = (iso) => (dayOf(new Date(iso)) === dayOf(new Date()) ? fmt.hm.format(new Date(iso)) : fmt.md.format(new Date(iso)));
const isRecent = (iso) => Date.now() - Date.parse(iso) < RECENT_MS;
const outlets = (it) => 1 + (it.related?.length || 0);

function highlight(text) {
  const safe = esc(text);
  const terms = state.query.trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return safe;
  const re = new RegExp(`(${terms.map((t) => esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi');
  return safe.replace(re, '<mark>$1</mark>');
}

/* ── 기사 저장(책갈피): 이 기기의 브라우저 저장소에 보관 ── */
const BM_KEY = 'bookmarks-v1';
const bmReg = new Map(); // 링크 -> 화면에 그린 기사 정보
let bmList = (() => { try { const l = JSON.parse(localStorage.getItem(BM_KEY) || '[]'); return Array.isArray(l) ? l : []; } catch { return []; } })();
const bmHas = (link) => bmList.some((b) => b.link === link);
function bmSave() { try { localStorage.setItem(BM_KEY, JSON.stringify(bmList)); return true; } catch { return false; } }
function bmBtn(it) {
  if (!it?.link) return '';
  bmReg.set(it.link, { link: it.link, title: it.title, titleKo: it.titleKo || null, source: it.source || it.outletKo || '', publishedAt: it.publishedAt || null, image: it.image || null });
  const on = bmHas(it.link);
  return `<button type="button" class="bm" data-bm="${esc(it.link)}" aria-pressed="${on}" aria-label="${on ? '저장 취소' : '기사 저장'}" title="${on ? '저장 취소' : '기사 저장'}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5h8v11.2l-4-2.9-4 2.9z"/></svg></button>`;
}
function bmSync() {
  const n = bmList.length;
  const badge = document.getElementById('bmN');
  if (badge) { badge.hidden = !n; badge.textContent = n > 99 ? '99+' : String(n); }
  document.getElementById('bmBtn')?.setAttribute('aria-label', `저장한 기사 ${n}건`);
  document.querySelectorAll('[data-bm]').forEach((b) => { const on = bmHas(b.dataset.bm); b.setAttribute('aria-pressed', on); if (b.classList.contains('bm')) { b.title = on ? '저장 취소' : '기사 저장'; b.setAttribute('aria-label', b.title); } });
}
function bmToggle(link) {
  if (bmHas(link)) { bmList = bmList.filter((b) => b.link !== link); bmSave(); bmSync(); return false; }
  const it = bmReg.get(link); if (!it) return false;
  bmList = [{ ...it, savedAt: new Date().toISOString() }, ...bmList].slice(0, 500);
  if (!bmSave()) { bmList.shift(); toast('저장 공간이 부족해 저장하지 못했어요'); return false; }
  bmSync(); return true;
}
function bmSheet() {
  const sec = (d) => (d ? fmt.mdhm.format(new Date(d)) : '');
  return `<div class="bml"><p class="dw-note" style="margin-top:0">저장한 기사는 이 기기의 브라우저에만 보관됩니다(로그인·동기화 없음). 사이트 데이터를 지우면 함께 지워집니다.</p>
    ${bmList.length ? `<ol class="bml-l">${bmList.map((b) => `<li>
      ${b.image ? `<span class="pic bml-img"><img src="${esc(b.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></span>` : ''}
      <div><a href="${esc(b.link)}" target="_blank" rel="noopener noreferrer"><span class="hl">${esc(b.titleKo || b.title)}</span></a>
        ${b.titleKo && b.titleKo !== b.title ? `<p class="bml-o" lang="en">${esc(b.title)}</p>` : ''}
        <p class="meta"><span>${esc(b.source)}</span>${b.publishedAt ? `<span>기사 ${sec(b.publishedAt)}</span>` : ''}<span>저장 ${sec(b.savedAt)}</span></p></div>
      <button type="button" class="bml-x" data-bm="${esc(b.link)}" aria-label="저장 취소">삭제</button></li>`).join('')}</ol>
      <div class="bml-tools"><button type="button" class="more-d" data-bm-copy>목록 복사</button><button type="button" class="more-d" data-bm-clear>모두 지우기</button></div>`
      : '<p class="empty">저장한 기사가 없습니다. 기사 옆 책갈피 표시를 누르면 여기에 모입니다.</p>'}</div>`;
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-bm],[data-bm-copy],[data-bm-clear],#bmBtn');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  if (b.id === 'bmBtn') { openSheet(`저장한 기사 ${bmList.length}건`, bmSheet()); return; }
  if ('bmCopy' in b.dataset) { navigator.clipboard?.writeText(bmList.map((x) => `- ${x.titleKo || x.title} (${x.source}) ${x.link}`).join('\n')).then(() => toast('목록을 복사했어요')); return; }
  if ('bmClear' in b.dataset) { if (confirm(`저장한 기사 ${bmList.length}건을 모두 지울까요?`)) { bmList = []; bmSave(); bmSync(); openSheet('저장한 기사 0건', bmSheet()); } return; }
  const saved = bmToggle(b.dataset.bm);
  if (b.classList.contains('bml-x')) { openSheet(`저장한 기사 ${bmList.length}건`, bmSheet()); return; }
  toast(saved ? '저장했어요 · 위쪽 책갈피에서 볼 수 있어요' : '저장을 취소했어요');
}, true);
addEventListener('storage', (e) => { if (e.key === BM_KEY) { try { bmList = JSON.parse(e.newValue || '[]'); } catch { bmList = []; } bmSync(); } });

/* ── 조각 ── */
const headline = (it) => `<a href="${esc(it.link)}" target="_blank" rel="noopener noreferrer"><span class="hl">${highlight(it.title)}</span></a>`;
const relBtn = (it) => (it.related?.length
  ? `<button type="button" class="rel-btn" data-rel="${esc(it.link)}" aria-haspopup="dialog">언론 ${outlets(it)}곳</button>` : '');

const stageChip = (it) => (it.stage === '급증' || it.stage === '지속' ? `<span class="stage">보도 ${it.stage}</span>` : '');
const exclChip = (it) => (it.exclusive ? '<span class="excl">단독</span>' : '') + (it.opinion ? '<span class="opin">의견</span>' : '');
function meta(it, { section = false } = {}) {
  return `<div class="meta">${exclChip(it)}${stageChip(it)}${section ? `<span class="tag">${esc(it.sectionName)}</span>` : ''}<span>${esc(it.source)}</span>${relBtn(it)}${bmBtn(it)}</div>`;
}

// 매체 유형별 보도 분포 (전국 의제인지 가늠). 순서는 고정
const MIX_ORDER = ['통신', '방송', '종합지', '경제지', '지역지', '정부', '기타'];
function mixBar(it) {
  const mix = it.mix || {};
  const total = Object.values(mix).reduce((x, y) => x + y, 0);
  if (!total) return '';
  const parts = MIX_ORDER.filter((t) => mix[t]);
  return `<div class="mix" role="img" aria-label="${esc(parts.map((t) => `${t} ${mix[t]}곳`).join(', '))}">
    <div class="mix-bar">${parts.map((t) => `<i class="m-${MIX_ORDER.indexOf(t)}" style="flex:${mix[t]}"></i>`).join('')}</div>
    <p class="mix-legend">${parts.map((t) => `<span><i class="m-${MIX_ORDER.indexOf(t)}"></i>${t} ${mix[t]}</span>`).join('')}</p></div>`;
}
const SCOPE = { 전국: '전국 매체 보도', 소수: '소수 매체 보도', 지역: '지역 매체 중심' };
const feedItem = (it, opts = {}) => `<li class="${it.image ? 'has-img' : ''}">
  <time class="${isRecent(it.publishedAt) ? 'recent' : ''}" datetime="${it.publishedAt}">${opts.long ? fmt.mdhm.format(new Date(it.publishedAt)) : stamp(it.publishedAt)}</time>
  <div>${headline(it)}${meta(it, opts)}</div>${it.image ? img(it.image, 'fthumb') : ''}</li>`;

function spark(values) {
  if (!values || values.length < 2) return '';
  const w = 100, h = 32;
  const min = Math.min(...values), max = Math.max(...values), span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, h - 2 - ((v - min) / span) * (h - 4)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  const y0 = pts[0][1].toFixed(1);
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
    <path class="area" d="${d}L${w} ${h}L0 ${h}Z"/>
    <line class="base" x1="0" x2="${w}" y1="${y0}" y2="${y0}" vector-effect="non-scaling-stroke"/>
    <path class="line" d="${d}" vector-effect="non-scaling-stroke"/></svg>`;
}

const allItems = () => state.data.sections.flatMap((s) => s.items.map((it) => ({ ...it, sectionId: s.id, sectionName: s.name })));
const onTop = () => new Set((state.data.headlines || []).map((h) => h.link));

/* ── 렌더링 ── */
function renderMarkets() {
  const list = state.data.markets;
  $('markets').innerHTML = list.map((m, i) => {
    const first = i === 0 || list[i - 1].group !== m.group;
    const dir = m.change > 0 ? 'up' : m.change < 0 ? 'down' : 'flat';
    const mark = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '';
    const sign = m.change > 0 ? '+' : m.change < 0 ? '−' : '';
    const t = new Date(m.asOf);
    const [h, mi] = fmt.hm.format(t).split(':').map(Number);
    const kr = m.id === 'kospi' || m.id === 'kosdaq';
    const asOf = kr && h * 60 + mi >= 15 * 60 + 30 ? `${fmt.mdLong.format(t)} 종가` : `${fmt.mdhm.format(t)} 기준`;
    return `<div class="kpi ${dir}${first ? ' g-first' : ''}" title="${esc(asOf)}" role="group" aria-label="${esc(`${m.name} ${num(m.price, m.digits)}${m.unit}, 전일 대비 ${sign}${num(Math.abs(m.changePct), 2)}%`)}">
      <p class="kpi-n">${m.group ? `<span class="kpi-g">${esc(m.group)}${m.status ? ` · ${esc(m.status)}` : ''}</span>` : ''}${esc(m.name)}${m.note ? `<small>${esc(m.note)}</small>` : ''}</p>
      <p class="kpi-c ${dir}">${mark} ${sign}${num(Math.abs(m.changePct), 2)}%</p>
      <p class="kpi-p" style="color:var(--text)">${num(m.price, m.digits)}${m.unit ? `<small>${esc(m.unit)}</small>` : ''}</p>
      ${spark(m.spark)}
      <p class="kpi-a">${asOf} · 전일 대비 <span class="${dir}">${sign}${num(Math.abs(m.change), m.digits)}</span></p>
    </div>`;
  }).join('') || '<p class="empty">시세를 불러오지 못했습니다.</p>';
}

const img = (src, cls, alt = '') =>
  `<span class="pic ${cls}"><img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></span>`;

function renderBanner() {
  const d = state.data;
  const sig = d.signals || [];
  const count = (k) => sig.filter((s) => s.kind === k).length;
  $('banner-h').textContent = `${fmt.date.format(new Date())}, ${$('term').textContent}`;
  $('bannerSum').innerHTML = `주요 사안 <b>${(d.headlines || []).length}</b>건 · 보도 급증 <b>${count('spread')}</b>건 · 보도 지속 <b>${count('persist')}</b>건 · 시장 변동 <b>${count('market')}</b>건`;
  const ix = d.indices;
  if (!ix) { $('gauges').innerHTML = ''; return; }
  const t = ix.temperature;
  $('navTemp').hidden = false; $('navTempV').textContent = t.value; $('navTempL').textContent = t.level;
  $('navTemp').dataset.lv = t.value >= 75 ? '4' : t.value >= 55 ? '3' : t.value >= 35 ? '2' : '1';
  $('gauges').innerHTML = `
    <div class="g-temp" title="보도가 얼마나 빠르고 한쪽으로 몰리는지를 나타낸 값입니다(0~100). 국정에 대한 평가나 여론조사가 아닙니다.">
      <dt>보도 집중 지수</dt>
      <dd><span class="g-big"><span data-count="${t.value}">${t.value}</span></span><span class="g-lv">${t.level}</span>
        <span class="g-scale" aria-hidden="true"><i style="--w:${t.value}%"></i></span></dd></div>
    <div title="${esc(ix.speed.note)}"><dt>보도 속도</dt><dd><span class="g-num">${ix.speed.value}</span><small>%</small><span class="g-sub">최근 3시간 비중</span></dd></div>
    <div title="${esc(ix.focus.title)}"><dt>최대 사안 비중</dt><dd><span class="g-num">${ix.focus.value}</span><small>%</small><span class="g-sub">전체 보도 중</span></dd></div>
    <div><dt>보도량</dt><dd><span class="g-num" data-count="${ix.volume.value}">${ix.volume.value.toLocaleString('ko-KR')}</span><small>건</small><span class="g-sub">24시간 · ${ix.volume.outlets}개 매체</span></dd></div>
    <div><dt>시장 등락</dt><dd><span class="g-num">${d.markets.filter((x) => x.change > 0).length}</span><small>/${d.markets.length} 상승</small><span class="g-sub">평균 변동 ${ix.market.vol}%</span></dd></div>`;
}

// 3줄 브리핑: 숫자와 사실만으로 문장을 만든다
// 3줄 브리핑: 숫자와 사실만으로. 줄(또는 조각)마다 누르면 상세 서랍이 열린다
function briefItems() {
  const d = state.data;
  const h = d.headlines || [];
  const items = [];
  if (h[0]) items.push([{ text: `가장 많은 언론이 다룬 사안: 「${h[0].title}」 (언론 ${outlets(h[0])}곳 · ${SCOPE[h[0].scope] || ''} · 보도 ${h[0].stage})`, open: `story:${h[0].link}` }]);
  const spread = (d.signals || []).filter((x) => x.kind === 'spread' && x.title !== h[0]?.title);
  const persist = (d.signals || []).filter((x) => x.kind === 'persist' && x.title !== h[0]?.title);
  const parts = [];
  if (spread[0]) parts.push({ text: `보도 급증: 「${spread[0].title}」 (${spread[0].detail.split(' · ')[0]})`, open: `story:${spread[0].link}` });
  if (persist[0]) parts.push({ text: `보도 지속: 「${persist[0].title}」 (${persist[0].detail.split(' · ')[0]})`, open: `story:${persist[0].link}` });
  if (parts.length) items.push(parts);
  const m = (id) => d.markets.find((x) => x.id === id);
  const fx = (x) => `${x.name} ${num(x.price, x.digits)}${x.unit}(${x.changePct > 0 ? '+' : ''}${x.changePct.toFixed(2)}%)`;
  const ids = ['kospi', 'usdkrw', 'us10y'].filter((id) => m(id));
  const up = d.markets.filter((x) => x.change > 0).length;
  items.push([{ text: `시장: ${ids.map((id) => fx(m(id))).join(' · ')} (${d.markets.length}개 지표 중 ${up}개 상승)`, open: `market:${ids.join(',')}` }]);
  return items;
}
const briefLines = () => briefItems().map((parts) => parts.map((p) => p.text).join(' / '));
function renderBrief3() {
  const meta = document.querySelector('.p-brief .pm');
  if (meta) meta.textContent = `규칙 기반 자동 작성 · ${fmt.hm.format(new Date(state.data.generatedAt))} 자료로 갱신 · 줄을 누르면 근거 기사`;
  $('brief3').innerHTML = briefItems().map((parts) => `<li><span>${parts
    .map((p) => `<button type="button" class="bl" data-open="${esc(p.open)}">${esc(p.text)}</button>`)
    .join('<span class="sep">/</span>')}</span></li>`).join('');
}

// 가장 많은 언론이 다룬 사안 하나를 사진과 함께 크게
function renderFocus() {
  const it = state.data.headlines?.[0];
  if (!it) { $('focus').innerHTML = '<p class="empty">아직 여러 언론이 함께 다룬 사안이 없습니다.</p>'; return; }
  const hours = Math.max(1, Math.round((Date.now() - Date.parse(it.firstAt || it.publishedAt)) / 3600000));
  $('focusMeta').innerHTML = `${esc(it.sectionName)} · 최초 보도 ${esc(it.firstSource || it.source)} ${stamp(it.firstAt || it.publishedAt)} <button type="button" class="more-d" data-open="story:${esc(it.link)}">자세히</button>`;
  $('focus').innerHTML = `
    ${it.image ? img(it.image, 'focus-img', it.title) : '<div class="focus-img focus-noimg" aria-hidden="true"></div>'}
    <div class="focus-body">
      <p class="focus-sec">${exclChip(it)}${stageChip(it)}<span>${esc(SCOPE[it.scope] || '')}</span><span>${esc(it.source)} 외 ${it.related.length}곳</span>${bmBtn(it)}</p>
      <a class="focus-t" href="${esc(it.link)}" target="_blank" rel="noopener noreferrer"><span class="hl">${esc(it.title)}</span></a>
      ${it.summary ? `<p class="focus-sum">${esc(it.summary)}</p>` : ''}
      <dl class="focus-stats">
        <div><dt>보도 언론사</dt><dd>${outlets(it)}<small>곳</small></dd></div>
        <div><dt>최근 3시간</dt><dd>${it.recent3h ?? 0}<small>곳</small></dd></div>
        <div><dt>보도 경과</dt><dd>${hours}<small>시간</small></dd></div>
      </dl>
      ${mixBar(it)}
    </div>`;
}

const marketIdOf = (sig) => state.data.markets.find((m) => sig.title.startsWith(m.name))?.id;
function renderSignals() {
  const sig = state.data.signals || [];
  $('signals').innerHTML = sig.map((x) => {
    const mid = marketIdOf(x);
    const open = x.link ? `story:${x.link}` : mid ? `market:${mid}` : '';
    const attrs = open ? `data-open="${esc(open)}" tabindex="0" role="button"` : '';
    return `<li ${attrs}>
      <span class="k ${x.kind}">${esc(x.label)}</span>
      <div><span class="t">${esc(x.title)}</span>
      <p class="d">${esc(x.section)} · <span class="${x.dir || ''}">${esc(x.detail)}</span></p></div>
    </li>`;
  }).join('') || '<li class="empty">지금은 따로 짚을 신호가 없습니다.</li>';
}

function renderTop() {
  const items = (state.data.headlines || []).slice(1);
  const max = items[0] ? outlets(items[0]) : 1;
  $('top').innerHTML = items.map((it) => `<li class="${it.image ? 'has-img' : ''}"><div>
      <p class="sec">${esc(it.sectionName)} · ${esc(it.source)} · ${ago(it.publishedAt)}</p>
      <a href="${esc(it.link)}" target="_blank" rel="noopener noreferrer"><span class="hl">${esc(it.title)}</span></a>
      <div class="cover"><span class="track" aria-hidden="true"><i style="width:${Math.round((outlets(it) / max) * 100)}%"></i></span>${relBtn(it)}<button type="button" class="more-d" data-open="story:${esc(it.link)}">자세히</button>${bmBtn(it)}</div>
      ${it.image ? img(it.image, 'thumb') : ''}
    </div></li>`).join('') || '<li class="empty">아직 여러 언론이 함께 다룬 사안이 없습니다.</li>';
}

function renderLead() {
  const sec = state.data.sections.find((x) => x.id === 'president');
  const top = onTop();
  const items = sec ? sec.items.filter((it) => !top.has(it.link)) : [];
  $('lead').innerHTML = items.map((it) => feedItem(it)).join('') || '<li class="empty">최근 소식이 없습니다.</li>';
}

function renderKeywords() {
  const kws = state.data.keywords.slice(0, 12);
  const max = kws[0]?.count || 1;
  $('keywords').innerHTML = kws.map((k) => `<li><button type="button" data-kw="${esc(k.word)}" aria-pressed="${state.kw === k.word}" aria-label="${esc(k.word)}, 사안 ${k.stories ?? '-'}건, 기사 ${k.count}건. 관련 기사 보기">
      <span class="w">${esc(k.word)}</span><span class="c">${k.stories ?? ''}<em>사안</em> ${k.count}<em>기사</em></span>
      <span class="bar" aria-hidden="true"><i style="width:${Math.max(4, Math.round((k.count / max) * 100))}%"></i></span>
    </button></li>`).join('') || '<li class="empty">아직 집계할 기사가 적습니다.</li>';
}

// 분야별 보도량: 국정은 숲색, 경제는 놋쇠색. 누르면 그 분야 기사 목록
function renderVolume() {
  const rows = state.data.sections.map((x) => ({
    id: x.id, group: x.group || '국정', name: x.name,
    n: x.totalArticles ?? x.items.reduce((t, it) => t + outlets(it), 0), st: x.totalStories ?? x.items.length,
  }));
  const max = Math.max(1, ...rows.map((r) => r.n));
  $('volume').innerHTML = rows.map((r) => `<li><button type="button" data-sec="${r.id}" aria-label="${esc(r.name)} 기사 ${r.n}건, 사안 ${r.st}건, 목록 보기">
      <span class="n">${esc(r.name)}</span><span class="track" aria-hidden="true"><i class="g-${esc(r.group)}" style="width:${Math.round((r.n / max) * 100)}%"></i></span><span class="c">${r.n}</span>
    </button></li>`).join('')
    + '<li class="vol-legend" aria-hidden="true"><span><i style="background:var(--navy)"></i>국정</span><span><i style="background:var(--brass)"></i>경제</span></li>';
}

// 24시간 보도 흐름: 시간당 개별 기사 수. 평균선, 최다 시각, 현재 시각을 함께 표시
function renderHours() {
  const bins = state.data.hours || Array.from({ length: 24 }, () => 0);
  const base = Date.parse(state.data.generatedAt);
  const max = Math.max(1, ...bins);
  const total = bins.reduce((x, v) => x + v, 0);
  const avg = total / bins.length;
  const W = 520, H = 220, top = 22, bottom = 22, bw = W / 24;
  const y = (v) => H - bottom - (v / max) * (H - top - bottom);
  const peak = bins.indexOf(max);
  const hourAt = (i) => fmt.hour.format(new Date(base - (23 - i) * 3600000));
  const bars = bins.map((v, i) => {
    const cls = i === 23 ? ' now' : i === peak ? ' pk' : '';
    return `<rect class="b${cls}" x="${(i * bw + 2).toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${(H - bottom - y(v)).toFixed(1)}"><title>${hourAt(i)}시 · ${v}건</title></rect>`;
  }).join('');
  const labels = [0, 6, 12, 18, 23].map((i) =>
    `<text class="ax" x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 5}" text-anchor="middle">${i === 23 ? '지금' : `${hourAt(i)}시`}</text>`).join('');
  const px = Math.min(Math.max(peak * bw + bw / 2, 30), W - 30);
  $('hourMeta').textContent = `최근 24시간 ${total.toLocaleString('ko-KR')}건 · 최다 ${hourAt(peak)}시`;
  $('hours').innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="최근 24시간 시간대별 보도 건수. 가장 많았던 때 ${hourAt(peak)}시 ${max}건, 시간당 평균 ${avg.toFixed(1)}건">
    <line class="gl" x1="0" x2="${W}" y1="${H - bottom}" y2="${H - bottom}"/>
    ${bars}
    <line class="avg" x1="0" x2="${W}" y1="${y(avg).toFixed(1)}" y2="${y(avg).toFixed(1)}" vector-effect="non-scaling-stroke"/>
    <text class="avg-t" x="4" y="${(y(avg) - 5).toFixed(1)}" text-anchor="start">시간당 평균 ${avg.toFixed(1)}건</text>
    <text class="peak-t" x="${px.toFixed(1)}" y="${(y(max) - 6).toFixed(1)}" text-anchor="middle">${max}건</text>
    ${labels}</svg>`;
}

// 주요 사안 보도 규모: 언론사 수를 매체 유형으로 쌓은 막대. 누르면 상세
function renderStoryBars() {
  const items = (state.data.headlines || []).slice(0, 5);
  const max = Math.max(1, ...items.map(outlets));
  $('storyBars').innerHTML = items.map((it) => {
    const mix = it.mix || {};
    const parts = MIX_ORDER.filter((t) => mix[t]);
    return `<li><button type="button" data-open="story:${esc(it.link)}" aria-label="${esc(it.title)}, 언론 ${outlets(it)}곳. 자세히 보기">
      <span class="st">${esc(it.title)}</span>
      <span class="sb" style="width:${Math.round((outlets(it) / max) * 100)}%">${parts.map((t) => `<i class="m-${MIX_ORDER.indexOf(t)}" style="flex:${mix[t]}" title="${t} ${mix[t]}곳"></i>`).join('')}</span>
      <span class="sn">${outlets(it)}</span>
    </button></li>`;
  }).join('')
    + `<li class="sbars-legend" aria-hidden="true">${MIX_ORDER.slice(0, 6).map((t, i) => `<span><i class="m-${i}"></i>${t}</span>`).join('')}</li>`;
}

/* ── 상세 서랍 ── */
const dw = $('detail');

// 사안 하나의 시간대별 보도 매체 수 (매체별 첫 기사 시각 기준, 최대 48시간)
function storyHourChart(it) {
  const tl = (it.timeline || []).filter((x) => x.t);
  if (tl.length < 2) return '';
  const start = Math.min(...tl.map((x) => Date.parse(x.t)));
  const n = Math.min(Math.max(1, Math.ceil((Date.now() - start) / 3600000)), 48);
  const from = Date.now() - n * 3600000;
  const bins = Array.from({ length: n }, () => 0);
  for (const x of tl) { const i = Math.floor((Date.parse(x.t) - from) / 3600000); if (i >= 0 && i < n) bins[i]++; }
  const max = Math.max(1, ...bins);
  const W = 500, H = 140, b = 20, bw = W / n;
  const bars = bins.map((v, i) => {
    const h = (v / max) * (H - b - 12);
    return `<rect class="b" x="${(i * bw + 1).toFixed(1)}" y="${(H - b - h).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}"><title>${v}곳</title></rect>`;
  }).join('');
  const lbl = (i, t, anchor) => `<text class="ax" x="${i === 0 ? 0 : W}" y="${H - 4}" text-anchor="${anchor}">${t}</text>`;
  return `<svg class="dw-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="시간대별 보도 매체 수">
    <line class="gl" x1="0" x2="${W}" y1="${H - b}" y2="${H - b}"/>${bars}${lbl(0, `${n}시간 전`, 'start')}${lbl(1, '지금', 'end')}</svg>`;
}

function storyDetail(it) {
  const hours = Math.max(1, Math.round((Date.now() - Date.parse(it.firstAt || it.publishedAt)) / 3600000));
  const kws = (state.data.keywords || []).filter((k) => (k.links || []).includes(it.link));
  const tl = it.timeline?.length ? it.timeline : [{ s: it.source, t: it.publishedAt, h: it.title }];
  const chart = storyHourChart(it);
  return `
    <p class="dw-chips">${exclChip(it)}${stageChip(it)}<span>${esc(it.sectionName || '')}</span>${it.scope ? `<span>· ${esc(SCOPE[it.scope] || '')}</span>` : ''}</p>
    ${it.image ? img(it.image, 'dw-pic', it.title) : ''}
    <h2 class="dw-t" id="dwTitle">${esc(it.title)}</h2>
    ${it.summary ? `<p class="dw-sum">${esc(it.summary)}</p>` : ''}
    <div class="dw-act"><a href="${esc(it.link)}" target="_blank" rel="noopener noreferrer">${esc(it.source)} 원문 보기 ↗</a></div>
    <dl class="dw-stats">
      <div><dt>보도 언론사</dt><dd>${outlets(it)}<small>곳</small></dd></div>
      <div><dt>최근 3시간</dt><dd>${it.recent3h ?? 0}<small>곳</small></dd></div>
      <div><dt>보도 경과</dt><dd>${hours}<small>시간</small></dd></div>
      <div><dt>최초 보도</dt><dd class="txt">${esc(it.firstSource || it.source)}<br>${stamp(it.firstAt || it.publishedAt)}</dd></div>
    </dl>
    ${chart ? `<section class="dw-sec"><h3>시간대별 보도 매체 수</h3>${chart}</section>` : ''}
    ${it.mix ? `<section class="dw-sec"><h3>매체 유형별 분포</h3>${mixBar(it)}</section>` : ''}
    <section class="dw-sec"><h3>보도 흐름 · 매체별 첫 기사</h3>
      <ol class="dw-tl">${tl.map((x) => `<li><time>${x.t ? stamp(x.t) : ''}</time><b>${esc(x.s)}</b><span>${esc(x.h || '')}</span></li>`).join('')}</ol></section>
    ${foreignSection(it)}
    ${kws.length ? `<section class="dw-sec"><h3>이 사안이 포함된 키워드</h3><div class="dw-kws">${kws.map((k) => `<button type="button" data-kw="${esc(k.word)}">${esc(k.word)} · 사안 ${k.stories}</button>`).join('')}</div></section>` : ''}
    <p class="dw-note">단계·범위는 공개된 규칙으로 자동 판정합니다. 제목과 요약은 각 언론사의 것이며 이 지면은 논평하지 않습니다.</p>`;
}

// 시장 지표별 관련 보도를 찾는 낱말 (제목 기준)
const MARKET_WORDS = {
  kospi: /코스피|증시|주식시장|외국인 순매/, kosdaq: /코스닥/, samsung: /삼성전자/, hynix: /하이닉스/,
  usdkrw: /환율|원\/달러|원·달러|달러/, jpykrw: /엔화|원\/엔|엔저|엔고/, eurkrw: /유로/,
  sp500: /뉴욕증시|S&P|다우|월가/, nasdaq: /나스닥|빅테크|엔비디아/, us10y: /국채|금리|연준|Fed|FOMC/,
  wti: /유가|원유|WTI|브렌트|OPEC|호르무즈/, gold: /금값|금 가격|국제 금|금 시세/,
};

// 차트 공통: 값 배열을 SVG 좌표로. 마우스·손가락을 올리면 그 지점 값이 뜨도록 data-*에 원본을 남긴다
function seriesSvg(values, { W = 500, H = 160, pt = 18, pb = 22, digits = 2, cls = '', label = '', labels = null, ref = null } = {}) {
  const v = values;
  // ref: 기준선(물가목표 2%, 0 등). 화면 범위에 들도록 최소·최대에 함께 넣는다
  const min = Math.min(...v, ...(ref ? [ref.v] : [])), max = Math.max(...v, ...(ref ? [ref.v] : [])), span = max - min || 1;
  const pts = v.map((x, i) => [(i / (v.length - 1)) * W, pt + (1 - (x - min) / span) * (H - pt - pb)]);
  const d = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  const vmax = Math.max(...v), vmin = Math.min(...v);
  const hi = v.indexOf(vmax), lo = v.indexOf(vmin);
  const ry = ref ? (pt + (1 - (ref.v - min) / span) * (H - pt - pb)).toFixed(1) : 0;
  const tag = (i, t, above) => `<circle class="dot" cx="${pts[i][0].toFixed(1)}" cy="${pts[i][1].toFixed(1)}" r="3"/>
    <text class="lbl" x="${Math.min(Math.max(pts[i][0], 44), W - 44).toFixed(1)}" y="${(pts[i][1] + (above ? -7 : 15)).toFixed(1)}" text-anchor="middle">${t}</text>`;
  const y0 = pts[0][1].toFixed(1);
  return `<svg class="dw-chart xchart ${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(label)}"
      data-series="${esc(JSON.stringify(v))}" data-digits="${digits}" data-pt="${pt}" data-pb="${pb}"${labels ? ` data-labels="${esc(JSON.stringify(labels))}"` : ''}${ref ? ` data-ref="${ref.v}"` : ''}>
    <line class="base" x1="0" x2="${W}" y1="${y0}" y2="${y0}" vector-effect="non-scaling-stroke"/>
    ${ref ? `<line class="refl" x1="0" x2="${W}" y1="${ry}" y2="${ry}" vector-effect="non-scaling-stroke"/><text class="reft" x="${W - 4}" y="${(ry - 4)}" text-anchor="end">${esc(ref.label)}</text>` : ''}
    <path class="area" d="${d}L${W} ${H - pb}L0 ${H - pb}Z"/><path class="line" d="${d}"/>
    ${tag(hi, `최고 ${num(vmax, digits)}`, true)}${lo !== hi ? tag(lo, `최저 ${num(vmin, digits)}`, false) : ''}
    <line class="xh" x1="0" x2="0" y1="${pt - 6}" y2="${H - pb}" vector-effect="non-scaling-stroke" visibility="hidden"/>
    <circle class="xd" r="4" visibility="hidden"/>
    <text class="ax" x="0" y="${H - 5}">${labels ? esc(labels[0]) : `${v.length}거래일 전`}</text><text class="ax" x="${W}" y="${H - 5}" text-anchor="end">${labels ? esc(labels.at(-1)) : '현재'}</text></svg>`;
}

const RANGES = [['1주', 5], ['2주', 10], ['1개월', 22]];
function marketBlock(m, range = 22) {
  const dir = m.change > 0 ? 'up' : m.change < 0 ? 'down' : 'flat';
  const sign = m.change > 0 ? '+' : m.change < 0 ? '−' : '';
  const all = m.spark || [];
  const v = all.slice(-Math.min(range, all.length));
  const per = v.length > 1 ? ((v.at(-1) - v[0]) / v[0]) * 100 : null;
  const label = RANGES.find(([, n]) => n === range)?.[0] || '1개월';
  return `<section class="dw-mk" data-mk="${m.id}">
    <div class="dw-mk-h"><b>${esc(m.name)}</b>${m.note ? `<small class="muted">${esc(m.note)}</small>` : ''}
      <span class="p" data-count="${m.price}" data-digits="${m.digits}">${num(m.price, m.digits)}</span><small>${esc(m.unit)}</small>
      <span class="c ${dir}">${sign}${num(Math.abs(m.change), m.digits)} (${sign}${num(Math.abs(m.changePct), 2)}%)</span>
      <span class="src">${esc(m.source || '')}${m.status ? ` · ${esc(m.status)}` : ''} · ${fmt.mdhm.format(new Date(m.asOf))}</span></div>
    ${all.length > 5 ? `<div class="seg" role="tablist" aria-label="기간">${RANGES.map(([t, n]) =>
      `<button type="button" role="tab" aria-selected="${n === range}" data-range="${m.id}:${n}">${t}</button>`).join('')}</div>` : ''}
    ${v.length > 1 ? seriesSvg(v, { digits: m.digits, cls: dir, label: `${m.name} 최근 ${label} 추이` }) : '<p class="empty">추이 자료가 없습니다.</p>'}
    ${per != null ? `<dl class="mk-stats">
      <div><dt>${label} 등락</dt><dd class="${per > 0 ? 'up' : per < 0 ? 'down' : ''}">${per > 0 ? '+' : ''}${per.toFixed(2)}%</dd></div>
      <div><dt>${label} 최고</dt><dd>${num(Math.max(...v), m.digits)}</dd></div>
      <div><dt>${label} 최저</dt><dd>${num(Math.min(...v), m.digits)}</dd></div>
      <div><dt>현재 위치</dt><dd>${Math.round(((m.price - Math.min(...v)) / ((Math.max(...v) - Math.min(...v)) || 1)) * 100)}<small>% 지점</small></dd></div>
    </dl>` : ''}
  </section>`;
}

function marketNews(ids) {
  const re = ids.map((id) => MARKET_WORDS[id]).filter(Boolean);
  if (!re.length) return '';
  const seen = new Set();
  const hits = allItems().filter((it) => re.some((r) => r.test(it.title)) && !seen.has(it.link) && seen.add(it.link))
    .sort((a, b) => outlets(b) - outlets(a) || b.publishedAt.localeCompare(a.publishedAt)).slice(0, 8);
  if (!hits.length) return '';
  return `<section class="dw-sec"><h3>관련 보도</h3><ol class="dw-news">${hits.map((it) => `<li>
      <button type="button" data-open="story:${esc(it.link)}"><span class="hl">${esc(it.title)}</span></button>
      <p class="meta"><span>${esc(it.source)}</span><span>${ago(it.publishedAt)}</span>${it.related?.length ? `<span>언론 ${outlets(it)}곳</span>` : ''}</p></li>`).join('')}</ol></section>`;
}

function marketDetail(ids, ranges = {}) {
  const list = ids.map((id) => state.data.markets.find((m) => m.id === id)).filter(Boolean);
  const title = list.length === 1 ? list[0].name : '시장 지표';
  return `<h2 class="dw-t" id="dwTitle" style="margin-top:0">${esc(title)}</h2>
    ${list.length === 1 && list[0].group ? `<p class="dw-chips"><span>${esc(list[0].group)}</span></p>` : ''}
    ${list.map((m) => marketBlock(m, ranges[m.id] || 22)).join('')}
    ${marketNews(ids)}
    <p class="dw-note">국내 지수·종목·환율은 네이버 금융(1분 갱신), 해외·원자재는 Yahoo Finance(지연 시세)입니다. 차트는 일별 종가이며 투자 판단용이 아닙니다.</p>`;
}

// 시간대 막대를 누르면 그 한 시간에 나온 사안을 모아 보여 준다
function hourDetail(i) {
  const base = Date.parse(state.data.generatedAt);
  const end = base - (23 - i) * 3600000;
  const from = end - 3600000;
  const seen = new Set();
  const list = [...allItems(), ...(state.data.headlines || [])].filter((it) => {
    const t = Date.parse(it.publishedAt);
    return t >= from && t < end && !seen.has(it.link) && seen.add(it.link);
  }).sort((a, b) => outlets(b) - outlets(a));
  const n = state.data.hours?.[i] ?? 0;
  return `<h2 class="dw-t" id="dwTitle" style="margin-top:0">${fmt.hour.format(new Date(from))}시~${fmt.hour.format(new Date(end))}시 보도</h2>
    <p class="dw-sum">이 한 시간 동안 개별 기사 ${n}건이 나왔습니다. 아래는 그 가운데 이 지면에 실린 사안입니다.</p>
    ${list.length ? `<ol class="dw-news">${list.map((it) => `<li>
      <button type="button" data-open="story:${esc(it.link)}"><span class="hl">${esc(it.title)}</span></button>
      <p class="meta"><span class="tag">${esc(it.sectionName || '')}</span><span>${esc(it.source)}</span><span>${fmt.hm.format(new Date(it.publishedAt))}</span>${it.related?.length ? `<span>언론 ${outlets(it)}곳</span>` : ''}</p></li>`).join('')}</ol>`
      : '<p class="empty">이 시간대에 지면에 실린 사안은 없습니다.</p>'}`;
}

const dwState = { spec: '', ranges: {} };
function openDetail(spec) {
  dw.classList.remove('dw-atlas');
  const i = spec.indexOf(':');
  const kind = spec.slice(0, i), rest = spec.slice(i + 1);
  if (spec !== dwState.spec) dwState.ranges = {};
  dwState.spec = spec;
  if (kind === 'story') {
    const it = storyBy.get(rest);
    if (!it) return;
    $('dwKind').textContent = '사안 자세히';
    $('dwBody').innerHTML = storyDetail(it);
  } else if (kind === 'market') {
    $('dwKind').textContent = '시장 자세히';
    $('dwBody').innerHTML = marketDetail(rest.split(','), dwState.ranges);
  } else if (kind === 'person') {
    $('dwKind').textContent = '인물 자세히';
    $('dwBody').innerHTML = personDetail(rest);
  } else if (kind === 'realty') {
    $('dwKind').textContent = '부동산 지표 자세히';
    $('dwBody').innerHTML = realtyDetail(rest);
  } else if (kind === 'stock' || kind === 'idx') {
    $('dwKind').textContent = kind === 'stock' ? '종목 자세히' : '지수 자세히';
    $('dwBody').innerHTML = kind === 'stock' ? stockDetail(rest) : idxDetail(rest);
    setTimeout(loadStockChart, 0);
  } else if (kind === 'ecos') {
    $('dwKind').textContent = '경제 지표 자세히';
    $('dwBody').innerHTML = ecosDetail(rest);
  } else if (kind === 'hour') {
    $('dwKind').textContent = '시간대 자세히';
    $('dwBody').innerHTML = hourDetail(Number(rest));
  } else return;
  if (!dw.open) dw.showModal();
  dw.querySelector('.dw-in').scrollTop = 0;
  bindCharts($('dwBody'));
  countUp($('dwBody'));
  translateVisible();
}

$('dwClose').addEventListener('click', () => dw.close());
dw.addEventListener('click', (e) => { if (e.target === dw) dw.close(); }); // 바깥(어두운 영역)을 누르면 닫기

function renderDesk() {
  const top = onTop();
  const secs = state.data.sections.filter((s) => s.id !== 'president');
  const panel = (s) => {
    const items = s.items.filter((it) => !top.has(it.link));
    return `<section class="panel" aria-labelledby="h-${s.id}">
      <header class="ph"><h2 id="h-${s.id}">${esc(s.name)}</h2>${s.staleAt ? `<span class="stale">직전 자료 ${fmt.hm.format(new Date(s.staleAt))}</span>` : ''}<a class="pm link" href="?s=${s.id}" data-sec="${s.id}">전체</a></header>
      <ol class="feed">${items.map((it) => feedItem(it)).join('') || '<li class="empty">최근 소식이 없습니다.</li>'}</ol>
    </section>`;
  };
  // 국정과 경제를 나눠 묶는다
  const groups = [...new Set(secs.map((s) => s.group || '국정'))];
  $('desk').innerHTML = groups.map((g) => `<div class="dgroup">
      <h2 class="dg-h">${esc(g)}</h2>
      <div class="dg-grid" style="--n:${secs.filter((s) => (s.group || '국정') === g).length}">${secs.filter((s) => (s.group || '국정') === g).map(panel).join('')}</div>
    </div>`).join('');
}

function renderResults() {
  const q = state.query.trim();
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  let items = allItems();
  const kw = state.kw && state.data.keywords.find((k) => k.word === state.kw);
  if (kw) { const set = new Set(kw.links || []); items = items.filter((it) => set.has(it.link)); }
  if (state.section !== 'all') items = items.filter((it) => it.sectionId === state.section);
  if (!kw && terms.length) items = items.filter((it) => {
    const hay = `${it.title} ${it.source}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
  items.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const secName = state.data.sections.find((s) => s.id === state.section)?.name;
  $('results-h').textContent = kw ? `‘${kw.word}’ 관련 사안` : q ? `‘${q}’ 검색 결과` : secName;
  $('results-meta').textContent = `${secName && q ? `${secName} · ` : ''}사안 ${items.length}건 · 기사 ${items.reduce((x, it) => x + outlets(it), 0)}건 · 최신순`;
  const live = !kw && q.length >= 2;
  $('localH').hidden = !live || !items.length;
  $('resultList').innerHTML = items.map((it) => feedItem(it, { long: true, section: state.section === 'all' })).join('')
    || (live ? '' : '<li class="empty">찾는 기사가 없습니다. 다른 낱말로 검색해 보세요.</li>');
  if (live) liveSearch(q); else { $('liveRes').innerHTML = ''; }
}

/* ── 실시간 기사 검색: 상황판 밖 기사까지 (국내 7일 · 해외 주요 매체 7일) ── */
const liveCache = new Map();
let liveT = 0, liveCtl = null;
function liveRow(x) {
  return `<li class="${x.image ? 'has-img' : ''}"><time datetime="${x.publishedAt}">${fmt.mdhm.format(new Date(x.publishedAt))}</time>
    <div><a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer"><span class="hl">${highlight(x.title)}</span></a><div class="meta"><span>${esc(x.source)}</span>${bmBtn(x)}</div></div>${x.image ? img(x.image, 'fthumb') : ''}</li>`;
}
function renderLive(q, r) {
  if (state.query.trim() !== q) return;
  const modeSeg = `<div class="seg" role="group" aria-label="제목 표시">${FMODES.map(([k, l]) => `<button type="button" data-fmode="${k}" aria-pressed="${fmode === k}">${l}</button>`).join('')}</div>`;
  if (!r) {
    $('liveRes').innerHTML = `<section class="lr"><h3 class="res-h">국내·해외 언론 검색 중<span class="lr-dots" aria-hidden="true"></span></h3><div class="skel"><i></i><i></i><i></i><i></i></div></section>`;
    return;
  }
  if (r.error) { $('liveRes').innerHTML = '<p class="empty">언론 검색 결과를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>'; return; }
  const n = $('resultList').children.length;
  $('results-meta').textContent = `상황판 ${n}건 · 국내 언론 ${r.domestic.length}건 · 해외 언론 ${r.foreign.length}건 · 최근 7일`;
  $('liveRes').innerHTML = `
    <section class="lr">
      <h3 class="res-h">해외 언론 <small>${r.qEn ? `영어 검색어 ‘${esc(r.qEn)}’ · ` : ''}최근 7일 · 주요 매체 우선</small></h3>
      ${r.foreign.length ? `<div class="lr-tools">${modeSeg}</div><ol class="flist lr-f">${r.foreign.map((x) => foreignRow(x, { compact: true, thumb: true })).join('')}</ol>`
        : '<p class="empty">해외 언론 기사가 없습니다.</p>'}
    </section>
    <section class="lr">
      <h3 class="res-h">국내 언론 <small>최근 7일 · 최신순</small></h3>
      ${r.domestic.length ? `<ol class="feed wide">${r.domestic.map(liveRow).join('')}</ol>` : '<p class="empty">국내 언론 기사가 없습니다.</p>'}
    </section>`;
}
function liveSearch(q) {
  clearTimeout(liveT);
  if (liveCache.has(q)) { renderLive(q, liveCache.get(q)); return; }
  renderLive(q, null);
  liveT = setTimeout(async () => {
    liveCtl?.abort();
    liveCtl = new AbortController();
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: liveCtl.signal });
      if (!res.ok) throw new Error(res.status);
      const r = await res.json();
      liveCache.set(q, r);
      renderLive(q, r);
    } catch (e) { if (e.name !== 'AbortError') renderLive(q, { error: true }); }
  }, 450);
}

function renderView() {
  const filtering = Boolean(state.query.trim()) || Boolean(state.kw) || state.section !== 'all';
  $('dash').hidden = filtering;
  $('results').hidden = !filtering;
  // 검색·필터 중에는 배너와 시세 카드를 접어 결과가 첫 화면에 바로 보이게
  document.querySelector('#v-home .banner').hidden = filtering;
  $('markets').hidden = filtering;
  if (filtering) renderResults();
}

function renderStatus() {
  const d = state.data;
  $('updated').textContent = `${fmt.hm.format(new Date(d.generatedAt))} (${ago(d.generatedAt)})`;
  const el = $('notice');
  el.hidden = !(d.stale || Date.now() - Date.parse(d.generatedAt) > STALE_MS);
  if (!el.hidden) el.textContent = `최신 자료를 불러오지 못했습니다. ${fmt.mdhm.format(new Date(d.generatedAt))} 기준 자료입니다.`;
}

function renderAll() {
  storyBy.clear();
  for (const it of [...(state.data.compare?.stories || []), ...allItems(), ...(state.data.headlines || [])]) storyBy.set(it.link, it);
  renderMarkets(); enhanceMarkets(); renderBanner(); countUp($('gauges')); renderBrief3(); renderFocus(); renderSignals(); renderTop(); renderLead(); renderKeywords(); renderVolume(); renderHours(); enhanceHours(); renderStoryBars(); enhanceBars(); renderDesk(); renderView(); renderViewSwitch(); renderStatus(); revealPanels();
}

function renderPlaceholders() {
  const lines = '<li><span class="ph-line"></span><span class="ph-line" style="width:60%"></span></li>'.repeat(4);
  $('top').innerHTML = $('lead').innerHTML = lines;
}

/* ── 화면 전환, 주소 공유 ── */
const motionOK = matchMedia('(prefers-reduced-motion: no-preference)');
// 화면 전환을 겹쳐 누르면 앞 전환은 건너뛴다(오류 아님)
const transition = (fn) => {
  if (!document.startViewTransition || !motionOK.matches) return fn();
  const t = document.startViewTransition(fn);
  t.ready.catch(() => {}); t.finished.catch(() => {});
  return t;
};

function readURL() {
  const p = new URLSearchParams(location.search);
  state.section = p.get('s') || 'all';
  state.query = p.get('q') || '';
  state.kw = p.get('k') || '';
  state.view = p.get('v') || 'home';
  $('q').value = state.query;
}
function writeURL(push) {
  const p = new URLSearchParams();
  if (state.section !== 'all') p.set('s', state.section);
  if (state.query.trim()) p.set('q', state.query.trim());
  if (state.kw) p.set('k', state.kw);
  if (state.view && state.view !== 'home') p.set('v', state.view);
  history[push ? 'pushState' : 'replaceState'](null, '', `${location.pathname}${p.size ? `?${p}` : ''}`);
}
function go({ section = state.section, query = state.query, kw = '', push = true } = {}) {
  state.kw = kw;
  state.view = 'home';
  if (state.data && section !== 'all' && !state.data.sections.some((s) => s.id === section)) section = 'all';
  state.section = section;
  state.query = query;
  $('q').value = query;
  writeURL(push);
  transition(() => { renderView(); renderViewSwitch(); scrollTo({ top: 0 }); });
}

/* ── 데이터 ── */
async function fetchData(src, ms = 30000) {
  const res = await fetch(src, { cache: 'no-store', signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(res.status);
  const data = await res.json();
  if (!data.sections) throw new Error('형식 오류');
  return data;
}
// 이 기기에 마지막으로 받은 자료를 보관해 두었다가 다음 방문 때 즉시 보여 준다 (오래된 저장본이 먼저 깜빡이지 않게)
const DASH_KEY = 'dash-cache-v1';
const readDash = () => { try { const d = JSON.parse(localStorage.getItem(DASH_KEY) || 'null'); return d?.sections ? d : null; } catch { return null; } };
const saveDash = (d) => { try { if (!d.stale) localStorage.setItem(DASH_KEY, JSON.stringify(d)); } catch { /* 저장 공간 부족 등은 무시 */ } };
const newer = (d) => !state.data || Date.parse(d.generatedAt) >= Date.parse(state.data.generatedAt);
function show(d) { if (!newer(d)) return false; state.data = d; renderAll(); refreshQuotes(); return true; }
// 받은 자료가 6분 넘게 지났으면 화면은 그대로 두고 뒤에서 새로 수집한다 (5분에 한 번까지)
let bgAt = 0;
function freshenInBackground(d) {
  if (refreshing || Date.now() - Date.parse(d.generatedAt) < 6 * 60 * 1000 || Date.now() - bgAt < 5 * 60 * 1000) return;
  bgAt = Date.now();
  fetchData(`/api/dashboard?t=${Date.now()}`, 55000).then((n) => { if (!n.stale && show(n)) saveDash(n); }).catch(() => {});
}
async function load() {
  const [live, snap] = SOURCES;
  await null; // 첫 호출은 모듈 초기화 도중이므로, 초기화가 끝난 뒤 그린다
  if (!state.data) { const c = readDash(); if (c) { try { show(c); } catch { state.data = null; } } }
  const livePromise = fetchData(live).then((d) => { show(d); saveDash(d); freshenInBackground(d); return true; }).catch(() => false);
  if (!state.data) {
    fetchData(snap).then((d) => { if (!state.data) show(d); }).catch(() => {});
  }
  if (await livePromise) return;
  if (!state.data) {
    $('notice').hidden = false;
    $('notice').textContent = '자료를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.';
  }
}

/* ── 언론사 목록 (Popover API) ── */
const pop = $('sourcesPop');
function openSources(btn) {
  const it = storyBy.get(btn.dataset.rel);
  if (!it) return;
  const tl = it.timeline?.length ? it.timeline : [{ s: it.source, t: it.publishedAt, h: it.title }, ...it.related.map((s) => ({ s }))];
  pop.innerHTML = `<h3>보도 흐름 · 언론 ${outlets(it)}곳</h3><p class="pop-sub">시각순, 매체별 첫 기사 제목</p>
    <ol class="tl">${tl.map((x) => `<li><time>${x.t ? stamp(x.t) : ''}</time><b>${esc(x.s)}</b>${x.h ? `<span>${esc(x.h)}</span>` : ''}</li>`).join('')}</ol>`;
  pop.showPopover();
  const r = btn.getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = `${Math.min(Math.max(12, r.left), innerWidth - w - 12)}px`;
  pop.style.top = `${r.bottom + 8 + h > innerHeight ? Math.max(12, r.top - h - 8) : r.bottom + 8}px`;
}
addEventListener('scroll', () => pop.matches(':popover-open') && pop.hidePopover(), { passive: true, capture: true });

/* ── 이벤트 ── */
document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-open],[data-sec],[data-kw],[data-rel],#clearBtn,#themeBtn,#printBtn,#copyBtn');
  if (!t) return;
  if (t.dataset.open) { e.preventDefault(); openDetail(t.dataset.open); return; }
  if (t.dataset.kw && dw.open) dw.close();
  if (t.dataset.sec) { e.preventDefault(); go({ section: t.dataset.sec, query: '' }); }
  else if (t.dataset.kw) go({ section: 'all', query: '', kw: t.dataset.kw });
  else if (t.dataset.rel) openSources(t);
  else if (t.id === 'clearBtn') go({ section: 'all', query: '' });
  else if (t.id === 'themeBtn') toggleTheme();
  else if (t.id === 'printBtn') print();
  else if (t.id === 'copyBtn') {
    const text = `[국정 한눈에] ${fmt.mdhm.format(new Date(state.data.generatedAt))} 기준\n${briefLines().map((l, i) => `${i + 1}. ${l}`).join('\n')}\n${location.origin}`;
    navigator.clipboard?.writeText(text).then(() => { t.textContent = '복사됨'; setTimeout(() => { t.textContent = '복사'; }, 1600); });
  }
});
let typing;
$('q').addEventListener('input', (e) => { clearTimeout(typing); typing = setTimeout(() => state.data && go({ query: e.target.value, push: false }), 180); });
$('searchForm').addEventListener('submit', (e) => { e.preventDefault(); $('q').blur(); });
$('q').addEventListener('keydown', (e) => { if (e.key === 'Escape') go({ query: '' }); });
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[data-open][role="button"], li[data-open]')) { e.preventDefault(); openDetail(e.target.dataset.open); return; }
  if (e.key === '/' && !e.metaKey && !e.ctrlKey && document.activeElement?.tagName !== 'INPUT') { e.preventDefault(); $('q').focus(); }
});
addEventListener('popstate', () => { readURL(); state.data && transition(() => { renderView(); renderViewSwitch(); }); });

/* ── 테마 ── */
const root = document.documentElement;
const darkNow = () => (root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches);
const syncThemeLabel = () => { $('themeBtn').textContent = darkNow() ? '밝게' : '어둡게'; };
function toggleTheme() {
  root.dataset.theme = darkNow() ? 'light' : 'dark';
  try { localStorage.setItem('theme', root.dataset.theme); } catch {}
  syncThemeLabel();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeLabel);

/* ── 시계 ── */
function tick() {
  const now = new Date();
  $('clock').textContent = fmt.hm.format(now);
  $('today').textContent = fmt.date.format(now);
  const [y, m, d] = dayOf(now).split('-').map(Number);
  $('term').textContent = `취임 ${(Math.floor((Date.UTC(y, m - 1, d) - INAUGURATION) / 86400000) + 1).toLocaleString('ko-KR')}일째`;
  if (state.data) renderStatus();
}

/* ── 시작 ── */
readURL();
syncThemeLabel();
tick();
setInterval(tick, 30 * 1000);
renderPlaceholders();
bmSync();
load();
setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);

// 국내 지수·종목·환율은 1분마다 실시간 값으로 갈아 끼운다 (뉴스는 20분 주기, 시세는 따로)
async function refreshQuotes() {
  if (!state.data || document.hidden) return;
  try {
    const res = await fetch('/api/markets', { cache: 'no-store' });
    if (!res.ok) return;
    const { quotes } = await res.json();
    let changed = false;
    for (const m of state.data.markets) {
      const q = quotes?.[m.id];
      if (!q || (q.price === m.price && q.asOf === m.asOf)) continue;
      const spark = [...(m.spark || [])];
      const sameDay = m.asOf && dayOf(new Date(m.asOf)) === dayOf(new Date(q.asOf));
      if (sameDay && spark.length) spark[spark.length - 1] = q.price; else spark.push(q.price);
      Object.assign(m, q, { spark: spark.slice(-22) });
      changed = true;
    }
    if (changed) { renderMarkets(); enhanceMarkets(); renderBanner(); countUp($('gauges')); renderBrief3(); }
  } catch { /* 다음 주기에 다시 */ }
}
setInterval(refreshQuotes, 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshQuotes(); });
// 홈 화면 앱을 다시 열었을 때(백그라운드 복귀·뒤로가기 캐시 복원) 오래된 자료면 곧바로 다시 받는다
const resume = () => { if (!document.hidden && state.data && Date.now() - Date.parse(state.data.generatedAt) > 3 * 60 * 1000) load(); };
document.addEventListener('visibilitychange', resume);
addEventListener('pageshow', (e) => { if (e.persisted) resume(); });
addEventListener('online', () => load());

/* ── 상호작용: 툴팁, 차트 따라가기, 숫자 올림, 시세 변동 표시, 나타남 ── */
const tip = document.createElement('div');
tip.className = 'tip';
tip.setAttribute('role', 'tooltip');
document.body.append(tip);
function showTip(html, x, y) {
  tip.innerHTML = html;
  tip.classList.add('on');
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = `${Math.min(Math.max(8, x - w / 2), innerWidth - w - 8)}px`;
  tip.style.top = `${y - h - 12 < 8 ? y + 16 : y - h - 12}px`;
}
const hideTip = () => tip.classList.remove('on');
addEventListener('scroll', hideTip, { passive: true, capture: true });

// 선 차트 위를 따라가며 그 날의 값과 현재 대비 차이를 보여 준다 (마우스·터치 공통 Pointer Events)
function bindSeries(svg, { onlyTip = false } = {}) {
  const v = JSON.parse(svg.dataset.series || '[]');
  if (v.length < 2) return;
  const digits = Number(svg.dataset.digits || 2);
  const pt = Number(svg.dataset.pt || 2), pb = Number(svg.dataset.pb || 2);
  const vb = svg.viewBox.baseVal;
  const labels = svg.dataset.labels ? JSON.parse(svg.dataset.labels) : null;
  const refv = svg.dataset.ref ? [Number(svg.dataset.ref)] : [];
  const min = Math.min(...v, ...refv), max = Math.max(...v, ...refv), span = max - min || 1;
  const xh = svg.querySelector('.xh'), xd = svg.querySelector('.xd');
  const move = (e) => {
    const r = svg.getBoundingClientRect();
    if (!r.width) return;
    const i = Math.round(Math.min(Math.max((e.clientX - r.left) / r.width, 0), 1) * (v.length - 1));
    const x = (i / (v.length - 1)) * vb.width;
    const y = pt + (1 - (v[i] - min) / span) * (vb.height - pt - pb);
    if (xh && !onlyTip) { xh.setAttribute('x1', x); xh.setAttribute('x2', x); xh.setAttribute('visibility', 'visible'); }
    if (xd && !onlyTip) { xd.setAttribute('cx', x); xd.setAttribute('cy', y); xd.setAttribute('visibility', 'visible'); }
    const ago = v.length - 1 - i;
    const diff = ((v.at(-1) - v[i]) / v[i]) * 100;
    const sub = labels ? `${labels[i]}${ago ? ` · 이후 ${v.at(-1) - v[i] > 0 ? '+' : ''}${num(v.at(-1) - v[i], digits)}` : ' · 최근'}` : (ago ? `${ago}거래일 전 · 현재 대비 ${diff > 0 ? '+' : ''}${diff.toFixed(2)}%` : '현재');
    showTip(`<b>${num(v[i], digits)}</b><span>${sub}</span>`,
      r.left + (i / (v.length - 1)) * r.width, r.top + (y / vb.height) * r.height);
  };
  const leave = () => { hideTip(); xh?.setAttribute('visibility', 'hidden'); xd?.setAttribute('visibility', 'hidden'); };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', leave);
}

// 막대 차트: 막대마다 data-tip 내용을 띄운다
function bindBars(root) {
  root.querySelectorAll('[data-tip]').forEach((el) => {
    el.addEventListener('pointerenter', () => {
      const r = el.getBoundingClientRect();
      showTip(el.dataset.tip, r.left + r.width / 2, r.top);
    });
    el.addEventListener('pointerleave', hideTip);
  });
}

function bindCharts(root) {
  root.querySelectorAll('svg.xchart').forEach((s) => bindSeries(s));
  bindBars(root);
}

// 숫자가 바뀔 때 짧게 굴러 올라간다 (움직임 줄이기 설정이면 바로 표시)
function countUp(root) {
  if (!motionOK.matches) return;
  root.querySelectorAll('[data-count]').forEach((el) => {
    const to = Number(el.dataset.count);
    const digits = Number(el.dataset.digits || 0);
    const from = Number(el.dataset.from ?? to * 0.96);
    if (!Number.isFinite(to)) return;
    const t0 = performance.now(), dur = 700;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - (1 - k) ** 3;
      el.textContent = num(from + (to - from) * e, digits);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

// 시세 타일: 전체가 눌리는 단추이고, 추이선 위에서는 그날 값을 보여 준다
let lastPrices = {};
function enhanceMarkets() {
  const prev = lastPrices;
  const tiles = [...document.querySelectorAll('#markets .kpi')];
  tiles.forEach((el, i) => {
    const m = state.data.markets[i];
    if (!m) return;
    el.dataset.open = `market:${m.id}`;
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    const svg = el.querySelector('svg');
    if (svg && m.spark?.length > 1) {
      svg.dataset.series = JSON.stringify(m.spark);
      svg.dataset.digits = m.digits;
      bindSeries(svg, { onlyTip: true });
    }
    const p = el.querySelector('.kpi-p');
    if (p && p.firstChild) {
      const span = document.createElement('span');
      span.dataset.count = m.price;
      span.dataset.digits = m.digits;
      if (prev[m.id] != null) span.dataset.from = prev[m.id];
      span.textContent = num(m.price, m.digits);
      p.firstChild.replaceWith(span);
      // 실시간 갱신으로 값이 바뀌면 잠깐 표시
      if (prev[m.id] != null && prev[m.id] !== m.price) {
        el.classList.add(m.price > prev[m.id] ? 'tick-up' : 'tick-down');
        setTimeout(() => el.classList.remove('tick-up', 'tick-down'), 1400);
      }
    }
  });
  countUp($('markets'));
  lastPrices = Object.fromEntries(state.data.markets.map((m) => [m.id, m.price]));
}

// 24시간 막대: 막대 위 정보, 누르면 그 시간 사안
function enhanceHours() {
  const base = Date.parse(state.data.generatedAt);
  const avg = (state.data.hours || []).reduce((a, b) => a + b, 0) / 24;
  document.querySelectorAll('#hours rect.b').forEach((r, i) => {
    const v = state.data.hours?.[i] ?? 0;
    const from = new Date(base - (24 - i) * 3600000);
    r.dataset.tip = `<b>${fmt.hour.format(from)}시대 ${v}건</b><span>평균 대비 ${avg ? `${v >= avg ? '+' : ''}${Math.round(((v - avg) / avg) * 100)}%` : '-'} · 눌러서 사안 보기</span>`;
    r.dataset.open = `hour:${i}`;
    r.setAttribute('role', 'button');
    r.setAttribute('tabindex', '0');
    r.querySelector('title')?.remove();
  });
  bindBars($('hours'));
}

// 분야별·사안별 막대에도 수치 툴팁
function enhanceBars() {
  document.querySelectorAll('#volume button').forEach((b) => {
    const s = state.data.sections.find((x) => x.id === b.dataset.sec);
    if (s) b.dataset.tip = `<b>${esc(s.name)}</b><span>기사 ${s.totalArticles ?? '-'}건 · 사안 ${s.totalStories ?? s.items.length}건 · 눌러서 목록</span>`;
  });
  document.querySelectorAll('#storyBars .sb i').forEach((i) => { i.dataset.tip = `<b>${esc(i.getAttribute('title') || '')}</b>`; i.removeAttribute('title'); });
  bindBars($('volume'));
  bindBars($('storyBars'));
}

// 패널이 화면에 들어올 때 한 번만 살짝 떠오른다
const io = 'IntersectionObserver' in window && motionOK.matches ? new IntersectionObserver((entries) => {
  for (const en of entries) if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
}, { rootMargin: '0px 0px -8% 0px' }) : null;
function revealPanels() {
  if (!io) return;
  document.querySelectorAll('#v-home .panel:not(.in), #v-home .dgroup:not(.in)').forEach((p) => { p.classList.add('rv'); io.observe(p); });
}

// 상세 서랍의 기간 단추
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-range]');
  if (!b) return;
  const [id, n] = b.dataset.range.split(':');
  dwState.ranges[id] = Number(n);
  const ids = dwState.spec.slice(dwState.spec.indexOf(':') + 1).split(',');
  const top = dw.querySelector('.dw-in').scrollTop;
  $('dwBody').innerHTML = marketDetail(ids, dwState.ranges);
  dw.querySelector('.dw-in').scrollTop = top;
  bindCharts($('dwBody'));
});

/* ── 국정 한눈에 2.0: 세계가 본 한국 · 국내외 보도 비교 · 출처 분석 ── */
const VIEWS = ['home', 'global', 'policy', 'macro', 'street', 'world', 'compare', 'sources', 'realty'];
const fItem = (id) => state.data.world?.items?.[id];
const wstate = { bloc: '전체', region: '전체', type: '전체' };
// 매체 권역: 예전 수집 자료(권역 없음)도 나라로 판정
const BLOC_OF = { '미국': '미국', '영국': '유럽', '프랑스': '유럽', '독일': '유럽', '카타르': '중동', '일본': '일본', '홍콩(중국)': '중화권' };
const blocOf = (x) => x.bloc || BLOC_OF[x.country] || '기타';
const BLOCS = ['전체', '미국', '유럽', '중동', '일본', '중화권'];
// 제목 표시: 나란히(왼쪽 원문 · 오른쪽 한글) / 원문 / 한글
const FMODES = [['pair', '원문 | 한글'], ['src', '원문'], ['ko', '한글']];
let fmode = 'pair';
try { fmode = localStorage.getItem('fmode') || 'pair'; } catch {}
document.documentElement.dataset.fmode = fmode;

// 외신 제목 한 줄: 왼쪽 원제목 · 오른쪽 한국어(기계 번역) + 매체·국가·시각·유형
function foreignRow(x, { compact = false, thumb = false } = {}) {
  const gt = `https://translate.google.com/?sl=en&tl=ko&op=translate&text=${encodeURIComponent(x.title)}`;
  const th = thumb && x.image;
  return `<li class="frow${th ? ' has-th' : ''}">${th ? `<a class="pic fth" href="${esc(x.link)}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true"><img src="${esc(x.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentNode.remove();this.closest('.frow')?.classList.remove('has-th')"></a>` : ''}
    <div class="fpair">
      <a class="ft" href="${esc(x.link)}" target="_blank" rel="noopener noreferrer" lang="en"><span class="hl">${esc(x.title)}</span></a>
      ${x.titleKo ? `<a class="fk" href="${esc(x.link)}" target="_blank" rel="noopener noreferrer" lang="ko" tabindex="-1"><span class="hl">${esc(x.titleKo)}</span></a>`
        : `<p class="fk fk-none"><a href="${gt}" target="_blank" rel="noopener noreferrer">번역 보기 ↗</a></p>`}
    </div>
    <p class="meta"><span class="fo">${esc(x.outletKo)}</span>${x.country ? `<span>${esc(x.country)}</span>` : ''}<span>${stamp(x.publishedAt)}</span>
      ${x.type !== '보도' ? `<span class="tag">${esc(x.type)}</span>` : ''}${x.paywall ? '<span class="pw" title="구독해야 원문 전체를 볼 수 있는 매체">유료</span>' : ''}
      ${!compact && x.also ? `<span>${esc(x.also)} 함께 언급</span>` : ''}${bmBtn({ ...x, source: x.outletKo })}</p>
  </li>`;
}

/* 세계가 본 한국 */
function renderWorld() {
  const w = state.data.world;
  if (!w) { $('worldList').innerHTML = '<li class="empty">해외 보도를 불러오지 못했습니다.</li>'; return; }
  const items = w.items;
  const regions = ['전체', '대한민국', '북한', '한반도'];
  const types = ['전체', '보도', '분석', '의견'];
  const inBloc = (x) => wstate.bloc === '전체' || blocOf(x) === wstate.bloc;
  const cnt = (k, v) => items.filter((x) => (v === '전체' || x[k] === v) && (k === 'bloc' || inBloc(x))).length;
  const bcnt = (b) => (b === '전체' ? items.length : items.filter((x) => blocOf(x) === b).length);
  $('worldBloc').innerHTML = BLOCS.filter((b) => b === '전체' || bcnt(b)).map((b) => `<button type="button" data-wbloc="${b}" aria-pressed="${wstate.bloc === b}">${b} <small>${bcnt(b)}</small></button>`).join('');
  $('worldMode').innerHTML = FMODES.map(([k, l]) => `<button type="button" data-fmode="${k}" aria-pressed="${fmode === k}">${l}</button>`).join('');
  $('worldRegion').innerHTML = regions.map((r) => `<button type="button" data-wregion="${r}" aria-pressed="${wstate.region === r}">${r} <small>${cnt('region', r)}</small></button>`).join('');
  $('worldType').innerHTML = types.filter((t) => t === '전체' || cnt('type', t)).map((t) => `<button type="button" data-wtype="${t}" aria-pressed="${wstate.type === t}">${t}</button>`).join('');
  const outlets = new Set(items.map((x) => x.outlet)).size;
  const countries = new Set(items.map((x) => x.country)).size;
  const nKo = items.filter((x) => x.titleKo).length;
  $('worldSub').textContent = `해외 ${outlets}개 매체(${countries}개 국가·지역)가 최근 3일 동안 제목에 한국을 다룬 기사 ${items.length}건을 사건별로 묶었습니다. 원제목과 한국어 기계 번역${nKo < items.length ? `(${nKo}건)` : ''}을 나란히 보여 줍니다.`;
  const pass = (x) => inBloc(x) && (wstate.region === '전체' || x.region === wstate.region) && (wstate.type === '전체' || x.type === wstate.type);
  const clusters = w.clusters.map((c) => ({ ...c, list: c.ids.map(fItem).filter(pass) })).filter((c) => c.list.length)
    .sort((a, b) => b.list.length - a.list.length || b.list[0].publishedAt.localeCompare(a.list[0].publishedAt));
  $('worldList').innerHTML = clusters.map((c) => {
    const head = c.list[0];
    const dom = (state.data.compare?.both || []).find((b) => b.foreign.includes(head.id));
    const blocs = [...new Set(c.list.map(blocOf))];
    return `<li class="wc">
      <p class="wc-k"><span class="rg">${esc(head.region)}</span><span class="bl">${blocs.map(esc).join(' · ')}</span>${c.list.length > 1 ? `<span>매체 ${new Set(c.list.map((x) => x.outlet)).size}곳 · 독립 보도 ${Math.min(c.independent, new Set(c.list.map((x) => x.outlet)).size)}</span>` : '<span>단독 보도</span>'}
        ${dom ? `<button type="button" class="more-d" data-open="story:${esc(dom.domestic.story)}">국내 보도와 비교</button>` : '<span class="muted">국내 대응 보도 미확인</span>'}</p>
      <ol class="flist">${c.list.map((x, i) => foreignRow(x, { compact: i > 0 })).join('')}</ol>
    </li>`;
  }).join('') || '<li class="empty">조건에 맞는 해외 보도가 없습니다.</li>';
  const byBloc = BLOCS.slice(1).map((b) => [b, (w.outlets || []).filter((o) => (o.bloc || BLOC_OF[o.country]) === b)]).filter(([, l]) => l.length);
  $('outletList').innerHTML = byBloc.map(([b, list]) => `<li class="ob"><span>${b}</span></li>` + list.map((o) => {
    const n = items.filter((x) => x.outlet === o.name).length;
    return `<li><b>${esc(o.ko)}</b><span class="oc">${esc(o.country)} · ${esc(o.kind)}${o.paywall ? ' · 유료 구독' : ''}</span><span class="ow">${esc(o.owner)}</span><span class="on">${n}건</span></li>`;
  }).join('')).join('');
}

/* 국내외 보도 비교 */
const VERIFY = (q) => [
  ['정책 발표', `https://www.korea.kr/search/searchMain.do?srchWord=${encodeURIComponent(q)}`, '정책브리핑 검색'],
  ['법적 근거', `https://www.law.go.kr/LSW/lsSc.do?query=${encodeURIComponent(q)}`, '국가법령정보센터 검색'],
  ['입법 진행', 'https://likms.assembly.go.kr/bill/main.do', '의안정보시스템 (직접 검색)'],
  ['입법 예고', `https://opinion.lawmaking.go.kr/gcom/ogLmPp?searchText=${encodeURIComponent(q)}`, '국민참여입법센터 검색'],
  ['예산', 'https://www.openfiscaldata.go.kr', '열린재정 (직접 검색)'],
  ['집행 실적·통계', `https://kosis.kr/search/search.do?query=${encodeURIComponent(q)}`, 'KOSIS 검색'],
];
function issueBlock(b) {
  const s = storyBy.get(b.domestic.story);
  const fl = b.foreign.map(fItem).filter(Boolean);
  const q = (b.common[0] || b.section || '').split('·')[0];
  const firstF = [...new Map(fl.map((x) => [x.outlet, x])).values()].slice(0, 4);
  return `<article class="issue">
    <header class="is-h"><span class="tag">${esc(b.section || '')}</span><h3>${esc(b.common.join(' · ') || b.title)}</h3><span class="is-sub">국내 ${b.domestic.outlets}곳 · 해외 ${b.foreignOutlets.length}개 매체</span></header>
    <div class="is-cols">
      <section class="is-c">
        <h4>국내 보도</h4>
        <p class="is-n"><b>${b.domestic.outlets}</b>곳 보도 · 독립 보도 추정 <b>${b.domestic.independent ?? '-'}</b></p>
        ${s ? `<p class="is-t"><a href="${esc(s.link)}" target="_blank" rel="noopener noreferrer"><span class="hl">${esc(s.title)}</span></a></p>
        <p class="meta"><span>${esc(s.source)}</span><span>${stamp(s.publishedAt)}</span>${s.related?.length ? `<button type="button" class="rel-btn" data-rel="${esc(s.link)}">언론 ${outlets(s)}곳</button>` : ''}</p>` : ''}
        ${b.domestic.alt?.length ? `<p class="is-alt">관련 국내 사안 ${b.domestic.alt.length}건 더 있음</p>` : ''}
        <button type="button" class="more-d" data-open="story:${esc(b.domestic.story)}">국내 보도 자세히</button>
      </section>
      <section class="is-c">
        <h4>해외 보도</h4>
        <p class="is-n"><b>${b.foreignOutlets.length}</b>개 매체 · ${esc(b.foreignCountries.join(', '))} · 독립 보도 추정 <b>${b.foreignIndependent}</b></p>
        <ol class="flist">${firstF.map((x) => foreignRow(x, { compact: true })).join('')}</ol>
        ${fl.length > firstF.length ? `<p class="is-alt">같은 사건 해외 기사 ${fl.length - firstF.length}건 더 있음</p>` : ''}
      </section>
      <section class="is-c is-x">
        <h4>제목 대조 <small>자동 · 제목 기준</small></h4>
        <dl class="xr">
          <div><dt>양쪽 제목에 공통</dt><dd>${b.common.map((t) => `<span class="chip">${esc(t)}</span>`).join('') || '<span class="muted">없음</span>'}</dd></div>
          <div><dt>국내 제목에만</dt><dd>${b.onlyDomestic.map((t) => `<span class="chip">${esc(t)}</span>`).join('') || '<span class="muted">없음</span>'}</dd></div>
          <div><dt>해외 제목에만</dt><dd>${b.onlyForeign.map((t) => `<span class="chip">${esc(t)}</span>`).join('') || '<span class="muted">없음</span>'}</dd></div>
          <div><dt>사실관계 충돌·미확인</dt><dd class="muted">자동 판정하지 않습니다. 원문을 대조해 확인하십시오.</dd></div>
        </dl>
      </section>
    </div>
    <details class="pv">
      <summary>공식 자료와 정책 실행 확인 경로</summary>
      <ol class="pv-steps">
        <li><b>공식 발표</b>${b.official.length ? b.official.map((o) => `<a href="${esc(o.link)}" target="_blank" rel="noopener noreferrer">${esc(o.title)}</a>`).join('') : '<span class="nd">자료 미확인</span>'}</li>
        ${VERIFY(q).slice(1).map(([k, url, label]) => `<li><b>${k}</b><span class="nd">자료 미확인</span><a href="${url}" target="_blank" rel="noopener noreferrer">${label} ↗</a></li>`).join('')}
        <li><b>사후 평가</b><span class="nd">자료 미확인</span></li>
      </ol>
      <p class="dw-note">검색어 ‘${esc(q)}’로 각 공식 누리집 검색 결과를 엽니다. 이 지면은 해당 자료의 존재를 자동 확인하지 않으므로 모두 ‘자료 미확인’으로 표시합니다.</p>
    </details>
  </article>`;
}
function renderCompare() {
  const c = state.data.compare;
  if (!c) { $('compareBody').innerHTML = '<p class="empty">비교 자료가 없습니다.</p>'; return; }
  const fo = c.foreignOnly || [];
  const dom = (c.domesticOnly || []).map((l) => storyBy.get(l)).filter(Boolean);
  $('compareBody').innerHTML = `
    <section class="cmp-sec"><h3 class="cmp-h">국내외 함께 보도 <small>${c.both.length}건</small></h3>
      ${c.both.map(issueBlock).join('') || '<p class="empty">지금은 국내외가 함께 다룬 사안이 확인되지 않습니다.</p>'}</section>
    <div class="cmp-two">
      <section class="cmp-sec"><h3 class="cmp-h">해외에서만 확인된 사안 <small>${fo.length}건 · 매체 2곳 이상</small></h3>
        <ol class="flist">${fo.map((b) => { const x = fItem(b.foreign[0]); return x ? `<li class="frow-wrap"><p class="wc-k"><span class="rg">${esc(b.region)}</span><span>매체 ${b.foreignOutlets.length}곳</span></p>${foreignRow(x)}</li>` : ''; }).join('') || '<li class="empty">없음</li>'}</ol>
        <p class="dw-note">국내 보도가 없다는 뜻이 아니라, 이번 수집 범위에서 같은 사건으로 이어지지 않았다는 뜻입니다.</p></section>
      <section class="cmp-sec"><h3 class="cmp-h">국내에서만 크게 다룬 사안 <small>${dom.length}건 · 언론 5곳 이상</small></h3>
        <ol class="feed">${dom.map((it) => feedItem(it)).join('') || '<li class="empty">없음</li>'}</ol>
        <p class="dw-note">해외 14개 매체의 최근 3일 제목에서 같은 사건이 확인되지 않은 사안입니다.</p></section>
    </div>`;
  translateVisible();
}

/* 출처 분석 */
function hbars(rows, { max, unit = '건', note = (r) => '' } = {}) {
  const m = max || Math.max(1, ...rows.map((r) => r.n));
  return `<ol class="hb">${rows.map((r) => `<li><span class="hb-n">${esc(r.name)}${note(r) ? `<small>${esc(note(r))}</small>` : ''}</span>
    <span class="hb-t"><i style="width:${Math.max(1, Math.round((r.n / m) * 100))}%"></i></span><span class="hb-v">${r.label ?? `${r.n.toLocaleString('ko-KR')}${unit}`}</span></li>`).join('')}</ol>`;
}
function renderSources() {
  const s = state.data.sourceStats;
  if (!s) { $('sourcesBody').innerHTML = '<p class="empty">출처 통계를 계산하지 못했습니다.</p>'; return; }
  $('sourcesSub').textContent = `${fmt.mdhm.format(new Date(s.measuredAt))} 측정 · ${s.scope}. 모든 수치는 실제 수집 자료로 계산했으며 추정치는 따로 표시합니다.`;
  const y = s.yonhap;
  $('sourcesBody').innerHTML = `
    <dl class="src-kpi">
      <div><dt>국내 수집 기사</dt><dd>${s.collected.total.toLocaleString('ko-KR')}<small>건</small></dd><p>포털 재전송 ${s.collected.portal}건 제외</p></div>
      <div><dt>국내 매체 수</dt><dd>${s.collected.outlets}<small>곳</small></dd><p>해외 ${s.foreign.byOutlet.length}개 매체 별도</p></div>
      <div><dt>상위 5개 매체 점유</dt><dd>${s.concentration.cr5}<small>%</small></dd><p>집중도 지수(HHI) ${s.concentration.hhi}</p></div>
      <div><dt>재배포 추정</dt><dd>${s.reuse.share}<small>%</small></dd><p>다른 매체와 제목 80% 이상 일치</p></div>
      <div><dt>독립 보도 비율</dt><dd>${s.independent.share}<small>%</small></dd><p>사안별 같은 제목 묶음을 하나로 셈</p></div>
      <div><dt>해외 수집 기사</dt><dd>${s.foreign.total}<small>건</small></dd><p>사건 ${s.foreign.clusters}건 · 독립 보도 ${s.foreign.independent}</p></div>
    </dl>
    <div class="src-grid">
      <section class="src-sec"><h3>연합뉴스 비중: 수집과 노출</h3>
        ${hbars([
          { name: '수집 단계', n: y.collectedShare, label: `${y.collectedShare}% (${y.collected}건)` },
          { name: '화면 대표 기사', n: y.repShare, label: `${y.repShare}% (${y.rep}건)` },
          { name: '화면 사안 참여', n: y.anyShare, label: `${y.anyShare}% (${y.any}건)` },
          { name: '연합 제목 재사용 추정', n: y.reuseShare, label: `${y.reuseShare}% (${y.reuse}건)` },
        ], { max: Math.max(20, y.anyShare) })}
        <p class="dw-note">수집 단계는 이번 회차 국내 기사 ${s.collected.total}건 중 비중, 화면 비중은 지면에 실린 사안 ${s.shown.stories}건 기준입니다. 대표 기사는 같은 매체가 반복되지 않게 통신·방송 안에서 고르게 배분합니다. 재사용 추정은 다른 매체 기사 제목이 연합뉴스 제목과 80% 이상 같은 경우입니다.</p>
      </section>
      <section class="src-sec"><h3>국가별 수집 분포</h3>${hbars(s.countries.map((c) => ({ name: c.name, n: c.n })))}</section>
      <section class="src-sec"><h3>국내 수집 상위 매체</h3>${hbars(s.collected.top.slice(0, 15).map((r) => ({ name: r.name, n: r.n, label: `${r.n}건 · ${r.share}%`, type: r.type })), { note: (r) => r.type })}</section>
      <section class="src-sec"><h3>화면 대표 기사 매체</h3>${hbars(s.shown.rep.map((r) => ({ name: r.name, n: r.n, label: `${r.n}건 · ${r.share}%` })))}
        <h3 style="margin-top:20px">해외 매체별 기사</h3>${hbars(s.foreign.byOutlet)}</section>
    </div>
    <section class="src-sec src-method"><h3>측정 방법과 한계</h3>
      <ul>
        <li>수집 기사 수는 Google 뉴스·Bing 뉴스 검색 결과에서 매체와 제목이 같은 중복을 지운 개별 기사 수입니다. 포털(다음·네이트 등) 재전송은 매체로 세지 않습니다.</li>
        <li>독립 보도는 같은 사안 안에서 매체당 한 건을 남긴 뒤 제목이 80% 이상 같은 기사를 하나로 묶어 셉니다. 본문을 비교하지 않으므로 추정치입니다.</li>
        <li>최근 7일·30일 매체별 비중은 수집 이력 저장소가 아직 없어 측정하지 않았습니다. 저장소를 연결하면 같은 방식으로 누적 산출할 수 있습니다.</li>
        <li>매체 설명에는 공개된 소유·운영 형태만 적고, 정치 성향이나 의도는 판정하지 않습니다.</li>
      </ul>
    </section>`;
}

function translateVisible() {} // 번역은 서버에서 수집 시 붙인다 (titleKo)

/* ── 해외 토픽: 주제별 해외 주요 매체 보도 (따로 불러온다) ── */
const gstate = { data: null, loading: false, topic: 'all', at: 0 };
async function loadGlobal(force = false) {
  if (gstate.loading || (!force && gstate.data && Date.now() - gstate.at < 15 * 60 * 1000)) { renderGlobal(); return; }
  gstate.loading = true;
  if (!gstate.data) renderGlobal();
  for (const src of ['/api/global', 'data/global.json']) {
    try {
      const r = await fetch(src, { cache: 'no-store' });
      if (!r.ok) throw new Error(r.status);
      const d = await r.json();
      if (!d.topics) throw new Error('형식 오류');
      gstate.data = d; gstate.at = Date.now();
      break;
    } catch {}
  }
  gstate.loading = false;
  if (state.view === 'global') { renderGlobal(); atlasMod?.refresh(); }
}

/* ── 세계 권력 지형(지구본): 해외 토픽을 열 때만 불러온다 ── */
let atlasMod = null, atlasLoading = null;
function openSheet(kind, html, after) {
  $('dwKind').textContent = kind;
  $('dwBody').innerHTML = html;
  dw.classList.add('dw-atlas');
  if (!dw.open) dw.showModal();
  dw.querySelector('.dw-in').scrollTop = 0;
  after?.($('dwBody'));
}
dw.addEventListener('close', () => dw.classList.remove('dw-atlas'));
function mountAtlasLazy() {
  if (atlasMod) { atlasMod.refresh(); return; }
  if (atlasLoading) return;
  atlasLoading = import('./atlas.js?v=2-9').then((m) => {
    atlasMod = m;
    return m.mountAtlas({ esc, stamp, foreignRow, toast: (s) => toast(s), openSheet, getWorld: () => state.data?.world, getGlobal: () => gstate.data });
  }).catch((e) => { console.error(e); const el = $('atStatus'); if (el) el.textContent = '지도를 불러오지 못했습니다.'; atlasLoading = null; });
}
function renderGlobal() {
  $('globalMode').innerHTML = FMODES.map(([k, l]) => `<button type="button" data-fmode="${k}" aria-pressed="${fmode === k}">${l}</button>`).join('');
  const d = gstate.data;
  if (!d) {
    $('globalTopics').innerHTML = '';
    $('globalBody').innerHTML = gstate.loading ? '<div class="skel"><i></i><i></i><i></i><i></i></div>' : '<p class="empty">해외 토픽을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>';
    return;
  }
  const topics = d.topics.filter((t) => t.count);
  if (gstate.topic !== 'all' && !topics.some((t) => t.id === gstate.topic)) gstate.topic = 'all';
  const total = topics.reduce((n, t) => n + t.count, 0);
  $('globalSub').textContent = `해외 주요 ${d.outlets}개 매체가 최근 2~3일 다룬 국제 이슈 기사 ${total}건을 주제와 사건별로 묶었습니다. ${fmt.mdhm.format(new Date(d.generatedAt))} 수집${d.stale ? ' · 최신 수집 실패로 저장본 표시' : ''}.`;
  $('globalTopics').innerHTML = [['all', '전체', total], ...topics.map((t) => [t.id, t.name, t.count])]
    .map(([id, name, n]) => `<button type="button" data-gtopic="${id}" aria-pressed="${gstate.topic === id}">${esc(name)} <small>${n}</small></button>`).join('');
  const shown = gstate.topic === 'all' ? topics : topics.filter((t) => t.id === gstate.topic);
  $('globalBody').innerHTML = shown.map((t) => `<section class="gt" id="gt-${t.id}">
      <header class="gt-h"><h3>${esc(t.name)}</h3>${t.note ? `<span class="gt-note">${esc(t.note)}</span>` : ''}<span class="pm">사건 ${t.clusters.length} · 기사 ${t.count}</span></header>
      <ol class="wlist">${(gstate.topic === 'all' ? t.clusters.slice(0, 4) : t.clusters).map((c) => {
        const head = c.items[0];
        return `<li class="wc gc${head.image ? ' has-pic' : ''}">
        ${head.image ? `<a class="pic gc-pic" href="${esc(head.link)}" target="_blank" rel="noopener noreferrer" tabindex="-1" aria-hidden="true"><img src="${esc(head.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentNode.remove();this.closest('.gc')?.classList.remove('has-pic')"></a>` : ''}
        <div class="gc-body"><p class="wc-k">${c.outlets.length > 1 ? `<span>매체 ${c.outlets.length}곳</span>` : '<span>단독 보도</span>'}<span class="bl">${esc(c.items.slice(0, 4).map((x) => x.outletKo).filter((v, i, a) => a.indexOf(v) === i).join(' · '))}</span></p>
        <ol class="flist">${c.items.slice(0, 4).map((x, i) => foreignRow(x, { compact: i > 0, thumb: i > 0 })).join('')}</ol></div></li>`;
      }).join('')}</ol>
      ${gstate.topic === 'all' && t.clusters.length > 4 ? `<button type="button" class="more-d gt-more" data-gtopic="${t.id}">${esc(t.name)} 사건 ${t.clusters.length - 4}건 더 보기</button>` : ''}
    </section>`).join('') || '<p class="empty">지금 수집된 해외 토픽이 없습니다.</p>';
}
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-gtopic]');
  if (!g) return;
  gstate.topic = g.dataset.gtopic;
  renderGlobal();
  if (g.classList.contains('gt-more')) scrollTo({ top: 0 });
});

/* 상세 서랍에 해외 보도 붙이기 */
function foreignSection(it) {
  const fl = (it.foreign || []).map(fItem).filter(Boolean);
  if (!fl.length) return '<section class="dw-sec"><h3>해외 보도</h3><p class="dw-note" style="margin-top:0">해외 14개 매체의 최근 3일 제목에서 같은 사건이 확인되지 않았습니다.</p></section>';
  const outletsN = new Set(fl.map((x) => x.outlet)).size;
  return `<section class="dw-sec"><h3>해외 보도 · ${outletsN}개 매체</h3>
    <ol class="flist">${fl.slice(0, 10).map((x) => foreignRow(x, { compact: true })).join('')}</ol>
    <p class="dw-note">같은 사건 여부는 제목에 나온 요소를 한·영 대응표로 맞춰 자동 판정한 것입니다.</p></section>`;
}

/* 보기 전환 */
function renderViewSwitch() {
  const v = VIEWS.includes(state.view) ? state.view : 'home';
  $('v-home').hidden = v !== 'home';
  for (const id of ['global', 'policy', 'macro', 'street', 'world', 'compare', 'sources', 'realty']) $(`v-${id}`).hidden = v !== id;
  if (v === 'global') { loadGlobal(); mountAtlasLazy(); }
  document.querySelectorAll('[data-view]').forEach((a) => a.setAttribute('aria-selected', a.dataset.view === v));
  if (!state.data) return;
  if (v === 'policy') renderPolicy();
  if (v === 'macro') renderMacro();
  if (v === 'street') renderStreet();
  if (v === 'realty') renderRealty();
  if (v === 'world') renderWorld();
  if (v === 'compare') renderCompare();
  if (v === 'sources') renderSources();
}
document.addEventListener('click', (e) => {
  const v = e.target.closest('[data-view]');
  if (v) { e.preventDefault(); state.view = v.dataset.view; writeURL(true); transition(() => { renderViewSwitch(); }); return; }
  const hm = e.target.closest('[data-home]');
  if (hm) { e.preventDefault(); go({ section: 'all', query: '', kw: '' }); return; }
  const bl = e.target.closest('[data-wbloc]');
  if (bl) { wstate.bloc = bl.dataset.wbloc; renderWorld(); return; }
  const fm = e.target.closest('[data-fmode]');
  if (fm) { fmode = fm.dataset.fmode; document.documentElement.dataset.fmode = fmode; try { localStorage.setItem('fmode', fmode); } catch {} document.querySelectorAll('[data-fmode]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.fmode === fmode)); return; }
  const r = e.target.closest('[data-wregion]');
  if (r) { wstate.region = r.dataset.wregion; renderWorld(); return; }
  const t = e.target.closest('[data-wtype]');
  if (t) { wstate.type = t.dataset.wtype; renderWorld(); return; }
});

// 보기 메뉴는 상단 바 바로 아래에 고정 (바 높이는 화면 폭에 따라 달라짐)
const syncBarH = () => document.documentElement.style.setProperty('--bar-h', `${document.querySelector('.bar').offsetHeight}px`);
syncBarH();
new ResizeObserver(syncBarH).observe(document.querySelector('.bar'));

/* ── 입법·정책 모니터링 ── */
const pstate = { sched: 'events', press: 'assembly' };
const kday = (iso) => (iso ? fmt.md.format(new Date(iso)) : '');
const dday = (iso) => {
  if (!iso) return '';
  const d = Math.round((new Date(dayOf(new Date(iso))) - new Date(dayOf(new Date()))) / 86400000);
  return d === 0 ? '오늘' : d > 0 ? `D-${d}` : `${-d}일 전`;
};
const won = (n) => (n >= 1e8 ? `${(n / 1e8).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억 원` : `${Math.round(n / 1e4).toLocaleString('ko-KR')}만 원`);

function renderPolicy() {
  const p = state.data.policy;
  if (!p) { $('polAssembly').innerHTML = '<li class="empty">입법·정책 자료를 불러오지 못했습니다.</li>'; return; }
  const now = Date.now();
  const upcoming = [...(p.events || []), ...(p.offices || [])].filter((x) => x.date && Date.parse(x.date) >= now - 12 * 3600000);
  const closing = (p.govPre || []).filter((x) => x.daysLeft >= 0 && x.daysLeft <= 7).length;
  $('polKpi').innerHTML = `
    <div><dt>국회 입법예고</dt><dd>${(p.assemblyPre || []).length}<small>건</small></dd><p>의견 접수 중인 최근 접수분</p></div>
    <div><dt>정부 입법예고 진행</dt><dd>${(p.govPre || []).length}<small>건</small></dd><p>7일 안에 마감 ${closing}건</p></div>
    <div><dt>다가오는 국회 행사</dt><dd>${upcoming.length}<small>건</small></dd><p>세미나·토론회·기자회견</p></div>
    <div><dt>국회 보도자료</dt><dd>${(p.press || []).length}<small>건</small></dd><p>최근 공개분</p></div>`;

  $('polAssembly').innerHTML = (p.assemblyPre || []).map((b) => `<li class="pl">
      <a href="${esc(b.link)}" target="_blank" rel="noopener noreferrer"><span class="hl">${esc(b.title)}</span></a>
      <p class="meta"><span class="tnum">의안 ${esc(b.no)}</span><span>${esc(b.sponsor)}</span><span class="tag">${esc(b.committee)}</span></p></li>`).join('') || '<li class="empty">진행 중인 국회 입법예고가 없습니다.</li>';

  const gov = [...(p.govPre || [])].sort((a, b) => (Number.isFinite(a.daysLeft) ? a.daysLeft : 999) - (Number.isFinite(b.daysLeft) ? b.daysLeft : 999));
  $('polGov').innerHTML = gov.map((g) => {
    const left = Number.isFinite(g.daysLeft) ? g.daysLeft : null;
    return `<li class="pl">
      <a href="${esc(g.link)}" target="_blank" rel="noopener noreferrer"><span class="hl">${esc(g.title)}</span></a>
      <p class="meta"><span class="chip">${esc(g.kind || '-')}</span><span>${esc(g.dept)}</span><span>${esc(g.lawType)}</span>
        ${left != null ? `<span class="dl${left <= 7 ? ' soon' : ''}">마감 ${left === 0 ? '오늘' : `D-${left}`}</span>` : ''}<span>의견 ${g.opinions}건</span></p>
      <p class="pl-sub">${esc(g.period)}</p></li>`;
  }).join('') || '<li class="empty">진행 중인 정부 입법예고가 없습니다.</li>';

  const SCHED = [['events', '행사·세미나'], ['offices', '기자회견·의원실'], ['politics', '주요정치일정'], ['agenda', '의사일정 공지']];
  $('polSchedTabs').innerHTML = SCHED.map(([k, t]) => `<button type="button" data-psched="${k}" aria-pressed="${pstate.sched === k}">${t}</button>`).join('');
  let sched = p[pstate.sched] || [];
  if (pstate.sched === 'events' || pstate.sched === 'offices') sched = sched.filter((x) => x.date && Date.parse(x.date) >= now - 12 * 3600000).sort((a, b) => a.date.localeCompare(b.date));
  $('polSched').innerHTML = sched.slice(0, 14).map((x) => {
    const href = x.link || 'https://www.assembly.go.kr/portal/main/contents.do?menuNo=600043';
    const future = pstate.sched === 'events' || pstate.sched === 'offices';
    return `<li class="pl pl-row"><span class="pl-d">${future ? `<b>${dday(x.date)}</b>${kday(x.date)} ${fmt.hm.format(new Date(x.date))}` : kday(x.date)}</span>
      <a href="${esc(href)}" target="_blank" rel="noopener noreferrer"><span class="hl">${esc(x.title)}</span></a></li>`;
  }).join('') || '<li class="empty">예정된 일정이 없습니다.</li>';

  const policySec = state.data.sections.find((s) => s.id === 'policy');
  const PRESS = [['assembly', '국회'], ['gov', '정부'], ['ftc', '공정위']];
  $('polPressTabs').innerHTML = PRESS.map(([k, t]) => `<button type="button" data-ppress="${k}" aria-pressed="${pstate.press === k}">${t}</button>`).join('');
  const press = pstate.press === 'assembly' ? (p.press || []).map((x) => ({ title: x.title, link: x.link, date: x.date, by: '국회' }))
    : pstate.press === 'ftc' ? (p.ftc || []).map((x) => ({ title: x.title, link: x.link, date: x.date, by: x.dept, penalty: x.penalty }))
    : (policySec?.items || []).map((x) => ({ title: x.title, link: x.link, date: x.publishedAt, by: x.source }));
  $('polPress').innerHTML = press.slice(0, 14).map((x) => `<li class="pl pl-row"><span class="pl-d">${kday(x.date)}</span>
      <span><a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer"><span class="hl">${esc(x.title)}</span></a>
      <span class="pl-by">${esc(x.by || '')}${x.penalty ? ` · <b class="pen">과징금 ${won(x.penalty)}</b>` : ''}</span></span></li>`).join('') || '<li class="empty">보도자료가 없습니다.</li>';

  const people = p.people || [];
  const max = Math.max(1, ...people.map((x) => x.outlets));
  $('polPeople').innerHTML = people.map((x) => `<li><button type="button" class="pp" data-open="person:${esc(x.name)}">
      <span class="pp-n">${esc(x.name)}<small>${esc(x.roles.join('·'))}</small></span>
      <span class="pp-b"><i style="width:${Math.max(4, Math.round((x.outlets / max) * 100))}%"></i></span>
      <span class="pp-c">${x.storyCount}사안 · ${x.outlets}곳</span></button></li>`).join('') || '<li class="empty">집계할 만큼 언급된 인물이 없습니다.</li>';
}

function personDetail(name) {
  const x = (state.data.policy?.people || []).find((pp) => pp.name === name);
  if (!x) return '<p class="empty">자료가 없습니다.</p>';
  return `<h2 class="dw-t" id="dwTitle" style="margin-top:0">${esc(x.name)} <small class="muted">${esc(x.roles.join('·'))}</small></h2>
    <p class="dw-sum">이번 수집 회차에서 제목에 직함과 함께 언급된 사안 ${x.storyCount}건, 보도 매체 합계 ${x.outlets}곳입니다.</p>
    <section class="dw-sec"><h3>언급된 사안</h3><ol class="dw-news">${x.stories.map((s) => `<li>
      ${storyBy.has(s.link) ? `<button type="button" data-open="story:${esc(s.link)}"><span class="hl">${esc(s.title)}</span></button>` : `<a href="${esc(s.link)}" target="_blank" rel="noopener noreferrer"><span class="hl">${esc(s.title)}</span></a>`}
      <p class="meta"><span>${esc(s.source || '')}</span>${s.publishedAt ? `<span>${stamp(s.publishedAt)}</span>` : ''}<span>언론 ${s.outlets}곳</span></p></li>`).join('')}</ol></section>
    <p class="dw-note">이름과 직함이 제목에 함께 나온 경우만 셉니다. 동명이인을 구분하지 않으며 발언 내용이나 입장은 판정하지 않습니다.</p>`;
}

document.addEventListener('click', (e) => {
  const s = e.target.closest('[data-psched]');
  if (s) { pstate.sched = s.dataset.psched; renderPolicy(); return; }
  const pr = e.target.closest('[data-ppress]');
  if (pr) { pstate.press = pr.dataset.ppress; renderPolicy(); }
});

/* ── 거시경제 읽기: 한국은행 이슈노트 + 핵심 지표(ECOS) ── */
const mstate = { topic: '전체', open: new Set() };
const glossOf = (k) => (state.data.bok?.glossary || []).find(([t]) => t === k)?.[1] || '';

// 지표마다 기준선과, 이슈노트 주제와의 연결
const ECOS_REF = { cpi: { v: 2, label: '물가목표 2%' }, gdp: { v: 0, label: '0%' }, ca: { v: 0, label: '0' } };
const ECOS_TOPIC = { base: '금리·통화', kgb3: '금리·통화', cpi: '물가', unemp: '고용·노동', krw: '대외·환율', ca: '대외·환율', gdp: '성장·경기' };
const ecosItems = () => state.data.ecos?.items || [];
// 노트와 가장 가까운 지표: 제목 → 요지에 지표 이름이 직접 나오면 그것, 아니면 첫 주제의 지표
const ECOS_WORD = { ca: /경상수지/, cpi: /물가/, base: /기준금리/, kgb3: /국고채|국채/, krw: /환율|원화/, unemp: /실업|고용/, gdp: /성장률|GDP/ };
function ecosFor(n) {
  const items = ecosItems();
  for (const txt of [n.title, n.points.join(' ')]) {
    const hit = items.find((x) => ECOS_WORD[x.id]?.test(txt));
    if (hit) return hit;
  }
  for (const t of n.topics) { const hit = items.find((x) => ECOS_TOPIC[x.id] === t); if (hit) return hit; }
  return null;
}
const chgUnit = (x) => (x.unit === '%' ? '%p' : x.unit);
const chgText = (x) => (x.change == null ? '' : x.change === 0 ? '변동 없음' : `${x.change > 0 ? '▲' : '▼'} ${num(Math.abs(x.change), x.digits)}${chgUnit(x)}`);
const chgCls = (x) => (!x.change ? 'flat' : x.change > 0 ? 'up' : 'down');

// 주제 그림표: 같은 굵기의 선 하나로 그린 작은 표지 (장식이 아니라 주제 식별용)
const PICTO = {
  '물가': '<path d="M5 19V9l7-5 7 5v10"/><path d="M9 19v-5h6v5"/><path d="M17 3v4"/>',
  '금리·통화': '<circle cx="12" cy="12" r="8"/><path d="M8.5 15.5l7-7"/><circle cx="9" cy="9" r="1.2"/><circle cx="15" cy="15" r="1.2"/>',
  '성장·경기': '<path d="M4 19h16"/><path d="M5 15l4-4 3 3 6-7"/><path d="M14 7h4v4"/>',
  '고용·노동': '<circle cx="12" cy="7" r="3"/><path d="M6 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/>',
  '대외·환율': '<path d="M4 9h13l-3-3"/><path d="M20 15H7l3 3"/>',
  '금융안정': '<path d="M12 3l8 3v5c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/>',
  '부동산': '<path d="M3 11l9-7 9 7"/><path d="M6 10v10h12V10"/><path d="M10 20v-5h4v5"/>',
  '인구·사회': '<circle cx="8" cy="8" r="2.5"/><circle cx="16" cy="8" r="2.5"/><path d="M3.5 19c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5M11.5 19c0-2.5 2-4.5 4.5-4.5s4.5 2 4.5 4.5"/>',
  '디지털·신기술': '<rect x="6" y="6" width="12" height="12" rx="1"/><path d="M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3"/>',
  '국제경제': '<circle cx="12" cy="12" r="8"/><path d="M4 12h16M12 4c2.5 2.5 2.5 13.5 0 16M12 4c-2.5 2.5-2.5 13.5 0 16"/>',
};
const picto = (t, cls = 'picto') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${PICTO[t] || PICTO['국제경제']}</svg>`;

// 작은 추세선(상호작용 없음). 기준선이 있으면 점선으로 함께 그린다
function ecoSpark(x, { W = 160, H = 44 } = {}) {
  const v = x.series.map((p) => p.v);
  const ref = ECOS_REF[x.id];
  const all = ref ? [...v, ref.v] : v;
  const min = Math.min(...all), max = Math.max(...all), span = max - min || 1;
  const y = (n) => (3 + (1 - (n - min) / span) * (H - 6)).toFixed(1);
  const d = v.map((n, i) => `${i ? 'L' : 'M'}${((i / (v.length - 1)) * W).toFixed(1)} ${y(n)}`).join('');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    ${ref ? `<line class="sp-ref" x1="0" x2="${W}" y1="${y(ref.v)}" y2="${y(ref.v)}" vector-effect="non-scaling-stroke"/>` : ''}
    <path class="sp-line" d="${d}" vector-effect="non-scaling-stroke"/>
    <circle class="sp-end" cx="${W}" cy="${y(v.at(-1))}" r="2.6"/></svg>`;
}

function renderEcos() {
  const e = state.data.ecos;
  const box = $('ecosGrid');
  if (!box) return;
  if (!e?.items?.length) { box.innerHTML = '<li class="empty">경제 지표를 불러오지 못했습니다.</li>'; return; }
  box.innerHTML = e.items.map((x) => `<li><button type="button" class="eco" data-open="ecos:${x.id}">
      <span class="eco-n">${esc(x.name)}</span>
      <span class="eco-v"><b data-count="${x.value}" data-digits="${x.digits}">${num(x.value, x.digits)}</b><small>${esc(x.unit)}</small></span>
      <span class="eco-c ${chgCls(x)}">${chgText(x)}<em>${esc(x.prevPeriod)} 대비</em></span>
      ${ecoSpark(x)}
      <span class="eco-p">${esc(x.series[0].label)} ~ ${esc(x.period)}${ECOS_REF[x.id] ? ` · 점선 ${esc(ECOS_REF[x.id].label)}` : ''}</span>
    </button></li>`).join('');
  $('ecosMeta').textContent = `${e.staleAt ? '직전 자료 · ' : ''}${fmt.mdLong.format(new Date(e.fetchedAt))} 조회${e.keyMode === 'sample' ? ' · 시험용 인증키' : ''}`;
}

function ecosDetail(id) {
  const x = ecosItems().find((i) => i.id === id);
  if (!x) return '<p class="empty">지표를 찾을 수 없습니다.</p>';
  const notes = (state.data.bok?.notes || []).filter((n) => n.topics.includes(ECOS_TOPIC[id])).slice(0, 4);
  const rows = x.series.slice(-6).reverse();
  return `<h2 class="dw-t" id="dwTitle" style="margin-top:0">${esc(x.name)}</h2>
    <p class="dw-chips"><span>${esc(ECOS_TOPIC[id] || '')}</span><span>한국은행 ECOS ${esc(x.stat)}</span></p>
    <div class="eco-big"><b data-count="${x.value}" data-digits="${x.digits}">${num(x.value, x.digits)}</b><small>${esc(x.unit)}</small>
      <span class="eco-c ${chgCls(x)}">${chgText(x)}<em>${esc(x.prevPeriod)} 대비 · 기준 ${esc(x.period)}</em></span></div>
    <dl class="eco-def"><div><dt>무엇인가</dt><dd>${esc(x.what)}</dd></div><div><dt>읽는 법</dt><dd>${esc(x.read)}</dd></div></dl>
    ${seriesSvg(x.series.map((p) => p.v), { digits: x.digits, label: `${x.name} 추이`, labels: x.series.map((p) => p.label), ref: ECOS_REF[id] || null, H: 180 })}
    <table class="eco-t"><thead><tr><th>기간</th><th>값</th><th>직전 대비</th></tr></thead><tbody>
      ${rows.map((p, i) => { const prev = x.series[x.series.length - 2 - i]; const c = prev ? +(p.v - prev.v).toFixed(x.digits) : null;
        return `<tr><td>${esc(p.label)}</td><td>${num(p.v, x.digits)}${esc(x.unit === '%' ? '%' : '')}</td><td class="${c == null ? '' : c > 0 ? 'up' : c < 0 ? 'down' : ''}">${c == null ? '' : `${c > 0 ? '+' : ''}${num(c, x.digits)}`}</td></tr>`; }).join('')}
    </tbody></table>
    ${notes.length ? `<h3 class="dw-sub">같은 주제의 한국은행 이슈노트</h3><ol class="dw-news">${notes.map((n) => `<li><a href="${esc(n.link)}" target="_blank" rel="noopener noreferrer"><span class="hl">${esc(n.title)}</span></a><p class="meta"><span>${esc(n.no)}</span><span>${n.date ? fmt.mdLong.format(new Date(n.date)) : ''}</span></p></li>`).join('')}</ol>` : ''}
    <p class="dw-note">출처: 한국은행 경제통계시스템(ECOS) 통계표 ${esc(x.stat)}. 최근 ${x.series.length}개 기간 값이며, 발표 뒤 수정될 수 있습니다. ‘읽는 법’은 교과서적 설명이고 전망이 아닙니다. <a href="https://ecos.bok.or.kr" target="_blank" rel="noopener">ECOS ↗</a></p>`;
}

// 원문 수치 비교: 두 값을 같은 눈금 위 점으로 잇는다. 아래 구절은 원문 그대로
function factsHtml(fs) {
  if (!fs?.length) return '';
  return `<div class="bn-facts"><p class="lbl">원문 속 숫자 변화</p>${fs.map((f) => {
    const hi = Math.max(Math.abs(f.from), Math.abs(f.to)) * 1.15 || 1;
    const px = (n) => ((Math.abs(n) / hi) * 100).toFixed(1);
    const up = f.to > f.from;
    return `<figure class="fact"><div class="fact-n"><span>${num(f.from, String(f.from).split('.')[1]?.length || 0)}${esc(f.unit)}</span><i>→</i><b class="${up ? 'up' : 'down'}">${num(f.to, String(f.to).split('.')[1]?.length || 0)}${esc(f.unit)}</b></div>
      <div class="fact-bar" aria-hidden="true"><span class="from" style="left:${px(f.from)}%"></span><span class="seg ${up ? 'up' : 'down'}" style="left:${Math.min(px(f.from), px(f.to))}%;width:${Math.abs(px(f.to) - px(f.from))}%"></span><span class="to ${up ? 'up' : 'down'}" style="left:${px(f.to)}%"></span></div>
      <figcaption>${esc(f.ctx)}</figcaption></figure>`;
  }).join('')}</div>`;
}

// 노트 왼쪽 그림: 해설 영상 → 관련 지표 추세 → 주제 그림표 순으로 있는 것을 쓴다
function noteMedia(n) {
  if (n.video) return `<a class="bn-media vid" href="https://www.youtube.com/watch?v=${esc(n.video)}" target="_blank" rel="noopener noreferrer" aria-label="한국은행 해설 영상">
    <img src="https://img.youtube.com/vi/${esc(n.video)}/hqdefault.jpg" alt="" loading="lazy" decoding="async"><span class="play" aria-hidden="true"></span><span class="cap">해설 영상</span></a>`;
  const x = ecosFor(n);
  if (x) return `<button type="button" class="bn-media ind" data-open="ecos:${x.id}">
    <span class="cap">관련 지표</span><span class="ind-n">${esc(x.name)}</span>
    <span class="ind-v"><b>${num(x.value, x.digits)}</b><small>${esc(x.unit)}</small></span>${ecoSpark(x, { W: 180, H: 40 })}
    <span class="ind-p">${esc(x.period)} · ${chgText(x)}</span></button>`;
  const t = n.topics[0] || '국제경제';
  return `<div class="bn-media pic">${picto(t, 'picto lg')}<span class="cap">${esc(t)}</span></div>`;
}

function renderMacro() {
  renderEcos();
  const b = state.data.bok;
  if (!b || !b.notes?.length) { $('macroNotes').innerHTML = '<li class="empty">한국은행 자료를 불러오지 못했습니다.</li>'; return; }
  const topics = ['전체', ...new Set(b.notes.flatMap((n) => n.topics))];
  $('macroTopics').innerHTML = topics.map((t) => `<button type="button" data-mtopic="${esc(t)}" aria-pressed="${mstate.topic === t}">${t !== '전체' ? picto(t, 'picto sm') : ''}${esc(t)}</button>`).join('');
  const list = b.notes.filter((n) => mstate.topic === '전체' || n.topics.includes(mstate.topic));
  $('macroNotes').innerHTML = list.map((n) => {
    const open = mstate.open.has(n.link);
    return `<li class="bn">
      ${noteMedia(n)}
      <div class="bn-body">
      <p class="bn-k"><span class="bn-no">${esc(n.no)}</span><span>${n.date ? fmt.mdLong.format(new Date(n.date)) : ''}</span>${n.topics.map((t) => `<span class="chip">${picto(t, 'picto xs')}${esc(t)}</span>`).join('')}</p>
      <h3 class="bn-t"><a href="${esc(n.link)}" target="_blank" rel="noopener noreferrer"><span class="hl">${esc(n.title)}</span></a></h3>
      <ol class="bn-key">${n.key.map((k) => `<li>${esc(k)}</li>`).join('')}</ol>
      ${factsHtml(n.facts)}
      ${n.terms.length ? `<p class="bn-terms"><span class="lbl">용어 풀이</span>${n.terms.map((t) => `<button type="button" class="term" data-term="${esc(t)}" aria-expanded="false">${esc(t)}</button>`).join('')}</p><p class="term-def" hidden></p>` : ''}
      <div class="bn-act">
        ${n.points.length > n.key.length ? `<button type="button" class="tool" data-mopen="${esc(n.link)}" aria-expanded="${open}">${open ? '요지 접기' : `요지 전체 ${n.points.length}문단 보기`}</button>` : ''}
        <a class="tool" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer">한국은행 원문 ↗</a>
      </div>
      ${open ? `<ol class="bn-all">${n.points.map((p) => `<li>${esc(p)}</li>`).join('')}</ol>` : ''}
      </div>
    </li>`;
  }).join('') || '<li class="empty">이 주제의 이슈노트가 없습니다.</li>';

  $('macroBlog').innerHTML = (b.blog || []).map((x) => `<li class="blog">
      <a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer">
        ${x.image ? `<span class="blog-img"><img src="${esc(x.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></span>` : ''}
        <span class="blog-tx"><span class="hl">${esc(x.title)}</span>${x.lead ? `<span class="pl-lead">${esc(x.lead)}</span>` : ''}<span class="pl-sub">${x.date ? fmt.mdLong.format(new Date(x.date)) : ''}</span></span>
      </a></li>`).join('') || '<li class="empty">없음</li>';
  const reports = [...(b.outlook ? [{ ...b.outlook, tag: '경제전망' }] : []), ...(b.reports || [])];
  $('macroReports').innerHTML = reports.map((x) => `<li class="pl pl-row"><span class="pl-d">${x.date ? fmt.md.format(new Date(x.date)) : ''}</span>
      <a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer">${x.tag ? `<span class="chip">${x.tag}</span> ` : ''}<span class="hl">${esc(x.title)}</span></a></li>`).join('') || '<li class="empty">없음</li>';
  const used = new Set(b.notes.flatMap((n) => n.terms));
  $('macroGloss').innerHTML = (b.glossary || []).filter(([k]) => used.has(k)).concat((b.glossary || []).filter(([k]) => !used.has(k)))
    .map(([k, v]) => `<div${used.has(k) ? ' class="hot"' : ''}><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  // 휴대폰: 안쪽 스크롤 대신 8개만 보이고 나머지는 펼치기
  const gl = $('macroGloss');
  gl.classList.remove('all');
  gl.nextElementSibling?.classList.contains('gloss-more') && gl.nextElementSibling.remove();
  if (gl.children.length > 8) {
    const b = Object.assign(document.createElement('button'), { type: 'button', className: 'more-d gloss-more', textContent: `용어 ${gl.children.length - 8}개 더 보기` });
    b.addEventListener('click', () => { gl.classList.add('all'); b.remove(); });
    gl.after(b);
  }
  if (!mstate.counted) { mstate.counted = true; countUp($('ecosGrid')); }
}

document.addEventListener('click', (e) => {
  const t = e.target.closest('[data-mtopic]');
  if (t) { mstate.topic = t.dataset.mtopic; renderMacro(); return; }
  const o = e.target.closest('[data-mopen]');
  if (o) { const k = o.dataset.mopen; mstate.open.has(k) ? mstate.open.delete(k) : mstate.open.add(k); renderMacro(); return; }
  const term = e.target.closest('[data-term]');
  if (term) {
    const box = term.closest('.bn').querySelector('.term-def');
    const same = term.getAttribute('aria-expanded') === 'true';
    term.closest('.bn-terms').querySelectorAll('[data-term]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    if (same) { box.hidden = true; return; }
    term.setAttribute('aria-expanded', 'true');
    box.innerHTML = `<b>${esc(term.dataset.term)}</b> ${esc(glossOf(term.dataset.term))}`;
    box.hidden = false;
  }
});

/* ── 시장 분석: 미국장·한국장 시황 ── */
const sstate = { data: null, at: 0, loading: false, feed: '위험', noise: false, sort: 'move', chart: '1d:5m', timer: 0 };
const pctTxt = (v, d = 2) => (v == null ? '—' : `${v > 0 ? '+' : ''}${num(v, d)}%`);
const toneCls = (v) => (v == null || v === 0 ? 'flat' : v > 0 ? 'up' : 'down');
const isKrCode = (id) => /^\d{6}$/.test(id);
const stockDigits = (s) => (isKrCode(s.id) ? 0 : 2);
const allStocks = () => (sstate.data ? [...sstate.data.us.stocks, ...sstate.data.kr.stocks] : []);
const stockById = (id) => allStocks().find((s) => s.id === id);
const idxById = (id) => (sstate.data ? [...sstate.data.us.index, ...sstate.data.kr.index].find((x) => x.id === id) : null);

// 로고: 네이버 증권 로고, 없거나 깨지면 이름 첫 글자 표지
const logo = (s, cls = 'lg') => `<span class="slogo ${cls}" aria-hidden="true">${s.logo ? `<img src="${esc(s.logo)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<i>${esc(s.name.slice(0, 1))}</i></span>`;

// 개장 상태: 거래소 현지 시각 기준 (공휴일은 반영하지 않음)
function session(zone, open, close, pre, post) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  const mins = Number(p.hour) * 60 + Number(p.minute);
  const wk = !['Sat', 'Sun'].includes(p.weekday);
  if (wk && mins >= open && mins < close) return { s: '정규장', on: true, left: close - mins };
  if (wk && pre && mins >= pre && mins < open) return { s: '프리마켓', on: false, left: open - mins };
  if (wk && post && mins >= close && mins < post) return { s: '애프터마켓', on: false };
  return { s: '장 마감', on: false };
}
const hhmm = (m) => `${Math.floor(m / 60)}시간 ${m % 60}분`;

async function loadStreet(force = false) {
  if (sstate.loading || (!force && sstate.data && Date.now() - sstate.at < 110000)) return;
  sstate.loading = true;
  try {
    if (!sstate.data) {
      const snap = await fetch('data/street.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (snap && !sstate.data) { sstate.data = snap; renderStreet(); }
    }
    const live = await fetch(force ? `/api/street?t=${Date.now()}` : '/api/street').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (live?.us) { sstate.data = live; sstate.at = Date.now(); }
  } finally {
    sstate.loading = false;
    if (state.view === 'street') renderStreet();
  }
}

function idxTile(x) {
  const m = x.m;
  return `<button type="button" class="sx" data-open="idx:${x.id}">
    <span class="sx-n">${esc(x.name)}</span>
    <span class="sx-v">${num(m.price, x.digits)}<small>${esc(x.unit)}</small></span>
    <span class="sx-c ${toneCls(m.d1)}">${pctTxt(m.d1)}</span>
    ${miniLine(m.spark.slice(-30))}
  </button>`;
}
function miniLine(v, W = 120, H = 26) {
  if (!v || v.length < 2) return '';
  const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const d = v.map((n, i) => `${i ? 'L' : 'M'}${((i / (v.length - 1)) * W).toFixed(1)} ${(2 + (1 - (n - min) / span) * (H - 4)).toFixed(1)}`).join('');
  return `<svg class="sx-sp ${v.at(-1) >= v[0] ? 'up' : 'down'}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" vector-effect="non-scaling-stroke"/></svg>`;
}

// 투자자별 매매(억 원): 0을 가운데 둔 막대
function flowBars(x) {
  const f = x.flow;
  if (!f) return '';
  const rows = [['개인', f.personal], ['외국인', f.foreign], ['기관', f.institution]];
  const mx = Math.max(...rows.map(([, v]) => Math.abs(v)), 1);
  return `<figure class="sflow"><figcaption>${esc(x.name)} 투자자별 순매수 <small>억 원 · ${f.date.slice(4, 6)}.${f.date.slice(6)}</small></figcaption>
    ${rows.map(([k, v]) => `<div class="sfl-r"><span class="sfl-k">${k}</span><span class="sfl-t"><i class="${v >= 0 ? 'up' : 'down'}" style="${v >= 0 ? 'left:50%' : `right:50%`};width:${((Math.abs(v) / mx) * 50).toFixed(1)}%"></i></span><b class="${v >= 0 ? 'up' : 'down'}">${v > 0 ? '+' : ''}${num(v, 0)}</b></div>`).join('')}
  </figure>`;
}

function breadthBar(b, label) {
  const flat = b.total - b.up - b.down;
  return `<div class="brd" title="${label} 우량주 ${b.total}종목 중 상승 ${b.up} · 하락 ${b.down}${flat ? ` · 보합 ${flat}` : ''}">
    <span class="brd-k">우량주 ${b.total}종목</span>
    <span class="brd-bar"><i class="up" style="width:${(b.up / b.total) * 100}%"></i><i class="flat" style="width:${(flat / b.total) * 100}%"></i><i class="down" style="width:${(b.down / b.total) * 100}%"></i></span>
    <span class="brd-n"><b class="up">상승 ${b.up}</b> · <b class="down">하락 ${b.down}</b></span></div>`;
}

function heatTile(s) {
  const m = s.m || {};
  const a = Math.min(Math.abs(m.d1 || 0) / 4, 1); // 4%면 가장 진하게
  const risk = s.news.filter((n) => n.type === '위험').length;
  return `<li><button type="button" class="ht ${toneCls(m.d1)}" style="--a:${(0.08 + a * 0.5).toFixed(2)}" data-open="stock:${esc(s.id)}">
    <span class="ht-top">${logo(s, 'sm')}<span class="ht-n">${esc(s.name)}</span>${risk ? `<span class="ht-risk" title="위험 낱말 제목 ${risk}건">위험 ${risk}</span>` : ''}</span>
    <span class="ht-c">${pctTxt(m.d1)}</span>
    <span class="ht-p">${m.price != null ? num(m.price, stockDigits(s)) : '—'}${isKrCode(s.id) ? '원' : '$'}</span>
    <span class="ht-52" title="52주 범위 안의 현재 위치 ${m.pos52 ?? '—'}%"><i style="left:${m.pos52 ?? 50}%"></i></span>
    ${m.volRatio >= 1.5 ? `<span class="ht-vol">거래량 ×${m.volRatio}</span>` : `<span class="ht-sec">${esc(s.sector)}</span>`}
  </button></li>`;
}
function sortStocks(list) {
  const l = [...list];
  if (sstate.sort === 'move') return l.sort((a, b) => Math.abs(b.m?.d1 || 0) - Math.abs(a.m?.d1 || 0));
  if (sstate.sort === 'up') return l.sort((a, b) => (b.m?.d1 || 0) - (a.m?.d1 || 0));
  if (sstate.sort === 'sector') return l.sort((a, b) => a.sector.localeCompare(b.sector, 'ko') || (b.m?.d1 || 0) - (a.m?.d1 || 0));
  return l;
}

function renderStreet() {
  const d = sstate.data;
  if (!d) { $('stState').innerHTML = skel(4); loadStreet(); return; }
  const us = session('America/New_York', 570, 960, 240, 1200);
  const kr = session('Asia/Seoul', 540, 930, 480, 1080);
  const krLive = d.kr.stocks.some((s) => s.status === '장중');
  const half = (k, ses, label, flag) => `<section class="st-half" aria-label="${label}">
    <header class="st-hh"><span class="st-flag">${flag}</span><h3>${label}</h3>
      <span class="ses ${ses.on ? 'on' : ''}">${ses.s}${ses.on && ses.left ? ` · 마감까지 ${hhmm(ses.left)}` : ''}</span></header>
    ${breadthBar(d[k].breadth, label)}
    <div class="sx-row">${d[k].index.map(idxTile).join('')}</div>
    ${k === 'kr' ? `<div class="sflows">${d.kr.index.filter((x) => x.flow).map(flowBars).join('')}</div>` : ''}
  </section>`;
  $('stState').innerHTML = half('us', us, '미국장', 'US') + half('kr', krLive ? { ...kr, s: '정규장', on: true } : kr, '한국장', 'KR');
  $('stMeta').textContent = `${fmt.mdhm.format(new Date(d.fetchedAt))} 기준${d.stale ? ' · 직전 자료' : ''} · 미국 지연 시세`;

  // 눈여겨볼 움직임
  const sig = d.signals.slice(0, 12);
  $('stSignals').innerHTML = sig.map((g) => {
    const s = stockById(g.id) || { name: g.name, id: g.id };
    return `<li><button type="button" class="sg ${g.tone === '기회' ? 'op' : 'rk'}" data-open="stock:${esc(g.id)}">
      ${logo(s, 'sm')}<span class="sg-b"><span class="sg-k">${esc(g.kind)}<small>${g.market}</small></span><span class="sg-n">${esc(g.name)}</span><span class="sg-t">${esc(g.text)}</span></span>
      <span class="sg-c ${toneCls(s.m?.d1)}">${pctTxt(s.m?.d1)}</span></button></li>`;
  }).join('') || '<li class="empty">규칙에 걸린 움직임이 없습니다.</li>';

  // 우량주 상태판
  $('stSort').innerHTML = [['move', '변동 큰 순'], ['up', '등락률 순'], ['sector', '업종별']].map(([k, l]) => `<button type="button" data-ssort="${k}" aria-pressed="${sstate.sort === k}">${l}</button>`).join('');
  $('stHeatUs').innerHTML = sortStocks(d.us.stocks).map(heatTile).join('');
  $('stHeatKr').innerHTML = sortStocks(d.kr.stocks).map(heatTile).join('');

  // 밤사이 미국 → 오늘 한국
  const pairs = d.us.stocks.filter((s) => s.link?.length).map((s) => ({ s, ks: s.link.map(stockById).filter(Boolean) })).filter((p) => p.ks.length)
    .sort((a, b) => Math.abs(b.s.m?.d1 || 0) - Math.abs(a.s.m?.d1 || 0));
  $('stLink').innerHTML = pairs.map(({ s, ks }) => `<li class="lk">
    <button type="button" class="lk-a" data-open="stock:${esc(s.id)}">${logo(s, 'xs')}<span>${esc(s.name)}</span><b class="${toneCls(s.m?.d1)}">${pctTxt(s.m?.d1)}</b></button>
    <span class="lk-ar" aria-hidden="true">→</span>
    <span class="lk-b">${ks.map((k) => `<button type="button" data-open="stock:${esc(k.id)}">${logo(k, 'xs')}<span>${esc(k.name)}</span><b class="${toneCls(k.m?.d1)}">${pctTxt(k.m?.d1)}</b></button>`).join('')}</span>
    <span class="lk-s">${esc(s.sector)}</span></li>`).join('');

  renderStreetFeed();
}

function renderStreetFeed() {
  const d = sstate.data;
  const items = allStocks().flatMap((s) => s.news.map((n) => ({ ...n, s })));
  const seen = new Set();
  const uniq = items.filter((n) => { const k = n.link; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const types = ['위험', '기회', '실적', '혼재', '일반'];
  const noise = uniq.filter((n) => n.type === '노이즈');
  const cnt = (t) => uniq.filter((n) => n.type === t).length;
  $('stFeedTabs').innerHTML = ['전체', ...types].map((t) => `<button type="button" data-sfeed="${t}" aria-pressed="${sstate.feed === t}">${t} <small>${t === '전체' ? uniq.length - noise.length : cnt(t)}</small></button>`).join('')
    + `<button type="button" data-snoise="1" aria-pressed="${sstate.noise}" title="광고성·추천성 제목">노이즈 <small>${noise.length}</small></button>`;
  const list = uniq.filter((n) => (sstate.noise ? n.type === '노이즈' : n.type !== '노이즈' && (sstate.feed === '전체' || n.type === sstate.feed))).slice(0, 40);
  $('stFeed').innerHTML = list.map((n) => `<li class="sf">
    <button type="button" class="sf-s" data-open="stock:${esc(n.s.id)}">${logo(n.s, 'xs')}${esc(n.s.name)}</button>
    <a class="sf-t" href="${esc(n.link)}" target="_blank" rel="noopener noreferrer" ${isKrCode(n.s.id) ? '' : 'lang="en"'}><span class="hl">${esc(n.title)}</span></a>
    <p class="meta"><span class="ntag t-${esc(n.type)}">${esc(n.type)}</span><span>${esc(n.source)}</span><span>${stamp(n.publishedAt)}</span></p></li>`).join('') || '<li class="empty">해당 보도가 없습니다.</li>';
  translateVisible?.();
}

/* 상세: 종목·지수 */
const RANGE_TABS = [['1d:1m', '1일 · 1분봉'], ['1d:5m', '1일 · 5분봉'], ['5d:15m', '5일'], ['1mo:1d', '1개월'], ['1y:1d', '1년']];
function stockDetail(id) {
  const s = stockById(id);
  if (!s) return '<p class="empty">종목을 찾을 수 없습니다.</p>';
  const m = s.m || {};
  const dg = stockDigits(s), cur = isKrCode(s.id) ? '원' : '달러';
  const cell = (k, v, cls = '') => `<div><dt>${k}</dt><dd class="${cls}">${v}</dd></div>`;
  const links = [...(s.link || []).map(stockById), ...allStocks().filter((o) => o.link?.includes(s.id))].filter(Boolean);
  const news = s.news.filter((n) => n.type !== '노이즈'), noise = s.news.length - news.length;
  return `<div class="sd-h">${logo(s, 'xl')}<div><h2 class="dw-t" id="dwTitle" style="margin:0">${esc(s.name)}</h2>
      <p class="dw-chips"><span>${esc(s.sector)}</span><span>${isKrCode(s.id) ? `코스피 ${esc(s.id)}` : esc(s.id)}</span>${s.status ? `<span>${esc(s.status)}</span>` : ''}</p></div></div>
    <div class="eco-big"><b>${m.price != null ? num(m.price, dg) : '—'}</b><small>${cur}</small>
      <span class="eco-c ${toneCls(m.d1)}">${pctTxt(m.d1)}<em>전일 대비${s.asOf ? ` · ${fmt.mdhm.format(new Date(s.asOf))}` : ''}</em></span></div>
    <div class="sd-tabs seg" role="group" aria-label="차트 기간">${RANGE_TABS.map(([k, l]) => `<button type="button" data-srange="${k}" aria-pressed="${sstate.chart === k}">${l}</button>`).join('')}</div>
    <div class="sd-chart" id="sdChart" data-sym="${esc(s.sym)}" data-digits="${dg}"><p class="empty">차트를 불러오는 중…</p></div>
    <dl class="sd-m">
      ${cell('5거래일', pctTxt(m.d5), toneCls(m.d5))}${cell('1개월', pctTxt(m.m1), toneCls(m.m1))}${cell('올해', pctTxt(m.ytd), toneCls(m.ytd))}
      ${cell('52주 최고 대비', pctTxt(m.fromHi), toneCls(m.fromHi))}
      ${cell(isKrCode(s.id) && s.status === '장중' ? '거래량(장중 누적)' : '거래량', m.volRatio != null ? `20일 평균의 ${m.volRatio}배` : '—')}
      ${cell('20일선 대비', pctTxt(m.ma20gap), toneCls(m.ma20gap))}
      ${s.cap ? cell('시가총액', esc(s.cap)) : ''}${s.per ? cell('PER', esc(s.per)) : ''}${s.foreign ? cell('외국인 소진율', esc(s.foreign)) : ''}${s.value ? cell('거래대금', esc(s.value)) : ''}
    </dl>
    <div class="sd-52"><span>52주 최저 ${num(m.lo52 ?? 0, dg)}</span><span class="bar"><i style="left:${m.pos52 ?? 50}%"></i></span><span>최고 ${num(m.hi52 ?? 0, dg)}</span></div>
    ${links.length ? `<h3 class="dw-sub">업종이 겹치는 종목</h3><p class="sd-links">${links.map((k) => `<button type="button" data-open="stock:${esc(k.id)}">${logo(k, 'xs')}${esc(k.name)} <b class="${toneCls(k.m?.d1)}">${pctTxt(k.m?.d1)}</b></button>`).join('')}</p>` : ''}
    <h3 class="dw-sub">최근 24시간 보도 ${news.length}건${noise ? ` <small>· 노이즈 ${noise}건 제외</small>` : ''}</h3>
    <ol class="dw-news">${news.map((n) => `<li><a href="${esc(n.link)}" target="_blank" rel="noopener noreferrer"><span class="hl">${esc(n.title)}</span></a>
      <p class="meta"><span class="ntag t-${esc(n.type)}">${esc(n.type)}</span><span>${esc(n.source)}</span><span>${stamp(n.publishedAt)}</span></p></li>`).join('') || '<li class="empty">보도가 없습니다.</li>'}</ol>
    <p class="dw-note">${esc(s.source)}. 위험·기회 표시는 제목 낱말로 자동 분류한 것이며, 업종 연결은 이 지면의 분류로 인과관계를 뜻하지 않습니다. 투자 권유가 아닙니다.</p>`;
}
function idxDetail(id) {
  const x = idxById(id);
  if (!x) return '<p class="empty">지수를 찾을 수 없습니다.</p>';
  const m = x.m;
  return `<h2 class="dw-t" id="dwTitle" style="margin-top:0">${esc(x.name)}</h2>
    <div class="eco-big"><b>${num(m.price, x.digits)}</b><small>${esc(x.unit)}</small><span class="eco-c ${toneCls(m.d1)}">${pctTxt(m.d1)}<em>전일 대비 · ${fmt.mdhm.format(new Date(x.asOf))}</em></span></div>
    <div class="sd-tabs seg" role="group" aria-label="차트 기간">${RANGE_TABS.map(([k, l]) => `<button type="button" data-srange="${k}" aria-pressed="${sstate.chart === k}">${l}</button>`).join('')}</div>
    <div class="sd-chart" id="sdChart" data-sym="${esc(x.sym)}" data-digits="${x.digits}"><p class="empty">차트를 불러오는 중…</p></div>
    <dl class="sd-m">${[['5거래일', m.d5], ['1개월', m.m1], ['올해', m.ytd], ['52주 최고 대비', m.fromHi], ['20일선 대비', m.ma20gap]].map(([k, v]) => `<div><dt>${k}</dt><dd class="${toneCls(v)}">${pctTxt(v)}</dd></div>`).join('')}</dl>
    ${x.flow ? flowBars(x) : ''}
    <p class="dw-note">Yahoo Finance${x.flow ? '·네이버 금융(투자자별 매매)' : ''}. 미국 지수는 지연 시세입니다.</p>`;
}

// 분봉·일봉 차트: 거래소 현지 시각으로 축을 붙이고, 전일 종가를 점선으로
async function loadStockChart() {
  const box = $('sdChart');
  if (!box) return;
  const key = sstate.chart, sym = box.dataset.sym, dg = Number(box.dataset.digits);
  box.innerHTML = '<p class="empty">차트를 불러오는 중…</p>';
  const j = await fetch(`/api/street?chart=${encodeURIComponent(sym)}&r=${key}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!$('sdChart') || $('sdChart').dataset.sym !== sym || sstate.chart !== key) return;
  if (!j?.points?.length) { box.innerHTML = '<p class="empty">차트 자료가 없습니다. 장 시작 전이거나 휴장일일 수 있습니다.</p>'; return; }
  const p = j.points;
  const intra = j.interval.endsWith('m');
  const lab = (t) => {
    const d = new Date(t + j.gmtoffset * 1000);
    const hm = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
    const md = `${d.getUTCMonth() + 1}.${d.getUTCDate()}`;
    return intra ? (j.range === '1d' ? hm : `${md} ${hm}`) : `${String(d.getUTCFullYear()).slice(2)}.${md}`;
  };
  const vals = p.map((x) => x[1]);
  const ref = j.range === '1d' && j.prevClose ? { v: j.prevClose, label: `전일 종가 ${num(j.prevClose, dg)}` } : null;
  const vols = p.map((x) => x[2] || 0), vmax = Math.max(...vols, 1);
  const chg = ref ? ((vals.at(-1) / ref.v) - 1) * 100 : ((vals.at(-1) / vals[0]) - 1) * 100;
  box.innerHTML = `<p class="sd-cap"><b class="${toneCls(chg)}">${pctTxt(+chg.toFixed(2))}</b> ${ref ? '전일 종가 대비' : '기간 처음 대비'} · ${p.length}개 ${intra ? `${j.interval.replace('m', '분')}봉` : '일봉'} · 현지 시각 · Yahoo Finance(국내 약 20분, 미국 15분 지연)</p>
    ${seriesSvg(vals, { digits: dg, label: `${sym} 차트`, labels: p.map((x) => lab(x[0])), ref, H: 200, cls: chg >= 0 ? 'rise' : 'fall' })}
    <svg class="sd-vol" viewBox="0 0 ${p.length} 30" preserveAspectRatio="none" aria-hidden="true">${vols.map((v, i) => `<rect x="${i}" y="${(30 - (v / vmax) * 30).toFixed(1)}" width="0.8" height="${((v / vmax) * 30).toFixed(1)}"/>`).join('')}</svg>`;
  bindCharts(box);
}

document.addEventListener('click', (e) => {
  const so = e.target.closest('[data-ssort]');
  if (so) { sstate.sort = so.dataset.ssort; renderStreet(); return; }
  const f = e.target.closest('[data-sfeed]');
  if (f) { sstate.feed = f.dataset.sfeed; sstate.noise = false; renderStreetFeed(); return; }
  const nz = e.target.closest('[data-snoise]');
  if (nz) { sstate.noise = !sstate.noise; renderStreetFeed(); return; }
  const rg = e.target.closest('[data-srange]');
  if (rg) { sstate.chart = rg.dataset.srange; document.querySelectorAll('[data-srange]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.srange === sstate.chart)); loadStockChart(); }
});
// 화면이 열려 있는 동안 2분마다 새로 받는다
setInterval(() => { if (state.view === 'street' && !document.hidden) loadStreet(true); }, 120000);

/* ── 부동산 동향 ── */
const rstate = { data: null, loading: false, basis: 'mom', heat: 'sale' };
const rs = (id) => rstate.data?.stats?.[id];
async function loadRealty(force = false) {
  if (rstate.loading || (!force && rstate.data?.fresh)) return;
  rstate.loading = true;
  try {
    if (!rstate.data) {
      const snap = await fetch('data/realty.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (snap && !rstate.data) { rstate.data = snap; if (state.view === 'realty') renderRealty(); }
    }
    const live = await fetch(force ? `/api/realty?t=${Date.now()}` : '/api/realty').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (live?.stats) rstate.data = { ...live, fresh: true };
  } finally {
    rstate.loading = false;
    if (state.view === 'realty') renderRealty();
  }
}
const chgOf = (x, basis = 'mom') => x?.[basis];
const chgFmt = (x, v) => {
  if (v == null) return '—';
  if (x.kind === 'index') return `${v > 0 ? '+' : ''}${num(v, 2)}%`;
  if (x.kind === 'rate') return `${v > 0 ? '+' : ''}${num(v, x.digits)}%p`;
  return `${v > 0 ? '+' : ''}${num(v, 0)}${x.unit}`;
};
const valFmt = (x) => (x.kind === 'index' ? num(x.value, 1) : num(x.value, x.digits));
const momLabel = (x) => (x.series.at(-1).t.includes('Q') ? '전분기 대비' : x.series.at(-1).t.length === 8 ? '전일 대비' : '전월 대비');
const metricFmt = (m) => `${m.v > 0 ? '+' : ''}${num(m.v, m.unit === '호' ? 0 : Math.abs(m.v) < 10 ? 2 : 1)}${m.unit}`;

// 큰 숫자 + 막대형 월별 변동(최근 12개월). 지수는 전월 대비 %, 수량·금리는 전월 대비 증감
function momBars(x, n = 12, W = 160, H = 34) {
  const s = x.series;
  const ch = s.slice(1).map((p, i) => (x.kind === 'index' ? ((p.v / s[i].v) - 1) * 100 : p.v - s[i].v)).slice(-n);
  const mx = Math.max(...ch.map(Math.abs), 1e-9);
  const bw = W / ch.length;
  return `<svg class="mb" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" class="mb-0" vector-effect="non-scaling-stroke"/>
    ${ch.map((v, i) => { const h = (Math.abs(v) / mx) * (H / 2 - 1); return `<rect class="${v >= 0 ? 'pos' : 'neg'}${i === ch.length - 1 ? ' last' : ''}" x="${(i * bw + bw * 0.18).toFixed(1)}" y="${(v >= 0 ? H / 2 - h : H / 2).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" height="${Math.max(h, 0.6).toFixed(1)}"/>`; }).join('')}</svg>`;
}

// 1. 첫 화면: 머리기사 사진 위에 가장 앞선 인사이트와 세 숫자
function renderHero() {
  const d = rstate.data;
  const ins = d.insights?.[0];
  const g = [['sale_a7', '서울 아파트값', '전월 대비'], ['unsold', '전국 미분양', '호'], ['mortgage', '주담대 금리', '신규취급']].map(([id, k]) => {
    const x = rs(id); if (!x) return '';
    const big = x.kind === 'index' ? chgFmt(x, x.mom) : `${valFmt(x)}${x.unit === '%' ? '%' : ''}`;
    const sub = x.kind === 'index' ? `1년 ${chgFmt(x, x.yoy)}` : `${chgFmt(x, x.mom)} ${momLabel(x)}`;
    return `<div class="rh-g" data-open="realty:${id}" role="button" tabindex="0"><dt>${k}</dt><dd><b class="${x.kind === 'index' ? toneCls(x.mom) : ''}">${big}</b>${x.unit === '호' ? '<small>호</small>' : ''}<span>${sub}</span></dd></div>`;
  }).join('');
  $('reHero').classList.add('has-img');
  $('reHero').innerHTML = `<div class="rh-txt"><p class="rh-k">이번 주 부동산 · ${fmt.mdLong.format(new Date(d.fetchedAt))}</p>
      <h3 class="rh-d">${ins ? esc(ins.head) : '부동산 동향'}</h3><p class="rh-s">${ins ? esc(ins.text) : ''}</p></div>
    <dl class="rh-gs">${g}</dl>
    <a class="rh-cap" href="https://commons.wikimedia.org/wiki/File:Wide_view_of_Nowon-gu_Apartment_buildings.jpg" target="_blank" rel="noopener noreferrer">사진: 서울 노원구 아파트 단지, Ox1997cow, CC BY-SA 3.0, 위키미디어 공용</a>`;
}

// 2. 핵심 인사이트: 숫자 · 한 줄 제목 · 근거 문장 · 월별 막대
function renderInsights() {
  const list = rstate.data.insights || [];
  $('reIns').innerHTML = list.map((it, i) => {
    const x = rs(it.id);
    return `<li><button type="button" class="ri ${it.tone}" data-open="realty:${it.id}">
      <span class="ri-no">${String(i + 1).padStart(2, '0')}</span>
      <span class="ri-m"><b class="${toneCls(it.metric.v)}">${metricFmt(it.metric)}</b><small>${esc(it.metric.label)}</small></span>
      <span class="ri-h">${esc(it.head)}</span>
      <span class="ri-t">${esc(it.text)}</span>
      ${x ? `<span class="ri-c">${momBars(x)}<em>최근 12개월 ${x.kind === 'index' ? '월간 변동률' : '전월 대비 증감'}</em></span>` : ''}
    </button></li>`;
  }).join('') || '<li class="empty">인사이트를 만들 자료가 없습니다.</li>';
}

// 3. 월별 변동률 지도: 지역 × 최근 12개월, 칸 색 = 전월 대비 변동률
function renderHeat() {
  const regs = [['a7', '서울'], ['a1', '수도권'], ['a0', '전국'], ['a2', '지방']];
  const kinds = rstate.heat === 'both' ? [['sale', '매매'], ['rent', '전세']] : [[rstate.heat, rstate.heat === 'sale' ? '매매' : '전세']];
  const rows = kinds.flatMap(([k, kn]) => regs.map(([c, n]) => {
    const x = rs(`${k}_${c}`); if (!x) return null;
    const s = x.series;
    const ch = s.slice(1).map((p, i) => ({ t: p.label, v: +(((p.v / s[i].v) - 1) * 100).toFixed(2) })).slice(-12);
    return { name: kinds.length > 1 ? `${n} ${kn}` : n, id: `${k}_${c}`, ch };
  })).filter(Boolean);
  if (!rows.length) { $('reHeat').innerHTML = ''; return; }
  const mx = Math.max(...rows.flatMap((r) => r.ch.map((c) => Math.abs(c.v))), 0.1);
  const cols = rows[0].ch.map((c) => c.t);
  $('reHeatTabs').innerHTML = [['sale', '매매'], ['rent', '전세'], ['both', '함께']].map(([k, l]) => `<button type="button" data-rheat="${k}" aria-pressed="${rstate.heat === k}">${l}</button>`).join('');
  $('reHeat').innerHTML = `<table class="hm"><thead><tr><th></th>${cols.map((t, i) => `<th>${i === 0 || t.endsWith('.01') ? esc(t) : esc(t.slice(3))}</th>`).join('')}</tr></thead><tbody>
    ${rows.map((r) => `<tr><th scope="row"><button type="button" data-open="realty:${r.id}">${esc(r.name)}</button></th>${r.ch.map((c) => {
      const a = Math.min(Math.abs(c.v) / mx, 1);
      return `<td class="${c.v > 0 ? 'up' : c.v < 0 ? 'down' : 'flat'}" style="--a:${(0.1 + a * 0.82).toFixed(2)}" title="${esc(r.name)} ${esc(c.t)} ${c.v > 0 ? '+' : ''}${c.v}%"><span>${c.v > 0 ? '+' : ''}${num(c.v, 1)}</span></td>`;
    }).join('')}</tr>`).join('')}</tbody></table>
    <p class="hm-f">단위 % · 색이 진할수록 변동이 큽니다(붉은색 상승, 푸른색 하락) · 지역 이름을 누르면 추이</p>`;
}

function regionBars(basis) {
  const regs = [['a0', '전국'], ['a1', '수도권'], ['a7', '서울'], ['a2', '지방']];
  const rows = regs.map(([c, n]) => ({ n, sale: chgOf(rs(`sale_${c}`), basis), rent: chgOf(rs(`rent_${c}`), basis) }));
  const mx = Math.max(...rows.flatMap((r) => [Math.abs(r.sale || 0), Math.abs(r.rent || 0)]), 0.1);
  const anyNeg = rows.some((r) => r.sale < 0 || r.rent < 0);
  const bar = (v, cls) => `<span class="rb-t ${anyNeg ? 'mid' : ''}"><i class="${cls} ${v >= 0 ? 'pos' : 'neg'}" style="${anyNeg ? (v >= 0 ? 'left:50%' : 'right:50%') : 'left:0'};width:${((Math.abs(v || 0) / mx) * (anyNeg ? 50 : 100)).toFixed(1)}%"></i></span><b class="${toneCls(v)}">${v == null ? '—' : `${v > 0 ? '+' : ''}${num(v, 2)}%`}</b>`;
  return `<div class="rbars">${rows.map((r) => `<div class="rb"><span class="rb-n">${r.n}</span>
      <div class="rb-l"><span class="rb-k">매매</span>${bar(r.sale, 'sale')}</div>
      <div class="rb-l"><span class="rb-k">전세</span>${bar(r.rent, 'rent')}</div></div>`).join('')}</div>`;
}

// 여러 선 추이: 달마다 눈금·점을 찍고, 올리면 그달 지역별 값이 뜬다
function multiLine(series, { W = 520, H = 230, pt = 16, pb = 40 } = {}) {
  const all = series.flatMap((s) => s.pts.map((p) => p.v));
  const min = Math.min(...all), max = Math.max(...all), span = max - min || 1;
  const n = Math.max(...series.map((s) => s.pts.length));
  const X = (i) => ((i / (n - 1)) * W).toFixed(1);
  const y = (v) => (pt + (1 - (v - min) / span) * (H - pt - pb)).toFixed(1);
  const ends = series.map((s, i) => ({ i, y: Number(y(s.pts.at(-1).v)) + 5 })).sort((p, q) => p.y - q.y);
  ends.forEach((e, k) => { if (k && e.y - ends[k - 1].y < 16) e.y = ends[k - 1].y + 16; });
  const endY = Object.fromEntries(ends.map((e) => [e.i, e.y]));
  const lab = series.reduce((a, s) => (s.pts.length === n ? s : a), series[0]).pts;
  // 눈금 글자: 해가 바뀌는 달과 처음 달은 '25.9'처럼 연도까지
  const tick = (t, i) => { const [yy, mm] = t.split('.'); return i === 0 || mm === '01' ? `${yy}.${Number(mm)}` : `${Number(mm)}월`; };
  const grid = lab.map((p, i) => `<line class="gx" x1="${X(i)}" x2="${X(i)}" y1="${pt - 4}" y2="${H - pb}"/><text class="tx${p.label.endsWith('.01') || i === 0 ? ' yr' : ''}" x="${X(i)}" y="${H - pb + 18}" text-anchor="middle">${tick(p.label, i)}</text>`).join('');
  const lines = series.map((s, si) => {
    const off = n - s.pts.length;
    const d = s.pts.map((p, i) => `${i ? 'L' : 'M'}${X(i + off)} ${y(p.v)}`).join('');
    const dots = s.pts.map((p, i) => `<circle class="ml-p ${s.cls}" cx="${X(i + off)}" cy="${y(p.v)}" r="${i === s.pts.length - 1 ? 4.5 : 2.6}"/>`).join('');
    const lp = s.pts.at(-1);
    return `<path class="ml ${s.cls}" d="${d}" vector-effect="non-scaling-stroke"/>${dots}<text class="ml-t ${s.cls}" x="${W + 12}" y="${endY[si]}">${esc(s.name)} <tspan class="ml-v">${num(lp.v, 1)}</tspan></text>`;
  }).join('');
  const data = { labels: lab.map((p) => p.label), series: series.map((s) => ({ name: s.name, cls: s.cls, v: s.pts.map((p) => p.v), off: n - s.pts.length })) };
  return `<svg class="mline" viewBox="0 0 ${W + 130} ${H}" preserveAspectRatio="xMinYMid meet" role="img" aria-label="지수 추이" data-ml="${esc(JSON.stringify(data))}" data-w="${W}">
    ${grid}
    ${min < 100 && max > 100 ? `<line class="base" x1="0" x2="${W}" y1="${y(100)}" y2="${y(100)}"/><text class="ax" x="4" y="${y(100) - 6}">기준 100</text>` : ''}
    ${lines}<line class="mx" x1="0" x2="0" y1="${pt - 4}" y2="${H - pb}" visibility="hidden"/>
    <rect class="hit" x="0" y="0" width="${W}" height="${H}" fill="transparent"/></svg>`;
}
function bindMline(svg) {
  if (!svg) return;
  const d = JSON.parse(svg.dataset.ml), W = Number(svg.dataset.w), n = d.labels.length;
  const mx = svg.querySelector('.mx');
  const move = (e) => {
    const r = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const scale = r.width / vb.width;
    const i = Math.round(Math.min(Math.max((e.clientX - r.left) / scale / W, 0), 1) * (n - 1));
    const x = (i / (n - 1)) * W;
    mx.setAttribute('x1', x); mx.setAttribute('x2', x); mx.setAttribute('visibility', 'visible');
    const [yy, mm] = d.labels[i].split('.');
    const rows = d.series.map((s) => { const v = s.v[i - s.off]; const p = s.v[i - s.off - 1];
      return v == null ? '' : `<span class="mt-r"><i class="${s.cls}"></i>${esc(s.name)} <b>${num(v, 1)}</b>${p != null ? ` <em>${v - p >= 0 ? '+' : ''}${num(((v / p) - 1) * 100, 2)}%</em>` : ''}</span>`; }).join('');
    showTip(`<b>20${yy}년 ${Number(mm)}월</b>${rows}`, r.left + x * scale, r.top + 20);
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', () => { hideTip(); mx.setAttribute('visibility', 'hidden'); });
}

function unsoldBars() {
  const r = rstate.data.stats.unsoldRegions || [];
  if (!r.length) return '<p class="empty">자료 없음</p>';
  const mx = Math.max(...r.map((x) => x.v));
  const u = rs('unsold');
  return `${u ? `<div class="ub-top"><b>${num(u.value, 0)}</b><small>호</small><span class="${toneCls(u.mom)}">${chgFmt(u, u.mom)} 전월 대비</span>${miniLine(u.series.map((p) => p.v), 160, 30)}</div>` : ''}
    <ol class="ub">${[...r].sort((a, b) => b.v - a.v).map((x) => {
    const d = x.prev != null ? x.v - x.prev : null;
    return `<li><span class="ub-n">${esc(x.name)}</span><span class="ub-t"><i style="width:${((x.v / mx) * 100).toFixed(1)}%"></i></span><b>${num(x.v, 0)}</b><em class="${toneCls(d)}">${d == null ? '' : d === 0 ? '–' : `${d > 0 ? '▲' : '▼'}${num(Math.abs(d), 0)}`}</em></li>`;
  }).join('')}</ol><p class="ub-f">${esc(r[0].label)} 기준 · 단위 호 · 오른쪽은 전월 대비 증감</p>`;
}

function rateRow() {
  return ['mortgage', 'cd', 'kgb3', 'corp3'].map((id) => {
    const x = rs(id); if (!x) return '';
    return `<button type="button" class="rr" data-open="realty:${id}"><span class="rr-n">${esc(x.name)}</span><span class="rr-v">${num(x.value, x.digits)}<small>%</small></span>
      <span class="rr-c ${toneCls(x.mom)}">${chgFmt(x, x.mom)}</span>${miniLine(x.series.map((p) => p.v).slice(-30), 110, 22)}<span class="rr-p">${esc(x.period)} · ${momLabel(x)}</span></button>`;
  }).join('');
}

function tapeBox() {
  const t = rstate.data.tape || [];
  const grp = (g) => t.filter((x) => x.group === g).map((x) => `<span class="tp"><em>${esc(x.name)}</em> <b>${num(x.price, x.price < 100 ? 2 : 0)}${x.group === '환율' || x.id === 'btc' ? '원' : ''}</b>${x.w1 != null ? ` <i class="${toneCls(x.w1)}">${x.w1 > 0 ? '▲' : x.w1 < 0 ? '▼' : ''}${num(Math.abs(x.w1), 1)}%</i>` : ''}</span>`).join('');
  const rate = ['cd', 'kgb3', 'corp3'].map((id) => rs(id)).filter(Boolean).map((x) => `<span class="tp"><em>${esc(x.name)}</em> <b>${num(x.value, 2)}%</b></span>`).join('');
  return `<dl class="tape"><div><dt>환율</dt><dd>${grp('환율')}</dd></div><div><dt>증시</dt><dd>${grp('증시')}</dd></div><div><dt>금리·기타</dt><dd>${rate}${grp('기타')}</dd></div></dl>
    <p class="tape-f">화살표는 1주(5거래일) 전 대비 · 시장 시세 기준</p>`;
}

// 4. 보도: 많이 나온 말 · 목차별 보도량 · 목차별 머리기사(사진)
function renderTalk() {
  const d = rstate.data;
  const tm = d.terms || [], mx = Math.max(...tm.map((x) => x.n), 1);
  const vol = d.volume || [], vt = vol.reduce((a, x) => a + x.n, 0) || 1;
  $('reTalk').innerHTML = `<div class="tk-vol"><p class="lbl">목차별 보도량 <small>7일 · 중복 제외 ${num(d.articles || vt, 0)}건</small></p>
      <div class="tk-bar">${vol.map((x, i) => `<i class="v${i}" style="width:${((x.n / vt) * 100).toFixed(1)}%" title="${esc(x.name)} ${x.n}건"></i>`).join('')}</div>
      <ul class="tk-lg">${vol.map((x, i) => `<li><i class="v${i}"></i>${esc(x.name)} <b>${x.n}</b></li>`).join('')}</ul></div>
    <p class="lbl">제목에 많이 나온 말 <small>기사 수</small></p>
    <ol class="tk">${tm.map((x) => `<li><span class="tk-k">${esc(x.k)}</span><span class="tk-t"><i style="width:${((x.n / mx) * 100).toFixed(1)}%"></i></span><b>${x.n}</b></li>`).join('')}</ol>`;
}
function newsCol(s) {
  const [lead, ...rest] = s.items;
  const kpi = { supply: ['permit', 'unsold_cap'], nonres: ['office', 'retail'], macro: ['mortgage', 'cd'], issue: ['real_seoul', 'rent_a7'] }[s.id] || [];
  return `<section class="rn"><header class="rn-h"><h3>${esc(s.name)}</h3><span>${esc(s.sub)}</span></header>
    <div class="rn-kpi">${kpi.map((id) => { const x = rs(id); if (!x) return '';
      return `<button type="button" class="rn-k" data-open="realty:${id}"><span>${esc(x.name)}</span><b class="${x.kind === 'index' ? toneCls(x.mom) : ''}">${x.kind === 'index' ? chgFmt(x, x.mom) : `${valFmt(x)}${x.unit === '%' ? '%' : esc(x.unit)}`}</b><em>${x.kind === 'index' ? momLabel(x) : `${chgFmt(x, x.mom)} ${momLabel(x)}`}</em></button>`; }).join('')}</div>
    ${lead ? `<a class="rn-lead" href="${esc(lead.link)}" target="_blank" rel="noopener noreferrer">
      ${lead.image ? `<span class="rn-img"><img src="${esc(lead.image)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></span>` : ''}
      <span class="rn-lt"><span class="hl">${esc(lead.title)}</span></span>${lead.summary ? `<span class="rn-ls">${esc(lead.summary)}</span>` : ''}
      <span class="meta">${lead.outlets > 1 ? `<span class="rn-o">언론 ${lead.outlets}곳</span>` : ''}<span>${esc(lead.source)}</span><span>${stamp(lead.publishedAt)}</span></span></a>` : ''}
    <ol class="rn-l">${rest.map((n) => `<li><a href="${esc(n.link)}" target="_blank" rel="noopener noreferrer"><span class="hl">${esc(n.title)}</span></a>
      <p class="meta">${n.outlets > 1 ? `<span class="rn-o">언론 ${n.outlets}곳</span>` : ''}<span>${esc(n.source)}</span><span>${stamp(n.publishedAt)}</span></p></li>`).join('')}</ol></section>`;
}

function renderRealty() {
  const d = rstate.data;
  if (!d) { $('reHero').innerHTML = skel(3); loadRealty(); return; }
  $('reMeta').textContent = `${fmt.mdhm.format(new Date(d.fetchedAt))} 기준${d.stale ? ' · 직전 자료' : ''}`;
  renderHero();
  renderInsights();
  renderHeat();
  $('reTape').innerHTML = tapeBox();
  $('reBasis').innerHTML = [['mom', '전월 대비'], ['yoy', '1년 전 대비']].map(([k, l]) => `<button type="button" data-rbasis="${k}" aria-pressed="${rstate.basis === k}">${l}</button>`).join('');
  $('reRegion').innerHTML = regionBars(rstate.basis);
  const ser = [['sale_a7', '서울', 'c1'], ['sale_a1', '수도권', 'c2'], ['sale_a0', '전국', 'c3'], ['sale_a2', '지방', 'c4']].map(([id, n, cls]) => rs(id) && { name: n, cls, pts: rs(id).series.slice(-13) }).filter(Boolean);
  $('reTrend').innerHTML = ser.length ? multiLine(ser) : '';
  bindMline($('reTrend').querySelector('svg.mline'));
  $('reUnsold').innerHTML = unsoldBars();
  $('reRates').innerHTML = rateRow();
  renderTalk();
  $('reNews').innerHTML = (d.sections || []).map(newsCol).join('');
}

function realtyDetail(id) {
  const x = rs(id);
  if (!x) return '<p class="empty">지표를 찾을 수 없습니다.</p>';
  const vals = x.series.map((p) => p.v);
  const ins = (rstate.data.insights || []).find((i) => i.id === id);
  return `<h2 class="dw-t" id="dwTitle" style="margin-top:0">${esc(x.name)}</h2>
    <p class="dw-chips"><span>${esc(x.src)}</span></p>
    <div class="eco-big"><b>${valFmt(x)}</b><small>${x.kind === 'index' ? '지수' : esc(x.unit)}</small>
      <span class="eco-c ${toneCls(x.mom)}">${chgFmt(x, x.mom)}<em>${momLabel(x)} · 1년 전보다 ${chgFmt(x, x.yoy)} · ${esc(x.period)}</em></span></div>
    ${ins ? `<p class="dw-sum"><b>${esc(ins.head)}</b> ${esc(ins.text)}</p>` : ''}
    <dl class="eco-def"><div><dt>무엇인가</dt><dd>${esc(x.what)}</dd></div></dl>
    ${seriesSvg(vals, { digits: x.kind === 'index' ? 1 : x.digits, label: `${x.name} 추이`, labels: x.series.map((p) => p.label), ref: x.kind === 'index' && Math.min(...vals) < 100 && Math.max(...vals) > 100 ? { v: 100, label: '기준 100' } : null, H: 180 })}
    <h3 class="dw-sub">${x.kind === 'index' ? '월간 변동률' : '기간별 증감'}</h3>${momBars(x, 24, 480, 70)}
    <p class="dw-note">출처: ${esc(x.src)}, 한국은행 경제통계시스템(ECOS) 경유. 발표 뒤 수정될 수 있습니다.</p>`;
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-rbasis]');
  if (b) { rstate.basis = b.dataset.rbasis; renderRealty(); return; }
  const h = e.target.closest('[data-rheat]');
  if (h) { rstate.heat = h.dataset.rheat; renderHeat(); }
});

/* ── 최상단 '갱신': 누르면 지금 다시 모은다 (30초에 한 번) ── */
let refreshing = false, lastForce = 0;
$('refreshBtn')?.addEventListener('click', async () => {
  if (refreshing) return;
  if (Date.now() - lastForce < 30000) { toast('방금 새로 불러왔어요'); return; }
  refreshing = true; lastForce = Date.now();
  const btn = $('refreshBtn');
  btn.classList.add('busy'); btn.setAttribute('aria-busy', 'true');
  const t0 = Date.now();
  const tickUpd = () => { $('updated').textContent = `갱신 중 ${Math.round((Date.now() - t0) / 1000)}초`; };
  tickUpd();
  const iv = setInterval(tickUpd, 1000);
  try {
    const d = await fetchData(`/api/dashboard?t=${Date.now()}`, 55000).finally(() => clearInterval(iv));
    if (d.stale) throw new Error('stale');
    state.data = d; renderAll(); refreshQuotes(); saveDash(d); bgAt = Date.now();
    await Promise.all([
      state.view === 'global' ? loadGlobal(true) : Promise.resolve(gstate.at = 0),
      state.view === 'street' ? loadStreet(true) : Promise.resolve(sstate.at = 0),
      state.view === 'realty' ? loadRealty(true) : Promise.resolve(rstate.data && (rstate.data.fresh = false)),
    ]);
    toast(`최신 자료로 바꿨어요 (${Math.round((Date.now() - t0) / 1000)}초)`);
  } catch {
    if (state.data) renderStatus();
    $('updated').textContent = '갱신 실패 · 다시 누르기';
    toast('지금은 새로 불러오지 못했어요. 잠시 뒤 다시 눌러 주세요');
    lastForce = 0;
  } finally {
    refreshing = false;
    btn.classList.remove('busy'); btn.removeAttribute('aria-busy');
  }
});

/* ── 모바일: 아래 탭 막대 · 전체 메뉴 시트 · 접는 검색 ── */
const TAB_VIEWS = ['home', 'global', 'street', 'realty', 'macro'];
const sheet = $('moreSheet');
function syncTabbar() {
  const v = VIEWS.includes(state.view) ? state.view : 'home';
  document.querySelectorAll('.tabbar [data-view]').forEach((a) => (a.dataset.view === v ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  $('moreBtn').toggleAttribute('data-on', !TAB_VIEWS.includes(v));
  document.querySelectorAll('.sh-list [data-view]').forEach((a) => (a.dataset.view === v ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
}
$('moreBtn').addEventListener('click', () => {
  $('sheetMeta').textContent = state.data ? `자료 기준 ${fmt.mdhm.format(new Date(state.data.generatedAt))}` : '';
  syncTabbar();
  sheet.showModal();
});
sheet.addEventListener('click', (e) => {
  if (e.target === sheet || e.target.closest('[data-close-sheet]') || e.target.closest('[data-view]')) sheet.close();
});
$('sheetRefresh').addEventListener('click', () => { sheet.close(); $('refreshBtn').click(); });
$('sheetTheme').addEventListener('click', () => $('themeBtn').click());
// 같은 탭을 다시 누르면 맨 위로
document.querySelector('.tabbar').addEventListener('click', (e) => {
  const a = e.target.closest('[data-view]');
  if (a && a.dataset.view === state.view) scrollTo({ top: 0, behavior: motionOK.matches ? 'smooth' : 'auto' });
}, true);
// 검색: 휴대폰에서는 돋보기를 눌러 펼친다
$('searchToggle').addEventListener('click', () => {
  const bar = document.querySelector('.bar');
  const open = !bar.classList.contains('search-open');
  bar.classList.toggle('search-open', open);
  $('searchToggle').setAttribute('aria-expanded', open);
  if (open) $('q').focus();
  syncBarH();
});
$('q').addEventListener('blur', () => {
  if (!$('q').value) { document.querySelector('.bar').classList.remove('search-open'); $('searchToggle').setAttribute('aria-expanded', 'false'); syncBarH(); }
});
// 화면이 바뀔 때마다 탭 표시를 맞춘다
const _rvs = renderViewSwitch;
renderViewSwitch = function () { _rvs(); syncTabbar(); };
syncTabbar();

/* ── 매끄럽게: 알림 한 줄 · 화면별 스크롤 기억 · 당겨서 새로고침 · 시트 끌어내려 닫기 ── */
const toastEl = Object.assign(document.createElement('div'), { className: 'toast', role: 'status' });
toastEl.setAttribute('aria-live', 'polite');
document.body.append(toastEl);
let toastT = 0;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => toastEl.classList.remove('on'), 2200);
}
const haptic = () => { try { if (navigator.userActivation?.hasBeenActive) navigator.vibrate?.(6); } catch {} };
document.querySelector('.tabbar')?.addEventListener('click', (e) => { if (e.target.closest('a,button')) haptic(); });

// 화면마다 보던 위치를 기억했다가 돌아오면 그 자리로
const scrollMemo = {};
let lastView = state.view;
addEventListener('scroll', () => { scrollMemo[lastView] = scrollY; }, { passive: true });
// 화면을 바꾸기 직전 위치를 저장(바뀐 뒤에는 높이가 달라져 값이 깎인다)
document.addEventListener('click', (e) => { if (e.target.closest('[data-view]')) scrollMemo[state.view] = scrollY; }, true);
function restoreScroll() {
  if (state.view === lastView) return;
  lastView = state.view;
  const y = scrollMemo[state.view] || 0;
  scrollTo({ top: y });
}

// 휴대폰: 맨 위에서 아래로 당기면 갱신
const compact = matchMedia('(max-width: 760px), (max-height: 520px) and (orientation: landscape) and (max-width: 1000px)');
const ptr = Object.assign(document.createElement('div'), { className: 'ptr', innerHTML: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9"/><path d="M13.5 2.5v3h-3"/></svg><span>당겨서 새로고침</span>' });
document.body.append(ptr);
let pull = null;
addEventListener('touchstart', (e) => {
  if (!compact.matches || scrollY > 0 || document.querySelector('dialog[open]') || e.touches.length > 1) return;
  pull = { y: e.touches[0].clientY, d: 0 };
}, { passive: true });
addEventListener('touchmove', (e) => {
  if (!pull) return;
  pull.d = Math.max(0, e.touches[0].clientY - pull.y);
  if (scrollY > 0) { pull.d = 0; }
  const k = Math.min(pull.d / 80, 1);
  ptr.style.setProperty('--k', k.toFixed(2));
  ptr.classList.toggle('show', pull.d > 12);
  ptr.classList.toggle('ready', pull.d >= 80);
  ptr.querySelector('span').textContent = pull.d >= 80 ? '놓으면 새로고침' : '당겨서 새로고침';
}, { passive: true });
addEventListener('touchend', () => {
  if (!pull) return;
  const go = pull.d >= 80;
  pull = null;
  ptr.classList.remove('ready');
  if (go) { haptic(); ptr.classList.add('spin'); ptr.querySelector('span').textContent = '새로 불러오는 중'; $('refreshBtn').click(); }
  setTimeout(() => ptr.classList.remove('show', 'spin'), go ? 1400 : 0);
});

// 아래에서 올라온 판(상세·전체 메뉴): 머리 부분을 끌어내리면 닫힌다
function dragToClose(dlg, handleSel) {
  let s = null;
  dlg.addEventListener('touchstart', (e) => {
    if (!compact.matches || !e.target.closest(handleSel)) return;
    s = { y: e.touches[0].clientY, d: 0 };
    dlg.style.transition = 'none';
  }, { passive: true });
  dlg.addEventListener('touchmove', (e) => {
    if (!s) return;
    s.d = Math.max(0, e.touches[0].clientY - s.y);
    dlg.style.transform = `translateY(${s.d}px)`;
  }, { passive: true });
  dlg.addEventListener('touchend', () => {
    if (!s) return;
    const close = s.d > 90;
    dlg.style.transition = 'transform .18s ease-out';
    dlg.style.transform = close ? 'translateY(100%)' : '';
    s = null;
    if (close) setTimeout(() => { dlg.close(); dlg.style.transform = ''; dlg.style.transition = ''; }, 170);
  });
}
dragToClose($('detail'), '.dw-h');
dragToClose($('moreSheet'), '.sh-grip, .sh-h');

// 화면 전환 뒤 스크롤 위치 복원과 탭 표시
const _rvs2 = renderViewSwitch;
renderViewSwitch = function () { _rvs2(); restoreScroll(); };

// 불러오는 동안: 글자 대신 자리 표시(뼈대)
const skel = (n = 3) => `<div class="skel" aria-hidden="true">${'<i></i>'.repeat(n)}</div><p class="visually-hidden">불러오는 중</p>`;
