// Save a map with edits on the current base (mode "save"), or open the saved one on the current base and report
// how its edits re-attach (mode "open").
import fs from 'node:fs';
import { parseTile } from '../../src/data/tile';
import { buildBase, baseFingerprint } from '../../src/doc/base';
import { CityDoc } from '../../src/doc/doc';
import { newMeta, serialize, parse, openMap } from '../../src/doc/format';
import * as OPS from '../../src/doc/ops';
import { setTotalWidth, totalWidth } from '../../src/doc/xsection';
const dir = 'public/tiles/kp/', out = process.argv[3] ?? 'tools/dev/rebase-map.json';
const hdr = JSON.parse(fs.readFileSync(dir + 'tile.json', 'utf8'));
const buf = fs.readFileSync(dir + 'tile.bin');
const tile = parseTile(hdr, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const net = JSON.parse(fs.readFileSync(dir + 'network.json', 'utf8'));
const base = buildBase(net, tile, null);
const doc = new CityDoc(base, newMeta('kp', baseFingerprint(base), 'test'));
if (process.argv[2] === 'save') {
  const gdp = doc.all('road').find((r) => r.name === 'GDP Road')!;
  const secs = doc.sectionsOf(gdp.id);
  doc.transact('widen', () => { for (const s of secs.slice(0, 6)) doc.set(s.id, 'parts', setTotalWidth(s.parts, 30)); });
  const nm = doc.all('road').find((r) => r.name === 'North Main Road')!;
  doc.transact('rename', () => doc.set(nm.id, 'name', 'North Main Road (renamed)'));
  const j = doc.all('junction').find((q) => doc.sectionsAt(q.id).length === 4)!;
  doc.transact('move', () => OPS.moveJunction(doc, j.id, j.x + 3, j.z + 2));
  doc.transact('new', () => OPS.drawStretch(doc, { x: 2000, z: -2000 }, { x: 2100, z: -2000 }, [OPS.line([2000, -2000], [2100, -2000])], 'residential', { name: 'Test New Road' }));
  fs.writeFileSync(out, serialize(doc));
  console.log('saved', doc.patch.size, 'edited objects; GDP widened sections', secs.slice(0, 6).length, 'junction moved', j.id);
} else {
  const r = openMap(doc, parse(fs.readFileSync(out, 'utf8')));
  const gdp30 = doc.all('section').filter((s) => s.name === 'GDP Road' && Math.abs(totalWidth(s.parts) - 30) < 0.01).length;
  const renamed = doc.all('road').some((x) => x.name === 'North Main Road (renamed)');
  const newRoad = doc.all('section').some((s) => s.name === 'Test New Road');
  console.log(JSON.stringify({ remapped: r.remapped.length, unresolved: r.unresolved.length, gdpSectionsAt30m: gdp30, renamed, newRoad }));
}
