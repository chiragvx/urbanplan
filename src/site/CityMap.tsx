// The city map pages: /<city>/map/ (the 3D map: what's on it, how to use it, every place page), /pune/dp-map/ (where
// the Development Plan is in the site, honestly), /<city>/road-width-map/ (main roads by width, the widest and
// narrowest), and /data/ (the open data and the downloads). Every number comes from tools/maps/bake-maps.ts
// (maps/generated/maps.json) or the place pages' bake; this only words them.
import type { ComponentChildren } from 'preact';
import RAW from './maps/generated/maps.json';
import type { CityMapData, MapRoad } from './maps/types';
import { CITY_LABEL, PLACES, placeOf, type City, type Place } from './places/data';
import { APP, href, Icon, Page } from './ui';
import { SITE_NAME } from './brand';
import './place.css';

export const MAPS = RAW as unknown as Record<City, CityMapData>;
const n = (v: number) => v.toLocaleString('en-IN');
const km = (v: number) => `${n(Math.round(v))} km`;
const mb = (b: number) => `${(b / 1e6).toFixed(1)} MB`;
const date = (d: string, locale = 'en-IN') => new Date(d).toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
export const appCity = (city: City, at?: [number, number], zoom = 16) => `${APP}?region=${city}${at ? `&at=${at[0]},${at[1]},${zoom}` : ''}`;
const roadName = (r: MapRoad) => r.name;

export function Crumbs({ trail }: { trail: [string, string | null][] }) {
  return (
    <nav class="crumbs" aria-label="Breadcrumb">
      <ol>{trail.map(([label, to]) => <li key={label}>{to !== null ? <a href={href(to)}>{label}</a> : <span aria-current="page">{label}</span>}</li>)}</ol>
    </nav>
  );
}

/** The place pages of a city, grouped by part of the city (the order the city is usually talked about in). */
export const GROUPS: Record<City, [string, string[]][]> = {
  pune: [
    ['Central Pune', ['fc-road', 'jm-road', 'deccan', 'shivajinagar', 'swargate', 'camp-mg-road', 'pune-station', 'nal-stop']],
    ['West Pune', ['karve-road', 'kothrud', 'chandni-chowk', 'university-circle', 'baner-road']],
    ['East Pune', ['bund-garden-road', 'koregaon-park', 'kalyani-nagar', 'nagar-road', 'viman-nagar', 'kharadi', 'hadapsar']],
    ['South Pune', ['sinhagad-road', 'katraj']],
    ['Pimpri-Chinchwad and Hinjewadi', ['hinjewadi-phase-1', 'wakad', 'pimpri', 'nigdi']],
  ],
  mumbai: [
    ['Island city', ['colaba', 'marine-drive', 'lower-parel', 'worli-naka', 'dadar-tt', 'sion-circle']],
    ['Western suburbs', ['bkc', 'linking-road-bandra', 'sv-road-santacruz', 'juhu', 'andheri-west', 'andheri-east', 'jvlr-jogeshwari', 'goregaon', 'weh-kandivali', 'borivali']],
    ['Eastern suburbs', ['kurla', 'chembur', 'ghatkopar', 'lbs-marg-kanjurmarg', 'powai']],
  ],
};

/** Every place page of the city, grouped; `note` adds a line under each name. */
export function PlaceGroups({ city, note, heading = 'h3', names }: { city: City; note?: (p: Place) => ComponentChildren; heading?: 'h2' | 'h3'; names?: Record<string, string> }) {
  const listed = new Set(GROUPS[city].flatMap(([, s]) => s));
  const rest = PLACES.filter((p) => p.city === city && !listed.has(p.slug)).map((p) => p.slug);
  const groups = [...GROUPS[city], ...(rest.length ? [['Elsewhere', rest] as [string, string[]]] : [])];
  const H = heading;
  return (
    <div class="place-groups">
      {groups.map(([label, slugs]) => (
        <section key={label}>
          <H>{names?.[label] ?? label}</H>
          <ul>
            {slugs.map((s) => placeOf(city, s)).filter((p): p is Place => !!p).map((p) => (
              <li key={p.slug}><a href={href(`${city}/${p.slug}/`)}>{p.name}</a>{note && <span class="muted small"> · {note(p)}</span>}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Rows({ rows }: { rows: [string, ComponentChildren][] }) {
  return <dl class="calc-rows place-facts">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;
}

function Cta({ city, title, body, at }: { city: City; title: string; body: string; at?: [number, number] }) {
  return (
    <div class="cta-panel place-cta">
      <h2>{title}</h2>
      <p>{body}</p>
      <div class="cta-row">
        <a class="btn btn-primary btn-lg" href={appCity(city, at)}>Open {CITY_LABEL[city]} in the editor <Icon.arrow /></a>
        <a class="btn btn-lg" href={href(`${city}/`)}>Places in {CITY_LABEL[city]}</a>
      </div>
    </div>
  );
}

const Sources = ({ city, dp }: { city: City; dp?: boolean }) => (
  <aside class="calc place-prov" aria-label="Where these numbers come from">
    <h2>Where these numbers come from</h2>
    <ul class="small">
      <li>Roads and building footprints: © <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap contributors</a> (ODbL), baked into {SITE_NAME}’s base map of {CITY_LABEL[city]} on {date(MAPS[city].baked)}. Not every building is mapped.</li>
      <li>Widths and lanes are {SITE_NAME}’s model of each road from those data (lane counts, road class), not a measured survey.</li>
      {dp && <li>Development Plan: the Pune Municipal Corporation’s sanctioned DP sheets, scanned, registered to the map to about 2–3 m and, where stated, traced by {SITE_NAME}.</li>}
      <li>Ground heights: Copernicus DEM GLO-30 © DLR / Airbus.</li>
      <li><b>A survey aid, not an official DP remark</b>, zone certificate or engineering advice. For the legal position of a road or plot, ask the {city === 'pune' ? 'Pune Municipal Corporation' : 'Municipal Corporation of Greater Mumbai'}.</li>
    </ul>
  </aside>
);

// ---------------- /<city>/map/ ----------------

export function MapPage({ city }: { city: City }) {
  const M = MAPS[city], label = CITY_LABEL[city];
  const deck = M.deckKm ? `, ${km(M.deckKm)} of it on flyovers and bridges` : '';
  return (
    <Page>
      <section class="wrap guide place">
        <article class="wide">
          <Crumbs trail={[['Home', ''], [label, `${city}/`], [`${label} 3D map`, null]]} />
          <h1>{label} 3D map: roads, buildings and terrain</h1>
          <p class="answer">
            {SITE_NAME}’s map of {city === 'pune' ? 'Pune and Pimpri-Chinchwad' : 'Mumbai'} covers <b>{n(M.km2)} km²</b>: <b>{n(M.counts.roads)} roads</b> in{' '}
            {n(M.counts.sections)} sections, <b>{km(M.roadKm)}</b> of them ({km(M.mainKm)} of main roads{deck}), <b>{n(M.counts.buildings)} buildings</b> and the shape
            of the ground, in 2D and 3D. It opens in the browser, free, with nothing to install, and every road can be edited.
          </p>
          <div class="place-grid">
            <figure class="place-map city-map">
              <img src={href(M.svg.map)} width={M.svg.w} height={M.svg.h} fetchpriority="high" alt={`Map of ${label}'s main roads, highways and arterials in orange, with the ${PLACES.filter((p) => p.city === city).length} places that have their own page marked`} />
              <figcaption class="legend place-legend">
                <span><i class="legend-swatch" style="background:#ff6a2b" /> Highways and arterials</span>
                <span><i class="legend-swatch" style="background:#9e958a" /> Sub-arterials and collectors</span>
                <span><i class="legend-swatch round" style="background:#1d1a17" /> Place pages</span>
              </figcaption>
            </figure>
            <aside class="place-side">
              <Rows rows={[
                ['Area', `${n(M.km2)} km²`],
                ['Roads', n(M.counts.roads)],
                ['Road sections', n(M.counts.sections)],
                ['Length of road', km(M.roadKm)],
                ['… main roads', km(M.mainKm)],
                ...(M.deckKm ? [['… on flyovers and bridges', km(M.deckKm)] as [string, string]] : []),
                ['Buildings', n(M.counts.buildings)],
                ['Development Plan', city === 'pune' ? 'Old PMC, 21 sheets' : 'Not in ' + SITE_NAME + ' yet'],
                ['Base map', date(M.baked)],
              ]} />
              <a class="btn btn-primary btn-lg btn-block" href={appCity(city)}>Open the {label} map <Icon.arrow /></a>
              <p class="cta-note">Free, in the browser. Your edits stay on your computer.</p>
            </aside>
          </div>

          {city === 'pune' && (
            <figure class="shot">
              <img src={href('site/city-3d.webp')} width={1600} height={900} loading="lazy" alt="The editor's 3D view of Pune by the Mula-Mutha river near Koregaon Park: buildings, the road network and the metro viaduct." />
              <figcaption class="small muted">The same map in 3D: press <kbd>Tab</kbd> in the editor.</figcaption>
            </figure>
          )}

          <h2>What’s on it</h2>
          <ul>
            <li><b>Every mapped road</b>, drawn to its width with its lanes and footpaths, flyovers and bridges on their decks, underpasses below the ground.</li>
            <li><b>Every mapped building</b> in 3D, from OpenStreetMap footprints, with heights where they’re known.</li>
            <li><b>The terrain</b>: hills, river banks and slopes, from the Copernicus 30 m elevation model.</li>
            {city === 'pune'
              ? <li><b>The Development Plan</b> for the old PMC limits: the sanctioned DP sheets as a layer over the map, and the planned road widths traced for part of east-central Pune (see the <a href={href('pune/dp-map/')}>Pune DP map</a>).</li>
              : <li><b>No Development Plan yet</b>: Mumbai’s DP 2034 isn’t in {SITE_NAME}. The FSI rules of DCPR 2034 are in the plot sandbox.</li>}
          </ul>
          <div class="table-wrap">
            <table class="rules">
              <caption>Length of road in the map by class, as the editor labels them (OpenStreetMap’s highway classes)</caption>
              <thead><tr><th>Class</th><th class="n">Length</th></tr></thead>
              <tbody>{M.byClass.map((c) => <tr key={c.cls}><td>{c.label}</td><td class="n">{km(c.km)}</td></tr>)}</tbody>
            </table>
          </div>

          <h2>How to use it</h2>
          <ol>
            <li><a href={appCity(city)}>Open the map of {label}</a> and search for a street, an area or a landmark.</li>
            <li>Press <kbd>Tab</kbd> to switch between 2D and 3D. In 3D, right-drag to orbit and fly with <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>.</li>
            {city === 'pune' && <li>Press <kbd>D</kbd> to lay the Development Plan sheets over the map.</li>}
            <li>Click a road to see its cross-section; drag its width handles to try it wider or narrower, or draw a new road, flyover or tunnel.</li>
            <li>Press <kbd>F</kbd> and click a plot’s corners to see what it can hold: FSI by road width, margins and height, as a block in 3D.</li>
          </ol>
          <p>Links can open the map at a point: <code>{`/app/?region=${city}&at=<lat>,<lon>,<zoom>`}</code>. Each place below opens that way.</p>

          <Cta city={city} title={`Open the ${label} map`} body="Every road, flyover and building, in 2D and 3D, in your browser. Try a width, draw a road, see what a plot can hold." />

          <h2>Places on the {label} map</h2>
          <p>Each has a page of its own: the roads and their widths, the junctions, the buildings{city === 'pune' ? ', the Development Plan where it’s traced' : ''}, and a few what-ifs to try.</p>
          <PlaceGroups city={city} note={(p) => `${p.data.area.roadKm} km of road`} />

          <h2>More maps of {label}</h2>
          <ul>
            <li><a href={href(`${city}/road-width-map/`)}>{label} road width map</a>: the main roads coloured by width, the widest and the narrowest.</li>
            {city === 'pune' && <li><a href={href('pune/dp-map/')}>Pune DP map</a>: which areas have the Development Plan sheets, and where the DP road widths are traced.</li>}
            {city === 'pune' && <li lang="mr"><a href={href('mr/pune/map/')} hrefLang="mr">पुण्याचा 3D नकाशा (मराठी)</a></li>}
            <li><a href={href('data/')}>Open data</a>: {label}’s main road network as GeoJSON, under the ODbL.</li>
          </ul>
          <Sources city={city} dp={city === 'pune'} />
        </article>
      </section>
    </Page>
  );
}

// ---------------- /pune/dp-map/ ----------------

export const DP_FAQ: [string, string][] = [
  [`Is the Pune DP map in ${SITE_NAME} official?`, `No. It is the Pune Municipal Corporation’s sanctioned DP sheets, scanned and registered over today’s map to about 2–3 m: enough to see whether a road line or a reservation is near a plot, not to measure it. The official answer is a DP remark or zone certificate from the PMC.`],
  ['Does it cover Pimpri-Chinchwad, Hinjewadi or the merged villages?', `No. The DP sheets in ${SITE_NAME} cover the old PMC limits. Pimpri-Chinchwad (PCMC), Hinjewadi and the villages merged into the PMC since have no DP sheets in ${SITE_NAME}.`],
  ['Where are the DP road widths traced?', `Only in part of east-central Pune, round Bund Garden Road, Koregaon Park, Kalyani Nagar, Nagar Road and Pune Station. Elsewhere the sheets are a picture to read, and the widths in ${SITE_NAME} are today’s roads.`],
  ['How do I see the DP over my plot?', 'Open the editor on Pune, find the plot and press D: the sheet is laid over the map, in 2D and draped over the ground in 3D. Press F and click the plot’s corners to see what a traced DP road takes from it.'],
];

export function DpMapPage() {
  const M = MAPS.pune, D = M.dp!;
  const pune = PLACES.filter((p) => p.city === 'pune');
  const traced = pune.filter((p) => p.data.dp === 'traced'), sheets = pune.filter((p) => p.data.dp === 'sheets'), none = pune.filter((p) => p.data.dp === 'none');
  const at: [number, number] = [traced[0].data.lat, traced[0].data.lon];
  return (
    <Page>
      <section class="wrap guide place">
        <article class="wide">
          <Crumbs trail={[['Home', ''], ['Pune', 'pune/'], ['Pune DP map', null]]} />
          <h1>Pune DP map (Development Plan) online</h1>
          <p class="answer">
            {SITE_NAME} lays the <b>{D.sheets} sheets of Pune’s sanctioned Development Plan</b> over today’s map, registered to about 2–3 m, across{' '}
            <b>{n(Math.round(D.km2))} km²</b> of the old PMC limits. You can view them in the editor, in 2D or draped over the ground in 3D, with <kbd>D</kbd>.
            The DP’s road widths are <b>traced for {km(D.tracedKm)} of road in part of east-central Pune</b> only. Pimpri-Chinchwad, Hinjewadi and the
            merged villages have no DP sheets in {SITE_NAME}.
          </p>
          <p class="small muted" lang="mr"><a href={href('mr/pune/dp-map/')} hrefLang="mr">हे पान मराठीत वाचा: पुणे विकास आराखडा नकाशा</a></p>
          <div class="place-grid">
            <figure class="place-map city-map">
              <img src={href(M.svg.dp!)} width={M.svg.w} height={M.svg.h} fetchpriority="high" alt={`Map of Pune: the area the ${D.sheets} DP sheets cover shaded blue over the old city, the ${km(D.tracedKm)} of road with traced DP widths in red round Bund Garden Road and Kalyani Nagar, and Pimpri-Chinchwad and Hinjewadi outside the sheets`} />
              <figcaption class="legend place-legend">
                <span><i class="legend-swatch" style="background:rgba(79,124,201,.3)" /> DP sheets in {SITE_NAME}</span>
                <span><i class="legend-swatch" style="background:#c0262d" /> DP road widths traced</span>
                <span><i class="legend-swatch round" style="background:#c0262d" /> Place: widths traced</span>
                <span><i class="legend-swatch round" style="background:#2f5fb3" /> Place: sheets only</span>
                <span><i class="legend-swatch round" style="background:#8a8178" /> Place: no DP sheets</span>
              </figcaption>
            </figure>
            <aside class="place-side">
              <Rows rows={[
                ['DP sheets', `${D.sheets} (${D.sheetNames[0]} to ${D.sheetNames[D.sheetNames.length - 1]})`],
                ['Area the sheets cover', `${n(Math.round(D.km2))} km²`],
                ['Registered to the map', 'about 2–3 m'],
                ['DP road widths traced', km(D.tracedKm)],
                ['… on named roads', n(D.tracedRoads)],
                ['PCMC, Hinjewadi, merged villages', 'no DP sheets'],
                ['Base map', date(M.baked)],
              ]} />
              <a class="btn btn-primary btn-lg btn-block" href={appCity('pune', at)}>Open the DP in the editor <Icon.arrow /></a>
              <p class="cta-note">Then press <kbd>D</kbd> for the DP sheets.</p>
            </aside>
          </div>

          <h2>Which areas have the DP</h2>
          <p>Of the {pune.length} places in Pune with a page of their own:</p>
          <div class="dp-status">
            <section>
              <h3><i class="legend-swatch round" style="background:#c0262d" /> DP road widths traced ({traced.length})</h3>
              <ul>{traced.map((p) => <li key={p.slug}><a href={href(`pune/${p.slug}/`)}>{p.name}</a> <span class="muted small">· {p.data.dpKm} km traced</span></li>)}</ul>
              <p class="small muted">The pages compare today’s widths with the DP’s, road by road.</p>
            </section>
            <section>
              <h3><i class="legend-swatch round" style="background:#2f5fb3" /> DP sheets, widths not traced ({sheets.length})</h3>
              <ul>{sheets.map((p) => <li key={p.slug}><a href={href(`pune/${p.slug}/`)}>{p.name}</a></li>)}</ul>
              <p class="small muted">The sheet opens over the map in the editor; the page gives no DP widths.</p>
            </section>
            <section>
              <h3><i class="legend-swatch round" style="background:#8a8178" /> No DP sheets in {SITE_NAME} ({none.length})</h3>
              <ul>{none.map((p) => <li key={p.slug}><a href={href(`pune/${p.slug}/`)}>{p.name}</a></li>)}</ul>
              <p class="small muted">Outside the old PMC limits (or at their edge): for these, ask the PCMC, PMRDA or PMC.</p>
            </section>
          </div>

          <h2>The traced DP road widths</h2>
          <p>
            Where the widths are traced, each road in the map carries the width the DP gives it, drawn either side of today’s centre line
            (the DP’s own line may sit to one side). The traced widths, by length:
          </p>
          <div class="table-wrap">
            <table class="rules">
              <caption>DP road widths traced by {SITE_NAME} in east-central Pune (widths with 0.5 km or more of road)</caption>
              <thead><tr><th>DP width</th><th class="n">Length of road</th></tr></thead>
              <tbody>{D.widths.map((w) => <tr key={w.w}><td>{w.w} m</td><td class="n">{w.km} km</td></tr>)}</tbody>
            </table>
          </div>

          <h2>How to view the DP in the editor</h2>
          <ol>
            <li><a href={appCity('pune', at)}>Open the editor on Pune</a> and search for your street or area.</li>
            <li>Press <kbd>D</kbd> (or pick <b>DP sheets</b> in the info views at the top left). <b>DP regions</b> colours the zones instead.</li>
            <li>Press <kbd>Tab</kbd> for 3D: the sheet drapes over the ground.</li>
            <li>Press <kbd>F</kbd> and click your plot’s corners: where the DP width is traced, the panel shows the strip the DP road takes, and the FSI by the DP width or today’s.</li>
          </ol>

          <h2>What a DP map tells you, and what it doesn’t</h2>
          <div class="two-col">
            <section>
              <h3>It shows</h3>
              <ul>
                <li>The <b>zone</b> an area is in: residential, commercial, industrial, green and so on.</li>
                <li><b>Reservations</b>: land kept for schools, gardens, markets, hospitals, each with a code.</li>
                <li>The <b>planned roads</b>: new ones, and the width existing roads are to be widened to.</li>
              </ul>
            </section>
            <section>
              <h3>It doesn’t</h3>
              <ul>
                <li>Give <b>plot boundaries</b> or survey / CTS numbers: the sheet is a plan, not a land record.</li>
                <li>Show <b>changes made since</b> the plan was sanctioned (modifications, TP schemes), or whether a road has been acquired.</li>
                <li>Replace a <b>DP remark or zone certificate</b>: in {SITE_NAME} it is registered to a few metres, not surveyed.</li>
              </ul>
            </section>
          </div>
          <p>More in the guides: <a href={href('guides/what-is-development-plan/')}>what a Development Plan is</a>, <a href={href('guides/dp-road-affects-property/')}>whether a DP road affects your property</a> and <a href={href('guides/dp-road-widening/')}>what DP road widening does to a plot</a>.</p>

          <div class="notice info" role="note">
            <Icon.info />
            <div style="display:grid;gap:6px">
              <p><b>{SITE_NAME} is a survey aid, not an official DP remark or zone certificate.</b> The sheets are scanned and registered by {SITE_NAME}; the traced widths are {SITE_NAME}’s reading of them.</p>
              <p>The official source is the <a href="https://www.pmc.gov.in/" rel="noopener">Pune Municipal Corporation</a>: ask it for a DP remark or zone certificate for a survey or CTS number, and check with a licensed architect before you buy, sell or build.</p>
            </div>
          </div>

          <h2>Questions</h2>
          <div class="faq">{DP_FAQ.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}</div>

          <Cta city="pune" at={at} title="See the DP over today’s Pune" body="Press D in the editor for the sheets, F to draw a plot and see what the DP road takes from it." />
          <p>The rest of the city: the <a href={href('pune/map/')}>Pune 3D map</a> and the <a href={href('pune/road-width-map/')}>Pune road width map</a>.</p>
          <Sources city="pune" dp />
        </article>
      </section>
    </Page>
  );
}

// ---------------- /<city>/road-width-map/ ----------------

function RoadTable({ city, list, caption, pair }: { city: City; list: MapRoad[]; caption: string; pair?: boolean }) {
  return (
    <div class="table-wrap">
      <table class="rules">
        <caption>{caption}</caption>
        <thead><tr><th>Road</th><th>Class</th>{!pair && <th class="n">Length</th>}<th class="n">Width in the model</th><th class="n">Lanes</th><th>Near</th></tr></thead>
        <tbody>
          {list.map((r) => {
            const near = r.near ? placeOf(city, r.near) : undefined;
            return (
              <tr key={r.name + r.at.join()}>
                <td><a href={appCity(city, r.at, 16.5)} title={`Open ${roadName(r)} in the editor`}>{roadName(r)}</a></td>
                <td>{r.cls}</td>
                {!pair && <td class="n">{r.km} km</td>}
                <td class="n"><b>{r.w} m</b>{pair ? ' each way' : ''}</td>
                <td class="n">{r.lanes}{pair ? ' each way' : ''}</td>
                <td>{near ? <a href={href(`${city}/${near.slug}/`)}>{near.name}</a> : <span class="muted">—</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const bandLabel = (lo: number, hi: number | null) => (hi === null ? `${lo} m and wider` : lo === 0 ? `under ${hi} m` : `${lo} to ${hi} m`);

export function WidthMapPage({ city }: { city: City }) {
  const M = MAPS[city], label = CITY_LABEL[city];
  const total = M.bands.reduce((a, b) => a + b.km, 0);
  const wide = M.bands.filter((b) => b.lo >= 18).reduce((a, b) => a + b.km, 0);
  return (
    <Page>
      <section class="wrap guide place">
        <article class="wide">
          <Crumbs trail={[['Home', ''], [label, `${city}/`], [`${label} road width map`, null]]} />
          <h1>{label} road width map</h1>
          <p class="answer">
            How wide {label}’s <b>{km(total)} of main roads</b> are in {SITE_NAME}’s model of the city, from OpenStreetMap: {Math.round((100 * wide) / total)} % of
            that length is 18 m or wider, kerb to kerb with the footpaths. The {M.namedMain} named main roads run from{' '}
            {M.widest[0] ? <><b>{M.widest[0].name}</b> at {M.widest[0].w} m</> : null}{M.narrowest[0] ? <> down to the two-lane roads at {M.narrowest[0].w} m</> : null}.
            It is a model built from lane counts and road classes, not a survey.
          </p>
          <div class="place-grid">
            <figure class="place-map city-map">
              <img src={href(M.svg.width)} width={M.svg.w} height={M.svg.h} fetchpriority="high" alt={`Map of ${label}'s main roads coloured by width in ${SITE_NAME}'s model, from pale (under 9 m) to dark (30 m and wider), with the place pages marked`} />
              <figcaption class="legend place-legend">
                {M.bands.map((b) => <span key={b.lo}><i class="legend-swatch" style={`background:${b.color}`} /> {bandLabel(b.lo, b.hi)}</span>)}
              </figcaption>
            </figure>
            <aside class="place-side">
              <div class="table-wrap">
                <table class="rules">
                  <caption>Main roads (expressways to collectors) by width in the model</caption>
                  <thead><tr><th>Width</th><th class="n">Length</th><th class="n">Share</th></tr></thead>
                  <tbody>{M.bands.map((b) => <tr key={b.lo}><td><i class="legend-swatch" style={`background:${b.color};display:inline-block;margin-right:8px`} />{bandLabel(b.lo, b.hi)}</td><td class="n">{km(b.km)}</td><td class="n">{Math.round((100 * b.km) / total)} %</td></tr>)}</tbody>
                </table>
              </div>
              <a class="btn btn-primary btn-lg btn-block" href={appCity(city)}>Try a width in the editor <Icon.arrow /></a>
            </aside>
          </div>

          <h2>What the widths mean</h2>
          <ul>
            <li><b>Kerb to kerb, with the footpaths</b>: the lanes, any median, parking and cycle lanes, and the footpaths either side, as {SITE_NAME}’s base map builds each road.</li>
            <li><b>From OpenStreetMap’s tags</b>: the number of lanes where it’s mapped, otherwise a default for the road’s class. Many two-lane collectors have no lane count or width in OpenStreetMap, so the model makes them {M.narrowest[0]?.w ?? 6.4} m; their real width may well be more.</li>
            <li><b>Divided roads mapped as two one-way carriageways</b> are coloured by each carriageway’s width, so they look narrower than the road is from edge to edge. They’re listed apart below.</li>
            <li><b>A model, not a survey</b>: good for comparing roads and trying changes, not for a legal or engineering width.{city === 'pune' ? <> The widths the Development Plan gives roads are on the <a href={href('pune/dp-map/')}>Pune DP map</a>.</> : <> Mumbai’s Development Plan (DP 2034) isn’t in {SITE_NAME} yet, so there are no planned widths to compare with.</>}</li>
          </ul>

          <h2>The widest main roads in {label}</h2>
          <RoadTable city={city} list={M.widest} caption={`Named main roads mapped two-way, by typical width on the ground (length-weighted median; at least 1 km long), in ${SITE_NAME}'s model`} />

          <h2>The narrowest main roads in {label}</h2>
          <RoadTable city={city} list={M.narrowest} caption="Named main roads mapped two-way with two or more lanes, at least 1.5 km long, narrowest first, longest first at the same width" />

          {M.pairs.length > 0 && (
            <>
              <h2>Divided roads mapped as two carriageways</h2>
              <RoadTable city={city} list={M.pairs} pair caption="Each carriageway’s typical width; the road from edge to edge is about twice that, plus the median" />
            </>
          )}

          <h2>The longest named main roads</h2>
          <RoadTable city={city} list={M.longest} caption="Length of the road in the map, both carriageways counted where it’s mapped as two" />

          <Cta city={city} title={`Try a wider road in ${label}`} body="Click a road in the editor to see its cross-section, drag it to a new width and see the lanes, footpaths and buildings it reaches." />

          <h2>Road widths, place by place</h2>
          <p>The place pages measure each area’s main roads in more detail: the narrowest and widest stretches, the gap between buildings across the road{city === 'pune' ? ', and the DP width where it’s traced' : ''}.</p>
          <PlaceGroups city={city} note={(p) => (p.data.roads[0] ? `${p.data.roads[0].label ?? p.data.roads[0].name} ${p.data.roads[0].w} m` : `${p.data.area.roadKm} km of road`)} />
          <p>The whole network as data: <a href={href('data/')}>{label}’s main roads as GeoJSON</a> (ODbL), with each road’s width in the model. And the <a href={href(`${city}/map/`)}>{label} 3D map</a>.</p>
          <Sources city={city} />
        </article>
      </section>
    </Page>
  );
}

// ---------------- /data/ ----------------

export const DATA_FIELDS: [string, string][] = [
  ['name', 'The road’s name in OpenStreetMap (null if it has none)'],
  ['highway', 'OpenStreetMap’s highway class: motorway, trunk, primary, secondary, tertiary or busway'],
  ['class', 'The class as the editor labels it: Expressway, Highway, Arterial, Sub-arterial, Collector, BRTS'],
  ['width_m', 'Width in the model, kerb to kerb with footpaths (m)'],
  ['carriageway_m', 'The carriageway alone, without footpaths (m)'],
  ['lanes', 'Traffic lanes in the model'],
  ['oneway', 'Mapped one-way (often one carriageway of a divided road)'],
  ['structure', 'ground, bridge (a flyover or bridge deck) or underpass'],
  ['osm_way_ids', 'The OpenStreetMap ways it was built from'],
];

export function DataPage() {
  const cities: City[] = ['pune', 'mumbai'];
  return (
    <Page>
      <section class="wrap guide place">
        <article class="wide">
          <Crumbs trail={[['Home', ''], ['Open data', null]]} />
          <h1>Open data: Pune and Mumbai road networks</h1>
          <p class="answer">
            {SITE_NAME} is built on open data: OpenStreetMap’s roads and buildings, the Copernicus elevation model and, for Pune, the Development Plan sheets.
            The main road network of each city, as {SITE_NAME} models it, is free to download as GeoJSON under the <b>Open Database License (ODbL)</b>.
          </p>

          <h2>Downloads</h2>
          <div class="table-wrap">
            <table class="rules">
              <caption>The main roads (expressways to collectors) as centre lines, WGS 84 longitude / latitude, one feature per road section</caption>
              <thead><tr><th>City</th><th class="n">Road sections</th><th class="n">Size</th><th class="n">Gzipped</th><th>Baked</th><th>File</th></tr></thead>
              <tbody>
                {cities.map((c) => {
                  const d = MAPS[c].download;
                  return (
                    <tr key={c}>
                      <td>{MAPS[c].area}</td><td class="n">{n(d.features)}</td><td class="n">{mb(d.bytes)}</td><td class="n">{mb(d.gzBytes)}</td><td>{MAPS[c].baked}</td>
                      <td><a href={href(d.file)} download>{d.file.split('/').pop()}</a></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div class="table-wrap">
            <table class="rules">
              <caption>Each feature’s properties</caption>
              <thead><tr><th>Property</th><th>What it is</th></tr></thead>
              <tbody>{DATA_FIELDS.map(([k, v]) => <tr key={k}><td><code>{k}</code></td><td>{v}</td></tr>)}</tbody>
            </table>
          </div>
          <p class="small muted">Not in the downloads: residential and smaller roads, buildings, terrain, and the Development Plan widths traced by {SITE_NAME} (those may follow later, once their licence is settled).</p>

          <h2>Licence and attribution</h2>
          <ul>
            <li>The downloads are derived from OpenStreetMap and are released under the <a href="https://opendatacommons.org/licenses/odbl/1-0/" rel="noopener">Open Database License 1.0</a>, as OpenStreetMap is.</li>
            <li>Credit it as <b>“© OpenStreetMap contributors”</b>, with a link to <a href="https://www.openstreetmap.org/copyright" rel="noopener">openstreetmap.org/copyright</a>, wherever you use it; adding “road widths: {SITE_NAME} model” is welcome.</li>
            <li>If you share a changed or extended version of the data, share it under the ODbL too.</li>
            <li>The widths are {SITE_NAME}’s model from lane counts and road classes, not a survey: see <a href={href('pune/road-width-map/')}>what the widths mean</a>.</li>
          </ul>

          <h2>What {SITE_NAME} is built on</h2>
          <div class="table-wrap">
            <table class="rules">
              <caption>The sources of the base map</caption>
              <thead><tr><th>Data</th><th>Source</th><th>Licence</th></tr></thead>
              <tbody>
                <tr><td>Roads, junctions, signals, building footprints, land use</td><td><a href="https://www.openstreetmap.org/" rel="noopener">OpenStreetMap</a></td><td>ODbL 1.0, © OpenStreetMap contributors</td></tr>
                <tr><td>Ground heights</td><td>Copernicus DEM GLO-30</td><td>© DLR e.V. 2010–2014 and © Airbus Defence and Space GmbH 2014–2018, provided under COPERNICUS by the European Union and ESA</td></tr>
                <tr><td>Pune Development Plan sheets (old PMC limits)</td><td>Pune Municipal Corporation, sanctioned DP; scanned, registered and partly traced by {SITE_NAME}</td><td>© Pune Municipal Corporation; shown as a reference layer, not redistributed</td></tr>
              </tbody>
            </table>
          </div>

          <h2>Coverage</h2>
          <div class="table-wrap">
            <table class="rules">
              <caption>What each city’s base map holds (from the bake)</caption>
              <thead><tr><th>City</th><th class="n">Area</th><th class="n">Roads</th><th class="n">Road length</th><th class="n">Buildings</th><th>Development Plan</th></tr></thead>
              <tbody>
                {cities.map((c) => {
                  const M = MAPS[c];
                  return (
                    <tr key={c}>
                      <td><a href={href(`${c}/map/`)}>{M.area}</a></td><td class="n">{n(M.km2)} km²</td><td class="n">{n(M.counts.roads)}</td><td class="n">{km(M.roadKm)}</td><td class="n">{n(M.counts.buildings)}</td>
                      <td>{M.dp ? <><a href={href('pune/dp-map/')}>{M.dp.sheets} sheets</a>, {km(M.dp.tracedKm)} of widths traced</> : 'Not in ' + SITE_NAME + ' yet'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p>The maps of each city: <a href={href('pune/map/')}>Pune 3D map</a>, <a href={href('pune/road-width-map/')}>Pune road width map</a>, <a href={href('mumbai/map/')}>Mumbai 3D map</a>, <a href={href('mumbai/road-width-map/')}>Mumbai road width map</a>.</p>
          <p class="small muted">Base maps baked {cities.map((c) => `${CITY_LABEL[c]} ${date(MAPS[c].baked)}`).join(', ')}. A survey aid, not an official record.</p>
        </article>
      </section>
    </Page>
  );
}
