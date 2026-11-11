// What If · 02 — the flip side of 01: an ordinary signal junction (tight corners, every left turn waits for green)
// "upgraded" the way many are, with wide corners and a free-left slip on every corner. Plays on the film set's centre
// junction, from the other side. The numbers are measured: what turning traffic gains, and how much bigger it gets.
import type { Scene, Place } from '../../../src/film/types';
import type { Kit, Dir } from '../../../src/film/kit';
import type { Part } from '../../../src/net/model';

const S = (w: number): Part => ({ kind: 'sidewalk', width: w, dir: 0 });
const L = (w: number, dir: 1 | -1): Part => ({ kind: 'lane', width: w, dir });
/** cross-sections looking out from the junction: outgoing lanes on the left (India drives on the left) */
const XS = {
  station: [S(2), L(3.5, 1), L(3.5, 1), L(3.5, -1), L(3.5, -1), L(3.5, -1), S(2)],
  market: [S(2), L(3.5, 1), L(3.5, 1), L(3.5, -1), L(3.5, -1), S(2)],
};
const DIRS: Dir[] = ['N', 'E', 'S', 'W'];
/** free-left turns, from the arm you arrive on to the one on your left, in the order they're added */
const SLIPS: [Dir, Dir][] = [['S', 'W'], ['W', 'N'], ['N', 'E'], ['E', 'S']];

const centre = (k: Kit) => k.junctionNear(0, 0).id;
const setArms = (k: Kit, dirs: Dir[], parts: Part[]) => { const j = centre(k); for (const d of dirs) { const a = k.arm(j, d); k.doc.set(a.s.id, 'parts', k.orient(a, parts)); } };
/** the first m slips */
const slips = (k: Kit, m: number) => { const j = centre(k); k.doc.set(j, 'slips', SLIPS.slice(0, m).map(([f, t]) => ({ from: k.arm(j, f).s.id, to: k.arm(j, t).s.id, w: 5, r: 20 }))); };

const scene: Scene = {
  id: 'wi-02',
  title: 'What If · 02',
  tile: 'film',
  duration: 30,
  hour: 16.6,

  before(k) {
    const j = centre(k);
    setArms(k, ['E', 'W'], XS.station);
    setArms(k, ['N', 'S'], XS.market);
    k.doc.update(j, { signals: true, crossings: true, rc: 6, slips: undefined });
  },

  steps: [
    { t: 11.4, n: 6, dur: 1.2, label: 'Corners {before.rc} m → {after.rc} m', place: 'cornerNE', run: (k, u) => k.doc.set(centre(k), 'rc', Math.round((6 + 9 * u) * 10) / 10) },
    { t: 13.6, label: 'Free-left slip', place: 'cornerSW', run: (k) => slips(k, 1) },
    { t: 14.8, label: 'Free-left slip', place: 'cornerNW', run: (k) => slips(k, 2) },
    { t: 16.0, label: 'Free-left slip', place: 'cornerNE', run: (k) => slips(k, 3) },
    { t: 17.2, label: 'Free-left slip', place: 'cornerSE', run: (k) => slips(k, 4) },
  ],

  measure(k) {
    const j = centre(k), J = k.doc.get<'junction'>(j)!;
    const c = Object.fromEntries(DIRS.map((d) => [d, k.crossing(j, d)]));
    const places: Record<string, Place> = { centre: { p: [J.x, J.z] }, ring: { ring: k.circle([J.x, J.z], 34, 72) } };
    for (const d of DIRS) { places[`cross${d}`] = { line: c[d].line }; places[`mid${d}`] = { p: c[d].mid }; }
    // corners: just off the kerbs, between the arms
    const hx = 9 + 5, hz = 10.75 + 5;
    for (const [n, sx, sz] of [['NE', 1, -1], ['SE', 1, 1], ['SW', -1, 1], ['NW', -1, -1]] as const) places[`corner${n}`] = { p: [J.x + sx * hx, J.z + sz * hz] };
    return {
      values: {
        longest: Math.max(c.E.longest, c.W.longest), lanes: Math.max(c.E.lanes, c.W.lanes), kerbEW: c.E.kerb,
        rc: k.cornerRadius(j), slips: J.slips?.length ?? 0, area: k.junctionArea(j),
      },
      places,
    };
  },

  // 01's orbit, from the opposite side of the junction
  keys: [
    { t: 0, at: 'centre', dist: 560, yaw: 200, pitch: 72, fov: 36 },
    { t: 3, at: 'centre', dist: 165, yaw: 214, pitch: 50, fov: 38, ease: 'out' },
    { t: 9, at: 'centre', dist: 140, yaw: 288, pitch: 31, fov: 40, ease: 'linear' },
    { t: 11, at: 'centre', dist: 175, yaw: 308, pitch: 56, fov: 38 },
    { t: 22, at: 'centre', dist: 160, yaw: 348, pitch: 50, fov: 38, ease: 'linear' },
    { t: 22.6, at: 'centre', dist: 175, yaw: 360, pitch: 64, fov: 38 },
    { t: 27, at: 'centre', dist: 165, yaw: 362, pitch: 64, fov: 38, ease: 'linear' },
    { t: 30, at: 'centre', dist: 165, yaw: 362, pitch: 64, fov: 38 },
  ],

  captions: [
    { t0: 0.15, t1: 3.1, text: 'An ordinary junction. Every left turn waits for green.', size: 'hook' },
    { t0: 3.3, t1: 6.1, text: '{before.rc} m corners: turning cars slow right down.' },
    { t0: 6.2, t1: 9.0, text: 'Left-turners queue with everyone else.' },
    { t0: 11.2, t1: 21.6, text: 'Same roads. Wider corners, a slip lane on every corner.', at: 'bottom', size: 'small' },
  ],

  marks: [
    { kind: 'circle', t0: 0.6, t1: 9.0, place: 'ring' },
    { kind: 'tag', t0: 3.4, t1: 9.0, place: 'cornerNE', text: '{before.rc} m corner' },
    { kind: 'tag', t0: 6.4, t1: 9.0, place: 'cornerSE', text: 'Left turn waits here' },
  ],

  wipe: { t0: 9.1, t1: 11.0, text: 'What if…' },

  split: {
    t0: 22, t1: 27, left: 'Today', right: 'What if',
    stats: [
      { label: 'Left turns that skip the signal', before: '{before.slips}', after: '{after.slips}' },
      { label: 'Corner radius', before: '{before.rc} m', after: '{after.rc} m' },
      { label: 'Paved junction area', before: '{before.area:0} m²', after: '{after.area:0} m²' },
    ],
  },

  end: { t0: 27, headline: 'Better or worse?' },

  vo: [
    { t: 0.2, max: 2.9, text: 'An ordinary junction. Left turns wait.' },
    { t: 3.3, max: 2.8, text: '{before.rc} metre corners. Cars crawl round.' },
    { t: 6.2, max: 2.8, text: 'And left-turners sit in the same queue.' },
    { t: 9.3, max: 1.6, text: 'What if…' },
    { t: 11.4, max: 2.1, text: 'Open up the corners.' },
    { t: 13.6, max: 3.4, text: 'A free-left slip on every corner.' },
    { t: 17.6, max: 3.6, text: 'Left turns never stop for the light.' },
    // (the area: 804 → 1,565 m², measured; 1.95×)
    { t: 22.4, max: 4.4, text: '{after.slips} turns skip the signal. And the junction nearly doubles.' },
    { t: 27.3, max: 2.4, text: 'Better or worse?' },
  ],
};

export default scene;
