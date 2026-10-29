// Map checks: roads that overlap or cross without a junction, dead ends that almost touch a road, lanes too narrow
// to drive, curves tighter than the road is wide, widths far from the Development Plan reserve.
import type { CityDoc } from './doc';
import type { Compiler } from './compile';
import type { Id, SectionObj, SurveyStatus } from './types';
import { totalWidth } from './xsection';
import { anchorsOf, crossingsOf, offGrade, samplePath, SAME_LEVEL } from './ops';

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
  if (offGrade(s)) {
    // bridges and tunnels: level-aware — crossing at the same height needs a junction; too little headroom is a warning
    const S = samplePath(anchorsOf(doc, s), 12);
    const seen = new Set<Id>();
    for (const c of crossingsOf(doc, S.pts, S.lift, new Set([s.id]), near)) {
      if (seen.has(c.other)) continue;
      seen.add(c.other);
      const o = doc.get<'section'>(c.other)!;
      if (o.a === s.a || o.a === s.b || o.b === s.a || o.b === s.b) continue;
      if (offGrade(o) && o.id < s.id) continue; // the other one reports it
      const gap = Math.abs(c.lift - c.otherLift);
      const other = o.name || 'an unnamed road';
      if (gap < SAME_LEVEL) out.push({ key: `cross:${s.id}:${o.id}`, sev: 'error', title: 'Roads cross without a junction', detail: `${name} × ${other} at the same height — connect them or raise one`, x: c.p[0], z: c.p[1], ids: [s.id, o.id] });
      else if (gap < CLEARANCE) out.push({ key: `low:${s.id}:${o.id}`, sev: 'warn', title: 'Low clearance', detail: `${name} passes ${gap.toFixed(1)} m ${c.lift > c.otherLift ? 'over' : 'under'} ${other} — about 5.5 m is usual`, x: c.p[0], z: c.p[1], ids: [s.id, o.id] });
    }
    return;
  }
  // gradient: steeper than 8 % over 24 m (after terraforming, or a graded profile)
  {
    const hf = C.hf, n2 = g.pts.length / 2;
    const zs = new Float32Array(n2);
    const G = s.grade;
    for (let i = 0; i < n2; i++) zs[i] = hf.sample(g.pts[i * 2], g.pts[i * 2 + 1]);
    let deep = 0, dx = 0, dz = 0;
    if (G && G.z.length >= 2) {
      const m = G.z.length, ground = Float32Array.from(zs);
      const st = G.z.map((_, i) => (g.len * i) / (m - 1)), zz = G.z.map((v) => v - hf.base);
      zz[0] = zs[0]; zz[m - 1] = zs[n2 - 1];
      for (let i = 0; i < n2; i++) {
        let k = 1; while (k < m - 1 && st[k] < g.cum[i]) k++;
        const f = Math.max(0, Math.min(1, (g.cum[i] - st[k - 1]) / (st[k] - st[k - 1] || 1)));
        zs[i] = zz[k - 1] + (zz[k] - zz[k - 1]) * f;
        const d = Math.abs(zs[i] - ground[i]);
        if (d > deep) { deep = d; dx = g.pts[i * 2]; dz = g.pts[i * 2 + 1]; }
      }
      if (deep > 6) out.push({ key: `gradedepth:${s.id}`, sev: 'info', title: 'Deep cut or high fill on a graded road', detail: `${name}: the road is ${deep.toFixed(1)} m ${zs.some((v, i) => v - ground[i] > 6) ? 'above' : 'below'} the ground — a bridge or tunnel may suit`, x: dx, z: dz, ids: [s.id] });
    }
    let worst = 0, wx = 0, wz = 0;
    for (let i = 0, j = 0; i < n2; i++) {
      while (j < n2 - 1 && g.cum[j] - g.cum[i] < 24) j++;
      const L = g.cum[j] - g.cum[i];
      if (L < 20) break;
      const gr = Math.abs(zs[j] - zs[i]) / L;
      if (gr > worst) { worst = gr; wx = g.pts[i * 2]; wz = g.pts[i * 2 + 1]; }
    }
    // only where someone shaped it (graded, or on terraformed ground): the 30 m elevation model alone is too coarse
    let shaped = !!G;
    for (let i = 0; i < n2 && !shaped; i += 4) shaped = Math.abs(hf.sample(g.pts[i * 2], g.pts[i * 2 + 1]) - hf.sample(g.pts[i * 2], g.pts[i * 2 + 1], hf.ground)) > 0.1;
    if (shaped && worst > 0.08 && g.len > 30) out.push({ key: `steep:${s.id}`, sev: 'warn', title: 'Steep road', detail: `${name}: ${(worst * 100).toFixed(1)} % (more than 8 %)${G ? ' — drag its stations in the height profile' : ' — grade it (G) or soften the ground'}`, x: wx, z: wz, ids: [s.id] });
  }
  // buildings standing where the Development Plan widens the road
  if (s.reserve && s.reserve > w + 1.5) {
    const half = s.reserve / 2;
    const hits: Id[] = [];
    let hx = 0, hz = 0;
    for (const oid of near(g.x0 - half, g.z0 - half, g.x1 + half, g.z1 + half)) {
      const b = doc.get(oid);
      if (b?.kind !== 'building') continue;
      let inside = false;
      for (let k = 0; k < b.outer.length && !inside; k += 2) inside = lineDist(g.pts, b.outer[k], b.outer[k + 1]) < half - 0.5;
      if (inside) { if (!hits.length) { hx = b.outer[0]; hz = b.outer[1]; } hits.push(oid); }
    }
    if (hits.length) out.push({ key: `widen:${s.id}`, sev: 'info', title: 'Buildings in the DP road reserve', detail: `${name}: DP ${s.reserve} m, ${w.toFixed(1)} m today — ${hits.length} building${hits.length > 1 ? 's stand' : ' stands'} where the road would widen`, x: hx, z: hz, ids: [s.id, ...hits.slice(0, 30)] });
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
      if (o?.kind !== 'section' || offGrade(o)) continue;
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

function lineDist(pts: ArrayLike<number>, x: number, z: number) {
  let best = Infinity;
  for (let k = 0; k + 3 < pts.length; k += 2) {
    const px = pts[k], pz = pts[k + 1], dx = pts[k + 2] - px, dz = pts[k + 3] - pz;
    const t = Math.max(0, Math.min(1, ((x - px) * dx + (z - pz) * dz) / (dx * dx + dz * dz || 1e-9)));
    best = Math.min(best, Math.hypot(x - px - dx * t, z - pz - dz * t));
  }
  return best;
}

/** A DP region as the checks see it (a survey region object, or a traced region not surveyed yet). */
export interface RegionLike { id: Id; cls: string; reserved: boolean; code?: string; ring: number[]; holes?: number[][]; area: number; status?: SurveyStatus }

/** Open space the plan reserves (gardens, playgrounds, parks…): buildings on it are worth a survey. */
const OPEN_CODES = /^(G|PG|CPG|PK|MPG|NG|G&PG|RP|STDM|RFD)/;
export const isOpenSpace = (r: RegionLike) => r.cls === 'recreational' || (r.reserved && !!r.code && OPEN_CODES.test(r.code.toUpperCase()));

function inRing(r: number[], x: number, z: number) {
  let c = false;
  for (let i = 0, j = r.length / 2 - 1; i < r.length / 2; j = i++) {
    const xi = r[i * 2], zi = r[i * 2 + 1], xj = r[j * 2], zj = r[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}

function regionChecks(doc: CityDoc, r: RegionLike, near: Near, out: Issue[]) {
  if (!isOpenSpace(r) || r.status === 'matches') return;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < r.ring.length; i += 2) { x0 = Math.min(x0, r.ring[i]); x1 = Math.max(x1, r.ring[i]); z0 = Math.min(z0, r.ring[i + 1]); z1 = Math.max(z1, r.ring[i + 1]); }
  const hits: Id[] = [];
  let area = 0;
  for (const oid of near(x0, z0, x1, z1)) {
    const b = doc.get(oid);
    if (b?.kind !== 'building') continue;
    let cx = 0, cz = 0, a = 0;
    const n = b.outer.length / 2;
    for (let i = 0, j = n - 1; i < n; j = i++) { const f = b.outer[j * 2] * b.outer[i * 2 + 1] - b.outer[i * 2] * b.outer[j * 2 + 1]; a += f; cx += (b.outer[j * 2] + b.outer[i * 2]) * f; cz += (b.outer[j * 2 + 1] + b.outer[i * 2 + 1]) * f; }
    if (Math.abs(a) < 1e-6) continue;
    cx /= 3 * a; cz /= 3 * a;
    if (!inRing(r.ring, cx, cz) || r.holes?.some((h) => inRing(h, cx, cz))) continue;
    hits.push(oid); area += Math.abs(a) / 2;
  }
  if (!hits.length || area < 25) return;
  const share = Math.min(100, Math.round((area / Math.max(1, r.area)) * 100));
  out.push({
    key: `open:${r.id}`, sev: share >= 10 ? 'warn' : 'info', title: 'Buildings on a reserved open space',
    detail: `${r.code ? `${r.code}: ` : ''}${hits.length} building${hits.length > 1 ? 's' : ''} (≈${Math.round(area).toLocaleString()} m², ${share} % of the site) on land the plan keeps open — survey it`,
    x: (x0 + x1) / 2, z: (z0 + z1) / 2, ids: [r.id, ...hits.slice(0, 30)],
  });
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

  /** DP regions to check (set by the app once they're loaded) */
  regions: () => RegionLike[] = () => [];
  /** terrain checks (water pooling where the ground was terraformed), set by the app */
  terrainIssues: () => Issue[] = () => [];

  /** Re-run the terrain checks. */
  terrainPass() {
    for (const k of [...this.byKey.keys()]) if (k.startsWith('pit:')) { const i = this.byKey.get(k)!; this.byKey.delete(k); for (const o of i.ids) this.byObj.get(o)?.delete(k); }
    for (const i of this.terrainIssues()) this.add(i);
    this.version++;
  }

  constructor(readonly doc: CityDoc, readonly C: Compiler, readonly near: Near) {}

  /** Re-check the DP regions (after they load, or a survey edit). */
  regionPass() {
    for (const k of [...this.byKey.keys()]) if (k.startsWith('open:')) { const i = this.byKey.get(k)!; this.byKey.delete(k); for (const o of i.ids) this.byObj.get(o)?.delete(k); }
    for (const r of this.regions()) { const out: Issue[] = []; regionChecks(this.doc, r, this.near, out); out.forEach((i) => this.add(i)); }
    this.version++;
  }

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
    this.regionPass();
    this.terrainPass();
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
    if ([...todo].some((id) => this.doc.get(id)?.kind === 'region' || this.doc.get(id)?.kind === 'building')) this.regionPass();
    if ([...todo].some((id) => this.doc.get(id)?.kind === 'earthwork' || id.startsWith('ew'))) this.terrainPass();
  }

  list(): Issue[] {
    const rank = { error: 0, warn: 1, info: 2 };
    return [...this.byKey.values()].sort((a, b) => rank[a.sev] - rank[b.sev] || a.title.localeCompare(b.title));
  }
}
