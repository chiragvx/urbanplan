// Right panel: properties of whatever is selected. Road-level edits pass down to the road's sections unless a section
// sets its own value (shown with a dot: blue = edited here, purple = from the road edit, green = new object).
import { anchorSel, docVersion, readOnly, saveSettings, select, selection, settings, tool } from '../editor/state';
import { ui } from './ctx';
import { NumberField, Row, Section, Select, Toggle, Icon, Seg } from './components';
import { CrossSection } from './CrossSection';
import * as xs from '../doc/xsection';
import * as ops from '../doc/ops';
import { CLASS_LABEL, ROAD_CLASSES, type Id, type SectionObj } from '../doc/types';
import { LINE_LABEL } from '../doc/base';
import { COMMANDS, setDeck } from '../editor/commands';
import type { Part } from '../net/model';

const classOptions = ROAD_CLASSES.map((c) => ({ value: c as string, label: CLASS_LABEL[c] }));
const run = (id: string) => { const c = COMMANDS.find((x) => x.id === id)!; if (!c.enabled || c.enabled(ui.E)) c.run(ui.E); };
const len = (id: Id) => ui.C.geo(id)?.len ?? 0;

export function Inspector() {
  void docVersion.value;
  const sel = selection.value;
  const a = anchorSel.value;
  if (a && tool.value === 'direct') return <AnchorPanel owner={a.owner} k={a.k} />;
  if (!sel.length) return <Empty />;
  if (sel.length > 1) return <Multi />;
  const s = sel[0];
  const o = ui.doc.get(s.id);
  if (!o) return <Empty />;
  switch (o.kind) {
    case 'road': return <RoadPanel id={o.id} />;
    case 'section': return <SectionPanel id={o.id} />;
    case 'junction': return <JunctionPanel id={o.id} />;
    case 'line': return <LinePanel id={o.id} />;
    case 'building': return <BuildingPanel id={o.id} />;
    default: return <Empty />;
  }
}

function Empty() {
  void docVersion.value; // signals make components pure: re-render on every document change
  const d = ui.doc;
  return (
    <div class="insp empty">
      <h3>{d.meta.name}</h3>
      <p class="muted">{d.meta.author ? `by ${d.meta.author} · ` : ''}{d.editCount} edited object{d.editCount === 1 ? '' : 's'}</p>
      <div class="tips">
        <p><b>Click</b> a road to select the whole road, <b>double-click</b> for one section.</p>
        <p><b>Drag</b> a road to bend it, a junction to move it; drag the <b>□ handles</b> to change width.</p>
        <p><kbd>P</kbd> draw a road · <kbd>K</kbd> split · <kbd>A</kbd> edit points · <kbd>Tab</kbd> 3D · <kbd>Ctrl K</kbd> everything else</p>
      </div>
    </div>
  );
}

// ---------------- roads & sections ----------------

function setParts(target: Id, parts: Part[], merge?: string) {
  ui.E.edit('Cross-section', () => ui.doc.set(target, 'parts', parts), merge);
}

function WaysControls(p: { target: Id; parts: Part[]; reserve?: number; state?: 'base' | 'own' | 'road' | 'new'; mixed?: boolean }) {
  void docVersion.value; // signals make components pure: re-render on every document change
  const ro = readOnly.value;
  const n = xs.laneCount(p.parts);
  const one = xs.isOneway(p.parts);
  const med = p.parts.find((x) => x.kind === 'median')?.width ?? 0;
  const ch = (f: (q: Part[]) => Part[], merge?: string) => setParts(p.target, f(p.parts), merge);
  return (
    <>
      {p.mixed && <p class="note">Sections of this road differ — editing here gives them all this cross-section.</p>}
      <CrossSection parts={p.parts} reserve={p.reserve} disabled={ro} state={p.state} onChange={(q, m) => setParts(p.target, q, m)} />
      <div class="grid2">
        <NumberField label="Width" unit="m" value={p.mixed ? null : xs.totalWidth(p.parts)} min={2.5} max={80} step={0.5} disabled={ro} state={p.state} onChange={(v, m) => ch((q) => xs.setTotalWidth(q, v), m)} title="Total width, footpath to footpath (drag the label to scrub)" />
        <NumberField label={one ? 'Lanes' : 'Lanes →'} value={one ? n.all : n.f} step={1} digits={0} min={1} max={6} disabled={ro} onChange={(v) => ch((q) => (one ? xs.setLanes(q, Math.round(v), 0) : xs.setLanes(q, Math.round(v), n.b)))} />
        {!one && <NumberField label="Lanes ←" value={n.b} step={1} digits={0} min={0} max={6} disabled={ro} onChange={(v) => ch((q) => xs.setLanes(q, n.f, Math.round(v)))} />}
        <NumberField label="Median" unit="m" value={med} step={0.1} min={0} max={12} disabled={ro || one} onChange={(v, m) => ch((q) => xs.setMedian(q, v), m)} />
        <NumberField label="Footpath L" unit="m" value={xs.footpath(p.parts, 'L')} step={0.1} min={0} max={8} disabled={ro} onChange={(v, m) => ch((q) => xs.setFootpath(q, 'L', v), m)} />
        <NumberField label="Footpath R" unit="m" value={xs.footpath(p.parts, 'R')} step={0.1} min={0} max={8} disabled={ro} onChange={(v, m) => ch((q) => xs.setFootpath(q, 'R', v), m)} />
      </div>
      <div class="btns">
        <Toggle label="One-way" checked={one} disabled={ro} onChange={(v) => ch((q) => xs.makeOneway(q, v))} />
        {p.reserve ? <button disabled={ro} onClick={() => ch((q) => xs.setTotalWidth(q, p.reserve!))} title="Resize to the Development Plan road reserve">Use DP {p.reserve} m</button> : null}
      </div>
    </>
  );
}

function RoadPanel(p: { id: Id }) {
  void docVersion.value; // signals make components pure: re-render on every document change
  const d = ui.doc;
  const r = d.get<'road'>(p.id)!;
  const secs = d.sectionsOf(p.id);
  const ro = readOnly.value;
  if (!secs.length) return <Empty />;
  const lead = secs.reduce((a, b) => (len(a.id) >= len(b.id) ? a : b));
  const mixed = secs.some((s) => JSON.stringify(s.parts) !== JSON.stringify(lead.parts));
  const total = secs.reduce((a, s) => a + len(s.id), 0);
  const reserves = [...new Set(secs.map((s) => s.reserve).filter(Boolean))] as number[];
  const verified = secs.filter((s) => s.verified).length;
  return (
    <div class="insp">
      <div class="insp-kind"><Icon.road /> Road</div>
      <input class="title-input" value={r.name} placeholder="Unnamed road" disabled={ro} onChange={(e) => ui.E.edit('Rename road', () => d.set(p.id, 'name', (e.currentTarget as HTMLInputElement).value.trim()))} />
      <p class="muted">{secs.length} section{secs.length === 1 ? '' : 's'} · {fmtLen(total)} · {xs.describe(lead.parts)}</p>
      <Row label="Class"><Select value={secs.every((s) => s.cls === lead.cls) ? lead.cls : r.cls} options={classOptions} disabled={ro} onChange={(v) => ui.E.edit('Road class', () => d.set(p.id, 'cls', v))} /></Row>
      <Section title="Cross-section · whole road">
        <WaysControls target={p.id} parts={lead.parts} reserve={reserves.length === 1 ? reserves[0] : undefined} state={d.editState(lead.id, 'parts')} mixed={mixed} />
        {reserves.length > 1 && <p class="muted">DP reserve along this road: {reserves.sort((a, b) => a - b).join(' / ')} m</p>}
      </Section>
      <LevelControls ids={secs.map((x) => x.id)} />
      <Section title="Sections" open={secs.length <= 12} right={<span class="muted">{verified}/{secs.length} verified</span>}>
        <div class="list">
          {secs.sort((a, b) => len(b.id) - len(a.id)).map((s) => (
            <button key={s.id} class="list-item" onClick={() => select([{ kind: 'section', id: s.id }])} onDblClick={() => { select([{ kind: 'section', id: s.id }]); ui.E.zoomToSelection(); }}>
              {d.patch.has(s.id) && <i class="dot own" />}
              <span class="grow-left">{xs.totalWidth(s.parts).toFixed(1)} m · {xs.laneCount(s.parts).all} lane{xs.laneCount(s.parts).all === 1 ? '' : 's'}</span>
              <span class="muted">{fmtLen(len(s.id))}{s.verified ? ' ✓' : ''}</span>
            </button>
          ))}
        </div>
      </Section>
      <Actions items={['road.verify', 'road.straighten', 'road.smooth', 'road.reverse', 'road.reset']} />
      <div class="btns"><button class="danger" disabled={ro} onClick={() => run('edit.delete')}><Icon.trash size={14} /> Delete road</button></div>
    </div>
  );
}

/** Ground / flyover with a deck height: ramps are built at the run's ends at the set gradient. */
function LevelControls(p: { ids: Id[] }) {
  void docVersion.value; // signals make components pure: re-render on every document change
  const ro = readOnly.value;
  const d = ui.doc;
  const deck = ops.deckOf(d, p.ids);
  const up = deck > 0.25;
  const grade = settings.value.grade;
  return (
    <Section title="Level" open={up}>
      <Seg small value={up ? 'bridge' : 'ground'} options={[{ value: 'ground', label: 'At ground', title: 'Shift+PageDown' }, { value: 'bridge', label: 'Bridge / flyover', title: 'Shift+PageUp' }]}
        onChange={(v) => { if (!ro) setDeck(ui.E, v === 'ground' ? 0 : Math.max(deck, ops.FLYOVER_DECK)); }} />
      {up && (
        <div class="grid2">
          <NumberField label="Deck height" unit="m" value={deck} step={0.5} min={0} max={40} disabled={ro} onChange={(v, m) => setDeck(ui.E, v, m)} title="Above the ground at the highest point — PageUp / PageDown" />
          <NumberField label="Ramp grade" unit="%" value={grade * 100} step={0.5} min={1} max={12} digits={1} disabled={ro} onChange={(v) => { saveSettings({ grade: v / 100 }); setDeck(ui.E, deck); }} title="How steeply the ramps climb (5 % ≈ 1 in 20)" />
        </div>
      )}
      <p class="muted small">{up ? `Ramps of about ${Math.round(deck / grade)} m at each end. Junctions under the deck stay on the ground; roads below are crossed, not joined.` : <>Press <kbd>Shift</kbd>+<kbd>PgUp</kbd> to make this a flyover with ramps, <kbd>PgUp</kbd>/<kbd>PgDn</kbd> to step the height.</>}</p>
    </Section>
  );
}

function SectionPanel(p: { id: Id }) {
  void docVersion.value; // signals make components pure: re-render on every document change
  const d = ui.doc;
  const s = d.get<'section'>(p.id)!;
  const r = d.get<'road'>(s.road);
  const ro = readOnly.value;
  const g = ui.C.geo(p.id);
  const minR = g ? minRadius(g.pts) : Infinity;
  return (
    <div class="insp">
      <div class="crumbs">
        <button onClick={() => select([{ kind: 'road', id: s.road }])}>{r?.name || 'Unnamed road'}</button><span>›</span><span>Section</span>
      </div>
      <p class="muted">{fmtLen(g?.len ?? 0)} · {xs.describe(s.parts)}</p>
      <Row label="Name"><input class="text" value={s.name} disabled={ro} onChange={(e) => ui.E.edit('Rename', () => d.set(p.id, 'name', (e.currentTarget as HTMLInputElement).value.trim()))} /></Row>
      <Row label="Class"><Select value={s.cls} options={classOptions} disabled={ro} onChange={(v) => ui.E.edit('Class', () => d.set(p.id, 'cls', v))} /></Row>
      <Section title="Cross-section · this section">
        <WaysControls target={p.id} parts={s.parts} reserve={s.reserve} state={d.editState(p.id, 'parts')} />
        {d.editState(p.id, 'parts') === 'own' && <button class="link" disabled={ro} onClick={() => ui.E.edit('Reset width', () => d.reset(p.id, 'parts'))}>Reset to the road's cross-section</button>}
      </Section>
      <Section title="Shape" open={false}>
        <p class="muted">{s.path.length - 1} curve piece{s.path.length > 2 ? 's' : ''}{minR < 1e5 ? ` · tightest radius ${minR.toFixed(0)} m` : ''}</p>
        <Actions items={['road.straighten', 'road.smooth', 'road.arc', 'road.reverse']} />
        <p class="muted small">Drag the road to bend it. Double-click it (or press <kbd>A</kbd>) to edit points and curve handles.</p>
      </Section>
      <LevelControls ids={[p.id]} />
      <Section title="Source & accuracy">
        <Row label="Width from"><span>{({ dp: 'Development Plan sheet', osm: 'OpenStreetMap tags / defaults', user: 'Edited by hand', default: 'Default', survey: 'Survey', import: 'Import' } as Record<string, string>)[s.widthSrc ?? 'default']}</span></Row>
        {s.reserve ? <Row label="DP reserve"><span>{s.reserve} m</span></Row> : null}
        {s.wayIds.length > 0 && <Row label="OSM ways"><span class="links">{s.wayIds.slice(0, 4).map((w) => <a key={w} href={`https://www.openstreetmap.org/way/${w}`} target="_blank" rel="noreferrer">{w}</a>)}{s.wayIds.length > 4 ? ` +${s.wayIds.length - 4}` : ''}</span></Row>}
        <Toggle label="Verified on the ground / imagery" checked={!!s.verified} disabled={ro} onChange={(v) => ui.E.edit(v ? 'Verified' : 'Unverified', () => d.set(p.id, 'verified', v))} />
        <textarea class="note-input" placeholder="Notes (survey details, source, doubts…)" value={s.note ?? ''} disabled={ro} onChange={(e) => ui.E.edit('Note', () => d.set(p.id, 'note', (e.currentTarget as HTMLTextAreaElement).value || undefined))} />
      </Section>
      <Actions items={['road.separate', 'road.reset']} />
      <div class="btns"><button class="danger" disabled={ro} onClick={() => run('edit.delete')}><Icon.trash size={14} /> Delete section</button></div>
    </div>
  );
}

function Multi() {
  void docVersion.value; // signals make components pure: re-render on every document change
  const sel = selection.value;
  const secs = ui.E.selectedSections();
  const ro = readOnly.value;
  const counts = new Map<string, number>();
  for (const s of sel) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
  const widths = [...new Set(secs.map((s) => xs.totalWidth(s.parts)))];
  return (
    <div class="insp">
      <div class="insp-kind">{[...counts].map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`).join(' · ')}</div>
      {secs.length > 0 && (
        <Section title="All selected roads">
          <NumberField label="Width" unit="m" value={widths.length === 1 ? widths[0] : null} step={0.5} min={2.5} max={80} disabled={ro}
            onChange={(v, m) => ui.E.edit('Width', () => { for (const s of sel) if (s.kind === 'road' || s.kind === 'section') { const P = s.kind === 'road' ? leadParts(s.id) : ui.doc.get<'section'>(s.id)!.parts; ui.doc.set(s.id, 'parts', xs.setTotalWidth(P, v)); } }, m)} />
          <Actions items={['road.widen', 'road.narrow', 'road.lane.add', 'road.lane.remove', 'road.footpaths', 'road.dp', 'road.verify', 'road.straighten', 'road.smooth']} />
        </Section>
      )}
      {counts.get('junction') ? <Actions items={['junction.signals', 'junction.roundabout']} /> : null}
      <div class="btns"><button onClick={() => ui.E.zoomToSelection()}>Zoom to selection</button><button class="danger" disabled={ro} onClick={() => run('edit.delete')}><Icon.trash size={14} /> Delete</button></div>
    </div>
  );
}

const leadParts = (road: Id) => { const secs = ui.doc.sectionsOf(road); return secs.reduce((a, b) => (len(a.id) >= len(b.id) ? a : b)).parts; };

// ---------------- junctions ----------------

function JunctionPanel(p: { id: Id }) {
  void docVersion.value; // signals make components pure: re-render on every document change
  const d = ui.doc;
  const j = d.get<'junction'>(p.id)!;
  const arms = d.sectionsAt(p.id);
  const ro = readOnly.value;
  const set = (k: string, v: unknown, m?: string) => ui.E.edit('Junction', () => d.set(p.id, k, v), m);
  return (
    <div class="insp">
      <div class="insp-kind"><Icon.target /> {j.R ? 'Roundabout' : arms.length >= 3 ? 'Junction' : arms.length === 2 ? 'Join' : 'Dead end'}</div>
      <p class="muted">{arms.length} arm{arms.length === 1 ? '' : 's'}: {[...new Set(arms.map((s) => s.name || 'unnamed'))].slice(0, 4).join(', ')}</p>
      <Toggle label="Traffic signals" checked={j.signals} disabled={ro} onChange={(v) => set('signals', v)} />
      <Row label="Crossings"><Seg small value={j.crossings === undefined ? 'auto' : j.crossings ? 'on' : 'off'} options={[{ value: 'auto', label: 'Auto' }, { value: 'on', label: 'Zebras' }, { value: 'off', label: 'None' }]} onChange={(v) => set('crossings', v === 'auto' ? undefined : v === 'on')} /></Row>
      <Row label="Kerb corners"><Seg small value={j.rc === undefined ? 'auto' : 'set'} options={[{ value: 'auto', label: 'Auto' }, { value: 'set', label: 'Custom' }]} onChange={(v) => set('rc', v === 'auto' ? undefined : 8)} /></Row>
      {j.rc !== undefined && <NumberField label="Corner radius" unit="m" value={j.rc} step={0.5} min={1} max={30} disabled={ro} onChange={(v, m) => set('rc', v, m)} />}
      <Section title="Roundabout" open={!!j.R}>
        <Toggle label="Roundabout" checked={!!j.R} disabled={ro} onChange={(v) => ui.E.edit('Roundabout', () => d.update(p.id, v ? { R: 14, ringLanes: 1 } : { R: undefined, ringLanes: undefined }))} />
        {j.R ? <div class="grid2">
          <NumberField label="Radius" unit="m" value={j.R} step={0.5} min={4} max={60} disabled={ro} onChange={(v, m) => set('R', v, m)} />
          <NumberField label="Ring lanes" value={j.ringLanes ?? 1} step={1} digits={0} min={1} max={4} disabled={ro} onChange={(v) => set('ringLanes', Math.round(v))} />
        </div> : null}
      </Section>
      <Section title="Position" open={false}>
        <div class="grid2">
          <NumberField label="X" unit="m" value={j.x} step={0.1} disabled={ro} onChange={(v, m) => ui.E.edit('Move junction', () => ops.moveJunction(d, p.id, v, j.z), m)} />
          <NumberField label="Z" unit="m" value={j.z} step={0.1} disabled={ro} onChange={(v, m) => ui.E.edit('Move junction', () => ops.moveJunction(d, p.id, j.x, v), m)} />
          <NumberField label="Height" unit="m" value={j.lift} step={0.5} min={0} max={30} disabled={ro} onChange={(v, m) => set('lift', v, m)} title="Above the ground (for flyover junctions)" />
        </div>
      </Section>
      <div class="list">{arms.map((s) => <button key={s.id} class="list-item" onClick={() => select([{ kind: 'section', id: s.id }])}><span>{s.name || 'Unnamed'}</span><span class="muted">{xs.totalWidth(s.parts).toFixed(1)} m</span></button>)}</div>
      <Actions items={['junction.dissolve']} />
      <div class="btns"><button class="danger" disabled={ro} onClick={() => run('edit.delete')}><Icon.trash size={14} /> Delete junction</button></div>
    </div>
  );
}

// ---------------- lines & buildings ----------------

function LinePanel(p: { id: Id }) {
  void docVersion.value; // signals make components pure: re-render on every document change
  const d = ui.doc;
  const l = d.get<'line'>(p.id)!;
  const L = d.get<'layer'>(l.layer);
  const ro = readOnly.value;
  let length = 0;
  for (let i = 2; i < l.pts.length; i += 2) length += Math.hypot(l.pts[i] - l.pts[i - 2], l.pts[i + 1] - l.pts[i - 1]);
  const set = (k: string, v: unknown, m?: string) => ui.E.edit('Line', () => d.set(p.id, k, v), m);
  const layers = d.all('layer').filter((x) => x.type === 'lines');
  return (
    <div class="insp">
      <div class="insp-kind"><span class="swatch" style={{ background: L?.color }} /> {LINE_LABEL[L?.lineKind ?? 'other']}</div>
      <input class="title-input" value={l.name} placeholder="Unnamed line" disabled={ro} onChange={(e) => set('name', (e.currentTarget as HTMLInputElement).value.trim())} />
      <p class="muted">{fmtLen(length)} · {l.pts.length / 2} points</p>
      <Row label="Layer"><Select value={l.layer} options={layers.map((x) => ({ value: x.id, label: x.name }))} disabled={ro} onChange={(v) => set('layer', v)} /></Row>
      <div class="grid2">
        <NumberField label={l.depth < 0 ? 'Height' : 'Depth'} unit="m" value={Math.abs(l.depth)} step={0.1} min={0} max={60} disabled={ro} onChange={(v, m) => set('depth', l.depth < 0 ? -v : v, m)} title="Below ground (pipes) / above ground (viaducts)" />
        <NumberField label={L?.group === 'underground' ? 'Diameter' : 'Width'} unit="m" value={l.size} step={0.05} digits={2} min={0.02} max={20} disabled={ro} onChange={(v, m) => set('size', v, m)} />
      </div>
      <Row label="Position"><Seg small value={l.depth < -0.5 ? 'above' : l.depth > 0.3 ? 'below' : 'ground'} options={[{ value: 'below', label: 'Underground' }, { value: 'ground', label: 'Ground' }, { value: 'above', label: 'Elevated' }]} onChange={(v) => set('depth', v === 'below' ? Math.max(1, Math.abs(l.depth)) : v === 'ground' ? 0 : -Math.max(6, Math.abs(l.depth)))} /></Row>
      {Object.keys(l.props).length > 0 && (
        <Section title="Attributes" open={false}>
          {Object.entries(l.props).map(([k, v]) => <Row key={k} label={k}><span>{String(v)}</span></Row>)}
        </Section>
      )}
      {L?.source && <p class="muted small">Source: {L.source}{L.license ? ` · ${L.license}` : ''}</p>}
      <div class="btns"><button disabled={ro} onClick={() => { tool.value = 'direct'; }}>Edit points</button><button class="danger" disabled={ro} onClick={() => run('edit.delete')}><Icon.trash size={14} /> Delete</button></div>
    </div>
  );
}

function BuildingPanel(p: { id: Id }) {
  void docVersion.value; // signals make components pure: re-render on every document change
  const d = ui.doc;
  const b = d.get<'building'>(p.id)!;
  const ro = readOnly.value;
  const set = (k: string, v: unknown, m?: string) => ui.E.edit('Building', () => d.set(p.id, k, v), m);
  return (
    <div class="insp">
      <div class="insp-kind">Building</div>
      <input class="title-input" value={b.name} placeholder="Unnamed building" disabled={ro} onChange={(e) => set('name', (e.currentTarget as HTMLInputElement).value.trim())} />
      <div class="grid2">
        <NumberField label="Height" unit="m" value={b.h} step={0.5} min={2} max={250} disabled={ro} onChange={(v, m) => set('h', v, m)} />
        <NumberField label="Floors" value={Math.max(1, Math.round(b.h / 3.2))} step={1} digits={0} min={1} max={80} disabled={ro} onChange={(v) => set('h', Math.round(v) * 3.2)} />
      </div>
      <p class="muted small">Footprint from OpenStreetMap. Shift-drag to move it.</p>
      <div class="btns"><button class="danger" disabled={ro} onClick={() => run('edit.delete')}><Icon.trash size={14} /> Delete building</button></div>
    </div>
  );
}

function AnchorPanel(p: { owner: Id; k: number }) {
  void docVersion.value; // signals make components pure: re-render on every document change
  const d = ui.doc;
  const o = d.get(p.owner);
  const ro = readOnly.value;
  if (o?.kind === 'line') {
    const x = o.pts[p.k * 2], z = o.pts[p.k * 2 + 1];
    const setPt = (nx: number, nz: number, m?: string) => { const pts = [...o.pts]; pts[p.k * 2] = nx; pts[p.k * 2 + 1] = nz; ui.E.edit('Move point', () => d.set(o.id, 'pts', pts), m); };
    return <div class="insp"><div class="insp-kind">Point {p.k + 1} of {o.pts.length / 2}</div><div class="grid2"><NumberField label="X" unit="m" value={x} disabled={ro} onChange={(v, m) => setPt(v, z, m)} /><NumberField label="Z" unit="m" value={z} disabled={ro} onChange={(v, m) => setPt(x, v, m)} /></div><div class="btns"><button disabled={ro} onClick={() => ui.E.deleteAnchor()}>Delete point</button><button onClick={() => { anchorSel.value = null; }}>Done</button></div></div>;
  }
  if (o?.kind !== 'section') return <Empty />;
  const P = ops.anchorsOf(d, o as SectionObj);
  const a = P[p.k];
  if (!a) return <Empty />;
  const end = p.k === 0 || p.k === P.length - 1;
  const setA = (q: Partial<typeof a>, m?: string) => ui.E.edit('Point', () => d.set(o.id, 'path', o.path.map((x, i) => (i === p.k ? { ...x, ...q } : x))), m);
  return (
    <div class="insp">
      <div class="insp-kind">{end ? 'Road end (junction)' : `Point ${p.k} of ${P.length - 2}`}</div>
      <div class="grid2">
        <NumberField label="X" unit="m" value={a.x} disabled={ro || end} onChange={(v, m) => setA({ x: v }, m)} />
        <NumberField label="Z" unit="m" value={a.z} disabled={ro || end} onChange={(v, m) => setA({ z: v }, m)} />
        <NumberField label="Height" unit="m" value={a.lift} step={0.5} min={0} max={30} disabled={ro || end} onChange={(v, m) => setA({ lift: v }, m)} title="Deck height above ground at this point" />
      </div>
      <p class="muted small">Drag handles to shape the curve; hold <kbd>Alt</kbd> for a sharp corner. <kbd>Delete</kbd> removes the point.</p>
      <div class="btns">{!end && <button disabled={ro} onClick={() => ui.E.deleteAnchor()}>Delete point</button>}<button onClick={() => { anchorSel.value = null; }}>Done</button></div>
    </div>
  );
}

// ---------------- bits ----------------

function Actions(p: { items: string[] }) {
  void docVersion.value; // signals make components pure: re-render on every document change
  const cmds = p.items.map((id) => COMMANDS.find((c) => c.id === id)!).filter((c) => c && (!c.enabled || c.enabled(ui.E)));
  if (!cmds.length) return null;
  return <div class="actions">{cmds.map((c) => <button key={c.id} disabled={readOnly.value && c.group !== 'View'} onClick={() => c.run(ui.E)} title={c.keys}>{c.label}</button>)}</div>;
}

export function fmtLen(m: number) { return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`; }

function minRadius(pts: Float32Array) {
  let best = Infinity;
  for (let i = 2; i + 2 < pts.length / 2; i += 2) {
    const ax = pts[(i - 2) * 2], az = pts[(i - 2) * 2 + 1], bx = pts[i * 2], bz = pts[i * 2 + 1], cx = pts[(i + 2) * 2], cz = pts[(i + 2) * 2 + 1];
    const a = Math.hypot(bx - ax, bz - az), b = Math.hypot(cx - bx, cz - bz), c = Math.hypot(cx - ax, cz - az);
    const ar = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
    if (ar > 1e-6) best = Math.min(best, (a * b * c) / (2 * ar));
  }
  return best;
}
