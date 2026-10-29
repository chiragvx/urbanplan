// Terrain view over the plan: heights as colour with hill shading and contour lines, or cut / fill against the
// original ground. One pixel per terrain cell (626 × 626), redrawn only where the terrain changed; contours traced
// per 40-cell chunk (marching squares) and cached until that chunk changes.
import type { Editor } from './editor';

const CHUNK = 40;

export class TerrainView {
  private canvas: HTMLCanvasElement;
  private img: ImageData;
  private version = -1;
  private show: 'height' | 'cutfill' | '' = '';
  private lo = 0;
  private hi = 1;
  private contours = new Map<string, Path2D>();
  private surfaceSnap: Float32Array;

  constructor(readonly E: Editor) {
    const n = E.hf.n;
    this.canvas = document.createElement('canvas');
    this.canvas.width = n; this.canvas.height = n;
    this.img = this.canvas.getContext('2d')!.createImageData(n, n);
    this.surfaceSnap = new Float32Array(n * n).fill(NaN);
    // colour range from the original ground (2nd–98th percentile), so edits don't shift every colour
    const s = [...E.hf.ground].filter((_, i) => i % 7 === 0).sort((a, b) => a - b);
    this.lo = s[Math.floor(s.length * 0.02)];
    this.hi = Math.max(this.lo + 5, s[Math.floor(s.length * 0.98)]);
  }

  /** Recolour cells whose surface changed since the last draw (all of them when the mode changed). */
  private refresh(show: 'height' | 'cutfill') {
    if (show === this.show && this.version === this.E.world.terrainRev) return;
    this.version = this.E.world.terrainRev;
    const hf = this.E.hf, n = hf.n, S = hf.surface, G = hf.ground, px = this.img.data;
    const all = show !== this.show;
    this.show = show;
    let i0 = n, j0 = n, i1 = -1, j1 = -1;
    for (let k = 0; k < n * n; k++) {
      if (!all && S[k] === this.surfaceSnap[k]) continue;
      this.surfaceSnap[k] = S[k];
      const i = k % n, j = (k - i) / n;
      if (i < i0) i0 = i; if (i > i1) i1 = i; if (j < j0) j0 = j; if (j > j1) j1 = j;
    }
    if (i1 < 0) return;
    // a changed cell changes its neighbours' shading too
    i0 = Math.max(0, i0 - 1); j0 = Math.max(0, j0 - 1); i1 = Math.min(n - 1, i1 + 1); j1 = Math.min(n - 1, j1 + 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * n + i, o = k * 4;
      if (show === 'cutfill') {
        // earthworks, plus a road's own cut / fill where it's more than its usual 0.3 m bed (graded roads)
        const Dk = hf.designed[k], d = (Math.abs(S[k] - Dk) > 0.5 ? S[k] : Dk) - G[k];
        const a = Math.min(1, Math.abs(d) / 3);
        if (Math.abs(d) < 0.05) { px[o + 3] = 0; continue; }
        if (d > 0) { px[o] = 37; px[o + 1] = 99; px[o + 2] = 235; } else { px[o] = 220; px[o + 1] = 38; px[o + 2] = 38; }
        px[o + 3] = Math.round(70 + 170 * a);
        continue;
      }
      // hypsometric tint × hill shade (light from the north-west)
      const t = Math.max(0, Math.min(1, (S[k] - this.lo) / (this.hi - this.lo)));
      const c = ramp(t);
      const hl = S[j * n + Math.max(0, i - 1)], hr = S[j * n + Math.min(n - 1, i + 1)], hu = S[Math.max(0, j - 1) * n + i], hd = S[Math.min(n - 1, j + 1) * n + i];
      const nx = (hl - hr) * 3, nz = (hu - hd) * 3, ny = 2 * hf.cell, L = Math.hypot(nx, ny, nz);
      const shade = Math.max(0.55, Math.min(1.15, 0.75 + 0.6 * ((nx * -0.6 + ny * 0.7 + nz * -0.4) / L - 0.7)));
      px[o] = Math.min(255, c[0] * shade); px[o + 1] = Math.min(255, c[1] * shade); px[o + 2] = Math.min(255, c[2] * shade); px[o + 3] = 255;
    }
    this.canvas.getContext('2d')!.putImageData(this.img, 0, 0, i0, j0, i1 - i0 + 1, j1 - j0 + 1);
    // contours of chunks in the changed range are stale
    for (const key of [...this.contours.keys()]) {
      const [ci, cj] = key.split(':').map(Number);
      if (ci * CHUNK <= i1 && (ci + 1) * CHUNK >= i0 && cj * CHUNK <= j1 && (cj + 1) * CHUNK >= j0) this.contours.delete(key);
    }
  }

  /** Contours of one chunk at an interval, in world metres. */
  private chunkContours(ci: number, cj: number, step: number): Path2D {
    const key = `${ci}:${cj}:${step}`;
    let p = this.contours.get(key);
    if (p) return p;
    p = new Path2D();
    const hf = this.E.hf, n = hf.n, S = hf.surface, cell = hf.cell, half = hf.half, base = hf.base;
    const X = (i: number) => -half + i * cell, Z = (j: number) => -half + j * cell;
    const i0 = ci * CHUNK, j0 = cj * CHUNK, i1 = Math.min(n - 1, i0 + CHUNK), j1 = Math.min(n - 1, j0 + CHUNK);
    for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) {
      // contour levels are in metres above sea level
      const a = S[j * n + i] + base, b = S[j * n + i + 1] + base, c = S[(j + 1) * n + i + 1] + base, d = S[(j + 1) * n + i] + base;
      const lo = Math.min(a, b, c, d), hiv = Math.max(a, b, c, d);
      for (let lv = Math.ceil(lo / step) * step; lv <= hiv; lv += step) {
        const pts: [number, number][] = [];
        const edge = (h0: number, h1: number, x0: number, z0: number, x1: number, z1: number) => {
          if ((h0 < lv) === (h1 < lv) || h0 === h1) return;
          const t = (lv - h0) / (h1 - h0);
          pts.push([x0 + (x1 - x0) * t, z0 + (z1 - z0) * t]);
        };
        edge(a, b, X(i), Z(j), X(i + 1), Z(j));
        edge(b, c, X(i + 1), Z(j), X(i + 1), Z(j + 1));
        edge(c, d, X(i + 1), Z(j + 1), X(i), Z(j + 1));
        edge(d, a, X(i), Z(j + 1), X(i), Z(j));
        for (let q = 0; q + 1 < pts.length; q += 2) { p.moveTo(pts[q][0], pts[q][1]); p.lineTo(pts[q + 1][0], pts[q + 1][1]); }
      }
    }
    this.contours.set(key, p);
    return p;
  }

  draw(show: 'height' | 'cutfill') {
    const E = this.E, ctx = E.ctx, v = E.view, hf = E.hf;
    this.refresh(show);
    const half = hf.half + hf.cell / 2;
    const a = v.toScreen(-half, -half), b = v.toScreen(half, half);
    ctx.save();
    ctx.globalAlpha = show === 'height' ? 0.72 : 0.85;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.canvas, a[0], a[1], b[0] - a[0], b[1] - a[1]);
    ctx.globalAlpha = 1;
    // contours: finer as you zoom in; every 5th a little bolder
    const s = v.scale;
    const step = s > 2 ? 0.5 : s > 0.8 ? 1 : s > 0.3 ? 2 : 5;
    const [x0, z0, x1, z1] = v.rect;
    const n = hf.n, cs = CHUNK * hf.cell;
    ctx.setTransform(s * devicePixelRatioOf(ctx), 0, 0, s * devicePixelRatioOf(ctx), (v.w / 2 - v.cx * s) * devicePixelRatioOf(ctx), (v.h / 2 - v.cz * s) * devicePixelRatioOf(ctx));
    ctx.lineWidth = 0.9 / s;
    ctx.strokeStyle = show === 'height' ? 'rgba(70,50,30,0.55)' : 'rgba(40,40,40,0.35)';
    const ci0 = Math.max(0, Math.floor((x0 + hf.half) / cs)), ci1 = Math.min(Math.floor((n - 1) / CHUNK), Math.floor((x1 + hf.half) / cs));
    const cj0 = Math.max(0, Math.floor((z0 + hf.half) / cs)), cj1 = Math.min(Math.floor((n - 1) / CHUNK), Math.floor((z1 + hf.half) / cs));
    if ((ci1 - ci0 + 1) * (cj1 - cj0 + 1) <= 260) for (let cj = cj0; cj <= cj1; cj++) for (let ci = ci0; ci <= ci1; ci++) ctx.stroke(this.chunkContours(ci, cj, step));
    ctx.restore();
  }
}

const devicePixelRatioOf = (_ctx: CanvasRenderingContext2D) => window.devicePixelRatio || 1;

/** Low green → yellow → tan → brown → light (relative height 0–1). */
function ramp(t: number): [number, number, number] {
  const stops: [number, [number, number, number]][] = [[0, [96, 160, 104]], [0.3, [178, 204, 120]], [0.55, [230, 214, 140]], [0.78, [206, 160, 104]], [1, [236, 224, 214]]];
  for (let i = 1; i < stops.length; i++) if (t <= stops[i][0]) {
    const [t0, c0] = stops[i - 1], [t1, c1] = stops[i], f = (t - t0) / (t1 - t0);
    return [c0[0] + (c1[0] - c0[0]) * f, c0[1] + (c1[1] - c0[1]) * f, c0[2] + (c1[2] - c0[2]) * f];
  }
  return stops[stops.length - 1][1];
}
