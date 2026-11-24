// Combine (docs/plans/pro-design-freedom.md §3.6): two buildings that overlap made one, by one of the four booleans a
// CAD has for two solids: Add (union), Cut (subtract), Intersect, Exclude. The picked building is the one kept; the
// other comes into it as a part (./parts.ts `combine`), still there to move, size, switch off or take out. Shown on
// the picked building's bar and in the inspector, wherever it overlaps another shaped building.
import { area, inter, union, type MP } from '../doc/ground';
import { mpOf } from './form/shape';
import { combine, OP_ICON, OP_LABEL, OP_TIP, OPS } from './parts';
import { own, type Picked } from './edit';
import type { Evaluated } from './evaluate';
import type { ProProject } from './project';
import type { PartOp } from './form';
import { Icon } from './ui';
import { useRef } from 'preact/hooks';
import { usePop } from './formHud';

/** the shaped buildings the building `id` overlaps on the ground (more than a square metre) */
export function overlapsOf(p: ProProject, e: Evaluated, id: string): { id: string; name: string }[] {
  const ground = (q: number[][]): MP => q.filter((r) => r.length >= 6).map(mpOf).reduce<MP>((a, m) => (a.length ? union(a, m) : m), []);
  const me = e.d.buildings.find((b) => b.b.id === id); if (!me) return [];
  const mine = ground(me.quads); if (!mine.length) return [];
  const formed = new Set((p.scheme?.buildings ?? []).filter((b) => b.form).map((b) => b.id));
  if (!formed.has(id)) return [];
  return e.d.buildings.filter((b) => b.b.id !== id && formed.has(b.b.id)).filter((b) => { const g = ground(b.quads); return g.length > 0 && area(inter(mine, g)) > 1; })
    .map((b) => ({ id: b.b.id, name: p.scheme?.buildings.find((x) => x.id === b.b.id)?.name ?? `Building ${String.fromCharCode(65 + e.d.buildings.indexOf(b))}` }));
}

/** the project with `other` combined into `id` by op, or null (not both shaped) */
export function combined(p: ProProject, e: Evaluated, id: string, other: string, op: PartOp): { patch: Partial<ProProject>; lost: string[] } | null {
  const s = own(p, e), a = s.buildings.find((b) => b.id === id), b = s.buildings.find((x) => x.id === other);
  if (!a || !b) return null;
  const r = combine(a, b, op); if (!r) return null;
  return { patch: { scheme: { ...s, buildings: s.buildings.filter((x) => x.id !== other).map((x) => (x.id === id ? r.b : x)) } }, lost: r.lost };
}

/** the list: each building it overlaps, and the four ways to make them one */
export function CombineList({ p, e, id, once, pick, toast, compact }: { p: ProProject; e: Evaluated; id: string; once: (o: Partial<ProProject>) => void; pick: (x: Picked) => void; toast: (s: string, o?: { undo?: boolean }) => void; compact?: boolean }) {
  const others = overlapsOf(p, e, id); if (!others.length) return null;
  const me = p.scheme?.buildings.find((b) => b.id === id)?.name ?? 'this building';
  const go = (other: { id: string; name: string }, op: PartOp) => {
    const r = combined(p, e, id, other.id, op); if (!r) return;
    once(r.patch); pick({ k: 'building', id });
    toast(`${other.name} is now a part of ${me}: ${OP_LABEL[op]}.${r.lost.length ? ` Not carried over: ${r.lost.join(', ')}.` : ''} Ctrl+Z to undo`, { undo: true });
  };
  return <div class={`combine${compact ? ' compact' : ''}`}>
    {others.map((o) => <div class="combine-row" role="group" aria-label={`Combine ${o.name} with ${me}`}>
      <span class="combine-n">{compact ? o.name : <>Overlaps <b>{o.name}</b>: make them one</>}</span>
      <span class="combine-ops">{OPS.map((op) => <button type="button" class={`hlink op-${op}`} data-tip={`${OP_TIP[op].split(':')[0]}: ${op === 'add' ? `${me} and ${o.name} joined` : op === 'cut' ? `${o.name} cut out of ${me}` : op === 'keep' ? `only where ${me} and ${o.name} overlap` : `${me} and ${o.name} without their overlap`}`} onClick={() => go(o, op)}><Icon n={OP_ICON[op]} size={14} />{OP_LABEL[op]}</button>)}</span>
    </div>)}
  </div>;
}

/** on the building's bar: "Combine", when it overlaps another shaped building, opening the list */
export function CombineButton(props: Parameters<typeof CombineList>[0]) {
  const root = useRef<HTMLSpanElement>(null);
  const { open, pop, toggle } = usePop(root);
  const n = overlapsOf(props.p, props.e, props.id).length; if (!n) return null;
  return <span class="hextras" ref={root}>
    <div class="hpopwrap" data-pop="combine">
      <button type="button" class="hcombine" aria-expanded={open === 'combine'} data-tip={`It overlaps ${n === 1 ? 'another building' : `${n} buildings`}: make them one (add, cut, intersect, exclude)`} onClick={() => toggle('combine')}><Icon n="exclude" size={15} />Combine</button>
      {pop('combine', <><b>Combine</b><small>The other comes into this one as a part: still there to move, size or take out.</small><CombineList {...props} compact /></>)}
    </div>
  </span>;
}
