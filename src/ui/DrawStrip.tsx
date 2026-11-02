// The drawing strip: while a draw tool is in use (road, route, place, area) the build palette and the tool panel fold
// into one row of icons above the bottom bar: what's being built (click: the palette again), the shape, the height,
// the ground, snapping. Names, keys and pictures are in the hover cards; the next step is at the cursor.
import { signal } from '@preact/signals';
import type { JSX } from 'preact';
import { buildAsset, buildCat, buildOpen, penClass, penLift, placeRot, readOnly, saveSettings, settings, tool, type RoadMode } from '../editor/state';
import { COMMANDS } from '../editor/commands';
import { MODE_LABEL } from '../editor/roadtool';
import { FLYOVER_DECK, TUNNEL_DEPTH } from '../doc/ops';
import { CLASS_LABEL, ROAD_CLASSES } from '../doc/types';
import { CATEGORIES, assetsIn, getAsset, sizeLabel, tabsOf, uiCategory } from '../assets';
import { thumb } from '../assets/thumb';
import { revealAsset } from './BuildPalette';
import { registerTipArt } from './hovercard';
import { Icon } from './components';
import { ui } from './ctx';
import './build.css';

export const DRAW_TOOLS = ['pen', 'route', 'place', 'area'];
/** The how-to at the cursor, asked for again ('?' on the strip) after a tool's first uses. */
export const howTo = signal(false);

const MODES: { m: RoadMode; icon: string; why: string }[] = [
  { m: 'straight', icon: 'M2 13L14 3', why: 'click the start, click the end' },
  { m: 'curve', icon: 'M2 14C4 4 10 3 14 3', why: 'start, the bend, then the end' },
  { m: 'complex', icon: 'M2 13C5 2 9 14 14 3', why: 'start, two bends, then the end' },
  { m: 'continuous', icon: 'M2 13c2-6 6-6 7-3s4 3 5-6', why: 'each stretch carries on smoothly from the last' },
  { m: 'freeform', icon: 'M3 13l1-4L10 3l3 3-6 6z', why: 'click points, drag for curves, Enter to finish' },
  { m: 'replace', icon: 'M3 5h8l-2-2M13 11H5l2 2', why: 'click roads to give them this type' },
];
const LENGTHS = [0, 1, 5, 8, 10];

const run = (id: string) => COMMANDS.find((c) => c.id === id)?.run(ui.E);
const svg = (d: string, s = 18) => <svg width={s} height={s} viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={d} /></svg>;

// ---------------- hover-card pictures ----------------

const pic = (body: JSX.Element) => <svg width="150" height="60" viewBox="0 0 150 60" fill="none" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{body}</svg>;
const road = (d: string) => <><path d={d} stroke="#9a9a9e" stroke-width="11" /><path d={d} stroke="#4a4d52" stroke-width="8" /><path d={d} stroke="#fff" stroke-width="1" stroke-dasharray="4 4" /></>;
const dots = (pts: [number, number][]) => pts.map(([x, y], i) => <circle key={i} cx={x} cy={y} r="4" fill="var(--panel)" stroke="var(--accent)" stroke-width="2" />);
const MODE_ART: Record<RoadMode, () => JSX.Element> = {
  straight: () => pic(<>{road('M20 46L130 14')}{dots([[20, 46], [130, 14]])}</>),
  curve: () => pic(<>{road('M18 48Q40 10 132 16')}<path d="M18 48L40 10L132 16" stroke="var(--accent)" stroke-dasharray="3 3" />{dots([[18, 48], [40, 10], [132, 16]])}</>),
  complex: () => pic(<>{road('M14 46C40 0 100 64 136 14')}<path d="M14 46L40 0M100 64L136 14" stroke="var(--accent)" stroke-dasharray="3 3" />{dots([[14, 46], [40, 4], [100, 56], [136, 14]])}</>),
  continuous: () => pic(<>{road('M12 48C30 20 50 20 70 34S110 48 138 12')}{dots([[12, 48], [70, 34], [138, 12]])}</>),
  freeform: () => pic(<>{road('M14 44C30 10 50 50 75 30S120 10 136 22')}{dots([[14, 44], [45, 32], [75, 30], [110, 18], [136, 22]])}</>),
  replace: () => pic(<>{road('M10 30H140')}<path d="M60 30H140" stroke="var(--accent)" stroke-width="8" /><path d="M58 14v32" stroke="var(--accent)" stroke-width="2" /></>),
};
const ground = <path d="M0 48C30 40 50 54 80 44S130 38 150 46V60H0z" fill="#c9b48a" stroke="#a08a5f" />;
const HEIGHT_ART: Record<string, () => JSX.Element> = {
  ground: () => pic(<>{ground}<path d="M0 46C30 38 50 52 80 42S130 36 150 44" stroke="#4a4d52" stroke-width="5" /></>),
  flyover: () => pic(<>{ground}<path d="M0 46Q30 44 45 18H105Q120 44 150 44" stroke="#4a4d52" stroke-width="5" /><path d="M65 18v28M85 18v28" stroke="#8a8a8e" stroke-width="3" /><path d="M40 52h70" stroke="#6c7076" stroke-width="4" /></>),
  tunnel: () => pic(<>{ground}<path d="M0 44Q25 44 40 54H110Q125 44 150 44" stroke="#4a4d52" stroke-width="5" stroke-dasharray="6 3" /><path d="M0 40C30 32 50 46 80 36S130 30 150 38" stroke="#4a4d52" stroke-width="3" /></>),
  follow: () => pic(<>{ground}<path d="M0 46C30 38 50 52 80 42S130 36 150 44" stroke="#4a4d52" stroke-width="5" /></>),
  graded: () => pic(<>{ground}<path d="M0 46L150 40" stroke="#4a4d52" stroke-width="5" /><path d="M40 49l0-6M110 45v-4" stroke="var(--accent)" stroke-width="2" /></>),
};
registerTipArt('mode', (m) => MODE_ART[m as RoadMode]?.() ?? null);
registerTipArt('height', (k) => HEIGHT_ART[k]?.() ?? null);
registerTipArt('asset', (id) => { const a = getAsset(id); return a ? <img src={thumb(a)} width={150} height={96} alt="" /> : null; });
registerTipArt('cat', (c) => {
  const cat = CATEGORIES.find((k) => k.id === c);
  if (!cat) return null;
  const picks = tabsOf(cat.id).map((t) => assetsIn(cat.id, t)[0]).filter(Boolean).slice(0, 3);
  return <div class="hc-thumbs">{picks.map((a) => <img key={a.id} src={thumb(a)} alt="" />)}</div>;
});

// ---------------- the strip ----------------

export function DrawStrip() {
  const t = tool.value;
  if (!DRAW_TOOLS.includes(t) || readOnly.value) return null;
  void penLift.value; void placeRot.value;
  const st = settings.value, a = getAsset(buildAsset.value);
  const route = t === 'route', pen = t === 'pen', replace = pen && st.roadMode === 'replace';
  const lift = penLift.value;
  const b = (on: boolean, title: string, f: () => void, body: JSX.Element | string, art?: string) =>
    <button class={`ds-btn ${on ? 'on' : ''}`} aria-pressed={on} title={title} data-tip-art={art} onClick={f}>{body}</button>;
  const openPalette = () => {
    if (a) revealAsset(a.id); else buildCat.value = 'roads';
    buildOpen.value = !buildOpen.value;
  };
  return (
    <div class="drawstrip" onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      <button class={`ds-type ${buildOpen.value ? 'on' : ''}`} title={`${a?.name ?? CLASS_LABEL[penClass.value] ?? 'Build'} (O): click for other types`} data-tip-art={a ? `asset:${a.id}` : undefined} onClick={openPalette}>
        {a ? <img src={thumb(a)} width={44} height={28} alt="" draggable={false} /> : <Icon.road size={18} />}
        <span>{a ? sizeLabel(a) : CLASS_LABEL[penClass.value]}</span>
        <i class="ds-caret" aria-hidden="true">▴</i>
      </button>
      {pen && !a && (
        <select class="select small" value={penClass.value} aria-label="Road type" title="Road type: the class of the new road" onChange={(e) => { penClass.value = (e.currentTarget as HTMLSelectElement).value; buildAsset.value = ''; ui.E.road.refresh(); }}>
          {ROAD_CLASSES.map((c) => <option key={c} value={c}>{CLASS_LABEL[c]}</option>)}
        </select>
      )}
      {(pen || route) && <>
        <span class="ds-sep" />
        {MODES.filter((x) => !route || (x.m !== 'freeform' && x.m !== 'replace')).map((x, i) =>
          b(st.roadMode === x.m, `${MODE_LABEL[x.m]} (${i + 1}): ${x.why}`, () => run(`road.mode.${x.m}`), svg(x.icon), `mode:${x.m}`))}
      </>}
      {(pen || route) && !replace && <>
        <span class="ds-sep" />
        {b(false, 'Lower (PageDown)', () => run('level.down'), svg('M4 6l4 4 4-4'))}
        <span class={`ds-val ${lift > 0.25 ? 'up' : lift < -0.25 ? 'down' : ''}`} title="Height to draw at: PageUp / PageDown, Home for the ground" data-tip-art={`height:${lift > 0.25 ? 'flyover' : lift < -0.25 ? 'tunnel' : 'ground'}`}>{lift > 0 ? `+${lift} m` : lift < 0 ? `${lift} m` : '±0'}</span>
        {b(false, 'Raise (PageUp)', () => run('level.up'), svg('M4 10l4-4 4 4'))}
        {b(false, `Height step: ${st.elevStep} m a press (Alt+PageUp)`, () => run('level.step'), <small class="ds-step">{st.elevStep}</small>)}
        {pen && <>
          {b(Math.abs(lift - FLYOVER_DECK) < 0.01, `Flyover: ${FLYOVER_DECK} m up, clears traffic below (Shift+PageUp)`, () => run('level.flyover'), svg('M1 12q3 0 4-6h6q1 6 4 6M6 6v6M10 6v6'), 'height:flyover')}
          {b(Math.abs(lift - TUNNEL_DEPTH) < 0.01, `Tunnel: ${-TUNNEL_DEPTH} m down, under the roads above (Shift+PageDown) — X-ray shows it in 3D`, () => run('level.tunnel'), svg('M2 13V9a6 6 0 0 1 12 0v4M5 13v-3a3 3 0 0 1 6 0v3'), 'height:tunnel')}
        </>}
      </>}
      {pen && !replace && st.roadMode !== 'freeform' && <>
        <span class="ds-sep" />
        {b(st.roadAuto !== false, 'Auto height: ground, bridge, cutting or tunnel worked out per stretch (the long-section shows it)', () => { saveSettings({ roadAuto: st.roadAuto === false }); ui.E.road.refresh(); }, svg('M1 6h5l3 4h6M3 6v6M14 10v3'), 'height:flyover')}
        {b(!st.roadGraded, 'Follow the terrain: new roads ride the ground', () => saveSettings({ roadGraded: false }), svg('M2 11c3-5 5-5 6-2s4 2 6-3'), 'height:follow')}
        {b(st.roadGraded, 'Graded: a fixed profile, the ground cut and filled to it', () => saveSettings({ roadGraded: true }), svg('M2 10l12-4M2 13h12'), 'height:graded')}
      </>}
      {t === 'place' && <>
        <span class="ds-sep" />
        {b(false, 'Turn left 15° ([)', () => run('road.narrow'), svg('M5 4H2v3M2.5 7A6 6 0 1 1 4 12'))}
        <span class="ds-val" title="Rotation (snapping onto a line overrides it)">{placeRot.value}°</span>
        {b(false, 'Turn right 15° (])', () => run('road.widen'), svg('M11 4h3v3M13.5 7A6 6 0 1 0 12 12'))}
      </>}
      {!replace && t !== 'area' && <>
        <span class="ds-sep" />
        {b(st.snap, 'Snapping (S): hold Ctrl to skip it for one click', () => run('snap.toggle'), svg('M4 2v6a4 4 0 0 0 8 0V2M4 5h3M9 5h3'))}
        {st.snap && (pen || route) && <>
          {b(st.snapGeometry, 'Snap to junctions and roads at the same level', () => saveSettings({ snapGeometry: !st.snapGeometry }), svg('M8 6a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM2 8h4M10 8h4'))}
          {b(st.snapAngles, 'Snap to right angles and 45°: to the road you start from or the last stretch (Shift: any 15°)', () => saveSettings({ snapAngles: !st.snapAngles }), svg('M3 13V3M3 13h10M3 8a5 5 0 0 1 5 5'))}
          {b(st.snapGuides, 'Guide lines: carry on from nearby road ends', () => saveSettings({ snapGuides: !st.snapGuides }), svg('M2 8h3M7 8h2M11 8h3'))}
          {b(st.snapLength > 0, `Round lengths: ${st.snapLength ? `${st.snapLength} m` : 'off'} (click for the next)`, () => saveSettings({ snapLength: LENGTHS[(LENGTHS.indexOf(st.snapLength) + 1) % LENGTHS.length] }), <small class="ds-step">{st.snapLength ? `${st.snapLength}m` : 'any'}</small>)}
        </>}
      </>}
      <span class="ds-sep" />
      {b(howTo.value, 'How to draw: show the steps at the cursor', () => { howTo.value = !howTo.value; }, svg('M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM6.2 6a1.9 1.9 0 0 1 3.6.8c0 1.2-1.8 1.6-1.8 2.7M8 11.5h.01'))}
      <button class="ds-btn" title="Done (Esc)" onClick={() => { buildOpen.value = false; ui.E.setTool('select'); }}><Icon.close size={16} /></button>
    </div>
  );
}

/** The bar category to light up while drawing: the one the asset being built is in. */
export function drawingCategory() {
  const a = getAsset(buildAsset.value);
  return a ? uiCategory(a.category) : DRAW_TOOLS.includes(tool.value) ? 'roads' : null;
}
