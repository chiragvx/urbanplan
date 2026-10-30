import fs from 'node:fs';
import { parseTile } from '../../src/data/tile';
import { Heightfield } from '../../src/geo/heightfield';
import { buildBase } from '../../src/doc/base';
import { CityDoc } from '../../src/doc/doc';
import { Compiler } from '../../src/doc/compile';
import { newMeta } from '../../src/doc/format';
import { totalWidth } from '../../src/doc/xsection';
const X = +(process.argv[2] ?? -813), Z = +(process.argv[3] ?? -1342), R = +(process.argv[4] ?? 80);
const dir = 'public/tiles/kp/';
const hdr = JSON.parse(fs.readFileSync(dir + 'tile.json', 'utf8'));
const buf = fs.readFileSync(dir + 'tile.bin');
const tile = parseTile(hdr, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const net = JSON.parse(fs.readFileSync(dir + 'network.json', 'utf8'));
const hf = new Heightfield(tile.terrain.n, tile.terrain.cell, tile.terrain.heights);
const doc = new CityDoc(buildBase(net, tile, null), newMeta('kp', '', ''));
const C = new Compiler(doc, hf); C.full();
const M = C.mesher as any;
for (const j of doc.all('junction')) {
  if (Math.hypot(j.x - X, j.z - Z) > R) continue;
  const kind = M.kinds.get(j.id);
  console.log(`J ${j.id} @${Math.round(j.x - X)},${Math.round(j.z - Z)} lift ${j.lift} kind ${kind} merge ${M.mergeW.get(j.id) ?? ''}`);
  for (const s of doc.sectionsAt(j.id)) {
    const P = s.path, far = s.a === j.id ? P[P.length - 1] : P[0], near2 = s.a === j.id ? P[1] : P[P.length - 2];
    const ang = Math.round(Math.atan2(near2.z - j.z, near2.x - j.x) * 180 / Math.PI);
    console.log(`   ${s.id} ${s.name || '-'} ${s.cls} w${totalWidth(s.parts)} ${s.elevated ? 'ELEV' : 'ground'} dir ${ang}° lifts ${P.map((p) => p.lift).join('/')} to @${Math.round(far.x - X)},${Math.round(far.z - Z)} parts ${s.parts.map((p) => p.kind[0] + p.width + (p.dir === 1 ? '>' : p.dir === -1 ? '<' : '')).join(' ')}`);
  }
}
// deck room on ground pieces near
for (const g of M.geos.values()) {
  if (g.s.elevated) continue;
  const mx = g.pts[Math.floor(g.pts.length / 4) * 2], mz = g.pts[Math.floor(g.pts.length / 4) * 2 + 1];
  if (Math.hypot(mx - X, mz - Z) > R) continue;
  const d = M.deckRoom(g);
  if (d) console.log(`room on ${g.s.owner}: max ${d.max.toFixed(1)} e(0)=${d.e(0).toFixed(1)} e(len)=${d.e(g.len).toFixed(1)} gap(0)=${d.gap(0).toFixed(1)} gap(len)=${d.gap(g.len).toFixed(1)} len ${g.len.toFixed(0)}`);
}
// cross-section edges at both ends of the pieces of the roads at the node (left / right outer edge, metres)
import { profileOf, profileOffsets } from '../../src/net/generate';
const ev = (o: unknown, s: number) => (typeof o === 'number' ? o : (o as (s: number) => number)(s));
for (const g of M.geos.values()) {
  if (g.s.elevated) continue;
  const near = [0, g.pts.length - 2].some((i) => Math.hypot(g.pts[i] - X, g.pts[i + 1] - Z) < 40);
  if (!near) continue;
  const P = profileOf(g, M.deckRoom(g)), O = profileOffsets(P);
  const at = (s: number) => `L ${ev(O[0][0], s).toFixed(2)} R ${ev(O[O.length - 1][1], s).toFixed(2)}`;
  console.log(`piece ${g.s.id} (${g.s.owner}) len ${g.len.toFixed(1)} trim ${g.trimA.toFixed(1)}/${g.trimB.toFixed(1)} a=${g.s.a} [${M.kinds.get(g.s.a)}] ${at(0)} | ${at(g.trimA)} … ${at(g.len - g.trimB)} | ${at(g.len)} b=${g.s.b} [${M.kinds.get(g.s.b)}] La ${P.La.toFixed(1)} Lb ${P.Lb.toFixed(1)}`);
}
for (const g of M.geos.values()) {
  if (g.s.owner !== 'sbkgr9xl66g') continue;
  const k = g.pts.length - 2;
  const f = (i: number) => `p(${(g.pts[i] - X).toFixed(2)},${(g.pts[i + 1] - Z).toFixed(2)}) n(${g.nrm[i].toFixed(3)},${g.nrm[i + 1].toFixed(3)}) n0`;
  console.log(`ends ${g.s.id}: A ${f(0)}(${g.n0[0].toFixed(3)},${g.n0[1].toFixed(3)}) B ${f(k)}(${g.n0[2].toFixed(3)},${g.n0[3].toFixed(3)}) pts ${g.pts.length / 2}`);
}
