// Maps in the cloud, for signed-in users (supabase/migrations/0002_projects.sql): a `projects` row of facts per map
// and the map itself as a gzipped file in the private `projects` bucket, <user>/<project>/current.json.gz, with its
// saved versions beside it (…/v/<time>.json.gz, a `project_versions` row each). The browser's autosave stays the
// first copy (it works offline); the cloud follows a few seconds behind.
//
// Two tabs (or two computers) on one project: every save says which revision it was made from, and a save made from
// an older one than the cloud holds is kept as a copy instead of overwriting the newer work.
import { signal } from '@preact/signals';
import { session, supabase } from '../auth/auth';
import type { MapMeta } from '../doc/types';

const BUCKET = 'projects';
/** a version kept at most this often while editing (a manual save always keeps one) */
const VERSION_EVERY = 10 * 60e3;
const MAX_VERSIONS = 50;

export interface Project { id: string; name: string; region: string; edits: number; bytes: number; revision: number; visibility: string; created_at: string; updated_at: string }
export interface Version { id: number; project: string; path: string; edits: number; bytes: number; label: string | null; created_at: string }

/** Where the cloud copy stands: off (signed out / no accounts), saving, saved (when), offline, error. */
export const cloudState = signal<{ s: 'off' | 'saving' | 'saved' | 'offline' | 'error'; at?: string; msg?: string }>({ s: 'off' });

/** Is there a signed-in user to save for? */
export const cloudOn = () => !!(supabase && session.value?.user);
const uid = () => session.value!.user.id;
const sb = () => supabase!;

// ---------------- gzip ----------------

async function gzip(text: string): Promise<Blob> {
  const s = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(s).blob();
}
async function gunzip(b: Blob): Promise<string> {
  // (a host may have already undone the gzip on the way down: plain JSON starts with '{')
  const head = new Uint8Array(await b.slice(0, 2).arrayBuffer());
  if (head[0] !== 0x1f || head[1] !== 0x8b) return b.text();
  return new Response(b.stream().pipeThrough(new DecompressionStream('gzip'))).text();
}

const fileOf = (owner: string, id: string) => `${owner}/${id}/current.json.gz`;

async function upload(path: string, blob: Blob) {
  const { error } = await sb().storage.from(BUCKET).upload(path, blob, { upsert: true, contentType: 'application/gzip', cacheControl: '0' });
  if (error) throw error;
}

// ---------------- projects ----------------

export async function listProjects(): Promise<Project[]> {
  if (!cloudOn()) return [];
  const { data, error } = await sb().from('projects').select('*').eq('owner', uid()).order('updated_at', { ascending: false });
  if (error) throw error;
  return data as Project[];
}

/** A project's map file (its text) and the revision it is at. */
export async function readProject(id: string): Promise<{ text: string; project: Project }> {
  const { data: p, error } = await sb().from('projects').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  if (!p) throw new Error('That project isn’t there, or isn’t yours.');
  const owner = (p as Project & { owner: string }).owner;
  const { data: blob, error: e2 } = await sb().storage.from(BUCKET).download(fileOf(owner, id));
  if (e2 || !blob) throw e2 ?? new Error('The map file is missing.');
  return { text: await gunzip(blob), project: p as Project };
}

export async function renameProject(id: string, name: string) {
  const { error } = await sb().from('projects').update({ name }).eq('id', id);
  if (error) throw error;
}

/** The project, its versions and their files. */
export async function deleteProject(id: string) {
  const dir = `${uid()}/${id}`;
  const { data: v } = await sb().storage.from(BUCKET).list(`${dir}/v`, { limit: 1000 });
  const files = [fileOf(uid(), id), ...(v ?? []).map((f) => `${dir}/v/${f.name}`)];
  await sb().storage.from(BUCKET).remove(files);
  const { error } = await sb().from('projects').delete().eq('id', id);
  if (error) throw error;
}

// ---------------- saving ----------------

export interface Saved { id: string; revision: number; copied?: boolean }
/** when each project last kept a version (this session) */
const lastVersion = new Map<string, number>();

/**
 * Save a map: into its project (made the first time), or into a new one when the cloud holds newer work than the
 * revision this copy was opened at. `version`: keep a version now (a manual save); else one every 10 minutes.
 */
export async function saveProject(meta: MapMeta, text: string, edits: number, opts: { version?: boolean; label?: string } = {}): Promise<Saved> {
  const blob = await gzip(text);
  const facts = { name: meta.name || 'Untitled map', region: meta.tile, edits, bytes: blob.size };
  let id = meta.cloud?.id, revision = meta.cloud?.rev ?? 0, copied = false;
  if (id) {
    // claim the next revision, only if nobody saved since we last did
    const { data, error } = await sb().from('projects').update({ ...facts, revision: revision + 1 }).eq('id', id).eq('revision', revision).select('revision');
    if (error) throw error;
    if (data?.length) revision = data[0].revision;
    else {
      // newer work in the cloud (or the project is gone, or not ours): keep this as a copy beside it
      const { data: there } = await sb().from('projects').select('id').eq('id', id).maybeSingle();
      copied = !!there;
      id = undefined;
      if (copied) facts.name = `${facts.name} (copy)`;
    }
  }
  if (!id) {
    const { data, error } = await sb().from('projects').insert(facts).select('id, revision').single();
    if (error) throw error;
    id = data.id as string; revision = data.revision as number;
  }
  await upload(fileOf(uid(), id), blob);
  const now = Date.now();
  if (opts.version || now - (lastVersion.get(id) ?? 0) > VERSION_EVERY) {
    lastVersion.set(id, now);
    try { await keepVersion(id, blob, edits, opts.label); } catch (e) { console.warn('version not kept', e); }
  }
  return { id, revision, copied };
}

async function keepVersion(project: string, blob: Blob, edits: number, label?: string) {
  const path = `${uid()}/${project}/v/${new Date().toISOString().replace(/[:.]/g, '-')}.json.gz`;
  await upload(path, blob);
  const { error } = await sb().from('project_versions').insert({ project, path, edits, bytes: blob.size, label: label ?? null });
  if (error) throw error;
  await thin(project);
}

export async function listVersions(project: string): Promise<Version[]> {
  const { data, error } = await sb().from('project_versions').select('*').eq('project', project).order('created_at', { ascending: false });
  if (error) throw error;
  return data as Version[];
}

export async function readVersion(v: Version): Promise<string> {
  const { data, error } = await sb().storage.from(BUCKET).download(v.path);
  if (error || !data) throw error ?? new Error('That version’s file is missing.');
  return gunzip(data);
}

/**
 * Old versions go: everything from the last day stays, then the newest of each day for a month, then the newest of
 * each week; named ones always stay; never more than 50 (the oldest unnamed go first).
 */
export function toThin(list: Version[], now = Date.now()): Version[] {
  const day = 864e5, seen = new Set<string>(), keep: Version[] = [], drop: Version[] = [];
  for (const v of [...list].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    const age = now - Date.parse(v.created_at);
    const slot = age < day ? `v${v.id}` : age < 30 * day ? `d${Math.floor(Date.parse(v.created_at) / day)}` : `w${Math.floor(Date.parse(v.created_at) / (7 * day))}`;
    if (v.label || !seen.has(slot)) { seen.add(slot); keep.push(v); } else drop.push(v);
  }
  for (let i = keep.length - 1; keep.length > MAX_VERSIONS && i >= 0; i--) if (!keep[i].label) drop.push(...keep.splice(i, 1));
  return drop;
}

async function thin(project: string) {
  const drop = toThin(await listVersions(project));
  if (!drop.length) return;
  await sb().storage.from(BUCKET).remove(drop.map((v) => v.path));
  await sb().from('project_versions').delete().in('id', drop.map((v) => v.id));
}
