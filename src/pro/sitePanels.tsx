// The Site and Scheme panels, drawn round the canvas: the panel says what's needed and holds the numbers; the map is
// where things are drawn, picked and moved (./edit.ts).
//
// Site: the plot (drawn, found by its survey number, imported, or a rectangle by its size), the road along each
// edge, its levels and north on the map (./plotHud.tsx); here its survey number or an import, and what's on the site (obstructions and no-build zones).
// Scheme: "Fill the plot" (how much, what, the green, the play area, the roads, the parking), then the buildings
// and the site's things, each the user's to place, shape and set: floors, mix, design system, its systems.
import { useEffect, useState } from 'preact/hooks';
import { SQFT, UNIT_LABEL } from '../doc/site';
import { sizesOf } from './floor';
import { ACCESS, TYPOLOGIES } from '../doc/optimise';
import { CITIES, fillOf, type Fill } from './project';
import { longestEdge } from './importPlot';
import { readGround } from './plotOps';
import { shopFloorsAllowed } from './mixed';
import { FindPlot, ImportBox, type StepProps } from './steps';
import { Btn, Lines, Note, nf, Num, Row, Section, Seg, Select, Slider, sqft, Toggle } from './ui';
import { LadderBox } from './numbersUi';
import { added } from './variants';

type PlotWay = 'view' | 'survey' | 'import';

// ================================================================ site
export function SiteStep2({ p, e, up, toast, tool, picked, pick, openStatement, part }: StepProps) {
  const B = part !== 'design', D = part !== 'brief', P = part === 'project';
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
        <p class="hint-line">Pick the plot in the view to drag its corners, type its edges' lengths and set each edge's road.</p>
        <Row><Btn icon="edit" onClick={() => pick({ k: 'plot' })}>Edit the plot</Btn></Row>
        <Seg<PlotWay> value={way} set={setWay} options={[{ value: 'view', label: 'On the map' }, { value: 'survey', label: 'Survey no.' }, { value: 'import', label: 'Import' }]} ariaLabel="Set the plot by" />
        {way === 'survey' && <FindPlot start cancel={() => setWay('view')} done={(ring, src, at) => { found(ring, src, src.split(' · ')[0], at); setWay('view'); }} />}
        {way === 'import' && <ImportBox done={(ring, src, at) => { found(ring, `Outline from ${src}`, undefined, at); setWay('view'); }} />}
      </Section>}

      {B && !P && <LadderBox p={p} e={e} up={up} openStatement={openStatement} />}


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

export function SchemeStep({ p, e, up, toast, pick, part }: StepProps) {
  const B = part !== 'design', D = part !== 'brief';
  const { r, d, shops } = e;
  const f = fillOf(p), setFill = (x: Partial<Fill>) => up({ fill: { ...(p.fill ?? {}), ...x } });
  const owned = !!p.scheme;
  const mixPct = p.mix.map((x) => Math.round(x * 100));
  const setMix = (i: number, v: number) => { const m = [...p.mix] as [number, number, number]; m[i] = v / 100; const s = m[0] + m[1] + m[2] || 1; up({ mix: m.map((x) => x / s) as [number, number, number] }); };
  const sh = p.shops ?? { floors: 0, depth: 9, sale: 0 };
  const setShops = (x: Partial<typeof sh>) => up({ shops: { ...sh, ...x } });
  const allowed = shopFloorsAllowed(r.roadW);
  const sizes = sizesOf(p);
  return (
    <>
      {B && <Section title="Layout" aside={<span class="sec-meta">{owned ? 'yours now' : `${TYPOLOGIES.find((t) => t.value === p.typology)?.label ?? 'Auto'} · ${Math.round(f.amount * 100)}% of the FSI`}</span>}>
        {owned
          ? <>
            <Note>The layout is yours: these settings won’t move your buildings. Lay it out again to fill the plot from them.</Note>
            <Row>
              <Btn icon="plus" title="This layout stays as it is, in the option menu" onClick={() => { up(added(p, { scheme: undefined }, 'by hand')); toast('Laid out again from the settings, as a new option. Your layout stays in the option menu.', { undo: true }); }}>As a new option</Btn>
              <Btn icon="spark" title="Your edits go (Undo brings them back)" onClick={() => { up({ scheme: undefined }); toast('Laid out again from the settings: your edits to this layout are gone.', { undo: true }); }}>Here</Btn>
            </Row>
          </>
          : <>
            <Note>The plot is filled to these settings, and to the mix, sizes, living and parking below. To try another, duplicate the option first (the option menu).</Note>
            <Seg label="Building type" value={p.typology} set={(v) => up({ typology: v })} options={TYPOLOGIES} />
            <Row>
              <Num label="Most floors" value={p.maxFloors} set={(v) => up({ maxFloors: v })} min={0} max={300} zero="Auto" />
              <Num label="Most buildings" value={f.buildings} set={(v) => setFill({ buildings: v })} min={0} max={40} zero="Auto" />
            </Row>
            <Slider label="How much of the FSI to build" value={Math.round(f.amount * 100)} set={(v) => setFill({ amount: v / 100 })} min={30} max={100} step={5} fmt={(v) => (v >= 100 ? 'All the FSI taken' : `${v}% of the FSI taken`)} />
          </>}
      </Section>}

      {D && <Section title="Living" sub="Green, play, roads inside, spacing and parking." fold open={false} aside={<span class="sec-meta">{f.green ? `${f.green}% green` : 'rules minimum'}</span>}>
        <Slider label="Green" value={f.green} set={(v) => setFill({ green: v })} min={0} max={50} step={5} fmt={(v) => (v ? `At least ${v}% of the plot` : 'What the rules ask')} />
        <Toggle label="Play area" hint="In the open space" value={f.play} set={(v) => setFill({ play: v })} />
        <Seg value={f.access} set={(v) => setFill({ access: v })} label="Roads inside" options={ACCESS.map((a) => ({ value: a.value, label: a.label, title: a.title }))} />
        <Num label="More space between buildings" value={f.spacing} set={(v) => setFill({ spacing: v })} min={0} max={40} unit="m" hint="Over what the rules ask: light, privacy" />
        <Seg<Fill['parking']> value={f.parking} set={(v) => setFill({ parking: v })} label="Parking" options={PARKING} />
        <Num label="Basements" value={f.basements ?? d.site.basements} set={(v) => setFill({ basements: v })} min={0} max={12} hint={f.basements === undefined ? 'As many as the parking needs' : 'As set'} />
        {owned && <Note>The layout is yours: these apply when you fill again, except parking and basements, which apply now.</Note>}
      </Section>}

      {B && <Section title="Flat mix" fold open={false} aside={<span class="sec-meta">{d.flats} flats</span>} sub="Every building, unless one has its own.">
        <div class="mixbar" aria-hidden="true">{[0, 1, 2].map((i) => <i class={`m${i}`} style={`flex:${p.mix[i] || 0.0001}`}>{mixPct[i] >= 12 ? `${mixPct[i]}%` : ''}</i>)}</div>
        <Row n={3}>{[0, 1, 2].map((i) => <Num label={UNIT_LABEL[i]} value={mixPct[i]} set={(v) => setMix(i, v)} max={100} step={5} unit="%" />)}</Row>
        <Note>{[0, 1, 2].filter((t) => d.count[t]).map((t) => `${d.count[t]} × ${UNIT_LABEL[t]}`).join(' · ') || 'No flats fit.'}</Note>
      </Section>}

      {B && <Section title="Flat sizes" fold open={!!p.sizes} aside={<span class="sec-meta">{sizes.map((m) => nf(m * SQFT, 0)).join(' · ')} sq ft</span>} sub="RERA carpet of each type: the layout cuts flats near these sizes. A building can have its own (in the inspector).">
        <Row n={3}>{[0, 1, 2].map((t) => <Num label={`${UNIT_LABEL[t]} carpet`} value={Math.round((sizes[t] * SQFT) / 5) * 5} set={(v) => { const z = [...sizes] as [number, number, number]; z[t] = Math.round((v / SQFT) * 10) / 10; up({ sizes: z }); }} min={200} max={4000} step={25} unit="sq ft" />)}</Row>
        {p.sizes && <Row><Btn kind="quiet" icon="undo" onClick={() => up({ sizes: undefined })}>The starting sizes</Btn></Row>}
        <Note>Flats come whole: on a given floor they land near these sizes (about 15% under to 40% over), and the area statement and money follow what's laid.</Note>
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
