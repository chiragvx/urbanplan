// The DP report: Pune's traced Development Plan (data/raw/cities/pune/plan.json, from tools/dp/plan.py) made small
// enough for the browser, and the facts for one indexed page per locality.
//   npm run bake:dpreport
// Reads   data/raw/cities/pune/plan.json      the traced DP parcels (city frame metres)
//         data/raw/cities/pune/places.json    OSM localities (Overpass: place=suburb|neighbourhood|locality|village)
//         data/raw/dp/widths.json             DP road widths by OSM way id (tools/dp/measure.py)
//         public/data/pune-main-roads.geojson today's main roads with their width in the model (bake:maps)
// Writes  public/dpr/pune/index.json          classes, frame, the 1 km cells that hold data
//         public/dpr/pune/c_<i>_<j>.json      parcels (simplified, lon/lat) and DP roads per 1 km cell, for the viewer
//         src/site/dpreport/generated/areas.json   one entry per locality page (+ the city summary)
//         public/dpr/pune/map/<slug>.svg + .jpg     each locality's DP map (page picture) and share card (needs ffmpeg)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { Resvg } from '@resvg/resvg-js';
import { PUNE } from '../places/places.config';

const CITY = 'pune';
const RAW = path.join('data', 'raw', 'cities', CITY);
const OUT_PUB = path.join('public', 'dpr', CITY);
const OUT_SRC = path.join('src', 'site', 'dpreport', 'generated');
const CELL = 1000;
/** radius of a locality page's report (m) */
const R = 500;

type XZ = [number, number];
interface Plot { id: string; cls: string; reserved: boolean; area: number; conf: number; sheet: string; geom: { type: 'Polygon' | 'MultiPolygon'; coordinates: any } }

const plan = JSON.parse(fs.readFileSync(path.join(RAW, 'plan.json'), 'utf8')) as { frame: { lat: number; lon: number }; sheets: string[]; plots: Plot[] };
const region = JSON.parse(fs.readFileSync(path.join('public', 'regions', CITY, 'region.json'), 'utf8'));
const dpClasses = JSON.parse(fs.readFileSync(path.join('public', 'regions', CITY, 'dp', 'regions.json'), 'utf8')).classes as Record<string, { label: string; color: string }>;
const F = region.frame as { lat0: number; lon0: number; kx: number; kz: number };
if (Math.abs(F.lat0 - plan.frame.lat) > 1e-9 || Math.abs(F.lon0 - plan.frame.lon) > 1e-9) throw new Error('plan.json and region.json frames differ');

const ll = (x: number, z: number): XZ => [+(F.lon0 + x / F.kx).toFixed(6), +(F.lat0 - z / F.kz).toFixed(6)]; // [lon, lat]
const xz = (lat: number, lon: number): XZ => [(lon - F.lon0) * F.kx, -(lat - F.lat0) * F.kz];
const r1 = (v: number) => Math.round(v * 10) / 10;

// ---------------- geometry ----------------

function simplify(pts: XZ[], tol: number): XZ[] {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st: [number, number][] = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop()!;
    const [ax, az] = pts[a], [bx, bz] = pts[b], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1e-9;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / L;
      if (d > best) { best = d; bi = i; }
    }
    if (best > tol) { keep[bi] = 1; st.push([a, bi], [bi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
/** a closed ring, simplified: split in two at the far point so the ends are anchored */
function simplifyRing(ring: XZ[], tol: number): XZ[] {
  const r = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
  if (r.length < 5) return r;
  let far = 0, fd = -1;
  for (let i = 1; i < r.length; i++) { const d = (r[i][0] - r[0][0]) ** 2 + (r[i][1] - r[0][1]) ** 2; if (d > fd) { fd = d; far = i; } }
  const a = simplify(r.slice(0, far + 1), tol), b = simplify([...r.slice(far), r[0]], tol);
  return [...a, ...b.slice(1, -1)];
}
function inRing(x: number, z: number, r: XZ[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
const ringArea = (r: XZ[]) => { let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j][0] + r[i][0]) * (r[j][1] - r[i][1]); return Math.abs(s) / 2; };

/** each plot as polygons (outer + holes) in frame metres, simplified, with its bbox and centre */
interface P2 { p: Plot; polys: XZ[][][]; box: [number, number, number, number]; c: XZ }
const plots: P2[] = plan.plots.map((p) => {
  const raw: XZ[][][] = p.geom.type === 'Polygon' ? [p.geom.coordinates] : p.geom.coordinates;
  const polys = raw.map((poly) => poly.map((ring) => simplifyRing(ring, 1.2)).filter((r) => r.length >= 3)).filter((poly) => poly.length);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, cx = 0, cz = 0, wa = 0;
  for (const poly of polys) {
    const a = ringArea(poly[0]);
    let sx = 0, sz = 0;
    for (const [x, z] of poly[0]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); sx += x; sz += z; }
    cx += (sx / poly[0].length) * a; cz += (sz / poly[0].length) * a; wa += a;
  }
  return { p, polys, box: [x0, z0, x1, z1], c: [cx / (wa || 1), cz / (wa || 1)] };
}).filter((q) => q.polys.length);

const hit = (q: P2, x: number, z: number) => x >= q.box[0] && x <= q.box[2] && z >= q.box[1] && z <= q.box[3] &&
  q.polys.some((poly) => inRing(x, z, poly[0]) && !poly.slice(1).some((h) => inRing(x, z, h)));

// the parcels by 1 km cell of their bbox (a parcel goes in every cell its bbox touches: the viewer needs no neighbours)
const cellKey = (i: number, j: number) => `${i}_${j}`;
const byCell = new Map<string, P2[]>();
for (const q of plots) {
  for (let i = Math.floor(q.box[0] / CELL); i <= Math.floor(q.box[2] / CELL); i++) for (let j = Math.floor(q.box[1] / CELL); j <= Math.floor(q.box[3] / CELL); j++) {
    const k = cellKey(i, j); (byCell.get(k) ?? byCell.set(k, []).get(k)!).push(q);
  }
}
const near = (x: number, z: number, r: number): P2[] => {
  const out = new Set<P2>();
  for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) for (const q of byCell.get(cellKey(i, j)) ?? []) out.add(q);
  return [...out];
};

// ---------------- DP roads: today's main roads that carry a traced DP width ----------------

const widths = JSON.parse(fs.readFileSync(path.join('data', 'raw', 'dp', 'widths.json'), 'utf8')) as Record<string, { w: number; n: number; iqr: number }>;
const roadsGj = JSON.parse(fs.readFileSync(path.join('public', 'data', `${CITY}-main-roads.geojson`), 'utf8'));
interface DpRoad { name: string | null; w: number; dp: number; pts: XZ[]; len: number }
const dpRoads: DpRoad[] = [];
for (const f of roadsGj.features) {
  const ws = (f.properties.osm_way_ids as number[]).map((id) => widths[String(id)]).filter((v) => v && v.n >= 4 && v.iqr <= 6);
  if (!ws.length || f.geometry.type !== 'LineString') continue;
  ws.sort((a, b) => b.n - a.n);
  const pts = (f.geometry.coordinates as [number, number][]).map(([lon, lat]) => xz(lat, lon));
  let len = 0; for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  dpRoads.push({ name: f.properties.name, w: f.properties.width_m, dp: ws[0].w, pts, len });
}
const roadsByCell = new Map<string, DpRoad[]>();
for (const r of dpRoads) {
  const cells = new Set(r.pts.map(([x, z]) => cellKey(Math.floor(x / CELL), Math.floor(z / CELL))));
  for (const k of cells) (roadsByCell.get(k) ?? roadsByCell.set(k, []).get(k)!).push(r);
}

// ---------------- the viewer's files ----------------

fs.mkdirSync(OUT_PUB, { recursive: true });
for (const f of fs.readdirSync(OUT_PUB)) if (/^c_.*\.json$/.test(f)) fs.unlinkSync(path.join(OUT_PUB, f));
const cells = new Set([...byCell.keys(), ...roadsByCell.keys()]);
let bytes = 0;
for (const k of cells) {
  const P = (byCell.get(k) ?? []).map((q) => ({
    id: q.p.id, c: q.p.cls, ...(q.p.reserved ? { r: 1 } : {}), a: Math.round(q.p.area), k: r1(q.p.conf), s: q.p.sheet,
    g: q.polys.map((poly) => poly.map((ring) => ring.flatMap(([x, z]) => [Math.round(x * 2), Math.round(z * 2)]))),
  }));
  const Rd = (roadsByCell.get(k) ?? []).map((r) => ({ n: r.name, w: r1(r.w), dp: r.dp, g: r.pts.flatMap(([x, z]) => [Math.round(x * 2), Math.round(z * 2)]) }));
  const s = JSON.stringify({ plots: P, roads: Rd });
  bytes += s.length;
  fs.writeFileSync(path.join(OUT_PUB, `c_${k}.json`), s);
}
const [cs, cw] = ll(0, 0);
fs.writeFileSync(path.join(OUT_PUB, 'index.json'), JSON.stringify({
  city: CITY, cell: CELL, frame: F, /** geometry in the cells: flat [x, z, …] in half metres of the city frame (x east, z south) */ unit: 0.5, classes: dpClasses, sheets: plan.sheets, cells: [...cells].sort(),
  center: [cw, cs], tiles: 'regions/pune/dp/index.json',
  source: 'Pune Municipal Corporation, Development Plan for the old limits (2007–2027), sanctioned 5 Jan 2017: scanned sheets, traced',
}));

// ---------------- the locality pages ----------------

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
interface Cand { name: string; aka?: string[]; lat: number; lon: number; kind: string }
const osm = JSON.parse(fs.readFileSync(path.join(RAW, 'places.json'), 'utf8')).elements as { lat: number; lon: number; tags: Record<string, string> }[];
const cands: Cand[] = [
  ...PUNE.map((p) => ({ name: p.name, aka: p.aka, lat: p.lat, lon: p.lon, kind: 'place' })),
  ...osm.filter((e) => ['suburb', 'neighbourhood', 'quarter'].includes(e.tags.place) || (e.tags.place === 'locality' && !/society|colony|housing|wing/i.test(e.tags.name ?? '')))
    .map((e) => ({ name: (e.tags['name:en'] || e.tags.name || '').trim(), lat: e.lat, lon: e.lon, kind: e.tags.place }))
    .filter((c) => c.name && /^[\x20-\x7e]+$/.test(c.name) && !/society|apartment|housing|wing|\(/i.test(c.name)),
];

const sample = (x: number, z: number) => { for (const q of near(x, z, 0)) if (hit(q, x, z)) return q; return null; };

interface AreaOut {
  slug: string; name: string; aka?: string[]; lat: number; lon: number; r: number;
  /** share of the circle by DP land use (%), the rest is roads or unmarked */
  mix: { cls: string; pct: number; ha: number }[]; roadPct: number;
  /** what's at the centre point */
  centre: { cls: string; reserved: boolean } | null;
  reserved: { id: string; cls: string; ha: number; m: number; dir: string; lat: number; lon: number; conf: number }[];
  dpRoads: { name: string; w: number; dp: number; m: number }[];
  sheets: string[]; parcels: number; nearby: string[];
}
const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const dirOf = (dx: number, dz: number) => DIRS[Math.round(((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360 / 45) % 8];

const areas: AreaOut[] = [];
const taken = new Set<string>();
for (const c of cands) {
  const [x, z] = xz(c.lat, c.lon), s = slug(c.name);
  if (!s || taken.has(s)) continue;
  if (areas.some((a) => { const [ax, az] = xz(a.lat, a.lon); return Math.hypot(ax - x, az - z) < 350; })) continue;
  // land-use mix: a 10 m grid over the circle
  const STEP = 10, tally = new Map<string, number>(); let tot = 0, none = 0;
  const pool = near(x, z, R);
  for (let dx = -R; dx <= R; dx += STEP) for (let dz = -R; dz <= R; dz += STEP) {
    if (dx * dx + dz * dz > R * R) continue;
    tot++;
    const px = x + dx, pz = z + dz;
    const q = pool.find((q) => hit(q, px, pz));
    if (q) tally.set(q.p.cls, (tally.get(q.p.cls) ?? 0) + 1); else none++;
  }
  const marked = tot - none;
  if (marked / tot < 0.45 || pool.length < 15) continue; // outside the plan's sheets (or the edge of them)
  taken.add(s);
  const cell = (STEP * STEP) / 1e4;
  const mix = [...tally].map(([cls, n]) => ({ cls, pct: Math.round((n / tot) * 1000) / 10, ha: r1(n * cell) })).sort((a, b) => b.pct - a.pct);
  const centre = sample(x, z);
  const reserved = pool.filter((q) => q.p.reserved && Math.hypot(q.c[0] - x, q.c[1] - z) <= R && q.p.area >= 150)
    .map((q) => { const [lon, lat] = ll(q.c[0], q.c[1]); return { id: q.p.id, cls: q.p.cls, ha: Math.round(q.p.area / 100) / 100, m: Math.round(Math.hypot(q.c[0] - x, q.c[1] - z) / 10) * 10, dir: dirOf(q.c[0] - x, q.c[1] - z), lat, lon, conf: r1(q.p.conf) }; })
    .sort((a, b) => a.m - b.m).slice(0, 30);
  const rd = new Map<string, { name: string; w: number; dp: number; m: number }>();
  for (const k of new Set(near(x, z, R).length ? [...Array(9)].map((_, i) => cellKey(Math.floor(x / CELL) + (i % 3) - 1, Math.floor(z / CELL) + Math.floor(i / 3) - 1)) : [])) for (const r of roadsByCell.get(k) ?? []) {
    if (!r.name) continue;
    const m = Math.min(...r.pts.map(([px, pz]) => Math.hypot(px - x, pz - z)));
    if (m > R) continue;
    const prev = rd.get(r.name);
    if (!prev || m < prev.m) rd.set(r.name, { name: r.name, w: r1(r.w), dp: r.dp, m: Math.round(m / 10) * 10 });
  }
  areas.push({
    slug: s, name: c.name, ...(c.aka?.length ? { aka: c.aka } : {}), lat: +c.lat.toFixed(5), lon: +c.lon.toFixed(5), r: R,
    mix, roadPct: Math.round((none / tot) * 1000) / 10,
    centre: centre ? { cls: centre.p.cls, reserved: centre.p.reserved } : null,
    reserved, dpRoads: [...rd.values()].sort((a, b) => a.m - b.m).slice(0, 8),
    sheets: [...new Set(pool.map((q) => q.p.sheet))].sort(), parcels: pool.length, nearby: [],
  });
}
for (const a of areas) {
  const [x, z] = xz(a.lat, a.lon);
  a.nearby = areas.filter((b) => b !== a).map((b) => { const [bx, bz] = xz(b.lat, b.lon); return [b.slug, Math.hypot(bx - x, bz - z)] as const; })
    .sort((p, q) => p[1] - q[1]).slice(0, 6).map((p) => p[0]);
}
areas.sort((a, b) => a.name.localeCompare(b.name));

// ---------------- each locality's DP map: the page's picture (SVG) and its share card (JPG) ----------------

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** A ring clipped to a box (Sutherland–Hodgman): big parcels reaching far off the map would otherwise be drawn whole. */
function clipRing(ring: XZ[], x0: number, z0: number, x1: number, z1: number): XZ[] {
  let out = ring;
  const edges: [(p: XZ) => boolean, (a: XZ, b: XZ) => XZ][] = [
    [(p) => p[0] >= x0, (a, b) => [x0, a[1] + (b[1] - a[1]) * (x0 - a[0]) / (b[0] - a[0])]],
    [(p) => p[0] <= x1, (a, b) => [x1, a[1] + (b[1] - a[1]) * (x1 - a[0]) / (b[0] - a[0])]],
    [(p) => p[1] >= z0, (a, b) => [a[0] + (b[0] - a[0]) * (z0 - a[1]) / (b[1] - a[1]), z0]],
    [(p) => p[1] <= z1, (a, b) => [a[0] + (b[0] - a[0]) * (z1 - a[1]) / (b[1] - a[1]), z1]],
  ];
  for (const [inside, cut] of edges) {
    const src = out; out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[i], b = src[(i + 1) % src.length];
      if (inside(b)) { if (!inside(a)) out.push(cut(a, b)); out.push(b); }
      else if (inside(a)) out.push(cut(a, b));
    }
    if (!out.length) break;
  }
  return out;
}

/** the plan within `half` m of a point, drawn into a `size` px square */
function mapSvg(a: AreaOut, half: number, size: number): string {
  const [cx, cz] = xz(a.lat, a.lon), k = size / (2 * half);
  const P = ([x, z]: XZ) => `${((x - cx + half) * k).toFixed(1)},${((z - cz + half) * k).toFixed(1)}`;
  const inBox = (b: number[]) => b[2] >= cx - half && b[0] <= cx + half && b[3] >= cz - half && b[1] <= cz + half;
  const polys: string[] = [], res: string[] = [];
  for (const q of near(cx, cz, half * 1.5)) {
    if (!inBox(q.box)) continue;
    // rings that come down to under 3 distinct points at this size draw nothing (and crash resvg): drop them
    const ringD = (ring: XZ[]) => { const pts = [...new Set(clipRing(simplifyRing(ring, 2.5), cx - half * 1.05, cz - half * 1.05, cx + half * 1.05, cz + half * 1.05).map(P))]; return pts.length >= 3 ? 'M' + pts.join('L') + 'Z' : ''; };
    const d = q.polys.map((poly) => poly.map(ringD).join('')).join('');
    if (!d) continue;
    polys.push(`<path d="${d}" fill="${dpClasses[q.p.cls]?.color ?? '#ccc'}"/>`);
    if (q.p.reserved) res.push(`<path d="${d}"/>`);
  }
  const roads: string[] = [];
  for (const r of dpRoads) if (r.pts.some(([x, z]) => Math.abs(x - cx) < half && Math.abs(z - cz) < half)) roads.push(`<path d="M${r.pts.map(P).join('L')}"/>`);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
    + `<rect width="${size}" height="${size}" fill="#e9e6df"/>`
    + `<g stroke="#5b5b5b" stroke-width="0.5" stroke-linejoin="round">${polys.join('')}</g>`
    + `<g fill="none" stroke="#e5484d" stroke-width="2.2" stroke-dasharray="6 4">${res.join('')}</g>`
    + `<g fill="none" stroke="#e5484d" stroke-width="3" stroke-linecap="round" opacity="0.85">${roads.join('')}</g>`
    + `<circle cx="${size / 2}" cy="${size / 2}" r="${a.r * k}" fill="none" stroke="#0c0c0d" stroke-width="2" stroke-dasharray="8 6"/>`
    + `<circle cx="${size / 2}" cy="${size / 2}" r="6" fill="#2f5bff" stroke="#fff" stroke-width="2.5"/>`
    + `</svg>`;
}
function wrap(t: string, n: number): string[] {
  const out: string[] = []; let cur = '';
  for (const w of t.split(' ')) { if ((cur + ' ' + w).trim().length > n && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) out.push(cur);
  return out;
}
const CARD_LABEL: Record<string, string> = { psp: 'public use', ews: 'EWS housing', recreational: 'green space', local_commercial: 'local commercial', hill_slope: 'hill slope', services: 'utilities', residential: 'residential', commercial: 'commercial', industrial: 'industrial', defence: 'defence', water: 'water', forest: 'forest', transport: 'transport' };
function cardSvg(a: AreaOut, inner: string): string {
  let fs_ = 66, lines = wrap(a.name, 13);
  if (lines.length > 2) { fs_ = 50; lines = wrap(a.name, 18); }
  lines = lines.slice(0, 3);
  const top = 210, y2 = top + lines.length * (fs_ + 8) + 4;
  const title = lines.map((l, i) => `<text x="64" y="${top + i * (fs_ + 8)}" font-size="${fs_}" font-weight="700">${esc(l)}</text>`).join('');
  const m0 = a.mix[0];
  const stats: [string, string, string][] = [
    [m0 ? `${Math.round(m0.pct)}%` : '—', m0 ? (CARD_LABEL[m0.cls] ?? dpClasses[m0.cls]?.label ?? m0.cls) : 'zones', 'in the DP'],
    [String(a.reserved.length), 'reserved', 'sites'],
    [a.dpRoads.length ? `${a.dpRoads[0].dp} m` : String(a.sheets.length), a.dpRoads.length ? 'DP road' : 'DP', a.dpRoads.length ? 'width' : `sheet${a.sheets.length > 1 ? 's' : ''}`],
  ];
  const st = stats.map(([v, l, l2], i) => `<g transform="translate(${64 + i * 168} 505)"><text font-size="38" font-weight="700" fill="#ff6a2b">${esc(v)}</text><text y="30" font-size="17" fill="#b9b4ad">${esc(l)}</text><text y="52" font-size="17" fill="#b9b4ad">${esc(l2)}</text></g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">`
    + `<rect width="1200" height="630" fill="#0c0c0d"/>`
    + `<svg x="570" y="0" width="630" height="630" viewBox="0 0 630 630">${inner}</svg>`
    + `<rect x="570" width="40" height="630" fill="url(#fade)"/><defs><linearGradient id="fade"><stop offset="0" stop-color="#0c0c0d"/><stop offset="1" stop-color="#0c0c0d" stop-opacity="0"/></linearGradient></defs>`
    + `<g font-family="Inter, Segoe UI, Arial, sans-serif" fill="#ffffff">`
    + `<rect x="64" y="58" width="30" height="30" rx="8" fill="#0c0c0d" stroke="#ffffff" stroke-opacity="0.2"/><path d="M73 83L77 63M85 83L81 63" stroke="#ff6a2b" stroke-width="3" stroke-linecap="round"/>`
    + `<text x="106" y="82" font-size="26" font-weight="600">Urban<tspan font-weight="800">Plan</tspan></text>`
    + `<text x="64" y="${top - fs_ - 10}" font-size="22" fill="#ff6a2b" font-weight="600" letter-spacing="2">PUNE · DP PLAN</text>`
    + title
    + `<text x="64" y="${y2}" font-size="26" fill="#d6d1ca">Zones, reservations and DP roads</text>`
    + st + `</g></svg>`;
}
const MAP_DIR = path.join(OUT_PUB, 'map');
fs.mkdirSync(MAP_DIR, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dpr-'));
let ffmpeg = true;
for (const a of areas) {
  const svg = mapSvg(a, 650, 1000);
  fs.writeFileSync(path.join(MAP_DIR, `${a.slug}.svg`), svg);
  if (!ffmpeg) continue;
  try {
    const png = new Resvg(cardSvg(a, mapSvg(a, 650, 630).replace(/^<svg[^>]*>|<\/svg>$/g, '')), { fitTo: { mode: 'width', value: 1200 }, font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' } }).render().asPng();
    const pp = path.join(tmp, `${a.slug}.png`);
    fs.writeFileSync(pp, png);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', pp, '-q:v', '6', path.join(MAP_DIR, `${a.slug}.jpg`)]);
  } catch (e) { ffmpeg = false; console.warn('share cards skipped (ffmpeg?):', (e as Error).message); }
}
fs.rmSync(tmp, { recursive: true, force: true });

const reservedAll = plots.filter((q) => q.p.reserved);
const summary = {
  city: CITY, baked: new Date().toISOString().slice(0, 10), sheets: plan.sheets.length, parcels: plots.length,
  reserved: reservedAll.length, reservedHa: Math.round(reservedAll.reduce((s, q) => s + q.p.area, 0) / 1e4),
  dpRoadKm: r1(dpRoads.reduce((s, r) => s + r.len, 0) / 1000),
  byClass: Object.entries(plots.reduce<Record<string, number>>((m, q) => ((m[q.p.cls] = (m[q.p.cls] ?? 0) + q.p.area), m), {}))
    .map(([cls, a]) => ({ cls, ha: Math.round(a / 1e4) })).sort((a, b) => b.ha - a.ha),
  classes: dpClasses,
};
fs.mkdirSync(OUT_SRC, { recursive: true });
fs.writeFileSync(path.join(OUT_SRC, 'areas.json'), JSON.stringify({ summary, areas }));
fs.writeFileSync(path.join(OUT_SRC, 'classes.json'), JSON.stringify(dpClasses));
// the place pages (/pune/<slug>/) that have a DP page nearby (within 700 m), for links both ways
const links: Record<string, string> = {};
for (const p of PUNE) {
  const [px, pz] = xz(p.lat, p.lon);
  let best: AreaOut | null = null, bd = 700;
  for (const a of areas) { const [ax, az] = xz(a.lat, a.lon), d = Math.hypot(ax - px, az - pz); if (d < bd) { bd = d; best = a; } }
  if (best) links[p.slug] = best.slug;
}
fs.writeFileSync(path.join(OUT_SRC, 'links.json'), JSON.stringify(links));
console.log(`dp report: ${plots.length} parcels in ${cells.size} cells (${(bytes / 1e6).toFixed(1)} MB), ${dpRoads.length} DP roads, ${areas.length} locality pages`);
console.log(areas.map((a) => a.slug).join(' '));
