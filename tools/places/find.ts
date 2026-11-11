// Where named roads are, and where two of them meet — to place a junction or a road's centre.
//   node tools/dev/places-find.mjs pune "Ganeshkhind Road" ["Baner Road"]
import { openRegion } from './region';

const [id, a, b] = process.argv.slice(2);
const R = openRegion(id);
const A = new RegExp(a, 'i'), B = b ? new RegExp(b, 'i') : null;
const ends = new Map<string, Set<string>>();
const seen = new Set<string>();
const pts: [number, number, string][] = [];
const J = new Map<string, [number, number]>();
for (const [i, j] of R.M.pieces) {
  const p = R.piece(i, j)!;
  for (const o of p.objs) {
    if (o.kind === 'junction') J.set(o.id, [o.x, o.z]);
    if (o.kind !== 'section' || seen.has(o.id)) continue;
    seen.add(o.id);
    const tag = A.test(o.name) ? 'A' : B?.test(o.name) ? 'B' : '';
    if (!tag) continue;
    for (const e of [o.a, o.b]) (ends.get(e) ?? ends.set(e, new Set()).get(e)!).add(tag + ':' + o.name);
    pts.push([o.path[0].x, o.path[0].z, tag + ':' + o.name]);
  }
}
const by = new Map<string, number[][]>();
for (const [x, z, n] of pts) (by.get(n) ?? by.set(n, []).get(n)!).push([x, z]);
for (const [n, l] of by) {
  const xs = l.map((q) => q[0]).sort((p, q) => p - q), zs = l.map((q) => q[1]).sort((p, q) => p - q);
  const [la, lo] = R.ll(xs[xs.length >> 1], zs[zs.length >> 1]);
  console.log(`${n}: ${l.length} sections, median ${la.toFixed(5)},${lo.toFixed(5)}  x ${xs[0].toFixed(0)}..${xs[xs.length - 1].toFixed(0)} z ${zs[0].toFixed(0)}..${zs[zs.length - 1].toFixed(0)}`);
}
if (B) for (const [jid, s] of ends) {
  const t = [...s];
  if (t.some((q) => q[0] === 'A') && t.some((q) => q[0] === 'B') && J.has(jid)) { const [la, lo] = R.ll(...J.get(jid)!); console.log(`meet ${la.toFixed(5)},${lo.toFixed(5)}  ${t.join(' / ')}`); }
}
