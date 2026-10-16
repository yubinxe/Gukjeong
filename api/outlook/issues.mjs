// GET /api/outlook/issues                     → 오늘의 분기점 목록
// GET /api/outlook/issues?id=ID               → 상세(전체)
// GET /api/outlook/issues?id=ID&view=evidence|scenarios|consensus|history|forecasts
// GET /api/outlook/issues?id=ID&asOf=YYYY-MM-DD → 사후 재구성(당시 공개 자료만)
// 읽기 전용. 페이지 요청이 LLM·외부 수집을 일으키지 않는다(저장된 분석만 반환).
import { ISSUES } from "../../outlook/data/index.mjs";
import { rankIssues, replayView, evidenceStats } from "../../outlook/lib/engine.mjs";

const VIEWS = { evidence: "evidence", scenarios: "scenarios", consensus: "consensus", forecasts: "forecasts" };

export default function handler(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "읽기 전용" }); }
  res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=86400");
  const { id, view, asOf } = req.query || {};
  if (!id) return res.status(200).json({ generatedAt: new Date().toISOString(), issues: rankIssues(ISSUES) });
  const doc = ISSUES.find((d) => d.issue.id === id);
  if (!doc) return res.status(404).json({ error: "이슈 없음" });
  if (asOf) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return res.status(400).json({ error: "asOf 형식 YYYY-MM-DD" });
    return res.status(200).json({ issue: doc.issue, replay: replayView(doc, asOf) });
  }
  if (view === "history") return res.status(200).json({ issue: doc.issue, replay: doc.replay, forecasts: doc.forecasts });
  if (view && VIEWS[view]) return res.status(200).json({ issue: doc.issue, [view]: doc[VIEWS[view]] });
  return res.status(200).json({ ...doc, stats: evidenceStats(doc) });
}
