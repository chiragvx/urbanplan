// Loads a baked binary tile and builds the runtime world model.
export const ROAD_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'service', 'living_street', 'track', 'footway', 'cycleway', 'busway'] as const;
export type RoadClass = (typeof ROAD_CLASSES)[number];

export const CLASS_LABEL: Record<RoadClass, string> = {
  motorway: 'Expressway', trunk: 'Highway', primary: 'Main road', secondary: 'Arterial road', tertiary: 'Collector road',
  residential: 'Local street', service: 'Service lane', living_street: 'Living street', track: 'Kaccha track',
  footway: 'Footpath / trail', cycleway: 'Cycle track', busway: 'BRT busway',
};

/** The editable design of a road. This is what players "remix". */
export interface RoadProps {
  lanes: number;      // total carriageway lanes (both directions)
  footpath: number;   // metres each side (0 = none)
  trees: boolean;     // street trees
  busLane: boolean;   // kerb lane reserved for buses
  cycle: boolean;     // protected cycle track each side
  median: boolean;    // raised central median
  crossings: boolean; // zebra crossings at junction ends
}

export interface Road {
  id: number;
  a: number;
  b: number;
  pts: Float32Array; // x,z interleaved
  cum: Float32Array; // cumulative length per point
  len: number;
  cls: RoadClass;
  clsIndex: number;
  oneway: boolean;
  bridge: boolean;
  name: string;
  /** Local/alternate name or route ref, e.g. "Baner Road", "NH48". */
  alt: string;
  drive: boolean;
  props: RoadProps;
  original: RoadProps;
}

export interface Building {
  ring: Float32Array;
  h: number;
  kind: number;
  cx: number;
  cz: number;
}

export interface Area { ring: Float32Array; kind: number }
export interface Waterway { pts: Float32Array; w: number }

export interface Tile {
  id: string;
  name: string;
  city: string;
  half: number;
  attribution: string;
  nodes: Float32Array;
  nodeRoads: number[][];
  roads: Road[];
  buildings: Building[];
  areas: Area[];
  waterways: Waterway[];
  trees: Float32Array;
  busStops: { x: number; z: number; name: string; user: boolean }[];
}

const DRIVE: Set<RoadClass> = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'service', 'living_street', 'track', 'busway']);

export const LANE_W = 3.2;

/** Indian-reality defaults: footpaths are narrow or missing, trees and cycle tracks rare. */
export function defaultProps(cls: RoadClass, tagLanes: number, oneway: boolean): RoadProps {
  const base: Record<RoadClass, [number, number]> = {
    motorway: [6, 0], trunk: [6, 1.2], primary: [4, 1.5], secondary: [4, 1.2], tertiary: [2, 0.9],
    residential: [2, 0], service: [1, 0], living_street: [1, 0], track: [1, 0], footway: [0, 0], cycleway: [0, 0], busway: [2, 0],
  };
  let [lanes, footpath] = base[cls];
  if (tagLanes > 0) lanes = tagLanes;
  if (oneway && !tagLanes) lanes = Math.max(1, Math.ceil(lanes / 2));
  return {
    lanes,
    footpath,
    trees: false,
    busLane: false,
    cycle: false,
    median: (cls === 'trunk' || cls === 'primary' || cls === 'motorway') && lanes >= 4 && !oneway,
    crossings: false,
  };
}

export function carriageway(r: Road, p: RoadProps = r.props): number {
  if (!r.drive) return r.cls === 'cycleway' ? 2.4 : r.cls === 'footway' ? 1.8 : 3;
  const lw = r.cls === 'service' || r.cls === 'track' || r.cls === 'living_street' ? 3.6 : LANE_W;
  return p.lanes * lw + (p.median ? 1.2 : 0);
}

/**
 * Which sides get footpaths/cycle tracks/trees. One-way main roads are usually one half of a
 * divided road (mapped as two ways): India drives on the left, so the kerb is the left side (+1)
 * and the right side faces the median.
 */
export function roadSides(r: Road): number[] {
  return r.oneway && r.clsIndex <= 3 ? [1] : [1, -1];
}

/** Total corridor half-width including cycle tracks + footpaths. */
export function corridorHalf(r: Road, p: RoadProps = r.props): number {
  return carriageway(r, p) / 2 + (p.cycle ? 1.8 : 0) + p.footpath;
}

type Typed = Float32Array | Uint32Array | Uint8Array;

export async function loadTile(id: string, onProgress: (f: number, msg: string) => void): Promise<Tile> {
  onProgress(0.05, 'Fetching map of Pune…');
  const [hdr, bin] = await Promise.all([
    fetch(`${import.meta.env.BASE_URL}tiles/${id}.json`).then((r) => r.json()),
    fetch(`${import.meta.env.BASE_URL}tiles/${id}.bin`).then((r) => r.arrayBuffer()),
  ]);
  onProgress(0.2, 'Unpacking roads and buildings…');
  const S: Record<string, Typed> = {};
  for (const s of hdr.sections) {
    const C = s.type === 'Float32Array' ? Float32Array : s.type === 'Uint32Array' ? Uint32Array : Uint8Array;
    S[s.name] = new C(bin, s.offset, s.length);
  }

  const nodes = S.nodes as Float32Array;
  const nodeCount = nodes.length / 2;
  const nodeRoads: number[][] = Array.from({ length: nodeCount }, () => []);
  const edgePts = S.edgePts as Float32Array;
  const roads: Road[] = [];
  const nE = S.edgeA.length;
  for (let i = 0; i < nE; i++) {
    const p0 = S.edgeP0[i], pn = S.edgePN[i];
    const pts = edgePts.slice(p0 * 2, (p0 + pn) * 2);
    const cum = new Float32Array(pn);
    for (let k = 1; k < pn; k++) cum[k] = cum[k - 1] + Math.hypot(pts[k * 2] - pts[k * 2 - 2], pts[k * 2 + 1] - pts[k * 2 - 1]);
    const clsIndex = S.edgeCls[i];
    const cls = ROAD_CLASSES[clsIndex];
    const flags = S.edgeFlags[i];
    const oneway = (flags & 1) === 1;
    const props = defaultProps(cls, S.edgeLanes[i], oneway);
    const r: Road = {
      id: i, a: S.edgeA[i], b: S.edgeB[i], pts, cum, len: cum[pn - 1], cls, clsIndex, oneway,
      bridge: (flags & 2) === 2, name: hdr.names[S.edgeName[i]] ?? '', alt: S.edgeAlt ? hdr.names[S.edgeAlt[i]] ?? '' : '', drive: DRIVE.has(cls),
      props, original: { ...props },
    };
    roads.push(r);
    nodeRoads[r.a].push(i);
    if (r.b !== r.a) nodeRoads[r.b].push(i);
  }

  onProgress(0.3, 'Raising buildings…');
  const buildings: Building[] = [];
  const bp = S.bldPts as Float32Array;
  for (let i = 0; i < S.bldStart.length; i++) {
    const s = S.bldStart[i], c = S.bldCount[i];
    const ring = bp.slice(s * 2, (s + c) * 2);
    let cx = 0, cz = 0;
    for (let k = 0; k < c; k++) { cx += ring[k * 2]; cz += ring[k * 2 + 1]; }
    buildings.push({ ring, h: (S.bldHeight as Float32Array)[i], kind: S.bldKind[i], cx: cx / c, cz: cz / c });
  }

  const areas: Area[] = [];
  const ap = S.areaPts as Float32Array;
  for (let i = 0; i < S.areaStart.length; i++) {
    const s = S.areaStart[i], c = S.areaCount[i];
    areas.push({ ring: ap.slice(s * 2, (s + c) * 2), kind: S.areaKind[i] });
  }

  const waterways: Waterway[] = [];
  const wp = S.wwPts as Float32Array;
  for (let i = 0; i < S.wwStart.length; i++) {
    const s = S.wwStart[i], c = S.wwCount[i];
    waterways.push({ pts: wp.slice(s * 2, (s + c) * 2), w: (S.wwWidth as Float32Array)[i] });
  }

  const bs = S.busStops as Float32Array;
  const busStops = [];
  for (let i = 0; i < bs.length / 2; i++) busStops.push({ x: bs[i * 2], z: bs[i * 2 + 1], name: hdr.busStopNames[i] ?? '', user: false });

  return {
    id: hdr.id, name: hdr.name, city: hdr.city, half: hdr.half, attribution: hdr.attribution,
    nodes, nodeRoads, roads, buildings, areas, waterways, trees: S.trees as Float32Array, busStops,
  };
}

/** Point + tangent at distance s along a road polyline. Uses/updates a segment hint for O(1) amortised lookup. */
export function sampleRoad(r: Road, s: number, hint: { seg: number }): { x: number; z: number; dx: number; dz: number } {
  const cum = r.cum, pts = r.pts, n = cum.length;
  if (s <= 0) s = 0;
  if (s >= r.len) s = r.len;
  let i = Math.min(Math.max(hint.seg, 0), n - 2);
  while (i < n - 2 && cum[i + 1] < s) i++;
  while (i > 0 && cum[i] > s) i--;
  hint.seg = i;
  const segLen = cum[i + 1] - cum[i] || 1;
  const t = (s - cum[i]) / segLen;
  const x0 = pts[i * 2], z0 = pts[i * 2 + 1], x1 = pts[i * 2 + 2], z1 = pts[i * 2 + 3];
  return { x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, dx: (x1 - x0) / segLen, dz: (z1 - z0) / segLen };
}
