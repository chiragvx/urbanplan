// Floating options bar for the road tool and the bulldozer (Cities: Skylines' bottom panel): the drawing mode,
// the road class, the height to draw at with its step, and what to snap to.
import { mode, penClass, penLift, saveSettings, settings, tool, type RoadMode } from '../editor/state';
import { COMMANDS } from '../editor/commands';
import { MODE_LABEL } from '../editor/roadtool';
import { FLYOVER_DECK } from '../doc/ops';
import { CLASS_LABEL, ROAD_CLASSES } from '../doc/types';
import { ui } from './ctx';

const MODES: { m: RoadMode; icon: string }[] = [
  { m: 'straight', icon: 'M2 12L14 4' },
  { m: 'curve', icon: 'M2 13C4 4 10 3 14 3' },
  { m: 'complex', icon: 'M2 12C5 2 9 14 14 4' },
  { m: 'continuous', icon: 'M2 13c2-6 6-6 7-3s4 3 5-6' },
  { m: 'freeform', icon: 'M2.5 13.5l1-4L10 3l3 3-6.5 6.5z' },
  { m: 'replace', icon: 'M3 5h8l-2-2M13 11H5l2 2' },
];
const STEPS = [10, 5, 2.5, 1.25, 0.5];
const LENGTHS = [0, 1, 5, 8, 10];

const run = (id: string) => COMMANDS.find((c) => c.id === id)!.run(ui.E);

export function RoadToolbar() {
  void penLift.value;
  if (mode.value !== '2d') return null;
  if (tool.value === 'bulldoze') return <div class="roadbar"><span class="rb-hint">Bulldozer — click a section to remove it · <kbd>Shift</kbd> whole road · drag to sweep</span></div>;
  if (tool.value !== 'pen') return null;
  const st = settings.value;
  const lift = penLift.value;
  const chip = (on: boolean, label: string, title: string, f: () => void) => <button class={`chip ${on ? 'on' : ''}`} title={title} onClick={f}>{label}</button>;
  return (
    <div class="roadbar" onPointerDown={(e) => e.stopPropagation()}>
      <div class="seg rb-modes">
        {MODES.map((x, i) => (
          <button key={x.m} class={st.roadMode === x.m ? 'on' : ''} title={`${MODE_LABEL[x.m]} (${i + 1})`} onClick={() => run(`road.mode.${x.m}`)}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d={x.icon} /></svg>
            <span>{MODE_LABEL[x.m]}</span>
          </button>
        ))}
      </div>
      <select class="select" value={penClass.value} title="Class of the new road (Replace gives clicked roads this class)" onChange={(e) => { penClass.value = (e.currentTarget as HTMLSelectElement).value; ui.E.road.refresh(); }}>
        {ROAD_CLASSES.map((c) => <option key={c} value={c}>{CLASS_LABEL[c]}</option>)}
      </select>
      {st.roadMode !== 'replace' && (
        <div class="rb-group" title="Height to draw at — PageUp / PageDown; Shift+PageUp = flyover height, Shift+PageDown = ground">
          <span class="rb-label">Height</span>
          <button class="icon-btn" onClick={() => run('level.down')} title="Lower (PageDown)">▼</button>
          <span class={`rb-value ${lift > 0.25 ? 'up' : ''}`}>{lift ? `${lift} m` : 'ground'}</span>
          <button class="icon-btn" onClick={() => run('level.up')} title="Raise (PageUp)">▲</button>
          <button class={`chip ${Math.abs(lift - FLYOVER_DECK) < 0.01 ? 'on' : ''}`} title={`Flyover height: ${FLYOVER_DECK} m clears traffic below (Shift+PageUp)`} onClick={() => run('level.flyover')}>Flyover</button>
          <select class="select small" value={String(st.elevStep)} title="Elevation step (Alt+PageUp cycles)" onChange={(e) => saveSettings({ elevStep: Number((e.currentTarget as HTMLSelectElement).value) })}>
            {STEPS.map((s) => <option key={s} value={s}>step {s} m</option>)}
          </select>
        </div>
      )}
      {st.roadMode !== 'replace' && (
        <div class="rb-group">
          <span class="rb-label">Snap</span>
          {chip(st.snap, st.snap ? 'On' : 'Off', 'All snapping (S) — hold Ctrl to skip it for one click', () => run('snap.toggle'))}
          {st.snap && <>
            {chip(st.snapGeometry, 'Roads', 'Snap to junctions and roads at the same level', () => saveSettings({ snapGeometry: !st.snapGeometry }))}
            {chip(st.snapAngles, '90° / 45°', 'Right angles and 45° to the road you start from or the last stretch (Shift = any 15° step)', () => saveSettings({ snapAngles: !st.snapAngles }))}
            {chip(st.snapGuides, 'Guides', 'Guide lines carrying on from nearby road ends', () => saveSettings({ snapGuides: !st.snapGuides }))}
            <select class="select small" value={String(st.snapLength)} title="Round lengths" onChange={(e) => saveSettings({ snapLength: Number((e.currentTarget as HTMLSelectElement).value) })}>
              {LENGTHS.map((l) => <option key={l} value={l}>{l ? `length ${l} m` : 'any length'}</option>)}
            </select>
          </>}
        </div>
      )}
    </div>
  );
}
