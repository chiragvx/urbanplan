// "Add a building": the templates first, each a tile drawn from its own form (a side silhouette with its floors and
// its plan in the corner), grouped as towers, homes, public buildings and sculpted ones; the engine's plain shapes
// (slab, tower, L, U, courtyard, drawn) folded under "Basic". Click a tile, then the map: it lands facing the front
// road, sized to the room the buildable line leaves there, and is picked at once.
import { useState } from 'preact/hooks';
import { TEMPLATES, type FormTemplate, type Pt } from './form';
import { BUILDING_SHAPES, type Tool } from './edit';
import { Thumb } from './silhouette';
import { Icon } from './ui';

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

export function Gallery({ tool, setTool: set }: { tool: Tool; setTool: (t: Tool) => void }) {
  // (on a phone the panel scrolls over the map: picking a tile brings the map back into view, to click on)
  const setTool = (t: Tool) => { set(t); if (t.k !== 'select' && matchMedia('(max-width: 900px)').matches) scrollTo({ top: 0, behavior: 'smooth' }); };
  const basicOn = tool.k === 'building';
  const [basic, setBasic] = useState(basicOn || !TEMPLATES.length);
  const on = (id: string) => tool.k === 'template' && tool.id === id;
  return (
    <div class="gallery">
      {GROUPS.map((g) => { const ts = TEMPLATES.filter((t) => t.group === g.id); return ts.length > 0 && (
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
      <button type="button" class="subfold" aria-expanded={basic || basicOn} onClick={() => setBasic(!(basic || basicOn))}><Icon n="chevron" size={14} />Basic</button>
      {(basic || basicOn) && <div class="toolgrid" role="group" aria-label="Basic shapes">
        {BUILDING_SHAPES.map((s) => { const t: Tool = { k: 'building', shape: s.shape }, pressed = tool.k === 'building' && tool.shape === s.shape; return <button type="button" aria-pressed={pressed} onClick={() => setTool(pressed ? { k: 'select' } : t)}><Icon n={s.icon} size={16} /><span>{s.label}</span></button>; })}
      </div>}
    </div>
  );
}
