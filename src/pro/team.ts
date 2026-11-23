// A project's team and its comments (supabase/migrations/0004_project_team.sql). The owner adds people by email, as
// an editor (opens and saves it) or a viewer (opens it and comments); everyone on it reads and writes the comments,
// each tagged with the step it was written on. Row-level security decides who sees what; this only asks.
import { session, shortName, supabase } from '../auth/auth';
import type { Role } from './cloud';

export interface Member { project: string; email: string; role: Exclude<Role, 'owner'>; created_at: string; joined_at?: string | null; invited_at?: string | null }
export interface Comment { id: number; project: string; author: string; author_name: string | null; body: string; step: string | null; resolved: boolean; created_at: string; anchor?: Anchor | null }
/** what a comment is about (supabase/migrations/0007_comment_anchors.sql): a point, the thing it was dropped on, the
 *  option it was made on, and the comment it replies to */
export interface Anchor { at?: [number, number, number]; obj?: { k: 'building' | 'element' | 'feature' | 'plot'; id?: string }; option?: string; reply?: number | string }
/** set once an insert found no anchor column (0007 not run): comments are saved without their pins */
export let anchorsOff = false;

/** The tables aren't there yet (the migration hasn't been run on this Supabase project). */
export class NotSetUp extends Error {}
const check = <T>(r: { data: T | null; error: { code?: string; message: string } | null }): T => {
  if (r.error) {
    if (r.error.code === '42P01' || r.error.code === 'PGRST205' || /does not exist|schema cache/i.test(r.error.message)) throw new NotSetUp('Teams aren’t switched on for this site yet.');
    throw new Error(r.error.message);
  }
  return r.data as T;
};
const sb = () => { if (!supabase) throw new NotSetUp('Accounts aren’t set up on this site.'); return supabase; };

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function members(project: string): Promise<Member[]> {
  return check(await sb().from('project_members').select('*').eq('project', project).order('created_at'));
}
export async function addMember(project: string, email: string, role: Member['role']) {
  const e = email.trim().toLowerCase();
  if (!EMAIL.test(e)) throw new Error('That isn’t an email address.');
  if (e === (session.value?.user.email ?? '').toLowerCase()) throw new Error('That’s you: you own this project.');
  check(await sb().from('project_members').upsert({ project, email: e, role }, { onConflict: 'project,email' }));
}
export async function removeMember(project: string, email: string) {
  check(await sb().from('project_members').delete().eq('project', project).eq('email', email));
}

/** The project's address: anyone on its team opens it with this once signed in with their email. */
export const projectLink = (project: string) => new URL(`${import.meta.env.BASE_URL}pro/?p=${project}`, location.origin).href;

/** Mark the signed-in person as joined (0005_project_invites.sql). Best effort: no table, no matter. */
export async function joinProject(project: string) {
  try { await supabase?.rpc('join_project', { pid: project }); } catch { /* not set up */ }
}

/** Email them the invite (api/invite.js). 'off' when the site has no email set up: then the link is the way. */
export async function sendInvite(project: string, email: string): Promise<'sent' | 'off'> {
  const token = session.value?.access_token;
  if (!token) throw new Error('Sign in first.');
  let r: Response;
  try { r = await fetch(`${import.meta.env.BASE_URL}api/invite`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ project, email }) }); } catch { return 'off'; }
  if (r.status === 501 || r.status === 404 && !(r.headers.get('content-type') ?? '').includes('json')) return 'off';
  if (r.ok) return 'sent';
  const j = await r.json().catch(() => ({}));
  throw new Error(j.error || 'The invite didn’t send.');
}

export async function comments(project: string): Promise<Comment[]> {
  return check(await sb().from('project_comments').select('*').eq('project', project).order('created_at'));
}
export async function addComment(project: string, body: string, step: string, anchor?: Anchor | null) {
  const u = session.value?.user;
  if (!u) throw new Error('Sign in to comment.');
  const text = body.trim().slice(0, 2000);
  if (!text) return;
  const row = { project, body: text, step, author_name: shortName(u).slice(0, 80) };
  if (anchor && !anchorsOff) {
    const r = await sb().from('project_comments').insert({ ...row, anchor });
    // (no anchor column yet: 0007 hasn't been run; saved without it)
    if (!r.error) return;
    if (!/anchor/i.test(r.error.message)) check(r);
    anchorsOff = true;
  }
  check(await sb().from('project_comments').insert(row));
}
export async function resolveComment(id: number, resolved: boolean) {
  check(await sb().from('project_comments').update({ resolved }).eq('id', id));
}
export async function deleteComment(id: number) {
  check(await sb().from('project_comments').delete().eq('id', id));
}
