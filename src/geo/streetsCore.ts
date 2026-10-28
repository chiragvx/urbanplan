// osm2streets output → local-metre geometry. Shared by the browser worker and the Node baker,
// so it must stay dependency-free (Node runs it with type stripping).
import type { StreetRoad, StreetIntersection, StreetLane, StreetMarking } from './streets.ts';

export interface O2SNetwork {
  toJson(): string;
  toGeojsonPlain(): string;
  toLanePolygonsGeojson(): string;
  toLaneMarkingsGeojson(): string;
  toIntersectionMarkingsGeojson(): string;
}

export interface RawStreets {
  roads: StreetRoad[];
  intersections: StreetIntersection[];
  lanes: StreetLane[];
  markings: StreetMarking[];
  corners: Float32Array[];
}

const R = 6371000;
function haversine(a: [number, number], b: [number, number]): number {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad, dLon = (b[0] - a[0]) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** osm2streets encodes some lane types as objects, e.g. {"Buffer":"Curb"} → "Buffer(Curb)". */
export function laneTypeName(lt: unknown): string {
  if (typeof lt === 'string') return lt;
  if (lt && typeof lt === 'object') { const [k, v] = Object.entries(lt as Record<string, unknown>)[0] ?? ['Unknown', '']; return `${k}(${v})`; }
  return String(lt);
}

export function clipPolygonGeojson(bbox: [number, number, number, number]): string {
  const [w, s, e, n] = bbox;
  return JSON.stringify({
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } }],
  });
}

export const O2S_OPTIONS = { debug_each_step: false, dual_carriageway_experiment: false, sidepath_zipping_experiment: false, inferred_sidewalks: false, osm2lanes: false };

export function extractNetwork(net: O2SNetwork, center: [number, number], proj: { kx: number; kz: number }): RawStreets {
  const { kx, kz } = proj;
  const [lat0, lon0] = center;
  const toLocal = (lon: number, lat: number): [number, number] => [(lon - lon0) * kx, -(lat - lat0) * kz];
  const ring = (coords: number[][]): Float32Array => {
    const closed = coords.length > 1 && coords[0][0] === coords[coords.length - 1][0] && coords[0][1] === coords[coords.length - 1][1];
    const n = coords.length - (closed ? 1 : 0);
    const out = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { const p = toLocal(coords[i][0], coords[i][1]); out[i * 2] = p[0]; out[i * 2 + 1] = p[1]; }
    return out;
  };
  const firstRing = (g: any): number[][] | null => (g?.type === 'Polygon' ? g.coordinates[0] : g?.type === 'MultiPolygon' ? g.coordinates[0][0] : null);

  // Full network JSON: metadata + centre lines in osm2streets' internal units (1e-4 m from the bounds' NW corner)
  const full = JSON.parse(net.toJson());
  const gb = full.gps_bounds;
  const width = haversine([gb.min_lon, gb.max_lat], [gb.max_lon, gb.max_lat]);
  const height = haversine([gb.min_lon, gb.min_lat], [gb.min_lon, gb.max_lat]);
  const internalToLocal = (x: number, y: number): [number, number] => {
    const mx = x / 10000, my = y / 10000;
    return toLocal(gb.min_lon + (mx / width) * (gb.max_lon - gb.min_lon), gb.min_lat + ((height - my) / height) * (gb.max_lat - gb.min_lat));
  };
  const interMeta = new Map<number, any>((full.intersections as [number, any][]).map(([id, v]) => [id, v]));

  const roadOutline = new Map<number, Float32Array>();
  const intersections: StreetIntersection[] = [];
  for (const f of JSON.parse(net.toGeojsonPlain()).features) {
    const p = f.properties, r = firstRing(f.geometry);
    if (!r) continue;
    if (p.type === 'road') roadOutline.set(p.id, ring(r));
    else if (p.type === 'intersection') {
      const poly = ring(r);
      let cx = 0, cz = 0;
      for (let i = 0; i < poly.length; i += 2) { cx += poly[i]; cz += poly[i + 1]; }
      const meta = interMeta.get(p.id);
      intersections.push({
        id: p.id, kind: p.intersection_kind ?? meta?.kind ?? 'Intersection', control: p.control ?? 'Signed',
        roads: meta ? meta.roads : [], poly, cx: cx / (poly.length / 2), cz: cz / (poly.length / 2),
      });
    }
  }

  const roads: StreetRoad[] = [];
  for (const [id, r] of full.roads as [number, any][]) {
    const pts = r.center_line?.pts ?? [];
    const center = new Float32Array(pts.length * 2);
    pts.forEach((pt: { x: number; y: number }, i: number) => { const q = internalToLocal(pt.x, pt.y); center[i * 2] = q[0]; center[i * 2 + 1] = q[1]; });
    roads.push({
      id, src: r.src_i, dst: r.dst_i, wayIds: r.osm_ids, layer: r.layer ?? 0, highway: r.highway_type ?? '', name: r.name ?? '',
      center, outline: roadOutline.get(id) ?? new Float32Array(0),
      lanes: (r.lane_specs_ltr ?? []).map((l: any) => ({ type: laneTypeName(l.lt), dir: String(l.dir), width: l.width / 10000 })),
    });
  }

  const lanes: StreetLane[] = [];
  for (const f of JSON.parse(net.toLanePolygonsGeojson()).features) {
    const r = firstRing(f.geometry);
    if (!r) continue;
    const p = f.properties;
    lanes.push({ road: p.road, index: p.index, type: laneTypeName(p.type), dir: String(p.direction), width: p.width, poly: ring(r) });
  }
  const markings: StreetMarking[] = [];
  for (const f of JSON.parse(net.toLaneMarkingsGeojson()).features) {
    const r = firstRing(f.geometry);
    if (r) markings.push({ type: f.properties.type, layer: f.properties.layer ?? 0, poly: ring(r) });
  }
  const corners: Float32Array[] = [];
  for (const f of JSON.parse(net.toIntersectionMarkingsGeojson()).features) {
    const r = firstRing(f.geometry);
    if (!r) continue;
    if (f.properties.type === 'sidewalk corner') corners.push(ring(r));
    else markings.push({ type: f.properties.type, layer: 0, poly: ring(r) });
  }
  return { roads, intersections, lanes, markings, corners };
}

// ---------------- Binary packing (bake → browser) ----------------

export interface PackedStreets { json: string; bin: Uint8Array }

/** Pack into one JSON (metadata) + one binary (all coordinates + marking tables). */
export function packStreets(s: RawStreets): PackedStreets {
  const pts: number[] = [];
  const put = (a: Float32Array): [number, number] => { const o = pts.length / 2; for (const v of a) pts.push(v); return [o, a.length / 2]; };
  const strings: string[] = [];
  const sid = new Map<string, number>();
  const str = (v: string) => { let i = sid.get(v); if (i === undefined) { i = strings.length; strings.push(v); sid.set(v, i); } return i; };

  const roads = s.roads.map((r) => [r.id, r.src, r.dst, r.wayIds, r.layer, str(r.highway), str(r.name), put(r.center), put(r.outline),
    r.lanes.map((l) => [str(l.type), str(l.dir), Math.round(l.width * 100) / 100])]);
  const intersections = s.intersections.map((i) => [i.id, str(i.kind), str(i.control), i.roads, put(i.poly), Math.round(i.cx * 100) / 100, Math.round(i.cz * 100) / 100]);
  const lanes = s.lanes.map((l) => [l.road, l.index, str(l.type), str(l.dir), l.width, put(l.poly)]);
  const corners = s.corners.map((c) => put(c));

  const mN = s.markings.length;
  const mType = new Uint16Array(mN), mLayer = new Int8Array(mN), mStart = new Uint32Array(mN), mCount = new Uint16Array(mN);
  s.markings.forEach((m, i) => { const [o, c] = put(m.poly); mType[i] = str(m.type); mLayer[i] = m.layer; mStart[i] = o; mCount[i] = c; });

  const P = new Float32Array(pts);
  const parts: [string, ArrayBufferView][] = [['pts', P], ['mStart', mStart], ['mCount', mCount], ['mType', mType], ['mLayer', mLayer]];
  let len = 0;
  const sections: Record<string, [number, number]> = {};
  for (const [name, a] of parts) { len += (4 - (len % 4)) % 4; sections[name] = [len, a.byteLength]; len += a.byteLength; }
  const bin = new Uint8Array(len);
  for (const [name, a] of parts) bin.set(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), sections[name][0]);
  return { json: JSON.stringify({ strings, roads, intersections, lanes, corners, markings: mN, sections }), bin };
}

export function unpackStreets(jsonText: string, buf: ArrayBuffer): RawStreets {
  const j = JSON.parse(jsonText);
  const sec = (name: string) => j.sections[name] as [number, number];
  const P = new Float32Array(buf, sec('pts')[0], sec('pts')[1] / 4);
  const S: string[] = j.strings;
  const view = ([o, c]: [number, number]) => P.subarray(o * 2, (o + c) * 2);
  const roads: StreetRoad[] = j.roads.map((r: any) => ({
    id: r[0], src: r[1], dst: r[2], wayIds: r[3], layer: r[4], highway: S[r[5]], name: S[r[6]], center: view(r[7]), outline: view(r[8]),
    lanes: r[9].map((l: any) => ({ type: S[l[0]], dir: S[l[1]], width: l[2] })),
  }));
  const intersections: StreetIntersection[] = j.intersections.map((i: any) => ({
    id: i[0], kind: S[i[1]], control: S[i[2]], roads: i[3], poly: view(i[4]), cx: i[5], cz: i[6],
  }));
  const lanes: StreetLane[] = j.lanes.map((l: any) => ({ road: l[0], index: l[1], type: S[l[2]], dir: S[l[3]], width: l[4], poly: view(l[5]) }));
  const corners: Float32Array[] = j.corners.map((c: any) => view(c));
  const n = j.markings;
  const mStart = new Uint32Array(buf, sec('mStart')[0], n), mCount = new Uint16Array(buf, sec('mCount')[0], n);
  const mType = new Uint16Array(buf, sec('mType')[0], n), mLayer = new Int8Array(buf, sec('mLayer')[0], n);
  const markings: StreetMarking[] = new Array(n);
  for (let i = 0; i < n; i++) markings[i] = { type: S[mType[i]], layer: mLayer[i], poly: P.subarray(mStart[i] * 2, (mStart[i] + mCount[i]) * 2) };
  return { roads, intersections, lanes, markings, corners };
}
