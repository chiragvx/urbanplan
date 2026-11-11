// What If · 06 — a 20 m road with four wide lanes and a wide median, and nothing for cycles: the lanes are trimmed,
// the median's width moves to the edges, and a cycle track runs down each kerb. Still four car lanes; the median is
// the price, and the split says so. Plays on Market Road, the two blocks north of the first cross street.
import type { Scene, Place } from '../../../src/film/types';
import type { Kit } from '../../../src/film/kit';
import type { Part } from '../../../src/net/model';

const S = (w: number): Part => ({ kind: 'sidewalk', width: w, dir: 0 });
const L = (w: number, dir: 1 | -1): Part => ({ kind: 'lane', width: w, dir });
const M = (w: number): Part => ({ kind: 'median', width: w, dir: 0 });
const H = (w: number): Part => ({ kind: 'shoulder', width: w, dir: 0 });
const C = (w: number): Part => ({ kind: 'cycle', width: w, dir: 0 });
/** left → right looking north (the west kerb first); all 20 m */
const XS = {
  before: [S(2), L(3.5, 1), L(3.5, 1), M(2), L(3.5, -1), L(3.5, -1), S(2)],
  trimmed: [S(2), H(1), L(3, 1), L(3, 1), M(2), L(3, -1), L(3, -1), H(1), S(2)],
  moved: [S(2), H(2), L(3, 1), L(3, 1), L(3, -1), L(3, -1), H(2), S(2)],
  after: [S(2), C(2), L(3, 1), L(3, 1), L(3, -1), L(3, -1), C(2), S(2)],
};
/** Market Road north, from the first cross street to the collector (two blocks) */
const blocks = (k: Kit) => k.stretch([0, -140], [0, -360]);
const set = (parts: Part[]) => (k: Kit) => k.setStretch(blocks(k), parts);

const scene: Scene = {
  id: 'wi-06',
  title: 'What If · 06',
  tile: 'film',
  duration: 30,
  hour: 8.8,

  before: (k) => set(XS.before)(k),

  steps: [
    { t: 11.4, label: 'Lanes {before.lane} m → {after.lane} m', place: 'lane', run: set(XS.trimmed) },
    { t: 13.4, label: 'Median to the edges', place: 'median', run: set(XS.moved) },
    { t: 15.6, label: 'Cycle track, each side', place: 'cycleW', run: set(XS.after) },
  ],

  measure(k) {
    const Bs = blocks(k), b = Bs[0], X = k.strips(b), n = X.length;
    const lanes = X.filter((x) => x.kind === 'lane'), cyc = k.widths(b, 'cycle'), med = k.widths(b, 'median');
    const places: Record<string, Place> = {
      road: { p: k.at(b, 0.5) },
      far: { p: k.at(Bs[1], 0.3) },
      lane: { p: k.mid(b, 2, 0.6) }, median: { p: k.at(b, 0.45) },
      cycleW: { p: k.mid(b, 1, 0.62) }, kerbE: { p: k.mid(b, n - 2, 0.4) },
      kerb: { line: [k.at(b, 0.55, X[0].o1), k.at(b, 0.55, X[n - 1].o0)] },
    };
    const m = X.findIndex((x) => x.kind === 'median');
    if (m >= 0) places.medianRing = { ring: k.outline(b, m, 0.05, 0.95) };
    return {
      values: {
        lanes: lanes.length, lane: lanes[0].width, cycle: cyc[0] ?? 0, cycles: cyc.length, median: med[0] ?? 0,
        kerb: Math.round((X[0].o1 - X[n - 1].o0) * 10) / 10, width: Math.round(X.reduce((a, x) => a + x.width, 0) * 10) / 10,
      },
      places,
    };
  },

  // up the road from the south at first light, then back down it from the north
  keys: [
    { t: 0, at: 'far', dist: 280, yaw: -14, pitch: 55, fov: 38 },
    { t: 3, at: 'road', dist: 64, yaw: -6, pitch: 29, fov: 42, ease: 'out' },
    { t: 9, at: 'road', dist: 54, yaw: 6, pitch: 23, fov: 44, ease: 'linear' },
    { t: 11, at: 'road', dist: 70, yaw: 166, pitch: 33, fov: 42 },
    { t: 22, at: 'road', dist: 60, yaw: 186, pitch: 26, fov: 44, ease: 'linear' },
    { t: 22.6, at: 'road', dist: 82, yaw: 180, pitch: 40, fov: 40 },
    { t: 27, at: 'road', dist: 78, yaw: 178, pitch: 38, fov: 40, ease: 'linear' },
    { t: 30, at: 'road', dist: 76, yaw: 177, pitch: 37, fov: 40 },
  ],

  captions: [
    { t0: 0.15, t1: 3.1, text: '{before.width} m of road. Nothing for cycles.', size: 'hook' },
    { t0: 3.3, t1: 6.1, text: '{before.lane} m lanes, and a {before.median} m median.' },
    { t0: 6.2, t1: 9.0, text: 'Cyclists squeeze in with the trucks.' },
    { t0: 11.2, t1: 21.6, text: 'Same {after.width} m road. Narrower lanes, no median, a track each side.', at: 'bottom', size: 'small' },
  ],

  marks: [
    { kind: 'dim', t0: 0.6, t1: 9.0, place: 'kerb', text: '{before.kerb} m' },
    { kind: 'circle', t0: 3.4, t1: 9.0, place: 'medianRing' },
    { kind: 'tag', t0: 6.4, t1: 9.0, place: 'cycleW', text: 'No room to ride' },
  ],

  wipe: { t0: 9.1, t1: 11.0, text: 'What if…' },

  split: {
    t0: 22, t1: 27, left: 'Today', right: 'What if',
    stats: [
      { label: 'Cycle track, each side', before: '{before.cycle} m', after: '{after.cycle} m' },
      { label: 'Car lane width', before: '{before.lane} m', after: '{after.lane} m' },
      { label: 'Median', before: '{before.median} m', after: '{after.median} m' },
    ],
  },

  end: { t0: 27, headline: 'Would you ride here?' },

  vo: [
    { t: 0.2, max: 2.9, text: '{before.width} metres of road. Nothing for cycles.' },
    { t: 3.3, max: 2.8, text: '{before.lane} metre lanes, and a wide median.' },
    { t: 6.2, max: 2.8, text: 'Cyclists squeeze in with the trucks.' },
    { t: 9.3, max: 1.6, text: 'What if…' },
    { t: 11.4, max: 1.9, text: 'Lanes trimmed to {after.lane} metres.' },
    { t: 13.4, max: 2.1, text: 'The median moves to the edges.' },
    { t: 15.6, max: 3.2, text: 'A {after.cycle} metre cycle track, each side.' },
    { t: 22.4, max: 4.4, text: 'Still {after.lanes} car lanes. Plus {after.cycles} cycle tracks. Same road.' },
    { t: 27.3, max: 2.4, text: 'Would you ride here?' },
  ],
};

export default scene;
