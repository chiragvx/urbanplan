// The Pro 3D view (three.js, WebGL): the plot and its roads, every building massed floor by floor in the design
// system's materials, its windows and doors at their catalog sizes (instanced: one mesh per type, however many
// thousands), balconies, bands and fins. "X-ray" cuts the building at a floor: the floors above go, and that floor
// shows its flats, walls, cores and entrance doors like a doll's house. Pointing at a window or a door reads out its
// tag and size.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { PlotReport } from '../doc/plot';
import { UNIT_COLOR, type SiteReport } from '../doc/site';
import type { DesignSystem } from './design';
import type { FloorPlan, Opening } from './openings';

import { SHOP_W, type Shops } from './mixed';
import { roadFrame } from '../doc/site';

export interface ViewData { r: PlotReport; d: SiteReport; plans: FloorPlan[]; ds: DesignSystem; xray: number | null; roads: { pts: [number, number, number, number]; today: number }[]; shops?: Shops | null }
export interface Picked { tag: string; label: string; size: string; floor: number; x: number; y: number }

const box = new THREE.BoxGeometry(1, 1, 1);
/** an X-ray floor's walls are cut this high, as a plan is */
const CUT = 1.5;
const dummy = new THREE.Object3D();

/** a prism over a ring (x,z,…) from y0 to y1, sides and top */
function prism(ring: number[], y0: number, y1: number, top = true): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < ring.length; i += 2) pts.push(new THREE.Vector2(ring[i], ring[i + 1]));
  const pos: number[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    pos.push(a.x, y0, a.y, b.x, y0, b.y, b.x, y1, b.y, a.x, y0, a.y, b.x, y1, b.y, a.x, y1, a.y);
  }
  if (top) {
    const tri = THREE.ShapeUtils.triangulateShape(pts, []);
    for (const [i, j, k] of tri) pos.push(pts[i].x, y1, pts[i].y, pts[k].x, y1, pts[k].y, pts[j].x, y1, pts[j].y);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
/** a flat shape on the ground (x,z,…) at height y */
function flat(ring: number[], y: number): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < ring.length; i += 2) pts.push(new THREE.Vector2(ring[i], ring[i + 1]));
  // (wound one way, so every face looks up)
  if (THREE.ShapeUtils.isClockWise(pts)) pts.reverse();
  const tri = THREE.ShapeUtils.triangulateShape(pts, []), pos: number[] = [];
  for (const [i, j, k] of tri) pos.push(pts[i].x, y, pts[i].y, pts[k].x, y, pts[k].y, pts[j].x, y, pts[j].y);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Instanced boxes: add() each, then mesh() builds it. */
class Boxes {
  m: THREE.Matrix4[] = []; meta: unknown[] = [];
  /** centred at x,y,z, `sx` along u (angle from x), `sy` up, `sz` across */
  add(x: number, y: number, z: number, ux: number, uz: number, sx: number, sy: number, sz: number, meta?: unknown) {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, -Math.atan2(uz, ux), 0);
    dummy.scale.set(Math.max(sx, 0.001), Math.max(sy, 0.001), Math.max(sz, 0.001));
    dummy.updateMatrix();
    this.m.push(dummy.matrix.clone()); this.meta.push(meta);
  }
  mesh(mat: THREE.Material, shadows = true): THREE.InstancedMesh | null {
    if (!this.m.length) return null;
    const im = new THREE.InstancedMesh(box, mat, this.m.length);
    this.m.forEach((m, i) => im.setMatrixAt(i, m));
    im.castShadow = shadows; im.receiveShadow = true;
    im.userData.meta = this.meta;
    return im;
  }
}

export class ProView {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, 0.5, 5000);
  controls: OrbitControls;
  root = new THREE.Group();
  sun = new THREE.DirectionalLight(0xffffff, 2.4);
  ray = new THREE.Raycaster();
  pickables: THREE.InstancedMesh[] = [];
  raf = 0;
  fitted = '';

  constructor(public canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.background = new THREE.Color('#dfe6ec');
    this.scene.fog = new THREE.Fog('#dfe6ec', 400, 1400);
    this.scene.add(new THREE.HemisphereLight('#f4f7fb', '#b9ae9a', 1.3));
    this.sun.position.set(-120, 180, -90);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target, this.root);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: '#e7e3da', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true;
    this.scene.add(ground);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03;
    this.controls.addEventListener('change', () => this.frame());
    this.resize();
  }

  resize() {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / Math.max(1, r.height);
    this.camera.updateProjectionMatrix();
    this.frame();
  }
  frame() { if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = 0; if (this.controls.update()) this.frame(); this.renderer.render(this.scene, this.camera); }); }
  dispose() { cancelAnimationFrame(this.raf); this.clear(); this.controls.dispose(); this.renderer.dispose(); }

  clear() {
    this.root.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry && m.geometry !== box) m.geometry.dispose(); });
    this.root.clear();
    this.pickables = [];
  }

  /** what's under the pointer: a window or a door */
  pick(px: number, py: number): Picked | null {
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1), this.camera);
    const hit = this.ray.intersectObjects(this.pickables, false)[0];
    if (!hit || hit.instanceId === undefined) return null;
    const m = (hit.object as THREE.InstancedMesh).userData.meta[hit.instanceId] as { o: Opening; floor: number; label: string } | undefined;
    if (!m) return null;
    const f = (v: number) => v.toFixed(2);
    return { tag: m.o.tag, label: m.label, size: `${f(m.o.w)} × ${f(m.o.h)} m${m.o.sill ? `, sill ${f(m.o.sill)} m` : ''}`, floor: m.floor, x: px - r.left, y: py - r.top };
  }

  set(v: ViewData) {
    this.clear();
    const { r, d, plans, ds } = v;
    const fh = r.rules.floorH, mat = (color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...o });
    const M = {
      wall: mat(ds.facade.wall), accent: mat(ds.facade.accent, { roughness: 0.6 }), base: mat(ds.facade.base),
      frame: mat(ds.glazing.frame, { roughness: 0.45, metalness: 0.3 }), glass: mat(ds.glazing.glass, { roughness: 0.08, metalness: 0.55, envMapIntensity: 1 }),
      rail: ds.balcony.railing === 'glass' ? mat('#cfe3ee', { transparent: true, opacity: 0.38, roughness: 0.05 }) : ds.balcony.railing === 'ms' ? mat('#2b2b2e', { roughness: 0.5, metalness: 0.5 }) : mat(ds.facade.wall),
      slab: mat('#d8d4cc'), road: mat('#5b5e66', { roughness: 0.95 }), dp: mat('#e5484d', { transparent: true, opacity: 0.28 }), paving: mat('#d3cfc5'),
      shop: mat('#efe2c8', { emissive: '#ffd9a0', emissiveIntensity: 0.25 }), sign: mat('#1d1f24', { roughness: 0.4 }),
      core: mat('#a7a39b'), door: mat('#8a5a3b', { roughness: 0.6 }), partition: mat('#f5f3ef'),
    };
    const add = (o: THREE.Object3D | null) => { if (o) this.root.add(o); return o; };
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, cast = true) => { const x = new THREE.Mesh(g, m); x.castShadow = cast; x.receiveShadow = true; return add(x) as THREE.Mesh; };

    // the roads, the DP's widening, the plot
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < r.net.length; i += 2) { minX = Math.min(minX, r.net[i]); maxX = Math.max(maxX, r.net[i]); minZ = Math.min(minZ, r.net[i + 1]); maxZ = Math.max(maxZ, r.net[i + 1]); }
    // each road as a strip along its centre line (run 60 m past the plot: the lines come 300 m past)
    for (const rd of v.roads) {
      const [x0, z0, x1, z1] = rd.pts, L = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / L, uz = (z1 - z0) / L, nx = -uz * rd.today / 2, nz = ux * rd.today / 2;
      const a = [x0 + ux * 240, z0 + uz * 240], b = [x1 - ux * 240, z1 - uz * 240];
      mesh(flat([a[0] + nx, a[1] + nz, b[0] + nx, b[1] + nz, b[0] - nx, b[1] - nz, a[0] - nx, a[1] - nz], 0.01), M.road, false);
    }
    for (const lr of r.lostRings) mesh(flat(lr, 0.03), M.dp, false);
    mesh(flat(r.net, 0.04), M.paving, false);
    if (r.footprint.length >= 6) {
      const p = r.footprint, pts: THREE.Vector3[] = [];
      for (let i = 0; i <= p.length; i += 2) pts.push(new THREE.Vector3(p[i % p.length], 0.08, p[(i + 1) % p.length]));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: '#2f5bff', dashSize: 1.2, gapSize: 0.8 }));
      line.computeLineDistances(); add(line);
    }

    const bands = new Boxes(), fins = new Boxes(), frames = new Boxes(), panes = new Boxes(), slabs = new Boxes(), rails = new Boxes(), cols = new Boxes(), parts = new Boxes(), doors = new Boxes(), parapets = new Boxes();
    const under = d.under, y0 = under * fh;
    // shops at the front: the road-facing edges of each strip, and which flats are shops on the floors above
    const F = roadFrame(r), signs = new Boxes();
    const shopFronts = (ring: number[]) => {
      const out: { x: number; z: number; ux: number; uz: number; nx: number; nz: number; L: number }[] = [];
      let sa = 0;
      for (let i = 0; i < ring.length; i += 2) { const j = (i + 2) % ring.length; sa += ring[i] * ring[j + 1] - ring[j] * ring[i + 1]; }
      for (let i = 0; i < ring.length; i += 2) {
        const j = (i + 2) % ring.length, L = Math.hypot(ring[j] - ring[i], ring[j + 1] - ring[i + 1]);
        if (L < 1) continue;
        const ux = (ring[j] - ring[i]) / L, uz = (ring[j + 1] - ring[i + 1]) / L, sg = sa > 0 ? 1 : -1, nx = uz * sg, nz = -ux * sg;
        // facing the road (against v), or a side face
        if (nx * -F.vx + nz * -F.vz > 0.5 || Math.abs(nx * F.ux + nz * F.uz) > 0.9) out.push({ x: (ring[i] + ring[j]) / 2, z: (ring[i + 1] + ring[j + 1]) / 2, ux, uz, nx, nz, L });
      }
      return out;
    };
    const glazeRun = (e: { x: number; z: number; ux: number; uz: number; nx: number; nz: number; L: number }, yb: number, h: number, sign: boolean) => {
      const n = Math.max(1, Math.round(e.L / SHOP_W)), w = e.L / n;
      for (let k = 0; k < n; k++) {
        const t = -e.L / 2 + w * (k + 0.5), cx = e.x + e.ux * t + e.nx * 0.05, cz = e.z + e.uz * t + e.nz * 0.05;
        const gh = sign ? h - 0.9 : h - 0.5;
        frames.add(cx, yb + 0.05 + gh / 2, cz, e.ux, e.uz, w - 0.3, gh + 0.1, 0.1);
        panes.add(cx + e.nx * 0.04, yb + 0.05 + gh / 2, cz + e.nz * 0.04, e.ux, e.uz, w - 0.42, gh - 0.04, 0.04);
        if (sign) signs.add(cx + e.nx * 0.12, yb + h - 0.45, cz + e.nz * 0.12, e.ux, e.uz, w - 0.5, 0.6, 0.12);
      }
      for (let k = 0; k <= n; k++) { const t = -e.L / 2 + w * k; cols.add(e.x + e.ux * t + e.nx * 0.1, yb + h / 2, e.z + e.uz * t + e.nz * 0.1, e.ux, e.uz, 0.3, h, 0.3); }
    };
    if (v.shops && under) for (const st of v.shops.strips) {
      mesh(prism(st.ring, 0, y0 - 0.02), M.shop);
      for (const e of shopFronts(st.ring)) {
        glazeRun(e, 0, y0, true);
        // a canopy over the shopfronts facing the road
        if (e.nx * -F.vx + e.nz * -F.vz > 0.5) slabs.add(e.x + e.nx * 0.9, y0 - 0.1, e.z + e.nz * 0.9, e.ux, e.uz, e.L, 0.14, 1.8);
      }
    }
    d.buildings.forEach((b, bi) => {
      const plan = plans[bi];
      const all = b.floors, show = v.xray === null ? all : Math.min(all, Math.max(1, v.xray));
      const top = y0 + (v.xray === null ? all : show - 1) * fh;
      // stilt / podium: columns round the edge, the cores carried down
      for (const q of b.quads) {
        if (under) for (let i = 0; i < q.length; i += 2) {
          const j = (i + 2) % q.length, L = Math.hypot(q[j] - q[i], q[j + 1] - q[i + 1]), n = Math.max(1, Math.round(L / 6));
          for (let k = 0; k < n; k++) cols.add(q[i] + ((q[j] - q[i]) * k) / n, y0 / 2, q[i + 1] + ((q[j + 1] - q[i + 1]) * k) / n, 1, 0, 0.5, y0, 0.5);
        }
        if (top > y0) mesh(prism(q, y0, top), M.wall);
      }
      for (const c of b.cores) mesh(prism(c, 0, (v.xray === null ? y0 + all * fh + 2.4 : top + fh)), M.core);
      // floors: bands on the slab edges, the openings
      const floorsShown = v.xray === null ? all : show;
      for (let f = 0; f < floorsShown; f++) {
        const fy = y0 + f * fh;
        if (ds.facade.bands) for (const q of b.quads) for (let i = 0; i < q.length; i += 2) {
          const j = (i + 2) % q.length, L = Math.hypot(q[j] - q[i], q[j + 1] - q[i + 1]);
          if (L < 0.5) continue;
          const ux = (q[j] - q[i]) / L, uz = (q[j + 1] - q[i + 1]) / L;
          bands.add((q[i] + q[j]) / 2, fy, (q[i + 1] + q[j + 1]) / 2, ux, uz, L + 0.24, 0.22, 0.24);
        }
        const cut = v.xray !== null && f === show - 1;
        const shopHere = !!v.shops && f < v.shops.upperOf[bi], gone = shopHere ? v.shops!.removed.get(bi) : undefined;
        if (shopHere && !cut) for (const st of v.shops!.strips) if (st.b === bi) for (const e of shopFronts(st.ring)) glazeRun(e, fy, fh, false);
        for (const o of plan.openings) {
          if (gone?.has(o.unit)) continue;
          if (!o.outside && !cut) continue;
          const s = o.tag === 'SD' || o.tag === 'D1' ? ds.doors[o.tag] : ds.windows[o.tag];
          const cy = fy + o.sill + o.h / 2, off = o.outside ? 0.07 : 0;
          const meta = { o, floor: f + 1, label: `${o.tag} · ${s.label}` };
          // (the cut floor is drawn as a plan: walls to 1.5 m, the glass only below that)
          if (cut && o.outside) { const t = Math.min(CUT, o.sill + o.h); if (t > o.sill + 0.05) panes.add(o.x, fy + (o.sill + t) / 2, o.z, o.ux, o.uz, o.w, t - o.sill, 0.04, meta); continue; }
          // (the leaf open into the flat, hinged at one jamb)
          if (o.tag === 'D1') { doors.add(o.x - o.ux * o.w / 2 - o.nx * o.w / 2, fy + Math.min(o.h, CUT + 0.3) / 2, o.z - o.uz * o.w / 2 - o.nz * o.w / 2, o.nx, o.nz, o.w, Math.min(o.h, CUT + 0.3), 0.05, meta); continue; }
          frames.add(o.x + o.nx * off, cy, o.z + o.nz * off, o.ux, o.uz, o.w + 0.12, o.h + 0.12, 0.1, meta);
          panes.add(o.x + o.nx * (off + 0.04), cy, o.z + o.nz * (off + 0.04), o.ux, o.uz, o.w - 0.06, o.h - 0.06, 0.04, meta);
          if (ds.facade.fins && (o.tag === 'W1' || o.tag === 'SD')) for (const sgn of [-1, 1]) {
            const fx = o.x + o.ux * sgn * (o.w / 2 + 0.25), fz = o.z + o.uz * sgn * (o.w / 2 + 0.25);
            fins.add(fx + o.nx * 0.3, fy + fh / 2, fz + o.nz * 0.3, o.nx, o.nz, 0.6, fh, 0.12);
          }
          if (o.tag === 'SD' && ds.balcony.kind !== 'none') {
            const dep = ds.balcony.kind === 'french' ? 0.3 : ds.balcony.depth, w = o.w + 0.9;
            const out = ds.balcony.kind === 'recessed' ? 0.12 : dep;
            if (ds.balcony.kind === 'cantilever') slabs.add(o.x + o.nx * dep / 2, fy - 0.08, o.z + o.nz * dep / 2, o.ux, o.uz, w, 0.16, dep);
            if (ds.balcony.kind === 'recessed') slabs.add(o.x + o.nx * 0.06, fy + fh - 0.25, o.z + o.nz * 0.06, o.ux, o.uz, w, 0.5, 0.12);
            rails.add(o.x + o.nx * out, fy + 0.55, o.z + o.nz * out, o.ux, o.uz, w, 1.1, 0.05);
            if (ds.balcony.kind === 'cantilever') for (const sgn of [-1, 1]) rails.add(o.x + o.ux * sgn * w / 2 + o.nx * dep / 2, fy + 0.55, o.z + o.uz * sgn * w / 2 + o.nz * dep / 2, o.nx, o.nz, dep, 1.1, 0.05);
          }
        }
      }
      if (v.xray === null) {
        // parapet round the roof, and a lift room and tank over each core
        const ry = y0 + all * fh;
        for (const q of b.quads) for (let i = 0; i < q.length; i += 2) {
          const j = (i + 2) % q.length, L = Math.hypot(q[j] - q[i], q[j + 1] - q[i + 1]);
          if (L < 0.5) continue;
          parapets.add((q[i] + q[j]) / 2, ry + 0.5, (q[i + 1] + q[j + 1]) / 2, (q[j] - q[i]) / L, (q[j + 1] - q[i + 1]) / L, L + 0.1, 1.0, 0.2);
        }
      } else {
        // the cut floor: its slab, the flats tinted by type, the walls (dolls'-house height), the entrance doors
        const fy = top;
        for (const q of b.quads) mesh(prism(q, fy - 0.15, fy + 0.02), M.slab);
        for (const u of b.units) { const g = flat(u.ring, fy + 0.05); mesh(g, mat(UNIT_COLOR[u.t], { transparent: true, opacity: 0.55 }), false); }
        const wh = CUT;
        for (const w of plan.walls) {
          const L = Math.hypot(w[2] - w[0], w[3] - w[1]);
          if (L < 0.05) continue;
          // the outside walls keep their openings: wall below the sill and above the head, solid between
          const ux = (w[2] - w[0]) / L, uz = (w[3] - w[1]) / L;
          const on = plan.openings.filter((o) => o.outside && Math.abs((o.x - w[0]) * uz - (o.z - w[1]) * ux) < 0.05 && ((o.x - w[0]) * ux + (o.z - w[1]) * uz) > 0 && ((o.x - w[0]) * ux + (o.z - w[1]) * uz) < L)
            .map((o) => ({ o, t: (o.x - w[0]) * ux + (o.z - w[1]) * uz })).sort((a, c) => a.t - c.t);
          let t0 = 0;
          const piece = (a: number, c: number, yb: number, yt: number) => { if (c - a > 0.02 && yt - yb > 0.02) parts.add(w[0] + ux * (a + c) / 2, fy + (yb + yt) / 2, w[1] + uz * (a + c) / 2, ux, uz, c - a, yt - yb, 0.2); };
          for (const { o, t } of on) {
            piece(t0, t - o.w / 2, 0, wh);
            piece(t - o.w / 2, t + o.w / 2, 0, o.sill);
            piece(t - o.w / 2, t + o.w / 2, Math.min(wh, o.sill + o.h), wh);
            t0 = t + o.w / 2;
          }
          piece(t0, L, 0, wh);
        }
      }
    });
    for (const [B, m, cast] of [[bands, M.accent, true], [fins, M.accent, true], [frames, M.frame, true], [panes, M.glass, false], [slabs, M.slab, true], [rails, M.rail, false], [cols, M.base, true], [parts, M.partition, true], [doors, M.door, true], [parapets, M.wall, true], [signs, M.sign, true]] as [Boxes, THREE.Material, boolean][]) {
      const im = B.mesh(m, cast);
      if (!im) continue;
      add(im);
      if (B === frames || B === panes || B === doors) this.pickables.push(im);
    }

    // frame the camera on the plot the first time (and when its size changes)
    const key = `${minX}|${maxX}|${minZ}|${maxZ}`;
    if (key !== this.fitted) {
      this.fitted = key;
      const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, s = Math.max(maxX - minX, maxZ - minZ, 30), h = d.height || 30;
      this.controls.target.set(cx, Math.min(h * 0.35, 30), cz);
      this.camera.position.set(cx - s * 1.1, Math.max(h * 1.1, s * 0.9), cz - s * 1.5);
      this.sun.target.position.set(cx, 0, cz);
      const sc = this.sun.shadow.camera as THREE.OrthographicCamera, R = s * 1.2 + h * 0.6;
      sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1; sc.far = 800; sc.updateProjectionMatrix();
      this.sun.position.set(cx - 120, 220, cz - 90);
    }
    this.frame();
  }
}
