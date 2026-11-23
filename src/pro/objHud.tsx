// The editor on the view for what's picked that isn't a building: a thing on the grounds (a garden, a car lot, a
// road, a wall, a gate, a roundabout, a tank, a parking tower) or a feature of the site (a tree, a well, a power line,
// a drain, a structure, a no-build zone).
// - its points are handles: drag one (snapped as drawing is), click the + between two for a new point, focus one and
//   press Delete to take it away;
// - curves, as a vector drawing app does them (a road, a wall, an area): Alt-drag a point to pull out its handles,
//   double-click it to make it smooth or a corner again, drag a handle to bend the curve (the other side follows;
//   Alt breaks them apart for a cusp); Smooth or Corners in the bar for every point at once (src/doc/curves.ts);
// - a point feature has a radius handle and a clearance handle on its rings;
// - a selection bar with what it has to set: a road's width, a parking tower's levels, a roundabout's size, a gate's
//   width, a feature's radius, clearance and note; remove, and deselect.
// A drag is one undo step; its changes go in a few times a second.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ProView } from './scene';
import type { Evaluated } from './evaluate';
import type { ProProject } from './project';
import { ELEMENT_TOOLS, own, removed, type CanvasEdit, type Picked } from './edit';
import { ELEMENTS, isArea, nodesOf, roadFrame, withNodes, type SiteElement } from '../doc/site';
import { moveHandle, smoothHandles, type Handles } from '../doc/curves';
import { featureOf, INTERNAL_WIDTHS, type SiteFeature } from './siteObjects';
import { usePins, type Tx } from './hud';
import { Icon } from './ui';

type Pt = [number, number];
interface Props {
  view: ProView | null; edit: CanvasEdit | null; p: ProProject; e: Evaluated; picked: Picked; pick: (x: Picked) => void;
  tx: Tx; snap: boolean; readOnly: boolean; toast: (s: string) => void;
}
const r2 = (x: number) => Math.round(x * 100) / 100;
const fmt = (x: number) => (Math.abs(x - Math.round(x)) < 0.05 ? String(Math.round(x)) : x.toFixed(1));
const pairs = (a: number[]): Pt[] => { const o: Pt[] = []; for (let i = 0; i + 1 < a.length; i += 2) o.push([a[i], a[i + 1]]); return o; };
const circle = (c: Pt, r: number, n = 40) => { const o: number[] = []; for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2, b = ((k + 1) / n) * Math.PI * 2; o.push(c[0] + Math.cos(a) * r, 0.12, c[1] + Math.sin(a) * r, c[0] + Math.cos(b) * r, 0.12, c[1] + Math.sin(b) * r); } return o; };

/** a number in the bar: a small field, Enter or leaving it sets it */
function NumIn({ label, value, unit, min, max, step = 0.5, set }: { label: string; value: number; unit: string; min: number; max: number; step?: number; set: (v: number) => void }) {
  return (
    <label class="hnum" data-tip={label}>
      <span>{label}</span>
      <input type="number" value={r2(value)} min={min} max={max} step={step} aria-label={`${label} (${unit})`}
        onChange={(ev) => { const v = parseFloat((ev.target as HTMLInputElement).value); if (Number.isFinite(v)) set(Math.max(min, Math.min(max, v))); }}
        onKeyDown={(ev) => ev.stopPropagation()} />
      <small>{unit}</small>
    </label>
  );
}

export function ObjectHud({ view, edit, p, e, picked, pick, tx, snap, readOnly, toast }: Props) {
  const { root, bar, at, box, ref } = usePins(view);
  const [dragging, setDragging] = useState<string | null>(null);
  const drag = useRef<null | { key: string; base: ProProject; e: Evaluated; i: number; pts: number[]; bez?: Handles[]; c?: Pt; timer: number; pending: Partial<ProProject> | null; changed?: boolean }>(null);

  const f: SiteFeature | undefined = picked?.k === 'feature' ? (p.features ?? []).find((x) => x.id === picked.id) : undefined;
  const elD = picked?.k === 'element' ? (e.d.site.elements ?? []).find((x) => x.id === picked.id) : undefined;
  const el: SiteElement | undefined = elD ? ((p.scheme?.elements.find((x) => x.id === elD.id) ?? elD) as SiteElement) : undefined;
  const F = f ? featureOf(f.kind) : null;

  // ---------- the rings round a point feature, drawn over the scene ----------
  const fr = f && F?.shape === 'point' && f.pts.length >= 2 ? { c: [f.pts[0], f.pts[1]] as Pt, r: f.r ?? F.r, clear: f.clear ?? F.clear } : null;
  // (a curved element's handles: a line from each point to its handles)
  const hn = el?.bez && el.nodes ? el.nodes : null, hb = el?.bez ?? null;
  const decorKey = fr ? `${fr.c}|${fr.r}|${fr.clear}` : hn ? JSON.stringify([hn, hb]) : '';
  useEffect(() => {
    if (!edit) return;
    const hl: number[] = [];
    if (hn && hb) hb.forEach((h, i) => { if (!h) return; const x = hn[i * 2], z = hn[i * 2 + 1]; hl.push(x + h[0], 0.15, z + h[1], x, 0.15, z, x, 0.15, z, x + h[2], 0.15, z + h[3]); });
    edit.decor = fr ? { lines: circle(fr.c, Math.max(0.2, fr.r)), dashed: fr.clear > 0 ? circle(fr.c, fr.r + fr.clear, 56) : [] } : hl.length ? { lines: hl } : null;
    edit.draw();
    return () => { edit.decor = null; edit.draw(); };
  }, [decorKey, edit]);
  useEffect(() => {
    if (!dragging) return;
    const k = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && drag.current) { ev.stopImmediatePropagation(); clearTimeout(drag.current.timer); drag.current = null; setDragging(null); tx.cancel(); edit?.clearSnap(); } };
    addEventListener('keydown', k, true);
    return () => removeEventListener('keydown', k, true);
  }, [dragging]);

  if (readOnly || !view || (!f && !el)) { at.current.clear(); box.current = []; return <div class="hud" ref={root} />; }

  // ---------- its points ----------
  /** the points to edit, whether they close, how few it may have; and the project with them changed */
  const kind = el ? el.kind : f!.kind;
  const area = el ? isArea(el) : F!.shape === 'area';
  const line = el ? el.kind === 'road' || el.kind === 'wall' : F!.shape === 'line';
  const ptsOf = (q: ProProject, qe: Evaluated): number[] => {
    if (f) return (q.features ?? []).find((x) => x.id === f.id)?.pts ?? [];
    const x = (q.scheme?.elements.find((y) => y.id === el!.id) ?? (qe.d.site.elements ?? []).find((y) => y.id === el!.id)) as SiteElement | undefined;
    if (!x) return [];
    return nodesOf(x);
  };
  const bezOf = (q: ProProject, qe: Evaluated): Handles[] | undefined => {
    if (f) return undefined;
    const x = (q.scheme?.elements.find((y) => y.id === el!.id) ?? (qe.d.site.elements ?? []).find((y) => y.id === el!.id)) as SiteElement | undefined;
    return x?.bez;
  };
  /** the project with its points (and, for an element, their handles) changed: unset handles keep the ones it has
   *  when the points are as many, else none */
  const withPts = (q: ProProject, qe: Evaluated, pts: number[], bez?: Handles[]): Partial<ProProject> => {
    if (f) return { features: (q.features ?? []).map((x) => (x.id === f.id ? { ...x, pts } : x)) };
    const s = own(q, qe);
    return { scheme: { ...s, elements: s.elements.map((x) => {
      if (x.id !== el!.id) return x;
      const b = bez ?? (x.bez && x.bez.length === pts.length / 2 ? x.bez : undefined);
      return withNodes(x, pts, b);
    }) } };
  };
  const setEl = (fn: (x: SiteElement) => SiteElement) => { const s = own(p, e); once({ scheme: { ...s, elements: s.elements.map((x) => (x.id === el!.id ? fn(x) : x)) } }); };
  const setF = (o: Partial<SiteFeature>) => once({ features: (p.features ?? []).map((x) => (x.id === f!.id ? { ...x, ...o } : x)) });
  const once = (o: Partial<ProProject>) => { tx.begin(); tx.live(o); tx.commit(); };
  const pts = ptsOf(p, e), P = pairs(pts);
  const editPts = area || line || kind === 'gate';
  const closed = area, minN = area ? 3 : 2;
  const curves = !!el && (area || line);
  const bez = bezOf(p, e);

  // ---------- anchors ----------
  const A: [string, [number, number, number]][] = [];
  if (editPts) {
    P.forEach(([x, z], i) => A.push([`v${i}`, [x, 0.2, z]]));
    if (kind !== 'gate') P.forEach(([x, z], i) => { if (!closed && i === P.length - 1) return; const [bx, bz] = P[(i + 1) % P.length]; A.push([`m${i}`, [(x + bx) / 2, 0.2, (z + bz) / 2]]); });
  }
  if (curves && bez) P.forEach(([x, z], i) => { const h = bez[i]; if (!h) return; A.push([`hi${i}`, [x + h[0], 0.2, z + h[1]]], [`ho${i}`, [x + h[2], 0.2, z + h[3]]]); });
  const U = (() => { const R = roadFrame(e.r); return [R.ux, R.uz] as Pt; })();
  if (fr) { A.push(['r', [fr.c[0] + U[0] * fr.r, 0.2, fr.c[1] + U[1] * fr.r]]); if (F!.clear > 0 || fr.clear > 0) A.push(['c', [fr.c[0] + U[0] * (fr.r + fr.clear), 0.2, fr.c[1] + U[1] * (fr.r + fr.clear)]]); }
  at.current = new Map(A);
  const bx: [number, number, number][] = [];
  const top = el?.kind === 'parking' ? (el.levels ?? 3) * 3 : el?.kind === 'tank' ? 4 : 1;
  const ground = el ? (el.kind === 'roundabout' || el.kind === 'tank' ? (() => { const c: Pt = [(pts[0] + pts[2]) / 2, (pts[1] + pts[3]) / 2]; return [[c[0] - el.depth / 2, c[1] - el.depth / 2], [c[0] + el.depth / 2, c[1] + el.depth / 2]] as Pt[]; })() : P) : fr ? [[fr.c[0] - fr.r - fr.clear, fr.c[1] - fr.r - fr.clear], [fr.c[0] + fr.r + fr.clear, fr.c[1] + fr.r + fr.clear]] as Pt[] : P;
  for (const [x, z] of ground) bx.push([x, 0, z], [x, top, z]);
  box.current = bx;

  // ---------- dragging a handle ----------
  const grid = (x: number, alt: boolean) => (snap && !alt ? Math.round(x * 2) / 2 : r2(x));
  const changeFor = (d: NonNullable<typeof drag.current>, ev: PointerEvent): Partial<ProProject> | null => {
    if (d.key === 'r' || d.key === 'c') {
      const g = view.groundAt(ev.clientX, ev.clientY); if (!g || !d.c) return null;
      const dist = Math.hypot(g[0] - d.c[0], g[1] - d.c[1]);
      const cur = (d.base.features ?? []).find((x) => x.id === f!.id)!, r0 = cur.r ?? F!.r;
      const o = d.key === 'r' ? { r: Math.max(0.2, Math.min(30, grid(dist, ev.altKey))) } : { clear: Math.max(0, Math.min(60, grid(dist - r0, ev.altKey))) };
      return { features: (d.base.features ?? []).map((x) => (x.id === f!.id ? { ...x, ...o } : x)) };
    }
    // a handle, or (Alt on a point) both pulled out of it: its offset from the point, the other side opposite
    if (d.key.startsWith('h') || d.key.startsWith('p')) {
      const g = view.groundAt(ev.clientX, ev.clientY); if (!g) return null;
      const nx = d.pts[d.i * 2], nz = d.pts[d.i * 2 + 1], ox = g[0] - nx, oz = g[1] - nz;
      const B: Handles[] = Array.from({ length: d.pts.length / 2 }, (_, k) => d.bez?.[k] ?? null);
      if (d.key.startsWith('p')) B[d.i] = Math.hypot(ox, oz) < 0.3 ? null : [r2(-ox), r2(-oz), r2(ox), r2(oz)];
      else B[d.i] = moveHandle(B[d.i], d.key.startsWith('hi') ? 0 : 1, ox, oz, ev.altKey);
      return withPts(d.base, d.e, d.pts, B);
    }
    // a point: snapped as drawing is, to the plot, the margins, the buildings and its own other points
    const extra: number[] = []; pairs(d.pts).forEach(([x, z], i) => { if (i !== d.i) extra.push(x, z); });
    const g = edit?.snapAt(ev.clientX, ev.clientY, ev, { extra }) ?? view.groundAt(ev.clientX, ev.clientY);
    if (!g) return null;
    const np = [...d.pts]; np[d.i * 2] = r2(g[0]); np[d.i * 2 + 1] = r2(g[1]);
    return withPts(d.base, d.e, np);
  };
  const flush = () => { const d = drag.current; if (d?.pending) { tx.live(d.pending); d.pending = null; d.changed = true; } };
  const start = (key: string, i: number, base: ProProject, ev: PointerEvent, c?: Pt) => {
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    drag.current = { key, base, e, i, pts: ptsOf(base, e), bez: bezOf(base, e), c, timer: 0, pending: null };
    setDragging(key);
  };
  const down = (key: string, i: number) => (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    tx.begin();
    if (key.startsWith('m')) {
      // (a new point between two: put in, then dragged; the curves keep their handles)
      const [ax, az] = P[i], [bx2, bz2] = P[(i + 1) % P.length], np = [...pts];
      np.splice((i + 1) * 2, 0, r2((ax + bx2) / 2), r2((az + bz2) / 2));
      const nb = bez ? [...bez.slice(0, i + 1), null, ...bez.slice(i + 1)] : undefined;
      const o = withPts(p, e, np, nb); tx.live(o);
      start(`v${i + 1}`, i + 1, { ...p, ...o }, ev);
      drag.current!.changed = true;
      return;
    }
    // (Alt on a point of a line or an area: pull its handles out of it)
    if (curves && ev.altKey && key.startsWith('v')) { start(`p${i}`, i, p, ev); return; }
    start(key, i, p, ev, fr?.c);
  };
  /** a point made smooth (handles along its neighbours) or a corner again */
  const toggleSmooth = (i: number) => {
    if (!curves) return;
    const B: Handles[] = P.map((_, k) => bez?.[k] ?? null);
    B[i] = B[i] ? null : smoothHandles(pts, i, closed);
    once(withPts(p, e, pts, B));
  };
  const allSmooth = (on: boolean) => once(withPts(p, e, pts, on ? P.map((_, k) => smoothHandles(pts, k, closed)) : P.map(() => null)));
  const move = (ev: PointerEvent) => {
    const d = drag.current; if (!d) return;
    const o = changeFor(d, ev); if (!o) return;
    d.pending = o;
    if (!d.timer) { flush(); d.timer = window.setTimeout(function tick() { const dd = drag.current; if (!dd) return; if (dd.pending) { flush(); dd.timer = window.setTimeout(tick, 120); } else dd.timer = 0; }, 120); }
  };
  const end = (ev: PointerEvent) => {
    const d = drag.current; if (!d) return;
    clearTimeout(d.timer);
    const o = changeFor(d, ev); if (o) d.pending = o;
    flush(); drag.current = null; setDragging(null); edit?.clearSnap();
    if (d.changed) tx.commit(); else tx.cancel();
  };
  const vkeys = (i: number) => (ev: KeyboardEvent) => {
    if (ev.key !== 'Delete' && ev.key !== 'Backspace') return;
    ev.preventDefault(); ev.stopPropagation();
    if (P.length <= minN) { toast(`It needs at least ${minN} points.`); return; }
    const np = [...pts]; np.splice(i * 2, 2); once(withPts(p, e, np, bez ? bez.filter((_, k) => k !== i) : undefined));
  };

  const name = el ? (ELEMENT_TOOLS.find((x) => x.kind === el.kind)?.label ?? ELEMENTS.find((x) => x.value === el.kind)?.label ?? 'On the grounds') : F!.label;
  const D = el ? ELEMENTS.find((x) => x.value === el.kind) : undefined;
  const gateW = el?.kind === 'gate' ? Math.hypot(pts[2] - pts[0], pts[3] - pts[1]) : 0;
  return (
    <div class={`hud${dragging ? ' dragging' : ''}`} ref={root}>
      {editPts && P.map((_, i) => (
        <button type="button" ref={ref(`v${i}`)} class={`hh hh-v${dragging === `v${i}` || dragging === `p${i}` ? ' on' : ''}${bez?.[i] ? ' smooth' : ''}`} aria-label={`Point ${i + 1}: drag it; Delete takes it away${curves ? '; double-click for a smooth point or a corner, Alt-drag to pull out its handles' : ''}`} data-tip={dragging ? undefined : curves ? 'Drag · Alt-drag: curve it · double-click: smooth or corner' : 'Drag · Delete removes it'}
          onPointerDown={down(`v${i}`, i)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onKeyDown={vkeys(i)} onDblClick={() => toggleSmooth(i)} />
      ))}
      {curves && bez && P.map((_, i) => bez[i] && (['hi', 'ho'] as const).filter((w) => { const h = bez[i]!, o = w === 'hi' ? 0 : 2; return Math.hypot(h[o], h[o + 1]) > 0.05; }).map((w) => (
        <button type="button" ref={ref(`${w}${i}`)} class={`hh hh-bez${dragging === `${w}${i}` ? ' on' : ''}`} aria-label={`Point ${i + 1}'s ${w === 'hi' ? 'in' : 'out'} handle: drag to bend the curve; Alt for a sharp turn`} data-tip={dragging ? undefined : 'Drag to bend · Alt: only this side'}
          onPointerDown={(ev) => { if (ev.button !== 0) return; ev.preventDefault(); ev.stopPropagation(); tx.begin(); start(`${w}${i}`, i, p, ev); }} onPointerMove={move} onPointerUp={end} onPointerCancel={end} />
      )))}
      {editPts && kind !== 'gate' && P.map((_, i) => (!closed && i === P.length - 1) ? null : (
        <button type="button" ref={ref(`m${i}`)} class="hh hh-mid" aria-label={`A new point between ${i + 1} and ${(i + 1) % P.length + 1}`} data-tip={dragging ? undefined : 'Drag for a new point'}
          onPointerDown={down(`m${i}`, i)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}><Icon n="plus" size={10} stroke={2.4} /></button>
      ))}
      {fr && <button type="button" ref={ref('r')} class={`hh hh-ring${dragging === 'r' ? ' on' : ''}`} aria-label={`${f!.kind === 'tree' ? 'Canopy radius' : 'Radius'}: ${fmt(fr.r)} m, drag it`} data-tip={dragging ? undefined : `${f!.kind === 'tree' ? 'Canopy' : 'Radius'} ${fmt(fr.r)} m`}
        onPointerDown={down('r', 0)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}><Icon n="sideways" size={11} stroke={2.2} /></button>}
      {fr && at.current.has('c') && <button type="button" ref={ref('c')} class={`hh hh-ring clear${dragging === 'c' ? ' on' : ''}`} aria-label={`Kept clear: ${fmt(fr.clear)} m, drag it`} data-tip={dragging ? undefined : `${fmt(fr.clear)} m kept clear`}
        onPointerDown={down('c', 0)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}><Icon n="sideways" size={11} stroke={2.2} /></button>}
      <div class="hbar" ref={bar} role="toolbar" aria-label={`${name}: edit`}>
        <b class="hlabel">{name}</b>
        {el?.kind === 'road' && <><span class="hsep" /><div class="hchips" role="radiogroup" aria-label="Width">{INTERNAL_WIDTHS.map((w) => <button type="button" role="radio" aria-checked={el.depth === w} onClick={() => setEl((x) => ({ ...x, depth: w }))}>{w} m</button>)}</div></>}
        {el?.kind === 'parking' && <><span class="hsep" /><div class="hstep" role="group" aria-label="Levels">
          <button type="button" aria-label="One level fewer" disabled={(el.levels ?? 3) <= 1} onClick={() => setEl((x) => ({ ...x, levels: Math.max(1, (x.levels ?? 3) - 1) }))}><Icon n="minus" size={14} /></button>
          <b>{el.levels ?? 3}<small> lvl</small></b>
          <button type="button" aria-label="One level more" disabled={(el.levels ?? 3) >= 12} onClick={() => setEl((x) => ({ ...x, levels: Math.min(12, (x.levels ?? 3) + 1) }))}><Icon n="plus" size={14} /></button>
        </div></>}
        {(el?.kind === 'roundabout' || el?.kind === 'tank') && <><span class="hsep" /><NumIn label="Across" value={el.depth} unit="m" min={2} max={60} set={(v) => setEl((x) => ({ ...x, depth: v }))} /></>}
        {el?.kind === 'gate' && <><span class="hsep" /><NumIn label="Width" value={gateW} unit="m" min={1} max={20} set={(v) => setEl((x) => { const s = x.spine, cx = (s[0] + s[2]) / 2, cz = (s[1] + s[3]) / 2, L = Math.hypot(s[2] - s[0], s[3] - s[1]) || 1, ux = (s[2] - s[0]) / L, uz = (s[3] - s[1]) / L; return { ...x, spine: [r2(cx - ux * v / 2), r2(cz - uz * v / 2), r2(cx + ux * v / 2), r2(cz + uz * v / 2)] }; })} /></>}
        {el?.kind === 'wall' && D && <span class="hmeta">{fmt(el.depth * 100)} cm thick</span>}
        {curves && <><span class="hsep" />
          <button type="button" aria-label="Smooth every point" data-tip="Smooth: curves through every point" aria-pressed={!!bez?.every(Boolean)} onClick={() => allSmooth(true)}><Icon n="smooth" size={15} /></button>
          <button type="button" aria-label="Every point a corner" data-tip="Corners: straight between the points" aria-pressed={!bez?.some(Boolean)} onClick={() => allSmooth(false)}><Icon n="corner" size={15} /></button>
        </>}
        {f && <><span class="hsep" />
          {fr && <NumIn label={f.kind === 'tree' ? 'Canopy' : 'Radius'} value={fr.r} unit="m" min={0.2} max={30} set={(v) => setF({ r: v })} />}
          <NumIn label="Clear" value={f.clear ?? F!.clear} unit="m" min={0} max={60} set={(v) => setF({ clear: v })} />
          {f.kind === 'nobuild' && <input class="hnote" value={f.note ?? ''} placeholder="Why: an easement…" aria-label="Why it's kept open" onChange={(ev) => setF({ note: (ev.target as HTMLInputElement).value || undefined })} onKeyDown={(ev) => ev.stopPropagation()} />}
        </>}
        <span class="hsep" />
        <button type="button" aria-label="Remove" data-tip="Remove (Delete)" onClick={() => { once(removed(p, e, picked)); pick(null); toast(`Removed the ${name.toLowerCase()} · Ctrl+Z to undo`); }}><Icon n="trash" size={15} /></button>
        <button type="button" aria-label="Deselect" data-tip="Deselect (Esc)" onClick={() => pick(null)}><Icon n="x" size={14} /></button>
      </div>
    </div>
  );
}
