// What is inside a core, laid out for the drawings and the PreDCR file: its staircases (two flights, the landings,
// the treads, the well and the way up), its lift shafts (sized by the car, with the car drawn in), the lift lobby
// (a fire-check lobby when the building needs one), and service ducts in what is left. The counts and sizes are the
// building systems' (./systems.ts: the user's settings, else what they work out to); the core's rectangle is the
// engine's. Everything is in plan metres (x, z), so it draws at any scale.
//
// A core is read as a rectangle: its longest edge is its length (u), across it its depth (v). Stairs and lifts are
// set side by side along u; a stair's flights run along v; lifts stand at the back with the lobby in front. When the
// core is too short for all of it, everything is scaled along u to fit (and the sheet notes it).
import type { Evaluated } from './evaluate';
import { RISER, SHAFT, TREAD, type LiftCap } from './systems';

export interface StairDetail {
  /** the stair's enclosure, its two flights, its two landings */
  box: number[]; flights: [number[], number[]]; landings: number[][];
  /** tread lines (x0, z0, x1, z1) and the well between the flights */
  treads: number[][]; well: number[];
  /** the way up: a line along the first flight then across the landing and down the second (x, z, …) */
  path: number[];
  width: number; risers: number; label: string;
}
export interface LiftDetail { shaft: number[]; car: number[]; label: string; fire: boolean; size: string }
export interface CoreDetail {
  core: number[];
  stairs: StairDetail[]; lifts: LiftDetail[];
  /** the lobby in front of the lifts, the common lobby in what is left, and ducts */
  lobby: number[] | null; lobbyLabel: string; spare: number[] | null; ducts: number[][];
  /** the core is shorter than what it holds: drawn squeezed */
  squeezed: boolean;
}

/** what each core of a building holds: the systems' counts, shared out over its cores */
export function coreSpecs(e: Evaluated, bi: number): { stairs: number; lifts: number; stairW: number; cap: LiftCap; fire: boolean; service: boolean; lobby: boolean; floorH: number }[] {
  const b = e.d.buildings[bi], n = b.cores.length;
  if (!n) return [];
  const sys = e.sys.buildings[bi], auto = sys?.auto, set = e.p.systems?.byBuilding?.[b.b.id]?.cores ?? {};
  const pick = <T,>(v: T | undefined, a: T) => (v === undefined ? a : v);
  const stairs = pick(set.stairs, auto?.stairs ?? (b.height > 15 ? 2 : 1));
  const lifts = pick(set.lifts, auto?.lifts ?? (b.height > 15 ? 1 : 0));
  const stairW = pick(set.stairW, auto?.stairW ?? 1.2);
  const cap = pick(set.liftCap, auto?.liftCap ?? 8);
  const fire = pick(set.fireLift, auto?.fireLift ?? b.height > 15) && lifts > 0;
  const service = pick(set.serviceLift, auto?.serviceLift ?? false);
  const lobby = pick(set.lobby, auto?.lobby ?? b.height > 15);
  const floorH = b.laid?.floors[b.typical ?? 0]?.h ?? e.r.rules.floorH;
  // share out: every core gets a stair when there are enough; lifts as evenly as they go
  return Array.from({ length: n }, (_, i) => ({
    stairs: Math.floor(stairs / n) + (i < stairs % n ? 1 : 0),
    lifts: Math.floor(lifts / n) + (i < lifts % n ? 1 : 0) + (service && i === 0 ? 1 : 0),
    stairW, cap: (service && i === 0 ? cap : cap) as LiftCap, fire: fire && i === 0, service: service && i === 0, lobby, floorH,
  }));
}

/** a core's rectangle: an origin, its length axis u and depth axis v (unit), and their lengths */
function frame(c: number[]) {
  const n = c.length / 2;
  let best = -1, ux = 1, uz = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, dx = c[2 * j] - c[2 * i], dz = c[2 * j + 1] - c[2 * i + 1], L = Math.hypot(dx, dz);
    if (L > best) { best = L; ux = dx / L; uz = dz / L; }
  }
  const vx = -uz, vz = ux;
  let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity;
  for (let i = 0; i < n; i++) { const s = c[2 * i] * ux + c[2 * i + 1] * uz, t = c[2 * i] * vx + c[2 * i + 1] * vz; s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
  /** local (s along u from the start, t along v from the start) to plan x, z */
  const P = (s: number, t: number): [number, number] => [ux * (s0 + s) + vx * (t0 + t), uz * (s0 + s) + vz * (t0 + t)];
  return { L: s1 - s0, D: t1 - t0, P };
}

const WALL = 0.2; // a core's inner walls, as drawn (m)

/** Lay out one core. */
export function layCore(c: number[], spec: ReturnType<typeof coreSpecs>[number], startNo = 1, liftNo = 1): CoreDetail {
  const { L, D, P } = frame(c);
  const rect = (s0: number, t0: number, s1: number, t1: number) => [...P(s0, t0), ...P(s1, t0), ...P(s1, t1), ...P(s0, t1)];
  const line = (s0: number, t0: number, s1: number, t1: number) => [...P(s0, t0), ...P(s1, t1)];
  const w = spec.stairW, risers = Math.max(2, Math.ceil(spec.floorH / RISER - 1e-9)), perFlight = Math.ceil(risers / 2);
  const stairS = 2 * w + 0.15 + WALL;                                    // a dog-leg stair's width along the core
  const shaftSide = Math.sqrt(SHAFT[spec.cap]);                          // a square shaft, with its walls
  const liftS = spec.lifts * (shaftSide + 0.1);
  const ductS = 0.9;
  const need = spec.stairs * stairS + (spec.lifts ? liftS + 0.3 : 0) + ductS;
  const k = need > L ? L / need : 1;                                      // squeeze along u to fit
  const out: CoreDetail = { core: c, stairs: [], lifts: [], lobby: null, lobbyLabel: spec.lobby ? 'FIRE-CHECK LOBBY' : 'LIFT LOBBY', spare: null, ducts: [], squeezed: k < 0.98 };

  // the order along u: a stair, the lifts, a second stair (so two stairs are as far apart as the core lets them)
  const order: ('stair' | 'lifts')[] = spec.stairs >= 2 ? ['stair', ...(spec.lifts ? ['lifts' as const] : []), ...Array(spec.stairs - 1).fill('stair')] : [...Array(spec.stairs).fill('stair'), ...(spec.lifts ? ['lifts' as const] : [])];
  let s = 0, stairNo = startNo, ln = liftNo;
  for (const part of order) {
    if (part === 'stair') {
      const sw = stairS * k, fw = (sw - WALL * k - 0.15 * k) / 2; // each flight's width, as squeezed
      const a = s + (WALL * k) / 2, gap = 0.15 * k;
      const land = Math.min(w, D / 3);                                    // landings at both ends, a flight's width deep
      const going = Math.max(0.5, D - 2 * land);
      const steps = Math.max(1, perFlight - 1);
      const f1 = rect(a, land, a + fw, land + going), f2 = rect(a + fw + gap, land, a + 2 * fw + gap, land + going);
      const treads: number[][] = [];
      const tread = Math.min(TREAD, going / steps);
      for (let i = 1; i < steps; i++) {
        const t = land + i * tread;
        if (t >= land + going - 1e-6) break;
        treads.push(line(a, t, a + fw, t), line(a + fw + gap, land + going - i * tread, a + 2 * fw + gap, land + going - i * tread));
      }
      const mx1 = a + fw / 2, mx2 = a + fw + gap + fw / 2;
      out.stairs.push({
        box: rect(s, 0, s + sw, D), flights: [f1, f2], landings: [rect(a, 0, a + 2 * fw + gap, land), rect(a, land + going, a + 2 * fw + gap, D)],
        treads, well: line(a + fw + gap / 2, land, a + fw + gap / 2, land + going),
        path: [...P(mx1, land * 0.5), ...P(mx1, land + going + land * 0.5), ...P(mx2, land + going + land * 0.5), ...P(mx2, land + going * 0.35)],
        width: w, risers, label: `STAIR ${stairNo++}`,
      });
      s += sw;
    } else {
      const ss = (shaftSide + 0.1) * k, depth = Math.min(shaftSide, D * 0.6);
      for (let i = 0; i < spec.lifts; i++) {
        const a = s + 0.15 * k + i * ss, b = a + ss - 0.1 * k;
        const service = spec.service && i === spec.lifts - 1, fire = spec.fire && i === 0;
        out.lifts.push({
          shaft: rect(a, D - depth, b, D), car: rect(a + 0.12 * k, D - depth + 0.15, b - 0.12 * k, D - 0.15),
          label: service ? 'SERVICE LIFT' : fire ? 'FIRE LIFT' : `LIFT ${ln}`, fire,
          size: `${(shaftSide).toFixed(2)} × ${(shaftSide).toFixed(2)}`,
        });
        if (!service) ln++;
      }
      out.lobby = rect(s, 0, s + liftS * k + 0.3 * k, D - depth);
      s += liftS * k + 0.3 * k;
    }
  }
  // what is left: a service duct (1.2 m square at most) in the back corner, the rest common lobby
  const left = L - s;
  if (left > 0.4) {
    const dw = Math.min(1.2, left - 0.1), dd = Math.min(1.2, D / 2);
    out.ducts.push(rect(L - dw - 0.05, D - dd, L - 0.05, D));
    if (left - dw > 0.8) out.spare = [...P(s, 0), ...P(L, 0), ...P(L, D - dd), ...P(L - dw - 0.05, D - dd), ...P(L - dw - 0.05, D), ...P(s, D)];
    if (!out.lobby && out.spare) { out.lobby = out.spare; out.spare = null; }
  }
  return out;
}

/** every core of a building laid out, stairs and lifts numbered across the building */
export function buildingCores(e: Evaluated, bi: number): CoreDetail[] {
  const b = e.d.buildings[bi], specs = coreSpecs(e, bi);
  let stairNo = 1, liftNo = 1;
  return b.cores.map((c, i) => {
    const x = layCore(c, specs[i], stairNo, liftNo);
    stairNo += x.stairs.length; liftNo += x.lifts.filter((l) => /^LIFT \d/.test(l.label)).length;
    return x;
  });
}
