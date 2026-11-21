// Heritage controls: a precinct's rules for new buildings, as "frame control" works in Chandigarh and the heritage
// guidelines do round Bombay's Art Deco and Victorian precincts. Choosing a precinct sets the design system's tokens
// it controls and locks them (the Design step greys those out), leaving the rest free; its rules are then checked in
// the review (./review.ts). The rules are paraphrased from the guidance as we read it, for discussion: the heritage
// committee's own conditions are what count.
import { compositionOf, climateOf, finishOf, setFinish, signageOf, lightingOf, type DesignSystem } from './design';
import { materialOf } from './materials';
import type { PaletteSlot } from './palette';

/** the parts of a design system a precinct can lock (the Design step's sections) */
export type LockGroup = 'materials' | 'composition' | 'windows' | 'climate' | 'signage' | 'lighting';
export interface RuleCtx { ds: DesignSystem; shares: Record<PaletteSlot, number> | null }
export interface PrecinctRule { label: string; ok: (c: RuleCtx) => boolean; detail: (c: RuleCtx) => string }
export interface Precinct {
  id: string; name: string; where: string; blurb: string;
  locks: LockGroup[];
  /** set the tokens it controls (mutates `d`; use on a clone) */
  apply: (d: DesignSystem) => void;
  rules: PrecinctRule[];
}

const rgbOf = (hex: string) => { const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
/** a colour's relative luminance (0 black … 1 white): a stand-in for a paint's light reflectance value */
export const lrv = (hex: string) => { const [r, g, b] = rgbOf(hex).map((c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const pc = (v: number) => `${Math.round(v * 100)}%`;
const glassAtMost = (cap: number): PrecinctRule => ({
  label: `Glass no more than ${pc(cap)} of the facade`,
  ok: (c) => !c.shares || c.shares.glass <= cap + 1e-6,
  detail: (c) => (c.shares ? `${pc(c.shares.glass)} now` : 'Not measured yet'),
});

export const PRECINCTS: Precinct[] = [
  {
    id: 'art-deco', name: 'Art Deco precinct', where: 'Marine Drive and the Oval, Mumbai',
    blurb: 'New buildings to read as the Deco row: light walls, horizontal bands, eyebrow sunshades, a cornice, lettering for signs.',
    locks: ['composition', 'climate', 'signage', 'lighting'],
    apply: (d) => {
      d.composition = { ...compositionOf(d), base: { floors: Math.max(1, compositionOf(d).base.floors), tone: 'base' }, top: { floors: Math.max(1, compositionOf(d).top.floors), tone: 'accent', crown: 'cornice' }, rhythm: 'even', piers: true };
      d.facade.bands = true; d.facade.fins = false;
      d.climate = { ...climateOf(d), chhajja: Math.max(0.6, climateOf(d).chhajja), orient: false };
      d.signage = { kind: 'letters', h: Math.min(0.6, signageOf(d).h), cap: 0.1 };
      d.lighting = { facade: 'lines', kelvin: 2700, shielded: true };
    },
    rules: [
      glassAtMost(0.3),
      { label: 'Light-coloured walls', ok: (c) => lrv(c.ds.facade.wall) >= 0.5, detail: (c) => `${materialOf(finishOf(c.ds).wall).name}, reflects about ${pc(lrv(c.ds.facade.wall))}` },
      { label: 'Walls not glass or metal cladding', ok: (c) => !['glass', 'metal'].includes(materialOf(finishOf(c.ds).wall).category) && !materialOf(finishOf(c.ds).wall).id.startsWith('acp'), detail: (c) => materialOf(finishOf(c.ds).wall).name },
      { label: 'Horizontal bands and a cornice', ok: (c) => c.ds.facade.bands && compositionOf(c.ds).top.crown === 'cornice', detail: (c) => `${c.ds.facade.bands ? 'Bands' : 'No bands'}, ${compositionOf(c.ds).top.crown}` },
    ],
  },
  {
    id: 'frame-control', name: 'Frame control', where: 'Chandigarh’s sectors',
    blurb: 'The frame is fixed: floor height, the window and door sizes, brick or concrete walls, recessed balconies. The plan is yours.',
    locks: ['windows', 'materials'],
    apply: (d) => {
      d.floorH = 3.0;
      d.windows.W1 = { ...d.windows.W1, w: 1.5, h: 1.5, sill: 0.75 };
      d.windows.W2 = { ...d.windows.W2, w: 1.2, h: 1.2, sill: 0.9 };
      d.doors.D1 = { ...d.doors.D1, w: 1.0, h: 2.1 };
      const wall = materialOf(finishOf(d).wall);
      if (wall.category !== 'brick' && wall.id !== 'concrete-fair') setFinish(d, 'wall', 'brick-red');
      setFinish(d, 'accent', 'concrete-fair');
      d.balcony = { ...d.balcony, kind: 'recessed' };
    },
    rules: [
      { label: 'Floor to floor 3.0 m', ok: (c) => Math.abs(c.ds.floorH - 3) < 0.01, detail: (c) => `${c.ds.floorH.toFixed(2)} m` },
      { label: 'Windows to the frame (1.5 and 1.2 m square)', ok: (c) => c.ds.windows.W1.w === 1.5 && c.ds.windows.W1.h === 1.5 && c.ds.windows.W2.w === 1.2 && c.ds.windows.W2.h === 1.2, detail: (c) => `W1 ${c.ds.windows.W1.w} × ${c.ds.windows.W1.h}, W2 ${c.ds.windows.W2.w} × ${c.ds.windows.W2.h}` },
      { label: 'Brick or fair-faced concrete walls', ok: (c) => { const m = materialOf(finishOf(c.ds).wall); return m.category === 'brick' || m.id === 'concrete-fair'; }, detail: (c) => materialOf(finishOf(c.ds).wall).name },
      { label: 'Recessed balconies', ok: (c) => c.ds.balcony.kind === 'recessed' || c.ds.balcony.kind === 'none', detail: (c) => c.ds.balcony.kind },
    ],
  },
  {
    id: 'heritage-street', name: 'Heritage street', where: 'Grade III precincts: Fort, the old city cores',
    blurb: 'Fit in with the street: a clear base, modest glass, small warm-lit signs.',
    locks: ['signage', 'lighting'],
    apply: (d) => {
      d.composition = { ...compositionOf(d), base: { floors: Math.max(1, compositionOf(d).base.floors), tone: compositionOf(d).base.tone } };
      d.signage = { ...signageOf(d), kind: signageOf(d).kind === 'blade' ? 'letters' : signageOf(d).kind, cap: 0.15 };
      d.lighting = { ...lightingOf(d), kelvin: Math.min(3000, lightingOf(d).kelvin), shielded: true };
    },
    rules: [
      glassAtMost(0.4),
      { label: 'A base that reads from the street', ok: (c) => compositionOf(c.ds).base.floors > 0, detail: (c) => `${compositionOf(c.ds).base.floors} base floor(s)` },
    ],
  },
];
export const precinctOf = (id: string | undefined) => (id ? PRECINCTS.find((p) => p.id === id) ?? null : null);
/** whether a part of the design system is locked by its precinct */
export const lockedBy = (d: DesignSystem, g: LockGroup) => { const p = precinctOf(d.precinct); return p && p.locks.includes(g) ? p : null; };
