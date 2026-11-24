// Surface detail, drawn in code at real sizes: brick courses, tile and panel joints, ashlar stone, planks, grooves,
// and a fine grain for render, paint and concrete. Each is a luminance map (about 1, darker in the joints: the colour
// stays the design system's, this only adds the detail) and a normal map made from the same heights. Tiled in metres
// (the geometry's UVs are metres), so a brick is 230 × 75 mm whatever the wall. Drawn once per pattern and size.
import * as THREE from 'three';
import type { Material } from '../materials';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { fbm as fbmT } from './landscape/noise';

export interface Detail { map: THREE.Texture; normal: THREE.Texture; repeat: [number, number]; /** roughness, absolute (green channel); none for scanned sets */ rough?: THREE.Texture }
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
    case 'sand': return [2, 2];
    case 'cracked': return [3, 3];
    case 'gravel': return [1, 1];
    case 'rock': return [4, 4];
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
      // (each stone its own shade, as a quarry's do)
      for (let c = 0; c < 2; c++) for (let k = -1; k < 2; k++) { const shade = 0.86 + R() * 0.16, x0 = Math.floor(k * sw + (c % 2 ? sw / 2 : 0)), y0 = Math.floor(c * sh); for (let y = y0; y < y0 + sh; y++) for (let x = x0; x < x0 + sw; x++) { const i = (((y % n) + n) % n) * n + (((x % n) + n) % n); if (h[i] > 0.5) h[i] *= shade; } }
      grain(0.3, 10); break;
    }
    case 'tile': {
      const j = Math.max(1, 0.006 * px);
      joint(0, 0, n, j, 0.4); joint(0, 0, j, n, 0.4);
      grain(m.category === 'cladding' ? 0.03 : 0.06, 6);
      if (m.id.includes('marble')) {
        // (veins: thin dark lines where a turbulent field crosses its contours, a few bolder)
        const f = fbmT(3, 4, 17);
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const i = y * n + x; if (h[i] < 0.5) continue; const t = Math.abs(Math.sin((x / n * 2 + f(x / n, y / n) * 5) * Math.PI)); if (t < 0.035) h[i] *= 0.78 + t * 4; else if (t < 0.1) h[i] *= 0.95; }
      }
      if (m.id === 'concrete-fair') {
        // (form-tie holes, four to a 1200 × 600 panel, 25 mm across)
        for (const [hx, hy] of [[0.3, 0.15], [0.9, 0.15], [0.3, 0.45], [0.9, 0.45]]) { const cx = hx * px, cy = hy * py, rr = 0.0125 * px; for (let y = Math.floor(cy - rr); y <= cy + rr; y++) for (let x = Math.floor(cx - rr); x <= cx + rr; x++) if (Math.hypot(x - cx, y - cy) <= rr) h[((y % n + n) % n) * n + ((x % n + n) % n)] = 0.2; }
      }
      break;
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
    case 'sand': {
      // wind ripples a few centimetres apart, wandering, and a fine grain
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) h[y * n + x] *= 0.9 + 0.1 * Math.sin((x / n) * Math.PI * 2 * 9 + Math.sin((y / n) * Math.PI * 2 * 2) * 2.2);
      grain(0.3, 90); break;
    }
    case 'cracked': {
      // dried black cotton: plates 0.3 to 0.6 m across between cracks (the edges of a Voronoi field, wrapped)
      const P = Array.from({ length: 40 }, () => [R() * n, R() * n]);
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        let d1 = Infinity, d2 = Infinity;
        for (const [px0, py0] of P) for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) { const d = Math.hypot(px0 + ox * n - x, py0 + oy * n - y); if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d; }
        const e = d2 - d1; if (e < n * 0.006) h[y * n + x] = Math.min(h[y * n + x], 0.15 + e / (n * 0.006) * 0.5);
      }
      grain(0.18, 30); break;
    }
    case 'gravel': {
      // pebbles 2 to 6 cm, domed, packed
      for (let i = 0; i < n * n; i++) h[i] = 0.55;
      for (let k = 0; k < 900; k++) {
        const cx = R() * n, cy = R() * n, rr = (0.01 + R() * 0.02) * px, top = 0.75 + R() * 0.25;
        for (let y = Math.floor(cy - rr); y <= cy + rr; y++) for (let x = Math.floor(cx - rr); x <= cx + rr; x++) { const d = Math.hypot(x - cx, y - cy) / rr; if (d >= 1) continue; const i = ((y % n + n) % n) * n + ((x % n + n) % n); h[i] = Math.max(h[i], 0.55 + (top - 0.55) * Math.sqrt(1 - d * d)); }
      }
      grain(0.08, 40); break;
    }
    case 'rock': {
      // weathered basalt: broad swells, a few joints
      grain(0.45, 4); grain(0.2, 24);
      for (let k = 0; k < 5; k++) { const y0 = R() * n, a = (R() - 0.5) * 0.6; for (let x = 0; x < n; x++) { const y = Math.floor(y0 + x * a); for (let t = 0; t < 2; t++) { const i = (((y + t) % n + n) % n) * n + x; h[i] = Math.min(h[i], 0.3); } } }
      break;
    }
    default: grain(m.finish === 'textured' ? 0.22 : m.finish === 'matt' ? 0.08 : 0.03, 18);
  }
  return h;
}

// ---------------------------------------------------------------- scanned sets (tools/render/textures.mjs)
interface ScanEntry { size: [number, number]; color: string; normal?: string; rough?: string }
const scans = new Map<string, Detail>();
/** Load the scanned sets the texture tool put in public/assets/render/tex (none there: false, and the procedural
 *  ones stay). Colour maps become detail maps (their luminance divided by its mean, so the token colour holds). */
export async function loadScans(base: string, renderer?: THREE.WebGLRenderer): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  let man: Record<string, ScanEntry>;
  const at = (f: string) => `${base}assets/render/tex/${f}`;
  try { const r = await fetch(at('manifest.json')); if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) return false; man = await r.json(); } catch { return false; }
  const ktx = renderer ? new KTX2Loader().setTranscoderPath(`${base}basis/`).detectSupport(renderer) : null;
  const img = (u: string) => new Promise<HTMLImageElement>((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = u; });
  const tex = async (u: string): Promise<THREE.Texture> => (u.endsWith('.ktx2') && ktx ? ktx.loadAsync(u) : new THREE.TextureLoader().loadAsync(u));
  for (const [key, e] of Object.entries(man)) {
    try {
      const im = await img(at(e.color));
      const cv = document.createElement('canvas'); cv.width = im.width; cv.height = im.height;
      const g = cv.getContext('2d')!; g.drawImage(im, 0, 0);
      const d = g.getImageData(0, 0, cv.width, cv.height), p = d.data;
      let sum = 0; for (let i = 0; i < p.length; i += 4) sum += 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
      const mean = sum / (p.length / 4) || 1;
      for (let i = 0; i < p.length; i += 4) { const l = Math.min(255, ((0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2]) / mean) * 235); p[i] = p[i + 1] = p[i + 2] = l; }
      g.putImageData(d, 0, 0);
      const map = new THREE.CanvasTexture(cv); map.colorSpace = THREE.SRGBColorSpace;
      const normal = e.normal ? await tex(at(e.normal)) : null;
      for (const t2 of [map, normal]) if (t2) { t2.wrapS = t2.wrapT = THREE.RepeatWrapping; t2.anisotropy = 8; t2.repeat.set(1 / e.size[0], 1 / e.size[1]); }
      if (normal) normal.colorSpace = THREE.NoColorSpace;
      scans.set(key, { map, normal: normal ?? map, repeat: e.size });
    } catch { /* that set skipped */ }
  }
  return scans.size > 0;
}
/** which scanned set a material takes, if one is loaded */
function scanFor(m: Material): Detail | null {
  if (!scans.size) return null;
  const k = m.id === 'concrete-fair' || m.id.includes('concrete') ? 'concrete' : m.pattern === 'brick' ? 'brick' : m.pattern === 'stone' ? 'stone'
    : m.category === 'wood' || m.pattern === 'plank' ? 'wood' : m.pattern === 'tile' && m.category !== 'cladding' && m.category !== 'glass' ? 'tile'
    : m.id.startsWith('ground') ? 'ground' : m.id.includes('asphalt') ? 'asphalt' : m.id.includes('paver') ? 'pavers' : m.id.includes('grass') ? 'grass'
    : (m.category === 'paint' || m.finish === 'textured') && m.pattern !== 'stripe' ? 'plaster' : null;
  return k ? scans.get(k) ?? null : null;
}

/** the detail for a material at a resolution (px), or null when there's no texture tier: a scanned set when one is
 *  loaded for it (loadScans), else drawn here */
export function detailOf(m: Material, size: number): Detail | null {
  if (!size || typeof document === 'undefined') return null;
  const scanned = scanFor(m);
  if (scanned) return scanned;
  const pattern = m.pattern ?? 'plain', key = `${m.id}|${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const n = size, R = rng(m.id.split('').reduce((s, c) => s * 31 + c.charCodeAt(0), 7));
  const h = heights(pattern, n, m, R);
  const cv = document.createElement('canvas'), cn = document.createElement('canvas');
  cv.width = cv.height = cn.width = cn.height = n;
  const cr = document.createElement('canvas'); cr.width = cr.height = n;
  const g = cv.getContext('2d')!, gn = cn.getContext('2d')!, gr = cr.getContext('2d')!;
  const img = g.createImageData(n, n), nim = gn.createImageData(n, n), rim = gr.createImageData(n, n);
  // (roughness: the face as its finish, joints and pores rough; gloss faces vary a little so reflections break up)
  const face = m.finish === 'gloss' ? 0.18 : m.finish === 'satin' ? 0.45 : m.finish === 'textured' ? 0.93 : m.category === 'wood' ? 0.7 : 0.86;
  const strength = pattern === 'plain' ? (m.finish === 'textured' ? 3 : 1.2) : 6;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, v = h[i];
    // (luminance: the face near white so the token colour holds, the joints darker)
    const l = Math.round(255 * Math.min(1, 0.55 + 0.45 * v + (pattern === 'plain' ? 0.06 : 0)));
    img.data.set([l, l, l, 255], i * 4);
    const hx = h[y * n + ((x + 1) % n)] - h[y * n + ((x - 1 + n) % n)], hy = h[((y + 1) % n) * n + x] - h[((y - 1 + n) % n) * n + x];
    const nx = -hx * strength, ny = hy * strength, nz = 1, L = Math.hypot(nx, ny, nz);
    nim.data.set([Math.round((nx / L * 0.5 + 0.5) * 255), Math.round((ny / L * 0.5 + 0.5) * 255), Math.round((nz / L * 0.5 + 0.5) * 255), 255], i * 4);
    const rr = Math.round(255 * Math.min(1, v < 0.5 ? 0.95 : face + (1 - v) * 0.25)); rim.data.set([rr, rr, rr, 255], i * 4);
  }
  g.putImageData(img, 0, 0); gn.putImageData(nim, 0, 0); gr.putImageData(rim, 0, 0);
  const mk = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    const [tw, th] = moduleOf(m); t.repeat.set(1 / tw, 1 / th);
    return t;
  };
  const d: Detail = { map: mk(cv, true), normal: mk(cn, false), rough: mk(cr, false), repeat: moduleOf(m) };
  cache.set(key, d);
  return d;
}
