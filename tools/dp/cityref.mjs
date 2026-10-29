// City-wide reference for registering DP sheets: OSM roads (dense centre lines with a half width) and water polygons
// in the city frame (cities/<id>/city.json). The tile pipeline's ref.json covers one tile; this covers the city.
// Usage: node tools/dp/cityref.mjs [city]       → data/raw/cities/<city>/ref.json (+ the raw OSM XML, cached)
import fs from 'node:fs';
import path from 'node:path';
import { parseOsmXml, assembleMultipolygon } from '../osmxml.mjs';

const id = process.argv[2] ?? 'pune';
const city = JSON.parse(fs.readFileSync(`cities/${id}/city.json`, 'utf8'));
const out = `data/raw/cities/${id}`;
fs.mkdirSync(out, { recursive: true });
const { s, w, n, e } = city.bbox;
const lat0 = city.frame.lat, lon0 = city.frame.lon;
const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), kz = 110540;
const X = (lon) => Math.round((lon - lon0) * kx * 100) / 100, Z = (lat) => Math.round(-(lat - lat0) * kz * 100) / 100;

const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const bb = `${s},${w},${n},${e}`;
const query = `[out:xml][timeout:300][maxsize:536870912];
(
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street)(_link)?$"](${bb});
  way["natural"="water"](${bb});
  relation["natural"="water"](${bb});
  way["waterway"~"riverbank|river|canal"](${bb});
  relation["waterway"="riverbank"](${bb});
  way["landuse"="reservoir"](${bb});
);
(._;>;);
out body;`;

const cache = path.join(out, 'osm.xml');
let xml;
if (fs.existsSync(cache)) xml = fs.readFileSync(cache, 'utf8');
else {
  for (let a = 0; a < 6 && !xml; a++) {
    const url = ENDPOINTS[a % ENDPOINTS.length];
    try {
      console.log(`fetching ${url} (attempt ${a + 1})`);
      const res = await fetch(url, { method: 'POST', headers: { 'User-Agent': 'UrbanPlan/0.2 (DP registration reference)', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const t = await res.text();
      if (!t.includes('<osm')) throw new Error(t.slice(0, 160));
      xml = t;
    } catch (err) { console.warn('  failed:', err.message); await new Promise((r) => setTimeout(r, 4000 * (a + 1))); }
  }
  if (!xml) throw new Error('Overpass unavailable');
  fs.writeFileSync(cache, xml);
}
const osm = parseOsmXml(xml);
const HW = { motorway: 12, trunk: 12, primary: 10, secondary: 8, tertiary: 6, unclassified: 4, residential: 4, living_street: 3 };
const pt = (nid) => { const nd = osm.nodes.get(nid); return nd ? [X(nd.lon), Z(nd.lat)] : null; };
const roads = [], water = [];
for (const wy of osm.ways.values()) {
  const t = wy.tags ?? {};
  if (t.highway) {
    const cls = t.highway.replace('_link', '');
    const pts = wy.nds.map(pt).filter(Boolean).flat();
    if (pts.length >= 4) roads.push({ cls, hw: HW[cls] ?? 4, pts });
  } else if (t.natural === 'water' || t.waterway === 'riverbank' || t.landuse === 'reservoir') {
    if (wy.nds[0] !== wy.nds[wy.nds.length - 1]) continue;
    water.push([wy.nds.map(pt).filter(Boolean).flat()]);
  } else if (t.waterway === 'river' || t.waterway === 'canal') {
    // river centre lines where no riverbank polygon exists: drawn as a wide road-like band (half width)
    const pts = wy.nds.map(pt).filter(Boolean).flat();
    if (pts.length >= 4) roads.push({ cls: 'river', hw: t.waterway === 'river' ? 25 : 6, pts, water: true });
  }
}
for (const r of osm.relations.values()) {
  const t = r.tags ?? {};
  if (t.type !== 'multipolygon' || !(t.natural === 'water' || t.waterway === 'riverbank')) continue;
  const { outer, inner } = assembleMultipolygon(r, osm.ways);
  for (const o of outer) water.push([o.map(pt).filter(Boolean).flat(), ...inner.map((h) => h.map(pt).filter(Boolean).flat())]);
}
fs.writeFileSync(path.join(out, 'ref.json'), JSON.stringify({ city: id, half: city.frame.ext, ext: city.frame.ext, center: [lat0, lon0], proj: { kx, kz }, roads, water }));
console.log(`${id}: ${roads.length} road ways, ${water.length} water polygons → ${path.join(out, 'ref.json')}`);
