// A Pro project: a plot set up by its outline and the roads along its edges (no city map needed), the rules it falls under,
// the builder's design system, and what the generator is asked for. Turned into the same PlotReport and SiteReport
// the editor's Site Studio works from (src/doc/plot.ts, site.ts, optimise.ts), so both give the same numbers.
import { analysePlot, type PlotCode, type PlotReport } from '../doc/plot';
import { defaultCosts, solveSite, type SiteReport } from '../doc/site';
import { DEFAULT_DESIGN, optimise, siteDefaults, type Typology } from '../doc/optimise';
import type { CityDoc } from '../doc/doc';
import type { Compiler } from '../doc/compile';
import type { PlotObj } from '../doc/types';
import { withShops, type Shops } from './mixed';

export type ProCity = 'pune' | 'pune-congested' | 'mumbai-island' | 'mumbai-suburbs';
export const CITIES: { value: ProCity; label: string; code: PlotCode; note: string }[] = [
  { value: 'pune', label: 'Pune (UDCPR)', code: 'udcpr', note: 'UDCPR 2020, municipal corporation (Table 6-G)' },
  { value: 'pune-congested', label: 'Pune old city', code: 'udcpr', note: 'UDCPR 2020 congested areas (Table 6-A)' },
  { value: 'mumbai-suburbs', label: 'Mumbai suburbs', code: 'dcpr-suburbs', note: 'DCPR 2034, suburbs (values from published summaries)' },
  { value: 'mumbai-island', label: 'Mumbai island city', code: 'dcpr-island', note: 'DCPR 2034, island city (values from published summaries)' },
];

/** a road along one edge of a drawn plot: its width today and in the Development Plan (0: none wider) */
export interface EdgeRoad { today: number; dp: number }

export interface ProProject {
  v: 1;
  name: string;
  city: ProCity;
  /** a rectangle by its size, or an outline drawn corner by corner */
  shape?: 'rect' | 'poly';
  /** the drawn outline (x, z, … in metres; z away from the front) and a road (or none) along each edge, from corner k to k + 1 */
  ring?: number[]; edgeRoads?: (EdgeRoad | null)[];
  /** the plot as a rectangle: along the road (frontage) and back from it (m) */
  width: number; depth: number;
  /** the road in front: today's width and the Development Plan's (0: none wider) */
  road: number; dpRoad: number;
  /** a corner plot: a second road down the left side */
  corner: boolean; sideRoad: number;
  /** what the generator is asked for */
  typology: Typology; maxFloors: number;
  /** flat mix (1 / 2 / 3 BHK shares) */
  mix: [number, number, number];
  /** the design system: a preset, and the project's own copy once any token is changed */
  style: string;
  custom: import('./design').DesignSystem | null;
  /** sale price, ₹ per sq ft of RERA carpet (0: the city's starting figure) */
  sale: number;
  /** land, ₹ per sq ft of plot (0: the city's starting figure) */
  land?: number;
  /** shops along the front road: floors of them (0: none), how deep, and their sale price (₹/sq ft carpet; 0: the starting figure) */
  shops?: { floors: number; depth: number; sale: number };
}

/** shops sell at about this many times the flats' rate until a price is put in */
export const SHOP_PREMIUM = 1.8;

export const DEFAULT_PROJECT: ProProject = {
  v: 1, name: 'Untitled project', city: 'pune', width: 40, depth: 50, road: 12, dpRoad: 18, corner: false, sideRoad: 9,
  typology: 'auto', maxFloors: 0, mix: [0.2, 0.5, 0.3], style: 'contemporary', custom: null, sale: 0,
};

/** The plot's outline and the road along each edge: the rectangle as an outline (front edge first, along x at z = 0,
 *  the corner road down the left side), or the drawn one. */
export function outline(p: ProProject): { ring: number[]; roads: (EdgeRoad | null)[] } {
  if (p.shape === 'poly' && p.ring && p.ring.length >= 6) {
    const n = p.ring.length / 2;
    return { ring: p.ring, roads: Array.from({ length: n }, (_, k) => p.edgeRoads?.[k] ?? null) };
  }
  const hw = p.width / 2;
  return {
    ring: [-hw, 0, hw, 0, hw, p.depth, -hw, p.depth],
    roads: [{ today: p.road, dp: p.dpRoad }, null, null, p.corner ? { today: p.sideRoad, dp: 0 } : null],
  };
}

/** signed area of a ring (x, z): positive counter-clockwise as x right, z up */
const signed = (r: number[]) => { let a = 0; for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; a += r[i] * r[j + 1] - r[j] * r[i + 1]; } return a / 2; };

/** Does any edge of the ring cross another (not its neighbours)? */
export function crosses(r: number[]): boolean {
  const n = r.length / 2;
  const seg = (k: number) => [r[2 * k], r[2 * k + 1], r[(2 * k + 2) % r.length], r[(2 * k + 3) % r.length]];
  const side = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => Math.sign((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (j === i + 1 || (i === 0 && j === n - 1)) continue;
    const [a, b, c, d] = seg(i), [e, f, g, h] = seg(j);
    if (side(a, b, c, d, e, f) * side(a, b, c, d, g, h) < 0 && side(e, f, g, h, a, b) * side(e, f, g, h, c, d) < 0) return true;
  }
  return false;
}

/** Each road's centre line: the edge moved out by half the road, run on well past the plot. */
export function roadLines(ring: number[], roads: (EdgeRoad | null)[]): { k: number; road: EdgeRoad; pts: [number, number, number, number] }[] {
  const ccw = signed(ring) > 0, out: { k: number; road: EdgeRoad; pts: [number, number, number, number] }[] = [];
  roads.forEach((road, k) => {
    if (!road || road.today <= 0) return;
    const i = 2 * k, j = (i + 2) % ring.length;
    const ax = ring[i], az = ring[i + 1], bx = ring[j], bz = ring[j + 1], L = Math.hypot(bx - ax, bz - az);
    if (L < 0.5) return;
    const ux = (bx - ax) / L, uz = (bz - az) / L;
    // outward: right of the edge on a counter-clockwise ring
    const nx = ccw ? uz : -uz, nz = ccw ? -ux : ux, o = road.today / 2, ext = 300;
    out.push({ k, road, pts: [ax + nx * o - ux * ext, az + nz * o - uz * ext, bx + nx * o + ux * ext, bz + nz * o + uz * ext] });
  });
  return out;
}

/** The plot against its roads, under its city's rules. */
export function plotReport(p: ProProject, floorH = 3): PlotReport {
  const cfg = CITIES.find((c) => c.value === p.city) ?? CITIES[0];
  const { ring, roads } = outline(p);
  const lines = roadLines(ring, roads);
  const ids = lines.map((l) => `e${l.k}`);
  const sections = new Map(lines.map((l, i) => [ids[i], {
    kind: 'section', id: ids[i], name: i === 0 ? 'Front road' : `Road on edge ${l.k + 1}`, parts: [{ kind: 'lane', width: l.road.today }],
    reserve: l.road.dp > l.road.today ? l.road.dp : undefined, cls: 'tertiary', elevated: false,
  }]));
  const geo = new Map(lines.map((l, i) => [ids[i], { pts: l.pts }]));
  const doc = { get: (id: string) => sections.get(id) } as unknown as CityDoc;
  const C = { geo: (id: string) => geo.get(id) } as unknown as Compiler;
  const plot: PlotObj = { kind: 'plot', id: 'plot', name: p.name, use: 'residential', congested: p.city === 'pune-congested', rules: { floorH }, ring };
  return analysePlot(doc, C, () => ids, plot, cfg.code);
}

/** The generated scheme on it, with shops along the front if asked for (./mixed.ts). */
export function generate(p: ProProject, r: PlotReport, specRate = 0, premium = 0): { d: SiteReport; shops: Shops | null } {
  const c = defaultCosts(r.code, 'residential');
  const cost = { build: c.build + specRate, ...(p.land ? { land: p.land } : {}), sale: p.sale > 0 ? p.sale : Math.round((c.sale * (1 + premium)) / 50) * 50 };
  const base = { ...siteDefaults('residential'), mix: p.mix, cost, design: { ...DEFAULT_DESIGN, type: p.typology, maxFloors: p.maxFloors } };
  const site = optimise(r, base, 'residential');
  const sh = p.shops;
  if (!sh || sh.floors <= 0) return { d: solveSite(r, site, 'residential'), shops: null };
  return withShops(r, site, 'residential', sh, sh.sale > 0 ? sh.sale : Math.round((cost.sale * SHOP_PREMIUM) / 50) * 50);
}
