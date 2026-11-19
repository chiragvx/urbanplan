// The deal the project is done under. In India most land isn't bought outright. It's taken under a joint development
// agreement (JDA), where the landowner gets a share of the revenue or of the flats, often with a refundable deposit.
// In Mumbai, a housing society is redeveloped: members get their flats back bigger, a corpus and rent while it's
// built, and the developer sells the rest. The scheme (src/doc/site.ts) prices the land as if bought. This
// re-runs its money under the deal, using the same monthly cash flow, so the IRR stays comparable.
// GST is what the buyer pays on top of the price for an under-construction flat (5%, or 1% if affordable). The
// developer collects it and passes it on, so it isn't revenue; it's shown so the buyer's all-in price is known.
// Stamp duty is the developer's: on the conveyance when land is bought, on the agreement under a JDA. All the rates
// are starting figures to replace with the project's own.
import { cashflow, SQFT } from '../doc/site';
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
}

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
  const base = cashflow(upfront, buildAll, revenue, c);
  const flow = [...base.flow];
  for (const t of tweaks) { const i = t.at === 'end' ? flow.length - 1 : Math.min(flow.length - 1, t.at); flow[i] += t.amount; }
  const s = summarise(flow);
  const extraOut = extraLines.reduce((a, x) => a + (x.kind === 'out' ? x.amount : 0), 0);
  const cost = upfront + buildAll + extraOut;
  const profit = revenue - cost;
  const saleCarpet = carpet - ownerCarpet;
  const gstCollected = revenue * (deal.gstPct / 100);

  const lines: DealResult['lines'] = [
    { label: deal.kind === 'outright' ? 'Sales' : 'Sales (developer\'s share)', amount: revenue, kind: 'in' },
    ...(land > 0 ? [{ label: 'Land', amount: land, kind: 'out' as const }] : []),
    { label: 'Premium FSI, TDR, ancillary', amount: fsiCost, kind: 'out' },
    { label: 'Construction', amount: M.build, kind: 'out' },
    { label: 'Parking levels', amount: M.parking, kind: 'out' },
    { label: 'Soft costs', amount: M.soft, kind: 'out' },
    { label: 'Stamp duty', amount: stampDuty, kind: 'out' },
    ...extraLines.filter((x) => x.amount > 0),
  ];
  notes.push(`GST of ${deal.gstPct}% (₹${(gstCollected / 1e7).toFixed(2)} cr) is paid by the buyers on top of the price and passed on: not revenue.`);
  return { revenue, cost, profit, margin: revenue > 0 ? profit / revenue : 0, irr: s.irr, peak: s.peak, flow: s.flow, cum: s.cum, saleCarpet, ownerCarpet, owner, lines, gstCollected, stampDuty, notes };
}
