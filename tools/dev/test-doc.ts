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
import { TerrainCompiler } from '../../src/doc/terrain';

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

// ---------------- road tool: stretches, crossings, flyovers ----------------
{
  const O = OPS;
  const arc = O.arcPieces([0, 0], [1, 0], [50, 50]);
  check(Math.abs(arc.R - 50) < 0.01 && Math.abs(arc.end[0]) < 1e-6 && Math.abs(arc.end[1] - 1) < 1e-6, `continuous arc: R ${arc.R.toFixed(2)}, ends heading ${arc.end.map((v) => v.toFixed(2))}`);
  const mid = O.bezAt(arc.pieces[0], 0.5);
  check(Math.abs(Math.hypot(mid[0], mid[1] - 50) - 50) < 0.05, 'arc cubic stays on the circle');

  // a long ground section, crossed square-on through its middle
  const X = doc.all('section').filter((s) => !s.elevated && s.bridge === 'none' && (C.geo(s.id)?.len ?? 0) > 320 && s.path.length <= 3)
    .sort((a, b) => C.geo(b.id)!.len - C.geo(a.id)!.len)[0];
  const g = C.geo(X.id)!;
  const i = Math.floor(g.pts.length / 4);
  const M: [number, number] = [g.pts[i * 2], g.pts[i * 2 + 1]], nx = g.nrm[i * 2], nz = g.nrm[i * 2 + 1];
  const A = { x: M[0] + nx * 40, z: M[1] + nz * 40 }, B = { x: M[0] - nx * 40, z: M[1] - nz * 40 };
  const nJ = doc.ids('junction').size;
  let res = doc.transact('Draw', () => { const r = O.drawStretch(doc, A, B, [O.line([A.x, A.z], [B.x, B.z])], 'residential'); return { ...r, ...O.autoConnect(doc, [r.section!]) }; })!;
  check(res.joined >= 1 && !doc.get(X.id), `same level: crossing becomes a junction (${res.joined} joined, original split)`);
  const hub = doc.all('junction').find((j) => Math.hypot(j.x - M[0], j.z - M[1]) < 1.5);
  check(!!hub && doc.sectionsAt(hub.id).length === 4, `four-way junction at the crossing (${hub && doc.sectionsAt(hub.id).length})`);
  doc.undo();
  check(!!doc.get(X.id) && doc.ids('junction').size === nJ, 'undo draw');
  res = doc.transact('Draw high', () => { const r = O.drawStretch(doc, { ...A, lift: 7 }, { ...B, lift: 7 }, [O.line([A.x, A.z], [B.x, B.z])], 'residential'); return { ...r, ...O.autoConnect(doc, [r.section!]) }; })!;
  check(res.joined === 0 && res.bridged >= 1 && !!doc.get(X.id) && doc.get<'section'>(res.section!)!.elevated, `7 m up: passes over (${res.bridged} bridged), no junction`);
  doc.undo();

  // flyover with ramps, re-raised without piling up points, then back down
  const n0 = X.path.length;
  const r1 = doc.transact('Flyover', () => O.elevate(doc, [X.id], 6.5, 0.05))!;
  let x1 = doc.get<'section'>(X.id)!;
  const lifts = O.anchorsOf(doc, x1).map((a) => a.lift);
  check(r1.deck === 6.5 && Math.max(...lifts) === 6.5 && lifts[0] === 0 && lifts[lifts.length - 1] === 0 && x1.elevated, `flyover: deck ${r1.deck} m, ramps ${r1.ramp} m, lifts ${lifts.join(',')}`);
  check(x1.path.length === n0 + 2, `ramp tops became points (${n0} → ${x1.path.length})`);
  check(C.mesher.segs.has(`${X.id}~0`), 'flyover compiles');
  doc.transact('Higher', () => O.elevate(doc, [X.id], 8, 0.05));
  doc.transact('Higher', () => O.elevate(doc, [X.id], 9.5, 0.05));
  x1 = doc.get<'section'>(X.id)!;
  check(x1.path.length === n0 + 2 && Math.abs(O.deckOf(doc, [X.id]) - 9.5) < 0.01, `raising again keeps ${x1.path.length} points`);
  const short = doc.transact('Too high', () => O.elevate(doc, [X.id], 40, 0.05))!;
  check(short.lowered && short.deck < 40 && short.grade <= 0.1 + 1e-9, `too high for its length → lowered to ${short.deck} m at ${(short.grade * 100).toFixed(1)} %`);
  doc.transact('Ground', () => O.toGround(doc, [X.id]));
  x1 = doc.get<'section'>(X.id)!;
  check(!x1.elevated && x1.path.length === n0 && x1.path.every((a) => a.lift === 0), `back to ground: ${x1.path.length} points, flat`);

  // underpass / tunnel: the same ramps, downwards; covered in the middle, open cut at the ends
  const tr = doc.transact('Tunnel', () => O.elevate(doc, [X.id], O.TUNNEL_DEPTH, 0.05))!;
  x1 = doc.get<'section'>(X.id)!;
  const tl = O.anchorsOf(doc, x1).map((a) => a.lift);
  check(tr.deck === O.TUNNEL_DEPTH && Math.min(...tl) === O.TUNNEL_DEPTH && tl[0] === 0 && !!x1.tunnel && !x1.elevated && x1.bridge === 'none', `tunnel: ${-tr.deck} m deep, ramps ${tr.ramp} m, lifts ${tl.join(',')}`);
  const mids = [...C.mesher.items.values()].filter((it) => it.key.startsWith(`s:${X.id}~`));
  const covered = mids.filter((it) => it.stamps.length === 0).length, open = mids.filter((it) => it.stamps.some((st) => st.z)).length;
  check(mids.length > 0 && covered >= 1 && open >= 1, `tunnel compiles: ${covered} covered piece(s) leave the ground, ${open} open-cut piece(s) carve it`);
  check(mids.every((it) => (it.layers.concrete?.idx.length ?? 0) > 0), 'tunnel pieces have walls');
  const holes = mids.flatMap((it) => it.stamps).filter((st) => st.hole);
  check(holes.length >= 1 && holes.every((st) => !st.carve && !!st.line), `open cuts are holes in the ground between their walls, not carved slopes (${holes.length})`);
  const over = doc.transact('Draw over', () => { const r = O.drawStretch(doc, A, B, [O.line([A.x, A.z], [B.x, B.z])], 'residential'); return { ...r, ...O.autoConnect(doc, [r.section!]) }; })!;
  check(over.joined === 0 && over.bridged >= 1, `a ground road across the tunnel passes over it (${over.joined} joined, ${over.bridged} crossed)`);
  doc.undo();
  const deep = doc.transact('Draw under', () => { const r = O.drawStretch(doc, { ...A, lift: -9 }, { ...B, lift: -9 }, [O.line([A.x, A.z], [B.x, B.z])], 'residential'); return { ...r, ...O.autoConnect(doc, [r.section!]) }; })!;
  check(deep.joined >= 1 && doc.sectionsOf(deep.road).every((q) => q.tunnel), `a road 9 m down meets the tunnel 8 m down: underground junction (${deep.joined})`);
  doc.undo();
  doc.transact('Ground', () => O.toGround(doc, [X.id]));
  x1 = doc.get<'section'>(X.id)!;
  check(!x1.tunnel && x1.path.length === n0 && x1.path.every((a) => a.lift === 0), 'tunnel back to ground');

  // a whole road over its cross streets, and back down reconnecting them
  const RR = doc.all('road').map((r) => ({ r, s: doc.sectionsOf(r.id) })).filter((x) => x.s.length >= 3 && x.s.every((s) => !s.elevated))
    .sort((a, b) => b.s.length - a.s.length)[0];
  const longest = O.chainsOf(doc, RR.s.map((s) => s.id)).sort((a, b) => b.length - a.length)[0].map((c) => c.s.id);
  const nj = doc.ids('junction').size;
  const fr = doc.transact('Flyover road', () => O.elevate(doc, longest, 6.5, 0.05))!;
  const nj2 = doc.ids('junction').size;
  check(nj2 > nj, `"${RR.r.name}" flyover over ${longest.length} sections: deck ${fr.deck} m, passes over ${nj2 - nj} junction(s)`);
  doc.transact('Road to ground', () => O.toGround(doc, longest));
  check(doc.ids('junction').size === nj, `back down: rejoined the junctions below (${doc.ids('junction').size} vs ${nj})`);
  while (doc.canUndo) doc.undo();
  check(doc.patch.size === 0, 'undo all → clean base');
}
// ---------------- terraforming and graded roads ----------------
{
  const O = OPS;
  const T = new TerrainCompiler(doc, hf);
  T.full();
  check(T.cut === 0 && T.fill === 0, 'no earthworks: designed ground = original');
  const raise = { kind: 'earthwork' as const, id: 'ewt1', op: 'shift' as const, seq: 1, pts: [100, 100, 2, 110, 100, 2], radius: 30 };
  doc.transact('Raise', () => doc.create(raise)); T.update(['ewt1']);
  const h0 = hf.sample(100, 100, hf.ground), h1 = hf.sample(100, 100);
  check(h1 - h0 > 3 && T.fill > 0 && T.cut === 0, `raise: +${(h1 - h0).toFixed(2)} m, fill ${T.fill.toFixed(0)} m³`);
  const v = T.volumeOf('ewt1');
  check(Math.abs(v.fill - T.fill) < 1 && v.cut === 0, `its own volume = the total (${v.fill.toFixed(0)} m³)`);
  const H = Math.round(hf.sample(400, 400) + hf.base + 3);
  const pad = { kind: 'earthwork' as const, id: 'ewt2', op: 'pad' as const, seq: 2, pts: [380, 380, 420, 380, 420, 420, 380, 420], radius: 0, height: H, sideSlope: 0.5 };
  doc.transact('Pad', () => doc.create(pad)); T.update(['ewt2']);
  check(Math.abs(hf.sample(400, 400) + hf.base - H) < 0.01 && Math.abs(hf.sample(404, 396) + hf.base - H) < 0.01, `pad: flat at ${H} m above sea level`);
  const edge = hf.sample(440, 400) + hf.base;
  check(edge < H && edge > H - 20 * 0.5 - 0.5, `pad side slope 1:2 (${(H - edge).toFixed(1)} m down 20 m out)`);
  doc.transact('Pad higher', () => doc.update('ewt2', { height: H + 2 })); T.update(['ewt2']);
  check(Math.abs(hf.sample(400, 400) + hf.base - (H + 2)) < 0.01, 'editing an earthwork re-applies it');
  doc.undo(); doc.undo(); doc.undo(); T.update(['ewt1', 'ewt2']);
  let diff = 0;
  for (let k = 0; k < hf.designed.length; k++) diff = Math.max(diff, Math.abs(hf.designed[k] - hf.ground[k]));
  check(diff === 0 && T.cut < 1e-3 && T.fill < 1e-3, `undo all earthworks → the original ground (max diff ${diff})`);

  // graded road, stations every ≤ 96 m
  const X = doc.all('section').filter((s) => !s.elevated && s.bridge === 'none' && (C.geo(s.id)?.len ?? 0) > 320 && s.path.length <= 3)
    .sort((a, b) => C.geo(b.id)!.len - C.geo(a.id)!.len)[0];
  const L = C.geo(X.id)!.len;
  doc.transact('Grade', () => O.gradeSections(doc, [X.id], (x, z) => hf.sample(x, z) + hf.base));
  const gr = doc.get<'section'>(X.id)!.grade!;
  const ds = L / (gr.z.length - 1);
  let steep = 0;
  for (let i = 1; i < gr.z.length; i++) steep = Math.max(steep, Math.abs(gr.z[i] - gr.z[i - 1]) / ds);
  check(gr.z.length === Math.ceil(L / O.GRADE_STEP) + 1 && ds <= O.GRADE_STEP + 1e-6 && steep <= 0.08 + 1e-3, `graded: ${gr.z.length} stations ${ds.toFixed(1)} m apart on ${L.toFixed(0)} m, steepest ${(steep * 100).toFixed(1)} %`);
  check(!!C.mesher.segs.get(`${X.id}~0`)?.grade, 'graded pieces carry their profile to the mesher');
  check((C.mesher.items.get(`s:${X.id}~0`)?.stamps[0]?.z?.length ?? 0) > 0, 'graded pieces cut / fill the ground to the road');
  doc.transact('Follow', () => O.ungradeSections(doc, [X.id]));
  check(!doc.get<'section'>(X.id)!.grade && !C.mesher.segs.get(`${X.id}~0`)?.grade, 'back to following the terrain');
  while (doc.canUndo) doc.undo();
  check(doc.patch.size === 0, 'undo all → clean base');
}

// ---------------- survey regions ----------------
{
  const O = OPS;
  const R = JSON.parse(fs.readFileSync(dir + 'dp/regions.json', 'utf8'));
  check(R.regions.length > 500 && R.regions.some((r: { reserved: boolean }) => r.reserved), `DP regions file: ${R.regions.length} regions`);
  const t = R.regions.find((r: { reserved: boolean; marker?: number[] }) => r.reserved && r.marker);
  const snap = { src: t.id, cls: t.cls, reserved: t.reserved, ring: t.ring, area: t.area, sheet: t.sheet, marker: t.marker, conf: t.conf, status: 'unsurveyed' as const };
  doc.transact('Survey', () => O.editRegion(doc, t.id, { status: 'built', code: 'PG 12', note: 'parking lot' }, snap));
  const o = doc.get<'region'>(t.id)!;
  check(!!o && o.status === 'built' && o.code === 'PG 12' && o.ring.length === t.ring.length, 'first survey edit creates the region object');
  doc.transact('Survey 2', () => O.editRegion(doc, t.id, { status: 'differs' }));
  check(doc.get<'region'>(t.id)!.status === 'differs' && doc.get<'region'>(t.id)!.code === 'PG 12', 'later edits update it');
  const back = new CityDoc(buildBase(net, tile, util), newMeta('kp', '', ''));
  openMap(back, parse(serialize(doc)));
  check(back.get<'region'>(t.id)?.status === 'differs' && back.get<'region'>(t.id)?.note === 'parking lot', 'survey region survives save / load');
  doc.undo(); doc.undo();
  check(!doc.get(t.id), 'undo removes it');
}
// ---- catalogue assets ----
{
  const A = await import('../../src/assets/index');
  const { ruleIssues } = await import('../../src/doc/rules');
  const all = A.allAssets();
  check(all.length > 150 && new Set(all.map((a) => a.id)).size === all.length, `${all.length} assets, unique ids`);
  const streets = all.filter((a) => a.profile.type === 'street');
  check(streets.every((a) => a.profile.type === 'street' && a.profile.parts.every((p) => p.width > 0) && (a.id === 'road.subway' || a.profile.parts.some((p) => p.kind === 'lane' || p.kind === 'bus'))), 'every street asset has lanes (but the subway) and positive widths');
  const pune = all.filter((a) => a.pack === 'pune');
  const off = pune.filter((a) => Math.abs(A.assetWidth(a) - Number(/^([\d.]+)/.exec(a.name)![1])) > 0.01);
  check(pune.length >= 40 && !off.length, `Pune USDG templates add up to their right of way${off.length ? ': ' + off.map((a) => a.id).join(', ') : ''}`);
  const docA = new CityDoc(buildBase(net, tile, util), newMeta('kp', '', ''));
  const b = docA.all('building')[0];
  let cx = 0, cz = 0; for (let i = 0; i < b.outer.length; i += 2) { cx += b.outer[i]; cz += b.outer[i + 1]; } cx /= b.outer.length / 2; cz /= b.outer.length / 2;
  const nalla = A.getAsset('water.nalla')!;
  const lid = docA.transact('Nalla', () => A.createAssetLine(docA, nalla, [cx - 60, cz, cx + 60, cz], 0));
  const l = docA.get<'line'>(lid as string)!;
  check(!!l && l.props.asset === 'water.nalla' && !!docA.get(l.layer), 'asset line and its layer are created');
  const near = (x0: number, z0: number, x1: number, z1: number) => docA.all('building').filter((o) => { const xs = o.outer.filter((_, i) => i % 2 === 0), zs = o.outer.filter((_, i) => i % 2 === 1); return Math.max(...xs) >= x0 && Math.min(...xs) <= x1 && Math.max(...zs) >= z0 && Math.min(...zs) <= z1; }).map((o) => o.id);
  check(ruleIssues(docA, near).some((i) => i.key.startsWith(`rule:${lid}`) && i.ids.includes(b.id)), 'a building on a nalla breaks its 6 m buffer');
  const st = A.getAsset('pune.18A')!;
  const r = docA.transact('Road', () => OPS.drawStretch(docA, { x: cx, z: cz + 300 }, { x: cx + 200, z: cz + 300 }, [OPS.line([cx, cz + 300], [cx + 200, cz + 300])], 'tertiary', { parts: st.profile.type === 'street' ? st.profile.parts : undefined, asset: st.id }));
  const back = new CityDoc(buildBase(net, tile, util), newMeta('kp', '', ''));
  openMap(back, parse(serialize(docA)));
  check(back.get<'line'>(lid as string)?.props.asset === 'water.nalla' && back.get<'section'>(r!.section!)?.asset === 'pune.18A' && totalWidth(back.get<'section'>(r!.section!)!.parts) === 18, 'asset lines and street assets survive save / load');
}
// ---- junctions: transitions, level roads on slopes, signals, slip lanes ----
{
  const docJ = new CityDoc(buildBase(net, tile, util), newMeta('kp', '', ''));
  const CJ = new Compiler(docJ, hf);
  CJ.full();
  const M = CJ.mesher as unknown as { kinds: Map<string, string>; signals: Map<string, unknown[]>; items: Map<string, { layers: Record<string, { idx: Uint32Array } | undefined> }>; slipCandidates(id: string): { from: string; to: string }[]; slipsBuilt(id: string): Set<string> };
  const kinds = [...M.kinds.values()];
  check(kinds.includes('transition'), `roads that change cross-section carry on through a tapered joint (${kinds.filter((k) => k === 'transition').length} transitions)`);
  check(M.signals.size > 0, `signalised junctions get signal heads (${M.signals.size} junctions)`);
  // ground roads are level across: terrain under them conformed, nothing poking through the asphalt
  const { generateNetwork } = await import('../../src/net/generate');
  const hf2 = new Heightfield(tile.terrain.n, tile.terrain.cell, tile.terrain.heights);
  const NM = generateNetwork(net, hf2);
  hf2.conform(NM.targets);
  const pos = NM.asphalt.pos, nor = NM.asphalt.nor;
  let n = 0, clip = 0;
  for (let i = 0; i < pos.length; i += 3) { if (nor[i + 1] < 0.9) continue; n++; if (hf2.sampleSurface(pos[i], pos[i + 2]) - pos[i + 1] > 0.02) clip++; }
  check(clip / n < 0.001, `terrain stays under road surfaces on slopes (${clip} of ${n} vertices poke through)`);
  // slip lanes: add at the first junction where one fits, undo / redo, save / load
  let jid = '', key = '';
  for (const j of docJ.all('junction')) {
    const c = M.slipCandidates(j.id);
    if (!c.length || docJ.sectionsAt(j.id).length < 3) continue;
    docJ.transact('Slip', () => docJ.set(j.id, 'slips', c.map((x) => ({ from: x.from, to: x.to }))));
    CJ.update([j.id]);
    const b = M.slipsBuilt(j.id);
    if (b.size) { jid = j.id; key = [...b][0]; break; }
    docJ.undo(); CJ.update([j.id]);
  }
  const paving = (id: string) => M.items.get('n:' + id)?.layers.paving?.idx.length ?? 0;
  check(!!jid, `a slip lane fits at a real junction (${key})`);
  const withSlip = paving(jid);
  docJ.undo(); CJ.update([jid]);
  const without = paving(jid);
  docJ.redo(); CJ.update([jid]);
  check(withSlip > without && paving(jid) === withSlip, 'slip lane island and footpath come and go with undo / redo');
  const back = new CityDoc(buildBase(net, tile, util), newMeta('kp', '', ''));
  openMap(back, parse(serialize(docJ)));
  check((back.get<'junction'>(jid)?.slips?.length ?? 0) > 0, 'slip lanes survive save / load');
}
// ---- road tools (Network Multitool style) ----
{
  const G = await import('../../src/doc/netgeom');
  type V2 = [number, number];
  const near = (a: V2, b: V2, e = 0.05) => Math.hypot(a[0] - b[0], a[1] - b[1]) < e;
  // geometry: curve–straight–curve and loops start / end where asked, turn no tighter than the radii
  const csc = G.cscPaths([0, 0], [1, 0], 20, [120, 80], [0, 1], 30);
  check(csc.length > 0 && csc.every((c) => near(c.pts[0], [0, 0]) && near(c.pts[c.pts.length - 1], [120, 80], 0.5) && G.minRadius(c.pts) > 19), `connections: ${csc.length} shapes, all from start to end, radius ≥ 20 m`);
  const loops = G.scsLoops([0, 0], [1, 0], [60, 100], [0, 1], 25); // two roads crossing at (60, 0)
  check(loops.some((l) => Math.abs(l.sweep) > Math.PI) && loops.every((l) => G.minRadius(l.pts.slice(1, -1)) > 24), `loops: ${loops.length} shapes (90° and the 270° loop), radius 25 m`);
  const ring: V2[] = [0, 1, 2, 3, 4].map((k) => [50 + Math.cos(k) * 40, -20 + Math.sin(k) * 40]);
  const fc = G.fitCircle(ring);
  check(!!fc && Math.abs(fc.R - 40) < 0.01 && near(fc.c, [50, -20], 0.01), 'circle fit through junctions');
  const off = G.offsetPolyline([[0, 0], [50, 0], [100, 30]], 10);
  check(Math.abs(off[0][1] - -10) < 1e-6 || Math.abs(off[0][1] - 10) < 1e-6, 'parallel offset keeps its distance');
  // operations on a test grid far from the network
  const D = new CityDoc(buildBase(net, tile, util), newMeta('kp', '', ''));
  const X = 2200, Z = -2200;
  const st = (a: V2, b: V2) => D.transact('road', () => OPS.drawStretch(D, { x: a[0], z: a[1] }, { x: b[0], z: b[1] }, [OPS.line(a, b)], 'tertiary'));
  const r1 = st([X, Z], [X + 200, Z])!, r2 = st([X + 100, Z - 100], [X + 100, Z + 100])!;
  const ok = (v: unknown) => !!v;
  const jx = D.transact('x', () => OPS.intersectSections(D, r1.section!, r2.section!));
  check(ok(jx) && D.sectionsAt(jx as string).length === 4, 'intersect: two crossing roads meet in a 4-way junction');
  // split it again: two arms to a new junction 20 m away
  const arms = D.sectionsAt(jx as string).slice(0, 2).map((s) => s.id);
  const js = D.transact('split', () => OPS.splitJunction(D, jx as string, arms, X + 120, Z + 20));
  check(ok(js) && D.sectionsAt(js as string).length === 2 && D.sectionsAt(jx as string).length === 2, 'split junction: two arms move to the new junction');
  check(OPS.unionProblem(D, js as string, jx as string) === null || OPS.unionProblem(D, js as string, jx as string) === 'common', 'merge check runs');
  // a wiggly chain of 4 junctions: line them up, then a circle, then a slope
  const P: V2[] = [[X, Z + 400], [X + 60, Z + 415], [X + 120, Z + 390], [X + 180, Z + 410]];
  const ends: string[] = [];
  for (let i = 0; i + 1 < P.length; i++) {
    const r = D.transact('w', () => OPS.drawStretch(D, i ? { x: P[i][0], z: P[i][1], junction: ends[i] } : { x: P[i][0], z: P[i][1] }, { x: P[i + 1][0], z: P[i + 1][1] }, [OPS.line(P[i], P[i + 1])], 'residential'))!;
    if (!i) ends.push(r.a);
    ends.push(r.b);
  }
  check(!!OPS.chainSections(D, ends), 'chain of junctions joined by roads');
  D.transact('line', () => OPS.arrangeOnLine(D, ends, [X, Z + 400], [1, 0]));
  check(ends.every((id) => Math.abs(D.get<'junction'>(id)!.z - (Z + 400)) < 0.02), 'arrange on line: every junction on the line');
  const c: V2 = [X + 90, Z + 480], Rr = 100;
  const angs = [-2.4, -2.0, -1.4, -0.8];
  D.transact('circle', () => OPS.arrangeOnCircle(D, ends, c, Rr, angs));
  const onCircle = ends.every((id) => { const J = D.get<'junction'>(id)!; return Math.abs(Math.hypot(J.x - c[0], J.z - c[1]) - Rr) < 0.05; });
  const S1 = OPS.chainSections(D, ends)!;
  const mids = S1.map((s) => { const q = OPS.samplePath(OPS.anchorsOf(D, s), 8); const m = q.pts[Math.floor(q.pts.length / 2)]; return Math.hypot(m[0] - c[0], m[1] - c[1]); });
  check(onCircle && mids.every((r) => Math.abs(r - Rr) < 0.3), 'arrange on circle: junctions and the roads between them on the circle');
  const ground = (x: number, z: number) => hf.sample(x, z) + hf.base;
  D.transact('slope', () => OPS.slopeChain(D, ends, ground));
  const Js = ends.map((id) => D.get<'junction'>(id)!);
  const lens = OPS.chainSections(D, ends)!.map((s) => OPS.samplePath(OPS.anchorsOf(D, s), 24).len);
  const H = Js.map((j) => ground(j.x, j.z) + j.lift);
  let acc = 0; const grades: number[] = [];
  for (let i = 0; i + 1 < Js.length; i++) { grades.push((H[i + 1] - H[i]) / lens[i]); acc += lens[i]; }
  check(grades.every((g) => Math.abs(g - grades[0]) < 0.002) && OPS.chainSections(D, ends)!.every((s) => !!s.grade), `even slope: one gradient along the chain (${(grades[0] * 100).toFixed(2)} %)`);
  // a connection between the two test roads, a parallel road, locking
  const rc = D.transact('conn', () => OPS.roadAlong(D, G.cscPaths([X, Z + 400], [1, 0], 20, [X + 300, Z + 200], [0, -1], 20)[0].pts, { x: X, z: Z + 400, junction: ends[0] }, { x: X + 300, z: Z + 200 }, 'residential'));
  check(!!rc?.section, 'connection built as a road');
  const par = G.offsetPolyline(OPS.samplePath(OPS.anchorsOf(D, D.get<'section'>(r1.section!) ?? D.all('section')[0]), 8).pts as V2[], 15);
  check(par.length > 2, 'parallel polyline');
  const sid = D.all('section').find((s) => s.road === r1.road)!.id;
  D.transact('lock', () => OPS.setLocked(D, [sid], true));
  check(D.get<'section'>(sid)!.locked === true, 'lock a section');
}
// ---- flyover in the median: deck over the road, ramps landing in merge joints ----
{
  const D = new CityDoc(buildBase(net, tile, util), newMeta('kp', '', ''));
  const CF = new Compiler(D, hf);
  CF.full();
  const road = D.all('road').find((r) => r.name === 'GDP Road')!;
  const ch = OPS.chainsOf(D, D.sectionsOf(road.id).map((s) => s.id)).sort((a, b) => b.length - a.length)[0];
  const pts: [number, number][] = [];
  for (const c of ch) { const S = OPS.samplePath(OPS.anchorsOf(D, c.s), 16).pts as [number, number][]; const r = c.fwd ? S : [...S].reverse(); pts.push(...(pts.length ? r.slice(1) : r)); }
  const along = (L: number): [number, number] => { let acc = 0; for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (acc + l >= L) { const t = (L - acc) / l; return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]; } acc += l; } return pts[pts.length - 1]; };
  const near = (p: [number, number]) => D.sectionsOf(road.id).map((s) => ({ s, d: OPS.nearestOnPath(OPS.anchorsOf(D, s), p).d })).sort((a, b) => a.d - b.d)[0].s.id;
  const p0 = along(150), p1 = along(650);
  let fid: string | null = null;
  const ids = D.transact('Flyover', () => { const r = OPS.flyoverOver(D, { section: near(p0), p: p0 }, { section: near(p1), p: p1 }, OPS.FLYOVER_PARTS['2']); fid = r?.section ?? null; return r; });
  void ids;
  CF.update(D.all('section').map((s) => s.id));
  const fly = fid ? D.get<'section'>(fid) : undefined;
  const merges = [...(CF.mesher as unknown as { kinds: Map<string, string> }).kinds.values()].filter((k) => k === 'merge').length;
  check(!!fly && fly.elevated && Math.max(...fly.path.map((a) => a.lift)) >= 6.4 && fly.path[0].lift === 0 && fly.path[fly.path.length - 1].lift === 0, 'flyover in the median: deck at 6.5 m, ramps down to the road at both ends');
  check(merges >= 2, `its ramps land in merge joints, not junctions (${merges})`);
}
// ---- imported DP roads: standard lanes, no slivers, one lane layout along a road ----
{
  type Seg = { type: string; name?: string; reserve?: number };
  const parts = (s: Seg) => net.types[s.type].parts as { kind: string; width: number }[];
  const dpSecs = (net.segments as Seg[]).filter((s) => s.reserve);
  const wide = dpSecs.filter((s) => parts(s).some((p) => p.kind === 'lane' && p.width > 3.65));
  const sliver = dpSecs.filter((s) => parts(s).some((p) => p.kind === 'shoulder' && p.width < 0.6));
  check(!wide.length && !sliver.length, `DP roads: no lanes over 3.6 m (${wide.length}), no shoulders under 0.6 m (${sliver.length})`);
  const gdp = dpSecs.filter((s) => s.name === 'GDP Road');
  const lanes = new Set(gdp.map((s) => parts(s).filter((p) => p.kind === 'lane').length));
  check(gdp.length > 10 && lanes.size === 1 && lanes.has(4), `GDP Road keeps 2 + 2 lanes along its length (${[...lanes].join(', ')})`);
}
console.log(ok ? '\nALL OK' : '\nFAILURES');
process.exit(ok ? 0 : 1);
