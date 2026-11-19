// Curves and the plain plane geometry the form core leans on: a free curve sampled into a polygon, a ring's area,
// whether it crosses itself, the point deepest inside a shape (where a core sits), and the small vector helpers.
// Rings here are flat x, z, … arrays without the closing point; anticlockwise means a positive shoelace area in
// (x, z), the same way round as Clipper's outlines (src/doc/ground.ts) and the engine's rings.
import type { Curve, Pt } from './types';

/** a ring's signed area (positive anticlockwise) */
export function ringArea(r: number[]): number {
  let a = 0;
  const n = r.length;
  for (let i = 0; i < n; i += 2) { const j = (i + 2) % n; a += r[i] * r[j + 1] - r[j] * r[i + 1]; }
  return a / 2;
}
export function perimeter(r: number[]): number {
  let s = 0;
  const n = r.length;
  for (let i = 0; i < n; i += 2) { const j = (i + 2) % n; s += Math.hypot(r[j] - r[i], r[j + 1] - r[i + 1]); }
  return s;
}
/** the ring turned anticlockwise, if it isn't */
export function ccw(r: number[]): number[] {
  if (ringArea(r) >= 0) return r;
  const o: number[] = [];
  for (let i = r.length - 2; i >= 0; i -= 2) o.push(r[i], r[i + 1]);
  return o;
}
/** points closer than `eps` to the one before dropped (and the closing point, if the ring repeats its first) */
export function dedupe(r: number[], eps = 1e-3): number[] {
  const o: number[] = [];
  for (let i = 0; i < r.length; i += 2) {
    const n = o.length;
    if (n && Math.hypot(r[i] - o[n - 2], r[i + 1] - o[n - 1]) < eps) continue;
    o.push(r[i], r[i + 1]);
  }
  while (o.length >= 4 && Math.hypot(o[0] - o[o.length - 2], o[1] - o[o.length - 1]) < eps) o.length -= 2;
  return o;
}

export function bbox(r: number[]): [number, number, number, number] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); z0 = Math.min(z0, r[i + 1]); z1 = Math.max(z1, r[i + 1]); }
  return [x0, z0, x1, z1];
}

// ---------------- the curve ----------------

/** A point on the centripetal Catmull-Rom segment from p1 to p2 (u 0 … 1); centripetal so it never loops or cusps
 *  however unevenly the points are spaced. */
function crPoint(p0: Pt, p1: Pt, p2: Pt, p3: Pt, u: number): Pt {
  const k = (a: Pt, b: Pt) => Math.max(1e-4, Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])));
  const t0 = 0, t1 = t0 + k(p0, p1), t2 = t1 + k(p1, p2), t3 = t2 + k(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const L = (a: Pt, b: Pt, ta: number, tb: number): Pt => [((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta), ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta)];
  const a1 = L(p0, p1, t0, t1), a2 = L(p1, p2, t1, t2), a3 = L(p2, p3, t2, t3);
  const b1 = L(a1, a2, t0, t2), b2 = L(a2, a3, t1, t3);
  return L(b1, b2, t1, t2);
}

/** The curve as a polygon (flat x, z, anticlockwise, no repeated points): smooth points passed through with a
 *  continuous tangent, sharp points kept as corners, curved stretches sampled about every `step` metres. With
 *  `round` (0 … 1, the design language's corners) each corner is eased into an arc taking up to that share of
 *  half its shorter side, so a sharp box reads softer without anyone redrawing it. */
export function sampleCurve(c: Curve, step = 1.5, round = 0): number[] {
  // the points, less any repeated one (a corner flag kept with the point it belongs to)
  const P: Pt[] = [], S: boolean[] = [];
  c.pts.forEach((p, i) => {
    if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) return;
    const q = P[P.length - 1];
    if (q && Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-3) return;
    P.push([p[0], p[1]]); S.push(c.sharp ? !!c.sharp[i] : true);
  });
  while (P.length > 1 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < 1e-3) { P.pop(); S.pop(); }
  const n = P.length;
  if (n < 3) return P.flat();
  step = Math.max(0.2, step);
  const pts: Pt[] = [], corner: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const a = P[i], b = P[(i + 1) % n], sa = S[i], sb = S[(i + 1) % n];
    pts.push(a); corner.push(sa);
    if (sa && sb) continue;
    // a corner's side of a curved stretch leaves it along the chord (a mirrored phantom point)
    const p0: Pt = sa ? [2 * a[0] - b[0], 2 * a[1] - b[1]] : P[(i - 1 + n) % n];
    const p3: Pt = sb ? [2 * b[0] - a[0], 2 * b[1] - a[1]] : P[(i + 2) % n];
    const k = Math.max(2, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let j = 1; j < k; j++) { pts.push(crPoint(p0, a, b, p3, j / k)); corner.push(false); }
  }
  let out: Pt[] = pts;
  if (round > 0) {
    out = [];
    const m = pts.length;
    for (let i = 0; i < m; i++) {
      const p = pts[i];
      if (!corner[i]) { out.push(p); continue; }
      const a = pts[(i - 1 + m) % m], b = pts[(i + 1) % m];
      const v1: Pt = [a[0] - p[0], a[1] - p[1]], v2: Pt = [b[0] - p[0], b[1] - p[1]];
      const l1 = Math.hypot(v1[0], v1[1]), l2 = Math.hypot(v2[0], v2[1]);
      const cos = (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2 || 1);
      // (nearly straight: nothing to round)
      if (cos < -0.985 || !l1 || !l2) { out.push(p); continue; }
      const d = Math.min(Math.min(1, round) * 0.5 * Math.min(l1, l2), 10);
      const e1: Pt = [p[0] + (v1[0] / l1) * d, p[1] + (v1[1] / l1) * d], e2: Pt = [p[0] + (v2[0] / l2) * d, p[1] + (v2[1] / l2) * d];
      // a quadratic arc from one tangent point to the other, the corner its control point
      const k = Math.max(2, Math.ceil((d * 1.6) / step));
      for (let j = 0; j <= k; j++) {
        const u = j / k, w0 = (1 - u) * (1 - u), w1 = 2 * u * (1 - u), w2 = u * u;
        out.push([w0 * e1[0] + w1 * p[0] + w2 * e2[0], w0 * e1[1] + w1 * p[1] + w2 * e2[1]]);
      }
    }
  }
  return ccw(dedupe(out.flat()));
}

// ---------------- checks ----------------

function segX(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) {
  const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax), d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
  const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx), d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
  return d1 * d2 < 0 && d3 * d4 < 0;
}
/** whether a ring crosses itself (edges that touch only at a shared point don't count) */
export function selfCrosses(r: number[]): boolean {
  const n = r.length / 2;
  if (n < 4) return false;
  // edges' boxes, so most pairs are skipped without the cross products
  const bx0 = new Float64Array(n), bx1 = new Float64Array(n), bz0 = new Float64Array(n), bz1 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    bx0[i] = Math.min(r[i * 2], r[j * 2]); bx1[i] = Math.max(r[i * 2], r[j * 2]);
    bz0[i] = Math.min(r[i * 2 + 1], r[j * 2 + 1]); bz1[i] = Math.max(r[i * 2 + 1], r[j * 2 + 1]);
  }
  for (let i = 0; i < n; i++) {
    const i1 = (i + 1) % n;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (bx0[j] > bx1[i] || bx1[j] < bx0[i] || bz0[j] > bz1[i] || bz1[j] < bz0[i]) continue;
      const j1 = (j + 1) % n;
      if (segX(r[i * 2], r[i * 2 + 1], r[i1 * 2], r[i1 * 2 + 1], r[j * 2], r[j * 2 + 1], r[j1 * 2], r[j1 * 2 + 1])) return true;
    }
  }
  return false;
}

/** whether a point is inside a set of rings (even-odd: holes are holes whichever way round they run) */
export function inRings(rings: number[][], x: number, z: number): boolean {
  let c = false;
  for (const r of rings) {
    const n = r.length;
    for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
      const zi = r[i + 1], zj = r[j + 1];
      if ((zi > z) !== (zj > z) && x < ((r[j] - r[i]) * (z - zi)) / (zj - zi) + r[i]) c = !c;
    }
  }
  return c;
}
/** the distance from a point to the nearest edge of a set of rings */
export function edgeDist(rings: number[][], x: number, z: number): number {
  let best = Infinity;
  for (const r of rings) {
    const n = r.length;
    for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
      const ax = r[j], az = r[j + 1], dx = r[i] - ax, dz = r[i + 1] - az, L2 = dx * dx + dz * dz || 1e-12;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
      if (d < best) best = d;
    }
  }
  return best;
}

/** The pole of inaccessibility: the point inside the rings farthest from any edge, found to `precision` metres
 *  (Mapbox's polylabel, cut down). Returns x, z and that distance; a core placed here stays central. */
export function pole(rings: number[][], precision = 0.5): [number, number, number] {
  const outer = rings[0];
  if (!outer || outer.length < 6) return [0, 0, 0];
  const [x0, z0, x1, z1] = bbox(outer);
  const w = x1 - x0, h = z1 - z0, size = Math.min(w, h);
  const sd = (x: number, z: number) => (inRings(rings, x, z) ? 1 : -1) * edgeDist(rings, x, z);
  if (size <= 0) return [x0, z0, 0];
  type Cell = { x: number; z: number; h: number; d: number; max: number };
  const cell = (x: number, z: number, hh: number): Cell => { const d = sd(x, z); return { x, z, h: hh, d, max: d + hh * Math.SQRT2 }; };
  // a max-heap on each cell's best possible distance
  const heap: Cell[] = [];
  const push = (c: Cell) => {
    heap.push(c);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heap[p].max >= heap[i].max) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = (): Cell => {
    const top = heap[0], last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heap[l].max > heap[m].max) m = l;
        if (r < heap.length && heap[r].max > heap[m].max) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  const hh = size / 2;
  for (let x = x0; x < x1; x += size) for (let z = z0; z < z1; z += size) push(cell(x + hh, z + hh, hh));
  // the centroid and the box's centre are good first guesses
  let a = 0, cx = 0, cz = 0;
  for (let i = 0, n = outer.length; i < n; i += 2) {
    const j = (i + 2) % n, f = outer[i] * outer[j + 1] - outer[j] * outer[i + 1];
    cx += (outer[i] + outer[j]) * f; cz += (outer[i + 1] + outer[j + 1]) * f; a += f * 3;
  }
  let best = a ? cell(cx / a, cz / a, 0) : cell(x0 + w / 2, z0 + h / 2, 0);
  const bc = cell(x0 + w / 2, z0 + h / 2, 0);
  if (bc.d > best.d) best = bc;
  let guard = 0;
  while (heap.length && guard++ < 4000) {
    const c = pop();
    if (c.d > best.d) best = c;
    if (c.max - best.d <= precision) continue;
    const q = c.h / 2;
    push(cell(c.x - q, c.z - q, q)); push(cell(c.x + q, c.z - q, q));
    push(cell(c.x - q, c.z + q, q)); push(cell(c.x + q, c.z + q, q));
  }
  return [best.x, best.z, best.d];
}

/** An anticlockwise ring moved out by d (in, for d < 0): each corner along its bisector, mitred no further than
 *  3 × d. It doesn't untangle what that crosses; check with selfCrosses where it matters. */
export function grownRing(r: number[], d: number): number[] {
  const n = r.length / 2, o: number[] = new Array(r.length);
  for (let i = 0; i < n; i++) {
    const p = (i - 1 + n) % n, q = (i + 1) % n;
    let ax = r[i * 2] - r[p * 2], az = r[i * 2 + 1] - r[p * 2 + 1], bx = r[q * 2] - r[i * 2], bz = r[q * 2 + 1] - r[i * 2 + 1];
    const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1;
    ax /= la; az /= la; bx /= lb; bz /= lb;
    // (the right normals point out of an anticlockwise ring)
    let nx = az + bz, nz = -ax - bx;
    const ln = Math.hypot(nx, nz);
    if (ln < 1e-6) { nx = az; nz = -ax; } else { nx /= ln; nz /= ln; }
    const k = Math.min(3, 1 / Math.max(0.33, nx * az - nz * ax));
    o[i * 2] = r[i * 2] + nx * d * k; o[i * 2 + 1] = r[i * 2 + 1] + nz * d * k;
  }
  return o;
}

/** a ring's main direction (its longer axis, from its second moments), as a unit vector */
export function axisOf(r: number[]): Pt {
  let a = 0, cx = 0, cz = 0;
  const n = r.length;
  for (let i = 0; i < n; i += 2) { cx += r[i]; cz += r[i + 1]; a++; }
  cx /= a || 1; cz /= a || 1;
  // (the boundary's second moments, densified so long edges weigh what they should)
  let sxx = 0, szz = 0, sxz = 0;
  for (let i = 0; i < n; i += 2) {
    const j = (i + 2) % n, L = Math.hypot(r[j] - r[i], r[j + 1] - r[i + 1]);
    const mx = (r[i] + r[j]) / 2 - cx, mz = (r[i + 1] + r[j + 1]) / 2 - cz;
    sxx += mx * mx * L; szz += mz * mz * L; sxz += mx * mz * L;
  }
  // (a round or square plan has no long axis: square to the plan as drawn, rather than whatever rounding picks)
  const spread = Math.hypot(sxx - szz, 2 * sxz) / (sxx + szz || 1);
  if (spread < 0.08) return [1, 0];
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  return [Math.cos(ang), Math.sin(ang)];
}
