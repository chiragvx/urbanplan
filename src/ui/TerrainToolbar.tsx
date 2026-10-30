// The terrain tool's options (Cities: Skylines' landscaping panel), as the tool panel's rows: what to do, brush size
// and strength, the level height (or balanced), shape settings, the view (heights / cut & fill), 3D exaggeration,
// and the volumes moved.
import { docVersion, mode, saveSettings, settings, terrainShow, terrainView, tool } from '../editor/state';
import { TERRAIN_OPS, fmtVol } from '../editor/terraintool';
import { ui } from './ctx';
import { TpHead, TpRow } from './RoadToolbar';

const SIZES = [10, 20, 40, 80, 160, 320];

export function TerrainToolbar() {
  void docVersion.value; // re-render with the volumes after every change
  if (tool.value !== 'terrain') return null;
  const st = settings.value, op = st.terrainOp;
  const T = ui.E.terrain;
  const num = (v: string) => Number(v.replace(',', '.'));
  const cur = TERRAIN_OPS.find((o) => o.op === op);
  return (
    <div class="card tp" onPointerDown={(e) => e.stopPropagation()}>
      <TpHead kind="Terrain" name={cur?.label} onClose={() => ui.E.setTool('select')} />
      <TpRow label="Brushes" stack>
        {TERRAIN_OPS.slice(0, 5).map((o, i) => (
          <button key={o.op} class={`sq txt ${op === o.op ? 'on' : ''}`} aria-pressed={op === o.op} title={`${o.hint} (${i + 1})`} onClick={() => { ui.E.terra.cancel(); saveSettings({ terrainOp: o.op }); }}>{o.label}</button>
        ))}
      </TpRow>
      <TpRow label="Shapes" stack>
        {TERRAIN_OPS.slice(5).map((o, i) => (
          <button key={o.op} class={`sq txt ${op === o.op ? 'on' : ''}`} aria-pressed={op === o.op} title={`${o.hint} (${i + 6})`} onClick={() => { ui.E.terra.cancel(); saveSettings({ terrainOp: o.op }); }}>{o.label}</button>
        ))}
      </TpRow>
      {op !== 'pad' && op !== 'pond' && op !== 'embank' && (
        <>
          <TpRow label="Brush size" title="Brush radius ([ and ])">
            <select class="select" value={String(st.brushRadius)} onChange={(e) => saveSettings({ brushRadius: num((e.currentTarget as HTMLSelectElement).value) })}>
              {[...new Set([...SIZES, st.brushRadius])].sort((a, b) => a - b).map((s) => <option key={s} value={s}>{s} m</option>)}
            </select>
          </TpRow>
          {op !== 'slope' && (
            <TpRow label="Strength">
              <input class="tp-range" type="range" min={5} max={100} value={Math.round(st.brushStrength * 100)} aria-label="Strength" onInput={(e) => saveSettings({ brushStrength: num((e.currentTarget as HTMLInputElement).value) / 100 })} />
              <span class="tp-value">{Math.round(st.brushStrength * 100)} %</span>
            </TpRow>
          )}
        </>
      )}
      {(op === 'level' || op === 'pad' || op === 'slope') && (
        <TpRow label="Height" title="Height to level to (m above sea level) — right-click the ground to pick it">
          {op !== 'slope' && <button class={`sq txt ${st.levelBalanced ? 'on' : ''}`} title="Level to the average ground height inside the brush / outline, so cut and fill balance there (the cheapest earthwork)" onClick={() => saveSettings({ levelBalanced: !st.levelBalanced })}>Balanced</button>}
          <input class="text num tp-num" type="number" step={0.5} placeholder="pick" aria-label="Height (m)" disabled={st.levelBalanced && op !== 'slope'} value={st.levelHeight ?? ''}
            onChange={(e) => { const v = (e.currentTarget as HTMLInputElement).value; saveSettings({ levelHeight: v === '' ? null : num(v), levelBalanced: false }); }} />
          <span class="muted small">m</span>
        </TpRow>
      )}
      {op === 'embank' && (
        <>
          <TpRow label="Top" title="Height above the ground (negative = a cutting)">
            <input class="text num tp-num" type="number" step={0.5} value={st.embankOffset} aria-label="Top (m)" onChange={(e) => saveSettings({ embankOffset: num((e.currentTarget as HTMLInputElement).value) })} /><span class="muted small">m</span>
          </TpRow>
          <TpRow label="Width">
            <input class="text num tp-num" type="number" step={1} min={2} value={st.embankWidth} aria-label="Width (m)" onChange={(e) => saveSettings({ embankWidth: Math.max(2, num((e.currentTarget as HTMLInputElement).value)) })} /><span class="muted small">m</span>
          </TpRow>
        </>
      )}
      {op === 'pond' && (
        <TpRow label="Depth">
          <input class="text num tp-num" type="number" step={0.5} min={0.5} value={st.pondDepth} aria-label="Depth (m)" onChange={(e) => saveSettings({ pondDepth: Math.max(0.5, num((e.currentTarget as HTMLInputElement).value)) })} /><span class="muted small">m</span>
        </TpRow>
      )}
      <TpRow label="Show">
        <button class={`sq txt ${terrainView.value && terrainShow.value === 'height' ? 'on' : ''}`} onClick={() => { terrainView.value = true; terrainShow.value = 'height'; ui.E.overlayDirty = true; }}>Heights</button>
        <button class={`sq txt ${terrainView.value && terrainShow.value === 'cutfill' ? 'on' : ''}`} onClick={() => { terrainView.value = true; terrainShow.value = 'cutfill'; ui.E.overlayDirty = true; }}>Cut & fill</button>
        {mode.value === '3d' && (
          <select class="select small" value={String(st.exaggeration)} title="Vertical exaggeration (buildings and trees are hidden while it's on)" onChange={(e) => { saveSettings({ exaggeration: num((e.currentTarget as HTMLSelectElement).value) }); ui.E.applyExaggeration(); }}>
            {[1, 2, 3, 5].map((k) => <option key={k} value={k}>height ×{k}</option>)}
          </select>
        )}
      </TpRow>
      <TpRow label="Moved" title="Earthworks against the original ground (roads' own cut / fill not included)"><span class="tp-value">cut {fmtVol(T.cut)} · fill {fmtVol(T.fill)}</span></TpRow>
      <p class="tp-hint">{cur?.hint}</p>
    </div>
  );
}
