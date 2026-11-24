// The utilities on the plot as one network: power lines run between poles (a pole or a transformer), a well, a water
// tank; a line can meet another line. A join is where things are, not a stored link: a line's node put on a pole
// (snapping takes it there exactly) is joined to it, and so is a node on another line's node. So:
// - what a utility snaps to: every point thing's middle, every line's nodes (the power lines', the roads', the walls'),
//   the lines and the roads' edges, the areas' corners and edges (`netTargets`), on top of the plot and the buildings;
// - moving a pole or a tank takes the line nodes on it along (`carry`), and dragging a line's node takes the other
//   lines' nodes joined there (a junction stays one);
// - a pole put down on a line, or a line's node put on another line, gives that line a node there (`joinOnto`), so
//   they're joined from then on.
// Pure: no view, no DOM (tests: tools/dev/test-utilities.ts).
import { elementRings, nodesOf, type SiteElement } from '../doc/site';
import { featureOf, type SiteFeature } from './siteObjects';

export type Pt = [number, number];
/** how near two points are to count as one (m): snapped points sit exactly on each other, rounded to the cm */
export const JOIN = 0.05;
/** a pole's height as the scene draws it (m: ./scene.ts), to pick it by its post */
export const POLE_H = 9;
const r2 = (x: number) => Math.round(x * 100) / 100;
const near = (ax: number, az: number, b: Pt) => Math.hypot(ax - b[0], az - b[1]) < JOIN;
const nearAny = (x: number, z: number, at?: Pt[]) => !!at?.some((q) => near(x, z, q));

export const isLine = (f: SiteFeature) => featureOf(f.kind).shape === 'line';
/** where a point thing stands: a pole's, a well's or a tree's middle; a tank's or a roundabout's */
export function hubOf(x: SiteFeature | SiteElement): Pt | null {
  if ('pts' in x) return featureOf(x.kind).shape === 'point' && x.pts.length >= 2 ? [x.pts[0], x.pts[1]] : null;
  if ((x.kind === 'tank' || x.kind === 'roundabout') && x.spine.length >= 4) return [(x.spine[0] + x.spine[2]) / 2, (x.spine[1] + x.spine[3]) / 2];
  return null;
}

/** What a utility's points snap to besides the plot and the buildings (see the top of the file). `ex`: the thing
 *  being moved, left out; `at`: spots being moved off, so the line nodes joined there (they go along) aren't targets,
 *  nor a line's segment from there; a pole or a tank there still is (it stays). */
export function netTargets(fs: SiteFeature[], els: SiteElement[], o: { ex?: string; at?: Pt[] } = {}): { pts: number[]; segs: number[] } {
  const pts: number[] = [], segs: number[] = [];
  const pt = (x: number, z: number) => { if (!nearAny(x, z, o.at)) pts.push(x, z); };
  const seg = (ax: number, az: number, bx: number, bz: number) => { if (!nearAny(ax, az, o.at) && !nearAny(bx, bz, o.at) && Math.hypot(bx - ax, bz - az) > 1e-6) segs.push(ax, az, bx, bz); };
  const path = (p: number[], closed: boolean, nodes = true) => {
    for (let i = 0; i + 1 < p.length; i += 2) {
      if (nodes) pt(p[i], p[i + 1]);
      const j = i + 2 < p.length ? i + 2 : closed ? 0 : -1;
      if (j >= 0 && j !== i) seg(p[i], p[i + 1], p[j], p[j + 1]);
    }
  };
  for (const f of fs) {
    if (f.id === o.ex) continue;
    const s = featureOf(f.kind).shape;
    if (s === 'point') { const h = hubOf(f); if (h) pts.push(h[0], h[1]); }
    else path(f.pts, s === 'area');
  }
  for (const e of els) {
    if (e.id === o.ex) continue;
    const h = hubOf(e);
    if (h) { pts.push(h[0], h[1]); continue; }
    if (e.kind === 'road' || e.kind === 'wall') {
      // (its line's nodes and the line itself; a road's edges too)
      path(e.spine, false, false); const n = nodesOf(e); for (let i = 0; i + 1 < n.length; i += 2) pt(n[i], n[i + 1]);
      if (e.kind === 'road') for (const q of elementRings(e)) path(q, true, false);
    } else if (e.kind === 'gate') path(e.spine, false);
  }
  return { pts, segs };
}

/** The features with every line node at one of `from` moved by (dx, dz): what's joined there goes along. `ex`: a
 *  feature already moved (left as it is). */
export function carry(fs: SiteFeature[], from: Pt[], dx: number, dz: number, ex?: string): SiteFeature[] {
  if (!from.length || (!dx && !dz)) return fs;
  return fs.map((f) => {
    if (f.id === ex || !isLine(f)) return f;
    let hit = false;
    const pts = f.pts.map((v, i) => {
      const k = i - (i % 2);
      if (!nearAny(f.pts[k], f.pts[k + 1], from)) return v;
      hit = true; return r2(v + (i % 2 ? dz : dx));
    });
    return hit ? { ...f, pts } : f;
  });
}

/** The features with a node put into every line (but `ex`) that passes through `at` between two of its nodes, so
 *  what's at `at` is joined to it. A line with a node there already is left as it is. */
export function joinOnto(fs: SiteFeature[], at: Pt, ex?: string): SiteFeature[] {
  return fs.map((f) => {
    if (f.id === ex || !isLine(f)) return f;
    const p = f.pts;
    for (let i = 0; i + 1 < p.length; i += 2) if (near(p[i], p[i + 1], at)) return f;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const ax = p[i], az = p[i + 1], ex2 = p[i + 2] - ax, ez = p[i + 3] - az, L2 = ex2 * ex2 + ez * ez;
      if (L2 < 1e-9) continue;
      const t = ((at[0] - ax) * ex2 + (at[1] - az) * ez) / L2;
      if (t <= 0 || t >= 1) continue;
      if (Math.hypot(ax + ex2 * t - at[0], az + ez * t - at[1]) < JOIN) {
        const np = [...p]; np.splice(i + 2, 0, r2(at[0]), r2(at[1]));
        return { ...f, pts: np };
      }
    }
    return f;
  });
}

/** The features once a feature's been put down or moved to where it is now: a point one joined to the lines through
 *  it; a line's every node joined to the other lines it lands on. */
export function joined(fs: SiteFeature[], id: string): SiteFeature[] {
  const f = fs.find((x) => x.id === id); if (!f) return fs;
  const s = featureOf(f.kind).shape;
  if (s === 'point') { const h = hubOf(f); return h && f.kind !== 'tree' ? joinOnto(fs, h, id) : fs; }
  if (s !== 'line') return fs;
  let o = fs;
  for (let i = 0; i + 1 < f.pts.length; i += 2) o = joinOnto(o, [f.pts[i], f.pts[i + 1]], id);
  return o;
}

/** A line feature's node `i` moved to (x, z): the other lines' nodes joined where it was go along, and it's joined to
 *  any line it lands on. */
export function nodeMoved(fs: SiteFeature[], id: string, i: number, x: number, z: number): SiteFeature[] {
  const f = fs.find((q) => q.id === id); if (!f || i * 2 + 1 >= f.pts.length) return fs;
  const was: Pt = [f.pts[i * 2], f.pts[i * 2 + 1]], np = [...f.pts]; np[i * 2] = r2(x); np[i * 2 + 1] = r2(z);
  let o = fs.map((q) => (q.id === id ? { ...q, pts: np } : q));
  if (isLine(f)) {
    // (other lines joined at the node: along with it; but not onto itself, if it's dropped where it was)
    o = carry(o, [was], r2(x) - was[0], r2(z) - was[1], id);
    o = joinOnto(o, [r2(x), r2(z)], id);
  }
  return o;
}

/** A point thing (a pole, a well, a tank) moved by (dx, dz) from `from`: the line nodes on it go along, and it's
 *  joined to any line it lands on. `ex`: the feature that moved (already shifted), if it's a feature. */
export function hubMoved(fs: SiteFeature[], from: Pt, dx: number, dz: number, ex?: string): SiteFeature[] {
  let o = carry(fs, [from], dx, dz, ex);
  if (ex) o = joinOnto(o, [r2(from[0] + dx), r2(from[1] + dz)], ex);
  return o;
}
