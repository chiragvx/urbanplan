// Command line for maps — the same document, operations and checks as the editor, without a browser.
//
//   npm run map -- info    maps/my.urbanplan.json
//   npm run map -- apply   maps/my.urbanplan.json scripts/widen.mjs     (script: export default (city) => { … })
//   npm run map -- check   maps/my.urbanplan.json
//   npm run map -- geojson maps/my.urbanplan.json out.geojson
//   npm run map -- network maps/my.urbanplan.json out/network.json
//   npm run map -- publish maps/my.urbanplan.json                       (copy into public/maps + gallery)
//   npm run map -- new     maps/new.urbanplan.json "Name" "Author"
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseTile } from '../src/data/tile';
import { Heightfield } from '../src/geo/heightfield';
import { buildBase, baseFingerprint } from '../src/doc/base';
import { CityDoc } from '../src/doc/doc';
import { Compiler } from '../src/doc/compile';
import { newMeta, openMap, parse, serialize } from '../src/doc/format';
import { IssueIndex } from '../src/doc/issues';
import { toGeoJSON, toNetwork } from '../src/doc/export';
import { CityApi } from '../src/doc/api';

const [cmd, file, a3, a4] = process.argv.slice(2);
const usage = () => { console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('\n').slice(0, 10).join('\n')); process.exit(1); };
if (!cmd || !file) usage();

function load(tile = 'kp') {
  const dir = path.join('public', 'tiles', tile);
  const hdr = JSON.parse(fs.readFileSync(path.join(dir, 'tile.json'), 'utf8'));
  const buf = fs.readFileSync(path.join(dir, 'tile.bin'));
  const t = parseTile(hdr, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  const net = JSON.parse(fs.readFileSync(path.join(dir, 'network.json'), 'utf8'));
  const util = fs.existsSync(path.join(dir, 'utilities.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'utilities.json'), 'utf8')) : null;
  const base = buildBase(net, t, util);
  const doc = new CityDoc(base, newMeta(tile, baseFingerprint(base)));
  const hf = new Heightfield(t.terrain.n, t.terrain.cell, t.terrain.heights);
  return { tile: t, doc, hf };
}

function openFile(doc: CityDoc) {
  if (!fs.existsSync(file)) return null;
  const r = openMap(doc, parse(fs.readFileSync(file, 'utf8')));
  if (r.remapped.length) console.log(`  ${r.remapped.length} edit(s) re-attached to changed roads`);
  if (r.unresolved.length) console.log(`  ! ${r.unresolved.length} edit(s) no longer match the base map`);
  return r;
}

function compiled(doc: CityDoc, hf: Heightfield) {
  const C = new Compiler(doc, hf);
  C.full();
  doc.on((c) => C.update(c.ids));
  return C;
}

const save = (doc: CityDoc, to = file) => { fs.mkdirSync(path.dirname(path.resolve(to)), { recursive: true }); fs.writeFileSync(to, serialize(doc)); console.log(`wrote ${to} (${doc.editCount} edited objects)`); };

async function main() {
  const { tile, doc, hf } = load();
  switch (cmd) {
    case 'new': {
      doc.meta = { ...doc.meta, name: a3 ?? 'Untitled map', author: a4 ?? '' };
      save(doc);
      break;
    }
    case 'info': {
      if (!openFile(doc)) throw new Error(`no such file ${file}`);
      const m = doc.meta;
      console.log(`${m.name}${m.author ? ` by ${m.author}` : ''} — tile ${m.tile}, updated ${m.updated}`);
      if (m.description) console.log(`  ${m.description}`);
      if (m.forkedFrom) console.log(`  copy of “${m.forkedFrom.name}”${m.forkedFrom.author ? ` by ${m.forkedFrom.author}` : ''}`);
      const kinds = new Map<string, { add: number; set: number; del: number }>();
      for (const [id, e] of doc.patch) {
        const k = (e.add?.kind ?? doc.base.get(id)?.kind ?? 'unknown') as string;
        const c = kinds.get(k) ?? { add: 0, set: 0, del: 0 };
        if (e.add) c.add++; else if (e.del) c.del++; else c.set++;
        kinds.set(k, c);
      }
      for (const [k, c] of kinds) console.log(`  ${k.padEnd(10)} ${c.set} changed, ${c.add} added, ${c.del} deleted`);
      break;
    }
    case 'apply': {
      if (!a3) usage();
      openFile(doc);
      compiled(doc, hf);
      const city = new CityApi(doc);
      const mod = await import(pathToFileURL(path.resolve(a3)).href);
      const before = doc.editCount;
      await doc.transact(`Script ${path.basename(a3)}`, () => mod.default(city));
      console.log(`script changed ${doc.editCount - before >= 0 ? '' : ''}${doc.editCount} edited objects total (was ${before})`);
      save(doc, a4 ?? file);
      break;
    }
    case 'check': {
      openFile(doc);
      const C = compiled(doc, hf);
      // grid for neighbour queries
      const cell = 50, grid = new Map<string, Set<string>>();
      for (const s of doc.all('section')) {
        const g = C.geo(s.id);
        if (!g) continue;
        for (let i = Math.floor(g.x0 / cell); i <= Math.floor(g.x1 / cell); i++) for (let j = Math.floor(g.z0 / cell); j <= Math.floor(g.z1 / cell); j++) {
          const k = `${i},${j}`; (grid.get(k) ?? grid.set(k, new Set()).get(k)!).add(s.id);
        }
      }
      for (const j of doc.all('junction')) { const k = `${Math.floor(j.x / cell)},${Math.floor(j.z / cell)}`; (grid.get(k) ?? grid.set(k, new Set()).get(k)!).add(j.id); }
      const near = (x0: number, z0: number, x1: number, z1: number) => {
        const out = new Set<string>();
        for (let i = Math.floor(x0 / cell); i <= Math.floor(x1 / cell); i++) for (let j = Math.floor(z0 / cell); j <= Math.floor(z1 / cell); j++) for (const id of grid.get(`${i},${j}`) ?? []) out.add(id);
        return out;
      };
      const I = new IssueIndex(doc, C, near);
      const t0 = Date.now();
      I.full();
      const list = I.list();
      const by = new Map<string, number>();
      for (const i of list) by.set(`${i.sev} · ${i.title}`, (by.get(`${i.sev} · ${i.title}`) ?? 0) + 1);
      console.log(`${list.length} issues (${Date.now() - t0} ms)`);
      for (const [k, n] of [...by].sort()) console.log(`  ${String(n).padStart(5)}  ${k}`);
      if (a3 === '--list') for (const i of list.slice(0, 200)) console.log(`  [${i.sev}] ${i.title}: ${i.detail} @ ${i.x.toFixed(0)},${i.z.toFixed(0)}`);
      process.exitCode = list.some((i) => i.sev === 'error') ? 2 : 0;
      break;
    }
    case 'geojson': {
      openFile(doc);
      const C = compiled(doc, hf);
      const [lat0, lon0] = tile.center;
      const out = a3 ?? file.replace(/\.(urbanplan|punemap)\.json$/, '.geojson');
      fs.writeFileSync(out, JSON.stringify(toGeoJSON(doc, C, { lat0, lon0, kx: tile.proj.kx, kz: tile.proj.kz }, { buildings: a4 === '--buildings' })));
      console.log(`wrote ${out}`);
      break;
    }
    case 'network': {
      openFile(doc);
      const C = compiled(doc, hf);
      const out = a3 ?? 'network.json';
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(toNetwork(doc, C, tile.half)));
      console.log(`wrote ${out}`);
      break;
    }
    case 'publish': {
      if (!openFile(doc)) throw new Error(`no such file ${file}`);
      const pub = path.join('public', 'maps'), name = path.basename(file);
      fs.mkdirSync(pub, { recursive: true });
      fs.copyFileSync(file, path.join(pub, name));
      const idxPath = path.join(pub, 'index.json');
      const idx = fs.existsSync(idxPath) ? JSON.parse(fs.readFileSync(idxPath, 'utf8')) : { maps: [] };
      const m = doc.meta;
      idx.maps = [{ file: name, name: m.name, author: m.author, description: m.description, updated: m.updated, edits: doc.editCount }, ...idx.maps.filter((x: { file: string }) => x.file !== name)];
      fs.writeFileSync(idxPath, JSON.stringify(idx, null, 1));
      console.log(`published maps/${name} — run npm run build and upload dist/ (open with ?map=maps/${name})`);
      break;
    }
    default: usage();
  }
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
