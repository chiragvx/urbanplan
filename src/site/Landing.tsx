// The landing page, kept short: what UrbanPlan is, the three ways in (check a plot, plan a project, explore the
// city), Pro's six steps with a picture of each, the report, and one call to start. Sections ease in as they
// scroll into view (not when motion is reduced, and never hidden without JavaScript).
import { useEffect, useState } from 'preact/hooks';
import { APP, href, Icon, Page } from './ui';
import { authReady, session } from '../auth/auth';

const img = (name: string) => href(`site/${name}`);
const PRO = href('pro/');
const DP = href('pune/dp-report/');
const REPORT = href('site/sample-report.html');

const PATHS = [
  { to: DP, img: 'dp-satellite.webp', w: 1503, h: 812, pos: '38% 70%', eyebrow: 'Free', title: 'Check a plot', body: 'Its zone, reservations and DP roads, on satellite. A report in a click.', cta: 'Check a plot', alt: 'The Pune Development Plan over satellite imagery, a plot clicked and its report beside it.' },
  { to: PRO, img: 'pro-scheme.webp', w: 1440, h: 900, pos: '70% 40%', eyebrow: 'Pro', title: 'Plan a project', body: 'From the plot to the approval: the scheme, the flats, the money and the drawings.', cta: 'Start a project', alt: 'UrbanPlan Pro: a ten-storey residential building on its plot, with the scheme panel and the results bar.' },
  { to: APP, img: 'city-3d.webp', w: 1600, h: 900, pos: 'center', eyebrow: 'Free', title: 'Explore the city', body: 'Every building and road of Pune and Mumbai in 3D. Redraw a junction, widen a road.', cta: 'Open the editor', alt: 'A Pune neighbourhood by the river in 3D: streets, buildings and terrain.' },
];

const STEPS = [
  { key: 'site', label: 'Site', title: 'Find the plot', body: 'By survey or CTS number, or draw it. Its roads, the DP widening and the rules it falls under.' },
  { key: 'scheme', label: 'Scheme', title: 'The most it can hold', body: 'Towers or slabs, the flat mix, shops at the front, parking. Checked against the rules as you go.' },
  { key: 'design', label: 'Design', title: 'Flats, room by room', body: 'Every flat planned and checked for room sizes and light. Facades, windows and the specification.' },
  { key: 'money', label: 'Money', title: 'Is it worth it', body: 'Price, cost and the land deal. Profit, IRR and the cash, month by month.' },
  { key: 'approval', label: 'Approval', title: 'Ready for the authority', body: 'The scrutiny, NOCs, fees and documents. Drawings, IFC and a PreDCR DXF.' },
  { key: 'explore', label: 'Explore', title: 'Every option', body: 'Many schemes at once, a written brief, plots screened side by side.' },
];

const REPORT_HAS = [
  'The scheme in 3D, with the figures that matter',
  'Site plan, floor plans and parking to scale',
  'Every rule with its clause: met or not',
  'Costs, profit, IRR and the cash flow',
];

/** Sections ease in once, as they come into view. Whatever is already on screen shows at once. */
function useReveal() {
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
    const els = [...document.querySelectorAll<HTMLElement>('.reveal')];
    for (const el of els) if (el.getBoundingClientRect().top < innerHeight) el.classList.add('in');
    document.documentElement.classList.add('rv');
    const io = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }, { rootMargin: '0px 0px -8% 0px' });
    els.forEach((el) => !el.classList.contains('in') && io.observe(el));
    return () => io.disconnect();
  }, []);
}

function Steps() {
  const [i, setI] = useState(1);
  const s = STEPS[i];
  return (
    <div class="steps reveal">
      <div class="steps-tabs" role="tablist" aria-label="Pro, step by step">
        {STEPS.map((x, k) => (
          <button key={x.key} type="button" role="tab" id={`st-${x.key}`} aria-selected={k === i} aria-controls="st-panel" class={k === i ? 'on' : ''} onClick={() => setI(k)}>
            <span class="n">{k + 1}</span>
            <span class="t"><b>{x.label}</b><small>{x.title}</small></span>
          </button>
        ))}
      </div>
      <div class="steps-view" id="st-panel" role="tabpanel" aria-labelledby={`st-${s.key}`}>
        <div class="steps-shot">
          {STEPS.map((x, k) => <img key={x.key} class={k === i ? 'on' : ''} width={1440} height={900} src={img(`pro-${x.key}.webp`)} alt={k === i ? `UrbanPlan Pro, the ${x.label} step: ${x.body}` : ''} loading={k === 1 ? 'eager' : 'lazy'} />)}
        </div>
        <p class="steps-cap"><b>{s.title}.</b> {s.body}</p>
      </div>
    </div>
  );
}

export function Landing() {
  useReveal();
  const signedIn = !!session.value;
  return (
    <Page current="landing">
      <section class="hero">
        <div class="wrap">
          <a class="pill" href={PRO}><i />Beta · Pune and Mumbai · New: UrbanPlan Pro</a>
          <h1 class="grad">From a plot to a project.</h1>
          <p class="lede">See what a plot can hold under the rules, what it’s worth, and what the authority will ask for. In your browser.</p>
          <div class="cta-row">
            <a class="btn btn-primary btn-lg" href={PRO}>Start a project <Icon.arrow /></a>
            <a class="btn btn-lg" href={DP}>Check a plot</a>
          </div>
          <a class="frame hero-shot" href={PRO} aria-label="Open UrbanPlan Pro">
            <img width={1440} height={900} src={img('pro-money.webp')} alt="UrbanPlan Pro: a ten-storey building in Baner, Pune, its profit and IRR in the results bar and the cash flow in the Money panel." fetchpriority="high" />
          </a>
        </div>
      </section>

      <div class="wrap reveal">
        <div class="stats">
          <div><b>2,390 km²</b><span>of city</span></div>
          <div><b>411k</b><span>buildings</span></div>
          <div><b>2</b><span>rulebooks: UDCPR and DCPR</span></div>
          <div><b>6</b><span>steps, plot to approval</span></div>
        </div>
      </div>

      <section class="section" id="start">
        <div class="wrap">
          <div class="section-head center reveal">
            <h2>Three ways in.</h2>
            <p>Start where you are: a plot you’re looking at, a project you’re planning, or the city itself.</p>
          </div>
          <div class="paths">
            {PATHS.map((x) => (
              <a key={x.title} class="path reveal" href={x.to}>
                <span class="path-media"><img width={x.w} height={x.h} src={img(x.img)} style={`object-position:${x.pos}`} alt={x.alt} loading="lazy" /></span>
                <span class="path-copy">
                  <span class={`tag ${x.eyebrow === 'Pro' ? 'tag-now' : ''}`}>{x.eyebrow}</span>
                  <b>{x.title}</b>
                  <span>{x.body}</span>
                  <span class="path-cta">{x.cta} <Icon.arrow /></span>
                </span>
              </a>
            ))}
          </div>
        </div>
      </section>

      <section class="section" id="pro">
        <div class="wrap">
          <div class="section-head center reveal">
            <span class="tag tag-now">Pro</span>
            <h2>Six steps, plot to approval.</h2>
            <p>One project, every number live. Change the flat mix and the profit, the parking and the fees follow.</p>
          </div>
          <Steps />
        </div>
      </section>

      <section class="section" id="report">
        <div class="wrap report reveal">
          <div class="report-copy">
            <span class="tag tag-now">Sample</span>
            <h2>A report for the meeting.</h2>
            <p>Eight pages to print or save as PDF. This one is a real plot on Mangaldas Road, Pune.</p>
            <ul>{REPORT_HAS.map((x) => <li key={x}><Icon.check />{x}</li>)}</ul>
            <a class="btn btn-lg" href={REPORT} target="_blank" rel="noopener">Open the sample report <Icon.arrow /></a>
          </div>
          <a class="report-stack" href={REPORT} target="_blank" rel="noopener" aria-label="Open the sample report in a new tab">
            <img width={1000} height={1294} class="rp rp-c" src={img('report-money.webp')} alt="The report's money page: costs, profit and the cash flow." loading="lazy" />
            <img width={1000} height={1063} class="rp rp-b" src={img('report-plans.webp')} alt="The report's site plan, drawn to scale: buildings, parking, gardens and trees." loading="lazy" />
            <img width={1000} height={1243} class="rp rp-a" src={img('report-cover.webp')} alt="The report's cover: the scheme in 3D and its headline figures." loading="lazy" />
            <span class="report-open">Open the report ↗</span>
          </a>
        </div>
      </section>

      <section class="wrap">
        <div class="end reveal">
          <h2>Start with your plot.</h2>
          <p>Free in beta. Nothing to install.</p>
          <div class="cta-row">
            <a class="btn btn-primary btn-lg" href={PRO}>Start a project <Icon.arrow /></a>
            {authReady && !signedIn && <a class="btn btn-lg" href={href('signup/')}>Create an account</a>}
          </div>
        </div>
        <p class="beta-line">Beta: a planning aid, not a legal document. Check every figure with the authority.</p>
      </section>
    </Page>
  );
}
