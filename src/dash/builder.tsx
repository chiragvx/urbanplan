// The design system builder: the dashboard's place to make a design system, the one Pro's Design step opens for
// everything past the basics. A saved design system (../pro/designLibrary.ts) with every section of it
// (../pro/designStep.tsx DesignSystemBuilder). Beside them, the changes as you make them: the sample scheme in 3D
// (Pro's own view, shaded, by day or night) and the facade in 2D, the review's score, and the versions: what changed
// since the last one, a note to save the next with, and the history to read as a changelog or restore from. The design
// saves as it changes; a version is saved when asked (../pro/designVersions.ts).
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import '../pro/designStep.css';
import { clone, presetOf, type DesignSystem } from '../pro/design';
import * as Lib from '../pro/designLibrary';
import { DesignSystemBuilder, Elevation } from '../pro/designStep';
import { addVersion, changelogMd, diffDesign, versions, type Change, type DesignVersion } from '../pro/designVersions';
import { evaluate, type Evaluated } from '../pro/evaluate';
import { DEFAULT_PROJECT, outline, roadLines, type ProProject } from '../pro/project';
import { review } from '../pro/review';
import { ProView } from '../pro/scene';
import { Seg } from '../pro/ui';

const BASE = import.meta.env.BASE_URL;
const when = (t: number) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** The sample scheme in Pro's 3D view, shaded, in the design system being built; by day or after dark. */
function Model3D({ e, p, night }: { e: Evaluated; p: ProProject; night: boolean }) {
  const cv = useRef<HTMLCanvasElement>(null), view = useRef<ProView | null>(null);
  useEffect(() => {
    const v = new ProView(cv.current!);
    v.mode = 'shaded'; view.current = v;
    const ro = new ResizeObserver(() => v.resize());
    ro.observe(cv.current!.parentElement!);
    const theme = () => v.setTheme(document.documentElement.dataset.theme === 'dark');
    theme();
    const mo = new MutationObserver(theme);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { ro.disconnect(); mo.disconnect(); v.dispose(); view.current = null; };
  }, []);
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const o = outline(p);
    v.set({
      r: e.r, d: e.d, plans: e.plans, ds: e.ds, xray: null, shops: e.shops,
      roads: roadLines(o.ring, o.roads).map((l) => ({ pts: l.pts, today: l.road.today })),
      features: p.features, levels: p.levels, north: p.north, sel: null, forms: e.forms,
    });
    // (after dark: the sun below the horizon, so the lights and the windows come on)
    v.setSun(night ? [0.3, -0.4, 0.45] : null);
  }, [e, night]);
  return <div class="dsb-3d"><canvas ref={cv} aria-label="The sample scheme in 3D, in this design system: drag to turn, scroll to zoom" /></div>;
}

/** The changes from the last version, a note, and the history (a changelog; any version restored). */
function Versions({ id, name, ds, restore }: { id: string; name: string; ds: DesignSystem; restore: (d: DesignSystem, v: number) => void }) {
  const [list, setList] = useState<DesignVersion[] | null>(null);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const load = () => void versions(id).then(async (l) => {
    // (a design system's first open records where it starts: version 1)
    if (!l.length) { await addVersion(id, ds, 'Started'); l = await versions(id); }
    setList(l);
  });
  useEffect(load, [id]);
  const last = list?.[0];
  const pending: Change[] = useMemo(() => (last ? diffDesign(last.ds, ds) : []), [last, ds]);
  const save = async () => { await addVersion(id, ds, note || `${pending.length} change${pending.length === 1 ? '' : 's'}`); setNote(''); load(); };
  const download = () => {
    if (!list) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([changelogMd(name, list)], { type: 'text/markdown' }));
    a.download = `${name || 'design-system'} changelog.md`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  if (!list) return null;
  return (
    <section class="dsv" aria-label="Versions">
      <div class="dsv-h"><b>Versions</b><span class="muted">v{last?.v ?? 1} saved {last ? when(last.at) : ''}</span><button type="button" class="linkbtn" onClick={download}>Changelog</button></div>
      {pending.length ? (
        <div class="dsv-pending">
          <small>{pending.length} change{pending.length === 1 ? '' : 's'} since v{last?.v}</small>
          <ul>{pending.slice(0, 6).map((c) => <li><i>{c.section}</i> {c.label}: {c.from} → <b>{c.to}</b></li>)}{pending.length > 6 && <li class="muted">and {pending.length - 6} more</li>}</ul>
          <form class="dsv-save" onSubmit={(ev) => { ev.preventDefault(); void save(); }}>
            <input class="txt" placeholder="What changed, and why" value={note} maxLength={140} aria-label="Version note" onInput={(ev) => setNote((ev.target as HTMLInputElement).value)} />
            <button type="submit" class="btn primary">Save v{(last?.v ?? 0) + 1}</button>
          </form>
        </div>
      ) : <p class="muted dsv-none">No changes since v{last?.v}.</p>}
      <ol class="dsv-list">
        {list.map((x) => (
          <li>
            <button type="button" class="dsv-row" aria-expanded={open === x.v} onClick={() => setOpen(open === x.v ? null : x.v)}>
              <b>v{x.v}</b><span>{x.note || (x.v === 1 ? 'Started' : 'Saved')}</span><small>{when(x.at)}</small>
            </button>
            {open === x.v && (
              <div class="dsv-detail">
                {x.changes.length ? <ul>{x.changes.map((c) => <li><i>{c.section}</i> {c.label}: {c.from} → <b>{c.to}</b></li>)}</ul> : <p class="muted">{x.v === 1 ? 'Where it started.' : 'No changes.'}</p>}
                {x !== last || pending.length ? <button type="button" class="linkbtn" onClick={() => restore(x.ds, x.v)}>Restore v{x.v}</button> : null}
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Builder({ id, back }: { id: string; back: () => void }) {
  const [saved, setSaved] = useState<Lib.SavedDesign | null | undefined>(undefined);
  const [ds, setDsState] = useState<DesignSystem | null>(null);
  const [name, setName] = useState('');
  const [state, setState] = useState<'saved' | 'saving'>('saved');
  const [pane, setPane] = useState<'3d' | '2d'>('3d');
  const [night, setNight] = useState(false);
  const timer = useRef<number>();
  useEffect(() => {
    let live = true;
    void Lib.get(id).then((s) => { if (!live) return; setSaved(s); if (s) { setDsState(s.ds); setName(s.name); } });
    return () => { live = false; };
  }, [id]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const persist = (d: DesignSystem, n = name) => {
    clearTimeout(timer.current); setState('saving');
    timer.current = window.setTimeout(() => { void Lib.save(n.trim() || 'Untitled', d, id).then(() => setState('saved')); }, 500);
  };
  const setDs = (fn: (d: DesignSystem) => void) => { if (!ds) return; const d = clone(ds); fn(d); setDsState(d); persist(d); };
  const restore = (d: DesignSystem, v: number) => { const x = clone(d); x.origin = id; setDsState(x); persist(x); void v; };

  // (checked on the sample scheme, as Pro would check a project built in it)
  const sample = useMemo<ProProject | null>(() => (ds ? { ...DEFAULT_PROJECT, style: presetOf(ds.id).id, custom: ds } : null), [ds]);
  const e = useMemo(() => (sample ? evaluate(sample) : null), [sample]);
  const rv = useMemo(() => (e ? review(e) : null), [e]);

  if (saved === undefined) return <div class="d-page"><p class="muted">Loading…</p></div>;
  if (!saved || !ds || !e || !sample) return (
    <div class="d-page">
      <header class="d-head"><button type="button" class="linkbtn" onClick={back}>← Design systems</button></header>
      <p class="muted">That design system isn’t here. It may have been deleted, or saved on another browser.</p>
    </div>
  );
  return (
    <div class="d-page dsb">
      <header class="d-head dsb-head">
        <button type="button" class="linkbtn" onClick={back}>← Design systems</button>
        <input class="dsb-name" value={name} aria-label="Name" maxLength={60} onInput={(ev) => { const n = (ev.target as HTMLInputElement).value; setName(n); persist(ds, n); }} />
        <span class="dsb-state" aria-live="polite">{state === 'saving' ? 'Saving…' : 'Saved'}</span>
        <a class="btn" href={`${BASE}pro/?new=sample&ds=${encodeURIComponent(id)}`} target="_blank" rel="noopener">Open in Pro</a>
      </header>
      <div class="dsb-grid">
        <aside class="dsb-side">
          <div class="dsb-tools">
            <Seg<'3d' | '2d'> small ariaLabel="Preview" value={pane} set={setPane} options={[{ value: '3d', label: '3D' }, { value: '2d', label: '2D' }]} />
            {pane === '3d' && <Seg<'day' | 'night'> small ariaLabel="Time" value={night ? 'night' : 'day'} set={(v) => setNight(v === 'night')} options={[{ value: 'day', label: 'Day' }, { value: 'night', label: 'Night' }]} />}
          </div>
          {pane === '3d' ? <Model3D e={e} p={sample} night={night} /> : <figure class="dss-prev dsb-2d"><Elevation ds={ds} /><figcaption>A typical bay of the facade, in its materials</figcaption></figure>}
          <p class="dsb-score"><b>{rv?.pass} of {rv?.total}</b> review checks pass on the sample scheme · built on {presetOf(ds.basedOn ?? ds.id).name}</p>
          <Versions id={id} name={name} ds={ds} restore={restore} />
        </aside>
        <div class="dsb-main">
          <DesignSystemBuilder e={e} setDs={setDs} />
        </div>
      </div>
    </div>
  );
}
