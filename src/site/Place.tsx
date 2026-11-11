// A place page (/<city>/<slug>/) and a city page (/pune/, /mumbai/): what the base map says about a neighbourhood
// or a road — widths, the Development Plan's widths where they're traced, junctions, buildings — and a few
// what-ifs to try in the editor. Every number is measured by tools/places/bake-places.ts; this only words them.
import type { ComponentChildren } from 'preact';
import { CITY_LABEL, PLACES, placeOf, roadName, type City, type Place } from './places/data';
import type { Idea, PlaceData, RoadFact } from './places/facts';
import { APP, href, Icon, Page } from './ui';
import { SITE_NAME } from './brand';
import { NotFoundBody } from './NotFound';
import './place.css';

const n = (v: number) => v.toLocaleString('en-IN');
const plural = (v: number, one: string, many = one + 's') => `${n(v)} ${v === 1 ? one : many}`;
/** The editor, opened on the city at a point (lat, lon, web-map zoom). */
export const appAt = (city: City, lat: number, lon: number, zoom: number) => `${APP}?region=${city}&at=${lat},${lon},${zoom}`;
const appOf = (d: PlaceData) => appAt(d.city, d.lat, d.lon, d.zoom);

function Crumbs({ trail }: { trail: [string, string | null][] }) {
  return (
    <nav class="crumbs" aria-label="Breadcrumb">
      <ol>{trail.map(([label, to]) => <li key={label}>{to !== null ? <a href={href(to)}>{label}</a> : <span aria-current="page">{label}</span>}</li>)}</ol>
    </nav>
  );
}

// ---------------- the words ----------------

function lead(d: PlaceData): ComponentChildren {
  const a = d.area, main = d.roads[0];
  const extra = [a.offKm ? `${a.offKm} km on flyovers and bridges` : '', a.underKm ? `${a.underKm} km in underpasses` : ''].filter(Boolean).join(', ');
  return (
    <>
      Within {d.r} m of {d.name} the map holds <b>{a.roadKm} km of road</b> ({a.mainKm} km of it main roads{extra ? `, ${extra}` : ''}),{' '}
      <b>{plural(a.junctions, 'junction')}</b> where three or more roads meet ({a.mainJunctions} on main roads, {a.signals} with signals mapped) and{' '}
      <b>{plural(a.buildings, 'building')}</b> covering {a.coverage} % of the ground.{' '}
      {main && <>{mainSentence(d, main)} </>}
      The ground lies between {a.elevMin} and {a.elevMax} m above sea level.
    </>
  );
}

function mainSentence(d: PlaceData, f: RoadFact): string {
  const nm = roadName(f);
  const metro = f.metro ? ` ${n(f.metro)} m of it runs under the metro viaduct.` : '';
  if (f.dp && d.dp === 'traced') return `${nm} is ${f.w} m wide in the map; the Development Plan gives it ${f.dp} m.${metro}`;
  const each = f.oneway === 'pair' ? ' for each of its two one-way carriageways' : f.oneway ? ', one-way as mapped' : '';
  return `${nm}, the main road here, is about ${f.w} m kerb to kerb${each}, with ${plural(f.lanes, 'lane')}${f.divided ? ' and a median' : ''}.${metro}`;
}

function dpText(d: PlaceData): ComponentChildren {
  if (d.dp === 'traced') {
    return (
      <>
        {SITE_NAME} has traced the road widths of Pune's sanctioned Development Plan for this area from the PMC's DP sheets:{' '}
        {d.dpKm} km of the road here carries a DP width (the dashed red lines on the map are its edges, drawn either side
        of today's centre line). Where buildings stand closer together than a road's DP width, the map narrows the road to
        the space between them, so the gap between the two widths is roughly where the plan and the street differ.
        {d.dpBuildings ? ` ${plural(d.dpBuildings, 'building has', 'buildings have')} a corner inside a planned width, measured from today's centre line; the DP's own alignment may sit to one side.` : ''}
      </>
    );
  }
  if (d.dp === 'sheets') {
    return (
      <>
        Pune's Development Plan sheets cover {d.name}, and the editor shows them as a reference layer (press <kbd>D</kbd>),
        but their road widths haven't been traced here yet, so this page gives no DP widths: the widths below are today's
        network as {SITE_NAME} models it. For an official DP remark, ask the Pune Municipal Corporation.
      </>
    );
  }
  if (d.city === 'mumbai') {
    return (
      <>
        {SITE_NAME} doesn't have Mumbai's Development Plan (DP 2034) yet, so there is nothing here to compare against a plan:
        the widths are today's network as {SITE_NAME} models it from OpenStreetMap. For a DP remark, ask the Municipal
        Corporation of Greater Mumbai.
      </>
    );
  }
  return (
    <>
      The Development Plan sheets in {SITE_NAME} don't reach {d.name} yet, so this page gives no DP widths: the widths below
      are today's network as {SITE_NAME} models it from OpenStreetMap.
    </>
  );
}

function idea(d: PlaceData, q: Idea): { title: string; body: string; at?: [number, number] } {
  switch (q.k) {
    case 'widen': return {
      title: `What would ${q.road} look like at its DP width of ${q.dp} m?`,
      body: `It is ${q.w} m wide in the map${q.gap !== undefined ? `, and the buildings along it stand about ${q.gap} m apart` : ''}.`
        + (q.n ? ` ${plural(q.n, 'building has', 'buildings have')} a corner inside the ${q.dp} m width, measured from today's centre line.` : '')
        + " The planned width is for the whole corridor, service roads included. In the editor, the road's cross-section shows the DP width beside today's: drag the road out to it (the width handles snap to DP widths) and see the lanes and footpaths it would hold, and what it takes from the plots along it.",
    };
    case 'cluster': return {
      title: `Could the ${q.n} junctions${q.roads.length ? ` at ${q.roads.slice(0, 2).join(' and ')}` : ''} work as one?`,
      body: `${q.n} junction points on main roads sit within ${q.span} m of each other here. A big crossing is often mapped this way (split carriageways, slip roads, flyover ramps). In the editor you can merge them, or redraw the crossing as a single junction, and compare.`,
      at: q.at,
    };
    case 'pinch': return {
      title: `Where does ${q.road} narrow to ${q.wMin} m?`,
      body: `It is about ${q.w} m wide for most of its length here, but ${n(q.len)} m of it is under three quarters of that, down to ${q.wMin} m in the map. Is that a real pinch, or a gap in the map? Either way, the editor's width handles let you try it evened out.`,
    };
    case 'signals': return {
      title: `Which of the ${q.of} main-road junctions need signals?`,
      body: `OpenStreetMap shows signals at ${q.n} of them. Some of the rest may have signals nobody has mapped yet. In the editor you can mark them and set their phases.`,
    };
    case 'try': return {
      title: `What would ${q.road} be like at ${q.to} m?`,
      body: `It is about ${q.w} m in the map. ${q.to} m is the next standard DP road width up: in the editor, drag its width handles (they snap to DP widths) and see the lanes, the footpaths and the buildings it reaches.`,
    };
  }
}

// ---------------- the page ----------------

function Facts({ d }: { d: PlaceData }) {
  const a = d.area;
  const rows: [string, string][] = [
    [`Road within ${d.r} m`, `${a.roadKm} km`],
    ['Main roads', `${a.mainKm} km`],
    ...(a.offKm ? [['On flyovers and bridges', `${a.offKm} km`] as [string, string]] : []),
    ...(a.underKm ? [['In underpasses', `${a.underKm} km`] as [string, string]] : []),
    ['Named roads', n(a.named)],
    ['Junctions (3+ roads)', n(a.junctions)],
    ['… on main roads', n(a.mainJunctions)],
    ['… with signals mapped', n(a.signals)],
    ...(a.roundabouts ? [['Roundabouts', n(a.roundabouts)] as [string, string]] : []),
    ['Buildings mapped', n(a.buildings)],
    ['Ground they cover', `${a.coverage} %`],
    ['Ground height', `${a.elevMin}–${a.elevMax} m`],
    ['DP road widths', d.dp === 'traced' ? `${d.dpKm} km traced` : d.dp === 'sheets' ? 'not traced yet' : `not in ${SITE_NAME}`],
    ['Base map', d.baked],
  ];
  return <dl class="calc-rows place-facts">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

function RoadsTable({ d }: { d: PlaceData }) {
  const dp = d.dp === 'traced';
  return (
    <div class="table-wrap">
      <table class="rules">
        <caption>
          Width in the map: kerb to kerb, footpaths included, as {SITE_NAME}'s base map has it, built from OpenStreetMap's lanes
          and road class{dp ? ' and, here, the DP width narrowed to the space between buildings' : ''}: a model, not a survey.
          Building to building: the median gap between OpenStreetMap footprints straight across the road, where it's built up on both sides.
        </caption>
        <thead>
          <tr>
            <th>Road</th><th>Class</th><th class="n">Length here</th><th class="n">Width in the map</th><th class="n">Lanes</th><th class="n">Building to building</th>
            {dp && <th class="n">DP width</th>}
          </tr>
        </thead>
        <tbody>
          {d.roads.map((f) => (
            <tr key={f.name}>
              <td><b>{roadName(f)}</b>{f.label && <span class="muted small"> ({f.name})</span>}{f.oneway && <span class="muted small"> · {f.oneway === 'pair' ? 'one-way pair' : 'one-way'}</span>}{f.elevated ? <span class="muted small"> · {n(f.elevated)} m on a bridge or flyover</span> : null}</td>
              <td>{f.cls}</td>
              <td class="n">{n(f.len)} m</td>
              <td class="n">{f.wMax - f.wMin >= 1 ? `${f.w} m (${f.wMin}–${f.wMax})` : `${f.w} m`}{f.oneway === 'pair' ? ' each' : ''}</td>
              <td class="n">{f.lanes}{f.divided ? ', divided' : ''}</td>
              <td class="n">{f.gap !== undefined ? `${f.gap} m` : '—'}</td>
              {dp && <td class="n">{f.dp ? <b>{f.dp} m</b> : '—'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Legend({ d }: { d: PlaceData }) {
  return (
    <figcaption class="legend place-legend">
      <span><i class="legend-swatch" style="background:#ffb27f;border:1px solid #d9531e" /> Featured roads</span>
      <span><i class="legend-swatch" style="background:#fff;border:1px solid #a59d92" /> Other roads, drawn to width</span>
      <span><i class="legend-swatch" style="background:#dcd5ca" /> Buildings</span>
      {d.dp === 'traced' && <span><i class="legend-swatch dash" /> DP road edges</span>}
      <span><i class="legend-swatch ring" /> {d.r} m round the centre</span>
    </figcaption>
  );
}

/** A place page by its city and slug (the view in src/site/views.ts). */
export function PlaceBySlug({ city, slug }: { city: City; slug: string }) {
  const p = placeOf(city, slug);
  return p ? <PlacePage place={p} /> : <Page><NotFoundBody /></Page>;
}

export function PlacePage({ place }: { place: Place }) {
  const d = place.data, city = CITY_LABEL[d.city];
  const near = d.nearby.map((q) => ({ q, p: placeOf(d.city, q.slug) })).filter((x): x is { q: typeof x.q; p: Place } => !!x.p);
  const osmNames = d.roads.filter((f) => f.label && f.label === d.name).map((f) => f.name);
  return (
    <Page>
      <section class="wrap guide place">
        <article class="wide">
          <Crumbs trail={[['Home', ''], [city, `${d.city}/`], [d.name, null]]} />
          <h1>{place.h1}</h1>
          <p class="answer">{lead(d)}</p>
          <p class="small muted part-of">
            <Icon.pin /> Part of the <a href={href(`${d.city}/map/`)}>{city} 3D map</a>
            {' · '}<a href={href(`${d.city}/road-width-map/`)}>{city} road width map</a>
            {d.city === 'pune' && d.dp !== 'none' && <>{' · '}<a href={href('pune/dp-map/')}>Pune DP map</a></>}
          </p>
          {(d.aka?.length || osmNames.length) ? (
            <p class="small muted">
              {d.aka?.length ? <>Also known as {d.aka.join(', ')}. </> : null}
              {osmNames.length ? <>In OpenStreetMap: {osmNames.join(', ')}.</> : null}
            </p>
          ) : null}
          <div class="place-grid">
            <figure class="place-map">
              <img src={href(d.map)} width={1000} height={1000} alt={`Map of the roads and buildings within ${d.r} m of ${d.name}, ${city}, roads drawn to their width`} />
              <Legend d={d} />
            </figure>
            <aside class="place-side">
              <Facts d={d} />
              <a class="btn btn-primary btn-lg btn-block" href={appOf(d)}>Open {d.name} in {SITE_NAME} <Icon.arrow /></a>
              <p class="cta-note">Free, in the browser: edit the roads, try the widths, see it in 3D.</p>
            </aside>
          </div>

          <h2>The roads</h2>
          <RoadsTable d={d} />

          <h2>The Development Plan</h2>
          <p>{dpText(d)}</p>

          {d.ideas.length > 0 && (
            <>
              <h2>What if…</h2>
              <div class="place-ideas">
                {d.ideas.map((q, i) => {
                  const x = idea(d, q);
                  return (
                    <div class="place-idea" key={i}>
                      <h3>{x.title}</h3>
                      <p>{x.body}</p>
                      <a href={x.at ? appAt(d.city, x.at[0], x.at[1], 18.5) : appOf(d)}>Try it in the editor <Icon.arrow /></a>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          <div class="cta-panel place-cta">
            <h2>Open {d.name} in {SITE_NAME}</h2>
            <p>The whole of {city} in 2D and 3D: drag a road's width, draw a flyover, see what a plot can hold. Your edits stay in your browser.</p>
            <div class="cta-row"><a class="btn btn-primary btn-lg" href={appOf(d)}>Open {d.name} in {SITE_NAME}</a><a class="btn btn-lg" href={href('guides/')}>Read the guides</a></div>
          </div>

          {near.length > 0 && (
            <>
              <h2>Nearby</h2>
              <div class="guide-list">
                {near.map(({ q, p }) => (
                  <a key={p.slug} href={href(`${p.city}/${p.slug}/`)}>
                    <h3>{p.name}</h3>
                    <p>{q.km} km away · {keyNumber(p.data)}</p>
                  </a>
                ))}
              </div>
            </>
          )}

          <p>More on how roads, widths and plots work in {city}: <a href={href('guides/')}>the {SITE_NAME} guides</a> (FSI, road widths, the DP and what a plot can hold), <a href={href(`${d.city}/`)}>every place in {city}</a>, or the whole city on the <a href={href(`${d.city}/road-width-map/`)}>{city} road width map</a>.</p>

          <Provenance d={d} />
        </article>
      </section>
    </Page>
  );
}

function Provenance({ d }: { d: PlaceData }) {
  return (
    <aside class="calc place-prov" aria-label="Where these numbers come from">
      <h2>Where these numbers come from</h2>
      <ul class="small">
        <li>Roads, junctions, signals and building footprints: © <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap contributors</a> (ODbL), baked into {SITE_NAME}'s base map on {d.baked}. Not every building or signal is mapped.</li>
        <li>Widths and lanes are {SITE_NAME}'s model of each road from those data (lane counts, road class, the space between buildings), not a measured survey.</li>
        {d.dp === 'traced' && <li>Development Plan widths: traced by {SITE_NAME} from the Pune Municipal Corporation's sanctioned DP sheets and registered to the map to within a few metres.</li>}
        <li>Ground heights: Copernicus DEM GLO-30 © DLR / Airbus, smoothed.</li>
        <li>The area is the circle of {d.r} m round {d.lat.toFixed(4)}, {d.lon.toFixed(4)}; a road counts for the length of it inside the circle.</li>
        <li><b>A survey aid, not an official DP remark</b>, zone certificate or engineering advice. For the legal position of a road or plot, ask the municipal corporation.</li>
      </ul>
    </aside>
  );
}

/** The one number a place is listed with: its main road's width (and DP width where traced). */
function keyNumber(d: PlaceData): string {
  const f = d.roads[0];
  if (!f) return `${d.area.roadKm} km of road`;
  return f.dp && d.dp === 'traced' ? `${roadName(f)}: ${f.w} m, DP ${f.dp} m` : `${roadName(f)}: ${f.w} m${f.oneway === 'pair' ? ' each way' : f.oneway ? ', one-way' : ''}`;
}

export function CityPage({ city }: { city: City }) {
  const list = PLACES.filter((p) => p.city === city);
  const traced = list.filter((p) => p.data.dp === 'traced');
  const label = CITY_LABEL[city];
  return (
    <Page>
      <section class="wrap guide place">
        <article class="wide">
          <Crumbs trail={[['Home', ''], [label, null]]} />
          <h1>{label}: road widths{city === 'pune' ? ', the Development Plan' : ''} and what-ifs, place by place</h1>
          <p class="answer">
            {list.length} places in {label}, each measured from {SITE_NAME}'s base map of the city: the length of road, the
            junctions, the buildings and how wide the main roads are{traced.length ? `, and, in the part of Pune where ${SITE_NAME} has traced the Development Plan, how that compares with the plan` : ''}.
            {city === 'mumbai' ? ' These pages are about today’s network.' : ''}
          </p>
          <div class="map-links">
            <a href={href(`${city}/map/`)}><Icon.cube /><span><b>{label} 3D map</b><small>Roads, buildings and terrain</small></span></a>
            {city === 'pune' && <a href={href('pune/dp-map/')}><Icon.sheet /><span><b>Pune DP map</b><small>Where the Development Plan is in {SITE_NAME}</small></span></a>}
            <a href={href(`${city}/road-width-map/`)}><Icon.road /><span><b>{label} road width map</b><small>Main roads by width</small></span></a>
            <a href={href('data/')}><Icon.share /><span><b>Open data</b><small>{label}'s main roads as GeoJSON</small></span></a>
          </div>
          {city === 'mumbai' && (
            <div class="notice info" role="note">
              <Icon.info />
              <p><b>Mumbai's Development Plan (DP 2034) isn't in {SITE_NAME} yet.</b> There's no DP layer for Mumbai in the editor and no DP widths on these pages; for a DP remark, ask the Municipal Corporation of Greater Mumbai. The FSI rules of DCPR 2034 are in the <a href={href('guides/fsi-calculator-mumbai/')}>Mumbai FSI guide</a> and the plot sandbox.</p>
            </div>
          )}
          {traced.length > 0 && <p class="small muted">DP road widths traced: {traced.map((p, i) => <span key={p.slug}>{i ? ', ' : ''}<a href={href(`${city}/${p.slug}/`)}>{p.name}</a></span>)}. Elsewhere in Pune the DP sheets open as a reference layer in the editor.</p>}
          <div class="guide-list">
            {list.map((p) => (
              <a key={p.slug} href={href(`${city}/${p.slug}/`)}>
                <h2 class="h3">{p.name}</h2>
                <p>{keyNumber(p.data)}</p>
                <p>{p.data.area.roadKm} km of road · {p.data.area.mainJunctions} main-road junctions{p.data.dp === 'traced' ? ' · DP traced' : ''}</p>
              </a>
            ))}
          </div>
          <div class="cta-panel place-cta">
            <h2>Open {label} in {SITE_NAME}</h2>
            <p>Every road, flyover and building of {label} in 2D and 3D, in the browser. Try a width, draw a road, see what a plot can hold.</p>
            <div class="cta-row">
              <a class="btn btn-primary btn-lg" href={`${APP}?region=${city}`}>Open {label} in {SITE_NAME}</a>
              <a class="btn btn-lg" href={href('guides/')}>Read the guides</a>
            </div>
          </div>
          <p class="small muted">Base map © OpenStreetMap contributors (ODbL){city === 'pune' ? `, DP sheets traced by ${SITE_NAME} from the PMC Development Plan` : ''}. A survey aid, not an official DP remark.</p>
        </article>
      </section>
    </Page>
  );
}
