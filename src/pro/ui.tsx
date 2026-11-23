// Pro's small kit of controls. The rules they follow:
// - A number changes the scheme as it's typed (a short pause, not on blur), with − / + steppers for the mouse and
//   arrow keys for the keyboard, and its unit inside the field. Out-of-range values are held back, not clamped
//   under the cursor, and settle on blur.
// - Choices of up to four go in a segmented control, longer lists in a select.
// - Sections fold, so a panel opens on what most people change and keeps the rest one click away.
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';

// ---------- icons (24-px line icons, drawn here so nothing is fetched) ----------
const P: Record<string, string> = {
  site: 'M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3zM9 4v13M15 7v13',
  building: 'M4 21V5l8-3 8 3v16M9 21v-4h6v4M8 8h2M14 8h2M8 12h2M14 12h2',
  palette: 'M12 3a9 9 0 100 18c1.1 0 1.5-.8 1.5-1.6 0-.9-.6-1.3-.6-2.1 0-.9.7-1.6 1.6-1.6H17a4 4 0 004-4c0-4.9-4-8.7-9-8.7zM7.5 11.5h0M10 7.5h0M14.5 7.5h0',
  money: 'M6 4h12M6 9h12M14 4c3 0 4 2.5 4 5s-2 5-6 5H7l8 7',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-5',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
  share: 'M16 6l-4-4-4 4M12 2v13M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7',
  folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  more: 'M5 12h0M12 12h0M19 12h0',
  cube: 'M12 2l9 5v10l-9 5-9-5V7zM12 22V12M21 7l-9 5-9-5',
  wire: 'M12 2l9 5v10l-9 5-9-5V7zM12 22V12M21 7l-9 5-9-5M3 7l9 15M21 7l-9 15M3 17l9-15 9 15',
  shade: 'M12 2l9 5v10l-9 5-9-5V7zM12 22V12M21 7l-9 5-9-5M12 12l9-5v10l-9 5z',
  plan: 'M3 3h18v18H3zM3 12h9M12 3v18M12 16h9',
  layers: 'M12 2l10 5-10 5L2 7zM2 12l10 5 10-5M2 17l10 5 10-5',
  list: 'M9 6h12M9 12h12M9 18h12M4 6h0M4 12h0M4 18h0',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  plus: 'M12 5v14M5 12h14',
  copy: 'M8 8h11v11H8zM5 16V5h11',
  ruler: 'M3 17L17 3l4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  move: 'M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3',
  updown: 'M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4',
  sideways: 'M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4',
  minus: 'M5 12h14',
  down: 'M12 3v12M7 10l5 5 5-5M5 21h14',
  print: 'M6 9V3h12v6M6 18H4a1 1 0 01-1-1v-6a2 2 0 012-2h14a2 2 0 012 2v6a1 1 0 01-1 1h-2M7 14h10v7H7z',
  user: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  x: 'M6 6l12 12M18 6L6 18',
  warn: 'M12 3l10 18H2zM12 10v5M12 18h0',
  info: 'M12 22a10 10 0 100-20 10 10 0 000 20zM12 11v6M12 7.5h0',
  chevron: 'M9 6l6 6-6 6',
  panel: 'M3 4h18v16H3zM9 4v16',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  upload: 'M12 15V3M7 8l5-5 5 5M5 21h14',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  play: 'M7 4l13 8-13 8z',
  street: 'M2 20h20M5 20V9l4-3v14M13 20V4l6 3v13',
  top: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8v8M8 12h8',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3',
  team: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21a7 7 0 0114 0M16 3.5a4 4 0 010 7.5M18 14a6 6 0 014 7',
  chat: 'M4 5h16v11H9l-5 4z',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  unlock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 7.5-2',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  eyeoff: 'M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6M9.9 9.9a3 3 0 0 0 4.2 4.2',
  key: 'M3 7h18v10H3zM7 11h0M11 11h0M15 11h0M7 14h10',
  tree: 'M12 22v-7M12 3l6 9H6zM12 8l5 7H7z',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7z',
  drop: 'M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z',
  circle: 'M12 21a9 9 0 100-18 9 9 0 000 18z',
  pin: 'M12 21s7-6 7-12a7 7 0 10-14 0c0 6 7 12 7 12zM12 11a2 2 0 100-4 2 2 0 000 4z',
  ban: 'M12 21a9 9 0 100-18 9 9 0 000 18zM5.6 5.6l12.8 12.8',
  slab: 'M2 9h20v6H2z',
  tower: 'M8 4h8v16H8z',
  lshape: 'M4 4h6v10h10v6H4z',
  ushape: 'M3 4h6v10h6V4h6v16H3z',
  court: 'M3 3h18v18H3zM8 8h8v8H8z',
  leaf: 'M5 19c0-9 5-14 15-15-1 10-6 15-15 15zM5 19l8-8',
  car: 'M4 16v-4l2-5h12l2 5v4M4 16h16v3H4zM7 13h0M17 13h0',
  road: 'M8 3L5 21M16 3l3 18M12 4v3M12 11v3M12 18v2',
  cursor: 'M5 3l14 7-6 2-2 6z',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14',
  rotate: 'M20 12a8 8 0 11-2.3-5.7M20 4v5h-5',
  north: 'M12 2l5 19-5-4-5 4z',
  level: 'M3 18l6-6 4 4 8-9M3 21h18',
  magnet: 'M5 3v8a7 7 0 0014 0V3h-5v8a2 2 0 01-4 0V3zM5 7h5M14 7h5',
  wand: 'M4 20L15 9M14 3v3M19 8h3M17.5 4.5l2-2M18 12v3M9 4h3',
  // what a floor is for
  home: 'M3 11l9-7 9 7M5 9.5V20h14V9.5M10 20v-5h4v5',
  briefcase: 'M3 8h18v12H3zM8 8V5h8v3M3 13h18',
  shop: 'M4 9l1.5-5h13L20 9M4 9h16M4 9v1a2.7 2.7 0 005.3 0 2.7 2.7 0 005.4 0 2.7 2.7 0 005.3 0V9M5 12v8h14v-8M10 20v-5h4v5',
  bed: 'M3 19V6M3 15h18v4M21 15v-3a3 3 0 00-3-3h-7v6M6 12h2',
  book: 'M4 5a2 2 0 012-2h13v15H6a2 2 0 00-2 2zM4 20a2 2 0 002 1h13M8 7h7',
  people: 'M8 11a3 3 0 100-6 3 3 0 000 6zM16 11a3 3 0 100-6 3 3 0 000 6zM2 20a6 6 0 0112 0M10 20a6 6 0 0112 0',
  school: 'M2 9l10-5 10 5-10 5zM6 11v5c2.5 2 9.5 2 12 0v-5M22 9v6',
  // roofs
  'roof-flat': 'M5 20V9h14v11M4 9h16M5 7v2M19 7v2',
  'roof-mono': 'M5 20v-9l14-5v14z',
  'roof-gable': 'M5 20v-8l7-6 7 6v8z',
  'roof-hip': 'M5 20v-8l4-5h6l4 5v8zM5 12h14',
  'roof-barrel': 'M5 20v-8h14v8M5 12a7 5 0 0114 0',
  'roof-tilted': 'M5 20V8l14 5v7z',
  'roof-dome': 'M5 20v-7h14v7M5 13a7 7 0 0114 0M12 6V4',
  'roof-crown': 'M5 20v-8h14v8M5 12V5l3.5 4L12 4l3.5 5L19 5v7',
  // skins
  'pat-grid': 'M4 4h16v16H4zM4 10h16M4 15h16M9 4v16M15 4v16',
  'pat-fins': 'M4 4h16v16H4zM7.5 4v16M11 4v16M14.5 4v16M18 4v16',
  'pat-louvres': 'M4 4h16v16H4zM4 7.5h16M4 11h16M4 14.5h16M4 18h16',
  'pat-bands': 'M4 4h16v16H4zM4 8h16v2H4zM4 14h16v2H4z',
  'pat-diagrid': 'M4 4h16v16H4zM4 4l16 16M20 4L4 20M4 12l8-8 8 8-8 8z',
  'pat-screen': 'M4 4h16v16H4zM8 8h0M12 8h0M16 8h0M8 12h0M12 12h0M16 12h0M8 16h0M12 16h0M16 16h0',
  'pat-curtain': 'M4 4h16v16H4zM12 4v16M4 12h16',
  'pat-balconies': 'M4 4h16v16H4zM3 9h18v2H3zM3 15h18v2H3z',
  // shapes
  straight: 'M8 20V4h8v16M4 20h16',
  taper: 'M6 20L9.5 4h5L18 20M4 20h16',
  twist: 'M4 20h16M7 20c0-7 10-9 10-16M17 20c0-7-10-9-10-16M7 4h10',
  steps: 'M5 20v-6h2V9h2V4h6v5h2v5h2v6M3 20h18',
  wave: 'M8 20c-2.5-4 2.5-5 0-8s2.5-5 0-8h8c-2.5 3 2.5 5 0 8s2.5 4 0 8M4 20h16',
  lean: 'M5 20l6-16h7l-6 16M3 20h18',
  curve: 'M9 4h6a5 5 0 015 5v6a5 5 0 01-5 5H9a5 5 0 01-5-5V9a5 5 0 015-5z',
  pen: 'M4 20l4-1 11-11-3-3L5 16zM14 7l3 3',
  smooth: 'M3 18c5 0 4-12 9-12s4 12 9 12',
  corner: 'M3 18l9-12 9 12',
  slot: 'M6 3h12v18H6zM10 6l4 3-4 3 4 3-4 3',
  shell: 'M8 21V7h8v14M4 21V3M20 21V3M4 7h4M16 7h4',
};
export type IconName = keyof typeof P;
export function Icon({ n, size = 18, stroke = 1.75 }: { n: string; size?: number; stroke?: number }) {
  return (
    <svg class="ico" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={stroke} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={P[n] ?? ''} />
    </svg>
  );
}

// ---------- formatting ----------
export const nf = (v: number, d = 0) => v.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
export const SQFT_PER_M2 = 10.7639;
export const sqft = (m2: number) => `${nf(m2 * SQFT_PER_M2)} sq ft`;
export const cr = (rs: number) => `${rs < 0 ? '−' : ''}₹${nf(Math.abs(rs) / 1e7, 2)} cr`;
export const pct = (v: number | null, d = 1) => (v === null || !Number.isFinite(v) ? '—' : `${nf(v * 100, d)}%`);

// ---------- a number ----------
export function Num({ label, value, set, step = 1, min = 0, max = 99999, unit, hint, wide, zero }: {
  label: string; value: number; set: (v: number) => void; step?: number; min?: number; max?: number; unit?: string; hint?: string; wide?: boolean;
  /** what 0 means, shown in place of it ("Auto") */
  zero?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const t = useRef<number>();
  useEffect(() => () => clearTimeout(t.current), []);
  const fix = (v: number) => Math.round(v / step) * step;
  const commit = (v: number) => { const c = Math.min(max, Math.max(min, v)); if (c !== value) set(Number(fix(c).toFixed(4))); };
  const bump = (k: number) => { setDraft(null); commit(value + k * step); };
  const num = (s: string) => parseFloat(s.replace(/,/g, ''));
  const shown = draft ?? (zero && value === 0 ? '' : Math.abs(value) >= 1000 && Number.isInteger(value) ? value.toLocaleString('en-IN') : String(Number(value.toFixed(4))));
  const bad = draft !== null && draft !== '' && (!Number.isFinite(num(draft)) || num(draft) < min || num(draft) > max);
  return (
    <label class={`f${wide ? ' wide' : ''}`}>
      <span class="f-l">{label}</span>
      <span class={`f-num${bad ? ' bad' : ''}`}>
        <button type="button" tabIndex={-1} aria-label={`Less ${label}`} onClick={(e) => { e.preventDefault(); bump(-1); }}><Icon n="minus" size={14} /></button>
        <input type="text" inputMode="decimal" value={shown} aria-label={label} placeholder={zero}
          onInput={(e) => {
            const s = (e.target as HTMLInputElement).value; setDraft(s);
            clearTimeout(t.current);
            const v = s.trim() === '' && zero ? 0 : num(s);
            if (Number.isFinite(v) && v >= min && v <= max) t.current = window.setTimeout(() => commit(v), 260);
          }}
          onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); bump(e.shiftKey ? 10 : 1); } if (e.key === 'ArrowDown') { e.preventDefault(); bump(e.shiftKey ? -10 : -1); } if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          onBlur={() => { if (draft !== null) { const v = draft.trim() === '' && zero ? 0 : num(draft); if (Number.isFinite(v)) commit(v); } setDraft(null); }} />
        {unit && <i>{unit}</i>}
        <button type="button" tabIndex={-1} aria-label={`More ${label}`} onClick={(e) => { e.preventDefault(); bump(1); }}><Icon n="plus" size={14} /></button>
      </span>
      {hint && <span class="f-h">{hint}</span>}
    </label>
  );
}

/** A bare range input in the house style (ink track filled up to the thumb). `valueText` is what a screen reader says
 *  for the value ("15:30", "12 floors"). */
export function Range({ value, min, max, step = 1, onInput, label, valueText, class: cls }: { value: number; min: number; max: number; step?: number; onInput: (v: number) => void; label?: string; valueText?: string; class?: string }) {
  const fill = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <input type="range" class={`range${cls ? ` ${cls}` : ''}`} min={min} max={max} step={step} value={value} aria-label={label} aria-valuetext={valueText}
      style={`--fill:${Math.min(100, Math.max(0, fill))}%`} onInput={(e) => onInput(+(e.target as HTMLInputElement).value)} />
  );
}

/** A range slider with its value beside it, for things people sweep (floors, a share). */
export function Slider({ label, value, set, min, max, step = 1, fmt = (v: number) => String(v) }: { label: string; value: number; set: (v: number) => void; min: number; max: number; step?: number; fmt?: (v: number) => string }) {
  const [v, setV] = useState<number | null>(null);
  const t = useRef<number>();
  useEffect(() => () => clearTimeout(t.current), []);
  return (
    <label class="f slider">
      <span class="f-l">{label}<b>{fmt(v ?? value)}</b></span>
      <Range min={min} max={max} step={step} value={v ?? value} valueText={fmt(v ?? value)}
        onInput={(x) => { setV(x); clearTimeout(t.current); t.current = window.setTimeout(() => { set(x); setV(null); }, 120); }} />
    </label>
  );
}

/** A segmented control: a radio group of up to four. Arrow keys move the choice (and focus) along it, as radios do;
 *  only the chosen one is in the tab order. */
export function Seg<T extends string>({ value, set, options, label, ariaLabel, small, class: cls }: { value: T; set: (v: T) => void; options: { value: T; label: string; title?: string; icon?: string; checked?: boolean; disabled?: boolean }[]; label?: string; ariaLabel?: string; small?: boolean; class?: string }) {
  const on = (o: { value: T; checked?: boolean }) => o.checked ?? o.value === value;
  const tabbable = Math.max(0, options.findIndex(on));
  const key = (e: KeyboardEvent) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault(); e.stopPropagation();
    const btns = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button[role="radio"]')];
    let i = btns.indexOf(document.activeElement as HTMLButtonElement);
    for (let k = 0; k < btns.length; k++) { i = (i + d + btns.length) % btns.length; if (!btns[i].disabled) break; }
    btns[i]?.focus(); if (options[i] && !options[i].disabled) set(options[i].value);
  };
  const el = (
    <div class={`seg${small ? ' small' : ''}${cls ? ` ${cls}` : ''}`} role="radiogroup" aria-label={label ?? ariaLabel} onKeyDown={key}>
      {options.map((o, i) => (
        <button type="button" role="radio" aria-checked={on(o)} tabIndex={i === tabbable ? 0 : -1} disabled={o.disabled} title={o.title} onClick={() => set(o.value)}>
          {o.icon && <Icon n={o.icon} size={15} />}{o.label}
        </button>
      ))}
    </div>
  );
  return label ? <div class="f"><span class="f-l">{label}</span>{el}</div> : el;
}

// ---------- a select (the WAI-ARIA select-only combobox) ----------
export type SelectOption<T> = { value: T; label: string; hint?: string; disabled?: boolean };
type SelectProps<T> = {
  value: T; onChange: (v: T) => void; options: SelectOption<T>[];
  /** a visible label: the field is wrapped in the .f / .f-l pattern */
  label?: string;
  /** the accessible name when there is no visible label */
  'aria-label'?: string;
  hint?: string; disabled?: boolean;
  /** 'sm' for tables, the building list and toolbars */
  size?: 'sm';
  /** no border, for inside a toolbar group */
  quiet?: boolean;
  /** shown when the value isn't one of the options */
  placeholder?: string;
  class?: string;
};

const SELECT_GAP = 4, SELECT_MARGIN = 8, SELECT_MAX_H = 320;
/** A listbox button, so the list is drawn in the house style on every platform. The popup goes to document.body with
 *  position: fixed from the button's rect, so neither the scrolling panel, a modal nor the 3D toolbar clips it; it
 *  opens downward, or upward when there's more room above, and stays inside the viewport. Focus stays on the button
 *  (aria-activedescendant points at the active option). */
export function Select<T extends string | number>({ value, onChange, options, label, hint, disabled, size, quiet, placeholder, class: cls, ...rest }: SelectProps<T>) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null), list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; width: number; maxH: number; up: boolean } | null>(null);
  const typed = useRef({ s: '', t: 0 });
  const cur = options.findIndex((o) => o.value === value);
  const enabled = (i: number) => i >= 0 && i < options.length && !options[i].disabled;
  const step = (from: number, d: number) => { let i = from; for (let k = 0; k < options.length; k++) { const n = i + d; if (n < 0 || n >= options.length) break; i = n; if (enabled(i)) return i; } return enabled(from) ? from : -1; };
  const first = () => step(-1, 1), last = () => step(options.length, -1);

  const show = (at = cur >= 0 ? cur : first()) => { if (disabled || btn.current?.matches(':disabled')) return; setActive(at); setOpen(true); };
  const hide = (focus = true) => { setOpen(false); setPos(null); if (focus) btn.current?.focus(); };
  const pick = (i: number) => { if (!enabled(i)) return; if (options[i].value !== value) onChange(options[i].value); hide(); };

  // place the popup from the button's rect; again on any scroll or resize while open
  const place = () => {
    const b = btn.current; if (!b) return;
    const r = b.getBoundingClientRect();
    const vw = document.documentElement.clientWidth, vh = window.innerHeight;
    if (r.bottom < 0 || r.top > vh) { hide(false); return; }
    const want = Math.min(SELECT_MAX_H, (list.current?.scrollHeight ?? options.length * 34) + 2);
    const below = vh - r.bottom - SELECT_GAP - SELECT_MARGIN, above = r.top - SELECT_GAP - SELECT_MARGIN;
    const up = below < Math.min(want, 160) && above > below;
    // as wide as the button at least, as its longest option at most, never wider than the viewport
    const width = Math.min(Math.max(r.width, size === 'sm' ? 140 : 180), vw - 2 * SELECT_MARGIN);
    const drawn = Math.min(Math.max(width, list.current?.offsetWidth ?? 0), vw - 2 * SELECT_MARGIN);
    const left = Math.min(Math.max(SELECT_MARGIN, r.left), vw - SELECT_MARGIN - drawn);
    setPos(up ? { left, bottom: vh - r.top + SELECT_GAP, width, maxH: Math.max(96, above), up } : { left, top: r.bottom + SELECT_GAP, width, maxH: Math.max(96, below), up });
  };
  useLayoutEffect(() => { if (open) place(); }, [open, options.length]);
  useEffect(() => {
    if (!open) return;
    const onScroll = (e: Event) => { if (e.target !== list.current) place(); };
    const onDown = (e: PointerEvent) => { const t = e.target as Node; if (!btn.current?.contains(t) && !list.current?.contains(t)) hide(false); };
    addEventListener('scroll', onScroll, true); addEventListener('resize', onScroll);
    document.addEventListener('pointerdown', onDown, true);
    return () => { removeEventListener('scroll', onScroll, true); removeEventListener('resize', onScroll); document.removeEventListener('pointerdown', onDown, true); };
  }, [open]);
  // keep the active option in view
  useEffect(() => { if (open && active >= 0) list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' }); }, [open, active, pos]);

  const typeAhead = (ch: string) => {
    const now = Date.now(), T = typed.current;
    T.s = now - T.t > 600 ? ch : T.s + ch; T.t = now;
    const q = T.s.toLowerCase(), same = q.split('').every((c) => c === q[0]);
    const from = open ? active : cur, n = options.length;
    // a repeated letter cycles through the options that start with it; otherwise match the whole run typed
    const order = Array.from({ length: n }, (_, k) => (from + (same || q.length === 1 ? 1 : 0) + k + n) % n);
    const hit = order.find((i) => enabled(i) && options[i].label.toLowerCase().startsWith(same ? q[0] : q));
    if (hit !== undefined) { if (open) setActive(hit); else show(hit); }
  };

  const onKey = (e: KeyboardEvent) => {
    const k = e.key;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    // a space in the middle of typing a name is part of the name; otherwise it opens, or picks
    if (k === ' ' && typed.current.s && Date.now() - typed.current.t < 600) { stop(); typeAhead(' '); return; }
    if (!open) {
      if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') { stop(); show(); return; }
      if (k === 'Home') { stop(); show(first()); return; }
      if (k === 'End') { stop(); show(last()); return; }
    } else {
      if (k === 'ArrowDown') { stop(); setActive(step(active, 1)); return; }
      if (k === 'ArrowUp') { stop(); if (e.altKey) pick(active); else setActive(step(active, -1)); return; }
      if (k === 'Home') { stop(); setActive(first()); return; }
      if (k === 'End') { stop(); setActive(last()); return; }
      if (k === 'PageDown') { stop(); let i = active; for (let n = 0; n < 10; n++) i = step(i, 1); setActive(i); return; }
      if (k === 'PageUp') { stop(); let i = active; for (let n = 0; n < 10; n++) i = step(i, -1); setActive(i); return; }
      if (k === 'Enter' || k === ' ') { stop(); pick(active); return; }
      if (k === 'Escape') { stop(); hide(); return; }
      if (k === 'Tab') { if (enabled(active) && options[active].value !== value) onChange(options[active].value); setOpen(false); setPos(null); return; }
    }
    if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { stop(); typeAhead(k); }
  };

  const labelId = label ? `${id}-l` : undefined;
  const shown = cur >= 0 ? options[cur].label : placeholder ?? '';
  const trigger = (
    <button ref={btn} type="button" role="combobox" class={`sel${size ? ` ${size}` : ''}${quiet ? ' quiet' : ''}${cls ? ` ${cls}` : ''}`}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
      aria-labelledby={labelId} aria-label={label ? undefined : rest['aria-label']} disabled={disabled}
      onClick={() => (open ? hide() : show())} onKeyDown={onKey} onBlur={() => { if (open) { setOpen(false); setPos(null); } }}>
      <span class={`sel-v${cur < 0 ? ' ph' : ''}`}>{shown}</span>
      <Icon n="chevron" size={size ? 13 : 14} />
    </button>
  );
  const popup = open && createPortal(
    <ul ref={list} id={`${id}-list`} role="listbox" tabIndex={-1} aria-labelledby={labelId} aria-label={label ? undefined : rest['aria-label']}
      class={`sel-pop${size ? ` ${size}` : ''}${pos?.up ? ' up' : ''}`}
      style={pos ? { left: `${pos.left}px`, top: pos.top !== undefined ? `${pos.top}px` : 'auto', bottom: pos.bottom !== undefined ? `${pos.bottom}px` : 'auto', minWidth: `${pos.width}px`, maxWidth: `calc(100vw - ${2 * SELECT_MARGIN}px)`, maxHeight: `${Math.min(SELECT_MAX_H, pos.maxH)}px` } : { visibility: 'hidden', left: '0px', top: '0px' }}
      onMouseDown={(e) => e.preventDefault()}>
      {options.map((o, i) => (
        <li id={`${id}-${i}`} data-i={i} role="option" aria-selected={i === cur} aria-disabled={o.disabled || undefined}
          class={`${i === active ? 'on' : ''}${i === cur ? ' sel-cur' : ''}`}
          onMouseMove={() => { if (i !== active && enabled(i)) setActive(i); }} onClick={() => pick(i)}>
          <span class="sel-ck" aria-hidden="true">{i === cur && <Icon n="check" size={14} stroke={2.25} />}</span>
          <span class="sel-t">{o.label}{o.hint && <small>{o.hint}</small>}</span>
        </li>
      ))}
    </ul>,
    document.body,
  );
  if (!label) return <>{trigger}{popup}</>;
  return (
    <div class="f">
      <span class="f-l" id={labelId} onClick={() => btn.current?.focus()}>{label}</span>
      {trigger}{popup}
      {hint && <span class="f-h">{hint}</span>}
    </div>
  );
}

/** A checkbox in the house style: a box that fills with ink and shows a check (the word beside it says what it is). */
export function Check({ label, value, set, disabled }: { label: ComponentChildren; value: boolean; set: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label class="check">
      <input type="checkbox" checked={value} disabled={disabled} onChange={(e) => set((e.target as HTMLInputElement).checked)} />
      <span class="check-b" aria-hidden="true"><Icon n="check" size={12} stroke={2.75} /></span>
      <span class="check-l">{label}</span>
    </label>
  );
}

export function Toggle({ label, value, set, hint }: { label: string; value: boolean; set: (v: boolean) => void; hint?: string }) {
  return (
    <label class="tog">
      <input type="checkbox" role="switch" checked={value} onChange={(e) => set((e.target as HTMLInputElement).checked)} />
      <span class="tog-sw" aria-hidden="true" />
      <span class="tog-l">{label}{hint && <small>{hint}</small>}</span>
    </label>
  );
}

export function Color({ label, value, set }: { label: string; value: string; set: (v: string) => void }) {
  return <label class="f color"><span class="f-l">{label}</span><span class="color-in"><input type="color" value={value} onInput={(e) => set((e.target as HTMLInputElement).value)} /><code>{value}</code></span></label>;
}

/** A panel section: a title, an optional line under it, and its body; folds when `fold` is set. */
export function Section({ title, sub, children, fold, open: start = true, aside }: { title: string; sub?: string; children: ComponentChildren; fold?: boolean; open?: boolean; aside?: ComponentChildren }) {
  const [open, setOpen] = useState(start);
  if (!fold) return <section class="sec"><header class="sec-h"><h3>{title}</h3>{aside}</header>{sub && <p class="sec-sub">{sub}</p>}<div class="sec-b">{children}</div></section>;
  return (
    <section class={`sec fold${open ? ' open' : ''}`}>
      <button type="button" class="sec-h" aria-expanded={open} onClick={() => setOpen(!open)}><h3>{title}</h3>{aside}<Icon n="chevron" size={16} /></button>
      {open && <>{sub && <p class="sec-sub">{sub}</p>}<div class="sec-b">{children}</div></>}
    </section>
  );
}

export const Row = ({ children, n = 2 }: { children: ComponentChildren; n?: 2 | 3 }) => <div class={`row r${n}`}>{children}</div>;
export const Note = ({ children, tone }: { children: ComponentChildren; tone?: 'ok' | 'warn' | 'bad' }) => <p class={`note${tone ? ` ${tone}` : ''}`}>{children}</p>;

/** One figure: label, value, an optional line under it. */
export function Stat({ label, value, sub, tone, big }: { label: string; value: ComponentChildren; sub?: ComponentChildren; tone?: 'ok' | 'warn' | 'bad'; big?: boolean }) {
  return <div class={`stat${big ? ' big' : ''}${tone ? ` ${tone}` : ''}`}><span>{label}</span><b>{value}</b>{sub && <small>{sub}</small>}</div>;
}

/** Key-value lines (a statement). */
export function Lines({ rows }: { rows: [ComponentChildren, ComponentChildren, string?][] }) {
  return <dl class="lines">{rows.map(([k, v, c]) => <div class={c}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

/** A button. An icon-only one takes its name from `title` (aria-label) and shows it in the house tooltip; one with
 *  words shows `title` as a tooltip and an accessible description. */
export function Btn({ children, onClick, kind, icon, title, disabled, href, download, submit }: { children?: ComponentChildren; onClick?: (e: MouseEvent) => void; kind?: 'primary' | 'ghost' | 'quiet'; icon?: string; title?: string; disabled?: boolean; href?: string; download?: string; submit?: boolean }) {
  const cls = `btn${kind ? ` ${kind}` : ''}${children ? '' : ' icon-only'}`;
  const inner = <>{icon && <Icon n={icon} size={16} />}{children}</>;
  const a11y = { 'data-tip': title, 'aria-label': children ? undefined : title, 'aria-description': children ? title : undefined };
  if (href) return <a class={cls} href={href} download={download} {...a11y}>{inner}</a>;
  return <button type={submit ? 'submit' : 'button'} class={cls} onClick={onClick} disabled={disabled} {...a11y}>{inner}</button>;
}

// ---------- tooltips ----------
/** One tooltip for the whole page: anything with `data-tip` shows it on hover (after a beat) or on keyboard focus,
 *  above the element (below when there's no room; `data-tip-side="right"` beside it), kept inside the viewport.
 *  Not on touch: there the visible label or aria-label carries it. Mount once. */
export function TooltipLayer() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; side: 'top' | 'bottom' | 'right' } | null>(null);
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let t = 0, cur: HTMLElement | null = null;
    const find = (n: EventTarget | null) => (n instanceof Element ? n.closest<HTMLElement>('[data-tip]') : null);
    const showFor = (h: HTMLElement) => {
      const text = h.dataset.tip; if (!text || !h.isConnected) return;
      cur = h;
      const r = h.getBoundingClientRect();
      if (h.dataset.tipSide === 'right') setTip({ text, x: r.right + 8, y: r.top + r.height / 2, side: 'right' });
      else if (r.top > 40) setTip({ text, x: r.left + r.width / 2, y: r.top - 6, side: 'top' });
      else setTip({ text, x: r.left + r.width / 2, y: r.bottom + 6, side: 'bottom' });
    };
    const hide = () => { clearTimeout(t); cur = null; setTip(null); };
    const over = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const h = find(e.target);
      if (h === cur) return;
      hide();
      if (h) { cur = h; t = window.setTimeout(() => showFor(h), 450); }
    };
    const focus = (e: FocusEvent) => { const h = find(e.target); hide(); if (h && h.matches(':focus-visible')) showFor(h); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && cur) hide(); };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', hide);
    document.addEventListener('keydown', key, true);
    addEventListener('scroll', hide, true);
    return () => { hide(); document.removeEventListener('pointerover', over); document.removeEventListener('pointerdown', hide, true); document.removeEventListener('focusin', focus); document.removeEventListener('focusout', hide); document.removeEventListener('keydown', key, true); removeEventListener('scroll', hide, true); };
  }, []);
  // keep it inside the viewport once its width is known
  useLayoutEffect(() => {
    const d = el.current; if (!d || !tip || tip.side === 'right') return;
    const w = d.offsetWidth, vw = document.documentElement.clientWidth;
    d.style.left = `${Math.min(Math.max(8, tip.x - w / 2), vw - 8 - w)}px`;
  }, [tip]);
  if (!tip) return null;
  const style = tip.side === 'right' ? `left:${tip.x}px;top:${tip.y}px;transform:translateY(-50%)` : tip.side === 'top' ? `left:0;top:${tip.y}px;transform:translateY(-100%)` : `left:0;top:${tip.y}px`; // (left is set once its width is known)
  return createPortal(<div ref={el} class="tooltip" role="tooltip" style={style}>{tip.text}</div>, document.body);
}

// ---------- a dialog ----------
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** The .modal pattern as a proper dialog: labelled by its title, aria-modal, focus moved in on open and kept in (Tab
 *  wraps), Escape and a click on the backdrop close it, and focus goes back to what opened it. `side` docks it to the
 *  right under the header; `wide` for forms. */
export function Dialog({ title, close, children, side, wide }: { title: string; close: () => void; children: ComponentChildren; side?: boolean; wide?: boolean }) {
  const id = useId(), box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    box.current?.focus({ preventScroll: true });
    return () => { if (back && back.isConnected && back !== document.body) back.focus({ preventScroll: true }); };
  }, []);
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab' || !box.current) return;
    const f = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.getClientRects().length > 0);
    if (!f.length) { e.preventDefault(); return; }
    const a = f[0], z = f[f.length - 1], at = document.activeElement;
    if (e.shiftKey && (at === a || at === box.current)) { e.preventDefault(); z.focus(); }
    else if (!e.shiftKey && at === z) { e.preventDefault(); a.focus(); }
  };
  return (
    <div class={`modal-bg${side ? ' side' : ''}`} onClick={(ev) => { if (ev.target === ev.currentTarget) close(); }}>
      <div ref={box} class={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={`${id}-t`} tabIndex={-1} onKeyDown={key}>
        <header><h2 id={`${id}-t`}>{title}</h2><Btn kind="quiet" icon="x" title="Close" onClick={close} /></header>
        <div class="modal-b">{children}</div>
      </div>
    </div>
  );
}

// ---------- a menu ----------
export type MenuItem = { label: string; icon?: string; onSelect?: () => void; href?: string; checked?: boolean; sub?: string; disabled?: boolean }
  /** a heading over the items after it (not an item: arrows skip it) */
  | { heading: string };
const isItem = (x: MenuItem): x is Exclude<MenuItem, { heading: string }> => !('heading' in x);
/** A menu button (WAI-ARIA menu pattern): opens on click, Enter, Space or ArrowDown (focus on the first item) or
 *  ArrowUp (the last); arrows, Home and End move, a letter jumps; Escape closes and returns focus to the button, Tab
 *  closes and moves on; a click outside closes it. */
export function Menu({ label, icon = 'more', items, text, onOpen, class: cls }: { label: string; icon?: string; items: MenuItem[];
  /** show the label beside the icon (a labelled button, not an icon-only one) */
  text?: boolean;
  /** called as it opens (to load what it lists) */
  onOpen?: () => void; class?: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null), box = useRef<HTMLDivElement>(null), wrap = useRef<HTMLSpanElement>(null);
  const start = useRef(0);
  const els = () => [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled), [role="menuitemradio"]:not(:disabled)') ?? [])];
  const close = (focus = true) => { setOpen(false); if (focus) btn.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const l = els(); l[(start.current + l.length) % l.length]?.focus();
    const down = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) close(false); };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [open]);
  const onBtnKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); start.current = e.key === 'ArrowUp' ? -1 : 0; setOpen(true); }
  };
  const onMenuKey = (e: KeyboardEvent) => {
    const l = els(), i = l.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => { e.preventDefault(); e.stopPropagation(); l[(n + l.length) % l.length]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1);
    else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(l.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close(false);
    else if (e.key === ' ' && document.activeElement instanceof HTMLAnchorElement) { e.preventDefault(); document.activeElement.click(); }
    else if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.stopPropagation();
      const c = e.key.toLowerCase(), its = items.filter(isItem), n = its.length;
      for (let k = 1; k <= n; k++) { const j = (i + k) % n; if (its[j].label.toLowerCase().startsWith(c)) { go(j); break; } }
    }
  };
  return (
    <span class={`more${cls ? ` ${cls}` : ''}`} ref={wrap}>
      <button ref={btn} type="button" class={`btn ${text ? '' : 'quiet icon-only'}`} id={`${id}-b`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? `${id}-m` : undefined}
        aria-label={text ? undefined : label} data-tip={open || text ? undefined : label} onClick={() => { start.current = 0; if (!open) onOpen?.(); setOpen(!open); }} onKeyDown={(e) => { if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) onOpen?.(); onBtnKey(e); }}>
        <Icon n={icon} size={16} />{text && label}
      </button>
      {open && <div ref={box} class="menu" role="menu" id={`${id}-m`} aria-labelledby={`${id}-b`} onKeyDown={onMenuKey}>
        {items.map((it) => {
          if (!isItem(it)) return <div class="menu-h" role="presentation">{it.heading}</div>;
          const inner = <>{it.icon ? <Icon n={it.icon} size={15} /> : it.checked !== undefined ? <span class="menu-c">{it.checked && <Icon n="check" size={14} />}</span> : null}<span class="menu-l">{it.label}{it.sub && <small>{it.sub}</small>}</span></>;
          return it.href
            ? <a role="menuitem" tabIndex={-1} href={it.href} onClick={() => setOpen(false)}>{inner}</a>
            : <button type="button" role={it.checked !== undefined ? 'menuitemradio' : 'menuitem'} aria-checked={it.checked} tabIndex={-1} disabled={it.disabled} onClick={() => { close(); it.onSelect?.(); }}>{inner}</button>;
        })}
      </div>}
    </span>
  );
}

/** Download text as a file. */
export function download(name: string, text: string | Blob, type = 'text/plain') {
  const blob = typeof text === 'string' ? new Blob([text], { type }) : text;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export type Children = ComponentChildren;
export type El = JSX.Element;
