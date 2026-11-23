// The uses a building's floors can be put to, in one table (docs/plans/pro-design-freedom.md §4.2, step 1). Everything
// that differs by use reads its row here, so a new use is a new row, not edits across the engine, the form and the UI:
// - the engine (./site.ts): the plot use a floor counts as, its parking, how it earns, its cost over the base rate;
// - the form (src/pro/form): its floor height, the people the lifts are counted from, whether a floor is one room;
// - the UI: its name, icon and colour.
// Each row also says which NBC 2016 occupancy class it falls in and its occupant load (m² a person), which the building
// systems size from (src/pro/systems.ts) and exits and the checks by group will (the plan's steps 6 and 7).
//
// Pure data, no imports beyond types, so the engine, the form and the UI can all read it.
import type { PlotUse } from './plot';

/** The uses a floor of a formed building can have. */
export type FloorUse = 'residential' | 'office' | 'retail' | 'hotel' | 'library' | 'toilet' | 'community' | 'school' | 'clinic' | 'parking' | 'none';


export interface UseRow {
  id: FloorUse;
  /** its name on the use strip and the inspector, and on the area statement and money's lines */
  label: string; line: string;
  icon: string;
  /** its colour on the use strip */
  color: string;
  /** floor to floor (m), unless the floors say otherwise; `dsFloor`: the design system's instead (homes, and floors
   *  with no use yet, which shouldn't change height when they get one) */
  floorH: number; dsFloor?: boolean;
  /** as the form's editor tells it: sold, let, or a public building's cost only */
  sold: 'sale' | 'lease' | 'public';
  /** the plot use it counts as */
  plot: PlotUse;
  /** a car for this many m² of carpet (0: none of its own; homes go by UDCPR Table 8-B per flat instead) */
  park: number;
  /** how it earns: sold, let and valued at a yield, run as a business and valued the same way, or a public building
   *  that only costs */
  earns: 'sale' | 'lease' | 'operate' | 'public';
  /** construction cost as a multiple of the base rate */
  build: number;
  /** floor area a person takes (m²): what the lifts are counted from */
  density: number;
  /** a public room: its floor is one unit, and a building with one gets a lift */
  room: boolean;
  /** NBC 2016 Part 4's occupancy class (A residential, B educational, C institutional, D assembly, E business,
   *  F mercantile, G industrial, H storage, J hazardous, with its subdivision: 'A-4' apartments), and its occupant
   *  load (m² a person, Table 3), as the building systems size them (src/pro/systems.ts says how each was taken).
   *  null and 0: no use yet. */
  nbc: string | null; load: number;
}

// (the parking, earnings and costs are placeholders where the code has no figure of its own, as each says)
export const USE_TABLE: Record<FloorUse, UseRow> = {
  residential: { id: 'residential', label: 'Homes', line: 'Homes', icon: 'home', color: '#9db9e3', floorH: 3.0, dsFloor: true, sold: 'sale', plot: 'residential', park: 0, earns: 'sale', build: 1, density: 15, room: false, nbc: 'A-4', load: 12.5 },
  // offices and shops: a car per 100 m² of carpet, as the plot uses have it (UDCPR's own ratios look higher: note N5)
  office: { id: 'office', label: 'Offices', line: 'Offices', icon: 'briefcase', color: '#a7c7b5', floorH: 3.6, sold: 'lease', plot: 'commercial', park: 100, earns: 'lease', build: 1.1, density: 10, room: false, nbc: 'E-1', load: 10 },
  retail: { id: 'retail', label: 'Shops', line: 'Shops', icon: 'shop', color: '#f0b67f', floorH: 4.5, sold: 'sale', plot: 'shops', park: 100, earns: 'sale', build: 1, density: 6, room: false, nbc: 'F', load: 6 },
  // a hotel: a car per four rooms of about 30 m² carpet each (placeholder: UDCPR Table 8-B goes by rooms and city
  // class); dearer to build for its services and fit-out (placeholder)
  hotel: { id: 'hotel', label: 'Hotel', line: 'Hotel', icon: 'bed', color: '#c9a8e0', floorH: 3.3, sold: 'lease', plot: 'commercial', park: 120, earns: 'operate', build: 1.6, density: 18, room: false, nbc: 'A-5', load: 12.5 },
  // assembly by the seats it holds: a community hall a seat per 1.5 m² of carpet, a library a reader per 4 m², a car
  // per 40 and 25 seats (placeholders)
  library: { id: 'library', label: 'Library', line: 'Library', icon: 'book', color: '#e6d28a', floorH: 4.5, sold: 'public', plot: 'government', park: 100, earns: 'public', build: 1.1, density: 8, room: true, nbc: 'D', load: 4 },
  // a public toilet needs no parking of its own; its tiling and fittings cost more a m² (placeholder)
  toilet: { id: 'toilet', label: 'Public toilet', line: 'Public toilet', icon: 'drop', color: '#b9c2cc', floorH: 3.2, sold: 'public', plot: 'government', park: 0, earns: 'public', build: 1.3, density: 4, room: true, nbc: 'E', load: 10 },
  community: { id: 'community', label: 'Community hall', line: 'Community hall', icon: 'people', color: '#e3a3a3', floorH: 4.5, sold: 'public', plot: 'government', park: 60, earns: 'public', build: 1.1, density: 4, room: true, nbc: 'D', load: 1.5 },
  school: { id: 'school', label: 'School', line: 'School', icon: 'school', color: '#f2d38c', floorH: 3.6, sold: 'public', plot: 'school', park: 200, earns: 'public', build: 1, density: 6, room: true, nbc: 'B-1', load: 4 },
  clinic: { id: 'clinic', label: 'Clinic', line: 'Clinic', icon: 'plus', color: '#9fd6d0', floorH: 3.6, sold: 'public', plot: 'hospital', park: 100, earns: 'public', build: 1.2, density: 8, room: true, nbc: 'C-1', load: 10 },
  // a parking floor holds cars rather than needing them; free of FSI, priced at the parking rate
  // no use yet (docs/plans/pro-design-freedom.md §2): counted for its built-up area, height, margins and cost to build,
  // and for nothing that needs a use: no units, no parking of its own, nothing sold, no occupancy group
  none: { id: 'none', label: 'No use yet', line: 'No use yet', icon: 'circle', color: '#d9d6cf', floorH: 3.0, dsFloor: true, sold: 'public', plot: 'none', park: 0, earns: 'public', build: 1, density: 15, room: false, nbc: null, load: 0 },
  parking: { id: 'parking', label: 'Parking', line: 'Parking floors', icon: 'car', color: '#b5b5b5', floorH: 3.0, sold: 'public', plot: 'carpark', park: 0, earns: 'public', build: 0, density: 30, room: false, nbc: 'G-parking', load: 30 },
};

/** The uses in the order the editor offers them. */
export const FLOOR_USES = Object.keys(USE_TABLE) as FloorUse[];

/** The use a plot use stands for, when a floor has none of its own. */
export const KIND_OF_PLOT: Partial<Record<PlotUse, FloorUse>> = { residential: 'residential', commercial: 'office', shops: 'retail', school: 'school', hospital: 'clinic', government: 'library', carpark: 'parking', none: 'none' };
/** The floor use a building of this plot use gets when it's given a form (a plot use with no floor use of its own,
 *  such as a place of worship or your own, gets open floors like offices', as the engine counts them). */
export const floorUseOf = (u: PlotUse | undefined): FloorUse => KIND_OF_PLOT[u ?? 'residential'] ?? 'office';

/** A plain building's parking by its plot use: a car per this many m² of carpet (two two-wheelers with each); homes
 *  and sheds have their own tables. */
export const PLOT_PARK_PER: Partial<Record<PlotUse, number>> = { commercial: 100, shops: 100, government: 100, hospital: 100, worship: 100, custom: 100, school: 200 };

/** A column of the table, by use (for code that wants a plain lookup). */
export function byUse<K extends keyof UseRow>(k: K): Record<FloorUse, UseRow[K]> {
  return Object.fromEntries(FLOOR_USES.map((u) => [u, USE_TABLE[u][k]])) as Record<FloorUse, UseRow[K]>;
}
