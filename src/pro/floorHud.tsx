// "Edit this floor" (docs/plans/pro-design-freedom.md §4.3): on a formed building's X-ray floor, its plan by hand.
// - A floor the planner laid out offers "Edit this floor": its units become the designer's, on the run of floors that
//   share them (./floorEdit.ts `startPlan`), and nothing changes until they're edited.
// - Each unit has a chip at its middle: click it to pick it. A picked unit shows its corners (drag one: every unit
//   sharing it follows, so a party wall moves for both; it snaps to other corners and a 10 cm grid) and its walls'
//   middles (drag to push the wall out or in), and the bar gives its type (1, 2 or 3 BHK, or by its size), its use,
//   split, merge with the next one picked, and remove.
// - The bar says which floors the plan is on ("only this floor" narrows it to the X-ray floor), and "Lay out again"
//   gives the floors back to the planner.
// What's drawn on the floor is the engine's: the units cut to the floor and clear of the cores, as the X-ray shows them.
import { useEffect, useRef, useState } from 'preact/hooks';
import { handPlanAt, toLocal, toWorld, USE_INFO, type BuildingUse, type Form, type FloorPlanEdit, type HandUnit } from './form';
import { dropPlan, mergeUnits, moveVertex, pushWall, removeUnit, runOf, setRange, setUnit, snapTo, splitUnit, startPlan, unitMid, wallNormal } from './floorEdit';
import { usePins, type Tx } from './hud';
import { own, type CanvasEdit, type Picked } from './edit';
import type { Evaluated } from './evaluate';
import type { ProBuilding, ProProject } from './project';
import type { ProView } from './scene';
import { USES, withForm } from './shapePanel';
import { CARPET, UNIT_LABEL } from '../doc/site';
import { Icon } from './ui';

type W3 = [number, number, number];
interface Props { view: ProView | null; edit: CanvasEdit | null; p: ProProject; e: Evaluated; picked: Picked; tx: Tx; readOnly: boolean; xray: number; toast: (s: string) => void }
type Drag =
  | { k: 'v'; unit: string; i: number; base: ProProject; e: Evaluated; f: Form; plan: string }
  | { k: 'w'; unit: string; i: number; base: ProProject; e: Evaluated; f: Form; plan: string; x0: number; z0: number };

const r1 = (v: number) => Math.round(v * 10) / 10;

export function FloorHud({ view, edit, p, e, picked, tx, readOnly, xray, toast }: Props) {
  const { root, at, ref } = usePins(view);
  const [sel, setSel] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [pv, setPv] = useState<Form | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const drag = useRef<Drag | null>(null);

  const bi = picked?.k === 'building' ? e.d.buildings.findIndex((x) => x.b.id === picked.id) : -1;
  const br = bi >= 0 ? e.d.buildings[bi] : null;
  const saved = br ? ((p.scheme?.buildings.find((b) => b.id === br.b.id) ?? null) as ProBuilding | null) : null;
  const L = br ? e.forms[br.b.id] : null;
  const f0 = saved?.form ?? null, f = pv ?? f0;
  const n = L ? Math.max(1, Math.min(L.floors.length, xray)) : 1;
  const plan = f ? handPlanAt(f, n) : undefined;
  const fl = L?.floors[n - 1];
  const y = (fl?.y ?? 0) + 0.35;
  const W = (x: number, z: number): W3 => { const [X, Z] = toWorld(saved!, x, z); return [X, y, Z]; };

  // (the hand units' outlines on the floor, so a drag shows before the floor is laid again)
  const decorKey = plan && saved ? JSON.stringify([plan.units.map((u) => u.ring), y, sel, saved.spine]) : '';
  useEffect(() => {
    if (!edit) return;
    if (!plan || !saved) { return; }
    const lines: number[] = [], strong: number[] = [];
    for (const u of plan.units) {
      const out = u.id === sel ? strong : lines;
      for (let k = 0; k < u.ring.length; k += 2) { const q = (k + 2) % u.ring.length, a = W(u.ring[k], u.ring[k + 1]), b = W(u.ring[q], u.ring[q + 1]); out.push(...a, ...b); }
    }
    edit.decor = { lines: strong, dashed: lines };
    edit.draw();
    return () => { edit.decor = null; edit.draw(); };
  }, [decorKey, edit]);
  // (a new building or floor: nothing picked)
  useEffect(() => { setSel(null); setMerging(false); }, [br?.b.id, plan?.id]);
  useEscape(dragging, () => { drag.current = null; setDragging(null); setPv(null); });

  if (!br || !saved || !f0 || !L || !fl || readOnly || !view) { at.current.clear(); return <div class="hud" ref={root} />; }

  const name = saved.name ?? `Building ${String.fromCharCode(65 + bi)}`;
  const withB = (base: ProProject, be: Evaluated, nf: Form): Partial<ProProject> => {
    const s = own(base, be);
    return { scheme: { ...s, buildings: s.buildings.map((b) => (b.id === br.b.id ? withForm(b, nf) : b)) } };
  };
  const setForm = (nf: Form, label: string) => { tx.begin(); tx.live(withB(p, e, nf)); tx.commit(`${label} · ${name}`); };

  // ---------- anchors ----------
  const A: [string, W3][] = [];
  // (the bar: in front of the floor, past its nearest edge to the road)
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity;
  for (let k = 0; k < fl.outer.length; k += 2) { const [lx, lz] = toLocal(saved, fl.outer[k], fl.outer[k + 1]); x0 = Math.min(x0, lx); x1 = Math.max(x1, lx); z0 = Math.min(z0, lz); }
  A.push(['fbar', W((x0 + x1) / 2, z0 - 4)]);
  const units = plan?.units ?? [];
  const u = units.find((q) => q.id === sel) ?? null;
  for (const q of units) { const m = unitMid(q); A.push([`u${q.id}`, W(m.x, m.z)]); }
  // (handles only where they mean something: a corner that turns, or one another unit shares, and a wall long enough
  //  to push; the points along a curved edge get none)
  const corners = u ? realCorners(u, units) : [], walls = u ? longWalls(u) : [];
  if (u) {
    const N = u.ring.length / 2;
    for (const i of corners) A.push([`v${i}`, W(u.ring[i * 2], u.ring[i * 2 + 1])]);
    for (const i of walls) { const j = (i + 1) % N; A.push([`w${i}`, W((u.ring[i * 2] + u.ring[j * 2]) / 2, (u.ring[i * 2 + 1] + u.ring[j * 2 + 1]) / 2)]); }
  }
  at.current = new Map(A);

  // ---------- dragging ----------
  const localAt = (ev: PointerEvent): [number, number] | null => { const g = view.groundAt(ev.clientX, ev.clientY, y); return g ? toLocal(saved, g[0], g[1]) : null; };
  const formOf = (d: Drag, ev: PointerEvent): Form | null => {
    const q = localAt(ev); if (!q) return null;
    const pl = d.f.floorPlans?.find((x) => x.id === d.plan); if (!pl) return null;
    if (d.k === 'v') {
      const [sx, sz] = ev.altKey ? [r1(q[0]), r1(q[1])] : snapTo(pl.units, { unit: d.unit, i: d.i }, q[0], q[1]);
      return moveVertex(d.f, d.plan, d.unit, d.i, sx, sz);
    }
    const un = pl.units.find((x) => x.id === d.unit); if (!un) return null;
    const [nx, nz] = wallNormal(un.ring, d.i), step = ev.altKey ? 0.05 : 0.1;
    const dist = Math.round(((q[0] - d.x0) * nx + (q[1] - d.z0) * nz) / step) * step;
    return Math.abs(dist) < 1e-6 ? d.f : pushWall(d.f, d.plan, d.unit, d.i, dist);
  };
  const down = (k: 'v' | 'w', i: number) => (ev: PointerEvent) => {
    if (ev.button !== 0 || !u || !plan) return;
    ev.preventDefault(); ev.stopPropagation();
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    const q = localAt(ev);
    drag.current = k === 'v' ? { k, unit: u.id, i, base: p, e, f: f0, plan: plan.id } : { k, unit: u.id, i, base: p, e, f: f0, plan: plan.id, x0: q?.[0] ?? 0, z0: q?.[1] ?? 0 };
    setDragging(`${k}${i}`);
  };
  const move = (ev: PointerEvent) => { const d = drag.current; if (!d) return; const nf = formOf(d, ev); if (nf) setPv(nf); };
  const end = () => {
    const d = drag.current; if (!d) return;
    drag.current = null; setDragging(null);
    const last = pv; setPv(null);
    if (last && JSON.stringify(last.floorPlans) !== JSON.stringify(d.f.floorPlans)) { tx.begin(); tx.live(withB(d.base, d.e, last)); tx.commit(`${d.k === 'v' ? 'Corner' : 'Wall'} · ${name}`); }
  };

  // ---------- the commands ----------
  const startHere = () => { setForm(startPlan(f0, saved, L, n), `Floor ${n} by hand`); toast('The floor is yours: pick a unit to move its walls, split, merge or change it. "Lay out again" gives it back to the planner.'); };
  const pickUnit = (id: string) => {
    if (merging && sel && plan && id !== sel) {
      const m = mergeUnits(f0, plan.id, sel, id);
      setMerging(false);
      if (!m) { toast('Those two don’t touch: pick a unit next to it.'); return; }
      setForm(m, 'Merge units'); return;
    }
    setSel(sel === id ? null : id); setMerging(false);
  };
  const typeOf = (q: HandUnit) => q.t;
  const label = (q: HandUnit) => {
    const use = q.use ?? fl.use;
    // (the area it counts: as laid, cut to the floor, clear of the cores and of units before it)
    const laid = fl.units.find((x) => x.hand === q.id), a = laid ? laid.carpet / CARPET : unitMid(q).area;
    if (!laid) return `Off the floor · ${Math.round(a)} m²`;
    // (no type set: the one its size makes it, as the floor is laid out)
    const t = q.t ?? laid.t;
    if (use === 'residential') return `${t < 3 ? UNIT_LABEL[t] : 'Home'} · ${Math.round(a)} m²`;
    return `${USE_INFO[use].label} · ${Math.round(a)} m²`;
  };
  const [lo, hi] = plan ? [plan.lo, plan.hi] : runOf(L, n);
  const floorsText = lo === hi ? `floor ${lo}` : `floors ${lo}–${hi}`;

  const hh = (key: string, cls: string, icon: string, tip: string, on: (ev: PointerEvent) => void) => (
    <button type="button" ref={ref(key)} class={`hh ${cls}${dragging === key ? ' on' : ''}`} aria-label={tip} data-tip={dragging ? undefined : tip}
      onPointerDown={on} onPointerMove={move} onPointerUp={end} onPointerCancel={end}><Icon n={icon} size={10} stroke={2.2} /></button>
  );
  return (
    <div class={`hud${dragging ? ' dragging' : ''}`} ref={root}>
      {units.map((q) => (
        <button type="button" ref={ref(`u${q.id}`)} class={`hunit${q.id === sel ? ' on' : ''}${merging && q.id !== sel ? ' target' : ''}`} aria-pressed={q.id === sel}
          data-tip={merging && q.id !== sel ? 'Merge with this one' : 'Pick it: walls, type, split, merge'} onClick={() => pickUnit(q.id)}>{label(q)}</button>
      ))}
      {corners.map((i) => hh(`v${i}`, 'hh-v', 'move', 'A corner: drag it (snaps to corners and 10 cm; Alt: free). Units sharing it follow.', down('v', i)))}
      {walls.map((i) => hh(`w${i}`, 'hh-face hh-space', 'sideways', 'A wall: drag to push it out or in', down('w', i)))}
      <div class="hbar hfloor" ref={ref('fbar')} role="toolbar" aria-label={`${name}, floor ${n}: its plan`}>
        {!plan && <>
          <span class="hmeta">Floor {n} · laid out ({floorsText} alike)</span>
          <button type="button" class="hprimary" onClick={startHere} data-tip="Take this floor's units as they are, and edit them by hand"><Icon n="edit" size={15} />Edit this floor</button>
        </>}
        {plan && !u && <>
          <span class="hmeta">By hand · {floorsText}</span>
          {lo !== hi && <button type="button" onClick={() => setForm(setRange(f0, plan.id, n, n, L.floors.length), 'Only this floor')} data-tip={`Keep the plan on floor ${n} alone; the others go back to their own`}>Only floor {n}</button>}
          {lo === hi && runOf(L, n)[1] > n && <button type="button" onClick={() => setForm(setRange(f0, plan.id, n, L.floors.length, L.floors.length), 'Floors above too')} data-tip="The same plan on every floor above">And the floors above</button>}
          <button type="button" onClick={() => { setForm(dropPlan(f0, plan.id), 'Lay out again'); setSel(null); }} data-tip="Give these floors back to the planner"><Icon n="rotate" size={14} />Lay out again</button>
          <span class="hmeta">Pick a unit</span>
        </>}
        {plan && u && <>
          <span class="hmeta">{label(u)}</span>
          {(u.use ?? fl.use) === 'residential' && <div class="hseg" role="radiogroup" aria-label="Type">
            {([undefined, 0, 1, 2] as const).map((t) => <button type="button" role="radio" aria-checked={typeOf(u) === t} onClick={() => setForm(setUnit(f0, plan.id, u.id, u.use, t), 'Unit type')}>{t === undefined ? 'By size' : UNIT_LABEL[t]}</button>)}
          </div>}
          <select class="sel quiet" aria-label="Its use" value={u.use ?? ''} onChange={(ev) => { const v = (ev.currentTarget as HTMLSelectElement).value as BuildingUse | ''; setForm(setUnit(f0, plan.id, u.id, v || undefined, v && v !== 'residential' ? undefined : u.t), 'Unit use'); }}>
            <option value="">As the floor ({USE_INFO[fl.use].label})</option>
            {USES.filter((x) => x !== 'none' && x !== 'parking').map((x) => <option value={x}>{USE_INFO[x].label}</option>)}
          </select>
          <button type="button" onClick={() => setForm(splitUnit(f0, plan.id, u.id), 'Split unit')} data-tip="Split it in two across its length"><Icon n="slot" size={14} />Split</button>
          <button type="button" class={merging ? 'on' : ''} aria-pressed={merging} onClick={() => setMerging(!merging)} data-tip="Merge: then pick the unit next to it"><Icon n="link" size={14} />Merge</button>
          <button type="button" onClick={() => { setForm(removeUnit(f0, plan.id, u.id), 'Remove unit'); setSel(null); }} data-tip="Take it away: its area is left out"><Icon n="trash" size={14} /></button>
          <button type="button" onClick={() => setSel(null)} aria-label="Done with this unit"><Icon n="x" size={14} /></button>
        </>}
      </div>
    </div>
  );
}

/** a unit's corners worth a handle: where its outline turns by more than 25°, or where another unit has a corner */
function realCorners(u: HandUnit, units: HandUnit[]): number[] {
  const r = u.ring, N = r.length / 2, out: number[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i + N - 1) % N, b = (i + 1) % N;
    const ax = r[i * 2] - r[a * 2], az = r[i * 2 + 1] - r[a * 2 + 1], bx = r[b * 2] - r[i * 2], bz = r[b * 2 + 1] - r[i * 2 + 1];
    const turn = Math.abs(Math.atan2(ax * bz - az * bx, ax * bx + az * bz));
    const shared = units.some((o) => o !== u && o.ring.some((v, k) => k % 2 === 0 && Math.hypot(v - r[i * 2], o.ring[k + 1] - r[i * 2 + 1]) < 0.05));
    if (turn > (25 * Math.PI) / 180 || (shared && turn > (5 * Math.PI) / 180)) out.push(i);
  }
  return out;
}
/** a unit's walls worth a handle: 1.5 m long or more */
function longWalls(u: HandUnit): number[] {
  const r = u.ring, N = r.length / 2, out: number[] = [];
  for (let i = 0; i < N; i++) { const j = (i + 1) % N; if (Math.hypot(r[j * 2] - r[i * 2], r[j * 2 + 1] - r[i * 2 + 1]) >= 1.5) out.push(i); }
  return out;
}

/** Escape while dragging puts it back */
function useEscape(on: string | null, cancel: () => void) {
  useEffect(() => {
    if (!on) return;
    const k = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.stopImmediatePropagation(); cancel(); } };
    addEventListener('keydown', k, true);
    return () => removeEventListener('keydown', k, true);
  }, [on]);
}

export type { FloorPlanEdit };
