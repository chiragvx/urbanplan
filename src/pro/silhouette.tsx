// A form drawn small and edited by hand, in SVG: the gallery's thumbnails, the side elevation (key floors as
// handles: drag them wider or narrower, sideways for a lean, click the outline for a new one) and the plan from
// above (drag its points, double-click one to make it sharp or smooth, click an edge for a new point).
//
// The preview here blends the key floors itself, so it draws at once from the form alone; the procedure in ./form
// is what the 3D, the money and the rules read. Both read the same keys, so they agree on the shape.
import { useEffect, useRef, useState } from 'preact/hooks';
import { levelOf, opOf, partT, sampleCurve, USE_INFO, type Carve, type Curve, type Form, type KeyFloor, type Pt } from './form';

// ---------------------------------------------------------------- the form, floor by floor (a preview)
const ID: KeyFloor = { t: 0, sx: 1, sz: 1, dx: 0, dz: 0, rot: 0 };
const lerp = (a: number, b: number, s: number) => a + (b - a) * s;

/** the keys in height order (none: the plan as drawn all the way up) */
export const sortedKeys = (f: Form): KeyFloor[] => [...f.keys].sort((a, b) => a.t - b.t);
/** the keys as the procedure reads them: the plan as drawn standing in at the ground when no key is there, and at
 *  the top too when there are none at all */
export function keysOf(f: Form): KeyFloor[] {
  const k = sortedKeys(f);
  if (!k.length) return [{ ...ID, t: 0 }, { ...ID, t: 1 }];
  return k[0].t > 1e-6 ? [{ ...ID, t: 0 }, ...k] : k;
}

/** the key floor at a height, blended from its neighbours (`smooth` eases in and out of each key) */
export function keyAt(f: Form, t: number): KeyFloor {
  const k = f.keys.length ? keysOf(f) : [];
  if (!k.length) return { ...ID, t };
  if (t <= k[0].t) return { ...k[0], t };
  if (t >= k[k.length - 1].t) return { ...k[k.length - 1], t };
  let i = 0; while (i < k.length - 2 && t > k[i + 1].t) i++;
  const a = k[i], b = k[i + 1], span = b.t - a.t;
  let s = span > 1e-6 ? (t - a.t) / span : 1;
  if (f.ease === 'smooth') s = s * s * (3 - 2 * s);
  return { t, sx: lerp(a.sx, b.sx, s), sz: lerp(a.sz, b.sz, s), dx: lerp(a.dx, b.dx, s), dz: lerp(a.dz, b.dz, s), rot: lerp(a.rot, b.rot, s) };
}

/** the plan moved by a key floor (local x, z pairs) */
export function keyed(plan: number[], k: KeyFloor): number[] {
  const a = (k.rot * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), o: number[] = [];
  for (let i = 0; i + 1 < plan.length; i += 2) {
    const x = plan[i] * k.sx, z = plan[i + 1] * k.sz;
    o.push(x * c - z * s + k.dx, x * s + z * c + k.dz);
  }
  return o;
}

export interface PreviewFloor { y: number; h: number; t: number; use: keyof typeof USE_INFO; ring: number[] }
/** every floor of the form: its height, its use and its outline (local) */
export function previewFloors(f: Form): PreviewFloor[] {
  const plan = sampleCurve(f.plan, 1.5), out: PreviewFloor[] = [];
  const n = Math.max(1, f.uses.reduce((s, u) => s + Math.max(0, u.floors), 0));
  let y = 0, k = 0;
  for (const u of f.uses) for (let j = 0; j < u.floors; j++, k++) {
    const h = levelOf(f.levels, k + 1).h ?? u.floorH ?? USE_INFO[u.use].floorH, t = n > 1 ? k / (n - 1) : 0;
    out.push({ y, h, t, use: u.use, ring: keyed(plan, keyAt(f, t)) });
    y += h;
  }
  return out;
}
/** the height at a share of the way up (the middle of the floor there) */
export function yOfT(fl: PreviewFloor[], t: number): number {
  if (!fl.length) return 0;
  const x = t * (fl.length - 1), i = Math.min(fl.length - 1, Math.floor(x)), j = Math.min(fl.length - 1, i + 1), s = x - i;
  return lerp(fl[i].y + fl[i].h / 2, fl[j].y + fl[j].h / 2, s);
}
export function tOfY(fl: PreviewFloor[], y: number): number {
  if (fl.length < 2) return 0;
  const lo = fl[0].y + fl[0].h / 2, top = fl[fl.length - 1], hi = top.y + top.h / 2;
  return Math.min(1, Math.max(0, (y - lo) / (hi - lo || 1)));
}
const xs = (r: number[]) => { let a = Infinity, b = -Infinity; for (let i = 0; i < r.length; i += 2) { a = Math.min(a, r[i]); b = Math.max(b, r[i]); } return [a, b] as const; };

/** the side elevation's outline (x, y, …) and the floor lines, seen from the front (local x across) */
export function elevation(f: Form): { outline: number[]; lines: number[][]; top: number; x0: number; x1: number; roof: number[] } {
  const fl = previewFloors(f);
  const left: number[] = [], right: number[] = [], lines: number[][] = [];
  let x0 = Infinity, x1 = -Infinity;
  // (parts added on a floor widen it as seen from the front: a podium, a wing)
  const adds = f.carves.filter((c) => !c.off && opOf(c) === 'add').map((c) => ({ span: partT(c, fl.length), x: xs(sampleCurve(c.ring, 1.5)) }));
  for (const q of fl) {
    let [a, b] = xs(q.ring);
    for (const p of adds) if (q.t >= p.span[0] - 1e-6 && q.t <= p.span[1] + 1e-6) { a = Math.min(a, p.x[0]); b = Math.max(b, p.x[1]); }
    left.push(a, q.y, a, q.y + q.h); right.unshift(b, q.y + q.h, b, q.y);
    lines.push([a, q.y, b, q.y]);
    x0 = Math.min(x0, a); x1 = Math.max(x1, b);
  }
  const t = fl[fl.length - 1], top = t ? t.y + t.h : 0;
  return { outline: [...left, ...right], lines, top, x0, x1, roof: t ? roofLine(f, ...xs(t.ring), top) : [] };
}
/** the roof over the top floor, as an open line from its left eave to its right */
function roofLine(f: Form, a: number, b: number, y: number): number[] {
  const w = b - a, m = (a + b) / 2, p = Math.tan(((f.roof.pitch || 25) * Math.PI) / 180), r = f.roof;
  switch (r.kind) {
    case 'gable': case 'hip': return [a, y, ...(r.kind === 'hip' ? [a + w * 0.25, y + (w / 2) * p * 0.8, b - w * 0.25, y + (w / 2) * p * 0.8] : [m, y + (w / 2) * p]), b, y];
    case 'mono': case 'tilted': return [a, y, a, y + w * p * 0.5, b, y];
    case 'barrel': case 'dome': { const o: number[] = [], rise = w * (r.kind === 'dome' ? 0.5 : Math.max(0.15, (r.pitch || 25) / 100)); for (let i = 0; i <= 16; i++) { const s = i / 16; o.push(a + w * s, y + rise * Math.sin(Math.PI * s)); } return o; }
    case 'crown': return [a, y, a, y + 3, a + w / 4, y + 1.5, m, y + 4, b - w / 4, y + 1.5, b, y + 3, b, y];
    default: return [a, y, a, y + (r.parapet ?? 1), b, y + (r.parapet ?? 1), b, y];
  }
}

const path = (pts: number[], close = false, flipY = true) => {
  let s = '';
  for (let i = 0; i + 1 < pts.length; i += 2) s += `${i ? 'L' : 'M'}${pts[i].toFixed(2)} ${(flipY ? -pts[i + 1] : pts[i + 1]).toFixed(2)}`;
  return close && s ? `${s}Z` : s;
};

// ---------------------------------------------------------------- a thumbnail
/** A form drawn small: its side silhouette with the floors as lines, and the plan inset in the corner. */
export function Thumb({ forms, size = 64, plan = true }: { forms: { form: Form; at?: Pt }[]; size?: number; plan?: boolean }) {
  const els = forms.map(({ form, at }) => ({ el: elevation(form), at: at ?? [0, 0] as Pt, form }));
  let x0 = Infinity, x1 = -Infinity, top = 1;
  for (const { el, at } of els) { x0 = Math.min(x0, el.x0 + at[0]); x1 = Math.max(x1, el.x1 + at[0]); top = Math.max(top, el.top + 4); }
  if (!Number.isFinite(x0)) { x0 = -10; x1 = 10; }
  const w = Math.max(x1 - x0, top * 0.6), pad = w * 0.06, cx = (x0 + x1) / 2, H = Math.max(top, w);
  const vb = `${cx - w / 2 - pad} ${-H - pad} ${w + 2 * pad} ${H + 2 * pad}`;
  const sw = (w + 2 * pad) / size;
  const p0 = plan && forms[0] ? sampleCurve(forms[0].form.plan, 1.5) : [];
  let pr = 0; for (let i = 0; i < p0.length; i++) pr = Math.max(pr, Math.abs(p0[i]));
  const ins = (w + 2 * pad) * 0.26, k = pr > 0 ? ins / (2 * pr) : 1;
  return (
    <svg class="thumb" viewBox={vb} width={size} height={size} aria-hidden="true">
      {els.map(({ el, at }) => <g transform={`translate(${at[0]} 0)`}>
        <path d={path(el.outline, true)} class="th-fill" stroke-width={sw * 1.4} />
        {el.lines.length < 70 && el.lines.slice(1).map((l) => <path d={path(l)} class="th-line" stroke-width={sw * 0.7} />)}
        {el.roof.length > 0 && <path d={path(el.roof)} class="th-roof" stroke-width={sw * 1.4} />}
      </g>)}
      {p0.length >= 6 && <path d={path(p0.map((v, i) => (i % 2 ? v * k : v * k)), true, true)} transform={`translate(${cx + w / 2 + pad - ins / 2 - pad * 0.6} ${-H - pad + ins / 2 + pad * 0.6})`} class="th-plan" stroke-width={sw} />}
      <path d={`M${cx - w / 2 - pad} 0H${cx + w / 2 + pad}`} class="th-ground" stroke-width={sw} />
    </svg>
  );
}

// ---------------------------------------------------------------- pointer helpers
function svgPt(svg: SVGSVGElement, ev: PointerEvent | MouseEvent): [number, number] {
  const m = svg.getScreenCTM(); if (!m) return [0, 0];
  const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(m.inverse());
  return [p.x, -p.y];
}
/** changes while dragging go out at most once a frame */
function useFrameSet<T>(set: (v: T) => void) {
  const pending = useRef<{ v: T } | null>(null), raf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);
  return (v: T, now = false) => {
    if (now) { cancelAnimationFrame(raf.current); raf.current = 0; pending.current = null; set(v); return; }
    pending.current = { v };
    if (!raf.current) raf.current = requestAnimationFrame(() => { raf.current = 0; const p = pending.current; pending.current = null; if (p) set(p.v); });
  };
}

// ---------------------------------------------------------------- the side elevation
type SDrag = { k: 'side'; i: number; side: 1 | -1; moved: boolean } | { k: 'mid'; i: number; moved: boolean } | { k: 'carve'; id: string; end: 'from' | 'to' };

/** The side elevation: drag a key floor's edge for its width (Shift: across only), its middle for a lean; click the
 *  outline for a new key floor, double-click a handle to take it away. */
export function SilhouetteEditor({ form, set }: { form: Form; set: (f: Form) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<SDrag | null>(null);
  const push = useFrameSet(set);
  const live = useRef(form); live.current = form;
  const fl = previewFloors(form), el = elevation(form);
  const plan = sampleCurve(form.plan, 1.5), [b0, b1] = xs(plan), hw0 = Math.max(0.5, (b1 - b0) / 2), c0 = (b0 + b1) / 2;
  // (no keys yet: the bottom and the top stand in as keys, made real on the first drag)
  // (the keys the procedure reads: the ground and, with none, the top stand in, made real on the first drag)
  const keys = keysOf(form);
  const withKeys = (f: Form): Form => ({ ...f, keys: keysOf(f).map((k) => ({ ...k })) });
  const W = Math.max(el.x1 - el.x0, 12), top = Math.max(el.top + 6, W * 0.8), pad = W * 0.35;
  const vx0 = Math.min(el.x0, -W / 2) - pad, vw = Math.max(el.x1, W / 2) - vx0 + pad;
  const vb = `${vx0} ${-top - 2} ${vw} ${top + 4}`, u = vw / 300;
  const handle = (i: number, k: KeyFloor) => { const y = yOfT(fl, k.t), cx = k.dx + c0 * k.sx, hw = hw0 * Math.abs(k.sx); return { y, cx, l: cx - hw, r: cx + hw }; };

  const down = (ev: PointerEvent, d: SDrag) => { ev.stopPropagation(); ev.preventDefault(); svg.current?.setPointerCapture(ev.pointerId); setDrag(d); };
  const move = (ev: PointerEvent) => {
    if (!drag || !svg.current) return;
    const [x, y] = svgPt(svg.current, ev), f = withKeys(live.current), ks = f.keys.map((k) => ({ ...k }));
    if (drag.k === 'carve') {
      const t = Math.round(tOfY(fl, y) * 100) / 100;
      push({ ...f, carves: f.carves.map((c) => (c.id === drag.id ? spanTo(c, drag.end, t, fl.length) : c)) });
      return;
    }
    const k = ks[drag.i]; if (!k) return;
    if (drag.k === 'side') {
      const cx = k.dx + c0 * k.sx, s = Math.max(0.15, Math.min(4, (drag.side * (x - cx)) / hw0));
      const r = Math.round(s * 100) / 100;
      if (!ev.shiftKey) k.sz = Math.round(k.sz * (r / (k.sx || 1)) * 100) / 100;
      k.sx = r;
      // (an inner key also moves up and down)
      if (drag.i > 0 && drag.i < ks.length - 1) k.t = Math.round(Math.min(ks[drag.i + 1].t - 0.02, Math.max(ks[drag.i - 1].t + 0.02, tOfY(fl, y))) * 100) / 100;
    } else k.dx = ev.altKey ? Math.round((x - c0 * k.sx) * 10) / 10 : Math.round((x - c0 * k.sx) * 2) / 2;
    drag.moved = true;
    push({ ...f, keys: ks });
  };
  const upE = (ev: PointerEvent) => { if (drag) { svg.current?.releasePointerCapture(ev.pointerId); setDrag(null); } };
  const addAt = (ev: MouseEvent) => {
    if (!svg.current) return;
    const [, y] = svgPt(svg.current, ev), t = Math.round(tOfY(fl, y) * 100) / 100, f = withKeys(form);
    if (f.keys.some((k) => Math.abs(k.t - t) < 0.03)) return;
    set({ ...f, keys: sortedKeys({ ...f, keys: [...f.keys, keyAt(f, t)] }) });
  };
  // (the ground's key and the top's stay: taking one away would only bring the plan as drawn back in its place)
  const remove = (i: number) => { const f = withKeys(form); if (i === 0 || i === f.keys.length - 1) return; set({ ...f, keys: f.keys.filter((_, j) => j !== i) }); };

  return (
    <div class="sil">
      <svg ref={svg} viewBox={vb} class={`sil-svg${drag ? ' dragging' : ''}`} role="img" aria-label="Side elevation: drag the handles to shape it" onPointerMove={move} onPointerUp={upE} onPointerCancel={upE}>
        <path d={`M${vx0} 0H${vx0 + vw}`} class="sil-ground" stroke-width={u} />
        <path d={path(el.outline, true)} class="sil-body" stroke-width={u * 1.5} onClick={addAt} />
        {fl.length < 120 && el.lines.slice(1).map((l) => <path d={path(l)} class="sil-floor" stroke-width={u * 0.6} />)}
        {el.roof.length > 0 && <path d={path(el.roof)} class="sil-roof" stroke-width={u * 1.5} />}
        {form.carves.map((c) => { const [t0, t1] = partT(c, fl.length), y0 = yOfT(fl, t0), y1 = yOfT(fl, t1), x = el.x1 + 3 * u * 4; return <g class="sil-carve">
          <path d={`M${x} ${-y0}V${-y1}`} stroke-width={u * 1.2} />
          {(['from', 'to'] as const).map((end) => <circle cx={x} cy={-(end === 'from' ? y0 : y1)} r={u * 5} class="h" onPointerDown={(ev) => down(ev as PointerEvent, { k: 'carve', id: c.id, end })}><title>{end === 'from' ? 'Where the cut starts' : 'Where it ends'}</title></circle>)}
        </g>; })}
        {keys.map((k, i) => { const h = handle(i, k); return <g class="sil-key">
          <path d={`M${h.l} ${-h.y}H${h.r}`} stroke-width={u} class="sil-kline" />
          <circle cx={h.l} cy={-h.y} r={u * 6} class="h" onPointerDown={(ev) => down(ev as PointerEvent, { k: 'side', i, side: -1, moved: false })} onDblClick={() => remove(i)}><title>Drag: wider or narrower. Double-click: remove</title></circle>
          <circle cx={h.r} cy={-h.y} r={u * 6} class="h" onPointerDown={(ev) => down(ev as PointerEvent, { k: 'side', i, side: 1, moved: false })} onDblClick={() => remove(i)}><title>Drag: wider or narrower. Double-click: remove</title></circle>
          <rect x={h.cx - u * 4.5} y={-h.y - u * 4.5} width={u * 9} height={u * 9} transform={`rotate(45 ${h.cx} ${-h.y})`} class="h mid" onPointerDown={(ev) => down(ev as PointerEvent, { k: 'mid', i, moved: false })}><title>Drag sideways: lean</title></rect>
        </g>; })}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------- the plan from above
type PDrag = { i: number; moved: boolean };

/** The plan from above (the front road at the bottom): drag a point, double-click it for sharp or smooth, click an
 *  edge for a new point, Delete takes the picked one away. Half-metre steps; Alt for free. */
export function PlanEditor({ form, set }: { form: Form; set: (f: Form) => void }) {
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<PDrag | null>(null), [sel, setSel] = useState<number | null>(null);
  const push = useFrameSet(set);
  const live = useRef(form); live.current = form;
  // (the plan as last sent while dragging: the next move builds on it, not on a render that may not have come yet)
  const work = useRef<Curve | null>(null);
  const c = form.plan, pts = c.pts, n = pts.length;
  const sharpOf = (i: number) => (c.sharp ? !!c.sharp[i] : true);
  const ring = sampleCurve(c, 1), topRing = keyed(ring, keyAt(form, 1));
  let r = 6; for (const v of [...ring, ...topRing]) r = Math.max(r, Math.abs(v));
  const pad = r * 0.25, u = (2 * (r + pad)) / 300;
  const vb = `${-r - pad} ${-r - pad} ${2 * (r + pad)} ${2 * (r + pad)}`;
  const setCurve = (cv: Curve, now = true) => { work.current = drag || !now ? cv : null; push({ ...live.current, plan: cv, keys: live.current.keys.map((k) => (k.plan ? { ...k, plan: undefined } : k)) }, now); };

  const move = (ev: PointerEvent) => {
    if (!drag || !svg.current) return;
    const [x, z] = svgPt(svg.current, ev), g = ev.altKey ? 0.1 : 0.5;
    const cur = work.current ?? live.current.plan, q = cur.pts.map((p) => [...p] as Pt);
    q[drag.i] = [Math.round(x / g) * g, Math.round(z / g) * g];
    drag.moved = true;
    setCurve({ ...cur, pts: q }, false);
  };
  const upE = (ev: PointerEvent) => { if (drag) { svg.current?.releasePointerCapture(ev.pointerId); setDrag(null); work.current = null; } };
  const startDrag = (ev: PointerEvent, i: number) => { ev.stopPropagation(); ev.preventDefault(); svg.current?.setPointerCapture(ev.pointerId); setSel(i); setDrag({ i, moved: false }); };
  const insert = (ev: PointerEvent, i: number) => {
    if (!svg.current) return;
    const [x, z] = svgPt(svg.current, ev), q = pts.map((p) => [...p] as Pt), sh = pts.map((_, j) => sharpOf(j));
    q.splice(i + 1, 0, [Math.round(x * 2) / 2, Math.round(z * 2) / 2]); sh.splice(i + 1, 0, sharpOf(i) && sharpOf((i + 1) % n));
    const cv = { pts: q, sharp: sh };
    setCurve(cv);
    work.current = cv;
    startDrag(ev, i + 1);
  };
  const toggle = (i: number) => { const sh = pts.map((_, j) => sharpOf(j)); sh[i] = !sh[i]; setCurve({ ...c, sharp: sh }); };
  const del = (i: number) => { if (n <= 3) return; setCurve({ pts: pts.filter((_, j) => j !== i), sharp: pts.map((_, j) => sharpOf(j)).filter((_, j) => j !== i) }); setSel(null); };
  const key = (ev: KeyboardEvent) => { if ((ev.key === 'Delete' || ev.key === 'Backspace') && sel !== null) { ev.preventDefault(); ev.stopPropagation(); del(sel); } };

  return (
    <div class="sil">
      <svg ref={svg} viewBox={vb} class={`sil-svg plan${drag ? ' dragging' : ''}`} tabIndex={0} role="img" aria-label="The plan from above: drag the points" onPointerMove={move} onPointerUp={upE} onPointerCancel={upE} onKeyDown={key}>
        <path d={`M${-r - pad} ${r + pad * 0.6}H${r + pad}`} class="sil-ground" stroke-width={u * 3} />
        <path d={path(topRing, true)} class="sil-top" stroke-width={u} />
        <path d={path(ring, true)} class="sil-body" stroke-width={u * 1.5} />
        {form.carves.filter((cv) => !cv.off).map((cv) => <path d={path(sampleCurve(cv.ring, 1), true)} class={`sil-cut op-${opOf(cv)}`} stroke-width={u} />)}
        {pts.map((p, i) => { const q = pts[(i + 1) % n]; return <path d={`M${p[0]} ${-p[1]}L${q[0]} ${-q[1]}`} class="sil-edge" stroke-width={u * 12} onPointerDown={(ev) => insert(ev as PointerEvent, i)}><title>Click: a new point</title></path>; })}
        {pts.map((p, i) => sharpOf(i)
          ? <rect x={p[0] - u * 5} y={-p[1] - u * 5} width={u * 10} height={u * 10} class={`h${sel === i ? ' on' : ''}`} onPointerDown={(ev) => startDrag(ev as PointerEvent, i)} onDblClick={() => toggle(i)}><title>A corner. Double-click: smooth</title></rect>
          : <circle cx={p[0]} cy={-p[1]} r={u * 5.5} class={`h${sel === i ? ' on' : ''}`} onPointerDown={(ev) => startDrag(ev as PointerEvent, i)} onDblClick={() => toggle(i)}><title>Smooth. Double-click: a corner</title></circle>)}
      </svg>
    </div>
  );
}

/** a part's start or end moved to height t (of n floors): its share of the way up, and its floor when it keeps to
 *  its floors */
export function spanTo(c: Carve, end: 'from' | 'to', t: number, n: number): Carve {
  const [a, b] = partT(c, n), tt = end === 'from' ? Math.min(t, b - 0.02) : Math.max(t, a + 0.02);
  const o: Carve = { ...c, from: end === 'from' ? tt : a, to: end === 'to' ? tt : b };
  if (c.lo === undefined && c.hi === undefined) return o;
  const fl = (x: number) => (n <= 1 ? 1 : Math.round(Math.max(0, Math.min(1, x)) * (n - 1)) + 1);
  return { ...o, lo: fl(o.from), hi: Math.max(fl(o.from), fl(o.to)) };
}

// ---------------------------------------------------------------- a slot
/** A slot carved up the front face, zig-zagging as it rises: glazed, from low down to near the top. */
export function slotCarve(f: Form): Carve {
  const p = sampleCurve(f.plan, 1.5);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i + 1 < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
  const cx = (x0 + x1) / 2, w = Math.max(1.5, Math.min(3, (x1 - x0) * 0.12)), d = Math.max(2, (z1 - z0) * 0.35), a = Math.min(3, (x1 - x0) * 0.15);
  return {
    id: `c${Date.now().toString(36)}`, face: 'glass', from: 0.12, to: 0.96,
    ring: { pts: [[cx - w / 2, z0 - 1], [cx + w / 2, z0 - 1], [cx + w / 2, z0 + d], [cx - w / 2, z0 + d]] },
    path: [0, 0.25, 0.5, 0.75, 1].map((t, i) => ({ t, dx: i % 2 ? a : -a, dz: 0 })),
  };
}
