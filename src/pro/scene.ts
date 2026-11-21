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
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Pipeline } from './render/pipeline';
import { SkyLight, sunColour } from './render/sky';
import { fitShadow } from './render/shadows';
import { albedo, BEVEL, CHAMFER_BOX, Materials } from './render/pbr';
import { detailOf, loadScans } from './render/textures';
import { FrameWatch, guessTier, saveTier, savedTier, SPEC, type Tier } from './render/quality';
import { cutFace, flat, GeoBuf, prism, type Hole } from './render/geo';
import { buildingOutline, crossings, endExt } from './render/outline';
import { inside as inMP, union as unionMP, fromFlat as mpOf, offset as offsetMP } from '../doc/ground';
import { GLASS, litShare, withRooms } from './render/glass';
import { carMeshes, gridIn, loadModels, markings, modelMeshes, peopleMeshes, treeMeshes, type ModelPart, type Tree } from './render/entourage';
import { pathSky, pixelsToPng } from './render/still';
import { neighbourMesh, neighbours } from './render/context';
import { PerfOverlay, type BenchResult } from './render/perf';
import type { Material as LibMaterial } from './materials';
import type { PlotReport } from '../doc/plot';
import { UNIT_COLOR, type SiteReport } from '../doc/site';
import { bearingOf, chhajjaOn, climateOf, kelvinColour, siteKitOf, SURFACE_COLOUR, landscapeOf, lightingOf, signageOf, compositionOf, finishOf, languageOf, zonesOf, ZONED_FROM, type DesignSystem, type Tone } from './design';
import { materialOf } from './materials';
import { DEFAULT_SITE } from '../doc/site';
import { frameOf, layForm, type Form, type FormLayout } from './form';
import { buildForm, disposeBuilt, layoutHash, setMaterialResolver, type Built, type Look } from './form/mesh';
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
  /** where the plot is ([lat, lon] of its middle) and its authority: the neighbours drawn round it (./render/context.ts) */
  at?: [number, number] | null; city?: string;
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

/** an instanced mesh as one plain geometry: each instance placed, its colour (and the geometry's own) baked into vertex
 *  colours: for the path tracer, which reads plain meshes */
function bakeInstances(im: THREE.InstancedMesh): THREE.BufferGeometry | null {
  const base = (im.geometry.index ? im.geometry.toNonIndexed() : im.geometry.clone());
  for (const k of Object.keys(base.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') base.deleteAttribute(k);
  if (!base.attributes.normal) base.computeVertexNormals();
  const n = base.attributes.position.count, own = base.attributes.color as THREE.BufferAttribute | undefined;
  const out: THREE.BufferGeometry[] = [], m = new THREE.Matrix4(), c = new THREE.Color();
  im.updateMatrixWorld();
  for (let i = 0; i < im.count; i++) {
    const g = base.clone();
    im.getMatrixAt(i, m); g.applyMatrix4(m.premultiply(im.matrixWorld));
    if (im.instanceColor) im.getColorAt(i, c); else c.setRGB(1, 1, 1);
    const col = new Float32Array(n * 3);
    for (let v = 0; v < n; v++) { col[v * 3] = c.r * (own ? own.getX(v) : 1); col[v * 3 + 1] = c.g * (own ? own.getY(v) : 1); col[v * 3 + 2] = c.b * (own ? own.getZ(v) : 1); }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.push(g);
  }
  base.dispose();
  const merged = out.length ? mergeGeometries(out) : null;
  out.forEach((g) => g.dispose());
  return merged;
}
/** a baked geometry split by colour, one plain geometry per colour (the path tracer ignores vertex colours) */
function splitByColour(g: THREE.BufferGeometry): { colour: THREE.Color; geo: THREE.BufferGeometry }[] {
  const P = g.attributes.position as THREE.BufferAttribute, N = g.attributes.normal as THREE.BufferAttribute, C = g.attributes.color as THREE.BufferAttribute;
  const groups = new Map<string, { colour: THREE.Color; p: number[]; n: number[] }>();
  for (let t = 0; t < P.count; t += 3) {
    const col = new THREE.Color(C.getX(t), C.getY(t), C.getZ(t)), k = col.getHexString();
    let gr = groups.get(k); if (!gr) { gr = { colour: col, p: [], n: [] }; groups.set(k, gr); }
    for (let v = t; v < t + 3; v++) { gr.p.push(P.getX(v), P.getY(v), P.getZ(v)); gr.n.push(N.getX(v), N.getY(v), N.getZ(v)); }
  }
  return [...groups.values()].map((gr) => { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(gr.p, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(gr.n, 3)); return { colour: gr.colour, geo }; });
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
  private fog = new THREE.FogExp2('#dde4ec', 0.0011);
  private sky = new THREE.Color('#e4e4e2');
  private paper = new THREE.Color('#fafaf9');
  private env: THREE.Texture | null = null;
  /** the formed buildings drawn, by building id */
  private formed = new Map<string, FormEntry>();
  /** the shaded view's materials, kept across rebuilds (./render/pbr.ts) */
  lib = new Materials();
  private pipe!: Pipeline;
  private skyL: SkyLight;
  private hemi = new THREE.HemisphereLight('#f4f7fb', '#b9ae9a', 0);
  /** the quality tier (./render/quality.ts) */
  tier: Exclude<Tier, 'still'> = 'standard';
  /** told when the tier steps down by itself */
  onTier?: (t: Exclude<Tier, 'still'>) => void;
  private watch: FrameWatch;
  private restT = 0;
  private perf: PerfOverlay | null = null;
  /** the straight buildings' detail meshes (frames, railings, sills, screens): hidden when a building is small on screen */
  private slabLod: { centre: THREE.Vector3; radius: number; detail: THREE.Object3D[] }[] = [];
  private sunDir = new THREE.Vector3(-0.45, 0.75, -0.35).normalize();
  private shadowBox = new THREE.Box3();
  /** the neighbouring buildings (kept across rebuilds; made again when the plot moves) */
  private ctx = new THREE.Group();
  private ctxKey = '';
  /** the CC0 entourage models, once fetched (tools/render/models.mjs): motorcycles, trucks, people */
  private models = new Map<string, ModelPart[]>();

  constructor(public canvas: HTMLCanvasElement) {
    // (the canvas keeps MSAA for the draft tier and the wireframe; the pipeline does its own anti-aliasing)
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    this.tier = savedTier() ?? guessTier(this.renderer.getContext());
    this.renderer.setPixelRatio(Math.min(SPEC[this.tier].dpr, window.devicePixelRatio || 1));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.info.autoReset = false;
    this.scene.fog = this.fog;
    this.scene.add(this.hemi);
    // (the sky, and the light it gives every material: ./render/sky.ts)
    this.skyL = new SkyLight(this.renderer);
    this.scene.add(this.skyL.sky);
    this.lib.tex = SPEC[this.tier].tex;
    BEVEL.value = this.tier === 'high' ? 0.025 : 0;
    // (the formed buildings' walls, metal and glass from the same library as the straight ones)
    setMaterialResolver((kind, colour, id) => kind === 'solid' ? this.lib.surface(id, colour) : kind === 'glass' ? this.glassOf(colour) : kind === 'spandrel' ? this.lib.glass(colour, { roughness: 0.18, color: albedo(colour).multiplyScalar(0.55) }) : kind === 'metal' ? this.lib.surface(undefined, colour, { roughness: 0.4, metalness: 0.75 }) : null);
    this.sun.position.set(-120, 180, -90);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(SPEC[this.tier].shadow, SPEC[this.tier].shadow);
    this.sun.shadow.radius = 2.5;
    this.sun.shadow.bias = -0.0001;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun, this.sun.target, this.root, this.ctx);
    // (the ground: a disc fading into the fog, a fine earthy grain in metres)
    const gg = new THREE.CircleGeometry(900, 72), gp = gg.attributes.position as THREE.BufferAttribute, guv = new Float32Array(gp.count * 2);
    for (let i = 0; i < gp.count; i++) { guv[i * 2] = gp.getX(i); guv[i * 2 + 1] = -gp.getY(i); }
    gg.setAttribute('uv', new THREE.BufferAttribute(guv, 2));
    const gd = detailOf({ id: 'ground-earth', category: 'stone', name: 'Ground', colour: '#c4bdab', finish: 'textured', rate: 0, pattern: 'plain' } as LibMaterial, SPEC[this.tier].tex);
    const ground = new THREE.Mesh(gg, new THREE.MeshStandardMaterial({ color: albedo('#c4bdab'), roughness: 1, map: gd?.map ?? null, normalMap: gd?.normal ?? null }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true;
    this.ground = ground;
    this.over.renderOrder = 10;
    this.scene.add(ground, this.wire.group, this.over);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.03;
    this.controls.addEventListener('change', () => this.frame());
    const pr = canvas.parentElement?.getBoundingClientRect();
    this.pipe = new Pipeline(this.renderer, this.scene, this.camera, pr?.width || 800, pr?.height || 600);
    this.pipe.setTier(this.tier);
    this.watch = new FrameWatch(() => SPEC[this.tier].budgetMs, () => this.stepDown());
    if (typeof location !== 'undefined' && /[?&]perf\b/.test(location.search) && canvas.parentElement) this.perf = new PerfOverlay(canvas.parentElement);
    this.resize();
    this.setSun(null);
    // (the scanned textures, when the texture tool has fetched them: the materials made again with them)
    void loadModels(import.meta.env.BASE_URL).then((m) => { if (m.size) { this.models = m; if (this.last) this.set(this.last); } });
    void loadScans(import.meta.env.BASE_URL, this.renderer).then((ok) => { if (ok && this.lib.tex) { this.lib.reset(); for (const e of this.formed.values()) disposeBuilt(e.built); this.formed.clear(); if (this.last) this.set(this.last); } });
  }

  /** the quality tier: textures, shadows, the pipeline (kept in this browser) */
  setTier(t: Exclude<Tier, 'still'>, keep = true) {
    if (t === this.tier) return;
    this.tier = t; if (keep) saveTier(t);
    this.renderer.setPixelRatio(Math.min(SPEC[t].dpr, window.devicePixelRatio || 1));
    this.pipe.setTier(t);
    this.lib.tex = SPEC[t].tex; this.lib.reset();
    BEVEL.value = t === 'high' ? 0.025 : 0;
    GLASS.uInterior.value = SPEC[t].interiors ? 1 : 0;
    // (the materials and the formed buildings made again at the new detail)
    for (const e of this.formed.values()) disposeBuilt(e.built);
    this.formed.clear();
    if (this.last) this.set(this.last);
    this.resize(); this.fitSun();
  }
  private stepDown() {
    const next = this.tier === 'high' ? 'standard' : this.tier === 'standard' ? 'draft' : null;
    if (next) { this.setTier(next, false); this.onTier?.(next); }
  }
  /** glass, with the rooms behind it (./render/glass.ts), registered for the night */
  private glassOf(colour: string) {
    const m = this.lib.glass(colour);
    if (!m.userData.rooms) { withRooms(m); m.userData.rooms = true; }
    return m;
  }

  resize() {
    const r = this.canvas.parentElement!.getBoundingClientRect();
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / Math.max(1, r.height);
    this.camera.updateProjectionMatrix();
    this.fitOrtho();
    this.pipe?.setSize(r.width, r.height);
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
      const moving = this.controls.update();
      if (moving) this.frame();
      // (the wireframe keeps drawing while edges fade in or out)
      if (this.wired && this.wire.write()) this.frame();
      if (!this.wired) this.lod();
      this.compass();
      this.updateNear();
      this.draw(false);
      if (moving && this.piped) this.watch.tick(performance.now()); else this.watch.rest();
      // (on the high tier, once the camera rests, the settled image: supersampled)
      clearTimeout(this.restT);
      if (this.piped && this.tier === 'high') this.restT = window.setTimeout(() => this.draw(true), 320);
    });
  }
  /** through the pipeline (shaded, in 3D, not the draft tier) or straight to the canvas */
  private get piped() { return !this.wired && !this.plan && SPEC[this.tier].pipeline; }
  private draw(rest: boolean) {
    this.renderer.info.reset();
    if (this.piped) { this.pipe.setCamera(this.cam); this.pipe.render(rest); } else this.renderer.render(this.scene, this.cam);
    this.perf?.update(this.renderer, this.tier);
  }
  /** the near plane follows the distance, so depth (and the ambient occlusion) stays precise */
  private updateNear() {
    if (this.plan) return;
    const n = Math.max(0.2, this.camera.position.distanceTo(this.controls.target) * 0.002);
    if (Math.abs(n - this.camera.near) > 0.05) { this.camera.near = n; this.camera.updateProjectionMatrix(); }
  }
  dispose() {
    cancelAnimationFrame(this.raf); this.clear();
    for (const e of this.formed.values()) disposeBuilt(e.built);
    this.formed.clear(); this.env?.dispose();
    clearTimeout(this.restT); this.pipe.dispose(); this.skyL.dispose(); this.lib.dispose(); this.perf?.dispose();
    setMaterialResolver(null);
    this.wire.dispose(); this.controls.dispose(); this.renderer.dispose();
  }

  /** The formed buildings' level of detail: each one's fins and patterns drawn in full when it's big on screen,
   *  every third when smaller, none when tiny, and the nearest kept first when there are too many in all. */
  private lod() {
    const H = this.canvas.clientHeight || 800, cam = this.cam;
    const focal = H / 2 / Math.tan((this.camera.fov * Math.PI) / 360);
    const onScreen = (c: THREE.Vector3, rad: number) => (this.plan ? (rad * this.ortho.zoom * H) / (2 * this.orthoH) : (rad / Math.max(1, cam.position.distanceTo(c))) * focal);
    for (const sl of this.slabLod) { const vis = onScreen(sl.centre, sl.radius) > 70; for (const o of sl.detail) o.visible = vis; }
    if (!this.formed.size) return;
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
    // (after dark the Preetham sky gives way to a night blue: below the horizon it turns brown)
    this.skyL.sky.visible = !w && this.night < 0.6;
    this.ctx.visible = !w;
    this.scene.background = w ? this.paper : this.night < 0.6 ? null : this.nightSky;
    this.scene.fog = w ? null : this.fog;
    this.scene.environment = w ? null : this.skyL.env;
    this.renderer.shadowMap.needsUpdate = true;
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
    const L0 = Math.hypot(x, y, z) || 1;
    this.sunDir.set(x / L0, y / L0, z / L0);
    const e = this.sunDir.y, up = Math.max(0.02, e), L = Math.hypot(this.sunDir.x, up, this.sunDir.z);
    this.sun.target.position.set(cx, 0, cz);
    this.sun.position.set(cx + (this.sunDir.x / L) * 300, (up / L) * 300, cz + (this.sunDir.z / L) * 300);
    // (the sun warms toward the horizon and fades out at sunset; the sky's light follows it, faint and blue at night)
    this.sun.color.copy(sunColour(e));
    this.sun.intensity = 3.0 * THREE.MathUtils.smoothstep(e, -0.02, 0.25);
    this.night = dir ? Math.max(0, Math.min(1, (0.06 - e) / 0.16)) : 0;
    this.scene.environmentIntensity = THREE.MathUtils.lerp(1, 0.5, this.night);
    this.renderer.toneMapping = this.night > 0.5 ? THREE.AgXToneMapping : THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1 + 0.5 * this.night;
    this.skyL.set(this.sunDir, '#a8a395', () => { if (!this.wired) this.scene.environment = this.skyL.env; this.fog.color.copy(this.skyL.horizon); this.frame(); });
    this.fog.color.copy(this.skyL.horizon);
    this.pipe.setNight(this.night);
    if (!this.wired) { this.skyL.sky.visible = this.night < 0.6; this.scene.background = this.night < 0.6 ? null : this.nightSky; }
    this.fitSun();
    this.applyNight();
    this.frame();
  }
  private nightSky = new THREE.Color('#070b16');
  private fitSun() {
    if (!this.shadowBox.isEmpty()) fitShadow(this.sun, this.shadowBox, SPEC[this.tier].shadow);
    this.renderer.shadowMap.needsUpdate = true;
  }
  /** how dark it is (0 day … 1 night): the lights and the windows glow by it */
  night = 0;
  private lamps: THREE.MeshStandardMaterial[] = []; private glows: THREE.MeshBasicMaterial[] = []; private panes: THREE.MeshStandardMaterial[] = [];
  private lampMat(m: THREE.MeshStandardMaterial) { this.lamps.push(m); m.emissiveIntensity = 2.6 * this.night; return m; }
  private glowMat(m: THREE.MeshBasicMaterial) { this.glows.push(m); m.opacity = 0.32 * this.night; m.visible = this.night > 0.02; return m; }
  private paneMat(m: THREE.MeshStandardMaterial) { this.panes.push(m); m.emissiveIntensity = 0.38 * this.night; return m; }
  private applyNight() {
    const n = this.night;
    for (const m of this.lamps) m.emissiveIntensity = 6 * n;
    for (const m of this.glows) { m.opacity = 0.22 * n; m.visible = n > 0.02; }
    for (const m of this.panes) m.emissiveIntensity = 0;
    // (the rooms: dim by day, a share lit after dark: ./render/glass.ts)
    GLASS.uNight.value = n; GLASS.uLit.value = litShare(n); GLASS.uInterior.value = SPEC[this.tier].interiors ? 1 : 0;
    this.frame();
  }
  /** a darker sky for the dark theme */
  setTheme(dark: boolean) {
    // (the shaded view's sky is the sky, whatever the theme: only the wireframe's paper follows it)
    const css = getComputedStyle(document.documentElement), paper = css.getPropertyValue('--up-paper').trim() || (dark ? '#09090b' : '#fafaf9'), ink = css.getPropertyValue('--up-ink').trim() || (dark ? '#fafafa' : '#0c0c0d');
    this.paper.set(paper); this.wire.colours(paper, ink);
    for (const m of [this.overLine, this.overDash, this.overPts, this.overHot]) m.color.set(ink);
    this.apply();
  }
  /** the view as a PNG (for the drawings and a share) */
  snapshot(): string {
    // (always the shaded view: it goes into reports and drawings)
    const m = this.mode; if (m !== 'shaded') { this.mode = 'shaded'; this.apply(); }
    this.draw(true);
    const url = this.canvas.toDataURL('image/png');
    if (m !== 'shaded') { this.mode = m; this.apply(); }
    return url;
  }

  /** A still of the view at its own size (./render/still.ts): 'raster', the shaded pipeline supersampled offscreen (a
   *  few seconds), or 'path', path-traced with real glass and bounced light (a minute or so, `samples` passes). */
  async renderStill(o: { width: number; height: number; quality: 'raster' | 'path'; samples?: number; onProgress?: (f: number) => void; signal?: AbortSignal }): Promise<Blob> {
    const m = this.mode; if (m !== 'shaded') { this.mode = 'shaded'; this.apply(); }
    const cam = this.camera.clone(); cam.aspect = o.width / o.height; cam.updateProjectionMatrix();
    try {
      if (o.quality === 'raster') {
        this.renderer.shadowMap.needsUpdate = true;
        const keep = this.sun.shadow.radius; this.sun.shadow.radius = 4;
        const rt = new THREE.WebGLRenderTarget(o.width, o.height, { type: THREE.HalfFloatType });
        this.pipe.setCamera(cam);
        const { out, done } = this.pipe.renderTo(rt, 5);
        const px = new Uint16Array(o.width * o.height * 4);
        this.renderer.readRenderTargetPixels(out, 0, 0, o.width, o.height, px);
        done(); rt.dispose(); this.sun.shadow.radius = keep;
        o.onProgress?.(1);
        return await pixelsToPng(px, o.width, o.height, true);
      }
      // path-traced: the sky as a texture, glass with real transmission, the glows (a raster trick) hidden
      const { WebGLPathTracer } = await import('three-gpu-pathtracer');
      const envKeep = this.scene.environment, bgKeep = this.scene.background, fogKeep = this.scene.fog;
      const sky = await pathSky(this.sunDir, this.skyL.horizon);
      this.scene.environment = sky; this.scene.background = sky; this.scene.fog = null; this.skyL.sky.visible = false;
      const swapped: [THREE.MeshPhysicalMaterial, number][] = [], hidden: THREE.Object3D[] = [];
      this.scene.traverse((x) => {
        const mm = (x as THREE.Mesh).material as THREE.Material | undefined;
        if (mm && (mm as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial && mm.userData.rooms) { const g = mm as THREE.MeshPhysicalMaterial; swapped.push([g, g.transmission]); g.transmission = 0.85; g.thickness = 0.006; }
        if (mm && (mm as THREE.MeshBasicMaterial).isMeshBasicMaterial && x.visible && x !== this.ground) { hidden.push(x); x.visible = false; }
      });
      // (instanced parts with their own colours, the trees, cars and people, baked into plain meshes the tracer reads)
      const baked: THREE.Mesh[] = [];
      this.root.traverse((x) => {
        const im = x as THREE.InstancedMesh;
        if (!im.isInstancedMesh || !im.visible || !(im.instanceColor || (im.material as THREE.MeshStandardMaterial).vertexColors)) return;
        const g = bakeInstances(im);
        if (!g) return;
        const src = im.material as THREE.MeshStandardMaterial;
        for (const part of splitByColour(g)) baked.push(new THREE.Mesh(part.geo, new THREE.MeshStandardMaterial({ color: part.colour.multiply(src.color ?? new THREE.Color(1, 1, 1)), roughness: src.roughness ?? 0.8, metalness: src.metalness ?? 0 })));
        g.dispose(); hidden.push(im); im.visible = false;
      });
      for (const m of baked) this.scene.add(m);
      const size = this.renderer.getSize(new THREE.Vector2()), ratio = this.renderer.getPixelRatio();
      this.renderer.setPixelRatio(1); this.renderer.setSize(o.width, o.height, false);
      const pt = new WebGLPathTracer(this.renderer);
      pt.tiles.set(2, 2); pt.minSamples = 1; pt.fadeDuration = 0; pt.renderDelay = 0;
      cancelAnimationFrame(this.raf); this.raf = -1; // (the live loop paused)
      let url = '';
      try {
        pt.setScene(this.scene, cam);
        const N = o.samples ?? 192;
        // (the canvas is read straight after the last sample, before the browser presents and clears it)
        for (;;) {
          if (o.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
          pt.renderSample();
          o.onProgress?.(Math.min(1, pt.samples / N));
          if (pt.samples >= N) { url = this.canvas.toDataURL('image/png'); break; }
          await new Promise((ok) => requestAnimationFrame(ok));
        }
      } finally {
        pt.dispose();
        for (const [g, t] of swapped) g.transmission = t;
        for (const x of hidden) x.visible = true;
        for (const m of baked) { this.scene.remove(m); m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
        this.scene.environment = envKeep; this.scene.background = bgKeep; this.scene.fog = fogKeep; this.skyL.sky.visible = this.night < 0.6; sky.dispose();
        this.renderer.setPixelRatio(ratio); this.renderer.setSize(size.x, size.y, false);
        this.raf = 0; this.resize();
      }
      return await (await fetch(url)).blob();
    } finally {
      if (m !== 'shaded') { this.mode = m; this.apply(); }
      this.frame();
    }
  }

  /** a benchmark: the camera round the plot for `frames`, the frame times and the counts */
  async bench(frames = 600): Promise<BenchResult> {
    const c = this.controls, t0 = c.target.clone(), p0 = this.camera.position.clone(), R = Math.hypot(p0.x - t0.x, p0.z - t0.z), h = p0.y;
    const times: number[] = []; let calls = 0, tris = 0;
    for (let i = 0; i < frames; i++) {
      const a = (i / frames) * Math.PI * 2;
      this.camera.position.set(t0.x + Math.cos(a) * R, h, t0.z + Math.sin(a) * R); this.camera.lookAt(t0);
      const s = performance.now(); this.draw(false); (this.renderer.getContext() as WebGL2RenderingContext).finish(); times.push(performance.now() - s);
      calls += this.renderer.info.render.calls; tris += this.renderer.info.render.triangles;
      if (i % 30 === 0) await new Promise((ok) => setTimeout(ok, 0));
    }
    this.camera.position.copy(p0); c.update(); this.frame();
    times.sort((a, b) => a - b);
    const out = { frames, p50: times[Math.floor(frames * 0.5)], p95: times[Math.floor(frames * 0.95)], calls: Math.round(calls / frames), triangles: Math.round(tris / frames), geometries: this.renderer.info.memory.geometries, textures: this.renderer.info.memory.textures };
    console.table(out);
    return out;
  }

  clear() {
    this.root.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry && m.geometry !== box && m.geometry !== CHAMFER_BOX && m.geometry !== crownGeo && m.geometry !== trunkGeo && !m.geometry.userData.keep) m.geometry.dispose(); });
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
    this.lamps = []; this.glows = []; this.panes = []; this.slabLod = [];
    const seen = new Set<string>(), forms: Record<string, FormLayout> = {};
    const { r, d, plans, ds } = v;
    // (a face's bearing, degrees clockwise from north, from its outward normal: plan −z is north, turned by v.north)
    const bearing = (nx: number, nz: number) => bearingOf(nx, nz, v.north ?? 0);
    const fh = r.rules.floorH, mat = (color: string, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => this.lib.plain(color, o);
    GLASS.uFloorH.value = fh;
    const mats = (ds: DesignSystem) => { const fin = finishOf(ds), kel = kelvinColour(lightingOf(ds).kelvin); return ({
      wall: this.lib.surface(fin.wall, ds.facade.wall), accent: this.lib.surface(fin.accent, ds.facade.accent), base: this.lib.surface(fin.base, ds.facade.base),
      roof: this.lib.surface(fin.roof, materialOf(fin.roof).colour), sill: this.lib.surface(fin.base, ds.facade.base),
      frame: mat(ds.glazing.frame, { roughness: 0.38, metalness: 0.65 }), glass: this.paneMat(this.glassOf(ds.glazing.glass)),
      rail: ds.balcony.railing === 'glass' ? mat('#d6e6ee', { transparent: true, opacity: 0.2, roughness: 0.04, metalness: 0, depthWrite: false, side: THREE.DoubleSide }) : mat('#2b2b2e', { roughness: 0.45, metalness: 0.7 }),
      post: mat('#2b2b2e', { roughness: 0.4, metalness: 0.75 }),
      slab: mat('#d8d4cc'), road: mat('#5b5e66', { roughness: 0.95 }), dp: mat('#e5484d', { transparent: true, opacity: 0.28 }), paving: mat('#d3cfc5'),
      shop: mat('#efe2c8', { emissive: '#ffd9a0', emissiveIntensity: 0.25 }), sign: mat('#1d1f24', { roughness: 0.4 }),
      core: mat('#a7a39b'), door: mat('#8a5a3b', { roughness: 0.6 }), partition: mat('#f5f3ef'),
      jaali: this.lib.other(`jaali|${ds.facade.accent}`, () => new THREE.MeshStandardMaterial({ color: albedo(ds.facade.accent), roughness: 0.8, alphaMap: jaaliTexture(), alphaTest: 0.5, side: THREE.DoubleSide })),
      // (the lights: fittings that glow after sunset, and the wash they throw on the wall, added to it; see setSun)
      lamp: this.lampMat(this.lib.other(`lamp|${kel}`, () => new THREE.MeshStandardMaterial({ color: '#3a3a3c', emissive: kel, emissiveIntensity: 0 }))),
      glow: this.glowMat(this.lib.other(`glow|${kel}`, () => new THREE.MeshBasicMaterial({ color: kel, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }))),
      green: mat('#56744a', { roughness: 0.95, flatShading: true }),
    }); };
    let M = mats(ds);
    const site = M;
    const add = (o: THREE.Object3D | null) => { if (o) this.root.add(o); return o; };
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, cast = true) => { const x = new THREE.Mesh(g, m); x.castShadow = cast; x.receiveShadow = true; return add(x) as THREE.Mesh; };

    // the roads, the DP's widening, the plot
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < r.net.length; i += 2) { minX = Math.min(minX, r.net[i]); maxX = Math.max(maxX, r.net[i]); minZ = Math.min(minZ, r.net[i + 1]); maxZ = Math.max(maxZ, r.net[i + 1]); }
    // each road as a strip along its centre line (run 60 m past the plot: the lines come 300 m past)
    const marks: { pts: number[]; w: number; edges: boolean }[] = [];
    for (const rd of v.roads) {
      const [x0, z0, x1, z1] = rd.pts, L = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / L, uz = (z1 - z0) / L, nx = -uz * rd.today / 2, nz = ux * rd.today / 2;
      const a = [x0 + ux * 240, z0 + uz * 240], b = [x1 - ux * 240, z1 - uz * 240];
      if (rd.today >= 6) marks.push({ pts: [a[0], a[1], b[0], b[1]], w: rd.today, edges: true });
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
    // (the ground's pieces merged into one mesh per material: a few draw calls, not hundreds)
    const groundGeos = new Map<THREE.Material, THREE.BufferGeometry[]>();
    const G = d.ground.map, flatMP = (m: MP, y: number, mt: THREE.Material) => { for (const t of triangles(m)) if (t.length >= 6) { const a = groundGeos.get(mt) ?? []; a.push(flat(t, y)); groundGeos.set(mt, a); } };
    // (the internal roads in the site kit's surface)
    const KIT = siteKitOf(ds);
    flatMP(G.road, 0.05, mat(SURFACE_COLOUR[KIT.road.surface], { roughness: KIT.road.surface === 'asphalt' ? 0.95 : 0.85 })); flatMP(G.lot, 0.05, mat('#8b8e95', { roughness: 0.95 })); flatMP(G.path, 0.06, M.paving);
    flatMP(G.lawn, 0.06, mat('#9fb889')); flatMP(G.bed, 0.07, mat('#6f8f5a'));
    // (the planting as its species: ./render/entourage.ts)
    const trunks = new Boxes(), trees: Tree[] = [];
    const treeAt = (x: number, z: number, cr: number, kind = 1) => { trees.push({ x, z, r: cr, kind }); };
    for (const t of G.plants) trees.push({ x: t.x, z: t.z, r: Math.max(0.5, t.r), kind: t.kind });
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
    for (const [x, z] of plant.trees) treeAt(x, z, 2.4, landscapeOf(ds).trees === 'avenue' ? 3 : 0);
    for (const [g, gs] of groundGeos) { const m2 = mergeGeometries(gs); gs.forEach((x) => x.dispose()); if (m2) mesh(m2, g, false); }
    const hedge = new Boxes();
    for (const [x0, z0, x1, z1] of plant.hedges) { const L = Math.hypot(x1 - x0, z1 - z0); if (L > 0.5) hedge.add((x0 + x1) / 2, 0.6, (z0 + z1) / 2, (x1 - x0) / L, (z1 - z0) / L, L, 1.2, 0.8); }
    add(hedge.mesh(mat('#5a7a48', { roughness: 0.95, flatShading: true }), true));

    let bands = new Boxes(), fins = new Boxes(), frames = new Boxes(), panes = new Boxes(), slabs = new Boxes(), rails = new Boxes(), cols = new Boxes(), parts = new Boxes(), doors = new Boxes(), parapets = new Boxes(), signs = new Boxes(), jaalis = new Boxes(), lamps = new Boxes(), glows = new Boxes(), greens = new Boxes(), sills = new Boxes(), posts = new Boxes(), solids = new Boxes();
    /** the instanced parts into meshes; a building's detail (frames, railings, sills, screens) kept for its level of detail */
    const flush = (lod?: { centre: THREE.Vector3; radius: number }) => {
      const detail: THREE.Object3D[] = [];
      for (const [B, m, cast] of [[bands, M.accent, true], [fins, M.accent, true], [frames, M.frame, true], [panes, M.glass, false], [slabs, M.slab, true], [rails, M.rail, false], [cols, M.base, true], [parts, M.partition, true], [doors, M.door, true], [parapets, M.wall, true], [signs, M.sign, true], [jaalis, M.jaali, false], [lamps, M.lamp, false], [glows, M.glow, false], [greens, M.green, true], [sills, M.sill, true], [posts, M.post, false], [solids, M.wall, true]] as [Boxes, THREE.Material, boolean][]) {
        // (each pane a room of its own: a seed per instance for the lit rooms and the interiors)
        // (the members in the facade's materials take the chamfered box on the high tier: ./render/pbr.ts)
        const chamfer = BEVEL.value > 0 && (B === bands || B === fins || B === parapets || B === sills || B === slabs || B === cols || B === solids);
        const im = B === panes ? B.mesh(m, cast, box.clone()) : B.mesh(m, cast, chamfer ? CHAMFER_BOX : box);
        if (!im) continue;
        if (B === panes) { const n = im.count, a = new Float32Array(n); for (let i = 0; i < n; i++) { const h = Math.sin((i + 1) * 12.9898 + this.slabLod.length * 78.233) * 43758.5453; a[i] = h - Math.floor(h); } im.geometry.setAttribute('aLit', new THREE.InstancedBufferAttribute(a, 1)); }
        add(im);
        if (B === frames || B === panes || B === doors) this.pickables.push(im);
        if (B === frames || B === rails || B === posts || B === sills || B === jaalis) detail.push(im);
      }
      if (lod && detail.length) this.slabLod.push({ ...lod, detail });
      bands = new Boxes(); fins = new Boxes(); frames = new Boxes(); panes = new Boxes(); slabs = new Boxes(); rails = new Boxes(); cols = new Boxes(); parts = new Boxes(); doors = new Boxes(); parapets = new Boxes(); signs = new Boxes(); jaalis = new Boxes(); lamps = new Boxes(); glows = new Boxes(); greens = new Boxes(); sills = new Boxes(); posts = new Boxes(); solids = new Boxes();
    };
    /** a balcony's railing from (x0,z0) to (x1,z1) at floor level y, as its kind: glass panels between posts, MS
     *  balusters, or a solid upstand with a coping */
    const railRun = (x0: number, z0: number, x1: number, z1: number, y: number, kind: string) => {
      const L = Math.hypot(x1 - x0, z1 - z0); if (L < 0.1) return;
      const ux = (x1 - x0) / L, uz = (z1 - z0) / L, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
      if (kind === 'solid') { solids.add(mx, y + 0.5, mz, ux, uz, L, 1.0, 0.115); bands.add(mx, y + 1.03, mz, ux, uz, L + 0.04, 0.06, 0.18); return; }
      posts.add(mx, y + 1.07, mz, ux, uz, L, 0.05, 0.06);
      const step = kind === 'glass' ? 1.5 : 1.2, n = Math.max(1, Math.round(L / step));
      for (let k = 0; k <= n; k++) { const t = -L / 2 + (L * k) / n; posts.add(mx + ux * t, y + 0.55, mz + uz * t, ux, uz, 0.045, 1.05, 0.045); }
      if (kind === 'glass') rails.add(mx, y + 0.55, mz, ux, uz, L - 0.05, 0.95, 0.012);
      else { posts.add(mx, y + 0.12, mz, ux, uz, L, 0.04, 0.04); const nb = Math.max(1, Math.floor(L / 0.11)); for (let k = 1; k < nb; k++) { const t = -L / 2 + (L * k) / nb; rails.add(mx + ux * t, y + 0.6, mz + uz * t, ux, uz, 0.016, 0.95, 0.016); } }
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
      for (let k = 0; k <= n; k++) { const t = -e.L / 2 + Math.max(0.15, Math.min(e.L - 0.15, w * k)); cols.add(e.x + e.ux * t - e.nx * 0.05, yb + h / 2, e.z + e.uz * t - e.nz * 0.05, e.ux, e.uz, 0.3, h, 0.3); }
    };
    // (each building's shop strips merged, so the faces between strips aren't glazed inside the building)
    const shopRings = new Map<number, number[][]>();
    if (v.shops) for (const st of v.shops.strips) { const m2 = unionMP(...[...(shopRings.has(st.b) ? [] : []), ...v.shops.strips.filter((x) => x.b === st.b).map((x) => mpOf(x.ring))]); shopRings.set(st.b, m2.map((p) => p[0].flatMap((q) => [q[0], q[1]]))); }
    if (v.shops && under) for (const st of v.shops.strips) mesh(prism(st.ring, 0, y0 - 0.02), M.shop);
    if (v.shops && under) for (const ring of [...shopRings.values()].flat()) {
      for (const e of shopFronts(ring)) {
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
          while (R.trees && nextTree <= run + L) { const t = nextTree - run, px = x0 + ux * t - nx * (side + 0.6), pz = z0 + uz * t - nz * (side + 0.6); if (free(px, pz)) treeAt(px, pz, 2.0, 3); nextTree += 9; }
          run += L;
        }
      }
      add(kerbs.mesh(mat('#c9c6bf'), true)); add(paths.mesh(mat('#cfc9bd', { roughness: 0.9 }), false)); add(poles.mesh(mat('#3b3d42', { roughness: 0.5, metalness: 0.4 }), true));
    }
    add(trunks.mesh(mat('#6b5440'), true, trunkGeo));
    for (const im of treeMeshes(trees, this.tier !== 'draft', this.lib.other('plants', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 })))) add(im);
    // road markings: dashes down the middle, edge lines on the public roads
    for (const ln of [...d.ground.drive.map((pts) => ({ pts, w: d.ground.driveW, edges: false })), ...d.ground.roads.map((x) => ({ pts: x.pts, w: x.w, edges: false }))]) marks.push(ln);
    // (internal markings only where there is road: a road a building has grown over is cut back, and so are its lines)
    const mk = markings(marks, (x, z) => !inMP(d.ground.map.road, x, z) ? v.roads.some((rd) => { const [x0, z0, x1, z1] = rd.pts, L = Math.hypot(x1 - x0, z1 - z0) || 1; return Math.abs(((x - x0) * (z1 - z0) - (z - z0) * (x1 - x0)) / L) < rd.today / 2; }) : true);
    if (mk) { const mm = mesh(mk, mat('#f1efe8', { roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), false); mm.renderOrder = 1; }
    flush();
    const entrances: [number, number, number, number][] = [];
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
        { const fi = finishOf(bds); look.ids = { wall: fi.wall, accent: fi.accent, base: fi.base, roof: fi.roof }; }
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
      const OL = buildingOutline(b.quads);
      // (the stilt's columns: round the outline, inside it, turned with each face; one at each corner)
      if (under) for (const e of OL.edges) {
        const n = Math.max(1, Math.round(e.L / 6));
        for (let k = 0; k < n; k++) { const t = 0.25 + ((e.L - 0.5) * k) / n; cols.add(e.ax + e.ux * t - e.nx * 0.25, y0 / 2, e.az + e.uz * t - e.nz * 0.25, e.ux, e.uz, 0.5, y0, 0.5); }
      }
      for (const q of b.quads) {
        if (v.xray !== null) {
          if (yBase > y0) mesh(prism(q, y0, yBase), toneM(comp.base.tone));
          if (yTop > yBase) mesh(prism(q, yBase, yTop), M.wall);
          if (top > yTop) mesh(prism(q, yTop, top), toneM(comp.top.tone));
        } else if (top > y0) {
          mesh(flat(q, top), M.roof);
          if (under) mesh(flat(q, y0, true), M.slab, false);
        }
      }
      // (how far the glass sits back in the wall: by the wall's material)
      const wallCat = materialOf(finishOf(ds_).wall).category;
      const recess = wallCat === 'brick' || wallCat === 'stone' ? 0.12 : wallCat === 'cladding' ? 0.05 : wallCat === 'glass' ? 0.0 : 0.1;
      const facesAll = faces;
      if (v.xray === null && top > y0) {
        const zb = { base: new GeoBuf(), mid: new GeoBuf(), top: new GeoBuf() };
        for (const f of facesAll) {
          const on = plan.openings.filter((o) => o.outside && Math.abs((o.x - f.ax) * f.nx + (o.z - f.az) * f.nz) < 0.15).map((o) => ({ o, s: (o.x - f.ax) * f.ux + (o.z - f.az) * f.uz })).filter((x) => x.s > -0.1 && x.s < f.L + 0.1);
          const corner = comp.corner === 'glazed' && comp.rhythm !== 'free' && f.n >= 3;
          for (let k = 0; k < all; k++) {
            const fy = y0 + k * fh, shopHere = !!v.shops && k < v.shops.upperOf[bi], gone = shopHere ? v.shops!.removed.get(bi) : undefined;
            const holes: Hole[] = on.filter((x) => !gone?.has(x.o.unit)).map(({ o, s: sAt }) => ({ s0: sAt - o.w / 2, s1: sAt + o.w / 2, y0: fy + o.sill, y1: Math.min(fy + fh - 0.05, fy + o.sill + o.h) }));
            if (corner && !shopHere && k >= Z.base) for (const sAt of [...(f.startConvex ? [f.bw / 2] : []), ...(f.endConvex ? [f.L - f.bw / 2] : [])]) holes.push({ s0: sAt - (f.bw - 0.2) / 2, s1: sAt + (f.bw - 0.2) / 2, y0: fy + 0.15, y1: fy + fh - 0.3 });
            cutFace(k < Z.base ? zb.base : k >= all - Z.top ? zb.top : zb.mid, f, fy, fy + fh, holes, recess);
          }
        }
        if (!zb.base.empty) mesh(zb.base.geo(), toneM(comp.base.tone));
        if (!zb.mid.empty) mesh(zb.mid.geo(), M.wall);
        if (!zb.top.empty) mesh(zb.top.geo(), toneM(comp.top.tone));
      }
      const along = (f: (typeof faces)[number], s: number, out: number) => [f.ax + f.ux * s + f.nx * out, f.az + f.uz * s + f.nz * out] as const;
      // a string course over the base and under the top
      for (const f of faces) {
        const [mx, mz] = along(f, f.L / 2, 0);
        void mx; void mz;
        if (Z.base && yBase < top) { const [e0, e1] = endExt(f, 0.2), [x, z] = along(f, (f.L + e1 - e0) / 2, 0); bands.add(x, yBase, z, f.ux, f.uz, f.L + e0 + e1, 0.45, 0.4); }
        if (Z.top && yTop < top) { const [e0, e1] = endExt(f, 0.15), [x, z] = along(f, (f.L + e1 - e0) / 2, 0); bands.add(x, yTop, z, f.ux, f.uz, f.L + e0 + e1, 0.3, 0.3); }
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
        if (!f.endConvex) continue;
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
        entrances.push([x, z, front.nx, front.nz]);
        // the lobby's glass doors
        const dh = Math.min(2.7, he - 0.3), [gx, gz] = at(0.08);
        frames.add(gx, dh / 2 + 0.05, gz, front.ux, front.uz, 3.4, dh + 0.1, 0.12);
        panes.add(gx + front.nx * 0.05, dh / 2 + 0.05, gz + front.nz * 0.05, front.ux, front.uz, 3.2, dh - 0.06, 0.04);
        signAt = { x, z, y: he + 0.12, out: 2.95 };
        // (a portal or canopy that would stand on a road becomes a flush canopy)
        const onRoad = (o2: number) => { const [qx, qz] = at(o2); return inMP(d.ground.map.road, qx, qz) || inMP(d.ground.map.fire, qx, qz); };
        if (comp.entrance === 'canopy' || onRoad(2.6)) { const dep2 = onRoad(2.6) ? 1.2 : 3.0, [cx2, cz2] = at(dep2 / 2); slabs.add(cx2, he, cz2, front.ux, front.uz, 5.4, 0.22, dep2); if (dep2 < 3) signAt = { x, z, y: he + 0.12, out: dep2 - 0.05 }; }
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
      // (the cores: inside the walls they'd only fight the facade for depth, so drawn where they show: down the stilt and up
      // past the roof as the lift room; X-ray shows the cut floor's core open, its walls to the cut like the flats')
      for (const c of b.cores) { if (v.xray !== null) { if (top > 0.05) mesh(prism(c, 0, top, false), M.core); mesh(flat(c, top + 0.04), M.core, false); for (let i = 0; i < c.length; i += 2) { const j = (i + 2) % c.length, L = Math.hypot(c[j] - c[i], c[j + 1] - c[i + 1]); if (L > 0.05) parts.add((c[i] + c[j]) / 2, top + CUT / 2, (c[i + 1] + c[j + 1]) / 2, (c[j] - c[i]) / L, (c[j + 1] - c[i + 1]) / L, L, CUT, 0.2); } } else { if (y0 > 0.05) mesh(prism(c, 0, y0, false), M.core); mesh(prism(c, y0 + all * fh - 0.05, y0 + all * fh + 2.4), M.core); } }
      // floors: bands on the slab edges, the openings
      const floorsShown = v.xray === null ? all : show;
      for (let f = 0; f < floorsShown; f++) {
        const fy = y0 + f * fh;
        if (ds_.facade.bands) for (const e of OL.edges) {
          const [e0, e1] = endExt(e, 0.12), t = (e.L + e1 - e0) / 2;
          bands.add(e.ax + e.ux * t, fy, e.az + e.uz * t, e.ux, e.uz, e.L + e0 + e1, 0.22, 0.24);
        }
        const cut = v.xray !== null && f === show - 1;
        const shopHere = !!v.shops && f < v.shops.upperOf[bi], gone = shopHere ? v.shops!.removed.get(bi) : undefined;
        if (shopHere && !cut) for (const ring of shopRings.get(bi) ?? []) for (const e of shopFronts(ring)) glazeRun(e, fy, fh, false);
        if (!cut && !shopHere && f >= Z.base) for (const c of corners) for (const s of [...(c.startConvex ? [c.bw / 2] : []), ...(c.endConvex ? [c.L - c.bw / 2] : [])]) {
          const gw = c.bw - 0.2, gh = fh - 0.45, [x, z] = along(c, s, -Math.max(0, recess - 0.04));
          for (const sg2 of [-1, 1]) frames.add(x + c.ux * sg2 * (gw / 2 - 0.03), fy + 0.15 + gh / 2, z + c.uz * sg2 * (gw / 2 - 0.03), c.ux, c.uz, 0.06, gh, 0.07);
          frames.add(x, fy + 0.15 + gh - 0.03, z, c.ux, c.uz, gw, 0.06, 0.07); frames.add(x, fy + 0.18, z, c.ux, c.uz, gw, 0.06, 0.07);
          panes.add(x, fy + 0.15 + gh / 2, z, c.ux, c.uz, gw - 0.1, gh - 0.1, 0.02);
        }
        for (const o of plan.openings) {
          if (gone?.has(o.unit)) continue;
          if (!o.outside && !cut) continue;
          const s = o.tag === 'SD' || o.tag === 'D1' ? ds_.doors[o.tag] : ds_.windows[o.tag];
          const cy = fy + o.sill + o.h / 2;
          // (the face it's on, and how much of a span centred on it fits within the face: fins, reveals, chhajjas and
          // balconies stop at the face's ends instead of passing a corner)
          const fo = o.outside ? faces.find((ff) => Math.abs((o.x - ff.ax) * ff.nx + (o.z - ff.az) * ff.nz) < 0.15 && (o.x - ff.ax) * ff.ux + (o.z - ff.az) * ff.uz > -0.1 && (o.x - ff.ax) * ff.ux + (o.z - ff.az) * ff.uz < ff.L + 0.1) : undefined;
          const so = fo ? (o.x - fo.ax) * fo.ux + (o.z - fo.az) * fo.uz : 0, sgnU = fo ? Math.sign(o.ux * fo.ux + o.uz * fo.uz) || 1 : 1;
          const fit = (w: number): [number, number] => { if (!fo) return [0, w]; const a = Math.max(0.05, so - w / 2), c = Math.min(fo.L - 0.05, so + w / 2); return [((a + c) / 2 - so) * sgnU, Math.max(0, c - a)]; };
          const meta = { o, floor: f + 1, label: `${o.tag} · ${s.label}` };
          // (the cut floor is drawn as a plan: walls to 1.5 m, the glass only below that)
          if (cut && o.outside) { const t = Math.min(CUT, o.sill + o.h); if (t > o.sill + 0.05) panes.add(o.x, fy + (o.sill + t) / 2, o.z, o.ux, o.uz, o.w, t - o.sill, 0.04, meta); continue; }
          // (the leaf open into the flat, hinged at one jamb)
          if (o.tag === 'D1') { doors.add(o.x - o.ux * o.w / 2 - o.nx * o.w / 2, fy + Math.min(o.h, CUT + 0.3) / 2, o.z - o.uz * o.w / 2 - o.nz * o.w / 2, o.nx, o.nz, o.w, Math.min(o.h, CUT + 0.3), 0.05, meta); continue; }
          {
            // (the frame sits back in the opening: four members, then mullions and transoms by the window's kind)
            const dIn = Math.max(0, recess - 0.04), px = o.x - o.nx * dIn, pz = o.z - o.nz * dIn, fw = 0.06, kind = s.kind;
            frames.add(px, cy + o.h / 2 - fw / 2, pz, o.ux, o.uz, o.w, fw, 0.07, meta);
            frames.add(px, cy - o.h / 2 + fw / 2, pz, o.ux, o.uz, o.w, fw, 0.07, meta);
            for (const sg2 of [-1, 1]) frames.add(px + o.ux * sg2 * (o.w / 2 - fw / 2), cy, pz + o.uz * sg2 * (o.w / 2 - fw / 2), o.ux, o.uz, fw, o.h, 0.07, meta);
            if (kind === 'sliding' || kind === 'glass-sliding') frames.add(px, cy, pz, o.ux, o.uz, 0.08, o.h - 2 * fw, 0.09, meta);
            else if (kind === 'casement' || (kind === 'fixed' && o.w > 2)) { const n = Math.max(1, Math.round(o.w / (kind === 'fixed' ? 1.2 : 0.6))); for (let k = 1; k < n; k++) frames.add(px + o.ux * (-o.w / 2 + (o.w * k) / n), cy, pz + o.uz * (-o.w / 2 + (o.w * k) / n), o.ux, o.uz, 0.045, o.h - 2 * fw, 0.07, meta); }
            else if (kind === 'louvre') { const n = Math.max(4, Math.round(o.h / 0.08)); for (let k = 1; k < n; k++) frames.add(px, cy - o.h / 2 + (o.h * k) / n, pz, o.ux, o.uz, o.w - 2 * fw, 0.012, 0.06, meta); }
            if (o.h > 1.5 && kind !== 'louvre') frames.add(px, cy + o.h / 2 - Math.min(0.5, o.h * 0.25), pz, o.ux, o.uz, o.w - 2 * fw, 0.045, 0.07, meta);
            panes.add(px, cy, pz, o.ux, o.uz, o.w - 2 * fw + 0.02, o.h - 2 * fw + 0.02, 0.02, meta);
            // (a sill in the base's stone under a window, standing a little proud)
            if (o.tag !== 'SD' && o.sill > 0.2) sills.add(o.x + o.nx * (0.04 - recess) / 2, fy + o.sill - 0.025, o.z + o.nz * (0.04 - recess) / 2, o.ux, o.uz, o.w + 0.1, 0.05, recess + 0.04);
          }
          // a deep reveal: the surround stands out from the wall (not round a balcony's door, which has the balcony)
          const rv = comp.reveal;
          if (rv > 0.01 && !(o.tag === 'SD' && ds_.balcony.kind !== 'none' && ds_.balcony.kind !== 'french')) {
            const [dsh, sw] = fit(o.w + 0.36), hx = o.x + o.nx * rv / 2 + o.ux * dsh, hz = o.z + o.nz * rv / 2 + o.uz * dsh;
            parapets.add(hx, cy + o.h / 2 + 0.08, hz, o.ux, o.uz, sw, 0.16, rv);
            parapets.add(hx, cy - o.h / 2 - 0.08, hz, o.ux, o.uz, sw, 0.16, rv);
            for (const sgn of [-1, 1]) parapets.add(hx + o.ux * sgn * (o.w / 2 + 0.09), cy, hz + o.uz * sgn * (o.w / 2 + 0.09), o.ux, o.uz, 0.18, o.h, rv);
          }
          // the climate: a chhajja over the window (not over a balcony's door: the balcony above shades it), as deep as
          // the face's sun asks; a jaali in front of the ventilators (and the smaller windows)
          const shaded = o.tag === 'SD' && (ds_.balcony.kind === 'cantilever' || ds_.balcony.kind === 'recessed');
          if (cl.chhajja > 0.05 && !shaded) {
            const dep = chhajjaOn(cl, bearing(o.nx, o.nz)), y = cy + o.h / 2 + (rv > 0.01 ? 0.24 : 0.12), [csh, cw] = fit(o.w + 0.6);
            if (cw > 0.1) {
              parapets.add(o.x + o.nx * dep / 2 + o.ux * csh, y, o.z + o.nz * dep / 2 + o.uz * csh, o.ux, o.uz, cw, 0.1, dep);
              parapets.add(o.x + o.nx * (dep - 0.03) + o.ux * csh, y - 0.07, o.z + o.nz * (dep - 0.03) + o.uz * csh, o.ux, o.uz, cw, 0.04, 0.03);
            }
          }
          if (o.tag === 'V1' ? cl.jaali !== 'none' : o.tag === 'W2' && cl.jaali === 'windows') jaalis.add(o.x + o.nx * 0.2, cy, o.z + o.nz * 0.2, o.ux, o.uz, o.w + 0.2, o.h + 0.2, 0.05);
          if (ds_.facade.fins && (o.tag === 'W1' || o.tag === 'SD')) for (const sgn of [-1, 1]) {
            if (fo) { const sf = so + sgn * sgnU * (o.w / 2 + 0.25); if (sf < 0.1 || sf > fo.L - 0.1) continue; }
            const fx = o.x + o.ux * sgn * (o.w / 2 + 0.25), fz = o.z + o.uz * sgn * (o.w / 2 + 0.25);
            fins.add(fx + o.nx * 0.3, fy + fh / 2, fz + o.nz * 0.3, o.nx, o.nz, 0.6, fh, 0.12);
          }
          if (o.tag === 'SD' && ds_.balcony.kind === 'cantilever' && landscapeOf(ds).planters && !(fo && (so < 0.9 || so > fo.L - 0.9))) greens.add(o.x + o.nx * (ds_.balcony.depth - 0.3), fy + 0.35, o.z + o.nz * (ds_.balcony.depth - 0.3), o.ux, o.uz, Math.min(1.6, o.w), 0.5, 0.35);
          if (o.tag === 'SD' && ds_.balcony.kind !== 'none') {
            const dep = ds_.balcony.kind === 'french' ? 0.3 : ds_.balcony.depth, [bsh, w] = fit(o.w + 0.9);
            // (a balcony that would run into another wing of the building at an inside corner is left off)
            const bcx = o.x + o.ux * bsh, bcz = o.z + o.uz * bsh;
            if (w < 0.6 || [-0.5, 0.5].some((k) => inMP(OL.shape, bcx + o.ux * k * w + o.nx * (dep - 0.05), bcz + o.uz * k * w + o.nz * (dep - 0.05)))) continue;
            const out = ds_.balcony.kind === 'recessed' ? 0.12 : dep;
            if (ds_.balcony.kind === 'cantilever') slabs.add(bcx + o.nx * dep / 2, fy - 0.08, bcz + o.nz * dep / 2, o.ux, o.uz, w, 0.16, dep);
            if (ds_.balcony.kind === 'recessed') slabs.add(bcx + o.nx * 0.06, fy + fh - 0.25, bcz + o.nz * 0.06, o.ux, o.uz, w, 0.5, 0.12);
            const rk = ds_.balcony.railing, fx0 = bcx + o.nx * out - o.ux * w / 2, fz0 = bcz + o.nz * out - o.uz * w / 2, fx1 = bcx + o.nx * out + o.ux * w / 2, fz1 = bcz + o.nz * out + o.uz * w / 2;
            railRun(fx0, fz0, fx1, fz1, fy, rk);
            if (ds_.balcony.kind === 'cantilever') for (const sgn of [-1, 1]) railRun(bcx + o.ux * sgn * w / 2, bcz + o.uz * sgn * w / 2, bcx + o.ux * sgn * w / 2 + o.nx * dep, bcz + o.uz * sgn * w / 2 + o.nz * dep, fy, rk);
            if (ds_.balcony.kind === 'cantilever') slabs.add(bcx + o.nx * (dep - 0.02), fy - 0.19, bcz + o.nz * (dep - 0.02), o.ux, o.uz, w, 0.03, 0.04);
          }
        }
      }
      if (v.xray === null) {
        // parapet round the roof, and a lift room and tank over each core
        const ry = y0 + all * fh;
        for (const e of OL.edges) {
          if (e.L < 0.3) continue;
          // (the parapet just inside the face; the coping over it, 5 cm proud, wrapping outside corners)
          const tp = e.L / 2, [c0, c1] = endExt(e, 0.05), tc = (e.L + c1 - c0) / 2;
          parapets.add(e.ax + e.ux * tp - e.nx * 0.1, ry + 0.5, e.az + e.uz * tp - e.nz * 0.1, e.ux, e.uz, e.L, 1.0, 0.2);
          sills.add(e.ax + e.ux * tc - e.nx * 0.1, ry + 1.03, e.az + e.uz * tc - e.nz * 0.1, e.ux, e.uz, e.L + c0 + c1, 0.06, 0.3);
        }
        // the crown: a deep cornice, or a pergola's frame over the terrace
        const crown = all >= ZONED_FROM ? comp.top.crown : 'parapet';
        if (crown === 'cornice') for (const f of faces) { const [e0, e1] = endExt(f, 0.6), [x, z] = along(f, (f.L + e1 - e0) / 2, 0.1); bands.add(x, ry + 0.75, z, f.ux, f.uz, f.L + e0 + e1, 0.5, 1.0); }
        if (crown === 'pergola') {
          // (on the outline 0.8 m in from the faces: posts at its corners and every 3 m along it, beams round it, slats
          // across the longer way a metre apart, each cut to the shape)
          const ph = 3.0, yb = ry + ph, inset = offsetMP(OL.shape, -0.8);
          const beam = (ax: number, az: number, cx: number, cz: number, y: number, t: number) => { const L = Math.hypot(cx - ax, cz - az); if (L > 0.1) fins.add((ax + cx) / 2, y, (az + cz) / 2, (cx - ax) / L, (cz - az) / L, L, t, t); };
          for (const poly of inset) {
            const ring = poly[0]?.flatMap((p) => [p[0], p[1]]) ?? [];
            if (ring.length < 6) continue;
            let A = 0; for (let i = 0; i < ring.length; i += 2) { const j = (i + 2) % ring.length; A += ring[i] * ring[j + 1] - ring[j] * ring[i + 1]; }
            if (Math.abs(A) / 2 < 9) continue;
            let lx = 1, lz = 0, best = 0;
            for (let i = 0; i < ring.length; i += 2) {
              const j = (i + 2) % ring.length, L = Math.hypot(ring[j] - ring[i], ring[j + 1] - ring[i + 1]);
              beam(ring[i], ring[i + 1], ring[j], ring[j + 1], yb, 0.3);
              const n = Math.max(1, Math.round(L / 3));
              for (let k = 0; k < n; k++) fins.add(ring[i] + (ring[j] - ring[i]) * k / n, ry + ph / 2, ring[i + 1] + (ring[j + 1] - ring[i + 1]) * k / n, 1, 0, 0.3, ph, 0.3);
              if (L > best) { best = L; lx = (ring[j] - ring[i]) / L; lz = (ring[j + 1] - ring[i + 1]) / L; }
            }
            // slats: lines across (along the longest edge's normal), each cut to the ring
            let v0 = Infinity, v1 = -Infinity;
            for (let i = 0; i < ring.length; i += 2) { const v = ring[i] * lx + ring[i + 1] * lz; v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
            for (let v = v0 + 1; v < v1; v += 1) {
              const px = lx * v, pz = lz * v, ts = crossings(ring, px, pz, -lz, lx);
              for (let k = 0; k + 1 < ts.length; k += 2) beam(px - lz * ts[k], pz + lx * ts[k], px - lz * ts[k + 1], pz + lx * ts[k + 1], yb + 0.2, 0.12);
            }
          }
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
      // (its middle and size, for the level of detail)
      let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
      for (const q of b.quads) for (let i = 0; i < q.length; i += 2) { bx0 = Math.min(bx0, q[i]); bx1 = Math.max(bx1, q[i]); bz0 = Math.min(bz0, q[i + 1]); bz1 = Math.max(bz1, q[i + 1]); }
      const hgt = y0 + all * fh;
      flush({ centre: new THREE.Vector3((bx0 + bx1) / 2, hgt / 2, (bz0 + bz1) / 2), radius: Math.hypot(bx1 - bx0, hgt, bz1 - bz0) / 2 });
    });

    // ---- people and cars (./render/entourage.ts): cars in the lots and along the road, people at the doors
    if (SPEC[this.tier].entourage && v.xray === null) {
      const built = d.buildings.flatMap((b) => b.quads), inNet = (x: number, z: number) => r.net.length >= 6 && pointIn(r.net, x, z, 0) && !built.some((q) => pointIn(q, x, z, 0.8));
      const h01 = (x: number, z: number, k: number) => { const t = Math.sin(x * 12.9898 + z * 78.233 + k * 3.7) * 43758.5453; return t - Math.floor(t); };
      const cars: [number, number, number][] = [], people: [number, number][] = [];
      for (const poly of G.lot) {
        const ring = poly[0]?.flatMap((p) => [p[0], p[1]]) ?? [];
        if (ring.length < 6) continue;
        for (const [x, z] of gridIn(ring, F.ux, F.uz, 2.6, 5.4, (x, z) => pointIn(ring, x, z, -1.2) && inNet(x, z))) if (h01(x, z, 1) < 0.7) cars.push([x, z, Math.atan2(F.vx, F.vz)]);
      }
      for (const rd of v.roads) {
        const [x0, z0, x1, z1] = rd.pts, L = Math.hypot(x1 - x0, z1 - z0), ux = (x1 - x0) / L, uz = (z1 - z0) / L;
        for (let t = 0; t < L; t += 9) {
          const px = x0 + ux * t, pz = z0 + uz * t;
          if (Math.hypot(px - this.box.cx, pz - this.box.cz) > this.box.s * 0.8 + 30) continue;
          for (const sg2 of [-1, 1]) if (h01(px, pz, sg2) < 0.45) cars.push([px - uz * sg2 * (rd.today / 2 - 1.3), pz + ux * sg2 * (rd.today / 2 - 1.3), Math.atan2(ux, uz)]);
        }
      }
      for (const [x, z, nx, nz] of entrances) for (let k = 0; k < 3; k++) people.push([x + nx * (2.5 + k * 0.9) + -nz * (k - 1) * 1.1, z + nz * (2.5 + k * 0.9) + nx * (k - 1) * 1.1]);
      for (const ln of d.ground.roads) for (let i = 0; i + 3 < ln.pts.length; i += 2) { const mx = (ln.pts[i] + ln.pts[i + 2]) / 2, mz = (ln.pts[i + 1] + ln.pts[i + 3]) / 2; if (h01(mx, mz, 7) < 0.5) people.push([mx + 3.5, mz + 1]); }
      // (with the CC0 models: about a third of the slots a pair of motorcycles, one in ten a truck)
      const bikes: [number, number, number][] = [], trucks: [number, number, number][] = [];
      if (this.models.has('motorcycle')) for (let i = cars.length - 1; i >= 0; i--) {
        const [x, z, a] = cars[i], h = h01(x, z, 9);
        if (h < 0.3) { cars.splice(i, 1); bikes.push([x - Math.cos(a) * 0.5, z + Math.sin(a) * 0.5, a], [x + Math.cos(a) * 0.5, z - Math.sin(a) * 0.5, a]); }
        else if (h > 0.9 && this.models.has('truck-red')) { cars.splice(i, 1); trucks.push([x, z, a]); }
      }
      for (const im of modelMeshes(this.models.get('motorcycle') ?? [], bikes.slice(0, 300))) add(im);
      const tk = ['truck-red', 'truck-yellow', 'truck-green'].filter((k) => this.models.has(k));
      tk.forEach((k, j) => { for (const im of modelMeshes(this.models.get(k)!, trucks.filter((_, i) => i % tk.length === j))) add(im); });
      // (the cars: Kenney's Car Kit models when fetched, a mix of sedans, SUVs, hatchbacks, taxis and vans; else our own)
      const ck = ['car-sedan', 'car-suv', 'car-hatchback', 'car-taxi', 'car-van'].filter((k) => this.models.has(k)), parked = cars.slice(0, 400);
      if (ck.length) {
        const weight = (k: string) => (k === 'car-taxi' ? 0.12 : k === 'car-van' ? 0.1 : 1);
        const total = ck.reduce((s2, k) => s2 + weight(k), 0);
        const pickKey = (x: number, z: number) => { let t = h01(x, z, 11) * total; for (const k of ck) { t -= weight(k); if (t <= 0) return k; } return ck[0]; };
        for (const k of ck) for (const im of modelMeshes(this.models.get(k)!, parked.filter(([x, z]) => pickKey(x, z) === k))) add(im);
      } else for (const im of carMeshes(parked, this.lib.other('car', () => new THREE.MeshStandardMaterial({ roughness: 0.32, metalness: 0.55 })), this.lib.glass('#1c2430', { roughness: 0.08 }))) add(im);
      if (this.models.has('person')) { for (const im of modelMeshes(this.models.get('person')!, people.slice(0, 200).map(([x, z]) => [x, z, h01(z, x, 4) * Math.PI * 2] as [number, number, number]))) add(im); }
      else for (const im of peopleMeshes(people.slice(0, 200), this.lib.other('people', () => new THREE.MeshStandardMaterial({ roughness: 0.85 })), mat('#a77b5a'))) add(im);
    }

    // the neighbours, when the plot is on the map (loaded once per place)
    const ck = v.at && v.city ? `${v.city}|${v.at[0].toFixed(6)}|${v.at[1].toFixed(6)}|${v.north ?? 0}` : '';
    if (ck !== this.ctxKey) {
      this.ctxKey = ck;
      this.ctx.traverse((o) => (o as THREE.Mesh).geometry?.dispose()); this.ctx.clear();
      if (ck && v.at && v.city) {
        const fp = r.footprint.length >= 6 ? r.footprint : r.net;
        void neighbours(import.meta.env.BASE_URL, v.city, v.at, v.north ?? 0, (x, z) => fp.length >= 6 && pointIn(fp, x, z, 2)).then((list) => {
          if (this.ctxKey !== ck) return;
          const m = neighbourMesh(list, this.lib.plain('#d6d3cc', { roughness: 0.95 }));
          if (m) { this.ctx.add(m); this.renderer.shadowMap.needsUpdate = true; this.frame(); }
        }).catch(() => { /* no region data here: no neighbours */ });
      }
    }
    // the sun's shadow fitted to what's drawn
    this.shadowBox.set(new THREE.Vector3(minX - 30, -1, minZ - 30), new THREE.Vector3(maxX + 30, (d.height || 30) + 10, maxZ + 30));
    this.fitSun();

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
