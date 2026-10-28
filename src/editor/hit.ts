// Spatial index for picking / snapping in world metres: sections (centre line + half widths), junctions,
// lines (utilities, rail, paths) and buildings. Updated per document change.
import type { CityDoc } from '../doc/doc';
import type { Compiler } from '../doc/compile';
import type { Id, Kind } from '../doc/types';
import { anchorsOf } from '../doc/ops';

export interface Pick { kind: Kind; id: Id; d: number; p?: [number, number] }

const CELL = 50;
const key = (i: number, j: number) => i * 100003 + j;

export class HitIndex {
  private cells = new Map<number, Set<Id>>();
  private idCells = new Map<Id, number[]>();

  constructor(readonly doc: CityDoc, readonly C: Compiler) {}

  private bboxOf(id: Id): [number, number, number, number] | null {
    const o = this.doc.get(id);
    if (!o) return null;
    if (o.kind === 'section') { const g = this.C.geo(id); return g ? [g.x0, g.z0, g.x1, g.z1] : null; }
    if (o.kind === 'junction') {
      const r = this.C.junctionRing(id);
      if (!r) return [o.x - 4, o.z - 4, o.x + 4, o.z + 4];
      let x0 = o.x, z0 = o.z, x1 = o.x, z1 = o.z;
      for (const [x, z] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      return [x0, z0, x1, z1];
    }
    const pts = o.kind === 'line' ? o.pts : o.kind === 'building' ? o.outer : null;
    if (!pts || pts.length < 2) return null;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); z0 = Math.min(z0, pts[i + 1]); z1 = Math.max(z1, pts[i + 1]); }
    const pad = o.kind === 'line' ? o.size / 2 + 1 : 0;
    return [x0 - pad, z0 - pad, x1 + pad, z1 + pad];
  }

  private add(id: Id) {
    const b = this.bboxOf(id);
    if (!b) return;
    const ks: number[] = [];
    for (let i = Math.floor(b[0] / CELL); i <= Math.floor(b[2] / CELL); i++) for (let j = Math.floor(b[1] / CELL); j <= Math.floor(b[3] / CELL); j++) {
      const k = key(i, j);
      (this.cells.get(k) ?? this.cells.set(k, new Set()).get(k)!).add(id);
      ks.push(k);
    }
    this.idCells.set(id, ks);
  }

  private remove(id: Id) {
    for (const k of this.idCells.get(id) ?? []) this.cells.get(k)?.delete(id);
    this.idCells.delete(id);
  }

  rebuild() {
    this.cells.clear(); this.idCells.clear();
    for (const k of ['section', 'junction', 'line', 'building'] as Kind[]) for (const id of this.doc.ids(k)) this.add(id);
  }

  update(ids: Iterable<Id>) {
    for (const id of ids) { this.remove(id); this.add(id); }
  }

  /** Candidate ids whose boxes touch a rectangle. */
  query(x0: number, z0: number, x1: number, z1: number): Set<Id> {
    const out = new Set<Id>();
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++)
      for (const id of this.cells.get(key(i, j)) ?? []) out.add(id);
    return out;
  }

  /** Distance from a point to a section's centre line, the nearest point and its half width there. */
  sectionDist(id: Id, x: number, z: number) {
    const g = this.C.geo(id);
    if (!g) return null;
    let best = Infinity, bp: [number, number] = [0, 0], side = 0, bs = 0;
    const P = g.pts;
    for (let i = 0; i + 3 < P.length; i += 2) {
      const ax = P[i], az = P[i + 1], dx = P[i + 2] - ax, dz = P[i + 3] - az;
      const L2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
      if (d < best) { best = d; bp = [px, pz]; side = dx * (z - az) - dz * (x - ax); bs = g.cum[i / 2] + (g.cum[i / 2 + 1] - g.cum[i / 2]) * t; }
    }
    // left of a→b (screen: x east, z south) is the negative cross side
    const hw = side < 0 ? g.t.hwL : g.t.hwR;
    return { d: best, p: bp, hw, left: side < 0, s: bs };
  }

  /**
   * What's under the cursor. `tol` = pick slack in metres. Layers decide what's pickable.
   * Order: junction surfaces, roads, lines, buildings.
   */
  pick(x: number, z: number, tol: number, can: (kind: Kind, layer?: Id) => boolean): Pick | null {
    const cand = this.query(x - tol - 30, z - tol - 30, x + tol + 30, z + tol + 30);
    let best: Pick | null = null;
    const offer = (p: Pick) => { if (!best || p.d < best.d) best = p; };
    for (const id of cand) {
      const o = this.doc.get(id);
      if (!o) continue;
      if (o.kind === 'junction' && can('junction')) {
        const r = this.C.junctionRing(id);
        const dc = Math.hypot(o.x - x, o.z - z);
        // the centre handle wins (small junctions sit inside big junction surfaces), then the surface
        if (dc < tol + 2) offer({ kind: 'junction', id, d: -2000 + dc });
        else if (r && inPoly(r, x, z)) offer({ kind: 'junction', id, d: -1000 + dc });
      } else if (o.kind === 'section' && can('section')) {
        const sd = this.sectionDist(id, x, z);
        if (sd && sd.d <= sd.hw + tol) offer({ kind: 'section', id, d: sd.d - sd.hw, p: sd.p });
      } else if (o.kind === 'line' && can('line', o.layer)) {
        const d = polyDist(o.pts, x, z);
        if (d <= o.size / 2 + tol) offer({ kind: 'line', id, d: d - o.size / 2 + 0.5 });
      } else if (o.kind === 'building' && can('building')) {
        if (inRing(o.outer, x, z)) offer({ kind: 'building', id, d: 5 });
      }
    }
    return best;
  }

  /** Nearest junction centre within r. */
  nearestJunction(x: number, z: number, r: number, exclude?: Set<Id>): { id: Id; d: number } | null {
    let best: { id: Id; d: number } | null = null;
    for (const id of this.query(x - r, z - r, x + r, z + r)) {
      if (exclude?.has(id)) continue;
      const o = this.doc.get(id);
      if (o?.kind !== 'junction') continue;
      const d = Math.hypot(o.x - x, o.z - z);
      if (d <= r && (!best || d < best.d)) best = { id, d };
    }
    return best;
  }

  /** Nearest point on any section centre line within r. */
  nearestSection(x: number, z: number, r: number, exclude?: Set<Id>): { id: Id; d: number; p: [number, number] } | null {
    let best: { id: Id; d: number; p: [number, number] } | null = null;
    for (const id of this.query(x - r, z - r, x + r, z + r)) {
      if (exclude?.has(id) || this.doc.get(id)?.kind !== 'section') continue;
      const sd = this.sectionDist(id, x, z);
      if (sd && sd.d <= r && (!best || sd.d < best.d)) best = { id, d: sd.d, p: sd.p };
    }
    return best;
  }

  /** Ids of a kind whose geometry touches a rectangle (marquee). */
  inRect(x0: number, z0: number, x1: number, z1: number, kinds: Kind[], can: (kind: Kind, layer?: Id) => boolean): Id[] {
    const out: Id[] = [];
    for (const id of this.query(x0, z0, x1, z1)) {
      const o = this.doc.get(id);
      if (!o || !kinds.includes(o.kind)) continue;
      if (!can(o.kind, o.kind === 'line' ? o.layer : undefined)) continue;
      const inside = (x: number, z: number) => x >= x0 && x <= x1 && z >= z0 && z <= z1;
      if (o.kind === 'junction') { if (inside(o.x, o.z)) out.push(id); continue; }
      if (o.kind === 'section') { const P = anchorsOf(this.doc, o); const g = this.C.geo(id); const pts = g ? g.pts : P.flatMap((p) => [p.x, p.z]); for (let i = 0; i < pts.length; i += 2) if (inside(pts[i], pts[i + 1])) { out.push(id); break; } continue; }
      const pts = o.kind === 'line' ? o.pts : o.kind === 'building' ? o.outer : [];
      for (let i = 0; i < pts.length; i += 2) if (inside(pts[i], pts[i + 1])) { out.push(id); break; }
    }
    return out;
  }
}

export function polyDist(pts: number[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], az = pts[i + 1], dx = pts[i + 2] - ax, dz = pts[i + 3] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1e-9)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

export function inRing(r: number[], x: number, z: number) {
  let c = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2], zi = r[i * 2 + 1], xj = r[j * 2], zj = r[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

function inPoly(P: [number, number][], x: number, z: number) {
  let c = false;
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
    const a = P[i], b = P[j];
    if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
