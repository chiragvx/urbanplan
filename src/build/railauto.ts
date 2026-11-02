// Auto height for drawn rail and metro lines (the road tool's rules, src/doc/structure.ts): a line drawn at grade
// gets a track level eased to its class's grade (2.5 % rail, 4 % metro) off the ground, and each stretch becomes a
// viaduct, at grade, or a tunnel / cutting (below the ground; not drawn) — over water always a viaduct.
import { classify, gradeGuide, type ProfileSample } from '../doc/structure';
import type { Heightfield } from '../geo/heightfield';
import type { TileData } from '../data/tile';

type RailIn = TileData['rails'][number];
/** A rail piece with its own track level per point (scene metres), as buildRail takes it. */
export type RailPiece = RailIn & { zs?: Float32Array };

const STEP = 8;

/** Split one at-grade line into pieces by structure, each with its track level. */
export function autoRail(r: RailIn, hf: Heightfield, water: (x: number, z: number) => number | null, lift = 0): RailPiece[] {
  const p = r.pts, n = p.length / 2;
  if (n < 2) return [r];
  // resample every STEP m
  const P: number[] = [p[0], p[1]], S = [0];
  let acc = 0;
  for (let i = 0; i < n - 1; i++) {
    const ax = p[i * 2], az = p[i * 2 + 1], bx = p[i * 2 + 2], bz = p[i * 2 + 3], L = Math.hypot(bx - ax, bz - az);
    if (L < 1e-3) continue;
    const k = Math.max(1, Math.ceil(L / STEP));
    for (let j = 1; j <= k; j++) { const t = j / k; P.push(ax + (bx - ax) * t, az + (bz - az) * t); S.push(acc + L * t); }
    acc += L;
  }
  const m = S.length;
  if (acc < 60) return [r];
  const g = (i: number) => hf.sample(P[i * 2], P[i * 2 + 1]);
  // the ground smoothed (±48 m), then eased to the grade guide both ways from the ends (which stay on the ground)
  const G = Array.from({ length: m }, (_, i) => g(i));
  const z = G.map((_, i) => { let s = 0, w = 0; for (let j = Math.max(0, i - 6); j <= Math.min(m - 1, i + 6); j++) { s += G[j]; w++; } return s / w + lift; });
  z[0] = G[0] + lift; z[m - 1] = G[m - 1] + lift;
  const cls = r.metro ? 'metro' : 'rail', max = gradeGuide(cls);
  for (let i = 1; i < m; i++) { const ds = S[i] - S[i - 1]; z[i] = Math.max(z[i - 1] - max * ds, Math.min(z[i - 1] + max * ds, z[i])); }
  for (let i = m - 2; i >= 0; i--) { const ds = S[i + 1] - S[i]; z[i] = Math.max(z[i + 1] - max * ds, Math.min(z[i + 1] + max * ds, z[i])); }
  const samples: ProfileSample[] = S.map((s, i) => ({ s, road: z[i], ground: G[i], water: water(P[i * 2], P[i * 2 + 1]) }));
  // over water: clear it by 4 m at least
  for (const q of samples) if (q.water != null) q.road = Math.max(q.road, q.water + 4);
  const st = classify(samples, cls);
  if (st.length === 1 && st[0].kind === 'ground') return [r];
  const out: RailPiece[] = [];
  for (const x of st) {
    const idx: number[] = [];
    for (let i = 0; i < m; i++) if (S[i] >= x.s0 - STEP && S[i] <= x.s1 + STEP) idx.push(i);
    if (idx.length < 2) continue;
    const pts = new Float32Array(idx.length * 2), zs = new Float32Array(idx.length);
    idx.forEach((i, k) => { pts[k * 2] = P[i * 2]; pts[k * 2 + 1] = P[i * 2 + 1]; zs[k] = x.kind === 'ground' ? Math.max(z[i], G[i]) : z[i]; });
    out.push({ ...r, pts, zs, bridge: x.kind === 'bridge', tunnel: x.kind === 'tunnel' || x.kind === 'cutting', layer: x.kind === 'bridge' ? 1 : 0, deck: undefined });
  }
  return out;
}
