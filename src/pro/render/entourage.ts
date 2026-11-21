// Life round the buildings: the planting as its five species (src/build/plants.ts: rain tree, round, palm, ashoka,
// shrub), each instanced with its own green, size and turn; cars parked in the lots and along the road; people at the
// entrance and on the paths. Low-poly and clean rather than photographic (where web viewers look worst), placed by a
// seeded hash so the same scheme always looks the same. Road markings: centre dashes and edge lines.
import * as THREE from 'three';
import { plantGeometries, PLANT_GREENS } from '../../build/plants';

let near: THREE.BufferGeometry[] | null = null, far: THREE.BufferGeometry[] | null = null;
const plants = (detail: boolean) => (detail ? (near ??= plantGeometries(true)) : (far ??= plantGeometries(false)));
const hash = (x: number, z: number, k = 0) => { const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453; return s - Math.floor(s); };
const dummy = new THREE.Object3D();

export interface Tree { x: number; z: number; r: number; kind: number }

/** the trees as instanced species: one mesh per kind */
export function treeMeshes(trees: Tree[], detail: boolean, mat: THREE.Material): THREE.InstancedMesh[] {
  const geos = plants(detail), out: THREE.InstancedMesh[] = [];
  for (let k = 0; k < geos.length; k++) {
    const T = trees.filter((t) => t.kind === k);
    if (!T.length) continue;
    const im = new THREE.InstancedMesh(geos[k], mat, T.length), col = new THREE.Color();
    T.forEach((t, i) => {
      const h = hash(t.x, t.z), s = t.r * (0.85 + 0.3 * h);
      dummy.position.set(t.x, 0, t.z); dummy.rotation.set(0, h * Math.PI * 2, 0); dummy.scale.setScalar(s); dummy.updateMatrix();
      im.setMatrixAt(i, dummy.matrix);
      const g = PLANT_GREENS[k]; col.setHex(g[Math.floor(hash(t.z, t.x, 1) * g.length) % g.length]);
      im.setColorAt(i, col);
    });
    im.castShadow = true; im.receiveShadow = true;
    im.computeBoundingSphere();
    out.push(im);
  }
  return out;
}

const CAR_COLOURS = ['#e8e8e6', '#1c1d20', '#8d9196', '#b3262a', '#2f4a6b', '#c9c3b5', '#4a4d52', '#f2f0ea'];
const PEOPLE = ['#3b4a5c', '#8a3b3b', '#d9c7a8', '#2f2f33', '#5b6e4a', '#c6a35a', '#ece7dc'];
const carBody = new THREE.BoxGeometry(1, 1, 1), cabin = new THREE.BoxGeometry(1, 1, 1);
const person = new THREE.CapsuleGeometry(0.2, 1.15, 3, 8), head = new THREE.SphereGeometry(0.12, 10, 8);
person.translate(0, 0.78, 0); head.translate(0, 1.63, 0);

/** cars at (x, z, heading): a body and a glass cabin, instanced */
export function carMeshes(cars: [number, number, number][], body: THREE.Material, glass: THREE.Material): THREE.InstancedMesh[] {
  if (!cars.length) return [];
  const b = new THREE.InstancedMesh(carBody, body, cars.length), c = new THREE.InstancedMesh(cabin, glass, cars.length), col = new THREE.Color();
  cars.forEach(([x, z, a], i) => {
    dummy.position.set(x, 0.55, z); dummy.rotation.set(0, a, 0); dummy.scale.set(1.8, 0.75, 4.3); dummy.updateMatrix(); b.setMatrixAt(i, dummy.matrix);
    col.set(CAR_COLOURS[Math.floor(hash(x, z, 2) * CAR_COLOURS.length) % CAR_COLOURS.length]); b.setColorAt(i, col);
    dummy.position.set(x - Math.sin(a) * 0.2, 1.18, z - Math.cos(a) * 0.2); dummy.scale.set(1.62, 0.55, 2.3); dummy.updateMatrix(); c.setMatrixAt(i, dummy.matrix);
  });
  for (const m of [b, c]) { m.castShadow = true; m.receiveShadow = true; m.computeBoundingSphere(); }
  return [b, c];
}

/** people standing at (x, z), facing a little this way and that */
export function peopleMeshes(at: [number, number][], body: THREE.Material, skin: THREE.Material): THREE.InstancedMesh[] {
  if (!at.length) return [];
  const p = new THREE.InstancedMesh(person, body, at.length), h = new THREE.InstancedMesh(head, skin, at.length), col = new THREE.Color();
  at.forEach(([x, z], i) => {
    const s = 0.92 + hash(x, z, 3) * 0.16;
    dummy.position.set(x, 0, z); dummy.rotation.set(0, hash(z, x, 4) * Math.PI * 2, 0); dummy.scale.set(s, s, s); dummy.updateMatrix();
    p.setMatrixAt(i, dummy.matrix); h.setMatrixAt(i, dummy.matrix);
    col.set(PEOPLE[Math.floor(hash(x, z, 5) * PEOPLE.length) % PEOPLE.length]); p.setColorAt(i, col);
  });
  for (const m of [p, h]) { m.castShadow = true; m.receiveShadow = true; m.computeBoundingSphere(); }
  return [p, h];
}

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
