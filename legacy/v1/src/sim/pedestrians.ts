// Pedestrians. They use footpaths when they exist — otherwise they walk on the carriageway edge.
// Better footpaths attract more walkers (induced walking), so improvements are visible.
import { InstanceGroup } from '../engine/mesh';
import { hex, hash01, rng } from '../engine/math';
import { type Tile, carriageway, roadSides, sampleRoad } from '../world/tile';

const CLOTHES = [0xe85d4a, 0x3b7dd8, 0xf2f2f2, 0xf2c94c, 0x8e44ad, 0x27ae60, 0xe67e22, 0x2c3e50, 0xd35d9b, 0x16a085];

export class Pedestrians {
  readonly N: number;
  road: Int32Array; dir: Int8Array; s: Float32Array; speed: Float32Array; side: Int8Array;
  color: Uint32Array; active: Uint8Array; seg: Int32Array; jitter: Float32Array;
  private rand = rng(99);
  private cum: Float64Array = new Float64Array(0);
  private table: number[] = [];
  walkability = 0.2; // 0..1, fed from scores
  stats = { active: 0, onRoad: 0, onRoadPct: 0 };
  time = 0;

  constructor(private tile: Tile, max = 2600) {
    this.N = max;
    this.road = new Int32Array(max); this.dir = new Int8Array(max); this.s = new Float32Array(max);
    this.speed = new Float32Array(max); this.side = new Int8Array(max); this.color = new Uint32Array(max);
    this.active = new Uint8Array(max); this.seg = new Int32Array(max); this.jitter = new Float32Array(max);
    for (let i = 0; i < max; i++) {
      this.color[i] = hex(CLOTHES[Math.floor(hash01(i * 5 + 2) * CLOTHES.length)]);
      this.speed[i] = 1.0 + hash01(i * 11) * 0.6;
      this.jitter[i] = (hash01(i * 3) - 0.5) * 0.6;
    }
    this.rebuild();
  }

  /** People walk where there's somewhere to go: weight by road class + footpath quality. */
  rebuild() {
    const cum: number[] = [];
    this.table = [];
    let acc = 0;
    for (const r of this.tile.roads) {
      if (r.cls === 'motorway' || r.cls === 'track') continue;
      const w = r.len * (r.clsIndex <= 4 ? 2 : 1) * (1 + r.props.footpath * 0.8) * (r.props.trees ? 1.4 : 1);
      acc += w;
      cum.push(acc);
      this.table.push(r.id);
    }
    this.cum = Float64Array.from(cum);
  }

  private spawn(i: number) {
    const x = this.rand() * this.cum[this.cum.length - 1];
    let lo = 0, hi = this.cum.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.cum[m] < x) lo = m + 1; else hi = m; }
    const r = this.tile.roads[this.table[lo]];
    this.road[i] = r.id;
    this.dir[i] = this.rand() < 0.5 ? 1 : -1;
    this.s[i] = this.rand() * r.len;
    this.side[i] = roadSides(r).length === 1 || this.rand() < 0.5 ? 1 : -1;
    this.seg[i] = 0;
    this.active[i] = 1;
  }

  step(dt: number) {
    this.time += dt;
    const target = Math.round(this.N * (0.25 + this.walkability * 0.75));
    let spawned = 0;
    for (let i = 0; i < this.N; i++) {
      if (!this.active[i]) {
        if (i < target && spawned < 30) { this.spawn(i); spawned++; }
        continue;
      }
      const r = this.tile.roads[this.road[i]];
      this.s[i] += this.speed[i] * dt * (r.props.footpath < 0.8 && r.drive ? 0.8 : 1);
      if (this.s[i] >= r.len) {
        if (i >= target) { this.active[i] = 0; continue; }
        const node = this.dir[i] > 0 ? r.b : r.a;
        const opts = this.tile.nodeRoads[node].filter((id) => id !== r.id && this.tile.roads[id].cls !== 'motorway');
        if (!opts.length) { this.spawn(i); continue; }
        const next = this.tile.roads[opts[Math.floor(this.rand() * opts.length)]];
        this.road[i] = next.id;
        this.dir[i] = next.a === node ? 1 : -1;
        if (roadSides(next).length === 1) this.side[i] = 1;
        this.s[i] = 0;
        this.seg[i] = 0;
      }
    }
  }

  writeInstances(g: InstanceGroup) {
    g.reset();
    let onRoad = 0, active = 0;
    const hint = { seg: 0 };
    for (let i = 0; i < this.N; i++) {
      if (!this.active[i]) continue;
      active++;
      const r = this.tile.roads[this.road[i]];
      const p = r.props;
      const d = this.dir[i];
      hint.seg = this.seg[i];
      const q = sampleRoad(r, d > 0 ? this.s[i] : r.len - this.s[i], hint);
      this.seg[i] = hint.seg;
      let off: number, y = 0.05;
      if (!r.drive) off = this.jitter[i] * 1.2;
      else {
        const hw = carriageway(r) / 2 + (p.cycle ? 1.8 : 0);
        if (p.footpath >= 0.8) { off = hw + p.footpath * (0.5 + this.jitter[i] * 0.6); y = 0.2; }
        else { off = carriageway(r) / 2 - 0.45 + this.jitter[i] * 0.4; onRoad++; }
        off *= this.side[i];
      }
      const lx = q.dz, lz = -q.dx;
      const yaw = Math.atan2(q.dz * d, q.dx * d);
      const bob = Math.abs(Math.sin(this.time * 7 * this.speed[i] + i)) * 0.05;
      g.push(q.x + lx * off, y + bob, q.z + lz * off, yaw, 1, 1, 1, this.color[i]);
    }
    this.stats.active = active;
    this.stats.onRoad = onRoad;
    this.stats.onRoadPct = active ? onRoad / active : 0;
  }
}
