// One call from a project to everything worked out from it: the plot report, the scheme (with shops if asked), the
// typical floor's windows and doors per building, the schedule and the light and ventilation checks. The UI, the
// options explorer, the screening table, the brief runner and the API all go through this, so they can't disagree.
import type { PlotReport } from '../doc/plot';
import type { SiteReport } from '../doc/site';
import { finishRate, presetOf, specRateNet, type DesignSystem } from './design';
import type { Shops } from './mixed';
import { planFloor, schedule, type FloorPlan, type ScheduleRow, type UnitCheck } from './openings';
import { generate, plotReport, type ProProject } from './project';
import { siteSystems, type SystemsResult } from './systems';
import { SQFT } from '../doc/site';

export interface Evaluated {
  p: ProProject; ds: DesignSystem;
  r: PlotReport; d: SiteReport; shops: Shops | null;
  plans: FloorPlan[]; rows: ScheduleRow[];
  /** the light and ventilation check per flat of the typical floor, with how many floors it repeats on */
  checks: (UnitCheck & { floors: number })[];
  /** the spec's addition to construction, ₹ per sq ft */
  rate: number;
  /** the building systems (lifts, MEP, fire, plant), sized for the scheme, and what they add over the systems a
   *  typical construction rate already carries (₹ per sq ft of built-up; negative when leaner) */
  sys: SystemsResult & { buildings: SystemsResult[] }; sysRate: number;
}

/** the systems a typical construction rate already carries, ₹ per sq ft of built-up (as assumed) */
export const TYPICAL_SYSTEMS = 550;

/** The design system a project uses: its own copy once changed, else its preset. */
export const designOf = (p: ProProject): DesignSystem => p.custom ?? presetOf(p.style);

/** A building's design system: its own preset if it has one, else the project's. The user's own buildings carry
 *  theirs (by id); the fill's go by their place in the list. */
export const dsOfBuilding = (p: ProProject, i: number, ds = designOf(p), id?: string): DesignSystem => {
  const own = p.scheme && id ? p.scheme.buildings.find((b) => b.id === id)?.style : undefined;
  const s = p.scheme ? own : p.buildingStyle?.[i];
  return s ? presetOf(s) : ds;
};

export function evaluate(p: ProProject): Evaluated {
  const ds = designOf(p);
  const r = plotReport(p, ds.floorH);
  // (the specification's extras and the chosen finishes over plain ones, ₹ per sq ft of built-up)
  const rate = specRateNet(ds) + finishRate(ds);
  let { d, shops } = generate(p, r, rate, ds.premium);
  const sysOf = (x: typeof d) => siteSystems(x.buildings.map((b) => ({ b, settings: p.systems?.byBuilding?.[b.b.id] })), { under: x.under, floorH: ds.floorH, code: r.code, basements: x.site.basements, bays: x.parking.have, site: p.systems?.site });
  let sys = sysOf(d);
  // (the systems as sized, over a typical construction rate's: the money worked out again with them)
  const bua = d.bua * SQFT, sysRate = bua > 0 ? Math.round(sys.cost / bua - TYPICAL_SYSTEMS) : 0;
  if (sysRate) { ({ d, shops } = generate(p, r, rate + sysRate, ds.premium)); sys = sysOf(d); }
  // (a building with a style of its own takes that one's windows and doors)
  const plans = d.buildings.map((b, i) => planFloor(b, dsOfBuilding(p, i, ds, b.b.id), r.code === 'udcpr' ? 1 / 10 : 1 / 6));
  const rows = schedule(d, plans, ds, (bi, ui) => (shops?.removed.get(bi)?.has(ui) ? shops.upperOf[bi] : 0));
  const checks = plans.flatMap((pl, i) => pl.checks.map((c) => ({ ...c, floors: d.buildings[i].floors })));
  return { p, ds, r, d, shops, plans, rows, checks, rate, sys, sysRate };
}
