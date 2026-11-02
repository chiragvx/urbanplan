// Plot sandbox: what a plot loses to the Development Plan road and what can be built on the rest. The road it
// fronts sets the FSI and the margins; the margins cut the buildable footprint; the permissible built-up area
// stacked on that footprint gives the floors and the height of the envelope.
//
// Rules by city (`code`), as starting points every plot can override; the panel says to check them:
// - Pune (and anywhere else in Maharashtra): UDCPR 2020 for a municipal corporation. FSI from Table 6-G
//   (non-congested) or 6-A (congested / gaothan); basic FSI counts on the plot left after the DP road, premium and
//   TDR on the whole plot; ancillary FSI 60 % (residential) / 80 % (other) on top. Margins from Table 6-D: the front
//   by road width, the sides by road width up to a height, then H/5 (at most 12 m).
// - Mumbai: DCPR 2034 Table 12 (residential), island city or suburbs, with 35 % fungible FSI on top. Taken from
//   secondary summaries, and the margins are UDCPR's: check both before relying on them.
import type { CityDoc } from './doc';
import type { Compiler } from './compile';
import type { Near } from './issues';
import type { Id, PlotObj, SectionObj } from './types';
import { totalWidth } from './xsection';

/** What a plot (or a building on it) is for. Homes, offices and industry have their own rules; the rest go by the
 *  general ones for the road and the zone. `none`: not said yet (shape and massing checks only). */
export type PlotUse = 'residential' | 'commercial' | 'shops' | 'industrial' | 'garden' | 'carpark' | 'government' | 'school' | 'hospital' | 'worship' | 'custom' | 'none';
/** which development control regulations apply */
export type PlotCode = 'udcpr' | 'dcpr-island' | 'dcpr-suburbs';

export interface PlotRules {
  /** basic FSI, premium FSI (paid) and TDR that can be loaded, as multiples of the plot area */
  basic: number; premium: number; tdr: number;
  /** ancillary (UDCPR) or fungible (DCPR) FSI as a share of basic + premium + TDR */
  ancillary: number;
  /** front margin from the (DP) road boundary (m) */
  front: number;
  /** side / rear margin (m), up to `sideTo` m of height; above it H/5, at most 12 m */
  side: number; sideTo: number;
  /** floor-to-floor height and the most the building may rise (m) */
  floorH: number; maxH: number;
}

/** A road-width table: [at least this wide (m), basic, premium, TDR]. */
type FsiRow = [number, number, number, number];
const FSI: Record<PlotCode | 'udcpr-congested', FsiRow[]> = {
  // UDCPR Table 6-G, municipal corporations
  udcpr: [[30, 1.1, 0.5, 1.4], [24, 1.1, 0.5, 1.15], [15, 1.1, 0.5, 0.9], [12, 1.1, 0.5, 0.65], [9, 1.1, 0.5, 0.4], [0, 1.1, 0, 0]],
  // UDCPR Table 6-A, congested areas of municipal corporations
  'udcpr-congested': [[30, 2, 0.3, 0.7], [18, 2, 0.3, 0.5], [9, 2, 0.3, 0.3], [0, 1.5, 0, 0]],
  // DCPR 2034 Table 12, residential (totals 1.33 / 2.00 / 2.40 / 2.70 / 3.00)
  'dcpr-island': [[27, 1.33, 0.84, 0.83], [18, 1.33, 0.67, 0.7], [12, 1.33, 0.5, 0.57], [9, 1.33, 0.5, 0.17], [0, 1.33, 0, 0]],
  // (totals 1.00 / 2.00 / 2.20 / 2.40 / 2.50)
  'dcpr-suburbs': [[27, 1, 0.5, 1], [18, 1, 0.5, 0.9], [12, 1, 0.5, 0.7], [9, 1, 0.5, 0.5], [0, 1, 0, 0]],
};
/** UDCPR Table 6-D (A-class corporations): [at least this wide, front, side / rear, up to this height] */
const MARGINS: [number, number, number, number][] = [[30, 6, 3, 15], [18, 4.5, 2, 10], [0, 3, 1.5, 10]];

const row = <T extends number[]>(t: T[], w: number): T => t.find((r) => w >= r[0]) ?? t[t.length - 1];

export const CODE_LABEL: Record<PlotCode, string> = {
  udcpr: 'UDCPR 2020 · municipal corporation',
  'dcpr-island': 'DCPR 2034 · Mumbai island city',
  'dcpr-suburbs': 'DCPR 2034 · Mumbai suburbs',
};
export const CODE_NOTE: Record<PlotCode, string> = {
  udcpr: 'UDCPR 2020 Tables 6-G / 6-A and 6-D. Check them with your architect: authorities differ (amendments, TOD zones, special schemes).',
  'dcpr-island': 'DCPR 2034 Table 12 from published summaries; the margins are UDCPR’s as placeholders. Check both with your architect.',
  'dcpr-suburbs': 'DCPR 2034 Table 12 from published summaries; the margins are UDCPR’s as placeholders. Check both with your architect.',
};

export interface UseInfo {
  value: PlotUse; label: string;
  /** what its floors are counted in (null: nothing to count) */
  unit: string | null;
  /** sold or let: profit and IRR mean something */
  sells: boolean;
  /** no rules of its own here: the general FSI and margins for the road and the zone */
  generic: boolean;
  note: string;
}
const GENERIC = 'No rules of its own here: FSI and margins are the general ones for this road width and zone, parking a placeholder. Check them with your architect.';
export const USES: UseInfo[] = [
  { value: 'residential', label: 'Homes', unit: 'flats', sells: true, generic: false, note: 'Flats to a mix, parking by UDCPR Table 8-B.' },
  { value: 'commercial', label: 'Offices', unit: 'offices', sells: true, generic: false, note: 'Offices on 3.6 m floors; ancillary FSI 80 %, parking a car per 100 m² of carpet.' },
  { value: 'shops', label: 'Shops', unit: 'shops', sells: true, generic: true, note: `Shops on 4.2 m floors, a car per 100 m². ${GENERIC}` },
  { value: 'industrial', label: 'Industry', unit: 'shed floors', sells: true, generic: false, note: 'Sheds in an industrial zone: FSI 1.0 with no premium or TDR, margins at least 6 m in front and 4.5 m round, a car per 300 m² and a loading bay per 1,000 m². Placeholders: check the zone and the MIDC / UDCPR rules that apply.' },
  { value: 'garden', label: 'Garden', unit: null, sells: false, generic: true, note: `A public garden or park: open ground, a pavilion at most. ${GENERIC}` },
  { value: 'carpark', label: 'Car park', unit: null, sells: false, generic: true, note: `A public car park: decks of bays. ${GENERIC}` },
  { value: 'government', label: 'Government', unit: 'office floors', sells: false, generic: true, note: `A ward office or other public building, a car per 100 m². ${GENERIC}` },
  { value: 'school', label: 'School', unit: 'floors', sells: false, generic: true, note: `Classrooms on 3.6 m floors, a car per 200 m². ${GENERIC}` },
  { value: 'hospital', label: 'Hospital', unit: 'floors', sells: false, generic: true, note: `Wards on 4.2 m floors, a car per 100 m². ${GENERIC}` },
  { value: 'worship', label: 'Place of worship', unit: null, sells: false, generic: true, note: `A hall on tall floors, a car per 100 m². ${GENERIC}` },
  { value: 'custom', label: 'Your own', unit: 'floors', sells: true, generic: true, note: `Open floor plates, a car per 100 m². ${GENERIC}` },
  { value: 'none', label: 'No use yet', unit: null, sells: false, generic: true, note: 'No use yet: shape, building and massing checks only. Parking, units and money wait for a use.' },
];
export const useInfo = (u: PlotUse | undefined): UseInfo => USES.find((x) => x.value === u) ?? USES[USES.length - 1];
export const USE_NOTE = Object.fromEntries(USES.map((x) => [x.value, x.note])) as Record<PlotUse, string>;

/** Default rules for a plot on a road this wide. */
export function defaultRules(roadW: number, use: PlotUse, code: PlotCode = 'udcpr', congested = false): PlotRules {
  const [, basic, premium, tdr] = row(FSI[code === 'udcpr' && congested ? 'udcpr-congested' : code], roadW);
  const [, front, side, sideTo] = row(MARGINS, roadW);
  // industrial: FSI 1.0 on the plot, no premium or TDR, wider margins for trucks and fire; sheds a tall storey each
  if (use === 'industrial') return { basic: 1, premium: 0, tdr: 0, ancillary: 0, front: Math.max(front, 6), side: Math.max(side, 4.5), sideTo: 15, floorH: 7.5, maxH: 24 };
  // homes (and a plot with no use yet) take the residential ancillary share, everything else the 80 % of "other"
  const home = use === 'residential' || use === 'none' || use === 'garden';
  // offices a taller storey (shops, wards and halls taller still); no fixed height limit in either code: a
  // placeholder for fire and airport limits
  const floorH = home || use === 'carpark' ? 3 : use === 'shops' || use === 'hospital' ? 4.2 : use === 'worship' ? 6 : 3.6;
  return {
    basic, premium, tdr,
    ancillary: code === 'udcpr' ? (home ? 0.6 : 0.8) : 0.35,
    front, side, sideTo, floorH, maxH: code === 'udcpr' ? 70 : 120,
  };
}

/** Side / rear margin for a building this tall. */
export const sideMargin = (r: PlotRules, h: number) => (h <= r.sideTo ? r.side : Math.min(12, Math.max(r.side, h / 5)));

export interface PlotRoad {
  id: Id; name: string;
  /** width today and in the DP (m), with the plot's what-ifs; whether it has one */
  today: number; dp?: number; edited: boolean;
  /** the plot is entered from it */
  entry: boolean;
}

export interface PlotReport {
  code: PlotCode;
  area: number;
  /** the road it's entered from (its width sets the rules), and every road along it */
  road: PlotRoad | null; roads: PlotRoad[];
  /** the road runs over the plot (it was drawn across the carriageway) */
  onRoad: boolean;
  /** the road width the rules use */
  roadW: number;
  /** land inside the DP road line, and what's left */
  lost: number; net: number[]; netArea: number;
  /** the parts inside the DP road lines */
  lostRings: number[][];
  rules: PlotRules;
  fsi: number;
  /** built-up area by source: basic (on the net plot), premium and TDR (on the whole plot), the DP strip's FSI when
   *  it's handed over and counted, ancillary / fungible */
  parts: { basic: number; premium: number; tdr: number; credit: number; ancillary: number };
  /** permissible built-up area (with ancillary) */
  bua: number;
  /** side / rear margin used (it grows with the height) */
  side: number;
  /** buildable footprint inside the margins */
  footprint: number[]; footprintArea: number;
  floors: number; height: number;
  /** what stops it using all its built-up area: the height limit, or side margins (H/5) eating the footprint */
  limit: 'height' | 'margins' | null;
  /** built-up area that fits under the height limit */
  buildable: number;
  /** which edges of `net` face a road (front margin), and which road; the entry road's direction (unit x, z) */
  edges: boolean[]; edgeRoad: (Id | null)[]; axis: [number, number];
}

/** Analyse a plot against the map, under these regulations. */
export function analysePlot(doc: CityDoc, C: Compiler, near: Near, p: PlotObj, code: PlotCode = 'udcpr'): PlotReport {
  const ring = ccw(p.ring);
  const area = polyArea(ring);
  const [cx, cz] = centroid(ring);
  // the roads along the plot (the nearest when none is: a plot reached down a lane); the rules go by the entry road,
  // the widest unless one is picked
  const found = plotRoads(doc, C, near, p, ring);
  const widthOf = (x: FoundRoad) => ((p.basis ?? (x.dp ? 'dp' : 'today')) === 'dp' && x.dp ? x.dp : x.today);
  const road = found.find((x) => x.s.id === p.front) ?? [...found].sort((a, b) => widthOf(b) - widthOf(a))[0] ?? null;
  const today = road?.today ?? 0, dp = road?.dp;
  const roadW = road ? widthOf(road) : 0;
  const rules: PlotRules = { ...defaultRules(roadW, p.use, code, p.congested), ...p.rules };

  // each road's DP line: the reserve's edge, parallel to the road's nearest stretch
  let net = ring;
  const lostRings: number[][] = [];
  const lines = found.map((x) => {
    const { ax, az, dx, dz } = x.seg;
    const L = Math.hypot(dx, dz) || 1;
    let nx = -dz / L, nz = dx / L;
    if ((cx - ax) * nx + (cz - az) * nz < 0) { nx = -nx; nz = -nz; }
    // (a DP no wider than the road today takes nothing past its edge: no line, which on a bend would shave a sliver)
    if (x.dp && x.dp > 0 && x.dp > x.today + 0.05) {
      net = clipHalf(net, ax, az, nx, nz, x.dp / 2);
      const lr = clipHalf(ring, ax, az, -nx, -nz, -x.dp / 2);
      if (lr.length >= 6 && polyArea(lr) > 0.5) lostRings.push(lr);
    }
    return { ax, az, nx, nz, entry: x === road, id: x.s.id };
  });
  const frontLine = lines.find((l) => l.entry) ?? null;
  const netArea = net.length >= 6 ? polyArea(net) : 0;
  const lost = Math.max(0, area - netArea);

  const fsi = rules.basic + rules.premium + rules.tdr;
  const base = { basic: rules.basic * netArea, premium: rules.premium * area, tdr: rules.tdr * area, credit: p.credit ? rules.basic * lost : 0 };
  const consumed = base.basic + base.premium + base.tdr + base.credit;
  const parts = { ...base, ancillary: consumed * rules.ancillary };
  const bua = consumed + parts.ancillary;

  // margins: front edges (facing the road) by the front margin, the others by the side margin, which depends on the
  // height, which depends on the footprint: a few rounds settle it
  // (every road side is a front: the edges facing a road, nearest it)
  const front: boolean[] = [], edgeRoad: (Id | null)[] = [];
  if (net.length >= 6) {
    const n = net.length / 2;
    for (let k = 0; k < n; k++) { front.push(false); edgeRoad.push(null); }
    for (const l of lines) {
      let nearest = Infinity;
      const dist: number[] = [];
      for (let i = 0; i < net.length; i += 2) {
        const j = (i + 2) % net.length;
        const mx = (net[i] + net[j]) / 2, mz = (net[i + 1] + net[j + 1]) / 2;
        const d = (mx - l.ax) * l.nx + (mz - l.az) * l.nz;
        dist.push(d); nearest = Math.min(nearest, d);
      }
      for (let i = 0, k = 0; i < net.length; i += 2, k++) {
        const j = (i + 2) % net.length;
        const ex = net[j] - net[i], ez = net[j + 1] - net[i + 1], L = Math.hypot(ex, ez) || 1;
        if (Math.abs((ex / L) * l.nz - (ez / L) * l.nx) > 0.85 && dist[k] < nearest + 2) { front[k] = true; edgeRoad[k] ??= l.id; }
      }
    }
  }
  // taller needs wider side margins (H/5), so a smaller footprint: try every height and keep the lowest one that
  // builds the most
  const maxFloors = Math.max(0, Math.floor(rules.maxH / rules.floorH + 1e-6));
  let floors = 0, side = rules.side, footprint: number[] = [], footprintArea = 0, buildable = 0;
  const cache = new Map<number, { ring: number[]; area: number }>();
  for (let n = 1; n <= maxFloors && net.length >= 6; n++) {
    const sd = Math.round(sideMargin(rules, n * rules.floorH) * 100) / 100;
    let fp = cache.get(sd);
    if (!fp) { const ring = inset(net, front, rules.front, sd); fp = { ring, area: ring.length >= 6 ? polyArea(ring) : 0 }; cache.set(sd, fp); }
    if (fp.area < 1) break;
    const b = Math.min(bua, n * fp.area);
    if (b > buildable + 0.5) { buildable = b; floors = n; side = sd; footprint = fp.ring; footprintArea = fp.area; }
    if (b >= bua) break;
  }
  if (!floors) { footprint = inset(net, front, rules.front, rules.side); footprintArea = footprint.length >= 6 ? polyArea(footprint) : 0; }
  // what stops it using all its built-up area: the height limit, or margins that grow faster than the floors add
  const short = bua - buildable > 1;
  const limit: PlotReport['limit'] = !short ? null : floors === maxFloors ? 'height' : 'margins';
  return {
    code, area, onRoad: !!road && road.d < -0.5, roadW,
    road: road ? info(road, true) : null, roads: found.map((x) => info(x, x === road)),
    lost, net, netArea, lostRings, rules, fsi, parts, bua, side, footprint, footprintArea, floors, height: floors * rules.floorH,
    limit, buildable, edges: front, edgeRoad, axis: frontAxis(net, edgeRoad, road?.s.id) ?? (frontLine ? [frontLine.nz, -frontLine.nx] : longest(net)),
  };
}

/** A ring with each edge moved in: front edges by `f`, the others by `s`. */
export function inset(net: number[], front: boolean[], f: number, s: number): number[] {
  let out = net;
  for (let i = 0, k = 0; i < net.length && out.length >= 6; i += 2, k++) {
    const j = (i + 2) % net.length;
    const ex = net[j] - net[i], ez = net[j + 1] - net[i + 1], L = Math.hypot(ex, ez);
    if (L < 0.01) continue;
    // inward normal of a counter-clockwise ring (see ccw)
    out = clipHalf(out, net[i], net[i + 1], -ez / L, ex / L, front[k] ? f : s);
  }
  return out;
}

/** The direction of the plot's longest side on the entry road (the road itself may curve away from it), along the
 *  ring's winding. */
function frontAxis(net: number[], edgeRoad: (Id | null)[], id: Id | undefined): [number, number] | null {
  let best: [number, number] | null = null, bl = 0;
  for (let i = 0, k = 0; i < net.length; i += 2, k++) {
    if (!id || edgeRoad[k] !== id) continue;
    const j = (i + 2) % net.length, ex = net[j] - net[i], ez = net[j + 1] - net[i + 1], L = Math.hypot(ex, ez);
    if (L > bl) { bl = L; best = [ex / L, ez / L]; }
  }
  return best;
}

/** The direction of a ring's longest edge. */
function longest(r: number[]): [number, number] {
  let best: [number, number] = [1, 0], bl = 0;
  for (let i = 0; i < r.length; i += 2) {
    const j = (i + 2) % r.length, ex = r[j] - r[i], ez = r[j + 1] - r[i + 1], L = Math.hypot(ex, ez);
    if (L > bl) { bl = L; best = [ex / L, ez / L]; }
  }
  return best;
}

interface FoundRoad {
  s: SectionObj;
  /** how far the plot is from the road's edge (negative: over it), and the road's nearest stretch */
  d: number; seg: { ax: number; az: number; dx: number; dz: number };
  /** width today and in the DP, with the plot's what-ifs */
  today: number; dp?: number; edited: boolean;
}
const info = (x: FoundRoad, entry: boolean): PlotRoad => ({ id: x.s.id, name: x.s.name || 'Unnamed road', today: x.today, dp: x.dp, edited: x.edited, entry });

/** The roads a plot lies along: a section running beside one of its edges, near enough to reach (its DP reserve
 *  counts). None: the nearest road, the one a lane leads from. A road the plot names always counts. */
function plotRoads(doc: CityDoc, C: Compiler, near: Near, p: PlotObj, ring: number[]): FoundRoad[] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]); }
  const cand = new Set(near(x0 - 60, z0 - 60, x1 + 60, z1 + 60));
  if (p.front) cand.add(p.front);
  const out: FoundRoad[] = [];
  let nearest: FoundRoad | null = null;
  for (const id of cand) {
    const s = doc.get(id);
    if (s?.kind !== 'section' || s.elevated || s.tunnel || s.cls === 'busway') continue;
    const g = C.geo(id);
    if (!g) continue;
    const e = p.roadEdits?.[id];
    const today = e?.width ?? totalWidth(s.parts), dp = e?.reserve ?? s.reserve, hw = today / 2;
    // beside an edge: running the same way (within 25°), the edge's middle alongside it, within reach
    const reach = Math.max(0, (dp ?? 0) / 2 - hw) + 4;
    // (a corner past the road's end, on a junction's rounded kerb, isn't beside it: measured only when none is)
    let best: FoundRoad | null = null, past: FoundRoad | null = null, along = false;
    for (let k = 0; k + 3 < g.pts.length; k += 2) {
      const ax = g.pts[k], az = g.pts[k + 1], dx = g.pts[k + 2] - ax, dz = g.pts[k + 3] - az, Ls = Math.hypot(dx, dz);
      if (Ls < 0.01) continue;
      for (let i = 0; i < ring.length; i += 2) {
        const d = segDist(ring[i], ring[i + 1], ax, az, dx, dz) - hw;
        const u = ((ring[i] - ax) * dx + (ring[i + 1] - az) * dz) / (Ls * Ls);
        const beyond = (k === 0 && u < 0) || (k + 4 >= g.pts.length && u > 1);
        if (beyond) { if (!past || d < past.d) past = { s, d, seg: { ax, az, dx, dz }, today, dp, edited: !!e }; }
        else if (!best || d < best.d) best = { s, d, seg: { ax, az, dx, dz }, today, dp, edited: !!e };
        const j = (i + 2) % ring.length, ex = ring[j] - ring[i], ez = ring[j + 1] - ring[i + 1], Le = Math.hypot(ex, ez);
        if (Le < 2 || Math.abs(ex * dz - ez * dx) / (Le * Ls) > 0.42) continue;
        const mx = (ring[i] + ring[j]) / 2, mz = (ring[i + 1] + ring[j + 1]) / 2;
        const t = ((mx - ax) * dx + (mz - az) * dz) / (Ls * Ls);
        if (t > -0.15 && t < 1.15 && segDist(mx, mz, ax, az, dx, dz) - hw < reach) along = true;
      }
    }
    best ??= past;
    if (!best) continue;
    if (along || id === p.front) out.push(best);
    if (!nearest || best.d < nearest.d) nearest = best;
  }
  if (!out.length && nearest) out.push(nearest);
  return out.sort((a, b) => a.d - b.d);
}


// ---------------- polygon helpers (flat x,z rings) ----------------

export function polyArea(r: number[]): number { return Math.abs(signedArea(r)); }

function signedArea(r: number[]) {
  let a = 0;
  for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; a += r[i] * r[j + 1] - r[j] * r[i + 1]; }
  return a / 2;
}

/** The ring wound so that (-ez, ex) along each edge points inside. */
function ccw(r: number[]): number[] {
  if (signedArea(r) >= 0) return r;
  const out: number[] = [];
  for (let i = r.length - 2; i >= 0; i -= 2) out.push(r[i], r[i + 1]);
  return out;
}

export function centroid(r: number[]): [number, number] {
  let x = 0, z = 0;
  for (let i = 0; i < r.length; i += 2) { x += r[i]; z += r[i + 1]; }
  const n = r.length / 2 || 1;
  return [x / n, z / n];
}

/** Keep the part of a polygon where (p − a)·n ≥ off (Sutherland–Hodgman against one line). */
export function clipHalf(r: number[], ax: number, az: number, nx: number, nz: number, off: number): number[] {
  const out: number[] = [];
  const f = (i: number) => (r[i] - ax) * nx + (r[i + 1] - az) * nz - off;
  for (let i = 0; i < r.length; i += 2) {
    const j = (i + 2) % r.length;
    const fi = f(i), fj = f(j);
    if (fi >= 0) out.push(r[i], r[i + 1]);
    if ((fi >= 0) !== (fj >= 0)) {
      const t = fi / (fi - fj);
      out.push(r[i] + (r[j] - r[i]) * t, r[i + 1] + (r[j + 1] - r[i + 1]) * t);
    }
  }
  return out;
}

function segDist(px: number, pz: number, ax: number, az: number, dx: number, dz: number) {
  const L2 = dx * dx + dz * dz;
  const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / L2)) : 0;
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}
