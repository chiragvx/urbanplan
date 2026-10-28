// The road network model — Cities: Skylines style.
// OSM is only an input; everything visible is generated from this clean network:
//   nodes (junctions / shape points / roundabouts / ends) + segments (one cubic Bézier each) + road types.
export type V2 = [number, number];

// ---------------- Road types ----------------

export type PartKind = 'lane' | 'median' | 'sidewalk' | 'shoulder';
export interface Part { kind: PartKind; width: number; dir: 1 | -1 | 0 } // dir relative to segment a→b; 0 = shared

export interface RoadType {
  id: string;
  parts: Part[];            // left → right, looking from a to b
  oneway: boolean;
  surface: 'asphalt' | 'dirt';
  major: boolean;
  lanesF: number;
  lanesB: number;
  /** total half-widths measured from the centre line (left/right) */
  hwL: number; hwR: number;
  /** kerb (carriageway edge) offsets from the centre line (left/right, positive numbers) */
  cwL: number; cwR: number;
}

export interface RoadTypeSpec {
  lanesF: number; lanesB: number; laneW: number; median: number; sidewalkL: number; sidewalkR: number;
  shoulder: number; oneway: boolean; surface: 'asphalt' | 'dirt'; major: boolean;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function roadTypeId(s: RoadTypeSpec): string {
  return `${s.oneway ? 'o' : 't'}${s.lanesF}.${s.lanesB}w${r1(s.laneW)}m${r1(s.median)}s${r1(s.sidewalkL)}.${r1(s.sidewalkR)}h${r1(s.shoulder)}${s.surface[0]}${s.major ? 'M' : ''}`;
}

/** Build the left→right cross-section. India drives on the left, so a→b traffic uses the left half. */
export function makeRoadType(s: RoadTypeSpec): RoadType {
  const parts: Part[] = [];
  if (s.sidewalkL > 0) parts.push({ kind: 'sidewalk', width: s.sidewalkL, dir: 0 });
  if (s.shoulder > 0) parts.push({ kind: 'shoulder', width: s.shoulder, dir: 0 });
  if (s.oneway) {
    for (let i = 0; i < s.lanesF; i++) parts.push({ kind: 'lane', width: s.laneW, dir: 1 });
  } else if (s.lanesF + s.lanesB === 1) {
    parts.push({ kind: 'lane', width: s.laneW, dir: 0 }); // single shared lane (Indian gali / service lane)
  } else {
    for (let i = 0; i < s.lanesF; i++) parts.push({ kind: 'lane', width: s.laneW, dir: 1 });
    if (s.median > 0) parts.push({ kind: 'median', width: s.median, dir: 0 });
    for (let i = 0; i < s.lanesB; i++) parts.push({ kind: 'lane', width: s.laneW, dir: -1 });
  }
  if (s.shoulder > 0) parts.push({ kind: 'shoulder', width: s.shoulder, dir: 0 });
  if (s.sidewalkR > 0) parts.push({ kind: 'sidewalk', width: s.sidewalkR, dir: 0 });

  // centre line = middle of the carriageway (between the two kerbs)
  const carriage = parts.filter((p) => p.kind !== 'sidewalk').reduce((a, p) => a + p.width, 0);
  const cw = carriage / 2;
  return {
    id: roadTypeId(s), parts, oneway: s.oneway, surface: s.surface, major: s.major, lanesF: s.lanesF, lanesB: s.lanesB,
    cwL: cw, cwR: cw, hwL: cw + s.sidewalkL, hwR: cw + s.sidewalkR,
  };
}

/** Lateral offsets (left-positive) of each part: [outerLeft, outerRight]. */
export function partOffsets(t: RoadType): [number, number][] {
  const out: [number, number][] = [];
  let o = t.hwL;
  for (const p of t.parts) { out.push([o, o - p.width]); o -= p.width; }
  return out;
}

// ---------------- Network ----------------

export type NodeKind = 'junction' | 'shape' | 'end' | 'roundabout';

export interface NetNode {
  id: number;
  x: number;
  z: number;
  /** extra height above terrain (bridge/flyover decks, ramps) */
  lift: number;
  /** roundabout ring centre-line radius + lanes */
  R?: number;
  ringLanes?: number;
  signals?: boolean;
}

export type BridgeKind = 'none' | 'overpass' | 'valley';

export interface NetSegment {
  id: number;
  a: number;
  b: number;
  /** cubic Bézier control points x0,z0,x1,z1,x2,z2,x3,z3 (p0 = node a, p3 = node b) */
  p: number[];
  type: string;
  name: string;
  cls: string;
  bridge: BridgeKind;
  deck: number;
  wayIds: number[];
  /** follows an interpolated profile (bridges, ramps) instead of the terrain */
  elevated?: boolean;
  /** Development Plan road reserve (m), when known */
  reserve?: number;
  /** runs under a metro viaduct (has a pier median) */
  viaduct?: boolean;
}

export interface PathLine { pts: number[]; width: number; kind: string }

export interface Network {
  half: number;
  nodes: NetNode[];
  segments: NetSegment[];
  types: Record<string, RoadType>;
  paths: PathLine[];
}

// ---------------- Cubic Bézier helpers ----------------

export function bez(p: number[], t: number): V2 {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p[0] + b * p[2] + c * p[4] + d * p[6], a * p[1] + b * p[3] + c * p[5] + d * p[7]];
}

export function bezD(p: number[], t: number): V2 {
  const u = 1 - t;
  return [
    3 * u * u * (p[2] - p[0]) + 6 * u * t * (p[4] - p[2]) + 3 * t * t * (p[6] - p[4]),
    3 * u * u * (p[3] - p[1]) + 6 * u * t * (p[5] - p[3]) + 3 * t * t * (p[7] - p[5]),
  ];
}

/** Adaptive sampling: chords ≤ maxLen and turning ≤ maxDeg per step. Returns points + cumulative length. */
export function sampleBez(p: number[], maxLen = 2, maxDeg = 2): { pts: Float32Array; cum: Float32Array; len: number } {
  // estimate length + curvature with a fine pass
  const N = 64;
  let len = 0, turn = 0;
  let prev = bez(p, 0), prevD = bezD(p, 0);
  for (let i = 1; i <= N; i++) {
    const q = bez(p, i / N), d = bezD(p, i / N);
    len += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
    const a0 = Math.atan2(prevD[1], prevD[0]), a1 = Math.atan2(d[1], d[0]);
    let da = a1 - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    turn += Math.abs(da);
    prev = q; prevD = d;
  }
  const steps = Math.max(1, Math.ceil(len / maxLen), Math.ceil((turn * 180) / Math.PI / maxDeg));
  // arc-length-ish parametrisation via fine table
  const table: { t: number; s: number }[] = [{ t: 0, s: 0 }];
  let s = 0;
  prev = bez(p, 0);
  const M = steps * 4;
  for (let i = 1; i <= M; i++) {
    const q = bez(p, i / M);
    s += Math.hypot(q[0] - prev[0], q[1] - prev[1]);
    table.push({ t: i / M, s });
    prev = q;
  }
  const pts = new Float32Array((steps + 1) * 2), cum = new Float32Array(steps + 1);
  let k = 0;
  for (let i = 0; i <= steps; i++) {
    const target = (s * i) / steps;
    while (k < table.length - 2 && table[k + 1].s < target) k++;
    const a = table[k], b = table[k + 1];
    const t = a.t + ((b.t - a.t) * (target - a.s)) / ((b.s - a.s) || 1);
    const q = bez(p, t);
    pts[i * 2] = q[0]; pts[i * 2 + 1] = q[1];
    cum[i] = target;
  }
  return { pts, cum, len: s };
}

// ---------------- Cubic fitting (Schneider, Graphics Gems 1990) ----------------

const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: V2, k: number): V2 => [a[0] * k, a[1] * k];
const dot = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1];
const norm = (a: V2): V2 => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };

/**
 * Fit a polyline with G1-continuous cubic Béziers within `tol` metres.
 * t0/t1 are unit tangents at the ends (pointing along the curve). Returns arrays of 4 control points.
 */
export function fitCubics(pts: V2[], t0: V2, t1: V2, tol: number, depth = 0): V2[][] {
  const n = pts.length;
  if (n === 2) {
    const d = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]) / 3;
    return [[pts[0], add(pts[0], mul(t0, d)), sub(pts[1], mul(t1, d)), pts[1]]];
  }
  let u = chordParams(pts);
  let bz = generate(pts, u, t0, t1);
  let [err, split] = maxError(pts, bz, u);
  if (err < tol) return [bz];
  if (err < tol * 4) {
    for (let it = 0; it < 6; it++) {
      u = reparam(pts, u, bz);
      bz = generate(pts, u, t0, t1);
      [err, split] = maxError(pts, bz, u);
      if (err < tol) return [bz];
    }
  }
  if (depth > 12) return [bz];
  // split at the worst point with a shared tangent
  split = Math.min(Math.max(split, 1), n - 2);
  const tc = norm(sub(pts[split - 1], pts[split + 1]));
  const left = fitCubics(pts.slice(0, split + 1), t0, mul(tc, -1), tol, depth + 1);
  const right = fitCubics(pts.slice(split), mul(tc, -1), t1, tol, depth + 1);
  return [...left, ...right];
}

function chordParams(pts: V2[]): number[] {
  const u = [0];
  for (let i = 1; i < pts.length; i++) u.push(u[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const L = u[u.length - 1] || 1;
  return u.map((v) => v / L);
}

function b3(c: V2[], t: number): V2 {
  const m = 1 - t;
  return [
    m * m * m * c[0][0] + 3 * m * m * t * c[1][0] + 3 * m * t * t * c[2][0] + t * t * t * c[3][0],
    m * m * m * c[0][1] + 3 * m * m * t * c[1][1] + 3 * m * t * t * c[2][1] + t * t * t * c[3][1],
  ];
}

function generate(pts: V2[], u: number[], t0: V2, t1n: V2): V2[] {
  // t1n points along the curve at the end; Schneider uses the tangent pointing back
  const t1: V2 = mul(t1n, -1);
  const first = pts[0], last = pts[pts.length - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < pts.length; i++) {
    const t = u[i], m = 1 - t;
    const a0 = mul(t0, 3 * m * m * t), a1 = mul(t1, 3 * m * t * t);
    c00 += dot(a0, a0); c01 += dot(a0, a1); c11 += dot(a1, a1);
    const tmp = sub(pts[i], add(mul(first, m * m * m + 3 * m * m * t), mul(last, 3 * m * t * t + t * t * t)));
    x0 += dot(a0, tmp); x1 += dot(a1, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  const seg = Math.hypot(last[0] - first[0], last[1] - first[1]);
  let al = det !== 0 ? (x0 * c11 - x1 * c01) / det : 0;
  let ar = det !== 0 ? (c00 * x1 - c01 * x0) / det : 0;
  const eps = 1e-6 * seg;
  if (al < eps || ar < eps || al > seg * 2 || ar > seg * 2) { al = ar = seg / 3; }
  return [first, add(first, mul(t0, al)), add(last, mul(t1, ar)), last];
}

function maxError(pts: V2[], bz: V2[], u: number[]): [number, number] {
  let max = 0, idx = Math.floor(pts.length / 2);
  for (let i = 1; i < pts.length - 1; i++) {
    const q = b3(bz, u[i]);
    const d = Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]);
    if (d > max) { max = d; idx = i; }
  }
  return [max, idx];
}

function reparam(pts: V2[], u: number[], bz: V2[]): number[] {
  const d1 = [mul(sub(bz[1], bz[0]), 3), mul(sub(bz[2], bz[1]), 3), mul(sub(bz[3], bz[2]), 3)];
  const d2 = [mul(sub(d1[1], d1[0]), 2), mul(sub(d1[2], d1[1]), 2)];
  return u.map((t, i) => {
    const q = b3(bz, t);
    const m = 1 - t;
    const q1: V2 = add(add(mul(d1[0], m * m), mul(d1[1], 2 * m * t)), mul(d1[2], t * t));
    const q2: V2 = add(mul(d2[0], m), mul(d2[1], t));
    const diff = sub(q, pts[i]);
    const num = dot(diff, q1), den = dot(q1, q1) + dot(diff, q2);
    const nt = den === 0 ? t : t - num / den;
    return Math.min(1, Math.max(0, nt));
  });
}
