// What tools/maps/bake-maps.ts measures for a city (generated/maps.json): the numbers on the city map pages, the
// road-width map and the open-data page. Types only.
import type { City } from '../places/data';

/** A named main road (expressway to collector), as one connected run of sections of that name. */
export interface MapRoad {
  name: string;
  /** the other names OpenStreetMap gives it (name=A | B) */
  aka?: string[];
  /** class, as the editor labels it */
  cls: string;
  /** length (km), all of it; widths are of the part on the ground */
  km: number;
  /** typical width in the model, kerb to kerb with footpaths (m), and the carriageway alone */
  w: number; cw: number;
  lanes: number;
  /** mapped as one-way (most often one carriageway of a divided road): the width is that carriageway's */
  oneway: boolean;
  /** a point on it (lat, lon), and the nearest place page (slug) within 2.5 km */
  at: [number, number];
  near?: string;
}

export interface WidthBand { lo: number; hi: number | null; color: string; km: number }

export interface CityMapData {
  city: City;
  /** when the city's base map was baked (YYYY-MM-DD) */
  baked: string;
  km2: number;
  /** the region's name in the editor (Pune · Pimpri-Chinchwad) */
  area: string;
  /** from public/regions/index.json: road sections, roads and building footprints */
  counts: { sections: number; roads: number; buildings: number };
  roadKm: number; mainKm: number; deckKm: number; underKm: number;
  byClass: { cls: string; label: string; km: number }[];
  /** main-road length by width class */
  bands: WidthBand[];
  namedMain: number;
  widest: MapRoad[]; narrowest: MapRoad[]; pairs: MapRoad[]; longest: MapRoad[];
  center: [number, number];
  /** south, west, north, east */
  bbox: [number, number, number, number];
  /** paths under public/, and the maps' size in SVG units */
  svg: { map: string; width: string; dp?: string; w: number; h: number };
  /** share pictures (paths under public/) by page: map, road-widths, dp-map */
  og: Record<string, string>;
  /** Pune only: the DP sheets registered and the road widths traced from them */
  dp?: {
    sheets: number; sheetNames: string[]; tiles: number; km2: number;
    tracedKm: number; tracedRoads: number;
    widths: { w: number; km: number }[];
    bbox: [number, number, number, number];
  };
  download: { file: string; features: number; bytes: number; gzBytes: number };
}
