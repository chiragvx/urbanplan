// A form's parts (docs/plans/pro-design-freedom.md step 3): add, cut and keep act on the floors they span, in order;
// a part switched off does nothing; older forms' carves are cuts.
import { boxForm, layForm, type Carve, type Form } from '../../src/pro/form';
import { newPart, pushEdge, tOfFloor, floorOfT } from '../../src/pro/parts';
import { DEFAULT_PROJECT, type ProProject } from '../../src/pro/project';
import { evaluate } from '../../src/pro/evaluate';

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

console.log(bad ? `${bad} FAILED` : 'ALL OK');
if (bad) process.exitCode = 1;
