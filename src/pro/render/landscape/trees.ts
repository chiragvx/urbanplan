// Trees grown in code: each species a recipe (./trees.ts SPECIES), grown into a branching wood (tapered limbs, barked)
// and a crown of leaf cards (alpha-cut sprays of leaves, lit as a volume: their normals point out of the crown). A few
// variants of each, picked per tree by a hash, so no two neighbours match; instanced, so a hundred trees cost a few
// draw calls. The species are the ones Indian sites plant: rain tree, a round-crowned shade tree (neem, karanj), the
// coconut palm, the mast-tree ashoka, and shrubs. Their index is the planting's kind (src/doc/ground.ts Plant).
//
// Modular by design: a species is one entry in SPECIES (its habit, sizes, branching and leaf), its leaf one entry in
// LEAVES. Geometry is normalised to a canopy radius of 1, so a tree is placed at its canopy radius.
import * as THREE from 'three';
import { rng } from './noise';

type Habit = 'branching' | 'columnar' | 'palm';
type LeafKind = 'pinnate' | 'broad' | 'drooping' | 'small' | 'frond';
export interface Species {
  label: string;
  habit: Habit;
  /** the clear trunk: height and radius (m) */
  trunk: { h: number; r: number; lean: number };
  /** branching: levels, children per limb, their spread off the parent (rad), how much they turn up, each level's
   *  length as a share of its parent's, the first limbs' length (m) */
  branch: { levels: number; children: number; spread: number; up: number; shrink: number; len: number };
  /** leaf cards: the spray's kind, a card's size (m), cards at each twig's tip and the cluster's radius (m) */
  leaf: { kind: LeafKind; size: number; perTip: number; cluster: number };
  bark: string;
  /** the greens a tree of it is, one picked per tree */
  greens: string[];
}

export const SPECIES: Species[] = [
  { label: 'Rain tree', habit: 'branching', trunk: { h: 2.6, r: 0.38, lean: 0.08 }, branch: { levels: 4, children: 3, spread: 0.95, up: 0.25, shrink: 0.72, len: 3.6 }, leaf: { kind: 'pinnate', size: 1.3, perTip: 8, cluster: 1.1 }, bark: '#5e5246', greens: ['#6f8e3e', '#7a9744', '#668540', '#86a44c'] },
  { label: 'Round shade tree (neem, karanj)', habit: 'branching', trunk: { h: 2.2, r: 0.3, lean: 0.05 }, branch: { levels: 4, children: 3, spread: 0.7, up: 0.6, shrink: 0.68, len: 2.6 }, leaf: { kind: 'broad', size: 1.0, perTip: 9, cluster: 0.95 }, bark: '#4f463d', greens: ['#5c7e38', '#678a3f', '#739647', '#557533'] },
  { label: 'Coconut palm', habit: 'palm', trunk: { h: 9, r: 0.17, lean: 0.12 }, branch: { levels: 0, children: 16, spread: 0, up: 0, shrink: 0, len: 4.2 }, leaf: { kind: 'frond', size: 1.1, perTip: 0, cluster: 0 }, bark: '#7a6d5e', greens: ['#7e9a44', '#8aa64c', '#74903e'] },
  { label: 'Ashoka (mast tree)', habit: 'columnar', trunk: { h: 10, r: 0.2, lean: 0.02 }, branch: { levels: 1, children: 26, spread: 0, up: -0.35, shrink: 0, len: 1.5 }, leaf: { kind: 'drooping', size: 0.9, perTip: 6, cluster: 0.55 }, bark: '#4a4038', greens: ['#446f2e', '#4c7a34', '#40682b'] },
  { label: 'Shrub', habit: 'branching', trunk: { h: 0.05, r: 0.04, lean: 0 }, branch: { levels: 2, children: 5, spread: 0.75, up: 0.7, shrink: 0.7, len: 0.55 }, leaf: { kind: 'small', size: 0.5, perTip: 9, cluster: 0.32 }, bark: '#5a4a3a', greens: ['#64873b', '#729543', '#80a24b', '#667c3e'] },
];
export const VARIANTS = 3;

// ---------------------------------------------------------------- textures (drawn once)

const texCache = new Map<string, THREE.Texture>();
function canvasTex(key: string, w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, srgb = true): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const hit = texCache.get(key); if (hit) return hit;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 4;
  texCache.set(key, t); return t;
}

/** a spray of leaves on a transparent card: light, shaded a little at the base, so the tree's green (instance colour)
 *  carries the hue */
function leafTexture(kind: LeafKind): THREE.Texture | null {
  return canvasTex(`leaf|${kind}`, 256, 256, (g) => {
    const R = rng(kind.length * 977 + 13);
    g.clearRect(0, 0, 256, 256);
    const leaf = (x: number, y: number, a: number, len: number, wid: number) => {
      const l = 175 + Math.floor(R() * 70);
      g.save(); g.translate(x, y); g.rotate(a);
      const grd = g.createLinearGradient(0, -wid, 0, wid); grd.addColorStop(0, `rgb(${l},${l},${l})`); grd.addColorStop(1, `rgb(${l - 50},${l - 45},${l - 50})`);
      g.fillStyle = grd; g.beginPath(); g.ellipse(len / 2, 0, len / 2, wid, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = `rgba(80,80,70,0.35)`; g.lineWidth = 0.8; g.beginPath(); g.moveTo(0, 0); g.lineTo(len, 0); g.stroke();
      g.restore();
    };
    const twig = (x0: number, y0: number, x1: number, y1: number, w: number) => { g.strokeStyle = 'rgb(95,80,62)'; g.lineWidth = w; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); };
    if (kind === 'frond') {
      // (a coconut frond's half-length: the rachis along the middle, leaflets either side swept toward the tip)
      twig(0, 128, 256, 128, 5);
      for (let x = 6; x < 250; x += 5) { const L = 118 * Math.sin(Math.PI * (0.15 + 0.85 * x / 256)) * (0.85 + 0.2 * R()); for (const s of [-1, 1]) { g.save(); g.translate(x, 128); g.rotate(s * (0.55 + 0.15 * R())); const l = 170 + Math.floor(R() * 70); g.fillStyle = `rgb(${l},${l},${l - 10})`; g.beginPath(); g.ellipse(L / 2, 0, L / 2, 2.6, 0, 0, Math.PI * 2); g.fill(); g.restore(); } }
      return;
    }
    if (kind === 'pinnate') {
      // (compound leaves: tiny leaflets in pairs along many short stalks)
      for (let k = 0; k < 12; k++) {
        const a = R() * Math.PI * 2, r0 = 10 + R() * 30, x0 = 128 + Math.cos(a) * r0, y0 = 128 + Math.sin(a) * r0, L = 50 + R() * 50;
        twig(128, 128, x0 + Math.cos(a) * L, y0 + Math.sin(a) * L, 1.2);
        for (let t = 0; t < L; t += 6) for (const s of [-1, 1]) leaf(x0 + Math.cos(a) * t, y0 + Math.sin(a) * t, a + s * 1.2, 11, 3.5);
      }
      return;
    }
    if (kind === 'drooping') {
      // (long narrow leaves with wavy edges hanging from a short twig)
      twig(128, 8, 128, 60, 2.5);
      for (let k = 0; k < 26; k++) leaf(108 + R() * 40, 20 + R() * 50, Math.PI / 2 + (R() - 0.5) * 0.7, 120 + R() * 60, 7 + R() * 3);
      return;
    }
    const n = kind === 'small' ? 70 : 40, Lm = kind === 'small' ? 26 : 44, W = kind === 'small' ? 8 : 14;
    for (let k = 0; k < 6; k++) { const a = R() * Math.PI * 2; twig(128, 128, 128 + Math.cos(a) * 90, 128 + Math.sin(a) * 90, 1.6); }
    for (let k = 0; k < n; k++) { const a = R() * Math.PI * 2, r = Math.sqrt(R()) * 95; leaf(128 + Math.cos(a) * r, 128 + Math.sin(a) * r, a + (R() - 0.5) * 1.2, Lm * (0.7 + 0.5 * R()), W * (0.7 + 0.5 * R())); }
  });
}

/** bark: vertical fissures, or a palm's rings */
function barkTexture(palm: boolean): THREE.Texture | null {
  const t = canvasTex(`bark|${palm}`, 128, 256, (g) => {
    const R = rng(palm ? 5 : 9);
    g.fillStyle = 'rgb(205,200,192)'; g.fillRect(0, 0, 128, 256);
    if (palm) {
      for (let y = 0; y < 256; y += 9 + Math.floor(R() * 5)) { g.fillStyle = `rgba(60,50,40,${0.35 + R() * 0.3})`; g.fillRect(0, y, 128, 2 + R() * 2); }
      for (let k = 0; k < 400; k++) { g.fillStyle = `rgba(${R() < 0.5 ? '255,255,255' : '40,35,30'},0.08)`; g.fillRect(R() * 128, R() * 256, 1 + R() * 3, 1 + R() * 2); }
    } else {
      for (let k = 0; k < 34; k++) { let x = R() * 128; g.strokeStyle = `rgba(45,38,32,${0.35 + R() * 0.4})`; g.lineWidth = 1 + R() * 2.5; g.beginPath(); g.moveTo(x, 0); for (let y = 0; y <= 256; y += 16) { x += (R() - 0.5) * 8; g.lineTo(x, y); } g.stroke(); }
      for (let k = 0; k < 500; k++) { g.fillStyle = `rgba(${R() < 0.5 ? '255,255,255' : '30,25,20'},0.07)`; g.fillRect(R() * 128, R() * 256, 1 + R() * 4, 1 + R() * 6); }
    }
  });
  if (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  return t;
}

// ---------------------------------------------------------------- growing

class Build {
  p: number[] = []; n: number[] = []; uv: number[] = []; c: number[] = []; idx: number[] = [];
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, col: [number, number, number]) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, v); this.c.push(col[0], col[1], col[2]); return this.p.length / 3 - 1;
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.idx); g.computeBoundingSphere(); g.userData.keep = true;
    return g;
  }
}

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const WHITE: [number, number, number] = [1, 1, 1];

/** a tapered limb from a to b, radii ra → rb, `sides` round; bark uv: around × metres up (tile 1.2 m) */
function limb(W: Build, a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, sides: number, tone: [number, number, number], v0: number) {
  const d = b.clone().sub(a), L = d.length(); if (L < 1e-4) return v0;
  const ax = d.normalize(), ref = Math.abs(ax.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0), e1 = ref.clone().cross(ax).normalize(), e2 = ax.clone().cross(e1);
  const base = W.p.length / 3;
  for (let k = 0; k <= sides; k++) {
    const t = (k / sides) * Math.PI * 2, nx = e1.x * Math.cos(t) + e2.x * Math.sin(t), ny = e1.y * Math.cos(t) + e2.y * Math.sin(t), nz = e1.z * Math.cos(t) + e2.z * Math.sin(t);
    W.vert(a.x + nx * ra, a.y + ny * ra, a.z + nz * ra, nx, ny, nz, k / sides, v0 / 1.2, tone);
    W.vert(b.x + nx * rb, b.y + ny * rb, b.z + nz * rb, nx, ny, nz, k / sides, (v0 + L) / 1.2, tone);
  }
  for (let k = 0; k < sides; k++) { const i = base + k * 2; W.idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3); }
  return v0 + L;
}

/** a leaf card at p facing `f`, turned `a` about it, size s; normals out of the crown from `mid` */
function card(W: Build, p: THREE.Vector3, f: THREE.Vector3, a: number, s: number, mid: THREE.Vector3, tone: [number, number, number], down = false) {
  const ref = Math.abs(f.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0), e1 = ref.clone().cross(f).normalize(), e2 = f.clone().cross(e1);
  const u = e1.clone().multiplyScalar(Math.cos(a)).add(e2.clone().multiplyScalar(Math.sin(a))).multiplyScalar(s / 2), w = f.clone().cross(u).normalize().multiplyScalar(s / 2);
  // (a drooping spray hangs from its top edge; others are centred on the point)
  const c0 = down ? p.clone().sub(V(0, s / 2, 0)) : p;
  const corners = [c0.clone().sub(u).sub(w), c0.clone().add(u).sub(w), c0.clone().add(u).add(w), c0.clone().sub(u).add(w)], uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
  const base = W.p.length / 3;
  corners.forEach((q, k) => { const nrm = q.clone().sub(mid).normalize().lerp(V(0, 1, 0), 0.25).normalize(); W.vert(q.x, q.y, q.z, nrm.x, nrm.y, nrm.z, uvs[k][0], uvs[k][1], tone); });
  W.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

/** a turned copy of `d`: off it by `spread` toward a random side, `up` added, normalised */
function bend(d: THREE.Vector3, spread: number, up: number, R: () => number) {
  const ref = Math.abs(d.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0), e1 = ref.clone().cross(d).normalize(), e2 = d.clone().cross(e1), t = R() * Math.PI * 2;
  const side = e1.multiplyScalar(Math.cos(t)).add(e2.multiplyScalar(Math.sin(t)));
  return d.clone().multiplyScalar(Math.cos(spread)).add(side.multiplyScalar(Math.sin(spread))).add(V(0, up, 0)).normalize();
}

export interface TreeGeo { wood: THREE.BufferGeometry; leaves: THREE.BufferGeometry }

/** a species' variant grown and normalised to a canopy radius of 1 */
export function growTree(kind: number, variant: number, detail: boolean): TreeGeo {
  const S = SPECIES[kind] ?? SPECIES[1], R = rng(kind * 7919 + variant * 104729 + 1), wood = new Build(), leaves = new Build();
  const sides = detail ? 7 : 5, tone = (k: number): [number, number, number] => { const v = 0.82 + 0.3 * R(); return [v * (1 + k * 0.06), v, v * (1 - k * 0.05)]; };
  const tips: { p: THREE.Vector3; d: THREE.Vector3 }[] = [];
  const top = V(Math.sin(R() * 6.28) * S.trunk.lean * S.trunk.h, S.trunk.h, Math.cos(R() * 6.28) * S.trunk.lean * S.trunk.h);

  if (S.habit === 'palm') {
    // (a curved trunk in a few pieces, then the fronds arching out and down from the crown)
    let prev = V(), v0 = 0; const segs = detail ? 8 : 5, bow = 0.6 + R() * 0.8, a = R() * Math.PI * 2;
    for (let k = 1; k <= segs; k++) { const t = k / segs, q = V(Math.cos(a) * bow * t * t, S.trunk.h * t, Math.sin(a) * bow * t * t); v0 = limb(wood, prev, q, S.trunk.r * (1.25 - 0.35 * (k - 1) / segs), S.trunk.r * (1.25 - 0.35 * k / segs), sides, WHITE, v0); prev = q; }
    const crown = prev, n = detail ? S.branch.children : 11, L = S.branch.len, wid = S.leaf.size;
    for (let f = 0; f < n; f++) {
      const az = (f / n) * Math.PI * 2 + R() * 0.3, rise = f % 3 === 0 ? 0.9 : f % 3 === 1 ? 0.35 : -0.1, dir = V(Math.cos(az), rise, Math.sin(az)).normalize(), side = V(-Math.sin(az), 0, Math.cos(az));
      const steps = detail ? 7 : 4, tn = tone(0); let p = crown.clone(), d = dir.clone();
      const base = leaves.p.length / 3;
      for (let s = 0; s <= steps; s++) {
        const t = s / steps, w = wid * Math.sin(Math.PI * (0.12 + 0.88 * t)) * 0.5 + 0.05, nrm = d.clone().cross(side).normalize(); if (nrm.y < 0) nrm.negate();
        for (const k of [-1, 1]) { const q = p.clone().add(side.clone().multiplyScalar(k * w)).add(V(0, -Math.abs(k) * w * 0.25, 0)); leaves.vert(q.x, q.y, q.z, nrm.x, nrm.y, nrm.z, t, k < 0 ? 0 : 1, tn); }
        p = p.add(d.clone().multiplyScalar(L / steps)); d = d.add(V(0, -0.32, 0)).normalize(); // (the frond's own weight)
      }
      for (let s = 0; s < steps; s++) { const i = base + s * 2; leaves.idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3); }
    }
    // (the nuts and the frond bases' knot)
    limb(wood, crown.clone().add(V(0, -0.5, 0)), crown.clone().add(V(0, 0.3, 0)), S.trunk.r * 1.6, S.trunk.r * 0.8, sides, [0.85, 0.75, 0.55], 0);
  } else {
    // (the trunk; then limbs, each splitting into `children` turned off it, to `levels`; leaves at the twigs' tips)
    let v0 = limb(wood, V(), top, S.trunk.r * 1.15, S.trunk.r, sides, WHITE, 0);
    if (S.habit === 'columnar') {
      // (a mast: the leader runs on up; short limbs all along it, longest low, hanging)
      const H = S.trunk.h, n = detail ? S.branch.children : 16;
      v0 = limb(wood, top, top.clone().add(V(0, 1.2, 0)), S.trunk.r, S.trunk.r * 0.3, sides, WHITE, v0);
      for (let k = 0; k < n; k++) {
        const t = (k + R() * 0.5) / n, y = 1.4 + t * (H - 1.2), len = S.branch.len * (1 - t * 0.8) * (0.8 + 0.4 * R()), az = k * 2.4 + R() * 0.4;
        const a = V(top.x * y / H, y, top.z * y / H), d = V(Math.cos(az), S.branch.up, Math.sin(az)).normalize(), b = a.clone().add(d.multiplyScalar(len));
        limb(wood, a, b, S.trunk.r * 0.25, 0.02, Math.max(3, sides - 3), WHITE, 0);
        tips.push({ p: b, d: d.clone().normalize() }); tips.push({ p: a.clone().lerp(b, 0.5), d: d.clone().normalize() });
      }
      tips.push({ p: top.clone().add(V(0, 1.4, 0)), d: V(0, 1, 0) });
    } else {
      const levels = detail ? S.branch.levels : Math.max(1, S.branch.levels - 1);
      const grow = (a: THREE.Vector3, d: THREE.Vector3, len: number, r: number, lv: number) => {
        const b = a.clone().add(d.clone().multiplyScalar(len));
        limb(wood, a, b, r, r * 0.62, Math.max(3, sides - lv), WHITE, 0);
        if (lv >= levels) { tips.push({ p: b, d }); return; }
        const kids = S.branch.children + (R() < 0.3 ? 1 : 0);
        for (let k = 0; k < kids; k++) grow(b, bend(d, S.branch.spread * (0.7 + 0.6 * R()), S.branch.up * (lv === 0 ? 1 : 0.5), R), len * S.branch.shrink * (0.8 + 0.4 * R()), r * 0.62, lv + 1);
      };
      // (the first limbs fan out round the trunk's top)
      const first = S.branch.children + 1;
      for (let k = 0; k < first; k++) { const az = (k / first) * Math.PI * 2 + R() * 0.5, d = V(Math.cos(az) * Math.sin(S.branch.spread), Math.cos(S.branch.spread) + S.branch.up, Math.sin(az) * Math.sin(S.branch.spread)).normalize(); grow(top, d, S.branch.len * (0.85 + 0.3 * R()), S.trunk.r * 0.7, 1); }
    }
    // (the crown: cards round each tip, facing every way)
    let mid = V(); for (const t of tips) mid.add(t.p); mid = mid.multiplyScalar(1 / Math.max(1, tips.length)); mid.y -= 0.3;
    // (far: a level fewer, so fewer and bigger cards fill the same crown)
    const per = detail ? S.leaf.perTip : Math.max(4, Math.round(S.leaf.perTip * 0.9)), sz = S.leaf.size * (detail ? 1 : 1.7);
    for (const t of tips) for (let k = 0; k < per; k++) {
      const off = V(R() - 0.5, (R() - 0.5) * 0.7, R() - 0.5).normalize().multiplyScalar(S.leaf.cluster * Math.sqrt(R())), p = t.p.clone().add(off);
      const f = V(R() - 0.5, R() * 0.8 + 0.2, R() - 0.5).normalize();
      card(leaves, p, f, R() * Math.PI, sz * (0.75 + 0.5 * R()), mid, tone(R() < 0.25 ? 1 : 0), S.leaf.kind === 'drooping');
    }
  }
  // (normalised: the crown's widest reach from the trunk's line is 1)
  let reach = 0.01; for (let i = 0; i < leaves.p.length; i += 3) reach = Math.max(reach, Math.hypot(leaves.p[i], leaves.p[i + 2]));
  const k = 1 / reach;
  for (const B of [wood, leaves]) for (let i = 0; i < B.p.length; i++) B.p[i] *= k;
  return { wood: wood.geometry(), leaves: leaves.geometry() };
}

// ---------------------------------------------------------------- materials and meshes

const geoCache = new Map<string, TreeGeo>();
const matCache = new Map<string, THREE.Material>();
const kept = <T extends THREE.Material>(key: string, make: () => T): T => { let m = matCache.get(key) as T | undefined; if (!m) { m = make(); matCache.set(key, m); } return m; };

function leafMaterial(kind: LeafKind) {
  return kept(`leaf|${kind}`, () => new THREE.MeshStandardMaterial({ map: leafTexture(kind), alphaTest: 0.45, side: THREE.DoubleSide, vertexColors: true, roughness: 0.78, metalness: 0 }));
}
function leafDepth(kind: LeafKind) {
  return kept(`leafd|${kind}`, () => new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leafTexture(kind), alphaTest: 0.45, side: THREE.DoubleSide }));
}
function barkMaterial(S: Species) {
  return kept(`bark|${S.bark}|${S.habit}`, () => { const t = barkTexture(S.habit === 'palm'); return new THREE.MeshStandardMaterial({ color: S.bark, map: t, roughness: 0.95, vertexColors: true }); });
}

export interface Placed { x: number; z: number; r: number; kind: number }
const hash = (x: number, z: number, k = 0) => { const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453; return s - Math.floor(s); };
const dummy = new THREE.Object3D();

/** the trees as instanced meshes: per species and variant a wood and a crown; each tree turned, sized to its canopy
 *  (± 15%) and given one of its species' greens */
export function treeMeshes(trees: Placed[], detail: boolean): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [], groups = new Map<string, Placed[]>();
  for (const t of trees) { const k = Math.min(SPECIES.length - 1, Math.max(0, t.kind)), v = Math.floor(hash(t.x, t.z, 7) * VARIANTS) % VARIANTS, key = `${k}|${v}`; const a = groups.get(key) ?? []; a.push({ ...t, kind: k }); groups.set(key, a); }
  const col = new THREE.Color();
  for (const [key, T] of groups) {
    const [k, v] = key.split('|').map(Number), S = SPECIES[k], gk = `${k}|${v}|${detail}`;
    const G = geoCache.get(gk) ?? growTree(k, v, detail); geoCache.set(gk, G);
    const wood = new THREE.InstancedMesh(G.wood, barkMaterial(S), T.length), crown = new THREE.InstancedMesh(G.leaves, leafMaterial(S.leaf.kind), T.length);
    crown.customDepthMaterial = leafDepth(S.leaf.kind);
    T.forEach((t, i) => {
      const h = hash(t.x, t.z), s = t.r * (0.85 + 0.3 * h);
      dummy.position.set(t.x, 0, t.z); dummy.rotation.set(0, h * Math.PI * 2, 0); dummy.scale.setScalar(s); dummy.updateMatrix();
      wood.setMatrixAt(i, dummy.matrix); crown.setMatrixAt(i, dummy.matrix);
      col.set(S.greens[Math.floor(hash(t.z, t.x, 1) * S.greens.length) % S.greens.length]); crown.setColorAt(i, col);
    });
    for (const m of [wood, crown]) { m.castShadow = true; m.receiveShadow = true; m.computeBoundingSphere(); out.push(m); }
  }
  return out;
}
