// What If · 05 — the flip side of 04: the same stretch of Station Road as a four-lane road with wide footpaths, given
// "one more lane" each way the usual way: the footpaths shaved, the median squeezed, six narrower lanes. The road
// doesn't get any wider; the split shows where the room came from.
import type { Scene, Place } from '../../../src/film/types';
import type { Kit } from '../../../src/film/kit';
import type { Part } from '../../../src/net/model';

const S = (w: number): Part => ({ kind: 'sidewalk', width: w, dir: 0 });
const L = (w: number, dir: 1 | -1): Part => ({ kind: 'lane', width: w, dir });
const M = (w: number): Part => ({ kind: 'median', width: w, dir: 0 });
const H = (w: number): Part => ({ kind: 'shoulder', width: w, dir: 0 });
/** left → right looking east (the north kerb first); all 21.5 m */
const XS = {
  before: [S(3), L(3.5, 1), L(3.5, 1), M(1.5), L(3.5, -1), L(3.5, -1), S(3)],
  shaved: [S(1.25), H(1.75), L(3.5, 1), L(3.5, 1), M(1.5), L(3.5, -1), L(3.5, -1), H(1.75), S(1.25)],
  squeezed: [S(1.25), H(2.3), L(3.5, 1), L(3.5, 1), M(0.4), L(3.5, -1), L(3.5, -1), H(2.3), S(1.25)],
  after: [S(1.25), L(3.1, 1), L(3.1, 1), L(3.1, 1), M(0.4), L(3.1, -1), L(3.1, -1), L(3.1, -1), S(1.25)],
};
/** the same two blocks as 04 */
const blocks = (k: Kit) => k.stretch([140, 0], [360, 0]);
const set = (parts: Part[]) => (k: Kit) => k.setStretch(blocks(k), parts);

const scene: Scene = {
  id: 'wi-05',
  title: 'What If · 05',
  tile: 'film',
  duration: 30,
  hour: 17.2,

  before: (k) => set(XS.before)(k),

  steps: [
    { t: 11.4, label: 'Footpaths {before.foot} m → {after.foot:2} m', place: 'footN', run: set(XS.shaved) },
    { t: 13.4, label: 'Median {before.median} m → {after.median} m', place: 'median', run: set(XS.squeezed) },
    { t: 15.6, label: '{after.lanes} lanes of {after.lane} m', place: 'road', run: set(XS.after) },
  ],

  measure(k) {
    const Bs = blocks(k), b = Bs[0], X = k.strips(b), n = X.length, m = X.findIndex((x) => x.kind === 'median');
    const lanes = X.filter((x) => x.kind === 'lane');
    const places: Record<string, Place> = {
      road: { p: k.at(b, 0.55) },
      far: { p: k.at(Bs[1], 0.2) },
      footN: { p: k.mid(b, 0, 0.62) }, median: { p: k.mid(b, m, 0.48) },
      dimN: { line: k.across(b, 0, 0.62) }, dimS: { line: k.across(b, n - 1, 0.5) },
      walkN: { ring: k.outline(b, 0, 0.05, 0.95) }, walkS: { ring: k.outline(b, n - 1, 0.05, 0.95) },
    };
    return {
      values: {
        lanes: lanes.length, lane: lanes[0].width, foot: X[0].width, median: m < 0 ? 0 : X[m].width,
        width: Math.round(X.reduce((a, x) => a + x.width, 0) * 10) / 10,
      },
      places,
    };
  },

  // 04's road from the other side, in the evening: from the west along it, then across from the south-east
  keys: [
    { t: 0, at: 'far', dist: 300, yaw: 250, pitch: 56, fov: 38 },
    { t: 3, at: 'road', dist: 72, yaw: 252, pitch: 28, fov: 42, ease: 'out' },
    { t: 9, at: 'road', dist: 60, yaw: 244, pitch: 23, fov: 44, ease: 'linear' },
    { t: 11, at: 'road', dist: 78, yaw: 104, pitch: 34, fov: 42 },
    { t: 22, at: 'road', dist: 68, yaw: 90, pitch: 27, fov: 44, ease: 'linear' },
    { t: 22.6, at: 'road', dist: 92, yaw: 92, pitch: 40, fov: 40 },
    { t: 27, at: 'road', dist: 88, yaw: 90, pitch: 38, fov: 40, ease: 'linear' },
    { t: 30, at: 'road', dist: 86, yaw: 89, pitch: 37, fov: 40 },
  ],

  captions: [
    { t0: 0.15, t1: 3.1, text: '{before.lanes} lanes. Always busy.', size: 'hook' },
    { t0: 3.3, t1: 6.1, text: '{before.foot} m footpaths each side.' },
    { t0: 6.2, t1: 9.0, text: 'The obvious fix? More lanes.' },
    { t0: 11.2, t1: 21.6, text: 'Same {after.width} m road. The room comes from the edges.', at: 'bottom', size: 'small' },
  ],

  marks: [
    { kind: 'circle', t0: 3.4, t1: 9.0, place: 'walkN', color: '#30a46c' },
    { kind: 'circle', t0: 3.6, t1: 9.0, place: 'walkS', color: '#30a46c' },
    { kind: 'dim', t0: 3.6, t1: 9.0, place: 'dimN', text: '{before.foot} m' },
    { kind: 'dim', t0: 4.0, t1: 9.0, place: 'dimS', text: '{before.foot} m' },
  ],

  wipe: { t0: 9.1, t1: 11.0, text: 'What if…' },

  split: {
    t0: 22, t1: 27, left: 'Today', right: 'What if',
    stats: [
      { label: 'Car lanes', before: '{before.lanes}', after: '{after.lanes}' },
      { label: 'Footpath, each side', before: '{before.foot} m', after: '{after.foot:2} m' },
      { label: 'Road width', before: '{before.width} m', after: '{after.width} m' },
    ],
  },

  end: { t0: 27, headline: 'Will it stay unjammed?' },

  vo: [
    { t: 0.2, max: 2.9, text: '{before.lanes} lanes. Always busy.' },
    { t: 3.3, max: 2.8, text: '{before.foot} metre footpaths each side.' },
    { t: 6.2, max: 2.8, text: 'The obvious fix? More lanes.' },
    { t: 9.3, max: 1.6, text: 'What if…' },
    { t: 11.4, max: 1.9, text: 'Shave the footpaths.' },
    { t: 13.4, max: 2.1, text: 'Squeeze the median.' },
    { t: 15.6, max: 3.2, text: '{after.lanes} lanes now. Same road.' },
    { t: 22.4, max: 4.4, text: '{after.lanes} lanes, not {before.lanes}. Footpaths down to {after.foot:2} metres.' },
    { t: 27.3, max: 2.4, text: 'Will it stay unjammed?' },
  ],
};

export default scene;
