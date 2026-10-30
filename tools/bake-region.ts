// Region bake: a whole city from the per-cell OSM downloads (tools/fetch-region.mjs) + Copernicus DEM →
//   public/regions/<id>/region.json        manifest: frame, piece grid, ground base height, network fingerprint
//   public/regions/<id>/global.json        objects every view needs: roads, rail / metro lines, utility networks
//   public/regions/<id>/overview.bin/.json far view: 32 m terrain, simplified road lines per piece
//   public/regions/<id>/landuse.png        far view land cover (16 m a pixel)
//   public/regions/<id>/p/<i>_<j>.json/.bin one 2 km piece: terrain, water, buildings, land cover, trees, and the
//                                          document objects (sections, junctions, footpaths) that reach into it
// The road network is imported once for the whole city (dual carriageways, junction clusters and chains need whole
// roads), then cut into pieces; ids are city-wide, so a section reaching into two pieces is the same object in both.
// Run: npm run bake:region [-- pune]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fromFile } from 'geotiff';
// @ts-ignore — plain JS helpers
import { parseOsmXml } from './osmxml.mjs';
// @ts-ignore
import { smoothNetwork } from './smooth.mjs';
// @ts-ignore
import { REGIONS, regionFrame, kxOf, KZ } from './region-config.mjs';
// @ts-ignore
import { osmPolygons, buildingKind, buildingHeight, roofShape, isBuilding, areaKind, ringArea, centroid, RAIL_KINDS, WATERWAY_WIDTH } from './osm-features.mjs';
import { importNetwork } from '../src/net/importer';
import { networkObjects, railObj, utilityObjects, baseFingerprintOf, type UtilitiesFile } from '../src/doc/base';
import { bez } from '../src/net/model';
import type { Obj, SectionObj, LineObj } from '../src/doc/types';

type V2 = [number, number];
type Rect = [number, number, number, number];
const t0 = Date.now();
const log = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(0).padStart(4)} s] ${m}`);

const R = REGIONS[process.argv[2] ?? 'pune'];
const F = regionFrame(R);
const P: number = R.piece, CELL: number = R.cell;
const rawDir = path.join('data', 'raw', 'region', R.id);
const outDir = path.join('public', 'regions', R.id);
fs.rmSync(path.join(outDir, 'p'), { recursive: true, force: true });
for (const f of ['global.json', 'overview.bin', 'osm-roads.json']) fs.rmSync(path.join(outDir, f), { force: true });
fs.mkdirSync(path.join(outDir, 'p'), { recursive: true });
const proj = (n: { lat: number; lon: number }): V2 => F.proj(n.lat, n.lon);
const r2 = (v: number) => Math.round(v * 100) / 100;

// ---------------- pieces ----------------
interface Bld { id: number; outer: V2[]; holes: V2[][]; h: number; minH: number; kind: number; roof: number; name: string }
interface Poly { outer: V2[]; holes: V2[][]; kind?: number; area?: number }
interface Piece {
  i: number; j: number; rect: Rect;
  buildings: Bld[]; areas: Poly[]; waters: Poly[]; waterways: { pts: V2[]; width: number }[];
  trees: number[]; busStops: { x: number; z: number; name: string }[]; signals: number[];
}
const pieces = new Map<string, Piece>();
const pkey = (i: number, j: number) => `${i}_${j}`;
for (let j = F.j0; j <= F.j1; j++) for (let i = F.i0; i <= F.i1; i++) {
  pieces.set(pkey(i, j), { i, j, rect: [i * P, j * P, (i + 1) * P, (j + 1) * P], buildings: [], areas: [], waters: [], waterways: [], trees: [], busStops: [], signals: [] });
}
const pieceAt = (x: number, z: number) => pieces.get(pkey(Math.floor(x / P), Math.floor(z / P)));

// ---------------- geometry helpers ----------------
/** Sutherland–Hodgman: a ring clipped to an axis-aligned rectangle. */
function clipRing(ring: V2[], [x0, z0, x1, z1]: Rect): V2[] {
  let out = ring;
  const edges: [(p: V2) => boolean, (a: V2, b: V2) => V2][] = [
    [(p) => p[0] >= x0, (a, b) => { const t = (x0 - a[0]) / (b[0] - a[0]); return [x0, a[1] + (b[1] - a[1]) * t]; }],
    [(p) => p[0] <= x1, (a, b) => { const t = (x1 - a[0]) / (b[0] - a[0]); return [x1, a[1] + (b[1] - a[1]) * t]; }],
    [(p) => p[1] >= z0, (a, b) => { const t = (z0 - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, z0]; }],
    [(p) => p[1] <= z1, (a, b) => { const t = (z1 - a[1]) / (b[1] - a[1]); return [a[0] + (b[0] - a[0]) * t, z1]; }],
  ];
  for (const [inside, cut] of edges) {
    if (!out.length) break;
    const inp = out;
    out = [];
    for (let k = 0; k < inp.length; k++) {
      const a = inp[(k + inp.length - 1) % inp.length], b = inp[k];
      if (inside(b)) { if (!inside(a)) out.push(cut(a, b)); out.push(b); } else if (inside(a)) out.push(cut(a, b));
    }
  }
  return out;
}
/** A polyline clipped to a rectangle (Liang–Barsky per segment), as one or more polylines. */
function clipLine(pts: V2[], [x0, z0, x1, z1]: Rect): V2[][] {
  const out: V2[][] = [];
  let cur: V2[] = [];
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k];
    let ta = 0, tb = 1;
    const dx = b[0] - a[0], dz = b[1] - a[1];
    const p = [-dx, dx, -dz, dz], q = [a[0] - x0, x1 - a[0], a[1] - z0, z1 - a[1]];
    let ok = true;
    for (let s = 0; s < 4 && ok; s++) {
      if (p[s] === 0) { if (q[s] < 0) ok = false; continue; }
      const r = q[s] / p[s];
      if (p[s] < 0) { if (r > tb) ok = false; else if (r > ta) ta = r; } else { if (r < ta) ok = false; else if (r < tb) tb = r; }
    }
    if (!ok) { if (cur.length > 1) out.push(cur); cur = []; continue; }
    const A: V2 = [a[0] + dx * ta, a[1] + dz * ta], B: V2 = [a[0] + dx * tb, a[1] + dz * tb];
    if (!cur.length || ta > 0) { if (cur.length > 1) out.push(cur); cur = [A]; }
    cur.push(B);
    if (tb < 1) { out.push(cur); cur = []; }
  }
  if (cur.length > 1) out.push(cur);
  return out;
}
const bboxOf = (pts: V2[]): Rect => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return [x0, z0, x1, z1]; };
const overlaps = (a: Rect, b: Rect) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
function piecesOver(r: Rect): Piece[] {
  const out: Piece[] = [];
  for (let j = Math.max(F.j0, Math.floor(r[1] / P)); j <= Math.min(F.j1, Math.floor(r[3] / P)); j++)
    for (let i = Math.max(F.i0, Math.floor(r[0] / P)); i <= Math.min(F.i1, Math.floor(r[2] / P)); i++) out.push(pieces.get(pkey(i, j))!);
  return out;
}

// ---------------- city-wide rasters ----------------
// building footprints, 1 m bits (caps road widths to today's free space)
const BW = F.x1 - F.x0, BH = F.z1 - F.z0;
const bbits = new Uint8Array(Math.ceil((BW * BH) / 8));
function fillBits(rings: V2[][]) {
  let z0 = Infinity, z1 = -Infinity;
  for (const r of rings) for (const p of r) { z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  for (let j = Math.max(0, Math.floor(z0 - F.z0)); j <= Math.min(BH - 1, Math.ceil(z1 - F.z0)); j++) {
    const z = F.z0 + j + 0.5, xs: number[] = [];
    for (const r of rings) for (let k = 0; k < r.length; k++) {
      const a = r[k], b = r[(k + 1) % r.length];
      if ((a[1] > z) !== (b[1] > z)) xs.push(a[0] + ((z - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let i = Math.max(0, Math.floor(xs[k] - F.x0)); i <= Math.min(BW - 1, Math.floor(xs[k + 1] - F.x0)); i++) { const b = j * BW + i; bbits[b >> 3] |= 1 << (b & 7); }
  }
}
const buildingAt = (x: number, z: number) => {
  const i = Math.floor(x - F.x0), j = Math.floor(z - F.z0);
  if (i < 0 || j < 0 || i >= BW || j >= BH) return false;
  const b = j * BW + i;
  return (bbits[b >> 3] & (1 << (b & 7))) !== 0;
};

// terrain grid (8 m), city-wide
const GN = BW / CELL + 1, GM = BH / CELL + 1;
const water = new Uint8Array(GN * GM);
function fillGrid(rings: V2[][], mark: (k: number) => void) {
  let z0 = Infinity, z1 = -Infinity;
  for (const r of rings) for (const p of r) { z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  const j0 = Math.max(0, Math.ceil((z0 - F.z0) / CELL)), j1 = Math.min(GM - 1, Math.floor((z1 - F.z0) / CELL));
  for (let j = j0; j <= j1; j++) {
    const z = F.z0 + j * CELL, xs: number[] = [];
    for (const r of rings) for (let k = 0; k < r.length; k++) {
      const a = r[k], b = r[(k + 1) % r.length];
      if ((a[1] > z) !== (b[1] > z)) xs.push(a[0] + ((z - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - F.x0) / CELL)), i1 = Math.min(GN - 1, Math.floor((xs[k + 1] - F.x0) / CELL));
      for (let i = i0; i <= i1; i++) mark(j * GN + i);
    }
  }
}

// ---------------- pass over the downloaded cells ----------------
const netNodes = new Map<number, { id: number; lat: number; lon: number; tags: Record<string, string> }>();
const netWays = new Map<number, { id: number; nds: number[]; tags: Record<string, string> }>();
const seenPoly = new Set<string>();
const cellFiles = fs.readdirSync(rawDir).filter((f) => /^c_-?\d+_-?\d+\.osm$/.test(f));
log(`${R.id}: ${pieces.size} pieces (${F.i1 - F.i0 + 1} × ${F.j1 - F.j0 + 1}) from ${cellFiles.length} downloaded cells`);
let nB = 0, nA = 0;
for (const [ci, file] of cellFiles.entries()) {
  const [, cx, cz] = file.match(/^c_(-?\d+)_(-?\d+)\.osm$/)!.map(Number);
  const cellRect: Rect = [cx * P, cz * P, (cx + 2) * P, (cz + 2) * P];
  const own = (p: Piece | undefined) => !!p && p.rect[0] >= cellRect[0] && p.rect[2] <= cellRect[2] && p.rect[1] >= cellRect[1] && p.rect[3] <= cellRect[3];
  const osm = parseOsmXml(fs.readFileSync(path.join(rawDir, file), 'utf8'));
  // network: highways and railways, whole (deduplicated across cells)
  for (const w of osm.ways.values()) {
    const t = w.tags;
    if (!t.highway && !(t.railway && RAIL_KINDS.includes(t.railway))) continue;
    if (netWays.has(w.id)) continue;
    netWays.set(w.id, { id: w.id, nds: w.nds, tags: t });
    for (const id of w.nds) {
      if (netNodes.has(id)) continue;
      const n = osm.nodes.get(id);
      if (!n) continue;
      const tags: Record<string, string> = {};
      for (const k of ['highway', 'crossing']) if (n.tags[k]) tags[k] = n.tags[k];
      netNodes.set(id, { id, lat: n.lat, lon: n.lon, tags });
    }
  }
  // points
  for (const n of osm.nodes.values()) {
    const t = n.tags;
    if (!t.natural && !t.highway) continue;
    const [x, z] = proj(n);
    const p = pieceAt(x, z);
    if (!own(p)) continue;
    if (t.natural === 'tree') p!.trees.push(r2(x), r2(z));
    else if (t.highway === 'bus_stop') p!.busStops.push({ x: r2(x), z: r2(z), name: t.name ?? '' });
    else if (t.highway === 'traffic_signals') p!.signals.push(r2(x), r2(z));
  }
  // polygons: buildings by centroid, land cover / water clipped to each piece of this cell
  for (const poly of osmPolygons(osm, proj, (t: Record<string, string>) => isBuilding(t) || (!t.highway && areaKind(t) >= 0))) {
    if (isBuilding(poly.tags)) {
      const [x, z] = centroid(poly.outer);
      const p = pieceAt(x, z);
      if (!own(p)) continue;
      const area = Math.abs(ringArea(poly.outer));
      if (area < 6) continue;
      const kind = buildingKind(poly.tags, area);
      const { h, minH } = buildingHeight(poly.id, poly.tags, kind, area);
      p!.buildings.push({ id: poly.id, outer: poly.outer, holes: poly.holes, h, minH, kind, roof: roofShape(poly.tags), name: poly.tags.name ?? '' });
      fillBits([poly.outer]);
      nB++;
      continue;
    }
    const kind = areaKind(poly.tags);
    const key = `${poly.id}:${poly.outer.length}:${poly.outer[0][0].toFixed(1)}`;
    for (const p of piecesOver(bboxOf(poly.outer))) {
      if (!own(p) || seenPoly.has(key + '@' + pkey(p.i, p.j))) continue;
      seenPoly.add(key + '@' + pkey(p.i, p.j));
      const outer = clipRing(poly.outer, p.rect);
      if (outer.length < 3) continue;
      const area = Math.abs(ringArea(outer));
      if (area < 30) continue;
      const holes = poly.holes.map((h: V2[]) => clipRing(h, p.rect)).filter((h: V2[]) => h.length >= 3);
      if (kind === 5) { p.waters.push({ outer, holes }); fillGrid([outer, ...holes], (k) => (water[k] = 1)); }
      else p.areas.push({ outer, holes, kind, area });
      nA++;
    }
  }
  // streams / drains / canals (rivers are polygons)
  for (const w of osm.ways.values()) {
    const t = w.tags;
    if (!t.waterway || !['river', 'stream', 'canal', 'drain', 'ditch'].includes(t.waterway) || w.nds[0] === w.nds[w.nds.length - 1]) continue;
    const width = WATERWAY_WIDTH(t);
    if (!width) continue;
    const pts = w.nds.map((id: number) => osm.nodes.get(id)).filter(Boolean).map(proj);
    if (pts.length < 2) continue;
    for (const p of piecesOver(bboxOf(pts))) {
      if (!own(p) || seenPoly.has('ww' + w.id + '@' + pkey(p.i, p.j))) continue;
      seenPoly.add('ww' + w.id + '@' + pkey(p.i, p.j));
      for (const part of clipLine(pts, p.rect)) p.waterways.push({ pts: part, width });
    }
  }
  if (ci % 10 === 9 || ci === cellFiles.length - 1) log(`  cells ${ci + 1}/${cellFiles.length}: ${netWays.size.toLocaleString()} road / rail ways, ${nB.toLocaleString()} buildings, ${nA.toLocaleString()} land-cover pieces`);
}

// ---------------- terrain ----------------
log('terrain: Copernicus GLO-30 mosaic → ground model');
const H = new Float32Array(GN * GM);
{
  const tifs = await Promise.all(fs.readdirSync(path.join('data', 'raw', 'dem')).filter((f) => f.endsWith('.tif')).map(async (f) => {
    const img = await (await fromFile(path.join('data', 'raw', 'dem', f))).getImage();
    const [ox, oy] = img.getOrigin(), [rx, ry] = img.getResolution();
    return { img, ox, oy, rx, ry, w: img.getWidth(), h: img.getHeight() };
  }));
  const res = tifs[0].rx, M = 400; // degrees per pixel; metres of margin for the filters
  const sw = F.unproj(F.x0 - M, F.z1 + M), ne = F.unproj(F.x1 + M, F.z0 - M);
  const W = Math.ceil((ne.lon - sw.lon) / res) + 1, Hh = Math.ceil((ne.lat - sw.lat) / res) + 1;
  const raw = new Float32Array(W * Hh).fill(NaN);
  for (const t of tifs) {
    // the part of this tile inside the mosaic
    const px0 = Math.max(0, Math.floor((sw.lon - t.ox) / t.rx)), px1 = Math.min(t.w, Math.ceil((ne.lon - t.ox) / t.rx) + 1);
    const py0 = Math.max(0, Math.floor((ne.lat - t.oy) / t.ry)), py1 = Math.min(t.h, Math.ceil((sw.lat - t.oy) / t.ry) + 1);
    if (px1 <= px0 || py1 <= py0) continue;
    const [win] = (await t.img.readRasters({ window: [px0, py0, px1, py1] })) as unknown as Float32Array[];
    const ww = px1 - px0;
    for (let y = py0; y < py1; y++) for (let x = px0; x < px1; x++) {
      const lon = t.ox + (x + 0.5) * t.rx, lat = t.oy + (y + 0.5) * t.ry;
      const mx = Math.round((lon - sw.lon) / res), my = Math.round((ne.lat - lat) / res);
      if (mx < 0 || my < 0 || mx >= W || my >= Hh) continue;
      raw[my * W + mx] = win[(y - py0) * ww + (x - px0)];
    }
  }
  for (let k = 0; k < raw.length; k++) if (Number.isNaN(raw[k])) raw[k] = R.coastal ? 0 : k > 0 ? raw[k - 1] : 560;
  if (R.coastal) markSea(raw, W, Hh, sw, ne, res);
  // DSM → ground: min filter (radius 2 px ≈ 60 m strips buildings / trees) then Gaussian blur (σ ≈ 2 px)
  const minF = new Float32Array(W * Hh);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
    let m = Infinity;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) m = Math.min(m, raw[Math.min(Hh - 1, Math.max(0, y + dy)) * W + Math.min(W - 1, Math.max(0, x + dx))]);
    minF[y * W + x] = m;
  }
  const ground = blur2(minF, W, Hh, 2);
  for (let j = 0; j < GM; j++) for (let i = 0; i < GN; i++) {
    const { lat, lon } = F.unproj(F.x0 + i * CELL, F.z0 + j * CELL);
    const fx = (lon - sw.lon) / res, fy = (ne.lat - lat) / res;
    const x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    const g = (xx: number, yy: number) => ground[Math.min(Hh - 1, Math.max(0, yy)) * W + Math.min(W - 1, Math.max(0, xx))];
    H[j * GN + i] = (g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx) * (1 - ty) + (g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx) * ty;
  }
}
/**
 * The sea (coastal regions): Copernicus sets open water to exactly 0 m, so the grid cells whose DEM pixel is 0, in
 * patches of at least ~1 ha, are sea — except under buildings and within a few metres of a road on the ground (the
 * 30 m DEM blurs the shore; the sea wall roads must stay dry). They join the water mask (the ground is carved under
 * them) and become water polygons, one set of row-merged rectangles per piece.
 */
function markSea(raw: Float32Array, W: number, Hh: number, sw: { lat: number; lon: number }, ne: { lat: number; lon: number }, res: number) {
  // the 0 m pixels as a 0/1 field, softened (σ ≈ 1 px) and read bilinearly: the shore follows the pixels' diagonals
  // in 8 m steps instead of 30 m squares
  const I = new Float32Array(W * Hh);
  for (let k = 0; k < W * Hh; k++) I[k] = raw[k] === 0 ? 1 : 0;
  const Is = blur2(I, W, Hh, 1);
  const sea = new Uint8Array(GN * GM);
  for (let j = 0; j < GM; j++) for (let i = 0; i < GN; i++) {
    const { lat, lon } = F.unproj(F.x0 + i * CELL, F.z0 + j * CELL);
    const fx = (lon - sw.lon) / res, fy = (ne.lat - lat) / res, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    if (x0 < 0 || y0 < 0 || x0 + 1 >= W || y0 + 1 >= Hh) continue;
    const v = (Is[y0 * W + x0] * (1 - tx) + Is[y0 * W + x0 + 1] * tx) * (1 - ty) + (Is[(y0 + 1) * W + x0] * (1 - tx) + Is[(y0 + 1) * W + x0 + 1] * tx) * ty;
    if (v >= 0.5) sea[j * GN + i] = 1;
  }
  // dry land: buildings, and ground-level roads with a margin
  for (let j = 0; j < GM; j++) for (let i = 0; i < GN; i++) if (sea[j * GN + i] && buildingAt(F.x0 + i * CELL, F.z0 + j * CELL)) sea[j * GN + i] = 0;
  const dry = (x: number, z: number, r: number) => {
    for (let j = Math.max(0, Math.floor((z - r - F.z0) / CELL)); j <= Math.min(GM - 1, Math.ceil((z + r - F.z0) / CELL)); j++)
      for (let i = Math.max(0, Math.floor((x - r - F.x0) / CELL)); i <= Math.min(GN - 1, Math.ceil((x + r - F.x0) / CELL)); i++)
        if (Math.hypot(F.x0 + i * CELL - x, F.z0 + j * CELL - z) <= r) sea[j * GN + i] = 0;
  };
  for (const w of netWays.values()) {
    const t = w.tags;
    if (!t.highway || (t.bridge && t.bridge !== 'no') || (t.layer && parseInt(t.layer, 10) > 0) || t.man_made === 'pier') continue;
    const r = ['motorway', 'trunk', 'primary', 'secondary'].includes(t.highway) ? 14 : 8;
    let prev: V2 | null = null;
    for (const id of w.nds) {
      const n = netNodes.get(id);
      if (!n) { prev = null; continue; }
      const q = proj(n);
      if (prev) { const L = Math.hypot(q[0] - prev[0], q[1] - prev[1]), m = Math.max(1, Math.ceil(L / 4)); for (let s = 0; s <= m; s++) dry(prev[0] + ((q[0] - prev[0]) * s) / m, prev[1] + ((q[1] - prev[1]) * s) / m, r); }
      prev = q;
    }
  }
  // drop specks (zero-height pixels on land, tanks): 4-connected patches under 160 cells (~1 ha)
  const seen = new Uint8Array(GN * GM), stack: number[] = [];
  let nSea = 0;
  for (let k0 = 0; k0 < GN * GM; k0++) {
    if (!sea[k0] || seen[k0]) continue;
    const comp: number[] = [];
    stack.push(k0); seen[k0] = 1;
    while (stack.length) {
      const k = stack.pop()!; comp.push(k);
      const i = k % GN, j = (k - i) / GN;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const i2 = i + di, j2 = j + dj, k2 = j2 * GN + i2;
        if (i2 >= 0 && j2 >= 0 && i2 < GN && j2 < GM && sea[k2] && !seen[k2]) { seen[k2] = 1; stack.push(k2); }
      }
    }
    if (comp.length < 160) for (const k of comp) sea[k] = 0;
    else nSea += comp.length;
  }
  // into the water mask, and as polygons per piece: each cell covers ±CELL/2 around its grid point
  for (let k = 0; k < GN * GM; k++) if (sea[k]) water[k] = 1;
  for (const p of pieces.values()) {
    const gi0 = (p.rect[0] - F.x0) / CELL, gj0 = (p.rect[1] - F.z0) / CELL, N = P / CELL;
    let open: Map<string, Poly> = new Map();
    for (let j = 0; j <= N; j++) {
      const next = new Map<string, Poly>();
      for (let i = 0; i <= N; i++) {
        if (!sea[(gj0 + j) * GN + gi0 + i]) continue;
        let i1 = i;
        while (i1 + 1 <= N && sea[(gj0 + j) * GN + gi0 + i1 + 1]) i1++;
        const key = `${i}:${i1}`;
        const xa = Math.max(p.rect[0], p.rect[0] + (i - 0.5) * CELL), xb = Math.min(p.rect[2], p.rect[0] + (i1 + 0.5) * CELL);
        const za = Math.max(p.rect[1], p.rect[1] + (j - 0.5) * CELL), zb = Math.min(p.rect[3], p.rect[1] + (j + 0.5) * CELL);
        const prev = open.get(key);
        if (prev) { prev.outer[2][1] = zb; prev.outer[3][1] = zb; next.set(key, prev); open.delete(key); }
        else { const poly: Poly = { outer: [[xa, za], [xb, za], [xb, zb], [xa, zb]], holes: [] }; p.waters.push(poly); next.set(key, poly); }
        i = i1;
      }
      open = next;
    }
  }
  log(`terrain: sea ${((nSea * CELL * CELL) / 1e6).toFixed(1)} km² (Copernicus water mask, roads and buildings kept dry)`);
}
function blur2(src: Float32Array, W: number, Hh: number, sigma: number) {
  const r = Math.ceil(sigma * 3), k: number[] = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); k.push(v); sum += v; }
  for (let i = 0; i < k.length; i++) k[i] /= sum;
  const tmp = new Float32Array(W * Hh), out = new Float32Array(W * Hh);
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) { let a = 0; for (let i = -r; i <= r; i++) a += src[y * W + Math.min(W - 1, Math.max(0, x + i))] * k[i + r]; tmp[y * W + x] = a; }
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) { let a = 0; for (let i = -r; i <= r; i++) a += tmp[Math.min(Hh - 1, Math.max(0, y + i)) * W + x] * k[i + r]; out[y * W + x] = a; }
  return out;
}
// water: level field (DSM over water ≈ the surface) on a 32 m grid, river bed and banks shaped as in the tile bake
log('terrain: rivers and lakes');
const waterLevel = new Float32Array(GN * GM);
{
  const S = 4, cn = Math.ceil(GN / S), cm = Math.ceil(GM / S);
  const num = new Float32Array(cn * cm), den = new Float32Array(cn * cm);
  for (let j = 0; j < GM; j++) for (let i = 0; i < GN; i++) if (water[j * GN + i]) { const c = Math.floor(j / S) * cn + Math.floor(i / S); num[c] += H[j * GN + i]; den[c]++; }
  const N = blur2(num, cn, cm, 300 / (CELL * S)), D = blur2(den, cn, cm, 300 / (CELL * S));
  let wmin = Infinity;
  for (let k = 0; k < GN * GM; k++) if (water[k]) wmin = Math.min(wmin, H[k]);
  if (!Number.isFinite(wmin)) wmin = 0;
  for (let j = 0; j < GM; j++) for (let i = 0; i < GN; i++) {
    const fx = i / S - 0.5, fy = j / S - 0.5, x0 = Math.max(0, Math.floor(fx)), y0 = Math.max(0, Math.floor(fy));
    const x1 = Math.min(cn - 1, x0 + 1), y1 = Math.min(cm - 1, y0 + 1), tx = Math.min(1, Math.max(0, fx - x0)), ty = Math.min(1, Math.max(0, fy - y0));
    const bl = (A: Float32Array) => (A[y0 * cn + x0] * (1 - tx) + A[y0 * cn + x1] * tx) * (1 - ty) + (A[y1 * cn + x0] * (1 - tx) + A[y1 * cn + x1] * tx) * ty;
    const d = bl(D);
    waterLevel[j * GN + i] = d > 1e-4 ? bl(N) / d - 0.6 : wmin;
  }
  // distance (cells) to water / to land, two-pass chamfer
  const chamfer = (seed: (k: number) => boolean, diag: boolean) => {
    const d = new Float32Array(GN * GM).fill(1e9);
    for (let k = 0; k < GN * GM; k++) if (seed(k)) d[k] = 0;
    for (const fwd of [true, false]) for (let jj = 0; jj < GM; jj++) for (let ii = 0; ii < GN; ii++) {
      const j = fwd ? jj : GM - 1 - jj, i = fwd ? ii : GN - 1 - ii, k = j * GN + i;
      const nb = fwd ? (diag ? [[-1, 0, 1], [0, -1, 1], [-1, -1, 1.414], [1, -1, 1.414]] : [[-1, 0, 1], [0, -1, 1]]) : (diag ? [[1, 0, 1], [0, 1, 1], [1, 1, 1.414], [-1, 1, 1.414]] : [[1, 0, 1], [0, 1, 1]]);
      for (const [di, dj, c] of nb) { const i2 = i + di, j2 = j + dj; if (i2 >= 0 && j2 >= 0 && i2 < GN && j2 < GM) d[k] = Math.min(d[k], d[j2 * GN + i2] + c); }
    }
    return d;
  };
  const dist = chamfer((k) => water[k] === 1, true), inDist = chamfer((k) => water[k] === 0, false);
  for (let k = 0; k < GN * GM; k++) {
    const L = waterLevel[k];
    if (water[k]) H[k] = L - 1.2 - Math.min(3.5, inDist[k] * 0.9);
    else if (dist[k] < 6) {
      const t = dist[k] / 6, bank = L + 0.5, s = t * t * (3 - 2 * t);
      H[k] = Math.max(bank, bank + (H[k] - bank) * s);
      if (dist[k] <= 1.01) H[k] = Math.min(H[k], L + 0.6);
    }
  }
}
let hmin = Infinity, hmax = -Infinity;
for (const h of H) { hmin = Math.min(hmin, h); hmax = Math.max(hmax, h); }
const BASE = Math.floor(hmin) - 2;
const terrainAt = (x: number, z: number) => {
  let fx = (x - F.x0) / CELL, fz = (z - F.z0) / CELL;
  fx = Math.min(Math.max(fx, 0), GN - 1.0001); fz = Math.min(Math.max(fz, 0), GM - 1.0001);
  const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * GN + i;
  return (H[k] * (1 - tx) + H[k + 1] * tx) * (1 - tz) + (H[k + GN] * (1 - tx) + H[k + GN + 1] * tx) * tz - BASE;
};
log(`terrain: ${GN} × ${GM} grid at ${CELL} m, ground ${hmin.toFixed(0)}–${hmax.toFixed(0)} m`);

// ---------------- rail ----------------
const railWays = [...netWays.values()].filter((w) => w.tags.railway && RAIL_KINDS.includes(w.tags.railway)).map((w) => ({ id: w.id, nds: w.nds.filter((id) => netNodes.has(id)), tags: w.tags }));
const unprojLL = ([x, z]: V2) => F.unproj(x, z);
const st = smoothNetwork(railWays, netNodes, proj, unprojLL);
log(`rail: ${railWays.length} ways, ${st.corners} curves smoothed`);
const rails = railWays.map((w) => {
  const t = w.tags;
  const pts = w.nds.map((id) => netNodes.get(id)).filter(Boolean).map((n) => proj(n!));
  return {
    id: w.id, pts, bridge: !!t.bridge && t.bridge !== 'no', tunnel: !!t.tunnel && t.tunnel !== 'no', layer: parseInt(t.layer ?? '0', 10) || 0,
    service: !!t.service, metro: t.railway === 'subway' || t.railway === 'light_rail' || /metro/i.test(t.name ?? ''),
  };
}).filter((r) => r.pts.length >= 2);
const groundRails: V2[][] = [], viaducts: V2[][] = [];
for (const r of rails) { if (r.bridge || r.layer > 0) viaducts.push(r.pts); else if (!r.tunnel) groundRails.push(r.pts); }

// ---------------- road network ----------------
log(`network: importing ${[...netWays.values()].filter((w) => w.tags.highway).length.toLocaleString()} road ways`);
const dpFile = path.join('data', 'raw', 'dp', 'widths.json');
const net = importNetwork({
  nodes: netNodes as never, ways: [...netWays.values()].filter((w) => w.tags.highway) as never,
  proj: (n) => proj(n), half: Math.max(-F.x0, F.x1, -F.z0, F.z1), bounds: [F.x0, F.z0, F.x1, F.z1],
  groundRails, viaducts, terrain: terrainAt, buildingAt,
  dpWidths: R.dp && fs.existsSync(dpFile) ? JSON.parse(fs.readFileSync(dpFile, 'utf8')) : undefined,
  log: (m) => log('  ' + m),
});
log(`network: ${net.nodes.length.toLocaleString()} nodes, ${net.segments.length.toLocaleString()} pieces, ${Object.keys(net.types).length} road types`);
const objs = networkObjects(net);
const fingerprint = baseFingerprintOf(objs.map((o) => o.id));

// ---------------- cut the document into pieces ----------------
const PAD = 64; // a section reaching this close to a piece belongs to it too (junctions at edges see their arms)
const pieceObjs = new Map<string, Set<string>>();
const roads: Obj[] = [], globalLines: Obj[] = [];
const byId = new Map<string, Obj>(objs.map((o) => [o.id, o]));
const add = (p: Piece, id: string) => (pieceObjs.get(pkey(p.i, p.j)) ?? pieceObjs.set(pkey(p.i, p.j), new Set()).get(pkey(p.i, p.j))!).add(id);
for (const o of objs) {
  if (o.kind === 'road') { roads.push(o); continue; }
  if (o.kind === 'section') {
    const pts: V2[] = [];
    for (const a of (o as SectionObj).path) pts.push([a.x, a.z], [a.x + a.ix, a.z + a.iz], [a.x + a.ox, a.z + a.oz]);
    const b = bboxOf(pts);
    for (const p of piecesOver([b[0] - PAD, b[1] - PAD, b[2] + PAD, b[3] + PAD])) { add(p, o.id); add(p, (o as SectionObj).a); add(p, (o as SectionObj).b); }
  } else if (o.kind === 'line') {
    const l = o as LineObj, pts: V2[] = [];
    for (let k = 0; k < l.pts.length; k += 2) pts.push([l.pts[k], l.pts[k + 1]]);
    for (const p of piecesOver(bboxOf(pts))) add(p, o.id);
  }
}
// rail / metro lines and the utility networks are city-wide objects (few, long)
for (const r of rails) globalLines.push(railObj({ ...r, pts: new Float32Array(r.pts.flat()) } as never, 'rl' + r.id));
for (const [tid, at] of Object.entries(R.legacy ?? {}) as [string, { lat: number; lon: number }][]) {
  const uf = path.join('public', 'tiles', tid, 'utilities.json');
  if (!fs.existsSync(uf)) continue;
  const U = JSON.parse(fs.readFileSync(uf, 'utf8')) as UtilitiesFile;
  const sx = F.kx / kxOf(at.lat), ox = (at.lon - R.lon0) * F.kx, oz = -(at.lat - R.lat0) * KZ;
  for (const L of U.layers) for (const ln of L.lines) for (let k = 0; k < ln.pts.length; k += 2) { ln.pts[k] = ln.pts[k] * sx + ox; ln.pts[k + 1] = ln.pts[k + 1] + oz; }
  globalLines.push(...utilityObjects(U));
  log(`utilities: ${U.layers.length} networks from the ${tid} tile, moved into the city frame`);
}

// ---------------- write the pieces ----------------
class Bin {
  sections: { name: string; type: string; offset: number; length: number }[] = [];
  parts: Uint8Array[] = [];
  len = 0;
  add(name: string, arr: Float32Array | Uint32Array | Uint16Array | Uint8Array) {
    const pad = (4 - (this.len % 4)) % 4;
    if (pad) { this.parts.push(new Uint8Array(pad)); this.len += pad; }
    this.sections.push({ name, type: arr.constructor.name, offset: this.len, length: arr.length });
    this.parts.push(new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength));
    this.len += arr.byteLength;
  }
  polys(name: string, list: { outer: V2[]; holes: V2[][] }[]) {
    const pts: number[] = [], polyRing: number[] = [], ringStart: number[] = [], ringCount: number[] = [];
    for (const p of list) {
      polyRing.push(ringStart.length, 1 + p.holes.length);
      for (const r of [p.outer, ...p.holes]) { ringStart.push(pts.length / 2); ringCount.push(r.length); for (const [x, z] of r) pts.push(r2(x), r2(z)); }
    }
    this.add(name + 'Pts', new Float32Array(pts)); this.add(name + 'Poly', new Uint32Array(polyRing));
    this.add(name + 'RingStart', new Uint32Array(ringStart)); this.add(name + 'RingCount', new Uint32Array(ringCount));
  }
  lines(name: string, list: { pts: V2[] }[]) {
    const pts: number[] = [], start: number[] = [], count: number[] = [];
    for (const l of list) { start.push(pts.length / 2); count.push(l.pts.length); for (const [x, z] of l.pts) pts.push(r2(x), r2(z)); }
    this.add(name + 'Pts', new Float32Array(pts)); this.add(name + 'Start', new Uint32Array(start)); this.add(name + 'Count', new Uint32Array(count));
  }
  write(file: string) { fs.writeFileSync(file + '.gz', zlib.gzipSync(Buffer.concat(this.parts.map((p) => Buffer.from(p.buffer, p.byteOffset, p.byteLength))), { level: 9 })); }
}
const PN = P / CELL + 1; // grid vertices along a piece edge (shared with the neighbour)
const HQ = 0.02; // height step (m) of the quantised piece terrain
let written = 0, bytes = 0;
const pieceList: [number, number, number][] = [];
for (const p of pieces.values()) {
  const gi0 = (p.rect[0] - F.x0) / CELL, gj0 = (p.rect[1] - F.z0) / CELL;
  // heights in 2 cm steps above the city's base (16 bits: 0–1310 m); the water grids only where there's water
  const q = (h: number) => Math.max(0, Math.min(65535, Math.round((h - BASE) / HQ)));
  const terr = new Uint16Array(PN * PN), lvl = new Uint16Array(PN * PN), wm = new Uint8Array(PN * PN);
  let wet = false;
  for (let j = 0; j < PN; j++) for (let i = 0; i < PN; i++) { const k = (gj0 + j) * GN + gi0 + i; terr[j * PN + i] = q(H[k]); lvl[j * PN + i] = q(waterLevel[k]); wm[j * PN + i] = water[k]; if (water[k]) wet = true; }
  p.areas.sort((a, b) => b.area! - a.area!);
  const bin = new Bin();
  bin.add('terrain', terr);
  if (wet || p.waters.length || p.waterways.length) { bin.add('waterLevel', lvl); bin.add('waterMask', wm); }
  bin.polys('bld', p.buildings);
  bin.add('bldHeight', new Float32Array(p.buildings.map((b) => b.h))); bin.add('bldMinHeight', new Float32Array(p.buildings.map((b) => b.minH)));
  bin.add('bldKind', new Uint8Array(p.buildings.map((b) => b.kind))); bin.add('bldRoof', new Uint8Array(p.buildings.map((b) => b.roof)));
  bin.polys('area', p.areas); bin.add('areaKind', new Uint8Array(p.areas.map((a) => a.kind!)));
  bin.polys('water', p.waters);
  bin.lines('ww', p.waterways); bin.add('wwWidth', new Float32Array(p.waterways.map((w) => w.width)));
  bin.add('trees', new Float32Array(p.trees)); bin.add('busStops', new Float32Array(p.busStops.flatMap((s) => [s.x, s.z]))); bin.add('signals', new Float32Array(p.signals));
  const ids = [...(pieceObjs.get(pkey(p.i, p.j)) ?? [])];
  const head = {
    i: p.i, j: p.j, rect: p.rect, n: PN, hq: HQ, base: BASE,
    bldIds: p.buildings.map((b) => b.id), bldNames: p.buildings.map((b) => b.name), busStopNames: p.busStops.map((s) => s.name),
    objs: ids.map((id) => byId.get(id)).filter(Boolean),
    sections: bin.sections,
  };
  const base = path.join(outDir, 'p', pkey(p.i, p.j));
  bin.write(base + '.bin');
  const js = JSON.stringify(head);
  const gz = zlib.gzipSync(js, { level: 9 });
  fs.writeFileSync(base + '.json.gz', gz);
  bytes += fs.statSync(base + '.bin.gz').size + gz.length; written++;
  pieceList.push([p.i, p.j, p.buildings.length + head.objs.length]);
}
log(`pieces: ${written} written, ${(bytes / 1e6).toFixed(0)} MB (gzipped)`);

// ---------------- overview (far view): 32 m terrain, land cover image, simplified roads per piece ----------------
{
  const S = 4, on = Math.floor((GN - 1) / S) + 1, om = Math.floor((GM - 1) / S) + 1;
  const terr = new Float32Array(on * om);
  for (let j = 0; j < om; j++) for (let i = 0; i < on; i++) terr[j * on + i] = H[j * S * GN + i * S];
  // roads: each network piece sampled every ~20 m, bucketed by the piece of its midpoint
  const CLS = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'track', 'busway', 'road'];
  const bucket = new Map<string, { pts: number[]; start: number[]; count: number[]; cls: number[]; hw: number[] }>();
  for (const s of net.segments) {
    const L = Math.hypot(s.p[6] - s.p[0], s.p[7] - s.p[1]) + Math.hypot(s.p[2] - s.p[0], s.p[3] - s.p[1]) * 0.1;
    const n = Math.max(1, Math.min(24, Math.ceil(L / 20)));
    const m = bez(s.p, 0.5), p = pieceAt(m[0], m[1]);
    if (!p) continue;
    const k = pkey(p.i, p.j);
    const b = bucket.get(k) ?? bucket.set(k, { pts: [], start: [], count: [], cls: [], hw: [] }).get(k)!;
    b.start.push(b.pts.length / 2); b.count.push(n + 1);
    for (let q = 0; q <= n; q++) { const v = bez(s.p, q / n); b.pts.push(r2(v[0]), r2(v[1])); }
    b.cls.push(Math.max(0, CLS.indexOf(s.cls)));
    const t = net.types[s.type];
    b.hw.push(t ? Math.max(t.hwL, t.hwR) : 3);
  }
  const bin = new Bin();
  bin.add('terrain', terr);
  const roadIndex: { k: string; sections: unknown }[] = [];
  for (const [k, b] of bucket) {
    const sub = new Bin();
    sub.add('pts', new Float32Array(b.pts)); sub.add('start', new Uint32Array(b.start)); sub.add('count', new Uint32Array(b.count));
    sub.add('cls', new Uint8Array(b.cls)); sub.add('hw', new Float32Array(b.hw));
    const off = bin.len;
    for (const part of sub.parts) bin.parts.push(part);
    bin.len += sub.len;
    roadIndex.push({ k, sections: sub.sections.map((s) => ({ ...s, offset: s.offset + off })) });
    // keep 4-byte alignment for the next bucket
    const pad = (4 - (bin.len % 4)) % 4;
    if (pad) { bin.parts.push(new Uint8Array(pad)); bin.len += pad; }
  }
  bin.write(path.join(outDir, 'overview.bin'));
  fs.writeFileSync(path.join(outDir, 'overview.json'), JSON.stringify({ terrain: { n: on, m: om, cell: CELL * S, x0: F.x0, z0: F.z0 }, sections: bin.sections, roads: roadIndex, classes: CLS }));
  // land cover image, 16 m a pixel
  const PX = 16, iw = BW / PX, ih = BH / PX;
  const rgb = new Uint8Array(iw * ih * 3);
  const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const AREA_COLORS: Record<number, string> = { 0: '#9a9373', 1: '#a2998a', 2: '#9d978d', 3: '#6e9246', 4: '#4e7438', 6: '#99a05e', 7: '#a59b79', 8: '#8a8984', 9: '#a88f6c', 10: '#6aa44e', 11: '#c4b48c', 12: '#7c8e59', 13: '#8b8172', 14: '#7e8a52' };
  const ground = hex('#8e8a66');
  for (let k = 0; k < iw * ih; k++) rgb.set(ground, k * 3);
  const paint = (rings: V2[][], c: number[]) => {
    let z0 = Infinity, z1 = -Infinity;
    for (const r of rings) for (const p of r) { z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
    for (let j = Math.max(0, Math.floor((z0 - F.z0) / PX)); j <= Math.min(ih - 1, Math.ceil((z1 - F.z0) / PX)); j++) {
      const z = F.z0 + (j + 0.5) * PX, xs: number[] = [];
      for (const r of rings) for (let k = 0; k < r.length; k++) { const a = r[k], b = r[(k + 1) % r.length]; if ((a[1] > z) !== (b[1] > z)) xs.push(a[0] + ((z - a[1]) / (b[1] - a[1])) * (b[0] - a[0])); }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let i = Math.max(0, Math.round((xs[k] - F.x0) / PX)); i <= Math.min(iw - 1, Math.round((xs[k + 1] - F.x0) / PX) - 1); i++) rgb.set(c, (j * iw + i) * 3);
    }
  };
  const all = [...pieces.values()];
  for (const p of all) for (const a of p.areas) paint([a.outer, ...a.holes], hex(AREA_COLORS[a.kind!] ?? '#8e8a66'));
  const bc = [150, 143, 128];
  for (const p of all) for (const b of p.buildings) paint([b.outer], bc);
  for (const p of all) for (const w of p.waters) paint([w.outer, ...w.holes], hex('#7c9fb3')); // water seen from afar (no surface mesh out there)
  fs.writeFileSync(path.join(outDir, 'landuse.png'), png(rgb, iw, ih));
  log(`overview: ${on} × ${om} terrain at ${CELL * S} m, ${bucket.size} road buckets, land cover ${iw} × ${ih} px`);
}

// ---------------- Development Plan overlay + OSM comparison lines ----------------
// the DP sheets were registered on a tile: its tile index and traced regions, moved into the city frame (the images
// stay where they are; the index points at them)
for (const [tid, at] of Object.entries(R.legacy ?? {}) as [string, { lat: number; lon: number }][]) {
  const dpDir = path.join('public', 'tiles', tid, 'dp');
  if (!fs.existsSync(path.join(dpDir, 'index.json'))) continue;
  const sx = F.kx / kxOf(at.lat), ox = (at.lon - R.lon0) * F.kx, oz = -(at.lat - R.lat0) * KZ;
  const mv = (a: number[]) => a.map((v, k) => (k % 2 === 0 ? v * sx + ox : v + oz));
  fs.mkdirSync(path.join(outDir, 'dp'), { recursive: true });
  const ix = JSON.parse(fs.readFileSync(path.join(dpDir, 'index.json'), 'utf8'));
  for (const t of ix.tiles) { t.x0 = t.x0 * sx + ox; t.z0 += oz; t.file = `../../../tiles/${tid}/dp/${t.file}`; }
  fs.writeFileSync(path.join(outDir, 'dp', 'index.json'), JSON.stringify(ix));
  const rf = path.join(dpDir, 'regions.json');
  if (fs.existsSync(rf)) {
    const rg = JSON.parse(fs.readFileSync(rf, 'utf8'));
    for (const r of rg.regions ?? []) { r.ring = mv(r.ring); if (r.holes) r.holes = r.holes.map(mv); if (r.label) r.label = mv(r.label); }
    fs.writeFileSync(path.join(outDir, 'dp', 'regions.json'), JSON.stringify(rg));
  }
  log(`DP overlay: ${ix.tiles.length} image tiles and the traced regions of the ${tid} tile, moved into the city frame`);
}
{
  const osmRoads: { id: number; hw: string; p: number[] }[] = [];
  for (const w of netWays.values()) {
    const hw = w.tags.highway;
    if (!hw || ['footway', 'path', 'steps', 'cycleway', 'pedestrian', 'bridleway', 'corridor', 'proposed', 'construction', 'platform', 'elevator'].includes(hw)) continue;
    const p: number[] = [];
    for (const id of w.nds) { const n = netNodes.get(id); if (!n) continue; const [x, z] = proj(n); p.push(Math.round(x * 10) / 10, Math.round(z * 10) / 10); }
    if (p.length >= 4) osmRoads.push({ id: w.id, hw, p });
  }
  fs.writeFileSync(path.join(outDir, 'osm-roads.json.gz'), zlib.gzipSync(JSON.stringify({ source: '© OpenStreetMap contributors (ODbL)', ways: osmRoads }), { level: 9 }));
  log(`OSM comparison: ${osmRoads.length.toLocaleString()} road ways`);
}

// ---------------- manifest + global objects ----------------
fs.writeFileSync(path.join(outDir, 'global.json.gz'), zlib.gzipSync(JSON.stringify({ roads, lines: globalLines }), { level: 9 }));
fs.writeFileSync(path.join(outDir, 'region.json'), JSON.stringify({
  version: 1, id: R.id, name: R.name, city: R.city,
  frame: { lat0: R.lat0, lon0: R.lon0, kx: F.kx, kz: F.kz },
  piece: P, cell: CELL, grid: { i0: F.i0, i1: F.i1, j0: F.j0, j1: F.j1 }, bounds: [F.x0, F.z0, F.x1, F.z1],
  base: BASE, fingerprint, legacy: R.legacy ?? {}, start: R.start ? F.proj(R.start.lat, R.start.lon).map(Math.round) : undefined,
  pieces: pieceList,
  counts: { sections: objs.filter((o) => o.kind === 'section').length, junctions: objs.filter((o) => o.kind === 'junction').length, roads: roads.length, buildings: nB },
  attribution: '© OpenStreetMap contributors (ODbL) · Copernicus DEM GLO-30 © DLR/Airbus, provided under COPERNICUS by the EU and ESA',
  baked: new Date().toISOString(),
}));
// the start menu's list of cities
{
  const f = path.join('public', 'regions', 'index.json');
  const ix: { regions: Record<string, unknown>[] } = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : { regions: [] };
  const counts = { sections: objs.filter((o) => o.kind === 'section').length, roads: roads.length, buildings: nB };
  const entry = { id: R.id, name: R.name, city: R.city, state: R.state ?? '', about: R.about ?? '', legacy: Object.keys(R.legacy ?? {}), counts, km2: Math.round(((F.x1 - F.x0) * (F.z1 - F.z0)) / 1e6), baked: new Date().toISOString() };
  ix.regions = [...ix.regions.filter((r) => r.id !== R.id), entry];
  fs.writeFileSync(f, JSON.stringify(ix, null, 1));
}
log('done');

// ---------------- PNG (RGB, no filtering) ----------------
function png(rgb: Uint8Array, w: number, h: number) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b: Buffer) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
