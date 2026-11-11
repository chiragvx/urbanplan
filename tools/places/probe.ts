// The named roads near a point, longest first — to check a place's centre lands where its config says.
//   node tools/dev/places-probe.mjs pune 18.5225 73.8412 [radius]
import { areaAround, lengthInside, openRegion } from './region';
import { totalWidth } from '../../src/doc/xsection';

const [id, lat, lon, rad] = process.argv.slice(2);
const R = openRegion(id);
const r = +(rad ?? 400);
const [x, z] = R.xz(+lat, +lon);
const A = areaAround(R, x, z, r);
const by = new Map<string, { L: number; w: number; dp: number }>();
for (const { s, pts } of A.sections) {
  if (!s.name) continue;
  const L = lengthInside(pts, x, z, r);
  if (L < 1) continue;
  const e = by.get(s.name) ?? { L: 0, w: 0, dp: 0 };
  e.L += L; e.w += totalWidth(s.parts) * L; e.dp += (s.reserve ?? 0) * L;
  by.set(s.name, e);
}
console.log(`${id} ${lat},${lon} r=${r}: x=${x.toFixed(0)} z=${z.toFixed(0)}, ${A.sections.length} sections, ${A.buildings.length} buildings`);
for (const [n, e] of [...by].sort((a, b) => b[1].L - a[1].L).slice(0, 14)) console.log(`  ${e.L.toFixed(0).padStart(5)} m  ${(e.w / e.L).toFixed(1).padStart(5)} m  dp ${(e.dp / e.L).toFixed(1).padStart(5)}  ${n}`);
