// Design (docs/plans/pro-design-freedom.md §3.6, §8): the form first, the main path (make a mass, sculpt it, then
// make its floors): shapes clicked down and footprints drawn like CAD (rectangle, polygon, circle), each landing as
// a form in the project's use (./masses.ts). "Start from…" opens the templates, each a tile drawn from its own form (a side silhouette with its floors and
// its plan in the corner), grouped as towers, homes, public buildings and sculpted ones. Click one, then the map: a
// template lands facing the front road, sized to the room the buildable line leaves there, as parts and uses that
// can all be changed, and is picked at once.
import { useState } from 'preact/hooks';
import { TEMPLATES, type FormTemplate, type Pt } from './form';
import type { Tool } from './edit';
import { MASS_DRAW, MASS_SHAPES } from './masses';
import { OP_LABEL, OP_TIP, OPS } from './parts';
import type { PartOp } from './form';
import { Seg } from './ui';
import { Thumb } from './silhouette';
import { Icon } from './ui';

const KEY = 'urbanplan:pro:startFrom';
const GROUPS: { id: FormTemplate['group']; label: string }[] = [
  { id: 'tower', label: 'Towers' }, { id: 'homes', label: 'Homes' }, { id: 'public', label: 'Public' }, { id: 'sculpted', label: 'Sculpted' },
];

// (each template drawn once, at the origin facing +x, at its own size)
const drawn = new Map<string, { form: import('./form').Form; at: Pt }[]>();
function formsOf(t: FormTemplate) {
  let d = drawn.get(t.id);
  if (!d) {
    try { d = t.make([0, 0], [1, 0]).map((m) => ({ form: m.form, at: [m.offset?.[0] ?? 0, 0] as Pt })); } catch { d = []; }
    drawn.set(t.id, d);
  }
  return d;
}

export function Gallery({ tool, setTool: set, target }: { tool: Tool; setTool: (t: Tool) => void; target?: { id: string; name: string } }) {
  // (a shaped building picked: what's made next can be a new building, or a part of that one, by one of the four
  // booleans: add, cut, intersect, exclude)
  const [into, setInto] = useState<PartOp | 'new'>(() => (tool.k === 'mass' && tool.into ? tool.into.op : 'new'));
  const mode: PartOp | 'new' = target ? into : 'new';
  // (on a phone, picking a tile lowers the sheet to a peek, so the map is there to click on: in main.tsx)
  const setTool = set;
  const tplOn = tool.k === 'template';
  const [open, setOpenS] = useState(() => { try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; } });
  const setOpen = (v: boolean) => { setOpenS(v); try { sessionStorage.setItem(KEY, v ? '1' : '0'); } catch { /* */ } };
  const shown = open || tplOn;
  const on = (id: string) => tool.k === 'template' && tool.id === id;
  return (
    <div class="gallery">
      {target && <div class="design-into" role="group" aria-label="What it makes">
        <span>Picked: <b>{target.name}</b>. What you make next is</span>
        <Seg<PartOp | 'new'> small value={mode} set={setInto} ariaLabel="What it makes" options={[{ value: 'new', label: 'New', title: 'A new building of its own' }, ...OPS.map((o) => ({ value: o, label: OP_LABEL[o], title: OP_TIP[o].replace('the floors it spans', `${target.name}`) }))]} />
      </div>}
      {([['Shapes', MASS_SHAPES.filter((s) => mode === 'new' || s.shape !== 'court')], ['Draw a footprint', MASS_DRAW]] as const).map(([label, list]) => <div class="tgrp" role="group" aria-label={label}>
        <h4>{label}</h4>
        <div class="toolgrid">
          {list.map((s) => { const t: Tool = { k: 'mass', shape: s.shape, ...(mode !== 'new' && target ? { into: { id: target.id, op: mode } } : {}) }, pressed = tool.k === 'mass' && tool.shape === s.shape && (tool.into?.op ?? 'new') === mode; return <button type="button" aria-pressed={pressed} data-tip={s.hint} onClick={() => setTool(pressed ? { k: 'select' } : t)}><Icon n={s.icon} size={16} /><span>{s.label}</span></button>; })}
        </div>
      </div>)}
      <small class="start-note">Then sculpt it on the view: its rings for width, lean and twist; parts that add, cut or keep. And make its floors: how many, how tall, what each range is for.</small>
      {mode === 'new' && TEMPLATES.length > 0 && <button type="button" class="subfold start-from" aria-expanded={shown} onClick={() => setOpen(!shown)}><Icon n="chevron" size={14} />Start from…<small>{TEMPLATES.length} templates</small></button>}
      {mode === 'new' && shown && GROUPS.map((g) => { const ts = TEMPLATES.filter((t) => t.group === g.id); return ts.length > 0 && (
        <div class="tgrp" role="group" aria-label={g.label}>
          <h4>{g.label}</h4>
          <div class="tiles">{ts.map((t) => (
            <button type="button" class="tile" aria-pressed={on(t.id)} data-tip={t.blurb} onClick={() => setTool(on(t.id) ? { k: 'select' } : { k: 'template', id: t.id })}>
              <Thumb forms={formsOf(t)} size={60} />
              <span>{t.name}</span>
            </button>
          ))}</div>
        </div>
      ); })}
      {mode === 'new' && shown && <small class="start-note">A template lands as parts and floors of uses, all yours to change; a tower or a sculpted one takes the project's use.</small>}
    </div>
  );
}
