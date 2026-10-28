// 2 m raster of the road footprint, stamped by walking each smooth centre line once.
// Constant-time "is there a road here / which one" for terrain carving, building conflicts, trees and picking.
import type { StreetNet } from './streets';

export class RoadRaster {
  readonly cell = 2;
  readonly n: number;
  /** >0: road id + 1 · <0: −(junction id + 1) · 0: nothing */
  readonly code: Int32Array;

  constructor(readonly half: number) {
    this.n = Math.ceil((half * 2) / this.cell) + 1;
    this.code = new Int32Array(this.n * this.n);
  }

  private idx(x: number, z: number) {
    const i = Math.floor((x + this.half) / this.cell), j = Math.floor((z + this.half) / this.cell);
    return i < 0 || j < 0 || i >= this.n || j >= this.n ? -1 : j * this.n + i;
  }

  at(x: number, z: number): number { const k = this.idx(x, z); return k < 0 ? 0 : this.code[k]; }
  onRoad(x: number, z: number): boolean { return this.at(x, z) !== 0; }

  /** Disc stamps every metre along the centre line, radius = half the road width. */
  stampRoad(center: Float32Array, halfWidth: number, code: number) {
    const n = center.length / 2, c = this.cell, h = this.half;
    const r = halfWidth, r2 = r * r;
    for (let i = 0; i < n - 1; i++) {
      const ax = center[i * 2], az = center[i * 2 + 1], bx = center[i * 2 + 2], bz = center[i * 2 + 3];
      const L = Math.hypot(bx - ax, bz - az);
      const steps = Math.max(1, Math.ceil(L));
      for (let s = 0; s <= steps; s++) {
        const t = s / steps, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        const i0 = Math.max(0, Math.floor((x - r + h) / c)), i1 = Math.min(this.n - 1, Math.floor((x + r + h) / c));
        const j0 = Math.max(0, Math.floor((z - r + h) / c)), j1 = Math.min(this.n - 1, Math.floor((z + r + h) / c));
        for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++) {
          const cx = -h + (ii + 0.5) * c - x, cz = -h + (jj + 0.5) * c - z;
          if (cx * cx + cz * cz <= r2) this.code[jj * this.n + ii] = code;
        }
      }
    }
  }

  /** Scanline fill of a (small) polygon such as a junction. */
  stampPolygon(ring: Float32Array, code: number) {
    const c = this.cell, h = this.half, m = ring.length / 2;
    let z0 = Infinity, z1 = -Infinity;
    for (let i = 1; i < ring.length; i += 2) { z0 = Math.min(z0, ring[i]); z1 = Math.max(z1, ring[i]); }
    const j0 = Math.max(0, Math.floor((z0 + h) / c)), j1 = Math.min(this.n - 1, Math.floor((z1 + h) / c));
    for (let j = j0; j <= j1; j++) {
      const z = -h + (j + 0.5) * c;
      const xs: number[] = [];
      for (let a = 0; a < m; a++) {
        const b = (a + 1) % m, az = ring[a * 2 + 1], bz = ring[b * 2 + 1];
        if ((az > z) !== (bz > z)) xs.push(ring[a * 2] + ((z - az) / (bz - az)) * (ring[b * 2] - ring[a * 2]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.floor((xs[k] + h) / c)), i1 = Math.min(this.n - 1, Math.floor((xs[k + 1] + h) / c));
        for (let i = i0; i <= i1; i++) this.code[j * this.n + i] = code;
      }
    }
  }

  static fromNetwork(net: StreetNet, half: number): RoadRaster {
    const R = new RoadRaster(half);
    for (const r of net.roads.values()) {
      const w = r.lanes.reduce((s, l) => s + l.width, 0);
      if (r.center.length >= 4 && w > 0) R.stampRoad(r.center, w / 2, r.id + 1);
    }
    for (const it of net.intersections.values()) if (it.poly.length >= 6) R.stampPolygon(it.poly, -(it.id + 1));
    return R;
  }
}
