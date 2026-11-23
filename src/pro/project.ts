// A Pro project: a plot set up by its outline and the roads along its edges (no city map needed), the rules it falls under,
// the builder's design system, and what the generator is asked for. Turned into the same PlotReport and SiteReport
// the editor's Site Studio works from (src/doc/plot.ts, site.ts, optimise.ts), so both give the same numbers.
import { analysePlot, useInfo, type PlotCode, type PlotReport, type PlotRules, type PlotUse } from '../doc/plot';
import { defaultCosts, FLOOR_USE, solveSite, type Laid, type PlotSite, type UseRates, type SiteBuilding, type SiteElement, type SiteReport } from '../doc/site';
import type { Form, FormLayout } from './form/types';
import { DEFAULT_DESIGN, optimise, park, siteDefaults, type Access, type Typology } from '../doc/optimise';
import type { CityDoc } from '../doc/doc';
import type { Compiler } from '../doc/compile';
import type { PlotObj } from '../doc/types';
import { withShops, type Shops } from './mixed';
import { keepOutOf, type Levels, type SiteFeature } from './siteObjects';

export type ProCity = 'pune' | 'pune-congested' | 'mumbai-island' | 'mumbai-suburbs';
export const CITIES: { value: ProCity; label: string; code: PlotCode; note: string }[] = [
  { value: 'pune', label: 'Pune (UDCPR)', code: 'udcpr', note: 'UDCPR 2020, municipal corporation (Table 6-G)' },
  { value: 'pune-congested', label: 'Pune old city', code: 'udcpr', note: 'UDCPR 2020 congested areas (Table 6-A)' },
  { value: 'mumbai-suburbs', label: 'Mumbai suburbs', code: 'dcpr-suburbs', note: 'DCPR 2034, suburbs (values from published summaries)' },
  { value: 'mumbai-island', label: 'Mumbai island city', code: 'dcpr-island', note: 'DCPR 2034, island city (values from published summaries)' },
];

/** a road along one edge of a drawn plot: its width today and in the Development Plan (0: none wider) */
export interface EdgeRoad { today: number; dp: number }

/** A building the user owns (placed, shaped, or filled for them then changed): the engine's building with a name,
 *  its own design system and its systems' settings (./systems.ts). Its own `mix` and `floors` are the engine's. */
export interface ProBuilding extends SiteBuilding {
  name?: string;
  /** a design system preset id (unset: the project's) */
  style?: string;
  /** its form, made by hand or from a template (./form): unset, the engine's straight building of spine and depth */
  form?: import('./form/types').Form;
}

/** What "Fill the plot" is asked for: how much of what the rules allow, how many buildings, how they're reached and
 *  spaced, the green and the play area, where the cars go. The building type and the most floors are the project's
 *  `typology` and `maxFloors`. */
export interface Fill {
  /** share of the permissible built-up area to use (0.3 to 1) */
  amount: number;
  /** at most this many buildings (0: as many as fit) */
  buildings: number;
  /** metres more between buildings than the rules ask */
  spacing: number;
  access: Access;
  /** % of the plot kept green, at least (the open space the rules ask for is kept anyway) */
  green: number;
  /** a play area in the open space */
  play: boolean;
  /** where the cars go */
  parking: 'auto' | 'stilt' | 'basement' | 'podium' | 'surface';
  /** levels under the ground (unset: as many as the parking needs) */
  basements?: number;
}
export const DEFAULT_FILL: Fill = { amount: 1, buildings: 0, spacing: 0, access: 'perimeter', green: 0, play: true, parking: 'auto' };

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
  /** flat sizes: 1 / 2 / 3 BHK RERA carpet (m²; unset: the starting sizes, 42, 65 and 95 m²) */
  sizes?: [number, number, number];
  /** the design system: a preset, and the project's own copy once any token is changed */
  style: string;
  custom: import('./design').DesignSystem | null;
  /** sale price, ₹ per sq ft of RERA carpet (0: the city's starting figure) */
  sale: number;
  /** land, ₹ per sq ft of plot (0: the city's starting figure) */
  land?: number;
  /** shops along the front road: floors of them (0: none), how deep, and their sale price (₹/sq ft carpet; 0: the starting figure) */
  shops?: { floors: number; depth: number; sale: number };
  /** the site's own limits: a height cap (airport clearance, fire, a heritage zone: m, 0 none), and a transit
   *  zone (near a metro station: the FSI goes up to `todFsi` with premium) */
  limits?: { maxH: number; tod: boolean; todFsi: number };
  /** the deal on the land (./deal.ts): outright purchase, a joint development, a society's redevelopment */
  deal?: import('./deal').Deal;
  /** a building's own design system (a preset id, by building index): the layer under the project's style */
  buildingStyle?: Record<number, string>;
  /** the money model's timing and overheads, over the city's starting figures */
  costs?: { months?: number; presold?: number; soft?: number };
  /** a formed building's offices and hotel: rent, operating profit and the yields they're valued at, over the city's
   *  starting figures (src/doc/site.ts useRates) */
  rents?: Partial<UseRates>;
  /** what the plot sits in, for the NOCs */
  approval?: { nearAirport?: boolean; trees?: boolean; heritage?: boolean; kind?: import('./approvals').PermissionKind };
  /** what's on and round the plot: obstructions and no-build zones (./siteObjects.ts) */
  features?: SiteFeature[];
  /** where the plot is (latitude, longitude), when it was found or imported with a real place */
  at?: [number, number];
  /** the plot's levels */
  levels?: Levels;
  /** where north is: degrees the plot is turned clockwise (0: north is straight back from the front road) */
  north?: number;
  /** what "Fill the plot" is asked for */
  fill?: Partial<Fill>;
  /** the buildings and the site's other things once the user owns them (filled then shaped, or placed by hand);
   *  unset: the fill, worked out afresh on every change */
  scheme?: { buildings: ProBuilding[]; elements: SiteElement[] };
  /** the building systems' settings (./systems.ts): the site's plant, and each building's own by its id */
  systems?: { site?: import('./systems').SystemsSettings; byBuilding?: Record<string, import('./systems').SystemsSettings> };
  /** where the project is: looking at the land, designing the scheme, or applying for permission (set by the user) */
  stage?: Stage;
  /** the dashboard's Sites entry it was opened from (./sites.ts), so Sites can show its stage and open it again */
  site?: string;
  /** the FSI ladder: which of the paid parts on top of basic FSI are taken (unset: taken). Basic is always taken. */
  load?: Partial<Load>;
  /** what the land is worth is worked out for: a margin on revenue, or an IRR (a share: 0.2 is 20%) */
  target?: { by: 'margin' | 'irr'; v: number };
  /** the options: other schemes on the same plot (./variants.ts); the project's own fields are the current one's */
  options?: import('./variants').ProOption[];
  /** the option the project's fields are */
  option?: string;
  /** the option chosen to take forward */
  chosen?: string;
  /** a new project whose plot hasn't been set yet: the view shows the ways in (./start.tsx) */
  blank?: boolean;
  /** what the project is: the use its buildings take unless they say otherwise (unset: homes). Its rules, fill and
   *  parking follow it (docs/plans/pro-design-freedom.md §2) */
  use?: ProjectUse;
  /** who it's for: sold (profit, IRR, what the land is worth), or built for a client or for the owner's own use (what
   *  it costs). Unset: sold */
  purpose?: Purpose;
}

/** What a project is. Homes over shops is homes with a floor of shops along the front road (`shops`). */
export type ProjectUse = 'residential' | 'mixed' | 'commercial' | 'shops' | 'hospital' | 'school' | 'government' | 'custom' | 'none';
export const PROJECT_USES: { value: ProjectUse; label: string; icon: string }[] = [
  { value: 'residential', label: 'Homes', icon: 'home' },
  { value: 'mixed', label: 'Homes over shops', icon: 'building' },
  { value: 'commercial', label: 'Offices', icon: 'briefcase' },
  { value: 'shops', label: 'Shops', icon: 'shop' },
  { value: 'hospital', label: 'Clinic or hospital', icon: 'plus' },
  { value: 'school', label: 'School', icon: 'school' },
  { value: 'government', label: 'Public building', icon: 'people' },
  { value: 'custom', label: 'Something else', icon: 'cube' },
  { value: 'none', label: 'Not decided yet', icon: 'circle' },
];
export type Purpose = 'sale' | 'client' | 'own';
export const PURPOSES: { value: Purpose; label: string; sub: string }[] = [
  { value: 'sale', label: 'To sell', sub: 'profit, IRR, what the land is worth' },
  { value: 'client', label: 'For a client', sub: 'what it costs to build' },
  { value: 'own', label: 'For my own use', sub: 'what it costs to build' },
];
/** the project's use as the engine reads it (homes over shops is homes, with its shops) */
export const plotUseOf = (p: Pick<ProProject, 'use'>): PlotUse => (!p.use || p.use === 'mixed' ? 'residential' : p.use);
export const purposeOf = (p: Pick<ProProject, 'purpose'>): Purpose => p.purpose ?? 'sale';
/** sold: profit and IRR mean something (a public building or one built for a client or its owner isn't) */
export const sold = (p: Pick<ProProject, 'purpose' | 'use'>) => purposeOf(p) === 'sale' && useInfo(plotUseOf(p)).sells;
/** whether the project has homes: its use, or any of its buildings' */
export function hasHomes(p: Pick<ProProject, 'use' | 'scheme'>): boolean {
  if (plotUseOf(p) === 'residential') return true;
  return (p.scheme?.buildings ?? []).some((b) => (b.form ? b.form.uses.some((u) => u.use === 'residential') : b.use === 'residential'));
}
/** The change for a new answer to what it is or who it's for: homes over shops brings a floor of shops at the front
 *  (unless it has some), and going back to homes from it takes them off. */
export function framed(p: ProProject, x: { use?: ProjectUse; purpose?: Purpose }): Partial<ProProject> {
  const out: Partial<ProProject> = { ...x };
  if (x.use === 'mixed' && !(p.shops && p.shops.floors > 0)) out.shops = { depth: 9, sale: 0, ...(p.shops ?? {}), floors: 1 };
  if (x.use === 'residential' && p.use === 'mixed' && p.shops) out.shops = { ...p.shops, floors: 0 };
  return out;
}
/** what a project is, in a few words: "Clinic or hospital · for a client" (nothing for homes to sell, the old default) */
export function framingOf(p: Pick<ProProject, 'use' | 'purpose'>): string {
  if (!p.use && !p.purpose) return '';
  const u = PROJECT_USES.find((x) => x.value === (p.use ?? 'residential'))!.label, w = purposeOf(p);
  return w === 'sale' ? `${u} to sell` : `${u} · ${w === 'client' ? 'for a client' : 'own use'}`;
}

/** The FSI ladder: basic, then premium (paid to the authority), TDR (bought in the market) and ancillary or
 *  fungible (paid, a share of the rest), each taken or left. */
export interface Load { premium: boolean; tdr: boolean; ancillary: boolean }
export const loadOf = (p: ProProject): Load => ({ premium: p.load?.premium !== false, tdr: p.load?.tdr !== false, ancillary: p.load?.ancillary !== false });
export type Stage = 'looking' | 'designing' | 'applying';
export const STAGE_LABEL: Record<Stage, string> = { looking: 'Looking', designing: 'Designing', applying: 'Applying' };
export const STAGE_SUB: Record<Stage, string> = { looking: 'Sizing up the land', designing: 'Working on the scheme', applying: 'Filing for permission' };
export const stageOf = (p: ProProject): Stage => p.stage ?? 'designing';
export const STAGES: Stage[] = ['looking', 'designing', 'applying'];
export const DEFAULT_TARGET = { by: 'margin' as const, v: 0.2 };
export const targetOf = (p: ProProject) => p.target ?? DEFAULT_TARGET;

export const fillOf = (p: ProProject): Fill => ({ ...DEFAULT_FILL, ...(p.fill ?? {}) });

/** parking as asked for, as the engine's settings */
function parkingOf(f: Fill): Partial<PlotSite> {
  switch (f.parking) {
    case 'stilt': return { stilt: true, podium: 0, surfacePick: false };
    case 'basement': return { stilt: false, podium: 0, surfacePick: false };
    case 'podium': return { stilt: false, podium: 2, surfacePick: false };
    case 'surface': return { stilt: false, podium: 0, surfacePick: true };
    default: return {};
  }
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

/** The plot against its roads, under its city's rules, with only the FSI the ladder takes (`all`: every part, as
 *  the rules permit it). */
export function plotReport(p: ProProject, floorH = 3, all = false): PlotReport {
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
  const plot: PlotObj = { kind: 'plot', id: 'plot', name: p.name, use: plotUseOf(p), congested: p.city === 'pune-congested', rules: { floorH }, ring };
  const r = analysePlot(doc, C, () => ids, plot, cfg.code);
  const L = p.limits, ld = loadOf(p);
  const laddered = !all && (!ld.premium || !ld.tdr || !ld.ancillary);
  if ((!L || (!(L.maxH > 0) && !L.tod)) && !laddered) return r;
  // the site's limits on top of the code's: a lower height cap; in a transit zone, premium FSI up to the zone's total
  // (as Maharashtra's TOD policy allows on wide enough roads; check the notified zone)
  const rules: Partial<PlotRules> = { floorH };
  if (L && L.maxH > 0) rules.maxH = Math.min(r.rules.maxH, L.maxH);
  if (L?.tod && r.roadW >= 9) rules.premium = Math.max(r.rules.premium, (L.todFsi || 4) - r.rules.basic - r.rules.tdr);
  // then the ladder: a part not taken isn't there to build with (or to pay for)
  if (laddered) {
    if (!ld.premium) rules.premium = 0;
    if (!ld.tdr) rules.tdr = 0;
    if (!ld.ancillary) rules.ancillary = 0;
  }
  return analysePlot(doc, C, () => ids, { ...plot, rules }, cfg.code);
}

/** A form's floors as the engine counts them (src/doc/site.ts Laid): each floor's area, height, units and use, the
 *  outline, the cores, and the share of the roof that counts in the height. UDCPR measures a building's height to
 *  the middle of a sloping roof, so half the rise of a pitched, curved or tilted roof counts; a flat roof's parapet
 *  doesn't. (A dome or crown is taken as a roof too, as assumed: an authority may treat it as an ornament instead.) */
export function laidOf(L: FormLayout, roof?: Form['roof']): Laid {
  const last = L.floors[L.floors.length - 1];
  const rise = roof && roof.kind !== 'flat' && last ? Math.max(0, L.top - (last.y + last.h)) : 0;
  return {
    outline: L.outline, cores: L.cores, roof: rise / 2,
    floors: L.floors.map((f) => ({ area: f.area, h: f.h, units: f.units, use: FLOOR_USE[f.use].plot, kind: f.use, ring: f.outer })),
  };
}

/** The generated scheme on it, with shops along the front if asked for (./mixed.ts). `forms`: the user's formed
 *  buildings laid out (by id, see ./evaluate.ts), each counted floor by floor; a building whose form lays out to
 *  nothing stays the plain building of its spine. */
export function generate(p: ProProject, r: PlotReport, specRate = 0, premium = 0, forms: Record<string, FormLayout> = {}, kit: { gateW?: number; roadW?: number } = {}): { d: SiteReport; shops: Shops | null } {
  const use = plotUseOf(p), c = defaultCosts(r.code, use);
  const cost = { ...(p.costs ?? {}), ...(p.rents ?? {}), build: c.build + specRate, ...(p.land ? { land: p.land } : {}), sale: p.sale > 0 ? p.sale : Math.round((c.sale * (1 + premium)) / 50) * 50, ...(p.shops && p.shops.sale > 0 ? { retail: p.shops.sale } : {}) };
  const f = fillOf(p);
  const base: PlotSite = {
    ...siteDefaults(use), ...parkingOf(f), mix: p.mix, ...(p.sizes ? { sizes: p.sizes } : {}), cost, keepOut: keepOutOf(p.features),
    design: { ...DEFAULT_DESIGN, type: p.typology, maxFloors: p.maxFloors, maxBuildings: f.buildings, spacing: f.spacing, access: f.access, green: f.green, ...kit },
  };
  // the user's own buildings: as they stand, checked
  if (p.scheme) {
    // (copies: `laid` is worked out afresh every time and must never reach the saved project)
    const buildings = p.scheme.buildings.map((b) => { const L = b.form ? forms[b.id] : undefined; return L ? { ...b, laid: laidOf(L, b.form?.roof) } : b; });
    // (the optimiser's own roads are dropped: the site derives them afresh from the buildings as they now stand)
    const handEls = (p.scheme.elements ?? []).filter((e) => !(e.auto && (e.kind === 'road' || e.kind === 'roundabout')));
    let own: PlotSite = { ...base, buildings, elements: handEls, manual: true, design: { ...DEFAULT_DESIGN, ...base.design, deriveRoads: true } };
    own = f.basements === undefined ? park(r, own, use) : { ...own, basements: f.basements };
    const sh = use === 'residential' ? p.shops : undefined;
    if (!sh || sh.floors <= 0) return { d: solveSite(r, own, use), shops: null };
    return withShops(r, own, use, sh, sh.sale > 0 ? sh.sale : Math.round((cost.sale * SHOP_PREMIUM) / 50) * 50);
  }
  let site = optimise(r, base, use);
  // 'auto' picks the layout that builds the most, which on a small plot can be a block too short for a flat beside
  // its core: then whichever building type houses the most
  if (p.typology === 'auto') {
    const carpet = (x: typeof site) => solveSite(r, x, use).carpet;
    if (carpet(site) < 1) {
      const alt = (['tower', 'slab'] as const).map((type) => optimise(r, { ...base, design: { ...DEFAULT_DESIGN, ...base.design, type } }, use));
      const best = alt.map((x) => ({ x, c: carpet(x) })).sort((a, b) => b.c - a.c)[0];
      if (best && best.c >= 1) site = best.x;
    }
  }
  site = shaped(r, site, f, use);
  if (f.basements !== undefined) site = { ...site, basements: f.basements };
  const sh = use === 'residential' ? p.shops : undefined;
  if (!sh || sh.floors <= 0) return { d: solveSite(r, site, use), shops: null };
  return withShops(r, site, use, sh, sh.sale > 0 ? sh.sale : Math.round((cost.sale * SHOP_PREMIUM) / 50) * 50);
}

/** The fill as asked: less than the most (floors off the tallest first until it's under the share), and a play
 *  area in the open space. */
function shaped(r: PlotReport, site: PlotSite, f: Fill, use: PlotUse = 'residential'): PlotSite {
  let out = site;
  if (f.amount < 0.999 && site.buildings.length) {
    const d = solveSite(r, site, use), target = r.bua * Math.max(0.1, f.amount);
    const fl = d.buildings.map((b) => b.floors), plate = d.buildings.map((b) => b.plate);
    let bua = fl.reduce((s, n, i) => s + n * plate[i], 0);
    while (bua > target) {
      let k = -1;
      fl.forEach((n, i) => { if (n > 1 && (k < 0 || n > fl[k])) k = i; });
      if (k < 0) break;
      fl[k]--; bua -= plate[k];
    }
    const ids = new Map(d.buildings.map((b, i) => [b.b.id, fl[i]]));
    out = { ...site, buildings: site.buildings.map((b) => ({ ...b, floors: ids.get(b.id) ?? b.floors })) };
  }
  if (f.play && out.rg && out.rg.length >= 6) {
    // (a play area in the middle of the open space, up to 14 x 12 m)
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < out.rg.length; i += 2) { x0 = Math.min(x0, out.rg[i]); x1 = Math.max(x1, out.rg[i]); z0 = Math.min(z0, out.rg[i + 1]); z1 = Math.max(z1, out.rg[i + 1]); }
    const w = Math.min(14, (x1 - x0) * 0.6), h = Math.min(12, (z1 - z0) * 0.6), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    if (w >= 5 && h >= 5) {
      const play: SiteElement = { id: 'play-auto', kind: 'play', spine: [], depth: 0, floors: 0, auto: true, ring: [cx - w / 2, cz - h / 2, cx + w / 2, cz - h / 2, cx + w / 2, cz + h / 2, cx - w / 2, cz + h / 2] };
      out = { ...out, elements: [...(out.elements ?? []), play] };
    }
  }
  return out;
}

/** The scheme as it stands, as the user's own to shape: the fill's buildings and things, kept. */
export function ownScheme(d: SiteReport, styles?: Record<number, string>): NonNullable<ProProject['scheme']> {
  return {
    buildings: d.buildings.map((b, i) => ({ ...b.b, laid: undefined, floors: b.floors, auto: undefined, name: `Building ${String.fromCharCode(65 + i)}`, ...(styles?.[i] ? { style: styles[i] } : {}) })),
    // (roads the optimiser laid stay marked as its own: they're cleared from buildings as they change, and a hand-drawn
    // road is never mistaken for one)
    elements: (d.site.elements ?? []).map((e) => ({ ...e, auto: e.kind === 'road' || e.kind === 'roundabout' ? e.auto : undefined })),
  };
}
