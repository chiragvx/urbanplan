// A form's parts (docs/plans/pro-design-freedom.md step 3): prisms that add to, cut out of or trim the floors they
// span, in order, over the plan drawn. Stored as the form's `carves` (older forms' carves are all cuts), so old
// projects load as they were. Here: their names, their heights as floors, and the new parts the Parts list adds.
import { opOf, partSpan, sampleCurve, USE_INFO, type BuildingUse, type Carve, type Curve, type Form, type PartOp, type Pt, type Space } from './form';
import { slotCarve } from './silhouette';
import { toLocal, toWorld } from './form';
import { drawnPlan, shapePlan, type MassShape } from './masses';
import type { ProBuilding } from './project';

/** the four booleans, in the order a CAD lists them */
export const OPS: PartOp[] = ['add', 'cut', 'keep', 'xor'];
export const OP_LABEL: Record<PartOp, string> = { add: 'Add', cut: 'Cut', keep: 'Intersect', xor: 'Exclude' };
export const OP_ICON: Record<PartOp, string> = { add: 'plus', cut: 'minus', keep: 'intersect', xor: 'exclude' };
export const OP_TIP: Record<PartOp, string> = {
  add: 'Union: adds to the floors it spans (a podium, a wing, a bridge)',
  cut: 'Subtract: cuts out of the floors it spans (a slot, a notch, a void, a round hole)',
  keep: 'Intersect: keeps only what lies inside it on the floors it spans (trims the form to it)',
  xor: 'Exclude: what either has but not both: the overlap cut out, the rest of it added',
};

/** a part's name in the list: its own, else what it does and its place among those that do the same */
export function partName(f: Form, c: Carve): string {
  if (c.name) return c.name;
  const op = opOf(c), same = f.carves.filter((x) => opOf(x) === op && !x.name), i = same.indexOf(c);
  const base = op === 'add' ? 'Block' : op === 'keep' ? 'Trim' : op === 'xor' ? 'Exclusion' : c.path?.length ? 'Slot' : 'Cut';
  return same.length > 1 ? `${base} ${i + 1}` : base;
}

/** the form's floors, counted from its uses */
export const floorsOfForm = (f: Form) => Math.max(1, f.uses.reduce((s, u) => s + u.floors, 0));
/** a height (0 the lowest floor … 1 the top) as a floor, 1 the lowest, and back */
export const floorOfT = (t: number, n: number) => (n <= 1 ? 1 : Math.round(Math.max(0, Math.min(1, t)) * (n - 1)) + 1);
// (exactly as the layout counts a floor's height, level / (floors − 1), so the floor named is the floor spanned)
export const tOfFloor = (k: number, n: number) => (n <= 1 ? 0 : (Math.round(Math.max(1, Math.min(n, k))) - 1) / (n - 1));

const id = () => `p${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
const r2 = (v: number) => Math.round(v * 100) / 100;
const box = (x0: number, z0: number, x1: number, z1: number): { pts: Pt[] } => { const [a, b, c, d] = [x0, z0, x1, z1].map(r2); return { pts: [[a, b], [c, b], [c, d], [a, d]] }; };
function bounds(f: Form) {
  const p = sampleCurve(f.plan, 1.5);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i + 1 < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
  return { x0, x1, z0, z1, w: x1 - x0, d: z1 - z0 };
}

export type NewPart = 'block' | 'wing' | 'cut' | 'slot' | 'trim';
export const NEW_PARTS: { kind: NewPart; label: string; icon: string; tip: string }[] = [
  { kind: 'block', label: 'A podium', icon: 'slab', tip: 'A wider block under the lower floors' },
  { kind: 'wing', label: 'A wing', icon: 'lshape', tip: 'A block beside it, a few floors high' },
  { kind: 'cut', label: 'A cut', icon: 'minus', tip: 'A notch cut out of a corner, all the way up' },
  { kind: 'slot', label: 'A slot', icon: 'slot', tip: 'A glazed slot zig-zagging up the front' },
  { kind: 'trim', label: 'A trim', icon: 'circle', tip: 'Keep only what lies in an oval: rounds the form off' },
];

/** a new part of a kind, sized to the plan, kept to its floors */
export function newPart(f: Form, kind: NewPart): Carve {
  const c = shapedPart(f, kind), n = floorsOfForm(f), [lo, hi] = partSpan(c, n);
  return { ...c, lo, hi };
}
function shapedPart(f: Form, kind: NewPart): Carve {
  const b = bounds(f), n = floorsOfForm(f);
  const low = tOfFloor(Math.max(1, Math.min(n, Math.round(n * 0.2) || 1)), n);
  if (kind === 'slot') return { ...slotCarve(f), id: id() };
  if (kind === 'block') {
    const g = Math.max(3, Math.min(10, Math.min(b.w, b.d) * 0.3));
    return { id: id(), op: 'add', ring: box(b.x0 - g, b.z0 - g, b.x1 + g, b.z1 + g), from: 0, to: low, face: 'glass' };
  }
  if (kind === 'wing') {
    const w = Math.max(6, b.w * 0.6), d = Math.max(6, b.d * 0.8);
    return { id: id(), op: 'add', ring: box(b.x1 - 1, b.z0, b.x1 - 1 + w, b.z0 + d), from: 0, to: tOfFloor(Math.max(1, Math.round(n * 0.4)), n), face: 'glass' };
  }
  if (kind === 'cut') {
    const w = Math.max(2, b.w * 0.3), d = Math.max(2, b.d * 0.3);
    return { id: id(), op: 'cut', ring: box(b.x1 - w, b.z0 - 1, b.x1 + 1, b.z0 + d), from: 0, to: 1, face: 'glass' };
  }
  // an oval through the plan's corners' insides: a box with every point smooth
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, rx = (b.w / 2) * 1.12, rz = (b.d / 2) * 1.12;
  return { id: id(), op: 'keep', ring: { pts: [[cx + rx, cz], [cx, cz + rz], [cx - rx, cz], [cx, cz - rz]], sharp: [false, false, false, false] }, from: 0, to: 1, face: 'glass' };
}

// ---------------------------------------------------------------- parts as CAD shapes (§3.6)

const ringBox = (r: Curve) => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of r.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return { x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 }; };
const mapRing = (r: Curve, fn: (p: Pt) => Pt): Curve => ({ ...r, pts: r.pts.map((p) => { const [x, z] = fn(p); return [r2(x), r2(z)] as Pt; }) });
const allFloors = (n: number, op: PartOp, ring: Curve, name?: string): Carve => ({ id: id(), op, ...(name ? { name } : {}), ring, from: 0, to: 1, lo: 1, hi: n, face: op === 'cut' ? 'open' : 'glass' });

/** a part of a shape (Box, Round, L, U, Wedge…), all the floors up: at a point of the plan (local), at its own size;
 *  else at the plan's middle, sized to it (a cut or an exclude half the plan's size, an intersect a little over it, so
 *  it rounds the corners off, an add beside it at its own) */
export function shapePart(f: Form, shape: MassShape, op: PartOp, at?: Pt): Carve {
  const S = shapePlan(shape).plan, sb = ringBox(S), name = `${OP_LABEL[op]} · ${shapeLabel(shape)}`;
  if (at) return allFloors(floorsOfForm(f), op, mapRing(S, ([x, z]) => [x - sb.cx + at[0], z - sb.cz + at[1]]), name);
  const b = bounds(f);
  const k = op === 'add' ? 1 : op === 'keep' ? Math.max(b.w / sb.w, b.d / sb.d) * 1.1 : Math.min((b.w * 0.5) / sb.w, (b.d * 0.5) / sb.d);
  const cx = op === 'add' ? b.x1 + (sb.w * k) / 2 - 2 : (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
  return allFloors(floorsOfForm(f), op, mapRing(S, ([x, z]) => [(x - sb.cx) * k + cx, (z - sb.cz) * k + cz]), name);
}
const shapeLabel = (s: MassShape) => ({ box: 'Box', round: 'Round', L: 'L', U: 'U', court: 'Courtyard', wedge: 'Wedge', rect: 'Rectangle', poly: 'Polygon', circle: 'Circle' } as Record<MassShape, string>)[s];

/** a part from a footprint drawn on the map (world x, z pairs), in the building's frame */
export function drawnPart(f: Form, b: Pick<ProBuilding, 'spine'>, shape: MassShape, P: number[], op: PartOp): Carve | null {
  const [ax, az, bx, bz] = b.spine, L = Math.hypot(bx - ax, bz - az) || 1, u: Pt = [(bx - ax) / L, (bz - az) / L];
  const d = drawnPlan(shape, P, u); if (!d) return null;
  const [ox, oz] = toLocal(b, d.o[0], d.o[1]);
  return allFloors(floorsOfForm(f), op, mapRing(d.plan, ([x, z]) => [x + ox, z + oz]), `${OP_LABEL[op]} · ${shapeLabel(shape)}`);
}

/** a part moved dx, dz (local metres) */
export const movedPart = (c: Carve, dx: number, dz: number): Carve => ({ ...c, ring: mapRing(c.ring, ([x, z]) => [x + dx, z + dz]) });
/** a part turned by deg degrees about its middle */
export function turnedPart(c: Carve, deg: number): Carve {
  const b = ringBox(c.ring), a = (deg * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a);
  return { ...c, ring: mapRing(c.ring, ([x, z]) => [b.cx + (x - b.cx) * co - (z - b.cz) * si, b.cz + (x - b.cx) * si + (z - b.cz) * co]) };
}
/** a part mirrored across the form's middle (axis 'x': left for right; 'z': front for back), as a new part */
export function mirroredPart(f: Form, c: Carve, axis: 'x' | 'z'): Carve {
  const b = bounds(f), mx = (b.x0 + b.x1) / 2, mz = (b.z0 + b.z1) / 2;
  const ring = mapRing(c.ring, ([x, z]) => (axis === 'x' ? [2 * mx - x, z] : [x, 2 * mz - z]));
  return { ...c, id: id(), ...(c.name ? { name: `${c.name}, mirrored` } : {}), ring: { ...ring, pts: ring.pts.slice().reverse(), ...(ring.sharp ? { sharp: ring.sharp.slice().reverse() } : {}) }, ...(c.path ? { path: c.path.map((q) => ({ ...q, dx: axis === 'x' ? -q.dx : q.dx, dz: axis === 'z' ? -q.dz : q.dz })) } : {}) };
}
/** a copy of a part, a little along */
export const copiedPart = (c: Carve): Carve => ({ ...movedPart(c, 3, 3), id: id(), ...(c.name ? { name: `${c.name} copy` } : {}) });

/** Combine: another building into this one, as one of its parts (the four booleans, as a CAD's on two solids).
 *  The other's plan comes across in this one's frame; its floors set the part's (an add or an exclude makes this one
 *  as tall as the taller; an intersect as low as the lower, since nothing outside the other stands); the other goes.
 *  What the other had that a part can't carry (its taper or twist, its own parts and spaces) is listed in `lost`. */
export function combine(target: ProBuilding, other: ProBuilding, op: PartOp): { b: ProBuilding; lost: string[] } | null {
  const f = target.form, g = other.form; if (!f || !g) return null;
  const lost: string[] = [];
  if (g.keys.length) lost.push('its taper, lean or twist');
  if (g.carves.length) lost.push(`its ${g.carves.length} part${g.carves.length > 1 ? 's' : ''}`);
  if (g.spaces?.length) lost.push('its spaces');
  const ring = mapRing(g.plan, ([x, z]) => { const [X, Z] = toWorld(other, x, z); return toLocal(target, X, Z); });
  const nT = floorsOfForm(f), nO = floorsOfForm(g);
  let uses = f.uses.map((u) => ({ ...u }));
  const grow = (n: number) => { const d = n - nT; if (d > 0) uses = [...uses, { use: g.uses[g.uses.length - 1]?.use ?? uses[uses.length - 1].use, floors: d }]; };
  const shrink = (n: number) => { let d = nT - n; for (let i = uses.length - 1; i >= 0 && d > 0; i--) { const t = Math.min(d, uses[i].floors - (i === 0 ? 1 : 0)); uses[i].floors -= t; d -= t; } uses = uses.filter((u) => u.floors > 0); };
  if (op === 'add' || op === 'xor') grow(nO); else if (op === 'keep') shrink(nO);
  const n = uses.reduce((s, u) => s + u.floors, 0);
  const hi = op === 'keep' ? n : Math.min(n, nO), name = `${OP_LABEL[op]} · ${other.name ?? 'a building'}`;
  const parts: Carve[] = [{ ...allFloors(n, op, ring, name), hi }];
  // (an exclude with the other taller: above this one's top the other simply stands, so it's added there)
  if (op === 'xor' && nO > nT) { parts[0] = { ...parts[0], hi: nT }; parts.push({ ...allFloors(n, 'add', ring, `${name}, above`), lo: nT + 1, hi: nO }); }
  return { b: { ...target, floors: n, form: { ...f, uses, carves: [...f.carves, ...parts] } }, lost };
}

/** a part's ring with one edge (from point i to i + 1) pushed out along its normal by d metres (in, for negative) */
export function pushEdge<C extends { ring: Curve }>(c: C, i: number, d: number): C {
  const P = c.ring.pts, n = P.length, [nx, nz] = edgeNormal(c, i);
  const pts = P.map((p, k): Pt => (k === i || k === (i + 1) % n ? [Math.round((p[0] + nx * d) * 100) / 100, Math.round((p[1] + nz * d) * 100) / 100] : p));
  return { ...c, ring: { ...c.ring, pts } };
}
/** an edge's outward normal (unit, local): right of the edge for an anticlockwise ring, left for a clockwise one */
export function edgeNormal(c: { ring: Curve }, i: number): Pt {
  const P = c.ring.pts, n = P.length, a = P[i], b = P[(i + 1) % n];
  const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez) || 1;
  let s = 0; for (let k = 0; k < n; k++) { const p = P[k], q = P[(k + 1) % n]; s += p[0] * q[1] - q[0] * p[1]; }
  const sg = s >= 0 ? 1 : -1;
  return [(ez / L) * sg, (-ex / L) * sg];
}

// ---------------------------------------------------------------- spaces (step 5)

/** a space's name in the list: its own, else its use's */
export const spaceName = (s: Space) => s.name || USE_INFO[s.use].label;
/** where a space's edge handles sit: halfway up its floors, as a share of the way up n floors */
export function spaceT(s: Pick<Space, 'lo' | 'hi'>, n: number): number {
  const a = Math.max(1, Math.min(n, Math.min(s.lo, s.hi))), b = Math.max(1, Math.min(n, Math.max(s.lo, s.hi)));
  return n <= 1 ? 0 : ((a + b) / 2 - 1) / (n - 1);
}

export type NewSpace = 'front' | 'corner' | 'floor' | 'hall';
export const NEW_SPACES: { kind: NewSpace; label: string; icon: string; tip: string }[] = [
  { kind: 'front', label: 'Shops along the front', icon: 'shop', tip: 'A strip 8 m deep along the front of the ground floor, laid out as shops' },
  { kind: 'corner', label: 'A corner', icon: 'briefcase', tip: 'A quarter of the floor, laid out as offices' },
  { kind: 'floor', label: 'The whole floor', icon: 'layers', tip: 'Every floor’s plan, for a use of its own on some floors' },
  { kind: 'hall', label: 'A hall', icon: 'people', tip: 'One open space through the lower floors, kept as one unit' },
];

/** a new space of a kind, sized to the plan */
export function newSpace(f: Form, kind: NewSpace, use?: BuildingUse): Space {
  const b = bounds(f), n = floorsOfForm(f), g = 2;
  if (kind === 'front') return { id: id(), use: use ?? 'retail', ring: box(b.x0 - g, b.z0 - g, b.x1 + g, b.z0 + Math.min(8, b.d * 0.45)), lo: 1, hi: 1 };
  if (kind === 'corner') return { id: id(), use: use ?? 'office', ring: box(b.x0 - g, b.z0 - g, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2), lo: 1, hi: Math.min(n, 2) };
  if (kind === 'hall') return { id: id(), use: use ?? 'community', ring: box(b.x0 - g, b.z0 - g, b.x0 + b.w * 0.6, b.z1 + g), lo: 1, hi: 1, fill: 'one' };
  return { id: id(), use: use ?? 'office', ring: box(b.x0 - g * 4, b.z0 - g * 4, b.x1 + g * 4, b.z1 + g * 4), lo: 1, hi: Math.min(n, 3) };
}
