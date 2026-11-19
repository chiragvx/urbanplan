// The builder's design system: one place that says what every building in a project is made of and looks like.
// The facade's materials and colours, the glazing, the window and door catalog (the D / W / V schedule Indian
// drawings use), the balconies, the floor height and the specification sold with the flats. Pick a preset, change
// any token, and every building, the 3D view, the schedule, the light check and the cost follow it.

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
  },
];

export const presetOf = (id: string) => PRESETS.find((p) => p.id === id) ?? PRESETS[0];
export const clone = (d: DesignSystem): DesignSystem => JSON.parse(JSON.stringify(d));

/** What the specification adds to construction (₹ / sq ft of built-up area). */
export const specRate = (d: DesignSystem) => SPEC.reduce((s, c) => s + (c.options[d.spec[c.key] ?? 0]?.rate ?? 0), 0);

/** Share of a window's or door's area that opens (for ventilation). */
export const openable = (kind: WindowType['kind'] | DoorType['kind']) => (kind === 'fixed' ? 0 : kind === 'sliding' || kind === 'glass-sliding' ? 0.5 : kind === 'louvre' ? 0.8 : 1);
