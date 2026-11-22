// Search (Ctrl+K): every action, every building and every setting by name. An action runs; a building is picked and
// framed; a setting opens its step, unfolds its section and focuses the field (findIn below).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Icon } from './ui';

export interface Cmd {
  label: string;
  icon: string;
  /** what kind: shown on the right */
  kind: 'Action' | 'View' | 'Building' | 'Setting' | 'Share' | 'Project';
  /** where it lives, or what it does, under the label */
  sub?: string;
  /** its keyboard shortcut */
  keys?: string;
  /** other words it's found by */
  words?: string;
  run: () => void;
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}/ ]+/gu, ' ');

/** The best matches: every word of the query in the label, its words or its sub; the label's own matches first. */
export function rank(all: Cmd[], q: string): Cmd[] {
  const ws = norm(q).split(/\s+/).filter(Boolean);
  if (!ws.length) return all;
  const scored: { c: Cmd; s: number }[] = [];
  for (const c of all) {
    const L = norm(c.label), hay = `${L} ${norm(c.words ?? '')} ${norm(c.sub ?? '')}`;
    if (!ws.every((w) => hay.includes(w))) continue;
    let s = 0;
    for (const w of ws) s += L.startsWith(w) ? 6 : new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(L) ? 4 : L.includes(w) ? 2 : 0;
    if (c.kind === 'Building' || c.kind === 'Action') s += 0.5;
    scored.push({ c, s });
  }
  return scored.sort((a, b) => b.s - a.s).map((x) => x.c);
}

export function Search({ cmds, close, first }: { cmds: Cmd[]; close: () => void; first: Cmd[] }) {
  const [q, setQ] = useState(''), [i, setI] = useState(0);
  const list = useRef<HTMLUListElement>(null);
  const items = useMemo(() => (q.trim() ? rank(cmds, q) : first).slice(0, 14), [q, cmds]);
  useEffect(() => setI(0), [q]);
  useEffect(() => { list.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' }); }, [i]);
  const run = (c: Cmd) => { close(); setTimeout(c.run, 0); };
  const key = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(items.length - 1, x + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
    else if (e.key === 'Enter' && items[i]) { e.preventDefault(); run(items[i]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    e.stopPropagation();
  };
  return (
    <div class="modal-bg pal-bg" onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div class="pal" role="dialog" aria-modal="true" aria-label="Search">
        <label class="pal-q"><Icon n="cursor" size={16} />
          <input autoFocus placeholder="Search actions, buildings and settings" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} onKeyDown={key}
            role="combobox" aria-expanded="true" aria-controls="pal-l" aria-activedescendant={items[i] ? `pal-${i}` : undefined} aria-autocomplete="list" />
          <kbd>Esc</kbd></label>
        <ul id="pal-l" role="listbox" ref={list}>{items.map((x, k) => (
          <li id={`pal-${k}`} role="option" aria-selected={k === i} class={k === i ? 'on' : ''} onMouseMove={() => k !== i && setI(k)} onClick={() => run(x)}>
            <Icon n={x.icon} size={16} />
            <span class="pal-t"><b>{x.label}</b>{x.sub && <small>{x.sub}</small>}</span>
            {x.keys ? <kbd>{x.keys}</kbd> : <em>{x.kind}</em>}
          </li>
        ))}{!items.length && <li class="none">Nothing matches “{q}”.</li>}</ul>
      </div>
    </div>
  );
}

/** Bring a setting into view in the open sheet: unfold its section, scroll to it, focus its field and flash it.
 *  Tries for a moment, since the step may only just have opened. */
export function findIn(sec: string, field?: string, tries = 12) {
  const root = document.querySelector('.sheet .panel-b');
  const s = root && [...root.querySelectorAll<HTMLElement>('section.sec')].find((x) => x.querySelector(':scope > .sec-h h3')?.textContent?.trim() === sec);
  if (!s) { if (tries > 0) setTimeout(() => findIn(sec, field, tries - 1), 60); return; }
  if (s.classList.contains('fold') && !s.classList.contains('open')) (s.querySelector(':scope > .sec-h') as HTMLElement | null)?.click();
  setTimeout(() => {
    let el: HTMLElement = s;
    if (field) {
      const lab = [...s.querySelectorAll<HTMLElement>('.f-l, .check-l, .tog-l, label, legend, .sl-l, span')].find((x) => x.textContent?.trim() === field || x.childNodes[0]?.textContent?.trim() === field);
      if (lab) el = (lab.closest('label, .f, .row > *') as HTMLElement | null) ?? lab;
    }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const f = el.matches('input, button, select, textarea') ? el : el.querySelector<HTMLElement>('input:not([type=hidden]), button, select, textarea');
    (field ? f : s.querySelector<HTMLElement>(':scope > .sec-h'))?.focus({ preventScroll: true });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
  }, 40);
}
