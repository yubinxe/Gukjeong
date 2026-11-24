// 국정 상황판 · 인용 형식 (의존성 0, 브라우저·Node 공용) — 테스트는 test/cite.test.mjs
// 바뀌는 화면(실시간 상황판)을 인용할 때는 '자료 기준 시각'과 '열람일'을 함께 적어야 다시 찾을 수 있다.
// meta: { title, sub?, kind('dataset'|'visualization'|'webpage'), author, site, url, issued?(ISO, 자료 기준 시각), accessed?(ISO), version?, note? }

export const SITE = "국정 상황판";
export const AUTHOR = "김유빈";
const KIND = { dataset: "데이터 세트", visualization: "데이터 시각화", webpage: "웹 페이지" };

const pad = (n) => String(n).padStart(2, "0");
// 한국 시각 기준 날짜(열람일·자료 기준일은 국내 독자 기준)
export function kst(iso) {
  const d = new Date(Date.parse(iso) + 9 * 3600e3);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() };
}
const ymdKo = (t) => `${t.y}년 ${t.m}월 ${t.d}일`;
const ymdDot = (t) => `${t.y}. ${t.m}. ${t.d}.`;
const hm = (t) => `${pad(t.h)}:${pad(t.mi)}`;
const fullTitle = (m) => (m.sub ? `${m.title}: ${m.sub}` : m.title);
// 자료 기준이 시각까지 의미 있는 화면(실시간)인지
const withTime = (m) => m.issued && /T\d{2}:\d{2}/.test(m.issued) && m.kind !== "dataset";

export function normalize(meta, now = new Date().toISOString()) {
  if (!meta?.title || !meta?.url) throw new Error("인용 정보에 제목과 주소가 필요합니다");
  return { kind: "webpage", author: AUTHOR, site: SITE, accessed: now, ...meta };
}

// APA 7판(국문 표기): 저자. (연, 월 일). 제목 [형식]. 사이트명. 검색일, URL
export function apa(meta) {
  const m = normalize(meta), a = kst(m.accessed);
  const date = m.issued ? (() => { const t = kst(m.issued); return `${t.y}, ${t.m}월 ${t.d}일`; })() : "n.d.";
  const ver = m.version ? `, ${m.version}` : "";
  return `${m.author}. (${date}). ${fullTitle(m)} [${KIND[m.kind] || KIND.webpage}${ver}]. ${m.site}. ${ymdKo(a)} 검색, ${m.url}`;
}
// 국내 학술지 일반(각주형): 저자, 「제목」, 『사이트』, 자료 기준, URL (검색일: 연. 월. 일.).
export function korean(meta) {
  const m = normalize(meta), a = kst(m.accessed);
  const basis = m.issued ? (() => { const t = kst(m.issued); return `, ${ymdDot(t)}${withTime(m) ? ` ${hm(t)}` : ""} 기준`; })() : "";
  return `${m.author}, 「${fullTitle(m)}」, 『${m.site}』${basis}, ${m.url} (검색일: ${ymdDot(a)}).`;
}
const bibEsc = (s) => String(s).replace(/([{}%&#_$])/g, "\\$1");
export function citeKey(meta) {
  const m = normalize(meta), t = kst(m.issued || m.accessed);
  const slug = (m.key || m.url.replace(/^https?:\/\/[^/]+\//, "").replace(/[?#].*$/, "").replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") || "home").toLowerCase();
  return `gukjeong_${slug}_${t.y}${pad(t.m)}${pad(t.d)}`;
}
export function bibtex(meta) {
  const m = normalize(meta), a = kst(m.accessed), t = m.issued ? kst(m.issued) : null;
  const f = [
    ["author", `{${bibEsc(m.author)}}`], ["title", fullTitle(m)], ["howpublished", m.site], t && ["year", String(t.y)], t && ["month", String(t.m)],
    ["url", m.url], ["urldate", `${a.y}-${pad(a.m)}-${pad(a.d)}`],
    m.version && ["version", m.version], ["note", [KIND[m.kind], m.issued && `자료 기준 ${ymdDot(kst(m.issued))}${withTime(m) ? ` ${hm(kst(m.issued))} (한국 시각)` : ""}`, m.note].filter(Boolean).join(". ")],
  ].filter(Boolean);
  return `@misc{${citeKey(m)},\n${f.map(([k, v]) => `  ${k} = {${k === "url" || k === "author" ? v : bibEsc(v)}}`).join(",\n")}\n}`; // 저자는 {{…}}로 감싸 성·이름으로 나누지 않게(기관·한글 이름)
}
// RIS: Zotero · EndNote · Mendeley 가져오기용. 데이터 세트는 DATA, 그 밖은 ELEC(전자 자료)
export function ris(meta) {
  const m = normalize(meta), a = kst(m.accessed), t = m.issued ? kst(m.issued) : null;
  const L = [
    ["TY", m.kind === "dataset" ? "DATA" : "ELEC"], ["AU", m.author], ["TI", fullTitle(m)], ["T2", m.site],
    t && ["PY", String(t.y)], t && ["DA", `${t.y}/${pad(t.m)}/${pad(t.d)}`], ["UR", m.url], ["Y2", `${a.y}/${pad(a.m)}/${pad(a.d)}`],
    ["LA", "ko"], m.version && ["ET", m.version], m.note && ["N1", m.note], ["ER", ""],
  ].filter(Boolean);
  return L.map(([k, v]) => `${k}  - ${v}`.trimEnd()).join("\r\n") + "\r\n";
}
export const FORMATS = [
  { id: "apa", name: "APA 7판", fn: apa },
  { id: "korean", name: "국내 학술지(각주)", fn: korean },
  { id: "bibtex", name: "BibTeX", fn: bibtex, file: "bib", mime: "application/x-bibtex" },
  { id: "ris", name: "RIS", fn: ris, file: "ris", mime: "application/x-research-info-systems" },
];

// 표 → CSV (엑셀 한글 깨짐 방지: UTF-8 BOM, 줄바꿈 CRLF, 큰따옴표 규칙 RFC 4180)
export function csv(rows) {
  const cell = (v) => { if (v == null) return ""; const s = String(v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return "﻿" + rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
