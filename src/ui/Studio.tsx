// Site Studio: a plot opened on its own. It opens on the plot and its margin envelope, nothing generated: a shelf of
// things to place (buildings of a shape, parking, gardens, roads, a gate, a wall, a tank, trees), each an icon with
// its name in the hover card, and "Fill for me" (the spark) to lay the most built-up area round what's placed. The
// plan on the left (place and shape), the live 3D on the right, the numbers across the top: each appears once the
// project has what it needs (a building, a use, rates), a greyed placeholder until then. Rules flag, never block:
// a departure is an amber dot on its number and an amber check, listed with a note against it on the Rules tab.
// Nothing here touches the city map: it all lives on the plot.
import { Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { firstTime } from './tour';
import { docVersion, readOnly, studio, studioGround, studioLevel, studioLook, studioSel, studioTool, toast } from '../editor/state';
import { isTyping } from '../editor/editor';
import { StudioCanvas } from '../editor/studiocanvas';
import { exportPlot } from '../editor/plotexport';
import { ui } from './ctx';
import { Icon, NumberField, Seg, Toggle } from './components';
import { registerTipArt } from './hovercard';
import { SI, shelfIcon, useIcon } from './studioicons';
import './studio.css';
import type { PlotObj } from '../doc/types';
import { polyArea, useInfo, USES, type PlotReport, type PlotUse } from '../doc/plot';
import { basementsToFit, buildingQuads, BUILDING_SHAPES, CARPET, ELEMENTS, elementRings, GATES_FROM, isArea, ringOf, roadFrame, FIRE_H, FIRE_W, RG_FROM, RG_SHARE, SQFT, TRAVEL, UNIT_COLOR, UNIT_LABEL, type Costs, type Departure, type PlotSite, type ShelfTool, type SiteElement, type SiteReport } from '../doc/site';
import { ACCESS, DEFAULT_DESIGN, fillSite, schemes, siteDefaults, type Access, TYPOLOGIES, type Design, type Typology } from '../doc/optimise';
import { totalWidth } from '../doc/xsection';
import { areaStatement, printReport, unitSchedule } from '../editor/plotreport';

const m2 = (v: number) => `${Math.round(v).toLocaleString('en-IN')} m²`;
const fx = (v: number) => (Math.round(v * 100) / 100).toString();
const cr = (v: number) => `₹${(v / 1e7).toLocaleString('en-IN', { maximumFractionDigits: Math.abs(v) >= 1e9 ? 0 : 1 })} Cr`;
const pc = (v: number) => `${Math.round(v * 100)} %`;

// the shelf's and the uses' pictures, large, in their hover cards
registerTipArt('shelf', (k) => { const C = shelfIcon(k as ShelfTool); return <span class="tip-art-icon"><C size={40} /></span>; });
registerTipArt('use', (k) => { const C = useIcon(k as PlotUse); return <span class="tip-art-icon"><C size={40} /></span>; });

const RATES: { k: keyof Costs; label: string; unit: string; step: number; title: string }[] = [
  { k: 'land', label: 'Land', unit: '₹/ft²', step: 500, title: 'Land price per sq ft of plot' },
  { k: 'sale', label: 'Sale', unit: '₹/ft²', step: 500, title: 'Sale price per sq ft of RERA carpet' },
  { k: 'build', label: 'Construction', unit: '₹/ft²', step: 100, title: 'Construction per sq ft of built-up area' },
  { k: 'parking', label: 'Parking levels', unit: '₹/ft²', step: 100, title: 'Stilt, podium and basement construction per sq ft' },
  { k: 'asr', label: 'ASR rate', unit: '₹/ft²', step: 500, title: 'Ready reckoner land rate: premium, TDR and ancillary charges are shares of it' },
  { k: 'premiumPct', label: 'Premium FSI', unit: '%', step: 5, title: 'Premium FSI charge as % of the ASR rate' },
  { k: 'tdrPct', label: 'TDR', unit: '%', step: 5, title: 'TDR market price as % of the ASR rate' },
  { k: 'ancillaryPct', label: 'Ancillary FSI', unit: '%', step: 5, title: 'Ancillary FSI premium as % of the ASR rate' },
  { k: 'soft', label: 'Soft costs', unit: '%', step: 1, title: 'Approvals, consultants, marketing and finance, as % of construction' },
  { k: 'months', label: 'Build time', unit: 'months', step: 3, title: 'From the start on site to possession' },
  { k: 'presold', label: 'Booked by possession', unit: '%', step: 5, title: 'Flats sold while it goes up; the rest sell over the year after' },
];

type Tab = 'roads' | 'design' | 'flats' | 'parking' | 'site' | 'rules' | 'money' | 'options' | 'export';
const TABS: Record<Tab, string> = { roads: 'Roads', design: 'Design', flats: 'Units', parking: 'Parking', site: 'Site', rules: 'Rules', money: 'Costs and returns', options: 'Options', export: 'Export' };

/** the shelf, in order: buildings, then the site's things (keys for the first few) */
const SHELF: { value: ShelfTool | 'draw'; label: string; title: string; key?: string }[] = [
  ...BUILDING_SHAPES.map((x) => ({ value: x.value, label: x.label, title: x.title })),
  { value: 'draw', label: 'Building by its spine', title: 'Click its spine node by node, Enter to finish', key: 'B' },
  ...ELEMENTS.map((x) => ({ value: x.value, label: x.label, title: x.title })),
];
const HINTS: Partial<Record<ShelfTool | 'draw', string>> = {
  slab: 'Click where it goes · then drag its corners, its floors on the pill', tower: 'Click where it goes · then drag its corners, its floors on the pill', lblock: 'Click where it goes · then drag its nodes',
  draw: 'Click the building’s line, node by node · Enter or double-click finishes · Backspace drops the last · Shift: no snapping',
  road: 'Click the road’s line, node by node · Enter or double-click finishes · Shift: no snapping', wall: 'Click the wall’s line, node by node · Enter or double-click finishes',
  roundabout: 'Click where it goes · then drag it, and size it in the card', tank: 'Click where it goes', gate: 'Click the plot’s edge where the gate goes',
  parking: 'Drag out a rectangle · or click its corners · double-click an open patch to fill it', lot: 'Drag out a rectangle · or click its corners · double-click an open patch to fill it',
  garden: 'Drag out a rectangle · or click its corners · double-click an open patch to fill it', play: 'Drag out a rectangle · or click its corners', trees: 'Drag out a rectangle · or click its corners',
};

export function Studio() {
  const id = studio.value;
  void docVersion.value; // signals make components pure: re-render on every document change
  if (!id) return null;
  const o = ui.doc.get<'plot'>(id), r = ui.E.plot.report(id), d = ui.E.plot.layout(id), site = ui.E.plot.site(id);
  if (!o || !r || !d || !site) { ui.E.closeStudio(); return null; }
  return <StudioView o={o} r={r} d={d} site={site} />;
}

/** A number across the top: shown once the project has what it needs, a greyed placeholder till then; an amber dot
 *  (its hover card says what and why) where it departs from a rule. */
function Metric({ label, value, sub, need, flag, bad, title }: { label: string; value: string; sub?: preact.ComponentChildren; need?: string | false; flag?: string; bad?: boolean; title?: string }) {
  return (
    <div class={`${need ? 'need' : ''}${flag ? ' flag' : ''}${bad ? ' bad' : ''}`} title={need ? `${label}: ${need}` : flag ?? title}>
      <dt>{label}{flag && !need && <i class="flag-dot" aria-label="departs from the rules" />}</dt>
      <dd>{need ? '–' : value}</dd><small>{need || sub}</small>
    </div>
  );
}

/** Use as an icon; a grid of them to pick from (and, for a building, "as the plot"). */
function UsePicker({ value, inherit, onChange, ro, small }: { value: PlotUse | undefined; inherit?: PlotUse; onChange: (u: PlotUse | undefined) => void; ro: boolean; small?: boolean }) {
  const [open, setOpen] = useState(false);
  const cur = value ?? inherit ?? 'none', C = useIcon(cur), info = useInfo(cur);
  return (
    <div class="use-pick" onMouseLeave={() => setOpen(false)}>
      <button class={`icon use-btn${small ? ' small' : ''}${value === undefined && inherit ? ' inherit' : ''}`} disabled={ro} aria-label={`Use: ${info.label}`} aria-expanded={open}
        title={`Use: ${info.label}${value === undefined && inherit ? ' (as the plot)' : ''} — ${info.note}`} data-tip-art={`use:${cur}`} onClick={() => setOpen(!open)}>
        <C size={small ? 15 : 17} />{!small && <span>{info.label}</span>}
      </button>
      {open && (
        <div class="use-grid" role="menu">
          {inherit && <button class={value === undefined ? 'on' : ''} role="menuitem" aria-label={`As the plot: ${useInfo(inherit).label}`} title={`As the plot: ${useInfo(inherit).label}`} onClick={() => { onChange(undefined); setOpen(false); }}><Icon.plot size={16} /></button>}
          {USES.map((u) => { const U = useIcon(u.value); return <button key={u.value} role="menuitem" class={value === u.value ? 'on' : ''} aria-label={u.label} title={`${u.label}: ${u.note}`} data-tip-art={`use:${u.value}`} onClick={() => { onChange(u.value); setOpen(false); }}><U size={17} /></button>; })}
        </div>
      )}
    </div>
  );
}

function StudioView({ o, r, d, site }: { o: PlotObj; r: PlotReport; d: SiteReport; site: PlotSite }) {
  useEffect(() => firstTime('studio', 900), []);
  const ref = useRef<HTMLCanvasElement>(null);
  const cv = useRef<StudioCanvas | null>(null);
  const [tab, setTab] = useState<Tab>('design');
  const ro = readOnly.value;
  useEffect(() => {
    const c = new StudioCanvas(ref.current!, ui.E, o.id);
    cv.current = c;
    // the studio takes the keys first (all but undo / redo and the like)
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (c.key(e)) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); ui.E.closeStudio(); return; }
      if (!e.ctrlKey && !e.metaKey) e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => { c.dispose(); window.removeEventListener('keydown', onKey, true); };
  }, [o.id]);

  // the ground under the 3D: imagery or the DP sheets over the studio's square, taken away on the way out
  const ground = studioGround.value;
  useEffect(() => {
    ui.app.ref.drape(ground === 'plain' ? null : ground, ui.E.studioRect, (x, z) => ui.E.hf.sampleSurface(x, z), ground === 'dp' ? 0.85 : 1, o.ring);
    ui.E.world.needsRender = true;
  }, [ground, o.id, o.ring]);
  useEffect(() => () => { ui.app.ref.drape(null, null, () => 0); }, []);

  const setSite = (patch: Partial<PlotSite>, merge?: string) => {
    if (ro) return;
    ui.E.edit('Site', () => ui.doc.update(o.id, { site: { ...site, ...patch } }), merge);
  };
  /** "Fill for me": the most built-up area round what's placed (the hand-placed buildings kept at their floors) */
  const fill = () => {
    if (ro) return;
    const now = Object.fromEntries(d.buildings.map((b) => [b.b.id, b.floors]));
    ui.E.edit('Fill for me', () => ui.doc.update(o.id, { site: fillSite(r, site, o.use, now) }));
    const x = ui.E.plot.layout(o.id);
    if (x && !x.buildings.length) toast('Nothing more fits: the margins leave no room', 'warn');
    studioSel.value = null; studioLevel.value = -1; setTab('design');
  };
  const setUse = (v: PlotUse) => ui.E.edit('Plot use', () => ui.doc.update(o.id, { use: v, site: !o.site ? undefined : site.manual ? site : { ...siteDefaults(v), design: site.design, cost: site.cost, notes: site.notes, fill: site.fill, buildings: site.buildings.filter((b) => !b.auto) } }));
  const sel = d.buildings.find((b) => b.b.id === studioSel.value) ?? null;
  const selEl = site.elements?.find((e) => e.id === studioSel.value) ?? null;
  const levels = d.parking.levels;
  const lvName = (i: number) => { const l = levels[i], n = levels.slice(0, i + 1).filter((x) => x.kind === l.kind).length; return l.kind === 'stilt' ? 'Stilt' : l.kind === 'surface' ? 'Surface' : l.kind === 'lot' ? `Lot ${n}` : l.kind === 'structure' ? `C${n}` : l.kind === 'podium' ? `P${n}` : `B${n}`; };

  // departures, by what they're about
  const dep = d.departures, K = d.known;
  const about = (f: (x: Departure) => boolean) => { const x = dep.filter(f); return x.length ? x.map((y) => y.text).join(' · ') : undefined; };
  const fHeight = about((x) => x.key.startsWith('height')), fFsi = about((x) => x.key === 'fsi'), fPark = about((x) => x.key === 'parking');
  const tall = d.buildings.some((b) => b.height > FIRE_H);
  // checks unlock with detail: the shape, then a building, then a use; rules that only apply above a plot size (or
  // a height) stay hidden below it
  const checks: { label: string; show: boolean; state: 'ok' | 'flag' | 'broken'; text?: string }[] = [
    { label: 'Access', show: true, state: dep.some((x) => x.key === 'access') ? 'flag' : 'ok', text: about((x) => x.key === 'access') },
    { label: 'Margins', show: K.building, state: dep.some((x) => x.key.startsWith('margins')) ? 'flag' : 'ok', text: about((x) => x.key.startsWith('margins')) },
    { label: 'Spacing', show: d.buildings.length > 1 || d.over.overlap, state: d.over.overlap ? 'broken' : 'ok', text: d.over.overlap ? 'A building runs into another (or into a road or car park)' : undefined },
    { label: 'FSI', show: K.building, state: fFsi ? 'flag' : 'ok', text: fFsi },
    { label: 'Height', show: K.building, state: fHeight ? 'flag' : 'ok', text: fHeight },
    { label: 'Parking', show: K.building && K.use, state: fPark ? 'flag' : 'ok', text: fPark },
    { label: 'Fire access', show: tall, state: d.over.fire ? 'flag' : 'ok', text: about((x) => x.key.startsWith('fire')) },
    { label: 'Open space', show: d.open.need > 0, state: d.over.open ? 'flag' : 'ok', text: about((x) => x.key === 'open') },
  ];
  const info = useInfo(o.use);
  const unitWord = d.buildings.every((b) => b.use === 'residential') && d.buildings.length ? 'Flats' : d.buildings.every((b) => b.use === 'industrial') && d.buildings.length ? 'Shed floors' : 'Units';
  const needUse = !K.building ? 'needs a building' : !K.use ? 'needs use' : false;
  const tool = studioTool.value;

  return (
    <div class="studio">
      <header class="studio-top">
        <button class="studio-back" onClick={() => ui.E.closeStudio()} title="Back to the map (Esc)"><Icon.back size={15} /> Map</button>
        <div class="studio-name"><b>{o.name}</b><small title={`${Math.round(r.area * SQFT).toLocaleString('en-IN')} sq ft`}>{m2(r.area)} · {fx(r.roadW)} m road</small></div>
        <dl class="studio-metrics">
          <Metric label="Built-up" value={m2(d.bua)} sub={`${pc(d.coverage)} coverage`} need={!K.building && 'needs a building'} title="Floor area of the buildings, every floor" />
          <Metric label="FSI" value={fx(d.fsi)} sub={`of ${fx(r.bua / r.area)}`} need={!K.building && 'needs a building'} flag={fFsi} title="Built-up area over plot area, ancillary included" />
          <Metric label="Height" value={`${fx(d.height)} m`} sub={`${d.buildings.length ? Math.max(...d.buildings.map((b) => b.floors)) + d.under : 0} floors · ${fx(r.rules.maxH)} m allowed`} need={!K.building && 'needs floors'} flag={fHeight} />
          <Metric label={unitWord} value={d.flats.toLocaleString('en-IN')} need={needUse || (!info.unit && !d.flats ? 'nothing to count' : false)}
            sub={d.count.map((n, t) => n > 0 && <span key={t}><i style={`background:${UNIT_COLOR[t]}`} />{n}</span>)} />
          <Metric label="Parking" value={`${d.parking.have}/${d.parking.need}`} sub="bays" need={needUse} flag={fPark} />
          <Metric label="Profit" value={cr(d.money.profit)} sub={`${pc(d.money.margin)} margin`} need={needUse || (!K.money && 'needs a sale rate')} bad={K.money && d.money.profit < 0} />
          <Metric label="IRR" value={d.money.irr === null ? '–' : pc(d.money.irr)} sub={`${cr(d.money.peak)} peak in`} need={needUse || (!K.money && 'needs a sale rate')} bad={K.money && (d.money.irr === null || d.money.irr < 0)} title="Annual return on the cash put in, month by month" />
        </dl>
        <div class="studio-checks">
          {checks.filter((c) => c.show).map((c) => <span key={c.label} class={c.state} title={c.state === 'ok' ? `${c.label}: fine` : `${c.label}: ${c.text ?? ''}`} onClick={() => c.state !== 'ok' && setTab('rules')}>{c.state === 'ok' ? '✓' : c.state === 'flag' ? '•' : '!'} {c.label}</span>)}
        </div>
      </header>

      <div class="studio-3d-bar">
        <Seg small value={studioLook.value} onChange={(v) => { studioLook.value = v as 'real' | 'flats'; ui.E.rebuildPlots(); }} options={[
          { value: 'real', label: 'Realistic', title: 'The scheme as it would be built, on the ground as it lies' },
          { value: 'flats', label: 'Flats', title: 'Floor by floor, flats coloured by type, inside the envelope' },
        ]} />
        <Seg small value={studioGround.value} onChange={(v) => { studioGround.value = v as 'plain' | 'satellite' | 'dp'; }} options={[
          { value: 'plain', label: 'Plain', title: 'The ground as modelled' },
          { value: 'satellite', label: 'Satellite', title: 'Satellite imagery laid over the ground' },
          { value: 'dp', label: 'DP', title: 'The Development Plan sheets laid over the ground (where they’re registered)' },
        ]} />
        <div class="seg small">
          <button title="Aerial: over the plot" onClick={() => ui.E.studioView('aerial')}>Aerial</button>
          <button title="Street: at eye level from the street" onClick={() => ui.E.studioView('street')}>Street</button>
          <button title="Top: straight down" onClick={() => ui.E.studioView('top')}>Top</button>
        </div>
      </div>

      <section class="studio-left">
        <div class="studio-tools">
          <button class={`icon shelf-tile${tool === 'select' ? ' on' : ''}`} title="Select, move and shape (V)" aria-label="Select" onClick={() => { studioTool.value = 'select'; }}><Icon.select size={15} /></button>
          <div class="shelf" role="toolbar" aria-label="Things to place">
            {SHELF.map((x, i) => {
              const C = shelfIcon(x.value);
              const gap = i === BUILDING_SHAPES.length + 1;
              return <Fragment key={x.value}>{gap && <span class="shelf-gap" />}<button class={`icon shelf-tile${tool === x.value ? ' on' : ''}`} disabled={ro} aria-label={x.label}
                title={`${x.label}: ${x.title}${x.key ? ` (${x.key})` : ''}`} data-tip-art={`shelf:${x.value}`}
                onClick={() => { studioTool.value = tool === x.value ? 'select' : x.value; studioSel.value = null; }}><C size={17} /></button></Fragment>;
            })}
          </div>
          <span class="spacer" />
          <UsePicker value={o.use} onChange={(v) => !ro && v && setUse(v)} ro={ro} />
          <button class="icon shelf-tile spark" disabled={ro} aria-label="Fill for me" title="Fill for me: the most built-up area within the rules, laid round what you've placed" data-tip-art="shelf:spark" onClick={fill}><SI.spark size={17} /></button>
          {levels.length > 0 && <Seg small value={String(studioLevel.value)} onChange={(v) => { studioLevel.value = +v; }} options={[{ value: '-1', label: 'Plan', title: 'The buildings and the ground' }, ...levels.map((l, i) => ({ value: String(i), label: lvName(i), title: `${lvName(i)}: ${l.bays.length} bays` }))]} />}
          <button class="icon" title="Fit the plot" aria-label="Fit the plot" onClick={() => cv.current?.fit()}><Icon.fit size={14} /></button>
        </div>
        <div class="studio-plan">
          <canvas ref={ref} />
          <Impact o={o} r={r} d={d} ro={ro} />
          {tool !== 'select' && HINTS[tool] && <p class="studio-hint">{HINTS[tool]}</p>}
          {sel && tool === 'select' && (() => {
            const own = site.buildings.find((b) => b.id === sel.b.id);
            const setB = (patch: Partial<PlotSite['buildings'][number]>, mg?: string) => setSite({ buildings: site.buildings.map((b) => (b.id === sel.b.id ? { ...b, ...patch, auto: undefined } : b)), manual: true }, mg);
            const flags = dep.filter((x) => x.ids.includes(sel.b.id));
            const fl = sel.b.floors || sel.floors, bi = useInfo(sel.use);
            const units = sel.perFloor.reduce((a, b) => a + b, 0);
            return (
              <div class="studio-card">
                <div class="studio-card-head">
                  <UsePicker small value={own?.use} inherit={o.use} ro={ro} onChange={(u) => setB({ use: u })} />
                  <b>{bi.label}</b>
                  {sel.clash === 'overlap' && <span class="bad">runs into another</span>}
                  {flags.length > 0 && <span class="flag" title={flags.map((x) => x.text).join(' · ')}><i class="flag-dot" />{flags.length === 1 ? flags[0].rule.split(' · ')[0] : `${flags.length} departures`}</span>}
                </div>
                <div class="floors-step" role="group" aria-label="Floors">
                  <button class="icon" disabled={ro} aria-label="One floor less" title="One floor less" onClick={() => setB({ floors: Math.max(1, fl - 1) })}><SI.minus size={14} /></button>
                  <span class={`fl${sel.overHeight ? ' over' : ''}`} title={sel.overHeight ? flags.find((x) => x.key.startsWith('height'))?.text : `${fl + d.under} floors in all, ${fx(sel.height)} m`}>
                    <input class="fl-in" type="number" min={1} step={1} value={fl} disabled={ro} aria-label="Floors" style={{ width: `${String(fl).length + 2}ch` }}
                      onChange={(e) => { const v = Math.round(Number((e.currentTarget as HTMLInputElement).value)); if (v >= 1) setB({ floors: v }); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur(); e.stopPropagation(); }} /> fl{!sel.b.floors && <small>Any</small>}</span>
                  <button class="icon" disabled={ro} aria-label="One floor more" title="One floor more" onClick={() => setB({ floors: fl + 1 })}><SI.plus size={14} /></button>
                  {sel.b.floors > 0 && <button class="link small" disabled={ro} title="Any: as many as the FSI and the envelope allow" onClick={() => setB({ floors: 0 })}>Any</button>}
                  <NumberField label="Depth" unit="m" step={0.5} min={1} value={sel.b.depth} disabled={ro} title="14 m and deeper: flats both sides of the corridor" width={110}
                    onChange={(v, m) => setB({ depth: v }, m)} />
                </div>
                <p class="small muted">{m2(sel.plate)} a floor · {sel.use === 'none' ? 'units need a use' : `${units} ${bi.unit ?? 'units'} a floor`} · {sel.cores.length} core{sel.cores.length === 1 ? '' : 's'} · {fx(sel.height)} m{sel.overHeight ? ` (${fx(r.rules.maxH)} m allowed)` : ''}</p>
                <div class="btns">
                  <button class="icon" disabled={ro} onClick={() => { if (own) cv.current?.duplicate(own); }} title="Duplicate (Ctrl+D)" aria-label="Duplicate"><Icon.copy size={14} /></button>
                  <button class="icon danger" disabled={ro} onClick={() => cv.current?.remove(sel.b.id)} title="Remove (Delete)" aria-label="Remove"><Icon.trash size={14} /></button>
                </div>
              </div>
            );
          })()}
          {selEl && tool === 'select' && (() => {
            const m = ELEMENTS.find((x) => x.value === selEl.kind)!;
            const setEl = (patch: Partial<SiteElement>, mg?: string) => setSite({ elements: (site.elements ?? []).map((e) => (e.id === selEl.id ? { ...e, ...patch, auto: undefined } : e)), manual: true }, mg);
            const area = isArea(selEl), ring = area ? ringOf(selEl) : [];
            const lotIx = (site.elements ?? []).filter((e) => e.kind === 'lot' && elementRings(e).length).indexOf(selEl);
            const bays = selEl.kind === 'parking' ? d.parking.levels.filter((l) => l.kind === 'structure').reduce((a, l) => a + l.bays.length, 0) : selEl.kind === 'lot' ? d.parking.levels.filter((l) => l.kind === 'lot')[lotIx]?.bays.length ?? 0 : 0;
            const C = shelfIcon(selEl.kind);
            return (
              <div class="studio-card">
                <div class="studio-card-head"><span class="card-icon"><C size={16} /></span><b>{m.label}</b>{selEl.auto && <span class="muted small">laid by Fill for me</span>}</div>
                <div class="grid3">
                  {!area && selEl.kind !== 'gate' && <NumberField label={selEl.kind === 'roundabout' || selEl.kind === 'tank' ? 'Across' : selEl.kind === 'wall' ? 'Thick' : 'Width'} unit="m" step={selEl.kind === 'wall' ? 0.05 : 0.5} min={0.05} value={selEl.depth} disabled={ro} onChange={(v, mg) => setEl({ depth: v }, mg)} />}
                  {selEl.kind === 'parking' && <NumberField label="Levels" digits={0} step={1} min={1} value={selEl.levels ?? 3} disabled={ro} onChange={(v, mg) => setEl({ levels: Math.max(1, Math.round(v)) }, mg)} />}
                </div>
                <p class="small muted">{area ? `${m2(Math.abs(polyArea(ring)))} drawn, ${ring.length / 2} corners: drag one, drag a dot mid-edge to add one, Alt-click to drop one.` : m.title}{bays ? ` · ${bays} bays${selEl.kind === 'parking' ? ' in all' : ', packed at the best angle'}` : ''}</p>
                <div class="btns">
                  <button class="icon" disabled={ro} onClick={() => cv.current?.duplicate(selEl)} title="Duplicate (Ctrl+D)" aria-label="Duplicate"><Icon.copy size={14} /></button>
                  <button class="icon danger" disabled={ro} onClick={() => cv.current?.remove(selEl.id)} title="Remove (Delete)" aria-label="Remove"><Icon.trash size={14} /></button>
                </div>
              </div>
            );
          })()}
          {!d.buildings.length && !(site.elements ?? []).length && tool === 'select' && (
            <div class="studio-empty">
              <p>The plot and its margins (dashed). Pick a building off the shelf and click it in, or let <button class="link" disabled={ro} onClick={fill}><SI.spark size={13} /> Fill for me</button> lay the most it can.</p>
            </div>
          )}
        </div>
        <nav class="studio-tabs">
          {(Object.keys(TABS) as Tab[]).map((t) => <button key={t} class={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{TABS[t]}{t === 'rules' && dep.length > 0 && <i class="tab-count">{dep.length}</i>}</button>)}
        </nav>
        <div class="studio-drawer">
          {tab === 'roads' && <RoadsTab o={o} r={r} ro={ro} />}
          {tab === 'design' && <DesignTab o={o} r={r} d={d} site={site} setSite={setSite} ro={ro} fill={fill} />}
          {tab === 'flats' && <FlatsTab o={o} r={r} d={d} site={site} setSite={setSite} ro={ro} />}
          {tab === 'parking' && <ParkingTab o={o} r={r} d={d} site={site} setSite={setSite} ro={ro} />}
          {tab === 'site' && <SiteTab o={o} r={r} d={d} site={site} setSite={setSite} ro={ro} />}
          {tab === 'rules' && <RulesTab o={o} r={r} d={d} site={site} setSite={setSite} ro={ro} />}
          {tab === 'money' && <MoneyTab d={d} site={site} setSite={setSite} ro={ro} />}
          {tab === 'options' && <OptionsTab o={o} d={d} site={site} setSite={setSite} ro={ro} />}
          {tab === 'export' && (
            <div>
              <p class="small muted">The plot, the buildings and the site around them (ground, roads, buildings), in metres from the plot's centre.</p>
              <div class="btns">
                <button onClick={() => exportPlot(ui.E, o.id, 'dxf')} title="DXF: AutoCAD, BricsCAD: plan layers, and the massing as 3D faces">DXF</button>
                <button onClick={() => exportPlot(ui.E, o.id, 'obj')} title="OBJ: Rhino, SketchUp, Blender, Revit">OBJ</button>
                <button onClick={() => exportPlot(ui.E, o.id, 'glb')} title="glTF binary: Blender, three.js, Unreal, Unity">glTF</button>
              </div>
              <p class="small muted">The numbers: the area statement as the approval drawings carry it, every unit by building and floor, and a report to print or save as PDF (with the departures from the rules and your notes on them).</p>
              <div class="btns">
                <button onClick={() => areaStatement(o, r, d)} title="Area statement: plot, DP road, FSI by source, built-up area by building, parking, open space, departures (CSV, opens in Excel)">Area statement</button>
                <button onClick={() => unitSchedule(o, d)} title="Unit schedule: every unit, building, floor, type, carpet (CSV)">Unit schedule</button>
                <button onClick={() => printReport(o, r, d, ref.current, ui.E.engine.snapshot())} title="Report: the plan, the numbers, the checks and the departures on a page: print, or save as PDF">Report</button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/** Where the project departs from the rules: each with the rule, the value, what's allowed and the clause, and a
 *  note to justify it (it goes in the report). Flagged, never refused. */
function RulesTab({ o, r, d, site, setSite, ro }: TabProps & { r: PlotReport }) {
  const dep = d.departures, notes = site.notes ?? {};
  const generic = [...new Set([o.use, ...d.buildings.map((b) => b.use)])].map(useInfo).filter((u) => u.generic && u.value !== 'none');
  return (
    <div>
      {dep.length ? (
        <table class="departures">
          <thead><tr><th>Departure</th><th>Value</th><th>Allowed</th><th>Note</th></tr></thead>
          <tbody>
            {dep.map((x) => (
              <tr key={x.key}>
                <td><i class="flag-dot" /> <b>{x.rule}</b><small>{x.clause}</small></td>
                <td>{x.value}</td>
                <td class="muted">{x.allowed}</td>
                <td><textarea rows={1} disabled={ro} placeholder="Why (goes in the report)" aria-label={`Note on ${x.rule}`} value={notes[x.key] ?? ''}
                  onChange={(e) => { const v = (e.currentTarget as HTMLTextAreaElement).value.trim(), n = { ...notes }; if (v) n[x.key] = v; else delete n[x.key]; setSite({ notes: Object.keys(n).length ? n : undefined }); }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p class="small muted">{d.buildings.length ? 'No departures from the rules.' : 'Nothing placed yet: the checks appear as the project gets detail (a building, then a use, then rates).'}</p>}
      {generic.length > 0 && <p class="small muted">{generic.map((u) => `${u.label}: ${u.note}`).join(' ')}</p>}
      <p class="small muted">Rules flag, never block: anything can be placed or typed, a departure shows amber on the plan, in 3D and on its number, and is listed here and in the report. Red is kept for what's physically broken, like buildings running into each other. Rules by {fx(r.roadW)} m road.</p>
    </div>
  );
}

type TabProps = { o: PlotObj; d: SiteReport; site: PlotSite; setSite: (p: Partial<PlotSite>, merge?: string) => void; ro: boolean };

function FlatsTab({ o, r, d, site, setSite, ro }: TabProps & { r: PlotReport }) {
  if (!d.known.building || !d.known.use) return <p class="small muted need-note">{!d.known.building ? 'Units appear once there’s a building on the plot.' : 'Units need a use: set one for the plot or the building (the icon on the bar, or in the building’s card).'}</p>;
  const homes = d.buildings.some((b) => b.use === 'residential');
  if (!homes) {
    const units = d.count[3], word = d.buildings.every((b) => b.use === 'industrial') ? 'Shed floors' : `${useInfo(d.buildings[0]?.use ?? o.use).label} units`;
    return (
      <div>
        <dl class="kv plot-calc">
          <dt>{word} · all buildings, all floors</dt><dd>{units.toLocaleString('en-IN')}</dd>
          <dt>Built-up area · {d.buildings.length} building{d.buildings.length === 1 ? '' : 's'}</dt><dd>{m2(d.bua)}</dd>
          <dt>Carpet · {d.bua ? pc(d.carpet / d.bua) : '–'} of built-up</dt><dd>{m2(d.carpet)}</dd>
          <dt><b>Saleable</b></dt><dd><b>{Math.round(d.carpet * SQFT).toLocaleString('en-IN')} ft²</b></dd>
        </dl>
        <p class="small muted">{d.buildings.every((b) => b.use === 'industrial')
          ? `Sheds: one open floor per wing, ${fx(r.rules.floorH)} m clear, no cores or corridor; 92 % of it usable.`
          : `An open floor plate between each pair of cores, ${Math.round(CARPET * 100)} % of it carpet, on ${fx(r.rules.floorH)} m floors.`} Set the use on the bar, or a building's own in its card.</p>
      </div>
    );
  }
  const shares = site.mix[0] + site.mix[1] + site.mix[2] || 1;
  return (
    <div>
      <div class="plot-mix">
        <span />
        {[0, 1, 2].map((t) => <b key={t}><i style={`background:${UNIT_COLOR[t]}`} />{UNIT_LABEL[t]}</b>)}
        <span class="muted small">Mix</span>
        {[0, 1, 2].map((t) => (
          <NumberField key={t} unit="%" digits={0} step={5} min={0} max={100} value={Math.round((site.mix[t] / shares) * 100)} disabled={ro}
            onChange={(v, m) => { const mix = site.mix.map((x) => x / shares) as PlotSite['mix']; mix[t] = v / 100; setSite({ mix }, m); }} />
        ))}
        <span class="muted small">Carpet</span>
        {[0, 1, 2].map((t) => (
          <NumberField key={t} unit="m²" digits={0} step={1} min={1} value={site.sizes[t]} disabled={ro}
            onChange={(v, m) => { const sizes = [...site.sizes] as PlotSite['sizes']; sizes[t] = v; setSite({ sizes }, m); }} />
        ))}
        <span class="muted small">Flats</span>
        {[0, 1, 2].map((t) => <span key={t} class="num">{d.count[t].toLocaleString('en-IN')}</span>)}
      </div>
      <dl class="kv plot-calc">
        <dt>Built-up area · {d.buildings.length} building{d.buildings.length === 1 ? '' : 's'}</dt><dd>{m2(d.bua)}</dd>
        <dt>RERA carpet · {d.bua ? pc(d.carpet / d.bua) : '–'} of built-up</dt><dd>{m2(d.carpet)}</dd>
        <dt><b>Saleable</b></dt><dd><b>{Math.round(d.carpet * SQFT).toLocaleString('en-IN')} ft²</b></dd>
      </dl>
      <p class="small muted">Flats both sides of a corridor in wings 14 m deep or more; corner flats where wings meet. Cores (lifts and stairs, two stairs above 15 m) at most {2 * TRAVEL} m apart for the {TRAVEL} m escape distance (NBC 2016 Part 4). Carpet taken as {Math.round(CARPET * 100)} % of a flat's built-up area.</p>
    </div>
  );
}

function ParkingTab({ o, r, d, site, setSite, ro }: TabProps & { r: PlotReport }) {
  const P = d.parking;
  if (!d.known.building || !d.known.use) return <p class="small muted need-note">{!d.known.building ? 'Parking is worked out once there’s a building on the plot.' : 'Parking needs a use: what the code asks depends on it.'}</p>;
  const fit = () => {
    const b = basementsToFit(r, site, o.use);
    setSite({ basements: b });
    const x = ui.E.plot.layout(o.id);
    if (x && x.parking.have < x.parking.need) toast(`${b} basements still leave ${x.parking.need - x.parking.have} bays short: add podium levels`, 'warn');
  };
  return (
    <div>
      <div class="grid2">
        <Toggle checked={site.stilt} disabled={ro} onChange={(v) => setSite({ stilt: v })} label="Stilt floor" title="Parking on the ground floor under the buildings" />
        <Toggle checked={!!site.surface} disabled={ro} onChange={(v) => setSite({ surface: v, surfacePick: v })} label="Surface bays" title={`Bays on the open ground, clear of the buildings and the fire tender's ${FIRE_W} m way round the tall ones`} />
        <NumberField label="Podium levels" digits={0} step={1} min={0} value={site.podium} disabled={ro} onChange={(v, m) => setSite({ podium: Math.round(v) }, m)} title="Parking floors over the whole envelope under the flats (they add to the height)" />
        <NumberField label="Basements" digits={0} step={1} min={0} value={site.basements} disabled={ro || !site.manual} state={site.manual ? 'own' : 'base'} onChange={(v, m) => setSite({ basements: Math.round(v) }, m)} title={site.manual ? 'Under the plot, 1.5 m in from its edges' : 'As many as the parking needs: worked out'} />
      </div>
      <dl class="kv plot-calc">
        <dt>Cars · {o.use === 'industrial' ? '1 per 300 m² carpet' : o.use === 'residential' ? 'by flat size' : o.use === 'school' ? '1 per 200 m² carpet' : '1 per 100 m² carpet'}, + 5 % visitors</dt><dd>{P.cars}</dd>
        {P.trucks > 0 && <><dt>Loading bays · 1 per 1,000 m², each the room of three cars</dt><dd>{P.trucks}</dd></>}
        <dt>Two-wheelers · four to a bay</dt><dd>{P.scooters}</dd>
        {P.levels.map((l, i) => <Fragment key={i}><dt><button class="link" onClick={() => { studioLevel.value = i; }}>{{ stilt: 'Stilt', surface: 'Surface', podium: 'Podium', basement: 'Basement', structure: 'Car park level', lot: 'Lot' }[l.kind]}</button></dt><dd>{l.bays.length} bays</dd></Fragment>)}
        <dt><b>Bays laid out / needed</b></dt><dd><b>{P.have} / {P.need}</b></dd>
      </dl>
      {P.have < P.need && <button disabled={ro} onClick={fit}>Add basements to fit</button>}
      <p class="small muted">UDCPR Table 8-B: a car for every two flats of 30–80 m² carpet, one for 80–150 m², two above; a two-wheeler each. Bays 2.5 × 5 m on 6 m aisles.</p>
    </div>
  );
}

function MoneyTab({ d, site, setSite, ro }: Omit<TabProps, 'o'>) {
  const M = d.money, K = M.costs;
  return (
    <div>
      <div class="grid3">
        {RATES.map((x) => (
          <NumberField key={x.k} label={x.label} unit={x.unit} digits={0} step={x.step} min={0} value={K[x.k]} title={x.title} disabled={ro}
            state={site.cost[x.k] !== undefined ? 'own' : 'base'} onChange={(v, m) => setSite({ cost: { ...site.cost, [x.k]: v } }, m)} />
        ))}
      </div>
      {!d.known.money && <p class="small muted need-note">{!d.known.building ? 'Costs and returns appear once there’s a building.' : 'Nothing here is for sale yet: give the plot or a building a use that sells (homes, offices, shops, industry), or put in a sale rate above.'}</p>}
      {d.known.money && <>
      <dl class="kv plot-calc">
        <dt>Sales · {Math.round(d.carpet * SQFT).toLocaleString('en-IN')} ft² carpet</dt><dd>{cr(M.revenue)}</dd>
        <dt>Land</dt><dd>−{cr(M.land)}</dd>
        {M.premium > 0 && <><dt>Premium FSI</dt><dd>−{cr(M.premium)}</dd></>}
        {M.tdr > 0 && <><dt>TDR</dt><dd>−{cr(M.tdr)}</dd></>}
        {M.ancillary > 0 && <><dt>Ancillary FSI</dt><dd>−{cr(M.ancillary)}</dd></>}
        <dt>Construction</dt><dd>−{cr(M.build)}</dd>
        {M.parking > 0 && <><dt>Parking levels</dt><dd>−{cr(M.parking)}</dd></>}
        <dt>Soft costs</dt><dd>−{cr(M.soft)}</dd>
        <dt><b>Profit</b> · {pc(M.margin)} of sales{M.cost > 0 ? ` · ${pc(M.profit / M.cost)} on cost` : ''}</dt><dd><b style={M.profit < 0 ? 'color:var(--danger)' : ''}>{cr(M.profit)}</b></dd>
      </dl>
      <h4 class="studio-sub">Cash, month by month</h4>
      <CashChart cum={M.cum} months={K.months} />
      <dl class="kv plot-calc">
        <dt>IRR · a year</dt><dd>{M.irr === null ? 'none' : pc(M.irr)}</dd>
        <dt>Most money in at once</dt><dd>{cr(M.peak)}</dd>
        <dt>Pays back</dt><dd>{M.payback === null ? 'never' : `month ${M.payback}`}</dd>
      </dl>
      </>}
      <p class="small muted">Premium, TDR and ancillary FSI are priced as a % of the ready reckoner (ASR) rate. Land and FSI are paid up front, construction along an S-curve; buyers book from month 3 and pay as the building goes up (RERA stage payments), the rest on possession. The starting rates are rough figures for the city, before GST and finance: put in your own.
        {Object.keys(site.cost).length > 0 && <> <button class="link small" disabled={ro} onClick={() => setSite({ cost: {} })}>Reset rates</button></>}</p>
    </div>
  );
}

function OptionsTab({ o, d, site, setSite, ro }: TabProps) {
  const opts = o.options ?? [];
  const setOpts = (options: PlotObj['options']) => ui.E.edit('Plot options', () => ui.doc.update(o.id, { options: options?.length ? options : undefined }));
  const cur = JSON.stringify(site);
  const rows = [{ name: 'Current', d, i: -1 }, ...opts.map((x, i) => ({ name: x.name, d: ui.E.plot.layoutOf(o.id, x.site), i }))];
  const next = () => { for (let i = 0; ; i++) { const n = `Option ${i < 26 ? String.fromCharCode(65 + i) : i + 1}`; if (!opts.some((x) => x.name === n)) return n; } };
  return (
    <div>
      <table class="plot-options">
        <thead><tr><th /><th>Buildings</th><th>Flats</th><th>FSI</th><th>Height</th><th>Parking</th><th>Profit</th><th /></tr></thead>
        <tbody>
          {rows.map((x) => x.d && (
            <tr key={x.i} class={x.i >= 0 && JSON.stringify(opts[x.i].site) === cur ? 'on' : ''}>
              <td>{x.i < 0 ? <b>{x.name}</b> : <button class="link" disabled={ro} title="Use this one" onClick={() => { setSite(opts[x.i].site); studioSel.value = null; }}>{x.name}</button>}</td>
              <td>{x.d.buildings.length}</td>
              <td>{x.d.flats}</td>
              <td class={x.d.over.fsi ? 'bad' : ''}>{fx(x.d.fsi)}</td>
              <td class={x.d.over.height || x.d.over.margins ? 'bad' : ''}>{fx(x.d.height)} m</td>
              <td class={x.d.parking.have < x.d.parking.need ? 'bad' : ''}>{x.d.parking.have}/{x.d.parking.need}</td>
              <td class={x.d.money.profit < 0 ? 'bad' : ''}>{cr(x.d.money.profit)}<small>{pc(x.d.money.margin)}</small></td>
              <td>{x.i >= 0 && <button class="link small" disabled={ro} aria-label={`Remove ${x.name}`} onClick={() => setOpts(opts.filter((_, j) => j !== x.i))}>×</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button disabled={ro} onClick={() => setOpts([...opts, { name: next(), site: JSON.parse(cur) }])}>Save as an option</button>
    </div>
  );
}

/** The running total of cash over the months: below the line is money in, above it money back. */
function CashChart({ cum, months }: { cum: number[]; months: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 520, H = 120, pad = 6;
  const lo = Math.min(0, ...cum), hi = Math.max(0, ...cum), span = hi - lo || 1;
  const X = (i: number) => pad + (i / Math.max(1, cum.length - 1)) * (W - 2 * pad), Y = (v: number) => pad + ((hi - v) / span) * (H - 2 * pad);
  const line = cum.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  const move = (e: MouseEvent) => {
    const b = (e.currentTarget as SVGElement).getBoundingClientRect();
    setHover(Math.max(0, Math.min(cum.length - 1, Math.round(((((e.clientX - b.left) / b.width) * W - pad) / (W - 2 * pad)) * (cum.length - 1)))));
  };
  return (
    <div class="cash-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" onMouseMove={move} onMouseLeave={() => setHover(null)} role="img" aria-label="Running total of cash by month">
        <line x1={X(months)} x2={X(months)} y1={pad} y2={H - pad} class="cash-mark" />
        <line x1={pad} x2={W - pad} y1={Y(0)} y2={Y(0)} class="cash-zero" />
        <path d={`${line}L${X(cum.length - 1)},${Y(0)}L${X(0)},${Y(0)}Z`} class="cash-area" />
        <path d={line} class="cash-line" />
        {hover !== null && <><line x1={X(hover)} x2={X(hover)} y1={pad} y2={H - pad} class="cash-cross" /><circle cx={X(hover)} cy={Y(cum[hover])} r={4} class="cash-dot" /></>}
      </svg>
      <div class="cash-axis"><span>Month 0</span><span style={`left:${(X(months) / W) * 100}%`}>Possession</span><span>Month {cum.length - 1}</span></div>
      {hover !== null && <div class="cash-tip" style={`left:${(X(hover) / W) * 100}%`}>Month {hover}<b>{cr(cum[hover])}</b></div>}
    </div>
  );
}

/** A scheme's plan, small: the plot, its open space and its buildings, the road along the bottom. */
function Thumb({ r, buildings, rg, roads }: { r: PlotReport; buildings: PlotSite['buildings']; rg?: number[] | null; roads?: SiteElement[] }) {
  const F = roadFrame(r), R = F.toL(r.net.length >= 6 ? r.net : r.footprint);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < R.length; i += 2) { x0 = Math.min(x0, R[i]); x1 = Math.max(x1, R[i]); z0 = Math.min(z0, -R[i + 1]); z1 = Math.max(z1, -R[i + 1]); }
  const loc = (q: number[]) => (q === R ? q : F.toL(q));
  const pts = (q: number[]) => loc(q).map((v, i) => (i % 2 ? -v - z0 : v - x0).toFixed(1)).join(' ');
  return (
    <svg viewBox={`-2 -2 ${x1 - x0 + 4} ${z1 - z0 + 4}`} class="scheme-thumb" aria-hidden="true">
      <polygon points={pts(R)} class="t-plot" />
      {rg && rg.length >= 6 && <polygon points={pts(rg)} class="t-rg" />}
      {(roads ?? []).flatMap(elementRings).map((q, i) => <polygon key={`r${i}`} points={pts(q)} class="t-road" />)}
      {buildings.flatMap((b) => buildingQuads(b)).map((q, i) => <polygon key={i} points={pts(q)} class="t-bldg" />)}
    </svg>
  );
}

function DesignTab({ o, r, site, setSite, ro, fill }: TabProps & { r: PlotReport; fill: () => void }) {
  const design = site.design ?? DEFAULT_DESIGN;
  // targets for "Fill for me": a filled site plans again as they change; a site shaped by hand keeps them for next time
  const setDesign = (patch: Partial<Design>, merge?: string) => setSite({ design: { ...design, ...patch } }, merge);
  const filled = !site.manual;
  const list = filled ? schemes(r, design.type === 'auto' ? design : { ...design, type: 'auto' }, o.use, (site.stilt ? 1 : 0) + site.podium, site) : [];
  const shed = o.use === 'industrial', noun = (t: string) => (shed ? 'shed' : t === 'tower' ? 'tower' : o.use === 'residential' || o.use === 'none' ? 'slab' : 'block');
  const name = (s: (typeof list)[number]) => `${s.buildings.length} ${noun(s.type)}${s.buildings.length === 1 ? '' : 's'} · ${s.floors} floor${s.floors === 1 ? '' : 's'}`;
  const cur = !filled ? null : (design.type === 'auto' ? list[0]?.type : design.type);
  // internal roads and roundabouts only mean something on a plot big enough to need them
  const roomy = r.area >= RG_FROM;
  return (
    <div>
      {filled && list.length > 0 && (
        <div class={`schemes${list.length > 1 ? ' two' : ''}`}>
          {list.map((s) => (
            <div key={s.type} class={`scheme${cur === s.type ? ' on' : ''}`}>
              <button class="scheme-pick" disabled={ro} title={`Use ${noun(s.type)}s`} onClick={() => { setDesign({ type: s.type }); studioSel.value = null; studioLevel.value = -1; }}>
                <Thumb r={r} buildings={s.buildings} rg={s.rg} roads={s.roads} />
                <span class="scheme-name">{noun(s.type)[0].toUpperCase() + noun(s.type).slice(1)}s{s === list[0] && list.length > 1 ? ' · most built-up' : ''}</span>
                <b>{m2(s.bua)} <small>{pc(s.bua / (r.bua || 1))} of allowed</small></b>
                <small>{name(s)} · {fx((s.floors + (site.stilt ? 1 : 0) + site.podium) * r.rules.floorH)} m · FSI {fx(s.bua / r.area)}</small>
              </button>
            </div>
          ))}
        </div>
      )}
      <div class={`design-state${site.manual ? ' manual' : ''}`}>
        {filled
          ? <span><SI.spark size={13} /> <b>Filled for the most built-up area</b> within the rules: {m2(r.bua)} allowed. Change a target and it fills again; move a building to take it over.</span>
          : <><span>Placed by hand. <b>Fill for me</b> lays the most built-up area round what's there, then offers slabs and towers to compare.</span><button class="primary" disabled={ro} onClick={fill} title="Fill for me: the most built-up area within the rules, round what's placed"><SI.spark size={14} /> Fill</button></>}
      </div>
      <h4 class="studio-sub">Targets for Fill for me</h4>
      <div class="grid3">
        <label class="field-label">Buildings<Seg small value={shed ? 'auto' : design.type} onChange={(v) => setDesign({ type: v as Typology })} options={shed ? [{ value: 'auto', label: 'Sheds', title: 'Sheds as deep as the zone allows' }] : TYPOLOGIES} /></label>
        <NumberField label="Most floors" digits={0} step={1} min={0} value={design.maxFloors || null} placeholder="Any" disabled={ro} title="Most floors: at most this many over the stilt; empty: any, as the height limit allows" onChange={(v, m) => setDesign({ maxFloors: Math.max(0, Math.round(v)) }, m)} />
        <NumberField label="Most buildings" digits={0} step={1} min={0} value={design.maxBuildings || null} placeholder="Any" disabled={ro} title="Most buildings: empty, any, as many as fit" onChange={(v, m) => setDesign({ maxBuildings: Math.max(0, Math.round(v)) }, m)} />
      </div>
      {roomy && <label class="field-label">Internal roads<Seg small value={design.access ?? 'perimeter'} onChange={(v) => setDesign({ access: v as Access })} options={ACCESS} /></label>}
      <div class="grid3">
        <NumberField label="Extra spacing" unit="m" digits={0} step={1} min={0} value={design.spacing || null} placeholder="None" disabled={ro} title="Extra spacing: more room between buildings than the rules ask" onChange={(v, m) => setDesign({ spacing: Math.max(0, Math.round(v)) }, m)} />
        <NumberField label="Green" unit="%" digits={0} step={1} min={0} value={design.green || null} placeholder="Rules" disabled={ro} title="Green: share of the plot kept as garden at least (the open space the rules ask is kept anyway)" onChange={(v, m) => setDesign({ green: Math.max(0, Math.round(v)) }, m)} />
        {roomy && <Toggle checked={!!design.roundabouts} disabled={ro || !design.access || design.access === 'perimeter' || design.access === 'none'} onChange={(v) => setDesign({ roundabouts: v || undefined })} label="Roundabouts" title="Roundabouts: a turning circle at each road's end and a roundabout where roads cross" />}
      </div>
      <p class="small muted">Fill for me keeps the margins for each building's height{r.area >= RG_FROM ? ` and, above ${FIRE_H} m, ${FIRE_W} m from the plot's other sides for the fire tender's drive; plots of ${m2(RG_FROM)} and more keep ${pc(RG_SHARE)} as open space at the back` : ''}. On a small plot it fills the envelope with one building. These are targets for it, never caps on what you place yourself.</p>
    </div>
  );
}

function SiteTab({ r, d }: TabProps & { r: PlotReport }) {
  const tall = d.buildings.filter((b) => b.fire.length);
  const side = d.height > r.rules.sideTo ? Math.min(12, Math.max(r.rules.side, d.height / 5)) : r.rules.side;
  return (
    <div>
      <dl class="kv plot-calc">
        <dt>Plot · after the DP road</dt><dd>{m2(r.area)} · {m2(r.netArea)}</dd>
        <dt>Ground coverage</dt><dd>{pc(d.coverage)}</dd>
        <dt>Open ground · not built or parked on</dt><dd>{m2(d.open.have)}</dd>
        {d.open.need > 0 && <><dt>Recreational open space needed</dt><dd class={d.over.open ? 'flag' : ''}>{m2(d.open.need)}</dd></>}
        {tall.length > 0 && <><dt>Fire tender's way round</dt><dd class={d.over.fire ? 'flag' : ''}>{tall.filter((b) => b.fireOk).length} of {tall.length} clear</dd></>}
        <dt>Margins at {fx(d.height)} m</dt><dd>front {fx(r.rules.front)} m · sides {fx(side)} m</dd>
      </dl>
      <p class="small muted">{tall.length > 0 && <>Buildings over {FIRE_H} m need a clear {FIRE_W} m motorable way round them for a fire tender (NBC 2016 Part 4), on the plot or out over the road it fronts: dashed amber on the plan where it's blocked. </>}{d.open.need > 0 && <>Plots of {m2(RG_FROM)} and more with homes keep {pc(RG_SHARE)} as recreational open space (UDCPR 3.5.1).</>}</p>
    </div>
  );
}

// ---------------- roads: what-if widths ----------------

type RoadEdits = NonNullable<PlotObj['roadEdits']>;

/** The map's own width and DP reserve of a section. */
function mapRoad(id: string) {
  const s = ui.doc.get<'section'>(id);
  return s?.kind === 'section' ? { width: Math.round(totalWidth(s.parts) * 100) / 100, reserve: s.reserve } : null;
}

/** Set a road's what-if, dropping what matches the map again. */
function setRoadEdit(o: PlotObj, id: string, patch: { width?: number; reserve?: number }, merge?: string) {
  const next: RoadEdits = { ...o.roadEdits, [id]: { ...o.roadEdits?.[id], ...patch } };
  for (const [k, e] of Object.entries(next)) {
    const m = mapRoad(k);
    if (!m) { delete next[k]; continue; }
    if (e.width !== undefined && Math.abs(e.width - m.width) < 0.01) delete e.width;
    if (e.reserve !== undefined && e.reserve === (m.reserve ?? 0)) delete e.reserve;
    if (e.width === undefined && e.reserve === undefined) delete next[k];
  }
  ui.E.edit('Road what-if', () => ui.doc.update(o.id, { roadEdits: Object.keys(next).length ? next : undefined }), merge);
}

function RoadsTab({ o, r, ro }: { o: PlotObj; r: PlotReport; ro: boolean }) {
  if (!r.roads.length) return <p class="small muted">No road near this plot.</p>;
  const basis = o.basis ?? (r.road?.dp ? 'dp' : 'today');
  const site = ui.E.plot.site(o.id);
  const gates = site?.gateRoads ?? (r.area >= GATES_FROM ? r.roads.map((x) => x.id) : r.road ? [r.road.id] : []);
  const setGates = (g: string[]) => site && ui.E.edit('Gates', () => ui.doc.update(o.id, { site: { ...site, gateRoads: g } }));
  return (
    <div>
      <table class="road-table">
        <thead><tr><th>Road</th><th title="The plot is entered from it: its width sets the FSI">Entry</th><th title="A gate (and, with internal roads, a road in) from it">Gate</th><th>Width today</th><th>DP width</th><th /></tr></thead>
        <tbody>
          {r.roads.map((x) => {
            const m = mapRoad(x.id);
            return (
              <tr key={x.id} class={x.edited ? 'edited' : ''}>
                <td><b>{x.name}</b>{m && x.edited && <small>map: {m.width} m{m.reserve ? ` · DP ${m.reserve} m` : ''}</small>}</td>
                <td><input type="radio" name="entry" checked={x.entry} disabled={ro || r.roads.length < 2} onChange={() => ui.E.edit('Entry road', () => ui.doc.update(o.id, { front: x.id }))} aria-label={`Enter from ${x.name}`} /></td>
                <td><input type="checkbox" checked={gates.includes(x.id)} disabled={ro} onChange={() => setGates(gates.includes(x.id) ? gates.filter((g) => g !== x.id) : [...gates, x.id])} aria-label={`A gate on ${x.name}`} /></td>
                <td><NumberField unit="m" step={0.5} min={0.5} value={x.today} disabled={ro} state={o.roadEdits?.[x.id]?.width !== undefined ? 'own' : 'base'} onChange={(v, mg) => setRoadEdit(o, x.id, { width: v }, mg)} /></td>
                <td><NumberField unit="m" step={1} min={0} value={x.dp || null} placeholder="None" disabled={ro} state={o.roadEdits?.[x.id]?.reserve !== undefined ? 'own' : 'base'} title="0: no DP width" onChange={(v, mg) => setRoadEdit(o, x.id, { reserve: Math.round(v) }, mg)} /></td>
                <td>{x.edited && <button class="link small" disabled={ro} onClick={() => setRoadEdit(o, x.id, { width: m?.width, reserve: m?.reserve ?? 0 })}>Reset</button>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div class="road-basis">
        <span class="small muted">Rules by</span>
        <Seg small value={basis} onChange={(v) => !ro && ui.E.edit('Plot basis', () => ui.doc.update(o.id, { basis: v as 'today' | 'dp' }))} options={[
          { value: 'today', label: 'Today’s width', title: 'FSI and margins by the road as built' },
          { value: 'dp', label: 'DP width', title: 'FSI and margins by the road the Development Plan widens it to' },
        ]} />
      </div>
      <p class="small muted">The FSI and front margin follow the entry road ({fx(r.roadW)} m); every road side keeps the front margin, and each road's DP width cuts the plot. Widths you change here are what-ifs: the plot and its buildings follow at once, and the map takes them when you close the studio.</p>
    </div>
  );
}

/** What the road what-ifs change, against the map as it is. */
function Impact({ o, r, d, ro }: { o: PlotObj; r: PlotReport; d: SiteReport; ro: boolean }) {
  const b = ui.E.plot.baseline(o.id);
  if (!b) return null;
  const floors = (x: SiteReport) => (x.buildings.length ? Math.max(...x.buildings.map((y) => y.floors)) + x.under : 0);
  const rows: { k: string; a: number; z: number; f: (v: number) => string }[] = [
    { k: 'FSI', a: b.r.bua / b.r.area, z: r.bua / r.area, f: fx },
    { k: 'Permissible', a: b.r.bua, z: r.bua, f: m2 },
    { k: 'Built', a: b.d.bua, z: d.bua, f: m2 },
    { k: 'Floors', a: floors(b.d), z: floors(d), f: (v) => String(v) },
    { k: 'Flats', a: b.d.flats, z: d.flats, f: (v) => String(v) },
    { k: 'Profit', a: b.d.money.profit, z: d.money.profit, f: cr },
  ];
  const what = r.roads.filter((x) => x.edited).map((x) => {
    const m = mapRoad(x.id);
    const parts: string[] = [];
    if (m && Math.abs(m.width - x.today) > 0.01) parts.push(`${m.width} → ${+x.today.toFixed(2)} m`);
    if (m && (m.reserve ?? 0) !== (x.dp ?? 0)) parts.push(`DP ${m.reserve ?? '–'} → ${x.dp || '–'} m`);
    return `${x.name} ${parts.join(', ')}`;
  });
  return (
    <div class="studio-impact" role="status">
      <div class="impact-head"><b>What-if</b><span>{what.join(' · ')}</span>
        <button class="link small" disabled={ro} onClick={() => ui.E.edit('Road what-if', () => ui.doc.update(o.id, { roadEdits: undefined }))}>Reset</button></div>
      <dl>
        {rows.map((x) => {
          const up = x.z > x.a + 1e-6, down = x.z < x.a - 1e-6;
          return <div key={x.k} class={up ? 'up' : down ? 'down' : ''}><dt>{x.k}</dt><dd>{x.f(x.a)} → <b>{x.f(x.z)}</b></dd></div>;
        })}
      </dl>
      <small>The map takes these widths when you close the studio.</small>
    </div>
  );
}
