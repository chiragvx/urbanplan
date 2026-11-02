// Site Studio's height handle: the selected building's floors dragged straight off its roof in the 3D view. A grab
// marker sits on the roof; drag it up for more floors, down for fewer, a whole floor at a time (about a floor's
// height on screen per floor, so the roof keeps up with the cursor), the floors and the height read out by the
// cursor. As many as asked, at least one: past the height limit it's flagged amber, never stopped. The drag is one
// undo step however long it takes; Esc while dragging puts it back. The plan's floors pill shares the drag (below).
// Read-only maps get no handle.
import type { Editor } from './editor';
import type { Id } from '../doc/types';
import { mode, readOnly, studio, studioSel, studioTool, toast } from './state';
import type { BuildingReport } from '../doc/site';

const ACCENT = '#2f5bff', AMBER = '#c98300', INK = '#1c2333';
const fx = (v: number) => (Math.round(v * 10) / 10).toString();

let seq = 0;

/** A floors drag under way: the building, its floors when it started, and whether it's changed anything yet. */
export interface FloorsDrag { plot: Id; b: string; f0: number; f: number; merge: string; changed: boolean }

/** A floors drag starts: its steps held together as one (doc.holdMerge) till it ends. */
export function beginFloors(E: Editor, plot: Id, b: string, f0: number): FloorsDrag {
  const merge = 'floors' + ++seq;
  E.doc.holdMerge = merge;
  return { plot, b, f0, f: f0, merge, changed: false };
}

/** The building at f floors (at least one; no most), live: the plan, the 3D and the numbers follow. */
export function dragFloors(E: Editor, d: FloorsDrag, f: number) {
  f = Math.max(1, Math.round(f));
  if (f === d.f) return;
  if (readOnly.value) { toast('This map is read-only', 'warn'); return; }
  const s = E.plot.site(d.plot);
  if (!s) return;
  d.f = f;
  d.changed = true;
  // (shaped by hand from here, as every studio edit: the optimiser leaves it alone until it's asked again)
  E.edit('Floors', () => E.doc.update(d.plot, { site: { ...s, buildings: s.buildings.map((b) => (b.id === d.b ? { ...b, floors: f, auto: undefined } : b)), manual: true } }), d.merge);
}

/** Released: the step it made stays (one undo step). */
export function endFloors(E: Editor, d: FloorsDrag) { if (E.doc.holdMerge === d.merge) E.doc.holdMerge = null; }

/** Esc: the drag's step taken back, and not left to redo. */
export function cancelFloors(E: Editor, d: FloorsDrag) {
  endFloors(E, d);
  if (d.changed && E.doc.undoLabel === 'Floors') E.doc.undo(true);
}

/** The handle on the selected building's roof in the studio's 3D view. */
export class StudioHeight {
  private drag: (FloorsDrag & { y0: number; ppf: number }) | null = null;
  /** the pointer, in overlay pixels, while over the handle or dragging it */
  private at: [number, number] | null = null;
  private off: (() => void)[] = [];

  constructor(readonly E: Editor, readonly id: Id) {
    // window, capture: ahead of the editor's own handlers on the 3D overlay (which would orbit or pick)
    const on = <K extends keyof WindowEventMap>(t: K, f: (e: WindowEventMap[K]) => void) => { window.addEventListener(t, f as EventListener, true); this.off.push(() => window.removeEventListener(t, f as EventListener, true)); };
    on('pointerdown', (e) => this.down(e));
    on('pointermove', (e) => this.move(e));
    on('pointerup', (e) => this.up(e));
    on('pointercancel', (e) => this.up(e));
    E.studioDraw = () => this.draw();
    this.off.push(() => { if (E.studioDraw) E.studioDraw = null; E.overlayDirty = true; });
    E.overlayDirty = true;
  }

  dispose() { if (this.drag) this.cancel(); for (const f of this.off) f(); }

  get dragging() { return !!this.drag; }

  /** Esc: the floors as they were before the drag. True when there was a drag to cancel. */
  cancel(): boolean {
    const d = this.drag;
    if (!d) return false;
    this.drag = null;
    cancelFloors(this.E, d);
    this.E.overlayDirty = true;
    return true;
  }

  /** the selected building's report, when it gets a handle */
  private target(): BuildingReport | null {
    if (studio.value !== this.id || mode.value !== '3d' || readOnly.value || studioTool.value !== 'select') return null;
    const sel = studioSel.value;
    if (!sel) return null;
    return this.E.plot.layout(this.id)?.buildings.find((b) => b.b.id === sel) ?? null;
  }

  /** Where the handle is on screen (the middle of the first wing's roof), and how many pixels a floor is there. */
  private spot(b: BuildingReport): { p: [number, number]; ppf: number } | null {
    const q = b.quads[0], E = this.E, r = E.plot.report(this.id);
    if (!q || q.length < 8 || !r) return null;
    let cx = 0, cz = 0, gMax = -Infinity;
    for (let i = 0; i < q.length; i += 2) { cx += q[i]; cz += q[i + 1]; gMax = Math.max(gMax, E.hf.sampleSurface(q[i], q[i + 1])); }
    cx /= q.length / 2; cz /= q.length / 2;
    gMax = Math.max(gMax, E.hf.sampleSurface(cx, cz));
    // the roof as the 3D builds it (plinth on the highest ground, the floors over it), less project()'s own lift
    const lift = gMax + 0.45 + b.height - E.hf.sampleSurface(cx, cz) - 0.4;
    const p = E.project(cx, cz, lift), up = E.project(cx, cz, lift + r.rules.floorH);
    if (!p) return null;
    // straight down a floor is no height on screen: then 8 px a floor, as on the plan's pill
    const dy = up ? p[1] - up[1] : 0;
    return { p, ppf: dy > 3 ? Math.min(60, dy) : 8 };
  }

  private local(e: PointerEvent): [number, number] { const r = this.E.overlay.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  private down(e: PointerEvent) {
    if (e.button !== 0 || e.target !== this.E.overlay || e.altKey) return;
    const b = this.target(), h = b && this.spot(b);
    if (!b || !h) return;
    const s = this.local(e);
    if (Math.hypot(s[0] - h.p[0], s[1] - h.p[1]) > 11) return;
    e.preventDefault(); e.stopImmediatePropagation();
    this.E.overlay.setPointerCapture(e.pointerId);
    this.drag = { ...beginFloors(this.E, this.id, b.b.id, b.floors), y0: s[1], ppf: h.ppf };
    this.at = s;
    this.E.overlayDirty = true;
  }

  private move(e: PointerEvent) {
    if (e.target !== this.E.overlay && !this.drag) return;
    const s = this.local(e), d = this.drag;
    if (d) {
      e.stopImmediatePropagation();
      this.at = s;
      // up adds floors, a floor's height on screen apiece
      dragFloors(this.E, d, d.f0 + Math.round((d.y0 - s[1]) / d.ppf));
      this.E.overlayDirty = true;
      return;
    }
    // over the handle: its cursor (and the editor's hover left alone)
    const b = this.target(), h = b && this.spot(b);
    const over = !!h && Math.hypot(s[0] - h.p[0], s[1] - h.p[1]) <= 11;
    if (over) { e.stopImmediatePropagation(); this.E.overlay.style.cursor = 'ns-resize'; }
    if (over !== !!this.at) { this.at = over ? s : null; this.E.overlayDirty = true; }
  }

  private up(e: PointerEvent) {
    const d = this.drag;
    if (!d) return;
    e.stopImmediatePropagation();
    this.drag = null;
    endFloors(this.E, d);
    this.E.overlayDirty = true;
  }

  // ---------------- drawing ----------------

  private draw() {
    const b = this.target(), h = b && this.spot(b);
    if (!b || !h) return;
    const ctx = this.E.ctx, [x, y] = h.p, col = b.overHeight ? AMBER : ACCENT;
    // the grab marker: a white disc with an up and a down chevron
    ctx.beginPath(); ctx.arc(x, y, this.drag || this.at ? 9 : 8, 0, Math.PI * 2);
    ctx.fillStyle = this.drag ? col : '#fff'; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 3, y - 1.5); ctx.lineTo(x, y - 4.5); ctx.lineTo(x + 3, y - 1.5); ctx.moveTo(x - 3, y + 1.5); ctx.lineTo(x, y + 4.5); ctx.lineTo(x + 3, y + 1.5);
    ctx.strokeStyle = this.drag ? '#fff' : col; ctx.lineWidth = 1.5; ctx.stroke();
    // the floors and the height by the cursor while dragging (by the handle on hover); the limit when it's past it
    if (!this.drag && !this.at) return;
    const r = this.E.plot.report(this.id);
    const t = `${b.floors} fl · ${fx(b.height)} m${b.overHeight && r ? ` · ${fx(r.rules.maxH)} m allowed` : ''}`;
    const p = this.drag && this.at ? this.at : [x, y];
    ctx.font = '600 11px Inter, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const tw = ctx.measureText(t).width + 14, lx = p[0] + 16, ly = p[1] - 16;
    ctx.beginPath(); ctx.roundRect(lx, ly - 10, tw, 20, 10); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.fillStyle = b.overHeight ? AMBER : INK; ctx.fillText(t, lx + 7, ly + 0.5);
  }
}
