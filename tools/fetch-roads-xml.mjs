// Downloads OSM XML for highways (+ their nodes) — input for osm2streets.
// Usage: node tools/fetch-roads-xml.mjs [tileId]
import fs from 'node:fs';
import path from 'node:path';
import { TILES, tileBBox } from './tile-config.mjs';

const tile = TILES[process.argv[2] ?? 'kp'];
const b = tileBBox(tile);
// Slightly larger than the tile so junctions at the edge are complete; osm2streets clips later.
const pad = 0.002;
const bbox = `${b.s - pad},${b.w - pad},${b.n + pad},${b.e + pad}`;
const query = `[out:xml][timeout:240];
(
  way["highway"](${bbox});
  way["railway"~"rail|light_rail|subway|narrow_gauge"](${bbox});
);
(._;>;);
out body;`;

for (const url of ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']) {
  try {
    console.log(`Fetching road XML for ${tile.id} from ${url} ...`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'User-Agent': 'UrbanPlan/0.2', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text.startsWith('<?xml')) throw new Error('Not XML: ' + text.slice(0, 120));
    const out = path.join('data', 'raw', `${tile.id}.roads.osm`);
    fs.writeFileSync(out, text);
    console.log(`Saved ${(text.length / 1e6).toFixed(1)} MB → ${out}`);
    process.exit(0);
  } catch (e) {
    console.warn('  failed:', e.message);
  }
}
process.exit(1);
