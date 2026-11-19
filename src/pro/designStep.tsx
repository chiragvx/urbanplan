// Step 2, the design system: the builder's look, set once and kept. Start from a preset or one of your own, see it
// on a facade, then pick the materials of each surface (walls, accents, the base, floors room by room, the roof, the
// railings), the windows and balconies, and the specification. Everything here is a property of the design system
// (./design.ts), not of a building: the Scheme step decides what gets built with it.
// Pro's UI is black and white; the material swatches and the facade preview are the one place colour shows, because
// there the colour is the data.
import type { JSX } from 'preact';
import { useEffect, useId, useState } from 'preact/hooks';
import './designStep.css';
import {
  clone, finishOf, finishRate, FINISHED, FLOOR_ROOMS, presetOf, PRESETS, setFinish, SPEC,
  type BalconyKind, type DesignSystem, type DoorType, type FinishSlot, type WindowType,
} from './design';
import { byCategory, materialOf, SLOT_CATEGORIES, type Material } from './materials';
import * as library from './designLibrary';
import type { SavedDesign } from './designLibrary';
import type { StepProps } from './steps';
import { Btn, Color, Icon, Note, nf, Num, Row, Section, Seg, Select, Toggle } from './ui';

// ---------------------------------------------------------------- colour helpers (for drawing materials only)
const rgb = (hex: string) => { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lum = (hex: string) => { const [r, g, b] = rgb(hex); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; };
/** toward white (k > 0) or black (k < 0) */
const shade = (hex: string, k: number) => {
  const t = k > 0 ? 255 : 0, a = Math.abs(k);
  return `#${rgb(hex).map((c) => Math.round(c + (t - c) * a).toString(16).padStart(2, '0')).join('')}`;
};
const safeId = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '');
const rateText = (m: Material) => `₹${nf(m.rate)}/m²`;

/** A material as an SVG <pattern> in metres (userSpaceOnUse), so a swatch and the elevation draw it the same way. */
function Pat({ id, m, colour = m.colour }: { id: string; m: Material; colour?: string }) {
  const line = shade(colour, lum(colour) > 0.55 ? -0.22 : 0.25), sw = 0.022;
  let w = 1, h = 1, body: JSX.Element | null = null;
  switch (m.pattern ?? 'plain') {
    case 'brick': w = 0.5; h = 0.16; body = <path d="M0 0H.5M0 .08H.5M0 0V.08M.25 .08V.16" />; break;
    case 'stone': w = 1.2; h = 0.6; body = <path d="M0 0H1.2M0 .3H1.2M0 0V.3M.7 .3V.6" />; break;
    case 'plank': w = 2.4; h = 0.3; body = <path d="M0 0H2.4M0 .15H2.4M.6 0V.15M1.8 .15V.3" />; break;
    case 'tile': {
      const [a, b] = m.category === 'cladding' ? [1.2, 0.6] : m.category === 'glass' ? [1.5, 1.5] : [0.6, 0.6];
      w = a; h = b; body = <path d={`M0 0H${a}M0 0V${b}`} stroke-width={m.category === 'glass' ? 0.06 : sw} />; break;
    }
    case 'stripe': w = 0.15; h = 1; body = <path d="M0 0V1" />; break;
    case 'louvre': w = 0.3; h = 1; body = <rect x=".18" width=".12" height="1" fill={shade(colour, -0.35)} stroke="none" />; break;
    default:
      if (m.finish === 'textured') { w = 0.3; h = 0.3; body = <g fill={line} stroke="none" opacity=".55"><circle cx=".05" cy=".07" r=".014" /><circle cx=".2" cy=".16" r=".012" /><circle cx=".12" cy=".26" r=".013" /></g>; }
  }
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width={w} height={h}>
      <rect width={w} height={h} fill={colour} />
      {body && <g stroke={line} stroke-width={sw} fill="none">{body}</g>}
    </pattern>
  );
}

/** A material swatch: a 1.2 m square of it. */
function Chip({ m, colour, size = 28 }: { m: Material; colour?: string; size?: number }) {
  const id = `mp-${safeId(useId())}`;
  return (
    <svg class="dss-chip" width={size} height={size} viewBox="0 0 1.2 1.2" aria-hidden="true">
      <defs><Pat id={id} m={m} colour={colour} /></defs>
      <rect width="1.2" height="1.2" fill={`url(#${id})`} />
      {m.finish === 'gloss' && <path d="M0 0H.55L0 .55Z" fill="#fff" opacity=".22" />}
    </svg>
  );
}

// ---------------------------------------------------------------- keyboard: arrows move in a grid of radios
/** Arrow keys across a wrapped grid of [role=radio] (left/right along it, up/down to the nearest in the next row),
 *  Home and End. Moves focus and returns the new index, or -1 when the key isn't one of those. */
function gridKey(e: KeyboardEvent): number {
  const box = e.currentTarget as HTMLElement;
  const btns = [...box.querySelectorAll<HTMLElement>('[role="radio"]')];
  const i = btns.indexOf(document.activeElement as HTMLElement);
  if (i < 0 || !btns.length) return -1;
  let n: number;
  if (e.key === 'ArrowRight') n = (i + 1) % btns.length;
  else if (e.key === 'ArrowLeft') n = (i - 1 + btns.length) % btns.length;
  else if (e.key === 'Home') n = 0;
  else if (e.key === 'End') n = btns.length - 1;
  else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    const cur = btns[i], down = e.key === 'ArrowDown';
    const others = btns.filter((b) => (down ? b.offsetTop > cur.offsetTop + 2 : b.offsetTop < cur.offsetTop - 2));
    if (!others.length) n = i;
    else {
      const top = down ? Math.min(...others.map((b) => b.offsetTop)) : Math.max(...others.map((b) => b.offsetTop));
      const row = others.filter((b) => Math.abs(b.offsetTop - top) <= 2);
      const best = row.reduce((a, b) => (Math.abs(b.offsetLeft - cur.offsetLeft) < Math.abs(a.offsetLeft - cur.offsetLeft) ? b : a));
      n = btns.indexOf(best);
    }
  } else return -1;
  e.preventDefault(); e.stopPropagation();
  btns[n].focus();
  return n;
}

// ---------------------------------------------------------------- a material picker
/** A swatch grid (a radiogroup): name and rate show on hover or focus, the chosen one has an ink ring and a check. */
function MaterialGrid({ label, value, options, set }: { label: string; value: string; options: Material[]; set: (id: string) => void }) {
  const at = Math.max(0, options.findIndex((m) => m.id === value));
  return (
    <div class="dss-grid" role="radiogroup" aria-label={label} onKeyDown={(e) => { const n = gridKey(e); if (n >= 0) set(options[n].id); }}>
      {options.map((m, i) => {
        const on = m.id === value, tip = `${m.name} · ${rateText(m)}`;
        return (
          <button type="button" role="radio" aria-checked={on} tabIndex={i === at ? 0 : -1} class="dss-sw" aria-label={tip} data-tip={tip} onClick={() => set(m.id)}>
            <Chip m={m} size={30} />
            {on && <span class="dss-ck" aria-hidden="true"><Icon n="check" size={11} stroke={3} /></span>}
          </button>
        );
      })}
    </div>
  );
}

/** One surface: a row with its material (swatch, name, rate) that opens its swatch grid. */
function MaterialRow({ label, value, slot, open, toggle, set }: { label: string; value: string; slot: keyof typeof SLOT_CATEGORIES; open: boolean; toggle: () => void; set: (id: string) => void }) {
  const m = materialOf(value), id = `dss-${safeId(useId())}`;
  return (
    <div class={`dss-mat${open ? ' open' : ''}`}>
      <button type="button" class="dss-row" aria-expanded={open} aria-controls={id} onClick={toggle}>
        <Chip m={m} size={26} />
        <span class="dss-row-t"><small>{label}</small><b>{m.name}</b></span>
        <span class="dss-rate">{rateText(m)}</span>
        <Icon n="chevron" size={14} />
      </button>
      {open && <div id={id}><MaterialGrid label={label} value={value} options={byCategory(SLOT_CATEGORIES[slot])} set={set} /></div>}
    </div>
  );
}

// ---------------------------------------------------------------- the facade preview
/** A few floors of a generic facade, drawn in metres: three bays (the main window, the balcony, the smaller window
 *  with the ventilator) over the stilt, with the parapet and the roof's edge. Colours from the design system's facade
 *  (what the 3D shows), surfaces from its materials. */
function Elevation({ ds }: { ds: DesignSystem }) {
  const uid = safeId(useId());
  const f = finishOf(ds);
  const mWall = materialOf(f.wall), mAcc = materialOf(f.accent), mBase = materialOf(f.base), mRoof = materialOf(f.roof), mRail = materialOf(f.railing);
  const fh = ds.floorH, N = 3, parapet = 1.0;
  const { W1, W2, V1 } = ds.windows, SD = ds.doors.SD, bal = ds.balcony;
  const glass = ds.glazing.glass, frame = ds.glazing.frame;
  const bayA = Math.max(W1.w + 1.6, 3.2);
  const bayB = bal.kind === 'none' ? Math.max(W2.w + 1.6, 3) : Math.max(Math.min(SD.w, 3.6) + 1.2, 3.2);
  const bayC = Math.max(W2.w + V1.w + 1.9, 3.4);
  const Wd = bayA + bayB + bayC, H = fh + N * fh + parapet;
  const top = (k: number) => parapet + (N - k) * fh; // the top of typical floor k (1 … N)
  const bot = (k: number) => top(k) + fh;            // its floor level
  const P = { wall: `${uid}w`, acc: `${uid}a`, base: `${uid}b`, roof: `${uid}r` };
  const fill = (k: keyof typeof P) => `url(#${P[k]})`;

  const win = (x: number, yFloor: number, w: number, h0: number, sill: number, kind: WindowType['kind'] | DoorType['kind']) => {
    const h = Math.max(0.3, Math.min(h0, fh - sill - 0.15)), y = yFloor - sill - h;
    const mull = kind === 'sliding' || kind === 'glass-sliding' ? [x + w / 2] : kind === 'casement' ? [x + w / 3, x + (2 * w) / 3] : kind === 'fixed' && w > 1.6 ? [x + w / 2] : [];
    return (
      <g>
        <rect x={x} y={y} width={w} height={h} fill={glass} stroke={frame} stroke-width=".07" />
        {kind === 'louvre'
          ? Array.from({ length: Math.max(2, Math.floor(h / 0.1)) }, (_, i) => <path d={`M${x} ${y + (i + 0.5) * (h / Math.max(2, Math.floor(h / 0.1)))}h${w}`} stroke={frame} stroke-width=".035" />)
          : <path d={`M${x + 0.08} ${y + h - 0.08}L${x + Math.min(w, h) * 0.55} ${y + 0.08}h${Math.min(w, h) * 0.2}L${x + 0.08 + Math.min(w, h) * 0.2} ${y + h - 0.08}Z`} fill="#fff" opacity=".13" />}
        {mull.map((mx) => <path d={`M${mx} ${y}v${h}`} stroke={frame} stroke-width=".06" />)}
        {kind === 'casement' && <path d={`M${x} ${y + 0.45}h${w}`} stroke={frame} stroke-width=".05" />}
      </g>
    );
  };
  const railing = (x: number, w: number, yFloor: number) => {
    const rh = 1.1, y = yFloor - rh, steel = '#8d9399';
    if (bal.railing === 'glass') return <g><rect x={x} y={y} width={w} height={rh} fill={mRail.railKind === 'glass' ? mRail.colour : '#b9d0d6'} opacity=".55" /><rect x={x} y={y - 0.03} width={w} height=".06" fill={steel} /></g>;
    if (bal.railing === 'solid') return <g><rect x={x} y={y} width={w} height={rh} fill={mRail.id === 'rail-parapet' ? fill('wall') : mRail.colour} /><rect x={x - 0.03} y={y - 0.06} width={w + 0.06} height=".08" fill={shade(ds.facade.wall, -0.2)} /></g>;
    const c = mRail.railKind === 'ms' ? mRail.colour : '#262628', n = Math.max(2, Math.floor(w / 0.12));
    return <g><rect x={x} y={y} width={w} height=".05" fill={c} /><rect x={x} y={yFloor - 0.12} width={w} height=".04" fill={c} />{Array.from({ length: n + 1 }, (_, i) => <rect x={x + (i * (w - 0.025)) / n} y={y} width=".025" height={rh - 0.08} fill={c} />)}</g>;
  };

  const floors = Array.from({ length: N }, (_, i) => i + 1);
  const xB = bayA, xC = bayA + bayB;
  return (
    <svg class="dss-elev" viewBox={`-0.6 -0.5 ${Wd + 1.2} ${H + 0.75}`} role="img"
      aria-label={`Facade preview: ${mWall.name} walls, ${mAcc.name} accents, ${mBase.name} at the base, ${bal.kind === 'none' ? 'no balconies' : `${bal.kind} balconies`}`}>
      <defs>
        <Pat id={P.wall} m={mWall} colour={ds.facade.wall} />
        <Pat id={P.acc} m={mAcc} colour={ds.facade.accent} />
        <Pat id={P.base} m={mBase} colour={ds.facade.base} />
        <Pat id={P.roof} m={mRoof} />
      </defs>
      {/* the roof's edge, the walls, the stilt */}
      <rect x=".3" y="-0.28" width={Wd - 0.6} height=".3" fill={fill('roof')} />
      <rect x="0" y="0" width={Wd} height={H - fh} fill={fill('wall')} />
      <rect x="-0.05" y="0" width={Wd + 0.1} height=".12" fill={shade(ds.facade.wall, -0.18)} />
      <rect x="0" y={H - fh} width={Wd} height={fh} fill={fill('base')} />
      {[[0.45, xB - 0.225], [xB + 0.225, xC - 0.225], [xC + 0.225, Wd - 0.45]].map(([a, b]) => <rect x={a} y={H - fh + 0.45} width={b - a} height={fh - 0.45} fill="#1b1b1d" opacity=".82" />)}
      {/* recessed balconies sit in a shadowed bay */}
      {bal.kind === 'recessed' && floors.map((k) => <rect x={xB + 0.3} y={top(k) + 0.1} width={bayB - 0.6} height={fh - 0.1} fill={shade(ds.facade.wall, -0.3)} />)}
      {/* floor bands */}
      {ds.facade.bands && floors.map((k) => <rect x="0" y={bot(k) - 0.1} width={Wd} height=".22" fill={fill('acc')} />)}
      {floors.map((k) => {
        const yf = bot(k);
        const xa = (bayA - W1.w) / 2;
        const dw = Math.min(SD.w, bayB - 1.0), dx = xB + (bayB - dw) / 2;
        const w2x = xC + 0.7, v1x = w2x + W2.w + 0.5;
        return (
          <g>
            {ds.facade.fins && <><rect x={xa - 0.32} y={top(k)} width=".18" height={fh} fill={fill('acc')} /><rect x={xa + W1.w + 0.14} y={top(k)} width=".18" height={fh} fill={fill('acc')} /></>}
            {win(xa, yf, W1.w, W1.h, W1.sill, W1.kind)}
            {bal.kind === 'none'
              ? win(xB + (bayB - W2.w) / 2, yf, W2.w, W2.h, W2.sill, W2.kind)
              : <>
                {win(dx, yf, dw, Math.min(SD.h, fh - 0.3), 0, SD.kind)}
                {bal.kind === 'cantilever' && <><rect x={xB + 0.2} y={yf} width={bayB - 0.4} height=".16" fill={shade(ds.facade.wall, -0.12)} /><rect x={xB + 0.2} y={yf + 0.16} width={bayB - 0.4} height=".3" fill="#000" opacity=".12" /></>}
                {railing(bal.kind === 'french' ? dx - 0.1 : xB + 0.25, bal.kind === 'french' ? dw + 0.2 : bayB - 0.5, yf)}
              </>}
            {win(w2x, yf, W2.w, W2.h, W2.sill, W2.kind)}
            {win(v1x, yf, V1.w, V1.h, Math.min(V1.sill, fh - V1.h - 0.2), V1.kind)}
          </g>
        );
      })}
      <path d={`M-0.6 ${H}H${Wd + 0.6}`} stroke="currentColor" stroke-width=".05" />
    </svg>
  );
}

// ---------------------------------------------------------------- start from: presets and saved ones
/** Stable comparison of two design systems (key order doesn't matter). */
const stable = (v: unknown): string => (v && typeof v === 'object' ? (Array.isArray(v) ? `[${v.map(stable).join(',')}]` : `{${Object.keys(v as object).sort().map((k) => `${k}:${stable((v as Record<string, unknown>)[k])}`).join(',')}}`) : JSON.stringify(v));
const same = (a: DesignSystem, b: DesignSystem) => stable(a) === stable(b);

function Strip({ d }: { d: DesignSystem }) {
  const f = finishOf(d);
  return (
    <span class="dss-strip" aria-hidden="true">
      <Chip m={materialOf(f.wall)} colour={d.facade.wall} size={18} />
      <Chip m={materialOf(f.accent)} colour={d.facade.accent} size={18} />
      <Chip m={materialOf(f.base)} colour={d.facade.base} size={18} />
      <i style={`background:${d.glazing.glass}`} />
    </span>
  );
}

function StartFrom({ p, up, toast }: Pick<StepProps, 'p' | 'up' | 'toast'>) {
  const [mine, setMine] = useState<SavedDesign[]>([]);
  const [mode, setMode] = useState<null | 'save' | 'rename' | 'delete'>(null);
  const [name, setName] = useState('');
  useEffect(() => {
    let live = true;
    const load = () => { void library.list().then((l) => { if (live) setMine(l); }); };
    load();
    const off = library.subscribe(load);
    return () => { live = false; off(); };
  }, []);

  const custom = p.custom;
  const src = custom?.origin ? mine.find((s) => s.id === custom.origin) ?? null : null;
  const activeSaved = custom && src && same(custom, src.ds) ? src : null;
  const changed = !!custom && !activeSaved;
  const preset = presetOf(custom?.id ?? p.style);
  const ds = custom ?? presetOf(p.style);

  const cards: { key: string; d: DesignSystem; on: boolean; mine?: boolean; pick: () => void }[] = [
    ...PRESETS.map((x) => ({ key: x.id, d: x, on: !custom && p.style === x.id, pick: () => up({ style: x.id, custom: null }) })),
    ...mine.map((s) => ({ key: s.id, d: s.ds, mine: true, on: activeSaved?.id === s.id, pick: () => up({ style: presetOf(s.ds.id).id, custom: clone(s.ds) }) })),
  ];
  const tab = Math.max(0, cards.findIndex((c) => c.on));
  const close = () => { setMode(null); setName(''); };
  const run = async (f: () => Promise<unknown>, done: string) => { try { await f(); toast(done); close(); } catch (e) { toast((e as Error).message); } };

  const submit = (ev: Event) => {
    ev.preventDefault();
    const n = name.trim(); if (!n) return;
    if (mode === 'save') void run(async () => { const s = await library.save(n, ds); up({ custom: clone(s.ds) }); }, `Saved as “${n}”. It’s under Start from in every project.`);
    else if (mode === 'rename' && src) void run(async () => { const s = await library.rename(src.id, n); if (s && custom && activeSaved) up({ custom: clone(s.ds) }); }, `Renamed to “${n}”.`);
  };

  return (
    <Section title="Start from" aside={changed ? <span class="sec-meta">Changed</span> : undefined}>
      <div class="dss-cards" role="radiogroup" aria-label="Start from" onKeyDown={(e) => { const n = gridKey(e); if (n >= 0) cards[n].pick(); }}>
        {cards.map((c, i) => (
          <button type="button" role="radio" aria-checked={c.on} tabIndex={i === tab ? 0 : -1} class="dss-card" title={c.mine ? undefined : c.d.blurb} onClick={c.pick}>
            <Strip d={c.d} />
            <b>{c.d.name}</b>
            {c.mine && <small>Mine</small>}
            {c.on && <span class="dss-ck" aria-hidden="true"><Icon n="check" size={11} stroke={3} /></span>}
          </button>
        ))}
      </div>

      {mode === 'save' || mode === 'rename'
        ? <form class="dss-name" onSubmit={submit}>
          <label class="f"><span class="f-l">{mode === 'save' ? 'Name it' : 'New name'}</span>
            <input class="txt" value={name} maxLength={60} autoFocus onInput={(e) => setName((e.target as HTMLInputElement).value)} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } }} />
          </label>
          <Btn kind="primary" submit disabled={!name.trim()}>{mode === 'save' ? 'Save' : 'Rename'}</Btn>
          <Btn kind="quiet" onClick={close}>Cancel</Btn>
        </form>
        : mode === 'delete' && src
          ? <div class="dss-acts" role="group" aria-label="Confirm delete">
            <span>Delete “{src.name}” for good?</span>
            <Btn kind="primary" onClick={() => void run(() => library.remove(src.id), `Deleted “${src.name}”.`)}>Delete</Btn>
            <Btn kind="quiet" onClick={close}>Keep it</Btn>
          </div>
          : <div class="dss-acts">
            {changed && <span class="dss-changed">Changed from {src?.name ?? preset.name}</span>}
            <button type="button" class="linkbtn" onClick={() => { setName(activeSaved ? `${activeSaved.name} 2` : changed && src ? src.name : `My ${ds.name}`); setMode('save'); }}><Icon n="plus" size={14} />Save as mine</button>
            {changed && src && <button type="button" class="linkbtn" onClick={() => void run(() => library.save(src.name, custom!, src.id).then((s) => up({ custom: clone(s.ds) })), `Updated “${src.name}”.`)}>Update “{src.name}”</button>}
            {changed && <button type="button" class="linkbtn" onClick={() => (src ? up({ style: presetOf(src.ds.id).id, custom: clone(src.ds) }) : up({ style: preset.id, custom: null }))}><Icon n="undo" size={14} />Back to {src?.name ?? preset.name}</button>}
            {src && !changed && <>
              <button type="button" class="linkbtn" onClick={() => { setName(src.name); setMode('rename'); }}><Icon n="edit" size={14} />Rename</button>
              <button type="button" class="linkbtn" onClick={() => setMode('delete')}><Icon n="x" size={14} />Delete</button>
            </>}
          </div>}
    </Section>
  );
}

// ---------------------------------------------------------------- the step
export function DesignSystemStep({ p, e, up, toast }: StepProps) {
  const ds = e.ds;
  const f = finishOf(ds);
  const setDs = (fn: (d: DesignSystem) => void) => { const d = clone(ds); fn(d); up({ custom: d }); };
  const pick = (slot: FinishSlot) => (id: string) => setDs((d) => setFinish(d, slot, id));
  // one surface's swatches open at a time
  const [open, setOpen] = useState<string | null>('wall');
  const row = (key: string, label: string, value: string, slot: keyof typeof SLOT_CATEGORIES, fs: FinishSlot) => (
    <MaterialRow label={label} value={value} slot={slot} open={open === key} toggle={() => setOpen(open === key ? null : key)} set={pick(fs)} />
  );
  const fr = finishRate(ds);
  return (
    <>
      <StartFrom p={p} up={up} toast={toast} />

      <figure class="dss-prev">
        <Elevation ds={ds} />
        <figcaption>{ds.name}{ds.blurb && !p.custom ? <span> · {ds.blurb}</span> : null}</figcaption>
      </figure>

      <Section title="Facade">
        <div class="dss-mats">
          {row('wall', 'Walls', f.wall, 'wall', 'wall')}
          {row('accent', 'Accents (bands, fins)', f.accent, 'accent', 'accent')}
          {row('base', 'Base (the stilt)', f.base, 'base', 'base')}
        </div>
        <Row>
          <Toggle label="Floor bands" value={ds.facade.bands} set={(v) => setDs((d) => { d.facade.bands = v; })} />
          <Toggle label="Fins" value={ds.facade.fins} set={(v) => setDs((d) => { d.facade.fins = v; })} />
        </Row>
        <Num label="Floor to floor" value={ds.floorH} step={0.05} min={2.8} max={4.5} unit="m" set={(v) => setDs((d) => { d.floorH = v; })} />
      </Section>

      <Section title="Windows and balconies" fold open={false}>
        <Seg<BalconyKind> label="Balconies" value={ds.balcony.kind} set={(v) => setDs((d) => { d.balcony.kind = v; })} options={[{ value: 'cantilever', label: 'Cantilever' }, { value: 'recessed', label: 'Recessed' }, { value: 'french', label: 'French' }, { value: 'none', label: 'None' }]} />
        {ds.balcony.kind !== 'none' && <>
          <Num label="Depth" value={ds.balcony.depth} step={0.1} min={0.3} max={4} unit="m" set={(v) => setDs((d) => { d.balcony.depth = v; })} />
          <div class="dss-mats">{row('railing', 'Railing', f.railing, 'railing', 'railing')}</div>
        </>}
        <Row><Color label="Glass" value={ds.glazing.glass} set={(c) => setDs((d) => { d.glazing.glass = c; })} /><Color label="Frames" value={ds.glazing.frame} set={(c) => setDs((d) => { d.glazing.frame = c; })} /></Row>
        <div class="tscroll">
          <table class="cat">
            <caption class="dss-cap">The catalog every opening comes from: change a size and every one follows.</caption>
            <thead><tr><th>Tag</th><th>W</th><th>H</th><th>Sill</th><th>Type</th></tr></thead>
            <tbody>
              {(['W1', 'W2', 'V1'] as const).map((t) => <CatRow t={t} x={ds.windows[t]} sill set={(fn) => setDs((d) => fn(d.windows[t]))} kinds={['sliding', 'casement', 'fixed', 'louvre']} />)}
              {(['D1', 'D2', 'D3', 'SD'] as const).map((t) => <CatRow t={t} x={ds.doors[t]} set={(fn) => setDs((d) => fn(d.doors[t]))} kinds={['flush', 'panel', 'veneer', 'glass-sliding', 'fire-rated']} />)}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Flooring">
        <div class="dss-mats">{FLOOR_ROOMS.map((r) => row(`floor-${r.key}`, r.label, f.flooring[r.key], 'floor', r.key))}</div>
      </Section>

      <Section title="Roof">
        <div class="dss-mats">{row('roof', 'Terrace', f.roof, 'roof', 'roof')}</div>
      </Section>

      <Section title="Specification" fold open={false} sub="What the flats are sold with. Each choice adds to construction, ₹ per sq ft of built-up area (rough figures: put in your own)." aside={<span class="sec-meta">+₹{nf(e.rate)}/ft²</span>}>
        {SPEC.filter((c) => !FINISHED.includes(c.key)).map((c) => (
          <Select<number> label={c.label} value={ds.spec[c.key] ?? 0} onChange={(v) => setDs((d) => { d.spec[c.key] = v; })} options={c.options.map((o, i) => ({ value: i, label: `${o.label}${o.rate ? ` (+₹${o.rate})` : ''}` }))} />
        ))}
        <Note>The materials chosen above come to about {fr >= 0 ? '+' : '−'}₹{nf(Math.abs(fr))} per sq ft of built-up over plain ones (paint, 600 mm vitrified tiles, MS railings).</Note>
      </Section>
    </>
  );
}

/** A row of the window and door catalog (as in the old Design step). */
function CatRow<T extends WindowType | DoorType>({ t, x, set, kinds, sill }: { t: string; x: T; set: (f: (x: T) => void) => void; kinds: string[]; sill?: boolean }) {
  const n = (k: 'w' | 'h' | 'sill', v: string) => { const f = parseFloat(v); if (Number.isFinite(f) && f >= 0 && f < 10) set((y) => { (y as unknown as Record<string, number>)[k] = f; }); };
  return (
    <tr>
      <td><b>{t}</b></td>
      <td><input type="number" step="0.05" value={x.w} onChange={(ev) => n('w', (ev.target as HTMLInputElement).value)} aria-label={`${t} width`} /></td>
      <td><input type="number" step="0.05" value={x.h} onChange={(ev) => n('h', (ev.target as HTMLInputElement).value)} aria-label={`${t} height`} /></td>
      <td>{sill ? <input type="number" step="0.05" value={(x as WindowType).sill} onChange={(ev) => n('sill', (ev.target as HTMLInputElement).value)} aria-label={`${t} sill`} /> : null}</td>
      <td><Select<string> size="sm" aria-label={`${t} kind`} value={x.kind} onChange={(v) => set((y) => { (y as { kind: string }).kind = v; })} options={kinds.map((k) => ({ value: k, label: k.replace('-', ' ') }))} /></td>
    </tr>
  );
}
