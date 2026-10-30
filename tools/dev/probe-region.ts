// Region window in node: load 3×3 pieces from disk, build the document, compile; then move the window one piece and
// time the paging. Run with --cpu-prof to see where compile time goes.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { Heightfield } from '../../src/geo/heightfield';
import { CityDoc } from '../../src/doc/doc';
import { Compiler } from '../../src/doc/compile';
import { newMeta } from '../../src/doc/format';
import { baseLayers, buildingObj } from '../../src/doc/base';
import { windowPieces, windowTile, type Piece, type RegionManifest } from '../../src/data/region';
import type { Obj } from '../../src/doc/types';

const dir = 'public/regions/pune/';
const M: RegionManifest = JSON.parse(fs.readFileSync(dir + 'region.json', 'utf8'));
const G = JSON.parse(zlib.gunzipSync(fs.readFileSync(dir + 'global.json.gz')).toString());
const ci = +(process.argv[2] ?? 1), cj = +(process.argv[3] ?? -2);
function load(i: number, j: number): Piece {
  const hdr = JSON.parse(zlib.gunzipSync(fs.readFileSync(`${dir}p/${i}_${j}.json.gz`)).toString());
  const buf = zlib.gunzipSync(fs.readFileSync(`${dir}p/${i}_${j}.bin.gz`));
  const bin = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const S: Record<string, Float32Array | Uint32Array | Uint8Array> = {};
  for (const s of hdr.sections) { const C = s.type === 'Float32Array' ? Float32Array : s.type === 'Uint32Array' ? Uint32Array : s.type === 'Uint16Array' ? Uint16Array : Uint8Array; S[s.name] = new C(bin, s.offset, s.length) as never; }
  const polys = (name: string) => { const P = S[name + 'Pts'] as Float32Array, poly = S[name + 'Poly'], rs = S[name + 'RingStart'], rc = S[name + 'RingCount']; const out = []; for (let k = 0; k < poly.length; k += 2) { const rings = []; for (let r = poly[k]; r < poly[k] + poly[k + 1]; r++) rings.push(P.slice(rs[r] * 2, (rs[r] + rc[r]) * 2)); out.push({ outer: rings[0], holes: rings.slice(1) }); } return out; };
  const hts = Float32Array.from(S.terrain as unknown as Uint16Array, (v) => hdr.base + v * hdr.hq);
  return {
    i, j, rect: hdr.rect, n: hdr.n, heights: hts, waterLevel: new Float32Array(hdr.n * hdr.n), waterMask: new Uint8Array(hdr.n * hdr.n),
    buildings: polys('bld').map((p, k) => ({ ...p, id: hdr.bldIds[k], osm: hdr.bldIds[k], h: (S.bldHeight as Float32Array)[k], minH: 0, kind: S.bldKind[k], roof: 0, name: '' })),
    areas: [], waters: [], waterways: [], trees: new Float32Array(), busStops: [], signals: new Float32Array(), objs: hdr.objs, bytes: buf.length,
  } as Piece;
}
const cache = new Map<string, Piece>();
const objsOf = (list: [number, number][]) => { const out = new Map<string, Obj>(); for (const [i, j] of list) { const p = cache.get(`${i}_${j}`)!; for (const o of p.objs) out.set(o.id, o); for (const b of p.buildings) out.set('b' + b.osm, buildingObj(b, 'b' + b.osm, b.osm)); } return [...out.values()]; };
let t = Date.now();
const list = windowPieces(M, ci, cj);
for (const [i, j] of [...list, ...windowPieces(M, ci + 1, cj)]) cache.set(`${i}_${j}`, load(i, j));
console.log('load', Date.now() - t, 'ms');
t = Date.now();
const tile = windowTile(M, ci, cj, cache);
const hf = new Heightfield(tile.terrain.n, tile.terrain.cell, tile.terrain.heights, { base: M.base, ox: tile.ox, oz: tile.oz });
const base = new Map<string, Obj>();
for (const o of [...G.roads, ...G.lines, ...baseLayers(''), ...objsOf(list)]) base.set(o.id, o);
const doc = new CityDoc(base, newMeta(M.id, M.fingerprint, ''));
console.log('doc', Date.now() - t, 'ms', doc.ids('section').size, 'sections', doc.ids('junction').size, 'junctions', doc.ids('building').size, 'buildings');
const C = new Compiler(doc, hf);
t = Date.now(); C.full(); console.log('compile window', Date.now() - t, 'ms', C.mesher.items.size, 'items');
doc.on((c) => { C.update(c.ids); });
// move one piece east
const next = windowPieces(M, ci + 1, cj);
const tile2 = windowTile(M, ci + 1, cj, cache);
hf.reset(tile2.ox!, tile2.oz!, tile2.terrain.heights);
const objs = objsOf(next), keep = new Set(objs.map((o) => o.id));
const roadIds = new Set(G.roads.map((r: Obj) => r.id));
const remove = [...base.keys()].filter((id) => (id[0] === 's' || id[0] === 'j' || id[0] === 'b' || id.startsWith('pa')) && !keep.has(id) && !roadIds.has(id));
const add = objs.filter((o) => !doc.base.has(o.id));
t = Date.now(); doc.page(add, remove); console.log('page (compile) one piece east:', Date.now() - t, 'ms', add.filter((o) => o.kind === 'section').length, 'sections added');
