// GET /api/outlook/forecast-performance — 판정 완료 예측만 집계. 표본 수·기간을 항상 함께 준다.
import { ISSUES } from "../../outlook/data/index.mjs";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "public, s-maxage=3600");
  const all = ISSUES.flatMap((d) => d.forecasts || []);
  const resolved = all.filter((f) => f.actual_outcome !== null && f.actual_outcome !== undefined);
  const scored = resolved.filter((f) => typeof f.forecast_value === "number");
  const brier = scored.length ? scored.reduce((a, f) => a + (f.forecast_value - (f.actual_outcome ? 1 : 0)) ** 2, 0) / scored.length : null;
  res.status(200).json({
    registered: all.length, resolved: resolved.length, withProbability: scored.length,
    brier, note: resolved.length < 30 ? "판정 표본이 30건 미만 — 성능을 주장하지 않는다" : null,
    period: all.length ? { from: all.map((f) => f.created_at).sort()[0], to: new Date().toISOString().slice(0, 10) } : null,
  });
}
