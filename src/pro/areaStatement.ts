// The area statement: the plot, what it permits part by part (with the FSI ladder's choices), what's proposed
// building by building, coverage, open space, height, carpet and parking, each line checked where there's a limit.
// It's the one table the land team, the architect and the liaison all work from: Pro shows it live (Numbers, from
// the scorecard) and the drawing set prints the same rows.
import { floorKind, SQFT, UNIT_LABEL, type FloorUse } from '../doc/site';
import { polyArea } from '../doc/plot';
import { USE_LABEL } from './deal';
import type { Evaluated } from './evaluate';
import { loadOf } from './project';

export type Tone = 'ok' | 'bad' | 'off';
export type ASRow =
  | { k: 'h'; label: string }
  | { k: 'r' | 't'; label: string; value: string; tone?: Tone; building?: number };

export interface FloorRun { a: number; z: number; kind: FloorUse; area: number }

const f2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2);
const m2 = (v: number) => `${f2(v)} m²`;
const letter = (i: number) => String.fromCharCode(65 + i);
const levels = (a: number, z: number) => (a === z ? `level ${a}` : `levels ${a}–${z}`);

/** A formed building's floors in runs of the same use and area (the drawing set splits by outline too: same totals). */
export function floorRuns(e: Evaluated, bi: number): FloorRun[] {
  const b = e.d.buildings[bi], L = b.laid;
  if (!L) return [];
  const sig = (i: number) => `${floorKind(L.floors[i], b.use)}|${L.floors[i].units.length}|${Math.round(L.floors[i].area * 10)}`;
  const out: FloorRun[] = [];
  for (let i = 1, s0 = 0; i <= L.floors.length; i++) if (i === L.floors.length || sig(i) !== sig(s0)) { out.push({ a: e.d.under + s0, z: e.d.under + i - 1, kind: floorKind(L.floors[s0], b.use), area: L.floors[s0].area }); s0 = i; }
  return out;
}

export function areaStatement(e: Evaluated, runs: (e: Evaluated, bi: number) => FloorRun[] = floorRuns): ASRow[] {
  const { r, d, shops } = e, F = e.full, P = r.parts, R = r.rules, ld = loadOf(e.p);
  const rows: ASRow[] = [];
  const h = (label: string) => rows.push({ k: 'h', label });
  const row = (label: string, v: number | string, tone?: Tone, building?: number) => rows.push({ k: 'r', label, value: typeof v === 'number' ? m2(v) : v, tone, building });
  const tot = (label: string, v: number | string, tone?: Tone) => rows.push({ k: 't', label, value: typeof v === 'number' ? m2(v) : v, tone });
  const ok = (good: boolean): Tone => (good ? 'ok' : 'bad');
  const anc = r.code === 'udcpr' ? 'Ancillary' : 'Fungible';

  h('Plot');
  row('Plot area (as per the record)', r.area);
  row('Less: road widening (DP)', r.lost);
  row('Net plot area', r.netArea);
  row('Road width for the rules', `${f2(r.roadW)} m`);

  h('Permissible built-up area');
  row(`Basic FSI ${f2(R.basic)} on the net plot`, P.basic);
  // (a part the ladder leaves: what it would give, marked as not taken)
  const part = (label: string, taken: boolean, have: number, could: number) => (taken ? row(label, have) : could > 0.5 ? row(`${label} (${m2(could)} available)`, 'not taken', 'off') : undefined);
  part(`Premium FSI ${f2(F.rules.premium)}`, ld.premium, P.premium, F.parts.premium);
  part(`TDR ${f2(F.rules.tdr)}`, ld.tdr, P.tdr, F.parts.tdr);
  if (P.credit > 0) row('FSI of the road widening handed over', P.credit);
  part(`${anc} FSI ${Math.round(F.rules.ancillary * 100)}%`, ld.ancillary, P.ancillary, F.parts.ancillary);
  tot('Total permissible', r.bua);

  h('Proposed built-up area');
  if (shops) row('Ground floor shops', shops.ground);
  d.buildings.forEach((b, i) => {
    if (b.laid) { runs(e, i).forEach((g) => row(`Building ${letter(i)}: ${levels(g.a, g.z)} ${USE_LABEL[g.kind].toLowerCase()}, ${g.z - g.a + 1} × ${f2(g.area)} m²${g.kind === 'parking' ? ' (free of FSI)' : ''}`, g.kind === 'parking' ? 0 : g.area * (g.z - g.a + 1), undefined, i)); return; }
    const plate = b.quads.reduce((s, q) => s + polyArea(q), 0);
    if (d.under) row(`Building ${letter(i)}: stilt (parking)`, 'free of FSI', undefined, i);
    row(`Building ${letter(i)}: floors 1–${b.floors}, ${b.floors} × ${f2(plate)} m²`, plate * b.floors, undefined, i);
  });
  tot('Total proposed', d.bua, ok(!d.over.fsi));
  row('FSI used', `${f2(d.fsi)} of ${f2(r.area ? r.bua / r.area : 0)}`);
  row('Balance', m2(d.left), d.left < -0.5 ? 'bad' : undefined);

  h('Coverage, open space and height');
  row('Ground coverage', `${m2(d.coverage * r.area)} · ${Math.round(d.coverage * 100)}%`);
  row('Recreational open space required', d.open.need);
  row('Recreational open space provided', d.open.have, d.open.need > 0 ? ok(!d.over.open) : undefined);
  row('Height proposed (to the terrace)', `${f2(d.height)} m`, ok(!d.over.height));
  row('Height limit', `${f2(R.maxH)} m`);

  h('Carpet (RERA)');
  [0, 1, 2].forEach((t) => { if (d.count[t]) row(`${UNIT_LABEL[t]}`, `${d.count[t]} flats`); });
  if (shops) row('Shops', `${shops.count} · ${m2(shops.carpet)}`);
  for (const x of d.money.uses) if (x.use !== 'residential') row(USE_LABEL[x.use], `${x.units} unit${x.units === 1 ? '' : 's'} · ${m2(x.carpet)}`);
  tot('Total carpet (flats)', `${m2(d.carpet)} · ${Math.round(d.carpet * SQFT).toLocaleString('en-IN')} sq ft`);
  row('Tenements', `${d.flats + (shops?.count ?? 0) + d.count[3]}`);

  h('Parking');
  row('Car bays required', `${d.parking.need}`);
  d.parking.levels.filter((l) => l.bays.length).forEach((l, i) => row(`${l.kind[0].toUpperCase()}${l.kind.slice(1)}${l.kind === 'basement' ? ` ${i}` : ''}`, `${l.bays.length} bays`));
  tot('Car bays provided', `${d.parking.have}`, ok(d.parking.have >= d.parking.need));
  if (d.parking.want) row('Car bays wanted (your target)', `${d.parking.want}`, d.parking.have >= d.parking.want ? 'ok' : 'bad');
  // (by use: built-up, carpet, units and the people each holds by its occupant load)
  if (d.money.uses.length > 1 || d.money.uses.some((x) => x.use !== 'residential')) {
    h('By use');
    for (const x of d.money.uses) row(USE_LABEL[x.use], `${m2(x.area)} built-up · ${m2(x.carpet)} carpet · ${x.units} unit${x.units === 1 ? '' : 's'}${x.people ? ` · ${x.people} people` : ''}`);
  }
  if (d.people) row('People (by occupant load, NBC 2016 Part 4)', `${d.people}`);
  return rows;
}
