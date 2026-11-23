// The form cut into floors: the uses stacked into floors and heights, and each floor's plan blended from the key
// floors (scaled, shifted, turned, or its own plan) with the carves cut out of it. All in local metres; the
// layout (./lay.ts) turns them to world metres at the very end, since a turn and a move change no area.
import { sampleCurve } from './curve';
import { USE_TABLE } from '../../doc/uses';
import { USE_INFO, type BuildingUse, type Carve, type Curve, type Form, type FormContext, type KeyFloor } from './types';

/** how finely curves are sampled (m): fine enough to read as smooth in 3D, coarse enough to stay quick */
export const STEP = 1.5;

/** The floors from the ground up: each one's use and floor to floor. Homes take the design system's floor to
 *  floor; the other uses their own. `total` (the building's floors, when set) wins over the bands: the top band
 *  grows or loses floors to match, so the engine's floors and the form's always agree. */
export function floorsOf(form: Form, total: number, ctx: FormContext): { use: BuildingUse; h: number }[] {
  const bands = form.uses.filter((u) => u.floors > 0).map((u) => ({ ...u, floors: Math.round(u.floors) }));
  if (!bands.length) bands.push({ use: 'residential', floors: Math.max(1, Math.round(total) || 1) });
  let sum = bands.reduce((s, u) => s + u.floors, 0);
  const want = total > 0 ? Math.round(total) : sum;
  while (sum > want && bands.length) {
    const top = bands[bands.length - 1], cut = Math.min(top.floors, sum - want);
    top.floors -= cut; sum -= cut;
    if (!top.floors) bands.pop();
  }
  if (sum < want) {
    if (bands.length) bands[bands.length - 1].floors += want - sum;
    else bands.push({ use: 'residential', floors: want });
  }
  const out: { use: BuildingUse; h: number }[] = [];
  for (const u of bands) {
    const h = u.floorH && u.floorH > 1.8 ? u.floorH : USE_TABLE[u.use].dsFloor ? ctx.floorH || USE_INFO[u.use].floorH : USE_INFO[u.use].floorH;
    for (let i = 0; i < u.floors; i++) out.push({ use: u.use, h });
  }
  return out;
}

// ---------------- key floors ----------------

const IDENTITY: KeyFloor = { t: 0, sx: 1, sz: 1, dx: 0, dz: 0, rot: 0 };

/** The key floors in order, with the plan as drawn standing in at the ground when no key is there. */
export function keysOf(form: Form): KeyFloor[] {
  const k = form.keys.filter((x) => Number.isFinite(x.t)).slice().sort((a, b) => a.t - b.t);
  if (!k.length || k[0].t > 1e-6) k.unshift(IDENTITY);
  return k;
}

/** How much each key floor counts at height t. Linear: the two either side. Smooth: a cubic through the key values
 *  (Catmull-Rom tangents over uneven spacing), so an S silhouette runs smooth through its keys. Two keys almost on
 *  top of each other are a step (a setback), so the stretch between them stays straight and their tangents flat. */
export function weights(ts: number[], t: number, smooth: boolean): Float64Array {
  const n = ts.length, w = new Float64Array(n);
  if (n === 1 || t <= ts[0]) { w[0] = 1; return w; }
  if (t >= ts[n - 1]) { w[n - 1] = 1; return w; }
  let k = 0;
  while (k < n - 2 && t > ts[k + 1]) k++;
  const h = ts[k + 1] - ts[k];
  if (h < 1e-9) { w[k + 1] = 1; return w; }
  const s = (t - ts[k]) / h;
  const STEPPED = 0.02;
  if (!smooth || h < STEPPED) { w[k] = 1 - s; w[k + 1] = s; return w; }
  const s2 = s * s, s3 = s2 * s;
  w[k] += 2 * s3 - 3 * s2 + 1;
  w[k + 1] += -2 * s3 + 3 * s2;
  // a key's tangent as weights of its neighbours' values
  const tangent = (i: number, f: number) => {
    const lo = i > 0 ? i - 1 : i, hi = i < n - 1 ? i + 1 : i;
    if ((i > 0 && ts[i] - ts[i - 1] < STEPPED) || (i < n - 1 && ts[i + 1] - ts[i] < STEPPED)) return;
    const d = ts[hi] - ts[lo];
    if (d < 1e-9) return;
    w[hi] += f / d; w[lo] -= f / d;
  };
  tangent(k, (s3 - 2 * s2 + s) * h);
  tangent(k + 1, (s3 - s2) * h);
  return w;
}

/** A floor's transform: scale, then turn (radians), then shift, all about the local origin. */
export interface Xf { sx: number; sz: number; dx: number; dz: number; rot: number }
export const applyXf = (r: number[], x: Xf): number[] => {
  const c = Math.cos(x.rot), s = Math.sin(x.rot), o: number[] = new Array(r.length);
  for (let i = 0; i < r.length; i += 2) {
    const px = r[i] * x.sx, pz = r[i + 1] * x.sz;
    o[i] = px * c - pz * s + x.dx; o[i + 1] = px * s + pz * c + x.dz;
  }
  return o;
};

/** What each floor's plan is: the transform and the curve. Plans sampled once per distinct curve. */
export class Planner {
  keys: KeyFloor[];
  ts: number[];
  smooth: boolean;
  /** whether the keys carry plans of their own, and whether those can be blended point by point */
  plans: boolean; blend: boolean;
  private cache = new Map<string, number[]>();
  constructor(public form: Form, public round: number) {
    this.keys = keysOf(form);
    this.ts = this.keys.map((k) => k.t);
    this.smooth = form.ease === 'smooth';
    this.plans = this.keys.some((k) => k.plan && k.plan.pts.length >= 3);
    const n = form.plan.pts.length;
    this.blend = this.plans && this.keys.every((k) => !k.plan || k.plan.pts.length === n);
  }
  sample(c: Curve): number[] {
    const key = JSON.stringify(c);
    let r = this.cache.get(key);
    if (!r) { r = sampleCurve(c, STEP, this.round); this.cache.set(key, r); }
    return r;
  }
  /** the transform, the plan (sampled, before the transform) and a signature: two floors with the same signature
   *  are the same floor */
  at(t: number): { xf: Xf; plan: number[]; sig: string } {
    const w = weights(this.ts, t, this.smooth);
    let sx = 0, sz = 0, dx = 0, dz = 0, rot = 0;
    this.keys.forEach((k, i) => { sx += w[i] * k.sx; sz += w[i] * k.sz; dx += w[i] * k.dx; dz += w[i] * k.dz; rot += w[i] * k.rot; });
    const xf: Xf = { sx: Math.max(0.05, sx), sz: Math.max(0.05, sz), dx, dz, rot: (rot * Math.PI) / 180 };
    let plan: number[], psig = '';
    if (!this.plans) plan = this.sample(this.form.plan);
    else if (this.blend) {
      // the key plans blended point by point (a key without a plan of its own counts as the plan drawn)
      const base = this.form.plan.pts, pts = base.map(() => [0, 0] as [number, number]);
      this.keys.forEach((k, i) => {
        if (!w[i]) return;
        const src = k.plan ? k.plan.pts : base;
        for (let j = 0; j < pts.length; j++) { pts[j][0] += w[i] * src[j][0]; pts[j][1] += w[i] * src[j][1]; }
      });
      const c: Curve = { pts, sharp: this.form.plan.sharp };
      plan = sampleCurve(c, STEP, this.round);
      psig = pts.map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).join(';');
    } else {
      // plans that can't blend: the nearest key's
      let bi = 0;
      for (let i = 1; i < w.length; i++) if (w[i] > w[bi]) bi = i;
      plan = this.sample(this.keys[bi].plan ?? this.form.plan);
      psig = String(bi);
    }
    const sig = `${xf.sx.toFixed(4)}|${xf.sz.toFixed(4)}|${dx.toFixed(3)}|${dz.toFixed(3)}|${xf.rot.toFixed(5)}|${psig}`;
    return { xf, plan, sig };
  }
  /** the carves cutting a floor at height t: each one's ring, moved along its path and then by the floor's own
   *  transform, so a cut keeps its place on the facade as the floors taper, lean or twist */
  carvesAt(t: number, xf: Xf): { c: Carve; ring: number[]; sig: string }[] {
    const out: { c: Carve; ring: number[]; sig: string }[] = [];
    for (const c of this.form.carves) {
      const lo = Math.min(c.from, c.to), hi = Math.max(c.from, c.to);
      if (c.off || t < lo - 1e-6 || t > hi + 1e-6 || c.ring.pts.length < 3) continue;
      const [ddx, ddz] = drift(c.path, t);
      const r = this.sample(c.ring).slice();
      for (let i = 0; i < r.length; i += 2) { r[i] += ddx; r[i + 1] += ddz; }
      out.push({ c, ring: applyXf(r, xf), sig: `${c.id}:${ddx.toFixed(3)},${ddz.toFixed(3)}` });
    }
    return out;
  }
}

/** a carve's drift at height t: straight between its path's points (so a zig-zag stays a zig-zag), held past the ends */
export function drift(path: Carve['path'], t: number): [number, number] {
  if (!path || !path.length) return [0, 0];
  const p = path.slice().sort((a, b) => a.t - b.t);
  if (t <= p[0].t) return [p[0].dx, p[0].dz];
  for (let i = 0; i + 1 < p.length; i++) {
    const a = p[i], b = p[i + 1];
    if (t <= b.t) { const s = b.t - a.t > 1e-9 ? (t - a.t) / (b.t - a.t) : 1; return [a.dx + (b.dx - a.dx) * s, a.dz + (b.dz - a.dz) * s]; }
  }
  const z = p[p.length - 1];
  return [z.dx, z.dz];
}
