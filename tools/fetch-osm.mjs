// Downloads raw OpenStreetMap data for a tile via the Overpass API.
// Usage: node tools/fetch-osm.mjs [tileId]
import fs from 'node:fs';
import path from 'node:path';
import { TILES, tileBBox } from './tile-config.mjs';

const tile = TILES[process.argv[2] ?? 'baner'];
if (!tile) throw new Error('Unknown tile');
const b = tileBBox(tile);
const bbox = `${b.s},${b.w},${b.n},${b.e}`;

const query = `[out:json][timeout:240];
(
  way["highway"](${bbox});
  way["building"](${bbox});
  way["landuse"](${bbox});
  way["leisure"~"park|garden|pitch|playground|golf_course|stadium|nature_reserve"](${bbox});
  way["natural"~"water|wood|scrub|grassland|wetland|bare_rock|heath"](${bbox});
  way["waterway"~"river|stream|canal|drain"](${bbox});
  way["amenity"~"school|college|university|hospital|parking"](${bbox});
  way["railway"](${bbox});
  node["natural"="tree"](${bbox});
  node["highway"="bus_stop"](${bbox});
);
out body geom;`;

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

for (const url of ENDPOINTS) {
  try {
    console.log(`Fetching ${tile.id} (${tile.sizeKm}x${tile.sizeKm} km) from ${url} ...`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'User-Agent': 'UrbanPlan/0.1', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const json = JSON.parse(text);
    const out = path.join('data', 'raw', `${tile.id}.osm.json`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, text);
    console.log(`Saved ${json.elements.length} elements → ${out} (${(text.length / 1e6).toFixed(1)} MB)`);
    process.exit(0);
  } catch (e) {
    console.warn(`  failed: ${e.message}`);
  }
}
console.error('All Overpass endpoints failed.');
process.exit(1);
