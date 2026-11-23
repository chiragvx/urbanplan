// A project's summary for its card on the dashboard: the plot, what's on it and the money, and just enough geometry
// to draw a thumbnail (the plot's outline and the buildings' footprints, to half a metre). Worked out by the editor
// when it saves (src/pro/cloud.ts) and kept in `projects.summary`, so the dashboard lists dozens of projects without
// opening a single file. Small on purpose: a few hundred bytes.
import { evaluate } from '../pro/evaluate';
import { CITIES, framingOf, outline, sold, stageOf, type ProProject, type Stage } from '../pro/project';

export interface Summary {
  v: 1;
  city: string;
  /** plot (m²), built-up (m²), homes, buildings, tallest (m), floors of the tallest */
  area: number; bua: number; homes: number; buildings: number; height: number; floors: number;
  /** profit (₹), or the cost when nothing in it is sold (public buildings); null when it isn't for sale */
  profit: number | null;
  /** what it is and who it's for, in a few words ("Offices · for a client"; unset: homes to sell) */
  what?: string;
  /** units that aren't homes (offices, shops, rooms), and what it costs, the land aside, when it isn't for sale */
  units?: number; cost?: number;
  /** where the project is (set on the card, in Sites, or by the project) */
  stage?: Stage;
  /** the Sites entry it was opened from */
  site?: string;
  /** the rules: how many checks fail */
  fails?: number;
  /** a thumbnail: the plot's ring and the buildings' footprints (x, z pairs, metres), and their heights */
  plot: number[]; blds: { ring: number[]; h: number }[];
}

const half = (v: number) => Math.round(v * 2) / 2;

export function summaryOf(p: ProProject): Summary {
  const ring = outline(p).ring.map(half);
  const city = CITIES.find((c) => c.value === p.city)?.label ?? p.city;
  const what = framingOf(p);
  const tag = { stage: stageOf(p), ...(p.site ? { site: p.site } : {}), ...(what ? { what } : {}) };
  try {
    const e = evaluate(p), d = e.d;
    const tallest = d.buildings.reduce((a, b) => (b.height > (a?.height ?? -1) ? b : a), d.buildings[0]);
    return {
      v: 1, city, ...tag, area: Math.round(e.r.area), bua: Math.round(d.bua), buildings: d.buildings.length,
      // (homes for a project with homes, as before; else its other units apart)
      homes: p.use && p.use !== 'residential' && p.use !== 'mixed' ? d.count[0] + d.count[1] + d.count[2] : d.flats,
      ...(p.use && p.use !== 'residential' && p.use !== 'mixed' && d.count[3] ? { units: d.count[3] } : {}),
      height: Math.round(d.height * 10) / 10, floors: tallest ? tallest.floors : 0,
      profit: sold(p) && Number.isFinite(d.money?.profit) ? Math.round(d.money.profit) : null,
      ...(!sold(p) && Number.isFinite(d.money?.cost) ? { cost: Math.round(d.money.cost - d.money.land) } : {}),
      plot: ring,
      // (a building's footprint: its outline when it has a form, else a ring per wing)
      blds: d.buildings.slice(0, 24).flatMap((b) => {
        const laid = (b as { laid?: { outline: number[] } }).laid?.outline;
        return (laid ? [laid] : b.quads).map((q) => ({ ring: q.map(half), h: Math.round(b.height) }));
      }),
    };
  } catch {
    return { v: 1, city, ...tag, area: 0, bua: 0, homes: 0, buildings: 0, height: 0, floors: 0, profit: null, plot: ring, blds: [] };
  }
}
