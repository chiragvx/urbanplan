// Place reports: for each place in places.config.ts, the facts of the base map round it (roads, widths, the
// Development Plan's widths where they're traced, junctions, buildings, ground heights), a small SVG map and a
// 1200 × 630 share picture. Everything on the place pages comes from here.
//   npm run bake:places            (all places)      npm run bake:places -- fc-road bkc   (some)
// Writes src/site/places/generated/places.json, public/places/<city>/<slug>.svg and .jpg (needs ffmpeg on PATH).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Resvg } from '@resvg/resvg-js';
import { areaAround, lengthInside, lineDist, openRegion, ringArea, type Area, type Region, type Sec } from './region';
import { MUMBAI, PUNE, type PlaceConfig } from './places.config';
import { carriageWidth, DP_WIDTHS, hasMedian, isOneway, laneCount, totalWidth } from '../../src/doc/xsection';
import { CLASS_LABEL, CLASS_RANK, type SectionObj } from '../../src/doc/types';
import type { PlaceData, RoadFact, Idea } from '../../src/site/places/facts';

const OUT_JSON = 'src/site/places/generated/places.json';
const only = new Set(process.argv.slice(2));
const r1 = (v: number) => Math.round(v * 10) / 10;
const rank = (s: SectionObj) => CLASS_RANK[s.cls] ?? 6;
/** on a bridge / flyover deck */
const onDeck = (s: SectionObj) => s.bridge !== 'none';
/** off the ground for width purposes: decks and the ramps up to them */
const offGround = (s: SectionObj) => onDeck(s) || s.elevated;

/** Length-weighted median of values. */
function wmedian(v: [number, number][]): number {
  const a = v.filter((q) => q[1] > 0).sort((p, q) => p[0] - q[0]);
  const tot = a.reduce((s, q) => s + q[1], 0);
  let acc = 0;
  for (const [x, w] of a) { acc += w; if (acc >= tot / 2) return x; }
  return a.length ? a[a.length - 1][0] : 0;
}

// ---------------- building edges, for the building-to-building measure and the DP check ----------------

class EdgeGrid {
  cells = new Map<string, number[]>();
  constructor(A: Area, readonly C = 16) {
    for (const b of A.buildings) {
      const P = b.outer, n = P.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, ax = P[i * 2], az = P[i * 2 + 1], bx = P[j * 2], bz = P[j * 2 + 1];
        for (let cz = Math.floor(Math.min(az, bz) / C); cz <= Math.floor(Math.max(az, bz) / C); cz++) for (let cx = Math.floor(Math.min(ax, bx) / C); cx <= Math.floor(Math.max(ax, bx) / C); cx++) {
          const k = `${cx},${cz}`;
          (this.cells.get(k) ?? this.cells.set(k, []).get(k)!).push(ax, az, bx, bz);
        }
      }
    }
  }
  /** Distance along a ray to the first building edge (Infinity if none within `max`). */
  ray(x: number, z: number, dx: number, dz: number, max: number): number {
    let best = Infinity;
    const seen = new Set<string>();
    for (let t = 0; t <= max + this.C; t += this.C / 2) {
      const k = `${Math.floor((x + dx * t) / this.C)},${Math.floor((z + dz * t) / this.C)}`;
      if (seen.has(k)) continue;
      seen.add(k);
      const E = this.cells.get(k);
      if (E) for (let e = 0; e < E.length; e += 4) {
        const ex = E[e + 2] - E[e], ez = E[e + 3] - E[e + 1];
        const den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-9) continue;
        const qx = E[e] - x, qz = E[e + 1] - z;
        const s = (qx * ez - qz * ex) / den, u = (qx * dz - qz * dx) / den;
        if (s > 0 && s < best && u >= 0 && u <= 1) best = s;
      }
      if (best < t) break;
    }
    return best <= max ? best : Infinity;
  }
}

// ---------------- one place ----------------

const inR = (A: Area, x: number, z: number) => Math.hypot(x - A.x, z - A.z) <= A.r;

/**
 * Mapped one-way: a pair of carriageways (one-way both ways, side by side; the widths are each one's) or a one-way
 * street — by the directions its one-way sections run in, against the longest one's. Undefined: two-way.
 */
function onewayOf(base: (readonly [Sec, number])[]): 'pair' | 'single' | undefined {
  const one = base.filter(([q]) => isOneway(q.s.parts));
  const tot = base.reduce((a, [, L]) => a + L, 0), L1 = one.reduce((a, [, L]) => a + L, 0);
  if (L1 <= tot / 2) return undefined;
  const dir = (P: number[]) => { const dx = P[P.length - 2] - P[0], dz = P[P.length - 1] - P[1], l = Math.hypot(dx, dz) || 1; return [dx / l, dz / l]; };
  const ref = dir([...one].sort((p, q) => q[1] - p[1])[0][0].pts);
  let fwd = 0, bwd = 0;
  for (const [q, L] of one) { const d = dir(q.pts); if (d[0] * ref[0] + d[1] * ref[1] >= 0) fwd += L; else bwd += L; }
  return Math.min(fwd, bwd) >= 0.3 * (fwd + bwd) ? 'pair' : 'single';
}

function roadFacts(A: Area, list: Sec[], grid: EdgeGrid, label?: string): RoadFact | null {
  const lens = list.map((q) => lengthInside(q.pts, A.x, A.z, A.r));
  const len = lens.reduce((a, b) => a + b, 0);
  if (len < 60) return null;
  const ground = list.map((q, k) => [q, lens[k]] as const).filter(([q, L]) => L > 0 && !offGround(q.s) && !q.s.tunnel);
  const base = ground.length ? ground : list.map((q, k) => [q, lens[k]] as const).filter(([, L]) => L > 0);
  const ws = base.map(([q, L]) => [totalWidth(q.s.parts), L] as [number, number]);
  const w = wmedian(ws);
  const lanesBy = new Map<number, number>();
  for (const [q, L] of base) { const n = laneCount(q.s.parts).all; lanesBy.set(n, (lanesBy.get(n) ?? 0) + L); }
  const lanes = [...lanesBy].sort((p, q) => q[1] - p[1])[0][0];
  const dpList = base.filter(([q]) => q.s.reserve);
  const dpLen = dpList.reduce((a, [, L]) => a + L, 0);
  const dp = dpLen ? wmedian(dpList.map(([q, L]) => [q.s.reserve!, L])) : undefined;
  const clsBy = new Map<string, number>();
  for (const [q, L] of base) clsBy.set(q.s.cls, (clsBy.get(q.s.cls) ?? 0) + L);
  const cls = [...clsBy].sort((p, q) => q[1] - p[1])[0][0];
  // building line to building line, every 10 m along the ground-level road inside the circle
  const gaps: number[] = [];
  let samples = 0;
  for (const [q] of ground) {
    const P = q.pts;
    let carry = 0;
    for (let k = 0; k + 3 < P.length; k += 2) {
      const ax = P[k], az = P[k + 1], dx = P[k + 2] - ax, dz = P[k + 3] - az, d = Math.hypot(dx, dz);
      if (d < 1e-6) continue;
      for (let t = carry; t < d; t += 10) {
        const x = ax + (dx * t) / d, z = az + (dz * t) / d;
        if (!inR(A, x, z)) continue;
        samples++;
        const nx = -dz / d, nz = dx / d, max = 45;
        const a = grid.ray(x, z, nx, nz, max), b = grid.ray(x, z, -nx, -nz, max);
        if (a < Infinity && b < Infinity) gaps.push(a + b);
      }
      carry = (carry - d) % 10; if (carry < 0) carry += 10;
    }
  }
  gaps.sort((p, q) => p - q);
  const gapShare = samples ? gaps.length / samples : 0;
  // buildings with a corner inside the DP width, measured from today's centre line (the editor's own check)
  let inDp: number | undefined;
  if (dp) {
    const hit = new Set<number>();
    for (const [q] of dpList) {
      const half = q.s.reserve! / 2;
      if (q.s.reserve! <= totalWidth(q.s.parts) + 1.5) continue;
      A.buildings.forEach((b, bi) => {
        if (hit.has(bi) || !inR(A, b.cx, b.cz)) return;
        for (let k = 0; k < b.outer.length; k += 2) if (lineDist(q.pts, b.outer[k], b.outer[k + 1]) < half - 1) { hit.add(bi); return; }
      });
    }
    inDp = hit.size;
  }
  const deck = list.reduce((a, q, k) => a + (onDeck(q.s) ? lens[k] : 0), 0);
  const metro = list.reduce((a, q, k) => a + (q.s.viaduct ? lens[k] : 0), 0);
  const baseLen = base.reduce((a, [, L]) => a + L, 0);
  return {
    name: list[0].s.name, ...(label ? { label } : {}), cls: CLASS_LABEL[cls] ?? cls, len: Math.round(len),
    w: r1(w), wMin: r1(Math.min(...ws.map((q) => q[0]))), wMax: r1(Math.max(...ws.map((q) => q[0]))),
    cw: r1(wmedian(base.map(([q, L]) => [carriageWidth(q.s.parts), L]))), lanes,
    divided: base.filter(([q]) => hasMedian(q.s.parts)).reduce((a, [, L]) => a + L, 0) > baseLen / 2,
    ...(onewayOf(base) ? { oneway: onewayOf(base)! } : {}),
    ...(dp ? { dp, dpShare: r1(dpLen / baseLen) } : {}),
    ...(gapShare >= 0.4 && gaps.length >= 8 ? { gap: r1(gaps[gaps.length >> 1]), gapShare: r1(gapShare) } : {}),
    ...(inDp !== undefined ? { inDp } : {}),
    ...(deck >= 30 ? { elevated: Math.round(deck) } : {}),
    ...(metro >= 30 ? { metro: Math.round(metro) } : {}),
    // where it narrows: length well under its typical width
    narrow: Math.round(base.filter(([q]) => totalWidth(q.s.parts) < 0.75 * w).reduce((a, [, L]) => a + L, 0)),
  };
}

/** Main-road junctions (three or more roads, one of them a main road) inside the circle. */
function mainJunctions(A: Area) {
  const major = new Set<string>();
  for (const { s } of A.sections) if (rank(s) <= 4) { major.add(s.a); major.add(s.b); }
  return A.junctions.filter((j) => major.has(j.id) && (A.arms.get(j.id) ?? 0) >= 3 && inR(A, j.x, j.z));
}

/**
 * The tightest knot of main-road junctions: the one with the most others within 35 m (the way a big crossing
 * often ends up mapped — split carriageways, slips, a flyover's ramps).
 */
function knot(A: Area, J: ReturnType<typeof mainJunctions>): { n: number; span: number; roads: string[]; x: number; z: number } | null {
  let best: typeof J = [];
  for (const a of J) {
    const g = J.filter((b) => Math.hypot(a.x - b.x, a.z - b.z) <= 35);
    if (g.length > best.length) best = g;
  }
  if (best.length < 3) return null;
  const ids = new Set(best.map((j) => j.id));
  const roads = new Map<string, number>();
  for (const { s, pts } of A.sections) if (s.name && rank(s) <= 4 && (ids.has(s.a) || ids.has(s.b))) roads.set(s.name, (roads.get(s.name) ?? 0) + pts.length);
  let span = 0;
  for (const a of best) for (const b of best) span = Math.max(span, Math.hypot(a.x - b.x, a.z - b.z));
  const x = best.reduce((t, j) => t + j.x, 0) / best.length, z = best.reduce((t, j) => t + j.z, 0) / best.length;
  return { n: best.length, span: Math.round(span), roads: [...roads].sort((p, q) => q[1] - p[1]).slice(0, 3).map((q) => q[0]), x, z };
}

function placeFacts(R: Region, city: 'pune' | 'mumbai', cfg: PlaceConfig, dpTiles: { x0: number; z0: number; size: number }[]): { data: PlaceData; A: Area; featured: Set<string> } {
  const [x, z] = R.xz(cfg.lat, cfg.lon);
  const A = areaAround(R, x, z, cfg.r);
  const grid = new EdgeGrid(A);
  // ---- the area ----
  let roadKm = 0, mainKm = 0, offKm = 0, underKm = 0, dpKm = 0;
  const named = new Map<string, number>();
  for (const q of A.sections) {
    const L = lengthInside(q.pts, x, z, cfg.r);
    if (!L) continue;
    roadKm += L;
    if (rank(q.s) <= 4) mainKm += L;
    if (q.s.tunnel) underKm += L; else if (onDeck(q.s)) offKm += L;
    if (q.s.reserve) dpKm += L;
    if (q.s.name) named.set(q.s.name, (named.get(q.s.name) ?? 0) + L);
  }
  const inside = A.junctions.filter((j) => inR(A, j.x, j.z));
  const junctions = inside.filter((j) => (A.arms.get(j.id) ?? 0) >= 3).length;
  const bld = A.buildings.filter((b) => inR(A, b.cx, b.cz));
  const foot = bld.reduce((a, b) => a + b.area, 0);
  const hs = A.heights.slice().sort((p, q) => p - q);
  // ---- featured roads: the configured ones, then the main roads, longest first ----
  const byName = new Map<string, Sec[]>();
  for (const q of A.sections) if (q.s.name) (byName.get(q.s.name) ?? byName.set(q.s.name, []).get(q.s.name)!).push(q);
  const roads: RoadFact[] = [];
  const want = (cfg.roads ?? []).map((q) => (typeof q === 'string' ? { osm: q, label: undefined } : q));
  for (const { osm, label } of want) {
    const f = byName.has(osm) ? roadFacts(A, byName.get(osm)!, grid, label) : null;
    if (f) roads.push(f); else console.warn(`  ! ${cfg.slug}: “${osm}” not found within ${cfg.r} m`);
  }
  // (main roads only: mostly a main-road class, 6 m or more, and a real name rather than "Service Road")
  const generic = /^(service r(oa)?d|lane\b|road no|unnamed)/i;
  const mainNames = [...named].filter(([n, L]) => L >= 150 && !generic.test(n) && !roads.some((f) => f.name === n)
    && byName.get(n)!.filter((q) => rank(q.s) <= 4 && !offGround(q.s)).reduce((a, q) => a + lengthInside(q.pts, x, z, cfg.r), 0) >= L / 2).sort((p, q) => q[1] - p[1]);
  for (const [n] of mainNames) { if (roads.length >= 4) break; const f = roadFacts(A, byName.get(n)!, grid); if (f && f.w >= 6) roads.push(f); }
  // ---- DP ----
  const traced = dpKm >= 100;
  const sheets = dpTiles.some((t) => x >= t.x0 && x < t.x0 + t.size && z >= t.z0 && z < t.z0 + t.size);
  let dpBuildings: number | undefined;
  if (traced) {
    const hit = new Set<number>();
    for (const q of A.sections) {
      const s = q.s;
      if (!s.reserve || offGround(s) || s.tunnel || s.reserve <= totalWidth(s.parts) + 1.5) continue;
      const half = s.reserve / 2;
      let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
      for (let k = 0; k < q.pts.length; k += 2) { bx0 = Math.min(bx0, q.pts[k]); bx1 = Math.max(bx1, q.pts[k]); bz0 = Math.min(bz0, q.pts[k + 1]); bz1 = Math.max(bz1, q.pts[k + 1]); }
      bld.forEach((b, bi) => {
        if (hit.has(bi) || b.cx < bx0 - half - 60 || b.cx > bx1 + half + 60 || b.cz < bz0 - half - 60 || b.cz > bz1 + half + 60) return;
        for (let k = 0; k < b.outer.length; k += 2) if (lineDist(q.pts, b.outer[k], b.outer[k + 1]) < half - 1) { hit.add(bi); return; }
      });
    }
    dpBuildings = hit.size;
  }
  // ---- what-ifs: a few concrete, data-led questions ----
  const ideas: Idea[] = [];
  const nm = (f: RoadFact) => f.label ?? f.name;
  for (const f of roads) {
    if (!f.dp || (f.dpShare ?? 0) < 0.3) continue;
    const today = f.gap !== undefined ? Math.min(f.gap, f.w) : f.w;
    if (f.dp - today >= 3) ideas.push({ k: 'widen', road: nm(f), dp: f.dp, w: f.w, ...(f.gap !== undefined ? { gap: f.gap } : {}), ...(f.inDp ? { n: f.inDp } : {}) });
  }
  const MJ = mainJunctions(A);
  const kn = knot(A, MJ);
  if (kn && kn.n >= 4) { const [la, lo] = R.ll(kn.x, kn.z); ideas.push({ k: 'cluster', n: kn.n, span: kn.span, roads: kn.roads, at: [+la.toFixed(5), +lo.toFixed(5)] }); }
  for (const f of roads) {
    if (ideas.length >= 3) break;
    if (f.narrow >= 60 && f.wMax - f.wMin >= 6 && !f.dp && !f.oneway) ideas.push({ k: 'pinch', road: nm(f), w: f.w, wMin: f.wMin, len: f.narrow });
  }
  const sig = inside.filter((j) => j.signals).length, mainSig = MJ.filter((j) => j.signals).length;
  if (ideas.length < 2 && MJ.length >= 5) ideas.push({ k: 'signals', n: mainSig, of: MJ.length });
  if (ideas.length < 3 && roads[0]) {
    // try the next standard width up (the DP's widths) on the main road
    const f = roads.find((q) => !q.dp && !q.elevated) ?? roads[0];
    const next = DP_WIDTHS.find((d) => d >= f.w + 2.5);
    if (next && !f.oneway) ideas.push({ k: 'try', road: nm(f), w: f.w, to: next });
  }
  const bake = (R.M.baked ?? new Date().toISOString()).slice(0, 10);
  const zoom = r1(Math.log2((156543.03 * Math.cos((cfg.lat * Math.PI) / 180)) / ((2.6 * cfg.r) / 1400)));
  const data: PlaceData = {
    city, slug: cfg.slug, name: cfg.name, ...(cfg.aka ? { aka: cfg.aka } : {}), lat: cfg.lat, lon: cfg.lon, r: cfg.r, zoom, baked: bake,
    area: {
      roadKm: r1(roadKm / 1000), mainKm: r1(mainKm / 1000), offKm: r1(offKm / 1000), underKm: r1(underKm / 1000), named: named.size,
      junctions, mainJunctions: MJ.length, signals: sig, roundabouts: inside.filter((j) => j.R).length,
      buildings: bld.length, coverage: r1((100 * foot) / (Math.PI * cfg.r * cfg.r)),
      elevMin: Math.round(hs[0] ?? 0), elevMax: Math.round(hs[hs.length - 1] ?? 0),
    },
    dp: city === 'mumbai' ? 'none' : traced ? 'traced' : sheets ? 'sheets' : 'none',
    ...(traced ? { dpKm: r1(dpKm / 1000), dpBuildings } : {}),
    roads, ideas: ideas.slice(0, 3), nearby: [],
    map: `places/${city}/${cfg.slug}.svg`, image: `places/${city}/${cfg.slug}.jpg`,
  };
  return { data, A, featured: new Set(roads.map((f) => f.name)) };
}

// ---------------- the SVG map ----------------

const VB = 1000;

/** Douglas–Peucker on flat x,z pairs. */
function simplify(P: number[], tol: number): number[] {
  const n = P.length / 2;
  if (n <= 2) return P;
  const keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const ax = P[a * 2], az = P[a * 2 + 1], dx = P[b * 2] - ax, dz = P[b * 2 + 1] - az, L = Math.hypot(dx, dz) || 1e-9;
    let best = -1, bi = -1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((P[i * 2] - ax) * dz - (P[i * 2 + 1] - az) * dx) / L; if (d > best) { best = d; bi = i; } }
    if (best > tol) { keep[bi] = 1; stack.push([a, bi], [bi, b]); }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(P[i * 2], P[i * 2 + 1]);
  return out;
}

/** Compact path data: absolute move, then relative whole-unit steps. */
function pathD(P: number[], close = false): string {
  let d = '', px = 0, pz = 0;
  for (let i = 0; i < P.length; i += 2) {
    const x = Math.round(P[i]), z = Math.round(P[i + 1]);
    if (i === 0) d += `M${x} ${z}`;
    else { const dx = x - px, dz = z - pz; if (!dx && !dz) continue; d += (i === 2 ? 'l' : dx < 0 ? '' : ' ') + dx + (dz < 0 ? '' : ' ') + dz; }
    px = x; pz = z;
  }
  return d + (close ? 'z' : '');
}

/** Offset a polyline sideways by `o` (left positive), mitred simply at the joints. */
function offset(P: number[], o: number): number[] {
  const n = P.length / 2, out: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
    const dx = P[b * 2] - P[a * 2], dz = P[b * 2 + 1] - P[a * 2 + 1], L = Math.hypot(dx, dz) || 1;
    out.push(P[i * 2] - (dz / L) * o, P[i * 2 + 1] + (dx / L) * o);
  }
  return out;
}

/** The map, simplified harder (`level` 0, 1, 2…) until it's small enough. */
function mapSvgUnder(A: Area, featured: Set<string>, max = 58 * 1024): { inner: string; svg: string } {
  for (let level = 0; ; level++) {
    const m = mapSvg(A, featured, level);
    if (m.svg.length <= max || level >= 4) return m;
  }
}

function mapSvg(A: Area, featured: Set<string>, level = 0): { inner: string; svg: string } {
  const S = 2.2 * A.r, k = VB / S, x0 = A.x - S / 2, z0 = A.z - S / 2;
  const T = (P: ArrayLike<number>) => { const o: number[] = []; for (let i = 0; i < P.length; i += 2) o.push((P[i] - x0) * k, (P[i + 1] - z0) * k); return o; };
  const inBox = (P: number[], m = 30) => { for (let i = 0; i < P.length; i += 2) if (P[i] > -m && P[i] < VB + m && P[i + 1] > -m && P[i + 1] < VB + m) return true; return false; };
  // buildings: one path
  let bd = '';
  for (const b of A.buildings) {
    const P = T(b.outer);
    if (!inBox(P, 0) || Math.abs(ringArea(P)) < 3 + level * 4) continue;
    const s = simplify(P, 0.7 + level * 0.35); // (an open ring: its first and last corners are distinct)
    if (s.length >= 6) bd += pathD(s, true);
  }
  // roads by width: casing and fill, one path per (layer, width)
  const layers = new Map<string, string>();
  const add = (key: string, d: string) => layers.set(key, (layers.get(key) ?? '') + d);
  let dpd = '';
  for (const { s, pts } of A.sections) {
    if (s.tunnel) continue;
    const P = T(pts);
    if (!inBox(P)) continue;
    const sp = simplify(P, 0.6 + level * 0.2), d = pathD(sp);
    const w = Math.max(1.2, Math.round(totalWidth(s.parts) * k * 2) / 2);
    const lvl = onDeck(s) ? 'b' : 'g', f = featured.has(s.name) ? 'f' : rank(s) <= 4 ? 'm' : 'n';
    add(`${lvl}|${f}|${w}`, d);
    if (s.reserve && !onDeck(s)) { const h = (s.reserve / 2) * k; dpd += pathD(simplify(offset(P, h), 0.6)) + pathD(simplify(offset(P, -h), 0.6)); }
  }
  const FILL: Record<string, string> = { f: '#ffb27f', m: '#ffffff', n: '#fbfaf7' }, CASE: Record<string, string> = { f: '#d9531e', m: '#a59d92', n: '#c8c1b6' };
  let roads = '';
  for (const lvl of ['g', 'b']) for (const pass of ['c', 'f']) for (const f of ['n', 'm', 'f']) {
    for (const [key, d] of [...layers].filter(([q]) => q.startsWith(`${lvl}|${f}|`))) {
      const w = +key.split('|')[2];
      roads += pass === 'c' ? `<path d="${d}" stroke="${lvl === 'b' ? '#7d756b' : CASE[f]}" stroke-width="${w + 1.6}"/>` : `<path d="${d}" stroke="${FILL[f]}" stroke-width="${w}"/>`;
    }
  }
  // scale bar: a round length about a fifth of the map
  const bar = [50, 100, 200, 250, 500].reduce((p, q) => (Math.abs(q * k - VB / 5) < Math.abs(p * k - VB / 5) ? q : p));
  const bx = 28, by = VB - 34, bw = bar * k;
  const c = VB / 2, rr = A.r * k;
  const inner = `<rect width="${VB}" height="${VB}" fill="#f2efe9"/>`
    + `<path d="${bd}" fill="#dcd5ca" stroke="#cfc6b9" stroke-width="0.6"/>`
    + `<g fill="none" stroke-linecap="round" stroke-linejoin="round">${roads}</g>`
    + (dpd ? `<path d="${dpd}" fill="none" stroke="#c0262d" stroke-width="2.2" stroke-dasharray="7 5"/>` : '')
    + `<circle cx="${c}" cy="${c}" r="${Math.round(rr)}" fill="none" stroke="#3a3530" stroke-opacity="0.55" stroke-width="2.5" stroke-dasharray="3 7"/>`
    + `<g font-family="Inter, Segoe UI, Arial, sans-serif" font-size="22" fill="#2b2723"><rect x="${bx - 10}" y="${by - 30}" width="${Math.round(bw) + 92}" height="52" rx="8" fill="#fff" fill-opacity="0.85"/>`
    + `<path d="M${bx} ${by - 8}v10h${Math.round(bw)}v-10" fill="none" stroke="#2b2723" stroke-width="3"/><text x="${Math.round(bx + bw + 10)}" y="${by + 2}">${bar} m</text>`
    + `<path d="M${VB - 40} 64l14-36 14 36-14-9z" fill="#2b2723"/><text x="${VB - 26}" y="88" text-anchor="middle" font-size="20">N</text></g>`;
  return { inner, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB} ${VB}">${inner}</svg>` };
}

// ---------------- the share picture ----------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const w of text.split(' ')) { if (line && (line + ' ' + w).length > max) { out.push(line); line = w; } else line = line ? line + ' ' + w : w; }
  if (line) out.push(line);
  return out;
}

function shareSvg(P: PlaceData, mapInner: string): string {
  const city = P.city === 'pune' ? 'Pune' : 'Mumbai';
  // the title fits the left panel (about 0.56 em a character)
  let fs = 66, lines = wrap(P.name, 13);
  if (lines.length > 2) { fs = 52; lines = wrap(P.name, 17); }
  lines = lines.slice(0, 3);
  const top = 200;
  const title = lines.map((l, i) => `<text x="64" y="${top + i * (fs + 8)}" font-size="${fs}" font-weight="700">${esc(l)}</text>`).join('');
  const y2 = top + lines.length * (fs + 8) + 8;
  const main = P.roads[0];
  const stats: [string, string, string?][] = [
    [`${P.area.roadKm} km`, 'of road'],
    [`${P.area.mainJunctions}`, 'main-road', 'junctions'],
    main ? [`${main.dp ?? main.w} m`, main.dp ? 'DP width' : 'wide', main.label ?? main.name] : [`${P.area.buildings}`, 'buildings'],
  ];
  const cut = (l: string) => (l.length > 17 ? l.slice(0, 16) + '…' : l);
  const st = stats.map(([v, l, l2], i) => `<g transform="translate(${64 + [0, 196, 352][i]} 500)"><text font-size="38" font-weight="700" fill="#ff6a2b">${esc(v)}</text><text y="30" font-size="17" fill="#b9b4ad">${esc(cut(l))}</text>${l2 ? `<text y="52" font-size="17" fill="#b9b4ad">${esc(cut(l2))}</text>` : ''}</g>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">`
    + `<rect width="1200" height="630" fill="#0c0c0d"/>`
    + `<svg x="570" y="0" width="630" height="630" viewBox="0 0 ${VB} ${VB}">${mapInner}</svg>`
    + `<rect x="570" width="40" height="630" fill="url(#fade)"/><defs><linearGradient id="fade"><stop offset="0" stop-color="#0c0c0d"/><stop offset="1" stop-color="#0c0c0d" stop-opacity="0"/></linearGradient></defs>`
    + `<g font-family="Inter, Segoe UI, Arial, sans-serif" fill="#ffffff">`
    + `<rect x="64" y="58" width="30" height="30" rx="8" fill="#0c0c0d" stroke="#ffffff" stroke-opacity="0.2"/><path d="M73 83L77 63M85 83L81 63" stroke="#ff6a2b" stroke-width="3" stroke-linecap="round"/>`
    + `<text x="106" y="82" font-size="26" font-weight="600">Urban<tspan font-weight="800">Plan</tspan></text>`
    + `<text x="64" y="${top - fs - 10}" font-size="22" fill="#ff6a2b" font-weight="600" letter-spacing="2">${city.toUpperCase()}</text>`
    + title
    + `<text x="64" y="${y2}" font-size="26" fill="#d6d1ca">Road widths, ${P.dp === 'traced' ? 'the DP plan' : 'junctions'} and what-ifs</text>`
    + st + `</g></svg>`;
}

// ---------------- run ----------------

function main() {
  const prev: PlaceData[] = fs.existsSync(OUT_JSON) ? JSON.parse(fs.readFileSync(OUT_JSON, 'utf8')) : [];
  const out: PlaceData[] = [];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'places-'));
  for (const [city, list] of [['pune', PUNE], ['mumbai', MUMBAI]] as const) {
    const R = openRegion(city);
    const idx = `${R.dir}dp/index.json`;
    const dpTiles = city === 'pune' && fs.existsSync(idx) ? JSON.parse(fs.readFileSync(idx, 'utf8')).tiles : [];
    fs.mkdirSync(`public/places/${city}`, { recursive: true });
    for (const cfg of list) {
      if (only.size && !only.has(cfg.slug)) { const p = prev.find((q) => q.city === city && q.slug === cfg.slug); if (p) out.push(p); continue; }
      const t = Date.now();
      const { data, A, featured } = placeFacts(R, city, cfg, dpTiles);
      const { inner, svg } = mapSvgUnder(A, featured);
      fs.writeFileSync(`public/${data.map}`, svg);
      const png = new Resvg(shareSvg(data, inner), { fitTo: { mode: 'width', value: 1200 }, font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' } }).render().asPng();
      const pp = path.join(tmp, `${cfg.slug}.png`);
      fs.writeFileSync(pp, png);
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', pp, '-q:v', '6', `public/${data.image}`]);
      out.push(data);
      const kb = (f: string) => (fs.statSync(f).size / 1024).toFixed(0);
      console.log(`${city}/${cfg.slug}: ${data.area.roadKm} km road, ${data.area.junctions} junctions, ${data.area.buildings} buildings, dp ${data.dp}; roads ${data.roads.map((f) => `${f.label ?? f.name} ${f.w}${f.dp ? '/' + f.dp : ''} m`).join(', ')}; ideas ${data.ideas.map((q) => q.k).join(',')} — svg ${kb(`public/${data.map}`)} KB, jpg ${kb(`public/${data.image}`)} KB (${Date.now() - t} ms)`);
    }
  }
  // nearby: the closest places in the same city
  const km = (a: PlaceData, b: PlaceData) => Math.hypot((a.lat - b.lat) * 110.54, (a.lon - b.lon) * 111.32 * Math.cos((a.lat * Math.PI) / 180));
  for (const p of out) p.nearby = out.filter((q) => q.city === p.city && q !== p).sort((a, b) => km(p, a) - km(p, b)).slice(0, 4).map((q) => ({ slug: q.slug, km: r1(km(p, q)) }));
  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(out));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`${out.length} places → ${OUT_JSON} (${(fs.statSync(OUT_JSON).size / 1024).toFixed(0)} KB)`);
}

main();
