// Fallback when Overpass is down: fetch from the OSM API /map endpoint in small cells (≤50k nodes each),
// sequentially and politely, cache each cell, then merge by element id into data/raw/<tile>.osm.
// Usage: node tools/fetch-osm-api.mjs [tileId] [splits]
import fs from 'node:fs';
import path from 'node:path';
import { TILES, tileBBox } from './tile-config.mjs';

const tile = TILES[process.argv[2] ?? 'kp'];
const splits = Number(process.argv[3] ?? 4);
const b = tileBBox(tile);
const pad = 0.0025;
const S = b.s - pad, W = b.w - pad, N = b.n + pad, E = b.e + pad;
const cacheDir = path.join('data', 'raw', 'osmapi', tile.id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const elements = { node: new Map(), way: new Map(), relation: new Map() };

function ingest(xml) {
  // Either self-closing <node .../> or a full <way ...>…</way>; the head can't contain '>'
  const re = /<(node|way|relation)\s([^>]*?)(\/>|>[\s\S]*?<\/\1>)/g;
  let m, c = 0;
  while ((m = re.exec(xml))) {
    const id = m[2].match(/\bid="(\d+)"/)[1];
    elements[m[1]].set(id, m[0]);
    c++;
  }
  console.log(`    ${c} elements`);
}

async function get(s, w, n, e, depth = 0) {
  const key = [s, w, n, e].map((v) => v.toFixed(5)).join('_');
  const cacheFile = path.join(cacheDir, `${key}.xml`);
  if (fs.existsSync(cacheFile)) { ingest(fs.readFileSync(cacheFile, 'utf8')); return; }
  const url = `https://api.openstreetmap.org/api/0.6/map?bbox=${w},${s},${e},${n}`;
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'PuneRemix-prototype/0.2 (urban planning game prototype)' } });
    if (res.status === 400 && depth < 3) {
      // too many nodes → split this cell into 4
      const ms = (s + n) / 2, mw = (w + e) / 2;
      for (const q of [[s, w, ms, mw], [s, mw, ms, e], [ms, w, n, mw], [ms, mw, n, e]]) await get(...q, depth + 1);
      return;
    }
    if (!res.ok) { console.warn(`    HTTP ${res.status}, retrying`); await sleep(3000 * (attempt + 1)); continue; }
    const xml = await res.text();
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(cacheFile, xml);
    ingest(xml);
    await sleep(800);
    return;
  }
  throw new Error('cell failed: ' + url);
}

let k = 0;
for (let i = 0; i < splits; i++) for (let j = 0; j < splits; j++) {
  const s = S + ((N - S) * i) / splits, n = S + ((N - S) * (i + 1)) / splits;
  const w = W + ((E - W) * j) / splits, e = W + ((E - W) * (j + 1)) / splits;
  console.log(`  cell ${++k}/${splits * splits}`);
  await get(s, w, n, e);
}
const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="PuneRemix osm-api merge">\n` +
  [...elements.node.values(), ...elements.way.values(), ...elements.relation.values()].join('\n') + '\n</osm>\n';
const out = path.join('data', 'raw', `${tile.id}.osm`);
fs.writeFileSync(out, xml);
console.log(`Saved ${(xml.length / 1e6).toFixed(1)} MB → ${out}: ${elements.node.size} nodes, ${elements.way.size} ways, ${elements.relation.size} relations`);
