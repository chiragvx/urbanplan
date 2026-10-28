// Terrain mesh, land-use texture and water surfaces.
import * as THREE from 'three/webgpu';
import { GeomBuilder, drapePolygon, rgbHex } from './geom';
import type { Heightfield } from '../geo/heightfield';
import type { TileData } from '../data/tile';

export function buildTerrainGeometry(hf: Heightfield): THREE.BufferGeometry {
  const n = hf.n, cell = hf.cell, half = hf.half, h = hf.surface;
  const pos = new Float32Array(n * n * 3), nor = new Float32Array(n * n * 3), uv = new Float32Array(n * n * 2);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    pos[k * 3] = -half + i * cell; pos[k * 3 + 1] = h[k]; pos[k * 3 + 2] = -half + j * cell;
    const hl = h[j * n + Math.max(0, i - 1)], hr = h[j * n + Math.min(n - 1, i + 1)];
    const hu = h[Math.max(0, j - 1) * n + i], hd = h[Math.min(n - 1, j + 1) * n + i];
    let nx = hl - hr, ny = 2 * cell, nz = hu - hd;
    const L = Math.hypot(nx, ny, nz);
    nor[k * 3] = nx / L; nor[k * 3 + 1] = ny / L; nor[k * 3 + 2] = nz / L;
    uv[k * 2] = i / (n - 1); uv[k * 2 + 1] = 1 - j / (n - 1);
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let o = 0;
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    // (a,c,b) and (b,c,d) — must match Heightfield.sampleSurface
    idx[o++] = a; idx[o++] = c; idx[o++] = b;
    idx[o++] = b; idx[o++] = c; idx[o++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

/** Skirt around the tile edge so the terrain reads as a solid block, like a diorama. */
export function buildTerrainSkirt(hf: Heightfield): THREE.BufferGeometry {
  const gb = new GeomBuilder();
  const n = hf.n, cell = hf.cell, half = hf.half, h = hf.surface;
  const bottom = -12;
  const col = rgbHex(0x5d5340);
  const edge = (get: (k: number) => [number, number, number]) => {
    for (let k = 0; k < n - 1; k++) {
      const [ax, ay, az] = get(k), [bx, by, bz] = get(k + 1);
      gb.wall(ax, az, bx, bz, bottom, bottom, ay, by, col);
    }
  };
  edge((k) => [-half + k * cell, h[k], -half]);
  edge((k) => [half - k * cell, h[(n - 1) * n + (n - 1 - k)], half]);
  edge((k) => [-half, h[(n - 1 - k) * n], half - k * cell]);
  edge((k) => [half, h[k * n + n - 1], -half + k * cell]);
  return gb.build();
}

const AREA_COLORS: Record<number, string> = {
  0: '#9a9373', 1: '#a2998a', 2: '#9d978d', 3: '#6e9246', 4: '#4e7438', 6: '#99a05e', 7: '#a59b79',
  8: '#8a8984', 9: '#a88f6c', 10: '#6aa44e', 11: '#c4b48c', 12: '#7c8e59', 13: '#8b8172', 14: '#7e8a52',
};

/** Paint land use into a canvas texture that the terrain samples. */
export function buildLanduseTexture(tile: TileData, size = 2048): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d')!;
  const s = size / (tile.half * 2);
  const X = (x: number) => (x + tile.half) * s, Z = (z: number) => (z + tile.half) * s;
  ctx.fillStyle = '#8e8a66';
  ctx.fillRect(0, 0, size, size);
  // subtle large-scale variation so open ground isn't flat
  for (let i = 0; i < 1400; i++) {
    const x = Math.random() * size, y = Math.random() * size, r = 8 + Math.random() * 60;
    ctx.fillStyle = Math.random() < 0.5 ? 'rgba(120,135,80,0.10)' : 'rgba(160,140,100,0.10)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  const path = (rings: Float32Array[]) => {
    ctx.beginPath();
    for (const r of rings) {
      for (let i = 0; i < r.length; i += 2) (i ? ctx.lineTo(X(r[i]), Z(r[i + 1])) : ctx.moveTo(X(r[i]), Z(r[i + 1])));
      ctx.closePath();
    }
  };
  for (const a of tile.areas) {
    ctx.fillStyle = AREA_COLORS[a.kind] ?? '#8e8a66';
    path([a.outer, ...a.holes]);
    ctx.fill('evenodd');
  }
  // compound paving / packed earth around buildings
  ctx.strokeStyle = 'rgba(158,150,134,0.85)';
  ctx.lineWidth = 4 * s;
  ctx.lineJoin = 'round';
  ctx.fillStyle = 'rgba(150,143,128,1)';
  for (const b of tile.buildings) { path([b.outer]); ctx.stroke(); ctx.fill(); }
  // river bed / banks
  ctx.fillStyle = '#6b6450';
  for (const w of tile.waters) { path([w.outer, ...w.holes]); ctx.fill('evenodd'); }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  return tex;
}

/** Water surfaces draped on the water-level field (rivers slope gently downstream). */
export function buildWater(tile: TileData, hf: Heightfield): THREE.BufferGeometry {
  const gb = new GeomBuilder();
  const n = tile.terrain.n;
  const lvl = Float32Array.from(tile.terrain.waterLevel, (v) => v - hf.base);
  const L = (x: number, z: number) => {
    const half = hf.half, cell = hf.cell;
    let fx = (x + half) / cell, fz = (z + half) / cell;
    fx = Math.min(Math.max(fx, 0), n - 1.0001); fz = Math.min(Math.max(fz, 0), n - 1.0001);
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j;
    const a = lvl[j * n + i], b = lvl[j * n + i + 1], c = lvl[(j + 1) * n + i], d = lvl[(j + 1) * n + i + 1];
    return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
  };
  const col = rgbHex(0xffffff);
  for (const w of tile.waters) drapePolygon(gb, w.outer, w.holes, L, col, 25, 0.02);
  for (const w of tile.waterways) {
    // streams / drains as ribbons sitting just below the local terrain
    const p = w.pts, m = p.length / 2;
    for (let i = 0; i < m - 1; i++) {
      const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
      const nx = (dz / len) * w.width / 2, nz = (-dx / len) * w.width / 2;
      const ya = hf.sampleSurface(ax, az) - 0.25, yb = hf.sampleSurface(bx, bz) - 0.25;
      const k = gb.v(ax + nx, ya, az + nz, 0, 1, 0);
      gb.v(ax - nx, ya, az - nz, 0, 1, 0);
      gb.v(bx - nx, yb, bz - nz, 0, 1, 0);
      gb.v(bx + nx, yb, bz + nz, 0, 1, 0);
      gb.tri(k, k + 1, k + 2); gb.tri(k, k + 2, k + 3);
    }
  }
  return gb.build();
}


/** One terrain chunk over grid vertices [i0..i1] × [j0..j1] (every `step`-th vertex), with a 3 m skirt. */
export function buildTerrainPatch(hf: Heightfield, i0: number, j0: number, i1: number, j1: number, step: number): THREE.BufferGeometry {
  const n = hf.n, cell = hf.cell, half = hf.half, h = hf.surface;
  const normal = (i: number, j: number): [number, number, number] => {
    const hl = h[j * n + Math.max(0, i - 1)], hr = h[j * n + Math.min(n - 1, i + 1)];
    const hu = h[Math.max(0, j - 1) * n + i], hd = h[Math.min(n - 1, j + 1) * n + i];
    const nx = hl - hr, ny = 2 * cell, nz = hu - hd, L = Math.hypot(nx, ny, nz);
    return [nx / L, ny / L, nz / L];
  };
  const is: number[] = [], js: number[] = [];
  for (let i = i0; i < i1; i += step) is.push(i);
  is.push(i1);
  for (let j = j0; j < j1; j += step) js.push(j);
  js.push(j1);
  const W = is.length, Hh = js.length;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const j of js) for (const i of is) {
    pos.push(-half + i * cell, h[j * n + i], -half + j * cell);
    nor.push(...normal(i, j));
    uv.push(i / (n - 1), 1 - j / (n - 1));
  }
  for (let b = 0; b < Hh - 1; b++) for (let a = 0; a < W - 1; a++) {
    const p = b * W + a, q = p + 1, r = p + W, s = r + 1;
    idx.push(p, r, q, q, r, s);
  }
  // skirt: drop the border 3 m so LOD seams are hidden
  const border: number[] = [];
  for (let a = 0; a < W; a++) border.push(a);
  for (let b = 1; b < Hh; b++) border.push(b * W + W - 1);
  for (let a = W - 2; a >= 0; a--) border.push((Hh - 1) * W + a);
  for (let b = Hh - 2; b >= 1; b--) border.push(b * W);
  border.push(0);
  for (let k = 0; k < border.length - 1; k++) {
    const v0 = border[k], v1 = border[k + 1];
    const base = pos.length / 3;
    for (const v of [v0, v1]) {
      pos.push(pos[v * 3], pos[v * 3 + 1] - 3, pos[v * 3 + 2]);
      nor.push(nor[v * 3], nor[v * 3 + 1], nor[v * 3 + 2]);
      uv.push(uv[v * 2], uv[v * 2 + 1]);
    }
    idx.push(v0, base, v1, v1, base, base + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  return g;
}

export interface TerrainChunk { cx: number; cz: number; radius: number; high: THREE.BufferGeometry; low: THREE.BufferGeometry; i0: number; j0: number; i1: number; j1: number }

/**
 * Terrain as chunks with two levels of detail (full grid near, every 4th vertex far).
 * Each chunk gets a short skirt so LOD seams never show cracks.
 */
export function buildTerrainChunks(hf: Heightfield, cellsPerChunk = 40, lowStep = 4): TerrainChunk[] {
  const n = hf.n, cell = hf.cell, half = hf.half;
  const out: TerrainChunk[] = [];
  for (let j0 = 0; j0 < n - 1; j0 += cellsPerChunk) for (let i0 = 0; i0 < n - 1; i0 += cellsPerChunk) {
    const i1 = Math.min(n - 1, i0 + cellsPerChunk), j1 = Math.min(n - 1, j0 + cellsPerChunk);
    const high = buildTerrainPatch(hf, i0, j0, i1, j1, 1);
    out.push({ cx: -half + ((i0 + i1) / 2) * cell, cz: -half + ((j0 + j1) / 2) * cell, radius: high.boundingSphere!.radius, high, low: buildTerrainPatch(hf, i0, j0, i1, j1, lowStep), i0, j0, i1, j1 });
  }
  return out;
}
