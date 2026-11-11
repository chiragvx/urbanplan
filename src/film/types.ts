// The scene format for film mode: one file per episode (tools/film/scenes/<id>.ts, listed in src/film/scenes.ts).
// A scene builds its BEFORE map on the film set, lists the fix as ordered steps (each a document edit, revealed one
// by one), says what to measure, and lays out the 30 s: camera keys, captions, marks, the wipe, the split, the end card.
// Times are seconds; angles degrees; positions metres on the set (x east, z south; the set's centre junction is 0, 0).
import type { Kit } from './kit';

export type V2 = [number, number];

/** Somewhere on the map, measured from the document / compiled geometry (see Scene.measure). */
export interface Place {
  /** a point (tags, circles, camera targets) */ p?: V2;
  /** a line (dimension marks: kerb to kerb) */ line?: [V2, V2];
  /** an outline (circles follow it) */ ring?: V2[];
  /** points (new trees) */ pts?: V2[];
}

export interface Measured { values: Record<string, number>; places: Record<string, Place> }

/** One step of the fix. `n` > 1: run n times over `dur` with u = 1/n … 1 (a tween, e.g. a corner tightening). */
export interface Step {
  t: number;
  /** shown as a tag while the step lands */ label: string;
  /** where the tag points (a place name) */ place?: string;
  run(k: Kit, u: number): void;
  n?: number; dur?: number;
  /** trees grow at this place's points (film props: the editor has no tree objects) */ trees?: string;
  /** a count-up: one tick per unit of this measured value (read off the BEFORE state, e.g. a plot's floors), so `n` comes from the model */ count?: string;
}

/** Camera key: orbit `dist` metres round `at`, `yaw` from the +z axis (0 = looking north), `pitch` above the horizon. */
export interface Key {
  t: number;
  at: V2 | string;
  dist: number; yaw: number; pitch: number;
  fov?: number;
  /** easing of the move into this key */ ease?: 'inOut' | 'linear' | 'in' | 'out';
  /** look at this height (m) over the ground at `at` (a tall building in frame), default 0 */ y?: number;
}

/** Text: `{before.cross}` / `{after.rc}` fill in measured values (`{before.cross:0}` = no decimals). */
export interface Caption { t0: number; t1: number; text: string; at?: 'top' | 'centre' | 'bottom'; size?: 'hook' | 'body' | 'small' }

export type Mark =
  | { kind: 'circle'; t0: number; t1: number; place: string; r?: number; color?: string }
  | { kind: 'dim'; t0: number; t1: number; place: string; text: string; color?: string }
  | { kind: 'tag'; t0: number; t1: number; place: string; text: string; color?: string }
  /** an outline that moves in: from rings[0] to rings[1] from at[0] over `dur` s, then on to rings[2] from at[1], … (a setback pulling in) */
  | { kind: 'outline'; t0: number; t1: number; rings: string[]; at: number[]; dur?: number; color?: string }
  /** a corridor on the ground (a ring: one edge out, the other back), filled and dashed, drawn on along its length */
  | { kind: 'band'; t0: number; t1: number; place: string; color?: string }
  /** the plot tool drawing a place's ring: corner by corner over `dur` s from t0, then the closed plot until t1 */
  | { kind: 'draw'; t0: number; t1: number; place: string; dur: number; color?: string }
  /** a thing placed on the plot with a tool from Site Studio's shelf: clicked down (a building) or dragged out (`drag`: a garden, a lot) */
  | { kind: 'place'; t0: number; t1: number; place: string; tool: string; drag?: boolean; color?: string };

export interface Scene {
  id: string;
  title: string;
  /** the tile it plays on (public/tiles/<tile>) */ tile: string;
  duration: number;
  fps?: number;
  /** build the BEFORE map (one transaction) */
  before(k: Kit): void;
  steps: Step[];
  /** numbers and places, measured in the state the map is in (run before, after, and at every step) */
  measure(k: Kit): Measured;
  keys: Key[];
  captions: Caption[];
  marks: Mark[];
  wipe?: { t0: number; t1: number; text: string };
  /** before / after side by side (the camera holds or drifts on the keys meanwhile) */
  split?: { t0: number; t1: number; left: string; right: string; stats: { label: string; before: string; after: string }[] };
  /** the close: branded, the end card with `headline`; unbranded (brand.ts), `headline` is the closing question over the last shot */
  end: { t0: number; headline: string; /** the small print under the question when unbranded (default brand.ts `plain`) */ note?: string };
  /**
   * Voice-over (tools/film/sound.ts): each line spoken from `t`, made to fit in `max` seconds (spoken faster if it
   * has to be). Same templates as captions; numbers are said as numbers ("17.5 metres").
   */
  vo?: { t: number; text: string; max?: number }[];
  /** the narrator (a Kokoro voice, tools/film/tts.py), default bf_emma */ voice?: string;
  /** time of day (hours), default 9.5 */
  hour?: number;
  /**
   * Parked cars (film props, like the trees): one at each of a place's points as measured in the BEFORE state, along
   * the line the points run. `leave`: when they go (each shrinks away, one after another, over about a second);
   * without it they stay for the whole film.
   */
  cars?: { place: string; leave?: number }[];

  // ---- montage (the landing page's intro) ----
  /** the frame in CSS px, default [1080, 1920] */ size?: [number, number];
  /** a loop: no chip, bug, end card or closing; the film dips from and to ink at its ends so it joins up */ loop?: boolean;
  /** cuts between shots: a quick dip through ink at each time (move the camera keys across it) */ cuts?: number[];
  /** each shot's title, bottom left, numbered */ shots?: { t0: number; t1: number; title: string; sub?: string }[];

  // ---- plots (Plot Twist) ----
  /** when the score turns from the opening to the build, with no wipe (sound.ts; default the wipe's end) */ beat?: number;
  /** the music stops dead here, on the catchphrase (sound.ts; default it plays on to the end) */ sting?: number;
  /**
   * See-through slabs the size of a place's ring, stacked as thin plates `h` m apart (default 4): the FSI as whole-plot floors (a film
   * prop). Each layer adds `n` slabs (a measured value: a fraction makes the last one smaller), one by one over `dur` from `t`.
   */
  stack?: { place: string; t1: number; h?: number; layers: { t: number; n: string; dur?: number; color: string }[] };
  /** a big counter, top left: `text` (templated: `{now.up}`) over `label`, with a `sub` line */
  counter?: { t0: number; t1: number; text: string; label: string; sub?: string };
  /** number cards at the foot of the frame (the reveal): `wide` ones take a whole row */
  cards?: { t0: number; t1: number; stats: { label: string; value: string; wide?: boolean }[] };
}
