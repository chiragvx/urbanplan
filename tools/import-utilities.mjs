// Import open Pune utility networks (sewer, stormwater drains, nallas) for a tile.
//
//   node tools/import-utilities.mjs kp                       # download (cached) + import all sources
//   node tools/import-utilities.mjs kp --offline             # only use files already in data/raw/utilities/
//   node tools/import-utilities.mjs kp --file x.kmz --layer sewer [--kind sewer] [--name Sewer]
//        [--source "Title"] [--url https://...] [--license "..."]   # import one local .kmz/.kml/.geojson
//   add --no-raw to omit props.raw (all ExtendedData as strings; ~85% of the file size)
//   node tools/import-utilities.mjs kp --inspect x.kmz       # print ExtendedData field stats, write nothing
//
// Writes public/tiles/<id>/utilities.json:
//   { version: 1, layers: [ { id, name, kind, source, url, license, retrieved,
//       lines: [ { id, pts: [x0,z0,x1,z1,...], props: { name?, diameter_mm?, material?, depth_m?, raw? } } ] } ] }
// Local metres: x = (lon - lon0) * kx (east), z = -(lat - lat0) * kz (south), lat0/lon0 = TILES[id].lat/lon
// (same origin as tools/bake-network.ts), kx/kz from tile.json. Lines are clipped to [-half, half]².
//
// Downloaded files are untrusted data: they are only stored under data/raw/utilities/ and parsed as
// text (KML) / bytes (ZIP). No dependencies: minimal ZIP reader + regex KML parser below.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { TILES } from './tile-config.mjs';

const RAW_DIR = path.join('data', 'raw', 'utilities');
const CKAN = 'https://data.opencity.in/api/3/action/package_show?id=';
const KINDS = new Set(['sewer', 'storm', 'water', 'power', 'gas', 'telecom', 'other']);

// PMC sewer/SWD attribute schema (shapefile-truncated names), as seen in the OpenCity files:
//   pipeline_i  pipe id ("KN-CO-6598")        -> name
//   pipeline_d  pipe diameter in mm (100-3000) -> diameter_mm
//   material_o  material ("RCC")               -> material (sewer file)
//   descriptio  material/construction text     -> material (SWD file; "-" ignored)
//   tl_start_m / tl_end_man  ground ("top level") at start/end manhole, m above MSL
//   start_inve / end_invert  pipe invert level at start/end, m above MSL
//                            -> depth_m = mean(top level - invert) over the valid ends (0 < d <= 15)
//   actual_dep, actual_d_1, depth_20xx are % flow depth (d/D, 0-100), NOT burial depth: kept in raw only.
const validNum = (s) => { const v = Number(s); return s != null && s !== '' && Number.isFinite(v) ? v : undefined; };
function pmcProps(name, d) {
  const p = {};
  const id = d.pipeline_i && d.pipeline_i !== 'undefined' ? d.pipeline_i : name;
  if (id && String(id).trim()) p.name = String(id).trim();
  const dia = validNum(d.pipeline_d);
  if (dia != null && dia >= 50 && dia <= 6000) p.diameter_mm = Math.round(dia);
  const mat = [d.material_o, d.descriptio].find((v) => v && v.trim() && v.trim() !== '-' && v !== 'undefined');
  if (mat) p.material = mat.trim();
  const ds = [];
  for (const [tl, inv] of [[d.tl_start_m, d.start_inve], [d.tl_end_man, d.end_invert]]) {
    const a = validNum(tl), b = validNum(inv);
    if (a != null && b != null && a > 100 && b > 100) { const z = a - b; if (z > 0 && z <= 15) ds.push(z); }
  }
  if (ds.length) p.depth_m = Math.round((ds.reduce((x, y) => x + y, 0) / ds.length) * 100) / 100;
  return p;
}

const isStorm = (f) => f.data.category === 'Storm water drains' || f.data.category === 'Nalla';

// Open datasets. `resource` matches the CKAN resource name (case-insensitive substring).
const SOURCES = [
  { layer: 'sewer', name: 'Sewer', kind: 'sewer', pkg: 'pune-sewage-network', resource: 'sewage pipeline', file: 'pmc_sewage_pipeline.kmz', props: pmcProps },
  // The SWD KMZ also bundles a (more complete, Phase-I) copy of the sewer network (category
  // Road_/Nalla_/River_Sewer). Pipes whose pipeline_i already appears in pune-sewage-network are skipped;
  // the rest become their own layer so provenance stays per dataset.
  { layer: 'sewer-swd', name: 'Sewer (SWD map)', kind: 'sewer', pkg: 'pune-stormwater-drains', resource: 'stormwater drains map', file: 'pmc_swd.kmz', props: pmcProps,
    filter: (f, ctx) => !isStorm(f) && !(ctx.sewerIds && ctx.sewerIds.has(f.data.pipeline_i)) },
  { layer: 'storm', name: 'Stormwater drains', kind: 'storm', pkg: 'pune-stormwater-drains', resource: 'stormwater drains map', file: 'pmc_swd.kmz', props: pmcProps,
    filter: (f) => isStorm(f) },
  { layer: 'nalla', name: 'Nallas', kind: 'storm', pkg: 'pune-stormwater-drains', resource: 'nalla map', file: 'pune_nalla.kml' },
];

// ---------------------------------------------------------------- ZIP (KMZ)
export function readZip(buf) {
  // End of central directory: signature 0x06054b50, search backwards (comment ≤ 64 KiB).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip: end of central directory not found');
  let count = buf.readUInt16LE(eocd + 10);
  let cdOff = buf.readUInt32LE(eocd + 16);
  if (cdOff === 0xffffffff || count === 0xffff) {
    // ZIP64 locator sits right before the EOCD.
    const loc = eocd - 20;
    if (loc < 0 || buf.readUInt32LE(loc) !== 0x07064b50) throw new Error('zip: zip64 locator missing');
    const z64 = Number(buf.readBigUInt64LE(loc + 8));
    if (buf.readUInt32LE(z64) !== 0x06064b50) throw new Error('zip: bad zip64 eocd');
    count = Number(buf.readBigUInt64LE(z64 + 32));
    cdOff = Number(buf.readBigUInt64LE(z64 + 48));
  }
  const entries = [];
  let p = cdOff;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip: bad central directory entry');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    let csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    let lho = buf.readUInt32LE(p + 42);
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nlen);
    // ZIP64 extra field (id 1) holds the 64-bit values that were 0xffffffff.
    let x = p + 46 + nlen; const xe = x + xlen;
    while (x + 4 <= xe) {
      const id = buf.readUInt16LE(x), sz = buf.readUInt16LE(x + 2); let q = x + 4;
      if (id === 1) {
        if (usize === 0xffffffff) { usize = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (csize === 0xffffffff) { csize = Number(buf.readBigUInt64LE(q)); q += 8; }
        if (lho === 0xffffffff) { lho = Number(buf.readBigUInt64LE(q)); q += 8; }
      }
      x += 4 + sz;
    }
    entries.push({ name, method, flags, csize, usize, lho });
    p += 46 + nlen + xlen + clen;
  }
  return {
    entries,
    read(e) {
      if (e.flags & 1) throw new Error(`zip: ${e.name} is encrypted`);
      if (buf.readUInt32LE(e.lho) !== 0x04034b50) throw new Error(`zip: bad local header for ${e.name}`);
      const start = e.lho + 30 + buf.readUInt16LE(e.lho + 26) + buf.readUInt16LE(e.lho + 28);
      const data = buf.subarray(start, start + e.csize);
      if (e.method === 0) return Buffer.from(data);
      if (e.method === 8) return zlib.inflateRawSync(data, { maxOutputLength: Math.max(e.usize, 1) * 2 + 1024 });
      throw new Error(`zip: unsupported compression method ${e.method} for ${e.name}`);
    },
  };
}

// ---------------------------------------------------------------- KML
const decodeEntities = (s) => s
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
    const l = e.toLowerCase();
    if (l === 'amp') return '&'; if (l === 'lt') return '<'; if (l === 'gt') return '>';
    if (l === 'quot') return '"'; if (l === 'apos') return "'";
    const cp = l[1] === 'x' ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10);
    return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
  });
const cdataOrText = (s) => {
  const m = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(s);
  return (m ? m[1] : decodeEntities(s)).trim();
};
const P = '(?:[\\w-]+:)?'; // optional namespace prefix

function parseCoords(text) {
  const out = [];
  for (const tok of text.trim().split(/\s+/)) {
    if (!tok) continue;
    const [lon, lat] = tok.split(',').map(Number);
    if (Number.isFinite(lon) && Number.isFinite(lat)) out.push([lon, lat]);
  }
  return out;
}

/** Yields { name, description, data: {k: v}, lines: [[[lon,lat],...]], polys: n, points: n } per Placemark. */
export function* parseKml(xml) {
  const reOpen = new RegExp(`<${P}Placemark\\b[^>]*>`, 'g');
  const reClose = new RegExp(`</${P}Placemark\\s*>`, 'g');
  const reName = new RegExp(`<${P}name\\b[^>]*>([\\s\\S]*?)</${P}name\\s*>`);
  const reDesc = new RegExp(`<${P}description\\b[^>]*>([\\s\\S]*?)</${P}description\\s*>`);
  const reSimple = new RegExp(`<${P}SimpleData\\b[^>]*\\bname\\s*=\\s*("([^"]*)"|'([^']*)')[^>]*?(?:/>|>([\\s\\S]*?)</${P}SimpleData\\s*>)`, 'g');
  const reData = new RegExp(`<${P}Data\\b[^>]*\\bname\\s*=\\s*("([^"]*)"|'([^']*)')[^>]*>([\\s\\S]*?)</${P}Data\\s*>`, 'g');
  const reValue = new RegExp(`<${P}value\\b[^>]*>([\\s\\S]*?)</${P}value\\s*>`);
  const reLine = new RegExp(`<${P}LineString\\b[^>]*>([\\s\\S]*?)</${P}LineString\\s*>`, 'g');
  const reCoords = new RegExp(`<${P}coordinates\\b[^>]*>([\\s\\S]*?)</${P}coordinates\\s*>`);
  const rePoly = new RegExp(`<${P}Polygon\\b`, 'g');
  const rePoint = new RegExp(`<${P}Point\\b`, 'g');
  for (;;) {
    const mo = reOpen.exec(xml);
    if (!mo) break;
    reClose.lastIndex = mo.index + mo[0].length;
    const mc = reClose.exec(xml);
    if (!mc) break;
    const body = xml.slice(mo.index + mo[0].length, mc.index);
    reOpen.lastIndex = mc.index + mc[0].length;
    // Strip the description before looking for geometry/data so embedded HTML can't confuse us.
    const dm = reDesc.exec(body);
    const rest = dm ? body.slice(0, dm.index) + body.slice(dm.index + dm[0].length) : body;
    const nm = reName.exec(rest);
    const data = {};
    for (const m of rest.matchAll(reSimple)) data[decodeEntities(m[2] ?? m[3])] = m[4] == null ? '' : cdataOrText(m[4]);
    for (const m of rest.matchAll(reData)) {
      const v = reValue.exec(m[4]);
      data[decodeEntities(m[2] ?? m[3])] = v ? cdataOrText(v[1]) : '';
    }
    const lines = [];
    for (const m of rest.matchAll(reLine)) {
      const c = reCoords.exec(m[1]);
      if (c) { const pts = parseCoords(c[1]); if (pts.length >= 2) lines.push(pts); }
    }
    yield {
      name: nm ? cdataOrText(nm[1]) : undefined,
      description: dm ? cdataOrText(dm[1]) : undefined,
      data, lines,
      polys: (rest.match(rePoly) || []).length,
      points: (rest.match(rePoint) || []).length,
    };
  }
}

/** Attributes from an ArcGIS/QGIS-style HTML table in <description> (<td>key</td><td>value</td>). */
function descTable(desc) {
  const out = {};
  if (!desc) return out;
  for (const m of desc.matchAll(/<tr[^>]*>\s*<t[dh][^>]*>([\s\S]*?)<\/t[dh]>\s*<t[dh][^>]*>([\s\S]*?)<\/t[dh]>\s*<\/tr>/gi)) {
    const k = decodeEntities(m[1].replace(/<[^>]*>/g, '')).trim();
    const v = decodeEntities(m[2].replace(/<[^>]*>/g, '')).trim();
    if (k && k.length < 64) out[k] = v;
  }
  return out;
}

function* parseGeojson(text) {
  const gj = JSON.parse(text);
  const feats = gj.type === 'FeatureCollection' ? gj.features : gj.type === 'Feature' ? [gj] : [{ type: 'Feature', geometry: gj, properties: {} }];
  for (const f of feats) {
    const g = f && f.geometry; if (!g) continue;
    const lines = [];
    const add = (cs) => { const pts = (cs || []).filter((c) => Array.isArray(c) && Number.isFinite(+c[0]) && Number.isFinite(+c[1])).map((c) => [+c[0], +c[1]]); if (pts.length >= 2) lines.push(pts); };
    const walk = (g) => {
      if (!g) return;
      if (g.type === 'LineString') add(g.coordinates);
      else if (g.type === 'MultiLineString') (g.coordinates || []).forEach(add);
      else if (g.type === 'GeometryCollection') (g.geometries || []).forEach(walk);
    };
    walk(g);
    const data = {};
    for (const [k, v] of Object.entries(f.properties || {})) if (v != null && typeof v !== 'object') data[k] = String(v);
    yield { name: data.name ?? data.Name, data, lines, polys: 0, points: 0 };
  }
}

/** Reads a .kmz / .kml / .geojson file into Placemark-like records. */
export function readFeatures(file) {
  const buf = fs.readFileSync(file);
  const ext = path.extname(file).toLowerCase();
  const isZip = buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50;
  if (isZip || ext === '.kmz') {
    const zip = readZip(buf);
    const kmls = zip.entries.filter((e) => /\.kml$/i.test(e.name));
    if (!kmls.length) throw new Error(`${file}: no .kml inside (entries: ${zip.entries.map((e) => e.name).join(', ')})`);
    return (function* () { for (const e of kmls) yield* parseKml(zip.read(e).toString('utf8')); })();
  }
  const text = buf.toString('utf8');
  if (ext === '.geojson' || ext === '.json' || /^\s*\{/.test(text)) return parseGeojson(text);
  return parseKml(text);
}

// ---------------------------------------------------------------- attributes
const num = (s) => {
  if (s == null) return undefined;
  const m = /-?\d+(?:\.\d+)?/.exec(String(s).replace(/,/g, ''));
  return m ? Number(m[0]) : undefined;
};
const findKey = (data, re) => Object.keys(data).find((k) => re.test(k) && String(data[k]).trim() !== '');

/** Maps raw attribute keys to { diameter_mm, material, depth_m }. See README for the mapping. */
function deriveProps(name, data) {
  const props = {};
  if (name && name.trim()) props.name = name.trim();
  const dk = findKey(data, /^(dia|diameter|dia_mm|pipe_?dia|size|pipe_?size|dia_?\(mm\))$/i) || findKey(data, /dia/i);
  if (dk) {
    let d = num(data[dk]);
    if (d != null && d > 0) {
      // Values ≤ 5 are metres, ≤ 100 are probably inches or cm — only accept unambiguous mm/m.
      if (/\bm\b|_m$|\(m\)/i.test(dk) && d < 10) d *= 1000;
      else if (d <= 5) d *= 1000;
      if (d >= 50 && d <= 6000) props.diameter_mm = Math.round(d);
    }
  }
  const mk = findKey(data, /^(material|mat|pipe_?mat|pipe_?material|moc|type_?of_?pipe)$/i) || findKey(data, /material/i);
  if (mk) props.material = String(data[mk]).trim();
  const zk = findKey(data, /^(depth|depth_m|invert_?depth|avg_?depth|dept)$/i) || findKey(data, /depth/i);
  if (zk) { const z = num(data[zk]); if (z != null && z > 0 && z < 50) props.depth_m = Math.round(z * 100) / 100; }
  return props;
}
const withRaw = (props, data) => {
  if (Object.keys(data).length) props.raw = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));
  return props;
};

// ---------------------------------------------------------------- geometry
/** Liang–Barsky: clip segment to [-h,h]², returns [t0,t1] or null. */
function clipSeg(x0, z0, x1, z1, h) {
  let t0 = 0, t1 = 1;
  const dx = x1 - x0, dz = z1 - z0;
  const p = [-dx, dx, -dz, dz], q = [x0 + h, h - x0, z0 + h, h - z0];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; continue; }
    const r = q[i] / p[i];
    if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [t0, t1];
}

/** Clips a polyline of [x,z] to the square, splitting where it leaves. Returns arrays of [x,z]. */
function clipLine(pts, h) {
  const runs = []; let cur = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const c = clipSeg(x0, z0, x1, z1, h);
    if (!c) { if (cur) { runs.push(cur); cur = null; } continue; }
    const a = [x0 + (x1 - x0) * c[0], z0 + (z1 - z0) * c[0]];
    const b = [x0 + (x1 - x0) * c[1], z0 + (z1 - z0) * c[1]];
    if (!cur) cur = [a];
    else if (c[0] > 0) { runs.push(cur); cur = [a]; } // re-entered (only possible on a fresh segment)
    cur.push(b);
    if (c[1] < 1) { runs.push(cur); cur = null; }
  }
  if (cur) runs.push(cur);
  return runs;
}

/** Drops points closer than `eps` to the last kept point (endpoint always kept), rounds to 0.01. */
function thin(run, eps = 0.5) {
  const out = [run[0]];
  for (let i = 1; i < run.length; i++) {
    const [px, pz] = out[out.length - 1], [x, z] = run[i];
    if (Math.hypot(x - px, z - pz) >= eps) out.push(run[i]);
    else if (i === run.length - 1 && out.length > 1) out[out.length - 1] = run[i];
  }
  if (out.length < 2) return null;
  const flat = [];
  for (const [x, z] of out) flat.push(Math.round(x * 100) / 100, Math.round(z * 100) / 100);
  return flat;
}

export function loadTile(id) {
  const tile = TILES[id];
  if (!tile) throw new Error(`unknown tile "${id}" (have: ${Object.keys(TILES).join(', ')})`);
  const dir = path.join('public', 'tiles', id);
  const hdr = JSON.parse(fs.readFileSync(path.join(dir, 'tile.json'), 'utf8'));
  const [clat, clon] = hdr.center;
  if (Math.abs(clat - tile.lat) > 1e-9 || Math.abs(clon - tile.lon) > 1e-9)
    console.warn(`  warning: tile.json center ${hdr.center} differs from tile-config ${tile.lat},${tile.lon}; using tile-config (as bake-network.ts does)`);
  const { kx, kz } = hdr.proj;
  return { tile, hdr, dir, half: hdr.half, proj: (lon, lat) => [(lon - tile.lon) * kx, -(lat - tile.lat) * kz] };
}

/** Builds one output layer from a feature iterator. */
export function buildLayer(features, t, meta, ctx = {}) {
  const h = t.half, lines = [], stats = { placemarks: 0, withLines: 0, polys: 0, points: 0, fields: new Map() };
  for (const f of features) {
    if (meta.id === 'sewer' && f.data.pipeline_i) (ctx.sewerIds ??= new Set()).add(f.data.pipeline_i);
    if (meta.filter && !meta.filter(f, ctx)) { stats.filtered = (stats.filtered || 0) + 1; continue; }
    stats.placemarks++; stats.polys += f.polys; stats.points += f.points;
    let data = f.data;
    if (!Object.keys(data).length && f.description) data = descTable(f.description);
    for (const [k, v] of Object.entries(data)) {
      let s = stats.fields.get(k); if (!s) stats.fields.set(k, (s = { n: 0, ex: new Set() }));
      s.n++; if (s.ex.size < 6 && v !== '') s.ex.add(v.slice(0, 40));
    }
    if (!f.lines.length) continue;
    stats.withLines++;
    let props = null;
    for (const ll of f.lines) {
      const loc = ll.map(([lon, lat]) => t.proj(lon, lat));
      let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
      for (const [x, z] of loc) { if (x < minx) minx = x; if (x > maxx) maxx = x; if (z < minz) minz = z; if (z > maxz) maxz = z; }
      if (maxx < -h || minx > h || maxz < -h || minz > h) continue;
      for (const run of clipLine(loc, h)) {
        const pts = thin(run); if (!pts) continue;
        props ??= meta.props ? meta.props(f.name, data) : deriveProps(f.name, data);
        if (!ctx.noRaw) withRaw(props, data);
        lines.push({ id: `${meta.id}-${lines.length + 1}`, pts, props });
      }
    }
  }
  const { filter, props, ...out } = meta;
  return { layer: { ...out, lines }, stats };
}

// ---------------------------------------------------------------- download
async function fetchJson(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'urbanplan-import-utilities' } });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return r.json();
}

async function resolveSource(src, offline) {
  const page = `https://data.opencity.in/dataset/${src.pkg}`;
  const local = path.join(RAW_DIR, src.file);
  const metaFile = path.join(RAW_DIR, src.file + '.meta.json');
  if (offline || (fs.existsSync(local) && fs.existsSync(metaFile))) {
    if (!fs.existsSync(local)) throw new Error(`${local} missing (offline)`);
    const m = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, 'utf8')) : {};
    return { local, source: m.title ?? src.pkg, url: page, license: m.license ?? 'unknown', retrieved: m.retrieved ?? new Date(fs.statSync(local).mtime).toISOString(), resourceUrl: m.resourceUrl };
  }
  const pkg = (await fetchJson(CKAN + encodeURIComponent(src.pkg))).result;
  const res = pkg.resources.find((r) => (r.name || '').toLowerCase().includes(src.resource));
  if (!res) throw new Error(`no resource matching "${src.resource}" in ${src.pkg}: ${pkg.resources.map((r) => r.name).join(', ')}`);
  if (!/^https:\/\//.test(res.url)) throw new Error(`refusing non-https resource url ${res.url}`);
  console.log(`  downloading ${res.url}`);
  const r = await fetch(res.url, { redirect: 'follow' });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${res.url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  fs.mkdirSync(RAW_DIR, { recursive: true });
  fs.writeFileSync(local, buf);
  const license = pkg.license_title || pkg.license_id || 'unknown';
  const meta = { title: pkg.title, resource: res.name, resourceUrl: res.url, license, license_id: pkg.license_id, retrieved: new Date().toISOString(), bytes: buf.length };
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2));
  return { local, source: pkg.title, url: page, license, retrieved: meta.retrieved, resourceUrl: res.url };
}

// ---------------------------------------------------------------- main
function args(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; o[k] = v; }
    else o._.push(a);
  }
  return o;
}

function report(layer, stats) {
  let len = 0, n = 0;
  for (const l of layer.lines) for (let i = 2; i < l.pts.length; i += 2) { len += Math.hypot(l.pts[i] - l.pts[i - 2], l.pts[i + 1] - l.pts[i - 1]); n++; }
  console.log(`  ${layer.id}: ${stats.placemarks} placemarks${stats.filtered ? ` (+${stats.filtered} filtered out)` : ''} (${stats.withLines} with lines, ${stats.polys} polygons, ${stats.points} points) -> ${layer.lines.length} lines, ${(len / 1000).toFixed(2)} km in tile`);
  for (const [k, s] of stats.fields) console.log(`    field ${JSON.stringify(k)} ×${s.n}  e.g. ${[...s.ex].map((v) => JSON.stringify(v)).join(', ')}`);
}

async function main() {
  const a = args(process.argv.slice(2));
  const id = a._[0] || 'kp';
  if (a.inspect) {
    let n = 0; const fields = new Map();
    for (const f of readFeatures(a.inspect)) {
      if (n++ < 2) console.log(JSON.stringify({ name: f.name, data: f.data, desc: f.description?.slice(0, 600), nLines: f.lines.length, polys: f.polys, points: f.points, first: f.lines[0]?.slice(0, 2) }, null, 1));
      for (const k of Object.keys(f.data)) fields.set(k, (fields.get(k) || 0) + 1);
    }
    console.log(n, 'placemarks; fields', Object.fromEntries(fields));
    return;
  }
  const t = loadTile(id);
  const outFile = path.join(t.dir, 'utilities.json');
  const prev = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : { version: 1, layers: [] };
  let layers;
  if (a.file) {
    const lid = String(a.layer || path.basename(a.file).replace(/\.\w+$/, '')).replace(/[^\w-]/g, '_');
    const kind = String(a.kind || (KINDS.has(lid) ? lid : 'other'));
    if (!KINDS.has(kind)) throw new Error(`--kind must be one of ${[...KINDS].join(', ')}`);
    const meta = { id: lid, name: String(a.name || lid), kind, source: String(a.source || path.basename(a.file)), url: String(a.url || ''), license: String(a.license || 'unknown'), retrieved: new Date(fs.statSync(a.file).mtime).toISOString().slice(0, 10) };
    const { layer, stats } = buildLayer(readFeatures(a.file), t, meta, { noRaw: !!a['no-raw'] });
    report(layer, stats);
    layers = [...prev.layers.filter((l) => l.id !== lid), layer];
  } else {
    layers = [];
    const ctx = { noRaw: !!a['no-raw'] };
    for (const src of SOURCES) {
      console.log(`${src.layer}: ${src.pkg}`);
      let r;
      try { r = await resolveSource(src, !!a.offline); } catch (e) { console.error(`  FAILED: ${e.message}`); continue; }
      const meta = { id: src.layer, name: src.name, kind: src.kind, source: r.source, url: r.url, license: r.license, retrieved: r.retrieved.slice(0, 10), filter: src.filter, props: src.props };
      const { layer, stats } = buildLayer(readFeatures(r.local), t, meta, ctx);
      report(layer, stats);
      layers.push(layer);
    }
    // Keep layers added with --file that the default run doesn't produce.
    for (const l of prev.layers) if (!layers.some((x) => x.id === l.id) && !SOURCES.some((s) => s.layer === l.id)) layers.push(l);
  }
  const out = { version: 1, layers };
  fs.writeFileSync(outFile, JSON.stringify(out));
  console.log(`wrote ${outFile} (${(fs.statSync(outFile).size / 1024).toFixed(0)} KiB, ${layers.length} layers)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
