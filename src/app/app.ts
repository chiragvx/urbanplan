// App shell: boot, files (open / save / autosave / publish / fork), review queue, exports, frame loop.
import * as THREE from 'three/webgpu';
import { Engine, PERF_URL, type Graphics } from '../render/engine';
import { releaseUploaded } from '../render/release';
import { CityControls } from '../render/controls';
import { createMaterials } from '../render/materials';
import { loadTile, type TileData } from '../data/tile';
import { Heightfield } from '../geo/heightfield';
import { buildLanduseTexture } from '../build/terrain';
import type { Network } from '../net/model';
import { buildBase, baseFingerprint, type UtilitiesFile } from '../doc/base';
import { CityDoc, type Change } from '../doc/doc';
import { Compiler } from '../doc/compile';
import type { SurveyStatus } from '../doc/types';
import { editRegion } from '../doc/ops';
import { FILE_EXT, newMeta, openMap, parse, serialize } from '../doc/format';
import { IssueIndex, type RegionLike } from '../doc/issues';
import { earthworkBox } from '../doc/terrain';
import { toGeoJSON, toNetwork } from '../doc/export';
import { CityApi } from '../doc/api';
import type { Id, LayerObj, MapMeta } from '../doc/types';
import { CLASS_RANK } from '../doc/types';
import * as xs from '../doc/xsection';
import { World } from '../scene/world';
import { Reference } from '../scene/reference';
import { Editor, type AppApi } from '../editor/editor';
import { bindShortcuts } from '../editor/commands';
import {
  dialog, docVersion, dpRegionsOn, lineLayer, mode, readOnly, saveSettings, select, selection, settings, stale3d, status, surveyFilter, toast, tool,
} from '../editor/state';

/** A region in the survey list. */
export interface SurveyItem { id: string; cls: string; reserved: boolean; area: number; code?: string; status: SurveyStatus; x: number; z: number }
import { download, local, pickFile, repo, saveToDisk, slug } from './storage';

export class App implements AppApi {
  engine!: Engine;
  controls!: CityControls;
  tile!: TileData;
  hf!: Heightfield;
  doc!: CityDoc;
  C!: Compiler;
  world!: World;
  E!: Editor;
  issues!: IssueIndex;
  ref!: Reference;
  /** file in maps/ this map was opened from / saved to (dev server) */
  repoFile: string | null = null;
  private saveTimer = 0;
  private lastChange = 0;
  private lastView = '';

  async boot(tileId: string, progress: (f: number, msg: string) => void) {
    const $ = (id: string) => document.getElementById(id) as HTMLCanvasElement;
    this.engine = new Engine($('gl'));
    this.engine.onLost = () => void this.recoverGpu();
    await this.engine.init(settings.value.graphics);
    this.engine.setTimeOfDay(10.5 * 60);
    const base = `${import.meta.env.BASE_URL}tiles/${tileId}/`;
    this.tile = await loadTile(tileId, progress);
    progress(0.15, 'Shaping the terrain…');
    this.hf = new Heightfield(this.tile.terrain.n, this.tile.terrain.cell, this.tile.terrain.heights);
    progress(0.2, 'Loading the road network…');
    const [net, util] = await Promise.all([
      fetch(base + 'network.json').then((r) => r.json()) as Promise<Network>,
      fetch(base + 'utilities.json').then((r) => (r.ok ? r.json() : null)).catch(() => null) as Promise<UtilitiesFile | null>,
    ]);
    progress(0.3, 'Building the editable map…'); await frame();
    const baseObjs = buildBase(net, this.tile, util);
    this.doc = new CityDoc(baseObjs, newMeta(tileId, baseFingerprint(baseObjs), settings.value.author));
    this.C = new Compiler(this.doc, this.hf);
    progress(0.38, `Generating ${net.segments.length.toLocaleString()} road pieces and junctions…`); await frame();
    this.C.full();
    const landuse = buildLanduseTexture(this.tile);
    const M = createMaterials(landuse);
    this.world = new World(this.engine.scene, this.tile, this.hf, this.doc, this.C, M, landuse);
    this.world.build((f, m) => progress(f, m));
    this.world.setGraphics(settings.value.graphics);
    this.controls = new CityControls(this.engine.canvas, this.engine.camera, (x, z) => this.hf.sampleSurface(x, z) * (this.E?.exag ?? 1));
    this.controls.bounds = this.tile.half;
    this.E = new Editor(this.engine, this.controls, this.doc, this.C, this.world, this.hf, $('overlay'));
    this.E.app = this;
    const [lat, lon] = this.tile.center;
    this.ref = new Reference(this.doc, base, { lat, lon, kx: this.tile.proj.kx, kz: this.tile.proj.kz });
    this.ref.onLoad = () => { this.world.needsRender = true; this.lastView = ''; };
    this.E.dpr.base = base;
    let regionsChecked = false;
    this.E.dpr.onLoad = () => {
      this.E.overlayDirty = true; docVersion.value++;
      // first time the DP regions arrive: check them (buildings on reserved open space)
      if (this.E.dpr.ready && !regionsChecked && this.issues.version) { regionsChecked = true; this.issues.regionPass(); this.showMarkers(!!this.E.markers.length); }
    };
    this.engine.scene.add(this.ref.group);
    this.issues = new IssueIndex(this.doc, this.C, (x0, z0, x1, z1) => this.E.hit.query(x0, z0, x1, z1));
    // water pooling in terraformed ground (not inside ponds, which hold water on purpose)
    this.issues.terrainIssues = () => {
      const ponds = this.doc.all('earthwork').filter((o) => o.op === 'pond');
      const inPond = (x: number, z: number) => ponds.some((o) => { let c = false; const P = o.pts; for (let i = 0, j = P.length / 2 - 1; i < P.length / 2; j = i++) { const xi = P[i * 2], zi = P[i * 2 + 1], xj = P[j * 2], zj = P[j * 2 + 1]; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; });
      return this.E.terrain.pits().filter((p) => !inPond(p.x, p.z)).map((p) => ({
        key: `pit:${Math.round(p.x)}:${Math.round(p.z)}`, sev: 'warn' as const, title: 'Water would pool here',
        detail: `A ${p.depth.toFixed(1)} m deep hollow (${Math.round(p.area).toLocaleString()} m²) with no way out — soften it, or make it a pond`, x: p.x, z: p.z,
        ids: this.doc.all('earthwork').filter((o) => { const b = earthworkBox(o); return p.x >= b[0] && p.x <= b[2] && p.z >= b[1] && p.z <= b[3]; }).map((o) => o.id),
      }));
    };
    // DP regions for the checks: survey region objects, and traced regions not surveyed yet
    this.issues.regions = () => {
      const D = this.E.dpr;
      const out: RegionLike[] = this.doc.all('region');
      if (D.ready && D.data) for (const r of D.data.regions) if (!this.doc.get(r.id)) out.push(r);
      return out;
    };
    this.E.onAfterChange = (c) => this.afterChange(c);
    bindShortcuts(this.E);
    this.bindDrop();
    // start in the plan view, framing Koregaon Park
    this.engine.setPlan(true); this.world.setPlan(true); this.engine.plan = true;
    this.E.view.goTo(-350, 150, 0.5, 1);
    progress(0.97, 'Opening your map…');
    await this.restore();
    this.resumeView();
    (window as unknown as Record<string, unknown>).city = new CityApi(this.doc, {
      select: (ids) => select(ids.map((id) => ({ kind: this.doc.get(id)!.kind, id }))),
      zoom: () => this.E.zoomToSelection(),
    });
    console.info('%cUrbanPlan editor', 'font-weight:bold;color:#ff8a3d', '— script edits with `city`, e.g. city.help()');
    this.loop();
  }

  /** The 3D look (Settings): simple (light) or high. */
  setGraphics(g: Graphics) {
    if (settings.value.graphics !== g) saveSettings({ graphics: g });
    this.engine.setGraphics(g);
    this.world.setGraphics(g);
    this.world.frame(this.engine.camera.position, this.controls.focus);
    this.world.needsRender = true;
  }

  // ---------------- GPU loss ----------------

  /** performance panel hook (Ctrl+Shift+P) */
  perfFrame: ((now: number) => void) | null = null;
  private perfEl: HTMLElement | null = null;

  /** A small live readout: frame rate while rendering, CPU / GPU time, draw calls, triangles, GPU objects, memory. */
  togglePerf() {
    if (this.perfEl) { this.perfEl.remove(); this.perfEl = null; this.perfFrame = null; return; }
    const el = document.createElement('div');
    el.className = 'perf-panel';
    el.style.cssText = 'position:fixed;left:50%;bottom:34px;transform:translateX(-50%);z-index:50;background:rgba(20,22,26,.86);color:#e8e6e1;font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;padding:6px 10px;border-radius:6px;pointer-events:none;white-space:pre';
    document.body.appendChild(el);
    this.perfEl = el;
    let frames = 0, since = performance.now(), cpu = 0, draws = 0, tris = 0;
    const show = (now: number) => {
      const e = this.engine, r = e.renderer, info = r.info, mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
      const secs = (now - since) / 1000;
      const fps = frames / Math.max(secs, 1e-3);
      if (PERF_URL) void e.sampleGpuTime();
      el.textContent =
        `${mode.value.toUpperCase()} · ${settings.value.graphics} · ${(r.getPixelRatio()).toFixed(2)}× px · ${frames ? `${fps.toFixed(0)} fps while drawing` : 'idle (not drawing)'}
` +
        `CPU ${(cpu / Math.max(frames, 1)).toFixed(1)} ms${PERF_URL ? ` · GPU ${e.gpuMs.toFixed(1)} ms` : ' · GPU time: add ?perf to the URL'} · ${draws} draws · ${(tris / 1000).toFixed(0)}k triangles (last frame)
` +
        `GPU objects: ${info.memory.geometries} geometries, ${info.memory.textures} textures · imagery ${(this.ref.bytes / 1e6).toFixed(0)} MB (${this.ref.count} tiles)` +
        (mem ? ` · JS heap ${(mem.usedJSHeapSize / 1e6).toFixed(0)} MB` : '');
      frames = 0; cpu = 0; since = now;
    };
    this.perfFrame = (now) => {
      const ri = this.engine.renderer.info.render;
      frames++; cpu += this.engine.cpuMs; draws = ri.drawCalls; tris = ri.triangles;
      if (now - since > 1000) show(now);
    };
    const idle = () => { if (!this.perfEl) return; const now = performance.now(); if (now - since > 1000) show(now); setTimeout(idle, 1000); };
    show(performance.now());
    idle();
  }

  /**
   * The GPU dropped the page (driver reset, or the system ran short of graphics memory): save, remember the view and
   * reload — the document is the source of truth, so everything is rebuilt. A second loss within a minute stops
   * auto-reloading and offers the light look instead.
   */
  private async recoverGpu() {
    const KEY = 'urbanplan:gpu-lost';
    let recent = false;
    try { recent = Date.now() - Number(sessionStorage.getItem(KEY) ?? 0) < 60000; sessionStorage.setItem(KEY, String(Date.now())); } catch { /* storage off */ }
    clearTimeout(this.saveTimer);
    try { await this.persist(); } catch (e) { console.error(e); }
    this.rememberView();
    if (recent) {
      if (settings.value.graphics !== 'simple') saveSettings({ graphics: 'simple' });
      toast('The graphics card stopped responding again. Your edits are saved.', 'error', { label: 'Reload', run: () => location.reload() }, 600000);
      return;
    }
    toast('Graphics reset — recovering the view… (your edits are saved)', 'warn', undefined, 10000);
    setTimeout(() => location.reload(), 600);
  }

  private rememberView() {
    const E = this.E, c = this.controls;
    if (!E || !c) return;
    const v = { mode: mode.value, cx: E.view.cx, cz: E.view.cz, scale: E.view.scale, t: [c.target.x, c.target.y, c.target.z], yaw: c.yaw, pitch: c.pitch, dist: c.dist };
    try { sessionStorage.setItem('urbanplan:view', JSON.stringify(v)); } catch { /* storage off */ }
  }

  /** After a recovery reload: back to the same view. */
  private resumeView() {
    let v: { mode: '2d' | '3d'; cx: number; cz: number; scale: number; t: number[]; yaw: number; pitch: number; dist: number } | null = null;
    try { v = JSON.parse(sessionStorage.getItem('urbanplan:view') ?? 'null'); sessionStorage.removeItem('urbanplan:view'); } catch { /* storage off */ }
    if (!v) return;
    this.E.view.cx = v.cx; this.E.view.cz = v.cz; this.E.view.scale = v.scale; this.E.view.apply();
    if (v.mode === '3d') {
      this.E.setMode('3d');
      const c = this.controls;
      c.target.set(v.t[0], v.t[1], v.t[2]); c.yaw = v.yaw; c.pitch = v.pitch; c.dist = v.dist; c.snap();
    }
  }

  // ---------------- startup: which map ----------------

  private async restore() {
    const q = new URLSearchParams(location.search);
    const url = q.get('map');
    await repo.probe();
    if (url) { await this.openUrl(url, true); return; }
    const last = await local.last();
    if (last && last.meta.tile === this.tile.id) {
      this.load(last.text, false);
      status.value = `Restored “${last.meta.name}” from this browser`;
    }
  }

  private load(text: string, viewOnly: boolean, source?: string) {
    const f = parse(text);
    if (f.meta.tile && f.meta.tile !== this.tile.id) throw new Error(`This map is for tile “${f.meta.tile}”`);
    const r = openMap(this.doc, f);
    this.issues.orphans = r.unresolved.map((u) => ({ id: u.id, title: u.entry.loc?.name ?? u.id }));
    readOnly.value = viewOnly;
    select([]);
    if (r.remapped.length) toast(`${r.remapped.length} edit(s) re-attached to roads that changed in the base map`, 'info');
    if (r.unresolved.length) toast(`${r.unresolved.length} edit(s) no longer match the base map — see Issues`, 'warn');
    if (source) status.value = `Opened ${source}`;
    docVersion.value++;
    document.title = `${this.doc.meta.name} — UrbanPlan`;
  }

  async openUrl(url: string, viewOnly: boolean) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const text = await r.text();
      // your own map (known in this browser) opens editable
      const id = parse(text).meta.id;
      const mine = !!(await local.get(id));
      this.load(text, viewOnly && !mine, url.split('/').pop());
      this.repoFile = null;
      dialog.value = null;
      const u = new URL(location.href); u.searchParams.set('map', url); history.replaceState(null, '', u);
    } catch (e) { toast(`Couldn't open the map: ${(e as Error).message}`, 'error'); }
  }

  async openLocal(id: string) {
    const m = await local.get(id);
    if (!m) return;
    this.load(m.text, false, m.meta.name);
    this.repoFile = null;
    dialog.value = null;
    this.clearUrl();
  }

  async openRepo(file: string) {
    try { this.load(await repo.read(file), false, file); this.repoFile = file; dialog.value = null; this.clearUrl(); }
    catch (e) { toast(`Couldn't open ${file}: ${(e as Error).message}`, 'error'); }
  }

  async openFile(file?: File) {
    const f = file ?? (await pickFile('.json'));
    if (!f) return;
    try { this.load(await f.text(), false, f.name); this.repoFile = null; dialog.value = null; this.clearUrl(); }
    catch (e) { toast(`Couldn't open ${f.name}: ${(e as Error).message}`, 'error'); }
  }

  private clearUrl() { const u = new URL(location.href); if (u.searchParams.has('map')) { u.searchParams.delete('map'); history.replaceState(null, '', u); } }

  private bindDrop() {
    window.addEventListener('dragover', (e) => { e.preventDefault(); });
    window.addEventListener('drop', (e) => {
      e.preventDefault();
      const f = e.dataTransfer?.files?.[0];
      if (f && f.name.endsWith('.json')) void this.openFile(f);
    });
  }

  newMap() {
    if (this.doc.editCount && !confirm('Start a new map? Your current map stays saved in this browser.')) return;
    void this.persist();
    this.doc.load(new Map(), newMeta(this.tile.id, this.doc.meta.base ?? '', settings.value.author));
    readOnly.value = false; this.repoFile = null; this.issues.orphans = [];
    select([]); dialog.value = null; this.clearUrl();
    toast('New map — edit away', 'ok');
  }

  fork() {
    const m = this.doc.meta;
    const fresh = newMeta(this.tile.id, m.base ?? '', settings.value.author);
    this.doc.meta = { ...fresh, name: `${m.name} (my copy)`, description: m.description, forkedFrom: { name: m.name, author: m.author, id: m.id, url: new URLSearchParams(location.search).get('map') ?? undefined } };
    readOnly.value = false; this.repoFile = null;
    this.clearUrl();
    this.doc.version++;
    void this.persist();
    docVersion.value++;
    toast('This is now your own copy — edits are saved in this browser', 'ok');
  }

  rename(name: string) { this.setMeta({ name }); }

  setMeta(m: Partial<MapMeta>) {
    Object.assign(this.doc.meta, m, { updated: new Date().toISOString() });
    this.doc.version++;
    document.title = `${this.doc.meta.name} — UrbanPlan`;
    docVersion.value++;
    this.scheduleSave();
  }

  // ---------------- saving ----------------

  private scheduleSave() {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void this.persist(), 900);
  }

  /** Autosave into this browser. */
  private async persist() {
    if (readOnly.value) return;
    await local.put({ meta: { ...this.doc.meta }, text: serialize(this.doc), savedAt: new Date().toISOString(), edits: this.doc.editCount });
  }

  get fileName() { return this.repoFile ?? `${slug(this.doc.meta.name)}${FILE_EXT}`; }

  async save(copy = false) {
    if (readOnly.value) { toast('Make your own copy first (Edit a copy)', 'warn'); return; }
    if (!this.doc.meta.author && settings.value.author) this.doc.meta.author = settings.value.author;
    if (copy) {
      const name = prompt('Name for the copy', `${this.doc.meta.name} copy`);
      if (!name) return;
      const fresh = newMeta(this.tile.id, this.doc.meta.base ?? '', settings.value.author);
      this.doc.meta = { ...this.doc.meta, id: fresh.id, name, created: fresh.created };
      this.repoFile = null;
    }
    const text = serialize(this.doc);
    try {
      if (repo.available) {
        await repo.save(this.fileName, text);
        this.repoFile = this.fileName;
        toast(`Saved to maps/${this.fileName}`, 'ok');
      } else {
        const n = await saveToDisk(this.fileName, text, copy);
        toast(`Saved ${n}`, 'ok');
      }
      await this.persist();
      this.doc.savedVersion = this.doc.version;
      docVersion.value++;
    } catch (e) { if ((e as Error).name !== 'AbortError') toast(`Save failed: ${(e as Error).message}`, 'error'); }
  }

  download() { download(this.fileName, serialize(this.doc)); }

  async publishToSite(): Promise<string> {
    const text = serialize(this.doc);
    try {
      const url = await repo.publish(this.fileName, text);
      this.doc.savedVersion = this.doc.version;
      await this.persist();
      docVersion.value++;
      return `Published as ${url}. It's in the site gallery now; rebuild (npm run build) and upload dist/ to put it online. Share: ${location.origin}${location.pathname}?map=${url}`;
    } catch (e) { toast(`Publish failed: ${(e as Error).message}`, 'error'); return ''; }
  }

  copyLink() {
    const at = prompt('Where is the map file hosted? (a URL to the .urbanplan.json, e.g. a GitHub raw link or gist)');
    if (!at) return;
    const link = `${location.origin}${location.pathname}?map=${encodeURIComponent(at.trim())}`;
    navigator.clipboard?.writeText(link).then(() => toast('Link copied — anyone with it can view and copy your map', 'ok'), () => prompt('Copy this link', link));
  }

  exportGeoJSON(buildings: boolean) {
    const [lat0, lon0] = this.tile.center;
    const gj = toGeoJSON(this.doc, this.C, { lat0, lon0, kx: this.tile.proj.kx, kz: this.tile.proj.kz }, { buildings });
    download(`${slug(this.doc.meta.name)}.geojson`, JSON.stringify(gj), 'application/geo+json');
  }

  exportNetwork() { download('network.json', JSON.stringify(toNetwork(this.doc, this.C, this.tile.half))); }

  // ---------------- layers ----------------

  setLayer(id: Id, key: keyof LayerObj, v: unknown) {
    this.doc.transact(`Layer ${String(key)}`, () => this.doc.set(id, key, v), `layer:${id}:${String(key)}`);
  }

  toggleLayer(id: Id) {
    const L = this.doc.get<'layer'>(id);
    if (L) this.setLayer(id, 'visible', !L.visible);
  }

  setLineLayer(id: Id) {
    lineLayer.value = id;
    const L = this.doc.get<'layer'>(id);
    if (L && !L.visible) this.setLayer(id, 'visible', true);
    if (!readOnly.value) this.E.setTool('line');
  }

  // ---------------- checks & review ----------------

  checkAll() {
    this.E.dpr.load(); // the DP regions join the checks when they arrive
    const t = performance.now();
    this.issues.full();
    docVersion.value++;
    const n = this.issues.byKey.size;
    toast(`${n.toLocaleString()} issue${n === 1 ? '' : 's'} found in ${Math.round(performance.now() - t)} ms`, n ? 'info' : 'ok');
    if (this.E.markers.length || n < 2000) this.showMarkers(true);
  }

  showMarkers(on: boolean) {
    this.E.markers = on ? this.issues.list().filter((i) => i.sev !== 'info').map((i) => ({ x: i.x, z: i.z, sev: i.sev as 'error' | 'warn' })) : [];
    this.E.overlayDirty = true;
    docVersion.value++;
  }

  private reviewCache: { v: number; q: { id: Id; name: string; why: string }[] } = { v: -1, q: [] };

  reviewQueue() {
    if (this.reviewCache.v === this.doc.version) return this.reviewCache.q;
    const q: { id: Id; name: string; why: string; score: number }[] = [];
    for (const s of this.doc.all('section')) {
      if (s.verified || s.cls === 'service' || s.cls === 'track') continue;
      const L = this.C.geo(s.id)?.len ?? 0;
      if (L < 25) continue;
      const w = xs.totalWidth(s.parts);
      const rank = CLASS_RANK[s.cls] ?? 8;
      let score = (9 - rank) * 10 + Math.min(20, L / 50);
      let why = `${xs.describe(s.parts)}`;
      if (s.reserve && Math.abs(w - s.reserve) > 3) { score += 25; why = `${w.toFixed(1)} m vs DP ${s.reserve} m`; }
      else if (!s.reserve && rank <= 4) { score += 8; why = `width estimated · ${why}`; }
      q.push({ id: s.id, name: s.name || 'Unnamed road', why, score });
    }
    q.sort((a, b) => b.score - a.score);
    this.reviewCache = { v: this.doc.version, q };
    return q;
  }

  reviewNext() {
    const q = this.reviewQueue();
    const cur = new Set(selection.value.map((s) => s.id));
    const next = q.find((x) => !cur.has(x.id));
    if (!next) { toast('Everything in the queue is verified 🎉', 'ok'); return; }
    if (this.doc.get<'layer'>('dp') && !this.doc.get<'layer'>('dp')!.visible && next.why.includes('DP')) this.toggleLayer('dp');
    select([{ kind: 'section', id: next.id }]);
    this.E.zoomToSelection();
    if (tool.value !== 'select') this.E.setTool('select');
    status.value = `Review: ${next.name} — ${next.why}. Fix it, or press Y if it's right.`;
  }

  // ---------------- survey (DP regions) ----------------

  private surveyCache: { key: string; q: SurveyItem[] } = { key: '', q: [] };

  /** Regions to survey (reserved sites, or every region but water), in a walking order: 300 m bands, snaking. */
  surveyQueue(): SurveyItem[] {
    const D = this.E.dpr;
    if (!D.ready || !D.data) return [];
    const key = `${this.doc.version}:${surveyFilter.value}`;
    if (this.surveyCache.key === key) return this.surveyCache.q;
    const q: SurveyItem[] = [];
    const add = (id: string, r: { cls: string; reserved: boolean; area: number; ring: number[]; code?: string; status?: SurveyStatus }) => {
      // slivers under 400 m² are mostly tracing noise along roads: not worth a visit
      if (r.cls === 'water' || r.area < 400 || (surveyFilter.value === 'reserved' && !r.reserved)) return;
      let x = 0, z = 0;
      for (let i = 0; i < r.ring.length; i += 2) { x += r.ring[i]; z += r.ring[i + 1]; }
      const n = r.ring.length / 2;
      q.push({ id, cls: r.cls, reserved: r.reserved, area: r.area, code: r.code, status: r.status ?? 'unsurveyed', x: x / n, z: z / n });
    };
    for (const t of D.data.regions) add(t.id, this.doc.get<'region'>(t.id) ?? t);
    for (const o of this.doc.all('region')) if (!D.get(o.id)) add(o.id, o);
    q.sort((a, b) => {
      const ba = Math.floor(a.z / 300), bb = Math.floor(b.z / 300);
      return ba !== bb ? ba - bb : (ba % 2 ? b.x - a.x : a.x - b.x);
    });
    this.surveyCache = { key, q };
    return q;
  }

  /** Set survey status on regions (their survey objects are created on first edit). */
  setSurvey(ids: Id[], st: SurveyStatus) {
    const D = this.E.dpr;
    this.E.edit(`Survey: ${st}`, () => {
      for (const id of ids) {
        const t = D.get(id);
        editRegion(this.doc, id, { status: st, surveyedBy: settings.value.author || undefined, surveyedAt: new Date().toISOString().slice(0, 10) }, t ? D.snapshot(t) : undefined);
      }
    });
  }

  /** Select and frame the next region not surveyed yet (after the selected one, in walking order). */
  surveyNext() {
    if (!dpRegionsOn.value) { dpRegionsOn.value = true; this.E.overlayDirty = true; }
    const D = this.E.dpr;
    D.load();
    if (!D.ready) { toast('Loading DP regions…', 'info', undefined, 1500); return; }
    const q = this.surveyQueue();
    const cur = selection.value.find((s) => s.kind === 'region')?.id;
    const at = cur ? q.findIndex((x) => x.id === cur) : -1;
    const order = [...q.slice(at + 1), ...q.slice(0, at + 1)];
    const next = order.find((x) => x.status === 'unsurveyed' && x.id !== cur);
    if (!next) { toast('Every region in the list is surveyed 🎉', 'ok'); return; }
    if (tool.value !== 'select') this.E.setTool('select');
    select([{ kind: 'region', id: next.id }]);
    this.E.zoomToSelection();
    status.value = `Survey: ${next.reserved ? 'reserved site' : 'region'} — Y matches the plan · or pick a status in the inspector · N next`;
  }

  // ---------------- coordinates ----------------

  toLatLon(x: number, z: number): [number, number] {
    const [lat0, lon0] = this.tile.center;
    return [lat0 - z / this.tile.proj.kz, lon0 + x / this.tile.proj.kx];
  }

  goTo(a: number, b: number) {
    let x = a, z = b;
    if (Math.abs(a) <= 90 && Math.abs(b) <= 180 && Math.abs(a - this.tile.center[0]) < 1) {
      x = (b - this.tile.center[1]) * this.tile.proj.kx; z = -(a - this.tile.center[0]) * this.tile.proj.kz;
    }
    this.E.zoomTo([x - 80, z - 80, x + 80, z + 80]);
  }

  // ---------------- changes & frame loop ----------------

  private afterChange(c: Change) {
    this.lastChange = performance.now();
    if (this.issues.version) this.issues.update(c.ids);
    if (this.E.markers.length) this.showMarkers(true);
    if (c.origin !== 'load') this.scheduleSave();
    for (const id of c.ids) if (this.doc.get(id)?.kind === 'layer' || this.doc.base.get(id)?.kind === 'layer') { this.world.applyLayers(); this.lastView = ''; break; }
    document.title = `${this.doc.version !== this.doc.savedVersion ? '• ' : ''}${this.doc.meta.name} — UrbanPlan`;
  }

  private loop() {
    let last = performance.now();
    // dynamic resolution: frame rate over continuous 3D rendering only (an idle 3D view doesn't render at all)
    let busy = 0, busyFrames = 0, lastStep = 0, rendered = false, settle = 0;
    const camSig = new Float32Array(17);
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const E = this.E, W = this.world;
      let draw = false;
      if (mode.value === '3d') {
        this.controls.update(dt);
        const cam = this.engine.camera;
        cam.updateMatrixWorld();
        // did the camera move since the last frame? (the controls ease forever: ignore sub-millimetre drift)
        const m = cam.matrixWorld.elements;
        let moved = Math.abs(camSig[16] - cam.aspect) > 1e-4;
        for (let i = 0; i < 15 && !moved; i++) if (Math.abs(camSig[i] - m[i]) > (i >= 12 ? 1e-3 : 2e-5)) moved = true;
        if (moved) { camSig.set(m); camSig[16] = cam.aspect; settle = 6; }
        const focus = this.controls.focus;
        if (this.engine.updateShadows(focus, Math.min(2600, Math.max(160, this.controls.currentDist * 1.1)), false, moved)) draw = true;
        if (moved) { W.frame(cam.position, focus); E.overlayDirty = true; }
        // a few more frames after the camera stops, so LOD and shadows catch up
        if (moved || settle > 0) { draw = true; settle--; }
      }
      E.frame(now);
      if (mode.value === '2d') {
        const v = `${E.view.cx.toFixed(1)},${E.view.cz.toFixed(1)},${E.view.scale.toFixed(4)},${E.view.w},${E.view.h}`;
        if (v !== this.lastView) { this.lastView = v; this.ref.update(E.view.rect, E.view.scale, true); W.needsRender = true; }
        // keep the 3D view ready: refresh terrain / buildings around edits while idle
        if (W.stale && now - this.lastChange > 1500 && !E.drag) { W.sync(); stale3d.value = false; }
      } else if (this.lastView) { this.ref.update(E.view.rect, E.view.scale, false); this.lastView = ''; }
      if (draw || W.needsRender) {
        W.needsRender = false;
        this.engine.render();
        releaseUploaded(this.engine.renderer);
        this.perfFrame?.(now);
        // dynamic resolution in 3D: few fixed steps, decided over ≥2 s of continuous rendering, at most every 4 s
        if (mode.value === '3d' && rendered) {
          busy += dt; busyFrames++;
          if (busy > 2) {
            const fps = busyFrames / busy;
            if (now - lastStep > 4000) {
              if (fps < 42 && this.engine.stepResolution(1)) lastStep = now;
              else if (fps > 57 && this.engine.stepResolution(-1)) lastStep = now;
            }
            busy = 0; busyFrames = 0;
          }
        }
        rendered = true;
      } else rendered = false;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.addEventListener('resize', () => { this.world.needsRender = true; });
    void THREE;
  }
}

const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
