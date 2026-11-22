// Options (src/pro/variants.ts): switching keeps each option's own scheme, nothing is lost, and shared inputs stay shared.
import { DEFAULT_PROJECT, type ProProject } from '../../src/pro/project';
import { added, asOption, duplicated, optionsOf, removedOption, renamed, switchTo } from '../../src/pro/variants';

let bad = 0;
const ok = (c: boolean, s: string) => { if (!c) bad++; console.log(`${c ? 'ok  ' : 'FAIL'} ${s}`); };
const apply = (p: ProProject, c: Partial<ProProject> | null) => ({ ...p, ...(c ?? {}) });

let p: ProProject = { ...DEFAULT_PROJECT, typology: 'tower', maxFloors: 12, sale: 9000 };
p = apply(p, added(p, { typology: 'slab', maxFloors: 7 }, 'brief', 'Brief: best'));
ok(optionsOf(p).length === 2 && optionsOf(p)[0].name === 'Option A', 'the first new option makes the project Option A');
ok(p.typology === 'slab' && p.maxFloors === 7, 'the new option is laid over the project');
const a = optionsOf(p)[0].id, b = p.option!;
p = { ...p, sale: 12000, mix: [0.1, 0.6, 0.3] };            // a shared change (sale) and the option's own (mix)
p = apply(p, switchTo(p, a));
ok(p.typology === 'tower' && p.maxFloors === 12, 'switching back brings Option A back');
ok(p.sale === 12000, 'shared inputs stay shared across options');
ok(JSON.stringify(p.mix) === JSON.stringify(DEFAULT_PROJECT.mix), "A keeps its own mix");
ok(JSON.stringify(asOption(p, b).mix) === JSON.stringify([0.1, 0.6, 0.3]), "B kept its mix while A is current");
p = apply(p, duplicated(p));
ok(optionsOf(p).length === 3 && p.typology === 'tower', 'duplicate copies the current option');
p = apply(p, renamed(p, p.option!, 'Tall'));
ok(optionsOf(p).some((o) => o.name === 'Tall'), 'rename');
const before = optionsOf(p).length;
p = apply(p, removedOption(p, p.option!));
ok(optionsOf(p).length === before - 1 && !!optionsOf(p).find((o) => o.id === p.option), 'removing the current one switches to a neighbour');
ok(removedOption({ ...p, options: [optionsOf(p)[0]], option: optionsOf(p)[0].id }, optionsOf(p)[0].id) === null, 'the last option stays');
// a change that clears a field (a brief's option is filled afresh: no hand-placed scheme)
let q: ProProject = { ...DEFAULT_PROJECT, scheme: { buildings: [], elements: [] } };
q = apply(q, added(q, { typology: 'slab', scheme: undefined }, 'brief'));
ok(q.scheme === undefined && optionsOf(q)[0].patch.scheme !== undefined, 'a cleared field stays cleared in the new option, and the first keeps it');
console.log(bad ? `${bad} FAILED` : 'ALL OK');
if (bad) process.exit(1);
