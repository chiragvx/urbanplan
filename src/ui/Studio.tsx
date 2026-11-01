// Site Studio: a plot opened on its own. The plan on the left (draw and shape buildings), the live 3D view on the
// right, the numbers across the top, and the flat mix, parking, money, options and exports in a drawer under the
// plan. Nothing here touches the city map: it all lives on the plot.
import { Fragment } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { docVersion, readOnly, studio, studioGround, studioLevel, studioLook, studioSel, studioTool, toast } from '../editor/state';
import { isTyping } from '../editor/editor';
import { StudioCanvas } from '../editor/studiocanvas';
import { exportPlot } from '../editor/plotexport';
import { ui } from './ctx';
import { Icon, NumberField, Seg, Toggle } from './components';
import type { PlotObj } from '../doc/types';
import { USE_NOTE, type PlotReport, type PlotUse } from '../doc/plot';
import { basementsToFit, buildingQuads, CARPET, ELEMENTS, elementRings, GATES_FROM, roadFrame, FIRE_H, FIRE_W, PRESETS, presetBuildings, RG_FROM, RG_SHARE, SQFT, TRAVEL, UNIT_COLOR, UNIT_LABEL, type Costs, type PlotSite, type SiteElement, type SiteReport } from '../doc/site';
import { ACCESS, DEFAULT_DESIGN, schemes, siteDefaults, type Access, TYPOLOGIES, type Design, type Typology } from '../doc/optimise';
import { totalWidth } from '../doc/xsection';
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

type Tab = 'roads' | 'design' | 'flats' | 'parking' | 'site' | 'money' | 'options' | 'export';
const TABS: Record<Tab, string> = { roads: 'Roads', design: 'Design', flats: 'Flats', parking: 'Parking', site: 'Site', money: 'Costs and returns', options: 'Options', export: 'Export' };

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
  const preset = (p: (typeof PRESETS)[number]['value']) => {
    const buildings = presetBuildings(r, p);
    if (!buildings.length) { toast('That shape doesn’t fit this envelope', 'warn'); return; }
    setSite({ buildings, manual: true, rg: undefined });
    studioSel.value = buildings[0].id;
  };
  const sel = d.buildings.find((b) => b.b.id === studioSel.value) ?? null;
  const selEl = site.elements?.find((e) => e.id === studioSel.value) ?? null;
  const levels = d.parking.levels;
  const lvName = (i: number) => { const l = levels[i], n = levels.slice(0, i + 1).filter((x) => x.kind === l.kind).length; return l.kind === 'stilt' ? 'Stilt' : l.kind === 'surface' ? 'Surface' : l.kind === 'lot' ? `Lot ${n}` : l.kind === 'structure' ? `C${n}` : l.kind === 'podium' ? `P${n}` : `B${n}`; };
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
          <div><dt>{o.use === 'residential' ? 'Flats' : o.use === 'industrial' ? 'Shed floors' : 'Offices'}</dt><dd>{d.flats.toLocaleString('en-IN')}</dd><small>{d.count.slice(0, 3).map((n, t) => n > 0 && <span key={t}><i style={`background:${UNIT_COLOR[t]}`} />{n}</span>)}{d.count[3] > 0 && <span><i style={`background:${UNIT_COLOR[3]}`} />{d.count[3]}</span>}</small></div>
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
          <button title="Over the plot" onClick={() => ui.E.studioView('aerial')}>Aerial</button>
          <button title="At eye level from the street" onClick={() => ui.E.studioView('street')}>Street</button>
          <button title="Straight down" onClick={() => ui.E.studioView('top')}>Top</button>
        </div>
      </div>

      <section class="studio-left">
        <div class="studio-tools">
          <div class="seg small">
            <button class={studioTool.value === 'select' ? 'on' : ''} title="Select, move and shape (V)" onClick={() => { studioTool.value = 'select'; }}><Icon.select size={14} /></button>
            <button class={studioTool.value === 'draw' ? 'on' : ''} title="Draw a building: click its spine, Enter to finish (B)" disabled={ro} onClick={() => { studioTool.value = 'draw'; studioSel.value = null; }}><Icon.spine size={14} /> Building</button>
          </div>
          <div class="seg small" title="Add to the site: click to place (a road: click its line, Enter to finish)">
            {ELEMENTS.map((x) => <button key={x.value} class={studioTool.value === x.value ? 'on' : ''} title={x.title} disabled={ro} onClick={() => { studioTool.value = x.value; studioSel.value = null; }}>{x.label}</button>)}
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
          <Impact o={o} r={r} d={d} ro={ro} />
          {(studioTool.value === 'draw' || studioTool.value === 'road') && <p class="studio-hint">Click the {studioTool.value === 'road' ? 'road' : 'building'}'s line, node by node · Enter or double-click finishes · Backspace drops the last · Shift: no snapping</p>}
          {studioTool.value !== 'select' && studioTool.value !== 'draw' && studioTool.value !== 'road' && <p class="studio-hint">Click where it goes · then drag, turn and size it like a building</p>}
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
          {selEl && studioTool.value === 'select' && (() => {
            const m = ELEMENTS.find((x) => x.value === selEl.kind)!;
            const len = Math.hypot(selEl.spine[2] - selEl.spine[0], selEl.spine[3] - selEl.spine[1]);
            const setEl = (patch: Partial<SiteElement>, mg?: string) => setSite({ elements: (site.elements ?? []).map((e) => (e.id === selEl.id ? { ...e, ...patch, auto: undefined } : e)), manual: true }, mg);
            // a new length: the first wing stretched about its middle
            const setLen = (L: number, mg?: string) => {
              const [ax, az, bx, bz] = selEl.spine, mx = (ax + bx) / 2, mz = (az + bz) / 2, ux = (bx - ax) / (len || 1), uz = (bz - az) / (len || 1);
              setEl({ spine: [mx - (ux * L) / 2, mz - (uz * L) / 2, mx + (ux * L) / 2, mz + (uz * L) / 2, ...selEl.spine.slice(4)].map((v) => Math.round(v * 100) / 100) }, mg);
            };
            const bays = selEl.kind === 'parking' ? d.parking.levels.filter((l) => l.kind === 'structure').reduce((a, l) => a + l.bays.length, 0) : selEl.kind === 'lot' ? d.parking.levels.filter((l) => l.kind === 'lot').reduce((a, l) => a + l.bays.length, 0) : 0;
            return (
              <div class="studio-card">
                <div class="studio-card-head"><b>{m.label}</b>{selEl.auto && <span class="muted small">laid by the optimiser</span>}</div>
                <div class="grid3">
                  {selEl.kind !== 'road' && selEl.kind !== 'roundabout' && <NumberField label="Length" unit="m" step={1} min={6} max={400} value={Math.round(len)} disabled={ro} onChange={(v, mg) => setLen(v, mg)} />}
                  <NumberField label={selEl.kind === 'roundabout' ? 'Across' : selEl.kind === 'road' ? 'Width' : 'Depth'} unit="m" step={0.5} min={3} max={200} value={selEl.depth} disabled={ro} onChange={(v, mg) => setEl({ depth: v }, mg)} />
                  {selEl.kind === 'parking' && <NumberField label="Levels" digits={0} step={1} min={1} max={12} value={selEl.levels ?? 3} disabled={ro} onChange={(v, mg) => setEl({ levels: Math.max(1, Math.round(v)) }, mg)} />}
                </div>
                <p class="small muted">{m.title}{bays ? ` · ${bays} bays in all` : ''}</p>
                <div class="btns">
                  <button disabled={ro} onClick={() => cv.current?.duplicate(selEl)} title="Ctrl+D"><Icon.copy size={13} /> Duplicate</button>
                  <button class="danger" disabled={ro} onClick={() => cv.current?.remove(selEl.id)} title="Delete"><Icon.trash size={13} /> Remove</button>
                </div>
              </div>
            );
          })()}
          {!d.buildings.length && studioTool.value === 'select' && <p class="studio-hint">No buildings: draw one, or start from a shape above.</p>}
        </div>
        <nav class="studio-tabs">
          {(Object.keys(TABS) as Tab[]).map((t) => <button key={t} class={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{TABS[t]}</button>)}
        </nav>
        <div class="studio-drawer">
          {tab === 'roads' && <RoadsTab o={o} r={r} ro={ro} />}
          {tab === 'design' && <DesignTab o={o} r={r} d={d} site={site} setSite={setSite} ro={ro} />}
          {tab === 'flats' && <FlatsTab o={o} r={r} d={d} site={site} setSite={setSite} ro={ro} />}
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
                <button onClick={() => printReport(o, r, d, ref.current, ui.E.engine.snapshot())} title="The plan, the numbers and the checks on a page: print, or save as PDF">Report</button>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

type TabProps = { o: PlotObj; d: SiteReport; site: PlotSite; setSite: (p: Partial<PlotSite>, merge?: string) => void; ro: boolean };

function FlatsTab({ o, r, d, site, setSite, ro }: TabProps & { r: PlotReport }) {
  if (o.use !== 'residential') {
    const units = d.count[3];
    return (
      <div>
        <dl class="kv plot-calc">
          <dt>{o.use === 'industrial' ? 'Shed floors' : 'Office units'} · all buildings, all floors</dt><dd>{units.toLocaleString('en-IN')}</dd>
          <dt>Built-up area · {d.buildings.length} building{d.buildings.length === 1 ? '' : 's'}</dt><dd>{m2(d.bua)}</dd>
          <dt>Carpet · {d.bua ? pc(d.carpet / d.bua) : '–'} of built-up</dt><dd>{m2(d.carpet)}</dd>
          <dt><b>Saleable</b></dt><dd><b>{Math.round(d.carpet * SQFT).toLocaleString('en-IN')} ft²</b></dd>
        </dl>
        <p class="small muted">{o.use === 'industrial'
          ? `Sheds: one open floor per wing, ${fx(r.rules.floorH)} m clear, no cores or corridor; 92 % of it usable.`
          : `Offices: an open floor plate between each pair of cores, ${Math.round(CARPET * 100)} % of it carpet, on ${fx(r.rules.floorH)} m floors.`} Switch the use on the Design tab.</p>
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
        <Toggle checked={!!site.surface} disabled={ro} onChange={(v) => setSite({ surface: v, surfacePick: v })} label="Surface bays" title={`Bays on the open ground, clear of the buildings and the fire tender's ${FIRE_W} m way round the tall ones`} />
        <NumberField label="Podium levels" digits={0} step={1} min={0} max={8} value={site.podium} disabled={ro} onChange={(v, m) => setSite({ podium: Math.round(v) }, m)} title="Parking floors over the whole envelope under the flats (they add to the height)" />
        <NumberField label="Basements" digits={0} step={1} min={0} max={6} value={site.basements} disabled={ro || !site.manual} state={site.manual ? 'own' : 'base'} onChange={(v, m) => setSite({ basements: Math.round(v) }, m)} title={site.manual ? 'Under the plot, 1.5 m in from its edges' : 'As many as the parking needs: worked out'} />
      </div>
      <dl class="kv plot-calc">
        <dt>Cars · {o.use === 'industrial' ? '1 per 300 m² carpet' : o.use === 'commercial' ? '1 per 100 m² carpet' : 'by flat size'}, + 5 % visitors</dt><dd>{P.cars}</dd>
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

function DesignTab({ o, r, site, setSite, ro }: TabProps & { r: PlotReport }) {
  const design = site.design ?? DEFAULT_DESIGN;
  const setDesign = (patch: Partial<Design>, merge?: string) => setSite({ design: { ...design, ...patch }, manual: undefined }, merge);
  const list = schemes(r, design.type === 'auto' ? design : { ...design, type: 'auto' }, o.use, (site.stilt ? 1 : 0) + site.podium, site);
  const shed = o.use === 'industrial', noun = (t: string) => (shed ? 'shed' : t === 'tower' ? 'tower' : o.use === 'commercial' ? 'block' : 'slab');
  const name = (s: (typeof list)[number]) => `${s.buildings.length} ${noun(s.type)}${s.buildings.length === 1 ? '' : 's'} · ${s.floors} floor${s.floors === 1 ? '' : 's'}`;
  const setUse = (v: PlotUse) => ui.E.edit('Plot use', () => ui.doc.update(o.id, { use: v, site: site.manual ? site : { ...siteDefaults(v), design, cost: site.cost } }));
  const cur = site.manual ? null : (design.type === 'auto' ? list[0]?.type : design.type);
  return (
    <div>
      <div class={`design-state${site.manual ? ' manual' : ''}`}>
        {site.manual
          ? <><span><b>Shaped by hand.</b> The optimiser leaves it alone until you ask it again.</span><button class="primary" disabled={ro} onClick={() => { setSite({ manual: undefined }); studioSel.value = null; }}>Re-optimise</button></>
          : <span><b>Optimised for the most built-up area</b> within the rules: {m2(r.bua)} allowed. Change a setting and it plans again; drag a building to take over.</span>}
      </div>
      <label class="field-label">Use<Seg small value={o.use} onChange={(v) => !ro && setUse(v as PlotUse)} options={[
        { value: 'residential', label: 'Residential', title: USE_NOTE.residential }, { value: 'commercial', label: 'Commercial', title: USE_NOTE.commercial },
        { value: 'industrial', label: 'Industrial', title: USE_NOTE.industrial },
      ]} /></label>
      {o.use !== 'residential' && <p class="small muted">{USE_NOTE[o.use]}</p>}
      <div class="grid3">
        <label class="field-label">Buildings<Seg small value={shed ? 'auto' : design.type} onChange={(v) => setDesign({ type: v as Typology })} options={shed ? [{ value: 'auto', label: 'Sheds', title: 'Sheds as deep as the zone allows' }] : TYPOLOGIES} /></label>
        <NumberField label="Most floors" digits={0} step={1} min={0} max={80} value={design.maxFloors} disabled={ro} title="Floors at most (over the stilt); 0: as the height limit allows" onChange={(v, m) => setDesign({ maxFloors: Math.max(0, Math.round(v)) }, m)} />
        <NumberField label="Most buildings" digits={0} step={1} min={0} max={20} value={design.maxBuildings} disabled={ro} title="0: as many as fit" onChange={(v, m) => setDesign({ maxBuildings: Math.max(0, Math.round(v)) }, m)} />
      </div>
      <label class="field-label">Internal roads<Seg small value={design.access ?? 'perimeter'} onChange={(v) => setDesign({ access: v as Access })} options={ACCESS} /></label>
      <div class="grid3">
        <NumberField label="Extra spacing" unit="m" digits={0} step={1} min={0} max={60} value={design.spacing ?? 0} disabled={ro} title="More room between buildings than the rules ask" onChange={(v, m) => setDesign({ spacing: Math.max(0, Math.round(v)) }, m)} />
        <NumberField label="Green" unit="%" digits={0} step={1} min={0} max={60} value={design.green ?? 0} disabled={ro} title="Share of the plot kept as garden at least (the open space the rules ask is kept anyway)" onChange={(v, m) => setDesign({ green: Math.max(0, Math.round(v)) }, m)} />
        <Toggle checked={!!design.roundabouts} disabled={ro || !design.access || design.access === 'perimeter' || design.access === 'none'} onChange={(v) => setDesign({ roundabouts: v || undefined })} label="Roundabouts" title="A turning circle at each road's end and a roundabout where roads cross" />
      </div>
      {list.length > 0 && (
        <div class="schemes two">
          {list.map((s) => (
            <div key={s.type} class={`scheme${cur === s.type ? ' on' : ''}`}>
              <button class="scheme-pick" disabled={ro} title={`Use ${noun(s.type)}s`} onClick={() => { setDesign({ type: s.type }); studioSel.value = null; studioLevel.value = -1; }}>
                <Thumb r={r} buildings={s.buildings} rg={s.rg} roads={s.roads} />
                <span class="scheme-name">{noun(s.type)[0].toUpperCase() + noun(s.type).slice(1)}s{s === list[0] ? ' · most built-up' : ''}</span>
                <b>{m2(s.bua)} <small>{pc(s.bua / r.bua)} of allowed</small></b>
                <small>{name(s)} · {fx((s.floors + (site.stilt ? 1 : 0) + site.podium) * r.rules.floorH)} m · FSI {fx(s.bua / r.area)}</small>
              </button>
            </div>
          ))}
        </div>
      )}
      <p class="small muted">Buildings keep the margins for their height and, above {FIRE_H} m, {FIRE_W} m from the plot's other sides for the fire tender's drive; the gap between them is the taller one's side margin (at least {FIRE_W} m). Plots of {m2(RG_FROM)} and more keep {pc(RG_SHARE)} as open space at the back. Mid-rise slabs come first in Pune, towers in Mumbai; either way it's the one that builds the most.</p>
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
      <p class="small muted">Buildings over {FIRE_H} m need a clear {FIRE_W} m motorable way round them for a fire tender (NBC 2016 Part 4), on the plot or out over the road it fronts: dashed on the plan, red where it's blocked. Plots of {m2(RG_FROM)} and more keep {pc(RG_SHARE)} as recreational open space (UDCPR 3.5.1).{o.use !== 'residential' ? ` Not asked of ${o.use} plots here.` : ''}</p>
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
                <td><NumberField unit="m" step={0.5} min={3} max={90} value={x.today} disabled={ro} state={o.roadEdits?.[x.id]?.width !== undefined ? 'own' : 'base'} onChange={(v, mg) => setRoadEdit(o, x.id, { width: v }, mg)} /></td>
                <td><NumberField unit="m" step={1} min={0} max={90} value={x.dp ?? 0} disabled={ro} state={o.roadEdits?.[x.id]?.reserve !== undefined ? 'own' : 'base'} title="0: no DP width" onChange={(v, mg) => setRoadEdit(o, x.id, { reserve: Math.round(v) }, mg)} /></td>
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
