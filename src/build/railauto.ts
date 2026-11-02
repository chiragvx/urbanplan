// Auto height for drawn rail and metro lines (the road tool's rules, src/doc/structure.ts): a line drawn at grade
// gets a track level eased to its class's grade (2.5 % rail, 4 % metro) off the ground, and each stretch becomes a
// viaduct, at grade (the ground cut / filled to it), a cutting or a tunnel — over water always a viaduct.
import { classify, gradeGuide, type ProfileSample, type Stretch, type StructKind } from '../doc/structure';
import { trackStamps, type Stamp } from '../net/generate';
import type { TileData } from '../data/tile';

type RailIn = TileData['rails'][number];
/** A rail piece with its own track level per point (scene metres) and what it is, as buildRail takes it. */
export type RailPiece = RailIn & { zs?: Float32Array; kind?: StructKind };

const STEP = 8;

/** A line's track level along it: points every STEP m, arc lengths, the level, the ground, the samples and stretches. */
export interface RailProfile { P: number[]; S: number[]; z: number[]; G: number[]; samples: ProfileSample[]; stretches: Stretch[]; cls: string; len: number }

/**
 * Work out a line's track level and stretches: the ground (`ground`, scene metres) smoothed over ±48 m plus `lift`,
 * eased to the grade guide both ways from the ends (which stay on the ground), lifted 4 m clear of water.
 * Null when it's too short to bother (under 60 m).
 */
export function railProfile(pts: ArrayLike<number>, metro: boolean, ground: (x: number, z: number) => number, water: (x: number, z: number) => number | null, lift = 0): RailProfile | null {
  const n = pts.length / 2;
  if (n < 2) return null;
  // resample every STEP m
  const P: number[] = [pts[0], pts[1]], S = [0];
  let acc = 0;
  for (let i = 0; i < n - 1; i++) {
    const ax = pts[i * 2], az = pts[i * 2 + 1], bx = pts[i * 2 + 2], bz = pts[i * 2 + 3], L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-3) continue;
    const k = Math.max(1, Math.ceil(L / STEP));
    for (let j = 1; j <= k; j++) { const t = j / k; P.push(ax + (bx - ax) * t, az + (bz - az) * t); S.push(acc + L * t); }
    acc += L;
  }
  const m = S.length;
  if (acc < 60) return null;
  const G = Array.from({ length: m }, (_, i) => ground(P[i * 2], P[i * 2 + 1]));
  const z = G.map((_, i) => { let s = 0, w = 0; for (let j = Math.max(0, i - 6); j <= Math.min(m - 1, i + 6); j++) { s += G[j]; w++; } return s / w + lift; });
  z[0] = G[0] + lift; z[m - 1] = G[m - 1] + lift;
  const cls = metro ? 'metro' : 'rail', max = gradeGuide(cls);
  // passes each way (the ends held), starting either way and averaged: a hill is climbed and left alike (cut and fill shared)
  const ease = (fwdFirst: boolean) => {
    const y = z.slice();
    const fwd = () => { for (let i = 1; i < m - 1; i++) { const ds = S[i] - S[i - 1]; y[i] = Math.max(y[i - 1] - max * ds, Math.min(y[i - 1] + max * ds, y[i])); } };
    const back = () => { for (let i = m - 2; i > 0; i--) { const ds = S[i + 1] - S[i]; y[i] = Math.max(y[i + 1] - max * ds, Math.min(y[i + 1] + max * ds, y[i])); } };
    for (let it = 0; it < 3; it++) if (fwdFirst) { fwd(); back(); } else { back(); fwd(); }
    return y;
  };
  const zf = ease(true), zb = ease(false);
  for (let i = 0; i < m; i++) z[i] = (zf[i] + zb[i]) / 2;
  const samples: ProfileSample[] = S.map((s, i) => ({ s, road: z[i], ground: G[i], water: water(P[i * 2], P[i * 2 + 1]) }));
  // over water: clear it by 4 m at least
  samples.forEach((q, i) => { if (q.water != null) z[i] = q.road = Math.max(q.road, q.water + 4); });
  return { P, S, z, G, samples, stretches: classify(samples, cls), cls, len: acc };
}

/** Split one at-grade line into pieces by structure, each with its track level. */
export function autoRail(r: RailIn, hf: { sample(x: number, z: number): number }, water: (x: number, z: number) => number | null, lift = 0): RailPiece[] {
  const pr = railProfile(r.pts, r.metro, (x, z) => hf.sample(x, z), water, lift);
  if (!pr) return [r];
  const { P, S, z, stretches: st } = pr, m = S.length;
  if (st.length === 1 && st[0].kind === 'ground') return [r]; // on the ground all along: as drawn
  const out: RailPiece[] = [];
  for (const x of st) {
    const idx: number[] = [];
    for (let i = 0; i < m; i++) if (S[i] >= x.s0 - STEP && S[i] <= x.s1 + STEP) idx.push(i);
    if (idx.length < 2) continue;
    const pts = new Float32Array(idx.length * 2), zs = new Float32Array(idx.length);
    idx.forEach((i, k) => { pts[k * 2] = P[i * 2]; pts[k * 2 + 1] = P[i * 2 + 1]; zs[k] = z[i]; });
    out.push({ ...r, pts, zs, kind: x.kind, bridge: x.kind === 'bridge', tunnel: x.kind === 'tunnel', layer: x.kind === 'bridge' ? 1 : 0, deck: undefined });
  }
  return out;
}

/** Half the formation a track piece is drawn with (src/build/rail.ts). */
export const railHalfWidth = (r: RailIn, paired = false) => (r.formation ? r.formation / 2 : paired ? 4.7 : r.metro ? 2.6 : 1.9);

/** Terrain stamps of auto-height pieces: cut / filled to the track on the ground and in cuttings (a hole where cut deep), tunnels' open ends. */
export function railStamps(pieces: RailPiece[], T: (x: number, z: number) => number): Stamp[] {
  return pieces.flatMap((r) => (r.zs && r.kind && r.kind !== 'bridge' ? trackStamps(r.pts, r.zs, railHalfWidth(r), r.kind === 'tunnel', T) : []));
}
