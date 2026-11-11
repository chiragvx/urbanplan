// What If · 10 — a 20 m road of wide lanes and a thin painted median, and not one tree: the lanes are trimmed, the
// median widens into a planted strip, and trees go down the middle. Same four lanes, same width. Plays on Station Road,
// the two blocks west of the first cross street. (Replaces the underpass: on the set's single carriageway the cutting
// runs hidden under the road it passes.) Trees counted from the strip's length.
import type { Scene, Place, V2 } from '../../../src/film/types';
import type { Kit } from '../../../src/film/kit';
import type { Part } from '../../../src/net/model';

const S = (w: number): Part => ({ kind: 'sidewalk', width: w, dir: 0 });
const L = (w: number, dir: 1 | -1): Part => ({ kind: 'lane', width: w, dir });
const M = (w: number): Part => ({ kind: 'median', width: w, dir: 0 });
const T = (w: number): Part => ({ kind: 'planter', width: w, dir: 0 });
/** left → right looking west (the south kerb first); all 20 m */
const XS = {
  before: [S(2), L(3.75, 1), L(3.75, 1), M(1), L(3.75, -1), L(3.75, -1), S(2)],
  trimmed: [S(2), L(3.25, 1), L(3.25, 1), M(3), L(3.25, -1), L(3.25, -1), S(2)],
  after: [S(2), L(3.25, 1), L(3.25, 1), T(3), L(3.25, -1), L(3.25, -1), S(2)],
};
/** Station Road west, from the first cross street to the collector (two blocks) */
const blocks = (k: Kit) => k.stretch([-140, 0], [-360, 0]);
const set = (parts: Part[]) => (k: Kit) => k.setStretch(blocks(k), parts);

const scene: Scene = {
  id: 'wi-10',
  title: 'What If · 10',
  tile: 'film',
  duration: 30,
  hour: 13.6,

  before: (k) => set(XS.before)(k),

  steps: [
    { t: 11.4, label: 'Lanes {before.lane:2} m → {after.lane:2} m', place: 'lane', run: set(XS.trimmed) },
    { t: 13.4, label: 'Median {before.median} m → {after.median} m', place: 'median', run: set(XS.after) },
    { t: 15.6, dur: 2.6, label: 'Trees, every 9 m', place: 'median', trees: 'newTrees', run: () => {} },
  ],

  measure(k) {
    const Bs = blocks(k), b = Bs[0], X = k.strips(b), n = X.length;
    const lanes = X.filter((x) => x.kind === 'lane'), m = X.findIndex((x) => x.kind === 'median' || x.kind === 'planter');
    const places: Record<string, Place> = {
      road: { p: k.at(b, 0.55) },
      far: { p: k.at(Bs[1], 0.3) },
      lane: { p: k.mid(b, 1, 0.62) }, median: { p: k.mid(b, m, 0.5) },
      medianRing: { ring: k.outline(b, m, 0.05, 0.95) }, medianRing2: { ring: k.outline(Bs[1], m, 0.05, 0.95) },
      kerb: { line: [k.at(b, 0.45, X[0].o1), k.at(b, 0.45, X[n - 1].o0)] },
    };
    const pts: V2[] = X[m].kind === 'planter' ? Bs.flatMap((x) => k.down(x, m, 9, 8)) : [];
    places.newTrees = { pts };
    return {
      values: {
        lanes: lanes.length, lane: lanes[0].width, median: X[m].width, trees: pts.length,
        width: Math.round(X.reduce((a, x) => a + x.width, 0) * 10) / 10,
      },
      places,
    };
  },

  // along the road from the west at midday, then low back up it from the east
  keys: [
    { t: 0, at: 'far', dist: 290, yaw: 280, pitch: 56, fov: 38 },
    { t: 3, at: 'road', dist: 66, yaw: 276, pitch: 28, fov: 42, ease: 'out' },
    { t: 9, at: 'road', dist: 56, yaw: 266, pitch: 22, fov: 44, ease: 'linear' },
    { t: 11, at: 'road', dist: 72, yaw: 86, pitch: 32, fov: 42 },
    { t: 22, at: 'road', dist: 62, yaw: 98, pitch: 25, fov: 44, ease: 'linear' },
    { t: 22.6, at: 'road', dist: 84, yaw: 92, pitch: 40, fov: 40 },
    { t: 27, at: 'road', dist: 80, yaw: 94, pitch: 38, fov: 40, ease: 'linear' },
    { t: 30, at: 'road', dist: 78, yaw: 95, pitch: 37, fov: 40 },
  ],

  captions: [
    { t0: 0.15, t1: 3.1, text: '{before.width} m of tarmac. Not one tree.', size: 'hook' },
    { t0: 3.3, t1: 6.1, text: '{before.lane:2} m lanes, {before.lanes} of them.' },
    { t0: 6.2, t1: 9.0, text: 'A {before.median} m strip of paint in the middle.' },
    { t0: 11.2, t1: 21.6, text: 'Same {after.width} m road, same {after.lanes} lanes. Shade down the middle.', at: 'bottom', size: 'small' },
  ],

  marks: [
    { kind: 'dim', t0: 0.6, t1: 9.0, place: 'kerb', text: '{before.width} m' },
    { kind: 'circle', t0: 6.4, t1: 9.0, place: 'medianRing' },
    { kind: 'circle', t0: 6.6, t1: 9.0, place: 'medianRing2' },
  ],

  wipe: { t0: 9.1, t1: 11.0, text: 'What if…' },

  split: {
    t0: 22, t1: 27, left: 'Today', right: 'What if',
    stats: [
      { label: 'Trees, 2 blocks', before: '{before.trees}', after: '{after.trees}' },
      { label: 'Middle strip', before: '{before.median} m', after: '{after.median} m' },
      { label: 'Car lane width', before: '{before.lane:2} m', after: '{after.lane:2} m' },
    ],
  },

  end: { t0: 27, headline: 'Worth a narrower lane?' },

  vo: [
    { t: 0.2, max: 2.9, text: '{before.width} metres of tarmac. Not one tree.' },
    { t: 3.3, max: 2.8, text: '{before.lane:2} metre lanes.' },
    { t: 6.2, max: 2.8, text: 'And a thin strip of paint.' },
    { t: 9.3, max: 1.6, text: 'What if…' },
    { t: 11.4, max: 1.9, text: 'Trim the lanes.' },
    { t: 13.4, max: 2.1, text: 'Widen the middle.' },
    { t: 15.6, max: 3.2, text: 'And plant it.' },
    { t: 22.4, max: 4.4, text: '{after.trees} trees. Same {after.lanes} lanes. Same road.' },
    { t: 27.3, max: 2.4, text: 'Worth a narrower lane?' },
  ],
};

export default scene;
