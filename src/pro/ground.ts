// The plot's ground (docs/plans/plot-ground.md §2): what its surface is, the layers of earth under it down to the
// bedrock, where the water stands, boreholes when there are several, and spot heights across it. ./foundation.ts
// reads it for each building's foundation and the basements' dig.
//
// Every figure in the soils table is a starting assumption for a feasibility estimate, to be checked (plan §8): the
// bearing values are orders of magnitude after NBC 2016 Part 6 Section 2's presumptive values and IS 6403; the rates
// are rough 2026 Pune figures (Mumbai's a quarter more). A layer can carry its own bearing figure from a soil report.
import type { PlotCode } from '../doc/plot';
import { levelAt, type Levels } from './siteObjects';

export type SoilKind = 'fill' | 'black-cotton' | 'soft-clay' | 'stiff-clay' | 'silt' | 'loose-sand' | 'dense-sand' | 'gravel' | 'murum' | 'soft-rock' | 'hard-rock';
/** how a layer is dug: by machine as soil, ripped, broken with a breaker, or split / blasted under control */
export type DigKind = 'soil' | 'ripped' | 'breaker' | 'blast';
export interface Soil {
  kind: SoilKind; label: string; short: string;
  /** its colour in the log, the cut-away and the drawings, and the surface texture's pattern */
  colour: string; pattern: 'sand' | 'cracked' | 'gravel' | 'rock' | 'plain';
  /** presumptive safe bearing capacity, kN/m² (0: not founded on) */
  sbc: number;
  /** unit weight, kN/m³ */
  gamma: number;
  dig: DigKind;
  /** a cut stands vertical for a while unsupported (short-term, dry) */
  stands: boolean;
  /** rock: piles socket into it, cuts are bolted not shored */
  rock: boolean;
  /** swells and shrinks with the seasons (found below the active zone) */
  expansive?: boolean;
  /** loose and fine: may liquefy when saturated in an earthquake */
  liquefiable?: boolean;
  /** how freely water moves through it (dewatering's cost) */
  perm: 'low' | 'medium' | 'high';
  note: string;
}

export const SOILS: Record<SoilKind, Soil> = {
  'fill': { kind: 'fill', label: 'Fill / made ground', short: 'Fill', colour: '#a59c8a', pattern: 'gravel', sbc: 0, gamma: 17, dig: 'soil', stands: false, rock: false, perm: 'high', note: 'Never founded on: gone through. Reclaimed land, old rubble.' },
  'black-cotton': { kind: 'black-cotton', label: 'Black cotton soil', short: 'Black cotton', colour: '#3b3631', pattern: 'cracked', sbc: 75, gamma: 17, dig: 'soil', stands: false, rock: false, expansive: true, perm: 'low', note: 'Expansive: swells in the rains and cracks in summer. Found below about 3.5 m, or on under-reamed piles.' },
  'soft-clay': { kind: 'soft-clay', label: 'Soft clay (marine)', short: 'Soft clay', colour: '#6f8a9a', pattern: 'plain', sbc: 50, gamma: 16, dig: 'soil', stands: false, rock: false, perm: 'low', note: 'Settles under load: piles go through it.' },
  'stiff-clay': { kind: 'stiff-clay', label: 'Stiff clay', short: 'Stiff clay', colour: '#8a6a4a', pattern: 'plain', sbc: 200, gamma: 19, dig: 'soil', stands: true, rock: false, perm: 'low', note: 'Bears a raft well; cuts stand for a short while.' },
  'silt': { kind: 'silt', label: 'Silt', short: 'Silt', colour: '#b5a58a', pattern: 'plain', sbc: 100, gamma: 18, dig: 'soil', stands: false, rock: false, perm: 'medium', note: '' },
  'loose-sand': { kind: 'loose-sand', label: 'Loose sand', short: 'Loose sand', colour: '#dcc78f', pattern: 'sand', sbc: 100, gamma: 17, dig: 'soil', stands: false, rock: false, liquefiable: true, perm: 'high', note: 'May liquefy when saturated in an earthquake (zone III and up).' },
  'dense-sand': { kind: 'dense-sand', label: 'Dense sand', short: 'Dense sand', colour: '#c9a95f', pattern: 'sand', sbc: 400, gamma: 19, dig: 'soil', stands: false, rock: false, perm: 'high', note: '' },
  'gravel': { kind: 'gravel', label: 'Gravel', short: 'Gravel', colour: '#a89a80', pattern: 'gravel', sbc: 450, gamma: 20, dig: 'soil', stands: false, rock: false, perm: 'high', note: '' },
  'murum': { kind: 'murum', label: 'Murum (weathered basalt)', short: 'Murum', colour: '#9a5a3a', pattern: 'gravel', sbc: 350, gamma: 20, dig: 'ripped', stands: true, rock: false, perm: 'medium', note: 'Ripped by machine; a good bearing layer.' },
  'soft-rock': { kind: 'soft-rock', label: 'Soft / weathered rock', short: 'Soft rock', colour: '#8b7358', pattern: 'rock', sbc: 650, gamma: 22, dig: 'breaker', stands: true, rock: true, perm: 'medium', note: 'Broken with a rock breaker.' },
  'hard-rock': { kind: 'hard-rock', label: 'Hard rock (basalt)', short: 'Hard rock', colour: '#45474e', pattern: 'rock', sbc: 2000, gamma: 27, dig: 'blast', stands: true, rock: true, perm: 'low', note: 'Split or blasted under control: slow and dear to dig, the best to found on.' },
};
export const SOIL_KINDS = Object.keys(SOILS) as SoilKind[];

/** what the surface is: a kind of earth, or grass, scrub or paving */
export type Cover = SoilKind | 'grass' | 'scrub' | 'paved';
export const COVERS: { value: Cover; label: string; colour: string; pattern: Soil['pattern'] }[] = [
  ...SOIL_KINDS.map((k) => ({ value: k as Cover, label: SOILS[k].short, colour: SOILS[k].colour, pattern: SOILS[k].pattern })),
  { value: 'grass', label: 'Grass', colour: '#7f9a62', pattern: 'plain' },
  { value: 'scrub', label: 'Scrub', colour: '#9a9468', pattern: 'gravel' },
  { value: 'paved', label: 'Paved', colour: '#b8b3a8', pattern: 'plain' },
];
export const coverOf = (c: Cover) => COVERS.find((x) => x.value === c) ?? COVERS[0];

/** a layer: its kind and thickness (m); a bearing figure (kN/m²) and SPT N from a report when known */
export interface Layer { kind: SoilKind; thick: number; sbc?: number; spt?: number }
/** a borehole: its log at a point (plot metres) */
export interface Hole { id: string; at: [number, number]; layers: Layer[]; water: number | null }

export interface PlotGround {
  cover: Cover;
  /** the layers from the surface down; the last runs to any depth */
  layers: Layer[];
  /** the groundwater at its highest (the monsoon), m below the surface; null: none found */
  water: number | null;
  /** several boreholes: the ground between them interpolated (the plot's `layers` are then the middle's) */
  holes?: Hole[];
  /** spot heights (x, z, m over the road), when the plot's levels are more than its plane */
  spots?: [number, number, number][];
  /** where it came from */
  src: 'preset' | 'user' | 'report';
  /** the preset it was set from */
  preset?: string;
}

export interface GroundPreset { id: string; label: string; note: string; cities?: string[]; g: Omit<PlotGround, 'src'> }
export const GROUND_PRESETS: GroundPreset[] = [
  { id: 'pune', label: 'Pune, typical', cities: ['pune', 'pune-congested'], note: 'Black cotton soil over murum over the Deccan basalt.',
    g: { cover: 'black-cotton', layers: [{ kind: 'black-cotton', thick: 1.5 }, { kind: 'murum', thick: 3 }, { kind: 'soft-rock', thick: 2 }, { kind: 'hard-rock', thick: 30 }], water: null } },
  { id: 'pune-rock', label: 'Pune, rock near the surface', cities: ['pune'], note: 'A thin skin of murum on basalt: hills and ridges.',
    g: { cover: 'murum', layers: [{ kind: 'murum', thick: 1 }, { kind: 'hard-rock', thick: 30 }], water: null } },
  { id: 'mumbai-suburbs', label: 'Mumbai suburbs', cities: ['mumbai-suburbs'], note: 'Fill over soft marine clay over weathered rock and basalt; water high.',
    g: { cover: 'fill', layers: [{ kind: 'fill', thick: 2 }, { kind: 'soft-clay', thick: 6 }, { kind: 'soft-rock', thick: 3 }, { kind: 'hard-rock', thick: 30 }], water: 2 } },
  { id: 'mumbai-island', label: 'Mumbai island city, reclaimed', cities: ['mumbai-island'], note: 'Reclaimed fill, soft clay and sand over rock; water close under the surface.',
    g: { cover: 'fill', layers: [{ kind: 'fill', thick: 3 }, { kind: 'soft-clay', thick: 8 }, { kind: 'loose-sand', thick: 3 }, { kind: 'soft-rock', thick: 3 }, { kind: 'hard-rock', thick: 30 }], water: 1.5 } },
  { id: 'sandy', label: 'Sandy', note: 'Loose sand over dense sand, rock deep.',
    g: { cover: 'loose-sand', layers: [{ kind: 'loose-sand', thick: 3 }, { kind: 'dense-sand', thick: 12 }, { kind: 'hard-rock', thick: 30 }], water: 6 } },
  { id: 'clay', label: 'Clay', note: 'Stiff clay over weathered rock.',
    g: { cover: 'stiff-clay', layers: [{ kind: 'stiff-clay', thick: 10 }, { kind: 'soft-rock', thick: 30 }], water: 5 } },
];
export const presetById = (id: string) => GROUND_PRESETS.find((x) => x.id === id);
/** the city's typical ground */
export function groundFor(city: string): PlotGround {
  const P = GROUND_PRESETS.find((x) => x.cities?.includes(city)) ?? GROUND_PRESETS[0];
  return { ...structuredClone(P.g), src: 'preset', preset: P.id };
}

/** "Sand, bedrock at about 15 m, water at 4 m": a top layer to the rock, the rock below */
export function quickLayers(top: SoilKind, rockAt: number | null, rock: SoilKind = 'hard-rock'): Layer[] {
  if (SOILS[top].rock) return [{ kind: top, thick: 30 }];
  if (rockAt === null || !(rockAt > 0)) return [{ kind: top, thick: 40 }];
  return [{ kind: top, thick: Math.max(0.1, rockAt) }, { kind: rock, thick: 30 }];
}

/** a log as runs from the surface: top and bottom depths (the last to Infinity) */
export interface Run { kind: SoilKind; top: number; bottom: number; sbc: number }
export function runsOf(layers: Layer[]): Run[] {
  const out: Run[] = [];
  let d = 0;
  layers.forEach((l, i) => { const t = Math.max(0, l.thick); out.push({ kind: l.kind, top: d, bottom: i === layers.length - 1 ? Infinity : d + t, sbc: l.sbc ?? SOILS[l.kind].sbc }); d += t; });
  return out.length ? out : [{ kind: 'stiff-clay', top: 0, bottom: Infinity, sbc: SOILS['stiff-clay'].sbc }];
}
/** what's at a depth */
export const runAt = (runs: Run[], depth: number) => runs.find((r) => depth >= r.top && depth < r.bottom) ?? runs[runs.length - 1];
/** the depth to rock (soft or hard): null when the log finds none */
export const rockTop = (runs: Run[]) => runs.find((r) => SOILS[r.kind].rock)?.top ?? null;
/** the mean unit weight of what lies above a depth (kN/m³) */
export function gammaTo(runs: Run[], depth: number): number {
  if (depth <= 0) return 18;
  let w = 0;
  for (const r of runs) { const a = Math.max(0, Math.min(depth, r.bottom) - r.top); w += a * SOILS[r.kind].gamma; }
  return w / depth;
}

/** the log and water at a point: the nearest holes' logs blended (each kind's thickness weighted by the inverse
 *  square of the distance, where the holes share their sequence of kinds; the nearest hole's otherwise) */
export function groundAtPoint(g: PlotGround, x: number, z: number): { layers: Layer[]; water: number | null } {
  const H = (g.holes ?? []).filter((h) => h.layers.length);
  if (!H.length) return { layers: g.layers, water: g.water };
  const w = H.map((h) => { const d = Math.hypot(h.at[0] - x, h.at[1] - z); return d < 0.01 ? 1e6 : 1 / (d * d); });
  const near = H[w.indexOf(Math.max(...w))];
  const seq = (h: Hole) => h.layers.map((l) => l.kind).join('|');
  if (!H.every((h) => seq(h) === seq(near))) return { layers: near.layers, water: near.water };
  const W = w.reduce((a, b) => a + b, 0);
  const layers = near.layers.map((l, k) => ({ ...l, thick: H.reduce((a, h, i) => a + h.layers[k].thick * w[i], 0) / W }));
  const wet = H.filter((h) => h.water !== null);
  const water = wet.length ? wet.reduce((a, h) => a + h.water! * w[H.indexOf(h)], 0) / wet.reduce((a, h) => a + w[H.indexOf(h)], 0) : null;
  return { layers, water };
}

/** the ground's height at a point (m over the road): the levels' plane, bent through the spot heights (each spot's
 *  difference from the plane spread by inverse distance squared) */
export function heightAt(L: Levels, spots: [number, number, number][] | undefined, x: number, z: number, cx: number, cz: number, north = 0): number {
  const base = levelAt(L, x, z, cx, cz, north);
  if (!spots?.length) return base;
  let sw = 0, sv = 0;
  for (const [sx, sz, h] of spots) {
    const d2 = (sx - x) ** 2 + (sz - z) ** 2;
    if (d2 < 1e-4) return h;
    const w = 1 / d2; sw += w; sv += w * (h - levelAt(L, sx, sz, cx, cz, north));
  }
  return base + sv / sw;
}

/** the seismic zone (IS 1893 (Part 1) 2016): Pune and Mumbai are both zone III */
export const seismicZone = (_city: string): 'II' | 'III' | 'IV' | 'V' => 'III';
/** rates by city: Mumbai's about a quarter over Pune's (as assumed) */
export const cityFactor = (code: PlotCode) => (code === 'udcpr' ? 1 : 1.25);

/** words in a soil report's description, to kinds (first match wins: the specific before the general) */
const WORDS: [RegExp, SoilKind][] = [
  [/black\s*cotton|\bbc\s*soil|expansive/i, 'black-cotton'], [/fill|made\s*ground|rubble|debris/i, 'fill'],
  [/weathered\s*(rock|basalt)|soft\s*rock|fractured|jointed/i, 'soft-rock'],
  [/hard\s*(rock|basalt)|fresh\s*(rock|basalt)|compact\s*basalt|\bbasalt\b/i, 'hard-rock'], [/mur(r)?um|moorum|morum/i, 'murum'],
  [/soft\s*(marine\s*)?clay|marine\s*clay|very\s*soft/i, 'soft-clay'], [/clay/i, 'stiff-clay'], [/silt/i, 'silt'],
  [/loose\s*(fine\s*)?sand|fine\s*sand/i, 'loose-sand'], [/sand/i, 'dense-sand'], [/gravel|boulder|cobble/i, 'gravel'], [/rock/i, 'soft-rock'],
];
export const kindOfWords = (s: string): SoilKind | null => WORDS.find(([re]) => re.test(s))?.[1] ?? null;

/** A borehole log pasted from a report: lines with a depth range and a description ("0 – 1.5 m  black cotton
 *  soil", "1.5-4.5 murum, N = 32"), and a water line ("water table at 4.2 m"). The layers it reads, the water, and
 *  the lines it couldn't. */
export function parseLog(text: string): { layers: Layer[]; water: number | null; skipped: string[] } {
  const layers: Layer[] = [], skipped: string[] = [];
  let water: number | null = null, last = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    const wm = /(water|gwt|ground\s*water)[^0-9]*([0-9]+(?:\.[0-9]+)?)/i.exec(line);
    if (wm && !/[0-9]+(?:\.[0-9]+)?\s*(?:m)?\s*(?:-|–|—|to)\s*[0-9]/i.test(line)) { water = +wm[2]; continue; }
    const rm = /([0-9]+(?:\.[0-9]+)?)\s*(?:m)?\s*(?:-|–|—|to)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:m\b)?\s*(.*)$/i.exec(line);
    const kind = kindOfWords(rm ? rm[3] : line);
    if (!rm || !kind) { skipped.push(line); continue; }
    const a = +rm[1], b = +rm[2];
    if (!(b > a)) { skipped.push(line); continue; }
    if (a > last + 0.05 && layers.length) layers[layers.length - 1].thick += a - last;
    const spt = /\bN\s*=?\s*([0-9]+)|SPT\s*([0-9]+)/i.exec(rm[3]);
    const prev = layers[layers.length - 1];
    if (prev && prev.kind === kind) prev.thick += b - Math.max(a, last);
    else layers.push({ kind, thick: b - (layers.length ? Math.max(a, last) : 0), ...(spt ? { spt: +(spt[1] ?? spt[2]) } : {}) });
    last = b;
  }
  return { layers, water, skipped };
}

/** the layers as a sentence: "Black cotton 1.5 m · Murum 3 m · Hard rock below 4.5 m" */
export function logText(layers: Layer[]): string {
  const R = runsOf(layers);
  return R.map((r, i) => (i === R.length - 1 ? `${SOILS[r.kind].short} below ${fmt(r.top)} m` : `${SOILS[r.kind].short} ${fmt(r.bottom - r.top)} m`)).join(' · ');
}
const fmt = (v: number) => (Math.round(v * 10) / 10).toString();
