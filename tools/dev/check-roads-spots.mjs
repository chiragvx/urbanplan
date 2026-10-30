// Export OSM ways and the baked centre lines (lat / lon) around a few spots, for drawing over satellite imagery.
// node tools/dev/check-roads-spots.mjs out.json x,z[,label] …
import fs from 'node:fs';
import { parseOsmXml } from '../osmxml.mjs';
import { TILES } from '../tile-config.mjs';

const id = 'kp', tile = TILES[id];
const hdr = JSON.parse(fs.readFileSync(`public/tiles/${id}/tile.json`, 'utf8'));
const net = JSON.parse(fs.readFileSync(`public/tiles/${id}/network.json`, 'utf8'));
const osm = parseOsmXml(fs.readFileSync(`data/raw/${id}.osm`, 'utf8'));
const kx = hdr.proj.kx, kz = hdr.proj.kz;
const toLL = (x, z) => [tile.lat - z / kz, tile.lon + x / kx];
const P = (n) => [(n.lon - tile.lon) * kx, -(n.lat - tile.lat) * kz];
const [out, ...args] = process.argv.slice(2);
const R = +(process.env.R ?? 170);
const spots = args.map((a) => { const [x, z, ...l] = a.split(','); return { x: +x, z: +z, label: l.join(',') }; });
const bez = (c, t) => { const u = 1 - t; return [u * u * u * c[0] + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6], u * u * u * c[1] + 3 * u * u * t * c[3] + 3 * u * t * t * c[5] + t * t * t * c[7]]; };
const res = spots.map((s) => {
  const inBox = (p) => Math.abs(p[0] - s.x) < R && Math.abs(p[1] - s.z) < R;
  const osmWays = [];
  for (const w of osm.ways.values()) {
    if (!w.tags?.highway) continue;
    const pts = w.nds.map((i) => osm.nodes.get(i)).filter(Boolean).map(P);
    if (pts.some(inBox)) osmWays.push({ hw: w.tags.highway, oneway: w.tags.oneway === 'yes', pts: pts.map((p) => toLL(p[0], p[1])) });
  }
  const segs = [];
  for (const g of net.segments) {
    const pts = []; for (let i = 0; i <= 16; i++) pts.push(bez(g.p, i / 16));
    if (!pts.some(inBox)) continue;
    const t = net.types[g.type];
    segs.push({ cls: g.cls, hwL: t.hwL, hwR: t.hwR, pts: pts.map((p) => toLL(p[0], p[1])) });
  }
  return { ...s, ll: toLL(s.x, s.z), R, osmWays, segs };
});
fs.writeFileSync(out, JSON.stringify(res));
console.log(res.map((r) => `${r.label || r.x + ',' + r.z}: ${r.osmWays.length} OSM ways, ${r.segs.length} segments`).join('\n'));
