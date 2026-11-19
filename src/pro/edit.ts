// Drawing and editing on the 3D (or the plan): the one place the plot, what's on it and the buildings are drawn.
// A tool is picked in the panel; the canvas does the rest:
// - select: click a building or a thing to pick it, drag it to move it; on the Site step drag the plot's corners;
// - a point (a tree, a well, a pole, a tower block): one click;
// - a line (a power line, an internal road, a building's own wings): click along it, double-click or Enter to finish;
// - an area (the plot, a structure, a no-build zone, a garden…): click its corners and close it (click the first
//   corner, double-click or Enter), or drag out a rectangle.
// Points snap to the plot's corners and to half a metre; Shift keeps a line square to the road. Escape cancels,
// Delete removes what's picked. Everything goes through `commit`, so it's one undo step each.
import { roadFrame, buildingQuads, newBuildingId, pointIn, type SiteElement, type ElementKind } from '../doc/site';
import type { ProView, Overlay } from './scene';
import type { Evaluated } from './evaluate';
import { outline, ownScheme, type ProBuilding, type ProProject } from './project';
import { featureOf, newId, type FeatureKind, type SiteFeature } from './siteObjects';

export type BuildingShape = 'slab' | 'tower' | 'L' | 'U' | 'court' | 'draw';
export type Tool =
  | { k: 'select' }
  | { k: 'plot' }
  | { k: 'feature'; kind: FeatureKind }
  | { k: 'building'; shape: BuildingShape }
  | { k: 'element'; kind: Extract<ElementKind, 'garden' | 'play' | 'trees' | 'lot' | 'road' | 'parking'> };
export const SELECT: Tool = { k: 'select' };

/** what's picked: a building, a thing on the site, a feature, or nothing */
export type Picked = { k: 'building'; id: string } | { k: 'element'; id: string } | { k: 'feature'; id: string } | null;

export const BUILDING_SHAPES: { shape: BuildingShape; label: string; icon: string; hint: string }[] = [
  { shape: 'slab', label: 'Slab', icon: 'slab', hint: 'Click where it goes: a block 36 m long, flats both sides of a corridor.' },
  { shape: 'tower', label: 'Tower', icon: 'tower', hint: 'Click where it goes: a compact point block.' },
  { shape: 'L', label: 'L', icon: 'lshape', hint: 'Click where its corner goes.' },
  { shape: 'U', label: 'U', icon: 'ushape', hint: 'Click where its middle goes.' },
  { shape: 'court', label: 'Courtyard', icon: 'court', hint: 'Click where its middle goes: four wings round a court.' },
  { shape: 'draw', label: 'Draw', icon: 'edit', hint: 'Click along its wings, double-click or Enter to finish. Any shape.' },
];
export const ELEMENT_TOOLS: { kind: Extract<Tool, { k: 'element' }>['kind']; label: string; icon: string; hint: string }[] = [
  { kind: 'garden', label: 'Garden', icon: 'leaf', hint: 'Drag out its area, or click its corners.' },
  { kind: 'play', label: 'Play area', icon: 'play', hint: 'Drag out its area, or click its corners.' },
  { kind: 'trees', label: 'Trees', icon: 'tree', hint: 'Drag out the stand, or click its corners.' },
  { kind: 'lot', label: 'Parking', icon: 'car', hint: 'Surface bays: drag out the area, or click its corners.' },
  { kind: 'parking', label: 'Car park', icon: 'layers', hint: 'A multi-storey car park: drag out its area.' },
  { kind: 'road', label: 'Road', icon: 'road', hint: 'Click along it, double-click or Enter to finish.' },
];

const SNAP_PX = 12, GRID = 0.5;
type Mode = 'point' | 'line' | 'area';
const modeOf = (t: Tool): Mode | null => {
  if (t.k === 'plot') return 'area';
  if (t.k === 'feature') return featureOf(t.kind).shape;
  if (t.k === 'building') return t.shape === 'draw' ? 'line' : 'point';
  if (t.k === 'element') return t.kind === 'road' ? 'line' : 'area';
  return null;
};

/** a building of a shape at x, z, its long side along the road (u) */
function shapeAt(shape: BuildingShape, x: number, z: number, u: [number, number], v: [number, number]): Pick<ProBuilding, 'spine' | 'depth' | 'closed'> {
  const P = (a: number, b: number) => [x + u[0] * a + v[0] * b, z + u[1] * a + v[1] * b];
  const r2 = (n: number[]) => n.map((q) => Math.round(q * 100) / 100);
  switch (shape) {
    case 'tower': return { spine: r2([...P(-11, 0), ...P(11, 0)]), depth: 20 };
    case 'L': return { spine: r2([...P(-20, 0), ...P(0, 0), ...P(0, 22)]), depth: 14 };
    case 'U': return { spine: r2([...P(-18, 18), ...P(-18, 0), ...P(18, 0), ...P(18, 18)]), depth: 14 };
    case 'court': return { spine: r2([...P(-18, -14), ...P(18, -14), ...P(18, 14), ...P(-18, 14)]), depth: 12, closed: true };
    default: return { spine: r2([...P(-18, 0), ...P(18, 0)]), depth: 16 };
  }
}

export interface EditHost {
  view: () => ProView | null;
  p: () => ProProject;
  e: () => Evaluated;
  up: (o: Partial<ProProject>) => void;
  /** which step is open: the site's corners are dragged on the Site step, buildings on the others */
  step: () => string;
  picked: () => Picked;
  pick: (x: Picked) => void;
  /** the tool finished (back to select) */
  done: () => void;
  /** a word for the user: what to do next */
  hint: (s: string | null) => void;
  readOnly: () => boolean;
}

export class CanvasEdit {
  tool: Tool = SELECT;
  private pts: number[] = [];
  private hover: [number, number] | null = null;
  private drag: null | { kind: 'move'; what: Picked; from: [number, number]; base: ProProject; moved: boolean; y: number } | { kind: 'corner'; i: number; base: ProProject } | { kind: 'rect'; from: [number, number]; to: [number, number] } = null;
  private downAt: [number, number] | null = null;
  private off: (() => void)[] = [];

  constructor(private canvas: HTMLCanvasElement, private h: EditHost) {
    const on = <K extends keyof HTMLElementEventMap>(t: K, f: (e: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions) => { canvas.addEventListener(t, f as EventListener, o); this.off.push(() => canvas.removeEventListener(t, f as EventListener, o)); };
    on('pointerdown', (e) => this.down(e), { capture: true });
    on('pointermove', (e) => this.move(e));
    on('pointerup', (e) => this.upE(e));
    on('dblclick', (e) => { if (modeOf(this.tool) && this.pts.length) { e.preventDefault(); this.finish(); } });
    const key = (e: KeyboardEvent) => this.key(e);
    addEventListener('keydown', key);
    this.off.push(() => removeEventListener('keydown', key));
  }
  dispose() { this.off.forEach((f) => f()); }

  setTool(t: Tool) {
    this.tool = t; this.pts = []; this.drag = null;
    this.canvas.style.cursor = t.k === 'select' ? '' : 'crosshair';
    const v = this.h.view(); if (v) v.controls.enabled = true;
    this.h.hint(this.hintFor());
    this.draw();
  }
  private hintFor(): string | null {
    const t = this.tool;
    if (t.k === 'plot') return 'Click the plot’s corners. Close it on the first corner, or press Enter.';
    if (t.k === 'feature') return featureOf(t.kind).hint;
    if (t.k === 'building') return BUILDING_SHAPES.find((s) => s.shape === t.shape)!.hint;
    if (t.k === 'element') return ELEMENT_TOOLS.find((s) => s.kind === t.kind)!.hint;
    return null;
  }

  // ---------- snapping ----------
  private snap(px: number, py: number, shift: boolean): [number, number] | null {
    const v = this.h.view(); if (!v) return null;
    const g = v.groundAt(px, py); if (!g) return null;
    const rect = this.canvas.getBoundingClientRect(), sx = px - rect.left, sy = py - rect.top;
    // to a corner of the plot, of a building, or of what's being drawn
    const e = this.h.e(), cands: number[] = [...e.r.net, ...this.pts];
    for (const b of e.d.buildings) for (const q of b.quads) cands.push(...q);
    let best: [number, number] | null = null, bd = SNAP_PX;
    for (let i = 0; i + 1 < cands.length; i += 2) { const [qx, qy] = v.toScreen(cands[i], 0, cands[i + 1]); const dd = Math.hypot(qx - sx, qy - sy); if (dd < bd) { bd = dd; best = [cands[i], cands[i + 1]]; } }
    if (best) return best;
    let [x, z] = g;
    // square to the road from the last point
    if (shift && this.pts.length >= 2) {
      const F = roadFrame(e.r), lx = this.pts[this.pts.length - 2], lz = this.pts[this.pts.length - 1];
      const du = (x - lx) * F.ux + (z - lz) * F.uz, dv = (x - lx) * F.vx + (z - lz) * F.vz;
      if (Math.abs(du) > Math.abs(dv)) { x = lx + F.ux * du; z = lz + F.uz * du; } else { x = lx + F.vx * dv; z = lz + F.vz * dv; }
    }
    return [Math.round(x / GRID) * GRID, Math.round(z / GRID) * GRID];
  }

  // ---------- pointer ----------
  private down(ev: PointerEvent) {
    if (ev.button !== 0 || this.h.readOnly()) return;
    const v = this.h.view(); if (!v) return;
    this.downAt = [ev.clientX, ev.clientY];
    const m = modeOf(this.tool);
    if (m === 'area' && this.tool.k !== 'plot' && !this.pts.length) {
      // (an area tool: a drag makes a rectangle)
      const g = this.snap(ev.clientX, ev.clientY, false);
      if (g) { this.drag = { kind: 'rect', from: g, to: g }; v.controls.enabled = false; }
      return;
    }
    if (m) { v.controls.enabled = false; return; }
    // select: a corner of the plot (on the Site step), else what's under the pointer
    const p = this.h.p(), e = this.h.e();
    if (this.h.step() === 'site') {
      const o = outline(p), rect = this.canvas.getBoundingClientRect();
      for (let i = 0; i < o.ring.length; i += 2) {
        const [qx, qy] = v.toScreen(o.ring[i], 0, o.ring[i + 1]);
        if (Math.hypot(qx - (ev.clientX - rect.left), qy - (ev.clientY - rect.top)) < SNAP_PX) {
          v.controls.enabled = false;
          const base = p.shape === 'poly' ? p : { ...p, shape: 'poly' as const, ring: o.ring, edgeRoads: o.roads };
          this.drag = { kind: 'corner', i: i / 2, base };
          return;
        }
      }
      const f = this.featureAt(ev.clientX, ev.clientY);
      if (f) { this.h.pick({ k: 'feature', id: f.id }); this.startMove({ k: 'feature', id: f.id }, ev, v); return; }
      return;
    }
    const hit = v.buildingHit(ev.clientX, ev.clientY);
    if (hit) { this.h.pick({ k: 'building', id: hit.id }); this.startMove({ k: 'building', id: hit.id }, ev, v, hit.y); return; }
    const el = this.elementAt(ev.clientX, ev.clientY, e);
    if (el) { this.h.pick({ k: 'element', id: el.id }); this.startMove({ k: 'element', id: el.id }, ev, v); return; }
  }
  private startMove(what: Picked, ev: PointerEvent, v: ProView, y = 0) {
    // (dragged on the level it was touched at: a building by its face moves with the pointer)
    const g = v.groundAt(ev.clientX, ev.clientY, y); if (!g) return;
    v.controls.enabled = false;
    this.drag = { kind: 'move', what, from: g, base: this.h.p(), moved: false, y };
  }
  private move(ev: PointerEvent) {
    const v = this.h.view(); if (!v) return;
    const d = this.drag;
    if (d?.kind === 'rect') { const g = this.snap(ev.clientX, ev.clientY, false); if (g) { d.to = g; this.draw(); } return; }
    if (d?.kind === 'corner') {
      const g = this.snap(ev.clientX, ev.clientY, ev.shiftKey); if (!g) return;
      const ring = [...(d.base.ring ?? [])]; ring[d.i * 2] = g[0]; ring[d.i * 2 + 1] = g[1];
      this.h.up({ shape: 'poly', ring, edgeRoads: d.base.edgeRoads });
      return;
    }
    if (d?.kind === 'move') {
      const g = v.groundAt(ev.clientX, ev.clientY, d.y); if (!g) return;
      const dx = Math.round((g[0] - d.from[0]) / GRID) * GRID, dz = Math.round((g[1] - d.from[1]) / GRID) * GRID;
      if (!d.moved && Math.hypot(dx, dz) < 0.5) return;
      d.moved = true;
      this.h.up(moved(d.base, this.h.e(), d.what, dx, dz));
      return;
    }
    if (modeOf(this.tool)) { this.hover = this.snap(ev.clientX, ev.clientY, ev.shiftKey); this.draw(); }
  }
  private upE(ev: PointerEvent) {
    const v = this.h.view(); if (!v) return;
    const d = this.drag; this.drag = null;
    const click = this.downAt && Math.hypot(ev.clientX - this.downAt[0], ev.clientY - this.downAt[1]) < 5;
    if (d?.kind === 'rect') {
      if (!click && Math.abs(d.to[0] - d.from[0]) > 1 && Math.abs(d.to[1] - d.from[1]) > 1) {
        const [ax, az] = d.from, [bx, bz] = d.to;
        this.pts = [ax, az, bx, az, bx, bz, ax, bz];
        this.finish();
        return;
      }
      // (a click: the first corner of an outline)
      this.pts = [...d.from]; this.draw();
      v.controls.enabled = true;
      return;
    }
    v.controls.enabled = !modeOf(this.tool);
    if (d) { if (d.kind !== 'move' || d.moved) return; }
    const m = modeOf(this.tool);
    if (!m || !click) { if (m) v.controls.enabled = true; return; }
    const g = this.snap(ev.clientX, ev.clientY, ev.shiftKey); if (!g) return;
    if (m === 'point') { this.pts = g; this.finish(); return; }
    // closing an outline on its first corner
    if (m === 'area' && this.pts.length >= 6 && Math.hypot(g[0] - this.pts[0], g[1] - this.pts[1]) < 0.01) { this.finish(); return; }
    this.pts.push(...g); this.draw();
    v.controls.enabled = true;
  }
  private key(ev: KeyboardEvent) {
    const t = ev.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable || t.closest('[role="combobox"],[role="listbox"],[role="dialog"]'))) return;
    if (ev.key === 'Escape' && (this.tool.k !== 'select' || this.pts.length)) { ev.stopPropagation(); if (this.pts.length) { this.pts = []; this.draw(); } else this.h.done(); return; }
    if (ev.key === 'Enter' && this.pts.length) { ev.preventDefault(); this.finish(); return; }
    if (ev.key === 'Backspace' && this.pts.length) { ev.preventDefault(); this.pts.splice(-2); this.draw(); return; }
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && this.tool.k === 'select' && this.h.picked() && !this.h.readOnly()) { ev.preventDefault(); this.h.up(removed(this.h.p(), this.h.e(), this.h.picked())); this.h.pick(null); }
  }

  // ---------- finishing ----------
  private finish() {
    const t = this.tool, P = this.pts, p = this.h.p(), e = this.h.e();
    this.pts = []; this.hover = null;
    const m = modeOf(t);
    const ok = m === 'point' ? P.length >= 2 : m === 'line' ? P.length >= 4 : P.length >= 6;
    if (!ok) { this.draw(); return; }
    if (t.k === 'plot') this.h.up({ shape: 'poly', ring: P, edgeRoads: Array.from({ length: P.length / 2 }, (_, i) => (i === 0 ? { today: p.road, dp: p.dpRoad } : null)) });
    if (t.k === 'feature') {
      const F = featureOf(t.kind), f: SiteFeature = { id: newId(), kind: t.kind, pts: P, ...(F.shape === 'point' ? { r: F.r } : {}), clear: F.clear };
      this.h.up({ features: [...(p.features ?? []), f] });
      this.h.pick({ k: 'feature', id: f.id });
    }
    if (t.k === 'building') {
      const F = roadFrame(e.r), s = own(p, e);
      const geo = t.shape === 'draw' ? { spine: P, depth: 14 } : shapeAt(t.shape, P[0], P[1], [F.ux, F.uz], [F.vx, F.vz]);
      const b: ProBuilding = { id: newBuildingId(), floors: 0, ...geo, name: `Building ${String.fromCharCode(65 + s.buildings.length)}` };
      this.h.up({ scheme: { ...s, buildings: [...s.buildings, b] } });
      this.h.pick({ k: 'building', id: b.id });
    }
    if (t.k === 'element') {
      const s = own(p, e), id = newBuildingId();
      const el: SiteElement = t.kind === 'road' ? { id, kind: 'road', spine: P, depth: 6, floors: 0 } : { id, kind: t.kind, spine: [], ring: P, depth: 0, floors: 0, ...(t.kind === 'parking' ? { levels: 3 } : {}) };
      this.h.up({ scheme: { ...s, elements: [...s.elements, el] } });
      this.h.pick({ k: 'element', id });
    }
    this.h.done();
    this.draw();
  }

  /** what's being drawn, and the handles, over the scene */
  draw() {
    const v = this.h.view(); if (!v) return;
    const o: Overlay = { lines: [], dashed: [], points: [], hot: [] };
    const P = this.drag?.kind === 'rect' ? (() => { const [ax, az] = this.drag.from, [bx, bz] = this.drag.to; return [ax, az, bx, az, bx, bz, ax, bz]; })() : this.pts;
    for (let i = 0; i + 3 < P.length; i += 2) o.lines!.push(P[i], 0.1, P[i + 1], P[i + 2], 0.1, P[i + 3]);
    if (this.drag?.kind === 'rect' && P.length >= 8) o.lines!.push(P[6], 0.1, P[7], P[0], 0.1, P[1]);
    if (this.hover && this.pts.length >= 2) o.dashed!.push(P[P.length - 2], 0.1, P[P.length - 1], this.hover[0], 0.1, this.hover[1]);
    for (let i = 0; i + 1 < P.length; i += 2) o.points!.push(P[i], 0.1, P[i + 1]);
    if (this.hover && modeOf(this.tool)) o.hot!.push(this.hover[0], 0.1, this.hover[1]);
    // the plot's corners, to drag, on the Site step
    if (this.tool.k === 'select' && this.h.step() === 'site' && !this.h.readOnly()) { const r = outline(this.h.p()).ring; for (let i = 0; i < r.length; i += 2) o.points!.push(r[i], 0.1, r[i + 1]); }
    v.overlay(o);
  }

  private featureAt(px: number, py: number): SiteFeature | null {
    const v = this.h.view(); if (!v) return null;
    const g = v.groundAt(px, py); if (!g) return null;
    const rect = this.canvas.getBoundingClientRect();
    for (const f of [...(this.h.p().features ?? [])].reverse()) {
      if (featureOf(f.kind).shape === 'area' ? pointIn(f.pts, g[0], g[1]) : (() => { for (let i = 0; i + 1 < f.pts.length; i += 2) { const [qx, qy] = v.toScreen(f.pts[i], 0, f.pts[i + 1]); if (Math.hypot(qx - (px - rect.left), qy - (py - rect.top)) < 16) return true; } return false; })()) return f;
    }
    return null;
  }
  private elementAt(px: number, py: number, e: Evaluated): SiteElement | null {
    const v = this.h.view(); if (!v) return null;
    const g = v.groundAt(px, py); if (!g) return null;
    for (const el of [...(e.d.site.elements ?? [])].reverse()) {
      if (el.ring && el.ring.length >= 6 && pointIn(el.ring, g[0], g[1])) return el;
      if (el.kind === 'road') for (const q of buildingQuads(el)) if (pointIn(q, g[0], g[1])) return el;
    }
    return null;
  }
}

/** the scheme as the user's own (the fill's, taken over, the first time anything's changed by hand) */
export function own(p: ProProject, e: Evaluated): NonNullable<ProProject['scheme']> {
  return p.scheme ?? ownScheme(e.d, p.buildingStyle);
}

const shift = (pts: number[], dx: number, dz: number) => pts.map((q, i) => Math.round((q + (i % 2 ? dz : dx)) * 100) / 100);

/** the project with a building, a thing or a feature moved */
export function moved(p: ProProject, e: Evaluated, what: Picked, dx: number, dz: number): Partial<ProProject> {
  if (!what) return {};
  if (what.k === 'feature') return { features: (p.features ?? []).map((f) => (f.id === what.id ? { ...f, pts: shift(f.pts, dx, dz) } : f)) };
  const s = own(p, e);
  if (what.k === 'building') return { scheme: { ...s, buildings: s.buildings.map((b) => (b.id === what.id ? { ...b, spine: shift(b.spine, dx, dz) } : b)) } };
  return { scheme: { ...s, elements: s.elements.map((x) => (x.id === what.id ? { ...x, spine: shift(x.spine, dx, dz), ...(x.ring ? { ring: shift(x.ring, dx, dz) } : {}) } : x)) } };
}
/** the project without it */
export function removed(p: ProProject, e: Evaluated, what: Picked): Partial<ProProject> {
  if (!what) return {};
  if (what.k === 'feature') return { features: (p.features ?? []).filter((f) => f.id !== what.id) };
  const s = own(p, e);
  if (what.k === 'building') return { scheme: { ...s, buildings: s.buildings.filter((b) => b.id !== what.id) } };
  return { scheme: { ...s, elements: s.elements.filter((x) => x.id !== what.id) } };
}
/** a building turned about its middle */
export function turned(b: ProBuilding, deg: number): ProBuilding {
  const n = b.spine.length / 2; let cx = 0, cz = 0;
  for (let i = 0; i < b.spine.length; i += 2) { cx += b.spine[i] / n; cz += b.spine[i + 1] / n; }
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return { ...b, spine: b.spine.map((_, i) => { const k = i - (i % 2), x = b.spine[k] - cx, z = b.spine[k + 1] - cz; return Math.round((i % 2 ? cz + x * s + z * c : cx + x * c - z * s) * 100) / 100; }) };
}
/** a building stretched along its wings to a length (m, its spine's length) */
export function stretched(b: ProBuilding, len: number): ProBuilding {
  let L = 0; for (let i = 0; i + 3 < b.spine.length; i += 2) L += Math.hypot(b.spine[i + 2] - b.spine[i], b.spine[i + 3] - b.spine[i + 1]);
  if (b.closed) L += Math.hypot(b.spine[0] - b.spine[b.spine.length - 2], b.spine[1] - b.spine[b.spine.length - 1]);
  if (L < 0.1) return b;
  const k = len / L, n = b.spine.length / 2; let cx = 0, cz = 0;
  for (let i = 0; i < b.spine.length; i += 2) { cx += b.spine[i] / n; cz += b.spine[i + 1] / n; }
  return { ...b, spine: b.spine.map((q, i) => Math.round(((i % 2 ? cz : cx) + (q - (i % 2 ? cz : cx)) * k) * 100) / 100) };
}
export const spineLength = (b: ProBuilding) => { let L = 0; for (let i = 0; i + 3 < b.spine.length; i += 2) L += Math.hypot(b.spine[i + 2] - b.spine[i], b.spine[i + 3] - b.spine[i + 1]); if (b.closed && b.spine.length >= 4) L += Math.hypot(b.spine[0] - b.spine[b.spine.length - 2], b.spine[1] - b.spine[b.spine.length - 1]); return L; };
