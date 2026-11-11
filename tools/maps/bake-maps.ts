// City map pages (/pune/map/, /pune/dp-map/, /<city>/road-width-map/, /data/): the city-wide numbers, the SVG maps,
// the share pictures and the open-data downloads, measured from the baked regions (public/regions/<city>/).
//   npm run bake:maps
// Writes src/site/maps/generated/maps.json, public/citymap/<city>/*.svg and og-*.jpg (needs ffmpeg on PATH),
// public/data/<city>-main-roads.geojson, and the icons (public/favicon.svg, apple-touch-icon.png, icon-512.png).
// Run it after `npm run bake:region` and `npm run bake:places` (the maps mark the place pages).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { Resvg } from '@resvg/resvg-js';
import { openRegion, type Region } from '../places/region';
import { samplePath } from '../../src/doc/ops';
import { carriageWidth, isOneway, laneCount, totalWidth } from '../../src/doc/xsection';
import { CLASS_LABEL, CLASS_RANK, type SectionObj } from '../../src/doc/types';
import type { PlaceData } from '../../src/site/places/facts';
import type { CityMapData, MapRoad, WidthBand } from '../../src/site/maps/types';

const OUT_JSON = 'src/site/maps/generated/maps.json';
const PLACES: PlaceData[] = JSON.parse(fs.readFileSync('src/site/places/generated/places.json', 'utf8'));
const r1 = (v: number) => Math.round(v * 10) / 10;
const rank = (s: SectionObj) => CLASS_RANK[s.cls] ?? 6;
const offGround = (s: SectionObj) => s.bridge !== 'none' || s.elevated || !!s.tunnel;
const segLen = (P: number[]) => { let L = 0; for (let k = 0; k + 3 < P.length; k += 2) L += Math.hypot(P[k + 2] - P[k], P[k + 3] - P[k + 1]); return L; };

/** The width classes the road-width maps colour by (m, kerb to kerb with footpaths), light to dark. */
export const BANDS: { lo: number; hi: number; color: string }[] = [
  { lo: 0, hi: 9, color: '#f6d3b3' },
  { lo: 9, hi: 12, color: '#f2ab72' },
  { lo: 12, hi: 18, color: '#e97f3a' },
  { lo: 18, hi: 24, color: '#cf5a17' },
  { lo: 24, hi: 30, color: '#9e3d0c' },
  { lo: 30, hi: Infinity, color: '#5e2406' },
];
const bandOf = (w: number) => BANDS.findIndex((b) => w >= b.lo && w < b.hi);

interface S { s: SectionObj; pts: number[]; len: number }

/** Every section of the city's base map, once. */
function allSections(R: Region): S[] {
  const seen = new Map<string, SectionObj>();
  for (const [i, j] of R.M.pieces as number[][]) {
    const p = R.piece(i, j);
    if (!p) continue;
    for (const o of p.objs) if (o.kind === 'section' && !seen.has(o.id)) seen.set(o.id, o as SectionObj);
  }
  const out: S[] = [];
  for (const s of seen.values()) {
    const pts: number[] = [];
    for (const q of samplePath(s.path, 12).pts) pts.push(q[0], q[1]);
    out.push({ s, pts, len: segLen(pts) });
  }
  return out;
}

/** Length-weighted median. */
function wmedian(v: [number, number][]): number {
  const a = v.filter((q) => q[1] > 0).sort((p, q) => p[0] - q[0]);
  const tot = a.reduce((s, q) => s + q[1], 0);
  let acc = 0;
  for (const [x, w] of a) { acc += w; if (acc >= tot / 2) return x; }
  return a.length ? a[a.length - 1][0] : 0;
}

const GENERIC = /(service r(oa)?d)|^(lane\b|road no|unnamed|main road$|station road$|link road$|internal road)/i;

/**
 * The named main roads, as connected runs: sections of one name joined where they share a junction (so two
 * "Station Road"s in different suburbs stay two roads). Each with its typical width on the ground.
 */
function namedRoads(R: Region, secs: S[], city: 'pune' | 'mumbai'): MapRoad[] {
  // (BRTS carriageways are the bus lanes of a road mapped on their own: not a road of their own here)
  const main = secs.filter((q) => q.s.name && rank(q.s) <= 4 && q.s.cls !== 'busway' && !GENERIC.test(q.s.name));
  const parent = new Map<string, string>();
  const find = (k: string): string => { let r = k; while (parent.get(r) !== r) r = parent.get(r)!; parent.set(k, r); return r; };
  const key = (q: S) => q.s.id;
  for (const q of main) parent.set(key(q), key(q));
  const byEnd = new Map<string, S[]>();
  for (const q of main) for (const e of [q.s.a, q.s.b]) { const k = `${q.s.name}|${e}`; (byEnd.get(k) ?? byEnd.set(k, []).get(k)!).push(q); }
  for (const list of byEnd.values()) for (let i = 1; i < list.length; i++) { const a = find(key(list[0])), b = find(key(list[i])); if (a !== b) parent.set(a, b); }
  // and where a run of the name breaks off (a flyover or a stretch mapped without the name) and picks up again
  // within 300 m: the same road
  const C = 300, cells = new Map<string, S[]>();
  const cellOf = (x: number, z: number) => `${Math.floor(x / C)},${Math.floor(z / C)}`;
  for (const q of main) for (const k of [0, q.pts.length - 2]) { const c = `${q.s.name}|${cellOf(q.pts[k], q.pts[k + 1])}`; (cells.get(c) ?? cells.set(c, []).get(c)!).push(q); }
  for (const q of main) for (const k of [0, q.pts.length - 2]) {
    const cx = Math.floor(q.pts[k] / C), cz = Math.floor(q.pts[k + 1] / C);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const o of cells.get(`${q.s.name}|${cx + dx},${cz + dz}`) ?? []) {
      if (o === q) continue;
      const near = [0, o.pts.length - 2].some((m) => Math.hypot(o.pts[m] - q.pts[k], o.pts[m + 1] - q.pts[k + 1]) <= C);
      if (near) { const a = find(key(q)), b = find(key(o)); if (a !== b) parent.set(a, b); }
    }
  }
  const groups = new Map<string, S[]>();
  for (const q of main) { const r = find(key(q)); (groups.get(r) ?? groups.set(r, []).get(r)!).push(q); }
  const places = PLACES.filter((p) => p.city === city).map((p) => ({ p, xz: R.xz(p.lat, p.lon) }));
  const out: MapRoad[] = [];
  for (const g of groups.values()) {
    const len = g.reduce((a, q) => a + q.len, 0);
    if (len < 1000) continue;
    const ground = g.filter((q) => !offGround(q.s));
    const gl = ground.reduce((a, q) => a + q.len, 0);
    if (gl < 700) continue;
    const w = wmedian(ground.map((q) => [totalWidth(q.s.parts), q.len]));
    const lanesBy = new Map<number, number>();
    for (const q of ground) { const n = laneCount(q.s.parts).all; lanesBy.set(n, (lanesBy.get(n) ?? 0) + q.len); }
    const clsBy = new Map<string, number>();
    for (const q of ground) clsBy.set(q.s.cls, (clsBy.get(q.s.cls) ?? 0) + q.len);
    const one = ground.filter((q) => isOneway(q.s.parts)).reduce((a, q) => a + q.len, 0);
    // where it is: the middle of its longest section, and the nearest place page (within 2.5 km)
    const lq = g.reduce((a, q) => (q.len > a.len ? q : a));
    const mx = lq.pts[(lq.pts.length >> 2) * 2], mz = lq.pts[(lq.pts.length >> 2) * 2 + 1];
    let near: string | undefined, nd = 2500;
    for (const { p, xz } of places) { const d = Math.hypot(xz[0] - mx, xz[1] - mz); if (d < nd) { nd = d; near = p.slug; } }
    const [lat, lon] = R.ll(mx, mz);
    out.push({
      name: g[0].s.name.split(' | ')[0], ...(g[0].s.name.includes(' | ') ? { aka: g[0].s.name.split(' | ').slice(1) } : {}), cls: CLASS_LABEL[[...clsBy].sort((p, q) => q[1] - p[1])[0][0]] ?? g[0].s.cls,
      km: r1(len / 1000), w: r1(w), cw: r1(wmedian(ground.map((q) => [carriageWidth(q.s.parts), q.len]))),
      lanes: [...lanesBy].sort((p, q) => q[1] - p[1])[0][0], oneway: one > gl / 2,
      at: [+lat.toFixed(5), +lon.toFixed(5)], ...(near ? { near } : {}),
    });
  }
  return out;
}

// ---------------- SVG ----------------

const VB = 1000;

function simplify(P: number[], tol: number): number[] {
  const n = P.length / 2;
  if (n <= 2) return P;
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = P[a * 2], az = P[a * 2 + 1], dx = P[b * 2] - ax, dz = P[b * 2 + 1] - az, L = Math.hypot(dx, dz) || 1e-9;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((P[i * 2] - ax) * dz - (P[i * 2 + 1] - az) * dx) / L; if (d > best) { best = d; bi = i; } }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(P[i * 2], P[i * 2 + 1]);
  return out;
}

/** Path data on a grid of `q` units: absolute move, then relative steps (in grid units, scaled back by the caller's transform). */
function pathD(P: number[]): string {
  let d = '', px = 0, pz = 0;
  for (let i = 0; i < P.length; i += 2) {
    const x = Math.round(P[i]), z = Math.round(P[i + 1]);
    if (i === 0) d += `M${x} ${z}`;
    else { const dx = x - px, dz = z - pz; if (!dx && !dz) continue; d += (i === 2 ? 'l' : dx < 0 ? '' : ' ') + dx + (dz < 0 ? '' : ' ') + dz; }
    px = x; pz = z;
  }
  return d.includes('l') ? d : '';
}

interface Frame { x0: number; z0: number; k: number; W: number; H: number }

/** A frame round the main roads, the longer side VB units; drawn in half units (G = 2) for a finer line. */
const G = 2;
/** simplification tolerance, grid units (half an SVG unit, ~20 m on the ground) */
const TOL = 1.8;
function frameOf(secs: S[]): Frame {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const q of secs) if (rank(q.s) <= 3) for (let k = 0; k < q.pts.length; k += 2) { x0 = Math.min(x0, q.pts[k]); x1 = Math.max(x1, q.pts[k]); z0 = Math.min(z0, q.pts[k + 1]); z1 = Math.max(z1, q.pts[k + 1]); }
  const pad = 600; x0 -= pad; z0 -= pad; x1 += pad; z1 += pad;
  const k = VB / Math.max(x1 - x0, z1 - z0);
  return { x0, z0, k, W: Math.round((x1 - x0) * k), H: Math.round((z1 - z0) * k) };
}
const toF = (F: Frame, P: number[]) => { const o: number[] = []; for (let i = 0; i < P.length; i += 2) o.push((P[i] - F.x0) * F.k * G, (P[i + 1] - F.z0) * F.k * G); return o; };

/** Scale bar and north arrow, in frame units. */
function furniture(F: Frame): string {
  const km = [1, 2, 5, 10].reduce((p, q) => (Math.abs(q * 1000 * F.k - F.W / 6) < Math.abs(p * 1000 * F.k - F.W / 6) ? q : p));
  const bw = Math.round(km * 1000 * F.k), bx = 24, by = F.H - 26;
  return `<g font-family="Inter, Segoe UI, Arial, sans-serif" font-size="16" fill="#2b2723">`
    + `<rect x="${bx - 8}" y="${by - 24}" width="${bw + 70}" height="40" rx="6" fill="#fff" fill-opacity="0.85"/>`
    + `<path d="M${bx} ${by - 6}v8h${bw}v-8" fill="none" stroke="#2b2723" stroke-width="2"/><text x="${bx + bw + 8}" y="${by + 2}">${km} km</text>`
    + `<path d="M${F.W - 34} 54l11-30 11 30-11-8z" fill="#2b2723"/><text x="${F.W - 23}" y="74" text-anchor="middle" font-size="15">N</text></g>`;
}

/** Place-page dots, labelled where there's room (greedy, the given order first). */
function markers(F: Frame, R: Region, city: string, opt: { label?: (p: PlaceData) => boolean; fill?: (p: PlaceData) => string } = {}): string {
  const list = PLACES.filter((p) => p.city === city);
  const pts = list.map((p) => { const [x, z] = R.xz(p.lat, p.lon); return { p, x: (x - F.x0) * F.k, z: (z - F.z0) * F.k }; });
  let dots = '', labels = '';
  const placed: { x: number; z: number; w: number }[] = [];
  const order = [...pts].sort((a, b) => Number(opt.label?.(b.p) ?? 0) - Number(opt.label?.(a.p) ?? 0));
  for (const q of order) {
    dots += `<circle cx="${q.x.toFixed(1)}" cy="${q.z.toFixed(1)}" r="4.5" fill="${opt.fill?.(q.p) ?? '#1d1a17'}" stroke="#fff" stroke-width="1.5"/>`;
    const name = q.p.name.replace(/ \(.*\)$/, '');
    const w = name.length * 7.4 + 8, right = q.x + 8 + w < F.W - 10;
    const lx = right ? q.x + 8 : q.x - 8 - w;
    if (placed.some((o) => Math.abs(o.x - lx - w / 2) < (o.w + w) / 2 + 4 && Math.abs(o.z - q.z) < 17)) continue;
    placed.push({ x: lx + w / 2, z: q.z, w });
    labels += `<text x="${(right ? q.x + 9 : q.x - 9).toFixed(0)}" y="${(q.z + 5).toFixed(0)}"${right ? '' : ' text-anchor="end"'}>${name.replace(/&/g, '&amp;')}</text>`;
  }
  return `<g>${dots}</g><g font-family="Inter, Segoe UI, Arial, sans-serif" font-size="13" font-weight="600" fill="#1d1a17" stroke="#fff" stroke-width="3" stroke-linejoin="round" paint-order="stroke">${labels}</g>`;
}

const svgDoc = (F: Frame, title: string, inner: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${F.W} ${F.H}" role="img"><title>${title.replace(/&/g, '&amp;')}</title><rect width="${F.W}" height="${F.H}" fill="#f2efe9"/>${inner}</svg>`;

/**
 * Polylines joined end to end where they meet (a road is many short sections; one long line per run of them makes a
 * far smaller path), then simplified at `tol` grid units.
 */
function chained(lines: number[][], tol: number): string {
  const key = (x: number, z: number) => `${Math.round(x)},${Math.round(z)}`;
  const ends = new Map<string, number[]>();
  lines.forEach((P, i) => { for (const k of [key(P[0], P[1]), key(P[P.length - 2], P[P.length - 1])]) (ends.get(k) ?? ends.set(k, []).get(k)!).push(i); });
  const used = new Uint8Array(lines.length);
  const rev = (P: number[]) => { const o: number[] = []; for (let k = P.length - 2; k >= 0; k -= 2) o.push(P[k], P[k + 1]); return o; };
  /** extend P from its last point with unused lines meeting there */
  const grow = (P: number[]) => {
    for (;;) {
      const k = key(P[P.length - 2], P[P.length - 1]);
      const nxt = (ends.get(k) ?? []).find((j) => !used[j]);
      if (nxt === undefined) return P;
      used[nxt] = 1;
      const Q = lines[nxt];
      const fwd = key(Q[0], Q[1]) === k ? Q : rev(Q);
      for (let m = 2; m < fwd.length; m++) P.push(fwd[m]);
    }
  };
  let d = '';
  for (let i = 0; i < lines.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const P = grow(rev(grow([...lines[i]])));
    d += pathD(simplify(P, tol));
  }
  return d;
}

/** Roads of these ranks as one stroked path, chained and simplified at `tol` grid units. */
function roadPaths(F: Frame, secs: S[], keep: (q: S) => boolean, tol: number): string {
  return chained(secs.filter(keep).map((q) => toF(F, q.pts)), tol);
}
const scaled = (inner: string) => `<g transform="scale(${1 / G})">${inner}</g>`;

/** The plain city map: main roads by class, local roads faint. */
function citySvg(F: Frame, R: Region, city: string, secs: S[], label: string): string {
  const minor = roadPaths(F, secs, (q) => rank(q.s) === 4 || rank(q.s) === 3, TOL);
  const major = roadPaths(F, secs, (q) => rank(q.s) <= 2, TOL);
  return svgDoc(F, `${label}: the main road network in UrbanPlan's base map`, scaled(
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round">`
    + `<path d="${minor}" stroke="#9e958a" stroke-width="2.2"/>`
    + `<path d="${major}" stroke="#ff6a2b" stroke-width="4"/></g>`) + markers(F, R, city) + furniture(F));
}

/** Main roads coloured by width class. */
function widthSvg(F: Frame, R: Region, city: string, secs: S[], label: string): string {
  const lines: number[][][] = BANDS.map(() => []);
  for (const q of secs) {
    if (rank(q.s) > 4 || q.s.tunnel) continue;
    lines[bandOf(totalWidth(q.s.parts))].push(toF(F, q.pts));
  }
  const paths = lines.map((L, i) => { const d = chained(L, TOL); return d ? `<path d="${d}" stroke="${BANDS[i].color}" stroke-width="${(2.2 + i * 0.8).toFixed(1)}"/>` : ''; }).join('');
  return svgDoc(F, `${label}: main roads coloured by their width in UrbanPlan's model`, scaled(
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round">${paths}</g>`) + markers(F, R, city) + furniture(F));
}

/** Pune: where the DP sheets are registered (the 500 m tiles) and where its road widths are traced. */
function dpSvg(F: Frame, R: Region, secs: S[], tiles: { x0: number; z0: number; size: number }[]): string {
  // the tiles, merged into runs along each row
  const rows = new Map<number, number[]>();
  for (const t of tiles) (rows.get(t.z0) ?? rows.set(t.z0, []).get(t.z0)!).push(t.x0);
  let sheet = '';
  const size = tiles[0]?.size ?? 500;
  for (const [z, xs] of rows) {
    xs.sort((a, b) => a - b);
    for (let i = 0; i < xs.length;) {
      let j = i; while (j + 1 < xs.length && xs[j + 1] === xs[j] + size) j++;
      const x = (xs[i] - F.x0) * F.k * G, y = (z - F.z0) * F.k * G, w = (xs[j] + size - xs[i]) * F.k * G, h = size * F.k * G;
      sheet += `M${Math.round(x)} ${Math.round(y)}h${Math.round(w)}v${Math.round(h)}h${-Math.round(w)}z`;
      i = j + 1;
    }
  }
  const net = roadPaths(F, secs, (q) => rank(q.s) <= 3, TOL);
  const traced = roadPaths(F, secs, (q) => !!q.s.reserve && !q.s.tunnel, 1.4);
  return svgDoc(F, "Pune: where UrbanPlan has the Development Plan sheets, and where it has traced the DP road widths", scaled(
    `<path d="${sheet}" fill="#4f7cc9" fill-opacity="0.16" stroke="none"/>`
    + `<g fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="${net}" stroke="#a69d91" stroke-width="1.6"/>`
    + `<path d="${traced}" stroke="#c0262d" stroke-width="3.2"/></g>`)
    + markers(F, R, 'pune', { label: (p) => p.dp !== 'none', fill: (p) => (p.dp === 'traced' ? '#c0262d' : p.dp === 'sheets' ? '#2f5fb3' : '#8a8178') }) + furniture(F));
}

// ---------------- the share pictures ----------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function shareSvg(kicker: string, title: string[], sub: string, stats: [string, string][], mapSvg: string): string {
  const inner = mapSvg.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '').replace(/<title>.*?<\/title>/, '');
  const vb = mapSvg.match(/viewBox="([^"]+)"/)![1];
  const top = 210;
  const t = title.map((l, i) => `<text x="64" y="${top + i * 74}" font-size="64" font-weight="700">${esc(l)}</text>`).join('');
  const y2 = top + title.length * 74 + 6;
  const st = stats.map(([v, l], i) => `<g transform="translate(${64 + i * 170} 520)"><text font-size="38" font-weight="700" fill="#ff6a2b">${esc(v)}</text><text y="30" font-size="17" fill="#b9b4ad">${esc(l)}</text></g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">`
    + `<rect width="1200" height="630" fill="#0c0c0d"/>`
    + `<svg x="590" y="0" width="610" height="630" viewBox="${vb}" preserveAspectRatio="xMidYMid slice">${inner}</svg>`
    + `<rect x="590" width="48" height="630" fill="url(#fade)"/><defs><linearGradient id="fade"><stop offset="0" stop-color="#0c0c0d"/><stop offset="1" stop-color="#0c0c0d" stop-opacity="0"/></linearGradient></defs>`
    + `<g font-family="Inter, Segoe UI, Arial, sans-serif" fill="#ffffff">`
    + `<rect x="64" y="58" width="30" height="30" rx="8" fill="#0c0c0d" stroke="#ffffff" stroke-opacity="0.2"/><path d="M73 83L77 63M85 83L81 63" stroke="#ff6a2b" stroke-width="3" stroke-linecap="round"/>`
    + `<text x="106" y="82" font-size="26" font-weight="600">Urban<tspan font-weight="800">Plan</tspan></text>`
    + `<text x="64" y="${top - 82}" font-size="22" fill="#ff6a2b" font-weight="600" letter-spacing="2">${esc(kicker.toUpperCase())}</text>`
    + t + `<text x="64" y="${y2}" font-size="26" fill="#d6d1ca">${esc(sub)}</text>` + st + `</g></svg>`;
}

function jpg(svg: string, out: string, tmp: string) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 }, font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' } }).render().asPng();
  const p = path.join(tmp, path.basename(out) + '.png');
  fs.writeFileSync(p, png);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', p, '-q:v', '5', out]);
}

// ---------------- the download ----------------

/** The main road network (expressway to collector) as GeoJSON centre lines, from OpenStreetMap through the base map. */
function geojson(R: Region, secs: S[], city: string, baked: string): { text: string; features: number } {
  const feats: string[] = [];
  for (const q of secs) {
    if (rank(q.s) > 4) continue;
    const P = simplify(q.pts, 1);
    const coords: string[] = [];
    for (let k = 0; k < P.length; k += 2) { const [la, lo] = R.ll(P[k], P[k + 1]); coords.push(`[${lo.toFixed(6)},${la.toFixed(6)}]`); }
    if (coords.length < 2) continue;
    const s = q.s, lanes = laneCount(s.parts).all;
    const props = {
      name: s.name || null, highway: s.cls, class: CLASS_LABEL[s.cls] ?? s.cls,
      width_m: r1(totalWidth(s.parts)), carriageway_m: r1(carriageWidth(s.parts)), lanes, oneway: isOneway(s.parts),
      structure: s.tunnel ? 'underpass' : s.bridge !== 'none' ? 'bridge' : 'ground',
      osm_way_ids: s.wayIds,
    };
    feats.push(`{"type":"Feature","properties":${JSON.stringify(props)},"geometry":{"type":"LineString","coordinates":[${coords.join(',')}]}}`);
  }
  const meta = {
    name: `${city === 'pune' ? 'Pune and Pimpri-Chinchwad' : 'Mumbai'}: main road network (UrbanPlan base map)`,
    license: 'ODbL-1.0', attribution: '© OpenStreetMap contributors, ODbL 1.0. Widths: UrbanPlan model from OSM tags, not a survey.',
    source: 'https://www.openstreetmap.org/copyright', baked,
  };
  return { text: `{"type":"FeatureCollection","metadata":${JSON.stringify(meta)},"features":[\n${feats.join(',\n')}\n]}\n`, features: feats.length };
}

// ---------------- icons ----------------

const MARK = (rx = 7) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="${rx}" fill="#0c0c0d"/><path d="M9 26L14 6M23 26L18 6" stroke="#ff6a2b" stroke-width="3" stroke-linecap="round"/><path d="M16 8v3M16 15v3M16 22v3" stroke="#fff" stroke-width="2"/></svg>`;
function icons() {
  fs.writeFileSync('public/favicon.svg', MARK() + '\n');
  // touch icons: square, no rounding (the platform rounds them)
  for (const [file, size] of [['public/apple-touch-icon.png', 180], ['public/icon-512.png', 512], ['public/icon-192.png', 192]] as const) {
    fs.writeFileSync(file, new Resvg(MARK(0), { fitTo: { mode: 'width', value: size } }).render().asPng());
  }
}

// ---------------- run ----------------

function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maps-'));
  const index = JSON.parse(fs.readFileSync('public/regions/index.json', 'utf8')).regions as { id: string; km2: number; counts: { roads: number; buildings: number; sections: number }; baked: string; name: string }[];
  const out: Record<string, CityMapData> = {};
  fs.mkdirSync('public/data', { recursive: true });
  for (const city of ['pune', 'mumbai'] as const) {
    const t0 = Date.now();
    const R = openRegion(city);
    const meta = index.find((r) => r.id === city)!;
    const baked = meta.baked.slice(0, 10);
    const label = city === 'pune' ? 'Pune' : 'Mumbai';
    const secs = allSections(R);
    // ---- the numbers ----
    const km = (f: (q: S) => boolean) => r1(secs.filter(f).reduce((a, q) => a + q.len, 0) / 1000);
    const byClass = Object.keys(CLASS_LABEL).map((c) => ({ cls: c, label: CLASS_LABEL[c], km: km((q) => q.s.cls === c) })).filter((c) => c.km >= 1).sort((a, b) => (CLASS_RANK[a.cls] ?? 9) - (CLASS_RANK[b.cls] ?? 9));
    const mainSecs = secs.filter((q) => rank(q.s) <= 4 && !q.s.tunnel);
    const bands: WidthBand[] = BANDS.map((b, i) => ({ lo: b.lo, hi: Number.isFinite(b.hi) ? b.hi : null, color: b.color, km: r1(mainSecs.filter((q) => bandOf(totalWidth(q.s.parts)) === i).reduce((a, q) => a + q.len, 0) / 1000) }));
    const roads = namedRoads(R, secs, city);
    const two = roads.filter((r) => !r.oneway);
    /** the first of each name (a name broken into runs far apart is listed once) */
    const once = (L: MapRoad[]) => L.filter((r, i) => L.findIndex((o) => o.name === r.name) === i);
    const widest = once([...two].sort((a, b) => b.w - a.w || b.km - a.km)).slice(0, 10);
    // (roads mapped with a single lane are left out: most are one carriageway of a pair, or a lane count tagged on one side)
    const narrowest = once([...two].filter((r) => r.km >= 1.5 && r.lanes >= 2).sort((a, b) => a.w - b.w || b.km - a.km)).slice(0, 10);
    const pairs = once(roads.filter((r) => r.oneway && r.km >= 2 && r.lanes >= 2).sort((a, b) => b.km - a.km)).slice(0, 6);
    const longest = once([...roads].sort((a, b) => b.km - a.km)).slice(0, 10);
    // ---- the maps ----
    const F = frameOf(secs);
    const dir = `public/citymap/${city}`;
    fs.mkdirSync(dir, { recursive: true });
    const files: Record<string, string> = {};
    const write = (name: string, svg: string) => { fs.writeFileSync(`${dir}/${name}`, svg); files[name] = `citymap/${city}/${name}`; return svg; };
    const map = write('roads.svg', citySvg(F, R, city, secs, label));
    const width = write('road-widths.svg', widthSvg(F, R, city, secs, label));
    let dp: CityMapData['dp'];
    let dpMap = '';
    if (city === 'pune') {
      const idx = JSON.parse(fs.readFileSync(`${R.dir}dp/index.json`, 'utf8'));
      const tiles = idx.tiles as { x0: number; z0: number; size: number }[];
      dpMap = write('dp-coverage.svg', dpSvg(F, R, secs, tiles));
      const tracedSecs = secs.filter((q) => q.s.reserve);
      const reserves = new Map<number, number>();
      for (const q of tracedSecs) reserves.set(q.s.reserve!, (reserves.get(q.s.reserve!) ?? 0) + q.len);
      const tl = (t: { x0: number; z0: number; size: number }) => R.ll(t.x0 + t.size / 2, t.z0 + t.size / 2);
      const lats = tiles.map((t) => tl(t)[0]), lons = tiles.map((t) => tl(t)[1]);
      dp = {
        sheets: idx.sheets.length, sheetNames: idx.sheets, tiles: tiles.length, km2: r1((tiles.length * (tiles[0].size ** 2)) / 1e6),
        tracedKm: r1(tracedSecs.reduce((a, q) => a + q.len, 0) / 1000), tracedRoads: new Set(tracedSecs.map((q) => q.s.name).filter(Boolean)).size,
        widths: [...reserves].filter(([, L]) => L >= 500).sort((a, b) => a[0] - b[0]).map(([w, L]) => ({ w, km: r1(L / 1000) })),
        bbox: [r1(Math.min(...lats) * 1000) / 1000, r1(Math.min(...lons) * 1000) / 1000, r1(Math.max(...lats) * 1000) / 1000, r1(Math.max(...lons) * 1000) / 1000],
      };
    }
    // ---- the share pictures ----
    const roadKm = km(() => true), mainKm = km((q) => rank(q.s) <= 4);
    const n = (v: number) => v.toLocaleString('en-IN');
    const og: Record<string, string> = {};
    const shot = (name: string, svg: string) => { jpg(svg, `${dir}/${name}`, tmp); og[name.replace(/^og-|\.jpg$/g, '')] = `citymap/${city}/${name}`; };
    shot('og-map.jpg', shareSvg(label, [`${label} 3D map`], 'Roads, buildings and terrain', [[`${n(meta.km2)} km²`, 'mapped'], [`${n(Math.round(roadKm))} km`, 'of road'], [`${Math.round(meta.counts.buildings / 1000)}k`, 'buildings']], map));
    shot('og-road-widths.jpg', shareSvg(label, [`${label} road`, 'width map'], 'Main roads by width, from open data', [[`${n(Math.round(mainKm))} km`, 'of main road'], [`${roads.length}`, 'named main roads'], [`${widest[0]?.w ?? 0} m`, 'widest, two-way']], width));
    if (dp) shot('og-dp-map.jpg', shareSvg('Pune', ['Pune DP map', 'online'], 'Development Plan sheets over today’s city', [[`${dp.sheets}`, 'DP sheets'], [`${n(Math.round(dp.km2))} km²`, 'covered'], [`${n(Math.round(dp.tracedKm))} km`, 'widths traced']], dpMap));
    // ---- the download ----
    const gj = geojson(R, secs, city, baked);
    const gjFile = `public/data/${city}-main-roads.geojson`;
    fs.writeFileSync(gjFile, gj.text);
    const gz = zlib.gzipSync(gj.text, { level: 9 }).length;
    out[city] = {
      city, baked, km2: meta.km2, area: meta.name, counts: meta.counts,
      roadKm, mainKm, deckKm: km((q) => q.s.bridge !== 'none'), underKm: km((q) => !!q.s.tunnel), byClass, bands,
      namedMain: roads.length, widest, narrowest, pairs, longest,
      center: R.ll(F.x0 + F.W / F.k / 2, F.z0 + F.H / F.k / 2).map((v) => +v.toFixed(4)) as [number, number],
      bbox: [...R.ll(F.x0, F.z0 + F.H / F.k), ...R.ll(F.x0 + F.W / F.k, F.z0)].map((v) => +v.toFixed(4)) as [number, number, number, number],
      svg: { map: files['roads.svg'], width: files['road-widths.svg'], ...(files['dp-coverage.svg'] ? { dp: files['dp-coverage.svg'] } : {}), w: F.W, h: F.H },
      og, ...(dp ? { dp } : {}),
      download: { file: gjFile.replace(/^public\//, ''), features: gj.features, bytes: Buffer.byteLength(gj.text), gzBytes: gz },
    };
    const kb = (f: string) => (fs.statSync(f).size / 1024).toFixed(0);
    console.log(`${city}: ${secs.length} sections, ${roadKm} km road (${mainKm} main), ${roads.length} named main roads; svg ${Object.keys(files).map((f) => `${f} ${kb(`${dir}/${f}`)} KB`).join(', ')}; geojson ${gj.features} features ${(gj.text.length / 1e6).toFixed(1)} MB (${(gz / 1e6).toFixed(2)} MB gz) (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    for (const f of Object.keys(files)) if (fs.statSync(`${dir}/${f}`).size > 80 * 1024) console.warn(`  ! ${dir}/${f} is over 80 KB`);
  }
  icons();
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(out));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`→ ${OUT_JSON} (${(fs.statSync(OUT_JSON).size / 1024).toFixed(0)} KB)`);
}

main();
