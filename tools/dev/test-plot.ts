// Plot sandbox checks: npx esbuild tools/dev/test-plot.ts --bundle --platform=node --outfile=tools/dev/test-plot.mjs && node tools/dev/test-plot.mjs
import { analysePlot, clipHalf, defaultRules, polyArea, sideMargin } from '../../src/doc/plot';
import type { CityDoc } from '../../src/doc/doc';
import type { Compiler } from '../../src/doc/compile';
import type { PlotObj } from '../../src/doc/types';
import { basementsToFit, buildingQuads, pointIn, newBuildingId, presetBuildings, siteOf, solveSite, SQFT, TRAVEL, type PlotSite } from '../../src/doc/site';
import { polyArea as area } from '../../src/doc/plot';
import { schemes as optSchemes, siteFor } from '../../src/doc/optimise';
let ok = true;
const check = (c: boolean, m: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) ok = false; };
const near = (a: number, b: number) => Math.abs(a - b) < 0.5;

check(near(polyArea([0, 0, 10, 0, 10, 5, 0, 5]), 50), 'area of a 10 × 5 rectangle');
check(near(polyArea(clipHalf([0, 0, 10, 0, 10, 10, 0, 10], 0, 0, 0, 1, 4)), 60), 'clip keeps z ≥ 4 of a 10 m square');
const r24 = defaultRules(24, 'residential'), r6 = defaultRules(6, 'residential'), r12 = defaultRules(12, 'residential');
check(near(r24.basic + r24.premium + r24.tdr, 2.75) && r24.front === 4.5 && r24.side === 2, `UDCPR 24 m road: FSI 2.75, front ${r24.front} m, side ${r24.side} m (Tables 6-G, 6-D)`);
check(near(r12.basic + r12.premium + r12.tdr, 2.25) && r12.front === 3 && r12.side === 1.5, 'UDCPR 12 m road: FSI 2.25, front 3 m, side 1.5 m');
check(near(r6.basic + r6.premium + r6.tdr, 1.1), `UDCPR 6 m road: FSI ${r6.basic + r6.premium + r6.tdr} (basic only)`);
const cg = defaultRules(12, 'residential', 'udcpr', true);
check(near(cg.basic + cg.premium + cg.tdr, 2.6), 'UDCPR congested, 12 m road: FSI 2.6 (Table 6-A)');
check(near(defaultRules(30, 'residential').basic + defaultRules(30, 'residential').premium + defaultRules(30, 'residential').tdr, 3) && defaultRules(30, 'residential').front === 6, 'UDCPR 30 m road: FSI 3.0, front 6 m');
const isl = defaultRules(27, 'residential', 'dcpr-island'), sub = defaultRules(12, 'residential', 'dcpr-suburbs');
check(near(isl.basic + isl.premium + isl.tdr, 3) && near(isl.ancillary, 0.35), 'DCPR island city, 27 m road: FSI 3.0 + 35 % fungible');
check(near(sub.basic + sub.premium + sub.tdr, 2.2), 'DCPR suburbs, 12 m road: FSI 2.2');
check(near(sideMargin(r24, 9), 2) && near(sideMargin(r24, 30), 6) && near(sideMargin(r24, 90), 12), 'side margin: 2 m up to 10 m, then H/5, at most 12 m');

// a straight 12 m road along x at z = 0, 24 m in the DP; a 30 × 28 m plot from z = 7 to 35
const section = { kind: 'section', id: 's1', name: 'Test Road', parts: [{ kind: 'lane', width: 12 }], reserve: 24, cls: 'tertiary', elevated: false };
const doc = { get: (id: string) => (id === 's1' ? section : undefined) } as unknown as CityDoc;
const C = { geo: (id: string) => (id === 's1' ? { pts: [-200, 0, 200, 0] } : undefined) } as unknown as Compiler;
const plot: PlotObj = { kind: 'plot', id: 'p1', name: 'Plot', ring: [-15, 7, 15, 7, 15, 35, -15, 35], use: 'residential' };
const a = (p: PlotObj, code?: Parameters<typeof analysePlot>[4]) => analysePlot(doc, C, () => ['s1'], p, code);
const r = a(plot);
check(r.road?.id === 's1' && near(r.road.today, 12) && r.road.dp === 24, `fronts the road: ${r.road?.today} m today, DP ${r.road?.dp} m`);
check(near(r.area, 840) && near(r.lost, 150) && near(r.netArea, 690), `DP line at 12 m takes 5 m: area ${r.area}, lost ${r.lost}, net ${r.netArea}`);
check(near(r.parts.basic, 759) && near(r.parts.premium, 420) && near(r.parts.tdr, 966) && near(r.parts.ancillary, 1287) && near(r.bua, 3432),
  `basic on the net plot, premium and TDR on the whole plot: ${r.parts.basic} + ${r.parts.premium} + ${r.parts.tdr} + ancillary ${r.parts.ancillary.toFixed(0)} = ${r.bua.toFixed(0)} m²`);
// margins grow with the height (H/5 above 10 m): 9 floors at 5.4 m sides builds the most (19.2 × 13.1 m × 9)
check(r.floors === 9 && near(r.side, 5.4) && near(r.buildable, 2263.7) && r.limit === 'margins', `best envelope: ${r.floors} floors, sides ${r.side} m, ${r.buildable.toFixed(1)} m², limited by ${r.limit}`);
// a corner plot: the 12 m road along x and an 8 m lane along z at x = 0; and a plot 50 m off any road
const lane = { kind: 'section', id: 's2', name: 'Lane', parts: [{ kind: 'lane', width: 8 }], cls: 'residential', elevated: false };
const doc2 = { get: (id: string) => (id === 's1' ? section : id === 's2' ? lane : undefined) } as unknown as CityDoc;
const C2 = { geo: (id: string) => (id === 's1' ? { pts: [-200, 0, 200, 0] } : id === 's2' ? { pts: [0, -200, 0, 200] } : undefined) } as unknown as Compiler;
const a2 = (p: PlotObj) => analysePlot(doc2, C2, () => ['s1', 's2'], p);
const corner = a2({ ...plot, ring: [5, 7, 35, 7, 35, 35, 5, 35] });
check(corner.roads.length === 2 && corner.road?.id === 's1' && corner.edges.filter(Boolean).length === 2 && near(corner.lost, 150),
  `corner plot: on ${corner.roads.map((x) => `${x.name}${x.entry ? ' (entry)' : ''}`).join(' and ')}, ${corner.edges.filter(Boolean).length} front edges, ${corner.lost.toFixed(0)} m² to the DP`);
const back = a2({ ...plot, ring: [50, 60, 80, 60, 80, 90, 50, 90] });
check(back.roads.length === 1, `a plot off the roads goes by the nearest: ${back.road?.name}`);
// what-ifs: widen the lane to 30 m and it becomes the entry, FSI by the 30 m row; a DP width on it cuts the plot too
const wide = a2({ ...plot, ring: [5, 7, 35, 7, 35, 35, 5, 35], roadEdits: { s2: { width: 30 } } });
check(wide.road?.id === 's2' && wide.roads.find((x) => x.id === 's2')?.edited === true && near(wide.fsi, 3), `what-if: the lane at 30 m is the entry, FSI ${wide.fsi}`);
const dp2 = a2({ ...plot, ring: [5, 7, 35, 7, 35, 35, 5, 35], roadEdits: { s2: { reserve: 20 } } });
check(near(dp2.lost, 150 + 5 * 23), `what-if: a 20 m DP width on the lane takes 5 m more along it (${dp2.lost.toFixed(0)} m²)`);
const low = a({ ...plot, rules: { maxH: 9 } });
check(low.floors === 3 && near(low.buildable, 1287) && low.limit === 'height', `9 m limit: ${low.floors} floors, ${low.buildable.toFixed(0)} m², limited by ${low.limit}`);
const credit = a({ ...plot, credit: true });
check(near(credit.parts.credit, 165) && near(credit.bua, 3432 + 165 * 1.6), `DP strip counted: +${credit.parts.credit} m² (× 1.6 with ancillary)`);
const today = a({ ...plot, basis: 'today' });
check(near(today.roadW, 12) && near(today.fsi, 2.25) && today.rules.front === 3 && near(today.lost, 150), `today's width: FSI ${today.fsi}, front ${today.rules.front} m on a ${today.roadW} m road (DP strip still taken)`);
const mum = a(plot, 'dcpr-suburbs');
check(near(mum.fsi, 2.4) && near(mum.bua, (1 * 690 + 1.4 * 840) * 1.35), `Mumbai suburbs, 24 m road: FSI ${mum.fsi}, ${mum.bua.toFixed(0)} m² with fungible`);
const onRoad = a({ ...plot, ring: [-15, -3, 15, -3, 15, 25, -15, 25] });
check(onRoad.onRoad, 'a plot drawn over the road is flagged');

// sites: buildings as spines in the envelope
const site = siteOf(undefined, r);
const bar = solveSite(r, site);
const b0 = bar.buildings[0];
check(bar.buildings.length === 1 && b0.floors > 0 && bar.bua <= r.bua + 0.5 && bar.flats > 0 && !b0.clash,
  `default bar: ${b0.floors} floors of ${b0.plate.toFixed(0)} m², ${bar.flats} flats (${bar.count.slice(0, 3).join(' / ')}), FSI ${bar.fsi.toFixed(2)}`);
// every point of a floor plate in one flat, or a core or corridor; no two flats overlapping
function tiles(b: typeof b0) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const q of b.quads) for (let i = 0; i < q.length; i += 2) { x0 = Math.min(x0, q[i]); x1 = Math.max(x1, q[i]); z0 = Math.min(z0, q[i + 1]); z1 = Math.max(z1, q[i + 1]); }
  let gaps = 0, doubles = 0, n = 0;
  for (let x = x0 + 0.37; x < x1; x += 0.71) for (let z = z0 + 0.29; z < z1; z += 0.73) {
    if (!b.quads.some((q) => pointIn(q, x, z))) continue;
    n++;
    const u = b.units.filter((f) => pointIn(f.ring, x, z)).length;
    const other = b.cores.some((c) => pointIn(c, x, z)) || b.corridors.some((c) => pointIn(c, x, z));
    if (u > 1) doubles++;
    if (!u && !other) gaps++;
  }
  return { gaps: gaps / n, doubles: doubles / n };
}
const t0 = tiles(b0);
check(b0.units.every((u) => u.carpet > 20) && t0.gaps < 0.01 && t0.doubles < 0.005, `a bar's floor: flats, cores and corridors fill it (${(t0.gaps * 100).toFixed(1)} % gaps, ${(t0.doubles * 100).toFixed(1)} % overlaps)`);
check(near(bar.money.revenue, bar.carpet * SQFT * bar.money.costs.sale) && near(bar.money.profit, bar.money.revenue - bar.money.cost), `money adds up: revenue ₹${(bar.money.revenue / 1e7).toFixed(1)} Cr, margin ${(bar.money.margin * 100).toFixed(0)} %`);
const fit = solveSite(r, { ...site, basements: basementsToFit(r, site, 'residential') });
check(fit.parking.have >= fit.parking.need, `parking fits with ${fit.site.basements} basement(s): ${fit.parking.have} of ${fit.parking.need} bays (${fit.parking.cars} cars, ${fit.parking.scooters} scooters)`);

const big = { ...r, net: [-30, -30, 80, -30, 80, 60, -30, 60], edges: [true, false, false, false], area: 9900, bua: 99999, rules: { ...r.rules, maxH: 60, front: 0, side: 0 } };
// presets fit the envelope they were made for
const presets = (['bar', 'L', 'U', 'court', 'tower'] as const).map((p) => solveSite(big, { ...site, buildings: presetBuildings({ ...big, footprint: [-20, -20, 70, -20, 70, 50, -20, 50] }, p) }));
check(presets.every((p) => p.buildings.length === 1 && !p.over.margins) && presets[3].buildings[0].b.closed === true,
  `presets: ${presets.map((p) => `${p.buildings[0]?.quads.length} wing(s) ${p.buildings[0]?.plate.toFixed(0)} m²`).join(', ')}`);
// an L spine: a corner, flats round it, quads meeting on the mitre
const L: PlotSite = { ...site, buildings: [{ id: 'l', spine: [0, 0, 40, 0, 40, 30], depth: 16, floors: 3 }] };
const lr = solveSite(big, L).buildings[0];
const plateL = buildingQuads(L.buildings[0]).reduce((s, q) => s + area(q), 0);
check(near(plateL, 16 * (40 + 30)) && lr.quads.length === 2, `L plate: ${plateL.toFixed(0)} m² = 16 m × 70 m of spine`);
const tl = tiles(lr);
check(tl.gaps < 0.01 && tl.doubles < 0.005 && lr.units.length > 6, `L floor round the corner: ${lr.units.length} flats, ${lr.cores.length} cores (${(tl.gaps * 100).toFixed(1)} % gaps, ${(tl.doubles * 100).toFixed(1)} % overlaps)`);
const court = presets[3].buildings[0], tc = tiles(court);
check(tc.gaps < 0.01 && tc.doubles < 0.005, `courtyard floor: ${court.units.length} flats (${(tc.gaps * 100).toFixed(1)} % gaps, ${(tc.doubles * 100).toFixed(1)} % overlaps)`);
// cores within the travel distance: a 150 m slab needs three
const long = solveSite(big, { ...site, buildings: [{ id: 's', spine: [-25, 0, 75, 0, 75, 50], depth: 16, floors: 4 }] }).buildings[0];
check(long.cores.length === Math.ceil(150 / (2 * TRAVEL)), `150 m of spine gets ${long.cores.length} cores (${TRAVEL} m travel)`);
// floors automatic: the FSI shared between two buildings, lowest first
const two = solveSite({ ...big, bua: 4000 }, { ...site, buildings: [{ id: 'a', spine: [0, 0, 30, 0], depth: 16, floors: 0 }, { id: 'b', spine: [0, 40, 30, 40], depth: 16, floors: 0 }] });
check(Math.abs(two.buildings[0].floors - two.buildings[1].floors) <= 1 && two.bua <= 4000 && two.bua > 4000 - 480, `two buildings share 4,000 m²: ${two.buildings.map((b) => b.floors).join(' + ')} floors, ${two.bua.toFixed(0)} m²`);
// clashes: out of the envelope, and into each other
const out = solveSite(r, { ...site, buildings: [{ id: 'x', spine: [-40, 20, 40, 20], depth: 16, floors: 2 }] });
check(out.buildings[0].clash === 'margins' && out.over.margins, 'a building past the margins is flagged');
const hit = solveSite(big, { ...site, buildings: [{ id: 'a', spine: [0, 0, 30, 0], depth: 16, floors: 2 }, { id: 'b', spine: [10, 5, 40, 5], depth: 16, floors: 2 }] });
check(hit.over.overlap && hit.buildings.every((b) => b.clash === 'overlap'), 'buildings running into each other are flagged');
const office = solveSite(r, site, 'commercial');
check(office.buildings[0].perFloor[3] > 0 && office.count[0] + office.count[1] + office.count[2] === 0, `commercial floors are offices: ${office.buildings[0].perFloor[3]} per floor`);
check(newBuildingId() !== newBuildingId(), 'building ids are unique');

// fire tender: 6 m clear round a building over 15 m, on the plot (or out over the road it fronts)
const tallIn = solveSite(big, { ...site, buildings: [{ id: 't', spine: [0, 10, 30, 10], depth: 16, floors: 8 }] }).buildings[0];
const tallEdge = solveSite(big, { ...site, buildings: [{ id: 't', spine: [0, 55, 30, 55], depth: 8, floors: 8 }] }).buildings[0];
const lowEdge = solveSite(big, { ...site, buildings: [{ id: 't', spine: [0, 55, 30, 55], depth: 8, floors: 3 }] }).buildings[0];
const front = solveSite(big, { ...site, buildings: [{ id: 't', spine: [0, -26, 30, -26], depth: 8, floors: 8 }] }).buildings[0];
check(tallIn.fireOk && !tallEdge.fireOk && lowEdge.fire.length === 0 && front.fireOk, 'fire tender: 6 m round a tall building, out over the road counts, not needed at 15 m and under');
const near2 = solveSite(big, { ...site, buildings: [{ id: 'a', spine: [0, 0, 30, 0], depth: 16, floors: 8 }, { id: 'b', spine: [0, 20, 30, 20], depth: 16, floors: 8 }] });
check(near2.over.fire && !near2.over.overlap, 'two tall buildings 4 m apart: no way round between them');
// surface parking on the open ground, clear of the buildings; open space what's left
const surf = solveSite(big, { ...site, surface: true, buildings: [{ id: 'a', spine: [0, 0, 30, 0], depth: 16, floors: 3 }] });
const sl = surf.parking.levels.find((l) => l.kind === 'surface')!;
check(sl.bays.length > 50 && sl.bays.every((q) => !surf.buildings[0].quads.some((b) => b.some((_, i) => i % 2 === 0 && pointIn(q, b[i], b[i + 1], -0.1)))), `surface parking: ${sl.bays.length} bays round the building`);
check(surf.open.need === 990 && Math.abs(surf.open.have - (9900 - 480 - sl.bays.length * 12.5)) < 50, `open space: ${surf.open.have.toFixed(0)} m² open of ${surf.open.need} m² needed (10 % of 0.99 ha)`);
// cash: flows add up to the profit, the money in peaks before the sales come in, an IRR when it pays
const M = bar.money;
check(near(M.cum[M.cum.length - 1] / 1e5, M.profit / 1e5) && M.peak > 0 && M.flow.length === M.costs.months + 13, `cash flow: ${M.flow.length} months, peak ₹${(M.peak / 1e7).toFixed(1)} Cr in, IRR ${M.irr === null ? '–' : (M.irr * 100).toFixed(0) + ' %'}`);
const rich = solveSite(r, { ...site, cost: { sale: 30000 } }).money;
check(rich.irr !== null && rich.irr > 0 && rich.payback !== null, `a profitable scheme: IRR ${((rich.irr ?? 0) * 100).toFixed(0)} %, pays back in month ${rich.payback}`);
// twin towers, and generating schemes
const bigR = { ...big, footprint: [-20, -20, 70, -20, 70, 50, -20, 50] };
const twin = presetBuildings(bigR, 'twin');
check(twin.length === 2 && !solveSite(big, { ...site, buildings: twin }).over.overlap, 'twin towers: two, apart');

// the optimiser: the most built-up area within every rule, on plots small to large, Pune and Mumbai
const opt = (ring: number[], code: Parameters<typeof analysePlot>[4] = 'udcpr', design?: PlotSite['design'], use: PlotObj['use'] = 'residential') => {
  const R = analysePlot({ get: (id: string) => (id === 's1' ? { ...section, ...{} } : undefined) } as unknown as CityDoc, { geo: (id: string) => (id === 's1' ? { pts: [-400, 0, 400, 0] } : undefined) } as unknown as Compiler, () => ['s1'], { ...plot, ring, use }, code);
  const st = siteFor(design ? { ...site, buildings: [], design } : undefined, R, use);
  return { R, st, D: solveSite(R, st, use) };
};
const legal = (D: ReturnType<typeof solveSite>) => !D.over.fsi && !D.over.height && !D.over.margins && !D.over.overlap && !D.over.fire && !D.over.open && D.parking.have >= D.parking.need;
for (const [name, ring, code, least] of [
  ['600 m²', [-10, 7, 10, 7, 10, 37, -10, 37], 'udcpr', 0.35],
  ['1,350 m²', [-15, 7, 15, 7, 15, 52, -15, 52], 'udcpr', 0.8],
  ['4,200 m²', [-30, 7, 30, 7, 30, 77, -30, 77], 'udcpr', 0.95],
  ['9,000 m²', [-50, 7, 50, 7, 50, 97, -50, 97], 'udcpr', 0.95],
  ['9,000 m² Mumbai', [-50, 7, 50, 7, 50, 97, -50, 97], 'dcpr-island', 0.95],
] as [string, number[], Parameters<typeof analysePlot>[4], number][]) {
  const { R, st, D } = opt(ring, code);
  check(legal(D) && D.bua >= R.bua * least && D.bua <= R.bua + 0.5,
    `optimised ${name}: ${st.buildings.length} building(s) × ${Math.max(...D.buildings.map((b) => b.floors))} floors, ${(D.bua / R.bua * 100).toFixed(0)} % of ${R.bua.toFixed(0)} m², ${D.flats} flats, ${st.basements} basement(s), every rule met`);
}
const pune = opt([-50, 7, 50, 7, 50, 97, -50, 97]), mumO = opt([-50, 7, 50, 7, 50, 97, -50, 97], 'dcpr-island');
const first = (x: typeof pune) => optSchemes(x.R, { type: 'auto', maxFloors: 0, maxBuildings: 0 }, 'residential')[0].type;
check(first(pune) === 'slab' && first(mumO) === 'tower' && mumO.D.height > pune.D.height, `Pune gets slabs (${pune.D.height} m), Mumbai towers (${mumO.D.height} m)`);
const capped = opt([-50, 7, 50, 7, 50, 97, -50, 97], 'udcpr', { type: 'slab', maxFloors: 8, maxBuildings: 0 });
check(capped.D.buildings.every((b) => b.floors <= 8) && legal(capped.D), `8 floors at most: ${capped.st.buildings.length} slabs, ${(capped.D.bua / capped.R.bua * 100).toFixed(0)} % built`);
const both = optSchemes(pune.R, { type: 'auto', maxFloors: 0, maxBuildings: 0 }, 'residential');
check(both.length === 2 && both[0].type !== both[1].type, `both kinds offered: ${both.map((s) => `${s.type} ${s.bua.toFixed(0)} m²`).join(', ')}`);
// the ground: a wall with gates, the drive round the tall buildings, the open space
const G = pune.D.ground;
check(G.gates.length === 2 && G.drive.length === 1 && G.wall.length >= 4 && !!G.rg && area(G.rg) >= 900 - 1, `the ground: ${G.wall.length} runs of wall, ${G.gates.length} gates, a ${G.driveW} m drive, ${area(G.rg ?? []).toFixed(0)} m² of open space`);
const lowG = opt([-10, 7, 10, 7, 10, 37, -10, 37]).D.ground;
check(lowG.drive.length === 0 && lowG.gates.length === 1, 'a low building: one gate, no drive');

// offices and sheds
const off = opt([-50, 7, 50, 7, 50, 97, -50, 97], 'udcpr', undefined, 'commercial');
check(legal(off.D) && off.D.bua >= off.R.bua * 0.9 && off.D.buildings.every((b) => b.b.depth >= 16) && !off.st.stilt && off.D.count[3] > 0,
  `commercial: ${off.st.buildings.length} block(s) ${off.D.buildings.map((b) => b.b.depth).join('/')} m deep, ${off.D.count[3]} office floors, ${(off.D.bua / off.R.bua * 100).toFixed(0)} % built, no stilt`);
const ind = opt([-60, 7, 60, 7, 60, 107, -60, 107], 'udcpr', undefined, 'industrial');
check(legal(ind.D) && ind.R.rules.basic === 1 && ind.D.height <= 24 && ind.D.buildings.every((b) => b.b.depth >= 24 && !b.cores.length) && ind.D.parking.trucks > 0 && ind.st.basements === 0,
  `industrial: ${ind.st.buildings.length} shed(s) ${ind.D.buildings.map((b) => `${b.b.depth} m deep × ${b.floors}`).join(', ')}, ${(ind.D.bua / ind.R.bua * 100).toFixed(0)} % of FSI 1, ${ind.D.parking.trucks} loading bays, ${ind.D.parking.have}/${ind.D.parking.need} bays, ₹${(ind.D.money.profit / 1e7).toFixed(1)} Cr`);
// the flat mix holds across the buildings (within 20 points of 20 / 50 / 30), each flat near its size
const mixOf = pune.D.count.slice(0, 3).map((c) => c / pune.D.flats);
const sizesOk = pune.D.buildings.every((b) => b.units.every((u) => u.carpet >= site.sizes[u.t as 0 | 1 | 2] * 0.8 && u.carpet <= site.sizes[u.t as 0 | 1 | 2] * 1.3));
check(mixOf.every((m, t) => Math.abs(m - site.mix[t]) <= 0.2) && sizesOk, `mix on the optimised 9,000 m²: ${mixOf.map((m) => (m * 100).toFixed(0)).join(' / ')} %, every flat within its size`);





// internal roads, spacing, green, elements, the podium under the buildings only
{
  const big = [-80, 7, 80, 7, 80, 167, -80, 167];
  const sp = opt(big, 'udcpr', { type: 'auto', maxFloors: 0, maxBuildings: 0, access: 'spine', roundabouts: true });
  const roads = (sp.st.elements ?? []).filter((e) => e.kind === 'road'), rbs = (sp.st.elements ?? []).filter((e) => e.kind === 'roundabout');
  const clear = sp.D.buildings.every((b) => !b.clash);
  check(roads.length >= 1 && rbs.length >= 1 && clear && legal(sp.D) && sp.D.ground.gates.length >= 1 && sp.D.ground.drive.length === 0,
    `spine road: ${roads.length} road(s), ${rbs.length} roundabout(s), ${sp.st.buildings.length} buildings clear of them, ${(sp.D.bua / sp.R.bua * 100).toFixed(0)} % built, ${sp.D.ground.gates.length} gate(s)`);
  const gr = opt(big, 'udcpr', { type: 'auto', maxFloors: 0, maxBuildings: 0, access: 'grid', roundabouts: true, spacing: 8, green: 20 });
  const gRoads = (gr.st.elements ?? []).filter((e) => e.kind === 'road').length;
  check(gRoads >= 2 && gr.D.buildings.every((b) => !b.clash) && gr.D.open.green >= gr.R.area * 0.2 - 1,
    `grid: ${gRoads} roads, 8 m more spacing, ${(gr.D.open.green / gr.R.area * 100).toFixed(0)} % green, ${(gr.D.bua / gr.R.bua * 100).toFixed(0)} % built`);
  // a car park, a lot and a garden placed by hand: the optimiser builds round the car park; the lot gives way
  const base = { ...site, buildings: [], elements: [
    { id: 'cp', kind: 'parking' as const, spine: [-60, 30, -20, 30], depth: 30, floors: 0, levels: 4 },
    { id: 'lot', kind: 'lot' as const, spine: [0, 60, 60, 60], depth: 30, floors: 0 },
  ] };
  const R2 = opt(big).R, st2 = siteFor(base, R2, 'residential'), D2 = solveSite(R2, st2, 'residential');
  const cpBays = D2.parking.levels.filter((l) => l.kind === 'structure').reduce((a, l) => a + l.bays.length, 0);
  check(D2.buildings.every((b) => !b.clash) && cpBays > 100 && D2.parking.levels.filter((l) => l.kind === 'structure').length === 4,
    `a 4-level car park placed by hand: ${cpBays} bays, the buildings kept off it`);
  // the podium sits under the buildings, not the whole plot
  const pod = solveSite(R2, { ...sp.st, podium: 1 }, 'residential');
  const podA = pod.parking.levels.find((l) => l.kind === 'podium')!.area, plates = pod.buildings.reduce((a, b) => a + b.plate, 0);
  check(Math.abs(podA - plates) < 1, `a podium the buildings' size: ${podA.toFixed(0)} m² (not the ${polyArea(R2.net).toFixed(0)} m² plot)`);
}
console.log(ok ? 'ALL OK' : 'FAILURES'); process.exit(ok ? 0 : 1);
