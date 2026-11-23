// Sites (src/pro/sites.ts): twenty pasted plots get their quick figures and are ranked by what the land is worth;
// the best opens as a project with its plot and road set, at the Looking stage.
import { pasteSites, figures, ranked, projectOf, DEFAULT_PRICES } from '../../src/pro/sites';
import { evaluate } from '../../src/pro/evaluate';
import { stageOf } from '../../src/pro/project';

let bad = 0;
const ok = (c: boolean, s: string) => { if (!c) bad++; console.log(`${c ? 'ok  ' : 'FAIL'} ${s}`); };

const lines = ['Name, frontage, depth, road, DP road'];
for (let i = 0; i < 18; i++) lines.push(`Plot ${i + 1}, ${20 + i * 3}, ${30 + (i % 5) * 8}, ${[9, 12, 18, 24][i % 4]}, ${[12, 18, 24, 30][i % 4]}`);
lines.push('By area, 2400, 15', 'nonsense line here');
const { sites, errors } = pasteSites(lines.join('\n'));
ok(sites.length === 19 && errors.length === 1, `read 19 plots and listed back the line it couldn't (${sites.length}, ${errors.length})`);
sites.push(pasteSites('Asking, 35, 45, 18, 24, 9000').sites[0]);
ok(sites[19].asking === 9000, 'an asking price is kept');

const t0 = Date.now();
const rows = ranked(sites.map((s) => ({ s, f: figures(s, DEFAULT_PRICES) })));
const ms = Date.now() - t0;
ok(rows.length === 20, `twenty plots worked out in ${ms} ms`);
ok(rows.every((r, i) => i === 0 || (r.f.worth ?? -Infinity) <= (rows[i - 1].f.worth ?? -Infinity)), 'ranked by what the land is worth, best first');
ok(rows.every((r) => r.f.potential >= r.f.bua * 0.98 || r.f.bua === 0), 'no scheme builds past the potential');
ok(rows.every((r) => r.f.area > 0 && r.f.saleable >= 0), 'every plot has an area and a saleable');
const best = rows[0];
ok(best.f.worth !== null && best.f.worth > 0, `the best is worth something: ₹${((best.f.worth ?? 0) / 1e7).toFixed(2)} cr (${best.s.name})`);

const p = projectOf(best.s, DEFAULT_PRICES), e = evaluate(p);
ok(p.width === best.s.width && p.depth === best.s.depth && p.road === best.s.road && p.dpRoad === best.s.dp, 'the project has its plot and road');
ok(stageOf(p) === 'looking', 'and starts at the Looking stage');
ok(Math.abs(e.r.area - best.f.area) < 0.5, 'and the same plot area');

console.log(bad ? `${bad} FAILED` : 'ALL OK');
if (bad) process.exit(1);
