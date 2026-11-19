// One call from a project to everything worked out from it: the plot report, the scheme (with shops if asked), the
// typical floor's windows and doors per building, the schedule and the light and ventilation checks. The UI, the
// options explorer, the screening table, the brief runner and the API all go through this, so they can't disagree.
import type { PlotReport } from '../doc/plot';
import type { SiteReport } from '../doc/site';
import { presetOf, specRate, type DesignSystem } from './design';
import type { Shops } from './mixed';
import { planFloor, schedule, type FloorPlan, type ScheduleRow, type UnitCheck } from './openings';
import { generate, plotReport, type ProProject } from './project';

export interface Evaluated {
  p: ProProject; ds: DesignSystem;
  r: PlotReport; d: SiteReport; shops: Shops | null;
  plans: FloorPlan[]; rows: ScheduleRow[];
  /** the light and ventilation check per flat of the typical floor, with how many floors it repeats on */
  checks: (UnitCheck & { floors: number })[];
  /** the spec's addition to construction, ₹ per sq ft */
  rate: number;
}

/** The design system a project uses: its own copy once changed, else its preset. */
export const designOf = (p: ProProject): DesignSystem => p.custom ?? presetOf(p.style);

/** A building's design system: its own preset if it has one, else the project's. */
export const dsOfBuilding = (p: ProProject, i: number, ds = designOf(p)): DesignSystem => (p.buildingStyle?.[i] ? presetOf(p.buildingStyle[i]) : ds);

export function evaluate(p: ProProject): Evaluated {
  const ds = designOf(p);
  const r = plotReport(p, ds.floorH);
  const rate = specRate(ds);
  const { d, shops } = generate(p, r, rate, ds.premium);
  // (a building with a style of its own takes that one's windows and doors)
  const plans = d.buildings.map((b, i) => planFloor(b, dsOfBuilding(p, i, ds), r.code === 'udcpr' ? 1 / 10 : 1 / 6));
  const rows = schedule(d, plans, ds, (bi, ui) => (shops?.removed.get(bi)?.has(ui) ? shops.upperOf[bi] : 0));
  const checks = plans.flatMap((pl, i) => pl.checks.map((c) => ({ ...c, floors: d.buildings[i].floors })));
  return { p, ds, r, d, shops, plans, rows, checks, rate };
}
