// The builder's design system: one place that says what every building in a project is made of and looks like.
// The facade's materials and colours, the glazing, the window and door catalog (the D / W / V schedule Indian
// drawings use), the balconies, the floor height and the specification sold with the flats. Pick a preset, change
// any token, and every building, the 3D view, the schedule, the light check and the cost follow it.
// `finish` names the materials (./materials.ts) of each surface: the facade, the floors room by room, the roof and
// the railings. Picking a facade material also sets the matching `facade` colour, which is what the 3D reads.
import { materialOf, type Material } from './materials';
import type { RoofKind, Skin, SkinPattern } from './form/types';

/** A window type in the catalog: W1, W2, V1 … (m) */
export interface WindowType {
  tag: string; label: string;
  w: number; h: number; sill: number;
  /** sliding opens half its area, casement all of it, fixed none; louvres (ventilators) most of it */
  kind: 'sliding' | 'casement' | 'fixed' | 'louvre';
}
/** A door type: D1 (the flat's entrance), D2 (rooms), D3 (toilets), SD (onto the balcony) (m) */
export interface DoorType {
  tag: string; label: string;
  w: number; h: number;
  kind: 'flush' | 'panel' | 'veneer' | 'glass-sliding' | 'fire-rated';
}
export type BalconyKind = 'cantilever' | 'recessed' | 'french' | 'none';
export type Railing = 'glass' | 'ms' | 'solid';

/** One line of the specification: a category and the choice made, with what it adds to construction (₹ / sq ft of
 *  built-up area, rough market figures to be replaced with your own). */
export interface SpecChoice { label: string; rate: number }
export const SPEC: { key: string; label: string; options: SpecChoice[] }[] = [
  { key: 'flooring', label: 'Flooring', options: [
    { label: 'Vitrified tiles 600 × 600', rate: 0 },
    { label: 'Large-format vitrified 800 × 1600', rate: 120 },
    { label: 'Italian marble in living, wood in bedrooms', rate: 450 },
  ] },
  { key: 'kitchen', label: 'Kitchen', options: [
    { label: 'Granite platform, steel sink', rate: 0 },
    { label: 'Quartz platform, modular base units', rate: 180 },
    { label: 'Fully modular with appliances', rate: 380 },
  ] },
  { key: 'bath', label: 'Bathrooms', options: [
    { label: 'Standard sanitaryware and fittings', rate: 0 },
    { label: 'Premium fittings, glass shower', rate: 150 },
    { label: 'Designer fittings, wall-hung, rain shower', rate: 320 },
  ] },
  { key: 'doors', label: 'Doors', options: [
    { label: 'Laminated flush doors', rate: 0 },
    { label: 'Veneered doors, digital lock on the main door', rate: 90 },
    { label: 'Full-height veneered doors, smart locks', rate: 200 },
  ] },
  { key: 'windows', label: 'Window system', options: [
    { label: 'Powder-coated aluminium, clear glass', rate: 0 },
    { label: 'UPVC, toughened glass', rate: 70 },
    { label: 'Thermally broken aluminium, double glazing', rate: 220 },
  ] },
  { key: 'facade', label: 'Facade finish', options: [
    { label: 'Acrylic paint', rate: 0 },
    { label: 'Texture paint with cladding accents', rate: 90 },
    { label: 'Stone / ACP cladding', rate: 260 },
  ] },
  { key: 'lifts', label: 'Lifts', options: [
    { label: 'Standard passenger lifts', rate: 0 },
    { label: 'Faster lifts with power backup', rate: 60 },
    { label: 'High-speed lifts, private lobby', rate: 180 },
  ] },
  { key: 'amenities', label: 'Amenities', options: [
    { label: 'Garden and play area', rate: 0 },
    { label: 'Gym and multipurpose hall', rate: 80 },
    { label: 'Clubhouse, pool, co-working', rate: 200 },
  ] },
];

export interface DesignSystem {
  id: string; name: string; blurb: string;
  facade: { wall: string; wallName: string; accent: string; accentName: string; base: string; bands: boolean; fins: boolean };
  glazing: { glass: string; frame: string; frameName: string };
  /** W1 the main window (living, master bedroom), W2 the smaller (bedrooms, kitchen), V1 the toilet ventilator */
  windows: { W1: WindowType; W2: WindowType; V1: WindowType };
  /** D1 the flat's entrance, D2 a room's door, D3 a toilet's, SD the balcony door */
  doors: { D1: DoorType; D2: DoorType; D3: DoorType; SD: DoorType };
  balcony: { kind: BalconyKind; depth: number; railing: Railing };
  /** floor to floor (m) */
  floorH: number;
  /** a choice (index into SPEC's options) per category */
  spec: Record<string, number>;
  /** what the product sells for over the city's starting price (a share: 0.3 = 30 % more), until a price is set */
  premium: number;
  /** the materials of each surface, by id in ./materials.ts (unset on designs saved before materials: read it
   *  through `finishOf`, which falls back to the preset's) */
  finish?: Finish;
  /** a saved design system's id (./designLibrary.ts) when this one came from it, so the UI can say "changed from" */
  origin?: string;
  /** its design language for formed buildings (./form): the skin laid over every face, the roof it likes, how
   *  round it likes its corners (0 sharp … 1 fully smooth). Unset: read through `languageOf`, which derives one. */
  language?: Language;
  /** how the facade is composed: zones, bays, corners, entrance (unset: read through `compositionOf`) */
  composition?: Composition;
  /** the share of the facade each tone and the glass should be (unset: read through `paletteOf`) */
  palette?: PaletteTargets;
  /** the climate's elements: sunshades and screens (unset: read through `climateOf`) */
  climate?: Climate;
  /** the preset a style was built on (./design.ts `derive`) */
  basedOn?: string;
  /** how the buildings are lit at night, signed and planted round (unset: read through lightingOf, signageOf,
   *  landscapeOf) */
  lighting?: Lighting; signage?: Signage; landscape?: Landscape;
  /** the site's own kit: the compound wall, the gates and the internal roads (unset: read through siteKitOf) */
  site?: SiteKit;
  /** a heritage precinct whose controls it follows (./heritage.ts): those tokens are set by it and locked */
  precinct?: string;
}

/** Facade lighting, as design guidelines write it: what's lit, how warm, and whether it's kept off the sky. */
export interface Lighting {
  /** wash: the base lit from the ground; grazing: the piers and corners lit up their height; lines: LED lines on the
   *  string courses and the cornice; none */
  facade: 'none' | 'wash' | 'grazing' | 'lines';
  /** colour temperature (K): guidelines ask 3000 or warmer near homes */
  kelvin: number;
  /** dark sky: fittings shielded, nothing aimed above the horizontal */
  shielded: boolean;
}
/** The building's name and any signs: what kind, how big its letters, and the most of the front face they may take. */
export interface Signage {
  kind: 'none' | 'letters' | 'panel' | 'blade';
  /** letter or panel height (m) */
  h: number;
  /** the most of the front face signs may cover (Amaravati's draft caps it at 20 %) */
  cap: number;
}
/** The planting round the buildings. */
export interface Landscape {
  /** few: what the garden has; avenue: a row along the road; dense: rows along every edge */
  trees: 'few' | 'avenue' | 'dense';
  /** a hedge along the boundary (not across the road side) */
  hedge: boolean;
  /** planters on the balconies */
  planters: boolean;
}
const LIGHTINGS: Record<string, Lighting> = {
  glass: { facade: 'lines', kelvin: 4000, shielded: true }, signature: { facade: 'grazing', kelvin: 2700, shielded: true },
  value: { facade: 'none', kelvin: 3000, shielded: true }, fluid: { facade: 'grazing', kelvin: 3000, shielded: true },
  sculpted: { facade: 'lines', kelvin: 3000, shielded: true },
};
const SIGNAGES: Record<string, Signage> = { value: { kind: 'panel', h: 0.9, cap: 0.2 }, glass: { kind: 'letters', h: 0.9, cap: 0.2 } };
const LANDSCAPES: Record<string, Landscape> = {
  value: { trees: 'few', hedge: false, planters: false }, signature: { trees: 'dense', hedge: true, planters: true },
  earth: { trees: 'dense', hedge: true, planters: true },
};
export const lightingOf = (d: DesignSystem): Lighting => d.lighting ?? LIGHTINGS[d.id] ?? { facade: 'wash', kelvin: 3000, shielded: true };
export const signageOf = (d: DesignSystem): Signage => d.signage ?? SIGNAGES[d.id] ?? { kind: 'letters', h: 0.6, cap: 0.2 };
export const landscapeOf = (d: DesignSystem): Landscape => d.landscape ?? LANDSCAPES[d.id] ?? { trees: 'avenue', hedge: true, planters: false };
/** The site kit: what the plot's edge, its ways in and out, and its internal roads are built as. The site engine lays
 *  the wall's runs, the gates and the roads out (src/doc/site.ts); these say how wide and of what, and the review
 *  checks them against the rules for access. */
export interface SiteKit {
  wall: {
    /** solid: masonry to its height; railing: a solid plinth with MS railing over; hedge: planted; none */
    kind: 'solid' | 'railing' | 'hedge' | 'none';
    /** its height (m), and a railing's solid plinth (m) */
    h: number; plinth: number;
    /** what it's faced with (./materials.ts id), and a coping along its top */
    material: string; coping: boolean;
    /** a pier every so many metres (0 none) */
    piers: number;
  };
  gate: {
    /** a vehicle gate's clear width (m): the fire tender needs 4.5 m and more as assumed (6 m where it drives in) */
    vehicle: number;
    /** a pedestrian gate beside it (m clear; 0 none): 1.2 m lets a wheelchair through */
    pedestrian: number;
    /** a separate way in and out */
    separate: boolean;
    /** how far the gate is set back from the boundary, so a car waits off the road (m) */
    setback: number;
    /** a security cabin by the gate */
    cabin: boolean;
    style: 'sliding' | 'swing' | 'boom';
  };
  road: {
    /** an internal road's width (m), at least the fire tender's 6 m where it drives round */
    w: number;
    surface: 'asphalt' | 'pavers' | 'concrete' | 'grass-pavers';
    /** kerbs along its edges; a footpath each side (m; 0 none) */
    kerb: boolean; footpath: number;
    /** a light pole every so many metres (0 none) */
    poles: number;
    /** trees along it */
    trees: boolean;
  };
}
const KIT = (wall: Partial<SiteKit['wall']>, gate: Partial<SiteKit['gate']>, road: Partial<SiteKit['road']>): SiteKit => ({
  wall: { kind: 'solid', h: 1.5, plinth: 0.6, material: 'paint-offwhite', coping: true, piers: 3, ...wall },
  gate: { vehicle: 6, pedestrian: 1.2, separate: false, setback: 0, cabin: true, style: 'sliding', ...gate },
  road: { w: 7, surface: 'asphalt', kerb: true, footpath: 1.5, poles: 25, trees: true, ...road },
});
const KITS: Record<string, SiteKit> = {
  contemporary: KIT({ kind: 'railing', h: 1.8, plinth: 0.9, material: 'paint-grey' }, {}, {}),
  glass: KIT({ kind: 'railing', h: 2.1, plinth: 0.6, material: 'granite-grey-clad', piers: 4.5 }, { separate: true, setback: 6, style: 'boom' }, { w: 7.5, surface: 'pavers', footpath: 2 }),
  earth: KIT({ kind: 'solid', h: 1.5, material: 'brick-red' }, { style: 'swing' }, { surface: 'pavers' }),
  value: KIT({ kind: 'solid', h: 1.5, material: 'paint-cream', coping: false, piers: 0 }, { vehicle: 4.5, pedestrian: 1.0, cabin: false }, { w: 6, surface: 'concrete', kerb: false, footpath: 0, poles: 30, trees: false }),
  signature: KIT({ kind: 'railing', h: 2.1, plinth: 0.9, material: 'granite-flamed', piers: 4 }, { vehicle: 7.5, pedestrian: 1.5, separate: true, setback: 9, style: 'swing' }, { w: 7.5, surface: 'pavers', footpath: 2 }),
  fluid: KIT({ kind: 'hedge', h: 1.5 }, { separate: true, setback: 6, style: 'boom' }, { surface: 'pavers', footpath: 2 }),
  monolith: KIT({ kind: 'solid', h: 2.1, material: 'acp-white', piers: 0 }, { setback: 6 }, { surface: 'concrete' }),
  sculpted: KIT({ kind: 'hedge', h: 1.5 }, { vehicle: 7.5, separate: true, setback: 9, style: 'swing' }, { w: 7.5, surface: 'pavers', footpath: 2 }),
};
export const siteKitOf = (d: DesignSystem): SiteKit => d.site ?? KITS[d.id] ?? KIT({}, {}, {});
/** an internal road surface's colour */
export const SURFACE_COLOUR: Record<SiteKit['road']['surface'], string> = { asphalt: '#5b5e66', pavers: '#9a8f82', concrete: '#b5b2aa', 'grass-pavers': '#7f9a6c' };

/** a lamp's colour at a colour temperature (K), roughly */
export const kelvinColour = (k: number) => (k <= 2700 ? '#ffb46b' : k <= 3000 ? '#ffc58f' : k <= 3500 ? '#ffd6aa' : k <= 4000 ? '#ffe4c8' : '#fff4ea');

/** Climate elements, the shading and screening Indian buildings have always carried. */
export interface Climate {
  /** a chhajja, the sunshade over each window: how far it projects (m; 0 none) */
  chhajja: number;
  /** deeper on the faces the sun beats on (south and west), shallower to the north */
  orient: boolean;
  /** a jaali, a pierced screen, in front of the ventilators, or the smaller windows too */
  jaali: 'none' | 'vents' | 'windows';
}
const CLIMATES: Record<string, Climate> = {
  earth: { chhajja: 0.6, orient: false, jaali: 'none' },
  value: { chhajja: 0.45, orient: false, jaali: 'none' },
};
const NO_CLIMATE: Climate = { chhajja: 0, orient: false, jaali: 'none' };
/** A design system's climate elements: its own, else its preset's. */
export const climateOf = (d: DesignSystem): Climate => d.climate ?? CLIMATES[d.id] ?? NO_CLIMATE;
/** A face's bearing (degrees clockwise from north) from its outward normal in the plan, where −z is north before
 *  the plot is turned by `north` (degrees, as the project's p.north). */
export function bearingOf(nx: number, nz: number, north = 0): number {
  const n = (north * Math.PI) / 180;
  return (Math.atan2(nx * Math.cos(n) + nz * Math.sin(n), nx * Math.sin(n) - nz * Math.cos(n)) * 180) / Math.PI;
}
/** How deep a chhajja is on a face whose outward normal points `bearing` degrees clockwise from north: the full depth
 *  to the south, a little more to the west (the hot afternoon), about a third to the north. */
export function chhajjaOn(c: Climate, bearing: number): number {
  if (!c.orient) return c.chhajja;
  const r = (bearing * Math.PI) / 180, south = -Math.cos(r), west = -Math.sin(r);
  return c.chhajja * Math.max(0.3, Math.min(1.2, 0.65 + 0.35 * south + 0.2 * Math.max(0, west)));
}

/** target shares of the facade: walls, accent, base, glass (they should add to 1) */
export interface PaletteTargets { wall: number; accent: number; base: number; glass: number }
const PT = (wall: number, accent: number, base: number, glass: number): PaletteTargets => ({ wall, accent, base, glass });
/** each preset's palette: a dominant, a secondary and an accent, as guidelines write them */
const PALETTES: Record<string, PaletteTargets> = {
  contemporary: PT(0.6, 0.12, 0.05, 0.23), glass: PT(0.25, 0.1, 0.05, 0.6), earth: PT(0.55, 0.2, 0.05, 0.2),
  value: PT(0.7, 0.08, 0.02, 0.2), signature: PT(0.45, 0.2, 0.08, 0.27), fluid: PT(0.3, 0.25, 0.05, 0.4),
  monolith: PT(0.65, 0.05, 0.03, 0.27), sculpted: PT(0.35, 0.2, 0.05, 0.4),
};
/** A design system's palette targets: its own, else its preset's. */
export const paletteOf = (d: DesignSystem): PaletteTargets => d.palette ?? PALETTES[d.id] ?? PALETTES.contemporary;

export interface Language { skin: Skin; roof: RoofKind; round: number }

// ---------------------------------------------------------------- composition: zones, bays, entrance, corners
// How the facade is composed, the part of a design language that isn't materials: the building split into a base, a
// middle and a top, the middle set out on a rhythm of bays the windows snap to (so they line up across the flats and
// up the floors), how deep the openings sit, and the rules for the corners, the entrance and the crown. As design
// codes write it (Palo Alto's base, middle and top from 3 storeys up, bays about 3–5 m; window reveals about 75 mm
// and more), and as CityEngine's facade rules do. Each zone is drawn in one of the facade's three tones.
export type Tone = 'wall' | 'accent' | 'base';
/** free: windows spread flat by flat (as before); even: on the bay grid; paired: on the grid, drawn in twos */
export type Rhythm = 'free' | 'even' | 'paired';
/** plain: as any bay; solid: no openings in the end bays; glazed: glass wrapping the corner; accent: a pier in the accent */
export type Corner = 'plain' | 'solid' | 'glazed' | 'accent';
export type Entrance = 'none' | 'canopy' | 'portal';
/** parapet: the plain roof edge; cornice: a deep projecting band; pergola: a frame over the terrace */
export type Crown = 'parapet' | 'cornice' | 'pergola';
export interface Composition {
  /** the lowest floors (above any stilt), in their own tone with a string course over them */
  base: { floors: number; tone: Tone };
  /** the highest floors, in their own tone, and what finishes the building */
  top: { floors: number; tone: Tone; crown: Crown };
  /** bay width (m), the facade divided into equal bays as near this as fit */
  bay: number;
  rhythm: Rhythm;
  /** the bay lines drawn as shallow piers through the middle */
  piers: boolean;
  /** how far the window surrounds stand out from the wall (m): 0 none */
  reveal: number;
  corner: Corner;
  entrance: Entrance;
}
/** fewer storeys than this and the building is one zone (the codes ask for a base, middle and top from 3 up) */
export const ZONED_FROM = 3;
const CO = (base: [number, Tone], top: [number, Tone, Crown], bay: number, rhythm: Rhythm, piers: boolean, reveal: number, corner: Corner, entrance: Entrance): Composition =>
  ({ base: { floors: base[0], tone: base[1] }, top: { floors: top[0], tone: top[1], crown: top[2] }, bay, rhythm, piers, reveal, corner, entrance });
/** each preset's composition (kept apart from the presets so they read as before) */
const COMPOSITIONS: Record<string, Composition> = {
  contemporary: CO([1, 'base'], [1, 'accent', 'cornice'], 3.0, 'even', false, 0.1, 'plain', 'canopy'),
  glass: CO([2, 'base'], [1, 'accent', 'parapet'], 3.0, 'even', true, 0, 'glazed', 'portal'),
  earth: CO([1, 'base'], [1, 'accent', 'pergola'], 3.6, 'paired', false, 0.25, 'solid', 'portal'),
  value: CO([0, 'base'], [0, 'wall', 'parapet'], 3.0, 'free', false, 0, 'plain', 'canopy'),
  signature: CO([2, 'base'], [2, 'accent', 'pergola'], 3.6, 'even', true, 0.3, 'accent', 'portal'),
  fluid: CO([1, 'base'], [1, 'accent', 'cornice'], 3.0, 'even', true, 0, 'glazed', 'canopy'),
  monolith: CO([0, 'base'], [0, 'wall', 'cornice'], 3.6, 'even', false, 0.4, 'solid', 'portal'),
  sculpted: CO([2, 'base'], [1, 'accent', 'pergola'], 3.0, 'even', true, 0.15, 'glazed', 'portal'),
};
const NO_COMPOSITION = CO([0, 'base'], [0, 'wall', 'parapet'], 3.0, 'free', false, 0, 'plain', 'none');
/** A design system's composition: its own, else its preset's (designs saved before compositions had none). */
export const compositionOf = (d: DesignSystem): Composition => d.composition ?? COMPOSITIONS[d.id] ?? NO_COMPOSITION;
/** The zones of a building of `floors` storeys: how many base and top floors it actually gets (a short building has
 *  none; the middle always keeps at least one floor). */
export function zonesOf(c: Composition, floors: number): { base: number; top: number } {
  if (floors < ZONED_FROM) return { base: 0, top: 0 };
  const base = Math.min(c.base.floors, Math.floor((floors - 1) / 2));
  return { base, top: Math.max(0, Math.min(c.top.floors, floors - base - 1)) };
}

/** Room kinds that get a floor material of their own. */
export type FloorRoom = 'living' | 'bed' | 'kitchen' | 'toilet' | 'balcony' | 'common';
export const FLOOR_ROOMS: { key: FloorRoom; label: string }[] = [
  { key: 'living', label: 'Living and dining' }, { key: 'bed', label: 'Bedrooms' }, { key: 'kitchen', label: 'Kitchen' },
  { key: 'toilet', label: 'Toilets' }, { key: 'balcony', label: 'Balconies' }, { key: 'common', label: 'Lobbies and stairs' },
];
export interface Finish {
  wall: string; accent: string; base: string;
  flooring: Record<FloorRoom, string>;
  roof: string; railing: string;
}

const W = (tag: string, label: string, w: number, h: number, sill: number, kind: WindowType['kind']): WindowType => ({ tag, label, w, h, sill, kind });
const D = (tag: string, label: string, w: number, h: number, kind: DoorType['kind']): DoorType => ({ tag, label, w, h, kind });

export const PRESETS: DesignSystem[] = [
  {
    id: 'contemporary', name: 'Pune Contemporary', blurb: 'White render, black frames, glass balconies. The look most new Pune launches sell.',
    facade: { wall: '#eeece8', wallName: 'Off-white render', accent: '#3a3a3c', accentName: 'Charcoal bands', base: '#8b8b8e', bands: true, fins: false },
    glazing: { glass: '#5b7186', frame: '#1f1f21', frameName: 'Black aluminium' },
    windows: { W1: W('W1', 'Sliding window', 1.8, 1.35, 0.75, 'sliding'), W2: W('W2', 'Sliding window', 1.2, 1.2, 0.9, 'sliding'), V1: W('V1', 'Louvred ventilator', 0.6, 0.45, 2.0, 'louvre') },
    doors: { D1: D('D1', 'Main door, veneered', 1.0, 2.1, 'veneer'), D2: D('D2', 'Room door, flush', 0.9, 2.1, 'flush'), D3: D('D3', 'Toilet door, flush', 0.75, 2.1, 'flush'), SD: D('SD', 'Balcony sliding door', 2.1, 2.1, 'glass-sliding') },
    balcony: { kind: 'cantilever', depth: 1.5, railing: 'glass' },
    floorH: 3.0,
    spec: { flooring: 1, kitchen: 0, bath: 1, doors: 1, windows: 0, facade: 1, lifts: 0, amenities: 1 },
    premium: 0.08,
    finish: { wall: 'paint-offwhite', accent: 'paint-charcoal', base: 'paint-grey', flooring: { living: 'vit-800', bed: 'vit-800', kitchen: 'vit-600', toilet: 'ceramic-antiskid', balcony: 'vit-wood-look', common: 'granite-grey' }, roof: 'roof-mosaic', railing: 'rail-glass' },
  },
  {
    id: 'glass', name: 'Mumbai Glass Tower', blurb: 'Floor-to-ceiling glass, slim mullions, no balconies: the high-rise look.',
    facade: { wall: '#c9d1d8', wallName: 'Silver ACP', accent: '#7d8a96', accentName: 'Grey fins', base: '#4b5157', bands: false, fins: true },
    glazing: { glass: '#3d5a73', frame: '#8a939b', frameName: 'Anodised silver' },
    windows: { W1: W('W1', 'Full-height glazing', 2.4, 2.4, 0.15, 'fixed'), W2: W('W2', 'Full-height glazing, openable', 1.5, 2.4, 0.15, 'casement'), V1: W('V1', 'Louvred ventilator', 0.6, 0.6, 2.0, 'louvre') },
    doors: { D1: D('D1', 'Main door, veneered', 1.1, 2.4, 'veneer'), D2: D('D2', 'Room door, veneered', 0.9, 2.4, 'veneer'), D3: D('D3', 'Toilet door', 0.75, 2.4, 'flush'), SD: D('SD', 'Deck door', 1.5, 2.4, 'glass-sliding') },
    balcony: { kind: 'french', depth: 0.3, railing: 'glass' },
    floorH: 3.3,
    spec: { flooring: 2, kitchen: 2, bath: 2, doors: 2, windows: 2, facade: 2, lifts: 2, amenities: 2 },
    premium: 0.4,
    finish: { wall: 'acp-silver', accent: 'alu-fins-grey', base: 'slate', flooring: { living: 'marble-italian', bed: 'engineered-oak', kitchen: 'vit-marble-look', toilet: 'vit-matt-grey', balcony: 'vit-wood-look', common: 'marble-indian' }, roof: 'roof-cool', railing: 'rail-frameless' },
  },
  {
    id: 'earth', name: 'Warm Earth', blurb: 'Exposed-brick tones, timber-look frames, deep shaded balconies.',
    facade: { wall: '#d9c6ad', wallName: 'Sand render', accent: '#a65a3a', accentName: 'Terracotta brick', base: '#6f5443', bands: true, fins: true },
    glazing: { glass: '#55606a', frame: '#6b4a32', frameName: 'Woodgrain UPVC' },
    windows: { W1: W('W1', 'Casement window', 1.5, 1.5, 0.75, 'casement'), W2: W('W2', 'Casement window', 1.2, 1.2, 0.9, 'casement'), V1: W('V1', 'Ventilator', 0.6, 0.45, 2.0, 'louvre') },
    doors: { D1: D('D1', 'Main door, solid panel', 1.0, 2.1, 'panel'), D2: D('D2', 'Room door, panel', 0.9, 2.1, 'panel'), D3: D('D3', 'Toilet door', 0.75, 2.1, 'flush'), SD: D('SD', 'Balcony door, glazed', 1.8, 2.1, 'glass-sliding') },
    balcony: { kind: 'recessed', depth: 1.8, railing: 'ms' },
    floorH: 3.0,
    spec: { flooring: 1, kitchen: 1, bath: 1, doors: 1, windows: 1, facade: 1, lifts: 0, amenities: 1 },
    premium: 0.12,
    finish: { wall: 'paint-sand', accent: 'brick-red', base: 'sandstone-brown', flooring: { living: 'vit-800', bed: 'laminate-oak', kitchen: 'vit-matt-grey', toilet: 'ceramic-antiskid', balcony: 'ceramic-antiskid-dark', common: 'kota' }, roof: 'roof-clay', railing: 'rail-ms-black' },
  },
  {
    id: 'value', name: 'Value Housing', blurb: 'Lean and buildable: paint, MS railings, standard sizes, the base spec.',
    facade: { wall: '#ece3cf', wallName: 'Cream paint', accent: '#b9a27a', accentName: 'Beige bands', base: '#9a917f', bands: true, fins: false },
    glazing: { glass: '#6d7b86', frame: '#d8d8d4', frameName: 'White aluminium' },
    windows: { W1: W('W1', 'Sliding window', 1.5, 1.2, 0.9, 'sliding'), W2: W('W2', 'Sliding window', 1.0, 1.2, 0.9, 'sliding'), V1: W('V1', 'Ventilator', 0.6, 0.45, 2.0, 'louvre') },
    doors: { D1: D('D1', 'Main door, flush', 1.0, 2.1, 'flush'), D2: D('D2', 'Room door, flush', 0.9, 2.1, 'flush'), D3: D('D3', 'Toilet door, PVC', 0.75, 2.1, 'flush'), SD: D('SD', 'Balcony door', 1.2, 2.1, 'glass-sliding') },
    balcony: { kind: 'cantilever', depth: 1.2, railing: 'ms' },
    floorH: 2.9,
    spec: { flooring: 0, kitchen: 0, bath: 0, doors: 0, windows: 0, facade: 0, lifts: 0, amenities: 0 },
    premium: -0.06,
    finish: { wall: 'paint-cream', accent: 'paint-beige', base: 'paint-khaki', flooring: { living: 'vit-600', bed: 'vit-600', kitchen: 'vit-600', toilet: 'ceramic-antiskid', balcony: 'ceramic-antiskid', common: 'kota' }, roof: 'roof-mosaic', railing: 'rail-ms-black' },
  },
  {
    id: 'signature', name: 'Signature Luxury', blurb: 'Stone and bronze, wide openings, deep sit-out decks, the top spec.',
    facade: { wall: '#e4ddd2', wallName: 'Limestone cladding', accent: '#6e5a45', accentName: 'Bronze fins', base: '#3f3a35', bands: true, fins: true },
    glazing: { glass: '#3f4f5c', frame: '#5a4632', frameName: 'Bronze aluminium' },
    windows: { W1: W('W1', 'Lift-and-slide window', 2.4, 1.8, 0.45, 'sliding'), W2: W('W2', 'Sliding window', 1.5, 1.5, 0.75, 'sliding'), V1: W('V1', 'Ventilator', 0.6, 0.6, 2.0, 'louvre') },
    doors: { D1: D('D1', 'Main door, full-height veneered', 1.2, 2.4, 'veneer'), D2: D('D2', 'Room door, veneered', 0.9, 2.4, 'veneer'), D3: D('D3', 'Toilet door, veneered', 0.8, 2.4, 'veneer'), SD: D('SD', 'Deck door, lift-and-slide', 3.0, 2.4, 'glass-sliding') },
    balcony: { kind: 'cantilever', depth: 2.4, railing: 'glass' },
    floorH: 3.3,
    spec: { flooring: 2, kitchen: 2, bath: 2, doors: 2, windows: 2, facade: 2, lifts: 2, amenities: 2 },
    premium: 0.7,
    finish: { wall: 'limestone', accent: 'bronze-fins', base: 'granite-flamed', flooring: { living: 'marble-italian', bed: 'engineered-oak', kitchen: 'vit-1200', toilet: 'vit-marble-look', balcony: 'granite-grey', common: 'marble-italian' }, roof: 'roof-green', railing: 'rail-frameless' },
  },
];

// The three that speak a formed building's language first: inspired by Copenhagen's wavy fin blocks, a white
// monolith split by a glass slot, and twin towers wrapped in a fluted shell.
const SK = (pattern: SkinPattern, spacing: number, depth: number, glass: number, o: Partial<Skin> = {}): Skin => ({ pattern, spacing, depth, angle: 0, grade: 0, slabEdge: false, glass, ...o });
PRESETS.push(
  {
    id: 'fluid', name: 'Fluid', blurb: 'Deep bronze fins close together, the slab edges as bands: made for curved, wavy plans.',
    facade: { wall: '#b9a88a', wallName: 'ACP, champagne', accent: '#6e5a45', accentName: 'Bronze fins', base: '#3f3a35', bands: true, fins: true },
    glazing: { glass: '#4b4a44', frame: '#5a4632', frameName: 'Bronze aluminium' },
    windows: { W1: W('W1', 'Full-height glazing', 2.4, 2.4, 0.15, 'fixed'), W2: W('W2', 'Full-height glazing, openable', 1.2, 2.4, 0.15, 'casement'), V1: W('V1', 'Louvred ventilator', 0.6, 0.6, 2.0, 'louvre') },
    doors: { D1: D('D1', 'Main door, full-height veneered', 1.1, 2.4, 'veneer'), D2: D('D2', 'Room door, veneered', 0.9, 2.4, 'veneer'), D3: D('D3', 'Toilet door', 0.75, 2.4, 'flush'), SD: D('SD', 'Deck door', 1.8, 2.4, 'glass-sliding') },
    balcony: { kind: 'french', depth: 0.3, railing: 'glass' },
    floorH: 3.3,
    spec: { flooring: 2, kitchen: 2, bath: 1, doors: 1, windows: 2, facade: 2, lifts: 1, amenities: 2 },
    premium: 0.35,
    finish: { wall: 'acp-champagne', accent: 'bronze-fins', base: 'granite-flamed', flooring: { living: 'vit-marble-look', bed: 'engineered-oak', kitchen: 'vit-1200', toilet: 'vit-matt-grey', balcony: 'vit-wood-look', common: 'marble-indian' }, roof: 'roof-green', railing: 'rail-frameless' },
    language: { skin: SK('fins', 0.6, 0.7, 0.9, { grade: 0.25, slabEdge: true }), roof: 'flat', round: 1 },
  },
  {
    id: 'monolith', name: 'Monolith', blurb: 'White and solid, cut through by folded glass slots, the top tilted: a sculpture of a building.',
    facade: { wall: '#f1f1ef', wallName: 'ACP, white', accent: '#e4e4e0', accentName: 'White panel joints', base: '#8a8a8a', bands: false, fins: false },
    glazing: { glass: '#33414d', frame: '#d8d8d4', frameName: 'White aluminium' },
    windows: { W1: W('W1', 'Fixed glazing', 1.8, 2.1, 0.45, 'fixed'), W2: W('W2', 'Casement window', 1.0, 1.5, 0.75, 'casement'), V1: W('V1', 'Ventilator', 0.6, 0.45, 2.0, 'louvre') },
    doors: { D1: D('D1', 'Main door, veneered', 1.1, 2.4, 'veneer'), D2: D('D2', 'Room door, flush', 0.9, 2.4, 'flush'), D3: D('D3', 'Toilet door', 0.75, 2.4, 'flush'), SD: D('SD', 'Deck door', 1.8, 2.4, 'glass-sliding') },
    balcony: { kind: 'recessed', depth: 1.8, railing: 'glass' },
    floorH: 3.3,
    spec: { flooring: 2, kitchen: 1, bath: 2, doors: 1, windows: 2, facade: 2, lifts: 1, amenities: 1 },
    premium: 0.3,
    finish: { wall: 'acp-white', accent: 'acp-white', base: 'granite-grey-clad', flooring: { living: 'vit-1200', bed: 'engineered-oak', kitchen: 'vit-1200', toilet: 'vit-marble-look', balcony: 'vit-matt-grey', common: 'marble-italian' }, roof: 'roof-cool', railing: 'rail-frameless' },
    language: { skin: SK('curtain', 1.5, 0.05, 0), roof: 'tilted', round: 0.15 },
  },
  {
    id: 'sculpted', name: 'Sculpted', blurb: 'A fluted white shell standing off bronze glass floors ringed with balconies, rising past the roof.',
    facade: { wall: '#f4f3ef', wallName: 'White GRC fins', accent: '#6e5a45', accentName: 'Bronze rails and edges', base: '#4b5157', bands: true, fins: true },
    glazing: { glass: '#5e4b3a', frame: '#5a4632', frameName: 'Bronze aluminium' },
    windows: { W1: W('W1', 'Full-height glazing', 2.4, 2.4, 0.15, 'fixed'), W2: W('W2', 'Full-height glazing, openable', 1.5, 2.4, 0.15, 'casement'), V1: W('V1', 'Louvred ventilator', 0.6, 0.6, 2.0, 'louvre') },
    doors: { D1: D('D1', 'Main door, full-height veneered', 1.2, 2.4, 'veneer'), D2: D('D2', 'Room door, veneered', 0.9, 2.4, 'veneer'), D3: D('D3', 'Toilet door, veneered', 0.8, 2.4, 'veneer'), SD: D('SD', 'Deck door, lift-and-slide', 3.0, 2.4, 'glass-sliding') },
    balcony: { kind: 'cantilever', depth: 1.8, railing: 'glass' },
    floorH: 3.3,
    spec: { flooring: 2, kitchen: 2, bath: 2, doors: 2, windows: 2, facade: 2, lifts: 2, amenities: 2 },
    premium: 0.6,
    finish: { wall: 'paint-white', accent: 'bronze-fins', base: 'slate', flooring: { living: 'marble-italian', bed: 'engineered-oak', kitchen: 'vit-marble-look', toilet: 'vit-marble-look', balcony: 'vit-wood-look', common: 'marble-italian' }, roof: 'roof-green', railing: 'rail-frameless' },
    language: { skin: SK('balconies', 0.7, 1.8, 0.95, { grade: 0.4, slabEdge: true }), roof: 'flat', round: 1 },
  },
);

export const presetOf = (id: string) => PRESETS.find((p) => p.id === id) ?? PRESETS[0];

/** The design language a design system speaks: its own, else one derived from its facade and balconies (fins
 *  become fins, floor bands bands, balconies balcony rings; the glass from its main window's share of a bay). The
 *  older presets carry none and are read this way, so they keep looking like themselves on a formed building. */
export function languageOf(ds: DesignSystem): Language {
  if (ds.language) return ds.language;
  const W1 = ds.windows.W1, glass = Math.max(0.3, Math.min(0.92, (W1.w * W1.h) / (3.2 * ds.floorH) + (W1.sill < 0.3 ? 0.25 : 0)));
  const bal = ds.balcony.kind === 'cantilever' && ds.balcony.depth >= 1;
  const tall = W1.h >= 2.2;
  let skin: Skin;
  if (ds.facade.fins && tall) skin = SK('curtain', 1.5, 0.35, Math.max(glass, 0.85), { slabEdge: ds.facade.bands });
  else if (ds.facade.fins) skin = SK('fins', 1.2, 0.45, glass, { slabEdge: ds.facade.bands, grade: 0.15 });
  else if (bal) skin = SK('balconies', 1.5, ds.balcony.depth, glass, { slabEdge: ds.facade.bands });
  else if (ds.facade.bands) skin = SK('bands', 1.5, 0.15, glass);
  else skin = SK('grid', 3, 0.2, glass);
  // (a stone-and-brick look likes a pitched roof; the rest a flat terrace)
  const roof = ds.finish?.roof === 'roof-clay' ? 'hip' : 'flat';
  return { skin, roof, round: ds.facade.fins && tall ? 0.6 : 0.25 };
}

/** The skin patterns and roof kinds, in the pickers' order. */
export const SKIN_PATTERNS: SkinPattern[] = ['grid', 'fins', 'louvres', 'bands', 'diagrid', 'screen', 'curtain', 'balconies'];
export const ROOF_KINDS: RoofKind[] = ['flat', 'mono', 'gable', 'hip', 'barrel', 'tilted', 'dome', 'crown'];
export const clone = (d: DesignSystem): DesignSystem => JSON.parse(JSON.stringify(d));

/** What the specification adds to construction (₹ / sq ft of built-up area). */
export const specRate = (d: DesignSystem) => SPEC.reduce((s, c) => s + (c.options[d.spec[c.key] ?? 0]?.rate ?? 0), 0);
/** the specification lines the finishes now price (their materials, ./materials.ts): left out of the rate */
export const FINISHED = ['flooring', 'facade'];
/** the specification's extras less the lines the finishes price, ₹ per sq ft of built-up */
export const specRateNet = (d: DesignSystem) => SPEC.reduce((s, c) => s + (FINISHED.includes(c.key) ? 0 : c.options[d.spec[c.key] ?? 0]?.rate ?? 0), 0);

/** Share of a window's or door's area that opens (for ventilation). */
export const openable = (kind: WindowType['kind'] | DoorType['kind']) => (kind === 'fixed' ? 0 : kind === 'sliding' || kind === 'glass-sliding' ? 0.5 : kind === 'louvre' ? 0.8 : 1);

// ---------------------------------------------------------------- finishes (materials)
/** The finish of a design system: its own, else its preset's (designs saved before materials had none). */
export const finishOf = (d: DesignSystem): Finish => d.finish ?? presetOf(d.id).finish ?? PRESETS[0].finish!;

export type FacadeSlot = 'wall' | 'accent' | 'base';
export type FinishSlot = FacadeSlot | 'roof' | 'railing' | FloorRoom;

/** Set a surface's material on a design system (mutates `d`; use on a clone). The facade slots also set the colour
 *  the 3D reads (and the wall's and accent's names); a railing also sets the balcony's railing kind. */
export function setFinish(d: DesignSystem, slot: FinishSlot, id: string) {
  const f: Finish = d.finish = JSON.parse(JSON.stringify(finishOf(d)));
  const m = materialOf(id);
  if (slot === 'wall') { f.wall = id; d.facade.wall = m.colour; d.facade.wallName = m.name; }
  else if (slot === 'accent') { f.accent = id; d.facade.accent = m.colour; d.facade.accentName = m.name; }
  else if (slot === 'base') { f.base = id; d.facade.base = m.colour; }
  else if (slot === 'roof') f.roof = id;
  else if (slot === 'railing') { f.railing = id; if (m.railKind) d.balcony.railing = m.railKind; }
  else f.flooring[slot] = id;
}

/** How much of each surface there is per m² of built-up area: rough figures for a mid-rise residential block (about
 *  0.85 m² of outside wall per m² built, a third of it windows; carpet about 85 % of built-up; a roof over about 12
 *  floors; balcony railings along the front). Replace with take-offs from the model when it has them. */
export const FINISH_QTY: Record<FinishSlot, number> = {
  wall: 0.45, accent: 0.15, base: 0.04,
  living: 0.22, bed: 0.26, kitchen: 0.07, toilet: 0.07, balcony: 0.05, common: 0.1,
  roof: 0.08, railing: 0.04,
};
/** The plain finishes a construction rate already includes: finishRate is what the chosen ones add over these. */
export const FINISH_BASELINE: Finish = {
  wall: 'paint-offwhite', accent: 'paint-offwhite', base: 'paint-offwhite',
  flooring: { living: 'vit-600', bed: 'vit-600', kitchen: 'vit-600', toilet: 'ceramic-antiskid', balcony: 'ceramic-antiskid', common: 'kota' },
  roof: 'roof-mosaic', railing: 'rail-ms-black',
};
const slotId = (f: Finish, s: FinishSlot) => (s === 'wall' || s === 'accent' || s === 'base' || s === 'roof' || s === 'railing' ? f[s] : f.flooring[s]);

/** measured quantities (m² per m² of built-up) that replace FINISH_QTY's figures for the slots they name: the facade's
 *  tones from the model's take-off (./palette.ts) */
export type FinishQty = Partial<Record<FinishSlot, number>>;

/** Surface by surface: the material, its quantity (m² per m² of built-up: measured where `qty` has it, else the rule
 *  of thumb) and what it adds over the plain finish (₹ per m² of built-up). */
export function finishBreakdown(d: DesignSystem, qty: FinishQty = {}): { slot: FinishSlot; material: Material; qty: number; extra: number; measured: boolean }[] {
  const f = finishOf(d);
  return (Object.keys(FINISH_QTY) as FinishSlot[]).map((slot) => {
    const material = materialOf(slotId(f, slot)), base = materialOf(slotId(FINISH_BASELINE, slot));
    const measured = qty[slot] !== undefined, q = qty[slot] ?? FINISH_QTY[slot];
    return { slot, material, qty: q, extra: q * (material.rate - base.rate), measured };
  });
}

/** What the chosen finishes add to construction over plain ones (paint, 600 vitrified, anti-skid ceramic, Kota in the
 *  lobbies, china mosaic on the roof, MS railings), ₹ per sq ft of built-up area, rounded: the same unit as
 *  `specRate`, so it can be added to it. Σ (material rate − plain rate) × quantity per m² built (FINISH_QTY), ÷ 10.7639.
 *  Can be a little negative when a surface is cheaper than plain. Note SPEC's 'flooring' and 'facade' lines price the
 *  same surfaces as a coarse choice: add this instead of them, not on top, once Money uses it. */
export const finishRate = (d: DesignSystem, qty: FinishQty = {}) => Math.round(finishBreakdown(d, qty).reduce((s, x) => s + x.extra, 0) / 10.7639);

/** The finishes' addition to the cost of a scheme (₹), from its built-up area (m²). */
export const finishCost = (d: DesignSystem, buaM2: number, qty: FinishQty = {}) => finishRate(d, qty) * buaM2 * 10.7639;

// ---------------------------------------------------------------- styles that build on the presets
/** an object with `over` laid on it, key by key, objects merged, the rest replaced */
function merge<T>(base: T, over: unknown): T {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over as T;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(over)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' ? merge(out[k], v) : v;
  return out as T;
}
type Over = { [K in keyof DesignSystem]?: NonNullable<DesignSystem[K]> extends object ? Partial<NonNullable<DesignSystem[K]>> : DesignSystem[K] };
/** A style built on another: the parent's every token (its composition, palette and climate made explicit), with
 *  `over` changed, and the facade colours following the materials named in `over.finish`. */
export function derive(parentId: string, over: Over & { id: string; name: string; blurb: string }): DesignSystem {
  const p = PRESETS.find((x) => x.id === parentId)!;
  const full: DesignSystem = { ...clone(p), composition: compositionOf(p), palette: paletteOf(p), climate: climateOf(p), lighting: lightingOf(p), signage: signageOf(p), landscape: landscapeOf(p), site: siteKitOf(p), finish: finishOf(p), origin: undefined };
  const d = merge(full, { ...over, basedOn: parentId });
  const f = d.finish!;
  for (const s of ['wall', 'accent', 'base'] as const) if ((over.finish as Partial<Finish> | undefined)?.[s]) setFinish(d, s, f[s]);
  return d;
}

/** the styles of Indian architecture, in Start from's own group */
export const STYLE_IDS = ['bombay-deco', 'indo-saracenic', 'chandigarh', 'courtyard', 'brick-vernacular', 'tropical'];
PRESETS.push(
  derive('contemporary', {
    id: 'bombay-deco', name: 'Bombay Deco', blurb: 'Marine Drive’s Art Deco: cream and ochre, eyebrow sunshades over every window, deco piers, a stepped cornice.',
    finish: { wall: 'paint-cream', accent: 'paint-ochre', base: 'sandstone-beige' },
    facade: { bands: true, fins: false },
    windows: { W1: W('W1', 'Casement window', 1.5, 1.5, 0.75, 'casement'), W2: W('W2', 'Casement window', 1.0, 1.35, 0.9, 'casement') },
    balcony: { kind: 'cantilever', depth: 1.2, railing: 'ms' },
    composition: CO([1, 'base'], [1, 'accent', 'cornice'], 3.0, 'even', true, 0.1, 'accent', 'portal'),
    palette: PT(0.62, 0.18, 0.06, 0.14),
    climate: { chhajja: 0.6, orient: false, jaali: 'none' },
    lighting: { facade: 'lines', kelvin: 2700, shielded: true }, signage: { kind: 'letters', h: 0.6, cap: 0.1 },
  }),
  derive('earth', {
    id: 'indo-saracenic', name: 'Indo-Saracenic', blurb: 'Sandstone over a basalt base, jaali screens and deep chhajjas, a pavilion crown: Bombay’s 19th-century civic look.',
    finish: { wall: 'sandstone-beige', accent: 'paint-terracotta', base: 'basalt', railing: 'rail-parapet' },
    balcony: { kind: 'recessed', depth: 1.5, railing: 'solid' },
    composition: CO([2, 'base'], [1, 'accent', 'pergola'], 3.6, 'paired', true, 0.3, 'accent', 'portal'),
    palette: PT(0.52, 0.18, 0.15, 0.15),
    climate: { chhajja: 0.75, orient: false, jaali: 'windows' },
    lighting: { facade: 'wash', kelvin: 2700, shielded: true }, landscape: { trees: 'dense', hedge: true, planters: false },
  }),
  derive('earth', {
    id: 'chandigarh', name: 'Chandigarh Modern', blurb: 'Brick infill in a concrete frame, deep brise-soleil turned to the sun, pilotis: Chandigarh’s modernism.',
    finish: { wall: 'brick-red', accent: 'concrete-fair', base: 'concrete-fair' },
    facade: { bands: true, fins: true },
    glazing: { frame: '#3a3a3c', frameName: 'Steel, painted' },
    balcony: { kind: 'recessed', depth: 1.8, railing: 'solid' },
    composition: CO([0, 'base'], [1, 'accent', 'cornice'], 3.0, 'even', true, 0.45, 'plain', 'canopy'),
    palette: PT(0.42, 0.33, 0.05, 0.2),
    climate: { chhajja: 0.9, orient: true, jaali: 'vents' },
  }),
  derive('contemporary', {
    id: 'courtyard', name: 'Courtyard Modern', blurb: 'White walls, deep shaded verandahs, a pergola over the terrace, few small windows: after Charles Correa.',
    finish: { wall: 'paint-white', accent: 'paint-terracotta', base: 'sandstone-beige', railing: 'rail-parapet' },
    facade: { bands: false, fins: false },
    windows: { W1: W('W1', 'Casement window', 1.2, 1.5, 0.75, 'casement'), W2: W('W2', 'Casement window', 0.9, 1.2, 0.9, 'casement') },
    balcony: { kind: 'recessed', depth: 2.4, railing: 'solid' },
    composition: CO([1, 'base'], [1, 'wall', 'pergola'], 3.6, 'paired', false, 0.2, 'solid', 'canopy'),
    palette: PT(0.66, 0.1, 0.06, 0.18),
    climate: { chhajja: 0.6, orient: true, jaali: 'none' },
    landscape: { trees: 'dense', hedge: true, planters: true },
  }),
  derive('earth', {
    id: 'brick-vernacular', name: 'Brick Vernacular', blurb: 'Exposed brick, jaali walls for light and air, deep sunshades, clay tiles: after Laurie Baker.',
    finish: { wall: 'brick-red', accent: 'brick-tile', base: 'basalt', roof: 'roof-clay', railing: 'rail-ms-black' },
    facade: { bands: false, fins: false },
    composition: CO([0, 'base'], [0, 'wall', 'parapet'], 3.0, 'free', false, 0.1, 'plain', 'canopy'),
    palette: PT(0.72, 0.08, 0.05, 0.15),
    climate: { chhajja: 0.75, orient: true, jaali: 'windows' },
    landscape: { trees: 'dense', hedge: false, planters: true }, lighting: { facade: 'none', kelvin: 2700, shielded: true },
  }),
  derive('contemporary', {
    id: 'tropical', name: 'Tropical Modern', blurb: 'White walls and teak, wide balconies under deep overhangs, a pergola roof: after Geoffrey Bawa.',
    finish: { wall: 'paint-white', accent: 'wpc-teak', base: 'basalt' },
    facade: { bands: true, fins: false },
    glazing: { frame: '#5a4632', frameName: 'Teak-finish aluminium' },
    balcony: { kind: 'cantilever', depth: 2.1, railing: 'ms' },
    composition: CO([1, 'base'], [1, 'accent', 'pergola'], 3.6, 'even', false, 0, 'plain', 'canopy'),
    palette: PT(0.56, 0.16, 0.05, 0.23),
    climate: { chhajja: 1.0, orient: true, jaali: 'none' },
    landscape: { trees: 'dense', hedge: true, planters: true }, lighting: { facade: 'grazing', kelvin: 2700, shielded: true },
  }),
);
