// The skeleton of a formed building: its cores (stairs, lifts, shafts) and its columns. A core has to rise
// straight through every floor, so it is placed in the ground every floor shares, as near the middle as it goes;
// a long floor gets more than one, so no point is farther than the escape distance from a stair. Columns are a
// grid through that shared ground and a ring just inside each floor's edge; an edge column that can't follow the
// one below it (within a rake) has to start on a beam, and is counted as a transfer.
import { inter, type MP } from '../../doc/ground';
import { TRAVEL } from '../../doc/site';
import { axisOf, edgeDist, inRings, pole } from './curve';
import { largest, mpOf, ringsOf } from './shape';
import type { BuildingUse, Pt } from './types';

/** a stair (two flights and landings, 2.8 × 5.7 m), a lift (car and shaft, 2.5 × 2.5 m) */
const STAIR_A = 16, LIFT_A = 6.2;
/** the narrowest a core can be: a stair's length */
const CORE_MIN = 5.8;
/** floor area a person takes, by use (m²): what the lifts are counted from */
const DENSITY: Record<BuildingUse, number> = { residential: 15, office: 10, retail: 6, hotel: 18, library: 8, toilet: 4, community: 4, school: 6, clinic: 8, parking: 30 };
const PUBLIC = new Set<BuildingUse>(['library', 'toilet', 'community', 'school', 'clinic']);

/** A core's floor area: its stairs (each with a fire-check lobby above 15 m, as NBC 2016 asks of a high-rise's
 *  escape stairs), its lifts and their lobby (2.5 m deep in front of them), service shafts (about 2 % of the floor),
 *  and the core's own walls (about 12 % on top). A 10-storey slab's two stairs and two lifts come to about 90 m². */
export function coreArea(stairs: number, lifts: number, height: number, typical: number): number {
  const stair = stairs * (STAIR_A + (height > 15 ? 5 : 0));
  const lift = lifts ? lifts * LIFT_A + 6 + lifts * 4 : 2;
  return (stair + lift + Math.max(2, typical * 0.015)) * 1.05;
}

export interface CoreNeed { stairs: number; lifts: number; area: number }

/** What the cores must hold. One floor needs none; houses have their own stairs. Two stairs above 15 m (NBC 2016
 *  Part 4); lifts above 15 m roughly one for every 300 people, and a fire lift above 30 m; a public building of
 *  more than one floor gets a lift whatever its height, so everyone can reach every floor. */
export function coreNeed(floors: { use: BuildingUse; area: number }[], height: number, houses: boolean): CoreNeed {
  if (houses || floors.length <= 1) return { stairs: 0, lifts: 0, area: 0 };
  const people = floors.reduce((s, f) => s + f.area / DENSITY[f.use], 0);
  const stairs = height > 15 ? 2 : 1;
  let lifts = 0;
  if (height > 15) lifts = Math.min(16, Math.max(1, Math.ceil(people / 300))) + (height > 30 ? 1 : 0);
  else if (floors.some((f) => PUBLIC.has(f.use)) || floors.length >= 4) lifts = 1;
  const typical = floors.map((f) => f.area).sort((a, b) => a - b)[Math.floor(floors.length / 2)] ?? 0;
  const area = coreArea(stairs, lifts, height, typical);
  return { stairs, lifts, area };
}

/** a ring's centroid */
function centroid(r: number[]): Pt {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, n = r.length; i < n; i += 2) {
    const j = (i + 2) % n, f = r[i] * r[j + 1] - r[j] * r[i + 1];
    cx += (r[i] + r[j]) * f; cz += (r[i + 1] + r[j + 1]) * f; a += f * 3;
  }
  return a ? [cx / a, cz / a] : [r[0] ?? 0, r[1] ?? 0];
}

/** a w × d rectangle centred on c, its w along u */
function rect(c: Pt, u: Pt, w: number, d: number): number[] {
  const v: Pt = [-u[1], u[0]], a = w / 2, b = d / 2;
  return [
    c[0] - u[0] * a - v[0] * b, c[1] - u[1] * a - v[1] * b,
    c[0] + u[0] * a - v[0] * b, c[1] + u[1] * a - v[1] * b,
    c[0] + u[0] * a + v[0] * b, c[1] + u[1] * a + v[1] * b,
    c[0] - u[0] * a + v[0] * b, c[1] - u[1] * a + v[1] * b,
  ];
}
/** whether a rectangle lies inside rings: its corners and mid-sides in, and no corner of the rings poking into it */
function fits(r: number[], rings: number[][]): boolean {
  for (let i = 0; i < 8; i += 2) {
    const j = (i + 2) % 8;
    if (!inRings(rings, r[i], r[i + 1]) || !inRings(rings, (r[i] + r[j]) / 2, (r[i + 1] + r[j + 1]) / 2)) return false;
  }
  const q = [r];
  for (const g of rings) for (let i = 0; i < g.length; i += 2) if (inRings(q, g[i], g[i + 1])) return false;
  return true;
}

/** Cores placed in the shared ground `common` (local rings, already kept a metre in from the edges): as many as
 *  keep every point of `reach` (points round the whole volume) within the escape distance of one, each at the
 *  deepest point of its share of the floor. `fallback` is where they go when the shared ground has no room. */
export function placeCores(common: MP, reach: number[], need: CoreNeed, fallback: MP): { cores: number[][]; centres: Pt[]; fit: boolean; covered: boolean } {
  if (!need.area) return { cores: [], centres: [], fit: true, covered: true };
  const reachPts: Pt[] = [];
  for (let i = 0; i < reach.length; i += 2) {
    const j = (i + 2) % reach.length, L = Math.hypot(reach[j] - reach[i], reach[j + 1] - reach[i + 1]), k = Math.max(1, Math.ceil(L / 5));
    for (let s = 0; s < k; s++) reachPts.push([reach[i] + ((reach[j] - reach[i]) * s) / k, reach[i + 1] + ((reach[j + 1] - reach[i + 1]) * s) / k]);
  }
  const far = (cs: Pt[]) => reachPts.reduce((m, p) => Math.max(m, Math.min(...cs.map((c) => Math.hypot(p[0] - c[0], p[1] - c[1])))), 0);
  const ground = common.length ? common : fallback;
  const rings = ringsOf(ground);
  if (!rings.length) return { cores: [], centres: [], fit: false, covered: false };
  const u = axisOf(reach.length >= 6 ? reach : rings[0]), v: Pt = [-u[1], u[0]];
  // the shared ground's run along its long axis, to cut into equal strips
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const r of rings) for (let i = 0; i < r.length; i += 2) {
    const a = r[i] * u[0] + r[i + 1] * u[1], b = r[i] * v[0] + r[i + 1] * v[1];
    a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
  }
  let best: { centres: Pt[]; pieces: number[][][]; cands: Pt[][]; far: number } | null = null;
  for (let k = 1; k <= 8; k++) {
    const centres: Pt[] = [], pieces: number[][][] = [], cands: Pt[][] = [];
    for (let s = 0; s < k; s++) {
      let piece = rings;
      if (k > 1) {
        const lo = a0 + ((a1 - a0) * s) / k, hi = a0 + ((a1 - a0) * (s + 1)) / k, m = (b0 + b1) / 2, w = b1 - b0 + 10;
        const c: Pt = [u[0] * (lo + hi) / 2 + v[0] * m, u[1] * (lo + hi) / 2 + v[1] * m];
        piece = ringsOf(largest(inter(ground, mpOf(rect(c, u, hi - lo, w)))));
        if (!piece.length) continue;
      }
      // where it might go: the middle of its share (its centroid) if that's inside, else the deepest point; the
      // pole alone wanders on a plan that's as deep in several places (a strip, a square with its corners carved)
      const [x0, z0] = pole(piece, 0.4), [cx, cz] = centroid(piece[0]);
      const [x, z] = inRings(piece, cx, cz) && edgeDist(piece, cx, cz) > 3 ? [cx, cz] : [x0, z0];
      cands.push([[x, z], [x0, z0]]);
      centres.push([x, z]); pieces.push(piece);
    }
    if (!centres.length) continue;
    const f = far(centres);
    if (!best || f < best.far - 0.5) best = { centres, pieces, cands, far: f };
    if (f <= TRAVEL) break;
  }
  if (!best) return { cores: [], centres: [], fit: false, covered: false };
  // each core's share: a stair each (two in one core when there's only one), the lifts split between them
  const n = best.centres.length;
  const stairs = n > 1 ? 1 : need.stairs, lifts = need.lifts ? Math.ceil(need.lifts / n) : 0;
  // (split between cores, each with a lobby of its own: a tenth more than a share)
  const A = n > 1 ? (need.area / n) * 1.1 : need.area;
  const cores: number[][] = [];
  let fit = !!common.length;
  const centres: Pt[] = [];
  const d = Math.max(CORE_MIN, Math.sqrt(A / 1.7)), w = Math.max(CORE_MIN, A / d), sq = Math.max(CORE_MIN, Math.sqrt(A));
  // along the building's long axis first, then across it, then square to the plan (a square plan has no long axis
  // to speak of), then squarer, then as slim as a stair allows; at the middle first, then the deepest point
  const axes: Pt[] = [u, v, [1, 0], [0, 1]];
  const shapes = (c: Pt) => [...axes.map((a) => rect(c, a, w, d)), ...axes.map((a) => rect(c, a, sq, A / sq)), ...axes.map((a) => rect(c, a, A / CORE_MIN, CORE_MIN))];
  best.cands.forEach((cs, i) => {
    let got: number[] | undefined, at = cs[0];
    for (const c of cs) { got = shapes(c).find((r) => fits(r, best!.pieces[i])); if (got) { at = c; break; } }
    if (!got) fit = false;
    cores.push(got ?? shapes(cs[0])[0]); centres.push(at);
  });
  return { cores, centres, fit, covered: best.far <= TRAVEL + 0.5 };
}

// ---------------- columns ----------------

/** grid columns about this far apart, edge columns about this far apart and this far in from the slab edge */
const GRID = 8, EDGE = 6, INSET = 0.6;
/** an edge column may lean this far from the one below it (a rake) before it has to start afresh on a beam */
const RAKE = 0.75;

/** The grid through the shared ground: GRID apart, lined up with the main core and the building's long axis, clear
 *  of the cores and of the edge columns' zone. */
export function gridColumns(common: MP, axis: Pt, origin: Pt, cores: number[][]): Pt[] {
  const rings = ringsOf(common);
  if (!rings.length) return [];
  const u = axis, v: Pt = [-u[1], u[0]], out: Pt[] = [];
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const r of rings) for (let i = 0; i < r.length; i += 2) {
    const a = (r[i] - origin[0]) * u[0] + (r[i + 1] - origin[1]) * u[1], b = (r[i] - origin[0]) * v[0] + (r[i + 1] - origin[1]) * v[1];
    a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
  }
  // (a grid line either side of the core rather than through it)
  for (let i = Math.floor(a0 / GRID) - 1; i <= Math.ceil(a1 / GRID) + 1; i++) for (let j = Math.floor(b0 / GRID) - 1; j <= Math.ceil(b1 / GRID) + 1; j++) {
    const a = (i + 0.5) * GRID, b = (j + 0.5) * GRID;
    const x = origin[0] + u[0] * a + v[0] * b, z = origin[1] + u[1] * a + v[1] * b;
    if (!inRings(rings, x, z) || edgeDist(rings, x, z) < 2) continue;
    if (cores.some((c) => inRings([c], x, z) || edgeDist([c], x, z) < 0.8)) continue;
    out.push([x, z]);
  }
  return out;
}

/** a ring's points set in by INSET (each vertex along its corner's bisector, mitred no further than 3 × INSET) */
function insetRing(r: number[]): number[] {
  const n = r.length / 2, o: number[] = new Array(r.length);
  for (let i = 0; i < n; i++) {
    const p = (i - 1 + n) % n, q = (i + 1) % n;
    let ax = r[i * 2] - r[p * 2], az = r[i * 2 + 1] - r[p * 2 + 1], bx = r[q * 2] - r[i * 2], bz = r[q * 2 + 1] - r[i * 2 + 1];
    const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
    ax /= la; az /= la; bx /= lb; bz /= lb;
    // the left normals (inwards, for an outline anticlockwise or a hole clockwise)
    let nx = -az - bz, nz = ax + bx;
    const ln = Math.hypot(nx, nz);
    if (ln < 1e-6) { nx = -az; nz = ax; } else { nx /= ln; nz /= ln; }
    const cosh = nx * -az + nz * ax, k = Math.min(3, 1 / Math.max(0.33, cosh));
    o[i * 2] = r[i * 2] + nx * INSET * k; o[i * 2 + 1] = r[i * 2 + 1] + nz * INSET * k;
  }
  return o;
}
/** the corners of a ring (turning more than 25°) and evenly spaced points between them, on its inset */
function edgeSpots(r: number[]): Pt[] {
  const s = insetRing(r), n = s.length / 2;
  if (n < 3) return [];
  const corner: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = (i - 1 + n) % n, q = (i + 1) % n;
    const ax = r[i * 2] - r[p * 2], az = r[i * 2 + 1] - r[p * 2 + 1], bx = r[q * 2] - r[i * 2], bz = r[q * 2 + 1] - r[i * 2 + 1];
    const c = (ax * bx + az * bz) / ((Math.hypot(ax, az) * Math.hypot(bx, bz)) || 1);
    if (c < Math.cos((25 * Math.PI) / 180)) corner.push(i);
  }
  // walk between corners (or once round, for a smooth ring), a column every EDGE or less
  const runs: number[][] = [];
  if (!corner.length) runs.push([...Array(n + 1).keys()].map((k) => k % n));
  else for (let c = 0; c < corner.length; c++) {
    const a = corner[c], b = corner[(c + 1) % corner.length], run = [a];
    for (let k = (a + 1) % n; ; k = (k + 1) % n) { run.push(k); if (k === b) break; }
    runs.push(run);
  }
  const out: Pt[] = [];
  for (const run of runs) {
    const L: number[] = [0];
    for (let k = 1; k < run.length; k++) L.push(L[k - 1] + Math.hypot(s[run[k] * 2] - s[run[k - 1] * 2], s[run[k] * 2 + 1] - s[run[k - 1] * 2 + 1]));
    const tot = L[L.length - 1], m = Math.max(1, Math.ceil(tot / EDGE - 0.15));
    let k = 0;
    for (let j = 0; j < m; j++) {
      const at = (tot * j) / m;
      while (k < L.length - 2 && L[k + 1] < at) k++;
      const f = L[k + 1] - L[k] > 1e-9 ? (at - L[k]) / (L[k + 1] - L[k]) : 0;
      const i0 = run[k], i1 = run[k + 1] ?? run[k];
      out.push([s[i0 * 2] + (s[i1 * 2] - s[i0 * 2]) * f, s[i0 * 2 + 1] + (s[i1 * 2 + 1] - s[i0 * 2 + 1]) * f]);
    }
  }
  return out;
}
/** the nearest point on a ring's inset to p */
function nearOn(s: number[], p: Pt): [number, number, number] {
  let best: [number, number, number] = [p[0], p[1], Infinity];
  const n = s.length;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const ax = s[j], az = s[j + 1], dx = s[i] - ax, dz = s[i + 1] - az, L2 = dx * dx + dz * dz || 1e-12;
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / L2)), x = ax + dx * t, z = az + dz * t, d = Math.hypot(p[0] - x, p[1] - z);
    if (d < best[2]) best = [x, z, d];
  }
  return best;
}

export interface Post { x0: number; z0: number; x1: number; z1: number; from: number; to: number; transfer: boolean }

/** Edge columns up through the floors: along each floor's `edge` (its outline before carves, and any courts
 *  through it), kept where the slab is (`rings`, after carves); `same` when a floor is the floor below over again. Each column follows the one below it round the new edge while it can; gaps along the
 *  edge get new columns, which start on the slab below (transfers). */
export function edgeColumns(floors: { edge: number[][]; rings: number[][]; same: boolean }[], grid: Pt[]): Post[] {
  const posts: Post[] = [], open: number[] = [];
  floors.forEach((f, level) => {
    if (level > 0 && f.same) { for (const i of open) posts[i].to = level; return; }
    const insets = f.edge.map(insetRing);
    const keep: number[] = [];
    const spots: Pt[] = [];
    // the columns below, carried on where the edge is still within a rake of them
    for (const i of open) {
      const p: Pt = [posts[i].x1, posts[i].z1];
      let b: [number, number, number] = [0, 0, Infinity];
      for (const s of insets) { const q = nearOn(s, p); if (q[2] < b[2]) b = q; }
      if (b[2] <= RAKE && inRings(f.rings, b[0], b[1])) { posts[i].x1 = b[0]; posts[i].z1 = b[1]; posts[i].to = level; keep.push(i); spots.push([b[0], b[1]]); }
    }
    // new columns where the edge has none near
    for (const r of f.edge) for (const p of edgeSpots(r)) {
      if (!inRings(f.rings, p[0], p[1])) continue;
      if (spots.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < EDGE * 0.6)) continue;
      // (one that lands on a grid column below is carried by it)
      const onGrid = grid.some((g) => Math.hypot(g[0] - p[0], g[1] - p[1]) < RAKE);
      posts.push({ x0: p[0], z0: p[1], x1: p[0], z1: p[1], from: level, to: level, transfer: level > 0 && !onGrid });
      keep.push(posts.length - 1); spots.push(p);
    }
    open.length = 0; open.push(...keep);
  });
  return posts;
}

/** how far a floor's outline stands out past the floor below at most (m) */
export function overhang(ring: number[], below: number[]): number {
  let m = 0;
  const b = [below];
  for (let i = 0; i < ring.length; i += 2) {
    if (inRings(b, ring[i], ring[i + 1])) continue;
    m = Math.max(m, edgeDist(b, ring[i], ring[i + 1]));
  }
  return m;
}

