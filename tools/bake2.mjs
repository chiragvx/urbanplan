// v2 baker: OSM XML + Copernicus DEM → game tile.
//   public/tiles/<id>/tile.json   header, small tables
//   public/tiles/<id>/tile.bin    typed arrays (terrain, polygons, lines, points)
//   public/tiles/<id>/roads.osm   cleaned highway-only OSM XML for osm2streets (runs in the browser)
// Usage: node tools/bake2.mjs [tileId]
import fs from 'node:fs';
import path from 'node:path';
import { TILES, tileBBox } from './tile-config.mjs';
import { parseOsmXml, assembleMultipolygon } from './osmxml.mjs';
import { loadTerrain } from './dem.mjs';
import { smoothNetwork } from './smooth.mjs';
import { buildingKind, buildingHeight, roofShape, areaKind, ringArea, centroid } from './osm-features.mjs';

const tile = TILES[process.argv[2] ?? 'kp'];
const { half, s: bS, w: bW, n: bN, e: bE } = tileBBox(tile);
const outDir = path.join('public', 'tiles', tile.id);
fs.mkdirSync(outDir, { recursive: true });

console.time('parse');
const osm = parseOsmXml(fs.readFileSync(path.join('data', 'raw', `${tile.id}.osm`), 'utf8'));
console.timeEnd('parse');

const kx = 111320 * Math.cos((tile.lat * Math.PI) / 180), kz = 110540;
const proj = (n) => [(n.lon - tile.lon) * kx, -(n.lat - tile.lat) * kz];
const inside = (x, z, m = 0) => Math.abs(x) <= half - m && Math.abs(z) <= half - m;
const ringPts = (ids) => {
  const out = [];
  for (const id of ids) { const n = osm.nodes.get(id); if (!n) return null; out.push(proj(n)); }
  if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out;
};

// ---------------- Polygons (ways + multipolygon relations) ----------------
/** Yields { tags, outer: [[x,z]...], holes: [[[x,z]...]], id } for closed ways and multipolygons. */
function* polygons(filter) {
  const usedAsMember = new Set();
  for (const r of osm.relations.values()) {
    if (r.tags.type !== 'multipolygon' || !filter(r.tags)) continue;
    const { outer, inner } = assembleMultipolygon(r, osm.ways);
    for (const m of r.members) if (m.type === 'way') usedAsMember.add(m.ref);
    const holes = inner.map(ringPts).filter((h) => h && h.length >= 3);
    for (const o of outer) {
      const ring = ringPts(o);
      if (ring && ring.length >= 3) yield { id: r.id, tags: r.tags, outer: ring, holes };
    }
  }
  for (const w of osm.ways.values()) {
    if (w.nds.length < 4 || w.nds[0] !== w.nds[w.nds.length - 1]) continue;
    if (!filter(w.tags)) continue;
    if (usedAsMember.has(w.id) && !w.tags.building && !w.tags.landuse && !w.tags.natural) continue;
    const ring = ringPts(w.nds);
    if (ring && ring.length >= 3) yield { id: w.id, tags: w.tags, outer: ring, holes: [] };
  }
}

// ---------------- Buildings ----------------
const buildings = [];
for (const p of polygons((t) => t.building && t.building !== 'no' && t.building !== 'roof' || t['building:part'] && t['building:part'] !== 'no')) {
  const [cx, cz] = centroid(p.outer);
  if (!inside(cx, cz, 3)) continue;
  const area = Math.abs(ringArea(p.outer));
  if (area < 6) continue;
  const kind = buildingKind(p.tags, area);
  const { h, minH, levels } = buildingHeight(p.id, p.tags, kind, area);
  buildings.push({ ...p, kind, h, minH, levels, roof: roofShape(p.tags), name: p.tags.name ?? '' });
}

// ---------------- Areas / land cover ----------------
const areas = [];
const waters = [];
for (const p of polygons((t) => !t.building && !t.highway && areaKind(t) >= 0)) {
  const k = areaKind(p.tags);
  const area = Math.abs(ringArea(p.outer));
  if (area < 30) continue;
  if (k === 5) waters.push(p);
  else areas.push({ ...p, kind: k, area });
}
areas.sort((a, b) => b.area - a.area); // large first, painted underneath small

// ---------------- Lines: waterways, rail ----------------
const waterways = [];
const rails = [];
const railWays = [];
for (const w of osm.ways.values()) {
  const t = w.tags;
  if (t.waterway && ['river', 'stream', 'canal', 'drain', 'ditch'].includes(t.waterway) && !(w.nds[0] === w.nds[w.nds.length - 1])) {
    const pts = ringPts(w.nds);
    if (!pts) continue;
    const width = t.waterway === 'river' ? 0 /* river is a polygon */ : t.waterway === 'canal' ? 8 : t.waterway === 'stream' ? 4 : 2;
    if (width > 0) waterways.push({ pts, width });
  }
  if (t.railway && ['rail', 'light_rail', 'subway', 'narrow_gauge'].includes(t.railway)) {
    railWays.push(w);
  }
}
const unproj = ([x, z]) => ({ lon: tile.lon + x / kx, lat: tile.lat - z / kz });
{
  const rw = railWays.map((w) => ({ id: w.id, nds: w.nds.filter((id) => osm.nodes.has(id)), tags: w.tags }));
  const st = smoothNetwork(rw, osm.nodes, proj, unproj);
  console.log(`smoothed rail: ${st.corners} curves, ${st.continuations} continuations`);
  for (const w of rw) {
    const t = w.tags;
    const pts = w.nds.map((id) => osm.nodes.get(id)).filter(Boolean).map(proj);
    if (pts.length < 2) continue;
    rails.push({
      pts,
      bridge: t.bridge && t.bridge !== 'no' ? 1 : 0,
      tunnel: t.tunnel && t.tunnel !== 'no' ? 1 : 0,
      layer: parseInt(t.layer ?? '0', 10) || 0,
      service: t.service ? 1 : 0,
      metro: t.railway === 'subway' || t.railway === 'light_rail' || /metro/i.test(t.name ?? '') ? 1 : 0,
    });
  }
}

// ---------------- Points ----------------
const trees = [], busStops = [], signals = [];
for (const n of osm.nodes.values()) {
  const t = n.tags;
  if (!t.natural && !t.highway) continue;
  const [x, z] = proj(n);
  if (!inside(x, z)) continue;
  if (t.natural === 'tree') trees.push(x, z);
  else if (t.highway === 'bus_stop') busStops.push({ x, z, name: t.name ?? '' });
  else if (t.highway === 'traffic_signals') signals.push(x, z);
}

// ---------------- Terrain ----------------
console.time('terrain');
const CELL = 8;
const T = await loadTerrain(path.join('data', 'raw', 'dem', 'cop30_N18_E073.tif'), tile, half, CELL);
const gn = T.n;
const H = T.heights; // absolute metres

// Rasterize water polygons to a mask on the terrain grid
const water = new Uint8Array(gn * gn);
function fillPolygon(rings, mark) {
  // scanline over grid vertex rows, even-odd over all rings
  let z0 = Infinity, z1 = -Infinity;
  for (const r of rings) for (const p of r) { z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  const j0 = Math.max(0, Math.ceil((z0 + half) / CELL)), j1 = Math.min(gn - 1, Math.floor((z1 + half) / CELL));
  for (let j = j0; j <= j1; j++) {
    const z = -half + j * CELL;
    const xs = [];
    for (const r of rings) for (let i = 0; i < r.length; i++) {
      const a = r[i], b = r[(i + 1) % r.length];
      if ((a[1] > z) !== (b[1] > z)) xs.push(a[0] + ((z - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] + half) / CELL)), i1 = Math.min(gn - 1, Math.floor((xs[k + 1] + half) / CELL));
      for (let i = i0; i <= i1; i++) mark(j * gn + i);
    }
  }
}
for (const w of waters) fillPolygon([w.outer, ...w.holes], (k) => (water[k] = 1));

// Water level field: normalized Gaussian of terrain sampled inside water (DSM over water ≈ water surface), minus a little
function blurField(src, weight, sigmaCells) {
  const r = Math.ceil(sigmaCells * 3), k = [];
  for (let i = -r; i <= r; i++) k.push(Math.exp(-(i * i) / (2 * sigmaCells * sigmaCells)));
  const pass = (a, horiz) => {
    const out = new Float32Array(gn * gn);
    for (let j = 0; j < gn; j++) for (let i = 0; i < gn; i++) {
      let s = 0;
      for (let d = -r; d <= r; d++) {
        const ii = horiz ? Math.min(gn - 1, Math.max(0, i + d)) : i, jj = horiz ? j : Math.min(gn - 1, Math.max(0, j + d));
        s += a[jj * gn + ii] * k[d + r];
      }
      out[j * gn + i] = s;
    }
    return out;
  };
  const num = new Float32Array(gn * gn), den = new Float32Array(gn * gn);
  for (let i = 0; i < gn * gn; i++) { num[i] = src[i] * weight[i]; den[i] = weight[i]; }
  const N = pass(pass(num, true), false), D = pass(pass(den, true), false);
  const out = new Float32Array(gn * gn);
  for (let i = 0; i < gn * gn; i++) out[i] = D[i] > 1e-4 ? N[i] / D[i] : NaN;
  return out;
}
const wWeight = new Float32Array(gn * gn);
for (let i = 0; i < gn * gn; i++) wWeight[i] = water[i];
const level = blurField(H, wWeight, 300 / CELL);
const waterLevel = new Float32Array(gn * gn);
let globalMin = Infinity;
for (let i = 0; i < gn * gn; i++) if (water[i]) globalMin = Math.min(globalMin, H[i]);
for (let i = 0; i < gn * gn; i++) waterLevel[i] = Number.isFinite(level[i]) ? level[i] - 0.6 : globalMin;

// Distance (in cells) to nearest water cell → carve river bed + shape banks
const dist = new Float32Array(gn * gn).fill(1e9);
for (let i = 0; i < gn * gn; i++) if (water[i]) dist[i] = 0;
for (let pass = 0; pass < 2; pass++) { // two-pass chamfer distance transform
  const fwd = pass === 0;
  for (let jj = 0; jj < gn; jj++) for (let ii = 0; ii < gn; ii++) {
    const j = fwd ? jj : gn - 1 - jj, i = fwd ? ii : gn - 1 - ii;
    const k = j * gn + i;
    const nb = fwd ? [[-1, 0, 1], [0, -1, 1], [-1, -1, 1.414], [1, -1, 1.414]] : [[1, 0, 1], [0, 1, 1], [1, 1, 1.414], [-1, 1, 1.414]];
    for (const [di, dj, c] of nb) {
      const i2 = i + di, j2 = j + dj;
      if (i2 < 0 || j2 < 0 || i2 >= gn || j2 >= gn) continue;
      dist[k] = Math.min(dist[k], dist[j2 * gn + i2] + c);
    }
  }
}
// inside: bed = level - 2.5 deepening to -4 in the middle; outside: banks rise from level+0.4 back to terrain over ~5 cells
const inDist = new Float32Array(gn * gn).fill(1e9); // distance to land, for depth profile
for (let i = 0; i < gn * gn; i++) if (!water[i]) inDist[i] = 0;
for (let pass = 0; pass < 2; pass++) {
  const fwd = pass === 0;
  for (let jj = 0; jj < gn; jj++) for (let ii = 0; ii < gn; ii++) {
    const j = fwd ? jj : gn - 1 - jj, i = fwd ? ii : gn - 1 - ii;
    const k = j * gn + i;
    const nb = fwd ? [[-1, 0, 1], [0, -1, 1]] : [[1, 0, 1], [0, 1, 1]];
    for (const [di, dj, c] of nb) {
      const i2 = i + di, j2 = j + dj;
      if (i2 < 0 || j2 < 0 || i2 >= gn || j2 >= gn) continue;
      inDist[k] = Math.min(inDist[k], inDist[j2 * gn + i2] + c);
    }
  }
}
for (let i = 0; i < gn * gn; i++) {
  const L = waterLevel[i];
  if (water[i]) {
    H[i] = L - 1.2 - Math.min(3.5, inDist[i] * 0.9);
  } else if (dist[i] < 6) {
    const t = dist[i] / 6;
    const bank = L + 0.5;
    const s = t * t * (3 - 2 * t);
    H[i] = Math.max(bank, bank + (H[i] - bank) * s) * 1; // never below the waterline next to water
    if (dist[i] <= 1.01) H[i] = Math.min(H[i], L + 0.6);
  }
}
console.timeEnd('terrain');

// ---------------- Roads XML for osm2streets ----------------
// Keep highway ways and their nodes. Split closed/self-touching ways (osm2streets skips loops).
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const roadWays = [];
let synthId = 9_000_000_000_000;
const wayFlags = {}; // osm way id → [bridge, layer, tunnel]
for (const w of osm.ways.values()) {
  const t = w.tags;
  if (!t.highway || t.area === 'yes' || ['platform', 'proposed', 'abandoned', 'raceway', 'elevator', 'corridor', 'bus_stop', 'services', 'rest_area'].includes(t.highway)) continue;
  if (!w.nds.every((id) => osm.nodes.has(id))) {
    // keep the longest run of present nodes (way crosses the download boundary)
    const runs = [];
    let cur = [];
    for (const id of w.nds) { if (osm.nodes.has(id)) cur.push(id); else { if (cur.length > 1) runs.push(cur); cur = []; } }
    if (cur.length > 1) runs.push(cur);
    if (!runs.length) continue;
    w.nds = runs.sort((a, b) => b.length - a.length)[0];
  }
  const flags = [t.bridge && t.bridge !== 'no' ? 1 : 0, parseInt(t.layer ?? '0', 10) || 0, t.tunnel && t.tunnel !== 'no' ? 1 : 0];
  // split at any repeated node so no piece is a loop
  const pieces = [];
  let start = 0;
  const seen = new Map([[w.nds[0], 0]]);
  for (let i = 1; i < w.nds.length; i++) {
    const id = w.nds[i];
    if (seen.has(id) && seen.get(id) >= start) {
      const mid = Math.max(start + 1, Math.floor((seen.get(id) + i) / 2));
      if (mid > start) { pieces.push(w.nds.slice(start, mid + 1)); start = mid; }
      seen.clear();
      for (let k = start; k <= i; k++) seen.set(w.nds[k], k);
      continue;
    }
    seen.set(id, i);
  }
  pieces.push(w.nds.slice(start));
  pieces.filter((p) => p.length >= 2).forEach((nds, k) => {
    const id = k === 0 ? w.id : synthId++;
    roadWays.push({ id, nds, tags: t });
    wayFlags[id] = flags;
  });
}
{
  const st = smoothNetwork(roadWays, osm.nodes, proj, unproj, { onlyIf: (t) => !!t.highway });
  console.log(`smoothed roads: ${st.corners} curves, ${st.continuations} continuations, ${st.roundabouts} roundabout ways → circles`);
}
const needNodes = new Set();
for (const w of roadWays) for (const n of w.nds) needNodes.add(n);
let xml = `<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="UrbanPlan bake2">\n<bounds minlat="${bS}" minlon="${bW}" maxlat="${bN}" maxlon="${bE}"/>\n`;
for (const id of needNodes) { const n = osm.nodes.get(id); xml += `<node id="${id}" lat="${n.lat}" lon="${n.lon}">${Object.entries(n.tags).filter(([k]) => k === 'highway' || k === 'crossing').map(([k, v]) => `<tag k="${esc(k)}" v="${esc(v)}"/>`).join('')}</node>\n`; }
for (const w of roadWays) xml += `<way id="${w.id}">${w.nds.map((n) => `<nd ref="${n}"/>`).join('')}${Object.entries(w.tags).map(([k, v]) => `<tag k="${esc(k)}" v="${esc(v)}"/>`).join('')}</way>\n`;
xml += '</osm>\n';
fs.writeFileSync(path.join(outDir, 'roads.osm'), xml);

// ---------------- Pack binary ----------------
const sections = [];
let byteLen = 0;
function section(name, arr) {
  byteLen += (4 - (byteLen % 4)) % 4;
  sections.push({ name, type: arr.constructor.name, offset: byteLen, length: arr.length, arr });
  byteLen += arr.byteLength;
}
/** Polygons with holes → polyRing (first ring index per polygon + count), ringStart/ringCount into points. */
function packPolys(name, list) {
  const pts = [], polyRing = [], ringStart = [], ringCount = [];
  for (const p of list) {
    polyRing.push(ringStart.length, 1 + p.holes.length);
    for (const r of [p.outer, ...p.holes]) { ringStart.push(pts.length / 2); ringCount.push(r.length); for (const [x, z] of r) pts.push(x, z); }
  }
  section(name + 'Pts', new Float32Array(pts));
  section(name + 'Poly', new Uint32Array(polyRing));
  section(name + 'RingStart', new Uint32Array(ringStart));
  section(name + 'RingCount', new Uint32Array(ringCount));
}
function packLines(name, list) {
  const pts = [], start = [], count = [];
  for (const l of list) { start.push(pts.length / 2); count.push(l.pts.length); for (const [x, z] of l.pts) pts.push(x, z); }
  section(name + 'Pts', new Float32Array(pts));
  section(name + 'Start', new Uint32Array(start));
  section(name + 'Count', new Uint32Array(count));
}

section('terrain', H);
section('waterLevel', waterLevel);
section('waterMask', water);
packPolys('bld', buildings);
section('bldHeight', new Float32Array(buildings.map((b) => b.h)));
section('bldMinHeight', new Float32Array(buildings.map((b) => b.minH)));
section('bldKind', new Uint8Array(buildings.map((b) => b.kind)));
section('bldRoof', new Uint8Array(buildings.map((b) => b.roof)));
packPolys('area', areas);
section('areaKind', new Uint8Array(areas.map((a) => a.kind)));
packPolys('water', waters);
packLines('ww', waterways);
section('wwWidth', new Float32Array(waterways.map((w) => w.width)));
packLines('rail', rails);
section('railFlags', new Uint8Array(rails.flatMap((r) => [r.bridge, r.tunnel, r.layer + 4, r.service | (r.metro << 1)])));
section('trees', new Float32Array(trees));
section('busStops', new Float32Array(busStops.flatMap((s) => [s.x, s.z])));
section('signals', new Float32Array(signals));

const bin = new Uint8Array(byteLen);
for (const s of sections) bin.set(new Uint8Array(s.arr.buffer, s.arr.byteOffset, s.arr.byteLength), s.offset);
const header = {
  version: 2, id: tile.id, name: tile.name, city: tile.city, center: [tile.lat, tile.lon], sizeKm: tile.sizeKm, half,
  proj: { kx, kz }, bbox: [bW, bS, bE, bN],
  terrain: { n: gn, cell: CELL },
  attribution: '© OpenStreetMap contributors (ODbL) · Copernicus DEM GLO-30 © DLR/Airbus, provided under COPERNICUS by the EU and ESA',
  busStopNames: busStops.map((s) => s.name),
  bldNames: buildings.map((b) => b.name),
  wayFlags,
  sections: sections.map(({ name, type, offset, length }) => ({ name, type, offset, length })),
};
fs.writeFileSync(path.join(outDir, 'tile.json'), JSON.stringify(header));
fs.writeFileSync(path.join(outDir, 'tile.bin'), bin);
console.log(`Baked ${tile.id}: ${buildings.length} buildings, ${areas.length} areas, ${waters.length} water polygons, ${waterways.length} waterways, ${rails.length} rail lines, ${trees.length / 2} trees, ${busStops.length} bus stops, ${signals.length / 2} signals, ${roadWays.length} road ways → bin ${(byteLen / 1e6).toFixed(2)} MB, roads.osm ${(xml.length / 1e6).toFixed(2)} MB`);
