// The six steps of a Pro project, one panel each, in the order a developer works: the site and its rules, the
// scheme, its design, the money, the approval, then exploring (options, a brief, screening, layouts). Each panel
// opens on what most people change; the rest folds away. Every figure here comes from the one evaluation in
// main.tsx (./evaluate.ts), so a panel never shows a number another disagrees with.
import { useMemo, useState } from 'preact/hooks';
import { UNIT_LABEL } from '../doc/site';
import { TYPOLOGIES, type Typology } from '../doc/optimise';
import { CITIES, outline, type EdgeRoad, type ProProject } from './project';
import { PlotEditor } from './PlotEditor';
import { importPlot, longestEdge } from './importPlot';
import { shopFloorsAllowed } from './mixed';
import { clone, presetOf, PRESETS, SPEC, type BalconyKind, type DesignSystem, type DoorType, type Railing, type WindowType } from './design';
import type { Evaluated } from './evaluate';
import { applyDeal, DEAL_LABEL, DEFAULT_DEAL, type Deal, type DealKind, type DealResult } from './deal';
import { scrutinySummary, type Check, type CheckStatus } from './scrutiny';
import { documents, fees, nocs } from './approvals';
import { predcrDxf } from './dxf';
import { ROOM_COLOR, type FlatRooms } from './rooms';
import { buildModel, ifcLite, modelJson } from './model';
import { exploreOptions, type OptionRow } from './options';
import { parseScreen, screen, screenCsv, type ScreenResult } from './screen';
import { parseBrief, runBrief, type BriefResult } from './brief';
import { layoutDefaults, plotLayout, type LayoutOpts } from './layout';
import { Btn, Color, cr, download, Icon, Lines, Note, nf, Num, pct, Row, Section, Seg, Select, Slider, sqft, Stat, Toggle } from './ui';

export type Step = 'site' | 'build' | 'design' | 'money' | 'approve' | 'explore';
export const STEPS: { key: Step; label: string; icon: string; title: string; sub: string }[] = [
  { key: 'site', label: 'Site', icon: 'site', title: 'Site and rules', sub: 'The plot, its roads and the rules it falls under.' },
  { key: 'build', label: 'Scheme', icon: 'building', title: 'Scheme', sub: 'What goes on it: the buildings, the flats, shops at the front.' },
  { key: 'design', label: 'Design', icon: 'palette', title: 'Design system', sub: 'The builder’s look and make, the flats’ rooms, every window and door.' },
  { key: 'money', label: 'Money', icon: 'money', title: 'Money', sub: 'Price, cost, the deal on the land, and the cash month by month.' },
  { key: 'approve', label: 'Approval', icon: 'shield', title: 'Approval', sub: 'Our own scrutiny, the NOCs and fees, and the drawings and files to submit.' },
  { key: 'explore', label: 'Explore', icon: 'spark', title: 'Explore', sub: 'Many options at once, a written brief, screening plots, plotted layouts.' },
];

export interface StepProps {
  p: ProProject; e: Evaluated; up: (o: Partial<ProProject>) => void;
  rooms: FlatRooms[][]; checks: Check[]; deal: DealResult;
  go: (s: Step) => void; openDrawings: () => void; toast: (s: string) => void;
}

// ================================================================ site
export function SiteStep({ p, e, up, toast }: StepProps) {
  const { r } = e;
  const city = CITIES.find((c) => c.value === p.city)!;
  const mode = p.shape === 'poly' ? 'poly' : 'rect';
  const [importing, setImporting] = useState(false);
  const setShape = (v: 'rect' | 'poly') => {
    if (v === 'rect') { up({ shape: 'rect' }); return; }
    const o = outline({ ...p, shape: 'rect' });
    up({ shape: 'poly', ring: p.ring ?? o.ring, edgeRoads: p.edgeRoads ?? o.roads });
  };
  const L = p.limits ?? { maxH: 0, tod: false, todFsi: 4 };
  const setL = (o: Partial<typeof L>) => up({ limits: { ...L, ...o } });
  return (
    <>
      <Section title="Rules">
        <Select label="Planning authority" value={p.city} set={(v) => up({ city: v })} options={CITIES.map((c) => ({ value: c.value, label: c.label }))} />
        <Note>{city.note}</Note>
      </Section>

      <Section title="Plot" aside={<span class="sec-meta">{nf(r.area)} m² · {sqft(r.area)}</span>}>
        <Seg<'rect' | 'poly'> value={mode} set={setShape} label="Shape" options={[{ value: 'rect', label: 'Rectangle', icon: 'plan' }, { value: 'poly', label: 'Any outline', icon: 'edit' }]} />
        {mode === 'poly' && p.ring
          ? <PlotEditor ring={p.ring} roads={outline(p).roads} set={(ring, edgeRoads) => up({ ring, edgeRoads })} />
          : <>
            <Row><Num label="Frontage" value={p.width} set={(v) => up({ width: v })} min={10} max={400} unit="m" /><Num label="Depth" value={p.depth} set={(v) => up({ depth: v })} min={10} max={400} unit="m" /></Row>
            <Row><Num label="Front road today" value={p.road} set={(v) => up({ road: v })} min={3} max={80} unit="m" /><Num label="Front road in the DP" value={p.dpRoad} set={(v) => up({ dpRoad: v })} min={0} max={80} unit="m" hint={p.dpRoad > p.road ? `${nf((p.dpRoad - p.road) / 2, 1)} m of the plot goes to widening` : 'No widening'} /></Row>
            <Toggle label="Corner plot" hint="A road down the left side too" value={p.corner} set={(v) => up({ corner: v })} />
            {p.corner && <Num label="Side road" value={p.sideRoad} set={(v) => up({ sideRoad: v })} min={3} max={80} unit="m" />}
          </>}
        <button type="button" class="linkbtn" onClick={() => setImporting(!importing)}><Icon n="upload" size={14} /> Import the outline from a file or coordinates</button>
        {importing && <ImportBox done={(ring, src) => {
          const k = longestEdge(ring);
          const roads: (EdgeRoad | null)[] = Array.from({ length: ring.length / 2 }, (_, i) => (i === k ? { today: 12, dp: 0 } : null));
          up({ shape: 'poly', ring, edgeRoads: roads }); setImporting(false);
          toast(`Outline from ${src}. The longest edge has the road: click any edge to change it.`);
        }} />}
      </Section>

      <Section title="What the rules give" sub={`On a ${nf(r.roadW)} m road${r.roadW !== (r.road?.today ?? r.roadW) ? ' (the DP width)' : ''}.`}>
        <div class="stats">
          <Stat label="FSI" value={nf(r.fsi, 2)} sub={`+ ${Math.round(r.rules.ancillary * 100)}% ${r.code === 'udcpr' ? 'ancillary' : 'fungible'}`} />
          <Stat label="Built-up allowed" value={sqft(r.bua)} sub={`${nf(r.bua)} m²`} />
          <Stat label="Height limit" value={`${nf(r.rules.maxH)} m`} sub={r.limit === 'height' ? 'what stops it' : ''} />
          <Stat label="Margins" value={`${nf(r.rules.front, 1)} m front`} sub={`${nf(r.side, 1)} m sides at full height`} />
        </div>
        <Lines rows={[
          ['Basic FSI on the net plot', `${nf(r.parts.basic)} m²`],
          ['Premium FSI (paid)', `${nf(r.parts.premium)} m²`],
          ['TDR that can be loaded', `${nf(r.parts.tdr)} m²`],
          ...(r.parts.credit ? [['DP road handed over (counted)', `${nf(r.parts.credit)} m²`] as [string, string]] : []),
          [r.code === 'udcpr' ? 'Ancillary' : 'Fungible', `${nf(r.parts.ancillary)} m²`],
          ['Land lost to DP roads', `${nf(r.lost)} m²`],
        ]} />
      </Section>

      <Section title="The site's own limits" fold open={!!(L.maxH || L.tod)} sub="Over the code's: an airport or fire height cap, a heritage zone, a transit zone near a metro station.">
        <Num label="Height cap (0: none)" value={L.maxH} set={(v) => setL({ maxH: v })} max={300} unit="m" hint="From the AAI colour-coded zoning map, or a fire or heritage limit" />
        <Toggle label="Transit-oriented zone" hint="Within walking distance of a metro station: more FSI with premium" value={L.tod} set={(v) => setL({ tod: v })} />
        {L.tod && <Num label="Total FSI in the zone" value={L.todFsi} set={(v) => setL({ todFsi: v })} min={1} max={6} step={0.1} />}
        {L.tod && r.roadW < 9 && <Note tone="warn">Transit-zone FSI is taken only on roads 9 m and wider.</Note>}
      </Section>
    </>
  );
}

function ImportBox({ done }: { done: (ring: number[], src: string) => void }) {
  const [text, setText] = useState(''), [err, setErr] = useState('');
  const use = (t: string, name?: string) => { try { const x = importPlot(t, name); done(x.ring, x.source); } catch (e) { setErr((e as Error).message); } };
  return (
    <div class="card">
      <label class="drop">
        <Icon n="upload" /> <span><b>Choose a GeoJSON or KML file</b><small>From a survey, Google Earth, a GIS or a cadastre map. Only the outline is read.</small></span>
        <input type="file" accept=".geojson,.json,.kml" onChange={async (ev) => { const f = (ev.target as HTMLInputElement).files?.[0]; if (f) use(await f.text(), f.name); }} />
      </label>
      <label class="f"><span class="f-l">Or paste corners, one a line</span>
        <textarea rows={5} value={text} placeholder={'18.5204, 73.8567\n18.5206, 73.8571\n…  (latitude, longitude)\nor x, y in metres (UTM or a survey)'} onInput={(ev) => setText((ev.target as HTMLTextAreaElement).value)} />
      </label>
      {err && <Note tone="bad">{err}</Note>}
      <Btn kind="primary" onClick={() => use(text)} disabled={!text.trim()}>Use these corners</Btn>
    </div>
  );
}

// ================================================================ scheme
export function BuildStep({ p, e, up }: StepProps) {
  const { r, d, shops } = e;
  const sh = p.shops ?? { floors: 0, depth: 9, sale: 0 };
  const setShops = (o: Partial<typeof sh>) => up({ shops: { ...sh, ...o } });
  const allowed = shopFloorsAllowed(r.roadW);
  const mixPct = p.mix.map((x) => Math.round(x * 100));
  const setMix = (i: number, v: number) => { const m = [...p.mix] as [number, number, number]; m[i] = v / 100; const s = m[0] + m[1] + m[2] || 1; up({ mix: m.map((x) => x / s) as [number, number, number] }); };
  const styleOf = (i: number) => p.buildingStyle?.[i] ?? '';
  return (
    <>
      <Section title="Massing">
        <Seg<Typology> value={p.typology} set={(v) => up({ typology: v })} label="Building type" options={TYPOLOGIES} />
        <Slider label="Most floors" value={p.maxFloors} set={(v) => up({ maxFloors: v })} min={0} max={60} fmt={(v) => (v ? `${v} floors` : 'As the rules allow')} />
      </Section>

      <Section title="Flat mix" aside={<span class="sec-meta">{d.flats} flats</span>}>
        <div class="mixbar" aria-hidden="true">{[0, 1, 2].map((i) => <i class={`m${i}`} style={`flex:${p.mix[i] || 0.0001}`}>{mixPct[i] >= 12 ? `${mixPct[i]}%` : ''}</i>)}</div>
        <Row n={3}>{[0, 1, 2].map((i) => <Num label={UNIT_LABEL[i]} value={mixPct[i]} set={(v) => setMix(i, v)} max={100} step={5} unit="%" />)}</Row>
        <Note>{[0, 1, 2].filter((t) => d.count[t]).map((t) => `${d.count[t]} × ${UNIT_LABEL[t]}`).join(' · ') || 'No flats fit.'}</Note>
      </Section>

      <Section title="Shops at the front" aside={shops ? <span class="sec-meta">{shops.count} shops</span> : undefined}>
        <Seg<string> value={String(sh.floors)} set={(v) => setShops({ floors: +v })} options={[{ value: '0', label: 'None' }, { value: '1', label: 'Ground' }, { value: '2', label: 'G + 1' }, { value: '3', label: 'G + 2' }]} />
        {sh.floors > 0 && <>
          <Row>
            <Num label="Depth from the front" value={sh.depth} set={(v) => setShops({ depth: v })} min={4} max={30} unit="m" />
            <Num label="Price (0: 1.8× the flats)" value={sh.sale} set={(v) => setShops({ sale: v })} step={500} max={300000} unit="₹/ft²" />
          </Row>
          <Note tone={allowed >= sh.floors ? undefined : 'warn'}>{allowed === 0 ? `A ${nf(r.roadW)} m road allows no shops (9 m and wider).` : `A ${nf(r.roadW)} m road allows shops on ${allowed >= 99 ? 'every floor' : allowed === 1 ? 'the ground floor' : `${allowed} floors`} (as assumed: check the zone).`}</Note>
          {shops && <Note>{shops.trimmed ? `${shops.trimmed} floor${shops.trimmed > 1 ? 's' : ''} of flats came off the top to stay in the FSI. ` : ''}{shops.removedFlats ? `${shops.removedFlats} flats became shops. ` : ''}{shops.cars} cars for the shops{shops.basementsAdded ? `, ${shops.basementsAdded} more basement` : ''}.</Note>}
        </>}
      </Section>

      <Section title="Buildings" sub="Each building can take its own design system; unset, it follows the project's.">
        <div class="blist">{d.buildings.map((b, i) => (
          <div class="bitem">
            <b class="bname">{String.fromCharCode(65 + i)}</b>
            <span><b>{b.floors} floors · {nf(b.height, 1)} m</b><small>{b.perFloor.slice(0, 3).reduce((s, x) => s + x, 0)} flats a floor · {nf(b.plate)} m² plate</small></span>
            <select aria-label={`Design system of building ${String.fromCharCode(65 + i)}`} value={styleOf(i)} onChange={(ev) => { const v = (ev.target as HTMLSelectElement).value; const m = { ...(p.buildingStyle ?? {}) }; if (v) m[i] = v; else delete m[i]; up({ buildingStyle: m }); }}>
              <option value="">Project style</option>
              {PRESETS.map((x) => <option value={x.id}>{x.name}</option>)}
            </select>
          </div>
        ))}{!d.buildings.length && <Note tone="warn">Nothing fits inside the margins. Try a bigger plot, a wider road or the other building type.</Note>}</div>
      </Section>

      <Section title="Parking" aside={<span class={`sec-meta ${d.parking.have >= d.parking.need ? 'ok' : 'bad'}`}>{d.parking.have} / {d.parking.need}</span>}>
        <Lines rows={[
          ['Cars needed', nf(d.parking.need)],
          ['Bays laid out', nf(d.parking.have)],
          ...d.parking.levels.filter((l) => l.bays.length).map((l) => [l.kind[0].toUpperCase() + l.kind.slice(1), `${l.bays.length} bays`] as [string, string]),
          ['Scooters', nf(d.parking.scooters)],
        ]} />
      </Section>
    </>
  );
}

// ================================================================ design
function Swatches({ d }: { d: DesignSystem }) {
  return <span class="sw">{[d.facade.wall, d.facade.accent, d.glazing.frame, d.glazing.glass].map((c) => <i style={`background:${c}`} />)}</span>;
}

export function DesignStep({ p, e, up, rooms, toast }: StepProps) {
  const ds = e.ds;
  const setDs = (f: (d: DesignSystem) => void) => { const d = clone(ds); f(d); up({ custom: d }); };
  // one flat of each type, from the first building that has it, for the room plans
  const samples = useMemo(() => {
    const out: { t: number; fr: FlatRooms }[] = [];
    rooms.forEach((bl) => bl.forEach((fr) => { if (fr.t < 3 && fr.rooms.length && !out.some((x) => x.t === fr.t)) out.push({ t: fr.t, fr }); }));
    return out.sort((a, b) => a.t - b.t);
  }, [rooms]);
  const roomFails = rooms.flat().filter((f) => !f.ok).length, flats = rooms.flat().filter((f) => f.t < 3).length;
  return (
    <>
      <Section title="Style">
        <div class="presets">
          {PRESETS.map((x) => (
            <button type="button" class="preset" aria-pressed={p.style === x.id && !p.custom} onClick={() => up({ style: x.id, custom: null })}>
              <Swatches d={x} /><b>{x.name}</b><span>{x.blurb}</span>
            </button>
          ))}
        </div>
        {p.custom && <Note>Changed from {presetOf(p.style).name}. <button type="button" class="linkbtn" onClick={() => up({ custom: null })}>Back to the preset</button></Note>}
      </Section>

      <Section title="Flat plans" sub="Rooms fitted into each flat, checked against the minimum room sizes." aside={<span class={`sec-meta ${roomFails ? 'bad' : 'ok'}`}>{flats - roomFails} / {flats} pass</span>}>
        <div class="flats">{samples.map(({ t, fr }) => <FlatPlan t={t} fr={fr} />)}</div>
        <div class="legend">{(['living', 'bed', 'kitchen', 'toilet', 'balcony', 'foyer'] as const).map((k) => <span><i style={`background:${ROOM_COLOR[k]}`} />{k === 'bed' ? 'bedroom' : k}</span>)}</div>
      </Section>

      <Section title="Facade" fold open={false}>
        <Row n={3}>
          <Color label="Walls" value={ds.facade.wall} set={(c) => setDs((d) => { d.facade.wall = c; })} />
          <Color label="Accent" value={ds.facade.accent} set={(c) => setDs((d) => { d.facade.accent = c; })} />
          <Color label="Stilt" value={ds.facade.base} set={(c) => setDs((d) => { d.facade.base = c; })} />
        </Row>
        <Toggle label="Floor bands" value={ds.facade.bands} set={(v) => setDs((d) => { d.facade.bands = v; })} />
        <Toggle label="Fins at the windows" value={ds.facade.fins} set={(v) => setDs((d) => { d.facade.fins = v; })} />
        <Row><Color label="Glass" value={ds.glazing.glass} set={(c) => setDs((d) => { d.glazing.glass = c; })} /><Color label="Frames" value={ds.glazing.frame} set={(c) => setDs((d) => { d.glazing.frame = c; })} /></Row>
        <Num label="Floor to floor" value={ds.floorH} step={0.05} min={2.8} max={4.5} unit="m" set={(v) => setDs((d) => { d.floorH = v; })} />
      </Section>

      <Section title="Balconies" fold open={false}>
        <Seg<BalconyKind> value={ds.balcony.kind} set={(v) => setDs((d) => { d.balcony.kind = v; })} options={[{ value: 'cantilever', label: 'Cantilever' }, { value: 'recessed', label: 'Recessed' }, { value: 'french', label: 'French' }, { value: 'none', label: 'None' }]} />
        <Row>
          <Num label="Depth" value={ds.balcony.depth} step={0.1} min={0.3} max={4} unit="m" set={(v) => setDs((d) => { d.balcony.depth = v; })} />
          <Select<Railing> label="Railing" value={ds.balcony.railing} set={(v) => setDs((d) => { d.balcony.railing = v; })} options={[{ value: 'glass', label: 'Glass' }, { value: 'ms', label: 'MS steel' }, { value: 'solid', label: 'Solid parapet' }]} />
        </Row>
      </Section>

      <Section title="Windows and doors" fold open={false} sub="The catalog every opening comes from: change a size and every one of them follows.">
        <table class="cat">
          <thead><tr><th>Tag</th><th>W</th><th>H</th><th>Sill</th><th>Type</th></tr></thead>
          <tbody>
            {(['W1', 'W2', 'V1'] as const).map((t) => <CatRow t={t} x={ds.windows[t]} sill set={(f) => setDs((d) => f(d.windows[t]))} kinds={['sliding', 'casement', 'fixed', 'louvre']} />)}
            {(['D1', 'D2', 'D3', 'SD'] as const).map((t) => <CatRow t={t} x={ds.doors[t]} set={(f) => setDs((d) => f(d.doors[t]))} kinds={['flush', 'panel', 'veneer', 'glass-sliding', 'fire-rated']} />)}
          </tbody>
        </table>
      </Section>

      <Section title="Schedule" fold open={false} aside={<span class="sec-meta">{nf(e.rows.reduce((s, x) => s + x.count, 0))} openings</span>}>
        <table class="sched">
          <thead><tr><th>Tag</th><th>Type</th><th>Size</th><th>No.</th></tr></thead>
          <tbody>{e.rows.map((x) => <tr title={x.where}><td><b>{x.tag}</b></td><td>{x.label}</td><td>{x.size}</td><td>{nf(x.count)}</td></tr>)}</tbody>
        </table>
      </Section>

      <Section title="Specification" fold open={false} sub="What the flats are sold with. Each choice adds to construction, ₹ per sq ft of built-up area (rough figures: put in your own)." aside={<span class="sec-meta">+₹{nf(e.rate)}/ft²</span>}>
        {SPEC.map((c) => (
          <Select<number> label={c.label} value={ds.spec[c.key] ?? 0} set={(v) => setDs((d) => { d.spec[c.key] = v; })} options={c.options.map((o, i) => ({ value: i, label: `${o.label}${o.rate ? ` (+₹${o.rate})` : ''}` }))} />
        ))}
      </Section>

      <Section title="The building as data" fold open={false} sub="Every floor, flat, room, window and door, for other tools: JSON for scripts, IFC for Revit and other BIM tools (spaces only).">
        <Row>
          <Btn icon="down" onClick={() => { download(`${slug(p.name)}.model.json`, modelJson(buildModel(e, rooms)), 'application/json'); toast('Model saved as JSON.'); }}>Model JSON</Btn>
          <Btn icon="down" onClick={() => { download(`${slug(p.name)}.ifc`, ifcLite(e, rooms), 'application/x-step'); toast('IFC saved: open it in Revit, ArchiCAD or BIMvision.'); }}>IFC (spaces)</Btn>
        </Row>
      </Section>
    </>
  );
}

/** A flat's plan as a small drawing: its rooms tinted, their names and areas. */
function FlatPlan({ t, fr }: { t: number; fr: FlatRooms }) {
  const all = fr.rooms.flatMap((r) => r.ring);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < all.length; i += 2) { x0 = Math.min(x0, all[i]); x1 = Math.max(x1, all[i]); z0 = Math.min(z0, all[i + 1]); z1 = Math.max(z1, all[i + 1]); }
  const w = x1 - x0, h = z1 - z0, pad = 0.4;
  const area = fr.rooms.reduce((s, r) => s + (r.kind === 'balcony' ? 0 : r.area), 0);
  return (
    <figure class={`flat${fr.ok ? '' : ' bad'}`}>
      <svg viewBox={`${x0 - pad} ${z0 - pad} ${w + 2 * pad} ${h + 2 * pad}`} role="img" aria-label={`${UNIT_LABEL[t]} plan`}>
        {fr.rooms.map((r) => {
          const pts = []; for (let i = 0; i < r.ring.length; i += 2) pts.push(`${r.ring[i]},${r.ring[i + 1]}`);
          let cx = 0, cz = 0; for (let i = 0; i < r.ring.length; i += 2) { cx += r.ring[i]; cz += r.ring[i + 1]; } cx /= r.ring.length / 2; cz /= r.ring.length / 2;
          const fs = Math.max(0.32, Math.min(0.6, Math.sqrt(r.area) / 5));
          return <g>
            <polygon points={pts.join(' ')} fill={ROOM_COLOR[r.kind]} stroke={r.ok ? '#3f3f46' : '#e5484d'} stroke-width={r.ok ? 0.06 : 0.14} />
            {r.area >= 2 && <text x={cx} y={cz} font-size={fs} text-anchor="middle" dominant-baseline="middle">{shortRoom(r.name)}<tspan x={cx} dy={fs * 1.1} font-size={fs * 0.85} opacity="0.7">{nf(r.area, 1)}</tspan></text>}
          </g>;
        })}
      </svg>
      <figcaption><b>{UNIT_LABEL[t]}</b> {nf(area, 1)} m² rooms{fr.ok ? '' : <em> · {fr.rooms.filter((r) => !r.ok).map((r) => r.name).join(', ')} under size</em>}</figcaption>
    </figure>
  );
}
const shortRoom = (n: string) => n.replace('Bedroom', 'Bed').replace('Living / dining', 'Living').replace('Toilet', 'WC');
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';

function CatRow<T extends WindowType | DoorType>({ t, x, set, kinds, sill }: { t: string; x: T; set: (f: (x: T) => void) => void; kinds: string[]; sill?: boolean }) {
  const n = (k: 'w' | 'h' | 'sill', v: string) => { const f = parseFloat(v); if (Number.isFinite(f) && f >= 0 && f < 10) set((y) => { (y as unknown as Record<string, number>)[k] = f; }); };
  return (
    <tr>
      <td><b>{t}</b></td>
      <td><input type="number" step="0.05" value={x.w} onChange={(ev) => n('w', (ev.target as HTMLInputElement).value)} aria-label={`${t} width`} /></td>
      <td><input type="number" step="0.05" value={x.h} onChange={(ev) => n('h', (ev.target as HTMLInputElement).value)} aria-label={`${t} height`} /></td>
      <td>{sill ? <input type="number" step="0.05" value={(x as WindowType).sill} onChange={(ev) => n('sill', (ev.target as HTMLInputElement).value)} aria-label={`${t} sill`} /> : null}</td>
      <td><select value={x.kind} onChange={(ev) => set((y) => { (y as { kind: string }).kind = (ev.target as HTMLSelectElement).value; })}>{kinds.map((k) => <option value={k}>{k.replace('-', ' ')}</option>)}</select></td>
    </tr>
  );
}

// ================================================================ money
export function MoneyStep({ p, e, up, deal, go }: StepProps) {
  const c = e.d.money.costs;
  const D = p.deal ?? DEFAULT_DEAL;
  const setD = (o: Partial<Deal>) => up({ deal: { ...D, ...o } });
  const ins = deal.lines.filter((l) => l.kind === 'in'), outs = deal.lines.filter((l) => l.kind === 'out');
  const total = Math.max(1, deal.revenue, deal.cost);
  return (
    <>
      <Section title="Result">
        <div class="stats">
          <Stat big label="Profit" value={cr(deal.profit)} sub={`${pct(deal.margin)} of revenue`} tone={deal.profit < 0 ? 'bad' : 'ok'} />
          <Stat big label="IRR" value={pct(deal.irr)} sub="a year, on the monthly cash" tone={deal.irr !== null && deal.irr < 0.12 ? 'warn' : undefined} />
          <Stat label="Peak funding" value={cr(deal.peak)} sub="the most cash put in" />
          <Stat label={deal.owner.label} value={cr(deal.owner.value)} sub={deal.owner.note} />
        </div>
        <CashChart flow={deal.flow} cum={deal.cum} months={c.months} />
      </Section>

      <Section title="Prices">
        <Row>
          <Num label="Flats, ₹ / sq ft carpet" value={p.sale || c.sale} set={(v) => up({ sale: v })} step={250} min={1000} max={300000} hint={p.sale ? '' : 'The city’s starting figure with the style’s premium'} />
          <Num label="Land, ₹ / sq ft of plot" value={p.land || c.land} set={(v) => up({ land: v })} step={250} min={0} max={1000000} hint={D.kind === 'outright' ? '' : 'Not paid in this deal'} />
        </Row>
        <Row>
          <div class="f"><span class="f-l">Construction</span><span class="f-fixed">₹{nf(c.build)} / ft²</span><span class="f-h">Base + the spec: <button type="button" class="linkbtn" onClick={() => go('design')}>change it in Design</button></span></div>
          <Num label="Build time" value={p.costs?.months ?? c.months} set={(v) => up({ costs: { ...(p.costs ?? {}), months: v } })} min={6} max={96} unit="months" />
        </Row>
        <Row>
          <Num label="Booked by completion" value={p.costs?.presold ?? c.presold} set={(v) => up({ costs: { ...(p.costs ?? {}), presold: v } })} max={100} step={5} unit="%" />
          <Num label="Soft costs" value={p.costs?.soft ?? c.soft} set={(v) => up({ costs: { ...(p.costs ?? {}), soft: v } })} max={60} unit="% of build" />
        </Row>
      </Section>

      <Section title="The deal on the land">
        <Select<DealKind> label="Deal" value={D.kind} set={(v) => setD({ kind: v })} options={(Object.keys(DEAL_LABEL) as DealKind[]).map((k) => ({ value: k, label: DEAL_LABEL[k] }))} />
        {(D.kind === 'jda-revenue' || D.kind === 'jda-area') && <Row>
          <Num label={D.kind === 'jda-revenue' ? 'Owner’s share of revenue' : 'Owner’s share of the flats'} value={D.ownerShare} set={(v) => setD({ ownerShare: v })} max={80} unit="%" />
          <Num label="Refundable deposit" value={D.deposit} set={(v) => setD({ deposit: v })} step={0.25} max={500} unit="₹ cr" />
        </Row>}
        {D.kind === 'redevelopment' && <>
          <Row><Num label="Members (existing flats)" value={D.members} set={(v) => setD({ members: v })} min={1} max={2000} /><Num label="Their carpet each" value={D.existingCarpet} set={(v) => setD({ existingCarpet: v })} min={10} max={500} unit="m²" /></Row>
          <Row><Num label="Extra carpet for them" value={D.extraPct} set={(v) => setD({ extraPct: v })} max={200} unit="%" /><Num label="Corpus each" value={D.corpus} set={(v) => setD({ corpus: v })} max={500} unit="₹ lakh" /></Row>
          <Num label="Rent each, a month while it’s built" value={D.rent} set={(v) => setD({ rent: v })} step={1000} max={500000} unit="₹" />
        </>}
        <Row><Num label="GST on sales" value={D.gstPct} set={(v) => setD({ gstPct: v })} max={18} step={1} unit="%" hint="Collected from buyers, paid on" /><Num label="Stamp duty" value={D.stampPct} set={(v) => setD({ stampPct: v })} max={10} step={0.5} unit="%" /></Row>
        {deal.notes.map((n) => <Note>{n}</Note>)}
      </Section>

      <Section title="Statement" fold open={false}>
        <div class="bars">{[...ins, ...outs].filter((l) => l.amount > 0).map((l) => <div class={`bar ${l.kind}`}><span>{l.label}</span><i style={`width:${Math.max(1, (l.amount / total) * 100)}%`} /><b>{cr(l.amount)}</b></div>)}</div>
        <Lines rows={[['Revenue', cr(deal.revenue), 'tot'], ['Cost', cr(deal.cost), 'tot'], ['Profit', cr(deal.profit), `tot ${deal.profit < 0 ? 'bad' : ''}`], ['GST collected from buyers', cr(deal.gstCollected)], ['Carpet sold', sqft(deal.saleCarpet)], ...(deal.ownerCarpet ? [['Carpet handed over', sqft(deal.ownerCarpet)] as [string, string]] : [])]} />
      </Section>
    </>
  );
}

/** Monthly net cash as bars, the running total as a line. */
function CashChart({ flow, cum, months }: { flow: number[]; cum: number[]; months: number }) {
  if (!flow.length) return null;
  const W = 300, H = 120, n = flow.length;
  const lo = Math.min(0, ...cum, ...flow), hi = Math.max(0, ...cum, ...flow), y = (v: number) => H - 14 - ((v - lo) / (hi - lo || 1)) * (H - 24);
  const x = (i: number) => 4 + (i / Math.max(1, n - 1)) * (W - 8), bw = Math.max(1, (W - 8) / n - 1);
  const minAt = cum.indexOf(Math.min(...cum));
  return (
    <figure class="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cash month by month">
        <line x1="0" x2={W} y1={y(0)} y2={y(0)} class="ax" />
        {flow.map((f, i) => <rect x={x(i) - bw / 2} width={bw} y={Math.min(y(0), y(f))} height={Math.abs(y(f) - y(0)) || 0.5} class={f >= 0 ? 'pos' : 'neg'} />)}
        <polyline points={cum.map((v, i) => `${x(i)},${y(v)}`).join(' ')} class="cum" />
        <circle cx={x(minAt)} cy={y(cum[minAt])} r="2.6" class="cum-pt" />
        <line x1={x(months)} x2={x(months)} y1="4" y2={H - 12} class="done" />
        <text x={x(months) + 3} y="11" class="lbl">Built</text>
        <text x="4" y={H - 2} class="lbl">Month 0</text><text x={W - 4} y={H - 2} class="lbl" text-anchor="end">{n - 1}</text>
      </svg>
      <figcaption><i class="k-bar" />net cash a month <i class="k-line" />running total</figcaption>
    </figure>
  );
}

// ================================================================ approval
const STATUS_ICON: Record<CheckStatus, string> = { pass: 'check', fail: 'x', warn: 'warn', info: 'info' };
export function ApproveStep({ p, e, up, checks, openDrawings, toast }: StepProps) {
  const sum = scrutinySummary(checks);
  const [only, setOnly] = useState<'all' | 'issues'>(sum.fail + sum.warn ? 'issues' : 'all');
  const ex = p.approval ?? {};
  const list = nocs(e, ex), docs = documents(e), fs = fees(e);
  const groups = [...new Set(checks.map((c) => c.group))];
  const shown = (c: Check) => only === 'all' || c.status === 'fail' || c.status === 'warn';
  return (
    <>
      <Section title="Scrutiny" sub="Our own check of every rule we model, as an authority's scrutiny would read it. Advisory: the authority's is the one that counts.">
        <div class="score">
          <span class="s-pass"><Icon n="check" size={14} />{sum.pass} pass</span>
          <span class="s-fail"><Icon n="x" size={14} />{sum.fail} fail</span>
          <span class="s-warn"><Icon n="warn" size={14} />{sum.warn} to check</span>
          <span class="s-info"><Icon n="info" size={14} />{sum.info} notes</span>
        </div>
        <Seg<'all' | 'issues'> small value={only} set={setOnly} options={[{ value: 'issues', label: 'Issues' }, { value: 'all', label: 'Everything' }]} />
        {groups.map((g) => {
          const cs = checks.filter((c) => c.group === g && shown(c));
          if (!cs.length) return null;
          return <div class="cgroup"><h4>{g}</h4>{cs.map((c) => (
            <details class={`chk ${c.status}`}>
              <summary><Icon n={STATUS_ICON[c.status]} size={15} /><span>{c.rule}</span><em>{c.proposed}</em></summary>
              <Lines rows={[['Required', c.required], ['Proposed', c.proposed], ['Clause', c.clause]]} />
              {c.note && <Note>{c.note}</Note>}
            </details>
          ))}</div>;
        })}
        {only === 'issues' && !sum.fail && !sum.warn && <Note tone="ok">No issues in the rules checked.</Note>}
      </Section>

      <Section title="Drawings and files" sub="Generated from the scheme. An architect checks, signs and submits them; we never submit for you.">
        <div class="exports">
          <button type="button" class="export" onClick={openDrawings}><Icon n="print" /><b>Drawing set</b><small>Site plan, floor plan, section, area statement. Print or save as PDF (A3).</small></button>
          <button type="button" class="export" onClick={() => { download(`${slug(p.name)}-predcr.dxf`, predcrDxf(e), 'application/dxf'); toast('DXF saved, on PreDCR-style layers. Check it in the PreDCR add-on before submitting.'); }}><Icon n="down" /><b>PreDCR-style DXF</b><small>Closed polylines on named layers: plot, proposed work, buildings, margins, roads, parking.</small></button>
        </div>
      </Section>

      <Section title="NOCs" aside={<span class="sec-meta">{list.filter((n) => n.needed).length} needed</span>}>
        <Toggle label="Near an airport" hint="Inside the AAI's colour-coded zone" value={!!ex.nearAirport} set={(v) => up({ approval: { ...ex, nearAirport: v } })} />
        <Toggle label="Trees on the plot" value={!!ex.trees} set={(v) => up({ approval: { ...ex, trees: v } })} />
        <Toggle label="Heritage precinct" value={!!ex.heritage} set={(v) => up({ approval: { ...ex, heritage: v } })} />
        <ul class="nocs">{[...list].sort((a, b) => +b.needed - +a.needed).map((n) => (
          <li class={n.needed ? 'on' : ''}><Icon n={n.needed ? 'check' : 'minus'} size={14} /><span><b>{n.title}</b><small>{n.authority} · {n.why}</small></span></li>
        ))}</ul>
      </Section>

      <Section title="Fees and charges" fold open={false} aside={<span class="sec-meta">{cr(fs.reduce((s, f) => s + f.amount, 0))}</span>} sub="Rough figures to plan cash with, not a demand note.">
        <Lines rows={fs.map((f) => [<span>{f.label}<small>{f.basis}</small></span>, cr(f.amount)])} />
      </Section>

      <Section title="Documents to file" fold open={false}>
        <ul class="docs">{docs.map((d) => <li><span class={`who ${d.from}`}>{d.from === 'us' ? 'UrbanPlan' : d.from}</span><span><b>{d.title}</b><small>{d.note}</small></span></li>)}</ul>
      </Section>
    </>
  );
}

// ================================================================ explore
export function ExploreStep({ p, e, up, toast }: StepProps) {
  return (
    <>
      <BriefBox p={p} up={up} toast={toast} />
      <OptionsBox p={p} up={up} toast={toast} />
      <ScreenBox p={p} />
      <LayoutBox p={p} e={e} />
    </>
  );
}

function BriefBox({ p, up, toast }: { p: ProProject; up: StepProps['up']; toast: StepProps['toast'] }) {
  const [text, setText] = useState('Mostly 2BHK, under 45 m, shops on the ground floor, best profit');
  const [res, setRes] = useState<(BriefResult & { understood: string[]; ignored: string[] }) | null>(null);
  const run = () => { const b = parseBrief(text); setRes({ ...runBrief(p, b.brief), understood: b.understood, ignored: b.ignored }); };
  return (
    <Section title="Brief" sub="Write what you want. The planner reads it, tries schemes, checks each against the rules and keeps the best that passes. (Rule-based for now, no AI model.)">
      <textarea class="brief" rows={3} value={text} onInput={(ev) => setText((ev.target as HTMLTextAreaElement).value)} onKeyDown={(ev) => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) run(); }} />
      <Row><Btn kind="primary" icon="play" onClick={run}>Plan it</Btn>{res?.best && <Btn icon="check" onClick={() => { up(res.patch); toast(`Applied: ${res.best!.label}`); }}>Use the best</Btn>}</Row>
      {res && <>
        {res.understood.length > 0 && <div class="chips">{res.understood.map((u) => <span class="chip">{u}</span>)}{res.ignored.map((u) => <span class="chip off" title="Not understood">{u}</span>)}</div>}
        <ol class="trace">{res.steps.map((s) => <li class={s.kind}>{s.text}</li>)}</ol>
        {[res.best, ...res.alternatives].filter(Boolean).map((o, i) => <OptionCard o={o!} best={i === 0} apply={() => { up(o!.patch); toast(`Applied: ${o!.label}`); }} />)}
        {!res.met && <Note tone="warn">Nothing met the whole brief: the closest is shown.</Note>}
      </>}
    </Section>
  );
}

function OptionCard({ o, best, apply }: { o: OptionRow; best?: boolean; apply: () => void }) {
  return (
    <div class={`opt${best ? ' best' : ''}`}>
      <div><b>{o.label}</b><small>{o.buildings} bldg · {o.floors} floors · {nf(o.height, 1)} m · {o.flats} flats{o.shops ? ` · ${o.shops} shops` : ''}{o.departures ? ` · ${o.departures} departure${o.departures > 1 ? 's' : ''}` : ''}</small></div>
      <div class="opt-n"><b class={o.profit < 0 ? 'bad' : ''}>{cr(o.profit)}</b><small>IRR {pct(o.irr)}</small></div>
      <Btn kind="quiet" onClick={apply}>Use</Btn>
    </div>
  );
}

function OptionsBox({ p, up, toast }: { p: ProProject; up: StepProps['up']; toast: StepProps['toast'] }) {
  const [rows, setRows] = useState<OptionRow[] | null>(null), [busy, setBusy] = useState(false);
  const run = () => { setBusy(true); setTimeout(() => { setRows(exploreOptions(p, { limit: 12 })); setBusy(false); }, 30); };
  return (
    <Section title="Options" sub="Building types, height bands, flat mixes and shops, each worked out in full and ranked by profit.">
      <Btn kind={rows ? undefined : 'primary'} icon="layers" onClick={run} disabled={busy}>{busy ? 'Working…' : rows ? 'Run again' : 'Find options'}</Btn>
      {rows && <div class="opts">{rows.map((o, i) => <OptionCard o={o} best={i === 0} apply={() => { up(o.patch); toast(`Applied: ${o.label}`); }} />)}</div>}
    </Section>
  );
}

function ScreenBox({ p }: { p: ProProject }) {
  const [text, setText] = useState('Name, frontage, depth, road, DP road\nBaner corner, 40, 55, 18, 24\nWakad, 30, 45, 12, 18\nKothrud lane, 22, 30, 9, 12');
  const [res, setRes] = useState<{ rows: ScreenResult[]; errors: string[] } | null>(null);
  return (
    <Section title="Screen many plots" fold open={false} sub="Paste plots, one a line (name, frontage, depth, road today, DP road; or name, area, road). Each gets its best scheme under these rules.">
      <textarea rows={5} value={text} onInput={(ev) => setText((ev.target as HTMLTextAreaElement).value)} />
      <Row><Btn kind="primary" onClick={() => { const x = parseScreen(text); setRes({ rows: screen(x.rows, p), errors: x.errors }); }}>Screen them</Btn>{res && res.rows.length > 0 && <Btn icon="down" onClick={() => download('screening.csv', screenCsv(res.rows), 'text/csv')}>CSV</Btn>}</Row>
      {res && <>
        {res.errors.map((x) => <Note tone="warn">{x}</Note>)}
        <div class="tscroll"><table class="sched"><thead><tr><th>Plot</th><th>m²</th><th>Built-up</th><th>Flats</th><th>Profit</th><th>IRR</th></tr></thead>
          <tbody>{res.rows.map((x) => <tr><td><b>{x.row.name}</b></td><td>{nf(x.area)}</td><td>{sqft(x.bua)}</td><td>{x.flats}</td><td class={x.profit < 0 ? 'bad' : ''}>{cr(x.profit)}</td><td>{pct(x.irr)}</td></tr>)}</tbody></table></div>
      </>}
    </Section>
  );
}

function LayoutBox({ p, e }: { p: ProProject; e: Evaluated }) {
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
