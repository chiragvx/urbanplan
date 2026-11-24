// A form's parts (docs/plans/pro-design-freedom.md step 3): add, cut and keep act on the floors they span, in order;
// a part switched off does nothing; older forms' carves are cuts.
import { boxForm, layForm, type Carve, type Form } from '../../src/pro/form';
import { newPart, pushEdge, tOfFloor, floorOfT } from '../../src/pro/parts';
import { DEFAULT_PROJECT, type ProProject } from '../../src/pro/project';
import { evaluate } from '../../src/pro/evaluate';
import { scrutiny, scrutinySummary } from '../../src/pro/scrutiny';
import { subjectsOf, farthestFromStair } from '../../src/pro/checkRows';
import { groupOf } from '../../src/doc/egress';
import { TEMPLATES } from '../../src/pro/form';
import { placeTemplate } from '../../src/pro/edit';
import { sampleBez, smoothHandles, moveHandle } from '../../src/doc/curves';
import { withNodes, nodesOf, trimAtFront, joinOf, type SiteElement } from '../../src/doc/site';

let bad = 0;
const ok = (c: boolean, s: string) => { if (!c) bad++; console.log(`${c ? 'ok  ' : 'FAIL'} ${s}`); };
const ctx = { floorH: 3, mix: [0.3, 0.5, 0.2] as [number, number, number], sizes: [30, 45, 65] as [number, number, number] };
const lay = (f: Form, floors = 10) => layForm({ id: 't', spine: [0, 0, 1, 0], depth: 20, floors, form: f } as never, ctx)!;
const rect = (x0: number, z0: number, x1: number, z1: number) => ({ pts: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] as [number, number][] });
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

const base = boxForm(30, 20, 10);
const L0 = lay(base);
ok(near(L0.floors[0].area, 600) && near(L0.floors[9].area, 600), `a 30 × 20 box: 600 m² a floor (${L0.floors[0].area.toFixed(1)})`);

// a podium: 50 × 40 on floors 1–3
const pod: Carve = { id: 'pod', op: 'add', ring: rect(-25, -20, 25, 20), from: 0, to: tOfFloor(3, 10), face: 'glass' };
const L1 = lay({ ...base, carves: [pod] });
ok(near(L1.floors[0].area, 2000) && near(L1.floors[2].area, 2000) && near(L1.floors[3].area, 600), `a podium on floors 1–3: ${L1.floors.map((f) => Math.round(f.area)).join(', ')}`);
ok(L1.floors[3].terrace > 1300, `a terrace over the podium (${Math.round(L1.floors[3].terrace)} m²)`);

// a cut: a 10 × 20 notch through the box's end, all the way up
const notch: Carve = { id: 'n', ring: rect(5, -11, 16, 11), from: 0, to: 1, face: 'glass' };
const L2 = lay({ ...base, carves: [notch] });
ok(near(L2.floors[5].area, 400), `a cut, op unset as older forms have it, takes 200 m²: ${L2.floors[5].area.toFixed(1)}`);
ok(L2.floors[5].cuts.length > 0, 'and leaves a cut face');

// order: the cut after the podium cuts the podium too; before it, it doesn't
const A = lay({ ...base, carves: [pod, notch] }), B = lay({ ...base, carves: [notch, pod] });
ok(near(A.floors[0].area, 2000 - 11 * 22) && near(B.floors[0].area, 2000), `order counts: podium then cut ${Math.round(A.floors[0].area)}, cut then podium ${Math.round(B.floors[0].area)}`);

// keep: only what lies in a 20 × 20 square
const keep: Carve = { id: 'k', op: 'keep', ring: rect(-10, -10, 10, 10), from: 0, to: 1, face: 'glass' };
ok(near(lay({ ...base, carves: [keep] }).floors[4].area, 400), 'a keep trims every floor to it (400 m²)');

// off
ok(near(lay({ ...base, carves: [{ ...pod, off: true }] }).floors[0].area, 600), 'a part switched off does nothing');

// two masses joined by a bridge on floors 8–9
const twin: Form = { ...boxForm(12, 12, 10), plan: rect(-20, -6, -8, 6), carves: [
  { id: 'w', op: 'add', ring: rect(8, -6, 20, 6), from: 0, to: 1, face: 'glass' },
  { id: 'br', op: 'add', ring: rect(-8, -3, 8, 3), from: tOfFloor(8, 10), to: tOfFloor(9, 10), face: 'glass' },
] };
const T = lay(twin);
ok(near(T.floors[0].area, 288) && near(T.floors[7].area, 288 + 96), `two towers, a bridge on floors 8–9: ${Math.round(T.floors[0].area)} → ${Math.round(T.floors[7].area)} m²`);
ok(T.floors[0].rings.filter((r) => r.length >= 6).length === 2, 'the floors below the bridge are two masses');

// the helpers
ok(floorOfT(tOfFloor(7, 10), 10) === 7, 'floors and heights round-trip');
const pushed = pushEdge(notch, 1, 2);
ok(pushed.ring.pts[1][0] === 18 && pushed.ring.pts[2][0] === 18, `an edge pushed out 2 m moves both its ends (${pushed.ring.pts[1][0]})`);
for (const k of ['block', 'wing', 'cut', 'slot', 'trim'] as const) {
  const L = lay({ ...base, carves: [newPart(base, k)] });
  ok(!!L && L.floors.every((f) => f.area > 50), `a new ${k} lays out (${Math.round(L.floors[0].area)} m² at the ground)`);
}


// levels (step 4): a height by range, a void, and a part kept to its floors
const tall = lay({ ...base, levels: [{ from: 1, to: 1, h: 6 }] });
ok(near(tall.floors[0].h, 6, 0.01) && near(tall.floors[1].y, 6, 0.01), `the ground floor 6 m high, floor 2 starts at ${tall.floors[1].y} m`);
const atrium = lay({ ...base, levels: [{ from: 2, to: 2, void: true }] });
const h0 = L0.floors.reduce((s, f) => s + f.h, 0), h1 = atrium.floors.reduce((s, f) => s + f.h, 0);
ok(atrium.floors[1].void === true && atrium.floors[1].area === 0 && atrium.floors[1].units.length === 0, 'a void floor has no area and no units');
ok(near(h0, h1, 0.01) && atrium.floors.length === 10, `and the building keeps its height (${h1} m) and its floors`);
ok(!atrium.issues.some((i) => i.key === 'empty'), 'a void is not flagged as an empty floor');
ok(!lay({ ...base, levels: [{ from: 1, to: 1, void: true }] }).floors[0].void, 'the ground floor always has a floor');
const kept: Carve = { ...pod, lo: 1, hi: 3 };
const K20 = lay({ ...boxForm(30, 20, 20), carves: [kept] }, 20);
ok(near(K20.floors[2].area, 2000) && near(K20.floors[3].area, 600), `a podium kept to floors 1–3 stays there on 20 floors: ${Math.round(K20.floors[2].area)}, ${Math.round(K20.floors[3].area)}`);
const T20 = lay({ ...boxForm(30, 20, 20), carves: [pod] }, 20);
ok(near(T20.floors[4].area, 2000), 'one by share of the height grows with it (older parts, unchanged)');

// spaces (step 5): shops along the front of a floor of homes, a hall as one unit
const shopsFront: Form = { ...base, spaces: [{ id: 's', use: 'retail', ring: rect(-16, -11, 16, -4), lo: 1, hi: 1 }] };
const S1 = lay(shopsFront);
const kinds = (k: number) => [...new Set(S1.floors[k].units.map((u) => u.kind ?? '-'))].sort().join(',');
ok(kinds(0) === '-,retail' && kinds(1) === '-', `floor 1 holds shops and homes, floor 2 homes only (${kinds(0)} | ${kinds(1)})`);
ok(near(S1.floors[0].spaces?.[0]?.area ?? 0, 30 * 6), `the space is cut to the floor: ${Math.round(S1.floors[0].spaces?.[0]?.area ?? 0)} m²`);
const hall = lay({ ...base, spaces: [{ id: 'h', use: 'community', ring: rect(-16, -11, 16, 11), lo: 1, hi: 2, fill: 'one' }] });
ok(hall.floors[0].units.length >= 1 && hall.floors[0].units.every((u) => u.kind === 'community') && hall.floors[2].units.every((u) => !u.kind), `a space kept as one unit: ${hall.floors[0].units.length} unit on floor 1`);
const proj = (f: Form): ProProject => ({ ...DEFAULT_PROJECT, scheme: { buildings: [{ id: 'b', spine: [0, 25, 1, 25], depth: 20, floors: 10, form: f }], elements: [] } } as ProProject);
const e0 = evaluate(proj(base)), e1 = evaluate(proj(shopsFront));
const U = (e: typeof e0) => ((e.d.money as unknown as { uses?: { use: string; units: number; floors: number }[] }).uses ?? []);
const shopLine = U(e1).find((x) => x.use === 'retail');
ok(!!shopLine && shopLine.units > 0 && shopLine.floors === 0, `the money counts the shops by their own use (${shopLine?.units} units, on no floor of their own)`);
const e2 = evaluate(proj({ ...shopsFront, spaces: [{ ...shopsFront.spaces![0], use: 'community' }] }));
ok(e2.d.parking.need > e1.d.parking.need, `and parks each by its own rule: shops ${e1.d.parking.need}, a hall in their place ${e2.d.parking.need} (homes alone ${e0.d.parking.need})`);

// numbers by use (step 6): build cost and people by each space's use, a parking target
ok((e1.d.people ?? 0) > 0 && U(e1).some((x) => x.use === 'retail' && (x as { people?: number }).people! > 0), `people by use: ${e1.d.people} in all`);
const eHall = evaluate(proj({ ...base, spaces: [{ id: 'h', use: 'hotel', ring: rect(-16, -11, 16, 11), lo: 1, hi: 3 }] }));
ok(eHall.d.money.build > e0.d.money.build, `a hotel space builds at the hotel's rate: ₹${(e0.d.money.build / 1e7).toFixed(2)} → ${(eHall.d.money.build / 1e7).toFixed(2)} cr`);
const tgt = evaluate({ ...proj(base), fill: { parkTarget: 1.5 } } as ProProject);
ok(tgt.d.parking.want === Math.ceil(e0.d.parking.need * 1.5), `a target of 150%: ${tgt.d.parking.want} bays wanted for ${tgt.d.parking.need} by the code`);

// curves on drawn lines and areas: the line is the curve sampled, the nodes kept as drawn
{
  const nodes = [0, 0, 20, 0, 20, 20];
  const sm = [null, smoothHandles(nodes, 1, false), null];
  const pts = sampleBez(nodes, sm, false);
  ok(pts.length > 10 && pts[0] === 0 && pts[pts.length - 2] === 20 && pts[pts.length - 1] === 20, `a smooth corner samples a curve through it (${pts.length / 2} points), ends as drawn`);
  const mh = moveHandle([-3, 0, 3, 0], 1, 0, 5, false);
  ok(!!mh && mh[0] === 0 && mh[1] === -3, `a handle moved turns the other to stay opposite, its length kept (${mh})`);
  const mb = moveHandle([-3, 0, 3, 0], 1, 0, 5, true);
  ok(!!mb && mb[0] === -3 && mb[1] === 0, 'Alt: the other stays put');
  const rd = { id: 'r', kind: 'road', spine: nodes, depth: 6, floors: 0 } as unknown as SiteElement;
  const c = withNodes(rd, nodes, sm);
  ok(c.spine.length === pts.length && c.nodes === nodes && nodesOf(c) === nodes, 'a road with curves keeps its nodes; its line is the curve');
  const back = withNodes(c, nodes, [null, null, null]);
  ok(!back.nodes && !back.bez && back.spine.join() === nodes.join(), 'all corners again: just the points');
}
// a road drawn out of the plot across a road side: cut at the edge, a gate there and a join on to the road outside
{
  const N = [0, 0, 100, 0, 100, 80, 0, 80];
  const t = trimAtFront([50, 40, 50, -6], N, [true, false, false, false]);
  ok(t.length === 4 && t[3] === 0, `a road run out across the road side ends on it (${t})`);
  const kept = trimAtFront([50, 40, 50, -6], N, [false, false, false, false]);
  ok(kept[3] === -6, 'across a side with no road: left as drawn');
  const lost = [[0, 0, 100, 0, 100, -3, 0, -3]];
  const j = joinOf(N, lost, [0, 0, 100, 0], 50, 0, 50, 1, 6)!;
  let zMin = Infinity, xMin = Infinity, xMax = -Infinity;
  for (let i = 0; i < j.length; i += 2) { zMin = Math.min(zMin, j[i + 1]); xMin = Math.min(xMin, j[i]); xMax = Math.max(xMax, j[i]); }
  ok(zMin < -3 && zMin > -4, `its join runs across the 3 m widening to the road (to z ${zMin})`);
  ok(xMax - xMin > 6 + 2, `and flares at the kerb: ${(xMax - xMin).toFixed(1)} m across for a 6 m road`);
}

// checks as rows (step 7): by each use's NBC group; a group not worked through, or no use yet, is "not checked"
{
  ok(groupOf('residential') === 'A' && groupOf('office') === 'E' && groupOf('clinic') === 'C' && groupOf('parking') === null && groupOf('none') === null, 'NBC groups by use: homes A, offices E, a clinic C, parking and no use none');
  const sc = (q: ProProject) => scrutiny(evaluate(q));
  const homes = sc(proj(base));
  const keys = homes.map((c) => c.key);
  ok(['travel:0', 'exit-width:0', 'stair-min:0'].every((k) => keys.includes(k)), `homes get the rows: ${homes.filter((c) => c.applies).map((c) => `${c.key} ${c.status}`).join(', ')}`);
  ok(!homes.some((c) => c.status === 'unchecked'), 'and nothing unchecked');
  ok(!keys.some((k) => /^stair-(w|cap)/.test(k)), "the systems' own stair checks give way to the rows");
  const clinic = sc(proj({ ...base, spaces: [{ id: 'c', use: 'clinic', ring: rect(-16, -11, 16, 11), lo: 1, hi: 2 }] }));
  const u = clinic.find((c) => c.key === 'unchecked-clinic:0');
  ok(!!u && u.status === 'unchecked' && /group C/.test(u.clause), `a clinic's floors: not checked (${u?.proposed})`);
  ok(scrutinySummary(clinic).unchecked === 1, 'and the summary counts it');
  const none = sc(proj({ ...base, uses: [{ use: 'none', floors: 10 }] } as Form));
  ok(none.some((c) => c.key === 'unchecked-none:0'), 'floors with no use yet: not checked, until they have one');
  // (offices: 50 people a 0.5 m unit, homes 25; so a floor of offices needs fewer units than its people suggest)
  const eo = evaluate(proj({ ...base, uses: [{ use: 'office', floors: 10 }] } as Form));
  const so = subjectsOf(eo.d.buildings[0]);
  ok(so.subjects[0]?.use === 'office' && near(so.units, (eo.d.buildings[0].laid!.floors[0].area / 10) / 50, 0.01), `offices' busiest floor: ${so.units.toFixed(2)} units of stair width (${Math.round(eo.d.buildings[0].laid!.floors[0].area)} m² at 10 m² a person, 50 a unit)`);
  const far = farthestFromStair({ cores: [[0, 0, 2, 0, 2, 2, 0, 2]], quads: [[0, 0, 61, 0, 61, 10, 0, 10]] } as never)!;
  ok(near(far, Math.hypot(60, 9), 0.01), `travel: the farthest corner from the stair, in a straight line (${far.toFixed(1)} m)`);
  const slab = sc({ ...proj(base), scheme: { buildings: [{ id: 'b', spine: [0, 25, 1, 25], depth: 20, floors: 10, form: boxForm(90, 14, 10) }], elements: [] } } as ProProject).find((c) => c.key === 'travel:0');
  ok(!!slab, `a 90 m slab's travel: ${slab?.status}, ${slab?.proposed}`);
  // the rest of the rows: lifts and refuge floors by height, light and rooms by building, and the DP zone
  const tall = sc({ ...proj(base), scheme: { buildings: [{ id: 'b', spine: [0, 25, 1, 25], depth: 20, floors: 16, form: boxForm(30, 20, 16) }], elements: [] } } as ProProject);
  const lifts = tall.find((c) => c.key === 'lifts:0'), refuge = tall.find((c) => c.key === 'refuge:0');
  ok(!!lifts && /^2 /.test(lifts.required) && lifts.status === 'pass', `a tall tower's lifts: ${lifts?.required}, ${lifts?.proposed} (${lifts?.status})`);
  ok(!!refuge && refuge.status === 'pass', `and its refuge floors: ${refuge?.required} needed, ${refuge?.proposed} (${refuge?.status})`);
  ok(!tall.some((c) => /^sys:(lifts|refuge)/.test(c.key)), "the systems' own lift and refuge checks give way to the rows");
  const zoneOf = (q: ProProject) => sc(q).find((c) => c.key === 'zone:0');
  const zi = zoneOf({ ...proj(base), zone: 'I' } as ProProject);
  ok(zi?.status === 'fail', `homes in an industrial zone: ${zi?.status} (${zi?.proposed})`);
  ok(zoneOf({ ...proj(base), zone: 'R2' } as ProProject)?.status === 'pass', 'homes in R2: pass');
  const zo = zoneOf({ ...proj({ ...base, uses: [{ use: 'office', floors: 10 }] } as Form), zone: 'R1' } as ProProject);
  ok(zo?.status === 'warn', `offices in R1: ${zo?.status} (${zo?.proposed})`);
  const noZone = homes.find((c) => c.key === 'zone');
  ok(noZone?.status === 'info' && !homes.some((c) => c.key === 'zone:0'), 'no zone said: an info line, no row');
  const lt = homes.find((c) => c.key === 'light:0'), rm = homes.find((c) => c.key === 'rooms:0');
  ok(!!lt && !homes.some((c) => c.key === 'light'), `light and ventilation by building: ${lt?.proposed} (${lt?.status})`);
  ok(rm?.status === 'warn' && rm.proposed === 'rooms not laid out', 'room sizes by building: rooms not laid out, without rooms');
}

// step 8: templates as parts and uses
{
  const off = TEMPLATES.find((t) => t.id === 'office')!.make([0, 0], [1, 0])[0].form;
  const Lo = lay(off, 30);
  ok(off.carves.some((c) => c.name === 'Podium' && c.op === 'add' && c.lo === 1 && c.hi === 2) && !off.keys.length, 'Office on shops: its podium is a part added on floors 1–2, the tower a plain plate');
  ok(Lo.floors[0].area > Lo.floors[2].area * 1.8 && near(Lo.floors[0].area, 48 * 36, 30), `the podium is wider than the tower (${Math.round(Lo.floors[0].area)} vs ${Math.round(Lo.floors[2].area)} m²)`);
  ok(TEMPLATES.every((t) => t.make([0, 0], [1, 0]).every((m) => m.form.carves.every((c) => !!c.name))), 'every template part has a name');
  const proj = (use: ProProject['use']): ProProject => ({ ...DEFAULT_PROJECT, use, scheme: { buildings: [], elements: [] } } as ProProject);
  const at = (p: ProProject) => { const e = evaluate(p); return placeTemplate('twist', [e.r.footprint[0] ?? 0, e.r.footprint[1] ?? 0], e)[0]?.form?.uses.map((u) => u.use) ?? []; };
  const uh = at(proj('residential')), uo = at(proj('commercial')), un = at(proj('none'));
  ok(uh.every((u) => u === 'residential') && uo.length > 0 && uo.every((u) => u === 'office') && un.every((u) => u === 'none'), `a tower template takes the project's use (homes: ${uh}; offices: ${uo}; no use: ${un})`);
  const e = evaluate(proj('commercial')), lib = placeTemplate('library', [e.r.footprint[0], e.r.footprint[1]], e)[0];
  ok(!!lib && lib.form!.uses.every((u) => u.use === 'library'), 'a public template keeps its own use');
}

console.log(bad ? `${bad} FAILED` : 'ALL OK');
if (bad) process.exitCode = 1;
