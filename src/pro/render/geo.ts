// Geometry for the shaded view, in metres with metre UVs (so the material library's textures tile at true size):
// prisms and flat shapes, and a building's face built floor by floor with its openings cut into it and their reveals
// going back into the wall, so windows sit in the wall instead of on it.
import * as THREE from 'three';

/** triangles with normals and uvs, gathered then made into one BufferGeometry */
export class GeoBuf {
  p: number[] = []; n: number[] = []; uv: number[] = [];
  get empty() { return !this.p.length; }
  /** a quad a b c d (counter-clockwise seen from where its normal points), its uvs */
  quad(a: number[], b: number[], c: number[], d: number[], nrm: number[], ua: number[], ub: number[], uc: number[], ud: number[]) {
    // (wound to face along its normal, whichever order the corners came in)
    const ex = b[0] - a[0], ey = b[1] - a[1], ez = b[2] - a[2], fx = c[0] - a[0], fy = c[1] - a[1], fz = c[2] - a[2];
    const flip = (ey * fz - ez * fy) * nrm[0] + (ez * fx - ex * fz) * nrm[1] + (ex * fy - ey * fx) * nrm[2] < 0;
    const seq: [number[], number[]][] = flip ? [[a, ua], [c, uc], [b, ub], [a, ua], [d, ud], [c, uc]] : [[a, ua], [b, ub], [c, uc], [a, ua], [c, uc], [d, ud]];
    for (const [v, u] of seq) { this.p.push(v[0], v[1], v[2]); this.n.push(nrm[0], nrm[1], nrm[2]); this.uv.push(u[0], u[1]); }
  }
  geo(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere();
    return g;
  }
}

/** a prism over a ring (x,z,…) from y0 to y1, sides (uv: along the perimeter, up) and top (uv: plan) */
export function prism(ring: number[], y0: number, y1: number, top = true): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < ring.length; i += 2) pts.push(new THREE.Vector2(ring[i], ring[i + 1]));
  const pos: number[] = [], uv: number[] = [], n = pts.length;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], L = a.distanceTo(b);
    pos.push(a.x, y0, a.y, b.x, y0, b.y, b.x, y1, b.y, a.x, y0, a.y, b.x, y1, b.y, a.x, y1, a.y);
    uv.push(s, y0, s + L, y0, s + L, y1, s, y0, s + L, y1, s, y1);
    s += L;
  }
  if (top) {
    const tri = THREE.ShapeUtils.triangulateShape(pts, []);
    for (const [i, j, k] of tri) { pos.push(pts[i].x, y1, pts[i].y, pts[k].x, y1, pts[k].y, pts[j].x, y1, pts[j].y); uv.push(pts[i].x, pts[i].y, pts[k].x, pts[k].y, pts[j].x, pts[j].y); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** a flat shape (x,z,…) at height y, facing up (or down), uv in plan */
export function flat(ring: number[], y: number, down = false): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < ring.length; i += 2) pts.push(new THREE.Vector2(ring[i], ring[i + 1]));
  if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
  const tri = THREE.ShapeUtils.triangulateShape(pts, []), pos: number[] = [], uv: number[] = [], nrm: number[] = [];
  for (const [i, j, k] of tri) {
    const o = down ? [i, j, k] : [i, k, j];
    for (const q of o) { pos.push(pts[q].x, y, pts[q].y); uv.push(pts[q].x, pts[q].y); nrm.push(0, down ? -1 : 1, 0); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return g;
}

export interface Face { ax: number; az: number; ux: number; uz: number; nx: number; nz: number; L: number }
/** an opening in a face: from s0 to s1 along it, from y0 to y1 */
export interface Hole { s0: number; s1: number; y0: number; y1: number }

/** One floor band of a face (y0 … y1) with its openings cut out, and each opening's reveal going `recess` back into
 *  the wall (jambs, head, sill). The face at its outward normal; uvs along it and up, in metres. */
export function cutFace(out: GeoBuf, f: Face, y0: number, y1: number, holes: Hole[], recess: number) {
  const P = (s: number, y: number, d = 0) => [f.ax + f.ux * s - f.nx * d, y, f.az + f.uz * s - f.nz * d];
  const N = [f.nx, 0, f.nz];
  const H = holes.map((h) => ({ s0: Math.max(0.02, h.s0), s1: Math.min(f.L - 0.02, h.s1), y0: Math.max(y0 + 0.02, h.y0), y1: Math.min(y1 - 0.02, h.y1) })).filter((h) => h.s1 - h.s0 > 0.05 && h.y1 - h.y0 > 0.05);
  const xs = [...new Set([0, f.L, ...H.flatMap((h) => [h.s0, h.s1])])].sort((a, b) => a - b);
  for (let i = 0; i + 1 < xs.length; i++) {
    const a = xs[i], b = xs[i + 1];
    if (b - a < 1e-4) continue;
    // the solid spans of this column: the band less the openings covering it
    const cut = H.filter((h) => h.s0 <= a + 1e-4 && h.s1 >= b - 1e-4).sort((p, q) => p.y0 - q.y0);
    let y = y0;
    const span = (ya: number, yb: number) => { if (yb - ya > 1e-3) out.quad(P(a, ya), P(b, ya), P(b, yb), P(a, yb), N, [a, ya], [b, ya], [b, yb], [a, yb]); };
    for (const h of cut) { span(y, h.y0); y = Math.max(y, h.y1); }
    span(y, y1);
  }
  if (recess > 0.005) for (const h of H) {
    // jambs face into the opening, the head down, the sill up
    out.quad(P(h.s0, h.y0, 0), P(h.s0, h.y0, recess), P(h.s0, h.y1, recess), P(h.s0, h.y1, 0), [f.ux, 0, f.uz], [0, h.y0], [recess, h.y0], [recess, h.y1], [0, h.y1]);
    out.quad(P(h.s1, h.y0, recess), P(h.s1, h.y0, 0), P(h.s1, h.y1, 0), P(h.s1, h.y1, recess), [-f.ux, 0, -f.uz], [0, h.y0], [recess, h.y0], [recess, h.y1], [0, h.y1]);
    out.quad(P(h.s0, h.y1, 0), P(h.s0, h.y1, recess), P(h.s1, h.y1, recess), P(h.s1, h.y1, 0), [0, -1, 0], [h.s0, 0], [h.s0, recess], [h.s1, recess], [h.s1, 0]);
    out.quad(P(h.s0, h.y0, recess), P(h.s0, h.y0, 0), P(h.s1, h.y0, 0), P(h.s1, h.y0, recess), [0, 1, 0], [h.s0, recess], [h.s0, 0], [h.s1, 0], [h.s1, recess]);
  }
}
