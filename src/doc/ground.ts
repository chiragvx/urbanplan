// Site Studio's ground: the net plot as one map, every square metre of it one thing. Roads and roundabouts first
// (unioned into one surface, so their joints don't overlap), then the buildings and car parks, the fire tender's way,
// the parking lots, the gardens, paving round the buildings and the paths to them, and whatever is left planted.
// Each layer is the drawn shape less everything above it, clipped to the plot; all of it is laid out again on every
// change: bays packed at the angle and offset that fit the most, with planted islands; gardens with a loop path,
// shrub beds, trees and benches; trees along the wall and through the open ground.
//
// Shapes are multipolygons: polygons of rings ([x, z] pairs), the first ring the outline and the rest holes. The
// booleans and offsets are Clipper's, on whole millimetres (exact, so slivers and shared edges never trip it).
import ClipperLib from 'clipper-lib';
import earcut from 'earcut';

export type Pt = [number, number];
export type Poly = Pt[][];
export type MP = Poly[];

/** a tree or shrub: canopy radius r; kind 0 rain tree, 1 round, 2 palm, 3 ashoka (tall, narrow), 4 shrub */
export interface Plant { x: number; z: number; r: number; kind: 0 | 1 | 2 | 3 | 4 }

export interface GroundMap {
  /** the drive, internal roads and roundabouts as one surface; the roundabouts' planted islands */
  road: MP; island: MP;
  /** the fire tender's way where it isn't road (hardstanding) */
  fire: MP;
  /** parking lots (and the open-ground parking's rows and aisles); their planted islands */
  lot: MP; lotIsland: MP;
  /** paving round the buildings and the paths to them; garden paths */
  apron: MP; path: MP;
  /** gardens' lawns and shrub beds; the rest of the open ground, planted */
  lawn: MP; bed: MP; green: MP;
  plants: Plant[];
  /** benches: x, z, the way they face (radians) */
  benches: number[][];
  /** areas (m²): gardens (lawn, beds, paths), the open ground left (not built, paved for cars or parked on) */
  gardenArea: number; openArea: number;
}

export const BAY_W = 2.5, BAY_L = 5, AISLE = 6;

// ---------------- booleans ----------------

const S = 1000; // millimetres
type Path = { X: number; Y: number }[];
const CL = ClipperLib as any;
/** a shape as Clipper's paths: outlines one way round, holes the other */
function toPaths(m: MP): Path[] {
  const out: Path[] = [];
  for (const p of m) p.forEach((r, i) => {
    const path: Path = [];
    const n = r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.length - 1 : r.length;
    for (let k = 0; k < n; k++) path.push({ X: Math.round(r[k][0] * S), Y: Math.round(r[k][1] * S) });
    if (path.length < 3) return;
    if (CL.Clipper.Orientation(path) !== (i === 0)) path.reverse();
    out.push(path);
  });
  return out;
}
/** Clipper's tree of outlines and holes as a shape */
function fromTree(tree: any): MP {
  const out: MP = [];
  const ring = (c: Path): Pt[] => { const r = c.map((p) => [p.X / S, p.Y / S] as Pt); if (r.length) r.push([r[0][0], r[0][1]]); return r; };
  const walk = (node: any) => {
    for (const o of node.Childs()) {
      // an outline, its holes, and the islands inside them
      const poly: Poly = [ring(o.Contour())];
      for (const h of o.Childs()) { poly.push(ring(h.Contour())); walk(h); }
      if (poly[0].length >= 4) out.push(poly);
    }
  };
  walk(tree);
  return out;
}
function run(type: number, subj: MP[], clip: MP[]): MP {
  const c = new CL.Clipper();
  for (const m of subj) c.AddPaths(toPaths(m), CL.PolyType.ptSubject, true);
  for (const m of clip) c.AddPaths(toPaths(m), CL.PolyType.ptClip, true);
  const t = new CL.PolyTree();
  c.Execute(type, t, CL.PolyFillType.pftNonZero, CL.PolyFillType.pftNonZero);
  return fromTree(t);
}
export function union(...g: MP[]): MP {
  const a = g.filter((x) => x.length);
  return a.length ? run(CL.ClipType.ctUnion, a, []) : [];
}
export function diff(a: MP, ...b: MP[]): MP {
  if (!a.length) return [];
  const bb = b.filter((x) => x.length);
  return bb.length ? run(CL.ClipType.ctDifference, [a], bb) : a;
}
export function inter(a: MP, b: MP): MP {
  if (!a.length || !b.length) return [];
  return run(CL.ClipType.ctIntersection, [a], [b]);
}
/** grown (d > 0) or shrunk (d < 0) by d, round at the corners */
export function offset(m: MP, d: number): MP {
  if (!m.length || !d) return m;
  const o = new CL.ClipperOffset(2, 0.05 * S);
  o.AddPaths(toPaths(m), CL.JoinType.jtRound, CL.EndType.etClosedPolygon);
  const t = new CL.PolyTree();
  o.Execute(t, d * S);
  return fromTree(t);
}

/** a flat ring (x,z,…) as a shape */
export function fromFlat(f: number[] | null | undefined): MP {
  if (!f || f.length < 6) return [];
  const r: Pt[] = [];
  for (let i = 0; i + 1 < f.length; i += 2) r.push([f[i], f[i + 1]]);
  return [[r]];
}
export const fromFlats = (fs: number[][]): MP => union(...fs.map(fromFlat));
/** a ring of a shape as flat x,z,… (without the closing point) */
export function flat(r: Pt[]): number[] {
  const n = r.length > 1 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? r.length - 1 : r.length;
  const o: number[] = [];
  for (let i = 0; i < n; i++) o.push(r[i][0], r[i][1]);
  return o;
}
/** the outlines of a shape, flat */
export const outlines = (m: MP): number[][] => m.map((p) => flat(p[0]));

/** a shape cut into triangles (flat x,z × 3 each), holes and all */
export function triangles(m: MP): number[][] {
  const out: number[][] = [];
  for (const p of m) {
    const fl: number[] = [], holes: number[] = [];
    p.forEach((r, i) => { if (i) holes.push(fl.length / 2); fl.push(...flat(r)); });
    const t = earcut(fl, holes.length ? holes : undefined);
    for (let k = 0; k < t.length; k += 3) out.push([fl[t[k] * 2], fl[t[k] * 2 + 1], fl[t[k + 1] * 2], fl[t[k + 1] * 2 + 1], fl[t[k + 2] * 2], fl[t[k + 2] * 2 + 1]]);
  }
  return out;
}

function ringArea(r: Pt[]) { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return s / 2; }
export function area(m: MP): number {
  let a = 0;
  for (const p of m) p.forEach((r, i) => { a += (i ? -1 : 1) * Math.abs(ringArea(r)); });
  return a;
}

function inRing(r: Pt[], x: number, z: number) {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
export function inside(m: MP, x: number, z: number) {
  for (const p of m) if (inRing(p[0], x, z) && !p.slice(1).some((h) => inRing(h, x, z))) return true;
  return false;
}
/** the nearest point on a shape's edge, and how far */
export function nearest(m: MP, x: number, z: number): [number, number, number] {
  let best: [number, number, number] = [x, z, Infinity];
  for (const p of m) for (const r of p) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [ax, az] = r[j], dx = r[i][0] - ax, dz = r[i][1] - az, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)), px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
    if (d < best[2]) best = [px, pz, d];
  }
  return best;
}

// ---------------- strokes and offsets ----------------

export function disc(x: number, z: number, r: number, n = 16): MP {
  const ring: Pt[] = [];
  for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; ring.push([x + Math.cos(a) * r, z + Math.sin(a) * r]); }
  return [[ring]];
}
/** A line `w` wide with round joints (and round ends, unless `butt`): one surface, however it bends. */
export function stroke(pts: number[], w: number, closed = false, butt = false): MP {
  if (pts.length < 4 || w <= 0) return [];
  const path: Path = [];
  for (let i = 0; i + 1 < pts.length; i += 2) path.push({ X: Math.round(pts[i] * S), Y: Math.round(pts[i + 1] * S) });
  const o = new CL.ClipperOffset(2, 0.05 * S);
  o.AddPath(path, CL.JoinType.jtRound, closed ? CL.EndType.etClosedLine : butt ? CL.EndType.etOpenButt : CL.EndType.etOpenRound);
  const t = new CL.PolyTree();
  o.Execute(t, (w / 2) * S);
  return fromTree(t);
}
/** a shape shrunk by d */
export const shrink = (m: MP, d: number): MP => (d > 0 ? offset(m, -d) : m);
/** a shape grown by d */
export const grow = (m: MP, d: number): MP => (d > 0 ? offset(m, d) : m);

// ---------------- randomness ----------------

function hash01(n: number) {
  let h = (n * 2654435761) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export const rng = (seed: number) => { let s = seed >>> 0; return () => hash01(s++); };

// ---------------- bays ----------------

/** the inside intervals of a shape (rings in a local frame) along the line v */
function chords(R: Pt[][], v: number): [number, number][] {
  const xs: number[] = [];
  for (const r of R) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const va = r[j][1], vb = r[i][1];
    if ((va > v) !== (vb > v)) xs.push(r[j][0] + ((v - va) / (vb - va)) * (r[i][0] - r[j][0]));
  }
  xs.sort((a, b) => a - b);
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < xs.length; k += 2) if (xs[k + 1] > xs[k]) out.push([xs[k], xs[k + 1]]);
  return out;
}
function cut(a: [number, number][], b: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const [a0, a1] of a) for (const [b0, b1] of b) { const lo = Math.max(a0, b0), hi = Math.min(a1, b1); if (hi > lo) out.push([lo, hi]); }
  return out;
}
function less(a: [number, number][], lo: number, hi: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [a0, a1] of a) { if (hi <= a0 || lo >= a1) { out.push([a0, a1]); continue; } if (lo > a0) out.push([a0, lo]); if (hi < a1) out.push([hi, a1]); }
  return out;
}
/** where a band v0..v1 lies wholly inside */
function bandIn(R: Pt[][], v0: number, v1: number): [number, number][] {
  let s: [number, number][] | null = null;
  const k = Math.max(2, Math.ceil((v1 - v0) / 0.5));
  for (let i = 0; i <= k; i++) {
    const v = v0 + 0.02 + ((v1 - v0 - 0.04) * i) / k, c = chords(R, v);
    s = s ? cut(s, c) : c;
    if (!s.length) return s;
  }
  // a corner poking into the band between the lines
  for (const r of R) for (const [u, v] of r) if (v > v0 && v < v1) s = less(s!, u - 0.35, u + 0.35);
  return s ?? [];
}

/** bays (quads, the back edge first), planted islands, the rows and aisles as one surface, the direction they run */
export interface BayLayout { bays: number[][]; islands: number[][]; paved: MP; angle: number }

/** Bays (2.5 × 5 m, 90°) packed into a shape: double rows either side of 6 m aisles, at whichever of `angles` and
 *  offset across fits the most; with `islands`, a planted island at each end of a long row and every twelve bays. */
export function layBays(m: MP, angles: number[], islands = true): BayLayout {
  let best: { n: number; a: number; o: number } = { n: 0, a: angles[0] ?? 0, o: 0 };
  const M = BAY_L * 2 + AISLE;
  const plan = (a: number, o: number, emit: ((u0: number, v0: number, u1: number, v1: number, t: 'bay' | 'isle' | 'aisle', hi?: boolean) => void) | null) => {
    const c = Math.cos(a), s = Math.sin(a);
    const R: Pt[][] = m.flatMap((p) => p.map((r) => r.map(([x, z]) => [x * c + z * s, -x * s + z * c] as Pt)));
    let V0 = Infinity, V1 = -Infinity;
    for (const r of R) for (const [, v] of r) { V0 = Math.min(V0, v); V1 = Math.max(V1, v); }
    let n = 0;
    for (let v = V0 + o - M; v < V1; v += M) {
      const aisle = bandIn(R, v + BAY_L, v + BAY_L + AISLE);
      if (!aisle.length) continue;
      for (const [r0, r1] of [[v, v + BAY_L], [v + BAY_L + AISLE, v + M]]) {
        for (const [u0, u1] of cut(bandIn(R, r0, r1), aisle)) {
          const k = Math.floor((u1 - u0) / BAY_W + 1e-6);
          if (k < 1) continue;
          const st = u0 + (u1 - u0 - k * BAY_W) / 2;
          for (let i = 0; i < k; i++) {
            const isle = islands && k >= 8 && (i === 0 || i === k - 1 || i % 12 === 6);
            if (!isle) n++;
            emit?.(st + i * BAY_W, r0, st + (i + 1) * BAY_W, r1, isle ? 'isle' : 'bay', r0 > v);
          }
          emit?.(st, v + BAY_L, st + k * BAY_W, v + BAY_L + AISLE, 'aisle');
        }
      }
    }
    return n;
  };
  for (const a of angles) for (let o = 0; o < M; o += 2) {
    const n = plan(a, o, null);
    if (n > best.n) best = { n, a, o };
  }
  const out: BayLayout = { bays: [], islands: [], paved: [], angle: best.a };
  if (!best.n) return out;
  const c = Math.cos(best.a), s = Math.sin(best.a);
  const w = (u: number, v: number) => [u * c - v * s, u * s + v * c];
  const pave: MP[] = [];
  plan(best.a, best.o, (u0, v0, u1, v1, t, hi) => {
    // (a bay's first edge is its back, the third its mouth on the aisle)
    const q = hi ? [...w(u1, v1), ...w(u0, v1), ...w(u0, v0), ...w(u1, v0)] : [...w(u0, v0), ...w(u1, v0), ...w(u1, v1), ...w(u0, v1)];
    if (t === 'bay') out.bays.push(q); else if (t === 'isle') out.islands.push(q);
    pave.push(fromFlat(q));
  });
  out.paved = union(...pave);
  return out;
}

/** The directions a shape's bays might run: along its longest edge and across, and the road's. */
export function anglesFor(m: MP, axis: [number, number]): number[] {
  const out = [Math.atan2(axis[1], axis[0])];
  let L = 0, a = out[0];
  for (const p of m) for (let i = 0, j = p[0].length - 1; i < p[0].length; j = i++) {
    const r = p[0], d = Math.hypot(r[i][0] - r[j][0], r[i][1] - r[j][1]);
    if (d > L) { L = d; a = Math.atan2(r[i][1] - r[j][1], r[i][0] - r[j][0]); }
  }
  out.push(a);
  const all = [...out, ...out.map((x) => x + Math.PI / 2)];
  return all.filter((x, i) => all.findIndex((y) => Math.abs(Math.sin(y - x)) < 0.01 && Math.cos(y - x) > 0) === i);
}

// ---------------- planting ----------------

/** Trees scattered through a shape at least `gap` apart (and from those already placed), on a jittered grid. */
function scatter(m: MP, gap: number, rand: () => number, placed: Plant[], kinds: Plant['kind'][], avoid: MP = [], chance = 0.85) {
  if (!m.length) return;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const p of m) for (const [x, z] of p[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const step = gap * 0.8;
  for (let x = x0 + step / 2; x < x1; x += step) for (let z = z0 + step / 2; z < z1; z += step) {
    const jx = x + (rand() - 0.5) * step * 0.8, jz = z + (rand() - 0.5) * step * 0.8;
    if (rand() > chance || !inside(m, jx, jz) || (avoid.length && inside(avoid, jx, jz))) continue;
    if (placed.some((t) => Math.hypot(t.x - jx, t.z - jz) < (t.kind === 4 ? gap * 0.4 : gap))) continue;
    const kind = kinds[Math.floor(rand() * kinds.length)];
    placed.push({ x: jx, z: jz, r: kind === 0 ? 3.6 + rand() * 1.8 : kind === 1 ? 2.4 + rand() * 1.2 : kind === 2 ? 1.8 : kind === 3 ? 1.1 : 0.6 + rand() * 0.4, kind });
  }
}
/** Plants along a shape's edges, `d` in, every `every` metres. */
function line(m: MP, d: number, every: number, rand: () => number, placed: Plant[], kind: Plant['kind'], ok: (x: number, z: number) => boolean) {
  for (const p of m) for (const r of p) {
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const [ax, az] = r[j], [bx, bz] = r[i], L = Math.hypot(bx - ax, bz - az);
      if (L < every * 0.6) continue;
      // the side the shape is on
      const sgn = inside(m, (ax + bx) / 2 - ((bz - az) / L) * 0.05, (az + bz) / 2 + ((bx - ax) / L) * 0.05) ? 1 : -1;
      const nx = (-(bz - az) / L) * sgn, nz = ((bx - ax) / L) * sgn;
      const k = Math.floor(L / every);
      for (let s = 0; s < k; s++) {
        const t = (s + 0.5) / k, x = ax + (bx - ax) * t + nx * d, z = az + (bz - az) * t + nz * d;
        if (!inside(m, x, z) || !ok(x, z)) continue;
        if (placed.some((q) => Math.hypot(q.x - x, q.z - z) < (kind === 4 ? 0.9 : every * 0.6))) continue;
        placed.push({ x: x + (rand() - 0.5) * 0.3, z: z + (rand() - 0.5) * 0.3, r: kind === 3 ? 1.1 + rand() * 0.3 : kind === 4 ? 0.55 + rand() * 0.35 : 2.6 + rand(), kind });
      }
    }
  }
}

/** A garden: shrub beds round its edge, a loop path through it (with benches), lawn, and trees. */
function garden(g: MP, rand: () => number, plants: Plant[]) {
  const out = { lawn: [] as MP, bed: [] as MP, path: [] as MP, benches: [] as number[][] };
  for (const P of g) {
    const p: MP = [P], A = area(p);
    if (A < 8) { out.lawn.push(P); continue; }
    const bed = A > 60 ? diff(p, shrink(p, 1.2)) : [];
    let path: MP = [];
    if (A > 220) {
      const core = shrink(p, 3.4);
      if (area(core) > 50) path = diff(core, shrink(core, 1.8));
    }
    out.bed.push(...bed); out.path.push(...path);
    out.lawn.push(...diff(p, bed, path));
    line(bed, 0.6, 1.6, rand, plants, 4, () => true);
    scatter(diff(shrink(p, 2.2), grow(path, 1.4)), 7, rand, plants, [0, 1, 1, 2], [], 0.7);
    // benches along the path, facing in
    for (const q of path) {
      const r = q[0], pq: MP = [q];
      let next = 4, acc = 0;
      for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
        const [ax, az] = r[j], [bx, bz] = r[i], L = Math.hypot(bx - ax, bz - az);
        // (n: towards the path)
        const sgn = L > 0 && inside(pq, (ax + bx) / 2 - ((bz - az) / L) * 0.05, (az + bz) / 2 + ((bx - ax) / L) * 0.05) ? 1 : -1;
        for (; L > 0 && next < acc + L; next += 16) {
          const t = (next - acc) / L, nx = (-(bz - az) / L) * sgn, nz = ((bx - ax) / L) * sgn;
          out.benches.push([ax + (bx - ax) * t - nx * 0.5, az + (bz - az) * t - nz * 0.5, Math.atan2(nz, nx)]);
        }
        acc += L;
      }
    }
  }
  return out;
}

// ---------------- the map ----------------

export interface GroundIn {
  net: number[];
  /** the compound wall's runs and its gates (x0, z0, x1, z1) */
  wall: number[][]; gates: number[][];
  /** the drive and internal roads (centre lines and widths), roundabouts (x, z, radius) */
  lines: { pts: number[]; w: number; closed?: boolean }[]; circles: number[][];
  /** building plates, car parks, the fire tender's way round tall buildings */
  build: number[][]; structures: number[][]; fire: number[][];
  /** lots and gardens as drawn (their order: an earlier one keeps what it shares with a later one) */
  lots: number[][]; gardens: number[][];
  /** bays on the rest of the open ground, inside this (the plot less a strip along the wall) */
  surface: number[] | null;
  /** the direction of the road the plot fronts (bays line up with it if that fits more) */
  axis: [number, number];
  seed: number;
}
export interface GroundOut { map: GroundMap; lotBays: BayLayout[]; surfaceBays: BayLayout | null }

export function layGround(I: GroundIn): GroundOut {
  const rand = rng(I.seed);
  const net = fromFlat(I.net);
  const plants: Plant[] = [];
  // roads: the lines and the roundabouts as one surface; the islands planted
  const islands = union(...I.circles.filter((c) => c[2] > 8).map(([x, z, r]) => disc(x, z, r - 6.5, 28)));
  const road = diff(inter(union(...I.lines.map((l) => stroke(l.pts, l.w, l.closed)), ...I.circles.map(([x, z, r]) => disc(x, z, r, 32))), net), islands);
  const island = inter(islands, net);
  const build = inter(fromFlats([...I.build, ...I.structures]), net);
  let taken = union(road, island, build);
  // the fire tender's way: kept clear of parking; across a garden it's a paved walk
  const fireAll = diff(inter(fromFlats(I.fire), net), taken);
  // lots, each on what's left of it
  const lotBays: BayLayout[] = [], lots: MP[] = [], isles: MP[] = [];
  for (const L of I.lots) {
    const m = diff(inter(fromFlat(L), net), taken, fireAll);
    const lay = layBays(shrink(m, 0.3), anglesFor(fromFlat(L), I.axis));
    lotBays.push(lay);
    lots.push(m);
    isles.push(...lay.islands.map(fromFlat));
    taken = union(taken, m);
  }
  // gardens, each on what's left of it
  const gardens: MP[] = [];
  for (const g of I.gardens) { const m = diff(inter(fromFlat(g), net), taken); gardens.push(m); taken = union(taken, m); }
  const gardened = union(...gardens);
  const fire = diff(fireAll, gardened);
  // parking on the rest of the open ground: rows and aisles where they fit, the rest stays open
  let surfaceBays: BayLayout | null = null;
  if (I.surface) {
    const m = diff(inter(fromFlat(I.surface), net), taken, fire, grow(build, 1.5));
    surfaceBays = layBays(m, anglesFor(net, I.axis));
    const used = inter(surfaceBays.paved, m);
    lots.push(used);
    isles.push(...surfaceBays.islands.map(fromFlat));
    taken = union(taken, used);
  }
  const lot = union(...lots), lotIsland = inter(union(...isles), lot);
  // paving round the buildings, and a path from each to the nearest road
  const open = diff(net, taken, fire);
  const walks: MP[] = [];
  for (const q of I.build) {
    let bx = 0, bz = 0, bd = Infinity;
    for (let i = 0; i < q.length; i += 2) {
      const j = (i + 2) % q.length, mx = (q[i] + q[j]) / 2, mz = (q[i + 1] + q[j + 1]) / 2, [, , d] = nearest(road, mx, mz);
      if (d < bd) { bd = d; bx = mx; bz = mz; }
    }
    if (bd < Infinity && bd > 2.5 && bd < 60) { const [px, pz] = nearest(road, bx, bz); walks.push(stroke([bx, bz, px, pz], 2.2, false, true)); }
  }
  const walked = inter(union(grow(fromFlats(I.build), 2), ...walks), union(open, gardened));
  const apron = diff(walked, gardened);
  // the gardens laid out (the walks to the buildings and the fire tender's way through them are garden paths)
  const through = union(inter(walked, gardened), inter(fireAll, gardened));
  const G = garden(diff(gardened, through), rand, plants);
  G.path = union(G.path, through);
  const green = diff(open, walked);
  // trees: along the wall (ashoka), in the lots' islands, through the open ground, on the roundabouts
  const near = (x: number, z: number) => I.gates.some((g) => Math.hypot(x - (g[0] + g[2]) / 2, z - (g[1] + g[3]) / 2) < 7);
  // (an ashoka, then a round tree, along the wall)
  const wallLine: Plant[] = [];
  line(green, 1.8, 7, rand, wallLine, 3, (x, z) => !near(x, z));
  wallLine.forEach((t, i) => { if (i % 2) { t.kind = 1; t.r = 2.2 + rand() * 0.8; } });
  plants.push(...wallLine);
  for (const q of lotIsland) { const [x, z] = centre(q[0]); plants.push({ x, z, r: 2.2 + rand() * 0.8, kind: 1 }); }
  scatter(shrink(green, 2.4), 9, rand, plants, [0, 0, 1, 2], fromFlats(I.build), 0.75);
  line(diff(green, shrink(green, 1.2)), 0.5, 2.4, rand, plants, 4, (x, z) => !near(x, z) && rand() < 0.5);
  for (const [x, z, r] of I.circles) if (r > 8) plants.push({ x, z, r: Math.min(5, r - 7), kind: 0 });
  const gardenArea = area(union(G.lawn, G.bed, G.path));
  return {
    map: { road, island, fire, lot, lotIsland, apron, path: G.path, lawn: G.lawn, bed: G.bed, green, plants, benches: G.benches, gardenArea, openArea: area(diff(net, road, build, lot)) },
    lotBays, surfaceBays,
  };
}

function centre(r: Pt[]): Pt { let x = 0, z = 0; const n = r.length - 1 || 1; for (let i = 0; i < n; i++) { x += r[i][0]; z += r[i][1]; } return [x / n, z / n]; }

/** An empty map (no plot). */
export const NO_GROUND: GroundMap = { road: [], island: [], fire: [], lot: [], lotIsland: [], apron: [], path: [], lawn: [], bed: [], green: [], plants: [], benches: [], gardenArea: 0, openArea: 0 };

/** A flat ring with the corners that hardly bend it dropped (Douglas–Peucker, `tol` metres). */
export function simplify(r: number[], tol: number): number[] {
  const n = r.length / 2;
  if (n <= 4) return r;
  const keep = new Uint8Array(n);
  const seg = (a: number, b: number) => {
    let bi = -1, bd = tol;
    const ax = r[a * 2], az = r[a * 2 + 1], dx = r[b * 2] - ax, dz = r[b * 2 + 1] - az, L = Math.hypot(dx, dz) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((r[i * 2] - ax) * dz - (r[i * 2 + 1] - az) * dx) / L; if (d > bd) { bd = d; bi = i; } }
    if (bi >= 0) { keep[bi] = 1; seg(a, bi); seg(bi, b); }
  };
  // split at the corner farthest from the first
  let far = 0, fd = -1;
  for (let i = 1; i < n; i++) { const d = Math.hypot(r[i * 2] - r[0], r[i * 2 + 1] - r[1]); if (d > fd) { fd = d; far = i; } }
  keep[0] = keep[far] = 1;
  seg(0, far);
  // (the way back round to the first)
  const back = [...r.slice(far * 2), r[0], r[1]], m = back.length / 2, kb = new Uint8Array(m);
  const seg2 = (a: number, b: number) => {
    let bi = -1, bd = tol;
    const ax = back[a * 2], az = back[a * 2 + 1], dx = back[b * 2] - ax, dz = back[b * 2 + 1] - az, L = Math.hypot(dx, dz) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((back[i * 2] - ax) * dz - (back[i * 2 + 1] - az) * dx) / L; if (d > bd) { bd = d; bi = i; } }
    if (bi >= 0) { kb[bi] = 1; seg2(a, bi); seg2(bi, b); }
  };
  seg2(0, m - 1);
  for (let i = 1; i < m - 1; i++) if (kb[i]) keep[far + i] = 1;
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(r[i * 2], r[i * 2 + 1]);
  return out.length >= 6 ? out : r;
}
