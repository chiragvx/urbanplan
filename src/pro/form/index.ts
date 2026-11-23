// The form procedure's public face: everything outside src/pro/form imports from here, nothing deeper.
// (The signatures are the contract in ./types.ts; the work is done in ./curve, ./slice, ./skeleton, ./units,
// ./lay and ./templates.)
import type { SiteBuilding } from '../../doc/site';
import { sampleCurve as sample } from './curve';
import { layMemo } from './lay';
export { drift } from './slice';
import { TEMPLATES as GALLERY } from './templates';
import type { BuildingUse, Curve, Form, FormContext, FormLayout, FormTemplate, Pt } from './types';

export * from './types';

/** The building's frame: its spine's first node and first segment's direction (see ./types.ts, Placement). */
export function frameOf(b: Pick<SiteBuilding, 'spine'>): { o: Pt; u: Pt; n: Pt } {
  const s = b.spine, ox = s[0] ?? 0, oz = s[1] ?? 0;
  let ux = (s[2] ?? ox + 1) - ox, uz = (s[3] ?? oz) - oz;
  const L = Math.hypot(ux, uz) || 1; ux /= L; uz /= L;
  return { o: [ox, oz], u: [ux, uz], n: [-uz, ux] };
}
/** local (x along u, z along n) to world */
export function toWorld(b: Pick<SiteBuilding, 'spine'>, x: number, z: number): Pt {
  const { o, u, n } = frameOf(b);
  return [o[0] + x * u[0] + z * n[0], o[1] + x * u[1] + z * n[1]];
}
/** world to local */
export function toLocal(b: Pick<SiteBuilding, 'spine'>, X: number, Z: number): Pt {
  const { o, u, n } = frameOf(b), dx = X - o[0], dz = Z - o[1];
  return [dx * u[0] + dz * u[1], dx * n[0] + dz * n[1]];
}

/** The curve as a polygon (local, flat x, z pairs, anticlockwise, no repeated points), smooth stretches sampled
 *  about every `step` metres; `round` (0 … 1) eases its corners, as the design language asks. */
export function sampleCurve(c: Curve, step = 1.5, round = 0): number[] { return sample(c, step, round); }

/** The form laid out floor by floor for a building (its spine places it; `floors` its floors over the ground, which
 *  win over the form's bands: the top band grows or shrinks to match). Null when the form can't make a floor (an
 *  empty or degenerate plan). Remembered: the same building and project give back the same layout object. */
export function layForm(b: SiteBuilding & { form?: Form }, ctx: FormContext): FormLayout | null { return layMemo(b, ctx); }

/** The templates, in the gallery's order. */
export const TEMPLATES: FormTemplate[] = GALLERY;

/** A plain box form (the default for a building given a form by hand): a rectangle w × d, `floors` of a use (homes
 *  unless said). */
export function boxForm(w: number, d: number, floors: number, use: BuildingUse = 'residential'): Form {
  return {
    plan: { pts: [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] },
    keys: [], ease: 'smooth', carves: [], roof: { kind: 'flat', pitch: 0, overhang: 0, dir: 0, parapet: 1 }, uses: [{ use, floors }],
  };
}
