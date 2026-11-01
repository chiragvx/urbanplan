// Site Studio: a plot opened on its own. The plan on the left (draw and shape buildings), the live 3D view on the
// right, the numbers across the top, and the flat mix, parking, money, options and exports in a drawer under the
// plan. Nothing here touches the city map: it all lives on the plot.
import { Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { docVersion, readOnly, studio, studioLevel, studioSel, studioTool, toast } from '../editor/state';
import { isTyping } from '../editor/editor';
import { StudioCanvas } from '../editor/studiocanvas';
import { exportPlot } from '../editor/plotexport';
import { ui } from './ctx';
import { Icon, NumberField, Seg, Toggle } from './components';
import type { PlotObj } from '../doc/types';
import type { PlotReport } from '../doc/plot';
import { basementsToFit, buildingQuads, CARPET, roadFrame, FIRE_H, FIRE_W, PRESETS, presetBuildings, RG_FROM, RG_SHARE, SQFT, TRAVEL, UNIT_COLOR, UNIT_LABEL, type Costs, type PlotSite, type SiteReport } from '../doc/site';
import { generate, GOALS, type Goal, type Scheme } from '../doc/generate';
import { areaStatement, printReport, unitSchedule } from '../editor/plotreport';

const m2 = (v: number) => `${Math.round(v).toLocaleString('en-IN')} m²`;
const fx = (v: number) => (Math.round(v * 100) / 100).toString();
const cr = (v: number) => `₹${(v / 1e7).toLocaleString('en-IN', { maximumFractionDigits: Math.abs(v) >= 1e9 ? 0 : 1 })} Cr`;
const pc = (v: number) => `${Math.round(v * 100)} %`;

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

type Tab = 'generate' | 'flats' | 'parking' | 'site' | 'money' | 'options' | 'export';
const TABS: Record<Tab, string> = { generate: 'Generate', flats: 'Flats', parking: 'Parking', site: 'Site', money: 'Costs and returns', options: 'Options', export: 'Export' };

export function Studio() {
  const id = studio.value;
  void docVersion.value; // signals make components pure: re-render on every document change
  if (!id) return null;
  const o = ui.doc.get<'plot'>(id), r = ui.E.plot.report(id), d = ui.E.plot.layout(id), site = ui.E.plot.site(id);
  if (!o || !r || !d || !site) { ui.E.closeStudio(); return null; }
  return <StudioView o={o} r={r} d={d} site={site} />;
}

function StudioView({ o, r, d, site }: { o: PlotObj; r: PlotReport; d: SiteReport; site: PlotSite }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const cv = useRef<StudioCanvas | null>(null);
  const [tab, setTab] = useState<Tab>('flats');
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

  const setSite = (patch: Partial<PlotSite>, merge?: string) => {
    if (ro) return;
    ui.E.edit('Site', () => ui.doc.update(o.id, { site: { ...site, ...patch } }), merge);
  };
  const preset = (p: (typeof PRESETS)[number]['value']) => {
    const buildings = presetBuildings(r, p);
    if (!buildings.length) { toast('That shape doesn’t fit this envelope', 'warn'); return; }
    setSite({ buildings });
    studioSel.value = buildings[0].id;
  };
  const sel = d.buildings.find((b) => b.b.id === studioSel.value) ?? null;
  const levels = d.parking.levels;
  const lvName = (i: number) => { const l = levels[i], n = levels.slice(0, i + 1).filter((x) => x.kind === l.kind).length; return l.kind === 'stilt' ? 'Stilt' : l.kind === 'surface' ? 'Surface' : l.kind === 'podium' ? `P${n}` : `B${n}`; };
  const checks = [
    { ok: !d.over.margins, label: 'Margins', bad: 'A building is past the margins for its height' },
    { ok: !d.over.overlap, label: 'Spacing', bad: 'Buildings run into each other' },
    { ok: !d.over.fsi, label: 'FSI', bad: `${m2(-d.left)} over the permissible built-up area` },
    { ok: !d.over.height, label: 'Height', bad: `Over the ${fx(r.rules.maxH)} m limit` },
    { ok: d.parking.have >= d.parking.need, label: 'Parking', bad: `${d.parking.need - d.parking.have} bays short` },
    { ok: !d.over.fire, label: 'Fire access', bad: `No clear ${FIRE_W} m way round a building over ${FIRE_H} m` },
    { ok: !d.over.open, label: 'Open space', bad: `${m2(d.open.need - d.open.have)} short of the ${pc(RG_SHARE)} open space` },
  ];

  return (
    <div class="studio">
      <header class="studio-top">
        <button class="studio-back" onClick={() => ui.E.closeStudio()} title="Back to the map (Esc)"><Icon.back size={15} /> Map</button>
        <div class="studio-name"><b>{o.name}</b><small>{m2(r.area)} · {fx(r.roadW)} m road</small></div>
        <dl class="studio-metrics">
          <div><dt>Flats</dt><dd>{d.flats.toLocaleString('en-IN')}</dd><small>{d.count.slice(0, 3).map((n, t) => n > 0 && <span key={t}><i style={`background:${UNIT_COLOR[t]}`} />{n}</span>)}{d.count[3] > 0 && <span><i style={`background:${UNIT_COLOR[3]}`} />{d.count[3]}</span>}</small></div>
          <div class={d.over.fsi ? 'bad' : ''} title="Built-up area over plot area, ancillary included"><dt>FSI</dt><dd>{fx(d.fsi)}</dd><small>of {fx(r.bua / r.area)}</small></div>
          <div><dt>Coverage</dt><dd>{pc(d.coverage)}</dd><small>{m2(d.bua)} built</small></div>
          <div class={d.over.height ? 'bad' : ''}><dt>Height</dt><dd>{fx(d.height)} m</dd><small>{d.buildings.length ? Math.max(...d.buildings.map((b) => b.floors)) + d.under : 0} floors</small></div>
          <div class={d.parking.have < d.parking.need ? 'bad' : ''}><dt>Parking</dt><dd>{d.parking.have}/{d.parking.need}</dd><small>bays</small></div>
          <div class={d.money.profit < 0 ? 'bad' : ''}><dt>Profit</dt><dd>{cr(d.money.profit)}</dd><small>{pc(d.money.margin)} margin</small></div>
          <div class={d.money.irr === null || d.money.irr < 0 ? 'bad' : ''} title="Annual return on the cash put in, month by month"><dt>IRR</dt><dd>{d.money.irr === null ? '–' : pc(d.money.irr)}</dd><small>{cr(d.money.peak)} peak in</small></div>
        </dl>
        <div class="studio-checks">
          {checks.map((c) => <span key={c.label} class={c.ok ? 'ok' : 'bad'} title={c.ok ? `${c.label}: fine` : c.bad}>{c.ok ? '✓' : '!'} {c.label}</span>)}
        </div>
      </header>

      <section class="studio-left">
        <div class="studio-tools">
          <div class="seg small">
            <button class={studioTool.value === 'select' ? 'on' : ''} title="Select, move and shape (V)" onClick={() => { studioTool.value = 'select'; }}><Icon.select size={14} /></button>
            <button class={studioTool.value === 'draw' ? 'on' : ''} title="Draw a building: click its spine, Enter to finish (B)" disabled={ro} onClick={() => { studioTool.value = 'draw'; studioSel.value = null; }}><Icon.spine size={14} /> Building</button>
          </div>
          <div class="seg small" title="Start from a shape (replaces the buildings)">
            {PRESETS.map((p) => <button key={p.value} title={p.title} disabled={ro} onClick={() => preset(p.value)}>{p.label}</button>)}
          </div>
          <span class="spacer" />
          {levels.length > 0 && <Seg small value={String(studioLevel.value)} onChange={(v) => { studioLevel.value = +v; }} options={[{ value: '-1', label: 'Flats' }, ...levels.map((l, i) => ({ value: String(i), label: lvName(i), title: `${l.bays.length} bays` }))]} />}
          <button class="icon" title="Fit the plot" onClick={() => cv.current?.fit()}><Icon.fit size={14} /></button>
        </div>
        <div class="studio-plan">
          <canvas ref={ref} />
          {studioTool.value === 'draw' && <p class="studio-hint">Click the building's spine, node by node · Enter or double-click finishes · Backspace drops the last · Shift: no snapping</p>}
          {sel && studioTool.value === 'select' && (
            <div class="studio-card">
              <div class="studio-card-head"><b>Building</b>{sel.clash && <span class="bad">{sel.clash === 'margins' ? 'past the margins' : 'runs into another'}</span>}</div>
              <div class="grid2">
                <NumberField label="Depth" unit="m" step={0.5} min={6} max={40} value={sel.b.depth} disabled={ro} title="14 m and deeper: flats both sides of the corridor"
                  onChange={(v, m) => setSite({ buildings: site.buildings.map((b) => (b.id === sel.b.id ? { ...b, depth: v } : b)) }, m)} />
                <NumberField label="Floors" digits={0} step={1} min={0} max={120} value={sel.b.floors || sel.floors} state={sel.b.floors ? 'own' : 'base'} disabled={ro}
                  title={`Floors of flats; 0 = as many as the FSI allows (the envelope takes ${sel.maxFloors})`}
                  onChange={(v, m) => setSite({ buildings: site.buildings.map((b) => (b.id === sel.b.id ? { ...b, floors: Math.max(0, Math.round(v)) } : b)) }, m)} />
              </div>
              <p class="small muted">{m2(sel.plate)} a floor · {sel.perFloor.reduce((a, b) => a + b, 0)} flats a floor · {sel.cores.length} core{sel.cores.length === 1 ? '' : 's'} · {fx(sel.height)} m
                {sel.b.floors > 0 && <> · <button class="link small" disabled={ro} onClick={() => setSite({ buildings: site.buildings.map((b) => (b.id === sel.b.id ? { ...b, floors: 0 } : b)) })}>fill the FSI</button></>}</p>
              <div class="btns">
                <button disabled={ro} onClick={() => { const b = site.buildings.find((x) => x.id === sel.b.id); if (b) cv.current?.duplicate(b); }} title="Ctrl+D"><Icon.copy size={13} /> Duplicate</button>
                <button class="danger" disabled={ro} onClick={() => cv.current?.remove(sel.b.id)} title="Delete"><Icon.trash size={13} /> Remove</button>
              </div>
            </div>
          )}
          {!d.buildings.length && studioTool.value === 'select' && <p class="studio-hint">No buildings: draw one, or start from a shape above.</p>}
        </div>
        <nav class="studio-tabs">
          {(Object.keys(TABS) as Tab[]).map((t) => <button key={t} class={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{TABS[t]}</button>)}
        </nav>
        <div class="studio-drawer">
          {tab === 'generate' && <GenerateTab o={o} r={r} d={d} site={site} setSite={setSite} ro={ro} />}
          {tab === 'flats' && <FlatsTab o={o} d={d} site={site} setSite={setSite} ro={ro} />}
          {tab === 'parking' && <ParkingTab o={o} r={r} d={d} site={site} setSite={setSite} ro={ro} />}
          {tab === 'site' && <SiteTab o={o} r={r} d={d} site={site} setSite={setSite} ro={ro} />}
          {tab === 'money' && <MoneyTab d={d} site={site} setSite={setSite} ro={ro} />}
          {tab === 'options' && <OptionsTab o={o} d={d} site={site} setSite={setSite} ro={ro} />}
          {tab === 'export' && (
            <div>
              <p class="small muted">The plot, the buildings and the site around them (ground, roads, buildings), in metres from the plot's centre.</p>
              <div class="btns">
                <button onClick={() => exportPlot(ui.E, o.id, 'dxf')} title="AutoCAD, BricsCAD: plan layers, and the massing as 3D faces">DXF</button>
                <button onClick={() => exportPlot(ui.E, o.id, 'obj')} title="Rhino, SketchUp, Blender, Revit">OBJ</button>
                <button onClick={() => exportPlot(ui.E, o.id, 'glb')} title="glTF binary: Blender, three.js, Unreal, Unity">glTF</button>
              </div>
              <p class="small muted">The numbers: the area statement as the approval drawings carry it, every flat by building and floor, and a report to print or save as PDF.</p>
              <div class="btns">
                <button onClick={() => areaStatement(o, r, d)} title="Plot, DP road, FSI by source, built-up area by building, parking, open space (CSV, opens in Excel)">Area statement</button>
                <button onClick={() => unitSchedule(o, d)} title="Every flat: building, floor, type, carpet (CSV)">Unit schedule</button>
                <button onClick={() => printReport(o, r, d, ref.current)} title="The plan, the numbers and the checks on a page: print, or save as PDF">Report</button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

type TabProps = { o: PlotObj; d: SiteReport; site: PlotSite; setSite: (p: Partial<PlotSite>, merge?: string) => void; ro: boolean };

function FlatsTab({ o, d, site, setSite, ro }: TabProps) {
  if (o.use === 'commercial') return <p class="small muted">Commercial floors: an office between each pair of cores, {Math.round(CARPET * 100)} % of it carpet. Switch the plot to residential (in its panel on the map) for flats.</p>;
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
          <NumberField key={t} unit="m²" digits={0} step={1} min={20} max={300} value={site.sizes[t]} disabled={ro}
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
        <Toggle checked={!!site.surface} disabled={ro} onChange={(v) => setSite({ surface: v || undefined })} label="Surface bays" title={`Bays on the open ground, clear of the buildings and the fire tender's ${FIRE_W} m way round the tall ones`} />
        <NumberField label="Podium levels" digits={0} step={1} min={0} max={8} value={site.podium} disabled={ro} onChange={(v, m) => setSite({ podium: Math.round(v) }, m)} title="Parking floors over the whole envelope under the flats (they add to the height)" />
        <NumberField label="Basements" digits={0} step={1} min={0} max={6} value={site.basements} disabled={ro} onChange={(v, m) => setSite({ basements: Math.round(v) }, m)} title="Under the plot, 1.5 m in from its edges" />
      </div>
      <dl class="kv plot-calc">
        <dt>Cars · {o.use === 'commercial' ? '1 per 100 m² carpet' : 'by flat size'}, + 5 % visitors</dt><dd>{P.cars}</dd>
        <dt>Two-wheelers · four to a bay</dt><dd>{P.scooters}</dd>
        {P.levels.map((l, i) => <Fragment key={i}><dt><button class="link" onClick={() => { studioLevel.value = i; }}>{{ stilt: 'Stilt', surface: 'Surface', podium: 'Podium', basement: 'Basement' }[l.kind]}</button></dt><dd>{l.bays.length} bays</dd></Fragment>)}
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
          <NumberField key={x.k} label={x.label} unit={x.unit} digits={0} step={x.step} min={0} max={1e6} value={K[x.k]} title={x.title} disabled={ro}
            state={site.cost[x.k] !== undefined ? 'own' : 'base'} onChange={(v, m) => setSite({ cost: { ...site.cost, [x.k]: v } }, m)} />
        ))}
      </div>
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

/** A scheme's plan, small: the plot and its buildings, the road along the bottom. */
function Thumb({ r, s }: { r: PlotReport; s: Scheme }) {
  const F = roadFrame(r), R = F.toL(r.net.length >= 6 ? r.net : r.footprint);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < R.length; i += 2) { x0 = Math.min(x0, R[i]); x1 = Math.max(x1, R[i]); z0 = Math.min(z0, -R[i + 1]); z1 = Math.max(z1, -R[i + 1]); }
  const loc = (q: number[]) => (q === R ? q : F.toL(q));
  const pts = (q: number[]) => loc(q).map((v, i) => (i % 2 ? -v - z0 : v - x0).toFixed(1)).join(' ');
  return (
    <svg viewBox={`-2 -2 ${x1 - x0 + 4} ${z1 - z0 + 4}`} class="scheme-thumb" aria-hidden="true">
      <polygon points={pts(R)} class="t-plot" />
      {s.d.parking.levels.find((l) => l.kind === 'surface')?.bays.map((q, i) => <polygon key={`p${i}`} points={pts(q)} class="t-bay" />)}
      {s.site.buildings.flatMap((b) => buildingQuads(b)).map((q, i) => <polygon key={i} points={pts(q)} class="t-bldg" />)}
    </svg>
  );
}

// the last run, kept while the studio's open on the plot
let lastRun: { id: string; goal: Goal; strict: boolean; list: Scheme[] } | null = null;
const schemeKey = (s: PlotSite) => JSON.stringify(s.buildings.map((b) => [b.spine, b.depth])) + s.basements + !!s.surface;

function GenerateTab({ o, r, site, setSite, ro }: TabProps & { r: PlotReport }) {
  const prev = lastRun?.id === o.id ? lastRun : null;
  const [goal, setGoal] = useState<Goal>(prev?.goal ?? 'profit');
  const [strict, setStrict] = useState(prev?.strict ?? true);
  const [list, setList] = useState<Scheme[] | null>(prev?.list ?? null);
  const [busy, setBusy] = useState<number | null>(null);
  const run = async () => {
    setBusy(0);
    const out = await generate(r, site, o.use, goal, strict, (a, b) => setBusy(a / b));
    lastRun = { id: o.id, goal, strict, list: out };
    setList(out); setBusy(null);
  };
  const cur = schemeKey(site), opts = o.options ?? [];
  const keep = (s: Scheme): PlotSite => ({ ...s.site, mix: site.mix, sizes: site.sizes, cost: site.cost });
  const pass = list?.filter((s) => !s.fails.length).length ?? 0;
  return (
    <div>
      <div class="gen-bar">
        <Seg small value={goal} onChange={(v) => setGoal(v as Goal)} options={GOALS} />
        <Toggle checked={strict} onChange={setStrict} label="Fire access and open space" title={`Count the fire tender's ${FIRE_W} m way round buildings over ${FIRE_H} m, and the ${pc(RG_SHARE)} open space on plots of ${m2(RG_FROM)} and more`} />
        <span class="spacer" />
        <button class="primary" disabled={ro || busy !== null} onClick={run}>{busy !== null ? `Working ${Math.round(busy * 100)} %` : list ? 'Generate again' : 'Generate'}</button>
      </div>
      {!list && <p class="small muted">Every shape (bar, L, U, courtyard, towers) at a range of depths, each parked on stilts and basements, then with surface bays as well, with as many basements as the parking needs. Ranked by your goal; schemes that break a rule go last. Your flat mix, sizes and rates carry over.</p>}
      {list && <p class="small muted">{list.length} schemes, {pass} within every rule. Click one to use it.</p>}
      {list && (
        <div class="schemes">
          {list.slice(0, 24).map((s, i) => (
            <div key={i} class={`scheme${schemeKey(s.site) === cur ? ' on' : ''}${s.fails.length ? ' fails' : ''}`}>
              <button class="scheme-pick" disabled={ro} title="Use this scheme" onClick={() => { setSite(keep(s)); studioSel.value = null; studioLevel.value = -1; }}>
                <Thumb r={r} s={s} />
                <span class="scheme-name">{s.name}</span>
                <b>{goal === 'flats' ? `${s.d.flats} flats` : goal === 'carpet' ? `${Math.round(s.d.carpet * SQFT).toLocaleString('en-IN')} ft²` : goal === 'irr' ? (s.d.money.irr === null ? 'IRR –' : `IRR ${pc(s.d.money.irr)}`) : cr(s.d.money.profit)}</b>
                <small>{s.d.flats} flats · FSI {fx(s.d.fsi)} · {fx(s.d.height)} m · {s.site.basements} bsmt</small>
                {s.fails.length > 0 && <small class="bad">{s.fails.join(', ')}</small>}
              </button>
              <button class="link small" disabled={ro} title="Keep it with the plot's options" onClick={() => ui.E.edit('Plot options', () => ui.doc.update(o.id, { options: [...opts, { name: s.name, site: keep(s) }] }))}>Save</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SiteTab({ o, r, d }: TabProps & { r: PlotReport }) {
  const tall = d.buildings.filter((b) => b.fire.length);
  const side = d.height > r.rules.sideTo ? Math.min(12, Math.max(r.rules.side, d.height / 5)) : r.rules.side;
  return (
    <div>
      <dl class="kv plot-calc">
        <dt>Plot · after the DP road</dt><dd>{m2(r.area)} · {m2(r.netArea)}</dd>
        <dt>Ground coverage</dt><dd>{pc(d.coverage)}</dd>
        <dt>Open ground · not built or parked on</dt><dd>{m2(d.open.have)}</dd>
        <dt>Recreational open space needed</dt><dd class={d.over.open ? 'bad' : ''}>{d.open.need ? m2(d.open.need) : `none under ${m2(RG_FROM)}`}</dd>
        <dt>Fire tender's way round</dt><dd class={d.over.fire ? 'bad' : ''}>{tall.length ? `${tall.filter((b) => b.fireOk).length} of ${tall.length} clear` : `no building over ${FIRE_H} m`}</dd>
        <dt>Margins at {fx(d.height)} m</dt><dd>front {fx(r.rules.front)} m · sides {fx(side)} m</dd>
      </dl>
      <p class="small muted">Buildings over {FIRE_H} m need a clear {FIRE_W} m motorable way round them for a fire tender (NBC 2016 Part 4), on the plot or out over the road it fronts: dashed on the plan, red where it's blocked. Plots of {m2(RG_FROM)} and more keep {pc(RG_SHARE)} as recreational open space (UDCPR 3.5.1).{o.use === 'commercial' ? ' Not asked of commercial plots here.' : ''}</p>
    </div>
  );
}
