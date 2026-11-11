// What tools/places/bake-places.ts measures for a place (generated/places.json). Types only: the numbers on the
// place pages all come from that file.
import type { City } from './data';

/** A featured road, inside the place's circle. Widths in metres. */
export interface RoadFact {
  /** the OpenStreetMap name, and the name people use when it differs (FC Road) */
  name: string;
  label?: string;
  /** class, as the editor labels it (Arterial, Sub-arterial, Collector…) */
  cls: string;
  /** length inside the circle (m) */
  len: number;
  /** width in the map, kerb to kerb with footpaths: typical (length-weighted median), narrowest, widest */
  w: number; wMin: number; wMax: number;
  /** carriageway (without footpaths) and traffic lanes, typical */
  cw: number; lanes: number;
  divided: boolean;
  /** mapped one-way: as a pair of carriageways (the widths are each one's), or a one-way street */
  oneway?: 'pair' | 'single';
  /** Development Plan width (traced from the sheets) and the share of the length it covers */
  dp?: number; dpShare?: number;
  /** building footprint to building footprint across the road (median), and the share of the length built on both sides */
  gap?: number; gapShare?: number;
  /** buildings with a corner inside the DP width, measured from today's centre line */
  inDp?: number;
  /** length on a flyover / bridge (m), and running under a metro viaduct (m) */
  elevated?: number;
  metro?: number;
  /** length under three quarters of its typical width (m) */
  narrow: number;
}

/** A what-if, as numbers; the page words it. */
export type Idea =
  | { k: 'widen'; road: string; dp: number; w: number; gap?: number; n?: number }
  | { k: 'cluster'; n: number; span: number; roads: string[]; at: [number, number] }
  | { k: 'pinch'; road: string; w: number; wMin: number; len: number }
  | { k: 'signals'; n: number; of: number }
  | { k: 'try'; road: string; w: number; to: number };

export interface PlaceData {
  city: City;
  slug: string;
  name: string;
  aka?: string[];
  lat: number; lon: number;
  /** radius of the report (m) and the editor zoom that frames it */
  r: number; zoom: number;
  /** when the city's base map was baked (YYYY-MM-DD) */
  baked: string;
  area: {
    roadKm: number; mainKm: number; offKm: number; underKm: number;
    /** named roads */
    named: number;
    /** junctions of three or more roads (and those on a main road), with signals (as mapped), roundabouts */
    junctions: number; mainJunctions: number; signals: number; roundabouts: number;
    /** OpenStreetMap building footprints (centre inside the circle) and the share of the circle they cover (%) */
    buildings: number; coverage: number;
    /** ground height (m above sea level), lowest and highest */
    elevMin: number; elevMax: number;
  };
  /** traced: DP road widths in the map · sheets: the DP sheets are a reference layer, widths not traced · none */
  dp: 'traced' | 'sheets' | 'none';
  dpKm?: number;
  dpBuildings?: number;
  roads: RoadFact[];
  ideas: Idea[];
  nearby: { slug: string; km: number }[];
  /** the SVG map and the share picture, paths under public/ */
  map: string;
  image: string;
}
