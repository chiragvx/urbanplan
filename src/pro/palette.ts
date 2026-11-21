// The palette as shares of the facade: how much of the outside of the buildings is each of the facade's tones (the
// walls, the accent, the base) and glass, measured from the model as drawn (the zones, bands, piers, fins, corners,
// cornices and the windows on the typical floor), against the shares the design system aims for. Design guidelines
// write palettes this way (a dominant, a secondary and an accent, the 60/30/10 habit; Amaravati's draft caps glazing at
// 30 %), and the same take-off prices the facade's finishes instead of a rule-of-thumb quantity.
// Slab buildings only: a formed building's skin isn't measured yet (it counts in `skipped`).
import type { SiteReport } from '../doc/site';
import { compositionOf, zonesOf, ZONED_FROM, type DesignSystem, type Tone } from './design';
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
export function facadeTakeoff(d: SiteReport, plans: FloorPlan[], dsOf: (i: number) => DesignSystem, fh: number): Takeoff {
  const area: Record<PaletteSlot, number> = { wall: 0, accent: 0, base: 0, glass: 0 };
  let skipped = 0;
  d.buildings.forEach((b, i) => {
    if (b.laid || !b.quads.length || !plans[i]) { skipped++; return; }
    const ds = dsOf(i), comp = compositionOf(ds), F = b.floors, Z = zonesOf(comp, F);
    const faces = facadeBays(b.quads, comp.bay).filter((f) => !f.inner), P = faces.reduce((s, f) => s + f.L, 0);
    const outs = plans[i].openings.filter((o) => o.outside);
    const glassFloor = outs.reduce((s, o) => s + o.w * o.h, 0);
    const bays = comp.rhythm !== 'free';
    const cornerGlass = comp.corner === 'glazed' && bays ? faces.filter((f) => f.n >= 3).reduce((s, f) => s + 2 * (f.bw - 0.2) * (fh - 0.45), 0) : 0;
    const finned = ds.facade.fins ? outs.filter((o) => o.tag === 'W1' || o.tag === 'SD').length * 2 * 0.3 * fh : 0;
    const piers = comp.piers && bays ? faces.reduce((s, f) => s + (f.n - 1) * 0.35 * fh, 0) : 0;
    const cornerPier = comp.corner === 'accent' ? faces.length * 0.7 * fh : 0;
    for (let f = 0; f < F; f++) {
      const zone: 'base' | 'mid' | 'top' = f < Z.base ? 'base' : f >= F - Z.top ? 'top' : 'mid';
      const glass = glassFloor + (f >= Z.base ? cornerGlass : 0);
      const accent = (ds.facade.bands ? P * 0.22 : 0) + finned + cornerPier + (zone === 'mid' ? piers : 0);
      const opaque = Math.max(0, P * fh - glass - accent);
      area.glass += glass; area.accent += accent;
      area[zone === 'base' ? comp.base.tone : zone === 'top' ? comp.top.tone : 'wall'] += opaque;
    }
    // the string courses, the cornice (taken from the walls they cover) and the parapet
    const courses = (Z.base ? P * 0.45 : 0) + (Z.top ? P * 0.3 : 0) + (F >= ZONED_FROM && comp.top.crown === 'cornice' ? P * 0.5 : 0);
    area.accent += courses; area.wall = Math.max(0, area.wall - courses);
    area[Z.top ? comp.top.tone : 'wall'] += P * 1.0;
  });
  return { area, total: area.wall + area.accent + area.base + area.glass, skipped };
}

/** each slot's share of the measured facade (all 0 when nothing was measured) */
export const sharesOf = (t: Takeoff): Record<PaletteSlot, number> => {
  const k = t.total > 0 ? 1 / t.total : 0;
  return { wall: t.area.wall * k, accent: t.area.accent * k, base: t.area.base * k, glass: t.area.glass * k };
};
