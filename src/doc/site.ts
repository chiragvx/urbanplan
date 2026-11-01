// Site Studio: the buildings on a sandbox plot and everything worked out from them. A building is a spine (a centre
// line through its corridor) with a depth, as in TestFit: drag the spine's nodes and the building re-forms. Its
// floors fill with flats both sides of the corridor (one side when it's shallow), with corner flats where wings meet
// and lift / stair cores no further apart than the fire escape travel distance allows. Floors go up as far as the
// FSI, the height limit and the margins at that height allow. Then the parking the flats need (UDCPR Table 8-B),
// laid out bay by bay on stilts, podiums and basements, and what it all costs and earns.
//
// Pure: a site and a plot report in, numbers and rings (tile metres x,z) out.
import { inset, polyArea, sideMargin, type PlotCode, type PlotReport } from './plot';

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
}

export interface PlotSite {
  buildings: SiteBuilding[];
  /** share of 1 / 2 / 3 BHK flats, and their RERA carpet areas (m²) */
  mix: [number, number, number];
  sizes: [number, number, number];
  /** parking: the ground floor as stilts, podium levels over the envelope, basements under the plot, and bays on
   *  the open ground round the buildings */
  stilt: boolean; podium: number; basements: number; surface?: boolean;
  cost: Partial<Costs>;
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
export function defaultCosts(code: PlotCode, use: 'residential' | 'commercial'): Costs {
  const c = use === 'commercial';
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
const CORRIDOR = 2, BAY_W = 2.5, BAY_L = 5, AISLE = 6, RAMP = 4;
/** a core (lifts, stairs, lobby) along the corridor: one stair, or two above 15 m (NBC 2016 Part 4, 4.4.2.4) */
const coreLength = (height: number) => (height > 15 ? 8 : 6);
/** buildings above this need a clear motorable way round them for a fire tender, this wide (NBC 2016 Part 4) */
export const FIRE_H = 15, FIRE_W = 6;
/** recreational open space: a share of the plot, on plots this big and more (UDCPR 3.5.1) */
export const RG_FROM = 4000, RG_SHARE = 0.1;

export interface Unit { t: UnitType; ring: number[]; carpet: number }
export interface Level { kind: 'stilt' | 'podium' | 'basement' | 'surface'; bays: number[][]; ramp: number[] | null; area: number }

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
  /** recreational open space needed, and open ground left (not built on, not parked on) */
  open: { need: number; have: number };
  parking: {
    cars: number; scooters: number;
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
export function solveSite(r: PlotReport, site: PlotSite, use: 'residential' | 'commercial' = 'residential'): SiteReport {
  const R = r.rules, fh = R.floorH;
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
    const lay = layFloor(x.b, site, use, height, placed);
    const clash = x.overlap ? 'overlap' : !fits(x.quads, height) ? 'margins' : null;
    const fire = height > FIRE_H ? fireBand(x.b) : [];
    const fireOk = fire.every((q) => onSite(r, q) && B.every((y) => y === x || !y.quads.some((c) => convexOverlap(q, c))));
    return { b: x.b, quads: x.quads, plate: x.plate, ...lay, floors: x.floors, height, clash, maxFloors: x.most, fire, fireOk };
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

  // parking: UDCPR Table 8-B per flat by carpet area, 5 % for visitors; offices one car and two scooters per 100 m²
  let cars = 0, scooters = 0;
  for (const b of buildings) for (const u of b.units) {
    if (u.t === 3) { cars += (u.carpet / 100) * b.floors; scooters += ((2 * u.carpet) / 100) * b.floors; continue; }
    cars += (u.carpet >= 150 ? 2 : u.carpet >= 80 ? 1 : u.carpet >= 30 ? 0.5 : 0) * b.floors;
    scooters += b.floors;
  }
  cars = Math.ceil(cars * 1.05); scooters = Math.ceil(scooters * 1.05);
  const need = cars + Math.ceil(scooters / 4);
  const levels: Level[] = [];
  if (buildings.length) {
    if (site.stilt) {
      const bays: number[][] = [];
      for (const b of buildings) bays.push(...stiltBays(b));
      levels.push({ kind: 'stilt', bays, ramp: null, area: plate });
    }
    const F = roadFrame(r);
    const env = envAt(height || fh);
    for (let k = 0; k < site.podium; k++) levels.push(levelIn('podium', env, F));
    const base = r.net.length >= 6 ? inset(r.net, r.edges.map(() => false), 0, 1.5) : [];
    for (let k = 0; k < site.basements; k++) levels.push(levelIn('basement', base, F));
    if (site.surface) {
      // bays on the open ground: clear of the buildings and of the fire tender's way round the tall ones
      const s = levelIn('surface', base, F), keep = buildings.flatMap((b) => [...b.quads, ...b.fire]);
      s.bays = s.bays.filter((q) => !keep.some((k) => convexOverlap(q, k)));
      s.ramp = null; s.area = s.bays.length * BAY_W * BAY_L;
      levels.push(s);
    }
  }
  const have = levels.reduce((s, l) => s + l.bays.length, 0);

  // money: land, the FSI bought (premium, TDR, ancillary, in that order of need), building, parking, soft costs
  const rate = { ...defaultCosts(r.code, use), ...site.cost };
  const consumed = bua / (1 + R.ancillary), anc = bua - consumed;
  const free = r.parts.basic + r.parts.credit;
  const prem = Math.min(r.parts.premium, Math.max(0, consumed - free));
  const tdr = Math.max(0, consumed - free - prem);
  const parkArea = levels.reduce((s, l) => s + (l.kind === 'surface' ? 0 : l.area), 0);
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
  const revenue = carpet * SQFT * rate.sale;
  const cash = cashflow(m.land + m.premium + m.tdr + m.ancillary, m.build + m.parking + m.soft, revenue, rate);

  // open ground: the net plot less the buildings and the surface bays
  const surf = levels.find((l) => l.kind === 'surface')?.bays ?? [];
  const openHave = openGround(r.net, [...buildings.flatMap((b) => b.quads), ...surf]);
  const openNeed = r.area >= RG_FROM && use === 'residential' ? r.area * RG_SHARE : 0;

  return {
    site, buildings, under, envelope: envAt(height || fh), height, count, flats, carpet, bua,
    fsi: r.area ? bua / r.area : 0, left: r.bua - bua, coverage: r.area ? plate / r.area : 0,
    over: {
      fsi: bua > r.bua + 0.5, height: height > R.maxH + 1e-6, margins: buildings.some((b) => b.clash === 'margins'), overlap: buildings.some((b) => b.clash === 'overlap'),
      fire: buildings.some((b) => !b.fireOk), open: openHave < openNeed,
    },
    open: { need: openNeed, have: openHave },
    parking: { cars, scooters, need, have, levels },
    money: { costs: rate, revenue, ...m, cost, profit: revenue - cost, margin: revenue ? (revenue - cost) / revenue : 0, ...cash },
  };
}

/** Basement levels needed for the parking (with the stilt and podiums as they are), at most `max`. */
export function basementsToFit(r: PlotReport, site: PlotSite, use: 'residential' | 'commercial', max = 4): number {
  for (let b = 0; b <= max; b++) {
    const x = solveSite(r, { ...site, basements: b }, use);
    if (x.parking.have >= x.parking.need) return b;
  }
  return max;
}

/** A typical floor of a building: cores spaced for the escape distance, the corridor, flats filling each wing. */
function layFloor(b: SiteBuilding, site: PlotSite, use: 'residential' | 'commercial', height: number, placed: number[]) {
  const units: Unit[] = [], cores: number[][] = [], corridors: number[][] = [];
  const perFloor: [number, number, number, number] = [0, 0, 0, 0];
  const segs = segments(b), n = b.spine.length / 2, d = b.depth, closed = !!b.closed;
  if (!segs.length) return { units, cores, corridors, perFloor };
  const total = segs.reduce((s, g) => s + g.len, 0);

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
        if (use === 'commercial') {
          const rg = ring(g0, g1);
          units.push({ t: 3, ring: rg, carpet: polyArea(rg) * CARPET });
          perFloor[3]++;
          continue;
        }
        // flats one after another, each time the type furthest behind the mix that fits; then bigger flats where
        // that fills the room left better than stretching them
        const w = width.map((a) => a / depth);
        const row: { t: UnitType; w: number }[] = [];
        let left = g1 - g0;
        const shares = site.mix[0] + site.mix[1] + site.mix[2] || 1;
        for (;;) {
          let pick = -1, behind = -Infinity;
          const all = placed[0] + placed[1] + placed[2] + 1;
          for (let t = 0; t < 3; t++) {
            if (site.mix[t] <= 0 || w[t] > left + 0.01) continue;
            const gap = (site.mix[t] / shares) * all - placed[t];
            if (gap > behind) { behind = gap; pick = t; }
          }
          if (pick < 0) break;
          row.push({ t: pick as UnitType, w: w[pick] });
          placed[pick]++;
          left -= w[pick];
        }
        for (let i = row.length - 1; i >= 0 && left > 0.5; i--) {
          for (let t = 2; t > row[i].t; t--) {
            if (site.mix[t] <= 0 || w[t] > row[i].w + left + 0.01) continue;
            placed[row[i].t]--; placed[t]++;
            left -= w[t] - row[i].w;
            row[i] = { t: t as UnitType, w: w[t] };
            break;
          }
        }
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
    if (pointIn(N, x, z, 0.3) || (r.lostRing.length >= 6 && pointIn(r.lostRing, x, z, 0.3))) continue;
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

/** A podium or basement level: bays over an area, in the road's frame. */
function levelIn(kind: Level['kind'], ring: number[], F: ReturnType<typeof roadFrame>): Level {
  if (ring.length < 6) return { kind, bays: [], ramp: null, area: 0 };
  const P = F.toL(ring);
  const bays = baysIn(P, true), ramp = bays.ramp;
  const toW = (q: number[]) => { const o: number[] = []; for (let i = 0; i < q.length; i += 2) o.push(...F.toW(q[i], q[i + 1])); return o; };
  return { kind, bays: bays.filter((b) => !ramp || !convexOverlap(b, ramp)).map(toW), ramp: ramp ? toW(ramp) : null, area: polyArea(ring) };
}

/** Car bays (2.5 × 5 m, 90°, 6 m aisles) in a convex area: rows of bays both sides of an aisle, module after
 *  module. Levels reached by ramp (podiums, basements) keep a cross aisle along one end joining the aisles, with
 *  the ramp off it. */
function baysIn(P: number[], withRamp: boolean): number[][] & { ramp?: number[] } {
  const out: number[][] & { ramp?: number[] } = [];
  if (P.length < 6) return out;
  let V0 = Infinity, V1 = -Infinity;
  for (let i = 1; i < P.length; i += 2) { V0 = Math.min(V0, P[i]); V1 = Math.max(V1, P[i]); }
  const cross = withRamp ? AISLE : 0;
  const row = (v0: number) => {
    const s = spanU(P, v0, v0 + BAY_L);
    if (!s) return;
    const n = Math.floor((s[1] - cross - s[0]) / BAY_W + 1e-6);
    for (let k = 0; k < n; k++) { const u = s[0] + k * BAY_W; out.push([u, v0, u + BAY_W, v0, u + BAY_W, v0 + BAY_L, u, v0 + BAY_L]); }
  };
  for (let v = V0; v + BAY_L + AISLE <= V1 + 1e-6; v += 2 * BAY_L + AISLE) {
    row(v);
    if (v + 2 * BAY_L + AISLE <= V1 + 1e-6) row(v + BAY_L + AISLE);
    if (v === V0 && withRamp) {
      // the ramp: beside the cross aisle, in place of the first bays at that end
      const s = spanU(P, v, v + BAY_L);
      if (s) out.ramp = [s[1] - cross - RAMP, v, s[1] - cross, v, s[1] - cross, v + BAY_L, s[1] - cross - RAMP, v + BAY_L];
    }
  }
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
function spanU(P: number[], v0: number, v1: number): [number, number] | null {
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
