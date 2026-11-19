// A building's systems at concept stage: its cores (stairs, lifts, shafts, refuge floors), electricals, plumbing, fire
// fighting and HVAC. Every setting is optional: unset means "auto", worked out from the building the way an Indian
// MEP consultant would size it on a first pass (rules of thumb from NBC 2016, UDCPR 2020 / DCPR 2034, CPWD and IS
// codes where there is a clear figure; every figure here is "as assumed" and is labelled so). What comes out is
// quantities, the plant rooms they need, a capital cost and checks that flag (never block). No routing, no detailed
// design: the consultant's drawings have the last word.
//
// What is per building and what is per site:
// - per building: stairs, lifts, shafts, refuge floors, the flats' and common-area loads, rooftop solar (its own
//   roof), the overhead tank (its own roof), risers, sprinklers, fire alarm, HVAC, pressurisation, garbage chute.
// - per site ("plant"): the substation (transformer), the DG set, the underground tanks (domestic and fire), the STP,
//   rainwater harvesting, the fire and domestic pump room, the yard hydrants, EV charging. `systemsOf` sizes the plant
//   for the building as if it stood alone (those lines and spaces carry `site: true`, and `plantCost` says how much of
//   `cost` is plant); `siteSystems` sizes it once for every building together.
import { buaOf, floorKind, type BuildingReport, type FloorUse } from '../doc/site';

export type Code = 'udcpr' | 'dcpr-island' | 'dcpr-suburbs';
export type StairType = 'dog-leg' | 'scissor';
export type LiftCap = 6 | 8 | 10 | 13;
/** DG backup: none, lifts / pumps / common areas, or the whole load */
export type DgBackup = 'none' | 'common' | 'full';
export type Hvac = 'none' | 'split' | 'vrv';
export type Sprinklers = 'none' | 'basement' | 'all';
export type Riser = 'none' | 'downcomer' | 'wet';
export type Rwh = 'none' | 'pit' | 'tank';
/** flat types with a per-flat figure (1, 2, 3 BHK; offices go by area) */
export type PerFlat = Partial<Record<0 | 1 | 2, number>>;

/** Everything optional: unset is "auto". */
export interface SystemsSettings {
  cores?: {
    /** staircases (each a fire escape), clear width (m), and dog-leg or scissor (two stairs in one enclosure) */
    stairs?: number; stairW?: number; stairType?: StairType;
    /** passenger lifts (the fire lift is one of them), persons per car, speed (m/s) */
    lifts?: number; liftCap?: LiftCap; liftSpeed?: number;
    /** a service / stretcher lift on top of the passenger lifts */
    serviceLift?: boolean;
    /** one passenger lift built as a fire lift (auto: above 15 m) */
    fireLift?: boolean;
    /** an enclosed, smoke-free lift lobby (auto: above 15 m) */
    lobby?: boolean;
    /** plumbing shafts (one per flat), an electrical shaft per core, a garbage chute per core */
    plumbingShafts?: boolean; electricalShaft?: boolean; chute?: boolean;
    /** refuge floors (auto: UDCPR 9.29.6) */
    refuges?: number;
  };
  electrical?: {
    /** connected load per flat (kW) by type, offices W per m² of carpet */
    flatKW?: PerFlat; officeW?: number;
    /** common-area connected load (kW): lifts, pumps, lighting, ventilation */
    commonKW?: number;
    /** diversity factor on the flats' load */
    diversity?: number;
    /** transformer (kVA, a standard rating) */
    transformer?: number;
    dg?: DgBackup;
    /** rooftop solar (kWp) */
    solar?: number;
    /** EV charging points, as a share (0–1) of the car bays */
    ev?: number;
  };
  plumbing?: {
    /** domestic water, litres per person a day */
    lpcd?: number;
    /** persons per flat by type */
    persons?: PerFlat;
    /** domestic underground and overhead tanks (kL) */
    ugt?: number; oht?: number;
    /** sewage treatment plant (KLD; 0 = none) */
    stp?: number;
    rwh?: Rwh;
  };
  fire?: {
    sprinklers?: Sprinklers; riser?: Riser;
    /** yard hydrants round the building */
    hydrant?: boolean;
    /** underground fire tank (kL) */
    tank?: number;
    pumpRoom?: boolean;
    /** automatic detection and manual call points */
    alarm?: boolean;
  };
  hvac?: {
    system?: Hvac;
    /** mechanical ventilation (and smoke extraction) of the basements */
    basementVent?: boolean;
    /** pressurised stairs and fire-lift lobby */
    pressurise?: boolean;
  };
}

export type SystemsGroup = 'Cores' | 'Electrical' | 'Plumbing' | 'Fire' | 'HVAC';
export const SYSTEMS_GROUPS: SystemsGroup[] = ['Cores', 'Electrical', 'Plumbing', 'Fire', 'HVAC'];
export interface SystemsLine { group: SystemsGroup; label: string; value: string; note?: string; /** site plant */ site?: boolean }
export interface SystemsSpace { label: string; area: number; site?: boolean }
export interface SystemsCheck { key: string; group: SystemsGroup; rule: string; required: string; proposed: string; status: 'pass' | 'fail' | 'warn' | 'info'; clause: string }
export interface SystemsResult {
  lines: SystemsLine[];
  /** plant rooms and the like (m²) */
  spaces: SystemsSpace[];
  /** ₹, capital cost of the systems (MEP, lifts, fire, plant) */
  cost: number;
  /** ₹ per sq ft of built-up area */
  costPerSqft: number;
  /** ₹ by group */
  costBy: Record<SystemsGroup, number>;
  /** ₹ of `cost` that is site plant (sized for this building alone in `systemsOf`) */
  plantCost: number;
  checks: SystemsCheck[];
  /** the figures the controls show as "auto" (what each setting works out to when unset) */
  auto: Auto;
}

export interface SystemsOpts {
  /** floors under the flats (stilt, podium) */
  under: number;
  floorH: number;
  code: Code;
  settings?: SystemsSettings;
  basements?: number;
  /** basement floor area (m², all levels); else the plate × basements */
  basementArea?: number;
  /** car bays (for EV points); else one per flat */
  bays?: number;
}

/** What each setting is when unset. */
export interface Auto {
  stairs: number; stairW: number; stairType: StairType; lifts: number; liftCap: LiftCap; liftSpeed: number;
  serviceLift: boolean; fireLift: boolean; lobby: boolean; plumbingShafts: boolean; electricalShaft: boolean; chute: boolean; refuges: number;
  flatKW: [number, number, number]; officeW: number; commonKW: number; diversity: number; transformer: number; dg: DgBackup; solar: number; ev: number;
  lpcd: number; persons: [number, number, number]; ugt: number; oht: number; stp: number; rwh: Rwh;
  sprinklers: Sprinklers; riser: Riser; hydrant: boolean; tank: number; pumpRoom: boolean; alarm: boolean;
  hvac: Hvac; basementVent: boolean; pressurise: boolean;
}

// ---------------------------------------------------------------- rules of thumb (all as assumed)
const SQFT = 10.7639;
/** UDCPR 9.27.1: a lift over 15 m, two over 24 m; 9.29.8 a fire lift from 15 m; 9.29.6 refuge above 24 m, then every 15 m */
export const LIFT_H = 15, TWO_LIFTS_H = 24, FIRE_LIFT_H = 15, REFUGE_H = 24, REFUGE_EVERY = 15;
/** NBC 2016 Part 4: two staircases above 15 m */
const TWO_STAIRS_H = 15;
/** UDCPR Table 9G residential stair width (same as scrutiny.ts) */
export const stairFor = (h: number) => (h <= 15 ? 1.0 : h <= 24 ? 1.2 : 1.5);
/** NBC 2016 Part 4 Tables 21 / 22: residential occupant load 12.5 m² per person; 25 persons per 0.5 m unit of stair width */
const OCC_M2 = 12.5, PER_UNIT = 25, UNIT_W = 0.5;
/** riser 0.175 m, tread 0.25 m (UDCPR 9.x: riser ≤ 0.19 m, tread ≥ 0.25 m residential) */
const RISER = 0.175, TREAD = 0.25, WALL = 0.23;
/** lift traffic (CIBSE Guide D, residential): 5% of the population in 5 minutes, an interval of 90 s at most;
 *  cars load to 80%; 10 s a stop (doors and acceleration); 1.2 s a passenger in and out */
const HC5 = 0.05, INTERVAL = 90, LOAD = 0.8, T_STOP = 10, T_PAX = 1.2;
/** shaft area (m², with walls) by car size; a service / stretcher car is a 13-person shaft */
const SHAFT: Record<LiftCap, number> = { 6: 3.2, 8: 3.8, 10: 4.4, 13: 5.3 };
const speedFor = (h: number) => (h <= 24 ? 1.0 : h <= 45 ? 1.5 : h <= 75 ? 2.0 : h <= 105 ? 2.5 : 3.0);
const capFor = (h: number): LiftCap => (h <= 24 ? 8 : h <= 60 ? 10 : 13);
/** connected load per flat (kW): 1 BHK 5, 2 BHK 7, 3 BHK 10 (lights, power, kitchen, geyser and AC points, which
 *  buyers fit even when the developer doesn't); offices 90 W/m² of carpet with AC */
const FLAT_KW: [number, number, number] = [5, 7, 10], OFFICE_W = 90;
/** tonnes of AC per flat (for supply cost), offices a tonne per 25 m² */
const FLAT_TR: [number, number, number] = [2, 3, 4.5], OFFICE_M2_TR = 25;
/** persons per flat (CPHEEO / NBC Part 9 take 5 a dwelling; split by size), offices 10 m² of carpet a person */
const PERSONS: [number, number, number] = [3, 4.5, 5.5], OFFICE_M2_PP = 10;
/** NBC 2016 Part 9 Table 1: 135 lpcd residential with full flushing; offices 45 */
const LPCD = 135, OFFICE_LPCD = 45;
/** domestic storage: a day's demand underground, half a day overhead (as assumed; PMC / MCGM practice is 1 + ½) */
const UGT_DAYS = 1, OHT_DAYS = 0.5;
/** STP: sewage 80% of the water; needed from 150 flats or 20,000 m² built-up (PMC / MPCB practice and EC conditions) */
const SEWAGE = 0.8, STP_FLATS = 150, STP_BUA = 20000;
/** RWH (UDCPR 13.3): the roof's run-off of an hour's design storm (Pune 40 mm, Mumbai 60 mm), coefficient 0.85; a
 *  recharge pit takes 10 m³ */
const RUNOFF = 0.85, PIT_M3 = 10;
/** solar: half the roof usable (cores, tanks, refuge, fire egress), 10 m² per kWp; capped at the common-area load
 *  (MERC net-metering: up to the sanctioned load); 4 kWh a kWp a day */
const ROOF_USE = 0.5, M2_KWP = 10, KWH_KWP = 4;
/** diversity on the flats: 0.6 up to 20 flats, 0.5 up to 100, 0.4 above; common load 0.7; pf 0.9; transformer loaded
 *  to 80% */
const divFor = (flats: number) => (flats <= 20 ? 0.6 : flats <= 100 ? 0.5 : 0.4);
const COMMON_DIV = 0.7, PF = 0.9, TX_LOAD = 0.8;
export const TX_RATINGS = [250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000];
const DG_RATINGS = [62.5, 82.5, 125, 160, 200, 250, 320, 380, 500, 625, 750, 1010, 1250, 1500, 2000];
/** Maharashtra EV Policy 2021: 20% of bays with charging in new residential */
const EV_SHARE = 0.2, EV_KW = 3.3;
/** NBC 2016 Part 4 Table 7, A-4 apartment houses, by height band (checked against the printed table, 2026-11-19).
 *  Sprinklers marked R "see Note 4" are required in a basement over 200 m² (to 45 m); throughout above 45 m. Tanks
 *  in kL: underground (riser, hydrants, sprinklers, one set of pumps) and terrace; pump in lpm at the underground
 *  tank (Notes 10–12: one set of 2 280 to 45 m, two sets of 2 280 to 60 m, two of 2 850 above). Automatic detection
 *  only above 60 m. */
function fireBand(h: number) {
  if (h <= 15) return { band: 'up to 15 m', riser: 'none' as Riser, sprinklers: 'basement' as Sprinklers, hydrant: false, tank: 0, terrace: 5, pump: 0, alarm: false, detect: false };
  if (h <= 35) return { band: '15–35 m', riser: 'downcomer' as Riser, sprinklers: 'basement' as Sprinklers, hydrant: false, tank: 0, terrace: 25, pump: 0, alarm: true, detect: false };
  if (h <= 45) return { band: '35–45 m', riser: 'wet' as Riser, sprinklers: 'basement' as Sprinklers, hydrant: false, tank: 75, terrace: 5, pump: 2280, alarm: true, detect: false };
  if (h <= 60) return { band: '45–60 m', riser: 'wet' as Riser, sprinklers: 'all' as Sprinklers, hydrant: true, tank: 150, terrace: 10, pump: 2280, alarm: true, detect: false };
  return { band: 'above 60 m', riser: 'wet' as Riser, sprinklers: 'all' as Sprinklers, hydrant: true, tank: 200, terrace: 10, pump: 2850, alarm: true, detect: true };
}
const SPRINKLER_RANK: Record<Sprinklers, number> = { none: 0, basement: 1, all: 2 };
const RISER_RANK: Record<Riser, number> = { none: 0, downcomer: 1, wet: 2 };
type Band = ReturnType<typeof fireBand>;

/** A formed building's floors by use, as the systems size them. NBC 2016 Part 4 occupancy groups: A residential (A-4
 *  apartments; A-5 hotels, as the 2016 code lists them, with A-6 for starred hotels), B educational (B-1 schools),
 *  C institutional (C-1 hospitals: a clinic taken as C-1, though an outpatient-only one may be classed E-1
 *  business), D assembly (a community hall; a library taken as assembly too, though a small one may be classed
 *  business), E business (E-1 offices; a public toilet, which has no group of its own, taken as E), F mercantile (F-1
 *  shops up to 500 m² a floor, F-2 more). `occ`: m² a person, NBC 2016 Part 4 Table 3 (residential 12.5, educational
 *  4, institutional 15 in-patients (10 taken for a clinic's visitors), assembly without fixed seats 1.5, business
 *  10, mercantile upper sale floors 6 (3 on the street floor)); a library at 4 m² a reader is our figure, not the
 *  table's. `lpcd`: NBC 2016 Part 9 Table 1 (offices and shops 45, day schools 45, auditoria 15 a seat, hotels 180 a
 *  bed; a clinic taken at 45 a visitor), a public toilet by its floor (`waterM2`, placeholder: a seat in 6 m² used
 *  40 times a day at about 9 L). `w` connected load (W/m² of carpet) and `trM2` (m² of carpet a tonne of AC, 0 for
 *  none) are rules of thumb (as assumed). Lift traffic (CIBSE Guide D): `hc` the share carried in 5 minutes and
 *  `interval` the longest wait (s), offices 12 % and 30 s, the rest about 10 % and 40–45 s (as assumed). */
const USE_LOAD: Record<FloorUse, { cls: string; occ: number; lpcd: number; waterM2?: number; w: number; trM2: number; hc: number; interval: number }> = {
  residential: { cls: 'A-4', occ: 12.5, lpcd: LPCD, w: 0, trM2: 0, hc: HC5, interval: INTERVAL },
  hotel: { cls: 'A-5', occ: 12.5, lpcd: 180, w: 80, trM2: 25, hc: 0.1, interval: 45 },
  school: { cls: 'B-1', occ: 4, lpcd: 45, w: 25, trM2: 0, hc: 0.1, interval: 45 },
  clinic: { cls: 'C-1', occ: 10, lpcd: 45, w: 80, trM2: 20, hc: 0.1, interval: 45 },
  community: { cls: 'D', occ: 1.5, lpcd: 15, w: 60, trM2: 25, hc: 0.1, interval: 45 },
  library: { cls: 'D', occ: 4, lpcd: 15, w: 70, trM2: 25, hc: 0.1, interval: 45 },
  office: { cls: 'E-1', occ: OFFICE_M2_PP, lpcd: OFFICE_LPCD, w: OFFICE_W, trM2: OFFICE_M2_TR, hc: 0.12, interval: 30 },
  toilet: { cls: 'E', occ: 10, lpcd: 0, waterM2: 60, w: 15, trM2: 0, hc: 0.1, interval: 45 },
  retail: { cls: 'F', occ: 6, lpcd: 45, w: 120, trM2: 20, hc: 0.1, interval: 40 },
  parking: { cls: 'G-parking', occ: 30, lpcd: 0, w: 5, trM2: 0, hc: 0.05, interval: 90 },
};

/** The fire provisions a non-residential occupancy asks for over the apartments' Table 7 band (as assumed, until
 *  each group's own column of Table 7 is checked): above 15 m a wet riser, sprinklers throughout and a manual alarm
 *  for business, mercantile, assembly, institutional and hotels; automatic detection throughout for hotels,
 *  institutional and assembly at any height and for the others above 15 m; mercantile floors over 500 m² (F-2)
 *  sprinklered at any height; tanks and pumps at least those of the 35–45 m apartment band above 15 m. */
function bandFor(kinds: Set<FloorUse>, h: number, biggestRetail: number): Band & { classes: string[] } {
  const band: Band = { ...fireBand(h) };
  const classes = [...new Set([...kinds].map((k) => USE_LOAD[k].cls))];
  const other = [...kinds].filter((k) => k !== 'residential' && k !== 'parking');
  const up = (x: Partial<Band>) => {
    if (x.riser && RISER_RANK[x.riser] > RISER_RANK[band.riser]) band.riser = x.riser;
    if (x.sprinklers && SPRINKLER_RANK[x.sprinklers] > SPRINKLER_RANK[band.sprinklers]) band.sprinklers = x.sprinklers;
    band.hydrant ||= !!x.hydrant; band.alarm ||= !!x.alarm; band.detect ||= !!x.detect;
    band.tank = Math.max(band.tank, x.tank ?? 0); band.terrace = Math.max(band.terrace, x.terrace ?? 0); band.pump = Math.max(band.pump, x.pump ?? 0);
  };
  if (other.length && h > 15) up({ riser: 'wet', sprinklers: 'all', alarm: true, detect: true, tank: 75, terrace: 10, pump: 2280 });
  if (other.some((k) => k === 'hotel' || k === 'clinic' || k === 'community' || k === 'library')) up({ alarm: true, detect: true });
  if (kinds.has('retail') && biggestRetail > 500) up({ sprinklers: 'all', alarm: true });
  if (other.length) band.band = `${band.band}, ${classes.join(' + ')}`;
  return { ...band, classes };
}

// costs, ₹ (2026, Pune; Mumbai × 1.1), all as assumed
const RATE = {
  liftBase: 12e5, liftStop: 0.9e5, fireLift: 5e5,
  flatKW: 22000, commonKW: 18000, txKVA: 4000, dgKVA: 11000, solarKWp: 50000, evPoint: 50000, meterFlat: 6000,
  toilet: 50000, kitchen: 25000, tankL: 8, pumpsBase: 4e5, pumpsPer10Fl: 1e5, stpKLD: 55000, pit: 75000,
  riserFloor: 1.2e5, downcomerFloor: 0.6e5, sprinklerM2: 750, alarmM2: 120, hydrant: 12e5, extFloor: 5000,
  firePumps: (lpm: number) => (lpm >= 2850 ? 40e5 : 30e5),
  splitTR: 55000, vrvTR: 110000, basementVentM2: 900, pressStair: 6e5, pressFloor: 30000,
  chuteBase: 4e5, chuteFloor: 40000,
};
const TOILETS: [number, number, number] = [1, 2, 3];

// ---------------------------------------------------------------- helpers
const up = (v: number, step: number) => Math.ceil(v / step - 1e-9) * step;
const nextOf = (list: number[], v: number) => list.find((x) => x >= v - 1e-9) ?? list[list.length - 1];
const fmt = (v: number, d = 0) => v.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const m = (v: number, d = 1) => `${fmt(v, d)} m`;
const kl = (v: number) => `${fmt(v)} kL`;
const yes = (b: boolean) => (b ? 'yes' : 'no');
const pick = <T,>(v: T | undefined, a: T): T => (v === undefined ? a : v);

/** The raw figures a building's systems are sized from. */
interface Demand {
  flats: [number, number, number]; nFlats: number; officeCarpet: number;
  bua: number; plate: number; floors: number; height: number; roof: number; basementArea: number;
  pop: number; perFloorPop: number;
  /** kW connected, flats and common; kVA at the meter after diversity */
  flatKW: number; commonKW: number; mdKVA: number; commonKVA: number;
  water: number; // L/day
  tr: number;
  /** a formed building's uses: the people the lifts carry in 5 minutes and the longest wait its strictest use
   *  allows; the most people on one floor (for the stairs); its fire band, the strictest of its occupancies' */
  hcPop?: number; interval?: number; floorOcc?: number; fire?: Band & { classes: string[] };
}

function demandOf(b: BuildingReport, o: SystemsOpts, s: SystemsSettings, a: Pick<Auto, 'flatKW' | 'officeW' | 'persons' | 'lpcd'>, commonKW: number): Demand {
  const flats: [number, number, number] = [b.perFloor[0] * b.floors, b.perFloor[1] * b.floors, b.perFloor[2] * b.floors];
  let officeCarpet = b.units.filter((u) => u.t === 3).reduce((x, u) => x + u.carpet, 0) * b.floors;
  const E = s.electrical ?? {}, Pl = s.plumbing ?? {};
  const kw = [0, 1, 2].map((t) => pick(E.flatKW?.[t as 0 | 1 | 2], a.flatKW[t]));
  const pp = [0, 1, 2].map((t) => pick(Pl.persons?.[t as 0 | 1 | 2], a.persons[t]));
  const lpcd = pick(Pl.lpcd, a.lpcd);
  // a formed building floor by floor, each by its own use (USE_LOAD); its offices' W/m² as set, if set
  let other: { pop: number; water: number; kW: number; tr: number; hcPop: number; interval: number; floorOcc: number; fire: Demand['fire'] } | null = null;
  if (b.laid) {
    flats.fill(0); officeCarpet = 0;
    const o2 = { pop: 0, water: 0, kW: 0, tr: 0, hcPop: 0, interval: INTERVAL, floorOcc: 0, fire: undefined as Demand['fire'] };
    const kinds = new Set<FloorUse>();
    let biggestRetail = 0;
    for (const f of b.laid.floors) {
      const k = floorKind(f, b.use), U = USE_LOAD[k];
      kinds.add(k);
      if (k === 'residential') {
        for (const u of f.units) if (u.t < 3) flats[u.t as 0 | 1 | 2]++;
        o2.floorOcc = Math.max(o2.floorOcc, f.area / OCC_M2);
        continue;
      }
      // (a floor with no units laid yet counted at 70 % of its area)
      const c = f.units.reduce((x, u) => x + u.carpet, 0) || f.area * 0.7;
      officeCarpet += c;
      const pop = c / U.occ;
      o2.pop += pop; o2.water += pop * U.lpcd + f.area * (U.waterM2 ?? 0);
      o2.kW += (c * (k === 'office' ? pick(E.officeW, a.officeW) : U.w)) / 1000;
      o2.tr += U.trM2 ? c / U.trM2 : 0;
      o2.hcPop += pop * U.hc; o2.interval = Math.min(o2.interval, U.interval);
      o2.floorOcc = Math.max(o2.floorOcc, f.area / U.occ);
      if (k === 'retail') biggestRetail = Math.max(biggestRetail, f.area);
    }
    o2.fire = bandFor(kinds, b.height, biggestRetail);
    other = o2;
  }
  const nFlats = flats[0] + flats[1] + flats[2];
  const bua = buaOf(b);
  // a building with no flats or offices laid out (a shed, a use with no units yet): treat its floors as offices
  if (!nFlats && !officeCarpet) officeCarpet = bua * 0.7;
  const flatPop = flats.reduce((x, n, t) => x + n * pp[t], 0);
  const flatKW = flats.reduce((x, n, t) => x + n * kw[t], 0) + (other ? other.kW : (officeCarpet * pick(E.officeW, a.officeW)) / 1000);
  const pop = flatPop + (other ? other.pop : officeCarpet / OFFICE_M2_PP);
  const water = flatPop * lpcd + (other ? other.water : (officeCarpet / OFFICE_M2_PP) * OFFICE_LPCD);
  const div = pick(E.diversity, divFor(nFlats || officeCarpet / 60));
  const commonKVA = (commonKW * COMMON_DIV) / PF;
  const mdKVA = (flatKW * div) / PF + commonKVA;
  const tr = flats.reduce((x, n, t) => x + n * FLAT_TR[t], 0) + (other ? other.tr : officeCarpet / OFFICE_M2_TR);
  const basementArea = o.basementArea ?? b.plate * (o.basements ?? 0);
  const roof = b.laid ? b.laid.floors[b.laid.floors.length - 1].area : b.plate;
  const extra = other ? { hcPop: flatPop * HC5 + other.hcPop, interval: other.interval, floorOcc: other.floorOcc, fire: other.fire } : {};
  return { flats, nFlats, officeCarpet, bua, plate: b.plate, floors: b.floors, height: b.height, roof, basementArea, pop, perFloorPop: pop / Math.max(1, b.floors), flatKW, commonKW, mdKVA, commonKVA, water, tr, ...extra };
}

/** Lifts a building needs for its traffic (round-trip time), with the RTT. `hcPop`: the people to carry in 5 minutes
 *  (unset: 5 % of the population, as for flats); `interval`: the longest wait (s). */
function liftsFor(pop: number, floors: number, rise: number, cap: LiftCap, v: number, hcPop = HC5 * pop, interval = INTERVAL) {
  const P = LOAD * cap, N = Math.max(1, floors);
  const S = N * (1 - (1 - 1 / N) ** P);
  const rtt = (2 * rise) / v + (S + 1) * T_STOP + 2 * P * T_PAX;
  const perCar = (300 * P) / rtt;
  const n = Math.max(Math.ceil(hcPop / perCar - 1e-9), Math.ceil(rtt / interval - 1e-9));
  return { n, rtt, perCar };
}

/** A stair enclosure's area per floor (m², with walls), per stair. */
function stairArea(w: number, type: StairType, floorH: number) {
  const risers = Math.ceil(floorH / RISER - 1e-9);
  if (type === 'scissor') {
    // two stairs side by side in one enclosure, each a single straight flight a floor
    const going = (risers - 1) * TREAD;
    return ((2 * w + 0.2 + 2 * WALL) * (going + 2 * w + 2 * WALL)) / 2;
  }
  const going = (Math.ceil(risers / 2) - 1) * TREAD;
  return (2 * w + 0.15 + 2 * WALL) * (going + 2 * w + 2 * WALL);
}

// ---------------------------------------------------------------- plant (per site)
interface PlantIn { d: Demand[]; code: Code; settings: SystemsSettings; bays: number; dgAuto: DgBackup; fireH: number }
interface PlantOut { lines: SystemsLine[]; spaces: SystemsSpace[]; cost: Record<SystemsGroup, number>; checks: SystemsCheck[]; auto: Pick<Auto, 'transformer' | 'dg' | 'ev' | 'ugt' | 'stp' | 'rwh' | 'tank' | 'hydrant' | 'pumpRoom'> }

function plant({ d, code, settings: s, bays, dgAuto, fireH }: PlantIn): PlantOut {
  const E = s.electrical ?? {}, Pl = s.plumbing ?? {}, F = s.fire ?? {};
  const lines: SystemsLine[] = [], spaces: SystemsSpace[] = [], checks: SystemsCheck[] = [];
  const cost: Record<SystemsGroup, number> = { Cores: 0, Electrical: 0, Plumbing: 0, Fire: 0, HVAC: 0 };
  const L = (group: SystemsGroup, label: string, value: string, note?: string) => lines.push({ group, label, value, note, site: true });
  const C = (c: SystemsCheck) => checks.push(c);
  const sum = (f: (x: Demand) => number) => d.reduce((t, x) => t + f(x), 0);
  const nFlats = sum((x) => x.nFlats), bua = sum((x) => x.bua), water = sum((x) => x.water), roof = sum((x) => x.roof);
  const flatKW = sum((x) => x.flatKW), commonKW = sum((x) => x.commonKW), officeCarpet = sum((x) => x.officeCarpet);
  const code2 = code === 'udcpr' ? 'UDCPR 2020' : 'DCPR 2034';

  // EV charging (on the parking, so per site)
  const evShare = pick(E.ev, EV_SHARE), evPts = Math.round(bays * evShare), evKW = evPts * EV_KW;
  L('Electrical', 'EV charging', `${fmt(evPts)} points (${fmt(evShare * 100)}% of ${fmt(bays)} bays)`, `${EV_KW} kW AC each, half at once (as assumed)`);
  cost.Electrical += evPts * RATE.evPoint;
  if (evShare < EV_SHARE) C({ key: 'ev', group: 'Electrical', rule: 'EV charging', required: `${fmt(EV_SHARE * 100)}% of the bays`, proposed: `${fmt(evShare * 100)}%`, status: 'warn', clause: 'Maharashtra EV Policy 2021 (as assumed)' });

  // the substation: the flats after diversity (by the site's flats), the common load and EV at 0.7 / 0.5
  const div = pick(E.diversity, divFor(nFlats || officeCarpet / 60));
  const commonKVA = (commonKW * COMMON_DIV) / PF;
  const md = (flatKW * div) / PF + commonKVA + (evKW * 0.5) / PF;
  const txAuto = md / TX_LOAD > TX_RATINGS[TX_RATINGS.length - 1] ? Math.ceil(md / TX_LOAD / 2000) * 2000 : nextOf(TX_RATINGS, md / TX_LOAD);
  const tx = pick(E.transformer, txAuto);
  L('Electrical', 'Maximum demand', `${fmt(md)} kVA`, `diversity ${fmt(div, 2)} on ${fmt(flatKW)} kW of flats, 0.7 on ${fmt(commonKW)} kW common, pf 0.9`);
  L('Electrical', 'Transformer', txAuto > 2000 && E.transformer === undefined ? `${fmt(txAuto / 2000)} × 2,000 kVA` : `${fmt(tx)} kVA`, 'loaded to 80% (as assumed); the DISCOM sets the final rating');
  cost.Electrical += tx * RATE.txKVA;
  spaces.push({ label: 'Substation (transformer yard, HT / LT panels)', area: Math.round(25 + 0.03 * tx), site: true });
  if (tx * TX_LOAD < md - 1) C({ key: 'transformer', group: 'Electrical', rule: 'Transformer', required: `at least ${fmt(md / TX_LOAD)} kVA (${fmt(md)} kVA at 80%)`, proposed: `${fmt(tx)} kVA`, status: 'fail', clause: 'IS 10028 loading (as assumed)' });

  const dg = pick(E.dg, dgAuto);
  const dgLoad = dg === 'full' ? md : dg === 'common' ? commonKVA : 0;
  const dgKVA = dgLoad ? nextOf(DG_RATINGS, dgLoad / 0.8) : 0;
  L('Electrical', 'DG backup', dg === 'none' ? 'none' : `${fmt(dgKVA, 1)} kVA (${dg === 'full' ? 'the whole load' : 'lifts, pumps, common areas'})`);
  cost.Electrical += dgKVA * RATE.dgKVA;
  if (dgKVA) spaces.push({ label: 'DG set (acoustic enclosure)', area: Math.round(15 + 0.05 * dgKVA), site: true });
  if (fireH > FIRE_LIFT_H && dg === 'none') C({ key: 'dg', group: 'Electrical', rule: 'Standby power', required: 'an alternate supply for the fire lift and fire pumps above 15 m', proposed: 'no DG', status: 'fail', clause: 'NBC 2016 Part 4 (as assumed)' });
  spaces.push({ label: 'Meter room', area: Math.round(10 + 0.15 * nFlats), site: true });
  cost.Electrical += nFlats * RATE.meterFlat;

  // water: a day underground (domestic), a fire tank by the tallest building's band
  const ugtAuto = up((water * UGT_DAYS) / 1000, 5);
  const ugt = pick(Pl.ugt, ugtAuto);
  // (the tallest building's band, made stricter by any building's occupancies)
  const band = { ...fireBand(fireH) };
  for (const x of d) if (x.fire) { band.tank = Math.max(band.tank, x.fire.tank); band.pump = Math.max(band.pump, x.fire.pump); band.hydrant ||= x.fire.hydrant; if (x.fire.tank >= band.tank) band.band = x.fire.band; }
  const tank = pick(F.tank, band.tank);
  L('Plumbing', 'Underground tank (domestic)', kl(ugt), `${fmt(UGT_DAYS)} day of ${kl(water / 1000)} a day`);
  L('Fire', 'Underground fire tank', tank ? kl(tank) : 'none', `NBC 2016 Part 4 Table 7, ${band.band}`);
  cost.Plumbing += ugt * 1000 * RATE.tankL;
  cost.Fire += tank * 1000 * RATE.tankL;
  if (ugt + tank > 0) spaces.push({ label: 'Underground tanks (footprint, 3 m deep)', area: Math.round((ugt + tank) / 3), site: true });
  if (ugt < ugtAuto - 0.5) C({ key: 'ugt', group: 'Plumbing', rule: 'Domestic storage (underground)', required: `${kl(ugtAuto)} (a day)`, proposed: kl(ugt), status: 'warn', clause: 'NBC 2016 Part 9 (as assumed: a day)' });
  if (tank < band.tank) C({ key: 'fire-tank', group: 'Fire', rule: 'Fire tank', required: kl(band.tank), proposed: tank ? kl(tank) : 'none', status: 'fail', clause: 'NBC 2016 Part 4 Table 7' });

  const pumpAuto = fireH > FIRE_LIFT_H || nFlats > 0;
  const pumpRoom = pick(F.pumpRoom, pumpAuto);
  if (pumpRoom) {
    spaces.push({ label: 'Pump room (fire and domestic)', area: band.pump >= 2850 ? 60 : band.pump ? 45 : 15, site: true });
    cost.Plumbing += RATE.pumpsBase;
    if (band.pump) { cost.Fire += RATE.firePumps(band.pump); L('Fire', 'Fire pumps', `${fmt(band.pump)} lpm electric, diesel standby, jockey`, 'NBC 2016 Part 4 Table 7'); }
  }
  if (band.pump && !pumpRoom) C({ key: 'pump-room', group: 'Fire', rule: 'Fire pump room', required: `pumps of ${fmt(band.pump)} lpm above 15 m`, proposed: 'none', status: 'fail', clause: 'NBC 2016 Part 4 Table 7' });

  const hydrant = pick(F.hydrant, band.hydrant);
  L('Fire', 'Yard hydrants', yes(hydrant));
  if (hydrant) cost.Fire += RATE.hydrant;
  if (band.hydrant && !hydrant) C({ key: 'hydrant', group: 'Fire', rule: 'Yard hydrants', required: `needed ${band.band}`, proposed: 'none', status: 'fail', clause: 'NBC 2016 Part 4 Table 7' });

  // STP
  const stpNeeded = nFlats >= STP_FLATS || bua >= STP_BUA;
  const stpAuto = stpNeeded ? up((water * SEWAGE) / 1000, 5) : 0;
  const stp = pick(Pl.stp, stpAuto);
  L('Plumbing', 'Sewage treatment', stp ? `${fmt(stp)} KLD` : 'none (to the city sewer)', stpNeeded ? `80% of the water; needed from ${STP_FLATS} flats or ${fmt(STP_BUA)} m²` : `not needed under ${STP_FLATS} flats and ${fmt(STP_BUA)} m² (as assumed)`);
  cost.Plumbing += stp * RATE.stpKLD;
  if (stp) spaces.push({ label: 'STP (MBBR, underground)', area: Math.round(Math.max(20, stp)), site: true });
  if (stpNeeded && stp < stpAuto - 0.5) C({ key: 'stp', group: 'Plumbing', rule: 'Sewage treatment plant', required: `${fmt(stpAuto)} KLD`, proposed: stp ? `${fmt(stp)} KLD` : 'none', status: stp ? 'warn' : 'fail', clause: 'MPCB consent / EC conditions (as assumed)' });

  // RWH
  const rain = code === 'udcpr' ? 0.04 : 0.06;
  const rwhAuto: Rwh = 'pit';
  const rwh = pick(Pl.rwh, rwhAuto);
  const vol = roof * rain * RUNOFF;
  const pits = Math.max(1, Math.ceil(vol / PIT_M3 - 1e-9));
  L('Plumbing', 'Rainwater harvesting', rwh === 'none' ? 'none' : rwh === 'pit' ? `${pits} recharge pit${pits > 1 ? 's' : ''}` : `${kl(up(vol, 1))} tank`, `${fmt(vol)} m³ off ${fmt(roof)} m² of roof in an hour of ${fmt(rain * 1000)} mm`);
  cost.Plumbing += rwh === 'pit' ? pits * RATE.pit : rwh === 'tank' ? up(vol, 1) * 1000 * RATE.tankL : 0;
  if (rwh === 'none') C({ key: 'rwh', group: 'Plumbing', rule: 'Rainwater harvesting', required: 'recharge pits or a storage tank', proposed: 'none', status: 'fail', clause: `${code2} ${code === 'udcpr' ? '13.3' : 'Reg. 62'} (as assumed)` });

  // Mumbai labour and access
  if (code !== 'udcpr') for (const g of SYSTEMS_GROUPS) cost[g] *= 1.1;
  return { lines, spaces, cost, checks, auto: { transformer: txAuto, dg: dgAuto, ev: EV_SHARE, ugt: ugtAuto, stp: stpAuto, rwh: rwhAuto, tank: band.tank, hydrant: band.hydrant, pumpRoom: pumpAuto } };
}

// ---------------------------------------------------------------- per building
interface BuildingOut { d: Demand; lines: SystemsLine[]; spaces: SystemsSpace[]; cost: Record<SystemsGroup, number>; checks: SystemsCheck[]; auto: Omit<Auto, keyof PlantOut['auto']>; dgAuto: DgBackup }

function building(b: BuildingReport, o: SystemsOpts): BuildingOut {
  const s = o.settings ?? {}, Co = s.cores ?? {}, E = s.electrical ?? {}, Pl = s.plumbing ?? {}, F = s.fire ?? {}, Hv = s.hvac ?? {};
  const H = b.height, code2 = o.code === 'udcpr' ? 'UDCPR 2020' : 'DCPR 2034';
  const lines: SystemsLine[] = [], spaces: SystemsSpace[] = [], checks: SystemsCheck[] = [];
  const cost: Record<SystemsGroup, number> = { Cores: 0, Electrical: 0, Plumbing: 0, Fire: 0, HVAC: 0 };
  const L = (group: SystemsGroup, label: string, value: string, note?: string) => lines.push({ group, label, value, note });
  const C = (c: SystemsCheck) => checks.push(c);
  const cores = Math.max(1, b.cores.length);
  const stops = b.floors + o.under + (o.basements ?? 0);
  const rise = Math.max(0, H - o.floorH);

  // a first pass at the demand, without the common load (lifts need the population; the common load needs the lifts)
  const base = { flatKW: FLAT_KW, officeW: OFFICE_W, persons: PERSONS, lpcd: LPCD };
  const d0 = demandOf(b, o, s, base, 0);

  // ---- cores: lifts
  const liftsNeeded = H > LIFT_H;
  const codeMin = H > TWO_LIFTS_H ? 2 : liftsNeeded ? 1 : 0;
  const capAuto = capFor(H), speedAuto = speedFor(H);
  const cap = pick(Co.liftCap, capAuto), v = pick(Co.liftSpeed, speedAuto);
  const traffic = liftsFor(d0.pop, b.floors, rise, cap, v, d0.hcPop, d0.interval);
  // up to 15 m a lift is a choice: auto gives one when there are five floors or more of flats
  // (and a building the public uses gets one from two floors up, for access: as assumed, after the accessibility
  // provisions of NBC 2016 Part 3 and the Harmonised Guidelines 2021)
  const publicAccess = !!b.laid && d0.officeCarpet > 0 && b.floors > 1;
  const liftsAuto = liftsNeeded ? Math.max(codeMin, traffic.n, cores) : b.floors + o.under >= 5 || publicAccess ? Math.max(1, cores) : 0;
  const lifts = pick(Co.lifts, liftsAuto);
  const fireLiftAuto = H > FIRE_LIFT_H;
  const fireLift = pick(Co.fireLift, fireLiftAuto) && lifts > 0;
  const serviceAuto = H > 45 || d0.nFlats > 200;
  const service = pick(Co.serviceLift, serviceAuto);
  const lobbyAuto = H > FIRE_LIFT_H;
  const lobby = pick(Co.lobby, lobbyAuto);
  const cars = lifts + (service ? 1 : 0);
  L('Cores', 'Passenger lifts', lifts ? `${lifts} × ${cap} persons at ${fmt(v, 1)} m/s` : 'none', lifts ? `${stops} stops; round trip ${fmt(traffic.rtt)} s, ${fmt(traffic.perCar, 1)} persons a car in 5 min (CIBSE Guide D, as assumed)` : undefined);
  if (fireLift) L('Cores', 'Fire lift', 'one of the passenger lifts', 'fire-rated landing doors, its own supply, 8 persons or more');
  L('Cores', 'Service / stretcher lift', service ? '1 × 13 persons' : 'none');
  const liftCost = (c: number, vv: number) => (RATE.liftBase + RATE.liftStop * stops) * (1 + 0.25 * (vv - 1)) * Math.sqrt(c / 8);
  cost.Cores += lifts * liftCost(cap, v) + (service ? liftCost(13, v) : 0) + (fireLift ? RATE.fireLift : 0);
  const liftArea = lifts * SHAFT[cap] + (service ? SHAFT[13] : 0);
  const lobbyArea = cars ? 6 + 3 * cars : 0;

  if (lifts < codeMin) C({ key: 'lifts', group: 'Cores', rule: 'Lifts', required: `${codeMin} (over ${H > TWO_LIFTS_H ? TWO_LIFTS_H : LIFT_H} m)`, proposed: `${lifts}`, status: 'fail', clause: `${code2} 9.27.1` });
  else if (liftsNeeded && lifts < traffic.n) C({ key: 'lift-traffic', group: 'Cores', rule: 'Lift traffic', required: `${traffic.n} lifts of ${cap} for ${fmt(d0.pop)} people (5% in 5 min, a lift every 90 s)`, proposed: `${lifts}`, status: 'warn', clause: 'CIBSE Guide D (as assumed)' });
  else if (liftsNeeded) C({ key: 'lifts', group: 'Cores', rule: 'Lifts', required: `${Math.max(codeMin, traffic.n)}`, proposed: `${lifts}`, status: 'pass', clause: `${code2} 9.27.1; CIBSE Guide D` });
  if (liftsNeeded && lifts > 0 && lifts < cores) C({ key: 'lift-cores', group: 'Cores', rule: 'A lift in every core', required: `${cores} (a core each)`, proposed: `${lifts}`, status: 'warn', clause: 'as assumed' });
  if (H > FIRE_LIFT_H) {
    C({ key: 'fire-lift', group: 'Cores', rule: 'Fire lift', required: 'a fire lift (from 15 m)', proposed: fireLift ? 'yes' : 'no', status: fireLift ? 'pass' : 'fail', clause: `${code2} 9.29.8` });
    if (fireLift && cap < 8) C({ key: 'fire-lift-cap', group: 'Cores', rule: 'Fire lift size', required: '8 persons (545 kg) or more', proposed: `${cap} persons`, status: 'fail', clause: 'NBC 2016 Part 4 (as assumed)' });
    if (fireLift && rise / v > 60) C({ key: 'fire-lift-speed', group: 'Cores', rule: 'Fire lift speed', required: 'the top floor in 60 s', proposed: `${fmt(rise / v)} s at ${fmt(v, 1)} m/s`, status: 'warn', clause: 'NBC 2016 Part 4 (as assumed)' });
    if (!lobby) C({ key: 'lobby', group: 'Cores', rule: 'Lift lobby', required: 'an enclosed, smoke-free lobby above 15 m', proposed: 'none', status: 'warn', clause: 'NBC 2016 Part 4 (as assumed)' });
  }

  // ---- cores: stairs
  const stairsMin = H > TWO_STAIRS_H ? 2 : 1;
  const stairsAuto = Math.max(stairsMin, cores);
  const stairs = pick(Co.stairs, stairsAuto);
  const wReq = stairFor(H);
  const occ = d0.floorOcc ?? b.plate / OCC_M2, wCap = (Math.ceil(occ / PER_UNIT - 1e-9) * UNIT_W);
  const stairWAuto = Math.max(wReq, up(wCap / Math.max(1, stairs), 0.05));
  const stairW = pick(Co.stairW, stairWAuto);
  const typeAuto: StairType = H > 45 && cores === 1 ? 'scissor' : 'dog-leg';
  const stairType = pick(Co.stairType, typeAuto);
  const sArea = stairArea(stairW, stairType, o.floorH) * stairs;
  L('Cores', 'Stairs', `${stairs} × ${m(stairW, 2)} ${stairType}`, `${fmt(sArea)} m² a floor; riser ${RISER * 1000} mm, tread ${TREAD * 1000} mm`);
  C({ key: 'stairs', group: 'Cores', rule: 'Staircases', required: `${stairsMin}${H > TWO_STAIRS_H ? ' (above 15 m)' : ''}`, proposed: `${stairs}`, status: stairs < stairsMin ? 'fail' : 'pass', clause: 'NBC 2016 Part 4 4.4.2.4' });
  if (stairs < cores) C({ key: 'stair-cores', group: 'Cores', rule: 'A stair in every core', required: `${cores}`, proposed: `${stairs}`, status: 'warn', clause: 'NBC 2016 Part 4 travel distance (as assumed)' });
  C({ key: 'stair-w', group: 'Cores', rule: 'Stair width', required: `at least ${m(wReq, 1)} clear`, proposed: m(stairW, 2), status: stairW < wReq - 1e-6 ? 'fail' : 'pass', clause: `${code2} Table 9G` });
  if (stairs * stairW < wCap - 1e-6) C({ key: 'stair-cap', group: 'Cores', rule: 'Stair capacity', required: `${m(wCap, 1)} in all for ${fmt(occ)} people a floor`, proposed: m(stairs * stairW, 2), status: 'fail', clause: 'NBC 2016 Part 4 Tables 21, 22 (as assumed)' });
  if (stairType === 'scissor' && stairs % 2) C({ key: 'scissor', group: 'Cores', rule: 'Scissor stairs', required: 'in pairs (two in an enclosure)', proposed: `${stairs}`, status: 'warn', clause: 'as assumed' });

  // ---- cores: shafts, chute, refuge
  const plumbingShafts = pick(Co.plumbingShafts, true), electricalShaft = pick(Co.electricalShaft, true);
  const chuteAuto = H > 45;
  const chute = pick(Co.chute, chuteAuto);
  const perFloorFlats = b.perFloor[0] + b.perFloor[1] + b.perFloor[2];
  const shaftArea = (plumbingShafts ? 0.72 * Math.max(perFloorFlats, 1) : 0) + (electricalShaft ? 1.2 * cores : 0) + (chute ? 1.0 * cores : 0) + 0.6 * cores;
  L('Cores', 'Shafts', [plumbingShafts && `plumbing ×${Math.max(perFloorFlats, 1)}`, electricalShaft && `electrical ×${cores}`, chute && `garbage chute ×${cores}`, `fire ×${cores}`].filter(Boolean).join(', '), `${fmt(shaftArea, 1)} m² a floor`);
  if (chute) cost.Cores += cores * (RATE.chuteBase + RATE.chuteFloor * b.floors);
  const refugesAuto = H > REFUGE_H ? Math.floor((H - REFUGE_H) / REFUGE_EVERY) + 1 : 0;
  const refuges = pick(Co.refuges, refugesAuto);
  const refugeArea = Math.max(15, 0.3 * d0.perFloorPop * 2);
  L('Cores', 'Refuge floors', refuges ? `${refuges} × ${fmt(refugeArea)} m²` : 'none', refugesAuto ? 'the floor above 24 m, above 39 m, then every 15 m; 15 m² or 0.3 m² a person of two floors' : `none up to ${REFUGE_H} m`);
  if (refugesAuto) C({ key: 'refuge', group: 'Cores', rule: 'Refuge floors', required: `${refugesAuto}`, proposed: `${refuges}`, status: refuges < refugesAuto ? 'fail' : 'pass', clause: `${code2} 9.29.6` });
  const coreArea = sArea + liftArea + (lobby || lifts ? lobbyArea : 0) + shaftArea;
  L('Cores', 'Core a floor', `${fmt(coreArea)} m²`, `${fmt((coreArea / Math.max(1, b.plate)) * 100)}% of the ${fmt(b.plate)} m² plate: stairs, lifts, lobby, shafts`);

  // ---- common load (now the lifts are known)
  const liftKW = (c: number, vv: number) => c * 68 * vv * 0.009; // ≈ kg × m/s × 0.009 kW (as assumed)
  const basementVentAuto = (o.basements ?? 0) > 0;
  const basementVent = pick(Hv.basementVent, basementVentAuto);
  const basementArea = o.basementArea ?? b.plate * (o.basements ?? 0);
  const pressAuto = H > 45;
  const press = pick(Hv.pressurise, pressAuto);
  const commonAuto = Math.round(
    lifts * liftKW(cap, v) + (service ? liftKW(13, v) : 0)
    + 7.5 + 2 * (b.floors / 10) // domestic transfer and booster pumps
    + 5 * b.plate * 0.12 * b.floors / 1000 // common lighting, 5 W/m² over 12% of the floor
    + (basementVent ? (8 * basementArea) / 1000 : 0)
    + (press ? 7.5 * stairs : 0)
    + 5); // gate, landscape, security
  const commonKW = pick(E.commonKW, commonAuto);

  const flatKWa: [number, number, number] = [...FLAT_KW];
  const d = demandOf(b, o, s, base, commonKW);
  L('Electrical', 'Connected load', `${fmt(d.flatKW)} kW flats + ${fmt(commonKW)} kW common`, `${[0, 1, 2].filter((t) => d.flats[t]).map((t) => `${['1', '2', '3'][t]} BHK ${fmt(pick(E.flatKW?.[t as 0 | 1 | 2], flatKWa[t]), 1)} kW`).join(', ') || `offices ${fmt(pick(E.officeW, OFFICE_W))} W/m²`}`);
  cost.Electrical += d.flatKW * RATE.flatKW + commonKW * RATE.commonKW;

  // solar, on its own roof
  const roofKWp = Math.floor((b.plate * ROOF_USE) / M2_KWP);
  const solarAuto = Math.max(0, Math.min(roofKWp, commonKW));
  const solar = pick(E.solar, solarAuto);
  L('Electrical', 'Rooftop solar', solar ? `${fmt(solar)} kWp` : 'none', `≈ ${fmt(solar * KWH_KWP * 365)} kWh a year; the roof takes ${fmt(roofKWp)} kWp, net metering up to the common load (as assumed)`);
  cost.Electrical += solar * RATE.solarKWp;
  if (solar > roofKWp + 0.5) C({ key: 'solar', group: 'Electrical', rule: 'Rooftop solar', required: `what the roof takes: ${fmt(roofKWp)} kWp`, proposed: `${fmt(solar)} kWp`, status: 'warn', clause: 'as assumed (half the roof, 10 m² a kWp)' });

  // ---- plumbing, in the building
  const ohtAuto = up((d.water * OHT_DAYS) / 1000, 5);
  const oht = pick(Pl.oht, ohtAuto);
  const band = d.fire ?? fireBand(H);
  L('Plumbing', 'Population and water', `${fmt(d.pop)} people, ${kl(d.water / 1000)} a day`, `${fmt(pick(Pl.lpcd, LPCD))} lpcd (NBC 2016 Part 9 Table 1); ${[0, 1, 2].map((t) => fmt(pick(Pl.persons?.[t as 0 | 1 | 2], PERSONS[t]), 1)).join(' / ')} persons a 1 / 2 / 3 BHK`);
  L('Plumbing', 'Overhead tank', `${kl(oht)} domestic + ${kl(band.terrace)} fire`, `${OHT_DAYS} day of domestic`);
  if (oht < ohtAuto - 0.5) C({ key: 'oht', group: 'Plumbing', rule: 'Overhead tank', required: `${kl(ohtAuto)} (half a day)`, proposed: kl(oht), status: 'warn', clause: 'NBC 2016 Part 9 (as assumed)' });
  const toilets = d.flats.reduce((x, n, t) => x + n * TOILETS[t], 0) + Math.ceil(d.officeCarpet / 150);
  cost.Plumbing += toilets * RATE.toilet + d.nFlats * RATE.kitchen + (oht + band.terrace) * 1000 * RATE.tankL + RATE.pumpsPer10Fl * Math.ceil(b.floors / 10);
  L('Plumbing', 'Toilets and kitchens', `${fmt(toilets)} toilets, ${fmt(d.nFlats)} kitchens`, 'supply, drainage and risers; sanitary ware and fittings are finishes');

  // ---- fire, in the building
  const riser = pick(F.riser, band.riser), sprinklers = pick(F.sprinklers, band.sprinklers), alarm = pick(F.alarm, band.alarm);
  L('Fire', 'Height band', band.band, d.fire ? 'NBC 2016 Part 4 Table 7, the strictest of its occupancies (non-residential groups as assumed)' : 'NBC 2016 Part 4 Table 7, A-4 apartment houses');
  if (d.fire && d.fire.classes.length > 1) C({ key: 'occupancy', group: 'Fire', rule: 'Mixed occupancy', required: 'the stricter provisions of each group, or each separated by fire walls', proposed: d.fire.classes.join(' + '), status: 'info', clause: 'NBC 2016 Part 4 (mixed occupancy)' });
  L('Fire', 'Riser', riser === 'wet' ? `wet riser ×${cores}, hose reels each floor` : riser === 'downcomer' ? `downcomer ×${cores}` : 'none (extinguishers and a hose reel)');
  L('Fire', 'Sprinklers', sprinklers === 'all' ? 'throughout' : sprinklers === 'basement' ? ((o.basements ?? 0) > 0 ? 'basements' : 'basements (none here)') : 'none');
  L('Fire', 'Detection and alarm', alarm ? (band.detect ? 'manual call points, automatic detection' : 'manual call points, talk-back') : 'none');
  cost.Fire += b.floors * cores * (riser === 'wet' ? RATE.riserFloor : riser === 'downcomer' ? RATE.downcomerFloor : 0) + b.floors * cores * RATE.extFloor;
  const sprArea = sprinklers === 'all' ? d.bua + basementArea : sprinklers === 'basement' ? basementArea : 0;
  cost.Fire += sprArea * RATE.sprinklerM2 + (alarm ? d.bua * RATE.alarmM2 : 0);
  if (RISER_RANK[riser] < RISER_RANK[band.riser]) C({ key: 'riser', group: 'Fire', rule: 'Riser', required: band.riser === 'wet' ? 'a wet riser' : 'a downcomer', proposed: riser, status: 'fail', clause: 'NBC 2016 Part 4 Table 7' });
  // (Note 4: in the basement only where it is over 200 m²)
  const sprNeed: Sprinklers = band.sprinklers === 'basement' && !((o.basements ?? 0) > 0 && basementArea > 200) ? 'none' : band.sprinklers;
  if (SPRINKLER_RANK[sprinklers] < SPRINKLER_RANK[sprNeed]) C({ key: 'sprinklers', group: 'Fire', rule: 'Sprinklers', required: sprNeed === 'all' ? `throughout (${band.band})` : 'in the basements', proposed: sprinklers, status: 'fail', clause: 'NBC 2016 Part 4 Table 7' });
  if (band.alarm && !alarm) C({ key: 'alarm', group: 'Fire', rule: 'Fire alarm', required: `${band.detect ? 'manual call points and automatic detection' : 'a manual fire alarm'} (${band.band})`, proposed: 'none', status: 'fail', clause: 'NBC 2016 Part 4 Table 7' });

  // ---- HVAC
  const hvacAuto: Hvac = d.officeCarpet > 0 && !d.nFlats ? 'vrv' : 'none';
  const hvac = pick(Hv.system, hvacAuto);
  L('HVAC', 'Air conditioning', hvac === 'none' ? 'points only (buyers fit their own)' : `${hvac === 'vrv' ? 'VRV' : 'split units'}, ${fmt(d.tr)} TR`, hvac === 'none' ? `≈ ${fmt(d.tr)} TR allowed for in the load` : `${[0, 1, 2].map((t) => fmt(FLAT_TR[t], 1)).join(' / ')} TR a 1 / 2 / 3 BHK; offices a TR per ${OFFICE_M2_TR} m² (as assumed)`);
  cost.HVAC += hvac === 'split' ? d.tr * RATE.splitTR : hvac === 'vrv' ? d.tr * RATE.vrvTR : 0;
  L('HVAC', 'Basement ventilation', basementVent ? `jet fans and smoke extraction, ${fmt(basementArea)} m²` : (o.basements ?? 0) ? 'none' : 'no basements');
  cost.HVAC += basementVent ? basementArea * RATE.basementVentM2 : 0;
  if ((o.basements ?? 0) > 0 && !basementVent) C({ key: 'basement-vent', group: 'HVAC', rule: 'Basement ventilation', required: 'mechanical ventilation, 12 air changes an hour for smoke (as assumed)', proposed: 'none', status: 'fail', clause: 'NBC 2016 Part 4 / Part 8 (as assumed)' });
  L('HVAC', 'Stair pressurisation', press ? `${stairs} stair${stairs === 1 ? '' : 's'} and the fire-lift lobby` : 'none (stairs ventilated naturally)');
  cost.HVAC += press ? stairs * (RATE.pressStair + RATE.pressFloor * b.floors) : 0;
  if (H > 45 && !press) C({ key: 'press', group: 'HVAC', rule: 'Stair pressurisation', required: 'pressurised stairs above 45 m (as assumed)', proposed: 'none', status: 'warn', clause: 'NBC 2016 Part 4 (as assumed)' });

  if (o.code !== 'udcpr') for (const g of SYSTEMS_GROUPS) cost[g] *= 1.1;
  const dgAuto: DgBackup = liftsNeeded || H > FIRE_LIFT_H ? 'common' : 'none';
  return {
    d, lines, spaces, cost, checks, dgAuto,
    auto: {
      stairs: stairsAuto, stairW: stairWAuto, stairType: typeAuto, lifts: liftsAuto, liftCap: capAuto, liftSpeed: speedAuto, serviceLift: serviceAuto, fireLift: fireLiftAuto, lobby: lobbyAuto,
      plumbingShafts: true, electricalShaft: true, chute: chuteAuto, refuges: refugesAuto,
      flatKW: flatKWa, officeW: OFFICE_W, commonKW: commonAuto, diversity: divFor(d.nFlats || d.officeCarpet / 60), solar: solarAuto,
      lpcd: LPCD, persons: [...PERSONS], oht: ohtAuto, sprinklers: band.sprinklers, riser: band.riser, alarm: band.alarm,
      hvac: hvacAuto, basementVent: basementVentAuto, pressurise: pressAuto,
    },
  };
}

const bays0 = (d: Demand[]) => d.reduce((t, x) => t + x.nFlats + Math.ceil(x.officeCarpet / 100), 0);

function finish(parts: { lines: SystemsLine[]; spaces: SystemsSpace[]; cost: Record<SystemsGroup, number>; checks: SystemsCheck[] }[], plantCost: number, bua: number, auto: Auto): SystemsResult {
  const costBy: Record<SystemsGroup, number> = { Cores: 0, Electrical: 0, Plumbing: 0, Fire: 0, HVAC: 0 };
  for (const p of parts) for (const g of SYSTEMS_GROUPS) costBy[g] += p.cost[g];
  for (const g of SYSTEMS_GROUPS) costBy[g] = Math.round(costBy[g]);
  const cost = SYSTEMS_GROUPS.reduce((t, g) => t + costBy[g], 0);
  const order = (g: SystemsGroup) => SYSTEMS_GROUPS.indexOf(g);
  return {
    lines: parts.flatMap((p) => p.lines).sort((a, b) => order(a.group) - order(b.group)),
    spaces: parts.flatMap((p) => p.spaces),
    cost, costPerSqft: bua > 0 ? cost / (bua * SQFT) : 0, costBy, plantCost: Math.round(plantCost),
    checks: parts.flatMap((p) => p.checks).sort((a, b) => order(a.group) - order(b.group)),
    auto,
  };
}

/** One building's systems, with the site plant sized as if it stood alone (lines and spaces marked `site`). Pure. */
export function systemsOf(b: BuildingReport, opts: SystemsOpts): SystemsResult {
  const bo = building(b, opts);
  const pl = plant({ d: [bo.d], code: opts.code, settings: opts.settings ?? {}, bays: opts.bays ?? bays0([bo.d]), dgAuto: bo.dgAuto, fireH: b.height });
  const plantCost = SYSTEMS_GROUPS.reduce((t, g) => t + pl.cost[g], 0);
  return finish([bo, pl], plantCost, bo.d.bua, { ...bo.auto, ...pl.auto });
}

/** Every building's systems with the plant (substation, DG, underground tanks, STP, RWH, pump room, hydrants, EV) sized
 *  once for the site from all of them together. Plant settings come from `opts.site`; each building's own settings
 *  from its entry. `buildings[i]` is the building's own share (its plant lines dropped, `plantCost` 0). */
export function siteSystems(list: { b: BuildingReport; settings?: SystemsSettings }[], opts: Omit<SystemsOpts, 'settings'> & { site?: SystemsSettings }): SystemsResult & { buildings: SystemsResult[] } {
  const bos = list.map((x) => building(x.b, { ...opts, settings: x.settings }));
  const fireH = list.reduce((h, x) => Math.max(h, x.b.height), 0);
  const dgAuto: DgBackup = bos.some((x) => x.dgAuto !== 'none') ? 'common' : 'none';
  const pl = plant({ d: bos.map((x) => x.d), code: opts.code, settings: opts.site ?? {}, bays: opts.bays ?? bays0(bos.map((x) => x.d)), dgAuto, fireH });
  const plantCost = SYSTEMS_GROUPS.reduce((t, g) => t + pl.cost[g], 0);
  const bua = bos.reduce((t, x) => t + x.d.bua, 0);
  const autoOf = (x: BuildingOut): Auto => ({ ...x.auto, ...pl.auto });
  const buildings = bos.map((x) => finish([x], 0, x.d.bua, autoOf(x)));
  const named = bos.map((x, i) => (bos.length > 1 ? { ...x, checks: x.checks.map((c) => ({ ...c, key: `${c.key}:${i}`, rule: `${c.rule} · building ${String.fromCharCode(65 + i)}` })) } : x));
  return { ...finish([...named, pl], plantCost, bua, bos[0] ? autoOf(bos[0]) : ({} as Auto)), buildings };
}

// ---------------------------------------------------------------- settings: building vs. site plant
/** The settings that belong to the site plant (see siteSystems). */
const PLANT: { [G in keyof SystemsSettings]?: (keyof NonNullable<SystemsSettings[G]>)[] } = {
  electrical: ['transformer', 'dg', 'ev'],
  plumbing: ['ugt', 'stp', 'rwh'],
  fire: ['tank', 'hydrant', 'pumpRoom'],
};

/** Split one settings object into the building's own and the site plant's (for a panel that edits both at once). */
export function splitSettings(s: SystemsSettings): { building: SystemsSettings; plant: SystemsSettings } {
  const building: Record<string, Record<string, unknown>> = {}, plantS: Record<string, Record<string, unknown>> = {};
  for (const [g, v] of Object.entries(s)) {
    if (!v) continue;
    const keys = (PLANT as Record<string, string[] | undefined>)[g] ?? [];
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (x === undefined) continue;
      const to = keys.includes(k) ? plantS : building;
      (to[g] ??= {})[k] = x;
    }
  }
  return { building: building as SystemsSettings, plant: plantS as SystemsSettings };
}

/** A building's settings with the site plant's laid over them. */
export function mergeSettings(building: SystemsSettings | undefined, plantS: SystemsSettings | undefined): SystemsSettings {
  const out: Record<string, Record<string, unknown>> = {};
  for (const src of [splitSettings(building ?? {}).building, splitSettings(plantS ?? {}).plant]) {
    for (const [g, v] of Object.entries(src)) out[g] = { ...(out[g] ?? {}), ...(v as Record<string, unknown>) };
  }
  return out as SystemsSettings;
}

/** Whether a setting is plant (site-wide). */
export const isPlant = (group: keyof SystemsSettings, key: string) => ((PLANT as Record<string, string[] | undefined>)[group] ?? []).includes(key);
