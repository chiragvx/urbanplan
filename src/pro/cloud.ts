// Pro projects in the signed-in user's account: the same `projects` table, bucket and saved versions as the
// editor's maps (src/app/cloud.ts, supabase/migrations/0002_projects.sql), told apart by `region` 'pro:<city>'.
// The file is the project as JSON (format 'urbanplan/pro'); the browser's own copy stays first, the cloud a few
// seconds behind, and a save from an older revision than the cloud holds is kept as a copy. A project shared with
// the user (./team.ts) opens with their role: an editor saves into the owner's file, a viewer only reads.
import { listProjects, readProject, saveProject, deleteProject, type Project, type Saved } from '../app/cloud';
import { session, supabase } from '../auth/auth';
import type { MapMeta } from '../doc/types';
import { DEFAULT_PROJECT, type ProProject } from './project';

export const FORMAT = 'urbanplan/pro';
export type Role = 'owner' | 'editor' | 'viewer';
export type CloudRef = { id: string; rev: number; owner?: string; role?: Role } | null;

export const listPro = (): Promise<Project[]> => listProjects('pro');
/** other people's Pro projects this user was added to */
export const listSharedPro = (): Promise<Project[]> => listProjects('pro', true).catch(() => []);
export const deletePro = (id: string) => deleteProject(id);

/** The project's file: everything but where it's saved. */
export const toText = (p: ProProject) => JSON.stringify({ format: FORMAT, ...p });

async function roleOn(id: string, owner: string | undefined): Promise<Role> {
  const me = session.value?.user;
  if (!me || !owner || owner === me.id) return 'owner';
  const { data } = await supabase!.from('project_members').select('role').eq('project', id).eq('email', (me.email ?? '').toLowerCase()).maybeSingle();
  return (data?.role as Role | undefined) ?? 'viewer';
}

export async function openPro(id: string): Promise<{ p: ProProject; ref: CloudRef }> {
  const { text, project } = await readProject(id);
  const f = JSON.parse(text);
  if (f.format !== FORMAT) throw new Error('That project isn’t a Pro project.');
  const { format: _, ...rest } = f;
  const role = await roleOn(project.id, project.owner);
  // (when it was last opened, for the dashboard's "recent": quiet before 0006_platform.sql)
  void supabase?.from('projects').update({ opened_at: new Date().toISOString() }).eq('id', project.id).then(() => undefined, () => undefined);
  return { p: { ...DEFAULT_PROJECT, ...rest, v: 1 }, ref: { id: project.id, rev: project.revision, owner: project.owner, role } };
}

export async function savePro(p: ProProject, ref: CloudRef, version = false): Promise<Saved> {
  const mine = !ref?.role || ref.role === 'owner';
  const meta = { name: p.name, tile: `pro:${p.city}`, cloud: ref ? { id: ref.id, rev: ref.rev, owner: mine ? undefined : ref.owner } : null } as unknown as MapMeta;
  const saved = await saveProject(meta, toText(p), 1, { version });
  void keepSummary(saved.id, p);
  return saved;
}

/** the dashboard's card for the project (0006_platform.sql's `summary`), written when it changes; quiet when the
 *  column isn't there yet or the summary can't be worked out */
const summaries = new Map<string, string>();
async function keepSummary(id: string, p: ProProject) {
  try {
    const { summaryOf } = await import('../dash/summary');
    const text = JSON.stringify(summaryOf(p));
    if (summaries.get(id) === text) return;
    summaries.set(id, text);
    await supabase?.from('projects').update({ summary: JSON.parse(text) }).eq('id', id);
  } catch { /* the card can wait */ }
}
