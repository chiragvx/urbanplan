// The outline: what's in the project as a list beside the shelf, like a layers panel (docs/plans/pro-global-ux.md
// §2.3). The plot and its roads; the buildings, lettered as they're drawn; what's on the grounds; what was on the
// site already. A click picks, a double-click frames it; the eye hides it in the view (not from the numbers), the
// lock stops it being picked there; buildings drag up and down to reorder (which changes their letters); a dot marks
// anything with a failing check. Hidden and locked are this session's view of the project, not saved in it.
import { useState } from 'preact/hooks';
import type { Evaluated } from './evaluate';
import type { Picked } from './edit';
import { ELEMENT_TOOLS } from './edit';
import { outline, type ProProject } from './project';
import { featureOf } from './siteObjects';
import type { Check } from './scrutiny';
import { buildingName, checkBuilding } from './viewer';
import { ELEMENTS } from '../doc/site';
import { Icon, nf } from './ui';

export interface OutlineProps {
  p: ProProject; e: Evaluated; checks: Check[];
  picked: Picked; pick: (x: Picked) => void;
  /** frame what's picked: a building by its id, anything else by its outline (x, z, …) */
  show: (id: string) => void; frame: (ring: number[]) => void;
  hidden: Set<string>; locked: Set<string>; toggle: (which: 'hidden' | 'locked', id: string) => void;
  /** move a building from one place in the list to another; null when it can't be changed */
  reorder: ((from: number, to: number) => void) | null;
  /** open comments on each thing, by its id ('plot' for the plot) */
  notes?: Record<string, number>;
  close: () => void;
}

export function Outline({ p, e, checks, picked, pick, show, frame, hidden, locked, toggle, reorder, notes, close }: OutlineProps) {
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const roads = outline(p).roads.map((r, k) => ({ r, k })).filter((x) => x.r && x.r.today > 0);
  const els = e.d.site.elements ?? [];
  const fs = p.features ?? [];
  const isOn = (k: string, id?: string) => picked?.k === k && (id === undefined || ('id' in picked && picked.id === id));
  const failing = (i: number) => checks.some((c) => c.status === 'fail' && checkBuilding(c.key) === i) || !!e.d.buildings[i].clash || !!e.d.buildings[i].overHeight;
  const plotFails = checks.some((c) => c.status === 'fail' && checkBuilding(c.key) === null);
  const elName = (kind: string) => ELEMENT_TOOLS.find((x) => x.kind === kind)?.label ?? ELEMENTS.find((x) => x.value === kind)?.label ?? 'On the grounds';
  const Eye = ({ id, label }: { id: string; label: string }) => (
    <button type="button" class="ol-t" aria-pressed={hidden.has(id)} aria-label={`${hidden.has(id) ? 'Show' : 'Hide'} ${label} in the view`} data-tip={hidden.has(id) ? 'Hidden in the view: show it' : 'Hide it in the view'} onClick={(ev) => { ev.stopPropagation(); toggle('hidden', id); }}>
      <Icon n={hidden.has(id) ? 'eyeoff' : 'eye'} size={14} />
    </button>
  );
  const Lock = ({ id, label }: { id: string; label: string }) => (
    <button type="button" class="ol-t" aria-pressed={locked.has(id)} aria-label={`${locked.has(id) ? 'Unlock' : 'Lock'} ${label}`} data-tip={locked.has(id) ? 'Locked: it can’t be picked in the view' : 'Lock it: not picked in the view'} onClick={(ev) => { ev.stopPropagation(); toggle('locked', id); }}>
      <Icon n={locked.has(id) ? 'lock' : 'unlock'} size={14} />
    </button>
  );
  const Dots = ({ bad, id }: { bad?: boolean; id: string }) => <>
    {bad && <i class="ol-dot bad" title="A check fails" />}
    {notes?.[id] ? <i class="ol-note" title={`${notes[id]} open comment${notes[id] === 1 ? '' : 's'}`}><Icon n="chat" size={11} />{notes[id]}</i> : null}
  </>;
  const ringOfEl = (x: { ring?: number[]; quads?: number[][] }) => x.ring ?? x.quads?.flat() ?? [];
  return (
    <aside class="outline" aria-label="Outline">
      <header><b>Outline</b><button type="button" class="ol-x" aria-label="Close the outline" data-tip="Close (O)" onClick={close}><Icon n="x" size={14} /></button></header>
      <div class="ol-b">
        <ul role="tree" aria-label="What's in the project">
          <li role="treeitem" aria-selected={isOn('plot')} class={`ol-i${isOn('plot') ? ' on' : ''}`} onClick={() => pick({ k: 'plot' })} onDblClick={() => frame(outline(p).ring)}>
            <Icon n="plan" size={15} /><span>Plot<small>{nf(e.r.area)} m²</small></span><Dots bad={plotFails} id="plot" />
          </li>
          {roads.map(({ r, k }) => (
            <li role="treeitem" class="ol-i sub" onClick={() => pick({ k: 'plot' })} onDblClick={() => frame(outline(p).ring)}>
              <Icon n="street" size={14} /><span>{k === 0 ? 'Front road' : `Road on edge ${k + 1}`}<small>{nf(r!.today)} m{r!.dp > r!.today ? ` → ${nf(r!.dp)} m` : ''}</small></span>
            </li>
          ))}
        </ul>
        <h4>Buildings <small>{e.d.buildings.length}</small></h4>
        {!e.d.buildings.length && <p class="ol-none">None yet: add one from the shelf.</p>}
        <ul role="tree" aria-label="Buildings">{e.d.buildings.map((b, i) => {
          const id = b.b.id, name = buildingName(p, e, i), lt = String.fromCharCode(65 + i);
          return (
            <li role="treeitem" aria-selected={isOn('building', id)} draggable={!!reorder}
              class={`ol-i${isOn('building', id) ? ' on' : ''}${hidden.has(id) ? ' off' : ''}${drag?.over === i && drag.from !== i ? ' drop' : ''}`}
              onClick={() => { if (!locked.has(id)) pick({ k: 'building', id }); }} onDblClick={() => show(id)}
              onDragStart={(ev) => { ev.dataTransfer?.setData('text/plain', String(i)); setDrag({ from: i, over: i }); }}
              onDragOver={(ev) => { if (!drag) return; ev.preventDefault(); if (drag.over !== i) setDrag({ ...drag, over: i }); }}
              onDrop={(ev) => { ev.preventDefault(); if (drag && reorder && drag.from !== i) reorder(drag.from, i); setDrag(null); }}
              onDragEnd={() => setDrag(null)}
              onKeyDown={(ev) => { if (!reorder || !ev.altKey) return; const to = ev.key === 'ArrowUp' ? i - 1 : ev.key === 'ArrowDown' ? i + 1 : -1; if (to >= 0 && to < e.d.buildings.length) { ev.preventDefault(); reorder(i, to); } }}
              tabIndex={0}>
              <b class="ol-l">{lt}</b><span>{name}<small>{b.floors} floors · {nf(b.height, 1)} m</small></span><Dots bad={failing(i)} id={id} />
              <Eye id={id} label={name} /><Lock id={id} label={name} />
            </li>
          );
        })}</ul>
        {els.length > 0 && <>
          <h4>Drawn <small>{els.length}</small></h4>
          <ul role="tree" aria-label="Drawn">{els.map((x) => {
            const label = elName(x.kind);
            return (
              <li role="treeitem" aria-selected={isOn('element', x.id)} class={`ol-i${isOn('element', x.id) ? ' on' : ''}${hidden.has(x.id) ? ' off' : ''}`} onClick={() => { if (!locked.has(x.id)) pick({ k: 'element', id: x.id }); }} onDblClick={() => frame(ringOfEl(x as never))}>
                <Icon n="tree" size={14} /><span>{label}{x.auto ? <small>laid by the plan</small> : null}</span><Dots id={x.id} />
                <Lock id={x.id} label={label} />
              </li>
            );
          })}</ul>
        </>}
        {fs.length > 0 && <>
          <h4>On the site already <small>{fs.length}</small></h4>
          <ul role="tree" aria-label="On the site already">{fs.map((f, i) => {
            const F = featureOf(f.kind), n = fs.slice(0, i).filter((x) => x.kind === f.kind).length + 1, label = `${F.label} ${n}`;
            return (
              <li role="treeitem" aria-selected={isOn('feature', f.id)} class={`ol-i${isOn('feature', f.id) ? ' on' : ''}${hidden.has(f.id) ? ' off' : ''}`} onClick={() => { if (!locked.has(f.id)) pick({ k: 'feature', id: f.id }); }} onDblClick={() => frame((f as { pts?: number[] }).pts ?? [])}>
                <Icon n={F.icon} size={14} /><span>{label}</span><Dots id={f.id} />
                <Eye id={f.id} label={label} /><Lock id={f.id} label={label} />
              </li>
            );
          })}</ul>
        </>}
      </div>
    </aside>
  );
}
