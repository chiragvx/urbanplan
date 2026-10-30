// Road tools (Network Multitool style): add / remove / merge / split junctions, intersect, lock, invert, arrange on a
// line or circle, even slope, loops, curve–straight–curve connections, parallel roads, smooth end-to-end curves.
// Each mode is a small state machine: pick things on the map, adjust with keys (= / − radius or offset, Z variant /
// side, Shift ×10, Alt ×0.1), Enter applies, Esc steps back. The preview and a message follow the cursor.
import type { Editor } from './editor';
import { mtTick, penClass, saveSettings, select, settings, status, toast } from './state';
import { penStreet } from './roadtool';
import * as ops from '../doc/ops';
import { arcPts, cscPaths, fitCircle, minRadius, offsetPolyline, polyLength, scsLoops, type V2 } from '../doc/netgeom';
import type { Id, SectionObj } from '../doc/types';
import { totalWidth } from '../doc/xsection';

export type MtMode = 'addNode' | 'removeNode' | 'union' | 'splitNode' | 'intersect' | 'lock' | 'invert' | 'line' | 'circle' | 'slope' | 'loop' | 'connect' | 'parallel' | 'curve' | 'flyover';

export const MT_MODES: { m: MtMode; label: string; key: string; hint: string }[] = [
  { m: 'addNode', label: 'Add junction', key: '1', hint: 'Click a road to add a junction · Alt: whole metres from the start' },
  { m: 'removeNode', label: 'Remove junction', key: '2', hint: 'Click a junction between two roads to remove it (the roads join)' },
  { m: 'union', label: 'Merge junctions', key: '3', hint: 'Click a junction, then the one to merge it into' },
  { m: 'splitNode', label: 'Split junction', key: '4', hint: 'Click a junction, pick the arms to move, then click where the new junction goes (Shift: keep its height)' },
  { m: 'intersect', label: 'Intersect', key: '5', hint: 'Click two roads that cross to join them with a junction' },
  { m: 'lock', label: 'Lock', key: '6', hint: 'Click a road section to lock / unlock it (Shift: the whole road)' },
  { m: 'invert', label: 'Invert', key: '7', hint: 'Click a road section to reverse its direction (Shift: the whole road)' },
  { m: 'line', label: 'Arrange on line', key: '8', hint: 'Click junctions in order along a road · Z: line along the first section · Enter applies' },
  { m: 'circle', label: 'Arrange on circle', key: '9', hint: 'Click junctions in order (the first again closes it) · drag the centre / ring · E even · B between intersections · I intersections even · R reset · Enter' },
  { m: 'slope', label: 'Even slope', key: '0', hint: 'Click junctions in order along a road · Enter sets one gradient from the first to the last' },
  { m: 'loop', label: 'Loop', key: 'Shift+1', hint: 'Click where it leaves a road, then where it joins another · = / − radius · Z next shape · Enter' },
  { m: 'connect', label: 'Connection', key: 'Shift+2', hint: 'Click where it leaves a road, then where it joins another · = / − both radii · [ ] the second · Z next shape · Enter' },
  { m: 'parallel', label: 'Parallel', key: 'Shift+3', hint: 'Click a road (Shift: one section) · = / − offset · Z other side · PgUp / PgDn height · Enter' },
  { m: 'curve', label: 'Curve between ends', key: 'Shift+4', hint: 'Click near the end of one road, then near the end of another · = / − roundness · Enter' },
  { m: 'flyover', label: 'Flyover in the median', key: 'Shift+5', hint: 'Click where the flyover starts on a road, then where it ends on the same road · Z lanes · = / − deck height · Enter' },
];

interface Pick { section: Id; p: V2; h: V2 }
interface Msg { text: string; bad?: boolean }

const r1 = (v: number) => Math.round(v * 10) / 10;
const unitv = (v: V2): V2 => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };

export class MultiTool {
  cursor: V2 | null = null;
  msg: Msg | null = null;
  /** chain / picked junctions, picked sections, picked points on roads */
  nodes: Id[] = [];
  secs: Id[] = [];
  picks: Pick[] = [];
  splitArms: Id[] = [];
  closed = false;
  /** preview: polylines to draw (bad = can't apply) */
  preview: { pts: V2[]; bad?: boolean; dashed?: boolean }[] = [];
  marks: { p: V2; text?: string; kind: 'node' | 'point' | 'handle' }[] = [];
  /** parameters */
  R = 20; R2 = 20; linked = true; variant = 0; side = 1; offset = 0; lift = 0; tension = 0.45; lineFromSection = false;
  /** flyover: lanes ('2' | '4' | '2o') and deck height */
  flyLanes: '2' | '4' | '2o' = '2'; deck = ops.FLYOVER_DECK;
  /** circle arrange */
  circle: { c: V2; R: number } | null = null;
  dist: 'keep' | 'even' | 'between' | 'inter' = 'keep';
  nodeAng = new Map<Id, number>();
  private drag: 'centre' | 'ring' | { node: Id } | null = null;

  constructor(private E: Editor) {}

  private dirty() { this.E.overlayDirty = true; mtTick.value++; }

  get mode(): MtMode { return (settings.value.mtMode ?? 'addNode') as MtMode; }
  setMode(m: MtMode) { saveSettings({ mtMode: m }); this.reset(); status.value = this.hint(); }
  hint() { return MT_MODES.find((x) => x.m === this.mode)?.hint ?? ''; }

  reset() {
    this.nodes = []; this.secs = []; this.picks = []; this.splitArms = []; this.closed = false;
    this.preview = []; this.marks = []; this.msg = null; this.circle = null; this.nodeAng.clear(); this.dist = 'keep'; this.variant = 0; this.offset = 0; this.lift = 0;
    this.dirty();
  }

  // ---------------- picking helpers ----------------

  private junctionAt(w: V2): Id | null {
    const p = this.E.pickAt(w[0], w[1]);
    if (p?.kind === 'junction') return p.id;
    return this.E.hit.nearestJunction(w[0], w[1], 10 / this.E.ppm + 2)?.id ?? null;
  }

  private sectionAt(w: V2): { id: Id; p: V2 } | null {
    const p = this.E.pickAt(w[0], w[1]);
    if (p?.kind === 'section') return { id: p.id, p: (p.p ?? w) as V2 };
    // over a junction: the nearest road centre line close by
    const n = this.E.hit.nearestSection(w[0], w[1], 12 / this.E.ppm + 1);
    if (n && this.E.canPick('section', undefined, n.id)) return { id: n.id, p: n.p };
    return null;
  }

  /** Point and a→b tangent on a section nearest to q. */
  private onSection(id: Id, q: V2): { p: V2; h: V2; s: number; len: number } {
    const s = this.E.doc.get<'section'>(id)!;
    const P = ops.anchorsOf(this.E.doc, s);
    const n = ops.nearestOnPath(P, q);
    const C = ops.cubicsOf(P)[n.k];
    const a = ops.bezAt(C, Math.max(0, n.t - 0.01)), b = ops.bezAt(C, Math.min(1, n.t + 0.01));
    return { p: n.p as V2, h: unitv([b[0] - a[0], b[1] - a[1]]), s: n.s, len: n.len };
  }

  /** What new roads are built as: the road tool's current type (class, or the catalogue street picked for it). */
  private street() { const st = penStreet(); return { cls: penClass.value, parts: st?.parts, asset: st?.id }; }

  private step(e: { shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean }, base: number) { return base * (e.shiftKey ? 10 : e.altKey || e.ctrlKey ? 0.1 : 1); }

  // ---------------- input ----------------

  /** Pointer down: starts a handle drag (circle centre / ring / node) — returns true when it did. */
  down(w: V2): boolean {
    if (this.mode !== 'circle' || !this.circle) return false;
    const c = this.circle, tol = 10 / this.E.ppm;
    if (Math.hypot(w[0] - c.c[0], w[1] - c.c[1]) < tol * 1.5) { this.drag = 'centre'; return true; }
    for (const id of this.nodes) {
      const a = this.nodeAng.get(id);
      if (a === undefined) continue;
      const q: V2 = [c.c[0] + Math.cos(a) * c.R, c.c[1] + Math.sin(a) * c.R];
      if (Math.hypot(w[0] - q[0], w[1] - q[1]) < tol) { this.drag = { node: id }; return true; }
    }
    if (Math.abs(Math.hypot(w[0] - c.c[0], w[1] - c.c[1]) - c.R) < tol) { this.drag = 'ring'; return true; }
    return false;
  }

  dragTo(w: V2) {
    const c = this.circle;
    if (!c || !this.drag) return;
    if (this.drag === 'centre') c.c = w;
    else if (this.drag === 'ring') c.R = Math.max(5, Math.hypot(w[0] - c.c[0], w[1] - c.c[1]));
    else { this.nodeAng.set(this.drag.node, Math.atan2(w[1] - c.c[1], w[0] - c.c[0])); this.dist = 'keep'; }
    this.updateCircle();
  }

  up() { this.drag = null; }

  hover(w: V2, e: { shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean } = {}) {
    this.cursor = w;
    this.msg = null;
    this.dirty();
    const d = this.E.doc;
    switch (this.mode) {
      case 'addNode': {
        this.preview = []; this.marks = [];
        const s = this.sectionAt(w);
        if (!s) { this.msg = { text: 'Select a road to add a junction' }; return; }
        let o = this.onSection(s.id, s.p);
        if (e.altKey) {
          // whole metres from the section's start
          const P = ops.anchorsOf(d, d.get<'section'>(s.id)!), S = ops.samplePath(P, 32);
          const target = Math.round(o.s);
          let i = 0; while (i < S.s.length - 1 && S.s[i] < target) i++;
          o = { ...o, p: S.pts[i] as V2, s: target };
        }
        this.marks = [{ p: o.p, kind: 'point' }];
        if (o.s < 2 || o.len - o.s < 2) this.msg = { text: "Can't add a junction · too close to the end", bad: true };
        else this.msg = { text: `Click to add a junction · ${r1(o.s)} m / ${r1(o.len - o.s)} m` };
        return;
      }
      case 'removeNode': {
        this.marks = [];
        const j = this.junctionAt(w);
        if (!j) { this.msg = { text: 'Select a junction to remove' }; return; }
        const J = d.get<'junction'>(j)!, n = d.sectionsAt(j).length;
        this.marks = [{ p: [J.x, J.z], kind: 'node' }];
        this.msg = n === 2 ? { text: 'Click to remove · the two roads join' } : { text: `Can't remove · ${n} road${n === 1 ? '' : 's'} meet here`, bad: true };
        return;
      }
      case 'union': {
        const j = this.junctionAt(w);
        this.marks = this.nodes.map((id) => { const J = d.get<'junction'>(id)!; return { p: [J.x, J.z] as V2, kind: 'node' as const, text: 'source' }; });
        this.preview = [];
        if (!j) { this.msg = { text: this.nodes.length ? 'Select the junction to merge into' : 'Select the source junction' }; return; }
        const J = d.get<'junction'>(j)!;
        this.marks.push({ p: [J.x, J.z], kind: 'node' });
        if (!this.nodes.length) { this.msg = { text: 'Click to select the source junction' }; return; }
        const S = d.get<'junction'>(this.nodes[0])!;
        const why = ops.unionProblem(d, this.nodes[0], j);
        this.preview = [{ pts: [[S.x, S.z], [J.x, J.z]], dashed: true, bad: !!why }];
        this.msg = !why ? { text: 'Click to merge into this junction' }
          : { text: { same: 'Pick another junction', common: "Can't merge · these two are joined by a road", overflow: "Can't merge · more than 8 roads", far: "Can't merge · too far apart (> 60 m)" }[why], bad: true };
        return;
      }
      case 'splitNode': {
        this.marks = []; this.preview = [];
        if (!this.nodes.length) {
          const j = this.junctionAt(w);
          if (!j) { this.msg = { text: 'Select a junction to split' }; return; }
          const J = d.get<'junction'>(j)!, n = d.sectionsAt(j).length;
          this.marks = [{ p: [J.x, J.z], kind: 'node' }];
          this.msg = n >= 2 ? { text: 'Click to split this junction' } : { text: "Can't split · only one road here", bad: true };
          return;
        }
        const j = this.nodes[0], J = d.get<'junction'>(j)!, arms = d.sectionsAt(j);
        this.marks = [{ p: [J.x, J.z], kind: 'node' }];
        const s = this.sectionAt(w);
        if (s && arms.some((a) => a.id === s.id) && Math.hypot(w[0] - J.x, w[1] - J.z) < 40) {
          const on = this.splitArms.includes(s.id);
          this.msg = on ? { text: 'Click to take this road back' } : this.splitArms.length >= arms.length - 1 ? { text: "Can't add more · one road must stay", bad: true } : { text: 'Click to move this road to the new junction' };
          return;
        }
        if (!this.splitArms.length) { this.msg = { text: 'Click the roads to move (their ends near the junction)' }; return; }
        const far = Math.hypot(w[0] - J.x, w[1] - J.z) > 80;
        this.preview = [{ pts: [[J.x, J.z], w], dashed: true, bad: far }];
        this.marks.push({ p: w, kind: 'node' });
        this.msg = far ? { text: "Can't split · too far from the junction (> 80 m)", bad: true } : { text: `Click to place the new junction (${this.splitArms.length} road${this.splitArms.length > 1 ? 's' : ''}) · Shift keeps the height` };
        return;
      }
      case 'intersect': {
        this.marks = []; this.preview = [];
        const s = this.sectionAt(w);
        if (!s) { this.msg = { text: this.secs.length ? 'Select the second road' : 'Select the first road' }; return; }
        if (!this.secs.length) { this.msg = { text: 'Click to select the first road' }; return; }
        const q = ops.intersectProblem(d, this.secs[0], s.id);
        if (q.p) this.marks = [{ p: q.p, kind: 'point' }];
        this.msg = !q.why ? { text: 'Click to add a junction where they cross' } : { text: { common: "Can't · these roads already share a junction", none: "These roads don't cross", edge: "Can't · they cross too close to a road's end" }[q.why], bad: true };
        return;
      }
      case 'lock': case 'invert': {
        const s = this.sectionAt(w);
        this.marks = [];
        if (!s) { this.msg = { text: this.mode === 'lock' ? 'Select a road to lock or unlock' : 'Select a road to reverse' }; return; }
        const S = d.get<'section'>(s.id)!;
        this.msg = this.mode === 'lock' ? { text: `${S.locked ? 'Click to unlock' : 'Click to lock'}${e.shiftKey ? ' the whole road' : ' this section'}` } : { text: `Click to reverse${e.shiftKey ? ' the whole road' : ' this section'}` };
        return;
      }
      case 'line': case 'circle': case 'slope': this.chainHover(w); return;
      case 'loop': case 'connect': case 'curve': this.pairHover(w); return;
      case 'parallel': this.parallelHover(w, e); return;
      case 'flyover': this.flyHover(w); return;
    }
  }

  // ---------------- flyover in the median ----------------

  private flyHover(w: V2) {
    const d = this.E.doc;
    this.marks = this.picks.map((p, i) => ({ p: p.p, kind: 'point' as const, text: i ? 'end' : 'start' }));
    this.preview = [];
    const s = this.sectionAt(w);
    const road = this.picks[0] ? d.get<'section'>(this.picks[0].section)?.road : null;
    if (this.picks.length >= 2) {
      const [A, B] = this.picks, L = Math.hypot(B.p[0] - A.p[0], B.p[1] - A.p[1]);
      const need = 2 * (this.deck / settings.value.grade);
      this.preview = [{ pts: [A.p, B.p], dashed: false, bad: false }];
      this.msg = { text: `${{ '2': '2 lanes', '4': '4 lanes', '2o': '2 lanes one way' }[this.flyLanes]} · deck ${this.deck} m · ${Math.round(L)} m${L < need ? ` (short: ramps steeper or the deck lower — ${Math.round(need)} m needed at ${(settings.value.grade * 100).toFixed(1)} %)` : ''} · Enter to build` };
      return;
    }
    if (!s) { this.msg = { text: this.picks.length ? 'Select where the flyover comes down (same road)' : 'Select where the flyover starts on a road' }; return; }
    const o = this.onSection(s.id, s.p);
    this.marks.push({ p: o.p, kind: 'point' });
    if (road && d.get<'section'>(s.id)!.road !== road) { this.msg = { text: 'Pick a point on the same road', bad: true }; return; }
    if (this.picks.length) this.preview = [{ pts: [this.picks[0].p, o.p], dashed: true }];
    this.msg = { text: this.picks.length ? 'Click where the flyover comes down' : 'Click where the flyover starts' };
  }

  private flyClick(w: V2) {
    if (this.picks.length >= 2) return;
    const s = this.sectionAt(w);
    if (!s) return;
    const road = this.picks[0] ? this.E.doc.get<'section'>(this.picks[0].section)?.road : null;
    if (road && this.E.doc.get<'section'>(s.id)!.road !== road) return;
    const o = this.onSection(s.id, s.p);
    this.picks.push({ section: s.id, p: o.p, h: o.h });
    this.hover(w);
  }

  click(w: V2, e: { shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean } = {}) {
    const d = this.E.doc, E = this.E;
    this.hover(w, e);
    if (this.msg?.bad) { toast(this.msg.text, 'warn'); return; }
    switch (this.mode) {
      case 'addNode': {
        const s = this.sectionAt(w);
        const at = this.marks[0]?.p;
        if (!s || !at) return;
        const r = E.edit('Add junction', () => ops.splitSection(d, s.id, at));
        if (r) select([{ kind: 'junction', id: r.junction }]);
        return;
      }
      case 'removeNode': {
        const j = this.junctionAt(w);
        if (j && d.sectionsAt(j).length === 2) { const id = E.edit('Remove junction', () => ops.joinAt(d, j)); if (id) select([{ kind: 'section', id }]); }
        return;
      }
      case 'union': {
        const j = this.junctionAt(w);
        if (!j) return;
        if (!this.nodes.length) { this.nodes = [j]; this.hover(w, e); return; }
        const src = this.nodes[0];
        E.edit('Merge junctions', () => ops.mergeJunctions(d, src, j));
        select([{ kind: 'junction', id: j }]);
        toast('Junctions merged', 'ok');
        this.reset();
        return;
      }
      case 'splitNode': {
        if (!this.nodes.length) { const j = this.junctionAt(w); if (j && d.sectionsAt(j).length >= 2) this.nodes = [j]; this.hover(w, e); return; }
        const j = this.nodes[0], J = d.get<'junction'>(j)!, arms = d.sectionsAt(j);
        const s = this.sectionAt(w);
        if (s && arms.some((a) => a.id === s.id) && Math.hypot(w[0] - J.x, w[1] - J.z) < 40) {
          if (this.splitArms.includes(s.id)) this.splitArms = this.splitArms.filter((x) => x !== s.id);
          else this.splitArms.push(s.id);
          this.hover(w, e);
          return;
        }
        if (!this.splitArms.length) return;
        const arms2 = [...this.splitArms];
        const n = E.edit('Split junction', () => ops.splitJunction(d, j, arms2, w[0], w[1], !!e.shiftKey));
        if (n) { select([{ kind: 'junction', id: n }]); toast('Junction split', 'ok'); }
        this.reset();
        return;
      }
      case 'intersect': {
        const s = this.sectionAt(w);
        if (!s) return;
        if (!this.secs.length) { this.secs = [s.id]; this.hover(w, e); return; }
        const a = this.secs[0];
        const j = E.edit('Intersect', () => ops.intersectSections(d, a, s.id));
        if (j) { select([{ kind: 'junction', id: j }]); toast('Junction added where they cross', 'ok'); }
        this.reset();
        return;
      }
      case 'lock': case 'invert': {
        const s = this.sectionAt(w);
        if (!s) return;
        const S = d.get<'section'>(s.id)!;
        const ids = e.shiftKey ? d.sectionsOf(S.road).map((x) => x.id) : [s.id];
        if (this.mode === 'lock') { const on = !S.locked; E.edit(on ? 'Lock' : 'Unlock', () => ops.setLocked(d, ids, on)); toast(on ? `Locked ${ids.length} section${ids.length > 1 ? 's' : ''}` : 'Unlocked', 'ok'); }
        else E.edit('Reverse', () => { for (const id of ids) ops.reverseSection(d, id); });
        this.hover(w, e);
        return;
      }
      case 'line': case 'circle': case 'slope': this.chainClick(w); return;
      case 'loop': case 'connect': case 'curve': this.pairClick(w); return;
      case 'parallel': this.parallelClick(w, e); return;
      case 'flyover': this.flyClick(w); return;
    }
  }

  /** Keyboard while the tool is active; true when handled. */
  key(name: string): boolean {
    const plain = name.replace(/^(Shift|Alt)\+/, '');
    const k = { shiftKey: name.startsWith('Shift+'), altKey: name.startsWith('Alt+') };
    const mode = MT_MODES.find((x) => x.key === name);
    if (mode) { this.setMode(mode.m); return true; }
    const redo = () => { if (this.cursor) this.hover(this.cursor, k); this.dirty(); return true; };
    if (name === 'Enter') { this.apply(); return true; }
    if (name === 'Escape') { if (!this.back()) return false; return true; }
    if (name === 'Backspace') { this.back(); return true; }
    if (plain === 'Z' && this.mode === 'flyover') { this.flyLanes = this.flyLanes === '2' ? '4' : this.flyLanes === '4' ? '2o' : '2'; return redo(); }
    if ((plain === '=' || plain === '-') && this.mode === 'flyover') { this.deck = Math.max(4.5, Math.min(15, this.deck + (plain === '=' ? 1 : -1) * this.step(k, 0.5))); return redo(); }
    if (plain === 'Z') { this.variant++; if (this.mode === 'parallel') this.side = -this.side; if (this.mode === 'line') this.lineFromSection = !this.lineFromSection; return redo(); }
    if (plain === '=' || plain === '-') {
      const sg = plain === '=' ? 1 : -1;
      if (this.mode === 'parallel') this.offset = Math.max(1, this.offsetNow() + sg * this.step(k, 1));
      else if (this.mode === 'curve') this.tension = Math.max(0.1, Math.min(1.5, this.tension + sg * this.step(k, 0.05)));
      else if (this.mode === 'circle' && this.circle) { this.circle.R = Math.max(5, this.circle.R + sg * this.step(k, 1)); this.updateCircle(); }
      else { this.R = Math.max(5, this.R + sg * this.step(k, 1)); if (this.linked) this.R2 = this.R; }
      return redo();
    }
    if ((plain === '[' || plain === ']') && this.mode === 'connect') { this.linked = false; this.R2 = Math.max(5, this.R2 + (plain === ']' ? 1 : -1) * this.step(k, 1)); return redo(); }
    if ((plain === 'PageUp' || plain === 'PageDown') && this.mode === 'parallel') { this.lift += (plain === 'PageUp' ? 1 : -1) * this.step(k, 2.5); return redo(); }
    if (this.mode === 'circle' && this.circle) {
      const m = { E: 'even', B: 'between', I: 'inter' }[plain] as typeof this.dist | undefined;
      if (m) { this.dist = m; this.updateCircle(); return redo(); }
      if (plain === 'R') { this.fitCircleToNodes(); this.dist = 'keep'; this.updateCircle(); return redo(); }
    }
    return false;
  }

  /** Esc / right-click: undo the last pick; false when there was nothing to undo. */
  back(): boolean {
    if (this.picks.length) { this.picks.pop(); this.variant = 0; }
    else if (this.splitArms.length) this.splitArms.pop();
    else if (this.closed) this.closed = false;
    else if (this.nodes.length) { this.nodes.pop(); if (this.mode === 'circle') { this.fitCircleToNodes(); this.updateCircle(); } }
    else if (this.secs.length) this.secs = [];
    else return false;
    if (this.cursor) this.hover(this.cursor);
    this.dirty();
    return true;
  }

  // ---------------- chains: line, circle, slope ----------------

  private chainHover(w: V2) {
    const d = this.E.doc;
    this.drawChain();
    const j = this.junctionAt(w);
    if (this.closed) { this.msg = { text: 'Press Enter to apply' }; return; }
    if (!j) { this.msg = { text: this.nodes.length ? `Select the next junction · Enter applies${this.nodes.length >= (this.mode === 'slope' ? 2 : 3) ? '' : ' (needs more)'}` : 'Select junctions in order along the road' }; return; }
    const J = d.get<'junction'>(j)!;
    this.marks.push({ p: [J.x, J.z], kind: 'node' });
    if (this.nodes.includes(j)) {
      if (this.mode === 'circle' && j === this.nodes[0] && this.nodes.length >= 3 && ops.sectionBetween(d, this.nodes[this.nodes.length - 1], j)) this.msg = { text: 'Click to close the circle' };
      else this.msg = j === this.nodes[this.nodes.length - 1] ? { text: 'Click to unselect' } : { text: 'Already in the order', bad: true };
      return;
    }
    if (this.nodes.length && !ops.sectionBetween(d, this.nodes[this.nodes.length - 1], j)) { this.msg = { text: 'Not joined to the last junction by a road', bad: true }; return; }
    this.msg = { text: 'Click to add to the order' };
  }

  private chainClick(w: V2) {
    const d = this.E.doc;
    const j = this.junctionAt(w);
    if (!j || this.closed) return;
    if (this.nodes.includes(j)) {
      if (this.mode === 'circle' && j === this.nodes[0] && this.nodes.length >= 3) this.closed = true;
      else if (j === this.nodes[this.nodes.length - 1]) this.nodes.pop();
    } else if (!this.nodes.length || ops.sectionBetween(d, this.nodes[this.nodes.length - 1], j)) this.nodes.push(j);
    if (this.mode === 'circle') { this.fitCircleToNodes(); this.updateCircle(); }
    this.hover(w);
  }

  private drawChain() {
    const d = this.E.doc;
    this.marks = this.nodes.map((id, i) => { const J = d.get<'junction'>(id)!; return { p: [J.x, J.z] as V2, kind: 'node' as const, text: String(i + 1) }; });
    this.preview = [];
    const J = this.nodes.map((id) => d.get<'junction'>(id)!);
    if (this.mode === 'line' && J.length >= 2) {
      const { a, h } = this.lineOf();
      const far = (t: number): V2 => [a[0] + h[0] * t, a[1] + h[1] * t];
      const ts = J.map((q) => (q.x - a[0]) * h[0] + (q.z - a[1]) * h[1]);
      this.preview.push({ pts: [far(Math.min(...ts) - 10), far(Math.max(...ts) + 10)], dashed: true });
      for (let i = 0; i < J.length; i++) this.marks.push({ p: far(ts[i]), kind: 'point' });
    }
    if (this.mode === 'slope' && J.length >= 2) {
      const secs = ops.chainSections(d, this.nodes);
      if (secs) {
        const L = secs.reduce((a, s) => a + ops.samplePath(ops.anchorsOf(d, s), 12).len, 0);
        const g = (pt: { x: number; z: number; lift: number }) => this.E.hf.sample(pt.x, pt.z) + pt.lift;
        const grade = (g(J[J.length - 1]) - g(J[0])) / (L || 1);
        const mid = J[Math.floor(J.length / 2)];
        this.marks.push({ p: [mid.x, mid.z], kind: 'point', text: `${(grade * 100).toFixed(1)} % over ${Math.round(L)} m` });
        for (const s of secs) this.preview.push({ pts: ops.samplePath(ops.anchorsOf(d, s), 8).pts as V2[], bad: Math.abs(grade) > 0.08 });
      }
    }
    if (this.mode === 'circle' && this.circle) {
      const c = this.circle;
      this.preview.push({ pts: arcPts(c.c, c.R, 0, Math.PI * 2, Math.max(1, c.R / 30)), dashed: true });
      this.marks.push({ p: c.c, kind: 'handle', text: `R ${r1(c.R)} m` });
      for (const id of this.nodes) { const a = this.nodeAng.get(id); if (a !== undefined) this.marks.push({ p: [c.c[0] + Math.cos(a) * c.R, c.c[1] + Math.sin(a) * c.R], kind: 'handle' }); }
      // the arcs the sections will follow
      const A = this.circleAngles();
      for (let i = 0; i + 1 < A.length; i++) this.preview.push({ pts: arcPts(c.c, c.R, A[i], A[i + 1] - A[i], 2) });
      if (this.closed && A.length) this.preview.push({ pts: arcPts(c.c, c.R, A[A.length - 1], A[0] + Math.sign(A[A.length - 1] - A[0] || 1) * Math.PI * 2 - A[A.length - 1], 2) });
    }
  }

  private lineOf(): { a: V2; h: V2 } {
    const d = this.E.doc, J = this.nodes.map((id) => d.get<'junction'>(id)!);
    const a: V2 = [J[0].x, J[0].z];
    if (this.lineFromSection && J.length >= 2) {
      const s = ops.sectionBetween(d, this.nodes[0], this.nodes[1])!;
      const P = ops.samplePath(ops.anchorsOf(d, s), 8).pts;
      const q = s.a === this.nodes[0] ? P[Math.min(2, P.length - 1)] : P[Math.max(0, P.length - 3)];
      return { a, h: unitv([q[0] - a[0], q[1] - a[1]]) };
    }
    const b = J[J.length - 1];
    return { a, h: unitv([b.x - a[0], b.z - a[1]]) };
  }

  private fitCircleToNodes() {
    const d = this.E.doc;
    const P = this.nodes.map((id) => { const J = d.get<'junction'>(id)!; return [J.x, J.z] as V2; });
    this.circle = P.length >= 3 ? fitCircle(P) : null;
    this.nodeAng.clear();
    if (this.circle) for (let i = 0; i < P.length; i++) this.nodeAng.set(this.nodes[i], Math.atan2(P[i][1] - this.circle.c[1], P[i][0] - this.circle.c[0]));
  }

  /** Node angles in chain order, unwrapped in the chain's turning direction, distributed as chosen. */
  private circleAngles(): number[] {
    const raw = this.nodes.map((id) => this.nodeAng.get(id) ?? 0);
    if (raw.length < 2) return raw;
    const dir = Math.sign(Math.sin(raw[1] - raw[0])) || 1;
    const A = [raw[0]];
    for (let i = 1; i < raw.length; i++) { let a = raw[i]; while (dir > 0 ? a <= A[i - 1] : a >= A[i - 1]) a += dir * 2 * Math.PI; while (Math.abs(a - A[i - 1]) > 2 * Math.PI) a -= dir * 2 * Math.PI; A.push(a); }
    const n = A.length, span = this.closed ? dir * 2 * Math.PI : A[n - 1] - A[0];
    const even = (from: number, to: number, k: number, m: number) => from + ((to - from) * k) / m;
    if (this.dist === 'even') return A.map((_, i) => even(A[0], A[0] + span, i, this.closed ? n : n - 1));
    const d = this.E.doc;
    const inter = this.nodes.map((id, i) => i === 0 || (!this.closed && i === n - 1) || d.sectionsAt(id).length > 2);
    const keys = inter.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
    if (this.dist === 'between' || this.dist === 'inter') {
      const out = [...A];
      const kAng = this.dist === 'inter' ? keys.map((_, m) => even(A[0], A[0] + span, m, this.closed ? keys.length : Math.max(1, keys.length - 1))) : keys.map((i) => A[i]);
      keys.forEach((i, m) => { out[i] = kAng[m]; });
      const ends = [...keys, this.closed ? n : -1].filter((x) => x >= 0);
      for (let m = 0; m + 1 < ends.length; m++) {
        const i0 = ends[m], i1 = ends[m + 1];
        const a0 = out[i0], a1 = i1 === n ? out[0] + span : out[i1];
        for (let i = i0 + 1; i < i1; i++) out[i] = even(a0, a1, i - i0, i1 - i0);
      }
      return out;
    }
    return A;
  }

  private updateCircle() {
    const A = this.circleAngles();
    if (A.length >= 2) {
      let big = false;
      for (let i = 0; i + 1 < A.length; i++) if (Math.abs(A[i + 1] - A[i]) > Math.PI / 2) big = true;
      if (big) this.msg = { text: 'Big angle between junctions · the curve will be far from round' };
    }
    this.dirty();
  }

  // ---------------- pairs: loop, connection, curve ----------------

  private pairCandidates(): { pts: V2[]; label: string; bad?: string }[] {
    const [A, B] = this.picks;
    if (!A || !B) return [];
    if (this.mode === 'curve') {
      const h = Math.hypot(B.p[0] - A.p[0], B.p[1] - A.p[1]) * this.tension;
      // both headings point out of their roads: the curve leaves A along A.h and comes into B against B.h
      const C = [A.p[0], A.p[1], A.p[0] + A.h[0] * h, A.p[1] + A.h[1] * h, B.p[0] + B.h[0] * h, B.p[1] + B.h[1] * h, B.p[0], B.p[1]];
      const pts: V2[] = [];
      for (let i = 0; i <= 40; i++) pts.push(ops.bezAt(C, i / 40) as V2);
      const R = minRadius(pts);
      return [{ pts, label: `${Math.round(polyLength(pts))} m · tightest R ${Number.isFinite(R) ? Math.round(R) : '∞'} m` }];
    }
    const flips: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    const out: { pts: V2[]; label: string; len: number; pref: number }[] = [];
    const toward = (h: V2, from: V2, to: V2) => Math.sign(h[0] * (to[0] - from[0]) + h[1] * (to[1] - from[1])) || 1;
    for (const [fa, fb] of flips) {
      const hA: V2 = [A.h[0] * fa, A.h[1] * fa], hB: V2 = [B.h[0] * fb, B.h[1] * fb];
      // preferred: leave A heading towards B, arrive at B heading away from A
      const pref = (toward(hA, A.p, B.p) > 0 ? 0 : 1) + (toward(hB, A.p, B.p) > 0 ? 0 : 1);
      if (this.mode === 'loop') {
        for (const L of scsLoops(A.p, hA, B.p, hB, this.R)) out.push({ pts: L.pts, len: L.length, pref: pref + (Math.abs(L.sweep) > Math.PI ? 0 : 3), label: `loop · R ${r1(this.R)} m · ${Math.round(L.length)} m · turns ${Math.round((Math.abs(L.sweep) * 180) / Math.PI)}°` });
      } else {
        for (const c of cscPaths(A.p, hA, this.R, B.p, hB, this.R2)) out.push({ pts: c.pts, len: c.length, pref, label: `R ${r1(this.R)} / ${r1(this.R2)} m · ${Math.round(c.length)} m` });
      }
    }
    return out.sort((a, b) => a.pref - b.pref || a.len - b.len);
  }

  private pairHover(w: V2) {
    this.marks = this.picks.map((p, i) => ({ p: p.p, kind: 'point' as const, text: i === 0 ? 'start' : 'end' }));
    this.preview = [];
    if (this.picks.length >= 2) {
      const C = this.pairCandidates();
      if (!C.length) { this.msg = { text: this.mode === 'loop' ? 'No loop fits · change the radius (= / −)' : 'No connection fits · change the radii', bad: true }; return; }
      const c = C[this.variant % C.length];
      this.preview = [{ pts: c.pts }];
      this.msg = { text: `${c.label} · shape ${(this.variant % C.length) + 1}/${C.length} (Z) · Enter to build` };
      return;
    }
    if (this.mode === 'curve') {
      const s = this.sectionAt(w);
      if (!s) { this.msg = { text: this.picks.length ? 'Select the end of the second road' : 'Select the end of a road' }; return; }
      const e = this.endOf(s.id, w);
      this.marks.push({ p: e.p, kind: 'point' });
      this.msg = { text: 'Click to use this road end' };
      if (this.picks.length) this.preview = [{ pts: [this.picks[0].p, e.p], dashed: true }];
      return;
    }
    const s = this.sectionAt(w);
    if (!s) { this.msg = { text: this.picks.length ? 'Select where it joins the second road' : 'Select where it leaves the first road' }; return; }
    const o = this.onSection(s.id, s.p);
    this.marks.push({ p: o.p, kind: 'point' });
    this.msg = { text: this.picks.length ? 'Click where it joins this road' : 'Click where it leaves this road' };
  }

  /** The end of a section nearest to w: its junction position and the heading out of the road. */
  private endOf(id: Id, w: V2): Pick & { junction: Id } {
    const d = this.E.doc, s = d.get<'section'>(id)!;
    const P = ops.anchorsOf(d, s), S = ops.samplePath(P, 8).pts;
    const A = d.get<'junction'>(s.a)!, B = d.get<'junction'>(s.b)!;
    const atA = Math.hypot(w[0] - A.x, w[1] - A.z) < Math.hypot(w[0] - B.x, w[1] - B.z);
    const q = atA ? S[Math.min(2, S.length - 1)] : S[Math.max(0, S.length - 3)];
    const J = atA ? A : B;
    return { section: id, junction: J.id, p: [J.x, J.z], h: unitv([J.x - q[0], J.z - q[1]]) };
  }

  private pairClick(w: V2) {
    if (this.picks.length >= 2) return;
    const s = this.sectionAt(w);
    if (!s) return;
    if (this.mode === 'curve') this.picks.push(this.endOf(s.id, w));
    else { const o = this.onSection(s.id, s.p); this.picks.push({ section: s.id, p: o.p, h: o.h }); }
    this.variant = 0;
    this.hover(w);
  }

  // ---------------- parallel ----------------

  /** The picked road as one polyline in travel order. */
  private chainLine(): { pts: V2[]; first: SectionObj } | null {
    const d = this.E.doc;
    if (!this.secs.length) return null;
    const chains = ops.chainsOf(d, this.secs);
    const ch = chains.sort((a, b) => b.length - a.length)[0];
    if (!ch?.length) return null;
    const pts: V2[] = [];
    for (const c of ch) {
      const S = ops.samplePath(ops.anchorsOf(d, c.s), 12).pts as V2[];
      const run = c.fwd ? S : [...S].reverse();
      pts.push(...(pts.length ? run.slice(1) : run));
    }
    return { pts, first: ch[0].s };
  }

  private offsetNow(): number {
    if (this.offset > 0) return this.offset;
    const ch = this.chainLine();
    return ch ? Math.round(totalWidth(ch.first.parts) + 1.5) : 12;
  }

  private parallelHover(w: V2, e: { shiftKey?: boolean }) {
    this.marks = []; this.preview = [];
    const ch = this.chainLine();
    if (!ch) {
      const s = this.sectionAt(w);
      this.msg = { text: s ? `Click to take this ${e.shiftKey ? 'section' : 'road'}` : 'Select a road to copy alongside' };
      if (s) this.preview = [{ pts: ops.samplePath(ops.anchorsOf(this.E.doc, this.E.doc.get<'section'>(s.id)!), 8).pts as V2[], dashed: true }];
      return;
    }
    const d = this.offsetNow() * this.side;
    const pts = offsetPolyline(ch.pts, d);
    this.preview = [{ pts: ch.pts, dashed: true }, { pts }];
    this.msg = { text: `${Math.abs(d)} m to the ${d > 0 ? 'left' : 'right'}${this.lift ? ` · ${this.lift > 0 ? '+' : ''}${this.lift} m` : ''} · ${Math.round(polyLength(pts))} m · Enter to build` };
  }

  private parallelClick(w: V2, e: { shiftKey?: boolean }) {
    const s = this.sectionAt(w);
    if (!s) return;
    const S = this.E.doc.get<'section'>(s.id)!;
    this.secs = e.shiftKey ? [s.id] : this.E.doc.sectionsOf(S.road).map((x) => x.id);
    this.offset = 0;
    this.hover(w, e);
  }

  // ---------------- apply ----------------

  apply() {
    const d = this.E.doc, E = this.E;
    switch (this.mode) {
      case 'line': {
        if (this.nodes.length < 3) { toast('Pick at least three junctions', 'warn'); return; }
        const { a, h } = this.lineOf();
        const n = [...this.nodes];
        E.edit('Arrange on line', () => ops.arrangeOnLine(d, n, a, h));
        toast(`${n.length} junctions lined up`, 'ok');
        break;
      }
      case 'circle': {
        if (!this.circle || this.nodes.length < 3) { toast('Pick at least three junctions', 'warn'); return; }
        const A = this.circleAngles(), n = [...this.nodes], c = this.circle, closed = this.closed;
        E.edit('Arrange on circle', () => ops.arrangeOnCircle(d, n, c.c, c.R, A, closed));
        toast(`${n.length} junctions on a ${Math.round(c.R)} m circle`, 'ok');
        break;
      }
      case 'slope': {
        if (this.nodes.length < 2) { toast('Pick at least two junctions', 'warn'); return; }
        const n = [...this.nodes];
        const g = E.edit('Even slope', () => ops.slopeChain(d, n, (x, z) => E.hf.sample(x, z) + E.hf.base));
        toast(`One gradient: ${((g ?? 0) * 100).toFixed(1)} %`, 'ok');
        break;
      }
      case 'loop': case 'connect': case 'curve': {
        const C = this.pairCandidates();
        if (C.length < 1 || this.picks.length < 2) { toast('Pick two roads first', 'warn'); return; }
        const c = C[this.variant % C.length];
        const [A, B] = this.picks;
        const st = this.street();
        const ends = this.mode === 'curve'
          ? [{ x: A.p[0], z: A.p[1], junction: (A as Pick & { junction?: Id }).junction }, { x: B.p[0], z: B.p[1], junction: (B as Pick & { junction?: Id }).junction }]
          : [{ x: A.p[0], z: A.p[1], section: A.section }, { x: B.p[0], z: B.p[1], section: B.section }];
        const r = E.edit(this.mode === 'loop' ? 'Loop' : this.mode === 'curve' ? 'Curve' : 'Connection', () => ops.roadAlong(d, c.pts, ends[0], ends[1], st.cls, { parts: st.parts, asset: st.asset }));
        if (r?.section) { select([{ kind: 'road', id: r.road }]); toast(`${this.mode === 'loop' ? 'Loop' : this.mode === 'curve' ? 'Curve' : 'Connection'} built · ${Math.round(polyLength(c.pts))} m`, 'ok'); }
        break;
      }
      case 'flyover': {
        if (this.picks.length < 2) { toast('Pick where the flyover starts and ends', 'warn'); return; }
        const [A, B] = this.picks, parts = ops.FLYOVER_PARTS[this.flyLanes], deck = this.deck;
        const r = E.edit('Flyover', () => ops.flyoverOver(d, { section: A.section, p: A.p }, { section: B.section, p: B.p }, parts, deck, settings.value.grade));
        if (r) {
          select([{ kind: 'section', id: r.section }]);
          toast(`Flyover built · deck ${r.level.deck} m${r.level.lowered ? ' (lowered: the run is short)' : ''} · ramps ${r.level.ramp} m at ${(r.level.grade * 100).toFixed(1)} %`, r.level.steep || r.level.lowered ? 'warn' : 'ok');
        } else toast("Couldn't build it here — pick two points on the same road", 'warn');
        break;
      }
      case 'parallel': {
        const ch = this.chainLine();
        if (!ch) { toast('Pick a road first', 'warn'); return; }
        const off = this.offsetNow() * this.side, pts = offsetPolyline(ch.pts, off), lift = this.lift;
        // ends join junctions already there (within 4 m), otherwise open ends
        const endAt = (p: V2) => { const j = E.hit.nearestJunction(p[0], p[1], 4); return { x: p[0], z: p[1], lift, ...(j ? { junction: j.id } : {}) }; };
        const st = { cls: ch.first.cls, parts: ch.first.parts, asset: ch.first.asset };
        const r = E.edit('Parallel road', () => ops.roadAlong(d, pts, endAt(pts[0]), endAt(pts[pts.length - 1]), st.cls, { parts: st.parts, asset: st.asset, name: ch.first.name }));
        if (r?.section) { select([{ kind: 'road', id: r.road }]); toast(`Parallel road ${Math.abs(off)} m to the ${off > 0 ? 'left' : 'right'}`, 'ok'); }
        break;
      }
      default: return;
    }
    this.reset();
    if (this.cursor) this.hover(this.cursor);
  }

  // ---------------- drawing ----------------

  draw(ctx: CanvasRenderingContext2D, at: (x: number, z: number) => [number, number], label: (p: [number, number], text: string, dy?: number) => void) {
    const ACC = '#ff8a3d', BAD = '#e5484d', OK = '#2f7cf6';
    for (const pv of this.preview) {
      if (pv.pts.length < 2) continue;
      ctx.strokeStyle = pv.bad ? BAD : pv.dashed ? 'rgba(47,124,246,0.8)' : ACC;
      ctx.lineWidth = pv.dashed ? 1.5 : 3;
      ctx.setLineDash(pv.dashed ? [6, 5] : []);
      ctx.beginPath();
      pv.pts.forEach((p, i) => { const s = at(p[0], p[1]); if (i) ctx.lineTo(s[0], s[1]); else ctx.moveTo(s[0], s[1]); });
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const m of this.marks) {
      const s = at(m.p[0], m.p[1]);
      ctx.fillStyle = m.kind === 'handle' ? '#fff' : m.kind === 'node' ? OK : ACC;
      ctx.strokeStyle = m.kind === 'handle' ? OK : '#fff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      if (m.kind === 'handle') ctx.rect(s[0] - 5, s[1] - 5, 10, 10); else ctx.arc(s[0], s[1], m.kind === 'node' ? 7 : 5, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      if (m.text) label(s, m.text, -16);
    }
    if (this.cursor && this.msg) label(at(this.cursor[0], this.cursor[1]), this.msg.text, 28);
    void BAD;
  }
}
