// Animated dither: the brand's one texture. Used only for the brand mark and for things that are loading or being
// worked out; everything else is flat black and white. An ordered (Bayer 8×8) threshold over a moving field, drawn in
// big square pixels in the page's ink on its paper. One shared animation loop; a canvas stops when it's off screen,
// when the tab is hidden, and for good when the reader prefers reduced motion (it shows one still frame).

const B8 = (() => {
  let m = [[0]];
  while (m.length < 8) {
    const n = m.length, r: number[][] = [];
    for (let y = 0; y < 2 * n; y++) { r.push([]); for (let x = 0; x < 2 * n; x++) r[y].push(4 * m[y % n][x % n] + [[0, 2], [3, 1]][y >= n ? 1 : 0][x >= n ? 1 : 0]); }
    m = r;
  }
  return m.flat().map((v) => (v + 0.5) / 64);
})();
const thr = (x: number, y: number) => B8[(y & 7) * 8 + (x & 7)];

/** brightness 0..1 at a cell, at time t (s), on a w × h grid */
export type Field = (x: number, y: number, t: number, w: number, h: number) => number;

export const FIELDS = {
  /** the brand mark: a diagonal wave inside a rounded square */
  mark: ((x, y, t, w, h) => {
    const cx = (w - 1) / 2, cy = (h - 1) / 2, r = Math.min(w, h) / 2;
    if (Math.max(Math.abs(x - cx), Math.abs(y - cy)) > r - 0.2) return 0;
    return 0.5 + 0.45 * Math.sin((x + y) / 2.6 - t * 1.6);
  }) as Field,
  /** loading: a slowly drifting, warped noise */
  noise: ((x, y, t) => {
    const wx = x + 3.5 * Math.sin(y * 0.22 + t * 0.9), wy = y + 3 * Math.cos(x * 0.17 - t * 0.7);
    return 0.34 + 0.24 * Math.sin(wx * 0.3 + t * 1.1) * Math.cos(wy * 0.36 - t * 0.8) + 0.14 * Math.sin((wx + wy) * 0.16 - t * 1.3) + 0.08 * Math.sin(wx * 0.07 - t * 0.5);
  }) as Field,
  /** a brand band: broad slow waves */
  band: ((x, y, t, w, h) => {
    const u = x / w, v = y / h;
    return 0.5 + 0.22 * Math.sin(u * 7 + t * 0.6) + 0.18 * Math.sin(v * 5 - t * 0.9 + u * 3) + 0.14 * Math.sin((u + v) * 11 + t * 0.4) + (u - 0.5) * 0.35;
  }) as Field,
};

interface Live { c: HTMLCanvasElement; field: Field; cell: number; inverse: boolean; t: number; seed: number; seen: boolean; img?: ImageData; col?: [number[], number[]]; colAt?: number }
const live = new Set<Live>();
let raf = 0, last = 0;
const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function rgb(css: string): number[] {
  const x = document.createElement('canvas').getContext('2d')!;
  x.fillStyle = '#000'; x.fillStyle = css; x.fillRect(0, 0, 1, 1);
  const d = x.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]];
}
function colours(o: Live): [number[], number[]] {
  // (the canvas's own --up-ink and --up-paper, refreshed now and then so a theme change follows)
  const now = performance.now();
  if (!o.col || now - (o.colAt ?? 0) > 500) {
    const s = getComputedStyle(o.c), ink = rgb(s.getPropertyValue('--up-ink').trim() || '#000'), paper = rgb(s.getPropertyValue('--up-paper').trim() || '#fff');
    o.col = o.inverse ? [ink, paper] : [paper, ink]; o.colAt = now;
  }
  return o.col;
}
function draw(o: Live) {
  const w = Math.max(1, Math.round(o.c.clientWidth / o.cell)), h = Math.max(1, Math.round(o.c.clientHeight / o.cell));
  if (o.c.width !== w || o.c.height !== h) { o.c.width = w; o.c.height = h; o.img = undefined; }
  const g = o.c.getContext('2d'); if (!g) return;
  if (!o.img) o.img = g.createImageData(w, h);
  const d = o.img.data, [A, B] = colours(o);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const c = o.field(i, j, o.t + o.seed, w, h) > thr(i, j) ? B : A, p = (j * w + i) * 4;
    d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = 255;
  }
  g.putImageData(o.img, 0, 0);
}
function loop(ts: number) {
  raf = 0;
  const dt = Math.min(0.05, (ts - last) / 1000 || 0); last = ts;
  if (!live.size) return;
  if (!document.hidden && !reduced()) for (const o of live) if (o.seen) { o.t += dt; draw(o); }
  raf = requestAnimationFrame(loop);
}

/** Animate a dither on a canvas (sized by CSS). Returns a function that stops it. */
export function dither(c: HTMLCanvasElement, opts: { field?: Field | keyof typeof FIELDS; cell?: number; inverse?: boolean } = {}): () => void {
  const f = opts.field ?? 'noise';
  const o: Live = { c, field: typeof f === 'string' ? FIELDS[f] : f, cell: opts.cell ?? 3, inverse: !!opts.inverse, t: 0, seed: Math.random() * 20, seen: true };
  c.setAttribute('aria-hidden', 'true');
  c.style.imageRendering = 'pixelated';
  const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(([e]) => { o.seen = e.isIntersecting; }) : null;
  io?.observe(c);
  live.add(o);
  draw(o);
  if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
  return () => { live.delete(o); io?.disconnect(); };
}
