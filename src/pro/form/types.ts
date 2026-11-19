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

/** A cut through the form: a slot, a notch, a sky garden. Its plan ring is cut out of every floor between `from`
 *  and `to`; `path` moves the ring with height, so a slot can zig-zag up a tower. */
export interface Carve {
  id: string;
  ring: Curve;
  from: number; to: number;
  path?: { t: number; dx: number; dz: number }[];
  /** what's left at the cut: glass (a slot, a glazed reveal) or open (a sky garden, a void through) */
  face: 'glass' | 'open';
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

/** What a band of floors is used for. Each use has its own floor height, its own flats or rooms, its own parking,
 *  fire class, lifts and money (sold, leased, or a public building's cost only). */
export type BuildingUse = 'residential' | 'office' | 'retail' | 'hotel' | 'library' | 'toilet' | 'community' | 'school' | 'clinic' | 'parking';
export interface UseBand {
  use: BuildingUse;
  floors: number;
  /** floor to floor (m); unset: the use's own (USE_INFO) */
  floorH?: number;
}

export const USE_INFO: Record<BuildingUse, { label: string; floorH: number; icon: string; sold: 'sale' | 'lease' | 'public' }> = {
  residential: { label: 'Homes', floorH: 3.0, icon: 'home', sold: 'sale' },
  office: { label: 'Offices', floorH: 3.6, icon: 'briefcase', sold: 'lease' },
  retail: { label: 'Shops', floorH: 4.5, icon: 'shop', sold: 'sale' },
  hotel: { label: 'Hotel', floorH: 3.3, icon: 'bed', sold: 'lease' },
  library: { label: 'Library', floorH: 4.5, icon: 'book', sold: 'public' },
  toilet: { label: 'Public toilet', floorH: 3.2, icon: 'drop', sold: 'public' },
  community: { label: 'Community hall', floorH: 4.5, icon: 'people', sold: 'public' },
  school: { label: 'School', floorH: 3.6, icon: 'school', sold: 'public' },
  clinic: { label: 'Clinic', floorH: 3.6, icon: 'plus', sold: 'public' },
  parking: { label: 'Parking', floorH: 3.0, icon: 'car', sold: 'public' },
};

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
  carves: Carve[];
  shell?: Shell;
  roof: Roof;
  /** the uses from the ground up; their floors add up to the building's floors over the ground */
  uses: UseBand[];
  /** the skin over the design system's (unset: the design system's language speaks) */
  skin?: Partial<Skin>;
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
  /** the top of the roof (m) */
  top: number;
  issues: FormIssue[];
}

/** what the procedure needs from the project */
export interface FormContext {
  /** the design system's floor to floor for homes (m) */
  floorH: number;
  /** the flat mix (1/2/3 BHK shares) and the flats' sizes (m² carpet) */
  mix: [number, number, number];
  sizes: [number, number, number];
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
