// Buildings as wireframes for the website, drawn in code on a 2D canvas (no three.js on the site's pages): each of
// Pro's templates as floor outlines of the same number of points, so any form can flow into any other by moving
// each point (the landing page's animation), or be drawn alone (the template pages).
// These are light sketches of the templates in src/pro/form/templates.ts, not Pro's own geometry: the look of each,
// at about its size. Two outlines per level: two towers or slabs, a block and its court; one building gives both the
// same outline. A form with a roof gets one level more: its ridge or roof edge.

export const N = 72;      // points per outline
export const SLOTS = 24;  // levels drawn (the tallest form's floors and roof); a lower form stacks the rest on its roof

export type Pt = [number, number];
export interface WireForm {
  floors: number;
  /** floor to floor, metres */
  h: number;
  /** a roof above the top floor, its height (a gable's ridge, a hall's hip): the outline at level floors + 1 */
  roof?: number;
  /** the two outlines at level k of n */
  rings: (k: number, n: number) => [Pt[], Pt[]];
}

/** A rounded rectangle (a superellipse: p 2 is an ellipse, higher is squarer), its points at even angles. */
function blob(a: number, b: number, p: number, f: (th: number) => number = () => 1, cx = 0, cz = 0, rot = 0): Pt[] {
  const out: Pt[] = [], c = Math.cos(rot), s = Math.sin(rot);
  for (let i = 0; i < N; i++) {
    const th = (i / N) * Math.PI * 2, ct = Math.cos(th), st = Math.sin(th), r = f(th);
    const x = a * r * Math.sign(ct) * Math.abs(ct) ** (2 / p), z = b * r * Math.sign(st) * Math.abs(st) ** (2 / p);
    out.push([cx + x * c - z * s, cz + x * s + z * c]);
  }
  return out;
}
const one = (r: Pt[]): [Pt[], Pt[]] => [r, r];
const SQ = 14; // squareness of a plain block

/** Every template by its id in Pro (src/pro/form/templates.ts). */
export const WIRE: Record<string, WireForm> = {
  box: { floors: 16, h: 3.1, rings: () => one(blob(15, 11, SQ)) },
  taper: { floors: 18, h: 3.2, rings: (k, n) => one(blob(15, 11, 5, () => 1 - 0.42 * (k / n))) },
  twist: { floors: 20, h: 3.1, rings: (k, n) => one(blob(12, 12, SQ, undefined, 0, 0, (k / n) * 1.3)) },
  stepped: { floors: 20, h: 3.1, rings: (k) => one(blob(16, 16, SQ, () => 1 - 0.17 * Math.floor(k / 5))) },
  round: { floors: 18, h: 3.1, rings: () => one(blob(12, 12, 2)) },
  office: {
    floors: 14, h: 3.6,
    rings: (k) => {
      const podium = blob(22, 16, SQ), tower = blob(13, 10, SQ, undefined, 0, -3);
      return k < 2 ? one(podium) : k === 2 ? [podium, tower] : one(tower);
    },
  },
  hotel: { floors: 12, h: 3.1, rings: () => one(blob(28, 6, 10).map(([x, z]) => [x, z - x * x * 0.018 + 7] as Pt)) },
  wave: { floors: 12, h: 3.2, rings: (k) => one(blob(22, 7, 10).map(([x, z]) => [x, z + 3.4 * Math.sin(x * 0.2 + k * 0.32)] as Pt)) },
  monolith: {
    floors: 18, h: 3.2,
    rings: (k) => { const g = 1.6 * Math.sin(k * 0.8); return [blob(6.5, 13, SQ, undefined, g - 7.2, 0), blob(6.5, 13, SQ, undefined, g + 7.2, 0)]; },
  },
  twins: {
    floors: 22, h: 3.2,
    rings: (k, n) => {
      const t = k / n, sw = (i: number) => 1 + 0.09 * Math.sin(t * Math.PI * 2.2 + i * 1.7);
      return [blob(7.5 * sw(0), 5.2 * sw(0), 2.2, undefined, -10.5, 0, t * 1.9), blob(7.5 * sw(1), 5.2 * sw(1), 2.2, undefined, 10.5, 1, -t * 1.6 + 0.6)];
    },
  },
  lean: { floors: 18, h: 3.1, rings: (k, n) => one(blob(11, 7, SQ, undefined, (k / n) * 9, 0)) },
  skygarden: {
    floors: 20, h: 3.2,
    rings: (k, n) => {
      const carved = k % 5 >= 3 && k < n, turn = Math.floor(k / 5) * (Math.PI / 2);
      return one(blob(13, 13, 10, (th) => (1 - 0.035 * Math.floor(k / 5)) * (carved ? 1 - 0.42 * Math.max(0, Math.cos(th - Math.PI / 4 - turn)) ** 6 : 1)));
    },
  },
  courtyard: { floors: 8, h: 3.2, rings: () => [blob(21, 15, 10), blob(9, 5.5, 6)] },
  twinslab: { floors: 10, h: 3.1, rings: () => [blob(22, 5.5, SQ, undefined, 0, -11), blob(22, 5.5, SQ, undefined, 0, 11)] },
  villa: { floors: 2, h: 3.2, roof: 3, rings: (k, n) => one(k > n ? blob(8, 0.4, SQ) : blob(8, 6, SQ)) },
  rows: { floors: 2, h: 3.2, roof: 2.6, rings: (k, n) => one(k > n ? blob(16, 0.3, SQ) : blob(16, 5.5, SQ)) },
  library: {
    floors: 3, h: 4.6,
    rings: (k, n) => one(blob(19, 13, 2, (th) => (k === n ? 1.1 : k === 0 ? 0.93 : 1) * (1 + 0.12 * Math.sin(2 * th + 0.5) + 0.07 * Math.cos(3 * th)))),
  },
  toilet: { floors: 1, h: 3, roof: 0.6, rings: (k, n) => one(blob(3.5, 2, SQ, () => (k > n ? 1.12 : 1))) },
  hall: { floors: 1, h: 7, roof: 4, rings: (k, n) => one(k > n ? blob(6, 0.3, SQ) : blob(13, 8.5, SQ)) },
};

/** A form as numbers: per level its height, then its two outlines as x, z pairs. */
export interface Geo { y: Float32Array; p: Float32Array }
export const STRIDE = 4 * N;
export const emptyGeo = (): Geo => ({ y: new Float32Array(SLOTS), p: new Float32Array(SLOTS * STRIDE) });
export function geoOf(f: WireForm): Geo {
  const g = emptyGeo(), top = f.floors + (f.roof ? 1 : 0);
  for (let s = 0; s < SLOTS; s++) {
    const k = Math.min(s, top), [A, B] = f.rings(k, f.floors);
    g.y[s] = k <= f.floors ? k * f.h : f.floors * f.h + (f.roof ?? 0);
    [A, B].forEach((R, j) => R.forEach(([x, z], i) => { g.p[s * STRIDE + j * 2 * N + i * 2] = x; g.p[s * STRIDE + j * 2 * N + i * 2 + 1] = z; }));
  }
  return g;
}
export function mix(a: Geo, b: Geo, u: number, out: Geo) {
  for (let i = 0; i < a.y.length; i++) out.y[i] = a.y[i] + (b.y[i] - a.y[i]) * u;
  for (let i = 0; i < a.p.length; i++) out.p[i] = a.p[i] + (b.p[i] - a.p[i]) * u;
}
export const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** whether a level's two outlines are one (a single building): drawn once */
function same(g: Geo, sl: number) {
  const o = sl * STRIDE;
  for (let i = 0; i < 2 * N; i += 6) if (Math.abs(g.p[o + i] - g.p[o + 2 * N + i]) > 0.01) return false;
  return true;
}

/** Draws a form on a canvas in its own colour (CSS `color`), turned by `yaw`: the plot round it, the road in front,
 *  each floor's outline, and posts between floors. `fill`: how much of the canvas it may take (width, height). */
export function draw(cv: HTMLCanvasElement, g: Geo, yaw: number, fill: [number, number] = [0.86, 0.8]) {
  const dpr = Math.min(devicePixelRatio || 1, 2), W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const c = cv.getContext('2d')!;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, W, H);
  const pitch = 0.52, sp = Math.sin(pitch), cp = Math.cos(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);

  // the plot: round the building's ground floor, with room to spare; the road along its front
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < STRIDE; i += 2) { const x = g.p[i], z = g.p[i + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
  const m = Math.max(4, 0.22 * Math.max(x1 - x0, z1 - z0)), rw = Math.max(6, 0.3 * (x1 - x0 + 2 * m));
  const plot: Pt[] = [[x0 - m, z0 - m], [x1 + m, z0 - m], [x1 + m, z1 + m], [x0 - m, z1 + m]];
  const ra = x0 - m - rw, rb = x1 + m + rw, r0 = z1 + m + 1.5, r1 = r0 + rw;

  // fit the plot and the building as they are now, so a low form fills the view as a tower does
  const u = (x: number, z: number) => x * cy - z * sy, v = (x: number, z: number, y: number) => (x * sy + z * cy) * sp - y * cp;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  const grow = (x: number, z: number, y: number) => { const a = u(x, z), b = v(x, z, y); if (a < u0) u0 = a; if (a > u1) u1 = a; if (b < v0) v0 = b; if (b > v1) v1 = b; };
  for (const [x, z] of plot) grow(x, z, 0);
  for (let i = 0; i < g.p.length; i += 2) grow(g.p[i], g.p[i + 1], g.y[Math.floor(i / STRIDE)]);
  const s = Math.min((W * fill[0]) / (u1 - u0), (H * fill[1]) / (v1 - v0));
  const ox = W / 2 - (s * (u0 + u1)) / 2, oy = H * 0.47 - (s * (v0 + v1)) / 2;
  const X = (x: number, z: number) => ox + s * u(x, z);
  const Y = (x: number, z: number, y: number) => oy + s * v(x, z, y);
  c.strokeStyle = getComputedStyle(cv).color; c.lineJoin = 'round';

  // the ground: plot, road edges, the road's centre line (clipped to the view by the canvas)
  const line = (pts: Pt[], close = false) => { c.beginPath(); pts.forEach(([x, z], i) => (i ? c.lineTo(X(x, z), Y(x, z, 0)) : c.moveTo(X(x, z), Y(x, z, 0)))); if (close) c.closePath(); c.stroke(); };
  c.lineWidth = 1; c.globalAlpha = 0.28;
  line(plot, true);
  line([[ra, r0], [rb, r0]]); line([[ra, r1], [rb, r1]]);
  c.setLineDash([4, 6]); line([[ra, (r0 + r1) / 2], [rb, (r0 + r1) / 2]]); c.setLineDash([]);

  // the floors, then posts between them at every ninth point
  const at = (sl: number, j: number, i: number): [number, number] => {
    const o = sl * STRIDE + j * 2 * N + i * 2, x = g.p[o], z = g.p[o + 1];
    return [X(x, z), Y(x, z, g.y[sl])];
  };
  for (let sl = 0; sl < SLOTS; sl++) {
    const top = sl === SLOTS - 1 || g.y[sl + 1] - g.y[sl] < 0.05;
    c.globalAlpha = top || sl === 0 ? 0.95 : 0.6; c.lineWidth = top ? 1.4 : 1;
    for (let j = 0; j < 2; j++) {
      if (j === 1 && same(g, sl)) break;
      c.beginPath();
      for (let i = 0; i < N; i++) { const [px, py] = at(sl, j, i); i ? c.lineTo(px, py) : c.moveTo(px, py); }
      c.closePath(); c.stroke();
    }
    if (top) break;
  }
  c.globalAlpha = 0.38; c.lineWidth = 1; c.beginPath();
  for (let sl = 0; sl < SLOTS - 1; sl++) {
    if (g.y[sl + 1] - g.y[sl] < 0.05) break;
    for (let j = 0; j < 2; j++) {
      if (j === 1 && same(g, sl)) break;
      for (let i = 0; i < N; i += 9) { const [ax, ay] = at(sl, j, i), [bx, by] = at(sl + 1, j, i); c.moveTo(ax, ay); c.lineTo(bx, by); }
    }
  }
  c.stroke(); c.globalAlpha = 1;
}
