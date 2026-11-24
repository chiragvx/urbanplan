// Design (docs/plans/pro-design-freedom.md §3.6, src/pro/masses.ts): shapes and drawn footprints land as forms in the
// project's use, kept to the rules; and floors are made from the form: its height and the floor-to-floor height.
import { layForm, type Form } from '../../src/pro/form';
import { drawnPlan, floorHOf, floorsFor, massForm, shapePlan, startFloors, withFloorH, MASS_SHAPES } from '../../src/pro/masses';
import { placeMass } from '../../src/pro/edit';
import { combine, copiedPart, drawnPart, mirroredPart, movedPart, shapePart, turnedPart } from '../../src/pro/parts';
import { DEFAULT_PROJECT, type ProProject } from '../../src/pro/project';
import { evaluate } from '../../src/pro/evaluate';

let bad = 0;
const ok = (c: boolean, s: string) => { if (!c) bad++; console.log(`${c ? 'ok  ' : 'FAIL'} ${s}`); };
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;
const ctx = { floorH: 3, mix: [0.3, 0.5, 0.2] as [number, number, number], sizes: [42, 65, 95] as [number, number, number] };
const lay = (f: Form) => layForm({ id: 't', spine: [0, 0, 1, 0], depth: 20, floors: f.uses.reduce((s, u) => s + u.floors, 0), form: f } as never, ctx)!;
const area = (f: Form, k = 0) => lay(f).floors[k].area;

// footprints drawn
const u: [number, number] = [1, 0];
const rect = drawnPlan('rect', [10, 10, 40, 10, 40, 30, 10, 30], u)!;
ok(!!rect && near(rect.o[0], 25, 0.01) && near(rect.o[1], 20, 0.01) && near(area(massForm(rect.plan, [], 4, 'office')), 600, 2), `a rectangle dragged 30 × 20 m: ${Math.round(area(massForm(rect.plan, [], 4, 'office')))} m² a floor, about its middle`);
const circ = drawnPlan('circle', [0, 0, 24, 0, 24, 24, 0, 24], u)!;
ok(near(area(massForm(circ.plan, [], 4, 'office')), Math.PI * 144, 12), `a circle dragged 24 m across: ${Math.round(area(massForm(circ.plan, [], 4, 'office')))} m² (π·12² = 452)`);
const poly = drawnPlan('poly', [0, 0, 30, 0, 30, 10, 10, 10, 10, 30, 0, 30], u)!;
ok(near(area(massForm(poly.plan, [], 4, 'office')), 30 * 10 + 10 * 20, 3), `a polygon clicked as an L: ${Math.round(area(massForm(poly.plan, [], 4, 'office')))} m² (500)`);
const cw = drawnPlan('poly', [0, 30, 10, 30, 10, 10, 30, 10, 30, 0, 0, 0], u)!;
ok(near(area(massForm(cw.plan, [], 4, 'office')), 500, 3), 'and the same clicked the other way round');
ok(drawnPlan('rect', [0, 0, 2, 0, 2, 2, 0, 2], u) === null, 'a footprint under 3 m is too small');
const along = drawnPlan('rect', [0, 0, 30, 30, 20, 40, -10, 10], [Math.SQRT1_2, Math.SQRT1_2])!;
ok(near(area(massForm(along.plan, [], 4, 'office')), Math.hypot(30, 30) * Math.hypot(10, 10), 3), 'a rectangle drawn along a turned road keeps its size in that frame');

// shapes
for (const s of MASS_SHAPES) { const { plan, carves } = shapePlan(s.shape), L = lay(massForm(plan, carves, 6, 'residential')); ok(L.floors.length === 6 && L.floors[0].area > 150, `${s.label}: ${Math.round(L.floors[0].area)} m² a floor`); }
const court = shapePlan('court');
ok(court.carves.length === 1 && court.carves[0].name === 'Court' && near(area(massForm(court.plan, court.carves, 4, 'office')), 36 * 28 - 12 * 8, 3), 'Courtyard: the court is a part cut through it');
ok(startFloors(shapePlan('box').plan) === 10 && startFloors(shapePlan('round').plan) === 12, `starting floors about as tall as it is wide (box ${startFloors(shapePlan('box').plan)}, round ${startFloors(shapePlan('round').plan)})`);

// placed: the project's use, kept to the rules
const proj = (use: ProProject['use']): ProProject => ({ ...DEFAULT_PROJECT, use, scheme: { buildings: [], elements: [] } } as ProProject);
for (const [use, want] of [['residential', 'residential'], ['commercial', 'office'], ['none', 'none']] as const) {
  const p = proj(use), e = evaluate(p), b = placeMass('box', [e.r.footprint[0], e.r.footprint[1]], p, e, 0);
  ok(!!b?.form && b.form.uses.every((x) => x.use === want), `a box on a ${use} project is ${want}`);
}
{
  const p = proj('residential'), e = evaluate(p), b = placeMass('box', [e.r.footprint[0], e.r.footprint[1]], p, e, 0)!;
  const e2 = evaluate({ ...p, scheme: { buildings: [b], elements: [] } });
  ok(e2.d.buildings[0].height <= e.r.rules.maxH + 0.01, `kept to the height limit (${e2.d.buildings[0].height.toFixed(1)} of ${e.r.rules.maxH} m)`);
}

// floors from the form
const f0 = massForm(shapePlan('box').plan, [], 10, 'office');
const f1 = withFloorH(f0, 4.5);
ok(floorHOf(f1) === 4.5 && near(lay(f1).floors[1].y - lay(f1).floors[0].y, 4.5, 0.01), 'a floor-to-floor height for every floor');
const f2 = withFloorH({ ...f1, levels: [...(f1.levels ?? []), { from: 1, to: 1, h: 6 }] }, 3.6);
ok(f2.levels!.length === 2 && near(lay(f2).floors[1].y, 6, 0.01) && near(lay(f2).floors[2].y - lay(f2).floors[1].y, 3.6, 0.01), 'a range set apart keeps its own height over it');
ok(withFloorH(f1, undefined).levels === undefined, 'and By use takes it away');
ok(floorsFor(45, 30, 10) === 15 && floorsFor(10, 30, 10) === 3, 'a height makes floors at the floors as they average');

// CAD booleans: a round cut out of a box, and the other three
{
  const box = massForm(shapePlan('box').plan, [], 6, 'office'); // 30 × 20
  const at = (op: 'add' | 'cut' | 'keep' | 'xor') => ({ ...box, carves: [shapePart(box, 'round', op, [0, 0])] }); // a 24 m round at its middle
  const A = (f: Form) => lay(f).floors[2].area, R = Math.PI * 144, I = (() => { const L = lay({ ...box, carves: [{ ...shapePart(box, 'round', 'keep', [0, 0]) }] }); return L.floors[2].area; })();
  ok(near(A(at('cut')), 600 - I, 3), `Cut: a 24 m round out of a 30 × 20 box leaves ${Math.round(A(at('cut')))} m² (600 − the overlap ${Math.round(I)})`);
  ok(near(A(at('add')), 600 + R - I, 4), `Add: ${Math.round(A(at('add')))} m² (600 + 452 − ${Math.round(I)})`);
  ok(near(A(at('keep')), I, 1) && I < 600 && I < R, `Intersect: only the overlap, ${Math.round(I)} m²`);
  ok(near(A(at('xor')), 600 + R - 2 * I, 4), `Exclude: both but the overlap, ${Math.round(A(at('xor')))} m² (600 + 452 − 2 × ${Math.round(I)})`);
  const c = shapePart(box, 'round', 'cut');
  ok(lay({ ...box, carves: [c] }).floors[0].area < 600 && lay({ ...box, carves: [c] }).floors[0].area > 300, 'a part from the Parts list sits at the middle, sized to the plan');
  ok(c.lo === 1 && c.hi === 6 && c.name === 'Cut · Round', 'all its floors up, named for what it does and its shape');
  // drawn into a building: a circle dragged in world terms lands in the building's frame
  const b = { spine: [100, 50, 101, 50] };
  const d = drawnPart(box, b, 'circle', [95, 45, 105, 45, 105, 55, 95, 55], 'cut')!;
  ok(!!d && near(lay({ ...box, carves: [d] }).floors[0].area, 600 - Math.PI * 25, 3), `a circle drawn on the building cuts ${Math.round(600 - lay({ ...box, carves: [d] }).floors[0].area)} m² (π·5² = 79)`);
  // moved, turned, mirrored, copied
  const m = movedPart(c, 3, -2), bx = (r: typeof c) => r.ring.pts.reduce((s, q) => s + q[0], 0) / r.ring.pts.length;
  ok(near(bx(m) - bx(c), 3, 0.01), 'a part moved');
  const w = shapePart(box, 'box', 'cut', [10, 5]), t = turnedPart(w, 90);
  ok(near(lay({ ...box, carves: [t] }).floors[0].area, lay({ ...box, carves: [w] }).floors[0].area, 30) && JSON.stringify(t.ring) !== JSON.stringify(w.ring), 'a part turned about its middle');
  const sm = { ...w, ring: { pts: [[8, 2], [12, 2], [12, 6], [8, 6]] as [number, number][] } }, mr = mirroredPart(box, sm, 'x');
  ok(near(bx(mr), -bx(sm), 0.01) && mr.id !== sm.id && near(lay({ ...box, carves: [sm, mr] }).floors[0].area, 600 - 32, 1), 'a mirrored copy across the middle cuts the same on the other side');
  ok(copiedPart(w).id !== w.id, 'a copy is a part of its own');
}
// Combine: two buildings made one
{
  const A0 = { id: 'a', name: 'Building A', spine: [0, 0, 1, 0], depth: 20, floors: 7, form: massForm(shapePlan('box').plan, [], 7, 'residential') };
  const B0 = { id: 'b', name: 'Building B', spine: [15, 0, 16, 0], depth: 24, floors: 8, form: massForm(shapePlan('round').plan, [], 8, 'residential') }; // a round centred on A's right edge
  const cut = combine(A0 as never, B0 as never, 'cut')!;
  const La = (b: { form?: Form; floors: number }) => layForm({ id: 'x', spine: (b as { spine: number[] }).spine, depth: 20, floors: b.floors, form: b.form } as never, ctx)!;
  ok(!!cut && cut.b.form!.carves.length === 1 && cut.b.form!.carves[0].op === 'cut' && cut.b.floors === 7, 'Cut: the round becomes a cut part of the box; the box keeps its 7 floors');
  ok(near(La(cut.b).floors[3].area, 600 - Math.PI * 144 / 2 * (10 / 12) , 60) && La(cut.b).floors[3].area < 600 - 150, `and its floors lose the overlap (${Math.round(La(cut.b).floors[3].area)} m²)`);
  const add = combine(A0 as never, B0 as never, 'add')!;
  ok(add.b.floors === 8 && La(add.b).floors[7].area > 300, `Add: as tall as the taller (${add.b.floors} floors), the round on top too`);
  const keep = combine(A0 as never, B0 as never, 'keep')!;
  ok(keep.b.floors === 7 && La(keep.b).floors[0].area < 300, `Intersect: only the overlap (${Math.round(La(keep.b).floors[0].area)} m²)`);
  const xo = combine(A0 as never, B0 as never, 'xor')!;
  ok(xo.b.floors === 8 && xo.b.form!.carves.length === 2 && xo.b.form!.carves[1].op === 'add', 'Exclude: the overlap out on the floors both have, the round alone above');
  const twisted = { ...B0, form: { ...B0.form, keys: [{ t: 1, sx: 1, sz: 1, dx: 0, dz: 0, rot: 45 }] } };
  ok(combine(A0 as never, twisted as never, 'cut')!.lost.length === 1, "what a part can't carry (a twist) is said");
}

console.log(bad ? `${bad} FAILED` : 'ALL OK');
if (bad) process.exitCode = 1;
