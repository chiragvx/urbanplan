// The tool shelf on the view's left edge: what's drawn on the map is picked here, not in the panel.
// Select (V); Design ▸ (the form: shapes, footprints drawn like CAD, and "Start from…" the templates; the floors are
// made from the form once it's down); Draw ▸ (everything else drawn on the plot, in
// tabs by category: access, parking, landscape, utilities, and what's there already); Plot (draw its outline again);
// Measure (M). A ▸ opens a flyout beside the shelf; picking a tool closes it. Each has its word under
// its icon: the tools are the main way in (docs/plans/pro-ia-rethink.md §2.3).
import { useEffect, useRef, useState } from 'preact/hooks';
import { ELEMENT_TOOLS, SELECT, type Tool } from './edit';
import { FEATURES } from './siteObjects';
import { Gallery } from './gallery';
import { Icon, Seg } from './ui';

type Fly = 'building' | 'grounds' | null;

/** Draw's tabs: what's built on the plot and what's there already, by what it's for. What's there already (a power
 *  line, a pole, a well, a drain) sits with the utilities it is; the rest of it (trees, structures, no-build zones)
 *  under Existing. */
type Cat = 'access' | 'parking' | 'landscape' | 'utilities' | 'existing';
type Item = { t: Tool; label: string; icon: string };
const el = (kind: Extract<Tool, { k: 'element' }>['kind']): Item => { const s = ELEMENT_TOOLS.find((x) => x.kind === kind)!; return { t: { k: 'element', kind }, label: s.label, icon: s.icon }; };
const ft = (kind: Extract<Tool, { k: 'feature' }>['kind'], label?: string): Item => { const f = FEATURES.find((x) => x.kind === kind)!; return { t: { k: 'feature', kind }, label: label ?? f.label, icon: f.icon }; };
const CATS: { id: Cat; label: string; hint: string; items: Item[] }[] = [
  { id: 'access', label: 'Access', hint: "Lines: click along, Enter to finish; type a length while drawing. A road that ends on the plot's edge joins the road outside. Curves: Alt-drag a point, or double-click it.", items: [el('road'), el('roundabout'), el('gate'), el('wall')] },
  { id: 'parking', label: 'Parking', hint: 'Drag out the area, or click its corners.', items: [el('lot'), el('parking')] },
  { id: 'landscape', label: 'Landscape', hint: 'Drag out the area, or click its corners. Curves: Alt-drag a corner, or double-click it.', items: [el('garden'), el('play'), el('trees')] },
  { id: 'utilities', label: 'Utilities', hint: 'New and existing services. What runs over or under the plot keeps its clearance clear.', items: [el('tank'), ft('power'), ft('pole'), ft('well'), ft('water')] },
  { id: 'existing', label: 'Existing', hint: "What's there already: each keeps its clearance clear.", items: [ft('tree', 'Existing tree'), ft('structure'), ft('nobuild')] },
];
const catOf = (t: Tool): Cat | null => CATS.find((c) => c.items.some((x) => same(x.t, t)))?.id ?? null;
function same(a: Tool, b: Tool) { return JSON.stringify(a) === JSON.stringify(b); }

function Grid({ items, tool, setTool, label }: { items: { t: Tool; label: string; icon: string }[]; tool: Tool; setTool: (t: Tool) => void; label: string }) {
  return (
    <div class="toolgrid" role="group" aria-label={label}>
      {items.map((x) => <button type="button" aria-pressed={same(x.t, tool)} onClick={() => setTool(same(x.t, tool) ? SELECT : x.t)}><Icon n={x.icon} size={16} /><span>{x.label}</span></button>)}
    </div>
  );
}

/** `hint`: what the tool in hand wants next (click the corners…, Enter to finish), beside the shelf */
/** `outline`: the outline's toggle, at the toolbar's end */
export function Shelf({ tool, setTool: set, hint, outline, target }: { tool: Tool; setTool: (t: Tool) => void; hint?: import('preact').ComponentChildren; outline?: { on: boolean; toggle: () => void }; target?: { id: string; name: string } }) {
  const [fly, setFly] = useState<Fly>(null);
  // (the tab: the tool in hand's, else the last one opened)
  const [cat, setCat] = useState<Cat>(() => { try { return (sessionStorage.getItem('urbanplan:pro:drawCat') as Cat) || 'access'; } catch { return 'access'; } });
  const pickCat = (c: Cat) => { setCat(c); try { sessionStorage.setItem('urbanplan:pro:drawCat', c); } catch { /* */ } };
  useEffect(() => { const c = catOf(tool); if (c) setCat(c); }, [JSON.stringify(tool)]);
  const root = useRef<HTMLDivElement>(null);
  const setTool = (t: Tool) => { set(t); setFly(null); };
  // (a click outside, or Escape, closes the flyout)
  useEffect(() => {
    if (!fly) return;
    // (a menu or a toast opened from inside the popover isn't a click outside it)
    const down = (ev: PointerEvent) => { const t = ev.target as Element; if (!root.current?.contains(t) && !t.closest?.('.menu, .toast, [role=listbox]')) setFly(null); };
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.stopImmediatePropagation(); setFly(null); } };
    document.addEventListener('pointerdown', down, true); addEventListener('keydown', key, true);
    return () => { document.removeEventListener('pointerdown', down, true); removeEventListener('keydown', key, true); };
  }, [fly]);
  const on = (f: Exclude<Fly, null>) =>
    fly === f || (f === 'building' && (tool.k === 'building' || tool.k === 'template' || tool.k === 'mass')) || (f === 'grounds' && (tool.k === 'element' || tool.k === 'feature'));
  const btn = (f: Exclude<Fly, null>, icon: string, label: string, word: string) => (
    <button type="button" class={on(f) ? 'on' : ''} aria-haspopup="true" aria-expanded={fly === f} aria-label={label} data-tip={fly ? undefined : label} onClick={() => setFly(fly === f ? null : f)}>
      <Icon n={icon} size={18} /><span aria-hidden="true">{word}</span><i class="more" aria-hidden="true" />
    </button>
  );
  return (
    <div class="shelf" ref={root}>
      <div class="shelf-bar" role="toolbar" aria-label="Draw on the map" aria-orientation="vertical">
        <button type="button" class={tool.k === 'select' ? 'on' : ''} aria-pressed={tool.k === 'select'} aria-label="Select and move" aria-keyshortcuts="V" data-tip="Select and move (V)" onClick={() => setTool(SELECT)}><Icon n="cursor" size={18} /><span aria-hidden="true">Select</span></button>
        {btn('building', 'cube', 'Design a building: shapes, footprints you draw, templates', 'Design')}
        {btn('grounds', 'pen', 'Draw on the plot: roads, parking, landscape, utilities, and what’s there already', 'Draw')}
        <button type="button" class={tool.k === 'plot' ? 'on' : ''} aria-pressed={tool.k === 'plot'} aria-label="Draw the plot again" data-tip="Draw the plot’s outline again" onClick={() => setTool(tool.k === 'plot' ? SELECT : { k: 'plot' })}><Icon n="plan" size={18} /><span aria-hidden="true">Plot</span></button>
        <button type="button" class={tool.k === 'measure' ? 'on' : ''} aria-pressed={tool.k === 'measure'} aria-label="Measure" aria-keyshortcuts="M" data-tip="Measure (M)" onClick={() => setTool(tool.k === 'measure' ? SELECT : { k: 'measure' })}><Icon n="ruler" size={18} /><span aria-hidden="true">Measure</span></button>
        {outline && <><i class="shelf-sep" aria-hidden="true" /><button type="button" class={outline.on ? 'on' : ''} aria-pressed={outline.on} aria-label="The outline: what's in the project" aria-keyshortcuts="O" data-tip="The outline: what's in the project (O)" onClick={outline.toggle}><Icon n="list" size={18} /><span aria-hidden="true">Outline</span></button></>}
      </div>
      {fly && (
        <div class="flyout" role="dialog" aria-label={fly === 'building' ? 'Design a building' : 'Draw on the plot'}>
          {fly === 'building' && <><h3>Design</h3><p>Make the form: a shape or a footprint you draw lands as a mass to sculpt. Then make its floors.</p><Gallery tool={tool} setTool={setTool} target={target} /></>}
          {fly === 'grounds' && (() => { const C = CATS.find((c) => c.id === cat) ?? CATS[0]; return <><h3>Draw</h3>
            <div class="draw-tabs"><Seg<Cat> small value={C.id} set={pickCat} ariaLabel="Category" options={CATS.map((c) => ({ value: c.id, label: c.label }))} /></div>
            <p>{C.hint}</p>
            <Grid label={C.label} tool={tool} setTool={setTool} items={C.items} /></>; })()}
        </div>
      )}
      {!fly && hint}
    </div>
  );
}
