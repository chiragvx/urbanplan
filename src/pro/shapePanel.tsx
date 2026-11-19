// The Shape section of a picked building: a few big controls that make a good form out of anything, and the precise
// ones folded away. Floors; a preset (straight, taper, twist, steps, wave, lean); four sliders (how big the top is,
// how far it turns, how round the plan is, how far it leans); what each band of floors is for, bottom to top; the
// roof; the skin. Folded: the side elevation and the plan, to shape by hand, and a slot to carve up it.
//
// A straight building of the engine's (a spine and a depth) gets "Shape it", which turns it into a box form of the
// same size in the same place: its spine becomes the form's anchor (its first node the middle, its first segment
// the way it faces).
import { useEffect, useRef, useState } from 'preact/hooks';
import { boxForm, sampleCurve, USE_INFO, type BuildingUse, type Form, type KeyFloor, type Pt, type RoofKind, type SkinPattern } from './form';
import type { ProBuilding } from './project';
import { keyAt, keysOf, PlanEditor, SilhouetteEditor, slotCarve } from './silhouette';
import { spineLength } from './edit';
import { Btn, Icon, nf, Range, Section, Seg, Toggle } from './ui';

const total = (f: Form) => f.uses.reduce((s, u) => s + u.floors, 0);
/** the form with its floors and the building's kept the same */
const withForm = (b: ProBuilding, f: Form): ProBuilding => ({ ...b, form: f, floors: Math.max(1, total(f)) });

// ---------------------------------------------------------------- presets
type Preset = 'straight' | 'taper' | 'twist' | 'steps' | 'wave' | 'lean';
const K = (t: number, x: Partial<KeyFloor> = {}): KeyFloor => ({ t, sx: 1, sz: 1, dx: 0, dz: 0, rot: 0, ...x });
const widthOf = (f: Form) => { const s = sampleCurve(f.plan, 2); let a = Infinity, b = -Infinity; for (let i = 0; i < s.length; i += 2) { a = Math.min(a, s[i]); b = Math.max(b, s[i]); } return Number.isFinite(b - a) ? b - a : 20; };
const PRESETS: { id: Preset; label: string; make: (f: Form) => Pick<Form, 'keys' | 'ease'> }[] = [
  { id: 'straight', label: 'Straight', make: () => ({ keys: [], ease: 'smooth' }) },
  { id: 'taper', label: 'Taper', make: () => ({ keys: [K(0), K(1, { sx: 0.6, sz: 0.6 })], ease: 'smooth' }) },
  { id: 'twist', label: 'Twist', make: () => ({ keys: [K(0), K(1, { rot: 90 })], ease: 'linear' }) },
  { id: 'steps', label: 'Steps', make: () => ({ keys: [K(0), K(0.5), K(0.52, { sx: 0.82, sz: 0.82 }), K(0.76, { sx: 0.82, sz: 0.82 }), K(0.78, { sx: 0.64, sz: 0.64 }), K(1, { sx: 0.64, sz: 0.64 })], ease: 'linear' }) },
  { id: 'wave', label: 'Wave', make: () => ({ keys: [K(0), K(0.25, { sx: 1.12, sz: 1.12 }), K(0.5, { sx: 0.9, sz: 0.9 }), K(0.75, { sx: 1.12, sz: 1.12 }), K(1, { sx: 0.94, sz: 0.94 })], ease: 'smooth' }) },
  { id: 'lean', label: 'Lean', make: (f) => ({ keys: [K(0), K(1, { dx: Math.round(Math.min(12, widthOf(f) * 0.3) * 2) / 2 })], ease: 'smooth' }) },
];
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Every key's share of one change scaled so the top reaches a value (a taper, a twist, a lean keeps its character). */
function scaled(f: Form, field: 'rot' | 'dx' | 's', to: number): Form {
  const ks = keysOf(f).map((k) => ({ ...k }));
  const top = keyAt({ ...f, keys: ks }, 1);
  if (field === 's') {
    const dx = top.sx - 1, dz = top.sz - 1;
    for (const k of ks) {
      k.sx = Math.abs(dx) > 1e-3 ? 1 + ((k.sx - 1) * (to - 1)) / dx : 1 + (to - 1) * k.t;
      k.sz = Math.abs(dz) > 1e-3 ? 1 + ((k.sz - 1) * (to - 1)) / dz : 1 + (to - 1) * k.t;
      k.sx = Math.round(k.sx * 1000) / 1000; k.sz = Math.round(k.sz * 1000) / 1000;
    }
  } else {
    const v0 = top[field];
    for (const k of ks) k[field] = Math.round((Math.abs(v0) > 1e-6 ? (k[field] * to) / v0 : to * k.t) * 100) / 100;
  }
  return { ...f, keys: ks };
}

/** how round the plan is: the share of its points that are smooth */
const roundness = (f: Form) => { const n = f.plan.pts.length; return n ? f.plan.pts.filter((_, i) => !(f.plan.sharp ? f.plan.sharp[i] : true)).length / n : 0; };
/** The plan rounded off: the sharpest corners turn smooth first (0: all corners … 1: all smooth). A plan of few
 *  points gets a point in the middle of each edge first, so a box rounds to a soft blob, not a diamond. */
function rounded(f: Form, c: number): Form {
  let pts = f.plan.pts.map((p) => [...p] as Pt), sharp = pts.map((_, i) => (f.plan.sharp ? !!f.plan.sharp[i] : true));
  if (c > 0 && pts.length < 8) {
    const q: Pt[] = [], s: boolean[] = [];
    pts.forEach((p, i) => { const n = pts[(i + 1) % pts.length]; q.push(p, [(p[0] + n[0]) / 2, (p[1] + n[1]) / 2]); s.push(sharp[i], true); });
    pts = q; sharp = s;
  }
  const n = pts.length;
  const turn = pts.map((p, i) => {
    const a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
    const u = Math.atan2(p[1] - a[1], p[0] - a[0]), w = Math.atan2(b[1] - p[1], b[0] - p[0]);
    return Math.abs(((w - u + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
  });
  const order = turn.map((t, i) => [t, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]).map((x) => x[1]);
  const m = Math.round(c * n), smooth = new Set(order.slice(0, m));
  return { ...f, plan: { pts, sharp: pts.map((_, i) => !smooth.has(i)) }, keys: f.keys.map((k) => (k.plan ? { ...k, plan: undefined } : k)) };
}

// ---------------------------------------------------------------- uses
const USES = Object.keys(USE_INFO) as BuildingUse[];
const USE_FLOORS: Record<BuildingUse, number> = { residential: 8, office: 6, retail: 1, hotel: 6, library: 2, toilet: 1, community: 1, school: 3, clinic: 2, parking: 2 };

/** floors over the ground set to a number: the top band grows, or the top bands shrink (and go when empty) */
function setFloors(f: Form, n: number): Form {
  const want = Math.max(1, Math.round(n)), uses = f.uses.map((u) => ({ ...u }));
  if (!uses.length) return { ...f, uses: [{ use: 'residential', floors: want }] };
  let d = want - total(f);
  if (d > 0) uses[uses.length - 1].floors += d;
  while (d < 0 && uses.length) {
    const top = uses[uses.length - 1], take = Math.min(-d, uses.length > 1 ? top.floors : top.floors - 1);
    top.floors -= take; d += take;
    if (top.floors <= 0 && uses.length > 1) uses.pop(); else if (take === 0) break;
  }
  return { ...f, uses };
}

// ---------------------------------------------------------------- small controls
/** A row of icon buttons, one chosen (a radio group: arrow keys move along it). */
function IconPick<T extends string>({ value, set, options, label, cls }: { value: T | null; set: (v: T) => void; options: { value: T; icon: string; label: string }[]; label: string; cls?: string }) {
  const at = Math.max(0, options.findIndex((o) => o.value === value));
  const key = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault(); e.stopPropagation();
    const btns = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button')];
    const i = (btns.indexOf(document.activeElement as HTMLButtonElement) + d + btns.length) % btns.length;
    btns[i]?.focus(); set(options[i].value);
  };
  return (
    <div class={`ipick${cls ? ` ${cls}` : ''}`} role="radiogroup" aria-label={label} onKeyDown={key}>
      {options.map((o, i) => <button type="button" role="radio" aria-checked={o.value === value} tabIndex={i === at ? 0 : -1} aria-label={o.label} data-tip={o.label} onClick={() => set(o.value)}><Icon n={o.icon} size={20} /></button>)}
    </div>
  );
}

/** A slider with an icon for its name and its value at the end; the change goes out as it's dragged (a beat behind). */
function IconSlider({ icon, label, value, set, min, max, step, fmt }: { icon: string; label: string; value: number; set: (v: number) => void; min: number; max: number; step: number; fmt: (v: number) => string }) {
  const [v, setV] = useState<number | null>(null), t = useRef<number>();
  useEffect(() => () => clearTimeout(t.current), []);
  const shown = v ?? value;
  return (
    <label class="isl" data-tip={label}>
      <Icon n={icon} size={20} />
      <Range min={min} max={max} step={step} value={shown} label={label} valueText={fmt(shown)} onInput={(x) => { setV(x); clearTimeout(t.current); t.current = window.setTimeout(() => { set(x); setV(null); }, 60); }} />
      <b>{fmt(shown)}</b>
    </label>
  );
}

/** − n + for a count, big enough for a thumb */
function Stepper({ value, set, min = 1, max = 300, label }: { value: number; set: (v: number) => void; min?: number; max?: number; label: string }) {
  return (
    <span class="stp" role="group" aria-label={label}>
      <button type="button" aria-label={`Fewer ${label.toLowerCase()}`} disabled={value <= min} onClick={() => set(Math.max(min, value - 1))}><Icon n="minus" size={16} /></button>
      <input type="text" inputMode="numeric" aria-label={label} value={value} onChange={(e) => { const n = parseInt((e.target as HTMLInputElement).value, 10); if (Number.isFinite(n)) set(Math.min(max, Math.max(min, n))); }}
        onKeyDown={(e) => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); set(Math.min(max, Math.max(min, value + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1)))); } }} />
      <button type="button" aria-label={`More ${label.toLowerCase()}`} disabled={value >= max} onClick={() => set(Math.min(max, value + 1))}><Icon n="plus" size={16} /></button>
    </span>
  );
}

// ---------------------------------------------------------------- the uses stack
function UsesStack({ f, set }: { f: Form; set: (f: Form) => void }) {
  const [menu, setMenu] = useState<null | { at: number | 'add' }>(null);
  const pick = (u: BuildingUse) => {
    if (!menu) return;
    if (menu.at === 'add') set({ ...f, uses: [...f.uses, { use: u, floors: USE_FLOORS[u] }] });
    else set({ ...f, uses: f.uses.map((x, i) => (i === menu.at ? { ...x, use: u, floorH: undefined } : x)) });
    setMenu(null);
  };
  return (
    <div class="uses">
      <ol class="ustack" aria-label="What the floors are for, top first">
        {f.uses.map((u, i) => ({ u, i })).reverse().map(({ u, i }) => (
          <li class="uband" style={`--n:${Math.min(6, 1 + Math.log2(1 + u.floors))}`}>
            <button type="button" class="uicon" aria-label={`${USE_INFO[u.use].label}: change`} data-tip="Change what it's for" aria-expanded={menu?.at === i} onClick={() => setMenu(menu?.at === i ? null : { at: i })}><Icon n={USE_INFO[u.use].icon} size={18} /></button>
            <span class="uname">{USE_INFO[u.use].label}</span>
            <Stepper label="Floors" value={u.floors} set={(n) => set({ ...f, uses: f.uses.map((x, j) => (j === i ? { ...x, floors: n } : x)) })} />
            {f.uses.length > 1 ? <button type="button" class="ux" aria-label={`Remove ${USE_INFO[u.use].label.toLowerCase()}`} data-tip="Remove" onClick={() => set({ ...f, uses: f.uses.filter((_, j) => j !== i) })}><Icon n="x" size={14} /></button> : <span class="ux" />}
          </li>
        ))}
      </ol>
      <button type="button" class="uadd" aria-expanded={menu?.at === 'add'} onClick={() => setMenu(menu?.at === 'add' ? null : { at: 'add' })}><Icon n="plus" size={16} />Add floors for…</button>
      {menu && <div class="umenu" role="menu" aria-label={menu.at === 'add' ? 'Add floors for' : 'Change to'}>
        {USES.map((u) => <button type="button" role="menuitem" onClick={() => pick(u)}><Icon n={USE_INFO[u].icon} size={20} /><span>{USE_INFO[u].label}</span></button>)}
      </div>}
    </div>
  );
}

// ---------------------------------------------------------------- roofs and skins
const ROOFS: { value: RoofKind; label: string; roof: Form['roof'] }[] = [
  { value: 'flat', label: 'Flat', roof: { kind: 'flat', pitch: 0, overhang: 0, dir: 0, parapet: 1 } },
  { value: 'mono', label: 'Mono-pitch', roof: { kind: 'mono', pitch: 10, overhang: 0.6, dir: 90, } },
  { value: 'gable', label: 'Gable', roof: { kind: 'gable', pitch: 30, overhang: 0.6, dir: 0 } },
  { value: 'hip', label: 'Hip', roof: { kind: 'hip', pitch: 25, overhang: 0.6, dir: 0 } },
  { value: 'barrel', label: 'Barrel vault', roof: { kind: 'barrel', pitch: 0.18, overhang: 0.3, dir: 0 } },
  { value: 'tilted', label: 'Tilted', roof: { kind: 'tilted', pitch: 14, overhang: 0, dir: 90 } },
  { value: 'dome', label: 'Dome', roof: { kind: 'dome', pitch: 0.45, overhang: 0, dir: 0 } },
  { value: 'crown', label: 'Crown', roof: { kind: 'crown', pitch: 0, overhang: 0, dir: 0 } },
];
const SKINS: { value: SkinPattern; label: string }[] = [
  { value: 'grid', label: 'Punched grid' }, { value: 'fins', label: 'Fins' }, { value: 'louvres', label: 'Louvres' }, { value: 'bands', label: 'Bands' },
  { value: 'diagrid', label: 'Diagrid' }, { value: 'screen', label: 'Screen' }, { value: 'curtain', label: 'Curtain wall' }, { value: 'balconies', label: 'Balconies' },
];

// ---------------------------------------------------------------- the section
/** Make a straight building of the engine's a box form of its size, in its place, facing the same way. */
export function shapeIt(b: ProBuilding, floors: number): ProBuilding {
  const [ax, az, bx, bz] = b.spine, L = Math.hypot(bx - ax, bz - az) || 1, ux = (bx - ax) / L, uz = (bz - az) / L;
  const cx = (ax + bx) / 2, cz = (az + bz) / 2, r = (q: number) => Math.round(q * 100) / 100;
  // (its exact size: rounding it up could carry a building that fits its margins past them)
  const form = boxForm(Math.round(spineLength(b) * 100) / 100, b.depth, Math.max(1, floors));
  return { ...b, spine: [r(cx), r(cz), r(cx + ux), r(cz + uz)], closed: undefined, form, floors: Math.max(1, floors) };
}

export function ShapePanel({ b, floors, set }: { b: ProBuilding; floors: number; set: (fn: (b: ProBuilding) => ProBuilding) => void }) {
  const f = b.form;
  if (!f) {
    if (b.spine.length !== 4 || b.closed) return null;
    return <div class="shape-it"><Btn kind="primary" icon="wand" onClick={() => set((x) => shapeIt(x, floors))}>Shape it</Btn></div>;
  }
  const setF = (fn: (f: Form) => Form) => set((x) => (x.form ? withForm(x, fn(x.form)) : x));
  const top = keyAt(f, 1), active = PRESETS.find((p) => same(p.make(f), { keys: f.keys, ease: f.ease }))?.id ?? null;
  return (
    <div class="shape">
      <div class="shape-h">
        <span class="f-l">Floors</span>
        <Stepper label="Floors" value={total(f)} set={(n) => setF((x) => setFloors(x, n))} />
      </div>
      <IconPick<Preset> label="Shape" cls="shp-presets" value={active} set={(id) => setF((x) => ({ ...x, ...PRESETS.find((p) => p.id === id)!.make(x) }))} options={PRESETS.map((p) => ({ value: p.id, icon: p.id, label: p.label }))} />
      <div class="isls">
        <IconSlider icon="taper" label="Top size" value={Math.round(((top.sx + top.sz) / 2) * 100)} min={30} max={150} step={5} fmt={(v) => `${v}%`} set={(v) => setF((x) => scaled(x, 's', v / 100))} />
        <IconSlider icon="twist" label="Twist" value={Math.round(top.rot)} min={-180} max={180} step={5} fmt={(v) => `${v}°`} set={(v) => setF((x) => scaled(x, 'rot', v))} />
        <IconSlider icon="curve" label="Round the plan" value={Math.round(roundness(f) * 100)} min={0} max={100} step={5} fmt={(v) => `${v}%`} set={(v) => setF((x) => rounded(x, v / 100))} />
        <IconSlider icon="lean" label="Lean" value={top.dx} min={-20} max={20} step={0.5} fmt={(v) => `${nf(v, 1)} m`} set={(v) => setF((x) => scaled(x, 'dx', v))} />
      </div>
      <div class="f"><span class="f-l">Uses</span><UsesStack f={f} set={(x) => setF(() => x)} /></div>
      <div class="f"><span class="f-l">Roof</span><IconPick<RoofKind> label="Roof" value={f.roof.kind} set={(k) => setF((x) => ({ ...x, roof: { ...ROOFS.find((r) => r.value === k)!.roof } }))} options={ROOFS.map((r) => ({ value: r.value, icon: `roof-${r.value}`, label: r.label }))} /></div>
      <div class="f"><span class="f-l">Skin</span>
        <Seg<'ds' | 'own'> ariaLabel="Skin" value={f.skin?.pattern ? 'own' : 'ds'} set={(v) => setF((x) => ({ ...x, skin: v === 'ds' ? undefined : { ...(x.skin ?? {}), pattern: x.skin?.pattern ?? 'fins' } }))} options={[{ value: 'ds', label: 'Design system' }, { value: 'own', label: 'Its own' }]} />
        {f.skin?.pattern && <IconPick<SkinPattern> label="Skin pattern" value={f.skin.pattern} set={(pt) => setF((x) => ({ ...x, skin: { ...(x.skin ?? {}), pattern: pt } }))} options={SKINS.map((s) => ({ value: s.value, icon: `pat-${s.value}`, label: s.label }))} />}
      </div>
      <Section title="By hand" fold open={false}>
        <SilhouetteEditor form={f} set={(x) => setF(() => x)} />
        <PlanEditor form={f} set={(x) => setF(() => x)} />
        <div class="shape-row">
          <Btn icon="slot" onClick={() => setF((x) => ({ ...x, carves: [...x.carves, slotCarve(x)] }))}>Add a slot</Btn>
          {f.carves.length > 0 && <Btn kind="quiet" icon="trash" title="Take the cuts away" onClick={() => setF((x) => ({ ...x, carves: [] }))} />}
        </div>
        <Toggle label="Fins round it" value={!!f.shell} set={(on) => setF((x) => ({ ...x, shell: on ? { offset: 1.2, over: 4, under: 0 } : undefined }))} />
        <Seg<Form['ease']> label="Between key floors" value={f.ease} set={(v) => setF((x) => ({ ...x, ease: v }))} options={[{ value: 'smooth', label: 'Smooth' }, { value: 'linear', label: 'Straight' }]} />
      </Section>
    </div>
  );
}
