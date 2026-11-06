// 국회의원 명부(제20·21·22대) — 위키데이터(CC0)에서 가져와 officials/data/officials.json 으로 쓴다.
//   node scripts/officials/registry.mjs
// 대수 소속은 '대한민국 국회의원(Q14850694)' 직위 진술의 대수 한정어(P2937)로, 정당은 시작·종료일이 있는 정당 진술(P102)만 쓴다.
// 날짜 없는 정당 진술은 어느 시점의 소속인지 알 수 없으므로 버린다(지금 소속을 과거에 소급하지 않기 위해).
import { writeFile, readFile } from "node:fs/promises";

const TERMS = { Q22971549: 20, Q90759969: 21, Q125657991: 22 };
const ENDPOINT = "https://query.wikidata.org/sparql";
// 위키미디어 User-Agent 정책: 자동 요청은 도구 이름과 연락 경로를 밝혀야 한다(https://meta.wikimedia.org/wiki/User-Agent_policy)
const UA = "gukjeong-hannune-registry/1.0 (+https://gukjeong-hannune.vercel.app/officials/)";
async function sparql(q) {
  const r = await fetch(`${ENDPOINT}?${new URLSearchParams({ query: q })}`, { headers: { accept: "application/sparql-results+json", "user-agent": UA }, signal: AbortSignal.timeout(90000) });
  if (!r.ok) throw new Error(`위키데이터 응답 ${r.status}`);
  return (await r.json()).results.bindings;
}
const qid = (u) => u.split("/").pop();
const day = (v) => (v ? v.slice(0, 10) : null);

const roster = await sparql(`SELECT ?p ?pLabel ?term ?start ?end WHERE {
  VALUES ?term { ${Object.keys(TERMS).map((q) => `wd:${q}`).join(" ")} }
  ?p p:P39 ?st . ?st ps:P39 wd:Q14850694 ; pq:P2937 ?term .
  OPTIONAL { ?st pq:P580 ?start } OPTIONAL { ?st pq:P582 ?end }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "ko,en". } }`);
const people = new Map();
for (const b of roster) {
  const id = qid(b.p.value);
  const o = people.get(id) || { id: `wd-${id}`, wd: id, name: b.pLabel.value, terms: new Set(), seats: [], party: [] };
  o.terms.add(TERMS[qid(b.term.value)]);
  o.seats.push({ term: TERMS[qid(b.term.value)], from: day(b.start?.value), to: day(b.end?.value) });
  people.set(id, o);
}
const ids = [...people.keys()];
for (let i = 0; i < ids.length; i += 150) {
  const chunk = ids.slice(i, i + 150);
  const rows = await sparql(`SELECT ?p ?partyLabel ?ps ?pe WHERE {
    VALUES ?p { ${chunk.map((q) => `wd:${q}`).join(" ")} }
    ?p p:P102 ?st . ?st ps:P102 ?party . OPTIONAL { ?st pq:P580 ?ps } OPTIONAL { ?st pq:P582 ?pe }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "ko". } }`);
  for (const b of rows) {
    const o = people.get(qid(b.p.value));
    const from = day(b.ps?.value), to = day(b.pe?.value);
    if (!from) continue;
    o.party.push({ name: b.partyLabel.value, from, to });
  }
}
// 이름에 한글이 없는(라벨 미번역) 항목은 표기 확인이 필요하다고 적어 둔다
const officials = [...people.values()].map((o) => ({ ...o, terms: [...o.terms].sort(), party: o.party.sort((a, b) => a.from.localeCompare(b.from)), ...( /[가-힣]/.test(o.name) ? {} : { note: "한글 이름 미확인" }) }))
  .sort((a, b) => a.name.localeCompare(b.name, "ko"));
const coverage = Object.fromEntries(Object.values(TERMS).map((t) => {
  const m = officials.filter((o) => o.terms.includes(t));
  return [t, { roster: m.length, withParty: m.filter((o) => o.party.length).length }];
}));
const dir = new URL("../../officials/data/", import.meta.url);
await writeFile(new URL("officials.json", dir), JSON.stringify(officials));
const mf = JSON.parse(await readFile(new URL("manifest.json", dir), "utf8").catch(() => "{}"));
mf.registry = { source: "위키데이터(Wikidata) SPARQL", license: "CC0 1.0", url: "https://www.wikidata.org/wiki/Q14850694", fetchedAt: new Date().toISOString(), coverage };
await writeFile(new URL("manifest.json", dir), JSON.stringify(mf, null, 1));
console.log(`명부 ${officials.length}명`, coverage);
