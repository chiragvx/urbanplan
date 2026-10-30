// Moving a map between coordinate frames. A tile's frame and a region's (city) frame are both equirectangular
// metres from their own origin, so one is the other scaled along x (cos of a slightly different latitude) and shifted:
//   x' = x·sx + ox,  z' = z + oz
// Maps made on the Koregaon Park tile open on the Pune region this way, then re-attach to the region's roads.
import type { MapFile, Obj, PatchEntry } from './types';

export interface FrameMove { sx: number; ox: number; oz: number }

const KZ = 110540;
const kxOf = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180);

/** From a tile centred on (lat, lon) into a region frame. */
export function frameMove(tile: { lat: number; lon: number }, region: { lat0: number; lon0: number; kx: number }): FrameMove {
  return { sx: region.kx / kxOf(tile.lat), ox: (tile.lon - region.lon0) * region.kx, oz: -(tile.lat - region.lat0) * KZ };
}

export const movePoint = (m: FrameMove, x: number, z: number): [number, number] => [x * m.sx + m.ox, z + m.oz];

/** x, z pairs (stride 2), or x, z, value triples (stride 3) */
function moveFlat(m: FrameMove, a: unknown, stride = 2): unknown {
  if (!Array.isArray(a)) return a;
  return a.map((v, k) => (typeof v !== 'number' ? v : k % stride === 0 ? v * m.sx + m.ox : k % stride === 1 ? v + m.oz : v));
}

/** Coordinate-bearing properties of an object (whole, or a partial `set`) moved into the new frame. */
export function moveProps(m: FrameMove, kind: Obj['kind'] | undefined, o: Record<string, unknown>, op?: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...o };
  if (kind === 'junction' || kind === undefined) {
    if (typeof o.x === 'number') out.x = o.x * m.sx + m.ox;
    if (typeof o.z === 'number') out.z = o.z + m.oz;
  }
  if (Array.isArray(o.path)) {
    out.path = (o.path as Record<string, number>[]).map((a) => ({ ...a, x: a.x * m.sx + m.ox, z: a.z + m.oz, ix: (a.ix ?? 0) * m.sx, ox: (a.ox ?? 0) * m.sx }));
  }
  if (Array.isArray(o.pts)) {
    const stride = kind === 'earthwork' && ['shift', 'level', 'soften', 'restore', 'embank'].includes(op ?? '') ? 3 : 2;
    out.pts = moveFlat(m, o.pts, stride);
  }
  for (const k of ['outer', 'ring']) if (Array.isArray(o[k])) out[k] = moveFlat(m, o[k]);
  if (Array.isArray(o.holes)) out.holes = (o.holes as unknown[]).map((h) => moveFlat(m, h));
  return out;
}

/** A whole map file moved into a new frame (and re-labelled for the region it now belongs to). */
export function moveMap(f: MapFile, m: FrameMove, tile: string): MapFile {
  const objects: Record<string, PatchEntry> = {};
  for (const [id, e] of Object.entries(f.objects)) {
    const kind = e.loc?.kind ?? e.add?.kind;
    const op = (e.add as { op?: string } | undefined)?.op ?? (e.set?.op as string | undefined);
    const n: PatchEntry = { ...e };
    if (e.loc) { const [x, z] = movePoint(m, e.loc.x, e.loc.z); n.loc = { ...e.loc, x, z }; }
    if (e.set) n.set = moveProps(m, kind, e.set, op);
    if (e.add) n.add = moveProps(m, e.add.kind, e.add as unknown as Record<string, unknown>, op) as unknown as Obj;
    objects[id] = n;
  }
  return { ...f, meta: { ...f.meta, tile, base: undefined }, objects };
}

/** Where a map's edits are (the middle of their locators / created objects), to open the region there. */
export function mapHome(f: MapFile): [number, number] | null {
  let sx = 0, sz = 0, n = 0;
  for (const e of Object.values(f.objects)) {
    let p: [number, number] | null = e.loc ? [e.loc.x, e.loc.z] : null;
    const a = e.add as unknown as Record<string, unknown> | undefined;
    if (!p && a) {
      if (typeof a.x === 'number' && typeof a.z === 'number') p = [a.x, a.z as number];
      else if (Array.isArray(a.path) && a.path.length) { const q = a.path[0] as { x: number; z: number }; p = [q.x, q.z]; }
      else if (Array.isArray(a.pts) && a.pts.length >= 2) p = [a.pts[0] as number, a.pts[1] as number];
    }
    if (!p) continue;
    sx += p[0]; sz += p[1]; n++;
  }
  return n ? [sx / n, sz / n] : null;
}
