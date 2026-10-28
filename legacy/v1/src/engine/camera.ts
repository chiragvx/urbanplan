// City-builder camera: orbit around a ground target, smoothed for a "buttery" feel.
import { mat4, clamp, damp, type Mat4, type Vec3 } from './math';

export class CityCamera {
  // desired (input writes here) and current (rendered, smoothed)
  target: Vec3 = [0, 0, 0];
  dist = 900;
  yaw = 0.6;
  pitch = 0.85;
  private cur = { x: 0, z: 0, dist: 900, yaw: 0.6, pitch: 0.85 };

  fovY = (45 * Math.PI) / 180;
  aspect = 1;
  bounds = 2000;
  minDist = 25;
  maxDist = 4200;

  view: Mat4 = mat4.create();
  proj: Mat4 = mat4.create();
  viewProj: Mat4 = mat4.create();
  eye: Vec3 = [0, 0, 0];

  snap() {
    this.cur = { x: this.target[0], z: this.target[2], dist: this.dist, yaw: this.yaw, pitch: this.pitch };
  }

  get currentTarget(): Vec3 { return [this.cur.x, 0, this.cur.z]; }
  get currentDist() { return this.cur.dist; }

  update(dt: number) {
    this.dist = clamp(this.dist, this.minDist, this.maxDist);
    this.pitch = clamp(this.pitch, 0.18, 1.52);
    this.target[0] = clamp(this.target[0], -this.bounds, this.bounds);
    this.target[2] = clamp(this.target[2], -this.bounds, this.bounds);
    const k = damp(14, dt);
    const c = this.cur;
    c.x += (this.target[0] - c.x) * k;
    c.z += (this.target[2] - c.z) * k;
    c.dist += (this.dist - c.dist) * k;
    c.yaw += (this.yaw - c.yaw) * k;
    c.pitch += (this.pitch - c.pitch) * k;
    this.computeMatrices(c.x, c.z, c.dist, c.yaw, c.pitch);
  }

  private computeMatrices(x: number, z: number, dist: number, yaw: number, pitch: number) {
    const cp = Math.cos(pitch);
    this.eye = [x + dist * cp * Math.sin(yaw), dist * Math.sin(pitch), z + dist * cp * Math.cos(yaw)];
    mat4.lookAt(this.view, this.eye, [x, 0, z], [0, 1, 0]);
    mat4.perspectiveReversedZ(this.proj, this.fovY, this.aspect, Math.max(0.5, dist * 0.01), dist * 6 + 4000);
    mat4.multiply(this.viewProj, this.proj, this.view);
  }

  /** Ray from screen point (pixels relative to canvas) using the *current* camera. */
  ray(px: number, py: number, w: number, h: number): { o: Vec3; d: Vec3 } {
    const nx = (px / w) * 2 - 1;
    const ny = 1 - (py / h) * 2;
    const v = this.view;
    // camera basis from view matrix rows
    const right: Vec3 = [v[0], v[4], v[8]];
    const up: Vec3 = [v[1], v[5], v[9]];
    const fwd: Vec3 = [-v[2], -v[6], -v[10]];
    const th = Math.tan(this.fovY / 2);
    const d: Vec3 = [
      fwd[0] + right[0] * nx * th * this.aspect + up[0] * ny * th,
      fwd[1] + right[1] * nx * th * this.aspect + up[1] * ny * th,
      fwd[2] + right[2] * nx * th * this.aspect + up[2] * ny * th,
    ];
    const l = Math.hypot(d[0], d[1], d[2]);
    return { o: [...this.eye] as Vec3, d: [d[0] / l, d[1] / l, d[2] / l] };
  }

  groundAt(px: number, py: number, w: number, h: number, y = 0): Vec3 | null {
    const { o, d } = this.ray(px, py, w, h);
    if (Math.abs(d[1]) < 1e-5) return null;
    const t = (y - o[1]) / d[1];
    if (t < 0) return null;
    return [o[0] + d[0] * t, y, o[2] + d[2] * t];
  }
}

/** Mouse/keyboard/touchpad controls. Left-drag in "inspect" pans; tools get clicks/drags. */
export class CameraControls {
  private keys = new Set<string>();
  private dragging: 'pan' | 'rotate' | null = null;
  private panAnchor: Vec3 | null = null;
  private last = { x: 0, y: 0 };
  private downAt = { x: 0, y: 0 };
  leftDragPans = true;

  onClick: (x: number, y: number) => void = () => {};
  onPaintStart: (x: number, y: number) => void = () => {};
  onPaint: (x: number, y: number) => void = () => {};
  onPaintEnd: () => void = () => {};
  onHover: (x: number, y: number) => void = () => {};
  private painting = false;

  constructor(private el: HTMLCanvasElement, private cam: CityCamera) {
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', this.down);
    window.addEventListener('pointermove', this.move);
    window.addEventListener('pointerup', this.up);
    el.addEventListener('wheel', this.wheel, { passive: false });
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  private rel(e: PointerEvent | WheelEvent) {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top, w: r.width, h: r.height };
  }

  private down = (e: PointerEvent) => {
    this.el.setPointerCapture(e.pointerId);
    const p = this.rel(e);
    this.last = { x: e.clientX, y: e.clientY };
    this.downAt = { x: e.clientX, y: e.clientY };
    if (e.button === 2 || (e.button === 0 && e.altKey)) {
      this.dragging = 'rotate';
    } else if (e.button === 1 || (e.button === 0 && (this.leftDragPans || e.shiftKey))) {
      this.dragging = 'pan';
      this.panAnchor = this.cam.groundAt(p.x, p.y, p.w, p.h);
    } else if (e.button === 0) {
      this.painting = true;
      this.onPaintStart(p.x, p.y);
    }
  };

  private move = (e: PointerEvent) => {
    const p = this.rel(e);
    const dx = e.clientX - this.last.x, dy = e.clientY - this.last.y;
    this.last = { x: e.clientX, y: e.clientY };
    if (this.dragging === 'rotate') {
      this.cam.yaw -= dx * 0.006;
      this.cam.pitch += dy * 0.005;
    } else if (this.dragging === 'pan' && this.panAnchor) {
      const g = this.cam.groundAt(p.x, p.y, p.w, p.h);
      if (g) {
        this.cam.target[0] += this.panAnchor[0] - g[0];
        this.cam.target[2] += this.panAnchor[2] - g[2];
        this.cam.snap(); // panning is direct — no lag under the finger
        this.cam.update(0);
      }
    } else if (this.painting) {
      this.onPaint(p.x, p.y);
    } else if (e.target === this.el) {
      this.onHover(p.x, p.y);
    }
  };

  private up = (e: PointerEvent) => {
    const moved = Math.hypot(e.clientX - this.downAt.x, e.clientY - this.downAt.y);
    const p = this.rel(e);
    if (this.dragging === 'pan' && moved < 5 && e.button === 0) this.onClick(p.x, p.y);
    if (this.painting) { this.painting = false; this.onPaintEnd(); }
    this.dragging = null;
    this.panAnchor = null;
  };

  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = this.rel(e);
    const pinch = e.ctrlKey; // touchpad pinch arrives as ctrl+wheel
    const amount = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
    const factor = Math.exp(amount * (pinch ? 0.01 : 0.0012));
    const g = this.cam.groundAt(p.x, p.y, p.w, p.h);
    const old = this.cam.dist;
    this.cam.dist = Math.min(this.cam.maxDist, Math.max(this.cam.minDist, this.cam.dist * factor));
    const f = this.cam.dist / old;
    if (g) {
      // zoom toward the cursor
      this.cam.target[0] = g[0] + (this.cam.target[0] - g[0]) * f;
      this.cam.target[2] = g[2] + (this.cam.target[2] - g[2]) * f;
    }
  };

  update(dt: number) {
    const k = this.keys;
    const speed = this.cam.dist * 1.1 * dt;
    let fx = 0, fz = 0;
    if (k.has('w') || k.has('arrowup')) fz -= 1;
    if (k.has('s') || k.has('arrowdown')) fz += 1;
    if (k.has('a') || k.has('arrowleft')) fx -= 1;
    if (k.has('d') || k.has('arrowright')) fx += 1;
    if (fx || fz) {
      const y = this.cam.yaw;
      // forward on ground = toward target from eye
      const fwdX = -Math.sin(y), fwdZ = -Math.cos(y);
      const rX = Math.cos(y), rZ = -Math.sin(y);
      this.cam.target[0] += (rX * fx - fwdX * fz) * speed;
      this.cam.target[2] += (rZ * fx - fwdZ * fz) * speed;
    }
    if (k.has('q')) this.cam.yaw += 1.6 * dt;
    if (k.has('e')) this.cam.yaw -= 1.6 * dt;
    if (k.has('r')) this.cam.pitch += 0.9 * dt;
    if (k.has('f')) this.cam.pitch -= 0.9 * dt;
    if (k.has('=') || k.has('+')) this.cam.dist *= 1 - 1.5 * dt;
    if (k.has('-')) this.cam.dist *= 1 + 1.5 * dt;
  }
}
