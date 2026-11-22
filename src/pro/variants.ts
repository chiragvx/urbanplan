// Options (the project's variants; ./options.ts is Explore's engine that finds many): a project's alternative schemes on the same plot, rules and prices. The project's own fields are always
// the current option's, so everything else in Pro reads and changes it as before; the list keeps each option's copy
// of what varies between them (the scheme, the fill, the type and mix, shops, the look, the FSI ladder). Switching
// keeps the current one's copy and lays the other's over the project. In the project's JSON: no new table.
import type { ProProject } from './project';

/** what differs from option to option; the plot, rules, prices and the deal are shared */
export const VARY = ['typology', 'maxFloors', 'mix', 'style', 'custom', 'shops', 'buildingStyle', 'fill', 'scheme', 'systems', 'load'] as const;
export type Varying = Pick<ProProject, (typeof VARY)[number]>;

export interface ProOption {
  id: string;
  name: string;
  /** how it was made */
  made: 'by hand' | 'brief' | 'explore';
  /** when (ISO) */
  at: string;
  /** its copy of what varies (the current option's is refreshed on every switch) */
  patch: Partial<Varying>;
}

const clone = <T,>(x: T): T => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
export const snapshot = (p: ProProject): Partial<Varying> => Object.fromEntries(VARY.map((k) => [k, clone(p[k])])) as Partial<Varying>;
/** the project's fields set to an option's copy (a field it doesn't have is cleared) */
const laid = (patch: Partial<Varying>): Partial<ProProject> => Object.fromEntries(VARY.map((k) => [k, clone(patch[k])])) as Partial<ProProject>;

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const nextName = (os: ProOption[]) => { for (const L of LETTERS) if (!os.some((o) => o.name === `Option ${L}`)) return `Option ${L}`; return `Option ${os.length + 1}`; };
const newId = () => Math.random().toString(36).slice(2, 9);

export const optionsOf = (p: ProProject): ProOption[] => p.options ?? [];
export const currentOption = (p: ProProject): ProOption | null => optionsOf(p).find((o) => o.id === p.option) ?? null;
/** the current option's name: "Option A" while there's only the project */
export const optionName = (p: ProProject) => currentOption(p)?.name ?? 'Option A';

/** the list with the current option's copy brought up to date (made Option A if there's no list yet) */
function kept(p: ProProject): { options: ProOption[]; option: string } {
  const os = optionsOf(p);
  if (!os.length || !p.option) { const a: ProOption = { id: newId(), name: 'Option A', made: 'by hand', at: new Date().toISOString(), patch: snapshot(p) }; return { options: [a], option: a.id }; }
  return { options: os.map((o) => (o.id === p.option ? { ...o, patch: snapshot(p) } : o)), option: p.option };
}

/** the change that switches to another option */
export function switchTo(p: ProProject, id: string): Partial<ProProject> {
  const k = kept(p), to = k.options.find((o) => o.id === id);
  if (!to || id === k.option) return k;
  return { ...k, option: id, ...laid(to.patch) };
}

/** a new option from the current one with a change (a brief's or Explore's), switched to */
export function added(p: ProProject, change: Partial<Varying>, made: ProOption['made'], name?: string): Partial<ProProject> {
  // (key by key, so a field the change clears, like the scheme to be filled afresh, is cleared)
  const k = kept(p), patch: Partial<Varying> = snapshot(p);
  for (const key of Object.keys(change) as (keyof Varying)[]) (patch as Record<string, unknown>)[key] = clone(change[key]);
  const o: ProOption = { id: newId(), name: name ?? nextName(k.options), made, at: new Date().toISOString(), patch };
  return { options: [...k.options, o], option: o.id, ...laid(patch) };
}

/** a copy of the current option, switched to */
export const duplicated = (p: ProProject): Partial<ProProject> => added(p, {}, 'by hand');

/** an option renamed (null: the one open, made Option A first if there's no list yet) */
export function renamed(p: ProProject, id: string | null, name: string): Partial<ProProject> {
  const k = kept(p), to = id ?? k.option;
  return { ...k, options: k.options.map((o) => (o.id === to ? { ...o, name: name.trim() || o.name } : o)) };
}

/** an option taken away (never the last); the current one's going switches to its neighbour */
export function removedOption(p: ProProject, id: string): Partial<ProProject> | null {
  const k = kept(p);
  if (k.options.length < 2) return null;
  const i = k.options.findIndex((o) => o.id === id), rest = k.options.filter((o) => o.id !== id);
  const chosen = p.chosen === id ? undefined : p.chosen;
  if (id !== k.option) return { options: rest, chosen };
  const to = rest[Math.max(0, i - 1)];
  return { options: rest, option: to.id, chosen, ...laid(to.patch) };
}

/** the project as an option would make it (to evaluate it beside the current one) */
export function asOption(p: ProProject, id: string): ProProject {
  if (id === p.option) return p;
  const o = optionsOf(p).find((x) => x.id === id);
  return o ? { ...p, ...laid(o.patch) } : p;
}
