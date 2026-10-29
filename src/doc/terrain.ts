// Terraforming: earthwork objects applied in order on top of the original terrain → the designed ground (hf.designed)
// that roads, buildings and trees sit on. Recomputed only where something changed: a region is reset to the original
// terrain and every earthwork touching it is replayed in `seq` order. Cut / fill volumes are kept as running totals.
import type { CityDoc } from './doc';
import type { Heightfield } from '../geo/heightfield';
import type { EarthworkObj, Id } from './types';

export type Region = [number, number, number, number];

const MARGIN = 60; // m: how far a pad / embankment side slope may reach

/** Brush falloff: 1 at the centre, 0 at the radius (smooth). */
const fall = (d: number, r: number) => (d >= r ? 0 : (1 - (d / r) ** 2) ** 2);

export function earthworkBox(o: EarthworkObj): Region {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const stride = o.op === 'shift' || o.op === 'level' || o.op === 'soften' || o.op === 'restore' || o.op === 'embank' ? 3 : 2;
  for (let i = 0; i + 1 < o.pts.length; i += stride) { x0 = Math.min(x0, o.pts[i]); x1 = Math.max(x1, o.pts[i]); z0 = Math.min(z0, o.pts[i + 1]); z1 = Math.max(z1, o.pts[i + 1]); }
  const pad = o.op === 'pad' || o.op === 'embank' ? o.radius + MARGIN : o.op === 'pond' ? 2 : o.radius + 1;
  return [x0 - pad, z0 - pad, x1 + pad, z1 + pad];
}

const union = (a: Region | null, b: Region | null): Region | null => (!a ? b : !b ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
const overlaps = (a: Region, b: Region) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

function inPoly(p: number[], x: number, z: number) {
  let c = false;
  for (let i = 0, j = p.length / 2 - 1; i < p.length / 2; j = i++) {
    const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
function edgeDist(p: number[], x: number, z: number) {
  let best = Infinity;
  for (let i = 0, j = p.length / 2 - 1; i < p.length / 2; j = i++) {
    const ax = p[j * 2], az = p[j * 2 + 1], dx = p[i * 2] - ax, dz = p[i * 2 + 1] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1e-9)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

export class TerrainCompiler {
  private boxes = new Map<Id, Region>();
  /** running totals over the whole tile (m³): designed ground vs the original */
  cut = 0;
  fill = 0;

  constructor(readonly doc: CityDoc, readonly hf: Heightfield) {}

  has(id: Id) { return this.boxes.has(id); }

  private ops(region: Region): EarthworkObj[] {
    const out: EarthworkObj[] = [];
    for (const [id, b] of this.boxes) if (overlaps(b, region)) { const o = this.doc.get<'earthwork'>(id); if (o) out.push(o); }
    return out.sort((a, b) => a.seq - b.seq || (a.id < b.id ? -1 : 1));
  }

  /** Everything (on load). Returns the region that changed, or null when there's no terraforming. */
  full(): Region | null {
    this.boxes.clear();
    let all: Region | null = null;
    for (const o of this.doc.all('earthwork')) { const b = earthworkBox(o); this.boxes.set(o.id, b); all = union(all, b); }
    this.hf.designed.set(this.hf.ground);
    this.cut = this.fill = 0;
    if (all) this.replay(all);
    return all;
  }

  /** Earthworks changed (created / edited / removed): replay where they were and are. Returns that region. */
  update(ids: Iterable<Id>): Region | null {
    let dirty: Region | null = null;
    for (const id of ids) {
      dirty = union(dirty, this.boxes.get(id) ?? null);
      const o = this.doc.get<'earthwork'>(id);
      if (o) { const b = earthworkBox(o); this.boxes.set(id, b); dirty = union(dirty, b); } else this.boxes.delete(id);
    }
    if (dirty) this.replay(dirty);
    return dirty;
  }

  /** Reset a region to the original terrain and apply every earthwork touching it in order. */
  replay(region: Region) {
    const hf = this.hf, n = hf.n;
    const g = hf.gridRange(...region);
    const D = hf.designed, G = hf.ground, A = hf.cell * hf.cell;
    for (let j = g.j0; j <= g.j1; j++) for (let i = g.i0; i <= g.i1; i++) {
      const k = j * n + i, d = D[k] - G[k];
      if (d > 0) this.fill -= d * A; else this.cut += d * A;
      D[k] = G[k];
    }
    for (const o of this.ops(region)) this.apply(o, D, g);
    for (let j = g.j0; j <= g.j1; j++) for (let i = g.i0; i <= g.i1; i++) {
      const k = j * n + i, d = D[k] - G[k];
      if (d > 0) this.fill += d * A; else this.cut -= d * A;
    }
    if (this.cut < 1e-6) this.cut = 0;
    if (this.fill < 1e-6) this.fill = 0;
  }

  /** Cut / fill of one earthwork (m³): the designed ground with and without it, over its footprint. */
  volumeOf(id: Id): { cut: number; fill: number } {
    const o = this.doc.get<'earthwork'>(id);
    const b = this.boxes.get(id);
    if (!o || !b) return { cut: 0, fill: 0 };
    const hf = this.hf, n = hf.n, g = hf.gridRange(...b);
    const w = g.i1 - g.i0 + 1, h = g.j1 - g.j0 + 1;
    const sub = new Float32Array(n * n);
    // replay everything before it, then compare with it applied
    for (let j = g.j0; j <= g.j1; j++) for (let i = g.i0; i <= g.i1; i++) sub[j * n + i] = hf.ground[j * n + i];
    for (const p of this.ops(b)) { if (p.seq > o.seq || (p.seq === o.seq && p.id >= o.id)) break; this.apply(p, sub, g); }
    const before = new Float32Array(w * h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) before[j * w + i] = sub[(j + g.j0) * n + i + g.i0];
    this.apply(o, sub, g);
    let cut = 0, fill = 0;
    const A = hf.cell * hf.cell;
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const d = sub[(j + g.j0) * n + i + g.i0] - before[j * w + i]; if (d > 0) fill += d * A; else cut -= d * A; }
    return { cut, fill };
  }

  /** Apply one earthwork to grid `D` within the index range. */
  apply(o: EarthworkObj, D: Float32Array, g: { i0: number; j0: number; i1: number; j1: number }) {
    const hf = this.hf, n = hf.n, cell = hf.cell, half = hf.half, base = hf.base;
    const X = (i: number) => -half + i * cell, Z = (j: number) => -half + j * cell;
    const r = Math.max(1, o.radius);
    const each = (x: number, z: number, rad: number, f: (k: number, d: number) => void) => {
      const i0 = Math.max(g.i0, Math.floor((x - rad + half) / cell)), i1 = Math.min(g.i1, Math.ceil((x + rad + half) / cell));
      const j0 = Math.max(g.j0, Math.floor((z - rad + half) / cell)), j1 = Math.min(g.j1, Math.ceil((z + rad + half) / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const d = Math.hypot(X(i) - x, Z(j) - z); if (d < rad) f(j * n + i, d); }
    };
    const P = o.pts;
    switch (o.op) {
      case 'shift':
        for (let q = 0; q + 2 < P.length; q += 3) each(P[q], P[q + 1], r, (k, d) => { D[k] += P[q + 2] * fall(d, r); });
        break;
      case 'level': {
        const t = (o.height ?? 0) - base;
        for (let q = 0; q + 2 < P.length; q += 3) each(P[q], P[q + 1], r, (k, d) => { D[k] += (t - D[k]) * P[q + 2] * fall(d, r); });
        break;
      }
      case 'restore':
        for (let q = 0; q + 2 < P.length; q += 3) each(P[q], P[q + 1], r, (k, d) => { D[k] += (hf.ground[k] - D[k]) * P[q + 2] * fall(d, r); });
        break;
      case 'soften':
        for (let q = 0; q + 2 < P.length; q += 3) {
          const upd: [number, number][] = [];
          each(P[q], P[q + 1], r, (k, d) => {
            const i = k % n, j = (k - i) / n;
            let s = 0, c = 0;
            for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < n && jj < n) { s += D[jj * n + ii]; c++; } }
            upd.push([k, D[k] + (s / c - D[k]) * P[q + 2] * fall(d, r)]);
          });
          for (const [k, v] of upd) D[k] = v;
        }
        break;
      case 'slope': {
        if (P.length < 4 || !o.heights) break;
        const [ax, az, bx, bz] = P, dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
        const ha = o.heights[0] - base, hb = o.heights[1] - base;
        const L = Math.sqrt(L2);
        each((ax + bx) / 2, (az + bz) / 2, L / 2 + r, (k, _d) => {
          const i = k % n, j = (k - i) / n, x = X(i), z = Z(j);
          const t = ((x - ax) * dx + (z - az) * dz) / L2;
          if (t < -r / L || t > 1 + r / L) return;
          const tc = Math.max(0, Math.min(1, t));
          const lat = Math.abs((x - ax) * dz - (z - az) * dx) / L;
          const along = t < 0 ? -t * L : t > 1 ? (t - 1) * L : 0;
          const w = fall(Math.hypot(Math.max(0, lat - r * 0.5), along), r * 0.6);
          D[k] += (ha + (hb - ha) * tc - D[k]) * w;
        });
        break;
      }
      case 'pad': {
        if (P.length < 6) break;
        const H = (o.height ?? 0) - base, s = o.sideSlope ?? 0.5;
        let cx = 0, cz = 0, rad = 0;
        for (let q = 0; q < P.length; q += 2) { cx += P[q]; cz += P[q + 1]; }
        cx /= P.length / 2; cz /= P.length / 2;
        for (let q = 0; q < P.length; q += 2) rad = Math.max(rad, Math.hypot(P[q] - cx, P[q + 1] - cz));
        each(cx, cz, rad + MARGIN, (k) => {
          const i = k % n, j = (k - i) / n, x = X(i), z = Z(j);
          if (inPoly(P, x, z)) { D[k] = H; return; }
          const e = edgeDist(P, x, z);
          if (e < MARGIN) D[k] = Math.min(Math.max(D[k], H - e * s), H + e * s);
        });
        break;
      }
      case 'embank': {
        if (P.length < 6) break;
        const s = o.sideSlope ?? 0.5, hw = r;
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (let q = 0; q < P.length; q += 3) { x0 = Math.min(x0, P[q]); x1 = Math.max(x1, P[q]); z0 = Math.min(z0, P[q + 1]); z1 = Math.max(z1, P[q + 1]); }
        each((x0 + x1) / 2, (z0 + z1) / 2, Math.hypot(x1 - x0, z1 - z0) / 2 + hw + MARGIN, (k) => {
          const i = k % n, j = (k - i) / n, x = X(i), z = Z(j);
          let bd = Infinity, bh = 0;
          for (let q = 0; q + 5 < P.length; q += 3) {
            const ax = P[q], az = P[q + 1], dx = P[q + 3] - ax, dz = P[q + 4] - az;
            const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1e-9)));
            const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
            if (d < bd) { bd = d; bh = P[q + 2] + (P[q + 5] - P[q + 2]) * t - base; }
          }
          if (bd <= hw) D[k] = bh;
          else if (bd < hw + MARGIN) { const e = bd - hw; D[k] = Math.min(Math.max(D[k], bh - e * s), bh + e * s); }
        });
        break;
      }
      case 'pond': {
        if (P.length < 6) break;
        const W = (o.height ?? 0) - base, bed = W - (o.depth ?? 2), s = o.sideSlope ?? 0.5;
        let cx = 0, cz = 0, rad = 0;
        for (let q = 0; q < P.length; q += 2) { cx += P[q]; cz += P[q + 1]; }
        cx /= P.length / 2; cz /= P.length / 2;
        for (let q = 0; q < P.length; q += 2) rad = Math.max(rad, Math.hypot(P[q] - cx, P[q + 1] - cz));
        each(cx, cz, rad + 1, (k) => {
          const i = k % n, j = (k - i) / n, x = X(i), z = Z(j);
          if (!inPoly(P, x, z)) return;
          // banks from just above the water at the edge down to the bed
          const t = Math.max(bed, W + 0.3 - edgeDist(P, x, z) * s);
          D[k] = Math.min(D[k], t);
        });
        break;
      }
    }
  }

  /**
   * Low spots the terraforming made where water would pool: cells in the earthworks' areas lying more than
   * `minDepth` below the lowest way out of their neighbourhood (priority flood within the region).
   */
  pits(minDepth = 0.5): { x: number; z: number; depth: number; area: number; region: Region }[] {
    const out: { x: number; z: number; depth: number; area: number; region: Region }[] = [];
    const hf = this.hf, n = hf.n, cell = hf.cell, half = hf.half;
    const regions: Region[] = [];
    for (const b of this.boxes.values()) {
      const e: Region = [b[0] - 40, b[1] - 40, b[2] + 40, b[3] + 40];
      const hit = regions.findIndex((r) => overlaps(r, e));
      if (hit >= 0) regions[hit] = union(regions[hit], e)!; else regions.push(e);
    }
    for (const r of regions) {
      const g = hf.gridRange(...r);
      const w = g.i1 - g.i0 + 1, h = g.j1 - g.j0 + 1;
      if (w < 3 || h < 3 || w * h > 250000) continue;
      const S = hf.surface, fill = new Float32Array(w * h).fill(Infinity);
      // priority flood from the border: water level = the lowest way out
      const heap: number[] = [];
      const push = (k: number) => { heap.push(k); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (fill[heap[p]] <= fill[heap[c]]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
      const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let c = 0; for (;;) { const l = 2 * c + 1, rr = l + 1; let m = c; if (l < heap.length && fill[heap[l]] < fill[heap[m]]) m = l; if (rr < heap.length && fill[heap[rr]] < fill[heap[m]]) m = rr; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top; };
      const at = (i: number, j: number) => S[(j + g.j0) * n + i + g.i0];
      for (let i = 0; i < w; i++) for (const j of [0, h - 1]) { fill[j * w + i] = at(i, j); push(j * w + i); }
      for (let j = 1; j < h - 1; j++) for (const i of [0, w - 1]) { fill[j * w + i] = at(i, j); push(j * w + i); }
      while (heap.length) {
        const k = pop(), i = k % w, j = (k - i) / w;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ii = i + di, jj = j + dj;
          if (ii < 0 || jj < 0 || ii >= w || jj >= h) continue;
          const q = jj * w + ii;
          if (fill[q] !== Infinity) continue;
          fill[q] = Math.max(at(ii, jj), fill[k]);
          push(q);
        }
      }
      // group pooled cells
      const seen = new Uint8Array(w * h);
      for (let k = 0; k < w * h; k++) {
        const i0 = k % w, j0 = (k - i0) / w;
        if (seen[k] || fill[k] - at(i0, j0) < 0.05) continue;
        const comp = [k]; seen[k] = 1;
        let deepest = 0, dx = 0, dz = 0;
        for (let c = 0; c < comp.length; c++) {
          const q = comp[c], i = q % w, j = (q - i) / w, d = fill[q] - at(i, j);
          if (d > deepest) { deepest = d; dx = -half + (i + g.i0) * cell; dz = -half + (j + g.j0) * cell; }
          for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const ii = i + di, jj = j + dj, p = jj * w + ii;
            if (ii < 0 || jj < 0 || ii >= w || jj >= h || seen[p] || fill[p] - at(ii, jj) < 0.05) continue;
            seen[p] = 1; comp.push(p);
          }
        }
        if (deepest >= minDepth && comp.length * cell * cell >= 128) out.push({ x: dx, z: dz, depth: deepest, area: comp.length * cell * cell, region: r });
      }
    }
    return out;
  }
}
