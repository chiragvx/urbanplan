// The Pro 3D's wireframe: the scheme drawn as low-poly lines. Every straight building's face is split into floors and
// bays with a triangle across each bay (a formed one is drawn by its slab edges and the lines up it instead: `formed`); the plot is triangulated; roads, the buildable line and the DP widening are outlined.
// Edges in front are drawn in ink, edges behind faint (an invisible copy of the masses hides them from the ink pass).
//
// The edges are kept between changes: a change fades only the new ones in and the gone ones out (a soft cross-fade,
// under a second; nothing moves). Edges that stay are untouched. With reduced motion the change is simply made.
import * as THREE from 'three';
import type { PlotReport } from '../doc/plot';
import { elementRings, isArea, offsetSpine, POOL_DECK, type SiteReport } from '../doc/site';
import type { Shops } from './mixed';
import { featureOf, keptOf, levelAt, type Levels, type SiteFeature } from './siteObjects';
import { fromFlat, offset, outlines } from '../doc/ground';
import { frameOf, type FormLayout, type Roof, type Shell, type Skin } from './form';
import { canonical, canonOf, formMass, loftPair, roofLines } from './form/mesh';

type V3 = [number, number, number];
/** one edge: its ends, how strong (0 faint … 1 ink), and its animation */
interface Seg { k: string; a: V3; b: V3; w: number; born: number; delay: number; dur: number; dead: number; ddelay: number; out: number }
export interface WireData {
  r: PlotReport; d: SiteReport; roads: { pts: [number, number, number, number]; today: number }[]; shops?: Shops | null;
  /** obstructions and no-build zones, the plot's levels and where north is, the building picked */
  features?: SiteFeature[]; levels?: Levels; north?: number; sel?: string | null;
  /** the formed buildings' layouts by building id, and each one's skin, roof and shell */
  forms?: Record<string, FormLayout>;
  skinOf?: (id: string) => { skin: Skin; roof: Roof; shell: Shell | null };
}

/** Lines across a ring, `gap` apart, running along (dx, dz): a hatch, or contours. */
export function hatch(ring: number[], dx: number, dz: number, gap: number, at?: (t: number) => boolean): [number, number, number, number][] {
  const nx = -dz, nz = dx, out: [number, number, number, number][] = [];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < ring.length; i += 2) { const t = ring[i] * nx + ring[i + 1] * nz; lo = Math.min(lo, t); hi = Math.max(hi, t); }
  for (let t = Math.ceil(lo / gap) * gap; t < hi; t += gap) {
    if (at && !at(t)) continue;
    const xs: number[] = [];
    for (let i = 0; i < ring.length; i += 2) {
      const j = (i + 2) % ring.length, a = ring[i] * nx + ring[i + 1] * nz - t, b = ring[j] * nx + ring[j + 1] * nz - t;
      if ((a < 0) !== (b < 0)) { const u = a / (a - b), x = ring[i] + (ring[j] - ring[i]) * u, z = ring[i + 1] + (ring[j + 1] - ring[i + 1]) * u; xs.push(x * dx + z * dz); }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) out.push([nx * t + dx * xs[k], nz * t + dz * xs[k], nx * t + dx * xs[k + 1], nz * t + dz * xs[k + 1]]);
  }
  return out;
}

const BAY = 6;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
const hash = (x: number, y: number, z: number) => { const v = Math.sin(x * 12.99 + y * 78.23 + z * 37.72) * 43758.55; return v - Math.floor(v); };
/** fade edges in and out on a change (a soft cross-fade into the new geometry; nothing moves) */
const ANIMATE = true;
const reduced = () => !ANIMATE || matchMedia('(prefers-reduced-motion: reduce)').matches;

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

  // a low-poly tree: a trunk and a crown of six edges
  const tree = (x: number, z: number, cr: number, w: number) => {
    const h = Math.max(3, cr * 1.6), c = h * 0.62;
    add([x, 0, z], [x, h * 0.42, z], w);
    const top: V3 = [x, h, z], low: V3 = [x, h * 0.42, z], R: V3[] = [0, 1, 2, 3, 4].map((k) => { const a = (k / 5) * Math.PI * 2 + x; return [x + Math.cos(a) * cr, c, z + Math.sin(a) * cr]; });
    R.forEach((q, k) => { add(q, R[(k + 1) % 5], w); add(q, top, w * 0.8); add(q, low, w * 0.6); });
  };
  const line = (pts: number[], y: number, w: number) => { for (let i = 0; i + 3 < pts.length; i += 2) add([pts[i], y, pts[i + 1]], [pts[i + 2], y, pts[i + 3]], w); };
  const hatchIn = (rg: number[], w: number, gap = 2.5) => { for (const [ax, az, bx, bz] of hatch(rg, Math.SQRT1_2, Math.SQRT1_2, gap)) add([ax, 0.02, az], [bx, 0.02, bz], w); };

  // the site's own things: internal roads, roundabouts, gardens, lots, play areas, the trees planted
  const G = d.ground;
  for (const rd of G.roads) { line(offsetSpine(rd.pts, false, rd.w / 2), 0, 0.5); line(offsetSpine(rd.pts, false, -rd.w / 2), 0, 0.5); }
  for (const c of G.circles) { const [x, z, rr] = c; const pts: number[] = []; for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; pts.push(x + Math.cos(a) * rr, z + Math.sin(a) * rr); } ring(pts, 0, 0.5); }
  for (const gd of G.gardens) ring(gd, 0, 0.32, 0.5);
  for (const e of d.site.elements ?? []) {
    if (e.kind === 'road' || e.kind === 'roundabout' || e.kind === 'garden') continue;
    for (const rg of elementRings(e)) {
      ring(rg, 0, 0.55);
      if (e.kind === 'play') hatchIn(rg, 0.22, 1.6);
      if (e.kind === 'pool') for (const w of outlines(offset(fromFlat(rg), -POOL_DECK))) { ring(w, 0.12, 0.6); hatchIn(w, 0.12, 1.2); }
      if (e.kind === 'parking' && isArea(e)) { const top = (e.levels ?? 2) * 3; ring(rg, top, 0.55); for (let i = 0; i < rg.length; i += 2) add([rg[i], 0, rg[i + 1]], [rg[i], top, rg[i + 1]], 0.55); }
      if (e.kind === 'tank') { for (let i = 0; i < rg.length; i += 2) add([rg[i], 0, rg[i + 1]], [rg[i], 4, rg[i + 1]], 0.4); ring(rg, 4, 0.5); }
    }
  }

  // obstructions and no-build zones: each as itself, the ground kept clear round it dashed
  for (const f of v.features ?? []) {
    const F = featureOf(f.kind);
    for (const k of outlines(keptOf(f))) ring(k, 0, 0.42, 0.7);
    if (f.kind === 'tree' && f.pts.length >= 2) tree(f.pts[0], f.pts[1], f.r ?? F.r, 0.85);
    else if (f.kind === 'pole' && f.pts.length >= 2) { add([f.pts[0], 0, f.pts[1]], [f.pts[0], 9, f.pts[1]], 0.9); add([f.pts[0] - 1, 8.4, f.pts[1]], [f.pts[0] + 1, 8.4, f.pts[1]], 0.9); }
    else if (f.kind === 'well' && f.pts.length >= 2) { const pts: number[] = []; const rr = f.r ?? F.r; for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; pts.push(f.pts[0] + Math.cos(a) * rr, f.pts[1] + Math.sin(a) * rr); } ring(pts, 0, 0.85); ring(pts, 0.8, 0.85); }
    else if (f.kind === 'power') {
      // the wires at 10 m on towers every 30 m or so
      line(f.pts, 10, 0.85);
      for (let i = 0; i < f.pts.length; i += 2) add([f.pts[i], 0, f.pts[i + 1]], [f.pts[i], 10, f.pts[i + 1]], 0.85);
    } else if (f.pts.length >= 6) {
      ring(f.pts, 0, 0.9);
      if (f.kind === 'structure') { ring(f.pts, 4, 0.8); for (let i = 0; i < f.pts.length; i += 2) add([f.pts[i], 0, f.pts[i + 1]], [f.pts[i], 4, f.pts[i + 1]], 0.8); }
      if (f.kind === 'nobuild') hatchIn(f.pts, 0.4, 2);
      if (f.kind === 'water') for (const [ax, az, bx, bz] of hatch(f.pts, 1, 0, 1.4)) add([ax, 0.02, az], [bx, 0.02, bz], 0.3);
    }
  }

  // the plot's levels: a contour every 0.5 m across a sloping plot
  const L = v.levels;
  if (L && L.slope > 0.05 && r.net.length >= 6) {
    let cx = 0, cz = 0; for (let i = 0; i < r.net.length; i += 2) { cx += r.net[i]; cz += r.net[i + 1]; } cx /= r.net.length / 2; cz /= r.net.length / 2;
    const a = ((L.dir + (v.north ?? 0)) * Math.PI) / 180, fx = Math.sin(a), fz = -Math.cos(a);
    // (contours run across the fall; levelAt falls by slope% per metre along (fx, fz))
    const per = 0.5 / (L.slope / 100);
    void levelAt;
    for (const [ax, az, bx, bz] of hatch(r.net.map((q, i) => q - (i % 2 ? cz : cx)), -fz, fx, Math.max(0.6, per))) add([ax + cx, 0.01, az + cz], [bx + cx, 0.01, bz + cz], 0.26);
  }

  // the buildings: floors × bays, a triangle across each bay; the stilt as columns; the roof triangulated
  for (const b of d.buildings) {
    const pick = v.sel === b.b.id, kW = (w: number) => (pick ? Math.min(1, w * 1.9 + 0.15) : w);
    const FL = v.forms?.[b.b.id];
    if (FL && FL.floors.length) { formed(FL, b.b, v.skinOf?.(b.b.id) ?? null, add, kW); continue; }
    const top = y0 + b.floors * fh;
    const lv = [0]; if (y0 > 0) lv.push(y0); for (let f = 1; f < b.floors; f++) lv.push(y0 + f * fh); lv.push(top);
    for (const q of b.quads) {
      for (let i = 0; i < q.length; i += 2) {
        const j = (i + 2) % q.length, ax = q[i], az = q[i + 1], bx = q[j], bz = q[j + 1], L = Math.hypot(bx - ax, bz - az);
        if (L < 0.3) continue;
        const nb = Math.max(1, Math.round(L / BAY)), at = (s: number, y: number): V3 => [ax + ((bx - ax) * s) / nb, y, az + ((bz - az) * s) / nb];
        lv.forEach((y, n) => add(at(0, y), at(nb, y), kW(n === 0 || n === lv.length - 1 || y === y0 ? 1 : 0.42)));
        for (let n = 0; n < lv.length - 1; n++) for (let s = 0; s < nb; s++) {
          add(at(s, lv[n]), at(s, lv[n + 1]), kW(s === 0 ? 1 : 0.42));
          if (y0 > 0 && n === 0) continue; // (the stilt: open, just its columns)
          if ((s + n) % 2) add(at(s, lv[n]), at(s + 1, lv[n + 1]), kW(0.3)); else add(at(s + 1, lv[n]), at(s, lv[n + 1]), kW(0.3));
        }
      }
      tris(q, top, kW(0.35));
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
  /** the buildings as invisible solids: they hide the edges behind them, and are what a click picks */
  masses = new THREE.Group();
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
      s.dur = first ? 900 : 700;
      s.delay = red ? -1e9 : first ? (ground ? 0 : 120 + r * 280) : 120 + r * 120; void h;
    }
    const [dlo, dsp] = span(dying);
    for (const s of dying) { s.out = 550; s.ddelay = red ? -1e9 : 0; void dlo; void dsp; }
    this.segs = red ? out.filter((s) => !s.dead) : out;
    this.end = now;
    for (const s of this.segs) this.end = Math.max(this.end, s.dead ? s.dead + s.ddelay + s.out : s.born + s.delay + s.dur);
    // the masses that hide the edges behind them
    this.masses.traverse((o) => { if ((o as THREE.Mesh).geometry) (o as THREE.Mesh).geometry.dispose(); });
    this.masses.clear();
    const fh = v.r.rules.floorH, y0 = v.d.under * fh;
    for (const b of v.d.buildings) {
      const FL = v.forms?.[b.b.id];
      if (FL && FL.floors.length) { const m = new THREE.Mesh(formMass(FL), this.hide); m.userData.id = b.b.id; this.masses.add(m); continue; }
      const top = y0 + b.floors * fh;
      for (const q of b.quads) { const m = new THREE.Mesh(prism(q, 0, top), this.hide); m.userData.id = b.b.id; this.masses.add(m); }
      for (const c of b.cores) this.masses.add(new THREE.Mesh(prism(c, top, top + 2.4), this.hide));
    }
    this.write(now);
  }

  /** this frame's lines: settled edges as they are, fading ones part-way. Returns whether to keep going. */
  write(now = performance.now()): boolean {
    if (this.segs.length && now >= this.end && this.segs.some((s) => s.dead)) this.segs = this.segs.filter((s) => !s.dead);
    const n = this.segs.length, pos = new Float32Array(n * 6), col = new Float32Array(n * 6), dots: number[] = [];
    const c = new THREE.Color();
    let m = 0;
    for (const s of this.segs) {
      const u = s.dead ? 1 - clamp01((now - s.dead - s.ddelay) / s.out) : clamp01((now - s.born - s.delay) / s.dur);
      if (u <= 0) continue;
      // (a fade: the edge's colour eases from the paper to its ink, or back; on the page's paper that reads as opacity)
      const e = ease(u);
      c.copy(this.paper).lerp(this.inkC, (0.15 + 0.85 * s.w) * e);
      pos.set(s.a, m * 6); pos.set(s.b, m * 6 + 3);
      col.set([c.r, c.g, c.b, c.r, c.g, c.b], m * 6);
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

/** A formed building as lines: each floor's slab edge (every other floor past 40), lines up the corners and, on
 *  smooth stretches, every few metres (following the twist and the taper), the carves' corners, the shell's outline
 *  and the roof's edges. No bays and no triangles: a curved tower should read as calmly as it looks. */
function formed(L: FormLayout, b: { spine: number[] }, look: { skin: Skin; roof: Roof; shell: Shell | null } | null, add: (a: V3, b: V3, w: number) => void, kW: (w: number) => number) {
  const F = L.floors, C = canonOf(L), last = F.length - 1, every = F.length > 40 ? 2 : 1;
  const ring = (r: number[], y: number, w: number) => { for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; add([r[i], y, r[i + 1]], [r[j], y, r[j + 1]], w); } };
  const corner = (r: number[], i: number) => {
    const n = r.length / 2, p = (i - 1 + n) % n, q = (i + 1) % n;
    const ax = r[i * 2] - r[p * 2], az = r[i * 2 + 1] - r[p * 2 + 1], bx = r[q * 2] - r[i * 2], bz = r[q * 2 + 1] - r[i * 2 + 1];
    return (ax * bx + az * bz) / ((Math.hypot(ax, az) * Math.hypot(bx, bz)) || 1) < Math.cos((35 * Math.PI) / 180);
  };
  const dense = look && (look.skin.pattern === 'fins' || look.skin.pattern === 'curtain') ? 3 : 7.5;
  F.forEach((f, k) => {
    const yT = f.y + f.h, slab = (k === 0 || k % every === 0) && !f.void;
    C.floors[k].forEach((cr, i) => {
      if (slab) ring(cr.ring, f.y, kW(k === 0 ? 1 : 0.42));
      if (k === last) ring(cr.ring, yT, kW(1));
      // up the floor: the corners in ink, smooth stretches every few metres, faint (from this floor to the next)
      const { A, B } = k === last ? { A: cr.ring, B: cr.ring } : loftPair(C, k, i, f.h);
      const y1 = k === last ? yT : F[k + 1].y, n = A.length / 2;
      let run = 0, at = 0;
      for (let q = 0; q < n; q++) {
        const j = (q + 1) % n, L = Math.hypot(A[j * 2] - A[q * 2], A[j * 2 + 1] - A[q * 2 + 1]);
        if (corner(A, q)) { add([A[q * 2], f.y, A[q * 2 + 1]], [B[q * 2], y1, B[q * 2 + 1]], kW(0.85)); run = 0; }
        // (along the edge, a line every `dense` metres since the last one)
        while (run + L - at >= dense) { at += dense - run; run = 0; const t = at / (L || 1); add([A[q * 2] + (A[j * 2] - A[q * 2]) * t, f.y, A[q * 2 + 1] + (A[j * 2 + 1] - A[q * 2 + 1]) * t], [B[q * 2] + (B[j * 2] - B[q * 2]) * t, y1, B[q * 2 + 1] + (B[j * 2 + 1] - B[q * 2 + 1]) * t], kW(0.22)); }
        run += L - at; at = 0;
      }
    });
    // the carves' cut faces: their corners up the floor
    for (const c of f.cuts) for (let q = 0; q < c.ring.length; q += 2) add([c.ring[q], f.y, c.ring[q + 1]], [c.ring[q], yT, c.ring[q + 1]], kW(0.6));
  });
  // the shell: its outline at the start and past the roof, faint rings up it, its lines every few metres
  if (L.shell?.length && look?.shell) {
    const S = canonical(L.shell.map((r) => [r])), n = Math.min(L.shell.length, F.length), sh = look.shell;
    for (let k = 0; k < n; k++) {
      const cr = S.floors[k][0]; if (!cr) continue;
      const f = F[k], top = k === n - 1, y0 = Math.max(f.y, sh.under), y1 = top ? f.y + f.h + Math.max(0, sh.over) : F[k + 1].y;
      if (y1 <= y0) continue;
      if (k === 0 || f.y <= sh.under && y1 > sh.under) ring(cr.ring, y0, kW(0.8));
      else if (k % 4 === 0) ring(cr.ring, f.y, kW(0.2));
      const { A, B } = top ? { A: cr.ring, B: cr.ring } : loftPair(S, k, 0, f.h);
      if (top) ring(cr.ring, y1, kW(0.9));
      const m = A.length / 2, step = Math.max(1, Math.round(m / 16));
      const t0 = (y0 - f.y) / ((y1 - f.y) || 1);
      for (let q = 0; q < m; q += step) add([A[q * 2] + (B[q * 2] - A[q * 2]) * t0, y0, A[q * 2 + 1] + (B[q * 2 + 1] - A[q * 2 + 1]) * t0], [B[q * 2], y1, B[q * 2 + 1]], kW(0.5));
    }
  }
  // the roof's edges
  if (look && last >= 0) {
    const fr = frameOf(b), top = F[last], y0 = top.y + top.h;
    for (const cr of C.floors[last]) {
      if (cr.hole) continue;
      const l = roofLines(cr.ring, [], y0, look.roof, { u: fr.u, n: fr.n }, look.skin);
      for (let i = 0; i + 5 < l.length; i += 6) add([l[i], l[i + 1], l[i + 2]], [l[i + 3], l[i + 4], l[i + 5]], kW(0.8));
    }
  }
  // the cores' lift rooms over a flat roof
  if (!look || look.roof.kind === 'flat') {
    const y0 = F[last].y + F[last].h;
    for (const c of L.cores) { ring(c, y0 + 3, kW(0.7)); for (let i = 0; i < c.length; i += 2) add([c[i], y0, c[i + 1]], [c[i], y0 + 3, c[i + 1]], kW(0.6)); }
  }
}

/** a closed prism over a ring (x,z,…), for hiding */
function prism(ring: number[], y0: number, y1: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = []; for (let i = 0; i < ring.length; i += 2) pts.push(new THREE.Vector2(ring[i], ring[i + 1]));
  const pos: number[] = [], n = pts.length;
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; pos.push(a.x, y0, a.y, b.x, y0, b.y, b.x, y1, b.y, a.x, y0, a.y, b.x, y1, b.y, a.x, y1, a.y); }
  for (const [i, j, k] of THREE.ShapeUtils.triangulateShape(pts, [])) pos.push(pts[i].x, y1, pts[i].y, pts[k].x, y1, pts[k].y, pts[j].x, y1, pts[j].y);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); return g;
}
