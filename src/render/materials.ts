// Procedural textures (canvas) + node materials. No external art needed.
import * as THREE from 'three/webgpu';
import { texture, uv, positionWorld, mix, float, vec2, vec3, uniform, normalWorld, smoothstep, time, vertexColor } from 'three/tsl';
import { FACADE_STYLES, type FacadeStyle } from '../build/buildings';

/**
 * The world square the land-use texture covers: x0, z0 (west / north edge), size. A uniform, so a region's window can
 * move (repaint the texture, set this) without touching any terrain mesh.
 */
export const landuseRect = uniform(new THREE.Vector3(-2500, -2500, 5000));
/** Land-use texture coordinates of a terrain fragment (from its world position). */
export const landuseUV = () => vec2(positionWorld.x.sub(landuseRect.x).div(landuseRect.z), float(1).sub(positionWorld.z.sub(landuseRect.y).div(landuseRect.z)));

function canvasTex(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d')!, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function rand(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Tileable value-noise grain (grey around 0.5). */
function noiseTex(size: number, scale: number, seed: number) {
  return canvasTex(size, (ctx, s) => {
    const img = ctx.createImageData(s, s);
    const r = rand(seed);
    const g = Array.from({ length: scale * scale }, () => r());
    const at = (i: number, j: number) => g[((j % scale + scale) % scale) * scale + ((i % scale + scale) % scale)];
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
      const fx = (x / s) * scale, fy = (y / s) * scale;
      const i = Math.floor(fx), j = Math.floor(fy), tx = fx - i, ty = fy - j;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const v = (at(i, j) * (1 - sx) + at(i + 1, j) * sx) * (1 - sy) + (at(i, j + 1) * (1 - sx) + at(i + 1, j + 1) * sx) * sy;
      const fine = r() * 0.25;
      const c = Math.round((0.38 + v * 0.42 + fine) * 255);
      const o = (y * s + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = c;
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, false);
}

function asphaltTex() {
  return canvasTex(512, (ctx, s) => {
    const r = rand(5);
    ctx.fillStyle = '#7c7c7c';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 26000; i++) {
      const v = 90 + Math.floor(r() * 90);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(r() * s, r() * s, 1 + r() * 1.5, 1 + r() * 1.5);
    }
    // patches & tyre-polish streaks
    for (let i = 0; i < 18; i++) {
      ctx.fillStyle = `rgba(${r() < 0.5 ? 60 : 150},${r() < 0.5 ? 60 : 150},${r() < 0.5 ? 60 : 150},0.12)`;
      ctx.beginPath(); ctx.ellipse(r() * s, r() * s, 20 + r() * 70, 10 + r() * 40, r() * 3, 0, Math.PI * 2); ctx.fill();
    }
  });
}

function pavingTex() {
  return canvasTex(256, (ctx, s) => {
    const r = rand(9);
    ctx.fillStyle = '#c9c2b6';
    ctx.fillRect(0, 0, s, s);
    const t = s / 8;
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      const v = 175 + Math.floor(r() * 40);
      ctx.fillStyle = `rgb(${v},${v - 6},${v - 14})`;
      ctx.fillRect(i * t + 1, j * t + 1, t - 2, t - 2);
    }
  });
}

export interface Materials {
  terrain: THREE.MeshLambertNodeMaterial;
  asphalt: THREE.MeshLambertNodeMaterial;
  paving: THREE.MeshLambertNodeMaterial;
  markings: THREE.MeshLambertNodeMaterial;
  concrete: THREE.MeshLambertNodeMaterial;
  water: THREE.MeshStandardNodeMaterial;
  roofs: THREE.MeshLambertNodeMaterial;
  facades: Record<FacadeStyle, THREE.MeshLambertNodeMaterial>;
  trees: THREE.MeshLambertNodeMaterial;
  steel: THREE.MeshStandardNodeMaterial;
  skirt: THREE.MeshLambertNodeMaterial;
  night: ReturnType<typeof uniform>;
}

export function createMaterials(landuse: THREE.Texture): Materials {
  const night = uniform(0);
  const grain = noiseTex(256, 8, 3);
  const grainFine = noiseTex(256, 32, 4);

  // Terrain: land-use colour × two octaves of world-space grain, browner on slopes
  const terrain = new THREE.MeshLambertNodeMaterial({ });
  const wxz = positionWorld.xz;
  const g1 = texture(grain, wxz.mul(0.012)).r;
  const g2 = texture(grainFine, wxz.mul(0.09)).r;
  const base = texture(landuse, landuseUV()).rgb;
  const slope = smoothstep(0.82, 0.55, normalWorld.y);
  terrain.colorNode = mix(base, vec3(0.42, 0.36, 0.28), slope).mul(g1.mul(0.5).add(0.75)).mul(g2.mul(0.35).add(0.83));

  const asphaltT = asphaltTex();
  const asphalt = new THREE.MeshLambertNodeMaterial({ });
  asphalt.colorNode = vertexColor().rgb.mul(texture(asphaltT, uv()).rgb.mul(1.35));
  asphalt.polygonOffset = true; asphalt.polygonOffsetFactor = -1; asphalt.polygonOffsetUnits = -1;

  const pavingT = pavingTex();
  const paving = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide });
  paving.colorNode = vertexColor().rgb.mul(texture(pavingT, uv().mul(1.6)).rgb.mul(1.12));

  const markings = new THREE.MeshLambertNodeMaterial({ });
  markings.colorNode = vertexColor().rgb;
  markings.polygonOffset = true; markings.polygonOffsetFactor = -4; markings.polygonOffsetUnits = -4;

  const concrete = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide });
  concrete.colorNode = vertexColor().rgb.mul(texture(grain, positionWorld.xz.add(positionWorld.y).mul(0.08)).r.mul(0.25).add(0.88));

  const water = new THREE.MeshStandardNodeMaterial({ roughness: 0.06, metalness: 0.1 });
  const wv = texture(grain, wxz.mul(0.02).add(vec3(time.mul(0.004), time.mul(0.003), 0).xy)).r;
  water.colorNode = mix(vec3(0.07, 0.2, 0.22), vec3(0.16, 0.33, 0.33), wv);
  water.roughnessNode = float(0.05).add(wv.mul(0.12));

  const roofs = new THREE.MeshLambertNodeMaterial({ side: THREE.DoubleSide });
  roofs.colorNode = vertexColor().rgb.mul(texture(grain, wxz.mul(0.15)).r.mul(0.3).add(0.85));

  const facades = {} as Record<FacadeStyle, THREE.MeshLambertNodeMaterial>;
  for (const s of FACADE_STYLES) {
    // plain colours — no facade textures
    const m = new THREE.MeshLambertNodeMaterial();
    m.colorNode = vertexColor().rgb;
    facades[s] = m;
  }

  const trees = new THREE.MeshLambertNodeMaterial({ vertexColors: true });
  const steel = new THREE.MeshStandardNodeMaterial({ color: 0x8d9296, roughness: 0.35, metalness: 0.8 });
  const skirt = new THREE.MeshLambertNodeMaterial({ });
  skirt.colorNode = vertexColor().rgb;

  return { terrain, asphalt, paving, markings, concrete, water, roofs, facades, trees, steel, skirt, night };
}
