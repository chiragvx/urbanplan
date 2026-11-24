// Placing life round the buildings (the vehicles and people themselves are built in ./vehicles.ts, the trees in
// ./landscape/trees.ts): parking slots on a grid in a lot; road markings, centre dashes and edge lines.
import * as THREE from 'three';

/** points inside a polygon (x,z,…) on a grid of `du` × `dv` along (ux, uz), for parking */
export function gridIn(poly: number[], ux: number, uz: number, du: number, dv: number, inside: (x: number, z: number) => boolean): [number, number][] {
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (let i = 0; i < poly.length; i += 2) { const u = poly[i] * ux + poly[i + 1] * uz, v = -poly[i] * uz + poly[i + 1] * ux; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const out: [number, number][] = [];
  for (let u = u0 + du / 2; u < u1; u += du) for (let v = v0 + dv / 2; v < v1; v += dv) { const x = u * ux - v * uz, z = u * uz + v * ux; if (inside(x, z)) out.push([x, z]); }
  return out;
}

/** road markings along centre lines (x0,z0,x1,z1 per stretch, width): dashes 3 m on 4.5 off down the middle, edge lines */
export function markings(lines: { pts: number[]; w: number; edges: boolean }[], keep: (x: number, z: number) => boolean = () => true): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const strip = (ax: number, az: number, bx: number, bz: number, w: number, y: number) => {
    const L = Math.hypot(bx - ax, bz - az); if (L < 0.05 || !keep((ax + bx) / 2, (az + bz) / 2)) return;
    const nx = -(bz - az) / L * w / 2, nz = (bx - ax) / L * w / 2;
    pos.push(ax + nx, y, az + nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz, ax + nx, y, az + nz, bx - nx, y, bz - nz, ax - nx, y, az - nz);
  };
  for (const ln of lines) for (let i = 0; i + 3 < ln.pts.length; i += 2) {
    const x0 = ln.pts[i], z0 = ln.pts[i + 1], x1 = ln.pts[i + 2], z1 = ln.pts[i + 3], L = Math.hypot(x1 - x0, z1 - z0);
    if (L < 1) continue;
    const ux = (x1 - x0) / L, uz = (z1 - z0) / L;
    for (let t = 1; t + 3 < L; t += 7.5) strip(x0 + ux * t, z0 + uz * t, x0 + ux * (t + 3), z0 + uz * (t + 3), 0.12, 0.075);
    if (ln.edges) for (const s of [-1, 1]) { const o = (ln.w / 2 - 0.3) * s; strip(x0 - uz * o, z0 + ux * o, x1 - uz * o, z1 + ux * o, 0.1, 0.075); }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const n = new Float32Array(pos.length); for (let i = 1; i < n.length; i += 3) n[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  // (wound to face up)
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i += 3) {
    const ax = p.getX(i), az = p.getZ(i), bx = p.getX(i + 1), bz = p.getZ(i + 1), cx = p.getX(i + 2), cz = p.getZ(i + 2);
    if ((bx - ax) * (cz - az) - (bz - az) * (cx - ax) > 0) { p.setXYZ(i + 1, cx, p.getY(i + 2), cz); p.setXYZ(i + 2, bx, p.getY(i + 1), bz); }
  }
  return g;
}
