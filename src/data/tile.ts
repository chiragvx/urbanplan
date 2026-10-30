// Loads a baked v2 tile (tile.json + tile.bin + roads.osm).
export interface Poly { outer: Float32Array; holes: Float32Array[] }
export interface Line { pts: Float32Array }

export interface Building extends Poly { h: number; minH: number; kind: number; roof: number; name: string; id: number }
export interface Area extends Poly { kind: number }
export interface Rail extends Line {
  bridge: boolean; tunnel: boolean; layer: number; service: boolean; metro: boolean;
  /** drawn from a catalogue asset: tracks, track centres, gauge (m), formation width, deck height above ground */
  tracks?: number; tc?: number; gauge?: number; formation?: number; deck?: number;
}

export interface TileData {
  id: string;
  name: string;
  city: string;
  half: number;
  /** centre of the area this data covers (a region window; 0, 0 for a tile) */
  ox?: number; oz?: number;
  center: [number, number];
  proj: { kx: number; kz: number };
  bbox: [number, number, number, number];
  attribution: string;
  terrain: { n: number; cell: number; heights: Float32Array; waterLevel: Float32Array; waterMask: Uint8Array };
  buildings: Building[];
  areas: Area[];
  waters: Poly[];
  waterways: (Line & { width: number })[];
  rails: Rail[];
  trees: Float32Array;
  busStops: { x: number; z: number; name: string }[];
  signals: Float32Array;
  wayFlags: Record<string, [number, number, number]>;
  roadsOsm: string;
}

type Typed = Float32Array | Uint32Array | Uint8Array;

export async function loadTile(id: string, progress: (f: number, msg: string) => void): Promise<TileData> {
  const base = `${import.meta.env.BASE_URL}tiles/${id}/`;
  progress(0.02, 'Downloading the city…');
  const [hdr, bin] = await Promise.all([
    fetch(base + 'tile.json').then((r) => r.json()),
    fetch(base + 'tile.bin').then((r) => r.arrayBuffer()),
  ]);
  return parseTile(hdr, bin);
}

/** Decode a baked tile (header JSON + binary sections). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseTile(hdr: any, bin: ArrayBuffer, roadsOsm = ''): TileData {
  const S: Record<string, Typed> = {};
  for (const s of hdr.sections) {
    const C = s.type === 'Float32Array' ? Float32Array : s.type === 'Uint32Array' ? Uint32Array : Uint8Array;
    S[s.name] = new C(bin, s.offset, s.length);
  }
  const polys = (name: string): Poly[] => {
    const P = S[name + 'Pts'] as Float32Array, poly = S[name + 'Poly'] as Uint32Array;
    const rs = S[name + 'RingStart'] as Uint32Array, rc = S[name + 'RingCount'] as Uint32Array;
    const out: Poly[] = [];
    for (let i = 0; i < poly.length; i += 2) {
      const first = poly[i], count = poly[i + 1];
      const rings: Float32Array[] = [];
      for (let r = first; r < first + count; r++) rings.push(P.slice(rs[r] * 2, (rs[r] + rc[r]) * 2));
      out.push({ outer: rings[0], holes: rings.slice(1) });
    }
    return out;
  };
  const lines = (name: string): Line[] => {
    const P = S[name + 'Pts'] as Float32Array, st = S[name + 'Start'] as Uint32Array, ct = S[name + 'Count'] as Uint32Array;
    return Array.from(st, (s, i) => ({ pts: P.slice(s * 2, (s + ct[i]) * 2) }));
  };

  const buildings = polys('bld').map((p, i) => ({
    ...p, id: i, h: (S.bldHeight as Float32Array)[i], minH: (S.bldMinHeight as Float32Array)[i],
    kind: S.bldKind[i], roof: S.bldRoof[i], name: hdr.bldNames[i] ?? '',
  }));
  const areas = polys('area').map((p, i) => ({ ...p, kind: S.areaKind[i] }));
  const ww = lines('ww').map((l, i) => ({ ...l, width: (S.wwWidth as Float32Array)[i] }));
  const rf = S.railFlags as Uint8Array;
  const rails = lines('rail').map((l, i) => ({
    ...l, bridge: rf[i * 4] === 1, tunnel: rf[i * 4 + 1] === 1, layer: rf[i * 4 + 2] - 4,
    service: (rf[i * 4 + 3] & 1) === 1, metro: (rf[i * 4 + 3] & 2) === 2,
  }));
  const bs = S.busStops as Float32Array;
  return {
    id: hdr.id, name: hdr.name, city: hdr.city, half: hdr.half, center: hdr.center, proj: hdr.proj, bbox: hdr.bbox,
    attribution: hdr.attribution,
    terrain: { n: hdr.terrain.n, cell: hdr.terrain.cell, heights: S.terrain as Float32Array, waterLevel: S.waterLevel as Float32Array, waterMask: S.waterMask as Uint8Array },
    buildings, areas, waters: polys('water'), waterways: ww, rails,
    trees: S.trees as Float32Array,
    busStops: Array.from({ length: bs.length / 2 }, (_, i) => ({ x: bs[i * 2], z: bs[i * 2 + 1], name: hdr.busStopNames[i] ?? '' })),
    signals: S.signals as Float32Array,
    wayFlags: hdr.wayFlags,
    roadsOsm,
  };
}
