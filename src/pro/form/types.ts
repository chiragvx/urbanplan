// A building's form: the shape it takes, made by hand or picked from a template, as data. A procedure (./index.ts)
// turns it into real floors (each its own outline, after any carves), a core, columns and flats; the 3D, the
// wireframe, the money and the rules all read those floors, so a tapered or curved building is honest everywhere.
//
// The contract shared by the form core (./curve, ./slice, ./skeleton, ./units, ./templates), the engine and numbers
// (src/doc/site.ts, src/pro/evaluate.ts …), the 3D (./mesh.ts, scene.ts, wire.ts) and the editor (the Shape panel,
// edit.ts). Change it here, in one place.
//
// Placement: a formed building keeps the engine's `spine` as its anchor. The spine's first node is the form's
// origin and its first segment the form's local x axis (local z is the left normal, as the engine's segments use:
// n = (−u.z, u.x)). Moving or turning the building's spine moves or turns the form; nothing else is stored.
// Local coordinates are metres about that origin.

import { FLOOR_USES, USE_TABLE, type FloorUse } from '../../doc/uses';

export type Pt = [number, number];

/** A free closed curve through its points: smooth points are passed through with a continuous tangent
 *  (centripetal Catmull-Rom), sharp points are corners. Any shape, crossing or not: the rules flag, never block. */
export interface Curve {
  pts: Pt[];
  /** per point: a corner (true) or smooth (false / unset). Unset array: all corners (a polygon). */
  sharp?: boolean[];
}

/** A key floor: the plan at some height, as a change of the base plan. Floors between key floors are blended. */
export interface KeyFloor {
  /** how far up: 0 the lowest floor of the form, 1 its top floor */
  t: number;
  /** the plan scaled along local x and z (1: as drawn) */
  sx: number; sz: number;
  /** the plan shifted (m), for a lean */
  dx: number; dz: number;
  /** the plan turned (degrees, anticlockwise from above), for a twist */
  rot: number;
  /** a plan of its own at this height (blended point by point with its neighbours when they have as many points) */
  plan?: Curve;
}

/** What a part does to the floors it spans: adds to them (union), cuts out of them (subtract), or keeps only
 *  where it overlaps them (intersect). */
export type PartOp = 'add' | 'cut' | 'keep';

/** A part of the form (docs/plans/pro-design-freedom.md §3): a prism, its plan ring between two heights, that
 *  adds to, cuts out of or trims every floor between `from` and `to`. The plan drawn (with its key floors) is the
 *  first mass; the parts act on it in order. `path` moves the ring with height, so a slot can zig-zag up a tower,
 *  and the floor's own taper, lean and twist move it too. A slot, a notch, a sky garden are cuts; a podium, a
 *  wing or a bridge are adds; a keep trims the whole to a footprint. (Older forms' carves are cuts: `op` unset.) */
export interface Carve {
  id: string;
  /** what it does (unset: a cut, as every part was before parts) */
  op?: PartOp;
  /** its name in the Parts list (unset: one made from what it does) */
  name?: string;
  /** switched off: kept in the list, but not acting */
  off?: boolean;
  ring: Curve;
  /** how far up it starts and ends: 0 the lowest floor of the form, 1 its top floor */
  from: number; to: number;
  /** its first and last floor (1 the ground floor), when set: these win over `from` and `to`, so a podium on
   *  floors 1–3 stays on floors 1–3 when the building gets more or fewer floors (parts made since levels have them) */
  lo?: number; hi?: number;
  path?: { t: number; dx: number; dz: number }[];
  /** what's left at a cut: glass (a slot, a glazed reveal) or open (a sky garden, a void through) */
  face: 'glass' | 'open';
}
/** a part of the form: the same thing as a carve, by its newer name */
export type Part = Carve;
/** what a part does, its op unset read as a cut */
export const opOf = (c: Pick<Carve, 'op'>): PartOp => c.op ?? 'cut';
/** a part's first and last floor (1 the ground floor) of `n`: its own when set, else read off its share of the way up */
export function partSpan(c: Pick<Carve, 'from' | 'to' | 'lo' | 'hi'>, n: number): [number, number] {
  const fl = (t: number) => (n <= 1 ? 1 : Math.round(Math.max(0, Math.min(1, t)) * (n - 1)) + 1);
  const a = c.lo !== undefined ? c.lo : fl(Math.min(c.from, c.to)), b = c.hi !== undefined ? c.hi : fl(Math.max(c.from, c.to));
  const lo = Math.max(1, Math.min(n, Math.round(Math.min(a, b)))), hi = Math.max(1, Math.min(n, Math.round(Math.max(a, b))));
  return [lo, hi];
}
/** a part's start and end as shares of the way up `n` floors (its floors when set) */
export function partT(c: Pick<Carve, 'from' | 'to' | 'lo' | 'hi'>, n: number): [number, number] {
  if (c.lo === undefined && c.hi === undefined) return [Math.min(c.from, c.to), Math.max(c.from, c.to)];
  const [lo, hi] = partSpan(c, n), t = (k: number) => (n <= 1 ? 0 : (k - 1) / (n - 1));
  return [t(lo), t(hi)];
}

/** A space on the floors (docs/plans/pro-design-freedom.md §4.1): a plan ring on floors `lo` … `hi` (1 the ground
 *  floor) with a use of its own, so one floor can hold shops along the front and homes behind, or a terminal its
 *  check-in hall and its offices. What of a floor no space covers keeps its band's use. A space is filled by the
 *  use's generator (flats by the mix, shops along the frontage, offices, rooms), or kept as one unit. Spaces earlier
 *  in the list win where they overlap. Its ring moves with the floor's taper, lean and twist, as a part's does. */
export interface Space {
  id: string;
  name?: string;
  use: BuildingUse;
  ring: Curve;
  lo: number; hi: number;
  /** auto: the use's generator lays it out; one: the whole space is one unit (a hall, a shop, a lobby) */
  fill?: 'auto' | 'one';
  /** a department or group it belongs to ("Check-in", "Airside") */
  group?: string;
  off?: boolean;
}

/** A range of floors set apart (1 the ground floor): its own floor to floor, whatever the use, or no floor at all.
 *  A floor with no floor (a void) keeps its height and its walls, but has no slab and no area: the floor below
 *  rises through it (a double-height lobby, an atrium, a hall). The ground floor always has a floor. */
export interface Level {
  from: number; to: number;
  /** floor to floor (m); unset: the use's */
  h?: number;
  void?: boolean;
}
/** what the levels say of floor k (1 the ground floor): the last range holding it wins */
export function levelOf(levels: Level[] | undefined, k: number): { h?: number; void: boolean } {
  let h: number | undefined, v = false;
  for (const l of levels ?? []) {
    if (k < Math.min(l.from, l.to) || k > Math.max(l.from, l.to)) continue;
    if (l.h && l.h > 1.8) h = l.h;
    v = !!l.void && k > 1;
  }
  return { h, void: v };
}

/** A skin standing off the floors' edges: fins, a screen, a sculpted shell that rises past the roof. */
export interface Shell {
  /** metres out from the slab edges */
  offset: number;
  /** metres past the top floor's roof, and up from the ground before it starts */
  over: number; under: number;
}

export type RoofKind = 'flat' | 'mono' | 'gable' | 'hip' | 'barrel' | 'tilted' | 'dome' | 'crown';
export interface Roof {
  kind: RoofKind;
  /** degrees (mono, gable, hip, tilted); a barrel's or dome's rise as a share of its span */
  pitch: number;
  /** eaves past the walls (m) */
  overhang: number;
  /** which way it falls or tilts (degrees in local plan, 0 = local +x) */
  dir: number;
  /** a parapet's height (m, flat roofs) */
  parapet?: number;
}

/** What a band of floors is used for: a row of the use table (src/doc/uses.ts), which gives each its own floor height,
 *  flats or rooms, parking, fire class, lifts and money (sold, leased, or a public building's cost only). */
export type BuildingUse = FloorUse;
export interface UseBand {
  use: BuildingUse;
  floors: number;
  /** floor to floor (m); unset: the use's own (USE_INFO) */
  floorH?: number;
}

/** each use's name, floor height, icon and how it earns, as the editor shows them: read off the use table */
export const USE_INFO: Record<BuildingUse, { label: string; floorH: number; icon: string; sold: 'sale' | 'lease' | 'public' }> =
  Object.fromEntries(FLOOR_USES.map((u) => { const x = USE_TABLE[u]; return [u, { label: x.label, floorH: x.floorH, icon: x.icon, sold: x.sold }]; })) as Record<BuildingUse, { label: string; floorH: number; icon: string; sold: 'sale' | 'lease' | 'public' }>;

/** The skin's pattern: what the facade is made of, laid procedurally over every face of every floor. */
export type SkinPattern = 'grid' | 'fins' | 'louvres' | 'bands' | 'diagrid' | 'screen' | 'curtain' | 'balconies';
export interface Skin {
  pattern: SkinPattern;
  /** fins / mullions / louvres apart (m) */
  spacing: number;
  /** how far they stand out (m) */
  depth: number;
  /** fins turned off square to the face (degrees) */
  angle: number;
  /** 0 the same everywhere … 1 strongly graded along each face and up the height */
  grade: number;
  /** the slab edges shown as bands */
  slabEdge: boolean;
  /** share of the face that's glass (0 … 1) */
  glass: number;
}

export interface Form {
  /** the template it came from (unset: drawn by hand) */
  template?: string;
  /** the plan at the ground, local metres */
  plan: Curve;
  /** the plan up the height; empty: the same plan all the way up */
  keys: KeyFloor[];
  /** how floors blend between key floors */
  ease: 'linear' | 'smooth';
  /** its parts, in order (the name is older than parts: cuts were all a form had) */
  carves: Carve[];
  shell?: Shell;
  roof: Roof;
  /** the uses from the ground up; their floors add up to the building's floors over the ground */
  uses: UseBand[];
  /** floor heights by range, and floors left out (voids), over what the uses say */
  levels?: Level[];
  /** spaces with uses of their own, over the bands' (in order: the first wins where they overlap) */
  spaces?: Space[];
  /** the skin over the design system's (unset: the design system's language speaks) */
  skin?: Partial<Skin>;
  /** how round its corners are, 0 sharp … 1 soft (unset: the design language's, FormContext.round) */
  round?: number;
  /** low-rise homes side by side (row houses, a villa): the plan cut across local x into this many houses, each its
   *  own stair and one home a floor, so no shared core or corridor */
  houses?: number;
  /** floors planned by hand: on each run of floors, its units as drawn in place of the ones laid out (the first plan
   *  that covers a floor wins); see `FloorPlanEdit` */
  floorPlans?: FloorPlanEdit[];
}

/** A run of floors planned by hand ("Edit this floor"): its units as the designer drew them, in the building's own
 *  frame, used on floors `lo` to `hi` (1 up from the ground, as the floors are numbered) in place of the units the
 *  floor would be laid out with. Each is cut to the floor as it stands (a part changed since takes its share) and
 *  clear of the cores; one left off the floor is dropped. */
export interface FloorPlanEdit { id: string; lo: number; hi: number; units: HandUnit[] }
/** A unit drawn by hand: its outline (x, z, … in the building's frame), and its use and type when they're set (unset:
 *  the floor's use, and for homes the type its size makes it) */
export interface HandUnit { id: string; ring: number[]; use?: BuildingUse; t?: 0 | 1 | 2 | 3 }

/** the hand plan on floor n (1 up from the ground), if one covers it */
export const handPlanAt = (form: Form, n: number): FloorPlanEdit | undefined => form.floorPlans?.find((p) => n >= p.lo && n <= p.hi);

// ---------------- what the procedure makes of a form ----------------

/** One floor as built: its outline(s) after the carves, in world metres (x, z flat pairs, the engine's way). */
export interface FormFloor {
  level: number;
  /** its floor's height over the ground (m), and floor to floor */
  y: number; h: number;
  use: BuildingUse;
  /** no floor here: the floor below rises through it (no slab, no area, no units; its walls and height stay) */
  void?: boolean;
  /** the slab: the floor's outline before carves (one ring), and what's left after them (one or more rings) */
  outer: number[];
  rings: number[][];
  /** floor area after carves (m²) */
  area: number;
  /** the carves' cut faces on this floor, to glaze or leave open (world rings) */
  cuts: { ring: number[]; face: 'glass' | 'open' }[];
  /** flats (t 0..2 = 1/2/3 BHK) or other units (t 3: an office, a shop, a hotel room cluster, a public room) */
  /** `kind`: a unit in a space of its own use (unset: the floor's) */
  units: { t: 0 | 1 | 2 | 3; ring: number[]; carpet: number; kind?: BuildingUse; hand?: string }[];
  carpet: number;
  /** the spaces on this floor, as they fall on it (world rings, after the floor's shape) */
  spaces?: { id: string; use: BuildingUse; rings: number[][]; area: number }[];
  /** the part of this floor standing past the floor below (a cantilever or balcony) and set back from it (a terrace) */
  over: number; terrace: number;
}

export interface FormIssue { key: string; tone: 'warn' | 'fail' | 'info'; text: string }

export interface FormLayout {
  floors: FormFloor[];
  /** the whole volume seen from above (the union of every floor's outline): what the margins and clashes check */
  outline: number[];
  /** the core: lifts, stairs, shafts, in the ground every floor shares (world rings) */
  cores: number[][];
  /** columns (world x, z) and how many of them land on nothing (transfers) */
  columns: Pt[]; transfers: number;
  /** the shell's ring per floor (world), when there is one */
  shell: number[][] | null;
  /** the top of the roof (m): the roof's ridge or parapet, or the shell's top when it rises past them */
  top: number;
  issues: FormIssue[];
  /** what the cores hold, all of them together (stairs, lifts) and their area on a floor (m²) */
  core?: { stairs: number; lifts: number; area: number };
  /** every column as a run: where it stands at its lowest floor and its highest (world x, z), the levels it spans,
   *  and whether it starts on a slab rather than the ground (a transfer). A column off plumb is raked, not moved. */
  posts?: { x0: number; z0: number; x1: number; z1: number; from: number; to: number; transfer: boolean }[];
  /** the shell's bottom and top (m), when there is one */
  shellY?: [number, number];
  /** the roof over the top floor: its eaves ring (world, overhang and all), the height it starts at, how high it
   *  rises over that, and the way it falls (world unit vector) */
  roof?: { ring: number[]; y: number; rise: number; dir: Pt };
}

/** what the procedure needs from the project */
export interface FormContext {
  /** the design system's floor to floor for homes (m) */
  floorH: number;
  /** the flat mix (1/2/3 BHK shares) and the flats' sizes (m² carpet) */
  mix: [number, number, number];
  sizes: [number, number, number];
  /** the design language's corners, 0 sharp … 1 soft (unset: as drawn) */
  round?: number;
}

/** A template: a starting form (or several buildings) a five-year-old can drop on the plot and then shape. */
export interface FormTemplate {
  id: string;
  name: string;
  /** what it is, for the gallery's groups */
  group: 'tower' | 'homes' | 'public' | 'sculpted';
  blurb: string;
  /** the building(s) at an origin, facing local +x along `dir` (a unit vector), sized to fit `room` metres wide and deep if given */
  make: (o: Pt, dir: Pt, room?: { w: number; d: number }) => { form: Form; floors: number; name: string; offset?: Pt }[];
}
