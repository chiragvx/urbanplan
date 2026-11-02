// Site Studio: the buildings on a sandbox plot and everything worked out from them. A building is a spine (a centre
// line through its corridor) with a depth, as in TestFit: drag the spine's nodes and the building re-forms. Its
// floors fill with flats both sides of the corridor (one side when it's shallow), with corner flats where wings meet
// and lift / stair cores no further apart than the fire escape travel distance allows. Floors go up as far as the
// FSI, the height limit and the margins at that height allow. Then the parking the flats need (UDCPR Table 8-B),
// laid out bay by bay on stilts, podiums and basements, and what it all costs and earns.
//
// Pure: a site and a plot report in, numbers and rings (tile metres x,z) out.
import { clipHalf, inset, polyArea, sideMargin, useInfo, type PlotCode, type PlotReport, type PlotUse } from './plot';
import { anglesFor, area as mpArea, fromFlat, fromFlats, inter, layBays, layGround, NO_GROUND, outlines, shrink, union, type GroundMap } from './ground';

/** flat types: 1, 2 and 3 BHK; commercial floors are one office per stretch of corridor */
export type UnitType = 0 | 1 | 2 | 3;
export const UNIT_LABEL = ['1 BHK', '2 BHK', '3 BHK', 'Office'];
export const UNIT_COLOR = ['#f5b041', '#45b39d', '#5d6dde', '#9b8fd6'];

export interface Costs {
  /** land, ₹ per sq ft of plot */
  land: number;
  /** ready reckoner (ASR) land rate, ₹ per sq ft: premium, TDR and ancillary charges are shares of it */
  asr: number;
  /** premium FSI, TDR and ancillary FSI as % of the ASR rate per sq ft of floor space */
  premiumPct: number; tdrPct: number; ancillaryPct: number;
  /** construction, ₹ per sq ft of built-up area; parking levels, ₹ per sq ft */
  build: number; parking: number;
  /** approvals, consultants, marketing, finance: % of construction */
  soft: number;
  /** sale price, ₹ per sq ft of RERA carpet */
  sale: number;
  /** construction period (months), and the % of flats booked by its end (the rest sell over the year after) */
  months: number; presold: number;
}

export interface SiteBuilding {
  id: string;
  /** centre line through the corridor, x,z,… (tile metres); a loop when `closed` (a courtyard block) */
  spine: number[]; closed?: boolean;
  /** depth (m): 14 m and more is double-loaded (flats both sides of the corridor) */
  depth: number;
  /** floors of flats; 0 = as many as the FSI and the envelope allow */
  floors: number;
  /** what it's for (unset: the plot's use) */
  use?: PlotUse;
  /** laid by "Fill for me" (replaced when it fills again); placed by hand when unset */
  auto?: boolean;
}

/** Things on the site besides the buildings: a parking building, a surface lot and a garden are areas (a ring, drawn
 *  or dragged out; the lot and the garden laid out on what the roads and buildings leave of them); an internal road
 *  is a centre line and a width, a roundabout a point and a width. */
export type ElementKind = 'parking' | 'lot' | 'garden' | 'road' | 'roundabout' | 'gate' | 'wall' | 'play' | 'tank' | 'trees';
export interface SiteElement extends SiteBuilding {
  kind: ElementKind;
  /** an area's outline (x,z,…); older ones were a spine and a depth, read as the strip along it */
  ring?: number[];
  /** a parking building's levels */
  levels?: number;
  /** laid by the optimiser (its roads); replaced when it plans again */
  auto?: boolean;
}
export const ELEMENTS: { value: ElementKind; label: string; title: string; len: number; depth: number }[] = [
  { value: 'parking', label: 'Multi-storey car park', title: 'Levels of bays on ramps (not counted in FSI): drag out its area', len: 40, depth: 32 },
  { value: 'lot', label: 'Surface parking', title: 'Bays on whatever of it the buildings leave: drag out its area', len: 30, depth: 16 },
  { value: 'garden', label: 'Garden', title: 'Lawn, paths and trees on whatever of it the buildings leave: drag out its area', len: 30, depth: 20 },
  { value: 'play', label: 'Play area', title: 'A play area (counts as open space): drag out its area', len: 14, depth: 12 },
  { value: 'trees', label: 'Trees', title: 'A stand of trees: drag out its area', len: 16, depth: 10 },
  { value: 'road', label: 'Internal road', title: 'Click its line, Enter to finish; a gate where it meets a road', len: 0, depth: 7 },
  { value: 'roundabout', label: 'Roundabout', title: 'A roundabout or turning circle: click where it goes', len: 18, depth: 18 },
  { value: 'gate', label: 'Gate', title: 'A gate in the compound wall: click the plot’s edge', len: 6, depth: 0.4 },
  { value: 'wall', label: 'Wall', title: 'A wall: click its line, Enter to finish', len: 0, depth: 0.23 },
  { value: 'tank', label: 'Water tank', title: 'An overhead or ground water tank: click where it goes', len: 6, depth: 6 },
];
/** The shelf: buildings of a shape, and the site's other things. */
export type ShelfTool = ElementKind | 'slab' | 'tower' | 'lblock';
export const BUILDING_SHAPES: { value: 'slab' | 'tower' | 'lblock'; label: string; title: string; len: number; depth: number }[] = [
  { value: 'slab', label: 'Slab', title: 'A slab block: click where it goes', len: 36, depth: 16 },
  { value: 'tower', label: 'Tower', title: 'A compact tower: click where it goes', len: 24, depth: 20 },
  { value: 'lblock', label: 'L-block', title: 'An L-shaped block: click where it goes', len: 32, depth: 14 },
];
/** drawn node by node (Enter finishes) */
export const isLine = (k: string) => k === 'road' || k === 'wall';
/** dropped where clicked */
export const isPoint = (k: string) => k === 'roundabout' || k === 'tank' || k === 'gate';
/** a roundabout's ring: a circle on its spine's middle, its width across */
export function circleRing(e: SiteBuilding, sides = 20): number[] {
  const c = spineCentreOf(e.spine), r = e.depth / 2, out: number[] = [];
  for (let k = 0; k < sides; k++) { const a = (k / sides) * Math.PI * 2; out.push(c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r); }
  return out;
}
function spineCentreOf(sp: number[]): [number, number] { let x = 0, z = 0; const n = sp.length / 2; for (let i = 0; i < sp.length; i += 2) { x += sp[i]; z += sp[i + 1]; } return [x / n, z / n]; }
export const isArea = (e: { kind: ElementKind }) => e.kind === 'parking' || e.kind === 'lot' || e.kind === 'garden' || e.kind === 'play' || e.kind === 'trees';
/** an area's outline: as drawn, or the strip along its spine */
export function ringOf(e: SiteElement): number[] {
  if (e.ring && e.ring.length >= 6) return e.ring;
  if (e.spine.length < 4) return [];
  const qs = buildingQuads(e);
  if (qs.length === 1) return qs[0];
  const m = union(...qs.map(fromFlat));
  let best: number[] = [], a = 0;
  for (const r of outlines(m)) { const x = Math.abs(polyArea(r)); if (x > a) { a = x; best = r; } }
  return best;
}
/** an element's ground: its outline (a circle for a roundabout, quads along a road) */
export function elementRings(e: SiteElement): number[][] {
  if (e.kind === 'roundabout' || e.kind === 'tank') return e.spine.length >= 4 ? [circleRing(e, e.kind === 'tank' ? 12 : 20)] : [];
  if (isArea(e)) { const r = ringOf(e); return r.length >= 6 ? [r] : []; }
  return buildingQuads(e);
}
/** the middle of an element (where its label goes, what it turns about) */
export function elementCentre(e: SiteElement): [number, number] {
  if (!isArea(e)) return spineCentreOf(e.spine);
  const r = ringOf(e);
  let x = 0, z = 0, a = 0;
  for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length, c = r[i] * r[j + 1] - r[j] * r[i + 1]; a += c; x += (r[i] + r[j]) * c; z += (r[i + 1] + r[j + 1]) * c; }
  return Math.abs(a) > 1e-6 ? [x / (3 * a), z / (3 * a)] : spineCentreOf(r);
}

export interface PlotSite {
  buildings: SiteBuilding[];
  /** parking buildings, lots, gardens, internal roads and roundabouts */
  elements?: SiteElement[];
  /** the roads along the plot with a gate (unset: the entry road; every road on a large plot) */
  gateRoads?: string[];
  /** share of 1 / 2 / 3 BHK flats, and their RERA carpet areas (m²) */
  mix: [number, number, number];
  sizes: [number, number, number];
  /** parking: the ground floor as stilts, podium levels over the envelope, basements under the plot, and bays on
   *  the open ground round the buildings */
  stilt: boolean; podium: number; basements: number; surface?: boolean;
  /** surface bays as asked for (unset: the optimiser's call) */
  surfacePick?: boolean;
  cost: Partial<Costs>;
  /** what the optimiser is asked for; the buildings are its until they're shaped by hand (`manual`) */
  design?: import('./optimise').Design;
  manual?: boolean;
  /** the recreational open space the optimiser kept (tile metres x,z,…) */
  rg?: number[];
  /** "Fill for me" laid it: the optimiser's buildings are the ones marked `auto`, the rest stay where they were put
   *  (older optimised sites, without it, are all the optimiser's) */
  fill?: boolean;
  /** a justification typed against each departure from the rules (by its key), for the report */
  notes?: Record<string, string>;
}

export interface PlotOption { name: string; site: PlotSite }

export type Preset = 'bar' | 'L' | 'U' | 'court' | 'tower' | 'twin';
export const PRESETS: { value: Preset; label: string; title: string }[] = [
  { value: 'bar', label: 'Bar', title: 'One wing along the road' },
  { value: 'L', label: 'L', title: 'A wing along the road and one back from it' },
  { value: 'U', label: 'U', title: 'A wing along the road and two back from it' },
  { value: 'court', label: 'Court', title: 'Four wings round a courtyard' },
  { value: 'tower', label: 'Tower', title: 'A compact tower in the middle of the plot' },
  { value: 'twin', label: 'Twin', title: 'Two towers, one at either end of the plot' },
];

/** Starting rates by city (₹ per sq ft). Rough market figures to be replaced with your own. */
export function defaultCosts(code: PlotCode, use: PlotUse): Costs {
  const c = use !== 'residential' && use !== 'none';
  if (use === 'industrial') {
    // a MIDC-style estate: cheaper land, a steel shed, sold (or leased out) by the built-up area
    const l = code === 'dcpr-island' ? 20000 : code === 'dcpr-suburbs' ? 8000 : 1000;
    return { land: l, asr: l, sale: code === 'dcpr-island' ? 28000 : code === 'dcpr-suburbs' ? 14000 : 4500, build: 2200, parking: 1500, premiumPct: 35, tdrPct: 50, ancillaryPct: 0, soft: 8, months: 18, presold: 40 };
  }
  const city = code === 'dcpr-island' ? { land: 70000, asr: 45000, sale: 55000, build: 4500, parking: 2500 }
    : code === 'dcpr-suburbs' ? { land: 30000, asr: 20000, sale: 30000, build: 4000, parking: 2500 }
    : { land: 6000, asr: 5000, sale: 12000, build: 2800, parking: 1800 };
  return { ...city, sale: c ? city.sale * 1.2 : city.sale, premiumPct: 35, tdrPct: 50, ancillaryPct: c ? 20 : 10, soft: 12, months: 36, presold: 70 };
}

/** carpet (RERA) as a share of a flat's built-up footprint: walls, ducts, the balcony share */
export const CARPET = 0.8;
export const SQFT = 10.7639;
/** fire escape travel distance to a staircase, residential (NBC 2016 Part 4, Table 22): cores at most twice this apart */
export const TRAVEL = 30;
const CORRIDOR = 2, BAY_W = 2.5, BAY_L = 5, AISLE = 6;
/** decks reached by ramp (basements, podiums): a column (0.6 m) after every three bays, 0.6 m clear of the retaining
 *  wall, a two-way ramp 6 m wide at 1 in 8 with 3 m level landings each end (a car lift on a deck too short for it), and an exit stair (4 × 6 m) wherever a
 *  car is more than 45 m from one (or a building's core coming down through the deck); two ways out from a deck over
 *  500 m² */
const COL = 0.6, WALL_CLEAR = 0.6, RAMP_W = 6, RAMP_SLOPE = 8, EXIT_TRAVEL = 45, STAIR: [number, number] = [4, 6];
/** a core (lifts, stairs, lobby) along the corridor: one stair, or two above 15 m (NBC 2016 Part 4, 4.4.2.4) */
const coreLength = (height: number) => (height > 15 ? 8 : 6);
/** buildings above this need a clear motorable way round them for a fire tender, this wide (NBC 2016 Part 4) */
/** plots this big get a gate on every road along them */
export const GATES_FROM = 10000;
export const FIRE_H = 15, FIRE_W = 6;
/** recreational open space: a share of the plot, on plots this big and more (UDCPR 3.5.1) */
export const RG_FROM = 4000, RG_SHARE = 0.1;

export interface Unit { t: UnitType; ring: number[]; carpet: number }
export interface Level {
  kind: 'stilt' | 'podium' | 'basement' | 'surface' | 'structure' | 'lot'; bays: number[][]; ramp: number[] | null; area: number;
  /** a deck's columns, and its exit stairs and the cores coming down through it */
  columns?: number[][]; stairs?: number[][];
}

export interface BuildingReport {
  b: SiteBuilding;
  /** the building's plate as one quad per wing (they meet on mitred joints) */
  quads: number[][];
  plate: number;
  /** a typical floor: flats, cores, corridors */
  units: Unit[]; cores: number[][]; corridors: number[][];
  floors: number; height: number;
  /** flats per floor by type */
  perFloor: [number, number, number, number];
  /** sticks out of the envelope at its height (margins), or into another building */
  clash: 'margins' | 'overlap' | null;
  /** the most floors the envelope and the height limit allow it */
  maxFloors: number;
  /** tall enough to need a fire tender's way round: its band (quads), and whether that's clear and on the plot */
  fire: number[][]; fireOk: boolean;
  /** what it's for (its own, else the plot's) */
  use: PlotUse;
  /** floors (of flats, over the stilt and podium) the height limit allows; whether it's taller than that */
  allowedFloors: number; overHeight: boolean;
}

/** Where the project departs from the rules: flagged, never refused. `key` is stable (a note typed against it
 *  stays with it), `ids` the buildings it's about. */
export interface Departure {
  key: string;
  /** the rule, the project's value, what the rule allows, the clause */
  rule: string; value: string; allowed: string; clause: string;
  /** a line for the hover card */
  text: string;
  ids: string[];
}

export interface SiteReport {
  site: PlotSite;
  buildings: BuildingReport[];
  /** floors under the flats (stilt, podium) */
  under: number;
  /** the envelope at the tallest building's height */
  envelope: number[];
  height: number;
  count: [number, number, number, number]; flats: number;
  carpet: number;
  /** built-up area used, FSI used (with ancillary), what's left of the permissible built-up area (negative: over) */
  bua: number; fsi: number; left: number;
  coverage: number;
  over: { fsi: boolean; height: boolean; margins: boolean; overlap: boolean; fire: boolean; open: boolean };
  /** what the project has said enough to check: a building, a use (parking, open space), rates (units, money) */
  known: { building: boolean; use: boolean; money: boolean };
  departures: Departure[];
  /** recreational open space needed, and open ground left (not built on, not parked on) */
  open: { need: number; have: number; green: number };
  /** what's round the buildings: the compound wall (runs of it), its gates (x0,z0,x1,z1), the internal drive
   *  (centre lines, `driveW` wide), the open space */
  ground: Ground;
  parking: {
    cars: number; scooters: number; trucks: number;
    /** car bays needed (scooters four to a bay) and laid out */
    need: number; have: number;
    levels: Level[];
  };
  money: {
    costs: Costs;
    revenue: number;
    land: number; premium: number; tdr: number; ancillary: number; build: number; parking: number; soft: number;
    cost: number; profit: number; margin: number;
    /** month by month: net cash, and the running total */
    flow: number[]; cum: number[];
    /** annual IRR (null when there isn't one), the most money in at once, the month the total turns positive */
    irr: number | null; peak: number; payback: number | null;
  };
}

export interface Ground {
  /** the ground as one map: roads, lots, gardens, paving and planting, each square metre one of them */
  map: GroundMap;
  wall: number[][]; gates: number[][]; drive: number[][]; driveW: number; rg: number[] | null;
  /** internal roads (centre line and width) and roundabouts (x, z, radius) */
  roads: { pts: number[]; w: number }[]; circles: number[][];
  /** gardens, as the buildings leave them */
  gardens: number[][];
}

/** a seed for the planting that stays put while the site is reshaped */
const hashIds = (s: PlotSite) => { let h = 7; for (const b of [...s.buildings, ...(s.elements ?? [])]) for (let i = 0; i < b.id.length; i++) h = (h * 31 + b.id.charCodeAt(i)) >>> 0; return h; };

let seq = 0;
export const newBuildingId = () => `b${Date.now().toString(36)}${(seq++).toString(36)}`;

export const DEFAULT_SITE: Omit<PlotSite, 'buildings'> = { mix: [0.2, 0.5, 0.3], sizes: [42, 65, 95], stilt: true, podium: 0, basements: 1, cost: {} };

/** The site on a plot: its own, else a bar along the road. */
export function siteOf(site: PlotSite | undefined, r: PlotReport): PlotSite {
  // (fixed ids: the default is worked out afresh every time until it's edited)
  return site ?? { ...DEFAULT_SITE, buildings: presetBuildings(r, 'bar').map((b, i) => ({ ...b, id: `b${i}` })) };
}

// ---------------- the frame lined up with the road ----------------

/** u along the road, v into the plot, from the centre of the net plot */
export function roadFrame(r: PlotReport) {
  const [ux, uz] = r.axis, vx = -uz, vz = ux;
  let ox = 0, oz = 0;
  const R = r.net.length >= 6 ? r.net : r.footprint;
  for (let i = 0; i < R.length; i += 2) { ox += R[i]; oz += R[i + 1]; }
  ox /= R.length / 2 || 1; oz /= R.length / 2 || 1;
  const toL = (ring: number[]) => { const o: number[] = []; for (let i = 0; i < ring.length; i += 2) { const x = ring[i] - ox, z = ring[i + 1] - oz; o.push(x * ux + z * uz, x * vx + z * vz); } return o; };
  const toW = (u: number, v: number): [number, number] => [ox + u * ux + v * vx, oz + u * uz + v * vz];
  return { ux, uz, vx, vz, toL, toW };
}

/** Starting buildings of a shape, in the envelope the plot report found. A tower is `len` long and (at most) 20 m
 *  deep unless a depth is given. */
export function presetBuildings(r: PlotReport, shape: Preset, depth?: number, len = 24): SiteBuilding[] {
  const env = r.footprint.length >= 6 ? r.footprint : r.net;
  if (env.length < 6) return [];
  const F = roadFrame(r), P = F.toL(env);
  let V0 = Infinity, V1 = -Infinity;
  for (let i = 1; i < P.length; i += 2) { V0 = Math.min(V0, P[i]); V1 = Math.max(V1, P[i]); }
  const tall = shape === 'tower' || shape === 'twin';
  const d = Math.min(depth ?? (tall ? 20 : 16), V1 - V0);
  if (d < 6) return [];
  const make = (pts: [number, number][], closed = false, dd = d): SiteBuilding[] => [{ id: newBuildingId(), spine: pts.flatMap(([u, v]) => F.toW(u, v)).map((x) => Math.round(x * 100) / 100), closed: closed || undefined, depth: dd, floors: 0 }];
  if (tall) {
    const vm = (V0 + V1) / 2;
    const s = spanU(P, vm - d / 2, vm + d / 2);
    if (!s) return [];
    const L = Math.min(len, s[1] - s[0]), um = (s[0] + s[1]) / 2;
    // two towers want room for both and a fire tender's way between them
    if (shape === 'twin' && s[1] - s[0] >= 2 * Math.min(len, 16) + 2 * FIRE_W) {
      const l2 = Math.min(len, (s[1] - s[0] - 2 * FIRE_W) / 2);
      return [...make([[s[0], vm], [s[0] + l2, vm]]), ...make([[s[1] - l2, vm], [s[1], vm]])];
    }
    return make([[um - L / 2, vm], [um + L / 2, vm]]);
  }

  const vc = V0 + d / 2;
  const s = spanU(P, V0, V0 + d);
  if (!s || s[1] - s[0] < 8) return [];
  const [u0, u1] = s;
  if (shape === 'bar') return make([[u0, vc], [u1, vc]]);
  // a wing back from the road at u (its centre line), as far as the envelope allows
  const back = (u: number) => { const t = spanV(P, u - d / 2, u + d / 2); return t ? t[1] - d / 2 : vc; };
  const ul = u0 + d / 2, ur = u1 - d / 2;
  const tl = back(ul), tr = back(ur);
  // a wing back counts when it reaches at least 6 m past the one along the road
  const leg = (t: number) => t - vc >= d / 2 + 6;
  if (shape === 'L' || u1 - u0 < 2 * d + 6) return leg(tl) ? make([[u1, vc], [ul, vc], [ul, tl]]) : make([[u0, vc], [u1, vc]]);
  if (shape === 'U') return leg(Math.min(tl, tr)) ? make([[ur, tr], [ur, vc], [ul, vc], [ul, tl]]) : make([[u0, vc], [u1, vc]]);
  // a courtyard block: a loop round a court at least 6 m across
  const top = Math.min(tl, tr);
  if (top - vc < d + 6) return leg(top) ? make([[ur, tr], [ur, vc], [ul, vc], [ul, tl]]) : make([[u0, vc], [u1, vc]]);
  return make([[ul, vc], [ur, vc], [ur, top], [ul, top]], true);
}

// ---------------- spine geometry ----------------

/** The spine's nodes moved sideways by `o` (left of the direction of travel), mitred at the joints. */
export function offsetSpine(P: number[], closed: boolean, o: number): number[] {
  const n = P.length / 2, out: number[] = [];
  const nrm = (i: number, j: number): [number, number] => { const dx = P[j * 2] - P[i * 2], dz = P[j * 2 + 1] - P[i * 2 + 1], L = Math.hypot(dx, dz) || 1; return [-dz / L, dx / L]; };
  for (let i = 0; i < n; i++) {
    const prev = i > 0 ? i - 1 : closed ? n - 1 : -1, next = i < n - 1 ? i + 1 : closed ? 0 : -1;
    let a = prev >= 0 ? nrm(prev, i) : null, b = next >= 0 ? nrm(i, next) : null;
    if (!a) a = b; if (!b) b = a;
    if (!a || !b) { out.push(P[i * 2], P[i * 2 + 1]); continue; }
    // the mitre: (a + b) / (1 + a·b), its length 1 / cos(half the turn); clamped for very sharp turns
    const k = 1 / Math.max(0.3, 1 + a[0] * b[0] + a[1] * b[1]);
    out.push(P[i * 2] + (a[0] + b[0]) * k * o, P[i * 2 + 1] + (a[1] + b[1]) * k * o);
  }
  return out;
}

/** The wings of a building: one per spine segment, from node k to node k + 1. */
export function segments(b: SiteBuilding) {
  const n = b.spine.length / 2, count = b.closed ? n : n - 1;
  const out: { k: number; ax: number; az: number; tx: number; tz: number; nx: number; nz: number; len: number; at: number }[] = [];
  let at = 0;
  for (let k = 0; k < count; k++) {
    const j = (k + 1) % n, ax = b.spine[k * 2], az = b.spine[k * 2 + 1];
    const dx = b.spine[j * 2] - ax, dz = b.spine[j * 2 + 1] - az, len = Math.hypot(dx, dz) || 1e-6;
    out.push({ k, ax, az, tx: dx / len, tz: dz / len, nx: -dz / len, nz: dx / len, len, at });
    at += len;
  }
  return out;
}

/** A building's plate: a quad per wing between its two faces. */
export function buildingQuads(b: SiteBuilding): number[][] {
  const n = b.spine.length / 2;
  if (n < 2) return [];
  const L = offsetSpine(b.spine, !!b.closed, b.depth / 2), R = offsetSpine(b.spine, !!b.closed, -b.depth / 2);
  return segments(b).map(({ k }) => { const j = (k + 1) % n; return [L[k * 2], L[k * 2 + 1], L[j * 2], L[j * 2 + 1], R[j * 2], R[j * 2 + 1], R[k * 2], R[k * 2 + 1]]; });
}

// ---------------- solving ----------------

/** Lay out a site on a plot. */
export function solveSite(r: PlotReport, site: PlotSite, use: PlotUse = 'residential'): SiteReport {
  const R = r.rules, fh = R.floorH;
  const useOf = (b: SiteBuilding): PlotUse => b.use ?? use;
  const under = (site.stilt ? 1 : 0) + site.podium;
  const envCache = new Map<number, number[]>();
  const envAt = (h: number) => {
    const sd = Math.round(sideMargin(R, h) * 100) / 100;
    let e = envCache.get(sd);
    if (!e) { e = r.net.length >= 6 ? inset(r.net, r.edges, R.front, sd) : []; envCache.set(sd, e); }
    return e;
  };
  const fits = (quads: number[][], h: number) => { const e = envAt(h); return e.length >= 6 && quads.every((q) => ringInside(q, e)); };
  const maxN = Math.max(0, Math.floor(R.maxH / fh + 1e-6) - under);

  // plates, the most floors each can take, and whether buildings run into each other
  const B = site.buildings.filter((b) => b.spine.length >= 4).map((b) => {
    const quads = buildingQuads(b);
    const plate = quads.reduce((s, q) => s + polyArea(q), 0);
    let most = 0;
    while (most < maxN && fits(quads, (most + 1 + under) * fh)) most++;
    return { b, quads, plate, most, floors: 0, overlap: false };
  });
  for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
    if (B[i].quads.some((a) => B[j].quads.some((c) => convexOverlap(a, c)))) B[i].overlap = B[j].overlap = true;
  }
  // (and into a parking building, a road or a roundabout: lots and gardens give way)
  const els = (site.elements ?? []).filter((e) => elementRings(e).length > 0);
  const solid = els.filter((e) => e.kind === 'road' || e.kind === 'roundabout' || e.kind === 'tank').flatMap(elementRings);
  const decks = els.filter((e) => e.kind === 'parking').map(ringOf);
  for (const x of B) if (x.quads.some((a) => solid.some((c) => convexOverlap(a, c)) || decks.some((c) => mpArea(inter(fromFlat(a), fromFlat(c))) > 0.5))) x.overlap = true;
  // floors: as asked, then the rest of the FSI shared out a floor at a time, lowest building first
  let used = 0;
  for (const x of B) if (x.b.floors > 0) { x.floors = x.b.floors; used += x.floors * x.plate; }
  for (;;) {
    let pick: (typeof B)[number] | null = null;
    for (const x of B) if (!x.b.floors && x.floors < x.most && used + x.plate <= r.bua + 0.5 && (!pick || x.floors < pick.floors)) pick = x;
    if (!pick) break;
    pick.floors++;
    used += pick.plate;
  }
  // an automatic building that doesn't fit even one floor still shows (as a clash) with one
  for (const x of B) if (!x.b.floors && !x.floors && x.plate > 0) { x.floors = 1; used += x.plate; }

  // flats, floor by floor the same: cores, corridors and flats along every wing
  const placed = [0, 0, 0];
  const buildings: BuildingReport[] = B.map((x) => {
    const height = (x.floors + under) * fh;
    const bu = useOf(x.b);
    const lay = layFloor(x.b, site, bu, height, placed);
    const clash = x.overlap ? 'overlap' : !fits(x.quads, height) ? 'margins' : null;
    const fire = height > FIRE_H ? fireBand(x.b) : [];
    const fireOk = fire.every((q) => onSite(r, q) && B.every((y) => y === x || !y.quads.some((c) => convexOverlap(q, c))));
    return { b: x.b, quads: x.quads, plate: x.plate, ...lay, floors: x.floors, height, clash, maxFloors: x.most, fire, fireOk, use: bu, allowedFloors: maxN, overHeight: height > R.maxH + 1e-6 };
  });

  const count: [number, number, number, number] = [0, 0, 0, 0];
  let carpet = 0, bua = 0, plate = 0, height = 0;
  for (const b of buildings) {
    for (let t = 0; t < 4; t++) count[t] += b.perFloor[t] * b.floors;
    carpet += b.units.reduce((s, u) => s + u.carpet, 0) * b.floors;
    bua += b.plate * b.floors;
    plate += b.plate;
    height = Math.max(height, b.height);
  }
  const flats = count[0] + count[1] + count[2] + count[3];

  // parking: UDCPR Table 8-B per flat by carpet area, 5 % for visitors; offices one car and two scooters per 100 m²;
  // industry a car per 300 m² and a truck bay per 1,000 m² (each truck bay counted as three car bays)
  // (other uses a car per so many m² of carpet: placeholders where the code has no table of its own; a building with
  // no use yet asks for none)
  let cars = 0, scooters = 0, trucks = 0;
  for (const b of buildings) for (const u of b.units) {
    if (b.use === 'industrial') { cars += (u.carpet / 300) * b.floors; scooters += (u.carpet / 150) * b.floors; trucks += (u.carpet / 1000) * b.floors; continue; }
    if (u.t === 3) { const per = PARK_PER[b.use] ?? 0; if (per) { cars += (u.carpet / per) * b.floors; scooters += ((2 * u.carpet) / per) * b.floors; } continue; }
    cars += (u.carpet >= 150 ? 2 : u.carpet >= 80 ? 1 : u.carpet >= 30 ? 0.5 : 0) * b.floors;
    scooters += b.floors;
  }
  cars = Math.ceil(cars * 1.05); scooters = Math.ceil(scooters * 1.05);
  trucks = Math.ceil(trucks);
  const need = cars + Math.ceil(scooters / 4) + trucks * 3;
  const ground = groundOf(r, site, height > FIRE_H);
  const playOrTrees = els.filter((e) => e.kind === 'play' || e.kind === 'trees').map(ringOf);
  // the ground laid out: what's left of each lot and garden, bays packed into the lots (and, asked for, the open
  // ground), the rest paved and planted
  const lots = els.filter((e) => e.kind === 'lot'), F0 = roadFrame(r);
  // (an empty plot is bare ground: the landscaping comes with the first thing placed, or Fill for me)
  const bare = !buildings.length && !els.length && !site.rg;
  const laid: ReturnType<typeof layGround> = bare ? { map: { ...NO_GROUND, openArea: r.netArea }, lotBays: [], surfaceBays: null } : layGround({
    net: r.net, wall: ground.wall, gates: ground.gates,
    lines: [...ground.drive.map((pts) => ({ pts, w: ground.driveW })), ...ground.roads], circles: ground.circles,
    build: buildings.flatMap((b) => b.quads), structures: [...decks, ...els.filter((e) => e.kind === 'tank').flatMap(elementRings)], fire: buildings.filter((b) => b.fireOk).flatMap((b) => b.fire),
    lots: lots.map(ringOf), gardens: [...(site.rg ? [site.rg] : []), ...els.filter((e) => e.kind === 'garden').map(ringOf), ...playOrTrees],
    surface: site.surface && buildings.length && r.net.length >= 6 ? inset(r.net, r.edges.map(() => false), 0, 1.5) : null,
    axis: [F0.ux, F0.uz], seed: hashIds(site),
  });
  ground.map = laid.map;
  ground.gardens = outlines(union(laid.map.lawn, laid.map.bed, laid.map.path));
  const levels: Level[] = [];
  if (buildings.length) {
    if (site.stilt) {
      const bays: number[][] = [];
      for (const b of buildings) bays.push(...stiltBays(b));
      levels.push({ kind: 'stilt', bays, ramp: null, area: plate });
    }
    const F = roadFrame(r);
    // podium levels under the buildings (not the whole envelope: that's a car park the size of the plot)
    for (let k = 0; k < site.podium; k++) {
      const lv: Level = { kind: 'podium', bays: [], ramp: null, area: 0 };
      const cores = buildings.flatMap((b) => b.cores);
      lv.columns = []; lv.stairs = [];
      for (const b of buildings) for (const q of b.quads) {
        const l = levelIn('podium', q, F, { floorH: fh, cores, ramp: !lv.ramp });
        lv.bays.push(...l.bays); lv.ramp ??= l.ramp; lv.area += l.area; lv.columns.push(...(l.columns ?? [])); lv.stairs.push(...(l.stairs ?? []));
      }
      levels.push(lv);
    }
    const base = r.net.length >= 6 ? inset(r.net, r.edges.map(() => false), 0, 1.5) : [];
    const cores = buildings.flatMap((b) => b.cores);
    for (let k = 0; k < site.basements; k++) levels.push(levelIn('basement', base, F, { floorH: Math.max(3, fh), cores, ramp: true }));
    if (laid.surfaceBays) {
      // bays on the open ground: clear of the buildings, the fire tender's way round the tall ones, the roads, the
      // lots and gardens
      const b = laid.surfaceBays.bays;
      levels.push({ kind: 'surface', bays: b, ramp: null, area: b.length * BAY_W * BAY_L });
    }
  }
  // parking buildings, level on level (the ramps take a corner of each); lots, as they're left
  for (const e of els) {
    if (e.kind !== 'parking') continue;
    const P = fromFlat(ringOf(e)), lay = layBays(shrink(P, 0.6), anglesFor(P, [F0.ux, F0.uz]), false);
    for (let k = 0; k < Math.max(1, e.levels ?? 3); k++) {
      const ramp = lay.bays.length > 8 ? lay.bays.slice(0, 2) : [];
      const rq = ramp.length ? [ramp[0][0], ramp[0][1], ramp[1][2], ramp[1][3], ramp[1][4], ramp[1][5], ramp[0][6], ramp[0][7]] : null;
      levels.push({ kind: 'structure', bays: lay.bays.slice(ramp.length), ramp: rq, area: mpArea(P) });
    }
  }
  laid.lotBays.forEach((l) => levels.push({ kind: 'lot', bays: l.bays, ramp: null, area: l.bays.length * BAY_W * BAY_L }));
  const have = levels.reduce((s, l) => s + l.bays.length, 0);

  // money: land, the FSI bought (premium, TDR, ancillary, in that order of need), building, parking, soft costs
  const rate = { ...defaultCosts(r.code, use), ...site.cost };
  const consumed = bua / (1 + R.ancillary), anc = bua - consumed;
  const free = r.parts.basic + r.parts.credit;
  const prem = Math.min(r.parts.premium, Math.max(0, consumed - free));
  const tdr = Math.max(0, consumed - free - prem);
  const parkArea = levels.reduce((s, l) => s + (l.kind === 'surface' || l.kind === 'lot' ? 0 : l.area), 0);
  const m = {
    land: r.area * SQFT * rate.land,
    premium: prem * SQFT * rate.asr * rate.premiumPct / 100,
    tdr: tdr * SQFT * rate.asr * rate.tdrPct / 100,
    ancillary: anc * SQFT * rate.asr * rate.ancillaryPct / 100,
    build: bua * SQFT * rate.build,
    parking: parkArea * SQFT * rate.parking,
    soft: 0,
  };
  m.soft = (m.build + m.parking) * rate.soft / 100;
  const cost = m.land + m.premium + m.tdr + m.ancillary + m.build + m.parking + m.soft;
  // sold or let: the uses that sell, or any once a sale rate is put in
  const sells = (b: BuildingReport) => useInfo(b.use).sells || site.cost.sale !== undefined;
  const revenue = buildings.reduce((s, b) => s + (sells(b) ? b.units.reduce((a, u) => a + u.carpet, 0) * b.floors : 0), 0) * SQFT * rate.sale;
  const cash = cashflow(m.land + m.premium + m.tdr + m.ancillary, m.build + m.parking + m.soft, revenue, rate);

  // open ground: the net plot less the buildings, the roads and the lots; green: the gardens as they're left
  const openHave = laid.map.openArea;
  const openNeed = r.area >= RG_FROM && (buildings.some((b) => b.use === 'residential') || (!buildings.length && use === 'residential')) ? r.area * RG_SHARE : 0;
  const green = laid.map.gardenArea;

  const out: SiteReport = {
    site, buildings, under, envelope: envAt(height || fh), height, count, flats, carpet, bua,
    fsi: r.area ? bua / r.area : 0, left: r.bua - bua, coverage: r.area ? plate / r.area : 0,
    over: {
      fsi: bua > r.bua + 0.5, height: height > R.maxH + 1e-6, margins: buildings.some((b) => b.clash === 'margins'), overlap: buildings.some((b) => b.clash === 'overlap'),
      fire: buildings.some((b) => !b.fireOk), open: openHave < openNeed,
    },
    known: {
      building: buildings.length > 0,
      use: buildings.some((b) => b.use !== 'none') || (!buildings.length && use !== 'none'),
      money: buildings.some(sells),
    },
    departures: [],
    open: { need: openNeed, have: openHave, green: Math.max(0, green) },
    ground,
    parking: { cars, scooters, trucks, need, have, levels },
    money: { costs: rate, revenue, ...m, cost, profit: revenue - cost, margin: revenue ? (revenue - cost) / revenue : 0, ...cash },
  };
  out.departures = departuresOf(r, out);
  return out;
}

/** cars by use: one per this many m² of carpet (two two-wheelers with each); homes and sheds have their own tables */
const PARK_PER: Partial<Record<PlotUse, number>> = { commercial: 100, shops: 100, government: 100, hospital: 100, worship: 100, custom: 100, school: 200 };

const fm = (v: number) => (Math.round(v * 10) / 10).toLocaleString('en-IN');
const fm2 = (v: number) => `${Math.round(v).toLocaleString('en-IN')} m²`;
const f2 = (v: number) => (Math.round(v * 100) / 100).toString();

/** Every departure from the rules, quietly: the FSI, each building's height and margins, the fire tender's way, the
 *  open space, the parking, the road frontage. (Buildings running into each other are broken, not a departure.) */
export function departuresOf(r: PlotReport, d: SiteReport): Departure[] {
  const R = r.rules, out: Departure[] = [];
  const fsiClause = r.code === 'udcpr' ? 'UDCPR 2020 Tables 6-G / 6-A' : 'DCPR 2034 Table 12';
  const name = (i: number) => (d.buildings.length > 1 ? ` · building ${String.fromCharCode(65 + i)}` : '');
  if (d.over.fsi) {
    out.push({ key: 'fsi', rule: 'FSI', value: `FSI ${f2(d.fsi)} · ${fm2(d.bua)}`, allowed: `FSI ${f2(r.bua / (r.area || 1))} · ${fm2(r.bua)}`, clause: fsiClause,
      text: `Built-up ${fm2(d.bua)} · ${fm2(r.bua)} allowed on a ${fm(r.roadW)} m road`, ids: [] });
  }
  d.buildings.forEach((b, i) => {
    if (b.overHeight) {
      const fl = b.floors + d.under, ok = b.allowedFloors + d.under;
      out.push({ key: `height:${b.b.id}`, rule: `Height${name(i)}`, value: `${fm(b.height)} m · ${fl} fl`, allowed: `${fm(R.maxH)} m · ${ok} fl`, clause: 'Height limit (fire and aviation clearances, as assumed)',
        text: `Height ${fm(b.height)} m · ${fm(R.maxH)} m allowed here (${fl - ok} floor${fl - ok === 1 ? '' : 's'} over)`, ids: [b.b.id] });
    }
    if (b.clash === 'margins') {
      const side = sideMargin(R, b.height);
      out.push({ key: `margins:${b.b.id}`, rule: `Margins${name(i)}`, value: 'past the margins', allowed: `front ${fm(R.front)} m · sides ${fm(side)} m at ${fm(b.height)} m`, clause: 'UDCPR 2020 Table 6-D',
        text: `Past the margins: front ${fm(R.front)} m, sides ${fm(side)} m at its height`, ids: [b.b.id] });
    }
    if (!b.fireOk) out.push({ key: `fire:${b.b.id}`, rule: `Fire tender access${name(i)}`, value: 'way round blocked', allowed: `${FIRE_W} m clear round it above ${FIRE_H} m`, clause: 'NBC 2016 Part 4',
      text: `No clear ${FIRE_W} m way round a building over ${FIRE_H} m`, ids: [b.b.id] });
  });
  if (d.over.open) out.push({ key: 'open', rule: 'Recreational open space', value: fm2(d.open.have), allowed: `${fm2(d.open.need)} (${Math.round(RG_SHARE * 100)} % of the plot)`, clause: 'UDCPR 2020 3.5.1',
    text: `Open space ${fm2(d.open.have)} · ${fm2(d.open.need)} needed`, ids: [] });
  if (d.known.use && d.buildings.length && d.parking.have < d.parking.need) {
    const short = d.parking.need - d.parking.have;
    out.push({ key: 'parking', rule: 'Parking', value: `${d.parking.have} bays`, allowed: `${d.parking.need} bays`, clause: 'UDCPR 2020 Table 8-B',
      text: `Parking ${short} bay${short === 1 ? '' : 's'} short`, ids: [] });
  }
  if (r.net.length >= 6 && !r.edges.some(Boolean)) out.push({ key: 'access', rule: 'Access', value: 'no road frontage', allowed: 'a road along the plot', clause: 'UDCPR 2020 3.2',
    text: 'No road along the plot: draw one to it, or plan it as drawn', ids: [] });
  return out;
}

/** Basement levels needed for the parking (with the stilt and podiums as they are), at most `max`. */
export function basementsToFit(r: PlotReport, site: PlotSite, use: PlotUse, max = 4): number {
  for (let b = 0; b <= max; b++) {
    const x = solveSite(r, { ...site, basements: b }, use);
    if (x.parking.have >= x.parking.need) return b;
  }
  return max;
}

/** A typical floor of a building: cores spaced for the escape distance, the corridor, flats filling each wing. */
function layFloor(b: SiteBuilding, site: PlotSite, use: PlotUse, height: number, placed: number[]) {
  const units: Unit[] = [], cores: number[][] = [], corridors: number[][] = [];
  const perFloor: [number, number, number, number] = [0, 0, 0, 0];
  const segs = segments(b), n = b.spine.length / 2, d = b.depth, closed = !!b.closed;
  if (!segs.length) return { units, cores, corridors, perFloor };
  const total = segs.reduce((s, g) => s + g.len, 0);
  // a shed: one open floor per wing, no cores or corridor (stairs at the walls, counted in the carpet share)
  if (use === 'industrial') {
    for (const q of buildingQuads(b)) { units.push({ t: 3, ring: q, carpet: polyArea(q) * 0.92 }); perFloor[3]++; }
    return { units, cores, corridors, perFloor };
  }

  // cores: no point on the corridor more than the travel distance from one; kept off the joints
  const CL = coreLength(height);
  const nc = Math.max(1, Math.ceil(total / (2 * TRAVEL)));
  const coreAt: { seg: number; s0: number; s1: number }[] = [];
  for (let c = 0; c < nc; c++) {
    let m = (total * (c + 0.5)) / nc;
    let g = segs.findIndex((x) => m <= x.at + x.len + 1e-6);
    if (g < 0) g = segs.length - 1;
    const sg = segs[g];
    // the joints at either end of the wing eat d / 2 of it
    const lo = (g > 0 || closed ? d / 2 : 0) + CL / 2, hi = sg.len - (g < segs.length - 1 || closed ? d / 2 : 0) - CL / 2;
    let s = m - sg.at;
    s = hi >= lo ? Math.max(lo, Math.min(hi, s)) : sg.len / 2;
    coreAt.push({ seg: g, s0: s - CL / 2, s1: s + CL / 2 });
  }
  const pt = (g: (typeof segs)[number], s: number, o: number) => [g.ax + g.tx * s + g.nx * o, g.az + g.tz * s + g.nz * o];
  for (const c of coreAt) { const g = segs[c.seg]; cores.push([...pt(g, c.s0, d / 2), ...pt(g, c.s1, d / 2), ...pt(g, c.s1, -d / 2), ...pt(g, c.s0, -d / 2)]); }

  // corridor down the middle (flats both sides) or along one face (one side)
  const dbl = d >= 14, c = CORRIDOR / 2;
  const cor: [number, number] = dbl ? [-c, c] : [-d / 2, -d / 2 + CORRIDOR];
  const strips: [number, number][] = dbl ? [[c, d / 2], [-d / 2, -c]] : [[-d / 2 + CORRIDOR, d / 2]];
  const off = (o: number) => offsetSpine(b.spine, closed, o);
  const corL = off(cor[0]), corR = off(cor[1]);
  for (const g of segs) { const j = (g.k + 1) % n; corridors.push([corL[g.k * 2], corL[g.k * 2 + 1], corL[j * 2], corL[j * 2 + 1], corR[j * 2], corR[j * 2 + 1], corR[g.k * 2], corR[g.k * 2 + 1]]); }

  const width = site.sizes.map((a) => a / CARPET);
  for (const [oa, ob] of strips) {
    const depth = ob - oa;
    if (depth < 4) continue;
    const A = off(oa), Bo = off(ob);
    for (const g of segs) {
      const j = (g.k + 1) % n;
      const along = (P: number[], i: number) => (P[i * 2] - g.ax) * g.tx + (P[i * 2 + 1] - g.az) * g.tz;
      // the strip's two edges; flats are cut square across, the ends (a joint's wedge) go to the end flats
      const a0 = along(A, g.k), a1 = along(A, j), b0 = along(Bo, g.k), b1 = along(Bo, j);
      const lo = Math.max(a0, b0), hi = Math.min(a1, b1);
      const end0 = [A[g.k * 2], A[g.k * 2 + 1], Bo[g.k * 2], Bo[g.k * 2 + 1]], end1 = [A[j * 2], A[j * 2 + 1], Bo[j * 2], Bo[j * 2 + 1]];
      // stretches between the cores on this wing
      const gaps: [number, number][] = [];
      let s = lo;
      // (a core right at a joint still leaves the joint's wedge, as a stretch of no length)
      for (const cr of coreAt.filter((x) => x.seg === g.k).sort((p, q) => p.s0 - q.s0)) { if (cr.s0 - s > 1e-3 || s === lo) gaps.push([s, Math.max(s, cr.s0)]); s = Math.max(s, cr.s1); }
      if (hi - s > 1e-3) gaps.push([s, hi]);
      else gaps.push([hi, hi]);
      const ring = (sa: number, sb: number) => {
        const first = sa <= lo + 1e-6, last = sb >= hi - 1e-6;
        const ia = first ? [end0[0], end0[1]] : pt(g, sa, oa), oaP = first ? [end0[2], end0[3]] : pt(g, sa, ob);
        const ib = last ? [end1[0], end1[1]] : pt(g, sb, oa), obP = last ? [end1[2], end1[3]] : pt(g, sb, ob);
        return [...ia, ...ib, ...obP, ...oaP];
      };
      for (const [g0, g1] of gaps) {
        // a sliver (a joint's wedge beside a core): shafts and services
        if (g1 - g0 < 0.5) { const w = ring(g0, g1); if (polyArea(w) > 0.01) corridors.push(w); continue; }
        if (use !== 'residential') {
          const rg = ring(g0, g1);
          units.push({ t: 3, ring: rg, carpet: polyArea(rg) * CARPET });
          perFloor[3]++;
          continue;
        }
        // the flats for this stretch: of every count of each type that fits, the one that keeps the running mix
        // closest to the one asked for, with flats near their size (15 % under to 25 % over; else the nearest)
        const w = width.map((a) => a / depth);
        const S = g1 - g0, shares = site.mix[0] + site.mix[1] + site.mix[2] || 1;
        const most = [0, 1, 2].map((t) => (site.mix[t] > 0 ? Math.floor(S / (w[t] * 0.85) + 1e-6) : 0));
        let pickN: [number, number, number] | null = null, pickScore = Infinity, pickK = Infinity;
        for (let a = 0; a <= most[0]; a++) for (let b = 0; b <= most[1]; b++) for (let c = 0; c <= most[2]; c++) {
          const N = a + b + c, tot = a * w[0] + b * w[1] + c * w[2];
          if (!N || tot * 0.85 > S + 0.01) continue;
          const k = S / tot, all = placed[0] + placed[1] + placed[2] + N, n = [a, b, c];
          let err = 0;
          for (let t = 0; t < 3; t++) err += Math.abs(placed[t] + n[t] - (site.mix[t] / shares) * all);
          const score = (err / all) * 3 + Math.abs(k - 1) * 0.8;
          // within a quarter over size beats anything more stretched; the least stretched otherwise
          const ok = k <= 1.25, pickOk = pickK <= 1.25;
          if (pickN && pickOk && !ok) continue;
          if (!pickN || (ok && !pickOk) || (ok ? score < pickScore : Math.abs(k - 1) < Math.abs(pickK - 1))) { pickN = [a, b, c]; pickScore = score; pickK = k; }
        }
        // larger flats at the ends of the stretch (the corners), smaller between
        const row: { t: UnitType; w: number }[] = [];
        if (pickN) {
          const seq: UnitType[] = [];
          for (const t of [2, 1, 0] as const) for (let q = 0; q < pickN[t]; q++) seq.push(t);
          const ends: UnitType[] = [], mid: UnitType[] = [];
          seq.forEach((t, q) => (q < 2 ? ends : mid).push(t));
          for (const t of [ends[0], ...mid.reverse(), ends[1]].filter((x): x is UnitType => x !== undefined)) { row.push({ t, w: w[t] }); placed[t]++; }
        }
        let left = S - row.reduce((sum, f) => sum + f.w, 0);
        if (!row.length) {
          // too short for any flat: a small one if it nearly fits, else shafts and services
          const t = [0, 1, 2].filter((x) => site.mix[x] > 0).sort((a, b) => w[a] - w[b])[0];
          if (t !== undefined && g1 - g0 >= 0.6 * w[t]) { row.push({ t: t as UnitType, w: g1 - g0 }); placed[t]++; left = 0; }
          else { corridors.push(ring(g0, g1)); continue; }
        }
        const k = (g1 - g0) / (g1 - g0 - left);
        let x = g0;
        row.forEach((f, i) => {
          const x1 = i === row.length - 1 ? g1 : x + f.w * k;
          const rg = ring(x, x1);
          units.push({ t: f.t, ring: rg, carpet: polyArea(rg) * CARPET });
          perFloor[f.t]++;
          x = x1;
        });
      }
    }
  }
  return { units, cores, corridors, perFloor };
}

// ---------------- the ground round the buildings ----------------

/** The compound wall along the plot (behind the DP road line), gates onto the roads, and, once a building tops
 *  15 m, a drive the fire tender's width along every side that isn't a road, 3 m in from the wall: it leaves by a
 *  gate at each end (a road side). A lower building gets a single gate off the entry road. */
function groundOf(r: PlotReport, site: PlotSite, tall: boolean): Ground {
  const N = r.net, n = N.length / 2;
  const els = site.elements ?? [];
  const roads = els.filter((e) => e.kind === 'road' && e.spine.length >= 4).map((e) => ({ pts: e.spine, w: e.depth }));
  const circles = els.filter((e) => e.kind === 'roundabout' && e.spine.length >= 4).map((e) => [...spineCentreOf(e.spine), e.depth / 2]);
  const gardens: number[][] = [];
  const empty: Ground = { map: NO_GROUND, wall: [], gates: [], drive: [], driveW: FIRE_W, rg: site.rg ?? null, roads, circles, gardens };
  if (n < 3 || (!site.buildings.length && !els.length)) return empty;
  const access = site.design?.access ?? 'perimeter';
  const sgn = signedArea(N) > 0 ? 1 : -1;
  const E = (k: number) => { const i = ((k % n) + n) % n, j = (i + 1) % n; return [N[i * 2], N[i * 2 + 1], N[j * 2], N[j * 2 + 1]]; };
  const len = (k: number) => { const [ax, az, bx, bz] = E(k); return Math.hypot(bx - ax, bz - az); };
  // where along edge k a point is (m from its start)
  const along = (k: number, x: number, z: number) => { const [ax, az, bx, bz] = E(k), L = Math.hypot(bx - ax, bz - az) || 1; return Math.max(0, Math.min(L, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / L)); };
  const at = (k: number, s: number): [number, number] => { const [ax, az, bx, bz] = E(k), L = Math.hypot(bx - ax, bz - az) || 1; return [ax + ((bx - ax) * s) / L, az + ((bz - az) * s) / L]; };
  const gates: { k: number; s0: number; s1: number }[] = [];
  const gate = (k: number, s: number, w: number) => { const L = len(k), s0 = Math.max(0, Math.min(L - w, s - w / 2)); if (L >= w) gates.push({ k, s0, s1: s0 + w }); };
  const drive: number[][] = [];
  const front = r.edges, any = front.some(Boolean);
  if (tall && access === 'perimeter' && front.some((f) => !f)) {
    const C = offsetSpine(N, true, (sgn * FIRE_W) / 2);
    if (!any) drive.push([...C, C[0], C[1]]);
    else {
      // runs of edges that aren't road sides, each from the road side before it to the one after
      for (let k = 0; k < n; k++) {
        if (front[k] || !front[(k - 1 + n) % n]) continue;
        let m = k;
        while (!front[(m + 1) % n]) m = (m + 1) % n;
        const pts: number[] = [];
        const s0 = along(k - 1, C[k * 2], C[k * 2 + 1]);
        pts.push(...at(k - 1, s0));
        gate(k - 1, s0, FIRE_W);
        for (let i = k; ; i = (i + 1) % n) { pts.push(C[i * 2], C[i * 2 + 1]); if (i === (m + 1) % n) break; }
        const e = (m + 1) % n, s1 = along(e, C[e * 2], C[e * 2 + 1]);
        pts.push(...at(e, s1));
        gate(e, s1, FIRE_W);
        drive.push(pts);
      }
    }
  }
  // the gates placed by hand: on the edge nearest each, as wide as it's drawn
  for (const e of els) {
    if (e.kind !== 'gate' || e.spine.length < 4) continue;
    const [x, z] = spineCentreOf(e.spine), w = Math.max(0.5, Math.hypot(e.spine[2] - e.spine[0], e.spine[3] - e.spine[1]));
    let k = -1, bd = Infinity;
    for (let i = 0; i < n; i++) { const [px, pz] = at(i, along(i, x, z)), dd = Math.hypot(px - x, pz - z); if (dd < bd) { bd = dd; k = i; } }
    if (k >= 0 && bd < Math.max(4, w)) gate(k, along(k, x, z), Math.min(w, len(k)));
  }
  // a gate wherever an internal road meets a road side (as wide as the road)
  for (const R of roads) for (const e of [0, R.pts.length - 2]) {
    const x = R.pts[e], z = R.pts[e + 1];
    for (let k = 0; k < n; k++) {
      if (!front[k]) continue;
      const [ax, az, bx, bz] = E(k), s = along(k, x, z), [px, pz] = at(k, s);
      if (Math.hypot(px - x, pz - z) < Math.max(2.5, R.w) && s > 0 && s < len(k) && Math.hypot(bx - ax, bz - az) > R.w) { gate(k, s, R.w); break; }
    }
  }
  // the roads asked to have a gate (every road on a large plot) that have none yet: one in the middle of its longest side
  const want = site.gateRoads ?? (r.area >= GATES_FROM ? r.roads.map((x) => x.id) : []);
  for (const id of want) {
    let k = -1;
    for (let i = 0; i < n; i++) if (front[i] && r.edgeRoad[i] === id && (k < 0 || len(i) > len(k))) k = i;
    if (k < 0 || gates.some((g) => r.edgeRoad[g.k] === id)) continue;
    gate(k, len(k) / 2, 6);
  }
  if (!gates.length && any) {
    // one gate off the entry road (its longest side), near the end
    let k = -1;
    for (let i = 0; i < n; i++) if (front[i] && (r.edgeRoad[i] === r.road?.id || !r.road) && (k < 0 || len(i) > len(k))) k = i;
    if (k < 0) k = front.findIndex(Boolean);
    gate(k, len(k) - 4, 4.5);
  }
  // the wall: every edge, less its gates; and the walls drawn by hand, a run per stretch
  const wall: number[][] = [];
  for (const e of els) if (e.kind === 'wall') for (let i = 0; i + 3 < e.spine.length; i += 2) wall.push(e.spine.slice(i, i + 4));
  for (let k = 0; k < n; k++) {
    const g = gates.filter((x) => x.k === k).sort((a, b) => a.s0 - b.s0);
    let s = 0;
    for (const x of g) { if (x.s0 - s > 0.2) wall.push([...at(k, s), ...at(k, x.s0)]); s = x.s1; }
    if (len(k) - s > 0.2) wall.push([...at(k, s), ...at(k, len(k))]);
  }
  return { map: NO_GROUND, wall, gates: gates.map((x) => [...at(x.k, x.s0), ...at(x.k, x.s1)]), drive, driveW: FIRE_W, rg: site.rg ?? null, roads, circles, gardens };
}

/** The drive and the internal roads as a quad per stretch (their width either side of the centre line), and the
 *  roundabouts. */
export function driveQuads(G: Ground): number[][] {
  const out: number[][] = [];
  for (const [L, h] of [...G.drive.map((l) => [l, G.driveW / 2] as const), ...(G.roads ?? []).map((x) => [x.pts, x.w / 2] as const)]) for (let i = 0; i + 3 < L.length; i += 2) {
    const ax = L[i], az = L[i + 1], bx = L[i + 2], bz = L[i + 3], len = Math.hypot(bx - ax, bz - az);
    if (len < 0.01) continue;
    const nx = (-(bz - az) / len) * h, nz = ((bx - ax) / len) * h;
    out.push([ax + nx, az + nz, bx + nx, bz + nz, bx - nx, bz - nz, ax - nx, az - nz]);
  }
  for (const [x, z, rr] of G.circles ?? []) out.push(circleRing({ id: '', spine: [x - rr, z, x + rr, z], depth: rr * 2, floors: 0 }, 16));
  return out;
}

// ---------------- fire access, open space, cash ----------------

/** The fire tender's way round a building: its plate grown by the way's width (outward only, for a courtyard block). */
function fireBand(b: SiteBuilding): number[][] {
  if (b.closed) {
    // the outer face is the side whose offset loop is bigger
    const out = polyArea(offsetSpine(b.spine, true, 1)) > polyArea(offsetSpine(b.spine, true, -1)) ? 1 : -1;
    return buildingQuads({ ...b, spine: offsetSpine(b.spine, true, (out * FIRE_W) / 2), depth: b.depth + FIRE_W });
  }
  // an open spine: its ends pushed out too
  const P = [...b.spine], n = P.length / 2;
  const push = (i: number, j: number) => { const dx = P[i * 2] - P[j * 2], dz = P[i * 2 + 1] - P[j * 2 + 1], L = Math.hypot(dx, dz) || 1; P[i * 2] += (dx / L) * FIRE_W; P[i * 2 + 1] += (dz / L) * FIRE_W; };
  push(0, 1); push(n - 1, n - 2);
  return buildingQuads({ ...b, spine: P, depth: b.depth + 2 * FIRE_W });
}

/** Whether a quad is on the plot, or out over the road it fronts (the tender can stand in the street). */
function onSite(r: PlotReport, q: number[]): boolean {
  const N = r.net;
  if (N.length < 6) return false;
  const ccw = signedArea(N) > 0;
  for (let k = 0; k < q.length; k += 2) {
    const x = q[k], z = q[k + 1];
    if (pointIn(N, x, z, 0.3) || r.lostRings.some((L) => pointIn(L, x, z, 0.3))) continue;
    // past a front edge, alongside it
    let road = false;
    for (let i = 0; i < N.length; i += 2) {
      if (!r.edges[i / 2]) continue;
      const j = (i + 2) % N.length, ex = N[j] - N[i], ez = N[j + 1] - N[i + 1], L2 = ex * ex + ez * ez;
      const t = ((x - N[i]) * ex + (z - N[i + 1]) * ez) / L2, side = ex * (z - N[i + 1]) - ez * (x - N[i]);
      if (t > -0.05 && t < 1.05 && (ccw ? side < 0 : side > 0)) { road = true; break; }
    }
    if (!road) return false;
  }
  return true;
}
function signedArea(r: number[]) { let s = 0; for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; s += r[i] * r[j + 1] - r[j] * r[i + 1]; } return s / 2; }

/** The net plot's area clear of these convex rings, sampled on a metre grid. */
function openGround(net: number[], taken: number[][]): number {
  if (net.length < 6) return 0;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < net.length; i += 2) { x0 = Math.min(x0, net[i]); x1 = Math.max(x1, net[i]); z0 = Math.min(z0, net[i + 1]); z1 = Math.max(z1, net[i + 1]); }
  const boxes = taken.map((q) => { let a = Infinity, b = Infinity, c = -Infinity, e = -Infinity; for (let i = 0; i < q.length; i += 2) { a = Math.min(a, q[i]); c = Math.max(c, q[i]); b = Math.min(b, q[i + 1]); e = Math.max(e, q[i + 1]); } return [a, b, c, e]; });
  let n = 0;
  for (let x = x0 + 0.5; x < x1; x += 1) for (let z = z0 + 0.5; z < z1; z += 1) {
    if (!pointIn(net, x, z)) continue;
    if (taken.some((q, i) => x >= boxes[i][0] && x <= boxes[i][2] && z >= boxes[i][1] && z <= boxes[i][3] && pointIn(q, x, z))) continue;
    n++;
  }
  return n;
}

/** Month by month. Month 0: the land and the FSI bought. Construction (with parking and soft costs) along an
 *  S-curve over the build. Flats are booked steadily from month 3 (the presold share by completion, the rest over
 *  the year after) and buyers pay as the building goes up (RERA stage payments), the balance on possession. */
function cashflow(upfront: number, build: number, revenue: number, c: Costs) {
  const T = Math.max(6, Math.round(c.months)), pre = Math.max(0, Math.min(100, c.presold)) / 100, end = T + 12;
  const progress = (t: number) => (t >= T ? 1 : t <= 0 ? 0 : Math.sin((Math.PI / 2) * (t / T)) ** 2);
  const booked = (t: number) => (t < 3 ? 0 : t <= T ? (pre * (t - 3)) / (T - 3) : pre + ((1 - pre) * Math.min(t - T, 12)) / 12);
  const flow: number[] = [], cum: number[] = [];
  let paid = 0, run = 0;
  for (let t = 0; t <= end; t++) {
    const spend = t === 0 ? upfront : build * (progress(t) - progress(t - 1));
    const due = revenue * booked(t) * progress(t);
    const f = due - paid - spend;
    paid = due;
    flow.push(f); run += f; cum.push(run);
  }
  const peak = -Math.min(0, ...cum);
  const pb = cum.findIndex((v, i) => i > 0 && v >= 0 && cum[i - 1] < 0);
  return { flow, cum, irr: irr(flow), peak, payback: pb > 0 ? pb : null };
}

/** Annual internal rate of return of monthly flows, by bisection; null when there isn't one. */
function irr(flow: number[]): number | null {
  const npv = (m: number) => flow.reduce((s, f, t) => s + f / (1 + m) ** t, 0);
  let lo = -0.9, hi = 1;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let k = 0; k < 80; k++) { const mid = (lo + hi) / 2; if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid; }
  return (1 + (lo + hi) / 2) ** 12 - 1;
}

// ---------------- parking ----------------


/** Bays on the stilt floor of a building: along each wing, clear of the cores. */
function stiltBays(b: BuildingReport): number[][] {
  const out: number[][] = [], d = b.b.depth;
  const coreBox = b.cores;
  for (const g of segments(b.b)) {
    // the wing as a rectangle in its own frame (s along, o across), short of the joints
    const lo = g.k > 0 || b.b.closed ? d / 2 : 0, hi = g.len - (g.k < segments(b.b).length - 1 || b.b.closed ? d / 2 : 0);
    if (hi - lo < BAY_W) continue;
    for (const q of baysIn([lo, -d / 2, hi, -d / 2, hi, d / 2, lo, d / 2], false)) {
      const w: number[] = [];
      for (let i = 0; i < q.length; i += 2) w.push(g.ax + g.tx * q[i] + g.nx * q[i + 1], g.az + g.tz * q[i] + g.nz * q[i + 1]);
      if (!coreBox.some((c) => convexOverlap(w, c))) out.push(w);
    }
  }
  return out;
}

/** A podium or basement level: bays over an area, in the road's frame, round its columns, its ramp, its exit
 *  stairs and the cores of the buildings coming down through it. */
function levelIn(kind: Level['kind'], ring: number[], F: ReturnType<typeof roadFrame>, deck?: { floorH: number; cores: number[][]; ramp: boolean }): Level {
  if (ring.length < 6) return { kind, bays: [], ramp: null, area: 0 };
  const toW = (q: number[]) => { const o: number[] = []; for (let i = 0; i < q.length; i += 2) o.push(...F.toW(q[i], q[i + 1])); return o; };
  if (!deck) {
    const P = F.toL(ring), bays = baysIn(P, false);
    return { kind, bays: bays.map(toW), ramp: null, area: polyArea(ring) };
  }
  // clear of the retaining wall
  const P = F.toL(inset(ring, ring.map(() => false).filter((_, i) => i % 2 === 0), 0, WALL_CLEAR));
  if (P.length < 6) return { kind, bays: [], ramp: null, area: polyArea(ring) };
  const rampLen = deck.ramp ? deck.floorH * RAMP_SLOPE + 6 : 0;
  const bays = baysIn(P, deck.ramp, { columns: true, rampLen });
  const ramp = bays.ramp ? toW(bays.ramp) : null;
  // exit stairs: the cores coming down count; then one wherever a bay is too far from any, two ways out at least
  const coresIn = deck.cores.filter((c) => { for (let i = 0; i < c.length; i += 2) if (pointIn(ring, c[i], c[i + 1])) return true; return false; });
  const exits: number[][] = coresIn.map((c) => { let x = 0, z = 0; for (let i = 0; i < c.length; i += 2) { x += c[i]; z += c[i + 1]; } return [(x * 2) / c.length, (z * 2) / c.length]; });
  const stairs: number[][] = [];
  const centres = bays.filter((q) => !ramp || !convexOverlap(q, bays.ramp!)).map((q) => [(q[0] + q[4]) / 2, (q[1] + q[5]) / 2]);
  const ex = exits.map((e) => F.toL(e));
  for (let k = 0; k < 12; k++) {
    // the bay farthest from a way out: a stair there while it's past the travel distance, or there are fewer than two
    let i = -1, bd = -1;
    centres.forEach(([u, v], j) => { const d = Math.min(Infinity, ...ex.map(([eu, ev]) => Math.hypot(eu - u, ev - v))); if (d > bd) { bd = d; i = j; } });
    if (i < 0 || (ex.length >= (polyArea(ring) > 500 ? 2 : 1) && bd <= EXIT_TRAVEL)) break;
    const [u, v] = centres[i], [a, b] = STAIR;
    stairs.push(toW([u - a / 2, v - b / 2, u + a / 2, v - b / 2, u + a / 2, v + b / 2, u - a / 2, v + b / 2]));
    ex.push([u, v]);
  }
  const blocked = [...stairs, ...coresIn, ...(ramp ? [ramp] : [])];
  return {
    kind, bays: bays.map(toW).filter((q) => !blocked.some((c) => convexOverlap(q, c))), ramp, area: polyArea(ring),
    columns: (bays.columns ?? []).map(toW), stairs: [...coresIn, ...stairs],
  };
}

/** Car bays (2.5 × 5 m, 90°, 6 m aisles) in a convex area: rows of bays both sides of an aisle, module after
 *  module. With columns, the bays go in threes with a column between. Levels reached by ramp keep a cross aisle
 *  along one end joining the aisles, the ramp off it along the first row. */
function baysIn(P: number[], withRamp: boolean, o: { columns?: boolean; rampLen?: number } = {}): number[][] & { ramp?: number[]; columns?: number[][] } {
  const out: number[][] & { ramp?: number[]; columns?: number[][] } = [];
  if (P.length < 6) return out;
  let V0 = Infinity, V1 = -Infinity;
  for (let i = 1; i < P.length; i += 2) { V0 = Math.min(V0, P[i]); V1 = Math.max(V1, P[i]); }
  const cross = withRamp ? AISLE : 0, cols: number[][] = [];
  const row = (v0: number) => {
    const s = spanU(P, v0, v0 + BAY_L);
    if (!s) return;
    let u = s[0];
    for (let k = 0; ; k++) {
      // a column after every third bay
      if (o.columns && k > 0 && k % 3 === 0) {
        if (u + COL > s[1] - cross) break;
        const c = u + COL / 2;
        for (const cv of [v0 + COL / 2, v0 + BAY_L - COL / 2]) cols.push([c - COL / 2, cv - COL / 2, c + COL / 2, cv - COL / 2, c + COL / 2, cv + COL / 2, c - COL / 2, cv + COL / 2]);
        u += COL;
      }
      if (u + BAY_W > s[1] - cross + 1e-6) break;
      out.push([u, v0, u + BAY_W, v0, u + BAY_W, v0 + BAY_L, u, v0 + BAY_L]);
      u += BAY_W;
    }
  };
  for (let v = V0; v + BAY_L + AISLE <= V1 + 1e-6; v += 2 * BAY_L + AISLE) {
    row(v);
    if (v + 2 * BAY_L + AISLE <= V1 + 1e-6) row(v + BAY_L + AISLE);
    if (v === V0 && withRamp) {
      // the ramp: along the first row from the cross aisle, as long as the slope needs (or as the row allows)
      const s = spanU(P, v, v + BAY_L);
      if (s) {
        // (a deck too short for the ramp and a few bays besides gets a car lift instead)
        const room = s[1] - cross - s[0], lift = !!o.rampLen && room < o.rampLen + 4 * BAY_W;
        const L = lift ? 3.5 : Math.min(o.rampLen || 4, room), w = lift ? BAY_L + 1 : o.rampLen ? Math.min(RAMP_W, BAY_L + 1) : BAY_L;
        out.ramp = [s[1] - cross - L, v, s[1] - cross, v, s[1] - cross, v + w, s[1] - cross - L, v + w];
      }
    }
  }
  if (out.ramp) {
    const r = out.ramp;
    for (let i = out.length - 1; i >= 0; i--) if (convexOverlap(out[i], r)) out.splice(i, 1);
  }
  out.columns = cols;
  return out;
}

// ---------------- polygon helpers ----------------

/** The u-extent of a convex polygon's chord at v. */
function chordU(P: number[], v: number): [number, number] | null {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < P.length; i += 2) {
    const j = (i + 2) % P.length, va = P[i + 1], vb = P[j + 1];
    if ((va - v) * (vb - v) > 0 || va === vb) continue;
    const u = P[i] + ((v - va) / (vb - va)) * (P[j] - P[i]);
    lo = Math.min(lo, u); hi = Math.max(hi, u);
  }
  return lo <= hi ? [lo, hi] : null;
}
/** The u-range over which a band v0..v1 lies wholly inside a convex polygon. */
export function spanU(P: number[], v0: number, v1: number): [number, number] | null {

  const a = chordU(P, v0 + 0.01), b = chordU(P, v1 - 0.01);
  if (!a || !b) return null;
  const lo = Math.max(a[0], b[0]), hi = Math.min(a[1], b[1]);
  return hi > lo ? [lo, hi] : null;
}
/** The same across: the v-range over which a band u0..u1 lies inside. */
function spanV(P: number[], u0: number, u1: number): [number, number] | null {
  const Q: number[] = [];
  for (let i = 0; i < P.length; i += 2) Q.push(P[i + 1], P[i]);
  return spanU(Q, u0, u1);
}

/** Whether a point is inside a polygon, or within `tol` of its edge. */
export function pointIn(P: number[], x: number, z: number, tol = 0): boolean {
  let inside = false;
  for (let i = 0, j = P.length - 2; i < P.length; j = i, i += 2) {
    const xi = P[i], zi = P[i + 1], xj = P[j], zj = P[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    if (tol > 0) {
      const dx = xj - xi, dz = zj - zi, L2 = dx * dx + dz * dz;
      const t = L2 ? Math.max(0, Math.min(1, ((x - xi) * dx + (z - zi) * dz) / L2)) : 0;
      if (Math.hypot(x - xi - dx * t, z - zi - dz * t) <= tol) return true;
    }
  }
  return inside;
}
const ringInside = (q: number[], P: number[]) => { for (let i = 0; i < q.length; i += 2) if (!pointIn(P, q[i], q[i + 1], 0.05)) return false; return true; };

/** The area two convex polygons share. */
export function overlapArea(a: number[], b: number[]): number {
  let P = a;
  const n = b.length / 2;
  let cx = 0, cz = 0;
  for (let i = 0; i < b.length; i += 2) { cx += b[i] / n; cz += b[i + 1] / n; }
  for (let i = 0; i < n && P.length >= 6; i++) {
    const j = (i + 1) % n, ax = b[i * 2], az = b[i * 2 + 1];
    let nx = -(b[j * 2 + 1] - az), nz = b[j * 2] - ax;
    if ((cx - ax) * nx + (cz - az) * nz < 0) { nx = -nx; nz = -nz; }
    P = clipHalf(P, ax, az, nx, nz, 0);
  }
  return P.length >= 6 ? polyArea(P) : 0;
}

/** A frame along an element's first wing (bays in a lot or a car park run with it). */
function frameAlong(e: SiteBuilding) {
  const ax = e.spine[0], az = e.spine[1], L = Math.hypot(e.spine[2] - ax, e.spine[3] - az) || 1;
  const ux = (e.spine[2] - ax) / L, uz = (e.spine[3] - az) / L, vx = -uz, vz = ux;
  const toL = (ring: number[]) => { const o: number[] = []; for (let i = 0; i < ring.length; i += 2) { const x = ring[i] - ax, z = ring[i + 1] - az; o.push(x * ux + z * uz, x * vx + z * vz); } return o; };
  const toW = (u: number, v: number): [number, number] => [ax + u * ux + v * vx, az + u * uz + v * vz];
  const toW2 = (q: number[]) => { const o: number[] = []; for (let i = 0; i < q.length; i += 2) o.push(...toW(q[i], q[i + 1])); return o; };
  return { ux, uz, vx, vz, toL, toW, toW2 };
}

/** Whether two convex polygons overlap by more than a sliver (separating axes). */
export function convexOverlap(a: number[], b: number[]): boolean {
  for (const P of [a, b]) {
    for (let i = 0; i < P.length; i += 2) {
      const j = (i + 2) % P.length, nx = -(P[j + 1] - P[i + 1]), nz = P[j] - P[i], L = Math.hypot(nx, nz);
      if (L < 1e-9) continue;
      const proj = (Q: number[]) => { let lo = Infinity, hi = -Infinity; for (let k = 0; k < Q.length; k += 2) { const v = (Q[k] * nx + Q[k + 1] * nz) / L; lo = Math.min(lo, v); hi = Math.max(hi, v); } return [lo, hi]; };
      const [a0, a1] = proj(a), [b0, b1] = proj(b);
      if (Math.min(a1, b1) - Math.max(a0, b0) < 0.05) return false;
    }
  }
  return true;
}
