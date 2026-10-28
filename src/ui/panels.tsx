// Left panel tabs: Layers, Roads (search), Issues, Review queue.
import { useMemo, useState } from 'preact/hooks';
import { docVersion, leftTab, readOnly, select, selection } from '../editor/state';
import { ui } from './ctx';
import { Icon, Toggle, Menu } from './components';
import { CLASS_LABEL, CLASS_RANK, type Id, type LayerGroup, type LayerObj, type LineKind } from '../doc/types';
import { LINE_COLOR, LINE_LABEL } from '../doc/base';
import { newId } from '../doc/ids';
import * as xs from '../doc/xsection';
import { fmtLen } from './Inspector';

export function LeftPanel() {
  const tab = leftTab.value;
  const n = issueCount();
  return (
    <aside class="left">
      <nav class="tabs">
        <button class={tab === 'layers' ? 'on' : ''} onClick={() => (leftTab.value = 'layers')}><Icon.layers /> Layers</button>
        <button class={tab === 'roads' ? 'on' : ''} onClick={() => (leftTab.value = 'roads')}><Icon.road /> Roads</button>
        <button class={tab === 'issues' ? 'on' : ''} onClick={() => (leftTab.value = 'issues')}><Icon.warn /> Issues{n ? <span class="badge">{n > 999 ? '999+' : n}</span> : null}</button>
        <button class={tab === 'review' ? 'on' : ''} onClick={() => (leftTab.value = 'review')}><Icon.review /> Review</button>
      </nav>
      <div class="tab-body">
        {tab === 'layers' && <Layers />}
        {tab === 'roads' && <Roads />}
        {tab === 'issues' && <Issues />}
        {tab === 'review' && <Review />}
      </div>
    </aside>
  );
}

function issueCount() { void docVersion.value; return ui.issues.byKey.size; }

// ---------------- layers ----------------

const GROUPS: { id: LayerGroup; label: string }[] = [
  { id: 'reference', label: 'Reference' }, { id: 'surface', label: 'Surface' }, { id: 'elevated', label: 'Elevated' }, { id: 'underground', label: 'Underground' },
];

function Layers() {
  void docVersion.value;
  const layers = ui.doc.all('layer').sort((a, b) => a.order - b.order);
  const ro = readOnly.value;
  const addLayer = (kind: LineKind) => {
    const id = newId('layer');
    ui.E.edit('New layer', () => ui.doc.create({ kind: 'layer', id, name: LINE_LABEL[kind], group: kind === 'metro' ? 'elevated' : kind === 'rail' || kind === 'path' ? 'surface' : 'underground', type: 'lines', lineKind: kind, visible: true, locked: false, opacity: 1, color: LINE_COLOR[kind], order: 100 + layers.length } as LayerObj));
    ui.app.setLineLayer(id);
  };
  return (
    <div class="layers">
      {GROUPS.map((g) => {
        const list = layers.filter((l) => l.group === g.id);
        if (!list.length && g.id !== 'underground') return null;
        return (
          <div key={g.id} class="lgroup">
            <div class="lgroup-head">{g.label}{g.id === 'underground' && <span class="muted small"> · X-ray in 3D</span>}</div>
            {list.map((l) => <LayerRow key={l.id} l={l} />)}
            {g.id === 'underground' && !list.length && <p class="muted small pad">No utility data yet — import some (see README) or draw lines with <kbd>L</kbd>.</p>}
          </div>
        );
      })}
      {!ro && (
        <Menu label={<><Icon.plus size={14} /> New line layer</>} class="small block" items={(['water', 'sewer', 'storm', 'power', 'gas', 'telecom', 'metro', 'rail', 'other'] as LineKind[]).map((k) => ({ label: LINE_LABEL[k], run: () => addLayer(k) }))} />
      )}
    </div>
  );
}

function LayerRow(p: { l: LayerObj }) {
  void docVersion.value;
  const l = p.l;
  const [open, setOpen] = useState(false);
  const count = l.type === 'lines' ? ui.doc.linesOf(l.id).length : l.type === 'buildings' ? ui.doc.ids('building').size : l.type === 'roads' ? ui.doc.ids('section').size : null;
  // layer visibility is a view setting: no undo step, but saved with the map
  const set = (k: keyof LayerObj, v: unknown) => ui.app.setLayer(l.id, k, v);
  return (
    <div class={`layer ${l.visible ? '' : 'off'}`}>
      <div class="layer-row" onClick={() => setOpen(!open)}>
        <button class="icon-btn" title={l.visible ? 'Hide' : 'Show'} onClick={(e) => { e.stopPropagation(); set('visible', !l.visible); }}>{l.visible ? <Icon.eye size={14} /> : <Icon.eyeOff size={14} />}</button>
        {l.color && <span class="swatch" style={{ background: l.color }} />}
        <span class="layer-name">{l.name}</span>
        {count !== null && <span class="muted small">{count.toLocaleString()}</span>}
        <button class="icon-btn" title={l.locked ? 'Unlock' : 'Lock (stop selecting)'} onClick={(e) => { e.stopPropagation(); set('locked', !l.locked); }}>{l.locked ? <Icon.lock size={14} /> : <Icon.unlock size={14} />}</button>
      </div>
      {open && (
        <div class="layer-more">
          <label class="range">Opacity <input type="range" min={0.1} max={1} step={0.05} value={l.opacity} onInput={(e) => set('opacity', Number((e.currentTarget as HTMLInputElement).value))} /></label>
          {l.type === 'xyz' && <input class="text" placeholder="https://…/{z}/{x}/{y}.png" value={l.url ?? ''} onChange={(e) => set('url', (e.currentTarget as HTMLInputElement).value.trim())} />}
          {l.type === 'xyz' && <p class="muted small">Only use imagery you have the rights to use.</p>}
          {l.type === 'lines' && <button class="link" onClick={() => ui.app.setLineLayer(l.id)}>Draw into this layer (L)</button>}
          {l.source && <p class="muted small">{l.source}{l.license ? ` · ${l.license}` : ''}</p>}
        </div>
      )}
    </div>
  );
}

// ---------------- roads ----------------

function Roads() {
  void docVersion.value;
  const [q, setQ] = useState('');
  const [cls, setCls] = useState('all');
  const rows = useMemo(() => {
    const out: { id: Id; name: string; cls: string; len: number; n: number; w: number }[] = [];
    for (const r of ui.doc.all('road')) {
      const secs = ui.doc.sectionsOf(r.id);
      if (!secs.length) continue;
      const name = r.name || secs[0].name;
      if (!name && !q.startsWith('#')) continue;
      let len = 0, w = 0;
      for (const s of secs) { const L = ui.C.geo(s.id)?.len ?? 0; len += L; w += xs.totalWidth(s.parts) * L; }
      out.push({ id: r.id, name: name || 'Unnamed', cls: secs[0].cls, len, n: secs.length, w: len ? w / len : 0 });
    }
    return out;
  }, [docVersion.value, q.startsWith('#')]);
  const ql = q.toLowerCase().replace(/^#/, '');
  const list = rows.filter((r) => (!ql || r.name.toLowerCase().includes(ql)) && (cls === 'all' || r.cls === cls))
    .sort((a, b) => (CLASS_RANK[a.cls] ?? 9) - (CLASS_RANK[b.cls] ?? 9) || b.len - a.len).slice(0, 300);
  const sel = new Set(selection.value.map((s) => s.id));
  return (
    <div class="roads">
      <div class="search"><Icon.search size={14} /><input placeholder="Find a road…" value={q} onInput={(e) => setQ((e.currentTarget as HTMLInputElement).value)} /></div>
      <select class="select" value={cls} onChange={(e) => setCls((e.currentTarget as HTMLSelectElement).value)}>
        <option value="all">All classes</option>
        {Object.entries(CLASS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <div class="list">
        {list.map((r) => (
          <button key={r.id} class={`list-item ${sel.has(r.id) ? 'on' : ''}`} onClick={() => { select([{ kind: 'road', id: r.id }]); ui.E.zoomToSelection(); }}>
            <span class="clip">{r.name}</span>
            <span class="muted small">{CLASS_LABEL[r.cls] ?? r.cls} · {r.w.toFixed(0)} m · {fmtLen(r.len)}</span>
          </button>
        ))}
        {!list.length && <p class="muted pad">No named roads match. Type # to include unnamed ones.</p>}
      </div>
    </div>
  );
}

// ---------------- issues ----------------

function Issues() {
  void docVersion.value;
  const [filter, setFilter] = useState<'all' | 'error' | 'warn' | 'info'>('all');
  const all = ui.issues.list();
  const list = all.filter((i) => filter === 'all' || i.sev === filter);
  const counts = { error: all.filter((i) => i.sev === 'error').length, warn: all.filter((i) => i.sev === 'warn').length, info: all.filter((i) => i.sev === 'info').length };
  const orphans = ui.issues.orphans;
  return (
    <div class="issues">
      <div class="btns">
        <button onClick={() => { ui.app.checkAll(); }}>Check whole map</button>
        <Toggle label="Markers" checked={ui.E.markers.length > 0} onChange={(v) => { ui.app.showMarkers(v); }} />
      </div>
      <div class="seg small">
        {(['all', 'error', 'warn', 'info'] as const).map((f) => <button key={f} class={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f === 'all' ? `All ${all.length}` : f === 'error' ? `Errors ${counts.error}` : f === 'warn' ? `Warnings ${counts.warn}` : `Notes ${counts.info}`}</button>)}
      </div>
      {orphans.length > 0 && (
        <div class="orphans">
          <b>{orphans.length} edit(s) from the opened map no longer match the base map.</b>
          <p class="muted small">The importer changed these roads. The edits are kept in the file; re-apply them by hand if needed.</p>
        </div>
      )}
      <div class="list">
        {list.slice(0, 400).map((i) => (
          <button key={i.key} class={`list-item issue ${i.sev}`} onClick={() => { select(i.ids.filter((id) => ui.doc.get(id)).map((id) => ({ kind: ui.doc.get(id)!.kind, id }))); ui.E.zoomTo([i.x - 60, i.z - 60, i.x + 60, i.z + 60]); }}>
            <span class={`sev ${i.sev}`} />
            <span class="clip"><b>{i.title}</b><br /><span class="muted small">{i.detail}</span></span>
          </button>
        ))}
        {!list.length && <p class="muted pad">{ui.issues.version ? 'Nothing to fix here.' : 'Press “Check whole map” — after that, edits are re-checked as you go.'}</p>}
      </div>
    </div>
  );
}

// ---------------- review queue ----------------

function Review() {
  void docVersion.value;
  const q = ui.app.reviewQueue();
  const total = ui.doc.ids('section').size;
  const verified = ui.doc.all('section').filter((s) => s.verified).length;
  return (
    <div class="review">
      <p>Walk through the roads most likely to be wrong — biggest roads first, then the ones whose width disagrees with the Development Plan. Check each against the DP sheet (<kbd>D</kbd>) and fix or confirm it.</p>
      <div class="progress"><div style={{ width: `${(verified / Math.max(1, total)) * 100}%` }} /></div>
      <p class="muted small">{verified.toLocaleString()} of {total.toLocaleString()} sections verified</p>
      <div class="btns"><button class="primary" onClick={() => ui.app.reviewNext()}>Next road <kbd>N</kbd></button><button onClick={() => { const c = ui.E.selectedSections(); if (c.length) ui.E.edit('Verified', () => { for (const s of c) ui.doc.set(s.id, 'verified', true); }); ui.app.reviewNext(); }}>Looks right <kbd>Y</kbd></button></div>
      <div class="list">
        {q.slice(0, 60).map((r) => (
          <button key={r.id} class="list-item" onClick={() => { select([{ kind: 'section', id: r.id }]); ui.E.zoomToSelection(); }}>
            <span class="clip">{r.name}</span><span class="muted small">{r.why}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
