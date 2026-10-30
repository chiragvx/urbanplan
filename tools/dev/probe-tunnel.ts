// Builds a tunnel on a section and reports its pieces: depth, open/covered, stamps, wall heights vs terrain.
import fs from 'node:fs';
import { parseTile } from '../../src/data/tile';
import { Heightfield } from '../../src/geo/heightfield';
import { buildBase } from '../../src/doc/base';
import { CityDoc } from '../../src/doc/doc';
import { Compiler } from '../../src/doc/compile';
import { newMeta } from '../../src/doc/format';
import * as O from '../../src/doc/ops';
const sid = process.argv[2] ?? 's1htgutip0ya';
const dir = 'public/tiles/kp/';
const hdr = JSON.parse(fs.readFileSync(dir + 'tile.json', 'utf8'));
const buf = fs.readFileSync(dir + 'tile.bin');
const tile = parseTile(hdr, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const net = JSON.parse(fs.readFileSync(dir + 'network.json', 'utf8'));
const hf = new Heightfield(tile.terrain.n, tile.terrain.cell, tile.terrain.heights);
const doc = new CityDoc(buildBase(net, tile, null), newMeta('kp', '', ''));
const C = new Compiler(doc, hf); C.full();
doc.on((c) => { C.update(c.ids); });
const r = doc.transact('t', () => O.elevate(doc, [sid], O.TUNNEL_DEPTH, 0.05));
console.log('elevate', JSON.stringify(r), 'lifts', O.anchorsOf(doc, doc.get<'section'>(sid)!).map((a) => a.lift).join(','));
const M = C.mesher as any;
for (const it of M.items.values()) {
  if (!it.key.startsWith(`s:${sid}~`)) continue;
  const g = M.geos.get(it.key.slice(2));
  const conc = it.layers.concrete?.pos ?? [];
  let top = -1e9; for (let i = 1; i < conc.length; i += 3) top = Math.max(top, conc[i]);
  const asp = it.layers.asphalt?.pos ?? [];
  let lo = 1e9; for (let i = 1; i < asp.length; i += 3) lo = Math.min(lo, asp[i]);
  const mx = g.pts[Math.floor(g.pts.length / 4) * 2], mz = g.pts[Math.floor(g.pts.length / 4) * 2 + 1];
  console.log(it.key, 'sunk', g.s.sunk, 'len', g.len.toFixed(0), 'stamps', it.stamps.length, it.stamps.map((s: any) => (s.carve ? 'carve' : 'nocarve') + (s.z ? ' z' + s.z[0].toFixed(1) : '')).join(';'), 'asphalt min y', lo.toFixed(1), 'concrete max y', top.toFixed(1), 'terrain', hf.sample(mx, mz).toFixed(1), 'tris', (it.layers.asphalt?.idx.length ?? 0) / 3);
}
for (const it of M.items.values()) {
  if (!it.key.startsWith(`s:${sid}~`)) continue;
  for (const st of it.stamps) if (st.line) {
    const p = st.line, m = p.length / 2;
    console.log(it.key, st.hole ? 'HOLE' : st.carve ? 'carve' : 'none', 'pts', m, 'from', p[0].toFixed(1), p[1].toFixed(1), 'to', p[p.length - 2].toFixed(1), p[p.length - 1].toFixed(1), 'hw', st.hw?.toFixed(1));
  }
}
