// One call from a project to everything worked out from it: the plot report, the scheme (with shops if asked), the
// typical floor's windows and doors per building, the schedule and the light and ventilation checks. The UI, the
// options explorer, the screening table, the brief runner and the API all go through this, so they can't disagree.
import type { PlotReport } from '../doc/plot';
import type { SiteReport } from '../doc/site';
import { finishRate, languageOf, presetOf, siteKitOf, specRateNet, type DesignSystem, type FinishQty } from './design';
import { facadeTakeoff, type Takeoff } from './palette';
import type { Shops } from './mixed';
import { planFloor, schedule, type FloorPlan, type ScheduleRow, type UnitCheck } from './openings';
import { generate, loadOf, plotReport, type ProProject } from './project';
import { siteSystems, type SystemsResult } from './systems';
import { DEFAULT_SITE, SQFT } from '../doc/site';
import { layForm, type FormLayout } from './form';

export interface Evaluated {
  p: ProProject; ds: DesignSystem;
  r: PlotReport; d: SiteReport; shops: Shops | null;
  /** the plot with every FSI part the rules permit, whether the ladder takes it or not (the same as `r` when it
   *  takes them all) */
  full: PlotReport;
  plans: FloorPlan[]; rows: ScheduleRow[];
  /** the light and ventilation check per flat of the typical floor, with how many floors it repeats on */
  checks: (UnitCheck & { floors: number })[];
  /** the spec's addition to construction, ₹ per sq ft */
  rate: number;
  /** the building systems (lifts, MEP, fire, plant), sized for the scheme, and what they add over the systems a
   *  typical construction rate already carries (₹ per sq ft of built-up; negative when leaner) */
  sys: SystemsResult & { buildings: SystemsResult[] }; sysRate: number;
  /** the user's formed buildings laid out floor by floor (./form), by building id: what the engine counted, for the
   *  3D, the editor and the drawings to reuse rather than lay out again. A form that lays out to nothing is absent
   *  (its building stays the plain one of its spine). */
  forms: Record<string, FormLayout>;
  /** the outside of the slab buildings measured by tone and glass (./palette.ts): the palette's shares and the facade
   *  finishes' quantities */
  facade: Takeoff;
  /** those quantities per m² of built-up, as the finishes were priced with */
  finishQty: FinishQty;
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
  const ld = loadOf(p), full = ld.premium && ld.tdr && ld.ancillary ? r : plotReport(p, ds.floorH, true);
  // (the specification's extras and the chosen finishes over plain ones, ₹ per sq ft of built-up)
  const rate = specRateNet(ds) + finishRate(ds);
  // (the formed buildings laid out once, at the design system's floor height and each building's flat mix)
  const forms: Record<string, FormLayout> = {};
  for (const b of p.scheme?.buildings ?? []) {
    if (!b.form) continue;
    const L = layForm(b, { floorH: ds.floorH, mix: b.mix ?? p.mix, sizes: b.sizes ?? p.sizes ?? DEFAULT_SITE.sizes, round: languageOf(dsOfBuilding(p, 0, ds, b.id)).round });
    if (L && L.floors.length) forms[b.id] = L;
  }
  // (the design system's gates and internal roads go to the site engine: their widths)
  const sk = siteKitOf(ds), kit = { gateW: sk.gate.vehicle, roadW: sk.road.w };
  let { d, shops } = generate(p, r, rate, ds.premium, forms, kit);
  const sysOf = (x: typeof d) => siteSystems(x.buildings.map((b) => ({ b, settings: p.systems?.byBuilding?.[b.b.id] })), { under: x.under, floorH: ds.floorH, code: r.code, basements: x.site.basements, bays: x.parking.have, site: p.systems?.site });
  let sys = sysOf(d);
  // (a building with a style of its own takes that one's windows and doors)
  const planAll = (x: typeof d) => x.buildings.map((b, i) => planFloor(b, dsOfBuilding(p, i, ds, b.b.id), r.code === 'udcpr' ? 1 / 10 : 1 / 6));
  // (the facade measured from the model: its tones priced by their measured areas, not the rule of thumb)
  const measure = (x: typeof d, pl: FloorPlan[]) => {
    const T = facadeTakeoff(x, pl, (i) => dsOfBuilding(p, i, ds, x.buildings[i].b.id), r.rules.floorH, p.north ?? 0);
    const q: FinishQty = T.total > 0 && x.bua > 0 ? { wall: T.area.wall / x.bua, accent: T.area.accent / x.bua, base: T.area.base / x.bua } : {};
    return { T, q, rate: specRateNet(ds) + finishRate(ds, q) };
  };
  let plans = planAll(d), M = measure(d, plans);
  // (the systems as sized, over a typical construction rate's, and the measured finishes: the money worked out again)
  const bua = d.bua * SQFT, sysRate = bua > 0 ? Math.round(sys.cost / bua - TYPICAL_SYSTEMS) : 0;
  let used = rate;
  if (sysRate || M.rate !== rate) {
    used = M.rate;
    ({ d, shops } = generate(p, r, used + sysRate, ds.premium, forms, kit)); sys = sysOf(d);
    plans = planAll(d); M = measure(d, plans);
  }
  const rows = schedule(d, plans, ds, (bi, ui) => (shops?.removed.get(bi)?.has(ui) ? shops.upperOf[bi] : 0));
  // (a formed building's typical floor repeats only on the floors like it)
  const checks = plans.flatMap((pl, i) => pl.checks.map((c) => ({ ...c, floors: d.buildings[i].repeats ?? d.buildings[i].floors })));
  return { p, ds, r, full, d, shops, plans, rows, checks, rate: used, sys, sysRate, forms, facade: M.T, finishQty: M.q };
}
