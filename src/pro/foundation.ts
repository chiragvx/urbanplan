// What the plot's ground (./ground.ts) makes of the scheme (docs/plans/plot-ground.md §3): each building's foundation
// (footings, footings on rock, a raft, piles, a piled raft, under-reamed piles), the basements' dig layer by layer,
// how their sides are held up, the water kept out, cut and fill across the plot, and how many basements the ground
// makes worth digging. Pure: the evaluation, the 3D, the drawings and the tests share it.
//
// A feasibility estimate, never a design: the loads are rules of thumb per m² of floor, the bearing figures
// presumptive (or a report's, per layer), the rates rough 2026 Pune figures. The build and parking rates already carry
// an ordinary foundation and an ordinary dig, so every figure here is also worked out on "ordinary ground" (stiff clay,
// no water, no rock in reach) and the money takes only the difference, which can be a saving on good ground.
import type { PlotReport } from '../doc/plot';
import { buaOf, SQFT, type SiteReport } from '../doc/site';
import { cityFactor, gammaTo, groundAtPoint, heightAt, rockTop, runAt, runsOf, seismicZone, SOILS, type DigKind, type Layer, type PlotGround, type Run, type SoilKind } from './ground';
import { DEFAULT_LEVELS, type Levels } from './siteObjects';

/** the rates (₹, Pune; Mumbai a quarter more) and outputs, as assumed */
export const RATES = {
  /** digging and carting away, ₹/m³, by how it's dug */
  dig: { soil: 350, ripped: 650, breaker: 1400, blast: 2200 } as Record<DigKind, number>,
  /** m³ a month a site gets through, by how it's dug */
  pace: { soil: 15000, ripped: 7000, breaker: 2500, blast: 3000 } as Record<DigKind, number>,
  /** holding the cut's sides up, ₹/m² of its face */
  shore: { bolt: 2500, soldier: 6000, contiguous: 9000, secant: 14000, dwall: 22000 },
  /** keeping the water down while the dig is open, ₹ per m² of wet face a month, by how freely the water moves */
  dewater: { low: 150, medium: 400, high: 900 },
  /** tanking a basement below the water (floor and walls), ₹/m²; anchors against uplift, ₹/m² of basement */
  tanking: 1200, anchors: 1800,
  /** reinforced concrete in a footing, raft or pile cap, ₹/m³ */
  rcc: 9000,
  /** bored cast-in-situ piles, ₹ per metre by diameter (m); the socket in rock costs this many times as much */
  pile: { 0.6: 6500, 0.8: 11000, 1: 16000 } as Record<number, number>, socket: 2.5,
  /** an under-reamed pile, 300 mm, about 3.5 m, ₹ each */
  ureamed: 11000,
  /** filling and compacting, ₹/m³ */
  fill: 450,
};
/** dead and live load a m² of floor, kN (as assumed: RCC frame, partitions, finishes, services and the live load) */
export const FLOOR_LOAD = { homes: 12.5, other: 14 };
/** a basement storey's own weight under a building, kN/m² of its footprint */
const BASEMENT_LOAD = 15;
/** found below this in expansive soil (the active zone), m */
export const ACTIVE_ZONE = 3.5;
/** the ground the build and parking rates assume (as assumed): firm soil over a bearing layer within reach, rock
 *  below that, no water; a tall building on it stands on a raft or short piles, never on friction piles */
export const ORDINARY: Layer[] = [{ kind: 'stiff-clay', thick: 3 }, { kind: 'murum', thick: 5 }, { kind: 'soft-rock', thick: 4 }, { kind: 'hard-rock', thick: 40 }];
const ORDINARY_RUNS = runsOf(ORDINARY);

export type FoundationKind = 'footings' | 'rock' | 'raft' | 'piles' | 'piled-raft' | 'ureamed';
export const FOUNDATION_LABEL: Record<FoundationKind, string> = {
  footings: 'Isolated footings', rock: 'Footings on rock', raft: 'Raft', piles: 'Bored piles', 'piled-raft': 'Piled raft', ureamed: 'Under-reamed piles',
};
export type ShoreKind = keyof typeof RATES.shore;
export const SHORE_LABEL: Record<ShoreKind, string> = {
  bolt: 'Rock face, bolted and shotcreted', soldier: 'Soldier piles and lagging', contiguous: 'Contiguous piles', secant: 'Secant piles (watertight)', dwall: 'Diaphragm wall',
};
export interface Flag { key: string; status: 'warn' | 'fail' | 'info'; rule: string; text: string; clause: string }

export interface Found {
  id: string; name: string; kind: FoundationKind; label: string;
  /** the founding depth below the ground (m), and what it bears on there */
  depth: number; on: SoilKind;
  /** the pressure under it (kN/m², net of the earth dug out) and the bearing it has */
  q: number; sbc: number;
  piles?: { n: number; dia: number; length: number; socket: number; into: SoilKind | null };
  raft?: number;
  /** the building's weight (kN) and footprint (m²) */
  weight: number; footprint: number;
  cost: number; ordinary: number;
  why: string[]; flags: Flag[];
  /** where it is (plot metres), for the cut-away */
  at: [number, number];
}
export interface Dig {
  n: number; depth: number; area: number; perimeter: number;
  byLayer: { kind: SoilKind; vol: number; cost: number; dig: DigKind }[];
  shore: { kind: ShoreKind; label: string; area: number; cost: number } | null;
  /** the rock part of the cut's face, bolted */
  rockFace: { area: number; cost: number } | null;
  water: { below: boolean; head: number; dewater: number; tanking: number; anchors: number; uplift: boolean };
  months: number; cost: number;
}
export interface GroundWorks {
  dig: Dig | null; ordinaryDig: Dig | null;
  buildings: Found[];
  cutFill: { cut: number; fill: number; cost: number; range: [number, number] };
  /** what the money takes: each line as the ground has it, what ordinary ground costs, and the difference */
  lines: { excavation: number; shoring: number; water: number; foundations: number; total: number; ordinary: number; net: number };
  /** months the ground adds to the programme over ordinary ground */
  months: number;
  flags: Flag[];
  cap: BasementCap;
  zone: string;
}

const r1 = (v: number) => Math.round(v * 10) / 10;
const lakh = (v: number) => `₹${(v / 1e5).toFixed(1)} lakh`;
const ringArea = (P: number[]) => { let a = 0; for (let i = 0; i < P.length; i += 2) { const j = (i + 2) % P.length; a += P[i] * P[j + 1] - P[j] * P[i + 1]; } return Math.abs(a) / 2; };
const ringPerim = (P: number[]) => { let s = 0; for (let i = 0; i < P.length; i += 2) { const j = (i + 2) % P.length; s += Math.hypot(P[j] - P[i], P[j + 1] - P[i + 1]); } return s; };
const inside = (P: number[], x: number, z: number) => { let c = false; for (let i = 0, j = P.length - 2; i < P.length; j = i, i += 2) { const xi = P[i], zi = P[i + 1], xj = P[j], zj = P[j + 1]; if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };

// ---------------------------------------------------------------- the basements' dig

/** the dig for `n` basements `bh` apart over `area` (m²) inside a cut `perimeter` long, through `runs` */
export function digOf(n: number, bh: number, area: number, perimeter: number, runs: Run[], water: number | null, k = 1): Dig | null {
  if (n <= 0 || area <= 1) return null;
  const depth = n * bh + 0.6, A = area * 1.08;
  const byLayer: Dig['byLayer'] = [];
  let months = 0;
  for (const r of runs) {
    const t = Math.max(0, Math.min(depth, r.bottom) - r.top); if (t <= 0) continue;
    const S = SOILS[r.kind], vol = t * A;
    byLayer.push({ kind: r.kind, vol, cost: vol * RATES.dig[S.dig] * k, dig: S.dig });
    months += vol / RATES.pace[S.dig];
  }
  // (the sides: the soil part shored by what the soil and the water call for, the rock part bolted)
  const rt = rockTop(runs), soilD = rt === null ? depth : Math.min(depth, rt), rockD = depth - soilD;
  const below = water !== null && water < depth, head = below ? depth - water! : 0;
  let shore: Dig['shore'] = null;
  if (soilD > 0.05) {
    const soils = runs.filter((r) => r.top < soilD), wetSoil = below && water! < soilD;
    const soft = soils.some((r) => r.kind === 'soft-clay' || r.kind === 'fill' || r.kind === 'loose-sand');
    const allStand = soils.every((r) => SOILS[r.kind].stands);
    const kind: ShoreKind = soft && wetSoil && soilD > 6 ? 'dwall' : wetSoil ? 'secant' : allStand && soilD <= 6 ? 'soldier' : 'contiguous';
    const a = perimeter * soilD;
    shore = { kind, label: SHORE_LABEL[kind], area: a, cost: a * RATES.shore[kind] * k };
    months += a / (kind === 'dwall' ? 350 : kind === 'secant' ? 450 : 700);
  }
  const rockFace = rockD > 0.05 ? { area: perimeter * rockD, cost: perimeter * rockD * RATES.shore.bolt * k } : null;
  // (water: pumped down while the dig is open and the floors go up over it; tanked; held down against uplift)
  const perm = below ? runs.filter((r) => r.bottom > water! && r.top < depth).reduce<'low' | 'medium' | 'high'>((p, r) => (rank(SOILS[r.kind].perm) > rank(p) ? SOILS[r.kind].perm : p), 'low') : 'low';
  const wetMonths = below ? months + 2 + n * 1.5 : 0;
  const dewater = below ? perimeter * head * RATES.dewater[perm] * wetMonths * k : 0;
  const tanking = below ? (area + perimeter * depth) * RATES.tanking * k : 0;
  const total = byLayer.reduce((s, x) => s + x.cost, 0) + (shore?.cost ?? 0) + (rockFace?.cost ?? 0) + dewater + tanking;
  return { n, depth, area, perimeter, byLayer, shore, rockFace, water: { below, head, dewater, tanking, anchors: 0, uplift: false }, months: Math.round(months * 2) / 2, cost: total };
}
const rank = (p: 'low' | 'medium' | 'high') => (p === 'low' ? 0 : p === 'medium' ? 1 : 2);

// ---------------------------------------------------------------- a building's foundation

export interface FoundIn { id: string; name: string; footprint: number; bua: number; floors: number; homes: boolean; at: [number, number] }
/** a building's foundation on `runs` with the water at `water`, its lowest floor `base` m down (0: none) */
export function foundOf(b: FoundIn, runs: Run[], water: number | null, base: number, basements: number, zone: string, k = 1): Found {
  const why: string[] = [], flags: Flag[] = [];
  const A = Math.max(1, b.footprint), floors = Math.max(1, b.floors);
  const W = b.bua * (b.homes ? FLOOR_LOAD.homes : FLOOR_LOAD.other) + A * basements * BASEMENT_LOAD;
  const q = W / A;
  // (the founding level: the basement's floor, else 1.5 m; below the active zone in expansive soil)
  let D = base > 0 ? base : 1.5;
  const ex0 = SOILS[runAt(runs, D).kind].expansive;
  while (SOILS[runAt(runs, D).kind].expansive && D < ACTIVE_ZONE) D = Math.min(ACTIVE_ZONE, runAt(runs, D).bottom + 0.3);
  // (just under a layer of it: a little way into the layer below, not on the line between)
  const bc = runs.find((r) => SOILS[r.kind].expansive && r.bottom <= D && r.bottom > D - 0.3);
  if (bc) D = bc.bottom + 0.3;
  if (ex0 && D > (base > 0 ? base : 1.5)) why.push(`Black cotton soil swells and shrinks: the foundation goes below it, to ${r1(D)} m.`);
  const relief = base > 0 ? gammaTo(runs, base) * base : 0;
  const qn = Math.max(0, q - relief);
  if (relief > 0) why.push(`The basements take out ${Math.round(relief)} kN/m² of earth, so the ground carries ${Math.round(qn)} of the building's ${Math.round(q)} kN/m².`);
  const rt = rockTop(runs), at = runAt(runs, D), sbc = at.sbc;
  const liq = water !== null && zone !== 'II' && runs.some((r) => SOILS[r.kind].liquefiable && r.top < 15 && r.bottom > water && r.bottom > D);
  if (liq) flags.push({ key: 'liquefaction', status: 'warn', rule: 'Liquefaction', text: `Loose sand under the water in seismic zone ${zone}: it may liquefy in an earthquake, so the building goes on piles through it. A soil report should check it (SPT N, fines).`, clause: 'IS 1893 (Part 1) 2016, 6.1.3 (as assumed)' });
  const out = (kind: FoundationKind, cost: number, more: Partial<Found> = {}): Found => ({
    id: b.id, name: b.name, kind, label: FOUNDATION_LABEL[kind], depth: r1(more.depth ?? D), on: more.on ?? at.kind, q: Math.round(qn), sbc: more.sbc ?? sbc,
    weight: W, footprint: A, cost, ordinary: 0, why, flags, at: b.at, ...more,
  });
  const raftT = Math.min(3, Math.max(0.6, 0.3 + 0.06 * floors));
  // 1. rock within reach of the founding level: footings on it (or the raft the basement floor already is, on rock)
  if (rt !== null && rt <= D + 1.5 && !liq) {
    const s = runAt(runs, Math.max(rt, D) + 0.01).sbc, cover = Math.min(1, Math.max(0.12, qn / s));
    why.push(rt > D ? `Rock is ${r1(rt)} m down, just under the founding level: the footings are taken down onto it.` : `The founding level is in rock: footings sit on it.`);
    const pits = Math.max(0, rt - D) * A * cover * RATES.dig[SOILS[runAt(runs, Math.max(rt, D) - 0.01).kind].dig] * k;
    return out('rock', A * cover * 0.6 * RATES.rcc * k + pits, { depth: Math.max(rt, D), on: runAt(runs, Math.max(rt, D) + 0.01).kind, sbc: s });
  }
  // 2. expansive soil all the way to the active zone: under-reamed piles for a low building
  if (SOILS[at.kind].expansive && floors <= 4 && !liq) {
    const n = Math.ceil((W * 1.1) / 250);
    why.push('Black cotton soil runs deep: a low building stands on under-reamed piles below its active zone.');
    flags.push({ key: 'expansive', status: 'info', rule: 'Expansive soil', text: 'Black cotton soil: under-reamed piles, a void or sand cushion under the plinth beams, and no trees close by.', clause: 'IS 2911 (Part 3) 1980; IS 1904 (as assumed)' });
    return out('ureamed', n * RATES.ureamed * k + A * 0.08 * RATES.rcc * k, { piles: { n, dia: 0.3, length: ACTIVE_ZONE, socket: 0, into: at.kind }, depth: ACTIVE_ZONE });
  }
  const need = sbc > 0 ? qn / sbc : Infinity;
  // 3. footings, while they cover under half the footprint
  if (!liq && need <= 0.5) {
    why.push(`${SOILS[at.kind].short} at ${r1(D)} m bears about ${sbc} kN/m²: footings under ${Math.round(need * 100)}% of the footprint carry it.`);
    return out('footings', A * Math.max(0.15, need) * 0.9 * RATES.rcc * k);
  }
  // 4. a raft, while the layer bears the whole footprint
  if (!liq && need <= 1) {
    why.push(`Footings would cover ${Math.round(need * 100)}% of the footprint on ${SOILS[at.kind].short.toLowerCase()} (${sbc} kN/m²): a raft ${raftT.toFixed(1)} m thick spreads it.`);
    return out('raft', A * 1.1 * raftT * RATES.rcc * k, { raft: raftT });
  }
  // 5. piles down to a layer that bears (socketed in rock), or a piled raft for a tall one on middling ground
  const bear = runs.find((r) => r.bottom > D && (SOILS[r.kind].rock || r.sbc >= 350) && !(liq && SOILS[r.kind].liquefiable));
  const dia = floors <= 10 ? 0.6 : floors <= 25 ? 0.8 : 1;
  const base0 = { 0.6: 2200, 0.8: 3800, 1: 6000 }[dia as 0.6 | 0.8 | 1]!;
  let length: number, socket: number, capF: number, into: SoilKind | null;
  if (bear && Math.max(bear.top, D) - D <= 45) {
    const start = Math.max(bear.top, D);
    socket = bear.kind === 'hard-rock' ? Math.max(2, 3 * dia) : SOILS[bear.kind].rock ? Math.max(3, 5 * dia) : 6;
    length = start - D + socket; into = bear.kind;
    capF = bear.kind === 'hard-rock' ? 1 : SOILS[bear.kind].rock ? 0.6 : 0.35;
    why.push(`${need === Infinity ? 'The layer at the founding level bears nothing' : `The ground at ${r1(D)} m (${SOILS[at.kind].short.toLowerCase()}, ${sbc} kN/m²) can't carry ${Math.round(qn)} kN/m²`}: piles ${dia} m across go down through it${start > D ? ` ${r1(start - D)} m` : ''} to ${SOILS[bear.kind].short.toLowerCase()}${SOILS[bear.kind].rock ? `, socketed ${r1(socket)} m into it` : ''}.`);
  } else {
    length = 25; socket = 0; capF = 0.25; into = null;
    why.push('No layer within reach bears it: friction piles 25 m long carry it by their sides.');
    flags.push({ key: 'friction-piles', status: 'warn', rule: 'Pile founding', text: 'No firm layer within reach in the log: friction piles, as assumed. A soil investigation to depth is needed before the scheme is relied on.', clause: 'IS 2911 (Part 1/Sec 2) 2010 (as assumed)' });
  }
  const cap = base0 * capF, piledRaft = !liq && need <= 1.8 && floors >= 15 && into !== null;
  let n = Math.max(2, Math.ceil((W * 1.15) / cap));
  if (piledRaft) { n = Math.max(2, Math.ceil(n * 0.6)); why.push(`Tall, on ground that carries part of it: a piled raft, the raft taking about ${Math.round(Math.min(1, 1 / need) * 40)}% and ${n} piles the rest.`); }
  const pileCost = n * ((length - socket) * RATES.pile[dia] + socket * RATES.pile[dia] * RATES.socket) * k;
  const capCost = piledRaft ? A * 1.1 * raftT * RATES.rcc * k : A * 0.35 * 1.2 * RATES.rcc * k;
  return out(piledRaft ? 'piled-raft' : 'piles', pileCost + capCost, { piles: { n, dia, length: r1(length), socket: r1(socket), into }, ...(piledRaft ? { raft: raftT } : {}) });
}

// ---------------------------------------------------------------- how many basements the ground makes worth it

export interface BasementCap { max: number; why: string; perBay: number[] }
/** bays a basement level holds, roughly (m² of level a bay, ramps and aisles in) */
const M2_A_BAY = 30;
/** The most basements worth digging: the k-th stops being worth it when what the ground adds to it over ordinary
 *  ground, per bay it holds, is more than a podium bay costs to build; and the ground rules out a dig deeper than
 *  10 m in soft, wet ground on a plot (beyond what can be shored sensibly here). */
export function basementCap(g: PlotGround, r: PlotReport, floorH: number, parkingRate: number, max = 4): BasementCap {
  const net = r.net.length >= 6 ? r.net : [];
  const A = Math.max(0, ringArea(net) - ringPerim(net) * 1.5), P = Math.max(0, ringPerim(net) - 12), bh = Math.max(3, floorH), k = cityFactor(r.code);
  const runs = runsOf(g.layers), podiumBay = M2_A_BAY * SQFT * parkingRate;
  const bays = Math.max(1, (A * 0.85) / M2_A_BAY), perBay: number[] = [];
  let prev = 0, prevO = 0;
  for (let n = 1; n <= max; n++) {
    const a = digOf(n, bh, A, P, runs, g.water, k), o = digOf(n, bh, A, P, ORDINARY_RUNS, null, k);
    const extra = (a?.cost ?? 0) - prev - ((o?.cost ?? 0) - prevO);
    perBay.push(extra / bays);
    const depth = n * bh + 0.6, soft = runs.some((x) => x.top < depth && (x.kind === 'soft-clay' || x.kind === 'fill' || x.kind === 'loose-sand') && x.bottom > (g.water ?? Infinity));
    if (soft && depth > 10) return { max: n - 1, why: `A ${n === 1 ? 'first' : n === 2 ? 'second' : n === 3 ? 'third' : `${n}th`} basement would dig ${r1(depth)} m into soft ground under the water: beyond what the plot can shore sensibly.`, perBay };
    if (extra / bays > podiumBay) return { max: n - 1, why: `The ${n === 1 ? 'first' : n === 2 ? 'second' : n === 3 ? 'third' : `${n}th`} basement would cost ${lakh(extra / bays)} a bay more than on ordinary ground, more than a podium bay (${lakh(podiumBay)}).`, perBay };
    prev = a?.cost ?? 0; prevO = o?.cost ?? 0;
  }
  return { max, why: `The ground allows up to ${max} basements at a reasonable cost a bay.`, perBay };
}

// ---------------------------------------------------------------- all of it, for a scheme

/** The plot's ground worked through the scheme: each building's foundation, the basements' dig, cut and fill, the
 *  money's lines against ordinary ground, the months, the flags. */
export function groundWorks(g: PlotGround, r: PlotReport, d: SiteReport, o: { floorH: number; levels?: Levels; north?: number; city: string; userBasements?: number; parkingRate: number }): GroundWorks {
  const k = cityFactor(r.code), zone = seismicZone(o.city), bh = Math.max(3, o.floorH);
  const n = d.site.basements, lv = d.parking.levels.filter((l) => l.kind === 'basement');
  const net = r.net.length >= 6 ? r.net : [];
  const A = lv.length ? lv[0].area : Math.max(0, ringArea(net) - ringPerim(net) * 1.5), P = Math.max(0, ringPerim(net) - 12);
  let cx = 0, cz = 0; for (let i = 0; i < net.length; i += 2) { cx += net[i]; cz += net[i + 1]; } cx /= Math.max(1, net.length / 2); cz /= Math.max(1, net.length / 2);
  const mid = groundAtPoint(g, cx, cz), runs = runsOf(mid.layers);
  const dig = digOf(n, bh, A, P, runs, mid.water, k), ordinaryDig = digOf(n, bh, A, P, ORDINARY_RUNS, null, k);
  const flags: Flag[] = [];
  // each building on the ground under its middle
  const buildings = d.buildings.map((b, i): Found => {
    const pts = b.laid?.outline ?? b.quads.flat();
    let x = 0, z = 0; for (let j = 0; j < pts.length; j += 2) { x += pts[j]; z += pts[j + 1]; } x /= Math.max(1, pts.length / 2); z /= Math.max(1, pts.length / 2);
    const here = groundAtPoint(g, x, z), hr = runsOf(here.layers);
    const inp: FoundIn = { id: b.b.id, name: (b.b as { name?: string }).name ?? `Building ${String.fromCharCode(65 + i)}`, footprint: b.plate, bua: buaOf(b), floors: b.floors + d.under, homes: b.use === 'residential', at: [x, z] };
    const f = foundOf(inp, hr, here.water, dig?.depth ?? 0, n, zone, k);
    f.ordinary = foundOf(inp, ORDINARY_RUNS, null, ordinaryDig?.depth ?? 0, n, zone, k).cost;
    return f;
  });
  // uplift: the water's push on the basement floor against the weight over it
  if (dig && dig.water.below) {
    const u = 10 * dig.water.head, w = buildings.reduce((s, f) => s + f.weight, 0) / Math.max(1, dig.area) + 12 * n;
    if (u * 1.1 > w) { dig.water.uplift = true; dig.water.anchors = dig.area * RATES.anchors * k; dig.cost += dig.water.anchors; }
    flags.push({ key: 'water', status: dig.water.uplift ? 'warn' : 'info', rule: 'Basements below the water', text: `The water stands ${r1(mid.water!)} m down; the basements go ${r1(dig.depth)} m: ${r1(dig.water.head)} m below it. Dewatered while dug, tanked${dig.water.uplift ? `, and anchored down: the water's push (${Math.round(u)} kN/m²) beats the weight over the open parts of the basement` : ''}.`, clause: 'IS 1904; NBC 2016 Part 6 (as assumed)' });
  }
  if (dig && dig.shore && (dig.shore.kind === 'dwall' || dig.shore.kind === 'secant')) flags.push({ key: 'shoring', status: 'info', rule: 'Excavation support', text: `${dig.shore.label} round the dig, ${Math.round(dig.shore.area)} m² of it: the neighbours' foundations need watching while it's open.`, clause: 'IS 9759; IS 3764 (as assumed)' });
  // cut and fill across the plot, against the level the scheme is set at
  const L: Levels = { ...DEFAULT_LEVELS, ...(o.levels ?? {}) };
  let cut = 0, fill = 0, lo = Infinity, hi = -Infinity;
  if (net.length && (L.slope > 0 || g.spots?.length)) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < net.length; i += 2) { x0 = Math.min(x0, net[i]); x1 = Math.max(x1, net[i]); z0 = Math.min(z0, net[i + 1]); z1 = Math.max(z1, net[i + 1]); }
    const s = Math.max(1, Math.sqrt(((x1 - x0) * (z1 - z0)) / 2500));
    for (let x = x0 + s / 2; x < x1; x += s) for (let z = z0 + s / 2; z < z1; z += s) {
      if (!inside(net, x, z)) continue;
      const h = heightAt(L, g.spots, x, z, cx, cz, o.north ?? 0) - L.plot; lo = Math.min(lo, h); hi = Math.max(hi, h);
      if (h > 0) cut += h * s * s; else fill -= h * s * s;
    }
  }
  const topDig = RATES.dig[SOILS[runs[0].kind].dig];
  const cutFill = { cut, fill, cost: (cut * topDig + fill * RATES.fill) * k, range: [Number.isFinite(lo) ? lo : 0, Number.isFinite(hi) ? hi : 0] as [number, number] };
  if (cutFill.range[1] - cutFill.range[0] > bh / 2 && n > 0) flags.push({ key: 'slope-basement', status: 'warn', rule: 'Basement on a slope', text: `The ground falls ${r1(cutFill.range[1] - cutFill.range[0])} m across the plot: on the low side the basement comes partly out of the ground. Whether it still counts as a basement (free of FSI) depends on how much stands above the ground: check with the authority.`, clause: 'UDCPR 2020 / DCPR 2034 definitions of basement (as assumed)' });
  for (const f of buildings) for (const x of f.flags) flags.push({ ...x, key: `${x.key}:${f.id}`, rule: `${x.rule} · ${f.name}` });
  // the money: the ground's against ordinary ground's
  const excav = (dig?.byLayer.reduce((s, x) => s + x.cost, 0) ?? 0) + cutFill.cost;
  const shoring = (dig?.shore?.cost ?? 0) + (dig?.rockFace?.cost ?? 0);
  const water = dig ? dig.water.dewater + dig.water.tanking + dig.water.anchors : 0;
  const foundations = buildings.reduce((s, f) => s + f.cost, 0);
  const total = excav + shoring + water + foundations;
  const ordinary = (ordinaryDig?.cost ?? 0) + buildings.reduce((s, f) => s + f.ordinary, 0);
  const cap = basementCap(g, r, o.floorH, o.parkingRate);
  if (o.userBasements !== undefined && o.userBasements > cap.max) flags.push({ key: 'basement-cap', status: 'warn', rule: 'Basements against the ground', text: `${o.userBasements} basements asked for; the ground makes ${cap.max} worth it. ${cap.why}`, clause: 'Feasibility (as assumed)' });
  const months = Math.max(0, (dig?.months ?? 0) - (ordinaryDig?.months ?? 0));
  return { dig, ordinaryDig, buildings, cutFill, lines: { excavation: excav, shoring, water, foundations, total, ordinary, net: total - ordinary }, months: Math.round(months * 2) / 2, flags, cap, zone };
}
