// "Compare with OpenStreetMap": the raw OSM road centre lines (written at bake time) drawn over the map in 2D, and
// the places where the map's roads have moved more than a few metres off them listed in Issues — the same measure as
// tools/dev/check-roads.mjs (a divided road is measured from the midline of its two halves).
import type { CityDoc } from '../doc/doc';
import type { Issue } from '../doc/issues';
import * as ops from '../doc/ops';
import { fetchText } from '../data/region';

interface Way { id: number; hw: string; p: Float32Array; box: [number, number, number, number] }

export class OsmCompare {
  ways: Way[] | null = null;
  private byId = new Map<number, Way>();
  private loading: Promise<void> | null = null;
  source = '';

  constructor(private base: string) {}

  load(): Promise<void> {
    if (this.ways) return Promise.resolve();
    // a region's file is gzipped; a tile's plain
    const get = fetchText(`${this.base}osm-roads.json.gz`).then((t) => JSON.parse(t)).catch(() => fetch(`${this.base}osm-roads.json`).then((r) => (r.ok ? r.json() : { ways: [] })));
    this.loading ??= get.then((j: { source?: string; ways: { id: number; hw: string; p: number[] }[] }) => {
      this.source = j.source ?? '';
      this.ways = j.ways.map((w) => {
        const p = Float32Array.from(w.p);
        let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
        return { id: w.id, hw: w.hw, p, box: [x0, z0, x1, z1] as [number, number, number, number] };
      });
      for (const w of this.ways) this.byId.set(w.id, w);
    }).catch(() => { this.ways = []; });
    return this.loading;
  }

  /** OSM lines in a world rectangle. */
  inRect(x0: number, z0: number, x1: number, z1: number): Way[] {
    return (this.ways ?? []).filter((w) => w.box[0] <= x1 && w.box[2] >= x0 && w.box[1] <= z1 && w.box[3] >= z0);
  }

  /** Where sections sit more than `limit` m off the OSM ways they came from (one issue per 150 m cell, worst first). */
  issues(doc: CityDoc, limit = 6): Issue[] {
    if (!this.ways) return [];
    const near = (qx: number, qz: number, hx: number, hz: number, w: Way) => {
      let best = Infinity, cx = qx, cz = qz;
      const p = w.p;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const ax = p[i], az = p[i + 1], dx = p[i + 2] - ax, dz = p[i + 3] - az;
        const t = Math.max(0, Math.min(1, ((qx - ax) * dx + (qz - az) * dz) / (dx * dx + dz * dz || 1)));
        const x = ax + dx * t, z = az + dz * t, d = Math.hypot(x - qx, z - qz);
        if (d < best) { best = d; cx = x; cz = z; }
      }
      return { d: best, sg: Math.sign(hx * (cz - qz) - hz * (cx - qx)) };
    };
    const worst = new Map<string, Issue & { d: number }>();
    for (const s of doc.all('section')) {
      const ways = (s.wayIds ?? []).map((id) => this.byId.get(id)).filter((w): w is Way => !!w);
      if (!ways.length) continue;
      const S = ops.samplePath(ops.anchorsOf(doc, s), 16);
      for (let i = 1; i + 1 < S.pts.length; i++) {
        if (S.s[i] < 12 || S.len - S.s[i] < 12) continue; // junction ends move on purpose
        const [qx, qz] = S.pts[i], hx = S.pts[i + 1][0] - S.pts[i - 1][0], hz = S.pts[i + 1][1] - S.pts[i - 1][1];
        const N = ways.map((w) => near(qx, qz, hx, hz, w)).sort((a, b) => a.d - b.d);
        const opp = N.find((x) => x !== N[0] && x.d < 25 && x.sg !== N[0].sg);
        const d = opp ? Math.abs(N[0].d - opp.d) / 2 : N[0].d;
        if (d <= limit) continue;
        const k = `${Math.round(qx / 150)},${Math.round(qz / 150)}`;
        const cur = worst.get(k);
        if (cur && cur.d >= d) continue;
        worst.set(k, { key: `osm:${k}`, sev: 'info', title: 'Off the OpenStreetMap line', detail: `${s.name || 'A road'} is ${d.toFixed(1)} m from where OpenStreetMap has it${doc.patch.has(s.id) ? ' (edited here)' : ''}`, x: qx, z: qz, ids: [s.id], d });
      }
    }
    return [...worst.values()].sort((a, b) => b.d - a.d).map(({ d, ...i }) => { void d; return i; });
  }
}
