// Lists flyover touchdowns (merge joints) and junctions a deck carries on over, with the room there.
import fs from 'node:fs';
import { parseTile } from '../../src/data/tile';
import { Heightfield } from '../../src/geo/heightfield';
import { buildBase } from '../../src/doc/base';
import { CityDoc } from '../../src/doc/doc';
import { Compiler } from '../../src/doc/compile';
import { newMeta } from '../../src/doc/format';
const dir = 'public/tiles/kp/';
const hdr = JSON.parse(fs.readFileSync(dir + 'tile.json', 'utf8'));
const buf = fs.readFileSync(dir + 'tile.bin');
const tile = parseTile(hdr, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const net = JSON.parse(fs.readFileSync(dir + 'network.json', 'utf8'));
const hf = new Heightfield(tile.terrain.n, tile.terrain.cell, tile.terrain.heights);
const doc = new CityDoc(buildBase(net, tile, null), newMeta('kp', '', ''));
const t0 = Date.now();
const C = new Compiler(doc, hf); C.full();
const M = C.mesher as any;
console.log('build ms', Date.now() - t0);
for (const [id, k] of M.kinds) {
  const n = M.nodes.get(id);
  const E = M.ends.get(id) ?? [];
  const room = E.map((e: any) => M.endRoom(e.g, e.atA)).filter((r: number) => r > 0.05);
  if (k === 'merge' || room.length) console.log(k, id, Math.round(n.x), Math.round(n.z), 'arms', E.length, 'room', room.map((r: number) => r.toFixed(1)).join(','), E.map((e: any) => e.g.s.name?.slice(0, 20)).join(' / '));
}
