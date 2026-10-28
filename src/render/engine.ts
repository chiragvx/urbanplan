// three.js WebGPU engine: renderer, sky, sun + shadows, haze, post-processing (GTAO + bloom + FXAA).
import * as THREE from 'three/webgpu';
import { pass, mrt, output, normalView, vec4, renderOutput, screenUV } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';

export interface Quality { ao: boolean; bloom: boolean; shadows: boolean; scale: number }

export class Engine {
  renderer: THREE.WebGPURenderer;
  scene = new THREE.Scene();
  camera: THREE.PerspectiveCamera;
  /** top-down orthographic camera for the 2D plan view */
  planCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 9000);
  private planPipeline: THREE.RenderPipeline | null = null;
  plan = false;
  sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
  hemi = new THREE.HemisphereLight(0xc4d6ec, 0x6b5f48, 1.15);
  sky: SkyMesh;
  pipeline!: THREE.RenderPipeline;
  quality: Quality = { ao: true, bloom: false, shadows: true, scale: 1 };
  readonly maxScale = Math.min(window.devicePixelRatio || 1, 1.5);
  /** last measured GPU time per frame (ms), from timestamp queries */
  gpuMs = 0;
  private shadowState = { x: 1e9, z: 1e9, r: 0, sx: 0, sy: 0, sz: 0 };
  sunDir = new THREE.Vector3(0.4, 0.8, 0.3).normalize();
  private aoNode: ReturnType<typeof ao> | null = null;

  constructor(public canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGPURenderer({ canvas, antialias: false, powerPreference: 'high-performance', trackTimestamp: true });
    this.camera = new THREE.PerspectiveCamera(40, 1, 1, 30000);
    this.sky = new SkyMesh();
  }

  async init() {
    const r = this.renderer;
    await r.init();
    r.toneMapping = THREE.AgXToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFShadowMap;

    const s = this.scene;
    this.sky.scale.setScalar(40000);
    this.sky.turbidity.value = 6.5;   // Pune haze
    this.sky.rayleigh.value = 1.6;
    this.sky.mieCoefficient.value = 0.006;
    this.sky.mieDirectionalG.value = 0.82;
    this.sky.cloudCoverage.value = 0.35;
    this.sky.cloudDensity.value = 0.35;
    s.add(this.sky);
    s.fog = new THREE.Fog(0xb9c3c9, 2500, 11000);

    const sun = this.sun;
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.35;
    sun.shadow.autoUpdate = false;
    s.add(sun, sun.target, this.hemi);

    this.buildPipeline();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  buildPipeline() {
    const q = this.quality;
    const scenePass = pass(this.scene, this.camera);
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
      this.aoNode = aoPass;
      const occl = aoPass.getTextureNode().sample(screenUV).r;
      color = vec4(col.rgb.mul(occl.mul(0.85).add(0.15)), col.a);
    } else {
      color = scenePass.getTextureNode('output');
      this.aoNode = null;
    }
    if (q.bloom) color = color.add(bloom(color, 0.18, 0.35, 0.92));
    this.pipeline = new THREE.RenderPipeline(this.renderer);
    this.pipeline.outputColorTransform = false;
    this.pipeline.outputNode = fxaa(renderOutput(color));
  }

  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    // quality.scale is the absolute pixel ratio: 1 = CSS pixels; dynamic resolution may go up to the device's
    this.renderer.setPixelRatio(this.quality.scale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
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
    this.renderer.toneMappingExposure = 1.05 + (1 - day) * 0.6;
    return 1 - day;
  }

  /** Keep the shadow frustum around what the camera looks at; re-render shadows only when needed. */
  updateShadows(focus: THREE.Vector3, radius: number, force = false) {
    const s = this.shadowState;
    const moved = Math.hypot(focus.x - s.x, focus.z - s.z) > radius * 0.1;
    const zoomed = Math.abs(radius - s.r) > s.r * 0.15;
    const d = this.sunDir;
    const sunMoved = Math.abs(d.x - s.sx) + Math.abs(d.y - s.sy) + Math.abs(d.z - s.sz) > 0.003;
    if (!(force || moved || zoomed || sunMoved)) return;
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
  }

  render() {
    if (this.plan) {
      if (!this.planPipeline) {
        const p = new THREE.RenderPipeline(this.renderer);
        p.outputColorTransform = false;
        p.outputNode = renderOutput(pass(this.scene, this.planCamera), THREE.NoToneMapping, THREE.SRGBColorSpace);
        this.planPipeline = p;
      }
      this.planPipeline.render();
    } else this.pipeline.render();
  }

  /** Switch between the plan view (flat, unlit, no sky / fog / shadows) and the 3D view. */
  setPlan(on: boolean) {
    this.plan = on;
    this.sky.visible = !on;
    this.scene.background = on ? new THREE.Color(0xebe7df) : null;
    this.sun.castShadow = !on && this.quality.shadows;
    if (on) this.savedFog = this.scene.fog;
    this.scene.fog = on ? null : this.savedFog ?? this.scene.fog;
  }
  private savedFog: THREE.Fog | THREE.FogExp2 | null = null;

  /** Poll GPU timestamps (cheap; call ~once a second). */
  async sampleGpuTime() {
    try {
      await this.renderer.resolveTimestampsAsync('render');
      const t = this.renderer.info.render.timestamp;
      if (t > 0) this.gpuMs = t;
    } catch { /* timestamps unsupported */ }
  }
}
