// GET /api/briefing/today          → 오늘의 브리핑(사실 층 + AI 해석)
// GET /api/briefing/today?facts=1  → 사실 층만(첫 화면을 빨리 그릴 때)
// 해석은 판(아침·오후·저녁)과 상위 사안 구성이 바뀔 때만 새로 쓴다. CDN 이 10분 묶어 두고, 지난 판으로 버티며 다시 만든다.
import { getBriefing, insightsFor } from "./_lib.mjs";

export function createHandler({ briefing = getBriefing, insights = insightsFor } = {}) {
  return async function handler(req, res) {
    if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "읽기 전용" }); }
    let b;
    try { b = await briefing(); } catch (e) {
      res.setHeader("Cache-Control", "no-store");
      return res.status(502).json({ error: "수집 원천을 불러오지 못했습니다" });
    }
    if (req.query?.facts) {
      res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=1800");
      return res.status(200).json({ ...b, insights: null, ai: { status: "skipped" } });
    }
    const r = await insights(b);
    const { insights: ins = null, ...ai } = r;
    const settled = ai.status === "ok" || ai.status === "off";
    res.setHeader("Cache-Control", settled ? "public, s-maxage=600, stale-while-revalidate=3600" : "public, s-maxage=60, stale-while-revalidate=600");
    return res.status(200).json({ ...b, insights: ins, ai: { ...ai, dropped: ai.dropped?.length || 0 } });
  };
}

export default createHandler();
