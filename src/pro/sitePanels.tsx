// The Site and Scheme panels, drawn round the canvas: the panel says what's needed and holds the numbers; the map is
// where things are drawn, picked and moved (./edit.ts).
//
// Site: the plot (drawn, found by its survey number, imported, or a rectangle by its size), the road along each
// edge at a width the plan uses, the levels and north, and what's on the site (obstructions and no-build zones).
// Scheme: "Fill the plot" (how much, what, the green, the play area, the roads, the parking), then the buildings
// and the site's things, each the user's to place, shape and set: floors, mix, design system, its systems.
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { UNIT_LABEL, type SiteElement } from '../doc/site';
import { ACCESS, TYPOLOGIES, type Typology } from '../doc/optimise';
import { CITIES, fillOf, outline, type EdgeRoad, type Fill, type ProBuilding } from './project';
import { longestEdge } from './importPlot';
import { presetOf, PRESETS } from './design';
import { shopFloorsAllowed } from './mixed';
import { buildModel, ifcLite, modelJson } from './model';
import { BUILDING_SHAPES, ELEMENT_TOOLS, own, removed, spineLength, stretched, turned, type Tool } from './edit';
import { DEFAULT_LEVELS, FEATURES, featureOf, INTERNAL_WIDTHS, PLINTH_MIN, roadParts, roadWidths, type Levels, type SiteFeature } from './siteObjects';
import { FindPlot, FlatPlan, ImportBox, slug, type StepProps } from './steps';
import { Btn, download, Icon, Lines, Note, nf, Num, Row, Section, Seg, Select, Slider, sqft, Stat, Toggle } from './ui';
import { SystemsPanel } from './systemsPanel';
import { groundAt } from './terrain';
import { mergeSettings, splitSettings } from './systems';

const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
/** an edge's outward side as a compass point */
function edgeFacing(ring: number[], k: number, north: number): string {
  let sa = 0; for (let i = 0; i < ring.length; i += 2) { const j = (i + 2) % ring.length; sa += ring[i] * ring[j + 1] - ring[j] * ring[i + 1]; }
  const i = 2 * k, j = (i + 2) % ring.length, dx = ring[j] - ring[i], dz = ring[j + 1] - ring[i + 1], L = Math.hypot(dx, dz) || 1;
  // outward normal (x east, z south), then its bearing clockwise from north
  const sg = sa > 0 ? 1 : -1, nx = (dz / L) * sg, nz = (-dx / L) * sg;
  const b = ((Math.atan2(nx, -nz) * 180) / Math.PI - north + 720) % 360;
  return DIRS[Math.round(b / 45) % 8];
}
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** A row of tools: icon and word, the active one inverted. */
function Tools({ items, tool, setTool, label }: { items: { t: Tool; label: string; icon: string }[]; tool: Tool; setTool: (t: Tool) => void; label: string }) {
  const same = (a: Tool, b: Tool) => JSON.stringify(a) === JSON.stringify(b);
  return (
    <div class="toolgrid" role="group" aria-label={label}>
      {items.map((x) => <button type="button" aria-pressed={same(x.t, tool)} onClick={() => setTool(same(x.t, tool) ? { k: 'select' } : x.t)}><Icon n={x.icon} size={18} /><span>{x.label}</span></button>)}
    </div>
  );
}

function Picked({ title, children, remove }: { title: ComponentChildren; children?: ComponentChildren; remove?: () => void }) {
  return <div class="picked"><header><b>{title}</b>{remove && <Btn kind="quiet" icon="trash" title="Remove (Delete)" onClick={remove} />}</header>{children}</div>;
}

// ================================================================ site
export function SiteStep2({ p, e, up, toast, tool, setTool, picked, pick }: StepProps) {
  const { r } = e;
  const city = CITIES.find((c) => c.value === p.city)!;
  const [sizing, setSizing] = useState(p.shape !== 'poly');
  const [importing, setImporting] = useState(false);
  const o = outline(p), north = p.north ?? 0;
  const L: Levels = { ...DEFAULT_LEVELS, ...(p.levels ?? {}) };
  const setLv = (x: Partial<Levels>) => up({ levels: { ...L, ...x } });
  const LM = p.limits ?? { maxH: 0, tod: false, todFsi: 4 };
  const setLM = (x: Partial<typeof LM>) => up({ limits: { ...LM, ...x } });
  const widths = roadWidths(r.code);
  const setEdge = (k: number, rd: EdgeRoad | null) => {
    const roads = o.roads.map((x, i) => (i === k ? rd : x));
    if (p.shape === 'poly') up({ edgeRoads: roads });
    else up({ shape: 'poly', ring: o.ring, edgeRoads: roads });
  };
  const fs = p.features ?? [];
  const setF = (id: string, x: Partial<SiteFeature>) => up({ features: fs.map((f) => (f.id === id ? { ...f, ...x } : f)) });
  const fPicked = picked?.k === 'feature' ? fs.find((f) => f.id === picked.id) : undefined;
  // the ground off the city's terrain, where the plot has a real place
  const [reading, setReading] = useState(false);
  const readGround = async (at: [number, number], ring: number[], quiet = false) => {
    setReading(true);
    let r0 = 0; for (let i = 0; i < ring.length; i += 2) r0 = Math.max(r0, Math.hypot(ring[i], ring[i + 1]));
    const g = await groundAt(at[0], at[1], Math.max(20, Math.min(80, r0))).catch(() => null);
    setReading(false);
    if (!g) { if (!quiet) toast('No terrain for this place yet: set the levels by hand.'); return; }
    up({ at, north: 0, levels: { ...L, slope: g.slope < 0.5 ? 0 : g.slope, dir: (Math.round(g.dir / 45) * 45) % 360, asl: g.elevation, terrain: true } });
    toast(`The ground, off the terrain: ${nf(g.elevation)} m over sea level, ${g.slope < 0.5 ? 'about level' : `${nf(g.slope)}% falling ${DIRS[Math.round(g.dir / 45) % 8]}`}.`);
  };
  const found = (ring: number[], src: string, name?: string, at?: [number, number] | null) => {
    const k = longestEdge(ring);
    up({ shape: 'poly', ring, at: at ?? undefined, edgeRoads: Array.from({ length: ring.length / 2 }, (_, i) => (i === k ? { today: 12, dp: 0 } : null)), ...(name ? { name } : {}) });
    toast(`${src}. The longest edge has the road: set the real roads below.`);
    if (at) void readGround(at, ring, true);
  };
  return (
    <>
      <Section title="Rules">
        <Select label="Planning authority" value={p.city} onChange={(v) => up({ city: v })} options={CITIES.map((c) => ({ value: c.value, label: c.label }))} />
        <Note>{city.note}</Note>
      </Section>

      <Section title="Plot" aside={<span class="sec-meta">{nf(r.area)} m² · {sqft(r.area)}</span>}>
        <Tools label="Plot" tool={tool} setTool={setTool} items={[{ t: { k: 'plot' }, label: 'Draw it', icon: 'edit' }]} />
        <p class="hint-line"><Icon n="cursor" size={14} />Drag its corners on the map to change it.</p>
        <button type="button" class="linkbtn" aria-expanded={sizing} onClick={() => setSizing(!sizing)}><Icon n="plan" size={14} /> A rectangle by its size</button>
        {sizing && <Row><Num label="Frontage" value={p.width} set={(v) => up({ width: v, shape: 'rect' })} min={10} max={600} unit="m" /><Num label="Depth" value={p.depth} set={(v) => up({ depth: v, shape: 'rect' })} min={10} max={600} unit="m" /></Row>}
        <FindPlot done={(ring, src, at) => found(ring, src, src.split(' · ')[0], at)} />
        <button type="button" class="linkbtn" aria-expanded={importing} onClick={() => setImporting(!importing)}><Icon n="upload" size={14} /> Import the outline from a file or coordinates</button>
        {importing && <ImportBox done={(ring, src, at) => { found(ring, `Outline from ${src}`, undefined, at); setImporting(false); }} />}
      </Section>

      <Section title="Roads" sub="The road along each edge, at the widths the plan uses. The DP width sets the rules.">
        <div class="edges">{o.roads.map((rd, k) => {
          const i = 2 * k, j = (i + 2) % o.ring.length, len = Math.hypot(o.ring[j] - o.ring[i], o.ring[j + 1] - o.ring[i + 1]);
          const pr = rd ? roadParts(Math.max(rd.today, rd.dp)) : null;
          return (
            <div class="edge">
              <span class="edge-n"><b>{cap(edgeFacing(o.ring, k, north))}</b><small>{nf(len, 1)} m</small></span>
              <Select<number> size="sm" aria-label={`Road on the ${edgeFacing(o.ring, k, north)} edge today`} value={rd?.today ?? 0} onChange={(v) => setEdge(k, v ? { today: v, dp: Math.max(rd?.dp ?? 0, 0) } : null)}
                options={[{ value: 0, label: 'No road' }, ...widths.map((w) => ({ value: w, label: `${w} m road` }))]} />
              {rd && <Select<number> size="sm" aria-label="Its width in the DP" value={rd.dp > rd.today ? rd.dp : 0} onChange={(v) => setEdge(k, { today: rd.today, dp: v })}
                options={[{ value: 0, label: 'DP: same' }, ...widths.filter((w) => w > rd.today).map((w) => ({ value: w, label: `DP: ${w} m` }))]} />}
              {pr && pr.foot > 0 && <small class="edge-p">{nf(pr.carriage, 1)} m carriageway, {nf(pr.foot, 1)} m footpaths</small>}
            </div>
          );
        })}</div>
        {!o.roads.some(Boolean) && <Note tone="warn">No road along the plot: give one edge a road.</Note>}
      </Section>

      <Section title="Levels and north" fold open={!!(p.levels || p.north)}>
        <Row>
          <Num label="Plot over the road" value={L.plot} set={(v) => setLv({ plot: v })} min={-10} max={30} step={0.1} unit="m" />
          <Num label="Slope" value={L.slope} set={(v) => setLv({ slope: v, terrain: false })} min={0} max={60} step={0.5} unit="%" />
        </Row>
        {p.at
          ? <><Note>{L.terrain ? `Off the city's terrain${L.asl !== undefined ? `, ${nf(L.asl)} m over sea level` : ''}. A first figure: a contour survey beats it.` : 'Set by hand.'}</Note>
            <Row><Btn icon="level" disabled={reading} onClick={() => readGround(p.at!, outline(p).ring)}>{reading ? 'Reading…' : L.terrain ? 'Read it again' : 'Read the terrain'}</Btn></Row></>
          : <Note>Find or import the plot to read its slope off the terrain.</Note>}
        {L.slope > 0 && <Select<number> label="Falls toward" value={L.dir} onChange={(v) => setLv({ dir: v, terrain: false })} options={DIRS.map((d, i) => ({ value: i * 45, label: cap(d) }))} />}
        <Num label="North, turned clockwise" value={north} set={(v) => up({ north: ((v % 360) + 360) % 360 })} min={-360} max={360} step={5} unit="°" hint={p.at ? "Set from where the plot is. The compass on the map follows." : "0: the front road is on the north side. The compass on the map follows."} />
        {L.plot < PLINTH_MIN && <Note tone="warn">The plinth must stand at least {PLINTH_MIN} m over the road: {L.plot < 0 ? 'the plot is below it, so plan the drainage and fill' : `about ${nf(PLINTH_MIN - L.plot, 2)} m of fill or a raised plinth`}.</Note>}
        {L.slope >= 15 && <Note tone="warn">A steep plot ({nf(L.slope)}%): expect retaining walls and stepped floors, and a hill-slope check by the authority.</Note>}
      </Section>

      <Section title="On the site" sub="Obstructions and no-build zones. Draw them on the map: the scheme keeps clear of them.">
        <Tools label="Draw on the site" tool={tool} setTool={setTool} items={FEATURES.map((f) => ({ t: { k: 'feature', kind: f.kind }, label: f.label, icon: f.icon }))} />
        {fs.length > 0 && <ul class="flist">{fs.map((f, i) => {
          const F = featureOf(f.kind), n = fs.slice(0, i).filter((x) => x.kind === f.kind).length + 1;
          return <li aria-current={fPicked?.id === f.id ? 'true' : undefined}><button type="button" class="fitem" onClick={() => pick({ k: 'feature', id: f.id })}><Icon n={F.icon} size={16} /><span>{F.label} {n}</span><small>{nf(f.clear ?? F.clear, 1)} m clear</small></button></li>;
        })}</ul>}
        {fPicked && (() => { const F = featureOf(fPicked.kind); return (
          <Picked title={F.label} remove={() => { up(removed(p, e, { k: 'feature', id: fPicked.id })); pick(null); }}>
            <Row>
              {F.shape === 'point' && <Num label={fPicked.kind === 'tree' ? 'Canopy radius' : 'Radius'} value={fPicked.r ?? F.r} set={(v) => setF(fPicked.id, { r: v })} min={0.2} max={30} step={0.5} unit="m" />}
              <Num label="Kept clear round it" value={fPicked.clear ?? F.clear} set={(v) => setF(fPicked.id, { clear: v })} min={0} max={60} step={0.5} unit="m" />
            </Row>
            {fPicked.kind === 'nobuild' && <label class="f"><span class="f-l">Why</span><input class="txt" value={fPicked.note ?? ''} placeholder="An easement, a heritage buffer…" onChange={(ev) => setF(fPicked.id, { note: (ev.target as HTMLInputElement).value })} /></label>}
            {fPicked.kind === 'power' && <Note>High-tension lines: about 7.5 m each side for 33 kV, more above (check with the power company).</Note>}
          </Picked>
        ); })()}
      </Section>

      <Section title="What the rules give" fold open={false} sub={`On a ${nf(r.roadW)} m road${r.roadW !== (r.road?.today ?? r.roadW) ? ' (the DP width)' : ''}.`}>
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

      <Section title="The site's own limits" fold open={!!(LM.maxH || LM.tod)} sub="Over the code's: an airport or fire height cap, a transit zone near a metro station.">
        <Num label="Height cap (0: none)" value={LM.maxH} set={(v) => setLM({ maxH: v })} max={900} unit="m" hint="From the AAI colour-coded zoning map, or a fire or heritage limit" />
        <Toggle label="Transit-oriented zone" hint="Near a metro station: more FSI with premium" value={LM.tod} set={(v) => setLM({ tod: v })} />
        {LM.tod && <Num label="Total FSI in the zone" value={LM.todFsi} set={(v) => setLM({ todFsi: v })} min={1} max={6} step={0.1} />}
      </Section>
    </>
  );
}

// ================================================================ scheme
const PARKING: { value: Fill['parking']; label: string; title: string }[] = [
  { value: 'auto', label: 'Auto', title: 'Whatever needs the fewest basements' },
  { value: 'stilt', label: 'Stilt', title: 'The ground floor as parking, flats above' },
  { value: 'basement', label: 'Basement', title: 'Under the ground' },
  { value: 'podium', label: 'Podium', title: 'Two levels of parking over the ground' },
  { value: 'surface', label: 'Open', title: 'Bays on the open ground' },
];

export function SchemeStep({ p, e, up, rooms, toast, tool, setTool, picked, pick }: StepProps) {
  const { r, d, shops } = e;
  const f = fillOf(p), setFill = (x: Partial<Fill>) => up({ fill: { ...(p.fill ?? {}), ...x } });
  const owned = !!p.scheme;
  const mixPct = p.mix.map((x) => Math.round(x * 100));
  const setMix = (i: number, v: number) => { const m = [...p.mix] as [number, number, number]; m[i] = v / 100; const s = m[0] + m[1] + m[2] || 1; up({ mix: m.map((x) => x / s) as [number, number, number] }); };
  const sh = p.shops ?? { floors: 0, depth: 9, sale: 0 };
  const setShops = (x: Partial<typeof sh>) => up({ shops: { ...sh, ...x } });
  const allowed = shopFloorsAllowed(r.roadW);
  // the picked building: its report, and the user's own copy (taken over on the first change)
  const bi = picked?.k === 'building' ? d.buildings.findIndex((b) => b.b.id === picked.id) : -1;
  const br = bi >= 0 ? d.buildings[bi] : null;
  const setB = (fn: (b: ProBuilding) => ProBuilding) => { if (!br) return; const s = own(p, e); up({ scheme: { ...s, buildings: s.buildings.map((b) => (b.id === br.b.id ? fn(b) : b)) } }); };
  const ownB = br ? (p.scheme?.buildings.find((b) => b.id === br.b.id) ?? { ...br.b, floors: br.floors }) as ProBuilding : null;
  const el = picked?.k === 'element' ? (d.site.elements ?? []).find((x) => x.id === picked.id) : undefined;
  const setEl = (x: Partial<SiteElement>) => { if (!el) return; const s = own(p, e); up({ scheme: { ...s, elements: s.elements.map((y) => (y.id === el.id ? { ...y, ...x } : y)) } }); };
  const nameOf = (i: number) => (p.scheme?.buildings.find((b) => b.id === d.buildings[i].b.id)?.name) ?? `Building ${String.fromCharCode(65 + i)}`;
  const deps = br ? d.departures.filter((x) => x.ids.includes(br.b.id)) : [];
  if ((br && ownB) || el) return (
    <>
      <button type="button" class="backlink" onClick={() => pick(null)}><Icon n="chevron" size={14} /> All buildings</button>
        {br && ownB && (
      <Picked title={<>{nameOf(bi)}<small> · {nf(br.plate)} m² plate</small></>} remove={() => { up(removed(p, e, { k: 'building', id: br.b.id })); pick(null); }}>
        {deps.map((x) => <Note tone="bad">{x.text}</Note>)}
        <label class="f"><span class="f-l">Name</span><input class="txt" value={ownB.name ?? nameOf(bi)} onChange={(ev) => setB((b) => ({ ...b, name: (ev.target as HTMLInputElement).value }))} /></label>
        <Row>
          <Num label="Floors" value={br.floors} set={(v) => setB((b) => ({ ...b, floors: Math.max(1, v) }))} min={1} max={300} hint={`${br.maxFloors} fit the margins`} />
          <Num label="Depth" value={ownB.depth} set={(v) => setB((b) => ({ ...b, depth: v }))} min={6} max={80} step={0.5} unit="m" />
        </Row>
        <Row>
          <Num label="Length" value={Math.round(spineLength(ownB) * 10) / 10} set={(v) => setB((b) => stretched(b, v))} min={4} max={600} step={0.5} unit="m" />
          <div class="f"><span class="f-l">Turn</span><div class="turns">
            <Btn kind="ghost" title="Turn 15° anticlockwise" onClick={() => setB((b) => turned(b, -15))}>−15°</Btn>
            <Btn kind="ghost" title="Turn 15° clockwise" onClick={() => setB((b) => turned(b, 15))}>+15°</Btn>
            <Btn kind="ghost" title="Turn a quarter" onClick={() => setB((b) => turned(b, 90))}>90°</Btn>
          </div></div>
        </Row>
        <Toggle label="Its own flat mix" value={!!ownB.mix} set={(v) => setB((b) => ({ ...b, mix: v ? [...p.mix] as [number, number, number] : undefined }))} />
        {ownB.mix && <Row n={3}>{[0, 1, 2].map((t) => <Num label={UNIT_LABEL[t]} value={Math.round(ownB.mix![t] * 100)} set={(v) => setB((b) => { const m = [...(b.mix ?? p.mix)] as [number, number, number]; m[t] = v / 100; const s = m[0] + m[1] + m[2] || 1; return { ...b, mix: m.map((x) => x / s) as [number, number, number] }; })} max={100} step={5} unit="%" />)}</Row>}
        <Select<string> label="Design system" value={ownB.style ?? ''} onChange={(v) => setB((b) => ({ ...b, style: v || undefined }))} options={[{ value: '', label: `The project's (${presetOf(p.style).name})` }, ...PRESETS.map((x) => ({ value: x.id, label: x.name }))]} />
        <Row><Btn icon="plus" onClick={() => { const s = own(p, e), src = s.buildings.find((b) => b.id === br.b.id); if (!src) return; const c = { ...src, id: `b${Date.now().toString(36)}`, name: `${src.name ?? 'Building'} copy`, spine: src.spine.map((q, i) => q + (i % 2 ? 0 : src.depth + 6)) }; up({ scheme: { ...s, buildings: [...s.buildings, c] } }); pick({ k: 'building', id: c.id }); }}>Duplicate</Btn></Row>
        <Section title="Systems" fold open={false} sub="Stairs, lifts, ducts, plumbing, power and fire: sized for it, each one yours to set."><SystemsPanel b={br} settings={mergeSettings(p.systems?.byBuilding?.[br.b.id], p.systems?.site)} under={d.under} floorH={r.rules.floorH} code={r.code} name={nameOf(bi)} basements={d.site.basements} bays={d.parking.have}
          set={(x) => { const { building, plant } = splitSettings(x); up({ systems: { site: plant, byBuilding: { ...(p.systems?.byBuilding ?? {}), [br.b.id]: building } } }); }} /></Section>
        <Section title="Flat plans" fold open={false} sub="Rooms fitted into each flat of a typical floor, checked against the minimum room sizes.">
          <div class="flats">{(rooms[bi] ?? []).filter((fr, k, a) => fr.t < 3 && fr.rooms.length && a.findIndex((y) => y.t === fr.t) === k).map((fr) => <FlatPlan t={fr.t} fr={fr} />)}</div>
        </Section>
      </Picked>
    )}
    {el && (
      <Picked title={ELEMENT_TOOLS.find((x) => x.kind === el.kind)?.label ?? 'On the site'} remove={() => { up(removed(p, e, { k: 'element', id: el.id })); pick(null); }}>
        {el.kind === 'road' && <Select<number> label="Width" value={el.depth} onChange={(v) => setEl({ depth: v })} options={INTERNAL_WIDTHS.map((w) => ({ value: w, label: `${w} m` }))} />}
        {el.kind === 'parking' && <Num label="Levels" value={el.levels ?? 3} set={(v) => setEl({ levels: v })} min={1} max={12} />}
        <Note>Drag it on the map to move it.</Note>
      </Picked>
    )}
    </>
  );
  return (
    <>
      <Section title="Fill the plot" aside={owned ? <span class="sec-meta">shaped by hand</span> : <span class="sec-meta">live</span>}>
        {owned
          ? <><Note>The buildings are yours: drag them on the map, set each one below. Filling again replaces them.</Note>
            <Row><Btn icon="spark" onClick={() => { up({ scheme: undefined }); pick(null); toast('Filled again from the settings.'); }}>Fill again</Btn></Row></>
          : <>
            <Slider label="How much" value={Math.round(f.amount * 100)} set={(v) => setFill({ amount: v / 100 })} min={30} max={100} step={5} fmt={(v) => (v >= 100 ? 'All the rules allow' : `${v}% of what's allowed`)} />
            <Seg<Typology> value={p.typology} set={(v) => up({ typology: v })} label="Building type" options={TYPOLOGIES} />
            <Row>
              <Num label="Most floors" value={p.maxFloors} set={(v) => up({ maxFloors: v })} min={0} max={300} hint={p.maxFloors ? undefined : "0: as the rules allow"} />
              <Num label="Most buildings" value={f.buildings} set={(v) => setFill({ buildings: v })} min={0} max={40} hint={f.buildings ? undefined : "0: as many as fit"} />
            </Row>
          </>}
      </Section>

      <Section title="Living" sub="Green, play, roads inside, spacing and parking." fold open={false} aside={<span class="sec-meta">{f.green ? `${f.green}% green` : 'as the rules ask'}</span>}>
        <Slider label="Green" value={f.green} set={(v) => setFill({ green: v })} min={0} max={50} step={5} fmt={(v) => (v ? `At least ${v}% of the plot` : 'What the rules ask')} />
        <Toggle label="Play area" hint="In the open space" value={f.play} set={(v) => setFill({ play: v })} />
        <Seg value={f.access} set={(v) => setFill({ access: v })} label="Roads inside" options={ACCESS.map((a) => ({ value: a.value, label: a.label, title: a.title }))} />
        <Num label="More space between buildings" value={f.spacing} set={(v) => setFill({ spacing: v })} min={0} max={40} unit="m" hint="Over what the rules ask: light, privacy" />
        <Seg<Fill['parking']> value={f.parking} set={(v) => setFill({ parking: v })} label="Parking" options={PARKING} />
        <Num label="Basements" value={f.basements ?? d.site.basements} set={(v) => setFill({ basements: v })} min={0} max={12} hint={f.basements === undefined ? 'As many as the parking needs' : 'As set'} />
        {owned && <Note>These apply when you fill again; parking and basements apply now.</Note>}
      </Section>

      <Section title="Flat mix" fold open={false} aside={<span class="sec-meta">{d.flats} flats</span>} sub="Every building, unless one has its own.">
        <div class="mixbar" aria-hidden="true">{[0, 1, 2].map((i) => <i class={`m${i}`} style={`flex:${p.mix[i] || 0.0001}`}>{mixPct[i] >= 12 ? `${mixPct[i]}%` : ''}</i>)}</div>
        <Row n={3}>{[0, 1, 2].map((i) => <Num label={UNIT_LABEL[i]} value={mixPct[i]} set={(v) => setMix(i, v)} max={100} step={5} unit="%" />)}</Row>
        <Note>{[0, 1, 2].filter((t) => d.count[t]).map((t) => `${d.count[t]} × ${UNIT_LABEL[t]}`).join(' · ') || 'No flats fit.'}</Note>
      </Section>

      <Section title="Add" sub="Pick one, then click or drag on the map.">
        <Tools label="Buildings" tool={tool} setTool={setTool} items={BUILDING_SHAPES.map((s) => ({ t: { k: 'building', shape: s.shape }, label: s.label, icon: s.icon }))} />
        <Tools label="On the site" tool={tool} setTool={setTool} items={ELEMENT_TOOLS.map((s) => ({ t: { k: 'element', kind: s.kind }, label: s.label, icon: s.icon }))} />
      </Section>

      <Section title="Buildings" aside={<span class="sec-meta">{d.buildings.length}</span>}>
        <ul class="blist">{d.buildings.map((b, i) => (
          <li aria-current={bi === i ? 'true' : undefined}>
            <button type="button" class="bitem" onClick={() => pick(bi === i ? null : { k: 'building', id: b.b.id })}>
              <b class="bname">{String.fromCharCode(65 + i)}</b>
              <span><b>{nameOf(i)}</b><small>{b.floors} floors · {nf(b.height, 1)} m · {b.perFloor.slice(0, 3).reduce((s, x) => s + x, 0) * b.floors} flats</small></span>
              {b.clash || b.overHeight ? <Icon n="warn" size={16} /> : null}
            </button>
          </li>
        ))}</ul>
        {!d.buildings.length && <Note tone="warn">No buildings. Fill the plot, or add one from above.</Note>}
      </Section>

      <Section title="Shops at the front" fold open={sh.floors > 0} aside={shops ? <span class="sec-meta">{shops.count} shops</span> : undefined}>
        <Seg<string> value={String(sh.floors)} set={(v) => setShops({ floors: +v })} options={[{ value: '0', label: 'None' }, { value: '1', label: 'Ground' }, { value: '2', label: 'G + 1' }, { value: '3', label: 'G + 2' }]} />
        {sh.floors > 0 && <>
          <Row>
            <Num label="Depth from the front" value={sh.depth} set={(v) => setShops({ depth: v })} min={4} max={30} unit="m" />
            <Num label="Price (0: 1.8× the flats)" value={sh.sale} set={(v) => setShops({ sale: v })} step={500} max={300000} unit="₹/ft²" />
          </Row>
          <Note tone={allowed >= sh.floors ? undefined : 'warn'}>{allowed === 0 ? `A ${nf(r.roadW)} m road allows no shops (9 m and wider).` : `A ${nf(r.roadW)} m road allows shops on ${allowed >= 99 ? 'every floor' : allowed === 1 ? 'the ground floor' : `${allowed} floors`} (as assumed: check the zone).`}</Note>
        </>}
      </Section>

      <Section title="Parking" fold open={d.parking.have < d.parking.need} aside={<span class={`sec-meta ${d.parking.have >= d.parking.need ? 'ok' : 'bad'}`}>{d.parking.have} / {d.parking.need}</span>}>
        <Lines rows={[
          ['Cars needed', nf(d.parking.need)],
          ['Bays laid out', nf(d.parking.have)],
          ...d.parking.levels.filter((l) => l.bays.length).map((l) => [l.kind[0].toUpperCase() + l.kind.slice(1), `${l.bays.length} bays`] as [string, string]),
          ['Scooters', nf(d.parking.scooters)],
        ]} />
      </Section>

      <Section title="The buildings as data" fold open={false} sub="Every floor, flat, room, window and door: JSON for scripts, IFC for Revit and other BIM tools (spaces only).">
        <Row>
          <Btn icon="down" onClick={() => { download(`${slug(p.name)}.model.json`, modelJson(buildModel(e, rooms)), 'application/json'); toast('Model saved as JSON.'); }}>Model JSON</Btn>
          <Btn icon="down" onClick={() => { download(`${slug(p.name)}.ifc`, ifcLite(e, rooms), 'application/x-step'); toast('IFC saved: open it in Revit, ArchiCAD or BIMvision.'); }}>IFC (spaces)</Btn>
        </Row>
      </Section>
    </>
  );
}
