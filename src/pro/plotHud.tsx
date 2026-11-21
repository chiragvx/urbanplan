// The plot edited where it lies: picked by a click on open ground inside it (on the Site step it's there whenever
// nothing else is picked).
// - its corners are handles (snapped as drawing is); a + in each edge's middle puts in a corner; Delete on a focused
//   corner takes it away while three are left;
// - each edge's length is on it: click it to type a length (the far corner moves along the edge);
// - each edge has a chip outside it for its road: "12 m road · DP 18", or a faint "+ road"; click it for today's
//   width, the DP's, and the carriageway and footpaths that leaves;
// - a slope arrow from the middle, toward where it falls: drag its head (direction in 45° steps, steeper as it
//   lengthens);
// - the plot bar: its area, its size (a rectangle again), drawing it again, finding it by survey number or importing
//   it (in the panel), its levels and the terrain, the authority.
// The first edit by hand makes a rectangle a drawn outline (said once). A drag is one undo step.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { ProView } from './scene';
import type { Evaluated } from './evaluate';
import { CITIES, outline, type ProProject } from './project';
import type { CanvasEdit, Picked, Tool } from './edit';
import { cap, DIRS, edgeFacing, edgeOut, readGround, withCornerAdded, withCornerRemoved, withEdgeLength, withEdgeRoad, withRing } from './plotOps';
import { DEFAULT_LEVELS, PLINTH_MIN, roadParts, roadWidths, type Levels } from './siteObjects';
import { usePins, type Tx } from './hud';
import { Btn, Icon, Note, nf, Num, Row, Select, sqft } from './ui';

type Pt = [number, number];
interface Props {
  view: ProView | null; edit: CanvasEdit | null; p: ProProject; e: Evaluated; picked: Picked; pick: (x: Picked) => void;
  tx: Tx; snap: boolean; live: boolean; readOnly: boolean; toast: (s: string) => void; setTool: (t: Tool) => void;
  /** open the panel's way to set the plot (its survey number, an import) */
  openWay: (w: 'survey' | 'import') => void;
  /** north may be turned though it was set from the plot's place */
  northFree: boolean; setNorthFree: (v: boolean) => void;
}
const r2 = (x: number) => Math.round(x * 100) / 100;
const fmt = (x: number) => (Math.abs(x - Math.round(x)) < 0.05 ? String(Math.round(x)) : x.toFixed(1));

export function PlotHud({ view, edit, p, e, picked, pick, tx, snap, live, readOnly, toast, setTool, openWay, northFree, setNorthFree }: Props) {
  const { root, bar, at, box, ref } = usePins(view);
  const [dragging, setDragging] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [typing, setTyping] = useState<number | null>(null);
  const [reading, setReading] = useState(false), [noTerrain, setNoTerrain] = useState(false);
  /** the outline as a drag has it, before the project's worked out again (shaded) */
  const [pv, setPv] = useState<number[] | null>(null);
  const drag = useRef<null | { key: string; i: number; base: ProProject; ring: number[]; roads: ReturnType<typeof outline>['roads']; timer: number; pending: Partial<ProProject> | null; changed?: boolean }>(null);
  const said = useRef(false);

  const o = outline(p), ring = pv ?? o.ring, n = ring.length / 2, north = p.north ?? 0;
  const L: Levels = { ...DEFAULT_LEVELS, ...(p.levels ?? {}) };
  let cx = 0, cz = 0; for (let i = 0; i < ring.length; i += 2) { cx += ring[i] / n; cz += ring[i + 1] / n; }
  // the slope arrow: toward where it falls, longer as it's steeper
  const fa = ((L.dir + north) * Math.PI) / 180, fall: Pt = [Math.sin(fa), -Math.cos(fa)], alen = 8 + Math.min(30, L.slope);
  const head: Pt = [cx + fall[0] * alen, cz + fall[1] * alen];
  const decorKey = `${cx}|${cz}|${L.slope}|${L.dir}|${north}|${pv ? pv.join() : ''}`;
  useEffect(() => {
    if (!edit) return;
    const lines: number[] = [cx, 0.3, cz, head[0], 0.3, head[1]];
    const s = 2.2, lx = -fall[1], lz = fall[0];
    lines.push(head[0], 0.3, head[1], head[0] - fall[0] * s + lx * s * 0.6, 0.3, head[1] - fall[1] * s + lz * s * 0.6, head[0], 0.3, head[1], head[0] - fall[0] * s - lx * s * 0.6, 0.3, head[1] - fall[1] * s - lz * s * 0.6);
    // (a drag's outline, shaded, before it's worked out)
    const dashed: number[] = [];
    if (pv) for (let i = 0; i < pv.length; i += 2) { const j = (i + 2) % pv.length; dashed.push(pv[i], 0.25, pv[i + 1], pv[j], 0.25, pv[j + 1]); }
    edit.decor = { lines: L.slope > 0 ? lines : [], dashed };
    edit.draw();
    return () => { edit.decor = null; edit.draw(); };
  }, [decorKey, edit]);
  useEffect(() => {
    if (!dragging) return;
    const k = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && drag.current) { ev.stopImmediatePropagation(); clearTimeout(drag.current.timer); drag.current = null; setDragging(null); setPv(null); tx.cancel(); edit?.clearSnap(); } };
    addEventListener('keydown', k, true);
    return () => removeEventListener('keydown', k, true);
  }, [dragging]);
  // (a click outside a popover, or Escape, closes it; the select lists are portalled, so clicks there count as inside)
  useEffect(() => {
    if (!open) return;
    const down = (ev: PointerEvent) => { const t = ev.target as HTMLElement; if (!t.closest?.('.hpop') && !t.closest?.('.sel-pop') && !t.closest?.(`[data-pop="${open}"]`)) setOpen(null); };
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape' && !(ev.target as HTMLElement)?.closest?.('.sel-pop')) { ev.stopImmediatePropagation(); setOpen(null); } };
    document.addEventListener('pointerdown', down, true); addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', down, true); removeEventListener('keydown', key, true); };
  }, [open]);

  if (readOnly || !view) { at.current.clear(); box.current = []; return <div class="hud" ref={root} />; }

  // ---------- anchors ----------
  const A: [string, [number, number, number]][] = [];
  for (let k = 0; k < n; k++) {
    const i = 2 * k, j = 2 * ((k + 1) % n), mx = (ring[i] + ring[j]) / 2, mz = (ring[i + 1] + ring[j + 1]) / 2, [ox, oz] = edgeOut(ring, k), rd = o.roads[k];
    A.push([`c${k}`, [ring[i], 0.2, ring[i + 1]]], [`m${k}`, [mx, 0.2, mz]]);
    A.push([`L${k}`, [mx - ox * 3, 0.2, mz - oz * 3]]);
    const off = rd ? Math.max(rd.today, rd.dp) / 2 + 2.5 : 4;
    A.push([`R${k}`, [mx + ox * off, 0.2, mz + oz * off]]);
  }
  A.push(['sl', [head[0], 0.3, head[1]]]);
  at.current = new Map(A);
  const bx: [number, number, number][] = []; for (let i = 0; i < ring.length; i += 2) bx.push([ring[i], 0, ring[i + 1]]);
  box.current = bx;

  // ---------- changing it ----------
  const once = (c: Partial<ProProject>) => { tx.begin(); tx.live(c); tx.commit(); if (p.shape !== 'poly' && c.shape === 'poly' && !said.current) { said.current = true; toast('The plot is now drawn by its corners. Size makes it a rectangle again.'); } };
  const changeFor = (d: NonNullable<typeof drag.current>, ev: PointerEvent): { c: Partial<ProProject>; ring?: number[] } | null => {
    if (d.key === 'sl') {
      const g = view.groundAt(ev.clientX, ev.clientY); if (!g) return null;
      const wx = g[0] - cx, wz = g[1] - cz, dist = Math.hypot(wx, wz);
      const bearing = ((Math.atan2(wx, -wz) * 180) / Math.PI - north + 720) % 360, dir = (Math.round(bearing / 45) * 45) % 360;
      const slope = dist < 6 ? 0 : Math.max(0, Math.min(60, Math.round((dist - 8) * 2) / 2));
      return { c: { levels: { ...L, dir, slope, terrain: false } } };
    }
    const extra: number[] = []; for (let i = 0; i < d.ring.length; i += 2) if (i / 2 !== d.i) extra.push(d.ring[i], d.ring[i + 1]);
    const g = edit?.snapAt(ev.clientX, ev.clientY, ev, { extra }) ?? view.groundAt(ev.clientX, ev.clientY);
    if (!g) return null;
    const nr = [...d.ring]; nr[d.i * 2] = r2(g[0]); nr[d.i * 2 + 1] = r2(g[1]);
    return { c: withRing(nr, d.roads), ring: nr };
  };
  const flush = () => { const d = drag.current; if (d?.pending) { tx.live(d.pending); d.pending = null; d.changed = true; } };
  const down = (key: string, i: number) => (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation(); setOpen(null);
    (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId);
    tx.begin();
    let base = p, r0 = o.ring, roads = o.roads, idx = i;
    if (key.startsWith('m')) {
      // (a new corner in the edge's middle, then dragged)
      const c = withCornerAdded(p, i); tx.live(c); base = { ...p, ...c }; r0 = c.ring!; roads = c.edgeRoads!; idx = i + 1;
    }
    drag.current = { key: key.startsWith('m') ? `c${idx}` : key, i: idx, base, ring: r0, roads, timer: 0, pending: null, changed: key.startsWith('m') };
    setDragging(drag.current.key);
  };
  const move = (ev: PointerEvent) => {
    const d = drag.current; if (!d) return;
    const x = changeFor(d, ev); if (!x) return;
    // (shaded, the outline moves as a dashed line and the plot is worked out when let go; the slope always live)
    if (!live && x.ring) { d.pending = x.c; setPv(x.ring); return; }
    d.pending = x.c;
    if (!d.timer) { flush(); d.timer = window.setTimeout(function tick() { const dd = drag.current; if (!dd) return; if (dd.pending) { flush(); dd.timer = window.setTimeout(tick, 120); } else dd.timer = 0; }, 120); }
  };
  const end = (ev: PointerEvent) => {
    const d = drag.current; if (!d) return;
    clearTimeout(d.timer);
    const x = changeFor(d, ev); if (x) d.pending = x.c;
    flush(); drag.current = null; setDragging(null); setPv(null); edit?.clearSnap();
    if (d.changed) { tx.commit(); if (p.shape !== 'poly' && !said.current && d.key !== 'sl') { said.current = true; toast('The plot is now drawn by its corners. Size makes it a rectangle again.'); } } else tx.cancel();
  };
  const ckeys = (c: number) => (ev: KeyboardEvent) => {
    if (ev.key !== 'Delete' && ev.key !== 'Backspace') return;
    ev.preventDefault(); ev.stopPropagation();
    const x = withCornerRemoved(p, c); if (!x) { toast('A plot needs at least three corners.'); return; } once(x);
  };

  // ---------- reading the ground ----------
  const read = async (opn = false) => {
    if (!p.at) return;
    setReading(true);
    const res = await readGround(p, p.at, o.ring, { open: opn });
    setReading(false);
    if ('fail' in res) { setNoTerrain(res.noTerrain); toast(res.fail); return; }
    setNoTerrain(false); once(res.change); toast(res.msg);
  };
  const setLv = (x: Partial<Levels>) => once({ levels: { ...L, ...x } });

  const widths = roadWidths(e.r.code), noRoad = !o.roads.some(Boolean);
  // (a popover opens upward when what opened it is in the lower half of the view)
  const upward = (id: string) => { const b = root.current?.querySelector(`[data-pop="${id}"]`)?.getBoundingClientRect(), R = root.current?.getBoundingClientRect(); return !!b && !!R && b.top - R.top > R.height / 2; };
  const pop = (id: string, body: ComponentChildren) => open === id && <div class={`hpop${upward(id) ? " up" : ""}`} role="dialog" onKeyDown={(ev) => ev.stopPropagation()}>{body}</div>;
  return (
    <div class={`hud${dragging ? ' dragging' : ''}`} ref={root}>
      {Array.from({ length: n }, (_, k) => {
        const i = 2 * k, j = 2 * ((k + 1) % n), len = Math.hypot(ring[j] - ring[i], ring[j + 1] - ring[i + 1]), rd = o.roads[k], face = edgeFacing(ring, k, north), pr = rd ? roadParts(Math.max(rd.today, rd.dp)) : null;
        return <>
          <button type="button" ref={ref(`c${k}`)} class={`hh hh-v plot${dragging === `c${k}` ? ' on' : ''}`} aria-label={`Corner ${k + 1}: drag it; Delete takes it away`} data-tip={dragging ? undefined : 'Drag · Delete removes it'}
            onPointerDown={down(`c${k}`, k)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onKeyDown={ckeys(k)} />
          {!pv && <button type="button" ref={ref(`m${k}`)} class="hh hh-mid" aria-label={`A new corner in the ${face} edge`} data-tip={dragging ? undefined : 'Drag for a new corner'}
            onPointerDown={down(`m${k}`, k)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}><Icon n="plus" size={10} stroke={2.4} /></button>}
          <div ref={ref(`L${k}`)} class={`hdim${dragging ? ' quiet' : ''}`}>
            {typing === k
              ? <form onSubmit={(ev) => { ev.preventDefault(); const v = parseFloat(((ev.currentTarget as HTMLFormElement).elements.namedItem('v') as HTMLInputElement).value); if (Number.isFinite(v) && v >= 1) once(withEdgeLength(p, k, v)); setTyping(null); }}>
                <input name="v" type="number" step="any" value={r2(len)} aria-label={`The ${face} edge's length (m)`} ref={(el) => { if (el && document.activeElement !== el) { el.focus(); el.select(); } }}
                  onKeyDown={(ev) => { ev.stopPropagation(); if (ev.key === 'Escape') setTyping(null); }} onBlur={() => setTyping(null)} /><span>m</span></form>
              : <button type="button" aria-label={`The ${face} edge: ${fmt(len)} m, type a length`} data-tip="Click to type its length" onClick={() => setTyping(k)}>{fmt(len)} m</button>}
          </div>
          {!dragging && <div ref={ref(`R${k}`)} class="hroad" data-pop={`R${k}`}>
            <button type="button" class={rd ? 'on' : 'none'} aria-haspopup="dialog" aria-expanded={open === `R${k}`} data-tip={`${cap(face)} edge`} onClick={() => setOpen(open === `R${k}` ? null : `R${k}`)}>
              {rd ? <>{rd.today} m road{rd.dp > rd.today ? <small> · DP {rd.dp}</small> : null}</> : '+ road'}
            </button>
            {pop(`R${k}`, <>
              <b>{cap(face)} edge · {fmt(len)} m</b>
              <Select<number> size="sm" label="Road today" value={rd?.today ?? 0} onChange={(v) => once(withEdgeRoad(p, k, v ? { today: v, dp: Math.max(rd?.dp ?? 0, 0) } : null))}
                options={[{ value: 0, label: 'No road' }, ...widths.map((w) => ({ value: w, label: `${w} m road` }))]} />
              {rd && <Select<number> size="sm" label="In the development plan" value={rd.dp > rd.today ? rd.dp : 0} onChange={(v) => once(withEdgeRoad(p, k, { today: rd.today, dp: v }))}
                options={[{ value: 0, label: 'Same width' }, ...widths.filter((w) => w > rd.today).map((w) => ({ value: w, label: `${w} m` }))]} />}
              {pr && pr.foot > 0 && <small>{nf(pr.carriage, 1)} m carriageway, {nf(pr.foot, 1)} m footpaths</small>}
            </>)}
          </div>}
        </>;
      })}
      <button type="button" ref={ref('sl')} class={`hh hh-ring slope${dragging === 'sl' ? ' on' : ''}`} aria-label={L.slope ? `Falls ${nf(L.slope)}% toward the ${DIRS[Math.round(L.dir / 45) % 8]}: drag it` : 'Level: drag to give it a slope'}
        data-tip={dragging ? undefined : L.slope ? `Falls ${nf(L.slope)}% ${DIRS[Math.round(L.dir / 45) % 8]}` : 'Level · drag for a slope'}
        onPointerDown={down('sl', 0)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}><Icon n="level" size={12} stroke={2.2} /></button>
      <div class="hbar" ref={bar} role="toolbar" aria-label="The plot: edit">
        <b class="hlabel">Plot</b><span class="hmeta">{nf(e.r.area)} m² · {sqft(e.r.area)}</span>
        {noRoad && <span class="hwarn" data-tip="Give one edge a road: click its + road chip"><Icon n="warn" size={14} />No road</span>}
        <span class="hsep" />
        <div class="hpopwrap" data-pop="size">
          <button type="button" aria-expanded={open === 'size'} data-tip="Its frontage and depth: a rectangle" onClick={() => setOpen(open === 'size' ? null : 'size')}>Size</button>
          {pop('size', <>
            <b>A rectangle</b>
            {p.shape === 'poly' && <small>Sets the plot back to a rectangle, its road along the front.</small>}
            <Row><Num label="Frontage" value={p.width} set={(v) => once({ width: v, shape: 'rect' })} min={10} max={600} unit="m" /><Num label="Depth" value={p.depth} set={(v) => once({ depth: v, shape: 'rect' })} min={10} max={600} unit="m" /></Row>
          </>)}
        </div>
        <button type="button" data-tip="Click its corners on the map, Enter to finish" onClick={() => setTool({ k: 'plot' })}>Redraw</button>
        <button type="button" data-tip="Find it by its survey number (in the panel)" onClick={() => openWay('survey')}>Survey no.</button>
        <button type="button" data-tip="A KML, GeoJSON, DXF or coordinates (in the panel)" onClick={() => openWay('import')}>Import</button>
        <span class="hsep" />
        <div class="hpopwrap" data-pop="levels">
          <button type="button" aria-expanded={open === 'levels'} data-tip="Its level over the road, its slope, the terrain" onClick={() => setOpen(open === 'levels' ? null : 'levels')}><Icon n="level" size={15} />Levels</button>
          {pop('levels', <>
            <b>Levels</b>
            <Row>
              <Num label="Over the road" value={L.plot} set={(v) => setLv({ plot: v, terrain: false })} min={-10} max={30} step={0.1} unit="m" />
              <Num label="Slope" value={L.slope} set={(v) => setLv({ slope: v, terrain: false })} min={0} max={60} step={0.5} unit="%" />
            </Row>
            {L.slope > 0 && <Select<number> size="sm" label="Falls toward" value={L.dir} onChange={(v) => setLv({ dir: v, terrain: false })} options={DIRS.map((d, i) => ({ value: i * 45, label: cap(d) }))} />}
            {p.at
              ? <>
                <small>{L.terrain ? `Off ${L.src === 'open' ? 'open elevation data (90 m)' : 'the city’s terrain'}${L.asl !== undefined ? `, ${nf(L.asl)} m over sea level` : ''}. A contour survey beats it.` : 'Set by hand.'}</small>
                {noTerrain || L.src === 'open'
                  ? <><Btn icon="level" disabled={reading} onClick={() => void read(true)}>{reading ? 'Reading…' : L.src === 'open' ? 'Read it again' : 'Use open elevation data'}</Btn><small>This sends the plot’s location to Open-Meteo (free, Copernicus 90 m data).</small></>
                  : <Btn icon="level" disabled={reading} onClick={() => void read(false)}>{reading ? 'Reading…' : L.terrain ? 'Read it again' : 'Read the terrain'}</Btn>}
              </>
              : <small>Find or import the plot to read its slope off the terrain.</small>}
            {L.plot < PLINTH_MIN && <Note tone="warn">The plinth must stand at least {PLINTH_MIN} m over the road: {L.plot < 0 ? 'the plot is below it, so plan the drainage and fill' : `about ${nf(PLINTH_MIN - L.plot, 2)} m of fill or a raised plinth`}.</Note>}
            {L.slope >= 15 && <Note tone="warn">A steep plot ({nf(L.slope)}%): expect retaining walls and stepped floors, and a hill-slope check by the authority.</Note>}
          </>)}
        </div>
        {p.at && <button type="button" aria-pressed={northFree} data-tip={northFree ? 'North can be turned on the compass: click to lock it to the location again' : 'North is set from the plot’s location: click to turn it by hand'} onClick={() => setNorthFree(!northFree)}><Icon n={northFree ? 'north' : 'lock'} size={14} />{northFree ? 'North free' : 'North locked'}</button>}
        <span class="hsep" />
        <Select<ProProject['city']> size="sm" quiet aria-label="Planning authority" value={p.city} onChange={(v) => once({ city: v })} options={CITIES.map((c) => ({ value: c.value, label: c.label }))} />
        {picked?.k === 'plot' && <button type="button" aria-label="Deselect" data-tip="Deselect (Esc)" onClick={() => pick(null)}><Icon n="x" size={14} /></button>}
      </div>
    </div>
  );
}
