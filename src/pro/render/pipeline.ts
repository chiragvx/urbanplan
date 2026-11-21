// The shaded view's pipeline: the scene into a half-float buffer, ambient occlusion (GTAO), bloom after dark, tone
// mapping and sRGB (OutputPass: Khronos PBR Neutral by day, so the design system's swatches stay true; AgX at night,
// for the lamps), then SMAA. When the camera rests on the high tier the scene pass becomes a jittered supersample
// (SSAA) that sharpens and settles the image. three's own passes: no extra dependency. The wireframe and the plan
// skip all of it and draw straight to the canvas.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { SSAARenderPass } from 'three/addons/postprocessing/SSAARenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { Tier } from './quality';

export class Pipeline {
  composer: EffectComposer;
  private scenePass: RenderPass;
  private ssaa: SSAARenderPass;
  private gtao: GTAOPass;
  private bloom: UnrealBloomPass;
  private output = new OutputPass();
  private smaa = new SMAAPass();
  private tier: Tier = 'standard';

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, w: number, h: number) {
    const rt = new THREE.WebGLRenderTarget(Math.max(1, w), Math.max(1, h), { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(renderer, rt);
    this.scenePass = new RenderPass(scene, camera);
    this.ssaa = new SSAARenderPass(scene, camera);
    this.ssaa.sampleLevel = 3; this.ssaa.unbiased = true; this.ssaa.enabled = false;
    this.gtao = new GTAOPass(scene, camera, Math.max(1, w), Math.max(1, h));
    this.gtao.output = GTAOPass.OUTPUT.Default;
    // (metres: a radius that reaches into window reveals and under chhajjas, not across a street)
    this.gtao.updateGtaoMaterial({ radius: 1.2, distanceExponent: 1.4, thickness: 1.2, scale: 1, samples: 12, distanceFallOff: 0.5, screenSpaceRadius: false });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.gtao.blendIntensity = 1;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.3, 0.18, 1.6);
    this.bloom.enabled = false;
    for (const p of [this.scenePass, this.ssaa, this.gtao, this.bloom, this.output, this.smaa]) this.composer.addPass(p);
  }

  setTier(t: Tier) {
    this.tier = t;
    this.gtao.enabled = t !== 'draft';
    this.gtao.updateGtaoMaterial({ samples: t === 'high' || t === 'still' ? 16 : 10 });
  }
  setCamera(c: THREE.Camera) { this.scenePass.camera = c; this.ssaa.camera = c; this.gtao.camera = c; }
  setSize(w: number, h: number) { this.composer.setPixelRatio(this.renderer.getPixelRatio()); this.composer.setSize(w, h); }
  setNight(n: number) {
    this.bloom.enabled = n > 0.05;
    this.bloom.strength = 0.12 + 0.22 * n;
  }

  /** a frame: `still` asks for the settled image (supersampled), when the camera has stopped */
  render(still: boolean) {
    const acc = still && (this.tier === 'high' || this.tier === 'still');
    this.ssaa.enabled = acc; this.scenePass.enabled = !acc;
    this.smaa.enabled = !acc;
    this.composer.render();
  }

  /** render once into a target of its own at w × h (a still), with `samples` jittered frames per pixel (2^level) */
  renderTo(target: THREE.WebGLRenderTarget, level: number) {
    const keep = { ssaa: this.ssaa.enabled, scene: this.scenePass.enabled, smaa: this.smaa.enabled, level: this.ssaa.sampleLevel, rts: this.output.renderToScreen };
    this.ssaa.enabled = true; this.scenePass.enabled = false; this.smaa.enabled = false; this.ssaa.sampleLevel = level;
    // (the output pass writes into the still's target instead of the screen)
    this.output.renderToScreen = false;
    const c = new EffectComposer(this.renderer, target);
    c.renderToScreen = false;
    for (const p of [this.ssaa, this.gtao, this.bloom, this.output]) c.addPass(p);
    c.setPixelRatio(1); c.setSize(target.width, target.height);
    c.render();
    const out = c.readBuffer, done = () => c.dispose();
    // (restore the live composer's passes to its own size)
    this.ssaa.enabled = keep.ssaa; this.scenePass.enabled = keep.scene; this.smaa.enabled = keep.smaa; this.ssaa.sampleLevel = keep.level;
    this.output.renderToScreen = keep.rts;
    const s = this.renderer.getSize(new THREE.Vector2());
    this.setSize(s.x, s.y);
    return { out, done };
  }

  dispose() { this.composer.dispose(); this.gtao.dispose(); this.bloom.dispose(); this.smaa.dispose(); this.ssaa.dispose(); }
}
