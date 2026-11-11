// What If · 01 — a wide signal junction you cross five lanes at a time, made safer: refuge islands in the middle,
// tighter corners, the free-left slips gone (and trees where they were). Plays on the film set's centre junction.
import type { Scene, Place, V2 } from '../../../src/film/types';
import type { Kit, Dir } from '../../../src/film/kit';
import type { Part } from '../../../src/net/model';

const S = (w: number): Part => ({ kind: 'sidewalk', width: w, dir: 0 });
const L = (w: number, dir: 1 | -1): Part => ({ kind: 'lane', width: w, dir });
const M = (w: number): Part => ({ kind: 'median', width: w, dir: 0 });
/** cross-sections looking out from the junction: outgoing lanes on the left (India drives on the left) */
const XS = {
  // Station Road (E–W): 2 out, 3 in, no median — 17.5 m of carriageway
  stationBefore: [S(2), L(3.5, 1), L(3.5, 1), L(3.5, -1), L(3.5, -1), L(3.5, -1), S(2)],
  // same 21.5 m road: 3 m lanes leave room for a 2.5 m refuge
  stationAfter: [S(2), L(3, 1), L(3, 1), M(2.5), L(3, -1), L(3, -1), L(3, -1), S(2)],
  // Market Road (N–S): 2 + 2, no median
  marketBefore: [S(2), L(3.5, 1), L(3.5, 1), L(3.5, -1), L(3.5, -1), S(2)],
  marketAfter: [S(2), L(3, 1), L(3, 1), M(2), L(3, -1), L(3, -1), S(2)],
};
const DIRS: Dir[] = ['N', 'E', 'S', 'W'];
/** free-left turns: from the arm you arrive on to the one on your left */
const SLIPS: [Dir, Dir][] = [['S', 'W'], ['W', 'N'], ['N', 'E'], ['E', 'S']];

const centre = (k: Kit) => k.junctionNear(0, 0).id;
const setArms = (k: Kit, dirs: Dir[], parts: Part[]) => { const j = centre(k); for (const d of dirs) { const a = k.arm(j, d); k.doc.set(a.s.id, 'parts', k.orient(a, parts)); } };

const scene: Scene = {
  id: 'wi-01',
  title: 'What If · 01',
  tile: 'film',
  duration: 30,
  hour: 9.2,

  before(k) {
    const j = centre(k);
    setArms(k, ['E', 'W'], XS.stationBefore);
    setArms(k, ['N', 'S'], XS.marketBefore);
    k.doc.update(j, { signals: true, crossings: true, rc: 15, slips: SLIPS.map(([f, t]) => ({ from: k.arm(j, f).s.id, to: k.arm(j, t).s.id, w: 5, r: 20 })) });
  },

  steps: [
    { t: 11.4, label: 'Free-left slips removed', place: 'cornerSE', run: (k) => k.doc.set(centre(k), 'slips', undefined) },
    { t: 13.4, n: 6, dur: 1.0, label: 'Corners {before.rc} m → {after.rc} m', place: 'cornerNE', run: (k, u) => k.doc.set(centre(k), 'rc', Math.round((15 - 9 * u) * 10) / 10) },
    { t: 15.6, label: 'Refuge islands', place: 'refugeE', run: (k) => setArms(k, ['E', 'W'], XS.stationAfter) },
    { t: 17.2, label: 'Refuges on Market Road too', place: 'refugeS', run: (k) => setArms(k, ['N', 'S'], XS.marketAfter) },
    { t: 18.9, dur: 1.6, label: 'Trees where the slips were', place: 'cornerSW', trees: 'newTrees', run: () => {} },
  ],

  measure(k) {
    const j = centre(k), J = k.doc.get<'junction'>(j)!;
    const c = Object.fromEntries(DIRS.map((d) => [d, k.crossing(j, d)]));
    const places: Record<string, Place> = { centre: { p: [J.x, J.z] }, ring: { ring: k.circle([J.x, J.z], 34, 72) } };
    for (const d of DIRS) { places[`cross${d}`] = { line: c[d].line }; places[`mid${d}`] = { p: c[d].mid }; if (c[d].refuges[0]) places[`refuge${d}`] = { p: c[d].refuges[0] }; }
    // corners: just off the kerbs, between the arms
    const hx = 9 + 5, hz = 10.75 + 5;
    for (const [n, sx, sz] of [['NE', 1, -1], ['SE', 1, 1], ['SW', -1, 1], ['NW', -1, -1]] as const) places[`corner${n}`] = { p: [J.x + sx * hx, J.z + sz * hz] };
    // new trees: down the Station Road refuges, and a few on each reclaimed corner
    const pts: V2[] = [];
    for (const d of ['E', 'W'] as Dir[]) {
      const a = k.arm(j, d), off = a.out ? 1.5 : -1.5; // the median's middle, 1.5 m left of the centre line looking out
      pts.push(...k.along(a.s.id, off, 10, 34).filter((p) => Math.hypot(p[0] - J.x, p[1] - J.z) < 125));
    }
    for (const [sx, sz] of [[1, -1], [1, 1], [-1, 1], [-1, -1]]) for (const [dx, dz] of [[17, 4.5], [11, 11], [4.5, 17.5]]) pts.push([J.x + sx * (9 + dx), J.z + sz * (10.75 + dz)]);
    places.newTrees = { pts };
    return {
      values: {
        longest: Math.max(c.E.longest, c.W.longest), lanes: Math.max(c.E.lanes, c.W.lanes),
        kerbEW: c.E.kerb, kerbNS: c.N.kerb, longestNS: Math.max(c.N.longest, c.S.longest),
        rc: k.cornerRadius(j), slips: J.slips?.length ?? 0, area: k.junctionArea(j),
      },
      places,
    };
  },

  keys: [
    { t: 0, at: 'centre', dist: 560, yaw: 20, pitch: 72, fov: 36 },
    { t: 3, at: 'centre', dist: 165, yaw: 34, pitch: 50, fov: 38, ease: 'out' },
    { t: 9, at: 'centre', dist: 140, yaw: 108, pitch: 31, fov: 40, ease: 'linear' },
    { t: 11, at: 'centre', dist: 175, yaw: 128, pitch: 56, fov: 38 },
    { t: 22, at: 'centre', dist: 160, yaw: 168, pitch: 50, fov: 38, ease: 'linear' },
    { t: 22.6, at: 'centre', dist: 175, yaw: 180, pitch: 64, fov: 38 },
    { t: 27, at: 'centre', dist: 165, yaw: 182, pitch: 64, fov: 38, ease: 'linear' },
    { t: 30, at: 'centre', dist: 165, yaw: 182, pitch: 64, fov: 38 },
  ],

  captions: [
    { t0: 0.15, t1: 3.1, text: 'To cross here, you face {before.lanes} lanes of traffic at once.', size: 'hook' },
    { t0: 3.3, t1: 6.1, text: '{before.longest} m kerb to kerb, nowhere to stop halfway.' },
    { t0: 6.2, t1: 9.0, text: '{before.rc} m corners and free-left slips: cars turn without slowing.' },
    { t0: 11.2, t1: 21.6, text: 'Same road width. Narrower lanes, a refuge in the middle.', at: 'bottom', size: 'small' },
  ],

  marks: [
    { kind: 'circle', t0: 0.6, t1: 9.0, place: 'ring' },
    { kind: 'dim', t0: 3.4, t1: 9.0, place: 'crossE', text: '{before.kerbEW} m' },
    { kind: 'dim', t0: 4.2, t1: 9.0, place: 'crossW', text: '{before.kerbEW} m' },
    { kind: 'tag', t0: 6.4, t1: 9.0, place: 'cornerSE', text: 'Free-left slip' },
  ],

  wipe: { t0: 9.1, t1: 11.0, text: 'What if…' },

  split: {
    t0: 22, t1: 27, left: 'Today', right: 'What if',
    stats: [
      { label: 'Longest dash across traffic', before: '{before.longest} m', after: '{after.longest} m' },
      { label: 'Lanes to cross in one go', before: '{before.lanes}', after: '{after.lanes}' },
      { label: 'Corner radius', before: '{before.rc} m', after: '{after.rc} m' },
    ],
  },

  end: { t0: 27, headline: 'Would you cross here now?' },

  vo: [
    { t: 0.2, max: 2.9, text: '{before.lanes} lanes to cross. In one go.' },
    { t: 3.3, max: 2.8, text: '{before.longest} metres, kerb to kerb.' },
    { t: 6.2, max: 2.8, text: "And slip roads where cars don't slow down." },
    { t: 9.3, max: 1.6, text: 'What if…' },
    { t: 11.4, max: 1.9, text: 'Lose the slips.' },
    { t: 13.4, max: 2.1, text: 'Tighter corners.' },
    { t: 15.6, max: 3.2, text: 'A refuge in the middle.' },
    { t: 18.9, max: 2.9, text: 'Trees where the slips were.' },
    { t: 22.4, max: 4.4, text: 'Same road. {after.longest} metres to cross, not {before.longest}.' },
    { t: 27.3, max: 2.4, text: 'Would you cross here now?' },
  ],
};

export default scene;
