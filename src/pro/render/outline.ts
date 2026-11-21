// A building's real outline: its blocks (the site report's quads, one per spine segment) unioned into one shape,
// courtyards kept, straight runs merged (so two blocks in line make one face, not a false corner), and each edge with
// its outward normal and whether each of its ends is an outside (convex) or an inside (reflex) corner. Everything
// that runs round a building's edge (facades, parapets, bands, columns, cornices, corner piers) is placed from this,
// never from the blocks, so nothing stands across a roof at a joint or pokes out of a corner.
import { fromFlat, inside, simplify, union, type MP } from '../../doc/ground';

export interface OutEdge {
  ax: number; az: number; ux: number; uz: number; nx: number; nz: number; L: number;
  /** whether the corner at the start / end is an outside one, and how far the outline turns there (radians, 0 … π) */
  startConvex: boolean; endConvex: boolean; startTurn: number; endTurn: number;
  /** on a courtyard's ring */
  court: boolean;
}
export interface Outline { shape: MP; rings: number[][]; edges: OutEdge[] }

const cache = new WeakMap<number[][], Outline>();

/** the outline of a building's blocks (cached per quads array) */
export function buildingOutline(quads: number[][]): Outline {
  const hit = cache.get(quads);
  if (hit) return hit;
  const shape = union(...quads.map(fromFlat));
  const rings: number[][] = [], edges: OutEdge[] = [];
  for (const poly of shape) poly.forEach((ring, ri) => {
    const flat0 = ring.flatMap((p) => [p[0], p[1]]);
    const r = flat0.length >= 6 ? simplify(flat0, 0.04) : flat0;
    const n = r.length / 2;
    if (n < 3) return;
    rings.push(r);
    const E: OutEdge[] = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, ax = r[i * 2], az = r[i * 2 + 1], bx = r[j * 2], bz = r[j * 2 + 1], L = Math.hypot(bx - ax, bz - az);
      if (L < 0.05) continue;
      const ux = (bx - ax) / L, uz = (bz - az) / L;
      // (outward: the side the building isn't on)
      let nx = uz, nz = -ux;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (inside(shape, mx + nx * 0.05, mz + nz * 0.05)) { nx = -nx; nz = -nz; }
      E.push({ ax, az, ux, uz, nx, nz, L, startConvex: true, endConvex: true, startTurn: Math.PI / 2, endTurn: Math.PI / 2, court: ri > 0 });
    }
    // each corner: outside when a point out along both normals is clear of the building
    for (let i = 0; i < E.length; i++) {
      const a = E[i], b = E[(i + 1) % E.length];
      const vx = a.ax + a.ux * a.L, vz = a.az + a.uz * a.L;
      const convex = !inside(shape, vx + (a.nx + b.nx) * 0.05, vz + (a.nz + b.nz) * 0.05);
      const turn = Math.acos(Math.max(-1, Math.min(1, a.ux * b.ux + a.uz * b.uz)));
      a.endConvex = convex; a.endTurn = turn; b.startConvex = convex; b.startTurn = turn;
    }
    edges.push(...E);
  });
  const out = { shape, rings, edges };
  cache.set(quads, out);
  return out;
}

/** how far a member reaching `reach` out from the face runs past (or stops short of) an edge's start and end: on an
 *  outside corner it runs on to meet its neighbour (reach × tan of half the turn), on an inside one it stops short */
export function endExt(e: Pick<OutEdge, 'startConvex' | 'endConvex' | 'startTurn' | 'endTurn'>, reach: number): [number, number] {
  const k = (turn: number) => Math.tan(Math.min(turn, 2.6) / 2);
  return [(e.startConvex ? 1 : -1) * reach * k(e.startTurn), (e.endConvex ? 1 : -1) * reach * k(e.endTurn)];
}

/** points where a line (through p along d) crosses a ring's edges, as distances along d, sorted */
export function crossings(ring: number[], px: number, pz: number, dx: number, dz: number): number[] {
  const out: number[] = [], n = ring.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, ax = ring[i * 2], az = ring[i * 2 + 1], ex = ring[j * 2] - ax, ez = ring[j * 2 + 1] - az;
    const den = dx * ez - dz * ex;
    if (Math.abs(den) < 1e-9) continue;
    const t = ((ax - px) * ez - (az - pz) * ex) / den, u = ((ax - px) * dz - (az - pz) * dx) / den;
    if (u >= 0 && u < 1) out.push(t);
  }
  return out.sort((a, b) => a - b);
}
