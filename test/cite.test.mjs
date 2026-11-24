// 학술 활용: 인용 형식 · CSV · 이름 변경(조사) · 선거 자료 내보내기 정합
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { apa, korean, bibtex, ris, csv, kst, citeKey, normalize } from "../cite/lib.mjs";
import { rebrand } from "../scripts/brand.mjs";

const meta = { title: "선거 후 시장", sub: "코스피 · 전국 단위 선거", kind: "visualization", url: "https://gukjeong-hannune.vercel.app/elections/?k=P", issued: "2026-11-14T06:31:00Z", accessed: "2026-11-24T02:00:00Z", version: "자료 1990-01-04~2026-11-13" };

test("APA 7판: 저자. (연, 월 일). 제목 [형식]. 사이트. 검색일, 주소", () => {
  assert.equal(apa(meta), "김유빈. (2026, 11월 14일). 선거 후 시장: 코스피 · 전국 단위 선거 [데이터 시각화, 자료 1990-01-04~2026-11-13]. 국정 상황판. 2026년 11월 24일 검색, https://gukjeong-hannune.vercel.app/elections/?k=P");
  assert.match(apa({ ...meta, issued: undefined }), /\(n\.d\.\)/, "날짜 없으면 n.d.");
});

test("국내 학술지(각주): 실시간 화면은 기준 시각(한국 시각)까지, 자료 세트는 날짜만", () => {
  assert.equal(korean({ ...meta, kind: "webpage" }), "김유빈, 「선거 후 시장: 코스피 · 전국 단위 선거」, 『국정 상황판』, 2026. 11. 14. 15:31 기준, https://gukjeong-hannune.vercel.app/elections/?k=P (검색일: 2026. 11. 24.).");
  assert.match(korean({ ...meta, kind: "dataset" }), /2026\. 11\. 14\. 기준,/);
});

test("한국 시각 변환: 자정 넘김", () => {
  assert.deepEqual(kst("2026-11-23T16:30:00Z"), { y: 2026, m: 11, d: 24, h: 1, mi: 30 });
});

test("BibTeX: 특수문자 이스케이프 · 주소는 그대로 · 키 안정", () => {
  const b = bibtex({ ...meta, title: "R&D 100% 점검_1" });
  assert.match(b, /^@misc\{gukjeong_elections_20261114,/);
  assert.match(b, /title = \{R\\&D 100\\% 점검\\_1: /);
  assert.match(b, /url = \{https:\/\/gukjeong-hannune\.vercel\.app\/elections\/\?k=P\}/);
  assert.match(b, /urldate = \{2026-11-24\}/);
  assert.match(b, /^  author = \{\{김유빈\}\},$/m, "저자는 이중 중괄호, 이스케이프 없음");
  assert.equal(citeKey({ ...meta, url: "https://x.app/" }), "gukjeong_home_20261114");
  // 중괄호 짝
  assert.equal((b.match(/\{/g) || []).length, (b.match(/\}/g) || []).length);
});

test("RIS: 태그 형식 'XX  - ' · CRLF · ER 로 끝남 · 자료 세트는 DATA", () => {
  const r = ris(meta);
  const lines = r.trimEnd().split("\r\n");
  for (const l of lines) assert.match(l, /^[A-Z][A-Z0-9]  -( |$)/, l);
  assert.equal(lines[0], "TY  - ELEC"); assert.equal(lines.at(-1), "ER  -");
  assert.ok(lines.includes("Y2  - 2026/11/24") && lines.includes("DA  - 2026/11/14"));
  assert.equal(ris({ ...meta, kind: "dataset" }).split("\r\n")[0], "TY  - DATA");
});

test("필수 정보가 없으면 만들지 않는다", () => {
  assert.throws(() => normalize({ url: "x" }), /제목/);
  assert.throws(() => apa({ title: "x" }), /주소/);
});

test("CSV: BOM · CRLF · 쉼표/따옴표/줄바꿈 인용 (RFC 4180)", () => {
  const out = csv([["a", "b,c"], ['say "hi"', "x\ny"], [null, 3]]);
  assert.equal(out, '﻿a,"b,c"\r\n"say ""hi""","x\ny"\r\n,3\r\n');
});

test("이름 변경: 받침에 맞춘 조사 · 겹치는 문구 정리 · 두 번 해도 같다", () => {
  const cases = [["국정 한눈에는 비영리", "국정 상황판은 비영리"], ["국정 한눈에를", "국정 상황판을"], ["국정 한눈에와", "국정 상황판과"], ["국정 한눈에가", "국정 상황판이"], ["국정 한눈에로", "국정 상황판으로"], ["국정 한눈에의", "국정 상황판의"], ["[국정 한눈에]", "[국정 상황판]"]];
  for (const [a, b] of cases) assert.equal(rebrand(a), b);
  assert.equal(rebrand("국정 한눈에 — 국민용 국정 상황판"), "국정 상황판 — 국민용 국정·경제 정보 화면");
  assert.equal(rebrand('<span class="brand-sub">국정·경제 상황판 · 정부'), '<span class="brand-sub">국정·경제를 한눈에 · 정부');
  const once = rebrand("국정 한눈에는 국정 한눈에를");
  assert.equal(rebrand(once), once);
});

test("저장소 화면 파일에 옛 이름이 남지 않았다(운영 원본 고정 자료 제외)", async () => {
  for (const f of ["briefing/index.html", "officials/index.html", "elections/index.html", "core/core.js", "scripts/og/render.mjs", "api/briefing/_lib.mjs"]) {
    const t = await readFile(new URL(`../${f}`, import.meta.url), "utf8");
    assert.ok(!t.includes("국정 한눈에"), f);
  }
});
