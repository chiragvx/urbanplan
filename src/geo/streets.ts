// Street network types shared by the worker and the main thread. All coordinates are local metres.
export type LaneType =
  | 'Driving' | 'Parking' | 'Sidewalk' | 'Shoulder' | 'Biking' | 'Bus' | 'SharedLeftTurn' | 'Construction'
  | 'LightRail' | 'Footway' | 'SharedUse' | string;

export interface StreetRoad {
  id: number;
  src: number;
  dst: number;
  wayIds: number[];
  layer: number;
  highway: string;
  name: string;
  /** Trimmed centre line (between junction polygons), x,z interleaved. */
  center: Float32Array;
  /** Road outline polygon. */
  outline: Float32Array;
  lanes: { type: LaneType; dir: string; width: number }[];
}

export interface StreetIntersection {
  id: number;
  kind: string;
  control: string;
  roads: number[];
  poly: Float32Array;
  cx: number;
  cz: number;
}

export interface StreetLane {
  road: number;
  index: number;
  type: LaneType;
  dir: string;
  width: number;
  poly: Float32Array;
}

export interface StreetMarking {
  type: string;
  layer: number;
  poly: Float32Array;
  /** Owning road, when we generated the marking ourselves (gives exact height without lookups). */
  road?: number;
}

export interface StreetNet {
  roads: Map<number, StreetRoad>;
  intersections: Map<number, StreetIntersection>;
  lanes: StreetLane[];
  markings: StreetMarking[];
  /** "sidewalk corner" polygons that fill kerbs around junctions. */
  corners: Float32Array[];
  buildMs: number;
}

export interface StreetsRequest {
  osm: string;
  bbox: [number, number, number, number]; // w s e n
  center: [number, number]; // lat lon
  proj: { kx: number; kz: number };
  overrides?: Record<string, Record<string, string>>; // way id → full tag set
}

/** Load the street network baked by tools/bake-streets.mjs (fast path for startup). */
export async function loadStreets(base: string): Promise<StreetNet> {
  const { unpackStreets } = await import('./streetsCore');
  const [json, bin] = await Promise.all([fetch(base + 'streets.json').then((r) => r.text()), fetch(base + 'streets.bin').then((r) => r.arrayBuffer())]);
  const t0 = performance.now();
  const raw = unpackStreets(json, bin);
  return {
    roads: new Map(raw.roads.map((r) => [r.id, r])),
    intersections: new Map(raw.intersections.map((i) => [i.id, i])),
    lanes: raw.lanes, markings: raw.markings, corners: raw.corners, buildMs: performance.now() - t0,
  };
}

/** Run osm2streets in a worker. Resolves with typed, local-metre geometry. */
export function buildStreets(req: StreetsRequest): Promise<StreetNet> {
  return new Promise((resolve, reject) => {
    const w = new Worker(new URL('./streets.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e) => {
      w.terminate();
      if (e.data.error) { reject(new Error(e.data.error)); return; }
      const d = e.data;
      resolve({
        roads: new Map(d.roads.map((r: StreetRoad) => [r.id, r])),
        intersections: new Map(d.intersections.map((i: StreetIntersection) => [i.id, i])),
        lanes: d.lanes,
        markings: d.markings,
        corners: d.corners,
        buildMs: d.buildMs,
      });
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(e.message)); };
    w.postMessage(req);
  });
}
