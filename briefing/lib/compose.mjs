// 국정 한눈에 · 오늘의 브리핑 — 대시보드 수집 결과를 '사실 층'으로 정리하는 엔진 (의존성 0, 브라우저/Node 공용)
// 원칙: 사실(수집·집계)과 해석(AI)을 섞지 않는다 · 해석 속 수치는 입력 자료에 있는 것만 통과 · 근거 소식은 S번호로 잇는다.

const KST = "Asia/Seoul";
export const MAX_STORIES = 12;
const MARKET_ORDER = ["kospi", "kosdaq", "usdkrw", "sp500", "nasdaq", "us10y", "wti", "gold", "samsung", "hynix", "jpykrw", "eurkrw"];

const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: KST, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
export function kstParts(d) {
  const p = Object.fromEntries(fmt.formatToParts(new Date(d)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), hm: `${p.hour}:${p.minute}` };
}

// 발행 시각(KST)으로 판을 나눈다 — 같은 날에도 아침과 저녁의 브리핑은 다른 판이다.
export function edition(d) {
  const { date, hour } = kstParts(d);
  const [key, label] = hour < 6 ? ["dawn", "새벽판"] : hour < 11 ? ["morning", "아침판"] : hour < 17 ? ["afternoon", "오후판"] : ["evening", "저녁판"];
  return { id: `${date}.${key}`, date, key, label };
}

// "(서울=연합뉴스) 박상현 기자 = " 같은 머리말을 걷어 요지만 남긴다.
export function cleanSummary(s) {
  return String(s || "")
    .replace(/^\s*[([][^)\]]{0,40}=[^)\]]{0,30}[)\]]\s*/, "")
    .replace(/^[^=]{0,24}기자\s*=\s*/, "")
    .replace(/\s*(\.\.\.|…)+\s*$/, "…")
    .replace(/\s+/g, " ")
    .trim();
}

const titleKey = (t) => String(t || "").replace(/[^0-9A-Za-z가-힣]/g, "").slice(0, 22);

function storyScore(s) {
  return (s.independent || 0) + 0.5 * (s.recent3h || 0) + (s.stage === "급증" ? 3 : 0) + (s._head ? 2 : 0) - (s.opinion ? 6 : 0);
}

// 헤드라인과 분야별 묶음을 합쳐 중복을 지우고, 언론사 수·최근 확산·단계로 고른다(기사량 단독 기준이 아님).
export function selectStories(dash, max = MAX_STORIES) {
  const seen = new Set(), pool = [];
  const add = (s, section, head) => {
    const k1 = s.link, k2 = titleKey(s.title);
    if (!s.title || !s.link || seen.has(k1) || seen.has(k2)) return;
    seen.add(k1); seen.add(k2);
    pool.push({ ...s, sectionName: s.sectionName || section, _head: head });
  };
  for (const h of dash.headlines || []) add(h, h.sectionName, true);
  for (const sec of dash.sections || []) for (const it of sec.items || []) add(it, sec.name, false);
  const strong = pool.filter((s) => (s.independent || 0) >= 3 && !s.opinion);
  const picked = (strong.length >= 6 ? strong : pool).sort((a, b) => storyScore(b) - storyScore(a) || String(b.lastAt).localeCompare(String(a.lastAt))).slice(0, max);
  return picked;
}

function foreignFor(dash, link) {
  const c = (dash.compare?.both || []).find((x) => x.key === link || x.domestic?.story === link);
  return c ? { outlets: c.foreignOutlets || [], countries: c.foreignCountries || [] } : null;
}

export function composeBriefing(dash, now = new Date()) {
  const basis = dash.generatedAt || now.toISOString();
  const ed = edition(basis);
  const stories = selectStories(dash).map((s, i) => ({
    id: `S${i + 1}`,
    title: s.title, link: s.link, source: s.source, firstSource: s.firstSource || s.source,
    publishedAt: s.publishedAt, firstAt: s.firstAt || s.publishedAt, lastAt: s.lastAt || s.publishedAt,
    outlets: s.independent || 1, recent3h: s.recent3h || 0, stage: s.stage || "진행", scope: s.scope || "",
    section: s.sectionName || "", summary: cleanSummary(s.summary), image: s.image || null, exclusive: !!s.exclusive,
    timeline: (s.timeline || []).slice(0, 5).map((t) => ({ s: t.s, t: t.t, h: t.h })),
    foreign: foreignFor(dash, s.link),
  }));
  const idByLink = new Map(stories.map((s) => [s.link, s.id]));
  const rank = (m) => { const i = MARKET_ORDER.indexOf(m.id); return i < 0 ? 99 : i; };
  const today = ed.date.replace(/-/g, ". ").replace(/\. 0/g, ". ") + ".";
  const v = dash.indices?.volume || {};
  return {
    id: ed.id, date: ed.date, edition: ed, basis, composedAt: now.toISOString(),
    stats: { articles: v.value ?? null, outlets: v.outlets ?? null, temperature: dash.indices?.temperature || null },
    stories,
    groups: {
      spreading: stories.filter((s) => s.stage === "급증").map((s) => s.id),
      continuing: stories.filter((s) => s.stage !== "급증").map((s) => s.id),
    },
    markets: (dash.markets || []).filter((m) => typeof m.price === "number").sort((a, b) => rank(a) - rank(b)).map((m) => ({
      id: m.id, group: m.group, name: m.name, price: m.price, change: m.change, changePct: m.changePct, unit: m.unit || "",
      digits: m.digits ?? null, status: m.status || null, asOf: m.asOf, source: m.source, spark: (m.spark || []).slice(-24),
    })),
    signals: (dash.signals || []).slice(0, 8).map((g) => ({ label: g.label, title: g.title, detail: g.detail, link: g.link, story: idByLink.get(g.link) || null })),
    keywords: (dash.keywords || []).slice(0, 10).map((k) => ({ word: k.word, stories: k.stories, count: k.count })),
    policy: {
      // 오늘 시작한 입법예고를 앞에, 마감이 가까운 순으로
      govPre: [...(dash.policy?.govPre || [])].sort((a, b) => (String(b.period).startsWith(today) - String(a.period).startsWith(today)) || (a.daysLeft ?? 99) - (b.daysLeft ?? 99)).slice(0, 4)
        .map((p) => ({ title: p.title, link: p.link, dept: p.dept, kind: p.kind, lawType: p.lawType, period: p.period, daysLeft: p.daysLeft, isNew: String(p.period).startsWith(today) })),
      assemblyPre: (dash.policy?.assemblyPre || []).slice(0, 4).map((p) => ({ title: p.title, link: p.link, sponsor: p.sponsor, committee: p.committee })),
    },
    world: [...(dash.world?.items || [])].sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt))).slice(0, 5)
      .map((w) => ({ title: w.titleKo || w.title, original: w.title, link: w.link, outlet: w.outletKo || w.outlet, country: w.country, region: w.region, publishedAt: w.publishedAt, paywall: !!w.paywall })),
    macro: (dash.ecos?.items || []).slice(0, 6).map((e) => ({ name: e.name, value: e.value, unit: e.unit, period: e.period, change: e.change, digits: e.digits })),
    bok: (dash.bok?.notes || [])[0] ? { title: dash.bok.notes[0].title, link: dash.bok.notes[0].link, date: dash.bok.notes[0].date } : null,
  };
}

// ── 모델에 주는 자료 — 같은 판이면 바이트까지 같게(프롬프트 캐시) ──
const pct = (v) => (v > 0 ? "+" : "") + v + "%";
export function digestText(b) {
  const L = [];
  L.push(`[기준] ${b.date} ${kstParts(b.basis).hm} KST 수집 · ${b.edition.label}${b.stats.articles ? ` · 최근 24시간 기사 ${b.stats.articles}건 · 언론 ${b.stats.outlets}곳` : ""}`);
  if (b.markets.length) L.push(`[시세] ${b.markets.map((m) => `${m.name} ${m.price.toLocaleString("en-US")}${m.unit === "%" ? "%" : ""} (${pct(m.changePct)}${m.status ? `, ${m.status}` : ""})`).join(" | ")}`);
  for (const s of b.stories) {
    L.push(`[${s.id}] ${s.title}`);
    L.push(`  - 언론 ${s.outlets}곳 · 최근 3시간 ${s.recent3h}건 · 단계 ${s.stage}${s.scope ? ` · 범위 ${s.scope}` : ""} · 분류 ${s.section} · 첫 보도 ${s.firstSource} ${kstParts(s.firstAt).hm} · 마지막 ${kstParts(s.lastAt).hm}`);
    if (s.summary) L.push(`  - 요지: ${s.summary}`);
    const alt = s.timeline.map((t) => t.h).filter((h) => h && h !== s.title).slice(0, 3);
    if (alt.length) L.push(`  - 다른 제목: ${alt.join(" / ")}`);
    if (s.foreign) L.push(`  - 해외 보도: ${s.foreign.outlets.join(", ")}`);
  }
  if (b.signals.length) L.push(`[보도 신호] ${b.signals.map((g) => `${g.label}${g.story ? `(${g.story})` : ""}: ${g.title} — ${g.detail}`).join(" | ")}`);
  if (b.keywords.length) L.push(`[키워드] ${b.keywords.map((k) => `${k.word}(${k.stories}개 사안)`).join(", ")}`);
  for (const p of b.policy.govPre) L.push(`[입법예고] ${p.title} · ${p.dept} · ${p.period} · 남은 ${p.daysLeft}일`);
  for (const p of b.policy.assemblyPre) L.push(`[국회 입법예고] ${p.title} · ${p.sponsor} · ${p.committee}`);
  for (const w of b.world) L.push(`[해외] ${w.outlet}(${w.country}): ${w.title}`);
  if (b.macro.length) L.push(`[거시] ${b.macro.map((e) => `${e.name} ${e.value}${e.unit} (${e.period})`).join(" | ")}`);
  if (b.bok) L.push(`[한국은행] ${b.bok.title} (${kstParts(b.bok.date).date})`);
  return L.join("\n");
}

// ── 수치 근거 검사: 입력 자료에 없는 숫자를 지어내지 못하게 한다 ──
const NUM = /\d+(?:[.,]\d+)*/g;
const norm = (n) => n.replace(/,/g, "");
export function numberSet(text) {
  const set = new Set();
  for (const raw of String(text).match(NUM) || []) {
    const n = norm(raw);
    set.add(n);
    if (n.includes(".")) { set.add(n.split(".")[0]); set.add(String(Number(n))); } // 5638.34 → 5638 (반올림이 아닌 정수부만)
  }
  return set;
}
export function ungrounded(text, set) {
  const body = String(text || "").replace(/\[S\d{1,2}\]/g, ""); // 인용 번호는 수치가 아니다
  return [...new Set((body.match(NUM) || []).map(norm))].filter((n) => !set.has(n) && !set.has(String(Number(n))));
}

const clip = (s, n) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

// 모델 출력 → 화면에 실을 해석. 존재하지 않는 S번호·근거 없는 수치는 필드 단위로 버리고 그 사실을 기록한다.
export function sanitizeInsights(raw, b, grounded) {
  const ids = new Set(b.stories.map((s) => s.id));
  const dropped = [];
  const keep = (path, text, n) => {
    const t = clip(text, n);
    if (!t) return null;
    const bad = ungrounded(t, grounded);
    if (bad.length) { dropped.push({ path, reason: "근거 없는 수치", numbers: bad }); return null; }
    return t;
  };
  const out = {
    lead: keep("lead", raw?.lead, 120),
    summary: (raw?.summary || []).slice(0, 3).map((x, i) => keep(`summary.${i}`, x, 90)).filter(Boolean),
    themes: (raw?.themes || []).slice(0, 3).map((t, i) => {
      const stories = [...new Set((t.stories || []).filter((id) => ids.has(id)))];
      const text = keep(`themes.${i}`, t.text, 240), title = keep(`themes.${i}.title`, t.title, 32);
      if (stories.length < 2) { dropped.push({ path: `themes.${i}`, reason: "연결 근거 부족" }); return null; }
      return text && title ? { title, text, stories } : null;
    }).filter(Boolean),
    stories: {},
    questions: (raw?.questions || []).slice(0, 4).map((q, i) => keep(`questions.${i}`, q, 60)).filter(Boolean),
  };
  for (const s of raw?.stories || []) {
    if (!ids.has(s.id)) { dropped.push({ path: `stories.${s.id}`, reason: "없는 소식 번호" }); continue; }
    const v = { topic: keep(`${s.id}.topic`, s.topic, 14), why: keep(`${s.id}.why`, s.why, 220), watch: keep(`${s.id}.watch`, s.watch, 170), lens: keep(`${s.id}.lens`, s.lens, 170) };
    if (v.why || v.watch || v.lens || v.topic) out.stories[s.id] = v;
  }
  return { insights: out, dropped };
}

// 인용 표기 [S3] → 실제 있는 소식만
export function citedIds(text, b) {
  const ids = new Set(b.stories.map((s) => s.id));
  return [...new Set([...String(text || "").matchAll(/\[(S\d{1,2})\]/g)].map((m) => m[1]))].filter((id) => ids.has(id));
}

// AI 없이도 동작하는 소식 찾기 — 질문 낱말이 제목·요지·다른 제목에 얼마나 겹치는지.
// '오늘·소식·가지' 같은 질문 말투는 빼고, 본문에만 한 번 스친 낱말로는 고르지 않는다(제목 일치 3점, 본문 1점, 2점 이상).
const STOP = new Set(["오늘", "소식", "뉴스", "알아야", "가지", "무엇", "뭐야", "어떤", "어떻게", "정리", "중요", "중요한", "알려", "궁금", "관련", "대해", "요즘", "지금", "가장", "주요"]);
export function searchStories(b, q, k = 3) {
  const words = [...new Set(String(q || "").toLowerCase().match(/[0-9a-z가-힣]{2,}/g) || [])]
    .map((w) => w.replace(/(은|는|이|가|을|를|의|에|에서|로|으로|와|과|도|만|요|까|나요|해줘|알려줘)$/, ""))
    .filter((w) => w.length >= 2 && !STOP.has(w));
  if (!words.length) return [];
  return b.stories.map((s) => {
    const hay = `${s.title} ${s.summary} ${s.section} ${s.timeline.map((t) => t.h).join(" ")}`.toLowerCase();
    const score = words.reduce((a, w) => a + (hay.includes(w) ? (s.title.toLowerCase().includes(w) ? 3 : 1) : 0), 0);
    return { id: s.id, score: score >= 2 ? score + s.outlets / 100 : 0 };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, k).map((x) => x.id);
}
