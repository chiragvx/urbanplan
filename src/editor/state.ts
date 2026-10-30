// Editor UI state (signals): tool, selection, view mode, panels. The document holds the map; this holds the session.
import { signal, computed } from '@preact/signals';
import type { Id, Kind } from '../doc/types';

export type Tool = 'select' | 'direct' | 'pen' | 'knife' | 'line' | 'measure' | 'hand' | 'bulldoze' | 'wand' | 'terrain' | 'route' | 'place' | 'area' | 'multi';
/** Road tool modes, as in Cities: Skylines (freeform = the Bézier pen; replace = CS's upgrade tool). */
export type RoadMode = 'straight' | 'curve' | 'complex' | 'continuous' | 'freeform' | 'replace';
export type ViewMode = '2d' | '3d';

export interface Sel { kind: Kind; id: Id }
/** A path anchor (or one of its handles) of a section or line. */
export interface AnchorRef { owner: Id; k: number; handle?: 'in' | 'out' }

export const tool = signal<Tool>('select');
export const mode = signal<ViewMode>('2d');
export const selection = signal<Sel[]>([]);
export const hover = signal<Sel | null>(null);
export const anchorSel = signal<AnchorRef | null>(null);
/** bumps on every document change (UI re-renders from the doc) */
export const docVersion = signal(0);
/** viewing someone's published map: editing locked until "Edit a copy" */
export const readOnly = signal(false);
export const xray = signal(false);
export const accuracyView = signal(false);
/** terrain view: heights, hill shade and contours (or cut / fill) over the plan */
export const terrainView = signal(false);
export const terrainShow = signal<'height' | 'cutfill'>('height');
/** DP regions overlay (land-use plots / reservations from the DP sheets) */
export const dpRegionsOn = signal(false);
export const leftTab = signal<'layers' | 'roads' | 'issues' | 'review' | 'survey'>('layers');
/** the floating left panel (Layers / Roads / Issues / Review) is open */
export const leftOpen = signal(false);
/** inspector tab per panel kind (road, section…), kept while selecting other objects of that kind */
export const inspTab = signal<Record<string, string>>({});
/** bumps when the road tools' mode / values change (their options bar re-renders) */
export const mtTick = signal(0);
/** the raw OSM road lines drawn over the map (2D), with drifts listed in Issues */
export const osmCompare = signal(false);
/** survey tab: which regions to walk */
export const surveyFilter = signal<'reserved' | 'all'>('reserved');
export const paletteOpen = signal(false);
export const dialog = signal<null | 'open' | 'publish' | 'settings' | 'help' | 'about' | 'export'>(null);
export const status = signal('');
/** pen / line tool options */
export const penClass = signal('residential');
/** height above the ground the road tool draws at (PageUp / PageDown) */
export const penLift = signal(0);
export const lineLayer = signal<Id>('');
/** the asset being built (palette): its id; the road tool also takes its cross-section from it */
export const buildAsset = signal<string>('');
/** the build palette: open, and the category / tab shown */
export const buildOpen = signal(false);
export const buildCat = signal<import('../assets/model').Category>('roads');
export const buildTab = signal<Record<string, string>>({});
/** rotation (degrees) for placed structures, '[' / ']' turn it */
export const placeRot = signal(0);
/** cursor in world metres (status bar) */
export const cursor = signal<[number, number] | null>(null);
export const zoomScale = signal(1);
export const toasts = signal<{ id: number; text: string; kind: 'info' | 'ok' | 'warn' | 'error'; action?: { label: string; run: () => void } }[]>([]);
export const settings = signal(loadSettings());
export const profileOpen = signal(false);
export const stale3d = signal(false);

export interface Settings {
  author: string; wheel: 'zoom' | 'pan'; snap: boolean; showGrid: boolean; units: 'm';
  roadMode: RoadMode;
  /** PageUp / PageDown step (m) */ elevStep: number;
  /** what the road tool snaps to */ snapGeometry: boolean; snapAngles: boolean; snapGuides: boolean;
  /** round lengths to this many metres (0 = off) */ snapLength: number;
  /** ramp gradient for flyovers (0.05 = 5 %) */ grade: number;
  /** new roads from the road tool are graded (Cities: Skylines style) instead of following the terrain */ roadGraded: boolean;
  /** terrain tool */
  terrainOp: import('../doc/types').EarthworkOp; brushRadius: number; brushStrength: number;
  levelHeight: number | null; levelBalanced: boolean; embankOffset: number; embankWidth: number; pondDepth: number;
  /** 3D vertical exaggeration in the terrain view */ exaggeration: number;
  /** 3D look: simple (light, the default) or high (sky, ambient occlusion, sharper shadows) */ graphics: 'simple' | 'high';
  /** assets saved from cross-sections ("Save as asset") */ customAssets: import('../assets/model').AssetDef[];
  /** UI theme: follow the system, or light / dark */ theme: 'system' | 'light' | 'dark';
  /** side panels float over the map (Cities: Skylines style) or sit beside it */ panels: 'floating' | 'docked';
  /** road tools: the mode in use */ mtMode: string;
  /** imagery access tokens (this browser only; never saved with a map) */ imageryKeys: Record<string, string>;
}
function loadSettings(): Settings {
  const def: Settings = {
    author: '', wheel: 'zoom', snap: true, showGrid: false, units: 'm',
    roadMode: 'straight', elevStep: 2.5, snapGeometry: true, snapAngles: true, snapGuides: true, snapLength: 1, grade: 0.035, roadGraded: false,
    terrainOp: 'shift', brushRadius: 40, brushStrength: 0.5, levelHeight: null, levelBalanced: true, embankOffset: 2, embankWidth: 10, pondDepth: 2, exaggeration: 1,
    graphics: 'simple', customAssets: [], theme: 'system', panels: 'floating', mtMode: 'addNode', imageryKeys: {},
  };
  // key keeps the old name so settings survive the rename
  try { return { ...def, ...JSON.parse(localStorage.getItem('pune-remix:settings') ?? '{}') }; } catch { return def; }
}
export function saveSettings(s: Partial<Settings>) {
  settings.value = { ...settings.value, ...s };
  try { localStorage.setItem('pune-remix:settings', JSON.stringify(settings.value)); } catch { /* private mode */ }
}

let toastId = 0;
export function toast(text: string, kind: 'info' | 'ok' | 'warn' | 'error' = 'info', action?: { label: string; run: () => void }, ms = 3500) {
  const id = ++toastId;
  toasts.value = [...toasts.value, { id, text, kind, action }];
  setTimeout(() => { toasts.value = toasts.value.filter((t) => t.id !== id); }, action ? ms * 2 : ms);
}

export const selKinds = computed(() => new Set(selection.value.map((s) => s.kind)));
export const isSelected = (id: Id) => selection.value.some((s) => s.id === id);
export function select(list: Sel[], add = false) {
  if (!add) { selection.value = list; anchorSel.value = null; return; }
  const cur = [...selection.value];
  for (const s of list) {
    const i = cur.findIndex((c) => c.id === s.id);
    if (i >= 0) cur.splice(i, 1); else cur.push(s);
  }
  selection.value = cur;
}
