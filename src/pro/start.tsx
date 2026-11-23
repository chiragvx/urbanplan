// Starting a project without a dialog (docs/plans/pro-global-ux.md §2.10): a new project opens on the view with an
// empty state offering the four ways in (find it on the map, draw it, type its size, import it), and nothing pops up.
// The help corner (? at the end of the view tools) keeps a short checklist that ticks itself as you go, the keyboard
// shortcuts and the guides.
import { useEffect, useRef, useState } from 'preact/hooks';
import { CITIES, PROJECT_USES, PURPOSES, purposeOf, type ProjectUse, type ProProject, type Purpose } from './project';
import { optionsOf } from './variants';
import { Btn, Icon, Num, Select } from './ui';

const BASE = import.meta.env.BASE_URL;

export interface StartWays {
  /** find it by its survey number, or a place */
  find: () => void;
  /** click its corners on the view */
  draw: () => void;
  /** a file or coordinates */
  importIt: () => void;
  /** a rectangle on its road */
  size: (x: Pick<ProProject, 'city' | 'width' | 'depth' | 'road' | 'dpRoad' | 'name'>) => void;
  /** keep the plot as it is and look round */
  skip: () => void;
  /** say what the project is and who it's for (homes over shops brings a floor of shops at the front) */
  frame: (x: { use?: ProjectUse; purpose?: Purpose }) => void;
}

/** What the project is and who it's for: two rows of choices (the empty state's, and the project panel's). */
export function Framing({ p, set }: { p: Pick<ProProject, 'use' | 'purpose'>; set: (x: { use?: ProjectUse; purpose?: Purpose }) => void }) {
  const use = p.use ?? 'residential', who = purposeOf(p);
  return (
    <div class="framing">
      <div class="fr-row" role="radiogroup" aria-label="What it is">
        {PROJECT_USES.map((u) => <button type="button" role="radio" aria-checked={use === u.value} class={use === u.value ? 'on' : ''} onClick={() => set({ use: u.value })}><Icon n={u.icon} size={15} />{u.label}</button>)}
      </div>
      <div class="fr-row fr-who" role="radiogroup" aria-label="Who it's for">
        {PURPOSES.map((w) => <button type="button" role="radio" aria-checked={who === w.value} class={who === w.value ? 'on' : ''} onClick={() => set({ purpose: w.value })} data-tip={w.sub}>{w.label}</button>)}
      </div>
    </div>
  );
}

export function EmptyState({ p, ways }: { p: ProProject; ways: StartWays }) {
  const [typing, setTyping] = useState(false);
  const [x, setX] = useState({ city: p.city, width: 40, depth: 50, road: 12 });
  return (
    <section class="empty-v" aria-label="Start with the plot">
      <h2>What are you designing?</h2>
      <Framing p={p} set={ways.frame} />
      <h2 class="h-plot">Then the plot</h2>
      <p class="muted">What the rules allow on it, in 3D, with the numbers. Four ways in:</p>
      {!typing ? (
        <div class="ways">
          <button type="button" onClick={ways.find}><Icon n="pin" size={20} /><b>Find it on the map</b><small>By its survey number, or a place</small></button>
          <button type="button" onClick={ways.draw}><Icon n="plan" size={20} /><b>Draw it</b><small>Click its corners on the view</small></button>
          <button type="button" onClick={() => setTyping(true)}><Icon n="ruler" size={20} /><b>Type its size</b><small>A rectangle on its road</small></button>
          <button type="button" onClick={ways.importIt}><Icon n="upload" size={20} /><b>Import it</b><small>KML, GeoJSON, DXF or corners</small></button>
        </div>
      ) : (
        <form class="ways-size" onSubmit={(ev) => { ev.preventDefault(); ways.size({ city: x.city, width: x.width, depth: x.depth, road: x.road, dpRoad: x.road, name: `${x.width} × ${x.depth} m plot` }); }}>
          <div class="row r2">
            <Select<ProProject['city']> label="Planning authority" value={x.city} onChange={(city) => setX({ ...x, city })} options={CITIES.map((c) => ({ value: c.value, label: c.label }))} />
            <Num label="Road in front" value={x.road} set={(road) => setX({ ...x, road })} min={3} max={80} unit="m" />
          </div>
          <div class="row r2"><Num label="Frontage" value={x.width} set={(width) => setX({ ...x, width })} min={10} max={400} unit="m" /><Num label="Depth" value={x.depth} set={(depth) => setX({ ...x, depth })} min={10} max={400} unit="m" /></div>
          <div class="ways-a"><Btn kind="quiet" onClick={() => setTyping(false)}>Back</Btn><Btn kind="primary" submit>Work it out</Btn></div>
        </form>
      )}
      <button type="button" class="linkbtn" onClick={ways.skip}>Or look round this sample plot</button>
    </section>
  );
}

// ---------------- the help corner ----------------

const TASKS = 'urbanplan:pro:tasks';
type Flag = 'numbers' | 'share' | 'moved' | 'picked' | 'pickhint';
const flags = (): Partial<Record<Flag, boolean>> => { try { return JSON.parse(localStorage.getItem(TASKS) ?? '{}'); } catch { return {}; } };
/** tick a task that can't be read off the project (Numbers looked at, a building changed in the view, something
 *  shared), or a hint seen (the first pick's) */
export const ticked = (f: Flag) => !!flags()[f];
export const tick = (f: Flag) => { const x = flags(); if (x[f]) return; try { localStorage.setItem(TASKS, JSON.stringify({ ...x, [f]: true })); } catch { /* */ } };

export type Task = 'purpose' | 'plot' | 'building' | 'moved' | 'numbers' | 'option' | 'share';
export function taskList(p: ProProject): { k: Task; label: string; done: boolean }[] {
  const f = flags();
  const plotSet = !p.blank && (!!p.at || p.shape === 'poly' || p.width !== 40 || p.depth !== 50 || p.road !== 12);
  return [
    { k: 'purpose', label: 'Say what it’s for', done: !!(p.use || p.purpose) },
    { k: 'plot', label: 'Set the plot', done: plotSet },
    { k: 'building', label: 'Put a building on it', done: (p.scheme?.buildings.length ?? 0) > 0 },
    { k: 'moved', label: 'Change its height or move it in 3D', done: !!f.moved },
    { k: 'numbers', label: 'Look at the numbers', done: !!f.numbers },
    { k: 'option', label: 'Make a second option', done: optionsOf(p).length > 1 },
    { k: 'share', label: 'Share it', done: !!f.share },
  ];
}

/** `act`: do a task (arm the tool, open the report…) */
export function HelpCorner({ p, keys, search, act }: { p: ProProject; keys: () => void; search: () => void; act: (t: Task) => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (ev: PointerEvent) => { if (!root.current?.contains(ev.target as Node)) setOpen(false); };
    const key = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { ev.stopImmediatePropagation(); setOpen(false); } };
    addEventListener('pointerdown', down, true); addEventListener('keydown', key, true);
    return () => { removeEventListener('pointerdown', down, true); removeEventListener('keydown', key, true); };
  }, [open]);
  const ts = taskList(p), left = ts.filter((t) => !t.done).length;
  return (
    <div class="tgroup help-c" ref={root}>
      <button type="button" aria-label="Help: getting started, shortcuts, guides" aria-expanded={open} data-tip={open ? undefined : left ? `Getting started: ${left} to go` : 'Help'} onClick={() => setOpen(!open)}>
        <Icon n="info" size={16} />{left > 0 && <i class="help-n">{left}</i>}
      </button>
      {open && (
        <div class="help-pop" role="dialog" aria-label="Help">
          <b>Getting started</b>
          <ul class="tasks">{ts.map((t) => <li class={t.done ? 'done' : ''}><button type="button" class="task-b" onClick={() => { setOpen(false); act(t.k); }}><Icon n={t.done ? 'check' : 'circle'} size={14} />{t.label}</button></li>)}</ul>
          {!left && <p class="muted small">All done. The rest is in the guides.</p>}
          <hr />
          <button type="button" class="help-l" onClick={() => { setOpen(false); search(); }}><Icon n="cursor" size={15} />Search everything<kbd>Ctrl K</kbd></button>
          <button type="button" class="help-l" onClick={() => { setOpen(false); keys(); }}><Icon n="key" size={15} />Keyboard shortcuts<kbd>?</kbd></button>
          <a class="help-l" href={`${BASE}guides/`} target="_blank" rel="noopener"><Icon n="book" size={15} />Guides</a>
        </div>
      )}
    </div>
  );
}
