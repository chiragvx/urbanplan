// Site Studio's planting, modelled closer than the city's trees: a rain tree's wide umbrella on a forked trunk, a
// round-headed tree, a coconut palm with drooping fronds, the tall narrow ashoka that lines compound walls, and
// shrubs. Each is one geometry at a canopy radius of 1 m (scaled per plant), trunks painted bark, leaves white so
// the instance colour tints them.
import * as THREE from 'three/webgpu';

const BARK = 0x6b5440, PALM_BARK = 0x8a7660;

function paint(g: THREE.BufferGeometry, hex: number) {
  const c = new THREE.Color(hex), n = g.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
/** leaves: a lumpy ball, its vertices pushed in and out a little so no two read the same */
function blob(x: number, y: number, z: number, r: number, sy: number, detail: number, seed: number, shade = 0xffffff) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const vx = p.getX(i), vy = p.getY(i), vz = p.getZ(i);
    const k = 1 + 0.16 * Math.sin(vx * 7.1 + seed) * Math.cos(vz * 6.3 + seed * 1.7) + 0.08 * Math.sin(vy * 9.7 + seed * 2.3);
    p.setXYZ(i, vx * k, vy * k * sy, vz * k);
  }
  g.translate(x, y, z);
  return paint(g.index ? g.toNonIndexed() : g, shade);
}
function trunk(x0: number, z0: number, y0: number, x1: number, z1: number, y1: number, r0: number, r1: number, sides: number, hex: number) {
  const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  const g = new THREE.CylinderGeometry(r1, r0, len, sides, 1, true);
  g.translate(0, len / 2, 0);
  const dir = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0).normalize();
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  g.translate(x0, y0, z0);
  return paint(g.index ? g.toNonIndexed() : g, hex);
}
function merge(parts: THREE.BufferGeometry[]) {
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) { pos.set(p.attributes.position.array as Float32Array, o * 3); col.set(p.attributes.color.array as Float32Array, o * 3); o += p.attributes.position.count; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** a rain tree: a short trunk forking into limbs under a broad, flat-topped canopy */
function rainTree(d: number) {
  const P = [trunk(0, 0, -0.1, 0.02, 0, 0.55, 0.11, 0.08, 7, BARK)];
  for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + 0.4; P.push(trunk(0.02, 0, 0.5, Math.cos(a) * 0.45, Math.sin(a) * 0.45, 1.05, 0.06, 0.035, 5, BARK)); }
  const S: [number, number, number, number][] = [[0, 1.3, 0, 0.62], [0.5, 1.18, 0.15, 0.48], [-0.48, 1.2, -0.12, 0.5], [0.12, 1.2, 0.52, 0.46], [-0.15, 1.18, -0.52, 0.47], [0.36, 1.25, -0.38, 0.4], [-0.38, 1.24, 0.36, 0.42]];
  S.forEach(([x, y, z, r], i) => P.push(blob(x, y, z, r, 0.55, d, i * 3.1, i % 2 ? 0xf2f2f2 : 0xffffff)));
  return merge(P);
}
/** a round-headed tree (neem, mango): a clear trunk and a dense round crown */
function roundTree(d: number) {
  const P = [trunk(0, 0, -0.1, 0, 0.05, 1.0, 0.12, 0.09, 7, BARK)];
  const S: [number, number, number, number][] = [[0, 1.75, 0, 0.78], [0.42, 1.5, 0.12, 0.55], [-0.4, 1.55, -0.15, 0.56], [0.1, 1.55, 0.45, 0.52], [-0.12, 1.5, -0.45, 0.52], [0.05, 2.15, 0.02, 0.5]];
  S.forEach(([x, y, z, r], i) => P.push(blob(x, y, z, r, 0.92, d, i * 2.3 + 1, i % 2 ? 0xf0f0f0 : 0xffffff)));
  return merge(P);
}
/** a coconut palm: a tall, slightly leaning ringed trunk and drooping fronds */
function palm(d: number) {
  const P: THREE.BufferGeometry[] = [];
  const H = 4.4, segs = d ? 6 : 3;
  let px = 0, py = -0.1;
  for (let i = 0; i < segs; i++) {
    const t = (i + 1) / segs, x = 0.25 * t * t, y = H * t - 0.1;
    P.push(trunk(px, 0, py, x, 0, y, 0.13 - 0.04 * (i / segs), 0.13 - 0.04 * t, d ? 7 : 5, PALM_BARK));
    px = x; py = y;
  }
  const n = d ? 11 : 7;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + (k % 2) * 0.2, L = 1.15, steps = d ? 5 : 3;
    const pos: number[] = [];
    // a frond: a narrow blade arching out and down, both faces
    for (let s = 0; s < steps; s++) {
      const t0 = s / steps, t1 = (s + 1) / steps;
      const at = (t: number, side: number): number[] => {
        const r = L * t, droop = 0.5 * t * t - 0.18 * t, w = 0.22 * Math.sin(Math.PI * Math.min(1, t * 1.1)) * side;
        return [px + Math.cos(a) * r - Math.sin(a) * w, py + 0.05 - droop, Math.sin(a) * r + Math.cos(a) * w];
      };
      const A = at(t0, -1), B = at(t1, -1), C = at(t1, 1), D = at(t0, 1);
      pos.push(...A, ...B, ...C, ...A, ...C, ...D, ...A, ...C, ...B, ...A, ...D, ...C);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    P.push(paint(g, 0xffffff));
  }
  P.push(blob(px, py - 0.05, 0, 0.16, 1, 0, 5, 0xc9b26a));
  return merge(P);
}
/** an ashoka (Polyalthia): tall, narrow, its drooping leaves in tiers to the ground */
function ashoka(d: number) {
  const P = [trunk(0, 0, -0.1, 0, 0, 7.6, 0.1, 0.04, 5, BARK)];
  const tiers = d ? 7 : 4;
  for (let i = 0; i < tiers; i++) {
    const t = i / (tiers - 1), y = 0.6 + t * 6.6, r = 1.05 - 0.75 * t;
    const g = new THREE.ConeGeometry(r, 7.2 / tiers + 0.5, d ? 9 : 6, 1, true);
    g.translate(0, y + 7.2 / tiers / 2, 0);
    P.push(paint(g.index ? g.toNonIndexed() : g, i % 2 ? 0xf2f2f2 : 0xffffff));
  }
  P.push(blob(0, 7.7, 0, 0.32, 1.6, 0, 1));
  return merge(P);
}
/** a shrub: a few lumps */
function shrub(d: number) {
  return merge([blob(0, 0.45, 0, 0.75, 0.8, d, 1), blob(0.35, 0.35, 0.2, 0.5, 0.8, d, 2, 0xf0f0f0), blob(-0.3, 0.35, -0.2, 0.5, 0.8, d, 3)]);
}

/** the five kinds (Plant.kind) at a 1 m canopy radius, near (detailed) or far */
export function plantGeometries(near: boolean): THREE.BufferGeometry[] {
  const d = near ? 1 : 0;
  return [rainTree(d), roundTree(d), palm(d), ashoka(d), shrub(d)];
}

/** their leaf colours, picked from by each plant's tint */
export const PLANT_GREENS: number[][] = [
  [0x5b8a3c, 0x4f7f34, 0x679447, 0x557f38],
  [0x3f6d2c, 0x4a7a31, 0x36632a, 0x547f36],
  [0x6f9a45, 0x7aa24c, 0x65913f],
  [0x2f5a25, 0x376628, 0x2c5322],
  [0x4a7d33, 0x5a8c3a, 0x8a5a8a, 0xc0607a, 0xd9a43a, 0x4f8536],
];
