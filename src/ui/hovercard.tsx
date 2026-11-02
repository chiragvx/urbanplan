// Hover cards: one card for the whole app in place of the browser's title tooltips. Any element with a `title` (or a
// `data-tip`) gets it after 300 ms, at once while another is open: the name, a key chip read off a "(Ctrl+K)" / "(O)"
// part of the text, and a one-line hint (what follows the first ":" or " — "). `data-tip-art="kind:arg"` adds a small
// picture from an art registered with registerTipArt. The title moves to data-tip-t while hovered (so the browser's
// own tooltip never shows) and comes back on leave; screen readers keep aria-label.
import { render, type JSX } from 'preact';
import { signal } from '@preact/signals';
import './hovercard.css';

interface Tip { name: string; keys: string[]; hint: string; art: JSX.Element | null; r: DOMRect }

const tip = signal<Tip | null>(null);
const ARTS = new Map<string, (arg: string) => JSX.Element | null>();

/** Pictures for `data-tip-art="<kind>:<arg>"` (or just "<kind>"). */
export function registerTipArt(kind: string, fn: (arg: string) => JSX.Element | null) { ARTS.set(kind, fn); }

const MOD = '(?:Ctrl|Shift|Alt|Cmd|⌘|⇧|⌥)';
const KEY = `(?:${MOD}\\s?\\+?\\s?)*(?:[A-Z0-9?,.\\[\\]/=+\\-]|F\\d{1,2}|Esc|Tab|Enter|Space|Home|End|PgUp|PgDn|PageUp|PageDown|Del|Delete|Backspace|Up|Down|Left|Right|Shift|Ctrl|Alt)`;
const KEYS = new RegExp(`^${KEY}(?:\\s*(?:/|,|or|and)\\s*${KEY})*$`);

/** "Terrain: raise, level… (T)" → name "Terrain", key "T", hint "Raise, level…". */
export function parseTip(text: string): { name: string; keys: string[]; hint: string } {
  let keys: string[] = [];
  const s = text.replace(/\s*\(([^()]{1,28})\)/g, (all, inner: string) => {
    if (keys.length || !KEYS.test(inner.trim())) return all;
    keys = inner.trim().split(/\s*(?:\/|,|\bor\b|\band\b)\s*/).filter(Boolean);
    return '';
  }).replace(/\s+/g, ' ').trim();
  const m = /^(.{1,48}?)(?::\s| — | – )(.+)$/.exec(s);
  const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
  return m ? { name: m[1].trim(), keys, hint: cap(m[2].trim()) } : { name: s, keys, hint: '' };
}

let cur: HTMLElement | null = null, timer = 0, lastHide = 0, suppressed = false, watch = 0;

/** Take the element's title so the browser doesn't show its own (and keep it for screen readers). */
function steal(el: HTMLElement) {
  const t = el.getAttribute('title');
  if (t === null) return;
  el.dataset.tipT = t;
  el.removeAttribute('title');
  if (!el.hasAttribute('aria-label') && !el.textContent?.trim()) { el.setAttribute('aria-label', t); el.dataset.tipAria = '1'; }
}
function restore(el: HTMLElement) {
  if (el.dataset.tipT !== undefined && !el.hasAttribute('title')) el.setAttribute('title', el.dataset.tipT);
  if (el.dataset.tipAria) { el.removeAttribute('aria-label'); delete el.dataset.tipAria; }
  delete el.dataset.tipT;
}

function textOf(el: HTMLElement) { return el.dataset.tip ?? el.dataset.tipT ?? el.getAttribute('title') ?? ''; }

function show() {
  if (!cur || !cur.isConnected) { hide(); return; }
  const text = textOf(cur);
  if (!text.trim()) { hide(); return; }
  const p = parseTip(text);
  const a = cur.dataset.tipArt, [kind, arg = ''] = a ? a.split(/:(.*)/s) : [];
  const art = kind && ARTS.has(kind) ? ARTS.get(kind)!(arg) : null;
  tip.value = { ...p, art, r: cur.getBoundingClientRect() };
  clearInterval(watch);
  // the element can go (a panel closing under the mouse) without any pointer event
  watch = window.setInterval(() => { if (!cur?.isConnected) hide(); }, 250);
}

function hide() {
  clearTimeout(timer); clearInterval(watch);
  if (tip.value) lastHide = performance.now();
  tip.value = null;
  if (cur) restore(cur);
  cur = null;
}

function over(e: PointerEvent) {
  if (e.pointerType && e.pointerType !== 'mouse') return;
  const el = (e.target as Element | null)?.closest?.('[title],[data-tip],[data-tip-t]') as HTMLElement | null;
  if (el === cur) return;
  const open = !!tip.value || performance.now() - lastHide < 300;
  hide();
  suppressed = false;
  if (!el || el.closest('.hovercard')) return;
  cur = el;
  steal(el);
  if (open) show(); else timer = window.setTimeout(show, 300);
}

function install() {
  if (typeof document === 'undefined' || document.getElementById('hovercard-root')) return;
  document.addEventListener('pointerover', over, true);
  document.addEventListener('pointerout', (e) => { if (!e.relatedTarget) hide(); }, true);
  // a title changed by a re-render while hovered: take it again (and show the new text)
  document.addEventListener('pointermove', () => { if (cur?.hasAttribute('title')) { steal(cur); if (tip.value) show(); } }, true);
  const quiet = () => { if (cur) { suppressed = true; clearTimeout(timer); clearInterval(watch); if (tip.value) lastHide = 0; tip.value = null; } };
  document.addEventListener('pointerdown', quiet, true);
  document.addEventListener('keydown', quiet, true);
  document.addEventListener('wheel', quiet, { capture: true, passive: true });
  window.addEventListener('blur', hide);
  const root = document.createElement('div');
  root.id = 'hovercard-root';
  document.body.appendChild(root);
  render(<HoverCard />, root);
}

function HoverCard() {
  const t = tip.value;
  if (!t || suppressed) return null;
  const W = innerWidth, r = t.r, up = r.top > 150;
  const x = Math.max(150, Math.min(W - 150, r.left + r.width / 2));
  const style = up ? { left: `${x}px`, top: `${r.top - 8}px`, transform: 'translate(-50%, -100%)' } : { left: `${x}px`, top: `${r.bottom + 8}px`, transform: 'translate(-50%, 0)' };
  return (
    <div class="hovercard" role="tooltip" style={style}>
      {t.art && <div class="hc-art">{t.art}</div>}
      <div class="hc-head"><b>{t.name}</b>{t.keys.map((k) => <kbd key={k}>{k}</kbd>)}</div>
      {t.hint && <p class="hc-hint">{t.hint}</p>}
    </div>
  );
}

install();
