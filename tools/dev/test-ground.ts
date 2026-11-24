// The plot's ground (docs/plans/plot-ground.md): the presets and quick fields give the right layers; every preset
// under 2 to 60 floors and 0 to 4 basements gives a sane foundation and dig (no NaN, the cheapest kind that works);
// hand-checked cases; the basements the ground makes worth it; a pasted borehole log; boreholes blended; and the
// money: a project with no ground keeps its figures exactly, one with a ground moves by its net line.
import { GROUND_PRESETS, groundAtPoint, groundFor, parseLog, quickLayers, runsOf, runAt, rockTop, type PlotGround } from '../../src/pro/ground';
import { basementCap, digOf, foundOf, groundWorks } from '../../src/pro/foundation';
import { evaluate } from '../../src/pro/evaluate';
import { DEFAULT_PROJECT, type ProProject } from '../../src/pro/project';

let bad = 0;
const ok = (c: boolean, s: string) => { if (!c) bad++; if (!c || process.env.VERBOSE) console.log(`${c ? 'ok  ' : 'FAIL'} ${s}`); return c; };
const say = (c: boolean, s: string) => { if (!c) bad++; console.log(`${c ? 'ok  ' : 'FAIL'} ${s}`); };

// ---- the model
const q = quickLayers('loose-sand', 15);
say(q.length === 2 && q[0].kind === 'loose-sand' && q[0].thick === 15 && q[1].kind === 'hard-rock', '"sand, bedrock at 15 m": sand 15 m, then rock');
const R = runsOf(q);
say(rockTop(R) === 15 && runAt(R, 14.9).kind === 'loose-sand' && runAt(R, 15).kind === 'hard-rock' && runAt(R, 200).kind === 'hard-rock', 'its runs: rock from 15 m, to any depth');
say(groundFor('mumbai-island').preset === 'mumbai-island' && groundFor('pune').preset === 'pune', 'each city gets its typical ground');
say(GROUND_PRESETS.every((p) => p.g.layers.every((l) => l.thick > 0)), 'every preset layer has a thickness');

// ---- a pasted log
const log = parseLog(['Depth (m)  Description', '0.0 - 1.5   Black cotton soil, stiff', '1.5 – 4.5 m  Murum, N = 38', '4.5 to 6.0 Weathered basalt', '6.0-12.0 Hard compact basalt', 'Water table at 3.2 m', 'remarks: none'].join('\n'));
say(log.layers.map((l) => l.kind).join(',') === 'black-cotton,murum,soft-rock,hard-rock' && log.water === 3.2 && log.layers[1].spt === 38, `a pasted log reads its layers, water and SPT (${log.layers.map((l) => `${l.kind} ${l.thick}`).join(', ')})`);
say(Math.abs(log.layers.slice(0, 3).reduce((s, l) => s + l.thick, 0) - 6) < 1e-9 && log.skipped.length === 2, 'its depths add up, and the lines it couldn\'t read are listed');

// ---- boreholes blended
const g2: PlotGround = { cover: 'murum', layers: quickLayers('murum', 4), water: null, src: 'user', holes: [{ id: 'a', at: [0, 0], layers: quickLayers('murum', 2), water: null }, { id: 'b', at: [40, 0], layers: quickLayers('murum', 10), water: null }] };
const midRock = rockTop(runsOf(groundAtPoint(g2, 20, 0).layers))!, nearA = rockTop(runsOf(groundAtPoint(g2, 2, 0).layers))!;
say(Math.abs(midRock - 6) < 0.01 && nearA < 2.5, `two holes, rock at 2 m and 10 m: halfway it's at ${midRock.toFixed(1)} m, by the first ${nearA.toFixed(1)} m`);

// ---- the matrix
let cases = 0;
const kinds = new Set<string>();
for (const P of GROUND_PRESETS) {
  const runs = runsOf(P.g.layers);
  for (const floors of [2, 4, 12, 30, 60]) for (let n = 0; n <= 4; n++) {
    const dig = digOf(n, 3, 1500, 160, runs, P.g.water);
    const f = foundOf({ id: 'x', name: 'X', footprint: 600, bua: 600 * floors, floors, homes: true, at: [0, 0] }, runs, P.g.water, dig?.depth ?? 0, n, 'III');
    cases++; kinds.add(f.kind);
    const nums = [f.cost, f.depth, f.q, f.weight, dig?.cost ?? 0, dig?.months ?? 0, ...(f.piles ? [f.piles.n, f.piles.length] : [])];
    ok(nums.every(Number.isFinite) && f.cost >= 0 && (dig === null) === (n === 0), `${P.label}, ${floors} floors, ${n} basements: ${f.label} at ${f.depth} m (${f.why.length} reasons)`);
    ok(f.why.length > 0, `${P.label}, ${floors} floors, ${n} basements: it says why`);
    if (dig) ok(Math.abs(dig.byLayer.reduce((s, x) => s + x.vol, 0) - dig.depth * dig.area * 1.08) < 1, `${P.label}, ${n} basements: the dig's layers add up to the whole`);
  }
}
say(cases === GROUND_PRESETS.length * 25, `${cases} cases: every preset, 2 to 60 floors, 0 to 4 basements, each with a foundation and a reason`);
say(['footings', 'rock', 'raft', 'piles', 'piled-raft'].every((k) => kinds.has(k)), `every kind but under-reamed piles (a case of its own below) comes up across the presets (${[...kinds].join(', ')})`);

// ---- hand-checked cases
const at = (id: string) => runsOf(GROUND_PRESETS.find((p) => p.id === id)!.g.layers);
const B = (floors: number) => ({ id: 'x', name: 'X', footprint: 600, bua: 600 * floors, floors, homes: true, at: [0, 0] as [number, number] });
const f1 = foundOf(B(12), at('pune'), null, 0, 0, 'III');
say(f1.kind === 'rock' || f1.kind === 'raft' || f1.kind === 'footings', `12 floors on Pune's ground: ${f1.label} at ${f1.depth} m (on murum or rock, below the black cotton)`);
say(f1.depth >= 1.5, 'and below the black cotton soil');
const f2 = foundOf(B(30), at('mumbai-suburbs'), 2, 0, 0, 'III');
say(f2.kind === 'piles' || f2.kind === 'piled-raft', `30 floors in the Mumbai suburbs: ${f2.label}`);
say(!!f2.piles?.into && (f2.piles.into === 'soft-rock' || f2.piles.into === 'hard-rock') && f2.piles.socket > 0, `socketed into rock (${f2.piles?.n} × ${f2.piles?.dia} m, ${f2.piles?.length} m, into ${f2.piles?.into})`);
const f3 = foundOf(B(3), runsOf(quickLayers('black-cotton', 8)), null, 0, 0, 'III');
say(f3.kind === 'ureamed', `3 floors on deep black cotton soil: ${f3.label}`);
const f4 = foundOf(B(8), at('sandy'), 1, 0, 0, 'III');
const f4dry = foundOf(B(8), at('sandy'), 6, 0, 0, 'III');
say(!f4dry.flags.some((x) => x.key === 'liquefaction'), 'the same sand above the water: no liquefaction');
say(f4.flags.some((x) => x.key === 'liquefaction') && (f4.kind === 'piles' || f4.kind === 'piled-raft'), `loose sand under the water in zone III: liquefaction flagged, on piles (${f4.label})`);
const sandBelow = digOf(3, 3, 1500, 160, runsOf(quickLayers('dense-sand', 30)), 4);
say(!!sandBelow?.water.below && sandBelow.shore?.kind === 'secant' && sandBelow.water.dewater > 0, `three basements in sand under the water at 4 m: ${sandBelow?.shore?.label}, dewatered`);
const rockDig = digOf(2, 3, 1500, 160, at('pune-rock'), null), soilDig = digOf(2, 3, 1500, 160, runsOf([{ kind: 'stiff-clay', thick: 60 }]), null);
say(!!rockDig && !!soilDig && rockDig.cost > soilDig.cost * 1.5 && rockDig.months > soilDig.months, `two basements in Pune's rock cost ${(rockDig!.cost / soilDig!.cost).toFixed(1)}× those in stiff clay, and take longer`);

// ---- the project: unchanged with no ground; moved by the ground's line with one
const base: ProProject = { ...DEFAULT_PROJECT, width: 40, depth: 55, road: 18, dpRoad: 18 };
const e0 = evaluate(base), e0b = evaluate({ ...base });
say(e0.ground === null && e0.d.money.ground === undefined && e0.d.money.cost === e0b.d.money.cost, 'no ground said: no ground line, the same figures');
for (const id of ['pune', 'pune-rock', 'mumbai-suburbs', 'sandy']) {
  const g = { ...structuredClone(GROUND_PRESETS.find((p) => p.id === id)!.g), src: 'preset' as const, preset: id };
  const e1 = evaluate({ ...base, ground: g });
  const G = e1.ground!;
  ok(!!G && G.buildings.length === e1.d.buildings.length && Number.isFinite(G.lines.net), `${id}: worked through every building`);
  say(Math.abs(e1.d.money.cost - (e1.d.money.land + e1.d.money.premium + e1.d.money.tdr + e1.d.money.ancillary + e1.d.money.build + e1.d.money.parking + e1.d.money.soft + G.lines.net)) < 1, `${id}: the cost takes the ground's net line (${(G.lines.net / 1e7).toFixed(2)} cr; ${e1.d.site.basements} basements, cap ${G.cap.max})`);
  ok(e1.d.site.basements <= Math.max(G.cap.max, 0), `${id}: no more basements than the ground makes worth it`);
}
const deep = evaluate({ ...base, fill: { parking: 'basement', basements: 4 }, ground: { cover: 'fill', layers: [{ kind: 'fill', thick: 3 }, { kind: 'soft-clay', thick: 20 }, { kind: 'hard-rock', thick: 30 }], water: 1, src: 'user' } });
say(deep.ground!.flags.some((f) => f.key === 'basement-cap') && deep.ground!.cap.max < 4, `four basements asked for in soft wet clay: flagged, the ground makes ${deep.ground!.cap.max} worth it (${deep.ground!.cap.why})`);
const cap = basementCap({ cover: 'murum', layers: quickLayers('stiff-clay', 40), water: null, src: 'user' }, e0.r, 3, 1800);
say(cap.max === 4, `on ordinary-like ground the cap doesn't bite (${cap.max})`);
const gw = groundWorks({ cover: 'murum', layers: quickLayers('murum', 3), water: null, src: 'user', spots: [[0, 0, 3], [40, 55, 0.3]] }, e0.r, e0.d, { floorH: 3, levels: { plot: 0.3, slope: 0, dir: 180 }, city: 'pune', parkingRate: 1800 });
say(gw.cutFill.cut > 0 && gw.cutFill.cost > 0, `spot heights falling 2.7 m across the plot: ${Math.round(gw.cutFill.cut)} m³ to cut, ${Math.round(gw.cutFill.fill)} m³ to fill`);

console.log(bad ? `${bad} FAILED` : 'ALL OK');
if (bad) process.exitCode = 1;
