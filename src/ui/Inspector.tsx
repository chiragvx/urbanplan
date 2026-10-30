// Right panel: properties of whatever is selected. Road-level edits pass down to the road's sections unless a section
// sets its own value (shown with a dot: blue = edited here, purple = from the road edit, green = new object).
import { anchorSel, docVersion, readOnly, saveSettings, select, selection, settings, tool } from '../editor/state';
import { useEffect, useRef } from 'preact/hooks';
import { ui } from './ctx';
import { NumberField, Row, Section, Select, Toggle, Icon, Seg, Tabs } from './components';
import { CrossSection } from './CrossSection';
import * as xs from '../doc/xsection';
import * as ops from '../doc/ops';
import { CLASS_LABEL, ROAD_CLASSES, type Id, type SectionObj } from '../doc/types';
import { COVER } from '../net/generate';
import { RegionPanel } from './RegionPanel';
import { EarthworkPanel } from './EarthworkPanel';
import { LINE_LABEL } from '../doc/base';
import { COMMANDS, setDeck } from '../editor/commands';
import type { Part } from '../net/model';
import { allAssets, assetOf, assetWidth, getAsset, lineShape, retypeLine, saveCustom, sizeLabel, type AssetDef } from '../assets';
import { thumb } from '../assets/thumb';
import { revealAsset } from './BuildPalette';
import { buildOpen } from '../editor/state';

const classOptions = ROAD_CLASSES.map((c) => ({ value: c as string, label: CLASS_LABEL[c] }));
const run = (id: string) => { const c = COMMANDS.find((x) => x.id === id)!; if (!c.enabled || c.enabled(ui.E)) c.run(ui.E); };
const len = (id: Id) => ui.C.geo(id)?.len ?? 0;

/** The inspector as a floating info card (Cities: Skylines style): shown while something is selected; always shown
 *  (with the map's summary) when the panels are docked. */
export function InspectorCard() {
  void docVersion.value;
  const sel = selection.value;
  const has = sel.length > 0 || (!!anchorSel.value && tool.value === 'direct');
  const docked = settings.value.panels === 'docked';
  const ref = useRef<HTMLDivElement>(null);
  const key = sel.map((s) => s.id).join();
  useEffect(() => { ref.current?.scrollTo({ top: 0 }); }, [key]);
  if (!has && !docked) return null;
  return (
    <div class="card insp-card" ref={ref} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
      {has && <button class="icon-btn card-close" title="Deselect (Esc)" onClick={() => select([])}><Icon.close size={14} /></button>}
      <Inspector />
    </div>
  );
}

export function Inspector() {
  void docVersion.value;
  const sel = selection.value;
  const a = anchorSel.value;
  if (a && tool.value === 'direct') return <AnchorPanel owner={a.owner} k={a.k} />;
  if (!sel.length) return <Empty />;
  if (sel.length > 1) return <Multi />;
  const s = sel[0];
  if (s.kind === 'region') return <RegionPanel id={s.id} />;
  const o = ui.doc.get(s.id);
  if (!o) return <Empty />;
  switch (o.kind) {
    case 'road': return <RoadPanel id={o.id} />;
    case 'section': return <SectionPanel id={o.id} />;
    case 'junction': return <JunctionPanel id={o.id} />;
    case 'line': return <LinePanel id={o.id} />;
    case 'building': return <BuildingPanel id={o.id} />;
    case 'earthwork': return <EarthworkPanel id={o.id} />;
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

function WaysControls(p: { target: Id; parts: Part[]; reserve?: number; state?: 'base' | 'own' | 'road' | 'new'; mixed?: boolean; range?: [number, number]; ids?: Id[] }) {
  void docVersion.value; // signals make components pure: re-render on every document change
  const ro = readOnly.value;
  const n = xs.laneCount(p.parts);
  const one = xs.isOneway(p.parts);
  const med = p.parts.find((x) => x.kind === 'median')?.width ?? 0;
  const ch = (f: (q: Part[]) => Part[], merge?: string) => setParts(p.target, f(p.parts), merge);
  return (
    <>
      <CrossSection parts={p.parts} reserve={p.reserve} disabled={ro} state={p.state} onChange={(q, m) => setParts(p.target, q, m)}
        onPreset={(a) => { if (a.profile.type !== 'street') return; const prof = a.profile; ui.E.edit(`Make it ${a.name}`, () => { ui.doc.set(p.target, 'parts', prof.parts.map((q) => ({ ...q }))); for (const id of p.ids ?? [p.target]) ui.doc.set(id, 'asset', a.id); }); }} />
      <div class="grid2">
        <NumberField label="Width" unit="m" value={p.mixed ? null : xs.totalWidth(p.parts)} placeholder={p.range ? `${Math.floor(p.range[0])}–${Math.ceil(p.range[1])}` : undefined} min={2.5} max={80} step={0.5} disabled={ro} state={p.state} onChange={(v, m) => ch((q) => xs.setTotalWidth(q, v), m)} title="Total width, footpath to footpath (drag the label to scrub)" />
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
  // the cross-section most of the road has (by length), shown and edited as the road's
  const byKey = new Map<string, { len: number; n: number; s: SectionObj }>();
  for (const s of secs) {
    const k = JSON.stringify(s.parts), g = byKey.get(k);
    if (g) { g.len += len(s.id); g.n++; if (len(s.id) > len(g.s.id)) g.s = s; } else byKey.set(k, { len: len(s.id), n: 1, s });
  }
  const common = [...byKey.values()].reduce((a, b) => (b.len > a.len ? b : a));
  const lead = common.s;
  const mixed = byKey.size > 1;
  const widths = secs.map((s) => xs.totalWidth(s.parts));
  const range: [number, number] = [Math.min(...widths), Math.max(...widths)];
  const total = secs.reduce((a, s) => a + len(s.id), 0);
  const reserves = [...new Set(secs.map((s) => s.reserve).filter(Boolean))] as number[];
  const verified = secs.filter((s) => s.verified).length;
  return (
    <div class="insp">
      <div class="insp-kind"><Icon.road /> Road</div>
      <input class="title-input" value={r.name} placeholder="Unnamed road" disabled={ro} onChange={(e) => ui.E.edit('Rename road', () => d.set(p.id, 'name', (e.currentTarget as HTMLInputElement).value.trim()))} />
      <p class="muted">{secs.length} section{secs.length === 1 ? '' : 's'} · {fmtLen(total)} · {xs.describe(lead.parts)}{mixed && range[1] - range[0] >= 0.1 ? <> · <b class="varies-tag">{fmtW(range[0])}–{fmtW(range[1])} m along it</b></> : null}</p>
      <Row label="Class"><Select value={secs.every((s) => s.cls === lead.cls) ? lead.cls : r.cls} options={classOptions} disabled={ro} onChange={(v) => ui.E.edit('Road class', () => d.set(p.id, 'cls', v))} /></Row>
      <Tabs id="road" tabs={[
        { id: 'xs', label: 'Cross-section', body: () => (
          <>
            {mixed && <Varies road={p.id} secs={secs} lead={lead} common={common} reserve={reserves.length === 1 ? reserves[0] : undefined} />}
            <WaysControls target={p.id} parts={lead.parts} reserve={reserves.length === 1 ? reserves[0] : undefined} state={d.editState(lead.id, 'parts')} mixed={mixed} range={range} ids={secs.map((x) => x.id)} />
            {reserves.length > 1 && <p class="muted small">DP reserve along this road: {reserves.sort((a, b) => a - b).join(' / ')} m</p>}
          </>
        ) },
        { id: 'asset', label: 'Catalogue', body: () => <StreetAsset ids={secs.map((x) => x.id)} target={p.id} parts={lead.parts} cls={lead.cls} name={r.name} /> },
        { id: 'level', label: 'Level', body: () => <LevelControls ids={secs.map((x) => x.id)} /> },
        { id: 'secs', label: 'Sections', hint: secs.length, body: () => (
          <>
            <p class="muted small">{verified} of {secs.length} verified · double-click to zoom</p>
            <div class="list">
              {orderAlong(secs).map((s) => (
                <button key={s.id} class="list-item" onClick={() => select([{ kind: 'section', id: s.id }])} onDblClick={() => { select([{ kind: 'section', id: s.id }]); ui.E.zoomToSelection(); }}>
                  {d.patch.has(s.id) && <i class="dot own" />}
                  <span class="grow-left">{xs.totalWidth(s.parts).toFixed(1)} m · {xs.laneCount(s.parts).all} lane{xs.laneCount(s.parts).all === 1 ? '' : 's'}</span>
                  <span class="muted">{fmtLen(len(s.id))}{s.verified ? ' ✓' : ''}</span>
                </button>
              ))}
            </div>
            <Actions items={['road.verify']} />
          </>
        ) },
      ]} />
      <div class="insp-foot">
        <Actions items={['road.straighten', 'road.smooth', 'road.reverse', 'road.reset']} />
        <button class="icon-btn danger" title="Delete road (Del)" disabled={ro} onClick={() => run('edit.delete')}><Icon.trash size={15} /></button>
      </div>
    </div>
  );
}

const fmtW = (w: number) => (Math.round(w * 10) / 10).toString();

/** A road's sections in order along it (each branch / disconnected run in turn). */
function orderAlong(secs: SectionObj[]): SectionObj[] {
  const at = new Map<Id, SectionObj[]>();
  for (const s of secs) for (const j of [s.a, s.b]) (at.get(j) ?? at.set(j, []).get(j)!).push(s);
  const left = new Set(secs), out: SectionObj[] = [];
  const free = (j: Id) => (at.get(j) ?? []).filter((x) => left.has(x)).length === 1;
  while (left.size) {
    const start = [...left].find((s) => free(s.a) || free(s.b)) ?? [...left][0];
    let j = free(start.a) ? start.b : start.a;
    let cur: SectionObj | undefined = start;
    while (cur) {
      out.push(cur); left.delete(cur);
      cur = (at.get(j) ?? []).find((x) => left.has(x));
      if (cur) j = cur.a === j ? cur.b : cur.a;
    }
  }
  return out;
}

/** The catalogue street template for a DP width that best matches a cross-section (the city's pack first). */
function dpTemplate(reserve: number, parts: Part[]): AssetDef | undefined {
  const city = (ui.app.tile.city ?? '').toLowerCase();
  const fits = allAssets().filter((a) => a.drawer === 'network' && a.category === 'roads' && a.profile.type === 'street' && !a.custom && Math.abs(assetWidth(a) - reserve) < 0.01);
  const own = fits.filter((a) => a.pack === city);
  const pool = own.length ? own : fits.filter((a) => a.pack === 'core');
  const n = xs.laneCount(parts).all, med = xs.hasMedian(parts);
  const score = (a: AssetDef) => (a.profile.type === 'street' ? Math.abs(xs.laneCount(a.profile.parts).all - n) + (xs.hasMedian(a.profile.parts) !== med ? 1.5 : 0) : 99);
  return pool.sort((a, b) => score(a) - score(b))[0];
}

/** A road whose sections differ: width along the road, and one click to give it a single cross-section. */
function Varies(p: { road: Id; secs: SectionObj[]; lead: SectionObj; common: { len: number; n: number }; reserve?: number }) {
  const d = ui.doc, ro = readOnly.value;
  const order = orderAlong(p.secs);
  const L = order.map((s) => Math.max(1, len(s.id)));
  const total = L.reduce((a, b) => a + b, 0);
  const W = order.map((s) => xs.totalWidth(s.parts));
  const wmax = Math.max(...W, p.reserve ?? 0);
  const leadKey = JSON.stringify(p.lead.parts);
  const widest = p.secs.reduce((a, b) => (xs.totalWidth(b.parts) > xs.totalWidth(a.parts) ? b : a));
  const tpl = p.reserve ? dpTemplate(p.reserve, p.lead.parts) : undefined;
  const uniform = (label: string, parts: Part[], asset?: string) => ui.E.edit(label, () => {
    d.set(p.road, 'parts', parts.map((q) => ({ ...q })));
    for (const s of p.secs) d.set(s.id, 'asset', asset);
  });
  let x = 0;
  return (
    <div class="varies">
      <svg class="wprof" viewBox={`0 0 ${total} 40`} preserveAspectRatio="none" role="img" aria-label="Width along the road">
        {p.reserve ? <line x1={0} x2={total} y1={40 - (p.reserve / wmax) * 36} y2={40 - (p.reserve / wmax) * 36} class="wprof-dp" vector-effect="non-scaling-stroke" /> : null}
        {order.map((s, i) => {
          const h = (W[i] / wmax) * 36, x0 = x;
          x += L[i];
          const cls = JSON.stringify(s.parts) === leadKey ? 'lead' : s.reserve && W[i] < s.reserve - 0.6 ? 'pinch' : 'other';
          return (
            <rect key={s.id} x={x0} y={40 - h} width={Math.max(0.5, L[i] - total * 0.003)} height={h} class={cls}
              onClick={() => select([{ kind: 'section', id: s.id }])}>
              <title>{`${fmtW(W[i])} m · ${xs.describe(s.parts)} · ${fmtLen(L[i])} — click to select`}</title>
            </rect>
          );
        })}
      </svg>
      <p class="small muted">Width varies along the road. Shown and edited below: the most common cross-section ({p.common.n} of {p.secs.length} sections, {fmtLen(p.common.len)}). Editing it gives every section this one.</p>
      {!ro && (
        <div class="uniform">
          <span class="small muted">Make uniform:</span>
          {tpl && tpl.profile.type === 'street' && <button class="small" title={tpl.source} onClick={() => tpl.profile.type === 'street' && uniform(`Make it ${tpl.name}`, tpl.profile.parts, tpl.id)}>{tpl.name.split(' · ')[0]} · {fmtW(assetWidth(tpl))} m</button>}
          <button class="small" onClick={() => uniform('Make uniform', p.lead.parts, p.lead.asset)}>Most common · {fmtW(xs.totalWidth(p.lead.parts))} m</button>
          {xs.totalWidth(widest.parts) > xs.totalWidth(p.lead.parts) + 0.05 && <button class="small" onClick={() => uniform('Make uniform', widest.parts, widest.asset)}>Widest · {fmtW(xs.totalWidth(widest.parts))} m</button>}
        </div>
      )}
    </div>
  );
}

/** Ground / flyover with a deck height: ramps are built at the run's ends at the set gradient. */
function LevelControls(p: { ids: Id[] }) {
  void docVersion.value; // signals make components pure: re-render on every document change
  const ro = readOnly.value;
  const d = ui.doc;
  const deck = ops.deckOf(d, p.ids);
  const up = deck > 0.25, down = deck < -0.25;
  const grade = settings.value.grade;
  const secs = p.ids.map((id) => d.get<'section'>(id)).filter((s): s is SectionObj => !!s);
  const graded = secs.filter((s) => s.grade).length;
  const stations = secs.reduce((a, s) => a + (s.grade?.z.length ?? 0), 0);
  return (
    <Section title="Level" open={up || down || graded > 0}>
      {!up && !down && (
        <>
          <Seg small value={graded === secs.length && graded ? 'graded' : graded ? 'mixed' : 'follow'} options={[
            { value: 'follow', label: 'Follow terrain', title: 'Shift+G' }, ...(graded && graded < secs.length ? [{ value: 'mixed' as const, label: 'Mixed' }] : []), { value: 'graded', label: `Graded (${ops.GRADE_STEP} m)`, title: 'G' },
          ]} onChange={(v) => {
            if (ro || v === 'mixed') return;
            if (v === 'follow') ui.E.edit('Follow terrain', () => ops.ungradeSections(d, p.ids));
            else ui.E.edit('Grade', () => ops.gradeSections(d, p.ids, (x, z) => ui.E.hf.sample(x, z) + ui.E.hf.base));
          }} />
          {graded > 0 && (
            <div class="btns">
              <button disabled={ro} title="Re-take the grade from the ground as it is now" onClick={() => ui.E.edit('Regrade', () => ops.gradeSections(d, p.ids, (x, z) => ui.E.hf.sample(x, z) + ui.E.hf.base))}>Regrade</button>
              <span class="muted small">{stations} station{stations === 1 ? '' : 's'} ≤ {ops.GRADE_STEP} m apart · drag them in the height profile (<kbd>Shift P</kbd>)</span>
            </div>
          )}
        </>
      )}
      <Seg small value={up ? 'bridge' : down ? 'tunnel' : 'ground'} options={[
        { value: 'ground', label: 'At ground', title: 'Home' }, { value: 'bridge', label: 'Flyover', title: 'Shift+PageUp' }, { value: 'tunnel', label: 'Underpass / tunnel', title: 'Shift+PageDown' },
      ]}
        onChange={(v) => { if (!ro) setDeck(ui.E, v === 'ground' ? 0 : v === 'bridge' ? Math.max(deck, ops.FLYOVER_DECK) : Math.min(deck, ops.TUNNEL_DEPTH)); }} />
      {(up || down) && (
        <div class="grid2">
          {up
            ? <NumberField label="Deck height" unit="m" value={deck} step={0.5} min={0} max={60} disabled={ro} onChange={(v, m) => setDeck(ui.E, v, m)} title="Above the ground at the highest point — PageUp / PageDown" />
            : <NumberField label="Depth" unit="m" value={-deck} step={0.5} min={0} max={40} disabled={ro} onChange={(v, m) => setDeck(ui.E, -v, m)} title={`Road surface below the ground at the lowest point — deeper than ${COVER} m is a covered tunnel, shallower an open cut`} />}
          <NumberField label="Ramp grade" unit="%" value={grade * 100} step={0.5} min={1} max={12} digits={1} disabled={ro} onChange={(v) => { saveSettings({ grade: v / 100 }); setDeck(ui.E, deck); }} title="How steeply the ramps climb (5 % ≈ 1 in 20)" />
        </div>
      )}
      <p class="muted small">{up
        ? `Ramps of about ${Math.round(deck / grade)} m at each end. Junctions under the deck stay on the ground; roads below are crossed, not joined.`
        : down
          ? `${-deck >= COVER ? 'Covered tunnel' : 'Open cut (a trench with retaining walls)'}, ramps of about ${Math.round(-deck / grade)} m at each end. Roads above are crossed, not joined; buildings above a covered tunnel stay. Press X in 3D to see it.`
          : <><kbd>Shift</kbd>+<kbd>PgUp</kbd> makes this a flyover, <kbd>Shift</kbd>+<kbd>PgDn</kbd> an underpass / tunnel, both with ramps; <kbd>PgUp</kbd>/<kbd>PgDn</kbd> step the height.</>}</p>
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
      <Tabs id="section" tabs={[
        { id: 'xs', label: 'Cross-section', body: () => (
          <>
            <WaysControls target={p.id} parts={s.parts} reserve={s.reserve} state={d.editState(p.id, 'parts')} />
            {d.editState(p.id, 'parts') === 'own' && <button class="link" disabled={ro} onClick={() => ui.E.edit('Reset width', () => d.reset(p.id, 'parts'))}>Reset to the road's cross-section</button>}
          </>
        ) },
        { id: 'shape', label: 'Shape', body: () => (
          <>
            <p class="muted">{s.path.length - 1} curve piece{s.path.length > 2 ? 's' : ''}{minR < 1e5 ? ` · tightest radius ${minR.toFixed(0)} m` : ''}</p>
            <Actions items={['road.straighten', 'road.smooth', 'road.arc', 'road.reverse']} />
            <p class="muted small">Drag the road to bend it. Double-click it (or press <kbd>A</kbd>) to edit points and curve handles.</p>
          </>
        ) },
        { id: 'asset', label: 'Catalogue', body: () => <StreetAsset ids={[p.id]} target={p.id} parts={s.parts} cls={s.cls} name={s.name || r?.name || ''} /> },
        { id: 'level', label: 'Level', body: () => <LevelControls ids={[p.id]} /> },
        { id: 'source', label: 'Source', body: () => <SectionSource id={p.id} /> },
      ]} />
      <div class="insp-foot">
        <Actions items={['road.separate', 'road.reset']} />
        <button class="icon-btn danger" title="Delete section (Del)" disabled={ro} onClick={() => run('edit.delete')}><Icon.trash size={15} /></button>
      </div>
    </div>
  );
}

function SectionSource(p: { id: Id }) {
  const d = ui.doc, ro = readOnly.value;
  const s = d.get<'section'>(p.id)!;
  return (
    <>
      <Section title="Source & accuracy">
        <Row label="Width from"><span>{({ dp: 'Development Plan sheet', osm: 'OpenStreetMap tags / defaults', user: 'Edited by hand', default: 'Default', survey: 'Survey', import: 'Import' } as Record<string, string>)[s.widthSrc ?? 'default']}</span></Row>
        {s.reserve ? <Row label="DP reserve"><span>{s.reserve} m</span></Row> : null}
        {s.wayIds.length > 0 && <Row label="OSM ways"><span class="links">{s.wayIds.slice(0, 4).map((w) => <a key={w} href={`https://www.openstreetmap.org/way/${w}`} target="_blank" rel="noreferrer">{w}</a>)}{s.wayIds.length > 4 ? ` +${s.wayIds.length - 4}` : ''}</span></Row>}
        <Toggle label="Verified on the ground / imagery" checked={!!s.verified} disabled={ro} onChange={(v) => ui.E.edit(v ? 'Verified' : 'Unverified', () => d.set(p.id, 'verified', v))} />
        <textarea class="note-input" placeholder="Notes (survey details, source, doubts…)" value={s.note ?? ''} disabled={ro} onChange={(e) => ui.E.edit('Note', () => d.set(p.id, 'note', (e.currentTarget as HTMLTextAreaElement).value || undefined))} />
      </Section>
    </>
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
      <Tabs id="junction" tabs={[
        { id: 'general', label: 'Junction', body: () => (
          <>
            <Toggle label="Traffic signals" checked={j.signals} disabled={ro} onChange={(v) => set('signals', v)} />
            <Row label="Crossings"><Seg small value={j.crossings === undefined ? 'auto' : j.crossings ? 'on' : 'off'} options={[{ value: 'auto', label: 'Auto' }, { value: 'on', label: 'Zebras' }, { value: 'off', label: 'None' }]} onChange={(v) => set('crossings', v === 'auto' ? undefined : v === 'on')} /></Row>
            <Row label="Kerb corners"><Seg small value={j.rc === undefined ? 'auto' : 'set'} options={[{ value: 'auto', label: 'Auto' }, { value: 'set', label: 'Custom' }]} onChange={(v) => set('rc', v === 'auto' ? undefined : 8)} /></Row>
            {j.rc !== undefined && <NumberField label="Corner radius" unit="m" value={j.rc} step={0.5} min={1} max={30} disabled={ro} onChange={(v, m) => set('rc', v, m)} />}
            <div class="list">{arms.map((s) => <button key={s.id} class="list-item" onClick={() => select([{ kind: 'section', id: s.id }])}><span>{s.name || 'Unnamed'}</span><span class="muted">{xs.totalWidth(s.parts).toFixed(1)} m</span></button>)}</div>
            <Actions items={['junction.dissolve']} />
          </>
        ) },
        ...(arms.length >= 3 && !j.R ? [{ id: 'signals', label: 'Signals', body: () => <SignalsTab id={p.id} /> }] : []),
        ...(arms.length >= 3 && !j.R ? [{ id: 'slips', label: 'Slip lanes', hint: j.slips?.length || undefined, body: () => <SlipsTab id={p.id} /> }] : []),
        { id: 'round', label: 'Roundabout', body: () => (
          <>
            <Toggle label="Roundabout" checked={!!j.R} disabled={ro} onChange={(v) => ui.E.edit('Roundabout', () => d.update(p.id, v ? { R: 14, ringLanes: 1 } : { R: undefined, ringLanes: undefined }))} />
            {j.R ? <div class="grid2">
              <NumberField label="Radius" unit="m" value={j.R} step={0.5} min={4} max={60} disabled={ro} onChange={(v, m) => set('R', v, m)} />
              <NumberField label="Ring lanes" value={j.ringLanes ?? 1} step={1} digits={0} min={1} max={4} disabled={ro} onChange={(v) => set('ringLanes', Math.round(v))} />
            </div> : null}
          </>
        ) },
        { id: 'pos', label: 'Position', body: () => (
          <div class="grid2">
            <NumberField label="X" unit="m" value={j.x} step={0.1} disabled={ro} onChange={(v, m) => ui.E.edit('Move junction', () => ops.moveJunction(d, p.id, v, j.z), m)} />
            <NumberField label="Z" unit="m" value={j.z} step={0.1} disabled={ro} onChange={(v, m) => ui.E.edit('Move junction', () => ops.moveJunction(d, p.id, j.x, v), m)} />
            <NumberField label="Height" unit="m" value={j.lift} step={0.5} min={-40} max={60} disabled={ro} onChange={(v, m) => set('lift', v, m)} title="Above the ground (flyover junctions); negative = below ground (underground junctions)" />
          </div>
        ) },
      ]} />
      <div class="insp-foot">
        <span />
        <button class="icon-btn danger" title="Delete junction (Del)" disabled={ro} onClick={() => run('edit.delete')}><Icon.trash size={15} /></button>
      </div>
    </div>
  );
}

/** Signals: on / off, the phase plan (which arms go together) drawn as a diagram, the phase shown in 3D. */
function SignalsTab(p: { id: Id }) {
  void docVersion.value;
  const d = ui.doc, ro = readOnly.value;
  const j = d.get<'junction'>(p.id)!;
  const set = (k: string, v: unknown) => ui.E.edit('Signals', () => d.set(p.id, k, v));
  const plan = ui.C.mesher.signalPlan(p.id);
  if (!plan) return <p class="muted small">Signals need three or more arms.</p>;
  const n = plan.arms.length, G = plan.groups.length;
  const shown = ((j.phase ?? 0) % G + G) % G;
  const green = new Set(plan.groups[shown]);
  const name = (owner?: string) => (owner && d.get<'section'>(owner)?.name) || 'arm';
  return (
    <>
      <Toggle label="Traffic signals" checked={j.signals} disabled={ro} onChange={(v) => set('signals', v)} />
      {j.signals ? (
        <>
          <Row label="Phases"><Seg small value={j.phases === undefined ? 'auto' : String(j.phases)} options={[{ value: 'auto', label: 'Auto' }, ...[2, 3, 4].filter((k) => k <= n).map((k) => ({ value: String(k), label: String(k) }))]} onChange={(v) => set('phases', v === 'auto' ? undefined : Number(v))} /></Row>
          <div class="phase-plan">
            <svg viewBox="-60 -60 120 120" class="phase-svg" role="img" aria-label="Signal phase diagram">
              <circle r="14" class="phase-hub" />
              {plan.arms.map((a, i) => {
                const on = green.has(i);
                const x = a.ux * 46, y = a.uz * 46;
                return (
                  <g key={i} class={on ? 'go' : 'stop'}>
                    <line x1={a.ux * 16} y1={a.uz * 16} x2={x} y2={y} />
                    {on && <path d={`M${a.ux * 30 - a.uz * 6},${a.uz * 30 + a.ux * 6} L${a.ux * 20},${a.uz * 20} L${a.ux * 30 + a.uz * 6},${a.uz * 30 - a.ux * 6}`} />}
                    <circle cx={x} cy={y} r="5" />
                  </g>
                );
              })}
            </svg>
            <div class="phase-list">
              {plan.groups.map((g, k) => (
                <button key={k} class={`list-item ${k === shown ? 'on' : ''}`} disabled={ro} onClick={() => set('phase', k)} title="Show this phase green in 2D / 3D">
                  <b>Phase {k + 1}</b><span class="muted small">{[...new Set(g.map((i) => name(plan.arms[i].owner)))].join(' + ')}</span>
                </button>
              ))}
            </div>
          </div>
          <p class="muted small">Arms in a phase get green together; the others are held (pedestrians cross them). The phase you pick is shown on the lights.</p>
          <Toggle label="Keep-clear box (yellow hatching)" checked={!!j.box} disabled={ro} onChange={(v) => set('box', v || undefined)} />
        </>
      ) : <p class="muted small">Turn signals on to place lights at every approach, stop lines, lane arrows and right-turn guides.</p>}
    </>
  );
}

/** Free-left slip lanes: one per corner, from an arm to the next arm round, with width and radius. */
function SlipsTab(p: { id: Id }) {
  void docVersion.value;
  const d = ui.doc, ro = readOnly.value;
  const j = d.get<'junction'>(p.id)!;
  const cands = ui.C.mesher.slipCandidates(p.id);
  const slips = j.slips ?? [];
  const name = (id: string) => d.get<'section'>(id)?.name || 'unnamed';
  const put = (next: typeof slips, label: string, merge?: string) => ui.E.edit(label, () => d.set(p.id, 'slips', next.length ? next : undefined), merge);
  const find = (c: { from: string; to: string }) => slips.findIndex((s) => s.from === c.from && s.to === c.to);
  const built = ui.C.mesher.slipsBuilt(p.id);
  if (!cands.length) return <p class="muted small">No corner here suits a slip lane (each needs two arms 35°–150° apart, at ground level).</p>;
  return (
    <>
      <p class="muted small">A free-left lane round a corner, with a raised island, a footpath along it and a give-way line where it rejoins traffic (IRC:SP:41: 4.5–5.5 m wide, 15–25 m radius).</p>
      {cands.map((c) => {
        const k = find(c), s = k >= 0 ? slips[k] : null;
        const upd = (patch: Partial<NonNullable<typeof s>>, m?: string) => put(slips.map((x, i) => (i === k ? { ...x, ...patch } : x)), 'Slip lane', m);
        return (
          <div key={c.from + c.to} class="slip-row">
            <Toggle label={`${name(c.from)} → ${name(c.to)}`} checked={!!s} disabled={ro} onChange={(v) => put(v ? [...slips, { from: c.from, to: c.to }] : slips.filter((_, i) => i !== k), v ? 'Add slip lane' : 'Remove slip lane')} />
            {s && !built.has(`${c.from}|${c.to}`) && <p class="note">Doesn't fit here: the arms are too short before the next junction, or the corner is too tight. Try a smaller radius or width.</p>}
            {s && (
              <div class="grid2">
                <NumberField label="Width" unit="m" value={s.w ?? 5} step={0.25} min={3.5} max={8} disabled={ro} onChange={(v, m) => upd({ w: v }, m)} />
                <NumberField label="Radius" unit="m" value={s.r ?? 20} step={1} min={10} max={40} disabled={ro} onChange={(v, m) => upd({ r: v }, m)} />
              </div>
            )}
          </div>
        );
      })}
    </>
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
      <p class="muted">{lineShape(l) === 'point' ? 'Placed structure' : lineShape(l) === 'area' ? `Area · ${l.pts.length / 2} corners` : `${fmtLen(length)} · ${l.pts.length / 2} points`}</p>
      {assetOf(l) && <LineAsset id={p.id} />}
      <Row label="Layer"><Select value={l.layer} options={layers.map((x) => ({ value: x.id, label: x.name }))} disabled={ro} onChange={(v) => set('layer', v)} /></Row>
      {lineShape(l) === 'route' && <><div class="grid2">
        <NumberField label={l.depth < 0 ? 'Height' : 'Depth'} unit="m" value={Math.abs(l.depth)} step={0.1} min={0} max={60} disabled={ro} onChange={(v, m) => set('depth', l.depth < 0 ? -v : v, m)} title="Below ground (pipes) / above ground (viaducts)" />
        <NumberField label={L?.group === 'underground' ? 'Diameter' : 'Width'} unit="m" value={l.size} step={0.05} digits={2} min={0.02} max={20} disabled={ro} onChange={(v, m) => set('size', v, m)} />
      </div>
      <Row label="Position"><Seg small value={l.depth < -0.5 ? 'above' : l.depth > 0.3 ? 'below' : 'ground'} options={[{ value: 'below', label: 'Underground' }, { value: 'ground', label: 'Ground' }, { value: 'above', label: 'Elevated' }]} onChange={(v) => set('depth', v === 'below' ? Math.max(1, Math.abs(l.depth)) : v === 'ground' ? 0 : -Math.max(6, Math.abs(l.depth)))} /></Row></>}
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
        <NumberField label="Height" unit="m" value={a.lift} step={0.5} min={-40} max={60} disabled={ro || end} onChange={(v, m) => setA({ lift: v }, m)} title="Height above the ground at this point (negative = below ground)" />
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

// ---------------- catalogue assets ----------------

function AssetHead(p: { a: AssetDef }) {
  const a = p.a;
  return (
    <div class="asset-head">
      <img src={thumb(a)} width={56} height={36} alt="" />
      <div>
        <b>{a.name}</b> <span class="muted">{sizeLabel(a)}</span>
        <p class="muted small">{a.source}{a.approx ? ' · some values typical' : ''}</p>
      </div>
      <button class="link small" title="Show it in the build palette" onClick={() => { revealAsset(a.id); buildOpen.value = true; }}>Palette</button>
    </div>
  );
}

/** Streets: which catalogue cross-section this is, switch to another, or save this one as your own. */
function StreetAsset(p: { ids: Id[]; target: Id; parts: Part[]; cls: string; name: string }) {
  const d = ui.doc, ro = readOnly.value;
  const first = d.get<'section'>(p.ids[0]);
  const cur = getAsset(first?.asset);
  const same = cur && p.ids.every((id) => d.get<'section'>(id)?.asset === cur.id) ? cur : undefined;
  const options = same ? allAssets().filter((a) => a.drawer === 'network' && a.category === same.category && a.tab === same.tab) : [];
  const apply = (a: AssetDef) => {
    if (a.profile.type !== 'street') return;
    const prof = a.profile;
    ui.E.edit(`Make it ${a.name}`, () => {
      d.set(p.target, 'parts', prof.parts.map((q) => ({ ...q })));
      d.set(p.target, 'cls', prof.cls);
      for (const id of p.ids) d.set(id, 'asset', a.id);
    });
  };
  const save = () => {
    const name = prompt('Name for this cross-section', `${p.name || CLASS_LABEL[p.cls] || 'Street'} ${xs.totalWidth(p.parts)} m`);
    if (!name) return;
    const a = saveCustom({ category: 'roads', tab: 'My assets', name, use: xs.describe(p.parts), drawer: 'network', profile: { type: 'street', cls: p.cls, parts: p.parts.map((q) => ({ ...q })) }, source: 'Saved from this map' });
    ui.E.edit('Asset', () => { for (const id of p.ids) d.set(id, 'asset', a.id); });
    revealAsset(a.id);
  };
  return (
    <Section title="Catalogue" open={!!same}>
      {same ? <AssetHead a={same} /> : <p class="muted small">Not from the catalogue{cur ? ' (sections differ)' : ''}. Pick one in the build palette's Replace mode, or save this cross-section.</p>}
      {same && options.length > 1 && <Row label="Type"><Select value={same.id} options={options.map((a) => ({ value: a.id, label: a.name }))} disabled={ro} onChange={(v) => { const a = getAsset(v); if (a) apply(a); }} /></Row>}
      <div class="btns"><button class="small" disabled={ro} onClick={save}>Save as asset…</button></div>
    </Section>
  );
}

/** Lines from the catalogue: the asset, and switching to another of its kind (e.g. a bigger canal, another voltage). */
function LineAsset(p: { id: Id }) {
  const d = ui.doc, ro = readOnly.value;
  const l = d.get<'line'>(p.id)!;
  const a = assetOf(l)!;
  const options = allAssets().filter((x) => x.drawer === a.drawer && x.profile.type === a.profile.type && x.category === a.category);
  return (
    <Section title="Catalogue">
      <AssetHead a={a} />
      {options.length > 1 && <Row label="Type"><Select value={a.id} options={options.map((x) => ({ value: x.id, label: `${x.name} · ${sizeLabel(x)}` }))} disabled={ro} onChange={(v) => { const x = getAsset(v); if (x) ui.E.edit(`Make it ${x.name}`, () => retypeLine(d, p.id, x)); }} /></Row>}
      {(a.rules ?? []).length > 0 && <ul class="asset-rules">{a.rules!.map((r, i) => <li key={i}>{r.note}</li>)}</ul>}
    </Section>
  );
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
