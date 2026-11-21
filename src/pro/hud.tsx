// The editor on the view: what's picked is edited where it stands, not in the panel.
// - a selection bar pinned over the picked building: its name, floors, turns, duplicate, remove, "Shape it", and
//   Inspect (the panel, for the long forms: its mix, design system, systems, flat plans);
// - handles on it: height (floors), its ends (length) and side (depth) on a straight building, a turn handle and a
//   move handle; every one a real button: drag it, or focus it and use the arrow keys (Shift: bigger steps);
// - its measurements on the view (length, depth, height): click one to type the number.
// Everything is pinned to world points and re-placed each frame straight through the DOM (no re-render per frame).
// A drag is one undo step (begin, live changes, commit; Escape puts it back), and its changes are applied at most
// every few frames, so the scheme keeps up without re-working everything on every pointer move.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Vector3 } from 'three';
import type { ProView } from './scene';
import type { Evaluated } from './evaluate';
import type { ProBuilding, ProProject } from './project';
import { duplicated, formRing, moved, own, removed, spineLength, stretched, turned, type Picked } from './edit';
import { buildingQuads } from '../doc/site';
import { shapeIt, withFloors } from './shapePanel';
import { Icon } from './ui';

type Pt = [number, number];
export interface Tx {
  /** a change starts: the project as it stands is the undo step */
  begin(): void;
  /** part of it (no undo step of its own) */
  live(o: Partial<ProProject>): void;
  /** it's done; a label for the toast */
  commit(label?: string): void;
  /** Escape: put it back as it was */
  cancel(): void;
}
interface Props {
  view: ProView | null; p: ProProject; e: Evaluated; picked: Picked; pick: (x: Picked) => void;
  up: (o: Partial<ProProject>) => void; tx: Tx; snap: boolean;
  /** the scheme can be re-worked while dragging (the wireframe); shaded, only the outline moves until it's let go */
  live: boolean; readOnly: boolean; inspect: () => void; toast: (s: string) => void;
}
type HKind = 'height' | 'end0' | 'end1' | 'side' | 'turn' | 'move';
const r1 = (x: number) => Math.round(x * 10) / 10;
const fmt = (x: number) => (Math.abs(x - Math.round(x)) < 0.05 ? String(Math.round(x)) : x.toFixed(1));

/** a picked building's geometry for the handles: its middle, its axis (along its first wing), its outline's points */
function geomOf(b: ProBuilding, quads: number[][]) {
  let cx = 0, cz = 0, n = 0;
  const pts: Pt[] = [];
  for (const q of quads) for (let i = 0; i + 1 < q.length; i += 2) { cx += q[i]; cz += q[i + 1]; n++; pts.push([q[i], q[i + 1]]); }
  if (n) { cx /= n; cz /= n; }
  const S = b.spine, L = Math.hypot(S[2] - S[0], S[3] - S[1]) || 1, ux = (S[2] - S[0]) / L, uz = (S[3] - S[1]) / L;
  return { c: [cx, cz] as Pt, u: [ux, uz] as Pt, nrm: [-uz, ux] as Pt, pts };
}

export function Hud({ view, p, e, picked, pick, up, tx, snap, live, readOnly, inspect, toast }: Props) {
  const root = useRef<HTMLDivElement>(null), bar = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLElement>()), at = useRef(new Map<string, [number, number, number]>());
  const box = useRef<[number, number, number][]>([]);
  const [dragging, setDragging] = useState<HKind | null>(null);
  const [typing, setTyping] = useState<'len' | 'depth' | 'h' | null>(null);
  /** the building as the drag has it, before the scheme is worked out again */
  const [preview, setPreview] = useState<ProBuilding | null>(null);
  const drag = useRef<null | { k: HKind; base: ProProject; e: Evaluated; b: ProBuilding; g0: Pt | null; y0: number; ppm: number; floors: number; timer: number; pending: Partial<ProProject> | null; changed?: boolean }>(null);

  const bi = picked?.k === 'building' ? e.d.buildings.findIndex((x) => x.b.id === picked.id) : -1;
  const br = bi >= 0 ? e.d.buildings[bi] : null;
  const saved = br ? ((p.scheme?.buildings.find((b) => b.id === br.b.id) ?? { ...br.b, floors: br.floors }) as ProBuilding) : null;
  const ownB = preview && saved && preview.id === saved.id ? preview : saved;
  const show = !!(br && ownB && !readOnly && view);

  // ---------- pinning to the world ----------
  const place = () => {
    const v = view, R = root.current; if (!v || !R) return;
    const W = R.clientWidth, H = R.clientHeight, cam = v.cam, t = new Vector3();
    const toS = (w: [number, number, number]): Pt | null => { t.set(w[0], w[1], w[2]).project(cam); return t.z > 1 || t.z < -1 ? null : [((t.x + 1) / 2) * W, ((1 - t.y) / 2) * H]; };
    for (const [k, el] of els.current) {
      const w = at.current.get(k), s = w ? toS(w) : null;
      if (!s || s[0] < -40 || s[1] < -40 || s[0] > W + 40 || s[1] > H + 40) { el.style.visibility = 'hidden'; continue; }
      el.style.visibility = ''; el.style.transform = `translate(${Math.round(s[0])}px,${Math.round(s[1])}px) translate(-50%,-50%)`;
    }
    const B = bar.current;
    if (B) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const w of box.current) { const s = toS(w); if (!s) continue; x0 = Math.min(x0, s[0]); x1 = Math.max(x1, s[0]); y0 = Math.min(y0, s[1]); y1 = Math.max(y1, s[1]); }
      if (!Number.isFinite(x0)) { B.style.visibility = 'hidden'; return; }
      const res = R.parentElement?.querySelector<HTMLElement>('.results'), top = res ? res.offsetTop + res.offsetHeight + 10 : 12;
      const bw = B.offsetWidth, bh = B.offsetHeight;
      // (between the result bar and the view's toolbar: above the building, else below it, else at the top)
      const tools = R.parentElement?.querySelector<HTMLElement>('.tools'), bottom = (tools ? tools.offsetTop : H - 60) - bh - 8;
      let y = y0 - bh - 26;
      if (y < top) y = y1 + 22 <= bottom ? y1 + 22 : top;
      y = Math.max(top, Math.min(bottom, y));
      const x = Math.max(8, Math.min(W - bw - 8, (x0 + x1) / 2 - bw / 2));
      B.style.visibility = 'visible'; B.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
    }
  };
  useEffect(() => { if (!view) return; view.onFrame = place; return () => { if (view.onFrame === place) view.onFrame = undefined; }; });
  useLayoutEffect(place);
  useEffect(() => {
    if (!dragging) return;
    const k = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && drag.current) { ev.stopImmediatePropagation(); clearTimeout(drag.current.timer); drag.current = null; setDragging(null); setPreview(null); tx.cancel(); view?.overlay(null); } };
    addEventListener('keydown', k, true);
    return () => removeEventListener('keydown', k, true);
  }, [dragging]);

  if (!show || !br || !ownB) { at.current.clear(); box.current = []; return <div class="hud" ref={root} />; }

  // ---------- where the handles go ----------
  const fh = br.height / Math.max(1, br.floors), floors = preview ? Math.max(1, ownB.floors ?? br.floors) : br.floors;
  const g = geomOf(ownB, preview ? (ownB.form ? [formRing(ownB)] : buildingQuads(ownB)) : br.quads), h = preview ? floors * fh : br.height;
  const straight = !ownB.form && !ownB.closed && ownB.spine.length >= 4;
  const S = ownB.spine, n = S.length / 2;
  const half = ownB.depth / 2;
  // the depth handle off the middle of the first wing, the length handles past each end of the spine
  const m0: Pt = [(S[0] + S[2]) / 2, (S[1] + S[3]) / 2];
  const endDir = (k: 0 | 1): Pt => { const [a, b] = k ? [n - 2, n - 1] : [1, 0]; const dx = S[b * 2] - S[a * 2], dz = S[b * 2 + 1] - S[a * 2 + 1], L = Math.hypot(dx, dz) || 1; return [dx / L, dz / L]; };
  const A: [string, [number, number, number]][] = [
    ['h:height', [g.c[0], h + 3, g.c[1]]],
    ['h:move', [g.c[0], h, g.c[1]]],
    ['h:turn', [g.c[0] - g.nrm[0] * (half + 6), 0.3, g.c[1] - g.nrm[1] * (half + 6)]],
    ['d:h', [g.c[0], h + 6.5, g.c[1]]],
  ];
  if (straight) {
    const d0 = endDir(0), d1 = endDir(1);
    A.push(['h:end0', [S[0] + d0[0] * 0.01, 0.3, S[1] + d0[1] * 0.01]], ['h:end1', [S[n * 2 - 2], 0.3, S[n * 2 - 1]]]);
    A.push(['h:side', [m0[0] + g.nrm[0] * half, 0.3, m0[1] + g.nrm[1] * half]]);
    A.push(['d:len', [m0[0] - g.nrm[0] * (half + 2.5), 0.3, m0[1] - g.nrm[1] * (half + 2.5)]]);
    A.push(['d:depth', [m0[0] + g.nrm[0] * (half + 3) + g.u[0] * 4, 0.3, m0[1] + g.nrm[1] * (half + 3) + g.u[1] * 4]]);
  }
  at.current = new Map(A);
  box.current = g.pts.flatMap(([x, z]) => [[x, 0, z], [x, h, z]] as [number, number, number][]);
  const ref = (k: string) => (el: HTMLElement | null) => { if (el) els.current.set(k, el); else els.current.delete(k); };

  // ---------- changing it ----------
  const name = ownB.name ?? `Building ${String.fromCharCode(65 + bi)}`;
  /** the project with this building changed, from a base (the project when a drag began) */
  const withB = (base: ProProject, be: Evaluated, fn: (b: ProBuilding) => ProBuilding): Partial<ProProject> => {
    const s = own(base, be);
    return { scheme: { ...s, buildings: s.buildings.map((b) => (b.id === br.b.id ? fn(b) : b)) } };
  };
  /** a change of its own: one undo step, however soon after the last */
  const once = (o: Partial<ProProject>) => { tx.begin(); tx.live(o); tx.commit(); };
  const setB = (fn: (b: ProBuilding) => ProBuilding) => once(withB(p, e, fn));
  const floorsTo = (k: number) => setB((b) => withFloors(b, Math.max(1, Math.min(300, k))));
  const len = spineLength(ownB);
  const grid = (x: number, alt: boolean) => (snap && !alt ? Math.round(x * 2) / 2 : r1(x));

  const changeFor = (k: HKind, d: NonNullable<typeof drag.current>, ev: PointerEvent): Partial<ProProject> | null => {
    const v = view!, b = d.b, alt = ev.altKey;
    if (k === 'height') {
      const add = Math.round((d.y0 - ev.clientY) / Math.max(1, d.ppm * fh));
      return withB(d.base, d.e, (x) => withFloors(x, Math.max(1, Math.min(300, d.floors + add))));
    }
    const y = k === 'move' ? h : 0, gp = v.groundAt(ev.clientX, ev.clientY, y);
    if (!gp) return null;
    if (k === 'move') {
      if (!d.g0) return null;
      return moved(d.base, d.e, { k: 'building', id: b.id }, grid(gp[0] - d.g0[0], alt), grid(gp[1] - d.g0[1], alt));
    }
    if (k === 'turn') {
      if (!d.g0) return null;
      const c = geomOf(b, br.quads).c, a0 = Math.atan2(d.g0[1] - c[1], d.g0[0] - c[0]), a1 = Math.atan2(gp[1] - c[1], gp[0] - c[0]);
      let deg = ((a1 - a0) * 180) / Math.PI; deg = ((deg + 540) % 360) - 180;
      deg = snap && !alt ? Math.round(deg / 15) * 15 : Math.round(deg);
      return withB(d.base, d.e, (x) => turned(x, deg));
    }
    if (k === 'side') {
      const P = b.spine, L = Math.hypot(P[2] - P[0], P[3] - P[1]) || 1, dist = Math.abs(((gp[0] - P[0]) * (P[3] - P[1]) - (gp[1] - P[1]) * (P[2] - P[0])) / L);
      const dep = Math.max(6, Math.min(80, grid(dist * 2, alt)));
      return withB(d.base, d.e, (x) => ({ ...x, depth: dep }));
    }
    // an end: along its wing from the point before it
    const P = b.spine, m = P.length / 2, [ai, ei] = k === 'end1' ? [m - 2, m - 1] : [1, 0];
    const ax = P[ai * 2], az = P[ai * 2 + 1], dx = P[ei * 2] - ax, dz = P[ei * 2 + 1] - az, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
    const t = Math.max(2, grid((gp[0] - ax) * ux + (gp[1] - az) * uz, alt));
    return withB(d.base, d.e, (x) => { const s = [...x.spine]; s[ei * 2] = r1(ax + ux * t); s[ei * 2 + 1] = r1(az + uz * t); return { ...x, spine: s }; });
  };
  /** where it's going, drawn at once as an outline box (the scheme itself is worked out a few times a second) */
  const ghost = (o: Partial<ProProject>, d: NonNullable<typeof drag.current>) => {
    const nb = o.scheme?.buildings.find((x) => x.id === d.b.id), v = view; if (!nb || !v) return;
    const rings = nb.form ? [formRing(nb)] : buildingQuads(nb), top = Math.max(1, nb.form ? nb.floors ?? d.floors : nb.floors ?? d.floors) * fh, L: number[] = [];
    for (const q of rings) for (let i = 0; i + 1 < q.length; i += 2) {
      const j = (i + 2) % q.length;
      L.push(q[i], 0.1, q[i + 1], q[j], 0.1, q[j + 1], q[i], top, q[i + 1], q[j], top, q[j + 1]);
      if (!nb.form || i % 8 === 0) L.push(q[i], 0.1, q[i + 1], q[i], top, q[i + 1]);
    }
    v.overlay({ lines: L });
  };
  const flush = () => { const d = drag.current; if (d?.pending) { tx.live(d.pending); d.pending = null; d.changed = true; } };
  const down = (k: HKind) => (ev: PointerEvent) => {
    const v = view; if (!v || ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    const y = k === 'move' ? h : 0;
    // (the screen's pixels for a metre up, at the top of the building: the height handle's scale)
    const top = v.toScreen(g.c[0], h, g.c[1]), up1 = v.toScreen(g.c[0], h + 1, g.c[1]);
    drag.current = { k, base: p, e, b: ownB, g0: v.groundAt(ev.clientX, ev.clientY, y), y0: ev.clientY, ppm: Math.hypot(up1[0] - top[0], up1[1] - top[1]), floors: br.floors, timer: 0, pending: null };
    tx.begin(); setDragging(k);
  };
  const move = (ev: PointerEvent) => {
    const d = drag.current; if (!d) return;
    const o = changeFor(d.k, d, ev); if (!o) return;
    d.pending = o; ghost(o, d);
    if (!live) { const nb = o.scheme?.buildings.find((x) => x.id === d.b.id); if (nb) setPreview(nb); return; }
    // (at most one change every 70 ms: the first at once, the last when the pointer rests)
    if (!d.timer) { flush(); d.timer = window.setTimeout(function tick() { const dd = drag.current; if (!dd) return; if (dd.pending) { flush(); dd.timer = window.setTimeout(tick, 120); } else dd.timer = 0; }, 120); }
  };
  const LABEL: Record<HKind, string> = { height: 'Floors', end0: 'Length', end1: 'Length', side: 'Depth', turn: 'Turned', move: 'Moved' };
  const end = (ev: PointerEvent) => {
    const d = drag.current; if (!d) return;
    clearTimeout(d.timer);
    const o = changeFor(d.k, d, ev); if (o) d.pending = o;
    flush(); drag.current = null; setDragging(null); setPreview(null);
    // (a click on a handle that moved nothing leaves no undo step)
    if (d.changed) tx.commit(`${LABEL[d.k]} · ${name}`); else tx.cancel();
  };
  /** a handle's keys: the arrows step it (Shift: bigger) */
  const keys = (k: HKind) => (ev: KeyboardEvent) => {
    const dir = ev.key === 'ArrowUp' || ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowDown' || ev.key === 'ArrowLeft' ? -1 : 0;
    if (!dir || k === 'move') return;
    ev.preventDefault(); ev.stopPropagation();
    const big = ev.shiftKey;
    if (k === 'height') floorsTo(br.floors + dir * (big ? 5 : 1));
    else if (k === 'turn') setB((b) => turned(b, dir * (big ? 90 : 15)));
    else if (k === 'side') setB((b) => ({ ...b, depth: Math.max(6, Math.min(80, b.depth + dir * (big ? 5 : 0.5))) }));
    else setB((b) => stretched(b, Math.max(4, len + dir * (big ? 5 : 0.5))));
  };
  const handle = (k: HKind, icon: string, label: string, value?: { now: number; min: number; max: number; text: string }) => (
    <button type="button" ref={ref(`h:${k}`)} class={`hh hh-${k}${dragging === k ? ' on' : ''}`} aria-label={label} data-tip={dragging ? undefined : label}
      {...(value ? { role: 'slider', 'aria-valuenow': value.now, 'aria-valuemin': value.min, 'aria-valuemax': value.max, 'aria-valuetext': value.text } : {})}
      onPointerDown={down(k)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onKeyDown={keys(k)}><Icon n={icon} size={14} stroke={2} /></button>
  );

  // ---------- the measurements: click one to type it ----------
  const dims: { k: 'len' | 'depth' | 'h'; text: string; now: number; unit: string; set: (x: number) => void }[] = [
    { k: 'h', text: `${floors} floors · ${fmt(h)} m`, now: floors, unit: 'floors', set: (x) => floorsTo(Math.round(x)) },
  ];
  if (straight) dims.push(
    { k: 'len', text: `${fmt(len)} m`, now: r1(len), unit: 'm long', set: (x) => setB((b) => stretched(b, Math.max(4, Math.min(600, x)))) },
    { k: 'depth', text: `${fmt(ownB.depth)} m deep`, now: ownB.depth, unit: 'm deep', set: (x) => setB((b) => ({ ...b, depth: Math.max(6, Math.min(80, x)) })) },
  );
  const dim = (x: (typeof dims)[number]) => (
    <div ref={ref(`d:${x.k}`)} class={`hdim${dragging ? ' quiet' : ''}`}>
      {typing === x.k
        ? <form onSubmit={(ev) => { ev.preventDefault(); const v = parseFloat(((ev.currentTarget as HTMLFormElement).elements.namedItem('v') as HTMLInputElement).value); if (Number.isFinite(v) && v > 0) x.set(v); setTyping(null); }}>
          <input name="v" type="number" step="any" inputMode="decimal" value={x.now} aria-label={`${name}: ${x.unit}`} ref={(el) => { if (el && document.activeElement !== el) { el.focus(); el.select(); } }}
            onKeyDown={(ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); setTyping(null); } }} onBlur={() => setTyping(null)} /><span>{x.unit}</span></form>
        : <button type="button" aria-label={`${x.text}: type a value`} data-tip="Click to type a value" onClick={() => setTyping(x.k)}>{x.text}</button>}
    </div>
  );

  const tipFloors = br.maxFloors ? `Floors · up to ${br.maxFloors} within the margins` : 'Floors';
  return (
    <div class={`hud${dragging ? ' dragging' : ''}`} ref={root}>
      {handle('height', 'updown', tipFloors, { now: br.floors, min: 1, max: 300, text: `${br.floors} floors` })}
      {handle('move', 'move', 'Move (drag, or the arrow keys)')}
      {handle('turn', 'rotate', 'Turn (15° steps; Alt for any angle)', { now: 0, min: -180, max: 180, text: 'turn' })}
      {straight && handle('end0', 'sideways', 'Length: drag this end', { now: r1(len), min: 4, max: 600, text: `${fmt(len)} m long` })}
      {straight && handle('end1', 'sideways', 'Length: drag this end', { now: r1(len), min: 4, max: 600, text: `${fmt(len)} m long` })}
      {straight && handle('side', 'sideways', 'Depth: drag this side', { now: ownB.depth, min: 6, max: 80, text: `${fmt(ownB.depth)} m deep` })}
      {dims.map(dim)}
      <div class="hbar" ref={bar} role="toolbar" aria-label={`${name}: edit`}>
        <input class="hname" value={name} aria-label="Name" size={Math.max(6, Math.min(18, name.length))} onChange={(ev) => setB((b) => ({ ...b, name: (ev.target as HTMLInputElement).value || undefined }))} />
        <span class="hsep" />
        <div class="hstep" role="group" aria-label="Floors">
          <button type="button" aria-label="One floor fewer" data-tip="One floor fewer (−)" disabled={br.floors <= 1} onClick={() => floorsTo(br.floors - 1)}><Icon n="minus" size={14} /></button>
          <b>{br.floors}<small> fl</small></b>
          <button type="button" aria-label="One floor more" data-tip="One floor more (+)" onClick={() => floorsTo(br.floors + 1)}><Icon n="plus" size={14} /></button>
        </div>
        <span class="hsep" />
        <button type="button" data-tip="Turn 15° anticlockwise (Shift+R)" onClick={() => setB((b) => turned(b, -15))}>−15°</button>
        <button type="button" data-tip="Turn 15° clockwise (R)" onClick={() => setB((b) => turned(b, 15))}>+15°</button>
        <button type="button" data-tip="Turn a quarter" onClick={() => setB((b) => turned(b, 90))}>90°</button>
        <span class="hsep" />
        {!ownB.form && ownB.spine.length === 4 && !ownB.closed && <button type="button" data-tip="Shape it: give it a form to sculpt" aria-label="Shape it" onClick={() => setB((b) => shapeIt(b, br.floors))}><Icon n="wand" size={15} /></button>}
        <button type="button" aria-label="Duplicate" data-tip="Duplicate (Ctrl+D)" onClick={() => { const s = own(p, e), src = s.buildings.find((b) => b.id === br.b.id); if (!src) return; const c = duplicated(src); once({ scheme: { ...s, buildings: [...s.buildings, c] } }); pick({ k: 'building', id: c.id }); toast(`Duplicated ${name}.`); }}><Icon n="copy" size={15} /></button>
        <button type="button" aria-label="Remove" data-tip="Remove (Delete)" onClick={() => { once(removed(p, e, { k: 'building', id: br.b.id })); pick(null); toast(`Removed ${name} · Ctrl+Z to undo`); }}><Icon n="trash" size={15} /></button>
        <span class="hsep" />
        <button type="button" class="hinspect" data-tip="Its mix, design system, systems and flat plans" onClick={inspect}><Icon n="panel" size={15} />Inspect</button>
        <button type="button" aria-label="Deselect" data-tip="Deselect (Esc)" onClick={() => pick(null)}><Icon n="x" size={14} /></button>
      </div>
    </div>
  );
}
