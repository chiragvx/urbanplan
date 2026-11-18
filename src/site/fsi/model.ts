// The FSI calculator and the FSI maps (/<city>/fsi-calculator/, /<city>/fsi-map/): what a plot of a given area on a
// road of a given width may build, worked out with the editor's own rule tables (src/doc/plot.ts, defaultRules), so
// the calculator can't say something the plot sandbox and Site Studio don't do. Also the colours the FSI maps use
// and the line between Mumbai's island city and suburbs. Plain functions: tools/maps/bake-maps.ts imports this too.
import { defaultRules, sideMargin, type PlotCode, type PlotRules } from '../../doc/plot';

export type FsiCity = 'pune' | 'mumbai';
/** where in the city: Pune outside or inside the congested areas (peths, gaothan); Mumbai's island city or suburbs */
export type FsiZone = 'regular' | 'congested' | 'island' | 'suburbs';
export type FsiUse = 'residential' | 'commercial';

export const ZONES: Record<FsiCity, { value: FsiZone; label: string; hint: string }[]> = {
  pune: [
    { value: 'regular', label: 'Most of Pune', hint: 'UDCPR 2020 Table 6-G' },
    { value: 'congested', label: 'Old city (peths, gaothan)', hint: 'UDCPR 2020 Table 6-A, congested areas' },
  ],
  mumbai: [
    { value: 'suburbs', label: 'Suburbs', hint: 'North of Mahim and Sion: Bandra to Dahisar, Kurla to Mulund' },
    { value: 'island', label: 'Island city', hint: 'Colaba to Mahim and Sion' },
  ],
};

export const codeOf = (zone: FsiZone): PlotCode => (zone === 'island' ? 'dcpr-island' : zone === 'suburbs' ? 'dcpr-suburbs' : 'udcpr');
export const rulesFor = (roadW: number, zone: FsiZone, use: FsiUse = 'residential'): PlotRules => defaultRules(roadW, use, codeOf(zone), zone === 'congested');
/** basic + premium + TDR on a road this wide, before ancillary / fungible FSI */
export const fsiFor = (roadW: number, zone: FsiZone) => { const r = rulesFor(roadW, zone); return r.basic + r.premium + r.tdr; };
/** the road widths where the table for this zone steps (m) */
export const STEPS_OF: Record<FsiZone, number[]> = {
  regular: [0, 9, 12, 15, 24, 30],
  congested: [0, 9, 18, 30],
  island: [0, 9, 12, 18, 27],
  suburbs: [0, 9, 12, 18, 27],
};
export const stepLabel = (steps: number[], i: number) => (i === steps.length - 1 ? `${steps[i]} m and wider` : i === 0 ? `under ${steps[1]} m` : `${steps[i]} to ${steps[i + 1]} m`);
/** the name of the extra FSI on top: ancillary (UDCPR) or fungible (DCPR) */
export const extraName = (zone: FsiZone) => (zone === 'island' || zone === 'suburbs' ? 'fungible' : 'ancillary');

export interface FsiInput {
  zone: FsiZone;
  use: FsiUse;
  /** plot area (m²) */
  area: number;
  /** the road the plot fronts, as wide as it is today (m) */
  road: number;
  /** the width the Development Plan gives that road (m), if wider: the rules go by it, and the widening takes a strip */
  dp?: number;
  /** the plot's length along the road (m); a square plot if not given */
  frontage?: number;
  /** the strip the DP road takes is handed over, and its basic FSI used on the rest of the plot */
  credit?: boolean;
}

export interface FsiResult {
  rules: PlotRules;
  /** the road width the rules go by (the DP width where it's wider) */
  roadW: number;
  frontage: number; depth: number; squareAssumed: boolean;
  /** land the DP widening takes (m²), and what's left */
  lost: number; net: number;
  /** built-up area by source (m²) */
  parts: { basic: number; premium: number; tdr: number; credit: number; extra: number };
  /** basic + premium + TDR (+ credit), and with ancillary / fungible on top */
  consumed: number; bua: number;
  /** the lowest number of floors that fits it inside the margins, as a rectangle frontage × depth */
  floors: number; height: number; plate: number; built: number;
  /** what stops it using all its built-up area */
  limit: 'height' | 'margins' | null;
}

/** What a plot can build: the rule tables' FSI for the road width, on the plot, as the plot sandbox works it out. */
export function calcFsi(i: FsiInput): FsiResult {
  const area = Math.max(0, i.area);
  const dp = i.dp && i.dp > i.road ? i.dp : 0;
  const roadW = dp || i.road;
  const r = rulesFor(roadW, i.zone, i.use);
  const squareAssumed = !(i.frontage && i.frontage > 0);
  const frontage = squareAssumed ? Math.sqrt(area) : Math.min(i.frontage!, area || i.frontage!);
  const depth = frontage > 0 ? area / frontage : 0;
  // the widening is taken equally from both sides of the road: half the difference comes off the front
  const cut = dp ? Math.min(depth, (dp - i.road) / 2) : 0;
  const lost = frontage * cut, net = area - lost;
  const base = { basic: r.basic * net, premium: r.premium * area, tdr: r.tdr * area, credit: i.credit ? r.basic * lost : 0 };
  const consumed = base.basic + base.premium + base.tdr + base.credit;
  const parts = { ...base, extra: consumed * r.ancillary };
  const bua = consumed + parts.extra;
  // floors: taller means wider side margins (H/5, at most 12 m) and a smaller footprint; the lowest that builds the most
  const maxFloors = Math.floor(r.maxH / r.floorH + 1e-6);
  let floors = 0, plate = 0, built = 0;
  for (let n = 1; n <= maxFloors; n++) {
    const sd = Math.round(sideMargin(r, n * r.floorH) * 100) / 100;
    const fp = Math.max(0, frontage - 2 * sd) * Math.max(0, depth - cut - r.front - sd);
    if (fp < 1) break;
    const b = Math.min(bua, n * fp);
    if (b > built + 0.5) { built = b; floors = n; plate = fp; }
    if (b >= bua) break;
  }
  const limit = bua - built <= 1 ? null : floors === maxFloors ? 'height' : 'margins';
  return { rules: r, roadW, frontage, depth, squareAssumed, lost, net, parts, consumed, bua, floors, height: floors * r.floorH, plate, built, limit };
}

// ---------- units ----------

export type AreaUnit = 'm2' | 'sqft' | 'sqyd' | 'guntha' | 'acre';
export const UNITS: { value: AreaUnit; label: string; m2: number }[] = [
  { value: 'sqft', label: 'sq ft', m2: 0.09290304 },
  { value: 'm2', label: 'm²', m2: 1 },
  { value: 'sqyd', label: 'sq yd', m2: 0.83612736 },
  { value: 'guntha', label: 'guntha', m2: 101.17141 },
  { value: 'acre', label: 'acre', m2: 4046.8564 },
];
export const toM2 = (v: number, u: AreaUnit) => v * (UNITS.find((x) => x.value === u)?.m2 ?? 1);
export const SQFT = 10.7639104;

// ---------- the FSI maps ----------

/** Colour for an FSI (basic + premium + TDR), pale to dark through the brand's orange; the same in both cities. */
const RAMP: [number, string][] = [[1, '#f4e6c1'], [1.33, '#f7d08a'], [2, '#f3a45c'], [2.25, '#e9773c'], [2.5, '#d24f2a'], [2.75, '#a22d3b'], [3, '#5c1b4a']];
export function fsiColor(v: number): string {
  if (v <= RAMP[0][0]) return RAMP[0][1];
  for (let k = 1; k < RAMP.length; k++) {
    if (v <= RAMP[k][0] + 1e-6) {
      const [a, ca] = RAMP[k - 1], [b, cb] = RAMP[k];
      const t = (v - a) / (b - a);
      const ch = (c: string, s: number) => parseInt(c.slice(s, s + 2), 16);
      return '#' + [1, 3, 5].map((s) => Math.round(ch(ca, s) + (ch(cb, s) - ch(ca, s)) * t).toString(16).padStart(2, '0')).join('');
    }
  }
  return RAMP[RAMP.length - 1][1];
}

/**
 * Mumbai: is this point in the island city (wards A to G: Colaba to Mahim, Dharavi, Sion and Wadala)? An approximate
 * line along Mahim Creek, the Mithi river and the Sion–Chunabhatti edge; the harbour side east of it (Trombay,
 * Mahul, Chembur) is the suburbs. Good for colouring a city map, not for a plot on the boundary.
 */
const ISLAND_EDGE: [number, number][] = [[72.78, 19.038], [72.835, 19.040], [72.846, 19.047], [72.857, 19.053], [72.867, 19.051], [72.876, 19.045], [72.886, 19.030], [72.893, 19.0], [72.895, 18.88]];
export function inIslandCity(lat: number, lon: number): boolean {
  if (lon >= ISLAND_EDGE[ISLAND_EDGE.length - 1][0] || lon < ISLAND_EDGE[0][0]) return false;
  for (let k = 1; k < ISLAND_EDGE.length; k++) {
    const [x0, y0] = ISLAND_EDGE[k - 1], [x1, y1] = ISLAND_EDGE[k];
    if (lon <= x1) return lat < y0 + ((lon - x0) / (x1 - x0)) * (y1 - y0);
  }
  return false;
}

/** One FSI class on a city's FSI map: the zone, the road-width step, its FSI, colour and length of main road. */
export interface FsiBand { zone: FsiZone; lo: number; hi: number | null; fsi: number; color: string; km: number }
export interface FsiRoad { name: string; w: number; dp?: number; zone: FsiZone; fsi: number; km: number; at: [number, number]; near?: string }
export interface FsiMapData {
  svg: string; og: string; w: number; h: number;
  bands: FsiBand[];
  /** named main roads with the most FSI, and a sample of the least */
  top: FsiRoad[];
  /** km of main road whose rules go by the DP width (Pune) */
  dpKm?: number;
  /** the zoomable map's data: road classes, the two tiers of roads (paths under public/), the place pages */
  view?: FsiView;
}
export interface FsiView {
  /** metres per coordinate unit; the frame's size in units (x east, z south, from its top-left) */
  unit: number; w: number; h: number;
  /** the road classes the data's lines refer to, by index */
  classes: { fsi: number; color: string; lo: number; hi: number | null; zone: FsiZone }[];
  main: string; local: string; mainBytes: number; localBytes: number;
  places: { name: string; slug: string; x: number; z: number }[];
}
