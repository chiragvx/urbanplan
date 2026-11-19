// A PreDCR-style drawing file: the scheme as closed polylines on the layers PreDCR (SoftTech's AutoCAD add-on for
// BPMS and AutoDCR) reads, each with a name label inside it, so an architect starts from the plot, the proposed
// work, the roads and the parking already drawn instead of tracing them. Written as AutoCAD R12 ASCII DXF (AC1009):
// the oldest, plainest DXF, which every CAD program opens; closed POLYLINEs with VERTEX entities.
//
// The layer names follow the PreDCR help manual as published copies give them (_Plot, _PropWork, _MainRoad,
// _Marginline, _ResiFSI, _Bldg, _Floor, _InternalRoad, _RoadWidening…). The parking and unit layers are our best
// reading of it and may differ by PreDCR version: open the file in PreDCR and run its own checks before upload.
// Whether AutoDCR accepts a file not made inside PreDCR is still to be confirmed (docs/PLAN.md).
//
// Plan x is DXF X; plan z runs away from the front road, so it becomes −Y (the front road along the bottom).
// Units are metres.
import { UNIT_LABEL } from '../doc/site';
import type { Evaluated } from './evaluate';
import { outline, roadLines } from './project';

interface Layer { name: string; color: number }
/** the layers written, with AutoCAD colour numbers */
export const DXF_LAYERS: Layer[] = [
  { name: '_Plot', color: 1 },
  { name: '_NetPlot', color: 30 },
  { name: '_RoadWidening', color: 6 },
  { name: '_MainRoad', color: 8 },
  { name: '_Marginline', color: 3 },
  { name: '_PropWork', color: 2 },
  { name: '_Bldg', color: 2 },
  { name: '_Floor', color: 4 },
  { name: '_ResiFSI', color: 5 },
  { name: '_Shops', color: 40 },
  { name: '_Core', color: 9 },
  { name: '_Corridor', color: 9 },
  { name: '_StiltParking', color: 140 },
  { name: '_BasementParking', color: 150 },
  { name: '_Text', color: 7 },
];

const n = (v: number) => (Math.round(v * 1000) / 1000).toString();

export function predcrDxf(e: Evaluated): string {
  const { p, r, d, shops } = e;
  const out: string[] = [];
  const g = (code: number, value: string | number) => { out.push(String(code), typeof value === 'number' ? n(value) : value); };
  const X = (x: number) => x, Y = (z: number) => -z;

  // header: the drawing's extents and units (metres, AC1009)
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const { ring, roads } = outline(p);
  for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, X(ring[i])); x1 = Math.max(x1, X(ring[i])); y0 = Math.min(y0, Y(ring[i + 1])); y1 = Math.max(y1, Y(ring[i + 1])); }
  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009');
  g(9, '$INSUNITS'); g(70, '6');
  g(9, '$EXTMIN'); g(10, x0 - 30); g(20, y0 - 30); g(30, 0);
  g(9, '$EXTMAX'); g(10, x1 + 30); g(20, y1 + 30); g(30, 0);
  g(0, 'ENDSEC');

  // the layer table
  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, '1');
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, '0'); g(3, 'Solid line'); g(72, '65'); g(73, '0'); g(40, '0.0');
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, String(DXF_LAYERS.length + 1));
  g(0, 'LAYER'); g(2, '0'); g(70, '0'); g(62, '7'); g(6, 'CONTINUOUS');
  for (const L of DXF_LAYERS) { g(0, 'LAYER'); g(2, L.name); g(70, '0'); g(62, String(L.color)); g(6, 'CONTINUOUS'); }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'ENTITIES');
  const poly = (layer: string, pts: number[], closed = true) => {
    if (pts.length < 4) return;
    g(0, 'POLYLINE'); g(8, layer); g(66, '1'); g(10, 0); g(20, 0); g(30, 0); g(70, closed ? '1' : '0');
    for (let i = 0; i < pts.length; i += 2) { g(0, 'VERTEX'); g(8, layer); g(10, X(pts[i])); g(20, Y(pts[i + 1])); g(30, 0); }
    g(0, 'SEQEND'); g(8, layer);
  };
  const text = (layer: string, x: number, z: number, h: number, s: string) => {
    // (centred on the point: horizontal 1 = centre, with the alignment point in 11/21)
    g(0, 'TEXT'); g(8, layer); g(10, X(x)); g(20, Y(z)); g(30, 0); g(40, h); g(1, s.replace(/\n/g, ' ')); g(72, '1'); g(11, X(x)); g(21, Y(z)); g(31, 0);
  };
  const mid = (q: number[]): [number, number] => { let x = 0, z = 0; for (let i = 0; i < q.length; i += 2) { x += q[i]; z += q[i + 1]; } return [x / (q.length / 2), z / (q.length / 2)]; };
  const area = (q: number[]) => { let a = 0; for (let i = 0; i < q.length; i += 2) { const j = (i + 2) % q.length; a += q[i] * q[j + 1] - q[j] * q[i + 1]; } return Math.abs(a / 2); };
  const labelled = (layer: string, q: number[], label: string, h = 0.8) => { poly(layer, q); const [x, z] = mid(q); text(layer, x, z, h, label); };

  // the plot, the net plot after the DP road, the strips handed over, the margin line
  labelled('_Plot', ring, `PLOT ${area(ring).toFixed(2)} SQ.M`, 1.2);
  if (r.lost > 0.5 && r.net.length >= 6) labelled('_NetPlot', r.net, `NET PLOT ${r.netArea.toFixed(2)} SQ.M`, 1);
  r.lostRings.forEach((lr) => labelled('_RoadWidening', lr, `ROAD WIDENING ${area(lr).toFixed(2)} SQ.M`, 0.8));
  if (r.footprint.length >= 6) poly('_Marginline', r.footprint);

  // the roads: a strip along each, as long as the plot's edge and a little more, with its width
  for (const l of roadLines(ring, roads)) {
    const [ax, az, bx, bz] = l.pts, L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
    const nx = -uz * l.road.today / 2, nz = ux * l.road.today / 2;
    // (the lines run 300 m past each end: keep 20 m past the plot)
    const a = [ax + ux * 280, az + uz * 280], b = [bx - ux * 280, bz - uz * 280];
    const q = [a[0] + nx, a[1] + nz, b[0] + nx, b[1] + nz, b[0] - nx, b[1] - nz, a[0] - nx, a[1] - nz];
    labelled('_MainRoad', q, `ROAD WIDTH ${l.road.today.toFixed(2)} M${l.road.dp > l.road.today ? ` (DP ${l.road.dp.toFixed(2)} M)` : ''}`, 1.2);
  }

  // the buildings: the proposed work (each wing's plate), the floor, the flats, cores, corridors
  d.buildings.forEach((b, bi) => {
    const nm = String.fromCharCode(65 + bi);
    b.quads.forEach((q, k) => {
      labelled('_PropWork', q, `BLDG ${nm}${b.quads.length > 1 ? `-${k + 1}` : ''}`, 1);
      poly('_Bldg', q);
    });
    // a direction marker (PreDCR wants one inside the proposed work): a small circle drawn as a polyline
    const [cx, cz] = mid(b.quads[0]);
    const circ: number[] = [];
    for (let k = 0; k < 12; k++) circ.push(cx + 0.5 * Math.cos((k * Math.PI) / 6), cz + 1.5 + 0.5 * Math.sin((k * Math.PI) / 6));
    poly('_Bldg', circ);
    // the typical floor, labelled with how many floors it repeats on
    b.quads.forEach((q) => poly('_Floor', q));
    text('_Text', cx, cz - 1.5, 0.8, `TYPICAL FLOOR x ${b.floors}${d.under ? ` OVER ${d.under} STILT` : ''}`);
    b.units.forEach((u, ui) => {
      const shop = shops?.removed.get(bi)?.has(ui);
      labelled(shop ? '_Shops' : '_ResiFSI', u.ring, `${shop ? 'SHOP / ' : ''}${UNIT_LABEL[u.t] ?? 'UNIT'} ${u.carpet.toFixed(2)} SQ.M CARPET`, 0.45);
    });
    b.cores.forEach((c) => labelled('_Core', c, 'STAIR + LIFT', 0.5));
    b.corridors.forEach((c) => poly('_Corridor', c));
  });
  // ground-floor shops
  shops?.strips.forEach((s) => labelled('_Shops', s.ring, `SHOPS (GROUND) ${s.area.toFixed(2)} SQ.M`, 0.6));

  // the parking: each bay, numbered, on the stilt or basement layer
  let no = 0;
  for (const lv of d.parking.levels) {
    const layer = lv.kind === 'basement' ? '_BasementParking' : '_StiltParking';
    for (const bay of lv.bays) { no++; labelled(layer, bay, `${lv.kind === 'basement' ? 'B' : 'S'}-P${no}`, 0.4); }
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return out.join('\n') + '\n';
}
