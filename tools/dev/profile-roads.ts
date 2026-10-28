// Headless profile of the road pipeline (bundled with esbuild, run in Node).
import fs from 'node:fs';
import { unpackStreets } from '../../src/geo/streetsCore';
import { Heightfield } from '../../src/geo/heightfield';
import { Elevation } from '../../src/geo/elevation';
import { rebuildRoadGeometry } from '../../src/geo/lanes';
import { GeomBuilder, drapeBand } from '../../src/build/geom';

const dir = 'public/tiles/kp/';
const hdr = JSON.parse(fs.readFileSync(dir + 'tile.json', 'utf8'));
const bin = fs.readFileSync(dir + 'tile.bin');
const sec = hdr.sections.find((s: any) => s.name === 'terrain');
const heights = new Float32Array(bin.buffer.slice(bin.byteOffset + sec.offset, bin.byteOffset + sec.offset + sec.length * 4));
const hf = new Heightfield(hdr.terrain.n, hdr.terrain.cell, heights);
const sb = fs.readFileSync(dir + 'streets.bin');
const raw = unpackStreets(fs.readFileSync(dir + 'streets.json', 'utf8'), sb.buffer.slice(sb.byteOffset, sb.byteOffset + sb.byteLength));
const net: any = { roads: new Map(raw.roads.map((r) => [r.id, r])), intersections: new Map(raw.intersections.map((i) => [i.id, i])), lanes: raw.lanes, markings: raw.markings, corners: raw.corners, buildMs: 0 };
let t = Date.now();
rebuildRoadGeometry(net);
console.log('rebuild', Date.now() - t, 'ms; lanes', net.lanes.length, 'markings', net.markings.length);
let maxPts = 0, bad = 0;
for (const l of net.lanes) { maxPts = Math.max(maxPts, l.poly.length / 2); for (const v of l.poly) if (!Number.isFinite(v)) { bad++; break; } }
console.log('max lane ring pts', maxPts, 'lanes with non-finite coords', bad);
const elev = new Elevation(net, hf, hdr.wayFlags);
t = Date.now();
const gb = new GeomBuilder();
let worst = 0, worstId = -1;
for (const lane of net.lanes) {
  const r = net.roads.get(lane.road);
  const t1 = Date.now();
  drapeBand(gb, lane.poly, (x, z) => elev.roadZ(r, x, z), [1, 1, 1], 5);
  const dt = Date.now() - t1;
  if (dt > worst) { worst = dt; worstId = lane.road; }
  if (Date.now() - t > 20000) { console.log('TIMEOUT at lane of road', lane.road, 'verts', gb.vertexCount); break; }
}
console.log('drape lanes', Date.now() - t, 'ms; verts', gb.vertexCount, 'worst lane', worst, 'ms road', worstId, elev.profiles.get(worstId));
import { buildRoadMeshes } from '../../src/build/roads';
t = Date.now();
const rm = buildRoadMeshes(net, elev, hf);
console.log('buildRoadMeshes', Date.now() - t, 'ms', rm.asphalt.vertexCount, rm.markings.vertexCount);
