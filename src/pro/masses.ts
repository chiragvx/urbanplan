// Design: a building's form made by the designer (docs/plans/pro-design-freedom.md §3.6). Two ways in, both landing
// as a form to shape at once (its rings, key floors, parts, levels and uses), never a plain slab:
// - a base primitive, one click where it goes, its long side along the front road: a box, a round, a wedge. Anything
//   more (an L, a U, a courtyard) is made from these by the booleans, so each piece stays a part to move or change;
// - a footprint drawn, CAD-like: a rectangle (dragged, or its corners clicked), a polygon (its corners clicked), a
//   circle or ellipse (dragged out over its box).
// A mass starts at a number of floors of the project's use; its floors are then made from it (the floors' heights,
// what each range is for, floors left out).
import type { Carve, Curve, Form, Level, Pt } from './form';

export type MassShape = 'box' | 'round' | 'L' | 'U' | 'court' | 'wedge' | 'rect' | 'poly' | 'circle';
/** the base primitives placed with one click, and the footprints drawn (L, U and courtyard stay as shapes for what was
 *  made with them before, and for templates, but aren't offered: they're booleans of these) */
export const MASS_SHAPES: { shape: MassShape; label: string; icon: string; hint: string }[] = [
  { shape: 'box', label: 'Box', icon: 'box', hint: 'Click where it goes: a box 30 × 20 m, its long side to the road.' },
  { shape: 'round', label: 'Round', icon: 'circle', hint: 'Click where its middle goes: a round tower 24 m across.' },
  { shape: 'wedge', label: 'Wedge', icon: 'wedge', hint: 'Click where it goes: a triangle, its long side to the road.' },
];
export const MASS_DRAW: { shape: MassShape; label: string; icon: string; hint: string }[] = [
  { shape: 'rect', label: 'Rectangle', icon: 'rect', hint: 'Drag out the rectangle, or click its corners. Type width, depth and Enter for exact sizes.' },
  { shape: 'poly', label: 'Polygon', icon: 'poly', hint: 'Click its corners; click the first again, double-click or Enter to close.' },
  { shape: 'circle', label: 'Circle', icon: 'circle', hint: 'Drag out its box: a circle, or an ellipse when the box is long.' },
];
export const isDrawn = (s: MassShape) => s === 'rect' || s === 'poly' || s === 'circle';
export const massHint = (s: MassShape) => [...MASS_SHAPES, ...MASS_DRAW].find((m) => m.shape === s)?.hint ?? '';

const R = (x0: number, z0: number, x1: number, z1: number): Curve => ({ pts: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] });
/** an ellipse w × d through n smooth points, about (cx, cz) */
export const ellipseCurve = (w: number, d: number, n = 16, cx = 0, cz = 0): Curve => ({
  pts: Array.from({ length: n }, (_, k) => [r2(cx + Math.cos((k / n) * Math.PI * 2) * (w / 2)), r2(cz + Math.sin((k / n) * Math.PI * 2) * (d / 2))] as Pt),
  sharp: Array(n).fill(false),
});
const r2 = (v: number) => Math.round(v * 100) / 100;

/** a shape's plan and parts, local metres about where it was clicked (x along the road, z back from it) */
export function shapePlan(s: MassShape): { plan: Curve; carves: Carve[] } {
  switch (s) {
    case 'round': return { plan: ellipseCurve(24, 24), carves: [] };
    case 'L': return { plan: { pts: [[0, 0], [30, 0], [30, 12], [12, 12], [12, 28], [0, 28]] }, carves: [] };
    case 'U': return { plan: { pts: [[-18, 0], [18, 0], [18, 24], [6, 24], [6, 12], [-6, 12], [-6, 24], [-18, 24]] }, carves: [] };
    case 'court': return { plan: R(-18, -14, 18, 14), carves: [{ id: 'court', name: 'Court', ring: R(-6, -4, 6, 4), from: 0, to: 1, face: 'open' }] };
    case 'wedge': return { plan: { pts: [[-16, -10], [16, -10], [0, 14]] }, carves: [] };
    default: return { plan: R(-15, -10, 15, 10), carves: [] };
  }
}

/** a footprint drawn on the map (world x, z pairs) as a plan about its middle, in the frame of the road (u along it):
 *  a rectangle the box of what was drawn, a circle the ellipse in that box, a polygon as drawn. `null`: too small. */
export function drawnPlan(s: MassShape, P: number[], u: Pt): { o: Pt; plan: Curve } | null {
  if (P.length < 6) return null;
  const v: Pt = [-u[1], u[0]];
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (let i = 0; i + 1 < P.length; i += 2) { const a = P[i] * u[0] + P[i + 1] * u[1], b = P[i] * v[0] + P[i + 1] * v[1]; a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b); }
  const w = a1 - a0, d = b1 - b0;
  if (w < 3 || d < 3) return null;
  const ma = (a0 + a1) / 2, mb = (b0 + b1) / 2, o: Pt = [r2(ma * u[0] + mb * v[0]), r2(ma * u[1] + mb * v[1])];
  if (s === 'rect') return { o, plan: R(r2(-w / 2), r2(-d / 2), r2(w / 2), r2(d / 2)) };
  if (s === 'circle') return { o, plan: ellipseCurve(r2(w), r2(d), Math.max(12, Math.min(32, Math.round((Math.PI * (w + d)) / 2 / 3)))) };
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < P.length; i += 2) { const a = P[i] * u[0] + P[i + 1] * u[1] - ma, b = P[i] * v[0] + P[i + 1] * v[1] - mb; pts.push([r2(a), r2(b)]); }
  // (anticlockwise, as the form's plans are)
  let A = 0; for (let k = 0; k < pts.length; k++) { const q = pts[(k + 1) % pts.length]; A += pts[k][0] * q[1] - q[0] * pts[k][1]; }
  return { o, plan: { pts: A < 0 ? pts.reverse() : pts } };
}

/** a new mass: the plan and parts, a number of floors of a use, a flat roof */
export function massForm(plan: Curve, carves: Carve[], floors: number, use: Form['uses'][number]['use']): Form {
  return { plan, keys: [], ease: 'smooth', carves, roof: { kind: 'flat', pitch: 0, overhang: 0, dir: 0, parapet: 1 }, uses: [{ use, floors: Math.max(1, Math.round(floors)) }] };
}

/** the floors a new mass starts at: about as tall as it is wide (a box 30 m wide, ten floors), 2 to 20 */
export function startFloors(plan: Curve, floorH = 3): number {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of plan.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const w = Math.min(x1 - x0, z1 - z0);
  return Math.max(2, Math.min(20, Math.round((w * 1.5) / floorH)));
}


// ---------------- making floors from the form ----------------

/** a level range that stands for every floor (the floor-to-floor height set for the whole form): first in the list,
 *  so ranges set after it win; its top past any building's floors, so it covers them however many there are */
const ALL = 999;
export const isAll = (l: Level) => Math.min(l.from, l.to) === 1 && Math.max(l.from, l.to) >= ALL && !l.void;
/** the form's floor-to-floor height when one is set for every floor */
export const floorHOf = (f: Form): number | undefined => f.levels?.find(isAll)?.h;
/** every floor at h m (undefined: each its use's height), other ranges kept after it */
export function withFloorH(f: Form, h: number | undefined): Form {
  const rest = (f.levels ?? []).filter((l) => !isAll(l));
  const levels = h && h >= 2 ? [{ from: 1, to: ALL, h }, ...rest] : rest;
  return { ...f, levels: levels.length ? levels : undefined };
}
/** the floors a height of H m makes, at the form's floors as they average now (`now` m over n floors) */
export const floorsFor = (H: number, now: number, n: number) => Math.max(1, Math.min(300, Math.round((H * n) / Math.max(1, now))));

