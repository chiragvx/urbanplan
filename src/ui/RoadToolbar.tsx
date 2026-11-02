// The tool panel's parts (labelled rows, the head) and the bulldozer's panel. The draw tools' options (mode, type,
// height, ground, snapping) moved to the drawing strip (DrawStrip.tsx).
import { buildOpen, tool } from '../editor/state';
import { ui } from './ctx';
import { Icon } from './components';
import type { ComponentChildren } from 'preact';

/** One labelled row of the tool panel (`stack`: the label above a wrapping group of buttons). */
export function TpRow(p: { label: ComponentChildren; title?: string; stack?: boolean; children: ComponentChildren }) {
  return <div class={`tp-row ${p.stack ? 'stack' : ''}`} title={p.title}><span class="tp-label">{p.label}</span><div class="tp-ctl">{p.children}</div></div>;
}

/** The tool panel's head: what kind of tool, what it builds, and a close (Esc). */
export function TpHead(p: { kind: string; name?: ComponentChildren; onClose?: () => void }) {
  return (
    <header class="tp-head">
      <span class="tp-kind">{p.kind}</span>
      {p.name && <b class="tp-name">{p.name}</b>}
      <span class="spacer" />
      <button class="icon-btn" aria-label="Done (Esc)" title="Done (Esc)" onClick={p.onClose ?? (() => { buildOpen.value = false; ui.E.setTool('select'); })}><Icon.close size={14} /></button>
    </header>
  );
}

/** The bulldozer's panel (the draw tools' options are in the drawing strip, DrawStrip.tsx; the how-to is at the cursor). */
export function RoadToolbar() {
  if (tool.value !== 'bulldoze') return null;
  return <div class="card tp" onPointerDown={(e) => e.stopPropagation()}><TpHead kind="Bulldozer" onClose={() => ui.E.setTool('select')} /></div>;
}
