// The design system builder: the dashboard's place to make a design system, the one Pro's Design step opens for
// everything past the basics. A saved design system (../pro/designLibrary.ts), every section of it
// (../pro/designStep.tsx DesignSystemBuilder), the facade preview beside, and the whole of it checked on the sample
// scheme, the same way Pro checks a project: the palette measured, the review scored. Changes save as you go.
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import '../pro/designStep.css';
import { clone, presetOf, type DesignSystem } from '../pro/design';
import * as Lib from '../pro/designLibrary';
import { DesignSystemBuilder, Elevation } from '../pro/designStep';
import { evaluate } from '../pro/evaluate';
import { DEFAULT_PROJECT } from '../pro/project';
import { review } from '../pro/review';

const BASE = import.meta.env.BASE_URL;

export function Builder({ id, back }: { id: string; back: () => void }) {
  const [saved, setSaved] = useState<Lib.SavedDesign | null | undefined>(undefined);
  const [ds, setDsState] = useState<DesignSystem | null>(null);
  const [name, setName] = useState('');
  const [state, setState] = useState<'saved' | 'saving'>('saved');
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

  // (checked on the sample scheme, as Pro would check a project built in it)
  const e = useMemo(() => (ds ? evaluate({ ...DEFAULT_PROJECT, style: presetOf(ds.id).id, custom: ds }) : null), [ds]);
  const rv = useMemo(() => (e ? review(e) : null), [e]);

  if (saved === undefined) return <div class="d-page"><p class="muted">Loading…</p></div>;
  if (!saved || !ds || !e) return (
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
        <a class="btn" href={`${BASE}pro/?new=sample&ds=${encodeURIComponent(id)}`} target="_blank" rel="noopener">Preview in 3D</a>
      </header>
      <div class="dsb-grid">
        <aside class="dsb-side">
          <figure class="dss-prev"><Elevation ds={ds} /><figcaption>Built on {presetOf(ds.basedOn ?? ds.id).name}</figcaption></figure>
          {rv && <p class="dsb-score"><b>{rv.pass} of {rv.total}</b> review checks pass on the sample scheme</p>}
          <p class="muted dsb-note">Every project that uses this design system can take these changes from its Design step.</p>
        </aside>
        <div class="dsb-main">
          <DesignSystemBuilder e={e} setDs={setDs} />
        </div>
      </div>
    </div>
  );
}
