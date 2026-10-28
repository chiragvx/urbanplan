// Agent-based traffic for Indian mixed traffic.
// - IDM car-following per lane, left-hand traffic (kerb lane = left of travel)
// - Two-wheelers weave laterally and squeeze into gaps
// - Junctions: first-come reservation, main roads have priority over side streets
// - Bus lanes reserve the kerb lane for buses
// - No footpath ⇒ people walk in the kerb lane ⇒ kerb lane is slower
// Pure data + step(dt); no rendering dependencies beyond writing instances, so it can move to a Worker/WASM later.
import { InstanceGroup } from '../engine/mesh';
import { hex, hash01, rng } from '../engine/math';
import { type Tile, type Road, carriageway, sampleRoad } from '../world/tile';

export enum VT { Bike = 0, Car = 1, Auto = 2, Bus = 3 }
const LEN = [1.9, 4.2, 2.7, 11.6];
const ACC = [2.6, 2.0, 1.5, 1.1];
const HEADWAY = [0.7, 1.3, 1.1, 1.6];
const MINGAP = [0.7, 1.8, 1.3, 2.6];
const SPEED_FACTOR = [1.08, 1.0, 0.78, 0.8];

const VMAX: Record<string, number> = {
  motorway: 22, trunk: 17, primary: 13.5, secondary: 11.5, tertiary: 9.5, residential: 7,
  service: 4.5, living_street: 4, track: 4, busway: 14,
};

const CAR_COLORS = [0xf4f4f2, 0xf4f4f2, 0xf0f0ee, 0xc4c8cc, 0xb8bcc0, 0x7d8288, 0x9c2a2a, 0x2a4f8c, 0x1d1f22, 0x6b3a2e, 0xd9d2c0, 0x3c6e8f];
const SHIRTS = [0x2f6db5, 0xd94f3d, 0xf2f2f2, 0x3a3a3a, 0x8bb34a, 0xe0b23a, 0x6a4c93, 0x2a9d8f, 0xc77d4a];
const AUTO_TOPS = [0xf2c218, 0xe8b912, 0xf2c218, 0x2e8b3a];
const BUS_COLORS = [0x2b6cb0, 0x1f7a6d, 0xb5462f];

interface Move { road: number; dir: 1 | -1 }

export class Traffic {
  readonly N: number;
  road: Int32Array; dir: Int8Array; s: Float32Array; v: Float32Array;
  lane: Int8Array; lat: Float32Array; latJitter: Float32Array; type: Uint8Array; color: Uint32Array;
  vf: Float32Array; active: Uint8Array; seg: Int32Array; lcTimer: Float32Array; wait: Float32Array;

  private out: Move[][];
  private boundaryEntries: Move[] = [];
  private spawnTable: Move[] = [];
  private spawnCum: Float64Array = new Float64Array(0);
  private nodeBusyUntil: Float32Array;
  private nodeBusyCls: Uint8Array;
  private degree: Uint8Array;
  private edMinS: Float32Array;
  private rand = rng(7);
  time = 0;

  density = 1;     // player slider
  demand = 1;      // time-of-day curve
  stats = { active: 0, avgKmh: 0, flow: 1, stopped: 0, busKmh: 0 };

  constructor(private tile: Tile, maxAgents = 4500) {
    this.N = maxAgents;
    const N = maxAgents;
    this.road = new Int32Array(N); this.dir = new Int8Array(N); this.s = new Float32Array(N); this.v = new Float32Array(N);
    this.lane = new Int8Array(N); this.lat = new Float32Array(N); this.latJitter = new Float32Array(N);
    this.type = new Uint8Array(N); this.color = new Uint32Array(N); this.vf = new Float32Array(N);
    this.active = new Uint8Array(N); this.seg = new Int32Array(N); this.lcTimer = new Float32Array(N); this.wait = new Float32Array(N);

    const nodeCount = tile.nodes.length / 2;
    this.nodeBusyUntil = new Float32Array(nodeCount);
    this.nodeBusyCls = new Uint8Array(nodeCount);
    this.degree = new Uint8Array(nodeCount);
    this.edMinS = new Float32Array(tile.roads.length * 2);
    this.out = Array.from({ length: nodeCount }, () => []);
    this.rebuildGraph();

    // Pune mix: lots of two-wheelers
    for (let i = 0; i < N; i++) {
      const r = hash01(i * 9 + 1);
      const t = r < 0.5 ? VT.Bike : r < 0.83 ? VT.Car : r < 0.965 ? VT.Auto : VT.Bus;
      this.type[i] = t;
      const h = hash01(i * 31 + 7);
      this.color[i] = hex(
        t === VT.Car ? CAR_COLORS[Math.floor(h * CAR_COLORS.length)]
          : t === VT.Bike ? SHIRTS[Math.floor(h * SHIRTS.length)]
            : t === VT.Auto ? AUTO_TOPS[Math.floor(h * AUTO_TOPS.length)]
              : BUS_COLORS[Math.floor(h * BUS_COLORS.length)],
      );
      this.vf[i] = SPEED_FACTOR[t] * (0.85 + hash01(i * 13) * 0.3);
      this.latJitter[i] = t === VT.Bike ? (hash01(i * 17) - 0.5) * 1.6 : (hash01(i * 17) - 0.5) * 0.3;
    }
  }

  /** Call after edits that change lanes/drivability. */
  rebuildGraph() {
    const t = this.tile;
    for (const o of this.out) o.length = 0;
    this.degree.fill(0);
    for (const r of t.roads) {
      if (!r.drive) continue;
      this.degree[r.a]++;
      if (r.b !== r.a) this.degree[r.b]++;
      this.out[r.a].push({ road: r.id, dir: 1 });
      if (!r.oneway) this.out[r.b].push({ road: r.id, dir: -1 });
    }
    // Entries from the tile boundary (through traffic) + weighted spawn table
    this.boundaryEntries = [];
    this.spawnTable = [];
    const cum: number[] = [];
    let acc = 0;
    const edge = t.half - 25;
    for (let n = 0; n < this.out.length; n++) {
      const x = t.nodes[n * 2], z = t.nodes[n * 2 + 1];
      if (this.degree[n] === 1 && (Math.abs(x) > edge || Math.abs(z) > edge)) for (const m of this.out[n]) this.boundaryEntries.push(m);
    }
    for (const r of t.roads) {
      if (!r.drive) continue;
      const w = r.len * Math.max(1, r.props.lanes) * (r.clsIndex <= 4 ? 2.5 : r.clsIndex === 5 ? 1 : 0.35);
      for (const dir of r.oneway ? [1] : [1, -1]) {
        acc += w;
        this.spawnTable.push({ road: r.id, dir: dir as 1 | -1 });
        cum.push(acc);
      }
    }
    this.spawnCum = Float64Array.from(cum);
  }

  private lanesDir(r: Road) {
    return r.oneway ? Math.max(1, r.props.lanes) : Math.max(1, Math.floor(r.props.lanes / 2));
  }

  private allowedLanes(r: Road, type: number): [number, number] {
    const L = this.lanesDir(r);
    if (r.props.busLane && L >= 2) return type === VT.Bus ? [0, 0] : [1, L - 1];
    return [0, L - 1];
  }

  private laneOffset(r: Road, lane: number) {
    const L = this.lanesDir(r);
    const p = r.props;
    const cw = carriageway(r);
    const lw = (cw - (p.median ? 1.2 : 0)) / Math.max(1, p.lanes);
    if (r.oneway) return cw / 2 - (lane + 0.5) * lw;
    return (p.median ? 0.6 : 0) + (L - lane - 0.5) * lw;
  }

  private pickSpawn(): Move {
    const total = this.spawnCum[this.spawnCum.length - 1];
    const x = this.rand() * total;
    let lo = 0, hi = this.spawnCum.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.spawnCum[mid] < x) lo = mid + 1; else hi = mid; }
    return this.spawnTable[lo];
  }

  private place(i: number, m: Move, s: number) {
    const r = this.tile.roads[m.road];
    this.road[i] = m.road; this.dir[i] = m.dir; this.s[i] = s;
    const [l0, l1] = this.allowedLanes(r, this.type[i]);
    this.lane[i] = l0 + Math.floor(this.rand() * (l1 - l0 + 1));
    this.lat[i] = this.laneOffset(r, this.lane[i]);
    this.v[i] = VMAX[r.cls] * 0.5;
    this.seg[i] = 0;
    this.wait[i] = 0;
    this.active[i] = 1;
  }

  private spawn(i: number, fromBoundary: boolean): boolean {
    for (let tries = 0; tries < 4; tries++) {
      const m = fromBoundary && this.boundaryEntries.length && this.rand() < 0.7
        ? this.boundaryEntries[Math.floor(this.rand() * this.boundaryEntries.length)]
        : this.pickSpawn();
      const r = this.tile.roads[m.road];
      if (this.type[i] === VT.Bus && r.clsIndex > 4) continue;
      const s = fromBoundary ? 0 : this.rand() * r.len;
      const ed = m.road * 2 + (m.dir > 0 ? 0 : 1);
      if (fromBoundary && this.edMinS[ed] < 12) continue;
      this.place(i, m, s);
      return true;
    }
    return false;
  }

  private chooseNext(i: number, node: number): Move | null {
    const cur = this.road[i];
    const opts = this.out[node];
    if (!opts.length) return null;
    const isBus = this.type[i] === VT.Bus;
    let total = 0;
    const w: number[] = [];
    for (const m of opts) {
      let wt = 0;
      if (m.road !== cur || opts.length === 1) {
        const r = this.tile.roads[m.road];
        wt = Math.pow(1 / (r.clsIndex + 1), isBus ? 2.5 : 1.1) * (r.props.lanes + 1);
        if (m.road === cur) wt *= 0.05; // U-turn only if forced
        if (isBus && r.props.busLane) wt *= 4;
      }
      w.push(wt);
      total += wt;
    }
    if (total <= 0) return null;
    let x = this.rand() * total;
    for (let k = 0; k < opts.length; k++) { x -= w[k]; if (x <= 0) return opts[k]; }
    return opts[opts.length - 1];
  }

  setActiveTarget(): number {
    return Math.min(this.N, Math.round(this.N * 0.75 * this.density * this.demand));
  }

  step(dt: number) {
    if (dt <= 0) return;
    const sub = Math.ceil(dt / 0.1);
    const h = dt / sub;
    for (let k = 0; k < sub; k++) this.stepOnce(h);
  }

  private order: number[] = [];

  private stepOnce(dt: number) {
    this.time += dt;
    const T = this.tile;
    const target = this.setActiveTarget();
    const { road, dir, s, v, lane, type, active } = this;

    // spawn a few per step to fill up smoothly
    let spawned = 0;
    for (let i = 0; i < target && spawned < 25; i++) {
      if (!active[i]) { if (this.spawn(i, this.time > 3)) spawned++; }
    }

    // bucket by (edge-direction, lane), leaders first
    const ord = this.order;
    ord.length = 0;
    for (let i = 0; i < this.N; i++) if (active[i]) ord.push(i);
    const key = (i: number) => (road[i] * 2 + (dir[i] > 0 ? 0 : 1)) * 8 + lane[i];
    ord.sort((a, b) => key(a) - key(b) || s[b] - s[a]);
    this.edMinS.fill(1e9);
    for (const i of ord) {
      const ed = road[i] * 2 + (dir[i] > 0 ? 0 : 1);
      if (s[i] < this.edMinS[ed]) this.edMinS[ed] = s[i];
    }
    const groupStart = new Map<number, number>();
    for (let k = 0; k < ord.length; k++) { const kk = key(ord[k]); if (!groupStart.has(kk)) groupStart.set(kk, k); }

    let sumV = 0, sumFlow = 0, stopped = 0, cnt = 0, busV = 0, busN = 0;

    for (let k = 0; k < ord.length; k++) {
      const i = ord[k];
      const r = T.roads[road[i]];
      const ty = type[i];
      const kk = key(i);
      const L = r.len;
      let v0 = VMAX[r.cls] * this.vf[i];
      // people walking on the road (no footpath) slow the kerb lane
      if (r.props.footpath < 0.8 && lane[i] === 0 && r.clsIndex <= 5) v0 *= ty === VT.Bike ? 0.85 : 0.68;
      if (ty === VT.Bus && r.props.busLane) v0 *= 1.15;

      // leader in same lane
      let gap = 1e9, vLead = v0;
      if (k > 0 && key(ord[k - 1]) === kk) {
        const j = ord[k - 1];
        gap = s[j] - s[i] - (LEN[type[j]] + LEN[ty]) / 2;
        vLead = v[j];
      } else {
        // approaching the end of the edge
        const node = dir[i] > 0 ? r.b : r.a;
        const toEnd = L - s[i];
        const blocked = this.degree[node] >= 3 && this.nodeBusyUntil[node] > this.time && this.nodeBusyCls[node] <= r.clsIndex + 1;
        if (blocked && toEnd < 25) { gap = toEnd - 1; vLead = 0; }
      }

      // IDM
      const a = ACC[ty], b = 3;
      const sStar = MINGAP[ty] + Math.max(0, v[i] * HEADWAY[ty] + (v[i] * (v[i] - vLead)) / (2 * Math.sqrt(a * b)));
      let acc = a * (1 - Math.pow(v[i] / Math.max(v0, 0.1), 4) - Math.pow(sStar / Math.max(gap, 0.1), 2));
      if (gap < 0.3) acc = -9;
      v[i] = Math.max(0, Math.min(v0 * 1.05, v[i] + acc * dt));
      s[i] += v[i] * dt;

      // lane change / weaving
      this.lcTimer[i] -= dt;
      if (this.lcTimer[i] <= 0) {
        this.lcTimer[i] = (ty === VT.Bike ? 0.6 : 1.8) + this.rand();
        const [l0, l1] = this.allowedLanes(r, ty);
        let cur = lane[i];
        if (cur < l0 || cur > l1) cur = l0;
        if (gap < 30 || cur !== lane[i]) {
          let bestLane = cur, bestGap = gap;
          for (const cand of [cur - 1, cur + 1]) {
            if (cand < l0 || cand > l1) continue;
            const g = this.gapInLane(ord, groupStart, (kk & ~7) | cand, s[i], LEN[ty]);
            if (g.ok && g.ahead > bestGap + (ty === VT.Bike ? 2 : 8)) { bestGap = g.ahead; bestLane = cand; }
          }
          lane[i] = bestLane;
        }
      }
      const targetLat = this.laneOffset(r, lane[i]) + this.latJitter[i] * (ty === VT.Bike ? Math.sin(this.time * 0.4 + i) : 1);
      this.lat[i] += (targetLat - this.lat[i]) * Math.min(1, dt * 1.6);

      // end of edge → next edge
      if (s[i] >= L) {
        const node = dir[i] > 0 ? r.b : r.a;
        if (i >= target) { active[i] = 0; continue; }
        const next = this.chooseNext(i, node);
        if (!next || (this.degree[node] === 1 && next.road === road[i])) {
          // boundary or dead end: through-traffic leaves, a new vehicle enters elsewhere
          if (!this.spawn(i, true)) active[i] = 0;
          continue;
        }
        const nr = T.roads[next.road];
        const ned = next.road * 2 + (next.dir > 0 ? 0 : 1);
        const busy = this.degree[node] >= 3 && this.nodeBusyUntil[node] > this.time && this.nodeBusyCls[node] <= r.clsIndex + 1;
        if (busy || this.edMinS[ned] < LEN[ty] + 1) {
          s[i] = L; v[i] = 0; this.wait[i] += dt;
          if (this.wait[i] > 25) { if (!this.spawn(i, true)) active[i] = 0; } // gridlock relief
          continue;
        }
        if (this.degree[node] >= 3) {
          this.nodeBusyUntil[node] = this.time + (ty === VT.Bike ? 0.35 : ty === VT.Bus ? 1.6 : 0.8);
          this.nodeBusyCls[node] = r.clsIndex;
        }
        const over = s[i] - L;
        road[i] = next.road; dir[i] = next.dir; s[i] = Math.min(over, nr.len * 0.5); this.seg[i] = 0; this.wait[i] = 0;
        const [l0, l1] = this.allowedLanes(nr, ty);
        lane[i] = Math.max(l0, Math.min(l1, lane[i]));
      }

      sumV += v[i]; sumFlow += Math.min(1, v[i] / Math.max(v0, 0.1)); cnt++;
      if (v[i] < 0.5) stopped++;
      if (ty === VT.Bus) { busV += v[i]; busN++; }
    }

    const e = Math.min(1, dt * 0.5);
    const st = this.stats;
    st.active = cnt;
    st.avgKmh += ((cnt ? (sumV / cnt) * 3.6 : 0) - st.avgKmh) * e;
    st.flow += ((cnt ? sumFlow / cnt : 1) - st.flow) * e;
    st.stopped = stopped;
    st.busKmh += ((busN ? (busV / busN) * 3.6 : 0) - st.busKmh) * e;
  }

  private gapInLane(ord: number[], groupStart: Map<number, number>, key: number, si: number, len: number) {
    const start = groupStart.get(key);
    if (start === undefined) return { ok: true, ahead: 1e9 };
    let ahead = 1e9, ok = true;
    const { road, dir, lane, s } = this;
    for (let k = start; k < ord.length; k++) {
      const j = ord[k];
      if ((road[j] * 2 + (dir[j] > 0 ? 0 : 1)) * 8 + lane[j] !== key) break;
      const d = s[j] - si;
      if (d > 0) ahead = Math.min(ahead, d - len);
      else if (d > -(len + 4)) ok = false; // someone right beside/behind
    }
    return { ok, ahead };
  }

  /** Write render instances for each vehicle type. */
  writeInstances(groups: InstanceGroup[]) {
    for (const g of groups) g.reset();
    const T = this.tile;
    const hint = { seg: 0 };
    for (let i = 0; i < this.N; i++) {
      if (!this.active[i]) continue;
      const r = T.roads[this.road[i]];
      const d = this.dir[i];
      const sp = d > 0 ? this.s[i] : r.len - this.s[i];
      hint.seg = this.seg[i];
      const q = sampleRoad(r, sp, hint);
      this.seg[i] = hint.seg;
      const tx = q.dx * d, tz = q.dz * d;
      const lx = tz, lz = -tx; // left of travel
      const lat = this.lat[i];
      const yaw = Math.atan2(tz, tx);
      groups[this.type[i]].push(q.x + lx * lat, 0.05, q.z + lz * lat, yaw, 1, 1, 1, this.color[i]);
    }
  }
}
