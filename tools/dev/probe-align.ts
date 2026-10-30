// Our centre line vs the OSM ways it came from, sampled along the sections in a box (divided road: midline of halves).
import fs from 'node:fs';
import { parseTile } from '../../src/data/tile';
import { buildBase } from '../../src/doc/base';
import { CityDoc } from '../../src/doc/doc';
import { newMeta } from '../../src/doc/format';
import * as ops from '../../src/doc/ops';
const [x0, z0, x1, z1] = (process.argv[2] ?? '-1000,-680,-930,-300').split(',').map(Number);
const name = process.argv[3] ?? 'National Games';
const dir = 'public/tiles/kp/';
const hdr = JSON.parse(fs.readFileSync(dir + 'tile.json', 'utf8'));
const buf = fs.readFileSync(dir + 'tile.bin');
const tile = parseTile(hdr, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const net = JSON.parse(fs.readFileSync(dir + 'network.json', 'utf8'));
const osm = JSON.parse(fs.readFileSync(dir + 'osm-roads.json', 'utf8'));
const W = new Map<number, { id: number; hw: string; p: number[] }>(osm.ways.map((w: any) => [w.id, w]));
const doc = new CityDoc(buildBase(net, tile, null), newMeta('kp', '', ''));
const near = (p: number[], x: number, z: number) => {
  let b = 1e9, bx = 0, bz = 0;
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    const d = Math.hypot(ax + dx * t - x, az + dz * t - z);
    if (d < b) { b = d; bx = ax + dx * t; bz = az + dz * t; }
  }
  return { d: b, x: bx, z: bz };
};
for (const s of doc.all('section')) {
  if (!s.name?.includes(name)) continue;
  const S = ops.samplePath(ops.anchorsOf(doc, s), 10);
  if (!S.pts.some(([x, z]) => x >= x0 && x <= x1 && z >= z0 && z <= z1)) continue;
  const ways = (s.wayIds ?? []).map((id) => W.get(id)).filter(Boolean) as { id: number; p: number[] }[];
  const rows: string[] = [];
  for (let i = 0; i < S.pts.length; i++) {
    const [x, z] = S.pts[i];
    const N = ways.map((w) => ({ id: w.id, ...near(w.p, x, z) })).sort((a, b) => a.d - b.d);
    const a = N[0], b = N.find((q) => q !== a && q.d < 30 && Math.hypot(q.x - a.x, q.z - a.z) > 3);
    const mx = b ? (a.x + b.x) / 2 : a.x, mz = b ? (a.z + b.z) / 2 : a.z;
    rows.push(`${x.toFixed(0)},${z.toFixed(0)} off ${Math.hypot(x - mx, z - mz).toFixed(1)}${b ? ' gap ' + Math.hypot(a.x - b.x, a.z - b.z).toFixed(0) : ' single'} [${a.id}${b ? '/' + b.id : ''}]`);
  }
  console.log(`${s.id} ${s.name} ${s.a}->${s.b} pts ${s.path.length} ways ${s.wayIds?.join(',')}\n  ` + rows.join('\n  '));
}
