// Map checks: roads that overlap or cross without a junction, dead ends that almost touch a road, lanes too narrow
// to drive, curves tighter than the road is wide, widths far from the Development Plan reserve.
import type { CityDoc } from './doc';
import type { Compiler } from './compile';
import type { Id, SectionObj } from './types';
import { totalWidth } from './xsection';
import { anchorsOf, crossingsOf, samplePath, SAME_LEVEL } from './ops';

/** Headroom (m) under a bridge below which it is flagged (5.5 m is the usual clearance; imported decks are estimates). */
const CLEARANCE = 5;

export interface Issue {
  key: string;
  sev: 'error' | 'warn' | 'info';
  title: string;
  detail: string;
  x: number; z: number;
  ids: Id[];
}

export type Near = (x0: number, z0: number, x1: number, z1: number) => Iterable<Id>;

function sectionChecks(doc: CityDoc, C: Compiler, s: SectionObj, near: Near, out: Issue[]) {
  const g = C.geo(s.id);
  if (!g) return;
  const hwA = Math.max(g.t.hwL, g.t.hwR);
  const n = g.pts.length / 2;
  const name = s.name || 'Unnamed road';
  // lanes
  const lanes = s.parts.filter((p) => p.kind === 'lane');
  const narrow = lanes.filter((p) => p.width < 2.6);
  if (narrow.length) out.push({ key: `lane:${s.id}`, sev: 'warn', title: 'Lanes too narrow', detail: `${name}: ${narrow.length} lane(s) under 2.6 m (${Math.min(...narrow.map((p) => p.width)).toFixed(2)} m)`, x: g.pts[(n >> 1) * 2], z: g.pts[(n >> 1) * 2 + 1], ids: [s.id] });
  // DP reserve
  const w = totalWidth(s.parts);
  if (s.reserve && w > s.reserve + 1.5) out.push({ key: `dp:${s.id}`, sev: 'info', title: 'Wider than the Development Plan', detail: `${name}: ${w.toFixed(1)} m vs DP reserve ${s.reserve} m`, x: g.pts[(n >> 1) * 2], z: g.pts[(n >> 1) * 2 + 1], ids: [s.id] });
  // tight curves: turning radius along the centre line vs half width
  for (let i = 2; i < n - 2; i += 2) {
    const ax = g.pts[(i - 2) * 2], az = g.pts[(i - 2) * 2 + 1], bx = g.pts[i * 2], bz = g.pts[i * 2 + 1], cx = g.pts[(i + 2) * 2], cz = g.pts[(i + 2) * 2 + 1];
    const a = Math.hypot(bx - ax, bz - az), b = Math.hypot(cx - bx, cz - bz), c = Math.hypot(cx - ax, cz - az);
    const area2 = Math.abs((bx - ax) * (cz - az) - (bz - az) * (cx - ax));
    if (area2 < 1e-6) continue;
    const R = (a * b * c) / (2 * area2);
    if (R < hwA * 1.05 && g.cum[i] > hwA * 2 && g.len - g.cum[i] > hwA * 2) {
      out.push({ key: `curve:${s.id}`, sev: 'warn', title: 'Curve tighter than the road', detail: `${name}: radius ${R.toFixed(1)} m on a ${w.toFixed(1)} m road`, x: bx, z: bz, ids: [s.id] });
      break;
    }
  }
  if (s.elevated || s.bridge !== 'none') {
    // bridges: level-aware — crossing at the same height needs a junction; too little headroom is a warning
    const S = samplePath(anchorsOf(doc, s), 12);
    const seen = new Set<Id>();
    for (const c of crossingsOf(doc, S.pts, S.lift, new Set([s.id]), near)) {
      if (seen.has(c.other)) continue;
      seen.add(c.other);
      const o = doc.get<'section'>(c.other)!;
      if (o.a === s.a || o.a === s.b || o.b === s.a || o.b === s.b) continue;
      if ((o.elevated || o.bridge !== 'none') && o.id < s.id) continue; // the other one reports it
      const gap = Math.abs(c.lift - c.otherLift);
      const other = o.name || 'an unnamed road';
      if (gap < SAME_LEVEL) out.push({ key: `cross:${s.id}:${o.id}`, sev: 'error', title: 'Roads cross without a junction', detail: `${name} × ${other} at the same height — connect them or raise one`, x: c.p[0], z: c.p[1], ids: [s.id, o.id] });
      else if (gap < CLEARANCE) out.push({ key: `low:${s.id}:${o.id}`, sev: 'warn', title: 'Low clearance under a bridge', detail: `${name} passes ${gap.toFixed(1)} m ${c.lift > c.otherLift ? 'over' : 'under'} ${other} — about 5.5 m is usual`, x: c.p[0], z: c.p[1], ids: [s.id, o.id] });
    }
    return;
  }
  // overlaps / crossings with roads that don't share a junction
  const ends = new Set([s.a, s.b]);
  const reported = new Set<Id>();
  const endZone = hwA * 1.5 + 6;
  for (let i = 0; i < n; i += 2) {
    if (g.cum[i] < endZone || g.len - g.cum[i] < endZone) continue;
    const x = g.pts[i * 2], z = g.pts[i * 2 + 1];
    for (const oid of near(x - 40, z - 40, x + 40, z + 40)) {
      if (oid === s.id || reported.has(oid)) continue;
      const o = doc.get(oid);
      if (o?.kind !== 'section' || o.elevated || o.bridge !== 'none') continue;
      if (ends.has(o.a) || ends.has(o.b)) continue;
      const h = C.geo(oid);
      if (!h) continue;
      const hwB = Math.max(h.t.hwL, h.t.hwR);
      let best = Infinity;
      for (let k = 0; k + 3 < h.pts.length; k += 2) {
        const px = h.pts[k], pz = h.pts[k + 1], dx = h.pts[k + 2] - px, dz = h.pts[k + 3] - pz;
        const t = Math.max(0, Math.min(1, ((x - px) * dx + (z - pz) * dz) / (dx * dx + dz * dz || 1e-9)));
        best = Math.min(best, Math.hypot(x - px - dx * t, z - pz - dz * t));
      }
      if (best < 0.75) {
        reported.add(oid);
        if (s.id < oid) out.push({ key: `cross:${s.id}:${oid}`, sev: 'error', title: 'Roads cross without a junction', detail: `${name} × ${o.name || 'unnamed road'} — split one and connect them, or make one a bridge`, x, z, ids: [s.id, oid] });
      } else if (best < hwA + hwB - 0.5) {
        reported.add(oid);
        if (s.id < oid) out.push({ key: `overlap:${s.id}:${oid}`, sev: 'warn', title: 'Roads overlap', detail: `${name} and ${o.name || 'an unnamed road'} are ${best.toFixed(1)} m apart but ${(hwA + hwB).toFixed(1)} m wide together`, x, z, ids: [s.id, oid] });
      }
    }
  }
}

function junctionChecks(doc: CityDoc, C: Compiler, id: Id, near: Near, out: Issue[]) {
  const j = doc.get<'junction'>(id);
  if (!j) return;
  const arms = doc.sectionsAt(id);
  if (arms.length !== 1) return;
  // dead end that stops just short of another road
  for (const oid of near(j.x - 12, j.z - 12, j.x + 12, j.z + 12)) {
    const o = doc.get(oid);
    if (o?.kind !== 'section' || o.id === arms[0].id || o.a === id || o.b === id) continue;
    const g = C.geo(oid);
    if (!g) continue;
    let best = Infinity;
    for (let k = 0; k + 3 < g.pts.length; k += 2) {
      const px = g.pts[k], pz = g.pts[k + 1], dx = g.pts[k + 2] - px, dz = g.pts[k + 3] - pz;
      const t = Math.max(0, Math.min(1, ((j.x - px) * dx + (j.z - pz) * dz) / (dx * dx + dz * dz || 1e-9)));
      best = Math.min(best, Math.hypot(j.x - px - dx * t, j.z - pz - dz * t));
    }
    const hw = Math.max(g.t.hwL, g.t.hwR);
    if (best < hw + 4 && best > 0.3) {
      out.push({ key: `gap:${id}`, sev: 'warn', title: 'Dead end almost touches a road', detail: `${arms[0].name || 'A road'} stops ${Math.max(0, best - hw).toFixed(1)} m from ${o.name || 'a road'} — drag its end onto the road to connect`, x: j.x, z: j.z, ids: [id, arms[0].id] });
      return;
    }
  }
}

export class IssueIndex {
  readonly byKey = new Map<string, Issue>();
  private byObj = new Map<Id, Set<string>>();
  /** edits from an opened map that no longer match anything */
  orphans: { id: Id; title: string }[] = [];
  version = 0;

  constructor(readonly doc: CityDoc, readonly C: Compiler, readonly near: Near) {}

  private add(i: Issue) {
    this.byKey.set(i.key, i);
    for (const id of i.ids) (this.byObj.get(id) ?? this.byObj.set(id, new Set()).get(id)!).add(i.key);
  }

  private clearFor(id: Id) {
    for (const k of this.byObj.get(id) ?? []) {
      const i = this.byKey.get(k);
      if (!i) continue;
      this.byKey.delete(k);
      for (const o of i.ids) this.byObj.get(o)?.delete(k);
    }
    this.byObj.delete(id);
  }

  /** Check everything (a few hundred ms on a full tile). */
  full() {
    this.byKey.clear(); this.byObj.clear();
    for (const s of this.doc.all('section')) { const out: Issue[] = []; sectionChecks(this.doc, this.C, s, this.near, out); out.forEach((i) => this.add(i)); }
    for (const id of this.doc.ids('junction')) { const out: Issue[] = []; junctionChecks(this.doc, this.C, id, this.near, out); out.forEach((i) => this.add(i)); }
    this.version++;
  }

  /** Re-check changed objects and their neighbourhood. */
  update(ids: Iterable<Id>) {
    const todo = new Set<Id>();
    for (const id of ids) {
      todo.add(id);
      const o = this.doc.get(id);
      const g = o?.kind === 'section' ? this.C.geo(id) : undefined;
      if (g) for (const n of this.near(g.x0 - 10, g.z0 - 10, g.x1 + 10, g.z1 + 10)) todo.add(n);
      if (o?.kind === 'junction') for (const n of this.near(o.x - 15, o.z - 15, o.x + 15, o.z + 15)) todo.add(n);
    }
    for (const id of todo) this.clearFor(id);
    for (const id of todo) {
      const o = this.doc.get(id);
      const out: Issue[] = [];
      if (o?.kind === 'section') sectionChecks(this.doc, this.C, o, this.near, out);
      if (o?.kind === 'junction') junctionChecks(this.doc, this.C, id, this.near, out);
      for (const i of out) if (!this.byKey.has(i.key)) this.add(i);
    }
    this.version++;
  }

  list(): Issue[] {
    const rank = { error: 0, warn: 1, info: 2 };
    return [...this.byKey.values()].sort((a, b) => rank[a.sev] - rank[b.sev] || a.title.localeCompare(b.title));
  }
}
