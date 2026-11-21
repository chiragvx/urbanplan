// The Pro 3D view (three.js, WebGL): the plot and its roads, every building massed floor by floor in the design
// system's materials, its windows and doors at their catalog sizes (instanced: one mesh per type, however many
// thousands), balconies, bands and fins. "X-ray" cuts the building at a floor: the floors above go, and that floor
// shows its flats, walls, cores and entrance doors like a doll's house. Pointing at a window or a door reads out its
// tag and size.
//
// Two ways to draw it: the wireframe (the default: ./wire.ts, low-poly lines in the page's ink that fade in and out
// as the scheme changes) and shaded (the materials, the sun, the windows). X-ray is always shaded.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { PlotReport } from '../doc/plot';
import { UNIT_COLOR, type SiteReport } from '../doc/site';
import { bearingOf, chhajjaOn, climateOf, kelvinColour, siteKitOf, SURFACE_COLOUR, landscapeOf, lightingOf, signageOf, compositionOf, finishOf, languageOf, zonesOf, ZONED_FROM, type DesignSystem, type Tone } from './design';
import { materialOf } from './materials';
import { DEFAULT_SITE } from '../doc/site';
import { frameOf, layForm, type Form, type FormLayout } from './form';
import { buildForm, disposeBuilt, layoutHash, type Built, type Look } from './form/mesh';
import { facadeBays, type FloorPlan, type Opening } from './openings';
import { plantingOf } from './landscape';
import { pointIn } from '../doc/site';

import { SHOP_W, type Shops } from './mixed';
import { roadFrame } from '../doc/site';
import { Wire } from './wire';
import { triangles, type MP } from '../doc/ground';
import { featureOf, keptOf, shapeOf, type Levels, type SiteFeature } from './siteObjects';

/** a flat's rooms for the X-ray floor (./rooms.ts), by building, by flat of the typical floor */
export interface RoomsLike { rooms: { kind: string; ring: number[] }[]; walls: number[][] }
export interface ViewData {
  r: PlotReport; d: SiteReport; plans: FloorPlan[]; ds: DesignSystem; xray: number | null;
  roads: { pts: [number, number, number, number]; today: number }[]; shops?: Shops | null;
  /** a building's own design system (the project's when unset) */
  dsOf?: (b: number) => DesignSystem;
  rooms?: RoomsLike[][]; roomColor?: Record<string, string>;
  /** obstructions and no-build zones, the plot's levels, where north is, the building picked */
  features?: SiteFeature[]; levels?: Levels; north?: number; sel?: string | null;
  /** the formed buildings' layouts by building id (Evaluated.forms); unset, worked out here from each one's form */
  forms?: Record<string, FormLayout>;
}
/** a formed building as drawn: its layout, what it was drawn with, and the meshes (kept while nothing changes) */
interface FormEntry { L: FormLayout; hash: string; key: string; built: Built }
export type CameraView = 'fit' | 'street' | 'top';
/** what's being drawn or edited, over everything: lines (x,y,z pairs) and handles (x,y,z each), in ink */
export interface Overlay { lines?: number[]; dashed?: number[]; points?: number[]; hot?: number[] }
export type RenderMode = 'wire' | 'shaded';
export interface Picked { tag: string; label: string; size: string; floor: number; x: number; y: number }

const box = new THREE.BoxGeometry(1, 1, 1);
/** a tree's crown and trunk, low-poly, unit-sized (scaled per tree) */
const crownGeo = new THREE.IcosahedronGeometry(0.5, 0), trunkGeo = new THREE.CylinderGeometry(0.35, 0.5, 1, 6);
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
/** a jaali's pierced pattern as an alpha map (white solid, black open): drawn once, shared */
let jaaliTex: THREE.Texture | null = null;
function jaaliTexture(): THREE.Texture | null {
  if (jaaliTex || typeof document === 'undefined') return jaaliTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#000';
  for (const [x, y] of [[16, 16], [48, 16], [16, 48], [48, 48], [32, 32], [0, 32], [64, 32], [32, 0], [32, 64]]) { g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill(); }
  jaaliTex = new THREE.CanvasTexture(c);
  jaaliTex.wrapS = jaaliTex.wrapT = THREE.RepeatWrapping; jaaliTex.repeat.set(4, 4);
  return jaaliTex;
}

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
  mesh(mat: THREE.Material, shadows = true, geo: THREE.BufferGeometry = box): THREE.InstancedMesh | null {
    if (!this.m.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, this.m.length);
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
  /** the plan: straight down, no perspective */
  ortho = new THREE.OrthographicCamera(-50, 50, 50, -50, 0.5, 5000);
  plan = false;
  /** told when the view goes into or out of the plan (a camera key can leave it) */
  onPlan?: (on: boolean) => void;
  controls: OrbitControls;
  /** the camera in use */
  get cam(): THREE.Camera { return this.plan ? this.ortho : this.camera; }
  /** where north points on screen (degrees clockwise from up): for the compass */
  onNorth?: (deg: number) => void;
  north = 0;
  private lastNorth = NaN;
  private over = new THREE.Group();
  private overLine = new THREE.LineBasicMaterial({ color: '#000', depthTest: false, transparent: true });
  private overDash = new THREE.LineDashedMaterial({ color: '#000', dashSize: 0.8, gapSize: 0.6, depthTest: false, transparent: true });
  private overPts = new THREE.PointsMaterial({ color: '#000', size: 9, sizeAttenuation: false, depthTest: false, transparent: true });
  private overHot = new THREE.PointsMaterial({ color: '#000', size: 14, sizeAttenuation: false, depthTest: false, transparent: true });
  root = new THREE.Group();
  sun = new THREE.DirectionalLight(0xffffff, 2.4);
  ray = new THREE.Raycaster();
  pickables: THREE.InstancedMesh[] = [];
  raf = 0;
  fitted = '';
  wire = new Wire();
  mode: RenderMode = 'wire';
  private xrayOn = false;
  private ground: THREE.Mesh;
  private fog = new THREE.Fog('#e4e4e2', 400, 1400);
  private sky = new THREE.Color('#e4e4e2');
  private paper = new THREE.Color('#fafaf9');
  private env: THREE.Texture;
  /** the formed buildings drawn, by building id */
  private formed = new Map<string, FormEntry>();

  constructor(public canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.scene.background = this.sky.clone();
    this.scene.fog = this.fog;
    this.scene.add(new THREE.HemisphereLight('#f4f7fb', '#b9ae9a', 1.3));
    // (a soft room to reflect in, for the formed buildings' glass and metal only: the straight ones look as before)
    const pm = new THREE.PMREMGenerator(this.renderer);
    this.env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    this.sun.position.set(-120, 180, -90);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target, this.root);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ color: '#e6e5e1', roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true;
    this.ground = ground;
    this.over.renderOrder = 10;
    this.scene.add(ground, this.wire.group, this.over);
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
    this.fitOrtho();
    this.frame();
  }
  /** the plan's frustum for the canvas's shape (its zoom is the controls') */
  private orthoH = 60;
  private fitOrtho() {
    const a = this.camera.aspect || 1, H = this.orthoH;
    this.ortho.left = -H * a; this.ortho.right = H * a; this.ortho.top = H; this.ortho.bottom = -H;
    this.ortho.updateProjectionMatrix();
  }
  /** 3D or the plan from straight above */
  setPlan(on: boolean) {
    if (on === this.plan) return;
    this.plan = on;
    this.onPlan?.(on);
    const c = this.controls;
    c.object = on ? this.ortho : this.camera;
    c.enableRotate = !on;
    c.screenSpacePanning = true;
    if (on) {
      const { cx, cz, s } = this.box;
      this.orthoH = s * 0.75; this.ortho.zoom = 1; this.fitOrtho();
      c.target.set(cx, 0, cz); this.ortho.position.set(cx, 800, cz); this.ortho.up.set(0, 0, -1); this.ortho.lookAt(cx, 0, cz);
    } else this.look('fit');
    c.update(); this.frame();
  }
  /** north's direction on the screen, worked out from where the camera looks */
  private compass() {
    if (!this.onNorth) return;
    const t = this.controls.target, n = (this.north * Math.PI) / 180;
    const a = t.clone().project(this.cam), b = new THREE.Vector3(t.x + Math.sin(n) * 10, t.y, t.z - Math.cos(n) * 10).project(this.cam);
    const deg = Math.round((Math.atan2(b.x - a.x, (b.y - a.y) / (this.camera.aspect || 1)) * 180) / Math.PI);
    if (deg !== this.lastNorth) { this.lastNorth = deg; this.onNorth(deg); }
  }

  // ---------- pointing ----------
  private ndc(px: number, py: number) { const r = this.canvas.getBoundingClientRect(); return new THREE.Vector2(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1); }
  /** the ground under the pointer (x, z) */
  groundAt(px: number, py: number, y = 0): [number, number] | null {
    this.ray.setFromCamera(this.ndc(px, py), this.cam);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    if (Math.abs(d.y) < 1e-6) return null;
    const t = (y - o.y) / d.y;
    return t > 0 ? [o.x + d.x * t, o.z + d.z * t] : null;
  }
  /** the building under the pointer (its id) */
  buildingAt(px: number, py: number): string | null { return this.buildingHit(px, py)?.id ?? null; }
  /** the building under the pointer, and how high up it was touched */
  buildingHit(px: number, py: number): { id: string; y: number } | null {
    this.ray.setFromCamera(this.ndc(px, py), this.cam);
    const hit = this.ray.intersectObjects(this.wire.masses.children, false)[0];
    return hit ? { id: hit.object.userData.id as string, y: hit.point.y } : null;
  }
  /** a point on the ground on screen (px within the canvas) */
  toScreen(x: number, y: number, z: number): [number, number] {
    const v = new THREE.Vector3(x, y, z).project(this.cam), r = this.canvas.getBoundingClientRect();
    return [((v.x + 1) / 2) * r.width, ((1 - v.y) / 2) * r.height];
  }
  /** what's being drawn or edited, drawn over everything */
  overlay(o: Overlay | null) {
    this.over.traverse((x) => (x as THREE.Mesh).geometry?.dispose());
    this.over.clear();
    if (o) {
      const g = (a: number[]) => { const b = new THREE.BufferGeometry(); b.setAttribute('position', new THREE.Float32BufferAttribute(a, 3)); return b; };
      if (o.lines?.length) { const l = new THREE.LineSegments(g(o.lines), this.overLine); l.renderOrder = 10; l.frustumCulled = false; this.over.add(l); }
      if (o.dashed?.length) { const l = new THREE.LineSegments(g(o.dashed), this.overDash); l.computeLineDistances(); l.renderOrder = 10; l.frustumCulled = false; this.over.add(l); }
      if (o.points?.length) { const q = new THREE.Points(g(o.points), this.overPts); q.renderOrder = 11; q.frustumCulled = false; this.over.add(q); }
      if (o.hot?.length) { const q = new THREE.Points(g(o.hot), this.overHot); q.renderOrder = 12; q.frustumCulled = false; this.over.add(q); }
    }
    this.frame();
  }
  frame() {
    if (!this.raf) this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (this.controls.update()) this.frame();
      // (the wireframe keeps drawing while edges fade in or out)
      if (this.wired && this.wire.write()) this.frame();
      if (!this.wired) this.lod();
      this.compass();
      this.renderer.render(this.scene, this.cam);
    });
  }
  dispose() {
    cancelAnimationFrame(this.raf); this.clear();
    for (const e of this.formed.values()) disposeBuilt(e.built);
    this.formed.clear(); this.env.dispose();
    this.wire.dispose(); this.controls.dispose(); this.renderer.dispose();
  }

  /** The formed buildings' level of detail: each one's fins and patterns drawn in full when it's big on screen,
   *  every third when smaller, none when tiny, and the nearest kept first when there are too many in all. */
  private lod() {
    if (!this.formed.size) return;
    const H = this.canvas.clientHeight || 800, cam = this.cam;
    const focal = H / 2 / Math.tan((this.camera.fov * Math.PI) / 360);
    const L = [...this.formed.values()].map((e) => {
      const b = e.built, px = this.plan ? (b.radius * this.ortho.zoom * H) / (2 * this.orthoH) : (b.radius / Math.max(1, cam.position.distanceTo(b.centre))) * focal;
      return { b, px };
    }).sort((a, z) => z.px - a.px);
    let used = 0;
    const BUDGET = 260000;
    for (const { b, px } of L) {
      const level = px > 260 ? 2 : px > 70 ? 1 : 0;
      for (const p of b.parts) {
        const major = p.userData.major as number, all = p.userData.all as number;
        let n = level === 2 ? all : level === 1 ? major : 0;
        if (used + n > BUDGET) n = used + major <= BUDGET ? major : 0;
        p.count = n; p.visible = n > 0; used += n;
      }
    }
  }

  /** drawn as the wireframe just now (X-ray is always shaded) */
  get wired() { return this.mode === 'wire' && !this.xrayOn; }
  setMode(m: RenderMode) { this.mode = m; this.apply(); }
  private apply() {
    const w = this.wired;
    this.root.visible = !w; this.ground.visible = !w; this.wire.group.visible = w;
    this.scene.background = w ? this.paper : this.sky;
    this.scene.fog = w ? null : this.fog;
    this.frame();
  }

  /** the plot's middle, its size and the tallest building: for the camera and the sun */
  box = { cx: 0, cz: 0, s: 30, h: 30 };
  /** move the camera: the whole site, down at a pedestrian's height from the front road, or straight down */
  look(kind: CameraView) {
    const { cx, cz, s, h } = this.box, c = this.controls;
    if (this.plan) { if (kind !== 'top' && kind !== 'fit') this.setPlan(false); else { this.orthoH = s * 0.75; this.ortho.zoom = 1; this.fitOrtho(); c.target.set(cx, 0, cz); this.ortho.position.set(cx, 800, cz); c.update(); this.frame(); return; } }
    // (far enough back for the plot or the building, whichever is bigger, with room under the result bar)
    if (kind === 'fit') { const R = Math.max(s, h * 0.95); c.target.set(cx, h * 0.38, cz); this.camera.position.set(cx - R * 1.2, h * 0.38 + R * 1.05, cz - R * 1.75); }
    if (kind === 'street') { c.target.set(cx, Math.min(h * 0.45, 40), cz); this.camera.position.set(cx - s * 0.35, 1.7, cz - s * 0.9 - 12); }
    if (kind === 'top') { c.target.set(cx, 0, cz); this.camera.position.set(cx, Math.max(s * 2.2, h * 1.6), cz + 0.01); }
    c.update(); this.frame();
  }
  /** the sun from this direction (x east, y up, z south; null: the default afternoon light) */
  setSun(dir: [number, number, number] | null) {
    const { cx, cz } = this.box;
    const [x, y, z] = dir ?? [-0.45, 0.75, -0.35];
    const up = Math.max(0.02, y), L = Math.hypot(x, up, z);
    this.sun.position.set(cx + (x / L) * 300, (up / L) * 300, cz + (z / L) * 300);
    this.sun.target.position.set(cx, 0, cz);
    this.sun.intensity = y <= 0 ? 0.15 : 2.6 * Math.min(1, y / L * 2.2);
    // (after sunset the lights come on)
    this.night = dir ? Math.max(0, Math.min(1, (0.06 - y) / 0.16)) : 0;
    this.applyNight();
    this.frame();
  }
  /** how dark it is (0 day … 1 night): the lights and the windows glow by it */
  night = 0;
  private lamps: THREE.MeshStandardMaterial[] = []; private glows: THREE.MeshBasicMaterial[] = []; private panes: THREE.MeshStandardMaterial[] = [];
  private lampMat(m: THREE.MeshStandardMaterial) { this.lamps.push(m); m.emissiveIntensity = 2.6 * this.night; return m; }
  private glowMat(m: THREE.MeshBasicMaterial) { this.glows.push(m); m.opacity = 0.32 * this.night; m.visible = this.night > 0.02; return m; }
  private paneMat(m: THREE.MeshStandardMaterial) { this.panes.push(m); m.emissiveIntensity = 0.38 * this.night; return m; }
  private applyNight() {
    const n = this.night;
    for (const m of this.lamps) m.emissiveIntensity = 2.6 * n;
    for (const m of this.glows) { m.opacity = 0.32 * n; m.visible = n > 0.02; }
    for (const m of this.panes) m.emissiveIntensity = 0.38 * n;
    this.frame();
  }
  /** a darker sky for the dark theme */
  setTheme(dark: boolean) {
    this.sky.set(dark ? '#18181b' : '#e4e4e2'); this.fog.color.copy(this.sky);
    (this.ground.material as THREE.MeshStandardMaterial).color.set(dark ? '#3a3a3c' : '#e6e5e1');
    const css = getComputedStyle(document.documentElement), paper = css.getPropertyValue('--up-paper').trim() || (dark ? '#09090b' : '#fafaf9'), ink = css.getPropertyValue('--up-ink').trim() || (dark ? '#fafafa' : '#0c0c0d');
    this.paper.set(paper); this.wire.colours(paper, ink);
    for (const m of [this.overLine, this.overDash, this.overPts, this.overHot]) m.color.set(ink);
    this.apply();
  }
  /** the view as a PNG (for the drawings and a share) */
  snapshot(): string {
    // (always the shaded view: it goes into reports and drawings)
    const m = this.mode; if (m !== 'shaded') { this.mode = 'shaded'; this.apply(); }
    this.renderer.render(this.scene, this.cam);
    const url = this.canvas.toDataURL('image/png');
    if (m !== 'shaded') { this.mode = m; this.apply(); }
    return url;
  }

  clear() {
    this.root.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry && m.geometry !== box && m.geometry !== crownGeo && m.geometry !== trunkGeo) m.geometry.dispose(); });
    this.root.clear();
    this.pickables = [];
  }

  /** what's under the pointer: a window or a door */
  pick(px: number, py: number): Picked | null {
    if (this.wired) return null;
    const r = this.canvas.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((px - r.left) / r.width) * 2 - 1, -((py - r.top) / r.height) * 2 + 1), this.cam);
    const hit = this.ray.intersectObjects(this.pickables, false)[0];
    if (!hit || hit.instanceId === undefined) return null;
    const m = (hit.object as THREE.InstancedMesh).userData.meta[hit.instanceId] as { o: Opening; floor: number; label: string } | undefined;
    if (!m) return null;
    const f = (v: number) => v.toFixed(2);
    return { tag: m.o.tag, label: m.label, size: `${f(m.o.w)} × ${f(m.o.h)} m${m.o.sill ? `, sill ${f(m.o.sill)} m` : ''}`, floor: m.floor, x: px - r.left, y: py - r.top };
  }

  /** what was last drawn (for the console and scripts) */
  last: ViewData | null = null;
  set(v: ViewData) {
    this.last = v;
    // (the formed buildings are kept aside, so clearing doesn't throw away the ones that haven't changed)
    for (const e of this.formed.values()) this.root.remove(e.built.group);
    this.clear();
    this.lamps = []; this.glows = []; this.panes = [];
    const seen = new Set<string>(), forms: Record<string, FormLayout> = {};
    const { r, d, plans, ds } = v;
    // (a face's bearing, degrees clockwise from north, from its outward normal: plan −z is north, turned by v.north)
    const bearing = (nx: number, nz: number) => bearingOf(nx, nz, v.north ?? 0);
    const fh = r.rules.floorH, mat = (color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...o });
    const mats = (ds: DesignSystem) => ({
      wall: mat(ds.facade.wall), accent: mat(ds.facade.accent, { roughness: 0.6 }), base: mat(ds.facade.base),
      frame: mat(ds.glazing.frame, { roughness: 0.45, metalness: 0.3 }), glass: this.paneMat(mat(ds.glazing.glass, { roughness: 0.08, metalness: 0.55, envMapIntensity: 1, emissive: '#ffcf8a', emissiveIntensity: 0 })),
      rail: ds.balcony.railing === 'glass' ? mat('#cfe3ee', { transparent: true, opacity: 0.38, roughness: 0.05 }) : ds.balcony.railing === 'ms' ? mat('#2b2b2e', { roughness: 0.5, metalness: 0.5 }) : mat(ds.facade.wall),
      slab: mat('#d8d4cc'), road: mat('#5b5e66', { roughness: 0.95 }), dp: mat('#e5484d', { transparent: true, opacity: 0.28 }), paving: mat('#d3cfc5'),
      shop: mat('#efe2c8', { emissive: '#ffd9a0', emissiveIntensity: 0.25 }), sign: mat('#1d1f24', { roughness: 0.4 }),
      core: mat('#a7a39b'), door: mat('#8a5a3b', { roughness: 0.6 }), partition: mat('#f5f3ef'),
      jaali: mat(ds.facade.accent, { alphaMap: jaaliTexture(), alphaTest: 0.5, side: THREE.DoubleSide }),
      // (the lights: fittings that glow after sunset, and the wash they throw on the wall; see setSun)
      lamp: this.lampMat(mat('#3a3a3c', { emissive: kelvinColour(lightingOf(ds).kelvin), emissiveIntensity: 0 })),
      glow: this.glowMat(new THREE.MeshBasicMaterial({ color: kelvinColour(lightingOf(ds).kelvin), transparent: true, opacity: 0, depthWrite: false })),
      green: mat('#56744a', { roughness: 0.95, flatShading: true }),
    });
    let M = mats(ds);
    const site = M;
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
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: '#3f3f46', dashSize: 1.2, gapSize: 0.8 }));
      line.computeLineDistances(); add(line);
    }

    // the site's own ground: internal roads, lots, paths, lawns and beds, as the ground map lays them; the trees
    const G = d.ground.map, flatMP = (m: MP, y: number, mt: THREE.Material) => { for (const t of triangles(m)) if (t.length >= 6) mesh(flat(t, y), mt, false); };
    // (the internal roads in the site kit's surface)
    const KIT = siteKitOf(ds);
    flatMP(G.road, 0.05, mat(SURFACE_COLOUR[KIT.road.surface], { roughness: KIT.road.surface === 'asphalt' ? 0.95 : 0.85 })); flatMP(G.lot, 0.05, mat('#8b8e95', { roughness: 0.95 })); flatMP(G.path, 0.06, M.paving);
    flatMP(G.lawn, 0.06, mat('#9fb889')); flatMP(G.bed, 0.07, mat('#6f8f5a'));
    const trunks = new Boxes(), crowns = new Boxes();
    const treeAt = (x: number, z: number, cr: number) => { const h = Math.max(3, cr * 1.6); trunks.add(x, h * 0.25, z, 1, 0, 0.3, h * 0.5, 0.3); crowns.add(x, h * 0.7, z, 1, 0, cr * 1.6, h * 0.6, cr * 1.6); };
    for (const t of G.plants) if (t.kind <= 1) treeAt(t.x, t.z, Math.max(1.5, t.r));
    for (const f of v.features ?? []) {
      const F = featureOf(f.kind);
      if (f.kind === 'tree' && f.pts.length >= 2) { treeAt(f.pts[0], f.pts[1], f.r ?? F.r); continue; }
      if (f.kind === 'pole' && f.pts.length >= 2) { trunks.add(f.pts[0], 4.5, f.pts[1], 1, 0, 0.35, 9, 0.35); continue; }
      const sh = shapeOf(f);
      const tone = f.kind === 'water' ? mat('#7fa6c4', { roughness: 0.2 }) : f.kind === 'structure' ? mat('#b9b2a6') : f.kind === 'nobuild' ? mat('#e5484d', { transparent: true, opacity: 0.16 }) : mat('#9a9a9a');
      if (f.kind === 'structure') { for (const t of triangles(sh)) if (t.length >= 6) mesh(prism(t, 0, 4), tone); }
      else flatMP(sh, 0.08, tone);
      if (f.kind !== 'nobuild') flatMP(keptOf(f), 0.075, mat('#e5484d', { transparent: true, opacity: 0.1 }));
    }
    // the design system's planting: an avenue or rows of trees, a hedge along the boundary
    const plant = plantingOf(r, landscapeOf(ds), d.buildings.flatMap((b) => b.quads));
    for (const [x, z] of plant.trees) treeAt(x, z, 2.4);
    const hedge = new Boxes();
    for (const [x0, z0, x1, z1] of plant.hedges) { const L = Math.hypot(x1 - x0, z1 - z0); if (L > 0.5) hedge.add((x0 + x1) / 2, 0.6, (z0 + z1) / 2, (x1 - x0) / L, (z1 - z0) / L, L, 1.2, 0.8); }
    add(hedge.mesh(mat('#5a7a48', { roughness: 0.95, flatShading: true }), true));

    let bands = new Boxes(), fins = new Boxes(), frames = new Boxes(), panes = new Boxes(), slabs = new Boxes(), rails = new Boxes(), cols = new Boxes(), parts = new Boxes(), doors = new Boxes(), parapets = new Boxes(), signs = new Boxes(), jaalis = new Boxes(), lamps = new Boxes(), glows = new Boxes(), greens = new Boxes();
    const flush = () => {
      for (const [B, m, cast] of [[bands, M.accent, true], [fins, M.accent, true], [frames, M.frame, true], [panes, M.glass, false], [slabs, M.slab, true], [rails, M.rail, false], [cols, M.base, true], [parts, M.partition, true], [doors, M.door, true], [parapets, M.wall, true], [signs, M.sign, true], [jaalis, M.jaali, false], [lamps, M.lamp, false], [glows, M.glow, false], [greens, M.green, true]] as [Boxes, THREE.Material, boolean][]) {
        const im = B.mesh(m, cast);
        if (!im) continue;
        add(im);
        if (B === frames || B === panes || B === doors) this.pickables.push(im);
      }
      bands = new Boxes(); fins = new Boxes(); frames = new Boxes(); panes = new Boxes(); slabs = new Boxes(); rails = new Boxes(); cols = new Boxes(); parts = new Boxes(); doors = new Boxes(); parapets = new Boxes(); signs = new Boxes(); jaalis = new Boxes(); lamps = new Boxes(); glows = new Boxes(); greens = new Boxes();
    };
    const under = d.under, y0 = under * fh;
    // shops at the front: the road-facing edges of each strip, and which flats are shops on the floors above
    const F = roadFrame(r);
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
    // ---- the site kit: the compound wall, its gates, the internal roads' kerbs, footpaths, poles and trees
    {
      const wm = mat(materialOf(KIT.wall.material).colour, { roughness: 0.85 }), walls = new Boxes(), metal = new Boxes(), cabin = new Boxes();
      const N = r.net; let ncx = 0, ncz = 0;
      for (let i = 0; i < N.length; i += 2) { ncx += N[i]; ncz += N[i + 1]; }
      ncx /= Math.max(1, N.length / 2); ncz /= Math.max(1, N.length / 2);
      const W = KIT.wall, built = d.buildings.flatMap((b) => b.quads), free = (x: number, z: number) => N.length >= 6 && pointIn(N, x, z, 0) && !built.some((q) => pointIn(q, x, z, 0.5));
      // (a run's inward normal: toward the plot's middle)
      const frame = (s: number[]) => { const L = Math.hypot(s[2] - s[0], s[3] - s[1]) || 1, ux = (s[2] - s[0]) / L, uz = (s[3] - s[1]) / L; let nx = -uz, nz = ux; if ((ncx - s[0]) * nx + (ncz - s[1]) * nz < 0) { nx = -nx; nz = -nz; } return { L, ux, uz, nx, nz }; };
      const solidRun = (x0: number, z0: number, x1: number, z1: number, h: number) => { const L = Math.hypot(x1 - x0, z1 - z0); if (L > 0.05) walls.add((x0 + x1) / 2, h / 2, (z0 + z1) / 2, (x1 - x0) / L, (z1 - z0) / L, L, h, 0.23); };
      if (W.kind !== 'none') for (const s of d.ground.wall) {
        const { L, ux, uz } = frame(s), mx = (s[0] + s[2]) / 2, mz = (s[1] + s[3]) / 2;
        if (L < 0.2) continue;
        if (W.kind === 'hedge') { greens.add(mx, W.h / 2, mz, ux, uz, L, W.h, 0.8); continue; }
        const solid = W.kind === 'solid' ? W.h : W.plinth;
        walls.add(mx, solid / 2, mz, ux, uz, L, solid, 0.23);
        if (W.coping) walls.add(mx, solid + 0.04, mz, ux, uz, L + 0.05, 0.08, 0.33);
        if (W.kind === 'railing' && W.h > solid + 0.1) {
          const rh = W.h - solid, n = Math.max(1, Math.floor(L / 0.18));
          metal.add(mx, W.h - 0.03, mz, ux, uz, L, 0.05, 0.05);
          for (let k = 0; k <= n; k++) { const t = -L / 2 + (L * k) / n; metal.add(mx + ux * t, solid + rh / 2, mz + uz * t, ux, uz, 0.025, rh, 0.025); }
        }
        if (W.piers > 0.5) { const n = Math.max(1, Math.round(L / W.piers)); for (let k = 0; k <= n; k++) { const t = -L / 2 + (L * k) / n; walls.add(mx + ux * t, (W.h + 0.15) / 2, mz + uz * t, ux, uz, 0.45, W.h + 0.15, 0.45); } }
      }
      // the gates: piers either side, set back (with the wall turned in to meet them) if asked, the leaves as styled,
      // an island between the way in and out, a pedestrian gate beside, the cabin
      const G0 = KIT.gate, gh = Math.max(1.8, W.kind === 'none' ? 1.8 : W.h), sb = Math.max(0, G0.setback);
      for (const s of d.ground.gates) {
        const { L, ux, uz, nx, nz } = frame(s), at = (t: number, inn: number) => [s[0] + ux * t + nx * inn, s[1] + uz * t + nz * inn] as const;
        if (sb > 0.2 && W.kind !== 'none' && W.kind !== 'hedge') for (const t of [0, L]) { const [ax, az] = at(t, 0), [bx, bz] = at(t, sb); solidRun(ax, az, bx, bz, Math.min(W.h, 1.5)); }
        for (const t of [0, L]) { const [px, pz] = at(t, sb); walls.add(px, (gh + 0.4) / 2, pz, ux, uz, 0.6, gh + 0.4, 0.6); }
        const split = G0.separate && L >= 7;
        if (split) { const [ix, iz] = at(L / 2, sb + 1.5); greens.add(ix, 0.3, iz, nx, nz, 4, 0.6, 1.2); walls.add(...((([x, z]) => [x, (gh + 0.4) / 2, z] as const)(at(L / 2, sb))), ux, uz, 0.5, gh + 0.4, 0.5); }
        const leaves = split ? [[0, L / 2], [L / 2, L]] : [[0, L]];
        for (const [a, c] of leaves) {
          const w = c - a;
          if (G0.style === 'sliding') { const [lx, lz] = at(c + w / 2, sb + 0.35); metal.add(lx, 0.15 + (gh - 0.2) / 2, lz, ux, uz, w, gh - 0.2, 0.06); }
          else if (G0.style === 'swing') for (const [t, side] of [[a, 1], [c, -1]] as const) { const [lx, lz] = at(t + side * 0.3, sb + w / 4); metal.add(lx, 0.15 + (gh - 0.2) / 2, lz, nx, nz, w / 2, gh - 0.2, 0.06); }
          else { const [bx, bz] = at(a + 0.4, sb); metal.add(bx, 0.6, bz, ux, uz, 0.25, 1.2, 0.25); const [rx, rz] = at((a + c) / 2, sb); metal.add(rx, 1.05, rz, ux, uz, w - 0.6, 0.08, 0.08); }
        }
        if (G0.pedestrian > 0.4) { const [qx, qz] = at(L + 0.6 + G0.pedestrian / 2, -0.02); metal.add(qx, 1.0, qz, ux, uz, G0.pedestrian, 1.9, 0.07); walls.add(...((([x, z]) => [x, (gh + 0.4) / 2, z] as const)(at(L + 0.6 + G0.pedestrian + 0.25, 0))), ux, uz, 0.5, gh + 0.4, 0.5); }
        if (G0.cabin) { const [cx, cz] = at(-2.2, sb + 2.0); if (free(cx, cz)) { cabin.add(cx, 1.35, cz, ux, uz, 2.4, 2.7, 2.4); panes.add(cx + nx * 1.22, 1.6, cz + nz * 1.22, ux, uz, 1.8, 0.9, 0.04); slabs.add(cx, 2.78, cz, ux, uz, 3.0, 0.16, 3.0); } }
      }
      add(walls.mesh(wm, true)); add(metal.mesh(mat('#2b2b2e', { roughness: 0.5, metalness: 0.5 }), true)); add(cabin.mesh(mat('#e9e6df'), true));
      // the internal roads: kerbs and footpaths along both sides, poles on one side, trees on the other
      const R = KIT.road, kerbs = new Boxes(), paths = new Boxes(), poles = new Boxes();
      const lines = [...d.ground.drive.map((pts) => ({ pts, w: d.ground.driveW })), ...d.ground.roads];
      for (const ln of lines) {
        let run = 0, nextPole = R.poles * 0.5, nextTree = 4;
        for (let i = 0; i + 3 < ln.pts.length; i += 2) {
          const x0 = ln.pts[i], z0 = ln.pts[i + 1], x1 = ln.pts[i + 2], z1 = ln.pts[i + 3], L = Math.hypot(x1 - x0, z1 - z0);
          if (L < 0.5) continue;
          const ux = (x1 - x0) / L, uz = (z1 - z0) / L, nx = -uz, nz = ux, hw = ln.w / 2;
          for (let t = 0; t < L; t += 2) {
            const piece = Math.min(2, L - t), cx = x0 + ux * (t + piece / 2), cz = z0 + uz * (t + piece / 2);
            for (const sgn of [-1, 1]) {
              const kx = cx + nx * sgn * (hw + 0.075), kz = cz + nz * sgn * (hw + 0.075);
              if (R.kerb && free(kx, kz)) kerbs.add(kx, 0.1, kz, ux, uz, piece, 0.15, 0.15);
              const fx = cx + nx * sgn * (hw + 0.15 + R.footpath / 2), fz = cz + nz * sgn * (hw + 0.15 + R.footpath / 2);
              if (R.footpath > 0.2 && free(fx, fz)) paths.add(fx, 0.08, fz, ux, uz, piece, 0.06, R.footpath);
            }
          }
          const side = hw + 0.4 + (R.footpath > 0.2 ? R.footpath : 0);
          while (R.poles > 1 && nextPole <= run + L) { const t = nextPole - run, px = x0 + ux * t + nx * side, pz = z0 + uz * t + nz * side; if (free(px, pz)) { poles.add(px, 3.75, pz, ux, uz, 0.14, 7.5, 0.14); poles.add(px - nx * 0.5, 7.5, pz - nz * 0.5, nx, nz, 1.0, 0.08, 0.08); lamps.add(px - nx * 0.9, 7.42, pz - nz * 0.9, ux, uz, 0.25, 0.06, 0.4); } nextPole += R.poles; }
          while (R.trees && nextTree <= run + L) { const t = nextTree - run, px = x0 + ux * t - nx * (side + 0.6), pz = z0 + uz * t - nz * (side + 0.6); if (free(px, pz)) treeAt(px, pz, 2.0); nextTree += 9; }
          run += L;
        }
      }
      add(kerbs.mesh(mat('#c9c6bf'), true)); add(paths.mesh(mat('#cfc9bd', { roughness: 0.9 }), false)); add(poles.mesh(mat('#3b3d42', { roughness: 0.5, metalness: 0.4 }), true));
    }
    add(trunks.mesh(mat('#6b5440'), true, trunkGeo)); add(crowns.mesh(mat('#5f7f4c', { roughness: 0.9, flatShading: true }), true, crownGeo));
    flush();
    d.buildings.forEach((b, bi) => {
      const plan = plans[bi];
      // (each building in its own design system: its materials, then its instanced meshes flushed at the end)
      const bds = v.dsOf?.(bi) ?? ds;
      M = bds === ds ? site : mats(bds);
      const ds_ = bds;
      // a formed building: its own meshes, rebuilt only when its layout or its look changes
      const form = (b.b as { form?: Form }).form;
      const FL = v.forms?.[b.b.id] ?? (form ? layForm(b.b, { floorH: bds.floorH, mix: b.b.mix ?? [0.3, 0.5, 0.2], sizes: DEFAULT_SITE.sizes }) : null);
      if (FL && FL.floors.length) {
        forms[b.b.id] = FL; seen.add(b.b.id);
        const lang = languageOf(bds), fr = frameOf(b.b);
        const look: Look = {
          wall: bds.facade.wall, glass: bds.glazing.glass, accent: bds.facade.accent, frame: bds.glazing.frame, slab: '#d8d4cc',
          roof: materialOf(finishOf(bds).roof).colour, base: bds.facade.base, core: '#a7a39b',
          skin: { ...lang.skin, ...(form?.skin ?? {}) }, roofKind: form?.roof ?? { kind: lang.roof, pitch: 20, overhang: 0.6, dir: 0, parapet: 1 }, round: lang.round,
        };
        // (the composition's zones and the climate's chhajja, on a formed building too)
        const fc = compositionOf(bds), fz = zonesOf(fc, FL.floors.length);
        if (fz.base || fz.top) look.zones = { base: fz.base, top: fz.top, baseColour: bds.facade[fc.base.tone], topColour: bds.facade[fc.top.tone] };
        const fcl = climateOf(bds);
        if (fcl.chhajja > 0.05) look.chhajja = fcl.chhajja;
        const key = JSON.stringify([look, v.xray, form?.shell ?? null, fr.u]);
        const old = this.formed.get(b.b.id);
        const hash = old && old.L === FL ? old.hash : layoutHash(FL);
        let e = old;
        if (!e || e.hash !== hash || e.key !== key) {
          if (old) disposeBuilt(old.built);
          e = { L: FL, hash, key, built: buildForm(FL, look, { xray: v.xray, frame: { u: fr.u, n: fr.n }, shell: form?.shell ?? null, env: this.env }) };
          this.formed.set(b.b.id, e);
        }
        e.L = FL;
        add(e.built.group);
        return;
      }
      const all = b.floors, show = v.xray === null ? all : Math.min(all, Math.max(1, v.xray));
      const top = y0 + (v.xray === null ? all : show - 1) * fh;
      // the composition: the base, middle and top, each zone in its tone; the faces in bays
      const comp = compositionOf(ds_), Z = zonesOf(comp, all), cl = climateOf(ds_);
      const toneM = (t: Tone) => (t === 'wall' ? M.wall : t === 'accent' ? M.accent : M.base);
      const yBase = Math.min(top, y0 + Z.base * fh), yTop = Math.max(yBase, Math.min(top, y0 + (all - Z.top) * fh));
      const faces = facadeBays(b.quads, comp.bay).filter((f) => !f.inner);
      // stilt / podium: columns round the edge, the cores carried down
      for (const q of b.quads) {
        if (under) for (let i = 0; i < q.length; i += 2) {
          const j = (i + 2) % q.length, L = Math.hypot(q[j] - q[i], q[j + 1] - q[i + 1]), n = Math.max(1, Math.round(L / 6));
          for (let k = 0; k < n; k++) cols.add(q[i] + ((q[j] - q[i]) * k) / n, y0 / 2, q[i + 1] + ((q[j + 1] - q[i + 1]) * k) / n, 1, 0, 0.5, y0, 0.5);
        }
        if (yBase > y0) mesh(prism(q, y0, yBase), toneM(comp.base.tone));
        if (yTop > yBase) mesh(prism(q, yBase, yTop), M.wall);
        if (top > yTop) mesh(prism(q, yTop, top), toneM(comp.top.tone));
      }
      const along = (f: (typeof faces)[number], s: number, out: number) => [f.ax + f.ux * s + f.nx * out, f.az + f.uz * s + f.nz * out] as const;
      // a string course over the base and under the top
      for (const f of faces) {
        const [mx, mz] = along(f, f.L / 2, 0);
        if (Z.base && yBase < top) bands.add(mx, yBase, mz, f.ux, f.uz, f.L + 0.4, 0.45, 0.4);
        if (Z.top && yTop < top) bands.add(mx, yTop, mz, f.ux, f.uz, f.L + 0.3, 0.3, 0.3);
      }
      // the bay lines as piers through the middle (not through a window that spans two bays)
      if (comp.piers && comp.rhythm !== 'free' && yTop > yBase) for (const f of faces) for (let k = 1; k < f.n; k++) {
        const s = k * f.bw;
        const blocked = plan.openings.some((o) => o.outside && Math.abs((o.x - f.ax) * -f.uz + (o.z - f.az) * f.ux) < 0.15 && Math.abs((o.x - f.ax) * f.ux + (o.z - f.az) * f.uz - s) < o.w / 2 + 0.1);
        if (blocked) continue;
        const [x, z] = along(f, s, 0.08);
        fins.add(x, (yBase + yTop) / 2, z, f.ux, f.uz, 0.35, yTop - yBase, 0.16);
      }
      // the corners: a pier in the accent, or glass wrapping round (the end bays are kept free of windows for it)
      if (comp.corner === 'accent' && top > y0) for (const f of faces) {
        const [x, z] = along(f, f.L, 0);
        fins.add(x - f.ux * 0.3 - f.nx * 0.3, (y0 + top) / 2, z - f.uz * 0.3 - f.nz * 0.3, f.ux, f.uz, 0.7, top - y0, 0.7);
      }
      const corners = comp.corner === 'glazed' && comp.rhythm !== 'free' ? faces.filter((f) => f.n >= 3) : [];
      // the entrance: on the face that looks most at the road, in line with the core, a canopy or a portal
      const facing = faces.filter((f) => f.L >= 7).sort((a, c) => (c.nx * -F.vx + c.nz * -F.vz) - (a.nx * -F.vx + a.nz * -F.vz))[0];
      const front = comp.entrance === 'none' ? undefined : facing;
      // where the building's name goes: over the entrance (the canopy's edge, the portal's lintel), else on the wall
      let signAt: { x: number; z: number; y: number; out: number } | null = null;
      if (facing) { const [sx, sz] = along(facing, facing.L / 2, 0); signAt = { x: sx, z: sz, y: 3.2, out: 0.08 }; }
      if (front) {
        const core = b.cores[0], [kx, kz] = core ? [core.filter((_, i) => i % 2 === 0).reduce((a, c) => a + c, 0) / (core.length / 2), core.filter((_, i) => i % 2 === 1).reduce((a, c) => a + c, 0) / (core.length / 2)] : along(front, front.L / 2, 0);
        const s = Math.max(3.2, Math.min(front.L - 3.2, (kx - front.ax) * front.ux + (kz - front.az) * front.uz));
        const he = under ? Math.max(2.8, y0 - 0.25) : Math.min(4.2, Math.max(3.2, fh * Math.max(1, Z.base) - 0.3));
        const [x, z] = along(front, s, 0), at = (out: number, t = 0) => [x + front.nx * out + front.ux * t, z + front.nz * out + front.uz * t] as const;
        // the lobby's glass doors
        const dh = Math.min(2.7, he - 0.3), [gx, gz] = at(0.08);
        frames.add(gx, dh / 2 + 0.05, gz, front.ux, front.uz, 3.4, dh + 0.1, 0.12);
        panes.add(gx + front.nx * 0.05, dh / 2 + 0.05, gz + front.nz * 0.05, front.ux, front.uz, 3.2, dh - 0.06, 0.04);
        signAt = { x, z, y: he + 0.12, out: 2.95 };
        if (comp.entrance === 'canopy') { const [cx2, cz2] = at(1.5); slabs.add(cx2, he, cz2, front.ux, front.uz, 5.4, 0.22, 3.0); }
        else {
          // a portal: a frame in the accent standing out from the face, as tall as the base
          const hp = Math.max(he + 0.6, Math.min(7.5, y0 + Z.base * fh)), dep = 2.4;
          for (const sgn of [-1, 1]) { const [px, pz] = at(dep - 0.3, sgn * 2.9); fins.add(px, hp / 2, pz, front.ux, front.uz, 0.6, hp, 0.6); }
          const [lx, lz] = at(dep / 2);
          fins.add(lx, hp - 0.3, lz, front.ux, front.uz, 6.4, 0.6, dep);
          signAt = { x, z, y: hp, out: dep + 0.02 };
        }
      }
      // the sign: letters or a panel over the entrance, or a blade standing off the front's end; lit after dark
      const sg = signageOf(ds_);
      if (facing && signAt && sg.kind !== 'none') {
        const sw = Math.min(facing.L * 0.6, sg.h * 8), cx = signAt.x + facing.nx * signAt.out, cz = signAt.z + facing.nz * signAt.out;
        if (sg.kind === 'letters') {
          for (let k = 0; k < 7; k++) signs.add(cx + facing.ux * (k - 3) * sw / 7, signAt.y + sg.h / 2, cz + facing.uz * (k - 3) * sw / 7, facing.ux, facing.uz, sw / 7 * 0.72, sg.h, 0.08);
          lamps.add(cx + facing.nx * 0.05, signAt.y + 0.02, cz + facing.nz * 0.05, facing.ux, facing.uz, sw, 0.04, 0.04);
        } else if (sg.kind === 'panel') {
          signs.add(cx, signAt.y + sg.h / 2, cz, facing.ux, facing.uz, sw, sg.h, 0.1);
          lamps.add(cx + facing.nx * 0.06, signAt.y + sg.h / 2, cz + facing.nz * 0.06, facing.ux, facing.uz, sw - 0.2, sg.h - 0.2, 0.02);
        } else {
          const [bx, bz] = along(facing, facing.L - 1.2, 0.45);
          signs.add(bx, 3.0 + sg.h * 2, bz, facing.nx, facing.nz, 0.9, sg.h * 4, 0.12);
          lamps.add(bx, 3.0 + sg.h * 2, bz, facing.nx, facing.nz, 0.7, sg.h * 4 - 0.2, 0.14);
        }
      }
      // the facade lighting: a wash on the base from the ground, grazing light up the piers and corners, or lines
      const li = lightingOf(ds_);
      if (top > y0) for (const f of faces) {
        if (li.facade === 'wash') {
          const yw = Math.min(top, Math.max(yBase, y0 + fh * 1.5));
          const [x, z] = along(f, f.L / 2, 0.35); lamps.add(x, 0.12, z, f.ux, f.uz, f.L - 0.6, 0.12, 0.2);
          const [gx2, gz2] = along(f, f.L / 2, 0.03); glows.add(gx2, yw / 2, gz2, f.ux, f.uz, f.L, yw, 0.02);
        } else if (li.facade === 'grazing') {
          const lines = comp.piers && comp.rhythm !== 'free' ? Array.from({ length: f.n + 1 }, (_, k) => k * f.bw) : [0.4, f.L - 0.4];
          for (const t of lines) {
            const [x, z] = along(f, t, 0.3); lamps.add(x, y0 + 0.1, z, f.ux, f.uz, 0.3, 0.12, 0.3);
            const [gx2, gz2] = along(f, t, 0.03); glows.add(gx2, (y0 + top) / 2, gz2, f.ux, f.uz, 0.9, top - y0, 0.02);
          }
        } else if (li.facade === 'lines') {
          const ys = [...(Z.base ? [yBase + 0.25] : []), ...(Z.top ? [yTop + 0.16] : []), top + 1.02, ...(ds_.facade.bands && !Z.base && !Z.top ? Array.from({ length: all }, (_, k) => y0 + k * fh + 0.12) : [])];
          for (const yl of ys) { const [x, z] = along(f, f.L / 2, 0.16); lamps.add(x, yl, z, f.ux, f.uz, f.L, 0.05, 0.05); }
        }
      }
      for (const c of b.cores) mesh(prism(c, 0, (v.xray === null ? y0 + all * fh + 2.4 : top + fh)), M.core);
      // floors: bands on the slab edges, the openings
      const floorsShown = v.xray === null ? all : show;
      for (let f = 0; f < floorsShown; f++) {
        const fy = y0 + f * fh;
        if (ds_.facade.bands) for (const q of b.quads) for (let i = 0; i < q.length; i += 2) {
          const j = (i + 2) % q.length, L = Math.hypot(q[j] - q[i], q[j + 1] - q[i + 1]);
          if (L < 0.5) continue;
          const ux = (q[j] - q[i]) / L, uz = (q[j + 1] - q[i + 1]) / L;
          bands.add((q[i] + q[j]) / 2, fy, (q[i + 1] + q[j + 1]) / 2, ux, uz, L + 0.24, 0.22, 0.24);
        }
        const cut = v.xray !== null && f === show - 1;
        const shopHere = !!v.shops && f < v.shops.upperOf[bi], gone = shopHere ? v.shops!.removed.get(bi) : undefined;
        if (shopHere && !cut) for (const st of v.shops!.strips) if (st.b === bi) for (const e of shopFronts(st.ring)) glazeRun(e, fy, fh, false);
        if (!cut && !shopHere && f >= Z.base) for (const c of corners) for (const s of [c.bw / 2, c.L - c.bw / 2]) {
          const gw = c.bw - 0.2, gh = fh - 0.45, [x, z] = along(c, s, 0.07);
          frames.add(x, fy + 0.15 + gh / 2, z, c.ux, c.uz, gw + 0.1, gh + 0.1, 0.1);
          panes.add(x + c.nx * 0.04, fy + 0.15 + gh / 2, z + c.nz * 0.04, c.ux, c.uz, gw - 0.04, gh - 0.04, 0.04);
        }
        for (const o of plan.openings) {
          if (gone?.has(o.unit)) continue;
          if (!o.outside && !cut) continue;
          const s = o.tag === 'SD' || o.tag === 'D1' ? ds_.doors[o.tag] : ds_.windows[o.tag];
          const cy = fy + o.sill + o.h / 2, off = o.outside ? 0.07 : 0;
          const meta = { o, floor: f + 1, label: `${o.tag} · ${s.label}` };
          // (the cut floor is drawn as a plan: walls to 1.5 m, the glass only below that)
          if (cut && o.outside) { const t = Math.min(CUT, o.sill + o.h); if (t > o.sill + 0.05) panes.add(o.x, fy + (o.sill + t) / 2, o.z, o.ux, o.uz, o.w, t - o.sill, 0.04, meta); continue; }
          // (the leaf open into the flat, hinged at one jamb)
          if (o.tag === 'D1') { doors.add(o.x - o.ux * o.w / 2 - o.nx * o.w / 2, fy + Math.min(o.h, CUT + 0.3) / 2, o.z - o.uz * o.w / 2 - o.nz * o.w / 2, o.nx, o.nz, o.w, Math.min(o.h, CUT + 0.3), 0.05, meta); continue; }
          frames.add(o.x + o.nx * off, cy, o.z + o.nz * off, o.ux, o.uz, o.w + 0.12, o.h + 0.12, 0.1, meta);
          panes.add(o.x + o.nx * (off + 0.04), cy, o.z + o.nz * (off + 0.04), o.ux, o.uz, o.w - 0.06, o.h - 0.06, 0.04, meta);
          // a deep reveal: the surround stands out from the wall (not round a balcony's door, which has the balcony)
          const rv = comp.reveal;
          if (rv > 0.01 && !(o.tag === 'SD' && ds_.balcony.kind !== 'none' && ds_.balcony.kind !== 'french')) {
            const hx = o.x + o.nx * rv / 2, hz = o.z + o.nz * rv / 2, sw = o.w + 0.36;
            parapets.add(hx, cy + o.h / 2 + 0.08, hz, o.ux, o.uz, sw, 0.16, rv);
            parapets.add(hx, cy - o.h / 2 - 0.08, hz, o.ux, o.uz, sw, 0.16, rv);
            for (const sgn of [-1, 1]) parapets.add(hx + o.ux * sgn * (o.w / 2 + 0.09), cy, hz + o.uz * sgn * (o.w / 2 + 0.09), o.ux, o.uz, 0.18, o.h, rv);
          }
          // the climate: a chhajja over the window (not over a balcony's door: the balcony above shades it), as deep as
          // the face's sun asks; a jaali in front of the ventilators (and the smaller windows)
          const shaded = o.tag === 'SD' && (ds_.balcony.kind === 'cantilever' || ds_.balcony.kind === 'recessed');
          if (cl.chhajja > 0.05 && !shaded) {
            const dep = chhajjaOn(cl, bearing(o.nx, o.nz)), y = cy + o.h / 2 + (rv > 0.01 ? 0.24 : 0.12);
            parapets.add(o.x + o.nx * dep / 2, y, o.z + o.nz * dep / 2, o.ux, o.uz, o.w + 0.6, 0.1, dep);
          }
          if (o.tag === 'V1' ? cl.jaali !== 'none' : o.tag === 'W2' && cl.jaali === 'windows') jaalis.add(o.x + o.nx * 0.2, cy, o.z + o.nz * 0.2, o.ux, o.uz, o.w + 0.2, o.h + 0.2, 0.05);
          if (ds_.facade.fins && (o.tag === 'W1' || o.tag === 'SD')) for (const sgn of [-1, 1]) {
            const fx = o.x + o.ux * sgn * (o.w / 2 + 0.25), fz = o.z + o.uz * sgn * (o.w / 2 + 0.25);
            fins.add(fx + o.nx * 0.3, fy + fh / 2, fz + o.nz * 0.3, o.nx, o.nz, 0.6, fh, 0.12);
          }
          if (o.tag === 'SD' && ds_.balcony.kind === 'cantilever' && landscapeOf(ds).planters) greens.add(o.x + o.nx * (ds_.balcony.depth - 0.3), fy + 0.35, o.z + o.nz * (ds_.balcony.depth - 0.3), o.ux, o.uz, Math.min(1.6, o.w), 0.5, 0.35);
          if (o.tag === 'SD' && ds_.balcony.kind !== 'none') {
            const dep = ds_.balcony.kind === 'french' ? 0.3 : ds_.balcony.depth, w = o.w + 0.9;
            const out = ds_.balcony.kind === 'recessed' ? 0.12 : dep;
            if (ds_.balcony.kind === 'cantilever') slabs.add(o.x + o.nx * dep / 2, fy - 0.08, o.z + o.nz * dep / 2, o.ux, o.uz, w, 0.16, dep);
            if (ds_.balcony.kind === 'recessed') slabs.add(o.x + o.nx * 0.06, fy + fh - 0.25, o.z + o.nz * 0.06, o.ux, o.uz, w, 0.5, 0.12);
            rails.add(o.x + o.nx * out, fy + 0.55, o.z + o.nz * out, o.ux, o.uz, w, 1.1, 0.05);
            if (ds_.balcony.kind === 'cantilever') for (const sgn of [-1, 1]) rails.add(o.x + o.ux * sgn * w / 2 + o.nx * dep / 2, fy + 0.55, o.z + o.uz * sgn * w / 2 + o.nz * dep / 2, o.nx, o.nz, dep, 1.1, 0.05);
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
        // the crown: a deep cornice, or a pergola's frame over the terrace
        const crown = all >= ZONED_FROM ? comp.top.crown : 'parapet';
        if (crown === 'cornice') for (const f of faces) { const [x, z] = along(f, f.L / 2, 0.1); bands.add(x, ry + 0.75, z, f.ux, f.uz, f.L + 1.0, 0.5, 1.0); }
        if (crown === 'pergola') for (const q of b.quads) {
          if (q.length !== 8) continue;
          const [cx, cz] = [(q[0] + q[2] + q[4] + q[6]) / 4, (q[1] + q[3] + q[5] + q[7]) / 4];
          const P = [0, 1, 2, 3].map((k) => { const x = q[2 * k], z = q[2 * k + 1], d = Math.hypot(cx - x, cz - z) || 1; return [x + (cx - x) * 0.6 / d, z + (cz - z) * 0.6 / d]; });
          const ph = 3.0, yb = ry + ph;
          for (const [x, z] of P) fins.add(x, ry + ph / 2, z, 1, 0, 0.3, ph, 0.3);
          const beam = (a: number[], c: number[], y: number, t: number) => { const L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L > 0.1) fins.add((a[0] + c[0]) / 2, y, (a[1] + c[1]) / 2, (c[0] - a[0]) / L, (c[1] - a[1]) / L, L, t, t); };
          for (let k = 0; k < 4; k++) beam(P[k], P[(k + 1) % 4], yb, 0.3);
          // slats across the longer way, a metre apart
          const long = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]) >= Math.hypot(P[3][0] - P[0][0], P[3][1] - P[0][1]);
          const [A, B, C, D] = long ? [P[0], P[1], P[2], P[3]] : [P[1], P[2], P[3], P[0]];
          const n = Math.max(2, Math.round(Math.hypot(B[0] - A[0], B[1] - A[1]) / 1.0));
          const lerp = (p: number[], r: number[], t: number) => [p[0] + (r[0] - p[0]) * t, p[1] + (r[1] - p[1]) * t];
          for (let k = 1; k < n; k++) beam(lerp(A, B, k / n), lerp(D, C, k / n), yb + 0.2, 0.12);
        }
      } else {
        // the cut floor: its slab, the flats tinted by type, the walls (dolls'-house height), the entrance doors
        const fy = top;
        for (const q of b.quads) mesh(prism(q, fy - 0.15, fy + 0.02), M.slab);
        const rooms = v.rooms?.[bi];
        if (rooms && v.roomColor) {
          // rooms tinted by kind, their partitions to the cut height
          const rm = new Map<string, THREE.Material>();
          rooms.forEach((fr) => {
            for (const rr of fr.rooms) { if (rr.ring.length < 6) continue; let m = rm.get(rr.kind); if (!m) { m = mat(v.roomColor![rr.kind] ?? '#ccc', { transparent: true, opacity: 0.7 }); rm.set(rr.kind, m); } mesh(flat(rr.ring, fy + 0.05), m, false); }
            for (const w of fr.walls) { const L = Math.hypot(w[2] - w[0], w[3] - w[1]); if (L > 0.05) parts.add((w[0] + w[2]) / 2, fy + CUT / 2, (w[1] + w[3]) / 2, (w[2] - w[0]) / L, (w[3] - w[1]) / L, L, CUT, 0.1); }
          });
        } else for (const u of b.units) { const g = flat(u.ring, fy + 0.05); mesh(g, mat(UNIT_COLOR[u.t], { transparent: true, opacity: 0.55 }), false); }
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
      flush();
    });

    // the formed buildings no longer in the scheme go; the many small parts stop casting shadows when there are lots
    for (const [id, e] of this.formed) if (!seen.has(id)) { disposeBuilt(e.built); this.formed.delete(id); }
    const many = [...this.formed.values()].reduce((s, e) => s + e.built.instances, 0);
    for (const e of this.formed.values()) for (const p of e.built.parts) p.castShadow = many < 60000;

    // frame the camera on the plot the first time (and when its size changes)
    const key = `${minX}|${maxX}|${minZ}|${maxZ}`;
    this.box = { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, s: Math.max(maxX - minX, maxZ - minZ, 30), h: d.height || 30 };
    if (key !== this.fitted) {
      this.fitted = key;
      const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, s = Math.max(maxX - minX, maxZ - minZ, 30), h = d.height || 30;
      this.look('fit');
      this.sun.target.position.set(cx, 0, cz);
      const sc = this.sun.shadow.camera as THREE.OrthographicCamera, R = s * 1.2 + h * 0.6;
      sc.left = -R; sc.right = R; sc.top = R; sc.bottom = -R; sc.near = 1; sc.far = 800; sc.updateProjectionMatrix();
      this.sun.position.set(cx - 120, 220, cz - 90);
    }
    this.wire.set({ r, d, roads: v.roads, shops: v.shops, features: v.features, levels: v.levels, north: v.north, sel: v.sel, forms, skinOf: (id) => {
      const bi = d.buildings.findIndex((x) => x.b.id === id), bds = (bi >= 0 ? v.dsOf?.(bi) : undefined) ?? ds, f = d.buildings[bi]?.b as { form?: Form } | undefined;
      const lang = languageOf(bds);
      return { skin: { ...lang.skin, ...(f?.form?.skin ?? {}) }, roof: f?.form?.roof ?? { kind: lang.roof, pitch: 20, overhang: 0.6, dir: 0, parapet: 1 }, shell: f?.form?.shell ?? null };
    } });
    this.north = v.north ?? 0;
    this.xrayOn = v.xray !== null;
    this.apply();
  }
}
