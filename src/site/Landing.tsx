// The landing page: the product in pictures, a caption each.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
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

/** A card in the features bento: a line of copy over a picture that bleeds to its edges. */
function Card({ w, dark, wide, eyebrow, head, more, media, link }: { w: 2 | 3 | 4 | 6; dark?: boolean; wide?: boolean; eyebrow: string; head: string; more: string; media: ComponentChildren; link?: [string, string] }) {
  return (
    <article class={`ab-card ab-${w}${dark ? ' ab-dark' : ''}${wide ? ' ab-wide' : ''}`}>
      <div class="ab-copy">
        <span class="ab-eyebrow">{eyebrow}</span>
        <h3><b>{head}</b> {more}</h3>
        {link && <a class="ab-link" href={link[0]}>{link[1]} <Icon.arrow /></a>}
      </div>
      <div class="ab-media">{media}</div>
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

const STUDIO_CLIP = {
  src: 'studio-procedural.mp4', poster: 'studio-video.webp',
  label: 'Site Studio at work: a garden drawn in, then a car park, then a building moved and the garden reshaped; the parking bays, paths, trees and paving lay themselves out again each time, in the plan and in 3D.',
};
/** the hero: a montage rendered from the editor (npm run film -- intro-01) */
const INTRO = {
  src: 'intro.mp4', poster: 'intro.webp',
  label: 'The editor at work, in three shots: a signal junction inspected and swapped for a roundabout; the Development Plan’s 30 m road line laid over an 18 m road, and the road widened to it; a plot drawn on the land beside the widened road and built up, floor by floor, to the rules.',
};

/** A clip recorded from the app: plays while it's on screen, muted, round and round. */
function StudioVideo({ hero, clip = STUDIO_CLIP }: { hero?: boolean; clip?: typeof STUDIO_CLIP }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [still, setStill] = useState(false);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { setStill(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) void v.play().catch(() => setStill(true)); else v.pause(); }, { threshold: 0.3 });
    io.observe(v);
    return () => io.disconnect();
  }, []);
  return (
    <video ref={ref} class="studio-video" muted loop playsInline preload={hero ? 'metadata' : 'none'} controls={still} poster={img(clip.poster)} width="1600" height="900" aria-label={clip.label}>
      <source src={img(clip.src)} type="video/mp4" />
    </video>
  );
}

const REPORT = href('site/sample-report.html');
// what's in the report, a line each
const REPORT_HAS = [
  'The scheme in 3D, with the figures that matter',
  'Site plan, floor plans and parking decks to scale',
  'Every rule with its clause: met or not',
  'Unit mix, area statement, the optimiser’s alternatives',
  'Costs, profit, IRR and the month-by-month cash flow',
  'What a 10 % swing in price or cost does',
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
            <StudioVideo hero clip={INTRO} />
            <span class="float" style="left:-18px;top:18%"><span class="dot" style="background:var(--up-ok)" /><span><b>Signal → roundabout</b><small>junctions, redrawn live</small></span></span>
            <span class="float" style="right:-18px;top:42%"><span class="dot" style="background:var(--up-reserve)" /><span><b>DP road lines</b><small>over today’s roads</small></span></span>
            <span class="float" style="left:12%;bottom:-18px"><span class="dot" style="background:var(--up-blue)" /><span><b>Plot to tower</b><small>built to the rules</small></span></span>
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
          <div class="bento">
            <Tile w="w4" media={<img width={720} height={540} src={img('studio-towers.webp')} alt="Three residential towers on a plot with an internal road and a roundabout, over satellite imagery." loading="lazy" />} title="The most it can hold" sub="Towers or slabs. FSI by road width, as built or as the DP widens it." />
            <Tile media={<img width={720} height={540} src={img('studio-dp.webp')} alt="The Development Plan sheet draped over the 3D terrain around a plot." loading="lazy" />} title="On satellite or the DP" sub="Lay either under the 3D." />
            <Tile w="w3" media={<img width={720} height={540} src={img('studio-offices.webp')} alt="Glass office towers on the same plot." loading="lazy" />} title="Offices" sub="Curtain walls, deeper plates, parking by floor area." />
            <Tile w="w3" media={<img width={720} height={540} src={img('studio-sheds.webp')} alt="Two industrial sheds with loading docks." loading="lazy" />} title="Industrial sheds" sub="Wide spans, loading bays, truck parking." />
            <Tile w="w4" media={<a href={REPORT} target="_blank" rel="noopener"><img width={979} height={600} src={img('report.webp')} alt="The cover of a feasibility report: the scheme in 3D and its headline figures." loading="lazy" style="object-position:top center" /></a>} title="A report for the meeting" sub="Plans to scale, rules with clauses, compliance, costs and cash flow. Print or PDF." />
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

      <section class="section" id="report">
        <div class="wrap report">
          <div class="report-copy">
            <span class="tag tag-now">Sample</span>
            <h2>A report you can take to the meeting.</h2>
            <p>One click in Site Studio. Eight pages, dark or light, to print or save as PDF. This one is a real plot on Mangaldas Road, Pune.</p>
            <ul>{REPORT_HAS.map((x) => <li key={x}><Icon.check />{x}</li>)}</ul>
            <a class="btn btn-primary btn-lg" href={REPORT} target="_blank" rel="noopener">Open the sample report <Icon.arrow /></a>
          </div>
          <a class="report-stack" href={REPORT} target="_blank" rel="noopener" aria-label="Open the sample report in a new tab">
            <img width={1000} height={1294} class="rp rp-c" src={img('report-money.webp')} alt="The report's money page: costs, profit and the cash flow." loading="lazy" />
            <img width={1000} height={1063} class="rp rp-b" src={img('report-plans.webp')} alt="The report's site plan, drawn to scale: buildings, parking, gardens and trees." loading="lazy" />
            <img width={1000} height={1243} class="rp rp-a" src={img('report-cover.webp')} alt="The report's cover: the scheme in 3D and its headline figures." loading="lazy" />
            <span class="report-open">Open the report ↗</span>
          </a>
        </div>
      </section>

      <section class="section" id="features">
        <div class="wrap">
          <div class="section-head center">
            <h2>Everything in one editor.</h2>
            <p>The city as it is, the plan it's meant to follow, and what a plot can become.</p>
          </div>
          <div class="ab">
            <Card w={4} dark eyebrow="Site Studio" head="Draw a plot. See the most it can hold." more="Towers or slabs, FSI by road width, as built or as the DP widens it."
              media={<img width={720} height={540} src={img('studio-towers.webp')} alt="Three residential towers on a plot with an internal road and a roundabout, over satellite imagery." loading="lazy" />} />
            <Card w={2} eyebrow="DP plan" head="Pune’s Development Plan, on satellite." more="Click a plot: its zone, reservations and DP roads." link={[href('pune/dp-report/'), 'Check a plot']}
              media={<img width={1503} height={812} src={img('dp-satellite.webp')} style="object-position:38% 70%" alt="The Pune DP plan in Aundh: zones coloured over satellite imagery, a plot clicked and its report beside it." loading="lazy" />} />
            <Card w={3} eyebrow="3D editor" head="Every building, every road." more="2,390 km² of Pune and Mumbai in 3D. Tab flips to the plan."
              media={<img width={1600} height={900} src={img('city-3d.webp')} alt="A Pune neighbourhood by the river in 3D: streets, buildings and terrain." loading="lazy" />} />
            <Card w={3} eyebrow="Structures" head="Flyovers, bridges and tunnels." more="Ramps at your grade, headroom checked."
              media={<img width={1100} height={505} src={img('flyover-3d.webp')} alt="An elevated deck on piers beside a river, in 3D." loading="lazy" />} />
            <Card w={2} eyebrow="Roads" head="Real cross-sections." more="Lanes, medians, footpaths. IRC and UDCPR presets." media={<SectionArt />} />
            <Card w={2} eyebrow="Terrain" head="Cut and fill." more="Slopes and earthworks on real elevation." media={<TerrainArt />} />
            <Card w={2} eyebrow="Checks" head="Flagged, never blocked." more="DP lines, buffers, headroom, junctions." media={<ChecksArt />} />
            <Card w={6} dark wide eyebrow="Site Studio" head="The plan and the 3D, side by side." more="Place a tower, drag out a garden or a car park. Paths, trees and bays lay themselves out; flats, FSI and profit update as you go." link={[APP, 'Open the editor']}
              media={<StudioVideo />} />
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
          <img width={1200} height={584} src={img('dp-2d.webp')} alt="" loading="lazy" />
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
