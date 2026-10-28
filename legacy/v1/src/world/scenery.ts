// Scenery placement: trees, street furniture. Deterministic so every player sees the same Baner.
import { InstanceGroup } from '../engine/mesh';
import { hex, rng, hash01 } from '../engine/math';
import { type Tile, type Road, type RoadProps, carriageway, roadSides, sampleRoad } from './tile';
import { junctionRadius } from './meshgen';

const TREE_GREENS = [0x5d8a3a, 0x4f7d34, 0x6b9443, 0x47712f, 0x789d48, 0x3f6a2c, 0x86a04c];
const greenFor = (i: number) => hex(TREE_GREENS[Math.floor(hash01(i) * TREE_GREENS.length)]);

/** Coarse occupancy raster (4 m cells) so scattered trees avoid buildings & roads. */
class Occupancy {
  cell = 4;
  n: number;
  grid: Uint8Array;
  constructor(public half: number) {
    this.n = Math.ceil((half * 2) / this.cell);
    this.grid = new Uint8Array(this.n * this.n);
  }
  idx(x: number, z: number) {
    const i = Math.floor((x + this.half) / this.cell), j = Math.floor((z + this.half) / this.cell);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return -1;
    return j * this.n + i;
  }
  mark(x: number, z: number) { const k = this.idx(x, z); if (k >= 0) this.grid[k] = 1; }
  free(x: number, z: number) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const k = this.idx(x + dx * this.cell, z + dz * this.cell);
      if (k < 0 || this.grid[k]) return false;
    }
    return true;
  }
}

function pointInRing(x: number, z: number, r: Float32Array): boolean {
  let inside = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2], zi = r[i * 2 + 1], xj = r[j * 2], zj = r[j * 2 + 1];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function ringBBox(r: Float32Array) {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < r.length; i += 2) {
    x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); z0 = Math.min(z0, r[i + 1]); z1 = Math.max(z1, r[i + 1]);
  }
  return { x0, z0, x1, z1 };
}

/** Static trees: OSM-mapped trees + parks/woods + scattered greenery in open plots. Returns tree points too. */
export function placeStaticTrees(tile: Tile, g: InstanceGroup): Float32Array {
  const occ = new Occupancy(tile.half);
  for (const b of tile.buildings) {
    const bb = ringBBox(b.ring);
    for (let z = bb.z0; z <= bb.z1 + occ.cell; z += occ.cell) for (let x = bb.x0; x <= bb.x1 + occ.cell; x += occ.cell) occ.mark(x, z);
  }
  for (const r of tile.roads) {
    const hw = carriageway(r) / 2 + r.props.footpath + 1.5;
    for (let s = 0; s <= r.len; s += 2) {
      const p = sampleRoad(r, s, { seg: 0 });
      for (let o = -hw; o <= hw; o += 2) occ.mark(p.x + p.dz * o, p.z - p.dx * o);
    }
  }
  for (const a of tile.areas) {
    if (a.kind !== 5 && a.kind !== 8 && a.kind !== 10) continue; // water, parking, pitches stay clear
    const bb = ringBBox(a.ring);
    for (let z = bb.z0; z <= bb.z1; z += occ.cell) for (let x = bb.x0; x <= bb.x1; x += occ.cell) if (pointInRing(x, z, a.ring)) occ.mark(x, z);
  }

  const pts: number[] = [];
  const put = (x: number, z: number, i: number, big = 1) => {
    const s = (5 + hash01(i * 3) * 6) * big;
    g.push(x, 0, z, hash01(i) * 6.28, s * 0.9, s * (1.05 + hash01(i * 5) * 0.4), s * 0.9, greenFor(i));
    pts.push(x, z);
  };

  let id = 1;
  for (let i = 0; i < tile.trees.length; i += 2) put(tile.trees[i], tile.trees[i + 1], id++, 1.25);

  const rand = rng(42);
  for (const a of tile.areas) {
    const density = a.kind === 4 ? 1 / 70 : a.kind === 3 ? 1 / 260 : a.kind === 6 ? 1 / 900 : a.kind === 7 ? 1 / 500 : 0;
    if (!density) continue;
    const bb = ringBBox(a.ring);
    const count = Math.min(4000, Math.floor((bb.x1 - bb.x0) * (bb.z1 - bb.z0) * density));
    for (let k = 0; k < count; k++) {
      const x = bb.x0 + rand() * (bb.x1 - bb.x0), z = bb.z0 + rand() * (bb.z1 - bb.z0);
      if (pointInRing(x, z, a.ring) && occ.free(x, z)) { put(x, z, id++); occ.mark(x, z); }
    }
  }

  // Scattered greenery in leftover land (Baner is greener than OSM says)
  for (let k = 0; k < 90000; k++) {
    const x = (rand() * 2 - 1) * tile.half, z = (rand() * 2 - 1) * tile.half;
    if (rand() < 0.88) continue;
    if (occ.free(x, z)) { put(x, z, id++, 0.9); occ.mark(x, z); }
  }
  return new Float32Array(pts);
}

/** Street trees + median shrubs for roads with trees=true. Rebuilt on edits. */
export function placeStreetTrees(tile: Tile, g: InstanceGroup, useOriginal = false) {
  g.reset();
  const P = (r: Road): RoadProps => (useOriginal ? r.original : r.props);
  for (const r of tile.roads) {
    const p = P(r);
    if (!p.trees || !r.drive) continue;
    const hw = carriageway(r, p) / 2 + (p.cycle ? 1.8 : 0);
    const off = p.footpath >= 2 ? hw + p.footpath - 0.7 : hw + p.footpath + 1.0;
    const ra = junctionRadius(tile, r.a, P) + 4, rb = junctionRadius(tile, r.b, P) + 4;
    const hint = { seg: 0 };
    let k = 0;
    for (let s = ra; s < r.len - rb; s += 10) {
      const q = sampleRoad(r, s, hint);
      const lx = q.dz, lz = -q.dx;
      for (const sg of roadSides(r)) {
        const i = r.id * 977 + k * 2 + (sg > 0 ? 0 : 1);
        const sc = 6.5 + hash01(i) * 3;
        g.push(q.x + lx * off * sg, 0, q.z + lz * off * sg, hash01(i * 7) * 6.28, sc * 0.85, sc * 1.25, sc * 0.85, greenFor(i));
      }
      if (p.median && k % 2 === 0) {
        const i = r.id * 131 + k;
        g.push(q.x, 0.28, q.z, hash01(i) * 6.28, 1.6, 1.4, 1.6, hex(0x5f8f3e));
      }
      k++;
    }
  }
}

export function placeBusStops(tile: Tile, g: InstanceGroup, near: (x: number, z: number) => { road: Road; s: number } | null) {
  g.reset();
  for (const b of tile.busStops) {
    const hit = near(b.x, b.z);
    let yaw = 0;
    if (hit) { const q = sampleRoad(hit.road, hit.s, { seg: 0 }); yaw = Math.atan2(q.dz, q.dx); }
    g.push(b.x, 0.2, b.z, yaw, 1, 1, 1, b.user ? hex(0x2f9e6a) : hex(0xc0392b));
  }
}

/** Street lights along main roads (glow at night). */
export function placeStreetLights(tile: Tile, g: InstanceGroup) {
  g.reset();
  for (const r of tile.roads) {
    if (!r.drive || r.clsIndex > 4) continue;
    const hw = carriageway(r) / 2;
    const hint = { seg: 0 };
    let k = 0;
    for (let s = 12; s < r.len - 12; s += 32) {
      const q = sampleRoad(r, s, hint);
      const lx = q.dz, lz = -q.dx;
      const sg = k % 2 ? 1 : -1;
      const yaw = Math.atan2(-lz * sg, -lx * sg); // arm points toward road
      g.push(q.x + lx * (hw + 0.4) * sg, 0, q.z + lz * (hw + 0.4) * sg, yaw, 1, 1, 1, hex(0xffffff));
      k++;
    }
  }
}
