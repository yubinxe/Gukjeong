// 이름: '국정 한눈에' → '국정 상황판' (2026-11-24)
// 조사를 받침에 맞춘다: '한눈에'는 받침 없이 끝나고 '상황판'은 ㄴ 받침으로 끝난다 → 는→은 · 가→이 · 를→을 · 와→과 · 로→으로.
// 주소(gukjeong-hannune.vercel.app)는 배포 도메인이라 그대로 둔다.
export const OLD = "국정 한눈에", NEW = "국정 상황판";
const JOSA = { 는: "은", 가: "이", 를: "을", 와: "과", 로: "으로", 라는: "이라는", 라고: "이라고", 야: "이야", 랑: "이랑" };
// 이름이 바뀌면 겹치거나 어색해지는 문구
const PHRASES = [
  ["국정 한눈에 — 국민용 국정 상황판", "국정 상황판 — 국민용 국정·경제 정보 화면"],
  ['<span class="brand-sub">국정·경제 상황판 · ', '<span class="brand-sub">국정·경제를 한눈에 · '],
];
export function rebrand(text) {
  let out = text;
  for (const [a, b] of PHRASES) out = out.split(a).join(b);
  return out.replace(/국정 한눈에(라는|라고|는|가|를|와|로|야|랑)?/g, (_, j) => NEW + (j ? JOSA[j] : "")); // 의·도·만·에서 등은 받침과 무관
}
