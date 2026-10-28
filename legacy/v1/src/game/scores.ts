// SimCity-style report card. Indicative, not engineering — tuned so improvements are felt.
import { type Tile, type Road, sampleRoad } from '../world/tile';

export interface Scores {
  walk: number; shade: number; safety: number; transit: number; flow: number;
  overall: number; grade: string;
}

export function grade(x: number): string {
  if (x >= 0.88) return 'A+';
  if (x >= 0.78) return 'A';
  if (x >= 0.68) return 'B+';
  if (x >= 0.58) return 'B';
  if (x >= 0.48) return 'C+';
  if (x >= 0.38) return 'C';
  if (x >= 0.28) return 'D+';
  if (x >= 0.18) return 'D';
  return 'F';
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export class ScoreModel {
  naturalShade: Float32Array;
  private bCentroids: Float32Array;

  constructor(private tile: Tile, staticTrees: Float32Array) {
    // Natural shade per road: how much of its length has an existing tree nearby
    const cell = 12;
    const grid = new Map<number, number[]>();
    const key = (x: number, z: number) => Math.floor(x / cell) * 100003 + Math.floor(z / cell);
    for (let i = 0; i < staticTrees.length; i += 2) {
      const k = key(staticTrees[i], staticTrees[i + 1]);
      let a = grid.get(k);
      if (!a) grid.set(k, (a = []));
      a.push(staticTrees[i], staticTrees[i + 1]);
    }
    this.naturalShade = new Float32Array(tile.roads.length);
    for (const r of tile.roads) {
      let hit = 0, n = 0;
      const hint = { seg: 0 };
      for (let s = 0; s <= r.len; s += 10) {
        const q = sampleRoad(r, s, hint);
        n++;
        let found = false;
        for (let dx = -1; dx <= 1 && !found; dx++) for (let dz = -1; dz <= 1 && !found; dz++) {
          const a = grid.get(key(q.x + dx * cell, q.z + dz * cell));
          if (!a) continue;
          for (let j = 0; j < a.length; j += 2) if (Math.hypot(a[j] - q.x, a[j + 1] - q.z) < 15) { found = true; break; }
        }
        if (found) hit++;
      }
      this.naturalShade[r.id] = n ? hit / n : 0;
    }
    this.bCentroids = new Float32Array(tile.buildings.length * 2);
    tile.buildings.forEach((b, i) => { this.bCentroids[i * 2] = b.cx; this.bCentroids[i * 2 + 1] = b.cz; });
  }

  roadWalk(r: Road) {
    const p = r.props;
    return clamp01(Math.min(p.footpath / 2.5, 1) * 0.72 + (p.crossings ? 0.12 : 0) + (p.trees ? 0.1 : 0) + (p.cycle ? 0.06 : 0));
  }
  roadShade(r: Road) { return Math.max(r.props.trees ? 0.92 : 0, this.naturalShade[r.id]); }
  roadSafety(r: Road) {
    const p = r.props;
    return clamp01(0.45 * Math.min(p.footpath / 1.8, 1) + 0.25 * (p.crossings ? 1 : 0) + 0.15 * (p.cycle ? 1 : 0) + 0.15 * (p.median || p.lanes < 4 ? 1 : 0));
  }

  compute(flow: number, pedsOnRoadPct: number): Scores {
    let L = 0, walk = 0, shade = 0, safeL = 0, safe = 0, mainL = 0, busL = 0;
    for (const r of this.tile.roads) {
      if (!r.drive || r.cls === 'service' || r.cls === 'track' || r.cls === 'motorway') continue;
      const w = r.len * (r.clsIndex <= 4 ? 1.6 : 1);
      L += w;
      walk += w * this.roadWalk(r);
      shade += w * this.roadShade(r);
      if (r.clsIndex <= 4) { safeL += r.len; safe += r.len * this.roadSafety(r); }
      if (r.clsIndex <= 3) { mainL += r.len; if (r.props.busLane) busL += r.len; }
    }
    // Transit: share of buildings within 350 m of a bus stop + bus lane coverage on main roads
    let covered = 0;
    const stops = this.tile.busStops;
    const n = this.tile.buildings.length;
    for (let i = 0; i < n; i++) {
      const x = this.bCentroids[i * 2], z = this.bCentroids[i * 2 + 1];
      for (const s of stops) { const dx = s.x - x, dz = s.z - z; if (dx * dx + dz * dz < 350 * 350) { covered++; break; } }
    }
    const coverage = n ? covered / n : 0;
    const transit = clamp01(0.72 * coverage + 0.28 * (mainL ? busL / mainL : 0));
    const walkS = L ? walk / L : 0;
    const safety = clamp01(0.7 * (safeL ? safe / safeL : 0) + 0.3 * (1 - pedsOnRoadPct));
    const flowS = clamp01((flow - 0.25) / 0.6);
    const s = {
      walk: walkS, shade: L ? shade / L : 0, safety, transit, flow: flowS, overall: 0, grade: '',
    };
    s.overall = 0.25 * s.walk + 0.15 * s.shade + 0.2 * s.safety + 0.2 * s.transit + 0.2 * s.flow;
    s.grade = grade(s.overall);
    return s;
  }
}
