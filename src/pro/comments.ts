// Comments in place (docs/plans/pro-global-ux.md §2.8): each one anchored to a point and the thing it was dropped on,
// grouped into threads (a comment and its replies). A project in the cloud keeps them in Supabase for everyone on it
// (./team.ts); a project only in this browser keeps them here, as notes to self, until it's saved to an account.
import { useEffect, useState } from 'preact/hooks';
import { session } from '../auth/auth';
import { addComment, comments as listCloud, deleteComment, resolveComment, type Anchor, type Comment } from './team';

export type { Anchor };
export interface Note { id: number | string; author: string; author_name: string | null; body: string; step: string | null; resolved: boolean; created_at: string; anchor?: Anchor | null }
/** a comment and its replies, oldest first; resolved with its first comment */
export interface Thread { root: Note; replies: Note[]; n: number }

export interface NoteStore {
  /** where they're kept: the project's people, or this browser */
  where: 'cloud' | 'local';
  list(): Promise<Note[]>;
  add(body: string, step: string, anchor: Anchor | null): Promise<void>;
  resolve(id: Note['id'], v: boolean): Promise<void>;
  remove(id: Note['id']): Promise<void>;
}

export function cloudNotes(pid: string): NoteStore {
  return {
    where: 'cloud',
    list: () => listCloud(pid) as Promise<Comment[]>,
    add: (body, step, anchor) => addComment(pid, body, step, anchor),
    resolve: (id, v) => resolveComment(Number(id), v),
    remove: (id) => deleteComment(Number(id)),
  };
}

const LOCAL = 'urbanplan:pro:notes';
const readLocal = (): Note[] => { try { return JSON.parse(localStorage.getItem(LOCAL) ?? '[]') as Note[]; } catch { return []; } };
const writeLocal = (n: Note[]) => { try { localStorage.setItem(LOCAL, JSON.stringify(n)); } catch { /* full or blocked */ } };
/** the notes kept with the project in this browser (cleared when a new project is started here) */
export const clearLocalNotes = () => { try { localStorage.removeItem(LOCAL); } catch { /* */ } };
export function localNotes(): NoteStore {
  return {
    where: 'local',
    list: async () => readLocal(),
    add: async (body, step, anchor) => {
      const text = body.trim().slice(0, 2000); if (!text) return;
      writeLocal([...readLocal(), { id: `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, author: 'me', author_name: null, body: text, step, resolved: false, created_at: new Date().toISOString(), anchor }]);
    },
    resolve: async (id, v) => writeLocal(readLocal().map((x) => (x.id === id ? { ...x, resolved: v } : x))),
    remove: async (id) => writeLocal(readLocal().filter((x) => x.id !== id && x.anchor?.reply !== id)),
  };
}

/** threads from a flat list: a reply goes under the comment it answers (one level), the rest stand alone */
export function threads(ns: Note[]): Thread[] {
  const roots = ns.filter((x) => x.anchor?.reply === undefined || !ns.some((y) => y.id === x.anchor!.reply));
  return roots.map((root) => { const replies = ns.filter((x) => x !== root && x.anchor?.reply === root.id); return { root, replies, n: 1 + replies.length }; });
}

/** open threads on each thing (by building, element or feature id; 'plot' for the plot) */
export function countsByThing(ts: Thread[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of ts) { if (t.root.resolved) continue; const o = t.root.anchor?.obj; if (!o) continue; const k = o.k === 'plot' ? 'plot' : o.id ?? ''; if (k) out[k] = (out[k] ?? 0) + 1; }
  return out;
}

/** the project's notes, reloaded every 20 s while it's in the cloud (a teammate's show up) and after every change */
export function useNotes(store: NoteStore | null) {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [err, setErr] = useState('');
  const key = store ? store.where : '';
  const reload = () => { if (store) void store.list().then((x) => { setNotes(x); setErr(''); }, (x: unknown) => setErr(x instanceof Error ? x.message : String(x))); };
  useEffect(() => {
    setNotes(null); reload();
    if (!store || store.where !== 'cloud') return;
    const t = setInterval(reload, 20000);
    return () => clearInterval(t);
  }, [store]);
  const run = async (f: () => Promise<unknown>) => { try { await f(); } catch (x) { setErr(x instanceof Error ? x.message : String(x)); } reload(); };
  return { notes, err, reload, run, key };
}

/** is this note mine (I may delete it) */
export const mine = (n: Note) => n.author === 'me' || n.author === session.value?.user.id;
