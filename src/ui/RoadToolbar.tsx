// Options for the road tool and the other build tools, as the tool panel's labelled rows (Cities: Skylines' tool
// options): the drawing mode, the road type, the height to draw at with its step, the ground, what to snap to.
import { buildAsset, buildOpen, penClass, penLift, saveSettings, settings, tool, type RoadMode } from '../editor/state';
import { COMMANDS } from '../editor/commands';
import { MODE_LABEL } from '../editor/roadtool';
import { FLYOVER_DECK, TUNNEL_DEPTH } from '../doc/ops';
import { CLASS_LABEL, ROAD_CLASSES } from '../doc/types';
import { getAsset } from '../assets';
import { ui } from './ctx';
import { Icon } from './components';
import type { ComponentChildren } from 'preact';

const MODES: { m: RoadMode; icon: string }[] = [
  { m: 'straight', icon: 'M2 13L14 3' },
  { m: 'curve', icon: 'M2 14C4 4 10 3 14 3' },
  { m: 'complex', icon: 'M2 13C5 2 9 14 14 3' },
  { m: 'continuous', icon: 'M2 13c2-6 6-6 7-3s4 3 5-6' },
  { m: 'freeform', icon: 'M3 13l1-4L10 3l3 3-6 6z' },
  { m: 'replace', icon: 'M3 5h8l-2-2M13 11H5l2 2' },
];
const STEPS = [10, 5, 2.5, 1.25, 0.5];
const LENGTHS = [0, 1, 5, 8, 10];

const run = (id: string) => COMMANDS.find((c) => c.id === id)!.run(ui.E);
const svg = (d: string) => <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={d} /></svg>;

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

export function RoadToolbar() {
  void penLift.value;
  const t = tool.value;
  if (t === 'bulldoze') return <div class="card tp"><TpHead kind="Bulldozer" /><p class="tp-hint">Click a section to remove it · <kbd>Shift</kbd> the whole road · drag to sweep</p></div>;
  if (t === 'place' || t === 'area') {
    const a = getAsset(buildAsset.value);
    return (
      <div class="card tp">
        <TpHead kind="Build" name={a?.name ?? (t === 'place' ? 'Place' : 'Area')} />
        <p class="tp-hint">{t === 'place' ? <>Click to place · <kbd>[</kbd> <kbd>]</kbd> rotate · snaps onto its line or road</> : <>Click the corners · <kbd>Enter</kbd> or double-click to finish · right-click removes the last corner</>}</p>
      </div>
    );
  }
  const route = t === 'route';
  if (t !== 'pen' && !route) return null;
  const st = settings.value;
  const lift = penLift.value;
  const a = getAsset(buildAsset.value);
  const sq = (on: boolean, label: string, title: string, f: () => void, body: ComponentChildren = label, txt = false) =>
    <button class={`sq ${txt ? 'txt' : ''} ${on ? 'on' : ''}`} aria-label={label} aria-pressed={on} title={title} onClick={f}>{body}</button>;
  const replace = st.roadMode === 'replace';
  return (
    <div class="card tp" onPointerDown={(e) => e.stopPropagation()}>
      <TpHead kind={replace ? 'Upgrade' : 'Build'} name={a?.name ?? CLASS_LABEL[penClass.value] ?? penClass.value} />
      <TpRow label="Tool mode">
        {MODES.filter((x) => !route || (x.m !== 'freeform' && x.m !== 'replace')).map((x, i) => sq(st.roadMode === x.m, MODE_LABEL[x.m], `${MODE_LABEL[x.m]} (${i + 1})`, () => run(`road.mode.${x.m}`), svg(x.icon)))}
      </TpRow>
      {!route && !a && (
        <TpRow label="Road type" title="The class of the new road (Upgrade gives clicked roads this class). Pick from the catalogue for a full cross-section.">
          <select class="select" value={penClass.value} onChange={(e) => { penClass.value = (e.currentTarget as HTMLSelectElement).value; buildAsset.value = ''; ui.E.road.refresh(); }}>
            {ROAD_CLASSES.map((c) => <option key={c} value={c}>{CLASS_LABEL[c]}</option>)}
          </select>
        </TpRow>
      )}
      {!replace && (
        <>
          <TpRow label="Elevation" title="Height to draw at — PageUp / PageDown; Home = ground">
            <button class="sq" aria-label="Lower (PageDown)" title="Lower (PageDown)" onClick={() => run('level.down')}>▼</button>
            <span class={`tp-value ${lift > 0.25 ? 'up' : lift < -0.25 ? 'down' : ''}`}>{lift > 0 ? `${lift} m` : lift < 0 ? `${-lift} m deep` : 'ground'}</span>
            <button class="sq" aria-label="Raise (PageUp)" title="Raise (PageUp)" onClick={() => run('level.up')}>▲</button>
            {!route && <>
              {sq(Math.abs(lift - FLYOVER_DECK) < 0.01, 'Flyover', `Flyover: ${FLYOVER_DECK} m clears traffic below (Shift+PageUp)`, () => run('level.flyover'), 'Flyover', true)}
              {sq(Math.abs(lift - TUNNEL_DEPTH) < 0.01, 'Tunnel', `Tunnel: ${-TUNNEL_DEPTH} m down, under the roads above (Shift+PageDown) — X-ray shows it in 3D`, () => run('level.tunnel'), 'Tunnel', true)}
            </>}
          </TpRow>
          <TpRow label="Elevation step" title="How far PageUp / PageDown move (Alt+PageUp cycles)">
            <input class="tp-range" type="range" min={0} max={STEPS.length - 1} step={1} value={STEPS.length - 1 - Math.max(0, STEPS.indexOf(st.elevStep))} aria-label="Elevation step"
              onInput={(e) => saveSettings({ elevStep: STEPS[STEPS.length - 1 - Number((e.currentTarget as HTMLInputElement).value)] })} />
            <span class="tp-value">{st.elevStep} m</span>
          </TpRow>
        </>
      )}
      {!route && !replace && st.roadMode !== 'freeform' && (
        <TpRow label="Ground">
          {sq(!st.roadGraded, 'Follow the terrain', 'New roads follow the terrain', () => saveSettings({ roadGraded: false }), svg('M2 11c3-5 5-5 6-2s4 2 6-3'))}
          {sq(st.roadGraded, 'Graded', 'Graded: a fixed profile with stations every ≤ 96 m, the ground cut and filled to it — like Cities: Skylines', () => saveSettings({ roadGraded: true }), svg('M2 10l12-4M2 13h12'))}
        </TpRow>
      )}
      {!replace && (
        <TpRow label="Snapping" title="Hold Ctrl to skip snapping for one click">
          {sq(st.snap, 'Snapping', 'All snapping (S)', () => run('snap.toggle'), svg('M8 2v12M2 8h12M4 4l8 8M12 4l-8 8'))}
          {st.snap && <>
            {sq(st.snapGeometry, 'Roads and junctions', 'Snap to junctions and roads at the same level', () => saveSettings({ snapGeometry: !st.snapGeometry }), svg('M8 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM2 8h4M10 8h4'))}
            {sq(st.snapAngles, 'Right angles and 45°', 'Right angles and 45° to the road you start from or the last stretch (Shift = any 15° step)', () => saveSettings({ snapAngles: !st.snapAngles }), svg('M3 13V3M3 13h10M3 8a5 5 0 0 1 5 5'))}
            {sq(st.snapGuides, 'Guide lines', 'Guide lines carrying on from nearby road ends', () => saveSettings({ snapGuides: !st.snapGuides }), svg('M2 8h3M7 8h2M11 8h3'))}
            <select class="select small" value={String(st.snapLength)} aria-label="Round lengths" title="Round lengths" onChange={(e) => saveSettings({ snapLength: Number((e.currentTarget as HTMLSelectElement).value) })}>
              {LENGTHS.map((l) => <option key={l} value={l}>{l ? `${l} m` : 'any'}</option>)}
            </select>
          </>}
        </TpRow>
      )}
      <p class="tp-hint">{replace ? 'Click roads to give them this type · Alt: one section' : 'Click to place · right-click steps back · Esc done'}</p>
    </div>
  );
}
