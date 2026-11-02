// The preview bar: a change to 2+ objects waits here with its summary ("12 roads → 12 m · +1.6 km of lane"), its rule
// flags in amber and the ghost on the map. Show zooms to it, Cancel drops it, Apply writes it as one undo step (Enter /
// Esc do the same). Apply is never disabled: rules flag, they don't block.
import { render } from 'preact';
import { pending, apply, cancel } from '../editor/bulk';
import { readOnly } from '../editor/state';
import { ui } from './ctx';
import './bulk.css';

export function PreviewBar() {
  const p = pending.value;
  if (!p) return null;
  const big = p.n > 500;
  return (
    <div class="pv-bar" role="status" aria-live="polite" onPointerDown={(e) => e.stopPropagation()}>
      <div class="pv-text">
        <span class="pv-label">{p.label}</span>
        <span class="pv-sum">{p.summary.join(' · ')}</span>
        {p.flags.map((f) => <span key={f} class="pv-flag" title="Departs from the rules — it will still be applied">{f}</span>)}
      </div>
      <div class="pv-btns">
        <button class="pv-ghost" disabled={!p.box} title="Show the change (zoom to it)" aria-label="Show" onClick={() => { if (p.box) ui.E.zoomTo([p.box[0] - 20, p.box[1] - 20, p.box[2] + 20, p.box[3] + 20]); }}>Show</button>
        <button class="pv-ghost" title="Cancel (Esc)" aria-label="Cancel" onClick={() => cancel(ui.E)}>Cancel</button>
        <button class="pv-apply" disabled={readOnly.value} title="Apply (Enter) — one undo step" aria-label="Apply" onClick={() => apply(ui.E)}>
          {big ? `Apply to ${p.n.toLocaleString('en-IN')}` : 'Apply'}
        </button>
      </div>
    </div>
  );
}

/** Mounted once, the first time a preview opens (in the map stage's UI layer when there is one). */
export function mountPreviewBar() {
  const host = document.getElementById('stage-ui') ?? document.body;
  const el = document.createElement('div');
  el.className = 'pv-host';
  host.appendChild(el);
  render(<PreviewBar />, el);
}
