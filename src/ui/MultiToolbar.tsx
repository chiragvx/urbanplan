// Options bar for the road tools (floating, top centre, like the road tool's): the modes, the values the active
// mode uses (radius, offset, side, height, distribution) with − / + steps, and Apply / Cancel.
import { buildAsset, mtTick, penClass, tool } from '../editor/state';
import { CLASS_LABEL, ROAD_CLASSES } from '../doc/types';
import { MT_MODES } from '../editor/multitool';
import { ui } from './ctx';

const NEEDS_APPLY = ['line', 'circle', 'slope', 'loop', 'connect', 'parallel', 'curve'];

export function MultiToolbar() {
  void mtTick.value;
  if (tool.value !== 'multi') return null;
  const T = ui.E.mt, m = T.mode;
  const step = (name: string) => { T.key(name); };
  const val = (label: string, v: string, dec: string, inc: string, title: string) => (
    <div class="rb-group" title={title}>
      <span class="rb-label">{label}</span>
      <button class="icon-btn" onClick={() => step(dec)}>−</button>
      <span class="rb-value">{v}</span>
      <button class="icon-btn" onClick={() => step(inc)}>+</button>
    </div>
  );
  return (
    <div class="roadbar mtbar" onPointerDown={(e) => e.stopPropagation()}>
      <div class="mt-modes">
        {MT_MODES.map((x) => (
          <button key={x.m} class={m === x.m ? 'on' : ''} title={`${x.label} (${x.key}) — ${x.hint}`} onClick={() => T.setMode(x.m)}>{x.label}</button>
        ))}
      </div>
      <div class="mt-opts">
        {(m === 'loop' || m === 'connect') && val(m === 'connect' ? 'Radius 1' : 'Radius', `${Math.round(T.R * 10) / 10} m`, '-', '=', '= / − (Shift ×10, Alt ×0.1)')}
        {m === 'connect' && val('Radius 2', `${Math.round(T.R2 * 10) / 10} m`, '[', ']', '[ / ]')}
        {m === 'circle' && T.circle && val('Radius', `${Math.round(T.circle.R)} m`, '-', '=', '= / − or drag the ring')}
        {m === 'circle' && (
          <div class="rb-group">
            <span class="rb-label">Spacing</span>
            {([['keep', 'As placed', 'R'], ['even', 'Even', 'E'], ['between', 'Between crossings', 'B'], ['inter', 'Crossings even', 'I']] as const).map(([k, l, key]) => (
              <button key={k} class={`small ${T.dist === k ? 'on' : ''}`} title={`${key}`} onClick={() => step(key)}>{l}</button>
            ))}
          </div>
        )}
        {m === 'parallel' && val('Offset', `${T.side > 0 ? 'left' : 'right'} ${T.offset || 'auto'} m`, '-', '=', '= / − · Z other side')}
        {m === 'parallel' && val('Height', `${T.lift} m`, 'PageDown', 'PageUp', 'PgUp / PgDn')}
        {m === 'curve' && val('Roundness', T.tension.toFixed(2), '-', '=', '= / −')}
        {(m === 'loop' || m === 'connect' || m === 'parallel' || m === 'line') && <button class="small" title="Z" onClick={() => step('Z')}>{m === 'parallel' ? 'Other side' : m === 'line' ? (T.lineFromSection ? 'Line: along first road' : 'Line: first → last') : 'Next shape'}</button>}
        {(m === 'loop' || m === 'connect' || m === 'curve') && (
          <div class="rb-group" title="The road type built (the same as the road tool's)">
            <span class="rb-label">Builds</span>
            <select class="select small" value={penClass.value} onChange={(e) => { penClass.value = (e.currentTarget as HTMLSelectElement).value; buildAsset.value = ''; }}>
              {ROAD_CLASSES.map((c) => <option key={c} value={c}>{CLASS_LABEL[c]}</option>)}
            </select>
          </div>
        )}
        {NEEDS_APPLY.includes(m) && <button class="small primary" onClick={() => T.apply()}>Apply (Enter)</button>}
        <button class="small" onClick={() => T.back()} title="Esc / right-click">Back</button>
      </div>
    </div>
  );
}
