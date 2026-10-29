// Top bar (file menu, tools, view switches), status bar, command palette, toasts, read-only banner.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  cursor, dialog, docVersion, lineLayer, mode, paletteOpen, readOnly, selection, stale3d, status, toasts, tool, xray, zoomScale, accuracyView, select,
} from '../editor/state';
import { COMMANDS, type Command } from '../editor/commands';
import { ui } from './ctx';
import { Icon, Menu, prettyKeys } from './components';
import { CLASS_LABEL } from '../doc/types';
import type { Tool } from '../editor/state';

const TOOLS: { t: Tool; icon: (p: { size?: number }) => preact.JSX.Element; label: string; key: string }[] = [
  { t: 'select', icon: Icon.select, label: 'Select & bend', key: 'V' },
  { t: 'direct', icon: Icon.direct, label: 'Edit points', key: 'A' },
  { t: 'pen', icon: Icon.pen, label: 'Draw road', key: 'P' },
  { t: 'knife', icon: Icon.knife, label: 'Split / join', key: 'K' },
  { t: 'line', icon: Icon.line, label: 'Draw line (utilities, rail)', key: 'L' },
  { t: 'measure', icon: Icon.measure, label: 'Measure', key: 'M' },
  { t: 'hand', icon: Icon.hand, label: 'Pan', key: 'H' },
  { t: 'bulldoze', icon: Icon.bulldoze, label: 'Bulldozer', key: 'B' },
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
        <Menu class="logo-menu" label={<span class="logo">Pune<span>Remix</span></span>} items={[
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
      <div class="tb-tools">
        {TOOLS.map((x) => (
          <button key={x.t} class={`tool ${tool.value === x.t ? 'on' : ''}`} title={`${x.label} (${x.key})`} disabled={mode.value === '3d' && x.t !== 'select' || (ro && ['pen', 'knife', 'line', 'direct', 'bulldoze'].includes(x.t))} onClick={() => ui.E.setTool(x.t)}>
            <x.icon />
          </button>
        ))}
        {tool.value === 'line' && (
          <select class="select tool-opt" value={lineLayer.value} title="Layer to draw into" onChange={(e) => { lineLayer.value = (e.currentTarget as HTMLSelectElement).value; }}>
            <option value="">Choose layer…</option>
            {ui.doc.all('layer').filter((l) => l.type === 'lines').map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        )}
      </div>
      <div class="tb-right">
        <button class={`chip ${accuracyView.value ? 'on' : ''}`} title="Accuracy view: colour roads by where their width comes from (Shift+A)" onClick={() => cmd('view.accuracy').run(ui.E)}>Accuracy</button>
        <button class={`chip ${ui.doc.get<'layer'>('dp')?.visible ? 'on' : ''}`} title="Development Plan sheets (D)" onClick={() => ui.app.toggleLayer('dp')}>DP</button>
        <div class="seg">
          <button class={mode.value === '2d' ? 'on' : ''} onClick={() => ui.E.setMode('2d')} title="2D plan (Tab)"><Icon.map /> 2D</button>
          <button class={mode.value === '3d' ? 'on' : ''} onClick={() => ui.E.setMode('3d')} title="3D view (Tab)"><Icon.cube /> 3D{stale3d.value && mode.value === '2d' ? <i class="dot own" title="3D refreshes when opened" /> : null}</button>
        </div>
        <button class={`icon-btn ${xray.value ? 'on' : ''}`} title="X-ray: see underground layers in 3D (X)" onClick={() => cmd('view.xray').run(ui.E)}><Icon.xray /></button>
        <button class="icon-btn" title="Commands (Ctrl+K)" onClick={() => { paletteOpen.value = true; }}><Icon.search /></button>
        <button class="icon-btn" title="Help (?)" onClick={() => { dialog.value = 'help'; }}><Icon.help /></button>
        {ro
          ? <button class="primary" onClick={() => ui.app.fork()}>Edit a copy</button>
          : <button class="primary" onClick={() => { dialog.value = 'publish'; }}><Icon.share size={14} /> Publish</button>}
      </div>
    </header>
  );
}

export function StatusBar() {
  void docVersion.value;
  const c = cursor.value;
  const ll = c ? ui.app.toLatLon(c[0], c[1]) : null;
  const sel = selection.value;
  return (
    <footer class="statusbar">
      <span class="st-msg">{status.value}</span>
      <span class="spacer" />
      {sel.length > 0 && <span>{sel.length} selected</span>}
      {c && <span class="mono" title="Metres from the tile centre (x east, z south) · latitude, longitude">{c[0].toFixed(1)}, {c[1].toFixed(1)} m · {ll![0].toFixed(5)}, {ll![1].toFixed(5)}</span>}
      {mode.value === '2d' && <span class="mono">{zoomScale.value >= 1 ? `${zoomScale.value.toFixed(1)} px/m` : `1 px = ${(1 / zoomScale.value).toFixed(1)} m`}</span>}
      <span>{ui.doc.editCount} edits</span>
    </footer>
  );
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
  const coord = /^(-?\d+(\.\d+)?)\s*[, ]\s*(-?\d+(\.\d+)?)$/.exec(q.trim());
  const extra = coord ? [{ label: `Go to ${coord[1]}, ${coord[3]}`, hint: Math.abs(Number(coord[1])) < 90 ? 'lat, lon' : 'x, z metres', run: () => ui.app.goTo(Number(coord[1]), Number(coord[3])) }] : [];
  const all = [...extra, ...roadHits, ...cmds].slice(0, 40);
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
