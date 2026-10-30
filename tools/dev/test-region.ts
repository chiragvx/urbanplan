// Region tests (headless): a window of pieces from public/regions/pune, paging objects in and out, edits surviving
// it, and a map made on the Koregaon Park tile opening on the region. Skips when the region isn't baked.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { Heightfield } from '../../src/geo/heightfield';
import { CityDoc } from '../../src/doc/doc';
import { Compiler } from '../../src/doc/compile';
import { newMeta, openMap, parse, serialize } from '../../src/doc/format';
import { baseLayers, buildingObj } from '../../src/doc/base';
import { parsePiece, windowPieces, windowTile, type Piece, type RegionManifest } from '../../src/data/region';
import { frameMove, mapHome, moveMap, movePoint } from '../../src/doc/frames';
import * as O from '../../src/doc/ops';
import type { Obj } from '../../src/doc/types';

const dir = 'public/regions/pune/';
let failed = 0;
const check = (ok: boolean, msg: string) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };
if (!fs.existsSync(dir + 'region.json')) { console.log('region not baked: skipped'); process.exit(0); }
const M: RegionManifest = JSON.parse(fs.readFileSync(dir + 'region.json', 'utf8'));
const G = JSON.parse(zlib.gunzipSync(fs.readFileSync(dir + 'global.json.gz')).toString());
const cache = new Map<string, Piece>();
const piece = (i: number, j: number) => {
  const k = `${i}_${j}`;
  if (!cache.has(k)) { const b = zlib.gunzipSync(fs.readFileSync(`${dir}p/${k}.bin.gz`)); cache.set(k, parsePiece({ json: zlib.gunzipSync(fs.readFileSync(`${dir}p/${k}.json.gz`)).toString(), bin: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) }, i, j)); }
  return cache.get(k)!;
};
const objsOf = (list: [number, number][]) => { const out = new Map<string, Obj>(); for (const [i, j] of list) { const p = piece(i, j); for (const o of p.objs) out.set(o.id, o); for (const b of p.buildings) out.set('b' + b.osm, buildingObj(b, 'b' + b.osm, b.osm)); } return out; };

// the window around Koregaon Park
const kp = M.legacy.kp, mv = frameMove(kp, M.frame);
const [kx, kz] = movePoint(mv, -350, 150);
const ci = Math.floor(kx / M.piece), cj = Math.floor(kz / M.piece);
const list = windowPieces(M, ci, cj);
check(list.length === 9, `the window around Koregaon Park is 3 × 3 pieces (${ci}, ${cj})`);
const tile = windowTile(M, ci, cj, new Map(list.map(([i, j]) => [`${i}_${j}`, piece(i, j)])));
const hf = new Heightfield(tile.terrain.n, tile.terrain.cell, tile.terrain.heights, { base: M.base, ox: tile.ox, oz: tile.oz });
check(hf.covers(kx, kz) && Math.abs(hf.half - 3072) < 1, `the window's terrain grid is 6 km wide around (${Math.round(kx)}, ${Math.round(kz)})`);
const base = new Map<string, Obj>();
for (const o of [...G.roads, ...G.lines, ...baseLayers('')]) base.set(o.id, o);
const inWin = objsOf(list);
for (const [id, o] of inWin) base.set(id, o);
const doc = new CityDoc(base, newMeta(M.id, M.fingerprint, 'test'));
const C = new Compiler(doc, hf);
C.full();
doc.on((c) => { C.update(c.ids); });
check(doc.ids('section').size > 5000 && C.mesher.items.size > 10000, `window compiles: ${doc.ids('section').size} sections, ${C.mesher.items.size} mesh items`);

// an edit, then its piece leaves the window and comes back
const sec = doc.all('section').find((s) => s.name && s.path.length >= 2)!;
doc.transact('Rename', () => doc.set(sec.id, 'name', 'Test Road'));
const v0 = doc.version, saved = doc.version === doc.savedVersion;
const undos = doc.canUndo;
const away = [...inWin.keys()].filter((id) => id !== 'layer');
doc.page([], away);
check(!doc.get(sec.id) && doc.patch.has(sec.id), 'paged out: the section is gone from the window, its edit kept');
check(!C.mesher.items.has(`s:${sec.id}~0`), 'paged out: its road mesh is gone');
doc.page([...inWin.values()], []);
check(doc.get(sec.id)?.name === 'Test Road', 'paged back in: the edit applies again');
check(C.mesher.items.has(`s:${sec.id}~0`) || [...C.mesher.items.keys()].some((k) => k.startsWith(`s:${sec.id}~`)), 'paged back in: its road is built again');
check(doc.canUndo === undos && (saved ? doc.version === doc.savedVersion : true), `paging isn't an edit (version ${v0} → ${doc.version}, undo kept)`);
doc.undo();
check(doc.get(sec.id)?.name !== 'Test Road', 'undo still works after paging');

// a map from the Koregaon Park tile opens on the region
const kpMap = 'tools/dev/rebase-map.json';
if (fs.existsSync(kpMap)) {
  const f = parse(fs.readFileSync(kpMap, 'utf8'));
  const moved = moveMap(f, mv, M.id);
  const home = mapHome(moved)!;
  check(moved.meta.tile === M.id && !!home && hf.covers(home[0], home[1], 500), `a Koregaon Park map moves into the city frame (its edits around ${home.map(Math.round)})`);
  const d2 = new CityDoc(new Map(base), newMeta(M.id, M.fingerprint, 'test'));
  const r = openMap(d2, moved);
  check(r.unresolved.length <= 2, `its edits re-attach: ${r.kept} kept, ${r.remapped.length} re-attached, ${r.unresolved.length} unresolved`);
  const created = d2.all('section').filter((s) => d2.patch.get(s.id)?.add);
  check(created.length >= 1 && created.every((s) => Math.abs(s.path[0].x - home[0]) < 8000), `its new road came along, in city coordinates (${created.length})`);
  const back = parse(serialize(d2));
  check(back.meta.tile === M.id && back.meta.base === undefined, 'saving it again writes a region map');
}

// a section drawn here and a junction moved keep working in the region frame
const j = doc.all('junction').find((q) => doc.sectionsAt(q.id).length === 3)!;
doc.transact('Move', () => O.moveJunction(doc, j.id, j.x + 2, j.z + 1));
check(Math.abs(doc.get<'junction'>(j.id)!.x - j.x - 2) < 0.01, 'editing in the city frame works (junction moved)');

console.log(failed ? `${failed} FAILED` : 'ALL OK');
process.exit(failed ? 1 : 0);
