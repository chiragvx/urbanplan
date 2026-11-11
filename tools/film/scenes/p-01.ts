// Plot Twist · 01 — one acre in Pune on a 30 m road: what the rules let you build on it. The plot, the FSI as
// see-through plot-sized floors, the margins pulling in, the stilt, then the tower floor by floor up to the height cap.
// Every number is Site Studio's own (UDCPR, residential, the optimiser's tower), measured off the model at render.
// Plays on the vacant acre the film set leaves on Station Road's south side, east of x 470 (tools/film/set.ts).
import type { Scene } from '../../../src/film/types';
import type { Kit } from '../../../src/film/kit';
import { COBALT, ORANGE } from '../../../src/film/brand';

/** one acre (4,046.86 m²), square, its front 0.5 m back from the road's edge, its middle at x 525 */
const SIDE = Math.sqrt(4046.86), X = 525, ROAD = 30, Z0 = ROAD / 2 + 0.5;
const RING = [X - SIDE / 2, Z0, X + SIDE / 2, Z0, X + SIDE / 2, Z0 + SIDE, X - SIDE / 2, Z0 + SIDE];

/** Station Road, from the junction at x 470 east into the hills, widened to `w` */
const widen = (k: Kit, w: number) => { for (const x of [470, 580]) { const a = k.arm(k.junctionNear(x, 0).id, 'E'); k.doc.set(a.s.id, 'parts', k.orient(a, k.crossSection(w))); } };

const scene: Scene = {
  id: 'p-01',
  title: 'Plot Twist · 01',
  tile: 'film',
  duration: 44.5,
  hour: 16,

  before(k) {
    widen(k, ROAD);
    k.plot(RING, { name: 'One acre', use: 'residential', code: 'udcpr', design: { type: 'tower' } });
  },

  steps: [
    { t: 23.4, label: 'Stilt + {after.basements} basements', place: 'building', run: (k) => k.plotFloors(0) },
    // a floor a tick, as many as the scheme has
    { t: 26.6, count: 'floors', dur: 4.6, label: 'Floors', run: (k, u) => k.plotFloors(Math.round(u * k.plotValues().floors)) },
  ],

  measure: (k) => ({ values: k.plotValues(), places: k.plotPlaces() }),

  keys: [
    { t: 0, at: 'plot', dist: 760, yaw: 205, pitch: 74, fov: 34 },
    { t: 4.4, at: 'plot', dist: 340, yaw: 215, pitch: 56, fov: 34, ease: 'out' },
    { t: 10, at: 'plot', dist: 330, yaw: 226, pitch: 44, fov: 34, y: 4, ease: 'inOut' },
    { t: 18.2, at: 'plot', dist: 310, yaw: 236, pitch: 40, fov: 34, y: 6, ease: 'linear' },
    { t: 19.4, at: 'plot', dist: 300, yaw: 240, pitch: 62, fov: 34 },
    { t: 23.2, at: 'plot', dist: 290, yaw: 246, pitch: 56, fov: 34, ease: 'linear' },
    { t: 26.4, at: 'building', dist: 270, yaw: 250, pitch: 30, fov: 34, y: 8 },
    { t: 31.6, at: 'building', dist: 360, yaw: 262, pitch: 14, fov: 34, y: 26 },
    { t: 33.4, at: 'building', dist: 380, yaw: 268, pitch: 11, fov: 34, y: 20, ease: 'inOut' },
    { t: 38, at: 'building', dist: 380, yaw: 284, pitch: 13, fov: 34, y: 20, ease: 'linear' },
    // the close rises over the tower rather than sinking behind the blocks in front of it
    { t: 44.5, at: 'building', dist: 420, yaw: 292, pitch: 26, fov: 34, y: 28, ease: 'inOut' },
  ],

  captions: [
    { t0: 0.2, t1: 4.3, text: 'If you had one acre in Pune… what could you build?', size: 'hook' },
    { t0: 4.6, t1: 9.9, text: '{after.area:0} m² on a {after.road} m road' },
    { t0: 10.3, t1: 13.9, text: 'FSI {after.fsi} + {after.anc}% ancillary' },
    { t0: 14.0, t1: 18.6, text: '{after.times}× the plot: {after.bua:0} m² of floors' },
    { t0: 19.0, t1: 23.3, text: 'Margins: {after.front} m in front, up to {after.side} m at the sides' },
    { t0: 30.1, t1: 33.4, text: '{after.maxH} m cap assumed', at: 'bottom', size: 'small' },
    { t0: 38.2, t1: 41.6, text: 'Congratulations. You now own a {after.floors}-storey tower.', at: 'top', size: 'hook' },
  ],

  marks: [
    { kind: 'circle', t0: 4.6, t1: 11.5, place: 'plot', color: COBALT },
    { kind: 'tag', t0: 4.9, t1: 9.9, place: 'plot', text: '{after.area:0} m²', color: COBALT },
    { kind: 'dim', t0: 5.6, t1: 9.9, place: 'road', text: '{after.road} m', color: COBALT },
    { kind: 'outline', t0: 18.7, t1: 33.4, rings: ['plot', 'setbackLow', 'setback'], at: [18.9, 21.4], dur: 1.4, color: ORANGE },
    { kind: 'dim', t0: 19.6, t1: 25.8, place: 'frontDim', text: '{after.front} m', color: ORANGE },
    { kind: 'dim', t0: 22.6, t1: 25.8, place: 'sideDim', text: '{after.side} m', color: ORANGE },
  ],

  // the FSI as floors the size of the plot: the road's FSI, then the ancillary share on top
  stack: { place: 'plot', t1: 18.6, layers: [{ t: 11.6, n: 'fsiX', dur: 1.2, color: COBALT }, { t: 13.2, n: 'ancX', dur: 0.6, color: ORANGE }] },

  counter: { t0: 26.5, t1: 33.4, text: '{now.up}', label: 'floors', sub: '{now.upH} m' },

  cards: {
    t0: 33.6, t1: 37.9,
    stats: [
      { label: 'Floors', value: '{after.floors}' }, { label: 'Height', value: '{after.height} m' },
      { label: 'Flats', value: '{after.flats}' }, { label: 'Ground covered', value: '{after.coverage:0}%' },
      { label: 'Parking', value: 'Stilt + {after.basements} basements', wide: true },
    ],
  },

  beat: 10.2,
  sting: 38.1,
  end: { t0: 41.8, headline: 'What would you build on it?', note: 'Illustrative: default rules, residential.' },

  vo: [
    { t: 0.3, max: 3.9, text: 'If you had one acre in Pune… what could you build?' },
    { t: 4.5, max: 4.2, text: "That's {after.area:0} square metres, on a {after.road} metre road." },
    { t: 10.2, max: 3.85, text: 'The road sets your FSI: {after.fsi}. Plus {after.anc} percent ancillary.' },
    { t: 14.0, max: 4.95, text: '{after.times} times the plot. {after.bua:0} square metres.' },
    { t: 19.05, max: 4.3, text: 'Stay {after.front} metres back from the road… and further from the sides, the taller you go.' },
    { t: 23.4, max: 2.8, text: 'Parking on stilts. {after.basements} basements below.' },
    { t: 26.4, max: 3.4, text: 'Then floor after floor…' },
    { t: 30.0, max: 3.4, text: '…until you hit the {after.maxH} metre cap.' },
    { t: 33.6, max: 4.4, text: '{after.floors} floors. {after.height} metres. {after.flats} flats.' },
    { t: 38.2, max: 3.4, text: 'Congratulations. You now own a {after.floors}-storey tower.' },
  ],
};

export default scene;
