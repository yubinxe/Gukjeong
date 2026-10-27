// 로컬 확인용 서버: 정적 파일 + api/**/*.mjs 함수 + 그 밖의 경로(/assets, /api/dashboard)는 운영 사이트로 넘긴다.
//   node scripts/dev.mjs                 → http://localhost:8800/briefing/
//   DEV_FAKE_AI=1 node scripts/dev.mjs   → API 키 없이 AI 화면 상태를 점검(가짜 해석·가짜 답 — 화면 검수 전용, 배포 코드에 없음)
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_ORIGIN, config, getBriefing, insightsFor } from "../api/briefing/_lib.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const PORT = Number(process.env.PORT) || 8800;
const UPSTREAM = process.env.UPSTREAM || DEFAULT_ORIGIN;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };

function fakeClaude() {
  const ids = (text) => [...text.matchAll(/^\[(S\d+)\] (.+)$/gm)].map((m) => ({ id: m[1], title: m[2] }));
  return {
    beta: { messages: {
      async create(p) {
        await new Promise((r) => setTimeout(r, 1200));
        const st = ids(p.messages[0].content);
        const out = {
          lead: `[개발용 가짜 해석] ${st[0]?.title || "오늘"}과 ${st[1]?.title || "시장"}이 오늘 보도의 중심이다.`,
          summary: st.slice(0, 3).map((s) => `[가짜] ${s.title.slice(0, 40)}`),
          stories: st.map((s, i) => ({ id: s.id, topic: i % 2 ? "시장" : "정책", why: `[가짜] 이 소식이 왜 중요한지 설명하는 자리다. 실제 배포에서는 Claude 가 오늘 자료로 쓴다.`, watch: i < 4 ? "[가짜] 다음에 확인할 지표나 일정이 들어가는 자리다." : "", lens: i % 3 === 0 ? "[가짜] 정책·시장과의 연결 경로를 설명하는 자리다." : "" })),
          themes: [{ title: "[가짜] 오늘의 흐름", text: "[가짜] 서로 다른 두 소식을 하나의 흐름으로 잇는 해석이 들어가는 자리다.", stories: st.slice(0, 2).map((s) => s.id) }],
          questions: ["오늘 시장은 왜 움직였나요?", "입법예고 중 생활에 닿는 건?", "해외 언론은 무엇을 다뤘나요?"],
        };
        return { stop_reason: "end_turn", model: "dev-fake", usage: {}, content: [{ type: "text", text: JSON.stringify(out) }] };
      },
      stream(p, { signal } = {}) {
        const st = ids(p.system[1].text);
        const text = `[개발용 가짜 답] **핵심**부터 말씀드리면, ${st[0]?.title || "오늘 소식"}이 가장 넓게 보도됐습니다 [S1].\n\n- 두 번째로 많이 다룬 사안은 ${st[1]?.title || "-"}입니다 [S2].\n- 해석: 실제 배포에서는 Claude 가 오늘 자료로 답합니다.\n\n지난해 12.5%라는 수치처럼 자료에 없는 숫자는 확인 필요로 표시됩니다.`;
        const parts = text.match(/.{1,6}/gsu);
        return {
          async *[Symbol.asyncIterator]() {
            for (const t of parts) {
              if (signal?.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
              await new Promise((r) => setTimeout(r, 30));
              yield { type: "content_block_delta", delta: { type: "text_delta", text: t } };
            }
          },
          async finalMessage() { return { stop_reason: "end_turn" }; },
        };
      },
    } },
  };
}

const fake = process.env.DEV_FAKE_AI === "1";
const routes = {};
async function api(path) {
  if (routes[path]) return routes[path];
  const file = join(ROOT, `${path}.mjs`);
  await stat(file);
  const mod = await import(pathToFileURL(file).href);
  if (fake && mod.createHandler) {
    const cfg = { ...config(), ai: true, model: "dev-fake" };
    const claude = async () => fakeClaude();
    routes[path] = path.endsWith("/today") ? mod.createHandler({ insights: (b) => insightsFor(b, { claude, cfg }) }) : mod.createHandler({ briefing: getBriefing, claude, cfg });
  } else routes[path] = mod.default;
  return routes[path];
}

function vercelish(req, res, url, body) {
  req.query = Object.fromEntries(url.searchParams);
  if (body) { try { req.body = JSON.parse(body); } catch { req.body = body; } }
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { if (!res.getHeader("content-type")) res.setHeader("content-type", "application/json; charset=utf-8"); res.end(JSON.stringify(o)); return res; };
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/") && !url.pathname.split("/").pop().startsWith("_")) {
      const h = await api(url.pathname.replace(/\/$/, "")).catch(() => null);
      if (h) {
        let body = "";
        if (req.method === "POST") for await (const c of req) body += c;
        vercelish(req, res, url, body);
        return await h(req, res);
      }
    }
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    if (p.endsWith("/")) p += "index.html";
    const file = join(ROOT, p);
    if (file.startsWith(ROOT) && !p.includes("node_modules") && !p.split(/[/\\]/).some((seg) => seg.startsWith("."))) {
      const s = await stat(file).catch(() => null);
      if (s?.isFile()) { res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream", "cache-control": "no-store" }); return res.end(await readFile(file)); }
    }
    const up = await fetch(UPSTREAM + url.pathname + url.search);
    res.writeHead(up.status, { "content-type": up.headers.get("content-type") || "application/octet-stream" });
    res.end(Buffer.from(await up.arrayBuffer()));
  } catch (e) {
    if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end(String(e?.message || e));
  }
}).listen(PORT, () => console.log(`http://localhost:${PORT}/briefing/${fake ? "  (가짜 AI)" : ""}`));
