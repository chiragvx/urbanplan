// Exports the alignment/measurement reference for DP extraction: road centre lines (dense), water, bridges.
import fs from 'node:fs';
import { sampleBez } from '../../src/net/model';

const dir = 'public/tiles/kp/';
const net = JSON.parse(fs.readFileSync(dir + 'network.json', 'utf8'));
const hdr = JSON.parse(fs.readFileSync(dir + 'tile.json', 'utf8'));
const bin = fs.readFileSync(dir + 'tile.bin');
const sec = (n: string) => hdr.sections.find((s: any) => s.name === n);
const arr = (n: string, C: any) => { const s = sec(n); return new C(bin.buffer.slice(bin.byteOffset + s.offset, bin.byteOffset + s.offset + s.length * C.BYTES_PER_ELEMENT)); };
const WP = arr('waterPts', Float32Array), WPoly = arr('waterPoly', Uint32Array), WS = arr('waterRingStart', Uint32Array), WC = arr('waterRingCount', Uint32Array);
const water: number[][][] = [];
for (let i = 0; i < WPoly.length; i += 2) {
  const rings: number[][] = [];
  for (let r = WPoly[i]; r < WPoly[i] + WPoly[i + 1]; r++) rings.push(Array.from(WP.slice(WS[r] * 2, (WS[r] + WC[r]) * 2)));
  water.push(rings);
}
const roads = net.segments.map((s: any) => {
  const t = net.types[s.type];
  const { pts } = sampleBez(s.p, 2, 2);
  return { id: s.id, name: s.name, cls: s.cls, bridge: s.bridge, wayIds: s.wayIds, hw: Math.max(t.hwL, t.hwR), pts: Array.from(pts).map((v) => Math.round(v * 100) / 100) };
});
fs.writeFileSync('data/raw/dp/ref.json', JSON.stringify({ half: hdr.half, center: hdr.center, proj: hdr.proj, roads, water }));
console.log(`ref: ${roads.length} road segments, ${water.length} water polygons`);
