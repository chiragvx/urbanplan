// Site Studio's plan: the plot and what's around it, the buildings with their flats, and direct editing. Click a
// building to select it; drag it to move it, drag a node to reshape it, drag the round handle to turn it, drag the
// square one on its face to change the depth; double-click its spine to add a node, Alt-click a node to drop it.
// The draw tool lays a new spine node by node (Enter or double-click finishes). Moves snap to the road's angles
// (every 45°) and to half metres; Shift moves freely. A car park, a lot or a garden is an area: drag out a rectangle
// (square to the road), click out any shape (Enter, double-click or the first corner closes it), or double-click an
// open patch to fill it. Its corners drag (snapping to the plot's and the buildings' corners and the plot's edges),
// the dot mid-edge adds a corner, Alt-click drops one. The roundabout drops where clicked; a road is laid node by
// node. The plan shows the ground as solved: every square metre one layer, bays and planting laid out procedurally.
// The shelf's buildings (slab, tower, L) drop where clicked, sized to the envelope; a single-wing building sizes by
// its corners and its floors drag on the pill above it. A gate drops on the plot's edge, a tank where clicked, a wall
// is laid node by node. Rules flag, never block: the part of a building past its margins is hatched amber, a building
// over the height limit gets an amber outline and dot; red is kept for buildings running into each other. In the 3D
// view the selected building's floors drag on a handle on its roof (studioheight); either drag is one undo step, and
// Esc during it puts the floors back.
import { effect } from '@preact/signals';
import type { Editor } from './editor';
import type { Id } from '../doc/types';
import { docVersion, readOnly, studioLevel, studioSel, studioTool, toast } from './state';
import { BUILDING_SHAPES, buildingQuads, circleRing, ELEMENTS, elementCentre, elementRings, isArea, isLine, isPoint, newBuildingId, pointIn, ringOf, UNIT_COLOR, type BuildingReport, type ElementKind, type PlotSite, type SiteBuilding, type SiteElement } from '../doc/site';
import { inset, sideMargin } from '../doc/plot';
import { area, diff, flat, fromFlat, grow, inside, inter, nearest, shrink, simplify, union, type MP } from '../doc/ground';
import { beginFloors, cancelFloors, dragFloors, endFloors, StudioHeight, type FloorsDrag } from './studioheight';

const ACCENT = '#2f5bff', RED = '#e5484d', INK = '#1c2333', AMBER = '#c98300';

type Drag =
  | { kind: 'pan'; x: number; y: number }
  | { kind: 'move'; b: string; start: [number, number]; spine: number[]; n: number; moved: boolean }
  | { kind: 'node'; b: string; i: number; spine: number[]; n: number; moved: boolean }
  | { kind: 'turn'; b: string; c: [number, number]; a0: number; spine: number[]; n: number }
  | { kind: 'depth'; b: string; n: number }
  | { kind: 'corner'; b: string; i: number; q: number[]; n: number }
  | { kind: 'floors'; y: number; fd: FloorsDrag }
  | { kind: 'rect'; el: ElementKind; a: [number, number]; moved: boolean }
  | { kind: 'vertex'; b: string; i: number; ring: number[]; n: number; moved: boolean }
  | { kind: 'ring'; b: string; start: [number, number]; ring: number[]; n: number; moved: boolean }
  | { kind: 'turnRing'; b: string; c: [number, number]; a0: number; ring: number[]; n: number };

let dragSeq = 0;

export class StudioCanvas {
  private ctx: CanvasRenderingContext2D;
  /** view: centre (tile metres) and pixels per metre */
  cx = 0; cz = 0; k = 3;
  private w = 0; private h = 0;
  private drag: Drag | null = null;
  /** the spine being drawn, and the cursor */
  private draft: number[] = [];
  private cursor: [number, number] | null = null;
  /** the node picked (Delete drops it) */
  node: number | null = null;
  /** an area being clicked out, corner by corner; the rectangle being dragged out */
  private shape: { kind: ElementKind; pts: number[] } | null = null;
  private rect: number[] | null = null;
  private dirty = true;
  private raf = 0;
  private off: (() => void)[] = [];
  /** the height handle in the 3D view */
  private height: StudioHeight;

  constructor(readonly el: HTMLCanvasElement, readonly E: Editor, readonly id: Id) {
    this.ctx = el.getContext('2d')!;
    this.height = new StudioHeight(E, id);
    this.off.push(() => this.height.dispose());
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(el);
    this.off.push(() => ro.disconnect());
    this.off.push(effect(() => { void docVersion.value; void studioSel.value; void studioLevel.value; void studioTool.value; this.dirty = true; }));
    const on = <K extends keyof HTMLElementEventMap>(t: K, f: (e: HTMLElementEventMap[K]) => void) => { el.addEventListener(t, f as EventListener); this.off.push(() => el.removeEventListener(t, f as EventListener)); };
    on('pointerdown', (e) => this.down(e));
    on('pointermove', (e) => this.move(e));
    on('pointerup', (e) => this.up(e));
    on('pointerleave', () => { this.cursor = null; this.dirty = true; });
    on('dblclick', (e) => this.dbl(e));
    on('wheel', (e) => this.wheel(e));
    on('contextmenu', (e) => e.preventDefault());
    this.resize();
    this.fit();
    const loop = () => { if (this.queued) { const q = this.queued; this.queued = null; this.moveNow(q); } if (this.dirty) { this.dirty = false; this.draw(); } this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  dispose() { cancelAnimationFrame(this.raf); if (this.drag?.kind === 'floors') endFloors(this.E, this.drag.fd); for (const f of this.off) f(); }

  private resize() {
    const r = this.el.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    this.w = r.width; this.h = r.height;
    this.el.width = Math.round(r.width * dpr); this.el.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dirty = true;
  }

  /** The whole plot in view, with some of its surroundings. */
  fit() {
    const o = this.E.doc.get<'plot'>(this.id);
    if (!o) return;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < o.ring.length; i += 2) { x0 = Math.min(x0, o.ring[i]); x1 = Math.max(x1, o.ring[i]); z0 = Math.min(z0, o.ring[i + 1]); z1 = Math.max(z1, o.ring[i + 1]); }
    this.cx = (x0 + x1) / 2; this.cz = (z0 + z1) / 2;
    this.k = Math.min((this.w || 600) / (x1 - x0 + 40), (this.h || 400) / (z1 - z0 + 40));
    this.dirty = true;
  }

  private toS = (x: number, z: number): [number, number] => [(x - this.cx) * this.k + this.w / 2, (z - this.cz) * this.k + this.h / 2];
  private toW = (sx: number, sy: number): [number, number] => [(sx - this.w / 2) / this.k + this.cx, (sy - this.h / 2) / this.k + this.cz];
  private at(e: { clientX: number; clientY: number }): [number, number] { const r = this.el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  // ---------------- the site ----------------

  private site(): PlotSite | null { return this.E.plot.site(this.id); }
  private commit(site: PlotSite, label: string, merge?: string) {
    if (readOnly.value) { toast('This map is read-only', 'warn'); return; }
    // (shaped by hand from here: the optimiser leaves it alone until it's asked again)
    this.E.edit(label, () => this.E.doc.update(this.id, { site: { ...site, manual: true } }), merge);
  }
  private setSpine(bid: string, spine: number[], label: string, merge?: string, patch?: Partial<SiteBuilding>) {
    const s = this.site();
    if (!s) return;
    const f = <T extends SiteBuilding>(b: T): T => (b.id === bid ? { ...b, ...patch, spine, auto: undefined } : b);
    this.commit({ ...s, buildings: s.buildings.map(f), elements: s.elements?.map(f) }, label, merge);
  }
  /** a building or an element (they're shaped the same way) */
  private building(bid: string | null): SiteBuilding | SiteElement | null {
    if (!bid) return null;
    const s = this.site();
    return s?.buildings.find((b) => b.id === bid) ?? s?.elements?.find((e) => e.id === bid) ?? null;
  }
  private drawing() { return studioTool.value === 'draw' || isLine(studioTool.value); }

  /** the road's direction (snapping goes by it) */
  private axis(): [number, number] { return this.E.plot.report(this.id)?.axis ?? [1, 0]; }

  /** A node placed from `from`: at one of the road's 45° angles when near one, and a whole half metre away. */
  private snap(p: [number, number], from: [number, number] | null, free: boolean): [number, number] {
    if (free || !from) return [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
    const [ax, az] = this.axis();
    const dx = p[0] - from[0], dz = p[1] - from[1], L = Math.hypot(dx, dz);
    if (L < 0.01) return from;
    const a = Math.atan2(dx * -az + dz * ax, dx * ax + dz * az);
    const q = Math.round(a / (Math.PI / 4)) * (Math.PI / 4);
    const ang = Math.abs(a - q) < (5 * Math.PI) / 180 ? q : a;
    const len = Math.round(L * 2) / 2;
    const c = Math.cos(ang), s = Math.sin(ang);
    return [from[0] + (ax * c - az * s) * len, from[1] + (az * c + ax * s) * len];
  }

  // ---------------- input ----------------

  private down(e: PointerEvent) {
    this.el.setPointerCapture(e.pointerId);
    const s = this.at(e), w = this.toW(...s);
    if (e.button === 1 || e.button === 2) { this.drag = { kind: 'pan', x: s[0], y: s[1] }; return; }
    if (e.button !== 0) return;
    const tool = studioTool.value;
    if (tool === 'slab' || tool === 'tower' || tool === 'lblock') { this.placeBuilding(tool, w); return; }
    if (isPoint(tool)) { this.place(tool as ElementKind, w); return; }
    if (tool !== 'select' && tool !== 'draw' && isArea({ kind: tool as ElementKind })) {
      if (this.shape) {
        // a corner; on the first one again, the shape closes
        const P = this.shape.pts, f = this.toS(P[0], P[1]);
        if (P.length >= 6 && Math.hypot(s[0] - f[0], s[1] - f[1]) < 9) { this.closeShape(); return; }
        const p = this.snapPt(this.snap(w, [P[P.length - 2], P[P.length - 1]], e.shiftKey), e.shiftKey);
        P.push(p[0], p[1]);
        this.dirty = true;
        return;
      }
      this.drag = { kind: 'rect', el: tool as ElementKind, a: this.snapPt(w, e.shiftKey), moved: false };
      return;
    }
    if (this.drawing()) {
      const last: [number, number] | null = this.draft.length ? [this.draft[this.draft.length - 2], this.draft[this.draft.length - 1]] : null;
      let p = this.snap(w, last, e.shiftKey);
      if (studioTool.value === 'road') p = this.roadSnap(w, p, e.shiftKey);
      this.draft.push(p[0], p[1]);
      this.dirty = true;
      return;
    }
    const sel = this.building(studioSel.value);
    // an area's handles: turn, corners (Alt-click drops one), the dots mid-edge (drag one out to add a corner)
    if (sel && 'kind' in sel && isArea(sel)) {
      const ring = ringOf(sel), h = this.handles(sel);
      if (Math.hypot(s[0] - h.turn[0], s[1] - h.turn[1]) < 9) {
        const c = elementCentre(sel);
        this.drag = { kind: 'turnRing', b: sel.id, c, a0: Math.atan2(w[1] - c[1], w[0] - c[0]), ring: [...ring], n: ++dragSeq };
        return;
      }
      for (let i = 0; i < ring.length; i += 2) {
        const p = this.toS(ring[i], ring[i + 1]);
        if (Math.hypot(s[0] - p[0], s[1] - p[1]) < 8) {
          if (e.altKey) { this.dropCorner(sel, i / 2); return; }
          this.node = i / 2;
          this.drag = { kind: 'vertex', b: sel.id, i: i / 2, ring: [...ring], n: ++dragSeq, moved: false };
          this.dirty = true;
          return;
        }
      }
      for (let i = 0; i < ring.length; i += 2) {
        const j = (i + 2) % ring.length, p = this.toS((ring[i] + ring[j]) / 2, (ring[i + 1] + ring[j + 1]) / 2);
        if (Math.hypot(ring[j] - ring[i], ring[j + 1] - ring[i + 1]) * this.k < 26) continue;
        if (Math.hypot(s[0] - p[0], s[1] - p[1]) < 7) {
          const R = [...ring];
          R.splice(i + 2, 0, (ring[i] + ring[j]) / 2, (ring[i + 1] + ring[j + 1]) / 2);
          this.node = i / 2 + 1;
          this.drag = { kind: 'vertex', b: sel.id, i: i / 2 + 1, ring: R, n: ++dragSeq, moved: false };
          return;
        }
      }
    }
    // handles of the selected building first: turn, depth, nodes
    if (sel && !('kind' in sel && isArea(sel))) {
      const h = this.handles(sel);
      if (Math.hypot(s[0] - h.turn[0], s[1] - h.turn[1]) < 9) {
        const c = spineCentre(sel.spine);
        this.drag = { kind: 'turn', b: sel.id, c, a0: Math.atan2(w[1] - c[1], w[0] - c[0]), spine: [...sel.spine], n: ++dragSeq };
        return;
      }
      if (h.floors && Math.hypot(s[0] - h.floors[0], s[1] - h.floors[1]) < 11) {
        const f0 = this.E.plot.layout(this.id)?.buildings.find((x) => x.b.id === sel.id)?.floors ?? sel.floors;
        this.drag = { kind: 'floors', y: s[1], fd: beginFloors(this.E, this.id, sel.id, f0) };
        return;
      }
      if (h.depth && Math.hypot(s[0] - h.depth[0], s[1] - h.depth[1]) < 8 && !('kind' in sel && isPoint(sel.kind))) { this.drag = { kind: 'depth', b: sel.id, n: ++dragSeq }; return; }
      for (let i = 0; i < h.corners.length; i++) {
        const p = h.corners[i];
        if (Math.hypot(s[0] - p[0], s[1] - p[1]) < 7) { this.drag = { kind: 'corner', b: sel.id, i, q: [...buildingQuads(sel)[0]], n: ++dragSeq }; return; }
      }
      for (let i = 0; i < sel.spine.length; i += 2) {
        const p = this.toS(sel.spine[i], sel.spine[i + 1]);
        if (Math.hypot(s[0] - p[0], s[1] - p[1]) < 8) {
          if (e.altKey) { this.dropNode(sel, i / 2); return; }
          this.node = i / 2;
          this.drag = { kind: 'node', b: sel.id, i: i / 2, spine: [...sel.spine], n: ++dragSeq, moved: false };
          this.dirty = true;
          return;
        }
      }
    }
    const hit = this.pick(w);
    studioSel.value = hit;
    this.node = null;
    const hb = this.building(hit);
    if (hb && 'kind' in hb && isArea(hb)) this.drag = { kind: 'ring', b: hb.id, start: w, ring: [...ringOf(hb)], n: ++dragSeq, moved: false };
    else if (hb) this.drag = { kind: 'move', b: hb.id, start: w, spine: [...hb.spine], n: ++dragSeq, moved: false };
    else this.drag = { kind: 'pan', x: s[0], y: s[1] };
  }

  /** the latest pointer move of a drag, applied once a frame (a fast mouse sends several a frame, each a re-solve) */
  private queued: { clientX: number; clientY: number; shiftKey: boolean } | null = null;
  private move(e: PointerEvent) {
    if (this.drag && this.drag.kind !== 'pan') { this.queued = { clientX: e.clientX, clientY: e.clientY, shiftKey: e.shiftKey }; this.dirty = true; return; }
    this.moveNow(e);
  }
  private moveNow(e: { clientX: number; clientY: number; shiftKey: boolean }) {
    const s = this.at(e), w = this.toW(...s);
    this.cursor = w;
    const d = this.drag;
    this.dirty = true;
    if (!d) { this.el.style.cursor = studioTool.value !== 'select' ? 'crosshair' : this.pick(w) ? 'move' : 'default'; return; }
    switch (d.kind) {
      case 'rect': {
        const b = this.snapPt(w, e.shiftKey);
        if (!d.moved && Math.hypot(b[0] - d.a[0], b[1] - d.a[1]) * this.k < 6) break;
        d.moved = true;
        this.rect = this.rectRing(d.a, b, e.shiftKey);
        break;
      }
      case 'vertex': {
        if (!d.moved && Math.hypot(w[0] - d.ring[d.i * 2], w[1] - d.ring[d.i * 2 + 1]) * this.k < 3) break;
        d.moved = true;
        const n = d.ring.length / 2, pv = (d.i + n - 1) % n;
        const p = this.snapPt(this.snap(w, [d.ring[pv * 2], d.ring[pv * 2 + 1]], e.shiftKey), e.shiftKey, d.b);
        const ring = [...d.ring];
        ring[d.i * 2] = p[0]; ring[d.i * 2 + 1] = p[1];
        this.setRing(d.b, ring, 'Reshape', 'studio' + d.n);
        break;
      }
      case 'ring': {
        const dx = w[0] - d.start[0], dz = w[1] - d.start[1];
        if (!d.moved && Math.hypot(dx, dz) * this.k < 3) break;
        d.moved = true;
        const mx = Math.round(dx * 10) / 10, mz = Math.round(dz * 10) / 10;
        this.setRing(d.b, d.ring.map((v, i) => v + (i % 2 ? mz : mx)), 'Move', 'studio' + d.n);
        break;
      }
      case 'turnRing': {
        let a = Math.atan2(w[1] - d.c[1], w[0] - d.c[0]) - d.a0;
        if (!e.shiftKey) a = Math.round(a / ((5 * Math.PI) / 180)) * ((5 * Math.PI) / 180);
        const c = Math.cos(a), sn = Math.sin(a);
        const ring = d.ring.map((_, i) => {
          const x = d.ring[i - (i % 2)] - d.c[0], z = d.ring[i - (i % 2) + 1] - d.c[1];
          return Math.round((i % 2 ? d.c[1] + x * sn + z * c : d.c[0] + x * c - z * sn) * 100) / 100;
        });
        this.setRing(d.b, ring, 'Turn', 'studio' + d.n);
        break;
      }
      case 'pan':
        this.cx -= (s[0] - d.x) / this.k; this.cz -= (s[1] - d.y) / this.k;
        d.x = s[0]; d.y = s[1];
        break;
      case 'move': {
        const dx = w[0] - d.start[0], dz = w[1] - d.start[1];
        if (!d.moved && Math.hypot(dx, dz) * this.k < 3) break;
        d.moved = true;
        // whole tenths of a metre, so the building keeps its shape exactly
        let mx = Math.round(dx * 10) / 10, mz = Math.round(dz * 10) / 10;
        const mb = this.building(d.b);
        if (mb && 'kind' in mb && mb.kind === 'roundabout') {
          // a roundabout's centre onto a road's node or line
          const [cx, cz] = spineCentre(d.spine), t = this.roadSnap([cx + dx, cz + dz], [cx + mx, cz + mz], e.shiftKey, d.b);
          mx = t[0] - cx; mz = t[1] - cz;
        }
        this.setSpine(d.b, d.spine.map((v, i) => v + (i % 2 ? mz : mx)), 'Move building', 'studio' + d.n);
        break;
      }
      case 'node': {
        const n = d.spine.length / 2;
        if (!d.moved && Math.hypot(w[0] - d.spine[d.i * 2], w[1] - d.spine[d.i * 2 + 1]) * this.k < 3) break;
        d.moved = true;
        const b = this.building(d.b);
        const prev = d.i > 0 ? d.i - 1 : b?.closed ? n - 1 : -1;
        const ref: [number, number] | null = prev >= 0 ? [d.spine[prev * 2], d.spine[prev * 2 + 1]] : d.i + 1 < n ? [d.spine[(d.i + 1) * 2], d.spine[(d.i + 1) * 2 + 1]] : null;
        let p = this.snap(w, ref, e.shiftKey);
        if (b && 'kind' in b && b.kind === 'road') p = this.roadSnap(w, p, e.shiftKey, b.id);
        const spine = [...d.spine];
        spine[d.i * 2] = p[0]; spine[d.i * 2 + 1] = p[1];
        this.setSpine(d.b, spine, 'Reshape building', 'studio' + d.n);
        break;
      }
      case 'turn': {
        let a = Math.atan2(w[1] - d.c[1], w[0] - d.c[0]) - d.a0;
        if (!e.shiftKey) {
          // the first wing lands on whole 5° off the road's line
          const [ax, az] = this.axis();
          const s0 = d.spine, wing = Math.atan2(s0[3] - s0[1], s0[2] - s0[0]) - Math.atan2(az, ax);
          const step = (5 * Math.PI) / 180;
          a = Math.round((wing + a) / step) * step - wing;
        }
        const c = Math.cos(a), sn = Math.sin(a);
        const spine = d.spine.map((v, i) => {
          const x = d.spine[i - (i % 2)] - d.c[0], z = d.spine[i - (i % 2) + 1] - d.c[1];
          return Math.round((i % 2 ? d.c[1] + x * sn + z * c : d.c[0] + x * c - z * sn) * 100) / 100;
        });
        this.setSpine(d.b, spine, 'Turn building', 'studio' + d.n);
        break;
      }
      case 'depth': {
        const b = this.building(d.b);
        if (!b) break;
        // twice the distance from the first wing's line, in half metres (no cap: only a building of no depth is refused)
        const ax = b.spine[0], az = b.spine[1], tx = b.spine[2] - ax, tz = b.spine[3] - az, L = Math.hypot(tx, tz) || 1;
        const off = Math.abs(((w[0] - ax) * -tz + (w[1] - az) * tx) / L);
        const depth = Math.max(1, Math.round(off * 4) / 2);
        if (depth !== b.depth) this.setSpine(d.b, b.spine, 'Building depth', 'studio' + d.n, { depth });
        break;
      }
      case 'corner': {
        // the corner opposite stays put; the building is the rectangle between it and the cursor, square to its wing
        const q = d.q, o = (d.i + 2) % 4, F: [number, number] = [q[o * 2], q[o * 2 + 1]];
        const tx0 = q[2] - q[0], tz0 = q[3] - q[1], L = Math.hypot(tx0, tz0) || 1, tx = tx0 / L, tz = tz0 / L, nx = -tz, nz = tx;
        let du = (w[0] - F[0]) * tx + (w[1] - F[1]) * tz, dv = (w[0] - F[0]) * nx + (w[1] - F[1]) * nz;
        if (!e.shiftKey) { du = Math.round(du * 2) / 2; dv = Math.round(dv * 2) / 2; }
        // (at least a metre each way: a building of no size is the only thing refused)
        if (Math.abs(du) < 1) du = du < 0 ? -1 : 1;
        if (Math.abs(dv) < 1) dv = dv < 0 ? -1 : 1;
        const sx = F[0] + nx * dv / 2, sz = F[1] + nz * dv / 2;
        const spine = [sx, sz, sx + tx * du, sz + tz * du].map((v) => Math.round(v * 100) / 100);
        this.setSpine(d.b, spine, 'Size building', 'studio' + d.n, { depth: Math.abs(dv) });
        break;
      }
      case 'floors': {
        // up adds floors, 8 px a floor; as many as asked, at least one
        dragFloors(this.E, d.fd, d.fd.f0 + Math.round((d.y - s[1]) / 8));
        break;
      }
    }
  }

  private up(_e: PointerEvent) {
    if (this.queued) { const q = this.queued; this.queued = null; this.moveNow(q); }
    const d = this.drag;
    this.hitSnap = null;
    if (d?.kind === 'floors') endFloors(this.E, d.fd);
    if (d?.kind === 'rect') {
      // dragged: the rectangle; clicked: the first corner of a shape
      const R = this.rect;
      this.rect = null;
      if (d.moved && R) this.addArea(d.el, R);
      else this.shape = { kind: d.el, pts: [...d.a] };
    }
    this.drag = null;
    this.dirty = true;
  }

  private dbl(e: MouseEvent) {
    if (this.drawing()) { this.finish(); return; }
    const s = this.at(e), w = this.toW(...s);
    if (this.shape) {
      // a double-click straight off: the open patch there, filled; later on, the shape closes
      const P = this.shape.pts;
      if (P.length <= 4 && Math.hypot(P[0] - w[0], P[1] - w[1]) * this.k < 8) { const k = this.shape.kind; this.shape = null; this.fill(k, w); return; }
      // (the double-click's second click added a corner on top of the last)
      if (P.length >= 4 && Math.hypot(P[P.length - 2] - P[P.length - 4], P[P.length - 1] - P[P.length - 3]) < 0.3) P.splice(-2, 2);
      this.closeShape();
      return;
    }
    const b = this.building(studioSel.value);
    if (!b || ('kind' in b && isArea(b))) return;
    // a new node on the spine where it was double-clicked
    const n = b.spine.length / 2, segs = b.closed ? n : n - 1;
    let best = -1, bd = 10 / this.k, bp: [number, number] = [0, 0];
    for (let k = 0; k < segs; k++) {
      const j = (k + 1) % n, ax = b.spine[k * 2], az = b.spine[k * 2 + 1], dx = b.spine[j * 2] - ax, dz = b.spine[j * 2 + 1] - az;
      const t = Math.max(0.05, Math.min(0.95, ((w[0] - ax) * dx + (w[1] - az) * dz) / (dx * dx + dz * dz || 1)));
      const px = ax + dx * t, pz = az + dz * t, dd = Math.hypot(w[0] - px, w[1] - pz);
      if (dd < bd) { bd = dd; best = k; bp = [Math.round(px * 10) / 10, Math.round(pz * 10) / 10]; }
    }
    if (best < 0) return;
    const spine = [...b.spine];
    spine.splice((best + 1) * 2, 0, bp[0], bp[1]);
    this.setSpine(b.id, spine, 'Add a node');
    this.node = best + 1;
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    const s = this.at(e), before = this.toW(...s);
    this.k = Math.max(0.3, Math.min(40, this.k * Math.exp(-e.deltaY * 0.0015)));
    const after = this.toW(...s);
    this.cx += before[0] - after[0]; this.cz += before[1] - after[1];
    this.dirty = true;
  }

  /** Keys while the studio is open; true when taken. */
  key(e: KeyboardEvent): boolean {
    const b = this.building(studioSel.value);
    switch (e.key) {
      case 'Escape':
        // a floors drag (on the plan's pill or the 3D handle): the floors as they were
        if (this.height.cancel()) return true;
        if (this.drag?.kind === 'floors') { cancelFloors(this.E, this.drag.fd); this.drag = null; this.dirty = true; return true; }
        if (this.draft.length) { this.draft = []; this.dirty = true; return true; }
        if (this.shape) { this.shape = null; this.dirty = true; return true; }
        if (studioTool.value !== 'select') { studioTool.value = 'select'; return true; }
        if (this.node !== null) { this.node = null; this.dirty = true; return true; }
        if (b) { studioSel.value = null; return true; }
        return false;
      case 'Enter':
        if (this.drawing()) { this.finish(); return true; }
        if (this.shape) { this.closeShape(); return true; }
        return false;
      case 'Delete': case 'Backspace':
        if (this.drawing()) { this.draft.splice(-2, 2); this.dirty = true; return true; }
        if (this.shape) { this.shape.pts.splice(-2, 2); if (!this.shape.pts.length) this.shape = null; this.dirty = true; return true; }
        if (b && 'kind' in b && isArea(b) && this.node !== null) { this.dropCorner(b, this.node); return true; }
        if (b && this.node !== null) { this.dropNode(b, this.node); return true; }
        if (b) { this.remove(b.id); return true; }
        return false;
      case 'b': case 'B': studioTool.value = 'draw'; return true;
      case 'v': case 'V': studioTool.value = 'select'; this.draft = []; return true;
      case 'd': case 'D': if ((e.ctrlKey || e.metaKey) && b) { this.duplicate(b); return true; } return false;
    }
    return false;
  }

  /** The spine drawn so far becomes a building. */
  finish() {
    const P = this.draft;
    this.draft = [];
    this.dirty = true;
    if (P.length < 4) return;
    const s = this.site();
    if (!s) return;
    const id = newBuildingId();
    if (studioTool.value === 'road') this.commit({ ...s, elements: [...(s.elements ?? []), { id, kind: 'road', spine: P, depth: 7, floors: 0 }] }, 'Add a road');
    else if (studioTool.value === 'wall') this.commit({ ...s, elements: [...(s.elements ?? []), { id, kind: 'wall', spine: P, depth: 0.23, floors: 0 }] }, 'Add a wall');
    else this.commit({ ...s, buildings: [...s.buildings, { id, spine: P, depth: 16, floors: 0 }] }, 'Add a building');
    studioSel.value = id;
    studioTool.value = 'select';
  }

  /** A car park, lot, garden or roundabout dropped where clicked, along the road. */
  private place(kind: ElementKind, w: [number, number]) {
    const s = this.site(), m = ELEMENTS.find((x) => x.value === kind);
    if (!s || !m) return;
    let [ax, az] = this.axis();
    const h = m.len / 2;
    if (kind === 'gate') {
      // onto the plot's nearest edge, along it
      const N = this.E.plot.report(this.id)?.net ?? [];
      let bd = Infinity;
      for (let i = 0; i < N.length; i += 2) {
        const j = (i + 2) % N.length, dx = N[j] - N[i], dz = N[j + 1] - N[i + 1], L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((w[0] - N[i]) * dx + (w[1] - N[i + 1]) * dz) / L2)), px = N[i] + dx * t, pz = N[i + 1] + dz * t;
        const dd = Math.hypot(px - w[0], pz - w[1]);
        if (dd < bd) { bd = dd; w = [px, pz]; const L = Math.sqrt(L2); ax = dx / L; az = dz / L; }
      }
    }
    const spine = [w[0] - ax * h, w[1] - az * h, w[0] + ax * h, w[1] + az * h].map((v) => Math.round(v * 10) / 10);
    const id = newBuildingId();
    const e: SiteElement = { id, kind, spine, depth: m.depth, floors: 0, ...(kind === 'parking' ? { levels: 3 } : {}) };
    this.commit({ ...s, elements: [...(s.elements ?? []), e] }, `Add ${m.label.toLowerCase()}`);
    studioSel.value = id;
    studioTool.value = 'select';
  }

  /** A slab, tower or L-block dropped where clicked, square to the road, no bigger than the envelope there (it's
   *  sized by its corners after). Its floors fill the FSI until they're set. */
  private placeBuilding(kind: 'slab' | 'tower' | 'lblock', w: [number, number]) {
    const s = this.site(), r = this.E.plot.report(this.id), m = BUILDING_SHAPES.find((x) => x.value === kind);
    if (!s || !r || !m) return;
    const [ax, az] = this.axis(), px = -az, pz = ax;
    // the envelope's extent along and across the road
    const env = r.footprint.length >= 6 ? r.footprint : r.net;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (let i = 0; i < env.length; i += 2) { const u = env[i] * ax + env[i + 1] * az, v = env[i] * px + env[i + 1] * pz; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const fitU = Number.isFinite(u0) ? Math.max(3, u1 - u0) : m.len, fitV = Number.isFinite(v0) ? Math.max(3, v1 - v0) : m.depth;
    const D = Math.min(m.depth, fitV), Lu = Math.max(D, Math.min(m.len, fitU));
    const at = (u: number, v: number) => [w[0] + ax * u + px * v, w[1] + az * u + pz * v];
    let spine: number[];
    if (kind === 'lblock' && fitV >= D * 2 && fitU >= D * 2) {
      const Lv = Math.min(m.len * 0.75, fitV);
      spine = [...at(Lu / 2, -Lv / 2 + D / 2), ...at(-Lu / 2 + D / 2, -Lv / 2 + D / 2), ...at(-Lu / 2 + D / 2, Lv / 2)];
    } else spine = [...at(-Lu / 2, 0), ...at(Lu / 2, 0)];
    const id = newBuildingId();
    this.commit({ ...s, buildings: [...s.buildings, { id, spine: spine.map((v) => Math.round(v * 100) / 100), depth: D, floors: 0 }] }, `Add a ${m.label.toLowerCase()}`);
    studioSel.value = id;
    studioTool.value = 'select';
  }

  /** A rectangle from a to b, square to the road (to the screen with Shift), its sides in half metres. */
  private rectRing(a: [number, number], b: [number, number], free: boolean): number[] {
    const [ax, az] = free ? [1, 0] : this.axis(), px = -az, pz = ax;
    let u = (b[0] - a[0]) * ax + (b[1] - a[1]) * az, v = (b[0] - a[0]) * px + (b[1] - a[1]) * pz;
    if (!free) { u = Math.round(u * 2) / 2; v = Math.round(v * 2) / 2; }
    const r = (x: number) => Math.round(x * 100) / 100;
    return [a[0], a[1], a[0] + ax * u, a[1] + az * u, a[0] + ax * u + px * v, a[1] + az * u + pz * v, a[0] + px * v, a[1] + pz * v].map(r);
  }
  private addArea(kind: ElementKind, drawn: number[]) {
    const s = this.site(), m = ELEMENTS.find((x) => x.value === kind), net = this.E.plot.report(this.id)?.net;
    if (!s || !m || drawn.length < 6) return;
    // kept on the plot: what of it is on the net plot (the biggest piece)
    let ring = drawn;
    if (net && net.length >= 6) {
      const on = inter(fromFlat(drawn), fromFlat(net));
      let best: number[] = [], ba = 0;
      for (const p of on) { const a = area([p]); if (a > ba) { ba = a; best = flat(p[0]); } }
      if (!best.length) { toast('That’s outside the plot', 'warn'); return; }
      ring = Math.abs(ba - area(fromFlat(drawn))) < 0.01 ? drawn : simplify(best, 0.05).map((v) => Math.round(v * 100) / 100);
    }
    if (area(fromFlat(ring)) < 0.5) return;
    const id = newBuildingId();
    const e: SiteElement = { id, kind, ring, spine: ring.slice(0, 4), depth: 0, floors: 0, ...(kind === 'parking' ? { levels: 3 } : {}) };
    this.commit({ ...s, elements: [...(s.elements ?? []), e] }, `Add ${m.label.toLowerCase()}`);
    studioSel.value = id;
    studioTool.value = 'select';
  }
  private closeShape() {
    const sh = this.shape;
    this.shape = null;
    this.dirty = true;
    if (sh && sh.pts.length >= 6) this.addArea(sh.kind, sh.pts);
  }
  /** The open ground under a point, as an area of this kind. */
  private fill(kind: ElementKind, w: [number, number]) {
    const d = this.E.plot.layout(this.id);
    if (!d) return;
    const M = d.ground.map;
    const open = union(M.green, M.apron, ...(kind === 'garden' ? [] : [M.lawn, M.path, M.bed]));
    if (!inside(open, w[0], w[1])) { toast('Nothing open there to fill: drag out an area, or click its corners', 'warn'); return; }
    // the patch: the open ground cut at its narrow necks (the strips along the wall join it all up), the piece here
    const K = 4, core = shrink(open, K);
    const piece = core.find((p) => inside([p], w[0], w[1])) ?? core.map((p) => ({ p, d: nearest([p], w[0], w[1])[2] })).filter((x) => x.d < K * 2).sort((a, b) => a.d - b.d)[0]?.p;
    const patch = piece ? inter(grow([piece], K + 0.05), open) : open;
    const here = patch.find((p) => inside([p], w[0], w[1])) ?? patch.sort((a, b) => area([b]) - area([a]))[0];
    if (!here) return;
    this.addArea(kind, simplify(flat(here[0]), 0.4).map((v) => Math.round(v * 100) / 100));
  }
  private setRing(bid: string, ring: number[], label: string, merge?: string) {
    const s = this.site();
    if (!s) return;
    this.commit({ ...s, elements: s.elements?.map((e) => (e.id === bid ? { ...e, ring, auto: undefined } : e)) }, label, merge);
  }
  private dropCorner(e: SiteElement, i: number) {
    const ring = ringOf(e);
    if (ring.length <= 6) { toast('An area needs at least three corners', 'warn'); return; }
    const R = [...ring];
    R.splice(i * 2, 2);
    this.setRing(e.id, R, 'Remove a corner');
    this.node = null;
  }
  /** where the last road node snapped to (drawn as a ring), and what */
  private hitSnap: { p: [number, number]; on: 'node' | 'line' } | null = null;
  /** A road node (from the cursor at w, `p` as placed so far): onto another road's node or end, a roundabout's
   *  centre, the drive's corners or a gate; else onto another road's line, the drive or the plot's edge (a gate). */
  private roadSnap(w: [number, number], p: [number, number], free: boolean, skip?: string): [number, number] {
    this.hitSnap = null;
    if (free) return p;
    const s = this.site(), d = this.E.plot.layout(this.id), r = this.E.plot.report(this.id);
    const tol = 10 / this.k;
    const lines: number[][] = [], nodes: number[][] = [];
    for (const e of s?.elements ?? []) {
      if (e.id === skip) continue;
      if (e.kind === 'road') { lines.push(e.spine); for (let i = 0; i < e.spine.length; i += 2) nodes.push([e.spine[i], e.spine[i + 1]]); }
      if (e.kind === 'roundabout' && e.spine.length >= 4) nodes.push(spineCentre(e.spine));
    }
    for (const L of d?.ground.drive ?? []) { lines.push(L); for (let i = 0; i < L.length; i += 2) nodes.push([L[i], L[i + 1]]); }
    for (const g of d?.ground.gates ?? []) nodes.push([(g[0] + g[2]) / 2, (g[1] + g[3]) / 2]);
    let best: [number, number] | null = null, bd = tol;
    for (const [x, z] of nodes) { const dd = Math.hypot(x - w[0], z - w[1]); if (dd < bd) { bd = dd; best = [x, z]; } }
    if (best) { this.hitSnap = { p: best, on: 'node' }; return best; }
    const N = r?.net ?? [];
    for (const [L, closed] of [...lines.map((l) => [l, false] as const), [N, true] as const]) {
      const n = L.length / 2;
      for (let i = 0; i < (closed ? n : n - 1); i++) {
        const j = (i + 1) % n, ax = L[i * 2], az = L[i * 2 + 1], dx = L[j * 2] - ax, dz = L[j * 2 + 1] - az, L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((w[0] - ax) * dx + (w[1] - az) * dz) / L2)), px = ax + dx * t, pz = az + dz * t, dd = Math.hypot(px - w[0], pz - w[1]);
        if (dd < bd) { bd = dd; best = [Math.round(px * 100) / 100, Math.round(pz * 100) / 100]; }
      }
    }
    if (best) { this.hitSnap = { p: best, on: 'line' }; return best; }
    return p;
  }

  /** A point snapped to a corner of the plot, a building or another area near it, or onto the plot's edge. */
  private snapPt(w: [number, number], free: boolean, skip?: string): [number, number] {
    if (free) return w;
    const o = this.E.doc.get<'plot'>(this.id), r = this.E.plot.report(this.id), s = this.site();
    const tol = 9 / this.k;
    const pts: number[][] = [o?.ring ?? [], r?.net ?? [], ...(s?.buildings ?? []).flatMap(buildingQuads), ...(s?.elements ?? []).filter((e) => e.id !== skip).flatMap(elementRings)];
    let best: [number, number] | null = null, bd = tol;
    for (const P of pts) for (let i = 0; i + 1 < P.length; i += 2) { const dd = Math.hypot(P[i] - w[0], P[i + 1] - w[1]); if (dd < bd) { bd = dd; best = [P[i], P[i + 1]]; } }
    if (best) return best;
    // onto the net plot's edge
    const N = r?.net ?? [];
    bd = tol * 0.8;
    for (let i = 0; i < N.length; i += 2) {
      const j = (i + 2) % N.length, dx = N[j] - N[i], dz = N[j + 1] - N[i + 1], L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((w[0] - N[i]) * dx + (w[1] - N[i + 1]) * dz) / L2)), px = N[i] + dx * t, pz = N[i + 1] + dz * t;
      const dd = Math.hypot(px - w[0], pz - w[1]);
      if (dd < bd) { bd = dd; best = [px, pz]; }
    }
    return best ?? w;
  }

  remove(bid: string) {
    const s = this.site();
    if (!s) return;
    this.commit({ ...s, buildings: s.buildings.filter((x) => x.id !== bid), elements: s.elements?.filter((x) => x.id !== bid) }, 'Remove');
    studioSel.value = null;
  }

  duplicate(b: SiteBuilding) {
    const s = this.site();
    if (!s) return;
    // a copy set back from the original by its depth and a gap
    const [ax, az] = this.axis(), area = 'kind' in b && isArea(b as SiteElement);
    let off = b.depth + 6;
    if (area) { const R = ringOf(b as SiteElement); let lo = Infinity, hi = -Infinity; for (let i = 0; i < R.length; i += 2) { const v = -az * R[i] + ax * R[i + 1]; lo = Math.min(lo, v); hi = Math.max(hi, v); } off = hi - lo + 4; }
    const mv = (P: number[]) => P.map((v, i) => Math.round((v + (i % 2 ? ax : -az) * off) * 100) / 100);
    const id = newBuildingId(), c = { ...b, id, spine: mv(b.spine), ...(area ? { ring: mv(ringOf(b as SiteElement)) } : {}), auto: undefined };
    if ('kind' in b) this.commit({ ...s, elements: [...(s.elements ?? []), c as SiteElement] }, 'Duplicate');
    else this.commit({ ...s, buildings: [...s.buildings, c] }, 'Duplicate building');
    studioSel.value = id;
  }

  private dropNode(b: SiteBuilding, i: number) {
    const n = b.spine.length / 2;
    if (n <= (b.closed ? 3 : 2)) { toast('It needs at least two nodes (three round a court)', 'warn'); return; }
    const spine = [...b.spine];
    spine.splice(i * 2, 2);
    this.setSpine(b.id, spine, 'Remove a node');
    this.node = null;
  }

  /** The building under a point. */
  private pick(w: [number, number]): string | null {
    const s = this.site();
    if (!s) return null;
    for (let i = s.buildings.length - 1; i >= 0; i--) if (buildingQuads(s.buildings[i]).some((q) => pointIn(q, w[0], w[1], 0.5))) return s.buildings[i].id;
    const els = s.elements ?? [];
    for (let i = els.length - 1; i >= 0; i--) if (elementRings(els[i]).some((q) => pointIn(q, w[0], w[1], 0.5))) return els[i].id;
    return null;
  }

  /** Screen positions of a building's turn handle (above it) and depth handle (on the first wing's face; none for an
   *  area). */
  private handles(b: SiteBuilding | SiteElement) {
    if ('kind' in b && isArea(b)) {
      const R = ringOf(b);
      let top = Infinity, cx = 0;
      for (let i = 0; i < R.length; i += 2) { const p = this.toS(R[i], R[i + 1]); top = Math.min(top, p[1]); cx += p[0]; }
      return { turn: [cx / (R.length / 2 || 1), top - 22] as [number, number], depth: null, corners: [] as [number, number][], floors: null };
    }
    const q = buildingQuads(b);
    let top = Infinity, cx = 0, n = 0;
    for (const r of q) for (let i = 0; i < r.length; i += 2) { const p = this.toS(r[i], r[i + 1]); top = Math.min(top, p[1]); cx += p[0]; n++; }
    const turn: [number, number] = [cx / (n || 1), top - 22];
    let depth: [number, number] | null = null;
    if (q.length) { const r = q[0]; depth = this.toS((r[0] + r[2]) / 2, (r[1] + r[3]) / 2); }
    const el = 'kind' in b;
    // a single wing sizes by its corners; a building's floors drag on the pill beside the turn handle
    const corners: [number, number][] = !el && q.length === 1 ? [0, 1, 2, 3].map((i) => this.toS(q[0][i * 2], q[0][i * 2 + 1])) : [];
    const floors: [number, number] | null = el || readOnly.value ? null : [turn[0] + 26, turn[1]];
    return { turn, depth, corners, floors };
  }

  // ---------------- drawing ----------------

  private draw() {
    const ctx = this.ctx, E = this.E;
    ctx.clearRect(0, 0, this.w, this.h);
    const css = getComputedStyle(this.el);
    ctx.fillStyle = css.getPropertyValue('--panel-2').trim() || '#f4f4f3';
    ctx.fillRect(0, 0, this.w, this.h);
    const o = E.doc.get<'plot'>(this.id), r = E.plot.report(this.id), d = E.plot.layout(this.id);
    if (!o || !r) return;
    const path = (ring: number[], close = true) => {
      ctx.beginPath();
      for (let i = 0; i < ring.length; i += 2) { const p = this.toS(ring[i], ring[i + 1]); if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]); }
      if (close) ctx.closePath();
    };
    const fill = (ring: number[], color: string, alpha = 1) => { if (ring.length < 6) return; path(ring); ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1; };
    const stroke = (ring: number[], color: string, width = 1, dash: number[] = [], close = true) => { if (ring.length < 4) return; path(ring, close); ctx.setLineDash(dash); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke(); ctx.setLineDash([]); };
    /** diagonal amber lines over a ring: the part of the project that departs from a rule */
    const hatch = (ring: number[], color = AMBER) => {
      if (ring.length < 6) return;
      let a = Infinity, b = Infinity, c = -Infinity, e = -Infinity;
      for (let i = 0; i < ring.length; i += 2) { const p = this.toS(ring[i], ring[i + 1]); a = Math.min(a, p[0]); c = Math.max(c, p[0]); b = Math.min(b, p[1]); e = Math.max(e, p[1]); }
      ctx.save(); path(ring); ctx.clip();
      ctx.globalAlpha = 0.18; ctx.fillStyle = color; ctx.fill(); ctx.globalAlpha = 1;
      ctx.beginPath();
      for (let x = a - (e - b); x < c; x += 6) { ctx.moveTo(x, e); ctx.lineTo(x + (e - b), b); }
      ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.stroke();
      ctx.restore();
    };

    // what's around: roads, buildings
    const [x0, z0] = this.toW(0, 0), [x1, z1] = this.toW(this.w, this.h);
    for (const id of E.hit.query(x0, z0, x1, z1)) {
      const s = E.doc.get(id);
      if (s?.kind === 'section' && !s.tunnel) {
        const g = E.C.geo(id);
        if (!g) continue;
        // (at the plot's what-if widths, when it has them)
        const e = o.roadEdits?.[id], k0 = e?.width !== undefined ? e.width / (g.t.hwL + g.t.hwR || 1) : 1, reserve = e?.reserve ?? s.reserve;
        const L: number[] = [], R: number[] = [];
        for (let k = 0; k < g.pts.length; k += 2) { L.push(g.pts[k] + g.nrm[k] * g.t.hwL * k0, g.pts[k + 1] + g.nrm[k + 1] * g.t.hwL * k0); R.unshift(g.pts[k] - g.nrm[k] * g.t.hwR * k0, g.pts[k + 1] - g.nrm[k + 1] * g.t.hwR * k0); }
        fill([...L, ...R], e ? ACCENT : '#8b8f98', e ? 0.3 : s.elevated ? 0.35 : 0.55);
        if (reserve) {
          // the DP width, dashed either side
          const hw = reserve / 2, A: number[] = [], B: number[] = [];
          for (let k = 0; k < g.pts.length; k += 2) { A.push(g.pts[k] + g.nrm[k] * hw, g.pts[k + 1] + g.nrm[k + 1] * hw); B.push(g.pts[k] - g.nrm[k] * hw, g.pts[k + 1] - g.nrm[k + 1] * hw); }
          stroke(A, RED, 1, [4, 4], false); stroke(B, RED, 1, [4, 4], false);
        }
      } else if (s?.kind === 'building') fill(s.outer, '#c9c5bb', 0.7);
    }

    // the plot, the DP strip, the envelope at the tallest building's height
    fill(o.ring, '#ffffff', 0.85);
    stroke(o.ring, ACCENT, 1.5, [6, 4]);
    for (const L of r.lostRings) { fill(L, RED, 0.18); stroke(L, RED, 1); }
    const env = d?.envelope.length ? d.envelope : r.footprint;
    if (env.length >= 6) { fill(env, ACCENT, 0.05); stroke(env, ACCENT, 1, [3, 3]); }

    // the buildings, or the parking level picked
    const level = d && studioLevel.value >= 0 ? d.parking.levels[studioLevel.value] : null;
    if (level) {
      for (const b of d!.buildings) for (const q of b.quads) stroke(q, '#8a8f99', 1, [2, 2]);
      for (const bay of level.bays) { fill(bay, ACCENT, 0.16); stroke(bay, ACCENT, 0.6); }
      if (level.ramp) { fill(level.ramp, '#f5a524', 0.7); stroke(level.ramp, '#b86e00', 1); }
      for (const c of level.columns ?? []) fill(c, INK, 0.9);
      for (const st of level.stairs ?? []) { fill(st, '#e5484d', 0.25); stroke(st, '#e5484d', 1.2); }
    } else if (d) {
      // the ground as solved: each layer once (they never overlap), then the bays, the planting, what was drawn
      const G = d.ground, M = G.map;
      const fillMP = (m: MP, color: string, alpha = 1) => {
        if (!m.length) return;
        ctx.beginPath();
        for (const p of m) for (const r of p) for (let i = 0; i < r.length; i++) { const q = this.toS(r[i][0], r[i][1]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); }
        ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.fill('evenodd'); ctx.globalAlpha = 1;
      };
      fillMP(M.green, '#b5d39a'); fillMP(M.lawn, '#97c771'); fillMP(M.bed, '#6c9a4c'); fillMP(M.path, '#e7d8b4'); fillMP(M.apron, '#e4dfd4');
      fillMP(M.fire, '#d6cfc2'); fillMP(M.lot, '#9aa0aa'); fillMP(M.road, '#6b707b'); fillMP(M.island, '#97c771'); fillMP(M.lotIsland, '#97c771');
      for (const line of [...G.drive, ...G.roads.map((x) => x.pts)]) stroke(line, '#ffffff', 1, [6, 6], false);
      for (const e of d.site.elements ?? []) if (e.kind === 'parking') { const q = ringOf(e); fill(q, '#a7adb8', 0.95); stroke(q, INK, 1.2); }
      // bays: their sides in white, the back darker
      ctx.lineWidth = Math.max(0.5, 0.12 * this.k);
      for (const bay of d.parking.levels.filter((l) => l.kind === 'surface' || l.kind === 'lot').flatMap((l) => l.bays)) {
        ctx.beginPath();
        const A = this.toS(bay[0], bay[1]), B = this.toS(bay[2], bay[3]), C = this.toS(bay[4], bay[5]), D = this.toS(bay[6], bay[7]);
        ctx.moveTo(D[0], D[1]); ctx.lineTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.lineTo(C[0], C[1]);
        ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.stroke();
      }
      // the drawn outlines of the lots and gardens (what the layers above leave of them is what shows)
      for (const e of d.site.elements ?? []) if (e.kind === 'lot' || e.kind === 'garden') stroke(ringOf(e), e.kind === 'lot' ? '#5d636e' : '#3f7a2c', 1, [4, 3]);
      // planting and benches
      if (this.k > 0.8) {
        for (const t of M.plants) {
          const p = this.toS(t.x, t.z), rr = Math.max(1.2, t.r * this.k);
          ctx.beginPath(); ctx.arc(p[0], p[1], rr, 0, Math.PI * 2);
          ctx.fillStyle = t.kind === 4 ? 'rgba(74,125,51,0.85)' : t.kind === 2 ? 'rgba(122,162,76,0.75)' : t.kind === 3 ? 'rgba(47,90,37,0.8)' : 'rgba(79,127,52,0.55)';
          ctx.fill();
          if (t.kind !== 4 && rr > 3) { ctx.strokeStyle = 'rgba(47,80,32,0.6)'; ctx.lineWidth = 0.8; ctx.stroke(); }
        }
        if (this.k > 2.5) for (const [x, z, a] of M.benches) {
          const p = this.toS(x, z);
          ctx.save(); ctx.translate(p[0], p[1]); ctx.rotate(a + Math.PI / 2); ctx.fillStyle = '#7a5a3c'; ctx.fillRect(-0.8 * this.k, -0.22 * this.k, 1.6 * this.k, 0.45 * this.k); ctx.restore();
        }
      }
      for (const w of G.wall) stroke(w, INK, 2.2, [], false);
      for (const g of G.gates) {
        for (const [x, z] of [[g[0], g[1]], [g[2], g[3]]]) { const p = this.toS(x, z); ctx.fillStyle = INK; ctx.fillRect(p[0] - 3, p[1] - 3, 6, 6); }
        stroke(g, '#e08a00', 1.5, [3, 2], false);
      }
      // the hand-placed play areas and water tanks
      for (const e of d.site.elements ?? []) {
        if (e.kind === 'play') { const q = ringOf(e); fill(q, '#e9cf9b', 0.9); stroke(q, '#b08a4a', 1.2, [3, 2]); }
        if (e.kind === 'tank') for (const q of elementRings(e)) { fill(q, '#7fa7c9', 0.95); stroke(q, '#3b6a90', 1.4); }
        if (e.kind === 'trees') stroke(ringOf(e), '#3f7a2c', 1, [2, 3]);
      }
      // the fire tender's way round the tall buildings, only where it's blocked (a departure: amber)
      for (const b of d.buildings) if (!b.fireOk) for (const q of b.fire) stroke(q, AMBER, 1.6, [2, 3]);
      for (const b of d.buildings) {
        for (const q of b.quads) fill(q, '#ffffff');
        for (const u of b.units) { fill(u.ring, UNIT_COLOR[u.t], 0.85); if (this.k > 2.2) stroke(u.ring, '#ffffff', 0.8); }
        for (const c of b.corridors) fill(c, '#d9dce3');
        for (const c of b.cores) fill(c, '#6b7280');
        // past the margins: only the part outside the envelope at its height, hatched; into another building: red
        if (b.clash === 'margins' && r.net.length >= 6) {
          const env = inset(r.net, r.edges, r.rules.front, sideMargin(r.rules, b.height));
          const past = env.length >= 6 ? diff(union(...b.quads.map(fromFlat)), fromFlat(env)) : union(...b.quads.map(fromFlat));
          for (const p of past) hatch(flat(p[0]));
        }
        for (const q of b.quads) stroke(q, b.clash === 'overlap' ? RED : b.overHeight || b.clash ? AMBER : INK, b.clash === 'overlap' ? 2.2 : b.overHeight || b.clash ? 1.8 : 1.2);
      }
    }
    // the plot's roads, named with their widths where they pass it
    {
      const [pcx, pcz] = spineCentre(o.ring);
      ctx.font = '600 11px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const rd of r.roads) {
        const g = E.C.geo(rd.id);
        if (!g) continue;
        let bx = 0, bz = 0, bd = Infinity;
        for (let k = 0; k < g.pts.length; k += 2) { const dd = Math.hypot(g.pts[k] - pcx, g.pts[k + 1] - pcz); if (dd < bd) { bd = dd; bx = g.pts[k]; bz = g.pts[k + 1]; } }
        const p = this.toS(bx, bz);
        const t = `${rd.entry && r.roads.length > 1 ? 'Entry · ' : ''}${rd.name} · ${+rd.today.toFixed(1)} m${rd.dp ? ` · DP ${rd.dp} m` : ''}`;
        const tw = ctx.measureText(t).width + 14;
        ctx.fillStyle = rd.edited ? ACCENT : 'rgba(255,255,255,0.92)';
        ctx.beginPath(); ctx.roundRect(p[0] - tw / 2, p[1] - 10, tw, 20, 10); ctx.fill();
        ctx.fillStyle = rd.edited ? '#fff' : INK; ctx.fillText(t, p[0], p[1] + 0.5);
      }
    }

    // labels: floors and flats; the car parks' levels and bays
    if (d) {
      ctx.font = '600 11px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const lotLv = d.parking.levels.filter((l) => l.kind === 'lot'), lotEls = (d.site.elements ?? []).filter((e) => e.kind === 'lot' && elementRings(e).length);
      if (!level) for (const e of d.site.elements ?? []) {
        if (e.kind !== 'parking' && e.kind !== 'lot') continue;
        const [cx, cz] = elementCentre(e), p = this.toS(cx, cz);
        const lv = d.parking.levels.find((l) => l.kind === 'structure');
        const t = e.kind === 'parking' ? `P · ${e.levels ?? 3} levels · ${(lv?.bays.length ?? 0) * (e.levels ?? 3)} bays` : `Lot · ${lotLv[lotEls.indexOf(e)]?.bays.length ?? 0} bays`;
        const tw = ctx.measureText(t).width + 12;
        ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.beginPath(); ctx.roundRect(p[0] - tw / 2, p[1] - 10, tw, 20, 10); ctx.fill();
        ctx.fillStyle = INK; ctx.fillText(t, p[0], p[1] + 0.5);
      }
      // the buildings' labels: floors and what's in them; collapsed to the floors where they'd overlap (in full under
      // the cursor); an amber dot on one that departs from a rule
      const hov = this.cursor && studioTool.value === 'select' && !this.drag ? this.pick(this.cursor) : null;
      const full = (b: BuildingReport) => {
        const flats = b.perFloor[0] + b.perFloor[1] + b.perFloor[2] + b.perFloor[3];
        const what = b.use === 'none' ? `${Math.round(b.plate * b.floors).toLocaleString('en-IN')} m²`
          : !b.cores.length && b.use === 'industrial' ? `${Math.round(b.plate * b.floors).toLocaleString('en-IN')} m² shed`
          : b.use === 'residential' ? `${flats * b.floors} flats` : `${Math.round(b.plate * b.floors).toLocaleString('en-IN')} m²`;
        return `${b.floors} fl · ${what}`;
      };
      const labs = d.buildings.map((b) => {
        const [cx, cz] = spineCentre(b.b.spine), p = this.toS(cx, cz), t = full(b);
        return { b, p, t, w: ctx.measureText(t).width + 12, short: false };
      });
      for (const a of labs) for (const c of labs) if (a !== c && Math.abs(a.p[0] - c.p[0]) < (a.w + c.w) / 2 + 2 && Math.abs(a.p[1] - c.p[1]) < 22) a.short = true;
      const flagged = new Set(d.departures.flatMap((x) => x.ids));
      for (const L of [...labs.filter((x) => x.b.b.id !== hov), ...labs.filter((x) => x.b.b.id === hov)]) {
        const t = L.short && L.b.b.id !== hov ? `${L.b.floors} fl` : L.t, tw = ctx.measureText(t).width + 12, p = L.p;
        ctx.fillStyle = L.b.clash === 'overlap' ? RED : 'rgba(28,35,51,0.86)';
        ctx.beginPath(); ctx.roundRect(p[0] - tw / 2, p[1] - 10, tw, 20, 10); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillText(t, p[0], p[1] + 0.5);
        if (flagged.has(L.b.b.id)) { ctx.beginPath(); ctx.arc(p[0] + tw / 2 - 1, p[1] - 8, 3.5, 0, Math.PI * 2); ctx.fillStyle = '#f5a524'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); }
      }
    }

    // the selected building: spine, nodes, handles
    const sel = this.building(studioSel.value);
    if (sel && !level && 'kind' in sel && isArea(sel)) {
      const R = ringOf(sel);
      fill(R, ACCENT, 0.06); stroke(R, ACCENT, 2.5);
      for (let i = 0; i < R.length; i += 2) {
        const j = (i + 2) % R.length, m = this.toS((R[i] + R[j]) / 2, (R[i + 1] + R[j + 1]) / 2);
        if (Math.hypot(R[j] - R[i], R[j + 1] - R[i + 1]) * this.k < 26) continue;
        ctx.beginPath(); ctx.arc(m[0], m[1], 3.5, 0, Math.PI * 2); ctx.fillStyle = ACCENT; ctx.globalAlpha = 0.55; ctx.fill(); ctx.globalAlpha = 1;
      }
      for (let i = 0; i < R.length; i += 2) {
        const p = this.toS(R[i], R[i + 1]), on = this.node === i / 2;
        ctx.fillStyle = on ? ACCENT : '#fff'; ctx.fillRect(p[0] - 5, p[1] - 5, 10, 10);
        ctx.strokeStyle = ACCENT; ctx.lineWidth = 2; ctx.strokeRect(p[0] - 5, p[1] - 5, 10, 10);
      }
      // each side's length
      if (this.k > 1.2) {
        ctx.font = '600 10px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (let i = 0; i < R.length; i += 2) {
          const j = (i + 2) % R.length, L = Math.hypot(R[j] - R[i], R[j + 1] - R[i + 1]);
          if (L * this.k < 40) continue;
          const m = this.toS((R[i] + R[j]) / 2, (R[i + 1] + R[j + 1]) / 2);
          ctx.fillStyle = ACCENT; ctx.fillText(`${L.toFixed(1)} m`, m[0], m[1] - 11);
        }
      }
      const h = this.handles(sel);
      ctx.beginPath(); ctx.arc(h.turn[0], h.turn[1], 7, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = ACCENT; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(h.turn[0], h.turn[1], 3, -0.4, Math.PI * 1.3); ctx.lineWidth = 1.5; ctx.stroke();
    } else if (sel && !level) {
      stroke(sel.spine, ACCENT, 1.5, [5, 3], !!sel.closed);
      for (const q of 'kind' in sel ? elementRings(sel) : buildingQuads(sel)) stroke(q, ACCENT, 2.5);
      for (let i = 0; i < sel.spine.length; i += 2) {
        const p = this.toS(sel.spine[i], sel.spine[i + 1]);
        ctx.beginPath(); ctx.arc(p[0], p[1], this.node === i / 2 ? 6.5 : 5, 0, Math.PI * 2);
        ctx.fillStyle = this.node === i / 2 ? ACCENT : '#fff'; ctx.fill();
        ctx.strokeStyle = ACCENT; ctx.lineWidth = 2; ctx.stroke();
      }
      const h = this.handles(sel);
      ctx.beginPath(); ctx.arc(h.turn[0], h.turn[1], 7, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = ACCENT; ctx.lineWidth = 2; ctx.stroke();
      ctx.beginPath(); ctx.arc(h.turn[0], h.turn[1], 3, -0.4, Math.PI * 1.3); ctx.lineWidth = 1.5; ctx.stroke();
      if (h.depth) { ctx.fillStyle = '#fff'; ctx.fillRect(h.depth[0] - 5, h.depth[1] - 5, 10, 10); ctx.strokeRect(h.depth[0] - 5, h.depth[1] - 5, 10, 10); }
      for (const c of h.corners) { ctx.beginPath(); ctx.arc(c[0], c[1], 4.5, 0, Math.PI * 2); ctx.fillStyle = ACCENT; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); }
      if (h.floors) {
        // the floors pill: drag it up or down
        const [fx, fy] = h.floors, fl = d?.buildings.find((x) => x.b.id === sel.id);
        // (the height too while it's dragged)
        const t = `${fl?.floors ?? sel.floors} fl${this.drag?.kind === 'floors' && fl ? ` · ${Math.round(fl.height * 10) / 10} m` : ''}`;
        ctx.font = '600 10px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        const tw = Math.max(30, ctx.measureText(t).width + 16);
        ctx.beginPath(); ctx.roundRect(fx - tw / 2 + 8, fy - 9, tw, 18, 9); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = fl?.overHeight ? AMBER : ACCENT; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.fillStyle = INK; ctx.fillText(t, fx + 8 + 4, fy + 0.5);
        ctx.beginPath(); ctx.moveTo(fx - tw / 2 + 13, fy - 2); ctx.lineTo(fx - tw / 2 + 16, fy - 6); ctx.lineTo(fx - tw / 2 + 19, fy - 2); ctx.moveTo(fx - tw / 2 + 13, fy + 2); ctx.lineTo(fx - tw / 2 + 16, fy + 6); ctx.lineTo(fx - tw / 2 + 19, fy + 2);
        ctx.strokeStyle = ACCENT; ctx.lineWidth = 1.2; ctx.stroke();
      }
    }

    // the spine being drawn, with its depth
    if (this.drawing() && (this.draft.length || this.cursor)) {
      const last: [number, number] | null = this.draft.length ? [this.draft[this.draft.length - 2], this.draft[this.draft.length - 1]] : null;
      let c = this.cursor ? this.snap(this.cursor, last, false) : null;
      if (c && this.cursor && studioTool.value === 'road') c = this.roadSnap(this.cursor, c, false);
      const pts = c ? [...this.draft, c[0], c[1]] : this.draft;
      const dd = studioTool.value === 'road' ? 7 : studioTool.value === 'wall' ? 0.23 : 16;
      if (pts.length >= 4) for (const q of buildingQuads({ id: 'draft', spine: pts, depth: dd, floors: 0 })) { fill(q, studioTool.value === 'draw' ? ACCENT : '#6b707b', 0.2); stroke(q, ACCENT, 1); }
      stroke(pts, ACCENT, 2, [5, 3], false);
      for (let i = 0; i < pts.length; i += 2) { const p = this.toS(pts[i], pts[i + 1]); ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = ACCENT; ctx.stroke(); }
      if (c && last) {
        const p = this.toS(c[0], c[1]);
        const t = `${Math.hypot(c[0] - last[0], c[1] - last[1]).toFixed(1)} m`;
        ctx.font = '600 11px Inter, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = INK; ctx.fillText(t, p[0] + 10, p[1] - 10);
      }
    }

    // where a road node snapped: a ring on a node, a tick on a line
    if (this.hitSnap && (this.drawing() || this.drag?.kind === 'node' || this.drag?.kind === 'move')) {
      const p = this.toS(...this.hitSnap.p);
      ctx.beginPath(); ctx.arc(p[0], p[1], this.hitSnap.on === 'node' ? 8 : 6, 0, Math.PI * 2);
      ctx.strokeStyle = '#e08a00'; ctx.lineWidth = 2; ctx.stroke();
      if (this.hitSnap.on === 'line') { ctx.beginPath(); ctx.moveTo(p[0] - 4, p[1] - 4); ctx.lineTo(p[0] + 4, p[1] + 4); ctx.moveTo(p[0] + 4, p[1] - 4); ctx.lineTo(p[0] - 4, p[1] + 4); ctx.stroke(); }
    }

    // the area being dragged or clicked out
    if (this.rect) { fill(this.rect, ACCENT, 0.15); stroke(this.rect, ACCENT, 2); }
    if (this.shape) {
      const P = this.shape.pts, c = this.cursor ? this.snapPt(this.snap(this.cursor, [P[P.length - 2], P[P.length - 1]], false), false) : null;
      const pts = c ? [...P, c[0], c[1]] : P;
      if (pts.length >= 6) fill(pts, ACCENT, 0.12);
      stroke(pts, ACCENT, 2, [5, 3], false);
      for (let i = 0; i < P.length; i += 2) { const p = this.toS(P[i], P[i + 1]); ctx.fillStyle = i ? '#fff' : ACCENT; ctx.fillRect(p[0] - 4, p[1] - 4, 8, 8); ctx.strokeStyle = ACCENT; ctx.strokeRect(p[0] - 4, p[1] - 4, 8, 8); }
    }

    // scale bar
    const m = [5, 10, 20, 50, 100].find((v) => v * this.k > 60) ?? 100;
    ctx.fillStyle = INK; ctx.fillRect(14, this.h - 18, m * this.k, 3);
    ctx.font = '11px Inter, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom'; ctx.fillText(`${m} m`, 14, this.h - 22);
  }
}

export function spineCentre(P: number[]): [number, number] {
  let x = 0, z = 0;
  for (let i = 0; i < P.length; i += 2) { x += P[i]; z += P[i + 1]; }
  return [x / (P.length / 2 || 1), z / (P.length / 2 || 1)];
}
