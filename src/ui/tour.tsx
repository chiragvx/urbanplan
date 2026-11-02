// First-run walkthroughs: the editor the first time someone opens a city, Site Studio the first time it opens. The
// part being shown is lit with the rest of the screen dimmed round it; the card stays in one place (the middle of the
// screen, moved up or down only when it would cover that part); Next / Back / Skip, arrow keys, Esc. Each is shown
// once (settings.toursDone) and can be taken again from Help.
import { signal } from '@preact/signals';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { saveSettings, settings, studio } from '../editor/state';
import { ui } from './ctx';

export type TourName = 'editor' | 'studio';
interface Step {
  /** what it points at (a selector or a finder); none: a card in the middle */
  target?: string | (() => Element | null | undefined);
  title: string;
  body: string;
  /** the last step's buttons: a thing to do now, besides closing */
  action?: { label: string; run: () => void };
}

const byText = (sel: string, text: string) => () => [...document.querySelectorAll(sel)].find((e) => e.textContent?.trim() === text);

const TOURS: Record<TourName, Step[]> = {
  editor: [
    { title: 'Welcome to UrbanPlan', body: 'This is the city as it stands: its roads, buildings, terrain and Development Plan, all editable. A one-minute look round?' },
    { target: '.bb-mode', title: 'Move around', body: 'Drag to pan and scroll to zoom. Tab switches between the 2D plan and the city in 3D.' },
    { target: '.corner-tl', title: 'Info views', body: 'Lay the DP sheets, DP zones, terrain, satellite imagery and more over the map. Shift-click to show several at once.' },
    { target: '.bb-cats', title: 'Build', body: 'Roads, flyovers, junctions, buildings and parks: pick one, then click on the map to draw it. Hover any button for its name and key. Terrain is here too.' },
    { target: '.bb-tools', title: 'Change what’s there', body: 'Select and bend a road, move its points, split or join it, or bulldoze it. Ctrl+Z undoes anything.' },
    { target: '.bb-plot', title: 'Plan a plot', body: 'The orange button. Draw round any site to see what the rules let you build there: FSI by road width, today and once the DP widens it. Then open it in Site Studio for a full scheme, its costs and a report.' },
    { target: '.bb-btn[aria-label="Search and commands"]', title: 'Find anything', body: 'Search roads and places, things to build and every command. Ctrl+K, from anywhere.' },
    { target: '.mapcard', title: 'Your map', body: 'Your edits are saved as you work: in this browser, and in your account once you sign in. New, open, versions, export and publish are in this menu.' },
    { title: 'You’re set', body: 'A good first step: draw a plot round a site you know and see the most it can hold.', action: { label: 'Draw a plot', run: () => ui.E.setTool('plot') } },
  ],
  studio: [
    { target: '.studio-metrics', title: 'Site Studio', body: 'The plot planned for the most built-up area the rules allow. These are its numbers, live: flats, FSI against what’s allowed, height, parking, profit and IRR.' },
    { target: '.studio-checks', title: 'The rules, checked', body: 'Margins, spacing, FSI, height, parking, fire access and open space. One turns red the moment a change breaks it; hover it to see why.' },
    { target: byText('.studio-tabs button', 'Design'), title: 'Shape the scheme', body: 'Design sets the use (homes, offices or sheds), towers or slabs, internal roads, spacing and green, and plans again. Roads, Flats, Parking and Costs fine-tune it.' },
    { target: '.studio-tools', title: 'Place things yourself', body: 'Add buildings, car parks, parking lots, gardens, roads and roundabouts, then drag, turn and size them. The plan makes room round them.' },
    { target: '.studio-3d-bar', title: 'See it built', body: 'Realistic or floor-by-floor 3D, on plain ground, satellite imagery or the DP sheet; from above, from the street or straight down.' },
    { target: byText('.studio-tabs button', 'Export'), title: 'Take it to the meeting', body: 'A feasibility report to print or save as PDF, the area statement and unit schedule for Excel, and the model as DXF, OBJ or glTF.' },
  ],
};

/** The tour on screen and its step. */
export const tour = signal<{ name: TourName; i: number } | null>(null);

const done = (name: TourName) => (settings.value.toursDone ?? []).includes(name);
function finish() {
  const t = tour.value;
  tour.value = null;
  if (t && !done(t.name)) saveSettings({ toursDone: [...(settings.value.toursDone ?? []), t.name] });
}

export function startTour(name: TourName) { tour.value = { name, i: 0 }; }
/** Start it if this browser hasn't seen it (once the screen has settled). */
export function firstTime(name: TourName, delay = 700) {
  if (done(name) || tour.value) return;
  setTimeout(() => { if (!done(name) && !tour.value) startTour(name); }, delay);
}
/** Help → the tour of what's on screen. */
export const tourHere = () => startTour(studio.value ? 'studio' : 'editor');

// the keys, ahead of every other handler (registered when this module loads, before the editor's and the studio's)
window.addEventListener('keydown', (e) => {
  const t = tour.value;
  if (!t) return;
  const n = TOURS[t.name].length;
  if (e.key === 'Escape') finish();
  else if (e.key === 'ArrowRight' || e.key === 'Enter') { if (t.i + 1 < n) tour.value = { ...t, i: t.i + 1 }; else finish(); }
  else if (e.key === 'ArrowLeft') { if (t.i > 0) tour.value = { ...t, i: t.i - 1 }; }
  else return;
  e.preventDefault(); e.stopImmediatePropagation();
}, true);

const PAD = 6, GAP = 14, W = 340;

export function Tour() {
  const t = tour.value;
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [size, setSize] = useState({ w: innerWidth, h: innerHeight });
  const card = useRef<HTMLDivElement>(null);
  const [ch, setCh] = useState(180);
  const step = t ? TOURS[t.name][t.i] : null;

  // follow the target as panels open, the window resizes or the layout moves
  useEffect(() => {
    if (!step) return;
    let raf = 0, last = '';
    const find = () => (typeof step.target === 'function' ? step.target() : step.target ? document.querySelector(step.target) : null) ?? null;
    const tick = () => {
      const el = find();
      const r = el && (el as HTMLElement).offsetParent !== null ? el.getBoundingClientRect() : null;
      const k = r ? `${r.x | 0},${r.y | 0},${r.width | 0},${r.height | 0}` : '';
      if (k !== last) { last = k; setRect(r && r.width > 0 ? r : null); }
      if (innerWidth !== size.w || innerHeight !== size.h) setSize({ w: innerWidth, h: innerHeight });
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [t?.name, t?.i]);
  useLayoutEffect(() => { if (card.current) setCh(card.current.offsetHeight); });


  if (!t || !step) return null;
  const steps = TOURS[t.name], last = t.i === steps.length - 1;
  const go = (i: number) => { tour.value = { ...t, i }; };

  // the card: in one place, a little above the middle, so the eye doesn't chase it round the corners; it only
  // steps clear (above or below) when it would cover what's being shown
  const x = Math.max(12, (size.w - W) / 2);
  let y = Math.max(12, size.h * 0.42 - ch / 2);
  if (rect && rect.left - PAD < x + W && rect.right + PAD > x && rect.top - PAD < y + ch && rect.bottom + PAD > y) {
    const up = rect.top - PAD - GAP - ch, down = rect.bottom + PAD + GAP;
    y = up >= 12 ? up : Math.min(size.h - ch - 12, down);
  }

  return (
    <div class="tour" role="dialog" aria-modal="false" aria-labelledby="tour-title">
      {rect
        ? <div class="tour-hole" style={{ left: rect.left - PAD, top: rect.top - PAD, width: rect.width + 2 * PAD, height: rect.height + 2 * PAD }} />
        : <div class="tour-scrim" />}
      <div ref={card} class="tour-card" style={{ left: x, top: y, width: W }}>
        <div class="tour-meta"><span>{t.name === 'studio' ? 'Site Studio' : 'Tour'}</span><span>{t.i + 1} / {steps.length}</span></div>
        <h3 id="tour-title">{step.title}</h3>
        <p>{step.body}</p>
        <div class="tour-dots" aria-hidden="true">{steps.map((_, k) => <i key={k} class={k === t.i ? 'on' : k < t.i ? 'past' : ''} />)}</div>
        <div class="tour-btns">
          {t.i === 0 && !last
            ? <button class="ghost" onClick={finish}>Skip</button>
            : !last ? <button class="ghost" onClick={() => go(t.i - 1)}>Back</button> : <span />}
          <span class="spacer" />
          {last && step.action && <button class="ghost" onClick={finish}>Explore on my own</button>}
          {last && step.action
            ? <button class="primary" onClick={() => { finish(); step.action!.run(); }}>{step.action.label}</button>
            : <button class="primary" autoFocus onClick={() => (last ? finish() : go(t.i + 1))}>{last ? 'Done' : t.i === 0 && t.name === 'editor' ? 'Show me round' : 'Next'}</button>}
        </div>
      </div>
    </div>
  );
}
