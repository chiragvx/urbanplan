// Small building blocks: number fields you can scrub like Figma, toggles, segmented controls, menus, icons.
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import { createContext, type ComponentChildren, type JSX } from 'preact';
import { createPortal } from 'preact/compat';
import { inspTab } from '../editor/state';

let scrubSeq = 0;

/**
 * Number input. Drag the label sideways to scrub (Shift ×10, Alt ×0.1); type and press Enter; ↑/↓ step.
 * `onChange(v, merge)` — scrubs pass a merge key so a whole drag is one undo step.
 */
export function NumberField(p: {
  label?: string; value: number | null; onChange: (v: number, merge?: string) => void; step?: number; min?: number; max?: number;
  unit?: string; digits?: number; state?: 'base' | 'own' | 'road' | 'new'; title?: string; disabled?: boolean; width?: number;
  /** shown when the value is mixed (null) */
  placeholder?: string;
}) {
  const step = p.step ?? 0.1, digits = p.digits ?? 1;
  const [text, setText] = useState<string | null>(null);
  const clamp = (v: number) => Math.min(p.max ?? Infinity, Math.max(p.min ?? -Infinity, v));
  const fmt = (v: number | null) => (v === null ? '' : (Math.round(v * 10 ** digits) / 10 ** digits).toFixed(digits));
  const commit = (s: string) => {
    setText(null);
    const v = evalNum(s, p.value ?? 0);
    if (v !== null && Number.isFinite(v)) p.onChange(clamp(v));
  };
  const scrub = (e: PointerEvent) => {
    if (p.disabled || p.value === null) return;
    e.preventDefault();
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const x0 = e.clientX, v0 = p.value, key = 'scrub' + ++scrubSeq;
    document.body.style.cursor = 'ew-resize';
    const move = (m: PointerEvent) => {
      const k = m.shiftKey ? 10 : m.altKey ? 0.1 : 1;
      const v = clamp(v0 + Math.round((m.clientX - x0) / 4) * step * k);
      p.onChange(Math.round(v * 1000) / 1000, key);
    };
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); document.body.style.cursor = ''; };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  return (
    <label class={`nf ${p.disabled ? 'disabled' : ''}`} title={p.title} style={p.width ? { width: p.width } : undefined}>
      {p.label && <span class="nf-label" onPointerDown={scrub as unknown as JSX.PointerEventHandler<HTMLSpanElement>} onClick={(e) => e.preventDefault()}>{p.state && p.state !== 'base' && <i class={`dot ${p.state}`} />}{p.label}</span>}
      <input
        value={text ?? (p.value === null ? '' : fmt(p.value))}
        placeholder={p.value === null ? (p.placeholder ?? 'Mixed') : ''}
        disabled={p.disabled}
        onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
        onInput={(e) => setText((e.currentTarget as HTMLInputElement).value)}
        onBlur={(e) => text !== null && commit((e.currentTarget as HTMLInputElement).value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { commit((e.currentTarget as HTMLInputElement).value); (e.currentTarget as HTMLInputElement).blur(); }
          if (e.key === 'Escape') { setText(null); (e.currentTarget as HTMLInputElement).blur(); }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const k = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1) * step;
            p.onChange(clamp(Math.round(((p.value ?? 0) + k) * 1000) / 1000), 'arrow');
          }
        }}
      />
      {p.unit && <span class="nf-unit">{p.unit}</span>}
    </label>
  );
}

/** "12", "+2", "-1.5", "*2", "18/2" relative to the current value. */
function evalNum(s: string, cur: number): number | null {
  const t = s.trim();
  if (!t) return null;
  const m = /^([+\-*/])\s*(-?\d*\.?\d+)$/.exec(t);
  if (m) { const v = Number(m[2]); return m[1] === '+' ? cur + v : m[1] === '-' ? cur - v : m[1] === '*' ? cur * v : v ? cur / v : null; }
  const n = Number(t.replace(/m$/, ''));
  return Number.isFinite(n) ? n : null;
}

export function Toggle(p: { checked: boolean; onChange: (v: boolean) => void; label?: ComponentChildren; disabled?: boolean; title?: string }) {
  return (
    <label class={`toggle ${p.disabled ? 'disabled' : ''}`} title={p.title}>
      <input type="checkbox" checked={p.checked} disabled={p.disabled} onChange={(e) => p.onChange((e.currentTarget as HTMLInputElement).checked)} />
      <span class="track"><span class="knob" /></span>
      {p.label && <span>{p.label}</span>}
    </label>
  );
}

export function Seg<T extends string>(p: { value: T; options: { value: T; label: ComponentChildren; title?: string }[]; onChange: (v: T) => void; small?: boolean }) {
  return (
    <div class={`seg ${p.small ? 'small' : ''}`}>
      {p.options.map((o) => <button key={o.value} class={o.value === p.value ? 'on' : ''} title={o.title} onClick={() => p.onChange(o.value)}>{o.label}</button>)}
    </div>
  );
}

export function Select<T extends string>(p: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; title?: string; disabled?: boolean }) {
  return (
    <select class="select" value={p.value} title={p.title} disabled={p.disabled} onChange={(e) => p.onChange((e.currentTarget as HTMLSelectElement).value as T)}>
      {p.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Row(p: { label?: ComponentChildren; children: ComponentChildren; hint?: string }) {
  return <div class="row" title={p.hint}>{p.label !== undefined && <span class="row-label">{p.label}</span>}<div class="row-body">{p.children}</div></div>;
}

/** Inside an inspector tab a Section is the tab's whole body: no header, no collapsing. */
const FlatSections = createContext(false);

/** Inspector tabs; the open tab is remembered per `id` (e.g. 'road') across selections. */
export function Tabs(p: { id: string; tabs: { id: string; label: ComponentChildren; hint?: ComponentChildren; body: () => ComponentChildren }[] }) {
  const want = inspTab.value[p.id];
  const cur = p.tabs.find((t) => t.id === want) ?? p.tabs[0];
  return (
    <div class="itabs">
      <nav class="itabs-bar" role="tablist">
        {p.tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={t === cur} class={t === cur ? 'on' : ''} onClick={() => { inspTab.value = { ...inspTab.value, [p.id]: t.id }; }}>
            {t.label}{t.hint ? <span class="itabs-hint">{t.hint}</span> : null}
          </button>
        ))}
      </nav>
      <div class="itabs-body"><FlatSections.Provider value={true}>{cur.body()}</FlatSections.Provider></div>
    </div>
  );
}

export function Section(p: { title: ComponentChildren; children: ComponentChildren; right?: ComponentChildren; open?: boolean }) {
  const flat = useContext(FlatSections);
  const [open, setOpen] = useState(p.open ?? true);
  if (flat) return <div class="isec-flat">{p.right ? <div class="isec-right">{p.right}</div> : null}{p.children}</div>;
  return (
    <section class="isec">
      <header onClick={() => setOpen(!open)}><span class={`chev ${open ? 'open' : ''}`}>›</span><span class="isec-title">{p.title}</span><span class="spacer" />{p.right && <span onClick={(e) => e.stopPropagation()}>{p.right}</span>}</header>
      {open && <div class="isec-body">{p.children}</div>}
    </section>
  );
}

/** Dropdown menu anchored to a button. */
export function Menu(p: { label: ComponentChildren; items: ({ label: string; keys?: string; run: () => void; disabled?: boolean } | 'sep')[]; title?: string; class?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null), popRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node) && !popRef.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  // placed on screen (fixed), below the button or above it near the bottom, kept inside the window — so a menu
  // inside a scrolling card is never clipped
  const [pos, setPos] = useState<JSX.CSSProperties>({});
  const toggle = () => {
    if (!open && ref.current) {
      const r = ref.current.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
      const below = H - r.bottom, up = below < 260 && r.top > below;
      setPos({
        position: 'fixed', minWidth: Math.max(180, r.width),
        ...(r.left + 240 > W ? { right: Math.max(8, W - r.right), left: 'auto' } : { left: Math.max(8, r.left), right: 'auto' }),
        ...(up ? { bottom: H - r.top + 4, top: 'auto', maxHeight: r.top - 16 } : { top: r.bottom + 4, bottom: 'auto', maxHeight: below - 16 }),
      });
    }
    setOpen(!open);
  };
  return (
    <div class={`menu ${p.class ?? ''}`} ref={ref}>
      <button class={`menu-btn ${open ? 'on' : ''}`} title={p.title} onClick={toggle}>{p.label}</button>
      {open && createPortal(
        <div class="menu-pop" style={pos} ref={popRef}>
          {p.items.map((it, i) => it === 'sep' ? <hr key={i} /> : (
            <button key={i} disabled={it.disabled} onClick={() => { setOpen(false); it.run(); }}>
              <span>{it.label}</span>{it.keys && <kbd>{prettyKeys(it.keys)}</kbd>}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

export const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
export const prettyKeys = (k: string) => k.replace('Ctrl', isMac ? '⌘' : 'Ctrl').replace('Shift', '⇧').replace('Alt', isMac ? '⌥' : 'Alt').replace('Delete', 'Del').replace('Escape', 'Esc').replace('Arrow', '');

// ---------------- icons (16 px, stroke) ----------------

const I = (d: string, fill = false) => (props: { size?: number }) => (
  <svg width={props.size ?? 16} height={props.size ?? 16} viewBox="0 0 16 16" fill={fill ? 'currentColor' : 'none'} stroke={fill ? 'none' : 'currentColor'} stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d={d} /></svg>
);
export const Icon = {
  select: I('M3 2l9.5 5.5-4 1-1.6 4.2z', true),
  direct: I('M3 2l9.5 5.5-4 1-1.6 4.2z'),
  pen: I('M2.5 13.5l1-4L10 3l3 3-6.5 6.5zM9 4l3 3'),
  knife: I('M3 13L13 3M6 3.5a2 2 0 1 1-2.8 2.8M12.8 10a2 2 0 1 1-2.8 2.8M4.6 6.4L13 13'),
  line: I('M2 12c3-6 5 2 8-4s4-3 4-3M2 12h.01M14 5h.01'),
  measure: I('M2 10l8-8 4 4-8 8zM5 7l1.5 1.5M7 5l1.5 1.5M9 3l1.5 1.5'),
  hand: I('M5 8V3.5a1 1 0 0 1 2 0V7m0-3.5V2.5a1 1 0 0 1 2 0V7m0-3a1 1 0 0 1 2 0v3m0-1.5a1 1 0 0 1 2 0V10a4.5 4.5 0 0 1-4.5 4.5H8A4.5 4.5 0 0 1 4 12L2.6 9.3a1 1 0 0 1 1.7-1L5 9'),
  eye: I('M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'),
  eyeOff: I('M2 2l12 12M6.6 6.7A2 2 0 0 0 9.3 9.4M4.2 4.4C2.6 5.5 1.5 8 1.5 8s2.5 4.5 6.5 4.5c1.3 0 2.4-.4 3.4-1M7 3.6c.3 0 .7-.1 1-.1 4 0 6.5 4.5 6.5 4.5s-.5.9-1.4 2'),
  lock: I('M4 7h8v6H4zM5.5 7V5a2.5 2.5 0 0 1 5 0v2'),
  unlock: I('M4 7h8v6H4zM5.5 7V5a2.5 2.5 0 0 1 4.8-1'),
  undo: I('M5 3L2 6l3 3M2 6h7a4 4 0 0 1 0 8H6'),
  redo: I('M11 3l3 3-3 3M14 6H7a4 4 0 0 0 0 8h3'),
  cube: I('M8 1.5l5.5 3v7L8 14.5l-5.5-3v-7zM8 8l5.5-3.5M8 8v6.5M8 8L2.5 4.5'),
  map: I('M1.5 3.5l4-1.5 5 1.5 4-1.5v10.5l-4 1.5-5-1.5-4 1.5zM5.5 2v10.5M10.5 3.5V14'),
  xray: I('M1.5 5h13M3 8.5h2M7 8.5h2M11 8.5h2M3 12h2M7 12h2M11 12h2M5 2.5L8 5l3-2.5'),
  sun: I('M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.8 3.8l1 1M11.2 11.2l1 1M3.8 12.2l1-1M11.2 4.8l1-1M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'),
  moon: I('M13.5 9.6A5.6 5.6 0 1 1 6.4 2.5a4.4 4.4 0 0 0 7.1 7.1z'),
  search: I('M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM14 14l-3.5-3.5'),
  plus: I('M8 3v10M3 8h10'),
  close: I('M4 4l8 8M12 4l-8 8'),
  warn: I('M8 2l6.5 11.5h-13zM8 6.5v3M8 11.5h.01'),
  check: I('M3 8.5l3 3 7-7'),
  layers: I('M8 2l6.5 3.5L8 9 1.5 5.5zM1.5 8.5L8 12l6.5-3.5M1.5 11.5L8 15l6.5-3.5'),
  road: I('M5.5 1.5L3 14.5M10.5 1.5L13 14.5M8 2v2M8 7v2M8 12v2'),
  share: I('M11 5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM5 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM11 14.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6.8 9l2.4 1.5M9.2 5.5L6.8 7'),
  menu: I('M2 4h12M2 8h12M2 12h12'),
  help: I('M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM6.2 6a1.9 1.9 0 0 1 3.6.8c0 1.2-1.8 1.6-1.8 2.7M8 11.5h.01'),
  review: I('M2 3h12v8H6l-3 3v-3H2zM5 7l2 2 4-4'),
  target: I('M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z'),
  trash: I('M2.5 4h11M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4'),
  arrowUp: I('M8 13V3M4 7l4-4 4 4'),
  arrowDown: I('M8 3v10M4 9l4 4 4-4'),
  terrain: I('M1.5 13.5l4-6 3 3.5 2-2.5 4 5zM10 4.5a1.5 1.5 0 1 0 0-.01'),
  wand: I('M2 14L10 6M9 3v2M13 7h-2M12 4l-1.4 1.4M6.5 3.5l.7.7M12.5 9.5l-.7-.7'),
  bulldoze: I('M1.5 12.5h8M2.5 12.5V9h5l1.5 3.5M4 9V6.5h3L7.5 9M9.5 10l3-4.5 2 1M12.5 5.5L14 3'),
  multi: I('M2 13c2-5 4-7 6-7s4 2 6 7M8 6V2M5.5 3.5L8 2l2.5 1.5M3 9.5h2.5M10.5 9.5H13'),
  both: I('M5 13V3M2.5 5.5L5 3l2.5 2.5M11 3v10M8.5 10.5L11 13l2.5-2.5'),
};
