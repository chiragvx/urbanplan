// Sites: every plot looked at, above the projects (docs/plans/pro-global-ux.md §A.4, Phase 7). Each is a quick line,
// a rectangle by its frontage and depth (or an area) on a road, with a status in the buying pipeline. Each gets the
// quick figures a land head asks first, under the firm's default prices:
// - the potential (the built-up the FSI ladder allows);
// - the saleable carpet the best scheme gives;
// - the most the land is worth, outright and as a joint-development share, for the target margin or IRR.
// The list is ranked by what the land is worth. "Open as a project" starts a project at the Looking stage, with the
// plot and road set. Kept in this browser for now (like design systems); Supabase later.
import { evaluate } from './evaluate';
import { applyDeal, DEFAULT_DEAL, landWorth } from './deal';
import { ladder } from './ladder';
import { parseScreen } from './screen';
import { DEFAULT_PROJECT, DEFAULT_TARGET, type ProCity, type ProProject } from './project';
import { SQFT } from '../doc/site';

export type SiteStatus = 'lead' | 'looking' | 'offered' | 'bought' | 'dropped';
export const STATUSES: { value: SiteStatus; label: string }[] = [
  { value: 'lead', label: 'Lead' },
  { value: 'looking', label: 'Looking' },
  { value: 'offered', label: 'Offered' },
  { value: 'bought', label: 'Bought' },
  { value: 'dropped', label: 'Dropped' },
];

export interface Site {
  id: string; name: string;
  /** frontage and depth (m): a rectangle on the road */
  width: number; depth: number;
  /** the road in front, today and in the Development Plan (m; 0: none wider) */
  road: number; dp: number;
  /** what's asked for the land, ₹ per sq ft of plot (unset: not known) */
  asking?: number;
  status: SiteStatus;
  note?: string;
  /** when it was added (ISO) */
  added: string;
  /** opened as a project (ISO), once */
  opened?: string;
  /** its figures as last worked out, and what they were worked out from (figKey) */
  fig?: { k: string; f: SiteFigures };
}

/** the firm's default prices: the rules, the sale price, and the target the land is worth is worked out for */
export interface SitePrices { city: ProCity; sale: number; target: { by: 'margin' | 'irr'; v: number } }
export const DEFAULT_PRICES: SitePrices = { city: 'pune', sale: 0, target: DEFAULT_TARGET };

export interface SiteFigures {
  /** plot (m²); the built-up the ladder allows (m²); what the best scheme builds (m²) and sells (carpet, m²); its homes */
  area: number; potential: number; bua: number; saleable: number; homes: number;
  revenue: number; profit: number; margin: number;
  /** the most to pay outright (₹), and that per sq ft of plot; the largest revenue share to an owner (%); null: none */
  worth: number | null; worthRate: number | null; share: number | null;
}

// ---------------- kept in this browser ----------------

const KEY = 'urbanplan:sites', PRICES = 'urbanplan:sites:prices';
const read = <T,>(k: string, d: T): T => { try { const v = JSON.parse(localStorage.getItem(k) ?? 'null'); return v ?? d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or blocked */ } };
export const listSites = (): Site[] => read<Site[]>(KEY, []);
export const saveSites = (s: Site[]) => write(KEY, s);
export const sitePrices = (): SitePrices => ({ ...DEFAULT_PRICES, ...read<Partial<SitePrices>>(PRICES, {}) });
export const saveSitePrices = (p: SitePrices) => write(PRICES, p);
export const siteById = (id: string) => listSites().find((s) => s.id === id) ?? null;
const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Sites from pasted lines, as Explore's screening read them ("name, frontage, depth, road, DP road[, asking ₹/sq ft]"
 *  or "name, area, road"); the lines it can't read are listed back. */
export function pasteSites(text: string): { sites: Site[]; errors: string[] } {
  const { rows, errors } = parseScreen(text), at = new Date().toISOString();
  return { sites: rows.map((r) => ({ id: newId(), name: r.name, width: r.width, depth: r.depth, road: r.road, dp: r.dp, ...(r.land ? { asking: r.land } : {}), status: 'lead', added: at })), errors };
}
export const newSite = (x: Omit<Site, 'id' | 'added' | 'status'> & { status?: SiteStatus }): Site => ({ status: 'lead', ...x, id: newId(), added: new Date().toISOString() });

// ---------------- the figures ----------------

/** the project a site starts: its plot and road under the firm's prices, at the Looking stage */
export function projectOf(s: Site, pr: SitePrices = DEFAULT_PRICES): ProProject {
  return {
    ...DEFAULT_PROJECT, name: s.name, city: pr.city, shape: 'rect', width: s.width, depth: s.depth, road: s.road, dpRoad: s.dp, corner: false,
    sale: pr.sale, ...(s.asking ? { land: s.asking } : {}), target: pr.target, stage: 'looking', site: s.id,
  };
}

export function figures(s: Site, pr: SitePrices = DEFAULT_PRICES): SiteFigures {
  const p = projectOf(s, pr), e = evaluate(p), d = e.d;
  const deal = applyDeal(e, DEFAULT_DEAL), w = landWorth(e, DEFAULT_DEAL, pr.target);
  const potential = ladder(e).filter((x) => x.taken).reduce((a, x) => a + x.area, 0);
  return {
    area: e.r.area, potential, bua: d.bua, saleable: deal.saleCarpet, homes: d.flats,
    revenue: d.money.revenue, profit: deal.profit, margin: deal.margin,
    worth: w.outright, worthRate: w.outright === null ? null : w.outright / Math.max(1, e.r.area * SQFT), share: w.share,
  };
}

/** what a site's figures depend on: its plot and road, and the prices */
export const figKey = (s: Site, pr: SitePrices) => JSON.stringify([1, s.width, s.depth, s.road, s.dp, s.asking ?? 0, pr.city, pr.sale, pr.target.by, pr.target.v]);
/** its figures if they're still good for these prices */
export const kept = (s: Site, pr: SitePrices): SiteFigures | null => (s.fig && s.fig.k === figKey(s, pr) ? s.fig.f : null);

/** sites ranked by what their land is worth (the most to pay outright), best first; those worth nothing last, by share */
export function ranked<T extends { f: SiteFigures }>(xs: T[]): T[] {
  return [...xs].sort((a, b) => (b.f.worth ?? -Infinity) - (a.f.worth ?? -Infinity) || (b.f.share ?? -1) - (a.f.share ?? -1));
}
