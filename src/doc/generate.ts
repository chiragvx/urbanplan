// Generate: TestFit's generative design for a plot. Every shape at a range of depths and tower sizes, each parked
// two ways (stilt and basements; stilt, surface bays and basements), worked out in full and ranked by what you're
// after. Schemes that break a rule sink to the bottom, flagged with what they break.
//
// Pure: a plot report and the site as it stands in, schemes out. `generate` yields now and then so a page stays live.
import type { PlotReport } from './plot';
import { basementsToFit, presetBuildings, solveSite, type PlotSite, type Preset, type SiteReport } from './site';

export type Goal = 'profit' | 'flats' | 'carpet' | 'irr';
export const GOALS: { value: Goal; label: string; title: string }[] = [
  { value: 'profit', label: 'Profit', title: 'Most profit' },
  { value: 'irr', label: 'IRR', title: 'Best annual return on the cash put in' },
  { value: 'flats', label: 'Flats', title: 'Most flats' },
  { value: 'carpet', label: 'Carpet', title: 'Most saleable carpet area' },
];

export interface Scheme {
  name: string;
  site: PlotSite;
  d: SiteReport;
  /** the rules it breaks, by name (empty: it passes) */
  fails: string[];
}

/** The rules a laid-out site breaks. `strict` counts the fire tender's way and open space as well. */
export function failures(d: SiteReport, strict = true): string[] {
  const f: string[] = [];
  if (d.over.margins) f.push('Margins');
  if (d.over.overlap) f.push('Spacing');
  if (d.over.fsi) f.push('FSI');
  if (d.over.height) f.push('Height');
  if (d.parking.have < d.parking.need) f.push('Parking');
  if (strict && d.over.fire) f.push('Fire access');
  if (strict && d.over.open) f.push('Open space');
  return f;
}

const score = (d: SiteReport, g: Goal) => (g === 'profit' ? d.money.profit : g === 'flats' ? d.flats : g === 'carpet' ? d.carpet : d.money.irr ?? -1);

/** The schemes to try: shapes, depths, tower sizes. */
function shapes(r: PlotReport): { name: string; build: () => ReturnType<typeof presetBuildings> }[] {
  const out: { name: string; build: () => ReturnType<typeof presetBuildings> }[] = [];
  const NAME: Record<Preset, string> = { bar: 'Bar', L: 'L', U: 'U', court: 'Court', tower: 'Tower', twin: 'Twin towers' };
  for (const s of ['bar', 'L', 'U', 'court'] as Preset[]) for (const depth of [12, 14, 16, 18, 20]) out.push({ name: `${NAME[s]} · ${depth} m deep`, build: () => presetBuildings(r, s, depth) });
  for (const s of ['tower', 'twin'] as Preset[]) for (const [depth, len] of [[16, 20], [20, 24], [20, 30], [24, 30]]) out.push({ name: `${NAME[s]} · ${len} × ${depth} m`, build: () => presetBuildings(r, s, depth, len) });
  return out;
}

/** Work out the schemes for a plot and rank them, best first. */
export async function generate(r: PlotReport, base: PlotSite, use: 'residential' | 'commercial', goal: Goal, strict: boolean, progress?: (done: number, of: number) => void): Promise<Scheme[]> {
  const list = shapes(r), seen = new Set<string>(), out: Scheme[] = [];
  let done = 0;
  for (const s of list) {
    const buildings = s.build();
    // shapes that don't fit fall back to a bar: count each layout once
    const key = JSON.stringify(buildings.map((b) => [b.spine.map((v) => Math.round(v)), b.depth, !!b.closed]));
    if (buildings.length && !seen.has(key)) {
      seen.add(key);
      let plain = Infinity;
      for (const surface of [false, true]) {
        const site: PlotSite = { ...base, buildings, stilt: true, podium: 0, surface: surface || undefined };
        site.basements = basementsToFit(r, site, use);
        // surface bays are worth it only when they save a basement
        if (surface && site.basements >= plain) continue;
        plain = site.basements;
        const d = solveSite(r, site, use);
        if (d.flats) out.push({ name: `${s.name}${surface ? ' · surface parking' : ''}`, site, d, fails: failures(d, strict) });
      }
    }
    progress?.(++done, list.length);
    if (done % 3 === 0) await new Promise((res) => setTimeout(res, 0));
  }
  // passing schemes first, then by the goal; two schemes giving the same numbers count once (keep the simpler one)
  out.sort((a, b) => (a.fails.length > 0 ? 1 : 0) - (b.fails.length > 0 ? 1 : 0) || score(b.d, goal) - score(a.d, goal) || a.site.basements - b.site.basements);
  const same = new Set<string>();
  return out.filter((x) => { const k = `${x.d.flats}|${Math.round(x.d.money.profit / 1e5)}|${x.site.basements}|${!!x.site.surface}`; if (same.has(k)) return false; same.add(k); return true; });
}
