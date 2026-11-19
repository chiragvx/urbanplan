// What's on and round the plot besides the buildings, as the Site step draws it: obstructions (trees, existing
// structures, power lines, water, wells, poles) and no-build zones, each with the clearance kept round it; the plot's
// levels; and the road widths the local rules plan to. The generator keeps clear of all of it and a building put on
// it by hand is flagged (src/doc/site.ts `keepOut`), never refused.
import { disc, fromFlat, grow, outlines, stroke, union, type MP } from '../doc/ground';
import type { PlotCode } from '../doc/plot';

export type FeatureKind = 'tree' | 'structure' | 'power' | 'water' | 'well' | 'pole' | 'nobuild';
/** how a feature is drawn: a point (with a radius), a line, or an area */
export type FeatureShape = 'point' | 'line' | 'area';

export interface SiteFeature {
  id: string;
  kind: FeatureKind;
  /** a point (x, z), a line's nodes or an area's outline (x, z, …) */
  pts: number[];
  /** a point's radius: a tree's canopy, a well (m) */
  r?: number;
  /** ground kept clear round it (m) */
  clear?: number;
  /** what it is, in a few words (a no-build zone's reason) */
  note?: string;
}

export const FEATURES: { kind: FeatureKind; label: string; icon: string; shape: FeatureShape; r: number; clear: number; hint: string }[] = [
  { kind: 'tree', label: 'Tree', icon: 'tree', shape: 'point', r: 4, clear: 1, hint: 'Click where it stands. Kept, with its canopy, unless you remove it.' },
  { kind: 'structure', label: 'Existing structure', icon: 'cube', shape: 'area', r: 0, clear: 0, hint: 'Click its corners, Enter to finish.' },
  { kind: 'power', label: 'Power line', icon: 'bolt', shape: 'line', r: 0, clear: 7.5, hint: 'Click along it, Enter to finish. Its clearance corridor is kept free.' },
  { kind: 'water', label: 'Drain or water', icon: 'drop', shape: 'area', r: 0, clear: 9, hint: 'Click its edge, Enter to finish. Its buffer is kept free.' },
  { kind: 'well', label: 'Well', icon: 'circle', shape: 'point', r: 1.5, clear: 3, hint: 'Click where it is.' },
  { kind: 'pole', label: 'Pole or transformer', icon: 'pin', shape: 'point', r: 0.6, clear: 2, hint: 'Click where it is.' },
  { kind: 'nobuild', label: 'No-build zone', icon: 'ban', shape: 'area', r: 0, clear: 0, hint: 'Click its corners, Enter to finish: an easement, a heritage buffer, anything kept open.' },
];
export const featureOf = (k: FeatureKind) => FEATURES.find((f) => f.kind === k)!;

let seq = 0;
export const newId = (p = 'f') => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

/** a feature's own ground (no clearance) */
export function shapeOf(f: SiteFeature): MP {
  const s = featureOf(f.kind).shape;
  if (s === 'point') return f.pts.length >= 2 ? disc(f.pts[0], f.pts[1], Math.max(0.3, f.r ?? featureOf(f.kind).r), 20) : [];
  if (s === 'line') return f.pts.length >= 4 ? stroke(f.pts, 0.6) : [];
  return fromFlat(f.pts);
}
/** the ground kept clear for it: its shape grown by its clearance */
export function keptOf(f: SiteFeature): MP {
  const s = featureOf(f.kind).shape, c = f.clear ?? featureOf(f.kind).clear;
  if (s === 'line') return f.pts.length >= 4 ? stroke(f.pts, Math.max(0.6, 2 * c)) : [];
  return grow(shapeOf(f), c);
}
/** every feature's kept ground, as rings for the generator and the checks */
export function keepOutOf(fs: SiteFeature[] | undefined): number[][] {
  if (!fs?.length) return [];
  return outlines(union(...fs.map(keptOf))).filter((r) => r.length >= 6);
}

// ---------------- levels ----------------

/** The plot's levels: its mean ground over the road's (m: positive above), and a fall across it (% and the
 *  direction it falls toward, degrees clockwise from north). */
export interface Levels { plot: number; slope: number; dir: number; /** the ground over sea level (m), and whether slope and fall came off the city's terrain */ asl?: number; terrain?: boolean }
export const DEFAULT_LEVELS: Levels = { plot: 0.3, slope: 0, dir: 180 };
/** the ground's height at x, z (m over the road), about the plot's middle cx, cz; north is -z turned by `north` */
export function levelAt(L: Levels, x: number, z: number, cx: number, cz: number, north = 0): number {
  if (!L.slope) return L.plot;
  const a = ((L.dir + north) * Math.PI) / 180;
  // (the direction it falls toward, in plot space: north is -z, east +x)
  const fx = Math.sin(a), fz = -Math.cos(a);
  return L.plot - ((x - cx) * fx + (z - cz) * fz) * (L.slope / 100);
}
/** plinth over the road the rules ask for (m, as assumed: UDCPR 2020 9.4; DCPR the same in practice) */
export const PLINTH_MIN = 0.45;

// ---------------- roads ----------------

/** the road widths the plans use (m), by code: a road drawn or set takes one of these */
export const ROAD_WIDTHS: Record<'udcpr' | 'dcpr', number[]> = {
  udcpr: [6, 7.5, 9, 12, 15, 18, 24, 30, 36, 45, 60],
  dcpr: [6, 9, 12, 13.4, 18.3, 24.4, 27.4, 30.5, 36.6, 45.7, 60],
};
export const roadWidths = (code: PlotCode) => ROAD_WIDTHS[code === 'udcpr' ? 'udcpr' : 'dcpr'];
/** internal roads in a layout (m): a driveway, two lanes, two lanes with footpaths */
export const INTERNAL_WIDTHS = [4.5, 6, 7.5, 9, 12];
/** a road's carriageway and footpaths (each side) as the street design guidelines size them, roughly */
export function roadParts(w: number): { carriage: number; foot: number } {
  const foot = w >= 30 ? 3 : w >= 18 ? 2.5 : w >= 12 ? 2 : w >= 9 ? 1.5 : 0;
  return { carriage: Math.max(3, w - 2 * foot), foot };
}
