// Procedural mesh generation from the tile data. Everything visual is generated here.
import earcut from 'earcut';
import { MeshBuilder } from '../engine/mesh';
import { hex, shade, hash01 } from '../engine/math';
import { type Tile, type Road, type RoadProps, carriageway, roadSides, LANE_W } from './tile';

// Material ids (vertex alpha) — see shaders.ts
const M_PLAIN = 255, M_WALL = 1, M_WATER = 2, M_LIGHT = 3;

const Y = { ground: 0, area: 0.01, water: 0.02, road: 0.05, junction: 0.056, busLane: 0.062, marking: 0.07, cycle: 0.12, foot: 0.2, median: 0.28 };

const C = {
  ground: hex(0xa7a283), outside: hex(0x8f8c74),
  asphaltMain: hex(0x3b3e44), asphalt: hex(0x4a4c51), asphaltMinor: hex(0x57585b), track: hex(0x9a8262),
  kerb: hex(0xb3b0a6), footpath: hex(0xc4b8a2), footpathNew: hex(0xd3c7ae), footway: hex(0xbfb296),
  cycle: hex(0x3f8f5f), bus: hex(0xa2453b), marking: hex(0xeeeeea), yellow: hex(0xe8c547), median: hex(0xb9b4a6),
  water: hex(0x3e7c94, M_WATER),
};

const AREA_COLORS = [
  hex(0xbcb196), hex(0xc4b8a6), hex(0xb3ab9f), hex(0x7fa65a), hex(0x5b8744), hex(0x3e7c94, M_WATER),
  hex(0xa9b06c), hex(0xc8b68f), hex(0x8e8d88), hex(0xb79a73), hex(0x6dab58),
];

// ---------- Polyline helpers ----------

/** Extract the sub-polyline between distances s0 and s1 along a road. */
export function subPolyline(r: Road, s0: number, s1: number): Float32Array | null {
  if (s1 - s0 < 0.05) return null;
  const out: number[] = [];
  const { pts, cum } = r;
  const n = cum.length;
  const at = (s: number) => {
    let i = 0;
    while (i < n - 2 && cum[i + 1] < s) i++;
    const t = (s - cum[i]) / (cum[i + 1] - cum[i] || 1);
    return [pts[i * 2] + (pts[i * 2 + 2] - pts[i * 2]) * t, pts[i * 2 + 1] + (pts[i * 2 + 3] - pts[i * 2 + 1]) * t];
  };
  const a = at(s0);
  out.push(a[0], a[1]);
  for (let i = 1; i < n - 1; i++) if (cum[i] > s0 && cum[i] < s1) out.push(pts[i * 2], pts[i * 2 + 1]);
  const b = at(s1);
  out.push(b[0], b[1]);
  return new Float32Array(out);
}

/** Per-point miter normals (left side of travel = (dz, -dx)). Returns [nx, nz, scale] per point. */
function miters(p: Float32Array): Float32Array {
  const n = p.length / 2;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let ax = 0, az = 0, bx = 0, bz = 0;
    if (i > 0) { ax = p[i * 2] - p[i * 2 - 2]; az = p[i * 2 + 1] - p[i * 2 - 1]; const l = Math.hypot(ax, az) || 1; ax /= l; az /= l; }
    if (i < n - 1) { bx = p[i * 2 + 2] - p[i * 2]; bz = p[i * 2 + 3] - p[i * 2 + 1]; const l = Math.hypot(bx, bz) || 1; bx /= l; bz /= l; }
    if (i === 0) { ax = bx; az = bz; }
    if (i === n - 1) { bx = ax; bz = az; }
    const n1x = az, n1z = -ax, n2x = bz, n2z = -bx;
    let mx = n1x + n2x, mz = n1z + n2z;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-4) { mx = n2x; mz = n2z; } else { mx /= ml; mz /= ml; }
    const d = mx * n2x + mz * n2z;
    out[i * 3] = mx; out[i * 3 + 1] = mz; out[i * 3 + 2] = Math.min(1 / Math.max(d, 0.3), 2.5);
  }
  return out;
}

/** Flat strip between lateral offsets a..b along a polyline, at height y. */
export function ribbon(mb: MeshBuilder, p: Float32Array, a: number, b: number, y: number, color: number) {
  const n = p.length / 2;
  if (n < 2) return;
  const m = miters(p);
  const base = mb.vCount;
  for (let i = 0; i < n; i++) {
    const x = p[i * 2], z = p[i * 2 + 1], nx = m[i * 3] * m[i * 3 + 2], nz = m[i * 3 + 1] * m[i * 3 + 2];
    mb.vertex(x + nx * a, y, z + nz * a, 0, 1, 0, color);
    mb.vertex(x + nx * b, y, z + nz * b, 0, 1, 0, color);
  }
  for (let i = 0; i < n - 1; i++) {
    const k = base + i * 2;
    mb.tri(k, k + 1, k + 3);
    mb.tri(k, k + 3, k + 2);
  }
}

/** Vertical kerb face at lateral offset o, from y0 to y1. */
function kerbWall(mb: MeshBuilder, p: Float32Array, o: number, y0: number, y1: number, color: number) {
  const n = p.length / 2;
  if (n < 2) return;
  const m = miters(p);
  const base = mb.vCount;
  const sgn = o >= 0 ? -1 : 1; // faces toward the road centre
  for (let i = 0; i < n; i++) {
    const nx = m[i * 3], nz = m[i * 3 + 1], s = m[i * 3 + 2];
    const x = p[i * 2] + nx * o * s, z = p[i * 2 + 1] + nz * o * s;
    mb.vertex(x, y0, z, nx * sgn, 0, nz * sgn, color);
    mb.vertex(x, y1, z, nx * sgn, 0, nz * sgn, color);
  }
  for (let i = 0; i < n - 1; i++) {
    const k = base + i * 2;
    mb.tri(k, k + 1, k + 3);
    mb.tri(k, k + 3, k + 2);
  }
}

function dashed(mb: MeshBuilder, r: Road, s0: number, s1: number, o: number, dash: number, gap: number, w: number, color: number) {
  for (let s = s0; s < s1; s += dash + gap) {
    const p = subPolyline(r, s, Math.min(s + dash, s1));
    if (p) ribbon(mb, p, o - w / 2, o + w / 2, Y.marking, color);
  }
}

function disc(mb: MeshBuilder, x: number, z: number, r: number, y: number, color: number, seg = 18) {
  const c = mb.vertex(x, y, z, 0, 1, 0, color);
  for (let i = 0; i < seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    mb.vertex(x + Math.cos(a) * r, y, z + Math.sin(a) * r, 0, 1, 0, color);
  }
  for (let i = 0; i < seg; i++) mb.tri(c, c + 1 + i, c + 1 + ((i + 1) % seg));
}

// ---------- Roads ----------

export function junctionRadius(tile: Tile, node: number, use: (r: Road) => RoadProps): number {
  let r = 0;
  for (const id of tile.nodeRoads[node]) {
    const road = tile.roads[id];
    if (road.drive) r = Math.max(r, carriageway(road, use(road)) / 2);
  }
  return r;
}

function asphaltFor(r: Road): number {
  if (r.cls === 'track') return C.track;
  if (r.clsIndex <= 3) return C.asphaltMain;
  if (r.cls === 'service' || r.cls === 'living_street') return C.asphaltMinor;
  return C.asphalt;
}

export function buildRoads(tile: Tile, mb: MeshBuilder, useOriginal = false) {
  mb.clear();
  const P = (r: Road) => (useOriginal ? r.original : r.props);
  const nodeR = new Float32Array(tile.nodes.length / 2);
  const degree = new Uint8Array(tile.nodes.length / 2);
  for (let i = 0; i < nodeR.length; i++) {
    nodeR[i] = junctionRadius(tile, i, P);
    let d = 0;
    for (const id of tile.nodeRoads[i]) if (tile.roads[id].drive) d++;
    degree[i] = d;
  }

  // Draw minor first so major roads win visually where they overlap.
  const order = [...tile.roads].sort((a, b) => b.clsIndex - a.clsIndex);

  for (const r of order) {
    const p = P(r);
    if (!r.drive) {
      const w = carriageway(r, p) / 2;
      ribbon(mb, r.pts, -w, w, Y.road + 0.02, r.cls === 'cycleway' ? C.cycle : C.footway);
      continue;
    }
    const cw = carriageway(r, p);
    const hw = cw / 2;
    ribbon(mb, r.pts, -hw, hw, Y.road, asphaltFor(r));

    const ra = degree[r.a] >= 3 ? nodeR[r.a] : 0;
    const rb = degree[r.b] >= 3 ? nodeR[r.b] : 0;
    const s0 = Math.min(ra, r.len / 2), s1 = Math.max(r.len - rb, r.len / 2);
    const inner = subPolyline(r, s0, s1);
    const lw = (cw - (p.median ? 1.2 : 0)) / Math.max(p.lanes, 1);
    const mh = p.median ? 0.6 : 0;

    // Median
    if (p.median && inner) {
      const mp = subPolyline(r, s0 + 2, s1 - 2);
      if (mp) {
        ribbon(mb, mp, -0.6, 0.6, Y.median, C.median);
        kerbWall(mb, mp, 0.6, Y.road, Y.median, C.kerb);
        kerbWall(mb, mp, -0.6, Y.road, Y.median, C.kerb);
      }
    }

    // Markings on main-ish roads
    if (r.clsIndex <= 5 && p.lanes >= 2 && inner) {
      const ms0 = s0 + 1.5, ms1 = s1 - 1.5;
      if (!r.oneway && !p.median) {
        if (r.clsIndex <= 3) {
          const cp = subPolyline(r, ms0, ms1);
          if (cp) { ribbon(mb, cp, -0.22, -0.08, Y.marking, C.yellow); ribbon(mb, cp, 0.08, 0.22, Y.marking, C.yellow); }
        } else dashed(mb, r, ms0, ms1, 0, 3, 5, 0.14, C.marking);
      }
      const perDir = r.oneway ? p.lanes : Math.floor(p.lanes / 2);
      for (let k = 1; k < perDir; k++) {
        if (r.oneway) dashed(mb, r, ms0, ms1, -hw + k * lw, 3, 6, 0.12, C.marking);
        else {
          dashed(mb, r, ms0, ms1, mh + k * lw, 3, 6, 0.12, C.marking);
          dashed(mb, r, ms0, ms1, -(mh + k * lw), 3, 6, 0.12, C.marking);
        }
      }
      // Edge lines on main roads
      if (r.clsIndex <= 3) {
        const ep = subPolyline(r, ms0, ms1);
        if (ep) { ribbon(mb, ep, hw - 0.35, hw - 0.22, Y.marking, C.marking); ribbon(mb, ep, -hw + 0.22, -hw + 0.35, Y.marking, C.marking); }
      }
    }

    // Bus lane: kerb lane (left side of travel — India drives on the left)
    if (p.busLane && p.lanes >= 2 && inner) {
      ribbon(mb, inner, hw - lw, hw - 0.4, Y.busLane, C.bus);
      if (!r.oneway) ribbon(mb, inner, -hw + 0.4, -hw + lw, Y.busLane, C.bus);
    }

    // Zebra crossings near junction ends
    if (p.crossings && r.clsIndex <= 5) {
      const ends: [number, boolean][] = [];
      if (degree[r.a] >= 3) ends.push([ra + 1.2, true]);
      if (degree[r.b] >= 3) ends.push([r.len - rb - 4.2, false]);
      for (const [s] of ends) {
        if (s < 0 || s + 3 > r.len) continue;
        for (let o = -hw + 0.4; o < hw - 0.6; o += 1.1) {
          const zp = subPolyline(r, s, s + 3);
          if (zp) ribbon(mb, zp, o, o + 0.55, Y.marking + 0.002, C.marking);
        }
      }
    }

    // Sides: cycle track then footpath, trimmed at junctions
    const side = subPolyline(r, s0 > 0 ? s0 + 0.5 : 0, s1 < r.len ? s1 - 0.5 : r.len);
    if (side) {
      for (const sg of roadSides(r)) {
        let o = hw;
        if (p.cycle) {
          ribbon(mb, side, sg * o, sg * (o + 1.8), Y.cycle, C.cycle);
          kerbWall(mb, side, sg * o, Y.road, Y.cycle, C.kerb);
          o += 1.8;
        }
        if (p.footpath > 0) {
          const col = p.footpath >= 1.8 ? C.footpathNew : C.footpath;
          ribbon(mb, side, sg * o, sg * (o + p.footpath), Y.foot, col);
          kerbWall(mb, side, sg * o, p.cycle ? Y.cycle : Y.road, Y.foot, C.kerb);
          kerbWall(mb, side, sg * (o + p.footpath), 0, Y.foot, C.kerb);
        }
      }
    }
  }

  // Junction discs hide joins
  for (let i = 0; i < nodeR.length; i++) {
    if (!degree[i] || nodeR[i] <= 0) continue;
    let best: Road | null = null;
    for (const id of tile.nodeRoads[i]) {
      const rr = tile.roads[id];
      if (rr.drive && (!best || rr.clsIndex < best.clsIndex)) best = rr;
    }
    disc(mb, tile.nodes[i * 2], tile.nodes[i * 2 + 1], nodeR[i], degree[i] >= 3 ? Y.junction : Y.road + 0.001, best ? asphaltFor(best) : C.asphalt);
  }
}

// ---------- Ground, land use, water ----------

export function buildGround(tile: Tile, mb: MeshBuilder) {
  const h = tile.half;
  const big = h * 6;
  mb.quad(-big, -0.08, -big, big, -0.08, -big, big, -0.08, big, -big, -0.08, big, 0, 1, 0, C.outside);
  mb.quad(-h, Y.ground, -h, h, Y.ground, -h, h, Y.ground, h, -h, Y.ground, h, 0, 1, 0, C.ground);

  // Larger areas first so small parks/water sit on top
  const sorted = tile.areas.map((a, i) => ({ a, i, size: ringArea(a.ring) })).sort((x, y) => y.size - x.size);
  sorted.forEach(({ a }, order) => {
    const tris = earcut(a.ring);
    const y = (a.kind === 5 ? Y.water : Y.area) + order * 0.00002;
    const color = AREA_COLORS[a.kind] ?? C.ground;
    const base = mb.vCount;
    for (let k = 0; k < a.ring.length / 2; k++) mb.vertex(a.ring[k * 2], y, a.ring[k * 2 + 1], 0, 1, 0, color);
    for (let k = 0; k < tris.length; k += 3) mb.tri(base + tris[k], base + tris[k + 1], base + tris[k + 2]);
  });

  for (const w of tile.waterways) ribbon(mb, w.pts, -w.w / 2, w.w / 2, Y.water + 0.003, C.water);
}

function ringArea(r: Float32Array): number {
  let a = 0;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1];
  }
  return Math.abs(a / 2);
}

// ---------- Buildings ----------

const PALETTE: number[][] = [
  [0xe8dcc4, 0xd9c7a7, 0xf0e6d8, 0xd6b99a, 0xe3d3b8, 0xc9d3d6, 0xe6c9a8, 0xd4dcc8, 0xefe3cf, 0xcfc0d8], // residential
  [0xc9d4dc, 0xb8c4cc, 0xdedad2, 0xa9b8c4, 0xd5d0c4],                                               // commercial
  [0xbcb6aa, 0xa8a59d, 0xc2bba9],                                                                   // industrial
  [0xe0cfa8, 0xd8b88f, 0xe9dcc0],                                                                   // civic
  [0xf2e7d5, 0xe8a75a, 0xf5f0e6],                                                                   // religious
  [0xf0d9b5, 0xe8c79a, 0xdcb493, 0xf2e3c6, 0xc8d8c0, 0xe5c0c0, 0xd8e0e6],                           // house
  [0x9aa0a6, 0x8a6f5a, 0x7f8c95, 0xa08a6c],                                                         // shed / informal
];

export function buildBuildings(tile: Tile, mb: MeshBuilder) {
  tile.buildings.forEach((b, bi) => {
    const r = hash01(bi * 7 + 3);
    const pal = PALETTE[b.kind] ?? PALETTE[0];
    const base = pal[Math.floor(r * pal.length)];
    const windows = b.kind !== 6 && b.h > 3.5;
    const wall = hex(base, windows ? M_WALL : M_PLAIN);
    let roof = shade(hex(base), 0.86);
    if (b.kind === 5 && hash01(bi * 13) < 0.35) roof = hex(0xa65a42);
    if (b.kind === 6) roof = hex(0x8d969c);

    const ring = b.ring;
    const n = ring.length / 2;
    let area = 0;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
    }
    const cw = area > 0; // see bake notes: positive area = clockwise in x-east/z-south
    const h = b.h;

    // Walls
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const ax = ring[i * 2], az = ring[i * 2 + 1], bx = ring[j * 2], bz = ring[j * 2 + 1];
      let nx = bz - az, nz = -(bx - ax);
      const l = Math.hypot(nx, nz) || 1;
      nx /= l; nz /= l;
      if (!cw) { nx = -nx; nz = -nz; }
      mb.quad(ax, 0, az, bx, 0, bz, bx, h, bz, ax, h, az, nx, 0, nz, wall);
    }
    // Roof
    const tris = earcut(ring);
    const rb = mb.vCount;
    for (let k = 0; k < n; k++) mb.vertex(ring[k * 2], h, ring[k * 2 + 1], 0, 1, 0, roof);
    for (let k = 0; k < tris.length; k += 3) mb.tri(rb + tris[k], rb + tris[k + 1], rb + tris[k + 2]);

    // Rooftop details: lift/stair room + black water tanks (very Pune)
    const footprint = Math.abs(area / 2);
    if (h > 5 && b.kind !== 6 && footprint > 40) {
      const yaw = Math.atan2(ring[3] - ring[1], ring[2] - ring[0]);
      if (h > 14 && footprint > 200) mb.box(b.cx, b.cz, h, h + 2.8, 3.4, 3.4, yaw, wall === hex(base, M_WALL) ? hex(base) : wall, roof);
      const tanks = footprint > 300 ? 3 : footprint > 120 ? 2 : 1;
      for (let t = 0; t < tanks; t++) {
        const ox = (hash01(bi * 31 + t) - 0.5) * Math.min(6, Math.sqrt(footprint) * 0.4);
        const oz = (hash01(bi * 17 + t) - 0.5) * Math.min(6, Math.sqrt(footprint) * 0.4);
        mb.box(b.cx + ox, b.cz + oz, h, h + 1.3, 1.2, 1.2, yaw + 0.785, hex(0x26292b), hex(0x303336));
      }
    }
  });
}

export const LANE_WIDTH = LANE_W;
export { M_LIGHT };
