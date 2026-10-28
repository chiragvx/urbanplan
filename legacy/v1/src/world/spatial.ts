// Uniform grid over road segments for fast "what road is under the cursor".
import { type Tile, type Road, corridorHalf } from './tile';

export class RoadIndex {
  private cell = 40;
  private n: number;
  private cells: number[][];

  constructor(private tile: Tile) {
    this.n = Math.ceil((tile.half * 2) / this.cell) + 1;
    this.cells = Array.from({ length: this.n * this.n }, () => []);
    for (const r of tile.roads) {
      for (let i = 0; i < r.pts.length / 2 - 1; i++) {
        const x0 = r.pts[i * 2], z0 = r.pts[i * 2 + 1], x1 = r.pts[i * 2 + 2], z1 = r.pts[i * 2 + 3];
        const steps = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / (this.cell / 2)) + 1;
        let last = -1;
        for (let k = 0; k <= steps; k++) {
          const t = k / steps;
          const c = this.cellOf(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t);
          if (c >= 0 && c !== last) { this.cells[c].push(r.id * 4096 + i); last = c; }
        }
      }
    }
  }

  private cellOf(x: number, z: number) {
    const i = Math.floor((x + this.tile.half) / this.cell), j = Math.floor((z + this.tile.half) / this.cell);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return -1;
    return j * this.n + i;
  }

  /** Nearest road to (x,z). Returns distance along road `s` and lateral distance. */
  nearest(x: number, z: number, opts: { maxExtra?: number; driveOnly?: boolean } = {}): { road: Road; s: number; d: number } | null {
    const extra = opts.maxExtra ?? 4;
    let best: { road: Road; s: number; d: number } | null = null;
    let bestScore = Infinity;
    const ci = Math.floor((x + this.tile.half) / this.cell), cj = Math.floor((z + this.tile.half) / this.cell);
    const seen = new Set<number>();
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= this.n || j >= this.n) continue;
      for (const key of this.cells[j * this.n + i]) {
        if (seen.has(key)) continue;
        seen.add(key);
        const road = this.tile.roads[Math.floor(key / 4096)];
        if (opts.driveOnly && !road.drive) continue;
        const seg = key % 4096;
        const x0 = road.pts[seg * 2], z0 = road.pts[seg * 2 + 1], x1 = road.pts[seg * 2 + 2], z1 = road.pts[seg * 2 + 3];
        const dx = x1 - x0, dz = z1 - z0;
        const L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - x0) * dx + (z - z0) * dz) / L2));
        const px = x0 + dx * t, pz = z0 + dz * t;
        const d = Math.hypot(x - px, z - pz);
        const half = corridorHalf(road);
        if (d > half + extra) continue;
        const score = d - half * 0.5 + road.clsIndex * 0.3; // prefer the bigger road at overlaps
        if (score < bestScore) {
          bestScore = score;
          best = { road, s: road.cum[seg] + Math.sqrt(L2) * t, d };
        }
      }
    }
    return best;
  }
}
