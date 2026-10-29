// 2D plan view: an orthographic camera looking straight down (north up, x east, z south = screen down).
import type * as THREE from 'three/webgpu';

export class PlanView {
  cx = 0;
  cz = 0;
  /** pixels per metre */
  scale = 0.35;
  w = 1;
  h = 1;
  minScale = 0.08;
  maxScale = 60;
  private anim: { cx: number; cz: number; scale: number; t0: number; from: [number, number, number]; dur: number } | null = null;

  constructor(private cam: THREE.OrthographicCamera, public bounds = 2500) {}

  resize(w: number, h: number) { this.w = w; this.h = h; this.apply(); }

  toWorld(sx: number, sy: number): [number, number] { return [this.cx + (sx - this.w / 2) / this.scale, this.cz + (sy - this.h / 2) / this.scale]; }
  toScreen(x: number, z: number): [number, number] { return [(x - this.cx) * this.scale + this.w / 2, (z - this.cz) * this.scale + this.h / 2]; }
  /** visible world rectangle [x0, z0, x1, z1] */
  get rect(): [number, number, number, number] {
    const hw = this.w / 2 / this.scale, hh = this.h / 2 / this.scale;
    return [this.cx - hw, this.cz - hh, this.cx + hw, this.cz + hh];
  }

  pan(dxPx: number, dyPx: number) { this.anim = null; this.cx -= dxPx / this.scale; this.cz -= dyPx / this.scale; this.clamp(); this.apply(); }

  zoomAt(sx: number, sy: number, factor: number) {
    this.anim = null;
    const [wx, wz] = this.toWorld(sx, sy);
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, this.scale * factor));
    this.cx = wx - (sx - this.w / 2) / this.scale;
    this.cz = wz - (sy - this.h / 2) / this.scale;
    this.clamp(); this.apply();
  }

  /** Animate to show a world rectangle. */
  fit(x0: number, z0: number, x1: number, z1: number, pad = 60, dur = 350) {
    const sw = (this.w - pad * 2) / Math.max(1, x1 - x0), sh = (this.h - pad * 2) / Math.max(1, z1 - z0);
    this.goTo((x0 + x1) / 2, (z0 + z1) / 2, Math.min(this.maxScale, Math.max(this.minScale, Math.min(sw, sh))), dur);
  }

  goTo(cx: number, cz: number, scale = this.scale, dur = 350) {
    this.anim = { cx, cz, scale, t0: performance.now(), from: [this.cx, this.cz, this.scale], dur };
  }

  /** Advance animation; true while moving. */
  tick(now: number): boolean {
    const a = this.anim;
    if (!a) return false;
    // the frame's timestamp can be a little older than the moment the animation started: never run it backwards
    const t = Math.max(0, Math.min(1, (now - a.t0) / a.dur)), e = 1 - Math.pow(1 - t, 3);
    // zoom in log space so it feels even
    this.scale = Math.exp(Math.log(a.from[2]) + (Math.log(a.scale) - Math.log(a.from[2])) * e);
    this.cx = a.from[0] + (a.cx - a.from[0]) * e;
    this.cz = a.from[1] + (a.cz - a.from[1]) * e;
    if (t >= 1) this.anim = null;
    this.apply();
    return true;
  }

  private clamp() {
    const b = this.bounds + 400;
    this.cx = Math.max(-b, Math.min(b, this.cx));
    this.cz = Math.max(-b, Math.min(b, this.cz));
  }

  apply() {
    const c = this.cam;
    const hw = this.w / 2 / this.scale, hh = this.h / 2 / this.scale;
    c.left = -hw; c.right = hw; c.top = hh; c.bottom = -hh;
    c.position.set(this.cx, 4000, this.cz);
    c.up.set(0, 0, -1);
    c.lookAt(this.cx, 0, this.cz);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
  }
}
