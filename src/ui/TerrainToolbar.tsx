// Floating options for the terrain tool (Cities: Skylines' landscaping panel): what to do, brush size and strength,
// the level height (or balanced), shape settings, the view (heights / cut & fill), 3D exaggeration, and volumes.
import { docVersion, mode, saveSettings, settings, terrainShow, terrainView, tool } from '../editor/state';
import { TERRAIN_OPS, fmtVol } from '../editor/terraintool';
import { ui } from './ctx';

const SIZES = [10, 20, 40, 80, 160, 320];

export function TerrainToolbar() {
  void docVersion.value; // re-render with the volumes after every change
  if (tool.value !== 'terrain') return null;
  const st = settings.value, op = st.terrainOp;
  const T = ui.E.terrain;
  const num = (v: string) => Number(v.replace(',', '.'));
  return (
    <div class="roadbar terrainbar" onPointerDown={(e) => e.stopPropagation()}>
      <div class="seg rb-modes">
        {TERRAIN_OPS.map((o, i) => (
          <button key={o.op} class={op === o.op ? 'on' : ''} title={`${o.hint} (${i + 1})`} onClick={() => { ui.E.terra.cancel(); saveSettings({ terrainOp: o.op }); }}><span>{o.label}</span></button>
        ))}
      </div>
      {op !== 'pad' && op !== 'pond' && op !== 'embank' && (
        <div class="rb-group">
          <span class="rb-label">Brush</span>
          <select class="select small" value={String(st.brushRadius)} title="Brush radius ([ and ])" onChange={(e) => saveSettings({ brushRadius: num((e.currentTarget as HTMLSelectElement).value) })}>
            {[...new Set([...SIZES, st.brushRadius])].sort((a, b) => a - b).map((s) => <option key={s} value={s}>{s} m</option>)}
          </select>
          {op !== 'slope' && <input class="range" type="range" min={5} max={100} value={Math.round(st.brushStrength * 100)} title={`Strength ${Math.round(st.brushStrength * 100)} %`} onInput={(e) => saveSettings({ brushStrength: num((e.currentTarget as HTMLInputElement).value) / 100 })} />}
        </div>
      )}
      {(op === 'level' || op === 'pad' || op === 'slope') && (
        <div class="rb-group" title="Height to level to (m above sea level) — right-click the ground to pick it">
          <span class="rb-label">Height</span>
          {op !== 'slope' && <button class={`chip ${st.levelBalanced ? 'on' : ''}`} title="Level to the average ground height inside the brush / outline, so cut and fill balance there (the cheapest earthwork; a pad's side slopes add a little fill)" onClick={() => saveSettings({ levelBalanced: !st.levelBalanced })}>Balanced</button>}
          <input class="text small num" type="number" step={0.5} placeholder="pick" disabled={st.levelBalanced && op !== 'slope'} value={st.levelHeight ?? ''}
            onChange={(e) => { const v = (e.currentTarget as HTMLInputElement).value; saveSettings({ levelHeight: v === '' ? null : num(v), levelBalanced: false }); }} />
          <span class="muted small">m</span>
        </div>
      )}
      {op === 'embank' && (
        <div class="rb-group">
          <span class="rb-label">Top</span>
          <input class="text small num" type="number" step={0.5} value={st.embankOffset} title="Height above the ground (negative = a cutting)" onChange={(e) => saveSettings({ embankOffset: num((e.currentTarget as HTMLInputElement).value) })} />
          <span class="muted small">m · width</span>
          <input class="text small num" type="number" step={1} min={2} value={st.embankWidth} onChange={(e) => saveSettings({ embankWidth: Math.max(2, num((e.currentTarget as HTMLInputElement).value)) })} />
          <span class="muted small">m</span>
        </div>
      )}
      {op === 'pond' && (
        <div class="rb-group">
          <span class="rb-label">Depth</span>
          <input class="text small num" type="number" step={0.5} min={0.5} value={st.pondDepth} onChange={(e) => saveSettings({ pondDepth: Math.max(0.5, num((e.currentTarget as HTMLInputElement).value)) })} />
          <span class="muted small">m</span>
        </div>
      )}
      <div class="rb-group">
        <span class="rb-label">View</span>
        <div class="seg small">
          <button class={terrainView.value && terrainShow.value === 'height' ? 'on' : ''} onClick={() => { terrainView.value = true; terrainShow.value = 'height'; ui.E.overlayDirty = true; }}>Heights</button>
          <button class={terrainView.value && terrainShow.value === 'cutfill' ? 'on' : ''} onClick={() => { terrainView.value = true; terrainShow.value = 'cutfill'; ui.E.overlayDirty = true; }}>Cut & fill</button>
        </div>
        {mode.value === '3d' && (
          <select class="select small" value={String(st.exaggeration)} title="Vertical exaggeration (buildings and trees are hidden while it's on)" onChange={(e) => { saveSettings({ exaggeration: num((e.currentTarget as HTMLSelectElement).value) }); ui.E.applyExaggeration(); }}>
            {[1, 2, 3, 5].map((k) => <option key={k} value={k}>height ×{k}</option>)}
          </select>
        )}
      </div>
      <span class="rb-hint muted small" title="Earthworks against the original ground (roads' own cut / fill not included)">cut {fmtVol(T.cut)} · fill {fmtVol(T.fill)}</span>
    </div>
  );
}
