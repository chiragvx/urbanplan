// Assets: every buildable thing as one catalogue entry (Cities: Skylines' asset panel), built from published
// standards (IRC, UDCPR, IS, CPHEEO, Schedule of Dimensions, city street guidelines). An asset says how it is drawn
// (drawer), what its cross-section is (profile), the height it sits at, the rules it carries (limits and buffers),
// what is placed along it automatically, and where its numbers come from.
import type { Part } from '../net/model';
import type { LineKind } from '../doc/types';

export type Category = 'roads' | 'transit' | 'rail' | 'water' | 'drainage' | 'utilities' | 'power' | 'landscape';
export type Drawer = 'network' | 'route' | 'place' | 'area';

export type Profile =
  /** a street: the road network's own cross-section */
  | { type: 'street'; cls: string; parts: Part[] }
  /** rail / metro tracks on a formation (at grade, on a viaduct, or in a tunnel) */
  | { type: 'track'; gauge: number; tracks: number; tc: number; formation: number; metro?: boolean; structure: 'grade' | 'viaduct' | 'tunnel' }
  /** open channel: canal, nalla, drain (trapezoid; slope = horizontal per vertical) */
  | { type: 'channel'; bed: number; depth: number; slope: number; freeboard: number; banks: [number, number]; lined: boolean; road: boolean }
  /** buried pipe / duct */
  | { type: 'conduit'; dia: number; box?: [number, number] }
  /** overhead line in a right-of-way corridor */
  | { type: 'corridor'; width: number; kv: number; span: number; towerH: number; poles?: boolean }
  /** a path or track that isn't a street (footpath, cycle track, trail) */
  | { type: 'path'; width: number }
  /** a placed structure (footprint w × l, height h, sitting `elev` m up) */
  | { type: 'point'; w: number; l: number; h: number; elev?: number; shape: 'station' | 'box' | 'platform' | 'tank' | 'yard' | 'stop' }
  /** an area (depot, yard, park, flood zone) */
  | { type: 'area'; fill: string; h?: number; hatch?: boolean };

export type Rule =
  /** smallest curve radius on the route (hard: the tool refuses tighter curves) */
  | { kind: 'minRadius'; r: number; hard?: boolean; note: string }
  /** buildings within `dist` of the asset's edge: no-build (error), restricted (warn) or needs a permission (info) */
  | { kind: 'buffer'; dist: number; sev: 'error' | 'warn' | 'info'; note: string }
  /** buildings inside the area */
  | { kind: 'inside'; sev: 'error' | 'warn' | 'info'; note: string }
  /** a catchment ring drawn around it (TOD influence zone) */
  | { kind: 'ring'; dist: number; note: string }
  /** clearance a crossing structure must leave above it (m) */
  | { kind: 'clearance'; v: number; note: string }
  /** only on streets at least this wide (m) */
  | { kind: 'onStreet'; minWidth: number; note: string };

export interface Repeat { every: number; item: 'manhole' | 'hydrant' | 'tower' | 'pole' | 'pier' | 'marker'; note?: string }

export interface LayerDef { id: string; name: string; kind: LineKind; group: 'surface' | 'elevated' | 'underground'; color: string }

export interface AssetDef {
  id: string;
  category: Category;
  tab: string;
  name: string;
  /** what it's for, shown on the hover card */
  use?: string;
  drawer: Drawer;
  profile: Profile;
  /** the layer route / place / area assets draw into */
  layer?: LayerDef;
  /** default height (m): + up (deck, viaduct), − down (depth below ground) */
  lift?: number;
  rules?: Rule[];
  along?: Repeat[];
  /** extra values stored on the drawn object (e.g. discharge class, voltage) */
  props?: Record<string, string | number>;
  source: string;
  /** dimensions read off a drawing or a typical value rather than a clause */
  approx?: boolean;
  /** catalogue pack: core, or a city pack */
  pack: string;
  /** a Settings-saved custom asset */
  custom?: boolean;
}

export const CATEGORIES: { id: Category; label: string; icon: string }[] = [
  { id: 'roads', label: 'Roads', icon: 'M3 21L9 3M21 21L15 3M12 5v3M12 11v3M12 17v3' },
  { id: 'transit', label: 'Public transport', icon: 'M6 3h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM4 11h16M8 21l-1.5-4M16 21l1.5-4M8 14h.01M16 14h.01' },
  { id: 'rail', label: 'Rail', icon: 'M8 3L5 21M16 3l3 18M6.5 8h11M6 13h12M5.5 18h13' },
  { id: 'water', label: 'Water bodies & canals', icon: 'M2 12c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 17c2-2 4-2 6 0s4 2 6 0 4-2 6 0M12 3l-3 5h6z' },
  { id: 'drainage', label: 'Drainage & sewers', icon: 'M4 4h16v6a8 8 0 0 1-16 0zM12 18v3M8 8h8' },
  { id: 'utilities', label: 'Water supply & utilities', icon: 'M12 2C8 8 6 11 6 14a6 6 0 0 0 12 0c0-3-2-6-6-12z' },
  { id: 'power', label: 'Power', icon: 'M13 2L4 14h7l-1 8 9-12h-7z' },
  { id: 'landscape', label: 'Paths & places', icon: 'M12 2l5 8h-3l4 6h-5v6h-2v-6H6l4-6H7z' },
];

/** Overall width of an asset (m): the cross-section, corridor or footprint across. */
export function assetWidth(a: AssetDef): number {
  const p = a.profile;
  switch (p.type) {
    case 'street': return Math.round(p.parts.reduce((s, q) => s + q.width, 0) * 100) / 100;
    case 'track': return p.formation;
    case 'channel': return channelTop(p) + p.banks[0] + p.banks[1];
    case 'conduit': return p.box ? p.box[0] : p.dia;
    case 'corridor': return p.width;
    case 'path': return p.width;
    case 'point': return p.w;
    case 'area': return 0;
  }
}

/** Top width of a channel at bank level. */
export const channelTop = (p: Extract<Profile, { type: 'channel' }>) => p.bed + 2 * p.slope * (p.depth + p.freeboard);

/** Short size label for a tile ("18 m", "Ø 300", "220 kV"). */
export function sizeLabel(a: AssetDef): string {
  const p = a.profile;
  if (p.type === 'conduit') return p.box ? `${p.box[0]}×${p.box[1]} m` : `Ø ${Math.round(p.dia * 1000)}`;
  if (p.type === 'corridor') return p.kv >= 1 ? `${p.kv} kV` : 'LT';
  if (p.type === 'point') return `${p.w}×${p.l} m`;
  if (p.type === 'area') return 'area';
  const w = assetWidth(a);
  return `${Math.round(w * 10) / 10} m`;
}

/** Smallest circumradius along a polyline (resampled every `step` m). */
export function minRadiusOf(pts: [number, number][], step = 5): number {
  const P: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / step));
    for (let k = 0; k < n; k++) P.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  if (pts.length) P.push(pts[pts.length - 1]);
  let R = Infinity;
  const g = Math.max(1, Math.round(10 / step)); // measure over ~10 m chords
  for (let i = g; i < P.length - g; i++) {
    const a = P[i - g], b = P[i], c = P[i + g];
    const ab = Math.hypot(b[0] - a[0], b[1] - a[1]), bc = Math.hypot(c[0] - b[0], c[1] - b[1]), ca = Math.hypot(a[0] - c[0], a[1] - c[1]);
    const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
    if (cross < 1e-6) continue;
    R = Math.min(R, (ab * bc * ca) / (2 * cross));
  }
  return R;
}
