// The road tools' options, as the tool panel's rows: the modes, then the values the active mode uses (radius,
// offset, side, height, distribution) with − / + steps, and Apply / Back.
import { buildAsset, mtTick, penClass, tool } from '../editor/state';
import { CLASS_LABEL, ROAD_CLASSES } from '../doc/types';
import { MT_MODES } from '../editor/multitool';
import { ui } from './ctx';
import { TpHead, TpRow } from './RoadToolbar';

const NEEDS_APPLY = ['line', 'circle', 'slope', 'loop', 'connect', 'parallel', 'curve', 'flyover'];
const GROUPS: { label: string; modes: string[] }[] = [
  { label: 'Junctions', modes: ['addNode', 'removeNode', 'union', 'splitNode', 'intersect'] },
  { label: 'Arrange', modes: ['lock', 'invert', 'line', 'circle', 'slope'] },
  { label: 'Build', modes: ['loop', 'connect', 'parallel', 'curve', 'flyover'] },
];

export function MultiToolbar() {
  void mtTick.value;
  if (tool.value !== 'multi') return null;
  const T = ui.E.mt, m = T.mode;
  const step = (name: string) => { T.key(name); };
  const val = (label: string, v: string, dec: string, inc: string, title: string) => (
    <TpRow label={label} title={title}>
      <button class="sq" aria-label={`Less ${label}`} onClick={() => step(dec)}>−</button>
      <span class="tp-value">{v}</span>
      <button class="sq" aria-label={`More ${label}`} onClick={() => step(inc)}>+</button>
    </TpRow>
  );
  const cur = MT_MODES.find((x) => x.m === m);
  return (
    <div class="card tp" onPointerDown={(e) => e.stopPropagation()}>
      <TpHead kind="Road tools" name={cur?.label} onClose={() => ui.E.setTool('select')} />
      {GROUPS.map((g) => (
        <TpRow key={g.label} label={g.label} stack>
          {MT_MODES.filter((x) => g.modes.includes(x.m)).map((x) => (
            <button key={x.m} class={`sq txt ${m === x.m ? 'on' : ''}`} aria-pressed={m === x.m} title={`${x.label} (${x.key}) — ${x.hint}`} onClick={() => T.setMode(x.m)}>{x.label}</button>
          ))}
        </TpRow>
      ))}
      {(m === 'loop' || m === 'connect') && val(m === 'connect' ? 'Radius 1' : 'Radius', `${Math.round(T.R * 10) / 10} m`, '-', '=', '= / − (Shift ×10, Alt ×0.1)')}
      {m === 'connect' && val('Radius 2', `${Math.round(T.R2 * 10) / 10} m`, '[', ']', '[ / ]')}
      {m === 'circle' && T.circle && val('Radius', `${Math.round(T.circle.R)} m`, '-', '=', '= / − or drag the ring')}
      {m === 'circle' && (
        <TpRow label="Spacing">
          {([['keep', 'As placed', 'R'], ['even', 'Even', 'E'], ['between', 'Between crossings', 'B'], ['inter', 'Crossings even', 'I']] as const).map(([k, l, key]) => (
            <button key={k} class={`sq txt ${T.dist === k ? 'on' : ''}`} title={key} onClick={() => step(key)}>{l}</button>
          ))}
        </TpRow>
      )}
      {m === 'parallel' && val('Offset', `${T.side > 0 ? 'left' : 'right'} ${T.offset || 'auto'} m`, '-', '=', '= / − · Z other side')}
      {m === 'parallel' && val('Elevation', `${T.lift} m`, 'PageDown', 'PageUp', 'PgUp / PgDn')}
      {m === 'curve' && val('Roundness', T.tension.toFixed(2), '-', '=', '= / −')}
      {m === 'flyover' && <TpRow label="Lanes"><button class="sq txt" title="Z" onClick={() => step('Z')}>{{ '2': '2 lanes', '4': '4 lanes', '2o': '2 lanes · one way' }[T.flyLanes]}</button></TpRow>}
      {m === 'flyover' && val('Deck', `${T.deck} m`, '-', '=', '= / − (clearance 5.5 m + deck)')}
      {(m === 'loop' || m === 'connect' || m === 'parallel' || m === 'line') && (
        <TpRow label="Variant"><button class="sq txt" title="Z" onClick={() => step('Z')}>{m === 'parallel' ? 'Other side' : m === 'line' ? (T.lineFromSection ? 'Along the first road' : 'First → last') : 'Next shape'}</button></TpRow>
      )}
      {(m === 'loop' || m === 'connect' || m === 'curve') && (
        <TpRow label="Builds" title="The road type built (the same as the road tool's)">
          <select class="select" value={penClass.value} onChange={(e) => { penClass.value = (e.currentTarget as HTMLSelectElement).value; buildAsset.value = ''; }}>
            {ROAD_CLASSES.map((c) => <option key={c} value={c}>{CLASS_LABEL[c]}</option>)}
          </select>
        </TpRow>
      )}
      <p class="tp-hint">{cur?.hint}</p>
      <div class="tp-actions">
        <button onClick={() => T.back()} title="Esc / right-click">Back</button>
        {NEEDS_APPLY.includes(m) && <button class="primary" onClick={() => T.apply()}>Apply <kbd>Enter</kbd></button>}
      </div>
    </div>
  );
}
