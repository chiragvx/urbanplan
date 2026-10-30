// The far view of a region: the whole city as 32 m terrain wearing a land-cover image, and its roads as simple
// ribbons — one chunk per 2 km piece. It fills in everywhere outside the detailed window (3D: out to the haze), and
// is the whole map in 2D when zoomed out past the window (detail would be sub-pixel there anyway). Roads keep a
// minimum on-screen width in 2D (a vertex-shader widening), so the network still reads at city scale.
import * as THREE from 'three/webgpu';
import { texture, positionWorld, positionLocal, vec2, vec3, float, mix, uniform, attribute, max, vertexColor } from 'three/tsl';
import { releaseAfterUpload } from '../render/release';
import { fetchGz, type RegionManifest } from '../data/region';
import { planDark } from './world';

interface Chunk { key: string; cx: number; cz: number; terrain: THREE.Mesh; major?: THREE.Mesh; minor?: THREE.Mesh }
interface RoadBucket { k: string; sections: { name: string; offset: number; length: number; type: string }[] }

// road colours by class rank (linear-ish RGB): main roads darker
const ROAD_RGB = (cls: number): [number, number, number] => (cls <= 2 ? [0.2, 0.21, 0.23] : cls <= 4 ? [0.26, 0.27, 0.29] : [0.33, 0.34, 0.36]);

export class Overview {
  readonly group = new THREE.Group();
  readonly chunks = new Map<string, Chunk>();
  /** roads are drawn at least this half-width (m): set from the view scale in 2D, 0 in 3D */
  readonly minHalf = uniform(0);
  ready = false;
  private plan = false;
  private mats!: { t3: THREE.Material; tP: THREE.Material; r3: THREE.Material; rP: THREE.Material };
  private grid!: { n: number; m: number; cell: number; x0: number; z0: number; h: Float32Array };

  constructor(readonly M: RegionManifest, readonly base: string) {
    this.group.matrixAutoUpdate = false;
  }

  async load() {
    const [hdr, bin, img] = await Promise.all([
      fetch(this.base + 'overview.json').then((r) => r.json()),
      fetchGz(this.base + 'overview.bin.gz'),
      new THREE.TextureLoader().loadAsync(this.base + 'landuse.png'),
    ]);
    img.colorSpace = THREE.SRGBColorSpace;
    img.anisotropy = 8;
    const sec = (name: string) => hdr.sections.find((s: { name: string }) => s.name === name);
    const ts = sec('terrain');
    const T = hdr.terrain;
    this.grid = { n: T.n, m: T.m, cell: T.cell, x0: T.x0, z0: T.z0, h: new Float32Array(bin, ts.offset, ts.length) };
    // materials: land cover by world position over the region's bounds
    const [bx0, bz0, bx1, bz1] = this.M.bounds;
    const uvR = vec2(positionWorld.x.sub(bx0).div(bx1 - bx0), float(1).sub(positionWorld.z.sub(bz0).div(bz1 - bz0)));
    const lu = texture(img, uvR).rgb;
    const t3 = new THREE.MeshLambertNodeMaterial();
    t3.colorNode = lu;
    const tP = new THREE.MeshBasicNodeMaterial();
    tP.colorNode = mix(mix(lu, vec3(0.93, 0.92, 0.89), float(0.35)), mix(lu, vec3(0.012, 0.014, 0.018), float(0.9)), planDark);
    const nrm = attribute('nrm', 'vec2');
    const widen = positionLocal.add(vec3(nrm.x, float(0), nrm.y).mul(max(attribute('hw', 'float'), this.minHalf)));
    const r3 = new THREE.MeshLambertNodeMaterial();
    r3.colorNode = vertexColor().rgb; r3.positionNode = widen; r3.normalNode = vec3(0, 1, 0);
    r3.polygonOffset = true; r3.polygonOffsetFactor = -2; r3.polygonOffsetUnits = -2;
    const rP = new THREE.MeshBasicNodeMaterial();
    const c = vertexColor().rgb;
    rP.colorNode = mix(c, c.mul(0.55).add(0.03), planDark); rP.positionNode = widen;
    rP.polygonOffset = true; rP.polygonOffsetFactor = -2; rP.polygonOffsetUnits = -2;
    this.mats = { t3, tP, r3, rP };
    // chunks are built a few at a time (`build`), nearest the view first
    this.bin = bin;
    this.roadIndex = new Map((hdr.roads as RoadBucket[]).map((r) => [r.k, r]));
    for (let j = this.M.grid.j0; j <= this.M.grid.j1; j++) for (let i = this.M.grid.i0; i <= this.M.grid.i1; i++) this.todo.push([i, j]);
    this.ready = true;
  }

  private bin!: ArrayBuffer;
  private roadIndex = new Map<string, RoadBucket>();
  private todo: [number, number][] = [];
  get pending() { return this.todo.length; }

  /** Build up to `budget` ms of chunks, nearest (x, z) first. Returns whether any were built. */
  build(x: number, z: number, budget = 12): boolean {
    if (!this.ready || !this.todo.length) return false;
    const P = this.M.piece, T = this.grid, per = P / T.cell;
    this.todo.sort((a, b) => Math.hypot((b[0] + 0.5) * P - x, (b[1] + 0.5) * P - z) - Math.hypot((a[0] + 0.5) * P - x, (a[1] + 0.5) * P - z));
    const t0 = performance.now();
    while (this.todo.length && performance.now() - t0 < budget) {
      const [i, j] = this.todo.pop()!;
      const key = `${i}_${j}`;
      const gi0 = (i * P - T.x0) / T.cell, gj0 = (j * P - T.z0) / T.cell;
      const terrain = new THREE.Mesh(this.terrainPatch(gi0, gj0, per), this.plan ? this.mats.tP : this.mats.t3);
      releaseAfterUpload(terrain.geometry);
      terrain.matrixAutoUpdate = false; terrain.receiveShadow = true;
      const ch: Chunk = { key, cx: (i + 0.5) * P, cz: (j + 0.5) * P, terrain };
      this.chunks.set(key, ch);
      this.group.add(terrain);
      const b = this.roadIndex.get(key);
      if (b) {
        const S = (name: string) => b.sections.find((s) => s.name === name)!;
        const arr = (name: string) => { const s = S(name); const C = s.type === 'Float32Array' ? Float32Array : s.type === 'Uint32Array' ? Uint32Array : Uint8Array; return new C(this.bin, s.offset, s.length); };
        const pts = arr('pts') as Float32Array, start = arr('start') as Uint32Array, count = arr('count') as Uint32Array, cls = arr('cls') as Uint8Array, hw = arr('hw') as Float32Array;
        for (const major of [true, false]) {
          const g = this.ribbons(pts, start, count, cls, hw, (c) => (c <= 4) === major);
          if (!g) continue;
          releaseAfterUpload(g);
          const m = new THREE.Mesh(g, this.plan ? this.mats.rP : this.mats.r3);
          m.matrixAutoUpdate = false; m.frustumCulled = false; m.receiveShadow = true;
          if (major) ch.major = m; else ch.minor = m;
          this.group.add(m);
        }
      }
      // hidden until the next `update` places it
      for (const m of [ch.terrain, ch.major, ch.minor]) if (m) m.visible = false;
    }
    if (!this.todo.length) this.roadIndex.clear();
    return true;
  }

  /** Overview ground height (scene metres, a little under the detailed terrain so the two never fight). */
  height(x: number, z: number) {
    const G = this.grid;
    let fx = (x - G.x0) / G.cell, fz = (z - G.z0) / G.cell;
    fx = Math.min(Math.max(fx, 0), G.n - 1.0001); fz = Math.min(Math.max(fz, 0), G.m - 1.0001);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * G.n + i;
    return (G.h[k] * (1 - tx) + G.h[k + 1] * tx) * (1 - tz) + (G.h[k + G.n] * (1 - tx) + G.h[k + G.n + 1] * tx) * tz - this.M.base - 0.8;
  }

  private terrainPatch(gi0: number, gj0: number, per: number) {
    const G = this.grid, n = per + 1;
    const pos = new Float32Array(n * n * 3), nor = new Float32Array(n * n * 3);
    const H = (i: number, j: number) => G.h[Math.min(G.m - 1, Math.max(0, j)) * G.n + Math.min(G.n - 1, Math.max(0, i))] - this.M.base - 0.8;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const k = j * n + i, gi = gi0 + i, gj = gj0 + j;
      pos[k * 3] = G.x0 + gi * G.cell; pos[k * 3 + 1] = H(gi, gj); pos[k * 3 + 2] = G.z0 + gj * G.cell;
      const nx = H(gi - 1, gj) - H(gi + 1, gj), ny = 2 * G.cell, nz = H(gi, gj - 1) - H(gi, gj + 1), L = Math.hypot(nx, ny, nz);
      nor[k * 3] = nx / L; nor[k * 3 + 1] = ny / L; nor[k * 3 + 2] = nz / L;
    }
    const idx = new Uint16Array(per * per * 6);
    let o = 0;
    for (let j = 0; j < per; j++) for (let i = 0; i < per; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    return g;
  }

  /** Flat ribbons along polylines: centre-line vertices + an outward unit normal and half-width (widened in the shader). */
  private ribbons(pts: Float32Array, start: Uint32Array, count: Uint32Array, cls: Uint8Array, hw: Float32Array, keep: (c: number) => boolean) {
    let nv = 0;
    for (let k = 0; k < start.length; k++) if (keep(cls[k])) nv += count[k] * 2;
    if (!nv) return null;
    const pos = new Float32Array(nv * 3), nrm = new Float32Array(nv * 2), w = new Float32Array(nv), col = new Uint8Array(nv * 3);
    const idx: number[] = [];
    let v = 0;
    for (let k = 0; k < start.length; k++) {
      if (!keep(cls[k])) continue;
      const s = start[k], m = count[k], rgb = ROAD_RGB(cls[k]);
      for (let q = 0; q < m; q++) {
        const a = Math.max(0, q - 1), b = Math.min(m - 1, q + 1);
        const dx = pts[(s + b) * 2] - pts[(s + a) * 2], dz = pts[(s + b) * 2 + 1] - pts[(s + a) * 2 + 1], L = Math.hypot(dx, dz) || 1;
        const nx = -dz / L, nz = dx / L, x = pts[(s + q) * 2], z = pts[(s + q) * 2 + 1], y = this.height(x, z) + 1.0;
        for (const sg of [1, -1]) {
          pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
          nrm[v * 2] = nx * sg; nrm[v * 2 + 1] = nz * sg;
          w[v] = Math.max(2, hw[k]);
          col[v * 3] = rgb[0] * 255; col[v * 3 + 1] = rgb[1] * 255; col[v * 3 + 2] = rgb[2] * 255;
          v++;
        }
        if (q < m - 1) { const i0 = v - 2; idx.push(i0, i0 + 2, i0 + 1, i0 + 1, i0 + 2, i0 + 3); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
    g.setAttribute('nrm', new THREE.BufferAttribute(nrm, 2));
    g.setAttribute('hw', new THREE.BufferAttribute(w, 1));
    g.setIndex(v > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    return g;
  }

  setPlan(on: boolean) {
    this.plan = on;
    if (!this.ready) return;
    for (const c of this.chunks.values()) {
      c.terrain.material = on ? this.mats.tP : this.mats.t3;
      for (const r of [c.major, c.minor]) if (r) r.material = on ? this.mats.rP : this.mats.r3;
    }
  }

  /**
   * Which chunks show. `all`: the whole map (2D zoomed out); otherwise everything but the detailed window's pieces.
   * In 3D, chunks past the haze are dropped and minor roads only drawn within a few km.
   */
  update(resident: Set<string>, all: boolean, view: { x: number; z: number; width: number; plan: boolean }) {
    if (!this.ready) return;
    for (const c of this.chunks.values()) {
      const d = Math.hypot(c.cx - view.x, c.cz - view.z);
      const show = (all || !resident.has(c.key)) && (view.plan || d < 13000);
      c.terrain.visible = show;
      if (c.major) c.major.visible = show;
      if (c.minor) c.minor.visible = show && (view.plan ? view.width < 14000 : d < 5000);
    }
  }
}
