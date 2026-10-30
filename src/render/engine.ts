// three.js WebGPU engine: renderer, sky, sun + shadows, haze, post-processing.
// Two looks: "simple" (the default — flat sky, shadows re-rendered only once the camera settles, FXAA only, 1× pixels:
// light enough for laptops) and "high" (physical sky with clouds, GTAO, live shadows, up to 1.5× pixels). The 3D pipeline's render targets only
// exist while the 3D view is open; the 2D plan view has its own single-pass pipeline.
import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalView, vec4, renderOutput, screenUV, convertToTexture, uniform, mix, smoothstep, positionWorldDirection } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';

export type Graphics = 'simple' | 'high';
export interface Quality { ao: boolean; bloom: boolean; shadows: boolean; clouds: boolean; scale: number }

const PRESETS: Record<Graphics, Omit<Quality, 'scale' | 'bloom'> & { maxScale: number }> = {
  simple: { ao: false, shadows: true, clouds: false, maxScale: 1 },
  high: { ao: true, shadows: true, clouds: true, maxScale: Math.min(window.devicePixelRatio || 1, 1.5) },
};
/** dynamic resolution steps, as a share of the preset's pixel ratio */
const STEPS = [1, 0.85, 0.7];

/** ?perf in the URL: GPU timestamps for the performance panel (they cost a little, so off by default) */
export const PERF_URL = new URLSearchParams(location.search).has('perf');

export class Engine {
  renderer: THREE.WebGPURenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  /** top-down orthographic camera for the 2D plan view */
  planCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 9000);
  private planPipeline: THREE.RenderPipeline | null = null;
  plan = false;
  /** plan-view background follows the UI theme */
  planBg = 0xebe7df;
  sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
  hemi = new THREE.HemisphereLight(0xc4d6ec, 0x6b5f48, 1.15);
  sky: SkyMesh;
  /** 3D post-processing; built on the first 3D frame, released in the plan view */
  pipeline: THREE.RenderPipeline | null = null;
  private passes: { dispose(): void }[] = [];
  graphics: Graphics = 'simple';
  quality: Quality = { ao: false, bloom: false, shadows: true, clouds: false, scale: 1 };
  maxScale = 1;
  /** index into STEPS (dynamic resolution) */
  step = 0;
  /** last measured GPU time per frame (ms), from timestamp queries (?perf only) */
  gpuMs = 0;
  /** the GPU device was lost (driver reset, out of memory): nothing renders until the page reloads */
  lost = false;
  onLost: (message: string) => void = () => {};
  private shadowState = { x: 1e9, z: 1e9, r: 0, sx: 0, sy: 0, sz: 0 };
  sunDir = new THREE.Vector3(0.4, 0.8, 0.3).normalize();
  /** flat sky (simple look): haze at the horizon to blue overhead */
  private skyTop = uniform(new THREE.Color(0x5f93d6));
  private skyHorizon = uniform(new THREE.Color(0xb9c3c9));
  private skyNode = mix(this.skyHorizon, this.skyTop, smoothstep(0.0, 0.3, positionWorldDirection.y));

  constructor(public canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGPURenderer({ canvas, antialias: false, powerPreference: 'high-performance', trackTimestamp: PERF_URL });
    this.camera = new THREE.PerspectiveCamera(40, 1, 1, 30000);
    this.sky = new SkyMesh();
    this.renderer.onDeviceLost = (info: { message?: string; reason?: string | null }) => {
      this.lost = true;
      console.error(`UrbanPlan: GPU device lost (${info.reason ?? 'unknown'}): ${info.message ?? ''}`);
      this.onLost(info.message ?? '');
    };
  }

  async init(graphics: Graphics = 'simple') {
    const r = this.renderer;
    await r.init();
    r.toneMapping = THREE.AgXToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;

    const s = this.scene;
    this.sky.scale.setScalar(40000);
    this.sky.turbidity.value = 6.5;   // haze
    this.sky.rayleigh.value = 1.6;
    this.sky.mieCoefficient.value = 0.006;
    this.sky.mieDirectionalG.value = 0.82;
    this.sky.cloudCoverage.value = 0.35;
    this.sky.cloudDensity.value = 0.35;
    s.add(this.sky);
    s.fog = new THREE.Fog(0xb9c3c9, 2500, 11000);

    const sun = this.sun;
    sun.castShadow = true;
    // one size for both looks: three can't shrink a shadow map in place (the simple look re-renders it only when
    // the camera settles, so its cost is small)
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.35;
    sun.shadow.autoUpdate = false;
    s.add(sun, sun.target, this.hemi);

    this.setGraphics(graphics);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** Switch the look (simple / high). */
  setGraphics(g: Graphics) {
    this.graphics = g;
    const p = PRESETS[g], q = this.quality;
    q.ao = p.ao; q.shadows = p.shadows; q.clouds = p.clouds;
    this.maxScale = p.maxScale;
    this.step = 0;
    q.scale = this.maxScale;
    this.shadowState.r = 0; // re-render the shadow map
    // a closer haze in the simple look hides where small detail stops being drawn
    const fog = (this.scene.fog ?? this.savedFog) as THREE.Fog | null;
    if (fog) { fog.near = g === 'simple' ? 1800 : 2500; fog.far = g === 'simple' ? 8000 : 11000; }
    this.applySky();
    this.releasePipeline();
    this.resize();
  }

  private applySky() {
    const on3d = !this.plan;
    this.sky.visible = on3d && this.quality.clouds;
    this.scene.backgroundNode = on3d && !this.quality.clouds ? this.skyNode : null;
    this.scene.background = this.plan ? new THREE.Color(this.planBg) : null;
    // never toggled off: three frees the light's shadow node when a material is built without it while other
    // objects still use it. The plan view's unlit materials never render the shadow map anyway.
    this.sun.castShadow = this.quality.shadows;
  }

  private buildPipeline() {
    const q = this.quality;
    const scenePass = pass(this.scene, this.camera);
    this.passes = [scenePass];
    let color: any;
    if (q.ao) {
      scenePass.setMRT(mrt({ output, normal: normalView }));
      const col = scenePass.getTextureNode('output');
      const depth = scenePass.getTextureNode('depth');
      const normal = scenePass.getTextureNode('normal');
      const aoPass = ao(depth, normal, this.camera);
      aoPass.resolutionScale = 0.5;
      aoPass.radius.value = 3.5;
      aoPass.thickness.value = 2;
      aoPass.distanceExponent.value = 1.2;
      aoPass.scale.value = 1.25;
      aoPass.samples.value = 8;
      this.passes.push(aoPass);
      const occl = aoPass.getTextureNode().sample(screenUV).r;
      color = vec4(col.rgb.mul(occl.mul(0.85).add(0.15)), col.a);
    } else {
      color = scenePass.getTextureNode('output');
    }
    if (q.bloom) color = color.add(bloom(color, 0.18, 0.35, 0.92));
    const p = new THREE.RenderPipeline(this.renderer);
    p.outputColorTransform = false;
    // FXAA samples a render-to-texture copy of the graded image: keep it, so releasing the pipeline frees it too
    const graded = convertToTexture(renderOutput(color));
    this.passes.push(graded as unknown as { dispose(): void });
    p.outputNode = fxaa(graded);
    this.pipeline = p;
  }

  /** Free the 3D pipeline's render targets (colour, depth, normals, AO). Rebuilt on the next 3D frame. */
  releasePipeline() {
    if (!this.pipeline) return;
    for (const n of this.passes) n.dispose();
    this.passes = [];
    this.pipeline.dispose();
    this.pipeline = null;
  }

  private releasePlanPipeline() {
    if (!this.planPipeline) return;
    this.planPass?.dispose();
    this.planPass = null;
    this.planPipeline.dispose();
    this.planPipeline = null;
  }
  private planPass: ReturnType<typeof pass> | null = null;

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    // quality.scale is the absolute pixel ratio: 1 = CSS pixels
    this.renderer.setPixelRatio(this.quality.scale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Dynamic resolution: one step down / up (few fixed steps, so render targets aren't reallocated every second). */
  stepResolution(dir: 1 | -1): boolean {
    const s = Math.max(0, Math.min(STEPS.length - 1, this.step + dir));
    if (s === this.step) return false;
    this.step = s;
    this.quality.scale = this.maxScale * STEPS[s];
    this.resize();
    return true;
  }

  /** Time of day in minutes → sun, sky, light colours, haze. Returns night factor 0..1. */
  setTimeOfDay(minutes: number): number {
    const h = minutes / 60;
    const th = (Math.PI * (h - 6)) / 12;
    const elev = Math.sin(th);
    this.sunDir.set(Math.cos(th), Math.max(elev, -0.25), 0.35).normalize();
    const day = THREE.MathUtils.smoothstep(elev, -0.06, 0.2);
    const golden = (1 - THREE.MathUtils.smoothstep(elev, 0.06, 0.42)) * day; // warm light near sunrise/sunset only
    this.sky.sunPosition.value.copy(this.sunDir);
    const sunCol = new THREE.Color(0xfff1dc).lerp(new THREE.Color(0xffa860), golden);
    this.sun.color.copy(sunCol);
    this.sun.intensity = 0.15 + 3.1 * day;
    this.hemi.intensity = 0.25 + 0.95 * day;
    this.hemi.color.set(0xc4d6ec).lerp(new THREE.Color(0x1b2338), 1 - day);
    this.hemi.groundColor.set(0x6b5f48).lerp(new THREE.Color(0x0c0c10), 1 - day);
    const fog = new THREE.Color(0xb9c3c9).lerp(new THREE.Color(0xd9a77f), golden * 0.6).lerp(new THREE.Color(0x0d1220), 1 - day);
    (this.scene.fog as THREE.Fog).color.copy(fog);
    this.skyHorizon.value.copy(fog);
    this.skyTop.value.set(0x5f93d6).lerp(new THREE.Color(0x070b16), 1 - day);
    this.renderer.toneMappingExposure = 1.05 + (1 - day) * 0.6;
    return 1 - day;
  }

  /**
   * Keep the shadow frustum around what the camera looks at; re-render shadows only when needed. In the simple look
   * the shadow map waits until the camera settles (`moving`). Returns true when the shadows changed.
   */
  updateShadows(focus: THREE.Vector3, radius: number, force = false, moving = false): boolean {
    if (this.plan || !this.sun.castShadow) return false;
    const s = this.shadowState;
    const moved = Math.hypot(focus.x - s.x, focus.z - s.z) > radius * 0.1;
    const zoomed = Math.abs(radius - s.r) > s.r * 0.15;
    const d = this.sunDir;
    const sunMoved = Math.abs(d.x - s.sx) + Math.abs(d.y - s.sy) + Math.abs(d.z - s.sz) > 0.003;
    if (!(force || moved || zoomed || sunMoved)) return false;
    if (moving && !force && this.graphics === 'simple' && s.r > 0) return false;
    const R = radius * 1.2;
    const sun = this.sun;
    sun.target.position.copy(focus);
    sun.position.copy(focus).addScaledVector(d, R * 3);
    const cam = sun.shadow.camera as THREE.OrthographicCamera;
    cam.left = -R; cam.right = R; cam.top = R; cam.bottom = -R;
    cam.near = 1; cam.far = R * 6;
    cam.updateProjectionMatrix();
    sun.target.updateMatrixWorld();
    sun.updateMatrixWorld();
    sun.shadow.needsUpdate = true;
    this.shadowState = { x: focus.x, z: focus.z, r: radius, sx: d.x, sy: d.y, sz: d.z };
    return true;
  }

  /** CPU time of the last render() call (ms) */
  cpuMs = 0;

  render() {
    if (this.lost) return;
    const t0 = performance.now();
    // three only resets its counters in its own animation loop, which isn't used here
    this.renderer.info.reset();
    this.renderOnce();
    this.cpuMs = performance.now() - t0;
  }

  private renderOnce() {
    if (this.plan) {
      if (!this.planPipeline) {
        const p = new THREE.RenderPipeline(this.renderer);
        p.outputColorTransform = false;
        this.planPass = pass(this.scene, this.planCamera);
        p.outputNode = renderOutput(this.planPass, THREE.NoToneMapping, THREE.SRGBColorSpace);
        this.planPipeline = p;
      }
      this.planPipeline.render();
    } else {
      if (!this.pipeline) this.buildPipeline();
      this.pipeline!.render();
    }
  }

  /** Dark or light plan map (the UI theme). */
  setPlanDark(dark: boolean) {
    this.planBg = dark ? 0x16181b : 0xebe7df;
    this.applySky();
  }

  /** Switch between the plan view (flat, unlit, no sky / fog / shadows) and the 3D view. */
  setPlan(on: boolean) {
    this.plan = on;
    if (on) this.savedFog = this.scene.fog;
    this.scene.fog = on ? null : this.savedFog ?? this.scene.fog;
    this.applySky();
    // only one view's render targets live at a time
    if (on) this.releasePipeline(); else this.releasePlanPipeline();
    this.shadowState.r = 0;
  }
  private savedFog: THREE.Fog | THREE.FogExp2 | null = null;

  /** Poll GPU timestamps (?perf only; call ~once a second). */
  async sampleGpuTime() {
    if (!PERF_URL) return;
    try {
      await this.renderer.resolveTimestampsAsync('render');
      const t = this.renderer.info.render.timestamp;
      if (t > 0) this.gpuMs = t;
    } catch { /* timestamps unsupported */ }
  }
}
