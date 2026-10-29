// Reference imagery under / over the plan view: the georeferenced Development Plan sheets (tiles/<id>/dp) and XYZ
// map tiles (OpenStreetMap, or imagery the user is entitled to use). Loaded lazily for what's on screen.
// GPU memory is bounded: DP tiles are decoded at the resolution the zoom needs (1000 px down to 125 px a tile),
// without mipmaps; the least recently seen tiles go once the budget is reached, and everything is released when
// the 3D view opens (the plan view's imagery isn't drawn there).
import * as THREE from 'three/webgpu';
import type { CityDoc } from '../doc/doc';
import type { LayerObj } from '../doc/types';

interface DpIndex { res: number; size: number; tiles: { file: string; x0: number; z0: number; size: number }[]; attribution: string }
interface Quad {
  mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; layer: string; used: number;
  /** decoded width of the texture shown / being loaded (px) */
  shown: number; loading: number; bytes: number; dead: boolean; bitmap?: ImageBitmap;
}

const Y = 3000; // above the city, below the plan camera (4000)
/** GPU budget for reference imagery (RGBA bytes) */
const BUDGET = 96e6;
/** decode sizes for a DP tile (px a side) */
const LEVELS = [125, 250, 500, 1000];

export class Reference {
  readonly group = new THREE.Group();
  private dpIndex: DpIndex | null | undefined;
  private quads = new Map<string, Quad>();
  private frame = 0;
  onLoad: () => void = () => {};

  constructor(readonly doc: CityDoc, readonly base: string, readonly origin: { lat: number; lon: number; kx: number; kz: number }) {
    this.group.renderOrder = 10;
  }

  /** bytes of imagery on the GPU (for the performance panel) */
  get bytes() { let s = 0; for (const q of this.quads.values()) s += q.bytes; return s; }
  get count() { return this.quads.size; }

  /** `px`: the decode size wanted (0 = the image's own size). */
  private quad(key: string, layer: string, corners: [number, number][], url: string, opacity: number, order: number, px = 0) {
    let q = this.quads.get(key);
    if (!q) {
      const g = new THREE.BufferGeometry();
      // corners: NW, NE, SE, SW in local metres
      const pos = new Float32Array(corners.flatMap(([x, z]) => [x, Y + order * 0.01, z]));
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2));
      g.setIndex([0, 2, 1, 0, 3, 2]);
      const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      const mesh = new THREE.Mesh(g, mat);
      mesh.renderOrder = 10 + order;
      mesh.frustumCulled = false;
      q = { mesh, mat, layer, used: this.frame, shown: 0, loading: 0, bytes: 0, dead: false };
      this.quads.set(key, q);
      this.group.add(mesh);
    }
    q.used = this.frame;
    q.mesh.visible = true;
    if (q.mat.map) q.mat.opacity = opacity;
    // (re)load at the size the zoom needs; the current texture stays up until the new one arrives
    const want = px || -1;
    if (q.shown !== want && q.loading !== want) this.load(q, url, want);
  }

  private async load(q: Quad, url: string, px: number) {
    q.loading = px;
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      if (q.dead || q.loading !== px) return;
      const bmp = await createImageBitmap(blob, px > 0 ? { resizeWidth: px, resizeHeight: px, resizeQuality: 'medium' } : {});
      if (q.dead || q.loading !== px) { bmp.close(); return; }
      const t = new THREE.Texture(bmp as unknown as HTMLImageElement);
      t.colorSpace = THREE.SRGBColorSpace;
      t.generateMipmaps = false;
      t.minFilter = THREE.LinearFilter;
      t.needsUpdate = true;
      this.dropTexture(q);
      q.mat.map = t; q.mat.needsUpdate = true;
      q.mat.opacity = this.opacityOf(q.layer);
      q.bitmap = bmp;
      q.shown = px; q.loading = 0;
      q.bytes = bmp.width * bmp.height * 4;
      this.onLoad();
    } catch {
      /* missing tile: leave transparent */
      if (q.loading === px) q.loading = 0;
      q.shown = px;
    }
  }

  private dropTexture(q: Quad) {
    q.mat.map?.dispose();
    q.mat.map = null;
    // close the decoded image a little later: a frame already queued may still upload from it
    const b = q.bitmap;
    if (b) setTimeout(() => b.close(), 2000);
    q.bitmap = undefined;
    q.bytes = 0;
  }

  private remove(k: string, q: Quad) {
    q.dead = true;
    this.group.remove(q.mesh); q.mesh.geometry.dispose(); this.dropTexture(q); q.mat.dispose();
    this.quads.delete(k);
  }

  /** Free all imagery (the 3D view doesn't show it; the browser's HTTP cache makes coming back cheap). */
  release() { for (const [k, q] of this.quads) this.remove(k, q); }

  private opacityOf(layer: string) { return this.doc.get<'layer'>(layer)?.opacity ?? 1; }

  /** Show what's visible for the current plan view. `scale` = pixels per metre. */
  update(rect: [number, number, number, number], scale: number, plan: boolean) {
    this.frame++;
    for (const q of this.quads.values()) q.mesh.visible = false;
    this.group.visible = plan;
    if (!plan) { this.release(); return; }
    const layers = this.doc.all('layer').filter((l) => l.visible && (l.type === 'dp' || (l.type === 'xyz' && l.url)));
    layers.forEach((L, order) => (L.type === 'dp' ? this.dp(L, rect, scale) : this.xyz(L, rect, scale, order)));
    // over budget: forget the tiles seen least recently (never the ones on screen)
    let bytes = this.bytes;
    if (bytes > BUDGET || this.quads.size > 200) {
      for (const [k, q] of [...this.quads].sort((a, b) => a[1].used - b[1].used)) {
        if (q.used === this.frame || (bytes <= BUDGET && this.quads.size <= 200)) break;
        bytes -= q.bytes;
        this.remove(k, q);
      }
    }
  }

  private dp(L: LayerObj, r: [number, number, number, number], scale: number) {
    if (this.dpIndex === undefined) {
      this.dpIndex = null;
      fetch(`${this.base}dp/index.json`).then((x) => (x.ok ? x.json() : null)).then((j) => { this.dpIndex = j; this.onLoad(); }).catch(() => {});
      return;
    }
    if (!this.dpIndex) return;
    const dpr = window.devicePixelRatio || 1;
    for (const t of this.dpIndex.tiles) {
      if (t.x0 > r[2] || t.x0 + t.size < r[0] || t.z0 > r[3] || t.z0 + t.size < r[1]) continue;
      // device pixels the tile covers on screen → the smallest decode size that still looks sharp
      const onScreen = t.size * scale * dpr;
      const full = Math.round(t.size / this.dpIndex.res);
      const px = Math.min(full, LEVELS.find((l) => l >= onScreen * 0.9) ?? full);
      const c: [number, number][] = [[t.x0, t.z0], [t.x0 + t.size, t.z0], [t.x0 + t.size, t.z0 + t.size], [t.x0, t.z0 + t.size]];
      this.quad(`dp/${t.file}`, L.id, c, `${this.base}dp/${t.file}`, L.opacity, 0, px);
    }
  }

  private xyz(L: LayerObj, r: [number, number, number, number], scale: number, order: number) {
    const o = this.origin;
    const toLL = (x: number, z: number) => ({ lon: o.lon + x / o.kx, lat: o.lat - z / o.kz });
    const toXZ = (lat: number, lon: number): [number, number] => [(lon - o.lon) * o.kx, -(lat - o.lat) * o.kz];
    const z = Math.max(10, Math.min(19, Math.round(Math.log2(156543.03 * Math.cos((o.lat * Math.PI) / 180) * scale))));
    const n = 2 ** z;
    const tx = (lon: number) => Math.floor(((lon + 180) / 360) * n);
    const ty = (lat: number) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n); };
    const lon2 = (x: number) => (x / n) * 360 - 180;
    const lat2 = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
    const a = toLL(r[0], r[1]), b = toLL(r[2], r[3]);
    const x0 = tx(a.lon), x1 = tx(b.lon), y0 = ty(a.lat), y1 = ty(b.lat);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 120) return;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const url = L.url!.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)).replace('{s}', 'abc'[(x + y) % 3]);
      const c = [toXZ(lat2(y), lon2(x)), toXZ(lat2(y), lon2(x + 1)), toXZ(lat2(y + 1), lon2(x + 1)), toXZ(lat2(y + 1), lon2(x))];
      this.quad(`${L.id}/${z}/${x}/${y}`, L.id, c, url, L.opacity, order + 1);
    }
  }
}
