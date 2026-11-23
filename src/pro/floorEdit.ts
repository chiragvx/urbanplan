// Editing a floor's plan by hand ("Edit this floor", docs/plans/pro-design-freedom.md §4.3): what a floor plan made by
// hand is (form/types.ts `FloorPlanEdit`), and the edits on it, all pure. A plan starts as a copy of the units the
// floor was laid out with, on the run of floors that share them; from then on the units are the designer's:
// - a corner dragged takes the same corner of every unit that shares it (a party wall moves for both flats);
// - a wall pushed out or in moves its two corners along its normal, shared corners with it;
// - a unit split in two across its length, two side by side merged into one, one taken away;
// - its use and type set (a 2 BHK, a shop), or left to its size.
// Lay it out again (`dropPlan`) and the floors go back to the planner's units.
import { area, union } from '../doc/ground';
import { mpOf, ringsOf } from './form/shape';
import { toLocal, type BuildingUse, type Form, type FloorPlanEdit, type FormLayout, type HandUnit } from './form';
import type { SiteBuilding } from '../doc/site';

const r2 = (v: number) => Math.round(v * 100) / 100;
let seq = 0;
const uid = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

/** the run of floors (1 up from the ground) that floor n shares its units with: same use, same units */
export function runOf(L: FormLayout, n: number): [number, number] {
  const F = L.floors, i = n - 1, sig = (k: number) => (F[k] && !F[k].void ? JSON.stringify([F[k].use, F[k].units.map((u) => [u.t, u.kind ?? '', u.ring.map(r2)])]) : null);
  const me = sig(i);
  if (me === null) return [n, n];
  let lo = i, hi = i;
  while (lo > 0 && sig(lo - 1) === me) lo--;
  while (hi < F.length - 1 && sig(hi + 1) === me) hi++;
  return [lo + 1, hi + 1];
}

/** a form with floors lo–hi planned by hand: their units as floor n has them now (taken into the building's frame);
 *  other plans over those floors give them up (trimmed, or dropped where nothing's left) */
export function startPlan(form: Form, b: Pick<SiteBuilding, 'spine'>, L: FormLayout, n: number, range?: [number, number]): Form {
  const [lo, hi] = range ?? runOf(L, n);
  const fl = L.floors[n - 1];
  const units: HandUnit[] = (fl?.units ?? []).map((u) => {
    const ring: number[] = [];
    for (let k = 0; k < u.ring.length; k += 2) { const [x, z] = toLocal(b, u.ring[k], u.ring[k + 1]); ring.push(r2(x), r2(z)); }
    return { id: uid('u'), ring, ...(u.kind ? { use: u.kind } : {}), t: u.t };
  });
  const plan: FloorPlanEdit = { id: uid('fp'), lo, hi, units };
  return { ...form, floorPlans: [plan, ...trimmed(form.floorPlans ?? [], lo, hi)] };
}
/** plans with floors lo–hi taken out of them */
function trimmed(plans: FloorPlanEdit[], lo: number, hi: number): FloorPlanEdit[] {
  const out: FloorPlanEdit[] = [];
  for (const p of plans) {
    if (p.hi < lo || p.lo > hi) { out.push(p); continue; }
    if (p.lo < lo) out.push({ ...p, hi: lo - 1 });
    if (p.hi > hi) out.push({ ...p, id: p.lo < lo ? uid('fp') : p.id, lo: hi + 1 });
  }
  return out;
}
/** the floors back to the planner's units */
export const dropPlan = (form: Form, id: string): Form => {
  const rest = (form.floorPlans ?? []).filter((p) => p.id !== id);
  const { floorPlans: _f, ...f } = form; void _f;
  return rest.length ? { ...f, floorPlans: rest } : f;
};
/** a plan's floors set (each kept between 1 and the floors there are, lo ≤ hi; others over them trimmed) */
export function setRange(form: Form, id: string, lo: number, hi: number, floors: number): Form {
  const p = form.floorPlans?.find((x) => x.id === id); if (!p) return form;
  const a = Math.max(1, Math.min(floors, Math.round(lo))), z = Math.max(a, Math.min(floors, Math.round(hi)));
  return { ...form, floorPlans: [{ ...p, lo: a, hi: z }, ...trimmed((form.floorPlans ?? []).filter((x) => x.id !== id), a, z)] };
}

const withPlan = (form: Form, id: string, fn: (p: FloorPlanEdit) => FloorPlanEdit): Form => ({ ...form, floorPlans: (form.floorPlans ?? []).map((p) => (p.id === id ? fn(p) : p)) });
const withUnits = (form: Form, id: string, fn: (us: HandUnit[]) => HandUnit[]): Form => withPlan(form, id, (p) => ({ ...p, units: fn(p.units) }));

/** corners closer than this (m) are one corner, shared */
const SAME = 0.05;
/** move every corner at (x0, z0) to (x, z): the unit's own and any other unit's that shares it */
function moveCorner(us: HandUnit[], x0: number, z0: number, x: number, z: number): HandUnit[] {
  return us.map((u) => {
    let hit = false;
    const ring = u.ring.slice();
    for (let k = 0; k < ring.length; k += 2) if (Math.hypot(ring[k] - x0, ring[k + 1] - z0) < SAME) { ring[k] = r2(x); ring[k + 1] = r2(z); hit = true; }
    return hit ? { ...u, ring } : u;
  });
}

/** corner i of a unit to (x, z), with every unit that shares it */
export function moveVertex(form: Form, plan: string, unit: string, i: number, x: number, z: number): Form {
  return withUnits(form, plan, (us) => {
    const u = us.find((q) => q.id === unit); if (!u) return us;
    return moveCorner(us, u.ring[i * 2], u.ring[i * 2 + 1], x, z);
  });
}

/** wall i of a unit (corner i to i + 1) pushed `d` m out (in, when negative) along its normal, shared corners with it */
export function pushWall(form: Form, plan: string, unit: string, i: number, d: number): Form {
  return withUnits(form, plan, (us) => {
    const u = us.find((q) => q.id === unit); if (!u) return us;
    const n = u.ring.length / 2, j = (i + 1) % n;
    const ax = u.ring[i * 2], az = u.ring[i * 2 + 1], bx = u.ring[j * 2], bz = u.ring[j * 2 + 1];
    const [nx, nz] = wallNormal(u.ring, i);
    let out = moveCorner(us, ax, az, ax + nx * d, az + nz * d);
    out = moveCorner(out, bx, bz, bx + nx * d, bz + nz * d);
    return out;
  });
}
/** the outward normal of wall i of a ring */
export function wallNormal(ring: number[], i: number): [number, number] {
  const n = ring.length / 2, j = (i + 1) % n;
  const dx = ring[j * 2] - ring[i * 2], dz = ring[j * 2 + 1] - ring[i * 2 + 1], L = Math.hypot(dx, dz) || 1;
  let s = 0; for (let k = 0; k < n; k++) { const q = (k + 1) % n; s += ring[k * 2] * ring[q * 2 + 1] - ring[q * 2] * ring[k * 2 + 1]; }
  // (counter-clockwise in x, z: outward is to the right of the way round)
  return s > 0 ? [dz / L, -dx / L] : [-dz / L, dx / L];
}

/** a ring cut by the line through (px, pz) across direction (dx, dz): the part on the side the direction points to,
 *  and the other */
function halves(ring: number[], px: number, pz: number, dx: number, dz: number): [number[], number[]] {
  const side = (x: number, z: number) => (x - px) * dx + (z - pz) * dz;
  const A: number[] = [], B: number[] = [], n = ring.length / 2;
  for (let k = 0; k < n; k++) {
    const q = (k + 1) % n, x0 = ring[k * 2], z0 = ring[k * 2 + 1], x1 = ring[q * 2], z1 = ring[q * 2 + 1];
    const s0 = side(x0, z0), s1 = side(x1, z1);
    if (s0 >= 0) A.push(x0, z0); if (s0 <= 0) B.push(x0, z0);
    if ((s0 > 0 && s1 < 0) || (s0 < 0 && s1 > 0)) { const t = s0 / (s0 - s1), x = r2(x0 + (x1 - x0) * t), z = r2(z0 + (z1 - z0) * t); A.push(x, z); B.push(x, z); }
  }
  return [A, B];
}

/** a unit split in two across its length (its longest wall's direction), at its middle; each half keeps its use
 *  and gets its type from its size */
export function splitUnit(form: Form, plan: string, unit: string): Form {
  return withUnits(form, plan, (us) => {
    const u = us.find((q) => q.id === unit); if (!u) return us;
    const n = u.ring.length / 2;
    let best = 0, dx = 1, dz = 0;
    for (let k = 0; k < n; k++) { const q = (k + 1) % n, ex = u.ring[q * 2] - u.ring[k * 2], ez = u.ring[q * 2 + 1] - u.ring[k * 2 + 1], L = Math.hypot(ex, ez); if (L > best) { best = L; dx = ex / L; dz = ez / L; } }
    // (the middle along that direction)
    let lo = Infinity, hi = -Infinity;
    for (let k = 0; k < n; k++) { const s = u.ring[k * 2] * dx + u.ring[k * 2 + 1] * dz; lo = Math.min(lo, s); hi = Math.max(hi, s); }
    const mid = (lo + hi) / 2, [a, b] = halves(u.ring, mid * dx, mid * dz, dx, dz);
    if (a.length < 6 || b.length < 6) return us;
    const { t: _t, ...rest } = u; void _t;
    return us.flatMap((q) => (q.id === unit ? [{ ...rest, ring: a }, { ...rest, id: uid('u'), ring: b }] : [q]));
  });
}

/** two units merged into one, when they touch (the first's use; its type from its size) */
export function mergeUnits(form: Form, plan: string, a: string, b: string): Form | null {
  const p = form.floorPlans?.find((x) => x.id === plan); if (!p) return null;
  const ua = p.units.find((q) => q.id === a), ub = p.units.find((q) => q.id === b); if (!ua || !ub || a === b) return null;
  const m = union(mpOf(ua.ring), mpOf(ub.ring)), rs = ringsOf(m);
  if (m.length !== 1 || !rs.length) return null; // (apart: nothing to merge)
  const ring = rs.sort((x, y) => Math.abs(area(mpOf(y))) - Math.abs(area(mpOf(x))))[0].map(r2);
  const { t: _t, ...rest } = ua; void _t;
  return withUnits(form, plan, (us) => us.filter((q) => q.id !== b).map((q) => (q.id === a ? { ...rest, ring } : q)));
}

export const removeUnit = (form: Form, plan: string, unit: string): Form => withUnits(form, plan, (us) => us.filter((q) => q.id !== unit));

/** a unit's use and type: a use (homes, shops…) and for homes a type (0 1 BHK, 1 2 BHK, 2 3 BHK); unset: by size */
export function setUnit(form: Form, plan: string, unit: string, use: BuildingUse | undefined, t?: 0 | 1 | 2 | 3): Form {
  return withUnits(form, plan, (us) => us.map((q) => {
    if (q.id !== unit) return q;
    const { use: _u, t: _t, ...rest } = q; void _u; void _t;
    return { ...rest, ...(use ? { use } : {}), ...(t !== undefined ? { t } : {}) };
  }));
}

/** a point snapped: to a corner of another unit within `near` m, else to `grid` */
export function snapTo(units: HandUnit[], skip: { unit: string; i: number } | null, x: number, z: number, near = 0.4, grid = 0.1): [number, number] {
  let best: [number, number] | null = null, bd = near;
  for (const u of units) for (let k = 0; k < u.ring.length; k += 2) {
    if (skip && u.id === skip.unit && k === skip.i * 2) continue;
    const d = Math.hypot(u.ring[k] - x, u.ring[k + 1] - z);
    if (d < bd) { bd = d; best = [u.ring[k], u.ring[k + 1]]; }
  }
  return best ?? [Math.round(x / grid) * grid, Math.round(z / grid) * grid];
}

/** a unit's middle (the average of its corners) and its area (m²) */
export function unitMid(u: HandUnit): { x: number; z: number; area: number } {
  let x = 0, z = 0; const n = u.ring.length / 2;
  for (let k = 0; k < n; k++) { x += u.ring[k * 2]; z += u.ring[k * 2 + 1]; }
  return { x: x / n, z: z / n, area: Math.abs(area(mpOf(u.ring))) };
}
