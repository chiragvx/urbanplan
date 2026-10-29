// .urbanplan.json — a map is its edits: one line per edited object, stable order, so git diffs read like
// "section s1x… parts changed". Opening a map re-attaches edits to the current base (ids, then locators).
import type { CityDoc } from './doc';
import type { Id, Locator, MapFile, MapMeta, Obj, PatchEntry } from './types';
import { newId } from './ids';

export const FILE_EXT = '.urbanplan.json';
/** map file format ids this version reads (the first is written; the second is the old Pune Remix name) */
export const FORMATS = ['urbanplan/map', 'pune-remix/map'] as const;

export function newMeta(tile: string, base: string, author = ''): MapMeta {
  const now = new Date().toISOString();
  return { id: newId('map'), name: 'Untitled map', author, description: '', tile, created: now, updated: now, forkedFrom: null, base };
}

const round = (v: unknown): unknown => {
  if (typeof v === 'number') return Math.round(v * 1000) / 1000;
  if (Array.isArray(v)) return v.map(round);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round(x)]));
  return v;
};

/** Serialise: stable key order, one object per line. */
export function serialize(doc: CityDoc): string {
  const ids = [...doc.patch.keys()].sort();
  const lines = ids.map((id) => {
    const e = doc.patch.get(id)!;
    const out: PatchEntry = {};
    if (e.loc) out.loc = e.loc;
    if (e.del) out.del = true;
    if (e.set) out.set = round(Object.fromEntries(Object.entries(e.set).sort(([a], [b]) => a.localeCompare(b)))) as Record<string, unknown>;
    if (e.add) out.add = round(e.add) as Obj;
    return `    ${JSON.stringify(id)}: ${JSON.stringify(out)}`;
  });
  const head: Omit<MapFile, 'objects'> = { format: FORMATS[0], version: 1, meta: doc.meta };
  return `{\n  "format": ${JSON.stringify(head.format)},\n  "version": 1,\n  "meta": ${JSON.stringify(doc.meta)},\n  "objects": {\n${lines.join(',\n')}\n  }\n}\n`;
}

export function parse(text: string): MapFile {
  const f = JSON.parse(text) as MapFile;
  if (!(FORMATS as readonly string[]).includes(f.format)) throw new Error('Not an UrbanPlan map file');
  if (f.version !== 1) throw new Error(`Unsupported map version ${f.version}`);
  if (!f.objects || typeof f.objects !== 'object') throw new Error('Map file has no objects');
  return f;
}

export interface Rebased { patch: Map<Id, PatchEntry>; kept: number; remapped: [Id, Id][]; unresolved: { id: Id; entry: PatchEntry }[] }

/**
 * Attach a file's edits to the current base. Edits to base objects whose id no longer exists (the importer changed)
 * are matched by locator: same OSM ways + nearby midpoint for sections, nearest within a few metres otherwise.
 */
export function rebase(doc: CityDoc, f: MapFile): Rebased {
  const patch = new Map<Id, PatchEntry>();
  const remapped: [Id, Id][] = [];
  const unresolved: { id: Id; entry: PatchEntry }[] = [];
  let kept = 0;
  const claimed = new Set<Id>();
  for (const [id, entry] of Object.entries(f.objects)) {
    if (entry.add) { patch.set(id, entry); kept++; continue; }
    if (doc.base.has(id)) { patch.set(id, entry); claimed.add(id); kept++; continue; }
    const to = entry.loc ? match(doc, entry.loc, claimed) : undefined;
    if (to) { claimed.add(to); patch.set(to, { ...entry, loc: doc.locate(to) }); remapped.push([id, to]); }
    else { unresolved.push({ id, entry }); patch.set(id, entry); } // kept (never silently dropped); listed for review
  }
  // references inside created objects / overrides (section ends, roads, layers) follow remapped ids
  if (remapped.length) {
    const m = new Map(remapped);
    const fix = (o: Record<string, unknown> | undefined) => {
      if (!o) return;
      for (const k of ['a', 'b', 'road', 'layer']) if (typeof o[k] === 'string' && m.has(o[k] as string)) o[k] = m.get(o[k] as string);
    };
    for (const e of patch.values()) { fix(e.add as unknown as Record<string, unknown>); fix(e.set); }
  }
  return { patch, kept, remapped, unresolved };
}

function match(doc: CityDoc, loc: Locator, claimed: Set<Id>): Id | undefined {
  let best: Id | undefined, bestScore = Infinity;
  for (const [id, o] of doc.base) {
    if (o.kind !== loc.kind || claimed.has(id)) continue;
    const l = doc.locate(id);
    if (!l) continue;
    const d = Math.hypot(l.x - loc.x, l.z - loc.z);
    let score = Infinity;
    if (loc.kind === 'section') {
      const shared = loc.wayIds?.length && l.wayIds?.some((w) => loc.wayIds!.includes(w));
      if (shared && d < 35) score = d + Math.abs((l.len ?? 0) - (loc.len ?? 0)) * 0.3;
      else if (!loc.wayIds?.length && loc.name && l.name === loc.name && d < 20) score = d + 5;
    } else if (loc.kind === 'road') {
      if (loc.name && l.name === loc.name) score = 0;
    } else if (d < (loc.kind === 'junction' ? 15 : 8)) score = d;
    if (score < bestScore) { bestScore = score; best = id; }
  }
  return best;
}

/** Load a parsed map into a document (replacing its edits). */
export function openMap(doc: CityDoc, f: MapFile): Rebased {
  const r = rebase(doc, f);
  doc.load(r.patch, { ...f.meta });
  return r;
}
