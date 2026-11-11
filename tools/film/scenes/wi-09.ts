// What If · 09 — a crossroads with nothing on it: no signal, no box, wide corners. The fix: a signal with a zebra on
// every arm, tighter corners, and a yellow keep-clear box over the middle. Plays where Station Road meets the first
// cross street east of the centre. (Replaces the flyover: see the season notes; a deck over the set's single
// carriageway hides the road under it.) Measured: the box off the compiled junction outline, and the corners.
import type { Scene, Place } from '../../../src/film/types';
import type { Kit, Dir } from '../../../src/film/kit';

const DIRS: Dir[] = ['N', 'E', 'S', 'W'];
/** corner radius (m): today, and after */
const RC0 = 10, RC1 = 5;

const junction = (k: Kit) => k.junctionNear(140, 0).id;

const scene: Scene = {
  id: 'wi-09',
  title: 'What If · 09',
  tile: 'film',
  duration: 30,
  hour: 11.6,

  before: (k) => k.doc.update(junction(k), { signals: false, crossings: undefined, box: false, rc: RC0, slips: undefined }),

  steps: [
    { t: 11.4, label: 'Signal, zebra on every arm', place: 'cornerNE', run: (k) => k.doc.update(junction(k), { signals: true, crossings: true }) },
    { t: 13.4, n: 5, dur: 1.0, label: 'Corners {before.rc} m → {after.rc} m', place: 'cornerSW', run: (k, u) => k.doc.set(junction(k), 'rc', Math.round((RC0 + (RC1 - RC0) * u) * 10) / 10) },
    { t: 15.6, label: 'Keep-clear box', place: 'centre', run: (k) => k.doc.set(junction(k), 'box', true) },
  ],

  measure(k) {
    const j = junction(k), J = k.doc.get<'junction'>(j)!;
    const places: Record<string, Place> = { centre: { p: [J.x, J.z] }, ring: { ring: k.C.junctionRing(j) ?? k.circle([J.x, J.z], 20) } };
    const c = Object.fromEntries(DIRS.map((d) => [d, k.crossing(j, d)]));
    for (const d of DIRS) places[`cross${d}`] = { line: c[d].line };
    // corners: off the kerbs, between the arms (Station Road's half-width east-west, the side street's north-south)
    const hx = c.N.kerb / 2 + 6, hz = c.E.kerb / 2 + 6;
    for (const [n, sx, sz] of [['NE', 1, -1], ['SE', 1, 1], ['SW', -1, 1], ['NW', -1, -1]] as const) places[`corner${n}`] = { p: [J.x + sx * hx, J.z + sz * hz] };
    return {
      values: { box: J.box ? k.junctionArea(j) : 0, area: k.junctionArea(j), rc: k.cornerRadius(j), signals: J.signals ? 1 : 0, kerb: c.E.kerb },
      places,
    };
  },

  // a slow orbit, low over the corners
  keys: [
    { t: 0, at: 'centre', dist: 420, yaw: 230, pitch: 70, fov: 36 },
    { t: 3, at: 'centre', dist: 120, yaw: 222, pitch: 50, fov: 38, ease: 'out' },
    { t: 9, at: 'centre', dist: 105, yaw: 168, pitch: 36, fov: 40, ease: 'linear' },
    { t: 11, at: 'centre', dist: 125, yaw: 140, pitch: 56, fov: 38 },
    { t: 22, at: 'centre', dist: 110, yaw: 96, pitch: 46, fov: 38, ease: 'linear' },
    { t: 22.6, at: 'centre', dist: 125, yaw: 90, pitch: 64, fov: 38 },
    { t: 27, at: 'centre', dist: 118, yaw: 86, pitch: 62, fov: 38, ease: 'linear' },
    { t: 30, at: 'centre', dist: 116, yaw: 85, pitch: 61, fov: 38 },
  ],

  captions: [
    { t0: 0.15, t1: 3.1, text: 'A busy crossroads. No signal, no box.', size: 'hook' },
    { t0: 3.3, t1: 6.1, text: 'Nothing says keep the middle clear.' },
    { t0: 6.2, t1: 9.0, text: '{before.rc} m corners, wide open.' },
    { t0: 11.2, t1: 21.6, text: 'Same roads. A signal, tighter corners, a box to keep clear.', at: 'bottom', size: 'small' },
  ],

  marks: [
    { kind: 'circle', t0: 0.6, t1: 9.0, place: 'ring' },
    { kind: 'tag', t0: 6.4, t1: 9.0, place: 'cornerSE', text: '{before.rc} m corner' },
  ],

  wipe: { t0: 9.1, t1: 11.0, text: 'What if…' },

  split: {
    t0: 22, t1: 27, left: 'Today', right: 'What if',
    stats: [
      { label: 'Box kept clear', before: '{before.box:0} m²', after: '{after.box:0} m²' },
      { label: 'Corner radius', before: '{before.rc} m', after: '{after.rc} m' },
      { label: 'Signals', before: '{before.signals}', after: '{after.signals}' },
    ],
  },

  end: { t0: 27, headline: 'Would drivers keep it clear?' },

  vo: [
    { t: 0.2, max: 2.9, text: 'A busy crossroads. No signal, no box.' },
    { t: 3.3, max: 2.8, text: 'Nothing says keep the middle clear.' },
    { t: 6.2, max: 2.8, text: '{before.rc} metre corners, wide open.' },
    { t: 9.3, max: 1.6, text: 'What if…' },
    { t: 11.4, max: 1.9, text: 'A signal, and zebras.' },
    { t: 13.4, max: 2.1, text: 'Tighter corners.' },
    { t: 15.6, max: 3.2, text: 'And a yellow box. Keep it clear.' },
    { t: 22.4, max: 4.4, text: '{after.box:0} square metres where nobody may stop.' },
    { t: 27.3, max: 2.4, text: 'Would drivers keep it clear?' },
  ],
};

export default scene;
