// 국정 상황판 · 세계 보도 흐름 (해외 탭 머리) — 의존성 0. app.js 가 해외 자료를 받으면 'gk:global' 로 알려 준다.
// 주제 단추는 app.js 의 해외 토픽 단추와 같은 표지(data-gtopic)를 써서, 한 번 누르면 아래 기사 목록과 이 흐름이 함께 바뀐다.
import { summary, hourly, PHASES } from './lib.mjs?v=1';

const css = new URL('./flow.css?v=1', import.meta.url).href;
if (!document.querySelector(`link[href="${css}"]`)) document.head.append(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: css }));

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const KST = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false });
const KSTD = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
const KSTH = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: 'numeric', hour12: false });
const ago = (ms) => { const m = Math.round(ms / 60000); return m < 60 ? `${Math.max(1, m)}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`; };
const host = () => $('#gfFlow');

let G = null, S = { topic: 'all', open: null };

function kpis(s) {
  return `<dl class="gf-kpis">
    <div><dt>최근 24시간 기사</dt><dd><b>${s.last24}</b><small>건</small></dd><dd class="s">48시간 ${s.items}건</dd></div>
    <div><dt>보도한 매체 · 국가</dt><dd><b>${s.outlets}</b><small>곳</small> <b class="sm">${s.countries}</b><small>개국</small></dd><dd class="s">매체 국적 기준</dd></div>
    <div><dt>급증 사안</dt><dd><b>${s.surge}</b><small>건</small></dd><dd class="s">매체 4곳 이상 중 절반이 3시간 안</dd></div>
    <div><dt>3개국 이상이 함께 다룬 사안</dt><dd><b>${s.multi}</b><small>건</small></dd><dd class="s">국제적으로 번진 이슈</dd></div>
  </dl>`;
}

function chart(s) {
  const h = hourly(s.flat, s.now, { hours: 48, topic: S.topic === 'all' ? null : S.topic });
  const mx = Math.max(...h.all, 1);
  const W = 100 / h.all.length;
  const ticks = h.all.map((_, i) => i).filter((i) => (i - (h.all.length - 1)) % 6 === 0);
  const sel = h.sel, name = S.topic === 'all' ? null : s.topics.find((t) => t.id === S.topic)?.name;
  return `<figure class="gf-fig">
    <figcaption class="gf-cap"><b>시간대별 보도량</b><span>최근 48시간 · 한국 시각 · 1시간 단위${name ? ` · <i class="gf-sw sel"></i>${esc(name)}` : ''}</span></figcaption>
    <div class="gf-bars" role="img" aria-label="최근 48시간 시간대별 해외 기사 수. 가장 많은 시간대 ${mx}건.">
      ${h.all.map((n, i) => { const t0 = h.start + i * 3600e3; return `<span class="gf-b${i === h.all.length - 1 ? ' now' : ''}" style="left:${(i * W).toFixed(3)}%;width:${W.toFixed(3)}%" data-t="${t0}" data-n="${n}" data-s="${sel ? sel[i] : ''}"><i style="height:${((n / mx) * 100).toFixed(1)}%"></i>${sel && sel[i] ? `<em style="height:${((sel[i] / mx) * 100).toFixed(1)}%"></em>` : ''}</span>`; }).join('')}
    </div>
    <div class="gf-ax">${ticks.map((i) => `<span style="left:${((i + 0.5) * W).toFixed(2)}%"${(i + 0.5) * W > 94 ? ' class="end"' : ''}>${KSTH.format(new Date(h.start + i * 3600e3)).replace('시', '')}시</span>`).join('')}</div>
  </figure>`;
}

function topicBars(s) {
  const mx = Math.max(...s.topics.map((t) => t.n), 1);
  return `<div class="gf-topics"><p class="gf-cap"><b>주제별 비중</b><span>48시간 · 최근 12시간 / 그 전 12시간</span></p>
    <ol>${s.topics.map((t) => {
      const d = t.recent - t.before;
      return `<li><button type="button" data-gtopic="${esc(t.id)}" aria-pressed="${S.topic === t.id}"><span class="nm">${esc(t.name)}</span><span class="tr"><i style="width:${((t.n / mx) * 100).toFixed(1)}%"></i></span><b>${t.n}</b><em class="${d > 0 ? 'up' : d < 0 ? 'down' : ''}" title="최근 12시간 ${t.recent}건 · 그 전 12시간 ${t.before}건">${d > 0 ? '▲' : d < 0 ? '▼' : '–'}${d ? Math.abs(d) : ''}</em></button></li>`;
    }).join('')}</ol></div>`;
}

function lane(c, s) {
  // 48시간 띠 위에 매체별 첫 보도 시각
  const span = s.hours * 3600e3, x = (t) => Math.max(0, Math.min(100, (1 - (s.now - t) / span) * 100));
  return `<span class="gf-lane" aria-hidden="true"><i class="rng" style="left:${x(c.first).toFixed(2)}%;width:${Math.max(0.6, x(c.last) - x(c.first)).toFixed(2)}%"></i>${c.timeline.map((o) => `<b style="left:${x(o.t).toFixed(2)}%"></b>`).join('')}</span>`;
}
function stories(s) {
  const list = (S.topic === 'all' ? s.clusters : s.clusters.filter((c) => c.topic === S.topic)).slice(0, 8);
  if (!list.length) return '<p class="gf-empty">이 주제로 최근 48시간에 수집된 사건이 없습니다.</p>';
  return `<ol class="gf-stories">${list.map((c, i) => `<li class="gf-st${S.open === c.key ? ' open' : ''}">
      <span class="no">${i + 1}</span>
      <div class="bd">
        <p class="k"><span class="ph ph-${c.phase}">${PHASES[c.phase]}</span><span>${esc(c.topicName)}</span><span>매체 ${c.outlets}곳 · ${c.countries}개국</span><span>${KST.format(new Date(c.first))} → ${KST.format(new Date(c.last))}</span></p>
        <p class="tt"><a class="t" href="${esc(c.link)}" target="_blank" rel="noopener noreferrer"${c.translated ? '' : ' lang="en"'}>${esc(c.title)}</a>${c.translated ? '' : '<span class="orig" title="번역이 붙지 않아 원문 제목">원문</span>'}</p>
        ${lane(c, s)}
        <button type="button" class="tl-btn" data-gfopen="${esc(c.key)}" aria-expanded="${S.open === c.key}">보도 순서 ${c.timeline.length}곳</button>
        ${S.open === c.key ? `<ol class="gf-tl">${c.timeline.map((o) => `<li><time>${KSTD.format(new Date(o.t))}</time><b>${esc(o.outlet)}</b><span class="cn">${esc(o.country)}</span><a href="${esc(o.link)}" target="_blank" rel="noopener noreferrer" lang="${/[가-힣]/.test(o.title) ? 'ko' : 'en'}">${esc(o.title)}</a></li>`).join('')}</ol>` : ''}
      </div></li>`).join('')}</ol>`;
}

function nations(s) {
  const top = s.byCountry.slice(0, 8), mx = Math.max(...top.map((c) => c.n), 1);
  const korea = window.__gkLast?.d?.world?.items || [];
  const k48 = korea.filter((x) => s.now - Date.parse(x.publishedAt) <= 48 * 3600e3).length;
  return `<div class="gf-nat"><p class="gf-cap"><b>어느 나라 언론이 보도했나</b><span>매체 국적 · 48시간 기사 수</span></p>
    <ol>${top.map((c) => `<li><span class="nm">${esc(c.name)}</span><span class="tr"><i style="width:${((c.n / mx) * 100).toFixed(1)}%"></i></span><b>${c.n}</b></li>`).join('')}</ol>
    ${korea.length ? `<a class="gf-korea" href="?v=world" data-view="world"><span>세계가 본 한국</span><b>${k48}</b><small>건 · 48시간 해외 보도</small><i aria-hidden="true">→</i></a>` : ''}</div>`;
}

function render() {
  const el = host(); if (!el || !G) return;
  const s = summary(G);
  if (S.topic !== 'all' && !s.topics.some((t) => t.id === S.topic)) S.topic = 'all';
  el.innerHTML = `<header class="gf-h">
      <div><p class="gf-k">세계 보도 흐름</p><h3 id="gf-h">지금 세계 언론은 무엇을, 얼마나 빠르게 다루나</h3>
      <p class="gf-sub">해외 주요 ${s.outlets}개 매체의 최근 48시간 기사 ${s.items}건 · ${KSTD.format(new Date(G.generatedAt))} 수집(${ago(Date.now() - Date.parse(G.generatedAt))})${s.translated ? '' : ' · 번역이 붙지 않은 제목은 원문 그대로'}</p></div>
      <a class="gf-jump" href="#atlas">세계 권력 지형 ↓</a>
    </header>
    ${kpis(s)}
    <div class="gf-grid">${chart(s)}${topicBars(s)}</div>
    <div class="gf-grid gf-grid2"><section aria-labelledby="gfStH"><p class="gf-cap" id="gfStH"><b>가장 많은 매체가 다룬 사건</b><span>매체 수 → 국가 수 → 최근 보도 순 · 띠는 매체별 첫 보도 시각</span></p>${stories(s)}</section>${nations(s)}</div>
    <p class="gf-note">보도 단계는 국내 상황판과 같은 규칙입니다 — 급증: 매체 4곳 이상 중 절반 이상이 최근 3시간 안에 처음 보도 · 감소: 6시간 넘게 새 보도 없음 · 지속: 20시간 넘게 보도. 시각은 보도 시각이며 사건 발생 시각과 다를 수 있습니다.</p>`;
}

/* 막대 툴팁 */
let tip;
function showTip(b) {
  if (!tip) { tip = Object.assign(document.createElement('div'), { className: 'gf-tip', role: 'tooltip' }); document.body.append(tip); }
  const t = Number(b.dataset.t), n = b.dataset.n, sN = b.dataset.s;
  tip.innerHTML = `<b>${KSTD.format(new Date(t))}–${KST.format(new Date(t + 3600e3))}</b><span>기사 ${n}건${sN !== '' ? ` · 고른 주제 ${sN}건` : ''}</span>`;
  const r = b.getBoundingClientRect(); tip.hidden = false;
  tip.style.left = `${Math.min(innerWidth - tip.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - tip.offsetWidth / 2))}px`;
  tip.style.top = `${Math.max(8, r.top - tip.offsetHeight - 8)}px`;
}
document.addEventListener('pointerover', (e) => { const b = e.target.closest?.('#gfFlow .gf-b'); if (b) showTip(b); else if (tip) tip.hidden = true; });

document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-gtopic]');
  if (g && G) { S.topic = g.dataset.gtopic; queueMicrotask(render); return; } // app.js 도 같은 단추로 아래 목록을 바꾼다
  const o = e.target.closest('[data-gfopen]');
  if (o) { S.open = S.open === o.dataset.gfopen ? null : o.dataset.gfopen; render(); host()?.querySelector(`[data-gfopen="${CSS.escape(o.dataset.gfopen)}"]`)?.focus(); }
});
addEventListener('gk:global', (e) => { G = e.detail; render(); });
setInterval(() => { if (G && !document.hidden && !host()?.closest('[hidden]')) render(); }, 60 * 1000);
if (window.__gkGlobal) { G = window.__gkGlobal; render(); }
