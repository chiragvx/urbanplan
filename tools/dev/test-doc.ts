// Headless test of the City Document: base build, compile, incremental edits, undo/redo, save/load round trip.
// npx esbuild tools/dev/test-doc.ts --bundle --platform=node --format=esm --outfile=tools/dev/test-doc.mjs && node tools/dev/test-doc.mjs
import fs from 'node:fs';
import { parseTile } from '../../src/data/tile';
import { Heightfield } from '../../src/geo/heightfield';
import { buildBase, baseFingerprint } from '../../src/doc/base';
import { CityDoc } from '../../src/doc/doc';
import { Compiler } from '../../src/doc/compile';
import { newMeta, serialize, parse, openMap } from '../../src/doc/format';
import { setTotalWidth, totalWidth, describe } from '../../src/doc/xsection';
import * as OPS from '../../src/doc/ops';

const dir = 'public/tiles/kp/';
const hdr = JSON.parse(fs.readFileSync(dir + 'tile.json', 'utf8'));
const buf = fs.readFileSync(dir + 'tile.bin');
const tile = parseTile(hdr, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const net = JSON.parse(fs.readFileSync(dir + 'network.json', 'utf8'));
const util = fs.existsSync(dir + 'utilities.json') ? JSON.parse(fs.readFileSync(dir + 'utilities.json', 'utf8')) : null;
const hf = new Heightfield(tile.terrain.n, tile.terrain.cell, tile.terrain.heights);

let ok = true;
const check = (cond: boolean, msg: string) => { console.log(`${cond ? 'ok  ' : 'FAIL'} ${msg}`); if (!cond) ok = false; };

let t = Date.now();
const base = buildBase(net, tile, util);
const count = (k: string) => [...base.values()].filter((o) => o.kind === k).length;
console.log(`base ${Date.now() - t} ms: ${count('section')} sections, ${count('junction')} junctions, ${count('road')} roads, ${count('building')} buildings, ${count('line')} lines, ${count('layer')} layers`);
const base2 = buildBase(net, tile, util);
check([...base.keys()].join() === [...base2.keys()].join(), 'ids are deterministic');

const doc = new CityDoc(base, newMeta('kp', baseFingerprint(base), 'test'));
t = Date.now();
const C = new Compiler(doc, hf);
const items = C.full();
console.log(`compile full ${Date.now() - t} ms → ${items.size} mesh items, ${C.mesher.segs.size} pieces, stats ${JSON.stringify(C.mesher.stats)}`);
check(C.mesher.segs.size === net.segments.length, `pieces round-trip (${C.mesher.segs.size} vs ${net.segments.length})`);

// pick a busy named road
const roads = doc.all('road').filter((r) => r.name).map((r) => ({ r, n: doc.sectionsOf(r.id).length })).sort((a, b) => b.n - a.n);
const R = roads[0].r;
const secs = doc.sectionsOf(R.id);
console.log(`road "${R.name}" (${R.cls}): ${secs.length} sections, e.g. ${describe(secs[0].parts)}`);

// section-level width edit
const s0 = secs[0];
const w0 = totalWidth(s0.parts);
let changed: Set<string> = new Set();
doc.on((c) => { t = performance.now(); changed = C.update(c.ids); console.log(`  update after "${c.label}" (${c.origin}): ${c.ids.size} ids → ${changed.size} items in ${(performance.now() - t).toFixed(1)} ms`); });
doc.transact('Widen section', () => doc.set(s0.id, 'parts', setTotalWidth(s0.parts, w0 + 6)));
check(Math.abs(totalWidth(doc.get<'section'>(s0.id)!.parts) - (w0 + 6)) < 0.05, `section width ${w0} → ${totalWidth(doc.get<'section'>(s0.id)!.parts)}`);
check(changed.size > 0 && changed.size < 60, 'incremental update is local');

// road-level edit inherits to sections that don't override
doc.transact('Road width', () => doc.set(R.id, 'parts', setTotalWidth(secs[1 % secs.length].parts, 18)));
const after = doc.sectionsOf(R.id);
check(after.filter((s) => s.id !== s0.id).every((s) => Math.abs(totalWidth(s.parts) - 18) < 0.05), 'road edit reaches all non-overridden sections');
check(Math.abs(totalWidth(doc.get<'section'>(s0.id)!.parts) - (w0 + 6)) < 0.05, 'section override wins over road edit');
const other = after.find((s) => s.id !== s0.id);
check(!other || doc.editState(other.id, 'parts') === 'road', `edit state of inherited: ${other && doc.editState(other.id, 'parts')}`);
check(doc.editState(s0.id, 'parts') === 'own', 'edit state of override');

// move a junction
const J = doc.get<'junction'>(s0.a)!;
doc.transact('Move junction', () => doc.update(J.id, { x: J.x + 5, z: J.z - 3 }));
const g = C.geo(s0.id)!;
check(g && (Math.hypot(g.pts[0] - (J.x + 5), g.pts[1] - (J.z - 3)) < 0.01 || Math.hypot(g.pts[g.pts.length - 2] - (J.x + 5), g.pts[g.pts.length - 1] - (J.z - 3)) < 0.01), 'section follows its junction');

// save / load round trip
const text = serialize(doc);
console.log(`map file: ${text.length} bytes, ${doc.patch.size} edited objects`);
const fresh = new CityDoc(buildBase(net, tile, util), newMeta('kp', '', ''));
const r = openMap(fresh, parse(text));
check(r.kept === doc.patch.size && r.unresolved.length === 0, `reopen: kept ${r.kept}, unresolved ${r.unresolved.length}`);
const A1 = JSON.stringify(fresh.get(s0.id)), B1 = JSON.stringify(doc.get(s0.id));
if (A1 !== B1) { let i = 0; while (A1[i] === B1[i]) i++; console.log('   diff at', i, A1.slice(i - 40, i + 60), ' vs ', B1.slice(i - 40, i + 60)); }
check(A1 === B1, 'section identical after reopen');

// rebase: pretend the importer renamed every id
const f = parse(text);
const renamed = { ...f, objects: Object.fromEntries(Object.entries(f.objects).map(([id, e]) => [id + 'x', e])) };
const fresh2 = new CityDoc(buildBase(net, tile, util), newMeta('kp', '', ''));
const r2 = openMap(fresh2, renamed);
check(r2.remapped.length === doc.patch.size && r2.unresolved.length === 0, `rebase by locator: remapped ${r2.remapped.length}/${doc.patch.size}, unresolved ${r2.unresolved.length}`);

// undo everything
doc.undo(); doc.undo(); doc.undo();
check(doc.patch.size === 0, 'undo restores the base');
check(Math.abs(totalWidth(doc.get<'section'>(s0.id)!.parts) - w0) < 0.05, 'width back to base');
doc.redo();
check(Math.abs(totalWidth(doc.get<'section'>(s0.id)!.parts) - (w0 + 6)) < 0.05, 'redo');

// delete + create
doc.transact('Delete section', () => doc.remove(s0.id));
check(!doc.get(s0.id) && !C.mesher.segs.has(`${s0.id}~0`), 'delete removes pieces');
doc.undo();
check(!!doc.get(s0.id) && C.mesher.segs.has(`${s0.id}~0`), 'undo delete restores pieces');

// ---------------- operations ----------------
{
  const O = OPS;
  const sec = doc.sectionsOf(R.id).find((x) => x.id !== s0.id)!;
  const g0 = C.geo(sec.id)!;
  const q = Math.floor(g0.pts.length / 4);
  const mid: [number, number] = [g0.pts[q * 2], g0.pts[q * 2 + 1]];
  const r = doc.transact('Split', () => O.splitSection(doc, sec.id, mid))!;
  check(!!r && !doc.get(sec.id) && !!doc.get(r.parts[0]) && !!doc.get(r.parts[1]), 'split → two sections + junction');
  const L0 = g0.len, L1 = C.geo(r.parts[0])!.len + C.geo(r.parts[1])!.len;
  check(Math.abs(L0 - L1) < 0.5, `split keeps length (${L0.toFixed(1)} vs ${L1.toFixed(1)})`);
  const joined = doc.transact('Join', () => O.joinAt(doc, r.junction))!;
  check(!!joined && Math.abs(C.geo(joined)!.len - L0) < 0.5, `join restores the section (${C.geo(joined)?.len.toFixed(1)})`);
  doc.undo(); doc.undo();
  check(!!doc.get(sec.id), 'undo split + join');

  // pen: a new road from empty ground to an existing junction
  const J2 = doc.get<'junction'>(sec.a)!;
  const rid = doc.transact('Draw road', () => O.createRoad(doc, [{ x: J2.x + 60, z: J2.z + 80 }, { x: J2.x + 30, z: J2.z + 30 }, { x: J2.x, z: J2.z, junction: J2.id }], 'residential', 'Test Lane'))!;
  const rs = doc.sectionsOf(rid);
  check(rs.length === 1 && !!C.geo(rs[0].id) && C.geo(rs[0].id)!.len > 90, `pen road: ${rs.length} section, ${C.geo(rs[0].id)?.len.toFixed(1)} m`);
  doc.transact('Road width', () => doc.set(rid, 'parts', setTotalWidth(rs[0].parts, 12)));
  check(Math.abs(totalWidth(doc.sectionsOf(rid)[0].parts) - 12) < 0.05, 'created road passes width to its sections');
  doc.transact('Section width', () => doc.set(rs[0].id, 'parts', setTotalWidth(rs[0].parts, 9)));
  doc.transact('Road width again', () => doc.set(rid, 'parts', setTotalWidth(rs[0].parts, 15)));
  check(Math.abs(totalWidth(doc.get<'section'>(rs[0].id)!.parts) - 9) < 0.05, 'created section override wins');

  // bend / straighten / arc / reverse
  const s1 = doc.get<'section'>(rs[0].id)!;
  const basePath = O.anchorsOf(doc, s1);
  const gm = C.geo(s1.id)!;
  const h = Math.floor(gm.pts.length / 4);
  const m2: [number, number] = [gm.pts[h * 2], gm.pts[h * 2 + 1]];
  doc.transact('Bend', () => O.bendSection(doc, s1.id, basePath, m2, 10, -6));
  const after2 = O.nearestOnPath(O.anchorsOf(doc, doc.get<'section'>(s1.id)!), [m2[0] + 10, m2[1] - 6]);
  check(after2.d < 1.5, `bend passes near the dragged point (${after2.d.toFixed(2)} m)`);
  doc.transact('Straighten', () => O.straighten(doc, s1.id));
  check(doc.get<'section'>(s1.id)!.path.length === 2, 'straighten → one piece');
  doc.transact('Arc', () => O.arcSection(doc, s1.id, 120));
  check(doc.get<'section'>(s1.id)!.path.length >= 2 && !!C.geo(s1.id), 'arc');
  const before = doc.get<'section'>(s1.id)!;
  doc.transact('Reverse', () => O.reverseSection(doc, s1.id));
  const rev = doc.get<'section'>(s1.id)!;
  check(rev.a === before.b && rev.b === before.a, 'reverse swaps ends');
  doc.transact('Move road', () => O.translate(doc, [rid], 5, 5));
  doc.transact('Delete road', () => O.deleteRoad(doc, rid));
  check(!doc.get(rid) && !doc.get(s1.id), 'delete road');
  check(!!doc.get(J2.id), 'existing junction kept');
  while (doc.canUndo) doc.undo();
  check(doc.patch.size === 0, 'undo all → clean base');
  check(C.mesher.segs.size === net.segments.length, `mesher back to base (${C.mesher.segs.size})`);
}
console.log(ok ? '\nALL OK' : '\nFAILURES');
process.exit(ok ? 0 : 1);
