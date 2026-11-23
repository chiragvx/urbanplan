// Floors planned by hand (src/pro/floorEdit.ts, form/types.ts FloorPlanEdit): a plan starts as the floor's own units
// and changes nothing until it's edited; corners shared by two units move together; split, merge, use and type; the
// units are cut to the floor and clear of the cores; laying it out again gives the planner's units back.
import { boxForm, layForm, type Form } from '../../src/pro/form';
import { dropPlan, mergeUnits, moveVertex, pushWall, removeUnit, runOf, setRange, setUnit, splitUnit, startPlan } from '../../src/pro/floorEdit';
import { DEFAULT_PROJECT, type ProProject } from '../../src/pro/project';
import { evaluate } from '../../src/pro/evaluate';

let bad = 0;
const ok = (c: boolean, s: string) => { if (!c) bad++; console.log(`${c ? 'ok  ' : 'FAIL'} ${s}`); };
const ctx = { floorH: 3, mix: [0.3, 0.5, 0.2] as [number, number, number], sizes: [30, 45, 65] as [number, number, number] };
const B = (f: Form) => ({ id: 't', spine: [0, 0, 1, 0], depth: 20, floors: 10, form: f });
const lay = (f: Form) => layForm(B(f) as never, ctx)!;
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

const base = boxForm(36, 20, 10);
const L0 = lay(base);
const [lo, hi] = runOf(L0, 5);
ok(lo <= 5 && hi >= 5 && hi - lo >= 3, `floor 5 shares its units with floors ${lo}–${hi}`);
const f1 = startPlan(base, B(base), L0, 5);
const p = f1.floorPlans![0];
ok(p.lo === lo && p.hi === hi && p.units.length === L0.floors[4].units.length, `a plan starts as floor 5's ${p.units.length} units, on floors ${p.lo}–${p.hi}`);
const L1 = lay(f1);
ok(near(L1.floors[4].carpet, L0.floors[4].carpet, 0.5) && L1.floors[4].units.length === L0.floors[4].units.length, `and changes nothing until edited (carpet ${L0.floors[4].carpet.toFixed(1)} → ${L1.floors[4].carpet.toFixed(1)} m²)`);

// a shared corner: find a corner two units have, move it, both move
const us = p.units;
let shared: { a: string; b: string; i: number; x: number; z: number } | null = null;
for (const a of us) for (let k = 0; k < a.ring.length && !shared; k += 2) for (const b of us) if (b !== a && !shared) for (let q = 0; q < b.ring.length; q += 2) if (Math.hypot(a.ring[k] - b.ring[q], a.ring[k + 1] - b.ring[q + 1]) < 0.05) shared = { a: a.id, b: b.id, i: k / 2, x: a.ring[k], z: a.ring[k + 1] };
ok(!!shared, 'two units share a corner (a party wall)');
if (shared) {
  const f2 = moveVertex(f1, p.id, shared.a, shared.i, shared.x + 1, shared.z);
  const ub = f2.floorPlans![0].units.find((u) => u.id === shared!.b)!;
  ok(ub.ring.some((v, k) => k % 2 === 0 && near(v, shared!.x + 1, 0.01)), 'moving it moves the other unit\'s corner too');
}

// split, merge, remove, use
const big = us.reduce((a, u) => (u.ring.length >= a.ring.length ? u : a));
const f3 = splitUnit(f1, p.id, big.id);
ok(f3.floorPlans![0].units.length === us.length + 1, `a unit split in two: ${us.length} → ${f3.floorPlans![0].units.length}`);
const halves = f3.floorPlans![0].units.filter((u) => u.id === big.id || !us.some((o) => o.id === u.id));
const f4 = mergeUnits(f3, p.id, halves[0].id, halves[1].id);
ok(!!f4 && f4.floorPlans![0].units.length === us.length, 'and merged back into one');
const f5 = removeUnit(f1, p.id, us[0].id);
ok(lay(f5).floors[4].units.length === us.length - 1, 'a unit taken away is gone from the floor');
const f6 = setUnit(f1, p.id, us[0].id, 'retail');
ok(lay(f6).floors[4].units.some((u) => u.kind === 'retail'), 'a unit made a shop counts as one');
ok(lay(f1).floors[0].units.length === L0.floors[0].units.length && (lo > 1 ? JSON.stringify(lay(f6).floors[lo - 2].units) === JSON.stringify(L0.floors[lo - 2].units) : true), 'floors outside the plan keep the planner\'s units');

// pushing a wall out past the floor: the unit is cut to the floor
const outer = us.find((u) => u.ring.some((v, k) => k % 2 === 1 && v > 9.5)) ?? us[0];
let wi = 0; for (let k = 0; k < outer.ring.length / 2; k++) { const q = (k + 1) % (outer.ring.length / 2); if (outer.ring[k * 2 + 1] > 9.5 && outer.ring[q * 2 + 1] > 9.5) wi = k; }
const f7 = pushWall(f1, p.id, outer.id, wi, 5);
ok(near(lay(f7).floors[4].area, L0.floors[4].area, 0.5) && lay(f7).floors[4].carpet <= L0.floors[4].carpet + 0.5, 'a wall pushed past the floor\'s edge is cut to it');

// two units drawn over each other: the overlap counts once (the first keeps it)
const u0 = us[0], f10 = { ...f1, floorPlans: [{ ...p, units: [...p.units, { id: 'dup', ring: u0.ring.slice() }] }] };
ok(near(lay(f10).floors[4].carpet, L1.floors[4].carpet, 0.5), `a unit drawn over another adds no area (${L1.floors[4].carpet.toFixed(1)} → ${lay(f10).floors[4].carpet.toFixed(1)} m²)`);
ok(lay(f1).floors[4].units.every((x, k) => x.hand === p.units[k].id), 'each laid unit names the hand unit it comes from');

// range and laying out again
const f8 = setRange(f1, p.id, 2, 3, 10);
ok(f8.floorPlans![0].lo === 2 && f8.floorPlans![0].hi === 3, 'the plan\'s floors can be set');
const f8b = setRange(f1, p.id, 5, 5, 10), L8 = lay(f8b);
ok(L8.floors.every((fl, k) => k === 4 || JSON.stringify(fl.units) === JSON.stringify(L0.floors[k].units)), 'a plan on one floor leaves the floors above and below as they were');
const f9 = dropPlan(f6, p.id);
ok(!f9.floorPlans && JSON.stringify(lay(f9).floors[4].units) === JSON.stringify(L0.floors[4].units), 'laid out again: the planner\'s units back');

// the engine: a shop made by hand is counted and parked as a shop
const proj = (f: Form): ProProject => ({ ...DEFAULT_PROJECT, scheme: { buildings: [{ id: 'b', spine: [0, 25, 1, 25], depth: 20, floors: 10, form: f }], elements: [] } } as ProProject);
const e0 = evaluate(proj(base));
const Lb = e0.forms['b']!, fb = startPlan(base, { spine: [0, 25, 1, 25] }, Lb, 5);
const pb = fb.floorPlans![0];
const e1 = evaluate(proj(setUnit(fb, pb.id, pb.units[0].id, 'retail')));
ok(e1.d.money.uses.some((u) => u.use === 'retail' && u.units > 0), `the money counts the hand-made shop (${e1.d.money.uses.map((u) => `${u.use} ${u.units}`).join(', ')})`);

console.log(bad ? `${bad} FAILED` : 'ALL OK');
if (bad) process.exitCode = 1;
