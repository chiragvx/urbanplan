// The landing page: the product in pictures, a caption each.
import type { ComponentChildren } from 'preact';
import { APP, href, Icon, Page } from './ui';
import { ChecksArt, SectionArt, TerrainArt, TodayPlanned } from './art';
import { authReady, session } from '../auth/auth';

const img = (name: string) => href(`site/${name}`);

function Tile({ w, media, title, sub }: { w?: 'w3' | 'w4'; media: ComponentChildren; title: string; sub: string }) {
  return (
    <article class={`tile ${w ?? ''}`}>
      <div class="tile-media">{media}</div>
      <div class="tile-cap"><h3>{title}</h3><p>{sub}</p></div>
    </article>
  );
}

// what Site Studio does, a line each
const STUDIO = [
  { icon: Icon.road, title: 'Internal roads', body: 'A drive round the edge, a spine, a grid or none. Roundabouts too.' },
  { icon: Icon.pin, title: 'More than one gate', body: 'Entrances on every road a large plot touches.' },
  { icon: Icon.building, title: 'Car parks, lots, gardens', body: 'Place them, size them; the buildings make room.' },
  { icon: Icon.check, title: 'Checked as you go', body: 'FSI, height, margins, fire access, open space, parking.' },
  { icon: Icon.sheet, title: 'Costs and returns', body: 'Land to sales: profit, IRR, peak funding, cash flow.' },
  { icon: Icon.share, title: 'Hand it on', body: 'Report as PDF; area statement and unit schedule as CSV; DXF.' },
];

const SOON = [
  { icon: Icon.pin, title: 'More cities', body: 'Their roads, terrain and Development Plans.' },
  { icon: Icon.share, title: 'Export the city', body: 'glTF, OBJ and STL.' },
  { icon: Icon.terrain, title: 'Analysis', body: 'Flood, sun, noise and earthworks.' },
];

export function Landing() {
  const signedIn = !!session.value;
  return (
    <Page current="landing">
      <section class="hero">
        <div class="wrap">
          <a class="pill" href={APP}><i />Beta · Pune and Mumbai · New: Site Studio</a>
          <h1 class="grad">The city, editable.</h1>
          <p class="lede">Roads, flyovers, terrain and the Development Plan. Draw a plot and see the most it can hold. In 2D and 3D, in your browser.</p>
          <div class="cta-row">
            <a class="btn btn-primary btn-lg" href={APP}>Open the editor <Icon.arrow /></a>
            {authReady && !signedIn && <a class="btn btn-lg" href={href('signup/')}>Create an account</a>}
          </div>
          <div class="frame">
            <img src={img('city-3d.webp')} alt="Pune in the editor's 3D view: the river, the elevated metro along its bank, and the city's buildings." width="1600" height="900" fetchpriority="high" />
            <span class="float" style="left:-18px;top:18%"><span class="dot" style="background:var(--up-blue)" /><span><b>6.5 m</b><small>Deck height</small></span></span>
            <span class="float" style="right:-18px;top:42%"><span class="dot" style="background:var(--up-verge)" /><span><b>24 m</b><small>DP road width</small></span></span>
            <span class="float" style="left:12%;bottom:-18px"><span class="dot" style="background:var(--up-reserve)" /><span><b>816</b><small>DP zones traced</small></span></span>
          </div>
        </div>
      </section>

      <div class="wrap">
        <div class="stats">
          <div><b>2,390 km²</b><span>of city</span></div>
          <div><b>411k</b><span>buildings</span></div>
          <div><b>268k</b><span>road sections</span></div>
          <div><b>21</b><span>DP sheets</span></div>
        </div>
      </div>

      <section class="section" id="studio">
        <div class="wrap">
          <div class="section-head center">
            <span class="tag tag-now">New</span>
            <h2>Site Studio.</h2>
            <p>Draw a plot. It plans the most built-up scheme the rules allow, with roads, parking and open space, and tells you what it's worth.</p>
          </div>
          <div class="frame" style="margin-top:0">
            <img src={img('studio.webp')} alt="Site Studio: a plot's plan on the left with three towers, their flats and the rules checked; the towers in 3D over satellite imagery on the right." width="1600" height="900" loading="lazy" />
            <span class="float" style="left:-18px;top:22%"><span class="dot" style="background:var(--up-blue)" /><span><b>FSI 4.33</b><small>of 4.35 allowed</small></span></span>
            <span class="float" style="right:-18px;top:56%"><span class="dot" style="background:var(--up-reserve)" /><span><b>300 flats</b><small>planned for you</small></span></span>
          </div>
          <div class="bento" style="margin-top:var(--up-space-3)">
            <Tile w="w4" media={<img src={img('studio-towers.webp')} alt="Three residential towers on a plot with an internal road and a roundabout, over satellite imagery." loading="lazy" />} title="The most it can hold" sub="Towers or slabs. FSI by road width, as built or as the DP widens it." />
            <Tile media={<img src={img('studio-dp.webp')} alt="The Development Plan sheet draped over the 3D terrain around a plot." loading="lazy" />} title="On satellite or the DP" sub="Lay either under the 3D." />
            <Tile w="w3" media={<img src={img('studio-offices.webp')} alt="Glass office towers on the same plot." loading="lazy" />} title="Offices" sub="Curtain walls, deeper plates, parking by floor area." />
            <Tile w="w3" media={<img src={img('studio-sheds.webp')} alt="Two industrial sheds with loading docks." loading="lazy" />} title="Industrial sheds" sub="Wide spans, loading bays, truck parking." />
            <Tile w="w4" media={<img src={img('report.webp')} alt="The cover of a feasibility report: the scheme in 3D and its headline figures." loading="lazy" style="object-position:top center" />} title="A report for the meeting" sub="Plans to scale, rules with clauses, compliance, costs and cash flow. Print or PDF." />
            <Tile media={<SectionArt />} title="Roads, what if" sub="Widen a road in the study; see the FSI move." />
          </div>
          <div class="soon" style="margin-top:var(--up-space-3)">
            {STUDIO.map((s) => (
              <article key={s.title}>
                <span class="ic"><s.icon /></span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section class="section" id="features">
        <div class="wrap">
          <div class="section-head center">
            <h2>Everything a street needs.</h2>
          </div>
          <div class="bento">
            <Tile w="w4" media={<img src={img('dp-2d.webp')} alt="The 2D plan with Development Plan zones coloured over the streets." loading="lazy" />} title="The Development Plan, on the map" sub="Sheets, zones and road lines over today's city." />
            <Tile media={<SectionArt />} title="Real cross-sections" sub="Lanes, medians, footpaths. IRC and UDCPR presets." />
            <Tile media={<TerrainArt />} title="Terrain and earthworks" sub="Cut, fill and slopes on real elevation." />
            <Tile w="w4" media={<img src={img('flyover-3d.webp')} alt="An elevated deck on piers beside a river, in 3D." loading="lazy" />} title="Flyovers, bridges and tunnels" sub="Ramps at your grade. Headroom checked." />
            <Tile w="w3" media={<img src={img('city-detail.webp')} alt="A dense neighbourhood of Pune in 3D." loading="lazy" />} title="Every building, in 3D" sub="Press Tab to switch views." />
            <Tile w="w3" media={<ChecksArt />} title="Checks as you draw" sub="DP lines, buffers, headroom, junctions." />
          </div>
        </div>
      </section>

      <section class="section" id="plan">
        <div class="wrap tp">
          <div class="section-head center" style="margin-bottom:var(--up-space-5)">
            <h2>Today vs. the plan.</h2>
            <p>See what a street is, and what it's meant to become.</p>
          </div>
          <TodayPlanned />
          <div class="legend">
            <span><i class="legend-swatch" style="background:var(--up-today)" />Today</span>
            <span><i class="legend-swatch" style="background:var(--up-verge)" />DP road line</span>
            <span><i class="legend-swatch" style="background:var(--up-blue)" />Your plot</span>
          </div>
        </div>
      </section>

      <section class="section">
        <div class="wrap">
          <div class="section-head center" style="margin-bottom:var(--up-space-5)"><h2>Made for</h2></div>
          <div class="chips">
            <span><Icon.building />Developers</span>
            <span><Icon.cube />Architects</span>
            <span><Icon.road />Planners</span>
            <span><Icon.pin />Buyers and brokers</span>
            <span><Icon.people />Civic groups</span>
          </div>
        </div>
      </section>

      <section class="section" id="roadmap">
        <div class="wrap">
          <div class="section-head center"><span class="tag tag-soon">Coming next</span><h2>What's next.</h2></div>
          <div class="soon">
            {SOON.map((s) => (
              <article key={s.title}>
                <span class="ic"><s.icon /></span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section class="wrap">
        <div class="cta-panel">
          <img src={img('dp-2d.webp')} alt="" loading="lazy" />
          <h2>Start with your plot.</h2>
          <p>Free in beta. No install.</p>
          <div class="cta-row">
            <a class="btn btn-primary btn-lg" href={APP}>Open the editor <Icon.arrow /></a>
            {authReady && !signedIn && <a class="btn btn-lg" href={href('signup/')}>Create an account</a>}
          </div>
        </div>
        <p class="beta-line">Beta: some flyovers and main roads are still rough. A survey aid, not a legal document.</p>
      </section>
    </Page>
  );
}
