// A landscape surface (./surfaces.ts) as a material: its painted Field becomes a colour map (the real colour, so the
// material's own colour is white), a normal map from its heights and a roughness map, repeating over the surface's
// tile in metres. Drawn once per surface and resolution and kept for the page's life (they don't change).
import * as THREE from 'three';
import { paintSurface, SURFACES, type SurfaceId } from './surfaces';
import { boxUV } from '../pbr';

export interface SurfaceMaps { map: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture; size: number; bump: number }
const maps = new Map<string, SurfaceMaps>();
const mats = new Map<string, THREE.MeshStandardMaterial>();

/** the resolution a texture tier asks for, landscape surfaces drawn at least at 256 (even in draft: they're what
 *  the ground reads as) and at most 1024 */
export const landscapeRes = (tex: number) => Math.min(1024, Math.max(256, tex || 256));

/** the three maps of a surface at n × n (null without a DOM) */
export function surfaceMaps(id: SurfaceId, n: number): SurfaceMaps | null {
  if (typeof document === 'undefined') return null;
  const key = `${id}|${n}`, hit = maps.get(key);
  if (hit) return hit;
  const F = paintSurface(id, n), s = SURFACES[id];
  const canvas = () => { const c = document.createElement('canvas'); c.width = c.height = n; return c; };
  const cc = canvas(), cn = canvas(), cr = canvas();
  const gc = cc.getContext('2d')!, gn = cn.getContext('2d')!, gr = cr.getContext('2d')!;
  const ic = gc.createImageData(n, n), inm = gn.createImageData(n, n), ir = gr.createImageData(n, n);
  const k = s.bump;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const i = y * n + x, o = i * 4;
    ic.data[o] = Math.round(Math.min(1, F.col[i * 3]) * 255); ic.data[o + 1] = Math.round(Math.min(1, F.col[i * 3 + 1]) * 255); ic.data[o + 2] = Math.round(Math.min(1, F.col[i * 3 + 2]) * 255); ic.data[o + 3] = 255;
    const hx = F.h[y * n + ((x + 1) % n)] - F.h[y * n + ((x - 1 + n) % n)], hy = F.h[((y + 1) % n) * n + x] - F.h[((y - 1 + n) % n) * n + x];
    const nx = -hx * k, ny = hy * k, L = Math.hypot(nx, ny, 1);
    inm.data[o] = Math.round((nx / L * 0.5 + 0.5) * 255); inm.data[o + 1] = Math.round((ny / L * 0.5 + 0.5) * 255); inm.data[o + 2] = Math.round((1 / L * 0.5 + 0.5) * 255); inm.data[o + 3] = 255;
    // (three.js reads roughness from the green channel)
    const r = Math.round(Math.min(1, Math.max(0, F.r[i])) * 255); ir.data[o] = r; ir.data[o + 1] = r; ir.data[o + 2] = r; ir.data[o + 3] = 255;
  }
  gc.putImageData(ic, 0, 0); gn.putImageData(inm, 0, 0); gr.putImageData(ir, 0, 0);
  const tex = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.repeat.set(1 / s.size, 1 / s.size);
    return t;
  };
  const out: SurfaceMaps = { map: tex(cc, true), normal: tex(cn, false), rough: tex(cr, false), size: s.size, bump: s.bump };
  maps.set(key, out);
  return out;
}

/** a surface as a material at a texture tier's resolution; `o` adds options (a tint multiplies the real colour). Without
 *  a DOM (tests) a plain material. `world`: for instanced boxes, uv from the world (../pbr.ts boxUV). Cached: the same id, resolution and options, the
 *  same material, so the scene can merge by it. */
export function surfaceMaterial(id: SurfaceId, tex: number, o: { tint?: string; transparent?: boolean; opacity?: number; side?: THREE.Side; world?: boolean } = {}): THREE.MeshStandardMaterial {
  const n = landscapeRes(tex), key = `${id}|${n}|${JSON.stringify(o)}`, hit = mats.get(key);
  if (hit) return hit;
  const M = surfaceMaps(id, n);
  const m = new THREE.MeshStandardMaterial({
    color: o.tint ?? '#ffffff', roughness: 1, metalness: 0,
    map: M?.map ?? null, normalMap: M?.normal ?? null, roughnessMap: M?.rough ?? null,
    ...(o.transparent ? { transparent: true, opacity: o.opacity ?? 0.5, depthWrite: false } : {}), ...(o.side !== undefined ? { side: o.side } : {}),
  });
  if (M) {
    m.normalScale.set(0.9, 0.9);
    // (no visible repeat over a large area: the colour is varied ±12% by the same map read 11 times larger and turned,
    // blurred by its mipmaps into broad drifts that never line up with the tiles)
    m.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
#ifdef USE_MAP
  vec2 mUv = mat2(0.80, -0.60, 0.60, 0.80) * vMapUv * 0.091 + vec2(0.37, 0.71);
  vec3 macro = texture2D(map, mUv, 4.0).rgb;
  float ml = dot(macro, vec3(0.333)), base = dot(texture2D(map, vMapUv, 6.0).rgb, vec3(0.333)) + 1e-3;
  diffuseColor.rgb *= clamp(1.0 + 0.6 * (ml / base - 1.0), 0.85, 1.15);
#endif`);
    };
    m.customProgramCacheKey = () => 'landscape-macro';
    // (on instanced boxes, kerbs, footpaths: the texture laid from the world, in metres, not stretched over each box)
    if (o.world) boxUV(m);
  }
  m.userData.surface = id;
  mats.set(key, m);
  return m;
}
