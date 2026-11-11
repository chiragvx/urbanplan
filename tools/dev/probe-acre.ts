// one acre in Pune / Mumbai: what the optimiser builds on 12, 18 and 30 m roads, as slabs and as towers
import { analysePlot } from '../../src/doc/plot';
import type { CityDoc } from '../../src/doc/doc';
import type { Compiler } from '../../src/doc/compile';
import type { PlotObj } from '../../src/doc/types';
import { solveSite, SQFT } from '../../src/doc/site';
import { siteFor, siteDefaults } from '../../src/doc/optimise';
const side = Math.sqrt(4046.86);
const SIDES: [number, number][] = process.argv[2] ? [[20, 30]] : [[side, side]];
for (const code of ['udcpr', 'dcpr-suburbs'] as const) for (const w of process.argv[2] ? [9] : [12, 18, 30]) for (const type of (process.argv[2] ? ['auto'] : ['slab', 'tower']) as ('slab' | 'tower' | 'auto')[]) for (const [sx, sz] of SIDES) {
  const section = { kind: 'section', id: 's1', name: 'Road', parts: [{ kind: 'lane', width: w }], reserve: w, cls: 'secondary', elevated: false };
  const doc = { get: (id: string) => (id === 's1' ? section : undefined) } as unknown as CityDoc;
  const C = { geo: (id: string) => (id === 's1' ? { pts: [-400, 0, 400, 0] } : undefined) } as unknown as Compiler;
  const z0 = w / 2 + 0.5, h = sx / 2;
  const plot: PlotObj = { kind: 'plot', id: 'p', name: 'Acre', ring: [-h, z0, h, z0, h, z0 + sz, -h, z0 + sz], use: 'residential' };
  const R = analysePlot(doc, C, () => ['s1'], plot, code);
  const st = siteFor({ ...siteDefaults('residential'), design: { type, maxFloors: 0, maxBuildings: 0 } }, R, 'residential');
  const D = solveSite(R, st, 'residential');
  const m = D.money;
  console.log(`${code} ${w}m ${type}: plot ${R.area.toFixed(0)} m², permissible ${R.bua.toFixed(0)} m² | ${D.buildings.length} bldg × ${Math.max(...D.buildings.map((b) => b.floors))} fl, H ${D.height.toFixed(1)} m (+${D.under} under) | used ${(D.bua).toFixed(0)} m² (${(D.bua / R.bua * 100).toFixed(0)}%) | ${D.flats} flats [${D.count.join('/')}] | cars ${D.parking.need}/${D.parking.have}, basements ${st.basements} | open ${D.open.have.toFixed(0)}/${D.open.need.toFixed(0)} | coverage ${(D.coverage * 100).toFixed(0)}% | margins side@H ${''} | rev ₹${(m.revenue / 1e7).toFixed(0)} cr cost ₹${(m.cost / 1e7).toFixed(0)} cr profit ₹${(m.profit / 1e7).toFixed(0)} cr IRR ${m.irr == null ? '-' : (m.irr * 100).toFixed(0) + '%'} | over ${Object.entries(D.over).filter(([, v]) => v).map(([k]) => k).join(',') || 'none'}`);
}
