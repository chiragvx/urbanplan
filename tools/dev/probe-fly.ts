import fs from 'node:fs';
import { parseTile } from '../../src/data/tile';
import { buildBase } from '../../src/doc/base';
import { CityDoc } from '../../src/doc/doc';
import { newMeta } from '../../src/doc/format';
import * as OPS from '../../src/doc/ops';
import { totalWidth } from '../../src/doc/xsection';
const dir = 'public/tiles/kp/';
const hdr = JSON.parse(fs.readFileSync(dir + 'tile.json', 'utf8'));
const buf = fs.readFileSync(dir + 'tile.bin');
const tile = parseTile(hdr, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const net = JSON.parse(fs.readFileSync(dir + 'network.json', 'utf8'));
const doc = new CityDoc(buildBase(net, tile, null), newMeta('kp', '', ''));
type V2 = [number, number];
const secs = doc.all('section');
const samp = new Map(secs.map((s) => [s.id, OPS.samplePath(OPS.anchorsOf(doc, s), 12)]));
let n = 0;
for (const s of secs) {
  if (!s.elevated) continue;
  for (const jid of [s.a, s.b]) {
    const J = doc.get<'junction'>(jid)!;
    if (Math.abs(J.lift) > 0.25) continue;
    // ramp polyline from the touchdown outwards (first 80 m) with its heights
    const S = samp.get(s.id)!;
    const pts = s.a === jid ? S.pts : [...S.pts].reverse();
    const lifts = s.a === jid ? S.lift : [...S.lift].reverse();
    const ss = s.a === jid ? S.s : S.s.map((v) => S.len - v).reverse();
    // ground roads whose footprint the ramp runs over
    const over = new Map<string, { k: number; off: number[]; w: number }>();
    for (let i = 0; i < pts.length && ss[i] < 80; i++) {
      const q = pts[i] as V2;
      for (const o of secs) {
        if (o.elevated || o.id === s.id) continue;
        const P = samp.get(o.id)!;
        let bd = Infinity, bi = 0;
        for (let k = 0; k < P.pts.length; k++) { const d = Math.hypot(P.pts[k][0] - q[0], P.pts[k][1] - q[1]); if (d < bd) { bd = d; bi = k; } }
        const w = totalWidth(o.parts);
        if (bd > w / 2) continue;
        const a = P.pts[Math.max(0, bi - 1)], b = P.pts[Math.min(P.pts.length - 1, bi + 1)];
        const hx = b[0] - a[0], hz = b[1] - a[1], hl = Math.hypot(hx, hz) || 1;
        const off = ((q[0] - P.pts[bi][0]) * hz - (q[1] - P.pts[bi][1]) * hx) / hl;
        const e = over.get(o.id) ?? { k: 0, off: [], w };
        e.k++; e.off.push(Math.round(off * 10) / 10);
        over.set(o.id, e);
      }
    }
    const at = doc.sectionsAt(jid).filter((o) => o.id !== s.id);
    if (n++ < 30) console.log(`${s.name || '-'} w${totalWidth(s.parts)} oneway=${s.parts.every((p) => p.dir !== -1 || p.kind !== 'lane')} touchdown ${Math.round(J.x)},${Math.round(J.z)} arms ${at.map((o) => `${o.name || '-'}:${totalWidth(o.parts)}`).join(' ')} | over: ${[...over.entries()].map(([id, e]) => `${doc.get<'section'>(id)!.name || '-'} w${e.w} samples ${e.k} off ${e.off.slice(0, 4).join('/')}`).join(' ; ')}`);
  }
}
