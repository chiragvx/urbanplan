// What the Development Plan's zone allows on the plot (docs/plans/pro-design-freedom.md §7.3, step 7): each use counts
// as a plot use (./uses.ts `plot`), and the zone says which plot uses it allows outright, which with conditions (a
// size, a road width, a list of trades), and which not at all. A use the zone doesn't allow is a fail on the scrutiny,
// never a block: "flag, never block", as the form's rules have it.
//
// The table is UDCPR 2020 Chapter 4 (land use zones and the uses permissible in them) as summarised, not read clause
// by clause: "as assumed" until it is. DCPR 2034 (Mumbai) names its zones differently but they map onto these.
import type { PlotUse } from './plot';

export type DpZone = 'R1' | 'R2' | 'C' | 'I' | 'PSP' | 'G';
export type Allowed = 'yes' | 'some' | 'no';

export const DP_ZONES: { value: DpZone; label: string; note: string }[] = [
  { value: 'R1', label: 'Residential (R1)', note: 'Homes, with day-to-day shops, clinics, schools and offices of professionals on some roads.' },
  { value: 'R2', label: 'Residential (R2)', note: 'Homes with commerce: shops, offices and hotels allowed on the wider roads.' },
  { value: 'C', label: 'Commercial (C)', note: 'Shops, offices and hotels, with homes over them.' },
  { value: 'I', label: 'Industrial (I)', note: 'Industry, its offices and stores; no homes.' },
  { value: 'PSP', label: 'Public and semi-public (PSP)', note: 'Schools, hospitals, government offices, places of worship.' },
  { value: 'G', label: 'Green or agricultural', note: 'Farming and open uses; a farmhouse, a school or a hospital only with conditions.' },
];

/** by zone, the plot uses it allows ('some': with conditions); a plot use not listed is not allowed */
const ALLOWS: Record<DpZone, Partial<Record<PlotUse, Allowed>>> = {
  R1: { residential: 'yes', shops: 'some', commercial: 'some', school: 'yes', hospital: 'some', government: 'yes', worship: 'some', garden: 'yes', carpark: 'yes', custom: 'some' },
  R2: { residential: 'yes', shops: 'yes', commercial: 'yes', school: 'yes', hospital: 'yes', government: 'yes', worship: 'yes', garden: 'yes', carpark: 'yes', industrial: 'some', custom: 'some' },
  C: { commercial: 'yes', shops: 'yes', residential: 'yes', government: 'yes', carpark: 'yes', garden: 'yes', school: 'some', hospital: 'some', worship: 'some', industrial: 'some', custom: 'some' },
  I: { industrial: 'yes', carpark: 'yes', garden: 'yes', commercial: 'some', shops: 'some', government: 'some', hospital: 'some', custom: 'some' },
  PSP: { school: 'yes', hospital: 'yes', government: 'yes', worship: 'yes', garden: 'yes', carpark: 'yes', residential: 'some', shops: 'some', custom: 'some' },
  G: { garden: 'yes', residential: 'some', school: 'some', hospital: 'some', worship: 'some', custom: 'some' },
};

/** whether a zone allows a plot use; 'none' (no use yet) is never in question */
export function zoneAllows(z: DpZone, u: PlotUse): Allowed {
  if (u === 'none') return 'yes';
  return ALLOWS[z][u] ?? 'no';
}
export const zoneLabel = (z: DpZone) => DP_ZONES.find((x) => x.value === z)?.label ?? z;
