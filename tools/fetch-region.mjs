// Downloads a region's OSM data from Overpass in cells of 2×2 pieces (~4 km), one OSM XML file per cell.
// Skips cells already on disk, so it can be re-run after a failure.
// Usage: node tools/fetch-region.mjs [regionId]
import fs from 'node:fs';
import path from 'node:path';
import { REGIONS, regionFrame } from './region-config.mjs';

const R = REGIONS[process.argv[2] ?? 'pune'];
const F = regionFrame(R);
const CELL = 2; // pieces per fetch cell (each way): 4 km — 8 km cells time out on the public Overpass servers
const PAD = 300; // metres of margin so features crossing a cell edge are whole
const out = path.join('data', 'raw', 'region', R.id);
fs.mkdirSync(out, { recursive: true });

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const query = (bb) => `[out:xml][timeout:600][maxsize:1073741824];
(
  way["highway"](${bb});
  way["railway"~"rail|light_rail|subway|narrow_gauge|platform"](${bb});
  way["building"](${bb});
  relation["building"](${bb});
  way["landuse"](${bb});
  relation["landuse"](${bb});
  way["leisure"](${bb});
  relation["leisure"](${bb});
  way["natural"](${bb});
  relation["natural"~"water|wood"](${bb});
  way["waterway"](${bb});
  way["water"](${bb});
  relation["water"](${bb});
  way["amenity"~"school|college|university|hospital|parking|place_of_worship"](${bb});
  way["man_made"~"bridge|pier"](${bb});
  node["natural"="tree"](${bb});
  node["highway"~"bus_stop|traffic_signals"](${bb});
);
(._;>;);
out body;`;

async function run(q, label) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      const t0 = Date.now();
      const res = await fetch(url, { method: 'POST', headers: { 'User-Agent': 'UrbanPlan/0.3', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.includes('<osm')) throw new Error('not OSM XML: ' + text.slice(0, 160));
      if (text.includes('<remark>')) throw new Error('Overpass remark: ' + text.match(/<remark>([\s\S]*?)<\/remark>/)?.[1]);
      console.log(`  ${label}: ${(text.length / 1e6).toFixed(1)} MB in ${((Date.now() - t0) / 1000).toFixed(0)} s (${url.split('/')[2]})`);
      return text;
    } catch (e) {
      console.warn(`  ${label}: attempt ${attempt + 1} failed: ${e.message}`);
      await sleep(10000 * (attempt + 1));
    }
  }
  throw new Error(`${label} failed`);
}

const cells = [];
for (let cj = F.j0; cj <= F.j1; cj += CELL) for (let ci = F.i0; ci <= F.i1; ci += CELL) cells.push([ci, cj]);
const bboxOf = ([ci, cj]) => {
  const x0 = ci * R.piece - PAD, z0 = cj * R.piece - PAD, x1 = (ci + CELL) * R.piece + PAD, z1 = (cj + CELL) * R.piece + PAD;
  const sw = F.unproj(x0, z1), ne = F.unproj(x1, z0);
  return { s: sw.lat, w: sw.lon, n: ne.lat, e: ne.lon };
};
// --plan: just write the cells (for tools/region-extract.py, which cuts them from a Geofabrik extract instead)
if (process.argv.includes('--plan')) {
  fs.writeFileSync(path.join(out, 'cells.json'), JSON.stringify(cells.map((c) => ({ file: `c_${c[0]}_${c[1]}.osm`, ...bboxOf(c) }))));
  console.log(`${cells.length} cells → ${path.join(out, 'cells.json')}`);
  process.exit(0);
}
console.log(`${R.id}: ${cells.length} cells of ${CELL}×${CELL} pieces (${(CELL * R.piece) / 1000} km)`);
for (const [ci, cj] of cells) {
  const file = path.join(out, `c_${ci}_${cj}.osm`);
  if (fs.existsSync(file) && fs.statSync(file).size > 1000) continue;
  const b = bboxOf([ci, cj]);
  const bb = `${b.s.toFixed(6)},${b.w.toFixed(6)},${b.n.toFixed(6)},${b.e.toFixed(6)}`;
  const xml = await run(query(bb), `cell ${ci},${cj}`);
  fs.writeFileSync(file + '.tmp', xml);
  fs.renameSync(file + '.tmp', file);
  await sleep(3000);
}
console.log('done');
