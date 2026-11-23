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
  from: number; to: number;
  path?: { t: number; dx: number; dz: number }[];
  /** what's left at a cut: glass (a slot, a glazed reveal) or open (a sky garden, a void through) */
  face: 'glass' | 'open';
}
/** a part of the form: the same thing as a carve, by its newer name */
export type Part = Carve;
/** what a part does, its op unset read as a cut */
export const opOf = (c: Pick<Carve, 'op'>): PartOp => c.op ?? 'cut';

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
  /** the skin over the design system's (unset: the design system's language speaks) */
  skin?: Partial<Skin>;
  /** how round its corners are, 0 sharp … 1 soft (unset: the design language's, FormContext.round) */
  round?: number;
  /** low-rise homes side by side (row houses, a villa): the plan cut across local x into this many houses, each its
   *  own stair and one home a floor, so no shared core or corridor */
  houses?: number;
}

// ---------------- what the procedure makes of a form ----------------

/** One floor as built: its outline(s) after the carves, in world metres (x, z flat pairs, the engine's way). */
export interface FormFloor {
  level: number;
  /** its floor's height over the ground (m), and floor to floor */
  y: number; h: number;
  use: BuildingUse;
  /** the slab: the floor's outline before carves (one ring), and what's left after them (one or more rings) */
  outer: number[];
  rings: number[][];
  /** floor area after carves (m²) */
  area: number;
  /** the carves' cut faces on this floor, to glaze or leave open (world rings) */
  cuts: { ring: number[]; face: 'glass' | 'open' }[];
  /** flats (t 0..2 = 1/2/3 BHK) or other units (t 3: an office, a shop, a hotel room cluster, a public room) */
  units: { t: 0 | 1 | 2 | 3; ring: number[]; carpet: number }[];
  carpet: number;
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
