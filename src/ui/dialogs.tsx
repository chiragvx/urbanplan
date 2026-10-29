// Dialogs: open, publish, export, settings, help, about. Plus the height profile drawer.
import { useEffect, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { dialog, docVersion, profileOpen, readOnly, saveSettings, selection, settings } from '../editor/state';
import { ui } from './ctx';
import { Icon, Seg, Toggle, prettyKeys } from './components';
import { COMMANDS } from '../editor/commands';
import { gallery, local, repo, type LocalMap, type Published, type RepoMap } from '../app/storage';
import { anchorsOf, samplePath } from '../doc/ops';

function Modal(p: { title: string; children: ComponentChildren; wide?: boolean }) {
  return (
    <div class="modal-bg" onClick={() => { dialog.value = null; }}>
      <div class={`modal ${p.wide ? 'wide' : ''}`} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.key === 'Escape' && (dialog.value = null)}>
        <header><h2>{p.title}</h2><button class="icon-btn" onClick={() => { dialog.value = null; }}><Icon.close /></button></header>
        <div class="modal-body">{p.children}</div>
      </div>
    </div>
  );
}

export function Dialogs() {
  switch (dialog.value) {
    case 'open': return <OpenDialog />;
    case 'publish': return <PublishDialog />;
    case 'export': return <ExportDialog />;
    case 'settings': return <SettingsDialog />;
    case 'help': return <HelpDialog />;
    case 'about': return <AboutDialog />;
    default: return null;
  }
}

function when(iso: string) { const d = new Date(iso); return isNaN(+d) ? '' : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }); }

function OpenDialog() {
  const [mine, setMine] = useState<LocalMap[]>([]);
  const [files, setFiles] = useState<RepoMap[]>([]);
  const [pub, setPub] = useState<Published[]>([]);
  const [url, setUrl] = useState('');
  useEffect(() => { local.list().then(setMine); gallery().then(setPub); if (repo.available) repo.list().then(setFiles).catch(() => {}); }, []);
  return (
    <Modal title="Open a map" wide>
      <div class="open-grid">
        <div>
          <h4>In this browser</h4>
          <div class="list">
            {mine.map((m) => (
              <div key={m.meta.id} class="list-item">
                <button class="grow" onClick={() => ui.app.openLocal(m.meta.id)}><b>{m.meta.name}</b><span class="muted small">{m.edits} edits · {when(m.savedAt)}</span></button>
                <button class="icon-btn" title="Forget this map" onClick={async () => { if (confirm(`Remove “${m.meta.name}” from this browser?`)) { await local.remove(m.meta.id); setMine(await local.list()); } }}><Icon.trash size={13} /></button>
              </div>
            ))}
            {!mine.length && <p class="muted small">Nothing saved here yet.</p>}
          </div>
          {repo.available && <>
            <h4>In the project (maps/)</h4>
            <div class="list">
              {files.map((f) => <button key={f.file} class="list-item" onClick={() => ui.app.openRepo(f.file)}><b>{f.name}</b><span class="muted small">{f.file} · {f.edits} edits</span></button>)}
              {!files.length && <p class="muted small">No map files yet — Save puts them here.</p>}
            </div>
          </>}
        </div>
        <div>
          <h4>Published maps</h4>
          <div class="list">
            {pub.map((m) => <button key={m.file} class="list-item" onClick={() => ui.app.openUrl(`${import.meta.env.BASE_URL}maps/${m.file}`, true)}><b>{m.name}</b><span class="muted small">{m.author ? `by ${m.author} · ` : ''}{m.edits} edits{m.description ? ` · ${m.description}` : ''}</span></button>)}
            {!pub.length && <p class="muted small">None published on this site yet.</p>}
          </div>
          <h4>From a file or link</h4>
          <div class="btns"><button onClick={() => ui.app.openFile()}>Choose a .punemap.json file…</button></div>
          <div class="row-inline"><input class="text" placeholder="https://…/my-map.punemap.json" value={url} onInput={(e) => setUrl((e.currentTarget as HTMLInputElement).value)} /><button disabled={!url} onClick={() => ui.app.openUrl(url, true)}>Open</button></div>
          <p class="muted small">You can also drop a map file anywhere on the window.</p>
          <div class="btns"><button onClick={() => ui.app.newMap()}>Start a new map from the base</button></div>
        </div>
      </div>
    </Modal>
  );
}

function PublishDialog() {
  void docVersion.value;
  const m = ui.doc.meta;
  const [name, setName] = useState(m.name);
  const [author, setAuthor] = useState(m.author || settings.value.author);
  const [desc, setDesc] = useState(m.description);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const apply = () => ui.app.setMeta({ name: name.trim() || 'Untitled map', author: author.trim(), description: desc.trim() });
  return (
    <Modal title="Publish your map">
      <p>Publishing shares your edits as a small map file. Anyone can open it on top of the same base map, look around in 2D and 3D, and make their own copy to edit.</p>
      <label class="field">Map name<input class="text" value={name} onInput={(e) => setName((e.currentTarget as HTMLInputElement).value)} /></label>
      <label class="field">Your name<input class="text" value={author} onInput={(e) => setAuthor((e.currentTarget as HTMLInputElement).value)} /></label>
      <label class="field">What did you change?<textarea class="text" rows={3} value={desc} onInput={(e) => setDesc((e.currentTarget as HTMLTextAreaElement).value)} placeholder="e.g. Corrected widths of Koregaon Park lanes from the DP sheets; added the planned riverside road." /></label>
      <p class="muted small">{ui.doc.editCount} edited objects. The base data is © OpenStreetMap contributors (ODbL) — a published map built on it is shared under the ODbL too, with that attribution. Development Plan widths come from PMC's public sheets.</p>
      {done && <div class="ok-box">{done}</div>}
      <div class="btns">
        {repo.available && <button class="primary" disabled={busy} onClick={async () => { setBusy(true); apply(); try { setDone(await ui.app.publishToSite()); } finally { setBusy(false); } }}>Publish to this site's gallery</button>}
        <button class={repo.available ? '' : 'primary'} onClick={() => { apply(); ui.app.download(); setDone('Downloaded. Share the file anywhere (GitHub, a gist, email) — people open it with Open → From a file or link, or with ?map=<link> in the address.'); }}>Download map file</button>
        <button onClick={() => { apply(); ui.app.copyLink(); }}>Copy link to hosted file…</button>
      </div>
      {repo.available && <p class="muted small">“Publish to this site” copies the map into <code>public/maps/</code> and lists it in the gallery. Run <code>npm run build</code> and upload <code>dist/</code> to any static host (GitHub Pages, Netlify, Cloudflare Pages) — the site opens published maps read-only with an “Edit a copy” button.</p>}
    </Modal>
  );
}

function ExportDialog() {
  const [bld, setBld] = useState(false);
  return (
    <Modal title="Export">
      <div class="export-list">
        <div><b>GeoJSON</b><p class="muted small">Roads (with widths, lanes, cross-sections), junctions and visible line layers in WGS84 — opens in QGIS, geojson.io, JOSM.</p><Toggle label="Include buildings" checked={bld} onChange={setBld} /><button onClick={() => ui.app.exportGeoJSON(bld)}>Download .geojson</button></div>
        <div><b>Network (network.json)</b><p class="muted small">The edited road network in the bake format, for the offline tools (junction audit, DP measurement).</p><button onClick={() => ui.app.exportNetwork()}>Download network.json</button></div>
        <div><b>Map file</b><p class="muted small">Just your edits (.punemap.json): small, diff-friendly, re-applies on top of newer base data.</p><button onClick={() => ui.app.download()}>Download .punemap.json</button></div>
      </div>
    </Modal>
  );
}

function SettingsDialog() {
  const s = settings.value;
  return (
    <Modal title="Settings">
      <label class="field">Your name (for published maps)<input class="text" value={s.author} onInput={(e) => saveSettings({ author: (e.currentTarget as HTMLInputElement).value })} /></label>
      <div class="field">Mouse wheel<Seg value={s.wheel} options={[{ value: 'zoom', label: 'Zooms' }, { value: 'pan', label: 'Pans (Ctrl zooms)' }]} onChange={(v) => saveSettings({ wheel: v })} /></div>
      <Toggle label="Snapping (S)" checked={s.snap} onChange={(v) => saveSettings({ snap: v })} />
      <Toggle label="Snap to junctions and roads at the same level" checked={s.snapGeometry} onChange={(v) => saveSettings({ snapGeometry: v })} />
      <Toggle label="Snap to 90° / 45° from the road you start on" checked={s.snapAngles} onChange={(v) => saveSettings({ snapAngles: v })} />
      <Toggle label="Snap to guide lines from road ends" checked={s.snapGuides} onChange={(v) => saveSettings({ snapGuides: v })} />
      <label class="field">Flyover ramp gradient (%)<input class="text" type="number" min={1} max={12} step={0.5} value={s.grade * 100} onChange={(e) => saveSettings({ grade: Math.max(0.01, Math.min(0.12, Number((e.currentTarget as HTMLInputElement).value) / 100)) })} /></label>
    </Modal>
  );
}

function HelpDialog() {
  const groups = ['Tools', 'Edit', 'Road', 'Junction', 'View', 'Review', 'File'] as const;
  const seen = new Set<string>();
  return (
    <Modal title="How it works" wide>
      <div class="help">
        <div>
          <h4>Basics</h4>
          <ul>
            <li><b>Click</b> a road: selects the whole road. <b>Double-click</b>: one section (junction to junction). <b>Esc</b> steps back out.</li>
            <li><b>Drag a road</b> to bend it. <b>Drag a junction</b> to move it — drop it on another junction or road to connect.</li>
            <li><b>Width</b>: drag the □ handles (Alt = one side), scrub the Width label, or press <kbd>[</kbd> <kbd>]</kbd>. Widths snap to the Development Plan sizes.</li>
            <li>Road-level edits apply to every section of the road; a section's own edit wins (blue dot). Purple dot = inherited from the road.</li>
            <li><kbd>P</kbd> is the road tool, as in Cities: Skylines: <kbd>1</kbd> straight · <kbd>2</kbd> simple curve · <kbd>3</kbd> complex curve · <kbd>4</kbd> continuous · <kbd>5</kbd> freeform pen · <kbd>6</kbd> replace. Each click builds a stretch and carries on; right-click steps back.</li>
            <li><b>Bridges</b>: <kbd>PgUp</kbd>/<kbd>PgDn</kbd> set the height while drawing — crossings at the same level become junctions, higher ones pass over. With a road selected, <kbd>Shift</kbd>+<kbd>PgUp</kbd> makes it a flyover with ramps; <kbd>Shift</kbd>+<kbd>PgDn</kbd> brings it down.</li>
            <li><b>Snapping</b>: junctions, roads at your level, 90° / 45° to the road you start from, guide lines from road ends, round lengths. <kbd>Shift</kbd> = 15° steps, hold <kbd>Ctrl</kbd> to skip, <kbd>S</kbd> toggles. <kbd>B</kbd> bulldozes; <kbd>K</kbd> splits a road so part of it can differ.</li>
            <li><kbd>Tab</kbd> flips between 2D and 3D. <kbd>X</kbd> x-ray shows pipes underground. <kbd>D</kbd> shows the DP sheets underneath.</li>
            <li>Everything is undoable. Your work autosaves in this browser; <b>Save</b> writes a <code>.punemap.json</code> file.</li>
            <li>In the browser console, <code>city</code> scripts the same edits: <code>city.roads(&#123; name: /Nagar/ &#125;).width(30)</code> — try <code>city.help()</code>.</li>
          </ul>
        </div>
        <div class="keys">
          {groups.map((g) => (
            <div key={g}><h4>{g}</h4>
              {COMMANDS.filter((c) => c.group === g && c.keys && !seen.has(c.label) && seen.add(c.label)).map((c) => <div key={c.id} class="key-row"><span>{c.label}</span><kbd>{prettyKeys(c.keys!)}</kbd></div>)}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function AboutDialog() {
  return (
    <Modal title="About Pune Remix">
      <p>A Cities: Skylines-style editor for a more accurate map of Pune. Illustrative — not engineering advice.</p>
      <ul class="sources">
        <li>Roads, buildings, rail: © OpenStreetMap contributors, ODbL.</li>
        <li>Terrain: Copernicus DEM GLO-30 © DLR / Airbus (EU / ESA).</li>
        <li>Road reserve widths and DP sheets: Pune Municipal Corporation, sanctioned Development Plan (public sheets).</li>
        <li>Sewer, stormwater and nalla lines: Pune Municipal Corporation via OpenCity (public domain).</li>
      </ul>
    </Modal>
  );
}

// ---------------- height profile ----------------

export function Profile() {
  void docVersion.value;
  if (!profileOpen.value) return null;
  const s0 = selection.value.find((s) => s.kind === 'section' || s.kind === 'road');
  const secs = s0 ? (s0.kind === 'road' ? ui.doc.sectionsOf(s0.id) : [ui.doc.get<'section'>(s0.id)!]).filter(Boolean) : [];
  const sec = secs.sort((a, b) => (ui.C.geo(b.id)?.len ?? 0) - (ui.C.geo(a.id)?.len ?? 0))[0];
  return (
    <div class="profile">
      <header><b>Height profile</b><span class="muted small">{sec ? `${sec.name || 'Unnamed'} — terrain (brown) and road surface (blue)` : 'Select a road'}</span><span class="spacer" /><button class="icon-btn" onClick={() => { profileOpen.value = false; }}><Icon.close /></button></header>
      {sec && <ProfileChart id={sec.id} />}
    </div>
  );
}

function ProfileChart(p: { id: string }) {
  void docVersion.value;
  const s = ui.doc.get<'section'>(p.id)!;
  const P = anchorsOf(ui.doc, s);
  const S = samplePath(P, 24);
  const hf = ui.E.hf;
  const ground = S.pts.map(([x, z]) => hf.sample(x, z) + hf.base);
  const road = S.pts.map(([x, z], i) => hf.sample(x, z) + hf.base + S.lift[i]);
  const lo = Math.min(...ground) - 2, hi = Math.max(...road, ...ground) + 3;
  const W = 900, H = 150, L = S.len || 1;
  const X = (sv: number) => (sv / L) * (W - 40) + 30, Y = (v: number) => H - 20 - ((v - lo) / (hi - lo)) * (H - 35);
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${X(S.s[i]).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  // anchors: draggable heights
  const anchorS = P.map((_, k) => S.s[Math.min(S.s.length - 1, k * 24)]); // samplePath: 24 samples per piece
  const drag = (k: number, e: PointerEvent) => {
    if (readOnly.value || k === 0 || k === P.length - 1) return;
    const svg = (e.currentTarget as SVGElement).ownerSVGElement!;
    const r = svg.getBoundingClientRect();
    const key = 'prof' + Math.random();
    const move = (m: PointerEvent) => {
      const v = lo + ((H - 20 - ((m.clientY - r.top) / r.height) * H) / (H - 35)) * (hi - lo);
      const g = hf.sample(P[k].x, P[k].z) + hf.base;
      const lift = Math.max(0, Math.round((v - g) * 2) / 2);
      ui.E.edit('Height', () => ui.doc.set(s.id, 'path', s.path.map((a, i) => (i === k ? { ...a, lift } : a))), key);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return (
    <svg class="profile-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <path d={`${path(ground)}L${X(L)},${H}L${X(0)},${H}Z`} fill="rgba(160,120,80,0.25)" stroke="#a07850" stroke-width="1.5" />
      <path d={path(road)} fill="none" stroke="#2f7cf6" stroke-width="2.5" />
      {P.map((a, k) => (
        <circle key={k} cx={X(anchorS[k])} cy={Y(hf.sample(a.x, a.z) + hf.base + a.lift)} r={k === 0 || k === P.length - 1 ? 4 : 6} fill={k === 0 || k === P.length - 1 ? '#ff8a3d' : '#fff'} stroke="#2f7cf6" stroke-width="2"
          style={{ cursor: k === 0 || k === P.length - 1 ? 'default' : 'ns-resize' }} onPointerDown={(e) => drag(k, e as unknown as PointerEvent)} />
      ))}
      <text x="4" y="12" class="axis">{hi.toFixed(0)} m</text><text x="4" y={H - 22} class="axis">{lo.toFixed(0)} m</text>
      <text x={W - 60} y={H - 4} class="axis">{L.toFixed(0)} m</text>
    </svg>
  );
}
