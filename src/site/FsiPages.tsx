// The FSI calculator (/<city>/fsi-calculator/) and the FSI map (/<city>/fsi-map/) for Pune and Mumbai. The calculator
// works in the browser from the rule tables (src/site/fsi/model.ts over src/doc/plot.ts); the map is baked by
// tools/maps/bake-maps.ts (maps/generated/maps.json, public/citymap/<city>/fsi-map.svg). Both explain what they show
// below it, for the people who search for it.
import { useEffect, useMemo, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { href, Icon, Page, proStart } from './ui';
import { SITE_NAME } from './brand';
import { Crumbs, MAPS } from './CityMap';
import { CITY_LABEL, placeOf, type City } from './places/data';
import {
  calcFsi, extraName, fsiColor, fsiFor, rulesFor, SQFT, stepLabel, STEPS_OF, toM2, UNITS, ZONES,
  type AreaUnit, type FsiBand, type FsiInput, type FsiUse, type FsiZone,
} from './fsi/model';
import './place.css';
import './fsi.css';
import { FsiMap } from './fsi/FsiMap';

const nf = (v: number, d = 0) => v.toLocaleString('en-IN', { maximumFractionDigits: d, minimumFractionDigits: 0 });
const f2 = (v: number) => (Math.round(v * 100) / 100).toString();
const pct = (v: number) => `${Math.round(v * 100)} %`;
const sqft = (m2: number) => `${nf(m2 * SQFT)} sq ft`;
const m2s = (m2: number) => `${nf(m2)} m²`;
const AUTH: Record<City, string> = { pune: 'the Pune Municipal Corporation (PMC)', mumbai: 'the MCGM' };
const CODE: Record<City, string> = { pune: 'UDCPR 2020', mumbai: 'DCPR 2034' };
const TABLE_OF: Record<FsiZone, string> = { regular: 'UDCPR 2020 Table 6-G', congested: 'UDCPR 2020 Table 6-A (congested areas)', island: 'the island city’s table', suburbs: 'the suburbs’ table' };
const DEF_ZONE: Record<City, FsiZone> = { pune: 'regular', mumbai: 'suburbs' };

// ---------- the words both the page and its structured data use ----------

export function fsiFaq(city: City): [string, string][] {
  if (city === 'pune') {
    return [
      ['What is the FSI in Pune?', `Under ${CODE.pune}, a plot in Pune gets a basic FSI of 1.1, and on a road 9 m or wider it can add premium FSI (paid to the corporation) and TDR (bought). In ${SITE_NAME}’s rule tables that is ${f2(fsiFor(0, 'regular'))} in all on a road under 9 m and ${f2(fsiFor(30, 'regular'))} on a road 30 m or wider, before ancillary FSI of 60 % for homes.`],
      ['How does road width change FSI in Pune?', `The wider the road a plot fronts, the more premium FSI and TDR it can load: ${STEPS_OF.regular.map((w, i) => `${stepLabel(STEPS_OF.regular, i)}: ${f2(fsiFor(w, 'regular'))}`).join('; ')}. Where the Development Plan widens the road, the DP width counts.`],
      ['What is ancillary FSI?', 'Extra floor area UDCPR 2020 allows on payment of a premium for staircases, lift lobbies, balconies and the like: 60 % of the basic, premium and TDR area for homes and 80 % for other uses.'],
      ['How much can I build on a 1 guntha plot in Pune?', (() => { const r = calcFsi({ zone: 'regular', use: 'residential', area: toM2(1, 'guntha'), road: 12 }); return `About ${sqft(r.bua)} (${m2s(r.bua)}) of built-up area on a 12 m road, with premium FSI, TDR and ancillary FSI all used, in ${SITE_NAME}’s rule tables. On a road under 9 m it is about ${sqft(calcFsi({ zone: 'regular', use: 'residential', area: toM2(1, 'guntha'), road: 6 }).bua)}.`; })()],
      ['Is the old city different?', `Yes. The congested areas (the peths and gaothans) have their own table with a higher basic FSI: ${f2(fsiFor(9, 'congested'))} in all on a 9 m road against ${f2(fsiFor(9, 'regular'))} elsewhere. Choose “Old city” in the calculator.`],
      ['Is this the final FSI for my plot?', 'No. It is a starting point. TOD zones near metro lines, amendments, reservations, height limits near the airport and the corporation’s own decisions can change it. The DP remark and your architect’s reading of the current UDCPR text are what count.'],
    ];
  }
  return [
    ['What is the FSI in Mumbai?', `Under ${CODE.mumbai}, residential FSI is a basic FSI (1.33 in the island city, 1.0 in the suburbs) plus premium FSI and TDR that go up with the road width, with 35 % fungible FSI on top. In ${SITE_NAME}’s rule tables the total before fungible runs from ${f2(fsiFor(0, 'suburbs'))} to ${f2(fsiFor(27, 'suburbs'))} in the suburbs and from ${f2(fsiFor(0, 'island'))} to ${f2(fsiFor(27, 'island'))} in the island city.`],
    ['How does road width change FSI in Mumbai?', `Suburbs: ${STEPS_OF.suburbs.map((w, i) => `${stepLabel(STEPS_OF.suburbs, i)} ${f2(fsiFor(w, 'suburbs'))}`).join(', ')}. Island city: ${STEPS_OF.island.map((w, i) => `${stepLabel(STEPS_OF.island, i)} ${f2(fsiFor(w, 'island'))}`).join(', ')}.`],
    ['What is fungible FSI?', 'Extra floor area DCPR 2034 allows on payment of a premium, worked out as 35 % of the FSI used for homes. It covers balconies, flower beds and the like that used to be left out of FSI.'],
    ['Why is the island city different from the suburbs?', 'DCPR 2034 gives the island city (Colaba to Mahim and Sion) a higher basic FSI and higher totals on wide roads than the suburbs, which run from Bandra and Kurla north.'],
    ['Does this cover redevelopment (33(7), 33(9), 33(7)(B))?', 'No. Cessed buildings, cluster redevelopment, slum schemes and society redevelopment incentives have their own FSI. The calculator shows the general residential FSI by road width; the schemes add to it.'],
    ['Is this the final FSI for my plot?', 'No. The Mumbai tables come from published summaries of DCPR 2034, and coastal zone, heritage, airport height limits and reservations change what a plot can do. Check the MCGM’s remarks and the current DCPR text with your architect.'],
  ];
}

// ---------- the calculator ----------

interface State { unit: AreaUnit; area: string; road: string; dp: string; front: string; zone: FsiZone; use: FsiUse; credit: boolean }
const DEFAULTS: Record<City, State> = {
  pune: { unit: 'sqft', area: '4000', road: '12', dp: '', front: '', zone: 'regular', use: 'residential', credit: false },
  mumbai: { unit: 'sqft', area: '5000', road: '12', dp: '', front: '', zone: 'suburbs', use: 'residential', credit: false },
};
const ROAD_CHIPS = [6, 9, 12, 15, 18, 24, 30];
const num = (s: string) => { const v = parseFloat(s.replace(/,/g, '')); return Number.isFinite(v) && v > 0 ? v : 0; };

function readUrl(city: City): State {
  const q = new URLSearchParams(location.search), d = DEFAULTS[city];
  const unit = UNITS.some((u) => u.value === q.get('unit')) ? (q.get('unit') as AreaUnit) : d.unit;
  const zone = ZONES[city].some((z) => z.value === q.get('zone')) ? (q.get('zone') as FsiZone) : d.zone;
  const use: FsiUse = q.get('use') === 'commercial' ? 'commercial' : 'residential';
  const v = (k: string, dflt: string) => (q.get(k) !== null && num(q.get(k)!) ? String(num(q.get(k)!)) : dflt);
  return { unit, zone, use, area: v('area', d.area), road: v('road', d.road), dp: city === 'pune' ? v('dp', '') : '', front: v('front', ''), credit: q.get('credit') === '1' };
}
function writeUrl(s: State, city: City) {
  const d = DEFAULTS[city], q = new URLSearchParams();
  (['area', 'unit', 'road', 'dp', 'front', 'zone', 'use'] as const).forEach((k) => { if (s[k] && s[k] !== d[k]) q.set(k, s[k]); });
  if (s.credit) q.set('credit', '1');
  const qs = q.toString();
  history.replaceState(null, '', location.pathname + (qs ? `?${qs}` : ''));
}

function Calculator({ city }: { city: City }) {
  const [s, set] = useState<State>(DEFAULTS[city]);
  const [ready, setReady] = useState(false);
  useEffect(() => { set(readUrl(city)); setReady(true); }, [city]);
  useEffect(() => { if (ready) writeUrl(s, city); }, [s, ready, city]);
  const up = (p: Partial<State>) => set((o) => ({ ...o, ...p }));

  const input: FsiInput = { zone: s.zone, use: s.use, area: toM2(num(s.area), s.unit), road: num(s.road), dp: num(s.dp) || undefined, frontage: num(s.front) || undefined, credit: s.credit };
  const r = useMemo(() => calcFsi(input), [JSON.stringify(input)]);
  const area = input.area, extra = extraName(s.zone);
  const steps = STEPS_OF[s.zone];
  const ladder = steps.map((w) => ({ w, bua: calcFsi({ ...input, road: w, dp: undefined, credit: false }).bua }));
  const top = Math.max(...ladder.map((l) => l.bua), 1);
  const cur = steps.reduce((k, w, i) => (r.roadW >= w ? i : k), 0);
  const segs: [string, number, string, string][] = [
    ['Basic', r.parts.basic + r.parts.credit, 'var(--fsi-basic)', r.parts.credit ? 'comes with the plot, with the DP strip’s credit' : 'comes with the plot'],
    ['Premium', r.parts.premium, 'var(--fsi-premium)', `paid to ${city === 'pune' ? 'the corporation' : 'the MCGM'}`],
    ['TDR', r.parts.tdr, 'var(--fsi-tdr)', 'bought on the TDR market'],
    [extra[0].toUpperCase() + extra.slice(1), r.parts.extra, 'var(--fsi-extra)', `${pct(r.rules.ancillary)} on top, paid`],
  ];
  const bad = !area || !num(s.road);

  return (
    <>
    <div class="fsi-calc">
      <form class="fsi-inputs" onSubmit={(e) => e.preventDefault()} aria-label="Your plot">
        <div class="field">
          <label for="fsi-area">Plot area</label>
          <div class="fsi-unit">
            <input class="input" id="fsi-area" inputMode="decimal" value={s.area} onInput={(e) => up({ area: (e.target as HTMLInputElement).value })} aria-invalid={!num(s.area) || undefined} />
            <select class="input" aria-label="Unit" value={s.unit} onChange={(e) => up({ unit: (e.target as HTMLSelectElement).value as AreaUnit })}>
              {UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
            </select>
          </div>
          {s.unit !== 'm2' && area > 0 && <span class="hint">{m2s(area)}</span>}
        </div>

        <div class="field">
          <label for="fsi-road">Width of the road in front (m)</label>
          <input class="input" id="fsi-road" inputMode="decimal" value={s.road} onInput={(e) => up({ road: (e.target as HTMLInputElement).value })} aria-invalid={!num(s.road) || undefined} />
          <div class="fsi-chips" role="group" aria-label="Common road widths">
            {ROAD_CHIPS.map((w) => <button type="button" key={w} aria-pressed={num(s.road) === w} onClick={() => up({ road: String(w) })}>{w} m</button>)}
          </div>
          <span class="hint">The full width between the plot boundaries across the road, footpaths included.{' '}
            <a href={href(`${city}/road-width-map/`)}>{CITY_LABEL[city]} road width map</a></span>
        </div>

        <div class="field">
          <span class="label">{city === 'pune' ? 'Area' : 'Part of Mumbai'}</span>
          <div class="seg" role="group" aria-label={city === 'pune' ? 'Area' : 'Part of Mumbai'}>
            {ZONES[city].map((z) => <button type="button" key={z.value} aria-pressed={s.zone === z.value} title={z.hint} onClick={() => up({ zone: z.value })}>{z.label}</button>)}
          </div>
          <span class="hint">{ZONES[city].find((z) => z.value === s.zone)?.hint}</span>
        </div>

        <div class="field">
          <span class="label">Use</span>
          <div class="seg" role="group" aria-label="Use">
            <button type="button" aria-pressed={s.use === 'residential'} onClick={() => up({ use: 'residential' })}>Homes</button>
            <button type="button" aria-pressed={s.use === 'commercial'} onClick={() => up({ use: 'commercial' })}>Offices, shops</button>
          </div>
        </div>

        <details class="fsi-more" open={!!(s.dp || s.front)}>
          <summary>{city === 'pune' ? 'DP road widening and plot shape' : 'Plot shape'}</summary>
          {city === 'pune' && (
            <div class="field">
              <label for="fsi-dp">DP width of the road (m), if the Development Plan widens it</label>
              <input class="input" id="fsi-dp" inputMode="decimal" placeholder="Not widened" value={s.dp} onInput={(e) => up({ dp: (e.target as HTMLInputElement).value })} />
              <span class="hint">Find it on your plot’s <a href={href('pune/dp-report/')}>DP report</a> or the DP remark.</span>
              {num(s.dp) > num(s.road) && (
                <label class="check"><input type="checkbox" checked={s.credit} onChange={(e) => up({ credit: (e.target as HTMLInputElement).checked })} /> <span>Hand the strip over and use its FSI on the rest of the plot</span></label>
              )}
            </div>
          )}
          <div class="field">
            <label for="fsi-front">Length along the road (m)</label>
            <input class="input" id="fsi-front" inputMode="decimal" placeholder={area ? `${nf(Math.sqrt(area), 1)} (a square plot)` : ''} value={s.front} onInput={(e) => up({ front: (e.target as HTMLInputElement).value })} />
            <span class="hint">For the floors, and for the strip a DP widening takes.</span>
          </div>
        </details>
      </form>

      <section class="fsi-out" aria-live="polite" aria-label="What the plot can build">
        {bad ? <p class="muted">Enter the plot’s area and the width of the road in front.</p> : (
          <>
            <div class="fsi-big">
              <span class="muted small">Built-up area you can build</span>
              <strong>{sqft(r.bua)}</strong>
              <span class="muted">{m2s(r.bua)} · FSI {f2(r.consumed / area)} + {pct(r.rules.ancillary)} {extra} = <b>{f2(r.bua / area)}</b></span>
            </div>
            <div class="fsi-stack" role="img" aria-label={segs.map(([k, v]) => `${k} ${sqft(v)}`).join(', ')}>
              {segs.filter(([, v]) => v > 0).map(([k, v, c]) => <i key={k} style={`flex:${v};background:${c}`} />)}
            </div>
            <dl class="fsi-parts">
              {segs.map(([k, v, c, note]) => (
                <div key={k}><dt><i style={`background:${c}`} />{k} <span class="muted small">{note}</span></dt><dd>{v > 0 ? sqft(v) : '—'}</dd></div>
              ))}
            </dl>
            {r.lost > 0 && <p class="small">The DP widening to {f2(r.roadW)} m takes about <b>{sqft(r.lost)}</b> off the front; the rules go by the DP width.</p>}
            <p class="small fsi-floors">
              {r.floors > 0 ? <>About <b>{r.floors} floors</b>, {f2(r.height)} m tall, on a footprint of about {sqft(r.plate)}{r.squareAssumed ? ', taking the plot as a square' : ''}.</> : <>The margins leave no room to build on a plot this size{r.squareAssumed ? ' (taken as a square)' : ''}.</>}
              {r.limit === 'margins' && <> The side margins grow with the height, so about {sqft(r.bua - r.built)} doesn’t fit.</>}
              {r.limit === 'height' && <> The height limit in the tables stops it short by about {sqft(r.bua - r.built)}.</>}
            </p>
            <div class="fsi-cta">
              <a class="btn btn-primary btn-block" href={proStart('blank', city)}>Plan this plot in Pro <Icon.arrow /></a>
              <a class="btn btn-block" href={proStart('survey', city)}>Find your plot by its survey number</a>
              {city === 'pune' && <a class="btn btn-block" href={href('pune/dp-report/')}>Check the DP for your plot</a>}
            </div>
          </>
        )}
      </section>
    </div>

      {!bad && (
        <section class="fsi-ladder" aria-label="The same plot on other road widths">
          <h2>The same plot on a wider road</h2>
          <p class="muted small">Built-up area with every kind of FSI used, for each road-width step in {TABLE_OF[s.zone]}.</p>
          <ol>
            {ladder.map((l, i) => (
              <li key={l.w} class={i === cur ? 'on' : undefined}>
                <span class="w">{stepLabel(steps, i)}</span>
                <span class="bar"><i style={`width:${(100 * l.bua) / top}%`} /></span>
                <span class="v">{sqft(l.bua)} <span class="muted">· FSI {f2(fsiFor(l.w, s.zone))}</span>{i === cur ? <b class="tag">yours</b> : l.bua > ladder[cur].bua ? <span class="up">+{sqft(l.bua - ladder[cur].bua)}</span> : null}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}

/** FSI by road width for a zone, from the rule tables. */
function FsiTable({ zone, caption }: { zone: FsiZone; caption: string }) {
  const steps = STEPS_OF[zone], extra = rulesFor(12, zone).ancillary;
  return (
    <div class="table-wrap">
      <table class="rules">
        <caption>{caption}</caption>
        <thead><tr><th>Road width</th><th class="n">Basic</th><th class="n">Premium</th><th class="n">TDR</th><th class="n">Total</th><th class="n">With {extraName(zone)} ({pct(extra)})</th></tr></thead>
        <tbody>
          {steps.map((w, i) => {
            const r = rulesFor(w, zone), t = r.basic + r.premium + r.tdr;
            return <tr key={w}><td><i class="legend-swatch" style={`background:${fsiColor(t)};display:inline-block;margin-right:8px`} />{stepLabel(steps, i)}</td><td class="n">{f2(r.basic)}</td><td class="n">{f2(r.premium)}</td><td class="n">{f2(r.tdr)}</td><td class="n"><b>{f2(t)}</b></td><td class="n">{f2(t * (1 + r.ancillary))}</td></tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}

const Faq = ({ qs }: { qs: [string, string][] }) => (
  <div class="faq">{qs.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>
);

function Other({ city, children }: { city: City; children: ComponentChildren }) {
  const o: City = city === 'pune' ? 'mumbai' : 'pune';
  return (
    <div class="map-links">
      {children}
      <a href={href(`${o}/fsi-calculator/`)}><Icon.building /><span><b>{CITY_LABEL[o]} FSI calculator</b><small>{CODE[o]}, by road width</small></span></a>
      <a href={href(`guides/fsi-calculator-${city}/`)}><Icon.sheet /><span><b>{CITY_LABEL[city]} FSI, explained</b><small>The tables and a worked example</small></span></a>
      <a href={href('guides/how-much-can-i-build/')}><Icon.cube /><span><b>How much can I build?</b><small>Floor area, margins and floors</small></span></a>
    </div>
  );
}

export function FsiCalculatorPage({ city }: { city: City }) {
  const L = CITY_LABEL[city], ex = calcFsi({ zone: DEF_ZONE[city], use: 'residential', area: 1000, road: 12 });
  return (
    <Page>
      <section class="wrap guide place">
        <article class="wide">
          <Crumbs trail={[['Home', ''], [L, `${city}/`], [`${L} FSI calculator`, null]]} />
          <h1>{L} FSI calculator</h1>
          <p class="answer">
            How much a plot in {L} can build under {CODE[city]}: enter its area and the width of the road in front. The FSI comes in layers (basic,
            premium, TDR and {extraName(DEF_ZONE[city])} FSI) and the wider the road, the more of them a plot can load. A 1,000 m² plot on a 12 m road
            {city === 'mumbai' ? ' in the suburbs' : ''} can build about <b>{m2s(ex.bua)}</b>.
          </p>
          <Calculator city={city} />

          <h2>How FSI is worked out in {L}</h2>
          <p>FSI (Floor Space Index, also called FAR) is the floor area you may build divided by the plot’s area. Under {CODE[city]} it has four parts:</p>
          <ul>
            <li><b>Basic FSI</b>: comes with the plot{city === 'pune' ? ', and counts on the plot left after any DP road widening' : ''}.</li>
            <li><b>Premium FSI</b>: more floor area you buy from {AUTH[city]}, at a share of the ready reckoner rate.</li>
            <li><b>TDR</b> (Transferable Development Rights): floor area bought from owners who gave land for roads and reservations elsewhere, and loaded on your plot.</li>
            <li><b>{extraName(DEF_ZONE[city])[0].toUpperCase() + extraName(DEF_ZONE[city]).slice(1)} FSI</b>: {city === 'pune' ? '60 % (homes) or 80 % (other uses)' : '35 %'} on top of the other three, for staircases, lobbies and balconies, paid for.</li>
          </ul>
          <p>How much premium FSI and TDR a plot may take goes by the width of the road it fronts, which is why the road matters so much:</p>
          {city === 'pune' ? (
            <>
              <FsiTable zone="regular" caption={`FSI by road width outside the congested areas, in ${SITE_NAME}’s rule tables (based on UDCPR 2020 Table 6-G)`} />
              <h2>The old city: congested areas</h2>
              <p>The peths and gaothans have their own table, with a higher basic FSI and a smaller premium and TDR:</p>
              <FsiTable zone="congested" caption="FSI by road width in congested areas (based on UDCPR 2020 Table 6-A)" />
              <h2>When the DP widens the road</h2>
              <p>If the Development Plan widens the road in front, the strip it takes comes off the plot, but the rules go by the DP width, so the plot can usually load more premium FSI and TDR. Basic FSI counts on what’s left; premium and TDR on the whole plot. Owners who hand the strip over can use its FSI on the rest of the plot or take it as TDR. Open “DP road widening” in the calculator to see both. The DP width for any plot in the old PMC limits is on the <a href={href('pune/dp-report/')}>Pune DP report</a>.</p>
            </>
          ) : (
            <>
              <FsiTable zone="suburbs" caption={`Residential FSI by road width in the suburbs, in ${SITE_NAME}’s rule tables (based on published summaries of DCPR 2034 Table 12)`} />
              <FsiTable zone="island" caption="Residential FSI by road width in the island city (same source)" />
              <h2>Island city and suburbs</h2>
              <p>The island city (Colaba to Mahim and Sion) has a basic FSI of 1.33 and goes up to {f2(fsiFor(27, 'island'))} on a road 27 m or wider; the suburbs start at 1.0 and go up to {f2(fsiFor(27, 'suburbs'))}. On a 12 m road the same plot builds about {pct(calcFsi({ zone: 'island', use: 'residential', area: 1000, road: 12 }).bua / calcFsi({ zone: 'suburbs', use: 'residential', area: 1000, road: 12 }).bua - 1)} more in the island city. See where the higher FSI is on the <a href={href('mumbai/fsi-map/')}>Mumbai FSI map</a>.</p>
            </>
          )}
          <h2>What the calculator doesn’t do</h2>
          <ul>
            <li><b>Margins and height</b>: the floors it shows take the plot as a rectangle with {city === 'pune' ? 'UDCPR’s' : 'UDCPR’s (as a placeholder)'} margins. For your plot’s real shape, <a href={proStart('survey', city)}>find it by its survey number in Pro</a>, which also checks parking, fire access and open space.</li>
            <li><b>Special schemes</b>: {city === 'pune' ? 'TOD zones along the metro, slum rehabilitation, inclusive housing and the newer amendments' : 'redevelopment under 33(7), 33(9) and 33(7)(B), slum schemes, and incentive FSI'} add FSI this doesn’t show.</li>
            <li><b>Limits the road doesn’t set</b>: reservations, {city === 'mumbai' ? 'coastal zone (CRZ), heritage precincts, ' : ''}airport height limits and the plot’s zone.</li>
          </ul>
          <p>It’s a starting point for a feasibility, not a DP remark or an architect’s reading of the current {CODE[city]} text.</p>
          <h2>Questions</h2>
          <Faq qs={fsiFaq(city)} />
          <h2>See it on the map</h2>
          <Other city={city}>
            <a href={href(`${city}/fsi-map/`)}><Icon.road /><span><b>{L} FSI map</b><small>Every main road by the FSI its plots get</small></span></a>
          </Other>
        </article>
      </section>
    </Page>
  );
}

// ---------- the map ----------

export function fsiMapDesc(city: City): string {
  const F = MAPS[city].fsi, tot = F.bands.reduce((a, b) => a + b.km, 0), hi = F.bands.filter((b) => b.fsi >= 2.5).reduce((a, b) => a + b.km, 0);
  return `${CITY_LABEL[city]}'s main roads coloured by the FSI a plot on them gets under ${CODE[city]}: ${Math.round((100 * hi) / tot)} % of ${nf(Math.round(tot))} km at 2.5 or more. With a calculator.`;
}

const zoneName = (z: FsiZone) => (z === 'island' ? 'Island city' : z === 'suburbs' ? 'Suburbs' : z === 'congested' ? 'Old city' : '');
const bandRange = (b: FsiBand) => (b.hi === null ? `${b.lo} m and wider` : b.lo === 0 ? `under ${b.hi} m` : `${b.lo} to ${b.hi} m`);

export function FsiMapPage({ city }: { city: City }) {
  const L = CITY_LABEL[city], M = MAPS[city], F = M.fsi;
  const tot = F.bands.reduce((a, b) => a + b.km, 0);
  const zones = [...new Set(F.bands.map((b) => b.zone))];
  const legend = [...new Map(F.bands.map((b) => [b.fsi, b])).values()].sort((a, b) => a.fsi - b.fsi);
  const hi = F.bands.filter((b) => b.fsi >= 2.5).reduce((a, b) => a + b.km, 0);
  const low = F.bands.filter((b) => b.lo === 0).reduce((a, b) => a + b.km, 0);
  return (
    <Page>
      <section class="wrap guide place">
        <article class="wide">
          <Crumbs trail={[['Home', ''], [L, `${city}/`], [`${L} FSI map`, null]]} />
          <h1>{L} FSI map</h1>
          <p class="answer">
            Every main road in {L}, coloured by the FSI a plot fronting it gets under {CODE[city]}, from the road’s width. {Math.round((100 * hi) / tot)} % of
            the {nf(Math.round(tot))} km of main road gives its plots an FSI of 2.5 or more before {extraName(zones[0])} FSI
            {city === 'mumbai' ? <>; the island city’s tables are higher than the suburbs’, so the same width is darker south of Mahim and Sion</> : null}.
            For your own plot, use the <a href={href(`${city}/fsi-calculator/`)}>{L} FSI calculator</a>.
          </p>
          <figure class="fsi-figure">
            {F.view
              ? <FsiMap view={F.view} base={href('')} svg={href(F.svg)} svgW={F.w} svgH={F.h} alt={`Map of ${L}'s roads coloured by the FSI a plot on them gets, from pale (${f2(legend[0].fsi)}) to dark (${f2(legend[legend.length - 1].fsi)})`} />
              : <img src={href(F.svg)} width={F.w} height={F.h} alt={`Map of ${L}'s main roads coloured by FSI`} />}
            <figcaption class="legend place-legend">
              {legend.map((b) => <span key={b.fsi}><i class="legend-swatch" style={`background:${b.color}`} /> FSI {f2(b.fsi)}</span>)}
              <span class="muted">Zoom with the wheel, two fingers or +; local streets appear as you go in.</span>
            </figcaption>
          </figure>
          <div class="fsi-map-facts">
            <div class="table-wrap">
              <table class="rules">
                <caption>Main roads by the FSI their plots get (basic + premium + TDR)</caption>
                <thead><tr><th>Road width</th><th class="n">FSI</th><th class="n">Length</th></tr></thead>
                <tbody>
                  {zones.flatMap((z) => [
                    ...(zones.length > 1 ? [<tr key={z}><th colSpan={3} scope="rowgroup">{zoneName(z)}</th></tr>] : []),
                    ...F.bands.filter((b) => b.zone === z).sort((a, b) => a.lo - b.lo).map((b) => (
                    <tr key={z + b.lo}><td><i class="legend-swatch" style={`background:${b.color};display:inline-block;margin-right:8px`} />{bandRange(b)}</td><td class="n"><b>{f2(b.fsi)}</b></td><td class="n">{nf(Math.round(b.km))} km</td></tr>
                  ))])}
                </tbody>
              </table>
            </div>
            <div class="fsi-map-cta">
              <p>The colour is what a plot fronting that road can build to. For your own plot’s area, road and {city === 'pune' ? 'DP widening' : 'part of the city'}, work it out in the calculator.</p>
              <a class="btn btn-primary btn-lg btn-block" href={href(`${city}/fsi-calculator/`)}>Calculate for your plot <Icon.arrow /></a>
            </div>
          </div>

          <h2>How to read it</h2>
          <ul>
            <li><b>Two views</b>: <b>Roads</b> colours each road by the FSI a plot fronting it gets; <b>Heat map</b> spreads each road's FSI out over the blocks around it, strong and wide for the big roads, faint for lanes, blending where roads meet, in squares from 400 m across the whole city down to 25 m zoomed in. It shows where floor area is concentrated; a plot's own FSI still goes by the road it fronts.</li>
            <li><b>The colour is the road’s</b>: a plot takes the FSI of the road it’s entered from. A plot on a lane off a dark road gets the lane’s FSI, not the main road’s. Local streets appear as you zoom in; most are under 9 m, where the FSI is {f2(fsiFor(0, zones[0]))}{zones.length > 1 ? ` (suburbs) or ${f2(fsiFor(0, 'island'))} (island city)` : ''}.</li>
            <li><b>FSI before {extraName(zones[0])} FSI</b>: basic, premium and TDR together. {extraName(zones[0])[0].toUpperCase() + extraName(zones[0]).slice(1)} FSI adds {pct(rulesFor(12, zones[0]).ancillary)} on top for homes.</li>
            <li><b>Widths are {SITE_NAME}’s model</b>, from OpenStreetMap lane counts and road classes, not a survey. Many two-lane collectors have no width in OpenStreetMap and come out under 9 m ({nf(Math.round(low))} km here); the real road may well be wider. A divided road counts as both carriageways.</li>
            {city === 'pune' ? (
              <li><b>The Development Plan counts</b>: where {SITE_NAME} has traced the DP width of a road and it’s wider than today ({nf(Math.round(F.dpKm ?? 0))} km, in part of east-central Pune), the map uses the DP width, as the rules do. Elsewhere it shows today’s width; your plot’s <a href={href('pune/dp-report/')}>DP report</a> has the DP width. The old city’s congested-area table isn’t shown separately.</li>
            ) : (
              <li><b>Island city or suburbs</b> is decided from an approximate line along Mahim Creek, the Mithi river and Sion. Expressways, freeways, the Coastal Road and sea links are left out: no plot is entered from them.</li>
            )}
          </ul>

          <h2>Main roads with the highest FSI</h2>
          <div class="table-wrap">
            <table class="rules">
              <caption>Named main roads by the FSI a plot fronting them gets, from their typical width in the model (expressways and ghats left out)</caption>
              <thead><tr><th>Road</th>{city === 'mumbai' && <th>Part</th>}<th class="n">Width</th><th class="n">FSI</th><th>Near</th><th /></tr></thead>
              <tbody>
                {F.top.map((r) => {
                  const near = r.near ? placeOf(city, r.near) : undefined;
                  const q = new URLSearchParams({ road: String(Math.floor(r.w)), ...(r.zone !== DEF_ZONE[city] ? { zone: r.zone } : {}) });
                  return (
                    <tr key={r.name + r.at.join()}>
                      <td>{r.name}</td>{city === 'mumbai' && <td>{zoneName(r.zone)}</td>}
                      <td class="n">{r.w} m</td><td class="n"><b>{f2(r.fsi)}</b></td>
                      <td>{near ? <a href={href(`${city}/${near.slug}/`)}>{near.name}</a> : <span class="muted">—</span>}</td>
                      <td><a href={`${href(`${city}/fsi-calculator/`)}?${q}`}>Calculate</a></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <h2>Why road width sets the FSI</h2>
          <p>{CODE[city]} lets a plot take more premium FSI and TDR the wider the road it fronts, so that taller, denser buildings go where the roads can carry the traffic and fire engines can reach. A plot on a road under 9 m gets the basic FSI only; the same plot on a {city === 'pune' ? '30' : '27'} m road can load about {f2(fsiFor(city === 'pune' ? 30 : 27, zones[0]) / fsiFor(0, zones[0]))} times as much. That’s why a DP road widening, though it takes land, often adds to what a plot can build.</p>

          <h2>More on FSI</h2>
          <Other city={city}>
            <a href={href(`${city}/fsi-calculator/`)}><Icon.building /><span><b>{L} FSI calculator</b><small>Your plot’s area and road</small></span></a>
          </Other>
          <p>The road widths themselves are on the <a href={href(`${city}/road-width-map/`)}>{L} road width map</a>, and the network as data on the <a href={href('data/')}>open data page</a>.</p>
        </article>
      </section>
    </Page>
  );
}
