// Bakes raw OSM JSON into a compact binary game tile.
// GeoJSON/OSM is input only — the game never parses it at runtime.
// Usage: node tools/bake.mjs [tileId]
//
// Output: public/tiles/<id>.json (header + small tables) and public/tiles/<id>.bin (typed arrays)
// Coordinates: local metres, x = east, z = south (z = -north), origin = tile centre.
import fs from 'node:fs';
import path from 'node:path';
import { TILES, tileBBox } from './tile-config.mjs';

const tile = TILES[process.argv[2] ?? 'baner'];
const raw = JSON.parse(fs.readFileSync(path.join('data', 'raw', `${tile.id}.osm.json`), 'utf8'));
const { half } = tileBBox(tile);
const kx = 111320 * Math.cos((tile.lat * Math.PI) / 180);
const kz = 110540;
const proj = (lat, lon) => [(lon - tile.lon) * kx, -(lat - tile.lat) * kz];
const inside = (x, z, m = 0) => Math.abs(x) <= half - m && Math.abs(z) <= half - m;

// Deterministic hash → [0,1)
function rand01(n) {
  let h = (n * 2654435761) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

// ---------- Road classes ----------
// Index matters: the runtime uses the same table (src/world/tile.ts ROAD_CLASSES).
const ROAD_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'service', 'living_street', 'track', 'footway', 'cycleway', 'busway'];
function roadClass(t) {
  let h = t.highway;
  if (!h) return -1;
  h = h.replace('_link', '');
  if (h === 'unclassified' || h === 'road') h = 'residential';
  if (['path', 'pedestrian', 'steps', 'footway', 'bridleway', 'corridor'].includes(h)) h = 'footway';
  if (h === 'service' && ['parking_aisle', 'driveway', 'drive-through'].includes(t.service)) return -1;
  if (t.area === 'yes') return -1;
  return ROAD_CLASSES.indexOf(h);
}

// ---------- Collect ----------
const roadsWays = [];
const buildings = [];
const areas = [];
const waterways = [];
const trees = [];
const busStops = [];

const AREA = { residential: 0, commercial: 1, industrial: 2, park: 3, wood: 4, water: 5, farmland: 6, institution: 7, parking: 8, construction: 9, pitch: 10 };
function areaKind(t) {
  if (t.natural === 'water' || t.landuse === 'reservoir' || t.landuse === 'basin' || t.water) return AREA.water;
  if (t.natural === 'wood' || t.landuse === 'forest' || t.natural === 'scrub' || t.natural === 'heath') return AREA.wood;
  if (t.leisure === 'pitch' || t.leisure === 'stadium' || t.leisure === 'golf_course') return AREA.pitch;
  if (t.leisure || t.landuse === 'grass' || t.landuse === 'recreation_ground' || t.natural === 'grassland' || t.landuse === 'village_green' || t.landuse === 'meadow' || t.natural === 'wetland') return AREA.park;
  if (t.landuse === 'farmland' || t.landuse === 'orchard' || t.landuse === 'plant_nursery') return AREA.farmland;
  if (t.amenity === 'parking') return AREA.parking;
  if (t.amenity || t.landuse === 'education' || t.landuse === 'institutional' || t.landuse === 'military' || t.landuse === 'religious') return AREA.institution;
  if (t.landuse === 'commercial' || t.landuse === 'retail') return AREA.commercial;
  if (t.landuse === 'industrial') return AREA.industrial;
  if (t.landuse === 'construction' || t.landuse === 'brownfield' || t.landuse === 'greenfield') return AREA.construction;
  if (t.landuse === 'residential') return AREA.residential;
  if (t.natural === 'bare_rock') return AREA.construction;
  return -1;
}

// Building kinds: 0 residential, 1 commercial, 2 industrial, 3 civic/edu, 4 religious, 5 house/small, 6 informal/shed
function buildingKind(t) {
  const b = t.building;
  if (['apartments', 'residential', 'dormitory', 'hotel'].includes(b)) return 0;
  if (['commercial', 'retail', 'office', 'supermarket', 'mall', 'kiosk'].includes(b) || t.shop || t.office) return 1;
  if (['industrial', 'warehouse', 'factory', 'service', 'garage', 'garages', 'storage_tank'].includes(b)) return 2;
  if (['school', 'college', 'university', 'hospital', 'public', 'civic', 'government', 'train_station', 'transportation'].includes(b)) return 3;
  if (['temple', 'church', 'mosque', 'religious', 'shrine', 'chapel'].includes(b) || t.amenity === 'place_of_worship') return 4;
  if (['house', 'detached', 'bungalow', 'semidetached_house', 'terrace'].includes(b)) return 5;
  if (['shed', 'hut', 'roof', 'construction', 'cabin', 'container'].includes(b)) return 6;
  return -1; // unknown → infer from size
}

function polyArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % ring.length];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}

function estimateHeight(id, t, kind, area) {
  const r = rand01(id);
  if (t.height) { const h = parseFloat(t.height); if (h > 0) return { h, kind }; }
  if (t['building:levels']) { const l = parseFloat(t['building:levels']); if (l > 0) return { h: l * 3.2 + 0.6, kind: kind < 0 ? 0 : kind }; }
  // Baner-style inference: small = houses/shops, mid = 4–7 floor buildings, big = society towers / IT / malls
  let floors;
  if (kind === 6) floors = 1;
  else if (kind === 4) floors = 1 + Math.floor(r * 2);
  else if (kind === 5) floors = 1 + Math.floor(r * 3);
  else if (kind === 2) floors = 1 + Math.floor(r * 2);
  else if (area < 60) { floors = 1 + Math.floor(r * 2); kind = kind < 0 ? 6 : kind; }
  else if (area < 200) { floors = 2 + Math.floor(r * 3); kind = kind < 0 ? 5 : kind; }
  else if (area < 600) { floors = 4 + Math.floor(r * 5); kind = kind < 0 ? 0 : kind; }
  else if (area < 2500) { floors = kind === 1 ? 3 + Math.floor(r * 6) : 7 + Math.floor(r * 9); kind = kind < 0 ? 0 : kind; }
  else { floors = kind === 0 ? 10 + Math.floor(r * 10) : 3 + Math.floor(r * 6); kind = kind < 0 ? 1 : kind; }
  return { h: floors * 3.2 + 0.6, kind };
}

for (const el of raw.elements) {
  const t = el.tags ?? {};
  if (el.type === 'node') {
    const [x, z] = proj(el.lat, el.lon);
    if (!inside(x, z)) continue;
    if (t.natural === 'tree') trees.push(x, z);
    else if (t.highway === 'bus_stop') busStops.push({ x, z, name: t.name ?? '' });
    continue;
  }
  if (el.type !== 'way' || !el.geometry) continue;
  const pts = el.geometry.map((g) => (g ? proj(g.lat, g.lon) : null));
  if (pts.some((p) => !p)) continue;
  const closed = el.nodes && el.nodes.length > 3 && el.nodes[0] === el.nodes[el.nodes.length - 1];

  if (t.highway) {
    const cls = roadClass(t);
    if (cls >= 0) roadsWays.push({ id: el.id, nodes: el.nodes, pts, t, cls });
    continue;
  }
  if (t.building && closed) {
    const ring = pts.slice(0, -1);
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    if (!inside(cx, cz, 2)) continue;
    const area = Math.abs(polyArea(ring));
    if (area < 8) continue;
    const { h, kind } = estimateHeight(el.id, t, buildingKind(t), area);
    buildings.push({ ring, h: Math.min(h, 120), kind, id: el.id });
    continue;
  }
  if (t.waterway && !closed) {
    const w = t.waterway === 'river' ? 28 : t.waterway === 'canal' ? 8 : t.waterway === 'stream' ? 4 : 2.5;
    waterways.push({ pts, w });
    continue;
  }
  if (closed) {
    const kind = areaKind(t);
    if (kind < 0) continue;
    const ring = pts.slice(0, -1).map(([x, z]) => [Math.max(-half, Math.min(half, x)), Math.max(-half, Math.min(half, z))]);
    if (Math.abs(polyArea(ring)) < 20) continue;
    areas.push({ ring, kind });
  }
}

// ---------- Road graph ----------
// Split ways at shared nodes → edges between graph nodes.
const use = new Map();
for (const w of roadsWays) {
  for (let i = 0; i < w.nodes.length; i++) {
    const n = w.nodes[i];
    const isEnd = i === 0 || i === w.nodes.length - 1;
    use.set(n, (use.get(n) ?? 0) + (isEnd ? 2 : 1));
  }
}

const gNodes = []; // [x,z,...]
const gIndex = new Map();
function gNode(key, x, z) {
  let i = gIndex.get(key);
  if (i === undefined) { i = gNodes.length / 2; gNodes.push(x, z); gIndex.set(key, i); }
  return i;
}

const names = [''];
const nameIdx = new Map([['', 0]]);
function nameId(n) {
  n = (n ?? '').split(';')[0].trim();
  if (!nameIdx.has(n)) { nameIdx.set(n, names.length); names.push(n); }
  return nameIdx.get(n);
}

// Liang–Barsky clip of segment to the tile square
function clipSeg(x0, z0, x1, z1) {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dz = z1 - z0;
  const p = [-dx, dx, -dz, dz], q = [x0 + half, half - x0, z0 + half, half - z0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; }
    else {
      const r = q[i] / p[i];
      if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
      else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
  }
  return [x0 + t0 * dx, z0 + t0 * dz, x0 + t1 * dx, z0 + t1 * dz, t0, t1];
}

const edges = [];
let boundaryCounter = 0;
function pushEdge(piece, w, aKey, bKey) {
  // piece: [[x,z],...] already inside tile; aKey/bKey: osm node id or boundary key
  if (piece.length < 2) return;
  let len = 0;
  for (let i = 1; i < piece.length; i++) len += Math.hypot(piece[i][0] - piece[i - 1][0], piece[i][1] - piece[i - 1][1]);
  if (len < 0.5) return;
  const a = gNode(aKey, piece[0][0], piece[0][1]);
  const b = gNode(bKey, piece[piece.length - 1][0], piece[piece.length - 1][1]);
  edges.push({ a, b, pts: piece, w, len });
}

for (const w of roadsWays) {
  const t = w.t;
  let pts = w.pts, nodes = w.nodes;
  let oneway = t.oneway === 'yes' || t.oneway === '1' || t.oneway === 'true' || t.junction === 'roundabout' || t.highway === 'motorway' || t.highway === 'motorway_link' ? 1 : 0;
  if (t.oneway === '-1') { pts = [...pts].reverse(); nodes = [...nodes].reverse(); oneway = 1; }
  if (t.oneway === 'no') oneway = 0;
  const lanes = parseInt(t.lanes, 10);
  const meta = {
    cls: w.cls,
    oneway,
    bridge: t.bridge && t.bridge !== 'no' ? 1 : 0,
    tunnel: t.tunnel && t.tunnel !== 'no' ? 1 : 0,
    lanes: Number.isFinite(lanes) && lanes > 0 && lanes < 12 ? lanes : 0,
    name: nameId(t.name),
    alt: nameId(t.alt_name || t.loc_name || t.ref || ''),
  };
  // split at shared nodes
  let start = 0;
  for (let i = 1; i < nodes.length; i++) {
    if (i === nodes.length - 1 || (use.get(nodes[i]) ?? 0) > 1) {
      const sub = pts.slice(start, i + 1);
      const aKey = nodes[start], bKey = nodes[i];
      // clip to tile, possibly into several pieces
      let piece = [];
      let pieceStartKey = aKey;
      for (let k = 1; k < sub.length; k++) {
        const c = clipSeg(sub[k - 1][0], sub[k - 1][1], sub[k][0], sub[k][1]);
        if (!c) {
          if (piece.length) { pushEdge(piece, meta, pieceStartKey, 'B' + boundaryCounter++); piece = []; }
          continue;
        }
        const [ax, az, bx, bz, t0, t1] = c;
        if (piece.length === 0) {
          if (t0 > 0) pieceStartKey = 'B' + boundaryCounter++;
          else if (k > 1) pieceStartKey = 'B' + boundaryCounter++; // shouldn't happen
          piece.push([ax, az]);
        }
        piece.push([bx, bz]);
        if (t1 < 1) { pushEdge(piece, meta, pieceStartKey, 'B' + boundaryCounter++); piece = []; }
      }
      if (piece.length) pushEdge(piece, meta, pieceStartKey, bKey);
      start = i;
    }
  }
}

// ---------- Write binary ----------
const sections = [];
let byteLen = 0;
function section(name, arr) {
  const pad = (4 - (byteLen % 4)) % 4;
  byteLen += pad;
  sections.push({ name, type: arr.constructor.name, offset: byteLen, length: arr.length, arr, pad });
  byteLen += arr.byteLength;
}

// edges
const ePts = [];
const eA = new Uint32Array(edges.length), eB = new Uint32Array(edges.length), eP0 = new Uint32Array(edges.length), ePN = new Uint32Array(edges.length);
const eCls = new Uint8Array(edges.length), eFlags = new Uint8Array(edges.length), eLanes = new Uint8Array(edges.length);
const eName = new Uint32Array(edges.length), eAlt = new Uint32Array(edges.length);
edges.forEach((e, i) => {
  eA[i] = e.a; eB[i] = e.b; eP0[i] = ePts.length / 2; ePN[i] = e.pts.length;
  for (const [x, z] of e.pts) ePts.push(x, z);
  eCls[i] = e.w.cls; eFlags[i] = e.w.oneway | (e.w.bridge << 1) | (e.w.tunnel << 2); eLanes[i] = e.w.lanes; eName[i] = e.w.name; eAlt[i] = e.w.alt;
});

// polygons (buildings, areas) share a layout: start/count into a points array
function polys(list, extra) {
  const P = [], S = new Uint32Array(list.length), C = new Uint32Array(list.length);
  list.forEach((p, i) => { S[i] = P.length / 2; C[i] = p.ring.length; for (const [x, z] of p.ring) P.push(x, z); });
  return { P: new Float32Array(P), S, C };
}
const bp = polys(buildings);
const ap = polys(areas);
const wwPts = [], wwS = new Uint32Array(waterways.length), wwC = new Uint32Array(waterways.length), wwW = new Float32Array(waterways.length);
waterways.forEach((w, i) => { wwS[i] = wwPts.length / 2; wwC[i] = w.pts.length; wwW[i] = w.w; for (const [x, z] of w.pts) wwPts.push(x, z); });

section('nodes', new Float32Array(gNodes));
section('edgePts', new Float32Array(ePts));
section('edgeA', eA); section('edgeB', eB); section('edgeP0', eP0); section('edgePN', ePN);
section('edgeCls', eCls); section('edgeFlags', eFlags); section('edgeLanes', eLanes); section('edgeName', eName); section('edgeAlt', eAlt);
section('bldPts', bp.P); section('bldStart', bp.S); section('bldCount', bp.C);
section('bldHeight', new Float32Array(buildings.map((b) => b.h)));
section('bldKind', new Uint8Array(buildings.map((b) => b.kind)));
section('areaPts', ap.P); section('areaStart', ap.S); section('areaCount', ap.C);
section('areaKind', new Uint8Array(areas.map((a) => a.kind)));
section('wwPts', new Float32Array(wwPts)); section('wwStart', wwS); section('wwCount', wwC); section('wwWidth', wwW);
section('trees', new Float32Array(trees));
section('busStops', new Float32Array(busStops.flatMap((s) => [s.x, s.z])));

const bin = new Uint8Array(byteLen);
for (const s of sections) bin.set(new Uint8Array(s.arr.buffer, s.arr.byteOffset, s.arr.byteLength), s.offset);

const header = {
  version: 1,
  id: tile.id, name: tile.name, city: tile.city,
  center: [tile.lat, tile.lon], sizeKm: tile.sizeKm, half,
  attribution: '© OpenStreetMap contributors (ODbL)',
  roadClasses: ROAD_CLASSES,
  names,
  busStopNames: busStops.map((s) => s.name),
  sections: sections.map(({ name, type, offset, length }) => ({ name, type, offset, length })),
};
fs.mkdirSync(path.join('public', 'tiles'), { recursive: true });
fs.writeFileSync(path.join('public', 'tiles', `${tile.id}.json`), JSON.stringify(header));
fs.writeFileSync(path.join('public', 'tiles', `${tile.id}.bin`), bin);
console.log(`Baked ${tile.id}: ${gNodes.length / 2} nodes, ${edges.length} road edges, ${buildings.length} buildings, ${areas.length} areas, ${waterways.length} waterways, ${trees.length / 2} trees, ${busStops.length} bus stops → ${(byteLen / 1e6).toFixed(2)} MB`);
