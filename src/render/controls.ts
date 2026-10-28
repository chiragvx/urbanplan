// City-builder camera: orbit a ground target with smoothing; zoom-to-cursor; picks against the terrain.
import * as THREE from 'three/webgpu';

const damp = (lambda: number, dt: number) => 1 - Math.exp(-lambda * dt);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

export class CityControls {
  target = new THREE.Vector3();
  dist = 900;
  yaw = 0.6;
  pitch = 0.75;
  minDist = 18;
  maxDist = 6500;
  bounds = 2500;
  private cur = { x: 0, y: 0, z: 0, dist: 900, yaw: 0.6, pitch: 0.75 };
  private keys = new Set<string>();
  private drag: 'pan' | 'rotate' | null = null;
  private anchor: THREE.Vector3 | null = null;
  private last = { x: 0, y: 0 };
  private down = { x: 0, y: 0 };
  onClick: (x: number, y: number) => void = () => {};
  onHover: (x: number, y: number) => void = () => {};

  constructor(private el: HTMLElement, private camera: THREE.PerspectiveCamera, private heightAt: (x: number, z: number) => number) {
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.last = this.down = { x: e.clientX, y: e.clientY };
      if (e.button === 2 || (e.button === 0 && e.altKey)) this.drag = 'rotate';
      else { this.drag = 'pan'; this.anchor = this.pick(e.clientX, e.clientY); }
    });
    window.addEventListener('pointermove', (e) => {
      const dx = e.clientX - this.last.x, dy = e.clientY - this.last.y;
      this.last = { x: e.clientX, y: e.clientY };
      if (this.drag === 'rotate') { this.yaw -= dx * 0.005; this.pitch = clamp(this.pitch + dy * 0.004, 0.12, 1.5); }
      else if (this.drag === 'pan' && this.anchor) {
        const g = this.pickAtHeight(e.clientX, e.clientY, this.anchor.y);
        if (g) {
          this.target.x += this.anchor.x - g.x;
          this.target.z += this.anchor.z - g.z;
          this.snap();
          this.apply();
        }
      } else if (e.target === el) this.onHover(e.clientX, e.clientY);
    });
    window.addEventListener('pointerup', (e) => {
      if (this.drag === 'pan' && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) < 5) this.onClick(e.clientX, e.clientY);
      this.drag = null;
      this.anchor = null;
    });
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const amount = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      const f = Math.exp(amount * (e.ctrlKey ? 0.01 : 0.0012));
      const g = this.pick(e.clientX, e.clientY);
      const old = this.dist;
      this.dist = clamp(this.dist * f, this.minDist, this.maxDist);
      const k = this.dist / old;
      if (g) {
        this.target.x = g.x + (this.target.x - g.x) * k;
        this.target.z = g.z + (this.target.z - g.z) * k;
      }
    }, { passive: false });
    window.addEventListener('keydown', (e) => { if ((e.target as HTMLElement)?.tagName !== 'INPUT') this.keys.add(e.key.toLowerCase()); });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
  }

  snap() { this.cur = { x: this.target.x, y: this.target.y, z: this.target.z, dist: this.dist, yaw: this.yaw, pitch: this.pitch }; }

  get focus() { return new THREE.Vector3(this.cur.x, this.cur.y, this.cur.z); }
  get currentDist() { return this.cur.dist; }

  /** Ray → terrain (ray-march + bisection). */
  pick(cx: number, cy: number): THREE.Vector3 | null {
    const ray = this.ray(cx, cy);
    let t = 0, prev = 0;
    const step = Math.max(2, this.cur.dist / 120);
    for (let i = 0; i < 2000; i++) {
      t += step;
      const p = ray.at(t, new THREE.Vector3());
      if (p.y <= this.heightAt(p.x, p.z)) {
        let lo = prev, hi = t;
        for (let k = 0; k < 20; k++) {
          const mid = (lo + hi) / 2;
          const q = ray.at(mid, new THREE.Vector3());
          if (q.y <= this.heightAt(q.x, q.z)) hi = mid; else lo = mid;
        }
        return ray.at(hi, new THREE.Vector3());
      }
      prev = t;
      if (p.y < -50) break;
    }
    return null;
  }

  private pickAtHeight(cx: number, cy: number, y: number): THREE.Vector3 | null {
    const ray = this.ray(cx, cy);
    if (Math.abs(ray.direction.y) < 1e-4) return null;
    const t = (y - ray.origin.y) / ray.direction.y;
    return t > 0 ? ray.at(t, new THREE.Vector3()) : null;
  }

  private ray(cx: number, cy: number) {
    const r = this.el.getBoundingClientRect();
    const ndc = new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(ndc, this.camera);
    return rc.ray;
  }

  update(dt: number) {
    const k = this.keys, speed = this.dist * 1.1 * dt;
    let fx = 0, fz = 0;
    if (k.has('w') || k.has('arrowup')) fz -= 1;
    if (k.has('s') || k.has('arrowdown')) fz += 1;
    if (k.has('a') || k.has('arrowleft')) fx -= 1;
    if (k.has('d') || k.has('arrowright')) fx += 1;
    if (fx || fz) {
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
      this.target.x += (c * fx + s * fz) * speed;
      this.target.z += (-s * fx + c * fz) * speed;
    }
    if (k.has('q')) this.yaw += 1.5 * dt;
    if (k.has('e')) this.yaw -= 1.5 * dt;
    if (k.has('r')) this.pitch = clamp(this.pitch + 0.8 * dt, 0.12, 1.5);
    if (k.has('f')) this.pitch = clamp(this.pitch - 0.8 * dt, 0.12, 1.5);
    this.dist = clamp(this.dist, this.minDist, this.maxDist);
    this.target.x = clamp(this.target.x, -this.bounds, this.bounds);
    this.target.z = clamp(this.target.z, -this.bounds, this.bounds);
    this.target.y = this.heightAt(this.target.x, this.target.z);
    const a = damp(12, dt), c = this.cur;
    c.x += (this.target.x - c.x) * a; c.y += (this.target.y - c.y) * a; c.z += (this.target.z - c.z) * a;
    c.dist += (this.dist - c.dist) * a; c.yaw += (this.yaw - c.yaw) * a; c.pitch += (this.pitch - c.pitch) * a;
    this.apply();
  }

  private apply() {
    const c = this.cur, cp = Math.cos(c.pitch);
    this.camera.position.set(c.x + c.dist * cp * Math.sin(c.yaw), c.y + c.dist * Math.sin(c.pitch), c.z + c.dist * cp * Math.cos(c.yaw));
    // keep the camera above the ground when skimming low over hills
    const g = this.heightAt(this.camera.position.x, this.camera.position.z) + 2;
    if (this.camera.position.y < g) this.camera.position.y = g;
    this.camera.near = Math.max(0.3, c.dist * 0.004);
    this.camera.far = 30000;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(c.x, c.y, c.z);
  }
}
