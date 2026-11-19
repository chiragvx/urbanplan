// The user's own design systems: named copies of a preset (or of another saved one) with their changes, to start any
// project from. Kept in this browser's localStorage for now. Every function returns a Promise so an account-backed
// store (a fetch to the server, then this as its offline cache) can replace the body without changing a caller.
// The presets in ./design.ts stay read-only; "Save as mine" stores a copy here.
import { clone, type DesignSystem } from './design';

export interface SavedDesign {
  /** 'my-…', unique */
  id: string;
  name: string;
  /** the design system; its `origin` is this entry's id, its `id` the preset it started from */
  ds: DesignSystem;
  /** ms since 1970 */
  savedAt: number;
}

const KEY = 'urbanplan:pro:designs';
type Listener = (all: SavedDesign[]) => void;
const listeners = new Set<Listener>();

function read(): SavedDesign[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => x && typeof x.id === 'string' && x.ds && typeof x.ds === 'object') : [];
  } catch { return []; }
}
function write(all: SavedDesign[]) {
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { throw new Error('Could not save in this browser (storage is full or blocked).'); }
  listeners.forEach((f) => f(all));
}
const newId = () => `my-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** All saved design systems, newest first. */
export async function list(): Promise<SavedDesign[]> {
  return read().sort((a, b) => b.savedAt - a.savedAt);
}

export async function get(id: string): Promise<SavedDesign | null> {
  return read().find((x) => x.id === id) ?? null;
}

/** Save a copy of `ds` under `name`. With `id` (one already saved), overwrite that one instead. */
export async function save(name: string, ds: DesignSystem, id?: string): Promise<SavedDesign> {
  const all = read();
  const at = id ? all.findIndex((x) => x.id === id) : -1;
  const sid = at >= 0 ? all[at].id : newId();
  const copy = clone(ds);
  copy.name = name.trim() || 'My design';
  copy.origin = sid;
  const entry: SavedDesign = { id: sid, name: copy.name, ds: copy, savedAt: Date.now() };
  if (at >= 0) all[at] = entry; else all.push(entry);
  write(all);
  return entry;
}

export async function rename(id: string, name: string): Promise<SavedDesign | null> {
  const all = read(), x = all.find((s) => s.id === id);
  if (!x) return null;
  x.name = x.ds.name = name.trim() || x.name;
  write(all);
  return x;
}

export async function remove(id: string): Promise<void> {
  write(read().filter((x) => x.id !== id));
}

/** Be told whenever the list changes, here or in another tab. Returns the unsubscribe. */
export function subscribe(f: Listener): () => void {
  listeners.add(f);
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) f(read()); };
  addEventListener('storage', onStorage);
  return () => { listeners.delete(f); removeEventListener('storage', onStorage); };
}
