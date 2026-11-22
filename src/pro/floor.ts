// The architect's floor: a building's typical floor read as one thing (flats a floor by type and size, its cores, its
// efficiency), the flats of the whole scheme as an inventory, and a straight building's length fitted to a number of
// flats a floor at the sizes asked for.
import { evaluate, type Evaluated } from './evaluate';
import { DEFAULT_SITE, SQFT, type BuildingReport, type Unit } from '../doc/site';
import { stretched, spineLength, own } from './edit';
import type { ProBuilding, ProProject } from './project';

export const sizesOf = (p: ProProject, b?: { sizes?: [number, number, number] }): [number, number, number] => b?.sizes ?? p.sizes ?? DEFAULT_SITE.sizes;

export interface TypeLine { t: 0 | 1 | 2; n: number; carpet: number }
export interface Typical {
  /** flats on the typical floor by type, each with its average carpet (m²) */
  types: TypeLine[];
  flats: number; cores: number;
  /** the floor's area and its carpet (m²), and carpet ÷ area */
  area: number; carpet: number; eff: number;
  /** how many floors are like it */
  repeats: number;
}

const homes = (us: Unit[]) => us.filter((u) => u.t < 3) as (Unit & { t: 0 | 1 | 2 })[];
const byType = (us: Unit[]): TypeLine[] => ([0, 1, 2] as const).map((t) => { const x = homes(us).filter((u) => u.t === t); return { t, n: x.length, carpet: x.length ? x.reduce((s, u) => s + u.carpet, 0) / x.length : 0 }; }).filter((x) => x.n > 0);

/** a building's typical floor: a plain one's (every floor alike), a formed one's floor with the most flats */
export function typicalOf(br: BuildingReport): Typical {
  const L = br.laid, f = L && br.typical !== undefined ? L.floors[br.typical] : null;
  const us = f ? f.units : br.units, area = f ? f.area : br.plate;
  const carpet = us.reduce((s, u) => s + u.carpet, 0);
  return { types: byType(us), flats: homes(us).length, cores: br.cores.length, area, carpet, eff: area > 0 ? carpet / area : 0, repeats: f ? (br.repeats ?? 1) : br.floors };
}

export interface InvLine { building: number; t: 0 | 1 | 2; n: number; carpet: number; value: number }
/** every flat in the scheme, by building and type: how many, their carpet in all (m²), and what they sell for */
export function inventory(e: Evaluated): InvLine[] {
  const rate = (e.d.money.costs as { sale: number }).sale, out: InvLine[] = [];
  e.d.buildings.forEach((br, i) => {
    const all: Unit[] = br.laid ? br.laid.floors.flatMap((f) => (f.kind && f.kind !== 'residential' ? [] : f.units)) : Array.from({ length: br.floors }, () => br.units).flat();
    for (const t of [0, 1, 2] as const) {
      const x = homes(all).filter((u) => u.t === t);
      if (!x.length) continue;
      const carpet = x.reduce((s, u) => s + u.carpet, 0);
      out.push({ building: i, t, n: x.length, carpet, value: carpet * SQFT * rate });
    }
  });
  return out;
}

/** can its length be fitted: a straight, plain building (a formed one's plan is shaped by hand) */
export const fittable = (b: ProBuilding) => !b.form && !b.closed && b.spine.length === 4;

/** the length (m) a straight building needs for `target` flats a floor at its sizes, by halving the range: the
 *  shortest that holds that many; null when none does between 8 and 400 m. A few evaluations of the project. */
export function fitLength(p: ProProject, e: Evaluated, id: string, target: number): { len: number; got: number } | null {
  const s = own(p, e), b0 = s.buildings.find((b) => b.id === id);
  if (!b0 || !fittable(b0) || target < 1) return null;
  const count = (len: number) => {
    const q: ProProject = { ...p, scheme: { ...s, buildings: s.buildings.map((b) => (b.id === id ? stretched(b, len) : b)) } };
    const br = evaluate(q).d.buildings.find((x) => x.b.id === id);
    return br ? typicalOf(br).flats : 0;
  };
  let lo = 8, hi = 400;
  if (count(hi) < target) return null;
  for (let k = 0; k < 12 && hi - lo > 0.5; k++) { const mid = (lo + hi) / 2; if (count(mid) >= target) hi = mid; else lo = mid; }
  const len = Math.round(hi * 2) / 2;
  return { len, got: count(len) };
}

export const currentLength = (b: ProBuilding) => spineLength(b);
