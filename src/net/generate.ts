// Procedural road geometry from the clean network — Cities: Skylines style.
//
//  Segments: the road type's cross-section is swept along each Bézier (lanes, median, kerbs, footpaths, markings).
//  Junctions: every road end is trimmed back so that a kerb fillet fits between neighbouring roads; the junction
//             surface is the polygon of trimmed road ends joined by curved kerb corners (+ raised footpath corners).
//  Roundabouts: a ring (outer/inner radius) with filleted entries and a raised central island.
//  Heights: ground surfaces follow the terrain per vertex; elevated chains interpolate between node heights;
//           shared edges use identical positions → identical heights → no cracks.
import { GeomBuilder, drapePolygon, rgbHex } from '../build/geom';
import { type Network, type NetSegment, type RoadType, type V2, type BridgeKind, type PartKind, sampleBez, bezD, partOffsets } from './model';
import type { Heightfield } from '../geo/heightfield';
import { RoadRaster } from '../geo/roadraster';

const LIFT = 0.06, KERB = 0.15, SLAB = 1.3;

const COL = {
  asphalt: rgbHex(0x4b4d51), asphaltMajor: rgbHex(0x45474b), junction: rgbHex(0x484a4e), dirt: rgbHex(0x8a7558),
  sidewalk: rgbHex(0xbdb4a4), kerb: rgbHex(0x9d9a93), median: rgbHex(0x8f8c84), island: rgbHex(0x6f9446),
  bus: rgbHex(0x7a4a44), cycle: rgbHex(0x4f6f52), parking: rgbHex(0x55585d),
  white: rgbHex(0xe9e9e4), yellow: rgbHex(0xe2bd3f), concrete: rgbHex(0xa8a49b), concreteDark: rgbHex(0x8e8a82), path: rgbHex(0xb3a88f),
};

// ---------------- sampling helpers ----------------

function leftNormals(pts: Float32Array): Float32Array {
  const n = pts.length / 2, out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    let dx = pts[b * 2] - pts[a * 2], dz = pts[b * 2 + 1] - pts[a * 2 + 1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    out[i * 2] = dz; out[i * 2 + 1] = -dx;
  }
  return out;
}

interface Sub { pts: number[]; nrm: number[]; s: number[] }

/** Samples of g between arc lengths s0..s1 (interpolated end samples). */
function subRange(g: SegGeo, s0: number, s1: number): Sub {
  const out: Sub = { pts: [], nrm: [], s: [] };
  const n = g.cum.length;
  const at = (s: number) => {
    let i = 0;
    while (i < n - 2 && g.cum[i + 1] < s) i++;
    const t = Math.max(0, Math.min(1, (s - g.cum[i]) / ((g.cum[i + 1] - g.cum[i]) || 1)));
    let nx = g.nrm[i * 2] + (g.nrm[i * 2 + 2] - g.nrm[i * 2]) * t, nz = g.nrm[i * 2 + 1] + (g.nrm[i * 2 + 3] - g.nrm[i * 2 + 1]) * t;
    const l = Math.hypot(nx, nz) || 1;
    out.pts.push(g.pts[i * 2] + (g.pts[i * 2 + 2] - g.pts[i * 2]) * t, g.pts[i * 2 + 1] + (g.pts[i * 2 + 3] - g.pts[i * 2 + 1]) * t);
    out.nrm.push(nx / l, nz / l);
    out.s.push(s);
  };
  at(s0);
  for (let i = 1; i < n - 1; i++) if (g.cum[i] > s0 + 0.05 && g.cum[i] < s1 - 0.05) { out.pts.push(g.pts[i * 2], g.pts[i * 2 + 1]); out.nrm.push(g.nrm[i * 2], g.nrm[i * 2 + 1]); out.s.push(g.cum[i]); }
  at(s1);
  return out;
}

/** Point + outward unit direction + outward-left normal at arc length s (outward = away from the node). */
function frameAt(g: SegGeo, s: number, atA: boolean) {
  const sub = subRange(g, Math.max(0, s - 0.01), Math.min(g.len, s + 0.01));
  const k = atA ? 0 : sub.pts.length / 2 - 1;
  const x = sub.pts[k * 2], z = sub.pts[k * 2 + 1];
  let nx = sub.nrm[k * 2], nz = sub.nrm[k * 2 + 1]; // left normal of a→b
  // a→b tangent from left normal: t = (-nz, nx)
  let ux = -nz, uz = nx;
  if (!atA) { ux = -ux; uz = -uz; nx = -nx; nz = -nz; }
  return { x, z, ux, uz, lx: nx, lz: nz }; // lx,lz = left of outward direction
}

/** Centre-line point `d` metres in from one end of a segment. */
function posFromEnd(g: SegGeo, d: number, atA: boolean): V2 {
  const s = Math.max(0, Math.min(g.len, atA ? d : g.len - d));
  const n = g.cum.length;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (g.cum[m] <= s) lo = m; else hi = m; }
  const t = (s - g.cum[lo]) / Math.max(1e-6, g.cum[hi] - g.cum[lo]);
  return [g.pts[lo * 2] + (g.pts[hi * 2] - g.pts[lo * 2]) * t, g.pts[lo * 2 + 1] + (g.pts[hi * 2 + 1] - g.pts[lo * 2 + 1]) * t];
}

function cubicPts(p0: V2, p1: V2, p2: V2, p3: V2, n: number): V2[] {
  const out: V2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
    out.push([a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]);
  }
  return out;
}

// ---------------- strip builders ----------------

/**
 * Per-sample limits on how far an offset can go to the left (+) / right (−) before the offset curve folds back
 * on itself (inside of a tight curve). Cached on the Sub.
 */
function foldLimits(S: Sub): { pos: Float32Array; neg: Float32Array } {
  const anyS = S as Sub & { _lim?: { pos: Float32Array; neg: Float32Array } };
  if (anyS._lim) return anyS._lim;
  const m = S.s.length;
  const pos = new Float32Array(m).fill(Infinity), neg = new Float32Array(m).fill(Infinity);
  for (let i = 0; i < m - 1; i++) {
    const dx = S.pts[i * 2 + 2] - S.pts[i * 2], dz = S.pts[i * 2 + 3] - S.pts[i * 2 + 1];
    const d = Math.hypot(dx, dz);
    if (d < 1e-6) continue;
    const tx = dx / d, tz = dz / d;
    const dn = (S.nrm[i * 2 + 2] - S.nrm[i * 2]) * tx + (S.nrm[i * 2 + 3] - S.nrm[i * 2 + 1]) * tz;
    // offset point moves by d + o·dn along the tangent: must stay positive
    if (dn < -1e-6) { const L = (0.85 * d) / -dn; pos[i] = Math.min(pos[i], L); pos[i + 1] = Math.min(pos[i + 1], L); }
    if (dn > 1e-6) { const L = (0.85 * d) / dn; neg[i] = Math.min(neg[i], L); neg[i + 1] = Math.min(neg[i + 1], L); }
  }
  anyS._lim = { pos, neg };
  return anyS._lim;
}

const clampOff = (o: number, lim: { pos: Float32Array; neg: Float32Array }, i: number) =>
  o >= 0 ? Math.min(o, lim.pos[i]) : -Math.min(-o, lim.neg[i]);

/** Up-facing strip between left-positive offsets o0 > o1 along a sub-range, heights per vertex. */
function sweep(gb: GeomBuilder, S: Sub, o0: number, o1: number, z: (i: number, x: number, zz: number) => number, rgb: [number, number, number]) {
  const m = S.s.length;
  if (m < 2) return;
  const lim = foldLimits(S);
  const base = gb.vertexCount;
  for (let i = 0; i < m; i++) {
    const x = S.pts[i * 2], zz = S.pts[i * 2 + 1], nx = S.nrm[i * 2], nz = S.nrm[i * 2 + 1];
    const a = clampOff(o0, lim, i), b = clampOff(o1, lim, i);
    const lx = x + nx * a, lz = zz + nz * a, rx = x + nx * b, rz = zz + nz * b;
    gb.v(lx, z(i, lx, lz), lz, 0, 1, 0, ...rgb, S.s[i] * 0.25, o0 * 0.25);
    gb.v(rx, z(i, rx, rz), rz, 0, 1, 0, ...rgb, S.s[i] * 0.25, o1 * 0.25);
  }
  for (let i = 0; i < m - 1; i++) {
    const k = base + i * 2;
    gb.tri(k, k + 1, k + 2);
    gb.tri(k + 1, k + 3, k + 2);
  }
}

/** Vertical wall along offset o from z0(i) to z1(i); faces left if `faceLeft`. */
function wallAlong(gb: GeomBuilder, S: Sub, o: number, zb: (i: number, x: number, zz: number) => number, zt: (i: number, x: number, zz: number) => number, faceLeft: boolean, rgb: [number, number, number]) {
  const m = S.s.length;
  if (m < 2) return;
  const base = gb.vertexCount;
  const sg = faceLeft ? 1 : -1;
  const lim = foldLimits(S);
  for (let i = 0; i < m; i++) {
    const nx = S.nrm[i * 2], nz = S.nrm[i * 2 + 1];
    const oo = clampOff(o, lim, i);
    const x = S.pts[i * 2] + nx * oo, zz = S.pts[i * 2 + 1] + nz * oo;
    gb.v(x, zb(i, x, zz), zz, nx * sg, 0, nz * sg, ...rgb);
    gb.v(x, zt(i, x, zz), zz, nx * sg, 0, nz * sg, ...rgb);
  }
  for (let i = 0; i < m - 1; i++) {
    const k = base + i * 2;
    if (faceLeft) { gb.tri(k, k + 1, k + 2); gb.tri(k + 1, k + 3, k + 2); }
    else { gb.tri(k, k + 2, k + 1); gb.tri(k + 1, k + 2, k + 3); }
  }
}

/** Band between two polylines of equal length — e.g. kerb corners. Always wound to face up. */
function bandBetween(gb: GeomBuilder, L: V2[], R: V2[], z: (x: number, zz: number) => number, rgb: [number, number, number]) {
  if (L.length < 2) return;
  // orientation from the summed signed area of the quads: flip edges if the strip would face down
  let area = 0;
  for (let i = 0; i < L.length - 1; i++) {
    const a = L[i], b = R[i], c = L[i + 1];
    area += (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
  }
  if (area < 0) [L, R] = [R, L];
  const base = gb.vertexCount;
  for (let i = 0; i < L.length; i++) {
    gb.v(L[i][0], z(L[i][0], L[i][1]), L[i][1], 0, 1, 0, ...rgb, L[i][0] * 0.25, L[i][1] * 0.25);
    gb.v(R[i][0], z(R[i][0], R[i][1]), R[i][1], 0, 1, 0, ...rgb, R[i][0] * 0.25, R[i][1] * 0.25);
  }
  for (let i = 0; i < L.length - 1; i++) {
    const k = base + i * 2;
    gb.tri(k, k + 1, k + 2);
    gb.tri(k + 1, k + 3, k + 2);
  }
}

/** Offset a curve away from `center` by a width that varies linearly from w0 to w1.
 *  The side is chosen once for the whole curve (from its chord), so it can't flip part-way along. */
function offsetAway(curve: V2[], cx: number, cz: number, w0: number, w1: number): V2[] {
  const n = curve.length;
  const a0 = curve[0], a1 = curve[n - 1];
  const mid = curve[Math.floor(n / 2)];
  // left normal of the chord; flip if it points at the junction centre
  let side = 1;
  const cnx = a1[1] - a0[1], cnz = -(a1[0] - a0[0]);
  if (cnx * (mid[0] - cx) + cnz * (mid[1] - cz) < 0) side = -1;
  return curve.map((p, i) => {
    const a = curve[Math.max(0, i - 1)], b = curve[Math.min(n - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    const w = w0 + (w1 - w0) * (i / Math.max(1, n - 1));
    return [p[0] + side * tz * w, p[1] - side * tx * w] as V2;
  });
}

/** Strictly inside a closed polygon (even-odd). */
function insidePoly(P: V2[], q: V2): boolean {
  let inside = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    if ((a[1] > q[1]) !== (b[1] > q[1]) && q[0] < ((b[0] - a[0]) * (q[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function distToRing(P: V2[], q: V2): number {
  let best = Infinity;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[j], b = P[i];
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(a[0] + dx * t - q[0], a[1] + dz * t - q[1]));
  }
  return best;
}

/** Every quad of the band between two polylines has the same orientation (no folds or crossings). */
function bandClean(L: V2[], R: V2[]): boolean {
  let pos = 0, neg = 0;
  for (let i = 0; i < L.length - 1; i++) {
    for (const [a, b, c] of [[L[i], R[i], L[i + 1]], [R[i], R[i + 1], L[i + 1]]] as [V2, V2, V2][]) {
      const ar = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
      if (ar > 1e-4) pos++; else if (ar < -1e-4) neg++;
    }
  }
  return pos === 0 || neg === 0;
}

/** A kerb corner is usable if it doesn't loop, turn back on itself, or wander far from its chord. */
function saneCorner(c: V2[]): boolean {
  const n = c.length;
  const chord = Math.hypot(c[n - 1][0] - c[0][0], c[n - 1][1] - c[0][1]);
  let len = 0, turn = 0;
  for (let i = 1; i < n; i++) len += Math.hypot(c[i][0] - c[i - 1][0], c[i][1] - c[i - 1][1]);
  for (let i = 1; i < n - 1; i++) {
    const a = Math.atan2(c[i][1] - c[i - 1][1], c[i][0] - c[i - 1][0]), b = Math.atan2(c[i + 1][1] - c[i][1], c[i + 1][0] - c[i][0]);
    let d = b - a;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    turn += d;
  }
  if (Math.abs(turn) > 2.97) return false;          // > ~170°: hairpin
  if (chord > 0.5 && len > 2.2 * chord) return false; // wanders far from its chord
  // open polyline self-intersection
  const o = (a: V2, b: V2, q: V2) => (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
  for (let i = 0; i < n - 1; i++) for (let j = i + 2; j < n - 1; j++) {
    if (o(c[i], c[i + 1], c[j]) * o(c[i], c[i + 1], c[j + 1]) < 0 && o(c[j], c[j + 1], c[i]) * o(c[j], c[j + 1], c[i + 1]) < 0) return false;
  }
  return true;
}

/** Does a closed polygon cross itself? (O(n²), polygons here are small) */
function selfIntersects(P: V2[]): boolean {
  const n = P.length;
  const o = (a: V2, b: V2, c: V2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = P[j], d = P[(j + 1) % n];
      if (o(a, b, c) * o(a, b, d) < -1e-9 && o(c, d, a) * o(c, d, b) < -1e-9) return true;
    }
  }
  return false;
}

function convexHull(P: V2[]): V2[] {
  const pts = [...P].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: V2, a: V2, b: V2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: V2[] = [], hi: V2[] = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of pts.reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], p) <= 0) hi.pop(); hi.push(p); }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)];
}

function polyWall(gb: GeomBuilder, P: V2[], zb: (x: number, z: number) => number, zt: (x: number, z: number) => number, rgb: [number, number, number]) {
  for (let i = 0; i < P.length - 1; i++) {
    const a = P[i], b = P[i + 1];
    gb.wall(a[0], a[1], b[0], b[1], zb(a[0], a[1]), zb(b[0], b[1]), zt(a[0], a[1]), zt(b[0], b[1]), rgb);
  }
}

// ---------------- incremental mesher ----------------

/** A network node as the mesher sees it (junction, shape point, roundabout or dead end). */
export interface MNode {
  id: string; x: number; z: number; lift: number;
  R?: number; ringLanes?: number; signals?: boolean;
  /** kerb corner radius override (m) */
  rc?: number;
  /** zebra crossings: force on/off (default: signals or a major arm) */
  crossings?: boolean;
}

/** One cubic piece of road. */
export interface MSeg {
  id: string; a: string; b: string;
  /** cubic Bézier control points x0,z0,x1,z1,x2,z2,x3,z3 */
  p: number[];
  t: RoadType; cls: string; bridge: BridgeKind;
  elevated?: boolean; viaduct?: boolean;
  /** below the ground (a trench, underpass or tunnel) */ sunk?: boolean;
  /** raster / picking code (> 0) */
  code: number;
  /** the editor object this piece belongs to (section id) */
  owner?: string;
  src?: NetSegment;
}

export type MeshLayer = 'asphalt' | 'paving' | 'markings' | 'concrete';
export const MESH_LAYERS: MeshLayer[] = ['asphalt', 'paving', 'markings', 'concrete'];

export interface Packed { pos: Float32Array; nor: Float32Array; col: Float32Array; uv: Float32Array; idx: Uint32Array }

/** Terrain carving / footprint stamp of one item: a swept centre line or a closed polygon. */
export interface Stamp {
  line?: Float32Array; hw?: number; ring?: Float32Array; carve: boolean; code: number;
  /** road surface height per line point (sunken roads: the trench floor), instead of the ground */ z?: Float32Array;
  /** ring stamps: metres below the ground (sunken junctions) */ dz?: number;
}

/** Below this depth a sunken road is covered (a tunnel); above it, an open trench with retaining walls. */
export const COVER = 6.5;
/** Tunnel headroom: road surface to ceiling. */
const CEIL = 5.5;

export interface MeshItem {
  key: string; // 's:<seg id>' | 'n:<node id>'
  layers: Partial<Record<MeshLayer, Packed>>;
  x0: number; z0: number; x1: number; z1: number;
  stamps: Stamp[];
}

export interface SegGeo {
  s: MSeg; t: RoadType;
  pts: Float32Array; cum: Float32Array; len: number; nrm: Float32Array; // full-length samples + left normals
  trimA: number; trimB: number;
  rawA: number; rawB: number; // trims wanted by each junction before the segment is shared out
}

interface End {
  g: SegGeo; atA: boolean; node: MNode;
  ux: number; uz: number; ang: number; // outward direction at the node
  hwL: number; hwR: number; cwL: number; cwR: number; // relative to outward direction
  trim: number; rc: number;
}

type NodeKind = 'seamless' | 'junction' | 'roundabout' | 'end' | 'shape';

function pack(gb: GeomBuilder): Packed | undefined {
  if (!gb.idx.length) return undefined;
  return { pos: new Float32Array(gb.pos), nor: new Float32Array(gb.nor), col: new Float32Array(gb.col), uv: new Float32Array(gb.uv), idx: new Uint32Array(gb.idx) };
}

/**
 * Builds road geometry item by item (one item per segment, one per node) so an edit only rebuilds what it touched:
 * the edited pieces, the junctions at their ends and the neighbouring arms whose trims those junctions set.
 */
export class RoadMesher {
  readonly nodes = new Map<string, MNode>();
  readonly segs = new Map<string, MSeg>();
  readonly geos = new Map<string, SegGeo>();
  readonly items = new Map<string, MeshItem>();
  readonly junctions = new Map<string, { ring: V2[]; hull: boolean }>();
  readonly kinds = new Map<string, NodeKind>();
  private nodeSegs = new Map<string, Set<string>>();
  private ends = new Map<string, End[]>();
  private nodeCodes = new Map<string, number>();
  private nextNodeCode = 1;
  private T: (x: number, z: number) => number;

  constructor(readonly hf: Heightfield) {
    this.T = (x, z) => hf.sample(x, z);
  }

  nodeCode(id: string) {
    let c = this.nodeCodes.get(id);
    if (c === undefined) { c = -this.nextNodeCode++; this.nodeCodes.set(id, c); }
    return c;
  }

  get stats() {
    const s = { junctions: 0, roundabouts: 0, seamless: 0, ends: 0 };
    for (const k of this.kinds.values()) {
      if (k === 'junction') s.junctions++; else if (k === 'roundabout') s.roundabouts++; else if (k === 'seamless') s.seamless++; else if (k === 'end') s.ends++;
    }
    return s;
  }

  /**
   * Apply a change set. Nodes and segments are upserted by id; a moved node must come with its re-shaped segments.
   * Returns the keys of every item that was rebuilt or removed.
   */
  apply(ch: { nodes?: MNode[]; segs?: MSeg[]; removeNodes?: string[]; removeSegs?: string[] }): Set<string> {
    const changed = new Set<string>();
    const dirtyNodes = new Set<string>();
    const link = (s: MSeg) => { for (const n of [s.a, s.b]) (this.nodeSegs.get(n) ?? this.nodeSegs.set(n, new Set()).get(n)!).add(s.id); };
    const unlink = (s: MSeg) => { for (const n of [s.a, s.b]) { this.nodeSegs.get(n)?.delete(s.id); dirtyNodes.add(n); } };
    for (const id of ch.removeSegs ?? []) {
      const s = this.segs.get(id);
      if (!s) continue;
      unlink(s);
      this.segs.delete(id); this.geos.delete(id);
      if (this.items.delete('s:' + id)) changed.add('s:' + id);
    }
    for (const n of ch.nodes ?? []) { this.nodes.set(n.id, n); dirtyNodes.add(n.id); }
    for (const s of ch.segs ?? []) {
      const old = this.segs.get(s.id);
      if (old) unlink(old);
      this.segs.set(s.id, s);
      link(s);
      dirtyNodes.add(s.a); dirtyNodes.add(s.b);
      this.geos.set(s.id, this.sample(s));
    }
    for (const id of ch.removeNodes ?? []) {
      if (this.nodeSegs.get(id)?.size) continue; // still in use
      this.nodes.delete(id); this.nodeSegs.delete(id); this.ends.delete(id); this.kinds.delete(id); this.junctions.delete(id);
      dirtyNodes.delete(id);
      if (this.items.delete('n:' + id)) changed.add('n:' + id);
    }
    // 1. junction trims at every touched node
    for (const n of dirtyNodes) this.computeEnds(n);
    // 2. share each touched segment out between its two junctions
    const dirtySegs = new Set<string>();
    for (const n of dirtyNodes) for (const s of this.nodeSegs.get(n) ?? []) dirtySegs.add(s);
    const rebuildNodes = new Set<string>(dirtyNodes);
    for (const id of dirtySegs) {
      const g = this.geos.get(id)!;
      const sum = g.rawA + g.rawB, max = g.len * 0.9;
      const k = sum > max ? max / sum : 1;
      g.trimA = g.rawA * k; g.trimB = g.rawB * k;
      rebuildNodes.add(g.s.a); rebuildNodes.add(g.s.b);
    }
    // 3. rebuild
    for (const id of dirtySegs) { this.buildSeg(this.geos.get(id)!); changed.add('s:' + id); }
    for (const n of rebuildNodes) {
      if (!this.nodes.has(n)) continue;
      for (const e of this.ends.get(n) ?? []) e.trim = e.atA ? e.g.trimA : e.g.trimB;
      this.buildNode(n);
      changed.add('n:' + n);
    }
    return changed;
  }

  private sample(s: MSeg): SegGeo {
    const { pts, cum, len } = sampleBez(s.p, 4, 3); // 4 m on straights, ≤3° per step on curves
    const nrm = leftNormals(pts);
    // exact end tangents from the Bézier, so G1 joins between pieces stay seamless
    for (const [t, i] of [[0, 0], [1, pts.length / 2 - 1]] as [number, number][]) {
      const d = bezD(s.p, t), l = Math.hypot(d[0], d[1]) || 1;
      nrm[i * 2] = d[1] / l; nrm[i * 2 + 1] = -d[0] / l;
    }
    return { s, t: s.t, pts, cum, len, nrm, trimA: 0, trimB: 0, rawA: 0, rawB: 0 };
  }

  private nodeLifted = (n: MNode) => n.lift > 0.25;
  private nodeSunk = (n: MNode) => n.lift < -0.25;
  private nodeOff = (n: MNode) => Math.abs(n.lift) > 0.25;
  private nodeZc = (n: MNode) => this.T(n.x, n.z) + n.lift;
  private nodeZ = (n: MNode, x: number, z: number) => (this.nodeOff(n) ? this.nodeZc(n) : this.T(x, z)) + LIFT;

  private computeEnds(id: string) {
    const node = this.nodes.get(id);
    const E: End[] = [];
    if (!node) { this.ends.delete(id); return; }
    for (const sid of this.nodeSegs.get(id) ?? []) {
      const g = this.geos.get(sid)!;
      for (const atA of [true, false]) {
        if ((atA ? g.s.a : g.s.b) !== id) continue;
        const f = frameAt(g, atA ? 0 : g.len, atA);
        const t = g.t;
        E.push({
          g, atA, node, ux: f.ux, uz: f.uz, ang: Math.atan2(f.uz, f.ux),
          hwL: atA ? t.hwL : t.hwR, hwR: atA ? t.hwR : t.hwL, cwL: atA ? t.cwL : t.cwR, cwR: atA ? t.cwR : t.cwL,
          trim: 0, rc: node.rc ?? (t.major ? 9 : 5),
        });
      }
    }
    E.sort((p, q) => p.ang - q.ang);
    this.ends.set(id, E);
    const setRaw = () => { for (const e of E) { if (e.atA) e.g.rawA = e.trim; else e.g.rawB = e.trim; } };
    if (node.R && E.length) {
      this.kinds.set(id, 'roundabout');
      const rw = ringHalfWidth(node);
      const Ro = node.R + rw;
      for (const e of E) {
        const w = Math.max(e.hwL, e.hwR);
        e.trim = Math.sqrt(Math.max(0, Ro * Ro - Math.min(w, Ro - 0.5) ** 2)) + 3;
      }
      setRaw();
      return;
    }
    if (E.length <= 1) { this.kinds.set(id, 'end'); setRaw(); return; }
    if (E.length === 2 && E[0].g.t.id === E[1].g.t.id && E[0].ux * E[1].ux + E[0].uz * E[1].uz < -0.99) {
      this.kinds.set(id, 'seamless'); setRaw(); return;
    }
    this.kinds.set(id, 'junction');
    const n = E.length;
    for (let i = 0; i < n; i++) {
      const e = E[i], f = E[(i + 1) % n];
      if (n === 2 && i === 1) continue; // two-way node: one pair per side is enough below
      const pairs: [End, End][] = n === 2 ? [[e, f], [f, e]] : [[e, f]];
      for (const [A, B] of pairs) {
        const cross = A.ux * B.uz - A.uz * B.ux, dotv = A.ux * B.ux + A.uz * B.uz;
        let ta = 0, tb = 0;
        if (Math.abs(cross) > 0.17) {
          const nRx = -A.uz, nRz = A.ux, nLx = B.uz, nLz = -B.ux; // right of A, left of B
          const wx = nLx * B.hwL - nRx * A.hwR, wz = nLz * B.hwL - nRz * A.hwR;
          const det = -cross;
          ta = (wx * -B.uz - -B.ux * wz) / det;
          tb = (A.ux * wz - A.uz * wx) / det;
          // near-parallel neighbours: the kerb lines meet far out; don't drag the junction down the road
          const cap = Math.max(A.hwR, B.hwL) * 2.5;
          ta = Math.min(ta, cap); tb = Math.min(tb, cap);
        } else if (dotv > 0) {
          ta = tb = Math.max(A.hwR, B.hwL) * 2.5; // sharp fork: pull both back
        }
        // narrow angle: walk out until the two roads' edges have actually separated (handles arms that
        // curve or drift apart slowly, where the straight kerb-line intersection says nothing)
        if (dotv > 0.3) {
          const need = A.hwR + B.hwL + 0.3, lim = Math.min(70, 0.45 * Math.min(A.g.len, B.g.len));
          let d = 0;
          for (; d < lim; d += 1.5) {
            const pa = posFromEnd(A.g, d, A.atA), pb = posFromEnd(B.g, d, B.atA);
            if (Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) >= need) break;
          }
          ta = Math.max(ta, d); tb = Math.max(tb, d);
        }
        const phi = Math.acos(Math.max(-1, Math.min(1, -dotv)));
        const rc = Math.min(A.rc, B.rc);
        const L = Math.min(25, rc * Math.tan(Math.min(phi, 2.6) / 2));
        A.trim = Math.max(A.trim, Math.max(0, ta) + L, 1);
        B.trim = Math.max(B.trim, Math.max(0, tb) + L, 1);
      }
    }
    setRaw();
  }

  private segZ(g: SegGeo) {
    const T = this.T;
    const na = this.nodes.get(g.s.a)!, nb = this.nodes.get(g.s.b)!;
    if (!g.s.elevated && !g.s.sunk) return (_s: number, x: number, z: number) => T(x, z) + LIFT;
    const span = Math.max(0.01, g.len - g.trimA - g.trimB);
    const valley = g.s.bridge === 'valley';
    const za = this.nodeZc(na), zb = this.nodeZc(nb);
    const la = this.nodeOff(na), lb = this.nodeOff(nb);
    return (s: number, x: number, z: number) => {
      const t = Math.max(0, Math.min(1, (s - g.trimA) / span));
      if (valley) return Math.max(za + (zb - za) * t, T(x, z)) + LIFT;
      const ea = la ? za : T(x, z), eb = lb ? zb : T(x, z);
      return ea + (eb - ea) * t + LIFT;
    };
  }

  private buildSeg(g: SegGeo) {
    const key = 's:' + g.s.id;
    const t = g.t;
    const s0 = g.trimA, s1 = g.len - g.trimB;
    if (s1 - s0 < 1.5) { this.items.delete(key); return; } // stub fully inside its junctions — the junction surface covers it
    const asphalt = new GeomBuilder(), paving = new GeomBuilder(), markings = new GeomBuilder(), concrete = new GeomBuilder();
    const S = subRange(g, s0, s1);
    const zfn = this.segZ(g);
    const z = (i: number, x: number, zz: number) => zfn(S.s[i], x, zz);
    const offs = partOffsets(t);
    // one asphalt strip per run of adjacent same-coloured flat parts (not one per lane)
    const roadCol = t.surface === 'dirt' ? COL.dirt : t.major ? COL.asphaltMajor : COL.asphalt;
    const flatCol = (k: PartKind) => (k === 'bus' ? COL.bus : k === 'cycle' ? COL.cycle : k === 'parking' ? COL.parking : roadCol);
    let run: { o: [number, number]; col: [number, number, number] } | null = null;
    const flush = () => { if (run) sweep(asphalt, S, run.o[0], run.o[1], z, run.col); run = null; };
    t.parts.forEach((p, k) => {
      const [o0, o1] = offs[k];
      if (p.kind === 'lane' || p.kind === 'shoulder' || p.kind === 'bus' || p.kind === 'cycle' || p.kind === 'parking') {
        const col = flatCol(p.kind);
        if (run && run.col === col) run.o[1] = o1;
        else { flush(); run = { o: [o0, o1], col }; }
        return;
      }
      flush();
      const top = (i: number, x: number, zz: number) => z(i, x, zz) + KERB;
      sweep(paving, S, o0, o1, top, p.kind === 'median' ? COL.median : p.kind === 'planter' ? COL.island : COL.sidewalk);
      // kerb faces: towards the carriageway on both sides of a median; inner face of a footpath
      const isLeftWalk = k === 0;
      const isRightWalk = k === t.parts.length - 1;
      if (!isLeftWalk) wallAlong(paving, S, o0, (i, x, zz) => z(i, x, zz) - 0.05, top, true, COL.kerb);
      if (!isRightWalk) wallAlong(paving, S, o1, (i, x, zz) => z(i, x, zz) - 0.05, top, false, COL.kerb);
      if (isLeftWalk) wallAlong(paving, S, o0, (i, x, zz) => z(i, x, zz) - 0.4, top, true, COL.kerb);
      if (isRightWalk) wallAlong(paving, S, o1, (i, x, zz) => z(i, x, zz) - 0.4, top, false, COL.kerb);
    });
    flush();
    segmentMarkings(markings, g, S, z, offs);
    if (g.s.elevated) structure(concrete, g, S, z, t, this.T);
    else if (g.s.sunk) underground(concrete, S, z, t, this.T);
    const hw = Math.max(t.hwL, t.hwR);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < S.pts.length; i += 2) {
      x0 = Math.min(x0, S.pts[i]); x1 = Math.max(x1, S.pts[i]); z0 = Math.min(z0, S.pts[i + 1]); z1 = Math.max(z1, S.pts[i + 1]);
    }
    this.items.set(key, {
      key, layers: { asphalt: pack(asphalt), paving: pack(paving), markings: pack(markings), concrete: pack(concrete) },
      x0: x0 - hw, z0: z0 - hw, x1: x1 + hw, z1: z1 + hw,
      stamps: g.s.sunk && !g.s.elevated ? trenchStamps(S, z, hw, g.s.code, this.T) : [{ line: new Float32Array(S.pts), hw, carve: !g.s.elevated, code: g.s.code }],
    });
  }

  private buildNode(id: string) {
    const key = 'n:' + id;
    const node = this.nodes.get(id)!;
    const E = this.ends.get(id) ?? [];
    const kind = this.kinds.get(id);
    this.junctions.delete(id);
    if (kind !== 'junction' && kind !== 'roundabout') { this.items.delete(key); return; }
    const asphalt = new GeomBuilder(), paving = new GeomBuilder(), markings = new GeomBuilder(), concrete = new GeomBuilder();
    const zf = (x: number, z: number) => this.nodeZ(node, x, z);
    let ring: V2[];
    let island: Float32Array | null = null;
    if (kind === 'roundabout') {
      const r = roundabout(node, E, zf, asphalt, paving, markings);
      ring = r.poly; island = r.island;
    } else {
      const F = E.map((e) => {
        const fr = frameAt(e.g, e.atA ? e.trim : e.g.len - e.trim, e.atA);
        const P = (o: number): V2 => [fr.x + fr.lx * o, fr.z + fr.lz * o];
        return { e, fr, CL: P(e.cwL), CR: P(-e.cwR), OL: P(e.hwL), OR: P(-e.hwR) };
      });
      let poly: V2[] = [];
      const n = F.length;
      const corners: { curb: V2[]; wa: number; wb: number }[] = [];
      for (let i = 0; i < n; i++) {
        const a = F[i], b = F[(i + 1) % n];
        poly.push(a.CL, a.CR);
        const curb = corner(a.CR, [-a.fr.ux, -a.fr.uz], b.CL, [b.fr.ux, b.fr.uz]);
        for (let k = 1; k < curb.length - 1; k++) poly.push(curb[k]);
        corners.push({ curb, wa: Math.max(0, a.e.hwR - a.e.cwR), wb: Math.max(0, b.e.hwL - b.e.cwL) });
      }
      const bad = selfIntersects(poly);
      if (bad) poly = convexHull(poly);
      // raised footpath corners: the outer edge is an offset of the kerb curve, pushed away from the junction,
      // so the two edges can never cross (skipped where the junction outline had to be simplified)
      if (!bad) for (const c of corners) {
        if (Math.max(c.wa, c.wb) < 0.1 || c.curb.length < 2) continue;
        if (!saneCorner(c.curb)) continue; // looping / overshooting kerb curve: leave it to the junction asphalt
        const outer = offsetAway(c.curb, node.x, node.z, c.wa, c.wb);
        // folded band, or footpath pushing > 0.5 m into the junction asphalt: leave the corner flat
        if (!bandClean(outer, c.curb) || outer.some((q) => insidePoly(poly, q) && distToRing(poly, q) > 0.5)) continue;
        const top = (x: number, z: number) => zf(x, z) + KERB;
        bandBetween(paving, outer, c.curb, top, COL.sidewalk);
        polyWall(paving, c.curb, (x, z) => zf(x, z) - 0.05, top, COL.kerb);
      }
      this.junctions.set(id, { ring: poly, hull: bad });
      ring = poly;
      drapePolygon(asphalt, new Float32Array(poly.flat()), [], zf, COL.junction, 4);
      if (this.nodeSunk(node) && -node.lift >= COVER) {
        // junction inside a tunnel: its ceiling
        drapePolygon(concrete, new Float32Array(poly.flat()), [], (x, z) => zf(x, z) + CEIL, COL.concreteDark, 4);
        drapePolygon(concrete, new Float32Array(poly.flat()), [], (x, z) => zf(x, z) + CEIL + 0.6, COL.concrete, 4);
      }
      if (this.nodeLifted(node)) {
        // raised junction platform: slab underside + edge walls
        drapePolygon(concrete, new Float32Array(poly.flat()), [], (x, z) => zf(x, z) - SLAB, COL.concreteDark, 4);
        polyWall(concrete, [...poly, poly[0]], (x, z) => zf(x, z) - SLAB, (x, z) => zf(x, z), COL.concrete);
      }
      junctionMarkings(markings, node, F, zf);
    }
    if (kind === 'roundabout') this.junctions.set(id, { ring, hull: false });
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const code = this.nodeCode(id);
    const carve = !this.nodeLifted(node);
    const covered = this.nodeSunk(node) && -node.lift >= COVER;
    const dz = this.nodeSunk(node) ? node.lift : undefined;
    // a junction in a covered tunnel leaves the ground (and what stands on it) alone
    const stamps: Stamp[] = covered ? [] : [{ ring: new Float32Array(ring.flat()), carve, code, dz }];
    if (island && !covered) stamps.push({ ring: island, carve, code, dz });
    this.items.set(key, { key, layers: { asphalt: pack(asphalt), paving: pack(paving), markings: pack(markings), concrete: pack(concrete) }, x0, z0, x1, z1, stamps });
  }

  /** Footpaths / trails (paved ribbons, no junction logic). */
  setPath(id: string, pts: number[] | null, width = 1.8) {
    const key = 'p:' + id;
    if (!pts || pts.length < 4) { this.items.delete(key); return key; }
    const paving = new GeomBuilder();
    pathRibbon(paving, pts, width, this.T);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); z0 = Math.min(z0, pts[i + 1]); z1 = Math.max(z1, pts[i + 1]); }
    this.items.set(key, { key, layers: { paving: pack(paving) }, x0, z0, x1, z1, stamps: [] });
    return key;
  }

  /** Items whose bounding box touches a region. */
  itemsIn(x0: number, z0: number, x1: number, z1: number): MeshItem[] {
    const out: MeshItem[] = [];
    for (const it of this.items.values()) if (it.x1 >= x0 && it.x0 <= x1 && it.z1 >= z0 && it.z0 <= z1) out.push(it);
    return out;
  }

  /** Terrain targets (desired heights under ground-level roads) for every grid vertex in a region (all if omitted). */
  stampTargets(targets: Float32Array, region?: [number, number, number, number]) {
    const hf = this.hf;
    const items = region ? this.itemsIn(...region) : [...this.items.values()];
    const T = this.T;
    for (const it of items) for (const st of it.stamps) {
      if (!st.carve) continue;
      if (st.line) stampLine(hf, targets, st.line, st.hw!, T, region, st.z);
      else if (st.ring) stampPolygon(hf, targets, st.ring, (x, z) => T(x, z) + (st.dz ?? 0) - 0.3, region);
    }
  }

  /** Road footprint raster (for building conflicts and trees) in a region (all if omitted). */
  stampRaster(raster: RoadRaster, region?: [number, number, number, number]) {
    const items = region ? this.itemsIn(...region) : [...this.items.values()];
    for (const it of items) for (const st of it.stamps) {
      if (st.line) raster.stampRoad(st.line, st.hw!, st.code, region);
      else if (st.ring) raster.stampPolygon(st.ring, st.code, region);
    }
  }
}

/** Merge packed items into one builder per layer (whole-network build, offline tools). */
export function mergeItems(items: Iterable<MeshItem>): Record<MeshLayer, GeomBuilder> {
  const out = { asphalt: new GeomBuilder(), paving: new GeomBuilder(), markings: new GeomBuilder(), concrete: new GeomBuilder() };
  for (const it of items) for (const L of MESH_LAYERS) {
    const p = it.layers[L];
    if (!p) continue;
    const gb = out[L], base = gb.vertexCount;
    for (const v of p.pos) gb.pos.push(v);
    for (const v of p.nor) gb.nor.push(v);
    for (const v of p.col) gb.col.push(v);
    for (const v of p.uv) gb.uv.push(v);
    for (const i of p.idx) gb.idx.push(i + base);
  }
  return out;
}

// ---------------- whole-network build (viewer + offline tools) ----------------

export interface NetMeshes {
  asphalt: GeomBuilder; paving: GeomBuilder; markings: GeomBuilder; concrete: GeomBuilder;
  targets: Float32Array; raster: RoadRaster; geos: (Omit<SegGeo, 's'> & { s: NetSegment })[];
  /** junction surfaces (closed kerb polygons), for analysis / picking */
  junctions: { node: number; ring: V2[]; hull: boolean }[];
  stats: { junctions: number; roundabouts: number; seamless: number; ends: number };
}

/** Mesher inputs for a baked network (node ids = array index, segment ids = segment id). */
export function networkToMesher(net: Network): { nodes: MNode[]; segs: MSeg[] } {
  const nodes: MNode[] = net.nodes.map((n) => ({ id: String(n.id), x: n.x, z: n.z, lift: n.lift, R: n.R, ringLanes: n.ringLanes, signals: n.signals }));
  const segs: MSeg[] = net.segments.map((s) => ({
    id: String(s.id), a: String(s.a), b: String(s.b), p: s.p, t: net.types[s.type], cls: s.cls, bridge: s.bridge,
    elevated: s.elevated, viaduct: s.viaduct, code: s.id + 1, src: s,
  }));
  return { nodes, segs };
}

export function generateNetwork(net: Network, hf: Heightfield): NetMeshes {
  const m = new RoadMesher(hf);
  const { nodes, segs } = networkToMesher(net);
  // keep the viewer's raster convention: junction code = −(node index + 1)
  for (const n of nodes) m.nodeCode(n.id);
  m.apply({ nodes, segs });
  net.paths.forEach((p, i) => m.setPath(String(i), p.pts, p.width));
  const L = mergeItems(m.items.values());
  const targets = new Float32Array(hf.n * hf.n).fill(NaN);
  m.stampTargets(targets);
  const raster = new RoadRaster(net.half);
  m.stampRaster(raster);
  return {
    ...L, targets, raster,
    geos: [...m.geos.values()].map((g) => ({ ...g, s: g.s.src! })),
    junctions: [...m.junctions].map(([id, j]) => ({ node: Number(id), ...j })),
    stats: m.stats,
  };
}

// ===== roundabout surface =====

function roundabout(node: MNode, E: End[], zf: (x: number, z: number) => number, asphalt: GeomBuilder, paving: GeomBuilder, markings: GeomBuilder) {
  const rw = ringHalfWidth(node);
  const R = node.R!, Ro = R + rw, Ri = Math.max(2.5, R - rw);
  const cx = node.x, cz = node.z;
  const angOf = (p: V2) => Math.atan2(p[1] - cz, p[0] - cx);
  const circ = (a: number, r: number): V2 => [cx + Math.cos(a) * r, cz + Math.sin(a) * r];
  const F = E.map((e) => {
    const fr = frameAt(e.g, e.atA ? e.trim : e.g.len - e.trim, e.atA);
    const P = (o: number): V2 => [fr.x + fr.lx * o, fr.z + fr.lz * o];
    return { e, fr, CL: P(e.cwL), CR: P(-e.cwR) };
  }).sort((p, q) => angOf([p.fr.x, p.fr.z]) - angOf([q.fr.x, q.fr.z]));
  const poly: V2[] = [];
  const d = 4 / Ro;
  if (!F.length) {
    for (let k = 0; k < 48; k++) poly.push(circ((k / 48) * Math.PI * 2, Ro));
  }
  for (let i = 0; i < F.length; i++) {
    const a = F[i], b = F[(i + 1) % F.length];
    poly.push(a.CL, a.CR);
    let a1 = angOf(a.CR) + d, a2 = angOf(b.CL) - d;
    while (a2 <= a1) a2 += Math.PI * 2;
    if (F.length === 1) a2 = a1 + Math.PI * 2 - 2 * d;
    const q1 = circ(a1, Ro), q2 = circ(a2, Ro);
    const tan = (a: number): V2 => [-Math.sin(a), Math.cos(a)];
    const c1 = corner(a.CR, [-a.fr.ux, -a.fr.uz], q1, tan(a1));
    for (let k = 1; k < c1.length; k++) poly.push(c1[k]);
    const steps = Math.max(2, Math.ceil((a2 - a1) / 0.08));
    for (let k = 1; k < steps; k++) poly.push(circ(a1 + ((a2 - a1) * k) / steps, Ro));
    const c2 = corner(q2, tan(a2), b.CL, [b.fr.ux, b.fr.uz]);
    for (let k = 0; k < c2.length - 1; k++) poly.push(c2[k]);
  }
  const island: V2[] = [];
  for (let k = 0; k < 48; k++) island.push(circ((-k / 48) * Math.PI * 2, Ri));
  drapePolygon(asphalt, new Float32Array(poly.flat()), [new Float32Array(island.flat())], zf, COL.junction, 4);
  // central island: raised grass with a kerb
  const isl = new Float32Array(island.flat());
  drapePolygon(paving, isl, [], (x, z) => zf(x, z) + 0.25, COL.island, 4);
  polyWall(paving, [...island, island[0]].reverse(), (x, z) => zf(x, z) - 0.05, (x, z) => zf(x, z) + 0.25, COL.kerb);
  // ring markings: inner edge line + lane divider
  ringLine(markings, cx, cz, Ri + 0.35, 0.14, zf, false, COL.white);
  if ((node.ringLanes ?? 1) >= 2) ringLine(markings, cx, cz, R, 0.12, zf, true, COL.white);
  // give-way lines across incoming lanes
  for (const f of F) {
    const offs = partOffsets(f.e.g.t);
    f.e.g.t.parts.forEach((p, k) => {
      if (p.kind !== 'lane' && p.kind !== 'bus') return;
      const incoming = f.e.atA ? p.dir === -1 : p.dir === 1;
      if (!incoming && p.dir !== 0) return;
      const [o0, o1] = offs[k];
      const side = f.e.atA ? 1 : -1; // outward-left = segment-left at A, segment-right at B
      dashedAcross(markings, f.fr, side * o0, side * o1, 0.6, zf);
    });
  }
  return { poly, island: isl };
}

function ringHalfWidth(n: MNode) { return ((n.ringLanes ?? 1) * 4.0) / 2 + 0.5; }

/** Kerb-style corner from point a (heading da) to point b (heading db). */
function corner(a: V2, da: V2, b: V2, db: V2): V2[] {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const cosTurn = Math.max(-1, Math.min(1, da[0] * db[0] + da[1] * db[1]));
  const turn = Math.acos(cosTurn);
  const h = d * (turn < 0.05 ? 0.33 : Math.min(0.6, (4 / 3) * Math.tan(turn / 4) / (2 * Math.sin(Math.max(turn, 0.05) / 2))));
  const n = Math.max(3, Math.ceil(turn / 0.12));
  return cubicPts(a, [a[0] + da[0] * h, a[1] + da[1] * h], [b[0] - db[0] * h, b[1] - db[1] * h], b, n);
}

// ---------------- markings ----------------

function strip(gb: GeomBuilder, S: Sub, center: number, width: number, z: (i: number, x: number, zz: number) => number, rgb: [number, number, number]) {
  sweep(gb, S, center + width / 2, center - width / 2, (i, x, zz) => z(i, x, zz) + 0.025, rgb);
}

function segmentMarkings(gb: GeomBuilder, g: SegGeo, S: Sub, z: (i: number, x: number, zz: number) => number, offs: [number, number][]) {
  const t = g.t;
  if (t.surface === 'dirt') return;
  const L = S.s[S.s.length - 1] - S.s[0];
  if (L < 3) return;
  const pieces = (dash: number, gap: number, center: number, width: number, rgb: [number, number, number]) => {
    // dashes in arc length, phase-locked to the segment so neighbours line up
    const s0 = S.s[0], s1 = S.s[S.s.length - 1];
    for (let a = Math.ceil(s0 / (dash + gap)) * (dash + gap); a < s1 - 0.5; a += dash + gap) {
      const b = Math.min(a + dash, s1 - 0.5);
      if (b - a < 0.5) continue;
      const sub = cutSub(S, a, b);
      strip(gb, sub.S, center, width, (i, x, zz) => z(sub.map(i), x, zz), rgb);
    }
  };
  const solid = (center: number, width: number, rgb: [number, number, number]) => {
    const sub = cutSub(S, S.s[0] + 0.8, S.s[S.s.length - 1] - 0.8);
    strip(gb, sub.S, center, width, (i, x, zz) => z(sub.map(i), x, zz), rgb);
  };
  const lanes = t.parts.map((p, k) => ({ p, o: offs[k] })).filter((x) => x.p.kind === 'lane' || x.p.kind === 'bus');
  for (let k = 1; k < lanes.length; k++) {
    const a = lanes[k - 1], b = lanes[k];
    const at = a.o[1];
    if (a.o[1] !== b.o[0]) continue; // separated by a median
    if (a.p.dir !== b.p.dir) {
      if (t.lanesF >= 2 || t.major) { solid(at + 0.17, 0.12, COL.yellow); solid(at - 0.17, 0.12, COL.yellow); }
      else pieces(3, 4, at, 0.12, COL.white);
    } else pieces(3, 5, at, 0.12, COL.white);
  }
  if (t.major && lanes.length) {
    solid(lanes[0].o[0] - 0.25, 0.14, COL.white);
    solid(lanes[lanes.length - 1].o[1] + 0.25, 0.14, COL.white);
  }
}

/** Sub-range of a Sub between arc lengths a..b, with an index map back to the parent. */
function cutSub(S: Sub, a: number, b: number) {
  const out: Sub = { pts: [], nrm: [], s: [] };
  const map: number[] = [];
  const n = S.s.length;
  const at = (s: number) => {
    let i = 0;
    while (i < n - 2 && S.s[i + 1] < s) i++;
    const t = Math.max(0, Math.min(1, (s - S.s[i]) / ((S.s[i + 1] - S.s[i]) || 1)));
    out.pts.push(S.pts[i * 2] + (S.pts[i * 2 + 2] - S.pts[i * 2]) * t, S.pts[i * 2 + 1] + (S.pts[i * 2 + 3] - S.pts[i * 2 + 1]) * t);
    let nx = S.nrm[i * 2] + (S.nrm[i * 2 + 2] - S.nrm[i * 2]) * t, nz = S.nrm[i * 2 + 1] + (S.nrm[i * 2 + 3] - S.nrm[i * 2 + 1]) * t;
    const l = Math.hypot(nx, nz) || 1;
    out.nrm.push(nx / l, nz / l);
    out.s.push(s);
    map.push(t < 0.5 ? i : i + 1);
  };
  at(a);
  for (let i = 0; i < n; i++) if (S.s[i] > a + 0.02 && S.s[i] < b - 0.02) { out.pts.push(S.pts[i * 2], S.pts[i * 2 + 1]); out.nrm.push(S.nrm[i * 2], S.nrm[i * 2 + 1]); out.s.push(S.s[i]); map.push(i); }
  at(b);
  return { S: out, map: (i: number) => map[i] };
}

type Frame = ReturnType<typeof frameAt>;

/** Dashed line across a road end, between outward-left offsets o0..o1, `inset` metres back from the end. */
function dashedAcross(gb: GeomBuilder, fr: Frame, o0: number, o1: number, inset: number, zf: (x: number, z: number) => number, dashed = true) {
  const lo = Math.min(o0, o1) + 0.2, hi = Math.max(o0, o1) - 0.2;
  const cx = fr.x + fr.ux * inset, cz = fr.z + fr.uz * inset;
  const step = dashed ? 1.0 : hi - lo;
  for (let o = lo; o < hi - 0.1; o += step) {
    const o2 = Math.min(o + (dashed ? 0.6 : hi - lo), hi);
    const p = (oo: number, along: number): V2 => [cx + fr.lx * oo + fr.ux * along, cz + fr.lz * oo + fr.uz * along];
    const q = [p(o, -0.2), p(o2, -0.2), p(o2, 0.2), p(o, 0.2)];
    drapePolygon(gb, new Float32Array(q.flat()), [], (x, z) => zf(x, z) + 0.03, COL.white, 50);
  }
}

function junctionMarkings(gb: GeomBuilder, node: MNode, F: { e: End; fr: Frame }[], zf: (x: number, z: number) => number) {
  const major = F.filter((f) => f.e.g.t.major).length;
  if (F.length < 3) return;
  for (const f of F) {
    const t = f.e.g.t;
    if (t.surface === 'dirt') continue;
    const offs = partOffsets(t);
    const side = f.e.atA ? 1 : -1;
    // stop line across incoming lanes
    let lo = Infinity, hi = -Infinity;
    t.parts.forEach((p, k) => {
      if (p.kind !== 'lane' && p.kind !== 'bus') return;
      const incoming = f.e.atA ? p.dir === -1 : p.dir === 1;
      if (!incoming && p.dir !== 0) return;
      const [o0, o1] = offs[k];
      lo = Math.min(lo, side * o0, side * o1); hi = Math.max(hi, side * o0, side * o1);
    });
    if (hi > lo) dashedAcross(gb, f.fr, lo, hi, major >= 2 || node.signals ? 4.4 : 0.8, zf, !(node.signals || t.major));
    // zebra crossing on bigger junctions
    if (node.crossings ?? (node.signals || t.major)) {
      const cw = Math.max(f.e.cwL, f.e.cwR);
      for (let o = -cw + 0.4; o < cw - 0.5; o += 1.0) {
        const p = (oo: number, along: number): V2 => [f.fr.x + f.fr.lx * oo + f.fr.ux * along, f.fr.z + f.fr.lz * oo + f.fr.uz * along];
        const q = [p(o, 0.6), p(o + 0.5, 0.6), p(o + 0.5, 3.6), p(o, 3.6)];
        drapePolygon(gb, new Float32Array(q.flat()), [], (x, z) => zf(x, z) + 0.03, COL.white, 50);
      }
    }
  }
}

function ringLine(gb: GeomBuilder, cx: number, cz: number, r: number, w: number, zf: (x: number, z: number) => number, dashed: boolean, rgb: [number, number, number]) {
  const n = Math.max(24, Math.ceil((Math.PI * 2 * r) / 1.2));
  for (let k = 0; k < n; k++) {
    if (dashed && k % 3 === 2) continue;
    const a0 = (k / n) * Math.PI * 2, a1 = ((k + 1) / n) * Math.PI * 2;
    const q: V2[] = [
      [cx + Math.cos(a0) * (r - w / 2), cz + Math.sin(a0) * (r - w / 2)], [cx + Math.cos(a1) * (r - w / 2), cz + Math.sin(a1) * (r - w / 2)],
      [cx + Math.cos(a1) * (r + w / 2), cz + Math.sin(a1) * (r + w / 2)], [cx + Math.cos(a0) * (r + w / 2), cz + Math.sin(a0) * (r + w / 2)],
    ];
    drapePolygon(gb, new Float32Array(q.flat()), [], (x, z) => zf(x, z) + 0.03, rgb, 50);
  }
}

// ---------------- terrain stamping ----------------

/** Region clamp for grid loops: [i0, i1] × [j0, j1] of a regular grid, optionally limited to a metric region. */
function gridRange(cell: number, half: number, gn: number, x0: number, z0: number, x1: number, z1: number, region?: [number, number, number, number]) {
  if (region) { x0 = Math.max(x0, region[0]); z0 = Math.max(z0, region[1]); x1 = Math.min(x1, region[2]); z1 = Math.min(z1, region[3]); }
  return {
    i0: Math.max(0, Math.ceil((x0 + half) / cell)), i1: Math.min(gn - 1, Math.floor((x1 + half) / cell)),
    j0: Math.max(0, Math.ceil((z0 + half) / cell)), j1: Math.min(gn - 1, Math.floor((z1 + half) / cell)),
  };
}

/** Terrain target under a ground-level road: 0.3 m below the road surface along the centre line. */
function stampLine(hf: Heightfield, targets: Float32Array, line: Float32Array, hw: number, T: (x: number, z: number) => number, region?: [number, number, number, number], zs?: Float32Array) {
  const cell = hf.cell, half = hf.half, gn = hf.n;
  const rad = hw + cell * 0.75, rad2 = rad * rad;
  for (let i = 0; i < line.length / 2; i++) {
    const x = line[i * 2], z = line[i * 2 + 1], tz = (zs ? zs[i] : T(x, z)) - 0.3;
    const r = gridRange(cell, half, gn, x - rad, z - rad, x + rad, z + rad, region);
    for (let jj = r.j0; jj <= r.j1; jj++) for (let ii = r.i0; ii <= r.i1; ii++) {
      const dx = -half + ii * cell - x, dz = -half + jj * cell - z;
      if (dx * dx + dz * dz > rad2) continue;
      const k = jj * gn + ii;
      if (Number.isNaN(targets[k]) || tz < targets[k]) targets[k] = tz;
    }
  }
}

function stampPolygon(hf: Heightfield, targets: Float32Array, ring: Float32Array, zf: (x: number, z: number) => number, region?: [number, number, number, number]) {
  const cell = hf.cell, half = hf.half, gn = hf.n, m = ring.length / 2;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]); }
  const pad = cell * 0.75;
  const r = gridRange(cell, half, gn, x0 - pad - cell, z0 - pad - cell, x1 + pad + cell, z1 + pad + cell, region);
  for (let jj = r.j0; jj <= r.j1; jj++)
    for (let ii = r.i0; ii <= r.i1; ii++) {
      const x = -half + ii * cell, z = -half + jj * cell;
      let inside = false, best = Infinity, px = x, pz = z;
      for (let a = 0, b = m - 1; a < m; b = a++) {
        const xa = ring[a * 2], za = ring[a * 2 + 1], xb = ring[b * 2], zb = ring[b * 2 + 1];
        if ((za > z) !== (zb > z) && x < ((xb - xa) * (z - za)) / (zb - za) + xa) inside = !inside;
        const dx = xb - xa, dz = zb - za, t = Math.max(0, Math.min(1, ((x - xa) * dx + (z - za) * dz) / (dx * dx + dz * dz || 1e-9)));
        const qx = xa + dx * t, qz = za + dz * t, d = Math.hypot(x - qx, z - qz);
        if (d < best) { best = d; px = qx; pz = qz; }
      }
      if (!inside && best > pad) continue;
      const tz = inside ? zf(x, z) : zf(px, pz);
      const k = jj * gn + ii;
      if (Number.isNaN(targets[k]) || tz < targets[k]) targets[k] = tz;
    }
}

// ---------------- sunken roads: trenches and tunnels ----------------

/** Samples i..j of a sub-range (inclusive). */
function slice(S: Sub, i: number, j: number): Sub {
  return { pts: S.pts.slice(i * 2, j * 2 + 2), nrm: S.nrm.slice(i * 2, j * 2 + 2), s: S.s.slice(i, j + 1) };
}

/** Runs of consecutive samples where `f` holds (each run shares its end sample with the next, so there are no gaps). */
function runs(n: number, f: (i: number) => boolean): [number, number, boolean][] {
  const out: [number, number, boolean][] = [];
  let a = 0;
  for (let i = 1; i <= n; i++) if (i === n || f(i) !== f(a)) { out.push([a, Math.min(i, n - 1), f(a)]); a = i; }
  return out;
}

/**
 * Below ground: retaining walls up to the ground (with a parapet) where it's an open trench; where it's deeper than
 * COVER, a tunnel box (walls, ceiling) under untouched ground, and a portal wall where the trench goes under.
 */
function underground(gb: GeomBuilder, S: Sub, z: (i: number, x: number, zz: number) => number, t: RoadType, T: (x: number, z: number) => number) {
  const n = S.s.length;
  if (n < 2) return;
  const L = t.hwL + 0.3, R = -(t.hwR + 0.3);
  const zc = (i: number) => z(i, S.pts[i * 2], S.pts[i * 2 + 1]);
  const covered = (i: number) => T(S.pts[i * 2], S.pts[i * 2 + 1]) - zc(i) >= COVER;
  const bottom = (i: number, x: number, zz: number) => z(i, x, zz) - 0.4;
  const top = (i: number, x: number, zz: number) => (covered(i) ? z(i, x, zz) + CEIL : Math.max(T(x, zz), z(i, x, zz)) + 0.9);
  wallAlong(gb, S, L, bottom, top, false, COL.concrete);
  wallAlong(gb, S, R, bottom, top, true, COL.concrete);
  for (const [a, b, cov] of runs(n, covered)) {
    if (!cov || b <= a) continue;
    const sub = slice(S, a, b);
    sweep(gb, sub, R, L, (k, x, zz) => z(k + a, x, zz) + CEIL, COL.concreteDark); // ceiling (faces down)
    sweep(gb, sub, L, R, (k, x, zz) => z(k + a, x, zz) + CEIL + 0.6, COL.concrete); // roof slab
    // portals: where the open trench meets the covered part, a face wall up to the ground
    for (const i of [a, b]) {
      if ((i === a && i === 0) || (i === b && i === n - 1)) continue;
      const x = S.pts[i * 2], zz = S.pts[i * 2 + 1];
      const yaw = Math.atan2(-S.nrm[i * 2], S.nrm[i * 2 + 1]);
      gb.box(x, zz, zc(i) + CEIL - 0.2, T(x, zz) + 0.4, 0.8, L - R + 0.6, yaw, COL.concrete);
    }
  }
}

/** Terrain stamps of a sunken piece: the open stretches are cut down to the road; covered tunnel leaves the ground. */
function trenchStamps(S: Sub, z: (i: number, x: number, zz: number) => number, hw: number, code: number, T: (x: number, z: number) => number): Stamp[] {
  const n = S.s.length;
  const zc = (i: number) => z(i, S.pts[i * 2], S.pts[i * 2 + 1]);
  const open = (i: number) => T(S.pts[i * 2], S.pts[i * 2 + 1]) - zc(i) < COVER;
  const out: Stamp[] = [];
  for (const [a, b, op] of runs(n, open)) {
    if (!op) continue;
    const line = new Float32Array(S.pts.slice(a * 2, b * 2 + 2));
    const zs = new Float32Array(b - a + 1);
    for (let i = a; i <= b; i++) zs[i - a] = zc(i) - LIFT;
    out.push({ line, hw: hw + 0.3, carve: true, code, z: zs });
  }
  return out;
}

// ---------------- elevated structure ----------------

function structure(gb: GeomBuilder, g: SegGeo, S: Sub, z: (i: number, x: number, zz: number) => number, t: RoadType, T: (x: number, z: number) => number) {
  const L = t.hwL, R = -t.hwR;
  const clear = (i: number) => z(i, S.pts[i * 2], S.pts[i * 2 + 1]) - T(S.pts[i * 2], S.pts[i * 2 + 1]);
  const bottom = (i: number, x: number, zz: number) => (clear(i) > 3.2 ? z(i, x, zz) - SLAB : T(x, zz) - 0.4);
  sweep(gb, S, R, L, bottom, COL.concreteDark); // underside (faces down)
  wallAlong(gb, S, L, bottom, (i, x, zz) => z(i, x, zz) + (clear(i) > 1.5 ? 1.0 : 0.1), true, COL.concrete);
  wallAlong(gb, S, R, bottom, (i, x, zz) => z(i, x, zz) + (clear(i) > 1.5 ? 1.0 : 0.1), false, COL.concrete);
  // pillars every ~26 m
  const s0 = S.s[0], s1 = S.s[S.s.length - 1];
  for (let s = s0 + 13; s < s1 - 5; s += 26) {
    let i = 0;
    while (i < S.s.length - 2 && S.s[i + 1] < s) i++;
    const x = S.pts[i * 2], zz = S.pts[i * 2 + 1];
    const top = z(i, x, zz) - SLAB, gnd = T(x, zz);
    if (top - gnd < 2) continue;
    const yaw = Math.atan2(-S.nrm[i * 2], S.nrm[i * 2 + 1]);
    const w = t.hwL + t.hwR;
    gb.box(x, zz, gnd - 1, top - 0.6, 1.4, Math.min(w * 0.45, 3.2), yaw, COL.concrete);
    gb.box(x, zz, top - 0.6, top, 1.8, w * 0.85, yaw, COL.concreteDark);
  }
}

// ---------------- paths ----------------

function pathRibbon(gb: GeomBuilder, pts: number[], width: number, T: (x: number, z: number) => number) {
  const n = pts.length / 2;
  if (n < 2) return;
  const S: Sub = { pts: [], nrm: [], s: [] };
  let acc = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) acc += Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    let dx = pts[b * 2] - pts[a * 2], dz = pts[b * 2 + 1] - pts[a * 2 + 1];
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    S.pts.push(pts[i * 2], pts[i * 2 + 1]); S.nrm.push(dz, -dx); S.s.push(acc);
  }
  sweep(gb, S, width / 2, -width / 2, (_i, x, z) => T(x, z) + 0.09, COL.path);
}
