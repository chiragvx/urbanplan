// OSM → clean road network ("network compiler").
//
//   A. raw graph from drivable OSM ways (split at shared nodes, clipped to the tile)
//   B. merge dual carriageways: paired one-way halves → one two-way road with a median
//   C. roundabouts: small rings → a single roundabout node (procedurally generated later)
//   D. collapse junction clusters: nodes joined by very short links → one junction
//   E. join chains through degree-2 nodes with identical attributes
//   F. assign road types (Indian defaults + OSM tags)
//   G. fit G1 cubic Béziers (shape nodes between pieces)
//   H. bridges: overpass vs valley, deck lifts, graded ramps
import {
  type V2, type RoadType, type RoadTypeSpec, type Network, type NetNode, type NetSegment, type PathLine, type BridgeKind,
  makeRoadType, fitCubics,
} from './model';

export interface OsmNode { id: number; lat: number; lon: number; tags: Record<string, string> }
export interface OsmWay { id: number; nds: number[]; tags: Record<string, string> }
export interface ImportInput {
  nodes: Map<number, OsmNode>;
  ways: OsmWay[];
  proj: (n: { lat: number; lon: number }) => V2;
  half: number;
  groundRails: V2[][];
  /** elevated rail lines (metro viaducts) */
  viaducts?: V2[][];
  terrain: (x: number, z: number) => number;
  /** measured road-reserve widths from the Development Plan, keyed by OSM way id */
  dpWidths?: Record<string, { w: number; n: number; iqr: number }>;
  /** is there a building footprint at (x, z)? (caps roads to today's free space) */
  buildingAt?: (x: number, z: number) => boolean;
  log?: (msg: string) => void;
}

const DP_STANDARD = [6, 7.5, 9, 12, 15, 18, 24, 30, 36, 45, 60];

/** Reserve width (m) for a set of OSM ways from DP measurements, snapped to standard DP widths. */
function dpReserve(wayIds: number[], dp: ImportInput['dpWidths']): number | null {
  if (!dp) return null;
  let sw = 0, sn = 0;
  for (const id of wayIds) {
    const m = dp[String(id)];
    if (!m || m.n < 4 || m.iqr > Math.max(4, 0.35 * m.w)) continue;
    sw += m.w * m.n; sn += m.n;
  }
  if (!sn) return null;
  const w = sw / sn;
  const std = DP_STANDARD.reduce((a, b) => (Math.abs(b - w) < Math.abs(a - w) ? b : a));
  return Math.abs(std - w) <= 1.5 ? std : Math.round(w * 2) / 2;
}

const DRIVE = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'road', 'busway', 'track']);
const PATHS = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway']);
const RANK: Record<string, number> = { motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4, unclassified: 5, residential: 5, busway: 4, living_street: 6, service: 7, road: 6, track: 8 };
const DECK = 6.5, GRADE = 0.065;

// ---------------- small geometry helpers ----------------
const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const dot = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1];
const len2 = (a: V2) => Math.hypot(a[0], a[1]);
const norm = (a: V2): V2 => { const l = len2(a) || 1; return [a[0] / l, a[1] / l]; };
const lerp = (a: V2, b: V2, t: number): V2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

function polyLen(p: V2[]) { let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return L; }

/** Uniform resample (keeps both ends). */
function resample(p: V2[], step: number): V2[] {
  const L = polyLen(p);
  if (L < 1e-6) return [p[0], p[p.length - 1]];
  const n = Math.max(1, Math.round(L / step));
  const out: V2[] = [p[0]];
  let i = 0, acc = 0;
  for (let k = 1; k < n; k++) {
    const target = (L * k) / n;
    while (i < p.length - 2 && acc + Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]) < target) { acc += Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]); i++; }
    const segL = Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]) || 1;
    out.push(lerp(p[i], p[i + 1], (target - acc) / segL));
  }
  out.push(p[p.length - 1]);
  return out;
}

function nearestOnPoly(p: V2[], q: V2) {
  let best = { d: Infinity, p: p[0] as V2, i: 0, t: 0, dir: [1, 0] as V2, s: 0 };
  let acc = 0;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i], b = p[i + 1], ab = sub(b, a), L = len2(ab);
    if (L < 1e-9) continue;
    const t = Math.max(0, Math.min(1, dot(sub(q, a), ab) / (L * L)));
    const c = lerp(a, b, t), d = Math.hypot(q[0] - c[0], q[1] - c[1]);
    if (d < best.d) best = { d, p: c, i, t, dir: [ab[0] / L, ab[1] / L], s: acc + L * t };
    acc += L;
  }
  return best;
}

/** Shift an edge's end so it lands on `to`, fading the shift over `fall` metres. */
function moveEnd(pts: V2[], atStart: boolean, to: V2, fall = 18) {
  const p = atStart ? pts : pts.slice().reverse();
  const delta = sub(to, p[0]);
  let acc = 0;
  for (let i = 0; i < p.length; i++) {
    if (i > 0) acc += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    const w = Math.max(0, 1 - acc / fall);
    if (w <= 0) break;
    p[i] = [p[i][0] + delta[0] * w, p[i][1] + delta[1] * w];
  }
  p[0] = to;
  const res = atStart ? p : p.reverse();
  for (let i = 0; i < pts.length; i++) pts[i] = res[i];
}

/** Fillet-smooth a polyline (keeps end points). */
function smooth(c: V2[], radius: number): V2[] {
  if (c.length < 3) return c;
  const out: V2[] = [c[0]];
  for (let i = 1; i < c.length - 1; i++) {
    const a = c[i - 1], v = c[i], b = c[i + 1];
    const u = sub(v, a), w = sub(b, v), la = len2(u), lb = len2(w);
    if (la < 1e-4 || lb < 1e-4) continue;
    const un = [u[0] / la, u[1] / la] as V2, wn = [w[0] / lb, w[1] / lb] as V2;
    const th = Math.acos(Math.max(-1, Math.min(1, dot(un, wn))));
    if (th < 0.003) { out.push(v); continue; }
    const d = Math.min(radius * Math.tan(th / 2), la * (i === 1 ? 0.9 : 0.5), lb * (i === c.length - 2 ? 0.9 : 0.5));
    const t1: V2 = [v[0] - un[0] * d, v[1] - un[1] * d], t2: V2 = [v[0] + wn[0] * d, v[1] + wn[1] * d];
    const steps = Math.max(2, Math.ceil(th / 0.05));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, k0 = (1 - t) * (1 - t), k1 = 2 * (1 - t) * t, k2 = t * t;
      out.push([k0 * t1[0] + k1 * v[0] + k2 * t2[0], k0 * t1[1] + k1 * v[1] + k2 * t2[1]]);
    }
  }
  out.push(c[c.length - 1]);
  return out;
}

class SegGrid {
  private cells = new Map<number, Set<number>>();
  constructor(private size = 30) {}
  private key(i: number, j: number) { return i * 73856093 ^ j * 19349663; }
  add(id: number, pts: V2[]) {
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1];
      const i0 = Math.floor(Math.min(a[0], b[0]) / this.size), i1 = Math.floor(Math.max(a[0], b[0]) / this.size);
      const j0 = Math.floor(Math.min(a[1], b[1]) / this.size), j1 = Math.floor(Math.max(a[1], b[1]) / this.size);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const kk = this.key(i, j);
        (this.cells.get(kk) ?? this.cells.set(kk, new Set()).get(kk)!).add(id);
      }
    }
  }
  query(p: V2, r: number): Set<number> {
    const out = new Set<number>();
    for (let j = Math.floor((p[1] - r) / this.size); j <= Math.floor((p[1] + r) / this.size); j++)
      for (let i = Math.floor((p[0] - r) / this.size); i <= Math.floor((p[0] + r) / this.size); i++)
        for (const id of this.cells.get(this.key(i, j)) ?? []) out.add(id);
    return out;
  }
}

/** Room each side of a road may use when other roads run parallel to it in the same corridor.
 *  The centre-to-centre gap to a parallel neighbour is split in proportion to the two roads' wanted half-widths.
 *  Returns half-width limits [left, right] (left = left of the a→b direction); Infinity where the side is open. */
function sideRoom(e: E, edges: Map<number, E>, grid: SegGrid, hwOf: (e: E) => number, apart?: (e: E, o: E) => boolean): [number, number] {
  const p = resample(e.pts, 6);
  const L = polyLen(e.pts);
  const me = hwOf(e);
  const room: number[][] = [[], []];
  let n = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const s = (i / (p.length - 1)) * L;
    if (s < 15 || s > L - 15) continue; // ends meet their junction arms; that's the junction's job
    n++;
    const d = norm(sub(p[i + 1], p[i - 1]));
    const best = [Infinity, Infinity];
    for (const oid of grid.query(p[i], 45)) {
      if (oid === e.id) continue;
      const o = edges.get(oid);
      if (!o || o.bridge !== e.bridge || o.layer !== e.layer || o.tunnel !== e.tunnel || apart?.(e, o)) continue;
      const nr = nearestOnPoly(o.pts, p[i]);
      if (nr.d > 45 || nr.d < 0.5 || Math.abs(dot(nr.dir, d)) < 0.8) continue;
      // which side: left normal of the a→b direction is (dz, -dx)
      const side = (nr.p[0] - p[i][0]) * d[1] - (nr.p[1] - p[i][1]) * d[0] > 0 ? 0 : 1;
      const ho = hwOf(o);
      const r = nr.d * me / (me + ho);
      if (r < best[side]) best[side] = r;
    }
    for (const k of [0, 1]) if (best[k] < Infinity) room[k].push(best[k]);
  }
  return room.map((r) => {
    if (!n || r.length < 0.4 * n) return Infinity; // neighbour only alongside briefly: ignore
    r.sort((a, b) => a - b);
    return r[Math.floor(r.length * 0.25)];
  }) as [number, number];
}

/** Free corridor width between buildings along a polyline (metres) at percentile `q`, or Infinity when unknown. */
function freeCorridor(pts: V2[], cap: number, at?: (x: number, z: number) => boolean, q = 0.15): number {
  if (!at) return Infinity;
  const p = resample(pts, 6);
  const ws: number[] = [];
  for (let i = 1; i < p.length - 1; i++) {
    const d = norm(sub(p[i + 1], p[i - 1]));
    const n: V2 = [d[1], -d[0]];
    let total = 0;
    for (const sg of [1, -1]) {
      let o = 0.5;
      while (o < cap / 2 + 3 && !at(p[i][0] + n[0] * o * sg, p[i][1] + n[1] * o * sg)) o += 0.5;
      total += o;
    }
    ws.push(total);
  }
  if (ws.length < 2) return Infinity;
  ws.sort((a, b) => a - b);
  return ws[Math.floor(ws.length * q)]; // default conservative: 15th percentile
}

/** Fraction of a polyline that runs parallel to, and within `maxD` of, any of `lines`. */
function parallelCover(pts: V2[], lines: V2[][], grid: SegGrid | null, maxD = 14): number {
  if (!lines.length || !grid) return 0;
  const p = resample(pts, 8);
  let hit = 0, n = 0;
  for (let i = 1; i < p.length - 1; i++) {
    n++;
    const d = norm(sub(p[i + 1], p[i - 1]));
    for (const li of grid.query(p[i], maxD)) {
      const nr = nearestOnPoly(lines[li], p[i]);
      if (nr.d <= maxD && Math.abs(dot(nr.dir, d)) > 0.85) { hit++; break; }
    }
  }
  return n ? hit / n : 0;
}

// ---------------- graph ----------------
interface E {
  id: number; a: number; b: number; pts: V2[];
  cls: string; link: boolean; name: string; oneway: boolean;
  lanesF: number; lanesB: number; lanesTag: number;
  sidewalkL: boolean; sidewalkR: boolean;
  layer: number; bridge: boolean; tunnel: boolean; roundabout: boolean;
  wayIds: number[];
  dualGap: number; // centre-to-centre distance of merged carriageways (0 = not merged)
}
interface N { id: number; x: number; z: number; signals: boolean; R?: number; ringLanes?: number }

class Graph {
  nodes = new Map<number, N>();
  edges = new Map<number, E>();
  adj = new Map<number, Set<number>>();
  private nid = 1e9;
  private eid = 1;
  newNode(x: number, z: number): N { const n = { id: this.nid++, x, z, signals: false }; this.nodes.set(n.id, n); return n; }
  addEdge(e: Omit<E, 'id'>): E {
    const full = { ...e, id: this.eid++ } as E;
    this.edges.set(full.id, full);
    for (const n of [full.a, full.b]) (this.adj.get(n) ?? this.adj.set(n, new Set()).get(n)!).add(full.id);
    return full;
  }
  removeEdge(id: number) {
    const e = this.edges.get(id);
    if (!e) return;
    this.edges.delete(id);
    this.adj.get(e.a)?.delete(id);
    this.adj.get(e.b)?.delete(id);
  }
  degree(n: number) { return this.adj.get(n)?.size ?? 0; }
  incident(n: number): E[] { return [...(this.adj.get(n) ?? [])].map((id) => this.edges.get(id)!).filter(Boolean); }
  /** Re-point an edge end from node `from` to node `to` (geometry end moved with falloff). */
  repoint(e: E, from: number, to: number) {
    const tn = this.nodes.get(to)!;
    if (e.a === from) { moveEnd(e.pts, true, [tn.x, tn.z]); e.a = to; }
    if (e.b === from) { moveEnd(e.pts, false, [tn.x, tn.z]); e.b = to; }
    this.adj.get(from)?.delete(e.id);
    (this.adj.get(to) ?? this.adj.set(to, new Set()).get(to)!).add(e.id);
  }
  /** Move a node, dragging incident edge ends with it. */
  moveNode(n: number, to: V2) {
    const node = this.nodes.get(n)!;
    node.x = to[0]; node.z = to[1];
    for (const e of this.incident(n)) { if (e.a === n) moveEnd(e.pts, true, to); if (e.b === n) moveEnd(e.pts, false, to); }
  }
  /** Split an edge at point index/param, returning the new node. */
  split(e: E, i: number, t: number): N {
    const p = lerp(e.pts[i], e.pts[i + 1], t);
    const n = this.newNode(p[0], p[1]);
    const first = [...e.pts.slice(0, i + 1), p], second = [p, ...e.pts.slice(i + 1)];
    this.removeEdge(e.id);
    const base = { ...e } as Partial<E>;
    delete base.id;
    this.addEdge({ ...(base as Omit<E, 'id'>), b: n.id, pts: first });
    this.addEdge({ ...(base as Omit<E, 'id'>), a: n.id, pts: second });
    return n;
  }
}

// ---------------- the compiler ----------------
export function importNetwork(inp: ImportInput): Network {
  const log = inp.log ?? (() => {});
  const G = new Graph();
  const H = inp.half - 1;
  const paths: PathLine[] = [];

  // ===== A. raw graph =====
  const usage = new Map<number, number>();
  const driveWays = inp.ways.filter((w) => {
    const h = (w.tags.highway ?? '').replace('_link', '');
    if (!DRIVE.has(h) || w.tags.area === 'yes') return false;
    if (h === 'service' && ['parking_aisle', 'driveway', 'drive-through'].includes(w.tags.service)) return false;
    return w.nds.length >= 2;
  });
  for (const w of driveWays) w.nds.forEach((id, i) => usage.set(id, (usage.get(id) ?? 0) + (i === 0 || i === w.nds.length - 1 ? 2 : 1)));
  const nodeFor = new Map<number, number>();
  const gnode = (osmId: number, p: V2) => {
    let id = nodeFor.get(osmId);
    if (id === undefined) {
      const n: N = { id: osmId, x: p[0], z: p[1], signals: inp.nodes.get(osmId)?.tags.highway === 'traffic_signals' };
      G.nodes.set(osmId, n);
      if (inp.nodes.get(osmId)?.tags.highway === 'mini_roundabout') { n.R = 5; n.ringLanes = 1; }
      nodeFor.set(osmId, osmId);
      id = osmId;
    }
    return id;
  };
  const inside = (p: V2) => Math.abs(p[0]) <= H && Math.abs(p[1]) <= H;
  const clipT = (a: V2, b: V2): number => { // first t in (0,1] where the segment leaves/enters the square
    let t = 1;
    for (const [c, d, lim] of [[a[0], b[0], H], [a[0], b[0], -H], [a[1], b[1], H], [a[1], b[1], -H]] as [number, number, number][]) {
      if ((c - lim) * (d - lim) < 0) t = Math.min(t, (lim - c) / (d - c));
    }
    return t;
  };

  for (const w of driveWays) {
    const t = w.tags;
    const h = (t.highway ?? '').replace('_link', '');
    let nds = w.nds.filter((id) => inp.nodes.has(id));
    let oneway = ['yes', '1', 'true'].includes(t.oneway) || t.junction === 'roundabout' || t.junction === 'circular' || t.highway === 'motorway' || (t.highway ?? '').endsWith('_link') && t.oneway !== 'no';
    if (t.oneway === '-1') { nds = nds.slice().reverse(); oneway = true; }
    if (t.oneway === 'no') oneway = false;
    const lanesTag = parseInt(t.lanes, 10) || 0;
    const sw = t.sidewalk ?? t['sidewalk:both'] ?? '';
    const swL = ['both', 'left', 'yes'].includes(sw) || t['sidewalk:left'] === 'yes';
    const swR = ['both', 'right', 'yes'].includes(sw) || t['sidewalk:right'] === 'yes';
    const attrs = {
      cls: h, link: (t.highway ?? '').endsWith('_link'), name: (t.name ?? '').trim(), oneway,
      lanesF: 0, lanesB: 0, lanesTag, sidewalkL: swL, sidewalkR: swR,
      layer: parseInt(t.layer ?? '0', 10) || 0, bridge: !!t.bridge && t.bridge !== 'no', tunnel: !!t.tunnel && t.tunnel !== 'no',
      roundabout: t.junction === 'roundabout' || t.junction === 'circular', wayIds: [w.id], dualGap: 0,
    };
    // walk the way: split at graph nodes, clip at the tile edge
    let cur: V2[] = [];
    let curStart = -1;
    const flush = (endNode: number) => {
      if (cur.length >= 2 && curStart !== endNode && polyLen(cur) > 0.5) G.addEdge({ ...attrs, a: curStart, b: endNode, pts: cur });
    };
    for (let i = 0; i < nds.length; i++) {
      const id = nds[i];
      const p = inp.proj(inp.nodes.get(id)!);
      const prev = i > 0 ? inp.proj(inp.nodes.get(nds[i - 1])!) : null;
      if (prev) {
        const pin = inside(prev), cin = inside(p);
        if (pin && !cin) { // leaving the tile
          const q = lerp(prev, p, clipT(prev, p));
          cur.push(q);
          const n = G.newNode(q[0], q[1]);
          flush(n.id);
          cur = []; curStart = -1;
          continue;
        }
        if (!pin && cin) { // entering
          const q = lerp(prev, p, clipT(prev, p));
          const n = G.newNode(q[0], q[1]);
          cur = [q]; curStart = n.id;
        }
        if (!pin && !cin) continue;
      } else if (!inside(p)) continue;
      if (curStart < 0) { curStart = gnode(id, p); cur = [p]; continue; }
      cur.push(p);
      const isGraphNode = (usage.get(id) ?? 0) > 1 || i === nds.length - 1;
      if (isGraphNode) {
        const n = gnode(id, p);
        flush(n);
        cur = [p]; curStart = n;
      }
    }
  }
  for (const w of inp.ways) {
    const h = w.tags.highway ?? '';
    if (!PATHS.has(h) || ['sidewalk', 'crossing'].includes(w.tags.footway)) continue;
    const pts = w.nds.filter((id) => inp.nodes.has(id)).map((id) => inp.proj(inp.nodes.get(id)!)).filter(inside);
    if (pts.length >= 2) paths.push({ pts: smooth(pts, 8).flat(), width: h === 'cycleway' ? 2.2 : h === 'pedestrian' ? 4 : 1.8, kind: h });
  }
  log(`raw graph: ${G.nodes.size} nodes, ${G.edges.size} edges, ${paths.length} paths`);

  const laneDefaults = (e: E) => {
    const L = e.lanesTag;
    if (e.oneway) { e.lanesF = L || (RANK[e.cls] <= 2 ? 2 : 1); e.lanesB = 0; }
    else if (L) { e.lanesF = Math.max(1, Math.ceil(L / 2)); e.lanesB = Math.max(0, Math.floor(L / 2)); if (L === 1) { e.lanesF = 1; e.lanesB = 0; } }
    else {
      const d = { motorway: 3, trunk: 3, primary: 2, secondary: 1, tertiary: 1, busway: 1 }[e.cls as 'trunk'] ?? 1;
      e.lanesF = d; e.lanesB = ['service', 'track'].includes(e.cls) ? 0 : d; // service lanes: single shared lane
    }
  };
  for (const e of G.edges.values()) laneDefaults(e);

  // ===== B. dual carriageways =====
  {
    const cand = [...G.edges.values()].filter((e) => e.oneway && !e.roundabout && !e.link && RANK[e.cls] <= 6 && polyLen(e.pts) > 2);
    const grid = new SegGrid(30);
    for (const e of cand) grid.add(e.id, e.pts);
    const candSet = new Set(cand.map((e) => e.id));
    type M = { p: V2; q: V2; d: number; f: number };
    const matches = new Map<number, (M | null)[]>();
    const samples = new Map<number, { p: V2; dir: V2 }[]>();
    for (const e of cand) {
      const pts = resample(e.pts, 4);
      const S = pts.map((p, i) => ({ p, dir: norm(sub(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)])) }));
      samples.set(e.id, S);
      const list: (M | null)[] = [];
      for (const s of S) {
        let best: M | null = null;
        for (const fid of grid.query(s.p, 34)) {
          if (fid === e.id || !candSet.has(fid)) continue;
          const f = G.edges.get(fid)!;
          if (f.cls !== e.cls && Math.abs(RANK[f.cls] - RANK[e.cls]) > 1) continue;
          if (e.name && f.name && e.name !== f.name) continue;
          if (f.bridge !== e.bridge || f.layer !== e.layer || f.tunnel !== e.tunnel) continue; // a deck and the road below aren't two halves of one road
          const nr = nearestOnPoly(f.pts, s.p);
          if (nr.d < 3 || nr.d > 32) continue;
          if (dot(s.dir, nr.dir) > -0.8) continue;
          const v = norm(sub(nr.p, s.p));
          if (Math.abs(dot(v, s.dir)) > 0.45) continue;
          const right: V2 = [-s.dir[1], s.dir[0]]; // opposite carriageway is on the right (left-hand traffic)
          if (dot(v, right) <= 0) continue;
          if (!best || nr.d < best.d) best = { p: s.p, q: nr.p, d: nr.d, f: fid };
        }
        list.push(best);
      }
      matches.set(e.id, list);
    }
    const halves = cand.filter((e) => { const m = matches.get(e.id)!; const k = m.filter(Boolean).length; return k >= 2 && k >= m.length * 0.5; });
    const isHalf = new Set(halves.map((e) => e.id));
    // partner counts
    const partners = new Map<number, Map<number, number>>();
    for (const e of halves) {
      const pm = new Map<number, number>();
      for (const m of matches.get(e.id)!) if (m && isHalf.has(m.f)) pm.set(m.f, (pm.get(m.f) ?? 0) + 1);
      partners.set(e.id, pm);
    }
    // two-colour: partners opposite, direction-continuations same
    const color = new Map<number, number>();
    for (const h0 of halves) {
      if (color.has(h0.id)) continue;
      color.set(h0.id, 0);
      const q = [h0.id];
      while (q.length) {
        const id = q.pop()!;
        const e = G.edges.get(id)!, c = color.get(id)!;
        for (const [f, k] of partners.get(id)!) if (k >= 2 && !color.has(f)) { color.set(f, 1 - c); q.push(f); }
        for (const n of [e.a, e.b]) for (const g of G.incident(n)) {
          if (g.id === id || !isHalf.has(g.id) || color.has(g.id)) continue;
          const de = n === e.b ? norm(sub(e.pts[e.pts.length - 1], e.pts[e.pts.length - 2])) : norm(sub(e.pts[1], e.pts[0]));
          const dg = n === g.a ? norm(sub(g.pts[1], g.pts[0])) : norm(sub(g.pts[g.pts.length - 1], g.pts[g.pts.length - 2]));
          const continues = (n === e.b && n === g.a) || (n === e.a && n === g.b);
          if (continues && dot(de, dg) > 0.6) { color.set(g.id, c); q.push(g.id); }
        }
      }
    }
    const kept = halves.filter((e) => color.get(e.id) === 0);
    const dropped = halves.filter((e) => color.get(e.id) === 1);
    // medial geometry for kept halves
    const proposals = new Map<number, V2[]>();
    for (const e of kept) {
      const S = samples.get(e.id)!, M = matches.get(e.id)!;
      const offs: (V2 | null)[] = M.map((m) => (m ? [(m.q[0] - m.p[0]) / 2, (m.q[1] - m.p[1]) / 2] : null));
      const ds = M.filter(Boolean).map((m) => m!.d);
      const newPts: V2[] = S.map((s, i) => {
        let o = offs[i];
        if (!o) { // borrow the nearest matched offset
          for (let k = 1; k < S.length && !o; k++) o = offs[i - k] ?? offs[i + k] ?? null;
        }
        return o ? [s.p[0] + o[0], s.p[1] + o[1]] : s.p;
      });
      e.pts = newPts;
      e.oneway = false;
      const pl = [...partners.get(e.id)!.keys()].map((f) => G.edges.get(f)!.lanesF);
      e.lanesB = pl.length ? Math.round(pl.reduce((a, b) => a + b, 0) / pl.length) : e.lanesF;
      e.dualGap = ds.reduce((a, b) => a + b, 0) / ds.length;
      e.wayIds = [...e.wayIds, ...[...partners.get(e.id)!.keys()].flatMap((f) => G.edges.get(f)!.wayIds)];
      for (const [n, p] of [[e.a, newPts[0]], [e.b, newPts[newPts.length - 1]]] as [number, V2][]) (proposals.get(n) ?? proposals.set(n, []).get(n)!).push(p);
    }
    for (const [n, ps] of proposals) {
      const avg: V2 = [ps.reduce((a, p) => a + p[0], 0) / ps.length, ps.reduce((a, p) => a + p[1], 0) / ps.length];
      G.moveNode(n, avg);
    }
    // re-attach whatever hung off the dropped halves onto the merged centre line
    const keptIds = new Set(kept.map((e) => e.id));
    const droppedIds = new Set(dropped.map((e) => e.id));
    const keptNodes = new Set(kept.flatMap((e) => [e.a, e.b]));
    const kgrid = new SegGrid(30);
    for (const e of kept) kgrid.add(e.id, e.pts);
    const map = new Map<number, number>();
    for (const f of dropped) for (const n of [f.a, f.b]) {
      if (map.has(n) || keptNodes.has(n)) continue;
      const node = G.nodes.get(n)!;
      let best: { e: E; nr: ReturnType<typeof nearestOnPoly>; score: number } | null = null;
      for (const id of kgrid.query([node.x, node.z], 30)) {
        const e = G.edges.get(id);
        if (!e || !keptIds.has(id)) continue;
        const nr = nearestOnPoly(e.pts, [node.x, node.z]);
        if (nr.d >= 30) continue;
        // the same road at the same level first — not a flyover running down the merged centre line above it
        const score = nr.d + (e.bridge !== f.bridge || e.layer !== f.layer || e.tunnel !== f.tunnel ? 60 : 0) + (e.name && f.name && e.name !== f.name ? 30 : 0);
        if (!best || score < best.score) best = { e, nr, score };
      }
      if (!best) continue;
      const L = polyLen(best.e.pts);
      let target: number;
      if (best.nr.s < 10) target = best.e.a;
      else if (L - best.nr.s < 10) target = best.e.b;
      else {
        const nn = G.split(best.e, best.nr.i, best.nr.t);
        keptIds.delete(best.e.id);
        for (const ne of G.incident(nn.id)) { keptIds.add(ne.id); kgrid.add(ne.id, ne.pts); }
        target = nn.id;
      }
      map.set(n, target);
      keptNodes.add(target);
    }
    for (const f of dropped) G.removeEdge(f.id);
    for (const [n, m] of map) {
      for (const e of G.incident(n)) if (!droppedIds.has(e.id)) G.repoint(e, n, m);
      if (G.degree(n) === 0) G.nodes.delete(n);
    }
    for (const e of [...G.edges.values()]) if (e.a === e.b && polyLen(e.pts) < 40) G.removeEdge(e.id);
    log(`dual carriageways: ${kept.length} halves kept as divided roads, ${dropped.length} partner halves merged, ${map.size} junctions re-attached`);
  }

  // ===== C. roundabouts =====
  {
    const ring = [...G.edges.values()].filter((e) => e.roundabout);
    const seen = new Set<number>();
    let small = 0, big = 0;
    for (const r0 of ring) {
      if (seen.has(r0.id)) continue;
      const comp: E[] = [];
      const q = [r0];
      seen.add(r0.id);
      while (q.length) {
        const e = q.pop()!;
        comp.push(e);
        for (const n of [e.a, e.b]) for (const g of G.incident(n)) if (g.roundabout && !seen.has(g.id)) { seen.add(g.id); q.push(g); }
      }
      const pts = comp.flatMap((e) => e.pts);
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cz = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      const R = pts.reduce((a, p) => a + Math.hypot(p[0] - cx, p[1] - cz), 0) / pts.length;
      const ringNodes = new Set(comp.flatMap((e) => [e.a, e.b]));
      if (R <= 40 && R >= 3 && ringNodes.size >= 2) {
        const c = G.newNode(cx, cz);
        c.R = R;
        c.ringLanes = Math.max(1, ...comp.map((e) => e.lanesTag || (R > 16 ? 2 : 1)));
        for (const e of comp) G.removeEdge(e.id);
        for (const n of ringNodes) {
          for (const e of G.incident(n)) {
            // spoke: extend from the ring point to the centre so the network meets at one node
            if (e.a === n) { e.pts.unshift([cx, cz]); e.a = c.id; }
            if (e.b === n) { e.pts.push([cx, cz]); e.b = c.id; }
            G.adj.get(n)?.delete(e.id);
            G.adj.get(c.id) ?? G.adj.set(c.id, new Set());
            G.adj.get(c.id)!.add(e.id);
          }
          G.nodes.delete(n);
        }
        small++;
      } else {
        // big ring: keep as roads, but make them exact circular arcs
        for (const e of comp) e.pts = e.pts.map((p) => { const a = Math.atan2(p[1] - cz, p[0] - cx); return [cx + Math.cos(a) * R, cz + Math.sin(a) * R] as V2; });
        big++;
      }
    }
    log(`roundabouts: ${small} → roundabout nodes, ${big} large rings kept as roads`);
  }

  // ===== F (early). road types — needed for widths in clustering =====
  const types: Record<string, RoadType> = {};
  const typeOf = new Map<number, RoadType>();
  const reserveOf = new Map<number, number>();
  const viaGrid = inp.viaducts?.length ? new SegGrid(40) : null;
  inp.viaducts?.forEach((l, i) => viaGrid!.add(i, l));
  const underViaduct = new Set<number>();
  const roomOf = new Map<number, [number, number]>(); // corridor sharing with parallel roads
  // DP roads: what each piece would get on its own (`rawOf`), and the width / median harmonised along the whole
  // road (`dpTarget`) — so a road keeps one cross-section instead of changing at every shop that sticks out
  const rawOf = new Map<number, { Rdp: number; R: number; med: number }>();
  const dpTarget = new Map<number, { R: number; med: number }>();
  // flyovers over a road corridor (a bridge, or the untagged ramp that runs up to one, with a ground road alongside):
  // they don't share the corridor's width with the road under them, and aren't sized from its DP reserve
  const flyover = new Set<number>();
  // the geometry passes (corridor sharing, junction clusters, curve smoothing) keep the original width rule so road
  // shapes and ids stay stable for maps edited on earlier bakes; the cross-sections use the newer rule at the end
  let modern = false;
  let dpUsed = 0;
  const assignType = (e: E) => {
    const piers = RANK[e.cls] <= 4 && parallelCover(e.pts, inp.viaducts ?? [], viaGrid, e.oneway ? 26 : 14) >= 0.5;
    if (piers) underViaduct.add(e.id); else underViaduct.delete(e.id);
    const major = RANK[e.cls] <= 3;
    const laneW = { motorway: 3.6, trunk: 3.5, primary: 3.5, secondary: 3.3, tertiary: 3.2, busway: 3.5 }[e.cls as 'trunk'] ?? (e.cls === 'service' || e.cls === 'track' ? 4.0 : 3.0);
    const median = e.dualGap > 0 ? Math.max(0.8, Math.min(6, e.dualGap - laneW * (e.lanesF + e.lanesB) / 2)) : (!e.oneway && e.lanesF + e.lanesB >= 4 && RANK[e.cls] <= 2 ? 1.2 : 0);
    let spec: RoadTypeSpec;
    // bridges are built structures: the DP reserve is the corridor planned around them, not their width
    const Rdp = !['service', 'track', 'living_street'].includes(e.cls) && !flyover.has(e.id) && !(modern && e.bridge) ? dpReserve(e.wayIds, inp.dpWidths) : null;
    // today's road: the DP reserve, but never wider than the free space between existing buildings
    // ... and never wider than its share of the corridor when other roads run alongside (the DP reserve
    // covers the whole corridor: main road + service roads + BRTS, not each of them)
    const [roomL, roomR] = roomOf.get(e.id) ?? [Infinity, Infinity];
    const share = 2 * Math.min(roomL, roomR);
    const Rraw = Rdp ? Math.max(Math.min(Rdp, freeCorridor(e.pts, Rdp, inp.buildingAt) - 0.6, share), Math.min(Rdp, 6)) : null;
    const tgt = dpTarget.get(e.id);
    const R = Rraw && Rdp && tgt ? Math.max(Math.min(tgt.R, share), Math.min(Rdp, 6)) : Rraw;
    if (R && Rdp && !modern) {
      // (original rule — geometry passes only)
      const fp = R >= 24 ? 3 : R >= 18 ? 2.5 : R >= 12 ? 1.8 : R >= 9 ? 1.2 : 0;
      let med = e.oneway ? 0 : e.dualGap > 0 ? Math.min(median, Math.max(1.2, 0.2 * R)) : R >= 30 ? 1.5 : 0;
      if (piers && !e.oneway) med = Math.max(med, 2.5);
      const carriage = Math.max(3, R - 2 * fp - med);
      let total: number;
      if (e.dualGap > 0) total = e.lanesF + e.lanesB;
      else if (e.lanesTag) total = e.lanesTag;
      else if (e.oneway) total = Math.max(1, Math.round(carriage / laneW));
      else total = Math.max(2, Math.round(carriage / laneW / 2) * 2);
      total = Math.min(e.oneway ? 5 : 10, total);
      const lw = Math.min(4.2, Math.max(2.8, carriage / total));
      const lf = e.oneway ? total : Math.ceil(total / 2), lb = e.oneway ? 0 : total - lf;
      const leftover = Math.max(0, (R - lw * total - med) / 2);
      const side = Math.min(3.5, leftover);
      const shoulder = Math.min(3, leftover - side);
      spec = { lanesF: lf, lanesB: lb, laneW: lw, median: med, sidewalkL: Math.round(side * 10) / 10, sidewalkR: Math.round(side * 10) / 10, shoulder: Math.round(shoulder * 10) / 10, oneway: e.oneway, surface: 'asphalt', major };
      reserveOf.set(e.id, Rdp);
      dpUsed++;
    } else if (R && Rdp) {
      // Development Plan reserve: the road is laid out at its design width (the whole road's typical width once
      // harmonised) — footpaths by size, the rest carriageway filled with lanes — then fitted into this piece
      const D = tgt ? Math.max(R, tgt.R) : R;
      const fp = D >= 24 ? 3 : D >= 18 ? 2.5 : D >= 12 ? 1.8 : D >= 9 ? 1.2 : 0;
      let med = e.oneway ? 0 : e.dualGap > 0 ? Math.min(median, Math.max(1.2, 0.2 * D)) : D >= 30 ? 1.5 : 0;
      if (piers && !e.oneway) med = Math.max(med, 2.5); // metro piers stand in the median
      rawOf.set(e.id, { Rdp, R: Rraw!, med });
      if (tgt && !e.oneway && med > 0) med = Math.max(piers ? 2.5 : 0.8, tgt.med); // the road's median
      const carriage = Math.max(3, D - 2 * fp - med);
      // lanes: the tagged count while it fits the carriageway at a sensible width (OSM often tags one lane per
      // half of a divided road, or none) — otherwise as many 3.0-3.5 m lanes as the carriageway holds (IRC:86)
      const maxW = Math.max(3.5, laneW);
      const tagged = e.dualGap > 0 ? e.lanesF + e.lanesB : e.lanesTag; // merged divided road: per-direction counts
      let total: number;
      if (tagged && carriage / tagged <= maxW + 0.25) total = tagged;
      else if (e.oneway) total = Math.max(1, Math.round(carriage / laneW));
      else total = Math.max(2, Math.round(carriage / laneW / 2) * 2);
      total = Math.min(e.oneway ? 5 : 10, total);
      let lw = Math.min(maxW, Math.max(2.8, carriage / total));
      // where buildings or a parallel road pinch it: narrower footpaths first, then the median, then lanes —
      // so a road keeps its lanes along its length instead of changing at every pinch
      const minSide = D >= 12 ? 1.5 : D >= 9 ? 0.9 : 0;
      const room = Math.max(3, R - 2 * minSide);
      if (lw * total + med > room && med > 0) med = Math.max(piers ? 2.5 : 0.8, room - lw * total);
      if (lw * total + med > room) lw = Math.max(2.8, (room - med) / total);
      const step = e.oneway ? 1 : 2;
      while (lw * total + med > room && total - step >= step) { total -= step; lw = Math.min(maxW, Math.max(2.8, (room - med) / total)); }
      lw = lw >= 3 ? Math.floor(lw * 4 + 1e-6) / 4 : Math.floor(lw * 10 + 1e-6) / 10; // standard 3.0 / 3.25 / 3.5 m lanes
      const lf = e.oneway ? total : Math.ceil(total / 2), lb = e.oneway ? 0 : total - lf;
      const used = lw * total + med;
      const leftover = Math.max(0, (R - used) / 2);
      let side = Math.min(3.5, leftover);          // footpaths at most 3.5 m
      let shoulder = Math.min(3, leftover - side); // the rest: kerbside asphalt (parking / service strip)
      if (shoulder < 0.6) { side += shoulder; shoulder = 0; } // no slivers: a few cm more footpath instead
      spec = { lanesF: lf, lanesB: lb, laneW: lw, median: Math.round(med * 10) / 10, sidewalkL: Math.round(side * 10) / 10, sidewalkR: Math.round(side * 10) / 10, shoulder: Math.round(shoulder * 10) / 10, oneway: e.oneway, surface: 'asphalt', major };
      reserveOf.set(e.id, Rdp);
      dpUsed++;
    } else {
      const sideDefault = RANK[e.cls] <= 3 ? (e.dualGap > 0 || RANK[e.cls] <= 2 ? 2.0 : 1.5) : 0; // Pune: main roads have footpaths, lanes mostly don't
      const sw = (flag: boolean) => (flyover.has(e.id) ? (flag ? 1.5 : 0) : flag ? Math.max(1.5, sideDefault) : sideDefault); // decks: crash barriers, not footpaths
      spec = {
        lanesF: Math.max(1, e.lanesF), lanesB: e.oneway ? 0 : e.lanesB, laneW, median: e.oneway ? 0 : piers ? Math.max(median, 2.5) : median,
        sidewalkL: e.cls === 'track' ? 0 : sw(e.sidewalkL), sidewalkR: e.cls === 'track' ? 0 : sw(e.sidewalkR),
        shoulder: 0, oneway: e.oneway, surface: e.cls === 'track' ? 'dirt' : 'asphalt', major,
      };
      // squeeze into the corridor share: footpaths on the crowded side first, then lane widths
      const lanes = spec.lanesF + spec.lanesB;
      const half = (lanes * spec.laneW + spec.median) / 2;
      spec.sidewalkL = Math.max(0, Math.min(spec.sidewalkL, roomL - half));
      spec.sidewalkR = Math.max(0, Math.min(spec.sidewalkR, roomR - half));
      const roomMin = Math.min(roomL, roomR);
      if (half > roomMin) spec.laneW = Math.max(2.8, (2 * roomMin - spec.median) / lanes);
    }
    const t = makeRoadType(spec);
    types[t.id] = t;
    typeOf.set(e.id, t);
    return t;
  };
  for (const e of G.edges.values()) assignType(e);
  const hwOf = (e: E) => { const t = typeOf.get(e.id) ?? assignType(e); return Math.max(t.hwL, t.hwR); };
  const shareCorridors = () => {
    roomOf.clear();
    for (const e of G.edges.values()) assignType(e); // wanted widths, unconstrained
    const grid = new SegGrid(40);
    for (const e of G.edges.values()) grid.add(e.id, e.pts);
    const want = new Map<number, number>();
    for (const e of G.edges.values()) want.set(e.id, hwOf(e));
    const wantOf = (e: E) => want.get(e.id) ?? hwOf(e);
    let squeezed = 0;
    for (const e of G.edges.values()) {
      const r = sideRoom(e, G.edges, grid, wantOf);
      if (Math.min(r[0], r[1]) < wantOf(e)) { roomOf.set(e.id, r); squeezed++; }
    }
    dpUsed = 0;
    for (const e of G.edges.values()) assignType(e);
    return squeezed;
  };
  log(`corridor sharing: ${shareCorridors()} roads narrowed to fit beside parallel roads`);

  // ===== D. collapse junction clusters =====
  {
    const parent = new Map<number, number>();
    const find = (x: number): number => { let r = x; while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!; return r; };
    const nodeHw = (n: number) => Math.max(0, ...G.incident(n).map(hwOf));
    // grow clusters shortest link first, and only while the cluster stays compact — otherwise a corridor of
    // short links (BRTS + service roads) chains into one long cluster that then can't be collapsed at all
    const members = new Map<number, number[]>();
    const short: [E, number][] = [];
    for (const e of G.edges.values()) {
      if (e.a === e.b) continue;
      const L = polyLen(e.pts);
      // only when the other junction sits inside this one's widest carriageway (a divided road's crossing, a
      // doubled point): junctions further apart — staggered T-junctions, side roads 15-20 m apart — stay apart, so
      // their roads aren't bent sideways to meet at one point
      const thr = Math.min(16, Math.max(nodeHw(e.a), nodeHw(e.b)) + 2);
      if (L < thr && G.degree(e.a) > 1 && G.degree(e.b) > 1) short.push([e, L]);
    }
    short.sort((p, q) => p[1] - q[1]);
    for (const [e] of short) {
      const ra = find(e.a), rb = find(e.b);
      if (ra === rb) continue;
      const all = [...(members.get(ra) ?? [ra]), ...(members.get(rb) ?? [rb])];
      const ns = all.map((m) => G.nodes.get(m)!);
      const ring = ns.find((n) => n.R);
      const cx = ring ? ring.x : ns.reduce((a, n) => a + n.x, 0) / ns.length, cz = ring ? ring.z : ns.reduce((a, n) => a + n.z, 0) / ns.length;
      if (ns.some((n) => Math.hypot(n.x - cx, n.z - cz) > (ring ? (ring.R ?? 0) + 18 : 22))) continue;
      parent.set(ra, rb); if (!parent.has(rb)) parent.set(rb, rb);
      members.set(rb, all); members.delete(ra);
    }
    const clusters = new Map<number, number[]>();
    for (const n of parent.keys()) { const r = find(n); (clusters.get(r) ?? clusters.set(r, []).get(r)!).push(n); }
    let collapsed = 0;
    for (const ms of clusters.values()) {
      if (ms.length < 2) continue;
      const ns = ms.map((m) => G.nodes.get(m)!).filter(Boolean);
      const rb = ns.find((n) => n.R);
      const c: V2 = rb ? [rb.x, rb.z] : [ns.reduce((a, n) => a + n.x, 0) / ns.length, ns.reduce((a, n) => a + n.z, 0) / ns.length];
      if (ns.some((n) => Math.hypot(n.x - c[0], n.z - c[1]) > (rb ? (rb.R ?? 0) + 18 : 22))) continue; // too spread out to be one junction
      const target = rb ? rb : G.newNode(c[0], c[1]);
      target.signals = ns.some((n) => n.signals);
      const set = new Set(ms);
      for (const n of ms) {
        if (n === target.id) continue;
        for (const e of G.incident(n)) {
          const inner = set.has(e.a) && set.has(e.b);
          if (inner) G.removeEdge(e.id);
          else G.repoint(e, n, target.id);
        }
        G.nodes.delete(n);
        G.adj.delete(n);
      }
      if (!rb) G.moveNode(target.id, c);
      collapsed++;
    }
    for (const e of [...G.edges.values()]) if (e.a === e.b && polyLen(e.pts) < 60) G.removeEdge(e.id);
    log(`junction clusters collapsed: ${collapsed}`);
  }

  // ===== E. join chains =====
  {
    const key = (e: E) => [e.cls, e.link, e.name, e.oneway, e.lanesF, e.lanesB, Math.round(e.dualGap / 2), e.sidewalkL, e.sidewalkR, e.bridge, e.layer, e.tunnel].join('|');
    let merged = 0;
    for (const n of [...G.nodes.keys()]) {
      const node = G.nodes.get(n);
      if (!node || node.R || node.signals || G.degree(n) !== 2) continue;
      const inc = G.incident(n);
      if (inc.length !== 2 || inc[0].id === inc[1].id || key(inc[0]) !== key(inc[1])) continue;
      // find an orientation A → n → B (two-way roads may be reversed, one-way roads may not)
      const rev = (e: E) => { e.pts.reverse(); [e.a, e.b] = [e.b, e.a]; };
      let pair: [E, E] | null = null;
      for (const [A, B] of [[inc[0], inc[1]], [inc[1], inc[0]]] as [E, E][]) {
        const aOk = A.b === n || (!A.oneway && A.a === n);
        const bOk = B.a === n || (!B.oneway && B.b === n);
        if (aOk && bOk) { if (A.b !== n) rev(A); if (B.a !== n) rev(B); pair = [A, B]; break; }
      }
      if (!pair) continue;
      const [e1, e2] = pair;
      if (e1.a === e2.b) continue;
      const base = { ...e1 } as Partial<E>;
      delete base.id;
      G.removeEdge(e1.id); G.removeEdge(e2.id);
      const ne = G.addEdge({ ...(base as Omit<E, 'id'>), b: e2.b, pts: [...e1.pts, ...e2.pts.slice(1)], wayIds: [...new Set([...e1.wayIds, ...e2.wayIds])] });
      typeOf.set(ne.id, typeOf.get(e1.id)!);
      G.nodes.delete(n);
      G.adj.delete(n);
      merged++;
    }
    // remove tiny dangling stubs left by merging/clipping
    for (const e of [...G.edges.values()]) {
      if (polyLen(e.pts) < 6 && (G.degree(e.a) === 1 || G.degree(e.b) === 1)) G.removeEdge(e.id);
    }
    for (const [id] of G.nodes) if (G.degree(id) === 0) G.nodes.delete(id);
    log(`chains joined: ${merged}; final ${G.nodes.size} nodes, ${G.edges.size} roads`);
  }
  dpUsed = 0;
  // final typing (merged ways → combined DP evidence), sharing corridors with parallel roads
  const squeezed = shareCorridors();
  log(`corridor sharing (final): ${squeezed} roads narrowed`);
  // one cross-section per DP road: the typical width and median along it (length-weighted median), except where
  // buildings pinch it along most of a piece at least 40 m long — those keep their narrower width
  const geomHw = new Map<number, number>();
  for (const e of G.edges.values()) geomHw.set(e.id, hwOf(e));
  {
    modern = true;
    // flyovers: decks and the ramps that touch them, wherever a ground road runs alongside most of their length
    const decked = (e: E) => e.bridge || e.layer >= 1;
    const deckNodes = new Set([...G.edges.values()].filter((e) => decked(e) && !e.tunnel).flatMap((e) => [e.a, e.b]));
    const cand = [...G.edges.values()].filter((e) => !e.tunnel && (decked(e) || ((deckNodes.has(e.a) || deckNodes.has(e.b)) && RANK[e.cls] <= 4)));
    const candIds = new Set(cand.map((e) => e.id));
    const groundLines: V2[][] = [], gGrid = new SegGrid(40);
    for (const e of G.edges.values()) if (!candIds.has(e.id) && !e.tunnel && RANK[e.cls] <= 5) { gGrid.add(groundLines.length, e.pts); groundLines.push(e.pts); }
    for (const e of cand) if (parallelCover(e.pts, groundLines, gGrid, 20) >= 0.4) flyover.add(e.id);
    // the roads alongside them get their width back (the deck is above, not beside)
    if (flyover.size) {
      const grid = new SegGrid(40);
      for (const e of G.edges.values()) grid.add(e.id, e.pts);
      const apart = (e: E, o: E) => flyover.has(e.id) !== flyover.has(o.id);
      for (const e of G.edges.values()) {
        if (!roomOf.has(e.id)) continue;
        const hw = (x: E) => geomHw.get(x.id) ?? hwOf(x);
        const r = sideRoom(e, G.edges, grid, hw, apart), r0 = sideRoom(e, G.edges, grid, hw);
        if (r[0] === r0[0] && r[1] === r0[1]) continue; // no flyover alongside: as it was
        if (Number.isFinite(Math.min(r[0], r[1]))) roomOf.set(e.id, r); else roomOf.delete(e.id);
      }
    }
    log(`flyovers over road corridors: ${flyover.size} pieces sized on their own`);
    dpUsed = 0;
    for (const e of G.edges.values()) assignType(e); // each piece on its own (fills rawOf)
    const groups = new Map<string, E[]>();
    for (const e of G.edges.values()) {
      const r = rawOf.get(e.id);
      if (!r) continue;
      const k = [e.name || `w${e.wayIds[0]}`, r.Rdp, e.cls, e.oneway, e.dualGap > 0].join('|');
      (groups.get(k) ?? groups.set(k, []).get(k)!).push(e);
    }
    const wmedian = (xs: [number, number][]) => {
      xs.sort((a, b) => a[0] - b[0]);
      const tot = xs.reduce((a, x) => a + x[1], 0);
      let acc = 0;
      for (const [v, w] of xs) { acc += w; if (acc >= tot / 2) return v; }
      return xs[xs.length - 1][0];
    };
    let pinched = 0, evened = 0;
    for (const es of groups.values()) {
      const L = es.map((e) => polyLen(e.pts));
      const R = Math.round(wmedian(es.map((e, i) => [rawOf.get(e.id)!.R, L[i]])) * 2) / 2;
      const med = Math.round(wmedian(es.map((e, i) => [rawOf.get(e.id)!.med, L[i]])) * 10) / 10;
      es.forEach((e, i) => {
        const r = rawOf.get(e.id)!;
        let w = R;
        if (r.R < R - 2 && L[i] >= 40) {
          const typical = freeCorridor(e.pts, r.Rdp, inp.buildingAt, 0.5) - 0.6; // most of the piece, not one shop
          if (typical < R - 2) { w = Math.max(Math.min(r.Rdp, 6), Math.floor(Math.max(r.R, typical) * 2) / 2); pinched++; }
        }
        if (Math.abs(w - r.R) > 0.05 || Math.abs(med - r.med) > 0.05) evened++;
        dpTarget.set(e.id, { R: w, med });
      });
    }
    dpUsed = 0;
    for (const e of G.edges.values()) assignType(e);
    // a short DP piece between two longer ones of the same road (a stub between a junction and a flyover's touchdown,
    // with a reserve of its own) takes the cross-section of the longer road it carries straight on into — a width
    // that jumps there and back within a few metres can't taper
    let stubs = 0;
    for (const e of G.edges.values()) {
      if (!reserveOf.has(e.id) || !e.name || polyLen(e.pts) >= 40) continue;
      let best: E | null = null, bestL = 40;
      for (const [n, atA] of [[e.a, true], [e.b, false]] as [number, boolean][]) {
        const de = atA ? norm(sub(e.pts[1], e.pts[0])) : norm(sub(e.pts[e.pts.length - 2], e.pts[e.pts.length - 1]));
        for (const f of G.incident(n)) {
          if (f.id === e.id || f.name !== e.name || f.cls !== e.cls || f.oneway !== e.oneway || flyover.has(f.id)) continue;
          const df = n === f.a ? norm(sub(f.pts[1], f.pts[0])) : norm(sub(f.pts[f.pts.length - 2], f.pts[f.pts.length - 1]));
          const L = polyLen(f.pts);
          if (dot(de, df) < -0.9 && L > bestL) { best = f; bestL = L; }
        }
      }
      if (best && typeOf.get(best.id) !== typeOf.get(e.id)) { typeOf.set(e.id, typeOf.get(best.id)!); stubs++; }
    }
    log(`DP roads: ${stubs} short pieces given the cross-section of the road they carry on into`);
    log(`DP roads: ${groups.size} roads given one cross-section (${evened} pieces evened out, ${pinched} kept narrower where buildings pinch them)`);
  }
  log(`road widths: ${dpUsed} of ${G.edges.size} roads sized from the Development Plan reserve; ${underViaduct.size} roads under the metro get a pier median`);

  // ===== H (part 1). bridges: overpass vs valley =====
  const kind = new Map<number, BridgeKind>();
  const deck = new Map<number, number>();
  {
    const grid = new SegGrid(40);
    const ground = [...G.edges.values()].filter((e) => !e.bridge && e.layer < 1);
    for (const e of ground) grid.add(e.id, e.pts);
    const cross = (a: V2, b: V2, c: V2, d: V2) => {
      const o = (p: V2, q: V2, r: V2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
      return o(c, d, a) * o(c, d, b) < 0 && o(a, b, c) * o(a, b, d) < 0;
    };
    for (const e of G.edges.values()) {
      if (e.tunnel || !(e.bridge || e.layer >= 1)) { kind.set(e.id, 'none'); continue; }
      let over = false;
      for (let i = 0; i < e.pts.length - 1 && !over; i++) {
        const a = e.pts[i], b = e.pts[i + 1];
        for (const id of grid.query(lerp(a, b, 0.5), len2(sub(b, a)) / 2 + 5)) {
          const g = G.edges.get(id);
          if (!g || g.a === e.a || g.a === e.b || g.b === e.a || g.b === e.b) continue;
          // a road passing under it — not one that just ends under the deck (joining the carriageway below)
          const gl = polyLen(g.pts);
          for (let k = 0, s = 0; k < g.pts.length - 1 && !over; s += len2(sub(g.pts[k + 1], g.pts[k])), k++) {
            if (!cross(a, b, g.pts[k], g.pts[k + 1])) continue;
            const p = g.pts[k], q = g.pts[k + 1], o = (u: V2) => (b[0] - a[0]) * (u[1] - a[1]) - (b[1] - a[1]) * (u[0] - a[0]);
            const t = o(p) / (o(p) - o(q)), sc = s + t * len2(sub(q, p));
            if (sc > 4 && gl - sc > 4) over = true;
          }
        }
        for (const r of inp.groundRails) for (let k = 0; k < r.length - 1 && !over; k++) if (cross(a, b, r[k], r[k + 1])) over = true;
      }
      kind.set(e.id, over ? 'overpass' : 'valley');
      deck.set(e.id, over ? DECK * Math.max(1, e.layer) : 0);
    }
  }
  // lifts at nodes, relaxed along ordinary roads
  const lift = new Map<number, number>();
  for (const e of G.edges.values()) if (kind.get(e.id) === 'overpass') for (const n of [e.a, e.b]) lift.set(n, Math.max(lift.get(n) ?? 0, deck.get(e.id)!));
  {
    // a junction of three or more ordinary roads stays on the ground: a deck that ends close to one (OSM often tags only
    // the span as a bridge) ramps down into it, rather than lifting the junction and every road off it
    const grounded = (n: number) => !lift.has(n) && G.incident(n).filter((g) => kind.get(g.id) === 'none').length >= 3;
    let changed = true, guard = 0;
    while (changed && guard++ < 200) {
      changed = false;
      for (const e of G.edges.values()) {
        if (kind.get(e.id) !== 'none') continue;
        const L = polyLen(e.pts);
        const la = lift.get(e.a) ?? 0, lb = lift.get(e.b) ?? 0;
        const na = lb - GRADE * L, nb = la - GRADE * L;
        if (na > 0.3 && na > la + 0.01 && !grounded(e.a)) { lift.set(e.a, na); changed = true; }
        if (nb > 0.3 && nb > lb + 0.01 && !grounded(e.b)) { lift.set(e.b, nb); changed = true; }
      }
    }
  }

  // ===== G. Bézier fitting =====
  const nodes: NetNode[] = [];
  const segments: NetSegment[] = [];
  const outNode = new Map<number, number>();
  const T = inp.terrain;
  const emitNode = (n: N): number => {
    let id = outNode.get(n.id);
    if (id === undefined) {
      id = nodes.length;
      nodes.push({ id, x: n.x, z: n.z, lift: lift.get(n.id) ?? 0, R: n.R, ringLanes: n.ringLanes, signals: n.signals || undefined });
      outNode.set(n.id, id);
    }
    return id;
  };
  let pieces = 0, straightened = 0;
  for (const e of G.edges.values()) {
    const na = G.nodes.get(e.a), nb = G.nodes.get(e.b);
    if (!na || !nb) continue;
    const t = typeOf.get(e.id)!;
    const radius = { motorway: 220, trunk: 160, primary: 110, secondary: 75, tertiary: 50, residential: 25, unclassified: 30, living_street: 16, service: 14, track: 14 }[e.cls as 'trunk'] ?? 20;
    let pts = e.pts.slice();
    pts[0] = [na.x, na.z];
    pts[pts.length - 1] = [nb.x, nb.z];
    // a short, wide ground piece that only wiggles off its chord (two carriageways' midline where they converge,
    // a junction moved by a cluster collapse) runs straight: at 15-20 m half-width a few metres of wiggle fold its kerbs
    const chord = (() => {
      const A = pts[0], B = pts[pts.length - 1], L0 = len2(sub(B, A));
      if (L0 < 5 || L0 >= 40 || Math.max(t.hwL, t.hwR) < 8 || (kind.get(e.id) ?? 'none') !== 'none') return false;
      const n: V2 = [-(B[1] - A[1]) / L0, (B[0] - A[0]) / L0];
      const dev = Math.max(...pts.map((p) => Math.abs(dot(sub(p, A), n))));
      return dev > 0.3 && dev < 0.12 * L0;
    })();
    if (chord) { pts = [pts[0], pts[pts.length - 1]]; straightened++; }
    pts = resample(smooth(pts, Math.max(radius, (geomHw.get(e.id) ?? Math.max(t.hwL, t.hwR)) + 3)), 3);
    const L = polyLen(pts);
    if (L < 0.5) continue;
    const endDir = (fromStart: boolean): V2 => {
      // direction over the first/last ~8 m (ignoring the radial stub into roundabout centres)
      const p = fromStart ? pts : pts.slice().reverse();
      const skip = (fromStart ? na.R : nb.R) ?? 0;
      let i0 = 0, acc = 0;
      while (i0 < p.length - 2 && acc < skip * 0.9) { acc += len2(sub(p[i0 + 1], p[i0])); i0++; }
      let i1 = i0, a2 = 0;
      while (i1 < p.length - 1 && a2 < 8) { a2 += len2(sub(p[i1 + 1], p[i1])); i1++; }
      const d = norm(sub(p[i1], p[i0]));
      return fromStart ? d : [-d[0], -d[1]];
    };
    const tol = RANK[e.cls] <= 3 ? 0.6 : 1.0;
    const cubics = fitCubics(pts, endDir(true), endDir(false), tol);
    const k = kind.get(e.id) ?? 'none';
    const elevated = k !== 'none' || (lift.get(e.a) ?? 0) > 0 || (lift.get(e.b) ?? 0) > 0;
    // heights along the chain (only used to give shape nodes their lift)
    const Za = T(na.x, na.z) + (lift.get(e.a) ?? 0), Zb = T(nb.x, nb.z) + (lift.get(e.b) ?? 0);
    let prevNode = emitNode(na);
    let acc = 0;
    cubics.forEach((c, i) => {
      const segLen = len2(sub(c[3], c[0]));
      acc += segLen;
      let to: number;
      if (i === cubics.length - 1) to = emitNode(nb);
      else {
        let lf = 0;
        if (elevated) {
          const s = Math.min(1, acc / L);
          let z = Za + (Zb - Za) * (0.5 * s + 0.5 * s * s * (3 - 2 * s));
          if (k === 'overpass') z = Math.max(z, T(c[3][0], c[3][1]) + (deck.get(e.id) ?? 0) * 0.85);
          if (k === 'valley') z = Za + (Zb - Za) * s;
          lf = Math.max(0, z - T(c[3][0], c[3][1]));
        }
        to = nodes.length;
        nodes.push({ id: to, x: c[3][0], z: c[3][1], lift: lf });
        pieces++;
      }
      segments.push({
        id: segments.length, a: prevNode, b: to, p: [c[0][0], c[0][1], c[1][0], c[1][1], c[2][0], c[2][1], c[3][0], c[3][1]],
        type: t.id, name: e.name, cls: e.cls, bridge: k, deck: deck.get(e.id) ?? 0, wayIds: e.wayIds,
        ...(reserveOf.has(e.id) ? { reserve: reserveOf.get(e.id) } : {}),
        ...(underViaduct.has(e.id) ? { viaduct: true } : {}),
        ...(elevated ? { elevated: true } : {}),
      } as NetSegment);
      prevNode = to;
    });
  }
  log(`fitted ${segments.length} Bézier segments (${pieces} shape nodes), ${Object.keys(types).length} road types; ${straightened} short wide pieces run straight`);
  return { half: inp.half, nodes, segments, types, paths };
}
