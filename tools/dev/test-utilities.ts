// The utilities as a network (src/pro/utilityNet.ts): what a utility snaps to, and how poles, tanks and power lines
// stay joined as they move. npx esbuild tools/dev/test-utilities.ts --bundle --platform=node --format=esm --outfile=tools/dev/test-utilities.mjs && node tools/dev/test-utilities.mjs
import { carry, hubOf, joined, joinOnto, netTargets, nodeMoved, hubMoved } from '../../src/pro/utilityNet';
import { moved } from '../../src/pro/edit';
import type { SiteFeature } from '../../src/pro/siteObjects';
import type { SiteElement } from '../../src/doc/site';
import type { ProProject } from '../../src/pro/project';
import type { Evaluated } from '../../src/pro/evaluate';

let ok = true;
const check = (c: boolean, m: string) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${m}`); if (!c) ok = false; };
const has = (flat: number[], x: number, z: number) => { for (let i = 0; i + 1 < flat.length; i += 2) if (Math.abs(flat[i] - x) < 1e-6 && Math.abs(flat[i + 1] - z) < 1e-6) return true; return false; };
const hasSeg = (s: number[], ax: number, az: number, bx: number, bz: number) => { for (let i = 0; i + 3 < s.length; i += 4) if ((s[i] === ax && s[i + 1] === az && s[i + 2] === bx && s[i + 3] === bz) || (s[i] === bx && s[i + 1] === bz && s[i + 2] === ax && s[i + 3] === az)) return true; return false; };
const pts = (fs: SiteFeature[], id: string) => fs.find((f) => f.id === id)!.pts;

const poleA: SiteFeature = { id: 'pA', kind: 'pole', pts: [-20, 40], r: 0.6, clear: 2 };
const poleB: SiteFeature = { id: 'pB', kind: 'pole', pts: [20, 40], r: 0.6, clear: 2 };
const line: SiteFeature = { id: 'L', kind: 'power', pts: [-20, 40, 20, 40], clear: 7.5 };
const spur: SiteFeature = { id: 'S', kind: 'power', pts: [20, 40, 20, 70], clear: 7.5 };
const tank: SiteElement = { id: 't', kind: 'tank', spine: [9.5, 60, 10.5, 60], depth: 6, floors: 0 };
const road: SiteElement = { id: 'r', kind: 'road', spine: [-40, 20, 40, 20], depth: 6, floors: 0 };
const fs = [poleA, poleB, line, spur];

// ---- what pulls a utility ----
const T = netTargets(fs, [tank, road]);
check(has(T.pts, -20, 40) && has(T.pts, 20, 40), 'the poles are snap points');
check(has(T.pts, 20, 70), "a power line's nodes are snap points");
check(has(T.pts, 10, 60), "a tank's middle is a snap point, not its stub's ends");
check(!has(T.pts, 9.5, 60), "a tank's stub ends aren't snap points");
check(has(T.pts, -40, 20) && has(T.pts, 40, 20), "a road's nodes are snap points");
check(hasSeg(T.segs, -20, 40, 20, 40), 'a power line is a snap edge');
check(hasSeg(T.segs, -40, 20, 40, 20), "a road's centre line is a snap edge");
check(T.segs.length > 8, "a road's edges are snap edges too");
const Tx = netTargets(fs, [tank], { ex: 'pB', at: [[20, 40]] });
check(has(Tx.pts, -20, 40) && has(Tx.pts, 10, 60), 'moving a pole: the other pole and the tank still pull');
check(!has(Tx.pts, 20, 40), "moving a pole: neither it nor the line nodes on it pull (they go along)");
check(!hasSeg(Tx.segs, -20, 40, 20, 40) && !hasSeg(Tx.segs, 20, 40, 20, 70), "moving a pole: the lines from it don't pull it back");
const Tn = netTargets(fs, [], { ex: 'S', at: [[20, 40]] });
check(has(Tn.pts, 20, 40), "dragging a line's node off a pole: the pole still pulls (it stays)");

// ---- joined by where they are ----
const c = carry(fs, [[20, 40]], 0, 10);
check(pts(c, 'L').join() === '-20,40,20,50' && pts(c, 'S').join() === '20,50,20,70', 'carry: every line node on the spot goes along');
check(pts(c, 'pB').join() === '20,40', "carry: a pole isn't moved by it (it's what moves them)");
check(carry(fs, [[0, 0]], 5, 5) === fs || carry(fs, [[0, 0]], 5, 5).every((f, i) => f === fs[i]), 'carry: nothing joined there, nothing changes');

// a pole moved: its line nodes go along, the far ends stay
const hm = hubMoved(fs.map((f) => (f.id === 'pB' ? { ...f, pts: [25, 45] } : f)), [20, 40], 5, 5, 'pB');
check(pts(hm, 'L').join() === '-20,40,25,45' && pts(hm, 'S').join() === '25,45,20,70', 'a pole moved takes both lines on it along');

// a pole put down on a line joins it
const mid: SiteFeature = { id: 'pM', kind: 'pole', pts: [0, 40], r: 0.6, clear: 2 };
const j = joined([...fs, mid], 'pM');
check(pts(j, 'L').join() === '-20,40,0,40,20,40', 'a pole put on a line gives the line a node there');
const j2 = hubMoved(j.map((f) => (f.id === 'pM' ? { ...f, pts: [0, 45] } : f)), [0, 40], 0, 5, 'pM');
check(pts(j2, 'L').join() === '-20,40,0,45,20,40', '… so moving that pole bends the line with it');
check(joinOnto(fs, [20, 40]).every((f, i) => f === fs[i]), 'a line with a node there already is left as it is');
check(joined([...fs, { id: 'tr', kind: 'tree', pts: [0, 40], r: 4, clear: 1 }], 'tr').every((f, i) => i >= fs.length || f === fs[i]), "a tree put on a line doesn't join it");

// a line's node dragged: the junction holds, and it joins what it's dropped on
const nm = nodeMoved(fs, 'L', 1, 22, 38);
check(pts(nm, 'L').join() === '-20,40,22,38' && pts(nm, 'S').join() === '22,38,20,70', "a line's node dragged takes the other line's node joined there");
check(pts(nm, 'pB').join() === '20,40', "… but not the pole it was on (dragging it off the pole detaches it)");
const onto = nodeMoved(fs, 'S', 1, 0, 40);
check(pts(onto, 'L').join() === '-20,40,0,40,20,40', "a line's end dropped on another line joins it there (a T)");
check(nodeMoved(fs, 'L', 1, 20, 40).every((f, i) => f.pts.join() === fs[i].pts.join()), 'a node dropped where it was changes nothing');

// hubOf
check(hubOf(poleA)?.join() === '-20,40' && hubOf(tank)?.join() === '10,60' && hubOf(line) === null && hubOf(road) === null, "hubOf: a pole's and a tank's middle; a line has none");

// ---- through the editor's own move (what dragging and the arrow keys do) ----
const p = { features: fs, scheme: { buildings: [], elements: [tank] } } as unknown as ProProject;
const e = {} as Evaluated;
const mv = moved(p, e, { k: 'feature', id: 'pB' }, 0, -10);
check(pts(mv.features!, 'pB').join() === '20,30' && pts(mv.features!, 'L').join() === '-20,40,20,30' && pts(mv.features!, 'S').join() === '20,30,20,70', 'moved(): a pole dragged takes its lines along');
const ml = moved(p, e, { k: 'feature', id: 'L' }, 0, 5);
check(pts(ml.features!, 'L').join() === '-20,45,20,45' && pts(ml.features!, 'pB').join() === '20,40', 'moved(): a whole line moved leaves the poles where they are');
const tp = { features: [...fs, { id: 'W', kind: 'power', pts: [10, 60, 20, 40], clear: 7.5 }], scheme: { buildings: [], elements: [tank] } } as unknown as ProProject;
const mt = moved(tp, e, { k: 'element', id: 't' }, 3, 0);
check(pts(mt.features!, 'W').join() === '13,60,20,40' && mt.scheme!.elements[0].spine.join() === '12.5,60,13.5,60', 'moved(): a tank moved takes the line on it along');

if (!ok) { console.log('\nSOME UTILITY CHECKS FAILED'); process.exit(1); }
console.log('\nall utility checks passed');
