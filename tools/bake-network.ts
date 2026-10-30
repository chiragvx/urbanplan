// Bakes the clean road network: OSM XML + terrain → public/tiles/<id>/network.json
// Run: npx esbuild tools/bake-network.ts --bundle --platform=node --format=esm --outfile=tools/dev/bake-network.mjs && node tools/dev/bake-network.mjs kp
import fs from 'node:fs';
import path from 'node:path';
// @ts-ignore — plain JS helpers
import { parseOsmXml } from './osmxml.mjs';
// @ts-ignore
import { TILES } from './tile-config.mjs';
import { importNetwork } from '../src/net/importer';
import { Heightfield } from '../src/geo/heightfield';

const id = process.argv[2] ?? 'kp';
const tile = TILES[id];
const dir = path.join('public', 'tiles', id);
const hdr = JSON.parse(fs.readFileSync(path.join(dir, 'tile.json'), 'utf8'));
const bin = fs.readFileSync(path.join(dir, 'tile.bin'));
const sec = (name: string) => hdr.sections.find((s: any) => s.name === name);
const ts = sec('terrain');
const heights = new Float32Array(bin.buffer.slice(bin.byteOffset + ts.offset, bin.byteOffset + ts.offset + ts.length * 4));
const hf = new Heightfield(hdr.terrain.n, hdr.terrain.cell, heights);

// rails at ground level (for overpass detection)
const rp = sec('railPts'), rs = sec('railStart'), rc = sec('railCount'), rf = sec('railFlags');
const f32 = (s: any) => new Float32Array(bin.buffer.slice(bin.byteOffset + s.offset, bin.byteOffset + s.offset + s.length * 4));
const u32 = (s: any) => new Uint32Array(bin.buffer.slice(bin.byteOffset + s.offset, bin.byteOffset + s.offset + s.length * 4));
const RP = f32(rp), RS = u32(rs), RC = u32(rc);
const RF = new Uint8Array(bin.buffer.slice(bin.byteOffset + rf.offset, bin.byteOffset + rf.offset + rf.length));
const groundRails: [number, number][][] = [];
const viaducts: [number, number][][] = []; // elevated rail (metro) — roads beneath get a median for the piers
for (let i = 0; i < RS.length; i++) {
  const line: [number, number][] = [];
  for (let k = RS[i]; k < RS[i] + RC[i]; k++) line.push([RP[k * 2], RP[k * 2 + 1]]);
  const elevated = RF[i * 4] === 1 || RF[i * 4 + 2] - 4 > 0;
  if (elevated) { viaducts.push(line); continue; }
  if (RF[i * 4 + 1]) continue;
  groundRails.push(line);
}

// building footprint raster (1 m) — caps road widths to today's free space
const BP = new Float32Array(bin.buffer.slice(bin.byteOffset + sec('bldPts').offset, bin.byteOffset + sec('bldPts').offset + sec('bldPts').length * 4));
const BPoly = u32(sec('bldPoly')), BRS = u32(sec('bldRingStart')), BRC = u32(sec('bldRingCount'));
const half = hdr.half, BN = Math.ceil(half * 2);
const bmask = new Uint8Array(BN * BN);
for (let i = 0; i < BPoly.length; i += 2) {
  const r = BPoly[i];
  const s0 = BRS[r], c = BRC[r];
  let z0 = Infinity, z1 = -Infinity;
  for (let k = 0; k < c; k++) { const z = BP[(s0 + k) * 2 + 1]; z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  for (let j = Math.max(0, Math.floor(z0 + half)); j <= Math.min(BN - 1, Math.ceil(z1 + half)); j++) {
    const z = -half + j + 0.5, xs: number[] = [];
    for (let k = 0; k < c; k++) {
      const ax = BP[(s0 + k) * 2], az = BP[(s0 + k) * 2 + 1], bx = BP[(s0 + (k + 1) % c) * 2], bz = BP[(s0 + (k + 1) % c) * 2 + 1];
      if ((az > z) !== (bz > z)) xs.push(ax + ((z - az) / (bz - az)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let x = Math.max(0, Math.floor(xs[k] + half)); x <= Math.min(BN - 1, Math.floor(xs[k + 1] + half)); x++) bmask[j * BN + x] = 1;
  }
}
const buildingAt = (x: number, z: number) => {
  const i = Math.floor(x + half), j = Math.floor(z + half);
  return i >= 0 && j >= 0 && i < BN && j < BN && bmask[j * BN + i] === 1;
};

const t0 = Date.now();
const osm = parseOsmXml(fs.readFileSync(path.join('data', 'raw', `${id}.osm`), 'utf8'));
const kx = hdr.proj.kx, kz = hdr.proj.kz;
const net = importNetwork({
  nodes: osm.nodes, ways: [...osm.ways.values()],
  proj: (n) => [(n.lon - tile.lon) * kx, -(n.lat - tile.lat) * kz],
  half: hdr.half, groundRails, viaducts, terrain: (x, z) => hf.sample(x, z),
  buildingAt,
  dpWidths: fs.existsSync(path.join('data', 'raw', 'dp', 'widths.json')) ? JSON.parse(fs.readFileSync(path.join('data', 'raw', 'dp', 'widths.json'), 'utf8')) : undefined,
  log: (m) => console.log('  ' + m),
});
const round = (v: number) => Math.round(v * 100) / 100;
const out = {
  half: net.half,
  types: net.types,
  nodes: net.nodes.map((n) => ({ ...n, x: round(n.x), z: round(n.z), lift: round(n.lift), R: n.R && round(n.R) })),
  segments: net.segments.map((s) => ({ ...s, p: s.p.map(round) })),
  paths: net.paths.map((p) => ({ ...p, pts: p.pts.map(round) })),
};
fs.writeFileSync(path.join(dir, 'network.json'), JSON.stringify(out));
// the raw OSM road centre lines (projected), for the editor's "compare with OpenStreetMap" view
const osmRoads: { id: number; hw: string; p: number[] }[] = [];
for (const w of osm.ways.values()) {
  const hw = w.tags?.highway;
  if (!hw || ['footway', 'path', 'steps', 'cycleway', 'pedestrian', 'bridleway', 'corridor', 'proposed', 'construction', 'platform', 'elevator'].includes(hw)) continue;
  const p: number[] = [];
  for (const id of w.nds) { const n = osm.nodes.get(id); if (!n) continue; const [x, z] = [(n.lon - tile.lon) * kx, -(n.lat - tile.lat) * kz]; p.push(Math.round(x * 10) / 10, Math.round(z * 10) / 10); }
  if (p.length >= 4 && p.some((v, i) => Math.abs(v) < hdr.half + 50 || i < 0)) osmRoads.push({ id: w.id, hw, p });
}
fs.writeFileSync(path.join(dir, 'osm-roads.json'), JSON.stringify({ source: '© OpenStreetMap contributors (ODbL)', ways: osmRoads }));
console.log(`network ${id}: ${net.nodes.length} nodes, ${net.segments.length} segments, ${Object.keys(net.types).length} road types, ${net.paths.length} paths in ${Date.now() - t0} ms`);
