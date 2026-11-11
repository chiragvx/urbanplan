// What If · 07 — a debate: the centre junction as a plain four-arm signal, swapped for a two-lane roundabout. The
// signal comes out, a ring grows in the middle (the editor adds the splitter islands and give-way lines itself).
// Measured: the ring's size off the compiled outline, and the paved area either way. Nothing about delay or flow.
import type { Scene, Place } from '../../../src/film/types';
import type { Kit, Dir } from '../../../src/film/kit';
import type { Part } from '../../../src/net/model';

const S = (w: number): Part => ({ kind: 'sidewalk', width: w, dir: 0 });
const L = (w: number, dir: 1 | -1): Part => ({ kind: 'lane', width: w, dir });
/** cross-sections looking out from the junction (02's ordinary junction) */
const XS = {
  station: [S(2), L(3.5, 1), L(3.5, 1), L(3.5, -1), L(3.5, -1), L(3.5, -1), S(2)],
  market: [S(2), L(3.5, 1), L(3.5, 1), L(3.5, -1), L(3.5, -1), S(2)],
};
const DIRS: Dir[] = ['N', 'E', 'S', 'W'];
/** the ring's centre-line radius (m), grown in from a small one */
const R0 = 9, R1 = 22;

const centre = (k: Kit) => k.junctionNear(0, 0).id;
const setArms = (k: Kit, dirs: Dir[], parts: Part[]) => { const j = centre(k); for (const d of dirs) { const a = k.arm(j, d); k.doc.set(a.s.id, 'parts', k.orient(a, parts)); } };

const scene: Scene = {
  id: 'wi-07',
  title: 'What If · 07',
  tile: 'film',
  duration: 30,
  hour: 12.4,

  before(k) {
    setArms(k, ['E', 'W'], XS.station);
    setArms(k, ['N', 'S'], XS.market);
    k.doc.update(centre(k), { signals: true, crossings: true, rc: 6, slips: undefined, R: undefined, ringLanes: undefined });
  },

  steps: [
    { t: 11.4, label: 'Signal removed', place: 'cornerNE', run: (k) => k.doc.set(centre(k), 'signals', false) },
    { t: 13.4, n: 6, dur: 1.4, label: 'A two-lane ring', place: 'island', run: (k, u) => k.doc.update(centre(k), { R: Math.round(R0 + (R1 - R0) * u), ringLanes: 2 }) },
    { t: 15.6, label: 'Give way to the ring', place: 'entryE', run: () => {} },
  ],

  measure(k) {
    const j = centre(k), J = k.doc.get<'junction'>(j)!, c: [number, number] = [J.x, J.z];
    const ring = k.C.junctionRing(j) ?? [];
    // the ring's outer kerb: the nearest the paved outline comes to the centre (between the arms)
    const outer = ring.length ? Math.min(...ring.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1]))) : 0;
    const places: Record<string, Place> = { centre: { p: c }, island: { p: c }, ring: { ring: k.circle(c, 36, 72) } };
    const hx = 9 + 5, hz = 10.75 + 5;
    for (const [n, sx, sz] of [['NE', 1, -1], ['SE', 1, 1], ['SW', -1, 1], ['NW', -1, -1]] as const) places[`corner${n}`] = { p: [J.x + sx * hx, J.z + sz * hz] };
    for (const d of DIRS) places[`mid${d}`] = { p: k.crossing(j, d).mid };
    places.entryE = { p: [J.x + (J.R ? J.R + 10 : 20), J.z + 5] };
    return {
      values: {
        signals: J.signals ? 1 : 0, arms: k.arms(j).length,
        diameter: J.R ? Math.round(outer * 2) : 0, area: k.junctionArea(j), rc: k.cornerRadius(j),
      },
      places,
    };
  },

  // high over the junction, round to a low look along Station Road at the ring
  keys: [
    { t: 0, at: 'centre', dist: 520, yaw: 60, pitch: 74, fov: 36 },
    { t: 3, at: 'centre', dist: 150, yaw: 70, pitch: 52, fov: 38, ease: 'out' },
    { t: 9, at: 'centre', dist: 130, yaw: 130, pitch: 36, fov: 40, ease: 'linear' },
    { t: 11, at: 'centre', dist: 170, yaw: 150, pitch: 60, fov: 38 },
    { t: 22, at: 'centre', dist: 150, yaw: 200, pitch: 48, fov: 38, ease: 'linear' },
    { t: 22.6, at: 'centre', dist: 170, yaw: 210, pitch: 66, fov: 38 },
    { t: 27, at: 'centre', dist: 160, yaw: 214, pitch: 64, fov: 38, ease: 'linear' },
    { t: 30, at: 'centre', dist: 158, yaw: 215, pitch: 63, fov: 38 },
  ],

  captions: [
    { t0: 0.15, t1: 3.1, text: '{before.arms} roads. One signal.', size: 'hook' },
    { t0: 3.3, t1: 6.1, text: 'Every arm waits its turn.' },
    { t0: 6.2, t1: 9.0, text: 'Even when the roads are empty.' },
    { t0: 11.2, t1: 21.6, text: 'Same four roads. No signal: a {after.diameter} m ring.', at: 'bottom', size: 'small' },
  ],

  marks: [
    { kind: 'circle', t0: 0.6, t1: 9.0, place: 'ring' },
    { kind: 'tag', t0: 3.4, t1: 9.0, place: 'cornerNE', text: 'Signal' },
  ],

  wipe: { t0: 9.1, t1: 11.0, text: 'What if…' },

  split: {
    t0: 22, t1: 27, left: 'Today', right: 'What if',
    stats: [
      { label: 'Signals', before: '{before.signals}', after: '{after.signals}' },
      { label: 'Ring, kerb to kerb', before: '—', after: '{after.diameter} m' },
      { label: 'Paved junction area', before: '{before.area:0} m²', after: '{after.area:0} m²' },
    ],
  },

  end: { t0: 27, headline: 'Would this work here?' },

  vo: [
    { t: 0.2, max: 2.9, text: '{before.arms} roads. One signal. Long waits.' },
    { t: 3.3, max: 2.8, text: 'Every arm waits its turn.' },
    { t: 6.2, max: 2.8, text: 'Even when the roads are empty.' },
    { t: 9.3, max: 1.6, text: 'What if…' },
    { t: 11.4, max: 1.9, text: 'Lose the signal.' },
    { t: 13.4, max: 2.1, text: 'A ring in the middle.' },
    { t: 15.6, max: 3.2, text: 'Everyone gives way to the ring.' },
    { t: 22.4, max: 4.4, text: 'No red lights at all. A {after.diameter} metre ring instead.' },
    { t: 27.3, max: 2.4, text: 'Would this work here?' },
  ],
};

export default scene;
