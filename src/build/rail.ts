// Railways as continuous mitred ribbons that follow smoothed curves:
// ballast bed (or viaduct deck), side walls / embankment, parapets, rails, and pillars under viaducts.
import { GeomBuilder, rgbHex } from './geom';
import type { TileData } from '../data/tile';
import type { Heightfield } from '../geo/heightfield';

const DECK = 7.5;
const GRADE = 0.035;
const STEP = 3; // resample spacing (m) so heights follow the profile smoothly

/** Resample a polyline every ~STEP metres; returns points, tangents' left normals (mitred) and arc length. */
function resample(p: Float32Array) {
  const pts: number[] = [], s: number[] = [];
  const n = p.length / 2;
  let acc = 0;
  pts.push(p[0], p[1]); s.push(0);
  for (let i = 0; i < n - 1; i++) {
    const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-3) continue;
    const k = Math.max(1, Math.ceil(L / STEP));
    for (let j = 1; j <= k; j++) { const t = j / k; pts.push(ax + (bx - ax) * t, az + (bz - az) * t); s.push(acc + L * t); }
    acc += L;
  }
  const m = pts.length / 2;
  const nor = new Float32Array(m * 2);
  for (let i = 0; i < m; i++) {
    const a = Math.max(0, i - 1), b = Math.min(m - 1, i + 1);
    let dx = pts[b * 2] - pts[a * 2], dz = pts[b * 2 + 1] - pts[a * 2 + 1];
    const L = Math.hypot(dx, dz) || 1;
    dx /= L; dz /= L;
    nor[i * 2] = dz; nor[i * 2 + 1] = -dx; // left normal
  }
  return { pts: new Float32Array(pts), nor, s: new Float32Array(s), len: acc };
}

/** Continuous strip between lateral offsets o0..o1 at heights y(i). Faces up. */
function strip(gb: GeomBuilder, R: ReturnType<typeof resample>, o0: number, o1: number, y: (i: number) => number, rgb: [number, number, number]) {
  const m = R.pts.length / 2;
  const base = gb.vertexCount;
  for (let i = 0; i < m; i++) {
    const x = R.pts[i * 2], z = R.pts[i * 2 + 1], nx = R.nor[i * 2], nz = R.nor[i * 2 + 1], h = y(i);
    gb.v(x + nx * o0, h, z + nz * o0, 0, 1, 0, ...rgb, R.s[i] * 0.25, o0 * 0.25);
    gb.v(x + nx * o1, h, z + nz * o1, 0, 1, 0, ...rgb, R.s[i] * 0.25, o1 * 0.25);
  }
  for (let i = 0; i < m - 1; i++) {
    const k = base + i * 2;
    // o0 < o1 means vertex 1 is further left; wind so the strip faces up
    if (o1 > o0) { gb.tri(k, k + 3, k + 1); gb.tri(k, k + 2, k + 3); }
    else { gb.tri(k, k + 1, k + 3); gb.tri(k, k + 3, k + 2); }
  }
}

/** Continuous vertical wall at lateral offset o from yBottom(i) to yTop(i), facing side sign(o). */
function sideWall(gb: GeomBuilder, R: ReturnType<typeof resample>, o: number, yb: (i: number) => number, yt: (i: number) => number, rgb: [number, number, number]) {
  const m = R.pts.length / 2;
  const base = gb.vertexCount;
  const sg = o >= 0 ? 1 : -1;
  for (let i = 0; i < m; i++) {
    const x = R.pts[i * 2], z = R.pts[i * 2 + 1], nx = R.nor[i * 2], nz = R.nor[i * 2 + 1];
    gb.v(x + nx * o, yb(i), z + nz * o, nx * sg, 0, nz * sg, ...rgb);
    gb.v(x + nx * o, yt(i), z + nz * o, nx * sg, 0, nz * sg, ...rgb);
  }
  for (let i = 0; i < m - 1; i++) {
    const k = base + i * 2;
    if (sg > 0) { gb.tri(k, k + 1, k + 2); gb.tri(k + 1, k + 3, k + 2); }
    else { gb.tri(k, k + 2, k + 1); gb.tri(k + 1, k + 2, k + 3); }
  }
}

type RS = ReturnType<typeof resample>;

/** Recompute normals + arc length after moving points. */
function refresh(R: RS): RS {
  const m = R.pts.length / 2;
  const nor = new Float32Array(m * 2), s = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    if (i > 0) s[i] = s[i - 1] + Math.hypot(R.pts[i * 2] - R.pts[i * 2 - 2], R.pts[i * 2 + 1] - R.pts[i * 2 - 1]);
    const a = Math.max(0, i - 1), b = Math.min(m - 1, i + 1);
    let dx = R.pts[b * 2] - R.pts[a * 2], dz = R.pts[b * 2 + 1] - R.pts[a * 2 + 1];
    const L = Math.hypot(dx, dz) || 1;
    nor[i * 2] = dz / L; nor[i * 2 + 1] = -dx / L;
  }
  return { pts: R.pts, nor, s, len: s[m - 1] };
}

/**
 * Smooth a per-sample shift field (missing = 0) so moves blend in gently: two moving-average passes,
 * then cap the change between neighbouring samples (3 m apart) so the deck can never fold over itself.
 */
function smoothShift(shift: (number[] | null)[], win: number): number[][] {
  const n = shift.length;
  let cur = shift.map((v) => (v ? [v[0], v[1]] : [0, 0]));
  for (let pass = 0; pass < 2; pass++) {
    const next: number[][] = [];
    for (let i = 0; i < n; i++) {
      let sx = 0, sz = 0, c = 0;
      for (let k = Math.max(0, i - win); k <= Math.min(n - 1, i + win); k++) { sx += cur[k][0]; sz += cur[k][1]; c++; }
      next.push([sx / c, sz / c]);
    }
    cur = next;
  }
  const MAXD = 0.45; // metres of sideways change per 3 m sample (≈ 1:7 taper)
  for (let it = 0; it < 3; it++) {
    for (let i = 1; i < n; i++) for (const k of [0, 1]) {
      const d = cur[i][k] - cur[i - 1][k];
      if (Math.abs(d) > MAXD) cur[i][k] = cur[i - 1][k] + Math.sign(d) * MAXD;
    }
    for (let i = n - 2; i >= 0; i--) for (const k of [0, 1]) {
      const d = cur[i][k] - cur[i + 1][k];
      if (Math.abs(d) > MAXD) cur[i][k] = cur[i + 1][k] + Math.sign(d) * MAXD;
    }
  }
  return cur;
}

/**
 * Metro: OSM maps one way per direction. Pair parallel tracks (keep the lower index, drop its twin)
 * and move the kept line onto their midline → one double-track viaduct.
 */
function mergeMetroPairs(tile: TileData, R: RS[], paired: boolean[], dropped: boolean[]) {
  const metro = tile.rails.map((r, i) => (r.metro ? i : -1)).filter((i) => i >= 0);
  const CELL = 12;
  const grid = new Map<string, [number, number][]>();
  for (const i of metro) for (let k = 0; k < R[i].pts.length / 2; k++) {
    const key = `${Math.floor(R[i].pts[k * 2] / CELL)},${Math.floor(R[i].pts[k * 2 + 1] / CELL)}`;
    (grid.get(key) ?? grid.set(key, []).get(key)!).push([i, k]);
  }
  for (const i of metro) {
    const P = R[i], m = P.pts.length / 2;
    const shift: (number[] | null)[] = [];
    const partnerCount = new Map<number, number>();
    for (let k = 0; k < m; k++) {
      const x = P.pts[k * 2], z = P.pts[k * 2 + 1];
      let best: [number, number, number] | null = null; // d, j, kk
      for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) {
        for (const [j, kk] of grid.get(`${Math.floor(x / CELL) + gx},${Math.floor(z / CELL) + gz}`) ?? []) {
          if (j === i) continue;
          const Q = R[j];
          const d = Math.hypot(Q.pts[kk * 2] - x, Q.pts[kk * 2 + 1] - z);
          const par = Math.abs(P.nor[k * 2] * Q.nor[kk * 2] + P.nor[k * 2 + 1] * Q.nor[kk * 2 + 1]);
          if (d >= 2 && d <= 12 && par > 0.9 && (!best || d < best[0])) best = [d, j, kk];
        }
      }
      if (best) {
        const Q = R[best[1]];
        shift.push([(Q.pts[best[2] * 2] - x) / 2, (Q.pts[best[2] * 2 + 1] - z) / 2]);
        partnerCount.set(best[1], (partnerCount.get(best[1]) ?? 0) + 1);
      } else shift.push(null);
    }
    const matched = shift.filter(Boolean).length;
    if (matched < m * 0.3) continue;
    const main = [...partnerCount].sort((a, b) => b[1] - a[1])[0][0];
    if (main < i && matched >= m * 0.5) { dropped[i] = true; continue; }
    const sm = smoothShift(shift, 8);
    for (let k = 0; k < m; k++) { P.pts[k * 2] += sm[k][0]; P.pts[k * 2 + 1] += sm[k][1]; }
    R[i] = refresh(P);
    paired[i] = true;
  }
}

/**
 * Slide kept metro lines over the median of the road beneath: the centre of a two-way road, or the gap
 * between a pair of one-way carriageways (one on each side). Moves are smoothed so the viaduct stays fluid.
 */
function snapToRoads(tile: TileData, R: RS[], roads: { pts: Float32Array; oneway: boolean }[], dropped: boolean[]) {
  const CELL = 30;
  const grid = new Map<string, [number, number][]>();
  roads.forEach((r, ri) => {
    const c = r.pts;
    for (let k = 0; k < c.length / 2 - 1; k++) {
      const key = `${Math.floor(c[k * 2] / CELL)},${Math.floor(c[k * 2 + 1] / CELL)}`;
      (grid.get(key) ?? grid.set(key, []).get(key)!).push([ri, k]);
    }
  });
  let snapped = 0;
  tile.rails.forEach((r, i) => {
    if (!r.metro || dropped[i]) return;
    const P = R[i], m = P.pts.length / 2;
    const shift: (number[] | null)[] = [];
    for (let k = 0; k < m; k++) {
      const x = P.pts[k * 2], z = P.pts[k * 2 + 1];
      const nx = P.nor[k * 2], nz = P.nor[k * 2 + 1], tx = -nz, tz = nx;
      let two: [number, number, number] | null = null;   // |lat|, qx, qz
      let left: [number, number, number] | null = null, right: [number, number, number] | null = null;
      for (let gx = -1; gx <= 1; gx++) for (let gz = -1; gz <= 1; gz++) {
        for (const [ri, kk] of grid.get(`${Math.floor(x / CELL) + gx},${Math.floor(z / CELL) + gz}`) ?? []) {
          const c = roads[ri].pts;
          const ax = c[kk * 2], az = c[kk * 2 + 1], bx = c[kk * 2 + 2], bz = c[kk * 2 + 3];
          const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
          if (Math.abs((dx * tx + dz * tz) / Math.sqrt(L2)) < 0.85) continue;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
          const qx = ax + dx * t, qz = az + dz * t;
          const lat = (qx - x) * nx + (qz - z) * nz, d = Math.abs(lat);
          if (!roads[ri].oneway) { if (d <= 16 && (!two || d < two[0])) two = [d, qx, qz]; }
          else if (d <= 26) {
            if (lat >= 0 && (!left || d < left[0])) left = [d, qx, qz];
            if (lat < 0 && (!right || d < right[0])) right = [d, qx, qz];
          }
        }
      }
      if (two) shift.push([two[1] - x, two[2] - z]);
      else if (left && right) shift.push([(left[1] + right[1]) / 2 - x, (left[2] + right[2]) / 2 - z]);
      else shift.push(null);
    }
    if (shift.filter(Boolean).length < 4) return;
    const sm = smoothShift(shift, 15);
    for (let k = 0; k < m; k++) { P.pts[k * 2] += sm[k][0]; P.pts[k * 2 + 1] += sm[k][1]; }
    R[i] = refresh(P);
    snapped++;
  });
  return snapped;
}

/** Crossovers / sidings between the merged twins now cut across the viaduct: drop short metro pieces inside it. */
function dropCrossovers(tile: TileData, R: RS[], paired: boolean[], dropped: boolean[]) {
  const keep = tile.rails.map((r, i) => (r.metro && !dropped[i] && R[i].len > 250 ? i : -1)).filter((i) => i >= 0);
  tile.rails.forEach((r, i) => {
    if (!r.metro || dropped[i] || R[i].len > 250) return; // short pieces only: crossovers, sidings, station tracks
    const P = R[i], m = P.pts.length / 2;
    let inside = 0;
    for (let k = 0; k < m; k++) {
      const x = P.pts[k * 2], z = P.pts[k * 2 + 1];
      let best = Infinity;
      for (const j of keep) {
        const Q = R[j];
        for (let q = 0; q < Q.pts.length / 2; q++) best = Math.min(best, Math.hypot(Q.pts[q * 2] - x, Q.pts[q * 2 + 1] - z));
        if (best < 14) break;
      }
      if (best < 14) inside++;
    }
    if (inside >= m * 0.7) dropped[i] = true;
  });
}

/** After moving pieces independently, weld shared endpoints back together (taper over ~30 m). */
function weldEnds(R: RS[], ends: string[][], dropped: boolean[]) {
  // group endpoints that share an OSM node OR now lie within 8 m (a merged line can hop between twins)
  const items: [number, number][] = [];
  ends.forEach((_e, i) => { if (!dropped[i]) items.push([i, 0], [i, 1]); });
  const pos = ([i, j]: [number, number]) => { const m = R[i].pts.length / 2, k = j ? m - 1 : 0; return [R[i].pts[k * 2], R[i].pts[k * 2 + 1]]; };
  const parent = items.map((_, k) => k);
  const find = (k: number): number => (parent[k] === k ? k : (parent[k] = find(parent[k])));
  for (let a = 0; a < items.length; a++) for (let b = a + 1; b < items.length; b++) {
    const [ia, ja] = items[a], [ib, jb] = items[b];
    if (ia === ib) continue;
    const pa = pos(items[a]), pb = pos(items[b]);
    if (ends[ia][ja] === ends[ib][jb] || Math.hypot(pa[0] - pb[0], pa[1] - pb[1]) < 8) parent[find(a)] = find(b);
  }
  const groups = new Map<number, [number, number][]>();
  items.forEach((it, k) => (groups.get(find(k)) ?? groups.set(find(k), []).get(find(k))!).push(it));
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    let ax = 0, az = 0;
    for (const [i, j] of g) { const m = R[i].pts.length / 2, k = j ? m - 1 : 0; ax += R[i].pts[k * 2]; az += R[i].pts[k * 2 + 1]; }
    ax /= g.length; az /= g.length;
    for (const [i, j] of g) {
      const P = R[i], m = P.pts.length / 2, k0 = j ? m - 1 : 0;
      const dx = ax - P.pts[k0 * 2], dz = az - P.pts[k0 * 2 + 1];
      for (let k = 0; k < m; k++) {
        const along = j ? P.s[m - 1] - P.s[k] : P.s[k];
        const w = Math.max(0, 1 - along / 60);
        if (w <= 0) continue;
        P.pts[k * 2] += dx * w; P.pts[k * 2 + 1] += dz * w;
      }
      R[i] = refresh(P);
    }
  }
}

/** roadCenters: centre lines of roads that run under the metro (from the network). */
export function buildRail(tile: TileData, hf: Heightfield, roadCenters: { pts: Float32Array; oneway: boolean }[] = []) {
  const ballast = new GeomBuilder(), steel = new GeomBuilder(), structure = new GeomBuilder();
  const T = (x: number, z: number) => hf.sampleSurface(x, z);
  const key = (x: number, z: number) => `${Math.round(x * 2)},${Math.round(z * 2)}`;

  // Endpoint lifts: elevated pieces lift their ends, relaxed along ground pieces so approaches stay gentle.
  const R = tile.rails.map((r) => resample(r.pts));
  const paired = tile.rails.map(() => false), dropped = tile.rails.map(() => false);
  mergeMetroPairs(tile, R, paired, dropped);
  snapToRoads(tile, R, roadCenters, dropped);
  dropCrossovers(tile, R, paired, dropped);
  const ends = tile.rails.map((r) => [key(r.pts[0], r.pts[1]), key(r.pts[r.pts.length - 2], r.pts[r.pts.length - 1])]);
  weldEnds(R, ends, dropped);
  const off = new Map<string, number>();
  tile.rails.forEach((r, i) => {
    if (r.tunnel) return;
    const d = r.bridge || r.layer > 0 ? DECK * Math.max(1, r.layer) : 0;
    for (const k of ends[i]) off.set(k, Math.max(off.get(k) ?? 0, d));
  });
  for (let iter = 0; iter < 40; iter++) {
    let changed = false;
    tile.rails.forEach((r, i) => {
      if (r.bridge || r.layer > 0) return;
      const [a, b] = ends[i];
      const oa = off.get(a) ?? 0, ob = off.get(b) ?? 0;
      const na = Math.max(oa, ob - GRADE * R[i].len), nb = Math.max(ob, oa - GRADE * R[i].len);
      if (na > oa + 0.01) { off.set(a, na); changed = true; }
      if (nb > ob + 0.01) { off.set(b, nb); changed = true; }
    });
    if (!changed) break;
  }

  tile.rails.forEach((r, i) => {
    if (r.tunnel || dropped[i] || R[i].pts.length < 4) return;
    const RS = R[i], m = RS.pts.length / 2;
    const oa = off.get(ends[i][0]) ?? 0, ob = off.get(ends[i][1]) ?? 0;
    const lifted = r.bridge || r.layer > 0;
    const p0 = [RS.pts[0], RS.pts[1]], p1 = [RS.pts[m * 2 - 2], RS.pts[m * 2 - 1]];
    const za = T(p0[0], p0[1]) + oa, zb = T(p1[0], p1[1]) + ob;
    // per-sample height; lifted pieces run straight between their ends (never dipping into valleys)
    const ys = new Float32Array(m), gs = new Float32Array(m);
    for (let k = 0; k < m; k++) {
      const x = RS.pts[k * 2], z = RS.pts[k * 2 + 1], t = RS.len ? RS.s[k] / RS.len : 0;
      gs[k] = T(x, z);
      ys[k] = lifted ? Math.max(za + (zb - za) * t, gs[k] + DECK * 0.8) : gs[k] + oa + (ob - oa) * t + 0.3;
    }
    const elevated = (k: number) => ys[k] - gs[k] > 2.5;
    const anyElevated = Array.from(ys).some((y, k) => y - gs[k] > 2.5);
    const w = paired[i] ? 4.7 : r.metro ? 2.6 : 1.9; // double-track viaduct when the twin was merged in
    const bedCol = rgbHex(anyElevated || r.metro ? 0x9a958c : 0x7a6a58);
    const wallCol = rgbHex(anyElevated ? 0xa8a49b : 0x6f6253);
    strip(ballast, RS, -w, w, (k) => ys[k], bedCol);
    const bottom = (k: number) => (elevated(k) ? ys[k] - 1.6 : gs[k] - 0.3);
    sideWall(structure, RS, w, bottom, (k) => ys[k], wallCol);
    sideWall(structure, RS, -w, bottom, (k) => ys[k], wallCol);
    if (anyElevated) {
      strip(structure, RS, w, -w, (k) => (elevated(k) ? ys[k] - 1.6 : gs[k] - 0.3), rgbHex(0x8e8a82)); // underside
      sideWall(structure, RS, w, (k) => ys[k], (k) => ys[k] + (elevated(k) ? 1.1 : 0), rgbHex(0xb0aca3));
      sideWall(structure, RS, -w, (k) => ys[k], (k) => ys[k] + (elevated(k) ? 1.1 : 0), rgbHex(0xb0aca3));
    }
    for (const c of paired[i] ? [-2.2, 2.2] : [0]) for (const g of [-0.84, 0.84]) strip(steel, RS, c + g - 0.05, c + g + 0.05, (k) => ys[k] + 0.18, [1, 1, 1]);

    // pillars every 30 m under elevated stretches
    if (anyElevated) {
      for (let s = 15; s < RS.len; s += 30) {
        let k = 0;
        while (k < m - 1 && RS.s[k + 1] < s) k++;
        if (!elevated(k)) continue;
        const x = RS.pts[k * 2], z = RS.pts[k * 2 + 1];
        const yaw = Math.atan2(-RS.nor[k * 2], RS.nor[k * 2 + 1]);
        const top = ys[k] - 1.6;
        structure.box(x, z, gs[k] - 1, top - 0.7, 1.8, paired[i] ? 2.2 : r.metro ? 2.0 : 1.6, yaw, rgbHex(0xa8a49b));
        structure.box(x, z, top - 0.7, top, 2.2, w * 2 * 0.9, yaw, rgbHex(0x9a968d));
      }
    }
  });
  return { ballast, steel, structure };
}
