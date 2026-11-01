// Site Studio's plan: the plot and what's around it, the buildings with their flats, and direct editing. Click a
// building to select it; drag it to move it, drag a node to reshape it, drag the round handle to turn it, drag the
// square one on its face to change the depth; double-click its spine to add a node, Alt-click a node to drop it.
// The draw tool lays a new spine node by node (Enter or double-click finishes). Moves snap to the road's angles
// (every 45°) and to half metres; Shift moves freely.
import { effect } from '@preact/signals';
import type { Editor } from './editor';
import type { Id } from '../doc/types';
import { docVersion, readOnly, studioLevel, studioSel, studioTool, toast } from './state';
import { buildingQuads, newBuildingId, pointIn, UNIT_COLOR, type PlotSite, type SiteBuilding } from '../doc/site';

const ACCENT = '#2f5bff', RED = '#e5484d', INK = '#1c2333';

type Drag =
  | { kind: 'pan'; x: number; y: number }
  | { kind: 'move'; b: string; start: [number, number]; spine: number[]; n: number; moved: boolean }
  | { kind: 'node'; b: string; i: number; spine: number[]; n: number; moved: boolean }
  | { kind: 'turn'; b: string; c: [number, number]; a0: number; spine: number[]; n: number }
  | { kind: 'depth'; b: string; n: number };

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
  private dirty = true;
  private raf = 0;
  private off: (() => void)[] = [];

  constructor(readonly el: HTMLCanvasElement, readonly E: Editor, readonly id: Id) {
    this.ctx = el.getContext('2d')!;
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
    const loop = () => { if (this.dirty) { this.dirty = false; this.draw(); } this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
  }

  dispose() { cancelAnimationFrame(this.raf); for (const f of this.off) f(); }

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
  private at(e: MouseEvent): [number, number] { const r = this.el.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }

  // ---------------- the site ----------------

  private site(): PlotSite | null { return this.E.plot.site(this.id); }
  private commit(site: PlotSite, label: string, merge?: string) {
    if (readOnly.value) { toast('This map is read-only', 'warn'); return; }
    this.E.edit(label, () => this.E.doc.update(this.id, { site }), merge);
  }
  private setSpine(bid: string, spine: number[], label: string, merge?: string, patch?: Partial<SiteBuilding>) {
    const s = this.site();
    if (!s) return;
    this.commit({ ...s, buildings: s.buildings.map((b) => (b.id === bid ? { ...b, ...patch, spine } : b)) }, label, merge);
  }
  private building(bid: string | null) { return bid ? this.site()?.buildings.find((b) => b.id === bid) ?? null : null; }

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
    if (studioTool.value === 'draw') {
      const last: [number, number] | null = this.draft.length ? [this.draft[this.draft.length - 2], this.draft[this.draft.length - 1]] : null;
      const p = this.snap(w, last, e.shiftKey);
      this.draft.push(p[0], p[1]);
      this.dirty = true;
      return;
    }
    const sel = this.building(studioSel.value);
    // handles of the selected building first: turn, depth, nodes
    if (sel) {
      const h = this.handles(sel);
      if (Math.hypot(s[0] - h.turn[0], s[1] - h.turn[1]) < 9) {
        const c = spineCentre(sel.spine);
        this.drag = { kind: 'turn', b: sel.id, c, a0: Math.atan2(w[1] - c[1], w[0] - c[0]), spine: [...sel.spine], n: ++dragSeq };
        return;
      }
      if (h.depth && Math.hypot(s[0] - h.depth[0], s[1] - h.depth[1]) < 8) { this.drag = { kind: 'depth', b: sel.id, n: ++dragSeq }; return; }
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
    if (hit) { const b = this.building(hit)!; this.drag = { kind: 'move', b: hit, start: w, spine: [...b.spine], n: ++dragSeq, moved: false }; }
    else this.drag = { kind: 'pan', x: s[0], y: s[1] };
  }

  private move(e: PointerEvent) {
    const s = this.at(e), w = this.toW(...s);
    this.cursor = w;
    const d = this.drag;
    this.dirty = true;
    if (!d) { this.el.style.cursor = studioTool.value === 'draw' ? 'crosshair' : this.pick(w) ? 'move' : 'default'; return; }
    switch (d.kind) {
      case 'pan':
        this.cx -= (s[0] - d.x) / this.k; this.cz -= (s[1] - d.y) / this.k;
        d.x = s[0]; d.y = s[1];
        break;
      case 'move': {
        const dx = w[0] - d.start[0], dz = w[1] - d.start[1];
        if (!d.moved && Math.hypot(dx, dz) * this.k < 3) break;
        d.moved = true;
        // whole tenths of a metre, so the building keeps its shape exactly
        const mx = Math.round(dx * 10) / 10, mz = Math.round(dz * 10) / 10;
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
        const p = this.snap(w, ref, e.shiftKey);
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
        // twice the distance from the first wing's line, in half metres
        const ax = b.spine[0], az = b.spine[1], tx = b.spine[2] - ax, tz = b.spine[3] - az, L = Math.hypot(tx, tz) || 1;
        const off = Math.abs(((w[0] - ax) * -tz + (w[1] - az) * tx) / L);
        const depth = Math.max(6, Math.min(40, Math.round(off * 4) / 2));
        if (depth !== b.depth) this.setSpine(d.b, b.spine, 'Building depth', 'studio' + d.n, { depth });
        break;
      }
    }
  }

  private up(_e: PointerEvent) {
    this.drag = null;
    this.dirty = true;
  }

  private dbl(e: MouseEvent) {
    if (studioTool.value === 'draw') { this.finish(); return; }
    const s = this.at(e), w = this.toW(...s);
    const b = this.building(studioSel.value);
    if (!b) return;
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
        if (this.draft.length) { this.draft = []; this.dirty = true; return true; }
        if (studioTool.value === 'draw') { studioTool.value = 'select'; return true; }
        if (this.node !== null) { this.node = null; this.dirty = true; return true; }
        if (b) { studioSel.value = null; return true; }
        return false;
      case 'Enter': if (studioTool.value === 'draw') { this.finish(); return true; } return false;
      case 'Delete': case 'Backspace':
        if (studioTool.value === 'draw') { this.draft.splice(-2, 2); this.dirty = true; return true; }
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
    this.commit({ ...s, buildings: [...s.buildings, { id, spine: P, depth: 16, floors: 0 }] }, 'Add a building');
    studioSel.value = id;
    studioTool.value = 'select';
  }

  remove(bid: string) {
    const s = this.site();
    if (!s) return;
    this.commit({ ...s, buildings: s.buildings.filter((x) => x.id !== bid) }, 'Remove building');
    studioSel.value = null;
  }

  duplicate(b: SiteBuilding) {
    const s = this.site();
    if (!s) return;
    // a copy set back from the original by its depth and a gap
    const [ax, az] = this.axis(), off = b.depth + 6;
    const id = newBuildingId();
    this.commit({ ...s, buildings: [...s.buildings, { ...b, id, spine: b.spine.map((v, i) => Math.round((v + (i % 2 ? ax : -az) * off) * 100) / 100) }] }, 'Duplicate building');
    studioSel.value = id;
  }

  private dropNode(b: SiteBuilding, i: number) {
    const n = b.spine.length / 2;
    if (n <= (b.closed ? 3 : 2)) { toast('A building needs at least two nodes (three round a court)', 'warn'); return; }
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
    return null;
  }

  /** Screen positions of a building's turn handle (above it) and depth handle (on the first wing's face). */
  private handles(b: SiteBuilding) {
    const q = buildingQuads(b);
    let top = Infinity, cx = 0, n = 0;
    for (const r of q) for (let i = 0; i < r.length; i += 2) { const p = this.toS(r[i], r[i + 1]); top = Math.min(top, p[1]); cx += p[0]; n++; }
    const turn: [number, number] = [cx / (n || 1), top - 22];
    let depth: [number, number] | null = null;
    if (q.length) { const r = q[0]; depth = this.toS((r[0] + r[2]) / 2, (r[1] + r[3]) / 2); }
    return { turn, depth };
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

    // what's around: roads, buildings
    const [x0, z0] = this.toW(0, 0), [x1, z1] = this.toW(this.w, this.h);
    for (const id of E.hit.query(x0, z0, x1, z1)) {
      const s = E.doc.get(id);
      if (s?.kind === 'section' && !s.tunnel) {
        const g = E.C.geo(id);
        if (!g) continue;
        const L: number[] = [], R: number[] = [];
        for (let k = 0; k < g.pts.length; k += 2) { L.push(g.pts[k] + g.nrm[k] * g.t.hwL, g.pts[k + 1] + g.nrm[k + 1] * g.t.hwL); R.unshift(g.pts[k] - g.nrm[k] * g.t.hwR, g.pts[k + 1] - g.nrm[k + 1] * g.t.hwR); }
        fill([...L, ...R], '#8b8f98', s.elevated ? 0.35 : 0.55);
        if (s.reserve) {
          // the DP width, dashed either side
          const hw = s.reserve / 2, A: number[] = [], B: number[] = [];
          for (let k = 0; k < g.pts.length; k += 2) { A.push(g.pts[k] + g.nrm[k] * hw, g.pts[k + 1] + g.nrm[k + 1] * hw); B.push(g.pts[k] - g.nrm[k] * hw, g.pts[k + 1] - g.nrm[k + 1] * hw); }
          stroke(A, RED, 1, [4, 4], false); stroke(B, RED, 1, [4, 4], false);
        }
      } else if (s?.kind === 'building') fill(s.outer, '#c9c5bb', 0.7);
    }

    // the plot, the DP strip, the envelope at the tallest building's height
    fill(o.ring, '#ffffff', 0.85);
    stroke(o.ring, ACCENT, 1.5, [6, 4]);
    if (r.lostRing.length >= 6) { fill(r.lostRing, RED, 0.18); stroke(r.lostRing, RED, 1); }
    const env = d?.envelope.length ? d.envelope : r.footprint;
    if (env.length >= 6) { fill(env, ACCENT, 0.05); stroke(env, ACCENT, 1, [3, 3]); }

    // the buildings, or the parking level picked
    const level = d && studioLevel.value >= 0 ? d.parking.levels[studioLevel.value] : null;
    if (level) {
      for (const b of d!.buildings) for (const q of b.quads) stroke(q, '#8a8f99', 1, [2, 2]);
      for (const bay of level.bays) { fill(bay, ACCENT, 0.16); stroke(bay, ACCENT, 0.6); }
      if (level.ramp) fill(level.ramp, '#f5a524', 0.7);
    } else if (d) {
      // the open ground: surface bays, and the fire tender's way round the tall buildings (red where it's blocked)
      for (const bay of d.parking.levels.find((l) => l.kind === 'surface')?.bays ?? []) { fill(bay, '#8a8f99', 0.12); stroke(bay, '#8a8f99', 0.5); }
      for (const b of d.buildings) for (const q of b.fire) stroke(q, b.fireOk ? '#e08a00' : RED, b.fireOk ? 1 : 1.6, [2, 3]);
      for (const b of d.buildings) {
        for (const q of b.quads) fill(q, '#ffffff');
        for (const u of b.units) { fill(u.ring, UNIT_COLOR[u.t], 0.85); if (this.k > 2.2) stroke(u.ring, '#ffffff', 0.8); }
        for (const c of b.corridors) fill(c, '#d9dce3');
        for (const c of b.cores) fill(c, '#6b7280');
        for (const q of b.quads) stroke(q, b.clash ? RED : INK, b.clash ? 2.2 : 1.2);
      }
    }
    // labels: floors and flats
    if (d) {
      ctx.font = '600 11px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (const b of d.buildings) {
        const [cx, cz] = spineCentre(b.b.spine), p = this.toS(cx, cz);
        const flats = b.perFloor[0] + b.perFloor[1] + b.perFloor[2] + b.perFloor[3];
        const t = `${b.floors} fl · ${flats * b.floors} flats`;
        const tw = ctx.measureText(t).width + 12;
        ctx.fillStyle = b.clash ? RED : 'rgba(28,35,51,0.86)';
        ctx.beginPath(); ctx.roundRect(p[0] - tw / 2, p[1] - 10, tw, 20, 10); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.fillText(t, p[0], p[1] + 0.5);
      }
    }

    // the selected building: spine, nodes, handles
    const sel = this.building(studioSel.value);
    if (sel && !level) {
      stroke(sel.spine, ACCENT, 1.5, [5, 3], !!sel.closed);
      for (const q of buildingQuads(sel)) stroke(q, ACCENT, 2.5);
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
    }

    // the spine being drawn, with its depth
    if (studioTool.value === 'draw' && (this.draft.length || this.cursor)) {
      const last: [number, number] | null = this.draft.length ? [this.draft[this.draft.length - 2], this.draft[this.draft.length - 1]] : null;
      const c = this.cursor ? this.snap(this.cursor, last, false) : null;
      const pts = c ? [...this.draft, c[0], c[1]] : this.draft;
      if (pts.length >= 4) for (const q of buildingQuads({ id: 'draft', spine: pts, depth: 16, floors: 0 })) { fill(q, ACCENT, 0.15); stroke(q, ACCENT, 1); }
      stroke(pts, ACCENT, 2, [5, 3], false);
      for (let i = 0; i < pts.length; i += 2) { const p = this.toS(pts[i], pts[i + 1]); ctx.beginPath(); ctx.arc(p[0], p[1], 4, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = ACCENT; ctx.stroke(); }
      if (c && last) {
        const p = this.toS(c[0], c[1]);
        const t = `${Math.hypot(c[0] - last[0], c[1] - last[1]).toFixed(1)} m`;
        ctx.font = '600 11px Inter, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = INK; ctx.fillText(t, p[0] + 10, p[1] - 10);
      }
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
