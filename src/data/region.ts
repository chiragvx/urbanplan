// A region (a whole city baked by tools/bake-region.ts): a manifest, city-wide objects, and 2 km pieces that are
// fetched as the camera moves. The pieces around the camera are assembled into one "window" — the same TileData the
// rest of the app works on, but a square of 3 × 3 pieces centred on (ox, oz) in the city frame.
import type { Obj } from '../doc/types';
import type { Area, Building, Line, Poly, TileData } from './tile';

export interface RegionManifest {
  version: 1; id: string; name: string; city: string;
  frame: { lat0: number; lon0: number; kx: number; kz: number };
  piece: number; cell: number;
  grid: { i0: number; i1: number; j0: number; j1: number };
  bounds: [number, number, number, number];
  base: number; fingerprint: string;
  legacy: Record<string, { lat: number; lon: number }>;
  pieces: [number, number, number][];
  counts: Record<string, number>;
  attribution: string;
}

export interface RegionGlobal { roads: Obj[]; lines: Obj[] }

export interface Piece {
  i: number; j: number; rect: [number, number, number, number];
  /** grid vertices along an edge (shared with the neighbour) */
  n: number;
  heights: Float32Array; waterLevel: Float32Array; waterMask: Uint8Array;
  buildings: (Building & { osm: number })[]; areas: Area[]; waters: Poly[]; waterways: (Line & { width: number })[];
  trees: Float32Array; busStops: { x: number; z: number; name: string }[]; signals: Float32Array;
  /** document objects reaching into this piece (sections, junctions, footpaths) */
  objs: Obj[];
  bytes: number;
}

type Typed = Float32Array | Uint32Array | Uint16Array | Uint8Array;

export const loadManifest = (base: string): Promise<RegionManifest> => fetch(base + 'region.json').then((r) => { if (!r.ok) throw new Error(`no region at ${base}`); return r.json(); });
export const loadGlobal = async (base: string): Promise<RegionGlobal> => JSON.parse(await fetchText(base + 'global.json.gz'));

/**
 * A gzipped file of the bake, as bytes. Decompressed here unless the host already did (some serve .gz with a
 * Content-Encoding header, and the browser unpacks it on the way in): gzip's magic bytes tell.
 */
export async function fetchGz(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const buf = await r.arrayBuffer();
  const b = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  if (b[0] !== 0x1f || b[1] !== 0x8b) return buf;
  return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
}
export const fetchText = async (url: string) => new TextDecoder().decode(await fetchGz(url));

/** A piece as downloaded (prefetched pieces are kept like this: parsing is left until they're needed). */
export interface RawPiece { json: string; bin: ArrayBuffer }

export async function fetchPiece(base: string, i: number, j: number): Promise<RawPiece> {
  const [json, bin] = await Promise.all([fetchText(`${base}p/${i}_${j}.json.gz`), fetchGz(`${base}p/${i}_${j}.bin.gz`)]);
  return { json, bin };
}

export const loadPiece = async (base: string, i: number, j: number): Promise<Piece> => parsePiece(await fetchPiece(base, i, j), i, j);

export function parsePiece(raw: RawPiece, i: number, j: number): Piece {
  const hdr = JSON.parse(raw.json), bin = raw.bin;
  const S: Record<string, Typed> = {};
  for (const s of hdr.sections) {
    const C = s.type === 'Float32Array' ? Float32Array : s.type === 'Uint32Array' ? Uint32Array : s.type === 'Uint16Array' ? Uint16Array : Uint8Array;
    S[s.name] = new C(bin, s.offset, s.length);
  }
  // heights: 2 cm steps above the city's base (or plain floats); dry pieces carry no water grids
  const metres = (a: Typed | undefined, fill: number) => !a ? new Float32Array(hdr.n * hdr.n).fill(fill) : a instanceof Uint16Array ? Float32Array.from(a, (v) => hdr.base + v * hdr.hq) : (a as Float32Array);
  const polys = (name: string): Poly[] => {
    const P = S[name + 'Pts'] as Float32Array, poly = S[name + 'Poly'] as Uint32Array;
    const rs = S[name + 'RingStart'] as Uint32Array, rc = S[name + 'RingCount'] as Uint32Array;
    const out: Poly[] = [];
    for (let k = 0; k < poly.length; k += 2) {
      const rings: Float32Array[] = [];
      for (let r = poly[k]; r < poly[k] + poly[k + 1]; r++) rings.push(P.slice(rs[r] * 2, (rs[r] + rc[r]) * 2));
      out.push({ outer: rings[0], holes: rings.slice(1) });
    }
    return out;
  };
  const lines = (name: string): Line[] => {
    const P = S[name + 'Pts'] as Float32Array, st = S[name + 'Start'] as Uint32Array, ct = S[name + 'Count'] as Uint32Array;
    return Array.from(st, (s, k) => ({ pts: P.slice(s * 2, (s + ct[k]) * 2) }));
  };
  const bs = S.busStops as Float32Array;
  return {
    i, j, rect: hdr.rect, n: hdr.n,
    heights: metres(S.terrain, hdr.base ?? 0), waterLevel: metres(S.waterLevel, (hdr.base ?? 0) - 1), waterMask: (S.waterMask as Uint8Array) ?? new Uint8Array(hdr.n * hdr.n),
    buildings: polys('bld').map((p, k) => ({
      ...p, id: hdr.bldIds[k], osm: hdr.bldIds[k], h: (S.bldHeight as Float32Array)[k], minH: (S.bldMinHeight as Float32Array)[k],
      kind: S.bldKind[k], roof: S.bldRoof[k], name: hdr.bldNames[k] ?? '',
    })),
    areas: polys('area').map((p, k) => ({ ...p, kind: S.areaKind[k] })),
    waters: polys('water'),
    waterways: lines('ww').map((l, k) => ({ ...l, width: (S.wwWidth as Float32Array)[k] })),
    trees: S.trees as Float32Array,
    busStops: Array.from({ length: bs.length / 2 }, (_, k) => ({ x: bs[k * 2], z: bs[k * 2 + 1], name: hdr.busStopNames[k] ?? '' })),
    signals: S.signals as Float32Array,
    objs: hdr.objs,
    bytes: bin.byteLength,
  };
}

/** Pieces each side of the centre piece in a window (1 → 3 × 3 pieces). */
export const WINDOW_RADIUS = 1;

/** The pieces of the window centred on piece (ci, cj) that exist in the region. */
export function windowPieces(M: RegionManifest, ci: number, cj: number): [number, number][] {
  const out: [number, number][] = [];
  for (let j = cj - WINDOW_RADIUS; j <= cj + WINDOW_RADIUS; j++) for (let i = ci - WINDOW_RADIUS; i <= ci + WINDOW_RADIUS; i++) {
    if (i >= M.grid.i0 && i <= M.grid.i1 && j >= M.grid.j0 && j <= M.grid.j1) out.push([i, j]);
  }
  return out;
}

/** Keep a window's centre far enough inside the region that the window never hangs off it. */
export function clampCentre(M: RegionManifest, ci: number, cj: number): [number, number] {
  const r = WINDOW_RADIUS;
  return [Math.max(M.grid.i0 + r, Math.min(M.grid.i1 - r, ci)), Math.max(M.grid.j0 + r, Math.min(M.grid.j1 - r, cj))];
}

/** The window as tile data: terrain / water grids stitched from its pieces, and their features. */
export function windowTile(M: RegionManifest, ci: number, cj: number, pieces: Map<string, Piece>): TileData {
  const P = M.piece, cell = M.cell, per = P / cell, side = 2 * WINDOW_RADIUS + 1;
  const n = side * per + 1;
  const ox = (ci + 0.5) * P, oz = (cj + 0.5) * P, half = (side * P) / 2;
  const heights = new Float32Array(n * n).fill(NaN), waterLevel = new Float32Array(n * n).fill(M.base), waterMask = new Uint8Array(n * n);
  const buildings: Building[] = [], areas: Area[] = [], waters: Poly[] = [], waterways: (Line & { width: number })[] = [];
  const trees: number[] = [], busStops: TileData['busStops'] = [], signals: number[] = [];
  for (let dj = -WINDOW_RADIUS; dj <= WINDOW_RADIUS; dj++) for (let di = -WINDOW_RADIUS; di <= WINDOW_RADIUS; di++) {
    const p = pieces.get(`${ci + di}_${cj + dj}`);
    if (!p) continue;
    const gi0 = (di + WINDOW_RADIUS) * per, gj0 = (dj + WINDOW_RADIUS) * per;
    for (let j = 0; j < p.n; j++) for (let i = 0; i < p.n; i++) {
      const k = (gj0 + j) * n + gi0 + i, s = j * p.n + i;
      heights[k] = p.heights[s]; waterLevel[k] = p.waterLevel[s]; waterMask[k] = p.waterMask[s];
    }
    buildings.push(...p.buildings); areas.push(...p.areas); waters.push(...p.waters); waterways.push(...p.waterways);
    for (const v of p.trees) trees.push(v);
    busStops.push(...p.busStops);
    for (const v of p.signals) signals.push(v);
  }
  // cells no piece covers (outside the region): the nearest known height
  for (let k = 0; k < n * n; k++) if (Number.isNaN(heights[k])) heights[k] = k > 0 && !Number.isNaN(heights[k - 1]) ? heights[k - 1] : M.base + 2;
  areas.sort((a, b) => polyArea(b.outer) - polyArea(a.outer));
  return {
    id: M.id, name: M.name, city: M.city, half, ox, oz,
    center: [M.frame.lat0, M.frame.lon0], proj: { kx: M.frame.kx, kz: M.frame.kz },
    bbox: [0, 0, 0, 0], attribution: M.attribution,
    terrain: { n, cell, heights, waterLevel, waterMask },
    buildings, areas, waters, waterways, rails: [],
    trees: new Float32Array(trees), busStops, signals: new Float32Array(signals), wayFlags: {}, roadsOsm: '',
  };
}

function polyArea(r: Float32Array) {
  let a = 0;
  for (let i = 0, m = r.length / 2; i < m; i++) { const j = (i + 1) % m; a += r[i * 2] * r[j * 2 + 1] - r[j * 2] * r[i * 2 + 1]; }
  return Math.abs(a / 2);
}
