// A picked building's form, edited on the view (Phase 4 of docs/plans/editor-in-view.md):
// - its key floors as rings at their heights, each with a scale dot (drag: wider or narrower; Shift: across only;
//   double-click: take the key away), a lean diamond in its middle, and at the top a twist handle;
// - a strip beside it of what its floors are for, bottom to top: drag a boundary for more or fewer floors of each,
//   click a band to change its use, take it away or see it in X-ray; + adds a band on top;
// - each part's start and end as handles up its face, and a handle on each of its plan's edges to push or pull it
//   (docs/plans/pro-design-freedom.md step 3);
// - with X-ray on, a floor scrubber beside any picked building.
// And `BarExtras`, the popovers on the building's bar: Shape (presets, rounding, key floors, fins), Parts, Roof, Skin,
// Mix (its own or the project's, dividers to drag) and Style (the design system).
// A drag is one undo step; in shaded or X-ray view it moves outlines only, and the form is laid out on release.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { drift, levelOf, opOf, partSpan, partT, sampleCurve, toLocal, toWorld, USE_INFO, type BuildingUse, type Carve, type Form, type KeyFloor, type Level, type PartOp, type Space } from './form';
import { copiedPart, mirroredPart, movedPart, OPS, shapePart, turnedPart } from './parts';
import { MASS_DRAW, MASS_SHAPES } from './masses';
import { edgeNormal, floorsOfForm, NEW_SPACES, newSpace, OP_LABEL, OP_TIP, partName, pushEdge, spaceName, spaceT, tOfFloor } from './parts';
import { byUse } from '../doc/uses';
import { keyAt, keyed, keysOf, previewFloors, sortedKeys, spanTo, yOfT } from './silhouette';
import { usePins, type Tx } from './hud';
import { own, type CanvasEdit, type Picked } from './edit';
import type { Evaluated } from './evaluate';
import type { ProBuilding, ProProject } from './project';
import type { ProView } from './scene';
import { floorHOf, floorsFor, isAll, withFloorH } from './masses';
import { IconPick, ROOFS, rounded, roundness, same, setFloors, SHAPES, SKINS, USE_FLOORS, USES, withForm, type Preset } from './shapePanel';
import { presetOf, PRESETS } from './design';
import { UNIT_LABEL } from '../doc/site';
import { Icon, Num, Range, Seg, Select, Toggle } from './ui';
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

/** where a part's edge handles sit: halfway up it */
const faceT = (c: Carve, n: number) => { const [a, b] = partT(c, n); return (a + b) / 2; };

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
  | { k: 'cut'; id: string; end: 'from' | 'to'; base: ProProject; e: Evaluated; f: Form; timer: number; pending: Form | null; changed?: boolean; s0: number; s1: number }
  | { k: 'face'; list: 'carves' | 'spaces'; id: string; i: number; y: number; t: number; base: ProProject; e: Evaluated; f: Form; timer: number; pending: Form | null; changed?: boolean }
  | { k: 'pmove'; id: string; y: number; t: number; x0: number; z0: number; base: ProProject; e: Evaluated; f: Form; timer: number; pending: Form | null; changed?: boolean };

export function FormHud({ view, edit, p, e, picked, tx, live, readOnly, xray, setXray, toast }: Props) {
  const { root, at, box, ref, spans, span } = usePins(view);
  const [pv, setPv] = useState<Form | null>(null);
  const [usesPv, setUsesPv] = useState<Form['uses'] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  // (the part whose handles show when there are many: the one pointed at in the Parts list, else the newest)
  const [focusPart, setFocusPart] = useState<string | null>(null);
  useEffect(() => { const on = (ev: Event) => setFocusPart((ev as CustomEvent<string>).detail); addEventListener('urbanplan:part', on); return () => removeEventListener('urbanplan:part', on); }, []);
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
  const ringKey = f && saved ? JSON.stringify([f.plan, f.keys, f.ease, f.uses, f.carves, f.levels, saved.spine, show, focusPart]) : '';
  useEffect(() => {
    if (!edit || !f || !saved || !show || xray !== null) return;
    const L: number[] = [];
    for (const k of keys) {
      const y = yOfT(fl, k.t), r = keyed(plan, k);
      for (let i = 0; i + 1 < r.length; i += 2) { const j = (i + 2) % r.length, a = toWorld(saved, r[i], r[i + 1]), b = toWorld(saved, r[j], r[j + 1]); L.push(a[0], y, a[1], b[0], y, b[1]); }
    }
    // (each part's outline at its lowest and highest floor, with its corners up: solid where it adds or intersects,
    // dashed where it cuts or excludes, so what's taken away reads as taken away)
    const solid: number[] = [], dash: number[] = [];
    // (of many parts, the one in focus outlined in full; the rest by one ring at their top, so they read without a tangle)
    const full = new Set(handled(f.carves, focusPart).map((c) => c.id));
    for (const c of f.carves) {
      if (c.off) continue;
      const whole = full.has(c.id);
      const [lo, hi] = partSpan(c, fl.length), a = fl[lo - 1], z = fl[hi - 1]; if (!a || !z) continue;
      const s = sampleCurve(c.ring, 1.5), out = opOf(c) === 'cut' || opOf(c) === 'xor' ? dash : solid, few = s.length <= 40;
      const ringAt = (t: number, y: number) => { const k = keyAt(f, t), [dx, dz] = drift(c.path, t), o: number[] = []; for (let i = 0; i + 1 < s.length; i += 2) { const [x, q] = through(k, s[i] + dx, s[i + 1] + dz), [X, Z] = toWorld(saved, x, q); o.push(X, y, Z); } return o; };
      const r0 = whole ? ringAt(a.t, a.y + 0.05) : [], r1 = ringAt(z.t, z.y + z.h);
      for (const r of whole ? [r0, r1] : [r1]) for (let i = 0; i < r.length; i += 3) { const j = (i + 3) % r.length; out.push(r[i], r[i + 1], r[i + 2], r[j], r[j + 1], r[j + 2]); }
      if (few && whole) for (let i = 0; i < r0.length; i += 3) out.push(r0[i], r0[i + 1], r0[i + 2], r1[i], r1[i + 1], r1[i + 2]);
    }
    edit.decor = pv ? { dashed: [...L, ...dash], lines: solid } : { lines: [...L, ...solid], dashed: dash };
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
      if (c.off) continue;
      const cb = bboxOf(sampleCurve(c.ring, 1));
      const ts = partT(c, fl.length);
      for (const end of ['from', 'to'] as const) { const t = ts[end === 'from' ? 0 : 1], k = keyAt(f, t), [ddx, ddz] = drift(c.path, t), [x, z] = through(k, cb.cx + ddx, cb.z0 + ddz); A.push([`c${end}${c.id}`, W(x, z, yOfT(fl, t))]); }
      // (its middle, halfway up: drag it to move the part; its name over its top)
      { const t = faceT(c, fl.length), k = keyAt(f, t), [ddx, ddz] = drift(c.path, t), [x, z] = through(k, cb.cx + ddx, cb.cz + ddz); A.push([`pm${c.id}`, W(x, z, yOfT(fl, t))]); }
      { const t = ts[1], k = keyAt(f, t), [ddx, ddz] = drift(c.path, t), [x, z] = through(k, cb.cx + ddx, cb.cz + ddz), top = fl[partSpan(c, fl.length)[1] - 1]; A.push([`pc${c.id}`, W(x, z, top ? top.y + top.h + 1.5 : yOfT(fl, t))]); }
      // (each edge's middle, halfway up the part: push or pull it)
      if (pushable(c)) {
        const t = faceT(c, fl.length), k = keyAt(f, t), [ddx, ddz] = drift(c.path, t), P = c.ring.pts;
        P.forEach((a, i) => { const b = P[(i + 1) % P.length], [x, z] = through(k, (a[0] + b[0]) / 2 + ddx, (a[1] + b[1]) / 2 + ddz); A.push([`e${i}${c.id}`, W(x, z, yOfT(fl, t))]); });
      }
    }
  }
  for (const s of f && xray === null ? (f.spaces ?? []) : []) {
    if (s.off || s.ring.pts.length > 12) continue;
    const t = spaceT(s, fl.length), k = keyAt(f!, t), P = s.ring.pts;
    P.forEach((a, i) => { const b = P[(i + 1) % P.length], [x, z] = through(k, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); A.push([`v${i}${s.id}`, W(x, z, yOfT(fl, t))]); });
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
    if (d.k === 'face') {
      // (the pointer on the level halfway up the part, taken back through that floor's turn, shift and scale and
      // the part's drift: how far past the edge's middle, along its normal)
      const c: Carve | Space | undefined = d.list === 'spaces' ? d.f.spaces?.find((x) => x.id === d.id) : d.f.carves.find((x) => x.id === d.id); if (!c) return null;
      const g = v.groundAt(ev.clientX, ev.clientY, d.y); if (!g) return null;
      const k = keyAt(d.f, d.t), [qx, qz] = toLocal(saved, g[0], g[1]), [ux, uz] = unturn(k, qx, qz), [ddx, ddz] = 'path' in c ? drift(c.path, d.t) : [0, 0];
      const lx = ux / (k.sx || 1) - ddx, lz = uz / (k.sz || 1) - ddz;
      const P = c.ring.pts, a = P[d.i], b = P[(d.i + 1) % P.length], [nx, nz] = edgeNormal(c, d.i);
      const step = ev.altKey ? 0.1 : 0.5, dist = Math.round(((lx - (a[0] + b[0]) / 2) * nx + (lz - (a[1] + b[1]) / 2) * nz) / step) * step;
      if (Math.abs(dist) < 1e-6) return d.f;
      if (d.list === 'spaces') return { ...d.f, spaces: (d.f.spaces ?? []).map((x) => (x.id === d.id ? pushEdge(x, d.i, dist) : x)) };
      return { ...d.f, carves: d.f.carves.map((x) => (x.id === d.id ? pushEdge(x, d.i, dist) : x)) };
    }
    if (d.k === 'pmove') {
      // (the pointer on the level halfway up the part, back through that floor's turn and scale: how far from where
      // the drag began, in 0.5 m steps (Alt: 0.1 m))
      const g = v.groundAt(ev.clientX, ev.clientY, d.y); if (!g) return null;
      const k = keyAt(d.f, d.t), [qx, qz] = toLocal(saved, g[0], g[1]), [ux, uz] = unturn(k, qx, qz);
      const lx = ux / (k.sx || 1), lz = uz / (k.sz || 1), step = ev.altKey ? 0.1 : 0.5;
      const dx = Math.round((lx - d.x0) / step) * step, dz = Math.round((lz - d.z0) / step) * step;
      if (!dx && !dz) return d.f;
      return { ...d.f, carves: d.f.carves.map((x) => (x.id === d.id ? movedPart(x, dx, dz) : x)) };
    }
    if (d.k === 'cut') {
      // (up the face: where the pointer is between the screen heights of the form's bottom and top)
      const t = Math.min(1, Math.max(0, (d.s0 - ev.clientY) / (d.s0 - d.s1 || 1)));
      const c = d.f.carves.find((x) => x.id === d.id); if (!c) return null;
      const n = previewFloors(d.f).length;
      return { ...d.f, carves: d.f.carves.map((x) => (x.id === d.id ? spanTo(x, d.end, r2(t), n) : x)) };
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
    drag.current = d; tx.begin(); setDragging(d.k === 'cut' ? `c${d.end}${d.id}` : d.k === 'face' ? `${d.list === 'spaces' ? 'v' : 'e'}${d.i}${d.id}` : d.k === 'pmove' ? `pm${d.id}` : `${d.k}${d.i}`);
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
  const downFace = (c: Carve, i: number) => (ev: PointerEvent) => {
    if (!f || ev.button !== 0 || !view) return;
    const t = faceT(c, fl.length);
    start({ k: 'face', list: 'carves', id: c.id, i, t, y: yOfT(fl, t), base: p, e, f, timer: 0, pending: null }, ev);
  };
  const downMove = (c: Carve) => (ev: PointerEvent) => {
    if (!f || ev.button !== 0 || !view) return;
    const t = faceT(c, fl.length), y = yOfT(fl, t), g = view.groundAt(ev.clientX, ev.clientY, y); if (!g) return;
    const k = keyAt(f, t), [qx, qz] = toLocal(saved!, g[0], g[1]), [ux, uz] = unturn(k, qx, qz);
    start({ k: 'pmove', id: c.id, t, y, x0: ux / (k.sx || 1), z0: uz / (k.sz || 1), base: p, e, f, timer: 0, pending: null }, ev);
  };
  /** a part's middle: the arrow keys move it (Shift: 2 m) */
  const moveKeys = (c: Carve) => (ev: KeyboardEvent) => {
    if (!f) return;
    const s = ev.shiftKey ? 2 : 0.5, dx = ev.key === 'ArrowRight' ? s : ev.key === 'ArrowLeft' ? -s : 0, dz = ev.key === 'ArrowUp' ? s : ev.key === 'ArrowDown' ? -s : 0;
    if (!dx && !dz) return;
    ev.preventDefault(); ev.stopPropagation();
    setForm({ ...f, carves: f.carves.map((x) => (x.id === c.id ? movedPart(x, dx, dz) : x)) });
  };
  const downSpace = (s: Space, i: number) => (ev: PointerEvent) => {
    if (!f || ev.button !== 0 || !view) return;
    const t = spaceT(s, fl.length);
    start({ k: 'face', list: 'spaces', id: s.id, i, t, y: yOfT(fl, t), base: p, e, f, timer: 0, pending: null }, ev);
  };
  const spaceKeys = (s: Space, i: number) => (ev: KeyboardEvent) => {
    if (!f) return;
    const d = ev.key === 'ArrowUp' || ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowDown' || ev.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    ev.preventDefault(); ev.stopPropagation();
    setForm({ ...f, spaces: (f.spaces ?? []).map((x) => (x.id === s.id ? pushEdge(x, i, d * (ev.shiftKey ? 2 : 0.5)) : x)) });
  };
  /** a part's edge: the arrow keys push it out or pull it in (Shift: 2 m) */
  const faceKeys = (c: Carve, i: number) => (ev: KeyboardEvent) => {
    if (!f) return;
    const d = ev.key === 'ArrowUp' || ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowDown' || ev.key === 'ArrowLeft' ? -1 : 0;
    if (!d) return;
    ev.preventDefault(); ev.stopPropagation();
    setForm({ ...f, carves: f.carves.map((x) => (x.id === c.id ? pushEdge(x, i, d * (ev.shiftKey ? 2 : 0.5)) : x)) });
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
    if (d.changed) tx.commit(`${d.k === 's' ? 'Width' : d.k === 'l' ? 'Lean' : d.k === 'r' ? 'Twist' : d.k === 'face' ? (d.list === 'spaces' ? 'Space' : 'Part') : d.k === 'pmove' ? 'Move part' : 'Part height'} · ${name}`); else tx.cancel();
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
      {f && xray === null && handled(f.carves, focusPart).map((c) => { const nm = partName(f, c), sp = partSpan(c, floorsOfForm(f)); return <>
        {(['from', 'to'] as const).map((endK) => hh(`c${endK}${c.id}`, `hh-cut op-${opOf(c)}`, 'updown', `${nm} ${endK === 'from' ? 'starts at' : 'ends at'} floor ${sp[endK === 'from' ? 0 : 1]} · drag it`, downCut(c.id, endK), undefined, undefined, 11))}
        {hh(`pm${c.id}`, `hh-pmove op-${opOf(c)}`, 'move', `${nm}: drag to move it (Alt: 10 cm steps), or the arrow keys`, downMove(c), moveKeys(c), undefined, 12)}
        <span class={`hpart op-${opOf(c)}`} ref={ref(`pc${c.id}`)} aria-hidden="true">{nm.startsWith(OP_LABEL[opOf(c)]) ? nm : `${OP_LABEL[opOf(c)]} · ${nm}`}</span>
        {pushable(c) && c.ring.pts.map((_, i) => hh(`e${i}${c.id}`, `hh-face op-${opOf(c)}`, 'sideways', `${nm}: an edge · drag to push or pull it (Alt: 10 cm steps), or the arrow keys`, downFace(c, i), faceKeys(c, i), undefined, 10))}
      </>; })}
      {f && xray === null && (f.spaces ?? []).filter((s) => !s.off && s.ring.pts.length <= 12).map((s) => s.ring.pts.map((_, i) => hh(`v${i}${s.id}`, 'hh-face hh-space', 'sideways', `${spaceName(s)} (a space): an edge · drag to push or pull it, or the arrow keys`, downSpace(s, i), spaceKeys(s, i), undefined, 10)))}
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
    </div>
    <Toggle label="Fins round it" value={!!f.shell} set={(on) => setF((x) => ({ ...x, shell: on ? { offset: 1.2, over: 4, under: 0 } : undefined }))} />
  </>;
}

/** A formed building's parts, in order: each adds to, cuts out of or trims the floors it spans. An eye switches
 *  one off; the arrows reorder (a cut after an add cuts it too; before, it doesn't). */
/** the parts whose handles show on the view: all of a few; of more, only the one in focus (pointed at in the Parts
 *  list), else the newest, so many parts don't bury the building in handles (their outlines all stay) */
export const MANY_PARTS = 4;
const handled = (cs: Carve[], focus: string | null) => {
  const on = cs.filter((c) => !c.off); if (on.length <= MANY_PARTS) return on;
  const f = on.find((c) => c.id === focus) ?? on[on.length - 1]; return [f];
};
const focusOn = (id: string) => dispatchEvent(new CustomEvent('urbanplan:part', { detail: id }));

/** a part whose edges can be pushed and pulled: a few straight sides (not a circle or a smooth curve) */
const pushable = (c: Carve) => c.ring.pts.length <= 12 && (!c.ring.sharp || c.ring.sharp.some(Boolean));

export function PartsBody({ b, setB }: BodyProps) {
  const [op, setOp] = useState<PartOp>('cut');
  const f = b.form; if (!f) return null;
  const setF = setFormOf(setB), n = floorsOfForm(f);
  const setC = (id: string, fn: (c: Carve) => Carve) => setF((x) => ({ ...x, carves: x.carves.map((c) => (c.id === id ? fn(c) : c)) }));
  const swap = (i: number, j: number) => setF((x) => { const c = x.carves.slice(); [c[i], c[j]] = [c[j], c[i]]; return { ...x, carves: c }; });
  return <div class="parts">
    {!f.carves.length && <small>The plan drawn is the first mass. Parts add to it, cut out of it or keep only what lies inside them, on the floors they span: a podium, a wing, a bridge, a notch, a void.</small>}
    {f.carves.filter((c) => !c.off).length > MANY_PARTS && <p class="muted small parts-many">With this many parts, the view shows the handles of the one you point at here.</p>}
    {f.carves.map((c, i) => <div class={`part${c.off ? ' off' : ''}`} key={c.id} onPointerEnter={() => focusOn(c.id)} onFocusIn={() => focusOn(c.id)}>
      <div class="part-h">
        <button type="button" class="part-eye" aria-pressed={!c.off} aria-label={c.off ? 'Switched off: switch it on' : 'Switch it off'} data-tip={c.off ? 'Off · switch it on' : 'Switch it off'} onClick={() => setC(c.id, (x) => ({ ...x, off: x.off ? undefined : true }))}><Icon n={c.off ? 'eyeoff' : 'eye'} size={14} /></button>
        <input class="part-n" aria-label="The part's name" value={partName(f, c)} onChange={(ev) => { const v = (ev.target as HTMLInputElement).value.trim(); setC(c.id, (x) => ({ ...x, name: v || undefined })); }} onKeyDown={(ev) => { ev.stopPropagation(); if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }} />
        <Seg<PartOp> small ariaLabel="What it does" value={opOf(c)} set={(v) => setC(c.id, (x) => ({ ...x, op: v === 'cut' ? undefined : v }))} options={OPS.map((o) => ({ value: o, label: OP_LABEL[o], title: OP_TIP[o] }))} />
      </div>
      <div class="part-b">
        <Num label="From floor" value={partSpan(c, n)[0]} min={1} max={n} set={(v) => setC(c.id, (x) => onFloors(x, v, Math.max(v, partSpan(x, n)[1]), n))} />
        <Num label="To floor" value={partSpan(c, n)[1]} min={1} max={n} set={(v) => setC(c.id, (x) => onFloors(x, Math.min(v, partSpan(x, n)[0]), v, n))} />
        <span class="part-acts">
          <button type="button" class="hlink up" aria-label="Earlier in the list" data-tip="Earlier: acts first" disabled={i === 0} onClick={() => swap(i, i - 1)}><Icon n="chevron" size={14} /></button>
          <button type="button" class="hlink dn" aria-label="Later in the list" data-tip="Later: acts after" disabled={i === f.carves.length - 1} onClick={() => swap(i, i + 1)}><Icon n="chevron" size={14} /></button>
          <button type="button" class="hlink bad" aria-label="Remove it" data-tip="Remove it" onClick={() => setF((x) => ({ ...x, carves: x.carves.filter((y) => y.id !== c.id) }))}><Icon n="trash" size={14} /></button>
        </span>
      </div>
      <div class="part-b part-cad" role="group" aria-label="Move, turn, mirror, copy">
        <button type="button" class="hlink" data-tip="Turn it 15° (about its middle)" onClick={() => setC(c.id, (x) => turnedPart(x, 15))}><Icon n="rotate" size={14} />15°</button>
        <button type="button" class="hlink" data-tip="Turn it a quarter" onClick={() => setC(c.id, (x) => turnedPart(x, 90))}><Icon n="rotate" size={14} />90°</button>
        <button type="button" class="hlink" data-tip="A mirrored copy, across the form's middle, left for right" onClick={() => setF((x) => ({ ...x, carves: [...x.carves, mirroredPart(x, c, 'x')] }))}><Icon n="sideways" size={14} />Mirror</button>
        <button type="button" class="hlink" data-tip="A mirrored copy, front for back" onClick={() => setF((x) => ({ ...x, carves: [...x.carves, mirroredPart(x, c, 'z')] }))}><Icon n="updown" size={14} />Mirror</button>
        <button type="button" class="hlink" data-tip="A copy of it, a little along" onClick={() => setF((x) => ({ ...x, carves: [...x.carves, copiedPart(c)] }))}><Icon n="copy" size={14} />Copy</button>
      </div>
      {opOf(c) === 'cut' && <Seg<Carve['face']> small ariaLabel="What's left at the cut" value={c.face} set={(v) => setC(c.id, (x) => ({ ...x, face: v }))} options={[{ value: 'skin', label: 'Facade', title: "The cut faces are the building's own facade" }, { value: 'glass', label: 'Glazed', title: 'The cut faces are glass' }, { value: 'open', label: 'Open', title: 'Left open under the floors above: a sky garden, a void through' }]} />}
    </div>)}
    <div class="part-new" role="group" aria-label="Add a part">
      <Seg<PartOp> small ariaLabel="The new part" value={op} set={setOp} options={OPS.map((o) => ({ value: o, label: OP_LABEL[o], title: OP_TIP[o] }))} />
      <div class="hrow part-add">
        {MASS_SHAPES.map((s) => <button type="button" class="hlink" data-tip={`${OP_LABEL[op]}: a ${s.label.toLowerCase()} ${op === 'add' ? 'beside it' : 'at its middle'}, all its floors up`} onClick={() => setF((x) => ({ ...x, carves: [...x.carves, shapePart(x, s.shape, op)] }))}><Icon n={s.icon} size={14} />{s.label}</button>)}
        {MASS_DRAW.map((s) => <button type="button" class="hlink" data-tip={`${OP_LABEL[op]}: draw it on the view. ${s.hint}`} onClick={() => dispatchEvent(new CustomEvent('urbanplan:tool', { detail: { k: 'mass', shape: s.shape, into: { id: b.id, op } } }))}><Icon n={s.icon} size={14} />{s.label}…</button>)}
      </div>
    </div>
    {f.carves.length > 0 && <small>On the view: drag a part's edge handles to push or pull it, and its arrows up the face for its floors.</small>}
  </div>;
}

/** A formed building's spaces: areas of the floors with a use of their own (shops along the front of a floor of
 *  homes, a hall, a terminal's departments), laid out by the use's generator or kept as one unit. What no space
 *  covers keeps its band's use. */
export function SpacesBody({ b, setB }: BodyProps) {
  const f = b.form; if (!f) return null;
  const setF = setFormOf(setB), n = floorsOfForm(f), S = f.spaces ?? [];
  const setS = (fn: (s: Space[]) => Space[]) => setF((x) => { const v = fn(x.spaces ?? []); return { ...x, spaces: v.length ? v : undefined }; });
  const setI = (id: string, o: Partial<Space>) => setS((l) => l.map((x) => (x.id === id ? { ...x, ...o } : x)));
  const swap = (i: number, j: number) => setS((l) => { const c = l.slice(); [c[i], c[j]] = [c[j], c[i]]; return c; });
  const useOpts = USES.map((u) => ({ value: u, label: USE_INFO[u].label }));
  return <div class="parts">
    {!S.length && <small>Each floor takes its band’s use. A space gives part of some floors a use of its own: shops along the front of a floor of homes, a hall, an airport’s check-in. It is laid out by that use, or kept as one unit.</small>}
    {S.map((s, i) => <div class={`part${s.off ? ' off' : ''}`} key={s.id}>
      <div class="part-h">
        <button type="button" class="part-eye" aria-pressed={!s.off} aria-label={s.off ? 'Switched off: switch it on' : 'Switch it off'} data-tip={s.off ? 'Off · switch it on' : 'Switch it off'} onClick={() => setI(s.id, { off: s.off ? undefined : true })}><Icon n={s.off ? 'eyeoff' : 'eye'} size={14} /></button>
        <input class="part-n" aria-label="The space's name" value={spaceName(s)} onChange={(ev) => { const v = (ev.target as HTMLInputElement).value.trim(); setI(s.id, { name: v && v !== USE_INFO[s.use].label ? v : undefined }); }} onKeyDown={(ev) => { ev.stopPropagation(); if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }} />
        <Select<BuildingUse> size="sm" aria-label="Its use" value={s.use} onChange={(v) => setI(s.id, { use: v })} options={useOpts} />
      </div>
      <div class="part-b">
        <Num label="From floor" value={Math.min(s.lo, s.hi)} min={1} max={n} set={(v) => setI(s.id, { lo: v, hi: Math.max(v, Math.max(s.lo, s.hi)) })} />
        <Num label="To floor" value={Math.max(s.lo, s.hi)} min={1} max={n} set={(v) => setI(s.id, { hi: v, lo: Math.min(v, Math.min(s.lo, s.hi)) })} />
        <span class="part-acts">
          <button type="button" class="hlink up" aria-label="Earlier in the list" data-tip="Earlier: wins where spaces overlap" disabled={i === 0} onClick={() => swap(i, i - 1)}><Icon n="chevron" size={14} /></button>
          <button type="button" class="hlink dn" aria-label="Later in the list" data-tip="Later" disabled={i === S.length - 1} onClick={() => swap(i, i + 1)}><Icon n="chevron" size={14} /></button>
          <button type="button" class="hlink bad" aria-label="Remove it" data-tip="Remove it" onClick={() => setS((l) => l.filter((y) => y.id !== s.id))}><Icon n="trash" size={14} /></button>
        </span>
      </div>
      <Seg<'auto' | 'one'> small ariaLabel="How it's filled" value={s.fill ?? 'auto'} set={(v) => setI(s.id, { fill: v === 'auto' ? undefined : v })} options={[{ value: 'auto', label: 'Laid out', title: 'Filled by its use: flats, shops, offices, rooms' }, { value: 'one', label: 'One unit', title: 'The whole space as one: a hall, a big shop, a lobby' }]} />
    </div>)}
    <div class="hrow part-add" role="group" aria-label="Add a space">
      {NEW_SPACES.map((k) => <button type="button" class="hlink" data-tip={k.tip} onClick={() => setS((l) => [...l, newSpace(f, k.kind)])}><Icon n={k.icon} size={14} />{k.label}</button>)}
    </div>
    {S.length > 0 && <small>On the view: drag a space’s edge handles (the blue squares) to reshape it. X-ray shows how each floor is laid out.</small>}
  </div>;
}

/** Make floors from the form (docs/plans/pro-design-freedom.md §3.6): its height and the floor-to-floor height cut it
 *  into floors; what each range of floors is for, bottom up; and heights and double-height voids by range below. */
export function FloorsBody({ b, setB, height, projectUse }: BodyProps & { height: number; projectUse: BuildingUse }) {
  const f = b.form; if (!f) return null;
  const setF = setFormOf(setB), n = floorsOfForm(f), fh = floorHOf(f);
  const bands = f.uses;
  const setBand = (i: number, o: Partial<Form['uses'][number]>) => setF((x) => ({ ...x, uses: x.uses.map((u, j) => (j === i ? { ...u, ...o } : u)) }));
  let at = 1;
  return <div class="parts floors-body">
    <div class="part-b">
      <Num label="Height" unit="m" step={0.5} value={Math.round(height * 10) / 10} min={3} max={900} set={(v) => setF((x) => setFloors(x, floorsFor(v, height, n)))} />
      <Num label="Floor to floor" unit="m" step={0.1} value={fh ?? 0} zero="By use" min={0} max={12} set={(v) => setF((x) => { const y = withFloorH(x, v >= 2 ? v : undefined); return v >= 2 ? setFloors(y, Math.max(1, Math.round(height / v))) : y; })} />
      <Num label="Floors" value={n} min={1} max={300} set={(v) => setF((x) => setFloors(x, v))} />
    </div>
    <small>The height and the floor-to-floor height cut the form into floors: change the height and the floors follow; change the floor height and it keeps its height.</small>
    <h5 class="floors-h">What each range is for</h5>
    {bands.map((u, i) => { const lo = at, hi = at + u.floors - 1; at = hi + 1; return <div class="part" key={i}>
      <div class="part-h">
        <span class="floors-at">{lo === hi ? `Floor ${lo}` : `Floors ${lo}–${hi}`}</span>
        <Select<BuildingUse> size="sm" aria-label="Its use" value={u.use} onChange={(v) => setBand(i, { use: v })} options={USES.filter((x) => x !== 'parking').map((x) => ({ value: x, label: USE_INFO[x].label }))} />
      </div>
      <div class="part-b">
        <Num label="Floors" value={u.floors} min={1} max={300} set={(v) => setBand(i, { floors: Math.max(1, v) })} />
        <span class="part-acts">{bands.length > 1 && <button type="button" class="hlink bad" aria-label="Remove the range" data-tip="Remove the range: its floors go" onClick={() => setF((x) => ({ ...x, uses: x.uses.filter((_, j) => j !== i) }))}><Icon n="trash" size={14} /></button>}</span>
      </div>
    </div>; })}
    <div class="hrow part-add" role="group" aria-label="Add a range of floors">
      <button type="button" class="hlink" data-tip="A range on top, of the project's use" onClick={() => setF((x) => ({ ...x, uses: [...x.uses, { use: projectUse, floors: 2 }] }))}><Icon n="plus" size={14} />Floors on top</button>
      {n >= 2 && <button type="button" class="hlink" data-tip="Its ground floor as a range of its own: shops, a lobby" onClick={() => setF((x) => { const u = x.uses.map((y) => ({ ...y })); if (u[0].floors <= 1) return x; u[0].floors -= 1; return { ...x, uses: [{ use: 'retail', floors: 1 }, ...u] }; })}><Icon n="shop" size={14} />A ground floor</button>}
    </div>
    <h5 class="floors-h">Heights and double-height spaces</h5>
    <LevelsBody b={b} setB={setB} p={undefined as never} once={undefined as never} />
  </div>;
}

/** A formed building's levels: floor heights set by range whatever the use, and floors left out (voids, so the
 *  floor below rises through them: a double-height lobby, an atrium, a hall). */
export function LevelsBody({ b, setB }: BodyProps) {
  const f = b.form; if (!f) return null;
  const setF = setFormOf(setB), n = floorsOfForm(f), L = f.levels ?? [];
  const setL = (fn: (l: Level[]) => Level[]) => setF((x) => { const v = fn(x.levels ?? []); return { ...x, levels: v.length ? v : undefined }; });
  const setI = (i: number, o: Partial<Level>) => setL((l) => l.map((x, j) => (j === i ? { ...x, ...o } : x)));
  const voids = Array.from({ length: n }, (_, k) => levelOf(f.levels, k + 1).void).filter(Boolean).length;
  return <div class="parts">
    <small>{L.some((l) => !isAll(l)) ? `${n} floors${voids ? `, ${voids} left open to the floor below` : ''}.` : 'Each floor takes its use’s height. Set a range apart for a height of its own, or leave its floor out for a double-height space.'}</small>
    {L.map((l, i) => !isAll(l) && <div class="part" key={i}>
      <div class="part-b">
        <Num label="From floor" value={Math.min(l.from, l.to)} min={1} max={n} set={(v) => setI(i, { from: v, to: Math.max(v, Math.max(l.from, l.to)) })} />
        <Num label="To floor" value={Math.max(l.from, l.to)} min={1} max={n} set={(v) => setI(i, { to: v, from: Math.min(v, Math.min(l.from, l.to)) })} />
      </div>
      <div class="part-b">
        <Seg<'floor' | 'void'> small ariaLabel="A floor here" value={l.void ? 'void' : 'floor'} set={(v) => setI(i, { void: v === 'void' ? true : undefined })} options={[{ value: 'floor', label: 'Floors', title: 'Floors with slabs' }, { value: 'void', label: 'No floor', title: 'No slab: the floor below rises through (not the ground floor)', disabled: Math.max(l.from, l.to) < 2 }]} />
        {!l.void && <Num label="Height" unit="m" step={0.1} value={l.h ?? 0} zero="Its use’s" min={0} max={30} set={(v) => setI(i, { h: v >= 2 ? v : undefined })} />}
        <span class="part-acts"><button type="button" class="hlink bad" aria-label="Remove the range" data-tip="Remove the range" onClick={() => setL((x) => x.filter((_, j) => j !== i))}><Icon n="trash" size={14} /></button></span>
      </div>
    </div>)}
    <div class="hrow part-add" role="group" aria-label="Add a range">
      <button type="button" class="hlink" data-tip="Floors with a height of their own" onClick={() => setL((x) => [...x, { from: 1, to: 1, h: 4.5 }])}><Icon n="level" size={14} />A height</button>
      {n >= 2 && <button type="button" class="hlink" data-tip="The ground floor rises through floor 2: a double-height lobby" onClick={() => setL((x) => [...x, { from: 2, to: 2, void: true }])}><Icon n="layers" size={14} />A double-height ground floor</button>}
    </div>
  </div>;
}

/** a part moved to floors lo … hi of n: on those floors from now on, whatever the building's height */
const onFloors = (c: Carve, lo: number, hi: number, n: number): Carve => ({ ...c, lo, hi, from: tOfFloor(lo, n), to: tOfFloor(hi, n) });

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
      {f && wrap('shape', <><Icon n="taper" size={15} />Shape</>, 'Its shape: presets, rounding, key floors', <><b>Shape</b><ShapeBody {...bp} /></>)}
      {f && wrap('parts', <><Icon n="cube" size={15} />Parts</>, f.carves.length ? `Its parts (${f.carves.length}): blocks added, cuts, trims` : 'Its parts: add a block, cut, trim', <><b>Parts</b><PartsBody {...bp} /></>)}
      {f && wrap('roof', <><Icon n={`roof-${f.roof.kind}`} size={15} />Roof</>, 'Its roof', <><b>Roof</b><RoofBody {...bp} /></>)}
      {f && wrap('skin', <><Icon n={`pat-${f.skin?.pattern ?? 'grid'}`} size={15} />Skin</>, 'Its facade pattern', <><b>Skin</b><SkinBody {...bp} /></>)}
      {residential && wrap('mix', <>Mix</>, own ? 'Its own flat mix' : 'The flat mix (the project’s)', <><b>Flat mix</b><MixBody {...bp} /></>)}
      {wrap('style', <><Icon n="palette" size={15} />Style</>, ds ? `Design system: ${ds.name}` : 'Design system: the project’s', <><b>Design system</b><StyleBody {...bp} /></>)}
    </span>
  );
}
