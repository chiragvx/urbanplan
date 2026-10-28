// Reference imagery under / over the plan view: the georeferenced Development Plan sheets (tiles/<id>/dp) and XYZ
// map tiles (OpenStreetMap, or imagery the user is entitled to use). Loaded lazily for what's on screen.
import * as THREE from 'three/webgpu';
import type { CityDoc } from '../doc/doc';
import type { LayerObj } from '../doc/types';

interface DpIndex { res: number; size: number; tiles: { file: string; x0: number; z0: number; size: number }[]; attribution: string }
interface Quad { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; layer: string; used: number }

const Y = 3000; // above the city, below the plan camera (4000)

export class Reference {
  readonly group = new THREE.Group();
  private dpIndex: DpIndex | null | undefined;
  private quads = new Map<string, Quad>();
  private loader = new THREE.TextureLoader();
  private frame = 0;
  onLoad: () => void = () => {};

  constructor(readonly doc: CityDoc, readonly base: string, readonly origin: { lat: number; lon: number; kx: number; kz: number }) {
    this.group.renderOrder = 10;
    this.loader.setCrossOrigin('anonymous');
  }

  private quad(key: string, layer: string, corners: [number, number][], url: string, opacity: number, order: number) {
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
      q = { mesh, mat, layer, used: this.frame };
      this.quads.set(key, q);
      this.group.add(mesh);
      const qq = q;
      this.loader.load(url, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        qq.mat.map = t; qq.mat.needsUpdate = true;
        qq.mat.opacity = this.opacityOf(layer);
        this.onLoad();
      }, undefined, () => { /* missing tile: leave transparent */ });
    }
    q.used = this.frame;
    q.mesh.visible = true;
    if (q.mat.map) q.mat.opacity = opacity;
  }

  private opacityOf(layer: string) { return this.doc.get<'layer'>(layer)?.opacity ?? 1; }

  /** Show what's visible for the current plan view. `scale` = pixels per metre. */
  update(rect: [number, number, number, number], scale: number, plan: boolean) {
    this.frame++;
    for (const q of this.quads.values()) q.mesh.visible = false;
    this.group.visible = plan;
    if (!plan) return;
    const layers = this.doc.all('layer').filter((l) => l.visible && (l.type === 'dp' || (l.type === 'xyz' && l.url)));
    layers.forEach((L, order) => (L.type === 'dp' ? this.dp(L, rect) : this.xyz(L, rect, scale, order)));
    // forget tiles not used for a while
    if (this.quads.size > 300) {
      for (const [k, q] of [...this.quads].sort((a, b) => a[1].used - b[1].used).slice(0, this.quads.size - 250)) {
        this.group.remove(q.mesh); q.mesh.geometry.dispose(); q.mat.map?.dispose(); q.mat.dispose(); this.quads.delete(k);
      }
    }
  }

  private dp(L: LayerObj, r: [number, number, number, number]) {
    if (this.dpIndex === undefined) {
      this.dpIndex = null;
      fetch(`${this.base}dp/index.json`).then((x) => (x.ok ? x.json() : null)).then((j) => { this.dpIndex = j; this.onLoad(); }).catch(() => {});
      return;
    }
    if (!this.dpIndex) return;
    for (const t of this.dpIndex.tiles) {
      if (t.x0 > r[2] || t.x0 + t.size < r[0] || t.z0 > r[3] || t.z0 + t.size < r[1]) continue;
      const c: [number, number][] = [[t.x0, t.z0], [t.x0 + t.size, t.z0], [t.x0 + t.size, t.z0 + t.size], [t.x0, t.z0 + t.size]];
      this.quad(`dp/${t.file}`, L.id, c, `${this.base}dp/${t.file}`, L.opacity, 0);
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
