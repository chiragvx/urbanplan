// Downloads all OSM features a tile needs as one OSM XML file (input for osm2streets + our baker).
// Retries across mirrors; falls back to 2x2 quadrants merged by id if the full query is too heavy.
// Usage: node tools/fetch-osm-xml.mjs [tileId]
import fs from 'node:fs';
import path from 'node:path';
import { TILES, tileBBox } from './tile-config.mjs';

const tile = TILES[process.argv[2] ?? 'kp'];
const b = tileBBox(tile);
const pad = 0.0025; // fetch a margin so edge junctions are complete; we clip later

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];

function query(s, w, n, e) {
  const bb = `${s},${w},${n},${e}`;
  return `[out:xml][timeout:300][maxsize:536870912];
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
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run(q, label) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      console.log(`  ${label}: ${url} (attempt ${attempt + 1})`);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'User-Agent': 'PuneRemix-prototype/0.2', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(q),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.includes('<osm')) throw new Error('Not OSM XML: ' + text.slice(0, 160));
      if (text.includes('<remark>')) throw new Error('Overpass remark: ' + text.match(/<remark>([\s\S]*?)<\/remark>/)?.[1]);
      return text;
    } catch (e) {
      console.warn('    failed:', e.message);
      await sleep(4000 * (attempt + 1));
    }
  }
  throw new Error(`${label} failed`);
}

// Merge several OSM XML documents by element id (simple line-based, Overpass output is one element per block)
function merge(docs) {
  const seen = new Set();
  const parts = { node: [], way: [], relation: [] };
  for (const d of docs) {
    const re = /<(node|way|relation)\s[^>]*?id="(\d+)"[\s\S]*?(?:\/>|<\/\1>)/g;
    let m;
    while ((m = re.exec(d))) {
      const key = m[1] + m[2];
      if (seen.has(key)) continue;
      seen.add(key);
      parts[m[1]].push(m[0]);
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="PuneRemix merge">\n${parts.node.join('\n')}\n${parts.way.join('\n')}\n${parts.relation.join('\n')}\n</osm>\n`;
}

const S = b.s - pad, W = b.w - pad, N = b.n + pad, E = b.e + pad;
let xml;
try {
  console.log(`Fetching ${tile.id} (${tile.sizeKm}x${tile.sizeKm} km) as one query…`);
  xml = await run(query(S, W, N, E), 'full');
} catch {
  console.log('Falling back to 4 quadrants…');
  const ms = (S + N) / 2, mw = (W + E) / 2;
  const quads = [[S, W, ms, mw], [S, mw, ms, E], [ms, W, N, mw], [ms, mw, N, E]];
  const docs = [];
  for (const [i, q] of quads.entries()) docs.push(await run(query(...q), `quadrant ${i + 1}/4`));
  xml = merge(docs);
}
const out = path.join('data', 'raw', `${tile.id}.osm`);
fs.writeFileSync(out, xml);
const count = (t) => (xml.match(new RegExp(`<${t} `, 'g')) || []).length;
console.log(`Saved ${(xml.length / 1e6).toFixed(1)} MB → ${out}: ${count('node')} nodes, ${count('way')} ways, ${count('relation')} relations`);
