// Terrain heightfield on a regular grid (x east, z south, metres from tile centre). Heights are absolute
// metres above sea level; `base` is subtracted for rendering so the scene sits near y=0.
export class Heightfield {
  readonly n: number;
  readonly cell: number;
  readonly half: number;
  /** Original smoothed terrain (with river carved). Never modified after load. */
  readonly ground: Float32Array;
  /** The ground after terraforming (earthworks, src/doc/terrain.ts) — what roads sit on. Equals `ground` until edited. */
  readonly designed: Float32Array;
  /** Terrain after road carving — what gets rendered. */
  readonly surface: Float32Array;
  readonly base: number;

  constructor(n: number, cell: number, heights: Float32Array) {
    this.n = n;
    this.cell = cell;
    this.half = ((n - 1) * cell) / 2;
    let min = Infinity;
    for (const h of heights) if (h < min) min = h;
    this.base = Math.floor(min) - 2;
    this.ground = Float32Array.from(heights, (h) => h - this.base);
    this.designed = Float32Array.from(this.ground);
    this.surface = Float32Array.from(this.ground);
  }

  /** Bilinear sample of a grid (default: the designed ground, i.e. after terraforming). */
  sample(x: number, z: number, grid: Float32Array = this.designed): number {
    const n = this.n;
    let fx = (x + this.half) / this.cell, fz = (z + this.half) / this.cell;
    fx = Math.min(Math.max(fx, 0), n - 1.0001);
    fz = Math.min(Math.max(fz, 0), n - 1.0001);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const a = grid[j * n + i], b = grid[j * n + i + 1], c = grid[(j + 1) * n + i], d = grid[(j + 1) * n + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  }

  /** Sample of the rendered surface, matching the triangle split used by the terrain mesh. */
  sampleSurface(x: number, z: number): number {
    const n = this.n, g = this.surface;
    let fx = (x + this.half) / this.cell, fz = (z + this.half) / this.cell;
    fx = Math.min(Math.max(fx, 0), n - 1.0001);
    fz = Math.min(Math.max(fz, 0), n - 1.0001);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const a = g[j * n + i], b = g[j * n + i + 1], c = g[(j + 1) * n + i], d = g[(j + 1) * n + i + 1];
    // triangles (a,c,b) and (b,c,d) — same diagonal as buildTerrainGeometry
    return tx + tz <= 1 ? a + (b - a) * tx + (c - a) * tz : d + (c - d) * (1 - tx) + (b - d) * (1 - tz);
  }

  /**
   * Carve/fill the surface to sit just under road surfaces.
   * `targets` holds, per grid vertex, the desired terrain height (NaN = no road there).
   * Neighbouring terrain is blended with a 1:2 cut/fill slope so there are no cliffs.
   */
  conform(targets: Float32Array, slope = 0.5, radiusCells = 3) {
    this.conformRegion(targets, 0, 0, this.n - 1, this.n - 1, slope, radiusCells);
  }

  /** Grid index range [i0..i1] × [j0..j1] covering a metric region (clamped to the grid). */
  gridRange(x0: number, z0: number, x1: number, z1: number) {
    const c = this.cell, h = this.half, n = this.n;
    return {
      i0: Math.max(0, Math.floor((x0 + h) / c)), j0: Math.max(0, Math.floor((z0 + h) / c)),
      i1: Math.min(n - 1, Math.ceil((x1 + h) / c)), j1: Math.min(n - 1, Math.ceil((z1 + h) / c)),
    };
  }

  /** `conform`, limited to grid vertices [i0..i1] × [j0..j1] (targets outside are still read for the slopes). */
  conformRegion(targets: Float32Array, i0: number, j0: number, i1: number, j1: number, slope = 0.5, radiusCells = 3) {
    const n = this.n, cell = this.cell;
    const out = this.surface;
    const offs: [number, number, number][] = [];
    for (let dj = -radiusCells; dj <= radiusCells; dj++) for (let di = -radiusCells; di <= radiusCells; di++) {
      const d = Math.hypot(di, dj) * cell;
      if (d <= radiusCells * cell + 1e-6) offs.push([di, dj, d * slope]);
    }
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * n + i;
      const t = targets[k];
      if (!Number.isNaN(t)) { out[k] = t; continue; }
      let lo = -Infinity, hi = Infinity;
      for (const [di, dj, rise] of offs) {
        const ii = i + di, jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
        const tt = targets[jj * n + ii];
        if (Number.isNaN(tt)) continue;
        if (tt + rise < hi) hi = tt + rise; // can't be higher than the cut slope
        if (tt - rise > lo) lo = tt - rise; // can't be lower than the fill slope
      }
      const g = this.designed[k];
      out[k] = Math.min(Math.max(g, lo), hi);
    }
  }
}
