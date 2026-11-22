// The step's sheet over the view (it used to be a fixed column beside it):
// - on a wide screen a drawer over the 3D's left edge; pinned (the pin, or /), it docks beside the view instead;
// - on a phone a sheet up from the steps bar, at three heights (a peek, half, nearly all), dragged by its grip;
// - it says how much of the view it covers (`cover`), so the 3D keeps its middle in what's seen and the view's own
//   tools move clear of it;
// - opened, focus goes to its title; closed, back to what opened it; Esc in it closes it.
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Btn } from './ui';

export type Detent = 'peek' | 'half' | 'full';
/** each height as a share of the room over the steps bar */
const AT: Record<Detent, number> = { peek: 0.3, half: 0.56, full: 0.94 };
/** a narrow screen: the sheet comes up from the bottom (layout only; what a phone may do is ../device.ts) */
export const NARROW = '(max-width: 900px)';

export function useNarrow() {
  const [on, setOn] = useState(() => typeof matchMedia !== 'undefined' && matchMedia(NARROW).matches);
  useEffect(() => { const m = matchMedia(NARROW), f = () => setOn(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f); }, []);
  return on;
}

export function Sheet({ title, open, pinned, setPinned, close, phone, detent, setDetent, cover, footer, children }: {
  title: string; open: boolean; pinned: boolean; setPinned: (on: boolean) => void; close: () => void;
  phone: boolean; detent: Detent; setDetent: (d: Detent) => void;
  /** how much of the view it covers: from the left, from the bottom (px) */
  cover: (x: number, y: number) => void;
  footer?: ComponentChildren; children: ComponentChildren;
}) {
  const root = useRef<HTMLElement>(null), head = useRef<HTMLHeadingElement>(null), from = useRef<HTMLElement | null>(null);
  // (a drag of the grip: where it began, and the height it's at)
  const drag = useRef<{ y0: number; h0: number; room: number } | null>(null);
  const [dragH, setDragH] = useState<number | null>(null);
  const room = () => Math.max(200, innerHeight - 52 - 64);

  // focus in when it opens (from a step, a figure, Inspect), back to the opener when it closes
  useEffect(() => {
    if (!open) return;
    from.current = document.activeElement instanceof HTMLElement && !root.current?.contains(document.activeElement) ? document.activeElement : null;
    // (not when it opened because something on the view was picked: the view keeps the keys then)
    if (from.current && from.current !== document.body && !from.current.closest('.stage')) head.current?.focus({ preventScroll: true });
    return () => { const f = from.current; if (f && f.isConnected && root.current?.contains(document.activeElement ?? null) !== false) f.focus({ preventScroll: true }); };
  }, [open, title]);

  // what it covers, as it's laid out
  useLayoutEffect(() => {
    const el = root.current;
    if (!open || !el) { cover(0, 0); return; }
    const f = () => { const r = el.getBoundingClientRect(); if (phone) cover(0, Math.round(r.height)); else cover(pinned ? 0 : Math.round(r.width), 0); };
    f();
    const ro = new ResizeObserver(f); ro.observe(el);
    return () => ro.disconnect();
  }, [open, pinned, phone]);
  useEffect(() => () => cover(0, 0), []);

  if (!open) return null;
  const h = phone ? (dragH ?? Math.round(room() * AT[detent])) : undefined;
  const grip = (ev: PointerEvent) => {
    if (!phone || ev.button !== 0) return;
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    drag.current = { y0: ev.clientY, h0: h!, room: room() };
  };
  const move = (ev: PointerEvent) => { const d = drag.current; if (!d) return; setDragH(Math.max(80, Math.min(d.room * AT.full, d.h0 + d.y0 - ev.clientY))); };
  const up = (ev: PointerEvent) => {
    const d = drag.current; if (!d) return; drag.current = null;
    const now = Math.max(80, d.h0 + d.y0 - ev.clientY), moved = Math.abs(ev.clientY - d.y0) > 6;
    setDragH(null);
    // (a tap on the grip steps it up a height, from the top back down to a peek)
    if (!moved) { setDetent(detent === 'peek' ? 'half' : detent === 'half' ? 'full' : 'peek'); return; }
    if (now < d.room * AT.peek * 0.6) { close(); return; }
    const near = (Object.keys(AT) as Detent[]).reduce((a, b) => (Math.abs(AT[b] * d.room - now) < Math.abs(AT[a] * d.room - now) ? b : a));
    setDetent(near);
  };
  const keys = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape' && !ev.defaultPrevented && !(ev.target as HTMLElement).closest('[role="listbox"], [aria-expanded="true"]')) { ev.preventDefault(); ev.stopPropagation(); close(); }
  };
  return (
    <aside ref={root} class={`panel sheet${phone ? ' phone' : pinned ? ' docked' : ' drawer'}${dragH !== null ? ' dragging' : ''}`} aria-label={title} style={h !== undefined ? `height:${h}px` : undefined} onKeyDown={keys}>
      {phone && <div class="grip" role="slider" tabIndex={0} aria-label="Sheet height" aria-valuetext={detent === 'peek' ? 'low' : detent === 'half' ? 'half' : 'full'} aria-valuemin={0} aria-valuemax={2} aria-valuenow={['peek', 'half', 'full'].indexOf(detent)}
        onPointerDown={grip} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; setDragH(null); }}
        onKeyDown={(ev) => { const o: Detent[] = ['peek', 'half', 'full'], i = o.indexOf(detent); if (ev.key === 'ArrowUp' && i < 2) { ev.preventDefault(); setDetent(o[i + 1]); } if (ev.key === 'ArrowDown') { ev.preventDefault(); if (i > 0) setDetent(o[i - 1]); else close(); } }}><i /></div>}
      <header class="panel-h">
        <div><h2 ref={head} tabIndex={-1}>{title}</h2></div>
        {!phone && <Btn kind="quiet" icon="panel" title={pinned ? 'Float it over the view again (/)' : 'Pin it beside the view (/)'} onClick={() => setPinned(!pinned)} />}
        <Btn kind="quiet" icon="x" title="Close (Esc)" onClick={close} />
      </header>
      {children}
      {footer}
    </aside>
  );
}
