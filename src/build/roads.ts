// Road network meshing from osm2streets polygons + the elevation field.
import { GeomBuilder, drapePolygon, drapeBand, densify, rgbHex } from './geom';
import type { StreetNet, StreetRoad } from '../geo/streets';
import type { Elevation } from '../geo/elevation';
import type { Heightfield } from '../geo/heightfield';

const KERB = 0.15;
const FOOT_HW = new Set(['footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway', 'corridor', 'track']);
const SLAB = 1.3;          // bridge deck thickness
const SLAB_MIN_CLEAR = 3.2; // above this clearance a road is a deck on pillars; below it, a solid embankment

export interface RoadMeshes {
  asphalt: GeomBuilder;
  paving: GeomBuilder;
  markings: GeomBuilder;
  concrete: GeomBuilder;
  targets: Float32Array; // terrain carve targets per grid vertex (NaN = none)
  surfaces: SurfaceIndex;
}

const COL = {
  driving: rgbHex(0x4b4d51), shoulder: rgbHex(0x606165), parking: rgbHex(0x56575a), junction: rgbHex(0x484a4e),
  bus: rgbHex(0x8a3a32), bike: rgbHex(0x3d7a52), construction: rgbHex(0x8a6a48), track: rgbHex(0x7d6a52),
  sidewalk: rgbHex(0xb7ad9c), footway: rgbHex(0xa99f8c), kerb: rgbHex(0x9d9a93), median: rgbHex(0x8f8c84),
  white: rgbHex(0xe9e9e4), yellow: rgbHex(0xe2bd3f), concrete: rgbHex(0xa8a49b), concreteDark: rgbHex(0x8e8a82),
};

/** Spatial index of drivable/walkable surfaces so markings & props can find the right height. */
export class SurfaceIndex {
  private cell = 25;
  private grid = new Map<number, number[]>();
  private polys: { ring: Float32Array; layer: number; z: (x: number, z: number) => number; bbox: [number, number, number, number] }[] = [];

  add(ring: Float32Array, layer: number, z: (x: number, z: number) => number) {
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]); }
    const id = this.polys.push({ ring, layer, z, bbox: [x0, z0, x1, z1] }) - 1;
    for (let j = Math.floor(z0 / this.cell); j <= Math.floor(z1 / this.cell); j++)
      for (let i = Math.floor(x0 / this.cell); i <= Math.floor(x1 / this.cell); i++) {
        const k = i * 73856093 ^ j * 19349663;
        (this.grid.get(k) ?? this.grid.set(k, []).get(k)!).push(id);
      }
  }

  /** Height of the surface under (x,z). `layer` > 0 prefers the highest surface, otherwise the lowest. */
  heightAt(x: number, z: number, layer = 0): number | null {
    const k = Math.floor(x / this.cell) * 73856093 ^ Math.floor(z / this.cell) * 19349663;
    const ids = this.grid.get(k);
    if (!ids) return null;
    let best: number | null = null;
    for (const id of ids) {
      const p = this.polys[id];
      if (x < p.bbox[0] - 0.3 || x > p.bbox[2] + 0.3 || z < p.bbox[1] - 0.3 || z > p.bbox[3] + 0.3) continue;
      if (!pointInRing(x, z, p.ring) && distToRing(x, z, p.ring) > 0.35) continue;
      const h = p.z(x, z);
      if (best === null || (layer > 0 ? h > best : h < best)) best = h;
    }
    return best;
  }
}

function pointInRing(x: number, z: number, r: Float32Array): boolean {
  let c = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2], zi = r[i * 2 + 1], xj = r[j * 2], zj = r[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
function distToRing(x: number, z: number, r: Float32Array): number {
  let best = Infinity;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = r[i * 2], az = r[i * 2 + 1], dx = r[j * 2] - ax, dz = r[j * 2 + 1] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1e-9)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

/** Stamp a draped triangle-soup surface into terrain carve targets (conservative, nearest-point). */
function stampTargets(hf: Heightfield, targets: Float32Array, ring: Float32Array, zf: (x: number, z: number) => number, maxClear: number) {
  const n = hf.n, cell = hf.cell, half = hf.half;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]); }
  const pad = cell * 0.75;
  const i0 = Math.max(0, Math.floor((x0 - pad + half) / cell)), i1 = Math.min(n - 1, Math.ceil((x1 + pad + half) / cell));
  const j0 = Math.max(0, Math.floor((z0 - pad + half) / cell)), j1 = Math.min(n - 1, Math.ceil((z1 + pad + half) / cell));
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const x = -half + i * cell, z = -half + j * cell;
    let px = x, pz = z;
    if (!pointInRing(x, z, ring)) {
      // nearest point on the boundary
      let best = Infinity;
      const m = ring.length / 2;
      for (let a = 0; a < m; a++) {
        const b = (a + 1) % m;
        const ax = ring[a * 2], az = ring[a * 2 + 1], dx = ring[b * 2] - ax, dz = ring[b * 2 + 1] - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1e-9)));
        const qx = ax + dx * t, qz = az + dz * t;
        const d = Math.hypot(x - qx, z - qz);
        if (d < best) { best = d; px = qx; pz = qz; }
      }
      if (best > pad) continue;
    }
    const zs = zf(px, pz);
    if (zs - hf.sample(px, pz) > maxClear) continue; // elevated: don't drag terrain up to a deck
    const t = zs - 0.32;
    const k = j * n + i;
    if (Number.isNaN(targets[k]) || t < targets[k]) targets[k] = t;
  }
}

/** Terrain carve targets from a road's centre line: grid vertices within half-width (+ margin) of each sample. */
function stampRoadTargets(hf: Heightfield, targets: Float32Array, r: StreetRoad, halfW: number, zf: (x: number, z: number) => number) {
  const c = r.center, n = c.length / 2, cell = hf.cell, half = hf.half, gn = hf.n;
  const rad = halfW + cell * 0.75, rad2 = rad * rad;
  for (let i = 0; i < n - 1; i++) {
    const ax = c[i * 2], az = c[i * 2 + 1], bx = c[i * 2 + 2], bz = c[i * 2 + 3];
    const L = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(L / 2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const zs = zf(x, z);
      if (zs - hf.sample(x, z) > 1.0) continue; // elevated: leave the ground alone
      const tz = zs - 0.32;
      const i0 = Math.max(0, Math.ceil((x - rad + half) / cell)), i1 = Math.min(gn - 1, Math.floor((x + rad + half) / cell));
      const j0 = Math.max(0, Math.ceil((z - rad + half) / cell)), j1 = Math.min(gn - 1, Math.floor((z + rad + half) / cell));
      for (let jj = j0; jj <= j1; jj++) for (let ii = i0; ii <= i1; ii++) {
        const dx = -half + ii * cell - x, dz = -half + jj * cell - z;
        if (dx * dx + dz * dz > rad2) continue;
        const k = jj * gn + ii;
        if (Number.isNaN(targets[k]) || tz < targets[k]) targets[k] = tz;
      }
    }
  }
}

export function buildRoadMeshes(net: StreetNet, elev: Elevation, hf: Heightfield): RoadMeshes {
  const asphalt = new GeomBuilder(), paving = new GeomBuilder(), markings = new GeomBuilder(), concrete = new GeomBuilder();
  const targets = new Float32Array(hf.n * hf.n).fill(NaN);
  const surfaces = new SurfaceIndex();
  const T = (x: number, z: number) => hf.sample(x, z);

  // ---------------- Junctions ----------------
  for (const it of net.intersections.values()) {
    if (it.poly.length < 6) continue;
    const zf = (x: number, z: number) => elev.junctionZ(it.id, x, z);
    // junctions where only paths meet are paved, not asphalt
    const footOnly = it.roads.length > 0 && it.roads.every((id) => FOOT_HW.has(net.roads.get(id)?.highway ?? ''));
    if (footOnly) drapePolygon(paving, it.poly, [], zf, COL.footway, 5);
    else drapePolygon(asphalt, it.poly, [], zf, COL.junction, 5);
    const layer = (elev.offset.get(it.id) ?? 0) > 0 ? 1 : 0;
    surfaces.add(it.poly, layer, zf);
    if (!layer) stampTargets(hf, targets, it.poly, zf, 1.0);
    else structureUnder(concrete, it.poly, zf, T, false, null);
  }

  const tick = (label: string) => console.info(`[UrbanPlan]   roads/${label} ${Math.round(performance.now() - t0)}ms`);
  const t0 = performance.now();
  tick('junctions');
  // ---------------- Lanes ----------------
  const roadOf = (id: number) => net.roads.get(id);
  for (const lane of net.lanes) {
    const r = roadOf(lane.road);
    if (!r || lane.poly.length < 6) continue;
    const zf = (x: number, z: number) => elev.roadZ(r, x, z);
    const prof = elev.profiles.get(r.id);
    const layer = prof?.elevated ? 1 : 0;
    const t = lane.type;
    const isWalk = t === 'Sidewalk';
    if (isWalk) {
      const top = (x: number, z: number) => zf(x, z) + KERB;
      drapeBand(paving, lane.poly, top, COL.sidewalk, 5);
      kerbWalls(paving, lane.poly, zf, KERB, COL.kerb);
    } else {
      const c = t === 'Driving' || t === 'SharedLeftTurn' ? COL.driving
        : t === 'Shoulder' ? COL.shoulder : t === 'Parking' ? COL.parking : t === 'Bus' ? COL.bus
          : t === 'Biking' ? COL.bike : t === 'Construction' ? COL.construction
            : t === 'Footway' || t === 'SharedUse' ? COL.footway : t.startsWith('Buffer') ? COL.median : COL.driving;
      const target = t === 'Footway' || t === 'SharedUse' ? paving : asphalt;
      if (t.startsWith('Buffer')) {
        const top = (x: number, z: number) => zf(x, z) + 0.25;
        drapeBand(paving, lane.poly, top, COL.median, 5);
        kerbWalls(paving, lane.poly, zf, 0.25, COL.kerb);
      } else {
        drapeBand(target, lane.poly, zf, r.highway === 'track' ? COL.track : c, 5);
      }
    }
    void layer;
  }
  for (const r of net.roads.values()) {
    const w = r.lanes.reduce((a, l) => a + l.width, 0);
    if (r.center.length >= 4 && w > 0) stampRoadTargets(hf, targets, r, w / 2, (x, z) => elev.roadZ(r, x, z));
  }

  tick('lanes+targets');
  // ---------------- Elevated road structure: decks, embankments, parapets, pillars ----------------
  for (const r of net.roads.values()) {
    const prof = elev.profiles.get(r.id);
    if (!prof?.elevated || r.outline.length < 6) continue;
    const zf = (x: number, z: number) => elev.roadZ(r, x, z);
    structureUnder(concrete, r.outline, zf, T, prof.bridge, (x, z) => elev.roadT(r, x, z));
    pillars(concrete, r, zf, T);
  }

  tick('structures');
  // ---------------- Kerb corners at junctions ----------------
  for (const ring of net.corners) {
    if (ring.length < 6) continue;
    let cx = 0, cz = 0;
    for (let i = 0; i < ring.length; i += 2) { cx += ring[i]; cz += ring[i + 1]; }
    cx /= ring.length / 2; cz /= ring.length / 2;
    const base = surfaces.heightAt(cx, cz, 0) ?? T(cx, cz) + 0.06;
    const zf = () => base;
    drapePolygon(paving, ring, [], () => base + KERB, COL.sidewalk, 5);
    kerbWalls(paving, ring, zf, KERB, COL.kerb);
  }

  // ---------------- Markings (snap to the correct level by layer) ----------------
  for (const m of net.markings) {
    if (m.poly.length < 6) continue;
    const own = m.road !== undefined ? net.roads.get(m.road) : undefined;
    if (own) {
      drapeBand(markings, m.poly, (x, z) => elev.roadZ(own, x, z) + 0.025, m.type === 'center line' ? COL.yellow : COL.white, 5);
      continue;
    }
    let cx = 0, cz = 0;
    for (let i = 0; i < m.poly.length; i += 2) { cx += m.poly[i]; cz += m.poly[i + 1]; }
    cx /= m.poly.length / 2; cz /= m.poly.length / 2;
    const layer = m.layer;
    const hc = surfaces.heightAt(cx, cz, layer);
    if (hc === null) continue;
    const off = hc - T(cx, cz);
    const col = m.type === 'center line' ? COL.yellow : COL.white;
    drapePolygon(markings, m.poly, [], (x, z) => {
      const h = surfaces.heightAt(x, z, layer);
      return (h ?? T(x, z) + off) + 0.025;
    }, col, 50);
  }

  tick('markings');
  return { asphalt, paving, markings, concrete, targets, surfaces };
}

/** Raised kerb walls around a polygon from base z to z+h. */
function kerbWalls(gb: GeomBuilder, ring: Float32Array, zf: (x: number, z: number) => number, h: number, rgb: [number, number, number]) {
  const r = densify(ring, 5);
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
    const za = zf(ax, az), zb = zf(bx, bz);
    gb.wall(ax, az, bx, bz, za - 0.05, zb - 0.05, za + h, zb + h, rgb);
  }
}

/** Deck slab underside + side walls (or embankment walls down into the terrain). */
function structureUnder(
  gb: GeomBuilder, ring: Float32Array, zf: (x: number, z: number) => number, T: (x: number, z: number) => number,
  parapet: boolean, tOf: ((x: number, z: number) => number) | null,
) {
  const r = densify(ring, 4);
  const n = r.length / 2;
  const bottom = (x: number, z: number) => {
    const s = zf(x, z), g = T(x, z);
    return s - g > SLAB_MIN_CLEAR ? s - SLAB : g - 0.4;
  };
  // underside (only meaningful where it's a slab; embankment parts end up below ground)
  if (tOf) drapeBand(gb, ring, (x, z) => bottom(x, z), COL.concreteDark, 4);
  else drapePolygon(gb, ring, [], (x, z) => bottom(x, z), COL.concreteDark, 4);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1];
    const za = zf(ax, az), zb = zf(bx, bz);
    gb.wall(ax, az, bx, bz, bottom(ax, az), bottom(bx, bz), za, zb, COL.concrete);
    if (parapet && tOf) {
      const ta = tOf(ax, az), tb = tOf(bx, bz);
      const atEnd = (ta < 0.015 && tb < 0.015) || (ta > 0.985 && tb > 0.985);
      if (!atEnd && za - T(ax, az) > 1.5) gb.wall(ax, az, bx, bz, za, zb, za + 1.0, zb + 1.0, COL.concrete);
    }
  }
}

/** Pillars every ~26 m under decks. */
function pillars(gb: GeomBuilder, r: StreetRoad, zf: (x: number, z: number) => number, T: (x: number, z: number) => number) {
  const c = r.center, n = c.length / 2;
  if (n < 2) return;
  const width = r.lanes.reduce((s, l) => s + l.width, 0) || 7;
  let acc = 13;
  for (let i = 0; i < n - 1; i++) {
    const ax = c[i * 2], az = c[i * 2 + 1], bx = c[i * 2 + 2], bz = c[i * 2 + 3];
    const L = Math.hypot(bx - ax, bz - az);
    const yaw = Math.atan2(bz - az, bx - ax);
    while (acc < L) {
      const t = acc / L;
      const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
      const top = zf(x, z) - SLAB, g = T(x, z);
      if (top - g > 2) {
        const pw = Math.min(width * 0.45, 3.2);
        gb.box(x, z, g - 1, top - 0.6, 1.4, pw, yaw, COL.concrete);           // column
        gb.box(x, z, top - 0.6, top, 1.8, width * 0.8, yaw, COL.concreteDark); // pier cap
      }
      acc += 26;
    }
    acc -= L;
  }
}
