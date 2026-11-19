// Pro's small kit of controls. The rules they follow:
// - A number changes the scheme as it's typed (a short pause, not on blur), with − / + steppers for the mouse and
//   arrow keys for the keyboard, and its unit inside the field. Out-of-range values are held back, not clamped
//   under the cursor, and settle on blur.
// - Choices of up to four go in a segmented control, longer lists in a select.
// - Sections fold, so a panel opens on what most people change and keeps the rest one click away.
import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

// ---------- icons (24-px line icons, drawn here so nothing is fetched) ----------
const P: Record<string, string> = {
  site: 'M3 7l6-3 6 3 6-3v13l-6 3-6-3-6 3zM9 4v13M15 7v13',
  building: 'M4 21V5l8-3 8 3v16M9 21v-4h6v4M8 8h2M14 8h2M8 12h2M14 12h2',
  palette: 'M12 3a9 9 0 100 18c1.1 0 1.5-.8 1.5-1.6 0-.9-.6-1.3-.6-2.1 0-.9.7-1.6 1.6-1.6H17a4 4 0 004-4c0-4.9-4-8.7-9-8.7zM7.5 11.5h0M10 7.5h0M14.5 7.5h0',
  money: 'M6 4h12M6 9h12M14 4c3 0 4 2.5 4 5s-2 5-6 5H7l8 7',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM8.5 12l2.5 2.5 4.5-5',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
  share: 'M16 6l-4-4-4 4M12 2v13M5 12v7a2 2 0 002 2h10a2 2 0 002-2v-7',
  folder: 'M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z',
  more: 'M5 12h0M12 12h0M19 12h0',
  cube: 'M12 2l9 5v10l-9 5-9-5V7zM12 22V12M21 7l-9 5-9-5',
  plan: 'M3 3h18v18H3zM3 12h9M12 3v18M12 16h9',
  layers: 'M12 2l10 5-10 5L2 7zM2 12l10 5 10-5M2 17l10 5 10-5',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  plus: 'M12 5v14M5 12h14',
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
  key: 'M3 7h18v10H3zM7 11h0M11 11h0M15 11h0M7 14h10',
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
export const cr = (rs: number) => `₹${nf(rs / 1e7, 2)} cr`;
export const pct = (v: number | null, d = 1) => (v === null || !Number.isFinite(v) ? '—' : `${nf(v * 100, d)}%`);

// ---------- a number ----------
export function Num({ label, value, set, step = 1, min = 0, max = 99999, unit, hint, wide }: {
  label: string; value: number; set: (v: number) => void; step?: number; min?: number; max?: number; unit?: string; hint?: string; wide?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const t = useRef<number>();
  useEffect(() => () => clearTimeout(t.current), []);
  const fix = (v: number) => Math.round(v / step) * step;
  const commit = (v: number) => { const c = Math.min(max, Math.max(min, v)); if (c !== value) set(Number(fix(c).toFixed(4))); };
  const bump = (k: number) => { setDraft(null); commit(value + k * step); };
  const shown = draft ?? String(Number(value.toFixed(4)));
  const bad = draft !== null && (!Number.isFinite(parseFloat(draft)) || parseFloat(draft) < min || parseFloat(draft) > max);
  return (
    <label class={`f${wide ? ' wide' : ''}`}>
      <span class="f-l">{label}</span>
      <span class={`f-num${bad ? ' bad' : ''}`}>
        <button type="button" tabIndex={-1} aria-label={`Less ${label}`} onClick={(e) => { e.preventDefault(); bump(-1); }}><Icon n="minus" size={14} /></button>
        <input type="text" inputMode="decimal" value={shown} aria-label={label}
          onInput={(e) => {
            const s = (e.target as HTMLInputElement).value; setDraft(s);
            clearTimeout(t.current);
            const v = parseFloat(s);
            if (Number.isFinite(v) && v >= min && v <= max) t.current = window.setTimeout(() => commit(v), 260);
          }}
          onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); bump(e.shiftKey ? 10 : 1); } if (e.key === 'ArrowDown') { e.preventDefault(); bump(e.shiftKey ? -10 : -1); } if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          onBlur={() => { if (draft !== null) { const v = parseFloat(draft); if (Number.isFinite(v)) commit(v); } setDraft(null); }} />
        {unit && <i>{unit}</i>}
        <button type="button" tabIndex={-1} aria-label={`More ${label}`} onClick={(e) => { e.preventDefault(); bump(1); }}><Icon n="plus" size={14} /></button>
      </span>
      {hint && <span class="f-h">{hint}</span>}
    </label>
  );
}

/** A range slider with its value beside it, for things people sweep (floors, a share). */
export function Slider({ label, value, set, min, max, step = 1, fmt = (v: number) => String(v) }: { label: string; value: number; set: (v: number) => void; min: number; max: number; step?: number; fmt?: (v: number) => string }) {
  const [v, setV] = useState<number | null>(null);
  const t = useRef<number>();
  return (
    <label class="f slider">
      <span class="f-l">{label}<b>{fmt(v ?? value)}</b></span>
      <input type="range" min={min} max={max} step={step} value={v ?? value}
        onInput={(e) => { const x = +(e.target as HTMLInputElement).value; setV(x); clearTimeout(t.current); t.current = window.setTimeout(() => { set(x); setV(null); }, 120); }} />
    </label>
  );
}

export function Seg<T extends string>({ value, set, options, label, small }: { value: T; set: (v: T) => void; options: { value: T; label: string; title?: string; icon?: string }[]; label?: string; small?: boolean }) {
  const el = (
    <div class={`seg${small ? ' small' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button type="button" role="radio" aria-checked={o.value === value} title={o.title} onClick={() => set(o.value)}>
          {o.icon && <Icon n={o.icon} size={15} />}{o.label}
        </button>
      ))}
    </div>
  );
  return label ? <div class="f"><span class="f-l">{label}</span>{el}</div> : el;
}

export function Select<T extends string | number>({ label, value, set, options }: { label: string; value: T; set: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <label class="f">
      <span class="f-l">{label}</span>
      <select value={String(value)} onChange={(e) => { const s = (e.target as HTMLSelectElement).value; const o = options.find((x) => String(x.value) === s); if (o) set(o.value); }}>
        {options.map((o) => <option value={String(o.value)}>{o.label}</option>)}
      </select>
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

export function Btn({ children, onClick, kind, icon, title, disabled, href, download }: { children?: ComponentChildren; onClick?: (e: MouseEvent) => void; kind?: 'primary' | 'ghost' | 'quiet'; icon?: string; title?: string; disabled?: boolean; href?: string; download?: string }) {
  const cls = `btn${kind ? ` ${kind}` : ''}${children ? '' : ' icon-only'}`;
  const inner = <>{icon && <Icon n={icon} size={16} />}{children}</>;
  if (href) return <a class={cls} href={href} title={title} download={download}>{inner}</a>;
  return <button type="button" class={cls} onClick={onClick} title={title} aria-label={children ? undefined : title} disabled={disabled}>{inner}</button>;
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
