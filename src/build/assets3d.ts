// 3D for catalogue assets that aren't streets or tracks: canals / nallas / open drains (a lined trapezoid with water
// and banks, cut into the terrain when it's wider than a terrain cell), overhead power lines (towers or poles and
// sagging conductors), placed structures (stations, platforms, tanks, substations) and areas (slabs). Kept
// simple on purpose: a few boxes and strips per object, vertex-coloured.
import { GeomBuilder, drapePolygon, rgbHex } from './geom';
import type { Heightfield } from '../geo/heightfield';
import type { AssetDef } from '../assets/model';
import { channelTop } from '../assets/model';

export interface AssetItem { id: string; pts: number[]; a: AssetDef; lift: number; rot: number; shape: 'route' | 'point' | 'area'; color: string }
type Ch = Extract<AssetDef['profile'], { type: 'channel' }>;

const hexRgb = (h: string): [number, number, number] => rgbHex(parseInt(h.replace('#', ''), 16));
const mix = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Channels at least this wide at the top are cut into the terrain (the terrain grid is 8 m). */
export const CARVE_MIN = 9;
export const carves = (a: AssetDef) => a.profile.type === 'channel' && channelTop(a.profile) >= CARVE_MIN;

/** Resample a polyline every `step` m, with left normals and arc length. */
export function resample(p: number[], step = 3) {
  const pts: number[] = [], s: number[] = [];
  let acc = 0;
  pts.push(p[0], p[1]); s.push(0);
  for (let i = 0; i + 3 < p.length; i += 2) {
    const ax = p[i], az = p[i + 1], bx = p[i + 2], bz = p[i + 3], L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-3) continue;
    const k = Math.max(1, Math.ceil(L / step));
    for (let j = 1; j <= k; j++) { const t = j / k; pts.push(ax + (bx - ax) * t, az + (bz - az) * t); s.push(acc + L * t); }
    acc += L;
  }
  const m = pts.length / 2, nor = new Float32Array(m * 2);
  for (let i = 0; i < m; i++) {
    const a = Math.max(0, i - 1), b = Math.min(m - 1, i + 1);
    let dx = pts[b * 2] - pts[a * 2], dz = pts[b * 2 + 1] - pts[a * 2 + 1];
    const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
    nor[i * 2] = dz; nor[i * 2 + 1] = -dx;
  }
  return { pts, nor, s, len: acc, m };
}
type RS = ReturnType<typeof resample>;

/**
 * Sweep a cross-section along the line: `xs` = [offset across (+ left), height above `base(i)`] points left → right,
 * one colour per segment. Faces up / outwards.
 */
function sweep(gb: GeomBuilder, R: RS, xs: [number, number][], base: (i: number) => number, rgb: [number, number, number][]) {
  for (let k = 0; k < xs.length - 1; k++) {
    const [o0, h0] = xs[k], [o1, h1] = xs[k + 1];
    const c = rgb[Math.min(k, rgb.length - 1)];
    const v0 = gb.vertexCount;
    for (let i = 0; i < R.m; i++) {
      const x = R.pts[i * 2], z = R.pts[i * 2 + 1], nx = R.nor[i * 2], nz = R.nor[i * 2 + 1], y = base(i);
      // normal of this facet in the (across, up) plane, toward the open side
      let ux = -(h1 - h0), uy = o0 - o1;
      if (uy < 0) { ux = -ux; uy = -uy; }
      const L = Math.hypot(ux, uy) || 1;
      gb.v(x + nx * o0, y + h0, z + nz * o0, (nx * ux) / L, uy / L, (nz * ux) / L, c[0], c[1], c[2], R.s[i] * 0.25, o0 * 0.25);
      gb.v(x + nx * o1, y + h1, z + nz * o1, (nx * ux) / L, uy / L, (nz * ux) / L, c[0], c[1], c[2], R.s[i] * 0.25, o1 * 0.25);
    }
    for (let i = 0; i < R.m - 1; i++) {
      const a = v0 + i * 2;
      // o0 > o1 (left to right): wind so it faces up
      if (o0 >= o1) { gb.tri(a, a + 1, a + 3); gb.tri(a, a + 3, a + 2); } else { gb.tri(a, a + 3, a + 1); gb.tri(a, a + 2, a + 3); }
    }
  }
}

function channel(solid: GeomBuilder, water: GeomBuilder, it: AssetItem, p: Ch, hf: Heightfield) {
  const R = resample(it.pts, 3);
  const carve = carves(it.a);
  const D = p.depth + p.freeboard, hb = p.bed / 2, ht = hb + p.slope * D;
  // bank level: the designed ground where cut in, else just over the rendered surface
  const base = (i: number) => (carve ? hf.sample(R.pts[i * 2], R.pts[i * 2 + 1]) : hf.sampleSurface(R.pts[i * 2], R.pts[i * 2 + 1]) + 0.04);
  const lining = p.lined ? hexRgb('#bdb8ad') : hexRgb('#7a6648'), bank = p.road ? hexRgb('#b7ab95') : hexRgb('#8fa66a');
  const depth = carve ? D : Math.min(D, 0.25); // shallow-looking when it isn't cut in
  const xs: [number, number][] = [];
  const cols: [number, number, number][] = [];
  if (p.banks[0] > 0) { xs.push([ht + p.banks[0], 0.05]); cols.push(bank); }
  xs.push([ht, 0.05], [hb, -depth], [-hb, -depth], [-ht, 0.05]);
  cols.push(lining, mix(lining, [0.3, 0.27, 0.22], 0.25), lining);
  if (p.banks[1] > 0) { xs.push([-ht - p.banks[1], 0.05]); cols.push(bank); }
  sweep(solid, R, xs, base, cols);
  // water up to full supply level
  const wl = carve ? -p.freeboard : -0.02, hw = carve ? hb + p.slope * p.depth : hb + (ht - hb) * 0.6;
  sweep(water, R, [[hw, wl], [-hw, wl]], base, [[1, 1, 1]]);
}

/** Lower the terrain under wide channels (call after the roads' targets are stamped). */
export function stampChannel(hf: Heightfield, targets: Float32Array, pts: number[], p: Ch, region?: [number, number, number, number]) {
  const D = p.depth + p.freeboard, ht = p.bed / 2 + p.slope * D;
  const reach = ht + hf.cell * 0.5;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); z0 = Math.min(z0, pts[i + 1]); z1 = Math.max(z1, pts[i + 1]); }
  if (region) { x0 = Math.max(x0 - reach, region[0]); z0 = Math.max(z0 - reach, region[1]); x1 = Math.min(x1 + reach, region[2]); z1 = Math.min(z1 + reach, region[3]); }
  else { x0 -= reach; z0 -= reach; x1 += reach; z1 += reach; }
  if (x0 > x1 || z0 > z1) return;
  const g = hf.gridRange(x0, z0, x1, z1), n = hf.n;
  for (let j = g.j0; j <= g.j1; j++) for (let i = g.i0; i <= g.i1; i++) {
    const x = hf.x0 + i * hf.cell, z = hf.z0 + j * hf.cell;
    let best = Infinity, bx = 0, bz = 0;
    for (let k = 0; k + 3 < pts.length; k += 2) {
      const ax = pts[k], az = pts[k + 1], dx = pts[k + 2] - ax, dz = pts[k + 3] - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1e-9)));
      const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
      if (d < best) { best = d; bx = ax + dx * t; bz = az + dz * t; }
    }
    if (best > reach) continue;
    const bankY = hf.sample(bx, bz);
    const depthHere = best <= p.bed / 2 ? D : D * Math.max(0, 1 - (best - p.bed / 2) / Math.max(0.01, ht - p.bed / 2));
    const y = bankY - depthHere - 0.3;
    const k = j * n + i;
    targets[k] = Number.isNaN(targets[k]) ? y : Math.min(targets[k], y);
  }
}

function corridor(solid: GeomBuilder, it: AssetItem, p: Extract<AssetDef['profile'], { type: 'corridor' }>, hf: Heightfield) {
  const R = resample(it.pts, 2);
  const steel = hexRgb(p.poles ? '#6f6253' : '#8d9298'), wire = hexRgb('#3a3d42');
  // tower positions: ends and every span
  const at: { x: number; z: number; yaw: number }[] = [];
  const n = Math.max(1, Math.round(R.len / p.span));
  for (let k = 0; k <= n; k++) {
    const s = (R.len * k) / n;
    let i = 0;
    while (i < R.m - 1 && R.s[i + 1] < s) i++;
    at.push({ x: R.pts[i * 2], z: R.pts[i * 2 + 1], yaw: Math.atan2(R.nor[i * 2 + 1], R.nor[i * 2]) });
  }
  const H = p.towerH, arm = p.poles ? 1.6 : Math.min(p.width * 0.32, 14);
  const arms = p.poles ? [H - 0.4] : [H * 0.72, H * 0.86];
  const tops: { x: number; z: number; y: number; nx: number; nz: number }[] = [];
  for (const t of at) {
    const g = hf.sampleSurface(t.x, t.z);
    if (p.poles) solid.box(t.x, t.z, g - 0.5, g + H, 0.3, 0.3, t.yaw, steel);
    else {
      // a lattice tower's silhouette: stepped, tapering to the peak
      for (const [y0, y1, f] of [[0, 0.3, 0.2], [0.3, 0.6, 0.13], [0.6, 0.88, 0.08], [0.88, 1, 0.045]] as const) solid.box(t.x, t.z, g + H * y0 - (y0 ? 0 : 0.5), g + H * y1, H * f, H * f, t.yaw, steel);
    }
    for (const y of arms) solid.box(t.x, t.z, g + y - (p.poles ? 0.25 : 0.9), g + y, arm * 2, p.poles ? 0.15 : 1.2, t.yaw, steel);
    tops.push({ x: t.x, z: t.z, y: g + arms[0], nx: Math.cos(t.yaw), nz: Math.sin(t.yaw) });
  }
  // conductors: three per side (one each on poles), sagging between towers
  const offs = p.poles ? [-arm * 0.8, 0, arm * 0.8] : [-arm * 0.95, -arm * 0.55, arm * 0.55, arm * 0.95];
  for (let k = 0; k + 1 < tops.length; k++) {
    const a = tops[k], b = tops[k + 1], L = Math.hypot(b.x - a.x, b.z - a.z), sag = Math.min(8, L * 0.025);
    for (const o of offs) {
      const seg = 6;
      for (let q = 0; q < seg; q++) {
        const t0 = q / seg, t1 = (q + 1) / seg;
        const P = (t: number) => ({ x: a.x + (b.x - a.x) * t + a.nx * o, z: a.z + (b.z - a.z) * t + a.nz * o, y: a.y + (b.y - a.y) * t - 4 * sag * t * (1 - t) - 0.3 });
        const p0 = P(t0), p1 = P(t1);
        const yaw = Math.atan2(p1.z - p0.z, p1.x - p0.x), len = Math.hypot(p1.x - p0.x, p1.z - p0.z);
        const th = p.poles ? 0.05 : 0.12;
        solid.box((p0.x + p1.x) / 2, (p0.z + p1.z) / 2, (p0.y + p1.y) / 2 - th, (p0.y + p1.y) / 2 + th, len, th * 2, yaw, wire);
      }
    }
  }
}

function point(solid: GeomBuilder, it: AssetItem, p: Extract<AssetDef['profile'], { type: 'point' }>, hf: Heightfield) {
  const [x, z] = it.pts, yaw = (it.rot * Math.PI) / 180, g = hf.sampleSurface(x, z);
  const col = hexRgb(it.color), concrete = hexRgb('#b9b4aa'), roof = mix(col, [0.95, 0.95, 0.95], 0.5);
  const fwd = (d: number): [number, number] => [x + Math.cos(yaw) * d, z + Math.sin(yaw) * d];
  switch (p.shape) {
    case 'station':
      if (p.elev) {
        for (const d of [-p.l / 3, 0, p.l / 3]) { const [px, pz] = fwd(d); solid.box(px, pz, g - 1, g + p.elev, 2.2, 3, yaw, concrete); }
        solid.box(x, z, g + p.elev, g + p.elev + p.h * 0.6, p.l, p.w, yaw, col);
        solid.box(x, z, g + p.elev + p.h * 0.6, g + p.elev + p.h, p.l * 0.96, p.w * 1.06, yaw, roof);
      } else {
        solid.box(x, z, g, g + 0.9, p.l, p.w, yaw, concrete);
        for (const d of [-p.l / 2.5, p.l / 2.5]) { const [px, pz] = fwd(d); solid.box(px, pz, g + 0.9, g + p.h, 0.25, 0.25, yaw, concrete); }
        solid.box(x, z, g + p.h, g + p.h + 0.25, p.l * 0.95, p.w + 0.6, yaw, col);
      }
      return;
    case 'platform':
      solid.box(x, z, g, g + p.h, p.l, p.w, yaw, concrete);
      solid.box(x, z, g + 4.2, g + 4.45, p.l * 0.55, p.w * 0.7, yaw, roof);
      return;
    case 'stop':
      solid.box(x, z, g + 2.5, g + 2.7, p.l, p.w, yaw, col);
      { const s = Math.sin(yaw), c = Math.cos(yaw); solid.box(x - s * p.w * 0.45, z + c * p.w * 0.45, g, g + 2.5, p.l * 0.9, 0.12, yaw, concrete); }
      return;
    case 'tank':
      solid.box(x, z, g, g + p.h * 0.62, p.w * 0.28, p.w * 0.28, yaw, concrete);
      solid.box(x, z, g + p.h * 0.62, g + p.h, p.w, p.w, yaw, col);
      return;
    case 'yard':
      solid.box(x, z, g - 0.2, g + 0.25, p.l, p.w, yaw, hexRgb('#a49c88'));
      for (const d of [-p.l / 4, 0, p.l / 4]) { const [px, pz] = fwd(d); solid.box(px, pz, g + 0.25, g + p.h, 3, 2.4, yaw, hexRgb('#6b6f75')); }
      return;
    default:
      solid.box(x, z, g - 0.2, g + p.h, p.l, p.w, yaw, col);
  }
}

function area(solid: GeomBuilder, it: AssetItem, p: Extract<AssetDef['profile'], { type: 'area' }>, hf: Heightfield) {
  const rgb = hexRgb(p.fill);
  const lift = 0.12 + (p.h ?? 0);
  drapePolygon(solid, new Float32Array(it.pts), [], (x, z) => hf.sampleSurface(x, z) + lift, mix(rgb, [0.85, 0.85, 0.8], 0.25), 12);
}

/** Geometry for every non-street, non-track asset object (by layer, so layers can be hidden). */
export function buildAssets3d(items: AssetItem[], hf: Heightfield): { solid: GeomBuilder; water: GeomBuilder } {
  const solid = new GeomBuilder(), water = new GeomBuilder();
  for (const it of items) {
    const p = it.a.profile;
    if (it.shape === 'point' && p.type === 'point') point(solid, it, p, hf);
    else if (it.shape === 'area' && p.type === 'area') area(solid, it, p, hf);
    else if (p.type === 'channel') channel(solid, water, it, p, hf);
    else if (p.type === 'corridor') corridor(solid, it, p, hf);
  }
  return { solid, water };
}
