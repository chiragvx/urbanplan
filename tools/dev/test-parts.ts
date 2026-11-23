// A form's parts (docs/plans/pro-design-freedom.md step 3): add, cut and keep act on the floors they span, in order;
// a part switched off does nothing; older forms' carves are cuts.
import { boxForm, layForm, type Carve, type Form } from '../../src/pro/form';
import { newPart, pushEdge, tOfFloor, floorOfT } from '../../src/pro/parts';

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

console.log(bad ? `${bad} FAILED` : 'ALL OK');
if (bad) process.exitCode = 1;
