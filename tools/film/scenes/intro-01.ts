// Intro · 01 — the landing page's hero: a 30 s landscape montage that loops. Three shots on the film set, each a
// thing the editor does: (1) inspect the old signal at the centre junction and swap it for a roundabout, (2) lay
// the DP's 30 m corridor over Station Road and widen the road to it, (3) draw a plot corner by corner on the vacant
// land beside the widened road (its front 1.5 m clear of the new kerb, so it never sits on the road), then lay it
// out as Site Studio does: a tower clicked down and built up, a garden and a car park dragged out.
import type { Scene, Place, V2 } from '../../../src/film/types';
import type { Kit } from '../../../src/film/kit';
import type { SiteBuilding, SiteElement } from '../../../src/doc/site';
import { COBALT, GREEN, ORANGE, RED } from '../../../src/film/brand';

/** Station Road today, and in the DP */
const TODAY = 18, DP = 30;
/** the stretch of Station Road the DP widens: the junctions at x 470 and x 580, east arms */
const STRETCH = [470, 580];
/** the plot: on the set's vacant land (x 488–562, z 8–86), its front 1.5 m behind the DP road's edge (z 15) */
const PX0 = 490, PX1 = 560, PZ0 = DP / 2 + 1.5, PZ1 = 78.5;
const RING = [PX0, PZ0, PX1, PZ0, PX1, PZ1, PX0, PZ1];
/** the ring's centre-line radius (m), grown in from a small one */
const R0 = 9, R1 = 22;

/** what goes on the plot, inside its margins: a tower at the back left, a garden down the right, parking in front */
const TOWER: SiteBuilding = { id: 't1', spine: [503, 56, 527, 56], depth: 20, floors: 0 };
const rect = (x0: number, z0: number, x1: number, z1: number) => [x0, z0, x1, z0, x1, z1, x0, z1];
const GARDEN: SiteElement = { id: 'g1', kind: 'garden', spine: [], depth: 0, floors: 0, ring: rect(534, 24, 555, 73) };
const LOT: SiteElement = { id: 'l1', kind: 'lot', spine: [], depth: 0, floors: 0, ring: rect(494, 23, 530, 40) };
const pts = (f: number[]): V2[] => Array.from({ length: f.length / 2 }, (_, i) => [f[i * 2], f[i * 2 + 1]] as V2);

const centre = (k: Kit) => k.junctionNear(0, 0).id;
const widen = (k: Kit, w: number) => { for (const x of STRETCH) { const a = k.arm(k.junctionNear(x, 0).id, 'E'); k.doc.set(a.s.id, 'parts', k.orient(a, k.crossSection(w))); } };
const roadW = (k: Kit) => { const a = k.arm(k.junctionNear(STRETCH[0], 0).id, 'E'); return Math.round(a.s.parts.reduce((s, p) => s + p.width, 0) * 10) / 10; };

/** the DP corridor: its north edge out east, its south edge back west */
const corridor = (): V2[] => {
  const n = 24, x0 = STRETCH[0] + 14, x1 = STRETCH[1] - 14, xs = Array.from({ length: n }, (_, i) => x0 + ((x1 - x0) * i) / (n - 1));
  return [...xs.map((x) => [x, -DP / 2] as V2), ...xs.reverse().map((x) => [x, DP / 2] as V2)];
};

const scene: Scene = {
  id: 'intro-01',
  title: 'UrbanPlan',
  tile: 'film',
  duration: 30,
  hour: 16,
  size: [1920, 1080],
  loop: true,
  cuts: [6.6, 14],

  before(k) {
    k.doc.update(centre(k), { signals: true, crossings: true, rc: 6, slips: undefined, R: undefined, ringLanes: undefined });
    widen(k, TODAY);
    k.plot(RING, { name: 'Plot', use: 'residential', code: 'udcpr', design: { type: 'tower' } });
  },

  steps: [
    // 1 · the junction
    { t: 2.0, label: 'Signal removed', place: 'cornerNE', run: (k) => k.doc.set(centre(k), 'signals', false) },
    { t: 3.7, n: 8, dur: 1.6, label: 'Roundabout · {after.diameter} m', place: 'island', run: (k, u) => k.doc.update(centre(k), { R: Math.round(R0 + (R1 - R0) * u), ringLanes: 2 }) },
    // 2 · the road, out to the DP line
    { t: 10.6, n: 8, dur: 1.8, label: 'Widened to the DP', run: (k, u) => widen(k, Math.round((TODAY + (DP - TODAY) * u) * 2) / 2) },
    // 3 · the plot laid out: a tower clicked down and built up, then a garden and a car park dragged out
    { t: 19.4, n: 10, dur: 1.8, label: 'Tower · {after.floors} floors', place: 'towerAt', run: (k, u) => k.plotSite([TOWER], [], u) },
    { t: 22.8, label: 'Garden: lawn, paths, trees', place: 'gardenAt', run: (k) => k.plotSite([TOWER], [GARDEN]) },
    { t: 25.6, label: '{after.bays} bays laid out', place: 'lotAt', run: (k) => k.plotSite([TOWER], [GARDEN, LOT]) },
  ],

  measure(k) {
    const j = centre(k), J = k.doc.get<'junction'>(j)!, c: V2 = [J.x, J.z];
    const ring = k.C.junctionRing(j) ?? [];
    const outer = ring.length ? Math.min(...ring.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1]))) : 0;
    const w = roadW(k), pv = k.plotValues();
    const places: Record<string, Place> = {
      ...k.plotPlaces(),
      centre: { p: c }, island: { p: c }, cornerNE: { p: [J.x + 14, J.z - 16] },
      junctionRing: { ring: k.circle(c, 34, 72) },
      stretch: { p: [525, 0] }, roadMid: { p: [540, 0] },
      kerb: { line: [[506, -w / 2], [506, w / 2]] },
      dpLine: { line: [[548, -DP / 2], [548, DP / 2]] },
      corridor: { ring: corridor() },
      tower: { ring: [[503, 46], [527, 46], [527, 66], [503, 66]] }, towerAt: { p: [515, 56] },
      gardenRing: { ring: pts(GARDEN.ring!) }, gardenAt: { p: [544.5, 48] },
      lotRing: { ring: pts(LOT.ring!) }, lotAt: { p: [512, 31.5] },
    };
    return {
      values: { ...pv, arms: k.arms(j).length, signals: J.signals ? 1 : 0, diameter: J.R ? Math.round(outer * 2) : 0, w, dp: DP },
      places,
    };
  },

  keys: [
    // 1 · high over the junction, settling in as the ring grows
    { t: 0, at: 'centre', dist: 230, yaw: 35, pitch: 58, fov: 34 },
    { t: 2.3, at: 'centre', dist: 190, yaw: 50, pitch: 56, fov: 34, ease: 'out' },
    { t: 6.6, at: 'centre', dist: 170, yaw: 85, pitch: 50, fov: 34, ease: 'linear' },
    // cut · 2 · across Station Road from the north, the vacant land behind it
    { t: 6.62, at: 'stretch', dist: 260, yaw: 200, pitch: 52, fov: 34 },
    { t: 14, at: 'stretch', dist: 215, yaw: 222, pitch: 46, fov: 34, ease: 'linear' },
    // cut · 3 · the plot from above while it's drawn and laid out, then round and low over the finished site
    { t: 14.02, at: [528, 34], dist: 300, yaw: 205, pitch: 60, fov: 34 },
    { t: 18.6, at: [527, 44], dist: 250, yaw: 214, pitch: 60, fov: 34, ease: 'linear' },
    { t: 21.2, at: [527, 46], dist: 270, yaw: 220, pitch: 52, fov: 34, y: 10 },
    { t: 26.4, at: [527, 46], dist: 250, yaw: 228, pitch: 56, fov: 34, y: 6, ease: 'linear' },
    { t: 30, at: 'building', dist: 300, yaw: 250, pitch: 30, fov: 34, y: 22, ease: 'inOut' },
  ],

  captions: [],

  marks: [
    // 1
    { kind: 'circle', t0: 0.5, t1: 2.1, place: 'junctionRing', color: ORANGE },
    { kind: 'tag', t0: 0.7, t1: 2.0, place: 'cornerNE', text: 'Signal · {before.arms} arms', color: ORANGE },
    // 2
    { kind: 'dim', t0: 7.3, t1: 13.8, place: 'kerb', text: '{now.w} m', color: COBALT },
    { kind: 'band', t0: 8.4, t1: 13.8, place: 'corridor', color: RED },
    { kind: 'dim', t0: 9.0, t1: 13.8, place: 'dpLine', text: 'DP {after.dp} m', color: RED },
    // 3
    // the plot tool: four corners clicked, the shape closed, the plot filled in
    { kind: 'draw', t0: 14.3, t1: 19.7, place: 'plot', dur: 3.2, color: COBALT },
    { kind: 'tag', t0: 17.4, t1: 18.5, place: 'plot', text: '{after.area:0} m²', color: COBALT },
    // Site Studio: a tower clicked down, a garden and parking dragged out
    { kind: 'place', t0: 18.6, t1: 20.6, place: 'tower', tool: 'Tower', color: ORANGE },
    { kind: 'place', t0: 21.3, t1: 23.6, place: 'gardenRing', tool: 'Garden', drag: true, color: GREEN },
    { kind: 'place', t0: 24.1, t1: 26.4, place: 'lotRing', tool: 'Parking', drag: true, color: COBALT },
  ],

  shots: [
    { t0: 0.6, t1: 6.3, title: 'Inspect the old signal', sub: 'Swap it for a roundabout' },
    { t0: 7.0, t1: 13.7, title: 'Lay the DP over the road', sub: 'Widen it from {before.w} m to {after.dp} m' },
    { t0: 14.4, t1: 29.2, title: 'Draw a plot, lay it out', sub: 'Place a tower, a garden, parking · FSI {after.fsi}' },
  ],

  end: { t0: 30, headline: '' },
};

export default scene;
