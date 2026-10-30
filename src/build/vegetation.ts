// Trees: OSM-mapped trees + parks/woods + street trees along lanes, avoiding roads, buildings and water.
// Instanced per 500 m chunk with two LODs.
import * as THREE from 'three/webgpu';
import type { TileData } from '../data/tile';
import type { Heightfield } from '../geo/heightfield';
import type { RoadRaster } from '../geo/roadraster';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 2 m occupancy raster: 1 = blocked (building, road, water). */
class Occupancy {
  readonly cell = 2;
  readonly n: number;
  readonly grid: Uint8Array;
  readonly x0: number; readonly z0: number;
  constructor(readonly half: number, ox = 0, oz = 0) {
    this.n = Math.ceil((half * 2) / this.cell);
    this.grid = new Uint8Array(this.n * this.n);
    this.x0 = ox - half; this.z0 = oz - half;
  }
  fill(ring: Float32Array, pad = 0) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]); }
    const n = this.n, c = this.cell, gx = this.x0, gz = this.z0;
    const j0 = Math.max(0, Math.floor((z0 - pad - gz) / c)), j1 = Math.min(n - 1, Math.ceil((z1 + pad - gz) / c));
    const m = ring.length / 2;
    for (let j = j0; j <= j1; j++) {
      const z = gz + (j + 0.5) * c;
      const xs: number[] = [];
      for (let a = 0; a < m; a++) {
        const b = (a + 1) % m;
        const az = ring[a * 2 + 1], bz = ring[b * 2 + 1];
        if ((az > z) !== (bz > z)) xs.push(ring[a * 2] + ((z - az) / (bz - az)) * (ring[b * 2] - ring[a * 2]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.floor((xs[k] - pad - gx) / c)), i1 = Math.min(n - 1, Math.ceil((xs[k + 1] + pad - gx) / c));
        for (let i = i0; i <= i1; i++) this.grid[j * n + i] = 1;
      }
    }
  }
  free(x: number, z: number, r = 1) {
    const n = this.n, c = this.cell;
    const ci = Math.floor((x - this.x0) / c), cj = Math.floor((z - this.z0) / c);
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= n || j >= n || this.grid[j * n + i]) return false;
    }
    return true;
  }
  mark(x: number, z: number) {
    const i = Math.floor((x - this.x0) / this.cell), j = Math.floor((z - this.z0) / this.cell);
    if (i >= 0 && j >= 0 && i < this.n && j < this.n) this.grid[j * this.n + i] = 1;
  }
}

export interface TreeInstance { x: number; z: number; y: number; s: number; h: number; rot: number; tint: number }

export interface StreetLine { pts: Float32Array; hw: number; cls: string }

export function placeTrees(tile: TileData, hf: Heightfield, streets: StreetLine[], roads: RoadRaster): TreeInstance[] {
  const ox = tile.ox ?? 0, oz = tile.oz ?? 0, H = tile.half;
  const occ = new Occupancy(H, ox, oz);
  for (const b of tile.buildings) occ.fill(b.outer, 1);
  // roads: copy the road raster (same 2 m grid) with a 1-cell margin
  for (let j = 0; j < occ.n; j++) for (let i = 0; i < occ.n; i++) {
    const x = occ.x0 + (i + 0.5) * occ.cell, z = occ.z0 + (j + 0.5) * occ.cell;
    if (roads.onRoad(x, z) || roads.onRoad(x + 1.5, z) || roads.onRoad(x - 1.5, z) || roads.onRoad(x, z + 1.5) || roads.onRoad(x, z - 1.5)) occ.grid[j * occ.n + i] = 1;
  }
  for (const w of tile.waters) occ.fill(w.outer, 1);
  const rand = rng(1234);
  const out: TreeInstance[] = [];
  const put = (x: number, z: number, big = 1) => {
    const s = (4.5 + rand() * 4.5) * big;
    out.push({ x, z, y: hf.sampleSurface(x, z) - 0.2, s, h: s * (1.05 + rand() * 0.45), rot: rand() * Math.PI * 2, tint: rand() });
    occ.mark(x, z);
  };

  // 1) Trees that people have actually mapped
  for (let i = 0; i < tile.trees.length; i += 2) put(tile.trees[i], tile.trees[i + 1], 1.2);

  // 2) Parks, woods, institutions, riverbanks
  const DENS: Record<number, number> = { 4: 1 / 45, 3: 1 / 160, 14: 1 / 120, 7: 1 / 420, 12: 1 / 140, 0: 1 / 900, 6: 1 / 700 };
  for (const a of tile.areas) {
    const d = DENS[a.kind];
    if (!d) continue;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < a.outer.length; i += 2) { x0 = Math.min(x0, a.outer[i]); x1 = Math.max(x1, a.outer[i]); z0 = Math.min(z0, a.outer[i + 1]); z1 = Math.max(z1, a.outer[i + 1]); }
    const tries = Math.min(20000, Math.floor((x1 - x0) * (z1 - z0) * d));
    for (let k = 0; k < tries; k++) {
      const x = x0 + rand() * (x1 - x0), z = z0 + rand() * (z1 - z0);
      if (Math.abs(x - ox) > H - 2 || Math.abs(z - oz) > H - 2) continue;
      if (inRing(x, z, a.outer) && !a.holes.some((h) => inRing(x, z, h)) && occ.free(x, z, 1)) put(x, z);
    }
  }

  // 3) Street trees: Koregaon Park's lanes are lined with rain trees — place them just outside the road edge
  for (const r of streets) {
    if (!['residential', 'tertiary', 'secondary', 'unclassified', 'living_street', 'primary'].includes(r.cls)) continue;
    const c = r.pts, m = c.length / 2;
    let acc = rand() * 10;
    for (let i = 0; i < m - 1; i++) {
      const ax = c[i * 2], az = c[i * 2 + 1], bx = c[i * 2 + 2], bz = c[i * 2 + 3];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 0.01) continue;
      const nx = (bz - az) / L, nz = -(bx - ax) / L;
      while (acc < L) {
        const t = acc / L, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        for (const sg of [1, -1]) {
          const off = r.hw + 1.4 + rand() * 1.5;
          const tx = x + nx * off * sg, tz = z + nz * off * sg;
          if (rand() < 0.62 && occ.free(tx, tz, 1)) put(tx, tz, 1.15);
        }
        acc += 9 + rand() * 7;
      }
      acc -= L;
    }
  }

  // 4) Sparse greenery in leftover open ground
  const tries = Math.round(60000 * ((2 * H) * (2 * H)) / 25e6); // as many per km² as the 5 km tile had
  for (let k = 0; k < tries; k++) {
    const x = ox + (rand() * 2 - 1) * (H - 3), z = oz + (rand() * 2 - 1) * (H - 3);
    if (rand() < 0.75) continue;
    if (occ.free(x, z, 2)) put(x, z, 0.9);
  }
  return out;
}

function inRing(x: number, z: number, r: Float32Array) {
  let c = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2], zi = r[i * 2 + 1], xj = r[j * 2], zj = r[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

/** Tree geometry: trunk + clustered faceted crown. Unit height ≈ 1. */
export function treeGeometry(detail: 'high' | 'low'): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  // cheap faceted trees: ~76 triangles near, ~32 far
  const trunk = new THREE.CylinderGeometry(0.035, 0.05, 0.5, detail === 'high' ? 4 : 3, 1, true);
  trunk.translate(0, 0.25, 0);
  paint(trunk, 0x5a4532);
  parts.push(trunk);
  if (detail === 'low') {
    // far trees: an 8-triangle crown only (trunk invisible at this distance)
    const g = new THREE.OctahedronGeometry(0.38, 0);
    g.scale(1, 0.8, 1);
    g.translate(0, 0.62, 0);
    paint(g, 0xffffff);
    const m = g.index ? g.toNonIndexed() : g;
    m.computeVertexNormals();
    return m;
  }
  const blobs: [number, number, number, number][] = [[0, 0.68, 0, 0.3], [0.15, 0.58, 0.07, 0.23], [-0.13, 0.6, -0.08, 0.24]];
  for (const [x, y, z, r] of blobs) {
    const g = new THREE.IcosahedronGeometry(r, 0);
    g.scale(1, 0.82, 1);
    g.translate(x, y, z);
    paint(g, 0xffffff);
    parts.push(g.index ? g.toNonIndexed() : g);
  }
  const merged = mergeNonIndexed(parts.map((p) => (p.index ? p.toNonIndexed() : p)));
  merged.computeVertexNormals();
  return merged;
}

function paint(g: THREE.BufferGeometry, hex: number) {
  const c = new THREE.Color(hex);
  const n = g.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

function mergeNonIndexed(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array as Float32Array, o * 3);
    col.set(p.attributes.color.array as Float32Array, o * 3);
    o += p.attributes.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const GREENS = [0x4f7a32, 0x5d8a3a, 0x46702c, 0x6b9443, 0x3f6828, 0x789d48, 0x587f30, 0x6e8c3a];

/** Build chunked instanced meshes (high + low LOD per chunk). */
export function buildTreeMeshes(trees: TreeInstance[], half: number, material: THREE.Material) {
  const CH = 800;
  const nc = Math.ceil((half * 2) / CH);
  const buckets: TreeInstance[][] = Array.from({ length: nc * nc }, () => []);
  for (const t of trees) {
    const i = Math.min(nc - 1, Math.max(0, Math.floor((t.x + half) / CH)));
    const j = Math.min(nc - 1, Math.max(0, Math.floor((t.z + half) / CH)));
    buckets[j * nc + i].push(t);
  }
  const hi = treeGeometry('high'), lo = treeGeometry('low');
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();
  const chunks: { center: THREE.Vector3; high: THREE.InstancedMesh; low: THREE.InstancedMesh }[] = [];
  buckets.forEach((list, k) => {
    if (!list.length) return;
    const make = (geo: THREE.BufferGeometry) => {
      const im = new THREE.InstancedMesh(geo, material, list.length);
      list.forEach((t, i) => {
        q.setFromAxisAngle(up, t.rot);
        s.set(t.s, t.h, t.s);
        p.set(t.x, t.y, t.z);
        m.compose(p, q, s);
        im.setMatrixAt(i, m);
        col.setHex(GREENS[Math.floor(t.tint * GREENS.length)]);
        im.setColorAt(i, col);
      });
      im.castShadow = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      return im;
    };
    const i = k % nc, j = Math.floor(k / nc);
    chunks.push({ center: new THREE.Vector3(-half + (i + 0.5) * CH, 0, -half + (j + 0.5) * CH), high: make(hi), low: make(lo) });
  });
  return chunks;
}
