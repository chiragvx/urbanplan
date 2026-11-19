// The form laid out floor by floor: the procedure everything else reads (the 3D, the wireframe, the money, the
// rules). It runs on every edit for every building, so it works in local metres, does the polygon booleans only
// where a floor differs from the one below, and remembers its last few answers.
import { area, diff, inter, offset, union, type MP } from '../../doc/ground';
import type { SiteBuilding } from '../../doc/site';
import { bbox, ccw, edgeDist, grownRing, inRings, ringArea, selfCrosses } from './curve';
import { applyXf, floorsOf, Planner } from './slice';
import { mpOf, outerOf, ringsOf } from './shape';
import { coreNeed, edgeColumns, gridColumns, overhang, placeCores } from './skeleton';
import { CORRIDOR, planUnits, type Unit } from './units';
import type { BuildingUse, Form, FormContext, FormFloor, FormIssue, FormLayout, Pt } from './types';

/** a floor standing out past the one below by more than this (m) is a deep cantilever */
const CANTILEVER = 6;
/** a roof steeper than this (degrees), or a barrel or dome rising more than this share of its span, is flagged */
const STEEP = 60, TALL_ROOF = 0.6;

interface Local {
  level: number; use: BuildingUse; y: number; h: number; t: number;
  sig: string;
  outer: number[];
  shape: MP;
  rings: number[][];
  area: number;
  cuts: { ring: number[]; face: 'glass' | 'open' }[];
  rot: number;
  same: boolean;
}

/** Whether rings `a` lie inside rings `b` (to within a few centimetres): every corner of a in b, and no corner of
 *  b poking into a. Cheap next to a boolean, and it lets most tapers and setbacks skip theirs. */
function within(a: number[][], b: number[][], tol = 0.05): boolean {
  for (const r of a) for (let i = 0; i < r.length; i += 2) if (!inRings(b, r[i], r[i + 1]) && edgeDist(b, r[i], r[i + 1]) > tol) return false;
  for (const r of b) for (let i = 0; i < r.length; i += 2) if (inRings(a, r[i], r[i + 1]) && edgeDist(a, r[i], r[i + 1]) > tol) return false;
  return true;
}

const nameOf = (level: number) => (level === 0 ? 'The ground floor' : `Floor ${level}`);
const span = (levels: number[]) => {
  if (levels.length === 1) return nameOf(levels[0]);
  const a = levels[0], b = levels[levels.length - 1];
  return b - a === levels.length - 1 ? `Floors ${a}–${b}` : `${levels.length} floors`;
};

export function lay(b: SiteBuilding & { form?: Form }, ctx: FormContext): FormLayout | null {
  const form = b.form;
  if (!form || !form.plan || form.plan.pts.length < 3) return null;
  const round = Math.max(0, Math.min(1, form.round ?? ctx.round ?? 0));
  const stack = floorsOf(form, b.floors, ctx);
  const N = stack.length;
  if (!N) return null;
  const P = new Planner(form, round);
  const base = P.sample(form.plan);
  if (base.length < 6 || Math.abs(ringArea(base)) < 1) return null;
  const issues: FormIssue[] = [];
  if (selfCrosses(base) || P.keys.some((k) => k.plan && selfCrosses(P.sample(k.plan)))) issues.push({ key: 'cross', tone: 'warn', text: 'The plan crosses itself: its floors are read as the area it encloses.' });

  // ---- every floor's slab, local ----
  const L: Local[] = [];
  let y = 0;
  const split: number[] = [], empty: number[] = [];
  for (let level = 0; level < N; level++) {
    const t = N > 1 ? level / (N - 1) : 0, { use, h } = stack[level];
    const { xf, plan, sig: psig } = P.at(t);
    const carves = P.carvesAt(t, xf);
    const sig = psig + '#' + carves.map((c) => c.sig).join(',');
    const prev = L[level - 1];
    if (prev && prev.sig === sig) {
      L.push({ ...prev, level, use, y, h, t, same: true });
      y += h;
      continue;
    }
    const outer = ccw(applyXf(plan, xf));
    // (a plan drawn crossing itself is read as what it encloses, so everything after stays sane)
    let shape: MP = selfCrosses(outer) ? union(mpOf(outer)) : mpOf(outer);
    const cuts: Local['cuts'] = [];
    if (carves.length) {
      const holes = carves.map((c) => mpOf(ccw(c.ring)));
      const before = shape;
      shape = diff(shape, ...holes);
      carves.forEach((c, i) => { for (const r of ringsOf(inter(before, holes[i]))) if (ringArea(r) > 0) cuts.push({ ring: r, face: c.c.face }); });
      if (shape.length > before.length) split.push(level);
    }
    const A = area(shape);
    if (A < 1) empty.push(level);
    L.push({ level, use, y, h, t, sig, outer, shape, rings: ringsOf(shape), area: A, cuts, rot: xf.rot, same: false });
    y += h;
  }
  const height = y;
  if (split.length) issues.push({ key: 'split', tone: 'warn', text: `${span(split)}: the cut splits the floor in two.` });
  if (empty.length) issues.push({ key: 'empty', tone: 'fail', text: `${span(empty)}: nothing is left of the floor.` });

  // the distinct floors (a run of the same floor counted once)
  const distinct = L.filter((f) => !f.same && f.area >= 1);
  if (!distinct.length) return null;

  // ---- the volume from above, and the ground every floor shares ----
  // (a floor inside one already counted adds nothing; the rest unioned in pairs, up a tree, since one union of
  // sixty twisted floors that all cross each other is far slower)
  const kept: Local[] = [];
  for (const f of distinct.slice().sort((a, b) => b.area - a.area)) if (!kept.some((k) => within(f.rings, k.rings))) kept.push(f);
  let parts: MP[] = kept.map((f) => mpOf(f.outer));
  while (parts.length > 1) {
    const next: MP[] = [];
    for (let i = 0; i < parts.length; i += 2) next.push(i + 1 < parts.length ? union(parts[i], parts[i + 1]) : parts[i]);
    parts = next;
  }
  const outlineMP = parts.length ? union(parts[0]) : [];
  const outlineLocal = outerOf(outlineMP);
  // the common ground: the floors intersected in turn, smallest first so it shrinks fastest (one union of them all
  // is far slower when a twist makes every floor cross every other)
  let common: MP = distinct[0].shape;
  if (distinct.length > 1) {
    const order = distinct.slice().sort((a, b) => a.area - b.area);
    common = order[0].shape;
    for (let i = 1; i < order.length && common.length; i++) {
      // (nothing to cut when what's common so far lies inside this floor, give or take 0.3 m: the core keeps a
      // metre clear of it anyway, and a smooth S or twist is then cut by a handful of its floors, not all of them)
      const cr = ringsOf(common);
      if (!within(cr, order[i].rings, 0.3)) common = inter(common, order[i].shape);
    }
  }
  const commonIn = offset(common, -1);

  // ---- cores ----
  const houses = Math.max(0, Math.round(form.houses ?? 0));
  const need = coreNeed(L.map((f) => ({ use: f.use, area: f.area })), height, houses > 0);
  const smallest = distinct.reduce((a, f) => (f.area < a.area ? f : a), distinct[0]);
  const placed = placeCores(commonIn, outlineLocal, need, offset(smallest.shape, -0.5));
  if (need.area && !placed.fit) issues.push({ key: 'core', tone: 'warn', text: 'No room for a core straight through every floor: it is drawn on the smallest floor.' });
  if (need.area && !placed.covered) issues.push({ key: 'travel', tone: 'warn', text: 'Parts of the floors are more than 30 m from a stair.' });
  const coreArea = placed.cores.reduce((s, c) => s + Math.abs(ringArea(c)), 0);
  if (coreArea) {
    const small = L.filter((f) => f.area >= 1 && f.area < coreArea * 1.5).map((f) => f.level);
    if (small.length) issues.push({ key: 'small', tone: 'warn', text: `${span(small)}: hardly bigger than the core.` });
  }
  const corridor: MP = placed.cores.length ? union(...placed.cores.map((c) => offset(mpOf(c), CORRIDOR))) : [];

  // ---- columns ----
  const axisU: Pt = (() => { const b0 = bbox(outlineLocal); return b0[2] - b0[0] >= b0[3] - b0[1] ? [1, 0] : [0, 1]; })();
  const grid = houses ? [] : gridColumns(commonIn, axisU, placed.centres[0] ?? [0, 0], placed.cores);
  // (along the outline as drawn and round any court, not along a slot's faces: a column there would jump about
  // with every zig of the slot)
  const posts = edgeColumns(L.map((f) => ({ edge: [f.outer, ...f.rings.filter((r) => ringArea(r) < 0)], rings: f.rings, same: f.same })), grid);
  const transfers = posts.filter((p) => p.transfer).length;
  if (transfers) issues.push({ key: 'transfer', tone: 'info', text: `${transfers} column${transfers > 1 ? 's' : ''} start${transfers > 1 ? '' : 's'} on a floor below, on transfer beams.` });

  // ---- over and terrace, the cantilevers ----
  let worst = 0, worstAt = 0;
  const over: number[] = [], terrace: number[] = [];
  for (let i = 0; i < N; i++) {
    const f = L[i], g = L[i - 1];
    if (!g || f.same) { over.push(0); terrace.push(0); continue; }
    const I = !f.area || !g.area ? 0 : within(f.rings, g.rings) ? f.area : within(g.rings, f.rings) ? g.area : area(inter(f.shape, g.shape));
    over.push(Math.max(0, f.area - I)); terrace.push(Math.max(0, g.area - I));
    if (f.area - I > 1) { const d = overhang(f.outer, g.outer); if (d > worst) { worst = d; worstAt = i; } }
  }
  if (worst > CANTILEVER) issues.push({ key: 'cantilever', tone: 'warn', text: `${nameOf(worstAt)} stands out ${worst.toFixed(1)} m past the floor below: a deep cantilever.` });

  // ---- units, floor by floor (a floor like the one below has the same units) ----
  const placedT = [0, 0, 0];
  const unitsOf: Unit[][] = [];
  for (let i = 0; i < N; i++) {
    const f = L[i];
    if (f.same && L[i - 1].use === f.use) {
      const u = unitsOf[i - 1];
      for (const x of u) if (x.t < 3) placedT[x.t]++;
      unitsOf.push(u);
      continue;
    }
    unitsOf.push(planUnits(f.shape, f.use, placed.cores, corridor, placed.centres, ctx, placedT, houses, f.outer));
  }

  // ---- the roof ----
  const top = L[N - 1], roof = form.roof;
  const rdir = ((roof.dir || 0) * Math.PI) / 180 + top.rot;
  const fd: Pt = [Math.cos(rdir), Math.sin(rdir)];
  let a0 = Infinity, a1 = -Infinity, c0 = Infinity, c1 = -Infinity;
  for (let i = 0; i < top.outer.length; i += 2) {
    const a = top.outer[i] * fd[0] + top.outer[i + 1] * fd[1], c = -top.outer[i] * fd[1] + top.outer[i + 1] * fd[0];
    a0 = Math.min(a0, a); a1 = Math.max(a1, a); c0 = Math.min(c0, c); c1 = Math.max(c1, c);
  }
  const along = a1 - a0 + 2 * (roof.overhang || 0), across = c1 - c0 + 2 * (roof.overhang || 0), tan = Math.tan((Math.min(85, Math.max(0, roof.pitch)) * Math.PI) / 180);
  const rise = roof.kind === 'flat' ? Math.max(0, roof.parapet ?? 0)
    : roof.kind === 'mono' || roof.kind === 'tilted' ? along * tan
    : roof.kind === 'gable' ? (along / 2) * tan
    : roof.kind === 'hip' ? (Math.min(along, across) / 2) * tan
    : roof.kind === 'barrel' ? Math.min(1, Math.max(0, roof.pitch)) * along
    : Math.min(1, Math.max(0, roof.pitch)) * Math.min(along, across);
  if ((['mono', 'gable', 'hip', 'tilted'].includes(roof.kind) && roof.pitch > STEEP) || (['barrel', 'dome', 'crown'].includes(roof.kind) && roof.pitch > TALL_ROOF)) {
    issues.push({ key: 'roof', tone: 'warn', text: 'The roof is very steep: hard to build and to keep watertight.' });
  }
  const roofRing = roof.overhang > 0 ? outerOf(offset(mpOf(top.outer), roof.overhang)) : top.outer;
  let topY = height + rise;

  // ---- the shell ----
  let shellLocal: number[][] | null = null, shellY: [number, number] | undefined;
  if (form.shell) {
    const s = form.shell, cache = new Map<string, number[]>();
    shellLocal = L.map((f) => {
      let r = cache.get(f.sig);
      if (!r) { r = s.offset ? grown(f.outer, s.offset) : f.outer; cache.set(f.sig, r); }
      return r;
    });
    shellY = [Math.max(0, s.under || 0), height + Math.max(0, s.over || 0)];
    topY = Math.max(topY, shellY[1]);
  }

  // ---- to the world ----
  const s = b.spine, ox = s[0] ?? 0, oz = s[1] ?? 0;
  let ux = (s[2] ?? ox + 1) - ox, uz = (s[3] ?? oz) - oz;
  const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
  const W = (r: number[]): number[] => {
    const o = new Array(r.length);
    for (let i = 0; i < r.length; i += 2) { o[i] = ox + r[i] * ux - r[i + 1] * uz; o[i + 1] = oz + r[i] * uz + r[i + 1] * ux; }
    return o;
  };
  const Wp = (x: number, z: number): Pt => [ox + x * ux - z * uz, oz + x * uz + z * ux];
  // (a floor like the one below shares its world rings too)
  const floors: FormFloor[] = [];
  for (let i = 0; i < N; i++) {
    const f = L[i], prev = floors[i - 1];
    const units = unitsOf[i].map((u) => ({ t: u.t, ring: W(u.ring), carpet: u.carpet }));
    const shared = f.same && prev;
    floors.push({
      level: i, y: f.y, h: f.h, use: f.use,
      outer: shared ? prev.outer : W(f.outer),
      rings: shared ? prev.rings : f.rings.map(W),
      area: f.area,
      cuts: shared ? prev.cuts : f.cuts.map((c) => ({ ring: W(c.ring), face: c.face })),
      units, carpet: units.reduce((a, u) => a + u.carpet, 0),
      over: over[i], terrace: terrace[i],
    });
  }
  const outline = W(outlineLocal);
  return {
    floors, outline,
    cores: placed.cores.map(W),
    columns: [...grid.map(([x, z]) => Wp(x, z)), ...posts.map((p) => Wp(p.x0, p.z0))],
    transfers,
    shell: shellLocal ? shellLocal.map(W) : null,
    top: topY,
    issues,
    core: { stairs: need.stairs ? Math.max(need.stairs, placed.cores.length) : 0, lifts: need.lifts, area: coreArea },
    posts: [
      ...grid.map(([x, z]) => { const [X, Z] = Wp(x, z); return { x0: X, z0: Z, x1: X, z1: Z, from: 0, to: N - 1, transfer: false }; }),
      ...posts.map((p) => { const [X0, Z0] = Wp(p.x0, p.z0), [X1, Z1] = Wp(p.x1, p.z1); return { x0: X0, z0: Z0, x1: X1, z1: Z1, from: p.from, to: p.to, transfer: p.transfer }; }),
    ],
    shellY,
    roof: { ring: W(roofRing), y: height, rise, dir: [fd[0] * ux - fd[1] * uz, fd[0] * uz + fd[1] * ux] },
  };
}

/** a ring grown by d: each corner pushed out along its bisector (quick, and exact enough for a shell's stand-off
 *  round a smooth plan); Clipper's rounded offset when that would cross itself (a tight inside corner) */
function grown(r: number[], d: number): number[] {
  const g = grownRing(r, d);
  return selfCrosses(g) ? outerOf(offset(mpOf(r), d)) : g;
}

// ---------------- remembered ----------------

const memo = new Map<string, FormLayout | null>();
const MEMO = 64;

/** The layout, remembered on everything it reads (the form, where it stands, its floors, the project's numbers). */
export function layMemo(b: SiteBuilding & { form?: Form }, ctx: FormContext): FormLayout | null {
  if (!b.form) return null;
  const key = JSON.stringify([b.form, b.spine, b.floors, ctx.floorH, ctx.mix, ctx.sizes, ctx.round ?? null]);
  const hit = memo.get(key);
  if (hit !== undefined) { memo.delete(key); memo.set(key, hit); return hit; }
  let out: FormLayout | null;
  try { out = lay(b, ctx); } catch (e) { console.warn('form layout failed', e); out = null; }
  memo.set(key, out);
  if (memo.size > MEMO) memo.delete(memo.keys().next().value!);
  return out;
}

