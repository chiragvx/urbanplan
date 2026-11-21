// The palette as shares of the facade: how much of the outside of the buildings is each of the facade's tones (the
// walls, the accent, the base) and glass, measured from the model as drawn (the zones, bands, piers, fins, corners,
// cornices and the windows on the typical floor), against the shares the design system aims for. Design guidelines
// write palettes this way (a dominant, a secondary and an accent, the 60/30/10 habit; Amaravati's draft caps glazing at
// 30 %), and the same take-off prices the facade's finishes instead of a rule-of-thumb quantity.
// A formed building is measured floor by floor from its slab outlines and its skin's glass, with the pattern's share
// of the surface taken as accent (roughly: fins and screens by their depth over their spacing).
// The chhajjas count with the walls (their top, soffit and edge are finished as the wall is) and the jaalis with the
// accent, over the glass they screen (it still counts as glass).
import type { SiteReport } from '../doc/site';
import { bearingOf, chhajjaOn, climateOf, compositionOf, languageOf, zonesOf, ZONED_FROM, type DesignSystem, type Tone } from './design';
import type { Skin } from './form/types';
import { facadeBays, type FloorPlan } from './openings';

export type PaletteSlot = Tone | 'glass';
export const PALETTE_SLOTS: { key: PaletteSlot; label: string }[] = [
  { key: 'wall', label: 'Walls' }, { key: 'accent', label: 'Accent' }, { key: 'base', label: 'Base' }, { key: 'glass', label: 'Glass' },
];
/** facade areas (m²) by slot, their total, and how many buildings weren't measured */
export interface Takeoff { area: Record<PaletteSlot, number>; total: number; skipped: number }

/** within this many points of its target a share counts as on it */
export const PALETTE_TOLERANCE = 0.05;

/** Measure the outside of every slab building: per floor, the faces' area less the glass and the accent parts, in its
 *  zone's tone; once per building the string courses, the cornice and the parapet. */
export function facadeTakeoff(d: SiteReport, plans: FloorPlan[], dsOf: (i: number) => DesignSystem, fh: number, north = 0): Takeoff {
  const area: Record<PaletteSlot, number> = { wall: 0, accent: 0, base: 0, glass: 0 };
  let skipped = 0;
  d.buildings.forEach((b, i) => {
    if (b.laid) { if (!formed(b.laid, dsOf(i), (b.b as { form?: { skin?: Partial<Skin> } }).form?.skin, area)) skipped++; return; }
    if (!b.quads.length || !plans[i]) { skipped++; return; }
    const ds = dsOf(i), comp = compositionOf(ds), F = b.floors, Z = zonesOf(comp, F);
    const faces = facadeBays(b.quads, comp.bay).filter((f) => !f.inner), P = faces.reduce((s, f) => s + f.L, 0);
    const outs = plans[i].openings.filter((o) => o.outside);
    const glassFloor = outs.reduce((s, o) => s + o.w * o.h, 0);
    const bays = comp.rhythm !== 'free';
    const cornerGlass = comp.corner === 'glazed' && bays ? faces.filter((f) => f.n >= 3).reduce((s, f) => s + 2 * (f.bw - 0.2) * (fh - 0.45), 0) : 0;
    const finned = ds.facade.fins ? outs.filter((o) => o.tag === 'W1' || o.tag === 'SD').length * 2 * 0.3 * fh : 0;
    const piers = comp.piers && bays ? faces.reduce((s, f) => s + (f.n - 1) * 0.35 * fh, 0) : 0;
    const cornerPier = comp.corner === 'accent' ? faces.length * 0.7 * fh : 0;
    // the climate's elements, per floor: a chhajja's top, soffit and edge in the walls' finish; a jaali in the accent
    const cl = climateOf(ds), sheltered = ds.balcony.kind === 'cantilever' || ds.balcony.kind === 'recessed';
    const chhajjas = cl.chhajja > 0.05 ? outs.filter((o) => !(o.tag === 'SD' && sheltered)).reduce((s, o) => { const dep = chhajjaOn(cl, bearingOf(o.nx, o.nz, north)); return s + (o.w + 0.6) * (2 * dep + 0.1); }, 0) : 0;
    const jaalis = outs.filter((o) => (o.tag === 'V1' ? cl.jaali !== 'none' : o.tag === 'W2' && cl.jaali === 'windows')).reduce((s, o) => s + (o.w + 0.2) * (o.h + 0.2), 0);
    for (let f = 0; f < F; f++) {
      const zone: 'base' | 'mid' | 'top' = f < Z.base ? 'base' : f >= F - Z.top ? 'top' : 'mid';
      const glass = glassFloor + (f >= Z.base ? cornerGlass : 0);
      const accent = (ds.facade.bands ? P * 0.22 : 0) + finned + cornerPier + (zone === 'mid' ? piers : 0);
      const opaque = Math.max(0, P * fh - glass - accent);
      area.glass += glass; area.accent += accent + jaalis; area.wall += chhajjas;
      area[zone === 'base' ? comp.base.tone : zone === 'top' ? comp.top.tone : 'wall'] += opaque;
    }
    // the string courses, the cornice (taken from the walls they cover) and the parapet
    const courses = (Z.base ? P * 0.45 : 0) + (Z.top ? P * 0.3 : 0) + (F >= ZONED_FROM && comp.top.crown === 'cornice' ? P * 0.5 : 0);
    area.accent += courses; area.wall = Math.max(0, area.wall - courses);
    area[Z.top ? comp.top.tone : 'wall'] += P * 1.0;
  });
  return { area, total: area.wall + area.accent + area.base + area.glass, skipped };
}

/** the share of a skin's surface its pattern puts in the accent (fins, bands, mullions, screens), roughly */
function accentShare(s: Skin, h: number): number {
  const sp = Math.max(0.25, s.spacing || 1), dep = Math.max(0, s.depth);
  switch (s.pattern) {
    case 'fins': return Math.min(0.6, (dep / sp) * 0.6);
    case 'bands': return Math.min(0.4, 0.5 / h);
    case 'grid': return Math.min(0.5, 0.5 / h + 0.35 / Math.max(1.5, sp));
    case 'louvres': return 0.45;
    case 'screen': return 0.55;
    case 'diagrid': return 0.15;
    case 'curtain': return s.glass < 0.05 ? 0.02 : 0.06;
    default: return 0.1;
  }
}
/** A formed building's facade: each floor's outline perimeter by its height, glazed as its skin is (the wall strip a
 *  quarter less than the solid share, as ./form/mesh.ts draws it), in its zone's tone. False when it has no outlines. */
function formed(L: NonNullable<SiteReport['buildings'][number]['laid']>, ds: DesignSystem, own: Partial<Skin> | undefined, area: Record<PaletteSlot, number>): boolean {
  const skin: Skin = { ...languageOf(ds).skin, ...(own ?? {}) }, comp = compositionOf(ds), F = L.floors.length, Z = zonesOf(comp, F);
  let any = false;
  L.floors.forEach((f, k) => {
    const r = f.ring;
    if (!r || r.length < 6) return;
    any = true;
    let P = 0;
    for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; P += Math.hypot(r[j] - r[i], r[j + 1] - r[i + 1]); }
    const S = P * f.h, g = skin.glass < 0.04 ? 0 : 1 - (1 - skin.glass) * 0.75, acc = accentShare(skin, f.h) * (1 - g);
    area.glass += S * g; area.accent += S * acc;
    area[k < Z.base ? comp.base.tone : k >= F - Z.top ? comp.top.tone : 'wall'] += S * Math.max(0, 1 - g - acc);
  });
  return any;
}

/** each slot's share of the measured facade (all 0 when nothing was measured) */
export const sharesOf = (t: Takeoff): Record<PaletteSlot, number> => {
  const k = t.total > 0 ? 1 / t.total : 0;
  return { wall: t.area.wall * k, accent: t.area.accent * k, base: t.area.base * k, glass: t.area.glass * k };
};
