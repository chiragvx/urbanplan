// Drawing and editing on the 3D (or the plan): the one place the plot, what's on it and the buildings are drawn.
// A tool is picked in the panel; the canvas does the rest:
// - select: click a building or a thing to pick it, drag it to move it; on the Site step drag the plot's corners;
//   a building with a form shows its plan's points to drag, and a + in the middle of each edge for a new point;
// - a point (a tree, a well, a pole, a tower block, a template): one click;
// - a line (a power line, an internal road, a building's own wings): click along it, double-click or Enter to finish;
// - an area (the plot, a structure, a no-build zone, a garden…): click its corners and close it (click the first
//   corner, double-click or Enter), or drag out a rectangle.
//
// Snapping is on unless it's switched off in the view's toolbar, and holding Alt suspends it for a moment. In order:
// a corner of the plot, of the buildable line or of another building; one of their edges; then, drawing a line, 15°
// steps from the road (so square to it and along it fall out); else the same line as a corner nearby (along or
// across the road) and a grid along the road, half a metre, a metre or five by how near the camera is. Each snap
// shows a short dashed guide. Moving a building snaps its corners the same way. Escape cancels, Delete removes
// what's picked, the arrow keys nudge it a grid step (Shift: ten). Everything goes through `up`, so it undoes.
import { DEFAULT_SITE, ELEMENTS, elementRings, roadFrame, buildingQuads, newBuildingId, pointIn, type SiteElement, type ElementKind } from '../doc/site';
import type { ProView, Overlay } from './scene';
import type { Evaluated } from './evaluate';
import { outline, ownScheme, type ProBuilding, type ProProject } from './project';
import { featureOf, newId, type FeatureKind, type SiteFeature } from './siteObjects';
import { layForm, sampleCurve, TEMPLATES, toLocal, toWorld, type Form, type FormLayout, type Pt, type UseBand, USE_INFO } from './form';

export type BuildingShape = 'slab' | 'tower' | 'L' | 'U' | 'court' | 'draw';
export type Tool =
  | { k: 'select' }
  | { k: 'plot' }
  | { k: 'feature'; kind: FeatureKind }
  | { k: 'building'; shape: BuildingShape }
  | { k: 'template'; id: string }
  | { k: 'element'; kind: Extract<ElementKind, 'garden' | 'play' | 'trees' | 'lot' | 'road' | 'parking' | 'roundabout' | 'gate' | 'wall' | 'tank'> }
  /** two clicks: the distance between them, and from each to the buildable line */
  | { k: 'measure' };
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
  { kind: 'lot', label: 'Car lot', icon: 'car', hint: 'Surface bays: drag out the area, or click its corners.' },
  { kind: 'parking', label: 'Parking tower', icon: 'layers', hint: 'A multi-storey car park: drag out its area.' },
  { kind: 'road', label: 'Road', icon: 'road', hint: 'Click along it, double-click or Enter to finish.' },
  { kind: 'roundabout', label: 'Roundabout', icon: 'rotate', hint: 'Click where it goes: a turning circle 18 m across.' },
  { kind: 'gate', label: 'Gate', icon: 'link', hint: 'Click the plot’s edge where the gate goes: 6 m wide.' },
  { kind: 'wall', label: 'Wall', icon: 'straight', hint: 'Click along it, double-click or Enter to finish.' },
  { kind: 'tank', label: 'Water tank', icon: 'drop', hint: 'Click where it goes.' },
];

/** how near (screen px) a corner or an edge pulls; the grid steps to choose from, finest first */
const SNAP_PX = 10, GRIDS = [0.5, 1, 5];
type Mode = 'point' | 'line' | 'area';
const modeOf = (t: Tool): Mode | null => {
  if (t.k === 'plot') return 'area';
  if (t.k === 'feature') return featureOf(t.kind).shape;
  if (t.k === 'building') return t.shape === 'draw' ? 'line' : 'point';
  if (t.k === 'template') return 'point';
  if (t.k === 'element') return t.kind === 'road' || t.kind === 'wall' ? 'line' : t.kind === 'roundabout' || t.kind === 'gate' || t.kind === 'tank' ? 'point' : 'area';
  if (t.k === 'measure') return 'line';
  return null;
};
const r2 = (q: number) => Math.round(q * 100) / 100;

/** a building of a shape at x, z, its long side along the road (u) */
function shapeAt(shape: BuildingShape, x: number, z: number, u: [number, number], v: [number, number]): Pick<ProBuilding, 'spine' | 'depth' | 'closed'> {
  const P = (a: number, b: number) => [x + u[0] * a + v[0] * b, z + u[1] * a + v[1] * b];
  const rr = (n: number[]) => n.map(r2);
  switch (shape) {
    case 'tower': return { spine: rr([...P(-11, 0), ...P(11, 0)]), depth: 20 };
    case 'L': return { spine: rr([...P(-20, 0), ...P(0, 0), ...P(0, 22)]), depth: 14 };
    case 'U': return { spine: rr([...P(-18, 18), ...P(-18, 0), ...P(18, 0), ...P(18, 18)]), depth: 14 };
    case 'court': return { spine: rr([...P(-18, -14), ...P(18, -14), ...P(18, 14), ...P(-18, 14)]), depth: 12, closed: true };
    default: return { spine: rr([...P(-18, 0), ...P(18, 0)]), depth: 16 };
  }
}

// ---------------------------------------------------------------- forms on the map
/** what the form procedure needs from the project */
export const formCtx = (e: Evaluated) => ({ floorH: e.ds.floorH, mix: e.p.mix, sizes: (e.d.site.sizes ?? [42, 65, 95]) as [number, number, number] });
/** a formed building as laid out: the engine's, once it lays forms, else laid here */
export function layoutOf(b: ProBuilding, e: Evaluated): FormLayout | null {
  const own = (e as Evaluated & { forms?: Record<string, FormLayout> }).forms?.[b.id];
  if (own) return own;
  if (!b.form) return null;
  try { return layForm(b as ProBuilding & { form: Form }, formCtx(e)); } catch { return null; }
}
/** a formed building's ground plan in the world (its curve, sampled) */
export const formRing = (b: ProBuilding): number[] => {
  if (!b.form) return [];
  const s = sampleCurve(b.form.plan, 1.5), o: number[] = [];
  for (let i = 0; i + 1 < s.length; i += 2) o.push(...toWorld(b, s[i], s[i + 1]));
  return o;
};
/** a building's outline(s) seen from above: a form's whole volume, else its wings */
export function outlinesOf(b: ProBuilding, e: Evaluated, quads?: number[][]): number[][] {
  if (b.form) {
    const L = layoutOf(b, e);
    if (L && L.outline.length >= 6) return [L.outline];
    const r = formRing(b); return r.length >= 6 ? [r] : [];
  }
  return quads ?? buildingQuads(b);
}
/** where the corners of a building are (to snap when it moves): a form's own plan points, else its wings' corners */
function cornersOf(b: ProBuilding, e: Evaluated, quads?: number[][]): Pt[] {
  if (b.form) return b.form.plan.pts.map(([x, z]) => toWorld(b, x, z));
  const o: Pt[] = []; for (const q of outlinesOf(b, e, quads)) for (let i = 0; i + 1 < q.length; i += 2) o.push([q[i], q[i + 1]]);
  return o;
}
/** a building's middle (its form's plan's middle, else its spine's) */
export function middleOf(b: ProBuilding): Pt {
  if (b.form) { const r = formRing(b); let x = 0, z = 0; const n = r.length / 2 || 1; for (let i = 0; i < r.length; i += 2) { x += r[i]; z += r[i + 1]; } return [x / n, z / n]; }
  const n = b.spine.length / 2 || 1; let cx = 0, cz = 0;
  for (let i = 0; i < b.spine.length; i += 2) { cx += b.spine[i] / n; cz += b.spine[i + 1] / n; }
  return [cx, cz];
}

/** How much room there is round a point inside the buildable line, along the road (u) and back from it (v): the
 *  distances to the line each way, or null outside it. */
function roomAt(ring: number[], o: Pt, u: Pt, v: Pt): { u: [number, number]; v: [number, number] } | null {
  if (ring.length < 6 || !pointIn(ring, o[0], o[1])) return null;
  const cast = (d: Pt) => {
    let best = Infinity;
    for (let i = 0; i < ring.length; i += 2) {
      const j = (i + 2) % ring.length, ax = ring[i], az = ring[i + 1], ex = ring[j] - ax, ez = ring[j + 1] - az;
      const den = d[0] * ez - d[1] * ex; if (Math.abs(den) < 1e-9) continue;
      const wx = ax - o[0], wz = az - o[1], t = (wx * ez - wz * ex) / den, s = (wx * d[1] - wz * d[0]) / den;
      if (t > 0 && s >= 0 && s <= 1) best = Math.min(best, t);
    }
    return best;
  };
  return { u: [cast([-u[0], -u[1]]), cast(u)], v: [cast([-v[0], -v[1]]), cast(v)] };
}

/** A template placed at a point facing the front road: its building(s), sized to the room the buildable line leaves
 *  there and kept inside it where they fit. */
export function placeTemplate(id: string, o: Pt, e: Evaluated): ProBuilding[] {
  const tpl = TEMPLATES.find((t) => t.id === id); if (!tpl) return [];
  const F = roadFrame(e.r), u: Pt = [F.ux, F.uz], v: Pt = [F.vx, F.vz];
  const room = roomAt(e.r.footprint, o, u, v);
  const fit = room && Number.isFinite(room.u[0] + room.u[1] + room.v[0] + room.v[1]) ? { w: room.u[0] + room.u[1], d: room.v[0] + room.v[1] } : undefined;
  let made: ReturnType<typeof tpl.make> = [];
  try { made = tpl.make(o, u, fit && fit.w > 4 && fit.d > 4 ? fit : undefined); } catch { return []; }
  if (!made.length) return [];
  // (each building's origin: the point, moved by its offset, along the road and back from it)
  const at = made.map((m): Pt => [o[0] + (m.offset?.[0] ?? 0) * u[0] + (m.offset?.[1] ?? 0) * v[0], o[1] + (m.offset?.[0] ?? 0) * u[1] + (m.offset?.[1] ?? 0) * v[1]]);
  // their extent round the point, along and across the road
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  made.forEach((m, k) => { const s = sampleCurve(m.form.plan, 2); for (let i = 0; i + 1 < s.length; i += 2) { const x = at[k][0] - o[0] + s[i] * u[0] + s[i + 1] * v[0], z = at[k][1] - o[1] + s[i] * u[1] + s[i + 1] * v[1]; const pu = x * u[0] + z * u[1], pv = x * v[0] + z * v[1]; a0 = Math.min(a0, pu); a1 = Math.max(a1, pu); b0 = Math.min(b0, pv); b1 = Math.max(b1, pv); } });
  // kept inside the buildable line where it fits, else centred in the room
  let su = 0, sv = 0;
  if (room && Number.isFinite(a0)) {
    const fitAxis = (lo: number, hi: number, r: [number, number]) => { if (!Number.isFinite(r[0] + r[1])) return 0; if (hi - lo > r[0] + r[1]) return (r[1] - r[0]) / 2 - (lo + hi) / 2; if (lo < -r[0]) return -r[0] - lo; if (hi > r[1]) return r[1] - hi; return 0; };
    su = fitAxis(a0, a1, room.u); sv = fitAxis(b0, b1, room.v);
  }
  return made.map((m, k) => {
    const ox = at[k][0] + su * u[0] + sv * v[0], oz = at[k][1] + su * u[1] + sv * v[1];
    const s = sampleCurve(m.form.plan, 2); let z0 = Infinity, z1 = -Infinity; for (let i = 1; i < s.length; i += 2) { z0 = Math.min(z0, s[i]); z1 = Math.max(z1, s[i]); }
    const form = fitRules(m.form, e, made.length);
    const floors = form.uses.reduce((t, x) => t + x.floors, 0) || m.floors;
    return { id: newBuildingId(), name: m.name, floors, depth: Number.isFinite(z1 - z0) ? r2(Math.max(6, z1 - z0)) : 14, spine: [r2(ox), r2(oz), r2(ox + u[0]), r2(oz + u[1])], form };
  });
}

/** A template as dropped on this plot: no taller than the height limit, and no more floor area than the FSI has left
 *  (shared between the template's buildings), taken off its top band of floors. It lands passing the rules; floors
 *  can be added back by hand, and then the rules flag it rather than refuse. At least two floors (or the template's
 *  own, if fewer), so a tower still reads as one. */
function fitRules(f: Form, e: Evaluated, parts: number): Form {
  const R = e.r.rules, under = e.d.under, fh = R.floorH;
  const hOf = (u: UseBand) => (u.use === 'residential' ? fh : u.floorH ?? USE_INFO[u.use].floorH) * u.floors;
  const left = Math.max(0, e.r.bua - (e.p.scheme ? e.d.bua : 0)) / Math.max(1, parts);
  const total = f.uses.reduce((t, u) => t + u.floors, 0), least = Math.min(2, total);
  // (k floors off the top band, then the next band down)
  const trim = (k: number): UseBand[] => {
    const uses = f.uses.map((u) => ({ ...u }));
    for (let i = uses.length - 1; i >= 0 && k > 0; i--) { const d = Math.min(k, uses[i].floors); uses[i].floors -= d; k -= d; }
    return uses.filter((u) => u.floors > 0);
  };
  // its floor area as laid out (a taper's upper floors are smaller than its base), parking aside
  const bua = (uses: UseBand[]) => {
    const b: ProBuilding = { id: 'fit', name: 'fit', floors: uses.reduce((t, x) => t + x.floors, 0), depth: 14, spine: [0, 0, 1, 0], form: { ...f, uses } };
    try { return (layForm(b, { floorH: fh, mix: e.p.mix, sizes: DEFAULT_SITE.sizes })?.floors ?? []).reduce((s, x) => s + (x.use === 'parking' ? 0 : x.area), 0); } catch { return 0; }
  };
  const over = (k: number) => { const u = trim(k); return under * fh + u.reduce((t, x) => t + hOf(x), 0) > R.maxH + 1e-6 || bua(u) > left + 1; };
  // the fewest floors taken off that pass (more off is always less), by halves
  let lo = 0, hi = total - least;
  if (!over(0)) return f;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (over(mid)) lo = mid + 1; else hi = mid; }
  return { ...f, uses: trim(lo) };
}

// ---------------------------------------------------------------- the canvas
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
  /** a few words by the pointer: the length being drawn, what it snapped to, a typed number (null: none) */
  readout?: (r: { text: string; sub?: string; x: number; y: number; typed?: boolean } | null) => void;
}

type Drag =
  | { kind: 'move'; what: Picked; base: ProProject; moved: boolean; y: number; acc: Pt; last: Pt; scale: DragScale; corners: Pt[] }
  | { kind: 'corner'; i: number; base: ProProject }
  | { kind: 'rect'; from: Pt; to: Pt }
  | { kind: 'plan'; id: string; i: number; moved: boolean; plan: { pts: Pt[]; sharp?: boolean[] } };

interface Snapped { d: Pt; guide: number[]; hot: Pt | null; why?: string }
/** how a drag maps the screen to the ground, fixed at where it started: metres a pixel at that depth, and the ground's
 *  way for the screen's right and up there */
interface DragScale { mpp: number; right: Pt; up: Pt }

/** The pixel-to-metre scale at a point's depth (the perspective camera's distance to it through its field of view, or
 *  the plan's frustum), and the screen's right and up laid flat on the ground. */
function dragScale(v: ProView, x: number, y: number, z: number, H: number): DragScale {
  const c = v.cam, m = c.matrixWorld.elements;
  let mpp: number;
  if (v.plan) mpp = (v.ortho.top - v.ortho.bottom) / (v.ortho.zoom || 1) / Math.max(1, H);
  else { const p = c.position, dist = Math.hypot(p.x - x, p.y - y, p.z - z); mpp = (2 * dist * Math.tan(((v.camera.fov / 2) * Math.PI) / 180)) / Math.max(1, H); }
  const flat = (a: number, b: number): Pt => { const L = Math.hypot(a, b); return L > 1e-6 ? [a / L, b / L] : [0, 0]; };
  // (screen up on the ground: the camera's up and its forward, each laid flat; whichever is level carries it)
  const up = flat(m[4] - m[8], m[6] - m[10]);
  return { mpp, right: flat(m[0], m[2]), up };
}

export class CanvasEdit {
  tool: Tool = SELECT;
  /** snapping on (the view's magnet); Alt held suspends it */
  snapOn = true;
  private pts: number[] = [];
  private hover: Pt | null = null;
  private drag: Drag | null = null;
  private downAt: Pt | null = null;
  private off: (() => void)[] = [];
  /** what the last snap showed: a dashed guide and the point it took */
  private guide: number[] = [];
  private hotPt: Pt | null = null;
  /** a template's outline where it would go */
  private ghost: number[][] = [];
  /** the plan point last dragged on a formed building (Delete takes it away) */
  private selPt: { id: string; i: number } | null = null;

  constructor(private canvas: HTMLCanvasElement, private h: EditHost) {
    const on = <K extends keyof HTMLElementEventMap>(t: K, f: (e: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions) => { canvas.addEventListener(t, f as EventListener, o); this.off.push(() => canvas.removeEventListener(t, f as EventListener, o)); };
    on('pointerdown', (e) => this.down(e), { capture: true });
    on('pointermove', (e) => this.move(e));
    on('pointerup', (e) => this.upE(e));
    on('pointerleave', () => { if (!this.drag && (this.hover || this.ghost.length)) { this.hover = null; this.ghost = []; this.guide = []; this.hotPt = null; this.draw(); } });
    on('dblclick', (e) => { if (modeOf(this.tool) && this.pts.length) { e.preventDefault(); this.finish(); } });
    const key = (e: KeyboardEvent) => this.key(e);
    addEventListener('keydown', key);
    this.off.push(() => removeEventListener('keydown', key));
  }
  dispose() { this.off.forEach((f) => f()); }

  setTool(t: Tool) {
    this.tool = t; this.pts = []; this.drag = null; this.ghost = []; this.guide = []; this.hotPt = null; this.typed = ''; this.measured = []; this.h.readout?.(null);
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
    if (t.k === 'template') return `${TEMPLATES.find((x) => x.id === t.id)?.name ?? 'It'}: click where it goes.`;
    if (t.k === 'element') return ELEMENT_TOOLS.find((s) => s.kind === t.kind)!.hint;
    if (t.k === 'measure') return 'Click two points to measure between them; the readout gives the distance to the margin too.';
    return null;
  }

  // ---------- snapping ----------
  private cache: { e: Evaluated | null; ex: string | undefined; pts: number[]; segs: number[] } = { e: null, ex: undefined, pts: [], segs: [] };
  /** what pulls: the corners and edges of the plot, its buildable line and the other buildings */
  private targets(ex?: string): { pts: number[]; segs: number[] } {
    const e = this.h.e(), c = this.cache;
    if (c.e !== e || c.ex !== ex) {
      const p = this.h.p(), rings: number[][] = [e.r.net, outline(p).ring, e.r.footprint];
      for (const br of e.d.buildings) {
        if (br.b.id === ex) continue;
        const b = (p.scheme?.buildings.find((x) => x.id === br.b.id) ?? br.b) as ProBuilding;
        rings.push(...outlinesOf(b, e, br.quads));
      }
      const pts: number[] = [], segs: number[] = [];
      for (const r of rings) {
        if (!r || r.length < 4) continue;
        for (let i = 0; i + 1 < r.length; i += 2) { const j = (i + 2) % r.length; pts.push(r[i], r[i + 1]); segs.push(r[i], r[i + 1], r[j], r[j + 1]); }
      }
      this.cache = { e, ex, pts, segs };
    }
    return { pts: this.cache.pts, segs: this.cache.segs };
  }
  /** the grid step where the camera is: a step at least 7 px on screen */
  private gridAt(x: number, z: number): number {
    const v = this.h.view(); if (!v) return 1;
    const a = v.toScreen(x, 0, z), b = v.toScreen(x + 1, 0, z), c = v.toScreen(x, 0, z + 1);
    const ppm = (Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(c[0] - a[0], c[1] - a[1])) / 2;
    return GRIDS.find((g) => g * ppm >= 7) ?? GRIDS[GRIDS.length - 1];
  }
  /** The correction that snaps any of some points (where they'd go) onto what pulls them; see the top of the file. */
  private snapSet(cand: Pt[], o: { ex?: string; from?: Pt | null; shift?: boolean; extra?: number[] } = {}): Snapped {
    const v = this.h.view(), none: Snapped = { d: [0, 0], guide: [], hot: null };
    if (!v || !cand.length) return none;
    const T = this.targets(o.ex), tp = o.extra?.length ? [...T.pts, ...o.extra] : T.pts;
    const S = (x: number, z: number) => v.toScreen(x, 0, z);
    const cs = cand.map(([x, z]) => S(x, z)), ts: [number, number][] = [];
    for (let j = 0; j + 1 < tp.length; j += 2) ts.push(S(tp[j], tp[j + 1]));
    // 1. a corner onto a corner
    let best = SNAP_PX, hit: [number, number] | null = null;
    ts.forEach((s, j) => cs.forEach((c, k) => { const dd = Math.hypot(s[0] - c[0], s[1] - c[1]); if (dd < best) { best = dd; hit = [j, k]; } }));
    if (hit) { const [j, k] = hit as [number, number], q: Pt = [tp[2 * j], tp[2 * j + 1]]; return { d: [q[0] - cand[k][0], q[1] - cand[k][1]], guide: [], hot: q, why: 'corner' }; }
    // 2. a corner onto an edge (measured on screen, then put on the edge itself)
    best = SNAP_PX; let eh: { k: number; i: number; t: number } | null = null;
    for (let i = 0; i + 3 < T.segs.length; i += 4) {
      const a = S(T.segs[i], T.segs[i + 1]), b = S(T.segs[i + 2], T.segs[i + 3]), ex = b[0] - a[0], ey = b[1] - a[1], L2 = ex * ex + ey * ey;
      if (L2 < 4) continue;
      cs.forEach((c, k) => { const t = Math.max(0, Math.min(1, ((c[0] - a[0]) * ex + (c[1] - a[1]) * ey) / L2)); const dd = Math.hypot(a[0] + ex * t - c[0], a[1] + ey * t - c[1]); if (dd < best) { best = dd; eh = { k, i, t }; } });
    }
    if (eh) {
      const { k, i, t } = eh as { k: number; i: number; t: number }, s = T.segs;
      const ax = s[i], az = s[i + 1], bx = s[i + 2], bz = s[i + 3], L = Math.hypot(bx - ax, bz - az) || 1;
      // (the nearest point on the edge in the world, so it lands square on it)
      const tw = Math.max(0, Math.min(1, ((cand[k][0] - ax) * (bx - ax) + (cand[k][1] - az) * (bz - az)) / (L * L)));
      const tt = Math.abs(tw - t) * L < 3 ? tw : t, q: Pt = [ax + (bx - ax) * tt, az + (bz - az) * tt], g = 5 / L;
      return { d: [q[0] - cand[k][0], q[1] - cand[k][1]], guide: [ax + (bx - ax) * Math.max(0, tt - g), az + (bz - az) * Math.max(0, tt - g), ax + (bx - ax) * Math.min(1, tt + g), az + (bz - az) * Math.min(1, tt + g)], hot: q, why: 'on the edge' };
    }
    const F = roadFrame(this.h.e().r), U: Pt = [F.ux, F.uz], V: Pt = [F.vx, F.vz];
    const g = this.gridAt(cand[0][0], cand[0][1]);
    // 3. drawing on from a point: 15° steps from the road (Shift: square to it), its length on the grid
    if (o.from) {
      const [fx, fz] = o.from, [x, z] = cand[0], du = (x - fx) * U[0] + (z - fz) * U[1], dv = (x - fx) * V[0] + (z - fz) * V[1];
      const len = Math.hypot(du, dv); if (len < 1e-6) return none;
      const step = ((o.shift ? 90 : 15) * Math.PI) / 180, a = Math.round(Math.atan2(dv, du) / step) * step, L = Math.max(g, Math.round(len / g) * g);
      const q: Pt = [fx + (Math.cos(a) * U[0] + Math.sin(a) * V[0]) * L, fz + (Math.cos(a) * U[1] + Math.sin(a) * V[1]) * L];
      const ext = 4 / L;
      const deg = Math.round((((a * 180) / Math.PI) % 360 + 360) % 360), why = deg % 180 === 0 ? 'along the road' : deg % 90 === 0 ? 'square to the road' : `${deg > 180 ? 360 - deg : deg}° to the road`;
      return { d: [q[0] - x, q[1] - z], guide: [fx, fz, q[0] + (q[0] - fx) * ext, q[1] + (q[1] - fz) * ext], hot: q, why };
    }
    // 4. in line with a corner nearby, along or across the road; else on the grid along the road
    const guide: number[] = [], corr: [number, number] = [0, 0];
    [U, V].forEach((A, ax) => {
      let bb = SNAP_PX, pick: { k: number; j: number; dl: number } | null = null;
      cand.forEach((c, k) => {
        const s1 = S(c[0] + A[0], c[1] + A[1]), ppm = Math.hypot(s1[0] - cs[k][0], s1[1] - cs[k][1]);
        for (let j = 0; j + 1 < tp.length; j += 2) {
          const dl = (tp[j] - c[0]) * A[0] + (tp[j + 1] - c[1]) * A[1], px = Math.abs(dl) * ppm;
          // (only corners within a sensible reach, so a far one doesn't draw a guide across the site)
          if (px < bb && Math.hypot(tp[j] - c[0], tp[j + 1] - c[1]) < 80) { bb = px; pick = { k, j, dl }; }
        }
      });
      if (pick) {
        const { k, j, dl } = pick as { k: number; j: number; dl: number };
        corr[ax] = dl;
        // (the guide from that corner to where this one lands; filled in once both axes are known)
        guide.push(j, k, ax);
      } else {
        const l = F.toL(cand[0])[ax], gl = Math.round(l / g) * g;
        corr[ax] = gl - l;
      }
    });
    const d: Pt = [corr[0] * U[0] + corr[1] * V[0], corr[0] * U[1] + corr[1] * V[1]], lines: number[] = [];
    for (let i = 0; i < guide.length; i += 3) { const j = guide[i], k = guide[i + 1]; lines.push(tp[j], tp[j + 1], cand[k][0] + d[0], cand[k][1] + d[1]); }
    return { d, guide: lines, hot: cand.length === 1 ? [cand[0][0] + d[0], cand[0][1] + d[1]] : null, why: lines.length ? 'in line with a corner' : `${g} m grid` };
  }
  /** the pointer on the ground, snapped (for drawing and placing) */
  private snap(px: number, py: number, ev: { shiftKey: boolean; altKey: boolean }, o: { ex?: string; extra?: number[]; from?: boolean } = {}): Pt | null {
    const v = this.h.view(); if (!v) return null;
    const g = v.groundAt(px, py); if (!g) return null;
    this.guide = []; this.hotPt = null;
    if (!this.snapOn || ev.altKey) return [r2(g[0]), r2(g[1])];
    const from = o.from !== false && this.pts.length >= 2 ? [this.pts[this.pts.length - 2], this.pts[this.pts.length - 1]] as Pt : null;
    const s = this.snapSet([g], { ex: o.ex, from, shift: ev.shiftKey, extra: [...(o.extra ?? []), ...this.pts] });
    this.guide = s.guide; this.hotPt = s.hot; this.why = s.why ?? null;
    return [r2(g[0] + s.d[0]), r2(g[1] + s.d[1])];
  }
  /** what the last snap took */
  private why: string | null = null;
  /** A handle on the view (./hud.tsx) dragged to the pointer: snapped as drawing is (`extra`: more points to snap to,
   *  such as the thing's own other points), its guide drawn. */
  snapAt(px: number, py: number, ev: { shiftKey: boolean; altKey: boolean }, o: { ex?: string; extra?: number[] } = {}): Pt | null {
    const g = this.snap(px, py, ev, { ...o, from: false });
    this.draw();
    return g;
  }
  /** the guide and point off (a handle let go) */
  clearSnap() { this.guide = []; this.hotPt = null; this.why = null; this.draw(); }
  /** lines the view's editor adds over the scene (a feature's radius and clearance rings) */
  decor: Overlay | null = null;
  /** a number typed while drawing (SketchUp's measurements box): Enter puts it in */
  private typed = '';
  /** the last measured: its two ends */
  private measured: number[] = [];
  private lastXY: Pt = [0, 0];
  /** the distance from a point to the buildable line (the margins) */
  private toMargin(x: number, z: number): number {
    const R = this.h.e().r.footprint; if (!R || R.length < 6) return NaN;
    let best = Infinity;
    for (let i = 0; i + 1 < R.length; i += 2) {
      const j = (i + 2) % R.length, ax = R[i], az = R[i + 1], ex = R[j] - ax, ez = R[j + 1] - az, L2 = ex * ex + ez * ez || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / L2));
      best = Math.min(best, Math.hypot(ax + ex * t - x, az + ez * t - z));
    }
    return best;
  }
  /** the readout by the pointer: what's being drawn, measured or typed */
  private tell() {
    const out = this.h.readout; if (!out) return;
    const m = modeOf(this.tool), [x, y] = this.lastXY, P = this.pts, n = P.length;
    if (this.typed) { out({ text: this.typed, sub: m === 'area' && n === 2 ? 'width, depth · Enter' : 'm · Enter (a comma, then an angle to the road)', x, y, typed: true }); return; }
    if (this.tool.k === 'measure') {
      if (this.measured.length === 4 && !n) { const [ax, az, bx, bz] = this.measured; out({ text: `${Math.hypot(bx - ax, bz - az).toFixed(2)} m`, sub: 'measured · click to measure again', x, y }); return; }
      if (!this.hover) { out(null); return; }
      const mg = this.toMargin(this.hover[0], this.hover[1]);
      if (n >= 2) { const L = Math.hypot(this.hover[0] - P[n - 2], this.hover[1] - P[n - 1]); out({ text: `${L.toFixed(2)} m`, sub: [this.why, Number.isFinite(mg) ? `${mg.toFixed(1)} m to the margin` : ''].filter(Boolean).join(' · '), x, y }); return; }
      out({ text: Number.isFinite(mg) ? `${mg.toFixed(1)} m to the margin` : 'Click to start', sub: this.why ?? undefined, x, y }); return;
    }
    if (m && m !== 'point' && n >= 2 && this.hover) { const L = Math.hypot(this.hover[0] - P[n - 2], this.hover[1] - P[n - 1]); out({ text: `${L.toFixed(1)} m`, sub: [this.why, 'type a length'].filter(Boolean).join(' · '), x, y }); return; }
    if (this.drag?.kind === 'rect') { const d = this.drag; out({ text: `${Math.abs(d.to[0] - d.from[0]).toFixed(1)} × ${Math.abs(d.to[1] - d.from[1]).toFixed(1)} m`, sub: this.why ?? undefined, x, y }); return; }
    if (m && this.hover && this.why) { out({ text: this.why, x, y }); return; }
    if (this.drag?.kind === 'move' && this.drag.moved && this.why) { out({ text: this.why, x, y }); return; }
    out(null);
  }
  /** the typed number put in: a point that far from the last (toward the pointer, or at an angle to the road), or a
   *  rectangle of two sizes from the first corner */
  private applyTyped(): boolean {
    const t = this.typed.trim(); this.typed = '';
    const m = modeOf(this.tool), P = this.pts, n = P.length;
    if (!m || n < 2) return false;
    const nums = t.split(/[,;x×\s]+/).filter(Boolean).map(Number);
    if (!nums.length || nums.some((q) => !Number.isFinite(q))) return false;
    const F = roadFrame(this.h.e().r), U: Pt = [F.ux, F.uz], V: Pt = [F.vx, F.vz], lx = P[n - 2], lz = P[n - 1];
    const h = this.hover ?? [lx + U[0], lz + U[1]];
    if (m === 'area' && n === 2 && nums.length >= 2) {
      // (a rectangle: along the road, then across it, toward where the pointer is)
      const du = (h[0] - lx) * U[0] + (h[1] - lz) * U[1], dv = (h[0] - lx) * V[0] + (h[1] - lz) * V[1];
      const a = nums[0] * (du < 0 ? -1 : 1), b = nums[1] * (dv < 0 ? -1 : 1), at = (u: number, v: number) => [r2(lx + U[0] * u + V[0] * v), r2(lz + U[1] * u + V[1] * v)];
      this.pts = [lx, lz, ...at(a, 0), ...at(a, b), ...at(0, b)];
      this.finish(); return true;
    }
    const L = Math.abs(nums[0]);
    let dx: number, dz: number;
    if (nums.length >= 2) { const a = (nums[1] * Math.PI) / 180; dx = Math.cos(a) * U[0] + Math.sin(a) * V[0]; dz = Math.cos(a) * U[1] + Math.sin(a) * V[1]; }
    else { const D = Math.hypot(h[0] - lx, h[1] - lz) || 1; dx = (h[0] - lx) / D; dz = (h[1] - lz) / D; }
    this.pts.push(r2(lx + dx * L), r2(lz + dz * L));
    if (this.tool.k === 'measure') { this.measureDone(); return true; }
    this.draw(); return true;
  }
  private measureDone() {
    this.measured = this.pts.slice(-4); this.pts = []; this.hover = null;
    this.draw(); this.tell();
  }

  // ---------- pointer ----------
  private down(ev: PointerEvent) {
    if (ev.button !== 0 || this.h.readOnly()) return;
    const v = this.h.view(); if (!v) return;
    this.downAt = [ev.clientX, ev.clientY];
    const m = modeOf(this.tool);
    if (m === 'area' && this.tool.k !== 'plot' && !this.pts.length) {
      // (an area tool: a drag makes a rectangle)
      const g = this.snap(ev.clientX, ev.clientY, ev);
      if (g) { this.drag = { kind: 'rect', from: g, to: g }; v.controls.enabled = false; }
      return;
    }
    if (m) { v.controls.enabled = false; return; }
    // select: a corner of the plot (on the Site step), else what's under the pointer
    const p = this.h.p(), e = this.h.e(), rect = this.canvas.getBoundingClientRect(), sx = ev.clientX - rect.left, sy = ev.clientY - rect.top;
    if (this.h.step() === 'site') {
      const o = outline(p);
      for (let i = 0; i < o.ring.length; i += 2) {
        const [qx, qy] = v.toScreen(o.ring[i], 0, o.ring[i + 1]);
        if (Math.hypot(qx - sx, qy - sy) < SNAP_PX + 2) {
          v.controls.enabled = false;
          const base = p.shape === 'poly' ? p : { ...p, shape: 'poly' as const, ring: o.ring, edgeRoads: o.roads };
          this.drag = { kind: 'corner', i: i / 2, base };
          return;
        }
      }
      const f = this.featureAt(ev.clientX, ev.clientY);
      if (f) { this.h.pick({ k: 'feature', id: f.id }); this.startMove({ k: 'feature', id: f.id }, ev, v); return; }
    }
    // a formed building's plan points, and the + on each edge for a new one
    const fb = this.pickedForm();
    if (fb) {
      const P = fb.form.plan.pts, n = P.length;
      for (let i = 0; i < n; i++) {
        const [x, z] = toWorld(fb, P[i][0], P[i][1]), [qx, qy] = v.toScreen(x, 0, z);
        if (Math.hypot(qx - sx, qy - sy) < SNAP_PX + 2) { v.controls.enabled = false; this.selPt = { id: fb.id, i }; this.drag = { kind: 'plan', id: fb.id, i, moved: false, plan: { pts: P.map((q) => [...q] as Pt), sharp: fb.form.plan.sharp } }; this.draw(); return; }
      }
      for (let i = 0; i < n; i++) {
        const a = P[i], b = P[(i + 1) % n], [x, z] = toWorld(fb, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2), [qx, qy] = v.toScreen(x, 0, z);
        if (Math.hypot(qx - sx, qy - sy) < SNAP_PX + 2) {
          v.controls.enabled = false;
          const sh = fb.form.plan.sharp ? [...fb.form.plan.sharp] : undefined;
          sh?.splice(i + 1, 0, !!(sh[i] && sh[(i + 1) % n]));
          const pts = [...P.map((q) => [...q] as Pt)]; pts.splice(i + 1, 0, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
          this.setForm(fb.id, (f) => ({ ...f, plan: { pts, ...(sh ? { sharp: sh } : {}) }, keys: f.keys.map((k) => (k.plan ? { ...k, plan: undefined } : k)) }));
          this.selPt = { id: fb.id, i: i + 1 }; this.drag = { kind: 'plan', id: fb.id, i: i + 1, moved: true, plan: { pts, sharp: sh } }; this.draw();
          return;
        }
      }
    }
    const hit = v.buildingHit(ev.clientX, ev.clientY);
    if (hit) { if (this.selPt?.id !== hit.id) this.selPt = null; this.h.pick({ k: 'building', id: hit.id }); this.startMove({ k: 'building', id: hit.id }, ev, v, hit.y); return; }
    const el = this.elementAt(ev.clientX, ev.clientY, e);
    if (el) { this.h.pick({ k: 'element', id: el.id }); this.startMove({ k: 'element', id: el.id }, ev, v); return; }
    // (a feature anywhere, once no building or thing is under the pointer; on the Site step it came first)
    const f = this.h.step() === 'site' ? null : this.featureAt(ev.clientX, ev.clientY);
    if (f) { this.h.pick({ k: 'feature', id: f.id }); this.startMove({ k: 'feature', id: f.id }, ev, v); return; }
  }
  /** the picked building when it has a form (and can be edited here) */
  private pickedForm(): (ProBuilding & { form: Form }) | null {
    const pk = this.h.picked();
    if (pk?.k !== 'building' || this.tool.k !== 'select' || this.h.readOnly()) return null;
    const b = this.h.p().scheme?.buildings.find((x) => x.id === pk.id);
    return b?.form && b.form.plan.pts.length >= 3 ? (b as ProBuilding & { form: Form }) : null;
  }
  private setForm(id: string, fn: (f: Form) => Form) {
    const p = this.h.p(), s = own(p, this.h.e());
    this.h.up({ scheme: { ...s, buildings: s.buildings.map((b) => (b.id === id && b.form ? { ...b, form: fn(b.form) } : b)) } });
  }
  private startMove(what: Picked, ev: PointerEvent, v: ProView, y0 = 0) {
    // (dragged on the level it was touched at, so a building held by its face moves with the pointer; but a face held
    // above the camera is dragged on the ground, as the level there runs the wrong way as the pointer rises)
    // (and where even the ground isn't under the pointer, above the horizon, the touched level, its steps then going
    // by the scale alone)
    let y = !v.plan && y0 > v.cam.position.y - 1 ? 0 : y0, g = v.groundAt(ev.clientX, ev.clientY, y);
    if (!g && y !== y0) { y = y0; g = v.groundAt(ev.clientX, ev.clientY, y); }
    if (!g) return;
    v.controls.enabled = false;
    // the scale where it was touched, kept for the whole drag (see `move`)
    const scale = dragScale(v, g[0], y, g[1], this.canvas.getBoundingClientRect().height);
    const p = this.h.p(), e = this.h.e();
    let corners: Pt[] = [];
    if (what?.k === 'building') {
      const br = e.d.buildings.find((x) => x.b.id === what.id), b = (p.scheme?.buildings.find((x) => x.id === what.id) ?? br?.b) as ProBuilding | undefined;
      if (b) corners = cornersOf(b, e, br?.quads);
    } else if (what?.k === 'element') {
      const el = (e.d.site.elements ?? []).find((x) => x.id === what.id);
      const r = el?.ring && el.ring.length >= 6 ? el.ring : el?.spine ?? [];
      for (let i = 0; i + 1 < r.length; i += 2) corners.push([r[i], r[i + 1]]);
    } else if (what?.k === 'feature') {
      const f = (p.features ?? []).find((x) => x.id === what.id);
      for (let i = 0; f && i + 1 < f.pts.length; i += 2) corners.push([f.pts[i], f.pts[i + 1]]);
    }
    this.drag = { kind: 'move', what, base: p, moved: false, y, acc: [0, 0], last: [ev.clientX, ev.clientY], scale, corners };
  }
  private move(ev: PointerEvent) {
    const v = this.h.view(); if (!v) return;
    { const rc = this.canvas.getBoundingClientRect(); this.lastXY = [ev.clientX - rc.left, ev.clientY - rc.top]; }
    try { this.moveIn(ev, v); } finally { this.tell(); }
  }
  private moveIn(ev: PointerEvent, v: ProView) {
    const d = this.drag;
    if (d?.kind === 'rect') { const g = this.snap(ev.clientX, ev.clientY, ev, { from: false }); if (g) { d.to = g; this.draw(); } return; }
    if (d?.kind === 'corner') {
      const ring0 = d.base.ring ?? [], extra: number[] = [];
      for (let i = 0; i + 1 < ring0.length; i += 2) if (i / 2 !== d.i) extra.push(ring0[i], ring0[i + 1]);
      const g = this.snap(ev.clientX, ev.clientY, ev, { extra, from: false }); if (!g) return;
      const ring = [...ring0]; ring[d.i * 2] = g[0]; ring[d.i * 2 + 1] = g[1];
      this.h.up({ shape: 'poly', ring, edgeRoads: d.base.edgeRoads });
      this.draw();
      return;
    }
    if (d?.kind === 'plan') {
      const b = this.h.p().scheme?.buildings.find((x) => x.id === d.id); if (!b?.form) return;
      // (the drag keeps its own copy of the plan: the next move builds on it, not on a render yet to come)
      const extra: number[] = [];
      d.plan.pts.forEach((q, i) => { if (i !== d.i) extra.push(...toWorld(b, q[0], q[1])); });
      const g = this.snap(ev.clientX, ev.clientY, ev, { ex: d.id, extra, from: false }); if (!g) return;
      const [lx, lz] = toLocal(b, g[0], g[1]);
      d.moved = true;
      d.plan = { ...d.plan, pts: d.plan.pts.map((q, i) => (i === d.i ? [r2(lx), r2(lz)] as Pt : q)) };
      const plan = { pts: d.plan.pts, ...(d.plan.sharp ? { sharp: d.plan.sharp } : {}) };
      this.setForm(d.id, (f) => ({ ...f, plan, keys: f.keys.map((k) => (k.plan ? { ...k, plan: undefined } : k)) }));
      this.draw();
      return;
    }
    if (d?.kind === 'move') {
      // The drag goes step by step: each step is the ground's own move under the pointer, but never more than three
      // times what that many pixels are worth at the depth the drag started at. Where the ray grazes the ground (a
      // low camera, a face touched above it) a pixel there is worth tens of metres, and the building would leap.
      const sdx = ev.clientX - d.last[0], sdy = ev.clientY - d.last[1], S = d.scale;
      const lin: Pt = [(S.right[0] * sdx - S.up[0] * sdy) * S.mpp, (S.right[1] * sdx - S.up[1] * sdy) * S.mpp];
      const a = v.groundAt(d.last[0], d.last[1], d.y), b = v.groundAt(ev.clientX, ev.clientY, d.y);
      let st: Pt = a && b ? [b[0] - a[0], b[1] - a[1]] : lin;
      if (st[0] * lin[0] + st[1] * lin[1] < 0) st = lin;
      const cap = 3 * Math.hypot(sdx, sdy) * S.mpp, ss = Math.hypot(st[0], st[1]);
      if (ss > cap) st = ss > 1e-9 ? [(st[0] / ss) * cap, (st[1] / ss) * cap] : lin;
      d.acc = [d.acc[0] + st[0], d.acc[1] + st[1]]; d.last = [ev.clientX, ev.clientY];
      let [dx, dz] = d.acc;
      this.guide = []; this.hotPt = null;
      if (this.snapOn && !ev.altKey && d.corners.length) {
        const s = this.snapSet(d.corners.map(([x, z]) => [x + dx, z + dz] as Pt), { ex: d.what?.k === 'building' ? d.what.id : undefined });
        dx += s.d[0]; dz += s.d[1]; this.guide = s.guide; this.hotPt = s.hot; this.why = s.why ?? null;
      }
      dx = r2(dx); dz = r2(dz);
      if (!d.moved && Math.hypot(ev.clientX - (this.downAt?.[0] ?? ev.clientX), ev.clientY - (this.downAt?.[1] ?? ev.clientY)) < 4) return;
      d.moved = true;
      this.h.up(moved(d.base, this.h.e(), d.what, dx, dz));
      this.draw();
      return;
    }
    if (modeOf(this.tool)) {
      this.hover = this.snap(ev.clientX, ev.clientY, ev);
      this.ghost = [];
      if (this.hover && this.tool.k === 'template') {
        const bs = placeTemplate(this.tool.id, this.hover, this.h.e());
        this.ghost = bs.map((b) => formRing(b)).filter((r) => r.length >= 6);
      }
      this.draw();
    }
  }
  private upE(ev: PointerEvent) {
    const v = this.h.view(); if (!v) return;
    const d = this.drag; this.drag = null;
    const click = this.downAt && Math.hypot(ev.clientX - this.downAt[0], ev.clientY - this.downAt[1]) < 5;
    if (d && d.kind !== 'rect') { this.guide = []; this.hotPt = null; this.draw(); }
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
    if (d) { if (d.kind === 'corner' || d.kind === 'plan' || d.moved) return; }
    const m = modeOf(this.tool);
    if (!m || !click) { if (m) v.controls.enabled = true; return; }
    const g = this.snap(ev.clientX, ev.clientY, ev); if (!g) return;
    if (m === 'point') { this.pts = g; this.finish(); return; }
    // closing an outline on its first corner
    if (m === 'area' && this.pts.length >= 6 && Math.hypot(g[0] - this.pts[0], g[1] - this.pts[1]) < 0.01) { this.finish(); return; }
    if (this.tool.k === 'measure' && !this.pts.length) this.measured = [];
    this.pts.push(...g);
    if (this.tool.k === 'measure' && this.pts.length >= 4) { this.measureDone(); v.controls.enabled = true; return; }
    this.draw(); this.tell();
    v.controls.enabled = true;
  }
  private key(ev: KeyboardEvent) {
    const t = ev.target instanceof HTMLElement ? ev.target : null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable || t.closest('[role="combobox"],[role="listbox"],[role="dialog"],[role="radiogroup"],[role="menu"],svg'))) return;
    // (the measurements box: a number typed while drawing, until Enter or Escape)
    const drawing = modeOf(this.tool) && this.pts.length >= 2 && !this.h.readOnly();
    if (drawing && !ev.ctrlKey && !ev.metaKey && !ev.altKey && (/^[0-9.,x×-]$/.test(ev.key) || (ev.key === ' ' && this.typed))) { ev.preventDefault(); ev.stopImmediatePropagation(); this.typed += ev.key; this.tell(); return; }
    if (this.typed && ev.key === 'Backspace') { ev.preventDefault(); ev.stopImmediatePropagation(); this.typed = this.typed.slice(0, -1); this.tell(); return; }
    if (this.typed && ev.key === 'Escape') { ev.preventDefault(); ev.stopImmediatePropagation(); this.typed = ''; this.tell(); return; }
    if (this.typed && ev.key === 'Enter') { ev.preventDefault(); ev.stopImmediatePropagation(); this.applyTyped(); this.tell(); return; }
    if (ev.key === 'Escape' && this.tool.k === 'measure' && this.measured.length && !this.pts.length) { ev.stopImmediatePropagation(); this.measured = []; this.draw(); this.tell(); return; }
    if (ev.key === 'Escape' && (this.tool.k !== 'select' || this.pts.length)) { ev.stopPropagation(); if (this.pts.length) { this.pts = []; this.draw(); } else this.h.done(); return; }
    if (ev.key === 'Enter' && this.pts.length) { ev.preventDefault(); this.finish(); return; }
    if (ev.key === 'Backspace' && this.pts.length) { ev.preventDefault(); this.pts.splice(-2); this.draw(); return; }
    const pk = this.h.picked();
    if ((ev.key === 'Delete' || ev.key === 'Backspace') && this.tool.k === 'select' && pk && !this.h.readOnly()) {
      ev.preventDefault();
      // (a formed building's point, just dragged: that point, while the plan keeps three)
      const fb = this.pickedForm(), sp = this.selPt;
      if (fb && sp && sp.id === fb.id && fb.form.plan.pts.length > 3) {
        this.setForm(fb.id, (f) => ({ ...f, plan: { pts: f.plan.pts.filter((_, i) => i !== sp.i), ...(f.plan.sharp ? { sharp: f.plan.sharp.filter((_, i) => i !== sp.i) } : {}) } }));
        this.selPt = null; this.draw();
        return;
      }
      this.h.up(removed(this.h.p(), this.h.e(), pk)); this.h.pick(null);
      return;
    }
    // the arrow keys nudge what's picked a grid step, along whichever of the road's two ways is nearest the screen's
    const ar = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, [number, number]>)[ev.key];
    if (ar && pk && this.tool.k === 'select' && !this.h.readOnly() && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      const v = this.h.view(); if (!v) return;
      const r = this.canvas.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const a = v.groundAt(cx, cy), b = v.groundAt(cx + ar[0] * 40, cy + ar[1] * 40); if (!a || !b) return;
      const F = roadFrame(this.h.e().r), wx = b[0] - a[0], wz = b[1] - a[1];
      const axes: Pt[] = [[F.ux, F.uz], [-F.ux, -F.uz], [F.vx, F.vz], [-F.vx, -F.vz]];
      const dir = axes.reduce((m, q) => (q[0] * wx + q[1] * wz > m[0] * wx + m[1] * wz ? q : m));
      const step = this.gridAt(a[0], a[1]) * (ev.shiftKey ? 10 : 1);
      ev.preventDefault();
      this.h.up(moved(this.h.p(), this.h.e(), pk, r2(dir[0] * step), r2(dir[1] * step)));
    }
  }

  // ---------- finishing ----------
  private finish() {
    const t = this.tool, P = this.pts, p = this.h.p(), e = this.h.e();
    this.pts = []; this.hover = null; this.ghost = []; this.guide = []; this.hotPt = null;
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
    if (t.k === 'template') {
      // (on a plot still filled for the user, the template is the design: it takes the filled buildings' place;
      // on a scheme of their own it joins what's there, sharing the floor area left)
      const s0 = own(p, e), s = p.scheme ? s0 : { ...s0, buildings: [] }, bs = placeTemplate(t.id, [P[0], P[1]], e);
      if (bs.length) {
        // (named after the template; a second of the same gets a letter)
        const named = bs.map((b, i) => ({ ...b, name: s.buildings.some((x) => x.name === b.name) || bs.slice(0, i).some((x) => x.name === b.name) ? `${b.name} ${String.fromCharCode(65 + s.buildings.length + i)}` : b.name }));
        this.h.up({ scheme: { ...s, buildings: [...s.buildings, ...named] } });
        this.h.pick({ k: 'building', id: named[0].id });
      }
    }
    if (t.k === 'element' && (t.kind === 'roundabout' || t.kind === 'tank' || t.kind === 'gate')) {
      const s = own(p, e), id = newBuildingId(), D = ELEMENTS.find((x) => x.value === t.kind)!;
      const F = roadFrame(e.r);
      let u: Pt = [F.ux, F.uz], c: Pt = [P[0], P[1]];
      if (t.kind === 'gate') {
        // (on the plot's edge nearest the click, along it)
        const ring = outline(p).ring; let bd = Infinity;
        for (let i = 0; i + 1 < ring.length; i += 2) {
          const j = (i + 2) % ring.length, ax = ring[i], az = ring[i + 1], ex = ring[j] - ax, ez = ring[j + 1] - az, L = Math.hypot(ex, ez) || 1;
          const tt = Math.max(D.len / 2, Math.min(L - D.len / 2, ((P[0] - ax) * ex + (P[1] - az) * ez) / L)), q: Pt = [ax + (ex / L) * tt, az + (ez / L) * tt], dd = Math.hypot(q[0] - P[0], q[1] - P[1]);
          if (dd < bd) { bd = dd; c = q; u = [ex / L, ez / L]; }
        }
      }
      // (a gate's spine is its opening; a roundabout's and a tank's a short stub at its middle, their width the depth)
      const h = t.kind === 'gate' ? D.len / 2 : 0.5;
      const el: SiteElement = { id, kind: t.kind, spine: [r2(c[0] - u[0] * h), r2(c[1] - u[1] * h), r2(c[0] + u[0] * h), r2(c[1] + u[1] * h)], depth: D.depth, floors: 0 };
      this.h.up({ scheme: { ...s, elements: [...s.elements, el] } });
      this.h.pick({ k: 'element', id });
    } else if (t.k === 'element') {
      const s = own(p, e), id = newBuildingId();
      const el: SiteElement = t.kind === 'road' || t.kind === 'wall' ? { id, kind: t.kind, spine: P, depth: t.kind === 'wall' ? 0.23 : 6, floors: 0 } : { id, kind: t.kind, spine: [], ring: P, depth: 0, floors: 0, ...(t.kind === 'parking' ? { levels: 3 } : {}) };
      this.h.up({ scheme: { ...s, elements: [...s.elements, el] } });
      this.h.pick({ k: 'element', id });
    }
    this.h.done();
    this.draw();
  }

  /** what's being drawn, the handles and the snap's guide, over the scene */
  draw() {
    const v = this.h.view(); if (!v) return;
    const o: Overlay = { lines: [], dashed: [], points: [], hot: [] };
    const P = this.drag?.kind === 'rect' ? (() => { const d = this.drag as { from: Pt; to: Pt }, [ax, az] = d.from, [bx, bz] = d.to; return [ax, az, bx, az, bx, bz, ax, bz]; })() : this.pts;
    for (let i = 0; i + 3 < P.length; i += 2) o.lines!.push(P[i], 0.1, P[i + 1], P[i + 2], 0.1, P[i + 3]);
    if (this.drag?.kind === 'rect' && P.length >= 8) o.lines!.push(P[6], 0.1, P[7], P[0], 0.1, P[1]);
    if (this.hover && this.pts.length >= 2) o.dashed!.push(P[P.length - 2], 0.1, P[P.length - 1], this.hover[0], 0.1, this.hover[1]);
    for (let i = 0; i + 1 < P.length; i += 2) o.points!.push(P[i], 0.1, P[i + 1]);
    if (this.hover && modeOf(this.tool)) o.hot!.push(this.hover[0], 0.1, this.hover[1]);
    for (const r of this.ghost) for (let i = 0; i + 1 < r.length; i += 2) { const j = (i + 2) % r.length; o.lines!.push(r[i], 0.15, r[i + 1], r[j], 0.15, r[j + 1]); }
    // the snap: its guide and the point it took
    for (let i = 0; i + 3 < this.guide.length; i += 4) o.dashed!.push(this.guide[i], 0.12, this.guide[i + 1], this.guide[i + 2], 0.12, this.guide[i + 3]);
    if (this.hotPt && !(this.hover && modeOf(this.tool))) o.hot!.push(this.hotPt[0], 0.12, this.hotPt[1]);
    // the plot's corners, to drag, on the Site step
    if (this.tool.k === 'select' && this.h.step() === 'site' && !this.h.readOnly()) { const r = outline(this.h.p()).ring; for (let i = 0; i < r.length; i += 2) o.points!.push(r[i], 0.1, r[i + 1]); }
    // a formed building's plan: its points, and a small + in the middle of each edge
    const fb = this.pickedForm();
    if (fb) {
      const ring = formRing(fb);
      for (let i = 0; i + 1 < ring.length; i += 2) { const j = (i + 2) % ring.length; o.lines!.push(ring[i], 0.1, ring[i + 1], ring[j], 0.1, ring[j + 1]); }
      const W = fb.form.plan.pts.map(([x, z]) => toWorld(fb, x, z)), n = W.length;
      const a0 = v.toScreen(W[0][0], 0, W[0][1]), a1 = v.toScreen(W[0][0] + 1, 0, W[0][1]), s = 4 / Math.max(0.5, Math.hypot(a1[0] - a0[0], a1[1] - a0[1]));
      W.forEach(([x, z], i) => {
        if (this.selPt?.id === fb.id && this.selPt.i === i) o.hot!.push(x, 0.1, z); else o.points!.push(x, 0.1, z);
        const [bx, bz] = W[(i + 1) % n], mx = (x + bx) / 2, mz = (z + bz) / 2;
        o.lines!.push(mx - s, 0.1, mz, mx + s, 0.1, mz, mx, 0.1, mz - s, mx, 0.1, mz + s);
      });
    }
    if (this.measured.length === 4) { const M = this.measured; o.lines!.push(M[0], 0.15, M[1], M[2], 0.15, M[3]); o.points!.push(M[0], 0.15, M[1], M[2], 0.15, M[3]); }
    if (this.decor) { o.lines!.push(...(this.decor.lines ?? [])); o.dashed!.push(...(this.decor.dashed ?? [])); o.points!.push(...(this.decor.points ?? [])); }
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
      // (a wall or a gate is thin: picked within a metre of it)
      const thin = el.kind === 'wall' || el.kind === 'gate';
      for (const q of elementRings(thin ? { ...el, depth: Math.max(el.depth, 2) } : el)) if (pointIn(q, g[0], g[1])) return el;
    }
    return null;
  }
}

/** the scheme as the user's own (the fill's, taken over, the first time anything's changed by hand) */
export function own(p: ProProject, e: Evaluated): NonNullable<ProProject['scheme']> {
  return p.scheme ?? ownScheme(e.d, p.buildingStyle);
}

const shift = (pts: number[], dx: number, dz: number) => pts.map((q, i) => r2(q + (i % 2 ? dz : dx)));

/** the project with a building, a thing or a feature moved (a formed building moves with its spine) */
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
/** a building turned about its middle (a formed one about its plan's middle, its spine and so its form with it) */
export function turned(b: ProBuilding, deg: number): ProBuilding {
  const [cx, cz] = middleOf(b);
  const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  return { ...b, spine: b.spine.map((_, i) => { const k = i - (i % 2), x = b.spine[k] - cx, z = b.spine[k + 1] - cz; return r2(i % 2 ? cz + x * s + z * c : cx + x * c - z * s); }) };
}
/** a copy of a building beside it (along its own length, clear of it by 6 m) */
export function duplicated(b: ProBuilding): ProBuilding {
  let dx = b.depth + 6, dz = 0;
  if (b.form) {
    const s = sampleCurve(b.form.plan, 2); let x0 = Infinity, x1 = -Infinity; for (let i = 0; i < s.length; i += 2) { x0 = Math.min(x0, s[i]); x1 = Math.max(x1, s[i]); }
    const w = Number.isFinite(x1 - x0) ? x1 - x0 + 6 : 20, [o, q] = [toWorld(b, 0, 0), toWorld(b, w, 0)];
    dx = q[0] - o[0]; dz = q[1] - o[1];
  }
  return { ...b, id: newBuildingId(), name: `${b.name ?? 'Building'} copy`, spine: shift(b.spine, dx, dz) };
}
/** a building stretched along its wings to a length (m, its spine's length) */
export function stretched(b: ProBuilding, len: number): ProBuilding {
  let L = 0; for (let i = 0; i + 3 < b.spine.length; i += 2) L += Math.hypot(b.spine[i + 2] - b.spine[i], b.spine[i + 3] - b.spine[i + 1]);
  if (b.closed) L += Math.hypot(b.spine[0] - b.spine[b.spine.length - 2], b.spine[1] - b.spine[b.spine.length - 1]);
  if (L < 0.1) return b;
  const k = len / L, n = b.spine.length / 2; let cx = 0, cz = 0;
  for (let i = 0; i < b.spine.length; i += 2) { cx += b.spine[i] / n; cz += b.spine[i + 1] / n; }
  return { ...b, spine: b.spine.map((q, i) => r2((i % 2 ? cz : cx) + (q - (i % 2 ? cz : cx)) * k)) };
}
export const spineLength = (b: ProBuilding) => { let L = 0; for (let i = 0; i + 3 < b.spine.length; i += 2) L += Math.hypot(b.spine[i + 2] - b.spine[i], b.spine[i + 3] - b.spine[i + 1]); if (b.closed && b.spine.length >= 4) L += Math.hypot(b.spine[0] - b.spine[b.spine.length - 2], b.spine[1] - b.spine[b.spine.length - 1]); return L; };
