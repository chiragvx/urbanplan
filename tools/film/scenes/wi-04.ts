// What If · 04 — a six-lane arterial where the bus shares every lane: the kerb lane each way goes to buses only.
// Same road, same width; the split counts the lanes. Plays on Station Road, the two blocks east of the first cross
// street (pairs with 05, which takes the same road the other way).
import type { Scene, Place } from '../../../src/film/types';
import type { Kit } from '../../../src/film/kit';
import type { Part } from '../../../src/net/model';

const S = (w: number): Part => ({ kind: 'sidewalk', width: w, dir: 0 });
const L = (w: number, dir: 1 | -1): Part => ({ kind: 'lane', width: w, dir });
const B = (w: number, dir: 1 | -1): Part => ({ kind: 'bus', width: w, dir });
const M = (w: number): Part => ({ kind: 'median', width: w, dir: 0 });
/** left → right looking east (the north kerb first); all 26 m */
const XS = {
  before: [S(2), L(3.5, 1), L(3.5, 1), L(3.5, 1), M(1), L(3.5, -1), L(3.5, -1), L(3.5, -1), S(2)],
  one: [S(2), B(3.5, 1), L(3.5, 1), L(3.5, 1), M(1), L(3.5, -1), L(3.5, -1), L(3.5, -1), S(2)],
  after: [S(2), B(3.5, 1), L(3.5, 1), L(3.5, 1), M(1), L(3.5, -1), L(3.5, -1), B(3.5, -1), S(2)],
};
/** Station Road east, from the first cross street to the collector (two blocks) */
const blocks = (k: Kit) => k.stretch([140, 0], [360, 0]);
const set = (parts: Part[]) => (k: Kit) => k.setStretch(blocks(k), parts);

const scene: Scene = {
  id: 'wi-04',
  title: 'What If · 04',
  tile: 'film',
  duration: 30,
  hour: 8.6,

  before: (k) => set(XS.before)(k),

  steps: [
    { t: 11.4, label: 'Bus only, eastbound', place: 'busN', run: set(XS.one) },
    { t: 13.4, label: 'Bus only, westbound', place: 'busS', run: set(XS.after) },
  ],

  measure(k) {
    const Bs = blocks(k), b = Bs[0], X = k.strips(b), n = X.length;
    const places: Record<string, Place> = {
      road: { p: k.at(b, 0.55) },
      far: { p: k.at(Bs[1], 0.2) },
      // the kerb lanes: north (eastbound) and south (westbound)
      busN: { p: k.mid(b, 1, 0.62) }, busS: { p: k.mid(b, n - 2, 0.42) },
      laneN: { ring: k.outline(b, 1, 0.05, 0.95) }, laneN2: { ring: k.outline(Bs[1], 1, 0.05, 0.95) },
      laneS: { ring: k.outline(b, n - 2, 0.05, 0.95) }, laneS2: { ring: k.outline(Bs[1], n - 2, 0.05, 0.95) },
      kerb: { line: [k.at(b, 0.5, X[0].o1), k.at(b, 0.5, X[n - 1].o0)] },
    };
    return {
      values: {
        lanes: X.filter((x) => x.kind === 'lane').length, bus: X.filter((x) => x.kind === 'bus').length,
        kerb: Math.round((X[0].o1 - X[n - 1].o0) * 10) / 10,
        width: Math.round(X.reduce((a, x) => a + x.width, 0) * 10) / 10,
      },
      places,
    };
  },

  // along the road from the east, then a lower pass from the west
  keys: [
    { t: 0, at: 'far', dist: 280, yaw: 100, pitch: 54, fov: 38 },
    { t: 3, at: 'road', dist: 78, yaw: 96, pitch: 30, fov: 42, ease: 'out' },
    { t: 9, at: 'road', dist: 66, yaw: 104, pitch: 24, fov: 44, ease: 'linear' },
    { t: 11, at: 'road', dist: 80, yaw: 262, pitch: 32, fov: 42 },
    { t: 22, at: 'road', dist: 70, yaw: 276, pitch: 26, fov: 44, ease: 'linear' },
    { t: 22.6, at: 'road', dist: 92, yaw: 270, pitch: 40, fov: 40 },
    { t: 27, at: 'road', dist: 88, yaw: 272, pitch: 38, fov: 40, ease: 'linear' },
    { t: 30, at: 'road', dist: 86, yaw: 273, pitch: 37, fov: 40 },
  ],

  captions: [
    { t0: 0.15, t1: 3.1, text: '{before.lanes} lanes. The bus shares every one.', size: 'hook' },
    { t0: 3.3, t1: 6.1, text: 'Every lane, mixed traffic.' },
    { t0: 6.2, t1: 9.0, text: 'Stop, start, merge, repeat.' },
    { t0: 11.2, t1: 21.6, text: 'Same {after.width} m road. The kerb lane each way, for buses only.', at: 'bottom', size: 'small' },
  ],

  marks: [
    { kind: 'dim', t0: 0.6, t1: 9.0, place: 'kerb', text: '{before.kerb} m' },
    { kind: 'circle', t0: 3.4, t1: 9.0, place: 'laneN' },
    { kind: 'circle', t0: 3.6, t1: 9.0, place: 'laneN2' },
    { kind: 'circle', t0: 3.8, t1: 9.0, place: 'laneS' },
    { kind: 'circle', t0: 4.0, t1: 9.0, place: 'laneS2' },
    { kind: 'tag', t0: 6.4, t1: 9.0, place: 'busN', text: 'Kerb lane' },
  ],

  wipe: { t0: 9.1, t1: 11.0, text: 'What if…' },

  split: {
    t0: 22, t1: 27, left: 'Today', right: 'What if',
    stats: [
      { label: 'Bus-only lanes', before: '{before.bus}', after: '{after.bus}' },
      { label: 'Lanes for everything else', before: '{before.lanes}', after: '{after.lanes}' },
      { label: 'Road width', before: '{before.width} m', after: '{after.width} m' },
    ],
  },

  end: { t0: 27, headline: 'Would you give up a lane?' },

  vo: [
    { t: 0.2, max: 2.9, text: '{before.lanes} lanes. The bus shares every one.' },
    { t: 3.3, max: 2.8, text: 'Every lane, mixed traffic.' },
    { t: 6.2, max: 2.8, text: 'Stop, start, merge, repeat.' },
    { t: 9.3, max: 1.6, text: 'What if…' },
    { t: 11.4, max: 1.9, text: 'The kerb lane, each way…' },
    { t: 13.4, max: 2.1, text: '…goes to buses only.' },
    { t: 15.8, max: 3.2, text: 'Red paint. The same road.' },
    { t: 22.4, max: 4.4, text: '{after.bus} lanes for buses. {after.lanes} for everything else.' },
    { t: 27.3, max: 2.4, text: 'Would you give up a lane?' },
  ],
};

export default scene;
