// The City Document: what the editor edits. The baked network is only the starting point ("base");
// everything the user changes is a property-level patch on top of it, so edits survive re-imports.
import type { BridgeKind, Part } from '../net/model';

export type Id = string;

/** Where a value came from (shown in the inspector and the accuracy view). */
export type Source = 'osm' | 'dp' | 'default' | 'user' | 'survey' | 'import';

/** A path anchor: position, relative Bézier handles (in / out) and height above terrain. */
export interface Anchor { x: number; z: number; ix: number; iz: number; ox: number; oz: number; lift: number }

export interface SectionObj {
  kind: 'section';
  id: Id;
  /** end junctions; the first / last anchors follow their positions */
  a: Id; b: Id;
  path: Anchor[];
  parts: Part[];
  cls: string;
  name: string;
  road: Id;
  surface: 'asphalt' | 'dirt';
  bridge: BridgeKind;
  deck: number;
  elevated: boolean;
  viaduct: boolean;
  /** Development Plan road reserve (m), when measured */
  reserve?: number;
  wayIds: number[];
  /** a person checked this section against the ground / imagery */
  verified?: boolean;
  note?: string;
  /** where the width came from */
  widthSrc?: Source;
  /** (created sections) inheritable keys set on the section itself */
  own?: string[];
}

export interface JunctionObj {
  kind: 'junction';
  id: Id;
  x: number; z: number; lift: number;
  signals: boolean;
  /** roundabout: ring centre-line radius and lanes */
  R?: number; ringLanes?: number;
  /** kerb corner radius override (m) */
  rc?: number;
  /** zebra crossings forced on / off */
  crossings?: boolean;
  name?: string;
}

export interface RoadObj {
  kind: 'road';
  id: Id;
  name: string;
  cls: string;
  /** road-level cross-section / surface (set only by edits; passed down to sections that don't override them) */
  parts?: Part[];
  surface?: 'asphalt' | 'dirt';
  /** (created roads) inheritable keys set by the user */
  own?: string[];
}

export type LineKind = 'sewer' | 'storm' | 'water' | 'power' | 'gas' | 'telecom' | 'metro' | 'rail' | 'path' | 'other';

export interface LineObj {
  kind: 'line';
  id: Id;
  layer: Id;
  /** flat x,z pairs (tile metres) */
  pts: number[];
  /** metres below ground (negative = above ground, e.g. a viaduct deck) */
  depth: number;
  /** pipe diameter / track or path width (m) */
  size: number;
  name: string;
  props: Record<string, string | number>;
}

export interface BuildingObj {
  kind: 'building';
  id: Id;
  outer: number[];
  holes: number[][];
  h: number; minH: number;
  name: string;
  /** index in the tile's building list (render / roof style) */
  src: number;
}

export type LayerGroup = 'reference' | 'surface' | 'elevated' | 'underground';

export interface LayerObj {
  kind: 'layer';
  id: Id;
  name: string;
  group: LayerGroup;
  /** what the layer holds / how it's drawn */
  type: 'roads' | 'junctions' | 'buildings' | 'lines' | 'terrain' | 'water' | 'trees' | 'dp' | 'xyz' | 'osm';
  lineKind?: LineKind;
  visible: boolean;
  locked: boolean;
  opacity: number;
  color?: string;
  url?: string;
  source?: string;
  license?: string;
  order: number;
}

export type Obj = SectionObj | JunctionObj | RoadObj | LineObj | BuildingObj | LayerObj;
export type Kind = Obj['kind'];
export type ObjOf<K extends Kind> = Extract<Obj, { kind: K }>;

/** Section properties a road-level edit passes down to its sections (unless a section overrides them). */
export const INHERITED: (keyof SectionObj)[] = ['parts', 'cls', 'name', 'surface'];

/** Locator stored with edits to base objects, used to find them again after a re-import. */
export interface Locator { kind: Kind; x: number; z: number; name?: string; wayIds?: number[]; len?: number }

/** One object's entry in the patch. */
export interface PatchEntry {
  /** property overrides */
  set?: Record<string, unknown>;
  /** a whole object created by the user */
  add?: Obj;
  /** a base object deleted by the user */
  del?: true;
  loc?: Locator;
}

export interface MapMeta {
  id: string;
  name: string;
  author: string;
  description: string;
  tile: string;
  created: string;
  updated: string;
  forkedFrom?: { name: string; author: string; url?: string; id: string } | null;
  /** fingerprint of the base network the edits were made on */
  base?: string;
}

export interface MapFile {
  format: 'pune-remix/map';
  version: 1;
  meta: MapMeta;
  objects: Record<Id, PatchEntry>;
}

export const ROAD_CLASSES = ['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service', 'busway', 'track'] as const;
export const CLASS_RANK: Record<string, number> = { motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4, busway: 4, unclassified: 5, residential: 5, living_street: 6, service: 7, road: 6, track: 8 };
export const CLASS_LABEL: Record<string, string> = {
  motorway: 'Expressway', trunk: 'Highway', primary: 'Arterial', secondary: 'Sub-arterial', tertiary: 'Collector', busway: 'BRTS',
  unclassified: 'Local', residential: 'Residential', living_street: 'Shared street', service: 'Service lane', track: 'Track', road: 'Road',
};
