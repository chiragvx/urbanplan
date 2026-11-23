// A picked building's form, edited on the view (Phase 4 of docs/plans/editor-in-view.md):
// - its key floors as rings at their heights, each with a scale dot (drag: wider or narrower; Shift: across only;
//   double-click: take the key away), a lean diamond in its middle, and at the top a twist handle;
// - a strip beside it of what its floors are for, bottom to top: drag a boundary for more or fewer floors of each,
//   click a band to change its use, take it away or see it in X-ray; + adds a band on top;
// - a slot's start and end as handles up its face;
// - with X-ray on, a floor scrubber beside any picked building.
// And `BarExtras`, the popovers on the building's bar: Shape (presets, rounding, key floors, slot, fins), Roof, Skin,
// Mix (its own or the project's, dividers to drag) and Style (the design system).
// A drag is one undo step; in shaded or X-ray view it moves outlines only, and the form is laid out on release.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { sampleCurve, toLocal, toWorld, USE_INFO, type BuildingUse, type Form, type KeyFloor } from './form';
import { byUse } from '../doc/uses';
import { keyAt, keyed, keysOf, previewFloors, slotCarve, sortedKeys, yOfT } from './silhouette';
import { usePins, type Tx } from './hud';
import { own, type CanvasEdit, type Picked } from './edit';
import type { Evaluated } from './evaluate';
import type { ProBuilding, ProProject } from './project';
import type { ProView } from './scene';
import { IconPick, ROOFS, rounded, roundness, same, SHAPES, SKINS, USE_FLOORS, USES, withForm, type Preset } from './shapePanel';
import { presetOf, PRESETS } from './design';
import { UNIT_LABEL } from '../doc/site';
import { Icon, Range, Seg, Toggle } from './ui';
import type { RoofKind, SkinPattern } from './form';

type W3 = [number, number, number];
const r2 = (x: number) => Math.round(x * 100) / 100;
/** a use's colour on the strip */
const USE_COLOR: Record<BuildingUse, string> = byUse('color');

/** the keys as the procedure reads them, made real (the stand-ins at the ground and the top become keys) */
const withKeys = (f: Form): Form => ({ ...f, keys: keysOf(f).map((k) => ({ ...k })) });
const bboxOf = (r: number[]) => { let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity; for (let i = 0; i + 1 < r.length; i += 2) { a = Math.min(a, r[i]); b = Math.max(b, r[i]); c = Math.min(c, r[i + 1]); d = Math.max(d, r[i + 1]); } return { x0: a, x1: b, z0: c, z1: d, cx: (a + b) / 2, cz: (c + d) / 2 }; };
/** a local point moved by a key floor (its scale, turn and shift) */
const through = (k: KeyFloor, x: number, z: number): [number, number] => { const o = keyed([x, z], k); return [o[0], o[1]]; };
/** a local point taken back through a key's turn and shift (not its scale) */
const unturn = (k: KeyFloor, x: number, z: number): [number, number] => { const a = (-k.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), X = x - k.dx, Z = z - k.dz; return [X * c - Z * s, X * s + Z * c]; };

/** Popovers that close on a click outside or Escape (the select lists are portalled: clicks there count as inside). */
export function usePop(root: { current: HTMLElement | null }) {
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    const down = (ev: PointerEvent) => { const t = ev.target as HTMLElement; if (!t.closest?.('.hpop') && !t.closest?.('.sel-pop') && !t.closest?.(`[data-pop="${open}"]`)) setOpen(null); };
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && !(ev.target as HTMLElement)?.closest?.('.sel-pop')) { ev.stopImmediatePropagation(); setOpen(null); } };
    document.addEventListener('pointerdown', down, true); addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', down, true); removeEventListener('keydown', key, true); };
  }, [open]);
  // (it opens upward when what opened it is in the lower half of the view)
  const where = (id: string) => { const R = root.current?.closest('.hud') ?? root.current, b = R?.querySelector(`[data-pop="${id}"]`)?.getBoundingClientRect(), r = R?.getBoundingClientRect(); return !b || !r ? '' : `${b.top - r.top > r.height / 2 ? ' up' : ''}${b.left - r.left > r.width - 300 ? ' end' : ''}`; };
  const pop = (id: string, body: ComponentChildren, cls = '') => open === id && <div class={`hpop${cls ? ` ${cls}` : where(id)}`} role="dialog" onKeyDown={(ev) => ev.stopPropagation()}>{body}</div>;
  const toggle = (id: string) => setOpen(open === id ? null : id);
  return { open, setOpen, pop, toggle };
}

interface Props {
  view: ProView | null; edit: CanvasEdit | null; p: ProProject; e: Evaluated; picked: Picked; tx: Tx;
  live: boolean; readOnly: boolean; xray: number | null; setXray: (n: number | null) => void; toast: (s: string) => void;
}
type FDrag =
  | { k: 's' | 'l' | 'r'; i: number; base: ProProject; e: Evaluated; f: Form; last?: number; acc?: number; timer: number; pending: Form | null; changed?: boolean }
  | { k: 'cut'; id: string; end: 'from' | 'to'; base: ProProject; e: Evaluated; f: Form; timer: number; pending: Form | null; changed?: boolean; s0: number; s1: number };

export function FormHud({ view, edit, p, e, picked, tx, live, readOnly, xray, setXray, toast }: Props) {
  const { root, at, box, ref, spans, span } = usePins(view);
  const [pv, setPv] = useState<Form | null>(null);
  const [usesPv, setUsesPv] = useState<Form['uses'] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const drag = useRef<FDrag | null>(null);
  const strip = useRef<HTMLDivElement>(null);
  const { open, setOpen, pop, toggle } = usePop(root);

  const bi = picked?.k === 'building' ? e.d.buildings.findIndex((x) => x.b.id === picked.id) : -1;
  const br = bi >= 0 ? e.d.buildings[bi] : null;
  const saved = br ? ((p.scheme?.buildings.find((b) => b.id === br.b.id) ?? { ...br.b, floors: br.floors }) as ProBuilding) : null;
  const f0 = saved?.form ?? null;
  const f = pv ?? (f0 && usesPv ? { ...f0, uses: usesPv } : f0);
  const show = !!(br && saved && view && !readOnly);

  // ---------- the rings, drawn on the view ----------
  const fl = f ? previewFloors(f) : [];
  const plan = f ? sampleCurve(f.plan, 1.5) : [];
  const bb = bboxOf(plan), hw0 = Math.max(0.5, (bb.x1 - bb.x0) / 2);
  const keys = f && xray === null ? keysOf(f) : [];
  const W = (x: number, z: number, y: number): W3 => { const [X, Z] = toWorld(saved!, x, z); return [X, y, Z]; };
  const ringKey = f && saved ? JSON.stringify([f.plan, f.keys, f.ease, f.uses, saved.spine, show]) : '';
  useEffect(() => {
    if (!edit || !f || !saved || !show || xray !== null) return;
    const L: number[] = [];
    for (const k of keys) {
      const y = yOfT(fl, k.t), r = keyed(plan, k);
      for (let i = 0; i + 1 < r.length; i += 2) { const j = (i + 2) % r.length, a = toWorld(saved, r[i], r[i + 1]), b = toWorld(saved, r[j], r[j + 1]); L.push(a[0], y, a[1], b[0], y, b[1]); }
    }
    edit.decor = pv ? { dashed: L } : { lines: L };
    edit.draw();
    return () => { edit.decor = null; edit.draw(); };
  }, [ringKey, edit, !!pv, xray === null]);
  useEffect(() => {
    if (!dragging) return;
    const k = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && drag.current) { ev.stopImmediatePropagation(); clearTimeout(drag.current.timer); drag.current = null; setDragging(null); setPv(null); setUsesPv(null); tx.cancel(); } };
    addEventListener('keydown', k, true);
    return () => removeEventListener('keydown', k, true);
  }, [dragging]);
  // (a new building picked: nothing of the last one's is kept)
  useEffect(() => { setPv(null); setUsesPv(null); setOpen(null); }, [picked && 'id' in picked ? picked.id : null]);

  if (!show || !br || !saved) { at.current.clear(); box.current = []; spans.current.clear(); return <div class="hud" ref={root} />; }

  const name = saved.name ?? `Building ${String.fromCharCode(65 + bi)}`;
  const withB = (base: ProProject, be: Evaluated, fn: (b: ProBuilding) => ProBuilding): Partial<ProProject> => {
    const s = own(base, be);
    return { scheme: { ...s, buildings: s.buildings.map((b) => (b.id === br.b.id ? fn(b) : b)) } };
  };
  const once = (o: Partial<ProProject>) => { tx.begin(); tx.live(o); tx.commit(); };
  const setForm = (nf: Form) => once(withB(p, e, (b) => withForm(b, nf)));

  // ---------- anchors ----------
  const H = fl.length ? fl[fl.length - 1].y + fl[fl.length - 1].h : br.height;
  const ctr = W(bb.cx, bb.cz, 0);
  const A: [string, W3][] = [];
  if (f) {
    keys.forEach((k, i) => {
      const y = yOfT(fl, k.t);
      const [sx, sz] = through(k, bb.cx + hw0, bb.cz), [lx, lz] = through(k, bb.cx, bb.cz);
      A.push([`s${i}`, W(sx, sz, y)], [`l${i}`, W(lx, lz, y)]);
      if (i === keys.length - 1) {
        const R = hw0 * Math.max(Math.abs(k.sx), Math.abs(k.sz)) + 2.5, a = ((k.rot + 90) * Math.PI) / 180;
        A.push([`r${i}`, W(lx + R * Math.cos(a), lz + R * Math.sin(a), y)]);
      }
    });
    for (const c of xray === null ? f.carves : []) {
      const cb = bboxOf(sampleCurve(c.ring, 1));
      for (const end of ['from', 'to'] as const) { const t = c[end], k = keyAt(f, t), [x, z] = through(k, cb.cx, cb.z0); A.push([`c${end}${c.id}`, W(x, z, yOfT(fl, t))]); }
    }
  }
  at.current = new Map(A);
  box.current = br.quads.flatMap((q) => { const o: W3[] = []; for (let i = 0; i + 1 < q.length; i += 2) o.push([q[i], 0, q[i + 1]], [q[i], br.height, q[i + 1]]); return o; });
  const S = new Map<string, { a: W3; b: W3; side: 1 | -1 }>();
  if (f) S.set('strip', { a: [ctr[0], 0, ctr[2]], b: [ctr[0], H, ctr[2]], side: 1 });
  if (xray !== null) S.set('scrub', { a: [ctr[0], 0, ctr[2]], b: [ctr[0], br.height, ctr[2]], side: -1 });
  spans.current = S;

  // ---------- dragging a ring's handles ----------
  const formOf = (d: FDrag, ev: PointerEvent): Form | null => {
    const v = view!, ks = d.f.keys.map((k) => ({ ...k }));
    if (d.k === 'cut') {
      // (up the face: where the pointer is between the screen heights of the form's bottom and top)
      const t = Math.min(1, Math.max(0, (d.s0 - ev.clientY) / (d.s0 - d.s1 || 1)));
      const c = d.f.carves.find((x) => x.id === d.id); if (!c) return null;
      const tt = r2(d.end === 'from' ? Math.min(t, c.to - 0.02) : Math.max(t, c.from + 0.02));
      return { ...d.f, carves: d.f.carves.map((x) => (x.id === d.id ? { ...x, [d.end]: tt } : x)) };
    }
    const k = ks[d.i]; if (!k) return null;
    const y = yOfT(previewFloors(d.f), k.t), g = v.groundAt(ev.clientX, ev.clientY, y); if (!g) return null;
    const [qx, qz] = toLocal(saved, g[0], g[1]), alt = ev.altKey;
    if (d.k === 's') {
      const [ux] = unturn(k, qx, qz), base = bb.cx + hw0;
      const s = Math.max(0.15, Math.min(4, Math.round((ux / (Math.abs(base) > 0.5 ? base : hw0)) * 100) / 100));
      if (!ev.shiftKey) k.sz = r2(k.sz * (s / (k.sx || 1)));
      k.sx = s;
    } else if (d.k === 'l') {
      // (its middle where the pointer is: the shift the key needs for that)
      const g0 = alt ? 0.1 : 0.5, [mx, mz] = through({ ...k, dx: 0, dz: 0 }, bb.cx, bb.cz);
      k.dx = Math.round((qx - mx) / g0) * g0; k.dz = Math.round((qz - mz) / g0) * g0;
      k.dx = Math.round(k.dx * 10) / 10; k.dz = Math.round(k.dz * 10) / 10;
    } else {
      const [mx, mz] = through(k, bb.cx, bb.cz), a = (Math.atan2(qz - mz, qx - mx) * 180) / Math.PI;
      if (d.last === undefined) { d.last = a; d.acc = k.rot; }
      let da = a - d.last; da = ((da + 540) % 360) - 180; d.last = a; d.acc = (d.acc ?? 0) + da;
      k.rot = alt ? Math.round(d.acc) : Math.round(d.acc / 5) * 5;
    }
    return { ...d.f, keys: ks };
  };
  const flush = () => { const d = drag.current; if (d?.pending) { tx.live(withB(d.base, d.e, (b) => withForm(b, d.pending!))); d.pending = null; d.changed = true; } };
  const start = (d: FDrag, ev: PointerEvent) => {
    ev.preventDefault(); ev.stopPropagation();
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    drag.current = d; tx.begin(); setDragging(d.k === 'cut' ? `c${d.end}${d.id}` : `${d.k}${d.i}`);
  };
  const down = (k: 's' | 'l' | 'r', i: number) => (ev: PointerEvent) => {
    if (!f || ev.button !== 0) return;
    if (ev.detail >= 2) return; // (a double-click takes the key away instead)
    start({ k, i, base: p, e, f: withKeys(f), timer: 0, pending: null }, ev);
  };
  const downCut = (id: string, end: 'from' | 'to') => (ev: PointerEvent) => {
    if (!f || ev.button !== 0 || !view) return;
    const s0 = view.toScreen(ctr[0], 0, ctr[2])[1], s1 = view.toScreen(ctr[0], H, ctr[2])[1];
    const r = view.canvas.getBoundingClientRect();
    start({ k: 'cut', id, end, base: p, e, f, timer: 0, pending: null, s0: s0 + r.top, s1: s1 + r.top }, ev);
  };
  const move = (ev: PointerEvent) => {
    const d = drag.current; if (!d) return;
    const nf = formOf(d, ev); if (!nf || same(nf, d.pending ?? d.f)) return;
    d.pending = nf;
    if (!live) { setPv(nf); d.changed = true; return; }
    setPv(nf);
    if (!d.timer) { flush(); d.timer = window.setTimeout(function tick() { const dd = drag.current; if (!dd) return; if (dd.pending) { flush(); dd.timer = window.setTimeout(tick, 120); } else dd.timer = 0; }, 120); }
  };
  const end = () => {
    const d = drag.current; if (!d) return;
    clearTimeout(d.timer);
    const last = d.pending ?? pv;
    if (last && !live) { tx.live(withB(d.base, d.e, (b) => withForm(b, last))); d.changed = true; }
    else flush();
    drag.current = null; setDragging(null); setPv(null);
    if (d.changed) tx.commit(`${d.k === 's' ? 'Width' : d.k === 'l' ? 'Lean' : d.k === 'r' ? 'Twist' : 'Slot'} · ${name}`); else tx.cancel();
  };
  const removeKey = (i: number) => {
    if (!f) return;
    const g = withKeys(f);
    if (i === 0 || i === g.keys.length - 1) { toast('The bottom and top key floors stay: drag them instead.'); return; }
    setForm({ ...g, keys: g.keys.filter((_, j) => j !== i) });
  };
  /** a key's arrow keys: wider or narrower (scale), along and across (lean), turn (twist) */
  const keysFor = (k: 's' | 'l' | 'r', i: number) => (ev: KeyboardEvent) => {
    if (!f) return;
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && k === 's') { ev.preventDefault(); ev.stopPropagation(); removeKey(i); return; }
    const dx = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0, dy = ev.key === 'ArrowUp' ? 1 : ev.key === 'ArrowDown' ? -1 : 0;
    if (!dx && !dy) return;
    ev.preventDefault(); ev.stopPropagation();
    const g = withKeys(f), q = g.keys[i]; if (!q) return;
    const big = ev.shiftKey;
    if (k === 's') { const s = Math.max(0.15, Math.min(4, r2(q.sx + (dx || dy) * (big ? 0.2 : 0.05)))); q.sz = r2(q.sz * (s / (q.sx || 1))); q.sx = s; }
    else if (k === 'l') { q.dx = r2(q.dx + dx * (big ? 2 : 0.5)); q.dz = r2(q.dz + dy * (big ? 2 : 0.5)); }
    else q.rot = q.rot + (dx || dy) * (big ? 45 : 5);
    setForm(g);
  };

  // ---------- the uses strip ----------
  const uses = f ? (usesPv ?? f.uses) : [];
  const totalF = Math.max(1, uses.reduce((s, u) => s + u.floors, 0));
  const firstFloor = (i: number) => uses.slice(0, i).reduce((s, u) => s + u.floors, 0) + 1;
  const setUses = (u: Form['uses']) => f && setForm({ ...f, uses: u });
  /** a boundary dragged: floors move between the band under it (i) and the one over it (i + 1) */
  const downDiv = (i: number) => (ev: PointerEvent) => {
    if (!f || ev.button !== 0 || !strip.current) return;
    ev.preventDefault(); ev.stopPropagation();
    const el = ev.currentTarget as HTMLElement; el.setPointerCapture(ev.pointerId);
    const ppf = strip.current.clientHeight / totalF, y0 = ev.clientY, u0 = f.uses.map((u) => ({ ...u }));
    setDragging(`div${i}`);
    let last: Form['uses'] | null = null;
    const mv = (e2: PointerEvent) => {
      const n = Math.round((y0 - e2.clientY) / Math.max(1, ppf)), lo = u0[i], hi = u0[i + 1];
      const d = Math.max(1 - lo.floors, Math.min(hi.floors - 1, n));
      last = u0.map((u, j) => (j === i ? { ...u, floors: lo.floors + d } : j === i + 1 ? { ...u, floors: hi.floors - d } : u));
      setUsesPv(last);
    };
    const upE = () => {
      el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', upE); el.removeEventListener('pointercancel', upE);
      setDragging(null);
      setUsesPv(null);
      if (last && !same(last, f.uses)) setUses(last);
    };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', upE); el.addEventListener('pointercancel', upE);
  };
  const usePick = (cur: BuildingUse | null, set: (u: BuildingUse) => void) => (
    <div class="huses" role="radiogroup" aria-label="What it's for">
      {USES.map((u) => <button type="button" role="radio" aria-checked={u === cur} onClick={() => set(u)}><i style={`background:${USE_COLOR[u]}`} /><Icon n={USE_INFO[u].icon} size={14} />{USE_INFO[u].label}</button>)}
    </div>
  );

  // ---------- the X-ray scrubber ----------
  const nF = Math.max(1, br.floors), xr = xray === null ? null : Math.min(nF, Math.max(1, xray));
  const scrubAt = (ev: PointerEvent) => { const el = ev.currentTarget as HTMLElement, r = el.getBoundingClientRect(); setXray(Math.max(1, Math.min(nF, Math.round(1 + ((r.bottom - ev.clientY) / Math.max(1, r.height)) * (nF - 1))))); };

  const hh = (key: string, cls: string, icon: string, label: string, on: (ev: PointerEvent) => void, kd?: (ev: KeyboardEvent) => void, dbl?: () => void, size = 12) => (
    <button type="button" ref={ref(key)} class={`hh ${cls}${dragging === key ? ' on' : ''}`} aria-label={label} data-tip={dragging ? undefined : label}
      onPointerDown={on} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onKeyDown={kd} onDblClick={dbl}><Icon n={icon} size={size} stroke={2.2} /></button>
  );
  return (
    <div class={`hud${dragging ? ' dragging' : ''}`} ref={root}>
      {f && keys.map((k, i) => <>
        {hh(`s${i}`, 'hh-key', 'sideways', `Key floor ${Math.round(k.t * 100)}% up: ${Math.round(k.sx * 100)}% wide · drag wider or narrower (Shift: across only), double-click or Delete to remove`, down('s', i), keysFor('s', i), () => removeKey(i), 11)}
        {hh(`l${i}`, 'hh-lean', 'move', `Lean at ${Math.round(k.t * 100)}% up · drag it, or the arrow keys`, down('l', i), keysFor('l', i), undefined, 10)}
        {i === keys.length - 1 && hh(`r${i}`, 'hh-twist', 'rotate', `Twist at the top: ${Math.round(k.rot)}° · drag round (5° steps; Alt for any)`, down('r', i), keysFor('r', i))}
      </>)}
      {f && xray === null && f.carves.map((c) => (['from', 'to'] as const).map((endK) => hh(`c${endK}${c.id}`, 'hh-cut', 'updown', endK === 'from' ? `The slot starts ${Math.round(c.from * 100)}% up · drag it` : `The slot ends ${Math.round(c.to * 100)}% up · drag it`, downCut(c.id, endK), undefined, undefined, 11)))}
      {f && <div class="hstrip" ref={(el) => { span('strip')(el); strip.current = el as HTMLDivElement | null; }} role="group" aria-label={`${name}: what its floors are for, top first`}>
        <div class="hpopwrap hadd" data-pop="add">
          <button type="button" aria-label="Add floors for…" data-tip="Add floors on top for…" aria-expanded={open === 'add'} onClick={() => toggle('add')}><Icon n="plus" size={12} /></button>
          {pop('add', <><b>Add floors on top for</b>{usePick(null, (u) => { setUses([...uses, { use: u, floors: USE_FLOORS[u] }]); setOpen(null); })}</>, 'side')}
        </div>
        {uses.map((u, i) => ({ u, i })).reverse().map(({ u, i }) => <>
          <div class="hband" style={`flex:${u.floors} 1 0;background:${USE_COLOR[u.use]}`} data-pop={`b${i}`}>
            <button type="button" aria-expanded={open === `b${i}`} aria-label={`${USE_INFO[u.use].label}: ${u.floors} floors, from floor ${firstFloor(i)}`} data-tip={`${USE_INFO[u.use].label} · ${u.floors} fl · click to change`}
              onClick={() => { toggle(`b${i}`); if (xray !== null) setXray(firstFloor(i)); }}><Icon n={USE_INFO[u.use].icon} size={13} /><small>{u.floors}</small></button>
            {pop(`b${i}`, <>
              <b>{USE_INFO[u.use].label} · floors {firstFloor(i)}–{firstFloor(i) + u.floors - 1}</b>
              {usePick(u.use, (x) => setUses(uses.map((y, j) => (j === i ? { ...y, use: x, floorH: undefined } : y))))}
              <div class="hrow">
                <div class="hstep" role="group" aria-label="Floors">
                  <button type="button" aria-label="One floor fewer" disabled={u.floors <= 1} onClick={() => setUses(uses.map((y, j) => (j === i ? { ...y, floors: y.floors - 1 } : y)))}><Icon n="minus" size={14} /></button>
                  <b>{u.floors}<small> fl</small></b>
                  <button type="button" aria-label="One floor more" onClick={() => setUses(uses.map((y, j) => (j === i ? { ...y, floors: y.floors + 1 } : y)))}><Icon n="plus" size={14} /></button>
                </div>
                <button type="button" class="hlink" onClick={() => { setXray(firstFloor(i)); setOpen(null); }}><Icon n="layers" size={14} />See it in X-ray</button>
                {uses.length > 1 && <button type="button" class="hlink bad" onClick={() => { setUses(uses.filter((_, j) => j !== i)); setOpen(null); }}><Icon n="trash" size={14} />Remove</button>}
              </div>
            </>, 'side')}
          </div>
          {i > 0 && <div class={`hdiv${dragging === `div${i - 1}` ? ' on' : ''}`} role="separator" aria-label={`Between ${USE_INFO[uses[i - 1].use].label.toLowerCase()} and ${USE_INFO[u.use].label.toLowerCase()}: drag for more or fewer of each`} tabIndex={0}
            onPointerDown={downDiv(i - 1)}
            onKeyDown={(ev) => { const d = ev.key === 'ArrowUp' ? 1 : ev.key === 'ArrowDown' ? -1 : 0; if (!d) return; ev.preventDefault(); ev.stopPropagation(); const lo = uses[i - 1], hi = uses[i]; if ((d > 0 && hi.floors <= 1) || (d < 0 && lo.floors <= 1)) return; setUses(uses.map((y, j) => (j === i - 1 ? { ...y, floors: y.floors + d } : j === i ? { ...y, floors: y.floors - d } : y))); }} />}
        </>)}
      </div>}
      {xr !== null && <div class="hscrub" ref={span('scrub')} role="slider" tabIndex={0} aria-label={`X-ray: floor ${xr} of ${name}'s ${nF}`} aria-valuemin={1} aria-valuemax={nF} aria-valuenow={xr} data-tip="X-ray floor: drag, or the arrow keys"
        onPointerDown={(ev) => { ev.preventDefault(); ev.stopPropagation(); (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId); setDragging('scrub'); scrubAt(ev); }}
        onPointerMove={(ev) => { if (dragging === 'scrub') scrubAt(ev); }} onPointerUp={() => setDragging(null)} onPointerCancel={() => setDragging(null)}
        onKeyDown={(ev) => { const d = ev.key === 'ArrowUp' ? 1 : ev.key === 'ArrowDown' ? -1 : 0; if (!d) return; ev.preventDefault(); ev.stopPropagation(); setXray(Math.max(1, Math.min(nF, xr + d * (ev.shiftKey ? 5 : 1)))); }}>
        <i class="track" />
        <b class="thumb" style={`bottom:${nF > 1 ? ((xr - 1) / (nF - 1)) * 100 : 0}%`}>{xr}</b>
      </div>}
    </div>
  );
}

// ---------------------------------------------------------------- the bar's popovers
interface ExtrasProps { p: ProProject; b: ProBuilding; residential: boolean; setB: (fn: (b: ProBuilding) => ProBuilding) => void; once: (o: Partial<ProProject>) => void }

/** The mix as a bar with two dividers to drag (or focus and the arrow keys: 5% steps). */
function MixBar({ mix, set }: { mix: [number, number, number]; set: (m: [number, number, number]) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const [pv, setPv] = useState<[number, number, number] | null>(null);
  const m = pv ?? mix, cut = [m[0], m[0] + m[1]];
  const at = (k: 0 | 1, v: number): [number, number, number] => {
    const c = [...cut]; c[k] = Math.max(k ? c[0] : 0, Math.min(k ? 1 : c[1], Math.round(v * 20) / 20));
    return [r2(c[0]), r2(c[1] - c[0]), r2(1 - c[1])];
  };
  const down = (k: 0 | 1) => (ev: PointerEvent) => {
    ev.preventDefault(); const t = ev.currentTarget as HTMLElement; t.setPointerCapture(ev.pointerId);
    let last: [number, number, number] | null = null;
    const mv = (e2: PointerEvent) => { const r = el.current!.getBoundingClientRect(); last = at(k, (e2.clientX - r.left) / r.width); setPv(last); };
    const upE = () => { t.removeEventListener('pointermove', mv); t.removeEventListener('pointerup', upE); setPv(null); if (last) set(last); };
    t.addEventListener('pointermove', mv); t.addEventListener('pointerup', upE);
  };
  return (
    <div class="hmix" ref={el}>
      {[0, 1, 2].map((i) => <i class={`m${i}`} style={`flex:${m[i] || 0.0001}`}>{m[i] >= 0.12 ? `${Math.round(m[i] * 100)}%` : ''}</i>)}
      {([0, 1] as const).map((k) => <span role="slider" tabIndex={0} class="hmixd" style={`left:${cut[k] * 100}%`} aria-label={k ? `${UNIT_LABEL[1]} | ${UNIT_LABEL[2]}` : `${UNIT_LABEL[0]} | ${UNIT_LABEL[1]}`} aria-valuenow={Math.round(cut[k] * 100)} aria-valuemin={0} aria-valuemax={100}
        onPointerDown={down(k)} onKeyDown={(ev) => { const d = ev.key === 'ArrowRight' || ev.key === 'ArrowUp' ? 1 : ev.key === 'ArrowLeft' || ev.key === 'ArrowDown' ? -1 : 0; if (!d) return; ev.preventDefault(); ev.stopPropagation(); set(at(k, cut[k] + d * 0.05)); }} />)}
    </div>
  );
}

type BodyProps = Omit<ExtrasProps, 'residential'>;
const setFormOf = (setB: BodyProps['setB']) => (fn: (f: Form) => Form) => setB((x) => (x.form ? withForm(x, fn(x.form)) : x));

/** A formed building's shape: presets, rounding, the ease between key floors, key floors, a slot, fins. */
export function ShapeBody({ b, setB }: BodyProps) {
  const f = b.form; if (!f) return null;
  const setF = setFormOf(setB);
  const active = SHAPES.find((s) => same(s.make(f), { keys: f.keys, ease: f.ease }))?.id ?? null;
  /** a key floor halfway up the widest gap between keys */
  const addKey = () => setF((x) => { const g = withKeys(x), ks = g.keys; let at = 0.5, gap = 0; for (let i = 0; i + 1 < ks.length; i++) if (ks[i + 1].t - ks[i].t > gap) { gap = ks[i + 1].t - ks[i].t; at = r2((ks[i].t + ks[i + 1].t) / 2); } return { ...g, keys: sortedKeys({ ...g, keys: [...ks, keyAt(g, at)] }) }; });
  return <>
    <IconPick<Preset> label="Shape" cls="shp-presets" value={active} set={(id) => setF((x) => ({ ...x, ...SHAPES.find((s) => s.id === id)!.make(x) }))} options={SHAPES.map((s) => ({ value: s.id, icon: s.id, label: s.label }))} />
    <small>Or drag the rings on it: the dots for width, the diamonds to lean it, the round handle at the top to twist it.</small>
    <label class="hrange"><span>Round the plan</span><Range min={0} max={100} step={5} value={Math.round(roundness(f) * 100)} label="Round the plan" valueText={`${Math.round(roundness(f) * 100)}%`} onInput={(v) => setF((x) => rounded(x, v / 100))} /><b>{Math.round(roundness(f) * 100)}%</b></label>
    <Seg<Form['ease']> label="Between key floors" value={f.ease} set={(v) => setF((x) => ({ ...x, ease: v }))} options={[{ value: 'smooth', label: 'Smooth' }, { value: 'linear', label: 'Straight' }]} />
    <div class="hrow">
      <button type="button" class="hlink" onClick={addKey}><Icon n="plus" size={14} />A key floor</button>
      <button type="button" class="hlink" onClick={() => setF((x) => ({ ...x, carves: [...x.carves, slotCarve(x)] }))}><Icon n="slot" size={14} />A slot</button>
      {f.carves.length > 0 && <button type="button" class="hlink bad" onClick={() => setF((x) => ({ ...x, carves: [] }))}><Icon n="trash" size={14} />The cuts</button>}
    </div>
    <Toggle label="Fins round it" value={!!f.shell} set={(on) => setF((x) => ({ ...x, shell: on ? { offset: 1.2, over: 4, under: 0 } : undefined }))} />
  </>;
}

/** A formed building's roof. */
export function RoofBody({ b, setB }: BodyProps) {
  const f = b.form; if (!f) return null;
  return <IconPick<RoofKind> label="Roof" value={f.roof.kind} set={(k) => setFormOf(setB)((x) => ({ ...x, roof: { ...ROOFS.find((r) => r.value === k)!.roof } }))} options={ROOFS.map((r) => ({ value: r.value, icon: `roof-${r.value}`, label: r.label }))} />;
}

/** A formed building's facade pattern: the design system's, or its own. */
export function SkinBody({ b, setB }: BodyProps) {
  const f = b.form; if (!f) return null;
  const setF = setFormOf(setB);
  return <>
    <Seg<'ds' | 'own'> ariaLabel="Skin" value={f.skin?.pattern ? 'own' : 'ds'} set={(v) => setF((x) => ({ ...x, skin: v === 'ds' ? undefined : { ...(x.skin ?? {}), pattern: x.skin?.pattern ?? 'fins' } }))} options={[{ value: 'ds', label: 'Design system' }, { value: 'own', label: 'Its own' }]} />
    {f.skin?.pattern && <IconPick<SkinPattern> label="Skin pattern" value={f.skin.pattern} set={(pt) => setF((x) => ({ ...x, skin: { ...(x.skin ?? {}), pattern: pt } }))} options={SKINS.map((s) => ({ value: s.value, icon: `pat-${s.value}`, label: s.label }))} />}
  </>;
}

/** The flat mix: the building's own, or the project's. */
export function MixBody({ p, b, setB, once }: BodyProps) {
  const own = !!b.mix, mix = (b.mix ?? p.mix) as [number, number, number];
  return <>
    <Toggle label="Its own mix" value={own} set={(v) => setB((x) => ({ ...x, mix: v ? [...p.mix] as [number, number, number] : undefined }))} />
    <MixBar mix={mix} set={(m) => (own ? setB((x) => ({ ...x, mix: m })) : once({ mix: m }))} />
    <small>{own ? 'This building only.' : 'Every building without its own: the project’s mix.'} Drag the dividers; {UNIT_LABEL[0]}, {UNIT_LABEL[1]}, {UNIT_LABEL[2]}.</small>
  </>;
}

/** The building's design system: the project's, or a preset of its own. */
export function StyleBody({ p, b, setB }: BodyProps) {
  return (
    <div class="huses" role="radiogroup" aria-label="Design system">
      <button type="button" role="radio" aria-checked={!b.style} onClick={() => setB((x) => ({ ...x, style: undefined }))}>Project default ({presetOf(p.style).name})</button>
      {PRESETS.map((x) => <button type="button" role="radio" aria-checked={b.style === x.id} onClick={() => setB((y) => ({ ...y, style: x.id }))}>{x.name}</button>)}
    </div>
  );
}

export function BarExtras({ p, b, residential, setB, once }: ExtrasProps) {
  const root = useRef<HTMLSpanElement>(null);
  const { open, pop, toggle } = usePop(root);
  const f = b.form, own = !!b.mix;
  const ds = b.style ? presetOf(b.style) : null;
  const bp = { p, b, setB, once };
  const wrap = (id: string, label: ComponentChildren, tip: string, body: ComponentChildren) => (
    <div class="hpopwrap" data-pop={id}>
      <button type="button" aria-expanded={open === id} data-tip={tip} onClick={() => toggle(id)}>{label}</button>
      {pop(id, body)}
    </div>
  );
  return (
    <span class="hextras" ref={root}>
      {f && wrap('shape', <><Icon n="taper" size={15} />Shape</>, 'Its shape: presets, rounding, key floors, a slot', <><b>Shape</b><ShapeBody {...bp} /></>)}
      {f && wrap('roof', <><Icon n={`roof-${f.roof.kind}`} size={15} />Roof</>, 'Its roof', <><b>Roof</b><RoofBody {...bp} /></>)}
      {f && wrap('skin', <><Icon n={`pat-${f.skin?.pattern ?? 'grid'}`} size={15} />Skin</>, 'Its facade pattern', <><b>Skin</b><SkinBody {...bp} /></>)}
      {residential && wrap('mix', <>Mix</>, own ? 'Its own flat mix' : 'The flat mix (the project’s)', <><b>Flat mix</b><MixBody {...bp} /></>)}
      {wrap('style', <><Icon n="palette" size={15} />Style</>, ds ? `Design system: ${ds.name}` : 'Design system: the project’s', <><b>Design system</b><StyleBody {...bp} /></>)}
    </span>
  );
}
