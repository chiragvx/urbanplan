// The brief: a developer's request in plain words ("mostly 2BHK, under 70 m, shops on the ground floor, best
// profit") turned into a scheme. This first cut has no language model behind it. A small parser picks out the
// constraints it recognises and lists back what it didn't. A planner then searches the generator's option space
// (typology, height caps, flat mix, shops) and checks each candidate's own work: no departures from the rules,
// and the brief's limits met. It ranks what passes by the brief's goal and explains each step. These are the same
// calls (evaluate, optionRow) an LLM agent would make, so one can replace the parser later and keep the checking.
import { TYPOLOGIES, type Typology } from '../doc/optimise';
import { designOf, evaluate } from './evaluate';
import { shopFloorsAllowed } from './mixed';
import { floorsUnder, HEIGHT_STEPS, MIXES, optionRow, type OptionRow } from './options';
import type { ProProject } from './project';

export interface Brief {
  maxHeight?: number; minFlats?: number; maxFlats?: number; mix?: [number, number, number]; prefer?: 1 | 2 | 3;
  typology?: Typology; shops?: number; podium?: boolean; minIrr?: number; maxFloors?: number;
  goal: 'profit' | 'flats' | 'bua';
}
export interface BriefStep { kind: 'think' | 'try' | 'check' | 'pick'; text: string }
export interface BriefResult { patch: Partial<ProProject>; best: OptionRow | null; alternatives: OptionRow[]; steps: BriefStep[]; met: boolean }

const PREFER_MIX: Record<1 | 2 | 3, [number, number, number]> = { 1: MIXES[0].mix, 2: MIXES[1].mix, 3: MIXES[2].mix };

/** Read a brief: the constraints recognised (each said back in plain words) and the parts that weren't. */
export function parseBrief(text: string): { brief: Brief; understood: string[]; ignored: string[] } {
  const brief: Brief = { goal: 'profit' };
  const understood: string[] = [], ignored: string[] = [];
  const parts = text.toLowerCase().split(/[,;\n]|\.\s|\band\b|\bwith\b/).map((s) => s.trim()).filter(Boolean);
  const mixShares: [number, number, number] = [0, 0, 0];
  let mixSeen = false;
  for (const s of parts) {
    let hit = false;
    const say = (t: string) => { understood.push(t); hit = true; };
    let m: RegExpMatchArray | null;
    if ((m = s.match(/(?:under|below|max(?:imum)?|at most|upto|up to|<)\s*(?:height\s*(?:of)?\s*)?(\d+(?:\.\d+)?)\s*m\b(?!\w)/)) || (m = s.match(/height\s*(?:under|below|of|max|<)?\s*(\d+(?:\.\d+)?)\s*m\b/))
      || (m = s.match(/(\d+(?:\.\d+)?)\s*m\s*(?:max(?:imum)?\s*(?:height)?|tall|high|height\s*(?:max|limit|cap))/))) {
      brief.maxHeight = +m[1]; say(`Height at most ${m[1]} m`);
    }
    if ((m = s.match(/\bg\s*\+\s*(\d+)/)) && !/shop|retail|commercial/.test(s)) { brief.maxFloors = +m[1]; say(`At most ${m[1]} floors of flats over the stilt (G + ${m[1]})`); }
    else if ((m = s.match(/(?:max(?:imum)?|at most|up to|upto|under|no more than)\s*(\d+)\s*(?:floors|storeys|stories)/)) || (m = s.match(/(\d+)\s*(?:floors|storeys|stories)\s*(?:max|at most)/))) { brief.maxFloors = +m[1]; say(`At most ${m[1]} floors of flats`); }
    // flat counts
    if ((m = s.match(/(?:at least|min(?:imum)?|over|more than)\s*(\d+)\s*(?:flats|units|apartments|homes)/)) || (m = s.match(/(\d+)\s*\+\s*(?:flats|units|apartments|homes)/))) { brief.minFlats = +m[1]; say(`At least ${m[1]} flats`); }
    if ((m = s.match(/(?:at most|max(?:imum)?|under|no more than|fewer than|less than)\s*(\d+)\s*(?:flats|units|apartments|homes)/))) { brief.maxFlats = +m[1]; say(`At most ${m[1]} flats`); }
    // the mix: shares ("60% 2bhk"), or "mostly / most 2bhk"
    for (const x of s.matchAll(/(\d+)\s*%\s*(?:of\s*)?([123])\s*-?\s*bhk/g)) { mixShares[+x[2] - 1] = +x[1] / 100; mixSeen = true; hit = true; }
    // ("2bhk 60%" only when no share is written first: in "60% 2bhk 40% 3bhk" it would read 2bhk as 40%)
    if (!/\d\s*%\s*(?:of\s*)?[123]\s*-?\s*bhk/.test(s)) for (const x of s.matchAll(/([123])\s*-?\s*bhk\s*(?:at\s*)?(\d+)\s*%/g)) { mixShares[+x[1] - 1] = +x[2] / 100; mixSeen = true; hit = true; }
    if (!mixSeen && (m = s.match(/(?:most(?:ly)?|majority|largely|mainly|max(?:imum)?|more)\s*([123])\s*-?\s*bhk/))) { brief.prefer = +m[1] as 1 | 2 | 3; say(`Mostly ${m[1]} BHK flats`); }
    else if (!mixSeen && !hit && (m = s.match(/^(?:only\s*)?([123])\s*-?\s*bhks?$/))) { brief.prefer = +m[1] as 1 | 2 | 3; say(`Mostly ${m[1]} BHK flats`); }
    if (/\btowers?\b|point block/.test(s)) { brief.typology = 'tower'; say('Towers'); }
    else if (/\bslabs?\b|mid-?rise block/.test(s)) { brief.typology = 'slab'; say('Slabs'); }
    if (/shop|retail|commercial frontage|showroom/.test(s)) {
      if (/\bno\s+(?:shops|retail)|without\s+(?:shops|retail)/.test(s)) { brief.shops = 0; say('No shops'); }
      else {
        const g = s.match(/g\s*\+\s*(\d)/), n = s.match(/(\d|two|three)\s*floors?\s*of\s*(?:shops|retail)/);
        const k = g ? +g[1] + 1 : n ? ({ two: 2, three: 3 } as Record<string, number>)[n[1]] ?? +n[1] : 1;
        brief.shops = Math.min(3, Math.max(1, k)); say(brief.shops === 1 ? 'Shops on the ground floor' : `Shops on ${brief.shops} floors`);
      }
    }
    if (/podium/.test(s)) { brief.podium = true; say('A podium (noted: the generator doesn\'t build podiums yet, so it isn\'t applied)'); }
    if ((m = s.match(/irr\s*(?:above|over|of at least|at least|>|>=|min(?:imum)?)?\s*(\d+(?:\.\d+)?)\s*%/))) { brief.minIrr = +m[1] / 100; say(`IRR at least ${m[1]}%`); }
    if (/most flats|max(?:imum|imise|imize)? (?:flats|units)|as many flats/.test(s)) { brief.goal = 'flats'; say('Goal: the most flats'); }
    else if (/(?:most|max(?:imum|imise|imize)?)\s*(?:built-?up|bua|area|fsi)/.test(s)) { brief.goal = 'bua'; say('Goal: the most built-up area'); }
    else if (/profit|irr|return|money|margin/.test(s) && !/irr\s*(?:above|over|at least|>)/.test(s)) { brief.goal = 'profit'; say('Goal: the most profit'); }
    if (/(\d+|two|three)\s*(?:schemes|options|alternatives)/.test(s)) { say('Alternatives: the best and up to two runners-up are shown'); }
    if (!hit) ignored.push(s);
  }
  if (mixSeen) {
    const t = mixShares[0] + mixShares[1] + mixShares[2];
    // shares that don't add to 100: what's left goes to the types not named, evenly
    const rest = Math.max(0, 1 - t), unnamed = mixShares.filter((x) => x === 0).length;
    const mix = mixShares.map((x) => (x === 0 && unnamed ? rest / unnamed : x)) as [number, number, number];
    const s = mix[0] + mix[1] + mix[2] || 1;
    brief.mix = mix.map((x) => x / s) as [number, number, number];
    understood.push(`Flat mix ${brief.mix.map((x, i) => `${Math.round(x * 100)}% ${i + 1} BHK`).join(', ')}`);
  }
  return { brief, understood, ignored };
}

const score = (o: OptionRow, goal: Brief['goal']) => (goal === 'flats' ? o.flats * 1e12 + o.profit : goal === 'bua' ? o.bua * 1e9 + o.profit : o.profit);

export function runBrief(p: ProProject, brief: Brief): BriefResult {
  const steps: BriefStep[] = [];
  const log = (kind: BriefStep['kind'], text: string) => steps.push({ kind, text });
  const fh = designOf(p).floorH;
  const r = evaluate(p).r;
  const cr = (v: number) => `₹${(v / 1e7).toFixed(2)} cr`;

  // the search space, narrowed by the brief
  const types: Typology[] = brief.typology ? [brief.typology] : TYPOLOGIES.filter((t) => t.value !== 'auto').map((t) => t.value);
  let top = 0; // floors cap from the brief (0: none)
  if (brief.maxFloors) top = brief.maxFloors;
  if (brief.maxHeight) { const f = floorsUnder(brief.maxHeight + 0.01, fh); top = top ? Math.min(top, f) : f; }
  const caps = [top, ...HEIGHT_STEPS.map((h) => floorsUnder(h, fh)).filter((f) => !top || f < top)].filter((v, i, a) => a.indexOf(v) === i);
  const mixes = brief.mix ? [brief.mix] : brief.prefer ? [PREFER_MIX[brief.prefer]] : MIXES.map((m) => m.mix);
  const allowed = shopFloorsAllowed(r.roadW);
  let shopsTry = brief.shops !== undefined ? [brief.shops] : allowed >= 1 ? [0, 1] : [0];
  log('think', `The plot is ${Math.round(r.area)} m² on a ${r.roadW} m road: FSI ${r.fsi.toFixed(2)}, up to ${Math.round(r.bua)} m² built-up, ${r.rules.maxH} m high under the rules.`);
  if (brief.shops && brief.shops > allowed) {
    log('think', allowed ? `The brief asks for ${brief.shops} floors of shops; a ${r.roadW} m road allows ${allowed}. Trying ${allowed}.` : `The brief asks for shops; a ${r.roadW} m road doesn't allow them (9 m and wider). Leaving them out.`);
    shopsTry = [Math.min(brief.shops, allowed)];
  }
  if (brief.podium) log('think', 'A podium was asked for. The generator doesn\'t build podiums yet: the stilt is kept.');
  log('think', `Searching ${types.length} typolog${types.length > 1 ? 'ies' : 'y'} × ${caps.length} height cap${caps.length > 1 ? 's' : ''} × ${mixes.length} mix${mixes.length > 1 ? 'es' : ''} × ${shopsTry.length} shop option${shopsTry.length > 1 ? 's' : ''}, ranked by ${brief.goal === 'flats' ? 'flats' : brief.goal === 'bua' ? 'built-up area' : 'profit'}.`);

  const passed: OptionRow[] = [], near: { o: OptionRow; why: string[] }[] = [];
  const seen = new Set<string>();
  for (const t of types) for (const c of caps) for (const mix of mixes) for (const s of shopsTry) {
    const patch: Partial<ProProject> = { typology: t, maxFloors: c, mix, shops: { floors: s, depth: p.shops?.depth ?? 9, sale: p.shops?.sale ?? 0 } };
    const label = `${t === 'tower' ? 'Towers' : 'Slabs'}${c ? `, at most ${c} floors` : ''}${s ? `, shops on ${s === 1 ? 'the ground' : `${s} floors`}` : ''}`;
    const o = optionRow(p, patch, label);
    const key = [Math.round(o.bua), o.flats, o.floors, o.shops].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    // checking its own work: the rules first, then the brief
    const why: string[] = [];
    if (o.departures) why.push(`${o.departures} departure${o.departures > 1 ? 's' : ''} from the rules`);
    if (brief.maxHeight && o.height > brief.maxHeight + 0.01) why.push(`${o.height.toFixed(1)} m tall`);
    if (brief.minFlats && o.flats < brief.minFlats) why.push(`only ${o.flats} flats`);
    if (brief.maxFlats && o.flats > brief.maxFlats) why.push(`${o.flats} flats`);
    if (brief.minIrr !== undefined && (o.irr === null || o.irr < brief.minIrr)) why.push(`IRR ${o.irr === null ? 'none' : `${(o.irr * 100).toFixed(1)}%`}`);
    if (!o.flats) why.push('no flats');
    log('try', `${label}: ${o.flats} flats, ${o.floors} floors, ${Math.round(o.bua)} m², profit ${cr(o.profit)}.`);
    if (why.length) { log('check', `Rejected: ${why.join(', ')}.`); near.push({ o, why }); }
    else { log('check', 'Passes the rules and the brief.'); passed.push(o); }
  }
  passed.sort((a, b) => score(b, brief.goal) - score(a, brief.goal));
  if (passed.length) {
    const best = passed[0];
    log('pick', `Best: ${best.label}, ${best.flats} flats, profit ${cr(best.profit)}${best.irr !== null ? `, IRR ${(best.irr * 100).toFixed(1)}%` : ''}. ${passed.length} of ${seen.size} schemes passed.`);
    return { patch: best.patch, best, alternatives: passed.slice(1, 3), steps, met: true };
  }
  // nothing passed: the closest (fewest problems, then the goal)
  near.sort((a, b) => a.why.length - b.why.length || score(b.o, brief.goal) - score(a.o, brief.goal));
  const best = near[0]?.o ?? null;
  log('pick', best ? `Nothing met the whole brief. Closest: ${best.label} (${near[0].why.join(', ')}). Loosen the brief, or take this and adjust by hand.` : 'Nothing could be built on this plot.');
  return { patch: best?.patch ?? {}, best, alternatives: near.slice(1, 3).map((x) => x.o), steps, met: false };
}
