// The most a plot can build: Site Studio's "Fill for me". A plot opens empty (its margin envelope only); filling lays
// the most built-up area round whatever was placed by hand, and plans again as its settings change until a building
// is shaped by hand. On a plot too small for rows of blocks it fills the envelope with one building.
//
// Inside the margins for each height (front margins on the road sides, H/5 sides), kept 6 m off the plot's other
// sides once the buildings top 15 m (the fire tender's way, which the internal drive runs along), with the
// recreational open space kept at the back on plots that need it. That zone is filled with slabs (mid-rise blocks,
// double-loaded, 14–22 m deep) or towers, side by side with the gap between buildings their height needs, at every
// floor count. The layout that builds the most of the permissible built-up area wins; on a tie, the city's usual
// type (slabs under UDCPR, towers in Mumbai), then fewer buildings, then fewer floors. Then the parking: stilts and
// as many basements as it needs, surface bays when they save one.
//
// Pure: a plot report and the site's settings in, a site out.
import { clipHalf, inset, polyArea, sideMargin, type PlotReport, type PlotUse } from './plot';
import { basementsToFit, buildingQuads, DEFAULT_SITE, elementRings, FIRE_H, FIRE_W, GATES_FROM, RG_FROM, RG_SHARE, roadFrame, spanU, type PlotSite, type SiteBuilding, type SiteElement } from './site';

export type Typology = 'auto' | 'slab' | 'tower';
export const TYPOLOGIES: { value: Typology; label: string; title: string }[] = [
  { value: 'auto', label: 'Most built-up', title: 'Whichever builds the most (slabs first in Pune, towers in Mumbai)' },
  { value: 'slab', label: 'Slabs', title: 'Mid-rise blocks, flats both sides of a corridor' },
  { value: 'tower', label: 'Towers', title: 'Compact point blocks, as tall as the rules allow' },
];

/** what the optimiser is asked for (kept on the site); targets for "Fill for me", never caps on what's placed by hand */
export interface Design {
  type: Typology;
  /** at most this many floors of flats, and buildings (0: any, as the rules allow) */
  maxFloors: number; maxBuildings: number;
  /** metres more between buildings than the rules ask */
  spacing?: number;
  /** how the site is reached: a drive round the edge, a road up the middle, a grid of roads, or none of its own */
  access?: Access;
  /** a roundabout at the road's end and where roads cross */
  roundabouts?: boolean;
  /** % of the plot kept green (at least; the open space the rules ask is kept anyway) */
  green?: number;
}
export const DEFAULT_DESIGN: Design = { type: 'auto', maxFloors: 0, maxBuildings: 0 };
export type Access = 'perimeter' | 'spine' | 'grid' | 'none';
export const ACCESS: { value: Access; label: string; title: string }[] = [
  { value: 'perimeter', label: 'Perimeter', title: 'A drive round the back of the plot (the fire tender’s way)' },
  { value: 'spine', label: 'Spine', title: 'An internal road up the middle from the entrance, buildings either side' },
  { value: 'grid', label: 'Grid', title: 'Internal roads up and across the plot, in blocks' },
  { value: 'none', label: 'None', title: 'No internal roads: the buildings are reached from the road' },
];
/** internal road width (two lanes), the buildings' setback from it, a roundabout's radius at a road's end / a crossing */
const ROAD_W = 7, ROAD_SET = 3, END_R = 9, CROSS_R = 7;
/** roads across the plot about this far apart */
const BLOCK: Record<'residential' | 'commercial' | 'industrial', number> = { residential: 75, commercial: 90, industrial: 120 };

/** the packing's shapes for a use (homes, offices and sheds have their own; the rest are laid out like offices, a
 *  garden or car park like homes, being low) */
const shapeUse = (u: PlotUse): 'residential' | 'commercial' | 'industrial' => (u === 'industrial' ? 'industrial' : u === 'residential' || u === 'none' || u === 'garden' || u === 'carpark' ? 'residential' : 'commercial');

/** Plate sizes by use. Flats: slabs 10–22 m deep (shallow single-loaded ones for small plots, double-loaded from
 *  14 m), towers about 500–860 m². Offices: deeper plates and larger towers. Industry: sheds as deep as the work
 *  needs (24–60 m, or the whole zone), no towers. A slab longer than `max` is split (a block, not a wall). */
const SHAPES: Record<'residential' | 'commercial' | 'industrial', { depths: number[]; fillTo: number; towers: [number, number][]; max: number; min: number }> = {
  residential: { depths: [10, 12, 14, 16, 18, 20, 22], fillTo: 24, towers: [[24, 20], [30, 22], [36, 24]], max: 72, min: 12 },
  commercial: { depths: [16, 18, 20, 22, 24], fillTo: 28, towers: [[30, 24], [36, 30], [42, 30]], max: 80, min: 16 },
  industrial: { depths: [24, 30, 36, 45, 60], fillTo: 80, towers: [], max: 120, min: 15 },
};
/** single-loaded (shallow) slabs only this high; and no building taller than this many times its narrowest side */
const SHALLOW_H = 15, SLENDER = 6;

/** The gap between two buildings on the plot: the taller one's side margin, and room for the fire tender's way. */
export const buildingGap = (r: PlotReport, h: number) => Math.max(sideMargin(r.rules, h), h > FIRE_H ? FIRE_W : 3);

export interface Scheme {
  type: 'slab' | 'tower';
  buildings: SiteBuilding[];
  rg: number[] | null;
  /** the internal roads and roundabouts it laid */
  roads: SiteElement[];
  /** floors of flats in each building (same order), built-up area, the most floors */
  bua: number; floors: number;
}

/** The best layouts on a plot: the overall best first, then the best of the other type. */
export function schemes(r: PlotReport, design: Design, use: PlotUse, under = 1, site?: PlotSite): Scheme[] {
  // (pure, and slow: kept for the same plot, settings and fixed elements, so reshaping the buildings by hand doesn't
  // plan the whole site again on every move)
  const fixedEls = (site?.elements ?? []).filter((e) => !e.auto && (e.kind === 'parking' || e.kind === 'road' || e.kind === 'roundabout' || e.kind === 'tank')).map((e) => [e.kind, e.spine, e.ring, e.depth]);
  const fixedB = handPlaced(site).map((b) => [b.spine, b.depth, b.closed, b.floors]);
  const key = JSON.stringify([r.net, r.edges, r.bua, r.area, r.rules, r.code, r.parts, design, use, under, fixedEls, fixedB]);
  const hit = SCHEMES.get(key);
  if (hit) return hit;
  const out = schemesOf(r, design, use, under, site);
  SCHEMES.set(key, out);
  if (SCHEMES.size > 24) SCHEMES.delete(SCHEMES.keys().next().value!);
  return out;
}
const SCHEMES = new Map<string, Scheme[]>();

/** The buildings placed by hand that "Fill for me" builds round (none on an older optimised site). */
const handPlaced = (site?: PlotSite) => (site?.fill ? site.buildings.filter((b) => !b.auto && b.spine.length >= 4) : []);

function schemesOf(r0: PlotReport, design: Design, use: PlotUse, under: number, site?: PlotSite): Scheme[] {
  const fh = r0.rules.floorH, S = SHAPES[shapeUse(use)];
  // what the buildings placed by hand already build comes off what's left to fill (their floors as they stand)
  const hand = handPlaced(site);
  const handBua = hand.reduce((a, b) => a + buildingQuads(b).reduce((s, q) => s + polyArea(q), 0) * Math.max(1, b.floors), 0);
  const r: PlotReport = hand.length ? { ...r0, bua: Math.max(0, r0.bua - handBua) } : r0;
  const R = r.rules;
  if (r.net.length < 6 || r.bua <= 0) return [];
  const F = roadFrame(r);
  let maxN = Math.max(0, Math.floor(R.maxH / fh + 1e-6) - under);
  if (design.maxFloors > 0) maxN = Math.min(maxN, design.maxFloors);
  const rgNeed = Math.max(use === 'residential' && r.area >= RG_FROM ? r.area * RG_SHARE : 0, (r.area * (design.green ?? 0)) / 100);
  const NL = F.toL(r.net);
  // what's placed by hand and stays put: parking buildings, roads, roundabouts (lots and gardens give way)
  const fixed = [
    ...(site?.elements ?? []).filter((e) => !e.auto && (e.kind === 'parking' || e.kind === 'road' || e.kind === 'roundabout' || e.kind === 'tank'))
      .flatMap(elementRings).map((q) => box(F.toL(q), ROAD_SET)),
    // (the buildings placed by hand, with a fire tender's way round them)
    ...hand.flatMap(buildingQuads).map((q) => box(F.toL(q), FIRE_W)),
  ];
  const prefer: 'slab' | 'tower' = use !== 'industrial' && (design.type === 'tower' || (design.type === 'auto' && r.code !== 'udcpr')) ? 'tower' : 'slab';
  const best: Record<'slab' | 'tower', (Scheme & { score: number }) | null> = { slab: null, tower: null };

  for (let n = 1; n <= maxN; n++) {
    const h = (n + under) * fh;
    const side = Math.max(sideMargin(R, h), h > FIRE_H ? FIRE_W : 0);
    const zoneW = inset(r.net, r.edges, R.front, side);
    if (zoneW.length < 6 || polyArea(zoneW) < 50) break;
    let Z = F.toL(zoneW);
    // the open space at the back: as deep a strip of the zone as it needs
    let rg: number[] | null = null;
    if (rgNeed > 0) {
      const cut = rgCut(Z, rgNeed);
      if (cut !== null) { rg = clipHalf(Z, 0, cut, 0, 1, 0); Z = clipHalf(Z, 0, cut, 0, -1, 0); }
      if (Z.length < 6) continue;
    }
    const gap = buildingGap(r, h) + (design.spacing ?? 0);
    const acc = accessRoads(r, Z, NL, design, use, site?.gateRoads, F);
    const keep = [...fixed, ...acc.keep];
    for (const turn of [false, true]) {
      // across: lay rows along the road (u) or into the plot (v, by swapping the axes)
      const P = turn ? swap(Z) : Z, K = turn ? keep.map(swap) : keep;
      const rows = (P: number[], D: number, gap: number, run: (lo: number, hi: number) => [number, number][]) => rowsIn(P, D, gap, run, K);
      const tries: { type: 'slab' | 'tower'; rects: [number, number, number, number][] }[] = [];
      if (design.type !== 'tower' || !S.towers.length) {
        // the usual depths, and a block as deep as the zone where that's a sensible depth (a small plot, filled)
        let V0 = Infinity, V1 = -Infinity;
        for (let i = 1; i < P.length; i += 2) { V0 = Math.min(V0, P[i]); V1 = Math.max(V1, P[i]); }
        const fill = Math.floor((V1 - V0 - 0.05) * 2) / 2;
        const depths = fill >= 8 && fill <= S.fillTo && !S.depths.includes(fill) ? [...S.depths, fill] : [...S.depths];
        if (use === 'industrial') {
          // a shed just deep enough to take the whole built-up area on these floors (the row's full width)
          let U0 = Infinity, U1 = -Infinity;
          for (let i = 0; i < P.length; i += 2) { U0 = Math.min(U0, P[i]); U1 = Math.max(U1, P[i]); }
          const need = Math.floor((r.bua / (n * (U1 - U0))) * 2) / 2;
          if (need >= S.min && need <= Math.min(S.fillTo, fill)) depths.push(need);
        }
        for (const D of depths.filter((x) => x >= 14 || h <= SHALLOW_H)) tries.push({ type: 'slab', rects: rows(P, D, gap, (lo, hi) => slabRun(lo, hi, gap, S.max, S.min)) });
      }
      if (design.type !== 'slab') for (const [L, D] of S.towers) tries.push({ type: 'tower', rects: rows(P, D, gap, (lo, hi) => towerRun(lo, hi, L, gap)) });
      for (const t of tries) {
        // (slender ones dropped: no taller than six times their narrowest side)
        let rects = t.rects.filter((q) => h <= SLENDER * Math.min(q[2] - q[0], q[3] - q[1]));
        if (!rects.length) continue;
        if (design.maxBuildings > 0 && rects.length > design.maxBuildings) rects = [...rects].sort((a, b) => area(b) - area(a)).slice(0, design.maxBuildings);
        const plates = rects.map(area);
        const fl = shareFloors(plates, n, r.bua);
        const bua = plates.reduce((s, p, i) => s + p * fl[i], 0);
        const floors = Math.max(...fl);
        if (!bua) continue;
        // most built-up; then the city's type, fewer buildings (towers: as few and as tall as can be), fewer floors
        // (sheds: the least ground covered, for the yard, the trucks and the parking)
        const score = bua - (t.type === prefer ? 0 : r.bua * 0.03) - rects.length * (t.type === 'tower' ? r.bua * 0.01 : 0.5) - floors * 0.1
          - (use === 'industrial' ? plates.reduce((a, p, i) => a + (fl[i] ? p : 0), 0) * 0.1 : 0);
        const cur = best[t.type];
        if (cur && cur.score >= score) continue;
        const buildings: SiteBuilding[] = rects.map(([u0, v0, u1, v1], i) => {
          const vm = (v0 + v1) / 2, a = turn ? [vm, u0] : [u0, vm], b = turn ? [vm, u1] : [u1, vm];
          return { id: `b${i}`, spine: [...F.toW(a[0], a[1]), ...F.toW(b[0], b[1])].map((x) => Math.round(x * 100) / 100), depth: v1 - v0, floors: fl[i], auto: true };
        }).filter((_, i) => fl[i] > 0);
        best[t.type] = { type: t.type, buildings, rg: rg ? rg.flatMap((_, i) => (i % 2 ? [] : F.toW(rg![i], rg![i + 1]))) : null, roads: acc.roads, bua, floors, score };
      }
    }
  }
  const out = [best.slab, best.tower].filter((x): x is Scheme & { score: number } => !!x).sort((a, b) => b.score - a.score);
  if (!out.length && !hand.length) {
    // too small for rows of blocks: one building filling the envelope
    const one = fillEnvelope(r, use, under, design.maxFloors);
    return one ? [one] : [];
  }
  return out.map(({ score: _, ...s }) => s);
}

/** One building filling the envelope (the biggest rectangle square to the road inside it), as many floors as the
 *  built-up area, the height limit and the margins at that height allow. A plot whose margins leave nothing gets
 *  one on the plot as it is, flagged. */
export function fillEnvelope(r: PlotReport, use: PlotUse, under: number, maxFloors = 0): Scheme | null {
  const R = r.rules, fh = R.floorH, F = roadFrame(r);
  if (r.net.length < 6) return null;
  let maxN = Math.max(1, Math.floor(R.maxH / fh + 1e-6) - under);
  if (maxFloors > 0) maxN = Math.min(maxN, maxFloors);
  let best: { rect: [number, number, number, number]; n: number; bua: number } | null = null;
  const cache = new Map<number, [number, number, number, number] | null>();
  for (let n = 1; n <= maxN; n++) {
    const sd = Math.round(sideMargin(R, (n + under) * fh) * 100) / 100;
    if (!cache.has(sd)) { const e = inset(r.net, r.edges, R.front, sd); cache.set(sd, e.length >= 6 ? bigRect(F.toL(e)) : null); }
    const rect = cache.get(sd);
    if (!rect) break;
    const plate = area(rect), b = Math.min(r.bua > 0 ? r.bua : plate * n, plate * n);
    if (!best || b > best.bua + 0.5) best = { rect, n, bua: b };
    if (plate * n >= r.bua) break;
  }
  // nothing inside the margins: the plot itself (less a metre round), one floor
  if (!best) { const rect = bigRect(F.toL(inset(r.net, r.edges.map(() => false), 0, 1))); if (!rect) return null; best = { rect, n: 1, bua: area(rect) }; }
  const [u0, v0, u1, v1] = best.rect, plate = area(best.rect);
  const floors = r.bua > 0 ? Math.max(1, Math.min(best.n, Math.floor(r.bua / plate + 1e-6))) : 1;
  // the spine along the longer side
  const along = u1 - u0 >= v1 - v0;
  const a = along ? [u0, (v0 + v1) / 2] : [(u0 + u1) / 2, v0], b = along ? [u1, (v0 + v1) / 2] : [(u0 + u1) / 2, v1];
  const b0: SiteBuilding = { id: 'b0', spine: [...F.toW(a[0], a[1]), ...F.toW(b[0], b[1])].map((x) => Math.round(x * 100) / 100), depth: Math.round((along ? v1 - v0 : u1 - u0) * 100) / 100, floors, auto: true };
  return { type: use === 'industrial' || floors * fh <= 24 ? 'slab' : 'tower', buildings: [b0], rg: null, roads: [], bua: plate * floors, floors };
}

/** The biggest rectangle square to the axes inside a convex ring (local u, v), on a 24-step grid of its depth. */
function bigRect(P: number[]): [number, number, number, number] | null {
  if (P.length < 6) return null;
  let V0 = Infinity, V1 = -Infinity;
  for (let i = 1; i < P.length; i += 2) { V0 = Math.min(V0, P[i]); V1 = Math.max(V1, P[i]); }
  const N = 24, step = (V1 - V0) / N;
  let best: [number, number, number, number] | null = null, ba = 0;
  for (let i = 0; i < N; i++) for (let j = i + 1; j <= N; j++) {
    const v0 = V0 + i * step, v1 = V0 + j * step, s = spanU(P, v0, v1);
    if (!s) continue;
    const a = (s[1] - s[0]) * (v1 - v0);
    if (a > ba) { ba = a; best = [s[0], v0, s[1], v1]; }
  }
  return best && ba > 0.5 ? best.map((x) => Math.round(x * 100) / 100) as [number, number, number, number] : null;
}

/** The site on a plot: none yet, an empty one (the plot and its envelope); as shaped by hand; else filled for its
 *  settings. */
export function siteFor(site: PlotSite | undefined, r: PlotReport, use: PlotUse): PlotSite {
  if (!site) return emptySite(use);
  return site.manual ? site : optimise(r, site, use);
}

/** A plot as it opens the first time: nothing on it, parking as its use usually has it, no basements yet. */
export function emptySite(use: PlotUse): PlotSite {
  return { ...siteDefaults(use), basements: 0, manual: true };
}

/** A new site's settings by use: flats over a parking stilt; offices and sheds on the ground, sheds parked in the yard. */
export function siteDefaults(use: PlotUse): PlotSite {
  if (use === 'residential' || use === 'none') return { ...DEFAULT_SITE, buildings: [] };
  return { ...DEFAULT_SITE, buildings: [], stilt: false, ...(use === 'industrial' ? { surfacePick: true, basements: 0 } : {}) };
}

/** The optimised site for these settings: the best scheme, parked. */
export function optimise(r: PlotReport, base: PlotSite, use: PlotUse): PlotSite {
  const s = schemes(r, base.design ?? DEFAULT_DESIGN, use, (base.stilt ? 1 : 0) + base.podium, base)[0];
  const elements = [...(base.elements ?? []).filter((e) => !e.auto), ...(s?.roads ?? [])];
  // (the filled buildings take ids of their own, clear of the hand-placed ones)
  const filled = (s?.buildings ?? []).map((b, i) => ({ ...b, id: `a${i}`, auto: true }));
  return park(r, { ...base, buildings: [...handPlaced(base), ...filled], rg: s?.rg ?? undefined, elements: elements.length ? elements : undefined }, use);
}

/** "Fill for me": the most built-up area round what's placed, the hand-placed buildings kept at their floors. */
export function fillSite(r: PlotReport, site: PlotSite, use: PlotUse, floorsNow: Record<string, number> = {}): PlotSite {
  const buildings = site.buildings.filter((b) => !b.auto).map((b) => ({ ...b, floors: b.floors || floorsNow[b.id] || 1 }));
  return { ...site, buildings, elements: site.elements?.filter((e) => !e.auto), fill: true, manual: undefined };
}

/** As many basements as the parking needs; surface bays as picked, or (left to it) when they save a basement. */
export function park(r: PlotReport, site: PlotSite, use: PlotUse): PlotSite {
  const a: PlotSite = { ...site, surface: site.surfacePick ?? false };
  a.basements = basementsToFit(r, a, use);
  if (site.surfacePick !== undefined) return a;
  const b: PlotSite = { ...a, surface: true };
  b.basements = basementsToFit(r, b, use);
  return b.basements < a.basements ? b : a;
}

// ---------------- packing ----------------

const area = (q: [number, number, number, number]) => (q[2] - q[0]) * (q[3] - q[1]);
const swap = (P: number[]) => { const Q: number[] = []; for (let i = 0; i < P.length; i += 2) Q.push(P[i + 1], P[i]); return Q; };

/** Rows of buildings `D` deep across a convex zone, `gap` apart, from the road side back, kept off the `keep`
 *  areas (roads, car parks): [u0, v0, u1, v1] each. */
function rowsIn(P: number[], D: number, gap: number, run: (lo: number, hi: number) => [number, number][], keep: number[][]) {
  let V0 = Infinity, V1 = -Infinity;
  for (let i = 1; i < P.length; i += 2) { V0 = Math.min(V0, P[i]); V1 = Math.max(V1, P[i]); }
  const out: [number, number, number, number][] = [];
  // as many rows as fit, spread to use the depth evenly
  const k = Math.floor((V1 - V0 + gap) / (D + gap) + 1e-6);
  if (k < 1) return out;
  const spare = V1 - V0 - (k * D + (k - 1) * gap);
  for (let i = 0; i < k; i++) {
    const v = V0 + i * (D + gap) + (k > 1 ? (spare * i) / (k - 1) : spare / 2);
    const s = spanU(P, v, v + D);
    if (!s) continue;
    for (const [a, b] of free(s[0], s[1], v, v + D, keep)) for (const [u0, u1] of run(a, b)) out.push([u0, v, u1, v + D]);
  }
  return out;
}

/** One slab the length of the row, or two (or more) when it's too long for one block. */
function slabRun(lo: number, hi: number, gap: number, max: number, min: number): [number, number][] {
  const L = hi - lo;
  if (L < min) return [];
  const k = Math.ceil((L + gap) / (max + gap));
  const each = (L - (k - 1) * gap) / k;
  return Array.from({ length: k }, (_, i) => [lo + i * (each + gap), lo + i * (each + gap) + each] as [number, number]);
}

/** As many towers `L` long as fit along the row, centred. */
function towerRun(lo: number, hi: number, L: number, gap: number): [number, number][] {
  const k = Math.floor((hi - lo + gap) / (L + gap) + 1e-6);
  if (k < 1) return [];
  const start = lo + (hi - lo - (k * L + (k - 1) * gap)) / 2;
  return Array.from({ length: k }, (_, i) => [start + i * (L + gap), start + i * (L + gap) + L] as [number, number]);
}

/** Floors for each plate, at most `n`: a floor at a time to the lowest, within the built-up area. */
function shareFloors(plates: number[], n: number, bua: number): number[] {
  const fl = plates.map(() => 0);
  let used = 0;
  for (;;) {
    let pick = -1;
    for (let i = 0; i < plates.length; i++) if (fl[i] < n && used + plates[i] <= bua + 0.5 && (pick < 0 || fl[i] < fl[pick] || (fl[i] === fl[pick] && plates[i] > plates[pick]))) pick = i;
    if (pick < 0) break;
    fl[pick]++;
    used += plates[pick];
  }
  return fl;
}

/** The v from which the back of a convex zone holds this much area (null: the whole zone doesn't). */
function rgCut(P: number[], need: number): number | null {
  let V0 = Infinity, V1 = -Infinity;
  for (let i = 1; i < P.length; i += 2) { V0 = Math.min(V0, P[i]); V1 = Math.max(V1, P[i]); }
  if (polyArea(P) < need * 1.5) return null;
  let lo = V0, hi = V1;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2, a = polyArea(clipHalf(P, 0, mid, 0, 1, 0));
    if (a >= need) lo = mid; else hi = mid;
  }
  // at least 7.5 m deep, the open space's least width
  return Math.min(lo, V1 - 7.5);
}

/** What of [lo, hi] along a row (v0..v1 deep) the keep areas leave. */
function free(lo: number, hi: number, v0: number, v1: number, keep: number[][]): [number, number][] {
  const cut: [number, number][] = [];
  for (const K of keep) {
    let Q = clipHalf(K, 0, v0, 0, 1, 0);
    if (Q.length >= 6) Q = clipHalf(Q, 0, v1, 0, -1, 0);
    if (Q.length < 6) continue;
    let a = Infinity, b = -Infinity;
    for (let i = 0; i < Q.length; i += 2) { a = Math.min(a, Q[i]); b = Math.max(b, Q[i]); }
    if (b - a > 0.01) cut.push([a, b]);
  }
  cut.sort((x, y) => x[0] - y[0]);
  const out: [number, number][] = [];
  let s = lo;
  for (const [a, b] of cut) { if (a > s) out.push([s, Math.min(a, hi)]); s = Math.max(s, b); if (s >= hi) break; }
  if (hi > s) out.push([s, hi]);
  return out.filter(([a, b]) => b - a > 0.5);
}

/** A local ring's bounding box grown by k, as a ring. */
function box(P: number[], k: number): number[] {
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity;
  for (let i = 0; i < P.length; i += 2) { u0 = Math.min(u0, P[i]); u1 = Math.max(u1, P[i]); v0 = Math.min(v0, P[i + 1]); v1 = Math.max(v1, P[i + 1]); }
  return [u0 - k, v0 - k, u1 + k, v0 - k, u1 + k, v1 + k, u0 - k, v1 + k];
}

/** A strip `w` wide round the segment a→b (local), its ends grown as much as its sides, as a ring. */
function stripL(a: number[], b: number[], w: number): number[] {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, h = w / 2;
  const tx = ((b[0] - a[0]) / L) * h, tz = ((b[1] - a[1]) / L) * h, nx = -tz, nz = tx;
  return [a[0] + nx - tx, a[1] + nz - tz, b[0] + nx + tx, b[1] + nz + tz, b[0] - nx + tx, b[1] - nz + tz, a[0] - nx - tx, a[1] - nz - tz];
}

/** The internal roads for the access asked (local to the road frame): spines up from the entrance, roads across
 *  in blocks, roundabouts at their ends and crossings, and a road in from every other road with a gate. The areas
 *  the buildings keep off come back with them. */
function accessRoads(r: PlotReport, Z: number[], NL: number[], design: Design, use: PlotUse, gateRoads: string[] | undefined, F: ReturnType<typeof roadFrame>) {
  const roads: SiteElement[] = [], keep: number[][] = [];
  const mode = design.access ?? 'perimeter', rb = !!design.roundabouts;
  if (mode !== 'spine' && mode !== 'grid') return { roads, keep };
  let U0 = Infinity, U1 = -Infinity, V0 = Infinity, V1 = -Infinity;
  for (let i = 0; i < Z.length; i += 2) { U0 = Math.min(U0, Z[i]); U1 = Math.max(U1, Z[i]); V0 = Math.min(V0, Z[i + 1]); V1 = Math.max(V1, Z[i + 1]); }
  const block = BLOCK[shapeUse(use)];
  const ns = mode === 'grid' ? Math.max(1, Math.round((U1 - U0) / (block * 1.2))) : 1;
  const segs: [number[], number[]][] = [];
  const W = (u: number, v: number) => F.toW(u, v).map((x) => Math.round(x * 100) / 100);
  const add = (pts: number[][], w = ROAD_W) => {
    roads.push({ id: `r${roads.length}`, kind: 'road', spine: pts.flatMap(([u, v]) => W(u, v)), depth: w, floors: 0, auto: true });
    for (let i = 0; i + 1 < pts.length; i++) { segs.push([pts[i], pts[i + 1]]); keep.push(stripL(pts[i], pts[i + 1], w + 2 * ROAD_SET)); }
  };
  const ring = (u: number, v: number, rad: number) => {
    roads.push({ id: `o${roads.length}`, kind: 'roundabout', spine: [...W(u - rad, v), ...W(u + rad, v)], depth: rad * 2, floors: 0, auto: true });
    const k = rad + ROAD_SET;
    keep.push([u - k, v - k, u + k, v - k, u + k, v + k, u - k, v + k]);
  };
  // spines from the front of the plot to the back of the zone
  const vEnd = V1 - (rb ? END_R + 1 : 2);
  if (vEnd - V0 < 15) return { roads: [], keep: [] };
  const spines: number[] = [];
  for (let i = 0; i < ns; i++) {
    const uc = U0 + ((i + 0.5) * (U1 - U0)) / ns;
    const at = spanU(swapL(NL), uc - 0.05, uc + 0.05);
    if (!at) continue;
    spines.push(uc);
    add([[uc, at[0]], [uc, vEnd]]);
    if (rb) ring(uc, vEnd, END_R);
  }
  if (!spines.length) return { roads: [], keep: [] };
  // across, in blocks
  const nb = mode === 'grid' && V1 - V0 > 60 ? Math.max(2, Math.round((V1 - V0) / block)) : 0;
  const cross: number[] = [];
  for (let i = 1; i < nb; i++) {
    const vc = V0 + (i * (V1 - V0)) / nb, s = spanU(Z, vc - 0.5, vc + 0.5);
    if (!s) continue;
    cross.push(vc);
    add([[s[0], vc], [s[1], vc]]);
    if (rb) for (const uc of spines) ring(uc, vc, CROSS_R);
  }
  // a road in from each other road that has a gate, to the nearest of these
  const want = gateRoads ?? (r.area >= GATES_FROM ? r.roads.map((x) => x.id) : []);
  const n = r.net.length / 2;
  for (const id of want) {
    if (id === r.road?.id) continue;
    let k = -1, best = 0;
    for (let i = 0; i < n; i++) {
      if (r.edgeRoad[i] !== id) continue;
      const j = (i + 1) % n, L = Math.hypot(r.net[j * 2] - r.net[i * 2], r.net[j * 2 + 1] - r.net[i * 2 + 1]);
      if (L > best) { best = L; k = i; }
    }
    if (k < 0) continue;
    const j = (k + 1) % n, e = F.toL([r.net[k * 2], r.net[k * 2 + 1], r.net[j * 2], r.net[j * 2 + 1]]);
    // the gate on the side, level with a road inside where it can be
    const side = Math.abs(e[3] - e[1]) > Math.abs(e[2] - e[0]);
    const a0 = side ? e[1] : e[0], a1 = side ? e[3] : e[2], lo = Math.min(a0, a1), hi = Math.max(a0, a1);
    if (hi - lo < 10) continue;
    const mid = (lo + hi) / 2, targets = side ? [...cross, (V0 + vEnd) / 2] : spines;
    let t = mid;
    for (const x of targets) if (x > lo + 4 && x < hi - 4 && (t === mid || Math.abs(x - mid) < Math.abs(t - mid))) t = x;
    const f = (t - a0) / (a1 - a0 || 1);
    const g = [e[0] + (e[2] - e[0]) * f, e[1] + (e[3] - e[1]) * f];
    // to the nearest point on a road already laid
    let near: number[] | null = null, nd = Infinity;
    for (const [a, b] of segs) {
      const dx = b[0] - a[0], dz = b[1] - a[1], q = Math.max(0, Math.min(1, ((g[0] - a[0]) * dx + (g[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
      const p = [a[0] + dx * q, a[1] + dz * q], d = Math.hypot(p[0] - g[0], p[1] - g[1]);
      if (d < nd) { nd = d; near = p; }
    }
    if (near && nd > 1) add([g, near]);
  }
  return { roads, keep };
}
const swapL = (P: number[]) => { const Q: number[] = []; for (let i = 0; i < P.length; i += 2) Q.push(P[i + 1], P[i]); return Q; };
