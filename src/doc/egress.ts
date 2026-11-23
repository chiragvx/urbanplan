// Ways out by NBC 2016 Part 4 occupancy group (docs/plans/pro-design-freedom.md §7.2, step 7): how many people a
// 0.5 m unit of stair width takes, the longest travel to a stair, and the narrowest stair. The stairs are sized from it
// (src/pro/systems.ts), and the checks read it (src/pro/checkRows.ts).
//
// The figures are NBC 2016 Part 4 as summarised (Table 21 occupants per unit exit width, Table 22 travel distance,
// 4.4.2.4.3 minimum stair widths), not re-read clause by clause: each is "as assumed" until checked against the text.
// The groups worked through so far are A, B, D, E and F; a use in any other group is "not checked" rather than
// checked against a figure we haven't read (§7.2: a terminal checked only against housing rules would look clean).
import { USE_TABLE, type FloorUse } from './uses';

export type NbcGroup = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H' | 'J';
export const GROUP_NAME: Record<NbcGroup, string> = { A: 'Residential', B: 'Educational', C: 'Institutional', D: 'Assembly', E: 'Business', F: 'Mercantile', G: 'Industrial', H: 'Storage', J: 'Hazardous' };
/** the groups whose figures have been worked through; the others are "not checked" */
export const COVERED: NbcGroup[] = ['A', 'B', 'D', 'E', 'F'];

export interface Egress {
  /** people a 0.5 m unit of stair width takes (Table 21, stairs) */
  perUnit: number;
  /** the longest travel to a stair or an exit (m; Table 22, unsprinklered) */
  travel: number;
  /** the narrowest stair (m; 4.4.2.4.3) */
  stairMin: number;
}
/** NBC 2016 Part 4, as summarised (as assumed) */
export const EGRESS: Record<NbcGroup, Egress> = {
  A: { perUnit: 25, travel: 30, stairMin: 1.25 },
  B: { perUnit: 25, travel: 30, stairMin: 1.5 },
  C: { perUnit: 25, travel: 30, stairMin: 2.0 },
  D: { perUnit: 40, travel: 30, stairMin: 2.0 },
  E: { perUnit: 50, travel: 30, stairMin: 1.5 },
  F: { perUnit: 50, travel: 30, stairMin: 1.5 },
  G: { perUnit: 50, travel: 45, stairMin: 1.5 },
  H: { perUnit: 50, travel: 30, stairMin: 1.5 },
  J: { perUnit: 25, travel: 22.5, stairMin: 1.5 },
};
export const UNIT_W = 0.5;

/** UDCPR 2020 Table 9G: a residential stair 1.0 m up to 15 m, 1.2 m up to 24 m, 1.5 m above (it governs flats; NBC's
 *  1.25 m is for other residential, such as hostels and hotels) */
export const stairFor = (h: number) => (h <= 15 ? 1.0 : h <= 24 ? 1.2 : 1.5);

/** a use's NBC group (A from 'A-4'); null for a use with none (no use yet) and for parking floors, which have rules
 *  of their own */
export function groupOf(u: FloorUse): NbcGroup | null {
  if (u === 'parking') return null;
  const c = USE_TABLE[u].nbc;
  return c ? (c[0] as NbcGroup) : null;
}

/** the narrowest stair a use needs in a building this tall: flats by UDCPR Table 9G, hotels (A-5) and the other
 *  groups by NBC */
export function stairMinOf(u: FloorUse, h: number): number {
  const g = groupOf(u);
  if (!g) return stairFor(h);
  if (u === 'residential') return stairFor(h);
  return Math.max(stairFor(h), u === 'hotel' ? 1.5 : EGRESS[g].stairMin);
}

/** units of stair width for these people of this use (fractional: add them up over a floor's uses, then round up) */
export function exitUnits(u: FloorUse, people: number): number {
  const g = groupOf(u);
  return people / EGRESS[g ?? 'A'].perUnit;
}
