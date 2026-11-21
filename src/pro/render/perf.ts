// ?perf: a small overlay over the 3D with the frame time, draw calls, triangles, geometries and textures, and the
// quality tier; and a benchmark (proView.bench() in the console, or ?bench) that orbits the camera for 600 frames and
// reports the p50 and p95 frame time with the counts, so each phase's budgets can be checked.
import type * as THREE from 'three';

export class PerfOverlay {
  private el: HTMLDivElement;
  private t: number[] = [];
  private last = 0;
  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:absolute;left:8px;bottom:8px;z-index:5;font:11px/1.35 ui-monospace,monospace;background:rgba(0,0,0,.66);color:#fff;padding:6px 8px;border-radius:6px;pointer-events:none;white-space:pre';
    parent.appendChild(this.el);
  }
  update(r: THREE.WebGLRenderer, tier: string) {
    const now = performance.now();
    if (this.last) { this.t.push(now - this.last); if (this.t.length > 60) this.t.shift(); }
    this.last = now;
    const s = [...this.t].sort((a, b) => a - b), p = (q: number) => (s.length ? s[Math.floor(s.length * q)] : 0);
    const i = r.info;
    this.el.textContent = `${tier}  p50 ${p(0.5).toFixed(1)} ms  p95 ${p(0.95).toFixed(1)} ms\ncalls ${i.render.calls}  tris ${(i.render.triangles / 1000).toFixed(0)}k\ngeo ${i.memory.geometries}  tex ${i.memory.textures}`;
  }
  dispose() { this.el.remove(); }
}

export interface BenchResult { frames: number; p50: number; p95: number; calls: number; triangles: number; geometries: number; textures: number }
