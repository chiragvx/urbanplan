// Harvest plot outlines from MahaBhunakasha (Maharashtra's land records map) for our own map, one village at a time.
//
// Kept per plot: the outline, its plot number, plot id, map area and village code. Nothing else.
// Owner names, khata numbers, info links and the rest of each reply are dropped as each reply arrives, never written.
//
//   node tools/cadastre/harvest.mjs --village UCM2516000000000000000004      one village (Mundhawa)
//   node tools/cadastre/harvest.mjs --taluka U,25,16,                        every village in a taluka (CTSO 2 Pune)
//   options: --rate 1   requests per second (default 1; be polite)
//            --out data/raw/cadastre
//
// Resumable: each village appends to <giscode>.ndjson as it goes, and a re-run skips the plots already there.
// When a village is complete it is written as <giscode>.geojson (WGS84 lon/lat) plus a line in index.json.
// Ctrl C stops after the current request; run the same command again to carry on.

import fs from 'node:fs';
import path from 'node:path';
import { utmToLonLat } from './utm.mjs';

const BASE = 'https://mahabhunakasha.mahabhumi.gov.in';
const PAGE = `${BASE}/27/index.html`;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

const args = Object.fromEntries(process.argv.slice(2).reduce((o, a, i, all) => (a.startsWith('--') ? [...o, [a.slice(2), all[i + 1]]] : o), []));
const RATE = Math.max(0.1, Math.min(2, Number(args.rate ?? 1)));
const OUT = path.resolve(args.out ?? 'data/raw/cadastre');
fs.mkdirSync(OUT, { recursive: true });

let stopping = false;
process.on('SIGINT', () => { if (stopping) process.exit(130); stopping = true; console.log('\nstopping after this request… (Ctrl C again to quit now)'); });

// ---------------- the service ----------------
let cookie = '', cookieAt = 0, last = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function session() {
  if (cookie && Date.now() - cookieAt < 10 * 60_000) return cookie;
  const r = await fetch(PAGE, { redirect: 'manual', headers: { 'user-agent': UA } });
  cookie = (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter(Boolean).join('; ');
  cookieAt = Date.now();
  return cookie;
}

/** POST with the pace kept, a fresh session when the old one lapses, and backing off when the server struggles */
async function post(p, form) {
  const body = new URLSearchParams({ state: '27', ...form }).toString();
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = last + 1000 / RATE - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    try {
      const r = await fetch(`${BASE}/rest/${p}`, {
        method: 'POST', body, signal: AbortSignal.timeout(30_000),
        headers: { 'content-type': 'application/x-www-form-urlencoded', referer: PAGE, cookie: await session(), 'user-agent': UA },
      });
      if (r.status === 204) return null;                       // no such plot
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`);
      const t = await r.text();
      if (!t.trim()) return null;
      try { return JSON.parse(t); } catch { cookie = ''; throw new Error('not JSON (session lapsed?)'); }
    } catch (e) {
      const back = Math.min(120_000, 2000 * 2 ** attempt);
      console.warn(`  ${p}: ${e.message}; again in ${back / 1000}s`);
      await sleep(back);
    }
  }
  throw new Error(`${p} kept failing`);
}

// ---------------- geometry ----------------
/** WKT (MULTI)POLYGON → [[ring, hole…], …] of [x, y] */
function parseWkt(wkt) {
  const s = String(wkt ?? '');
  const polys = [];
  for (const pm of s.matchAll(/\(\s*(\([^()]*\)(?:\s*,\s*\([^()]*\))*)\s*\)/g)) {
    const rings = [...pm[1].matchAll(/\(([^()]*)\)/g)].map((rm) => rm[1].split(',').map((pt) => pt.trim().split(/\s+/).map(Number)).filter((p) => p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])).map((p) => [p[0], p[1]]));
    if (rings[0]?.length >= 4) polys.push(rings.filter((r) => r.length >= 4));
  }
  return polys;
}
const ringArea = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const j = (i + 1) % r.length; a += r[i][0] * r[j][1] - r[j][0] * r[i][1]; } return a / 2; };
const r2 = (v) => Math.round(v * 100) / 100;     // centimetres are plenty for a 1:500 map
const r7 = (v) => Math.round(v * 1e7) / 1e7;     // ~1 cm in degrees

// ---------------- a village ----------------
function readDone(file) {
  const done = new Map();
  if (!fs.existsSync(file)) return done;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const o = JSON.parse(line); done.set(o.n, o); } catch { /* a line cut short by a stop: fetched again */ }
  }
  return done;
}

async function village(g, name = '') {
  const prog = path.join(OUT, `${g}.ndjson`);
  const plots = await post('VillageMapService/kidelistFromGisCodeMH', { logedLevels: g });
  if (!Array.isArray(plots) || !plots.length) { console.log(`${g} ${name}: no plots listed`); return null; }
  const want = [...new Set(plots.map(String))];
  const done = readDone(prog);
  const todo = want.filter((n) => !done.has(n));
  console.log(`${g} ${name}: ${want.length} plots, ${done.size} already, ${todo.length} to fetch (~${Math.ceil(todo.length / RATE / 60)} min)`);
  const fd = fs.openSync(prog, 'a');
  const t0 = Date.now();
  let k = 0;
  for (const n of todo) {
    if (stopping) break;
    let rec;
    try {
      const x = await post('MapInfo/getPlotInfo', { giscode: g, plotno: n, srs: '4326' });
      // Only these fields are read from the reply. x.info, x.ownerplots and x.infoLinks are never touched.
      const geom = parseWkt(x?.the_geom).map((poly) => poly.map((ring) => ring.map(([e, nn]) => [r2(e), r2(nn)])));
      rec = geom.length
        ? { n, id: String(x.plotid ?? ''), a: Number(x.map_area) || null, g: geom }
        : { n, none: true };
    } catch (e) {
      console.warn(`  plot ${n}: ${e.message}; skipped this run`);
      continue;
    }
    fs.writeSync(fd, JSON.stringify(rec) + '\n');
    done.set(n, rec);
    if (++k % 50 === 0) {
      const per = (Date.now() - t0) / k;
      console.log(`  ${done.size}/${want.length}  (${Math.round(((todo.length - k) * per) / 60000)} min left)`);
    }
  }
  fs.closeSync(fd);
  if (want.some((n) => !done.has(n))) { console.log(`${g}: ${want.filter((n) => !done.has(n)).length} plots still to fetch; run again`); return null; }
  return finish(g, name, want, done);
}

/** the finished village as GeoJSON in lon/lat, plus a few checks */
function finish(g, name, want, done) {
  const features = [];
  let none = 0, off = 0;
  for (const n of want) {
    const r = done.get(n);
    if (!r || r.none) { none++; continue; }
    const coords = r.g.map((poly) => poly.map((ring) => ring.map(([e, nn]) => utmToLonLat(e, nn).map(r7))));
    const area = r.g.reduce((s, poly) => s + Math.abs(ringArea(poly[0])) - poly.slice(1).reduce((h, ring) => h + Math.abs(ringArea(ring)), 0), 0);
    if (r.a && Math.abs(area - r.a) / r.a > 0.05) off++;
    features.push({
      type: 'Feature',
      // plotno is exactly as the service lists it (the key to ask again); num is its leading number, for search,
      // since many carry a suffix such as "1101 iS-"
      properties: { plotno: n, num: (n.match(/^\d+/) ?? [n])[0], plotid: r.id, area: r.a ? Math.round(r.a * 100) / 100 : Math.round(area * 100) / 100, giscode: g },
      geometry: coords.length === 1 ? { type: 'Polygon', coordinates: coords[0] } : { type: 'MultiPolygon', coordinates: coords },
    });
  }
  const fc = { type: 'FeatureCollection', name: name || g, source: 'MahaBhunakasha (mahabhunakasha.mahabhumi.gov.in)', harvested: new Date().toISOString().slice(0, 10), features };
  fs.writeFileSync(path.join(OUT, `${g}.geojson`), JSON.stringify(fc));
  const idxFile = path.join(OUT, 'index.json');
  const idx = fs.existsSync(idxFile) ? JSON.parse(fs.readFileSync(idxFile, 'utf8')) : {};
  idx[g] = { name, plots: want.length, outlines: features.length, without: none, areaMismatch: off, harvested: fc.harvested };
  fs.writeFileSync(idxFile, JSON.stringify(idx, null, 1));
  console.log(`${g} ${name}: done — ${features.length} outlines, ${none} listed without one, ${off} whose drawn area is >5% off the stated area`);
  return idx[g];
}

// ---------------- main ----------------
if (args.village) {
  if (!/^[UR](CM|VM)[0-9]{22}$/.test(args.village)) throw new Error('--village takes a giscode like UCM2516000000000000000004');
  await village(args.village, args.name ?? '');
} else if (args.taluka) {
  if (!/^[UR],\d+,\d+,$/.test(args.taluka)) throw new Error('--taluka takes codes like U,25,16,');
  const list = (await post('VillageMapService/ListsAfterLevelGeoref', { level: '3', codes: args.taluka, hasmap: 'true' }))?.[0] ?? [];
  console.log(`${list.length} villages in ${args.taluka}`);
  // the list gives the 18-digit village code; the giscode is category + map type + district + taluka + village
  const [cat, dist, tal] = args.taluka.split(',');
  const pre = `${cat}${cat === 'U' ? 'CM' : 'VM'}${dist.padStart(2, '0')}${tal.padStart(2, '0')}`;
  for (const v of list) { if (stopping) break; await village(pre + String(v.code).padStart(18, '0'), v.value); }
} else {
  console.log('usage: node tools/cadastre/harvest.mjs --village <giscode> | --taluka U,25,16,  [--rate 1] [--out data/raw/cadastre]');
}
