// Free the JavaScript copies of geometry once the GPU has it. Chunk meshes are rebuilt from their sources (mesher
// items, the heightfield) when they change and nothing reads their arrays back, so after upload the arrays are only
// memory. Each array is swapped for an empty one of the same type: the renderer still reads the type (vertex format)
// and `count` (draw range), never the data again.
import type * as THREE from 'three/webgpu';

const pending = new Set<THREE.BufferGeometry>();

/** Release this geometry's arrays after its first full upload. */
export function releaseAfterUpload(g: THREE.BufferGeometry) {
  if (pending.has(g)) return;
  pending.add(g);
  g.addEventListener('dispose', () => pending.delete(g));
}

/** Call after rendering: frees what has been uploaded. */
export function releaseUploaded(renderer: THREE.WebGPURenderer, budget = 256) {
  if (!pending.size) return;
  const backend = (renderer as unknown as { backend: { has(o: object): boolean; get(o: object): { buffer?: unknown } } }).backend;
  const onGpu = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) => backend.has(a) && !!backend.get(a).buffer;
  for (const g of pending) {
    if (budget <= 0) break;
    const attrs = Object.values(g.attributes) as THREE.BufferAttribute[];
    if (g.index) attrs.push(g.index);
    // attribute by attribute: one a material never reads (e.g. uv on lane markings) is never uploaded, and stays
    let left = 0;
    for (const a of attrs) {
      if (!a.array.length) continue;
      if (!onGpu(a)) { left++; continue; }
      const arr = a.array as unknown as { constructor: new (n: number) => THREE.TypedArray };
      a.array = new arr.constructor(0);
      budget--;
    }
    if (!left) pending.delete(g);
  }
}

export const pendingReleases = () => pending.size;
