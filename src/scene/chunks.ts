// Spatial mesh chunks fed by many small items (road pieces, junctions, buildings). Changing an item rebuilds only the
// chunks it left and entered, so edits upload a few small buffers instead of the whole city.
import * as THREE from 'three/webgpu';
import type { Packed } from '../net/generate';
import { releaseAfterUpload } from '../render/release';

export interface ChunkItem { layers: Partial<Record<string, Packed>>; x0: number; z0: number; x1: number; z1: number }

export interface ChunkMesh { mesh: THREE.Mesh; layer: string; cx: number; cz: number; r: number }

export class ChunkSet<L extends string> {
  private itemChunk = new Map<string, string>();
  private chunkItems = new Map<string, Set<string>>();
  readonly meshes = new Map<string, Map<L, ChunkMesh>>();
  private dirty = new Set<string>();
  visible = true;
  readonly group = new THREE.Group();

  constructor(
    readonly layers: L[],
    readonly materials: Record<L, THREE.Material>,
    readonly getItem: (key: string) => ChunkItem | undefined,
    readonly size = 400,
    readonly opts: Partial<Record<L, { cast?: boolean; receive?: boolean; maxDist?: number; renderOrder?: number }>> = {},
  ) {
    this.group.matrixAutoUpdate = false;
  }

  private chunkOf(it: ChunkItem) {
    const cx = (it.x0 + it.x1) / 2, cz = (it.z0 + it.z1) / 2;
    return `${Math.floor(cx / this.size)},${Math.floor(cz / this.size)}`;
  }

  /** Items (re)built or removed: move them between chunks and mark those chunks for rebuild. */
  touch(keys: Iterable<string>) {
    for (const k of keys) {
      const old = this.itemChunk.get(k);
      if (old) { this.chunkItems.get(old)?.delete(k); this.dirty.add(old); this.itemChunk.delete(k); }
      const it = this.getItem(k);
      if (!it) continue;
      const c = this.chunkOf(it);
      this.itemChunk.set(k, c);
      (this.chunkItems.get(c) ?? this.chunkItems.set(c, new Set()).get(c)!).add(k);
      this.dirty.add(c);
    }
  }

  /** Rebuild dirty chunks (call once per frame / after a batch of touches). Returns how many were rebuilt. */
  flush(): number {
    const n = this.dirty.size;
    for (const c of this.dirty) this.rebuild(c);
    this.dirty.clear();
    return n;
  }

  get pending() { return this.dirty.size > 0; }

  private rebuild(c: string) {
    const keys = this.chunkItems.get(c);
    const have = this.meshes.get(c) ?? new Map<L, ChunkMesh>();
    this.meshes.set(c, have);
    for (const L of this.layers) {
      let nv = 0, ni = 0;
      const parts: Packed[] = [];
      for (const k of keys ?? []) {
        const p = this.getItem(k)?.layers[L];
        if (!p) continue;
        parts.push(p); nv += p.pos.length / 3; ni += p.idx.length;
      }
      const cur = have.get(L);
      if (!nv) {
        if (cur) { this.group.remove(cur.mesh); cur.mesh.geometry.dispose(); have.delete(L); }
        continue;
      }
      const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), col = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
      const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
      let v = 0, i = 0;
      for (const p of parts) {
        pos.set(p.pos, v * 3); nor.set(p.nor, v * 3); col.set(p.col, v * 3); uv.set(p.uv, v * 2);
        for (let k = 0; k < p.idx.length; k++) idx[i + k] = p.idx[k] + v;
        v += p.pos.length / 3; i += p.idx.length;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      g.computeBoundingSphere();
      releaseAfterUpload(g);
      const s = g.boundingSphere!;
      if (cur) {
        cur.mesh.geometry.dispose();
        cur.mesh.geometry = g;
        cur.cx = s.center.x; cur.cz = s.center.z; cur.r = s.radius;
      } else {
        const m = new THREE.Mesh(g, this.materials[L]);
        const o = this.opts[L] ?? {};
        m.castShadow = !!o.cast;
        m.receiveShadow = o.receive ?? true;
        m.matrixAutoUpdate = false;
        if (o.renderOrder !== undefined) m.renderOrder = o.renderOrder;
        this.group.add(m);
        have.set(L, { mesh: m, layer: L, cx: s.center.x, cz: s.center.z, r: s.radius });
      }
    }
  }

  setMaterial(L: L, m: THREE.Material) {
    this.materials[L] = m;
    for (const c of this.meshes.values()) { const x = c.get(L); if (x) x.mesh.material = m; }
  }

  setShadows(cast: boolean) {
    for (const c of this.meshes.values()) for (const [L, x] of c) x.mesh.castShadow = cast && !!this.opts[L]?.cast;
  }

  /** Per-frame distance culling (frustum culling is automatic per mesh). */
  cull(cx: number, cz: number, slack: number) {
    for (const c of this.meshes.values()) for (const [L, x] of c) {
      const max = this.opts[L]?.maxDist;
      x.mesh.visible = !max || Math.hypot(x.cx - cx, x.cz - cz) - x.r < max + slack;
    }
  }

  showAll() { for (const c of this.meshes.values()) for (const x of c.values()) x.mesh.visible = true; }
}
