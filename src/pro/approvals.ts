// The building permission, set up from the scheme: the NOCs it needs (and why), the documents that go with the
// application (and who produces each: the owner, the architect, the authority, or us), and a rough estimate of the
// fees and charges paid before the permission is issued. Maharashtra first (BPMS under UDCPR 2020, AutoDCR in
// Mumbai under DCPR 2034). The figures are rough and as assumed: authorities set their own rates and revise them,
// so treat them as a budget line and check with your architect.
import { FIRE_H, SQFT } from '../doc/site';
import type { Evaluated } from './evaluate';

export interface NocItem { key: string; title: string; authority: string; why: string; needed: boolean }
export interface DocItem { title: string; note: string; from: 'us' | 'owner' | 'architect' | 'authority' }
export interface Fee { label: string; amount: number; basis: string }

const EC_FROM = 20000;

/** What is being asked for: a new building on open land, a redevelopment (an existing building pulled down, often a
 *  society's), revised plans for a permission already granted, or more floors / a wing on a standing building. */
export type PermissionKind = 'new' | 'redevelopment' | 'revised' | 'addition';
export const PERMISSION_LABEL: Record<PermissionKind, string> = { new: 'New building', redevelopment: 'Redevelopment', revised: 'Revised plans', addition: 'Additions' };
export const PERMISSION_HINT: Record<PermissionKind, string> = {
  new: 'A building on open land.',
  redevelopment: "An existing building pulled down and rebuilt, often a housing society's.",
  revised: 'Changes to plans already approved, before the occupancy certificate.',
  addition: 'More floors or a wing on a building that stands.',
};
export const permissionOf = (e: Evaluated, kind?: PermissionKind): PermissionKind => kind ?? (e.p.deal?.kind === 'redevelopment' ? 'redevelopment' : 'new');

/** The permission's stages, in order: what the authority issues, and when. */
export function stages(e: Evaluated, kind: PermissionKind): { title: string; note: string }[] {
  const mumbai = e.r.code !== 'udcpr';
  const list = [
    ...(kind === 'redevelopment' ? [{ title: 'Demolition permission', note: 'For the standing building, once the occupants have moved out.' }] : []),
    mumbai
      ? { title: kind === 'revised' ? 'Amended plans approval' : 'Intimation of Disapproval (IOD)', note: kind === 'revised' ? 'The changed plans, against the IOD and CC already issued.' : 'The plans approved, with the conditions to meet before work starts.' }
      : { title: kind === 'revised' ? 'Revised building permission' : 'Building permission', note: kind === 'revised' ? 'The changed plans, against the permission already granted.' : 'The plans approved under UDCPR, through BPMS.' },
    { title: 'Commencement certificate (CC)', note: mumbai ? 'Up to the plinth first, then further CCs floor by floor.' : 'Work may start; valid for a year, renewable.' },
    { title: 'Plinth checking', note: 'The plinth inspected against the plans before going up.' },
    { title: 'Occupancy certificate (OC)', note: 'After the completion notice, the fire NOC (final) and the structural certificate.' },
  ];
  if (kind === 'addition') list.unshift({ title: 'Structural audit', note: 'That the standing building can take the new floors.' });
  return list;
}

/** The NOCs and clearances the scheme triggers. `extra` covers what the plot doesn't tell us yet. */
export function nocs(e: Evaluated, extra: { nearAirport?: boolean; trees?: boolean; heritage?: boolean; kind?: PermissionKind } = {}): NocItem[] {
  const { r, d } = e, H = d.height, mumbai = r.code !== 'udcpr', kind = permissionOf(e, extra.kind);
  return [
    ...(kind === 'redevelopment' ? [{ key: 'tenants', title: "Occupants' and tenants' consent", authority: mumbai ? 'MHADA or the Corporation, by the scheme' : 'The Corporation', why: "A redevelopment needs the occupants' consent, at the share its scheme asks.", needed: true }] : []),
    { key: 'fire', title: 'Fire NOC (provisional, then final)', authority: 'Chief Fire Officer of the corporation', why: H > FIRE_H ? `The building is ${H.toFixed(1)} m tall, over ${FIRE_H} m.` : `Not needed up to ${FIRE_H} m (as assumed).`, needed: H > FIRE_H },
    { key: 'aai', title: 'Height clearance (NOCAS)', authority: 'Airports Authority of India', why: extra.nearAirport ? 'The plot is in an airport\'s colour-coded zone: the height needs clearing.' : 'Needed in an airport\'s colour-coded zoning map; check the plot on the AAI NOCAS site.', needed: !!extra.nearAirport },
    { key: 'ec', title: 'Environment clearance', authority: 'State Environment Impact Assessment Authority (SEIAA)', why: d.bua >= EC_FROM ? `Built-up area ${Math.round(d.bua).toLocaleString('en-IN')} m², from ${EC_FROM.toLocaleString('en-IN')} m².` : `Under ${EC_FROM.toLocaleString('en-IN')} m² of built-up area.`, needed: d.bua >= EC_FROM },
    { key: 'trees', title: 'Tree cutting or transplanting permission', authority: 'Tree Authority of the corporation', why: extra.trees ? 'Trees on the plot come in the way of the scheme.' : 'Only if trees on the plot have to go.', needed: !!extra.trees },
    { key: 'heritage', title: 'Heritage committee NOC', authority: mumbai ? 'Mumbai Heritage Conservation Committee' : 'Heritage Conservation Committee', why: extra.heritage ? 'The plot is in or next to a heritage precinct.' : 'Only in or next to a listed heritage precinct.', needed: !!extra.heritage },
    { key: 'water', title: 'Water supply and drainage', authority: 'Corporation water and drainage departments', why: 'Connection capacity for the flats; usually remarks with the plans.', needed: true },
    { key: 'roads', title: 'Road and DP remarks', authority: 'Town planning / roads department', why: r.lost > 0.5 ? `The DP widens the road: ${Math.round(r.lost)} m² to hand over.` : 'The DP remark confirms the zone and the road widths.', needed: true },
    { key: 'lift', title: 'Lift licence', authority: 'Lift inspector (PWD / electrical inspectorate)', why: H > 15 ? 'The building has lifts (over 15 m).' : 'Only if lifts are put in.', needed: H > 15 },
  ];
}

/** What goes with the building permission application. */
export function documents(e: Evaluated, kind: PermissionKind = 'new'): DocItem[] {
  const { r, d } = e, mumbai = r.code !== 'udcpr';
  const list: DocItem[] = [
    { title: 'Application form (Appendix / Form A)', note: 'Filled in from the project: we prefill the plot, the areas and the use.', from: 'us' },
    { title: mumbai ? 'Property card (city survey record)' : '7/12 extract or property card', note: 'Ownership, the survey or CTS number and its area: not older than 3–6 months.', from: 'owner' },
    { title: 'Title search report', note: 'An advocate\'s search of the title for 30 years.', from: 'owner' },
    { title: 'Measurement / demarcation plan', note: 'From the land records department (TILR), with the plot\'s boundaries.', from: 'authority' },
    { title: 'DP remark / zone certificate', note: 'The zone, reservations and road widths in the Development Plan.', from: 'authority' },
    { title: 'Drawings set', note: 'Site plan, floor plans, section and elevation, with the title block (see the drawings).', from: 'us' },
    { title: 'Area statement', note: 'Plot, deductions, FSI by source, built-up area by floor, carpet and parking.', from: 'us' },
    { title: mumbai ? 'PreDCR drawing file (AutoDCR)' : 'PreDCR drawing file (BPMS)', note: 'The DXF with PreDCR\'s layers; open and finish it in PreDCR before upload.', from: 'us' },
    { title: 'Our scrutiny report', note: 'Every rule checked, with its clause: advisory, before the authority\'s own.', from: 'us' },
    { title: 'Structural stability certificate', note: 'From a licensed structural engineer.', from: 'architect' },
    { title: 'Architect\'s appointment and licence', note: 'The architect who signs the plans and submits.', from: 'architect' },
    { title: 'Site photographs', note: 'Of the plot as it stands.', from: 'owner' },
    { title: 'Indemnity and undertakings', note: 'On stamp paper, in the authority\'s formats.', from: 'owner' },
  ];
  if (kind === 'redevelopment') list.push(
    { title: 'Approved plans of the standing building', note: 'Or proof that it stood before the cut-off date, for its built-up area.', from: 'owner' },
    { title: "Society's resolution and consent", note: "The general body's resolution and the members' consent (Section 79A directions, for a housing society).", from: 'owner' },
    { title: 'Structural audit of the standing building', note: 'From a licensed structural engineer, if it is being called unsafe.', from: 'architect' },
    { title: 'Rehab and sale area statement', note: "Each member's existing and new carpet, and what is left for sale.", from: 'us' },
  );
  if (kind === 'revised') list.push(
    { title: 'The permission and plans already approved', note: 'The building permission or IOD, and the CC issued so far.', from: 'owner' },
    { title: 'Statement of the changes', note: 'What changed from the approved plans, floor by floor.', from: 'us' },
  );
  if (kind === 'addition') list.push(
    { title: 'Approved plans and OC of the standing building', note: 'The building the floors go on.', from: 'owner' },
    { title: 'Structural stability certificate for the additions', note: 'That the foundations and frame take the extra floors.', from: 'architect' },
    { title: "Occupants' consent", note: 'Of the flat owners, where the building is already sold.', from: 'owner' },
  );
  if (r.lost > 0.5) list.push({ title: 'Road widening handover', note: 'The strip in the DP road line, handed over for the FSI credit.', from: 'owner' });
  if (d.height > FIRE_H) list.push({ title: 'Fire NOC (provisional)', note: 'Over 15 m.', from: 'authority' });
  if (d.bua >= EC_FROM) list.push({ title: 'Environment clearance', note: 'SEIAA, from 20,000 m² of built-up area.', from: 'authority' });
  return list;
}

/** Fees and charges paid before the permission, roughly. Premium, TDR and ancillary come from the scheme's own money. */
export function fees(e: Evaluated): Fee[] {
  const { d } = e, M = d.money, c = M.costs, bua = d.bua, ft = bua * SQFT;
  // UDCPR 2.2.12: ₹5 per m² in Pune, Pimpri-Chinchwad, Nagpur, Nashik and the MMR corporations; MCGM sets its own
  const scrutinyRate = 5;
  const dcPct = 2; // development charges (UDCPR 2.2.13, MRTP Act s.124A): the rate is the Act's; 2 % of ASR as assumed
  const list: Fee[] = [
    { label: 'Scrutiny fee', amount: bua * scrutinyRate, basis: e.r.code === 'udcpr' ? `₹${scrutinyRate} per m² of built-up area (UDCPR 2.2.12, A-class corporations)` : `₹${scrutinyRate} per m² of built-up area (rough: MCGM sets its own)` },
    { label: 'Development charges', amount: ft * c.asr * dcPct / 100, basis: `${dcPct}% of the ASR rate (₹${c.asr.toLocaleString('en-IN')}/sq ft) on ${Math.round(ft).toLocaleString('en-IN')} sq ft (MRTP Act s.124A; the 2 % as assumed)` },
    { label: 'Premium FSI', amount: M.premium, basis: `${c.premiumPct}% of the ASR rate on the premium FSI used` },
    { label: 'TDR (bought)', amount: M.tdr, basis: `${c.tdrPct}% of the ASR rate on the TDR loaded (market rates vary)` },
    { label: e.r.code === 'udcpr' ? 'Ancillary FSI premium' : 'Fungible FSI premium', amount: M.ancillary, basis: `${c.ancillaryPct}% of the ASR rate on it` },
    { label: 'Labour welfare cess', amount: M.build * 0.01, basis: '1% of construction cost (BOCW Cess Act)' },
    { label: 'Security deposit', amount: bua * 25, basis: '₹25 per m² of built-up area, refundable (rough)' },
  ];
  if (e.r.code !== 'udcpr') {
    // Mumbai Fire Brigade circular 155 (28 Mar 2018), for 2018-19: ₹48 / m² of gross built-up area from 24 m (at least
    // ₹2.4 lakh a building), ₹27 / m² below (at least ₹1.35 lakh). Revised yearly: check the current schedule.
    const high = d.height >= 24, rate = high ? 48 : 27, floor = high ? 240000 : 135000;
    const n = Math.max(1, d.buildings.length), amount = d.buildings.length ? d.buildings.reduce((sum, b) => sum + Math.max(floor, (bua / n) * rate), 0) : 0;
    list.push({ label: 'Fire scrutiny fee (MFB)', amount, basis: `₹${rate} per m² of built-up area, at least ₹${(floor / 1e5).toFixed(2)} lakh a building (MFB circular 155, 2018-19 rates)` });
  } else if (d.height > FIRE_H) list.push({ label: 'Fire service fee', amount: bua * 30, basis: '₹30 per m² of built-up area, over 15 m (rough: the Government sets it, UDCPR 2.2.14)' });
  return list.filter((f) => f.amount > 0);
}
