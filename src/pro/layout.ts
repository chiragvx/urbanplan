// A plotted layout: converted land divided into plots to sell, with internal roads, the open space and (on big
// layouts) the amenity space set aside. Worked in the frame of the edge on the access road (u along it, v into the
// land):
// - internal roads run in from the access road, spaced so a row of plots backs onto a row on each side
//   (two plot depths and a road apart); on deep land cross roads tie them together every so often;
// - plots face the internal roads, `plotW` along them and `plotD` deep, each cut to the land's outline;
// - pieces too small or too odd to sell are left over;
// - the open space (openPct of the land) and the amenity space (amenityPct) are taken from the left-over pieces
//   big enough to use, then from whole plots, the open space from the middle of the layout and the amenity space
//   from the front, where it's easy to reach.
// Robust for any outline (convex or not), not optimal: a starting layout to adjust.
import { area as mpArea, diff, fromFlat, inter, outlines, union, type MP } from '../doc/ground';

export interface LayoutOpts {
  /** a plot's frontage on its road and its depth (m) */
  plotW: number; plotD: number;
  /** internal roads' width (m) */
  roadW: number;
  /** open space and amenity space as % of the land (UDCPR asks 10 % open on layouts, amenity on big ones) */
  openPct: number; amenityPct: number;
}
export interface PlotLayout {
  plots: number[][]; roads: number[][]; open: number[][]; amenity: number[][];
  stats: { area: number; plots: number; saleable: number; roads: number; open: number; amenity: number; avgPlot: number };
}

/** UDCPR-style defaults: 9 m roads, 10 % open space, 5 % amenity space on layouts of 2 ha and more */
export const layoutDefaults = (area: number): LayoutOpts => ({ plotW: 12, plotD: 20, roadW: 9, openPct: 10, amenityPct: area >= 20000 ? 5 : 0 });

const ringArea = (r: number[]) => { let a = 0; for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; a += r[i] * r[j + 1] - r[j] * r[i + 1]; } return Math.abs(a / 2); };
const centroid = (r: number[]): [number, number] => { let x = 0, z = 0; for (let i = 0; i < r.length; i += 2) { x += r[i]; z += r[i + 1]; } return [x / (r.length / 2), z / (r.length / 2)]; };
/** the piece's narrowest extent along u and v (to tell a usable piece from a sliver) */
const pieces = (m: MP) => outlines(m).filter((r) => ringArea(r) > 0.5);

export function plotLayout(ring: number[], frontEdge: number, o: LayoutOpts): PlotLayout {
  const n = ring.length / 2, k = ((frontEdge % n) + n) % n;
  const ax = ring[2 * k], az = ring[2 * k + 1], bx = ring[(2 * k + 2) % ring.length], bz = ring[(2 * k + 3) % ring.length];
  const L = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / L, uz = (bz - az) / L;
  // v into the land
  const [cx, cz] = centroid(ring);
  let vx = -uz, vz = ux;
  if ((cx - ax) * vx + (cz - az) * vz < 0) { vx = -vx; vz = -vz; }
  const toL = (x: number, z: number): [number, number] => [(x - ax) * ux + (z - az) * uz, (x - ax) * vx + (z - az) * vz];
  const toW = (u: number, v: number): [number, number] => [ax + ux * u + vx * v, az + uz * u + vz * v];
  const rect = (u0: number, v0: number, u1: number, v1: number): MP => fromFlat([...toW(u0, v0), ...toW(u1, v0), ...toW(u1, v1), ...toW(u0, v1)]);
  let u0 = Infinity, u1 = -Infinity, v1 = 0;
  for (let i = 0; i < ring.length; i += 2) { const [u, v] = toL(ring[i], ring[i + 1]); u0 = Math.min(u0, u); u1 = Math.max(u1, u); v1 = Math.max(v1, v); }
  const land = fromFlat(ring), total = mpArea(land);
  const { plotW: W, plotD: D, roadW: R } = o;

  // internal roads in from the access road, a plot depth from the land's side and then every two plot depths
  const lanes: number[] = [];
  for (let u = u0 + D + R / 2; u < u1 - D * 0.6; u += 2 * D + R) lanes.push(u);
  // deep land: cross roads every ~150 m, and one along the back so the lanes don't dead-end
  const cross: number[] = [];
  if (v1 > 160) for (let v = 150; v < v1 - 40; v += 150) cross.push(v);
  let roads: MP = union(...lanes.map((u) => rect(u - R / 2, -1, u + R / 2, v1 + 1)), ...cross.map((v) => rect(u0 - 1, v - R / 2, u1 + 1, v + R / 2)));
  roads = inter(roads, land);

  // plots: columns either side of each lane, cut every W along it
  const plotsAll: { ring: number[]; at: [number, number] }[] = [];
  const cols: [number, number][] = [];
  for (const u of lanes) { cols.push([u - R / 2 - D, u - R / 2], [u + R / 2, u + R / 2 + D]); }
  // no lanes (narrow land): one column of plots facing the access road
  const facesFront = !lanes.length;
  const sellable = (m: MP) => { const a = mpArea(m); return a >= 0.6 * W * D ? a : 0; };
  if (facesFront) {
    for (let u = u0; u < u1 - 1; u += W) {
      const cell = diff(inter(rect(u, 0, Math.min(u + W, u1), D), land), roads);
      for (const p of pieces(cell)) if (sellable(fromFlat(p))) plotsAll.push({ ring: p, at: centroid(p) });
    }
  } else {
    for (const [ca, cb] of cols) {
      for (let v = 0; v < v1; v += W) {
        const cell = diff(inter(rect(ca, v, cb, v + W), land), roads);
        for (const p of pieces(cell)) if (sellable(fromFlat(p))) plotsAll.push({ ring: p, at: centroid(p) });
      }
    }
  }

  // what's left over, and the pieces of it big enough to be open or amenity space (~ a plot, at least 7.5 m across)
  const used = union(roads, ...plotsAll.map((p) => fromFlat(p.ring)));
  const left = pieces(diff(land, used)).map((r) => ({ ring: r, a: ringArea(r), at: centroid(r) })).filter((x) => x.a >= 0.5 * W * D);
  const openNeed = (total * o.openPct) / 100, amenNeed = (total * o.amenityPct) / 100;
  const open: number[][] = [], amenity: number[][] = [];
  let openHave = 0, amenHave = 0;
  // open space from the middle, amenity from the front
  const [mu, mv] = toL(cx, cz);
  const byMiddle = (at: [number, number]) => { const [u, v] = toL(at[0], at[1]); return Math.hypot(u - mu, v - mv); };
  const byFront = (at: [number, number]) => toL(at[0], at[1])[1];
  for (const x of [...left].sort((p, q) => q.a - p.a)) {
    if (openHave < openNeed) { open.push(x.ring); openHave += x.a; } else if (amenHave < amenNeed) { amenity.push(x.ring); amenHave += x.a; }
  }
  let plots = [...plotsAll];
  if (openHave < openNeed) {
    plots.sort((p, q) => byMiddle(p.at) - byMiddle(q.at));
    while (openHave < openNeed && plots.length) { const p = plots.shift()!; open.push(p.ring); openHave += ringArea(p.ring); }
  }
  if (amenHave < amenNeed) {
    plots.sort((p, q) => byFront(p.at) - byFront(q.at));
    while (amenHave < amenNeed && plots.length) { const p = plots.shift()!; amenity.push(p.ring); amenHave += ringArea(p.ring); }
  }
  // (open space taken from plots: merged into one piece where they touch)
  const openM = pieces(union(...open.map(fromFlat))), amenM = pieces(union(...amenity.map(fromFlat)));
  const saleable = plots.reduce((s, p) => s + ringArea(p.ring), 0);
  const roadRings = pieces(roads);
  return {
    plots: plots.map((p) => p.ring), roads: roadRings, open: openM, amenity: amenM,
    stats: {
      area: total, plots: plots.length, saleable, roads: mpArea(roads),
      open: openM.reduce((s, r) => s + ringArea(r), 0), amenity: amenM.reduce((s, r) => s + ringArea(r), 0),
      avgPlot: plots.length ? saleable / plots.length : 0,
    },
  };
}
