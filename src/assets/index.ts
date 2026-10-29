// The asset registry (built-in catalogue + the user's saved assets) and the document side of building one:
// the layer it lives in, the line it becomes, and reading an object back to its asset.
import { BUILTIN, LAYERS, TAB_ORDER } from './catalog';
import { assetWidth, channelTop, type AssetDef, type Category, type LayerDef, type Profile } from './model';
import { settings, saveSettings } from '../editor/state';
import type { CityDoc } from '../doc/doc';
import type { Id, LayerObj, LineObj, SectionObj } from '../doc/types';
import { newId } from '../doc/ids';

export * from './model';
export { LAYERS };

const byId = new Map(BUILTIN.map((a) => [a.id, a]));

export function customAssets(): AssetDef[] { return (settings.value.customAssets ?? []) as AssetDef[]; }

export function allAssets(): AssetDef[] { return [...BUILTIN, ...customAssets()]; }

export function getAsset(id: string | undefined): AssetDef | undefined {
  if (!id) return undefined;
  return byId.get(id) ?? customAssets().find((a) => a.id === id);
}

/** Tabs of a category, in catalogue order. */
export function tabsOf(cat: Category): string[] {
  const have = new Set(allAssets().filter((a) => a.category === cat).map((a) => a.tab));
  const order = TAB_ORDER[cat] ?? [];
  return [...order.filter((t) => have.has(t)), ...[...have].filter((t) => !order.includes(t))];
}

export function assetsIn(cat: Category, tab: string): AssetDef[] { return allAssets().filter((a) => a.category === cat && a.tab === tab); }

/** Save a road cross-section as the user's own asset (Settings, this browser). */
export function saveCustom(a: Omit<AssetDef, 'id' | 'pack' | 'custom'>): AssetDef {
  const def: AssetDef = { ...a, id: `custom.${Date.now().toString(36)}`, pack: 'custom', custom: true };
  saveSettings({ customAssets: [...customAssets(), def] });
  return def;
}
export function deleteCustom(id: string) { saveSettings({ customAssets: customAssets().filter((a) => a.id !== id) }); }

// ---------------- the document side ----------------

/** The asset a section or line was built from. */
export function assetOf(o: SectionObj | LineObj | undefined): AssetDef | undefined {
  if (!o) return undefined;
  return getAsset(o.kind === 'section' ? o.asset : (o.props.asset as string | undefined));
}

/** What a line is: a route (polyline), a placed structure (one point) or an area (closed ring). */
export function lineShape(l: LineObj): 'route' | 'point' | 'area' {
  const s = l.props.shape;
  return s === 'point' ? 'point' : s === 'area' ? 'area' : 'route';
}

/** The width a line of this asset is drawn at (its `size`). */
export function profileSize(p: Profile): number {
  switch (p.type) {
    case 'track': return p.formation;
    case 'channel': return channelTop(p);
    case 'conduit': return p.box ? p.box[0] : p.dia;
    case 'corridor': return p.width;
    case 'path': return p.width;
    case 'point': return p.w;
    default: return 0;
  }
}

/** Make sure the asset's layer exists (call inside an edit). */
export function ensureLayer(doc: CityDoc, def: LayerDef): Id {
  if (doc.get(def.id)) {
    const L = doc.get<'layer'>(def.id)!;
    if (!L.visible) doc.set(def.id, 'visible', true);
    return def.id;
  }
  const order = 100 + doc.all('layer').length;
  doc.create({ kind: 'layer', id: def.id, name: def.name, group: def.group, type: 'lines', lineKind: def.kind, visible: true, locked: false, opacity: 1, color: def.color, order } as LayerObj);
  return def.id;
}

/** A new line / structure / area from an asset (call inside an edit). `lift`: + up, − down (m). */
export function createAssetLine(doc: CityDoc, a: AssetDef, pts: number[], lift: number, extra: Record<string, string | number> = {}): Id {
  const layer = ensureLayer(doc, a.layer ?? LAYERS.sites);
  const shape = a.drawer === 'place' ? 'point' : a.drawer === 'area' ? 'area' : undefined;
  const props: Record<string, string | number> = { asset: a.id, ...(a.props ?? {}), ...(shape ? { shape } : {}), ...(a.profile.type === 'point' ? { len: a.profile.l } : {}), ...extra };
  delete props.action;
  const l: LineObj = { kind: 'line', id: newId('l'), layer, pts: pts.map((v) => Math.round(v * 100) / 100), depth: Math.round(-lift * 100) / 100, size: profileSize(a.profile), name: '', props };
  doc.create(l);
  return l.id;
}

/** Re-type an existing line to another asset of the same kind (keeps its geometry). */
export function retypeLine(doc: CityDoc, id: Id, a: AssetDef) {
  const l = doc.get<'line'>(id);
  if (!l) return;
  const props: Record<string, string | number> = { ...l.props, asset: a.id, ...(a.props ?? {}) };
  delete props.action;
  doc.set(id, 'props', props);
  doc.set(id, 'size', profileSize(a.profile));
  if (a.lift !== undefined) doc.set(id, 'depth', -a.lift);
  if (a.layer && a.layer.id !== l.layer) { ensureLayer(doc, a.layer); doc.set(id, 'layer', a.layer.id); }
}

export { assetWidth };
