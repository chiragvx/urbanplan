// The build tool for catalogue assets that aren't streets: routes (rail, metro, canals, pipes, power lines, paths),
// placed structures (stations, platforms, substations, tanks) and areas (depots, parks, flood zones). Routes use the
// road tool's modes (straight / curve / complex / continuous), carry on from where the last stretch ended, snap to
// their own layer's lines, pipes and cables slip into a road's footpath, and stations snap onto their line. Hard
// limits (a metro's 120 m curve radius) refuse the stretch; soft ones are checked in the Issues panel.
import type { Editor } from './editor';
import * as ops from '../doc/ops';
import type { Id, LineObj } from '../doc/types';
import type { V2 } from '../net/model';
import { buildAsset, penLift, placeRot, readOnly, select, settings, status, toast } from './state';
import { getAsset, createAssetLine, lineShape, assetOf, minRadiusOf, type AssetDef } from '../assets';
import { MODE_LABEL, bearing } from './roadtool';

export interface AssetSnap { p: V2; kind?: 'end' | 'line' | 'verge' | 'road' | 'guide' | 'angle'; label?: string; dir?: V2 | null; line?: Id; guide?: { o: V2; d: V2 } }
export interface AssetPreview { pts: V2[]; len: number; R: number; bad?: string }

const norm = (x: number, z: number): V2 | null => { const l = Math.hypot(x, z); return l > 1e-6 ? [x / l, z / l] : null; };
const rot = (d: V2, deg: number): V2 => { const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [d[0] * c - d[1] * s, d[0] * s + d[1] * c]; };

export class AssetTool {
  /** route: where the stretch being drawn starts */
  start: { p: V2; dir: V2 | null; line: Id | null } | null = null;
  ctrl: V2[] = [];
  /** area: corners so far */
  ring: V2[] = [];
  cursor: AssetSnap | null = null;
  preview: AssetPreview | null = null;

  constructor(readonly E: Editor) {}

  get asset(): AssetDef | undefined { return getAsset(buildAsset.value); }
  get active() { return !!this.start || this.ring.length > 0; }

  hint(): string {
    const a = this.asset;
    if (!a) return 'Pick something to build from the palette';
    if (a.drawer === 'place') return `${a.name}: click to place${this.snapLayer(a) ? ' — snaps onto its line' : ''} · [ ] rotate`;
    if (a.drawer === 'area') return `${a.name}: click the corners · Enter or double-click to finish`;
    const mode = settings.value.roadMode;
    const m = mode === 'freeform' || mode === 'replace' ? 'straight' : mode;
    return `${a.name} · ${MODE_LABEL[m]} · PgUp/PgDn ${(a.lift ?? 0) < 0 ? 'depth' : 'height'} · right-click steps back`;
  }

  private mode() { const m = settings.value.roadMode; return m === 'freeform' || m === 'replace' ? 'straight' : m; }

  /** Line layer kinds a placed structure sits on. */
  private snapLayer(a: AssetDef): string | null {
    if (a.id.startsWith('transit.metroStation')) return 'metro';
    if (a.id.startsWith('rail.platform')) return 'rail';
    return null;
  }

  // ---------------- snapping ----------------

  snap(w: V2, raw: boolean, shift: boolean, alt = false): AssetSnap {
    const E = this.E, a = this.asset, px = 1 / E.ppm;
    if (!a || raw || !settings.value.snap) return { p: w };
    const q = (r: number) => [...E.hit.query(w[0] - r, w[1] - r, w[0] + r, w[1] + r)];
    // structures: onto their line (stations, platforms) or onto a road (BRT stations, bus stops)
    if (a.drawer === 'place') {
      const kind = this.snapLayer(a);
      if (kind) {
        const best = this.nearestLine(w, 30 * px, (l) => E.doc.get<'layer'>(l.layer)?.lineKind === kind && lineShape(l) === 'route');
        if (best) return { p: best.p, kind: 'line', dir: best.dir, line: best.id, label: `on the ${kind === 'metro' ? 'metro' : 'railway'}` };
      }
      if (a.category === 'transit' && (a.id === 'transit.brtStation' || a.id === 'transit.busStop')) {
        const s = E.hit.nearestSection(w[0], w[1], 30 * px);
        if (s) {
          const sec = E.doc.get<'section'>(s.id)!;
          const d = this.sectionDir(s.id, s.p);
          if (a.id === 'transit.brtStation' || !d) return { p: s.p, kind: 'road', dir: d, label: 'on the road' };
          // bus stop: at the kerb on the cursor's side
          const hw = sec.parts.reduce((t, p) => t + p.width, 0) / 2;
          const n: V2 = [-d[1], d[0]], side = Math.sign((w[0] - s.p[0]) * n[0] + (w[1] - s.p[1]) * n[1]) || 1;
          return { p: [s.p[0] + n[0] * side * (hw - 1), s.p[1] + n[1] * side * (hw - 1)], kind: 'road', dir: d, label: 'at the kerb' };
        }
      }
      return { p: w };
    }
    if (a.drawer === 'area') {
      if (this.ring.length >= 3 && Math.hypot(w[0] - this.ring[0][0], w[1] - this.ring[0][1]) < 10 * px) return { p: this.ring[0], kind: 'end', label: 'close' };
      return { p: w };
    }
    // routes: ends and lines of the same layer
    const layer = a.layer?.id;
    for (const id of q(12 * px)) {
      const l = E.doc.get<'line'>(id);
      if (l?.kind !== 'line' || l.layer !== layer || lineShape(l) !== 'route') continue;
      const n = l.pts.length;
      for (const [x, z, end] of [[l.pts[0], l.pts[1], 0], [l.pts[n - 2], l.pts[n - 1], 1]] as const) {
        if (Math.hypot(w[0] - x, w[1] - z) < 12 * px) {
          // direction the line leaves this end in
          const j = end ? n - 4 : 2;
          const dir = n >= 4 ? norm(x - l.pts[j], z - l.pts[j + 1]) : null;
          return { p: [x, z], kind: 'end', line: l.id, dir, label: 'line end' };
        }
      }
    }
    const on = this.nearestLine(w, 9 * px, (l) => l.layer === layer && lineShape(l) === 'route');
    if (on) return { p: on.p, kind: 'line', line: on.id, dir: on.dir };
    // pipes and cables go in the footpath, not under the carriageway (Alt: the road's centre line)
    if (a.profile.type === 'conduit' || (a.profile.type === 'corridor' && a.profile.poles)) {
      const s = E.hit.nearestSection(w[0], w[1], 25 * px);
      if (s) {
        const sec = E.doc.get<'section'>(s.id)!;
        const d = this.sectionDir(s.id, s.p);
        if (alt || !d) return { p: s.p, kind: 'road', dir: d, label: 'road centre' };
        const hw = sec.parts.reduce((t, p) => t + p.width, 0) / 2;
        const fp = Math.min(sec.parts[0]?.kind === 'sidewalk' ? sec.parts[0].width : 1, 2);
        const n: V2 = [-d[1], d[0]], side = Math.sign((w[0] - s.p[0]) * n[0] + (w[1] - s.p[1]) * n[1]) || 1;
        const off = Math.max(0.5, hw - fp / 2);
        return { p: [s.p[0] + n[0] * side * off, s.p[1] + n[1] * side * off], kind: 'verge', dir: d, label: 'in the footpath' };
      }
    }
    // angles from the last direction, lengths rounded
    const from = this.lastPoint(), dir = this.lastDir();
    if (from && shift) {
      const dx = w[0] - from[0], dz = w[1] - from[1], L = this.roundLen(Math.hypot(dx, dz));
      const ang = Math.round(Math.atan2(dz, dx) / (Math.PI / 12)) * (Math.PI / 12);
      return { p: [from[0] + Math.cos(ang) * L, from[1] + Math.sin(ang) * L], kind: 'angle', label: `${bearing([Math.cos(ang), Math.sin(ang)])}°` };
    }
    if (from && dir && settings.value.snapAngles) {
      for (const [deg, label] of [[0, 'straight on'], [90, '90°'], [-90, '90°'], [45, '45°'], [-45, '45°']] as const) {
        const d = rot(dir, deg);
        const t = (w[0] - from[0]) * d[0] + (w[1] - from[1]) * d[1];
        if (t <= 0) continue;
        const qx = from[0] + d[0] * t, qz = from[1] + d[1] * t;
        if (Math.hypot(w[0] - qx, w[1] - qz) < 8 * px) { const T = this.roundLen(t); return { p: [from[0] + d[0] * T, from[1] + d[1] * T], kind: 'guide', label, guide: { o: from, d } }; }
      }
    }
    if (from && settings.value.snapLength > 0) {
      const dx = w[0] - from[0], dz = w[1] - from[1], L = Math.hypot(dx, dz), R = this.roundLen(L);
      if (L > 0.01) return { p: [from[0] + (dx / L) * R, from[1] + (dz / L) * R] };
    }
    return { p: w };
  }

  private roundLen(L: number) { const k = settings.value.snapLength; return k > 0 ? Math.max(k, Math.round(L / k) * k) : L; }

  private nearestLine(w: V2, r: number, ok: (l: LineObj) => boolean): { id: Id; p: V2; dir: V2 | null } | null {
    let best: { id: Id; p: V2; dir: V2 | null; d: number } | null = null;
    for (const id of this.E.hit.query(w[0] - r, w[1] - r, w[0] + r, w[1] + r)) {
      const l = this.E.doc.get<'line'>(id);
      if (l?.kind !== 'line' || !ok(l)) continue;
      for (let i = 0; i + 3 < l.pts.length; i += 2) {
        const ax = l.pts[i], az = l.pts[i + 1], bx = l.pts[i + 2], bz = l.pts[i + 3];
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((w[0] - ax) * dx + (w[1] - az) * dz) / L2));
        const p: V2 = [ax + dx * t, az + dz * t], d = Math.hypot(w[0] - p[0], w[1] - p[1]);
        if (d < r && (!best || d < best.d)) best = { id, p, dir: norm(dx, dz), d };
      }
    }
    return best;
  }

  private sectionDir(sid: Id, p: V2): V2 | null {
    const s = this.E.doc.get<'section'>(sid);
    if (!s) return null;
    const P = ops.anchorsOf(this.E.doc, s);
    const n = ops.nearestOnPath(P, p);
    const c = ops.cubicsOf(P)[n.k], t = n.t, u = 1 - t;
    return norm(u * u * (c[2] - c[0]) + 2 * u * t * (c[4] - c[2]) + t * t * (c[6] - c[4]), u * u * (c[3] - c[1]) + 2 * u * t * (c[5] - c[3]) + t * t * (c[7] - c[5]));
  }

  private lastPoint(): V2 | null { return this.ctrl.length ? this.ctrl[this.ctrl.length - 1] : this.start?.p ?? (this.ring.length ? this.ring[this.ring.length - 1] : null); }
  private lastDir(): V2 | null {
    if (!this.start) return null;
    if (this.ctrl.length) { const a = this.ctrl.length > 1 ? this.ctrl[this.ctrl.length - 2] : this.start.p, b = this.ctrl[this.ctrl.length - 1]; return norm(b[0] - a[0], b[1] - a[1]); }
    return this.start.dir;
  }

  // ---------------- drawing ----------------

  private pieces(p: V2): { pieces: number[][]; R: number } {
    const S = this.start!, s = S.p, c = this.ctrl;
    switch (this.mode()) {
      case 'curve': return { pieces: [c.length ? ops.quadPiece(s, c[0], p) : ops.line(s, p)], R: Infinity };
      case 'complex':
        if (c.length >= 2) return { pieces: [[s[0], s[1], c[0][0], c[0][1], c[1][0], c[1][1], p[0], p[1]]], R: Infinity };
        return { pieces: [c.length ? ops.quadPiece(s, c[0], p) : ops.line(s, p)], R: Infinity };
      case 'continuous': if (S.dir) { const a = ops.arcPieces(s, S.dir, p); return { pieces: a.pieces, R: a.R }; } return { pieces: [ops.line(s, p)], R: Infinity };
      default: return { pieces: [ops.line(s, p)], R: Infinity };
    }
  }
  private needCtrl() { const m = this.mode(); return m === 'curve' ? 1 : m === 'complex' ? 2 : 0; }

  /** Polyline of the stretch: straight pieces as their ends, curves every ~4 m. */
  private polyline(pieces: number[][]): V2[] {
    const out: V2[] = [];
    pieces.forEach((c, i) => {
      const straight = Math.abs((c[2] - c[0]) * (c[7] - c[1]) - (c[3] - c[1]) * (c[6] - c[0])) < 1e-3 && Math.abs((c[4] - c[0]) * (c[7] - c[1]) - (c[5] - c[1]) * (c[6] - c[0])) < 1e-3;
      const L = Math.hypot(c[6] - c[0], c[7] - c[1]);
      const n = straight ? 1 : Math.max(4, Math.ceil(L / 4));
      for (let k = i ? 1 : 0; k <= n; k++) out.push(ops.bezAt(c, k / n));
    });
    return out;
  }

  hover(w: V2, raw: boolean, shift: boolean, alt = false) {
    this.cursor = this.snap(w, raw, shift, alt);
    this.refresh();
  }

  refresh() {
    const a = this.asset;
    this.preview = null;
    if (a && this.start && this.cursor) {
      const { pieces, R } = this.pieces(this.cursor.p);
      const pts = this.polyline(pieces);
      let len = 0;
      for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      this.preview = { pts, len, R, bad: this.check(a, pts) };
    }
    this.E.overlayDirty = true;
  }

  /** Hard limits: the reason a stretch can't be built, if any. */
  private check(a: AssetDef, pts: V2[]): string | undefined {
    const rule = a.rules?.find((r) => r.kind === 'minRadius');
    if (!rule || rule.kind !== 'minRadius' || !rule.hard || pts.length < 2) return undefined;
    const S = this.start!;
    const d0 = norm(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]);
    if (S.dir && d0) {
      const ang = (Math.acos(Math.max(-1, Math.min(1, S.dir[0] * d0[0] + S.dir[1] * d0[1]))) * 180) / Math.PI;
      if (ang > 4) return `${Math.round(ang)}° kink — use Continuous or a curve mode (radius ≥ ${rule.r} m)`;
    }
    const R = minRadiusOf(pts);
    if (R < rule.r) return `Radius ${Math.round(R)} m is tighter than ${rule.r} m`;
    return undefined;
  }

  click(w: V2, raw: boolean, shift: boolean, alt: boolean) {
    if (readOnly.value) { toast('This map is read-only', 'warn'); return; }
    const a = this.asset;
    if (!a) { toast('Pick something to build first', 'info'); return; }
    const sp = this.snap(w, raw, shift, alt);
    if (a.drawer === 'place') return this.place(a, sp);
    if (a.drawer === 'area') {
      if (sp.kind === 'end' && this.ring.length >= 3) { this.finish(); return; }
      this.ring.push(sp.p);
      status.value = `${this.ring.length} corner${this.ring.length > 1 ? 's' : ''} · Enter or double-click to finish`;
      this.cursor = sp; this.refresh();
      return;
    }
    if (!this.start) {
      const dir = sp.kind === 'end' ? sp.dir ?? null : null;
      this.start = { p: sp.p, dir, line: sp.kind === 'end' && this.isEnd(sp) ? sp.line ?? null : null };
      this.ctrl = [];
      this.cursor = sp; this.refresh();
      status.value = this.hint();
      return;
    }
    if (this.ctrl.length < this.needCtrl()) { this.ctrl.push(sp.p); this.cursor = sp; this.refresh(); return; }
    this.commit(a, sp);
  }

  /** Is the snap at the *last* point of its line (so drawing on appends to it)? */
  private isEnd(sp: AssetSnap) {
    const l = sp.line ? this.E.doc.get<'line'>(sp.line) : undefined;
    return !!l && Math.hypot(l.pts[l.pts.length - 2] - sp.p[0], l.pts[l.pts.length - 1] - sp.p[1]) < 0.05;
  }

  private commit(a: AssetDef, sp: AssetSnap) {
    const E = this.E, S = this.start!;
    const { pieces } = this.pieces(sp.p);
    const pts = this.polyline(pieces);
    if (Math.hypot(sp.p[0] - S.p[0], sp.p[1] - S.p[1]) < 1) return;
    const bad = this.check(a, pts);
    if (bad) { toast(`Can't build: ${bad}`, 'warn'); return; }
    const lift = penLift.value;
    const res = E.edit(`Build ${a.name}`, () => {
      const cur = S.line ? E.doc.get<'line'>(S.line) : undefined;
      if (cur && assetOf(cur)?.id === a.id && Math.abs(-cur.depth - lift) < 0.01) {
        E.doc.set(cur.id, 'pts', [...cur.pts, ...pts.slice(1).flatMap((p) => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100])]);
        return cur.id;
      }
      return createAssetLine(E.doc, a, pts.flat(), lift);
    });
    if (!res) return;
    const L = this.preview?.len ?? 0;
    const end = pts[pts.length - 1], prev = pts[pts.length - 2];
    if (sp.kind === 'end' || sp.kind === 'line') {
      this.start = null;
      status.value = `Built ${L.toFixed(0)} m · connected — click to start another`;
    } else {
      this.start = { p: end, dir: norm(end[0] - prev[0], end[1] - prev[1]), line: res };
      status.value = `Built ${L.toFixed(0)} m · keep clicking to carry on, right-click to stop`;
    }
    this.ctrl = [];
    this.cursor = sp; this.refresh();
  }

  private place(a: AssetDef, sp: AssetSnap) {
    const E = this.E;
    const rotDeg = sp.dir ? (Math.atan2(sp.dir[1], sp.dir[0]) * 180) / Math.PI : placeRot.value;
    const id = E.edit(`Place ${a.name}`, () => createAssetLine(E.doc, a, [sp.p[0], sp.p[1]], a.lift ?? 0, { rot: Math.round(rotDeg * 10) / 10 }));
    if (id) status.value = `Placed ${a.name}${sp.label ? ` ${sp.label}` : ''} · click to place another, Esc when done`;
  }

  /** Enter / double-click: close an area, or stop the route. */
  finish() {
    const a = this.asset;
    if (a?.drawer === 'area') {
      if (this.ring.length >= 3) {
        const ring = this.ring;
        const id = this.E.edit(`Add ${a.name}`, () => createAssetLine(this.E.doc, a, ring.flat(), 0));
        if (id) { select([{ kind: 'line', id }]); toast(`Added ${a.name}`, 'ok'); }
      }
      this.ring = [];
      this.refresh();
      status.value = this.hint();
      return;
    }
    this.start = null; this.ctrl = [];
    this.refresh();
    status.value = this.hint();
  }

  /** Right-click: drop the last point / stop. */
  back(): boolean {
    if (this.ctrl.length) { this.ctrl.pop(); this.refresh(); return true; }
    if (this.ring.length) { this.ring.pop(); this.refresh(); return true; }
    if (this.start) { this.start = null; this.refresh(); status.value = this.hint(); return true; }
    return false;
  }

  cancel() { this.start = null; this.ctrl = []; this.ring = []; this.preview = null; this.E.overlayDirty = true; }
}
