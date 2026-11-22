// Search (Ctrl+K) reaches every setting through src/pro/findable.ts, kept by hand. This checks it both ways: every
// section in the steps is listed, and every listed section (and field) is really there.
import { readFileSync } from 'node:fs';
import { FINDABLE } from '../../src/pro/findable';

const files = ['src/pro/sitePanels.tsx', 'src/pro/steps.tsx', 'src/pro/designStep.tsx', 'src/pro/numbersUi.tsx', 'src/pro/places.tsx'];
const src = files.map((f) => readFileSync(f, 'utf8')).join('\n');
// (none left out: a picked thing's own sections are in the inspector, reached by picking it)
const NOT = new Set<string>([]);
const titles = new Set([...src.matchAll(/<Section title="([^"]+)"/g)].map((m) => m[1]));
let bad = 0;
const fail = (s: string) => { bad++; console.log(`FAIL ${s}`); };
for (const t of titles) if (!NOT.has(t) && !FINDABLE.some((f) => f.sec === t)) fail(`section "${t}" isn't in findable.ts`);
for (const f of FINDABLE) {
  if (!titles.has(f.sec)) fail(`findable.ts lists "${f.sec}", which no step has`);
  if (f.field && !src.includes(`"${f.field}"`) && !src.includes(`'${f.field}'`) && !src.includes(`>${f.field}<`)) fail(`field "${f.field}" (in ${f.sec}) isn't a label in the steps`);
}
console.log(bad ? `${bad} FAILED` : `ok   search reaches all ${titles.size} sections and ${FINDABLE.filter((f) => f.field).length} fields`);
if (bad) process.exit(1);
