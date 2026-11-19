// Many options for one plot, ranked by profit. The generator is run over the choices a developer weighs in the
// first meeting:
// - slabs or towers;
// - a height cap at the fire-rule steps (under 15 m: no fire NOC; under 24 m: no refuge floors or fire lift;
//   under 45 m) or as high as the rules allow;
// - the flat mix;
// - shops on the ground floor where the road allows them.
// That's up to 3 × 4 × 3 × 2 = 72 runs. Each is the full scheme (a few ms to tens of ms), so it takes a second or
// two. Schemes that come out the same (a cap above what the rules allow anyway) are kept once.
import { TYPOLOGIES } from '../doc/optimise';
import { designOf, evaluate } from './evaluate';
import { shopFloorsAllowed } from './mixed';
import type { ProProject } from './project';

export interface OptionRow {
  id: string; label: string; patch: Partial<ProProject>;
  bua: number; fsiUsed: number; flats: number; shops: number; buildings: number; height: number; floors: string;
  profit: number; margin: number; irr: number | null; departures: number;
}

export const MIXES: { key: string; label: string; mix: [number, number, number] }[] = [
  { key: 'small', label: 'mostly 1 BHK', mix: [0.5, 0.35, 0.15] },
  { key: 'balanced', label: 'mostly 2 BHK', mix: [0.2, 0.5, 0.3] },
  { key: 'large', label: 'mostly 3 BHK', mix: [0.1, 0.35, 0.55] },
];
/** height steps that change what a building needs (m): fire NOC over 15 m, refuge floors and a fire lift over 24 m */
export const HEIGHT_STEPS = [15, 24, 45];

/** Floors of flats that keep a building under `h` m (over the stilt). */
export const floorsUnder = (h: number, floorH: number) => Math.max(1, Math.floor((h - 0.01) / floorH) - 1);

/** Evaluate one variant of the project and summarise it as a row. */
export function optionRow(p: ProProject, patch: Partial<ProProject>, label: string): OptionRow {
  // (an option is the plot filled again to its settings: buildings shaped by hand are set aside)
  const e = evaluate({ ...p, ...patch, scheme: undefined });
  const d = e.d;
  return {
    id: JSON.stringify(patch), label, patch,
    bua: d.bua, fsiUsed: e.r.area > 0 ? d.bua / e.r.area : 0, flats: d.flats, shops: e.shops?.count ?? 0,
    buildings: d.buildings.length, height: d.height, floors: d.buildings.map((b) => b.floors).join(' + '),
    profit: d.money.profit, margin: d.money.margin, irr: d.money.irr, departures: d.departures.length,
  };
}

export function exploreOptions(p: ProProject, opts: { limit?: number } = {}): OptionRow[] {
  const fh = designOf(p).floorH;
  const r0 = evaluate(p).r;
  const shopsOk = shopFloorsAllowed(r0.roadW) >= 1;
  const caps: { floors: number; label: string }[] = [{ floors: 0, label: 'as high as allowed' }];
  for (const h of HEIGHT_STEPS) if (h < r0.rules.maxH + 0.01) caps.push({ floors: floorsUnder(h, fh), label: `under ${h} m` });
  const types = TYPOLOGIES.filter((t) => t.value !== 'auto');
  const seen = new Map<string, OptionRow>();
  for (const t of types) for (const c of caps) for (const m of MIXES) for (const s of shopsOk ? [0, 1] : [0]) {
    const patch: Partial<ProProject> = { typology: t.value, maxFloors: c.floors, mix: m.mix, shops: { floors: s, depth: p.shops?.depth ?? 9, sale: p.shops?.sale ?? 0 } };
    const row = optionRow(p, patch, `${t.label}, ${c.label}, ${m.label}${s ? ', shops on the ground' : ''}`);
    // the same scheme reached two ways (a cap that doesn't bite): keep the first
    const key = [row.bua.toFixed(0), row.flats, row.shops, row.floors, row.buildings, Math.round(row.profit / 1e4)].join('|');
    if (!seen.has(key)) seen.set(key, row);
  }
  const rows = [...seen.values()].sort((a, b) => b.profit - a.profit);
  return opts.limit ? rows.slice(0, opts.limit) : rows;
}
