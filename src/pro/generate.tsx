// Generate (docs/plans/pro-ia-rethink.md §2.3): the one way to have the generator lay a scheme out, from the toolbar.
// Describe it (the written brief), or set the type, the most floors, the most buildings and how much of the FSI to
// take; then make one option, or the three best the generator finds. What it makes is always a new option beside the
// one open (switched to, the one before kept in the option menu), never a hidden change to the layout in view.
import { useMemo, useState } from 'preact/hooks';
import { TYPOLOGIES, type Typology } from '../doc/optimise';
import { Dither } from '../theme/Dither';
import { added, switchTo, type Varying } from './variants';
import { exploreOptions, type OptionRow } from './options';
import { parseBrief, runBrief, type BriefResult } from './brief';
import { layoutDefaults, plotLayout, type LayoutOpts } from './layout';
import { fillOf, outline, type ProProject } from './project';
import type { Evaluated } from './evaluate';
import { Btn, cr, nf, Num, pct, Row, Section, Seg, Slider, sqft, Stat } from './ui';

type Up = (o: Partial<ProProject>) => void;
type Toast = (s: string, o?: { undo?: boolean }) => void;

/** a generated scheme as a new option (filled afresh), opened */
function addOpt(p: ProProject, up: Up, toast: Toast, patch: Partial<ProProject>, made: 'brief' | 'explore', label: string, done?: () => void) {
  up(added(p, { ...(patch as Partial<Varying>), scheme: undefined }, made, label));
  toast(`Made “${label}” as an option, and opened it. The option menu switches back.`, { undo: true });
  done?.();
}

function OptionCard({ o, best, apply }: { o: OptionRow; best?: boolean; apply: () => void }) {
  return (
    <div class={`opt${best ? ' best' : ''}`}>
      <div><b>{o.label}</b><small>{o.buildings} bldg · {o.floors} floors · {nf(o.height, 1)} m · {o.flats} flats{o.shops ? ` · ${o.shops} shops` : ''}{o.departures ? ` · ${o.departures} departure${o.departures > 1 ? 's' : ''}` : ''}</small></div>
      <div class="opt-n"><b class={o.profit < 0 ? 'bad' : ''}>{cr(o.profit)}</b><small>IRR {pct(o.irr)}</small></div>
      <Btn kind="quiet" icon="plus" title="Make it an option" onClick={apply}>Make</Btn>
    </div>
  );
}

export function Generate({ p, e, up, toast, done }: { p: ProProject; e: Evaluated; up: Up; toast: Toast; done: () => void }) {
  // the written brief
  const [text, setText] = useState('Mostly 2BHK, under 45 m, shops on the ground floor, best profit');
  const [res, setRes] = useState<(BriefResult & { understood: string[]; ignored: string[] }) | null>(null);
  const plan = () => { const b = parseBrief(text); setRes({ ...runBrief(p, b.brief), understood: b.understood, ignored: b.ignored }); };
  // the settings: from the option open
  const f0 = fillOf(p);
  const [s, setS] = useState({ typology: p.typology, maxFloors: p.maxFloors, buildings: f0.buildings, amount: f0.amount });
  const typeName = TYPOLOGIES.find((t) => t.value === s.typology)?.label ?? 'Generated';
  const one = () => addOpt(p, up, toast, { typology: s.typology, maxFloors: s.maxFloors, fill: { ...(p.fill ?? {}), buildings: s.buildings, amount: s.amount } }, 'brief', `${typeName}${s.maxFloors ? `, ${s.maxFloors} floors at most` : ''}`, done);
  const [busy, setBusy] = useState(false), [rows, setRows] = useState<OptionRow[] | null>(null);
  /** the three best the generator finds, each a new option; the best is the one left open */
  const three = () => {
    setBusy(true);
    setTimeout(() => {
      const rs = exploreOptions(p, { limit: 12 }), top = rs.slice(0, 3);
      setRows(rs); setBusy(false);
      if (!top.length) { toast('Nothing fits this plot under these rules.'); return; }
      // (in rank order in the option menu, and the best one open)
      let q = p, first: string | undefined;
      for (const o of top) { const c = added(q, { ...(o.patch as Partial<Varying>), scheme: undefined }, 'explore', o.label); first ??= c.option; q = { ...q, ...c }; }
      if (first) q = { ...q, ...switchTo(q, first) };
      up(q);
      toast(`Made ${top.length} options and opened the best: ${top[0].label}. Compare them from the option menu.`, { undo: true });
    }, 30);
  };
  return (
    <div class="gen-pop">
      <Section title="Describe it">
        <textarea class="brief" rows={3} aria-label="The brief" value={text} onInput={(ev) => setText((ev.target as HTMLTextAreaElement).value)} onKeyDown={(ev) => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) plan(); }} />
        <Row><Btn kind="primary" icon="play" onClick={plan}>Plan it</Btn></Row>
        {res && <>
          {res.understood.length > 0 && <div class="chips">{res.understood.map((u) => <span class="chip">{u}</span>)}{res.ignored.map((u) => <span class="chip off" title="Not understood">{u}</span>)}</div>}
          {[res.best, ...res.alternatives].filter(Boolean).slice(0, 3).map((o, i) => <OptionCard o={o!} best={i === 0} apply={() => addOpt(p, up, toast, o!.patch, 'brief', `Brief: ${o!.label}`, done)} />)}
          {!res.met && <p class="note">Nothing met the whole brief: the closest is shown.</p>}
        </>}
      </Section>
      <Section title="Or set it">
        <Seg<Typology> value={s.typology} set={(v) => setS({ ...s, typology: v })} label="Building type" options={TYPOLOGIES} />
        <Row>
          <Num label="Most floors" value={s.maxFloors} set={(v) => setS({ ...s, maxFloors: v })} min={0} max={300} zero="Auto" />
          <Num label="Most buildings" value={s.buildings} set={(v) => setS({ ...s, buildings: v })} min={0} max={40} zero="Auto" />
        </Row>
        <Slider label="How much of the FSI to build" value={Math.round(s.amount * 100)} set={(v) => setS({ ...s, amount: v / 100 })} min={30} max={100} step={5} fmt={(v) => (v >= 100 ? 'All the FSI taken' : `${v}% of the FSI taken`)} />
        <Row><Btn kind="primary" icon="spark" onClick={one}>Make 1 option</Btn><Btn icon="layers" onClick={three} disabled={busy}>{busy ? <><Dither class="dz" cell={2} />Working…</> : 'Make 3 options'}</Btn></Row>
        <p class="note">Make 1 uses these settings. Make 3 tries every type, height and mix, and makes the three that earn most.</p>
        {rows && rows.length > 3 && <details class="gen-more"><summary>{rows.length - 3} more it found</summary><div class="opts">{rows.slice(3).map((o) => <OptionCard o={o} apply={() => addOpt(p, up, toast, o.patch, 'explore', o.label, done)} />)}</div></details>}
      </Section>
      <LayoutBox p={p} e={e} />
    </div>
  );
}

export function LayoutBox({ p, e }: { p: ProProject; e: Evaluated }) {
  const o0 = layoutDefaults(e.r.area);
  const [o, setO] = useState<LayoutOpts>(o0);
  const { ring, roads } = outline(p);
  const front = Math.max(0, roads.findIndex(Boolean));
  const L = useMemo(() => plotLayout(ring, front, o), [JSON.stringify(ring), front, JSON.stringify(o)]);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < ring.length; i += 2) { x0 = Math.min(x0, ring[i]); x1 = Math.max(x1, ring[i]); z0 = Math.min(z0, ring[i + 1]); z1 = Math.max(z1, ring[i + 1]); }
  const pts = (r: number[]) => { const a = []; for (let i = 0; i < r.length; i += 2) a.push(`${r[i]},${r[i + 1]}`); return a.join(' '); };
  const pad = 3, sw = Math.max(x1 - x0, z1 - z0) / 300;
  return (
    <Section title="Plotted layout" fold open={false} sub="The land divided into plots for sale instead: internal roads, open space and amenity space as layouts need.">
      <Row n={3}>
        <Num label="Plot width" value={o.plotW} set={(v) => setO({ ...o, plotW: v })} min={6} max={60} unit="m" />
        <Num label="Plot depth" value={o.plotD} set={(v) => setO({ ...o, plotD: v })} min={8} max={80} unit="m" />
        <Num label="Roads" value={o.roadW} set={(v) => setO({ ...o, roadW: v })} min={6} max={24} unit="m" />
      </Row>
      <Row><Num label="Open space" value={o.openPct} set={(v) => setO({ ...o, openPct: v })} max={40} unit="%" /><Num label="Amenity space" value={o.amenityPct} set={(v) => setO({ ...o, amenityPct: v })} max={20} unit="%" /></Row>
      <svg class="layout" viewBox={`${x0 - pad} ${z0 - pad} ${x1 - x0 + 2 * pad} ${z1 - z0 + 2 * pad}`} role="img" aria-label="Plotted layout">
        <polygon points={pts(ring)} class="l-site" stroke-width={sw * 2} />
        {L.roads.map((r) => <polygon points={pts(r)} class="l-road" />)}
        {L.open.map((r) => <polygon points={pts(r)} class="l-open" />)}
        {L.amenity.map((r) => <polygon points={pts(r)} class="l-amen" />)}
        {L.plots.map((r) => <polygon points={pts(r)} class="l-plot" stroke-width={sw} />)}
      </svg>
      <div class="stats">
        <Stat label="Plots" value={nf(L.stats.plots)} sub={`${nf(L.stats.avgPlot)} m² on average`} />
        <Stat label="Saleable" value={`${nf((L.stats.saleable / Math.max(1, L.stats.area)) * 100)}%`} sub={sqft(L.stats.saleable)} />
        <Stat label="Roads" value={`${nf((L.stats.roads / Math.max(1, L.stats.area)) * 100)}%`} />
        <Stat label="Open + amenity" value={`${nf(((L.stats.open + L.stats.amenity) / Math.max(1, L.stats.area)) * 100)}%`} />
      </div>
    </Section>
  );
}
