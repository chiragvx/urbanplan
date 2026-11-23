// Reading a pasted list of plots (from a broker's sheet, a land bank) for the dashboard's Sites (./sites.ts). Each
// line is either
//   name, width, depth, road, DP road[, land ₹/sq ft]     (a rectangle, frontage × depth in metres)
// or
//   name, area, road                                      (an area in m², taken as a plot 1 : 1.25 deep)
// separated by commas, tabs or semicolons. A header row, if any, is skipped. A line that can't be read is listed
// back, never guessed at.

export interface ScreenRow { name: string; width: number; depth: number; road: number; dp: number; land?: number; area?: number }

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
