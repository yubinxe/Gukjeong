// 국정 상황판 · 세계 보도 흐름 — 계산 엔진 (의존성 0, 브라우저·Node 공용) — 테스트는 test/world.test.mjs
// 입력: /api/global (주제 → 사건 묶음 → 기사[매체·국적·보도 시각]). 국내 상황판과 같은 잣대로 보도 흐름을 잰다.
// 보도 단계(국내 상황판 바닥글에 공개된 규칙과 같다):
//   급증: 매체 4곳 이상 중 절반 이상이 최근 3시간 안에 처음 보도 · 감소: 6시간 넘게 새 보도 없음 · 지속: 첫 보도부터 20시간 넘게 보도 · 그 밖: 보도 중
// 원칙: 받은 기사로만 센다. 번역이 없으면 원문 제목을 그대로 쓴다(지어내지 않는다).

const H = 3600e3;
export const PHASES = { surge: "급증", fade: "감소", long: "지속", live: "보도 중" };

export function flatten(g) {
  const out = [];
  (g?.topics || []).forEach((t) => (t.clusters || []).forEach((c, ci) => (c.items || []).forEach((it) => {
    const ts = Date.parse(it.publishedAt);
    if (!Number.isFinite(ts)) return;
    out.push({ topic: t.id, topicName: t.name, cluster: `${t.id}:${ci}`, outlet: it.outletKo || it.outlet, country: it.country || "국적 미상", t: ts, it });
  })));
  return out;
}

// 한국 시각 정시로 자른 시간대별 기사 수(오래된 것 → 최근). topic 을 주면 그 주제만 따로 센다.
export function hourly(items, now, { hours = 48, topic = null } = {}) {
  const KST = 9 * H;
  const end = Math.floor((now + KST) / H) * H - KST + H; // 지금이 속한 시간대의 끝
  const start = end - hours * H;
  const all = Array(hours).fill(0), sel = Array(hours).fill(0);
  for (const x of items) {
    if (x.t < start || x.t >= end) continue;
    const i = Math.floor((x.t - start) / H);
    all[i]++; if (topic && x.topic === topic) sel[i]++;
  }
  return { start, end, all, sel: topic ? sel : null };
}

export function phaseOf(c, now) {
  if (c.outlets >= 4 && c.recentOutlets / c.outlets >= 0.5) return "surge";
  if (now - c.last > 6 * H) return "fade";
  if (c.last - c.first > 20 * H) return "long";
  return "live";
}

// 사건 묶음 통계: 매체·국가 수, 첫/최근 보도, 매체별 첫 보도 시각(시간 띠용)
export function clusters(items, now) {
  const by = new Map();
  for (const x of items) {
    let c = by.get(x.cluster);
    if (!c) by.set(x.cluster, (c = { key: x.cluster, topic: x.topic, topicName: x.topicName, items: [], firstBy: new Map() }));
    c.items.push(x);
    const f = c.firstBy.get(x.outlet);
    if (f == null || x.t < f.t) c.firstBy.set(x.outlet, { t: x.t, country: x.country, link: x.it.link, title: x.it.titleKo || x.it.title });
  }
  return [...by.values()].map((c) => {
    c.items.sort((a, b) => a.t - b.t);
    const lead = c.items.find((x) => x.it.type !== "의견") || c.items[0];
    const outs = [...c.firstBy.entries()].map(([outlet, v]) => ({ outlet, ...v })).sort((a, b) => a.t - b.t);
    const r = {
      key: c.key, topic: c.topic, topicName: c.topicName,
      title: lead.it.titleKo || lead.it.title, original: lead.it.title, translated: Boolean(lead.it.titleKo), link: lead.it.link,
      n: c.items.length, outlets: outs.length, countries: new Set(outs.map((o) => o.country)).size,
      first: c.items[0].t, last: c.items.at(-1).t, recentOutlets: outs.filter((o) => now - o.t <= 3 * H).length, timeline: outs,
    };
    r.phase = phaseOf(r, now);
    return r;
  });
}
// 많이 다룬 순: 매체 수 → 국가 수 → 최근 보도
export const rank = (cs) => [...cs].sort((a, b) => b.outlets - a.outlets || b.countries - a.countries || b.last - a.last);

// 주제별 기사 수와 최근 12시간 대 그 전 12시간
export function topics(items, now) {
  const m = new Map();
  for (const x of items) {
    const r = m.get(x.topic) || { id: x.topic, name: x.topicName, n: 0, recent: 0, before: 0 };
    r.n++;
    if (now - x.t <= 12 * H) r.recent++; else if (now - x.t <= 24 * H) r.before++;
    m.set(x.topic, r);
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
}
// 매체 국적별 기사 수
export function countries(items) {
  const m = new Map();
  for (const x of items) m.set(x.country, (m.get(x.country) || 0) + 1);
  return [...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "ko"));
}

export function summary(g, now = Date.parse(g?.generatedAt) || Date.now(), { hours = 48 } = {}) {
  const all = flatten(g).filter((x) => x.t <= now + 5 * 60e3 && now - x.t <= hours * H);
  const cs = rank(clusters(all, now));
  return {
    now, hours,
    items: all.length, last24: all.filter((x) => now - x.t <= 24 * H).length,
    outlets: new Set(all.map((x) => x.outlet)).size, countries: new Set(all.map((x) => x.country)).size,
    surge: cs.filter((c) => c.phase === "surge").length, multi: cs.filter((c) => c.countries >= 3).length,
    translated: all.filter((x) => x.it.titleKo).length,
    clusters: cs, topics: topics(all, now), byCountry: countries(all), flat: all,
  };
}
