// The deal the project is done under. In India most land isn't bought outright. It's taken under a joint development
// agreement (JDA), where the landowner gets a share of the revenue or of the flats, often with a refundable deposit.
// In Mumbai, a housing society is redeveloped: members get their flats back bigger, a corpus and rent while it's
// built, and the developer sells the rest. The scheme (src/doc/site.ts) prices the land as if bought. This
// re-runs its money under the deal, using the same monthly cash flow, so the IRR stays comparable.
// GST is what the buyer pays on top of the price for an under-construction flat (5%, or 1% if affordable). The
// developer collects it and passes it on, so it isn't revenue; it's shown so the buyer's all-in price is known.
// Stamp duty is the developer's: on the conveyance when land is bought, on the agreement under a JDA. All the rates
// are starting figures to replace with the project's own.
import { cashflow, FLOOR_USE, LEASE_UP, SQFT, type UseLine } from '../doc/site';
import type { Evaluated } from './evaluate';

export type DealKind = 'outright' | 'jda-revenue' | 'jda-area' | 'redevelopment';
export interface Deal {
  kind: DealKind;
  /** JDA: the landowner's share (% of revenue, or % of the saleable carpet handed over) */
  ownerShare: number;
  /** JDA: refundable deposit to the landowner (₹ crore), paid at the start and returned at the end */
  deposit: number;
  /** redevelopment: members (existing flats), their existing carpet each (m²), the extra carpet they get (%), corpus per member (₹ lakh), rent per member per month (₹) while it's built */
  members: number; existingCarpet: number; extraPct: number; corpus: number; rent: number;
  /** GST on under-construction sales (5% residential, 1% affordable): shown to the buyer, not revenue; and stamp duty on the land (% of land cost; for JDA on the agreement) */
  gstPct: number; stampPct: number;
}

export const DEFAULT_DEAL: Deal = {
  kind: 'outright', ownerShare: 35, deposit: 1, members: 24, existingCarpet: 45, extraPct: 35, corpus: 10, rent: 25000, gstPct: 5, stampPct: 6,
};

export const DEAL_LABEL: Record<DealKind, string> = {
  outright: 'Land bought outright',
  'jda-revenue': 'Joint development: revenue share',
  'jda-area': 'Joint development: area share',
  redevelopment: 'Society redevelopment',
};

export interface DealResult {
  /** developer's view */
  revenue: number; cost: number; profit: number; margin: number; irr: number | null; peak: number; flow: number[]; cum: number[];
  /** carpet: sold, handed to the owner / members (m²) */
  saleCarpet: number; ownerCarpet: number;
  owner: { label: string; value: number; note: string };
  lines: { label: string; amount: number; kind: 'in' | 'out' }[];
  gstCollected: number; stampDuty: number;
  notes: string[];
  /** whether anything earns: a scheme of public buildings only costs, so it has no profit or IRR to show */
  earns: boolean;
  /** by use, when there's more than one (homes sold, offices let…): what each brings in (the developer's share) or,
   *  for a public use, what it costs to build */
  uses: { label: string; amount: number; note: string; kind: 'in' | 'out' }[];
}

export const USE_LABEL: Record<UseLine['use'], string> = { residential: 'Homes', office: 'Offices', retail: 'Shops', hotel: 'Hotel', library: 'Library', toilet: 'Public toilet', community: 'Community hall', school: 'School', clinic: 'Clinic', parking: 'Parking floors' };

/** Annual internal rate of return of monthly flows, by bisection; null when there isn't one (as in site.ts). */
export function irr(flow: number[]): number | null {
  const npv = (m: number) => flow.reduce((s, f, t) => s + f / (1 + m) ** t, 0);
  let lo = -0.9, hi = 1;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let k = 0; k < 80; k++) { const mid = (lo + hi) / 2; if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid; }
  return (1 + (lo + hi) / 2) ** 12 - 1;
}

const summarise = (flow: number[]) => {
  const cum: number[] = [];
  let run = 0;
  for (const f of flow) { run += f; cum.push(run); }
  return { flow, cum, irr: irr(flow), peak: -Math.min(0, ...cum) };
};

export function applyDeal(e: Evaluated, deal: Deal): DealResult {
  const M = e.d.money, c = M.costs;
  const shopCarpet = e.shops?.carpet ?? 0;
  const carpet = e.d.carpet + shopCarpet;
  // the buyers' price: the scheme's revenue spread over every saleable m² (flats and shops at their own rates)
  const perM2 = carpet > 0 ? M.revenue / carpet : 0;
  const fsiCost = M.premium + M.tdr + M.ancillary;
  const buildAll = M.build + M.parking + M.soft;
  const notes: string[] = [];
  let land = M.land, revenue = M.revenue, ownerCarpet = 0;
  let owner = { label: 'Landowner', value: M.land, note: 'Paid for the land at the start.' };
  const extraLines: DealResult['lines'] = [];
  // flow tweaks applied after the base cash flow: [month, amount] (+ in, − out); 'end' is the last month
  const tweaks: { at: number | 'end'; amount: number }[] = [];

  if (deal.kind === 'outright') {
    // (as the scheme has it)
  } else if (deal.kind === 'jda-revenue') {
    land = 0;
    const ownerTake = M.revenue * (deal.ownerShare / 100);
    revenue = M.revenue - ownerTake;
    const dep = deal.deposit * 1e7;
    if (dep > 0) { tweaks.push({ at: 0, amount: -dep }, { at: 'end', amount: dep }); extraLines.push({ label: 'Refundable deposit (out, then back)', amount: 0, kind: 'out' }); }
    owner = { label: 'Landowner', value: ownerTake, note: `${deal.ownerShare}% of the revenue as it comes in${dep > 0 ? `, plus a ₹${(dep / 1e7).toFixed(2)} cr deposit returned at the end` : ''}.` };
    notes.push('No land bought: the landowner is paid out of the sales as they come in.');
  } else if (deal.kind === 'jda-area') {
    land = 0;
    ownerCarpet = carpet * (deal.ownerShare / 100);
    revenue = M.revenue * (1 - deal.ownerShare / 100);
    const dep = deal.deposit * 1e7;
    if (dep > 0) tweaks.push({ at: 0, amount: -dep }, { at: 'end', amount: dep });
    owner = { label: 'Landowner', value: ownerCarpet * perM2, note: `${deal.ownerShare}% of the carpet, ${Math.round(ownerCarpet * SQFT).toLocaleString('en-IN')} sq ft, handed over built (worth it at the scheme's prices).` };
    notes.push('No land bought: the landowner takes flats instead, so the developer sells less.');
  } else {
    // redevelopment: the members' flats come back bigger and aren't sold; corpus up front, rent through the build
    land = 0;
    ownerCarpet = Math.min(carpet, deal.members * deal.existingCarpet * (1 + deal.extraPct / 100));
    revenue = carpet > 0 ? M.revenue * (1 - ownerCarpet / carpet) : 0;
    const corpus = deal.members * deal.corpus * 1e5;
    const months = Math.max(6, Math.round(c.months));
    const rent = deal.members * deal.rent;
    tweaks.push({ at: 0, amount: -corpus });
    for (let t = 1; t <= months; t++) tweaks.push({ at: t, amount: -rent });
    extraLines.push({ label: 'Corpus to members', amount: corpus, kind: 'out' }, { label: `Rent for members (${months} months)`, amount: rent * months, kind: 'out' });
    owner = { label: 'Members', value: ownerCarpet * perM2 + corpus + rent * months, note: `${deal.members} flats of ${deal.existingCarpet} m² back as ${Math.round(deal.existingCarpet * (1 + deal.extraPct / 100))} m², a ₹${deal.corpus} lakh corpus each and ₹${deal.rent.toLocaleString('en-IN')} a month rent while it's built.` };
    if (ownerCarpet >= carpet) notes.push('The members\' flats take all the carpet: nothing left to sell.');
    notes.push('No land bought: the society\'s land is redeveloped. Existing buildings\' demolition is not costed.');
  }

  // stamp duty: on the land bought, or on the JDA / development agreement (taken on the owner's share's value)
  const stampBase = deal.kind === 'outright' ? M.land : owner.value;
  const stampDuty = stampBase * (deal.stampPct / 100);
  const upfront = land + fsiCost + stampDuty;
  // (the deal's share of the revenue, split as the scheme's is: sales as they're booked, the let and run buildings'
  // value once they're leased up)
  const k = M.revenue > 0 ? revenue / M.revenue : 0;
  const base = cashflow(upfront, buildAll, M.sales * k, c, M.exit * k);
  const flow = [...base.flow];
  for (const t of tweaks) { const i = t.at === 'end' ? flow.length - 1 : Math.min(flow.length - 1, t.at); flow[i] += t.amount; }
  const s = summarise(flow);
  const extraOut = extraLines.reduce((a, x) => a + (x.kind === 'out' ? x.amount : 0), 0);
  const cost = upfront + buildAll + extraOut;
  const profit = revenue - cost;
  const saleCarpet = carpet - ownerCarpet;
  const gstCollected = revenue * (deal.gstPct / 100);

  // by use, when the scheme has more than one: what each earns at the deal's share, or what a public one costs
  const earns = M.earns !== false && M.revenue > 0;
  const sqft = (v: number) => `${Math.round(v * SQFT).toLocaleString('en-IN')} sq ft`;
  const uses: DealResult['uses'] = (M.uses ?? []).length > 1 ? M.uses.map((x) => x.earns === 'public'
    ? { label: USE_LABEL[x.use], amount: x.area * FLOOR_USE[x.use].build * SQFT * c.build, note: `${x.floors} floor${x.floors === 1 ? '' : 's'}, ${Math.round(x.area).toLocaleString('en-IN')} m²: built for its cost`, kind: 'out' as const }
    : { label: USE_LABEL[x.use], amount: x.value * k, note: x.earns === 'sale' ? `${sqft(x.carpet)} sold` : x.earns === 'lease' ? `${sqft(x.carpet)} let, valued at a ${c.officeYield}% yield` : `${sqft(x.carpet)} run, valued at a ${c.hotelYield}% yield on its operating profit`, kind: 'in' as const }) : [];
  // (a scheme that only costs shows its construction, its systems and its fees apart)
  const sys = Math.min(M.build, e.sys?.cost ?? 0);
  const earned = uses.filter((x) => x.kind === 'in');
  const lines: DealResult['lines'] = [
    ...(earned.length > 1 ? earned.map((x) => ({ label: x.label, amount: x.amount, kind: 'in' as const }))
      : earns ? [{ label: `${M.sales > 0 ? 'Sales' : 'Value at its yield (let or run)'}${deal.kind === 'outright' ? '' : ' (developer\'s share)'}`, amount: revenue, kind: 'in' as const }] : []),
    ...(land > 0 ? [{ label: 'Land', amount: land, kind: 'out' as const }] : []),
    { label: 'Premium FSI, TDR, ancillary', amount: fsiCost, kind: 'out' },
    ...(earns ? [{ label: 'Construction', amount: M.build, kind: 'out' as const }]
      : [{ label: 'Construction', amount: M.build - sys, kind: 'out' as const }, { label: 'Building systems', amount: sys, kind: 'out' as const }]),
    { label: 'Parking levels', amount: M.parking, kind: 'out' },
    { label: earns ? 'Soft costs' : 'Fees, consultants, approvals', amount: M.soft, kind: 'out' },
    { label: 'Stamp duty', amount: stampDuty, kind: 'out' },
    ...extraLines.filter((x) => x.amount > 0),
  ];
  if (earns) notes.push(`GST of ${deal.gstPct}% (₹${(gstCollected / 1e7).toFixed(2)} cr) is paid by the buyers on top of the price and passed on: not revenue.`);
  else notes.push('Public buildings only: nothing is sold or let, so this is what it costs to build, not a profit.');
  if (M.exit > 0) notes.push(`Offices and hotels are let or run, not sold: valued at their yields once leased up, ${LEASE_UP} months after completion, as if sold on or refinanced then.`);
  return { revenue, cost, profit, margin: revenue > 0 ? profit / revenue : 0, irr: earns ? s.irr : null, peak: s.peak, flow: s.flow, cum: s.cum, saleCarpet, ownerCarpet, owner, lines, gstCollected, stampDuty, notes, earns, uses };
}

/** What the land is worth to this scheme: the most that can be paid for it and still make the target (a margin on
 *  revenue, or an IRR), bought outright; and under a joint development, the largest share of the revenue the
 *  landowner can be given. Solved by bisection on applyDeal, so the stamp duty, the cash flow's timing and the FSI
 *  bought all count. null: the target isn't made even with the land free (or the owner given nothing). */
export function landWorth(e: Evaluated, deal: Deal, target: { by: 'margin' | 'irr'; v: number }): { outright: number | null; share: number | null } {
  const M = e.d.money;
  const meets = (x: DealResult) => (target.by === 'margin' ? x.margin : x.irr ?? -Infinity) >= target.v;
  if (!(M.revenue > 0) || M.earns === false) return { outright: null, share: null };
  // outright: the land's price (₹), from nothing up to the whole revenue
  const at = (land: number) => applyDeal({ ...e, d: { ...e.d, money: { ...M, land } } }, { ...deal, kind: 'outright' });
  let outright: number | null = null;
  if (meets(at(0))) {
    let lo = 0, hi = M.revenue;
    for (let k = 0; k < 40 && hi - lo > 1e4; k++) { const mid = (lo + hi) / 2; if (meets(at(mid))) lo = mid; else hi = mid; }
    outright = lo;
  }
  // a joint development on a revenue share: the owner's %, 0 to 95
  const js = (s: number) => applyDeal(e, { ...deal, kind: 'jda-revenue', ownerShare: s, deposit: deal.kind === 'jda-revenue' || deal.kind === 'jda-area' ? deal.deposit : 0 });
  let share: number | null = null;
  if (meets(js(0))) {
    let lo = 0, hi = 95;
    for (let k = 0; k < 30 && hi - lo > 0.05; k++) { const mid = (lo + hi) / 2; if (meets(js(mid))) lo = mid; else hi = mid; }
    share = lo;
  }
  return { outright, share };
}
