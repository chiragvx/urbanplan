// The dashboard's data: the user's Pro projects and folders, their profile, preferences, team and activity, their
// plan and usage. Everything goes through Supabase (src/auth/auth.ts) when an account is set up and signed in; the
// project in this browser is always there besides. The platform's newer columns and tables (0006_platform.sql) are
// optional: where they're missing the call says so with NotReady, and the page shows the feature as "coming" rather
// than failing, so the dashboard ships before the migration is run.
import { signal } from '@preact/signals';
import { deleteProject, listProjects, readProject, renameProject, type Project } from '../app/cloud';
import { BASE, session, supabase, type Profile, type Role as UserRole } from '../auth/auth';
import { FORMAT, openPro, savePro } from '../pro/cloud';
import { DEFAULT_PROJECT, type ProProject, type Stage } from '../pro/project';
import type { Summary } from './summary';

export class NotReady extends Error { constructor(what: string) { super(`${what} needs the platform tables (supabase/migrations/0006_platform.sql).`); } }
/** a missing table, column or function (Postgres 42P01 / 42703 / 42883, PostgREST's schema-cache errors) */
const missing = (e: { code?: string; message?: string } | null) => !!e && (['42P01', '42703', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(e.code ?? '') || /does not exist|schema cache/i.test(e.message ?? ''));

const sb = () => { if (!supabase) throw new Error('Accounts aren’t set up.'); return supabase; };
export const me = () => session.value?.user ?? null;

// ---------------- projects ----------------

export interface Row extends Project {
  summary?: Summary | null; starred?: boolean; archived_at?: string | null; folder?: string | null; opened_at?: string | null;
  /** its stage as just set here, before the summary catches up */
  stage?: Stage;
  /** shared with me: my role on it */
  role?: 'editor' | 'viewer';
}
/** The project in this browser (the editor keeps one, saved as you go). */
export const LOCAL_KEY = 'urbanplan:pro:project';
const LOCAL_REF = 'urbanplan:pro:cloud';
export function localProject(): { p: ProProject; cloudId: string | null } | null {
  try {
    const p = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null') as ProProject | null;
    if (!p || p.v !== 1) return null;
    const ref = JSON.parse(localStorage.getItem(LOCAL_REF) ?? 'null') as { id?: string } | null;
    return { p: { ...DEFAULT_PROJECT, ...p }, cloudId: ref?.id ?? null };
  } catch { return null; }
}

export const proUrl = (q = '') => `${BASE}pro/${q}`;
export const openUrl = (id: string) => proUrl(`?p=${encodeURIComponent(id)}`);
/** a fresh project, or a start the editor should make (a sample, a survey number, a template) */
export const newUrl = (start: 'blank' | 'sample' | 'survey' | 'import' | `template:${string}` = 'blank') => proUrl(`?new=${encodeURIComponent(start)}`);

export async function mine(): Promise<Row[]> { return (await listProjects('pro')) as Row[]; }
export async function sharedWithMe(): Promise<Row[]> {
  const rows = (await listProjects('pro', true).catch(() => [])) as Row[];
  if (!rows.length) return rows;
  const email = (me()?.email ?? '').toLowerCase();
  const { data } = await sb().from('project_members').select('project, role').eq('email', email);
  const role = new Map((data ?? []).map((m: { project: string; role: 'editor' | 'viewer' }) => [m.project, m.role]));
  return rows.map((r) => ({ ...r, role: role.get(r.id) ?? 'viewer' }));
}

async function patch(id: string, fields: Partial<Row>, what: string) {
  const { error } = await sb().from('projects').update(fields).eq('id', id);
  if (missing(error)) throw new NotReady(what);
  if (error) throw error;
}
export const star = (id: string, v: boolean) => patch(id, { starred: v }, 'Starring');
export const archive = (id: string, v: boolean) => patch(id, { archived_at: v ? new Date().toISOString() : null }, 'Archiving');
export const moveTo = (id: string, folder: string | null) => patch(id, { folder }, 'Folders');
export const rename = (id: string, name: string) => renameProject(id, name.trim() || 'Untitled project');
export const remove = (id: string) => deleteProject(id);
/** a project's stage, set from the dashboard: saved into its file (the card's summary follows) */
export async function setStage(id: string, stage: Stage) {
  const { p, ref } = await openPro(id);
  if (p.stage === stage) return;
  await savePro({ ...p, stage }, ref);
  // (the browser's copy of the same project too, so opening it here doesn't put the old stage back)
  const l = localProject(); if (l?.cloudId === id) setLocalStage(stage);
}
/** the browser's project's stage */
export function setLocalStage(stage: Stage) {
  try { const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null'); if (raw) localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...raw, stage })); } catch { /* */ }
}
/** a copy of a project in my account (mine or shared with me) */
export async function duplicate(id: string): Promise<string> {
  const { p } = await openPro(id);
  const s = await savePro({ ...p, name: `${p.name} (copy)` }, null, true);
  return s.id;
}
/** a project's file, to download */
export async function fileText(id: string): Promise<string> { return (await readProject(id)).text; }
/** a project file (JSON) as a new project in my account */
export async function importFile(text: string): Promise<string> {
  const f = JSON.parse(text);
  if (f.format !== FORMAT) throw new Error('That isn’t an UrbanPlan Pro project file.');
  const { format: _, ...rest } = f;
  const s = await savePro({ ...DEFAULT_PROJECT, ...rest, v: 1 }, null, true);
  return s.id;
}

// ---------------- folders ----------------

export interface Folder { id: string; name: string; created_at: string }
export async function folders(): Promise<Folder[]> {
  const { data, error } = await sb().from('folders').select('id, name, created_at').order('name');
  if (missing(error)) throw new NotReady('Folders');
  if (error) throw error;
  return data as Folder[];
}
export async function addFolder(name: string): Promise<Folder> {
  const { data, error } = await sb().from('folders').insert({ name: name.trim().slice(0, 80) }).select('id, name, created_at').single();
  if (missing(error)) throw new NotReady('Folders');
  if (error) throw error;
  return data as Folder;
}
export async function renameFolder(id: string, name: string) { const { error } = await sb().from('folders').update({ name: name.trim().slice(0, 80) }).eq('id', id); if (error) throw error; }
export async function removeFolder(id: string) { const { error } = await sb().from('folders').delete().eq('id', id); if (error) throw error; }

// ---------------- profile ----------------

export interface FullProfile extends Profile { avatar_url?: string | null; title?: string | null; phone?: string | null; city?: string | null; country?: string | null; prefs?: Partial<Prefs>; notify?: Partial<Notify>; extended: boolean }
export async function profile(): Promise<FullProfile | null> {
  const u = me(); if (!u) return null;
  const { data, error } = await sb().from('profiles').select('*').eq('id', u.id).maybeSingle();
  if (error) return null;
  if (!data) return null;
  return { ...(data as FullProfile), extended: 'prefs' in (data as object) };
}
export type ProfileFields = { full_name?: string | null; organisation?: string | null; role?: UserRole | null; title?: string | null; phone?: string | null; city?: string | null; country?: string | null; avatar_url?: string | null };
export async function saveProfileFields(f: ProfileFields) {
  const u = me(); if (!u) throw new Error('Sign in first.');
  const base = { full_name: f.full_name, organisation: f.organisation, role: f.role };
  const { error } = await sb().from('profiles').update(f).eq('id', u.id);
  if (missing(error)) {
    // (before the platform migration only the original fields exist: save those)
    const { error: e2 } = await sb().from('profiles').update(base).eq('id', u.id);
    if (e2) throw e2;
  } else if (error) throw error;
  if (f.full_name !== undefined) await sb().auth.updateUser({ data: { full_name: f.full_name } });
}
export async function uploadAvatar(file: File): Promise<string> {
  const u = me(); if (!u) throw new Error('Sign in first.');
  if (file.size > 2 * 1024 * 1024) throw new Error('Pick an image under 2 MB.');
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${u.id}/avatar-${Date.now().toString(36)}.${ext}`;
  const { error } = await sb().storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type });
  if (error) { if (/bucket/i.test(error.message)) throw new NotReady('Profile pictures'); throw error; }
  const url = sb().storage.from('avatars').getPublicUrl(path).data.publicUrl;
  await saveProfileFields({ avatar_url: url });
  return url;
}

// ---------------- preferences ----------------

export interface Prefs {
  theme: 'system' | 'light' | 'dark';
  area: 'm2' | 'sqft';
  /** large money as crore and lakh, or as millions */
  big: 'crore' | 'million';
  /** the planning authority a new project starts under */
  authority: string;
  /** the step a project opens on */
  start: 'site' | 'last';
  reduceMotion: boolean;
}
export const DEFAULT_PREFS: Prefs = { theme: 'system', area: 'sqft', big: 'crore', authority: 'pune', start: 'last', reduceMotion: false };
const PREFS_KEY = 'urbanplan:prefs', THEME_KEY = 'pune-remix:settings';
export const prefs = signal<Prefs>(readPrefs());
function readPrefs(): Prefs {
  try {
    const p = { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>) };
    const t = (JSON.parse(localStorage.getItem(THEME_KEY) ?? '{}') as { theme?: Prefs['theme'] }).theme;
    return t ? { ...p, theme: t } : p;
  } catch { return DEFAULT_PREFS; }
}
export function applyTheme(t: Prefs['theme']) {
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
/** change preferences: kept in this browser at once (the editor and the site read the theme from the same place),
 *  and in the profile when signed in and the platform tables are there */
export async function setPrefs(ch: Partial<Prefs>) {
  const n = { ...prefs.value, ...ch };
  prefs.value = n;
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(n));
    const s = JSON.parse(localStorage.getItem(THEME_KEY) ?? '{}');
    localStorage.setItem(THEME_KEY, JSON.stringify({ ...s, theme: n.theme }));
  } catch { /* private window: this session only */ }
  if (ch.theme) applyTheme(n.theme);
  const u = me();
  if (u && supabase) { const { error } = await supabase.from('profiles').update({ prefs: n }).eq('id', u.id); if (error && !missing(error)) throw error; }
}
/** the account's preferences over this browser's, once signed in */
export function adoptPrefs(p: Partial<Prefs> | undefined) {
  if (!p || !Object.keys(p).length) return;
  prefs.value = { ...prefs.value, ...p };
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs.value)); } catch { /* */ }
  applyTheme(prefs.value.theme);
}

export interface Notify { comments: boolean; invites: boolean; digest: 'weekly' | 'off'; product: boolean }
export const DEFAULT_NOTIFY: Notify = { comments: true, invites: true, digest: 'weekly', product: false };
export async function setNotify(n: Notify) {
  const u = me(); if (!u) throw new Error('Sign in first.');
  const { error } = await sb().from('profiles').update({ notify: n }).eq('id', u.id);
  if (missing(error)) throw new NotReady('Notification settings');
  if (error) throw error;
}

// ---------------- the account ----------------

export async function changeEmail(email: string) { const { error } = await sb().auth.updateUser({ email: email.trim() }, { emailRedirectTo: `${location.origin}${BASE}dashboard/#/settings/account` }); if (error) throw error; }
export async function changePassword(pw: string) { if (pw.length < 8) throw new Error('Use at least 8 characters.'); const { error } = await sb().auth.updateUser({ password: pw }); if (error) throw error; }
export async function signOutEverywhere() { await sb().auth.signOut({ scope: 'global' }); }
/** The account gone: every project's files first (Storage can't be cleared from SQL), then the rows and the sign-in. */
export async function deleteAccount() {
  for (const r of await mine()) await deleteProject(r.id);
  const { error } = await sb().rpc('delete_my_account');
  if (missing(error)) throw new NotReady('Deleting an account from here');
  if (error) throw error;
  await sb().auth.signOut();
}

export interface Usage { projects: number; bytes: number; versions: number; exact: boolean }
export async function usage(rows?: Row[]): Promise<Usage> {
  const { data, error } = await sb().rpc('my_usage');
  if (!error && data) { const d = (Array.isArray(data) ? data[0] : data) as { projects: number; bytes: number; versions: number }; return { projects: Number(d.projects), bytes: Number(d.bytes), versions: Number(d.versions), exact: true }; }
  const list = rows ?? await mine();
  return { projects: list.length, bytes: list.reduce((s, r) => s + (r.bytes ?? 0), 0), versions: 0, exact: false };
}

// ---------------- team and activity ----------------

export interface Person { email: string; role: 'editor' | 'viewer'; projects: { id: string; name: string }[]; joined: boolean }
/** everyone I've added to any of my projects */
export async function people(rows: Row[]): Promise<Person[]> {
  if (!rows.length) return [];
  const { data, error } = await sb().from('project_members').select('*').in('project', rows.map((r) => r.id));
  if (missing(error)) throw new NotReady('Teams');
  if (error) throw error;
  const by = new Map<string, Person>();
  for (const m of (data ?? []) as { project: string; email: string; role: 'editor' | 'viewer'; joined_at?: string | null }[]) {
    const x = by.get(m.email) ?? { email: m.email, role: m.role, projects: [], joined: false };
    x.projects.push({ id: m.project, name: rows.find((r) => r.id === m.project)?.name ?? 'Project' });
    if (m.role === 'editor') x.role = 'editor';
    if (m.joined_at) x.joined = true;
    by.set(m.email, x);
  }
  return [...by.values()].sort((a, b) => a.email.localeCompare(b.email));
}

export interface Event_ { id: string; project: string | null; kind: string; who: string; detail: string; at: string }
/** what happened lately on my projects and those shared with me: the activity feed, or the comments before it exists */
export async function activity(rows: Row[], limit = 40): Promise<Event_[]> {
  const ids = rows.map((r) => r.id);
  const { data, error } = await sb().from('activity').select('*').order('created_at', { ascending: false }).limit(limit);
  if (!error) return (data ?? []).map((a: { id: number; project: string | null; kind: string; actor_name: string | null; actor: string | null; detail: string | null; created_at: string }) => ({
    id: `a${a.id}`, project: a.project, kind: a.kind, who: a.actor === me()?.id ? 'You' : a.actor_name ?? 'Someone', detail: a.detail ?? '', at: a.created_at,
  }));
  if (!missing(error)) throw error;
  if (!ids.length) return [];
  const { data: c } = await sb().from('project_comments').select('*').in('project', ids).order('created_at', { ascending: false }).limit(limit);
  return (c ?? []).map((x: { id: number; project: string; author: string; author_name: string | null; body: string; created_at: string }) => ({
    id: `c${x.id}`, project: x.project, kind: 'commented', who: x.author === me()?.id ? 'You' : x.author_name ?? 'Someone', detail: x.body, at: x.created_at,
  }));
}

/** everything in my account as one file: profile, preferences and every project */
export async function exportAll(rows: Row[], onStep?: (done: number, of: number) => void): Promise<string> {
  const out: { format: string; exported: string; profile: FullProfile | null; prefs: Prefs; projects: unknown[] } = { format: 'urbanplan/account', exported: new Date().toISOString(), profile: await profile(), prefs: prefs.value, projects: [] };
  let i = 0;
  for (const r of rows) {
    try { out.projects.push({ id: r.id, name: r.name, updated_at: r.updated_at, file: JSON.parse(await fileText(r.id)) }); } catch { out.projects.push({ id: r.id, name: r.name, error: 'could not be read' }); }
    onStep?.(++i, rows.length);
  }
  return JSON.stringify(out, null, 1);
}
