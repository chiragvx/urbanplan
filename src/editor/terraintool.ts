// Terrain tool (Cities: Skylines' landscaping): brushes — raise / lower (Shift), level (right-click picks the height,
// or "balanced" so cut = fill), soften, restore — and shapes — slope (drag from A to B), pad, pond (click a polygon),
// embankment / cutting (click a line). Each drag or shape is one earthwork object and one undo step.
import type { Editor } from './editor';
import { newId } from '../doc/ids';
import type { EarthworkObj, EarthworkOp, Id } from '../doc/types';
import { readOnly, settings, status, toast } from './state';

export const TERRAIN_OPS: { op: EarthworkOp; label: string; hint: string }[] = [
  { op: 'shift', label: 'Raise', hint: 'Drag to raise · right-drag (or Alt) to lower' },
  { op: 'level', label: 'Level', hint: 'Drag to level to the height · right-click picks a height · Balanced keeps cut = fill' },
  { op: 'soften', label: 'Soften', hint: 'Drag to smooth bumps and steps' },
  { op: 'slope', label: 'Slope', hint: 'Drag from the top to the bottom of the ramp' },
  { op: 'restore', label: 'Restore', hint: 'Drag to bring back the original ground' },
  { op: 'pad', label: 'Pad', hint: 'Click the corners of a flat platform · Enter to finish' },
  { op: 'embank', label: 'Embankment', hint: 'Click along a line · Enter to finish · height above / below the ground in the bar' },
  { op: 'pond', label: 'Pond', hint: 'Click the outline of a pond · Enter to finish' },
];

const BRUSH: EarthworkOp[] = ['shift', 'level', 'soften', 'restore'];

export class TerrainTool {
  /** a brush stroke or slope being dragged */
  stroke: { id: Id; op: EarthworkOp; last: [number, number]; n: number; sign: number; start: [number, number] } | null = null;
  /** shape points being clicked (pad / pond / embank) */
  pts: number[] = [];
  cursor: [number, number] | null = null;
  private seqN = 0;

  constructor(readonly E: Editor) {}

  get op(): EarthworkOp { return settings.value.terrainOp; }
  get radius() { return settings.value.brushRadius; }
  hint() { return TERRAIN_OPS.find((o) => o.op === this.op)?.hint ?? ''; }

  /** Designed ground height above sea level at a point. */
  heightAt(x: number, z: number) { return this.E.hf.sample(x, z) + this.E.hf.base; }

  private nextSeq() {
    let m = this.seqN;
    for (const o of this.E.doc.all('earthwork')) m = Math.max(m, o.seq);
    return (this.seqN = m + 1);
  }

  /** Mean ground height within a circle or polygon (the "balanced" level: cut = fill). */
  meanHeight(x: number, z: number, r: number, poly?: number[]): number {
    const hf = this.E.hf, n = hf.n;
    const g = poly ? (() => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (let i = 0; i < poly.length; i += 2) { x0 = Math.min(x0, poly[i]); x1 = Math.max(x1, poly[i]); z0 = Math.min(z0, poly[i + 1]); z1 = Math.max(z1, poly[i + 1]); } return hf.gridRange(x0, z0, x1, z1); })() : hf.gridRange(x - r, z - r, x + r, z + r);
    let s = 0, c = 0;
    for (let j = g.j0; j <= g.j1; j++) for (let i = g.i0; i <= g.i1; i++) {
      const px = hf.x0 + i * hf.cell, pz = hf.z0 + j * hf.cell;
      if (poly ? !inPoly(poly, px, pz) : Math.hypot(px - x, pz - z) > r) continue;
      s += hf.designed[j * n + i]; c++;
    }
    return c ? s / c + hf.base : this.heightAt(x, z);
  }

  /** Pointer down. Returns true when it used the event. */
  down(w: [number, number], button: number, alt: boolean, n: number): boolean {
    if (readOnly.value) { toast('This map is read-only', 'warn'); return true; }
    const op = this.op;
    if (button === 2 && op === 'level') {
      const h = Math.round(this.heightAt(w[0], w[1]) * 10) / 10;
      settings.value = { ...settings.value, levelHeight: h, levelBalanced: false };
      status.value = `Level height set to ${h} m above sea level`;
      return true;
    }
    if (button === 2 && op !== 'shift') return false; // right-drag pans
    if (op === 'pad' || op === 'pond' || op === 'embank') {
      if (button !== 0) return false;
      this.pts.push(Math.round(w[0] * 10) / 10, Math.round(w[1] * 10) / 10);
      status.value = `${this.pts.length / 2} point${this.pts.length > 2 ? 's' : ''} · Enter to finish · Esc to cancel`;
      return true;
    }
    if (op === 'slope') {
      this.stroke = { id: '', op, last: w, n, sign: 1, start: w };
      return true;
    }
    // brushes
    const sign = op === 'shift' && (button === 2 || alt) ? -1 : 1;
    const o: EarthworkObj = { kind: 'earthwork', id: newId('ew'), op, seq: this.nextSeq(), pts: [], radius: this.radius };
    if (op === 'level') o.height = Math.round((settings.value.levelBalanced ? this.meanHeight(w[0], w[1], this.radius) : settings.value.levelHeight ?? this.heightAt(w[0], w[1])) * 100) / 100;
    o.pts = this.dab(w, sign);
    if (this.E.edit(`Terrain: ${op}`, () => this.E.doc.create(o), 'drag' + n) === undefined && !this.E.doc.get(o.id)) return true;
    this.stroke = { id: o.id, op, last: w, n, sign, start: w };
    return true;
  }

  private dab(w: [number, number], sign: number): number[] {
    const st = settings.value.brushStrength;
    const v = this.op === 'shift' ? sign * st * 0.5 : st * 0.35;
    return [Math.round(w[0] * 10) / 10, Math.round(w[1] * 10) / 10, Math.round(v * 1000) / 1000];
  }

  move(w: [number, number]) {
    this.cursor = w;
    const s = this.stroke;
    if (!s || s.op === 'slope') return;
    const step = Math.max(2, this.radius / 4);
    const d = Math.hypot(w[0] - s.last[0], w[1] - s.last[1]);
    if (d < step) return;
    const o = this.E.doc.get<'earthwork'>(s.id);
    if (!o) return;
    const pts = [...o.pts];
    const k = Math.floor(d / step);
    for (let i = 1; i <= k; i++) {
      const t = (i * step) / d;
      pts.push(...this.dab([s.last[0] + (w[0] - s.last[0]) * t, s.last[1] + (w[1] - s.last[1]) * t], s.sign));
    }
    s.last = [s.last[0] + ((w[0] - s.last[0]) * k * step) / d, s.last[1] + ((w[1] - s.last[1]) * k * step) / d];
    this.E.edit(`Terrain: ${s.op}`, () => this.E.doc.update(s.id, { pts }), 'drag' + s.n);
  }

  /** Pointer up: a slope is made here; a brush stroke is done. */
  up(w: [number, number]) {
    const s = this.stroke;
    this.stroke = null;
    if (!s) return;
    if (s.op === 'slope') {
      if (Math.hypot(w[0] - s.start[0], w[1] - s.start[1]) < 4) return;
      const hA = settings.value.levelHeight ?? this.heightAt(s.start[0], s.start[1]), hB = this.heightAt(w[0], w[1]);
      const o: EarthworkObj = {
        kind: 'earthwork', id: newId('ew'), op: 'slope', seq: this.nextSeq(), radius: this.radius,
        pts: [s.start[0], s.start[1], w[0], w[1]].map((v) => Math.round(v * 10) / 10), heights: [Math.round(hA * 100) / 100, Math.round(hB * 100) / 100],
      };
      this.E.edit('Terrain: slope', () => this.E.doc.create(o));
    }
  }

  /** Enter / double-click: finish a pad, pond or embankment. */
  finish() {
    const P = this.pts;
    this.pts = [];
    const op = this.op;
    const need = op === 'embank' ? 4 : 6;
    if (P.length < need) { status.value = ''; return; }
    const st = settings.value;
    const o: EarthworkObj = { kind: 'earthwork', id: newId('ew'), op, seq: this.nextSeq(), pts: [], radius: this.radius, sideSlope: 0.5 };
    if (op === 'pad') {
      o.pts = P;
      o.height = Math.round((st.levelBalanced || st.levelHeight === null ? this.meanHeight(0, 0, 0, P) : st.levelHeight) * 100) / 100;
    } else if (op === 'pond') {
      o.pts = P;
      let lo = Infinity;
      for (let i = 0; i < P.length; i += 2) lo = Math.min(lo, this.heightAt(P[i], P[i + 1]));
      o.height = Math.round((lo - 0.3) * 100) / 100;
      o.depth = st.pondDepth;
    } else {
      // embankment (offset > 0) or cutting (< 0): the line's ground heights plus the offset, eased along the line
      const hs: number[] = [];
      for (let i = 0; i < P.length; i += 2) hs.push(this.heightAt(P[i], P[i + 1]) + st.embankOffset);
      for (let i = 0; i < P.length; i += 2) o.pts.push(P[i], P[i + 1], Math.round(hs[i / 2] * 100) / 100);
      o.radius = Math.max(1, st.embankWidth / 2);
    }
    const id = o.id;
    if (this.E.edit(`Terrain: ${op}`, () => this.E.doc.create(o)) !== undefined || this.E.doc.get(id)) {
      const v = this.E.terrain.volumeOf(id);
      toast(`${op === 'pad' ? `Pad at ${o.height} m` : op === 'pond' ? `Pond, water at ${o.height} m` : st.embankOffset >= 0 ? 'Embankment' : 'Cutting'} · cut ${fmtVol(v.cut)} · fill ${fmtVol(v.fill)}`, 'ok');
    }
    status.value = this.hint();
  }

  cancel() { this.pts = []; this.stroke = null; }
}

export const fmtVol = (v: number) => (v >= 10000 ? `${(v / 1000).toFixed(1)}k m³` : `${Math.round(v).toLocaleString()} m³`);

function inPoly(p: number[], x: number, z: number) {
  let c = false;
  for (let i = 0, j = p.length / 2 - 1; i < p.length / 2; j = i++) {
    const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
export { BRUSH };
