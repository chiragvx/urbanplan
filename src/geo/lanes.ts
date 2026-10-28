// Our own road geometry on top of osm2streets topology:
//   1. smooth each road's trimmed centre line into flowing curves (corner fillets, G1-continuous)
//   2. build lane polygons as mitred offsets of that curve (perfectly parallel edges)
//   3. generate lane markings (separators, centre lines, edge lines) from the same offsets
// End points and end tangents are preserved, so roads still meet osm2streets' junction polygons exactly.
import type { StreetNet, StreetRoad, StreetLane, StreetMarking } from './streets';

const STEP_DEG = 2.5;
const MAX_CHORD = 2.0;

export function designRadius(highway: string): number {
  const h = highway.replace('_link', '');
  const r: Record<string, number> = {
    motorway: 220, trunk: 160, primary: 110, secondary: 75, tertiary: 50, unclassified: 30, residential: 24,
    living_street: 16, service: 14, track: 14, busway: 80, cycleway: 10, footway: 8, path: 8, pedestrian: 10, steps: 0,
  };
  return (r[h] ?? 18) * (highway.endsWith('_link') ? 0.7 : 1);
}

/** Replace every interior corner with a quadratic Bézier between tangent points; keep ends + end tangents. */
export function smoothPolyline(c: Float32Array, radius: number, minRadius: number): Float32Array {
  const n = c.length / 2;
  if (n < 3 || radius <= 0) return c;
  const out: number[] = [c[0], c[1]];
  for (let i = 1; i < n - 1; i++) {
    const ax = c[i * 2 - 2], az = c[i * 2 - 1], vx = c[i * 2], vz = c[i * 2 + 1], bx = c[i * 2 + 2], bz = c[i * 2 + 3];
    let ux = vx - ax, uz = vz - az, wx = bx - vx, wz = bz - vz;
    const la = Math.hypot(ux, uz), lb = Math.hypot(wx, wz);
    if (la < 1e-4 || lb < 1e-4) continue;
    ux /= la; uz /= la; wx /= lb; wz /= lb;
    const theta = Math.acos(Math.max(-1, Math.min(1, ux * wx + uz * wz)));
    if (theta < 0.003) { out.push(vx, vz); continue; }
    // tangent length: design radius, clamped so neighbouring curves meet but don't overlap (ends keep their tangent)
    const allowA = i === 1 ? 0.9 : 0.5, allowB = i === n - 2 ? 0.9 : 0.5;
    let d = Math.max(radius, minRadius) * Math.tan(theta / 2);
    d = Math.min(d, la * allowA, lb * allowB);
    const t1x = vx - ux * d, t1z = vz - uz * d, t2x = vx + wx * d, t2z = vz + wz * d;
    const steps = Math.max(2, Math.ceil(Math.max((theta * 180) / Math.PI / STEP_DEG, (d * theta) / MAX_CHORD)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, e = t * t;
      out.push(a * t1x + b * vx + e * t2x, a * t1z + b * vz + e * t2z);
    }
  }
  out.push(c[n * 2 - 2], c[n * 2 - 1]);
  // drop near-duplicates
  const res: number[] = [out[0], out[1]];
  for (let i = 2; i < out.length; i += 2) {
    if (Math.hypot(out[i] - res[res.length - 2], out[i + 1] - res[res.length - 1]) > 0.05) res.push(out[i], out[i + 1]);
  }
  if (res.length < 4) return c;
  // make sure the true end point survives
  res[res.length - 2] = c[n * 2 - 2]; res[res.length - 1] = c[n * 2 - 1];
  return new Float32Array(res);
}

/** Per-vertex left normals with miter scaling (clamped). */
export function miterNormals(c: Float32Array): Float32Array {
  const n = c.length / 2;
  const out = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    let ax = 0, az = 0, bx = 0, bz = 0;
    if (i > 0) { ax = c[i * 2] - c[i * 2 - 2]; az = c[i * 2 + 1] - c[i * 2 - 1]; const l = Math.hypot(ax, az) || 1; ax /= l; az /= l; }
    if (i < n - 1) { bx = c[i * 2 + 2] - c[i * 2]; bz = c[i * 2 + 3] - c[i * 2 + 1]; const l = Math.hypot(bx, bz) || 1; bx /= l; bz /= l; }
    if (i === 0) { ax = bx; az = bz; }
    if (i === n - 1) { bx = ax; bz = az; }
    let mx = az + bz, mz = -ax - bx;
    const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) { mx = bz; mz = -bx; } else { mx /= ml; mz /= ml; }
    const cos = mx * bz + mz * -bx;
    out[i * 3] = mx; out[i * 3 + 1] = mz; out[i * 3 + 2] = 1 / Math.max(cos, 0.35);
  }
  return out;
}

/** Ring polygon between lateral offsets o0 and o1 (left-positive) along a polyline, optionally between arc lengths. */
export function band(c: Float32Array, N: Float32Array, o0: number, o1: number): Float32Array {
  const n = c.length / 2;
  const ring = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const s = N[i * 3 + 2];
    ring[i * 2] = c[i * 2] + N[i * 3] * o0 * s;
    ring[i * 2 + 1] = c[i * 2 + 1] + N[i * 3 + 1] * o0 * s;
    const j = 2 * n - 1 - i;
    ring[j * 2] = c[i * 2] + N[i * 3] * o1 * s;
    ring[j * 2 + 1] = c[i * 2 + 1] + N[i * 3 + 1] * o1 * s;
  }
  return ring;
}

/** Cut a polyline (+ its normals) between arc lengths s0..s1. */
function cut(c: Float32Array, N: Float32Array, cum: Float32Array, s0: number, s1: number): { c: Float32Array; N: Float32Array } | null {
  const n = c.length / 2;
  if (s1 - s0 < 0.05) return null;
  const pc: number[] = [], pn: number[] = [];
  const at = (s: number) => {
    let i = 0;
    while (i < n - 2 && cum[i + 1] < s) i++;
    const t = (s - cum[i]) / ((cum[i + 1] - cum[i]) || 1);
    pc.push(c[i * 2] + (c[i * 2 + 2] - c[i * 2]) * t, c[i * 2 + 1] + (c[i * 2 + 3] - c[i * 2 + 1]) * t);
    pn.push(N[i * 3] + (N[i * 3 + 3] - N[i * 3]) * t, N[i * 3 + 1] + (N[i * 3 + 4] - N[i * 3 + 1]) * t, N[i * 3 + 2] + (N[i * 3 + 5] - N[i * 3 + 2]) * t);
  };
  at(s0);
  for (let i = 1; i < n - 1; i++) if (cum[i] > s0 && cum[i] < s1) { pc.push(c[i * 2], c[i * 2 + 1]); pn.push(N[i * 3], N[i * 3 + 1], N[i * 3 + 2]); }
  at(s1);
  return { c: new Float32Array(pc), N: new Float32Array(pn) };
}

const DRIVE = new Set(['Driving', 'Bus', 'SharedLeftTurn', 'Biking']);

/**
 * Rebuild lanes, outlines and markings for every road from smoothed centre lines.
 * Mutates `net` in place (road.center / road.outline, net.lanes, net.markings).
 */
export function rebuildRoadGeometry(net: StreetNet) {
  const lanes: StreetLane[] = [];
  const markings: StreetMarking[] = net.markings.filter((m) => m.type !== 'lane separator' && m.type !== 'center line' && m.type !== 'lane arrow' && m.type !== 'buffer edge' && m.type !== 'buffer stripe');
  for (const r of net.roads.values()) {
    if (r.center.length < 4 || !r.lanes.length) continue;
    const W = r.lanes.reduce((s, l) => s + l.width, 0);
    r.center = smoothPolyline(r.center, designRadius(r.highway), W / 2 + 3);
    const c = r.center, N = miterNormals(c);
    const n = c.length / 2;
    const cum = new Float32Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(c[i * 2] - c[i * 2 - 2], c[i * 2 + 1] - c[i * 2 - 1]);
    const L = cum[n - 1];

    // lanes left → right: offsets from +W/2 down to −W/2
    let o = W / 2;
    const edges: number[] = [o];
    r.lanes.forEach((spec, index) => {
      const o1 = o - spec.width;
      lanes.push({ road: r.id, index, type: spec.type, dir: spec.dir, width: spec.width, poly: band(c, N, o, o1) });
      o = o1;
      edges.push(o);
    });
    r.outline = band(c, N, W / 2, -W / 2);

    // markings between lanes
    const layer = r.layer ?? 0;
    const major = ['motorway', 'trunk', 'primary', 'secondary'].includes(r.highway.replace('_link', ''));
    const pushBand = (seg: { c: Float32Array; N: Float32Array } | null, center: number, width: number, type: string) => {
      if (!seg || seg.c.length < 4) return;
      markings.push({ type, layer, road: r.id, poly: band(seg.c, seg.N, center + width / 2, center - width / 2) });
    };
    const margin = 1.5;
    const dashed = (center: number, width: number, type: string, dash = 3, gap = 5) => {
      for (let s = margin; s < L - margin; s += dash + gap) pushBand(cut(c, N, cum, s, Math.min(s + dash, L - margin)), center, width, type);
    };
    const solid = (center: number, width: number, type: string) => pushBand(cut(c, N, cum, margin, L - margin), center, width, type);
    for (let k = 1; k < r.lanes.length; k++) {
      const a = r.lanes[k - 1], b = r.lanes[k];
      if (!DRIVE.has(a.type) || !DRIVE.has(b.type)) continue;
      const at = edges[k];
      if (a.dir !== b.dir) {
        const perSide = r.lanes.filter((l) => DRIVE.has(l.type) && l.dir === a.dir).length;
        if (perSide >= 2 || major) { solid(at + 0.17, 0.12, 'center line'); solid(at - 0.17, 0.12, 'center line'); }
        else dashed(at, 0.12, 'center line', 3, 4);
      } else dashed(at, 0.12, 'lane separator');
    }
    if (major) {
      // edge lines along the outer driving lanes
      const first = r.lanes.findIndex((l) => DRIVE.has(l.type)), last = r.lanes.length - 1 - [...r.lanes].reverse().findIndex((l) => DRIVE.has(l.type));
      if (first >= 0) { solid(edges[first] - 0.25, 0.14, 'edge line'); solid(edges[last + 1] + 0.25, 0.14, 'edge line'); }
    }
  }
  net.lanes = lanes;
  net.markings = markings;
}
