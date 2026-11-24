// The building blocks every landscape texture is drawn from (./surfaces.ts): a seeded random, tileable value noise and
// fractal noise, a tileable Voronoi (cells, their edges), and a Field: a square of colour, height and roughness that a
// recipe paints into and ./material.ts turns into the colour, normal and roughness maps. All of it wraps at the
// edges, so a tile repeats without a seam. Pure: no DOM, testable in node.

/** a seeded random in [0, 1), the same sequence for the same seed */
export function rng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
/** a seed from a word */
export const seedOf = (w: string) => w.split('').reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7);

const smooth = (t: number) => t * t * (3 - 2 * t);

/** value noise that wraps with period `p` lattice cells over u, v in [0, 1): `noise(u, v)` in [0, 1] */
export function valueNoise(p: number, seed: number): (u: number, v: number) => number {
  const R = rng(seed), g = new Float32Array(p * p);
  for (let i = 0; i < g.length; i++) g[i] = R();
  return (u, v) => {
    const x = u * p, y = v * p, xi = Math.floor(x), yi = Math.floor(y), fx = smooth(x - xi), fy = smooth(y - yi);
    const x0 = ((xi % p) + p) % p, y0 = ((yi % p) + p) % p, x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
    const a = g[y0 * p + x0], b = g[y0 * p + x1], c = g[y1 * p + x0], d = g[y1 * p + x1];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
}

/** fractal noise: `oct` octaves of value noise from period `p`, each twice as fine and `gain` as strong; in [0, 1] */
export function fbm(p: number, oct: number, seed: number, gain = 0.5): (u: number, v: number) => number {
  const layers = Array.from({ length: oct }, (_, k) => valueNoise(p << k, seed + k * 101));
  let norm = 0; for (let k = 0; k < oct; k++) norm += gain ** k;
  return (u, v) => { let s = 0; for (let k = 0; k < oct; k++) s += layers[k](u, v) * gain ** k; return s / norm; };
}

/** a tileable Voronoi of `n` cells: for (u, v) the nearest cell's index, the distance to it and to the edge between
 *  it and the next nearest (all in tile units) */
export function voronoi(n: number, seed: number, jitter = 1): (u: number, v: number) => { id: number; d: number; edge: number } {
  const R = rng(seed), side = Math.max(1, Math.round(Math.sqrt(n))), P: [number, number][] = [];
  // (jittered on a grid, so the cells come out even in size and the search stays local)
  for (let j = 0; j < side; j++) for (let i = 0; i < side; i++) P.push([(i + 0.5 + (R() - 0.5) * jitter) / side, (j + 0.5 + (R() - 0.5) * jitter) / side]);
  return (u, v) => {
    const ci = Math.floor(u * side), cj = Math.floor(v * side);
    let d1 = Infinity, d2 = Infinity, id = 0, a1x = 0, a1y = 0;
    const near: [number, number][] = [];
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const ii = ((ci + di) % side + side) % side, jj = ((cj + dj) % side + side) % side, k = jj * side + ii;
      // (the point's copy nearest this cell, across the wrap)
      const px = P[k][0] + Math.floor((ci + di) / side), py = P[k][1] + Math.floor((cj + dj) / side);
      const d = Math.hypot(px - u, py - v);
      near.push([px, py]);
      if (d < d1) { d2 = d1; d1 = d; id = k; a1x = px; a1y = py; } else if (d < d2) d2 = d;
    }
    // (the distance to the bisector with the nearest other point: a true edge distance, so joints come out even)
    let edge = Infinity;
    for (const [bx, by] of near) {
      if (bx === a1x && by === a1y) continue;
      const mx = (a1x + bx) / 2, my = (a1y + by) / 2, nx = bx - a1x, ny = by - a1y, L = Math.hypot(nx, ny) || 1;
      edge = Math.min(edge, ((mx - u) * nx + (my - v) * ny) / L);
    }
    return { id, d: d1, edge: Math.max(0, edge) };
  };
}

export type RGB = [number, number, number];
/** a colour from #rrggbb, components 0…1 (sRGB) */
export function rgb(hex: string): RGB { const n = parseInt(hex.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
export const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const scale = (a: RGB, k: number): RGB => [a[0] * k, a[1] * k, a[2] * k];
export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** an n × n square of colour (sRGB 0…1), height (0 the deepest, 1 the top) and roughness, wrapping at its edges */
export class Field {
  readonly col: Float32Array; readonly h: Float32Array; readonly r: Float32Array;
  constructor(readonly n: number, rough = 0.9) {
    this.col = new Float32Array(n * n * 3); this.h = new Float32Array(n * n).fill(0.5); this.r = new Float32Array(n * n).fill(rough);
  }
  /** every pixel: `f(u, v, i)` with u, v in [0, 1) and i its index */
  each(f: (u: number, v: number, i: number) => void) { const n = this.n; for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) f((x + 0.5) / n, (y + 0.5) / n, y * n + x); }
  set(i: number, c: RGB) { this.col[i * 3] = c[0]; this.col[i * 3 + 1] = c[1]; this.col[i * 3 + 2] = c[2]; }
  get(i: number): RGB { return [this.col[i * 3], this.col[i * 3 + 1], this.col[i * 3 + 2]]; }
  /** the pixel index at (u, v), wrapped */
  at(u: number, v: number) { const n = this.n, x = ((Math.floor(u * n) % n) + n) % n, y = ((Math.floor(v * n) % n) + n) % n; return y * n + x; }
  /** a stamp: for each pixel within radius `r` (tile units) of (u, v), across the wrap, `f(i, d)` with d 0 at the
   *  centre and 1 at the rim; `sy` squashes it along v, `a` turns it */
  stamp(u: number, v: number, r: number, f: (i: number, d: number) => void, sy = 1, a = 0) {
    const n = this.n, rr = Math.ceil(r * n * Math.max(1, sy)) + 1, cx = u * n, cy = v * n, ca = Math.cos(a), sa = Math.sin(a);
    for (let dy = -rr; dy <= rr; dy++) for (let dx = -rr; dx <= rr; dx++) {
      const px = Math.floor(cx) + dx, py = Math.floor(cy) + dy, ox = (px + 0.5 - cx) / n, oy = (py + 0.5 - cy) / n;
      const lx = ox * ca + oy * sa, ly = (-ox * sa + oy * ca) / sy, d = Math.hypot(lx, ly) / r;
      if (d >= 1) continue;
      f((((py % n) + n) % n) * n + (((px % n) + n) % n), d);
    }
  }
}
