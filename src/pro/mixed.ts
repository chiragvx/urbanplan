// Mixed use: shops along the front road under the flats (or offices). The buildings in the front row get a strip
// `depth` deep along their road face given over to shops, on the ground (where the stilt was) and, if asked, on the
// floors above (the flats in the strip become shops). Everything is accounted for:
// - FSI: the ground-floor shops count, so the top floors of flats are trimmed until the scheme fits the permissible
//   built-up area again.
// - Parking: the shops need their own (a car per 100 m² of carpet, as the engine's shops use), and the stilt bays
//   under them are lost, so basements are added until it's parked.
// - Money: the shops' sale goes in at the shop rate, the flats given up come out, the extra floor area's
//   construction and FSI cost go in, all in the same monthly cash flow as the flats (so the IRR stays honest).
// Which floors may be shops goes by the road width. These tiers are as commonly summarised from UDCPR's mixed-use
// provisions and still need checking against the regulation: under 9 m none, 9 m the ground floor, 18 m two
// floors, 24 m three, 30 m and wider all of them. Asking for more than the road allows is flagged, never refused.
import { clipHalf, type PlotReport, type PlotUse } from '../doc/plot';
import { cashflow, CARPET, pointIn, roadFrame, solveSite, SQFT, type PlotSite, type SiteReport } from '../doc/site';

export interface Frontage { floors: number; depth: number }
export interface ShopStrip { b: number; ring: number[]; area: number; front: number }
export interface Shops {
  strips: ShopStrip[];
  /** floors of shops (the ground and up), and what the road allows */
  floors: number; allowed: number; over: boolean;
  /** shop floor area on the ground (it counts on top of the flats) and above it (taken from the flats) */
  ground: number; upper: number; carpet: number; count: number;
  /** flats given up to shops above the ground: by building, the units' indices on a typical floor, and how many */
  removed: Map<number, Set<number>>; removedFlats: number; removedCarpet: number;
  /** by building, how many floors above the ground are shops */
  upperOf: number[];
  /** cars the shops need, stilt bays they take, top floors trimmed to fit the FSI, basements added */
  cars: number; baysLost: number; trimmed: number; basementsAdded: number;
  revenue: number; cost: number;
}

/** Shop floors a road this wide allows (99: all of them). */
export const shopFloorsAllowed = (roadW: number) => (roadW >= 30 ? 99 : roadW >= 24 ? 3 : roadW >= 18 ? 2 : roadW >= 9 ? 1 : 0);
/** a shop's width along the front, for counting them and their shutters */
export const SHOP_W = 4.5;

const centroid = (r: number[]): [number, number] => { let x = 0, z = 0; for (let i = 0; i < r.length; i += 2) { x += r[i]; z += r[i + 1]; } return [x / (r.length / 2), z / (r.length / 2)]; };
const ringArea = (r: number[]) => { let a = 0; for (let i = 0; i < r.length; i += 2) { const j = (i + 2) % r.length; a += r[i] * r[j + 1] - r[j] * r[i + 1]; } return Math.abs(a / 2); };

/** The shop strips: in each front-row building, the part within `depth` of its face to the road. */
export function shopStrips(r: PlotReport, d: SiteReport, depth: number): ShopStrip[] {
  if (!d.buildings.length) return [];
  const F = roadFrame(r), [ox, oz] = F.toW(0, 0);
  const vmin = d.buildings.map((b) => Math.min(...b.quads.flatMap((q) => F.toL(q).filter((_, i) => i % 2 === 1))));
  const first = Math.min(...vmin);
  const out: ShopStrip[] = [];
  d.buildings.forEach((b, bi) => {
    // the front row: within 8 m of the building nearest the road
    if (vmin[bi] > first + 8) return;
    const V = vmin[bi] + depth;
    for (const q of b.quads) {
      // keep v ≤ V: (p − o)·(−v) ≥ −V
      const ring = clipHalf(q, ox, oz, -F.vx, -F.vz, -V);
      if (ring.length < 6) continue;
      const area = ringArea(ring);
      if (area < 4) continue;
      const us = F.toL(ring).filter((_, i) => i % 2 === 0);
      out.push({ b: bi, ring, area, front: Math.max(...us) - Math.min(...us) });
    }
  });
  return out;
}

/** The scheme with shops at the front: the site re-solved (floors trimmed, basements added) and the shops' figures. */
export function withShops(r: PlotReport, site: PlotSite, use: PlotUse, f: Frontage, shopSale: number): { d: SiteReport; shops: Shops | null } {
  let d = solveSite(r, site, use);
  if (f.floors <= 0 || !d.buildings.length) return { d, shops: null };
  const strips = shopStrips(r, d, f.depth);
  if (!strips.length) return { d, shops: null };
  const ground = strips.reduce((s, x) => s + x.area, 0);
  // FSI: the ground-floor shops count on top of the flats; trim the tallest building a floor at a time until it fits
  let s: PlotSite = { ...site, buildings: site.buildings.map((b, i) => ({ ...b, floors: d.buildings[i]?.floors ?? b.floors })) };
  let trimmed = 0;
  while (d.bua + ground > r.bua + 1 && trimmed < 200) {
    const i = d.buildings.reduce((k, b, j) => (b.floors > d.buildings[k].floors ? j : k), 0);
    if (d.buildings[i].floors <= 1) break;
    s = { ...s, buildings: s.buildings.map((b, j) => (j === i ? { ...b, floors: d.buildings[i].floors - 1 } : b)) };
    d = solveSite(r, s, use);
    trimmed++;
  }
  // the floors above the ground given to shops: the flats whose middle is in the strip
  const removed = new Map<number, Set<number>>();
  const upperFloors = (bi: number) => Math.max(0, Math.min(f.floors - 1, d.buildings[bi].floors));
  let removedFlats = 0, removedCarpet = 0, upper = 0;
  for (const x of strips) {
    const b = d.buildings[x.b], n = upperFloors(x.b);
    if (!n) continue;
    upper += x.area * n;
    const set = removed.get(x.b) ?? new Set<number>();
    b.units.forEach((u, ui) => { const [cx, cz] = centroid(u.ring); if (pointIn(x.ring, cx, cz)) set.add(ui); });
    removed.set(x.b, set);
  }
  const count = [...d.count] as SiteReport['count'];
  for (const [bi, set] of removed) { const n = upperFloors(bi), b = d.buildings[bi]; for (const ui of set) { removedFlats += n; removedCarpet += b.units[ui].carpet * n; count[b.units[ui].t] -= n; } }
  // parking: the shops' cars, the stilt bays under them; add basements until it's parked (at most 4)
  const shopCarpet = (ground + upper) * CARPET;
  const cars = Math.ceil(shopCarpet / 100);
  const lostOf = (dd: SiteReport) => dd.parking.levels.filter((l) => l.kind === 'stilt').reduce((n, l) => n + l.bays.filter((q) => { const [cx, cz] = centroid(q); return strips.some((x) => pointIn(x.ring, cx, cz)); }).length, 0);
  let baysLost = lostOf(d), basementsAdded = 0;
  while (d.parking.have - baysLost < d.parking.need + cars && s.basements < 4) {
    s = { ...s, basements: s.basements + 1 };
    d = solveSite(r, s, use);
    baysLost = lostOf(d);
    basementsAdded++;
  }
  // money: the shops sold, the flats given up, the ground floor's construction and FSI cost, one cash flow
  const M = d.money, c = M.costs;
  const shopRevenue = shopCarpet * SQFT * shopSale;
  const lostRevenue = removedCarpet * SQFT * c.sale;
  const build = M.build + ground * SQFT * c.build, soft = (build + M.parking) * c.soft / 100;
  const fsiShare = d.bua > 0 ? 1 + ground / d.bua : 1;
  const upfront = M.land + (M.premium + M.tdr + M.ancillary) * fsiShare;
  const revenue = M.revenue + shopRevenue - lostRevenue, cost = upfront + build + M.parking + soft;
  const cash = cashflow(upfront, build + M.parking + soft, revenue, c);
  const money = { ...M, revenue, build, soft, premium: M.premium * fsiShare, tdr: M.tdr * fsiShare, ancillary: M.ancillary * fsiShare, cost, profit: revenue - cost, margin: revenue > 0 ? (revenue - cost) / revenue : 0, ...cash };
  const allowed = shopFloorsAllowed(r.roadW);
  const front = strips.reduce((s2, x) => s2 + x.front, 0);
  const shops: Shops = {
    strips, floors: f.floors, allowed, over: f.floors > allowed, ground, upper, carpet: shopCarpet,
    count: Math.max(1, Math.floor(front / SHOP_W)) * f.floors,
    removed, removedFlats, removedCarpet, upperOf: d.buildings.map((_, bi) => (strips.some((x) => x.b === bi) ? upperFloors(bi) : 0)), cars, baysLost, trimmed, basementsAdded,
    revenue: shopRevenue, cost: ground * SQFT * c.build,
  };
  return { d: { ...d, bua: d.bua + ground, money, flats: d.flats - removedFlats, count, carpet: d.carpet - removedCarpet, parking: { ...d.parking, need: d.parking.need + cars, have: d.parking.have - baysLost } }, shops };
}
