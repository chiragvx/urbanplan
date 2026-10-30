// The map's frame, Cities: Skylines style: info views and help in the top corners, the bottom bar (the map, the build
// categories, the tools, the view, publish) with a status strip under it, a hint that follows the cursor, the
// command palette, toasts and the read-only banner.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  cursor, dialog, docVersion, dpRegionsOn, terrainView, mode, paletteOpen, pointer, readOnly, selection, stale3d, status, toasts, tool, xray, zoomScale, accuracyView, select, osmCompare,
} from '../editor/state';
import { COMMANDS, type Command } from '../editor/commands';
import { ui } from './ctx';
import { Icon, Menu, prettyKeys } from './components';
import { CLASS_LABEL } from '../doc/types';
import { allAssets, CATEGORIES, sizeLabel, type Category } from '../assets';
import { buildCat, buildOpen } from '../editor/state';
import { paletteVisible, revealAsset } from './BuildPalette';
import { dark, toggleTheme } from './theme';
import { fmtVol } from '../editor/terraintool';
import type { Tool } from '../editor/state';

type IconFn = (p: { size?: number }) => preact.JSX.Element;

const cmd = (id: string) => COMMANDS.find((c) => c.id === id)!;
const item = (id: string) => { const c = cmd(id); return { label: c.label, keys: c.keys, run: () => c.run(ui.E), disabled: c.enabled ? !c.enabled(ui.E) : false }; };

// ---------------- info views (top left) ----------------

/** What can be laid over the map. One at a time (clicking another swaps it in); Shift-click stacks them. */
const VIEWS: { id: string; label: string; title: string; icon: IconFn; on: () => boolean; run: () => void }[] = [
  { id: 'dp', label: 'DP sheets', title: 'Development Plan sheets (D)', icon: Icon.sheet, on: () => !!ui.doc.get<'layer'>('dp')?.visible, run: () => ui.app.toggleLayer('dp') },
  { id: 'regions', label: 'DP regions', title: 'DP regions: land use and reserved sites traced from the DP sheets — hover a region to read it (Shift+D)', icon: Icon.regions, on: () => dpRegionsOn.value, run: () => cmd('view.dpregions').run(ui.E) },
  { id: 'terrain', label: 'Terrain', title: 'Terrain: heights, contours, cut & fill (Shift+T)', icon: Icon.terrain, on: () => terrainView.value, run: () => cmd('view.terrain').run(ui.E) },
  { id: 'accuracy', label: 'Accuracy', title: 'Accuracy: roads coloured by where their width comes from (Shift+A)', icon: Icon.target, on: () => accuracyView.value, run: () => cmd('view.accuracy').run(ui.E) },
  { id: 'satellite', label: 'Satellite', title: 'Satellite imagery (Layers › Satellite: source, as the ground, ghost roads, nudge)', icon: Icon.satellite, on: () => !!ui.doc.get<'layer'>('satellite')?.visible, run: () => ui.app.toggleLayer('satellite') },
  { id: 'osm', label: 'OSM lines', title: 'OpenStreetMap: its road lines over the map, and where ours drift off them (Issues)', icon: Icon.osm, on: () => osmCompare.value, run: () => void ui.app.toggleOsmCompare() },
  { id: 'xray', label: 'X-ray', title: 'X-ray: see underground in 3D (X)', icon: Icon.xray, on: () => xray.value, run: () => cmd('view.xray').run(ui.E) },
];

function pickView(v: typeof VIEWS[number], stack: boolean) {
  if (!stack && !v.on()) for (const o of VIEWS) if (o !== v && o.on()) o.run();
  v.run();
}

/** The top corners of the map: info views (left), help and settings (right). */
export function MapCorners() {
  void docVersion.value;
  const on = VIEWS.filter((v) => v.on());
  return (
    <>
      <div class="corner corner-tl" onPointerDown={(e) => e.stopPropagation()}>
        {VIEWS.map((v) => (
          <button key={v.id} class={`sq ${v.on() ? 'on' : ''}`} aria-label={v.label} aria-pressed={v.on()} title={`${v.title} — Shift-click to show it with others`} onClick={(e) => pickView(v, e.shiftKey)}>
            <v.icon size={17} />
          </button>
        ))}
        {on.length > 0 && <span class="corner-label">{on.map((v) => v.label).join(' + ')}</span>}
      </div>
      <div class="corner corner-tr" onPointerDown={(e) => e.stopPropagation()}>
        <button class="sq" aria-label={dark.value ? 'Light theme' : 'Dark theme'} title={`${dark.value ? 'Light' : 'Dark'} theme`} onClick={toggleTheme}>{dark.value ? <Icon.sun size={17} /> : <Icon.moon size={17} />}</button>
        <button class="sq" aria-label="Help" title="Help and keyboard shortcuts (?)" onClick={() => { dialog.value = 'help'; }}><Icon.help size={17} /></button>
        <button class="sq" aria-label="Settings" title="Settings" onClick={() => { dialog.value = 'settings'; }}><Icon.gear size={17} /></button>
      </div>
    </>
  );
}

// ---------------- bottom bar ----------------

const TOOLS: { t: Tool; icon: IconFn; label: string; key: string }[] = [
  { t: 'select', icon: Icon.select, label: 'Select & bend', key: 'V' },
  { t: 'direct', icon: Icon.direct, label: 'Edit points', key: 'A' },
  { t: 'knife', icon: Icon.knife, label: 'Split / join', key: 'K' },
  { t: 'multi', icon: Icon.multi, label: 'Road tools: junctions, intersect, arrange, slope, loop, parallel, curve, flyover', key: 'J' },
  { t: 'bulldoze', icon: Icon.bulldoze, label: 'Bulldozer', key: 'B' },
];
const EDIT_TOOLS = ['pen', 'knife', 'line', 'direct', 'bulldoze', 'wand', 'terrain', 'multi'];
const DRAW_TOOLS = ['pen', 'route', 'place', 'area'];
const SURVEY_TOOLS: Tool[] = ['measure', 'line', 'wand'];

/** New roads (km), edited objects, earthworks: the running tally of the plan. */
function useTally() {
  const v = docVersion.value;
  return useMemo(() => {
    let km = 0;
    for (const [id, e] of ui.doc.patch) if (e.add && ui.doc.get(id)?.kind === 'section') km += (ui.C.geo(id)?.len ?? 0) / 1000;
    const T = ui.E.terrain;
    return { km, cut: T.cut, fill: T.fill };
  }, [v]);
}

/** The bottom bar (Cities: Skylines' main strip) and the status strip under it. */
export function Dock() {
  void docVersion.value;
  const ro = readOnly.value;
  const d = ui.doc;
  const dirty = d.version !== d.savedVersion;
  const c = cursor.value;
  const ll = c ? ui.app.toLatLon(c[0], c[1]) : null;
  const sel = selection.value;
  const buildOn = paletteVisible();
  const t = tool.value;
  const tally = useTally();
  const [name, setName] = useState<string | null>(null);
  const openCat = (id: Category) => {
    if (buildOn && buildCat.value === id) { buildOpen.value = false; if (DRAW_TOOLS.includes(t)) ui.E.setTool('select'); return; }
    buildCat.value = id; buildOpen.value = true;
  };
  const toolBtn = (x: typeof TOOLS[number]) => (
    <button key={x.t} class={`bb-btn ${t === x.t ? 'on' : ''}`} aria-label={x.label} title={`${x.label} (${x.key})`} disabled={ro && EDIT_TOOLS.includes(x.t)} onClick={() => ui.E.setTool(x.t)}>
      <x.icon size={19} />
    </button>
  );
  const survey = SURVEY_TOOLS.includes(t);
  return (
    <footer class="dock" onPointerDown={(e) => e.stopPropagation()}>
      <div class="bar">
        <div class="mapcard">
          <Menu class="logo-menu" title="Map: new, open, save, export, publish" label={<span class="logo-badge" aria-label="Map menu">UP</span>} items={[
            item('file.new'), item('file.open'), 'sep', item('file.save'), item('file.saveas'), item('file.download'), 'sep', item('file.export'), item('file.publish'), 'sep', item('file.settings'), item('help.keys'), item('help.about'),
          ]} />
          <div class="mapcard-text">
            <input class="map-name" value={name ?? d.meta.name} disabled={ro} aria-label="Map name"
              onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)}
              onBlur={() => { if (name !== null) { ui.app.rename(name.trim() || 'Untitled map'); setName(null); } }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); }} />
            <span class="mapcard-sub">{tally.km >= 0.01 ? `${tally.km.toFixed(2)} km new road · ` : ''}{d.editCount} edit{d.editCount === 1 ? '' : 's'}</span>
          </div>
        </div>
        <button class="bb-btn" aria-label="Undo" title={`Undo ${d.undoLabel ?? ''} (${prettyKeys('Ctrl+Z')})`} disabled={!d.canUndo || ro} onClick={() => d.undo()}><Icon.undo size={18} /></button>
        <button class="bb-btn" aria-label="Redo" title={`Redo ${d.redoLabel ?? ''} (${prettyKeys('Ctrl+Shift+Z')})`} disabled={!d.canRedo || ro} onClick={() => d.redo()}><Icon.redo size={18} /></button>
        <span class="spacer" />
        <div class="bb-cats" title="Build (O)">
          {CATEGORIES.map((k) => (
            <button key={k.id} class={`bb-cat ${buildOn && buildCat.value === k.id ? 'on' : ''}`} aria-label={k.label} title={`${k.label} (O)`} disabled={ro} onClick={() => openCat(k.id)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={k.icon} /></svg>
            </button>
          ))}
          <button class={`bb-cat ${t === 'terrain' ? 'on' : ''}`} aria-label="Terrain" title="Terrain: raise, level, soften, slope, pads, ponds (T)" disabled={ro} onClick={() => ui.E.setTool(t === 'terrain' ? 'select' : 'terrain')}><Icon.terrain size={21} /></button>
          <Menu class={`bb-menu ${survey ? 'on' : ''}`} title="Survey tools: measure, draw a line, trace a DP plot" label={<Icon.survey size={21} />} items={[
            { label: 'Measure', keys: 'M', run: () => ui.E.setTool('measure') },
            { label: 'Draw a line (utilities, rail)', keys: 'L', run: () => ui.E.setTool('line'), disabled: ro },
            { label: 'Trace a DP plot as a survey region', keys: 'W', run: () => ui.E.setTool('wand'), disabled: ro },
          ]} />
        </div>
        <span class="spacer" />
        <div class="bb-tools">{TOOLS.map(toolBtn)}</div>
        <button class="bb-btn" aria-label="Search and commands" title="Search roads, places, things to build, commands (Ctrl+K)" onClick={() => { paletteOpen.value = true; }}><Icon.search size={18} /></button>
        <div class="seg bb-mode">
          <button class={mode.value === '2d' ? 'on' : ''} onClick={() => ui.E.setMode('2d')} title="2D plan (Tab)">2D</button>
          <button class={mode.value === '3d' ? 'on' : ''} onClick={() => ui.E.setMode('3d')} title="3D view (Tab)">3D{stale3d.value && mode.value === '2d' ? <i class="dot own" title="3D refreshes when opened" /> : null}</button>
        </div>
        {ro
          ? <button class="primary" onClick={() => ui.app.fork()}>Edit a copy</button>
          : <button class="primary publish" onClick={() => { dialog.value = 'publish'; }}><Icon.share size={14} /> <span class="tb-label">Publish</span></button>}
      </div>
      <div class="status">
        <span class={`saved ${dirty ? 'dirty' : ''}`} title={dirty ? 'Unsaved changes (autosaved in this browser)' : 'Saved'}>{ro ? 'View only' : dirty ? '● Unsaved' : '✓ Saved'}</span>
        <span class="st-msg" title={status.value}>{status.value}</span>
        <span class="spacer" />
        {sel.length > 0 && <span>{sel.length} selected</span>}
        {(tally.cut > 0.5 || tally.fill > 0.5) && <span title="Earthworks against the original ground">cut {fmtVol(tally.cut)} · fill {fmtVol(tally.fill)}</span>}
        {c && <span class="mono muted" title="Metres from the map centre (x east, z south) · latitude, longitude">{c[0].toFixed(0)}, {c[1].toFixed(0)} m · {ll![0].toFixed(5)}, {ll![1].toFixed(5)}</span>}
        {mode.value === '2d' && <span class="mono muted">{zoomScale.value >= 1 ? `${zoomScale.value.toFixed(1)} px/m` : `1 px = ${(1 / zoomScale.value).toFixed(1)} m`}</span>}
      </div>
    </footer>
  );
}

// ---------------- the hint at the cursor ----------------

const HINT_TOOLS = ['pen', 'route', 'place', 'area', 'line', 'measure', 'multi', 'terrain', 'knife', 'bulldoze', 'wand', 'direct'];

/** While a tool is in use, its next step follows the cursor (the status strip keeps it too). */
export function CursorHint() {
  const p = pointer.value, msg = status.value;
  if (!p || !msg || !HINT_TOOLS.includes(tool.value)) return null;
  const [x, y] = p;
  // the next step only: the first part or two of the tool's hint (the status strip has all of it)
  const parts = msg.split(' · ');
  const short = parts.slice(0, parts[0].length < 28 && parts.length > 1 ? 2 : 1).join(' · ');
  return <div class="cursor-hint" style={{ left: `${x + 18}px`, top: `${y + 20}px` }}>{short}</div>;
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
