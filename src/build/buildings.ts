// Buildings: footprint extrusion with holes, foundations into terrain, per-style facade UVs, rooftop details.
import { GeomBuilder, rgbHex, signedArea } from './geom';
import earcut from 'earcut';
import type { Building } from '../data/tile';
import type { Heightfield } from '../geo/heightfield';

/** Anything that can say whether a point lies on a road/junction surface. */
export interface SurfaceQuery { onRoad(x: number, z: number): boolean }

/**
 * Resolve building ↔ road conflicts so nothing clips: shrink footprints that poke into a road,
 * drop ones that sit on it (OSM footprints and inferred road widths don't always agree).
 */
export function resolveConflicts(buildings: Building[], surfaces: SurfaceQuery): { kept: Building[]; shrunk: number; dropped: number } {
  const kept: Building[] = [];
  let shrunk = 0, dropped = 0;
  const onRoad = (x: number, z: number) => surfaces.onRoad(x, z);
  for (const b of buildings) {
    const n = b.outer.length / 2;
    let cx = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += b.outer[i * 2]; cz += b.outer[i * 2 + 1]; }
    cx /= n; cz /= n;
    if (onRoad(cx, cz)) { dropped++; continue; }
    const hits = (ring: Float32Array) => {
      for (let i = 0; i < ring.length / 2; i++) {
        const j = (i + 1) % (ring.length / 2);
        if (onRoad(ring[i * 2], ring[i * 2 + 1])) return true;
        if (onRoad((ring[i * 2] + ring[j * 2]) / 2, (ring[i * 2 + 1] + ring[j * 2 + 1]) / 2)) return true;
      }
      return false;
    };
    if (!hits(b.outer)) { kept.push(b); continue; }
    let ok = false, outer = b.outer;
    for (let k = 1; k <= 8 && !ok; k++) {
      const f = 1 - k * 0.06;
      outer = b.outer.map((v, i) => (i % 2 ? cz + (v - cz) * f : cx + (v - cx) * f)) as Float32Array;
      ok = !hits(outer);
    }
    if (ok) { kept.push({ ...b, outer, holes: [] }); shrunk++; } else dropped++;
  }
  return { kept, shrunk, dropped };
}

export const FACADE_STYLES = ['apartment', 'glass', 'house', 'industrial', 'civic'] as const;
export type FacadeStyle = (typeof FACADE_STYLES)[number];
export const BAY = 3.0;   // metres per window bay (texture repeats every 4 bays)
export const FLOOR = 3.2; // metres per floor (texture repeats every 4 floors)

function hash01(n: number) {
  let h = (n * 2654435761) >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 2246822507) >>> 0; h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const PALETTES: Record<FacadeStyle, number[]> = {
  apartment: [0xf1e9da, 0xe8dcc5, 0xefe4d0, 0xdcd3c3, 0xe9d8bd, 0xd9dfe2, 0xf0dccb, 0xe1e5d6, 0xf3efe6, 0xe7d1c1],
  glass: [0xc9d6df, 0xbfcbd4, 0xd3dbe0, 0xb6c4ce],
  house: [0xf2dcb6, 0xeccda2, 0xe2c09f, 0xf4e6cc, 0xd5e0cf, 0xecd0cf, 0xdfe6ea, 0xf6eee0],
  industrial: [0xbdb8ad, 0xa9a69e, 0xc3bcab, 0x9fa6aa],
  civic: [0xe6d2a8, 0xdcc19a, 0xece2cc, 0xd9b48a],
};

export function styleOf(b: Building): FacadeStyle {
  switch (b.kind) {
    case 1: return b.h > 14 ? 'glass' : 'apartment';
    case 2: return 'industrial';
    case 3: case 4: case 8: return 'civic';
    case 5: case 6: return b.kind === 6 ? 'industrial' : 'house';
    case 7: return 'glass';
    default: return 'apartment';
  }
}

export interface BuildingMeshes {
  walls: Record<FacadeStyle, GeomBuilder>;
  roofs: GeomBuilder;
}

export function buildBuildings(list: Building[], hf: Heightfield): BuildingMeshes {
  const walls = Object.fromEntries(FACADE_STYLES.map((s) => [s, new GeomBuilder()])) as Record<FacadeStyle, GeomBuilder>;
  const roofs = new GeomBuilder();
  for (const b of list) {
    const style = styleOf(b);
    const r = hash01(b.id * 7 + 3);
    const pal = PALETTES[style];
    const wallCol = rgbHex(pal[Math.floor(r * pal.length)]);
    let roofCol = rgbHex(style === 'industrial' ? 0x8f969b : style === 'glass' ? 0x9aa1a6 : 0xb3ada2);
    if (b.kind === 5 && hash01(b.id * 13) < 0.3) roofCol = rgbHex(0xa65a42);

    // Foundation: sink to the lowest ground point; height counts from the highest so nothing floats.
    let gMin = Infinity, gMax = -Infinity;
    for (const ring of [b.outer, ...b.holes]) for (let i = 0; i < ring.length; i += 2) {
      const g = hf.sampleSurface(ring[i], ring[i + 1]);
      gMin = Math.min(gMin, g); gMax = Math.max(gMax, g);
    }
    const y0 = b.minH > 0 ? gMax + b.minH : gMin - 0.8;
    const yTop = gMax + b.h;
    const vBase = gMin; // floors counted from ground

    const wb = walls[style];
    for (const [ri, ring] of [b.outer, ...b.holes].entries()) {
      const isHole = ri > 0;
      const cw = signedArea(ring) > 0; // clockwise in x/z (z south)
      const n = ring.length / 2;
      let u = hash01(b.id) * 4 * BAY;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        let ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
        // GeomBuilder.wall normal = left of a→b. Outward is left for CW outer rings; flip otherwise.
        const flip = cw === isHole;
        if (flip) { [ax, bx] = [bx, ax]; [az, bz] = [bz, az]; }
        const L = Math.hypot(bx - ax, bz - az);
        const i0 = wb.v(ax, y0, az, 0, 0, 0, ...wallCol, u / (4 * BAY), (y0 - vBase) / (4 * FLOOR));
        wb.v(bx, y0, bz, 0, 0, 0, ...wallCol, (u + L) / (4 * BAY), (y0 - vBase) / (4 * FLOOR));
        wb.v(bx, yTop, bz, 0, 0, 0, ...wallCol, (u + L) / (4 * BAY), (yTop - vBase) / (4 * FLOOR));
        wb.v(ax, yTop, az, 0, 0, 0, ...wallCol, u / (4 * BAY), (yTop - vBase) / (4 * FLOOR));
        let nx = bz - az, nz = -(bx - ax);
        const nl = Math.hypot(nx, nz) || 1;
        nx /= nl; nz /= nl;
        for (let k = 0; k < 4; k++) { wb.nor[(i0 + k) * 3] = nx; wb.nor[(i0 + k) * 3 + 1] = 0; wb.nor[(i0 + k) * 3 + 2] = nz; }
        wb.tri(i0, i0 + 2, i0 + 1);
        wb.tri(i0, i0 + 3, i0 + 2);
        u += L;
      }
    }

    // Roof (with courtyards)
    const flat: number[] = [], holes: number[] = [];
    [b.outer, ...b.holes].forEach((ring, k) => { if (k) holes.push(flat.length / 2); for (const v of ring) flat.push(v); });
    const tris = earcut(flat, holes.length ? holes : undefined);
    const base = roofs.vertexCount;
    for (let i = 0; i < flat.length; i += 2) roofs.v(flat[i], yTop, flat[i + 1], 0, 1, 0, ...roofCol, flat[i] * 0.25, flat[i + 1] * 0.25);
    for (let k = 0; k < tris.length; k += 3) {
      const a = tris[k], c1 = tris[k + 1], c2 = tris[k + 2];
      const cross = (flat[c1 * 2 + 1] - flat[a * 2 + 1]) * (flat[c2 * 2] - flat[a * 2]) - (flat[c1 * 2] - flat[a * 2]) * (flat[c2 * 2 + 1] - flat[a * 2 + 1]);
      if (cross > 0) roofs.tri(base + a, base + c1, base + c2); else roofs.tri(base + a, base + c2, base + c1);
    }

    // Parapet + rooftop clutter for Indian flat roofs
    const area = Math.abs(signedArea(b.outer));
    if (style !== 'industrial' && b.h > 5 && area > 40) {
      parapet(roofs, b.outer, yTop, 0.9, roofCol);
      let cx = 0, cz = 0;
      for (let i = 0; i < b.outer.length; i += 2) { cx += b.outer[i]; cz += b.outer[i + 1]; }
      cx /= b.outer.length / 2; cz /= b.outer.length / 2;
      const yaw = Math.atan2(b.outer[3] - b.outer[1], b.outer[2] - b.outer[0]);
      const spread = Math.min(6, Math.sqrt(area) * 0.3);
      if (b.h > 12 && area > 150) roofs.box(cx, cz, yTop, yTop + 3, 4, 3.6, yaw, wallCol); // stair / lift room
      const tanks = area > 400 ? 3 : area > 120 ? 2 : 1;
      for (let t = 0; t < tanks; t++) {
        const ox = (hash01(b.id * 31 + t) - 0.5) * spread, oz = (hash01(b.id * 17 + t) - 0.5) * spread;
        roofs.box(cx + ox, cz + oz, yTop, yTop + 1.4, 1.3, 1.3, yaw + 0.785, rgbHex(0x24272a));
      }
    }
  }
  return { walls, roofs };
}

/** Thin parapet wall around the roof edge (inside face + top), so roofs read as Indian terraces. */
function parapet(gb: GeomBuilder, ring: Float32Array, y: number, h: number, rgb: [number, number, number]) {
  const n = ring.length / 2;
  const cw = signedArea(ring) > 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
    if (cw) { [ax, bx] = [bx, ax]; [az, bz] = [bz, az]; } // inward-facing
    gb.wall(ax, az, bx, bz, y, y, y + h, y + h, rgb);
  }
}
