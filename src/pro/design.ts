// The builder's design system: one place that says what every building in a project is made of and looks like.
// The facade's materials and colours, the glazing, the window and door catalog (the D / W / V schedule Indian
// drawings use), the balconies, the floor height and the specification sold with the flats. Pick a preset, change
// any token, and every building, the 3D view, the schedule, the light check and the cost follow it.
// `finish` names the materials (./materials.ts) of each surface: the facade, the floors room by room, the roof and
// the railings. Picking a facade material also sets the matching `facade` colour, which is what the 3D reads.
import { materialOf, type Material } from './materials';

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
}

export interface Language { skin: import('./form/types').Skin; roof: import('./form/types').RoofKind; round: number }

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

export const presetOf = (id: string) => PRESETS.find((p) => p.id === id) ?? PRESETS[0];
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

/** Surface by surface: the material, its quantity (m² per m² of built-up) and what it adds over the plain finish
 *  (₹ per m² of built-up). */
export function finishBreakdown(d: DesignSystem): { slot: FinishSlot; material: Material; qty: number; extra: number }[] {
  const f = finishOf(d);
  return (Object.keys(FINISH_QTY) as FinishSlot[]).map((slot) => {
    const material = materialOf(slotId(f, slot)), base = materialOf(slotId(FINISH_BASELINE, slot));
    return { slot, material, qty: FINISH_QTY[slot], extra: FINISH_QTY[slot] * (material.rate - base.rate) };
  });
}

/** What the chosen finishes add to construction over plain ones (paint, 600 vitrified, anti-skid ceramic, Kota in the
 *  lobbies, china mosaic on the roof, MS railings), ₹ per sq ft of built-up area, rounded: the same unit as
 *  `specRate`, so it can be added to it. Σ (material rate − plain rate) × quantity per m² built (FINISH_QTY), ÷ 10.7639.
 *  Can be a little negative when a surface is cheaper than plain. Note SPEC's 'flooring' and 'facade' lines price the
 *  same surfaces as a coarse choice: add this instead of them, not on top, once Money uses it. */
export const finishRate = (d: DesignSystem) => Math.round(finishBreakdown(d).reduce((s, x) => s + x.extra, 0) / 10.7639);

/** The finishes' addition to the cost of a scheme (₹), from its built-up area (m²). */
export const finishCost = (d: DesignSystem, buaM2: number) => finishRate(d) * buaM2 * 10.7639;
