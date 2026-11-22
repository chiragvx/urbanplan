// The architect's floor (src/pro/floor.ts): flat sizes reach the layout, the typical floor and inventory add up, and a
// straight building's length is fitted to a number of flats a floor.
import { DEFAULT_PROJECT, type ProProject } from '../../src/pro/project';
import { evaluate } from '../../src/pro/evaluate';
import { own, stretched } from '../../src/pro/edit';
import { fitLength, fittable, inventory, typicalOf } from '../../src/pro/floor';

let bad = 0;
const ok = (c: boolean, s: string) => { if (!c) bad++; console.log(`${c ? 'ok  ' : 'FAIL'} ${s}`); };
const avg2 = (p: ProProject) => { const e = evaluate(p); const ls = e.d.buildings.flatMap((b) => typicalOf(b).types).filter((x) => x.t === 1); return ls.length ? ls.reduce((s, x) => s + x.carpet, 0) / ls.length : 0; };

const p0: ProProject = { ...DEFAULT_PROJECT, typology: 'slab', scheme: undefined, mix: [0, 1, 0] };
const a = avg2(p0), b = avg2({ ...p0, sizes: [42, 120, 95] });
ok(a > 0 && b > a * 1.15, `bigger 2 BHKs asked for, bigger laid: ${a.toFixed(1)} → ${b.toFixed(1)} m² carpet`);

const e0 = evaluate(p0), inv = inventory(e0);
ok(inv.reduce((s, x) => s + x.n, 0) === e0.d.flats, `the inventory counts every flat (${e0.d.flats})`);
ok(Math.abs(inv.reduce((s, x) => s + x.carpet, 0) - e0.d.carpet) / Math.max(1, e0.d.carpet) < 0.01, 'and all their carpet');

const s = own(p0, e0), st = s.buildings.find(fittable);
ok(!!st, 'the slab scheme has a straight building');
if (st) {
  const p1: ProProject = { ...p0, scheme: s }, e1 = evaluate(p1), br = e1.d.buildings.find((x) => x.b.id === st.id)!;
  const now = typicalOf(br).flats, want = now + 2, fit = fitLength(p1, e1, st.id, want);
  // (flats come in steps: a lobby floor's 4 become a corridor floor's 8, so the shortest length that holds the target)
  ok(!!fit && fit.got >= want, `fitted to at least ${want} flats a floor: ${fit?.len} m, ${fit?.got} flats`);
  if (fit) {
    const s1 = own(p1, e1), q = { ...p1, scheme: { ...s1, buildings: s1.buildings.map((x) => (x.id === st.id ? stretched(x, fit.len - 1) : x)) } };
    const under = typicalOf(evaluate(q).d.buildings.find((x) => x.b.id === st.id)!).flats;
    ok(under < want, `a metre shorter holds fewer (${under}): the shortest that fits`);
  }
  const less = fitLength(p1, e1, st.id, Math.max(1, now - 2));
  ok(!!less && !!fit && less.len < fit.len, 'fewer flats a floor, a shorter building');
}
console.log(bad ? `${bad} FAILED` : 'ALL OK');
if (bad) process.exit(1);
