// The panel for 2+ selected objects (Figma's mixed values, the iD editor's multi-select). One block per kind — roads,
// junctions, assets, plots — each opening with its summary as a filter: a bar per width (roads) or type (the rest);
// click keeps only those, Alt-click drops them. Roads are edited with the road picker (values that differ show as
// Mixed); ] / [ step each road and keep their differences, the DP icon sets each to its own DP width. Shared actions
// (verify, zoom, delete) are icons at the bottom. Changes to 2+ objects wait in the preview bar until applied.
import type { ComponentChildren } from 'preact';
import { boxKinds, docVersion, readOnly, select, selection, type Sel } from '../editor/state';
import { COMMANDS } from '../editor/commands';
import { totalWidth } from '../doc/xsection';
import { assetOf } from '../assets';
import { leadOf } from '../editor/smartsel';
import type { Id, JunctionObj, SectionObj } from '../doc/types';
import { RoadPicker } from './RoadPicker';
import { ui } from './ctx';
import './bulk.css';

// ---------------- icons (24 px, stroke) ----------------

const D: Record<string, string> = {
  narrow: 'M4 12h6M7 9l3 3-3 3M20 12h-6M17 9l-3 3 3 3',
  widen: 'M10 12H4M7 9l-3 3 3 3M14 12h6M17 9l3 3-3 3',
  dp: 'M4 5h16M4 19h16M7 5v14M17 5v14',
  check: 'M4 12l5 5 11-11',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  zoom: 'M11 17a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM20 20l-4.5-4.5M8.5 11h5M11 8.5v5',
  similar: 'M3 5h7v14H3zM14 5h7v14h-7zM11.5 12h1',
  street: 'M2 14h20M7 4h10v6H7zM12 10v4',
  route: 'M5 16a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM19 4a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM7 18h5a3 3 0 0 0 0-6h-1a3 3 0 0 1 0-6h6',
  signals: 'M9 2h6a1 1 0 0 1 1 1v15a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM12 6.5h.01M12 10.5h.01M12 14.5h.01M12 19v3',
  roundabout: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 2v6M12 16v6M2 12h6M16 12h6',
  road: 'M6 21L10 3M18 21L14 3M12 6v2M12 11v2M12 16v2',
  junction: 'M12 2v20M2 12h20M12 12h.01',
  asset: 'M3 20h18M5 20V9l7-5 7 5v11M9 20v-6h6v6',
  plot: 'M3 5l15-2 3 15-16 3zM8 16V9h6v7',
  deselect: 'M6 6l12 12M18 6L6 18',
};
function Ico(p: { d: string; size?: number }) {
  const s = p.size ?? 18;
  return <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={p.d} /></svg>;
}

const cmd = (id: string) => COMMANDS.find((c) => c.id === id)!;
const can = (id: string) => { const c = cmd(id); return !c.enabled || c.enabled(ui.E); };
const run = (id: string) => { const c = cmd(id); if (!c.enabled || c.enabled(ui.E)) c.run(ui.E); };

/** An icon button: name and key in the hover card; a count badge when mixed. */
function IcoBtn(p: { d: string; name: string; keys?: string; on?: boolean; mixed?: number; flag?: string; danger?: boolean; disabled?: boolean; onClick: () => void }) {
  const title = `${p.name}${p.keys ? ` (${p.keys})` : ''}${p.mixed ? ` · on ${p.mixed}` : ''}${p.flag ? ` · ${p.flag}` : ''}`;
  return (
    <button class={`mp-ico ${p.on ? 'on' : ''} ${p.mixed ? 'mixed' : ''} ${p.danger ? 'danger' : ''}`} title={title} aria-label={p.name} aria-pressed={p.on ?? undefined} disabled={p.disabled} onClick={p.onClick}>
      <Ico d={p.d} />
      {p.mixed ? <span class="mp-count">{p.mixed}</span> : null}
      {p.flag ? <span class="mp-dot" /> : null}
    </button>
  );
}

// ---------------- the summary as a filter ----------------

interface Bucket { key: string; label: string; sels: Sel[]; sort: number }

/** One bar per width / type: click keeps only those, Alt-click drops them. */
function Bars(p: { buckets: Bucket[]; unit: string }) {
  const B = [...p.buckets].sort((a, b) => a.sort - b.sort || a.label.localeCompare(b.label));
  if (B.length < 2 && B[0]?.sels.length === selection.value.length) return null;
  const max = Math.max(...B.map((b) => b.sels.length));
  const keep = (b: Bucket, drop: boolean) => {
    const ids = new Set(b.sels.map((s) => s.id));
    select(drop ? selection.value.filter((s) => !ids.has(s.id)) : b.sels);
  };
  return (
    <div class="mp-bars" role="group" aria-label={`By ${p.unit}`}>
      {B.slice(0, 12).map((b) => (
        <button key={b.key} class="mp-bar" title={`${b.label}: ${b.sels.length} — click to keep only these, Alt-click to drop them`} aria-label={`${b.label}, ${b.sels.length}`}
          onClick={(e) => keep(b, e.altKey)}>
          <span>{b.label}</span>
          <span class="mp-track"><span class="mp-fill" style={{ width: `${(b.sels.length / max) * 100}%` }} /></span>
          <span class="mp-n">{b.sels.length}</span>
        </button>
      ))}
      {B.length > 12 && <span class="mp-hint">+{B.length - 12} more</span>}
    </div>
  );
}

function bucketize(sels: Sel[], keyOf: (s: Sel) => { key: string; label: string; sort?: number }): Bucket[] {
  const m = new Map<string, Bucket>();
  for (const s of sels) {
    const k = keyOf(s);
    const b = m.get(k.key) ?? m.set(k.key, { key: k.key, label: k.label, sels: [], sort: k.sort ?? 0 }).get(k.key)!;
    b.sels.push(s);
  }
  return [...m.values()];
}

function Block(p: { icon: string; title: string; sub?: string; children?: ComponentChildren }) {
  return (
    <div class="mp-block">
      <div class="mp-block-head"><Ico d={D[p.icon]} size={16} /><b>{p.title}</b>{p.sub && <span class="muted">{p.sub}</span>}</div>
      {p.children}
    </div>
  );
}

const fmtLen = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);
const plural = (n: number, w: string) => `${n.toLocaleString('en-IN')} ${w}${n === 1 ? '' : 's'}`;

// ---------------- blocks ----------------

function RoadsBlock(p: { sels: Sel[] }) {
  const d = ui.doc, ro = readOnly.value;
  const secOf = (s: Sel): SectionObj | undefined => (s.kind === 'road' ? leadOf(ui.E, s.id) : d.get<'section'>(s.id));
  let len = 0;
  const secs: SectionObj[] = [];
  for (const s of p.sels) {
    const list = s.kind === 'road' ? d.sectionsOf(s.id) : [d.get<'section'>(s.id)].filter(Boolean) as SectionObj[];
    for (const x of list) { secs.push(x); len += ui.C.geo(x.id)?.len ?? 0; }
  }
  const buckets = bucketize(p.sels, (s) => { const w = secOf(s) ? Math.round(totalWidth(secOf(s)!.parts) * 2) / 2 : 0; return { key: String(w), label: `${w} m`, sort: w }; });
  const hasDP = secs.some((s) => s.reserve);
  const verified = secs.filter((s) => s.verified).length;
  const ids: Id[] = p.sels.map((s) => s.id);
  return (
    <Block icon="road" title={plural(p.sels.length, p.sels.every((s) => s.kind === 'section') ? 'section' : 'road')} sub={fmtLen(len)}>
      <Bars buckets={buckets} unit="width" />
      <RoadPicker mode="edit" ids={ids} />
      <div class="mp-icons" role="toolbar" aria-label="Each road">
        <IcoBtn d={D.narrow} name="Narrow each by 0.5 m, keeping their differences" keys="[" disabled={ro} onClick={() => run('road.narrow')} />
        <IcoBtn d={D.widen} name="Widen each by 0.5 m, keeping their differences" keys="]" disabled={ro} onClick={() => run('road.widen')} />
        <IcoBtn d={D.dp} name="Each to its own Development Plan width" disabled={ro || !hasDP} onClick={() => run('road.dp')} />
        <IcoBtn d={D.check} name={verified === secs.length ? 'Verified — click to clear' : 'Mark as verified'} keys="Y" on={verified === secs.length} mixed={verified && verified < secs.length ? verified : undefined} disabled={ro} onClick={() => run('road.verify')} />
        <span style={{ flex: 1 }} />
        <IcoBtn d={D.similar} name="Select similar: same type and width" keys="Shift+S" onClick={() => run('select.similar')} />
        <IcoBtn d={D.street} name="Select the whole street, across junctions" keys="Shift+W" onClick={() => run('select.street')} />
        <IcoBtn d={D.route} name="Select along a route: click its two ends" keys="Shift+R" onClick={() => run('select.route')} />
      </div>
    </Block>
  );
}

function JunctionsBlock(p: { sels: Sel[] }) {
  const d = ui.doc, ro = readOnly.value;
  const js = p.sels.map((s) => d.get<'junction'>(s.id)).filter(Boolean) as JunctionObj[];
  const sig = js.filter((j) => j.signals).length, rb = js.filter((j) => j.R).length, n = js.length;
  const buckets = bucketize(p.sels, (s) => { const k = d.sectionsAt(s.id).length; return { key: String(k), label: k === 1 ? 'dead end' : `${k}-way`, sort: k }; });
  return (
    <Block icon="junction" title={plural(n, 'junction')}>
      <Bars buckets={buckets} unit="arms" />
      <div class="mp-icons" role="toolbar" aria-label="Each junction">
        <IcoBtn d={D.signals} name={sig === n ? 'Signals — click to take them off' : 'Signals on all'} on={sig === n} mixed={sig && sig < n ? sig : undefined} disabled={ro} onClick={() => run('junction.signals')} />
        <IcoBtn d={D.roundabout} name={rb === n ? 'Roundabouts — click to take them off' : 'Make them roundabouts'} on={rb === n} mixed={rb && rb < n ? rb : undefined} disabled={ro} onClick={() => run('junction.roundabout')} />
        <span style={{ flex: 1 }} />
        <IcoBtn d={D.similar} name="Select similar junctions" keys="Shift+S" onClick={() => run('select.similar')} />
        {n === 2 && <IcoBtn d={D.route} name="Select the route between these two" keys="Shift+R" onClick={() => run('select.route')} />}
      </div>
    </Block>
  );
}

function AssetsBlock(p: { sels: Sel[] }) {
  const d = ui.doc;
  const buckets = bucketize(p.sels, (s) => {
    const l = d.get<'line'>(s.id);
    const a = l ? assetOf(l) : undefined;
    const name = a?.name ?? (l ? d.get<'layer'>(l.layer)?.name ?? 'Line' : 'Line');
    return { key: a?.id ?? l?.layer ?? '?', label: name };
  });
  return (
    <Block icon="asset" title={plural(p.sels.length, 'asset')}>
      <Bars buckets={buckets} unit="type" />
      <div class="mp-icons"><IcoBtn d={D.similar} name="Select all of these types" keys="Shift+S" onClick={() => run('select.similar')} /></div>
    </Block>
  );
}

function PlotsBlock(p: { sels: Sel[] }) {
  const d = ui.doc;
  let area = 0;
  for (const s of p.sels) {
    const r = d.get<'plot'>(s.id)?.ring ?? [];
    let a = 0;
    for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; a += r[i] * r[j + 1] - r[j] * r[i + 1]; }
    area += Math.abs(a) / 2;
  }
  const buckets = bucketize(p.sels, (s) => { const u = String(d.get<'plot'>(s.id)?.use ?? 'none'); return { key: u, label: u === 'none' ? 'No use yet' : u[0].toUpperCase() + u.slice(1) }; });
  return (
    <Block icon="plot" title={plural(p.sels.length, 'plot')} sub={`${Math.round(area).toLocaleString('en-IN')} m²`}>
      <Bars buckets={buckets} unit="use" />
      <div class="mp-icons"><IcoBtn d={D.similar} name="Select plots with the same use" keys="Shift+S" onClick={() => run('select.similar')} /></div>
    </Block>
  );
}

/** What a box select picks up: roads, junctions, assets, plots. */
function BoxToggles() {
  const k = boxKinds.value;
  const items = [['roads', D.road, 'Roads'], ['junctions', D.junction, 'Junctions'], ['assets', D.asset, 'Assets'], ['plots', D.plot, 'Plots']] as const;
  return (
    <div class="mp-box" role="group" aria-label="Box select picks up">
      {items.map(([id, d, name]) => (
        <button key={id} class={k[id] ? 'on' : ''} aria-pressed={k[id]} aria-label={`Box select: ${name}`} title={`Box select picks up ${name.toLowerCase()}: ${k[id] ? 'on' : 'off'}`}
          onClick={() => { boxKinds.value = { ...k, [id]: !k[id] }; }}>
          <Ico d={d} size={15} />
        </button>
      ))}
    </div>
  );
}

// ---------------- the panel ----------------

export function MultiPanel() {
  void docVersion.value; // signals make components pure: re-render on every document change
  const sel = selection.value, ro = readOnly.value;
  const roads = sel.filter((s) => s.kind === 'road' || s.kind === 'section');
  const juncs = sel.filter((s) => s.kind === 'junction');
  const lines = sel.filter((s) => s.kind === 'line');
  const plots = sel.filter((s) => s.kind === 'plot');
  const rest = sel.filter((s) => !['road', 'section', 'junction', 'line', 'plot'].includes(s.kind));
  const restCounts = new Map<string, number>();
  for (const s of rest) restCounts.set(s.kind, (restCounts.get(s.kind) ?? 0) + 1);
  return (
    <div class="insp mp">
      <div class="mp-head">
        <div class="insp-kind">{plural(sel.length, 'object')} selected</div>
        <BoxToggles />
      </div>
      {ro && <div class="mp-ro">View only · Make a copy to edit (selection, filters and the summary still work)</div>}
      {roads.length > 0 && <RoadsBlock sels={roads} />}
      {juncs.length > 0 && <JunctionsBlock sels={juncs} />}
      {lines.length > 0 && <AssetsBlock sels={lines} />}
      {plots.length > 0 && <PlotsBlock sels={plots} />}
      {rest.length > 0 && (
        <div class="mp-block"><div class="mp-block-head"><b>{[...restCounts].map(([k, n]) => plural(n, k)).join(' · ')}</b></div></div>
      )}
      <div class="mp-icons mp-shared" role="toolbar" aria-label="Selection">
        <IcoBtn d={D.zoom} name="Zoom to the selection" keys="Shift+2" onClick={() => ui.E.zoomToSelection()} />
        <IcoBtn d={D.deselect} name="Deselect" keys="Esc" onClick={() => select([])} />
        <span style={{ flex: 1 }} />
        <IcoBtn d={D.trash} name="Delete" keys="Delete" danger disabled={ro || !can('edit.delete')} onClick={() => run('edit.delete')} />
      </div>
    </div>
  );
}
