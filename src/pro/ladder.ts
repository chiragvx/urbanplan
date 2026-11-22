// The FSI ladder: what the plot can build, part by part, and what each part costs and earns. Basic FSI comes with
// the plot. On top of it a developer may pay the authority for premium FSI, buy TDR in the market, and pay for the
// ancillary (UDCPR) or fungible (DCPR) share. Whether each is worth it is the main question of a feasibility in
// Maharashtra, so each is a step to take or leave (ProProject.load), with its area, its cost and what it adds to the
// profit (worked out by evaluating the project with and without it).
import { defaultCosts, SQFT } from '../doc/site';
import { applyDeal, DEFAULT_DEAL } from './deal';
import { evaluate, type Evaluated } from './evaluate';
import { loadOf, type Load, type ProProject } from './project';

export type RungKey = 'basic' | 'credit' | keyof Load;
export interface Rung {
  key: RungKey;
  label: string;
  /** what it is, in a line */
  sub: string;
  /** built-up area it permits (m²), as the rules permit it, taken or not */
  area: number;
  /** the FSI it adds (as a multiple of the plot), or the ancillary share */
  fsi: string;
  taken: boolean;
  /** basic and the DP road's credit come with the plot: they can't be left */
  fixed: boolean;
  /** what it costs, ₹ per sq ft of floor space, and in all if it's all used (0: free) */
  rate: number; cost: number;
}

/** The ladder's rungs for an evaluated project (areas from `e.full`, so a part not taken still shows what it'd give). */
export function ladder(e: Evaluated): Rung[] {
  const F = e.full, R = F.rules, ld = loadOf(e.p), c = defaultCosts(F.code, 'residential');
  const anc = F.code === 'udcpr' ? 'Ancillary' : 'Fungible';
  const rate = (pct: number) => Math.round((c.asr * pct) / 100);
  const out: Rung[] = [
    { key: 'basic', label: 'Basic FSI', sub: 'On the net plot. Comes with the land.', area: F.parts.basic, fsi: R.basic.toFixed(2), taken: true, fixed: true, rate: 0, cost: 0 },
  ];
  if (F.parts.credit > 0) out.push({ key: 'credit', label: 'DP road handed over', sub: 'The FSI of the strip given up for the road.', area: F.parts.credit, fsi: '', taken: true, fixed: true, rate: 0, cost: 0 });
  out.push(
    { key: 'premium', label: 'Premium FSI', sub: `Paid to the authority: ${c.premiumPct}% of the ready reckoner rate.`, area: F.parts.premium, fsi: R.premium.toFixed(2), taken: ld.premium, fixed: false, rate: rate(c.premiumPct), cost: F.parts.premium * SQFT * rate(c.premiumPct) },
    { key: 'tdr', label: 'TDR', sub: `Bought in the market: about ${c.tdrPct}% of the ready reckoner rate.`, area: F.parts.tdr, fsi: R.tdr.toFixed(2), taken: ld.tdr, fixed: false, rate: rate(c.tdrPct), cost: F.parts.tdr * SQFT * rate(c.tdrPct) },
  );
  // (ancillary is a share of what's taken below it: shown at what it would be with the rungs as they're set)
  const below = F.parts.basic + F.parts.credit + (ld.premium ? F.parts.premium : 0) + (ld.tdr ? F.parts.tdr : 0);
  const ancArea = below * R.ancillary;
  out.push({ key: 'ancillary', label: `${anc} FSI`, sub: `${Math.round(R.ancillary * 100)}% of what's taken below it${c.ancillaryPct ? `, paid at ${c.ancillaryPct}% of the ready reckoner rate` : ', no charge'}.`, area: ancArea, fsi: `${Math.round(R.ancillary * 100)}%`, taken: ld.ancillary, fixed: false, rate: rate(c.ancillaryPct), cost: ancArea * SQFT * rate(c.ancillaryPct) });
  return out.filter((x) => x.fixed || x.area > 0.5);
}

/** What each part the ladder can take or leave adds to the profit, under the project's deal: the profit with it
 *  taken less the profit without, the rest of the ladder as it is. One evaluation per part, so it's worked out a part
 *  at a time (`each` is called as each is known) and can be stopped. */
export function ladderGains(p: ProProject, each: (k: keyof Load, gain: number) => void): () => void {
  const deal = p.deal ?? DEFAULT_DEAL, ld = loadOf(p);
  const profit = (q: ProProject) => applyDeal(evaluate(q), deal).profit;
  let stop = false, base: number | null = null;
  const keys: (keyof Load)[] = ['premium', 'tdr', 'ancillary'];
  const step = (i: number) => {
    if (stop || i >= keys.length) return;
    const k = keys[i];
    base ??= profit(p);
    const other = profit({ ...p, load: { ...ld, [k]: !ld[k] } });
    each(k, ld[k] ? base - other : other - base);
    setTimeout(() => step(i + 1), 0);
  };
  const t = setTimeout(() => step(0), 30);
  return () => { stop = true; clearTimeout(t); };
}
