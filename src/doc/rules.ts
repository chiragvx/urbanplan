// Standards checks for catalogue assets (the Issues panel): curve radius, buffers buildings must keep (canals, nallas,
// railway land, power-line corridors), buildings inside flood zones, clearance where roads cross a railway, BRT
// stations on streets too narrow for BRT, ramps steeper than IRC:SP:90 allows, and buildings close to rivers.
import type { CityDoc } from './doc';
import type { Issue, Near } from './issues';
import type { Id, LineObj } from './types';
import { anchorsOf, crossingsOf, samplePath, SAME_LEVEL } from './ops';
import { totalWidth } from './xsection';
import { assetOf, lineShape, minRadiusOf } from '../assets';

type V2 = [number, number];

function polyDist(pts: number[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const ax = pts[i], az = pts[i + 1], dx = pts[i + 2] - ax, dz = pts[i + 3] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1e-9)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}
function inRing(r: number[], x: number, z: number) {
  let c = false;
  const n = r.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = r[i * 2], zi = r[i * 2 + 1], xj = r[j * 2], zj = r[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
function box(p: number[], pad: number): [number, number, number, number] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
  return [x0 - pad, z0 - pad, x1 + pad, z1 + pad];
}
const mid = (p: number[]): V2 => { const k = Math.floor(p.length / 4) * 2; return [p[k], p[k + 1]]; };

/** Buildings within `d` of a polyline (any corner, or the line crossing the footprint). */
function buildingsNear(doc: CityDoc, near: Near, pts: number[], d: number): Id[] {
  const out: Id[] = [];
  for (const id of near(...box(pts, d))) {
    const b = doc.get(id);
    if (b?.kind !== 'building') continue;
    let hit = false;
    for (let i = 0; i < b.outer.length && !hit; i += 2) if (polyDist(pts, b.outer[i], b.outer[i + 1]) < d) hit = true;
    // the line passing through the footprint (sampled every 2 m)
    for (let i = 0; i + 3 < pts.length && !hit; i += 2) {
      const ax = pts[i], az = pts[i + 1], bx = pts[i + 2], bz = pts[i + 3], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 2));
      for (let k = 0; k <= n && !hit; k++) if (inRing(b.outer, ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n)) hit = true;
    }
    if (hit) out.push(id);
  }
  return out;
}

export function ruleIssues(doc: CityDoc, near: Near): Issue[] {
  const out: Issue[] = [];
  for (const l of doc.all('line')) {
    const a = assetOf(l);
    if (!a || !a.rules) continue;
    const shape = lineShape(l), name = l.name || a.name;
    const [mx, mz] = shape === 'point' ? [l.pts[0], l.pts[1]] : mid(l.pts);
    a.rules.forEach((r, i) => {
      const key = `rule:${l.id}:${i}`;
      if (r.kind === 'minRadius' && shape === 'route' && l.pts.length >= 6) {
        const pts: V2[] = [];
        for (let k = 0; k < l.pts.length; k += 2) pts.push([l.pts[k], l.pts[k + 1]]);
        const R = minRadiusOf(pts);
        if (R < r.r) out.push({ key, sev: r.hard ? 'error' : 'warn', title: 'Curve too tight', detail: `${name}: radius ${Math.round(R)} m — ${r.note}`, x: mx, z: mz, ids: [l.id] });
      }
      if (r.kind === 'buffer' && shape === 'route') {
        const hits = buildingsNear(doc, near, l.pts, l.size / 2 + r.dist);
        if (hits.length) out.push({ key, sev: r.sev, title: r.sev === 'info' ? 'Needs a permission' : 'Building too close', detail: `${name}: ${hits.length} building${hits.length > 1 ? 's' : ''} — ${r.note}`, x: mx, z: mz, ids: [l.id, ...hits] });
      }
      if (r.kind === 'inside' && shape === 'area') {
        const hits: Id[] = [];
        for (const id of near(...box(l.pts, 0))) {
          const b = doc.get(id);
          if (b?.kind !== 'building') continue;
          for (let k = 0; k < b.outer.length; k += 2) if (inRing(l.pts, b.outer[k], b.outer[k + 1])) { hits.push(id); break; }
        }
        if (hits.length) out.push({ key, sev: r.sev, title: r.sev === 'error' ? 'Building in a no-construction zone' : 'Building in a restricted zone', detail: `${name}: ${hits.length} building${hits.length > 1 ? 's' : ''} — ${r.note}`, x: mx, z: mz, ids: [l.id, ...hits] });
      }
      if (r.kind === 'clearance' && shape === 'route' && l.pts.length >= 4) {
        // roads crossing the line: level crossings, and bridges without the clearance
        const pts: V2[] = [];
        for (let k = 0; k < l.pts.length; k += 2) pts.push([l.pts[k], l.pts[k + 1]]);
        const lift = -l.depth;
        const xs = crossingsOf(doc, pts, pts.map(() => lift), new Set(), near);
        for (const c of xs) {
          const dz = c.otherLift - lift;
          if (Math.abs(dz) < SAME_LEVEL) out.push({ key: `${key}:lc:${c.other}`, sev: 'info', title: 'Level crossing', detail: `${name} crosses a road at grade — ${r.note}`, x: c.p[0], z: c.p[1], ids: [l.id, c.other] });
          else if (dz > 0 && dz - 1.2 < r.v) out.push({ key: `${key}:cl:${c.other}`, sev: 'warn', title: 'Not enough clearance', detail: `A road passes ${Math.max(0, dz - 1.2).toFixed(1)} m over ${name} — ${r.note}`, x: c.p[0], z: c.p[1], ids: [l.id, c.other] });
        }
      }
      if (r.kind === 'onStreet' && shape === 'point') {
        let best: { id: Id; d: number } | null = null;
        for (const id of near(mx - 25, mz - 25, mx + 25, mz + 25)) {
          const s = doc.get(id);
          if (s?.kind !== 'section') continue;
          const S = samplePath(anchorsOf(doc, s), 8);
          const d = polyDist(S.pts.flat(), mx, mz);
          if (d < 25 && (!best || d < best.d)) best = { id, d };
        }
        const w = best ? totalWidth(doc.get<'section'>(best.id)!.parts) : 0;
        if (!best) out.push({ key, sev: 'warn', title: 'Not on a street', detail: `${name} isn't on a street`, x: mx, z: mz, ids: [l.id] });
        else if (w < r.minWidth) out.push({ key, sev: 'warn', title: 'Street too narrow', detail: `${name} is on a ${w.toFixed(0)} m street — ${r.note}`, x: mx, z: mz, ids: [l.id, best.id] });
      }
    });
  }
  // ramps of flyovers / bridges steeper than 3.5 % (IRC:SP:90 §6.14) — ones drawn or edited here (imported decks
  // and ramps are estimates)
  for (const s of doc.all('section')) {
    if ((!s.elevated && s.bridge === 'none') || !doc.patch.has(s.id)) continue;
    const P = anchorsOf(doc, s);
    for (let k = 0; k + 1 < P.length; k++) {
      const L = Math.hypot(P[k + 1].x - P[k].x, P[k + 1].z - P[k].z);
      if (L < 15) continue;
      const g = Math.abs(P[k + 1].lift - P[k].lift) / L;
      if (g > 0.04) { out.push({ key: `rule:ramp:${s.id}`, sev: 'warn', title: 'Ramp too steep', detail: `${s.name || 'A flyover ramp'}: ${(g * 100).toFixed(1)} % — IRC:SP:90 allows at most 3.5 %`, x: (P[k].x + P[k + 1].x) / 2, z: (P[k].z + P[k + 1].z) / 2, ids: [s.id] }); break; }
    }
  }
  return out;
}

/** Buildings within 15 m of a river's water (UDCPR §3.1.1 ii), one issue per water body. */
export function riverIssues(doc: CityDoc, near: Near, waters: Float32Array[]): Issue[] {
  const out: Issue[] = [];
  waters.forEach((ring, wi) => {
    if (ring.length < 8) return;
    const pts = [...ring, ring[0], ring[1]];
    // rivers and big tanks only (small ponds aren't "major water courses")
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]); }
    if (Math.max(x1 - x0, z1 - z0) < 400) return;
    const hits = buildingsNear(doc, near, pts, 15);
    if (hits.length) out.push({ key: `river:${wi}`, sev: 'info', title: 'Buildings near the river', detail: `${hits.length} building${hits.length > 1 ? 's' : ''} within 15 m of the water — UDCPR §3.1.1 (ii): no building within 15 m of a major water course`, x: (x0 + x1) / 2, z: (z0 + z1) / 2, ids: hits });
  });
  return out;
}

export type { LineObj };
