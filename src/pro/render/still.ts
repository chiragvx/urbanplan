// Stills: an image of the view at a size of its own, for reports, drawings and sharing.
//   raster: the shaded pipeline offscreen, 32 jittered samples a pixel, ambient occlusion and bloom: a few seconds.
//   path:   the scene path-traced (three-gpu-pathtracer, loaded only when asked): real glass with transmission, light
//           bouncing between buildings, soft shadows from a sun of real size, under a sky made to match. A minute or so.
import * as THREE from 'three';

/** half-float pixels (bottom row first) to a PNG blob */
export async function pixelsToPng(px: Uint16Array | Uint8Array, w: number, h: number, half: boolean): Promise<Blob> {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!, img = g.createImageData(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = ((h - 1 - y) * w + x) * 4, o = (y * w + x) * 4;
    for (let k = 0; k < 4; k++) {
      const v = half ? THREE.DataUtils.fromHalfFloat((px as Uint16Array)[i + k]) * 255 : (px as Uint8Array)[i + k];
      img.data[o + k] = k === 3 ? 255 : Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  g.putImageData(img, 0, 0);
  return new Promise((ok, no) => c.toBlob((b) => (b ? ok(b) : no(new Error('Could not make the image.'))), 'image/png'));
}

/** a sky for the path tracer, as an equirectangular texture: blue overhead to a pale horizon, the sun as a hot disc */
export async function pathSky(sun: THREE.Vector3, horizon: THREE.Color): Promise<THREE.Texture> {
  const { ProceduralEquirectTexture } = await import('three-gpu-pathtracer');
  const t = new ProceduralEquirectTexture(512, 256);
  const s = sun.clone().normalize(), zen = new THREE.Color('#5d86c4'), hz = horizon.clone(), gnd = new THREE.Color('#7d7a72');
  const night = s.y < 0;
  if (night) { zen.set('#05070c'); hz.set('#141a26'); gnd.set('#0a0a0c'); }
  const dir = new THREE.Vector3();
  t.generationCallback = (polar: THREE.Spherical, _uv: THREE.Vector2, _coord: THREE.Vector2, color: THREE.Color) => {
    dir.setFromSpherical(polar);
    const up = dir.y;
    if (up < 0) color.copy(gnd).lerp(hz, Math.max(0, 1 + up * 8));
    else color.copy(hz).lerp(zen, Math.pow(up, 0.5));
    if (!night) { const c = dir.dot(s); if (c > 0.9995) color.setRGB(60, 56, 50); else if (c > 0.99) color.addScalar((c - 0.99) * 40); }
  };
  t.update();
  return t;
}
