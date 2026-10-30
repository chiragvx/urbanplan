// Holes in the terrain where a road runs below it in an open cut (an underpass's trench between retaining walls).
// The ground keeps its natural height right up to the walls — the terrain grid (8 m) is far too coarse to carve a
// vertical edge, so instead the terrain material skips its pixels inside the cut. The cut is kept as a signed distance
// field on a 2 m grid (linearly filtered, so a straight wall line stays straight to a few cm).
import * as THREE from 'three/webgpu';
import { texture, positionWorld, vec2, float } from 'three/tsl';
import type { Stamp } from '../net/generate';

/** metres per texel */
const RES = 2;
/** distances are stored ±RANGE m around the edge */
const RANGE = 4;
/** the cut stops this far short of its ends (under the portal wall / where the road comes up to the ground) */
const INSET = 1;
const enc = (d: number) => Math.max(0, Math.min(255, Math.round(128 + (d * 127) / RANGE)));

export class TerrainHoles {
  private n: number;
  private data: Uint8Array | null = null;
  private tex: THREE.DataTexture;
  private readonly node: ReturnType<typeof texture>;
  /** keep the terrain fragment (outside every cut) — a terrain material's maskNode */
  readonly keep;

  constructor(private readonly half: number) {
    this.n = Math.ceil((2 * half) / RES) + 1;
    // a 1×1 "no holes" texture until the first cut appears (most maps have none)
    this.tex = new THREE.DataTexture(new Uint8Array([255]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.needsUpdate = true;
    this.node = texture(this.tex, vec2(0.5, 0.5));
    const size = this.n * RES;
    const uvw = positionWorld.xz.add(half + RES / 2).div(size);
    this.node.uvNode = uvw;
    this.keep = (this.node as unknown as { r: ReturnType<typeof float> }).r.greaterThan(float(0.5));
  }

  /** Re-make the field in a region from the hole stamps of the mesh items there. Returns whether anything changed. */
  update(region: [number, number, number, number], stamps: Iterable<Stamp>): boolean {
    const holes = [...stamps].filter((s) => s.hole);
    if (!holes.length && !this.data) return false;
    this.ensure();
    const D = this.data!, n = this.n, h = this.half;
    const gi = (x: number) => Math.round((x + h) / RES);
    const i0 = Math.max(0, gi(region[0])), i1 = Math.min(n - 1, gi(region[2])), j0 = Math.max(0, gi(region[1])), j1 = Math.min(n - 1, gi(region[3]));
    let changed = false;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) if (D[j * n + i] !== 255) { D[j * n + i] = 255; changed = true; }
    const put = (i: number, j: number, d: number) => {
      if (i < i0 || i > i1 || j < j0 || j > j1) return;
      const k = j * n + i, v = enc(d);
      if (v < D[k]) { D[k] = v; changed = true; }
    };
    // ends where one cut piece carries on into the next aren't ends
    const ends: [number, number][] = [];
    for (const st of holes) if (st.line) { const p = st.line; ends.push([p[0], p[1]], [p[p.length - 2], p[p.length - 1]]); }
    const joined = (x: number, z: number) => ends.filter(([ex, ez]) => Math.hypot(ex - x, ez - z) < 0.5).length > 1;
    for (const st of holes) {
      if (st.line) {
        const p = st.line, hw = st.hw ?? 0, m = p.length / 2;
        // square ends (the cut stops where its walls do): the end directions over the first / last ≥ 2 m
        const endDir = (k: number, step: number) => {
          let j = k + step;
          while (j > 0 && j < m - 1 && Math.hypot(p[j * 2] - p[k * 2], p[j * 2 + 1] - p[k * 2 + 1]) < 2) j += step;
          const dx = p[k * 2] - p[j * 2], dz = p[k * 2 + 1] - p[j * 2 + 1], l = Math.hypot(dx, dz) || 1;
          return { x: p[k * 2], z: p[k * 2 + 1], ux: dx / l, uz: dz / l }; // pointing out of the line
        };
        const E0 = endDir(0, 1), E1 = endDir(m - 1, -1);
        const caps = [E0, E1].filter((E) => !joined(E.x, E.z));
        const beyond = (x: number, z: number) => {
          for (const E of caps) {
            const along = (x - E.x) * E.ux + (z - E.z) * E.uz + INSET;
            if (along <= 0) continue;
            const across = Math.abs((x - E.x) * E.uz - (z - E.z) * E.ux) - hw;
            return across > 0 ? Math.hypot(along, across) : along;
          }
          return null;
        };
        for (let s = 0; s + 3 < p.length; s += 2) {
          const ax = p[s], az = p[s + 1], bx = p[s + 2], bz = p[s + 3];
          const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1e-9;
          const pad = hw + RANGE;
          for (let j = gi(Math.min(az, bz) - pad); j <= gi(Math.max(az, bz) + pad); j++) for (let i = gi(Math.min(ax, bx) - pad); i <= gi(Math.max(ax, bx) + pad); i++) {
            const x = i * RES - h, z = j * RES - h;
            const out = beyond(x, z);
            if (out !== null) { put(i, j, out); continue; }
            const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
            put(i, j, Math.hypot(x - ax - dx * t, z - az - dz * t) - hw);
          }
        }
      } else if (st.ring) {
        const r = st.ring, m = r.length / 2;
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (let k = 0; k < m; k++) { x0 = Math.min(x0, r[k * 2]); x1 = Math.max(x1, r[k * 2]); z0 = Math.min(z0, r[k * 2 + 1]); z1 = Math.max(z1, r[k * 2 + 1]); }
        for (let j = gi(z0 - RANGE); j <= gi(z1 + RANGE); j++) for (let i = gi(x0 - RANGE); i <= gi(x1 + RANGE); i++) {
          const x = i * RES - h, z = j * RES - h;
          let best = Infinity, inside = false;
          for (let a = 0, b = m - 1; a < m; b = a++) {
            const ax = r[a * 2], az = r[a * 2 + 1], bx = r[b * 2], bz = r[b * 2 + 1];
            if ((az > z) !== (bz > z) && x < ((bx - ax) * (z - az)) / (bz - az) + ax) inside = !inside;
            const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1e-9)));
            best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
          }
          put(i, j, inside ? -best : best);
        }
      }
    }
    if (changed) this.tex.needsUpdate = true;
    return changed;
  }

  private ensure() {
    if (this.data) return;
    this.data = new Uint8Array(this.n * this.n).fill(255);
    const t = new THREE.DataTexture(this.data, this.n, this.n, THREE.RedFormat, THREE.UnsignedByteType);
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    this.tex.dispose();
    this.tex = t;
    this.node.value = t; // same node, so the terrain materials don't recompile
  }
}
