// Surface detail, drawn in code at real sizes: brick courses, tile and panel joints, ashlar stone, planks, grooves,
// and a fine grain for render, paint and concrete. Each is a luminance map (about 1, darker in the joints: the colour
// stays the design system's, this only adds the detail) and a normal map made from the same heights. Tiled in metres
// (the geometry's UVs are metres), so a brick is 230 × 75 mm whatever the wall. Drawn once per pattern and size.
import * as THREE from 'three';
import type { Material } from '../materials';

export interface Detail { map: THREE.Texture; normal: THREE.Texture; repeat: [number, number] }
const cache = new Map<string, Detail>();

/** a seeded random, so a pattern is the same every time */
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/** the tile (metres) a pattern repeats over, for a material */
export function moduleOf(m: Material): [number, number] {
  switch (m.pattern ?? 'plain') {
    case 'brick': return [0.48, 0.34];
    case 'stone': return [1.2, 0.6];
    case 'plank': return [2.4, 0.6];
    case 'stripe': return [0.6, 1];
    case 'louvre': return [0.6, 1];
    case 'tile': return m.category === 'cladding' ? [1.2, 0.6] : m.category === 'glass' ? [1.5, 3] : m.id.includes('1200') ? [1.2, 1.2] : m.id.includes('800') ? [0.8, 0.8] : [0.6, 0.6];
    default: return [2, 2];
  }
}

/** heights in 0…1 (1 the face, 0 the deepest joint) over an n × n grid for a pattern */
function heights(pattern: string, n: number, m: Material, R: () => number): Float32Array {
  const h = new Float32Array(n * n).fill(1);
  const [tw, th] = moduleOf(m), px = n / tw, py = n / th; // pixels per metre along u and v
  const joint = (x0: number, y0: number, w: number, hgt: number, depth = 0.25) => {
    for (let y = Math.floor(y0); y < Math.ceil(y0 + hgt); y++) for (let x = Math.floor(x0); x < Math.ceil(x0 + w); x++) h[((y % n + n) % n) * n + ((x % n + n) % n)] = Math.min(h[((y % n + n) % n) * n + ((x % n + n) % n)], depth);
  };
  const grain = (amp: number, scale: number) => {
    // (value noise, two octaves)
    const g = Array.from({ length: 64 * 64 }, () => R());
    const at = (x: number, y: number) => { const xi = Math.floor(x) & 63, yi = Math.floor(y) & 63, fx = x - Math.floor(x), fy = y - Math.floor(y), a = g[yi * 64 + xi], b = g[yi * 64 + ((xi + 1) & 63)], c = g[((yi + 1) & 63) * 64 + xi], d = g[((yi + 1) & 63) * 64 + ((xi + 1) & 63)]; return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy; };
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const v = at((x / n) * scale, (y / n) * scale) * 0.65 + at((x / n) * scale * 4, (y / n) * scale * 4) * 0.35; h[y * n + x] *= 1 - amp + amp * v; }
  };
  switch (pattern) {
    case 'brick': {
      // 230 × 75 brick, 10 mm joints, running bond: two bricks across, four courses up
      const bw = 0.24 * px, ch = 0.085 * py, jx = 0.01 * px, jy = 0.01 * py;
      for (let c = 0; c < 4; c++) { joint(0, c * ch, n, jy); for (let k = 0; k <= 2; k++) joint(k * bw + (c % 2 ? bw / 2 : 0), c * ch, jx, ch); }
      for (let c = 0; c < 4; c++) for (let k = 0; k < 3; k++) { const shade = 0.88 + R() * 0.12, x0 = Math.floor(k * bw + (c % 2 ? bw / 2 : 0)), y0 = Math.floor(c * ch + jy); for (let y = y0; y < y0 + ch - jy; y++) for (let x = x0 + jx; x < x0 + bw; x++) { const i = (y % n) * n + (x % n); if (h[i] > 0.5) h[i] *= shade; } }
      grain(0.12, 24); break;
    }
    case 'stone': {
      // ashlar 600 × 300 with 6 mm joints, staggered
      const sw = 0.6 * px, sh = 0.3 * py, j = Math.max(1, 0.006 * px);
      for (let c = 0; c < 2; c++) { joint(0, c * sh, n, j); for (let k = 0; k <= 2; k++) joint(k * sw + (c % 2 ? sw / 2 : 0), c * sh, j, sh); }
      grain(0.3, 10); break;
    }
    case 'tile': {
      const j = Math.max(1, 0.006 * px);
      joint(0, 0, n, j, 0.4); joint(0, 0, j, n, 0.4);
      grain(m.category === 'cladding' ? 0.03 : 0.06, 6); break;
    }
    case 'plank': {
      // 150 mm boards, butt joints staggered
      const bh = 0.15 * py, j = Math.max(1, 0.004 * py);
      for (let c = 0; c < 4; c++) { joint(0, c * bh, n, j, 0.35); joint(((c * 0.37) % 1) * n, c * bh, j, bh, 0.35); }
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) h[y * n + x] *= 0.92 + 0.08 * Math.sin(y * 0.9 + Math.sin(x * 0.05) * 3);
      break;
    }
    case 'stripe': case 'louvre': {
      const g = pattern === 'louvre' ? 0.3 : 0.15, w = Math.max(1, (pattern === 'louvre' ? 0.06 : 0.01) * px);
      for (let k = 0; k < Math.round(tw / g); k++) joint(k * g * px, 0, w, n, pattern === 'louvre' ? 0.1 : 0.45);
      grain(0.04, 6); break;
    }
    default: grain(m.finish === 'textured' ? 0.22 : m.finish === 'matt' ? 0.08 : 0.03, 18);
  }
  return h;
}

/** the detail for a material at a resolution (px), or null when there's no texture tier */
export function detailOf(m: Material, size: number): Detail | null {
  if (!size || typeof document === 'undefined') return null;
  const pattern = m.pattern ?? 'plain', key = `${m.id}|${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const n = size, R = rng(m.id.split('').reduce((s, c) => s * 31 + c.charCodeAt(0), 7));
  const h = heights(pattern, n, m, R);
  const cv = document.createElement('canvas'), cn = document.createElement('canvas');
  cv.width = cv.height = cn.width = cn.height = n;
  const g = cv.getContext('2d')!, gn = cn.getContext('2d')!;
  const img = g.createImageData(n, n), nim = gn.createImageData(n, n);
  const strength = pattern === 'plain' ? (m.finish === 'textured' ? 3 : 1.2) : 6;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, v = h[i];
    // (luminance: the face near white so the token colour holds, the joints darker)
    const l = Math.round(255 * Math.min(1, 0.55 + 0.45 * v + (pattern === 'plain' ? 0.06 : 0)));
    img.data.set([l, l, l, 255], i * 4);
    const hx = h[y * n + ((x + 1) % n)] - h[y * n + ((x - 1 + n) % n)], hy = h[((y + 1) % n) * n + x] - h[((y - 1 + n) % n) * n + x];
    const nx = -hx * strength, ny = hy * strength, nz = 1, L = Math.hypot(nx, ny, nz);
    nim.data.set([Math.round((nx / L * 0.5 + 0.5) * 255), Math.round((ny / L * 0.5 + 0.5) * 255), Math.round((nz / L * 0.5 + 0.5) * 255), 255], i * 4);
  }
  g.putImageData(img, 0, 0); gn.putImageData(nim, 0, 0);
  const mk = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    const [tw, th] = moduleOf(m); t.repeat.set(1 / tw, 1 / th);
    return t;
  };
  const d: Detail = { map: mk(cv, true), normal: mk(cn, false), repeat: moduleOf(m) };
  cache.set(key, d);
  return d;
}
