// What If · 03 — a market street with parking on both kerbs and 1.5 m footpaths: the parking comes off one side, that
// footpath gets the space, and a strip of trees goes in. Plays on Market Road, two blocks south of the centre junction.
// The trade is counted: parking spaces from the kerb length, trees from the planter's length.
import type { Scene, Place, V2 } from '../../../src/film/types';
import type { Kit, Block } from '../../../src/film/kit';
import type { Part, PartKind } from '../../../src/net/model';

const S = (w: number): Part => ({ kind: 'sidewalk', width: w, dir: 0 });
const L = (w: number, dir: 1 | -1): Part => ({ kind: 'lane', width: w, dir });
const P = (w: number): Part => ({ kind: 'parking', width: w, dir: 0 });
const H = (w: number): Part => ({ kind: 'shoulder', width: w, dir: 0 });
const T = (w: number): Part => ({ kind: 'planter', width: w, dir: 0 });
/** left → right looking south (the east kerb first); all 15 m */
const XS = {
  before: [S(1.5), P(2.5), L(3.5, 1), L(3.5, -1), P(2.5), S(1.5)],
  cleared: [S(1.5), H(2.5), L(3.5, 1), L(3.5, -1), P(2.5), S(1.5)],
  wide: [S(4), L(3.5, 1), L(3.5, -1), P(2.5), S(1.5)],
  after: [S(2.5), T(1.5), L(3.5, 1), L(3.5, -1), P(2.5), S(1.5)],
};
/** Market Road from the first cross street south of the centre to the collector (two blocks) */
const blocks = (k: Kit) => k.stretch([0, 140], [0, 360]);
const set = (parts: Part[]) => (k: Kit) => k.setStretch(blocks(k), parts);
/** index of the first / last strip of a kind (the east / west kerb's), or -1 */
const first = (k: Kit, b: Block, kind: PartKind) => k.strips(b).findIndex((x) => x.kind === kind);
const last = (k: Kit, b: Block, kind: PartKind) => k.strips(b).map((x) => x.kind).lastIndexOf(kind);

const scene: Scene = {
  id: 'wi-03',
  title: 'What If · 03',
  tile: 'film',
  duration: 30,
  hour: 10.4,
  // the east kerb's cars go as its parking does; the west kerb's stay
  cars: [{ place: 'carsL', leave: 11.4 }, { place: 'carsR' }],

  before: (k) => set(XS.before)(k),

  steps: [
    { t: 11.4, label: 'Parking off this side', place: 'kerbL', run: set(XS.cleared) },
    { t: 13.4, label: 'The footpath takes it', place: 'footL', run: set(XS.wide) },
    { t: 15.6, dur: 2.4, label: 'Trees, every 8 m', place: 'kerbL', trees: 'newTrees', run: set(XS.after) },
  ],

  measure(k) {
    const B = blocks(k), b = B[0];
    const fL = first(k, b, 'sidewalk'), fR = last(k, b, 'sidewalk'), pl = first(k, b, 'planter');
    const X = k.strips(b);
    const places: Record<string, Place> = {
      street: { p: k.at(b, 0.62) },
      far: { p: k.at(B[1], 0.5) },
      footL: { p: k.mid(b, fL, 0.5) }, footR: { p: k.mid(b, fR, 0.42) },
      dimL: { line: k.across(b, fL, 0.5) }, dimR: { line: k.across(b, fR, 0.42) },
      // the east kerb's second strip: parking today, the trees after
      kerbL: { p: k.mid(b, 1, 0.66) }, kerbR: { p: k.mid(b, X.length - 2, 0.72) },
      // the parking strips today, outlined (both blocks' east kerb, the near block's west kerb)
      parkL: { ring: k.outline(b, 1, 0.03, 0.97) }, parkL2: { ring: k.outline(B[1], 1, 0.03, 0.97) }, parkR: { ring: k.outline(b, X.length - 2) },
    };
    // a parked car every 5.5 m in each parking strip (in every state: the kerb that keeps its parking moves when the
    // carriageway narrows, and its cars move with it)
    const parked = (i: number) => (X[i]?.kind === 'parking' ? B.flatMap((x) => k.down(x, i, 5.5, 3.5)) : []);
    places.carsL = { pts: parked(1) }; places.carsR = { pts: parked(X.length - 2) };
    const pts: V2[] = pl < 0 ? [] : B.flatMap((x) => k.down(x, pl, 8, 7));
    places.newTrees = { pts };
    return {
      values: {
        foot: k.widths(b, 'sidewalk')[0], footR: k.widths(b, 'sidewalk').at(-1)!,
        spaces: B.reduce((a, x) => a + k.spaces(x), 0), trees: pts.length,
        width: Math.round(X.reduce((a, x) => a + x.width, 0) * 10) / 10, length: B.reduce((a, x) => a + k.blockLength(x), 0),
      },
      places,
    };
  },

  // low along the street from the south, then across it
  // low down the street's length: from the south today, from the north once it changes
  keys: [
    { t: 0, at: 'far', dist: 250, yaw: 10, pitch: 52, fov: 38 },
    { t: 3, at: 'street', dist: 58, yaw: 8, pitch: 27, fov: 42, ease: 'out' },
    { t: 9, at: 'street', dist: 50, yaw: 16, pitch: 22, fov: 44, ease: 'linear' },
    { t: 11, at: 'street', dist: 62, yaw: 194, pitch: 30, fov: 42 },
    { t: 22, at: 'street', dist: 54, yaw: 172, pitch: 25, fov: 44, ease: 'linear' },
    { t: 22.6, at: 'street', dist: 74, yaw: 180, pitch: 38, fov: 40 },
    { t: 27, at: 'street', dist: 70, yaw: 182, pitch: 36, fov: 40, ease: 'linear' },
    { t: 30, at: 'street', dist: 68, yaw: 183, pitch: 35, fov: 40 },
  ],

  captions: [
    { t0: 0.15, t1: 3.1, text: '{before.foot} m footpaths. On a market street.', size: 'hook' },
    { t0: 3.3, t1: 6.1, text: '{before.spaces} parking spaces, both kerbs.' },
    { t0: 6.2, t1: 9.0, text: 'So people walk in the road.' },
    { t0: 11.2, t1: 21.6, text: 'Same {after.width} m street. One side of parking becomes footpath.', at: 'bottom', size: 'small' },
  ],

  marks: [
    { kind: 'dim', t0: 0.6, t1: 9.0, place: 'dimL', text: '{before.foot} m' },
    { kind: 'dim', t0: 1.2, t1: 9.0, place: 'dimR', text: '{before.footR} m' },
    { kind: 'circle', t0: 3.4, t1: 9.0, place: 'parkL' },
    { kind: 'circle', t0: 3.6, t1: 9.0, place: 'parkL2' },
    { kind: 'circle', t0: 3.8, t1: 9.0, place: 'parkR' },
    { kind: 'tag', t0: 3.6, t1: 9.0, place: 'kerbL', text: 'Parking' },
  ],

  wipe: { t0: 9.1, t1: 11.0, text: 'What if…' },

  split: {
    t0: 22, t1: 27, left: 'Today', right: 'What if',
    stats: [
      { label: 'Footpath, the wide side', before: '{before.foot} m', after: '{after.foot} m' },
      { label: 'Parking spaces, 2 blocks', before: '{before.spaces}', after: '{after.spaces}' },
      { label: 'New street trees', before: '{before.trees}', after: '{after.trees}' },
    ],
  },

  end: { t0: 27, headline: 'Fair trade?' },

  vo: [
    { t: 0.2, max: 2.9, text: '{before.foot} metre footpaths. On a market street.' },
    { t: 3.3, max: 2.8, text: 'Parked cars on both sides.' },
    { t: 6.2, max: 2.8, text: 'So people walk in the road.' },
    { t: 9.3, max: 1.6, text: 'What if…' },
    { t: 11.4, max: 1.9, text: 'Parking goes from one side.' },
    { t: 13.4, max: 2.1, text: 'The footpath gets that space.' },
    { t: 15.6, max: 3.2, text: 'And a row of trees.' },
    { t: 22.4, max: 4.7, text: '{after.foot} metres to walk. And {after.spaces} spaces, not {before.spaces}.' },
    { t: 27.3, max: 2.4, text: 'Fair trade?' },
  ],
};

export default scene;
