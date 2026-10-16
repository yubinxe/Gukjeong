// 홈 화면 '오늘의 분기점' 진입 위젯 — 기존 홈 HTML 에 두 줄만 추가:
//   <section id="outlook-entry" aria-label="오늘의 분기점"></section>
//   <script type="module" src="/outlook/entry.js"></script>
// 기존 화면 스타일을 건드리지 않도록 스타일은 이 위젯 안에서만 정의한다.
import { rankIssues } from "./lib/engine.mjs";

const box = document.getElementById("outlook-entry");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
async function list() {
  try { const r = await fetch("/api/outlook/issues"); if (r.ok) return (await r.json()).issues; } catch (e) { /* 정적 대체 */ }
  return rankIssues([await fetch("/outlook/data/nps-rebalancing-2026.json").then((r) => r.json())]);
}
if (box) list().then((items) => {
  const top = items.filter((i) => !i.stale).slice(0, 3);
  if (!top.length) { box.hidden = true; return; }
  box.innerHTML = `<style>#outlook-entry{border:1px solid rgba(127,127,127,.3);border-left:3px solid #1f6b4f;padding:14px 16px;margin:16px 0}
#outlook-entry .oe-k{font-size:12px;font-weight:700;letter-spacing:.08em;color:#1f6b4f;margin:0 0 6px}#outlook-entry a{display:block;text-decoration:none;color:inherit;padding:8px 0;border-top:1px solid rgba(127,127,127,.2)}
#outlook-entry a:first-of-type{border-top:0}#outlook-entry b{display:block}#outlook-entry span{font-size:13px;opacity:.8}</style>
<p class="oe-k">오늘의 분기점</p>${top.map((i) => `<a href="/outlook/?id=${encodeURIComponent(i.id)}"><b>${esc(i.title)}</b><span>${esc(i.keyCondition || i.verdict)}</span></a>`).join("")}`;
}).catch(() => { box.hidden = true; });
