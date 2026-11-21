// What changes the plot, shared by the Site panel and the plot's editor on the view (./plotHud.tsx): its outline (a
// rectangle becomes a drawn outline on its first edit by hand), the road along each edge, its corners added or taken
// away (the roads kept with their edges), and the ground read off the terrain.
import { outline, type EdgeRoad, type ProProject } from './project';
import { DEFAULT_LEVELS, type Levels } from './siteObjects';
import { groundAt, groundOpen, plotOverRoad, type Ground } from './terrain';
import { nf } from './ui';

export const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
export const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** an edge's outward side as a compass point */
export function edgeFacing(ring: number[], k: number, north: number): string {
  let sa = 0; for (let i = 0; i < ring.length; i += 2) { const j = (i + 2) % ring.length; sa += ring[i] * ring[j + 1] - ring[j] * ring[i + 1]; }
  const i = 2 * k, j = (i + 2) % ring.length, dx = ring[j] - ring[i], dz = ring[j + 1] - ring[i + 1], L = Math.hypot(dx, dz) || 1;
  // outward normal (x east, z south), then its bearing clockwise from north
  const sg = sa > 0 ? 1 : -1, nx = (dz / L) * sg, nz = (-dx / L) * sg;
  const b = ((Math.atan2(nx, -nz) * 180) / Math.PI - north + 720) % 360;
  return DIRS[Math.round(b / 45) % 8];
}
/** an edge's outward normal (x, z) */
export function edgeOut(ring: number[], k: number): [number, number] {
  let sa = 0; for (let i = 0; i < ring.length; i += 2) { const j = (i + 2) % ring.length; sa += ring[i] * ring[j + 1] - ring[j] * ring[i + 1]; }
  const i = 2 * k, j = (i + 2) % ring.length, dx = ring[j] - ring[i], dz = ring[j + 1] - ring[i + 1], L = Math.hypot(dx, dz) || 1, sg = sa > 0 ? 1 : -1;
  return [(dz / L) * sg, (-dx / L) * sg];
}

const r2 = (x: number) => Math.round(x * 100) / 100;
/** the project with the plot's outline (and its roads, edge by edge) as given: always a drawn outline */
export const withRing = (ring: number[], roads: (EdgeRoad | null)[]): Partial<ProProject> => ({ shape: 'poly', ring: ring.map(r2), edgeRoads: roads });
/** the road along one edge */
export function withEdgeRoad(p: ProProject, k: number, rd: EdgeRoad | null): Partial<ProProject> {
  const o = outline(p);
  return withRing(o.ring, o.roads.map((x, i) => (i === k ? rd : x)));
}
/** a corner put in the middle of edge k (both halves keep its road) */
export function withCornerAdded(p: ProProject, k: number): Partial<ProProject> {
  const o = outline(p), n = o.ring.length / 2, i = 2 * k, j = (2 * ((k + 1) % n));
  const ring = [...o.ring]; ring.splice(i + 2, 0, (o.ring[i] + o.ring[j]) / 2, (o.ring[i + 1] + o.ring[j + 1]) / 2);
  const roads = [...o.roads]; roads.splice(k + 1, 0, o.roads[k]);
  return withRing(ring, roads);
}
/** corner c taken away (while three are left): the two edges either side become one, with either one's road */
export function withCornerRemoved(p: ProProject, c: number): Partial<ProProject> | null {
  const o = outline(p), n = o.ring.length / 2;
  if (n <= 3) return null;
  const prev = (c - 1 + n) % n, ring = [...o.ring]; ring.splice(2 * c, 2);
  const roads = [...o.roads]; roads[prev] = roads[prev] ?? roads[c]; roads.splice(c, 1);
  return withRing(ring, roads);
}
/** edge k set to a length: its far corner moves along it */
export function withEdgeLength(p: ProProject, k: number, len: number): Partial<ProProject> {
  const o = outline(p), n = o.ring.length / 2, i = 2 * k, j = 2 * ((k + 1) % n);
  const dx = o.ring[j] - o.ring[i], dz = o.ring[j + 1] - o.ring[i + 1], L = Math.hypot(dx, dz) || 1;
  const ring = [...o.ring]; ring[j] = o.ring[i] + (dx / L) * len; ring[j + 1] = o.ring[i + 1] + (dz / L) * len;
  return withRing(ring, o.roads);
}

/** The ground off the city's terrain (or open elevation data): the levels and the plot over its front road, and a
 *  sentence saying so; or why not. */
export async function readGround(p: ProProject, at: [number, number], ring: number[], o: { front?: { k: number; w: number } | null; open?: boolean } = {}): Promise<{ change: Partial<ProProject>; msg: string } | { fail: string; noTerrain: boolean }> {
  const L: Levels = { ...DEFAULT_LEVELS, ...(p.levels ?? {}) };
  let r0 = 0; for (let i = 0; i < ring.length; i += 2) r0 = Math.max(r0, Math.hypot(ring[i], ring[i + 1]));
  const g: Ground | null = o.open ? await groundOpen(at[0], at[1], r0).catch(() => null) : await groundAt(at[0], at[1], Math.max(20, Math.min(80, r0))).catch(() => null);
  if (!g) return { fail: o.open ? 'The elevation service didn’t answer: set the levels by hand.' : 'No city terrain here: use open elevation data, or set the levels by hand.', noTerrain: !o.open };
  // (the plot's middle over its front road: the road edge is the one with a road, else the longest)
  const er = outline(p).roads, ek = er.findIndex((x) => !!x), f = o.front ?? (ek >= 0 ? { k: ek, w: er[ek]!.today || 12 } : null);
  const over = f ? plotOverRoad(g, ring, f.k, f.w) : L.plot;
  return {
    change: { at, north: 0, levels: { ...L, src: g.region === 'open' ? 'open' : 'city', plot: over, slope: g.slope < 0.5 ? 0 : g.slope, dir: (Math.round(g.dir / 45) * 45) % 360, asl: g.elevation, terrain: true } },
    msg: `The ground: ${nf(g.elevation)} m over sea level, ${g.slope < 0.5 ? 'about level' : `${nf(g.slope)}% falling ${DIRS[Math.round(g.dir / 45) % 8]}`}, the plot ${over >= 0 ? `${nf(over, 1)} m over` : `${nf(-over, 1)} m under`} its road.`,
  };
}
