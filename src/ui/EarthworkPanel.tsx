// Inspector for an earthwork (terraforming): what it does, its settings, and its own cut / fill.
import { docVersion, readOnly, select } from '../editor/state';
import { ui } from './ctx';
import { Icon, NumberField } from './components';
import { EARTHWORK_LABEL, type EarthworkObj } from '../doc/types';
import { fmtVol } from '../editor/terraintool';

export function EarthworkPanel(p: { id: string }) {
  void docVersion.value; // signals make components pure: re-render on every document change
  const o = ui.doc.get<'earthwork'>(p.id);
  const ro = readOnly.value;
  if (!o) return null;
  const set = (patch: Partial<EarthworkObj>, merge?: string) => ui.E.edit('Earthwork', () => ui.doc.update(p.id, patch), merge);
  const v = ui.E.terrain.volumeOf(p.id);
  const brush = o.op === 'shift' || o.op === 'level' || o.op === 'soften' || o.op === 'restore';
  const dabs = brush ? o.pts.length / 3 : 0;
  return (
    <div class="insp">
      <div class="insp-kind"><Icon.terrain /> Earthwork</div>
      <h3 class="region-title">{EARTHWORK_LABEL[o.op]}{o.op === 'embank' && o.pts.length >= 6 && o.pts[2] < ui.E.terra.heightAt(o.pts[0], o.pts[1]) ? ' (cutting)' : ''}</h3>
      <p class="muted">cut {fmtVol(v.cut)} · fill {fmtVol(v.fill)}{brush ? ` · ${dabs} brush dab${dabs === 1 ? '' : 's'}` : ''}</p>
      <div class="grid2">
        {(brush || o.op === 'slope' || o.op === 'embank') && (
          <NumberField label={o.op === 'embank' ? 'Half width' : o.op === 'slope' ? 'Half width' : 'Radius'} unit="m" value={o.radius} step={1} min={2} max={400} disabled={ro} onChange={(r, m) => set({ radius: r }, m)} />
        )}
        {(o.op === 'level' || o.op === 'pad' || o.op === 'pond') && (
          <NumberField label={o.op === 'pond' ? 'Water level' : 'Height'} unit="m" value={o.height ?? 0} step={0.1} min={-100} max={2000} disabled={ro} onChange={(h, m) => set({ height: h }, m)} title="Metres above sea level" />
        )}
        {o.op === 'pond' && <NumberField label="Depth" unit="m" value={o.depth ?? 2} step={0.5} min={0.5} max={20} disabled={ro} onChange={(d, m) => set({ depth: d }, m)} />}
        {(o.op === 'pad' || o.op === 'embank') && (
          <NumberField label="Side slope" unit="1:" value={Math.round(1 / (o.sideSlope ?? 0.5) * 10) / 10} step={0.5} min={0.5} max={10} disabled={ro} onChange={(s, m) => set({ sideSlope: 1 / Math.max(0.5, s) }, m)} title="Horizontal run per metre of height (2 = 1:2)" />
        )}
        {o.op === 'slope' && o.heights && (
          <>
            <NumberField label="Top" unit="m" value={o.heights[0]} step={0.1} disabled={ro} onChange={(h, m) => set({ heights: [h, o.heights![1]] }, m)} />
            <NumberField label="Bottom" unit="m" value={o.heights[1]} step={0.1} disabled={ro} onChange={(h, m) => set({ heights: [o.heights![0], h] }, m)} />
          </>
        )}
        {o.op === 'embank' && (
          <NumberField label="Raise all" unit="m" value={0} step={0.5} disabled={ro} title="Move the whole embankment up or down"
            onChange={(d, m) => set({ pts: o.pts.map((v, i) => (i % 3 === 2 ? Math.round((v + d) * 100) / 100 : v)) }, m)} />
        )}
      </div>
      <p class="muted small">Heights in metres above sea level. Earthworks apply in the order they were made; roads are graded over them.</p>
      <div class="btns">
        <button onClick={() => ui.E.zoomToSelection()}>Zoom to it</button>
        <button class="danger" disabled={ro} onClick={() => { ui.E.edit('Delete earthwork', () => ui.doc.remove(p.id)); select([]); }}><Icon.trash size={14} /> Delete</button>
      </div>
    </div>
  );
}
