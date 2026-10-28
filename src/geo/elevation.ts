// Road elevation as a continuous field, so every shared edge between roads and junctions matches exactly.
//
// Bridges are classified by what they actually cross:
//   overpass   — crosses another road/railway below → ends lifted DECK·layer, ramps spread along neighbours
//   valley     — crosses water/nala/terrain dip    → deck runs straight between its (ground-level) ends
//   footbridge — pedestrian overbridge               → deck lifted in the middle, stairs at the ends (no ramps)
//
// Surface heights:
//   ground junction vertex        z = T(x,z)
//   lifted junction (O_i > 0)     z = T(centroid) + O_i                 (flat platform)
//   ground road vertex            z = T(x,z)
//   overpass / ramp road vertex   z = lerp(E_src(p), E_dst(p), ease(t)),   E_i(p) = O_i>0 ? Z_i : T(p)
//   valley bridge vertex          z = lerp(Zc_src, Zc_dst, t)               Zc_i = T(centroid) + O_i
//   footbridge vertex             z = T(p) + DECK·env(t)
import type { StreetNet, StreetRoad } from './streets';
import type { Heightfield } from './heightfield';

export const DECK = 6.5;
const MAX_GRADE = 0.065;
const LIFT = 0.06;
const FOOT = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'corridor', 'bridleway']);

export type BridgeKind = 'none' | 'overpass' | 'valley' | 'footbridge';

export interface RoadProfile {
  kind: BridgeKind;
  /** Uses an interpolated profile instead of following the terrain (bridges + ramps). */
  elevated: boolean;
  bridge: boolean;
  deck: number;
  cum: Float32Array;
  len: number;
}

type Seg = [number, number, number, number];

function segsOf(c: Float32Array): Seg[] {
  const out: Seg[] = [];
  for (let i = 0; i + 3 < c.length; i += 2) out.push([c[i], c[i + 1], c[i + 2], c[i + 3]]);
  return out;
}
function segCross(a: Seg, b: Seg): boolean {
  const d = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d1 = d(b[0], b[1], b[2], b[3], a[0], a[1]), d2 = d(b[0], b[1], b[2], b[3], a[2], a[3]);
  const d3 = d(a[0], a[1], a[2], a[3], b[0], b[1]), d4 = d(a[0], a[1], a[2], a[3], b[2], b[3]);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export class Elevation {
  offset = new Map<number, number>();
  z = new Map<number, number>();
  profiles = new Map<number, RoadProfile>();
  stats = { overpass: 0, valley: 0, footbridge: 0, ramps: 0 };

  constructor(
    private net: StreetNet, private hf: Heightfield, private wayFlags: Record<string, [number, number, number]>,
    private railLines: Float32Array[] = [],
  ) {
    this.solve();
  }

  private flags(r: StreetRoad) {
    let bridge = false, layer = r.layer ?? 0, tunnel = false;
    for (const w of r.wayIds) {
      const f = this.wayFlags[String(w)];
      if (!f) continue;
      bridge ||= f[0] === 1;
      layer = Math.max(layer, f[1]);
      tunnel ||= f[2] === 1;
    }
    return { bridge, layer, tunnel };
  }

  /** Does this road cross (in plan) another road on a lower layer, or a railway? */
  private crossesSomething(r: StreetRoad, layer: number, grid: Map<number, { road: StreetRoad; seg: Seg }[]>): boolean {
    for (const s of segsOf(r.center)) {
      for (const k of cellsOf(s)) {
        for (const o of grid.get(k) ?? []) {
          if (o.road.id === r.id || o.road.src === r.src || o.road.src === r.dst || o.road.dst === r.src || o.road.dst === r.dst) continue;
          const ol = this.flags(o.road);
          if ((ol.bridge || ol.layer >= 1) && ol.layer >= layer) continue;
          if (segCross(s, o.seg)) return true;
        }
      }
      for (const line of this.railLines) for (const rs of segsOf(line)) if (segCross(s, rs)) return true;
    }
    return false;
  }

  private solve() {
    const { net } = this;
    // spatial grid of road centre segments for crossing tests
    const grid = new Map<number, { road: StreetRoad; seg: Seg }[]>();
    for (const r of net.roads.values()) for (const s of segsOf(r.center)) for (const k of cellsOf(s)) (grid.get(k) ?? grid.set(k, []).get(k)!).push({ road: r, seg: s });

    // 1) classify bridges, lengths
    for (const r of net.roads.values()) {
      const n = r.center.length / 2;
      const cum = new Float32Array(Math.max(n, 1));
      for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(r.center[i * 2] - r.center[i * 2 - 2], r.center[i * 2 + 1] - r.center[i * 2 - 1]);
      const len = cum[cum.length - 1] || 0.01;
      const f = this.flags(r);
      let kind: BridgeKind = 'none';
      if (!f.tunnel && (f.bridge || f.layer >= 1)) {
        const over = this.crossesSomething(r, Math.max(1, f.layer), grid);
        kind = FOOT.has(r.highway) ? (over ? 'footbridge' : 'valley') : over ? 'overpass' : 'valley';
      }
      const deck = kind === 'overpass' || kind === 'footbridge' ? DECK * Math.max(1, f.layer) : 0;
      this.profiles.set(r.id, { kind, elevated: kind !== 'none', bridge: kind !== 'none', deck, cum, len });
      if (kind !== 'none') this.stats[kind]++;
      if (kind === 'overpass') for (const i of [r.src, r.dst]) this.offset.set(i, Math.max(this.offset.get(i) ?? 0, deck));
    }

    // 2) relax lifts along ordinary roads so ramps stay under MAX_GRADE (max-heap Dijkstra)
    const adj = new Map<number, { to: number; len: number }[]>();
    for (const r of net.roads.values()) {
      const p = this.profiles.get(r.id)!;
      if (p.kind === 'overpass' || p.kind === 'footbridge' || r.src === r.dst) continue;
      const a = net.intersections.get(r.src), b = net.intersections.get(r.dst);
      if (!a || !b) continue;
      const len = p.len + Math.hypot(a.cx - b.cx, a.cz - b.cz) * 0.15;
      (adj.get(r.src) ?? adj.set(r.src, []).get(r.src)!).push({ to: r.dst, len });
      (adj.get(r.dst) ?? adj.set(r.dst, []).get(r.dst)!).push({ to: r.src, len });
    }
    const heap: [number, number][] = [];
    const push = (v: number, id: number) => {
      heap.push([v, id]);
      let i = heap.length - 1;
      while (i > 0) { const q = (i - 1) >> 1; if (heap[q][0] >= heap[i][0]) break; [heap[q], heap[i]] = [heap[i], heap[q]]; i = q; }
    };
    const pop = () => {
      const top = heap[0], last = heap.pop()!;
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, rr = l + 1;
          let m = i;
          if (l < heap.length && heap[l][0] > heap[m][0]) m = l;
          if (rr < heap.length && heap[rr][0] > heap[m][0]) m = rr;
          if (m === i) break;
          [heap[m], heap[i]] = [heap[i], heap[m]];
          i = m;
        }
      }
      return top;
    };
    for (const [id, o] of this.offset) if (o > 0) push(o, id);
    while (heap.length) {
      const [o, id] = pop();
      if (o < (this.offset.get(id) ?? 0)) continue;
      for (const e of adj.get(id) ?? []) {
        const v = o - MAX_GRADE * e.len;
        if (v > 0.25 && v > (this.offset.get(e.to) ?? 0)) { this.offset.set(e.to, v); push(v, e.to); }
      }
    }

    // 3) platforms + ramps
    for (const i of net.intersections.values()) {
      const o = this.offset.get(i.id) ?? 0;
      if (o > 0) this.z.set(i.id, this.hf.sample(i.cx, i.cz) + o);
    }
    for (const r of net.roads.values()) {
      const p = this.profiles.get(r.id)!;
      if (p.kind === 'none' && ((this.offset.get(r.src) ?? 0) > 0 || (this.offset.get(r.dst) ?? 0) > 0)) { p.elevated = true; this.stats.ramps++; }
    }
  }

  roadT(r: StreetRoad, x: number, z: number): number {
    const c = r.center, n = c.length / 2;
    const p = this.profiles.get(r.id)!;
    if (n < 2) return 0.5;
    let best = Infinity, bs = 0;
    for (let i = 0; i < n - 1; i++) {
      const ax = c[i * 2], az = c[i * 2 + 1], dx = c[i * 2 + 2] - ax, dz = c[i * 2 + 3] - az;
      const L2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
      const d = (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2;
      if (d < best) { best = d; bs = p.cum[i] + Math.sqrt(L2) * t; }
    }
    return Math.max(0, Math.min(1, bs / p.len));
  }

  private endZ(i: number, x: number, z: number) {
    return (this.offset.get(i) ?? 0) > 0 ? this.z.get(i)! : this.hf.sample(x, z);
  }
  private centroidZ(i: number) {
    const it = this.net.intersections.get(i);
    const o = this.offset.get(i) ?? 0;
    return it ? this.hf.sample(it.cx, it.cz) + o : 0;
  }

  roadZ(r: StreetRoad, x: number, z: number): number {
    const p = this.profiles.get(r.id);
    if (!p || !p.elevated) return this.hf.sample(x, z) + LIFT;
    const t = this.roadT(r, x, z);
    const g = this.hf.sample(x, z);
    if (p.kind === 'valley') {
      const v = this.centroidZ(r.src) + (this.centroidZ(r.dst) - this.centroidZ(r.src)) * t;
      return Math.max(v, g) + LIFT;
    }
    if (p.kind === 'footbridge') {
      const env = Math.min(1, Math.min(t, 1 - t) * p.len / 6); // ~6 m of stairs at each end
      return g + p.deck * env + LIFT;
    }
    const e = 0.5 * t + 0.5 * t * t * (3 - 2 * t);
    const za = this.endZ(r.src, x, z), zb = this.endZ(r.dst, x, z);
    let v = za + (zb - za) * e;
    if (p.kind === 'overpass') v = Math.max(v, g + p.deck * 0.85 * Math.min(1, 4 * Math.min(t, 1 - t) + 0.25));
    return v + LIFT;
  }

  junctionZ(id: number, x: number, z: number): number {
    return this.endZ(id, x, z) + LIFT;
  }
}

function cellsOf(s: Seg): number[] {
  const C = 60;
  const out: number[] = [];
  const i0 = Math.floor(Math.min(s[0], s[2]) / C), i1 = Math.floor(Math.max(s[0], s[2]) / C);
  const j0 = Math.floor(Math.min(s[1], s[3]) / C), j1 = Math.floor(Math.max(s[1], s[3]) / C);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) out.push(i * 73856093 ^ j * 19349663);
  return out;
}
