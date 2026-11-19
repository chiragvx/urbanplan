// A PreDCR drawing: the scheme laid out the way MCGM's PreDCR help manual (AutoDCR) asks, so an architect starts
// from the plot, the buildings' floor plans and their section already drawn on the right layers instead of tracing
// them, then marks what only PreDCR can (paid / free of FSI, fire lift, stair landings…) and runs its Verify.
//
// What the manual asks, and what this writes (page numbers are the manual's):
//  • AutoCAD 2000 DXF (AC1015) with LWPOLYLINE, TEXT and CIRCLE only; every polygon closed (p18–19).
//  • Metres, everything in one drawing (p18, p21).
//  • Site plan: _Plot ("MAIN PLOT"), _MainRoad overlapping it, named with its width ("12.00 m wd. Main Road", p111),
//    _RoadWidening inside the plot, and a _PropWork per building named "A1 (Name)" (wing, number, building; p60).
//  • Per building, a _Building polygon round all its floor plans and its section, named "A1(Name)" to match its
//    proposed work (p30). Inside it each floor drawn separately in its own _Floor polygon named "GROUND FLOOR
//    PLAN", "TYPICAL 2-11 FLOOR PLAN"… (p43); in each, the floor's outline on _ResiFSI (shops on _CommFSI), inner
//    courtyards on _Chowk, every flat on _CarpetArea, stairs on _Staircase, lifts on _Liftwell, corridors on
//    _Passage, parking bays on _Parking ("CP-L" / "CP-S", p55).
//  • A _Section ("Section") with a _FloorInSection per floor named as its plan, and the _GroundLevel line (p44–45, p72).
//  • Two reference circles at one common point (in the first core) in every floor and in each proposed work, one
//    on _Floor and one on _ResiFSI (p60, p123), so PreDCR can stack the floors.
//  • Every polygon's name is one TEXT on its own layer, inside it (p18, p122).
// Layer names are as PreDCR's own layer list shows them (p23, p91); its "Create AutoDCR Layers" command makes them
// with its colours, and AutoCAD matches layer names regardless of case. Not here (PreDCR's Mark menu does them):
// paid / free-of-FSI marks, fire lift, staircase flight and landing lines and treads, balconies, tanks, the lift
// machine room. Whether AutoDCR takes a file not drawn in PreDCR is for its Verify to say.
//
// Plan x is DXF X; plan z runs away from the front road, so it becomes −Y (the front road along the bottom).
import { union, type MP } from '../doc/ground';
import { floorKind, UNIT_LABEL } from '../doc/site';
import type { Evaluated } from './evaluate';
import { outline, roadLines } from './project';

interface Layer { name: string; color: number }
/** the layers written, with AutoCAD colour numbers (PreDCR's own layer command sets its colours) */
export const DXF_LAYERS: Layer[] = [
  { name: '_Plot', color: 1 },
  { name: '_MainRoad', color: 8 },
  { name: '_RoadWidening', color: 6 },
  { name: '_PropWork', color: 2 },
  { name: '_Building', color: 7 },
  { name: '_Floor', color: 4 },
  { name: '_ResiFSI', color: 5 },
  { name: '_CommFSI', color: 40 },
  { name: '_Chowk', color: 3 },
  { name: '_CarpetArea', color: 30 },
  { name: '_Staircase', color: 9 },
  { name: '_Liftwell', color: 9 },
  { name: '_Passage', color: 8 },
  { name: '_Parking', color: 140 },
  { name: '_Section', color: 7 },
  { name: '_FloorInSection', color: 4 },
  { name: '_GroundLevel', color: 3 },
];

const ORD = ['GROUND', 'FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH', 'SEVENTH', 'EIGHTH', 'NINTH', 'TENTH', 'ELEVENTH', 'TWELFTH',
  'THIRTEENTH', 'FOURTEENTH', 'FIFTEENTH', 'SIXTEENTH', 'SEVENTEENTH', 'EIGHTEENTH', 'NINETEENTH', 'TWENTIETH'];
const word = (n: number) => ORD[n] ?? `${n}TH`;
/** a floor plan's name: one floor by its name, several as TYPICAL a-b */
export const floorName = (a: number, b: number) => (a === b ? `${word(a)} FLOOR PLAN` : `TYPICAL ${a}-${b} FLOOR PLAN`);
/** text safe for a DXF name: ASCII, no characters PreDCR's name parsing uses */
const clean = (s: string) => s.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/[(),&\-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30) || 'Scheme';

const num = (v: number) => (Math.round(v * 1000) / 1000).toString();
const ringArea = (q: number[]) => { let a = 0; for (let i = 0; i < q.length; i += 2) { const j = (i + 2) % q.length; a += q[i] * q[j + 1] - q[j] * q[i + 1]; } return Math.abs(a / 2); };
const mid = (q: number[]): [number, number] => { let x = 0, z = 0; for (let i = 0; i < q.length; i += 2) { x += q[i]; z += q[i + 1]; } return [x / (q.length / 2), z / (q.length / 2)]; };
const inRing = (q: number[], x: number, z: number) => {
  let c = false;
  for (let i = 0, j = q.length - 2; i < q.length; j = i, i += 2) if ((q[i + 1] > z) !== (q[j + 1] > z) && x < ((q[j] - q[i]) * (z - q[i + 1])) / (q[j + 1] - q[i + 1]) + q[i]) c = !c;
  return c;
};
const toMP = (rings: number[][]): MP => rings.map((q) => { const pts: [number, number][] = []; for (let i = 0; i < q.length; i += 2) pts.push([q[i], q[i + 1]]); return [pts]; });
/** the outline of a building's wings, as outer rings and holes (a courtyard) */
function footprint(quads: number[][]): { outer: number[][]; holes: number[][] } {
  const u = union(toMP(quads));
  const flat = (r: [number, number][]) => r.flatMap(([x, z]) => [x, z]);
  return { outer: u.map((p) => flat(p[0])), holes: u.flatMap((p) => p.slice(1).map(flat)) };
}
/** a core split into its stair (the longer part) and its lift */
function splitCore(c: number[]): [number[], number[]] {
  if (c.length !== 8) return [c, []];
  const [x0, z0, x1, z1, x2, z2, x3, z3] = c;
  const lerp = (ax: number, az: number, bx: number, bz: number, t: number) => [ax + (bx - ax) * t, az + (bz - az) * t];
  if (Math.hypot(x1 - x0, z1 - z0) >= Math.hypot(x2 - x1, z2 - z1)) {
    const a = lerp(x0, z0, x1, z1, 0.62), b = lerp(x3, z3, x2, z2, 0.62);
    return [[x0, z0, a[0], a[1], b[0], b[1], x3, z3], [a[0], a[1], x1, z1, x2, z2, b[0], b[1]]];
  }
  const a = lerp(x1, z1, x2, z2, 0.62), b = lerp(x0, z0, x3, z3, 0.62);
  return [[x0, z0, x1, z1, a[0], a[1], b[0], b[1]], [b[0], b[1], a[0], a[1], x2, z2, x3, z3]];
}

/** A minimal AutoCAD 2000 DXF: the tables, blocks and objects AutoCAD needs, then the entities. */
class Dxf {
  private out: string[] = [];
  private h = 0x100;
  private ents: string[] = [];
  readonly MS = 'F1';
  private next() { return (this.h++).toString(16).toUpperCase(); }
  private g(o: string[], code: number, v: string | number) { o.push(String(code), typeof v === 'number' ? num(v) : v); }
  poly(layer: string, pts: number[], closed = true) {
    if (pts.length < 4) return;
    const o = this.ents;
    this.g(o, 0, 'LWPOLYLINE'); this.g(o, 5, this.next()); this.g(o, 330, this.MS); this.g(o, 100, 'AcDbEntity'); this.g(o, 8, layer);
    this.g(o, 100, 'AcDbPolyline'); this.g(o, 90, String(pts.length / 2)); this.g(o, 70, closed ? '1' : '0'); this.g(o, 43, 0);
    for (let i = 0; i < pts.length; i += 2) { this.g(o, 10, pts[i]); this.g(o, 20, pts[i + 1]); }
  }
  text(layer: string, x: number, y: number, h: number, s: string) {
    const o = this.ents;
    this.g(o, 0, 'TEXT'); this.g(o, 5, this.next()); this.g(o, 330, this.MS); this.g(o, 100, 'AcDbEntity'); this.g(o, 8, layer);
    this.g(o, 100, 'AcDbText'); this.g(o, 10, x); this.g(o, 20, y); this.g(o, 30, 0); this.g(o, 40, h); this.g(o, 1, s.replace(/[\r\n]+/g, ' '));
    this.g(o, 72, '1'); this.g(o, 11, x); this.g(o, 21, y); this.g(o, 31, 0); this.g(o, 100, 'AcDbText'); this.g(o, 73, '2');
  }
  circle(layer: string, x: number, y: number, r: number) {
    const o = this.ents;
    this.g(o, 0, 'CIRCLE'); this.g(o, 5, this.next()); this.g(o, 330, this.MS); this.g(o, 100, 'AcDbEntity'); this.g(o, 8, layer);
    this.g(o, 100, 'AcDbCircle'); this.g(o, 10, x); this.g(o, 20, y); this.g(o, 30, 0); this.g(o, 40, r);
  }
  build(layers: Layer[], ext: [number, number, number, number]): string {
    const o = this.out, g = (c: number, v: string | number) => this.g(o, c, v);
    // fixed handles for the tables and the two layout blocks; entities and layers count up from 0x100
    const T = { vport: '8', ltype: '5', layer: '2', style: '3', view: '6', ucs: '7', appid: '9', dimstyle: 'A', brec: '1' };
    const PS = 'F2', MSB = 'F3', MSE = 'F4', PSB = 'F5', PSE = 'F6', ROOT = 'C', GROUPS = 'D';
    const table = (name: string, h: string, n: number, rows: () => void, dim = false) => {
      g(0, 'TABLE'); g(2, name); g(5, h); g(330, '0'); g(100, 'AcDbSymbolTable'); g(70, String(n));
      if (dim) g(100, 'AcDbDimStyleTable');
      rows(); g(0, 'ENDTAB');
    };
    const rec = (type: string, owner: string, sub: string, name: string, handleCode = 5) => {
      g(0, type); g(handleCode, this.next()); g(330, owner); g(100, 'AcDbSymbolTableRecord'); g(100, sub); g(2, name); g(70, '0');
    };
    g(0, 'SECTION'); g(2, 'HEADER');
    g(9, '$ACADVER'); g(1, 'AC1015');
    g(9, '$INSUNITS'); g(70, '6');
    g(9, '$MEASUREMENT'); g(70, '1');
    g(9, '$EXTMIN'); g(10, ext[0]); g(20, ext[1]); g(30, 0);
    g(9, '$EXTMAX'); g(10, ext[2]); g(20, ext[3]); g(30, 0);
    const seedAt = o.length; g(9, '$HANDSEED'); g(5, 'FFFF');
    g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'CLASSES'); g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'TABLES');
    table('VPORT', T.vport, 0, () => {});
    table('LTYPE', T.ltype, 3, () => {
      for (const [n, d] of [['ByBlock', ''], ['ByLayer', ''], ['Continuous', 'Solid line']]) { rec('LTYPE', T.ltype, 'AcDbLinetypeTableRecord', n); g(3, d); g(72, '65'); g(73, '0'); g(40, 0); }
    });
    table('LAYER', T.layer, layers.length + 1, () => {
      for (const L of [{ name: '0', color: 7 }, ...layers]) { rec('LAYER', T.layer, 'AcDbLayerTableRecord', L.name); g(62, String(L.color)); g(6, 'Continuous'); }
    });
    table('STYLE', T.style, 1, () => { rec('STYLE', T.style, 'AcDbTextStyleTableRecord', 'Standard'); g(40, 0); g(41, 1); g(50, 0); g(71, '0'); g(42, 2.5); g(3, 'txt'); g(4, ''); });
    table('VIEW', T.view, 0, () => {});
    table('UCS', T.ucs, 0, () => {});
    table('APPID', T.appid, 1, () => rec('APPID', T.appid, 'AcDbRegAppTableRecord', 'ACAD'));
    table('DIMSTYLE', T.dimstyle, 1, () => rec('DIMSTYLE', T.dimstyle, 'AcDbDimStyleTableRecord', 'Standard', 105), true);
    table('BLOCK_RECORD', T.brec, 2, () => {
      for (const [h, n] of [[this.MS, '*Model_Space'], [PS, '*Paper_Space']]) { g(0, 'BLOCK_RECORD'); g(5, h); g(330, T.brec); g(100, 'AcDbSymbolTableRecord'); g(100, 'AcDbBlockTableRecord'); g(2, n); }
    });
    g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'BLOCKS');
    for (const [rec_, b, e, n] of [[this.MS, MSB, MSE, '*Model_Space'], [PS, PSB, PSE, '*Paper_Space']]) {
      g(0, 'BLOCK'); g(5, b); g(330, rec_); g(100, 'AcDbEntity'); g(8, '0'); g(100, 'AcDbBlockBegin'); g(2, n); g(70, '0'); g(10, 0); g(20, 0); g(30, 0); g(3, n); g(1, '');
      g(0, 'ENDBLK'); g(5, e); g(330, rec_); g(100, 'AcDbEntity'); g(8, '0'); g(100, 'AcDbBlockEnd');
    }
    g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'ENTITIES'); o.push(...this.ents); g(0, 'ENDSEC');
    g(0, 'SECTION'); g(2, 'OBJECTS');
    g(0, 'DICTIONARY'); g(5, ROOT); g(330, '0'); g(100, 'AcDbDictionary'); g(281, '1'); g(3, 'ACAD_GROUP'); g(350, GROUPS);
    g(0, 'DICTIONARY'); g(5, GROUPS); g(330, ROOT); g(100, 'AcDbDictionary'); g(281, '1');
    g(0, 'ENDSEC');
    g(0, 'EOF');
    o[seedAt + 3] = this.next(); // $HANDSEED: past every handle used
    return o.join('\n') + '\n';
  }
}

export function predcrDxf(e: Evaluated): string {
  const { p, r, d, shops } = e;
  const w = new Dxf();
  const N = clean(p.name === 'Untitled project' ? 'Scheme' : p.name);
  const { ring, roads } = outline(p);
  const TXT = 0.3;

  // the plot's extent (site coordinates: x, −z)
  let px0 = Infinity, pz0 = Infinity, px1 = -Infinity, pz1 = -Infinity;
  for (let i = 0; i < ring.length; i += 2) { px0 = Math.min(px0, ring[i]); px1 = Math.max(px1, ring[i]); pz0 = Math.min(pz0, ring[i + 1]); pz1 = Math.max(pz1, ring[i + 1]); }
  const site = (q: number[]) => q.map((v, i) => (i % 2 ? -v : v));
  const named = (layer: string, q: number[], label: string, h = TXT, at?: [number, number]) => {
    w.poly(layer, q);
    const [x, y] = at ?? mid(q);
    w.text(layer, x, y, h, label);
  };

  // ── site plan ──
  named('_Plot', site(ring), `MAIN PLOT ${ringArea(ring).toFixed(2)} SQ.M`, 0.8);
  for (const l of roadLines(ring, roads)) {
    const [ax, az, bx, bz] = l.pts, L = Math.hypot(bx - ax, bz - az), ux = (bx - ax) / L, uz = (bz - az) / L;
    const nx = (-uz * l.road.today) / 2, nz = (ux * l.road.today) / 2;
    // (the lines run 300 m past each end: keep 20 m past the plot)
    const a = [ax + ux * 280, az + uz * 280], b = [bx - ux * 280, bz - uz * 280];
    named('_MainRoad', site([a[0] + nx, a[1] + nz, b[0] + nx, b[1] + nz, b[0] - nx, b[1] - nz, a[0] - nx, a[1] - nz]), `${l.road.today.toFixed(2)} m wd. Main Road`, 0.8);
  }
  r.lostRings.forEach((lr) => named('_RoadWidening', site(lr), 'ROAD WIDENING', 0.5));
  for (const lv of d.parking.levels) if (lv.kind === 'surface' || lv.kind === 'lot') for (const bay of lv.bays) named('_Parking', site(bay), ringArea(bay) >= 12.4 ? 'CP-L' : 'CP-S', 0.25);

  // each building: its outline, the common point (the middle of its first core), its name
  const blds = d.buildings.map((b, bi) => {
    const L = String.fromCharCode(65 + (bi % 26)) + (bi >= 26 ? String(Math.floor(bi / 26) + 1) : '1');
    const fp = footprint(b.quads);
    const ref = mid(b.cores[0] ?? b.quads[0]);
    const fh = b.height / Math.max(1, b.floors + d.under);
    return { b, bi, L, fp, ref, fh };
  });
  for (const x of blds) {
    x.fp.outer.forEach((q, k) => named('_PropWork', site(q), k === 0 ? `${x.L} (${N})` : `${x.L} (${N}) PART ${k + 1}`, 0.5, (() => { const [cx, cz] = mid(x.b.quads[0]); return [cx, -cz - 1.2] as [number, number]; })()));
    w.circle('_Floor', x.ref[0], -x.ref[1], 0.3); w.circle('_ResiFSI', x.ref[0], -x.ref[1], 0.4);
  }

  // ── per building: its floors side by side, then its section, all inside a _Building polygon ──
  const stilt = d.under > 0 && d.parking.levels.some((l) => l.kind === 'stilt') ? 1 : 0;
  const podium = d.parking.levels.filter((l) => l.kind === 'podium');
  const basements = d.parking.levels.filter((l) => l.kind === 'basement');
  let rowY = -(pz1 + 40), maxX = px1;
  for (const x of blds) {
    const { b, bi, fp, ref, fh } = x;
    let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
    for (const q of b.quads) for (let i = 0; i < q.length; i += 2) { bx0 = Math.min(bx0, q[i]); bx1 = Math.max(bx1, q[i]); bz0 = Math.min(bz0, q[i + 1]); bz1 = Math.max(bz1, q[i + 1]); }
    const bw = bx1 - bx0, bd = bz1 - bz0;
    const upper = shops?.upperOf[bi] ?? 0, removed = shops?.removed.get(bi) ?? new Set<number>();
    const strips = (shops?.strips ?? []).filter((s) => s.b === bi);
    const inB = (q: number[]) => { const [cx, cz] = mid(q); return b.quads.some((qq) => inRing(qq, cx, cz)); };

    // the floors, bottom up: ground (stilt or flats), podium levels, then the flats in runs of identical floors
    type Plan = { a: number; z: number; kind: 'stilt' | 'podium' | 'basement' | 'flats' | 'formed'; mixed?: boolean; level?: (typeof d.parking.levels)[number]; fi?: number };
    const plans: Plan[] = [];
    if (bi === 0) basements.forEach((lv, k) => plans.push({ a: -(k + 1), z: -(k + 1), kind: 'basement', level: lv }));
    if (stilt) plans.push({ a: 0, z: 0, kind: 'stilt', level: d.parking.levels.find((l) => l.kind === 'stilt') });
    podium.forEach((lv, k) => plans.push({ a: stilt + k, z: stilt + k, kind: 'podium', level: lv }));
    const f0 = stilt + podium.length, fN = f0 + b.floors - 1;
    // a formed building: one plan per distinct floor (the same use, units and outline share one, as TYPICAL a-b)
    const form = e.forms[b.b.id], LF = b.laid?.floors ?? [];
    const ringsOf = (i: number) => form?.floors[i]?.rings ?? [LF[i].ring ?? b.laid!.outline];
    const sig = (i: number) => `${floorKind(LF[i], b.use)}|${LF[i].units.length}|${ringsOf(i).map((q) => q.map((v) => Math.round(v * 10)).join()).join('/')}`;
    if (b.laid) for (let i = 1, s0 = 0; i <= LF.length; i++) if (i === LF.length || sig(i) !== sig(s0)) { plans.push({ a: f0 + s0, z: f0 + i - 1, kind: 'formed', fi: s0 }); s0 = i; }
    if (b.floors > 0 && !b.laid) {
      // floors 1..upper are partly shops; the ground on its own when it's flats (no stilt); then the rest
      const cuts = new Set<number>([f0]);
      if (f0 === 0) cuts.add(1);
      if (upper > 0) cuts.add(Math.max(f0, upper + 1));
      const starts = [...cuts].filter((s) => s <= fN).sort((m, n) => m - n);
      starts.forEach((s, k) => {
        const end = k + 1 < starts.length ? starts[k + 1] - 1 : fN;
        if (end >= s) plans.push({ a: s, z: end, kind: 'flats', mixed: s >= 1 && s <= upper });
      });
    }
    const nameOf = (pl: Plan) => (pl.kind === 'basement' ? (pl.a === -1 ? 'BASEMENT FLOOR PLAN' : `BASEMENT ${-pl.a} FLOOR PLAN`) : floorName(pl.a, pl.z));

    // slot sizes: a building's floors are its own size; a basement is the plot's
    const PAD = 2, LABEL = 2.5;
    let sx = px0 - 4;
    const rowTop = rowY;
    let rowBottom = rowY;
    const at0 = sx;
    for (const pl of plans) {
      const whole = pl.kind === 'basement';
      const [ox0, oz0, ow, od] = whole ? [px0, pz0, px1 - px0, pz1 - pz0] : [bx0, bz0, bw, bd];
      const X = (xx: number) => xx - ox0 + sx + PAD, Y = (zz: number) => rowY - PAD - (zz - oz0);
      const T = (q: number[]) => q.map((v, i) => (i % 2 ? Y(v) : X(v)));
      const left = sx, right = sx + ow + 2 * PAD, top = rowY, bottom = rowY - od - 2 * PAD - LABEL;
      w.poly('_Floor', [left, top, right, top, right, bottom, left, bottom]);
      w.text('_Floor', (left + right) / 2, bottom + LABEL / 2, 0.6, nameOf(pl));
      w.circle('_Floor', X(ref[0]), Y(ref[1]), 0.3); w.circle('_ResiFSI', X(ref[0]), Y(ref[1]), 0.4);

      const parking = (lv?: (typeof d.parking.levels)[number]) => { for (const bay of lv?.bays ?? []) if (whole || inB(bay)) named('_Parking', T(bay), ringArea(bay) >= 12.4 ? 'CP-L' : 'CP-S', 0.25); };
      const cores = () => b.cores.forEach((c) => { const [s, l] = splitCore(c); named('_Staircase', T(s), 'STAIRCASE', 0.25); if (l.length) named('_Liftwell', T(l), 'LIFT', 0.25); });
      if (pl.kind === 'formed') {
        const lf = LF[pl.fi!], k = floorKind(lf, b.use), fsi = k === 'residential' ? '_ResiFSI' : '_CommFSI';
        if (k === 'parking') parking(d.parking.levels.filter((l) => l.kind === 'structure' && Math.abs(l.area - lf.area) < 0.01)[0]);
        else ringsOf(pl.fi!).forEach((q) => w.poly(fsi, T(q)));
        lf.units.forEach((u) => named('_CarpetArea', T(u.ring), `${(u.t === 3 ? k.toUpperCase() : (UNIT_LABEL[u.t] ?? 'UNIT')).replace(/\s+/g, '')} ${u.carpet.toFixed(2)}`, 0.25));
        cores();
      } else if (pl.kind === 'basement') parking(pl.level);
      else if (pl.kind === 'stilt' || pl.kind === 'podium') {
        parking(pl.level);
        cores();
        if (pl.kind === 'stilt') strips.forEach((s, k) => { w.poly('_CommFSI', T(s.ring)); named('_CarpetArea', T(s.ring), `SHOP ${k + 1}`, 0.3); });
      } else {
        fp.outer.forEach((q) => w.poly('_ResiFSI', T(q)));
        fp.holes.forEach((q) => named('_Chowk', T(q), 'CHOWK', 0.3));
        const groundShops = pl.a === 0 ? strips : [];
        groundShops.forEach((s, k) => { w.poly('_CommFSI', T(s.ring)); named('_CarpetArea', T(s.ring), `SHOP ${k + 1}`, 0.3); });
        b.units.forEach((u, ui) => {
          const [cx, cz] = mid(u.ring);
          if (groundShops.some((s) => inRing(s.ring, cx, cz))) return;
          if (pl.mixed && removed.has(ui)) { w.poly('_CommFSI', T(u.ring)); named('_CarpetArea', T(u.ring), 'SHOP', 0.3); return; }
          named('_CarpetArea', T(u.ring), `${(UNIT_LABEL[u.t] ?? 'UNIT').replace(/\s+/g, '')} ${u.carpet.toFixed(2)}`, 0.25);
        });
        cores();
        b.corridors.forEach((c) => named('_Passage', T(c), 'PASSAGE', 0.25));
      }
      sx = right + 3;
      rowBottom = Math.min(rowBottom, bottom);
    }

    // the section: one band per floor, named as its plan, on the ground line
    const floorsUp = plans.filter((pl) => pl.kind !== 'basement');
    // (a formed building's floors at their own heights)
    const levels: { name: string; h: number }[] = [];
    for (const pl of floorsUp) for (let f = pl.a; f <= pl.z; f++) levels.push({ name: nameOf(pl), h: pl.kind === 'formed' ? LF[f - f0]?.h ?? fh : fh });
    const below = plans.filter((pl) => pl.kind === 'basement').reverse();
    const secW = Math.max(bw, 8), H = levels.reduce((t, l) => t + l.h, 0), Bh = below.length * fh;
    const left = sx, right = sx + secW + 8, groundY = rowY - 4 - H, top = rowY, bottom = groundY - Bh - 5;
    named('_Section', [left, top, right, top, right, bottom, left, bottom], 'Section', 0.6, [(left + right) / 2, bottom + 1.5]);
    let y0 = groundY;
    levels.forEach(({ name: nm, h }) => {
      named('_FloorInSection', [left + 4, y0, left + 4 + secW, y0, left + 4 + secW, y0 + h, left + 4, y0 + h], nm, Math.min(0.3, h / 4));
      y0 += h;
    });
    below.forEach((pl, k) => {
      const y1 = groundY - k * fh;
      named('_FloorInSection', [left + 4, y1 - fh, left + 4 + secW, y1 - fh, left + 4 + secW, y1, left + 4, y1], nameOf(pl), Math.min(0.3, fh / 4));
    });
    w.poly('_GroundLevel', [left + 1, groundY, right - 1, groundY], false);
    sx = right + 3;
    rowBottom = Math.min(rowBottom, bottom);

    // the building round all of it, named as its proposed work
    const gx0 = at0 - 3, gx1 = sx, gy0 = rowTop + 5, gy1 = rowBottom - 3;
    named('_Building', [gx0, gy0, gx1, gy0, gx1, gy1, gx0, gy1], `${x.L}(${N})`, 1, [gx0 + 12, gy0 - 2.5]);
    maxX = Math.max(maxX, gx1);
    rowY = gy1 - 15;
  }

  return w.build(DXF_LAYERS, [px0 - 30, rowY - 10, maxX + 30, -pz0 + 30]);
}
