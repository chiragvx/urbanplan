// The material library: what a building's surfaces are finished in. Generic materials for now (a colour, a finish,
// a surface pattern and a rough Indian market rate), as data, so real products (a maker's tile, paint shade or
// cladding panel) can be added later as more entries with `product` filled in, without changing anything that uses
// them. A design system (./design.ts `finish`) refers to materials by id only.

export type MaterialCategory =
  | 'paint' | 'cladding' | 'stone' | 'brick' | 'glass' | 'metal' | 'wood'
  | 'tile' | 'flooring' | 'roofing' | 'railing';
export type MaterialFinish = 'matt' | 'satin' | 'gloss' | 'textured';
/** How the surface reads at a distance: drawn by the swatches and the facade preview. */
export type MaterialPattern = 'plain' | 'brick' | 'stone' | 'plank' | 'tile' | 'stripe' | 'louvre';

/** A real product a material can stand for (not used yet: every generic material leaves it undefined).
 *  - maker: the brand ("Asian Paints", "Kajaria", "Alstrong")
 *  - sku: the maker's code or shade number
 *  - url: the product page
 *  - image: a photo or a tileable texture (a URL; the swatch and preview can use it as an SVG <image> pattern)
 *  - specSheet: the technical data sheet (a URL to a PDF) */
export interface MaterialProduct { maker: string; sku: string; url: string; image: string; specSheet: string }

export interface Material {
  /** stable: saved design systems refer to it. A real product would take an id like 'kajaria:k-1234'. */
  id: string;
  category: MaterialCategory;
  name: string;
  /** the colour it reads as, a hex: the 3D and the preview use it */
  colour: string;
  finish: MaterialFinish;
  pattern?: MaterialPattern;
  /** supplied and fixed, ₹ per m² of the surface (rough market figures; put in your own) */
  rate: number;
  /** a railing's kind, for the 3D (glass panes, steel bars, or a solid parapet): railings only */
  railKind?: 'glass' | 'ms' | 'solid';
  product?: MaterialProduct;
}

const M = (id: string, category: MaterialCategory, name: string, colour: string, finish: MaterialFinish, rate: number, pattern: MaterialPattern = 'plain', extra?: Partial<Material>): Material =>
  ({ id, category, name, colour, finish, pattern, rate, ...extra });

export const MATERIALS: Material[] = [
  // ---- exterior paint (two coats of acrylic emulsion on primer; texture is a trowelled or rolled coat)
  M('paint-white', 'paint', 'Brilliant white acrylic', '#f4f3ef', 'matt', 240),
  M('paint-offwhite', 'paint', 'Off-white acrylic', '#eeece8', 'matt', 240),
  M('paint-cream', 'paint', 'Cream acrylic', '#ece3cf', 'matt', 240),
  M('paint-sand', 'paint', 'Sand texture paint', '#d9c6ad', 'textured', 520),
  M('paint-beige', 'paint', 'Beige acrylic', '#b9a27a', 'matt', 240),
  M('paint-khaki', 'paint', 'Khaki texture paint', '#9a917f', 'textured', 520),
  M('paint-warmgrey', 'paint', 'Warm grey acrylic', '#b8b2a7', 'matt', 240),
  M('paint-grey', 'paint', 'Grey texture paint', '#8b8b8e', 'textured', 520),
  M('paint-charcoal', 'paint', 'Charcoal acrylic', '#3a3a3c', 'satin', 260),
  M('paint-black', 'paint', 'Black satin', '#1f1f21', 'satin', 280),
  M('paint-terracotta', 'paint', 'Terracotta acrylic', '#b5603c', 'matt', 260),
  M('paint-ochre', 'paint', 'Ochre acrylic', '#c99a3b', 'matt', 260),
  M('paint-sage', 'paint', 'Sage acrylic', '#8f9e86', 'matt', 260),
  M('paint-teal', 'paint', 'Deep teal acrylic', '#2f6a6a', 'satin', 280),
  M('paint-indigo', 'paint', 'Indigo acrylic', '#34406b', 'satin', 280),

  // ---- cladding (on a frame: aluminium composite panels, fibre-cement boards, terracotta)
  M('acp-silver', 'cladding', 'ACP, silver metallic', '#c9d1d8', 'satin', 3800, 'tile'),
  M('acp-white', 'cladding', 'ACP, white', '#f1f1ef', 'gloss', 3600, 'tile'),
  M('acp-grey', 'cladding', 'ACP, dark grey', '#5d6266', 'satin', 3800, 'tile'),
  M('acp-champagne', 'cladding', 'ACP, champagne', '#b9a88a', 'satin', 4000, 'tile'),
  M('fibre-cement', 'cladding', 'Fibre-cement board', '#a7a59f', 'matt', 2400, 'tile'),
  M('concrete-fair', 'cladding', 'Fair-faced concrete', '#a9a7a1', 'matt', 1800, 'tile'),
  M('terracotta-panel', 'cladding', 'Terracotta panels', '#b0623f', 'matt', 5500, 'plank'),
  M('terracotta-louvre', 'cladding', 'Terracotta louvres', '#b1633f', 'matt', 7500, 'louvre'),

  // ---- stone (dry-clad or fixed in mortar)
  M('limestone', 'stone', 'Limestone cladding', '#e4ddd2', 'matt', 6500, 'stone'),
  M('sandstone-beige', 'stone', 'Beige sandstone', '#d6bf96', 'textured', 4200, 'stone'),
  M('sandstone-brown', 'stone', 'Brown sandstone', '#6f5443', 'textured', 4200, 'stone'),
  M('jaisalmer', 'stone', 'Jaisalmer yellow stone', '#d8b46a', 'matt', 4500, 'stone'),
  M('basalt', 'stone', 'Basalt, rough dressed', '#3e3d3b', 'textured', 3000, 'stone'),
  M('slate', 'stone', 'Slate', '#4b5157', 'textured', 3800, 'stone'),
  M('granite-flamed', 'stone', 'Black granite, flamed', '#3f3a35', 'textured', 5000, 'stone'),
  M('granite-grey-clad', 'stone', 'Grey granite cladding', '#8a8a8a', 'satin', 4000, 'stone'),

  // ---- brick (exposed, or brick tiles on a plastered wall)
  M('brick-red', 'brick', 'Exposed wire-cut brick', '#a65a3a', 'textured', 1600, 'brick'),
  M('brick-tile', 'brick', 'Brick tile cladding', '#9e5236', 'textured', 2000, 'brick'),
  M('brick-grey', 'brick', 'Grey brick slips', '#8d8780', 'textured', 2100, 'brick'),

  // ---- glass (curtain wall and structural glazing)
  M('glass-clear', 'glass', 'Curtain wall, clear blue', '#5b7186', 'gloss', 14000, 'tile'),
  M('glass-grey', 'glass', 'Structural glazing, grey', '#3d5a73', 'gloss', 16000, 'tile'),
  M('glass-bronze', 'glass', 'Reflective glass, bronze', '#5e4b3a', 'gloss', 15000, 'tile'),
  M('glass-spandrel', 'glass', 'Spandrel glass, opaque', '#2b3640', 'gloss', 9000, 'tile'),

  // ---- metal (fins, screens, panels)
  M('alu-fins-grey', 'metal', 'Aluminium fins, grey', '#7d8a96', 'satin', 6000, 'louvre'),
  M('alu-fins-silver', 'metal', 'Aluminium fins, silver', '#a7adb3', 'satin', 6000, 'louvre'),
  M('bronze-fins', 'metal', 'Bronze anodised fins', '#6e5a45', 'satin', 7500, 'louvre'),
  M('corten', 'metal', 'Corten-look steel', '#7a3e22', 'textured', 8000, 'stripe'),
  M('perforated-black', 'metal', 'Perforated screen, black', '#262628', 'matt', 4500, 'stripe'),

  // ---- wood-look (outdoor-rated)
  M('wpc-teak', 'wood', 'WPC boards, teak', '#8a5a3c', 'matt', 4800, 'plank'),
  M('hpl-walnut', 'wood', 'HPL panels, walnut', '#5c3d2a', 'satin', 6500, 'plank'),
  M('hpl-cedar', 'wood', 'HPL panels, cedar', '#b07d4f', 'satin', 6500, 'plank'),

  // ---- tiles (floors and walls; laid, with adhesive and grout)
  M('vit-600', 'tile', 'Vitrified tiles 600 × 600', '#e8e4dc', 'gloss', 1100, 'tile'),
  M('vit-800', 'tile', 'Vitrified tiles 800 × 800', '#e3ded4', 'gloss', 1500, 'tile'),
  M('vit-1200', 'tile', 'Vitrified slabs 1200 × 1200', '#ece9e3', 'gloss', 2200, 'tile'),
  M('vit-marble-look', 'tile', 'Marble-look slabs 800 × 1600', '#efebe4', 'gloss', 2600, 'tile'),
  M('vit-wood-look', 'tile', 'Wood-look tile planks', '#a07a55', 'matt', 1600, 'plank'),
  M('vit-matt-grey', 'tile', 'Matt vitrified, grey', '#9a958d', 'matt', 1000, 'tile'),
  M('ceramic-antiskid', 'tile', 'Anti-skid ceramic 300 × 300', '#c9c2b6', 'matt', 750, 'tile'),
  M('ceramic-antiskid-dark', 'tile', 'Anti-skid ceramic, dark', '#7c766d', 'matt', 750, 'tile'),

  // ---- other floors
  M('marble-italian', 'flooring', 'Italian marble', '#efece6', 'gloss', 7500, 'stone'),
  M('marble-indian', 'flooring', 'Indian white marble', '#e6e2d9', 'gloss', 4000, 'stone'),
  M('granite-black', 'flooring', 'Black granite, polished', '#2c2c2e', 'gloss', 3200, 'stone'),
  M('granite-grey', 'flooring', 'Grey granite, polished', '#8d8b88', 'gloss', 2600, 'stone'),
  M('kota', 'flooring', 'Kota stone', '#7d8478', 'matt', 1400, 'stone'),
  M('laminate-oak', 'flooring', 'Wooden laminate, oak', '#b08a62', 'satin', 1300, 'plank'),
  M('engineered-oak', 'flooring', 'Engineered oak', '#c19a6b', 'satin', 5500, 'plank'),
  M('ips-concrete', 'flooring', 'Polished concrete (IPS)', '#a3a29e', 'satin', 900),

  // ---- roofs (the terrace: waterproofing and its top)
  M('roof-mosaic', 'roofing', 'Waterproofing, china mosaic', '#f0efe9', 'gloss', 1100, 'tile'),
  M('roof-clay', 'roofing', 'Waterproofing, clay tiles', '#b5653f', 'matt', 1500, 'tile'),
  M('roof-cool', 'roofing', 'Waterproofing, cool-roof coat', '#f6f6f2', 'matt', 800),
  M('roof-pavers', 'roofing', 'Terrace deck, pavers', '#b9b3a8', 'textured', 2400, 'tile'),
  M('roof-green', 'roofing', 'Green roof', '#5f7d43', 'textured', 4500),

  // ---- railings (₹ per m² of the railing's face, about 1.1 m tall)
  M('rail-glass', 'railing', 'Toughened glass, steel rail', '#b9d0d6', 'gloss', 9000, 'plain', { railKind: 'glass' }),
  M('rail-frameless', 'railing', 'Frameless glass', '#c4d9de', 'gloss', 13000, 'plain', { railKind: 'glass' }),
  M('rail-ms-black', 'railing', 'MS railing, black', '#262628', 'satin', 3500, 'stripe', { railKind: 'ms' }),
  M('rail-ms-white', 'railing', 'MS railing, white', '#e9e9e6', 'satin', 3500, 'stripe', { railKind: 'ms' }),
  M('rail-ss', 'railing', 'Stainless steel balusters', '#b3b6b9', 'satin', 6500, 'stripe', { railKind: 'ms' }),
  M('rail-perforated', 'railing', 'Perforated metal panel', '#3a3a3c', 'matt', 5500, 'plain', { railKind: 'solid' }),
  M('rail-parapet', 'railing', 'Solid parapet, plastered', '#eeece8', 'matt', 1800, 'plain', { railKind: 'solid' }),
];

const BY_ID = new Map(MATERIALS.map((m) => [m.id, m]));

/** A material by id; an unknown id (a product since removed, a typo) falls back to a plain grey paint so nothing
 *  breaks, and `known` says whether it was found. */
const UNKNOWN: Material = M('unknown', 'paint', 'Unknown material', '#9a9a9a', 'matt', 0);
export const materialOf = (id: string | undefined): Material => (id && BY_ID.get(id)) || UNKNOWN;
export const known = (id: string | undefined) => !!id && BY_ID.has(id);

/** The materials of one category, or of several (in the order given). */
export const byCategory = (cat: MaterialCategory | MaterialCategory[]): Material[] =>
  (Array.isArray(cat) ? cat : [cat]).flatMap((c) => MATERIALS.filter((m) => m.category === c));

export const CATEGORY_LABEL: Record<MaterialCategory, string> = {
  paint: 'Paint', cladding: 'Cladding', stone: 'Stone', brick: 'Brick', glass: 'Glass', metal: 'Metal', wood: 'Wood-look',
  tile: 'Tiles', flooring: 'Stone and wood floors', roofing: 'Roof', railing: 'Railing',
};

/** Which categories each surface draws from. */
export const SLOT_CATEGORIES = {
  wall: ['paint', 'cladding', 'stone', 'brick', 'glass', 'wood'],
  accent: ['paint', 'metal', 'cladding', 'wood', 'brick', 'stone'],
  base: ['stone', 'paint', 'brick', 'cladding', 'tile'],
  floor: ['tile', 'flooring'],
  roof: ['roofing'],
  railing: ['railing'],
} satisfies Record<string, MaterialCategory[]>;
