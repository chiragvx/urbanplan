// Top bar (file menu, tools, view switches), status bar, command palette, toasts, read-only banner.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  cursor, dialog, docVersion, dpRegionsOn, terrainView, lineLayer, mode, paletteOpen, readOnly, selection, stale3d, status, toasts, tool, xray, zoomScale, accuracyView, select, osmCompare,
} from '../editor/state';
import { COMMANDS, type Command } from '../editor/commands';
import { ui } from './ctx';
import { Icon, Menu, prettyKeys } from './components';
import { CLASS_LABEL } from '../doc/types';
import { allAssets, CATEGORIES, sizeLabel, type Category } from '../assets';
import { buildCat, buildOpen } from '../editor/state';
import { paletteVisible, revealAsset } from './BuildPalette';
import { dark, toggleTheme } from './theme';
import type { Tool } from '../editor/state';

const TOOLS: { t: Tool; icon: (p: { size?: number }) => preact.JSX.Element; label: string; key: string }[] = [
  { t: 'select', icon: Icon.select, label: 'Select & bend', key: 'V' },
  { t: 'direct', icon: Icon.direct, label: 'Edit points', key: 'A' },
  { t: 'pen', icon: Icon.pen, label: 'Draw road', key: 'P' },
  { t: 'knife', icon: Icon.knife, label: 'Split / join', key: 'K' },
  { t: 'multi', icon: Icon.multi, label: 'Road tools: junctions, intersect, lock, arrange, slope, loop, connection, parallel, curve', key: 'J' },
  { t: 'line', icon: Icon.line, label: 'Draw line (utilities, rail)', key: 'L' },
  { t: 'measure', icon: Icon.measure, label: 'Measure', key: 'M' },
  { t: 'hand', icon: Icon.hand, label: 'Pan', key: 'H' },
  { t: 'bulldoze', icon: Icon.bulldoze, label: 'Bulldozer', key: 'B' },
  { t: 'wand', icon: Icon.wand, label: 'Fill: trace a DP plot as a survey region', key: 'W' },
  { t: 'terrain', icon: Icon.terrain, label: 'Terrain: raise, level, soften, slope, pads, ponds', key: 'T' },
];

const cmd = (id: string) => COMMANDS.find((c) => c.id === id)!;
const item = (id: string) => { const c = cmd(id); return { label: c.label, keys: c.keys, run: () => c.run(ui.E), disabled: c.enabled ? !c.enabled(ui.E) : false }; };

export function TopBar() {
  void docVersion.value;
  const d = ui.doc;
  const dirty = d.version !== d.savedVersion;
  const ro = readOnly.value;
  const [name, setName] = useState<string | null>(null);
  return (
    <header class="topbar">
      <div class="tb-left">
        <Menu class="logo-menu" label={<span class="logo">Urban<span>Plan</span></span>} items={[
          item('file.new'), item('file.open'), 'sep', item('file.save'), item('file.saveas'), item('file.download'), 'sep', item('file.export'), item('file.publish'), 'sep', item('file.settings'), item('help.keys'), item('help.about'),
        ]} />
        <input class="map-name" value={name ?? d.meta.name} disabled={ro} title="Map name"
          onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
          onBlur={() => { if (name !== null) { ui.app.rename(name.trim() || 'Untitled map'); setName(null); } }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }} />
        <span class={`saved ${dirty ? 'dirty' : ''}`} title={dirty ? 'Unsaved changes (autosaved in this browser)' : 'Saved'}>{ro ? 'View only' : dirty ? '●' : '✓'}</span>
        <button class="icon-btn" title={`Undo ${d.undoLabel ?? ''} (${prettyKeys('Ctrl+Z')})`} disabled={!d.canUndo || ro} onClick={() => d.undo()}><Icon.undo /></button>
        <button class="icon-btn" title={`Redo ${d.redoLabel ?? ''} (${prettyKeys('Ctrl+Shift+Z')})`} disabled={!d.canRedo || ro} onClick={() => d.redo()}><Icon.redo /></button>
      </div>
      <div class="tb-views">
        <div class="seg">
          <button class={mode.value === '2d' ? 'on' : ''} onClick={() => ui.E.setMode('2d')} title="2D plan (Tab)"><Icon.map /> 2D</button>
          <button class={mode.value === '3d' ? 'on' : ''} onClick={() => ui.E.setMode('3d')} title="3D view (Tab)"><Icon.cube /> 3D{stale3d.value && mode.value === '2d' ? <i class="dot own" title="3D refreshes when opened" /> : null}</button>
        </div>
        <div class="tb-chips">
          {VIEWS.map((v) => <button key={v.id} class={`chip ${v.on() ? 'on' : ''}`} title={v.title} onClick={v.run}>{v.icon ? <v.icon size={14} /> : null}{v.label}</button>)}
        </div>
        <Menu class="tb-viewmenu" label={<><Icon.layers size={14} /> View</>} items={[...VIEWS.map((v) => ({ label: `${v.on() ? '✓ ' : ''}${v.label}`, run: v.run })), 'sep', { label: dark.value ? 'Light theme' : 'Dark theme', run: toggleTheme }]} />
      </div>
      <div class="tb-right">
        <button class="icon-btn" title={`${dark.value ? 'Light' : 'Dark'} theme`} onClick={toggleTheme}>{dark.value ? <Icon.sun /> : <Icon.moon />}</button>
        <button class="icon-btn" title="Commands (Ctrl+K)" onClick={() => { paletteOpen.value = true; }}><Icon.search /></button>
        <button class="icon-btn" title="Help (?)" onClick={() => { dialog.value = 'help'; }}><Icon.help /></button>
        {ro
          ? <button class="primary" onClick={() => ui.app.fork()}>Edit a copy</button>
          : <button class="primary" onClick={() => { dialog.value = 'publish'; }}><Icon.share size={14} /> <span class="tb-label">Publish</span></button>}
      </div>
    </header>
  );
}

/** View switches (top bar chips; a "View" menu on narrow screens). */
const VIEWS: { id: string; label: string; title: string; icon?: (p: { size?: number }) => preact.JSX.Element; on: () => boolean; run: () => void }[] = [
  { id: 'dp', label: 'DP', title: 'Development Plan sheets (D)', on: () => !!ui.doc.get<'layer'>('dp')?.visible, run: () => ui.app.toggleLayer('dp') },
  { id: 'regions', label: 'DP regions', title: 'DP regions: land use and reserved sites traced from the DP sheets — hover a region to read it (Shift+D)', on: () => dpRegionsOn.value, run: () => cmd('view.dpregions').run(ui.E) },
  { id: 'terrain', label: 'Terrain', title: 'Terrain view: heights, contours, cut & fill (Shift+T)', on: () => terrainView.value, run: () => cmd('view.terrain').run(ui.E) },
  { id: 'accuracy', label: 'Accuracy', title: 'Accuracy view: colour roads by where their width comes from (Shift+A)', on: () => accuracyView.value, run: () => cmd('view.accuracy').run(ui.E) },
  { id: 'satellite', label: 'Satellite', title: 'Satellite imagery (Layers › Satellite: source, as the ground, ghost roads, nudge)', on: () => !!ui.doc.get<'layer'>('satellite')?.visible, run: () => ui.app.toggleLayer('satellite') },
  { id: 'osm', label: 'OSM lines', title: 'Compare with OpenStreetMap: its road lines over the map, and where ours drift off them (Issues)', on: () => osmCompare.value, run: () => void ui.app.toggleOsmCompare() },
  { id: 'xray', label: 'X-ray', title: 'X-ray: see underground layers in 3D (X)', icon: Icon.xray, on: () => xray.value, run: () => cmd('view.xray').run(ui.E) },
];

const EDIT_TOOLS = ['pen', 'knife', 'line', 'direct', 'bulldoze', 'wand', 'terrain', 'multi'];

/** The bottom toolbar (Cities: Skylines' main strip): tools, the build categories, and the status line. */
export function Dock() {
  void docVersion.value;
  const ro = readOnly.value;
  const c = cursor.value;
  const ll = c ? ui.app.toLatLon(c[0], c[1]) : null;
  const sel = selection.value;
  const buildOn = paletteVisible();
  const group = (ts: Tool[]) => TOOLS.filter((x) => ts.includes(x.t)).map((x) => (
    <button key={x.t} class={`dk-tool ${tool.value === x.t ? 'on' : ''}`} title={`${x.label} (${x.key})`} disabled={ro && EDIT_TOOLS.includes(x.t)} onClick={() => ui.E.setTool(x.t)}>
      <x.icon size={18} />
    </button>
  ));
  const openCat = (id: Category) => {
    if (buildOn && buildCat.value === id) { buildOpen.value = false; if (['pen', 'route', 'place', 'area'].includes(tool.value)) ui.E.setTool('select'); return; }
    buildCat.value = id; buildOpen.value = true;
  };
  return (
    <footer class="dock" onPointerDown={(e) => e.stopPropagation()}>
      <div class="dk-group">{group(['select', 'direct', 'knife', 'multi', 'bulldoze'])}</div>
      <div class="dk-group">{group(['measure', 'hand'])}</div>
      <div class="dk-group">{group(['pen', 'line', 'wand', 'terrain'])}</div>
      {tool.value === 'line' && (
        <select class="select dk-opt" value={lineLayer.value} title="Layer to draw into" onChange={(e) => { lineLayer.value = (e.currentTarget as HTMLSelectElement).value; }}>
          <option value="">Choose layer…</option>
          {ui.doc.all('layer').filter((l) => l.type === 'lines').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
      )}
      <div class="dk-cats" title="Build (O)">
        {CATEGORIES.map((k) => (
          <button key={k.id} class={`dk-cat ${buildOn && buildCat.value === k.id ? 'on' : ''}`} title={`${k.label} (O)`} disabled={ro} onClick={() => openCat(k.id)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d={k.icon} /></svg>
            <span>{k.label}</span>
          </button>
        ))}
      </div>
      <div class="dk-status">
        <span class="st-msg" title={status.value}>{status.value}</span>
        <span class="st-facts">
          {sel.length > 0 && <span>{sel.length} selected</span>}
          {c && <span class="mono" title="Metres from the tile centre (x east, z south) · latitude, longitude">{c[0].toFixed(0)}, {c[1].toFixed(0)} m · {ll![0].toFixed(5)}, {ll![1].toFixed(5)}</span>}
          {mode.value === '2d' && <span class="mono">{zoomScale.value >= 1 ? `${zoomScale.value.toFixed(1)} px/m` : `1 px = ${(1 / zoomScale.value).toFixed(1)} m`}</span>}
          <span>{ui.doc.editCount} edits</span>
        </span>
      </div>
    </footer>
  );
}

/** Credits of the imagery on screen (2D), bottom right of the map. */
export function Attribution() {
  void docVersion.value;
  if (mode.value !== '2d') return null;
  const credits = ui.doc.all('layer').filter((l) => l.type === 'xyz' && l.visible && l.url && l.source).map((l) => l.source!);
  if (!credits.length) return null;
  return <div class="attribution">{[...new Set(credits)].join(' · ')}</div>;
}

export function ReadOnlyBanner() {
  if (!readOnly.value) return null;
  const m = ui.doc.meta;
  return (
    <div class="banner">
      Viewing <b>{m.name}</b>{m.author ? <> by <b>{m.author}</b></> : null}{m.description ? ` — ${m.description}` : ''}
      <button class="primary" onClick={() => ui.app.fork()}>Edit a copy</button>
    </div>
  );
}

export function Toasts() {
  return (
    <div class="toasts">
      {toasts.value.map((t) => (
        <div key={t.id} class={`toast ${t.kind}`}>{t.text}{t.action && <button onClick={t.action.run}>{t.action.label}</button>}</div>
      ))}
    </div>
  );
}

// ---------------- command palette ----------------

export function Palette() {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const open = paletteOpen.value;
  useEffect(() => { if (open) { setQ(''); setI(0); setTimeout(() => ref.current?.focus(), 0); } }, [open]);
  const roads = useMemo(() => (open ? ui.doc.all('road').filter((r) => r.name).map((r) => r) : []), [open]);
  if (!open) return null;
  const ql = q.trim().toLowerCase();
  const seen = new Set<string>();
  const cmds: { label: string; hint?: string; run: () => void }[] = COMMANDS
    .filter((c: Command) => !seen.has(c.label) && seen.add(c.label) && (!c.enabled || c.enabled(ui.E)) && (!ql || `${c.group} ${c.label}`.toLowerCase().includes(ql)))
    .map((c) => ({ label: `${c.group}: ${c.label}`, hint: c.keys && prettyKeys(c.keys), run: () => c.run(ui.E) }));
  const roadHits = ql.length >= 2 ? roads.filter((r) => r.name.toLowerCase().includes(ql)).slice(0, 8).map((r) => ({ label: `Go to ${r.name}`, hint: CLASS_LABEL[r.cls], run: () => { select([{ kind: 'road', id: r.id }]); ui.E.zoomToSelection(); } })) : [];
  // catalogue assets: "18 m", "BRT", "220 kV", "canal"
  const assetHits = ql.length >= 2 && !readOnly.value ? allAssets().filter((a) => `${a.name} ${a.tab} ${sizeLabel(a)} ${a.use ?? ''}`.toLowerCase().includes(ql)).slice(0, 10)
    .map((a) => ({ label: `Build: ${a.name}`, hint: sizeLabel(a), run: () => { revealAsset(a.id); ui.E.useAsset(a.id); } })) : [];
  const coord = /^(-?\d+(\.\d+)?)\s*[, ]\s*(-?\d+(\.\d+)?)$/.exec(q.trim());
  const extra = coord ? [{ label: `Go to ${coord[1]}, ${coord[3]}`, hint: Math.abs(Number(coord[1])) < 90 ? 'lat, lon' : 'x, z metres', run: () => ui.app.goTo(Number(coord[1]), Number(coord[3])) }] : [];
  const all = [...extra, ...roadHits, ...assetHits, ...cmds].slice(0, 40);
  const close = () => { paletteOpen.value = false; };
  const go = (k: number) => { const it = all[k]; close(); it?.run(); };
  return (
    <div class="palette-bg" onClick={close}>
      <div class="palette" onClick={(e) => e.stopPropagation()}>
        <div class="search"><Icon.search size={14} />
          <input ref={ref} placeholder="Type a command, a road name, or coordinates…" value={q}
            onInput={(e) => { setQ((e.currentTarget as HTMLInputElement).value); setI(0); }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
              if (e.key === 'ArrowDown') { e.preventDefault(); setI(Math.min(all.length - 1, i + 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setI(Math.max(0, i - 1)); }
              if (e.key === 'Enter') go(i);
            }} />
        </div>
        <div class="palette-list">
          {all.map((c, k) => <button key={c.label} class={k === i ? 'on' : ''} onMouseEnter={() => setI(k)} onClick={() => go(k)}><span>{c.label}</span>{c.hint && <kbd>{c.hint}</kbd>}</button>)}
          {!all.length && <p class="muted pad">Nothing matches.</p>}
        </div>
      </div>
    </div>
  );
}
