// Editor UI state (signals): tool, selection, view mode, panels. The document holds the map; this holds the session.
import { signal, computed } from '@preact/signals';
import type { Id, Kind } from '../doc/types';

export type Tool = 'select' | 'direct' | 'pen' | 'knife' | 'line' | 'measure' | 'hand' | 'bulldoze' | 'wand';
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
/** DP regions overlay (land-use plots / reservations from the DP sheets) */
export const dpRegionsOn = signal(false);
export const leftTab = signal<'layers' | 'roads' | 'issues' | 'review' | 'survey'>('layers');
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
}
function loadSettings(): Settings {
  const def: Settings = {
    author: '', wheel: 'zoom', snap: true, showGrid: false, units: 'm',
    roadMode: 'straight', elevStep: 2.5, snapGeometry: true, snapAngles: true, snapGuides: true, snapLength: 1, grade: 0.05,
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
