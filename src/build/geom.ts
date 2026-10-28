// Growable geometry builder → THREE.BufferGeometry (position, normal, color, uv).
import * as THREE from 'three/webgpu';
import earcut from 'earcut';

export class GeomBuilder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  uv: number[] = [];
  idx: number[] = [];

  get vertexCount() { return this.pos.length / 3; }

  v(x: number, y: number, z: number, nx: number, ny: number, nz: number, r = 1, g = 1, b = 1, u = x, w = z): number {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.col.push(r, g, b);
    this.uv.push(u, w);
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number) { this.idx.push(a, b, c); }

  /** Vertical wall quad between (ax,az)→(bx,bz), bottom ya0/yb0, top ya1/yb1. Normal faces `side` (+1 = left of a→b). */
  wall(ax: number, az: number, bx: number, bz: number, ya0: number, yb0: number, ya1: number, yb1: number, rgb: [number, number, number], uScale = 1, vScale = 1, uOff = 0) {
    let nx = bz - az, nz = -(bx - ax);
    const L = Math.hypot(nx, nz) || 1;
    nx /= L; nz /= L;
    const [r, g, b] = rgb;
    const u0 = uOff * uScale, u1 = (uOff + L) * uScale;
    const i = this.v(ax, ya0, az, nx, 0, nz, r, g, b, u0, ya0 * vScale);
    this.v(bx, yb0, bz, nx, 0, nz, r, g, b, u1, yb0 * vScale);
    this.v(bx, yb1, bz, nx, 0, nz, r, g, b, u1, yb1 * vScale);
    this.v(ax, ya1, az, nx, 0, nz, r, g, b, u0, ya1 * vScale);
    // counter-clockwise seen from the normal side (left of a→b)
    this.tri(i, i + 2, i + 1);
    this.tri(i, i + 3, i + 2);
    return L;
  }

  /** Box (axis-aligned in local frame rotated by yaw). */
  box(x: number, z: number, y0: number, y1: number, sx: number, sz: number, yaw: number, rgb: [number, number, number]) {
    const c = Math.cos(yaw), s = Math.sin(yaw), hx = sx / 2, hz = sz / 2;
    const P = (lx: number, lz: number): [number, number] => [x + lx * c - lz * s, z + lx * s + lz * c];
    const p = [P(-hx, -hz), P(hx, -hz), P(hx, hz), P(-hx, hz)];
    const [r, g, b] = rgb;
    const t = this.v(p[0][0], y1, p[0][1], 0, 1, 0, r, g, b);
    for (let k = 1; k < 4; k++) this.v(p[k][0], y1, p[k][1], 0, 1, 0, r, g, b);
    this.tri(t, t + 2, t + 1); this.tri(t, t + 3, t + 2);
    for (let k = 0; k < 4; k++) {
      const a = p[k], bb = p[(k + 1) % 4];
      // outward = right of a→b for this CCW-in-screen order; use centroid test
      let nx = bb[1] - a[1], nz = -(bb[0] - a[0]);
      const mx = (a[0] + bb[0]) / 2 - x, mz = (a[1] + bb[1]) / 2 - z;
      if (nx * mx + nz * mz < 0) { nx = -nx; nz = -nz; }
      const L = Math.hypot(nx, nz) || 1;
      this.wallRaw(a[0], a[1], bb[0], bb[1], y0, y1, nx / L, nz / L, rgb);
    }
  }

  private wallRaw(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, nx: number, nz: number, rgb: [number, number, number]) {
    const [r, g, b] = rgb;
    const i = this.v(ax, y0, az, nx, 0, nz, r, g, b);
    this.v(bx, y0, bz, nx, 0, nz, r, g, b);
    this.v(bx, y1, bz, nx, 0, nz, r, g, b);
    this.v(ax, y1, az, nx, 0, nz, r, g, b);
    // wind to match the requested normal
    const left = (bz - az) * nx - (bx - ax) * nz > 0;
    if (left) { this.tri(i, i + 2, i + 1); this.tri(i, i + 3, i + 2); }
    else { this.tri(i, i + 1, i + 2); this.tri(i, i + 2, i + 3); }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    const n = this.pos.length / 3;
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

/** Insert points so no edge is longer than maxSeg (keeps draped surfaces following terrain). */
export function densify(ring: Float32Array, maxSeg: number): Float32Array {
  const n = ring.length / 2;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const ax = ring[i * 2], az = ring[i * 2 + 1];
    const j = (i + 1) % n;
    const bx = ring[j * 2], bz = ring[j * 2 + 1];
    out.push(ax, az);
    const L = Math.hypot(bx - ax, bz - az);
    const k = Math.floor(L / maxSeg);
    for (let s = 1; s <= k; s++) { const t = s / (k + 1); out.push(ax + (bx - ax) * t, az + (bz - az) * t); }
  }
  return new Float32Array(out);
}

/** Signed area in x/z (positive = clockwise when viewed from above with z pointing south). */
export function signedArea(ring: Float32Array): number {
  let a = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += ring[i * 2] * ring[j * 2 + 1] - ring[j * 2] * ring[i * 2 + 1];
  }
  return a / 2;
}

/**
 * Triangulate a polygon (with optional holes) and drape it: y = height(x,z).
 * Triangles are wound to face up (+y).
 */
export function drapePolygon(
  gb: GeomBuilder, outer: Float32Array, holes: Float32Array[], height: (x: number, z: number) => number,
  rgb: [number, number, number], maxSeg = 6, uvScale = 0.25,
): number[] {
  const rings = [densify(outer, maxSeg), ...holes.map((h) => densify(h, maxSeg))];
  const flat: number[] = [];
  const holeIdx: number[] = [];
  for (let r = 0; r < rings.length; r++) {
    if (r > 0) holeIdx.push(flat.length / 2);
    for (const v of rings[r]) flat.push(v);
  }
  const tris = earcut(flat, holeIdx.length ? holeIdx : undefined);
  const base = gb.vertexCount;
  const ys: number[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    const y = height(flat[i], flat[i + 1]);
    ys.push(y);
    gb.v(flat[i], y, flat[i + 1], 0, 1, 0, rgb[0], rgb[1], rgb[2], flat[i] * uvScale, flat[i + 1] * uvScale);
  }
  for (let k = 0; k < tris.length; k += 3) {
    const a = tris[k], b = tris[k + 1], c = tris[k + 2];
    // face up: cross((b-a),(c-a)).y > 0  ⇔ (bz-az)(cx-ax) - (bx-ax)(cz-az) > 0
    const cross = (flat[b * 2 + 1] - flat[a * 2 + 1]) * (flat[c * 2] - flat[a * 2]) - (flat[b * 2] - flat[a * 2]) * (flat[c * 2 + 1] - flat[a * 2 + 1]);
    if (cross > 0) gb.tri(base + a, base + b, base + c);
    else gb.tri(base + a, base + c, base + b);
  }
  return ys;
}

export const rgbHex = (h: number): [number, number, number] => {
  const c = new THREE.Color(h);
  return [c.r, c.g, c.b];
};

/**
 * Drape a band polygon (ring = left edge forward + right edge backward, as built by lanes.band)
 * as a quad strip — linear time, no ear clipping. Long pieces are subdivided so the surface follows height.
 */
export function drapeBand(
  gb: GeomBuilder, ring: Float32Array, height: (x: number, z: number) => number,
  rgb: [number, number, number], maxSeg = 5, uvScale = 0.25,
) {
  const n = ring.length / 4; // points per edge
  if (n < 2) return;
  const L = (i: number): [number, number] => [ring[i * 2], ring[i * 2 + 1]];
  const R = (i: number): [number, number] => [ring[(2 * n - 1 - i) * 2], ring[(2 * n - 1 - i) * 2 + 1]];
  let prevL = -1, prevR = -1;
  let s = 0;
  const emit = (l: [number, number], r: [number, number]) => {
    const il = gb.v(l[0], height(l[0], l[1]), l[1], 0, 1, 0, rgb[0], rgb[1], rgb[2], s * uvScale, 0);
    const ir = gb.v(r[0], height(r[0], r[1]), r[1], 0, 1, 0, rgb[0], rgb[1], rgb[2], s * uvScale, Math.hypot(r[0] - l[0], r[1] - l[1]) * uvScale);
    if (prevL >= 0) {
      // face up: left edge is on the left of travel
      gb.tri(prevL, prevR, il);
      gb.tri(prevR, ir, il);
    }
    prevL = il; prevR = ir;
  };
  for (let i = 0; i < n; i++) {
    const l = L(i), r = R(i);
    if (i > 0) {
      const pl = L(i - 1), pr = R(i - 1);
      const len = Math.max(Math.hypot(l[0] - pl[0], l[1] - pl[1]), Math.hypot(r[0] - pr[0], r[1] - pr[1]));
      const k = Math.floor(len / maxSeg);
      for (let j = 1; j <= k; j++) {
        const t = j / (k + 1);
        s += len / (k + 1);
        emit([pl[0] + (l[0] - pl[0]) * t, pl[1] + (l[1] - pl[1]) * t], [pr[0] + (r[0] - pr[0]) * t, pr[1] + (r[1] - pr[1]) * t]);
      }
      s += len / (k + 1);
    }
    emit(l, r);
  }
}

export interface Chunk { geo: THREE.BufferGeometry; cx: number; cz: number; radius: number }

/**
 * Split a builder's triangles into square spatial chunks (by triangle centroid) so the renderer can
 * frustum-cull and distance-cull them. Vertices are re-indexed per chunk.
 */
export function splitChunks(gb: GeomBuilder, size = 400): Chunk[] {
  const P = gb.pos, Nn = gb.nor, C = gb.col, U = gb.uv, I = gb.idx;
  const buckets = new Map<number, number[]>();
  for (let t = 0; t < I.length; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const x = (P[a] + P[b] + P[c]) / 3, z = (P[a + 2] + P[b + 2] + P[c + 2]) / 3;
    const k = Math.floor(x / size) * 65536 + Math.floor(z / size);
    (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(t);
  }
  const out: Chunk[] = [];
  for (const tris of buckets.values()) {
    const remap = new Map<number, number>();
    const pos: number[] = [], nor: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
    for (const t of tris) for (let k = 0; k < 3; k++) {
      const v = I[t + k];
      let r = remap.get(v);
      if (r === undefined) {
        r = pos.length / 3;
        remap.set(v, r);
        pos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
        nor.push(Nn[v * 3], Nn[v * 3 + 1], Nn[v * 3 + 2]);
        col.push(C[v * 3], C[v * 3 + 1], C[v * 3 + 2]);
        uv.push(U[v * 2], U[v * 2 + 1]);
      }
      idx.push(r);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    const s = g.boundingSphere!;
    out.push({ geo: g, cx: s.center.x, cz: s.center.z, radius: s.radius });
  }
  return out;
}

/** Append all of `src`'s triangles into `dst` (same vertex layout). */
export function appendInto(dst: GeomBuilder, src: GeomBuilder) {
  const base = dst.vertexCount;
  for (const v of src.pos) dst.pos.push(v);
  for (const v of src.nor) dst.nor.push(v);
  for (const v of src.col) dst.col.push(v);
  for (const v of src.uv) dst.uv.push(v);
  for (const i of src.idx) dst.idx.push(i + base);
}
