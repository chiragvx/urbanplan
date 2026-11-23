// A project's summary for its card on the dashboard: the plot, what's on it and the money, and just enough geometry
// to draw a thumbnail (the plot's outline and the buildings' footprints, to half a metre). Worked out by the editor
// when it saves (src/pro/cloud.ts) and kept in `projects.summary`, so the dashboard lists dozens of projects without
// opening a single file. Small on purpose: a few hundred bytes.
import { evaluate } from '../pro/evaluate';
import { CITIES, outline, stageOf, type ProProject, type Stage } from '../pro/project';

export interface Summary {
  v: 1;
  city: string;
  /** plot (m²), built-up (m²), homes, buildings, tallest (m), floors of the tallest */
  area: number; bua: number; homes: number; buildings: number; height: number; floors: number;
  /** profit (₹), or the cost when nothing in it is sold (public buildings) */
  profit: number | null;
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
  const tag = { stage: stageOf(p), ...(p.site ? { site: p.site } : {}) };
  try {
    const e = evaluate(p), d = e.d;
    const tallest = d.buildings.reduce((a, b) => (b.height > (a?.height ?? -1) ? b : a), d.buildings[0]);
    return {
      v: 1, city, ...tag, area: Math.round(e.r.area), bua: Math.round(d.bua), homes: d.flats, buildings: d.buildings.length,
      height: Math.round(d.height * 10) / 10, floors: tallest ? tallest.floors : 0,
      profit: Number.isFinite(d.money?.profit) ? Math.round(d.money.profit) : null,
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
