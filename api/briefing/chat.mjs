// POST /api/briefing/chat  { messages: [{role, content}], quote?: {link, title} }  → text/event-stream
//   event: meta   { basis, ai, stories: [{id, link, title}] }  답에 붙는 [S번호]를 화면의 소식과 잇는 표
//   event: delta  { t }                                        답 조각
//   event: done   { cited, unverified, stop }                  인용한 소식 · 자료에서 확인되지 않은 수치
//   event: error  { message }
// 오늘 수집된 자료만 근거로 답한다. AI 키가 없으면 소식 찾기 결과로 답한다.
import { citedIds, digestText, numberSet, searchStories, ungrounded } from "../../briefing/lib/compose.mjs";
import { CHAT_SYSTEM, FALLBACK_BETA, clientIp, config, getBriefing, getClaude, normalizeMessages, rateLimit, readJson, sameOrigin } from "./_lib.mjs";

function fallbackAnswer(b, question) {
  const ids = searchStories(b, question);
  if (!ids.length) return "지금은 AI 답변이 꺼져 있어 오늘 수집된 소식에서만 찾아봤습니다. 질문과 맞는 소식을 찾지 못했습니다. 다른 낱말로 물어봐 주세요.";
  const by = Object.fromEntries(b.stories.map((s) => [s.id, s]));
  return `지금은 AI 답변이 꺼져 있어 오늘 수집된 소식에서 찾은 결과만 보여 드립니다.\n${ids.map((id) => `- ${by[id].title} (언론 ${by[id].outlets}곳) [${id}]`).join("\n")}`;
}

export function createHandler({ briefing = getBriefing, claude = getClaude, cfg = config() } = {}) {
  return async function handler(req, res) {
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "POST 만 받습니다" }); }
    if (!sameOrigin(req)) return res.status(403).json({ error: "이 사이트 안에서만 쓸 수 있습니다" });
    const rl = rateLimit(clientIp(req), cfg.chatPer5Min);
    if (!rl.ok) { res.setHeader("Retry-After", String(rl.retryAfter)); return res.status(429).json({ error: "질문이 너무 잦습니다. 잠시 뒤에 다시 물어봐 주세요.", retryAfter: rl.retryAfter }); }

    let body;
    try { body = await readJson(req); } catch { return res.status(400).json({ error: "요청 형식이 올바르지 않습니다" }); }
    const norm = normalizeMessages(body?.messages);
    if (norm.error) return res.status(400).json({ error: norm.error });
    let b;
    try { b = await briefing(); } catch { return res.status(502).json({ error: "오늘 자료를 불러오지 못했습니다" }); }

    const messages = norm.messages;
    const last = messages[messages.length - 1];
    const q = body?.quote && typeof body.quote === "object" ? body.quote : null;
    if (q) {
      const s = b.stories.find((x) => x.link === q.link);
      last.content = `(인용한 소식: ${s ? `[${s.id}] ${s.title}` : String(q.title || "").slice(0, 120)})\n${last.content}`;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();
    const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send("meta", { basis: b.basis, ai: cfg.ai, stories: b.stories.map((s) => ({ id: s.id, link: s.link, title: s.title })) });

    if (!cfg.ai) {
      const text = fallbackAnswer(b, last.content);
      send("delta", { t: text });
      send("done", { cited: citedIds(text, b), unverified: [], stop: "fallback" });
      return res.end();
    }

    const digest = digestText(b);
    const ac = new AbortController();
    res.on?.("close", () => { if (!res.writableEnded) ac.abort(); });
    let text = "";
    try {
      const stream = (await claude()).beta.messages.stream({
        model: cfg.model,
        max_tokens: 8000,
        betas: [FALLBACK_BETA],
        fallbacks: "default",
        output_config: { effort: cfg.chatEffort },
        // 지침(고정) → 오늘의 자료(판 단위로 고정, 캐시 지점) → 대화 순서. 질문마다 바뀌는 것은 뒤에 둔다.
        system: [
          { type: "text", text: CHAT_SYSTEM },
          { type: "text", text: `[오늘의 자료]\n${digest}`, cache_control: { type: "ephemeral" } },
        ],
        messages,
      }, { signal: ac.signal });
      for await (const ev of stream) {
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") { text += ev.delta.text; send("delta", { t: ev.delta.text }); }
      }
      const final = await stream.finalMessage();
      if (final.stop_reason === "refusal") { send("error", { message: "이 질문에는 답할 수 없습니다. 오늘 소식에 관한 다른 질문을 해 주세요.", refusal: true }); return res.end(); }
      // 답에 나온 숫자가 오늘 자료·질문 어디에도 없으면 화면에 '확인 필요'로 표시한다.
      const corpus = numberSet(`${digest}\n${messages.map((m) => m.content).join("\n")}`);
      send("done", { cited: citedIds(text, b), unverified: ungrounded(text, corpus).slice(0, 6), stop: final.stop_reason });
    } catch (e) {
      if (!ac.signal.aborted) send("error", { message: "답을 만드는 중 문제가 생겼습니다. 잠시 뒤 다시 시도해 주세요." });
    }
    res.end();
  };
}

export default createHandler();
