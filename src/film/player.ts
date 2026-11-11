// Film mode's player: plays a scene's timeline frame by frame on a fixed clock (frame index / fps — nothing reads
// the wall clock), renders the 3D view, draws the overlays over it in a 2D canvas, and (when capturing) sends each
// frame to the dev server (tools/film/vite-film.ts), which writes film/out/<scene>/<frame>.png.
import * as THREE from 'three/webgpu';
import type { App } from '../app/app';
import { treeGeometry } from '../build/vegetation';
import { Kit } from './kit';
import { BRAND, COBALT, GREEN, RED } from './brand';
import * as D from './draw';
import type { Key, Measured, Place, Scene, V2 } from './types';

const { fade, clamp01, ease } = D;

/** One edit of the fix (a step, or one tick of a step's tween). */
interface Edit { t: number; step: number; run: () => void; changed: boolean }

/** &profile: where a frame's time goes, totalled per stage (ms) and logged at the end */
const PROF: Record<string, number> | null = new URLSearchParams(location.search).has('profile') ? {} : null;
const lap = (k: string, t0: number) => { if (PROF) PROF[k] = (PROF[k] ?? 0) + performance.now() - t0; return performance.now(); };

export interface FilmOpts {
  /** send frames to the dev server */ capture: boolean;
  /** only these frames (all when null) */ frames: number[] | null;
  /** render scale over 1080 × 1920 (supersampling) */ ss: number;
}

export class Player {
  readonly fps: number;
  readonly count: number;
  readonly kit: Kit;
  readonly cv = document.createElement('canvas');
  readonly ctx: CanvasRenderingContext2D;
  private edits: Edit[] = [];
  private applied = 0;
  M!: { before: Measured; after: Measured; now: Measured };
  private props = new THREE.Group();
  private cars: { place: string; leave?: number; body: THREE.InstancedMesh; cab: THREE.InstancedMesh; jitter: number[] }[] = [];
  private trees: { step: number; mesh: THREE.InstancedMesh; list: { x: number; z: number; y: number; s: number; h: number; rot: number }[] }[] = [];
  private clock = 0;
  private uploads = new Set<Promise<void>>();
  /** GPU validation errors seen while rendering (should stay 0) */
  gpuErrors = 0;

  constructor(readonly app: App, readonly scene: Scene, readonly opts: FilmOpts) {
    this.fps = scene.fps ?? 30;
    this.count = Math.round(scene.duration * this.fps);
    this.kit = new Kit(app.doc, app.C, app.hf);
    this.cv.width = D.W; this.cv.height = D.H;
    this.ctx = this.cv.getContext('2d')!;
    this.ctx.imageSmoothingQuality = 'high';
  }

  // ---------------- setup ----------------

  /** Build the BEFORE map, measure it, run the whole fix once to measure the AFTER, and wind back. */
  async prepare() {
    const { app, scene, kit } = this, doc = app.doc;
    // three's node clock (sky clouds, water ripples) follows the film clock, not performance.now()
    const nf = (app.engine.renderer as unknown as { _nodes: { nodeFrame: { update(): void; time: number; deltaTime: number; frameId: number } } })._nodes.nodeFrame;
    const film = this;
    // GPU validation errors leave the canvas showing an old frame: count them, so a bad render can't pass unnoticed
    (app.engine.renderer.backend as unknown as { device?: GPUDevice }).device?.addEventListener('uncapturederror', () => this.gpuErrors++);
    nf.update = function () { this.frameId++; this.deltaTime = 1 / film.fps; this.time = film.clock; };
    // (a plot's 3D is built here, in step with the frames: the editor's own rebuild waits for an animation frame)
    (app.E as unknown as { rebuildPlots(): void }).rebuildPlots = () => {};
    doc.transact(`Film: ${scene.title} (before)`, () => scene.before(kit));
    this.sync();
    // trees again, now that the BEFORE roads are down (none standing in the new carriageways)
    (app.world as unknown as { buildTrees(): void }).buildTrees();
    const before = scene.measure(kit);
    scene.steps.forEach((st, i) => {
      const n = Math.max(1, st.count ? Math.round(before.values[st.count] ?? 1) : st.n ?? 1), dur = st.dur ?? 0;
      for (let k = 1; k <= n; k++) {
        const u = k / n;
        this.edits.push({ t: st.t + (n > 1 ? (dur * (k - 1)) / (n - 1) : 0), step: i, run: () => st.run(kit, u), changed: false });
      }
    });
    this.edits.sort((a, b) => a.t - b.t);
    for (const e of this.edits) {
      const v = doc.version;
      doc.transact(`Film: ${scene.steps[e.step].label}`, e.run);
      e.changed = doc.version !== v;
    }
    this.sync();
    const after = scene.measure(kit);
    for (let i = this.edits.length - 1; i >= 0; i--) if (this.edits[i].changed) doc.undo();
    this.sync();
    this.M = { before, after, now: before };
    this.buildTrees();
    this.buildCars();
    this.buildStack();
    app.engine.scene.add(this.props);
  }

  /** Terrain, buildings and trees caught up with the roads (the editor does this on a timer; here, now). */
  private sync() {
    this.app.world.sync();
    // the plot (Plot Twist): Site Studio's realistic model of the floors that are up, or nothing while it's vacant
    const pm = this.kit.plotModel();
    if (pm !== undefined) this.app.world.buildPlots(pm ? [pm] : [], 'real', pm?.o.id);
    this.app.world.needsRender = true;
  }

  /** Film props: trees a step plants, grown in over a second each (the editor has no tree objects to edit). */
  private buildTrees() {
    const geo = treeGeometry('high'), mat = this.app.world.M.trees;
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const GREENS = [0x4f7a32, 0x5d8a3a, 0x46702c, 0x6b9443, 0x587f30];
    this.scene.steps.forEach((st, i) => {
      const pts = st.trees ? this.M.after.places[st.trees]?.pts ?? [] : [];
      if (!pts.length) return;
      const mesh = new THREE.InstancedMesh(geo, mat, pts.length);
      mesh.castShadow = true; mesh.receiveShadow = true;
      const col = new THREE.Color();
      const list = pts.map(([x, z], k) => {
        col.setHex(GREENS[Math.floor(rnd() * GREENS.length)]); mesh.setColorAt(k, col);
        const s = 4.2 + rnd() * 1.6;
        return { x, z, y: this.app.hf.sampleSurface(x, z) + 0.1, s, h: s * (1.1 + rnd() * 0.3), rot: rnd() * Math.PI * 2 };
      });
      this.trees.push({ step: i, mesh, list });
      this.props.add(mesh);
    });
  }

  /**
   * Film props: parked cars, a body and a cabin each, heading along the line their points run, in assorted paints.
   * Cars that stay follow their strip from state to state (a kerb can move when the street is re-laid: a road's
   * centre line is its carriageway's); cars that leave go from where they stood today.
   */
  private buildCars() {
    let seed = 11;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const PAINTS = [0xf2f2f0, 0xc9ccd1, 0x8d9096, 0x2b2d31, 0xb3262b, 0x2a4f8f, 0xe6e1d3, 0x5b6770];
    const body = new THREE.BoxGeometry(1.8, 0.8, 4.3).translate(0, 0.62, 0), cab = new THREE.BoxGeometry(1.6, 0.62, 2.3).translate(0, 1.33, -0.2);
    const paint = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.25 }), glass = new THREE.MeshStandardMaterial({ color: 0x23272d, roughness: 0.18, metalness: 0.4 });
    for (const c of this.scene.cars ?? []) {
      const n = Math.max(this.M.before.places[c.place]?.pts?.length ?? 0, this.M.after.places[c.place]?.pts?.length ?? 0);
      if (!n) continue;
      const B = new THREE.InstancedMesh(body, paint, n), C = new THREE.InstancedMesh(cab, glass, n), col = new THREE.Color();
      for (const m of [B, C]) { m.castShadow = true; m.receiveShadow = true; }
      for (let k = 0; k < n; k++) B.setColorAt(k, col.setHex(PAINTS[Math.floor(rnd() * PAINTS.length)]));
      this.cars.push({ place: c.place, leave: c.leave, body: B, cab: C, jitter: Array.from({ length: n }, () => (rnd() - 0.5) * 0.05) });
      this.props.add(B, C);
    }
  }

  private placeCars(t: number, before: boolean) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const c of this.cars) {
      const M = before || c.leave !== undefined ? this.M.before : this.M.now;
      const pts = M.places[c.place]?.pts ?? [], n = c.body.count;
      for (let k = 0; k < n; k++) {
        const pt = pts[k];
        const g = !pt ? 0 : before || c.leave === undefined ? 1 : 1 - ease.inOut(clamp01((t - c.leave - (k / n) * 0.9) / 0.35));
        if (pt) {
          // along the line: towards the next point (or from the previous one at the end of a run)
          const nx = pts[k + 1] && Math.hypot(pts[k + 1][0] - pt[0], pts[k + 1][1] - pt[1]) < 12 ? pts[k + 1] : null, pv = pts[k - 1];
          const [dx, dz] = nx ? [nx[0] - pt[0], nx[1] - pt[1]] : pv ? [pt[0] - pv[0], pt[1] - pv[1]] : [0, 1];
          q.setFromAxisAngle(up, Math.atan2(dx, dz) + c.jitter[k]); p.set(pt[0], this.app.hf.sampleSurface(pt[0], pt[1]), pt[1]);
        }
        s.setScalar(g + 1e-3);
        m.compose(p, q, s);
        c.body.setMatrixAt(k, m); c.cab.setMatrixAt(k, m);
      }
      for (const X of [c.body, c.cab]) { X.instanceMatrix.needsUpdate = true; X.computeBoundingSphere(); }
      if (c.body.instanceColor) c.body.instanceColor.needsUpdate = true;
    }
  }

  private placeTrees(t: number, before: boolean) {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const T of this.trees) {
      const st = this.scene.steps[T.step];
      T.mesh.visible = !before && t >= st.t;
      if (!T.mesh.visible) continue;
      T.list.forEach((tr, k) => {
        const g = ease.back(clamp01((t - st.t - (k / T.list.length) * (st.dur ?? 1.2)) / 0.7));
        q.setFromAxisAngle(up, tr.rot);
        s.set(tr.s * g + 1e-3, tr.h * g + 1e-3, tr.s * g + 1e-3);
        p.set(tr.x, tr.y, tr.z);
        m.compose(p, q, s);
        T.mesh.setMatrixAt(k, m);
      });
      T.mesh.instanceMatrix.needsUpdate = true;
      if (T.mesh.instanceColor) T.mesh.instanceColor.needsUpdate = true;
      T.mesh.computeBoundingSphere();
    }
  }

  // ---------------- plots (Plot Twist) ----------------

  /** The FSI stack: see-through slabs the size of the plot, one a storey, coming in one by one (a film prop). */
  private stack: { mesh: THREE.Mesh; lines: THREE.LineSegments; t: number }[] = [];
  private buildStack() {
    const S = this.scene.stack, ring = S && (this.M.after.places[S.place] ?? this.M.before.places[S.place])?.ring;
    if (!S || !ring) return;
    const h = S.h ?? 4, th = h * 0.4;
    const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length, cz = ring.reduce((a, p) => a + p[1], 0) / ring.length;
    const base = Math.max(...ring.map(([x, z]) => this.app.hf.sampleSurface(x, z))) + 0.6;
    let level = 0;
    for (const L of S.layers) {
      const n = this.M.after.values[L.n] ?? this.M.before.values[L.n] ?? 0, count = Math.ceil(n - 1e-6);
      for (let k = 0; k < count; k++) {
        // a part slab (the fraction left over): the plot's outline scaled to that share of its area
        const f = Math.sqrt(Math.min(1, n - k));
        const shape = new THREE.Shape(ring.map(([x, z]) => new THREE.Vector2(cx + (x - cx) * f, cz + (z - cz) * f)));
        const geo = new THREE.ExtrudeGeometry(shape, { depth: th, bevelEnabled: false });
        // shape (x, z) extruded along +z → (x, up, z), from 0 to th
        geo.rotateX(Math.PI / 2); geo.translate(0, th, 0);
        const mat = new THREE.MeshStandardNodeMaterial({ color: L.color, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, roughness: 0.6 });
        const mesh = new THREE.Mesh(geo, mat);
        const lines = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicNodeMaterial({ color: L.color, transparent: true, opacity: 0.9 }));
        mesh.position.set(0, base + level * h, 0); lines.position.copy(mesh.position);
        mesh.renderOrder = 5; lines.renderOrder = 6;
        this.stack.push({ mesh, lines, t: L.t + (count > 1 ? (k / (count - 1)) * (L.dur ?? 1) : 0) });
        this.props.add(mesh, lines);
        level++;
      }
    }
  }

  private placeStack(t: number) {
    const S = this.scene.stack;
    if (!S) return;
    const out = 1 - clamp01((t - (S.t1 - 0.6)) / 0.6);
    for (const s of this.stack) {
      const g = ease.back(clamp01((t - s.t) / 0.5)), on = t >= s.t && t < S.t1;
      s.mesh.visible = s.lines.visible = on;
      if (!on) continue;
      s.mesh.scale.y = s.lines.scale.y = Math.max(1e-3, g);
      (s.mesh.material as THREE.Material).opacity = 0.22 * out;
      (s.lines.material as THREE.Material).opacity = 0.9 * out;
    }
  }

  /** An outline mark's ring at time t: each ring in turn, moving into the next over `dur` from its `at`. */
  private outlineAt(m: Extract<Scene['marks'][number], { kind: 'outline' }>, t: number): V2[] {
    const R = m.rings.map((r) => this.placeOf(r)?.ring ?? []), dur = m.dur ?? 1.2;
    let i = 0;
    while (i < m.at.length && i + 1 < R.length && t >= m.at[i] + dur) i++;
    if (i >= m.at.length || i + 1 >= R.length || t < m.at[i]) return R[i];
    const u = ease.inOut(clamp01((t - m.at[i]) / dur)), A = resample(R[i]), B = resample(R[i + 1]);
    return A.map((p, k) => [p[0] + (B[k][0] - p[0]) * u, p[1] + (B[k][1] - p[1]) * u] as V2);
  }

  // ---------------- state ----------------

  /** How many edits are in by time t. */
  stateAt(t: number) { let n = 0; while (n < this.edits.length && this.edits[n].t <= t + 1e-6) n++; return n; }

  /** Bring the map to `n` edits applied (redo / undo the prepared steps). Returns true when it changed. */
  private setState(n: number): boolean {
    const doc = this.app.doc;
    if (n === this.applied) return false;
    while (this.applied < n) { if (this.edits[this.applied].changed) doc.redo(); this.applied++; }
    while (this.applied > n) { this.applied--; if (this.edits[this.applied].changed) doc.undo(); }
    const T = performance.now();
    this.sync();
    lap('state change (rebuild)', T);
    this.M.now = this.applied === this.edits.length ? this.M.after : this.applied === 0 ? this.M.before : this.scene.measure(this.kit);
    return true;
  }

  // ---------------- camera ----------------

  private placeOf(name: string, M = this.M.now): Place | undefined { return M.places[name] ?? this.M.after.places[name] ?? this.M.before.places[name]; }
  private pointOf(at: V2 | string): V2 {
    if (typeof at !== 'string') return at;
    const P = this.placeOf(at);
    if (P?.p) return P.p;
    if (P?.line) return [(P.line[0][0] + P.line[1][0]) / 2, (P.line[0][1] + P.line[1][1]) / 2];
    return [0, 0];
  }

  /** The keys eased into each other at time t (before any clearance lift). */
  private key(t: number) {
    const K = this.scene.keys;
    let i = 0;
    while (i < K.length - 1 && K[i + 1].t <= t) i++;
    const a = K[i], b = K[Math.min(i + 1, K.length - 1)];
    const u = b === a || t <= a.t ? (t >= b.t ? 1 : 0) : clamp01((t - a.t) / (b.t - a.t));
    const e = ease[b.ease ?? 'inOut'](u);
    const lerp = (p: number, q: number) => p + (q - p) * e;
    const pa = this.pointOf(a.at), pb = this.pointOf(b.at);
    const k: Required<Omit<Key, 'at' | 'ease' | 't'>> & { at: V2 } = {
      at: [lerp(pa[0], pb[0]), lerp(pa[1], pb[1])],
      dist: Math.exp(lerp(Math.log(a.dist), Math.log(b.dist))), yaw: lerp(a.yaw, b.yaw), pitch: lerp(a.pitch, b.pitch), fov: lerp(a.fov ?? 40, b.fov ?? 40),
      y: lerp(a.y ?? 0, b.y ?? 0),
    };
    return k;
  }

  /** where the orbit at pitch `p` (radians) puts the camera */
  private orbit(k: ReturnType<Player['key']>, p: number, ty: number) {
    const yaw = (k.yaw * Math.PI) / 180, cp = Math.cos(p);
    return new THREE.Vector3(k.at[0] + k.dist * cp * Math.sin(yaw), ty + k.dist * Math.sin(p), k.at[1] + k.dist * cp * Math.cos(yaw));
  }

  /** Buildings as footprints with a top height (for the camera's sight line). */
  private blds: { x0: number; z0: number; x1: number; z1: number; ring: number[]; top: number }[] | null = null;

  /** Is the sight line from the target up to the camera clear of the terrain and of every building? */
  private clear(at: V2, ty: number, pos: THREE.Vector3): boolean {
    const hf = this.app.hf;
    if (pos.y < hf.sampleSurface(pos.x, pos.z) + 4) return false;
    this.blds ??= this.app.doc.all('building').map((b) => {
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, g = -Infinity;
      for (let i = 0; i < b.outer.length; i += 2) { x0 = Math.min(x0, b.outer[i]); x1 = Math.max(x1, b.outer[i]); z0 = Math.min(z0, b.outer[i + 1]); z1 = Math.max(z1, b.outer[i + 1]); g = Math.max(g, hf.sampleSurface(b.outer[i], b.outer[i + 1])); }
      return { x0, z0, x1, z1, ring: b.outer, top: g + b.h + 3 };
    });
    const inside = (x: number, z: number, P: number[]) => { let c = false; for (let i = 0, j = P.length - 2; i < P.length; j = i, i += 2) if ((P[i + 1] > z) !== (P[j + 1] > z) && x < ((P[j] - P[i]) * (z - P[i + 1])) / (P[j + 1] - P[i + 1]) + P[i]) c = !c; return c; };
    const lx0 = Math.min(at[0], pos.x), lx1 = Math.max(at[0], pos.x), lz0 = Math.min(at[1], pos.z), lz1 = Math.max(at[1], pos.z);
    const near = this.blds.filter((b) => b.x1 >= lx0 - 2 && b.x0 <= lx1 + 2 && b.z1 >= lz0 - 2 && b.z0 <= lz1 + 2);
    for (let s = 0.04; s <= 1.0001; s += 0.04) {
      const x = at[0] + (pos.x - at[0]) * s, z = at[1] + (pos.z - at[1]) * s, y = ty + (pos.y - ty) * s;
      if (y < hf.sampleSurface(x, z) + 1.5) return false;
      for (const b of near) if (x >= b.x0 - 2 && x <= b.x1 + 2 && z >= b.z0 - 2 && z <= b.z1 + 2 && y < b.top && inside(x, z, b.ring)) return false;
    }
    return true;
  }

  /** extra pitch (radians) per frame that keeps the view clear, smoothed over ±1 s so the camera never jumps */
  private lift: Float32Array | null = null;
  private liftAt(t: number) {
    if (!this.lift) {
      const raw = new Float32Array(this.count + 1);
      for (let f = 0; f <= this.count; f++) {
        const k = this.key(f / this.fps), ty = this.app.hf.sampleSurface(k.at[0], k.at[1]) + k.y, p0 = (k.pitch * Math.PI) / 180;
        // the target and the ground 25 m round it all in view (not just the one point)
        // and the ground towards the camera (so no roof fills the foreground)
        const yw = (k.yaw * Math.PI) / 180, fx = Math.sin(yw), fz = Math.cos(yw);
        const look: V2[] = [k.at, [k.at[0] + 25, k.at[1]], [k.at[0] - 25, k.at[1]], [k.at[0], k.at[1] + 25], [k.at[0], k.at[1] - 25],
          [k.at[0] + fx * 0.25 * k.dist, k.at[1] + fz * 0.25 * k.dist]];
        const ok = (pos: THREE.Vector3) => look.every((q) => this.clear(q, this.app.hf.sampleSurface(q[0], q[1]), pos));
        let d = 0;
        while (d < 0.6 && p0 + d < 1.45 && !ok(this.orbit(k, p0 + d, ty))) d += 0.01;
        raw[f] = d;
      }
      const R = this.fps, out = new Float32Array(raw.length);
      for (let f = 0; f < raw.length; f++) {
        let m = 0;
        for (let g = Math.max(0, f - R); g <= Math.min(raw.length - 1, f + R); g++) m = Math.max(m, raw[g] * (0.5 + 0.5 * Math.cos((Math.PI * (f - g)) / R)));
        out[f] = m;
      }
      // the bell above can dip below a neighbour's need between two peaks: never less than what this frame needs
      for (let f = 0; f < raw.length; f++) out[f] = Math.max(out[f], raw[f]);
      this.lift = out;
    }
    return this.lift[Math.min(this.count, Math.max(0, Math.round(t * this.fps)))];
  }

  /** The camera at time t: the keys, lifted where the orbit would pass behind a building or into a hill. */
  private camera(t: number) {
    const k = this.key(t), hf = this.app.hf, cam = this.app.engine.camera;
    const ty = hf.sampleSurface(k.at[0], k.at[1]) + k.y;
    const pos = this.orbit(k, (k.pitch * Math.PI) / 180 + this.liftAt(t), ty);
    cam.position.copy(pos);
    cam.fov = k.fov;
    cam.near = Math.max(0.5, k.dist * 0.01);
    cam.far = 20000;
    cam.aspect = D.W / D.H;
    cam.updateProjectionMatrix();
    cam.lookAt(k.at[0], ty, k.at[1]);
    cam.updateMatrixWorld();
    return { focus: new THREE.Vector3(k.at[0], ty, k.at[1]), dist: k.dist };
  }

  // ---------------- one frame ----------------

  /** Render the 3D view at time t into the 2D canvas (in the map state it's in now). */
  private async render3d(t: number, before: boolean) {
    const E = this.app.engine, Wd = this.app.world;
    let T = performance.now();
    this.clock = t;
    const { focus, dist } = this.camera(t);
    Wd.frame(E.camera.position, focus);
    E.updateShadows(focus, Math.min(2600, Math.max(160, dist * 1.1)), true);
    this.placeTrees(t, before);
    this.placeCars(t, before);
    this.placeStack(t);
    T = lap('setup (camera, shadows, props)', T);
    // into a render target and read back from it: reading the canvas itself gives whichever frame the browser last
    // presented (WebGPU), one behind or cleared, never reliably this one
    const r = E.renderer, size = r.getDrawingBufferSize(new THREE.Vector2());
    if (!this.rt || this.rt.width !== size.x || this.rt.height !== size.y) { this.rt?.dispose(); this.rt = new THREE.RenderTarget(size.x, size.y); }
    r.setRenderTarget(this.rt);
    E.render();
    r.setRenderTarget(null);
    T = lap('render (submit)', T);
    const px = (await r.readRenderTargetPixelsAsync(this.rt, 0, 0, size.x, size.y)) as Uint8Array;
    T = lap('GPU finish + readback', T);
    this.blit(px, size.x, size.y);
    lap('copy + downscale (CPU)', T);
  }

  private rt: THREE.RenderTarget | null = null;
  private full: { cv: HTMLCanvasElement; ctx: CanvasRenderingContext2D; img: ImageData } | null = null;

  /** Pixels read back from the GPU → the 2D canvas, scaled down to 1080 × 1920 (rows may come padded to 256 bytes). */
  private blit(px: Uint8Array, w: number, h: number) {
    if (!this.full || this.full.cv.width !== w || this.full.cv.height !== h) {
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const ctx = cv.getContext('2d')!;
      this.full = { cv, ctx, img: ctx.createImageData(w, h) };
    }
    // rows padded to 256 bytes, all but the last (so not px.length / h)
    const { img, ctx, cv } = this.full, row = w * 4, stride = Math.ceil(row / 256) * 256;
    // WebGL reads bottom-up
    const flip = !(this.app.engine.renderer.backend as unknown as { isWebGPUBackend?: boolean }).isWebGPUBackend;
    for (let y = 0; y < h; y++) {
      const src = (flip ? h - 1 - y : y) * stride;
      img.data.set(px.subarray(src, src + row), y * row);
    }
    ctx.putImageData(img, 0, 0);
    this.ctx.drawImage(cv, 0, 0, D.W, D.H);
  }

  /** world point → canvas pixels with the current camera */
  private project: D.Project = (x, z, lift = 0) => {
    const v = new THREE.Vector3(x, this.app.hf.sampleSurface(x, z) + lift, z).project(this.app.engine.camera);
    if (v.z > 1 || v.z < -1) return null;
    return [((v.x + 1) / 2) * D.W, ((1 - v.y) / 2) * D.H];
  };

  /** `{before.cross}` → the measured number */
  text(s: string): string {
    return s.replace(/\{(before|after|now)\.(\w+)(?::(\d))?\}/g, (_, w: 'before' | 'after' | 'now', k: string, d?: string) => {
      const v = this.M[w].values[k];
      if (v === undefined) return '?';
      if (d !== undefined) return Number(v.toFixed(Number(d))).toLocaleString('en-IN', { minimumFractionDigits: Number(d) });
      const r = Math.round(v * 10) / 10;
      return Number.isInteger(r) ? r.toLocaleString('en-IN') : r.toFixed(1);
    });
  }

  /** Everything drawn over the 3D frame at time t. */
  private overlays(t: number) {
    const S = this.scene, ctx = this.ctx, P = this.project;
    for (const m of S.marks) {
      const a = fade(t, m.t0, m.t1);
      if (a <= 0) continue;
      if (m.kind === 'outline') { D.ring(ctx, P, this.outlineAt(m, t), clamp01((t - m.t0) / 0.8), a, m.color ?? RED); continue; }
      const pl = this.placeOf(m.place);
      if (!pl) continue;
      const u = clamp01((t - m.t0) / 0.8);
      if (m.kind === 'circle') D.ring(ctx, P, pl.ring ?? this.kit.circle(pl.p ?? [0, 0], m.r ?? 30, 64), u, a, m.color ?? RED);
      else if (m.kind === 'dim' && pl.line) D.dim(ctx, P, pl.line[0], pl.line[1], this.text(m.text), u, a, m.color ?? RED);
      else if (m.kind === 'tag') D.tag(ctx, P, pl.p ?? this.pointOf(m.place), this.text(m.text), a, m.color ?? RED, false);
      else if (m.kind === 'place' && pl.ring) D.placeTool(ctx, P, pl.ring, t - m.t0, a, this.text(m.tool), !!m.drag, m.color ?? COBALT);
      else if (m.kind === 'draw' && pl.ring) D.drawTool(ctx, P, pl.ring, t - m.t0, m.dur, a, m.color ?? COBALT);
      else if (m.kind === 'band' && pl.ring) D.band(ctx, P, pl.ring, clamp01((t - m.t0) / 1.0), a, m.color ?? RED);
    }
    // each step's tag while it lands
    S.steps.forEach((st) => {
      const a = fade(t, st.t, st.t + Math.max(1.6, (st.dur ?? 0) + 1.1), 0.25, 0.3);
      if (a > 0 && st.place) D.tag(ctx, P, this.pointOf(st.place), this.text(st.label), a, GREEN, true);
    });
    for (const c of S.captions) D.caption(ctx, this.text(c.text), fade(t, c.t0, c.t1), c.at, c.size);
    const C = S.counter, K = S.cards;
    if (C) D.counter(ctx, fade(t, C.t0, C.t1), this.text(C.text), this.text(C.label), C.sub && this.text(C.sub));
    if (K && t >= K.t0 && t <= K.t1) D.cards(ctx, K.stats.map((s) => ({ ...s, label: this.text(s.label), value: this.text(s.value) })), t - K.t0, clamp01((K.t1 - t) / 0.3));
    if (S.wipe) D.wipe(ctx, (t - S.wipe.t0) / (S.wipe.t1 - S.wipe.t0), this.text(S.wipe.text));
    S.shots?.forEach((sh, i) => D.shotTitle(ctx, i + 1, this.text(sh.title), sh.sub && this.text(sh.sub), fade(t, sh.t0, sh.t1, 0.4, 0.3)));
  }

  /** how far into ink the frame is: the cuts, and a loop's two ends */
  private dipAt(t: number) {
    const S = this.scene, half = 0.22;
    let a = 0;
    for (const c of S.cuts ?? []) a = Math.max(a, 1 - Math.abs(t - c) / half);
    if (S.loop) a = Math.max(a, 1 - t / 0.5, 1 - (S.duration - t) / 0.5);
    return clamp01(a);
  }

  /** the before / after split: BEFORE (rendered earlier) wipes in from the right over the AFTER frame */
  private split(t: number, before: ImageBitmap) {
    const S = this.scene.split!, ctx = this.ctx;
    const u = ease.inOut(clamp01((t - S.t0) / 0.7));
    const x = D.W - (D.W / 2) * u;
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, x, D.H); ctx.clip(); ctx.drawImage(before, 0, 0, D.W, D.H); ctx.restore();
    D.splitChrome(ctx, x, this.text(S.left), this.text(S.right), S.stats.map((s) => ({ label: this.text(s.label), before: this.text(s.before), after: this.text(s.after) })), t - S.t0);
  }

  private inSplit(t: number) { const s = this.scene.split; return !!s && t >= s.t0 && t < s.t1; }

  /** Draw frame f; the split's BEFORE half comes from `before` (rendered earlier, in the BEFORE state). */
  private async frame(f: number, before?: ImageBitmap) {
    const t = f / this.fps, S = this.scene, ctx = this.ctx;
    const endT = t - S.end.t0;
    if (S.loop) {
      await this.render3d(t, false);
      this.overlays(t);
      D.dip(ctx, ease.inOut(this.dipAt(t)));
      return;
    }
    if (!BRAND.branded) {
      // unbranded: the film runs to the last frame on the 3D, the closing question over the last shot
      await this.render3d(t, false);
      if (this.inSplit(t) && before && S.split) this.split(t, before);
      else this.overlays(t);
      if (endT >= 0) D.closing(ctx, endT, this.text(S.end.headline), S.duration - S.end.t0, S.end.note && this.text(S.end.note));
      return;
    }
    if (endT < 0.5) {
      await this.render3d(t, false);
      if (this.inSplit(t) && before && S.split) this.split(t, before);
      else this.overlays(t);
      D.chip(ctx, S.title, fade(t, 0.2, S.end.t0, 0.4, 0.3) * (this.inSplit(t) ? 0 : 1));
      D.bug(ctx, fade(t, 0.2, S.end.t0, 0.4, 0.3));
    }
    if (endT >= 0) D.endCard(ctx, endT, this.text(S.end.headline));
  }

  // ---------------- capture ----------------

  private async send(f: number, layer?: string) {
    const T = performance.now();
    const blob = await new Promise<Blob>((res, rej) => this.cv.toBlob((b) => (b ? res(b) : rej(new Error('toBlob failed'))), 'image/png'));
    lap('PNG encode', T);
    const p = fetch(`/__film/frame?scene=${this.scene.id}&f=${f}${layer ? `&layer=${layer}` : ''}`, { method: 'POST', body: blob })
      .then((r) => { if (!r.ok) throw new Error(`frame ${f}: ${r.status}`); });
    this.uploads.add(p);
    void p.finally(() => this.uploads.delete(p));
    if (this.uploads.size >= 6) await Promise.race(this.uploads);
  }

  /** Render the frames (all, or opts.frames): every frame of the BEFORE state first, with the split's BEFORE halves. */
  async run(onFrame: (f: number, n: number) => void = () => {}) {
    const all = this.opts.frames ?? Array.from({ length: this.count }, (_, i) => i);
    const frames = all.filter((f) => f >= 0 && f < this.count);
    const cap = this.opts.capture, id = this.scene.id;
    const log = (s: string) => { console.info(`[film] ${s}`); if (cap) void fetch('/__film/log', { method: 'POST', body: `${id}: ${s}` }); };
    const t0 = performance.now();
    let done = 0;
    const tick = (f: number) => { done++; onFrame(f, frames.length); if (done % 30 === 0) log(`${done}/${frames.length} frames · ${((performance.now() - t0) / done).toFixed(0)} ms each`); };
    const warm = (changed: boolean) => { if (changed) for (let i = 0; i < 2; i++) this.app.engine.render(); };
    const splitFrames = frames.filter((f) => this.inSplit(f / this.fps));
    const beforeLayer = new Map<number, ImageBitmap>();
    // 1) the BEFORE state: its frames, then the split's left halves (kept as files: too many to hold in memory)
    // the first 3D pipeline is built before the shadow map settles and keeps a dead handle to it (WebGPU
    // "Destroyed texture ShadowDepthTexture" on every submit): render once, then build it afresh
    await this.render3d(0, false);
    await new Promise((r) => setTimeout(r, 50));
    this.app.engine.releasePipeline();
    warm(this.setState(0) || true);
    for (const f of frames) {
      if (this.stateAt(f / this.fps) !== 0 || this.inSplit(f / this.fps)) continue;
      let T = performance.now();
      await this.frame(f);
      T = lap('frame total (3D + captions)', T);
      if (cap) await this.send(f);
      lap('send total (PNG + upload)', T);
      tick(f);
    }
    for (const f of splitFrames) {
      await this.render3d(f / this.fps, true);
      if (cap) await this.send(f, 'before');
      else beforeLayer.set(f, await createImageBitmap(this.cv));
    }
    await Promise.all(this.uploads);
    // 2) the fix going in, the split, the end card
    for (const f of frames) {
      const t = f / this.fps;
      if (this.stateAt(t) === 0 && !this.inSplit(t)) continue;
      warm(this.setState(this.stateAt(t)));
      let before = beforeLayer.get(f);
      if (this.inSplit(t) && !before && cap) {
        const r = await fetch(`/__film/frame?scene=${id}&f=${f}&layer=before`);
        before = await createImageBitmap(await r.blob());
      }
      let T = performance.now();
      await this.frame(f, before);
      T = lap('frame total (3D + captions)', T);
      before?.close();
      if (cap) await this.send(f);
      lap('send total (PNG + upload)', T);
      tick(f);
    }
    await Promise.all(this.uploads);
    log(`done: ${frames.length} frames in ${((performance.now() - t0) / 1000).toFixed(0)} s${this.gpuErrors ? ` · ${this.gpuErrors} GPU errors!` : ''}`);
    if (PROF) for (const [k, v] of Object.entries(PROF)) log(`profile ${k}: ${(v / frames.length).toFixed(1)} ms/frame (${(v / 1000).toFixed(1)} s total)`);
  }
}

/** A ring as 64 points evenly round it, counter-clockwise from its corner nearest the north-west (so two outlines of
 *  a plot line up corner to corner when one moves into the other). */
function resample(R: V2[], n = 64): V2[] {
  if (R.length < 3) return R;
  let A = 0;
  for (let i = 0; i < R.length; i++) { const p = R[i], q = R[(i + 1) % R.length]; A += p[0] * q[1] - q[0] * p[1]; }
  const P = A < 0 ? [...R].reverse() : R;
  let s0 = 0;
  P.forEach((p, i) => { if (p[0] + p[1] < P[s0][0] + P[s0][1]) s0 = i; });
  const Q = [...P.slice(s0), ...P.slice(0, s0)];
  const len: number[] = [0];
  for (let i = 0; i < Q.length; i++) { const p = Q[i], q = Q[(i + 1) % Q.length]; len.push(len[i] + Math.hypot(q[0] - p[0], q[1] - p[1])); }
  const L = len[Q.length], out: V2[] = [];
  for (let k = 0, i = 0; k < n; k++) {
    const d = (k / n) * L;
    while (i < Q.length - 1 && len[i + 1] < d) i++;
    const p = Q[i], q = Q[(i + 1) % Q.length], f = (d - len[i]) / (len[i + 1] - len[i] || 1);
    out.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]);
  }
  return out;
}
