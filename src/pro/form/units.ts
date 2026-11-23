// Units on a free floor plate: the ring-band planner. Whatever shape a floor takes, the band between its edge and
// the corridor round the core (the core grown by CORRIDOR) is cut across, from the facade in, into flats, offices,
// shops or room clusters, so every unit has its own stretch of facade and its door on the corridor. A plate that
// is star-shaped round a single core (most towers) is cut as an exact fan, with no polygon booleans at all; any
// other (a courtyard, a carved or split floor, several cores) is cut with wedges along the edge, clipped to the
// band. Odd leftovers (a deep plan's middle, a sliver at a carve) are lost area, not forced into rectangles.
import { area, diff, inter, offset, type MP } from '../../doc/ground';
import { CARPET } from '../../doc/site';
import { FLOOR_USES, USE_TABLE } from '../../doc/uses';
import { bbox, edgeDist, inRings, pole, ringArea } from './curve';
import { mpOf, ringsOf } from './shape';
import type { BuildingUse, FormContext, Pt } from './types';

/** the corridor round a core (m) */
export const CORRIDOR = 1.8;
/** the deepest a unit cut in from the facade runs when nothing meets it sooner (m) */
const DEEP = 14;
/** public rooms: each floor is one unit */
const PUBLIC = new Set<BuildingUse>(FLOOR_USES.filter((u) => USE_TABLE[u].room));

export interface Unit { t: 0 | 1 | 2 | 3; ring: number[]; carpet: number; kind?: BuildingUse }

/** What to cut a band into: each unit's type and its share (by area, or for shops by frontage), or the whole
 *  floor as one, or nothing. `placed` (flats of each type so far, up the building) keeps the mix on track. */
function targets(use: BuildingUse, B: number, P: number, ctx: FormContext, placed: number[]): { t: Unit['t']; w: number }[] | 'whole' | null {
  if (use === 'parking' || use === 'none') return null;
  if (PUBLIC.has(use)) return 'whole';
  if (use === 'office' || use === 'hotel') {
    // offices of 100 to 150 m², or the whole floor when it's small; a hotel's rooms in clusters about as big
    const n = B < (use === 'office' ? 220 : 180) ? 1 : Math.max(2, Math.round(B / 130));
    return n === 1 ? 'whole' : Array.from({ length: n }, () => ({ t: 3 as const, w: 1 }));
  }
  if (use === 'retail') {
    // shops along the frontage, SHOP_W (4.5 m) each, none under 12 m²
    let n = Math.max(1, Math.round(P / 4.5));
    if (B / n < 12) n = Math.max(1, Math.floor(B / 12));
    return n === 1 ? 'whole' : Array.from({ length: n }, () => ({ t: 3 as const, w: 1 }));
  }
  // homes: flats by the mix and their sizes (carpet, so the footprint each takes is size ÷ CARPET)
  const W = ctx.sizes.map((s) => Math.max(15, s) / CARPET);
  const sum = ctx.mix[0] + ctx.mix[1] + ctx.mix[2];
  const share = sum > 0 ? ctx.mix.map((m) => Math.max(0, m) / sum) : [0, 1, 0];
  const types = [0, 1, 2].filter((t) => share[t] > 0);
  const smallest = Math.min(...types.map((t) => W[t]));
  if (B < smallest * 0.6) return null;
  const avg = types.reduce((s, t) => s + share[t] * W[t], 0);
  const apportion = (N: number) => {
    const add = [0, 0, 0], all = placed[0] + placed[1] + placed[2];
    for (let q = 0; q < N; q++) {
      let bt = types[0], bv = -Infinity;
      for (const t of types) { const v = share[t] * (all + q + 1) - (placed[t] + add[t]); if (v > bv + 1e-9) { bv = v; bt = t; } }
      add[bt]++;
    }
    return add;
  };
  const N0 = Math.max(1, Math.round(B / avg));
  let pick: number[] | null = null, pickS = Infinity;
  for (const N of [N0 - 1, N0, N0 + 1]) {
    if (N < 1) continue;
    const c = apportion(N), tot = c[0] * W[0] + c[1] * W[1] + c[2] * W[2], k = B / tot;
    // flats between 15 % under and 40 % over their size beat any further off
    const s = Math.abs(Math.log(k)) + (k < 0.85 || k > 1.4 ? 1 : 0);
    if (s < pickS) { pickS = s; pick = c; }
  }
  if (!pick) return null;
  for (let t = 0; t < 3; t++) placed[t] += pick[t];
  // the types round the floor in turn, the biggest first
  const rem = pick.slice(), out: { t: Unit['t']; w: number }[] = [];
  while (rem[0] + rem[1] + rem[2] > 0) for (const t of [2, 1, 0] as const) if (rem[t] > 0) { rem[t]--; out.push({ t, w: W[t] }); }
  return out;
}

/** Where the cuts fall round a ring: each edge weighted (by the fan's area, or by length), starting at the middle
 *  of the longest edge (so a box's corner flats keep their corners), the cuts at the targets' running shares.
 *  Each cut as the edge it's on plus how far along (unwrapped past the start, so they only increase). */
function stations(r: number[], q: number[], shares: number[]): { u: number; x: number; z: number }[] {
  const n = r.length / 2, cum = [0];
  for (let e = 0; e < n; e++) cum.push(cum[e] + q[e]);
  const F = cum[n];
  let le = 0, ll = -1;
  for (let e = 0; e < n; e++) { const j = (e + 1) % n, L = Math.hypot(r[j * 2] - r[e * 2], r[j * 2 + 1] - r[e * 2 + 1]); if (L > ll) { ll = L; le = e; } }
  const S0 = cum[le] + q[le] / 2, u0 = le + 0.5, out: { u: number; x: number; z: number }[] = [];
  for (const f of shares) {
    let v = (S0 + F * f) % F, e = 0;
    while (e < n - 1 && cum[e + 1] <= v) e++;
    const s = q[e] > 0 ? Math.min(1, (v - cum[e]) / q[e]) : 0, j = (e + 1) % n;
    let u = e + s;
    if (u < u0 - 1e-9) u += n;
    out.push({ u, x: r[e * 2] + (r[j * 2] - r[e * 2]) * s, z: r[e * 2 + 1] + (r[j * 2 + 1] - r[e * 2 + 1]) * s });
  }
  // (the first is the start itself; a wrap past it can't happen as the shares are under 1)
  return out;
}
/** the ring's vertices strictly between two unwrapped positions */
function between(r: number[], ua: number, ub: number): number[] {
  const n = r.length / 2, o: number[] = [];
  for (let v = Math.floor(ua) + 1; v < ub - 1e-9; v++) { const i = v % n; o.push(r[i * 2], r[i * 2 + 1]); }
  return o;
}
const shareList = (w: number[]) => { const tot = w.reduce((s, x) => s + x, 0) || 1; let a = 0; return w.map((x) => { const f = a / tot; a += x; return f; }); };

/** The exact fan: a star-shaped outline round one core's corridor `G` (both anticlockwise), cut by lines to the
 *  core's centre `c`. Null when the plate isn't star-shaped round it. */
function fan(outer: number[], G: number[], c: Pt, w: number[]): number[][] | null {
  const n = outer.length / 2, m = G.length / 2;
  const q: number[] = [];
  for (let e = 0; e < n; e++) {
    const j = (e + 1) % n, a = ((outer[e * 2] - c[0]) * (outer[j * 2 + 1] - c[1]) - (outer[j * 2] - c[0]) * (outer[e * 2 + 1] - c[1])) / 2;
    if (a <= 1e-6) return null;
    q.push(a);
  }
  for (let e = 0; e < m; e++) {
    const j = (e + 1) % m;
    if ((G[e * 2] - c[0]) * (G[j * 2 + 1] - c[1]) - (G[j * 2] - c[0]) * (G[e * 2 + 1] - c[1]) <= 0) return null;
    if (!inRings([outer], G[e * 2], G[e * 2 + 1])) return null;
  }
  const st = stations(outer, q, shareList(w));
  // where each cut meets the corridor: the crossing of the line to the centre with G, as G's unwrapped position
  const hit = st.map((s) => {
    for (let e = 0; e < m; e++) {
      const j = (e + 1) % m, ax = G[e * 2], az = G[e * 2 + 1], bx = G[j * 2], bz = G[j * 2 + 1];
      const dx = c[0] - s.x, dz = c[1] - s.z, ex = bx - ax, ez = bz - az, den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((ax - s.x) * ez - (az - s.z) * ex) / den, k = ((ax - s.x) * dz - (az - s.z) * dx) / den;
      if (t >= -1e-9 && t <= 1 + 1e-9 && k >= -1e-9 && k <= 1 + 1e-9) return { g: e + Math.min(1, Math.max(0, k)), x: s.x + dx * t, z: s.z + dz * t };
    }
    return { g: 0, x: c[0], z: c[1] };
  });
  // (G's positions unwrapped in the same order as the cuts)
  for (let i = 1; i < hit.length; i++) while (hit[i].g < hit[i - 1].g - 1e-9) hit[i].g += m;
  const out: number[][] = [];
  for (let i = 0; i < st.length; i++) {
    const a = st[i], b = i + 1 < st.length ? st[i + 1] : { ...st[0], u: st[0].u + n }, ha = hit[i], hb = i + 1 < st.length ? hit[i + 1] : { ...hit[0], g: hit[0].g + m };
    const inner = between(G, ha.g, hb.g), back: number[] = [];
    for (let k = inner.length - 2; k >= 0; k -= 2) back.push(inner[k], inner[k + 1]);
    out.push([a.x, a.z, ...between(outer, a.u, b.u), b.x, b.z, hb.x, hb.z, ...back, ha.x, ha.z]);
  }
  return out;
}

/** how far a ray goes inside rings before it meets an edge, and whether that edge is a hole's (`skip` the ring and
 *  edge it starts on) */
function ray(rings: number[][], x: number, z: number, dx: number, dz: number): [number, boolean] {
  let best = Infinity, hole = false;
  for (const r of rings) {
    const n = r.length, isHole = ringArea(r) < 0;
    for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
      const ax = r[j], az = r[j + 1], ex = r[i] - ax, ez = r[i + 1] - az, den = dx * ez - dz * ex;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((ax - x) * ez - (az - z) * ex) / den, k = ((ax - x) * dz - (az - z) * dx) / den;
      if (t > 0.05 && k >= 0 && k <= 1 && t < best) { best = t; hole = isHole; }
    }
  }
  return [best, hole];
}

/** whether ring a lies inside rings (its corners in, to a couple of centimetres, none of theirs poking into it) */
function inside(a: number[], rings: number[][]): boolean {
  for (let i = 0; i < a.length; i += 2) if (!inRings(rings, a[i], a[i + 1]) && edgeDist(rings, a[i], a[i + 1]) > 0.02) return false;
  const q = [a];
  for (const r of rings) for (let i = 0; i < r.length; i += 2) if (inRings(q, r[i], r[i + 1]) && edgeDist(q, r[i], r[i + 1]) > 0.02) return false;
  return true;
}
/** whether two rings only meet along their edges (no edges crossing, neither's corners inside the other) */
function apart(a: number[], b: number[]): boolean {
  const A = [a], B = [b];
  for (let i = 0, n = a.length, pi = n - 2; i < n; pi = i, i += 2) for (let j = 0, m = b.length, pj = m - 2; j < m; pj = j, j += 2) {
    const ax = a[pi], az = a[pi + 1], bx = a[i], bz = a[i + 1], cx = b[pj], cz = b[pj + 1], dx = b[j], dz = b[j + 1];
    const d1 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax), d2 = (bx - ax) * (dz - az) - (bz - az) * (dx - ax);
    const d3 = (dx - cx) * (az - cz) - (dz - cz) * (ax - cx), d4 = (dx - cx) * (bz - cz) - (dz - cz) * (bx - cx);
    if (d1 * d2 < -1e-9 && d3 * d4 < -1e-9) return false;
  }
  for (let i = 0; i < a.length; i += 2) if (inRings(B, a[i], a[i + 1]) && edgeDist(B, a[i], a[i + 1]) > 0.02) return false;
  for (let i = 0; i < b.length; i += 2) if (inRings(A, b[i], b[i + 1]) && edgeDist(A, b[i], b[i + 1]) > 0.02) return false;
  return true;
}

/** Wedges along a piece of band (its rings, outline first), clipped to the band. Each cut runs in from the facade
 *  to the nearest point of the plate's spine (the plate shrunk to a thin line down its middle): straight across a
 *  slab's long faces, fanning round its ends, following a court round. Without a spine, square in from the facade
 *  to the corridor or the far side (halfway, when the far side is the facade again). */
function wedges(piece: MP, rings: number[][], r: number[], w: number[], spine: number[][]): (number[] | null)[] {
  const n = r.length / 2;
  const q: number[] = [];
  for (let e = 0; e < n; e++) { const j = (e + 1) % n; q.push(Math.hypot(r[j * 2] - r[e * 2], r[j * 2 + 1] - r[e * 2 + 1])); }
  const st = stations(r, q, shareList(w));
  const cut = st.map((s) => {
    const e = Math.floor(s.u) % n, j = (e + 1) % n, L = q[e] || 1;
    const nx = -(r[j * 2 + 1] - r[e * 2 + 1]) / L, nz = (r[j * 2] - r[e * 2]) / L;
    if (spine.length) {
      let bx = s.x, bz = s.z, bd = Infinity;
      for (const g of spine) for (let i = 0, m = g.length, k = m - 2; i < m; k = i, i += 2) {
        const ax = g[k], az = g[k + 1], ex = g[i] - ax, ez = g[i + 1] - az, L2 = ex * ex + ez * ez || 1e-12;
        const t = Math.max(0, Math.min(1, ((s.x - ax) * ex + (s.z - az) * ez) / L2)), x = ax + ex * t, z = az + ez * t, dd = Math.hypot(s.x - x, s.z - z);
        if (dd < bd) { bd = dd; bx = x; bz = z; }
      }
      if (bd > 0.3 && Number.isFinite(bd)) return { x: s.x, z: s.z, nx: (bx - s.x) / bd, nz: (bz - s.z) / bd, D: Math.min(DEEP, bd) };
    }
    const [d, hole] = ray(rings, s.x, s.z, nx, nz);
    // (to the corridor or a court: all the way; to the facade again: halfway, and no deeper than a deep flat)
    const D = Number.isFinite(d) ? (hole ? Math.min(40, d + 0.3) : Math.min(DEEP, d / 2)) : DEEP;
    return { x: s.x, z: s.z, nx, nz, D };
  });
  const out: (number[] | null)[] = [];
  // what earlier units took, with their boxes: cuts from facing sides can reach past each other in a deep plan,
  // so each unit gives up whatever an earlier one already has
  const taken: { m: MP; r: number[]; b: [number, number, number, number] }[] = [];
  for (let i = 0; i < st.length; i++) {
    const a = st[i], b = i + 1 < st.length ? st[i + 1] : { ...st[0], u: st[0].u + n }, ca = cut[i], cb = cut[(i + 1) % st.length];
    let qa: Pt = [ca.x + ca.nx * ca.D, ca.z + ca.nz * ca.D], qb: Pt = [cb.x + cb.nx * cb.D, cb.z + cb.nz * cb.D];
    // two cuts that cross before their ends (round a convex corner) meet where they cross
    const den = ca.nx * cb.nz - ca.nz * cb.nx;
    if (Math.abs(den) > 1e-9) {
      const ta = ((cb.x - ca.x) * cb.nz - (cb.z - ca.z) * cb.nx) / den, tb = ((cb.x - ca.x) * ca.nz - (cb.z - ca.z) * ca.nx) / den;
      if (ta > 0 && tb > 0 && ta < ca.D && tb < cb.D) qa = qb = [ca.x + ca.nx * ta, ca.z + ca.nz * ta];
    }
    const wedge = [a.x, a.z, ...between(r, a.u, b.u), b.x, b.z, qb[0], qb[1], qa[0], qa[1]];
    // (a wedge already inside the band, clear of the units before it, is the unit as it is: no booleans)
    const wr = ringArea(wedge) > 0 ? wedge : null, wb = bbox(wedge);
    const near0 = taken.filter((x) => x.b[0] < wb[2] && x.b[2] > wb[0] && x.b[1] < wb[3] && x.b[3] > wb[1]);
    if (wr && inside(wr, rings) && near0.every((x) => apart(wr, x.r))) { out.push(wr); taken.push({ m: mpOf(wr), r: wr, b: wb }); continue; }
    let got = inter(piece, mpOf(wedge));
    if (!got.length) { out.push(null); continue; }
    const bb = bbox(ringsOf(got).flat());
    const near = taken.filter((x) => x.b[0] < bb[2] && x.b[2] > bb[0] && x.b[1] < bb[3] && x.b[3] > bb[1]).map((x) => x.m);
    if (near.length) got = diff(got, ...near);
    let best: number[] = [], ba = 0;
    for (const p of got) { const f = ringsOf([p])[0]; const A = f ? ringArea(f) : 0; if (A > ba) { ba = A; best = f; } }
    if (ba > 2) { out.push(best); taken.push({ m: mpOf(best), r: best, b: bbox(best) }); } else out.push(null);
  }
  return out;
}

/** A floor's units. `floor` the slab after carves (local), `cores` the cores' rings and `corridor` the cores grown
 *  by CORRIDOR (one shape), `centres` the cores' centres. `houses`: the plan cut across into that many homes. */
export function planUnits(floor: MP, use: BuildingUse, cores: number[][], corridor: MP, centres: Pt[], ctx: FormContext, placed: number[], houses = 0, outer?: number[]): Unit[] {
  const units: Unit[] = [];
  if (!floor.length || use === 'parking' || use === 'none') return units;
  const typeOf = (carpet: number): Unit['t'] => (use !== 'residential' ? 3 : carpet >= ctx.sizes[2] * 0.9 ? 2 : carpet >= ctx.sizes[1] * 0.9 ? 1 : 0);
  if (houses > 0) {
    // side by side across local x: one home a floor each, its own stair inside it
    const all = ringsOf(floor).flat(), [x0, z0, x1, z1] = bbox(all), wd = (x1 - x0) / houses;
    for (let h = 0; h < houses; h++) {
      const s = inter(floor, mpOf([x0 + wd * h, z0 - 1, x0 + wd * (h + 1), z0 - 1, x0 + wd * (h + 1), z1 + 1, x0 + wd * h, z1 + 1]));
      const r = ringsOf(s)[0];
      if (!r) continue;
      const carpet = area(s) * CARPET;
      units.push({ t: typeOf(carpet), ring: r, carpet });
    }
    return units;
  }
  const coreMP: MP = cores.map((c) => mpOf(c)[0]);
  // a whole floor as one: each piece of the slab, less the cores in it
  const whole = () => {
    for (const p of floor) {
      const net = area([p]) - (coreMP.length ? area(inter([p], coreMP)) : 0);
      if (net > 2) units.push({ t: 3, ring: ringsOf([p])[0], carpet: net * CARPET });
    }
    return units;
  };
  // the band: the slab less the corridor round the cores
  const simple = floor.length === 1 && floor[0].length === 1;
  const band = corridor.length ? diff(floor, corridor) : floor;
  const B = area(band);
  if (B < 2) return units;
  const outerRing = ringsOf([floor[0]])[0];
  // the single-core star-shaped fast path
  if (simple && cores.length === 1 && corridor.length === 1 && corridor[0].length === 1 && outerRing && compact(outerRing, centres[0])) {
    const G = ringsOf(corridor)[0], P = perimeterOf(outerRing);
    const tg = targets(use, B, P, ctx, placed);
    if (tg === null) return units;
    if (tg === 'whole') return whole();
    const w = tg.map((x) => x.w);
    if (use === 'retail') {
      // (shops share the frontage, not the area: the fan's cuts at equal lengths round the edge)
      const r = fanByLength(outerRing, G, centres[0], w);
      if (r) { r.forEach((ring, i) => units.push({ t: tg[i].t, ring, carpet: Math.abs(ringArea(ring)) * CARPET })); return units; }
    } else {
      const r = fan(outerRing, G, centres[0], w);
      if (r) { r.forEach((ring, i) => units.push({ t: tg[i].t, ring, carpet: Math.abs(ringArea(ring)) * CARPET })); return units; }
    }
    // (not star-shaped: the flats counted go back, and the general way plans it)
    if (use === 'residential') for (const x of tg) placed[x.t]--;
  }
  // the general way: each piece of band in turn, cut towards the plate's spine
  const spine = spineOf(outer ?? ringsOf([floor[0]])[0] ?? []);
  const floorHoles = ringsOf(floor).filter((r) => ringArea(r) < 0);
  // (a slab's flats, offices or rooms open off a corridor down its middle, from core to core and on to the end
  // flats: the spine, about two metres wide, is that corridor and isn't sold. A block round a court is planned
  // through, outside to court, and a shop opens off the street: neither has one.)
  const walk = spine.length && !floorHoles.length && (use === 'residential' || use === 'office' || use === 'hotel');
  const pieces = (walk ? diff(band, ...spine.map(mpOf)) : band).slice().sort((a, b) => area([b]) - area([a]));
  for (const p of pieces) {
    const Bp = area([p]), rings = ringsOf([p]);
    if (Bp < 8 || !rings.length) continue;
    const tg = targets(use, Bp, perimeterOf(rings[0]), ctx, placed);
    if (tg === null) continue;
    if (tg === 'whole') {
      const net = Bp;
      units.push({ t: 3, ring: rings[0], carpet: net * CARPET });
      continue;
    }
    // a piece round a court is cut right through, outside to court (each unit open both sides, as a courtyard
    // block is planned); any other towards its spine
    const court = floorHoles.some((h) => inRings([rings[0]], h[0], h[1]));
    wedges([p], rings, rings[0], tg.map((x) => x.w), court ? [] : spine).forEach((ring, i) => {
      if (!ring) return;
      const carpet = Math.abs(ringArea(ring)) * CARPET;
      units.push({ t: use === 'residential' ? tg[i].t : 3, ring, carpet });
    });
  }
  return units;
}

/** A plate's spine: its outline as drawn (before carves, so a zig-zag slot doesn't move it floor by floor) shrunk
 *  to within a metre of its deepest point: a line down a slab's middle, a point in a tower's. Remembered by the
 *  outline, since most floors share theirs. */
const spines = new Map<string, number[][]>();
function spineOf(r: number[]): number[][] {
  if (r.length < 6) return [];
  const key = r.map((v) => v.toFixed(2)).join(',');
  let s = spines.get(key);
  if (!s) {
    const depth = pole([r], 0.8)[2];
    s = depth > 1.5 ? ringsOf(offset(mpOf(r), -(depth - 1))) : [];
    spines.set(key, s);
    if (spines.size > 256) spines.delete(spines.keys().next().value!);
  }
  return s;
}

/** whether a plate is compact round its core (a tower), so a fan cuts it well: its farthest edge no more than
 *  about twice as far from the core as its nearest. A slab's flats are cut square across instead. */
function compact(r: number[], c: Pt): boolean {
  let near = Infinity, far = 0;
  for (let i = 0; i < r.length; i += 2) {
    const j = (i + 2) % r.length, dx = r[j] - r[i], dz = r[j + 1] - r[i + 1], L2 = dx * dx + dz * dz || 1e-12;
    const t = Math.max(0, Math.min(1, ((c[0] - r[i]) * dx + (c[1] - r[i + 1]) * dz) / L2));
    near = Math.min(near, Math.hypot(c[0] - r[i] - dx * t, c[1] - r[i + 1] - dz * t));
    far = Math.max(far, Math.hypot(c[0] - r[i], c[1] - r[i + 1]));
  }
  return far <= near * 2.2;
}

function perimeterOf(r: number[]) {
  let s = 0;
  for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; s += Math.hypot(r[j] - r[i], r[j + 1] - r[i + 1]); }
  return s;
}

/** the fan with its cuts at shares of the edge's length rather than its area (shops along a frontage) */
function fanByLength(outer: number[], G: number[], c: Pt, w: number[]): number[][] | null {
  // a fan whose edge weights are lengths: each edge's area weight made proportional to its length
  const n = outer.length / 2, L: number[] = [], A: number[] = [];
  for (let e = 0; e < n; e++) {
    const j = (e + 1) % n;
    L.push(Math.hypot(outer[j * 2] - outer[e * 2], outer[j * 2 + 1] - outer[e * 2 + 1]));
    A.push(((outer[e * 2] - c[0]) * (outer[j * 2 + 1] - c[1]) - (outer[j * 2] - c[0]) * (outer[e * 2 + 1] - c[1])) / 2);
  }
  if (A.some((a) => a <= 1e-6)) return null;
  // the shares by length turned into shares by fan area, so the same fan cuts them
  const st = stations(outer, L, shareList(w));
  const cumA = [0];
  for (let e = 0; e < n; e++) cumA.push(cumA[e] + A[e]);
  const le = (() => { let b = 0; for (let e = 1; e < n; e++) if (L[e] > L[b]) b = e; return b; })();
  const S0 = cumA[le] + A[le] / 2, F = cumA[n];
  const areaShares = st.map((s) => {
    const e = Math.floor(s.u) % n, f = s.u - Math.floor(s.u), v = cumA[e] + A[e] * f;
    return (((v - S0) % F) + F) % F / F;
  });
  const ws = areaShares.map((f, i) => (i + 1 < areaShares.length ? areaShares[i + 1] : 1) - f);
  if (ws.some((x) => x <= 0)) return null;
  return fan(outer, G, c, ws);
}
