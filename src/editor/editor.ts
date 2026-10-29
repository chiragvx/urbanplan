// The editor controller: input on the plan view, tools, drags (one undo step each), snapping, selection, and the
// 2D ⇄ 3D switch. The document is the only thing tools change; everything visible follows from its change events.
import * as THREE from 'three/webgpu';
import type { Engine } from '../render/engine';
import type { CityControls } from '../render/controls';
import type { CityDoc, Change } from '../doc/doc';
import type { Compiler } from '../doc/compile';
import type { World } from '../scene/world';
import type { Heightfield } from '../geo/heightfield';
import type { Anchor, Id, Kind, SectionObj } from '../doc/types';
import * as ops from '../doc/ops';
import { DP_WIDTHS, setSideWidth, setTotalWidth, totalWidth } from '../doc/xsection';
import { HitIndex, type Pick } from './hit';
import { PlanView } from './view2d';
import {
  anchorSel, cursor, docVersion, dpRegionsOn, terrainView, hover, lineLayer, mode, penClass, readOnly, select, selection, settings, stale3d, status, toast, tool, xray, zoomScale,
  type Sel, type Tool,
} from './state';
import { RoadTool, type SnapResult } from './roadtool';
import { DPRegions, type DPRegion } from './dpregions';
import { traceAt } from './wand';
import { TerrainCompiler, type Region } from '../doc/terrain';
import { TerrainTool } from './terraintool';
import { TerrainView } from './terrainview';
import { newId } from '../doc/ids';
import { drawOverlay, type Handle } from './overlay';
import { DEFAULT_DEPTH, DEFAULT_SIZE } from '../doc/base';

type Drag =
  | { kind: 'pan'; last: [number, number]; start: [number, number]; right: boolean }
  | { kind: 'bulldoze'; n: number }
  | { kind: 'terrain'; n: number }
  | { kind: 'marquee'; a: [number, number]; b: [number, number]; add: boolean; deep: boolean }
  | { kind: 'junction'; id: Id; start: [number, number]; orig: [number, number]; moved: boolean; n: number }
  | { kind: 'bend'; id: Id; base: Anchor[]; grab: [number, number]; start: [number, number]; moved: boolean; n: number }
  | { kind: 'move'; ids: Id[]; start: [number, number]; last: [number, number]; moved: boolean; n: number }
  | { kind: 'width'; h: Handle; moved: boolean; n: number }
  | { kind: 'anchor'; owner: Id; k: number; handle?: 'in' | 'out'; start: [number, number]; base: Anchor[] | number[]; moved: boolean; n: number; alt: boolean }
  | { kind: 'pen'; idx: number; start: [number, number] }
  | { kind: 'measure'; a: [number, number]; b: [number, number] };

/** File / app-level actions the editor's commands need (implemented by the app shell). */
export interface AppApi {
  newMap(): void;
  save(copy?: boolean): Promise<void>;
  download(): void;
  fork(): void;
  toggleLayer(id: Id): void;
  reviewNext(): void;
  surveyNext(): void;
  setSurvey(ids: Id[], status: import('../doc/types').SurveyStatus): void;
  setGraphics(g: 'simple' | 'high'): void;
  togglePerf(): void;
}

export interface PenState { pts: ops.PenPoint[]; cursor: [number, number] | null; snap: Snap | null }
export interface Snap { kind: 'junction' | 'section' | 'anchor' | 'angle' | 'width' | 'guide' | 'cross'; p: [number, number]; id?: Id; label?: string }

let dragSeq = 0;

export class Editor {
  readonly hit: HitIndex;
  readonly view: PlanView;
  readonly road: RoadTool;
  readonly dpr = new DPRegions();
  /** terraforming: earthworks → designed ground */
  readonly terrain: TerrainCompiler;
  readonly terra: TerrainTool;
  readonly tview: TerrainView;
  /** terrain changed under a brush stroke: roads re-drape there when it ends */
  private pendingTerrain: Region | null = null;
  /** DP region under the cursor (when the overlay is on) */
  dpHover: DPRegion | null = null;
  readonly ctx: CanvasRenderingContext2D;
  drag: Drag | null = null;
  pen: PenState = { pts: [], cursor: null, snap: null };
  linePts: number[] = [];
  measure: { a: [number, number]; b: [number, number] } | null = null;
  handles: Handle[] = [];
  snap: Snap | null = null;
  mouse: [number, number] = [0, 0];
  spaceDown = false;
  overlayDirty = true;
  /** issue markers to draw (set by the issues panel) */
  markers: { x: number; z: number; sev: 'error' | 'warn' }[] = [];
  private lastClick = { t: 0, x: 0, y: 0 };
  onAfterChange: (c: Change) => void = () => {};
  app!: AppApi;

  constructor(
    readonly engine: Engine, readonly controls: CityControls, readonly doc: CityDoc, readonly C: Compiler,
    readonly world: World, readonly hf: Heightfield, readonly overlay: HTMLCanvasElement,
  ) {
    this.hit = new HitIndex(doc, C);
    this.hit.rebuild();
    this.road = new RoadTool(this);
    this.terrain = new TerrainCompiler(doc, hf);
    this.terra = new TerrainTool(this);
    this.tview = new TerrainView(this);
    this.dpr.onLoad = () => { this.overlayDirty = true; };
    this.view = new PlanView(engine.planCamera, world.tile.half);
    this.ctx = overlay.getContext('2d')!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.bindInput();
    doc.on((c) => this.onChange(c));
    controls.onClick = (cx, cy) => this.click3d(cx, cy);
    controls.onHover = (cx, cy) => this.hover3d(cx, cy);
  }

  resize() {
    const r = window.devicePixelRatio || 1;
    const w = this.overlay.clientWidth, h = this.overlay.clientHeight;
    this.overlay.width = Math.round(w * r); this.overlay.height = Math.round(h * r);
    this.ctx.setTransform(r, 0, 0, r, 0, 0);
    this.view.resize(w, h);
    this.world.needsRender = true;
    this.overlayDirty = true;
  }

  // ---------------- document changes ----------------

  private onChange(c: Change) {
    // terraforming first, so roads changed in the same step sit on the new ground
    const ew = [...c.ids].filter((id) => this.doc.get(id)?.kind === 'earthwork' || this.terrain.has(id));
    const tr = ew.length ? this.terrain.update(ew) : null;
    const items = this.C.update(c.ids);
    this.world.onChange(c, items);
    this.hit.update(c.ids);
    if (tr) this.terrainChanged(tr);
    else if (terrainView.value) {
      // the terrain view shows road cut / fill: keep it current in 2D
      const r = this.regionOf(c.ids);
      if (r) this.world.syncTerrain(r);
    }
    // drop selection of things that no longer exist (traced DP regions aren't map objects until surveyed)
    const sel = selection.value.filter((s) => this.doc.get(s.id) || (s.kind === 'region' && this.dpr.get(s.id)));
    if (sel.length !== selection.value.length) selection.value = sel;
    if (anchorSel.value && !this.doc.get(anchorSel.value.owner)) anchorSel.value = null;
    docVersion.value++;
    stale3d.value = this.world.stale;
    this.overlayDirty = true;
    if (mode.value === '3d' && !this.drag) this.syncSoon();
    this.onAfterChange(c);
  }

  /** Extent of changed sections / junctions (padded), or null. */
  private regionOf(ids: Iterable<Id>): Region | null {
    let r: Region | null = null;
    for (const id of ids) {
      const o = this.doc.get(id);
      const g = o?.kind === 'section' ? this.C.geo(id) : null;
      const b: Region | null = g ? [g.x0, g.z0, g.x1, g.z1] : o?.kind === 'junction' ? [o.x, o.z, o.x, o.z] : null;
      if (b) r = r ? [Math.min(r[0], b[0]), Math.min(r[1], b[1]), Math.max(r[2], b[2]), Math.max(r[3], b[3])] : b;
    }
    return r && [r[0] - 40, r[1] - 40, r[2] + 40, r[3] + 40];
  }

  /** The designed ground changed in a region: terrain now, roads there when no brush stroke is under way. */
  private terrainChanged(r: Region) {
    this.world.syncTerrain(r);
    this.world.buildPonds();
    this.terrainVersion++;
    if (this.drag?.kind === 'terrain') { const p = this.pendingTerrain; this.pendingTerrain = p ? [Math.min(p[0], r[0]), Math.min(p[1], r[1]), Math.max(p[2], r[2]), Math.max(p[3], r[3])] : r; return; }
    this.redrape(r);
  }

  /** Roads in a region follow the new ground (graded ones keep their profile; the ground is re-cut to them). */
  redrape(r: Region) {
    const ids = new Set<Id>();
    for (const id of this.hit.query(r[0], r[1], r[2], r[3])) if (this.doc.get(id)?.kind === 'section') ids.add(id);
    if (ids.size) {
      const items = this.C.update(ids);
      const c: Change = { ids, structural: false, origin: 'edit', label: 'Terrain' };
      this.world.onChange(c, items);
      this.hit.update(ids);
      this.world.syncTerrain(r);
      this.onAfterChange({ ...c, ids: new Set([...ids, ...this.doc.ids('earthwork')]) });
    }
    this.world.markDirty(r);
    stale3d.value = this.world.stale;
    if (mode.value === '3d') this.syncSoon(0);
    this.overlayDirty = true;
  }

  /** bumps when the designed ground changes (terrain view caches) */
  terrainVersion = 0;

  private syncTimer = 0;
  /** In 3D, bring terrain / buildings / trees up to date with the roads shortly after an edit. */
  syncSoon(ms = 150) {
    clearTimeout(this.syncTimer);
    this.syncTimer = window.setTimeout(() => { if (mode.value === '3d' && !this.drag && this.world.stale) { this.world.sync(); stale3d.value = false; } }, ms);
  }

  // ---------------- helpers ----------------

  get tol() { return 6 / this.ppm; }

  /** Screen pixels per metre where the pointer is: the plan scale in 2D, from the camera distance in 3D. */
  get ppm() { return mode.value === '2d' ? this.view.scale : this.ppm3; }
  private ppm3 = 1;

  /** Where the map is centred (the plan centre, or the 3D camera's target). */
  get centre(): [number, number] { if (mode.value === '2d') return [this.view.cx, this.view.cz]; const f = this.controls.focus; return [f.x, f.z]; }

  /** Overlay pixel → world metres: the plan transform in 2D, a ray onto the terrain in 3D. */
  toWorld(sx: number, sy: number): [number, number] {
    if (mode.value === '2d') return this.view.toWorld(sx, sy);
    const r = this.overlay.getBoundingClientRect();
    const cx = sx + r.left, cy = sy + r.top;
    const p = this.controls.pick(cx, cy) ?? this.controls.pickAtHeight(cx, cy, this.controls.focus.y);
    if (!p) return this.centre;
    const d = this.engine.camera.position.distanceTo(p);
    this.ppm3 = this.view.h / (2 * Math.max(1, d) * Math.tan((this.engine.camera.fov * Math.PI) / 360));
    return [p.x, p.z];
  }

  canPick = (kind: Kind, layer?: Id) => {
    if (kind === 'region') return dpRegionsOn.value;
    if (kind === 'earthwork') return terrainView.value;
    const L = this.doc.get<'layer'>(layer ?? (kind === 'section' || kind === 'junction' ? 'roads' : kind === 'building' ? 'buildings' : ''));
    return !L || (L.visible && !L.locked);
  };

  pickAt(x: number, z: number): Pick | null {
    const p = this.hit.pick(x, z, this.tol, this.canPick);
    if (p && p.kind !== 'region') return p;
    // traced DP regions not surveyed yet (no region object): the smallest one under the point
    if (dpRegionsOn.value && this.dpr.ready) {
      const r = this.dpr.at(x, z);
      if (r && (!p || r.area < (this.doc.get<'region'>(p.id)?.area ?? Infinity))) return { kind: 'region', id: r.id, d: 50 };
    }
    return p;
  }

  /** What a click on a section selects: the road, or the section when already working inside that road. */
  private selFor(p: Pick, deep: boolean): Sel {
    if (p.kind !== 'section') return { kind: p.kind, id: p.id };
    const s = this.doc.get<'section'>(p.id)!;
    const cur = selection.value;
    const inside = cur.some((c) => (c.kind === 'section' && this.doc.get<'section'>(c.id)?.road === s.road) || (c.kind === 'road' && c.id === s.road && deep));
    if (deep || inside || tool.value === 'direct') return { kind: 'section', id: p.id };
    return { kind: 'road', id: s.road };
  }

  /** Sections covered by the selection (roads expand to their sections). */
  selectedSections(): SectionObj[] {
    const out = new Map<Id, SectionObj>();
    for (const s of selection.value) {
      if (s.kind === 'section') { const o = this.doc.get<'section'>(s.id); if (o) out.set(o.id, o); }
      if (s.kind === 'road') for (const o of this.doc.sectionsOf(s.id)) out.set(o.id, o);
    }
    return [...out.values()];
  }

  /** Run an edit as one undo step (refused in read-only mode). */
  edit<T>(label: string, fn: () => T, merge?: string): T | undefined {
    if (readOnly.value) { toast('This map is read-only — use “Edit a copy” to make changes', 'warn'); return undefined; }
    try { return this.doc.transact(label, fn, merge); } catch (e) { console.error(e); toast(`${label} failed: ${(e as Error).message}`, 'error'); return undefined; }
  }

  // ---------------- view ----------------

  setMode(m: '2d' | '3d') {
    if (mode.value === m) return;
    if (m === '3d') {
      // fly from straight above the plan view down to an angled view of the same place
      this.world.sync();
      stale3d.value = false;
      const c = this.controls;
      const viewH = this.view.h / this.view.scale;
      const dist = Math.min(c.maxDist, Math.max(c.minDist, viewH / 2 / Math.tan((this.engine.camera.fov * Math.PI) / 360)));
      c.target.set(this.view.cx, this.hf.sampleSurface(this.view.cx, this.view.cz), this.view.cz);
      c.yaw = 0; c.pitch = 1.5; c.dist = dist; c.snap();
      c.pitch = 0.75; c.yaw = 0.35; c.dist = dist * 0.7;
      this.engine.setPlan(false); this.world.setPlan(false);
    } else {
      const c = this.controls, f = c.focus;
      const viewH = 2 * c.currentDist * Math.tan((this.engine.camera.fov * Math.PI) / 360);
      this.view.cx = f.x; this.view.cz = f.z;
      this.view.scale = Math.min(this.view.maxScale, Math.max(this.view.minScale, this.view.h / viewH));
      this.view.apply();
      this.engine.setPlan(true); this.world.setPlan(true);
    }
    mode.value = m;
    this.engine.plan = m === '2d';
    this.overlayDirty = true;
  }

  setXray(on: boolean) { xray.value = on; this.world.setXray(on); }

  /** vertical exaggeration in effect (terrain view in 3D) */
  exag = 1;
  applyExaggeration() {
    this.exag = terrainView.value ? settings.value.exaggeration : 1;
    this.world.setExaggeration(this.exag);
    this.overlayDirty = true;
  }

  zoomToSelection() {
    const b = this.selectionBox();
    if (b) this.zoomTo(b);
  }

  zoomTo(b: [number, number, number, number]) {
    if (mode.value === '2d') this.view.fit(b[0], b[1], b[2], b[3]);
    else {
      const c = this.controls;
      c.target.set((b[0] + b[2]) / 2, 0, (b[1] + b[3]) / 2);
      c.dist = Math.max(80, Math.hypot(b[2] - b[0], b[3] - b[1]) * 1.2);
    }
  }

  selectionBox(sel: Sel[] = selection.value): [number, number, number, number] | null {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    const grow = (x: number, z: number) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); };
    for (const s of sel) {
      const o = this.doc.get(s.id);
      if (s.kind === 'region') {
        const ring = o?.kind === 'region' ? o.ring : this.dpr.get(s.id)?.ring ?? [];
        for (let i = 0; i < ring.length; i += 2) grow(ring[i], ring[i + 1]);
        continue;
      }
      if (!o) continue;
      if (o.kind === 'junction') grow(o.x, o.z);
      const secs = o.kind === 'road' ? this.doc.sectionsOf(o.id) : o.kind === 'section' ? [o] : [];
      for (const sec of secs) { const g = this.C.geo(sec.id); if (g) { grow(g.x0, g.z0); grow(g.x1, g.z1); } }
      const pts = o.kind === 'line' ? o.pts : o.kind === 'building' ? o.outer : [];
      for (let i = 0; i < pts.length; i += 2) grow(pts[i], pts[i + 1]);
    }
    if (x0 === Infinity) return null;
    const pad = 20;
    return [x0 - pad, z0 - pad, x1 + pad, z1 + pad];
  }

  // ---------------- input ----------------

  private bindInput() {
    const el = this.overlay;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointerleave', () => { cursor.value = null; if (!this.drag) hover.value = null; this.overlayDirty = true; });
    el.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    window.addEventListener('keydown', (e) => { if (e.code === 'Space' && !isTyping(e)) { this.spaceDown = true; el.style.cursor = 'grab'; } });
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') { this.spaceDown = false; this.updateCursor(); } });
  }

  private local(e: PointerEvent | WheelEvent | MouseEvent): [number, number] {
    const r = this.overlay.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    if (mode.value === '3d') { this.controls.wheel(e); return; }
    const [sx, sy] = this.local(e);
    const px = e.deltaMode === 1 ? 33 : 1;
    // trackpads: two-finger scroll pans, pinch (ctrl) zooms; mouse wheels zoom (or pan, per settings)
    const trackpadPan = !e.ctrlKey && e.deltaMode === 0 && (Math.abs(e.deltaX) > 0 || !Number.isInteger(e.deltaY));
    if (trackpadPan || (settings.value.wheel === 'pan' && !e.ctrlKey) || e.shiftKey) {
      this.view.pan(-(e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * px, e.shiftKey && !e.deltaX ? 0 : -e.deltaY * px);
    } else {
      this.view.zoomAt(sx, sy, Math.exp(-e.deltaY * px * (e.ctrlKey ? 0.01 : 0.0015)));
    }
    zoomScale.value = this.view.scale;
    this.world.needsRender = true; this.overlayDirty = true;
  }

  private down(e: PointerEvent) {
    const s = this.local(e);
    const w = this.toWorld(...s);
    this.overlay.setPointerCapture(e.pointerId);
    this.mouse = s;
    const is3d = mode.value === '3d';
    if (tool.value === 'terrain' && e.button === 2 && !this.spaceDown && (settings.value.terrainOp === 'shift' || settings.value.terrainOp === 'level')) {
      const n = ++dragSeq;
      if (this.terra.down(w, 2, e.altKey, n)) { if (this.terra.stroke) this.drag = { kind: 'terrain', n }; return; }
    }
    if (e.button === 1 || e.button === 2 || this.spaceDown || tool.value === 'hand' || (is3d && e.button === 0 && e.altKey && tool.value !== 'pen')) {
      this.drag = { kind: 'pan', last: s, start: s, right: e.button === 2 };
      // 3D: right / Alt drag orbits, middle / Space / hand pans
      if (is3d) { this.controls.beginDrag(e, e.button === 2 || e.altKey ? 'rotate' : 'pan'); return; }
      this.overlay.style.cursor = 'grabbing';
      return;
    }
    if (e.button !== 0) return;
    const now = performance.now();
    const dbl = now - this.lastClick.t < 350 && Math.hypot(s[0] - this.lastClick.x, s[1] - this.lastClick.y) < 6;
    this.lastClick = { t: now, x: s[0], y: s[1] };
    if (dbl) { this.doubleClick(w, e); return; }
    const t = tool.value;
    if (t === 'pen') { if (settings.value.roadMode === 'freeform') return this.penDown(w, e); this.road.click(w, e.ctrlKey || e.metaKey, e.shiftKey, e.altKey); return; }
    if (t === 'wand') { void this.fillAt(w); return; }
    if (t === 'terrain') { const n = ++dragSeq; if (this.terra.down(w, 0, e.altKey, n) && this.terra.stroke) this.drag = { kind: 'terrain', n }; this.overlayDirty = true; return; }
    if (t === 'bulldoze') { const n = ++dragSeq; this.drag = { kind: 'bulldoze', n }; this.bulldozeAt(w, e.shiftKey, n); return; }
    if (t === 'line') return this.lineDown(w);
    if (t === 'measure') { this.drag = { kind: 'measure', a: w, b: w }; this.measure = { a: w, b: w }; return; }
    if (t === 'knife') return this.knife(w, e.shiftKey);
    // handles first (width handles in select, anchors in direct)
    const h = this.handleAt(s);
    if (h && !readOnly.value) {
      if (h.kind === 'width') { this.drag = { kind: 'width', h, moved: false, n: ++dragSeq }; return; }
      if (h.kind === 'anchor' || h.kind === 'in' || h.kind === 'out') {
        const o = this.doc.get(h.owner!);
        const base = o?.kind === 'section' ? ops.anchorsOf(this.doc, o) : o?.kind === 'line' ? [...o.pts] : null;
        if (base) {
          anchorSel.value = { owner: h.owner!, k: h.k!, handle: h.kind === 'anchor' ? undefined : h.kind };
          this.drag = { kind: 'anchor', owner: h.owner!, k: h.k!, handle: h.kind === 'anchor' ? undefined : h.kind, start: w, base, moved: false, n: ++dragSeq, alt: e.altKey };
          return;
        }
      }
    }
    const p = this.pickAt(w[0], w[1]);
    if (!p) {
      // 3D: dragging empty ground moves the camera (a click there clears the selection)
      if (is3d) { this.controls.beginDrag(e, 'pan'); return; }
      this.drag = { kind: 'marquee', a: w, b: w, add: e.shiftKey, deep: e.altKey || e.ctrlKey || e.metaKey };
      return;
    }
    const sel = this.selFor(p, e.altKey || e.ctrlKey || e.metaKey);
    const already = selection.value.some((x) => x.id === sel.id);
    if (e.shiftKey && !already) select([sel], true);
    else if (!already) select([sel]);
    if (readOnly.value) return;
    if (e.shiftKey && already) {
      // shift-drag on a selected thing: move the whole selection
      this.drag = { kind: 'move', ids: selection.value.map((x) => x.id), start: w, last: w, moved: false, n: ++dragSeq };
      return;
    }
    if (p.kind === 'region') return;
    if (p.kind === 'junction') { const j = this.doc.get<'junction'>(p.id)!; this.drag = { kind: 'junction', id: p.id, start: w, orig: [j.x, j.z], moved: false, n: ++dragSeq }; }
    else if (p.kind === 'section' && tool.value === 'select') {
      const s0 = this.doc.get<'section'>(p.id)!;
      this.drag = { kind: 'bend', id: p.id, base: ops.anchorsOf(this.doc, s0), grab: p.p ?? w, start: w, moved: false, n: ++dragSeq };
    } else if (p.kind === 'line') this.drag = { kind: 'move', ids: [p.id], start: w, last: w, moved: false, n: ++dragSeq };
  }

  private move(e: PointerEvent) {
    const s = this.local(e);
    const w = this.toWorld(...s);
    this.mouse = s;
    cursor.value = w;
    this.overlayDirty = true;
    const d = this.drag;
    if (!d) { this.hoverAt(s, w, e); return; }
    const moved = (a: [number, number]) => Math.hypot(w[0] - a[0], w[1] - a[1]) * this.ppm > 3;
    switch (d.kind) {
      case 'pan': if (mode.value === '2d') this.view.pan(s[0] - d.last[0], s[1] - d.last[1]); d.last = s; this.world.needsRender = true; break;
      case 'marquee': d.b = w; break;
      case 'bulldoze': this.bulldozeAt(w, e.shiftKey, d.n); break;
      case 'terrain': this.terra.move(w); break;
      case 'measure': d.b = this.snapPoint(w, e.shiftKey ? d.a : null).p; this.measure = { a: d.a, b: d.b }; break;
      case 'junction': {
        if (!d.moved && !moved(d.start)) break;
        d.moved = true;
        const sp = this.snapPoint([d.orig[0] + w[0] - d.start[0], d.orig[1] + w[1] - d.start[1]], null, new Set([d.id]));
        this.snap = sp.snap;
        this.edit('Move junction', () => ops.moveJunction(this.doc, d.id, sp.p[0], sp.p[1]), 'drag' + d.n);
        break;
      }
      case 'bend': {
        if (!d.moved && !moved(d.start)) break;
        d.moved = true;
        this.edit('Bend road', () => ops.bendSection(this.doc, d.id, d.base, d.grab, w[0] - d.start[0], w[1] - d.start[1]), 'drag' + d.n);
        break;
      }
      case 'move': {
        if (!d.moved && !moved(d.start)) break;
        d.moved = true;
        const dx = w[0] - d.last[0], dz = w[1] - d.last[1];
        d.last = w;
        this.edit('Move', () => ops.translate(this.doc, d.ids, dx, dz), 'drag' + d.n);
        break;
      }
      case 'width': this.dragWidth(d, w, e.altKey); break;
      case 'anchor': this.dragAnchor(d, w, e.altKey || d.alt); break;
      case 'pen': {
        const p = this.pen.pts[d.idx];
        if (Math.hypot(w[0] - d.start[0], w[1] - d.start[1]) * this.ppm > 4) { p.hx = (w[0] - d.start[0]) / 2; p.hz = (w[1] - d.start[1]) / 2; }
        break;
      }
    }
    if (d.kind === 'pen' || (tool.value === 'pen' && settings.value.roadMode === 'freeform')) this.penHover(w, e.shiftKey, e.ctrlKey || e.metaKey);
    else if (tool.value === 'pen') this.road.hover(w, e.ctrlKey || e.metaKey, e.shiftKey);
  }

  private up(e: PointerEvent) {
    const d = this.drag;
    this.drag = null;
    this.snap = null;
    this.overlayDirty = true;
    this.updateCursor();
    if (!d) return;
    if (mode.value === '3d' && d.kind !== 'pan') this.syncSoon(0);
    const w = this.toWorld(...this.local(e));
    if (d.kind === 'terrain') {
      this.terra.up(w);
      const p = this.pendingTerrain;
      this.pendingTerrain = null;
      if (p) this.redrape(p);
      return;
    }
    // right-click without dragging: step back, as in Cities: Skylines
    if (d.kind === 'pan' && d.right && Math.hypot(d.last[0] - d.start[0], d.last[1] - d.start[1]) < 4) { this.stepBack(); return; }
    if (d.kind === 'marquee') {
      const [ax, az] = d.a, [bx, bz] = d.b;
      if (Math.hypot(bx - ax, bz - az) * this.ppm < 4) { if (!d.add) select([]); return; }
      const r: [number, number, number, number] = [Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)];
      const kinds: Kind[] = tool.value === 'direct' || d.deep ? ['section', 'junction', 'line'] : ['section', 'junction', 'line'];
      const ids = this.hit.inRect(...r, kinds, this.canPick);
      const out = new Map<Id, Sel>();
      for (const id of ids) {
        const o = this.doc.get(id)!;
        if (o.kind === 'section') { const s = d.deep ? { kind: 'section' as const, id } : { kind: 'road' as const, id: o.road }; out.set(s.id, s); }
        else if (o.kind === 'line') out.set(id, { kind: 'line', id });
      }
      // junctions only when nothing else was caught
      if (!out.size) for (const id of ids) if (this.doc.get(id)?.kind === 'junction') out.set(id, { kind: 'junction', id });
      select([...out.values()], d.add);
      status.value = `${out.size} selected`;
      return;
    }
    if (d.kind === 'junction' && d.moved) {
      // dropped on another junction / a road → connect
      const j = this.doc.get<'junction'>(d.id);
      if (j) {
        const other = this.hit.nearestJunction(j.x, j.z, 8 / this.ppm + 0.5, new Set([d.id]));
        const atSecs = new Set(this.doc.sectionsAt(d.id).map((s) => s.id));
        if (other) { this.edit('Connect junctions', () => ops.mergeJunctions(this.doc, d.id, other.id), 'drag' + d.n); toast('Junctions merged', 'ok'); }
        else if (this.doc.sectionsAt(d.id).length <= 2) {
          const sec = this.hit.nearestSection(j.x, j.z, 6 / this.ppm + 0.5, atSecs);
          if (sec) { this.edit('Connect to road', () => ops.connectToSection(this.doc, d.id, sec.id, sec.p), 'drag' + d.n); toast('Connected to the road', 'ok'); }
        }
      }
    }
    if (d.kind === 'measure') { status.value = `Distance ${Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1]).toFixed(1)} m`; return; }
    if (d.kind === 'pen') return;
    void w;
  }

  private doubleClick(w: [number, number], e: PointerEvent) {
    const t = tool.value;
    if (t === 'terrain') { this.terra.finish(); return; }
    if (t === 'pen') { this.finishPen(); return; }
    if (t === 'line') { this.finishLine(); return; }
    const p = this.pickAt(w[0], w[1]);
    if (t === 'direct' && p && (p.kind === 'section' || p.kind === 'line')) { this.insertAnchor(p, w); return; }
    if (p?.kind === 'section') {
      const cur = selection.value;
      if (cur.length === 1 && cur[0].kind === 'section' && cur[0].id === p.id) { tool.value = 'direct'; status.value = 'Editing points — drag anchors and handles; Esc when done'; return; }
      select([{ kind: 'section', id: p.id }]);
      return;
    }
    if (p?.kind === 'line') { select([{ kind: 'line', id: p.id }]); tool.value = 'direct'; return; }
    if (!p && e) select([]);
  }

  /** Right-click in the road tool: drop the last point, or stop the road being drawn. */
  stepBack() {
    if (tool.value !== 'pen') return;
    if (settings.value.roadMode === 'freeform') {
      if (this.pen.pts.length) { this.pen.pts.pop(); this.overlayDirty = true; }
      return;
    }
    this.road.back();
  }

  private hoverAt(s: [number, number], w: [number, number], e?: PointerEvent) {
    const ctrl = !!(e?.ctrlKey || e?.metaKey), shift = !!e?.shiftKey;
    if (tool.value === 'pen') {
      if (settings.value.roadMode === 'freeform') this.penHover(w, shift, ctrl);
      else this.road.hover(w, ctrl, shift);
      return;
    }
    if (tool.value === 'terrain') { this.terra.cursor = w; this.overlayDirty = true; return; }
    if (tool.value === 'bulldoze') {
      const p = this.pickAt(w[0], w[1]);
      const next: Sel | null = !p ? null : p.kind === 'section' ? (shift ? { kind: 'road', id: this.doc.get<'section'>(p.id)!.road } : { kind: 'section', id: p.id }) : { kind: p.kind, id: p.id };
      if (next?.id !== hover.value?.id) hover.value = next;
      return;
    }
    if (tool.value === 'line') { this.pen.cursor = w; return; }
    const h = this.handleAt(s);
    this.overlay.style.cursor = h ? (h.kind === 'width' ? 'ew-resize' : 'move') : this.baseCursor();
    if (h) { hover.value = null; return; }
    const p = this.pickAt(w[0], w[1]);
    const next = p ? this.selFor(p, false) : null;
    if (next?.id !== hover.value?.id) hover.value = next;
    this.dpHover = p?.kind === 'region' ? this.dpr.get(p.id) ?? null : null;
    if (p && !h) this.overlay.style.cursor = readOnly.value ? 'pointer' : p.kind === 'junction' ? 'move' : 'pointer';
  }

  private baseCursor() {
    return { select: 'default', direct: 'default', pen: 'crosshair', knife: 'crosshair', line: 'crosshair', measure: 'crosshair', hand: 'grab', bulldoze: 'crosshair', wand: 'cell', terrain: 'crosshair' }[tool.value];
  }
  updateCursor() { this.overlay.style.cursor = this.spaceDown ? 'grab' : this.baseCursor(); }

  private handleAt(s: [number, number]): Handle | null {
    let best: Handle | null = null, bd = 9;
    for (const h of this.handles) { const d = Math.hypot(h.sx - s[0], h.sy - s[1]); if (d < bd) { bd = d; best = h; } }
    return best;
  }

  // ---------------- snapping ----------------

  /** Snap a point to junctions, then road centre lines; with `from`, Shift-style 15° angle steps. */
  snapPoint(w: [number, number], from: [number, number] | null, exclude?: Set<Id>): { p: [number, number]; snap: Snap | null; junction?: Id; section?: Id } {
    if (!settings.value.snap) return { p: w, snap: null };
    const r = 10 / this.ppm;
    const j = this.hit.nearestJunction(w[0], w[1], r, exclude);
    if (j) { const o = this.doc.get<'junction'>(j.id)!; return { p: [o.x, o.z], snap: { kind: 'junction', p: [o.x, o.z], id: j.id }, junction: j.id }; }
    const exS = exclude ? new Set([...exclude].flatMap((id) => this.doc.sectionsAt(id).map((s) => s.id))) : undefined;
    const s = this.hit.nearestSection(w[0], w[1], r * 0.8, exS);
    if (s) return { p: s.p, snap: { kind: 'section', p: s.p, id: s.id }, section: s.id };
    if (from) {
      const dx = w[0] - from[0], dz = w[1] - from[1], L = Math.hypot(dx, dz);
      const a = Math.round(Math.atan2(dz, dx) / (Math.PI / 12)) * (Math.PI / 12);
      const p: [number, number] = [from[0] + Math.cos(a) * L, from[1] + Math.sin(a) * L];
      return { p, snap: { kind: 'angle', p, label: `${Math.round(((-a * 180) / Math.PI + 360) % 360)}°` } };
    }
    return { p: w, snap: null };
  }

  // ---------------- width handles ----------------

  private dragWidth(d: Extract<Drag, { kind: 'width' }>, w: [number, number], oneSide: boolean) {
    const h = d.h;
    const sec = this.doc.get<'section'>(h.section!);
    if (!sec) return;
    // lateral distance from the centre line at the handle's station
    const nx = h.nx!, nz = h.nz!, cx = h.cx!, cz = h.cz!;
    const off = Math.abs((w[0] - cx) * nx + (w[1] - cz) * nz);
    d.moved = true;
    let total: number, label: string;
    if (oneSide) {
      const side = h.side!;
      let hw = Math.max(1, off);
      hw = Math.round(hw * 10) / 10;
      const parts = setSideWidth(sec.parts, side, hw);
      total = totalWidth(parts);
      label = `${side === 'L' ? 'left' : 'right'} ${hw.toFixed(1)} m · total ${total.toFixed(1)} m`;
      this.applyParts(h, parts, d.n);
    } else {
      total = Math.max(2.5, off * 2);
      const snapTo = DP_WIDTHS.find((x) => Math.abs(x - total) < 0.35);
      total = snapTo ?? Math.round(total * 2) / 2;
      label = `${total.toFixed(1)} m${snapTo ? ' · DP standard' : ''}`;
      this.applyParts(h, setTotalWidth(sec.parts, total), d.n);
    }
    this.snap = { kind: 'width', p: w, label };
  }

  private applyParts(h: Handle, parts: SectionObj['parts'], n: number) {
    if (h.road) this.edit('Road width', () => this.doc.set(h.road!, 'parts', parts), 'drag' + n);
    else this.edit('Section width', () => this.doc.set(h.section!, 'parts', parts), 'drag' + n);
  }

  // ---------------- anchors ----------------

  private dragAnchor(d: Extract<Drag, { kind: 'anchor' }>, w: [number, number], alt: boolean) {
    const o = this.doc.get(d.owner);
    if (!o) return;
    const dx = w[0] - d.start[0], dz = w[1] - d.start[1];
    if (!d.moved && Math.hypot(dx, dz) * this.ppm < 3) return;
    d.moved = true;
    if (o.kind === 'line') {
      const pts = [...(d.base as number[])];
      const sp = this.snapPoint([pts[d.k * 2] + dx, pts[d.k * 2 + 1] + dz], null);
      pts[d.k * 2] = Math.round(sp.p[0] * 100) / 100; pts[d.k * 2 + 1] = Math.round(sp.p[1] * 100) / 100;
      this.edit('Move point', () => this.doc.set(o.id, 'pts', pts), 'drag' + d.n);
      return;
    }
    if (o.kind !== 'section') return;
    const P = (d.base as Anchor[]).map((a) => ({ ...a }));
    const a = P[d.k];
    const last = P.length - 1;
    if (!d.handle) {
      if (d.k === 0 || d.k === last) {
        // an end anchor is the junction
        const jid = d.k === 0 ? o.a : o.b;
        const sp = this.snapPoint([a.x + dx, a.z + dz], null, new Set([jid]));
        this.snap = sp.snap;
        this.edit('Move junction', () => ops.moveJunction(this.doc, jid, sp.p[0], sp.p[1]), 'drag' + d.n);
        return;
      }
      a.x += dx; a.z += dz;
    } else {
      const hx = (d.handle === 'out' ? a.ox : a.ix) + dx, hz = (d.handle === 'out' ? a.oz : a.iz) + dz;
      if (d.handle === 'out') { a.ox = hx; a.oz = hz; } else { a.ix = hx; a.iz = hz; }
      // keep the curve smooth through the anchor (opposite handle aligned, own length) unless Alt
      if (!alt && d.k > 0 && d.k < last) {
        const L = Math.hypot(d.handle === 'out' ? a.ix : a.ox, d.handle === 'out' ? a.iz : a.oz);
        const l = Math.hypot(hx, hz) || 1;
        if (d.handle === 'out') { a.ix = (-hx / l) * L; a.iz = (-hz / l) * L; } else { a.ox = (-hx / l) * L; a.oz = (-hz / l) * L; }
      }
    }
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const path = P.map((p) => ({ ...p, x: r2(p.x), z: r2(p.z), ix: r2(p.ix), iz: r2(p.iz), ox: r2(p.ox), oz: r2(p.oz) }));
    this.edit(d.handle ? 'Adjust curve' : 'Move point', () => this.doc.set(o.id, 'path', path), 'drag' + d.n);
  }

  private insertAnchor(p: Pick, w: [number, number]) {
    const o = this.doc.get(p.id);
    if (o?.kind === 'line') {
      // insert a vertex on the nearest segment
      let bi = 0, bd = Infinity;
      for (let i = 0; i + 3 < o.pts.length; i += 2) {
        const ax = o.pts[i], az = o.pts[i + 1], dx = o.pts[i + 2] - ax, dz = o.pts[i + 3] - az;
        const t = Math.max(0, Math.min(1, ((w[0] - ax) * dx + (w[1] - az) * dz) / (dx * dx + dz * dz || 1)));
        const d = Math.hypot(w[0] - ax - dx * t, w[1] - az - dz * t);
        if (d < bd) { bd = d; bi = i / 2; }
      }
      const pts = [...o.pts];
      pts.splice((bi + 1) * 2, 0, Math.round(w[0] * 100) / 100, Math.round(w[1] * 100) / 100);
      this.edit('Add point', () => this.doc.set(o.id, 'pts', pts));
      anchorSel.value = { owner: o.id, k: bi + 1 };
      return;
    }
    if (o?.kind !== 'section') return;
    const P = ops.anchorsOf(this.doc, o);
    const n = ops.nearestOnPath(P, w);
    const C = ops.cubicsOf(P);
    const [l, r] = ops.splitCubic(C[n.k], n.t);
    const r2 = (v: number) => Math.round(v * 100) / 100;
    const lift = P[n.k].lift + (P[n.k + 1].lift - P[n.k].lift) * n.t;
    const nA: Anchor = { x: r2(l[6]), z: r2(l[7]), ix: r2(l[4] - l[6]), iz: r2(l[5] - l[7]), ox: r2(r[2] - r[0]), oz: r2(r[3] - r[1]), lift: r2(lift) };
    const path = P.map((a) => ({ ...a }));
    path[n.k] = { ...path[n.k], ox: r2(l[2] - l[0]), oz: r2(l[3] - l[1]) };
    path[n.k + 1] = { ...path[n.k + 1], ix: r2(r[4] - r[6]), iz: r2(r[5] - r[7]) };
    path.splice(n.k + 1, 0, nA);
    this.edit('Add point', () => this.doc.set(o.id, 'path', path));
    select([{ kind: 'section', id: o.id }]);
    anchorSel.value = { owner: o.id, k: n.k + 1 };
  }

  deleteAnchor() {
    const a = anchorSel.value;
    if (!a) return false;
    const o = this.doc.get(a.owner);
    if (o?.kind === 'line') {
      if (o.pts.length <= 4) return false;
      const pts = [...o.pts]; pts.splice(a.k * 2, 2);
      this.edit('Delete point', () => this.doc.set(o.id, 'pts', pts));
      anchorSel.value = null;
      return true;
    }
    if (o?.kind !== 'section' || a.k === 0 || a.k === o.path.length - 1) return false;
    const P = ops.anchorsOf(this.doc, o);
    const S = ops.samplePath(P, 16);
    // refit without that anchor: keep the others as they are, merge the two pieces around it
    const path = P.filter((_, i) => i !== a.k).map((p) => ({ ...p }));
    const prev = path[a.k - 1], next = path[a.k];
    const L = Math.hypot(next.x - prev.x, next.z - prev.z) / 3;
    const nrm = (x: number, z: number) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };
    const [ox, oz] = nrm(prev.ox, prev.oz), [ix, iz] = nrm(next.ix, next.iz);
    prev.ox = ox * L; prev.oz = oz * L; next.ix = ix * L; next.iz = iz * L;
    void S;
    this.edit('Delete point', () => this.doc.set(o.id, 'path', path));
    anchorSel.value = null;
    return true;
  }

  // ---------------- pen ----------------

  /** The freeform pen snaps like the road tool, from its last point along the last leg. */
  private penSnap(w: [number, number], shift: boolean, ctrl: boolean): SnapResult {
    const P = this.pen.pts, n = P.length;
    const from: [number, number] | null = n ? [P[n - 1].x, P[n - 1].z] : null;
    let dir: [number, number] | null = null;
    if (n >= 2) { const dx = P[n - 1].x - P[n - 2].x, dz = P[n - 1].z - P[n - 2].z, l = Math.hypot(dx, dz); if (l > 0.1) dir = [dx / l, dz / l]; }
    return this.road.snap(w, ctrl, shift, from, dir);
  }

  private penHover(w: [number, number], shift: boolean, ctrl = false) {
    const sp = this.penSnap(w, shift, ctrl);
    this.pen.cursor = sp.p;
    this.pen.snap = null;
    this.road.cursor = sp;
  }

  private penDown(w: [number, number], e: PointerEvent) {
    if (readOnly.value) { toast('Read-only map', 'warn'); return; }
    const sp = this.penSnap(w, e.shiftKey, e.ctrlKey || e.metaKey);
    const pt: ops.PenPoint = { x: sp.p[0], z: sp.p[1], junction: sp.junction, section: sp.section, lift: sp.lift };
    this.pen.pts.push(pt);
    this.drag = { kind: 'pen', idx: this.pen.pts.length - 1, start: sp.p };
    if (this.pen.pts.length >= 2 && (sp.junction || sp.section)) {
      // ended on the network: finish when the mouse comes up
      const done = () => { window.removeEventListener('pointerup', done); this.finishPen(); };
      window.addEventListener('pointerup', done);
    } else status.value = this.pen.pts.length === 1 ? 'Click to add points · drag for curves · end on a road or press Enter' : `${this.pen.pts.length} points · Enter to finish · Esc to cancel`;
  }

  finishPen() {
    const pts = this.pen.pts;
    this.pen = { pts: [], cursor: this.pen.cursor, snap: null };
    if (pts.length < 2) { status.value = ''; return; }
    // drop accidental duplicate points
    const clean = pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) > 0.5);
    if (clean.length < 2) return;
    const res = this.edit('Draw road', () => {
      const rid = ops.createRoad(this.doc, clean, penClass.value);
      return rid ? { rid, ...ops.autoConnect(this.doc, this.doc.sectionsOf(rid).map((s) => s.id)) } : null;
    });
    if (res) {
      select([{ kind: 'road', id: res.rid }]);
      toast(`Road added${res.joined ? ` · ${res.joined} new junction${res.joined > 1 ? 's' : ''}` : ''}${res.bridged ? ` · passes over ${res.bridged} road${res.bridged > 1 ? 's' : ''}` : ''}`, 'ok');
    }
    status.value = '';
  }

  cancelPen() { this.pen = { pts: [], cursor: null, snap: null }; this.linePts = []; this.road.cancel(); status.value = ''; this.overlayDirty = true; }

  // ---------------- fill tool (DP sheet → survey region) ----------------

  /** Trace the DP sheet fill under a point into a new survey region. */
  async fillAt(w: [number, number]) {
    if (readOnly.value) { toast('This map is read-only', 'warn'); return; }
    const D = this.dpr;
    D.load();
    if (!D.sheetIndex) { toast('Loading the DP sheets — try again in a moment', 'info', undefined, 1500); return; }
    status.value = 'Tracing the DP sheet…';
    let r = await traceAt(this, w[0], w[1]);
    if (r?.touchesEdge) r = (await traceAt(this, w[0], w[1], 1000)) ?? r;
    if (!r) { status.value = ''; toast('Nothing to fill there — click inside a coloured plot on the DP sheet (roads and unzoned land are white)', 'warn'); return; }
    // land use: the legend colour nearest the fill
    const hex = (c: string) => [1, 3, 5].map((k) => parseInt(c.slice(k, k + 2), 16));
    let cls = 'residential', bd = Infinity;
    for (const [k, v] of Object.entries(D.data?.classes ?? {})) { const c = hex(v.color); const d = Math.hypot(c[0] - r.rgb[0], c[1] - r.rgb[1], c[2] - r.rgb[2]); if (d < bd) { bd = d; cls = k; } }
    const id = newId('rg');
    const ok = this.edit('Trace region', () => this.doc.create({ kind: 'region', id, cls, reserved: r!.reserved, ring: r!.ring, area: r!.area, status: 'unsurveyed' }));
    if (ok === undefined && !this.doc.get(id)) return;
    if (!dpRegionsOn.value) dpRegionsOn.value = true;
    select([{ kind: 'region', id }]);
    this.overlayDirty = true;
    status.value = '';
    toast(`Traced ${r.area.toLocaleString()} m² of ${D.classLabel(cls).toLowerCase()}${r.reserved ? ' (reserved site)' : ''}${r.touchesEdge ? ' — it runs past 1 km, only part was traced' : ''}`, r.touchesEdge ? 'warn' : 'ok');
  }

  // ---------------- bulldozer ----------------

  /** Delete what's under the cursor (a section; Shift = the whole road). One undo step per sweep. */
  private bulldozeAt(w: [number, number], whole: boolean, n: number) {
    if (readOnly.value) return;
    const p = this.pickAt(w[0], w[1]);
    if (!p) return;
    this.edit('Bulldoze', () => {
      if (p.kind === 'section') { if (whole) ops.deleteRoad(this.doc, this.doc.get<'section'>(p.id)!.road); else ops.deleteSections(this.doc, [p.id]); }
      else if (p.kind === 'junction') ops.deleteJunction(this.doc, p.id);
      else this.doc.remove(p.id);
    }, 'drag' + n);
    hover.value = null;
  }

  // ---------------- line tool ----------------

  private lineDown(w: [number, number]) {
    if (readOnly.value) return;
    const sp = this.snapPoint(w, null);
    this.linePts.push(sp.p[0], sp.p[1]);
    status.value = `${this.linePts.length / 2} points · Enter or double-click to finish`;
  }

  finishLine() {
    const pts = this.linePts;
    this.linePts = [];
    if (pts.length < 4) return;
    const layer = lineLayer.value || [...this.doc.all('layer')].find((l) => l.type === 'lines' && l.group === 'underground')?.id;
    const L = layer ? this.doc.get<'layer'>(layer) : undefined;
    if (!L) { toast('Choose a layer for the line first', 'warn'); return; }
    const kind = L.lineKind ?? 'other';
    const id = this.edit('Draw line', () => ops.createLine(this.doc, L.id, pts, DEFAULT_DEPTH[kind], DEFAULT_SIZE[kind]));
    if (id) { select([{ kind: 'line', id }]); toast(`Added to ${L.name}`, 'ok'); }
    status.value = '';
  }

  // ---------------- knife ----------------

  private knife(w: [number, number], join: boolean) {
    const p = this.pickAt(w[0], w[1]);
    if (!p) return;
    if (p.kind === 'junction' || join) {
      const jid = p.kind === 'junction' ? p.id : undefined;
      if (jid && this.doc.sectionsAt(jid).length === 2) { const id = this.edit('Join sections', () => ops.joinAt(this.doc, jid)); if (id) select([{ kind: 'section', id }]); }
      else toast('Only a junction between exactly two sections can be joined', 'warn');
      return;
    }
    if (p.kind === 'section') {
      const r = this.edit('Split section', () => ops.splitSection(this.doc, p.id, p.p ?? w));
      if (r) { select([{ kind: 'section', id: r.parts[1] }]); toast('Section split — each part can now be edited on its own', 'ok'); }
      else toast('Too close to the end of the section', 'warn');
    }
  }

  // ---------------- 3D picking ----------------

  private click3d(cx: number, cy: number) {
    if (tool.value !== 'select' && tool.value !== 'direct') return;
    const p = this.controls.pick(cx, cy);
    const k = p ? this.pickAt(p.x, p.z) : null;
    select(k ? [this.selFor(k, false)] : []);
  }

  private hover3d(cx: number, cy: number) {
    const p = this.controls.pick(cx, cy);
    const k = p ? this.pickAt(p.x, p.z) : null;
    const next = k ? this.selFor(k, false) : null;
    if (next?.id !== hover.value?.id) { hover.value = next; this.overlayDirty = true; }
  }

  /** World → screen for the active view. */
  project(x: number, z: number, lift = 0): [number, number] | null {
    if (mode.value === '2d') return this.view.toScreen(x, z);
    const v = new THREE.Vector3(x, (this.hf.sampleSurface(x, z) + 0.4 + lift) * this.exag, z).project(this.engine.camera);
    if (v.z > 1) return null;
    return [(v.x + 1) / 2 * this.view.w, (1 - v.y) / 2 * this.view.h];
  }

  // ---------------- frame ----------------

  frame(now: number) {
    if (mode.value === '2d' && this.view.tick(now)) { this.world.needsRender = true; this.overlayDirty = true; zoomScale.value = this.view.scale; }
    if (this.overlayDirty) { this.overlayDirty = false; drawOverlay(this); }
  }

  setTool(t: Tool) {
    if (t !== 'pen' && t !== 'line') this.cancelPen();
    hover.value = null;
    if (t === 'wand') { this.dpr.load(); if (!this.doc.get<'layer'>('dp')?.visible) this.app.toggleLayer('dp'); }
    if (t !== 'terrain') this.terra.cancel();
    if (t === 'terrain' && !terrainView.value) { terrainView.value = true; this.applyExaggeration(); }
    if (t !== 'measure') this.measure = null;
    tool.value = t;
    this.updateCursor();
    this.overlayDirty = true;
    status.value = {
      select: 'Click a road to select it · double-click for one section · drag to bend · Shift-drag to move',
      direct: 'Drag points and curve handles · double-click a road to add a point · Alt breaks the curve',
      pen: this.road.hint(),
      bulldoze: 'Click a road section to remove it · Shift = the whole road · drag to sweep',
      wand: 'Click a coloured plot on the DP sheet to trace it as a survey region',
      terrain: this.terra.hint(),
      knife: 'Click a road to split it · click a junction between two sections to join them',
      line: 'Click points to draw a line in the chosen layer · Enter to finish',
      measure: 'Drag to measure · hover a road to read its width',
      hand: 'Drag to pan',
    }[t];
  }
}

export function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
