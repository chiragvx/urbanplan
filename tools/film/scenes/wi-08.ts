// What If · 08 — a 7 m residential gully with traffic both ways and no footpath: it goes one-way, and the lane it
// frees becomes a footpath down each side. Same seven metres, kerb to kerb. Plays on a local street south-west of the
// centre, where the houses front the street; the camera works low, between them.
import type { Scene, Place } from '../../../src/film/types';
import type { Kit } from '../../../src/film/kit';
import type { Part } from '../../../src/net/model';

const S = (w: number): Part => ({ kind: 'sidewalk', width: w, dir: 0 });
const L = (w: number, dir: 1 | -1): Part => ({ kind: 'lane', width: w, dir });
/** left → right looking west (the south side first); all 7 m */
const XS = {
  before: [L(3.5, 1), L(3.5, -1)],
  oneway: [L(3.5, 1), L(3.5, 1)],
  after: [S(1.75), L(3.5, 1), S(1.75)],
};
/** the local street at z = 250, west from the first cross street to the collector (two blocks) */
const blocks = (k: Kit) => k.stretch([-140, 250], [-360, 250]);
const set = (parts: Part[]) => (k: Kit) => k.setStretch(blocks(k), parts);

const scene: Scene = {
  id: 'wi-08',
  title: 'What If · 08',
  tile: 'film',
  duration: 30,
  hour: 11.2,

  before: (k) => set(XS.before)(k),

  steps: [
    { t: 11.4, label: 'One-way', place: 'lane', run: set(XS.oneway) },
    { t: 13.4, label: 'Footpath, both sides', place: 'walkE', run: set(XS.after) },
  ],

  measure(k) {
    const Bs = blocks(k), b = Bs[0], X = k.strips(b), n = X.length;
    const walk = k.widths(b, 'sidewalk'), lanes = X.filter((x) => x.kind === 'lane');
    const places: Record<string, Place> = {
      street: { p: k.at(b, 0.55) },
      far: { p: k.at(Bs[1], 0.4) },
      lane: { p: k.at(b, 0.62, 0.9) },
      walkE: { p: k.mid(b, 0, 0.66) }, walkW: { p: k.mid(b, n - 1, 0.5) },
      width: { line: [k.at(b, 0.5, X[0].o0), k.at(b, 0.5, X[n - 1].o1)] },
    };
    return {
      values: {
        walk: walk[0] ?? 0, walks: walk.length, ways: new Set(lanes.map((x) => x.dir)).size,
        width: Math.round(X.reduce((a, x) => a + x.width, 0) * 10) / 10,
      },
      places,
    };
  },

  // low, between the houses: down the gully from the east, then back along it from the west
  keys: [
    { t: 0, at: 'far', dist: 200, yaw: 98, pitch: 58, fov: 38 },
    { t: 3, at: 'street', dist: 44, yaw: 94, pitch: 26, fov: 44, ease: 'out' },
    { t: 9, at: 'street', dist: 36, yaw: 102, pitch: 21, fov: 46, ease: 'linear' },
    { t: 11, at: 'street', dist: 46, yaw: 278, pitch: 28, fov: 44 },
    { t: 22, at: 'street', dist: 40, yaw: 264, pitch: 23, fov: 46, ease: 'linear' },
    { t: 22.6, at: 'street', dist: 58, yaw: 270, pitch: 36, fov: 42 },
    { t: 27, at: 'street', dist: 54, yaw: 272, pitch: 34, fov: 42, ease: 'linear' },
    { t: 30, at: 'street', dist: 52, yaw: 273, pitch: 33, fov: 42 },
  ],

  captions: [
    { t0: 0.15, t1: 3.1, text: '{before.width} m. No footpath.', size: 'hook' },
    { t0: 3.3, t1: 6.1, text: 'Cars both ways, people in between.' },
    { t0: 6.2, t1: 9.0, text: 'Everyone squeezes past everyone.' },
    { t0: 11.2, t1: 21.6, text: 'Same {after.width} m gali. One-way, and a footpath each side.', at: 'bottom', size: 'small' },
  ],

  marks: [
    { kind: 'dim', t0: 0.6, t1: 9.0, place: 'width', text: '{before.width} m' },
    { kind: 'tag', t0: 3.4, t1: 9.0, place: 'lane', text: 'Both ways' },
  ],

  wipe: { t0: 9.1, t1: 11.0, text: 'What if…' },

  split: {
    t0: 22, t1: 27, left: 'Today', right: 'What if',
    stats: [
      { label: 'Footpath, each side', before: '{before.walk} m', after: '{after.walk:2} m' },
      { label: 'Directions of traffic', before: '{before.ways}', after: '{after.ways}' },
      { label: 'Street width', before: '{before.width} m', after: '{after.width} m' },
    ],
  },

  end: { t0: 27, headline: 'Would your lane go one-way?' },

  vo: [
    { t: 0.2, max: 2.9, text: '{before.width} metres. No footpath.' },
    { t: 3.3, max: 2.8, text: 'Cars both ways, people in between.' },
    { t: 6.2, max: 2.8, text: 'Everyone squeezes past everyone.' },
    { t: 9.3, max: 1.6, text: 'What if…' },
    { t: 11.4, max: 1.9, text: 'Make it one-way.' },
    { t: 13.4, max: 2.1, text: 'A footpath on both sides.' },
    { t: 15.8, max: 3.2, text: 'Same {after.width} metre gully.' },
    { t: 22.4, max: 4.4, text: '{after.walk:2} metres to walk, each side, where there was none.' },
    { t: 27.3, max: 2.4, text: 'Would your lane go one-way?' },
  ],
};

export default scene;
