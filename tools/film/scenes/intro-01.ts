// Intro · 01 — the landing page's hero: a 24 s landscape montage that loops. Three shots on the film set, each a
// thing the editor does: (1) inspect the old signal at the centre junction and swap it for a roundabout, (2) lay
// the DP's 30 m corridor over Station Road and widen the road to it, (3) draw a plot on the vacant land beside the
// widened road (its front 1.5 m clear of the new kerb, so it never sits on the road) and build it up to the rules.
import type { Scene, Place, V2 } from '../../../src/film/types';
import type { Kit } from '../../../src/film/kit';
import { COBALT, ORANGE, RED } from '../../../src/film/brand';

/** Station Road today, and in the DP */
const TODAY = 18, DP = 30;
/** the stretch of Station Road the DP widens: the junctions at x 470 and x 580, east arms */
const STRETCH = [470, 580];
/** the plot: on the set's vacant land (x 488–562, z 8–86), its front 1.5 m behind the DP road's edge (z 15) */
const PX0 = 490, PX1 = 560, PZ0 = DP / 2 + 1.5, PZ1 = 78.5;
const RING = [PX0, PZ0, PX1, PZ0, PX1, PZ1, PX0, PZ1];
/** the ring's centre-line radius (m), grown in from a small one */
const R0 = 9, R1 = 22;

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
  duration: 24,
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
    // 3 · the plot, built up
    { t: 18.0, label: 'Stilt parking', place: 'building', run: (k) => k.plotFloors(0) },
    { t: 18.9, count: 'floors', dur: 3.0, label: 'Floors', run: (k, u) => k.plotFloors(Math.round(u * k.plotValues().floors)) },
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
    // cut · 3 · the plot, then round and low as it rises
    { t: 14.02, at: 'plot', dist: 300, yaw: 205, pitch: 60, fov: 34 },
    { t: 18.6, at: 'plot', dist: 280, yaw: 222, pitch: 50, fov: 34, y: 4, ease: 'linear' },
    { t: 22, at: 'building', dist: 300, yaw: 240, pitch: 30, fov: 34, y: 22, ease: 'inOut' },
    { t: 24, at: 'building', dist: 310, yaw: 250, pitch: 28, fov: 34, y: 26, ease: 'linear' },
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
    { kind: 'circle', t0: 14.5, t1: 19.5, place: 'plot', color: COBALT },
    { kind: 'tag', t0: 14.9, t1: 17.9, place: 'plot', text: '{after.area:0} m²', color: COBALT },
  ],

  shots: [
    { t0: 0.6, t1: 6.3, title: 'Inspect the old signal', sub: 'Swap it for a roundabout' },
    { t0: 7.0, t1: 13.7, title: 'Lay the DP over the road', sub: 'Widen it from {before.w} m to {after.dp} m' },
    { t0: 14.4, t1: 23.2, title: 'Draw a plot, build to the rules', sub: '{after.area:0} m² · FSI {after.fsi} · {after.floors} floors' },
  ],

  end: { t0: 24, headline: '' },
};

export default scene;
