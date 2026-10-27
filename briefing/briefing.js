// 국정 한눈에 · 오늘의 브리핑 화면 — 채널(소식 흐름) + 브리핑 도우미(대화). 의존성 0.
// 사실 층은 언제나 그린다. AI 해석이 늦거나 없으면 사실만으로 완결되는 화면이어야 한다.
import { composeBriefing, kstParts } from "./lib/compose.mjs";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (/^https?:\/\//.test(u || "") ? u : "#");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const mobile = matchMedia("(max-width: 760px), (max-height: 520px) and (orientation: landscape) and (max-width: 1000px)");
const motionOK = matchMedia("(prefers-reduced-motion: no-preference)");
const store = {
  get(k) { try { return JSON.parse(sessionStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* 사생활 보호 모드 등 */ } },
};

const S = { b: null, ins: null, ai: null, loadedAt: 0, msgs: [], quote: null, ctrl: null };
const feed = $("#feed"), chat = $("#chat"), log = $("#chatLog"), input = $("#chatInput"), send = $("#chatSend");

// ── 형식 ──
const dayFmt = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "long" });
const hm = (iso) => kstParts(iso).hm;
const when = (iso) => { const p = kstParts(iso); return p.date === S.b?.date ? p.hm : `${Number(p.date.slice(5, 7))}/${Number(p.date.slice(8))} ${p.hm}`; };
const num = (v) => v.toLocaleString("ko-KR", { maximumFractionDigits: 3 });
const pct = (v) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}%`;
const dir = (v) => (v > 0 ? "up" : v < 0 ? "down" : "flat");

const ICON = {
  reply: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 5 3.5 9.5 8 14"/><path d="M4 9.5h7.5a5 5 0 0 1 5 5v1"/></svg>`,
  share: `<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v10"/><path d="M6.5 6.5 10 3l3.5 3.5"/><path d="M5 10v6h10v-6"/></svg>`,
};

function spark(points) {
  const v = (points || []).map((p) => (typeof p === "number" ? p : p?.v ?? p?.c ?? p?.[1])).filter((x) => Number.isFinite(x));
  if (v.length < 3) return "";
  const lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1;
  const pts = v.map((x, i) => `${(i / (v.length - 1)) * 100},${16 - ((x - lo) / span) * 14}`).join(" ");
  return `<svg viewBox="0 0 100 18" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}

// ── 지면 ──
function leadPost() {
  const { b, ins, ai } = S;
  const lines = ins?.summary?.length ? ins.summary.map(esc) : b.stories.slice(0, 3).map((s) => `<a href="#${s.id}" data-jump="${s.id}">${esc(s.title)}</a>`);
  const tag = ins ? `해석 · AI 작성 ${ai?.generatedAt ? hm(ai.generatedAt) : ""}` : "언론사 수 기준 자동 정리";
  const note = ai?.status === "skipped" ? `<p class="bf-pending" role="status"><i></i>해석을 쓰는 중입니다 — 사실 정리를 먼저 보여 드립니다</p>`
    : ai?.status === "error" || ai?.status === "refused" || ai?.status === "unavailable" ? `<p class="bf-note">지금은 해석을 불러오지 못해 사실 정리만 보여 드립니다.</p>` : "";
  return `<article class="bf-post bf-lead" id="lead">
    <div class="bf-post-h"><span class="bf-topic">${ins?.lead ? "오늘의 한 문장" : "3줄 브리핑"}</span><span class="bf-tag">${tag}</span></div>
    ${ins?.lead ? `<p class="bf-lead-q">${esc(ins.lead)}</p>` : ""}
    <ol class="bf-three">${lines.map((l) => `<li><span>${l}</span></li>`).join("")}</ol>${note}
  </article>`;
}

function marketsPost() {
  const m = S.b.markets.slice(0, 8);
  if (!m.length) return "";
  const kospi = m.find((x) => x.id === "kospi");
  return `<article class="bf-post" id="markets">
    <h3 class="bf-sub">시세<span>${kospi?.status ? `국내 ${esc(kospi.status)} · ` : ""}해외는 지연 시세 · 선은 최근 약 20거래일 · 투자 판단용 아님</span></h3>
    <ul class="bf-mk">${m.map((x) => `<li class="${dir(x.changePct)}"><span class="n">${esc(x.name)}</span><span class="p" style="color:var(--text)">${num(x.price)}${x.unit === "%" ? "%" : ""}</span><span class="c">${pct(x.changePct)}</span>${spark(x.spark)}</li>`).join("")}</ul>
  </article>`;
}

function storyPost(s) {
  const v = S.ins?.stories?.[s.id];
  const ins = v && (v.why || v.watch || v.lens) ? `<div class="bf-ins">${v.why ? `<p><b>왜 중요한가</b>${esc(v.why)}</p>` : ""}${v.watch ? `<p><b>관전 포인트</b>${esc(v.watch)}</p>` : ""}${v.lens ? `<p><b>연결</b>${esc(v.lens)}</p>` : ""}<span class="bf-tag">해석 · AI</span></div>` : "";
  const tl = s.timeline.length > 1 ? `<details class="bf-tl"><summary>보도 흐름 · 첫 보도 ${esc(s.firstSource)} ${when(s.firstAt)}</summary><ol>${s.timeline.map((t) => `<li><span>${when(t.t)} ${esc(t.s)}</span>${esc(t.h)}</li>`).join("")}</ol></details>` : "";
  const counts = [`언론 ${s.outlets}곳`, s.recent3h ? `3시간 ${s.recent3h}건` : "", s.foreign?.outlets?.length ? `해외 ${s.foreign.outlets.length}곳` : ""].filter(Boolean).join(" · ");
  return `<article class="bf-post" id="${s.id}" data-id="${s.id}">
    <div class="bf-post-h"><span class="bf-topic">${esc(v?.topic || s.section)}</span><span class="bf-stage ${s.stage === "급증" ? "is-up" : ""}">${esc(s.stage)}</span>${s.exclusive ? "<span>단독</span>" : ""}<span class="bf-sid">${s.id}</span></div>
    <h3 class="bf-post-t"><a href="${esc(safeUrl(s.link))}" target="_blank" rel="noopener">${esc(s.title)}</a></h3>
    ${s.summary ? `<p class="bf-post-s">${esc(s.summary)}</p>` : ""}${ins}${tl}
    <footer class="bf-post-f"><span class="bf-count">${counts}</span><time datetime="${esc(s.lastAt)}" title="마지막 보도">${when(s.lastAt)}</time>
      <button type="button" class="bf-act" data-ask="${s.id}" aria-label="이 소식에 대해 묻기">${ICON.reply}<span>묻기</span></button>
      <button type="button" class="bf-act" data-share="${s.id}" aria-label="원문 공유">${ICON.share}<span>공유</span></button></footer>
  </article>`;
}

function themesPost() {
  const t = S.ins?.themes || [];
  if (!t.length) return "";
  return `<article class="bf-post" id="themes"><div class="bf-post-h"><span class="bf-topic">오늘의 연결</span><span class="bf-tag">해석 · AI</span></div>
    <ul class="bf-list">${t.map((x) => `<li class="bf-theme"><h4>${esc(x.title)}</h4><p>${esc(x.text)}</p><div class="bf-chips">${x.stories.map((id) => `<button type="button" class="bf-chip" data-jump="${id}">${id}</button>`).join("")}</div></li>`).join("")}</ul></article>`;
}

function policyPost() {
  const { govPre, assemblyPre } = S.b.policy;
  if (!govPre.length && !assemblyPre.length) return "";
  const li = (p, m) => `<li><a class="t" href="${esc(safeUrl(p.link))}" target="_blank" rel="noopener">${esc(p.title)}</a><span class="m">${m}</span></li>`;
  return `<article class="bf-post" id="policy"><h3 class="bf-sub">입법예고<span>의견을 낼 수 있는 법령안 · 원문으로 연결</span></h3>
    <ul class="bf-list">${govPre.map((p) => li(p, `${p.isNew ? '<b class="new">오늘 시작</b>' : ""}${esc(p.dept)} · ${esc(p.kind || p.lawType || "")} · ${p.daysLeft}일 남음`)).join("")}
    ${assemblyPre.map((p) => li(p, `국회 · ${esc(p.committee)} · ${esc(p.sponsor)}`)).join("")}</ul></article>`;
}

function worldPost() {
  const w = S.b.world;
  if (!w.length) return "";
  return `<article class="bf-post" id="world"><h3 class="bf-sub">세계가 본 한국<span>해외 언론 최신순 · 제목 번역은 자동 번역</span></h3>
    <ul class="bf-list">${w.map((x) => `<li><a class="t" href="${esc(safeUrl(x.link))}" target="_blank" rel="noopener" title="${esc(x.original)}">${esc(x.title)}</a><span class="m">${esc(x.outlet)} · ${esc(x.country)} · ${when(x.publishedAt)}${x.paywall ? " · 유료" : ""}</span></li>`).join("")}</ul></article>`;
}

function macroPost() {
  const { macro, bok } = S.b;
  if (!macro.length && !bok) return "";
  return `<article class="bf-post" id="macro"><h3 class="bf-sub">거시 지표<span>한국은행 경제통계 · 발표 기준월</span></h3>
    ${macro.length ? `<ul class="bf-macro">${macro.map((e) => `<li><span class="n">${esc(e.name)}</span><span class="p">${num(e.value)}${esc(e.unit === "%" ? "%" : ` ${e.unit}`)}</span><span class="d">${esc(e.period)}</span></li>`).join("")}</ul>` : ""}
    ${bok ? `<p class="bf-note">한국은행 최근 발간 · <a href="${esc(safeUrl(bok.link))}" target="_blank" rel="noopener">${esc(bok.title)}</a> (${kstParts(bok.date).date})</p>` : ""}</article>`;
}

function aiNote() {
  const ai = S.ai;
  if (ai?.status !== "ok") return "";
  return `<p class="bf-note" style="margin:18px 2px 0">해석 작성 ${esc(ai.model || "Claude")} · ${hm(ai.generatedAt)}${ai.dropped ? ` · 자료로 확인되지 않는 수치가 들어간 문장 ${ai.dropped}개는 싣지 않았습니다` : " · 해석 속 수치는 모두 수집 자료와 대조했습니다"}${ai.stale ? " · 직전 해석을 보여 드리는 중" : ""}</p>`;
}

const sep = (t) => `<div class="bf-sep"><span>${esc(t)}</span></div>`;

function render(data) {
  S.b = data; S.ins = data.insights || null; S.ai = data.ai || null; S.loadedAt = Date.now();
  const { b } = S, by = Object.fromEntries(b.stories.map((s) => [s.id, s]));
  $("#bfEdition").textContent = `${b.edition.label} · ${hm(b.basis)} 기준`;
  $("#bf-title").textContent = dayFmt.format(new Date(b.basis));
  const t = b.stats.temperature;
  $("#bfMeta").textContent = [b.stats.articles ? `최근 24시간 기사 ${num(b.stats.articles)}건` : "", b.stats.outlets ? `언론 ${b.stats.outlets}곳` : "", t ? `${t.name} ${t.value}(${t.level})` : ""].filter(Boolean).join(" · ");
  const pin = S.ins?.lead || b.stories[0]?.title;
  const tail = [policyPost(), worldPost(), macroPost()].filter(Boolean);
  $("#bfPin").hidden = !pin; $("#bfPinText").textContent = pin || "";

  feed.innerHTML = b.stories.length ? [
    sep(`오늘 ${hm(b.basis)}`), leadPost(), marketsPost(),
    b.groups.spreading.length ? sep("지금 확산 중") : "", ...b.groups.spreading.map((id) => storyPost(by[id])),
    themesPost(),
    b.groups.continuing.length ? sep("이어지는 사안") : "", ...b.groups.continuing.map((id) => storyPost(by[id])),
    ...tail.length ? [sep("정책 · 세계 · 지표"), ...tail] : [], aiNote(),
  ].join("") : `<div class="bf-empty"><b>아직 묶인 사안이 없습니다.</b> 수집이 갱신되면 이 자리에 오늘의 소식이 쌓입니다.</div>`;
  feed.setAttribute("aria-busy", "false");
  document.title = `오늘의 브리핑 · ${dayFmt.format(new Date(b.basis))} — 국정 한눈에`;

  restoreChat();
  renderSuggestions();
  status();
  if (/^#S\d+$/.test(location.hash) && !render.jumped) { render.jumped = true; jump(location.hash.slice(1), { instant: true }); }
}

function renderError() {
  feed.setAttribute("aria-busy", "false");
  feed.innerHTML = `<div class="bf-empty"><b>브리핑을 불러오지 못했습니다.</b> 네트워크가 불안정하거나 수집 서버가 응답하지 않습니다. <button type="button" class="bf-tool" id="retry" style="margin-top:10px">다시 불러오기</button></div>`;
  $("#retry").onclick = () => load();
}

async function getJSON(url) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok || !/json/.test(r.headers.get("content-type") || "")) throw new Error(`응답 ${r.status}`);
  return r.json();
}

// 해석이 2.5초 안에 오지 않으면 사실 층부터 그리고, 해석이 도착하면 다시 그린다.
async function load() {
  const full = getJSON("/api/briefing/today");
  const quick = await Promise.race([full.then((d) => ({ d }), (e) => ({ e })), wait(2500).then(() => null)]);
  if (quick?.d) return render(quick.d);
  if (!quick) { const facts = await getJSON("/api/briefing/today?facts=1").catch(() => null); if (facts) render(facts); }
  try { render(await full); } catch {
    if (S.b) { if (S.ai?.status === "skipped") render({ ...S.b, insights: null, ai: { status: "error" } }); return; }
    // 브리핑 함수가 없는 배포(정적 미리보기 등): 운영 원천에서 직접 사실 층을 만든다
    try { render({ ...composeBriefing(await getJSON("/api/dashboard")), insights: null, ai: { status: "unavailable" } }); } catch { renderError(); }
  }
}

// ── 이동 · 공유 · 듣기 ──
function jump(id, { instant = false } = {}) {
  const go = () => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: instant || !motionOK.matches ? "auto" : "smooth", block: "start" });
    el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 900);
  };
  if (chat.classList.contains("is-open")) { closeChat(); setTimeout(go, 380); } else go();
}

let toastEl;
function toast(msg) {
  toastEl ??= Object.assign(document.body.appendChild(document.createElement("div")), { className: "toast", role: "status" });
  toastEl.textContent = msg; toastEl.classList.add("on");
  clearTimeout(toast.t); toast.t = setTimeout(() => toastEl.classList.remove("on"), 2200);
}
async function share(data) {
  try {
    if (navigator.share) return await navigator.share(data);
    await navigator.clipboard.writeText(data.url); toast("링크를 복사했습니다");
  } catch (e) { if (e?.name !== "AbortError") toast("공유하지 못했습니다"); }
}

function setupListen() {
  const btn = $("#listenBtn");
  if (!("speechSynthesis" in window)) return;
  btn.hidden = false;
  const stop = () => { speechSynthesis.cancel(); btn.setAttribute("aria-pressed", "false"); btn.querySelector("span").textContent = "듣기"; };
  btn.onclick = () => {
    if (btn.getAttribute("aria-pressed") === "true") return stop();
    const { b, ins } = S;
    if (!b) return;
    const lines = [`${dayFmt.format(new Date(b.basis))} ${b.edition.label} 브리핑입니다.`, ins?.lead, ...(ins?.summary || []), "주요 소식입니다.",
      ...b.stories.slice(0, 6).map((s, i) => `${i + 1}. ${s.title}. ${S.ins?.stories?.[s.id]?.why || ""}`)];
    const u = new SpeechSynthesisUtterance(lines.filter(Boolean).join(" ").replace(/[‘’“”…\[\]]/g, " "));
    u.lang = "ko-KR"; u.rate = 1.02;
    u.voice = speechSynthesis.getVoices().find((v) => v.lang?.startsWith("ko")) || null;
    u.onend = u.onerror = stop;
    speechSynthesis.cancel(); speechSynthesis.speak(u);
    btn.setAttribute("aria-pressed", "true"); btn.querySelector("span").textContent = "멈춤";
  };
}

// ── 브리핑 도우미 ──
const chatKey = () => `bf-chat:${S.b?.date}`;
function restoreChat() {
  if (S.msgs.length || restoreChat.done) return;
  restoreChat.done = true;
  S.msgs = (store.get(chatKey()) || []).filter((m) => m && m.content && !m.pending);
  renderMsgs();
}
const persist = () => store.set(chatKey(), S.msgs.slice(-30));

function inline(s, cites) {
  return s.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\[(S\d{1,2})\]/g, (_, id) => `<button type="button" class="bf-cite" data-cite="${id}" title="${esc(cites?.[id]?.title || "근거 소식")}">${id}</button>`)
    .replace(/(https?:\/\/[^\s<)\]]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
}
// 짧은 대화용 서식: 문단 · 목록 · 굵게 · 근거 번호 · 링크. 먼저 전부 이스케이프한다.
function md(text, cites) {
  return esc(text).split(/\n{2,}/).map((block) => {
    let html = "", list = null, para = [];
    const flushP = () => { if (para.length) html += `<p>${para.join("<br>")}</p>`; para = []; };
    const flushL = () => { if (list) html += `<${list.tag}>${list.items.map((i) => `<li>${i}</li>`).join("")}</${list.tag}>`; list = null; };
    for (const line of block.split("\n")) {
      const ul = line.match(/^\s*[-•·*]\s+(.*)/), ol = line.match(/^\s*\d+[.)]\s+(.*)/);
      const item = ul || ol;
      if (item) { flushP(); const tag = ul ? "ul" : "ol"; if (list?.tag !== tag) { flushL(); list = { tag, items: [] }; } list.items.push(inline(item[1], cites)); }
      else if (line.trim()) { flushL(); para.push(inline(line, cites)); }
    }
    flushL(); flushP();
    return html;
  }).join("");
}

function bubble(m, i) {
  const t = new Date(m.at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });
  if (m.role === "user") return `<div class="bf-msg me" data-i="${i}">${m.quote ? `<span class="bf-q">${esc(m.quote.title)}</span>` : ""}<p>${esc(m.content).replace(/\n/g, "<br>")}</p><time>${t}</time></div>`;
  const body = m.pending && !m.content ? `<span class="bf-typing" aria-label="답을 쓰는 중"><i></i><i></i><i></i></span>`
    : `<div class="${m.pending ? "bf-caret" : ""}">${md(m.content, m.cites)}</div>`;
  const warn = m.unverified?.length ? `<span class="bf-warn">수집 자료에서 확인되지 않은 수치: ${m.unverified.map(esc).join(", ")} — 원문으로 확인해 주세요</span>` : "";
  return `<div class="bf-msg ai${m.error ? " err" : ""}" data-i="${i}">${body}${warn}${m.pending ? "" : `<time>${m.stopped ? "멈춤 · " : ""}${t}</time>`}</div>`;
}
function welcome() {
  return `<span class="bf-day">오늘${S.b ? ` · ${S.b.edition.label}` : ""}</span>
  <div class="bf-msg ai"><p>오늘 수집된 보도와 시세를 근거로 답합니다. 근거가 된 소식은 <button type="button" class="bf-cite" tabindex="-1" aria-hidden="true">S1</button>처럼 번호를 붙이니, 누르면 그 소식으로 이동합니다.</p><p>사실과 해석은 나눠 말씀드리고, 자료에 없는 것은 없다고 답합니다.</p></div>`;
}
const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 80;
function renderMsgs() {
  log.innerHTML = welcome() + S.msgs.map(bubble).join("");
  log.scrollTop = log.scrollHeight;
  renderSuggestions();
}
let raf = 0;
function paintLast() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0;
    const i = S.msgs.length - 1, el = log.querySelector(`.bf-msg[data-i="${i}"]`);
    if (!el) return renderMsgs();
    const stick = nearBottom();
    el.outerHTML = bubble(S.msgs[i], i);
    if (stick) log.scrollTop = log.scrollHeight;
  });
}

function renderSuggestions() {
  const box = $("#chatSugg");
  if (!S.b || S.msgs.some((m) => m.role === "user")) { box.innerHTML = ""; return; }
  const qs = S.ins?.questions?.length ? S.ins.questions : [
    "오늘 꼭 알아야 할 소식 세 가지는?",
    S.b.markets.some((m) => m.id === "kospi") ? "오늘 시장은 왜 이렇게 움직였나요?" : null,
    S.b.policy.govPre.length ? "입법예고 중 생활에 닿는 건 뭔가요?" : null,
    S.b.world.length ? "해외 언론은 한국의 무엇을 다뤘나요?" : null,
  ].filter(Boolean);
  box.innerHTML = qs.map((q) => `<button type="button" data-q="${esc(q)}">${esc(q)}</button>`).join("");
}

function status(text, live = false) {
  const el = $("#chatStatus");
  el.textContent = text || (S.b ? `오늘 ${hm(S.b.basis)} 자료 기준으로 답합니다` : "오늘 자료를 불러오는 중");
  el.classList.toggle("live", live);
}
function setBusy(on) {
  send.classList.toggle("stop", on);
  send.setAttribute("aria-label", on ? "답 멈추기" : "보내기");
  send.disabled = !on && !input.value.trim();
  status(on ? "답을 쓰는 중…" : "", on);
}

function setQuote(story) {
  S.quote = story ? { id: story.id, link: story.link, title: story.title } : null;
  $("#chatQuote").hidden = !story;
  $("#chatQuoteText").textContent = story ? story.title : "";
  input.placeholder = story ? "이 소식에 대해 무엇이 궁금한가요?" : "오늘 소식에 대해 물어보세요";
}

async function* sse(res) {
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      let ev = "message", data = "";
      for (const line of chunk.split("\n")) { if (line.startsWith("event:")) ev = line.slice(6).trim(); else if (line.startsWith("data:")) data += line.slice(5).trim(); }
      if (data) yield { ev, data: JSON.parse(data) };
    }
  }
}

async function ask(text) {
  text = String(text || "").trim();
  if (!text || S.ctrl) return;
  const quote = S.quote;
  setQuote(null);
  input.value = ""; grow();
  S.msgs.push({ role: "user", content: text, at: Date.now(), quote: quote ? { title: quote.title } : null });
  const ai = { role: "assistant", content: "", at: Date.now(), pending: true };
  S.msgs.push(ai);
  renderMsgs();
  const ctrl = new AbortController();
  S.ctrl = ctrl; setBusy(true);
  try {
    const history = S.msgs.filter((m) => !m.pending && !m.error && m.content).map(({ role, content }) => ({ role, content }));
    const res = await fetch("/api/briefing/chat", {
      method: "POST", headers: { "content-type": "application/json" }, signal: ctrl.signal,
      body: JSON.stringify({ messages: history, quote: quote ? { link: quote.link, title: quote.title } : null }),
    });
    if (!res.ok || !res.body) {
      const j = await res.json().catch(() => ({}));
      throw Object.assign(new Error(j.error || (res.status === 404 ? "이 배포에는 브리핑 도우미가 아직 연결되지 않았습니다." : `응답 오류 ${res.status}`)), { soft: true });
    }
    let map = {};
    for await (const { ev, data } of sse(res)) {
      if (ev === "meta") { map = Object.fromEntries(data.stories.map((s) => [s.id, { link: s.link, title: s.title }])); ai.cites = map; }
      else if (ev === "delta") { ai.content += data.t; ai.pending = false; paintLast(); }
      else if (ev === "done") { ai.cites = Object.fromEntries((data.cited || []).filter((id) => map[id]).map((id) => [id, map[id]])); ai.unverified = data.unverified || []; }
      else if (ev === "error") { ai.error = true; ai.content = data.refusal || !ai.content ? data.message : `${ai.content}\n\n${data.message}`; }
    }
    if (!ai.content) { ai.error = true; ai.content = "답을 받지 못했습니다. 다시 시도해 주세요."; }
  } catch (e) {
    if (e.name === "AbortError") { ai.stopped = true; if (!ai.content) { ai.content = "답을 멈췄습니다."; ai.error = true; } }
    else { ai.error = true; ai.content = e.soft ? e.message : "연결이 끊겼습니다. 네트워크를 확인하고 다시 시도해 주세요."; }
  } finally {
    ai.pending = false; S.ctrl = null; setBusy(false); paintLast(); persist();
  }
}

// ── 휴대폰: 아래에서 올라오는 대화 시트 (뒤로 가기 · 아래로 끌어 닫기) ──
function setViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  document.documentElement.style.setProperty("--bf-vh", `${vv.height}px`);
  document.documentElement.style.setProperty("--bf-vt", `${vv.offsetTop}px`);
}
function openChat({ focus = false } = {}) {
  if (!mobile.matches) { if (focus) input.focus(); return; }
  if (!chat.classList.contains("is-open")) {
    setViewport();
    chat.classList.add("is-open");
    document.body.classList.add("bf-chat-open");
    history.pushState({ bfChat: 1 }, "");
    log.scrollTop = log.scrollHeight;
  }
  if (focus) input.focus({ preventScroll: true }); // 같은 탭 처리 안에서 불러야 iOS 키보드가 올라온다
}
function hideChat() {
  chat.classList.remove("is-open", "dragging"); chat.style.transform = "";
  document.body.classList.remove("bf-chat-open");
  input.blur();
}
function closeChat() { if (history.state?.bfChat) history.back(); else hideChat(); }
addEventListener("popstate", () => { if (chat.classList.contains("is-open") && !history.state?.bfChat) hideChat(); });

function setupDrag() {
  const head = $(".bf-chat-h");
  let y0 = null, dy = 0, t0 = 0;
  head.addEventListener("pointerdown", (e) => {
    if (!mobile.matches || e.target.closest("button")) return;
    y0 = e.clientY; dy = 0; t0 = performance.now(); chat.classList.add("dragging"); head.setPointerCapture(e.pointerId);
  });
  head.addEventListener("pointermove", (e) => { if (y0 == null) return; dy = Math.max(0, e.clientY - y0); chat.style.transform = `translateY(${dy}px)`; });
  const end = () => {
    if (y0 == null) return;
    const fast = dy / Math.max(1, performance.now() - t0) > 0.6;
    y0 = null; chat.classList.remove("dragging"); chat.style.transform = "";
    if (dy > 110 || (fast && dy > 30)) closeChat();
  };
  head.addEventListener("pointerup", end); head.addEventListener("pointercancel", end);
}

function grow() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
  if (!S.ctrl) send.disabled = !input.value.trim();
}

// ── 사이트 공통 동작(상단 막대 높이 · 테마 · 전체 메뉴) — 홈의 app.js 를 싣지 않으므로 필요한 것만 ──
function syncBars() {
  const bar = $(".bar"), views = $(".views");
  document.documentElement.style.setProperty("--bar-h", `${bar?.offsetHeight || 0}px`);
  document.documentElement.style.setProperty("--views-h", `${views && getComputedStyle(views).display !== "none" ? views.offsetHeight : 0}px`);
}
function themeLabel() {
  const dark = (document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")) === "dark";
  $("#themeBtn").textContent = dark ? "밝게" : "어둡게";
  return dark;
}
function toggleTheme() {
  const next = themeLabel() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("theme", next); } catch { /* 저장 불가 환경 */ }
  themeLabel();
}

// ── 이벤트 ──
feed.addEventListener("click", (e) => {
  const a = e.target.closest("[data-ask]"), sh = e.target.closest("[data-share]"), j = e.target.closest("[data-jump]");
  if (a) { setQuote(S.b.stories.find((s) => s.id === a.dataset.ask)); openChat({ focus: true }); }
  else if (sh) { const s = S.b.stories.find((x) => x.id === sh.dataset.share); share({ title: s.title, text: `${s.title} — 언론 ${s.outlets}곳 보도`, url: s.link }); }
  else if (j) { e.preventDefault(); jump(j.dataset.jump); }
});
log.addEventListener("click", (e) => {
  const c = e.target.closest("[data-cite]");
  if (!c) return;
  const m = S.msgs[Number(c.closest(".bf-msg")?.dataset.i)], ref = m?.cites?.[c.dataset.cite];
  const local = ref && S.b?.stories.find((s) => s.link === ref.link);
  if (local) jump(local.id); else if (ref) window.open(safeUrl(ref.link), "_blank", "noopener");
});
$("#chatSugg").addEventListener("click", (e) => { const q = e.target.closest("[data-q]"); if (q) ask(q.dataset.q); });
$("#chatForm").addEventListener("submit", (e) => { e.preventDefault(); if (S.ctrl) S.ctrl.abort(); else ask(input.value); });
input.addEventListener("input", grow);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.keyCode !== 229 && !mobile.matches) { e.preventDefault(); if (!S.ctrl) ask(input.value); }
});
$("#chatQuoteX").onclick = () => setQuote(null);
$("#chatNew").onclick = () => { if (S.ctrl) S.ctrl.abort(); S.msgs = []; persist(); setQuote(null); renderMsgs(); status(); };
$("#chatClose").onclick = closeChat;
$("#askBar").onclick = () => openChat({ focus: true });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && chat.classList.contains("is-open")) closeChat(); });
$("#shareBtn").onclick = () => share({ title: "오늘의 브리핑 — 국정 한눈에", text: S.ins?.lead || S.b?.stories[0]?.title || "", url: `${location.origin}/briefing/` });
$("#bfPin").onclick = (e) => { e.preventDefault(); jump("lead"); };
$("#themeBtn").onclick = toggleTheme;
const sheet = $("#moreSheet");
$("#moreBtn").onclick = () => sheet.showModal();
sheet.addEventListener("click", (e) => { if (e.target === sheet || e.target.closest("[data-close-sheet]")) sheet.close(); });
$("#sheetRefresh").onclick = () => { sheet.close(); load(); };
$("#sheetTheme").onclick = toggleTheme;
mobile.addEventListener("change", () => { if (!mobile.matches) hideChat(); syncBars(); });
window.visualViewport?.addEventListener("resize", () => { if (chat.classList.contains("is-open")) { setViewport(); if (nearBottom()) log.scrollTop = log.scrollHeight; } });
window.visualViewport?.addEventListener("scroll", () => { if (chat.classList.contains("is-open")) setViewport(); });
addEventListener("resize", syncBars);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && S.b && Date.now() - S.loadedAt > 10 * 60e3 && !S.ctrl) load(); });

input.enterKeyHint = mobile.matches ? "enter" : "send"; // 휴대폰은 줄바꿈, 보내기는 단추로(텔레그램과 같은 문법)
syncBars(); themeLabel(); setupListen(); setupDrag(); renderMsgs(); status();
load();
