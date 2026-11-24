// Vehicles and people, low-poly but true to life: each kind built from its side profile (extruded across its width with
// chamfered edges), a glass cabin narrower than the body, wheels with rims, lights; real sizes and the colours cars on
// an Indian street actually come in (white and silver first). Built once per kind and placed as instanced meshes, a
// mesh per part (paint, glass, trim, …), the paint coloured per instance from a seeded hash.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type VehicleKind = 'hatchback' | 'sedan' | 'suv' | 'van' | 'auto' | 'motorcycle' | 'scooter' | 'truck';
export const VEHICLE_KINDS: VehicleKind[] = ['hatchback', 'sedan', 'suv', 'van', 'auto', 'motorcycle', 'scooter', 'truck'];
type Role = 'paint' | 'glass' | 'trim' | 'rim' | 'light' | 'tail' | 'canvas' | 'bed' | 'seat';
export interface VehiclePart { role: Role; geometry: THREE.BufferGeometry }

const hash = (x: number, z: number, k = 0) => { const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453; return s - Math.floor(s); };

// (the paint: weighted as Indian car sales run, white far ahead; autos in their yellow and green; trucks in their own)
const PAINT: Record<string, [string, number][]> = {
  car: [['#f1f1ee', 34], ['#b9bcbf', 16], ['#7d8186', 12], ['#1d1f22', 9], ['#8e1f24', 8], ['#24446b', 7], ['#6b5544', 5], ['#c4b8a2', 5], ['#3e5a3b', 2], ['#d06a1f', 2]],
  auto: [['#e2b417', 6], ['#2f7d3a', 4]],
  bike: [['#1d1f22', 10], ['#8e1f24', 5], ['#24446b', 4], ['#b9bcbf', 4], ['#f1f1ee', 3]],
  truck: [['#d86a1c', 4], ['#2f5f9e', 4], ['#e2b417', 3], ['#f1f1ee', 3], ['#3e7a4a', 2]],
};
const paintOf = (kind: VehicleKind) => (kind === 'auto' ? PAINT.auto : kind === 'motorcycle' || kind === 'scooter' ? PAINT.bike : kind === 'truck' ? PAINT.truck : PAINT.car);
function pick(list: [string, number][], t: number) { const tot = list.reduce((s, [, w]) => s + w, 0); let a = t * tot; for (const [c, w] of list) { a -= w; if (a <= 0) return c; } return list[0][0]; }

// ---------------------------------------------------------------- building blocks
/** a side profile (z along the length, +z the front; y up) extruded across a width, centred, its edges chamfered */
function side(profile: number[][], w: number, chamfer = 0.04): THREE.BufferGeometry {
  const sh = new THREE.Shape(profile.map(([z, y]) => new THREE.Vector2(z, y)));
  const c = Math.min(chamfer, w / 4);
  const g = new THREE.ExtrudeGeometry(sh, { depth: Math.max(0.01, w - 2 * c), bevelEnabled: c > 0, bevelThickness: c, bevelSize: c * 0.8, bevelSegments: 1, curveSegments: 4 });
  g.rotateY(-Math.PI / 2); g.translate(w / 2 - c, 0, 0);
  return clean(g);
}
function box(w: number, h: number, l: number, x: number, y: number, z: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, l); g.translate(x, y, z); return clean(g);
}
/** a wheel at (x, z) of radius r and width w, its axle across */
function wheel(x: number, z: number, r: number, w: number, seg = 10): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r, r, w, seg); g.rotateZ(Math.PI / 2); g.translate(x, r, z); return clean(g);
}
function clean(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') n.deleteAttribute(k);
  n.clearGroups();
  if (!n.attributes.normal) n.computeVertexNormals();
  return n;
}

interface Car { L: number; W: number; H: number; belt: number; hood: number; trunk: number; ws: number; rw: number; r: number; front: number; rear: number }
/** a car: lower body to the belt line, the greenhouse in glass with a painted roof, four wheels, lights */
function car(c: Car): Map<Role, THREE.BufferGeometry[]> {
  const { L, W, H, belt, hood, trunk, ws, rw, r } = c, cl = r * 0.55, f = L / 2, b = -L / 2;
  // (the body's lower edge rises over each wheel in an arch, so the wheels show from the side)
  const arch = (zw: number, rr: number): number[][] => { const R = rr + 0.05, out: number[][] = [[zw - R, cl]]; for (let k = 0; k <= 6; k++) { const t = Math.PI - (k / 6) * Math.PI; out.push([zw + R * Math.cos(t), rr + R * Math.sin(t)]); } out.push([zw + R, cl]); return out; };
  const P = new Map<Role, THREE.BufferGeometry[]>();
  const put = (k: Role, g: THREE.BufferGeometry) => { const a = P.get(k) ?? []; a.push(g); P.set(k, a); };
  // (the body: the bumpers rounded off, the bonnet falling to the nose, the boot to the tail)
  const zf = f - c.front, zr = b + c.rear;
  put('paint', side([[b + 0.12, cl], ...arch(zr, r), ...arch(zf, r), [f - 0.15, cl], [f, cl + 0.18], [f, belt - 0.16], [f - 0.25, belt - 0.04], [f - hood, belt + 0.03], [b + trunk, belt + 0.03], [b + 0.08, belt - 0.03], [b, belt - 0.2], [b, cl + 0.16]], W, 0.06));
  // (the greenhouse, narrower than the body; its roof painted)
  const g0 = f - hood, g1 = b + trunk, wc = W * 0.86;
  put('glass', side([[g0, belt], [g0 - ws, H - 0.04], [g1 + rw, H - 0.04], [g1, belt]], wc, 0.05));
  put('paint', side([[g0 - ws - 0.04, H - 0.07], [g1 + rw + 0.04, H - 0.07], [g1 + rw + 0.08, H], [g0 - ws - 0.08, H]], wc - 0.04, 0.03));
  // (the B pillar between the doors)
  const mid = (g0 - ws + g1 + rw) / 2 + 0.1;
  put('paint', box(wc + 0.02, H - belt - 0.06, 0.1, 0, (belt + H) / 2, mid));
  // (wheels and rims, a dark sill between them)
  const wx = W / 2 - 0.12;
  for (const z of [zf, zr]) for (const s of [-1, 1]) { put('trim', wheel(s * wx, z, r, 0.22)); put('rim', wheel(s * (wx + 0.012), z, r * 0.58, 0.215, 8)); }
  put('trim', box(W + 0.01, 0.12, L * 0.5, 0, cl + 0.06, (zf + zr) / 2));
  // (head and tail lights, number plates)
  for (const s of [-1, 1]) { put('light', box(0.34, 0.1, 0.06, s * (W / 2 - 0.26), belt - 0.22, f - 0.02)); put('tail', box(0.3, 0.12, 0.06, s * (W / 2 - 0.22), belt - 0.14, b + 0.03)); }
  put('trim', box(0.52, 0.13, 0.03, 0, cl + 0.3, f + 0.005)); put('trim', box(0.52, 0.13, 0.03, 0, cl + 0.42, b - 0.005));
  return P;
}

function auto(): Map<Role, THREE.BufferGeometry[]> {
  const P = new Map<Role, THREE.BufferGeometry[]>(), put = (k: Role, g: THREE.BufferGeometry) => { const a = P.get(k) ?? []; a.push(g); P.set(k, a); };
  const L = 2.65, W = 1.3, r = 0.2, f = L / 2, b = -L / 2;
  // (the tub: the narrow nose over the front wheel, the wide seat behind; the black canvas hood over it all)
  put('paint', side([[f - 0.05, 0.28], [f, 0.95], [f - 0.35, 1.0], [b + 0.05, 0.95], [b, 0.4], [b + 0.2, 0.28]], W, 0.05));
  put('glass', side([[f - 0.1, 1.0], [f - 0.35, 1.5], [f - 0.55, 1.5], [f - 0.4, 1.0]], W * 0.8, 0.03));
  put('canvas', side([[f - 0.45, 1.5], [f - 0.55, 1.72], [b + 0.1, 1.72], [b, 1.5], [b, 1.2], [b + 0.08, 1.0], [b + 0.6, 1.0], [b + 0.6, 1.45], [f - 0.45, 1.45]], W - 0.04, 0.05));
  put('paint', box(W - 0.1, 0.06, 1.9, 0, 1.75, -0.05));
  put('seat', box(W - 0.2, 0.25, 0.5, 0, 0.75, b + 0.45));
  put('trim', wheel(0, f - 0.25, r, 0.14)); put('rim', wheel(0.01, f - 0.25, r * 0.55, 0.142, 8));
  for (const s of [-1, 1]) { put('trim', wheel(s * (W / 2 - 0.08), b + 0.4, r, 0.14)); put('rim', wheel(s * (W / 2 - 0.07), b + 0.4, r * 0.55, 0.142, 8)); }
  put('light', box(0.2, 0.14, 0.06, 0, 0.8, f + 0.02));
  for (const s of [-1, 1]) put('tail', box(0.14, 0.1, 0.05, s * (W / 2 - 0.15), 0.6, b - 0.01));
  return P;
}

function twoWheeler(scooter: boolean): Map<Role, THREE.BufferGeometry[]> {
  const P = new Map<Role, THREE.BufferGeometry[]>(), put = (k: Role, g: THREE.BufferGeometry) => { const a = P.get(k) ?? []; a.push(g); P.set(k, a); };
  const r = scooter ? 0.24 : 0.31, zf = scooter ? 0.62 : 0.68, zr = scooter ? -0.6 : -0.66;
  for (const z of [zf, zr]) { put('trim', wheel(0, z, r, scooter ? 0.11 : 0.1, 12)); put('rim', wheel(0, z, r * 0.6, scooter ? 0.112 : 0.102, 8)); }
  if (scooter) {
    // (the apron at the front, the floorboard, the body under the seat)
    put('paint', side([[zf - 0.05, 0.35], [zf + 0.02, 1.0], [zf - 0.12, 1.05], [zf - 0.25, 0.4]], 0.4, 0.04));
    put('paint', side([[zf - 0.25, 0.26], [zr + 0.42, 0.26], [zr + 0.42, 0.36], [zf - 0.25, 0.36]], 0.36, 0.03));
    put('paint', side([[zr + 0.45, 0.3], [zr + 0.45, 0.72], [zr - 0.08, 0.74], [zr - 0.12, 0.45], [zr + 0.1, 0.3]], 0.4, 0.05));
    put('seat', side([[zr + 0.42, 0.72], [zr + 0.4, 0.8], [zr - 0.04, 0.82], [zr - 0.08, 0.74]], 0.3, 0.03));
    put('trim', box(0.62, 0.04, 0.05, 0, 1.06, zf - 0.08));
    put('light', box(0.14, 0.1, 0.05, 0, 0.92, zf + 0.04));
  } else {
    // (the tank and seat over the frame, the engine below, the fork and bars)
    put('paint', side([[0.42, 0.78], [0.38, 0.95], [0.02, 0.98], [-0.08, 0.86]], 0.3, 0.05));
    put('seat', side([[-0.06, 0.84], [-0.1, 0.9], [-0.62, 0.86], [-0.66, 0.8]], 0.26, 0.03));
    put('trim', side([[0.32, 0.32], [0.3, 0.68], [-0.2, 0.7], [-0.22, 0.34]], 0.26, 0.03));
    put('trim', side([[zf - 0.02, r], [zf + 0.03, r + 0.06], [0.5, 1.0], [0.44, 0.98]], 0.12, 0));
    put('trim', box(0.68, 0.04, 0.04, 0, 1.08, 0.48));
    put('light', box(0.16, 0.14, 0.08, 0, 0.98, 0.58));
    put('trim', side([[-0.3, 0.5], [-0.72, 0.62], [-0.72, 0.56], [-0.3, 0.44]], 0.1, 0));
  }
  put('tail', box(0.12, 0.06, 0.04, 0, scooter ? 0.72 : 0.84, zr - (scooter ? 0.14 : 0.08)));
  return P;
}

function truck(): Map<Role, THREE.BufferGeometry[]> {
  const P = new Map<Role, THREE.BufferGeometry[]>(), put = (k: Role, g: THREE.BufferGeometry) => { const a = P.get(k) ?? []; a.push(g); P.set(k, a); };
  const L = 6.0, W = 2.05, r = 0.42, f = L / 2, b = -L / 2;
  // (the cab: flat-fronted, its screen raked a little; the chassis; an open wooden bed behind)
  put('paint', side([[f, 0.5], [f, 1.55], [f - 0.12, 1.6], [f - 0.32, 2.45], [f - 1.75, 2.5], [f - 1.75, 0.5]], W, 0.07));
  put('glass', side([[f - 0.04, 1.62], [f - 0.27, 2.36], [f - 1.0, 2.38], [f - 1.0, 1.62]], W + 0.02, 0.02));
  put('trim', box(W - 0.3, 0.22, L - 0.3, 0, 0.62, -0.1));
  put('bed', box(W, 0.12, 3.9, 0, 0.9, b + 2.0));
  for (const s of [-1, 1]) put('bed', box(0.08, 0.7, 3.9, s * (W / 2 - 0.04), 1.31, b + 2.0));
  put('bed', box(W, 0.7, 0.08, 0, 1.31, b + 0.04)); put('bed', box(W, 0.9, 0.08, 0, 1.41, f - 1.82));
  for (const z of [f - 0.95, b + 1.2]) for (const s of [-1, 1]) { put('trim', wheel(s * (W / 2 - 0.2), z, r, 0.3)); put('rim', wheel(s * (W / 2 - 0.19), z, r * 0.55, 0.302, 8)); }
  for (const s of [-1, 1]) { put('light', box(0.3, 0.16, 0.05, s * (W / 2 - 0.3), 0.95, f + 0.01)); put('tail', box(0.18, 0.12, 0.05, s * (W / 2 - 0.15), 0.8, b - 0.01)); }
  put('trim', box(W - 0.1, 0.2, 0.12, 0, 0.55, f + 0.02));
  return P;
}

const CARS: Record<'hatchback' | 'sedan' | 'suv' | 'van', Car> = {
  hatchback: { L: 3.8, W: 1.68, H: 1.52, belt: 0.95, hood: 0.85, trunk: 0.1, ws: 0.62, rw: 0.3, r: 0.29, front: 0.72, rear: 0.62 },
  sedan: { L: 4.45, W: 1.73, H: 1.48, belt: 0.92, hood: 1.15, trunk: 0.72, ws: 0.72, rw: 0.5, r: 0.31, front: 0.88, rear: 0.86 },
  suv: { L: 4.45, W: 1.82, H: 1.76, belt: 1.12, hood: 1.0, trunk: 0.06, ws: 0.52, rw: 0.14, r: 0.36, front: 0.82, rear: 0.78 },
  van: { L: 4.3, W: 1.7, H: 1.95, belt: 1.0, hood: 0.45, trunk: 0.04, ws: 0.55, rw: 0.06, r: 0.3, front: 0.6, rear: 0.7 },
};

const built = new Map<VehicleKind, VehiclePart[]>();
/** a vehicle kind's parts, one geometry per material role, at real size, standing on y = 0, facing +z */
export function vehicleParts(kind: VehicleKind): VehiclePart[] {
  const hit = built.get(kind); if (hit) return hit;
  const P = kind === 'auto' ? auto() : kind === 'motorcycle' ? twoWheeler(false) : kind === 'scooter' ? twoWheeler(true) : kind === 'truck' ? truck() : car(CARS[kind]);
  const out: VehiclePart[] = [];
  for (const [role, gs] of P) { const g = mergeGeometries(gs); gs.forEach((x) => x.dispose()); if (!g) continue; g.computeBoundingSphere(); g.userData.keep = true; out.push({ role, geometry: g }); }
  built.set(kind, out);
  return out;
}

// ---------------------------------------------------------------- materials, placing
const mats = new Map<string, THREE.MeshStandardMaterial>();
const matOf = (role: Role | 'cloth' | 'skin'): THREE.MeshStandardMaterial => {
  const hit = mats.get(role); if (hit) return hit;
  const o: THREE.MeshStandardMaterialParameters =
    role === 'paint' ? { color: '#ffffff', roughness: 0.32, metalness: 0.45 }
    : role === 'glass' ? { color: '#18202a', roughness: 0.06, metalness: 0.4 }
    : role === 'trim' ? { color: '#1c1d1f', roughness: 0.75 }
    : role === 'rim' ? { color: '#a9adb2', roughness: 0.35, metalness: 0.8 }
    : role === 'light' ? { color: '#f2efe4', roughness: 0.2, emissive: '#3a3830' }
    : role === 'tail' ? { color: '#8f1414', roughness: 0.3, emissive: '#2a0505' }
    : role === 'canvas' ? { color: '#1e1f20', roughness: 0.92 }
    : role === 'bed' ? { color: '#7a5636', roughness: 0.85 }
    : role === 'seat' ? { color: '#26211d', roughness: 0.7 }
    : { color: '#ffffff', roughness: role === 'skin' ? 0.7 : 0.9 };
  const m = new THREE.MeshStandardMaterial(o); m.userData.keep = true; mats.set(role, m); return m;
};

const dummy = new THREE.Object3D(), col = new THREE.Color();
/** vehicles of one kind at (x, z, heading): a mesh per part, the paint coloured per vehicle */
export function vehicleMeshes(kind: VehicleKind, at: [number, number, number][]): THREE.InstancedMesh[] {
  if (!at.length) return [];
  const palette = paintOf(kind);
  return vehicleParts(kind).map((p) => {
    const im = new THREE.InstancedMesh(p.geometry, matOf(p.role), at.length);
    at.forEach(([x, z, a], i) => {
      dummy.position.set(x, 0, z); dummy.rotation.set(0, a, 0); dummy.scale.setScalar(1); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
      if (p.role === 'paint') { col.set(pick(palette, hash(x, z, 2))); im.setColorAt(i, col); }
    });
    im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere();
    return im;
  });
}

/** a parking slot's kind: mostly cars (hatchbacks and SUVs first), some two-wheelers; on a road, autos and trucks too */
export function kindAt(x: number, z: number, onRoad: boolean): VehicleKind {
  const t = hash(x, z, 11);
  const mix: [VehicleKind, number][] = onRoad
    ? [['hatchback', 26], ['sedan', 14], ['suv', 20], ['van', 4], ['auto', 16], ['motorcycle', 9], ['scooter', 5], ['truck', 6]]
    : [['hatchback', 32], ['sedan', 18], ['suv', 28], ['van', 5]];
  const tot = mix.reduce((s, [, w]) => s + w, 0); let a = t * tot;
  for (const [k, w] of mix) { a -= w; if (a <= 0) return k; }
  return 'hatchback';
}

// ---------------------------------------------------------------- people
const CLOTH = ['#2f3f57', '#f0ece2', '#8a3b3b', '#d9c7a8', '#3f5d46', '#c6a35a', '#5a4e7a', '#b56a2f', '#e5dfd2', '#2b2c30'];
const LEGS = ['#2a3242', '#1f2022', '#5c5348', '#c9bfa9', '#3d4b5f'];
const SKIN = ['#8d5a3b', '#a8714c', '#6f4630', '#b9835a', '#7d4f34'];
let person: { role: 'cloth' | 'legs' | 'skin' | 'trim'; geometry: THREE.BufferGeometry }[] | null = null;
function personParts() {
  if (person) return person;
  const leg = (s: number) => { const g = new THREE.CylinderGeometry(0.075, 0.06, 0.82, 6); g.translate(s * 0.09, 0.47, 0); return clean(g); };
  const torso = new THREE.CylinderGeometry(0.2, 0.16, 0.6, 7); torso.scale(1, 1, 0.62); torso.translate(0, 1.16, 0);
  const arm = (s: number) => { const g = new THREE.CylinderGeometry(0.05, 0.045, 0.6, 5); g.rotateZ(s * 0.1); g.translate(s * 0.25, 1.12, 0); return clean(g); };
  const head = new THREE.IcosahedronGeometry(0.11, 1); head.scale(0.9, 1.08, 0.95); head.translate(0, 1.6, 0);
  const neck = new THREE.CylinderGeometry(0.045, 0.05, 0.1, 6); neck.translate(0, 1.48, 0);
  const hand = (s: number) => { const g = new THREE.IcosahedronGeometry(0.05, 0); g.translate(s * 0.28, 0.8, 0); return clean(g); };
  const shoe = (s: number) => box(0.1, 0.07, 0.22, s * 0.09, 0.035, 0.04);
  const m = (gs: THREE.BufferGeometry[]) => { const g = mergeGeometries(gs)!; g.computeBoundingSphere(); g.userData.keep = true; return g; };
  person = [
    { role: 'legs', geometry: m([leg(-1), leg(1)]) },
    { role: 'cloth', geometry: m([clean(torso), arm(-1), arm(1)]) },
    { role: 'skin', geometry: m([clean(head), clean(neck), hand(-1), hand(1)]) },
    { role: 'trim', geometry: m([shoe(-1), shoe(1)]) },
  ];
  return person;
}
/** people standing at (x, z), each turned their own way, in their own clothes */
export function peopleMeshes(at: [number, number][]): THREE.InstancedMesh[] {
  if (!at.length) return [];
  return personParts().map((p) => {
    const im = new THREE.InstancedMesh(p.geometry, matOf(p.role === 'legs' ? 'cloth' : p.role === 'trim' ? 'trim' : p.role), at.length);
    at.forEach(([x, z], i) => {
      const s = 0.9 + hash(x, z, 3) * 0.18;
      dummy.position.set(x, 0, z); dummy.rotation.set(0, hash(z, x, 4) * Math.PI * 2, 0); dummy.scale.set(s, s, s); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix);
      const list = p.role === 'cloth' ? CLOTH : p.role === 'legs' ? LEGS : p.role === 'skin' ? SKIN : null;
      if (list) { col.set(list[Math.floor(hash(x, z, p.role === 'cloth' ? 5 : p.role === 'legs' ? 6 : 7) * list.length) % list.length]); im.setColorAt(i, col); }
    });
    im.castShadow = true; im.receiveShadow = true; im.computeBoundingSphere();
    return im;
  });
}
