// Many-plot screening: paste a list of plots (from a broker's sheet, a land bank) and get each one's most built-up
// area, flats and profit under the project's rules, design system and rates. Each line is either
//   name, width, depth, road, DP road[, land ₹/sq ft]     (a rectangle, frontage × depth in metres)
// or
//   name, area, road                                      (an area in m², taken as a plot 1 : 1.25 deep)
// separated by commas, tabs or semicolons. A header row, if any, is skipped. A line that can't be read is listed
// back, never guessed at.
import { evaluate } from './evaluate';
import type { ProProject } from './project';

export interface ScreenRow { name: string; width: number; depth: number; road: number; dp: number; land?: number; area?: number }
export interface ScreenResult { row: ScreenRow; area: number; fsi: number; bua: number; flats: number; profit: number; margin: number; irr: number | null; departures: number }

export function parseScreen(text: string): { rows: ScreenRow[]; errors: string[] } {
  const rows: ScreenRow[] = [], errors: string[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  lines.forEach((line, i) => {
    const cells = line.split(/\t|;|,/).map((c) => c.trim());
    const nums = cells.map((c) => { const t = c.replace(/[₹\s]/g, ''); return t ? Number(t) : NaN; });
    // (a header: no numbers at all after the first cell)
    if (i === 0 && nums.slice(1).every((n) => !Number.isFinite(n))) return;
    // (no name: the numbers start in the first cell)
    const named = !Number.isFinite(nums[0]);
    const name = named ? cells[0] : `Plot ${rows.length + 1}`;
    const vals = named ? nums.slice(1) : nums;
    const ok = (n: number) => Number.isFinite(n) && n > 0;
    if (vals.length >= 4 && ok(vals[0]) && ok(vals[1]) && ok(vals[2])) {
      const [width, depth, road, dp, land] = vals;
      if (width > 1000 || depth > 1000) { errors.push(`Line ${i + 1}: a plot over 1 km a side? (${line})`); return; }
      rows.push({ name, width, depth, road, dp: Number.isFinite(dp) ? dp : 0, ...(ok(land) ? { land } : {}) });
    } else if (vals.length >= 2 && ok(vals[0]) && ok(vals[1])) {
      const [area, road] = vals;
      const width = Math.round(Math.sqrt(area / 1.25) * 10) / 10, depth = Math.round((area / width) * 10) / 10;
      rows.push({ name, width, depth, road, dp: 0, area });
    } else errors.push(`Line ${i + 1}: need "name, width, depth, road, DP road" or "name, area, road" (${line})`);
  });
  return { rows, errors };
}

export function screen(rows: ScreenRow[], base: ProProject): ScreenResult[] {
  return rows.map((row) => {
    const p: ProProject = {
      ...base, name: row.name, shape: 'rect', width: row.width, depth: row.depth, road: row.road, dpRoad: row.dp, corner: false,
      ...(row.land ? { land: row.land } : {}),
    };
    const e = evaluate(p), d = e.d;
    return { row, area: e.r.area, fsi: e.r.fsi, bua: d.bua, flats: d.flats, profit: d.money.profit, margin: d.money.margin, irr: d.money.irr, departures: d.departures.length };
  });
}

export function screenCsv(res: ScreenResult[]): string {
  const q = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const head = 'Plot,Width (m),Depth (m),Road (m),DP road (m),Area (m²),FSI,Built-up (m²),Flats,Profit (₹ cr),Margin (%),IRR (%),Departures';
  return [head, ...res.map((x) => [
    q(x.row.name), x.row.width, x.row.depth, x.row.road, x.row.dp, Math.round(x.area), x.fsi.toFixed(2), Math.round(x.bua), x.flats,
    (x.profit / 1e7).toFixed(2), (x.margin * 100).toFixed(1), x.irr === null ? '' : (x.irr * 100).toFixed(1), x.departures,
  ].join(','))].join('\n');
}
