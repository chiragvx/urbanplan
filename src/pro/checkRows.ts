// Checks as rows (docs/plans/pro-design-freedom.md §7.2, step 7): each check says what it applies to (a selector by
// NBC occupancy group, use or building height), what it measures, its limit and its clause, the way a generic code
// checker's rule templates do (Solibri's, CORENET X's). A building is checked use by use: its floors, and the spaces
// on them, grouped by use (step 5), each use in its NBC group (../doc/egress.ts).
//
// A use whose group hasn't been worked through (C institutional, G industrial, H storage, J hazardous), or a floor
// with no use yet, isn't checked against figures meant for another: it gets a "not checked" line, which the Approval
// step lists first, so a scheme of uses we can't check never looks falsely clean.
//
// The checks about the plot (FSI, margins, the ladder of premiums, parking, open space) stay as code in ./scrutiny.ts:
// they are about the plot, not about uses. Rows join them there.
import { buaOf, FIRE_H, FIRE_W, shared, type BuildingReport } from '../doc/site';
import { COVERED, EGRESS, GROUP_NAME, groupOf, stairMinOf, UNIT_W, type NbcGroup } from '../doc/egress';
import { floorUseOf, USE_TABLE, type FloorUse } from '../doc/uses';
import type { Evaluated } from './evaluate';
import type { Check, CheckGroup } from './scrutiny';

/** what a row applies to: uses in these groups, these uses, buildings over this height; `label` says it in words */
export interface Applies { groups?: NbcGroup[]; uses?: FloorUse[]; over?: number; label: string }

/** one use in one building: its area, the people it holds (its area over its occupant load) and its busiest floor */
export interface Subject { use: FloorUse; group: NbcGroup | null; area: number; people: number }

export interface RowCtx {
  e: Evaluated; i: number; b: BuildingReport;
  /** the building's uses the row applies to */
  subjects: Subject[];
  /** the building's stairs (how many, clear width), as its systems have them */
  stair?: { n: number; w: number };
}

export interface CheckRow {
  key: string; group: CheckGroup; rule: string;
  applies: Applies;
  /** what it measures, and its limit, in words (the report's "applies to / measures / limit / clause") */
  measures: string; limit: string;
  clause: string;
  /** needs its group's figures: a use in a group not worked through is "not checked" instead */
  byGroup?: boolean;
  /** the check for one building, given the uses it applies to; null: nothing to say */
  run: (x: RowCtx) => Pick<Check, 'required' | 'proposed' | 'status' | 'note'> | null;
}

const m = (v: number, d = 1) => `${(Math.round(v * 10 ** d) / 10 ** d).toLocaleString('en-IN')} m`;
const groupsIn = (s: Subject[]) => [...new Set(s.map((x) => x.group).filter((g): g is NbcGroup => !!g))];
const names = (gs: NbcGroup[]) => gs.map((g) => `${g} (${GROUP_NAME[g].toLowerCase()})`).join(', ');

/** each use's area and people in a building, floor by floor (a floor's spaces by their own use); and the busiest
 *  floor's units of stair width (each use's people over its group's people a unit) */
export function subjectsOf(b: BuildingReport): { subjects: Subject[]; units: number } {
  const by = new Map<FloorUse, Subject>();
  let units = 0;
  const addTo = (use: FloorUse, area: number) => {
    const ld = USE_TABLE[use].load, people = ld > 0 ? area / ld : 0;
    const s = by.get(use) ?? { use, group: groupOf(use), area: 0, people: 0 };
    s.area += area; s.people += people; by.set(use, s);
    return people / EGRESS[groupOf(use) ?? 'A'].perUnit;
  };
  if (b.laid) {
    for (const f of b.laid.floors) {
      let u = 0;
      for (const g of shared(f, b.use)) u += g.kind === 'parking' ? (addTo('parking', g.area), 0) : addTo(g.kind, g.area);
      units = Math.max(units, u);
    }
  } else {
    // (a plain building: its plot use on every floor)
    const use = floorUseOf(b.use), u = addTo(use, buaOf(b));
    units = u / Math.max(1, b.floors);
  }
  return { subjects: [...by.values()], units };
}

/** the farthest any corner of a floor is from the nearest stair (a core's middle), in a straight line: a corridor's
 *  walk is longer, never shorter */
export function farthestFromStair(b: BuildingReport): number | null {
  const cores = b.laid?.cores?.length ? b.laid.cores : b.cores;
  if (!cores?.length) return null;
  const mid = cores.map((c) => { let x = 0, z = 0; for (let k = 0; k < c.length; k += 2) { x += c[k]; z += c[k + 1]; } return [x / (c.length / 2), z / (c.length / 2)]; });
  const rings = b.laid ? b.laid.floors.map((f) => f.ring ?? b.laid!.outline).filter((r) => r && r.length >= 6) : b.quads;
  let far = 0;
  for (const r of rings) for (let k = 0; k < r.length; k += 2) far = Math.max(far, Math.min(...mid.map(([x, z]) => Math.hypot(r[k] - x, r[k + 1] - z))));
  return far;
}

/** a corridor's walk to a stair is at least the straight line; past this share of the limit, it's worth a look */
const NEAR = 0.8;

export const ROWS: CheckRow[] = [
  {
    key: 'fire-access', group: 'Fire & safety', rule: 'Fire tender access',
    applies: { over: FIRE_H, label: `buildings over ${FIRE_H} m` }, measures: 'a clear way round the building', limit: `${FIRE_W} m wide`,
    clause: 'NBC 2016 Part 4',
    run: ({ b }) => ({ required: `${FIRE_W} m clear round it above ${FIRE_H} m`, proposed: b.fireOk ? 'clear way round' : 'way round blocked', status: b.fireOk ? 'pass' : 'fail' }),
  },
  {
    key: 'travel', group: 'Fire & safety', rule: 'Travel distance to a stair',
    applies: { groups: COVERED, label: 'every use in groups A, B, D, E and F' }, measures: 'the farthest corner of any floor from the nearest stair, in a straight line', limit: 'by group (Table 22)',
    clause: 'NBC 2016 Part 4 Table 22 (as assumed; unsprinklered)', byGroup: true,
    run: ({ e, b, subjects }) => {
      const gs = groupsIn(subjects); if (!gs.length) return null;
      const houses = (e.p.scheme?.buildings ?? []).find((y) => y.id === b.b.id)?.form?.houses ?? 0;
      const lim = Math.min(...gs.map((g) => EGRESS[g].travel)), far = farthestFromStair(b);
      const required = `at most ${m(lim, 0)} for ${names(gs)}`;
      if (far === null) {
        // (a building on the ground alone goes out by its doors; a house of its own has its own stair)
        if (b.floors <= 1) return { required, proposed: 'one floor: out by its doors', status: 'pass' };
        if (houses > 0 || (b.height <= 10 && subjects.every((s) => s.use === 'residential'))) return { required, proposed: 'houses, each with its own stair', status: 'pass', note: 'As assumed: the common-stair rules are for buildings that share one.' };
        return { required, proposed: 'no stair laid out', status: 'warn', note: 'Place a core to check how far it is to a stair.' };
      }
      const status = far > lim ? 'fail' : far > lim * NEAR ? 'warn' : 'pass';
      return { required, proposed: `${m(far)} in a straight line from the farthest corner`, status, note: status === 'warn' ? 'The walk along a corridor is longer than the straight line: check it on the plan, or add a stair.' : status === 'fail' ? 'Even in a straight line it is too far: add a core, or move one nearer the far end.' : undefined };
    },
  },
  {
    key: 'exit-width', group: 'Fire & safety', rule: 'Stair width for the people on a floor',
    applies: { groups: COVERED, label: 'every use in groups A, B, D, E and F' }, measures: 'the stairs\' clear width, all together, against the busiest floor\'s people', limit: 'a 0.5 m unit for so many people, by group (Table 21)',
    clause: 'NBC 2016 Part 4 Table 21 (as assumed)', byGroup: true,
    run: ({ b, subjects, stair }) => {
      const gs = groupsIn(subjects); if (!gs.length || !stair || b.floors <= 1) return null;
      const need = Math.ceil(subjectsOf(b).units - 1e-9) * UNIT_W, have = stair.n * stair.w;
      return { required: `${m(need, 1)} in all (${gs.map((g) => `${EGRESS[g].perUnit} people a 0.5 m unit in ${g}`).join(', ')})`, proposed: `${stair.n} × ${m(stair.w, 2)} = ${m(have, 2)}`, status: have + 1e-6 < need ? 'fail' : 'pass' };
    },
  },
  {
    key: 'stair-min', group: 'Fire & safety', rule: 'Narrowest stair',
    applies: { groups: COVERED, label: 'every use in groups A, B, D, E and F' }, measures: 'each stair\'s clear width', limit: 'flats by height (UDCPR Table 9G); other uses by group (NBC 4.4.2.4.3)',
    clause: 'UDCPR 2020 Table 9G; NBC 2016 Part 4 4.4.2.4.3 (as assumed)', byGroup: true,
    run: ({ b, subjects, stair }) => {
      if (!subjects.length || !stair || b.floors <= 1) return null;
      const worst = subjects.reduce((a, s) => (stairMinOf(s.use, b.height) > stairMinOf(a.use, b.height) ? s : a));
      const need = stairMinOf(worst.use, b.height);
      return { required: `at least ${m(need, 2)} clear (${USE_TABLE[worst.use].label.toLowerCase()}${worst.use === 'residential' ? ` at ${m(b.height)}` : ''})`, proposed: m(stair.w, 2), status: stair.w + 1e-6 < need ? 'fail' : 'pass' };
    },
  },
];

/** whether a use falls under what a row applies to (its height part is the building's, checked apart) */
const matches = (a: Applies, s: Subject) => (!a.groups || (!!s.group && a.groups.includes(s.group))) && (!a.uses || a.uses.includes(s.use));

/** The rows run on every building: a check per row and building, and a "not checked" line for each use the rows can't
 *  check (a group not worked through, or no use yet). Keys end in the building's index (`travel:0`). */
export function runRows(e: Evaluated, rows: CheckRow[] = ROWS): Check[] {
  const out: Check[] = [], many = e.d.buildings.length > 1;
  e.d.buildings.forEach((b, i) => {
    const name = many ? ` · building ${String.fromCharCode(65 + i)}` : '';
    const all = subjectsOf(b).subjects.filter((s) => s.use !== 'parking' && s.area > 0.5);
    const stair = e.sys.buildings[i]?.stair;
    for (const r of rows) {
      if (r.applies.over !== undefined && b.height <= r.applies.over) continue;
      const subjects = r.applies.groups || r.applies.uses ? all.filter((s) => matches(r.applies, s)) : all;
      if ((r.applies.groups || r.applies.uses) && !subjects.length) continue;
      const c = r.run({ e, i, b, subjects, stair });
      if (c) out.push({ key: `${r.key}:${i}`, group: r.group, rule: `${r.rule}${name}`, clause: r.clause, applies: r.applies.label, ...c });
    }
    // (the uses the group rows can't check)
    const byGroup = rows.filter((r) => r.byGroup);
    for (const s of all) {
      if (s.group && COVERED.includes(s.group)) continue;
      const label = USE_TABLE[s.use].label;
      out.push({
        key: `unchecked-${s.use}:${i}`, group: 'Fire & safety', rule: `${label}: ${byGroup.map((r) => r.rule.toLowerCase()).join(', ')}${name}`,
        clause: s.group ? `NBC 2016 Part 4, group ${s.group} (${GROUP_NAME[s.group].toLowerCase()}): not worked through yet` : 'Needs a use',
        applies: s.group ? `group ${s.group} (${GROUP_NAME[s.group].toLowerCase()})` : 'floors with no use yet',
        required: s.group ? `NBC's figures for group ${s.group}` : 'a use, to know which rules apply',
        proposed: s.group ? `not checked: no figures for ${label.toLowerCase()} here yet` : `not checked: ${Math.round(s.area).toLocaleString('en-IN')} m² with no use yet`,
        status: 'unchecked',
        note: s.group ? 'Ask your fire consultant for this use\'s exits, travel and stair widths: this report hasn\'t checked them.' : 'Give these floors a use, and the checks for it apply.',
      });
    }
  });
  return out;
}
