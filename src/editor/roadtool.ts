// The road tool, Cities: Skylines style. Modes: Straight, Simple curve (one control point), Complex curve (two),
// Continuous (each stretch carries on along the last one as an arc), Freeform (the Bézier pen, in editor.ts) and
// Replace (CS's upgrade tool: click a road to give it the chosen class). A stretch is built as soon as its last
// point goes down — one undo step — and the tool carries on from its end; right-click steps back. PageUp /
// PageDown set the height it draws at; crossings at the same level become junctions, others pass over.
import type { Editor } from './editor';
import * as ops from '../doc/ops';
import type { Id } from '../doc/types';
import type { V2 } from '../net/model';
import { penClass, penLift, readOnly, settings, status, toast, type RoadMode } from './state';
import { template } from '../doc/xsection';

export interface Guide { o: V2; d: V2; label: string; ray?: boolean }
export interface SnapResult {
  p: V2;
  kind?: 'junction' | 'section' | 'guide' | 'cross' | 'angle';
  label?: string;
  /** guide lines the point sits on (drawn dashed) */ guides?: Guide[];
  junction?: Id; section?: Id;
  /** height of what it snapped to, or the tool's */ lift: number;
  /** over / under a road at another level (no connection) */ over?: boolean;
}
interface Start { pt: ops.PenPoint; lift: number; dir: V2 | null; roadDir: V2 | null }
export interface Preview { pieces: number[][]; pts: V2[]; len: number; R: number; crossings: ops.Crossing[]; lift0: number; lift1: number }

const norm = (x: number, z: number): V2 | null => { const l = Math.hypot(x, z); return l > 1e-6 ? [x / l, z / l] : null; };
const rot = (d: V2, deg: number): V2 => { const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [d[0] * c - d[1] * s, d[0] * s + d[1] * c]; };
const r1 = (v: number) => Math.round(v * 10) / 10;

export const MODE_LABEL: Record<RoadMode, string> = {
  straight: 'Straight', curve: 'Simple curve', complex: 'Complex curve', continuous: 'Continuous', freeform: 'Freeform', replace: 'Replace',
};
const MODE_HINT: Record<RoadMode, string> = {
  straight: 'Click to start, click to end — each click builds a stretch',
  curve: 'Click the start, then the bend, then the end',
  complex: 'Click the start, two bend points, then the end',
  continuous: 'Each stretch carries on smoothly from the last one',
  freeform: 'Click points, drag for curves · Enter to finish',
  replace: 'Click a road to give it the chosen class · Alt = one section',
};

export class RoadTool {
  start: Start | null = null;
  ctrl: V2[] = [];
  road: Id | null = null;
  cursor: SnapResult | null = null;
  preview: Preview | null = null;

  constructor(readonly E: Editor) {}

  get mode(): RoadMode { return settings.value.roadMode; }
  get active() { return !!this.start; }

  hint() {
    const lift = penLift.value;
    return `${MODE_LABEL[this.mode]}: ${MODE_HINT[this.mode]} · PgUp/PgDn height${lift ? ` (${lift} m)` : ''} · right-click steps back`;
  }

  // ---------------- snapping ----------------

  /** Point the tool would place at `w`: junctions, roads at this level, guide lines, angles, lengths. */
  snap(w: V2, ctrlKey: boolean, shift: boolean, from: V2 | null = this.lastPoint(), dir: V2 | null = this.lastDir()): SnapResult {
    const E = this.E, st = settings.value, lift = penLift.value;
    if (!st.snap || ctrlKey) return { p: w, lift };
    const px = 1 / E.view.scale;
    let over = false;
    if (st.snapGeometry) {
      const j = E.hit.nearestJunction(w[0], w[1], 12 * px);
      if (j) {
        const J = E.doc.get<'junction'>(j.id)!;
        return { p: [J.x, J.z], kind: 'junction', junction: j.id, lift: J.lift, label: J.lift > 0.25 ? `junction · ${r1(J.lift)} m up` : undefined };
      }
      const s = E.hit.nearestSection(w[0], w[1], 9 * px);
      if (s) {
        const sec = E.doc.get<'section'>(s.id)!;
        const P = ops.anchorsOf(E.doc, sec);
        const n = ops.nearestOnPath(P, s.p);
        const sl = P[n.k].lift + (P[n.k + 1].lift - P[n.k].lift) * n.t;
        if (Math.abs(sl - lift) < ops.SAME_LEVEL) return { p: n.p, kind: 'section', section: s.id, lift: sl };
        over = true;
      }
    }
    if (from && shift) {
      // Shift: plain 15° steps
      const dx = w[0] - from[0], dz = w[1] - from[1], L = this.roundLen(Math.hypot(dx, dz));
      const a = Math.round(Math.atan2(dz, dx) / (Math.PI / 12)) * (Math.PI / 12);
      return { p: [from[0] + Math.cos(a) * L, from[1] + Math.sin(a) * L], kind: 'angle', label: `${bearing([Math.cos(a), Math.sin(a)])}°`, lift, over };
    }
    const G: Guide[] = [];
    if (from && st.snapAngles) {
      const road = this.start && !this.ctrl.length ? this.start.roadDir : null;
      if (dir) for (const [a, l] of [[0, 'straight on'], [90, '90°'], [-90, '90°'], [45, '45°'], [-45, '45°']] as const) G.push({ o: from, d: rot(dir, a), label: l, ray: true });
      if (road) for (const [a, l] of [[90, '90° to the road'], [-90, '90° to the road'], [0, 'along the road'], [180, 'along the road']] as const) G.push({ o: from, d: rot(road, a), label: l, ray: true });
      if (!dir && !road) for (const [d, l] of [[[1, 0], 'east–west'], [[0, 1], 'north–south']] as [V2, string][]) G.push({ o: from, d, label: l });
    }
    if (st.snapGuides) G.push(...this.junctionGuides(w, 160 * px));
    // nearest guides within reach; two of them → their crossing point
    const hits = G.map((g) => {
      const t = (w[0] - g.o[0]) * g.d[0] + (w[1] - g.o[1]) * g.d[1];
      if (g.ray && t < 0) return null;
      const q: V2 = [g.o[0] + g.d[0] * t, g.o[1] + g.d[1] * t];
      const d = Math.hypot(w[0] - q[0], w[1] - q[1]);
      return d < 8 * px ? { g, t, q, d } : null;
    }).filter((h): h is NonNullable<typeof h> => !!h).sort((a, b) => a.d - b.d);
    for (let i = 0; i < hits.length; i++) for (let k = i + 1; k < hits.length; k++) {
      const a = hits[i].g, b = hits[k].g;
      const den = a.d[0] * b.d[1] - a.d[1] * b.d[0];
      if (Math.abs(den) < 0.05) continue;
      const t = ((b.o[0] - a.o[0]) * b.d[1] - (b.o[1] - a.o[1]) * b.d[0]) / den;
      const q: V2 = [a.o[0] + a.d[0] * t, a.o[1] + a.d[1] * t];
      if (Math.hypot(q[0] - w[0], q[1] - w[1]) < 12 * px) return { p: q, kind: 'cross', guides: [a, b], label: `${a.label} · ${b.label}`, lift, over };
    }
    if (hits.length) {
      const h = hits[0];
      let q = h.q;
      if (from && h.g.o === from) { const t = this.roundLen(h.t); q = [from[0] + h.g.d[0] * t, from[1] + h.g.d[1] * t]; }
      return { p: q, kind: 'guide', guides: [h.g], label: h.g.label, lift, over };
    }
    if (from && st.snapLength > 0) {
      const dx = w[0] - from[0], dz = w[1] - from[1], L = Math.hypot(dx, dz), R = this.roundLen(L);
      if (L > 0.01) return { p: [from[0] + (dx / L) * R, from[1] + (dz / L) * R], lift, over };
    }
    return { p: w, lift, over };
  }

  /** Round a (signed) distance to the length step, never down to nothing. */
  private roundLen(L: number) { const k = settings.value.snapLength; return k > 0 ? Math.sign(L || 1) * Math.max(k, Math.round(Math.abs(L) / k) * k) : L; }

  /** Lines carrying on from the ends of nearby roads (CS2's guide lines). */
  private junctionGuides(w: V2, r: number): Guide[] {
    const E = this.E, out: Guide[] = [];
    const ids = [...E.hit.query(w[0] - r, w[1] - r, w[0] + r, w[1] + r)].filter((id) => E.doc.get(id)?.kind === 'junction');
    const near = ids.map((id) => E.doc.get<'junction'>(id)!).filter((j) => Math.hypot(j.x - w[0], j.z - w[1]) < r)
      .sort((a, b) => Math.hypot(a.x - w[0], a.z - w[1]) - Math.hypot(b.x - w[0], b.z - w[1])).slice(0, 24);
    const startJ = this.start?.pt.junction;
    for (const j of near) {
      if (j.id === startJ) continue;
      for (const s of E.doc.sectionsAt(j.id)) {
        const d = this.armDir(j.id, s.id);
        if (d) out.push({ o: [j.x, j.z], d: [-d[0], -d[1]], label: `in line with ${s.name || 'the road'}`, ray: true });
      }
    }
    return out;
  }

  /** Direction a section leaves a junction in. */
  armDir(jid: Id, sid: Id): V2 | null {
    const s = this.E.doc.get<'section'>(sid);
    if (!s) return null;
    const P = ops.anchorsOf(this.E.doc, s);
    if (s.a === jid) return norm(P[0].ox, P[0].oz) ?? norm(P[1].x - P[0].x, P[1].z - P[0].z);
    const L = P[P.length - 1];
    return norm(L.ix, L.iz) ?? norm(P[P.length - 2].x - L.x, P[P.length - 2].z - L.z);
  }

  private tangentOn(sid: Id, p: V2): V2 | null {
    const s = this.E.doc.get<'section'>(sid);
    if (!s) return null;
    const P = ops.anchorsOf(this.E.doc, s);
    const n = ops.nearestOnPath(P, p);
    const c = ops.cubicsOf(P)[n.k], t = n.t, u = 1 - t;
    return norm(u * u * (c[2] - c[0]) + 2 * u * t * (c[4] - c[2]) + t * t * (c[6] - c[4]), u * u * (c[3] - c[1]) + 2 * u * t * (c[5] - c[3]) + t * t * (c[7] - c[5]));
  }

  private lastPoint(): V2 | null {
    if (this.ctrl.length) return this.ctrl[this.ctrl.length - 1];
    return this.start ? [this.start.pt.x, this.start.pt.z] : null;
  }
  private lastDir(): V2 | null {
    if (!this.start) return null;
    if (this.ctrl.length) { const a = this.ctrl.length > 1 ? this.ctrl[this.ctrl.length - 2] : [this.start.pt.x, this.start.pt.z]; const b = this.ctrl[this.ctrl.length - 1]; return norm(b[0] - a[0], b[1] - a[1]); }
    return this.start.dir;
  }

  // ---------------- building ----------------

  /** Cubic pieces from the start through the control points to `p`, for the current mode. */
  pieces(p: V2): { pieces: number[][]; R: number } {
    const S = this.start!;
    const s: V2 = [S.pt.x, S.pt.z], c = this.ctrl;
    switch (this.mode) {
      case 'curve': return { pieces: [c.length ? ops.quadPiece(s, c[0], p) : ops.line(s, p)], R: Infinity };
      case 'complex':
        if (c.length >= 2) return { pieces: [[s[0], s[1], c[0][0], c[0][1], c[1][0], c[1][1], p[0], p[1]]], R: Infinity };
        return { pieces: [c.length ? ops.quadPiece(s, c[0], p) : ops.line(s, p)], R: Infinity };
      case 'continuous': if (S.dir) { const a = ops.arcPieces(s, S.dir, p); return { pieces: a.pieces, R: a.R }; } return { pieces: [ops.line(s, p)], R: Infinity };
      default: return { pieces: [ops.line(s, p)], R: Infinity };
    }
  }

  private needCtrl() { return this.mode === 'curve' ? 1 : this.mode === 'complex' ? 2 : 0; }

  hover(w: V2, ctrlKey: boolean, shift: boolean) {
    this.cursor = this.snap(w, ctrlKey, shift);
    this.refresh();
  }

  /** Recompute the preview (after a move, a height change or a mode change). */
  refresh() {
    if (!this.cursor) return;
    if (this.cursor.kind !== 'junction' && this.cursor.kind !== 'section') this.cursor.lift = penLift.value;
    this.preview = this.start ? this.build(this.cursor.p, this.cursor.lift) : null;
    this.E.overlayDirty = true;
  }

  private build(p: V2, lift1: number): Preview {
    const { pieces, R } = this.pieces(p);
    const pts: V2[] = [];
    pieces.forEach((c, i) => { for (let k = i ? 1 : 0; k <= 16; k++) pts.push(ops.bezAt(c, k / 16)); });
    let len = 0;
    const acc = [0];
    for (let i = 1; i < pts.length; i++) { len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); acc.push(len); }
    const lift0 = this.start!.lift;
    const lifts = acc.map((a) => lift0 + ((lift1 - lift0) * a) / (len || 1));
    const skip = new Set<Id>();
    const crossings = len > 1 ? ops.crossingsOf(this.E.doc, pts, lifts, skip, (x0, z0, x1, z1) => this.E.hit.query(x0, z0, x1, z1))
      .filter((c) => c.s > 1.5 && c.s < len - 1.5) : [];
    return { pieces, pts, len, R, crossings, lift0, lift1 };
  }

  click(w: V2, ctrlKey: boolean, shift: boolean, alt: boolean) {
    if (readOnly.value) { toast('This map is read-only', 'warn'); return; }
    if (this.mode === 'replace') { this.replaceAt(w, alt); return; }
    const sp = this.snap(w, ctrlKey, shift);
    if (!this.start) {
      this.start = this.startAt(sp);
      this.ctrl = [];
      status.value = this.hint();
      this.cursor = sp; this.refresh();
      return;
    }
    if (this.ctrl.length < this.needCtrl()) { this.ctrl.push(sp.p); this.cursor = sp; this.refresh(); return; }
    this.commit(sp);
  }

  private startAt(sp: SnapResult): Start {
    const pt: ops.PenPoint = { x: sp.p[0], z: sp.p[1], junction: sp.junction, section: sp.section, lift: sp.lift };
    let dir: V2 | null = null, roadDir: V2 | null = null;
    if (sp.junction) {
      const arms = this.E.doc.sectionsAt(sp.junction);
      const d = arms.length ? this.armDir(sp.junction, arms[0].id) : null;
      if (arms.length === 1 && d) dir = [-d[0], -d[1]]; // carry on from a dead end
      else if (d) roadDir = d;
    } else if (sp.section) roadDir = this.tangentOn(sp.section, sp.p);
    return { pt, lift: sp.lift, dir, roadDir };
  }

  private commit(sp: SnapResult) {
    const E = this.E, S = this.start!;
    const { pieces } = this.pieces(sp.p);
    const end: ops.PenPoint = { x: sp.p[0], z: sp.p[1], junction: sp.junction, section: sp.section, lift: sp.lift };
    if (Math.hypot(end.x - S.pt.x, end.z - S.pt.z) < 1) return;
    const res = E.edit('Draw road', () => {
      const r = ops.drawStretch(E.doc, S.pt, end, pieces, penClass.value, { road: this.road ?? undefined });
      const c = r.section ? ops.autoConnect(E.doc, [r.section]) : { joined: 0, bridged: 0 };
      return { ...r, ...c };
    });
    if (!res) return;
    const last = pieces[pieces.length - 1];
    const tan = norm(last[6] - last[4], last[7] - last[5]) ?? norm(last[6] - last[0], last[7] - last[1]);
    const L = this.preview?.len ?? 0;
    const bits = [`Built ${L.toFixed(0)} m`];
    if (res.joined) bits.push(`${res.joined} new junction${res.joined > 1 ? 's' : ''}`);
    if (res.bridged) bits.push(`passes over ${res.bridged} road${res.bridged > 1 ? 's' : ''}`);
    const J = E.doc.get<'junction'>(res.b);
    if (sp.junction || sp.section || !J) {
      // joined the network: this road is done
      this.start = null; this.road = null;
      status.value = `${bits.join(' · ')} · connected — click to start another road`;
    } else {
      this.road = res.road;
      this.start = { pt: { x: J.x, z: J.z, junction: J.id, lift: J.lift }, lift: J.lift, dir: tan, roadDir: null };
      status.value = `${bits.join(' · ')} · keep clicking to carry on, right-click to stop`;
    }
    this.ctrl = [];
    this.cursor = sp; this.refresh();
  }

  /** Right-click: drop the last control point, or stop the road being drawn. */
  back(): boolean {
    if (this.ctrl.length) { this.ctrl.pop(); this.refresh(); return true; }
    if (this.start) { this.start = null; this.road = null; this.preview = null; status.value = this.hint(); this.E.overlayDirty = true; return true; }
    return false;
  }

  cancel() { this.start = null; this.road = null; this.ctrl = []; this.preview = null; this.E.overlayDirty = true; }

  /** Replace mode: the clicked road (Alt: section) gets the chosen class and its standard cross-section. */
  private replaceAt(w: V2, alt: boolean) {
    const E = this.E, p = E.pickAt(w[0], w[1]);
    if (p?.kind !== 'section') return;
    const sec = E.doc.get<'section'>(p.id)!, cls = penClass.value;
    E.edit('Replace road', () => {
      const target = alt ? sec.id : sec.road;
      E.doc.set(target, 'cls', cls);
      E.doc.set(target, 'parts', template(cls));
      if (!alt) for (const s of E.doc.sectionsOf(sec.road)) { if (E.doc.editState(s.id, 'parts') === 'own') E.doc.reset(s.id, 'parts'); if (E.doc.editState(s.id, 'cls') === 'own') E.doc.reset(s.id, 'cls'); }
    });
    toast(`${alt ? 'Section' : 'Road'} is now ${cls}`, 'ok');
  }
}

/** Compass bearing in degrees (0 = north, x east, z south). */
export function bearing(d: V2): number { return Math.round(((Math.atan2(d[0], -d[1]) * 180) / Math.PI + 360) % 360); }
