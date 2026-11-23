// Comments on the view: a numbered pin on each open thread, standing where it was dropped (on a building, over it as
// it's drawn now); a click opens the thread beside it to reply, resolve or delete. In comment mode (C, or Comment in
// the top bar) a click anywhere on the view drops a new one, on whatever's there, and the list of every thread opens
// on the right. See ./comments.ts.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ProView } from './scene';
import type { Evaluated } from './evaluate';
import { mine, threads, type Anchor, type Note, type Thread } from './comments';
import { Btn, Icon } from './ui';

const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
const who = (n: Note) => (mine(n) ? 'You' : n.author_name || 'Someone');

/** where a thread's pin stands: its point, kept on its building while that's where it was dropped */
export function pinAt(t: Thread, e: Evaluated): [number, number, number] | null {
  const a = t.root.anchor; if (!a?.at) return null;
  if (a.obj?.k === 'building' && a.obj.id) {
    const br = e.d.buildings.find((b) => b.b.id === a.obj!.id);
    if (!br) return a.at;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const q of br.quads) for (let k = 0; k + 1 < q.length; k += 2) { x0 = Math.min(x0, q[k]); x1 = Math.max(x1, q[k]); z0 = Math.min(z0, q[k + 1]); z1 = Math.max(z1, q[k + 1]); }
    // (still inside it: where it was put; the building moved away: over its middle)
    const [x, y, z] = a.at;
    return x >= x0 - 1 && x <= x1 + 1 && z >= z0 - 1 && z <= z1 + 1 ? [x, Math.min(y, br.height), z] : [(x0 + x1) / 2, br.height, (z0 + z1) / 2];
  }
  return a.at;
}

/** the open threads with a pin, numbered in the order they were made (the numbers the drawing set prints) */
export const pinned = (ts: Thread[]) => ts.filter((t) => !t.root.resolved && t.root.anchor?.at);

interface LayerProps {
  view: ProView | null; e: Evaluated; notes: Note[];
  /** comment mode: a click drops a pin */
  mode: boolean; setMode: (on: boolean) => void;
  openId: Note['id'] | null; setOpenId: (id: Note['id'] | null) => void;
  add: (body: string, anchor: Anchor) => void;
  resolve: (n: Note, v: boolean) => void; remove: (n: Note) => void;
  /** may resolve others' comments (an owner or editor; anyone, here in this browser) */
  canResolve: boolean; canDelete: (n: Note) => boolean;
  option?: string;
}

export function CommentLayer({ view, e, notes, mode, setMode, openId, setOpenId, add, resolve, remove, canResolve, canDelete, option }: LayerProps) {
  const ts = threads(notes), pins = pinned(ts);
  const els = useRef(new Map<Note['id'], HTMLElement>());
  const [draft, setDraft] = useState<{ anchor: Anchor; x: number; y: number } | null>(null);
  useEffect(() => {
    if (!view) return;
    const place = () => {
      const res = document.querySelector<HTMLElement>('.stage .results'), top = res ? res.offsetTop + res.offsetHeight + 4 : 4;
      for (const t of pins) {
        const el = els.current.get(t.root.id), at = pinAt(t, e); if (!el || !at) continue;
        const [sx, sy] = view.toScreen(...at);
        el.style.transform = `translate(${Math.round(sx)}px,${Math.round(Math.max(top + 28, sy))}px)`;
      }
    };
    place(); view.frameHooks.add(place);
    return () => { view.frameHooks.delete(place); };
  });
  useEffect(() => {
    if (!mode && !draft && openId === null) return;
    const key = (ev: KeyboardEvent) => { if (ev.key !== 'Escape') return; ev.stopImmediatePropagation(); if (draft) setDraft(null); else if (openId !== null) setOpenId(null); else setMode(false); };
    addEventListener('keydown', key, true); return () => removeEventListener('keydown', key, true);
  }, [mode, !!draft, openId]);
  useEffect(() => { if (!mode) setDraft(null); }, [mode]);

  // a click in comment mode: on a building, the point it was touched; else the ground there
  const drop = (ev: MouseEvent) => {
    if (!view || ev.target !== ev.currentTarget) return;
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top;
    const hit = view.buildingHit(ev.clientX, ev.clientY);
    let anchor: Anchor | null = null;
    if (hit) {
      const br = e.d.buildings.find((b) => b.b.id === hit.id);
      const g = view.groundAt(ev.clientX, ev.clientY, hit.y);
      if (br && g) anchor = { at: [g[0], hit.y, g[1]], obj: { k: 'building', id: hit.id } };
    }
    if (!anchor) { const g = view.groundAt(ev.clientX, ev.clientY); if (g) anchor = { at: [g[0], 0, g[1]] }; }
    if (!anchor) return;
    setOpenId(null);
    setDraft({ anchor: { ...anchor, ...(option ? { option } : {}) }, x, y });
  };

  return (
    <>
      {mode && <div class="cmode" onClick={drop} aria-label="Click to drop a comment" />}
      <div class="cpins-c" aria-label="Comments on the view">
        {pins.map((t, k) => {
          const open = openId === t.root.id;
          return (
            <div class={`cpin-w${open ? ' open' : ''}`} ref={(el) => { if (el) els.current.set(t.root.id, el); else els.current.delete(t.root.id); }}>
              <button type="button" class="cpin-n" aria-expanded={open} aria-label={`Comment ${k + 1}: ${t.root.body.slice(0, 60)}`} onClick={() => { setDraft(null); setOpenId(open ? null : t.root.id); }}>
                {k + 1}{t.replies.length ? <small>{t.n}</small> : null}
              </button>
              {open && <ThreadPop t={t} no={k + 1} close={() => setOpenId(null)} reply={(body) => add(body, { ...(t.root.anchor ?? {}), reply: t.root.id })}
                resolve={resolve} remove={remove} canResolve={canResolve} canDelete={canDelete} />}
            </div>
          );
        })}
      </div>
      {draft && (
        <div class="cpin-w open draft" style={`transform:translate(${Math.round(draft.x)}px,${Math.round(draft.y)}px)`}>
          <span class="cpin-n"><Icon n="plus" size={12} /></span>
          <Composer autoFocus place={draft.anchor.obj?.k === 'building' ? 'On this building' : 'Here'} send={(body) => { add(body, draft.anchor); setDraft(null); }} cancel={() => setDraft(null)} />
        </div>
      )}
    </>
  );
}

function Composer({ send, cancel, place, autoFocus, label = 'Comment' }: { send: (body: string) => void; cancel?: () => void; place?: string; autoFocus?: boolean; label?: string }) {
  const [text, setText] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);
  // (a new comment's box takes the keys at once: the click that dropped it was on the view)
  useEffect(() => { if (autoFocus) requestAnimationFrame(() => box.current?.focus()); }, []);
  const go = () => { if (text.trim()) { send(text); setText(''); } };
  return (
    <form class="cpop-new" onSubmit={(ev) => { ev.preventDefault(); go(); }}>
      {place && <small class="muted">{place}</small>}
      <textarea class="txt" rows={2} maxLength={2000} placeholder={label === 'Reply' ? 'Reply…' : 'A comment…'} value={text} ref={box} aria-label={label}
        onInput={(ev) => setText((ev.target as HTMLTextAreaElement).value)}
        onKeyDown={(ev) => { if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey || !ev.shiftKey)) { ev.preventDefault(); go(); } }} />
      <div class="cpop-a">{cancel && <Btn kind="quiet" onClick={cancel}>Cancel</Btn>}<Btn kind="primary" submit disabled={!text.trim()}>{label}</Btn></div>
    </form>
  );
}

function ThreadPop({ t, no, close, reply, resolve, remove, canResolve, canDelete }: { t: Thread; no: number; close: () => void; reply: (body: string) => void; resolve: (n: Note, v: boolean) => void; remove: (n: Note) => void; canResolve: boolean; canDelete: (n: Note) => boolean }) {
  const r = t.root;
  return (
    <div class="cpop" role="dialog" aria-label={`Comment ${no}`} onClick={(ev) => ev.stopPropagation()}>
      <header>
        <b>Comment {no}</b><span class="gap" />
        {(canResolve || mine(r)) && <Btn kind="quiet" icon="check" title={r.resolved ? 'Reopen it' : 'Resolve it: the pin goes'} onClick={() => resolve(r, !r.resolved)} />}
        <Btn kind="quiet" icon="x" title="Close (Esc)" onClick={close} />
      </header>
      <ul class="cthread">{[r, ...t.replies].map((n) => (
        <li><div class="cmt-h"><b>{who(n)}</b><span>{ago(n.created_at)}</span>{canDelete(n) && <button type="button" class="linkbtn" onClick={() => remove(n)}>Delete</button>}</div><p>{n.body}</p></li>
      ))}</ul>
      <Composer label="Reply" send={reply} />
    </div>
  );
}

/** Every thread, open first: on the right in comment mode. A click opens its pin (and picks what it's on). */
export function CommentList({ notes, err, where, open, close, showDone, setShowDone, offNote }: { notes: Note[] | null; err: string; where: 'cloud' | 'local'; open: (t: Thread) => void; close: () => void; showDone: boolean; setShowDone: (v: boolean) => void; offNote?: string }) {
  const ts = threads(notes ?? []), live = ts.filter((t) => !t.root.resolved), done = ts.filter((t) => t.root.resolved), nums = new Map(pinned(ts).map((t, k) => [t.root.id, k + 1]));
  const Item = ({ t }: { t: Thread }) => (
    <li><button type="button" class={`clist-i${t.root.resolved ? ' done' : ''}`} onClick={() => open(t)}>
      {nums.has(t.root.id) ? <i class="cpin-n sm">{nums.get(t.root.id)}</i> : <i class="cpin-n sm none" title="Not pinned to the view">·</i>}
      <span><b>{who(t.root)}<small>{ago(t.root.created_at)}{t.replies.length ? ` · ${t.replies.length} repl${t.replies.length === 1 ? 'y' : 'ies'}` : ''}</small></b><span class="clist-b">{t.root.body}</span></span>
    </button></li>
  );
  return (
    <aside class="insp clist" aria-label="Comments">
      <header><div class="insp-t"><b>Comments</b><small>{live.length} open{where === 'local' ? ' · notes in this browser' : ''}</small></div><Btn kind="quiet" icon="x" title="Stop commenting (Esc)" onClick={close} /></header>
      <div class="insp-b">
        <p class="note">Click the view to drop a comment on a building or a spot.{where === 'local' ? ' This project is only in this browser, so these are notes to yourself: save it to your account to comment with your team.' : ''}</p>
        {offNote && <p class="note warn">{offNote}</p>}
        {err && <p class="note bad">{err}</p>}
        {!notes && !err && <p class="note">Loading…</p>}
        {notes && !live.length && <p class="note">No open comments.</p>}
        <ul class="clist-l">{[...live].reverse().map((t) => <Item t={t} />)}</ul>
        {done.length > 0 && <button type="button" class="linkbtn" onClick={() => setShowDone(!showDone)}>{showDone ? 'Hide' : 'Show'} {done.length} resolved</button>}
        {showDone && <ul class="clist-l">{[...done].reverse().map((t) => <Item t={t} />)}</ul>}
      </div>
    </aside>
  );
}
