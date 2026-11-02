// The road model: a road is a width plus a few features. The map's standard (IRC / UDCPR, Pune USDG, Mumbai SDG)
// turns width + features into an exact cross-section from its templates (src/assets/catalog.ts), and any cross-section
// reads back as width + features + tier. Nothing is refused: a feature that doesn't fit is still applied (the lanes
// squeeze) and comes back flagged with the width it needs. Roads still store parts + cls; this only reads and writes them.
import type { Part } from '../net/model';
import type { AssetDef } from './model';
import { BUILTIN } from './catalog';
import { totalWidth, clone, DP_WIDTHS } from '../doc/xsection';

// ---------------- standards ----------------

export type StandardId = 'irc' | 'pune' | 'mumbai';
export const STANDARDS: { id: StandardId; label: string; short: string; source: string }[] = [
  { id: 'irc', label: 'IRC / UDCPR', short: 'IRC', source: 'IRC:86-2018 and UDCPR 2020 (Maharashtra)' },
  { id: 'pune', label: 'Pune USDG', short: 'Pune USDG', source: 'Pune Urban Street Design Guidelines (PMC, 2016)' },
  { id: 'mumbai', label: 'Mumbai SDG', short: 'Mumbai SDG', source: 'Street Design Guidelines for Greater Mumbai (MCGM, 2014)' },
];
/** The standard a map uses by default, from its city / region. */
export function standardFor(city: string | undefined): StandardId {
  const c = (city ?? '').toLowerCase();
  return c.includes('pune') || c.includes('pcmc') || c.includes('pimpri') ? 'pune' : c.includes('mumbai') || c.includes('bombay') ? 'mumbai' : 'irc';
}
export const isStandard = (s: unknown): s is StandardId => s === 'irc' || s === 'pune' || s === 'mumbai';

const FT = 0.3048;
const MUMBAI_FT = [20, 25, 30, 40, 50, 60, 70, 80, 100, 120, 150, 200];
/** Width ruler stops (m) and their labels: the 12 DP widths, or Mumbai's widths in feet. */
export function rulerStops(std: StandardId): { w: number; label: string; sub?: string }[] {
  if (std === 'mumbai') return MUMBAI_FT.map((f) => ({ w: Math.round(f * FT * 10) / 10, label: `${f} ft`, sub: `${Math.round(f * FT * 10) / 10}` }));
  return DP_WIDTHS.map((w) => ({ w, label: `${w}` }));
}

// ---------------- features ----------------

export type Feature = 'footpath' | 'cycle' | 'parking' | 'median' | 'service' | 'brt' | 'oneway';
export type Features = Record<Feature, boolean>;
export const FEATURE_IDS: Feature[] = ['footpath', 'cycle', 'parking', 'median', 'service', 'brt', 'oneway'];
export const FEATURES: { id: Feature; label: string; key: string }[] = [
  { id: 'footpath', label: 'Footpaths', key: 'F' },
  { id: 'cycle', label: 'Cycle track', key: 'C' },
  { id: 'parking', label: 'Parking', key: 'K' },
  { id: 'median', label: 'Median', key: 'M' },
  { id: 'service', label: 'Service lanes', key: 'V' },
  { id: 'brt', label: 'BRT', key: 'B' },
  { id: 'oneway', label: 'One-way', key: 'O' },
];
/** Size of each feature as the standard adds it (m; footpath, cycle, service lane per side; BRT both bus lanes). */
export const FEATURE_W: Record<StandardId, Record<Exclude<Feature, 'oneway'>, number>> = {
  irc: { footpath: 2, cycle: 2, parking: 2.5, median: 1.2, service: 3.5, brt: 7 },
  pune: { footpath: 2, cycle: 2, parking: 2, median: 1, service: 3, brt: 7 },
  mumbai: { footpath: 2, cycle: 2, parking: 2.5, median: 1.5, service: 3.5, brt: 7 },
};
export const NO_FEATURES: Features = { footpath: false, cycle: false, parking: false, median: false, service: false, brt: false, oneway: false };

const isTraffic = (p: Part) => p.kind === 'lane' || p.kind === 'bus';
const BARRIER = new Set(['sidewalk', 'planter', 'median']);

/** Runs of parts between barriers (footpaths, planters, medians): [start, end] index pairs. */
function runs(P: Part[]): [number, number][] {
  const out: [number, number][] = [];
  let s = -1;
  P.forEach((p, i) => {
    if (BARRIER.has(p.kind)) { if (s >= 0) out.push([s, i - 1]); s = -1; } else if (s < 0) s = i;
  });
  if (s >= 0) out.push([s, P.length - 1]);
  return out;
}
/** The runs holding general traffic lanes, and which of them are service lanes (the outer ones). */
function laneRuns(P: Part[]): { all: [number, number][]; service: Set<number> } {
  const all = runs(P).filter(([a, b]) => P.slice(a, b + 1).some((p) => p.kind === 'lane'));
  // the centre: the median nearest the middle, or a pair of bus lanes; the main carriageway is the lane run on
  // each side of it (without one: the widest run), and lanes in any other run are service lanes
  const total = P.reduce((a, p) => a + p.width, 0);
  let c = -1, best = Infinity, x = 0;
  P.forEach((p, i) => { if (p.kind === 'median') { const d = Math.abs(x + p.width / 2 - total / 2); if (d < best) { best = d; c = i; } } x += p.width; });
  if (c < 0) { const B = P.map((p, i) => (p.kind === 'bus' ? i : -1)).filter((i) => i >= 0); if (B.length >= 2) c = B[1] - 0.5; }
  const laneW = ([a, b]: [number, number]) => P.slice(a, b + 1).reduce((s, p) => s + (p.kind === 'lane' ? p.width : 0), 0);
  const main = new Set<number>();
  if (c >= 0) {
    let l = -1, r = -1;
    all.forEach(([a, b], k) => { if (a <= c && b >= c) main.add(k); else if (b < c) l = k; else if (r < 0) r = k; });
    if (l >= 0) main.add(l);
    if (r >= 0) main.add(r);
  } else if (all.length) {
    let k0 = 0;
    all.forEach((run, k) => { if (laneW(run) > laneW(all[k0]) + 0.01) k0 = k; });
    main.add(k0);
  }
  const service = new Set<number>();
  all.forEach(([a, b], k) => { if (!main.has(k)) for (let i = a; i <= b; i++) if (P[i].kind === 'lane') service.add(i); });
  return { all, service };
}

export function featuresOf(parts: Part[]): Features {
  const T = parts.filter(isTraffic);
  return {
    footpath: parts.some((p) => p.kind === 'sidewalk'),
    cycle: parts.some((p) => p.kind === 'cycle'),
    parking: parts.some((p) => p.kind === 'parking'),
    median: parts.some((p) => p.kind === 'median'),
    service: laneRuns(parts).service.size > 0,
    brt: parts.some((p) => p.kind === 'bus'),
    oneway: T.length > 0 && T.every((p) => p.dir === 1),
  };
}

const r2 = (v: number) => Math.round(v * 100) / 100;
/** Indices of the main carriageway's lanes (not service lanes, not bus lanes). */
function mainLanes(P: Part[]): number[] {
  const sv = laneRuns(P).service;
  return P.map((p, i) => (p.kind === 'lane' && !sv.has(i) ? i : -1)).filter((i) => i >= 0);
}
function leadVerge(P: Part[]) { let i = 0; while (i < P.length && (P[i].kind === 'sidewalk' || P[i].kind === 'planter')) i++; return i; }
function trailVerge(P: Part[]) { let j = P.length; while (j > 0 && (P[j - 1].kind === 'sidewalk' || P[j - 1].kind === 'planter')) j--; return j; }

/** Turn one feature on / off in a cross-section (width is fitted afterwards). */
export function setFeature(parts: Part[], f: Feature, on: boolean, std: StandardId = 'irc'): Part[] {
  let P = clone(parts);
  const W = FEATURE_W[std];
  const oneway = featuresOf(P).oneway;
  switch (f) {
    case 'footpath':
      if (!on) return P.filter((p) => p.kind !== 'sidewalk');
      if (P[0]?.kind !== 'sidewalk') P.unshift({ kind: 'sidewalk', width: W.footpath, dir: 0 });
      if (P[P.length - 1]?.kind !== 'sidewalk') P.push({ kind: 'sidewalk', width: W.footpath, dir: 0 });
      return P;
    case 'cycle':
      if (!on) return P.filter((p) => p.kind !== 'cycle');
      P.splice(leadVerge(P), 0, { kind: 'cycle', width: W.cycle, dir: 0 });
      P.splice(trailVerge(P), 0, { kind: 'cycle', width: W.cycle, dir: 0 });
      return P;
    case 'parking': {
      if (!on) return P.filter((p) => p.kind !== 'parking');
      const m = mainLanes(P);
      P.splice(m.length ? m[0] : leadVerge(P), 0, { kind: 'parking', width: W.parking, dir: 0 });
      return P;
    }
    case 'median': {
      if (!on) return P.filter((p) => p.kind !== 'median');
      let m = mainLanes(P);
      if (m.length === 1) { const i = m[0], w = P[i].width / 2; P.splice(i, 1, { kind: 'lane', width: w, dir: 1 }, { kind: 'lane', width: w, dir: oneway ? 1 : -1 }); m = mainLanes(P); }
      if (!m.length) return P;
      // between the forward and backward lanes (one-way: the middle)
      let at = m.findIndex((i) => P[i].dir === -1);
      if (at <= 0) at = Math.ceil(m.length / 2);
      const bus = P.findIndex((p) => p.kind === 'bus');
      P.splice(bus >= 0 && !oneway ? bus : m[at - 1] + 1, 0, { kind: 'median', width: W.median, dir: 0 });
      return P;
    }
    case 'service': {
      if (!on) {
        const sv = laneRuns(P).service;
        return P.filter((_, i) => !sv.has(i));
      }
      const a = leadVerge(P);
      P.splice(a, 0, { kind: 'lane', width: W.service, dir: 1 }, { kind: 'planter', width: 1.5, dir: 0 });
      const b = trailVerge(P);
      P.splice(b, 0, { kind: 'planter', width: 1.5, dir: 0 }, { kind: 'lane', width: W.service, dir: oneway ? 1 : -1 });
      return P;
    }
    case 'brt': {
      if (!on) {
        const out: Part[] = [];
        P.forEach((p, i) => {
          if (p.kind === 'bus') return;
          // the thin dividers either side of the bus lanes go with them
          if (p.kind === 'planter' && p.width <= 0.6 && (P[i - 1]?.kind === 'bus' || P[i + 1]?.kind === 'bus')) return;
          out.push(p);
        });
        return out;
      }
      if (P.some((p) => p.kind === 'bus')) return P;
      let m = mainLanes(P);
      if (oneway || !m.length) {
        const at = m.length ? m[m.length - 1] + 1 : trailVerge(P);
        P.splice(at, 0, { kind: 'planter', width: 0.5, dir: 0 }, { kind: 'bus', width: W.brt / 2, dir: 1 });
        return P;
      }
      if (m.length === 1) { const i = m[0], w = P[i].width / 2; P.splice(i, 1, { kind: 'lane', width: w, dir: 1 }, { kind: 'lane', width: w, dir: -1 }); m = mainLanes(P); }
      const med = P.findIndex((p) => p.kind === 'median');
      const block: Part[] = [{ kind: 'planter', width: 0.5, dir: 0 }, { kind: 'bus', width: W.brt / 2, dir: 1 }, { kind: 'bus', width: W.brt / 2, dir: -1 }, { kind: 'planter', width: 0.5, dir: 0 }];
      if (med >= 0) P.splice(med + 1, 0, ...block);
      else { const back = m.find((i) => P[i].dir === -1) ?? m[Math.ceil(m.length / 2)] ?? P.length; P.splice(back, 0, ...block); }
      return P;
    }
    case 'oneway': {
      const T = P.map((p, i) => (isTraffic(p) ? i : -1)).filter((i) => i >= 0);
      if (on) return P.map((p) => (isTraffic(p) ? { ...p, dir: 1 as const } : p));
      if (T.length === 1) { P[T[0]].dir = 0; return P; }
      // two-way: the left half runs +1, the right half −1 (India drives on the left)
      const med = P.findIndex((p) => p.kind === 'median');
      const m = mainLanes(P), sv = laneRuns(P).service;
      const half = med >= 0 ? med : m.length ? m[Math.ceil(m.length / 2) - 1] + 0.5 : P.length / 2;
      const buses = P.map((p, i) => (p.kind === 'bus' ? i : -1)).filter((i) => i >= 0);
      return P.map((p, i) => {
        if (p.kind === 'bus') return { ...p, dir: (buses.length > 1 ? (i === buses[0] ? 1 : -1) : 1) as Part['dir'] };
        if (p.kind !== 'lane') return p;
        if (sv.has(i)) return { ...p, dir: (i < P.length / 2 ? 1 : -1) as Part['dir'] };
        return { ...p, dir: (i < half ? 1 : -1) as Part['dir'] };
      });
    }
  }
}

/**
 * Fit a cross-section to a total width, keeping its features: the main carriageway lanes take the difference, adding
 * or dropping lanes to stay 2.75–3.75 m (balanced both ways); service lanes, footpaths, cycle tracks, parking, medians
 * and bus lanes keep their size. Too narrow even for the fewest lanes: the lanes squeeze, then everything else.
 */
export function fitWidth(parts: Part[], w: number): Part[] {
  let P = clone(parts);
  const W0 = totalWidth(P);
  if (Math.abs(W0 - w) < 0.005) return P;
  let m = mainLanes(P);
  if (!m.length) {
    // no general lanes (a footpath, a bus street): scale it
    const k = W0 > 0 ? w / W0 : 1;
    P = P.map((p) => ({ ...p, width: r2(p.width * k) }));
    P[P.length - 1].width = r2(P[P.length - 1].width + w - totalWidth(P));
    return P;
  }
  const laneSum = m.reduce((a, i) => a + P[i].width, 0);
  const space = laneSum + (w - W0);
  const oneway = m.every((i) => P[i].dir === 1) && !P.some((p) => isTraffic(p) && p.dir === -1);
  const twoWay = !oneway && (m.some((i) => P[i].dir === -1) || (m.length === 1 && space >= 5.5));
  const nMin = twoWay ? 2 : 1;
  let n = m.length;
  if (space / n < 2.75 || space / n > 3.75) {
    n = Math.max(nMin, Math.min(12, Math.round(space / 3.3)));
    if (twoWay && n % 2) n = space / (n + 1) >= 2.75 ? n + 1 : Math.max(2, n - 1);
    if (space / n < 2.75) n = Math.max(nMin, twoWay ? 2 * Math.floor(space / 5.5) : Math.floor(space / 2.75));
  }
  if (n !== m.length) {
    // a single shared lane becomes two-way
    if (m.length === 1 && P[m[0]].dir === 0 && twoWay) { P.splice(m[0], 1, { ...P[m[0]], dir: 1 }, { ...P[m[0]], dir: -1 }); m = mainLanes(P); }
    const want = oneway ? { f: n, b: 0 } : twoWay ? { f: n / 2, b: n / 2 } : { f: n, b: 0 };
    const fw = m.filter((i) => P[i].dir >= 0), bw = m.filter((i) => P[i].dir === -1);
    if (!twoWay && n === 1 && m.length > 1) { P = P.filter((_, i) => !m.slice(1).includes(i)); m = mainLanes(P); P[m[0]].dir = oneway ? 1 : 0; }
    else {
      // backward lanes first (higher indices), so forward indices stay valid
      const adj = (ids: number[], k: number, dir: Part['dir'], atStart: boolean) => {
        if (!ids.length && k > 0) return; // handled below
        if (k > ids.length) { const at = atStart ? ids[0] : ids[ids.length - 1] + 1; P.splice(at, 0, ...Array.from({ length: k - ids.length }, () => ({ kind: 'lane' as const, width: P[ids[0]].width, dir }))); }
        else if (k < ids.length) { const drop = new Set(atStart ? ids.slice(0, ids.length - k) : ids.slice(k)); P = P.filter((_, i) => !drop.has(i)); }
      };
      if (twoWay) { adj(bw, want.b, -1, true); adj(fw, want.f, 1, false); }
      else adj(fw, want.f, oneway ? 1 : 0, false);
    }
    m = mainLanes(P);
  }
  n = m.length;
  const laneMin = 2;
  if (space >= n * laneMin) {
    const each = r2(space / n);
    m.forEach((i, k) => { P[i].width = k === n - 1 ? r2(space - each * (n - 1)) : each; });
    // re-reading the lanes after adding / dropping some can shift which are service lanes: settle any remainder
    const left = r2(w - totalWidth(P));
    if (Math.abs(left) >= 0.01) { const L = P.filter((p) => p.kind === 'lane'); const d = left / L.length; for (const p of L) p.width = r2(p.width + d); }
    const fix = r2(w - totalWidth(P));
    if (fix) { const p = P.find((q) => q.kind === 'lane')!; p.width = r2(p.width + fix); }
    if (P.every((p) => p.width > 0.2)) return P;
  }
  // even the fewest lanes are under 2 m: lanes take a share, everything else scales into the rest
  const laneW = r2(Math.min(2.75, Math.max(0.5, w * 0.6 / n)));
  const rest = Math.max(0, w - laneW * n);
  const others = P.reduce((a, p, i) => a + (m.includes(i) ? 0 : p.width), 0);
  const k = others > 0 ? rest / others : 0;
  // thin dividers stay (at 2 cm): dropping them would merge service lanes into the carriageway
  P = P.map((p, i) => ({ ...p, width: m.includes(i) ? laneW : Math.max(0.02, r2(p.width * k)) }));
  const lane = P.findIndex((p) => p.kind === 'lane');
  P[lane].width = r2(P[lane].width + w - totalWidth(P));
  return P;
}

// ---------------- tiers ----------------

export type Tier = 'lane' | 'local' | 'collector' | 'subarterial' | 'arterial' | 'highway';
export const TIERS: { id: Tier; label: string; short: string; from: number }[] = [
  { id: 'lane', label: 'Lane', short: 'Lane', from: 0 },
  { id: 'local', label: 'Local', short: 'Local', from: 9 },
  { id: 'collector', label: 'Collector', short: 'Collector', from: 15 },
  { id: 'subarterial', label: 'Sub-arterial', short: 'Sub-art.', from: 24 },
  { id: 'arterial', label: 'Arterial', short: 'Arterial', from: 36 },
  { id: 'highway', label: 'Highway', short: 'Hwy', from: 60 },
];
const CLS_TIER: Record<string, Tier> = {
  living_street: 'lane', service: 'lane', track: 'lane', residential: 'local', unclassified: 'local', road: 'local',
  tertiary: 'collector', secondary: 'subarterial', primary: 'arterial', trunk: 'highway', motorway: 'highway',
};
/** The OSM class a tier is stored as (routing / export). */
export const TIER_CLS: Record<Tier, string> = { lane: 'living_street', local: 'residential', collector: 'tertiary', subarterial: 'secondary', arterial: 'primary', highway: 'trunk' };
export const tierLabel = (t: Tier) => TIERS.find((x) => x.id === t)!.label;
export function tierByWidth(w: number): Tier {
  let t: Tier = 'lane';
  for (const x of TIERS) if (w >= x.from - 0.01) t = x.id;
  return t;
}
/** Lane → Highway from the standard's template class, or the width when the class doesn't say (BRT, unknown). */
export function tierOf(width: number, cls?: string): Tier {
  const t = cls ? CLS_TIER[cls] : undefined;
  if (!t) return tierByWidth(width);
  // a template stretched far from its class follows the width
  const byW = TIERS.findIndex((x) => x.id === tierByWidth(width)), byC = TIERS.findIndex((x) => x.id === t);
  return Math.abs(byW - byC) >= 2 ? TIERS[Math.round((byW + byC) / 2)].id : t;
}

// ---------------- templates ----------------

export interface Template {
  /** the catalogue asset id */
  id: string;
  /** short code ("18B", "Collector 15 m") */
  code: string;
  name: string;
  use?: string;
  pack: string;
  width: number;
  cls: string;
  parts: Part[];
  features: Features;
  source: string;
}
const codeOf = (a: AssetDef) => (a.pack === 'pune' ? a.id.slice(5) : a.pack === 'mumbai' ? /\d+ ft/.exec(a.name)?.[0] ?? a.name : a.name.split(',')[0]);
let TPL: Template[] | null = null;
/** Every street template in the catalogue (no flyovers / underpasses, no DP-width stretches, no saved ones). */
export function allTemplates(): Template[] {
  if (TPL) return TPL;
  TPL = BUILTIN.filter((a) => a.drawer === 'network' && a.profile.type === 'street' && !a.lift && !a.id.startsWith('road.dp') && a.id !== 'road.subway').map((a) => {
    const prof = a.profile as Extract<AssetDef['profile'], { type: 'street' }>;
    return { id: a.id, code: codeOf(a), name: a.name, use: a.use, pack: a.pack, width: totalWidth(prof.parts), cls: prof.cls, parts: prof.parts, features: featuresOf(prof.parts), source: a.source };
  });
  return TPL;
}
/** The standard's own templates, then the core ones as a fallback. */
export function templates(std: StandardId): { own: Template[]; core: Template[] } {
  const all = allTemplates();
  const own = all.filter((t) => (std === 'irc' ? t.pack === 'core' : t.pack === std));
  return { own, core: std === 'irc' ? [] : all.filter((t) => t.pack === 'core') };
}

/** The narrowest road in this standard that has a feature (what the amber flag says it needs). */
export function needs(f: Feature, std: StandardId): number | undefined {
  const { own, core } = templates(std);
  const w = (L: Template[]) => L.filter((t) => t.features[f]).reduce((a, t) => Math.min(a, t.width), Infinity);
  const v = Math.min(w(own), w(core));
  return Number.isFinite(v) ? v : undefined;
}

// ---------------- match & read ----------------

export interface Flag { feature: Feature; need: number; text: string }
export interface Match {
  parts: Part[];
  cls: string;
  tier: Tier;
  /** the template it was read from */
  template: Template;
  /** templates that fit exactly (same width and features in this standard): the variant dots */
  variants: Template[];
  /** exactly a template (not stretched, no features changed) */
  exact: boolean;
  /** "18B" or "based on 18A" */
  label: string;
  flags: Flag[];
}

const sameFeatures = (a: Features, b: Features) => FEATURE_IDS.every((f) => a[f] === b[f]);
export const samePart = (a: Part, b: Part) => a.kind === b.kind && a.dir === b.dir && Math.abs(a.width - b.width) < 0.02;
export const sameParts = (a: Part[], b: Part[]) => a.length === b.length && a.every((p, i) => samePart(p, b[i]));

/**
 * Width + features → a cross-section from the standard's templates. Never empty: the nearest template is stretched
 * (and given / relieved of features) when none fits exactly. `variant` picks among exact fits (a template id or code).
 */
export function match(width: number, want: Partial<Features>, std: StandardId, variant?: string): Match {
  const F: Features = { ...NO_FEATURES, ...want };
  const W = Math.max(0.5, width);
  const { own, core } = templates(std);
  const score = (t: Template, pref: number) => {
    let s = pref;
    for (const f of FEATURE_IDS) if (F[f] !== t.features[f]) s += f === 'oneway' ? 2 : F[f] ? 8 : 5;
    return s + Math.abs(t.width - W) * (t.width < W ? 1.2 : 1);
  };
  const ranked = [...own.map((t) => ({ t, s: score(t, 0) })), ...core.map((t) => ({ t, s: score(t, 3) }))].sort((a, b) => a.s - b.s);
  const variants = (own.length ? own : core).filter((t) => sameFeatures(t.features, F) && Math.abs(t.width - W) < 0.01).sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  const pick = (variant && variants.find((t) => t.id === variant || t.code === variant)) || variants[0] || ranked[0].t;
  let parts = clone(pick.parts);
  for (const f of FEATURE_IDS) if (f !== 'oneway' && F[f] !== featuresOf(parts)[f]) parts = setFeature(parts, f, F[f], std);
  if (F.oneway !== featuresOf(parts).oneway) parts = setFeature(parts, 'oneway', F.oneway, std);
  parts = fitWidth(parts, W);
  const exact = sameParts(parts, pick.parts);
  const cls = F.brt ? 'busway' : pick.cls === 'busway' ? TIER_CLS[tierByWidth(W)] : pick.cls;
  const tier = tierOf(W, cls === 'busway' ? undefined : cls);
  return { parts, cls, tier, template: pick, variants, exact, label: exact ? pick.code : `based on ${pick.code}`, flags: flagsOf(parts, F, std) };
}

/** Features that don't fit at this width in this standard: amber, with the width they need. */
export function flagsOf(parts: Part[], F: Features, std: StandardId): Flag[] {
  const W = totalWidth(parts);
  const lanes = parts.filter((p) => p.kind === 'lane');
  const lw = lanes.length ? Math.min(...lanes.map((p) => p.width)) : 3;
  const out: Flag[] = [];
  for (const f of FEATURE_IDS) {
    if (!F[f] || f === 'oneway' || f === 'footpath') continue;
    const need = needs(f, std);
    if (need === undefined ? lw < 2.75 : W < need - 0.01) {
      const n = need ?? Math.ceil(W + (2.75 - lw) * lanes.length);
      const label = FEATURES.find((x) => x.id === f)!.label;
      out.push({ feature: f, need: n, text: `${label} needs ${n} m in this standard${lw < 2.75 ? `; lanes are ${Math.round(lw * 10) / 10} m` : ''}` });
    }
  }
  return out;
}

export interface Reading {
  width: number;
  features: Features;
  tier: Tier;
  /** not exactly what the standard makes of this width + features (hand-edited or imported) */
  custom: boolean;
  /** the template it is (or the one the standard would use) */
  template?: Template;
  label: string;
}
/** A cross-section → width + features + tier, and whether it's one of the standard's templates or custom. */
export function read(parts: Part[], std: StandardId, cls?: string): Reading {
  const width = totalWidth(parts), features = featuresOf(parts);
  const m = match(width, features, std);
  const exact = [m, ...m.variants.map((v) => ({ parts: v.parts, template: v }))].find((x) => sameParts(x.parts, parts));
  const any = exact ? undefined : allTemplates().find((t) => sameParts(t.parts, parts));
  const t = exact?.template ?? any;
  const custom = !t;
  const tier = tierOf(width, (cls ?? t?.cls) === 'busway' ? undefined : cls ?? t?.cls);
  const label = t ? (sameParts(t.parts, parts) ? t.code : `based on ${t.code}`) : 'custom';
  return { width, features, tier, custom, template: t ?? m.template, label };
}

// ---------------- picker assets ----------------

/** A picked road as an asset id (so the road tool and the section's `asset` can carry it): rm~std~width~flags~variant. */
export function encode(std: StandardId, width: number, F: Partial<Features>, variant?: string): string {
  const flags = FEATURE_IDS.filter((f) => F[f]).map((f) => FEATURES.find((x) => x.id === f)!.key.toLowerCase()).join('');
  return `rm~${std}~${Math.round(width * 100) / 100}~${flags || '-'}${variant ? `~${variant}` : ''}`;
}
export function decode(id: string): { std: StandardId; width: number; features: Features; variant?: string } | null {
  const m = /^rm~(\w+)~([\d.]+)~([a-z-]+)(?:~(.+))?$/.exec(id);
  if (!m || !isStandard(m[1])) return null;
  const F = { ...NO_FEATURES };
  for (const c of m[3]) { const f = FEATURES.find((x) => x.key.toLowerCase() === c); if (f) F[f.id] = true; }
  return { std: m[1], width: Number(m[2]), features: F, variant: m[4] };
}
const made = new Map<string, AssetDef>();
/** The asset for a picked road: the template itself when it fits exactly, else a derived one. */
export function assetFor(id: string): AssetDef | undefined {
  if (made.has(id)) return made.get(id);
  const d = decode(id);
  if (!d) return undefined;
  const m = match(d.width, d.features, d.std, d.variant);
  const a: AssetDef = {
    id, category: 'roads', tab: 'Road picker', name: `${Math.round(d.width * 10) / 10} m ${tierLabel(m.tier)} · ${m.label}`,
    use: m.template.use, drawer: 'network', profile: { type: 'street', cls: m.cls, parts: m.parts },
    source: `${STANDARDS.find((s) => s.id === d.std)!.label}: ${m.exact ? 'template' : 'after template'} ${m.template.code} — ${m.template.source}`, pack: d.std,
  };
  made.set(id, a);
  return a;
}
/** The id to build / store for a match: the template's own id when it's exact. */
export function pickId(std: StandardId, width: number, F: Partial<Features>, variant?: string): string {
  const m = match(width, F, std, variant);
  return m.exact ? m.template.id : encode(std, width, F, variant);
}
