// Reference imagery under / over the plan view: the georeferenced Development Plan sheets (tiles/<id>/dp) and XYZ
// map tiles (OpenStreetMap, or imagery the user is entitled to use). Loaded lazily for what's on screen.
// GPU memory is bounded: DP tiles are decoded at the resolution the zoom needs (1000 px down to 125 px a tile),
// without mipmaps; the least recently seen tiles go once the budget is reached, and everything is released when
// the 3D view opens (the plan view's imagery isn't drawn there).
import { pointIn } from '../doc/site';
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
  /** imagery shown as the ground: its own group so it sorts before everything (a group's order wins over its children's) */
  readonly groundGroup = new THREE.Group();
  private dpIndex: DpIndex | null | undefined;
  private quads = new Map<string, Quad>();
  private frame = 0;
  onLoad: () => void = () => {};

  /** imagery tokens by name ({token} in a layer URL) */
  keys: () => Record<string, string> = () => ({});

  constructor(readonly doc: CityDoc, readonly base: string, readonly origin: { lat: number; lon: number; kx: number; kz: number }) {
    this.group.renderOrder = 10;
    this.groundGroup.renderOrder = -100;
  }

  /** bytes of imagery on the GPU (for the performance panel) */
  get bytes() { let s = 0; for (const q of this.quads.values()) s += q.bytes; return s; }
  get count() { return this.quads.size; }

  /** `px`: the decode size wanted (0 = the image's own size). */
  private quad(key: string, layer: string, corners: [number, number][], url: string, opacity: number, order: number, px = 0, ground = false) {
    let q = this.quads.get(key);
    if (q && (q.mat.transparent === ground)) { this.remove(key, q); q = undefined; } // switched between over / ground
    if (!q) {
      const g = new THREE.BufferGeometry();
      // corners: NW, NE, SE, SW in local metres
      const pos = new Float32Array(corners.flatMap(([x, z]) => [x, Y + order * 0.01, z]));
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2));
      g.setIndex([0, 2, 1, 0, 3, 2]);
      // over the map: transparent, drawn last; as the ground: opaque and first, so roads / buildings draw over it
      const mat = new THREE.MeshBasicMaterial({ transparent: !ground, opacity: ground ? 1 : 0, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
      if (ground) mat.visible = false;
      const mesh = new THREE.Mesh(g, mat);
      mesh.renderOrder = ground ? -100 + order : 10 + order;
      mesh.frustumCulled = false;
      q = { mesh, mat, layer, used: this.frame, shown: 0, loading: 0, bytes: 0, dead: false };
      this.quads.set(key, q);
      (ground ? this.groundGroup : this.group).add(mesh);
    }
    q.used = this.frame;
    q.mesh.visible = true;
    if (q.mat.map && q.mat.transparent) q.mat.opacity = opacity;
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
      if (q.mat.transparent) q.mat.opacity = this.opacityOf(q.layer); else q.mat.visible = true;
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
    q.mesh.removeFromParent(); q.mesh.geometry.dispose(); this.dropTexture(q); q.mat.dispose();
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
    this.groundGroup.visible = plan;
    if (!plan) { this.release(); return; }
    const layers = this.doc.all('layer').filter((l) => l.visible && (l.type === 'dp' || (l.type === 'xyz' && l.url)));
    // stale tiles of a layer whose source / offset / mode changed are dropped (keys carry those)
    const live = new Set(layers.map((l) => l.id));
    for (const [k, q] of this.quads) if (!live.has(q.layer)) this.remove(k, q);
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
    const [ox, oz] = L.offset ?? [0, 0];
    const toLL = (x: number, z: number) => ({ lon: o.lon + (x - ox) / o.kx, lat: o.lat - (z - oz) / o.kz });
    const toXZ = (lat: number, lon: number): [number, number] => [(lon - o.lon) * o.kx + ox, -(lat - o.lat) * o.kz + oz];
    const maxZ = L.preset === 'mapbox' ? 20 : 19;
    const z = Math.max(10, Math.min(maxZ, Math.round(Math.log2(156543.03 * Math.cos((o.lat * Math.PI) / 180) * scale))));
    const keys = this.keys();
    const tmpl = L.url!.replace('{token}', encodeURIComponent(keys[L.preset ?? ''] ?? ''));
    if (L.url!.includes('{token}') && !keys[L.preset ?? '']) return; // no token yet
    const ground = L.mode === 'ground';
    const n = 2 ** z;
    const tx = (lon: number) => Math.floor(((lon + 180) / 360) * n);
    const ty = (lat: number) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n); };
    const lon2 = (x: number) => (x / n) * 360 - 180;
    const lat2 = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
    const a = toLL(r[0], r[1]), b = toLL(r[2], r[3]);
    const x0 = tx(a.lon), x1 = tx(b.lon), y0 = ty(a.lat), y1 = ty(b.lat);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 120) return;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const url = tmpl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)).replace('{s}', 'abc'[(x + y) % 3]);
      const c = [toXZ(lat2(y), lon2(x)), toXZ(lat2(y), lon2(x + 1)), toXZ(lat2(y + 1), lon2(x + 1)), toXZ(lat2(y + 1), lon2(x))];
      this.quad(`${L.id}/${L.preset ?? ''}/${ox},${oz}/${z}/${x}/${y}`, L.id, c, url, L.opacity, order + 1, 0, ground);
    }
  }

  // ---------------- draped over the 3D ground ----------------

  /** imagery laid over the terrain in 3D (the studio's square): satellite tiles or the DP sheets, one texture */
  readonly drapeGroup = new THREE.Group();
  private drapeKey = '';
  private drapeGen = 0;

  /** Lay `kind` over the ground in `rect` (x0, z0, x1, z1, local metres) in 3D, leaving out the `hole` (the plot,
   *  which has its own ground); null takes it away. */
  drape(kind: 'satellite' | 'dp' | null, rect: [number, number, number, number] | null, ground: (x: number, z: number) => number, opacity = 1, hole?: number[]) {
    const key = kind && rect ? `${kind}/${rect.map((v) => v.toFixed(0)).join(',')}/${hole?.length ? hole.slice(0, 4).map((v) => v.toFixed(0)).join(',') : ''}` : '';
    if (key === this.drapeKey) { for (const m of this.drapeGroup.children) ((m as THREE.Mesh).material as THREE.MeshBasicNodeMaterial).opacity = opacity; return; }
    this.drapeKey = key;
    const gen = ++this.drapeGen;
    for (const c of [...this.drapeGroup.children]) {
      const m = c as THREE.Mesh, mat = m.material as THREE.MeshBasicNodeMaterial;
      mat.map?.dispose(); mat.dispose(); m.geometry.dispose(); this.drapeGroup.remove(m);
    }
    if (!kind || !rect) { this.onLoad(); return; }
    const [x0, z0, x1, z1] = rect, W = x1 - x0, H = z1 - z0;
    const SIZE = 2048;
    const cv = document.createElement('canvas');
    cv.width = cv.height = SIZE;
    const g2 = cv.getContext('2d')!;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    // a grid over the ground, a hair above it (the plot's own paving sits higher)
    const N = 128, pos = new Float32Array((N + 1) * (N + 1) * 3), uv = new Float32Array((N + 1) * (N + 1) * 2), idx: number[] = [];
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const x = x0 + (W * i) / N, z = z0 + (H * j) / N, k = j * (N + 1) + i;
      pos[k * 3] = x; pos[k * 3 + 1] = ground(x, z) + 0.05; pos[k * 3 + 2] = z;
      uv[k * 2] = i / N; uv[k * 2 + 1] = 1 - j / N;
    }
    const inHole = (k: number) => !!hole && hole.length >= 6 && pointIn(hole, pos[k * 3], pos[k * 3 + 2]);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
      if (inHole(a) || inHole(b) || inHole(c) || inHole(d)) continue;
      idx.push(a, c, b, b, c, d);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshBasicNodeMaterial({ map: tex, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 1;
    this.drapeGroup.add(mesh);
    // local metres → canvas pixels
    const px = (x: number, z: number): [number, number] => [((x - x0) / W) * SIZE, ((z - z0) / H) * SIZE];
    const paint = (url: string, corners: [number, number][]) => {
      fetch(url, { mode: 'cors' }).then((r) => (r.ok ? r.blob() : Promise.reject(r.status))).then((b) => createImageBitmap(b)).then((bmp) => {
        if (gen !== this.drapeGen) { bmp.close(); return; }
        const [a, c] = [px(...corners[0]), px(...corners[2])];
        g2.drawImage(bmp, a[0], a[1], c[0] - a[0], c[1] - a[1]);
        bmp.close();
        tex.needsUpdate = true;
        this.onLoad();
      }).catch(() => {});
    };
    if (kind === 'dp') {
      const go = (ix: DpIndex | null | undefined) => {
        if (!ix) return;
        for (const t of ix.tiles) {
          if (t.x0 + t.size < x0 || t.x0 > x1 || t.z0 + t.size < z0 || t.z0 > z1) continue;
          paint(`${this.base}dp/${t.file}`, [[t.x0, t.z0], [t.x0 + t.size, t.z0], [t.x0 + t.size, t.z0 + t.size], [t.x0, t.z0 + t.size]]);
        }
      };
      if (this.dpIndex !== undefined) go(this.dpIndex);
      else fetch(`${this.base}dp/index.json`).then((x) => (x.ok ? x.json() : null)).then((j) => { this.dpIndex = j; if (gen === this.drapeGen) go(j); }).catch(() => {});
      return;
    }
    // satellite: the imagery layer's source (Esri unless a keyed one is set up), at about a metre to two pixels
    const o = this.origin, L = this.doc.get<'layer'>('satellite');
    const keys = this.keys();
    let tmpl = L?.url ?? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
    if (tmpl.includes('{token}')) {
      const k = keys[L?.preset ?? ''];
      tmpl = k ? tmpl.replace('{token}', encodeURIComponent(k)) : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
    }
    const [ox, oz] = L?.offset ?? [0, 0];
    const toLL = (x: number, z: number) => ({ lon: o.lon + (x - ox) / o.kx, lat: o.lat - (z - oz) / o.kz });
    const toXZ = (lat: number, lon: number): [number, number] => [(lon - o.lon) * o.kx + ox, -(lat - o.lat) * o.kz + oz];
    const mpp = W / SIZE;
    const z = Math.max(12, Math.min(19, Math.round(Math.log2((156543.03 * Math.cos((o.lat * Math.PI) / 180)) / mpp))));
    const n = 2 ** z;
    const tx = (lon: number) => Math.floor(((lon + 180) / 360) * n);
    const ty = (lat: number) => { const r = (lat * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n); };
    const lon2 = (x: number) => (x / n) * 360 - 180;
    const lat2 = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
    const a = toLL(x0, z0), b = toLL(x1, z1);
    const X0 = tx(a.lon), X1 = tx(b.lon), Y0 = ty(a.lat), Y1 = ty(b.lat);
    if ((X1 - X0 + 1) * (Y1 - Y0 + 1) > 400) return;
    for (let x = X0; x <= X1; x++) for (let y = Y0; y <= Y1; y++) {
      const url = tmpl.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)).replace('{s}', 'abc'[(x + y) % 3]);
      paint(url, [toXZ(lat2(y), lon2(x)), toXZ(lat2(y), lon2(x + 1)), toXZ(lat2(y + 1), lon2(x + 1)), toXZ(lat2(y + 1), lon2(x))]);
    }
  }
}
