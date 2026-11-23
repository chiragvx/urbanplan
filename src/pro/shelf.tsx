// The tool shelf on the view's left edge: what's drawn on the map is picked here, not in the panel.
// Select (V); Building ▸ (the template gallery and the basic shapes); Grounds ▸ (gardens, parking, roads, gates,
// walls…); Site ▸ (what's there already: trees, structures, power lines, water, no-build zones); Plot (draw its
// outline again); Measure (M). A ▸ opens a flyout beside the shelf; picking a tool closes it. Each has its word under
// its icon: the tools are the main way in (docs/plans/pro-ia-rethink.md §2.3).
import { useEffect, useRef, useState } from 'preact/hooks';
import { ELEMENT_TOOLS, SELECT, type Tool } from './edit';
import { FEATURES } from './siteObjects';
import { Gallery } from './gallery';
import { Icon } from './ui';

type Fly = 'building' | 'grounds' | 'site' | 'generate' | null;
const same = (a: Tool, b: Tool) => JSON.stringify(a) === JSON.stringify(b);

function Grid({ items, tool, setTool, label }: { items: { t: Tool; label: string; icon: string }[]; tool: Tool; setTool: (t: Tool) => void; label: string }) {
  return (
    <div class="toolgrid" role="group" aria-label={label}>
      {items.map((x) => <button type="button" aria-pressed={same(x.t, tool)} onClick={() => setTool(same(x.t, tool) ? SELECT : x.t)}><Icon n={x.icon} size={16} /><span>{x.label}</span></button>)}
    </div>
  );
}

/** `hint`: what the tool in hand wants next (click the corners…, Enter to finish), beside the shelf */
/** `generate`: the Generate popover's body (./generate.tsx), given a way to close it */
/** `outline`: the outline's toggle, at the toolbar's end */
export function Shelf({ tool, setTool: set, hint, generate, outline }: { tool: Tool; setTool: (t: Tool) => void; hint?: import('preact').ComponentChildren; generate?: (close: () => void) => import('preact').ComponentChildren; outline?: { on: boolean; toggle: () => void } }) {
  const [fly, setFly] = useState<Fly>(null);
  useEffect(() => { const on = () => setFly('generate'); addEventListener('urbanplan:generate', on); return () => removeEventListener('urbanplan:generate', on); }, []);
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
    fly === f || (f === 'building' && (tool.k === 'building' || tool.k === 'template')) || (f === 'grounds' && tool.k === 'element') || (f === 'site' && tool.k === 'feature');
  const btn = (f: Exclude<Fly, 'generate' | null>, icon: string, label: string, word: string) => (
    <button type="button" class={on(f) ? 'on' : ''} aria-haspopup="true" aria-expanded={fly === f} aria-label={label} data-tip={fly ? undefined : label} onClick={() => setFly(fly === f ? null : f)}>
      <Icon n={icon} size={18} /><span aria-hidden="true">{word}</span><i class="more" aria-hidden="true" />
    </button>
  );
  return (
    <div class="shelf" ref={root}>
      <div class="shelf-bar" role="toolbar" aria-label="Draw on the map" aria-orientation="vertical">
        <button type="button" class={tool.k === 'select' ? 'on' : ''} aria-pressed={tool.k === 'select'} aria-label="Select and move" aria-keyshortcuts="V" data-tip="Select and move (V)" onClick={() => setTool(SELECT)}><Icon n="cursor" size={18} /><span aria-hidden="true">Select</span></button>
        {btn('building', 'tower', 'Add a building', 'Building')}
        {btn('grounds', 'leaf', 'Add to the grounds: gardens, parking, roads, gates, walls', 'Grounds')}
        {btn('site', 'tree', 'What’s on the site: trees, structures, power lines, water, no-build zones', 'Site')}
        <button type="button" class={tool.k === 'plot' ? 'on' : ''} aria-pressed={tool.k === 'plot'} aria-label="Draw the plot again" data-tip="Draw the plot’s outline again" onClick={() => setTool(tool.k === 'plot' ? SELECT : { k: 'plot' })}><Icon n="plan" size={18} /><span aria-hidden="true">Plot</span></button>
        <button type="button" class={tool.k === 'measure' ? 'on' : ''} aria-pressed={tool.k === 'measure'} aria-label="Measure" aria-keyshortcuts="M" data-tip="Measure (M)" onClick={() => setTool(tool.k === 'measure' ? SELECT : { k: 'measure' })}><Icon n="ruler" size={18} /><span aria-hidden="true">Measure</span></button>
        {generate && <><i class="shelf-sep" aria-hidden="true" /><button type="button" class={`gen-b${fly === 'generate' ? ' on' : ''}`} aria-haspopup="dialog" aria-expanded={fly === 'generate'} aria-label="Generate: lay out options from a brief" aria-keyshortcuts="G" data-tip={fly ? undefined : 'Generate options from a brief (G)'} onClick={() => setFly(fly === 'generate' ? null : 'generate')}><Icon n="spark" size={18} /><span aria-hidden="true">Generate</span></button></>}
        {outline && <><i class="shelf-sep" aria-hidden="true" /><button type="button" class={outline.on ? 'on' : ''} aria-pressed={outline.on} aria-label="The outline: what's in the project" aria-keyshortcuts="O" data-tip="The outline: what's in the project (O)" onClick={outline.toggle}><Icon n="list" size={18} /><span aria-hidden="true">Outline</span></button></>}
      </div>
      {fly && (
        <div class={`flyout${fly === 'generate' ? ' wide' : ''}`} role="dialog" aria-label={fly === 'generate' ? 'Generate' : fly === 'building' ? 'Add a building' : fly === 'grounds' ? 'Add to the grounds' : 'What’s on the site'}>
          {fly === 'generate' && generate && <><h3>Generate</h3><p>Lay a scheme out from a brief. Each one is a new option: what you have stays in the option menu.</p>{generate(() => setFly(null))}</>}
          {fly === 'building' && <><h3>Add a building</h3><p>Pick one, then click the map.</p><Gallery tool={tool} setTool={setTool} /></>}
          {fly === 'grounds' && <><h3>Add to the grounds</h3><p>Areas: drag them out, or click their corners. Lines: click along, Enter to finish. Type a length while drawing.</p>
            <Grid label="On the grounds" tool={tool} setTool={setTool} items={ELEMENT_TOOLS.map((s) => ({ t: { k: 'element', kind: s.kind } as Tool, label: s.label, icon: s.icon }))} /></>}
          {fly === 'site' && <><h3>What’s on the site</h3><p>What to build round: each keeps its clearance clear.</p>
            <Grid label="On the site" tool={tool} setTool={setTool} items={FEATURES.map((f) => ({ t: { k: 'feature', kind: f.kind } as Tool, label: f.label, icon: f.icon }))} /></>}
        </div>
      )}
      {!fly && hint}
    </div>
  );
}
