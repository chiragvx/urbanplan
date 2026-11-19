// A Pro project: a plot set up by its size and the roads it fronts (no city map needed), the rules it falls under,
// the builder's design system, and what the generator is asked for. Turned into the same PlotReport and SiteReport
// the editor's Site Studio works from (src/doc/plot.ts, site.ts, optimise.ts), so both give the same numbers.
import { analysePlot, type PlotCode, type PlotReport } from '../doc/plot';
import { defaultCosts, solveSite, type SiteReport } from '../doc/site';
import { DEFAULT_DESIGN, optimise, siteDefaults, type Typology } from '../doc/optimise';
import type { CityDoc } from '../doc/doc';
import type { Compiler } from '../doc/compile';
import type { PlotObj } from '../doc/types';

export type ProCity = 'pune' | 'pune-congested' | 'mumbai-island' | 'mumbai-suburbs';
export const CITIES: { value: ProCity; label: string; code: PlotCode; note: string }[] = [
  { value: 'pune', label: 'Pune (UDCPR)', code: 'udcpr', note: 'UDCPR 2020, municipal corporation (Table 6-G)' },
  { value: 'pune-congested', label: 'Pune old city', code: 'udcpr', note: 'UDCPR 2020 congested areas (Table 6-A)' },
  { value: 'mumbai-suburbs', label: 'Mumbai suburbs', code: 'dcpr-suburbs', note: 'DCPR 2034, suburbs (values from published summaries)' },
  { value: 'mumbai-island', label: 'Mumbai island city', code: 'dcpr-island', note: 'DCPR 2034, island city (values from published summaries)' },
];

export interface ProProject {
  v: 1;
  name: string;
  city: ProCity;
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
}

export const DEFAULT_PROJECT: ProProject = {
  v: 1, name: 'Untitled project', city: 'pune', width: 40, depth: 50, road: 12, dpRoad: 18, corner: false, sideRoad: 9,
  typology: 'auto', maxFloors: 0, mix: [0.2, 0.5, 0.3], style: 'contemporary', custom: null, sale: 0,
};

/** The plot against its roads: a front road along x at z = 0, the plot behind it; a corner road down its left side. */
export function plotReport(p: ProProject, floorH = 3): PlotReport {
  const cfg = CITIES.find((c) => c.value === p.city) ?? CITIES[0];
  const front = { kind: 'section', id: 'front', name: 'Front road', parts: [{ kind: 'lane', width: p.road }], reserve: p.dpRoad > p.road ? p.dpRoad : undefined, cls: 'tertiary', elevated: false };
  const side = { kind: 'section', id: 'side', name: 'Side road', parts: [{ kind: 'lane', width: p.sideRoad }], cls: 'residential', elevated: false };
  const hw = p.width / 2, sx = -hw - p.sideRoad / 2, z0 = p.road / 2;
  const doc = { get: (id: string) => (id === 'front' ? front : id === 'side' && p.corner ? side : undefined) } as unknown as CityDoc;
  const C = { geo: (id: string) => (id === 'front' ? { pts: [-hw - 400, 0, hw + 400, 0] } : id === 'side' && p.corner ? { pts: [sx, -400, sx, z0 + p.depth + 400] } : undefined) } as unknown as Compiler;
  const plot: PlotObj = {
    kind: 'plot', id: 'plot', name: p.name, use: 'residential', congested: p.city === 'pune-congested', rules: { floorH },
    // (behind today's road edge: the DP line cuts the strip the widening takes)
    ring: [-hw, p.road / 2, hw, p.road / 2, hw, p.road / 2 + p.depth, -hw, p.road / 2 + p.depth],
  };
  return analysePlot(doc, C, () => (p.corner ? ['front', 'side'] : ['front']), plot, cfg.code);
}

/** The generated scheme on it. */
export function generate(p: ProProject, r: PlotReport, specRate = 0, premium = 0): SiteReport {
  const c = defaultCosts(r.code, 'residential');
  const cost = { build: c.build + specRate, ...(p.land ? { land: p.land } : {}), sale: p.sale > 0 ? p.sale : Math.round((c.sale * (1 + premium)) / 50) * 50 };
  const base = { ...siteDefaults('residential'), mix: p.mix, cost, design: { ...DEFAULT_DESIGN, type: p.typology, maxFloors: p.maxFloors } };
  const site = optimise(r, base, 'residential');
  return solveSite(r, site, 'residential');
}
