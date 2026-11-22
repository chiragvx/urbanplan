// The Site and Scheme panels, drawn round the canvas: the panel says what's needed and holds the numbers; the map is
// where things are drawn, picked and moved (./edit.ts).
//
// Site: the plot (drawn, found by its survey number, imported, or a rectangle by its size), the road along each
// edge, its levels and north on the map (./plotHud.tsx); here its survey number or an import, and what's on the site (obstructions and no-build zones).
// Scheme: "Fill the plot" (how much, what, the green, the play area, the roads, the parking), then the buildings
// and the site's things, each the user's to place, shape and set: floors, mix, design system, its systems.
import { useEffect, useState } from 'preact/hooks';
import { UNIT_LABEL } from '../doc/site';
import { ACCESS, TYPOLOGIES, type Typology } from '../doc/optimise';
import { CITIES, fillOf, type Fill } from './project';
import { longestEdge } from './importPlot';
import { readGround } from './plotOps';
import { shopFloorsAllowed } from './mixed';
import { featureOf } from './siteObjects';
import { FindPlot, ImportBox, type StepProps } from './steps';
import { Btn, Icon, Lines, Note, nf, Num, Row, Section, Seg, Select, Slider, sqft, Toggle } from './ui';
import { LadderBox } from './numbersUi';

type PlotWay = 'view' | 'survey' | 'import';

// ================================================================ site
export function SiteStep2({ p, e, up, toast, tool, picked, pick, openStatement, part }: StepProps) {
  const B = part !== 'design', D = part !== 'brief';
  const { r } = e;
  const city = CITIES.find((c) => c.value === p.city)!;
  // (the dashboard can ask for a plot found by its survey number or imported: that way open, once)
  const [way, setWay] = useState<PlotWay>(() => {
    try { const w = sessionStorage.getItem('urbanplan:pro:way'); if (w === 'survey' || w === 'import') { sessionStorage.removeItem('urbanplan:pro:way'); return w; } } catch { /* */ }
    return 'view';
  });
  useEffect(() => { const on = (ev: Event) => setWay((ev as CustomEvent<PlotWay>).detail); addEventListener('urbanplan:way', on); return () => removeEventListener('urbanplan:way', on); }, []);
  const LM = p.limits ?? { maxH: 0, tod: false, todFsi: 4 };
  const setLM = (x: Partial<typeof LM>) => up({ limits: { ...LM, ...x } });
  const fs = p.features ?? [];
  const fPicked = picked?.k === 'feature' ? fs.find((f) => f.id === picked.id) : undefined;
  const found = (ring: number[], src: string, name?: string, at?: [number, number] | null) => {
    const k = longestEdge(ring);
    up({ shape: 'poly', ring, at: at ?? undefined, edgeRoads: Array.from({ length: ring.length / 2 }, (_, i) => (i === k ? { today: 12, dp: 0 } : null)), ...(name ? { name } : {}) });
    toast(`${src}. The longest edge has the road: set the real roads with the chips on the map.`);
    if (at) void readGround({ ...p, shape: 'poly', ring, at }, at, ring, { front: { k, w: 12 } }).then((res) => { if ('change' in res) up(res.change); });
  };
  return (
    <>
      {B && <Section title="Rules">
        <Select label="Planning authority" hint={city.note} value={p.city} onChange={(v) => up({ city: v })} options={CITIES.map((c) => ({ value: c.value, label: c.label }))} />
      </Section>}

      {D && <Section title="Plot" aside={<span class="sec-meta">{nf(r.area)} m² · {sqft(r.area)}</span>}>
        <p class="hint-line"><Icon n="edit" size={14} />Drag its corners on the map, type its edges' lengths there, and set each edge's road with its chip. The plot's bar on the map has its size, levels and the authority.</p>
        <Seg<PlotWay> value={way} set={setWay} options={[{ value: 'view', label: 'On the map' }, { value: 'survey', label: 'Survey no.' }, { value: 'import', label: 'Import' }]} ariaLabel="Set the plot by" />
        {way === 'survey' && <FindPlot start cancel={() => setWay('view')} done={(ring, src, at) => { found(ring, src, src.split(' · ')[0], at); setWay('view'); }} />}
        {way === 'import' && <ImportBox done={(ring, src, at) => { found(ring, `Outline from ${src}`, undefined, at); setWay('view'); }} />}
      </Section>}

      {B && <LadderBox p={p} e={e} up={up} openStatement={openStatement} />}
      {D && <Section title="On the site" fold open={fs.length > 0 || tool.k === 'feature'} aside={<span class="sec-meta">{fs.length ? `${fs.length} marked` : 'none'}</span>} sub="What to build round: draw it from the tools on the map's left edge (the tree), then drag its points and rings there.">
        {fs.length > 0 && <ul class="flist">{fs.map((f, i) => {
          const F = featureOf(f.kind), n = fs.slice(0, i).filter((x) => x.kind === f.kind).length + 1;
          return <li aria-current={fPicked?.id === f.id ? 'true' : undefined}><button type="button" class="fitem" onClick={() => pick({ k: 'feature', id: f.id })}><Icon n={F.icon} size={16} /><span>{F.label} {n}</span><small>{nf(f.clear ?? F.clear, 1)} m clear</small></button></li>;
        })}</ul>}
      </Section>}


      {B && <Section title="Constraints" fold open={!!(LM.maxH || LM.tod)} sub="An airport or fire height cap, a metro transit zone.">
        <Num label="Height cap (0: none)" value={LM.maxH} set={(v) => setLM({ maxH: v })} max={900} unit="m" hint="From the AAI colour-coded zoning map, or a fire or heritage limit" />
        <Toggle label="Transit-oriented zone" hint="Near a metro station: more FSI with premium" value={LM.tod} set={(v) => setLM({ tod: v })} />
        {LM.tod && <Num label="Total FSI in the zone" value={LM.todFsi} set={(v) => setLM({ todFsi: v })} min={1} max={6} step={0.1} />}
      </Section>}
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

export function SchemeStep({ p, e, up, toast, picked, pick, show, part }: StepProps) {
  const B = part !== 'design', D = part !== 'brief';
  const { r, d, shops } = e;
  const f = fillOf(p), setFill = (x: Partial<Fill>) => up({ fill: { ...(p.fill ?? {}), ...x } });
  const owned = !!p.scheme;
  const mixPct = p.mix.map((x) => Math.round(x * 100));
  const setMix = (i: number, v: number) => { const m = [...p.mix] as [number, number, number]; m[i] = v / 100; const s = m[0] + m[1] + m[2] || 1; up({ mix: m.map((x) => x / s) as [number, number, number] }); };
  const sh = p.shops ?? { floors: 0, depth: 9, sale: 0 };
  const setShops = (x: Partial<typeof sh>) => up({ shops: { ...sh, ...x } });
  const allowed = shopFloorsAllowed(r.roadW);
  const bi = picked?.k === 'building' ? d.buildings.findIndex((b) => b.b.id === picked.id) : -1;
  const nameOf = (i: number) => (p.scheme?.buildings.find((b) => b.id === d.buildings[i].b.id)?.name) ?? `Building ${String.fromCharCode(65 + i)}`;
  return (
    <>
      {B && <Section title="Fill the plot" aside={owned ? <span class="sec-meta">shaped by hand</span> : undefined}>
        {owned
          ? <><Note>The buildings are yours: drag them on the map, set each one below. Filling again replaces them.</Note>
            <Row><Btn icon="spark" onClick={() => { up({ scheme: undefined }); pick(null); toast('Filled again from the settings.'); }}>Fill again</Btn></Row></>
          : <>
            <Slider label="How much of it to build" value={Math.round(f.amount * 100)} set={(v) => setFill({ amount: v / 100 })} min={30} max={100} step={5} fmt={(v) => (v >= 100 ? 'All the FSI taken' : `${v}% of the FSI taken`)} />
            <Seg<Typology> value={p.typology} set={(v) => up({ typology: v })} label="Building type" options={TYPOLOGIES} />
            <Row>
              <Num label="Most floors" value={p.maxFloors} set={(v) => up({ maxFloors: v })} min={0} max={300} zero="Auto" />
              <Num label="Most buildings" value={f.buildings} set={(v) => setFill({ buildings: v })} min={0} max={40} zero="Auto" />
            </Row>
          </>}
      </Section>}

      {D && <Section title="Living" sub="Green, play, roads inside, spacing and parking." fold open={false} aside={<span class="sec-meta">{f.green ? `${f.green}% green` : 'rules minimum'}</span>}>
        <Slider label="Green" value={f.green} set={(v) => setFill({ green: v })} min={0} max={50} step={5} fmt={(v) => (v ? `At least ${v}% of the plot` : 'What the rules ask')} />
        <Toggle label="Play area" hint="In the open space" value={f.play} set={(v) => setFill({ play: v })} />
        <Seg value={f.access} set={(v) => setFill({ access: v })} label="Roads inside" options={ACCESS.map((a) => ({ value: a.value, label: a.label, title: a.title }))} />
        <Num label="More space between buildings" value={f.spacing} set={(v) => setFill({ spacing: v })} min={0} max={40} unit="m" hint="Over what the rules ask: light, privacy" />
        <Seg<Fill['parking']> value={f.parking} set={(v) => setFill({ parking: v })} label="Parking" options={PARKING} />
        <Num label="Basements" value={f.basements ?? d.site.basements} set={(v) => setFill({ basements: v })} min={0} max={12} hint={f.basements === undefined ? 'As many as the parking needs' : 'As set'} />
        {owned && <Note>These apply when you fill again; parking and basements apply now.</Note>}
      </Section>}

      {B && <Section title="Flat mix" fold open={false} aside={<span class="sec-meta">{d.flats} flats</span>} sub="Every building, unless one has its own.">
        <div class="mixbar" aria-hidden="true">{[0, 1, 2].map((i) => <i class={`m${i}`} style={`flex:${p.mix[i] || 0.0001}`}>{mixPct[i] >= 12 ? `${mixPct[i]}%` : ''}</i>)}</div>
        <Row n={3}>{[0, 1, 2].map((i) => <Num label={UNIT_LABEL[i]} value={mixPct[i]} set={(v) => setMix(i, v)} max={100} step={5} unit="%" />)}</Row>
        <Note>{[0, 1, 2].filter((t) => d.count[t]).map((t) => `${d.count[t]} × ${UNIT_LABEL[t]}`).join(' · ') || 'No flats fit.'}</Note>
      </Section>}

      {D && <Section title="Buildings" aside={<span class="sec-meta">{d.buildings.length}</span>}>
        <ul class="blist">{d.buildings.map((b, i) => (
          <li aria-current={bi === i ? 'true' : undefined}>
            <button type="button" class="bitem" onClick={() => (bi === i ? pick(null) : show(b.b.id))}>
              <b class="bname">{String.fromCharCode(65 + i)}</b>
              <span><b>{nameOf(i)}</b><small>{b.floors} floors · {nf(b.height, 1)} m · {b.perFloor.slice(0, 3).reduce((s, x) => s + x, 0) * b.floors} flats</small></span>
              {b.clash || b.overHeight ? <Icon n="warn" size={16} /> : null}
            </button>
          </li>
        ))}</ul>
        {!d.buildings.length && <Note tone="warn">No buildings. Fill the plot, or add one from the tools on the map's left edge.</Note>}
        <Note>Add buildings, gardens, parking, roads, gates and walls from the tools on the map's left edge. Pick one to edit it in the inspector.</Note>
      </Section>}

      {D && <Section title="Shops at the front" fold open={sh.floors > 0} aside={shops ? <span class="sec-meta">{shops.count} shops</span> : undefined}>
        <Seg<string> value={String(sh.floors)} set={(v) => setShops({ floors: +v })} options={[{ value: '0', label: 'None' }, { value: '1', label: 'Ground' }, { value: '2', label: 'G + 1' }, { value: '3', label: 'G + 2' }]} />
        {sh.floors > 0 && <>
          <Row>
            <Num label="Depth from the front" value={sh.depth} set={(v) => setShops({ depth: v })} min={4} max={30} unit="m" />
            <Num label="Price (0: 1.8× the flats)" value={sh.sale} set={(v) => setShops({ sale: v })} step={500} max={300000} unit="₹/ft²" />
          </Row>
          <Note tone={allowed >= sh.floors ? undefined : 'warn'}>{allowed === 0 ? `A ${nf(r.roadW)} m road allows no shops (9 m and wider).` : `A ${nf(r.roadW)} m road allows shops on ${allowed >= 99 ? 'every floor' : allowed === 1 ? 'the ground floor' : `${allowed} floors`} (as assumed: check the zone).`}</Note>
        </>}
      </Section>}

      {D && <Section title="Parking" fold open={d.parking.have < d.parking.need} aside={<span class={`sec-meta ${d.parking.have >= d.parking.need ? 'ok' : 'bad'}`}>{d.parking.have} / {d.parking.need}</span>}>
        <Lines rows={[
          ['Cars needed', nf(d.parking.need)],
          ['Bays laid out', nf(d.parking.have)],
          ...d.parking.levels.filter((l) => l.bays.length).map((l) => [l.kind[0].toUpperCase() + l.kind.slice(1), `${l.bays.length} bays`] as [string, string]),
          ['Scooters', nf(d.parking.scooters)],
        ]} />
      </Section>}

    </>
  );
}
