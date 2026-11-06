// TopoJSON → GeoJSON (양자화 델타 부호화 해제). 지도 경계 하나를 위해 외부 라이브러리를 싣지 않는다.
export function feature(topo, name) {
  const t = topo.transform;
  const arcs = topo.arcs.map((arc) => {
    let x = 0, y = 0;
    return arc.map(([dx, dy]) => (t ? [(x += dx) * t.scale[0] + t.translate[0], (y += dy) * t.scale[1] + t.translate[1]] : [dx, dy]));
  });
  const ring = (idx) => {
    const out = [];
    for (const i of idx) {
      const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
      out.push(...(out.length ? a.slice(1) : a));
    }
    return out;
  };
  const geometry = (g) => (g.type === "Polygon" ? { type: "Polygon", coordinates: g.arcs.map(ring) }
    : g.type === "MultiPolygon" ? { type: "MultiPolygon", coordinates: g.arcs.map((p) => p.map(ring)) } : null);
  return {
    type: "FeatureCollection",
    features: topo.objects[name].geometries.map((g) => ({ type: "Feature", properties: { ...g.properties }, geometry: geometry(g) })).filter((f) => f.geometry),
  };
}

// 경계 상자 · 가장 넓은 고리의 무게중심(라벨 자리)
export function bbox(f) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const p of polys) for (const [x, y] of p[0]) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}
export function labelPoint(f) {
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  let best = null, bestA = 0;
  for (const p of polys) {
    const r = p[0];
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const k = r[j][0] * r[i][1] - r[i][0] * r[j][1]; a += k; cx += (r[j][0] + r[i][0]) * k; cy += (r[j][1] + r[i][1]) * k; }
    if (Math.abs(a) > bestA) { bestA = Math.abs(a); best = [cx / (3 * a), cy / (3 * a)]; }
  }
  return best;
}
