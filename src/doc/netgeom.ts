// Plane geometry for the road tools (Network Multitool style): circle fitting, curve-straight-curve connections
// between two headings, straight-curve-straight loops, offset polylines, arcs. Pure functions on [x, z] points.
// Heading convention: the left of a direction (dx, dz) is (dz, -dx) — the same as the road mesher's left normal.
export type V2 = [number, number];

const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]];
const add = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]];
const mul = (a: V2, k: number): V2 => [a[0] * k, a[1] * k];
const len = (a: V2) => Math.hypot(a[0], a[1]);
const unit = (a: V2): V2 => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
const left = (h: V2): V2 => [h[1], -h[0]];
const dot = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1];
const ang = (a: V2) => Math.atan2(a[1], a[0]);
const TAU = Math.PI * 2;
const mod = (x: number, m: number) => ((x % m) + m) % m;

/** Least-squares circle through points (Kåsa); null when they're (nearly) collinear. */
export function fitCircle(P: V2[]): { c: V2; R: number } | null {
  const n = P.length;
  if (n < 3) return null;
  let mx = 0, mz = 0;
  for (const p of P) { mx += p[0]; mz += p[1]; }
  mx /= n; mz /= n;
  let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of P) {
    const u = p[0] - mx, v = p[1] - mz;
    suu += u * u; svv += v * v; suv += u * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u;
  }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9) return null;
  const a = (suuu + suvv) / 2, b = (svvv + svuu) / 2;
  const uc = (a * svv - b * suv) / det, vc = (b * suu - a * suv) / det;
  const R = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  if (!Number.isFinite(R) || R > 1e5) return null;
  return { c: [mx + uc, mz + vc], R };
}

/** Points along an arc of a circle from angle a0, turning `sweep` radians (signed, atan2 sense). */
export function arcPts(c: V2, R: number, a0: number, sweep: number, step = 2): V2[] {
  const n = Math.max(2, Math.ceil((Math.abs(sweep) * R) / step));
  const out: V2[] = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (sweep * i) / n; out.push([c[0] + Math.cos(a) * R, c[1] + Math.sin(a) * R]); }
  return out;
}

export interface CSC {
  /** turn directions: +1 = left, −1 = right, at the start circle and the end circle */
  s0: number; s1: number;
  c0: V2; c1: V2; t0: V2; t1: V2;
  /** turned angles (radians, ≥ 0) on each circle */
  a0: number; a1: number;
  pts: V2[]; length: number;
}

/**
 * Curve – straight – curve connections from p0 heading h0 to p1 heading h1 with radii r0, r1 (Dubins-like, two
 * radii): every turn combination that exists, shortest first.
 */
export function cscPaths(p0: V2, h0: V2, r0: number, p1: V2, h1: V2, r1: number): CSC[] {
  h0 = unit(h0); h1 = unit(h1);
  const out: CSC[] = [];
  for (const s0 of [1, -1]) for (const s1 of [1, -1]) {
    const c0 = add(p0, mul(left(h0), s0 * r0)), c1 = add(p1, mul(left(h1), s1 * r1));
    const D = sub(c1, c0), dl = len(D), k = s1 * r1 - s0 * r0;
    if (dl < 1e-6 || Math.abs(k) > dl) continue;
    const th = ang(D) + Math.asin(k / dl);
    const d: V2 = [Math.cos(th), Math.sin(th)];
    const t0 = sub(c0, mul(left(d), s0 * r0)), t1 = sub(c1, mul(left(d), s1 * r1));
    if (dot(sub(t1, t0), d) < -1e-6) continue;
    // heading angle falls when turning left (left normal = heading rotated −90° in atan2 terms)
    const turn = (from: V2, to: V2, s: number) => (s > 0 ? mod(ang(from) - ang(to), TAU) : mod(ang(to) - ang(from), TAU));
    const a0 = turn(h0, d, s0), a1 = turn(d, h1, s1);
    const pts = [...arcPts(c0, r0, ang(sub(p0, c0)), -s0 * a0)];
    pts.push(...arcPts(c1, r1, ang(sub(t1, c1)), -s1 * a1).slice(0));
    out.push({ s0, s1, c0, c1, t0, t1, a0, a1, pts, length: r0 * a0 + len(sub(t1, t0)) + r1 * a1 });
  }
  return out.sort((a, b) => a.length - b.length);
}

export interface Loop { c: V2; R: number; tA: V2; tB: V2; sweep: number; pts: V2[]; length: number }

/**
 * Straight – curve – straight between two lines (point + heading): a circle of radius R tangent to both, the road
 * leaving pA along hA and arriving at pB along hB. `major` picks the long way round (a loop) over the short one.
 * All solutions, the ones matching `major` first, shortest first.
 */
export function scsLoops(pA: V2, hA: V2, pB: V2, hB: V2, R: number): Loop[] {
  hA = unit(hA); hB = unit(hB);
  const out: Loop[] = [];
  for (const sA of [1, -1]) for (const sB of [1, -1]) {
    // centre on both offset lines: pA + sA·R·left(hA) + u·hA = pB + sB·R·left(hB) + v·hB
    const qA = add(pA, mul(left(hA), sA * R)), qB = add(pB, mul(left(hB), sB * R));
    const den = hA[0] * hB[1] - hA[1] * hB[0];
    if (Math.abs(den) < 1e-6) continue;
    const w = sub(qB, qA);
    const u = (w[0] * hB[1] - w[1] * hB[0]) / den;
    const c = add(qA, mul(hA, u));
    const tA = add(pA, mul(hA, u)), v = dot(sub(c, qB), hB), tB = add(pB, mul(hB, v));
    if (u < 0 || v > 0) continue; // the straights must run forwards: pA → tA, tB → pB
    // turning direction on the circle follows sA (left of hA); sB must agree for a smooth tangent
    if (sA !== sB) continue;
    const s = sA;
    const turn = s > 0 ? mod(ang(hA) - ang(hB), TAU) : mod(ang(hB) - ang(hA), TAU);
    const sweep = -s * turn;
    const arc = arcPts(c, R, ang(sub(tA, c)), sweep);
    const pts: V2[] = [pA, ...arc, pB];
    out.push({ c, R, tA, tB, sweep, pts, length: u + R * turn + -v });
  }
  return out.sort((a, b) => a.length - b.length);
}

/** Offset a polyline sideways by d (left positive); the normal at each vertex is the averaged segment normal. */
export function offsetPolyline(P: V2[], d: number): V2[] {
  const n = P.length;
  return P.map((p, i) => {
    const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
    const h = unit(sub(b, a));
    // mitre at corners: scale so the offset line stays d away from both neighbours
    let k = 1;
    if (i > 0 && i < n - 1) {
      const h0 = unit(sub(p, P[i - 1])), h1 = unit(sub(P[i + 1], p));
      const c = Math.max(0.3, dot(h0, h1) * 0.5 + 0.5);
      k = 1 / Math.sqrt(c);
    }
    return add(p, mul(left(h), d * k));
  });
}

/** Closest point on a line (through a with heading h) to q. */
export function projectOnLine(a: V2, h: V2, q: V2): V2 {
  const u = unit(h);
  return add(a, mul(u, dot(sub(q, a), u)));
}

/** Polyline length. */
export function polyLength(P: V2[]): number {
  let s = 0;
  for (let i = 1; i < P.length; i++) s += len(sub(P[i], P[i - 1]));
  return s;
}

/** Tightest turning radius along a polyline (circumradius of consecutive triples). */
export function minRadius(P: V2[]): number {
  let best = Infinity;
  for (let i = 1; i + 1 < P.length; i++) {
    const a = P[i - 1], b = P[i], c = P[i + 1];
    const ab = len(sub(b, a)), bc = len(sub(c, b)), ca = len(sub(a, c));
    const area2 = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    if (area2 < 1e-6) continue;
    best = Math.min(best, (ab * bc * ca) / (2 * area2));
  }
  return best;
}

export { unit, left, sub, add, mul, dot, len };
