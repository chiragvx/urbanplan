// Our own scrutiny report: every rule the scheme is checked against, as pass, fail, warn (a rule that applies but
// isn't modelled yet, or a near thing) or info (a step it triggers, such as a NOC). Each line gives what the rule
// requires, what the project proposes and the clause, the way an authority's scrutiny report reads, so an architect
// can see at a glance what will come back. It is advisory: the values are UDCPR 2020 / DCPR 2034 and NBC 2016 as
// assumed here (see each clause), and the authority's own scrutiny has the last word. Check with your architect.
import { FIRE_H, FIRE_W, floorKind, RG_FROM, RG_SHARE, SQFT, UNIT_LABEL } from '../doc/site';
import { shopFloorsAllowed } from './mixed';
import { sideMargin } from '../doc/plot';
import type { Evaluated } from './evaluate';

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'info';
export type CheckGroup = 'Planning' | 'Building' | 'Fire & safety' | 'Parking & open space' | 'Flats & rooms';
export interface Check { key: string; group: CheckGroup; rule: string; clause: string; required: string; proposed: string; status: CheckStatus; note?: string }

/** the rooms of each flat of the typical floor, per building (from ./rooms.ts; only what's read here) */
export type RoomsLike = { unit: number; t: number; rooms: { kind: string; name: string; area: number; minArea: number; width: number; minWidth: number; ok: boolean }[]; ok: boolean }[][];

// thresholds read from UDCPR 2020 chapter 9 (DCPR and NBC where they differ are noted)
/** 9.27.1: a lift over 15 m, two over 24 m */
const LIFT_H = 15, TWO_LIFTS_H = 24;
/** 9.29.8: a fire lift from 15 m; 9.29.6: a refuge area on the floor above 24 m, above 39 m, then every 15 m */
const FIRE_LIFT_H = 15, REFUGE_H = 24, REFUGE_EVERY = 15;
/** amenity space: plots this big (m²) give this share */
const AMENITY_FROM = 20000, AMENITY_SHARE = 0.05;
/** inclusive housing: plots this big (m²) give this share of the basic FSI as EWS / LIG tenements */
const IH_FROM = 4000, IH_SHARE = 0.2;
/** environment clearance (SEIAA) from this built-up area (m²) */
const EC_FROM = 20000;
/** Table 9G: residential stairs 1.0 m up to 15 m, 1.2 m up to 24 m, 1.5 m above */
const stairFor = (h: number) => (h <= 15 ? 1.0 : h <= 24 ? 1.2 : 1.5);

const m = (v: number, d = 1) => `${(Math.round(v * 10 ** d) / 10 ** d).toLocaleString('en-IN')} m`;
const m2 = (v: number) => `${Math.round(v).toLocaleString('en-IN')} m²`;
const f2 = (v: number) => (Math.round(v * 100) / 100).toFixed(2);

export function scrutiny(e: Evaluated, rooms?: RoomsLike): Check[] {
  const { r, d, shops } = e, R = r.rules, out: Check[] = [];
  const code = r.code === 'udcpr' ? 'UDCPR 2020' : 'DCPR 2034';
  const add = (c: Check) => out.push(c);
  const name = (i: number) => (d.buildings.length > 1 ? ` · building ${String.fromCharCode(65 + i)}` : '');
  const hasBuildings = d.buildings.length > 0;

  // ---- planning: the plot, FSI, use ----
  add({ key: 'road', group: 'Planning', rule: 'Access road', clause: `${code} 3.2`, required: 'a road along the plot', proposed: r.edges.some(Boolean) ? `${m(r.roadW, 0)} road (${r.roads.length} along the plot)` : 'no road frontage', status: r.edges.some(Boolean) ? 'pass' : 'fail' });
  if (r.lost > 0.5) add({ key: 'dp-road', group: 'Planning', rule: 'DP road widening', clause: `${code} (road widening handed over)`, required: 'the strip inside the DP road line handed over', proposed: `${m2(r.lost)} taken out; ${m2(r.netArea)} net`, status: 'info', note: 'The FSI of the strip is credited when it is handed over free of cost (as assumed).' });
  const fsiParts = `basic ${f2(R.basic)} + premium ${f2(R.premium)} + TDR ${f2(R.tdr)}, ${Math.round(R.ancillary * 100)}% ${r.code === 'udcpr' ? 'ancillary' : 'fungible'}`;
  add({ key: 'fsi', group: 'Planning', rule: 'Built-up area (FSI)', clause: r.code === 'udcpr' ? 'UDCPR 2020 Tables 6-G / 6-A' : 'DCPR 2034 Table 12', required: `at most ${m2(r.bua)} (${fsiParts})`, proposed: `${m2(d.bua)}${shops ? ` incl. ${m2(shops.ground)} of ground-floor shops` : ''} · FSI ${f2(d.fsi)}`, status: d.bua > r.bua + 1 ? 'fail' : 'pass' });
  if (shops) add({ key: 'shops', group: 'Planning', rule: 'Shops by road width', clause: `${code} mixed use (as summarised: 9 m G, 18 m G+1, 24 m G+2, 30 m all)`, required: shops.allowed === 0 ? 'no shops on this road' : shops.allowed >= 99 ? 'any floor' : `${shops.allowed} floor${shops.allowed > 1 ? 's' : ''}`, proposed: `${shops.floors} floor${shops.floors > 1 ? 's' : ''} of shops`, status: shops.over ? 'fail' : 'pass', note: 'Also depends on the zone in the DP: check the zone permits commercial use.' });
  if (r.area >= AMENITY_FROM) add({ key: 'amenity', group: 'Planning', rule: 'Amenity space', clause: `${code} 3.5 (as assumed)`, required: `${Math.round(AMENITY_SHARE * 100)}% of the plot: ${m2(r.area * AMENITY_SHARE)}`, proposed: 'not set aside in this scheme', status: 'warn', note: 'Not modelled yet: set it aside on the site plan before submission.' });
  if (r.area >= IH_FROM) add({ key: 'inclusive', group: 'Planning', rule: 'Inclusive housing (EWS / LIG)', clause: `${code} 3.8 (cities over 1 million, as assumed)`, required: `${Math.round(IH_SHARE * 100)}% of the basic FSI as tenements: ${m2(r.parts.basic * IH_SHARE)}`, proposed: 'not set aside in this scheme', status: 'warn', note: 'Not modelled yet. Check whether the authority applies it here.' });
  if (d.bua >= EC_FROM) add({ key: 'ec', group: 'Planning', rule: 'Environment clearance', clause: 'EIA Notification 2006, item 8(a)', required: `needed from ${m2(EC_FROM)} of built-up area`, proposed: m2(d.bua), status: 'info', note: 'SEIAA clearance before construction starts.' });

  // ---- building: height, margins ----
  if (!hasBuildings) add({ key: 'building', group: 'Building', rule: 'A building', clause: '—', required: 'a building to check', proposed: 'none fits the plot', status: 'fail' });
  d.buildings.forEach((b, i) => {
    const roof = b.laid?.roof ? ` to the middle of its sloping roof` : '';
    add({ key: `height:${i}`, group: 'Building', rule: `Height${name(i)}`, clause: `Height limit (fire and aviation clearances, as assumed)${roof ? `; ${code} measures to the middle of a sloping roof` : ''}`, required: `at most ${m(R.maxH)}`, proposed: `${m(b.height)}${roof} · ${b.floors} floors${d.under ? ' on a stilt' : ''}`, status: b.overHeight ? 'fail' : 'pass' });
    const side = sideMargin(R, b.height);
    add({ key: `margins:${i}`, group: 'Building', rule: `Margins${name(i)}`, clause: r.code === 'udcpr' ? 'UDCPR 2020 Table 6-D' : 'DCPR 2034 Table 18; Reg. 41(2) Table A', required: `front ${m(R.front)}, sides and rear ${m(side)} at ${m(b.height)}`, proposed: b.clash === 'margins' ? 'past the margins' : b.clash === 'overlap' ? 'overlaps another building' : b.clash === 'zone' ? 'on a no-build zone' : 'inside the margins', status: b.clash ? 'fail' : 'pass' });
  });
  // a formed building: what its form's procedure flagged, the columns that land on nothing, the floors that stand out
  d.buildings.forEach((b, i) => {
    const L = e.forms[b.b.id];
    if (!L) return;
    for (const x of L.issues) add({ key: `form:${x.key}:${i}`, group: 'Building', rule: `Form${name(i)}`, clause: 'The form as laid out', required: 'a buildable form', proposed: x.text, status: x.tone });
    if (L.transfers > 0) add({ key: `transfers:${i}`, group: 'Building', rule: `Structure: transfers${name(i)}`, clause: 'Structural (as assumed; the structural engineer has the last word)', required: 'columns carried straight to the ground', proposed: `${L.transfers} column${L.transfers === 1 ? '' : 's'} on a transfer girder`, status: 'warn', note: 'A column that lands on nothing below needs a transfer girder or slab: deeper floors there, and cost.' });
    const out = L.floors.filter((f) => f.over > 0.5);
    if (out.length) {
      const most = out.reduce((a, f) => (f.over > a.over ? f : a));
      add({ key: `cantilever:${i}`, group: 'Building', rule: `Structure: cantilevers${name(i)}`, clause: 'Structural (as assumed); projections count in the built-up area', required: 'floors carried by the floor below', proposed: `${out.length} floor${out.length === 1 ? '' : 's'} standing out, up to ${m2(most.over)} (level ${most.level})`, status: 'warn', note: 'Cantilevered floors need back-spans or transfer structure; check the margins below them too.' });
    }
  });
  // mixed use in a formed building: shops, offices or a hotel under homes, on as many floors as the road allows
  // (mixed.ts's tiers)
  d.buildings.forEach((b, i) => {
    if (!b.laid) return;
    const kinds = b.laid.floors.map((f) => floorKind(f, b.use));
    if (!kinds.includes('residential')) return;
    const commercial = kinds.filter((k) => k === 'retail' || k === 'office' || k === 'hotel').length;
    if (!commercial) return;
    const allowed = shopFloorsAllowed(r.roadW), over = commercial > allowed;
    add({ key: `mixed:${i}`, group: 'Planning', rule: `Commercial floors by road width${name(i)}`, clause: `${code} mixed use (as summarised: 9 m G, 18 m G+1, 24 m G+2, 30 m all)`, required: allowed === 0 ? `none on a ${m(r.roadW, 0)} road` : allowed >= 99 ? 'any floor' : `${allowed} floor${allowed > 1 ? 's' : ''} on a ${m(r.roadW, 0)} road`, proposed: `${commercial} floor${commercial > 1 ? 's' : ''} of shops, offices or hotel`, status: over ? 'fail' : 'pass', note: 'Also depends on the zone in the DP: check the zone permits commercial use.' });
  });
  if (hasBuildings) add({ key: 'coverage', group: 'Building', rule: 'Ground coverage', clause: `${code} (no separate cap for residential in this table, as assumed)`, required: 'inside the margins', proposed: `${Math.round(d.coverage * 100)}% of the plot`, status: 'info' });

  // ---- fire and safety ----
  const H = d.height;
  if (hasBuildings) {
    d.buildings.forEach((b, i) => {
      if (b.height <= FIRE_H) return;
      add({ key: `fire-access:${i}`, group: 'Fire & safety', rule: `Fire tender access${name(i)}`, clause: 'NBC 2016 Part 4', required: `${FIRE_W} m clear round it above ${FIRE_H} m`, proposed: b.fireOk ? 'clear way round' : 'way round blocked', status: b.fireOk ? 'pass' : 'fail' });
    });
    add({ key: 'fire-noc', group: 'Fire & safety', rule: 'Fire NOC', clause: 'Maharashtra Fire Prevention Act 2006; NBC 2016 Part 4', required: `needed over ${FIRE_H} m`, proposed: m(H), status: H > FIRE_H ? 'info' : 'pass', note: H > FIRE_H ? 'Provisional fire NOC with the plans, final before occupation.' : undefined });
    // (lifts, stairs, refuge floors, fire systems, water and power: as the building systems size them, ./systems.ts)
    for (const c of e.sys.checks) add({ key: `sys:${c.key}`, group: c.group === 'Cores' || c.group === 'Fire' ? 'Fire & safety' : 'Building', rule: c.rule, clause: c.clause, required: c.required, proposed: c.proposed, status: c.status });
    const cores = d.buildings.reduce((s, b) => s + b.cores.length, 0);
    if (!e.sys.checks.length) add({ key: 'lift', group: 'Fire & safety', rule: 'Lifts', clause: 'UDCPR 2020 9.27.1, 9.29.8', required: H > TWO_LIFTS_H ? 'two lifts (over 24 m), one a fire lift (from 15 m)' : H >= FIRE_LIFT_H ? 'a lift, which is a fire lift (from 15 m)' : 'none up to 15 m', proposed: H > LIFT_H ? `${cores} core${cores > 1 ? 's' : ''}, each with ${H > TWO_LIFTS_H ? 'two lifts' : 'a lift'}, one a fire lift (as laid)` : 'not needed', status: 'pass', note: 'Each core is laid out with a stair and its lifts.' });
    const refuges = H > REFUGE_H ? Math.floor((H - REFUGE_H) / REFUGE_EVERY) + 1 : 0;
    if (!e.sys.checks.length) add({ key: 'refuge', group: 'Fire & safety', rule: 'Refuge areas', clause: 'UDCPR 2020 9.29.6 (the floor above 24 m, above 39 m, then every 15 m)', required: H > REFUGE_H ? `${refuges} refuge level${refuges > 1 ? 's' : ''}` : `none up to ${REFUGE_H} m`, proposed: H > REFUGE_H ? 'not laid out yet' : m(H), status: H > REFUGE_H ? 'warn' : 'pass', note: H > REFUGE_H ? 'Each 15 m² or 0.3 m² per person of two floors, whichever is more, open on one side; free of FSI. Not laid out yet.' : undefined });
    const stair = stairFor(H);
    if (!e.sys.checks.length) add({ key: 'stair', group: 'Fire & safety', rule: 'Staircase width', clause: 'UDCPR 2020 Table 9G', required: `at least ${m(stair)} clear`, proposed: `cores sized for ${m(stair)}`, status: 'pass', note: 'From the core size, until stairs are drawn.' });
    add({ key: 'travel', group: 'Fire & safety', rule: 'Travel distance to a stair', clause: 'NBC 2016 Part 4 (as assumed: 30 m)', required: 'at most 30 m along the corridor', proposed: 'cores spaced for it', status: 'pass' });
  }

  // ---- parking and open space ----
  if (hasBuildings) {
    const short = d.parking.need - d.parking.have;
    add({ key: 'parking', group: 'Parking & open space', rule: 'Parking', clause: `${code} Table 8-B`, required: `${d.parking.need} car bays${shops ? ` (incl. ${shops.cars} for the shops)` : ''}`, proposed: `${d.parking.have} bays${levelsText(d.parking.levels)}`, status: short > 0 ? 'fail' : 'pass' });
  }
  if (r.area >= RG_FROM) add({ key: 'open', group: 'Parking & open space', rule: 'Recreational open space', clause: `${code} 3.5.1`, required: `${Math.round(RG_SHARE * 100)}% of the plot: ${m2(d.open.need)}`, proposed: m2(d.open.have), status: d.over.open ? 'fail' : 'pass' });
  else add({ key: 'open', group: 'Parking & open space', rule: 'Recreational open space', clause: `${code} 3.5.1`, required: `none under ${m2(RG_FROM)}`, proposed: m2(r.area), status: 'pass' });

  // ---- flats and rooms ----
  const flats = e.checks.filter((c) => c.t !== 3);
  if (flats.length) {
    const all = flats.reduce((s, c) => s + c.floors, 0), ok = flats.filter((c) => c.light && c.air).reduce((s, c) => s + c.floors, 0);
    add({ key: 'light', group: 'Flats & rooms', rule: 'Light and ventilation', clause: r.code === 'udcpr' ? `${code} Chapter 9 (windows 1/10 of the habitable floor, half of it opening; as assumed)` : 'DCPR 2034 Reg. 40(1) (windows 1/6 of the habitable floor)', required: 'every flat', proposed: `${ok} of ${all} flats`, status: ok === all ? 'pass' : 'fail' });
  }
  if (rooms) {
    const by = new Map<string, { n: number; bad: number; min: string; worst: string }>();
    rooms.forEach((bl, bi) => bl.forEach((f) => {
      const floors = d.buildings[bi]?.floors ?? 1;
      for (const x of f.rooms) {
        const k = x.kind, cur = by.get(k) ?? { n: 0, bad: 0, min: [x.minArea > 0 ? `${x.minArea.toLocaleString('en-IN')} m²` : '', x.minWidth > 0 ? `${m(x.minWidth)} wide` : ''].filter(Boolean).join(', '), worst: '' };
        cur.n += floors;
        if (!x.ok) { cur.bad += floors; if (!cur.worst) cur.worst = `${x.name} in a ${UNIT_LABEL[f.t] ?? 'flat'}: ${(Math.round(x.area * 10) / 10).toFixed(1)} m², ${m(x.width)} wide`; }
        by.set(k, cur);
      }
    }));
    for (const [k, v] of by) {
      if (!v.min) continue; // (no legal minimum for this room)
      add({ key: `room:${k}`, group: 'Flats & rooms', rule: `Room size: ${k}`, clause: r.code === 'udcpr' ? 'UDCPR 2020 9.4.1 (rooms and kitchens at the owner’s choice; bath 1.0 × 1.2 m, bath and WC 1.5 m² and 1.0 m wide)' : 'DCPR 2034 Reg. 37(2) Table 14 (habitable 2.4 m wide, kitchen 1.8 m, bath 1.5 m² / 1.1 m, bath and WC 2.2 m²)', required: `at least ${v.min}`, proposed: v.bad ? `${v.n - v.bad} of ${v.n} meet it` : `all ${v.n}`, status: v.bad ? 'fail' : 'pass', note: v.worst || undefined });
    }
  } else if (flats.length) {
    add({ key: 'rooms', group: 'Flats & rooms', rule: 'Room sizes', clause: `${code} Chapter 9`, required: 'every room at its minimum size and width', proposed: 'rooms not laid out', status: 'warn', note: 'Checked by flat until rooms are modelled.' });
  }
  add({ key: 'carpet', group: 'Flats & rooms', rule: 'Carpet area (RERA)', clause: 'RERA 2016 s.2(k)', required: 'declared per flat', proposed: `${Math.round(d.carpet * SQFT).toLocaleString('en-IN')} sq ft over ${d.count[0] + d.count[1] + d.count[2]} flats${d.count[3] ? ` and ${d.count[3]} other units` : ''}`, status: 'info' });
  return out;
}

/** "on the stilt and 2 basements" */
function levelsText(levels: { kind: string; bays: number[][] }[]): string {
  const n = new Map<string, number>();
  for (const l of levels) if (l.bays.length) n.set(l.kind, (n.get(l.kind) ?? 0) + 1);
  const parts = [...n].map(([k, c]) => (c > 1 ? `${c} ${k}s` : `the ${k}`));
  return parts.length ? ` on ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]}` : '';
}

export function scrutinySummary(c: Check[]): { pass: number; fail: number; warn: number; info: number } {
  const s = { pass: 0, fail: 0, warn: 0, info: 0 };
  for (const x of c) s[x.status]++;
  return s;
}
