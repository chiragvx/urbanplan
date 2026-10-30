// Procedural road geometry from the clean network — Cities: Skylines style.
//
//  Segments: the road type's cross-section is swept along each Bézier (lanes, median, kerbs, footpaths, markings).
//  Junctions: every road end is trimmed back so that a kerb fillet fits between neighbouring roads; the junction
//             surface is the polygon of trimmed road ends joined by curved kerb corners (+ raised footpath corners).
//  Roundabouts: a ring (outer/inner radius) with filleted entries and a raised central island.
//  Heights: ground surfaces follow the terrain per vertex; elevated chains interpolate between node heights;
//           shared edges use identical positions → identical heights → no cracks.
import { GeomBuilder, drapePolygon, rgbHex } from '../build/geom';
import { type Network, type NetSegment, type RoadType, type V2, type BridgeKind, type PartKind, type Part, sampleBez, bezD, partOffsets } from './model';
import type { Heightfield } from '../geo/heightfield';
import { RoadRaster } from '../geo/roadraster';

const LIFT = 0.06, KERB = 0.15, SLAB = 1.3;

const COL = {
  asphalt: rgbHex(0x4b4d51), asphaltMajor: rgbHex(0x45474b), junction: rgbHex(0x484a4e), dirt: rgbHex(0x8a7558),
  sidewalk: rgbHex(0xbdb4a4), kerb: rgbHex(0x9d9a93), median: rgbHex(0x8f8c84), island: rgbHex(0x6f9446),
  bus: rgbHex(0x7a4a44), cycle: rgbHex(0x4f6f52), parking: rgbHex(0x55585d),
  white: rgbHex(0xe9e9e4), yellow: rgbHex(0xe2bd3f),
  pole: rgbHex(0x5d6168), head: rgbHex(0x23262a), red: rgbHex(0xff3b30), green: rgbHex(0x34e07a), lampOff: rgbHex(0x3a3d42), concrete: rgbHex(0xa8a49b), concreteDark: rgbHex(0x8e8a82), path: rgbHex(0xb3a88f),
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
    // keep the interpolated length: a mitred end's normal is longer than 1 (offsets stretch along the mitre)
    const l0 = Math.hypot(g.nrm[i * 2], g.nrm[i * 2 + 1]), l1 = Math.hypot(g.nrm[i * 2 + 2], g.nrm[i * 2 + 3]);
    const l = (Math.hypot(nx, nz) || 1) / (l0 + (l1 - l0) * t || 1);
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
  const nl = Math.hypot(sub.nrm[k * 2], sub.nrm[k * 2 + 1]) || 1;
  let nx = sub.nrm[k * 2] / nl, nz = sub.nrm[k * 2 + 1] / nl; // left normal of a→b (unit, also at mitred ends)
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

/** A lateral offset (left-positive, metres): fixed, or varying with arc length along the segment (tapers). */
type Off = number | ((s: number) => number);
const ov = (o: Off, s: number) => (typeof o === 'number' ? o : o(s));

/** Up-facing strip between left-positive offsets o0 > o1 along a sub-range, heights per vertex. */
function sweep(gb: GeomBuilder, S: Sub, o0: Off, o1: Off, z: (i: number, x: number, zz: number) => number, rgb: [number, number, number]) {
  const m = S.s.length;
  if (m < 2) return;
  const lim = foldLimits(S);
  const base = gb.vertexCount;
  for (let i = 0; i < m; i++) {
    const x = S.pts[i * 2], zz = S.pts[i * 2 + 1], nx = S.nrm[i * 2], nz = S.nrm[i * 2 + 1];
    const A = ov(o0, S.s[i]), B = ov(o1, S.s[i]);
    const a = clampOff(A, lim, i), b = clampOff(B, lim, i);
    const lx = x + nx * a, lz = zz + nz * a, rx = x + nx * b, rz = zz + nz * b;
    gb.v(lx, z(i, lx, lz), lz, 0, 1, 0, ...rgb, S.s[i] * 0.25, A * 0.25);
    gb.v(rx, z(i, rx, rz), rz, 0, 1, 0, ...rgb, S.s[i] * 0.25, B * 0.25);
  }
  for (let i = 0; i < m - 1; i++) {
    const k = base + i * 2;
    gb.tri(k, k + 1, k + 2);
    gb.tri(k + 1, k + 3, k + 2);
  }
}

/** Vertical wall along offset o from z0(i) to z1(i); faces left if `faceLeft`. */
function wallAlong(gb: GeomBuilder, S: Sub, o: Off, zb: (i: number, x: number, zz: number) => number, zt: (i: number, x: number, zz: number) => number, faceLeft: boolean, rgb: [number, number, number]) {
  const m = S.s.length;
  if (m < 2) return;
  const base = gb.vertexCount;
  const sg = faceLeft ? 1 : -1;
  const lim = foldLimits(S);
  for (let i = 0; i < m; i++) {
    const nx = S.nrm[i * 2], nz = S.nrm[i * 2 + 1];
    const oo = clampOff(ov(o, S.s[i]), lim, i);
    const x = S.pts[i * 2] + nx * oo, zz = S.pts[i * 2 + 1] + nz * oo;
    const nl = Math.hypot(nx, nz) || 1;
    gb.v(x, zb(i, x, zz), zz, (nx / nl) * sg, 0, (nz / nl) * sg, ...rgb);
    gb.v(x, zt(i, x, zz), zz, (nx / nl) * sg, 0, (nz / nl) * sg, ...rgb);
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

// ---------------- transitions between cross-sections ----------------

/** Replace both end normals at a through node by the bisector, stretched so widths hold across the mitre. */
function mitre(e: End, f: End) {
  // outward directions point away from the node; the road runs e → node → f
  const tx = -e.ux + f.ux, tz = -e.uz + f.uz; // through direction (e's inward + f's outward)
  const l = Math.hypot(tx, tz) || 1;
  const dx = tx / l, dz = tz / l;
  const c = Math.max(0.5, -(e.ux * f.ux + e.uz * f.uz)); // cos of the deflection
  const half = Math.sqrt((1 + c) / 2); // cos of half the deflection
  for (const end of [e, f]) {
    const g = end.g, k = end.atA ? 0 : g.pts.length - 2;
    // a→b tangent of this segment at the node
    const sg = (end === e) !== end.atA ? 1 : -1; // e's a→b runs along the through direction iff the node is its b end
    const ax = dx * sg, az = dz * sg;
    g.nrm[k] = az / half; g.nrm[k + 1] = -ax / half; // left normal of a→b, stretched
  }
}

/** A road type's cross-section seen in the other direction when `rev`. */
function orient(t: RoadType, rev: boolean): Blend {
  if (!rev) return { parts: t.parts, hwL: t.hwL };
  return { parts: t.parts.slice().reverse().map((p) => ({ ...p, dir: (p.dir === 0 ? 0 : -p.dir) as Part['dir'] })), hwL: t.hwR };
}

const partKey = (p: Part) => (p.kind === 'lane' || p.kind === 'bus' ? `${p.kind}${p.dir}` : p.kind);

/** Longest common subsequence of part kinds: pairs [i in a | -1, j in b | -1] in left → right order. */
function alignParts(a: Part[], b: Part[]): [number, number][] {
  const n = a.length, m = b.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = partKey(a[i]) === partKey(b[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const out: [number, number][] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && partKey(a[i]) === partKey(b[j])) { out.push([i++, j++]); continue; }
    if (j >= m || (i < n && L[i + 1][j] >= L[i][j + 1])) out.push([i++, -1]);
    else out.push([-1, j++]);
  }
  return out;
}

/** One part of a segment's cross-section, with its width at the node of each end (the joint section). */
interface ProfPart { kind: PartKind; dir: Part['dir']; w: number; wa: number; wb: number }
/** A segment's cross-section along its length: its own type, tapering at each end to the joint section. */
export interface Profile {
  parts: ProfPart[]; hl: number; hla: number; hlb: number; La: number; Lb: number; len: number; blended: boolean;
  /** room under a flyover: part k (the median, inserted if the road has none) widens by e(s); where gap(s) > 0 a
   *  ramp's walls stand in it (nothing drawn), elsewhere it's a pier median */
  deck?: { k: number; e: (s: number) => number; gap: (s: number) => number; max: number };
}

/** Under-deck room along a ground road: how much wider its median gets (piers) and where a ramp fills it. */
interface DeckRoom { e: (s: number) => number; gap: (s: number) => number; max: number }

/** Index of a road's median, or where one goes (between the two directions; the middle of a one-way road). */
function medianSlot(parts: { kind: PartKind; dir: Part['dir'] }[]): { k: number; insert: boolean } {
  const m = parts.findIndex((p) => p.kind === 'median');
  if (m >= 0) return { k: m, insert: false };
  for (let k = 1; k < parts.length; k++) {
    const a = parts[k - 1], b = parts[k];
    if ((a.kind === 'lane' || a.kind === 'bus') && (b.kind === 'lane' || b.kind === 'bus') && a.dir !== b.dir) return { k, insert: true };
  }
  return { k: Math.floor(parts.length / 2), insert: true };
}

function profileOf(g: SegGeo, deck?: DeckRoom | null): Profile {
  const prof = blendProfile(g);
  if (deck && deck.max > 0.05) {
    const m = medianSlot(prof.parts);
    if (m.insert) prof.parts.splice(m.k, 0, { kind: 'median', dir: 0, w: 0, wa: 0, wb: 0 });
    prof.deck = { k: m.k, e: deck.e, gap: deck.gap, max: deck.max };
    prof.blended = true;
  }
  return prof;
}

function blendProfile(g: SegGeo): Profile {
  const own = g.t.parts;
  const parts: ProfPart[] = own.map((p) => ({ kind: p.kind, dir: p.dir, w: p.width, wa: p.width, wb: p.width }));
  const prof: Profile = { parts, hl: g.t.hwL, hla: g.t.hwL, hlb: g.t.hwL, La: 0, Lb: 0, len: g.len, blended: false };
  if (!g.blendA && !g.blendB) return prof;
  prof.blended = true;
  // insert the parts only the neighbours have (they grow from nothing), then set each end's joint widths
  const ins: { before: number; p: Part; end: 'a' | 'b'; j: number }[] = [];
  const pairs: Record<'a' | 'b', [number, number][]> = { a: [], b: [] };
  for (const end of ['a', 'b'] as const) {
    const bl = end === 'a' ? g.blendA : g.blendB;
    if (!bl) continue;
    const al = alignParts(own, bl.parts);
    pairs[end] = al;
    let next = 0;
    for (const [i, j] of al) { if (i >= 0) next = i + 1; else ins.push({ before: next, p: bl.parts[j], end, j }); }
  }
  const merged: (ProfPart & { src?: { end: 'a' | 'b'; j: number }; own?: number })[] = [];
  for (let i = 0; i <= own.length; i++) {
    for (const x of ins.filter((x) => x.before === i)) merged.push({ kind: x.p.kind, dir: x.p.dir, w: 0, wa: 0, wb: 0, src: { end: x.end, j: x.j } });
    if (i < own.length) merged.push({ ...parts[i], own: i });
  }
  for (const end of ['a', 'b'] as const) {
    const bl = end === 'a' ? g.blendA : g.blendB;
    if (!bl) continue;
    const ownToOther = new Map<number, number>();
    for (const [i, j] of pairs[end]) if (i >= 0 && j >= 0) ownToOther.set(i, j);
    for (const m of merged) {
      const other = m.own !== undefined ? (ownToOther.has(m.own) ? bl.parts[ownToOther.get(m.own)!].width : 0) : m.src!.end === end ? bl.parts[m.src!.j].width : 0;
      const joint = (m.w + other) / 2; // both sides taper to the same joint section
      if (end === 'a') m.wa = joint; else m.wb = joint;
    }
    if (end === 'a') prof.hla = (g.t.hwL + bl.hwL) / 2; else prof.hlb = (g.t.hwL + bl.hwL) / 2;
  }
  prof.parts = merged.map(({ kind, dir, w, wa, wb }) => ({ kind, dir, w, wa, wb }));
  // taper lengths from the largest boundary shift at each end
  for (const end of ['a', 'b'] as const) {
    const hj = end === 'a' ? prof.hla : prof.hlb;
    let o = g.t.hwL, oj = hj, d = Math.abs(o - oj);
    for (const p of prof.parts) { o -= p.w; oj -= end === 'a' ? p.wa : p.wb; d = Math.max(d, Math.abs(o - oj)); }
    const L = d < 0.02 ? 0 : Math.min(Math.max(TAPER * d, TAPER_MIN), 0.45 * g.len);
    if (end === 'a') prof.La = L; else prof.Lb = L;
  }
  return prof;
}

const smooth01 = (x: number) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

/** [o0, o1] of each profile part (left-positive), fixed when the segment has no taper. */
function profileOffsets(P: Profile): [Off, Off][] {
  if (!P.blended) {
    let o = P.hl;
    return P.parts.map((p) => { const r: [Off, Off] = [o, o - p.w]; o -= p.w; return r; });
  }
  const fa = (s: number) => (P.La > 0 ? 1 - smooth01(s / P.La) : 0);
  const fb = (s: number) => (P.Lb > 0 ? 1 - smooth01((P.len - s) / P.Lb) : 0);
  const D = P.deck;
  // a widened median pushes both sides out by half its extra width
  const left = (s: number) => P.hl + (P.hla - P.hl) * fa(s) + (P.hlb - P.hl) * fb(s) + (D ? D.e(s) / 2 : 0);
  const width = (k: number, s: number) => { const p = P.parts[k]; return Math.max(0, p.w + (p.wa - p.w) * fa(s) + (p.wb - p.w) * fb(s)) + (D && D.k === k ? D.e(s) : 0); };
  const edge = (k: number, s: number) => { let o = left(s); for (let j = 0; j < k; j++) o -= width(j, s); return o; };
  return P.parts.map((_, k) => [(s: number) => edge(k, s), (s: number) => edge(k + 1, s)]);
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
  /** signal phases (default: by the number of arms) and the phase shown green */
  phases?: number; phase?: number;
  /** yellow box marking (keep clear) */
  box?: boolean;
  /** free-left slip lanes: from one arm (owner section id) to the next arm round, width / radius in metres */
  slips?: SlipSpec[];
  /** raised / lowered as part of a graded run: a ground junction at terrain + lift (the ground cut / filled), not a deck */
  graded?: boolean;
}

export interface SlipSpec { from: string; to: string; w?: number; r?: number }

/** A junction arm followed outwards through shape / transition nodes: pieces with their `along` ranges. */
type Chain = { g: SegGeo; atA: boolean; a0: number; s0: number; L: number }[];
/** Arm geometry along a chain: frame and road height `along` metres out from the junction's trim line. */
interface ArmPath { frame: (along: number) => Frame; z: (along: number, x: number, z: number) => number; length: number }
/** A slip lane laid out at a junction: its two arm ends and where it leaves / rejoins them (metres past the trims). */
interface SlipG { eA: End; eB: End; w: number; r: number; dA: number; dB: number; taper: number; pA: ArmPath; pB: ArmPath; curb: V2[]; hk: number }
const SLIP_TAPER = 12;

/** One cubic piece of road. */
export interface MSeg {
  id: string; a: string; b: string;
  /** cubic Bézier control points x0,z0,x1,z1,x2,z2,x3,z3 */
  p: number[];
  t: RoadType; cls: string; bridge: BridgeKind;
  elevated?: boolean; viaduct?: boolean;
  /** below the ground (a trench, underpass or tunnel) */ sunk?: boolean;
  /** graded road: [pieceLength, s0, z0, s1, z1, …] — a fixed height profile (scene metres) the ground is cut / filled to */
  grade?: number[];
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
  /** ring stamps: the ground junction's surface (instead of the terrain) */ plane?: (x: number, z: number) => number;
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
  /** exact end normals (before a mitre at a transition / seamless node replaces them) */
  n0: [number, number, number, number];
  /** the neighbour across a transition node at each end, seen in this segment's a→b direction */
  blendA?: Blend; blendB?: Blend;
}

/** A neighbouring road type across a transition, oriented like this segment (left → right looking a → b). */
interface Blend { parts: Part[]; hwL: number }

interface End {
  g: SegGeo; atA: boolean; node: MNode;
  ux: number; uz: number; ang: number; // outward direction at the node
  hwL: number; hwR: number; cwL: number; cwR: number; // relative to outward direction
  trim: number; rc: number;
}

type NodeKind = 'seamless' | 'transition' | 'merge' | 'junction' | 'roundabout' | 'end' | 'shape';

/** Two roads meeting within this angle of straight continue through the node (no junction surface). */
const THROUGH_COS = Math.cos((25 * Math.PI) / 180);
/** Width changes taper at 1 : TAPER (IRC:86 / urban streets), never shorter than TAPER_MIN on each side. */
const TAPER = 10, TAPER_MIN = 4;
/** A deck lower than this over a road is a ramp on walls (it takes room in the median); higher, it stands on piers. */
const DECK_CLEAR = 4.5;
/** Median the piers of a deck need in the road under it. */
const PIER_MEDIAN = 1.6;

/** Bounding box of a piece's centre line, padded. */
function geoBox(g: SegGeo, pad: number): [number, number, number, number] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < g.pts.length; i += 2) { x0 = Math.min(x0, g.pts[i]); x1 = Math.max(x1, g.pts[i]); z0 = Math.min(z0, g.pts[i + 1]); z1 = Math.max(z1, g.pts[i + 1]); }
  return [x0 - pad, z0 - pad, x1 + pad, z1 + pad];
}

/** Steepest a ground junction's surface may tilt; how far (±m) a ground road's long profile is smoothed. */
const MAX_TILT = 0.05, SMOOTH = 12;

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
  /** traffic signal heads per junction (2D symbols): position, facing, and whether it shows green */
  readonly signals = new Map<string, SignalHead[]>();
  /** merge joints (a flyover ramp landing in the middle of a road that carries on): the ramp's room at the joint */
  private mergeW = new Map<string, number>();
  /** footpath cuts for slip lanes: per road piece, and the pieces each junction's slips cut */
  private cutsBySeg = new Map<string, { node: string; side: 'L' | 'R'; s0: number; s1: number }[]>();
  private slipSegs = new Map<string, Set<string>>();
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
    // boxes of decks (elevated pieces) added / changed / removed: the ground roads under them get new room
    const decks: [number, number, number, number][] = [];
    const deckBox = (id: string) => { const g = this.geos.get(id); if (g?.s.elevated) decks.push(geoBox(g, 15)); };
    for (const id of ch.removeSegs ?? []) deckBox(id);
    for (const s of ch.segs ?? []) deckBox(s.id);
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
      deckBox(s.id);
    }
    for (const id of ch.removeNodes ?? []) {
      if (this.nodeSegs.get(id)?.size) continue; // still in use
      this.nodes.delete(id); this.nodeSegs.delete(id); this.ends.delete(id); this.kinds.delete(id); this.junctions.delete(id); this.signals.delete(id);
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
    // 2a. ground roads under a deck that changed get their room re-made
    if (decks.length) for (const g of this.geos.values()) {
      if (g.s.elevated || g.s.sunk || dirtySegs.has(g.s.id)) continue;
      const b = geoBox(g, 0);
      if (decks.some((d) => d[0] <= b[2] && d[2] >= b[0] && d[1] <= b[3] && d[3] >= b[1])) dirtySegs.add(g.s.id);
    }
    // 2b. slip lanes: the arm pieces they cut (and used to cut) are rebuilt too
    for (const n of dirtyNodes) for (const sid of this.layoutSlips(n)) if (this.geos.has(sid)) dirtySegs.add(sid);
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
    const k = pts.length - 2;
    return { s, t: s.t, pts, cum, len, nrm, trimA: 0, trimB: 0, rawA: 0, rawB: 0, n0: [nrm[0], nrm[1], nrm[k], nrm[k + 1]] };
  }

  private nodeLifted = (n: MNode) => n.lift > 0.25;
  private nodeSunk = (n: MNode) => n.lift < -0.25;
  private nodeOff = (n: MNode) => Math.abs(n.lift) > 0.25 && !n.graded;
  private nodeZc = (n: MNode) => this.T(n.x, n.z) + n.lift;
  private nodeZ = (n: MNode, x: number, z: number) => (this.nodeOff(n) ? this.nodeZc(n) : this.groundPlane(n)(x, z)) + LIFT;

  /**
   * The ground-level surface of a junction: one plane through the terrain at the node, tilted with the slope there
   * but never more than MAX_TILT (a junction is graded, not draped over every bump).
   */
  groundPlane(n: MNode): (x: number, z: number) => number {
    const T = this.T, h = T(n.x, n.z) + (n.graded ? n.lift : 0), d = 6;
    let gx = (T(n.x + d, n.z) - T(n.x - d, n.z)) / (2 * d), gz = (T(n.x, n.z + d) - T(n.x, n.z - d)) / (2 * d);
    const m = Math.hypot(gx, gz);
    if (m > MAX_TILT) { gx *= MAX_TILT / m; gz *= MAX_TILT / m; }
    return (x, z) => h + (x - n.x) * gx + (z - n.z) * gz;
  }

  /**
   * Height of a ground-level road: level across its width, following the terrain along it (smoothed over
   * ±SMOOTH m), and meeting the node surface exactly at each end — a junction's plane (tilted across the road
   * there too), or the terrain at a through / shape node.
   */
  private groundProfile(g: SegGeo): (s: number, x: number, z: number) => number {
    const T = this.T, m = g.cum.length;
    const raw = new Float32Array(m);
    for (let i = 0; i < m; i++) raw[i] = T(g.pts[i * 2], g.pts[i * 2 + 1]);
    const sm = new Float32Array(m);
    for (let i = 0, lo = 0, hi = 0, sum = 0; i < m; i++) {
      while (hi < m && g.cum[hi] <= g.cum[i] + SMOOTH) sum += raw[hi++];
      while (g.cum[lo] < g.cum[i] - SMOOTH) sum -= raw[lo++];
      sm[i] = sum / (hi - lo);
    }
    const idx = (s: number) => {
      let lo = 0, hi = m - 1;
      while (hi - lo > 1) { const k = (lo + hi) >> 1; if (g.cum[k] <= s) lo = k; else hi = k; }
      return [lo, Math.max(0, Math.min(1, (s - g.cum[lo]) / Math.max(1e-6, g.cum[hi] - g.cum[lo])))] as const;
    };
    const smAt = (s: number) => { const [i, t] = idx(s); return sm[i] + (sm[Math.min(m - 1, i + 1)] - sm[i]) * t; };
    const cAt = (s: number): V2 => { const [i, t] = idx(s); const j = Math.min(m - 1, i + 1); return [g.pts[i * 2] + (g.pts[j * 2] - g.pts[i * 2]) * t, g.pts[i * 2 + 1] + (g.pts[j * 2 + 1] - g.pts[i * 2 + 1]) * t]; };
    const s0 = g.trimA, s1 = g.len - g.trimB, B = Math.max(0.5, Math.min(20, (s1 - s0) * 0.5));
    const pin = (id: string, s: number) => {
      const n = this.nodes.get(id)!, kind = this.kinds.get(id);
      if (kind === 'end') return null;
      const c = cAt(s);
      if (kind === 'junction' || kind === 'roundabout') { const P = this.groundPlane(n); return { s, d: P(c[0], c[1]) - smAt(s), P, c }; }
      return { s, d: T(n.x, n.z) - smAt(s), P: null, c };
    };
    const A = pin(g.s.a, s0), Bp = pin(g.s.b, s1);
    return (s, x, z) => {
      let h = smAt(s);
      for (const [p, w] of [[A, A ? 1 - smooth01((s - s0) / B) : 0], [Bp, Bp ? 1 - smooth01((s1 - s) / B) : 0]] as const) {
        if (!p || w <= 0) continue;
        h += p.d * w;
        // across the road: the junction plane's tilt, fading to level away from the junction
        if (p.P) { const c = cAt(s); h += (p.P(x, z) - p.P(c[0], c[1])) * w; }
      }
      return h;
    };
  }

  private computeEnds(id: string) {
    const node = this.nodes.get(id);
    const E: End[] = [];
    if (!node) { this.ends.delete(id); return; }
    for (const sid of this.nodeSegs.get(id) ?? []) {
      const g = this.geos.get(sid)!;
      for (const atA of [true, false]) {
        if ((atA ? g.s.a : g.s.b) !== id) continue;
        // undo a mitre / blend from an earlier pass at this node
        const k = atA ? 0 : g.pts.length - 2;
        g.nrm[k] = g.n0[atA ? 0 : 2]; g.nrm[k + 1] = g.n0[atA ? 1 : 3];
        if (atA) g.blendA = undefined; else g.blendB = undefined;
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
    this.mergeW.delete(id);
    // a flyover ramp landing in the middle of a road that carries on: no junction — the ramp ends in the road's
    // widened median and the road ahead takes its lanes (the merge taper)
    if (E.length === 3 && !node.signals && !this.nodeOff(node)) {
      const ramp = E.find((e) => e.g.s.elevated);
      const gr = E.filter((e) => e !== ramp && !e.g.s.elevated && !e.g.s.sunk);
      if (ramp && gr.length === 2) {
        const [p, q] = gr;
        const through = p.ux * q.ux + p.uz * q.uz < -THROUGH_COS;
        const up = ramp.ux * p.ux + ramp.uz * p.uz > 0.9 ? p : ramp.ux * q.ux + ramp.uz * q.uz > 0.9 ? q : null;
        if (through && up) {
          this.kinds.set(id, 'merge');
          mitre(p, q);
          if (p.g.t.id !== q.g.t.id) for (const [e, f] of [[p, q], [q, p]] as [End, End][]) { const b = orient(f.g.t, e.atA === f.atA); if (e.atA) e.g.blendA = b; else e.g.blendB = b; }
          this.mergeW.set(id, ramp.g.t.hwL + ramp.g.t.hwR + 1);
          setRaw(); return;
        }
      }
    }
    if (E.length === 2 && E[0].g !== E[1].g && !node.signals && E[0].ux * E[1].ux + E[0].uz * E[1].uz < -THROUGH_COS) {
      // the road carries on: no junction surface — a mitred joint, and a taper where the cross-sections differ
      const same = E[0].g.t.id === E[1].g.t.id;
      this.kinds.set(id, same ? 'seamless' : 'transition');
      mitre(E[0], E[1]);
      if (!same) for (const [e, f] of [[E[0], E[1]], [E[1], E[0]]] as [End, End][]) {
        const b = orient(f.g.t, e.atA === f.atA);
        if (e.atA) e.g.blendA = b; else e.g.blendB = b;
      }
      setRaw(); return;
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
    const G = g.s.grade;
    if (G) {
      // fixed profile, straight grades between stations (the piece's own length may differ a hair from the compiler's)
      const k = G[0] / Math.max(1e-6, g.len);
      return (s: number) => {
        const u = s * k;
        let i = 3;
        while (i < G.length - 2 && G[i] < u) i += 2;
        const f = Math.max(0, Math.min(1, (u - G[i - 2]) / (G[i] - G[i - 2] || 1)));
        return G[i - 1] + (G[i + 1] - G[i - 1]) * f + LIFT;
      };
    }
    if (!g.s.elevated && !g.s.sunk) { const P = this.groundProfile(g); return (s: number, x: number, z: number) => P(s, x, z) + LIFT; }
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
    const prof = profileOf(g, this.deckRoom(g));
    const offs = profileOffsets(prof);
    // parts that only exist in a neighbour's taper and stay (nearly) zero-width over this piece draw nothing
    const s0w = S.s[0], s1w = S.s[S.s.length - 1];
    const empty = (k: number) => !(prof.deck && prof.deck.k === k) && prof.parts[k].w < 0.01 && (prof.La <= s0w || prof.parts[k].wa < 0.01) && (prof.len - prof.Lb >= s1w || prof.parts[k].wb < 0.01);
    // where a ramp stands in the median: nothing of the road under it is drawn there
    const rampRanges = (): [number, number][] => {
      const D = prof.deck;
      if (!D) return [];
      const out: [number, number][] = [];
      let start = -1;
      for (let s = s0w; s <= s1w + 1e-6; s += 1) {
        const inGap = D.gap(Math.min(s, s1w)) > 0.3;
        if (inGap && start < 0) start = s;
        if ((!inGap || s + 1 > s1w + 1e-6) && start >= 0) { out.push([start, inGap ? s1w : s]); start = -1; }
      }
      return out;
    };
    // one asphalt strip per run of adjacent same-coloured flat parts (not one per lane)
    const roadCol = t.surface === 'dirt' ? COL.dirt : t.major ? COL.asphaltMajor : COL.asphalt;
    const flatCol = (k: PartKind) => (k === 'bus' ? COL.bus : k === 'cycle' ? COL.cycle : k === 'parking' ? COL.parking : roadCol);
    let run: { o: [Off, Off]; col: [number, number, number] } | null = null;
    const flush = () => { if (run) sweep(asphalt, S, run.o[0], run.o[1], z, run.col); run = null; };
    const nParts = prof.parts.length;
    // footpath gaps where a junction's slip lane leaves or joins this road (on that side)
    const cuts = this.slipCuts(g);
    const vergeSide = (k: number): 'L' | 'R' | null => {
      const v = (j: number) => prof.parts[j].kind === 'sidewalk' || prof.parts[j].kind === 'planter' || empty(j);
      if (prof.parts.slice(0, k + 1).every((_, j) => v(j))) return 'L';
      if (prof.parts.slice(k).every((_, j) => v(k + j))) return 'R';
      return null;
    };
    const pieces = (k: number): Sub[] => {
      const side = vergeSide(k);
      const cs: { s0: number; s1: number }[] = cuts.filter((c) => c.side === side);
      if (prof.deck && prof.deck.k === k) for (const [a, b] of rampRanges()) cs.push({ s0: a, s1: b });
      else if (!side) return [S];
      if (!cs.length) return [S];
      let ranges: [number, number][] = [[S.s[0], S.s[S.s.length - 1]]];
      for (const c of cs) ranges = ranges.flatMap(([a, b]) => (c.s1 <= a || c.s0 >= b ? [[a, b]] : [[a, c.s0], [c.s1, b]]) as [number, number][]).filter(([a, b]) => b - a > 0.3);
      return ranges.map(([a, b]) => cutSub(S, a, b).S);
    };
    const zOf = (Sx: Sub) => (i: number, x: number, zz: number) => zfn(Sx.s[i], x, zz);
    prof.parts.forEach((p, k) => {
      if (empty(k)) return;
      const [o0, o1] = offs[k];
      if (p.kind === 'lane' || p.kind === 'shoulder' || p.kind === 'bus' || p.kind === 'cycle' || p.kind === 'parking') {
        const col = flatCol(p.kind);
        if (run && run.col === col) run.o[1] = o1;
        else { flush(); run = { o: [o0, o1], col }; }
        return;
      }
      flush();
      const isLeftWalk = k === 0 || prof.parts.slice(0, k).every((_, j) => empty(j));
      const isRightWalk = k === nParts - 1 || prof.parts.slice(k + 1).every((_, j) => empty(k + 1 + j));
      for (const Sx of pieces(k)) {
        const zx = zOf(Sx);
        const top = (i: number, x: number, zz: number) => zx(i, x, zz) + KERB;
        sweep(paving, Sx, o0, o1, top, p.kind === 'median' ? COL.median : p.kind === 'planter' ? COL.island : COL.sidewalk);
        // kerb faces: towards the carriageway on both sides of a median; inner face of a footpath
        if (!isLeftWalk) wallAlong(paving, Sx, o0, (i, x, zz) => zx(i, x, zz) - 0.05, top, true, COL.kerb);
        if (!isRightWalk) wallAlong(paving, Sx, o1, (i, x, zz) => zx(i, x, zz) - 0.05, top, false, COL.kerb);
        if (isLeftWalk) wallAlong(paving, Sx, o0, (i, x, zz) => zx(i, x, zz) - 0.4, top, true, COL.kerb);
        if (isRightWalk) wallAlong(paving, Sx, o1, (i, x, zz) => zx(i, x, zz) - 0.4, top, false, COL.kerb);
      }
    });
    flush();
    // no lane changing on the last 30 m before a signalised junction or one on a main road (IRC:35 solid lane lines)
    const solidAt = (id: string) => { const n = this.nodes.get(id); return this.kinds.get(id) === 'junction' && (this.ends.get(id)?.length ?? 0) >= 3 && (n?.signals || t.major) ? 30 : 0; };
    segmentMarkings(markings, g, S, z, prof, offs, [solidAt(g.s.a), solidAt(g.s.b)]);
    if (g.s.elevated) structure(concrete, g, S, z, t, this.T);
    else if (g.s.sunk) underground(concrete, S, z, t, this.T);
    const hw = Math.max(t.hwL, t.hwR) + (prof.deck ? prof.deck.max / 2 : 0);
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < S.pts.length; i += 2) {
      x0 = Math.min(x0, S.pts[i]); x1 = Math.max(x1, S.pts[i]); z0 = Math.min(z0, S.pts[i + 1]); z1 = Math.max(z1, S.pts[i + 1]);
    }
    this.items.set(key, {
      key, layers: { asphalt: pack(asphalt), paving: pack(paving), markings: pack(markings), concrete: pack(concrete) },
      x0: x0 - hw, z0: z0 - hw, x1: x1 + hw, z1: z1 + hw,
      stamps: g.s.grade
        ? [{ line: new Float32Array(S.pts), hw, carve: true, code: g.s.code, z: Float32Array.from({ length: S.pts.length / 2 }, (_, i) => z(i, S.pts[i * 2], S.pts[i * 2 + 1]) - LIFT) }]
        : g.s.sunk && !g.s.elevated ? trenchStamps(S, z, hw, g.s.code, this.T)
        : g.s.elevated ? [{ line: new Float32Array(S.pts), hw, carve: false, code: g.s.code }]
        : [{ line: new Float32Array(S.pts), hw, carve: true, code: g.s.code, z: Float32Array.from({ length: S.pts.length / 2 }, (_, i) => z(i, S.pts[i * 2], S.pts[i * 2 + 1]) - LIFT) }],
    });
  }

  private buildNode(id: string) {
    const key = 'n:' + id;
    const node = this.nodes.get(id)!;
    const E = this.ends.get(id) ?? [];
    const kind = this.kinds.get(id);
    this.junctions.delete(id);
    if (kind !== 'junction' && kind !== 'roundabout') { this.items.delete(key); this.signals.delete(id); return; }
    const asphalt = new GeomBuilder(), paving = new GeomBuilder(), markings = new GeomBuilder(), concrete = new GeomBuilder();
    const zf = (x: number, z: number) => this.nodeZ(node, x, z);
    let ring: V2[];
    let island: Float32Array | null = null;
    const extra: V2[][] = []; // slip lane outlines (bounds, terrain, picking)
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
      const slips = this.slipsAt(id);
      const slipCorner = new Set(slips.map((sl) => E.indexOf(sl.eA)));
      const corners: { curb: V2[]; wa: number; wb: number; slip: boolean }[] = [];
      for (let i = 0; i < n; i++) {
        const a = F[i], b = F[(i + 1) % n];
        poly.push(a.CL, a.CR);
        const curb = corner(a.CR, [-a.fr.ux, -a.fr.uz], b.CL, [b.fr.ux, b.fr.uz]);
        for (let k = 1; k < curb.length - 1; k++) poly.push(curb[k]);
        corners.push({ curb, wa: Math.max(0, a.e.hwR - a.e.cwR), wb: Math.max(0, b.e.hwL - b.e.cwL), slip: slipCorner.has(i) });
      }
      const bad = selfIntersects(poly);
      if (bad) poly = convexHull(poly);
      // raised footpath corners: the outer edge is an offset of the kerb curve, pushed away from the junction,
      // so the two edges can never cross (skipped where the junction outline had to be simplified)
      if (!bad) for (const c of corners) {
        if (c.slip || Math.max(c.wa, c.wb) < 0.1 || c.curb.length < 2) continue; // a slip lane's island takes this corner
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
      const paths = new Map<End, ArmPath>();
      const pathOf = (e: End) => { let a = paths.get(e); if (!a) { a = this.armPath(e, 40); paths.set(e, a); } return a; };
      const armZ = (e: End) => pathOf(e).z;
      const sig = junctionMarkings(markings, paving, concrete, node, F, zf, armZ, poly, (e) => pathOf(e).length);
      if (sig.length) this.signals.set(id, sig); else this.signals.delete(id);
      for (const sl of slips) {
        const out = slipLane(asphalt, paving, markings, sl, sl.curb, zf);
        if (out) extra.push(out);
      }
    }
    if (kind !== 'junction') this.signals.delete(id);
    if (kind === 'roundabout') this.junctions.set(id, { ring, hull: false });
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of [ring, ...extra].flat()) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const code = this.nodeCode(id);
    const carve = !this.nodeLifted(node);
    const covered = this.nodeSunk(node) && -node.lift >= COVER;
    const dz = this.nodeSunk(node) ? node.lift : undefined;
    // a junction in a covered tunnel leaves the ground (and what stands on it) alone
    const P = this.nodeOff(node) ? undefined : this.groundPlane(node);
    const stamps: Stamp[] = covered ? [] : [{ ring: new Float32Array(ring.flat()), carve, code, dz, plane: P }];
    if (island && !covered) stamps.push({ ring: island, carve, code, dz, plane: P });
    for (const o of extra) stamps.push({ ring: new Float32Array(o.flat()), carve, code, plane: P });
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

  /** An arm followed outwards from its junction through shape / transition nodes, up to `need` metres. */
  private chain(e: End, need: number): Chain {
    const out: Chain = [];
    let g = e.g, atA = e.atA, start = e.trim, along = 0;
    for (let k = 0; k < 12; k++) {
      const far = atA ? g.s.b : g.s.a, farTrim = atA ? g.trimB : g.trimA;
      const L = Math.max(0, g.len - start - farTrim);
      out.push({ g, atA, a0: along, s0: start, L });
      along += L;
      if (along >= need) break;
      const kind = this.kinds.get(far);
      if (kind !== 'seamless' && kind !== 'transition') break;
      const f = this.ends.get(far)?.find((x) => x.g !== g);
      if (!f) break;
      g = f.g; atA = f.atA; start = 0;
    }
    return out;
  }

  /** Frame / height `along` metres out along an arm (across its pieces). */
  armPath(e: End, need = 80): ArmPath {
    const ch = this.chain(e, need);
    const zs = new Map<SegGeo, (s: number, x: number, z: number) => number>();
    const pick = (along: number) => {
      let p = ch[0];
      for (const q of ch) if (along >= q.a0) p = q;
      const local = along - p.a0;
      return { p, s: p.atA ? p.s0 + local : p.g.len - p.s0 - local };
    };
    return {
      length: ch.reduce((a, q) => a + q.L, 0),
      frame: (along) => { const { p, s } = pick(along); return frameAt(p.g, Math.max(0, Math.min(p.g.len, s)), p.atA); },
      z: (along, x, z) => {
        const { p, s } = pick(along);
        let f = zs.get(p.g);
        if (!f) { f = this.segZ(p.g); zs.set(p.g, f); }
        return f(s, x, z);
      },
    };
  }

  /**
   * Room a ground road makes for flyovers over it: every elevated piece that runs along it inside its footprint
   * (not one that just carries on past its end) asks, at each point, for a gap the ramp's width (+ barriers, + its
   * offset) where the ramp is low, or a pier median where the deck is high; at a merge joint the road ahead keeps the
   * ramp's room at the joint. Each request tapers off at 1 : 10 per side.
   */
  private deckRoom(g: SegGeo): DeckRoom | null {
    if (g.s.elevated || g.s.sunk) return null;
    const hw = Math.max(g.t.hwL, g.t.hwR);
    if (hw < 3) return null;
    const box = geoBox(g, hw + 10);
    const req: { s: number; gap: number; pier: number }[] = [];
    const n = g.cum.length;
    for (const e of this.geos.values()) {
      if (!e.s.elevated || e === g) continue;
      const eb = geoBox(e, 0);
      if (eb[0] > box[2] || eb[2] < box[0] || eb[1] > box[3] || eb[3] < box[1]) continue;
      const zf = this.segZ(e), w = e.t.hwL + e.t.hwR;
      for (let i = 0; i < e.cum.length; i++) {
        const qx = e.pts[i * 2], qz = e.pts[i * 2 + 1];
        // nearest point strictly inside g (not clamped to an end: that's a road carrying on, not one alongside)
        let best = Infinity, bs = 0, boff = 0, bk = -1;
        for (let k = 0; k + 1 < n; k++) {
          const ax = g.pts[k * 2], az = g.pts[k * 2 + 1], dx = g.pts[k * 2 + 2] - ax, dz = g.pts[k * 2 + 3] - az;
          const L2 = dx * dx + dz * dz || 1, t = ((qx - ax) * dx + (qz - az) * dz) / L2;
          if (t < 0 || t > 1) continue;
          const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(qx - px, qz - pz);
          if (d < best) { best = d; bk = k; bs = g.cum[k] + (g.cum[k + 1] - g.cum[k]) * t; boff = ((qx - px) * g.nrm[k * 2] + (qz - pz) * g.nrm[k * 2 + 1]); }
        }
        if (bk < 0 || best > hw - 1 || bs < 1 || bs > g.len - 1) continue;
        // running along it
        const j = Math.min(e.cum.length - 1, i + 1), h = Math.max(0, i - 1);
        const ex = e.pts[j * 2] - e.pts[h * 2], ez = e.pts[j * 2 + 1] - e.pts[h * 2 + 1], el = Math.hypot(ex, ez) || 1;
        const gx = g.pts[bk * 2 + 2] - g.pts[bk * 2], gz = g.pts[bk * 2 + 3] - g.pts[bk * 2 + 1], gl = Math.hypot(gx, gz) || 1;
        if (Math.abs((ex * gx + ez * gz) / (el * gl)) < 0.9) continue;
        const clear = zf(e.cum[i], qx, qz) - LIFT - this.T(qx, qz);
        const off = Math.abs(boff);
        if (clear < DECK_CLEAR) req.push({ s: bs, gap: w + 1 + 2 * off, pier: 0 });
        else req.push({ s: bs, gap: 0, pier: PIER_MEDIAN + 2 * off });
      }
    }
    // the road ahead of a merge joint keeps the ramp's room there, tapering off
    for (const [nid, atA] of [[g.s.a, true], [g.s.b, false]] as [string, boolean][]) {
      const mw = this.mergeW.get(nid);
      if (mw && !req.some((r) => (atA ? r.s < 8 : r.s > g.len - 8))) req.push({ s: atA ? 0 : g.len, gap: mw, pier: 0 });
    }
    if (!req.length) return null;
    // tapered envelopes on a 2 m grid, less what the road's own median already gives
    const base = g.t.parts.find((p) => p.kind === 'median')?.width ?? 0;
    const step = 2, m = Math.max(2, Math.ceil(g.len / step) + 1);
    const gapA = new Float32Array(m), pierA = new Float32Array(m);
    for (let k = 0; k < m; k++) {
      const s = Math.min(g.len, k * step);
      let gp = 0, pr = 0;
      for (const r of req) { const fall = Math.abs(s - r.s) / (TAPER / 2); gp = Math.max(gp, r.gap - fall); pr = Math.max(pr, r.pier - fall); }
      gapA[k] = Math.max(0, gp); pierA[k] = Math.max(0, pr);
    }
    const at = (A: Float32Array) => (s: number) => { const u = Math.max(0, Math.min(m - 1, s / step)), k = Math.min(m - 2, Math.floor(u)), f = u - k; return A[k] + (A[k + 1] - A[k]) * f; };
    // fade to nothing before ordinary junctions (their surface is drawn at the road's own width)
    const fadeAt = (id: string) => { const k = this.kinds.get(id); return k === 'junction' || k === 'roundabout'; };
    const fa = fadeAt(g.s.a), fb = fadeAt(g.s.b);
    const fade = (s: number) => (fa ? smooth01((s - g.trimA) / 8) : 1) * (fb ? smooth01((g.len - g.trimB - s) / 8) : 1);
    const gapF0 = at(gapA), pierF0 = at(pierA);
    const gapF = (s: number) => gapF0(s) * fade(s), pierF = (s: number) => pierF0(s) * fade(s);
    const e = (s: number) => Math.max(0, Math.max(gapF(s), pierF(s)) - base);
    let max = 0;
    for (let k = 0; k < m; k++) max = Math.max(max, Math.max(gapA[k], pierA[k]) - base);
    return max > 0.05 ? { e, gap: (s: number) => (gapF(s) > pierF(s) ? gapF(s) : 0), max } : null;
  }

  /** Slip lanes laid out at a junction (arms found and spaced; ones that don't fit are skipped). */
  private slipsAt(id: string): SlipG[] {
    const node = this.nodes.get(id), E = this.ends.get(id);
    if (!node?.slips?.length || !E || E.length < 3 || this.kinds.get(id) !== 'junction' || this.nodeOff(node)) return [];
    const out: SlipG[] = [];
    for (const sp of node.slips) {
      const i = E.findIndex((e) => e.g.s.owner === sp.from), j = E.findIndex((e) => e.g.s.owner === sp.to);
      if (i < 0 || j < 0 || j !== (i + 1) % E.length) continue;
      const eA = E[i], eB = E[j];
      if (eA.g.s.elevated || eB.g.s.elevated || eA.g.s.sunk || eB.g.s.sunk) continue;
      const w = sp.w ?? 5, r = sp.r ?? 20;
      const want = Math.max(8, 0.9 * r);
      const pA = this.armPath(eA, 2 * want + SLIP_TAPER + 2), pB = this.armPath(eB, 2 * want + SLIP_TAPER + 2);
      // the kerb corner the slip lane goes round (as the junction outline draws it)
      const fa = frameAt(eA.g, eA.atA ? eA.trim : eA.g.len - eA.trim, eA.atA), fb = frameAt(eB.g, eB.atA ? eB.trim : eB.g.len - eB.trim, eB.atA);
      const curb = corner([fa.x - fa.lx * eA.cwR, fa.z - fa.lz * eA.cwR], [-fa.ux, -fa.uz], [fb.x + fb.lx * eB.cwL, fb.z + fb.lz * eB.cwL], [fb.ux, fb.uz]);
      // set-back past the corner: as asked, then further out / closer in until the lane and its island are clean;
      // short arms get shorter tapers
      const zf = (x: number, z: number) => this.nodeZ(node, x, z);
      let done = false;
      for (const k of [1, 1.3, 0.8, 1.6, 2]) {
        const room = Math.min(pA.length, pB.length) - 2;
        const d = Math.min(want * k, room - 4);
        if (d < 6 || done) break;
        const taper = Math.max(4, Math.min(SLIP_TAPER, room - d));
        for (const hk of [0.42, 0.3, 0.55]) {
          const cand: SlipG = { eA, eB, w, r, dA: d, dB: d, taper, pA, pB, curb, hk };
          const g = new GeomBuilder();
          if (slipLane(g, g, g, cand, curb, zf)) { out.push(cand); done = true; break; }
        }
      }
    }
    return out;
  }

  /** Lay out a junction's slip lanes and record which road pieces lose their outer footpath where (and which did before). */
  private layoutSlips(id: string): Set<string> {
    const touched = new Set(this.slipSegs.get(id) ?? []);
    for (const sid of touched) { const l = this.cutsBySeg.get(sid)?.filter((c) => c.node !== id); if (l?.length) this.cutsBySeg.set(sid, l); else this.cutsBySeg.delete(sid); }
    const now = new Set<string>();
    for (const sl of this.slipsAt(id)) {
      for (const [e, d, outRight] of [[sl.eA, sl.dA, true], [sl.eB, sl.dB, false]] as [End, number, boolean][]) {
        const reach = d + sl.taper;
        for (const q of this.chain(e, reach)) {
          const l0 = q.a0 === 0 ? -q.s0 : 0, l1 = Math.min(q.L, reach - q.a0);
          if (l1 <= l0) continue;
          // outward-right on a piece run a → b is segment-right; run b → a it's segment-left (and the other way round)
          const side: 'L' | 'R' = outRight === q.atA ? 'R' : 'L';
          const r: [number, number] = q.atA ? [q.s0 + l0, q.s0 + l1] : [q.g.len - q.s0 - l1, q.g.len - q.s0 - l0];
          const sid = q.g.s.id;
          (this.cutsBySeg.get(sid) ?? this.cutsBySeg.set(sid, []).get(sid)!).push({ node: id, side, s0: r[0], s1: r[1] });
          now.add(sid); touched.add(sid);
        }
      }
    }
    if (now.size) this.slipSegs.set(id, now); else this.slipSegs.delete(id);
    return touched;
  }

  /** Where this segment's outer footpath gives way to a slip lane: side (segment-left / right) and arc-length range. */
  private slipCuts(g: SegGeo): { side: 'L' | 'R'; s0: number; s1: number }[] {
    return this.cutsBySeg.get(g.s.id) ?? [];
  }

  /** The slip lanes that fit and are drawn at a junction ("from|to" keys). */
  slipsBuilt(id: string): Set<string> { return new Set(this.slipsAt(id).map((s) => `${s.eA.g.s.owner}|${s.eB.g.s.owner}`)); }

  /** Corners of a junction a slip lane could take: from an arm to the next arm round (a left turn). */
  slipCandidates(id: string): { from: string; to: string; angle: number }[] {
    const E = this.ends.get(id), node = this.nodes.get(id);
    if (!E || E.length < 3 || !node || node.R || this.kinds.get(id) !== 'junction') return [];
    const out: { from: string; to: string; angle: number }[] = [];
    E.forEach((a, i) => {
      const b = E[(i + 1) % E.length];
      if (!a.g.s.owner || !b.g.s.owner || a.g.s.owner === b.g.s.owner) return;
      const ang = (Math.acos(Math.max(-1, Math.min(1, a.ux * b.ux + a.uz * b.uz))) * 180) / Math.PI;
      if (ang < 35 || ang > 150) return;
      out.push({ from: a.g.s.owner, to: b.g.s.owner, angle: ang });
    });
    return out;
  }

  /** A junction's arms (outward directions, owning sections) and its signal phase groups. */
  signalPlan(id: string): { arms: { owner?: string; ux: number; uz: number; name?: string }[]; groups: number[][] } | null {
    const node = this.nodes.get(id), E = this.ends.get(id);
    if (!node || !E || E.length < 3) return null;
    return { arms: E.map((e) => ({ owner: e.g.s.owner, ux: e.ux, uz: e.uz })), groups: phaseGroups(E.map((e) => [e.ux, e.uz] as V2), node.phases) };
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
      else if (st.ring) { const P = st.plane ?? T; stampPolygon(hf, targets, st.ring, (x, z) => P(x, z) + (st.dz ?? 0) - 0.3, region); }
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

// ===== slip lanes =====

/**
 * A free-left slip lane (IRC:SP:41): leaves arm A's kerb lane with a taper, curves round the corner at about the set
 * radius and joins arm B with a taper; a raised island fills the space between it and the junction, a footpath runs
 * along its outside, and it gives way where it rejoins traffic. Returns its outline, or null if it doesn't fit.
 */
function slipLane(asphalt: GeomBuilder, paving: GeomBuilder, markings: GeomBuilder, sl: SlipG, corner: V2[], zf: (x: number, z: number) => number): V2[] | null {
  const { eA, eB, w } = sl;
  const fr = (e: End, along: number) => (e === eA ? sl.pA : sl.pB).frame(along);
  const at = (f: Frame, o: number, a = 0): V2 => [f.x + f.lx * o + f.ux * a, f.z + f.lz * o + f.uz * a];
  const kA = -eA.cwR, kB = eB.cwL; // kerb offsets (outward-left) on A's incoming side and B's outgoing side
  const steps = 8;
  // inner edge (towards the junction) and outer edge, plus how far along (0..1) each sample is
  const inner: V2[] = [], outer: V2[] = [], u: number[] = [];
  // 1. taper off arm A: width 0 → w over `taper`, attached to the kerb
  for (let k = 0; k <= steps; k++) {
    const a = sl.dA + sl.taper * (1 - k / steps), f = fr(eA, a), ww = w * smooth01(k / steps);
    inner.push(at(f, kA)); outer.push(at(f, kA - ww));
  }
  // 2. the curve: centre line from A (just past the kerb) to B, tangents along the roads
  const fA = fr(eA, sl.dA), fB = fr(eB, sl.dB);
  const Q0 = at(fA, kA - w / 2), Q1 = at(fB, kB + w / 2);
  const chord = Math.hypot(Q1[0] - Q0[0], Q1[1] - Q0[1]), h = chord * sl.hk;
  const C = cubicPts(Q0, [Q0[0] - fA.ux * h, Q0[1] - fA.uz * h], [Q1[0] - fB.ux * h, Q1[1] - fB.uz * h], Q1, 16); // leaves along B's outward direction
  // inner side: towards A's carriageway where the lane leaves it (+left of A's outward direction), then kept
  // continuous along the curve (a normal never flips between neighbouring samples)
  let px = fA.lx, pz = fA.lz;
  for (let i = 1; i < C.length - 1; i++) {
    const a = C[i - 1], b = C[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L;
    if (nx * px + nz * pz < 0) { nx = -nx; nz = -nz; }
    px = nx; pz = nz;
    inner.push([C[i][0] + nx * w / 2, C[i][1] + nz * w / 2]); outer.push([C[i][0] - nx * w / 2, C[i][1] - nz * w / 2]);
  }
  // 3. taper onto arm B
  for (let k = 0; k <= steps; k++) {
    const a = sl.dB + sl.taper * (k / steps), f = fr(eB, a), ww = w * (1 - smooth01(k / steps));
    inner.push(at(f, kB)); outer.push(at(f, kB + ww));
  }
  const N = inner.length;
  for (let i = 0; i < N; i++) u.push(i / (N - 1));
  // the island: slip's inner edge (curve part), B's kerb back to the corner, the corner, A's kerb out again
  const iA = steps, iB = N - 1 - steps;
  const isl: V2[] = inner.slice(iA, iB + 1);
  for (let k = 0; k <= 6; k++) isl.push(at(fr(eB, sl.dB * (1 - k / 6)), kB));
  for (let k = corner.length - 2; k >= 1; k--) isl.push(corner[k]);
  for (let k = 0; k <= 6; k++) isl.push(at(fr(eA, sl.dA * (k / 6)), kA));
  if (selfIntersects(isl) || !bandClean(inner, outer)) return null;
  // heights: arm A's road at the start, arm B's at the end, blended along the lane
  const zA = sl.pA.z, zB = sl.pB.z;
  const along = (e: End, q: V2) => { const f = fr(e, 0); return Math.max(0, (q[0] - f.x) * f.ux + (q[1] - f.z) * f.uz); };
  const zAt = (q: V2, t: number) => (1 - t) * zA(along(eA, q), q[0], q[1]) + t * zB(along(eB, q), q[0], q[1]);
  const band = (gb: GeomBuilder, L: V2[], R: V2[], dz: number, rgb: [number, number, number]) => {
    const base = gb.vertexCount;
    for (let i = 0; i < L.length; i++) {
      const t = u[i];
      gb.v(L[i][0], zAt(L[i], t) + dz, L[i][1], 0, 1, 0, ...rgb, L[i][0] * 0.25, L[i][1] * 0.25);
      gb.v(R[i][0], zAt(R[i], t) + dz, R[i][1], 0, 1, 0, ...rgb, R[i][0] * 0.25, R[i][1] * 0.25);
    }
    // wind upward: compare with the first quad's orientation
    const a = L[0], b = R[0], c = L[Math.min(1, L.length - 1)];
    const up = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) > 0;
    for (let i = 0; i < L.length - 1; i++) {
      const k = base + i * 2;
      if (up) { gb.tri(k, k + 1, k + 2); gb.tri(k + 1, k + 3, k + 2); } else { gb.tri(k, k + 2, k + 1); gb.tri(k + 1, k + 2, k + 3); }
    }
  };
  band(asphalt, inner, outer, 0, COL.junction);
  // island (raised, landscaped) with its kerb
  const islZ = (x: number, z: number) => { const q: V2 = [x, z]; let best = 0, bd = Infinity; for (let i = 0; i < N; i++) { const d = Math.hypot(inner[i][0] - x, inner[i][1] - z); if (d < bd) { bd = d; best = i; } } return Math.min(zAt(q, u[best]), zf(x, z) + 0.5); };
  drapePolygon(paving, new Float32Array(isl.flat()), [], (x, z) => islZ(x, z) + KERB, COL.island, 3);
  polyWall(paving, [...isl, isl[0]], (x, z) => islZ(x, z) - 0.05, (x, z) => islZ(x, z) + KERB, COL.kerb);
  // footpath along the outside, as wide as arm A's
  const fp = Math.max(eA.hwR - eA.cwR, eB.hwL - eB.cwL);
  const walk = outer.map((q, i) => {
    const a = outer[Math.max(0, i - 1)], b = outer[Math.min(N - 1, i + 1)], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L;
    if ((q[0] - inner[i][0]) * nx + (q[1] - inner[i][1]) * nz < 0) { nx = -nx; nz = -nz; }
    return [q[0] + nx * fp, q[1] + nz * fp] as V2;
  });
  if (fp > 0.3 && bandClean(outer, walk)) {
    band(paving, outer, walk, KERB, COL.sidewalk);
    const base = outer.map((q, i) => ({ q, t: u[i] }));
    for (let i = 0; i < N - 1; i++) {
      const a = base[i], b = base[i + 1];
      paving.wall(a.q[0], a.q[1], b.q[0], b.q[1], zAt(a.q, a.t) - 0.05, zAt(b.q, b.t) - 0.05, zAt(a.q, a.t) + KERB, zAt(b.q, b.t) + KERB, COL.kerb);
    }
  }
  // markings: left-turn arrow mid-way, give-way line + triangle where it rejoins arm B
  const mid = Math.floor(N / 2), m0 = C[Math.floor(C.length / 2) - 1], m1 = C[Math.floor(C.length / 2) + 1];
  const dx = m1[0] - m0[0], dz = m1[1] - m0[1], dl = Math.hypot(dx, dz) || 1, ax = dx / dl, az = dz / dl;
  const cx = (inner[mid][0] + outer[mid][0]) / 2, cz = (inner[mid][1] + outer[mid][1]) / 2;
  const sideL = (inner[mid][0] - cx) * az - (inner[mid][1] - cz) * ax > 0 ? -1 : 1; // which way "left" is
  for (const q of arrowPolys({ L: false, S: true, R: false })) {
    const pts = q.map(([x, y]) => [cx + (-az) * x * sideL + ax * (y - 2.5), cz + ax * x * sideL + az * (y - 2.5)] as V2);
    drapePolygon(markings, new Float32Array(pts.flat()), [], (x, z) => zAt([x, z], u[mid]) + 0.03, COL.white, 50);
  }
  const gi = iB - 1, gp = inner[gi], go = outer[gi];
  const ex = go[0] - gp[0], ez = go[1] - gp[1], el = Math.hypot(ex, ez) || 1;
  const tx = -ez / el, tz = ex / el; // along the lane at the give-way line
  for (const off of [0, 0.6]) {
    for (let s = 0.2; s < el - 0.3; s += 1.0) {
      const a: V2 = [gp[0] + (ex / el) * s + tx * off, gp[1] + (ez / el) * s + tz * off], b: V2 = [a[0] + (ex / el) * 0.6, a[1] + (ez / el) * 0.6];
      drapePolygon(markings, new Float32Array([a[0] - tx * 0.15, a[1] - tz * 0.15, b[0] - tx * 0.15, b[1] - tz * 0.15, b[0] + tx * 0.15, b[1] + tz * 0.15, a[0] + tx * 0.15, a[1] + tz * 0.15]), [], (x, z) => zAt([x, z], u[gi]) + 0.03, COL.white, 50);
    }
  }
  return [...inner, ...walk.slice().reverse()];
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

function strip(gb: GeomBuilder, S: Sub, center: Off, width: number, z: (i: number, x: number, zz: number) => number, rgb: [number, number, number]) {
  sweep(gb, S, (s) => ov(center, s) + width / 2, (s) => ov(center, s) - width / 2, (i, x, zz) => z(i, x, zz) + 0.025, rgb);
}

const shift = (o: Off, d: number): Off => (typeof o === 'number' ? o + d : (s: number) => o(s) + d);

function segmentMarkings(gb: GeomBuilder, g: SegGeo, S: Sub, z: (i: number, x: number, zz: number) => number, prof: Profile, offs: [Off, Off][], solidEnds: [number, number] = [0, 0]) {
  const t = g.t;
  if (t.surface === 'dirt') return;
  const L = S.s[S.s.length - 1] - S.s[0];
  if (L < 3) return;
  const pieces = (dash: number, gap: number, center: Off, width: number, rgb: [number, number, number], solid: [number, number] = [0, 0]) => {
    // dashes in arc length, phase-locked to the segment so neighbours line up; solid near junctions
    let s0 = S.s[0], s1 = S.s[S.s.length - 1];
    const ea = Math.min(s1, g.trimA + solid[0]), eb = Math.max(s0, g.len - g.trimB - solid[1]);
    if (solid[0] > 0 && ea > s0 + 1) { const sub = cutSub(S, s0 + 0.8, ea); strip(gb, sub.S, center, width, (i, x, zz) => z(sub.map(i), x, zz), rgb); s0 = ea; }
    if (solid[1] > 0 && eb < s1 - 1 && eb > s0) { const sub = cutSub(S, eb, s1 - 0.8); strip(gb, sub.S, center, width, (i, x, zz) => z(sub.map(i), x, zz), rgb); s1 = eb; }
    for (let a = Math.ceil(s0 / (dash + gap)) * (dash + gap); a < s1 - 0.5; a += dash + gap) {
      const b = Math.min(a + dash, s1 - 0.5);
      if (b - a < 0.5) continue;
      const sub = cutSub(S, a, b);
      strip(gb, sub.S, center, width, (i, x, zz) => z(sub.map(i), x, zz), rgb);
    }
  };
  const solid = (center: Off, width: number, rgb: [number, number, number]) => {
    const sub = cutSub(S, S.s[0] + 0.8, S.s[S.s.length - 1] - 0.8);
    strip(gb, sub.S, center, width, (i, x, zz) => z(sub.map(i), x, zz), rgb);
  };
  // lanes this piece really has (a neighbour's extra lane growing in a taper gets no line of its own)
  const lanes = prof.parts.map((p, k) => ({ p, k, o: offs[k] })).filter((x) => (x.p.kind === 'lane' || x.p.kind === 'bus') && x.p.w > 0);
  for (let k = 1; k < lanes.length; k++) {
    const a = lanes[k - 1], b = lanes[k];
    const at = a.o[1];
    // separated by a median / island this piece has
    if (prof.parts.slice(a.k + 1, b.k).some((p, j) => p.w > 0.05 || (prof.deck?.k === a.k + 1 + j && prof.deck.max > 0.05))) continue;
    if (a.p.dir !== b.p.dir) {
      if (t.lanesF >= 2 || t.major) { solid(shift(at, 0.17), 0.12, COL.yellow); solid(shift(at, -0.17), 0.12, COL.yellow); }
      else pieces(3, 4, at, 0.12, COL.white);
    } else pieces(3, 5, at, 0.12, COL.white, solidEnds);
  }
  if (t.major && lanes.length) {
    solid(shift(lanes[0].o[0], -0.25), 0.14, COL.white);
    solid(shift(lanes[lanes.length - 1].o[1], 0.25), 0.14, COL.white);
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

/** A traffic signal head, for the 2D symbols. */
export interface SignalHead { x: number; z: number; ux: number; uz: number; green: boolean; ped?: boolean }

/**
 * Signal phases: groups of arms that get green together. Default: 3 arms → one each; 4 → opposite pairs (2 phases);
 * more → one each. With fewer phases than arms, the most opposite arms share a phase.
 */
export function phaseGroups(dirs: V2[], phases?: number): number[][] {
  const n = dirs.length;
  const P = Math.max(1, Math.min(n, phases ?? (n === 4 ? 2 : n)));
  const groups = dirs.map((_, i) => [i]);
  while (groups.length > P) {
    let best: [number, number] | null = null, bd = Infinity;
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      // how opposite the groups' arms are (most opposite pair first)
      let d = 0;
      for (const a of groups[i]) for (const b of groups[j]) d = Math.max(d, dirs[a][0] * dirs[b][0] + dirs[a][1] * dirs[b][1]);
      if (d < bd) { bd = d; best = [i, j]; }
    }
    const [i, j] = best!;
    groups[i] = [...groups[i], ...groups[j]].sort((x, y) => x - y);
    groups.splice(j, 1);
  }
  return groups;
}

/** Road-marking arrows (IRC:35): L / S / R combinations, drawn tip-first towards the junction. */
function arrowPolys(kinds: { L: boolean; S: boolean; R: boolean }): V2[][] {
  // local frame: x = across (left +), y = along towards the junction; base at y = 0, tip at y ≈ 5
  const out: V2[][] = [];
  const shaft = (y0: number, y1: number): V2[] => [[-0.08, y0], [0.08, y0], [0.08, y1], [-0.08, y1]];
  const head = (bx: number, by: number, dx: number, dy: number, L = 1.2, W = 0.7): V2[] => {
    const nx = -dy, ny = dx; // left of the head direction
    return [[bx + nx * W / 2, by + ny * W / 2], [bx + dx * L, by + dy * L], [bx - nx * W / 2, by - ny * W / 2]];
  };
  const turn = kinds.L || kinds.R;
  out.push(shaft(0, kinds.S ? 3.8 : 2.4));
  if (kinds.S || !turn) out.push(head(0, 3.8, 0, 1));
  for (const [on, sg] of [[kinds.L, 1], [kinds.R, -1]] as const) {
    if (!on) continue;
    // a short bend from the shaft, then the head pointing sideways
    const y = 2.1;
    out.push([[0, y - 0.08], [0, y + 0.08], [sg * 0.9, y + 0.5], [sg * 0.9, y + 0.3]].map(([x, yy]) => [x, yy] as V2));
    out.push(head(sg * 0.85, y + 0.4, sg * 1, 0.25, 1.0, 0.65));
  }
  return out;
}

/**
 * Junction markings and signals (IRC:35-2015, IRC:93): stop or give-way lines, lane arrows, zebra crossings broken at
 * medians, rounded median noses, right-turn guide lines and the keep-clear box at big signalised junctions, signal
 * poles with heads (mast arms over multi-lane approaches) and pedestrian signals. Returns the heads for 2D symbols.
 */
function junctionMarkings(gb: GeomBuilder, paving: GeomBuilder, poles: GeomBuilder, node: MNode, F: { e: End; fr: Frame }[], zf: (x: number, z: number) => number, armZ: (e: End) => (along: number, x: number, z: number) => number, poly: V2[], armLen: (e: End) => number): SignalHead[] {
  const heads: SignalHead[] = [];
  if (F.length < 3) return heads;
  const major = F.filter((f) => f.e.g.t.major).length;
  const score = (t: RoadType) => (t.major ? 10 : 0) + t.lanesF + t.lanesB + Math.max(t.hwL, t.hwR) / 10;
  const top = Math.max(...F.map((f) => score(f.e.g.t)));
  const groups = node.signals ? phaseGroups(F.map((f) => [f.e.ux, f.e.uz] as V2), node.phases) : [];
  const greenSet = new Set(groups.length ? groups[((node.phase ?? 0) % groups.length + groups.length) % groups.length] : []);
  const white = COL.white;
  // zebras by default at signals, and on main roads only where they meet at a crossroads (not every T on them)
  const zebraOn = (t: RoadType) => node.crossings ?? (node.signals || (t.major && F.length >= 4));
  F.forEach((f, ai) => {
    const t = f.e.g.t;
    if (t.surface === 'dirt') return;
    const za = armZ(f.e);
    const side = f.e.atA ? 1 : -1; // segment-left offsets → outward-left
    const offs = partOffsets(t);
    const P = (o: number, along: number): V2 => [f.fr.x + f.fr.lx * o + f.fr.ux * along, f.fr.z + f.fr.lz * o + f.fr.uz * along];
    const flat = (q: V2[], col = white, lift = 0.03) => drapePolygon(gb, new Float32Array(q.flat()), [], (x, z) => za(Math.max(0, (x - f.fr.x) * f.fr.ux + (z - f.fr.z) * f.fr.uz), x, z) + lift, col, 50);
    // incoming lanes (towards the junction), kerb side first
    const inc: { lo: number; hi: number }[] = [];
    t.parts.forEach((p, k) => {
      if (p.kind !== 'lane' && p.kind !== 'bus') return;
      const incoming = f.e.atA ? p.dir === -1 : p.dir === 1;
      if (!incoming && p.dir !== 0) return;
      const a = side * offs[k][0], b = side * offs[k][1];
      inc.push({ lo: Math.min(a, b), hi: Math.max(a, b) });
    });
    inc.sort((p, q) => Math.abs(q.lo + q.hi) - Math.abs(p.lo + p.hi)); // farthest from the centre line (kerb) first
    const lo = Math.min(...inc.map((l) => l.lo)), hi = Math.max(...inc.map((l) => l.hi));
    const zebra = zebraOn(t);
    const inset = zebra ? 4.4 : major >= 2 || node.signals ? 4.4 : 0.8;
    // control: signals, give way (a minor arm onto a clearly bigger road), or a plain dashed line
    const giveWay = !node.signals && top - score(t) >= 2;
    if (inc.length && hi > lo) {
      if (node.signals) dashedAcross(gb, f.fr, lo, hi, inset, (x, z) => za(inset, x, z), false);
      else if (giveWay) {
        dashedAcross(gb, f.fr, lo, hi, inset, (x, z) => za(inset, x, z));
        dashedAcross(gb, f.fr, lo, hi, inset + 0.6, (x, z) => za(inset, x, z));
        // give-way triangle on each incoming lane, pointing at the line
        for (const l of inc) {
          const c = (l.lo + l.hi) / 2, y0 = inset + 3, y1 = inset + 6.5, w = Math.min(0.75, (l.hi - l.lo) / 2 - 0.3);
          const A = P(c - w, y1), B = P(c + w, y1), C = P(c, y0);
          const bar = (p: V2, q: V2) => { const dx = q[0] - p[0], dz = q[1] - p[1], L = Math.hypot(dx, dz) || 1, nx = -dz / L * 0.1, nz = dx / L * 0.1; flat([[p[0] + nx, p[1] + nz], [q[0] + nx, q[1] + nz], [q[0] - nx, q[1] - nz], [p[0] - nx, p[1] - nz]]); };
          bar(A, B); bar(B, C); bar(C, A);
        }
      } else dashedAcross(gb, f.fr, lo, hi, inset, (x, z) => za(inset, x, z), !t.major);
    }
    // lane arrows on signalised / multi-lane approaches
    if (inc.length && (node.signals || inc.length >= 2) && armLen(f.e) > inset + 16) {
      const tx = -f.e.ux, tz = -f.e.uz, lx = tz, lz = -tx; // travel direction into the junction and its left
      const moves = { L: false, S: false, R: false };
      F.forEach((g2, j) => {
        if (j === ai) return;
        const ex = g2.e.ux, ez = g2.e.uz;
        const fw = ex * tx + ez * tz, lt = ex * lx + ez * lz;
        if (fw > 0.6) moves.S = true; else if (lt > 0.3) moves.L = true; else if (lt < -0.3) moves.R = true;
      });
      inc.forEach((l, k) => {
        const n = inc.length;
        let m: { L: boolean; S: boolean; R: boolean };
        if (n === 1) m = { ...moves };
        else if (k === 0) m = { L: moves.L, S: moves.S && (n === 2 || !moves.L), R: false };
        else if (k === n - 1) m = { L: false, S: moves.S && (n === 2 || !moves.R), R: moves.R };
        else m = { L: !moves.S && moves.L, S: moves.S, R: !moves.S && moves.R };
        if (!m.L && !m.S && !m.R) m.S = true;
        const c = (l.lo + l.hi) / 2, base = inset + 11;
        for (const q of arrowPolys(m)) flat(q.map(([x, y]) => P(c - x, base - y))); // arrow-left = travel-left = outward-right
      });
    }
    // zebra crossing: stripes over the carriageway only — medians stay a refuge
    if (zebra) {
      const cw = Math.max(f.e.cwL, f.e.cwR);
      const solid = t.parts.map((p, k) => ({ p, a: Math.min(side * offs[k][0], side * offs[k][1]), b: Math.max(side * offs[k][0], side * offs[k][1]) })).filter((x) => x.p.kind === 'median' || x.p.kind === 'planter');
      for (let o = -cw + 0.4; o < cw - 0.5; o += 1.0) {
        if (solid.some((m) => o + 0.5 > m.a && o < m.b)) continue;
        flat([P(o, 0.6), P(o + 0.5, 0.6), P(o + 0.5, 3.6), P(o, 3.6)]);
      }
    }
    // rounded median nose
    t.parts.forEach((p, k) => {
      if (p.kind !== 'median' || p.width < 0.6) return;
      const a = side * offs[k][0], b = side * offs[k][1], c = (a + b) / 2, r = Math.abs(a - b) / 2;
      const arc: V2[] = [];
      for (let i = 0; i <= 10; i++) { const th = (i / 10) * Math.PI; arc.push(P(c + Math.cos(th) * r, -Math.sin(th) * r)); }
      const top2 = (x: number, z: number) => zf(x, z) + KERB;
      drapePolygon(paving, new Float32Array(arc.flat()), [], top2, COL.median, 50);
      polyWall(paving, arc.slice().reverse(), (x, z) => zf(x, z) - 0.05, top2, COL.kerb);
    });
    // signal poles and heads
    if (node.signals && inc.length) {
      const green = greenSet.has(ai);
      const kerbOff = -f.e.cwR - 0.8; // on the footpath, just beyond the kerb of the incoming side (outward-right)
      const along = Math.max(0.5, inset - 1.2);
      const base = P(kerbOff, along);
      const zb = za(along, base[0], base[1]) + KERB;
      const H = 5.2;
      poles.box(base[0], base[1], zb, zb + H, 0.18, 0.18, 0, COL.pole);
      const headAt = (hp: V2, y: number) => {
        const yaw = Math.atan2(f.e.uz, f.e.ux);
        poles.box(hp[0], hp[1], y - 1.0, y, 0.3, 0.38, yaw, COL.head);
        const lamps: [number, [number, number, number]][] = [[y - 0.2, green ? COL.lampOff : COL.red], [y - 0.5, COL.lampOff], [y - 0.8, green ? COL.green : COL.lampOff]];
        for (const [ly, col] of lamps) poles.box(hp[0] + f.e.ux * 0.18, hp[1] + f.e.uz * 0.18, ly - 0.11, ly + 0.11, 0.06, 0.22, yaw, col);
        heads.push({ x: hp[0], z: hp[1], ux: f.e.ux, uz: f.e.uz, green });
      };
      if (inc.length >= 2) {
        // mast arm over the approach, head over the middle of the incoming lanes
        const mid = P((lo + hi) / 2, along);
        const dx = mid[0] - base[0], dz = mid[1] - base[1], L = Math.hypot(dx, dz);
        poles.box((base[0] + mid[0]) / 2, (base[1] + mid[1]) / 2, zb + H - 0.25, zb + H, L, 0.14, Math.atan2(dz, dx), COL.pole);
        headAt(mid, zb + H - 0.3);
        headAt(base, zb + 3.4);
      } else headAt(base, zb + 3.4);
      // pedestrian signals at both ends of the crossing (green when this arm's traffic is held)
      if (zebra) {
        const cw = Math.max(f.e.cwL, f.e.cwR);
        for (const o of [-cw - 0.6, cw + 0.6]) {
          const q = P(o, 2.1), zq = za(2.1, q[0], q[1]) + KERB;
          poles.box(q[0], q[1], zq, zq + 2.6, 0.12, 0.12, 0, COL.pole);
          const yaw = Math.atan2(f.fr.lz, f.fr.lx);
          poles.box(q[0], q[1], zq + 2.0, zq + 2.6, 0.3, 0.25, yaw, COL.head);
          heads.push({ x: q[0], z: q[1], ux: f.fr.lx, uz: f.fr.lz, green: !green, ped: true });
        }
      }
    }
  });
  // right-turn guide lines (dotted) through big signalised junctions
  if (node.signals && F.length >= 4) {
    F.forEach((f, ai) => {
      const tx = -f.e.ux, tz = -f.e.uz, lx = tz, lz = -tx;
      let tgt = -1, bestLt = -0.3;
      F.forEach((g2, j) => { if (j === ai) return; const lt = g2.e.ux * lx + g2.e.uz * lz; if (lt < bestLt && g2.e.ux * tx + g2.e.uz * tz < 0.6) { bestLt = lt; tgt = j; } });
      if (tgt < 0) return;
      // median-side incoming lane here, median-side outgoing lane there
      const laneEdge = (ff: typeof f, incoming: boolean) => {
        const tt = ff.e.g.t, sd = ff.e.atA ? 1 : -1, of = partOffsets(tt);
        let best: number | null = null;
        tt.parts.forEach((p, k) => {
          if (p.kind !== 'lane') return;
          const inc = ff.e.atA ? p.dir === -1 : p.dir === 1;
          if (inc !== incoming) return;
          const c = sd * (of[k][0] + of[k][1]) / 2;
          if (best === null || Math.abs(c) < Math.abs(best)) best = c;
        });
        return best;
      };
      const c0 = laneEdge(f, true), g2 = F[tgt], c1 = laneEdge(g2, false);
      if (c0 === null || c1 === null) return;
      const p0: V2 = [f.fr.x + f.fr.lx * c0 + f.fr.ux * 4.4, f.fr.z + f.fr.lz * c0 + f.fr.uz * 4.4];
      const p1: V2 = [g2.fr.x + g2.fr.lx * c1 + g2.fr.ux * 4.4, g2.fr.z + g2.fr.lz * c1 + g2.fr.uz * 4.4];
      const d = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) * 0.45;
      const curve = cubicPts(p0, [p0[0] + tx * d, p0[1] + tz * d], [p1[0] + g2.e.ux * d, p1[1] + g2.e.uz * d], p1, 40);
      let acc = 0;
      for (let i = 1; i < curve.length; i++) {
        const a = curve[i - 1], b = curve[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        acc += L;
        if (Math.floor(acc / 1.2) % 2 === 1 || L < 1e-3) continue;
        const nx = -(b[1] - a[1]) / L * 0.07, nz = (b[0] - a[0]) / L * 0.07;
        drapePolygon(gb, new Float32Array([a[0] + nx, a[1] + nz, b[0] + nx, b[1] + nz, b[0] - nx, b[1] - nz, a[0] - nx, a[1] - nz]), [], (x, z) => zf(x, z) + 0.03, white, 50);
      }
    });
  }
  // keep-clear box (yellow cross-hatching) on request
  if (node.box && poly.length >= 3) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const inner = (q: V2) => insidePoly(poly, q) && distToRing(poly, q) > 1.2;
    for (const dir of [1, -1]) {
      for (let k = -(x1 - x0) - (z1 - z0); k < (x1 - x0) + (z1 - z0); k += 2.5) {
        let run: V2[] = [];
        const flush = () => {
          if (run.length >= 2) {
            const a = run[0], b = run[run.length - 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / L * 0.07, nz = (b[0] - a[0]) / L * 0.07;
            drapePolygon(gb, new Float32Array([a[0] + nx, a[1] + nz, b[0] + nx, b[1] + nz, b[0] - nx, b[1] - nz, a[0] - nx, a[1] - nz]), [], (x, z) => zf(x, z) + 0.035, COL.yellow, 50);
          }
          run = [];
        };
        for (let u = 0; u <= 1; u += 0.01) {
          const x = x0 + (x1 - x0) * u, z = dir > 0 ? z0 + (x - x0) + k : z1 - (x - x0) - k;
          if (inner([x, z])) run.push([x, z]); else flush();
        }
        flush();
      }
    }
  }
  return heads;
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
