// Height worked out per stretch, Cities: Skylines style. A road (or a track) is drawn from A to B at the heights the
// user picks; along the way each stretch becomes ground (an embankment or a shallow cut, the terrain reshaped to it),
// a bridge / viaduct, a cutting or a tunnel — from how far the ground is from the road and what it crosses. Short
// pieces merge into the longer neighbour; a stretch can be pinned to a kind. Steep grades are flagged, never refused.
// Pure functions (no editor state): the road tool, the inspector's long-section and the tests share them.

export type StructKind = 'ground' | 'bridge' | 'cutting' | 'tunnel';
export const STRUCT_KINDS: StructKind[] = ['ground', 'bridge', 'cutting', 'tunnel'];
export const STRUCT_LABEL: Record<StructKind, string> = { ground: 'Ground', bridge: 'Bridge', cutting: 'Cutting', tunnel: 'Tunnel' };
export const STRUCT_HINT: Record<StructKind, string> = {
  ground: 'Ground: an embankment or shallow cut, the terrain reshaped to the road',
  bridge: 'Bridge / viaduct: a deck on piers about every 30 m',
  cutting: 'Cutting: an open cut with side slopes',
  tunnel: 'Tunnel: portals at each end, the ground above left alone',
};

/** The thresholds (metres) a stretch's kind is decided by. Defaults; Settings can change them. */
export interface StructRules {
  /** the ground falls more than this below the road → a bridge */ bridge: number;
  /** the ground rises more than this above the road → a cutting */ cut: number;
  /** … more than this → a tunnel */ tunnel: number;
  /** headroom over a road or railway the road crosses */ clear: number;
  /** pieces shorter than this merge into their longer neighbour */ min: number;
}
export const STRUCT_RULES: StructRules = { bridge: 6, cut: 6, tunnel: 12, clear: 5.5, min: 30 };

/** Steepest comfortable grade by road class (IRC-ish guidance); steeper is flagged amber, never refused. */
export const GRADE_GUIDE: Record<string, number> = {
  motorway: 0.04, trunk: 0.05, primary: 0.05, secondary: 0.06, tertiary: 0.06, busway: 0.05,
  unclassified: 0.08, residential: 0.08, road: 0.08, living_street: 0.1, service: 0.1, track: 0.12,
  rail: 0.025, metro: 0.04,
};
export const gradeGuide = (cls: string) => GRADE_GUIDE[cls] ?? 0.08;

/** One point along the line: arc length, road level and ground level (same units), water level if over water. */
export interface ProfileSample {
  s: number; road: number; ground: number;
  /** water surface here (it's over a river / the sea), else null / undefined */ water?: number | null;
  /** what it must be here (crossing a road or railway at another level) */ force?: StructKind;
}

export interface Stretch {
  s0: number; s1: number;
  kind: StructKind;
  /** what the rules alone would make it */ auto: StructKind;
  /** pinned by the user */ pinned?: boolean;
  /** forced by water or a crossing (kept even when short) */ forced?: boolean;
  /** steepest grade (fraction, signed by direction of travel at that point) and whether it's past the guide */
  grade: number; steep: boolean;
  /** furthest the road is from the ground (m, + above, − below) */ depth: number;
}

/** A pin: a stretch of the line (arc lengths) held to a kind. */
export interface Pin { s0: number; s1: number; kind: StructKind }

/** What the rules make of one point: ground within ±bridge/cut, bridge above, cutting / tunnel below. */
export function kindAt(d: number, R: StructRules = STRUCT_RULES): StructKind {
  if (d > R.bridge) return 'bridge';
  if (d < -R.tunnel) return 'tunnel';
  if (d < -R.cut) return 'cutting';
  return 'ground';
}

interface Run { s0: number; s1: number; kind: StructKind; forced: boolean; pinned: boolean }

/**
 * Split a profile into stretches of one kind each: per point by the thresholds (water and crossings force a bridge
 * or a tunnel), pins override, then pieces shorter than `R.min` merge into their longer neighbour (forced and pinned
 * ones stay). `cls` picks the grade guide.
 */
export function classify(P: ProfileSample[], cls: string, R: StructRules = STRUCT_RULES, pins: Pin[] = []): Stretch[] {
  if (P.length < 2) return [];
  const pinAt = (s: number) => pins.find((p) => s >= p.s0 - 1e-6 && s <= p.s1 + 1e-6);
  const kinds = P.map((q) => {
    const pin = pinAt(q.s);
    if (pin) return { kind: pin.kind, forced: false, pinned: true };
    if (q.force) return { kind: q.force, forced: true, pinned: false };
    if (q.water !== null && q.water !== undefined) return { kind: 'bridge' as StructKind, forced: true, pinned: false };
    return { kind: kindAt(q.road - q.ground, R), forced: false, pinned: false };
  });
  // runs (a run ends half way to the next sample of another kind)
  let runs: Run[] = [];
  for (let i = 0; i < P.length; i++) {
    const k = kinds[i], last = runs[runs.length - 1];
    if (last && last.kind === k.kind && last.pinned === k.pinned) { last.forced ||= k.forced; continue; }
    const s = i === 0 ? P[0].s : (P[i - 1].s + P[i].s) / 2;
    if (last) last.s1 = s;
    runs.push({ s0: s, s1: P[P.length - 1].s, kind: k.kind, forced: k.forced, pinned: k.pinned });
  }
  // short pieces merge into the longer neighbour, shortest first
  for (let guard = 0; guard < 1000 && runs.length > 1; guard++) {
    let bi = -1, bl = Infinity;
    runs.forEach((r, i) => { const l = r.s1 - r.s0; if (l < R.min && !r.forced && !r.pinned && l < bl) { bl = l; bi = i; } });
    if (bi < 0) break;
    const a = runs[bi - 1], b = runs[bi + 1];
    const into = !a ? b : !b ? a : (a.s1 - a.s0 >= b.s1 - b.s0 ? a : b);
    const r = runs[bi];
    if (into === a) a.s1 = r.s1; else b.s0 = r.s0;
    runs.splice(bi, 1);
    runs = joinSame(runs);
  }
  runs = joinSame(runs);
  const guide = gradeGuide(cls);
  return runs.map((r) => {
    let grade = 0, depth = 0;
    let auto: StructKind = r.kind, worst = -1;
    for (let i = 0; i < P.length; i++) {
      const q = P[i];
      if (q.s < r.s0 - 1e-6 || q.s > r.s1 + 1e-6) continue;
      const d = q.road - q.ground;
      if (Math.abs(d) > Math.abs(depth)) depth = d;
      if (i > 0 && P[i - 1].s >= r.s0 - 1e-6) {
        const ds = q.s - P[i - 1].s;
        if (ds > 0.5) { const g = (q.road - P[i - 1].road) / ds; if (Math.abs(g) > Math.abs(grade)) grade = g; }
      }
      if (Math.abs(d) > worst) { worst = Math.abs(d); auto = q.force ?? kindAt(d, R); }
    }
    if (!r.pinned) auto = r.kind;
    return { s0: r.s0, s1: r.s1, kind: r.kind, auto, pinned: r.pinned || undefined, forced: r.forced || undefined, grade, steep: Math.abs(grade) > guide + 1e-4, depth };
  });
}

function joinSame(runs: Run[]): Run[] {
  const out: Run[] = [];
  for (const r of runs) {
    const l = out[out.length - 1];
    if (l && l.kind === r.kind && l.pinned === r.pinned) { l.s1 = r.s1; l.forced ||= r.forced; } else out.push({ ...r });
  }
  return out;
}

/** True when nothing along the line needs a structure (the road can simply follow the ground). */
export const allGround = (S: Stretch[]) => S.every((s) => s.kind === 'ground');

/** The kind an existing section is, from its level flags (and its pin). */
export function kindOfSection(s: { pin?: StructKind; elevated: boolean; bridge: string; tunnel?: boolean; path: { lift: number }[] }): StructKind {
  if (s.pin) return s.pin;
  if (s.elevated || s.bridge !== 'none') return 'bridge';
  // an open trench is a cutting; covered (deeper than 6.5 m, the mesher's COVER) a tunnel
  if (s.tunnel) return Math.min(...s.path.map((a) => a.lift)) <= -6.5 ? 'tunnel' : 'cutting';
  return 'ground';
}
