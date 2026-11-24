// A sweep of the plot's ground (docs/plans/plot-ground.md) across what a user can set: every city, every ground
// preset and a few said in the user's own words, flat, sloping and spot-height plots, small, large and drawn plots,
// low slabs and tall towers, basements left to the engine or forced. Each case is evaluated as the app does and
// checked: sane numbers, the cost taking the ground's line, basements within what the ground allows unless asked,
// every building founded with a reason, the drawings' ground sheet and the 3D cut-away buildable. Writes a summary as
// JSON for the report (argv[2], default tools/dev/sweep-ground.json).
import { writeFileSync } from 'node:fs';
import { evaluate } from '../../src/pro/evaluate';
import { DEFAULT_PROJECT, type ProProject } from '../../src/pro/project';
import { GROUND_PRESETS, quickLayers, type PlotGround } from '../../src/pro/ground';
import { groundCutOf } from '../../src/pro/groundPanel';
import type { ProCity } from '../../src/pro/project';

let bad = 0;
const fails: string[] = [];
const ok = (c: boolean, s: string) => { if (!c) { bad++; fails.push(s); console.log(`FAIL ${s}`); } return c; };

const CITIES: ProCity[] = ['pune', 'pune-congested', 'mumbai-suburbs', 'mumbai-island'];
const GROUNDS: [string, PlotGround][] = [
  ...GROUND_PRESETS.map((p) => [p.label, { ...structuredClone(p.g), src: 'preset', preset: p.id }] as [string, PlotGround]),
  ['Sand, rock at 15 m, water at 4 m', { cover: 'loose-sand', layers: quickLayers('loose-sand', 15), water: 4, src: 'user' }],
  ['Rock at the surface', { cover: 'hard-rock', layers: quickLayers('hard-rock', null), water: null, src: 'user' }],
  ['Deep soft clay, water at 1 m', { cover: 'soft-clay', layers: [{ kind: 'soft-clay', thick: 25 }, { kind: 'hard-rock', thick: 30 }], water: 1, src: 'user' }],
];
const ELEV: [string, Partial<ProProject>, (g: PlotGround, p: ProProject) => PlotGround][] = [
  ['flat', { levels: { plot: 0.45, slope: 0, dir: 180 } }, (g) => g],
  ['5% falling to the road', { levels: { plot: 0.6, slope: 5, dir: 180 } }, (g) => g],
  ['12% falling sideways', { levels: { plot: 1, slope: 12, dir: 90 } }, (g) => g],
  ['spot heights, 4 m rise to the back', { levels: { plot: 0.45, slope: 0, dir: 180 } }, (g, p) => ({ ...g, spots: [[0, 0, 0.45], [0, p.depth, 4.45], [-p.width / 2, p.depth / 2, 2], [p.width / 2, p.depth / 2, 3]] })],
];
const PLOTS: [string, Partial<ProProject>][] = [
  ['small 20 × 30 on 9 m', { width: 20, depth: 30, road: 9, dpRoad: 12 }],
  ['40 × 55 on 18 m', { width: 40, depth: 55, road: 18, dpRoad: 18 }],
  ['large 90 × 110 on 24 m', { width: 90, depth: 110, road: 24, dpRoad: 30 }],
  ['drawn L-shaped', { shape: 'poly', ring: [-30, 0, 30, 0, 30, 30, 5, 30, 5, 70, -30, 70], edgeRoads: [{ today: 18, dp: 18 }, null, null, null, null, null], width: 60, depth: 70 }],
];
const BUILD: [string, Partial<ProProject>][] = [
  ['slabs, up to 7 floors, basements as needed', { typology: 'slab', maxFloors: 7 }],
  ['towers, as tall as allowed, basements as needed', { typology: 'tower', maxFloors: 0 }],
  ['as filled, 3 basements asked for', { typology: 'auto', fill: { parking: 'basement', basements: 3 } }],
];

interface Row { city: string; ground: string; elev: string; plot: string; build: string; buildings: number; floors: number; basements: number; cap: number; kinds: string[]; net: number; cost: number; months: number; flags: string[]; ms: number; cut: boolean; base: number }
const rows: Row[] = [];
const t0 = Date.now();
let n = 0;
for (const city of CITIES) for (const [gname, g0] of GROUNDS) for (const [ename, ep, eg] of ELEV) for (const [pname, pp] of PLOTS) for (const [bname, bp] of BUILD) {
  // (not every combination: each city takes every ground and elevation on two plots and builds, rotating, so the
  // whole grid is covered across the cities without 4 × 9 × 4 × 4 × 3 cases)
  if ((CITIES.indexOf(city) + PLOTS.findIndex((x) => x[0] === pname) + BUILD.findIndex((x) => x[0] === bname)) % 3 !== 0) continue;
  const p0: ProProject = { ...DEFAULT_PROJECT, city, ...pp, ...bp, ...ep } as ProProject;
  const p: ProProject = { ...p0, ground: eg(structuredClone(g0), p0) };
  const at = `${city} · ${gname} · ${ename} · ${pname} · ${bname}`;
  const s0 = Date.now();
  let e, base;
  try { e = evaluate(p); base = evaluate(p0); } catch (err) { ok(false, `${at}: evaluates (${(err as Error).message})`); continue; }
  const ms = Date.now() - s0; n++;
  const G = e.ground!, M = e.d.money;
  ok(!!G, `${at}: worked through`);
  if (!G) continue;
  const nums = [M.cost, M.profit, G.lines.net, G.lines.total, G.months, G.cutFill.cut, G.cutFill.fill, ...G.buildings.flatMap((f) => [f.cost, f.depth, f.q, f.piles?.n ?? 0, f.piles?.length ?? 0])];
  ok(nums.every(Number.isFinite), `${at}: every figure a number`);
  ok(Math.abs(M.cost - (M.land + M.premium + M.tdr + M.ancillary + M.build + M.parking + M.soft + G.lines.net)) < 1, `${at}: the cost takes the ground's line`);
  ok(G.buildings.length === e.d.buildings.length && G.buildings.every((f) => f.why.length > 0), `${at}: every building founded, with its reason`);
  ok(p.fill?.basements !== undefined || e.d.site.basements <= G.cap.max, `${at}: no more basements than the ground makes worth it (${e.d.site.basements} of ${G.cap.max})`);
  ok(p.fill?.basements === undefined || e.d.site.basements === p.fill.basements, `${at}: the basements asked for are kept`);
  ok(p.fill?.basements === undefined || p.fill.basements <= G.cap.max || G.flags.some((x) => x.key === 'basement-cap'), `${at}: more basements than the ground allows is flagged`);
  ok(!G.dig || G.dig.depth > 0 && G.dig.byLayer.length > 0, `${at}: the dig goes through something`);
  ok(ename === 'flat' || G.cutFill.cut + G.cutFill.fill > 0, `${at}: a sloping plot has cut and fill`);
  const cut = groundCutOf(e);
  ok(!!cut && cut.floor >= 12 && cut.runs.length > 0 && cut.found.length === G.buildings.length, `${at}: the 3D cut-away has its layers and foundations`);
  ok(base.ground === null && base.d.money.ground === undefined, `${at}: the same project with no ground has no ground line`);
  rows.push({ city, ground: gname, elev: ename, plot: pname, build: bname, buildings: e.d.buildings.length, floors: Math.max(0, ...e.d.buildings.map((b) => b.floors)), basements: e.d.site.basements, cap: G.cap.max, kinds: G.buildings.map((f) => f.kind), net: G.lines.net, cost: M.cost, months: G.months, flags: G.flags.map((f) => f.key.split(':')[0]), ms, cut: !!cut, base: base.d.site.basements });
}
const ms = Date.now() - t0;
console.log(`${n} cases in ${(ms / 1000).toFixed(1)} s; ${bad ? `${bad} FAILED` : 'ALL OK'}`);
writeFileSync(process.argv[2] ?? 'tools/dev/sweep-ground.json', JSON.stringify({ cases: n, bad, fails, ms, rows }, null, 1));
if (bad) process.exitCode = 1;
