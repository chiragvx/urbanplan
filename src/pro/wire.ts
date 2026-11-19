// The Pro 3D's wireframe: the scheme drawn as low-poly lines. Every building face is split into floors and bays with a
// triangle across each bay; the plot is triangulated; roads, the buildable line and the DP widening are outlined.
// Edges in front are drawn in ink, edges behind faint (an invisible copy of the masses hides them from the ink pass).
//
// The edges are kept between changes: a change adds only the new ones (they grow up from the lowest change, a little
// warped, then settle true) and retracts the gone ones (from the top down). Nothing else moves. With reduced motion
// the change is simply made.
import * as THREE from 'three';
import type { PlotReport } from '../doc/plot';
import type { SiteReport } from '../doc/site';
import type { Shops } from './mixed';

type V3 = [number, number, number];
/** one edge: its ends, how strong (0 faint … 1 ink), and its animation */
interface Seg { k: string; a: V3; b: V3; w: number; born: number; delay: number; dur: number; dead: number; ddelay: number; out: number }
export interface WireData { r: PlotReport; d: SiteReport; roads: { pts: [number, number, number, number]; today: number }[]; shops?: Shops | null }

const BAY = 6;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
const hash = (x: number, y: number, z: number) => { const v = Math.sin(x * 12.99 + y * 78.23 + z * 37.72) * 43758.55; return v - Math.floor(v); };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** every edge of the scheme, keyed by its ends */
function edges(v: WireData): { k: string; a: V3; b: V3; w: number }[] {
  const M = new Map<string, { k: string; a: V3; b: V3; w: number }>();
  const add = (a: V3, b: V3, w: number) => {
    if (Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) < 0.05) return;
    const ka = a.map((x) => x.toFixed(2)).join(), kb = b.map((x) => x.toFixed(2)).join(), k = ka < kb ? ka + '|' + kb : kb + '|' + ka;
    const o = M.get(k); if (!o || o.w < w) M.set(k, { k, a, b, w });
  };
  const ring = (r: number[], y: number, w: number, dash = 0) => {
    for (let i = 0; i < r.length; i += 2) {
      const j = (i + 2) % r.length, a: V3 = [r[i], y, r[i + 1]], b: V3 = [r[j], y, r[j + 1]];
      if (!dash) { add(a, b, w); continue; }
      const L = Math.hypot(b[0] - a[0], b[2] - a[2]), n = Math.max(1, Math.floor(L / (dash * 2)));
      for (let s = 0; s < n; s++) { const t0 = (s * 2 * dash) / L, t1 = Math.min(1, ((s * 2 + 1) * dash) / L); add([a[0] + (b[0] - a[0]) * t0, y, a[2] + (b[2] - a[2]) * t0], [a[0] + (b[0] - a[0]) * t1, y, a[2] + (b[2] - a[2]) * t1], w); }
    }
  };
  const tris = (r: number[], y: number, w: number) => {
    const pts: THREE.Vector2[] = []; for (let i = 0; i < r.length; i += 2) pts.push(new THREE.Vector2(r[i], r[i + 1]));
    if (pts.length < 3) return;
    for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(pts, [])) for (const [p, q] of [[i, j], [j, k], [k, i]]) add([pts[p].x, y, pts[p].y], [pts[q].x, y, pts[q].y], w);
  };
  const { r, d } = v, fh = r.rules.floorH, y0 = d.under * fh;

  // the ground: roads, the plot (triangulated), what the DP takes, the buildable line
  for (const rd of v.roads) {
    const [x0, z0, x1, z1] = rd.pts, L = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / L, uz = (z1 - z0) / L, nx = -uz * rd.today / 2, nz = ux * rd.today / 2;
    const a = [x0 + ux * 240, z0 + uz * 240], b = [x1 - ux * 240, z1 - uz * 240];
    add([a[0] + nx, 0, a[1] + nz], [b[0] + nx, 0, b[1] + nz], 0.45);
    add([a[0] - nx, 0, a[1] - nz], [b[0] - nx, 0, b[1] - nz], 0.45);
    const RL = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (let s = 0; s + 2 < RL; s += 6) add([a[0] + ux * s, 0, a[1] + uz * s], [a[0] + ux * (s + 2.5), 0, a[1] + uz * (s + 2.5)], 0.25);
  }
  for (const lr of r.lostRings) ring(lr, 0, 0.5, 0.8);
  ring(r.net, 0, 0.8); tris(r.net, 0, 0.14);
  if (r.footprint.length >= 6) ring(r.footprint, 0, 0.4, 0.6);
  if (v.shops && y0) for (const st of v.shops.strips) { ring(st.ring, 0, 0.6); ring(st.ring, y0, 0.6); for (let i = 0; i < st.ring.length; i += 2) add([st.ring[i], 0, st.ring[i + 1]], [st.ring[i], y0, st.ring[i + 1]], 0.6); }

  // the buildings: floors × bays, a triangle across each bay; the stilt as columns; the roof triangulated
  for (const b of d.buildings) {
    const top = y0 + b.floors * fh;
    const lv = [0]; if (y0 > 0) lv.push(y0); for (let f = 1; f < b.floors; f++) lv.push(y0 + f * fh); lv.push(top);
    for (const q of b.quads) {
      for (let i = 0; i < q.length; i += 2) {
        const j = (i + 2) % q.length, ax = q[i], az = q[i + 1], bx = q[j], bz = q[j + 1], L = Math.hypot(bx - ax, bz - az);
        if (L < 0.3) continue;
        const nb = Math.max(1, Math.round(L / BAY)), at = (s: number, y: number): V3 => [ax + ((bx - ax) * s) / nb, y, az + ((bz - az) * s) / nb];
        lv.forEach((y, n) => add(at(0, y), at(nb, y), n === 0 || n === lv.length - 1 || y === y0 ? 1 : 0.42));
        for (let n = 0; n < lv.length - 1; n++) for (let s = 0; s < nb; s++) {
          add(at(s, lv[n]), at(s, lv[n + 1]), s === 0 ? 1 : 0.42);
          if (y0 > 0 && n === 0) continue; // (the stilt: open, just its columns)
          if ((s + n) % 2) add(at(s, lv[n]), at(s + 1, lv[n + 1]), 0.3); else add(at(s + 1, lv[n]), at(s, lv[n + 1]), 0.3);
        }
      }
      tris(q, top, 0.35);
    }
    for (const c of b.cores) {
      const ct = top + 2.4;
      ring(c, ct, 0.85); tris(c, ct, 0.3);
      for (let i = 0; i < c.length; i += 2) add([c[i], top, c[i + 1]], [c[i], ct, c[i + 1]], 0.85);
      ring(c, top, 0.6);
    }
  }
  return [...M.values()];
}

export class Wire {
  group = new THREE.Group();
  private segs: Seg[] = [];
  private geo = new THREE.BufferGeometry();
  private dotGeo = new THREE.BufferGeometry();
  private ink = new THREE.LineBasicMaterial({ vertexColors: true });
  private faint = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.22, depthTest: false, depthWrite: false });
  private dotMat = new THREE.PointsMaterial({ size: 3, sizeAttenuation: false });
  private hide = new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 2, side: THREE.DoubleSide });
  private masses = new THREE.Group();
  private end = 0;
  private paper = new THREE.Color('#fff');
  private inkC = new THREE.Color('#000');

  constructor() {
    const back = new THREE.LineSegments(this.geo, this.faint); back.renderOrder = 1; back.frustumCulled = false;
    const front = new THREE.LineSegments(this.geo, this.ink); front.renderOrder = 2; front.frustumCulled = false;
    const dots = new THREE.Points(this.dotGeo, this.dotMat); dots.renderOrder = 3; dots.frustumCulled = false;
    this.masses.renderOrder = 0;
    this.group.add(this.masses, back, front, dots);
  }

  /** the page's ink and paper, for the lines */
  colours(paper: string, ink: string) { this.paper.set(paper); this.inkC.set(ink); this.dotMat.color.set(ink); this.write(performance.now()); }

  /** still growing or retracting? */
  get moving() { return performance.now() < this.end; }

  /** the scheme changed (or arrived): diff its edges against the ones drawn */
  set(v: WireData, fresh = false) {
    const now = performance.now(), red = reduced();
    if (fresh) this.segs = [];
    const first = !this.segs.some((s) => !s.dead), have = new Map(this.segs.map((s) => [s.k, s])), out: Seg[] = [], born: Seg[] = [], dying: Seg[] = [];
    for (const e of edges(v)) {
      const o = have.get(e.k);
      if (o && !o.dead) { have.delete(e.k); o.w = e.w; out.push(o); continue; }
      if (o) have.delete(e.k);
      const s: Seg = { ...e, born: now, delay: 0, dur: 0, dead: 0, ddelay: 0, out: 0 }; born.push(s); out.push(s);
    }
    for (const o of have.values()) { if (!o.dead) { o.dead = now; dying.push(o); } out.push(o); }
    const low = (s: Seg) => Math.min(s.a[1], s.b[1]), span = (L: Seg[]) => { let lo = Infinity, hi = -Infinity; for (const s of L) { lo = Math.min(lo, low(s)); hi = Math.max(hi, low(s)); } return [lo, hi - lo || 1]; };
    const h = (s: Seg) => hash(s.a[0] + s.b[0], s.a[1] + s.b[1], s.a[2] + s.b[2]);
    const [blo, bsp] = span(born);
    for (const s of born) {
      const r = (low(s) - blo) / bsp, ground = s.a[1] === 0 && s.b[1] === 0;
      s.dur = first ? 900 : 650;
      s.delay = red ? -1e9 : first ? (ground ? h(s) * 200 : 200 + r * 1500 + h(s) * 200) : r * 500 + h(s) * 120;
    }
    const [dlo, dsp] = span(dying);
    for (const s of dying) { s.out = 450; s.ddelay = red ? -1e9 : (1 - (low(s) - dlo) / dsp) * 250 + h(s) * 80; }
    this.segs = red ? out.filter((s) => !s.dead) : out;
    this.end = now;
    for (const s of this.segs) this.end = Math.max(this.end, s.dead ? s.dead + s.ddelay + s.out : s.born + s.delay + s.dur);
    // the masses that hide the edges behind them
    this.masses.traverse((o) => { if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose(); });
    this.masses.clear();
    const fh = v.r.rules.floorH, y0 = v.d.under * fh;
    for (const b of v.d.buildings) {
      const top = y0 + b.floors * fh;
      for (const q of b.quads) this.masses.add(new THREE.Mesh(prism(q, 0, top), this.hide));
      for (const c of b.cores) this.masses.add(new THREE.Mesh(prism(c, top, top + 2.4), this.hide));
    }
    this.write(now);
  }

  /** this frame's lines: settled edges as they are, moving ones part-drawn and warped. Returns whether to keep going. */
  write(now = performance.now()): boolean {
    if (this.segs.length && now >= this.end && this.segs.some((s) => s.dead)) this.segs = this.segs.filter((s) => !s.dead);
    const n = this.segs.length, pos = new Float32Array(n * 6), col = new Float32Array(n * 6), dots: number[] = [];
    const T = now / 1000, c = new THREE.Color();
    let m = 0;
    for (const s of this.segs) {
      const u = s.dead ? 1 - clamp01((now - s.dead - s.ddelay) / s.out) : clamp01((now - s.born - s.delay) / s.dur);
      if (u <= 0) continue;
      const e = ease(u), wv = (1 - e) * (1 - e);
      const wp = (p: V3): V3 => wv ? [p[0] + Math.sin(p[1] * 0.4 + p[2] * 0.3 + T * 1.7) * 3 * wv, p[1] + Math.sin(p[0] * 0.3 + T * 2.1) * 1.5 * wv - (1 - e) * 2.5, p[2] + Math.cos(p[0] * 0.35 + p[1] * 0.2 - T * 1.4) * 3 * wv] : p;
      const a = wp(s.a), b = wp(s.b), mid: V3 = [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e, a[2] + (b[2] - a[2]) * e];
      c.copy(this.paper).lerp(this.inkC, 0.15 + 0.85 * s.w);
      pos.set(a, m * 6); pos.set(mid, m * 6 + 3);
      col.set([c.r, c.g, c.b, c.r, c.g, c.b], m * 6);
      if (u < 1) dots.push(...mid);
      m++;
    }
    this.geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geo.setDrawRange(0, m * 2);
    this.dotGeo.setAttribute('position', new THREE.Float32BufferAttribute(dots, 3));
    return now < this.end;
  }

  dispose() { this.geo.dispose(); this.dotGeo.dispose(); this.masses.traverse((o) => (o as THREE.Mesh).geometry?.dispose()); }
}

/** a closed prism over a ring (x,z,…), for hiding */
function prism(ring: number[], y0: number, y1: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = []; for (let i = 0; i < ring.length; i += 2) pts.push(new THREE.Vector2(ring[i], ring[i + 1]));
  const pos: number[] = [], n = pts.length;
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; pos.push(a.x, y0, a.y, b.x, y0, b.y, b.x, y1, b.y, a.x, y0, a.y, b.x, y1, b.y, a.x, y1, a.y); }
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(pts, [])) pos.push(pts[i].x, y1, pts[i].y, pts[k].x, y1, pts[k].y, pts[j].x, y1, pts[j].y);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); return g;
}
