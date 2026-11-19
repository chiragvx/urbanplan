// UrbanPlan Pro (/pro/): the full planning workspace, beside the simple editor (/app/). A project is a plot and its
// roads, the rules it falls under, and the builder's design system; the generator builds the scheme straight away
// and everything follows from it: the 3D view with every window and door at its catalog size, the area and money
// figures, the departures from the rules, the light and ventilation check and the door and window schedule.
// Kept in this browser (localStorage) and, signed in, in the account's projects a few seconds behind (./cloud.ts).
import { render } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import '../theme/tokens.css';
import './pro.css';
import { CITIES, DEFAULT_PROJECT, generate, outline, plotReport, roadLines, type ProProject } from './project';
import { PlotEditor } from './PlotEditor';
import { deletePro, listPro, openPro, savePro, toText, type CloudRef } from './cloud';
import { authReady, explain, peekSession, session, startAuth } from '../auth/auth';
import type { Project } from '../app/cloud';
import { clone, presetOf, PRESETS, SPEC, specRate, type BalconyKind, type DesignSystem, type DoorType, type Railing, type WindowType } from './design';
import { planFloor, schedule } from './openings';
import { ProView, type Picked } from './scene';
import { CARPET, SQFT, UNIT_COLOR, UNIT_LABEL } from '../doc/site';
import { TYPOLOGIES, type Typology } from '../doc/optimise';

const KEY = 'urbanplan:pro:project';
function load(): ProProject {
  try { const p = JSON.parse(localStorage.getItem(KEY) || 'null'); if (p?.v === 1) return { ...DEFAULT_PROJECT, ...p }; } catch { /* a fresh project */ }
  return DEFAULT_PROJECT;
}
const save = (p: ProProject) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* not kept */ } };
const REF = 'urbanplan:pro:cloud';
const loadRef = (): CloudRef => { try { return JSON.parse(localStorage.getItem(REF) || 'null'); } catch { return null; } };
const saveRef = (r: CloudRef) => { try { localStorage.setItem(REF, JSON.stringify(r)); } catch { /* not kept */ } };
const BASE = import.meta.env.BASE_URL;
const hhmm = (d = new Date()) => d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
const ago = (iso: string) => `${new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${hhmm(new Date(iso))}`;

/** The account's Pro projects: open one, start a new one, delete (two clicks). */
function Projects({ current, open, fresh, close }: { current: string | null; open: (id: string) => void; fresh: () => void; close: () => void }) {
  const [list, setList] = useState<Project[] | null>(null);
  const [err, setErr] = useState('');
  const [sure, setSure] = useState('');
  const reload = () => listPro().then(setList, (e) => setErr(explain(e)));
  useEffect(() => { void reload(); }, []);
  const del = async (id: string) => {
    if (sure !== id) { setSure(id); return; }
    try { await deletePro(id); setSure(''); void reload(); } catch (e) { setErr(explain(e)); }
  };
  return (
    <div class="pro-menu" role="dialog" aria-label="Your projects">
      <div class="pro-menu-head"><b>Your projects</b><button class="pbtn primary" onClick={fresh}>New project</button></div>
      {err && <p class="ped-err">{err}</p>}
      {!list && !err && <p class="pro-note">Loading…</p>}
      {list && !list.length && <p class="pro-note">None yet: this one is saved here as you work.</p>}
      {list && list.length > 0 && <ul>{list.map((x) => (
        <li class={x.id === current ? 'on' : ''}>
          <button class="pro-proj" onClick={() => open(x.id)}><b>{x.name}</b><span>{x.region.replace('pro:', '').replace('-', ' ')} · {ago(x.updated_at)}</span></button>
          <button class="pbtn small" onClick={() => void del(x.id)}>{sure === x.id ? 'Delete?' : 'Delete'}</button>
        </li>
      ))}</ul>}
      <button class="linkbtn" onClick={close}>Close</button>
    </div>
  );
}

const nf = (v: number, d = 0) => v.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: d });
const sqft = (m2: number) => `${nf(m2 * SQFT)} sq ft`;
const cr = (rs: number) => `₹${nf(rs / 1e7, 2)} cr`;

function Num({ label, value, set, step = 1, min = 0, max = 9999, unit }: { label: string; value: number; set: (v: number) => void; step?: number; min?: number; max?: number; unit?: string }) {
  return (
    <label class="pf">
      <span>{label}</span>
      <span class="pf-in">
        <input type="number" value={value} step={step} min={min} max={max} onChange={(e) => { const v = parseFloat((e.target as HTMLInputElement).value); if (Number.isFinite(v)) set(Math.min(max, Math.max(min, v))); }} />
        {unit && <i>{unit}</i>}
      </span>
    </label>
  );
}
function Seg<T extends string>({ value, set, options }: { value: T; set: (v: T) => void; options: { value: T; label: string; title?: string }[] }) {
  return <div class="pseg" role="group">{options.map((o) => <button type="button" title={o.title} aria-pressed={o.value === value} onClick={() => set(o.value)}>{o.label}</button>)}</div>;
}
function Color({ label, value, set }: { label: string; value: string; set: (v: string) => void }) {
  return <label class="pf pf-color"><span>{label}</span><input type="color" value={value} onInput={(e) => set((e.target as HTMLInputElement).value)} /></label>;
}
function Toggle({ label, value, set }: { label: string; value: boolean; set: (v: boolean) => void }) {
  return <label class="pcheck"><input type="checkbox" checked={value} onChange={(e) => set((e.target as HTMLInputElement).checked)} /> {label}</label>;
}

function Swatches({ d }: { d: DesignSystem }) {
  return <span class="sw">{[d.facade.wall, d.facade.accent, d.glazing.frame, d.glazing.glass].map((c) => <i style={`background:${c}`} />)}</span>;
}

function App() {
  const [p, setP] = useState<ProProject>(load);
  const [tab, setTab] = useState<'plot' | 'style' | 'spec'>('plot');
  const [xray, setXray] = useState<number | null>(null);
  const [hover, setHover] = useState<Picked | null>(null);
  const up = (o: Partial<ProProject>) => setP((x) => { const n = { ...x, ...o }; save(n); return n; });

  // ---- the account: sign-in state, the cloud copy, the projects list ----
  const [ref, setRefState] = useState<CloudRef>(loadRef);
  const setRef = (r: CloudRef) => { saveRef(r); setRefState(r); };
  const [cloud, setCloud] = useState<{ s: 'local' | 'saving' | 'saved' | 'error'; msg?: string }>({ s: 'local' });
  const [menu, setMenu] = useState(false);
  const user = session.value?.user ?? null;
  // (what's in the cloud, or for a project never saved what it opened as: just opening Pro saves nothing)
  const lastSaved = useRef(toText(p));
  useEffect(() => { peekSession(); void startAuth(); }, []);
  const openId = async (id: string) => {
    try {
      setCloud({ s: 'saving', msg: 'Opening…' });
      const o = await openPro(id);
      lastSaved.current = toText(o.p);
      save(o.p); setP(o.p); setRef(o.ref); setMenu(false);
      history.replaceState(null, '', `?p=${id}`);
      setCloud({ s: 'saved', msg: `Opened ${hhmm()}` });
    } catch (e) { setCloud({ s: 'error', msg: explain(e) }); }
  };
  // a project linked as /pro/?p=<id> opens once signed in
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('p');
    if (user && id && id !== ref?.id) void openId(id);
  }, [user?.id]);
  const fresh = () => {
    const n = { ...DEFAULT_PROJECT };
    save(n); setP(n); setRef(null); lastSaved.current = ''; setMenu(false);
    history.replaceState(null, '', location.pathname);
  };
  // signed in: the cloud follows a few seconds behind every change (a version kept every 10 minutes)
  useEffect(() => {
    if (!user) { setCloud({ s: 'local' }); return; }
    const text = toText(p);
    if (text === lastSaved.current) return;
    const t = setTimeout(async () => {
      setCloud({ s: 'saving' });
      try {
        const r = await savePro(p, ref);
        lastSaved.current = text;
        setRef({ id: r.id, rev: r.revision });
        history.replaceState(null, '', `?p=${r.id}`);
        setCloud({ s: 'saved', msg: r.copied ? 'Newer work was in the cloud: saved this as a copy' : `Saved ${hhmm()}` });
      } catch (e) { setCloud({ s: 'error', msg: explain(e) }); }
    }, 2500);
    return () => clearTimeout(t);
  }, [JSON.stringify(p), user?.id]);
  const ds = p.custom ?? presetOf(p.style);
  const setDs = (f: (d: DesignSystem) => void) => { const d = clone(ds); f(d); up({ custom: d }); };

  const out = useMemo(() => {
    const r = plotReport(p, ds.floorH);
    const rate = specRate(ds);
    const d = generate(p, r, rate, ds.premium);
    const plans = d.buildings.map((b) => planFloor(b, ds));
    const rows = schedule(d, plans, ds);
    const checks = plans.flatMap((pl, i) => pl.checks.map((c) => ({ ...c, floors: d.buildings[i].floors })));
    return { r, d, plans, rows, checks, rate };
  }, [JSON.stringify(p)]);

  const canvas = useRef<HTMLCanvasElement>(null), view = useRef<ProView | null>(null);
  useEffect(() => {
    const v = new ProView(canvas.current!);
    view.current = v;
    (window as unknown as { proView?: ProView }).proView = v; // (for the console)
    const ro = new ResizeObserver(() => v.resize());
    ro.observe(canvas.current!.parentElement!);
    return () => { ro.disconnect(); v.dispose(); };
  }, []);
  const maxFloor = Math.max(1, ...out.d.buildings.map((b) => b.floors));
  const xr = xray === null ? null : Math.min(xray, maxFloor);
  useEffect(() => {
    setHover(null);
    const o = outline(p);
    view.current?.set({ r: out.r, d: out.d, plans: out.plans, ds, xray: xr, roads: roadLines(o.ring, o.roads).map((l) => ({ pts: l.pts, today: l.road.today })) });
  }, [out, xr]);

  const { r, d } = out;
  // drawing starts from the rectangle as it stands (once; after that the drawn outline is kept)
  const setShape = (v: 'rect' | 'poly') => {
    if (v === 'rect') { up({ shape: 'rect' }); return; }
    const o = outline({ ...p, shape: 'rect' });
    up({ shape: 'poly', ring: p.ring ?? o.ring, edgeRoads: p.edgeRoads ?? o.roads });
  };
  const flatsOk = out.checks.filter((c) => c.t !== 3 && c.light && c.air).reduce((s, c) => s + c.floors, 0);
  const flatsAll = out.checks.filter((c) => c.t !== 3).reduce((s, c) => s + c.floors, 0);
  const failing = out.checks.filter((c) => c.t !== 3 && !(c.light && c.air));
  const city = CITIES.find((c) => c.value === p.city)!;

  return (
    <div class="pro">
      <header class="pro-top">
        <a class="pro-logo" href="/">Urban<span>Plan</span></a>
        <b class="pro-chip">Pro</b>
        <input class="pro-name" value={p.name} aria-label="Project name" onChange={(e) => up({ name: (e.target as HTMLInputElement).value || 'Untitled project' })} />
        <span class="pro-gap" />
        <span class="pro-beta">Beta · free while we build it</span>
        {authReady && user && <span class={`pro-cloud ${cloud.s}`} title={cloud.msg}>{cloud.s === 'saving' ? (cloud.msg ?? 'Saving…') : cloud.s === 'saved' ? (cloud.msg ?? 'Saved') : cloud.s === 'error' ? 'Not saved' : ''}</span>}
        {authReady && user && <button class="pro-link" onClick={() => setMenu(!menu)} aria-expanded={menu}>Projects</button>}
        {authReady && session.value === null && <a class="pro-link" href={`${BASE}login/?next=${encodeURIComponent(location.pathname)}`} title="Keep your projects in your account">Sign in to save</a>}
        <a class="pro-link" href={`${BASE}app/`}>Simple editor</a>
        {menu && user && <Projects current={ref?.id ?? null} open={(id) => void openId(id)} fresh={fresh} close={() => setMenu(false)} />}
      </header>

      <aside class="pro-left">
        <div class="pro-tabs" role="tablist">
          {([['plot', 'Plot'], ['style', 'Design system'], ['spec', 'Spec & price']] as const).map(([k, l]) => <button role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
        </div>

        {tab === 'plot' && (
          <div class="pro-sec">
            <label class="pf"><span>Rules</span>
              <select value={p.city} onChange={(e) => up({ city: (e.target as HTMLSelectElement).value as ProProject['city'] })}>{CITIES.map((c) => <option value={c.value}>{c.label}</option>)}</select>
            </label>
            <p class="pro-note">{city.note}</p>
            <h3>Plot</h3>
            <Seg<'rect' | 'poly'> value={p.shape === 'poly' ? 'poly' : 'rect'} set={setShape} options={[{ value: 'rect', label: 'Rectangle' }, { value: 'poly', label: 'Draw the outline' }]} />
            {p.shape === 'poly' && p.ring
              ? <PlotEditor ring={p.ring} roads={outline(p).roads} set={(ring, edgeRoads) => up({ ring, edgeRoads })} />
              : <>
                <div class="pf-row"><Num label="Frontage" value={p.width} set={(v) => up({ width: v })} min={10} max={300} unit="m" /><Num label="Depth" value={p.depth} set={(v) => up({ depth: v })} min={10} max={300} unit="m" /></div>
                <p class="pro-note">{nf(p.width * p.depth)} m² · {sqft(p.width * p.depth)}</p>
                <h3>Roads</h3>
                <div class="pf-row"><Num label="Front road today" value={p.road} set={(v) => up({ road: v })} min={3} max={60} unit="m" /><Num label="In the DP" value={p.dpRoad} set={(v) => up({ dpRoad: v })} min={0} max={60} unit="m" /></div>
                <Toggle label="Corner plot (a road down the side)" value={p.corner} set={(v) => up({ corner: v })} />
                {p.corner && <Num label="Side road" value={p.sideRoad} set={(v) => up({ sideRoad: v })} min={3} max={60} unit="m" />}
              </>}
            <h3>Scheme</h3>
            <Seg<Typology> value={p.typology} set={(v) => up({ typology: v })} options={TYPOLOGIES} />
            <Num label="At most this many floors (0: as the rules allow)" value={p.maxFloors} set={(v) => up({ maxFloors: Math.round(v) })} max={80} />
            <h3>Flat mix</h3>
            <div class="pf-row three">
              {[0, 1, 2].map((i) => <Num label={UNIT_LABEL[i]} value={Math.round(p.mix[i] * 100)} unit="%" max={100} set={(v) => { const m = [...p.mix] as [number, number, number]; m[i] = v / 100; const s = m[0] + m[1] + m[2] || 1; up({ mix: m.map((x) => x / s) as [number, number, number] }); }} />)}
            </div>
          </div>
        )}

        {tab === 'style' && (
          <div class="pro-sec">
            <p class="pro-note">The builder's look and make, for every building in the project. Pick one, then change anything: the 3D, the schedule and the cost follow.</p>
            <div class="presets">
              {PRESETS.map((x) => (
                <button class="preset" aria-pressed={p.style === x.id && !p.custom} onClick={() => up({ style: x.id, custom: null })}>
                  <Swatches d={x} />
                  <b>{x.name}</b>
                  <span>{x.blurb}</span>
                </button>
              ))}
            </div>
            {p.custom && <p class="pro-note">Customised from {presetOf(p.style).name}. <button class="linkbtn" onClick={() => up({ custom: null })}>Reset</button></p>}
            <h3>Facade</h3>
            <div class="pf-row three">
              <Color label="Walls" value={ds.facade.wall} set={(c) => setDs((d) => { d.facade.wall = c; })} />
              <Color label="Accent" value={ds.facade.accent} set={(c) => setDs((d) => { d.facade.accent = c; })} />
              <Color label="Stilt / base" value={ds.facade.base} set={(c) => setDs((d) => { d.facade.base = c; })} />
            </div>
            <div class="pf-row"><Toggle label="Floor bands" value={ds.facade.bands} set={(v) => setDs((d) => { d.facade.bands = v; })} /><Toggle label="Fins at windows" value={ds.facade.fins} set={(v) => setDs((d) => { d.facade.fins = v; })} /></div>
            <h3>Glazing</h3>
            <div class="pf-row"><Color label="Glass" value={ds.glazing.glass} set={(c) => setDs((d) => { d.glazing.glass = c; })} /><Color label="Frames" value={ds.glazing.frame} set={(c) => setDs((d) => { d.glazing.frame = c; })} /></div>
            <h3>Balconies</h3>
            <Seg<BalconyKind> value={ds.balcony.kind} set={(v) => setDs((d) => { d.balcony.kind = v; })} options={[{ value: 'cantilever', label: 'Cantilever' }, { value: 'recessed', label: 'Recessed' }, { value: 'french', label: 'French' }, { value: 'none', label: 'None' }]} />
            <div class="pf-row">
              <Num label="Depth" value={ds.balcony.depth} step={0.1} min={0.3} max={4} unit="m" set={(v) => setDs((d) => { d.balcony.depth = v; })} />
              <label class="pf"><span>Railing</span><select value={ds.balcony.railing} onChange={(e) => setDs((d) => { d.balcony.railing = (e.target as HTMLSelectElement).value as Railing; })}><option value="glass">Glass</option><option value="ms">MS steel</option><option value="solid">Solid parapet</option></select></label>
            </div>
            <Num label="Floor to floor" value={ds.floorH} step={0.05} min={2.8} max={4.5} unit="m" set={(v) => setDs((d) => { d.floorH = v; })} />
            <h3>Windows</h3>
            <table class="cat">
              <thead><tr><th>Tag</th><th>W</th><th>H</th><th>Sill</th><th>Type</th></tr></thead>
              <tbody>{(['W1', 'W2', 'V1'] as const).map((t) => <CatRow t={t} x={ds.windows[t]} sill set={(f) => setDs((d) => f(d.windows[t]))} kinds={['sliding', 'casement', 'fixed', 'louvre']} />)}</tbody>
            </table>
            <h3>Doors</h3>
            <table class="cat">
              <thead><tr><th>Tag</th><th>W</th><th>H</th><th /><th>Type</th></tr></thead>
              <tbody>{(['D1', 'D2', 'D3', 'SD'] as const).map((t) => <CatRow t={t} x={ds.doors[t]} set={(f) => setDs((d) => f(d.doors[t]))} kinds={['flush', 'panel', 'veneer', 'glass-sliding', 'fire-rated']} />)}</tbody>
            </table>
          </div>
        )}

        {tab === 'spec' && (
          <div class="pro-sec">
            <p class="pro-note">What the flats are sold with. Each choice adds to construction (₹ per sq ft of built-up area, rough figures to replace with your own).</p>
            {SPEC.map((c) => (
              <label class="pf"><span>{c.label}</span>
                <select value={ds.spec[c.key] ?? 0} onChange={(e) => setDs((d) => { d.spec[c.key] = +(e.target as HTMLSelectElement).value; })}>
                  {c.options.map((o, i) => <option value={i}>{o.label}{o.rate ? ` (+₹${o.rate})` : ''}</option>)}
                </select>
              </label>
            ))}
            <div class="pro-total"><span>Spec adds</span><b>₹{nf(out.rate)} / sq ft</b></div>
            <div class="pro-total"><span>Construction</span><b>₹{nf(d.money.costs.build)} / sq ft</b></div>
            <h3>Land and price</h3>
            <Num label="Land, ₹ per sq ft of plot (0: the city's starting figure)" value={p.land ?? 0} step={500} max={500000} set={(v) => up({ land: v })} />
            <p class="pro-note">Land at ₹{nf(d.money.costs.land)} / sq ft of plot: {cr(d.money.land)}.</p>
            <Num label="Sale price, ₹ per sq ft of RERA carpet (0: the city's starting figure)" value={p.sale} step={500} max={200000} set={(v) => up({ sale: v })} />
            <p class="pro-note">Selling at ₹{nf(d.money.costs.sale)} / sq ft carpet{p.sale > 0 ? '' : `: the city's starting figure ${ds.premium >= 0 ? '+' : '−'}${Math.round(Math.abs(ds.premium) * 100)}% for this design system`}.</p>
          </div>
        )}
      </aside>

      <main class="pro-stage">
        <canvas ref={canvas} onPointerMove={(e) => setHover(view.current?.pick(e.clientX, e.clientY) ?? null)} onPointerLeave={() => setHover(null)} />
        <div class="pro-viewbar">
          <Seg<'out' | 'xray'> value={xr === null ? 'out' : 'xray'} set={(v) => setXray(v === 'out' ? null : Math.max(1, Math.round(maxFloor / 2)))} options={[{ value: 'out', label: 'Exterior' }, { value: 'xray', label: 'X-ray floor' }]} />
          {xr !== null && (
            <span class="pro-floor">
              <button onClick={() => setXray(Math.max(1, xr - 1))} aria-label="Floor down">−</button>
              <b>Floor {xr}</b>
              <button onClick={() => setXray(Math.min(maxFloor, xr + 1))} aria-label="Floor up">+</button>
            </span>
          )}
        </div>
        {xr !== null && <div class="pro-legend">{[0, 1, 2].map((t) => <span><i style={`background:${UNIT_COLOR[t]}`} />{UNIT_LABEL[t]}</span>)}</div>}
        {hover && <div class="pro-tip" style={`left:${hover.x + 14}px;top:${hover.y + 14}px`}><b>{hover.label}</b><span>{hover.size}</span><span>Floor {hover.floor}</span></div>}
        <p class="pro-hint">Drag to orbit, right-drag to pan, scroll to zoom. Point at a window or door for its size.</p>
      </main>

      <aside class="pro-right">
        <section>
          <h2>Scheme</h2>
          <dl class="kv">
            <div><dt>Plot</dt><dd>{nf(r.area)} m² <small>({nf(r.netArea)} m² after the DP road)</small></dd></div>
            <div><dt>FSI on a {nf(r.roadW)} m road</dt><dd>{nf(r.fsi, 2)} + {Math.round(r.rules.ancillary * 100)}% {r.code === 'udcpr' ? 'ancillary' : 'fungible'}</dd></div>
            <div><dt>Built-up area</dt><dd>{sqft(d.bua)} <small>of {sqft(r.bua)}</small></dd></div>
            <div><dt>Buildings</dt><dd>{d.buildings.length} · {nf(d.height, 1)} m tall · {d.buildings.map((b) => b.floors).join(' + ')} floors{d.under ? ' over a stilt' : ''}</dd></div>
            <div><dt>Flats</dt><dd>{d.flats} <small>{[0, 1, 2].filter((t) => d.count[t]).map((t) => `${d.count[t]} × ${UNIT_LABEL[t]}`).join(', ')}</small></dd></div>
            <div><dt>Carpet (RERA)</dt><dd>{sqft(d.carpet)}</dd></div>
            <div><dt>Parking</dt><dd>{d.parking.have} car bays <small>{d.parking.need} needed</small></dd></div>
          </dl>
        </section>
        <section>
          <h2>Money</h2>
          <dl class="kv">
            <div><dt>Revenue</dt><dd>{cr(d.money.revenue)}</dd></div>
            <div><dt>Cost</dt><dd>{cr(d.money.cost)}</dd></div>
            <div><dt>Profit</dt><dd class={d.money.profit < 0 ? 'bad' : ''}>{cr(d.money.profit)} <small>{nf(d.money.margin * 100, 1)}%</small></dd></div>
            <div><dt>IRR</dt><dd>{d.money.irr === null ? '—' : `${nf(d.money.irr * 100, 1)}%`}</dd></div>
          </dl>
        </section>
        <section>
          <h2>Checks</h2>
          <p class={`chk ${flatsOk === flatsAll ? 'ok' : 'warn'}`}>Light and air: {flatsOk} of {flatsAll} flats have openings of 1/10 of their floor area (half of it opening).</p>
          {failing.length > 0 && <ul class="chk-list">{failing.slice(0, 4).map((c) => <li>{UNIT_LABEL[c.t]} of {nf(c.carpet)} m²: {nf(c.glazed, 1)} m² of openings, needs {nf(c.carpet / 10, 1)}</li>)}</ul>}
          {d.departures.length ? <ul class="chk-list">{d.departures.map((x) => <li class="warn">{x.rule}: {x.value} (allowed {x.allowed}) <small>{x.clause}</small></li>)}</ul> : <p class="chk ok">No departures from {r.code === 'udcpr' ? 'UDCPR' : 'DCPR'} in the rules checked.</p>}
        </section>
        <section>
          <h2>Door & window schedule</h2>
          <table class="sched">
            <thead><tr><th>Tag</th><th>Type</th><th>Size</th><th>No.</th></tr></thead>
            <tbody>{out.rows.map((x) => <tr title={`${x.where}${x.sill !== '—' ? `, sill ${x.sill}` : ''}`}><td><b>{x.tag}</b></td><td>{x.label}</td><td>{x.size}</td><td>{nf(x.count)}</td></tr>)}</tbody>
          </table>
          <p class="pro-note">Carpet is taken as {Math.round(CARPET * 100)}% of a flat's plate. Checked by flat until rooms are modelled.</p>
        </section>
      </aside>
    </div>
  );
}

function CatRow<T extends WindowType | DoorType>({ t, x, set, kinds, sill }: { t: string; x: T; set: (f: (x: T) => void) => void; kinds: string[]; sill?: boolean }) {
  const n = (k: 'w' | 'h' | 'sill', v: string) => { const f = parseFloat(v); if (Number.isFinite(f) && f >= 0 && f < 10) set((y) => { (y as unknown as Record<string, number>)[k] = f; }); };
  return (
    <tr>
      <td><b>{t}</b></td>
      <td><input type="number" step="0.05" value={x.w} onChange={(e) => n('w', (e.target as HTMLInputElement).value)} aria-label={`${t} width`} /></td>
      <td><input type="number" step="0.05" value={x.h} onChange={(e) => n('h', (e.target as HTMLInputElement).value)} aria-label={`${t} height`} /></td>
      <td>{sill ? <input type="number" step="0.05" value={(x as WindowType).sill} onChange={(e) => n('sill', (e.target as HTMLInputElement).value)} aria-label={`${t} sill`} /> : null}</td>
      <td><select value={x.kind} onChange={(e) => set((y) => { (y as { kind: string }).kind = (e.target as HTMLSelectElement).value; })}>{kinds.map((k) => <option value={k}>{k.replace('-', ' ')}</option>)}</select></td>
    </tr>
  );
}

render(<App />, document.getElementById('pro')!);
