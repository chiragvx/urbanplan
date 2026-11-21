// A saved design system's versions and changelog. Every version is the whole design system as it stood, a note
// saying why (the changelog line), and the changes from the version before, worked out (`diffDesign`), so the history
// reads as a changelog and any version can be restored. Kept in this browser's localStorage for now, beside the
// designs themselves (./designLibrary.ts); every function returns a Promise so a Supabase table can take over
// (planned: design_versions(design_id, version, ds jsonb, note, changes jsonb, author, created_at), owner-only RLS).
import { clone, type DesignSystem } from './design';
import { materialOf } from './materials';

export interface Change { section: string; label: string; from: string; to: string }
export interface DesignVersion {
  /** 1, 2, 3 … per design system */
  v: number;
  /** ms since 1970 */
  at: number;
  note: string;
  ds: DesignSystem;
  /** what changed from the version before (none for the first) */
  changes: Change[];
}

const KEY = (id: string) => `urbanplan:pro:design-versions:${id}`;
function read(id: string): DesignVersion[] {
  try { const v = JSON.parse(localStorage.getItem(KEY(id)) ?? '[]'); return Array.isArray(v) ? v.filter((x) => x && typeof x.v === 'number' && x.ds) : []; } catch { return []; }
}
function write(id: string, all: DesignVersion[]) {
  try { localStorage.setItem(KEY(id), JSON.stringify(all)); } catch { throw new Error('Could not save the version in this browser (storage is full or blocked).'); }
}

/** A design system's versions, newest first. */
export async function versions(id: string): Promise<DesignVersion[]> { return read(id).sort((a, b) => b.v - a.v); }

/** Record a version: the design system as it is, with a note; its changes worked out from the last one. */
export async function addVersion(id: string, ds: DesignSystem, note: string): Promise<DesignVersion> {
  const all = read(id), last = all.reduce<DesignVersion | null>((m, x) => (!m || x.v > m.v ? x : m), null);
  const ver: DesignVersion = { v: (last?.v ?? 0) + 1, at: Date.now(), note: note.trim(), ds: clone(ds), changes: last ? diffDesign(last.ds, ds) : [] };
  write(id, [...all, ver]);
  return ver;
}

/** Forget a design system's versions (when it's deleted). */
export async function dropVersions(id: string): Promise<void> { try { localStorage.removeItem(KEY(id)); } catch { /* */ } }

// ---------------------------------------------------------------- the changes, in words
/** the sections a token belongs to, by its first key (the builder's section names) */
const SECTION: Record<string, string> = {
  facade: 'Facade', finish: 'Materials', glazing: 'Windows and balconies', windows: 'Windows and balconies', doors: 'Windows and balconies',
  balcony: 'Windows and balconies', floorH: 'Facade', spec: 'Specification', premium: 'Specification', language: 'Language',
  composition: 'Composition', palette: 'Palette', climate: 'Climate', lighting: 'Signs and lighting', signage: 'Signs and lighting',
  landscape: 'Landscape', site: 'Walls, gates and roads', precinct: 'Heritage controls', name: 'Name', blurb: 'Name',
};
/** keys left out of the changelog: bookkeeping, not design */
const SKIP = new Set(['id', 'origin', 'basedOn']);
/** a few paths in plainer words */
const WORDS: Record<string, string> = {
  floorH: 'Floor to floor', premium: 'Price over the city’s', 'facade.wall': 'Wall colour', 'facade.accent': 'Accent colour', 'facade.base': 'Base colour',
  'facade.bands': 'Floor bands', 'facade.fins': 'Fins', 'composition.base.floors': 'Base floors', 'composition.top.floors': 'Top floors', 'composition.top.crown': 'Crown',
  'composition.bay': 'Bay width', 'composition.rhythm': 'Window rhythm', 'composition.reveal': 'Window reveal', 'composition.corner': 'Corners', 'composition.entrance': 'Entrance',
  'climate.chhajja': 'Chhajja', 'climate.jaali': 'Jaali', 'site.gate.vehicle': 'Vehicle gate', 'site.gate.pedestrian': 'Pedestrian gate', 'site.wall.kind': 'Compound wall', 'site.wall.h': 'Wall height',
  'site.road.w': 'Road width', 'site.road.surface': 'Road surface', 'balcony.kind': 'Balconies', 'balcony.depth': 'Balcony depth',
};
const words = (path: string) => WORDS[path] ?? path.split('.').slice(path.startsWith('finish.') ? 1 : 0).map((s, i) => (i === 0 ? s[0].toUpperCase() + s.slice(1) : s)).join(' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().replace(/^./, (c) => c.toUpperCase());
const show = (path: string, v: unknown): string => {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'boolean') return v ? 'On' : 'Off';
  if (typeof v === 'number') return path === 'premium' || path.startsWith('palette.') ? `${Math.round(v * 100)}%` : `${Math.round(v * 100) / 100}`;
  if (typeof v === 'string') { if (path.startsWith('finish.') || path === 'site.wall.material') { const m = materialOf(v); return m?.name ?? v; } return v; }
  return JSON.stringify(v);
};

/** The changes from `a` to `b`, leaf by leaf, in the builder's words: section, what, from, to. An object that came or
 *  went whole (a layer first set) lists its leaves. */
export function diffDesign(a: DesignSystem, b: DesignSystem): Change[] {
  const out: Change[] = [];
  const walk = (x: unknown, y: unknown, path: string) => {
    const ox = x && typeof x === 'object' && !Array.isArray(x), oy = y && typeof y === 'object' && !Array.isArray(y);
    if (ox || oy) {
      const keys = new Set([...Object.keys((x as object) ?? {}), ...Object.keys((y as object) ?? {})]);
      for (const k of keys) { if (!path && SKIP.has(k)) continue; walk((x as Record<string, unknown> | undefined)?.[k], (y as Record<string, unknown> | undefined)?.[k], path ? `${path}.${k}` : k); }
      return;
    }
    if (JSON.stringify(x) === JSON.stringify(y)) return;
    // (the facade's names follow its materials: the material line says it)
    if (path === 'facade.wallName' || path === 'facade.accentName' || path === 'glazing.frameName') return;
    out.push({ section: SECTION[path.split('.')[0]] ?? 'Other', label: words(path), from: show(path, x), to: show(path, y) });
  };
  walk(a, b, '');
  return out;
}

/** The changelog as Markdown, newest first: a heading per version with its note, a line per change. */
export function changelogMd(name: string, all: DesignVersion[]): string {
  const day = (t: number) => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
  return [`# ${name}: changelog`, '', ...all.flatMap((x) => [
    `## v${x.v} · ${day(x.at)}${x.note ? ` · ${x.note}` : ''}`, '',
    ...(x.changes.length ? x.changes.map((c) => `- ${c.section}: ${c.label}, ${c.from} → ${c.to}`) : [x.v === 1 ? '- The first version.' : '- No changes.']), '',
  ])].join('\n');
}
