// Formed buildings in 3D: a FormLayout (./types.ts) turned into three.js meshes. Each floor is a slab and a skin; the
// skin between two floors is lofted from one floor's outline to the next, so a taper, a twist or an S-curve reads as
// one smooth surface rather than a stack of boxes. The design language's pattern (fins, louvres, bands, a diagrid, a
// screen, a curtain wall, balcony rings) is laid procedurally along every outline by arc length, floor by floor; a
// shell stands off the floors and can rise past the roof; the roof takes its kind.
//
// Everything a building is made of goes into a handful of merged meshes (one per material) and instanced meshes for
// the many small parts (fins, mullions, diagrid members), so ten 60-floor towers stay smooth. The instanced parts list
// every third one first: a far building draws only those (InstancedMesh.count), a very far one none.
//
// The wireframe (../wire.ts) reads the same outlines through `canonical` and `roofLines`, so both views agree.
import * as THREE from 'three';
import { UNIT_COLOR } from '../../doc/site';
import type { BuildingUse, FormLayout, Pt, Roof, Skin, SkinPattern } from './types';

type Ring = number[];
type V3 = [number, number, number];

/** an X-ray floor's walls are cut this high, as a plan is */
export const CUT = 1.5;
/** a slab's thickness (m) */
const SLAB = 0.25;

// ------------------------------------------------------------------ rings (flat x, z pairs)
/** signed area: positive when the ring runs anticlockwise in (x, z) */
export function areaOf(r: Ring): number {
  let s = 0; const n = r.length;
  for (let i = 0; i < n; i += 2) { const j = (i + 2) % n; s += r[i] * r[j + 1] - r[j] * r[i + 1]; }
  return s / 2;
}
export function centreOf(r: Ring): Pt {
  let a = 0, cx = 0, cz = 0; const n = r.length;
  for (let i = 0; i < n; i += 2) { const j = (i + 2) % n, k = r[i] * r[j + 1] - r[j] * r[i + 1]; a += k; cx += (r[i] + r[j]) * k; cz += (r[i + 1] + r[j + 1]) * k; }
  if (Math.abs(a) > 1e-6) return [cx / (3 * a), cz / (3 * a)];
  let x = 0, z = 0; for (let i = 0; i < n; i += 2) { x += r[i]; z += r[i + 1]; }
  return [x / (n / 2 || 1), z / (n / 2 || 1)];
}
/** without repeated points (the last one repeating the first, too) */
function clean(r: Ring): Ring {
  const o: number[] = [];
  for (let i = 0; i + 1 < r.length; i += 2) {
    const L = o.length;
    if (L && Math.abs(o[L - 2] - r[i]) < 1e-3 && Math.abs(o[L - 1] - r[i + 1]) < 1e-3) continue;
    o.push(r[i], r[i + 1]);
  }
  while (o.length >= 4 && Math.abs(o[0] - o[o.length - 2]) < 1e-3 && Math.abs(o[1] - o[o.length - 1]) < 1e-3) o.length -= 2;
  return o;
}
const reverseRing = (r: Ring): Ring => { const o: number[] = []; for (let i = r.length - 2; i >= 0; i -= 2) o.push(r[i], r[i + 1]); return o; };
const roll = (r: Ring, k: number): Ring => (k ? [...r.slice(k * 2), ...r.slice(0, k * 2)] : r);
function inside(x: number, z: number, r: Ring): boolean {
  let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    if ((r[i + 1] > z) !== (r[j + 1] > z) && x < ((r[j] - r[i]) * (z - r[i + 1])) / (r[j + 1] - r[i + 1]) + r[i]) c = !c;
  }
  return c;
}
/** arc length to each point (and, last, the whole perimeter) */
function cumOf(r: Ring): number[] {
  const n = r.length / 2, c = [0];
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; c.push(c[i] + Math.hypot(r[j * 2] - r[i * 2], r[j * 2 + 1] - r[i * 2 + 1])); }
  return c;
}
/** the edge and the share along it at arc length s */
function edgeAt(cum: number[], s: number): [number, number] {
  const n = cum.length - 1, P = cum[n];
  s = ((s % P) + P) % P;
  let lo = 0, hi = n - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (cum[m] <= s) lo = m; else hi = m - 1; }
  const L = cum[lo + 1] - cum[lo];
  return [lo, L > 1e-9 ? (s - cum[lo]) / L : 0];
}
function pointAt(r: Ring, cum: number[], f: number): Pt {
  const [i, t] = edgeAt(cum, f * cum[cum.length - 1]), n = r.length / 2, j = (i + 1) % n;
  return [r[i * 2] + (r[j * 2] - r[i * 2]) * t, r[i * 2 + 1] + (r[j * 2 + 1] - r[i * 2 + 1]) * t];
}

/** Two rings with as many points, matched point to point: the same rings when they have as many (a blend of one plan
 *  keeps its corners matched), else both resampled at every corner of either, by share of their perimeters. */
export function pairRings(A: Ring, B: Ring): [Ring, Ring] {
  if (A.length === B.length) return [A, B];
  const ca = cumOf(A), cb = cumOf(B), PA = ca[ca.length - 1] || 1, PB = cb[cb.length - 1] || 1;
  const fs = [...ca.slice(0, -1).map((c) => c / PA), ...cb.slice(0, -1).map((c) => c / PB)].sort((a, b) => a - b);
  const u: number[] = [];
  for (const f of fs) if (!u.length || f - u[u.length - 1] > 1e-5) u.push(f);
  if (u.length > 1 && 1 - u[u.length - 1] < 1e-5) u.pop();
  return [u.flatMap((f) => pointAt(A, ca, f)), u.flatMap((f) => pointAt(B, cb, f))];
}

/** each edge's normal toward the air (outlines anticlockwise, holes clockwise: always the right-hand side), each
 *  point's averaged normal, and whether the outline is smooth there (turning less than `smoothCos`) */
interface RN { en: Float64Array; vn: Float64Array; sm: Uint8Array; miter: Float64Array }
function ringNormals(r: Ring, smoothCos: number): RN {
  const n = r.length / 2, en = new Float64Array(n * 2), vn = new Float64Array(n * 2), sm = new Uint8Array(n), miter = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, dx = r[j * 2] - r[i * 2], dz = r[j * 2 + 1] - r[i * 2 + 1], L = Math.hypot(dx, dz) || 1;
    en[i * 2] = dz / L; en[i * 2 + 1] = -dx / L;
  }
  for (let i = 0; i < n; i++) {
    const p = (i - 1 + n) % n, ax = en[p * 2], az = en[p * 2 + 1], bx = en[i * 2], bz = en[i * 2 + 1];
    let x = ax + bx, z = az + bz; const L = Math.hypot(x, z);
    if (L < 1e-6) { x = bx; z = bz; } else { x /= L; z /= L; }
    vn[i * 2] = x; vn[i * 2 + 1] = z;
    sm[i] = ax * bx + az * bz > smoothCos ? 1 : 0;
    // (how far a point moves along its normal for its edges to move by one: a mitred corner, capped for spikes)
    miter[i] = 1 / Math.max(0.35, x * bx + z * bz);
  }
  return { en, vn, sm, miter };
}
/** the ring moved out (d > 0) or in by d, its corners mitred */
export function offsetRing(r: Ring, d: number, N?: RN): Ring {
  const nn = N ?? ringNormals(r, 2), o: number[] = [];
  for (let i = 0; i < r.length / 2; i++) o.push(r[i * 2] + nn.vn[i * 2] * d * nn.miter[i], r[i * 2 + 1] + nn.vn[i * 2 + 1] * d * nn.miter[i]);
  return o;
}

// ------------------------------------------------------------------ canonical outlines, floor to floor
/** One outline of one floor, wound and started so it lines up with the one under it: `chain` names the run of
 *  outlines up the building it belongs to, `prev` its match on the floor below (−1: none). */
export interface CRing { ring: Ring; hole: boolean; chain: number; prev: number; c: Pt; a: number }
export interface Canon { floors: CRing[][]; perim: number[] }
const memo = new WeakMap<object, Canon>();

/** Every floor's outlines (outlines anticlockwise, holes clockwise), each matched to one on the floor below and
 *  started at the point nearest that one's start, so fins and lines run straight up through a taper or a twist.
 *  Memoised on `key` (a layout) when given. */
export function canonical(floors: Ring[][], key?: object): Canon {
  const hit = key && memo.get(key);
  if (hit) return hit;
  let chains = 0;
  const out: CRing[][] = [], per: number[][] = [];
  let below: CRing[] = [];
  for (const raw of floors) {
    const rs = raw.map(clean).filter((r) => r.length >= 6 && Math.abs(areaOf(r)) > 0.05).sort((a, b) => Math.abs(areaOf(b)) - Math.abs(areaOf(a)));
    const here: CRing[] = [], used = new Set<number>();
    rs.forEach((r0, i) => {
      // (a hole: inside an odd number of bigger outlines)
      let depth = 0; for (let j = 0; j < i; j++) if (inside(r0[0], r0[1], rs[j])) depth++;
      const hole = depth % 2 === 1;
      let r = (areaOf(r0) > 0) === !hole ? r0 : reverseRing(r0);
      const a = Math.abs(areaOf(r)), c = centreOf(r);
      // its match below: the same kind, about the same size, about the same place
      let best = -1, bs = Infinity;
      below.forEach((b, j) => {
        if (b.hole !== hole || used.has(j)) return;
        const ratio = a / (b.a || 1), d = Math.hypot(c[0] - b.c[0], c[1] - b.c[1]), sc = Math.sqrt(Math.max(a, b.a));
        if (ratio < 0.25 || ratio > 4 || d > 0.75 * sc) return;
        const s = d / sc + Math.abs(Math.log(ratio)) * 0.5;
        if (s < bs) { bs = s; best = j; }
      });
      const n = r.length / 2;
      let k0 = 0;
      if (best >= 0) {
        used.add(best);
        const P = below[best], ang = Math.atan2(P.ring[1] - P.c[1], P.ring[0] - P.c[0]);
        let bd = Infinity;
        for (let k = 0; k < n; k++) { let d = Math.abs(Math.atan2(r[k * 2 + 1] - c[1], r[k * 2] - c[0]) - ang); if (d > Math.PI) d = 2 * Math.PI - d; if (d < bd) { bd = d; k0 = k; } }
        // (with as many points, the start that matches them best, near that one)
        if (P.ring.length === r.length) {
          let bss = Infinity, kb = k0;
          for (let dk = -3; dk <= 3; dk++) {
            const k = (k0 + dk + n) % n; let ss = 0;
            for (let q = 0; q < n && ss < bss; q++) { const m = (q + k) % n, dx = r[m * 2] - c[0] - (P.ring[q * 2] - P.c[0]), dz = r[m * 2 + 1] - c[1] - (P.ring[q * 2 + 1] - P.c[1]); ss += dx * dx + dz * dz; }
            if (ss < bss) { bss = ss; kb = k; }
          }
          k0 = kb;
        }
      } else {
        let bd = -Infinity;
        for (let k = 0; k < n; k++) { const d = (r[k * 2] - c[0]) + (r[k * 2 + 1] - c[1]) * 0.37; if (d > bd) { bd = d; k0 = k; } }
      }
      r = roll(r, k0);
      const chain = best >= 0 ? below[best].chain : chains++;
      (per[chain] ??= []).push(cumOf(r).pop()!);
      here.push({ ring: r, hole, chain, prev: best, c, a });
    });
    out.push(here);
    below = here;
  }
  const perim = per.map((l) => { const s = [...l].sort((a, b) => a - b); return s[s.length >> 1] ?? 0; });
  const res = { floors: out, perim };
  if (key) memo.set(key, res);
  return res;
}
/** a layout's floors made canonical (memoised on the layout) */
export const canonOf = (L: FormLayout) => canonical(L.floors.map((f) => f.rings), L);

/** a floor's outline k and the one it lofts to on the floor above (itself when the next differs too much: a
 *  setback, a cantilever or a carve's edge reads as a step), paired point to point */
export function loftPair(C: Canon, k: number, i: number, h: number): { A: Ring; B: Ring; loft: boolean } {
  const cr = C.floors[k][i], up = C.floors[k + 1]?.findIndex((r) => r.prev === i) ?? -1;
  if (up < 0) return { A: cr.ring, B: cr.ring, loft: false };
  const [A, B] = pairRings(cr.ring, C.floors[k + 1][up].ring);
  const tol = Math.max(0.9, 0.6 * h);
  for (let q = 0; q < A.length; q += 2) if (Math.hypot(A[q] - B[q], A[q + 1] - B[q + 1]) > tol) return { A: cr.ring, B: cr.ring, loft: false };
  return { A, B, loft: true };
}

// ------------------------------------------------------------------ building geometry
/** Triangles with their normals (and uvs, in metres), collected and turned into one BufferGeometry. */
class Buf {
  p: number[] = []; n: number[] = []; uv: number[] = [];
  private v(a: V3, na: V3, uv: [number, number] | null) {
    this.p.push(a[0], a[1], a[2]); this.n.push(na[0], na[1], na[2]);
    // (no uv given: projected in metres, a wall along its run and up, a floor or roof in plan)
    if (uv) this.uv.push(uv[0], uv[1]);
    else if (Math.abs(na[1]) > 0.5) this.uv.push(a[0], a[2]);
    else this.uv.push(-a[0] * na[2] + a[2] * na[0], a[1]);
  }
  /** a triangle facing along its normals (the order is fixed to suit) */
  tri(a: V3, b: V3, c: V3, na: V3, nb = na, nc = na, ua: [number, number] | null = null, ub: [number, number] | null = null, uc: [number, number] | null = null) {
    const ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2], fx = c[0] - a[0], fy = c[1] - a[1], fz = c[2] - a[2];
    const gx = ey * fz - ez * fy, gy = ez * fx - ex * fz, gz = ex * fy - ey * fx;
    if (gx * gx + gy * gy + gz * gz < 1e-12) return;
    if (gx * (na[0] + nb[0] + nc[0]) + gy * (na[1] + nb[1] + nc[1]) + gz * (na[2] + nb[2] + nc[2]) >= 0) { this.v(a, na, ua); this.v(b, nb, ub); this.v(c, nc, uc); }
    else { this.v(a, na, ua); this.v(c, nc, uc); this.v(b, nb, ub); }
  }
  /** a quad a b c d round its edge */
  quad(a: V3, b: V3, c: V3, d: V3, na: V3, nb: V3, nc: V3, nd: V3, uv?: number[]) {
    if (!uv) { this.tri(a, b, c, na, nb, nc); this.tri(a, c, d, na, nc, nd); return; }
    const u = uv;
    this.tri(a, b, c, na, nb, nc, [u[0], u[1]], [u[2], u[3]], [u[4], u[5]]);
    this.tri(a, c, d, na, nc, nd, [u[0], u[1]], [u[4], u[5]], [u[6], u[7]]);
  }
  get empty() { return !this.p.length; }
  geo(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

/** Instanced parts: each a unit box set by its own three axes (so a fin can lean with a loft); the first of every
 *  three go first, so a far building can draw just those. */
class Inst {
  private maj: number[] = []; private min: number[] = []; private k = 0;
  add(c: V3, X: V3, Y: V3, Z: V3, major?: boolean) {
    const m = (major ?? this.k++ % 3 === 0) ? this.maj : this.min;
    m.push(X[0], X[1], X[2], 0, Y[0], Y[1], Y[2], 0, Z[0], Z[1], Z[2], 0, c[0], c[1], c[2], 1);
  }
  get size() { return (this.maj.length + this.min.length) / 16; }
  mesh(mat: THREE.Material): THREE.InstancedMesh | null {
    const n = this.size;
    if (!n) return null;
    const im = new THREE.InstancedMesh(BOX, mat, n);
    im.instanceMatrix.array.set(this.maj, 0); im.instanceMatrix.array.set(this.min, this.maj.length);
    im.instanceMatrix.needsUpdate = true;
    im.userData.major = this.maj.length / 16; im.userData.all = n;
    im.computeBoundingSphere();
    im.castShadow = true; im.receiveShadow = true;
    return im;
  }
}
/** the unit box every instanced part scales (shared: never disposed) */
export const BOX = new THREE.BoxGeometry(1, 1, 1);

const up: V3 = [0, 1, 0], down: V3 = [0, -1, 0];
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The wall between paired outlines A (at yA) and B (at yB), from share f0 to f1 of the way up, pushed out by `off`.
 *  Only the edges `keep` passes. */
function strip(out: Buf, A: Ring, B: Ring, yA: number, yB: number, f0: number, f1: number, N: RN, keep: ((i: number) => boolean) | null, cum: number[], off = 0, tile = 1) {
  const n = A.length / 2;
  const P = (k: number, f: number, nx: number, nz: number, m: number): V3 => [lerp(A[k * 2], B[k * 2], f) + nx * off * m, lerp(yA, yB, f), lerp(A[k * 2 + 1], B[k * 2 + 1], f) + nz * off * m];
  for (let i = 0; i < n; i++) {
    if (keep && !keep(i)) continue;
    const j = (i + 1) % n;
    const nia: V3 = N.sm[i] ? [N.vn[i * 2], 0, N.vn[i * 2 + 1]] : [N.en[i * 2], 0, N.en[i * 2 + 1]];
    const nja: V3 = N.sm[j] ? [N.vn[j * 2], 0, N.vn[j * 2 + 1]] : [N.en[i * 2], 0, N.en[i * 2 + 1]];
    // (pushed out along each point's mitred normal, so an offset skin closes at its corners)
    const ox = off ? [N.vn[i * 2], N.vn[i * 2 + 1], N.vn[j * 2], N.vn[j * 2 + 1]] : [0, 0, 0, 0];
    const a = P(i, f0, ox[0], ox[1], N.miter[i]), b = P(j, f0, ox[2], ox[3], N.miter[j]), c = P(j, f1, ox[2], ox[3], N.miter[j]), d = P(i, f1, ox[0], ox[1], N.miter[i]);
    const u0 = cum[i] / tile, u1 = cum[i + 1] / tile;
    out.quad(a, b, c, d, nia, nja, nja, nia, [u0, a[1] / tile, u1, b[1] / tile, u1, c[1] / tile, u0, d[1] / tile]);
  }
}
/** a flat face over outlines with their holes at height y, facing up or down */
function face(out: Buf, contour: Ring, holes: Ring[], y: number, n: V3, h?: (x: number, z: number) => number) {
  const v = (r: Ring) => { const o: THREE.Vector2[] = []; for (let i = 0; i < r.length; i += 2) o.push(new THREE.Vector2(r[i], r[i + 1])); return o; };
  const c = v(contour), hs = holes.map(v), all = [...c, ...hs.flat()];
  if (c.length < 3) return;
  const Y = (p: THREE.Vector2) => (h ? h(p.x, p.y) : y);
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(c, hs)) {
    const a = all[i], b = all[j], d = all[k];
    out.tri([a.x, Y(a), a.y], [b.x, Y(b), b.y], [d.x, Y(d), d.y], n);
  }
}
/** a ring of flat quads between an outline and the same pushed out by d, at height y (a balcony, a band's top) */
function annulus(out: Buf, A: Ring, N: RN, d0: number, d1: number, y: number, n: V3, keep: ((i: number) => boolean) | null) {
  const m = A.length / 2;
  for (let i = 0; i < m; i++) {
    if (keep && !keep(i)) continue;
    const j = (i + 1) % m, p = (k: number, d: number): V3 => [A[k * 2] + N.vn[k * 2] * d * N.miter[k], y, A[k * 2 + 1] + N.vn[k * 2 + 1] * d * N.miter[k]];
    out.quad(p(i, d0), p(j, d0), p(j, d1), p(i, d1), n, n, n, n);
  }
}
/** a band round an outline: its face pushed out by `o`, from y0 to y1, with a top and a bottom */
function band(out: Buf, A: Ring, N: RN, y0: number, y1: number, o: number, keep: ((i: number) => boolean) | null, cum: number[]) {
  strip(out, A, A, y0, y1, 0, 1, N, keep, cum, o);
  annulus(out, A, N, 0, o, y1, up, keep);
  annulus(out, A, N, 0, o, y0, down, keep);
}

// ------------------------------------------------------------------ roofs
/** the roof's frame: d the way it falls (local degrees turned into the world), e across it */
function roofAxes(roof: Roof, frame: { u: Pt; n: Pt }): { d: Pt; e: Pt } {
  const a = (roof.dir * Math.PI) / 180, d: Pt = [Math.cos(a) * frame.u[0] + Math.sin(a) * frame.n[0], Math.cos(a) * frame.u[1] + Math.sin(a) * frame.n[1]];
  return { d, e: [-d[1], d[0]] };
}
const ext = (r: Ring, ax: Pt) => { let lo = Infinity, hi = -Infinity; for (let i = 0; i < r.length; i += 2) { const t = r[i] * ax[0] + r[i + 1] * ax[1]; lo = Math.min(lo, t); hi = Math.max(hi, t); } return [lo, hi]; };
/** a pitch as a rise over a half-span: degrees for the planes, a share of the span for a barrel or a dome (taken
 *  as degrees when it's clearly one) */
const rise = (pitch: number, half: number, share: boolean) => (share && pitch <= 2 ? pitch * 2 * half : Math.tan((Math.min(75, Math.max(0, pitch)) * Math.PI) / 180) * half);

/** The outlines of a roof up its levels: from the eaves (level 0) to the ridge or the crown. A gable squeezes the
 *  outline across its fall to the ridge line, a hip squeezes it both ways (exact on a rectangle), a barrel and a dome
 *  along a quarter circle (a dome toward its middle). */
function roofLevels(ring: Ring, roof: Roof, frame: { u: Pt; n: Pt }): { rings: Ring[]; ys: number[] } | null {
  const k = roof.kind;
  if (k !== 'gable' && k !== 'hip' && k !== 'barrel' && k !== 'dome') return null;
  let { d, e } = roofAxes(roof, frame);
  const c = centreOf(ring);
  if (k === 'dome') {
    const R = Math.sqrt(Math.abs(areaOf(ring)) / Math.PI), H = rise(roof.pitch || 0.5, R, true), rings: Ring[] = [], ys: number[] = [];
    for (let s = 0; s <= 12; s++) { const ph = (s / 12) * (Math.PI / 2), m = Math.cos(ph); rings.push(ring.map((v, i) => c[i % 2] + (v - c[i % 2]) * m)); ys.push(H * Math.sin(ph)); }
    return { rings, ys };
  }
  if (k === 'hip') {
    // (the ridge along the longer way)
    const [dl, dh] = ext(ring, d), [el, eh] = ext(ring, e);
    if (dh - dl > eh - el) { const t = d; d = e; e = t; }
  }
  const [bl, bh] = ext(ring, d), [al, ah] = ext(ring, e), bm = (bl + bh) / 2, am = (al + ah) / 2, B = (bh - bl) / 2, A = (ah - al) / 2;
  const at = (sb: number, sa: number) => { const o: number[] = []; for (let i = 0; i < ring.length; i += 2) { const b = ring[i] * d[0] + ring[i + 1] * d[1], a = ring[i] * e[0] + ring[i + 1] * e[1], nb = bm + (b - bm) * sb, na = am + (a - am) * sa; o.push(d[0] * nb + e[0] * na, d[1] * nb + e[1] * na); } return o; };
  if (k === 'gable') { const H = rise(roof.pitch || 30, B, false); return { rings: [ring, at(0, 1)], ys: [0, H] }; }
  if (k === 'hip') { const H = rise(roof.pitch || 30, B, false); return { rings: [ring, at(0, A > 1e-6 ? Math.max(0, 1 - B / A) : 0)], ys: [0, H] }; }
  const H = rise(roof.pitch || 0.3, B, true), rings: Ring[] = [], ys: number[] = [];
  for (let s = 0; s <= 10; s++) { const ph = (s / 10) * (Math.PI / 2); rings.push(at(Math.cos(ph), 1)); ys.push(H * Math.sin(ph)); }
  return { rings, ys };
}
/** a plane roof's height over the eaves at a point: falls along d (mono, tilted) */
function planeOf(ring: Ring, roof: Roof, frame: { u: Pt; n: Pt }) {
  const { d } = roofAxes(roof, frame), [, hi] = ext(ring, d), t = Math.tan((Math.min(70, Math.max(0, roof.pitch || 12)) * Math.PI) / 180);
  return (x: number, z: number) => (hi - (x * d[0] + z * d[1])) * t;
}

export interface RoofSink { roof: Buf; wall: Buf; fins: Inst }
/** A roof on an outline (anticlockwise) at y0: into `sink` when given, its edges into `lines` (x, y, z pairs) when
 *  given. */
export function roofOn(ring: Ring, holes: Ring[], y0: number, roof: Roof, frame: { u: Pt; n: Pt }, skin: Skin, sink: RoofSink | null, lines: number[] | null) {
  const N = ringNormals(ring, Math.cos((35 * Math.PI) / 180)), cum = cumOf(ring), n = ring.length / 2;
  const L = (a: V3, b: V3) => lines?.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  const ringLine = (r: Ring, y: (i: number) => number) => { for (let i = 0; i < r.length / 2; i++) { const j = (i + 1) % (r.length / 2); L([r[i * 2], y(i), r[i * 2 + 1]], [r[j * 2], y(j), r[j * 2 + 1]]); } };
  const k = roof.kind;
  if (k === 'flat' || k === 'crown') {
    const p = k === 'crown' ? 0.6 : roof.parapet ?? 1;
    if (sink) {
      face(sink.roof, ring, holes, y0 + 0.02, up);
      if (p > 0.05) {
        const inner = offsetRing(ring, -0.22, N);
        strip(sink.wall, ring, ring, y0, y0 + p, 0, 1, N, null, cum);
        strip(sink.wall, inner, inner, y0, y0 + p, 0, 1, { ...N, en: N.en.map((v) => -v), vn: N.vn.map((v) => -v) }, null, cum);
        annulus(sink.wall, ring, N, -0.22, 0, y0 + p, up, null);
      }
    }
    ringLine(ring, () => y0 + p);
    if (k === 'crown') {
      // fins rising round the top, taller toward the middle of each run and graded by the skin's grade
      const H = Math.max(3, Math.min(30, roof.pitch > 2 ? roof.pitch * 0.3 : 8)), P = cum[n], m = Math.max(8, Math.round(P / Math.max(0.8, skin.spacing * 1.6)));
      let last: V3 | null = null, first: V3 | null = null;
      for (let q = 0; q < m; q++) {
        const f = (q + 0.5) / m, [i, t] = edgeAt(cum, f * P), j = (i + 1) % n;
        const x = lerp(ring[i * 2], ring[j * 2], t), z = lerp(ring[i * 2 + 1], ring[j * 2 + 1], t), nx = N.en[i * 2], nz = N.en[i * 2 + 1];
        const h = H * (0.55 + 0.45 * (0.5 + 0.5 * Math.cos(f * Math.PI * 8)) * (0.4 + 0.6 * (skin.grade || 0.5)));
        sink?.fins.add([x + nx * 0.2, y0 + h / 2, z + nz * 0.2], [-nz * 0.14, 0, nx * 0.14], [0, h, 0], [nx * 0.5, 0, nz * 0.5]);
        const tp: V3 = [x, y0 + h, z];
        if (q % 3 === 0) L([x, y0, z], tp);
        if (last) L(last, tp); else first = tp;
        last = tp;
      }
      if (last && first) L(last, first);
    }
    return;
  }
  if (k === 'mono' || k === 'tilted') {
    const h = planeOf(ring, roof, frame), eave = roof.overhang > 0 && k === 'mono' ? offsetRing(ring, roof.overhang, N) : ring, th = k === 'mono' ? 0.22 : 0;
    if (sink) {
      // the walls up to the plane, the plane over the eaves
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, ni: V3 = [N.en[i * 2], 0, N.en[i * 2 + 1]];
        sink.wall.quad([ring[i * 2], y0, ring[i * 2 + 1]], [ring[j * 2], y0, ring[j * 2 + 1]], [ring[j * 2], y0 + h(ring[j * 2], ring[j * 2 + 1]), ring[j * 2 + 1]], [ring[i * 2], y0 + h(ring[i * 2], ring[i * 2 + 1]), ring[i * 2 + 1]], ni, ni, ni, ni);
      }
      const { d } = roofAxes(roof, frame), t = Math.tan((Math.min(70, Math.max(0, roof.pitch || 12)) * Math.PI) / 180), L2 = Math.hypot(1, t);
      const pn: V3 = [(d[0] * t) / L2, 1 / L2, (d[1] * t) / L2];
      face(k === 'mono' ? sink.roof : sink.wall, eave, k === 'mono' ? [] : holes, 0, pn, (x, z) => y0 + h(x, z) + th);
      if (th) {
        face(sink.roof, eave, [], 0, [-pn[0], -pn[1], -pn[2]], (x, z) => y0 + h(x, z));
        const EN = ringNormals(eave, 2);
        for (let i = 0; i < eave.length / 2; i++) {
          const j = (i + 1) % (eave.length / 2), ni: V3 = [EN.en[i * 2], 0, EN.en[i * 2 + 1]], a = eave[i * 2], b = eave[i * 2 + 1], c = eave[j * 2], e = eave[j * 2 + 1];
          sink.roof.quad([a, y0 + h(a, b), b], [c, y0 + h(c, e), e], [c, y0 + h(c, e) + th, e], [a, y0 + h(a, b) + th, b], ni, ni, ni, ni);
        }
      }
    }
    ringLine(eave, (i) => y0 + h(eave[i * 2], eave[i * 2 + 1]) + th);
    for (let i = 0; i < n; i++) if (!N.sm[i]) L([ring[i * 2], y0, ring[i * 2 + 1]], [ring[i * 2], y0 + h(ring[i * 2], ring[i * 2 + 1]), ring[i * 2 + 1]]);
    return;
  }
  // the lofted roofs: gable, hip, barrel, dome
  const eave = roof.overhang > 0 ? offsetRing(ring, roof.overhang, N) : ring;
  const lv = roofLevels(eave, roof, frame);
  if (!lv) return;
  if (sink) {
    if (eave !== ring) annulus(sink.roof, ring, N, 0, roof.overhang, y0, down, null);
    const smooth = k === 'barrel' || k === 'dome';
    for (let s = 0; s + 1 < lv.rings.length; s++) {
      const A = lv.rings[s], B = lv.rings[s + 1], ya = y0 + lv.ys[s], yb = y0 + lv.ys[s + 1], m = A.length / 2;
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % m, a: V3 = [A[i * 2], ya, A[i * 2 + 1]], b: V3 = [A[j * 2], ya, A[j * 2 + 1]], c: V3 = [B[j * 2], yb, B[j * 2 + 1]], dd: V3 = [B[i * 2], yb, B[i * 2 + 1]];
        // (a face's own normal; smooth roofs lean each point's normal toward the way the surface curves)
        const fn = faceNormal(a, b, c, dd);
        if (!smooth) { sink.roof.quad(a, b, c, dd, fn, fn, fn, fn); continue; }
        const na = vtxNormal(lv, s, i, y0), nb = vtxNormal(lv, s, j, y0), nc = vtxNormal(lv, s + 1, j, y0), nd = vtxNormal(lv, s + 1, i, y0);
        sink.roof.quad(a, b, c, dd, na ?? fn, nb ?? fn, nc ?? fn, nd ?? fn);
      }
    }
  }
  ringLine(eave, () => y0);
  const top = lv.rings[lv.rings.length - 1], yt = y0 + lv.ys[lv.ys.length - 1];
  const m = eave.length / 2, EN = ringNormals(eave, Math.cos((35 * Math.PI) / 180));
  if (k === 'gable' || k === 'hip') {
    ringLine(top, () => yt);
    for (let i = 0; i < m; i++) if (!EN.sm[i]) L([eave[i * 2], y0, eave[i * 2 + 1]], [top[i * 2], yt, top[i * 2 + 1]]);
  } else {
    for (const s of [4, 7]) ringLine(lv.rings[s], () => y0 + lv.ys[s]);
    const step = Math.max(1, Math.round(m / 12));
    for (let i = 0; i < m; i += step) for (let s = 0; s + 1 < lv.rings.length; s++) L([lv.rings[s][i * 2], y0 + lv.ys[s], lv.rings[s][i * 2 + 1]], [lv.rings[s + 1][i * 2], y0 + lv.ys[s + 1], lv.rings[s + 1][i * 2 + 1]]);
  }
}
function faceNormal(a: V3, b: V3, c: V3, d: V3): V3 {
  const ex = c[0] - a[0], ey = c[1] - a[1], ez = c[2] - a[2], fx = d[0] - b[0], fy = d[1] - b[1], fz = d[2] - b[2];
  let x = ey * fz - ez * fy, y = ez * fx - ex * fz, z = ex * fy - ey * fx;
  if (y < 0) { x = -x; y = -y; z = -z; }
  const L = Math.hypot(x, y, z) || 1; return [x / L, y / L, z / L];
}
/** a smooth roof's normal at level s, point i: across to the next level and along the ring */
function vtxNormal(lv: { rings: Ring[]; ys: number[] }, s: number, i: number, y0: number): V3 | null {
  const R = lv.rings, m = R[0].length / 2, s0 = Math.max(0, s - 1), s1 = Math.min(R.length - 1, s + 1);
  if (s === R.length - 1) return [0, 1, 0];
  const p = (ss: number, ii: number): V3 => [R[ss][((ii + m) % m) * 2], y0 + lv.ys[ss], R[ss][((ii + m) % m) * 2 + 1]];
  const a = p(s1, i), b = p(s0, i), c = p(s, i + 1), d = p(s, i - 1);
  const ux = a[0] - b[0], uy = a[1] - b[1], uz = a[2] - b[2], vx = c[0] - d[0], vy = c[1] - d[1], vz = c[2] - d[2];
  let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
  if (y < 0) { x = -x; y = -y; z = -z; }
  const L = Math.hypot(x, y, z); return L > 1e-9 ? [x / L, y / L, z / L] : null;
}
/** the roof's edges for the wireframe */
export function roofLines(ring: Ring, holes: Ring[], y0: number, roof: Roof, frame: { u: Pt; n: Pt }, skin: Skin): number[] {
  const out: number[] = []; roofOn(ring, holes, y0, roof, frame, skin, null, out); return out;
}

// ------------------------------------------------------------------ materials
const MATS = new Map<string, THREE.Material>();
let screenTex: THREE.Texture | null = null;
/** a perforated screen's holes: a tile of dots, repeated by the uvs (metres) */
function screenAlpha(): THREE.Texture {
  if (screenTex) return screenTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#000';
  for (const [x, y] of [[16, 16], [48, 48], [48, 16], [16, 48]]) { g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return (screenTex = t);
}
type MatKind = 'solid' | 'glass' | 'metal' | 'thin' | 'rail' | 'screen' | 'tint';
/** where the shaded view's shared materials come from (../render/pbr.ts, set by the scene): walls, metal and glass
 *  then match the straight buildings', textures and all; unset, the plain ones below */
type Resolver = (kind: MatKind | 'spandrel', colour: string, id?: string) => THREE.Material | null;
let resolve: Resolver | null = null;
export function setMaterialResolver(r: Resolver | null) { resolve = r; }
function matOf(kind: MatKind | 'spandrel', colour: string, env: THREE.Texture | null, id?: string): THREE.Material {
  const shared = resolve?.(kind, colour, id);
  if (shared) return shared;
  if (kind === 'spandrel') kind = 'glass';
  const k = `${kind}|${colour}|${env ? env.uuid : ''}`;
  let m = MATS.get(k);
  if (m) return m;
  const C = new THREE.Color(colour);
  if (kind === 'glass') m = new THREE.MeshPhysicalMaterial({ color: C, roughness: 0.05, metalness: 0, ior: 1.52, envMap: env, envMapIntensity: 1.1 });
  else if (kind === 'metal') m = new THREE.MeshStandardMaterial({ color: C, roughness: 0.42, metalness: 0.55, envMap: env, envMapIntensity: 0.7 });
  else if (kind === 'thin') m = new THREE.MeshStandardMaterial({ color: C, roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide, envMap: env, envMapIntensity: 0.5 });
  else if (kind === 'rail') m = new THREE.MeshStandardMaterial({ color: C, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.32, side: THREE.DoubleSide, depthWrite: false, envMap: env });
  else if (kind === 'screen') m = new THREE.MeshStandardMaterial({ color: C, roughness: 0.6, metalness: 0.3, side: THREE.DoubleSide, alphaMap: screenAlpha(), alphaTest: 0.5, envMap: env, envMapIntensity: 0.5 });
  else if (kind === 'tint') m = new THREE.MeshStandardMaterial({ color: C, roughness: 0.9, transparent: true, opacity: 0.6 });
  else m = new THREE.MeshStandardMaterial({ color: C, roughness: 0.82, envMap: env, envMapIntensity: 0.35 });
  MATS.set(k, m);
  return m;
}

// ------------------------------------------------------------------ the building
/** What a formed building is drawn in: the design system's colours, the skin its language speaks, its roof. */
export interface Look {
  wall: string; glass: string; accent: string; frame: string; slab: string; roof: string; base: string; core: string;
  skin: Skin; roofKind: Roof; round: number;
  /** the design system's composition: how many floors at the bottom and the top take their own colour, with a
   *  string course between (none: one zone) */
  zones?: { base: number; top: number; baseColour: string; topColour: string };
  /** a chhajja over each floor's glazing, how far it projects (m; 0 none) */
  chhajja?: number;
  /** the materials (../materials.ts ids) of the wall, the accent and the base, for their textures */
  ids?: { wall?: string; accent?: string; base?: string; roof?: string };
}
export interface BuildOpts {
  /** floors shown, the top one cut as a plan (null: all, with the roof) */
  xray: number | null;
  /** the building's frame (its spine's first segment): which way a roof falls */
  frame: { u: Pt; n: Pt };
  /** the form's shell: how far past the roof it rises and from how high it starts */
  shell?: { over: number; under: number; offset: number } | null;
  env?: THREE.Texture | null;
}
export interface Built {
  group: THREE.Group;
  /** the instanced parts the level of detail thins */
  parts: THREE.InstancedMesh[];
  centre: THREE.Vector3; radius: number; instances: number;
}

/** what a floor of this use does to the skin: shopfronts and public rooms glazed full height, parking screened */
function useSkin(use: BuildingUse, p: SkinPattern, glass: number): { p: SkinPattern; glass: number } {
  if (use === 'retail' || use === 'library' || use === 'community') return { p: p === 'balconies' || p === 'diagrid' ? 'curtain' : p, glass: Math.max(glass, 0.86) };
  if (use === 'office' || use === 'school' || use === 'clinic') return { p: p === 'balconies' ? 'curtain' : p, glass: Math.max(glass, 0.7) };
  if (use === 'parking') return { p: 'louvres', glass: 0 };
  return { p, glass };
}

/** Distance from a point to an outline's edges (m). */
function distRing(x: number, z: number, r: Ring): number {
  let d = Infinity;
  for (let i = 0; i < r.length; i += 2) {
    const j = (i + 2) % r.length, ax = r[i], az = r[i + 1], dx = r[j] - ax, dz = r[j + 1] - az, L2 = dx * dx + dz * dz;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)) : 0;
    d = Math.min(d, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return d;
}

/** A formed building, ready to add to the scene. */
export function buildForm(L: FormLayout, look: Look, o: BuildOpts): Built {
  const F = L.floors, C = canonOf(L), env = o.env ?? null, skin = look.skin;
  const smoothCos = Math.cos(((25 + 35 * Math.max(0, Math.min(1, look.round))) * Math.PI) / 180);
  const B = {
    wall: new Buf(), wallBase: new Buf(), wallTop: new Buf(), spandrel: new Buf(), glass: new Buf(), slab: new Buf(), accent: new Buf(), thin: new Buf(), rail: new Buf(), screen: new Buf(), roof: new Buf(), core: new Buf(), shellScreen: new Buf(), shellThin: new Buf(),
  };
  const fins = new Inst(), mull = new Inst(), shellFins = new Inst(), roofFins = new Inst(), cols = new Inst();
  const tints = new Map<number, Buf>();
  const shown = o.xray === null ? F.length : Math.max(1, Math.min(F.length, o.xray)), cutAt = o.xray === null ? -1 : shown - 1;
  const last = F.length - 1;
  const sp = Math.max(0.25, skin.spacing || 1), dep = Math.max(0, skin.depth), ang = ((skin.angle || 0) * Math.PI) / 180, gr = Math.max(0, Math.min(1, skin.grade || 0));
  /** the grade: 0 … 1 along a run and up the height, a slow wave */
  const wave = (f: number, k: number) => 0.5 + 0.5 * Math.sin(f * Math.PI * 4 + (k / Math.max(1, F.length)) * Math.PI * 2);

  for (let k = 0; k < shown; k++) {
    const f = F[k], y = f.y, h = f.h, cut = k === cutAt, fl = C.floors[k];
    const { p: pat, glass } = useSkin(f.use, skin.pattern, skin.glass);
    // the slab, with its holes, its edge just proud of the wall
    for (const cr of fl) {
      if (cr.hole) continue;
      const holes = fl.filter((x) => x.hole && inside(x.ring[0], x.ring[1], cr.ring)).map((x) => x.ring);
      face(B.slab, cr.ring, holes, y, up); face(B.slab, cr.ring, holes, y - SLAB, down);
    }
    fl.forEach((cr, i) => {
      const lp = cut || k === last ? { A: cr.ring, B: cr.ring, loft: false } : loftPair(C, k, i, h);
      const A = lp.A, Bt = lp.B, N = ringNormals(A, smoothCos), cum = cumOf(A), n = A.length / 2, P = cum[n];
      // (proud of a glazed skin as a slab line; tucked behind a solid one, which should read as one smooth surface)
      strip(B.slab, cr.ring, cr.ring, y - SLAB, y, 0, 1, ringNormals(cr.ring, smoothCos), null, cumOf(cr.ring), skin.glass < 0.05 ? -0.03 : 0.03);
      // each edge: the skin, or a carve's cut face (glazed, or open)
      const cls = new Uint8Array(n);
      if (f.cuts.length) for (let e = 0; e < n; e++) {
        const j = (e + 1) % n, mx = (A[e * 2] + A[j * 2]) / 2, mz = (A[e * 2 + 1] + A[j * 2 + 1]) / 2;
        for (const c of f.cuts) if (distRing(mx, mz, c.ring) < 0.08) { cls[e] = c.face === 'glass' ? 1 : 2; break; }
      }
      const skinEdge = (e: number) => cls[e] === 0, cutGlass = (e: number) => cls[e] === 1;
      const top = cut ? CUT / h : 1, yB = y + h;
      const s = glass < 0.04 ? top : Math.min(top, (1 - glass) * 0.75);
      // (the zone's wall: the base and top floors in their own colours, a string course where they meet the middle)
      const Zb = look.zones?.base ?? 0, Zt = look.zones?.top ?? 0, WB = k < Zb ? B.wallBase : k >= F.length - Zt ? B.wallTop : B.wall;
      if (s > 0) strip(WB, A, Bt, y, yB, 0, s, N, skinEdge, cum);
      if (!cut && ((Zb && k === Zb) || (Zt && k === F.length - Zt))) band(B.accent, A, N, y - 0.2, y + 0.22, 0.3, skinEdge, cum);
      // (a chhajja over the glazing, the wall's own projection)
      if (!cut && (look.chhajja ?? 0) > 0.05 && glass >= 0.04 && pat !== 'curtain') band(WB, A, N, yB - 0.32, yB - 0.22, look.chhajja!, skinEdge, cum);
      if (s < top) strip(B.glass, A, Bt, y, yB, s, top, N, skinEdge, cum);
      strip(B.glass, A, Bt, y, yB, 0, top, N, cutGlass, cum);
      if (cut) return;
      // (a floor that steps rather than lofts gets a lid: where the floor above doesn't cover it, a terrace or the top
      // of a cantilevered wing; where it does, the lid sits hidden just under that floor's slab)
      if (!lp.loft && k < last && !cr.hole) face(B.slab, cr.ring, fl.filter((x) => x.hole && inside(x.ring[0], x.ring[1], cr.ring)).map((x) => x.ring), yB - 0.02, up);
      // the pattern, along the outline by arc length; fins and mullions keep their place up a chain of floors
      const count = (spc: number) => Math.max(3, Math.round((C.perim[cr.chain] || P) / spc));
      const along = (fr: number) => {
        const [e, t] = edgeAt(cum, fr * P), j = (e + 1) % n;
        const a: V3 = [lerp(A[e * 2], A[j * 2], t), y, lerp(A[e * 2 + 1], A[j * 2 + 1], t)], b: V3 = [lerp(Bt[e * 2], Bt[j * 2], t), yB, lerp(Bt[e * 2 + 1], Bt[j * 2 + 1], t)];
        let nx = N.en[e * 2], nz = N.en[e * 2 + 1];
        if (N.sm[e] && N.sm[j]) { nx = lerp(N.vn[e * 2], N.vn[j * 2], t); nz = lerp(N.vn[e * 2 + 1], N.vn[j * 2 + 1], t); const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l; }
        return { a, b, nx, nz, e };
      };
      const vertical = (I: Inst, m: number, thick: number, depth: number, turn: number, graded: boolean) => {
        for (let q = 0; q < m; q++) {
          const fr = (q + 0.5) / m, g = along(fr);
          if (!skinEdge(g.e)) continue;
          const w = graded ? wave(fr, k) : 0.5, an = turn + (graded ? gr * (w - 0.5) * 0.9 : 0), dp = depth * (graded ? 1 - gr * 0.6 * w : 1);
          const c = Math.cos(an), sn = Math.sin(an), rx = g.nx * c - g.nz * sn, rz = g.nx * sn + g.nz * c;
          const Y: V3 = [g.b[0] - g.a[0], g.b[1] - g.a[1], g.b[2] - g.a[2]];
          I.add([(g.a[0] + g.b[0]) / 2 + rx * dp / 2, (g.a[1] + g.b[1]) / 2, (g.a[2] + g.b[2]) / 2 + rz * dp / 2], [-rz * thick, 0, rx * thick], Y, [rx * dp, 0, rz * dp]);
        }
      };
      if (pat === 'fins') vertical(fins, count(sp), Math.min(0.12, sp * 0.22), Math.max(0.15, dep), ang, true);
      else if (pat === 'curtain') {
        // (on a solid skin the mullions are only the panels' joints: fine and nearly flush, no transoms)
        const solid = glass < 0.05;
        vertical(mull, count(sp), solid ? 0.03 : 0.07, solid ? 0.025 : Math.max(0.06, Math.min(0.25, dep)), 0, false);
        if (!solid) band(B.accent, A, N, y - 0.06, y + 0.12, Math.max(0.05, Math.min(0.2, dep)), skinEdge, cum);
        // (a spandrel over the slab, opaque glass to sill height, and a transom over it: a curtain wall's floor line)
        if (!solid) { band(B.spandrel, A, N, y + 0.12, y + 0.9, 0.012, skinEdge, cum); band(B.accent, A, N, y + 0.9, y + 0.96, Math.max(0.04, Math.min(0.12, dep * 0.5)), skinEdge, cum); }
      } else if (pat === 'grid') {
        vertical(mull, count(Math.max(1.5, sp)), 0.35, Math.max(0.12, dep), 0, false);
        band(B.accent, A, N, y - 0.2, y + 0.3, Math.max(0.1, dep * 0.8), skinEdge, cum);
      } else if (pat === 'bands') band(B.accent, A, N, y - 0.22, y + 0.28, Math.max(0.08, dep), skinEdge, cum);
      else if (pat === 'louvres') {
        const nb = Math.max(1, Math.min(14, Math.round(h / Math.max(0.2, sp)))), drop = Math.tan(Math.max(-1.2, Math.min(1.2, ang))) * Math.max(0.1, dep);
        for (let q = 0; q < nb; q++) {
          const fr = (q + 0.5) / nb, yy = lerp(y, yB, fr);
          for (let e = 0; e < n; e++) {
            if (!skinEdge(e)) continue;
            const j = (e + 1) % n, P0 = (v: number, d: number, dy: number): V3 => [lerp(A[v * 2], Bt[v * 2], fr) + N.vn[v * 2] * d * N.miter[v], yy + dy, lerp(A[v * 2 + 1], Bt[v * 2 + 1], fr) + N.vn[v * 2 + 1] * d * N.miter[v]];
            B.thin.quad(P0(e, 0.04, 0), P0(j, 0.04, 0), P0(j, Math.max(0.1, dep), -drop), P0(e, Math.max(0.1, dep), -drop), up, up, up, up);
          }
        }
      } else if (pat === 'diagrid' && k % 2 === 0) {
        // members across two floors, from each node to the next one up
        const kk = Math.min(k + 2, F.length), upR = kk < F.length ? C.floors[kk]?.find((r) => r.chain === cr.chain)?.ring : Bt, yU = kk < F.length ? F[kk].y : yB;
        if (upR) {
          const cu = cumOf(upR), m = Math.max(4, Math.round((C.perim[cr.chain] || P) / Math.max(1.5, sp))), off = Math.max(0.12, dep * 0.5);
          const node = (r: Ring, cc: number[], fr: number, yy: number): V3 => { const [e, t] = edgeAt(cc, fr * cc[cc.length - 1]), q = r.length / 2, j = (e + 1) % q, Nn = ringNormals(r, 2); return [lerp(r[e * 2], r[j * 2], t) + Nn.en[e * 2] * off, yy, lerp(r[e * 2 + 1], r[j * 2 + 1], t) + Nn.en[e * 2 + 1] * off]; };
          for (let q = 0; q < m; q++) {
            const f0 = q / m, f1 = (q + 1) / m;
            for (const [a, b] of [[node(A, cum, f0, y), node(upR, cu, f1, yU)], [node(A, cum, f1, y), node(upR, cu, f0, yU)]] as [V3, V3][]) {
              // (its width across it in the face, its depth out of the face)
              const Y: V3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], hl = Math.hypot(Y[0], Y[2]) || 1, tx = Y[0] / hl, tz = Y[2] / hl, L3 = Math.hypot(hl, Y[1]) || 1;
              const W: V3 = [(-tx * Y[1] / L3) * 0.32, (hl / L3) * 0.32, (-tz * Y[1] / L3) * 0.32];
              mull.add([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], W, Y, [tz * 0.3, 0, -tx * 0.3], q % 2 === 0);
            }
          }
          band(B.accent, A, N, y - 0.18, y + 0.22, off + 0.15, skinEdge, cum);
        }
      } else if (pat === 'screen') {
        strip(B.screen, A, Bt, y, yB, 0, 1, N, skinEdge, cum, Math.max(0.3, dep), 1.2);
      } else if (pat === 'balconies' && k > 0 && !cr.hole) {
        const d = Math.max(0.9, dep), RN2 = N;
        annulus(B.slab, A, RN2, 0, d, y, up, skinEdge); annulus(B.slab, A, RN2, 0, d, y - 0.2, down, skinEdge);
        strip(B.slab, A, A, y - 0.2, y, 0, 1, RN2, skinEdge, cum, d);
        strip(B.rail, A, A, y, y + 1.05, 0, 1, RN2, skinEdge, cum, d - 0.06);
        band(B.accent, A, RN2, y + 1.02, y + 1.08, d - 0.04, skinEdge, cum);
      }
      if (skin.slabEdge && pat !== 'bands' && pat !== 'grid' && pat !== 'balconies' && pat !== 'curtain') band(B.accent, A, N, y - 0.16, y + 0.14, 0.07, skinEdge, cum);
    });
    // the cut floor: its flats tinted, the cores and the columns to the cut
    if (cut) {
      for (const u of f.units) { if (u.ring.length < 6) continue; let t = tints.get(u.t); if (!t) tints.set(u.t, (t = new Buf())); face(t, u.ring, [], y + 0.05, up); }
      for (const c of L.cores) { const N = ringNormals(c, 2); strip(B.core, c, c, 0, y + CUT, 0, 1, N, null, cumOf(c)); }
      for (const [x, z] of L.columns) cols.add([x, y + CUT / 2, z], [0.45, 0, 0], [0, CUT, 0], [0, 0, 0.45], true);
    }
  }

  // the roof, and a lift room over each core under a flat one
  if (o.xray === null && F.length) {
    const top = F[last], y0 = top.y + top.h, fl = C.floors[last];
    for (const cr of fl) {
      if (cr.hole) continue;
      const holes = fl.filter((x) => x.hole && inside(x.ring[0], x.ring[1], cr.ring)).map((x) => x.ring);
      roofOn(cr.ring, holes, y0, look.roofKind, o.frame, skin, { roof: B.roof, wall: B.wall, fins: roofFins }, null);
    }
    if (look.roofKind.kind === 'flat' || look.roofKind.kind === 'crown') for (const c of L.cores) {
      const N = ringNormals(c, 2); strip(B.core, c, c, y0, y0 + 3, 0, 1, N, null, cumOf(c)); face(B.core, c, [], y0 + 3, up);
    }
  }

  // the shell: lofted through its rings, past the roof by `over`, from `under` up
  if (L.shell && L.shell.length && o.shell) {
    const S = canonical(L.shell.map((r) => [r])), sh = o.shell, nS = Math.min(L.shell.length, F.length);
    const style = skin.pattern === 'screen' ? 'screen' : skin.pattern === 'louvres' ? 'louvres' : 'fins';
    const ssp = Math.max(0.7, Math.min(1.8, sp * 1.6)), sdep = Math.max(0.35, Math.min(1.1, sh.offset * 0.6 || 0.6));
    const upto = o.xray === null ? Infinity : F[cutAt].y + CUT;
    for (let k = 0; k < nS; k++) {
      const cr = S.floors[k][0];
      if (!cr) continue;
      const f = F[k], topK = k === nS - 1;
      const lp = topK ? { A: cr.ring, B: cr.ring } : loftPair(S, k, 0, f.h);
      const A = lp.A, Bt = lp.B, ya = f.y, yb = topK ? f.y + f.h + Math.max(0, sh.over) : F[k + 1].y;
      if (yb <= sh.under || ya >= upto) continue;
      // (the share of this run below the shell's start, or past the X-ray cut, left off)
      const f0 = Math.max(0, (sh.under - ya) / (yb - ya)), f1 = Math.min(1, (upto - ya) / (yb - ya));
      const N = ringNormals(A, smoothCos), cum = cumOf(A), n = A.length / 2, P = cum[n];
      if (style === 'screen') { strip(B.shellScreen, A, Bt, ya, yb, f0, f1, N, null, cum, 0, 1.2); continue; }
      if (style === 'louvres') {
        const nb = Math.max(1, Math.round((yb - ya) / 0.6));
        for (let q = 0; q < nb; q++) { const fr = (q + 0.5) / nb; if (fr < f0 || fr > f1) continue; const yy = lerp(ya, yb, fr); for (let e = 0; e < n; e++) { const j = (e + 1) % n, Q = (v: number, d: number): V3 => [lerp(A[v * 2], Bt[v * 2], fr) + N.vn[v * 2] * d, yy, lerp(A[v * 2 + 1], Bt[v * 2 + 1], fr) + N.vn[v * 2 + 1] * d]; B.shellThin.quad(Q(e, -sdep / 2), Q(j, -sdep / 2), Q(j, sdep / 2), Q(e, sdep / 2), up, up, up, up); } }
        continue;
      }
      const m = Math.max(8, Math.round((S.perim[cr.chain] || P) / ssp));
      for (let q = 0; q < m; q++) {
        const fr = (q + 0.5) / m, [e, t] = edgeAt(cum, fr * P), j = (e + 1) % n;
        let nx = N.en[e * 2], nz = N.en[e * 2 + 1];
        if (N.sm[e] && N.sm[j]) { nx = lerp(N.vn[e * 2], N.vn[j * 2], t); nz = lerp(N.vn[e * 2 + 1], N.vn[j * 2 + 1], t); const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l; }
        const ax = lerp(A[e * 2], A[j * 2], t), az = lerp(A[e * 2 + 1], A[j * 2 + 1], t), bx = lerp(Bt[e * 2], Bt[j * 2], t), bz = lerp(Bt[e * 2 + 1], Bt[j * 2 + 1], t);
        const a: V3 = [lerp(ax, bx, f0), lerp(ya, yb, f0), lerp(az, bz, f0)], b: V3 = [lerp(ax, bx, f1), lerp(ya, yb, f1), lerp(az, bz, f1)];
        // (fluted: the fins deepen and thin along a slow wave when the skin is graded)
        const w = wave(fr, k), dp = sdep * (1 - gr * 0.5 * w);
        shellFins.add([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], [-nz * 0.14, 0, nx * 0.14], [b[0] - a[0], b[1] - a[1], b[2] - a[2]], [nx * dp, 0, nz * dp]);
      }
    }
  }

  // into meshes: merged per material, instanced parts thinned by the level of detail
  const group = new THREE.Group(), parts: THREE.InstancedMesh[] = [];
  const add = (b: Buf, m: THREE.Material, cast = true) => { if (b.empty) return; const x = new THREE.Mesh(b.geo(), m); x.castShadow = cast; x.receiveShadow = true; group.add(x); };
  add(B.wall, matOf('solid', look.wall, env, look.ids?.wall)); add(B.wallBase, matOf('solid', look.zones?.baseColour ?? look.wall, env, look.ids?.base)); add(B.wallTop, matOf('solid', look.zones?.topColour ?? look.wall, env, look.ids?.accent));
  add(B.spandrel, matOf('spandrel', look.glass, env)); add(B.glass, matOf('glass', look.glass, env)); add(B.slab, matOf('solid', look.slab, env));
  add(B.accent, matOf('metal', look.accent, env)); add(B.thin, matOf('thin', look.accent, env)); add(B.rail, matOf('rail', '#cfe0e8', env), false);
  add(B.screen, matOf('screen', look.accent, env)); add(B.roof, matOf('solid', look.roof, env, look.ids?.roof)); add(B.core, matOf('solid', look.core, env));
  add(B.shellScreen, matOf('screen', look.wall, env)); add(B.shellThin, matOf('thin', look.wall, env));
  for (const [t, b] of tints) add(b, matOf('tint', UNIT_COLOR[t] ?? '#ccc', null), false);
  for (const [I, m] of [[fins, matOf('metal', look.accent, env)], [mull, matOf('metal', look.frame, env)], [shellFins, matOf('solid', look.wall, env)], [roofFins, matOf('metal', look.accent, env)], [cols, matOf('solid', look.base, env)]] as [Inst, THREE.Material][]) {
    const im = I.mesh(m);
    if (im) { group.add(im); parts.push(im); }
  }
  // its middle and size, for the level of detail
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const r of [L.outline, ...(F.length ? [] : [])]) for (let i = 0; i < r.length; i += 2) { minX = Math.min(minX, r[i]); maxX = Math.max(maxX, r[i]); minZ = Math.min(minZ, r[i + 1]); maxZ = Math.max(maxZ, r[i + 1]); }
  if (!Number.isFinite(minX)) { minX = maxX = minZ = maxZ = 0; }
  const H = Math.max(L.top, F.length ? F[last].y + F[last].h : 0);
  const centre = new THREE.Vector3((minX + maxX) / 2, H / 2, (minZ + maxZ) / 2);
  return { group, parts, centre, radius: Math.max(5, Math.hypot(maxX - minX, maxZ - minZ, H) / 2), instances: parts.reduce((s, p) => s + p.count, 0) };
}

/** Drop a built building's geometry (the shared box and the cached materials stay). */
export function disposeBuilt(b: Built) {
  b.group.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry && m.geometry !== BOX) m.geometry.dispose(); if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); });
}

/** The building as one plain solid (floor by floor, its outlines straight up): what the wireframe hides its back
 *  edges behind and what a click picks. */
export function formMass(L: FormLayout): THREE.BufferGeometry {
  const b = new Buf(), C = canonOf(L);
  L.floors.forEach((f, k) => {
    for (const cr of C.floors[k]) {
      const N = ringNormals(cr.ring, 2);
      strip(b, cr.ring, cr.ring, f.y, f.y + f.h, 0, 1, N, null, cumOf(cr.ring));
      if (cr.hole) continue;
      const holes = C.floors[k].filter((x) => x.hole && inside(x.ring[0], x.ring[1], cr.ring)).map((x) => x.ring);
      face(b, cr.ring, holes, f.y + f.h, up);
    }
  });
  return b.geo();
}

/** a cheap fingerprint of a layout (its floors' outlines and heights), to tell a changed building from the same one
 *  worked out again */
export function layoutHash(L: FormLayout): string {
  let h = 0, n = 0;
  const mix = (v: number) => { h = (h * 31 + Math.round(v * 100)) | 0; n++; };
  for (const f of L.floors) { mix(f.y); mix(f.h); for (const r of f.rings) for (const v of r) mix(v); for (const c of f.cuts) for (const v of c.ring) mix(v); mix(f.units.length); }
  for (const r of L.shell ?? []) for (const v of r) mix(v);
  mix(L.top);
  return `${n}:${h}`;
}
