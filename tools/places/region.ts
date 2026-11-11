// Reading a baked region in node for the place pages: the pieces around a point, as plain objects (sections,
// junctions, buildings, terrain) — no document or compiler, the facts only need the base map as baked.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { parsePiece, type Piece, type RegionManifest } from '../../src/data/region';
import { samplePath } from '../../src/doc/ops';
import type { JunctionObj, SectionObj } from '../../src/doc/types';

export interface Region {
  id: string;
  dir: string;
  M: RegionManifest & { baked?: string };
  /** lat / lon → frame metres (x east, z south) and back */
  xz(lat: number, lon: number): [number, number];
  ll(x: number, z: number): [number, number];
  piece(i: number, j: number): Piece | null;
}

export function openRegion(id: string): Region {
  const dir = `public/regions/${id}/`;
  const M = JSON.parse(fs.readFileSync(dir + 'region.json', 'utf8'));
  const F = M.frame, have = new Set((M.pieces as number[][]).map(([i, j]) => `${i}_${j}`));
  const cache = new Map<string, Piece | null>();
  return {
    id, dir, M,
    xz: (lat, lon) => [(lon - F.lon0) * F.kx, -(lat - F.lat0) * F.kz],
    ll: (x, z) => [F.lat0 - z / F.kz, F.lon0 + x / F.kx],
    piece(i, j) {
      const k = `${i}_${j}`;
      if (!cache.has(k)) {
        if (!have.has(k)) cache.set(k, null);
        else {
          const json = zlib.gunzipSync(fs.readFileSync(`${dir}p/${k}.json.gz`)).toString();
          const b = zlib.gunzipSync(fs.readFileSync(`${dir}p/${k}.bin.gz`));
          cache.set(k, parsePiece({ json, bin: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer }, i, j));
        }
        // keep memory flat over a city's worth of places: the last few pieces only
        if (cache.size > 12) cache.delete(cache.keys().next().value!);
      }
      return cache.get(k)!;
    },
  };
}

/** A sampled section: its centre line as flat x,z pairs. */
export interface Sec { s: SectionObj; pts: number[] }

export interface Area {
  x: number; z: number; r: number;
  sections: Sec[];
  junctions: JunctionObj[];
  /** arms per junction id (sections meeting there, within the loaded pieces) */
  arms: Map<string, number>;
  buildings: { outer: Float32Array; h: number; cx: number; cz: number; area: number }[];
  /** terrain heights (m above sea level) of the dry grid cells inside the circle */
  heights: number[];
}

/** Everything of the base map within `pad` metres of a circle (the pieces it touches, deduplicated). */
export function areaAround(R: Region, x: number, z: number, r: number, pad = r * 0.45): Area {
  const P = R.M.piece, ext = r + pad;
  const secs = new Map<string, SectionObj>(), juncs = new Map<string, JunctionObj>();
  const out: Area = { x, z, r, sections: [], junctions: [], arms: new Map(), buildings: [], heights: [] };
  for (let j = Math.floor((z - ext) / P); j <= Math.floor((z + ext) / P); j++) for (let i = Math.floor((x - ext) / P); i <= Math.floor((x + ext) / P); i++) {
    const p = R.piece(i, j);
    if (!p) continue;
    for (const o of p.objs) {
      if (o.kind === 'section') secs.set(o.id, o);
      else if (o.kind === 'junction') juncs.set(o.id, o);
    }
    for (const b of p.buildings) {
      const c = ringCentroid(b.outer);
      if (Math.abs(c[0] - x) > ext || Math.abs(c[1] - z) > ext) continue;
      out.buildings.push({ outer: b.outer, h: b.h, cx: c[0], cz: c[1], area: Math.abs(ringArea(b.outer)) });
    }
    // terrain: the piece's grid vertices inside the circle
    const cell = (p.rect[2] - p.rect[0]) / (p.n - 1);
    for (let gj = 0; gj < p.n; gj++) for (let gi = 0; gi < p.n; gi++) {
      const gx = p.rect[0] + gi * cell, gz = p.rect[1] + gj * cell;
      if (Math.hypot(gx - x, gz - z) <= r && !p.waterMask[gj * p.n + gi]) out.heights.push(p.heights[gj * p.n + gi]);
    }
  }
  for (const s of secs.values()) {
    const S = samplePath(s.path, 8);
    const pts: number[] = [];
    for (const q of S.pts) pts.push(q[0], q[1]);
    let near = false;
    for (let k = 0; k < pts.length && !near; k += 2) near = Math.abs(pts[k] - x) < ext && Math.abs(pts[k + 1] - z) < ext;
    if (!near) continue;
    out.sections.push({ s, pts });
    out.arms.set(s.a, (out.arms.get(s.a) ?? 0) + 1);
    out.arms.set(s.b, (out.arms.get(s.b) ?? 0) + 1);
  }
  for (const jn of juncs.values()) if (Math.abs(jn.x - x) < ext && Math.abs(jn.z - z) < ext) out.junctions.push(jn);
  return out;
}

/** Length (m) of a polyline inside a circle (each step split finely enough for the circle's edge). */
export function lengthInside(pts: ArrayLike<number>, x: number, z: number, r: number): number {
  let L = 0;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const ax = pts[k], az = pts[k + 1], bx = pts[k + 2], bz = pts[k + 3];
    const d = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(d / 4));
    for (let t = 0; t < n; t++) {
      const mx = ax + ((bx - ax) * (t + 0.5)) / n, mz = az + ((bz - az) * (t + 0.5)) / n;
      if (Math.hypot(mx - x, mz - z) <= r) L += d / n;
    }
  }
  return L;
}

export function ringArea(r: ArrayLike<number>) {
  let a = 0;
  for (let i = 0, m = r.length / 2; i < m; i++) { const j = (i + 1) % m; a += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1]; }
  return a / 2;
}

export function ringCentroid(r: ArrayLike<number>): [number, number] {
  let x = 0, z = 0;
  const m = r.length / 2;
  for (let i = 0; i < m; i++) { x += r[i * 2]; z += r[i * 2 + 1]; }
  return [x / m, z / m];
}

/** Distance from a point to a polyline. */
export function lineDist(pts: ArrayLike<number>, x: number, z: number) {
  let best = Infinity;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const px = pts[k], pz = pts[k + 1], dx = pts[k + 2] - px, dz = pts[k + 3] - pz;
    const t = Math.max(0, Math.min(1, ((x - px) * dx + (z - pz) * dz) / (dx * dx + dz * dz || 1e-9)));
    best = Math.min(best, Math.hypot(x - px - dx * t, z - pz - dz * t));
  }
  return best;
}
